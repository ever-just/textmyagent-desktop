import { log } from '../logger';
import { getDatabase, recordApiUsage, getSettingInt, getSettingFloat, getSettingBool } from '../database';
import { promptBuilder } from './PromptBuilder';
import { toolRegistry, ToolCallContext } from './ToolRegistry';
import type { PromptContext } from '../types';
import path from 'path';
import fs from 'fs';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
  toolsUsed: string[];
  durationMs?: number;
}

// node-llama-cpp types — resolved at runtime via dynamic import
type LlamaInstance = any;
type LlamaModelInstance = any;
type LlamaContextInstance = any;

export type ModelStatus = 'not_downloaded' | 'downloading' | 'ready' | 'loading' | 'loaded' | 'error';

export class LocalLLMService {
  private llama: LlamaInstance | null = null;
  private model: LlamaModelInstance | null = null;
  private context: LlamaContextInstance | null = null;
  private modelPath: string | null = null;
  private maxTokens = 1024;
  private temperature = 0.7;
  private contextSize = 8192;
  private gpuLayers = -1;
  private initialized = false;
  private _status: ModelStatus = 'not_downloaded';
  private _downloadProgress = 0;
  private _errorMessage: string | null = null;
  private _loadingPromise: Promise<void> | null = null;

  // Cache for dynamic import of node-llama-cpp (ESM module in CommonJS context)
  private _llamaModule: any = null;

  constructor() {
    // Don't initialize in constructor — wait for Electron app to be ready
  }

  get status(): ModelStatus {
    return this._status;
  }

  get downloadProgress(): number {
    return this._downloadProgress;
  }

  get errorMessage(): string | null {
    return this._errorMessage;
  }

  private async getLlamaModule(): Promise<any> {
    if (!this._llamaModule) {
      // node-llama-cpp is ESM-only with top-level await.
      // TypeScript compiles import() to require() in CommonJS mode,
      // which fails for ESM modules. Use Function trick to preserve real import().
      const dynamicImport = new Function('specifier', 'return import(specifier)');
      this._llamaModule = await dynamicImport('node-llama-cpp');
    }
    return this._llamaModule;
  }

  /**
   * Get the default model directory inside the Electron userData folder.
   */
  getModelsDir(): string {
    try {
      const { app } = require('electron');
      return path.join(app.getPath('userData'), 'models');
    } catch {
      // Fallback for non-Electron context
      return path.join(process.cwd(), 'models');
    }
  }

  /**
   * Get the expected model file path.
   */
  getModelFilePath(): string {
    const modelsDir = this.getModelsDir();
    // Look for any .gguf file in the models directory
    if (fs.existsSync(modelsDir)) {
      const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.gguf'));
      if (files.length > 0) {
        return path.join(modelsDir, files[0]);
      }
    }
    return path.join(modelsDir, 'gemma-4-e4b-it-Q4_K_M.gguf');
  }

  /**
   * Check if the model file exists on disk.
   */
  isModelDownloaded(): boolean {
    const modelPath = this.getModelFilePath();
    return fs.existsSync(modelPath);
  }

  /**
   * Download the Gemma 4 E4B model from Hugging Face.
   */
  async downloadModel(
    onProgress?: (percent: number, downloadedMB: number, totalMB: number) => void
  ): Promise<string> {
    this._status = 'downloading';
    this._downloadProgress = 0;
    this._errorMessage = null;

    try {
      const { createModelDownloader } = await this.getLlamaModule();
      const modelsDir = this.getModelsDir();

      if (!fs.existsSync(modelsDir)) {
        fs.mkdirSync(modelsDir, { recursive: true });
      }

      const downloader = await createModelDownloader({
        modelUri: 'hf:ggml-org/gemma-4-E4B-it-GGUF:Q4_K_M',
        dirPath: modelsDir,
        showCliProgress: false,
        onProgress: (status: { downloadedSize: number; totalSize: number }) => {
          const percent = Math.round((status.downloadedSize / status.totalSize) * 100);
          const downloadedMB = status.downloadedSize / 1024 / 1024;
          const totalMB = status.totalSize / 1024 / 1024;
          this._downloadProgress = percent;
          onProgress?.(percent, downloadedMB, totalMB);
        },
      });

      log('info', 'Starting model download', {
        modelFile: downloader.entrypointFilename,
        totalSize: `${(downloader.totalSize / 1024 / 1024).toFixed(0)} MB`,
      });

      const modelPath = await downloader.download();
      this.modelPath = modelPath;
      this._status = 'ready';
      this._downloadProgress = 100;

      // Persist model path
      try {
        const { SecureStorage } = require('../../utils/secure-storage');
        SecureStorage.setModelPath(modelPath);
      } catch { /* non-fatal */ }

      log('info', 'Model download complete', { modelPath });
      return modelPath;
    } catch (error: any) {
      this._status = 'error';
      this._errorMessage = error.message || String(error);
      log('error', 'Model download failed', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * Initialize the LLM engine and load the model into memory.
   */
  async initModel(): Promise<void> {
    if (this.initialized && this.model) return;

    // Guard against concurrent load calls
    if (this._loadingPromise) return this._loadingPromise;
    this._loadingPromise = this._doInitModel();
    try {
      await this._loadingPromise;
    } finally {
      this._loadingPromise = null;
    }
  }

  private async _doInitModel(): Promise<void> {
    this._status = 'loading';
    this._errorMessage = null;
    this.syncSettings();

    try {
      const { getLlama } = await this.getLlamaModule();

      log('info', 'Initializing llama.cpp engine...');
      // Use "lastBuild" to load the custom-compiled llama.cpp binary that supports
      // Gemma 4. Inside an asar-packaged Electron app, getLlama({ gpu: 'metal' })
      // cannot resolve the custom build folder name (the cloned llama.cpp repo info
      // is stripped from the asar) and falls back to the prebuilt binary which lacks
      // Gemma 4 support. "lastBuild" reads lastBuild.json directly and loads the
      // correct binary.
      try {
        this.llama = await getLlama('lastBuild', { debug: true });
        log('info', 'llama.cpp initialized via lastBuild');
      } catch (lastBuildErr: any) {
        log('warn', 'lastBuild init failed, trying Metal GPU', { error: lastBuildErr.message });
        try {
          this.llama = await getLlama({ gpu: 'metal', debug: true });
          log('info', 'llama.cpp initialized with Metal GPU');
        } catch (metalErr: any) {
          log('warn', 'Metal GPU init failed, falling back to auto', { error: metalErr.message });
          this.llama = await getLlama({ debug: true });
          log('info', 'llama.cpp initialized with auto GPU detection');
        }
      }

      // Resolve model path
      let modelPath = this.getModelFilePath();

      // Check persisted path
      try {
        const { SecureStorage } = require('../../utils/secure-storage');
        const persistedPath = SecureStorage.getModelPath();
        if (persistedPath && fs.existsSync(persistedPath)) {
          modelPath = persistedPath;
        }
      } catch { /* use default */ }

      if (!fs.existsSync(modelPath)) {
        this._status = 'not_downloaded';
        throw new Error(`Model file not found: ${modelPath}. Download it first.`);
      }

      this.modelPath = modelPath;

      let fileSize: number | undefined;
      try { fileSize = fs.statSync(modelPath).size; } catch { /* non-fatal */ }
      log('info', 'Loading local LLM model...', { modelPath, fileSize });

      const loadOpts: Record<string, any> = {
        modelPath,
        // Disable mmap to avoid SIGBUS / KERN_MEMORY_ERROR in Electron hardened runtime.
        // Without this, macOS can invalidate the memory-mapped model file under certain conditions.
        useMmap: false,
      };
      if (this.gpuLayers !== -1) {
        loadOpts.gpuLayers = this.gpuLayers;
      }
      const loadStart = Date.now();
      log('info', 'loadModel options', loadOpts);
      this.model = await this.llama.loadModel(loadOpts);
      log('info', 'Model binary loaded', { durationMs: Date.now() - loadStart });

      // Let node-llama-cpp auto-detect optimal context size to avoid InsufficientMemoryError.
      // Only specify contextSize if user explicitly set a non-default value.
      const ctxOpts: Record<string, any> = {};
      if (this.contextSize !== 8192) {
        ctxOpts.contextSize = this.contextSize;
      }
      try {
        this.context = await this.model.createContext(ctxOpts);
      } catch (ctxErr: any) {
        // If context creation fails (e.g. InsufficientMemoryError), retry with no constraints
        if (ctxErr.name === 'InsufficientMemoryError' || ctxErr.message?.includes('memory')) {
          log('warn', 'Context creation failed, retrying with auto settings', { error: ctxErr.message });
          this.context = await this.model.createContext({});
        } else {
          throw ctxErr;
        }
      }

      this.initialized = true;
      this._status = 'loaded';
      log('info', 'Local LLM model loaded successfully', { totalDurationMs: Date.now() - loadStart });
    } catch (error: any) {
      this.initialized = false;
      this.model = null;
      this.context = null;
      if (this._status !== 'not_downloaded') {
        this._status = 'error';
      }
      this._errorMessage = error.message || String(error);
      log('error', 'Failed to load local LLM', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * Unload the model and free resources.
   */
  async dispose(): Promise<void> {
    try {
      if (this.context) {
        await this.context.dispose();
        this.context = null;
      }
      if (this.model) {
        await this.model.dispose();
        this.model = null;
      }
      if (this.llama?.dispose) {
        await this.llama.dispose();
        this.llama = null;
      }
      this.initialized = false;
      this._status = this.isModelDownloaded() ? 'ready' : 'not_downloaded';
      log('info', 'Local LLM disposed');
    } catch (error: any) {
      log('warn', 'Error disposing LLM', { error: error.message });
    }
  }

  refreshClient(): void {
    this.initialized = false;
    this.model = null;
    this.context = null;
    this.syncSettings();
  }

  /**
   * Sync runtime state with persisted database settings.
   */
  syncSettings(): void {
    try {
      this.maxTokens = getSettingInt('model.responseMaxTokens', this.maxTokens);
      this.temperature = getSettingFloat('model.temperature', this.temperature);
      this.contextSize = getSettingInt('model.contextSize', this.contextSize);
      this.gpuLayers = getSettingInt('model.gpuLayers', this.gpuLayers);
      log('info', 'LocalLLMService settings synced', {
        maxTokens: this.maxTokens,
        temperature: this.temperature,
        contextSize: this.contextSize,
        gpuLayers: this.gpuLayers,
      });
    } catch (err) {
      // Database may not be ready yet — keep current values
      log('debug', 'syncSettings skipped (database may not be ready)', { error: String(err) });
    }
  }

  isConfigured(): boolean {
    return this.initialized && this.model !== null;
  }

  async generateResponse(
    userMessage: string,
    conversationHistory: Message[] = [],
    systemPrompt?: string,
    promptContext?: Partial<PromptContext>,
    toolContext?: ToolCallContext
  ): Promise<LLMResponse | null> {
    if (!this.model || !this.context) {
      try {
        await this.initModel();
      } catch {
        log('error', 'Local LLM not loaded');
        return null;
      }
      if (!this.model || !this.context) {
        return null;
      }
    }

    const maxToolLoops = getSettingInt('security.maxApiCallsPerMessage', 6);
    const toolsEnabled = getSettingBool('tools.enabled', true);

    // Create a dedicated context per generation to avoid exhaustion.
    // A shared context fills up after the first large response and subsequent
    // requests fail with no output.
    let perRequestContext: any = null;

    try {
      const { LlamaChatSession, defineChatSessionFunction } = await this.getLlamaModule();

      // Build system prompt
      const finalSystemPrompt = systemPrompt || promptBuilder.build(promptContext || { date: new Date().toLocaleString() });

      // Create a fresh context + session for this request
      perRequestContext = await this.model!.createContext({});
      const session = new LlamaChatSession({
        contextSequence: perRequestContext.getSequence(),
        systemPrompt: finalSystemPrompt,
      });

      // Pre-populate conversation history
      if (conversationHistory.length > 0) {
        // node-llama-cpp's setChatHistory allows setting prior turns
        const chatHistory = [
          { type: 'system', text: finalSystemPrompt },
          ...conversationHistory.map((m) => ({
            type: m.role === 'user' ? 'user' : 'model',
            response: m.role === 'assistant' ? [m.content] : undefined,
            text: m.role === 'user' ? m.content : undefined,
          })),
        ];
        try {
          session.setChatHistory(chatHistory as any);
        } catch {
          // If setChatHistory fails, history was already set via systemPrompt
          log('warn', 'setChatHistory failed, using system prompt only');
        }
      }

      // Register tools if enabled
      const toolsUsed: string[] = [];
      const toolFunctions: Record<string, any> = {};
      let toolCallCount = 0;

      if (toolsEnabled) {
        const toolDefs = toolRegistry.getEnabledDefinitions();
        for (const def of toolDefs) {
          if (!def.inputSchema) continue;

          // Convert JSON schema to node-llama-cpp function definition
          toolFunctions[def.name] = defineChatSessionFunction({
            description: def.description,
            params: def.inputSchema,
            handler: async (params: Record<string, unknown>) => {
              toolCallCount++;
              if (toolCallCount > maxToolLoops) {
                log('warn', 'Tool loop limit reached', { maxToolLoops, toolCallCount, toolName: def.name });
                return `[Tool loop limit reached (${maxToolLoops}). No more tool calls allowed for this message.]`;
              }

              toolsUsed.push(def.name);
              log('debug', `Tool call: ${def.name}`, {
                toolName: def.name,
                toolInput: JSON.stringify(params).substring(0, 500),
              });

              const result = await toolRegistry.executeToolCall(
                {
                  id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  name: def.name,
                  input: params,
                },
                toolContext || { userId: 'unknown', chatGuid: 'unknown' }
              );

              return result.content;
            },
          });
        }
      }

      // Generate response with tool support
      const startTime = Date.now();
      let response = await session.prompt(userMessage, {
        maxTokens: this.maxTokens,
        temperature: this.temperature,
        functions: Object.keys(toolFunctions).length > 0 ? toolFunctions : undefined,
        maxParallelFunctionCalls: 1,
      });
      const durationMs = Date.now() - startTime;

      // --- Raw tool call fallback (Gemma 4 workaround) ---
      // Gemma 4 sometimes emits tool call tokens as plain text instead of
      // invoking the registered function API.  Detect, execute, and strip.
      response = await this.stripAndExecuteRawToolCalls(
        response, toolsUsed, toolContext || { userId: 'unknown', chatGuid: 'unknown' }
      );

      // Estimate token counts (node-llama-cpp doesn't expose exact counts easily)
      const estimatedInputTokens = Math.ceil((finalSystemPrompt.length + userMessage.length) / 4);
      const estimatedOutputTokens = Math.ceil(response.length / 4);

      // Record usage
      recordApiUsage(estimatedInputTokens, estimatedOutputTokens, 'gemma-4-e4b');

      log('info', 'Local LLM response generated', {
        model: 'gemma-4-e4b',
        estimatedInputTokens,
        estimatedOutputTokens,
        toolsUsed: toolsUsed.join(', ') || 'none',
        durationMs,
        responsePreview: response.substring(0, 150) || '(empty)',
      });

      // Dispose session + per-request context to free resources
      try {
        session.dispose?.();
      } catch { /* non-fatal */ }
      try {
        await perRequestContext?.dispose?.();
      } catch { /* non-fatal */ }

      return {
        content: response,
        inputTokens: estimatedInputTokens,
        outputTokens: estimatedOutputTokens,
        stopReason: 'end_turn',
        toolsUsed,
        durationMs,
      };
    } catch (error: any) {
      log('error', 'Local LLM generation error', { error: error.message, stack: error.stack });
      try {
        await perRequestContext?.dispose?.();
      } catch { /* non-fatal */ }
      return null;
    }
  }

  setMaxTokens(tokens: number): void {
    this.maxTokens = tokens;
  }

  setTemperature(temp: number): void {
    this.temperature = temp;
  }

  setContextSize(size: number): void {
    this.contextSize = size;
  }

  setGpuLayers(layers: number): void {
    this.gpuLayers = layers;
  }

  // ---------------------------------------------------------------------------
  // Raw tool-call fallback  (Gemma 4 workaround)
  // ---------------------------------------------------------------------------
  // Known patterns emitted by Gemma 4 when it bypasses the function-calling API:
  //   1. <|tool_call>call: tool_name(params: {...})<tool_call|>
  //   2. <|tool_call|>call: tool_name(params: {...})<|/tool_call|>
  //   3. call: tool_name(params: {...})  (bare, no delimiters)
  //   4. <|"|"> token leaks inside JSON values  (llama.cpp #21316)
  //   5. function_call / tool_call markers without proper structure
  // ---------------------------------------------------------------------------
  static readonly RAW_TOOL_CALL_PATTERNS: RegExp[] = [
    // Pattern 1 & 2: Delimited tool calls (greedy match across variants)
    /<\|?\/?tool_call\|?>[\s\S]*?<\|?\/?tool_call\|?>/gi,
    // Pattern 3: Bare "call: name(params: {...})" — must be on its own line or the
    // entire response to avoid false positives inside normal prose
    /^call:\s*(\w+)\(params:\s*(\{[\s\S]*?\})\)\s*$/m,
    // Pattern 5: Stray opening/closing markers left over
    /<\|?\/?tool_call\|?>/gi,
  ];

  // Regex used to strip Gemma 4 <|"|"> token leak artifacts (llama.cpp #21316)
  static readonly TOKEN_LEAK_PATTERN = /<\|"\|>/g;

  // Extraction regex — tries to pull tool name + JSON params from any matched text
  private static readonly TOOL_EXTRACT_RE =
    /(?:call:\s*)?(\w+)\s*\(\s*(?:params:\s*)?(\{[\s\S]*?\})\s*\)/;

  /**
   * Detect raw tool-call text in the LLM response, attempt to execute the
   * tools via ToolRegistry, and strip the artifacts from the output.
   */
  async stripAndExecuteRawToolCalls(
    response: string,
    toolsUsed: string[],
    toolContext: ToolCallContext
  ): Promise<string> {
    if (!response || response.length === 0) return response;

    let cleaned = response;
    let anyDetected = false;

    // Pass 1: Find and execute delimited / bare tool calls
    for (const pattern of LocalLLMService.RAW_TOOL_CALL_PATTERNS) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;

      const matches = cleaned.match(pattern);
      if (!matches) continue;

      for (const match of matches) {
        anyDetected = true;
        const extracted = LocalLLMService.TOOL_EXTRACT_RE.exec(match);

        if (extracted) {
          const toolName = extracted[1];
          let toolParams: Record<string, unknown> = {};
          try {
            // Clean token-leak artifacts from JSON before parsing
            const cleanedJson = extracted[2].replace(LocalLLMService.TOKEN_LEAK_PATTERN, '"');
            toolParams = JSON.parse(cleanedJson);
          } catch (parseErr) {
            log('warn', 'Failed to parse raw tool call params', {
              toolName,
              rawParams: extracted[2].substring(0, 200),
              error: (parseErr as Error).message,
            });
          }

          // Execute the tool if it looks valid
          try {
            log('info', 'Executing raw tool call fallback', { toolName, params: JSON.stringify(toolParams).substring(0, 200) });
            const result = await toolRegistry.executeToolCall(
              {
                id: `raw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: toolName,
                input: toolParams,
              },
              toolContext
            );
            if (!toolsUsed.includes(toolName)) {
              toolsUsed.push(toolName);
            }
            log('info', 'Raw tool call executed successfully', {
              toolName,
              isError: result.isError,
              outputPreview: result.content.substring(0, 100),
            });
          } catch (execErr) {
            log('error', 'Raw tool call execution failed', {
              toolName,
              error: (execErr as Error).message,
            });
          }
        } else {
          log('warn', 'Detected raw tool call text but could not extract tool name/params', {
            matchPreview: match.substring(0, 200),
          });
        }

        // Strip the matched text from the response regardless of execution success
        cleaned = cleaned.replace(match, '');
      }
    }

    // Pass 2: Clean residual token-leak artifacts (<|"|"> etc.)
    cleaned = cleaned.replace(LocalLLMService.TOKEN_LEAK_PATTERN, '');
    // Remove other common Gemma 4 leaked special tokens
    cleaned = cleaned.replace(/<\|[a-z_]*\|>/gi, '');

    // Normalize whitespace left behind
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

    if (anyDetected) {
      log('info', 'Raw tool call artifacts stripped from response', {
        originalLength: response.length,
        cleanedLength: cleaned.length,
        toolsUsed: toolsUsed.join(', '),
      });
    }

    return cleaned;
  }
}

// Singleton instance
export const localLLMService = new LocalLLMService();
