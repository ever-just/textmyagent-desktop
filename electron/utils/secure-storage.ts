import { safeStorage, app, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';

interface SecureData {
  [key: string]: string;
}

const STORAGE_FILE = 'secure-data.enc';

// In-memory cache to avoid repeated disk reads (fixes D6)
let cachedData: SecureData | null = null;

// Guard against double IPC registration (fixes A11)
let ipcRegistered = false;

function getStoragePath(): string {
  return path.join(app.getPath('userData'), STORAGE_FILE);
}

function loadSecureData(): SecureData {
  // Return cached data if available (fixes D6)
  if (cachedData !== null) return cachedData;

  const storagePath = getStoragePath();

  if (!fs.existsSync(storagePath)) {
    cachedData = {};
    return cachedData;
  }

  try {
    const encryptedBuffer = fs.readFileSync(storagePath);

    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[SecureStorage] ⚠️ WARNING: Encryption not available! API keys stored as PLAINTEXT.');
      console.warn('[SecureStorage] This is a security risk. Ensure keychain access is available.');
      cachedData = JSON.parse(encryptedBuffer.toString()) as SecureData;
      return cachedData;
    }

    const decrypted = safeStorage.decryptString(encryptedBuffer);
    cachedData = JSON.parse(decrypted) as SecureData;
    return cachedData;
  } catch (error) {
    console.error('[SecureStorage] Failed to load secure data:', error);
    cachedData = {};
    return cachedData;
  }
}

function saveSecureData(data: SecureData): void {
  const storagePath = getStoragePath();
  const jsonString = JSON.stringify(data);

  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(jsonString);
      fs.writeFileSync(storagePath, encrypted, { mode: 0o600 });
    } else {
      console.warn('[SecureStorage] ⚠️ Encryption not available, storing plaintext with restricted permissions');
      fs.writeFileSync(storagePath, jsonString, { mode: 0o600 });
    }
    // Update cache after successful write (fixes C4 race condition)
    cachedData = { ...data };
  } catch (error) {
    console.error('[SecureStorage] Failed to save secure data:', error);
    throw error;
  }
}

// Public API
export function getSecureValue(key: string): string | null {
  const data = loadSecureData();
  return data[key] ?? null;
}

export function setSecureValue(key: string, value: string): void {
  const data = loadSecureData();
  data[key] = value;
  saveSecureData(data);
}

export function deleteSecureValue(key: string): void {
  const data = loadSecureData();
  delete data[key];
  saveSecureData(data);
}

export function hasSecureValue(key: string): boolean {
  const data = loadSecureData();
  return key in data;
}

// Convenience functions
export const SecureStorage = {
  // Local model config
  getModelPath: () => getSecureValue('LOCAL_MODEL_PATH'),
  setModelPath: (modelPath: string) => {
    if (!modelPath || typeof modelPath !== 'string' || modelPath.trim().length === 0) {
      throw new Error('Model path cannot be empty');
    }
    setSecureValue('LOCAL_MODEL_PATH', modelPath.trim());
  },
  hasModelPath: () => hasSecureValue('LOCAL_MODEL_PATH'),

  // Check if local model is configured (iMessage access is checked separately via iMessageService)
  isConfigured: () => {
    return hasSecureValue('LOCAL_MODEL_PATH');
  },

  clearAll: () => {
    const storagePath = getStoragePath();
    if (fs.existsSync(storagePath)) {
      fs.unlinkSync(storagePath);
    }
    cachedData = null;
  },
};

// Setup IPC handlers for secure storage
export function setupSecureStorageIPC(): void {
  // Guard against double registration which throws in Electron (fixes A11)
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle('secure-storage:get', (_event, key: string) => {
    switch (key) {
      case 'LOCAL_MODEL_PATH':
        return SecureStorage.getModelPath();
      default:
        return null;
    }
  });

  ipcMain.handle('secure-storage:set', (_event, key: string, value: string) => {
    switch (key) {
      case 'LOCAL_MODEL_PATH':
        try {
          SecureStorage.setModelPath(value);
          return true;
        } catch {
          return false;
        }
      default:
        return false;
    }
  });

  ipcMain.handle('secure-storage:is-configured', () => {
    return SecureStorage.isConfigured();
  });
}
