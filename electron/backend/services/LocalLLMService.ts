import { log } from '../logger';
import { getDatabase, recordApiUsage, getSettingInt, getSettingFloat, getSettingBool } from '../database';
import { promptBuilder } from './PromptBuilder';
import { toolRegistry, ToolCallContext } from './ToolRegistry';
import type { PromptContext } from '../types';
import path from 'path';
import fs from 'fs';
import os from 'os';

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

// Persistent session entry — keeps the LlamaChatSession + KV cache alive
// so subsequent messages in the same conversation don't re-process history.
interface SessionPoolEntry {
  session: any;           // LlamaChatSession
  lastActivity: number;   // epoch ms
  chatGuid: string;
  systemPrompt: string;   // system prompt used when session was created
}

// Session eviction callback signature (Phase 4.2: auto-summarization on eviction).
// Handler receives the chatGuid of the session being evicted; caller owns message data.
export type SessionEvictedHandler = (chatGuid: string, reason: 'lru' | 'idle_ttl' | 'manual' | 'error') => void | Promise<void>;

// Pool size + model recommendation for the detected hardware.
export interface PoolSizingRecommendation {
  totalRamGB: number;
  recommendedModel: 'E2B' | 'E4B';
  maxPooledSessions: number;
  contextSize: number;
  notes: string;
}

export class LocalLLMService {
  private llama: LlamaInstance | null = null;
  private model: LlamaModelInstance | null = null;
  private context: LlamaContextInstance | null = null;
  private modelPath: string | null = null;
  private maxTokens = 1024;
  private temperature = 0.7;
  // contextSize default lowered from 8192 → 4096 after scale analysis.
  // SMS conversations rarely need more than 3.5K tokens (system ~1K + facts/summary ~500 + last 20 msgs ~2K).
  // Freeing the budget enables more concurrent pool slots. See docs/SCALE_AND_EFFICIENCY.md §7 Bottleneck #3.
  private contextSize = 4096;
  private gpuLayers = -1;
  private initialized = false;
  private _status: ModelStatus = 'not_downloaded';
  private _downloadProgress = 0;
  private _errorMessage: string | null = null;
  private _loadingPromise: Promise<void> | null = null;

  // Cache for dynamic import of node-llama-cpp (ESM module in CommonJS context)
  private _llamaModule: any = null;

  // Session pool — keeps live LlamaChatSession per conversation so the KV cache
  // retains prior turns and only the new message needs processing.
  private sessionPool: Map<string, SessionPoolEntry> = new Map();
  // maxPooledSessions: overridden by detectRecommendedPoolSize() on init.
  // Default 2 is the conservative fallback for 8GB Macs.
  private maxPooledSessions = 2;

  // Phase 2.3: Idle TTL — evict sessions that haven't been used in IDLE_TTL_MS.
  // Keeps the pool responsive to actually-active users rather than stale LRU order.
  private static readonly IDLE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private static readonly IDLE_TTL_SWEEP_MS = 60 * 1000;  // check every 60s
  private idleTtlTimer: NodeJS.Timeout | null = null;

  // Phase 4.2: Pluggable eviction handler(s). AgentService registers one here
  // to run auto-summarization before the session's context is lost.
  // Handlers run async and MUST NOT throw up to the caller; eviction always proceeds.
  private onSessionEvictedHandlers: SessionEvictedHandler[] = [];

  constructor() {
    // Don't initialize in constructor — wait for Electron app to be ready
  }

  /**
   * Detect the machine's RAM and return a recommended pool + model configuration.
   * Called once at initModel() time. Results logged for observability.
   *
   * Thresholds chosen in docs/SCALE_AND_EFFICIENCY.md §9 Phase 2.1:
   *   ≤ 10 GB  → E2B, pool=2   (E4B ~5GB weights won't fit comfortably on 8GB)
   *   ≤ 20 GB  → E4B, pool=4
   *   ≤ 40 GB  → E4B, pool=6
   *   > 40 GB  → E4B, pool=10
   */
  detectRecommendedPoolSize(): PoolSizingRecommendation {
    const totalRamGB = os.totalmem() / (1024 ** 3);
    let recommendedModel: 'E2B' | 'E4B';
    let maxPooledSessions: number;
    let notes: string;

    if (totalRamGB <= 10) {
      recommendedModel = 'E2B';
      maxPooledSessions = 2;
      notes = '8GB Mac detected: E4B (~5GB) would cause heavy swap; E2B recommended.';
    } else if (totalRamGB <= 20) {
      recommendedModel = 'E4B';
      maxPooledSessions = 4;
      notes = '16GB Mac detected: comfortable headroom for 4 warm sessions.';
    } else if (totalRamGB <= 40) {
      recommendedModel = 'E4B';
      maxPooledSessions = 6;
      notes = '32GB Mac detected: room for 6 warm sessions.';
    } else {
      recommendedModel = 'E4B';
      maxPooledSessions = 10;
      notes = '64GB+ Mac detected: room for 10+ warm sessions.';
    }

    return {
      totalRamGB: Math.round(totalRamGB * 10) / 10,
      recommendedModel,
      maxPooledSessions,
      contextSize: this.contextSize,
      notes,
    };
  }

  /**
   * Register a callback invoked immediately before a session is disposed from the pool.
   * Handlers run serially and their errors are caught & logged (not re-thrown).
   * AgentService uses this to summarize conversations before their KV cache is lost.
   */
  onSessionEvicted(handler: SessionEvictedHandler): void {
    this.onSessionEvictedHandlers.push(handler);
    log('debug', 'Session eviction handler registered', { handlerCount: this.onSessionEvictedHandlers.length });
  }

  /**
   * Internal: fire all eviction callbacks for the given chatGuid.
   * Runs synchronously (blocks the eviction path) but with per-handler
   * try/catch so no handler can break another. Async handlers are awaited
   * briefly (up to 200ms each) to give summarization a chance to grab
   * the conversation state before it's torn down; but eviction proceeds
   * regardless — we prefer to free RAM promptly.
   */
  private async fireEvictionHandlers(chatGuid: string, reason: 'lru' | 'idle_ttl' | 'manual' | 'error'): Promise<void> {
    if (this.onSessionEvictedHandlers.length === 0) return;
    for (const handler of this.onSessionEvictedHandlers) {
      try {
        // Fire-and-forget: handler is responsible for its own backgrounding if it needs more time.
        // We don't block eviction on slow summarization — handler should either be fast or schedule its own task.
        const result = handler(chatGuid, reason);
        if (result && typeof (result as any).catch === 'function') {
          (result as Promise<void>).catch(err => {
            log('warn', 'Session eviction handler threw asynchronously', {
              chatGuid, reason, error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      } catch (err) {
        log('warn', 'Session eviction handler threw synchronously', {
          chatGuid, reason, error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Phase 2.3: Start the idle TTL sweep. Safe to call multiple times (idempotent).
   * Stopped automatically on dispose().
   */
  private startIdleTtlSweep(): void {
    if (this.idleTtlTimer) return;
    this.idleTtlTimer = setInterval(() => this.sweepIdleSessions(), LocalLLMService.IDLE_TTL_SWEEP_MS);
    log('debug', 'Idle TTL sweep started', {
      ttlMs: LocalLLMService.IDLE_TTL_MS,
      sweepMs: LocalLLMService.IDLE_TTL_SWEEP_MS,
    });
  }

  private stopIdleTtlSweep(): void {
    if (this.idleTtlTimer) {
      clearInterval(this.idleTtlTimer);
      this.idleTtlTimer = null;
      log('debug', 'Idle TTL sweep stopped');
    }
  }

  /**
   * Phase 2.3: Remove sessions idle for > IDLE_TTL_MS. Fires eviction handlers first.
   * Exposed for testing; normally invoked by the sweep timer.
   */
  async sweepIdleSessions(): Promise<string[]> {
    const now = Date.now();
    const toEvict: string[] = [];
    for (const [key, entry] of this.sessionPool) {
      if (now - entry.lastActivity > LocalLLMService.IDLE_TTL_MS) {
        toEvict.push(key);
      }
    }
    if (toEvict.length === 0) return [];
    log('debug', 'Idle TTL sweep: evicting stale sessions', {
      count: toEvict.length,
      poolSize: this.sessionPool.size,
    });
    for (const key of toEvict) {
      await this.fireEvictionHandlers(key, 'idle_ttl');
      const entry = this.sessionPool.get(key);
      if (entry) {
        try { entry.session?.dispose?.(); } catch { /* non-fatal */ }
        this.sessionPool.delete(key);
      }
    }
    log('info', 'Idle TTL sweep completed', {
      evictedCount: toEvict.length,
      remainingPoolSize: this.sessionPool.size,
    });
    return toEvict;
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

      // Phase 2.1: Adapt pool size + context size to actual hardware BEFORE
      // creating the context. Logs the decision so operators can see what was picked.
      // User-configured contextSize (via settings) always wins over detected default.
      const recommendation = this.detectRecommendedPoolSize();
      const userConfiguredCtx = getSettingInt('model.contextSize', 0);
      if (userConfiguredCtx > 0) {
        this.contextSize = userConfiguredCtx;
        log('info', 'Using user-configured contextSize from settings', { contextSize: this.contextSize });
      }
      this.maxPooledSessions = recommendation.maxPooledSessions;
      log('info', 'Adaptive resource sizing applied', {
        totalRamGB: recommendation.totalRamGB,
        recommendedModel: recommendation.recommendedModel,
        maxPooledSessions: this.maxPooledSessions,
        contextSize: this.contextSize,
        notes: recommendation.notes,
      });

      // Phase 2.2: Always pass contextSize explicitly (previously only passed when != 8192,
      // letting node-llama-cpp auto-detect). Now we control memory deterministically.
      // Use sequences: maxPooledSessions so multiple conversations can batch inference.
      const ctxOpts: Record<string, any> = {
        sequences: this.maxPooledSessions,
        contextSize: this.contextSize,
      };
      try {
        this.context = await this.model.createContext(ctxOpts);
        log('info', 'Context created with parallel sequences', {
          sequences: this.maxPooledSessions,
          contextSize: this.contextSize,
        });
      } catch (ctxErr: any) {
        // If context creation fails (e.g. InsufficientMemoryError), retry with single sequence + smaller context
        if (ctxErr.name === 'InsufficientMemoryError' || ctxErr.message?.includes('memory')) {
          log('warn', 'Multi-sequence context failed, falling back to single sequence', { error: ctxErr.message });
          this.maxPooledSessions = 1;
          // Try again with smaller context first, then let node-llama-cpp auto-detect as last resort.
          const fallbackCtx = Math.min(this.contextSize, 2048);
          try {
            this.context = await this.model.createContext({ sequences: 1, contextSize: fallbackCtx });
            this.contextSize = fallbackCtx;
            log('info', 'Context created with single sequence + reduced context', { contextSize: fallbackCtx });
          } catch {
            this.context = await this.model.createContext({});
            log('warn', 'Context created with auto-detected size after fallback');
          }
        } else {
          throw ctxErr;
        }
      }

      // Phase 2.3: Start idle TTL sweep AFTER context is ready.
      this.startIdleTtlSweep();

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
   * Dispose all pooled sessions, freeing their context sequences.
   * Does NOT fire eviction handlers — used during full shutdown/reset where
   * summarization would be unsafe (model being disposed).
   */
  private disposeAllSessions(): void {
    const count = this.sessionPool.size;
    for (const [key, entry] of this.sessionPool) {
      try { entry.session?.dispose?.(); } catch { /* non-fatal */ }
    }
    this.sessionPool.clear();
    if (count > 0) log('debug', 'All pooled sessions disposed', { count });
  }

  /**
   * Evict a specific conversation's session from the pool (e.g. on conversation end).
   * Fires eviction handlers so registered consumers (e.g. auto-summarization) can run.
   */
  async evictSession(chatGuid: string): Promise<void> {
    const entry = this.sessionPool.get(chatGuid);
    if (entry) {
      await this.fireEvictionHandlers(chatGuid, 'manual');
      try { entry.session?.dispose?.(); } catch { /* non-fatal */ }
      this.sessionPool.delete(chatGuid);
      log('debug', 'Session evicted from pool', { chatGuid, reason: 'manual', poolSize: this.sessionPool.size });
    }
  }

  /**
   * Observability: current pool state. Used by metrics endpoint.
   */
  getPoolStats(): { size: number; maxSize: number; entries: Array<{ chatGuid: string; ageMs: number }> } {
    const now = Date.now();
    return {
      size: this.sessionPool.size,
      maxSize: this.maxPooledSessions,
      entries: Array.from(this.sessionPool.entries()).map(([chatGuid, entry]) => ({
        chatGuid,
        ageMs: now - entry.lastActivity,
      })),
    };
  }

  /**
   * Unload the model and free resources.
   */
  async dispose(): Promise<void> {
    try {
      this.stopIdleTtlSweep();
      this.disposeAllSessions();
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
    this.disposeAllSessions();
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

  /**
   * Phase 4.2: Generate a short summary from a transcript using an EPHEMERAL session.
   *
   * Differs from generateResponse() in important ways:
   *   - Does NOT register tools (summarizer model should never call tools)
   *   - Does NOT use the session pool (single-use, disposed immediately)
   *   - Does NOT contribute to rate limit counters (internal utility call)
   *   - Does NOT go through PromptBuilder (simpler system prompt)
   *
   * Returns the summary string, or null on failure. Non-throwing.
   */
  async generateSummary(
    transcript: string,
    options?: { maxTokens?: number; temperature?: number }
  ): Promise<{ content: string; durationMs: number } | null> {
    if (!this.model || !this.context) {
      try { await this.initModel(); } catch { return null; }
      if (!this.model || !this.context) return null;
    }

    const maxTokens = options?.maxTokens ?? 220;
    const temperature = options?.temperature ?? 0.3; // lower temp for consistent summaries
    const systemPrompt =
      'You are a concise conversation summarizer. Read the transcript and write a single 2-3 sentence ' +
      'note-to-self that captures key topics, commitments, and notable facts about the person. ' +
      'Respond with ONLY the summary text. No preamble, no markdown, no formatting.';

    const userPrompt =
      `Summarize this conversation transcript:\n\n${transcript}\n\nSummary:`;

    const startedAt = Date.now();
    let session: any = null;
    try {
      const { LlamaChatSession } = await this.getLlamaModule();

      // Acquire a fresh sequence. If the context is full, we'll need to evict
      // the least-recently-used session first (same path as normal generation).
      // For simplicity and safety, we grab a sequence the same way generateResponse does.
      if (!this.context) return null;

      session = new LlamaChatSession({
        contextSequence: this.context.getSequence(),
        systemPrompt,
      });

      // Tight inference timeout — summarization must not hang the agent
      const abortController = new AbortController();
      const timeoutMs = 30_000;
      const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

      let content: string;
      try {
        content = await session.prompt(userPrompt, {
          maxTokens,
          temperature,
          signal: abortController.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const trimmed = (content || '').trim();
      if (!trimmed) {
        log('warn', 'generateSummary produced empty output', { durationMs: Date.now() - startedAt });
        return null;
      }

      return { content: trimmed, durationMs: Date.now() - startedAt };
    } catch (err) {
      log('warn', 'generateSummary failed', {
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      });
      return null;
    } finally {
      // Ephemeral session — always dispose to free its sequence
      try { session?.dispose?.(); } catch { /* non-fatal */ }
    }
  }

  /**
   * Phase 2C: Extract concrete user facts from a transcript using an ephemeral session.
   *
   * Mirrors generateSummary's safety properties (no tools, no pool, no PromptBuilder,
   * tight 30s timeout). The model is asked for a JSON array of short fact strings.
   *
   * Returns an array of de-duplicated fact strings, or [] on failure / no facts.
   * Never throws.
   */
  async extractFactsFromTranscript(
    transcript: string,
    options?: { maxTokens?: number; temperature?: number }
  ): Promise<string[]> {
    if (!this.model || !this.context) {
      try { await this.initModel(); } catch { return []; }
      if (!this.model || !this.context) return [];
    }

    const maxTokens = options?.maxTokens ?? 300;
    const temperature = options?.temperature ?? 0.2;
    const systemPrompt =
      'You extract concrete personal facts about the user from a conversation. ' +
      'Return ONLY a JSON array of short strings. Each string is one fact (e.g. ' +
      '"name is Alex", "works at Google", "lives in NYC", "likes oat milk lattes"). ' +
      'Only include facts explicitly stated by the user. Return [] if none. ' +
      'No preamble, no markdown, no explanation — JUST the JSON array.';
    const userPrompt =
      `Conversation transcript:\n\n${transcript}\n\nFacts JSON array:`;

    let session: any = null;
    try {
      const { LlamaChatSession } = await this.getLlamaModule();
      if (!this.context) return [];

      session = new LlamaChatSession({
        contextSequence: this.context.getSequence(),
        systemPrompt,
      });

      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 30_000);

      let raw: string;
      try {
        raw = await session.prompt(userPrompt, {
          maxTokens,
          temperature,
          signal: abortController.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      return this.parseFactsJson(raw);
    } catch (err) {
      log('warn', 'extractFactsFromTranscript failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    } finally {
      try { session?.dispose?.(); } catch { /* non-fatal */ }
    }
  }

  /**
   * Parse the LLM's JSON-array response into a de-duplicated list of facts.
   * Tolerates common LLM artifacts: leading prose, markdown fences, trailing text.
   * Caps each fact length and total count to avoid runaway output.
   */
  private parseFactsJson(raw: string): string[] {
    if (!raw) return [];
    // Strip common fences / preambles
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

    // Find the first JSON array in the string
    const match = cleaned.match(/\[[\s\S]*?\]/);
    if (!match) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }

    if (!Array.isArray(parsed)) return [];

    const MAX_FACTS = 10;
    const MAX_LEN = 200;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== 'string') continue;
      const trimmed = item.trim().slice(0, MAX_LEN);
      if (trimmed.length < 3) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
      if (out.length >= MAX_FACTS) break;
    }
    return out;
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

    // Resolve chatGuid for session pooling — reuse existing session if same conversation
    const chatGuid = toolContext?.chatGuid || '';

    try {
      const { LlamaChatSession, defineChatSessionFunction } = await this.getLlamaModule();

      // Build system prompt
      const finalSystemPrompt = systemPrompt || promptBuilder.build(promptContext || { date: new Date().toLocaleString() });

      // Ensure context exists (always pass contextSize explicitly per Phase 2.2)
      if (!this.context) {
        const ctxOpts: Record<string, any> = {
          sequences: this.maxPooledSessions,
          contextSize: this.contextSize,
        };
        this.context = await this.model!.createContext(ctxOpts);
      }

      // --- Session pooling ---
      // Reuse a live session for this conversation if available. The KV cache
      // already contains all prior turns, so only the new message is processed.
      // If no session exists, create one and populate it with history.
      let session: any;
      let isReusedSession = false;
      const poolEntry = chatGuid ? this.sessionPool.get(chatGuid) : undefined;

      if (poolEntry) {
        session = poolEntry.session;
        poolEntry.lastActivity = Date.now();
        isReusedSession = true;
        log('debug', 'Reusing pooled session', { chatGuid, poolSize: this.sessionPool.size });
      } else {
        // Evict least-recently-used session if pool is full
        if (this.sessionPool.size >= this.maxPooledSessions) {
          let oldestKey: string | null = null;
          let oldestTime = Infinity;
          for (const [key, entry] of this.sessionPool) {
            if (entry.lastActivity < oldestTime) {
              oldestTime = entry.lastActivity;
              oldestKey = key;
            }
          }
          if (oldestKey) {
            // Phase 4.2: fire eviction handlers BEFORE disposing so summarization can run
            await this.fireEvictionHandlers(oldestKey, 'lru');
            const evicted = this.sessionPool.get(oldestKey);
            try { evicted?.session?.dispose?.(); } catch { /* non-fatal */ }
            this.sessionPool.delete(oldestKey);
            log('debug', 'Evicted LRU session from pool', {
              evictedChat: oldestKey,
              reason: 'lru',
              poolSize: this.sessionPool.size,
            });
          }
        }

        // Create new session with a fresh sequence from the context
        session = new LlamaChatSession({
          contextSequence: this.context.getSequence(),
          systemPrompt: finalSystemPrompt,
        });

        // Pre-populate conversation history so model has context of prior turns
        if (conversationHistory.length > 0) {
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
            log('warn', 'setChatHistory failed, using system prompt only');
          }
        }

        // Add to pool
        if (chatGuid) {
          this.sessionPool.set(chatGuid, {
            session,
            lastActivity: Date.now(),
            chatGuid,
            systemPrompt: finalSystemPrompt,
          });
        }

        log('debug', 'Created new pooled session', { chatGuid, poolSize: this.sessionPool.size, isReusedSession });
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

      // Generate response with tool support + inference timeout
      const startTime = Date.now();
      const abortController = new AbortController();
      const inferenceTimeoutMs = 90_000; // 90-second hard limit
      const timeoutId = setTimeout(() => abortController.abort(), inferenceTimeoutMs);

      let response: string;
      try {
        response = await session.prompt(userMessage, {
          maxTokens: this.maxTokens,
          temperature: this.temperature,
          functions: Object.keys(toolFunctions).length > 0 ? toolFunctions : undefined,
          maxParallelFunctionCalls: 1,
          signal: abortController.signal,
        });
      } catch (promptErr: any) {
        clearTimeout(timeoutId);
        const isTimeout = promptErr.name === 'AbortError' || promptErr.message?.includes('abort');
        const isMemory = promptErr.name === 'InsufficientMemoryError' || promptErr.message?.includes('memory');
        if (isTimeout || isMemory) {
          log('warn', `Inference ${isTimeout ? 'timed out' : 'ran out of context memory'}, recycling context`, {
            durationMs: Date.now() - startTime,
          });
        }
        // Dispose failed session and remove from pool
        try { session.dispose?.(); } catch { /* non-fatal */ }
        if (chatGuid) this.sessionPool.delete(chatGuid);
        // Recycle full context on memory/timeout errors
        if (isTimeout || isMemory) {
          this.disposeAllSessions();
          try { await this.context?.dispose?.(); } catch { /* non-fatal */ }
          this.context = null;
        }
        throw promptErr;
      }
      clearTimeout(timeoutId);
      const durationMs = Date.now() - startTime;

      // --- Tool-call artifact sanitization (Gemma 4 workaround) ---
      // Gemma 4 sometimes emits tool-call tokens as plain text instead of
      // invoking the registered function API.  We STRIP these from the user-
      // facing response so they don't leak into iMessage.  We no longer try
      // to execute them — see docs/RELIABILITY_IMPLEMENTATION.md §3 P0.3.
      response = this.sanitizeToolCallArtifacts(response);

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
        isReusedSession,
        poolSize: this.sessionPool.size,
        responsePreview: response.substring(0, 150) || '(empty)',
      });

      // Update pool entry activity timestamp (session stays alive for next message)
      if (chatGuid && this.sessionPool.has(chatGuid)) {
        this.sessionPool.get(chatGuid)!.lastActivity = Date.now();
      }

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
  // Tool-call artifact sanitization  (Gemma 4 workaround)
  // ---------------------------------------------------------------------------
  // Gemma 4 sometimes bypasses node-llama-cpp's function-calling API and emits
  // tool calls as plain text. We strip these artifacts from the user-facing
  // response. We do NOT try to execute them — see the 11-hour trial analysis
  // in docs/RELIABILITY_IMPLEMENTATION.md §2 (root cause) and §3 P0.3.
  //
  // Patterns recognized:
  //   1. <|tool_call>...<tool_call|>      (delimited, both pipe variants)
  //   2. ```tool_code\n...\n```           (Gemma fenced tool-code blocks)
  //   3. bare "name(arg: value)" on its   (whole-line match, known tool
  //      own line for known tool names     names only — avoids prose false
  //      listed in TOOL_NAMES              positives like "wait a minute")
  //   4. <|"|">, <|eos|>, <|...|>          (residual special-token leaks)
  // ---------------------------------------------------------------------------

  // Known tool names that might leak. When removing a tool, keep its name
  // here for a release or two as a regression guard against stale model
  // behavior (e.g. `react_to_message` was removed in P0.1 but Gemma may
  // still emit it until the next retrain).
  private static readonly TOOL_NAMES = [
    'wait',
    'save_user_fact',
    'get_user_facts',
    'search_history',
    'set_reminder',
    'create_trigger',
    'react_to_message', // removed tool — keep as regression scrub
  ];

  private static readonly TOOL_NAME_ALT = LocalLLMService.TOOL_NAMES.join('|');

  static readonly RAW_TOOL_CALL_PATTERNS: RegExp[] = [
    // 1. Delimited tool calls — greedy across both pipe variants
    /<\|?\/?tool_call\|?>[\s\S]*?<\|?\/?tool_call\|?>/gi,
    // 2. Gemma-style fenced tool_code blocks
    /```tool_code\b[\s\S]*?```/gi,
    // 3. Bare tool-call lines — only match a whole line that is JUST a known
    //    tool-name invocation. The `^ ... $` with `m` flag anchors to line
    //    start/end so prose containing the same words (e.g. "please wait")
    //    is not matched.
    new RegExp(
      `^\\s*(?:call:\\s*)?(?:${LocalLLMService.TOOL_NAME_ALT})\\s*\\([^\\n]*\\)\\s*$`,
      'gm'
    ),
    // 4. Stray delimiter markers left behind when the block was malformed
    /<\|?\/?tool_call\|?>/gi,
  ];

  // Gemma 4 <|"|"> token-leak artifact (llama.cpp #21316)
  static readonly TOKEN_LEAK_PATTERN = /<\|"\|>/g;

  /**
   * Strip tool-call syntax artifacts from a model response before it is
   * delivered to the user. Sanitize-only — does NOT execute tools.
   */
  sanitizeToolCallArtifacts(response: string): string {
    if (!response || response.length === 0) return response;

    let cleaned = response;
    let anyDetected = false;

    for (const pattern of LocalLLMService.RAW_TOOL_CALL_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(cleaned)) {
        pattern.lastIndex = 0;
        cleaned = cleaned.replace(pattern, '');
        anyDetected = true;
      }
    }

    // Residual Gemma 4 <|"|"> token leaks
    if (LocalLLMService.TOKEN_LEAK_PATTERN.test(cleaned)) {
      LocalLLMService.TOKEN_LEAK_PATTERN.lastIndex = 0;
      cleaned = cleaned.replace(LocalLLMService.TOKEN_LEAK_PATTERN, '');
      anyDetected = true;
    }

    // Generic leaked special tokens like <|eos|>, <|bos|>, etc.
    const genericTokenPattern = /<\|[a-z_]*\|>/gi;
    if (genericTokenPattern.test(cleaned)) {
      genericTokenPattern.lastIndex = 0;
      cleaned = cleaned.replace(genericTokenPattern, '');
      anyDetected = true;
    }

    // Normalize whitespace left behind
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

    if (anyDetected) {
      log('info', 'Tool-call artifacts stripped from response', {
        originalLength: response.length,
        cleanedLength: cleaned.length,
      });
    }

    return cleaned;
  }
}

// Singleton instance
export const localLLMService = new LocalLLMService();
