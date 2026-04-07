import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  getSystemTheme: () => ipcRenderer.invoke('get-system-theme'),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),

  // Window controls
  showWindow: () => ipcRenderer.invoke('show-window'),
  quitApp: () => ipcRenderer.invoke('quit-app'),

  // Secure storage
  getSecureValue: (key: string) => ipcRenderer.invoke('secure-storage:get', key),
  setSecureValue: (key: string, value: string) =>
    ipcRenderer.invoke('secure-storage:set', key, value),
  isConfigured: () => ipcRenderer.invoke('secure-storage:is-configured'),

  // Permissions
  checkPermission: (permission: string) =>
    ipcRenderer.invoke('permissions:check', permission),
  requestPermission: (permission: string) =>
    ipcRenderer.invoke('permissions:request', permission),

  // Event listeners (return cleanup functions to prevent listener stacking — fixes E6)
  onBackendPort: (callback: (port: number) => void) => {
    const handler = (_event: any, port: number) => callback(port);
    ipcRenderer.on('backend-port', handler);
    return () => ipcRenderer.removeListener('backend-port', handler);
  },
  onNavigate: (callback: (path: string) => void) => {
    const handler = (_event: any, path: string) => callback(path);
    ipcRenderer.on('navigate', handler);
    return () => ipcRenderer.removeListener('navigate', handler);
  },
  onUpdateAvailable: (callback: (info: any) => void) => {
    const handler = (_event: any, info: any) => callback(info);
    ipcRenderer.on('update-available', handler);
    return () => ipcRenderer.removeListener('update-available', handler);
  },
  onUpdateDownloaded: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('update-downloaded', handler);
    return () => ipcRenderer.removeListener('update-downloaded', handler);
  },

  // Auto-update
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
});

// Type definitions for the exposed API
declare global {
  interface Window {
    electronAPI: {
      getAppInfo: () => Promise<{
        version: string;
        name: string;
        isPackaged: boolean;
        platform: string;
        arch: string;
        backendPort: number | null;
      }>;
      getSystemTheme: () => Promise<'dark' | 'light'>;
      getUserDataPath: () => Promise<string>;
      showWindow: () => Promise<void>;
      quitApp: () => Promise<void>;
      getSecureValue: (key: string) => Promise<string | null>;
      setSecureValue: (key: string, value: string) => Promise<boolean>;
      isConfigured: () => Promise<boolean>;
      checkPermission: (permission: string) => Promise<boolean>;
      requestPermission: (permission: string) => Promise<boolean>;
      onBackendPort: (callback: (port: number) => void) => () => void;
      onNavigate: (callback: (path: string) => void) => () => void;
      onUpdateAvailable: (callback: (info: any) => void) => () => void;
      onUpdateDownloaded: (callback: () => void) => () => void;
      checkForUpdates: () => Promise<void>;
      downloadUpdate: () => Promise<void>;
      installUpdate: () => Promise<void>;
    };
  }
}
