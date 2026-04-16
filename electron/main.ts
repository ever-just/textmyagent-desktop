import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  nativeTheme,
  powerMonitor,
  Menu,
} from 'electron';
import path from 'path';
import { startBackendServer, stopBackendServer } from './backend/server';
import { initializeDatabase, closeDatabase, seedDefaultSettings } from './backend/database';
import { registerAllTools } from './backend/tools';
import { createTray, destroyTray } from './utils/tray';
import { setupAutoUpdater } from './utils/auto-updater';

// Global references
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let backendPort: number | null = null;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('Another instance is running, quitting...');
  app.quit();
} else {
  app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Create main window
function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,

    // macOS styling
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    vibrancy: 'under-window',
    visualEffectState: 'active',

    // Window behavior
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#ffffff',

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Load content
  if (app.isPackaged) {
    // In packaged app, serve dashboard through the embedded Express server
    // This avoids file:// protocol issues with relative paths
    console.log('[Main] Loading dashboard from backend server on port:', backendPort);
    mainWindow.loadURL(`http://127.0.0.1:${backendPort || 3001}/`);
  } else {
    // In dev mode, try to connect to Next.js dev server
    // Fall back to a simple status page if not available
    mainWindow.loadURL('http://localhost:3000').catch(() => {
      console.log('[Main] Next.js dev server not running, loading fallback');
      mainWindow?.loadURL(`http://127.0.0.1:${backendPort || 3001}/api/health`);
    });
    mainWindow.webContents.openDevTools();
  }

  // Show when ready (prevents white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Handle close (minimize to tray instead)
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // Handle external links — validate URL scheme before opening (fixes A5)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(url);
      } else {
        console.warn('[Main] Blocked openExternal for non-http URL:', url);
      }
    } catch {
      console.warn('[Main] Blocked openExternal for invalid URL:', url);
    }
    return { action: 'deny' };
  });

  // Prevent navigation away from the app (security hardening)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = [
      `http://127.0.0.1:${backendPort}`,
      `http://localhost:${backendPort}`,
      'http://localhost:3000',
    ];
    if (!allowed.some(prefix => url.startsWith(prefix))) {
      event.preventDefault();
      console.warn('[Main] Blocked navigation to:', url);
    }
  });

  // Pass backend port to renderer
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send('backend-port', backendPort);
  });
}

// App ready
app.whenReady().then(async () => {
  console.log('App ready, initializing...');

  try {
    // Request Contacts permission on startup (triggers system prompt if not determined)
    try {
      const macContacts = require('node-mac-contacts');
      const authStatus = macContacts.getAuthStatus();
      console.log('[Main] Contacts permission status:', authStatus);
      
      if (authStatus === 'Not Determined') {
        console.log('[Main] Requesting Contacts permission...');
        const granted = macContacts.requestAccess();
        console.log('[Main] Contacts permission granted:', granted);
      }
    } catch (e) {
      console.log('[Main] Could not check Contacts permission:', e);
    }

    // Initialize database
    initializeDatabase();
    seedDefaultSettings();
    registerAllTools();

    // Start backend server
    backendPort = await startBackendServer({ port: 3001 });

    // Create main window
    createMainWindow();

    // Create tray icon
    if (mainWindow) {
      createTray(mainWindow);
    }

    // Setup auto-updater (only in production)
    if (app.isPackaged && mainWindow) {
      setupAutoUpdater(mainWindow);
    }

    // macOS: Handle reopen (fixes G2 — validate backend is still running)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        if (backendPort) {
          createMainWindow();
        } else {
          console.warn('[Main] Cannot create window — backend port not available');
        }
      } else {
        mainWindow?.show();
      }
    });

    console.log('App initialization complete');
  } catch (error) {
    console.error('Failed to initialize app:', error);
    app.quit();
  }
});

// Quit handling
app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', async (event) => {
  event.preventDefault();

  console.log('App quitting, cleaning up...');

  try {
    // Stop agent and dispose local model before closing server/database
    try {
      const { agentService } = require('./backend/services/AgentService');
      await agentService.stop();
    } catch (_e) {
      // Agent may not have been started
    }
    try {
      const { localLLMService } = require('./backend/services/LocalLLMService');
      await localLLMService.dispose();
    } catch (_e) {
      // Model may not have been loaded
    }
    await stopBackendServer();
    closeDatabase();
    destroyTray();
  } catch (error) {
    console.error('Error during cleanup:', error);
  }

  app.exit(0);
});

// Window all closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Power events — pause/resume agent to avoid stale DB connections (fixes G1)
powerMonitor.on('suspend', () => {
  console.log('[Main] System suspending, pausing agent...');
  const { agentService } = require('./backend/services/AgentService');
  if (agentService.getStatus().isRunning) {
    agentService.stop().catch((err: Error) => console.error('[Main] Error stopping agent on suspend:', err));
    (global as any).__agentWasRunning = true;
  }
});

powerMonitor.on('resume', () => {
  console.log('[Main] System resumed');
  if ((global as any).__agentWasRunning) {
    (global as any).__agentWasRunning = false;
    const { agentService } = require('./backend/services/AgentService');
    // Delay restart to allow system to fully wake
    setTimeout(() => {
      agentService.start().catch((err: Error) => console.error('[Main] Error restarting agent on resume:', err));
    }, 3000);
  }
});

// IPC Handlers
ipcMain.handle('get-app-info', () => ({
  version: app.getVersion(),
  name: app.getName(),
  isPackaged: app.isPackaged,
  platform: process.platform,
  arch: process.arch,
  backendPort,
}));

ipcMain.handle('get-system-theme', () =>
  nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
);

ipcMain.handle('show-window', () => {
  mainWindow?.show();
  mainWindow?.focus();
});

ipcMain.handle('quit-app', () => {
  isQuitting = true;
  app.quit();
});

ipcMain.handle('get-user-data-path', () => app.getPath('userData'));

// Model IPC handlers
ipcMain.handle('model:status', () => {
  try {
    const { localLLMService } = require('./backend/services/LocalLLMService');
    return {
      status: localLLMService.status,
      isDownloaded: localLLMService.isModelDownloaded(),
      isLoaded: localLLMService.isConfigured(),
      downloadProgress: localLLMService.downloadProgress,
    };
  } catch {
    return { status: 'error', isDownloaded: false, isLoaded: false, downloadProgress: 0 };
  }
});

ipcMain.handle('model:download', async () => {
  try {
    const { localLLMService } = require('./backend/services/LocalLLMService');
    const modelPath = await localLLMService.downloadModel();
    return { success: true, modelPath };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});
