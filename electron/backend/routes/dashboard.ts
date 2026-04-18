import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDatabase, getSetting, setSetting, getSettingValue } from '../database';
import { SecureStorage } from '../../utils/secure-storage';
import { agentService } from '../services/AgentService';
import { iMessageService } from '../services/iMessageService';
import { localLLMService } from '../services/LocalLLMService';
import { promptBuilder } from '../services/PromptBuilder';
import { log, logBuffer, logSubscribers } from '../logger';
export type { LogEntry } from '../logger';
export { log, logBuffer };

// Lazy import electron to avoid initialization issues
const getElectronApp = () => {
  try {
    return require('electron').app;
  } catch {
    return null;
  }
};

const router = Router();

// --- Status ---
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const db = getDatabase();

    // Check iMessage access
    const imessageStatus = await iMessageService.checkPermissions();

    const electronApp = getElectronApp();
    res.json({
      agent: {
        status: 'online',
        uptime: process.uptime(),
        memory: process.memoryUsage().heapUsed,
        version: electronApp?.getVersion() || '1.7.0',
        isPackaged: electronApp?.isPackaged || false,
      },
      database: {
        status: db ? 'online' : 'offline',
        type: 'sqlite',
      },
      redis: {
        status: 'n/a', // Not used in desktop mode
        note: 'Desktop uses in-memory scheduling',
      },
      imessage: {
        status: imessageStatus.hasAccess ? 'online' : 'offline',
        configured: imessageStatus.hasAccess,
        error: imessageStatus.error,
      },
      configured: SecureStorage.hasModelPath() && imessageStatus.hasAccess,
    });
  } catch (error) {
    log('error', 'Status check failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// --- Configuration ---
router.get('/config', async (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const imessageStatus = await iMessageService.checkPermissions();
    
    res.json({
      model: {
        name: getSettingValue('model.name', 'gemma-4-e4b'),
        temperature: getSettingValue('model.temperature', 0.7),
        responseMaxTokens: getSettingValue('model.responseMaxTokens', 1024),
        contextSize: getSettingValue('model.contextSize', 8192),
        gpuLayers: getSettingValue('model.gpuLayers', -1),
        status: localLLMService.status,
        isDownloaded: localLLMService.isModelDownloaded(),
        isLoaded: localLLMService.isConfigured(),
      },
      imessage: {
        configured: imessageStatus.hasAccess,
        sendEnabled: getSettingValue('imessage.sendEnabled', true),
        error: imessageStatus.error,
      },
      app: {
        version: getElectronApp()?.getVersion() || '1.7.0',
        platform: process.platform,
        arch: process.arch,
      },
      settings: (() => {
        const allSettings: Record<string, any> = {};
        const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
        for (const row of rows) {
          try { allSettings[row.key] = JSON.parse(row.value); } catch { allSettings[row.key] = row.value; }
        }
        return allSettings;
      })(),
    });
  } catch (error) {
    log('error', 'Get config failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get config' });
  }
});

// Settings key allowlist with expected types (fixes Pre-Phase 0.3)
const ALLOWED_SETTINGS: Record<string, 'string' | 'number' | 'boolean' | 'object'> = {
  // Local Model
  'model.name': 'string',
  'model.temperature': 'number',
  'model.responseMaxTokens': 'number',
  'model.contextSize': 'number',
  'model.gpuLayers': 'number',
  // iMessage
  'imessage.sendEnabled': 'boolean',
  // Agent behavior
  'agent.maxResponseChars': 'number',
  'agent.multiMessageSplit': 'boolean',
  'agent.splitDelaySeconds': 'number',
  'agent.name': 'string',
  'agent.identity': 'string',
  'agent.persona': 'string',
  'agent.guidelines': 'string',
  'agent.safety': 'string',
  'agent.format': 'string',
  // Security
  'security.rateLimitPerMinute': 'number',
  'security.rateLimitGlobalPerHour': 'number',
  'security.dailyBudgetCents': 'number',
  'security.maxApiCallsPerMessage': 'number',
  'security.outputSanitization': 'boolean',
  // Memory
  'memory.factTTLDays': 'number',
  'memory.maxFactsPerUser': 'number',
  'memory.enableSummarization': 'boolean',
  // Tools
  'tools.enabled': 'boolean',
  'tools.webSearch': 'boolean',
  'tools.webSearchMaxUses': 'number',
  'tools.webFetch': 'boolean',
  'tools.webFetchMaxTokens': 'number',
  'tools.reminders': 'boolean',
  'tools.triggers': 'boolean',
  'tools.saveUserFact': 'boolean',
  'tools.getUserFacts': 'boolean',
  'tools.searchHistory': 'boolean',
  'tools.waitTool': 'boolean',
  // Contact allowlist
  'agent.replyMode': 'string',
  'agent.allowedContacts': 'object',
  // Developer
  'developer.mode': 'boolean',
  // Polling
  'polling.activeIntervalMs': 'number',
  'polling.idleIntervalMs': 'number',
  'polling.sleepIntervalMs': 'number',
};

router.put('/config', async (req: Request, res: Response) => {
  try {
    const updates = req.body;
    const rejected: string[] = [];

    // Validate against allowlist and type-check
    for (const [key, value] of Object.entries(updates)) {
      const expectedType = ALLOWED_SETTINGS[key];
      if (!expectedType) {
        rejected.push(key);
        continue;
      }
      if (typeof value !== expectedType) {
        rejected.push(key);
        continue;
      }
      setSetting(key, JSON.stringify(value));
    }

    if (rejected.length > 0) {
      log('warn', 'Settings keys rejected by allowlist', { rejected });
    }

    // Propagate config changes to live services (fixes B5)
    if (updates['model.responseMaxTokens'] !== undefined) {
      localLLMService.setMaxTokens(Number(updates['model.responseMaxTokens']));
    }
    if (updates['model.temperature'] !== undefined) {
      localLLMService.setTemperature(Number(updates['model.temperature']));
    }
    if (updates['model.contextSize'] !== undefined) {
      localLLMService.setContextSize(Number(updates['model.contextSize']));
    }
    if (updates['model.gpuLayers'] !== undefined) {
      localLLMService.setGpuLayers(Number(updates['model.gpuLayers']));
    }

    log('info', 'Configuration updated', { keys: Object.keys(updates), rejected });
    res.json({ success: true, rejected: rejected.length > 0 ? rejected : undefined });
  } catch (error) {
    log('error', 'Update config failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to update config' });
  }
});

// --- Logs ---
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const { level, search, limit } = req.query;
    const logs = logBuffer.query({
      level: level as string,
      search: search as string,
      limit: limit ? parseInt(limit as string, 10) : 100,
    });
    res.json({ logs });
  } catch (error) {
    log('error', 'Get logs failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get logs' });
  }
});

// --- Log Stream (SSE) ---

router.get('/logs/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
  
  logSubscribers.add(res);
  log('info', 'Log stream client connected', { clients: logSubscribers.size });
  
  req.on('close', () => {
    logSubscribers.delete(res);
    log('info', 'Log stream client disconnected', { clients: logSubscribers.size });
  });
});

// --- Users ---
router.get('/users', async (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const users = db
      .prepare(
        `
      SELECT 
        u.id,
        u.handle,
        u.display_name as displayName,
        u.is_blocked as isBlocked,
        u.created_at as createdAt,
        (SELECT COUNT(*) FROM conversations c WHERE c.user_id = u.id) as conversationCount,
        (SELECT MAX(m.created_at) FROM messages m 
         JOIN conversations c ON m.conversation_id = c.id 
         WHERE c.user_id = u.id) as lastMessageAt
      FROM users u
      ORDER BY lastMessageAt DESC NULLS LAST
      LIMIT 100
    `
      )
      .all();

    res.json({ users });
  } catch (error) {
    log('error', 'Get users failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// --- Usage ---
router.get('/usage', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { period = 'day' } = req.query;

    let dateFormat: string;
    switch (period) {
      case 'month':
        dateFormat = '%Y-%m';
        break;
      case 'week':
        dateFormat = '%Y-%W';
        break;
      default:
        dateFormat = '%Y-%m-%d';
    }

    const usage = db
      .prepare(
        `
      SELECT 
        strftime('${dateFormat}', date) as period,
        SUM(input_tokens) as inputTokens,
        SUM(output_tokens) as outputTokens,
        SUM(total_tokens) as totalTokens,
        SUM(request_count) as requestCount
      FROM api_usage
      GROUP BY strftime('${dateFormat}', date)
      ORDER BY period DESC
      LIMIT 30
    `
      )
      .all();

    // Get totals
    const totals = db
      .prepare(
        `
      SELECT 
        SUM(input_tokens) as inputTokens,
        SUM(output_tokens) as outputTokens,
        SUM(total_tokens) as totalTokens,
        SUM(request_count) as requestCount
      FROM api_usage
    `
      )
      .get() as any;

    res.json({
      usage,
      totals: totals || { inputTokens: 0, outputTokens: 0, totalTokens: 0, requestCount: 0 },
    });
  } catch (error) {
    log('error', 'Get usage failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get usage' });
  }
});

// --- Messages ---
router.get('/messages/all', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { limit = 50, offset = 0 } = req.query;

    const messages = db
      .prepare(
        `
      SELECT 
        m.id,
        m.role,
        m.content,
        m.created_at as createdAt,
        c.id as conversationId,
        u.handle as userHandle,
        u.display_name as userDisplayName
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      JOIN users u ON c.user_id = u.id
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `
      )
      .all(parseInt(limit as string, 10), parseInt(offset as string, 10));

    res.json({ messages });
  } catch (error) {
    log('error', 'Get messages failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

router.get('/users/:userId/messages', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { userId } = req.params;
    const { limit = 50 } = req.query;

    const messages = db
      .prepare(
        `
      SELECT 
        m.id,
        m.role,
        m.content,
        m.created_at as createdAt,
        c.id as conversationId
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.user_id = ?
      ORDER BY m.created_at DESC
      LIMIT ?
    `
      )
      .all(userId, parseInt(limit as string, 10));

    res.json({ messages });
  } catch (error) {
    log('error', 'Get user messages failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get user messages' });
  }
});

// --- Permissions (macOS specific) ---
router.get('/permissions', async (_req: Request, res: Response) => {
  try {
    const { permissionService } = await import('../services/PermissionService');
    const permissionsResult = await permissionService.checkAllPermissions();

    res.json({
      allGranted: permissionsResult.allGranted,
      requiredGranted: permissionsResult.requiredGranted,
      permissions: permissionsResult.permissions.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        required: p.required,
        settingsUrl: p.settingsUrl,
        instructions: p.instructions,
      })),
      services: [
        {
          id: 'imessage',
          name: 'iMessage',
          description: 'Native macOS Messages integration',
          status: permissionsResult.permissions.find(p => p.id === 'full_disk_access')?.status === 'granted' ? 'running' : 'stopped',
          version: 'Native',
        },
        {
          id: 'database',
          name: 'SQLite Database',
          description: 'Local data storage',
          status: 'running',
        },
      ],
      localModel: {
        status: localLLMService.status,
        isDownloaded: localLLMService.isModelDownloaded(),
        isLoaded: localLLMService.isConfigured(),
        downloadProgress: localLLMService.downloadProgress,
      },
    });
  } catch (error) {
    log('error', 'Get permissions failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get permissions' });
  }
});

// --- Model Management ---
router.get('/model/status', async (_req: Request, res: Response) => {
  try {
    res.json({
      status: localLLMService.status,
      isDownloaded: localLLMService.isModelDownloaded(),
      isLoaded: localLLMService.isConfigured(),
      downloadProgress: localLLMService.downloadProgress,
      errorMessage: localLLMService.errorMessage,
    });
  } catch (error) {
    log('error', 'Get model status failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get model status' });
  }
});

router.post('/model/download', async (_req: Request, res: Response) => {
  try {
    if (localLLMService.status === 'downloading') {
      return res.status(409).json({ error: 'Download already in progress' });
    }
    // Start download in background
    localLLMService.downloadModel().catch(err => {
      log('error', 'Model download failed', { error: err.message });
    });
    res.json({ success: true, message: 'Download started' });
  } catch (error) {
    log('error', 'Start model download failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to start model download' });
  }
});

router.post('/model/load', async (_req: Request, res: Response) => {
  try {
    if (localLLMService.status === 'loading') {
      return res.status(409).json({ error: 'Model loading already in progress' });
    }
    if (localLLMService.status === 'loaded') {
      return res.json({ success: true, message: 'Model already loaded' });
    }
    // Start load in background (consistent with download pattern)
    localLLMService.initModel().catch(err => {
      log('error', 'Model load failed', { error: err.message });
    });
    res.json({ success: true, message: 'Model loading started' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- Settings Open (macOS) ---
// Allowlist of safe URL schemes for opening system settings (fixes A1: command injection)
const ALLOWED_SETTINGS_PREFIXES = [
  'x-apple.systempreferences:',
];

router.post('/settings/open', async (req: Request, res: Response) => {
  try {
    const { settingsUrl } = req.body;
    if (!settingsUrl || typeof settingsUrl !== 'string') {
      return res.status(400).json({ error: 'settingsUrl required' });
    }
    // Validate against allowlist to prevent command injection
    const isAllowed = ALLOWED_SETTINGS_PREFIXES.some(prefix => settingsUrl.startsWith(prefix));
    if (!isAllowed) {
      log('warn', 'Blocked settings URL not in allowlist', { settingsUrl });
      return res.status(400).json({ error: 'URL not allowed' });
    }
    const { shell } = require('electron');
    await shell.openExternal(settingsUrl);
    res.json({ success: true });
  } catch (error) {
    log('error', 'Open settings failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to open settings' });
  }
});

// --- Contacts ---
router.post('/contacts/import', async (_req: Request, res: Response) => {
  try {
    // Try to use node-mac-contacts if available
    let contacts: any[] = [];
    try {
      const macContacts = require('node-mac-contacts');
      const authStatus = macContacts.getAuthStatus();
      
      if (authStatus === 'Authorized') {
        contacts = macContacts.getAllContacts() || [];
        res.json(contacts.map((c: any) => ({
          id: c.identifier || crypto.randomUUID(),
          firstName: c.givenName || '',
          lastName: c.familyName || '',
          phoneNumbers: c.phoneNumbers || [],
          emailAddresses: c.emailAddresses || [],
          organization: c.organizationName,
        })));
      } else {
        res.json({ authStatus, error: 'Contacts permission not granted' });
      }
    } catch (e: any) {
      log('warn', 'node-mac-contacts not available', { error: e.message });
      res.json({ error: 'Contacts import not available', contacts: [] });
    }
  } catch (error) {
    log('error', 'Import contacts failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to import contacts' });
  }
});

router.post('/contacts/open-settings', async (_req: Request, res: Response) => {
  try {
    const { permissionService } = await import('../services/PermissionService');
    await permissionService.openContactsSettings();
    res.json({ success: true });
  } catch (error) {
    log('error', 'Open contacts settings failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to open settings' });
  }
});

// Request Contacts permission (triggers system prompt)
router.post('/contacts/request-permission', async (_req: Request, res: Response) => {
  try {
    const { permissionService } = await import('../services/PermissionService');
    const granted = await permissionService.requestContactsPermission();
    const status = await permissionService.checkContactsPermission();
    res.json({ 
      success: granted, 
      status: status.status,
      needsSettings: status.status === 'denied'
    });
  } catch (error: any) {
    log('error', 'Request contacts permission failed', { error: error.message });
    res.status(500).json({ error: 'Failed to request permission' });
  }
});

// Request Automation permission (triggers system prompt)
router.post('/permissions/request-automation', async (_req: Request, res: Response) => {
  try {
    const { permissionService } = await import('../services/PermissionService');
    const granted = await permissionService.requestAutomationPermission();
    const status = await permissionService.checkAutomationPermission();
    res.json({ 
      success: granted, 
      status: status.status,
      needsSettings: status.status === 'denied'
    });
  } catch (error: any) {
    log('error', 'Request automation permission failed', { error: error.message });
    res.status(500).json({ error: 'Failed to request permission' });
  }
});

// Open specific permission settings
router.post('/permissions/open-settings', async (req: Request, res: Response) => {
  try {
    const { permissionId } = req.body;
    const { permissionService } = await import('../services/PermissionService');
    
    switch (permissionId) {
      case 'full_disk_access':
        await permissionService.openFullDiskAccessSettings();
        break;
      case 'automation':
        await permissionService.openAutomationSettings();
        break;
      case 'contacts':
        await permissionService.openContactsSettings();
        break;
      default:
        return res.status(400).json({ error: 'Unknown permission ID' });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    log('error', 'Open permission settings failed', { error: error.message });
    res.status(500).json({ error: 'Failed to open settings' });
  }
});

// Check if first launch / needs onboarding
router.get('/permissions/needs-setup', async (_req: Request, res: Response) => {
  try {
    const { permissionService } = await import('../services/PermissionService');
    const isFirstLaunch = await permissionService.isFirstLaunch();
    const missingPermissions = await permissionService.getMissingRequiredPermissions();
    
    res.json({
      needsSetup: isFirstLaunch || missingPermissions.length > 0,
      isFirstLaunch,
      missingPermissions: missingPermissions.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        instructions: p.instructions,
      })),
    });
  } catch (error: any) {
    log('error', 'Check permissions setup failed', { error: error.message });
    res.status(500).json({ error: 'Failed to check permissions' });
  }
});

// --- Setup/Onboarding ---
router.get('/setup/status', async (_req: Request, res: Response) => {
  try {
    const { permissionService } = await import('../services/PermissionService');
    const hasModel = localLLMService.isModelDownloaded();
    const permissionsResult = await permissionService.checkAllPermissions();
    const fullDiskAccess = permissionsResult.permissions.find(p => p.id === 'full_disk_access');
    const automation = permissionsResult.permissions.find(p => p.id === 'automation');
    const contacts = permissionsResult.permissions.find(p => p.id === 'contacts');
    
    const isConfigured = hasModel && permissionsResult.requiredGranted;

    res.json({
      isConfigured,
      steps: {
        modelDownloaded: hasModel,
        fullDiskAccess: fullDiskAccess?.status === 'granted',
        automation: automation?.status === 'granted',
        contacts: contacts?.status === 'granted',
      },
      permissions: {
        allGranted: permissionsResult.allGranted,
        requiredGranted: permissionsResult.requiredGranted,
        details: permissionsResult.permissions,
      },
      needsSetup: !isConfigured,
    });
  } catch (error) {
    log('error', 'Get setup status failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to get setup status' });
  }
});

// Test iMessage access (replaces BlueBubbles test)
router.post('/setup/test-imessage', async (_req: Request, res: Response) => {
  try {
    const permissions = await iMessageService.checkPermissions();
    
    if (permissions.hasAccess) {
      res.json({ success: true, message: 'iMessage access granted' });
    } else {
      res.json({ success: false, error: permissions.error });
    }
  } catch (error: any) {
    log('warn', 'iMessage test failed', { error: error.message });
    res.json({ success: false, error: error.message });
  }
});

router.post('/setup/test-model', async (_req: Request, res: Response) => {
  try {
    if (!localLLMService.isModelDownloaded()) {
      return res.json({ success: false, error: 'Model not downloaded yet' });
    }
    // Try loading the model
    await localLLMService.initModel();
    res.json({ success: true });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// --- Agent Control ---
router.get('/agent/status', async (_req: Request, res: Response) => {
  try {
    const status = agentService.getStatus();
    res.json(status);
  } catch (error: any) {
    log('error', 'Get agent status failed', { error: error.message });
    res.status(500).json({ error: 'Failed to get agent status' });
  }
});

router.post('/agent/start', async (_req: Request, res: Response) => {
  try {
    const started = await agentService.start();
    if (started) {
      log('info', 'Agent started via dashboard');
      res.json({ success: true, message: 'Agent started' });
    } else {
      res.status(400).json({ 
        success: false, 
        error: 'Failed to start agent. Check that the AI model is downloaded and Full Disk Access is granted.' 
      });
    }
  } catch (error: any) {
    log('error', 'Start agent failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.post('/agent/stop', async (_req: Request, res: Response) => {
  try {
    await agentService.stop();
    log('info', 'Agent stopped via dashboard');
    res.json({ success: true, message: 'Agent stopped' });
  } catch (error: any) {
    log('error', 'Stop agent failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.post('/agent/restart', async (_req: Request, res: Response) => {
  try {
    await agentService.stop();
    localLLMService.refreshClient();
    const started = await agentService.start();
    if (started) {
      log('info', 'Agent restarted via dashboard');
      res.json({ success: true, message: 'Agent restarted' });
    } else {
      res.status(400).json({ success: false, error: 'Failed to restart agent' });
    }
  } catch (error: any) {
    log('error', 'Restart agent failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// --- Send Message (manual from dashboard) ---
router.post('/messages/send', async (req: Request, res: Response) => {
  try {
    const { chatGuid, message } = req.body;
    
    if (!chatGuid || !message) {
      return res.status(400).json({ error: 'chatGuid and message required' });
    }
    
    const sent = await iMessageService.sendMessage(chatGuid, message);
    if (sent) {
      log('info', 'Manual message sent', { chatGuid, preview: message.substring(0, 50) });
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to send message' });
    }
  } catch (error: any) {
    log('error', 'Send message failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// --- Contact Allowlist ---
router.get('/agent/contacts', async (_req: Request, res: Response) => {
  try {
    const replyModeRaw = getSetting('agent.replyMode');
    const allowedRaw = getSetting('agent.allowedContacts');
    res.json({
      replyMode: replyModeRaw ? JSON.parse(replyModeRaw) : 'everyone',
      allowedContacts: allowedRaw ? JSON.parse(allowedRaw) : [],
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/agent/contacts', async (req: Request, res: Response) => {
  try {
    const { replyMode, allowedContacts } = req.body;
    if (replyMode !== undefined) {
      if (!['everyone', 'allowlist'].includes(replyMode)) {
        return res.status(400).json({ error: 'replyMode must be "everyone" or "allowlist"' });
      }
      setSetting('agent.replyMode', JSON.stringify(replyMode));
    }
    if (allowedContacts !== undefined) {
      if (!Array.isArray(allowedContacts)) {
        return res.status(400).json({ error: 'allowedContacts must be an array of strings' });
      }
      setSetting('agent.allowedContacts', JSON.stringify(allowedContacts));
    }
    log('info', 'Contact allowlist updated', { replyMode, contactCount: allowedContacts?.length });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- Prompt Preview ---
router.get('/prompt/preview', async (_req: Request, res: Response) => {
  try {
    const preview = promptBuilder.preview({ date: new Date().toLocaleString() });
    res.json(preview);
  } catch (error: any) {
    log('error', 'Prompt preview failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
