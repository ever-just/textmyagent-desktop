/**
 * Tests for LocalLLMService — model download, load, state transitions, and error handling.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockLog = vi.fn();
vi.mock('../../logger', () => ({
  log: (...args: any[]) => mockLog(...args),
}));

vi.mock('../../database', () => ({
  getDatabase: () => ({}),
  getSettingInt: (_k: string, d: number) => d,
  getSettingFloat: (_k: string, d: number) => d,
  getSettingBool: (_k: string, d: boolean) => d,
  recordApiUsage: vi.fn(),
}));

// Mock fs
const mockExistsSync = vi.fn().mockReturnValue(false);
const mockReaddirSync = vi.fn().mockReturnValue([]);
const mockMkdirSync = vi.fn();
vi.mock('fs', () => ({
  default: {
    existsSync: (...args: any[]) => mockExistsSync(...args),
    readdirSync: (...args: any[]) => mockReaddirSync(...args),
    mkdirSync: (...args: any[]) => mockMkdirSync(...args),
  },
  existsSync: (...args: any[]) => mockExistsSync(...args),
  readdirSync: (...args: any[]) => mockReaddirSync(...args),
  mkdirSync: (...args: any[]) => mockMkdirSync(...args),
}));

// Mock electron
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-app-data' },
}));

// Mock secure-storage
vi.mock('../../../utils/secure-storage', () => ({
  SecureStorage: {
    setModelPath: vi.fn(),
    getModelPath: vi.fn().mockReturnValue(null),
  },
}));

// Mock node-llama-cpp dynamic import
const mockLoadModel = vi.fn();
const mockCreateContext = vi.fn();
const mockGetLlama = vi.fn();
const mockCreateModelDownloader = vi.fn();
const mockModelDispose = vi.fn();
const mockContextDispose = vi.fn();
const mockLlamaDispose = vi.fn();

const mockLlamaInstance = {
  loadModel: mockLoadModel,
  dispose: mockLlamaDispose,
};

const mockModelInstance = {
  createContext: mockCreateContext,
  dispose: mockModelDispose,
};

const mockContextInstance = {
  getSequence: vi.fn(),
  dispose: mockContextDispose,
};

// We need to patch the dynamic import
let service: any;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('LocalLLMService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);

    mockGetLlama.mockResolvedValue(mockLlamaInstance);
    mockLoadModel.mockResolvedValue(mockModelInstance);
    mockCreateContext.mockResolvedValue(mockContextInstance);

    // Fresh import each test to reset singleton state
    vi.resetModules();

    // Re-apply mocks after resetModules
    vi.doMock('../../logger', () => ({
      log: (...args: any[]) => mockLog(...args),
    }));
    vi.doMock('../../database', () => ({
      getDatabase: () => ({}),
      getSettingInt: (_k: string, d: number) => d,
      getSettingFloat: (_k: string, d: number) => d,
      getSettingBool: (_k: string, d: boolean) => d,
      recordApiUsage: vi.fn(),
    }));
    vi.doMock('fs', () => ({
      default: {
        existsSync: (...args: any[]) => mockExistsSync(...args),
        readdirSync: (...args: any[]) => mockReaddirSync(...args),
        mkdirSync: (...args: any[]) => mockMkdirSync(...args),
      },
      existsSync: (...args: any[]) => mockExistsSync(...args),
      readdirSync: (...args: any[]) => mockReaddirSync(...args),
      mkdirSync: (...args: any[]) => mockMkdirSync(...args),
    }));
    vi.doMock('electron', () => ({
      app: { getPath: () => '/tmp/test-app-data' },
    }));
    vi.doMock('../../../utils/secure-storage', () => ({
      SecureStorage: {
        setModelPath: vi.fn(),
        getModelPath: vi.fn().mockReturnValue(null),
      },
    }));

    const mod = await import('../LocalLLMService');
    service = new mod.LocalLLMService();

    // Patch getLlamaModule to avoid real dynamic import
    (service as any).getLlamaModule = vi.fn().mockResolvedValue({
      getLlama: mockGetLlama,
      createModelDownloader: mockCreateModelDownloader,
      LlamaChatSession: vi.fn(),
      defineChatSessionFunction: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Status & initial state
  // =========================================================================
  describe('initial state', () => {
    it('should start with not_downloaded status', () => {
      expect(service.status).toBe('not_downloaded');
    });

    it('should have 0 download progress', () => {
      expect(service.downloadProgress).toBe(0);
    });

    it('should have null error message', () => {
      expect(service.errorMessage).toBeNull();
    });

    it('should not be configured', () => {
      expect(service.isConfigured()).toBe(false);
    });
  });

  // =========================================================================
  // getModelsDir
  // =========================================================================
  describe('getModelsDir', () => {
    it('should return models dir under userData', () => {
      const dir = service.getModelsDir();
      expect(dir).toContain('models');
    });
  });

  // =========================================================================
  // isModelDownloaded
  // =========================================================================
  describe('isModelDownloaded', () => {
    it('should return false when no model files exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(service.isModelDownloaded()).toBe(false);
    });

    it('should return true when model file exists', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('models')) return true;
        if (p.endsWith('.gguf')) return true;
        return true;
      });
      mockReaddirSync.mockReturnValue(['model.gguf']);
      expect(service.isModelDownloaded()).toBe(true);
    });
  });

  // =========================================================================
  // getModelFilePath
  // =========================================================================
  describe('getModelFilePath', () => {
    it('should return first .gguf file if models dir exists', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['foo.gguf', 'bar.gguf']);
      const p = service.getModelFilePath();
      expect(p).toContain('foo.gguf');
    });

    it('should return default filename when no .gguf files', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);
      const p = service.getModelFilePath();
      expect(p).toContain('gemma-4-e4b-it-Q4_K_M.gguf');
    });

    it('should return default filename when models dir missing', () => {
      mockExistsSync.mockReturnValue(false);
      const p = service.getModelFilePath();
      expect(p).toContain('gemma-4-e4b-it-Q4_K_M.gguf');
    });
  });

  // =========================================================================
  // initModel — state transitions
  // =========================================================================
  describe('initModel', () => {
    it('should transition to loaded state on success', async () => {
      // Model file must exist
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['model.gguf']);

      await service.initModel();
      expect(service.status).toBe('loaded');
      expect(service.isConfigured()).toBe(true);
      expect(service.errorMessage).toBeNull();
    });

    it('should transition to error state on failure', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['model.gguf']);
      mockLoadModel.mockRejectedValueOnce(new Error('GPU out of memory'));

      await expect(service.initModel()).rejects.toThrow('GPU out of memory');
      expect(service.status).toBe('error');
      expect(service.errorMessage).toBe('GPU out of memory');
      expect(service.isConfigured()).toBe(false);
    });

    it('should set not_downloaded when model file missing', async () => {
      mockExistsSync.mockReturnValue(false);
      mockReaddirSync.mockReturnValue([]);

      await expect(service.initModel()).rejects.toThrow('Model file not found');
      expect(service.status).toBe('not_downloaded');
    });

    it('should clear error message on retry', async () => {
      // First attempt fails
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['model.gguf']);
      mockLoadModel.mockRejectedValueOnce(new Error('first error'));
      await expect(service.initModel()).rejects.toThrow('first error');
      expect(service.errorMessage).toBe('first error');

      // Second attempt succeeds
      mockLoadModel.mockResolvedValueOnce(mockModelInstance);
      await service.initModel();
      expect(service.errorMessage).toBeNull();
      expect(service.status).toBe('loaded');
    });

    it('should skip if already initialized', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['model.gguf']);

      await service.initModel();
      expect(mockGetLlama).toHaveBeenCalledTimes(1);

      // Second call should be a no-op
      await service.initModel();
      expect(mockGetLlama).toHaveBeenCalledTimes(1);
    });

    it('should prevent concurrent loads (guard)', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['model.gguf']);

      // Make loadModel slow
      let resolveLoad: () => void;
      const loadPromise = new Promise<typeof mockModelInstance>((resolve) => {
        resolveLoad = () => resolve(mockModelInstance);
      });
      mockLoadModel.mockReturnValue(loadPromise);

      // Fire two concurrent initModel calls
      const p1 = service.initModel();
      const p2 = service.initModel();

      // Both should resolve to the same underlying promise
      resolveLoad!();
      await Promise.all([p1, p2]);

      // getLlama should only have been called once
      expect(mockGetLlama).toHaveBeenCalledTimes(1);
      expect(mockLoadModel).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // downloadModel — state transitions
  // =========================================================================
  describe('downloadModel', () => {
    it('should transition through downloading → ready', async () => {
      const mockDownloaderResult = '/tmp/test-app-data/models/model.gguf';
      const mockDownloadFn = vi.fn().mockResolvedValue(mockDownloaderResult);
      mockCreateModelDownloader.mockResolvedValue({
        entrypointFilename: 'model.gguf',
        totalSize: 5000000000,
        download: mockDownloadFn,
      });

      const progressCb = vi.fn();
      const result = await service.downloadModel(progressCb);

      expect(result).toBe(mockDownloaderResult);
      expect(service.status).toBe('ready');
      expect(service.downloadProgress).toBe(100);
      expect(service.errorMessage).toBeNull();
    });

    it('should set error state on download failure', async () => {
      mockCreateModelDownloader.mockRejectedValue(new Error('Network error'));

      await expect(service.downloadModel()).rejects.toThrow('Network error');
      expect(service.status).toBe('error');
      expect(service.errorMessage).toBe('Network error');
    });

    it('should create models directory if missing', async () => {
      mockExistsSync.mockReturnValue(false);
      mockCreateModelDownloader.mockResolvedValue({
        entrypointFilename: 'model.gguf',
        totalSize: 1000,
        download: vi.fn().mockResolvedValue('/tmp/model.gguf'),
      });

      await service.downloadModel();
      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('models'), { recursive: true });
    });

    it('should track progress via callback', async () => {
      let capturedOnProgress: any;
      mockCreateModelDownloader.mockImplementation(async (opts: any) => {
        capturedOnProgress = opts.onProgress;
        return {
          entrypointFilename: 'model.gguf',
          totalSize: 1000,
          download: vi.fn().mockResolvedValue('/tmp/model.gguf'),
        };
      });

      const progressCb = vi.fn();
      await service.downloadModel(progressCb);

      // Simulate progress callback
      if (capturedOnProgress) {
        capturedOnProgress({ downloadedSize: 500, totalSize: 1000 });
        expect(service.downloadProgress).toBe(50);
        expect(progressCb).toHaveBeenCalledWith(50, expect.any(Number), expect.any(Number));
      }
    });
  });

  // =========================================================================
  // dispose
  // =========================================================================
  describe('dispose', () => {
    it('should dispose context, model, and llama', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['model.gguf']);
      await service.initModel();

      await service.dispose();
      expect(mockContextDispose).toHaveBeenCalled();
      expect(mockModelDispose).toHaveBeenCalled();
      expect(mockLlamaDispose).toHaveBeenCalled();
      expect(service.isConfigured()).toBe(false);
    });

    it('should set status back to ready if model file exists', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['model.gguf']);
      await service.initModel();

      await service.dispose();
      expect(service.status).toBe('ready');
    });

    it('should set status to not_downloaded if model file missing', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['model.gguf']);
      await service.initModel();

      // After dispose, model file "no longer exists"
      mockExistsSync.mockReturnValue(false);
      mockReaddirSync.mockReturnValue([]);

      await service.dispose();
      expect(service.status).toBe('not_downloaded');
    });
  });

  // =========================================================================
  // refreshClient
  // =========================================================================
  describe('refreshClient', () => {
    it('should reset initialized state', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['model.gguf']);
      await service.initModel();
      expect(service.isConfigured()).toBe(true);

      service.refreshClient();
      expect(service.isConfigured()).toBe(false);
    });
  });

  // =========================================================================
  // Settings
  // =========================================================================
  describe('settings', () => {
    it('should update maxTokens', () => {
      service.setMaxTokens(2048);
      // Access private field via bracket notation
      expect((service as any).maxTokens).toBe(2048);
    });

    it('should update temperature', () => {
      service.setTemperature(0.5);
      expect((service as any).temperature).toBe(0.5);
    });

    it('should update contextSize', () => {
      service.setContextSize(16384);
      expect((service as any).contextSize).toBe(16384);
    });

    it('should update gpuLayers', () => {
      service.setGpuLayers(32);
      expect((service as any).gpuLayers).toBe(32);
    });
  });
});
