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

    this._status = 'loading';
    this.syncSettings();

    try {
      const { getLlama } = await this.getLlamaModule();

      log('info', 'Initializing llama.cpp engine...');
      // Use custom-built llama.cpp (b8808+) which supports Gemma 4 architecture.
      // The local build with Metal is created via: npx node-llama-cpp source download --release latest && npx node-llama-cpp source build --gpu metal
      this.llama = await getLlama({ gpu: 'metal' });

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

      log('info', 'Loading local LLM model...', { modelPath });

      const loadOpts: Record<string, any> = { modelPath };
      if (this.gpuLayers !== -1) {
        loadOpts.gpuLayers = this.gpuLayers;
      }
      this.model = await this.llama.loadModel(loadOpts);
      this.context = await this.model.createContext({
        contextSize: this.contextSize,
      });

      this.initialized = true;
      this._status = 'loaded';
      log('info', 'Local LLM model loaded successfully');
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

    try {
      const { LlamaChatSession, defineChatSessionFunction } = await this.getLlamaModule();

      // Build system prompt
      const finalSystemPrompt = systemPrompt || promptBuilder.build(promptContext || { date: new Date().toLocaleString() });

      // Create a fresh chat session for this request
      const session = new LlamaChatSession({
        contextSequence: this.context.getSequence(),
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
      const response = await session.prompt(userMessage, {
        maxTokens: this.maxTokens,
        temperature: this.temperature,
        functions: Object.keys(toolFunctions).length > 0 ? toolFunctions : undefined,
        maxParallelFunctionCalls: 1,
      });
      const durationMs = Date.now() - startTime;

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

      // Dispose the session to free context sequence
      try {
        session.dispose?.();
      } catch { /* non-fatal */ }

      return {
        content: response,
        inputTokens: estimatedInputTokens,
        outputTokens: estimatedOutputTokens,
        stopReason: 'end_turn',
        toolsUsed,
      };
    } catch (error: any) {
      log('error', 'Local LLM generation error', { error: error.message });
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
}

// Singleton instance
export const localLLMService = new LocalLLMService();
