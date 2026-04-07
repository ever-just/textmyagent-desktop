import { EventEmitter } from 'events';
import crypto from 'crypto';
import { iMessageService, IMessage } from './iMessageService';
import { claudeService, Message } from './ClaudeService';
import { log, logSecurityEvent } from '../logger';
import { getDatabase, getSetting, getSettingInt, getSettingFloat } from '../database';
import { rateLimiter } from './RateLimiter';
import { messageFormatter } from './MessageFormatter';
import { memoryService } from './MemoryService';

interface ConversationContext {
  chatGuid: string;
  userHandle: string;
  messages: Message[];
  lastActivity: number;
}

// Max age for conversation context entries before eviction (1 hour)
const CONVERSATION_TTL_MS = 60 * 60 * 1000;
const MAX_CONVERSATIONS = 500;

export class AgentService extends EventEmitter {
  private isRunning = false;
  private conversations: Map<string, ConversationContext> = new Map();
  private processingQueue: Set<string> = new Set(); // message guid dedup
  private chatLocks: Set<string> = new Set(); // per-chat concurrency lock (fixes C1)
  private chatQueues: Map<string, IMessage[]> = new Map(); // per-chat message queue
  private static MAX_CHAT_QUEUE_SIZE = 5;
  private static MAX_API_CALLS_PER_MESSAGE = 6; // Phase 1, task 1.4: per-message cost cap
  private maxHistoryMessages = 20;

  constructor() {
    super();
    this.setupMessageHandler();
  }

  private setupMessageHandler(): void {
    iMessageService.on('message', async (message: IMessage) => {
      await this.handleIncomingMessage(message);
    });

    iMessageService.on('connected', () => {
      log('info', 'Agent connected to iMessage database');
      this.emit('status', { connected: true });
    });

    iMessageService.on('disconnected', () => {
      log('info', 'Agent disconnected from iMessage');
      this.emit('status', { connected: false });
    });

    iMessageService.on('error', (error) => {
      log('error', 'iMessage error', { error: error.message });
      this.emit('error', error);
    });
  }

  async start(): Promise<boolean> {
    if (this.isRunning) {
      log('warn', 'Agent is already running');
      return true;
    }

    log('info', 'Starting AI agent...');

    // Always sync settings from database (model, maxTokens, temperature)
    claudeService.syncSettings();

    // Check if Claude is configured
    if (!claudeService.isConfigured()) {
      claudeService.refreshClient();
      if (!claudeService.isConfigured()) {
        log('error', 'Cannot start agent: Anthropic API key not configured');
        return false;
      }
    }

    // Check iMessage permissions
    const permissions = await iMessageService.checkPermissions();
    if (!permissions.hasAccess) {
      log('error', 'Cannot start agent: ' + permissions.error);
      return false;
    }

    // Start iMessage polling
    await iMessageService.startPolling(2000);

    this.isRunning = true;
    log('info', 'AI agent started successfully');
    this.emit('started');

    return true;
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    log('info', 'Stopping AI agent...');
    await iMessageService.stopPolling();
    this.isRunning = false;
    this.chatQueues.clear();
    this.chatLocks.clear();
    this.processingQueue.clear();
    this.emit('stopped');
    log('info', 'AI agent stopped');
  }

  private async handleIncomingMessage(message: IMessage): Promise<void> {
    // Don't process messages if agent has been stopped (fixes B8)
    if (!this.isRunning) return;

    const chatGuid = message.chatGuid;
    const userHandle = message.handleId;

    if (!chatGuid || !userHandle) {
      log('warn', 'Message missing chat or handle info', { guid: message.guid });
      return;
    }

    // Reject messages from blocked users (Phase 1, task 1.1)
    try {
      const db = getDatabase();
      const blockedUser = db.prepare('SELECT is_blocked FROM users WHERE handle = ?').get(userHandle) as { is_blocked: number } | undefined;
      if (blockedUser?.is_blocked) {
        log('info', 'Ignoring message from blocked user', { handle: userHandle });
        return;
      }
    } catch {
      // If DB query fails, allow message through rather than silently dropping
    }

    // Contact allowlist check: skip if user not in allowed contacts
    try {
      const replyModeRaw = getSetting('agent.replyMode');
      const replyMode = replyModeRaw ? JSON.parse(replyModeRaw) : 'everyone';
      if (replyMode === 'allowlist') {
        const allowedRaw = getSetting('agent.allowedContacts');
        const allowed = allowedRaw ? JSON.parse(allowedRaw) as string[] : [];
        // Normalize: strip everything except digits for comparison
        const normalize = (h: string) => h.replace(/[^\d]/g, '').slice(-10);
        const userNorm = normalize(userHandle);
        const isAllowed = allowed.some((c: string) => normalize(c) === userNorm);
        if (!isAllowed) {
          log('info', 'Skipping message — contact not in allowlist', { handle: userHandle });
          return;
        }
      }
    } catch {
      // If settings parse fails, allow message through
    }

    // Rate limit check (Phase 1, task 1.2)
    const rateCheck = rateLimiter.checkLimit(userHandle);
    if (!rateCheck.allowed) {
      log('warn', 'Message rate-limited', { handle: userHandle, reason: rateCheck.reason });
      logSecurityEvent('rate_limit_exceeded', userHandle, { reason: rateCheck.reason }, 'medium');
      return;
    }

    // Prevent duplicate message processing
    if (this.processingQueue.has(message.guid)) {
      return;
    }
    this.processingQueue.add(message.guid);

    // Per-chat lock: only one message processed per chat at a time (fixes C1)
    if (this.chatLocks.has(chatGuid)) {
      // Queue message instead of dropping it
      const queue = this.chatQueues.get(chatGuid) || [];
      if (queue.length >= AgentService.MAX_CHAT_QUEUE_SIZE) {
        log('warn', 'Chat queue full, dropping oldest queued message', { chatGuid });
        queue.shift();
      }
      queue.push(message);
      this.chatQueues.set(chatGuid, queue);
      log('info', 'Chat being processed, message queued', { chatGuid, queueLength: queue.length });
      this.processingQueue.delete(message.guid);
      return;
    }
    this.chatLocks.add(chatGuid);

    try {
      log('info', 'Processing message', {
        from: userHandle,
        chatGuid,
        messageLength: message.text.length,
        preview: message.text.substring(0, 100),
      });

      // Always fetch recent history for time awareness context
      const history = await iMessageService.getConversationHistory(chatGuid, 10);

      // Get or create conversation context
      let context = this.conversations.get(chatGuid);
      if (!context) {
        context = {
          chatGuid,
          userHandle,
          messages: [],
          lastActivity: Date.now(),
        };
        this.conversations.set(chatGuid, context);

        // Load recent history from iMessage
        // Only attribute "isFromMe" messages as 'assistant' if they exist in our
        // own messages DB — otherwise the user manually sent them and they should
        // be excluded to avoid misattribution (fixes M2).
        const db = getDatabase();
        const conversation = db.prepare(
          'SELECT id FROM conversations WHERE chat_guid = ?'
        ).get(chatGuid) as { id: string } | undefined;

        const savedAssistantMessages = new Set<string>();
        if (conversation) {
          const rows = db.prepare(
            'SELECT content FROM messages WHERE conversation_id = ? AND role = \'assistant\' ORDER BY created_at DESC LIMIT 20'
          ).all(conversation.id) as { content: string }[];
          for (const r of rows) savedAssistantMessages.add(r.content);
        }

        // Filter stale messages: only include messages from the last 30 minutes
        // to avoid responding to old conversation context when agent restarts
        const staleThresholdMs = 30 * 60 * 1000; // 30 minutes
        const now = Date.now();

        for (const msg of history) {
          if (msg.guid !== message.guid) {
            // Skip messages older than the stale threshold
            const msgAge = now - msg.dateCreated.getTime();
            if (msgAge > staleThresholdMs) continue;

            if (msg.isFromMe) {
              // Only include if this was an agent-sent response
              if (savedAssistantMessages.has(msg.text || '')) {
                context.messages.push({ role: 'assistant', content: msg.text || '' });
              }
              // else: manually sent by Mac user — skip to avoid misattribution
            } else {
              context.messages.push({ role: 'user', content: msg.text || '' });
            }
          }
        }
      }

      // Add user message to context
      context.messages.push({
        role: 'user',
        content: message.text,
      });
      context.lastActivity = Date.now();

      // Trim history if too long
      if (context.messages.length > this.maxHistoryMessages) {
        context.messages = context.messages.slice(-this.maxHistoryMessages);
      }

      // Budget circuit breaker (Phase 1, task 1.3)
      if (this.isBudgetExceeded()) {
        log('warn', 'Skipping response — daily budget exceeded', { chatGuid, userHandle });
        return;
      }

      // Load user facts for prompt context (Phase 4, task 4.1)
      let userFacts: import('../types').UserFact[] = [];
      try {
        userFacts = memoryService.getUserFacts(userHandle);
        for (const f of userFacts) {
          memoryService.touchFact(f.id);
        }
      } catch {
        // Non-fatal — continue without facts
      }

      // Contact name resolution — normalize phone to last 10 digits for display (task 2.4)
      const contactName = this.normalizeContactName(userHandle);

      // Group chat detection (task 3.12) — group chatGuids contain multiple participants
      const isGroupChat = chatGuid.includes(';chat');
      const chatType: 'group' | 'individual' = isGroupChat ? 'group' : 'individual';

      // Calculate time since last message in this conversation for time awareness
      let timeSinceLastMsg = '';
      if (history.length > 0) {
        const lastMsgTime = history[history.length - 1]?.dateCreated?.getTime();
        if (lastMsgTime) {
          const elapsed = Date.now() - lastMsgTime;
          if (elapsed < 60_000) timeSinceLastMsg = 'just now';
          else if (elapsed < 3600_000) timeSinceLastMsg = `${Math.round(elapsed / 60_000)} min ago`;
          else if (elapsed < 86400_000) timeSinceLastMsg = `${Math.round(elapsed / 3600_000)} hr ago`;
          else timeSinceLastMsg = `${Math.round(elapsed / 86400_000)} days ago`;
        }
      }

      // Build date context string with time awareness
      let dateContext = new Date().toLocaleString();
      if (timeSinceLastMsg) {
        dateContext += ` (last message in this chat: ${timeSinceLastMsg})`;
      }

      // Generate AI response (Phase 3: pass tool context + prompt context)
      const response = await claudeService.generateResponse(
        message.text,
        context.messages.slice(0, -1), // Exclude the current message (it's passed separately)
        undefined, // systemPrompt — use PromptBuilder default
        { date: dateContext, contactName, userFacts, chatType },
        { userId: userHandle, chatGuid }
      );

      // If agent called 'wait' tool, skip sending a text response entirely
      if (response && response.toolsUsed?.includes('wait')) {
        log('info', 'Agent chose to wait — no text response sent', {
          from: userHandle,
          chatGuid,
          toolsUsed: response.toolsUsed?.join(', '),
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          userMessagePreview: message.text.substring(0, 80),
        });
        // Save user message to DB even if we didn't respond
        this.saveMessageToDb(chatGuid, userHandle, message.text, '');
        return;
      }

      if (response && response.content) {
        // Simulate typing indicator: add a human-like delay before sending
        // based on response length (roughly 30-50 WPM typing speed)
        const responseLen = response.content.length;
        const minDelayMs = 800;
        const maxDelayMs = 3000;
        const typingDelayMs = Math.min(maxDelayMs, Math.max(minDelayMs, responseLen * 15));
        await new Promise((resolve) => setTimeout(resolve, typingDelayMs));

        // Detect if user asked for links/URLs
        const userAskedForLinks = /\b(link|url|website|source|http)\b/i.test(message.text);

        // Run MessageFormatter pipeline (Phase 2a, task 2.4)
        const formatted = messageFormatter.format(response.content, {
          allowUrls: userAskedForLinks,
        });

        if (formatted.wasSanitized) {
          log('warn', 'Response was sanitized by output filter', { chatGuid });
        }

        // Send formatted chunks
        let allSent = true;
        const chunkDelayMs = getSettingFloat('agent.splitDelaySeconds', 1.5) * 1000;

        for (let i = 0; i < formatted.chunks.length; i++) {
          if (i > 0 && chunkDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, chunkDelayMs));
          }
          const sent = await iMessageService.sendMessage(chatGuid, formatted.chunks[i]);
          if (!sent) {
            allSent = false;
            log('error', 'Failed to send response chunk', { chunkIndex: i, totalChunks: formatted.chunks.length });
            break;
          }
        }

        if (allSent) {
          const fullResponse = formatted.chunks.join('\n\n');

          // Add assistant response to context
          context.messages.push({
            role: 'assistant',
            content: fullResponse,
          });

          // Save to database
          this.saveMessageToDb(chatGuid, userHandle, message.text, fullResponse);

          log('info', 'Response sent', {
            to: userHandle,
            chatGuid,
            preview: fullResponse.substring(0, 100),
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            totalTokens: response.inputTokens + response.outputTokens,
            toolsUsed: response.toolsUsed?.join(', ') || 'none',
            chunks: formatted.chunks.length,
            wasTruncated: formatted.wasTruncated,
            originalLength: formatted.originalLength,
            processedLength: formatted.processedLength,
            typingDelayMs,
          });

          this.emit('messageSent', {
            chatGuid,
            userHandle,
            userMessage: message.text,
            assistantResponse: fullResponse,
          });
        } else {
          log('error', 'Failed to send response');
        }
      } else {
        log('error', 'No response generated from Claude');
      }

      // Note: Mark as read requires Private API, skipping
    } catch (error: any) {
      log('error', 'Error processing message', {
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 3).join(' | '),
        from: userHandle,
        chatGuid,
        messagePreview: message.text.substring(0, 80),
      });
      this.emit('error', error);
    } finally {
      this.processingQueue.delete(message.guid);
      this.chatLocks.delete(chatGuid);

      // Process next queued message for this chat, if any
      const queue = this.chatQueues.get(chatGuid);
      if (queue && queue.length > 0) {
        const next = queue.shift()!;
        if (queue.length === 0) this.chatQueues.delete(chatGuid);
        this.handleIncomingMessage(next).catch(err =>
          log('error', 'Error processing queued message', { error: err.message })
        );
      }
    }

    // Evict stale conversation contexts to prevent memory leak (fixes D3)
    this.evictStaleConversations();
  }

  private evictStaleConversations(): void {
    const now = Date.now();
    if (this.conversations.size <= MAX_CONVERSATIONS) {
      // Only do TTL check
      for (const [key, ctx] of this.conversations) {
        if (now - ctx.lastActivity > CONVERSATION_TTL_MS) {
          this.conversations.delete(key);
        }
      }
    } else {
      // Over limit — evict oldest entries
      const entries = [...this.conversations.entries()]
        .sort((a, b) => a[1].lastActivity - b[1].lastActivity);
      const toEvict = entries.slice(0, entries.length - MAX_CONVERSATIONS);
      for (const [key] of toEvict) {
        this.conversations.delete(key);
      }
    }
  }

  private saveMessageToDb(
    chatGuid: string,
    userHandle: string,
    userMessage: string,
    assistantResponse: string
  ): void {
    try {
      const db = getDatabase();

      // Get or create user (id is TEXT, so we need to generate a UUID)
      let user = db
        .prepare('SELECT id FROM users WHERE handle = ?')
        .get(userHandle) as { id: string } | undefined;

      if (!user) {
        const userId = crypto.randomUUID();
        log('info', 'Creating new user', { userId, handle: userHandle });
        try {
          db.prepare('INSERT INTO users (id, handle, display_name) VALUES (?, ?, ?)')
            .run(userId, userHandle, userHandle);
          user = { id: userId };
        } catch (insertError: any) {
          log('error', 'Failed to create user', { error: insertError.message });
          // Try to fetch again in case of race condition
          user = db
            .prepare('SELECT id FROM users WHERE handle = ?')
            .get(userHandle) as { id: string } | undefined;
        }
      }

      if (!user || !user.id) {
        log('error', 'Could not get or create user', { handle: userHandle });
        return;
      }

      // Get or create conversation - check by chat_guid first
      let conversation = db
        .prepare('SELECT id, user_id FROM conversations WHERE chat_guid = ?')
        .get(chatGuid) as { id: string; user_id: string } | undefined;

      if (!conversation) {
        const conversationId = crypto.randomUUID();
        log('info', 'Creating new conversation', { conversationId, chatGuid, userId: user.id });
        db.prepare('INSERT INTO conversations (id, user_id, chat_guid) VALUES (?, ?, ?)')
          .run(conversationId, user.id, chatGuid);
        conversation = { id: conversationId, user_id: user.id };
      } else if (!conversation.user_id) {
        // Fix existing conversation with missing user_id
        log('info', 'Fixing conversation with missing user_id', { conversationId: conversation.id, userId: user.id });
        db.prepare('UPDATE conversations SET user_id = ? WHERE id = ?')
          .run(user.id, conversation.id);
      }

      // Save user message
      const userMsgId = crypto.randomUUID();
      db.prepare(
        'INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)'
      ).run(userMsgId, conversation.id, 'user', userMessage);

      // Save assistant response
      const assistantMsgId = crypto.randomUUID();
      db.prepare(
        'INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)'
      ).run(assistantMsgId, conversation.id, 'assistant', assistantResponse);

      // Update conversation last_message_at (fixes B12)
      db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?')
        .run(new Date().toISOString(), conversation.id);
      
      log('info', 'Messages saved to database', { conversationId: conversation.id });
    } catch (error: any) {
      log('error', 'Failed to save message to database', { error: error.message, stack: error.stack });
    }
  }

  /**
   * Budget circuit breaker (Phase 1, task 1.3).
   * Checks today's total token usage against the daily budget.
   * Returns true if budget is exceeded.
   */
  private isBudgetExceeded(): boolean {
    try {
      const dailyBudgetCents = getSettingInt('security.dailyBudgetCents', 0); // 0 = no limit
      if (dailyBudgetCents <= 0) return false;

      const db = getDatabase();
      const today = new Date().toISOString().split('T')[0];
      const row = db.prepare(
        'SELECT SUM(input_tokens) as inputTokens, SUM(output_tokens) as outputTokens FROM api_usage WHERE date = ?'
      ).get(today) as { inputTokens: number | null; outputTokens: number | null } | undefined;

      if (!row || (!row.inputTokens && !row.outputTokens)) return false;

      const inputTokens = row.inputTokens || 0;
      const outputTokens = row.outputTokens || 0;

      // Per-model cost calculation ($/1M tokens → cents/1M tokens)
      const MODEL_COST: Record<string, { input: number; output: number }> = {
        'claude-haiku-4-5-20251001':  { input: 80,   output: 400  },
        'claude-sonnet-4-5-20250929': { input: 300,  output: 1500 },
        'claude-sonnet-4-20250514':   { input: 300,  output: 1500 },
        'claude-sonnet-4-6':          { input: 300,  output: 1500 },
        'claude-opus-4-6':            { input: 1500, output: 7500 },
      };
      const DEFAULT_COST = { input: 300, output: 1500 };

      let model = 'claude-haiku-4-5-20251001';
      try {
        const raw = getSetting('anthropic.model');
        if (raw) model = JSON.parse(raw);
      } catch { /* use default */ }

      const cost = MODEL_COST[model] || DEFAULT_COST;
      const costCents = (inputTokens / 1_000_000) * cost.input + (outputTokens / 1_000_000) * cost.output;

      if (costCents >= dailyBudgetCents) {
        log('warn', 'Daily budget exceeded', {
          costCents: Math.round(costCents * 100) / 100,
          dailyBudgetCents,
          inputTokens,
          outputTokens,
        });
        return true;
      }

      return false;
    } catch (error: any) {
      log('error', 'Budget check failed', { error: error.message });
      return false; // Allow through on error rather than blocking
    }
  }

  /**
   * Normalize a phone handle to a more readable contact name (task 2.4).
   * Strips country code prefixes, normalizes to last 10 digits for US numbers.
   * If handle is an email or already a name, returns as-is.
   */
  private contactNameCache = new Map<string, string>();

  private normalizeContactName(handle: string): string {
    if (!handle) return 'Unknown';
    // If it's an email address, return as-is
    if (handle.includes('@')) return handle;

    // Check cache first
    if (this.contactNameCache.has(handle)) {
      return this.contactNameCache.get(handle)!;
    }

    // Try to look up contact name via node-mac-contacts
    try {
      const macContacts = require('node-mac-contacts');
      if (macContacts.getAuthStatus() === 'Authorized') {
        const allContacts = macContacts.getAllContacts();
        const digits = handle.replace(/\D/g, '');
        const last10 = digits.length >= 10 ? digits.slice(-10) : digits;

        for (const contact of allContacts) {
          const phones: string[] = contact.phoneNumbers || [];
          for (const phone of phones) {
            const phoneDigits = phone.replace(/\D/g, '');
            const phoneLast10 = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : phoneDigits;
            if (last10.length >= 7 && phoneLast10 === last10) {
              const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
              if (name) {
                this.contactNameCache.set(handle, name);
                return name;
              }
            }
          }
        }
      }
    } catch {
      // node-mac-contacts not available or permission denied — fall through
    }

    // Fallback: format phone number
    const digits = handle.replace(/\D/g, '');
    if (digits.length === 0) return handle;
    if (digits.length === 11 && digits.startsWith('1')) {
      const formatted = `(${digits.substring(1, 4)}) ${digits.substring(4, 7)}-${digits.substring(7, 11)}`;
      this.contactNameCache.set(handle, formatted);
      return formatted;
    }
    if (digits.length === 10) {
      const formatted = `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6, 10)}`;
      this.contactNameCache.set(handle, formatted);
      return formatted;
    }
    return handle;
  }

  getStatus(): {
    isRunning: boolean;
    isConnected: boolean;
    activeConversations: number;
    processingCount: number;
  } {
    return {
      isRunning: this.isRunning,
      isConnected: iMessageService.isConnected(),
      activeConversations: this.conversations.size,
      processingCount: this.processingQueue.size,
    };
  }

  // Manual message send (from dashboard)
  async sendManualMessage(chatGuid: string, text: string): Promise<boolean> {
    return iMessageService.sendMessage(chatGuid, text);
  }

  // Check iMessage permissions
  async checkPermissions(): Promise<{ hasAccess: boolean; error?: string }> {
    return iMessageService.checkPermissions();
  }
}

// Singleton instance
export const agentService = new AgentService();
