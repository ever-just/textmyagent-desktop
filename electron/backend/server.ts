import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import { app as electronApp } from 'electron';
import path from 'path';
import http from 'http';
import dashboardRoutes from './routes/dashboard';
import { setupSecureStorageIPC } from '../utils/secure-storage';
import { agentService } from './services/AgentService';

let server: http.Server | null = null;
let expressApp: Express | null = null;
const activeConnections = new Set<import('net').Socket>();

export interface ServerConfig {
  port?: number;
  host?: string;
}

export async function startBackendServer(config: ServerConfig = {}): Promise<number> {
  const { port = 3001, host = '127.0.0.1' } = config;

  expressApp = express();

  // CORS - strict origin allowlist (fixes A2: CORS bypass via substring match)
  expressApp.use(
    cors({
      origin: (origin, callback) => {
        // Allow same-origin requests (no origin header)
        if (!origin) {
          return callback(null, true);
        }
        // Allow file:// protocol (Electron renderer)
        if (origin === 'file://') {
          return callback(null, true);
        }
        // Parse and validate origin strictly
        try {
          const url = new URL(origin);
          const hostname = url.hostname;
          if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return callback(null, true);
          }
        } catch {
          // Invalid URL — reject
        }
        callback(new Error('Not allowed by CORS'));
      },
    })
  );

  // Compression
  expressApp.use(compression());

  // Body parsing (limit to 100KB — API only handles small payloads)
  expressApp.use(express.json({ limit: '100kb' }));
  expressApp.use(express.urlencoded({ extended: true, limit: '100kb' }));

  // Request logging (development only)
  if (!electronApp.isPackaged) {
    expressApp.use((req, _res, next) => {
      console.log(`[API] ${req.method} ${req.path}`);
      next();
    });
  }

  // Health check
  expressApp.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: electronApp.getVersion(),
      packaged: electronApp.isPackaged,
      platform: process.platform,
      arch: process.arch,
    });
  });

  // Mount dashboard routes
  expressApp.use('/api/dashboard', dashboardRoutes);

  // Serve static dashboard files in packaged app
  if (electronApp.isPackaged) {
    // __dirname is dist/electron in the asar, dashboard is at root/dashboard/out
    const dashboardPath = path.join(__dirname, '../../../dashboard/out');
    console.log('[Backend] Serving dashboard from:', dashboardPath);
    expressApp.use(express.static(dashboardPath));
    
    // SPA fallback - serve index.html for all non-API routes
    expressApp.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        return next();
      }
      res.sendFile(path.join(dashboardPath, 'index.html'));
    });
  }

  // Setup secure storage IPC handlers
  setupSecureStorageIPC();

  // Error handling
  expressApp.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[API Error]', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: electronApp.isPackaged ? undefined : err.message,
    });
  });

  // Find available port
  const actualPort = await findAvailablePort(port);

  return new Promise((resolve, reject) => {
    server = expressApp!.listen(actualPort, host, async () => {
      console.log(`[Backend] Server running on http://${host}:${actualPort}`);
      
      // Track active connections for clean shutdown (fixes B3: deadlock)
      server!.on('connection', (socket) => {
        activeConnections.add(socket);
        socket.on('close', () => activeConnections.delete(socket));
      });

      // Auto-start the agent if configured
      try {
        const started = await agentService.start();
        if (started) {
          console.log('[Backend] Agent auto-started successfully');
        } else {
          console.log('[Backend] Agent not auto-started (not configured or missing permissions)');
        }
      } catch (err) {
        console.error('[Backend] Failed to auto-start agent:', err);
      }
      
      resolve(actualPort);
    });

    server.on('error', reject);
  });
}

export async function stopBackendServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      // Stop accepting new connections
      server.close(() => {
        server = null;
        expressApp = null;
        activeConnections.clear();
        resolve();
      });

      // Force-destroy lingering connections (SSE streams, etc.) after timeout
      const forceTimeout = setTimeout(() => {
        console.warn(`[Backend] Force-closing ${activeConnections.size} lingering connections`);
        for (const socket of activeConnections) {
          socket.destroy();
        }
        activeConnections.clear();
      }, 3000);

      // Clear the force timeout if server closes cleanly
      server.once('close', () => clearTimeout(forceTimeout));
    } else {
      resolve();
    }
  });
}

async function findAvailablePort(startPort: number, maxPort = 65535): Promise<number> {
  for (let port = startPort; port <= maxPort; port++) {
    const available = await new Promise<boolean>((resolve) => {
      const testServer = http.createServer();
      testServer.listen(port, '127.0.0.1', () => {
        testServer.close(() => resolve(true));
      });
      testServer.on('error', () => resolve(false));
    });
    if (available) return port;
  }
  throw new Error(`No available port found between ${startPort} and ${maxPort}`);
}

export function getExpressApp(): Express | null {
  return expressApp;
}
