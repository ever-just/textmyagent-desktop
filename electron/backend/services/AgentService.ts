import { EventEmitter } from 'events';
import crypto from 'crypto';
import { iMessageService, IMessage } from './iMessageService';
import { localLLMService, Message } from './LocalLLMService';
import { log, logSecurityEvent } from '../logger';
import { getDatabase, getSetting, getSettingInt, getSettingFloat, getSettingBool } from '../database';
import { rateLimiter } from './RateLimiter';
import { messageFormatter } from './MessageFormatter';
import { memoryService } from './MemoryService';
import { metricsService } from './MetricsService';

interface ConversationContext {
  chatGuid: string;
  userHandle: string;
  messages: Message[];
  lastActivity: number;
}

// Max age for conversation context entries before eviction (1 hour)
const CONVERSATION_TTL_MS = 60 * 60 * 1000;
const MAX_CONVERSATIONS = 500;
// Phase 3.1: conversations touched within this window skip history reload from iMessage DB
const WARM_CONTEXT_MS = 10 * 60 * 1000; // 10 min

export class AgentService extends EventEmitter {
  private isRunning = false;
  private conversations: Map<string, ConversationContext> = new Map();
  private processingQueue: Set<string> = new Set(); // message guid dedup
  private chatLocks: Set<string> = new Set(); // per-chat concurrency lock (fixes C1)
  private chatQueues: Map<string, IMessage[]> = new Map(); // per-chat message queue
  private static MAX_CHAT_QUEUE_SIZE = 5;
  private static MAX_API_CALLS_PER_MESSAGE = 6; // Phase 1, task 1.4: per-message cost cap
  private maxHistoryMessages = 20;
  // Phase 4.2: guard against summarizing the same chat multiple times in parallel
  // (e.g., if LRU eviction and idle TTL fire close together).
  private summarizationInFlight: Set<string> = new Set();

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

    // Phase 4.2: register auto-summarization handler on the LLM service.
    // Runs whenever a session is evicted (LRU / idle TTL / manual) so the
    // conversation's value is captured as a structured summary + facts
    // before the KV cache is gone.
    localLLMService.onSessionEvicted((chatGuid, reason) => {
      // Fire-and-forget: don't block eviction on summarization
      void this.summarizeEvictedSession(chatGuid, reason);
    });
  }

  /**
   * Phase 4.2: Summarize a conversation before/after its session is evicted.
   * Uses raw transcript + a fresh LLM call — does NOT touch the evicted session's
   * KV cache (which would pollute it).
   * Resolves to the saved summary text, or null if nothing worth summarizing.
   */
  private async summarizeEvictedSession(chatGuid: string, reason: string): Promise<string | null> {
    // Only run if auto-summarization is enabled in settings (default on)
    if (!getSettingBool('memory.enableSummarization', true)) {
      return null;
    }

    // Prevent duplicate summarization for the same chat
    if (this.summarizationInFlight.has(chatGuid)) {
      log('debug', 'Summarization already in flight for chat, skipping', { chatGuid, reason });
      return null;
    }

    const ctx = this.conversations.get(chatGuid);
    if (!ctx || ctx.messages.length < 4) {
      log('debug', 'Skipping summarization — too little conversation to summarize', {
        chatGuid, reason, messageCount: ctx?.messages.length ?? 0,
      });
      return null;
    }

    this.summarizationInFlight.add(chatGuid);
    try {
      const messagesToSummarize = ctx.messages.slice(-20); // last 20 turns
      const transcript = messagesToSummarize
        .map(m => `${m.role === 'user' ? ctx.userHandle : 'assistant'}: ${m.content}`)
        .join('\n');

      // Use the dedicated summarization API — it uses an ephemeral session
      // (not the pool), no tools, its own system prompt, and a tight 30s timeout.
      const result = await localLLMService.generateSummary(transcript);
      if (!result || !result.content) {
        log('warn', 'Summarization produced empty response', { chatGuid, reason });
        return null;
      }

      const summary = result.content;

      // Find the conversation DB id so we can save to the right row
      const db = getDatabase();
      const conv = db.prepare('SELECT id FROM conversations WHERE chat_guid = ?').get(chatGuid) as { id: string } | undefined;
      if (!conv) {
        log('debug', 'No DB conversation row for chat — skipping summary persist', { chatGuid });
        return summary;
      }

      memoryService.saveSummary(conv.id, summary);
      log('info', 'Auto-summary saved on eviction', {
        chatGuid,
        reason,
        summaryLength: summary.length,
        durationMs: result.durationMs,
        messageCount: messagesToSummarize.length,
        preview: summary.substring(0, 120),
      });

      return summary;
    } catch (err) {
      // Non-fatal: summarization errors must not break the agent
      log('warn', 'Auto-summarization failed', {
        chatGuid, reason,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      this.summarizationInFlight.delete(chatGuid);
    }
  }

  async start(): Promise<boolean> {
    if (this.isRunning) {
      log('warn', 'Agent is already running');
      return true;
    }

    log('info', 'Starting AI agent...');

    // Always sync settings from database (model, maxTokens, temperature)
    localLLMService.syncSettings();

    // Ensure local model is loaded
    if (!localLLMService.isConfigured()) {
      try {
        await localLLMService.initModel();
      } catch {
        log('error', 'Cannot start agent: Local model not loaded');
        return false;
      }
      if (!localLLMService.isConfigured()) {
        log('error', 'Cannot start agent: Local model not available');
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
      metricsService.recordEvent(chatGuid, 'rate_limited');
      return;
    }

    // Prevent duplicate message processing
    if (this.processingQueue.has(message.guid)) {
      return;
    }
    this.processingQueue.add(message.guid);

    // Per-chat lock: only one message processed per chat at a time (fixes C1)
    if (this.chatLocks.has(chatGuid)) {
      // Queue message instead of dropping it.
      // Phase 4.1: On overflow, drop the NEW incoming message rather than the oldest.
      // Rationale: conversation coherence breaks badly if early context is silently
      // discarded. A rejected incoming message is noticeable; a lost early question
      // leaves the agent responding to phantom context.
      const queue = this.chatQueues.get(chatGuid) || [];
      if (queue.length >= AgentService.MAX_CHAT_QUEUE_SIZE) {
        log('warn', 'Chat queue full, dropping NEW incoming message to preserve context', {
          chatGuid,
          queueLength: queue.length,
          droppedGuid: message.guid,
          droppedPreview: (message.text || '').substring(0, 80),
        });
        metricsService.recordEvent(chatGuid, 'queue_dropped');
        this.processingQueue.delete(message.guid);
        return;
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

      // Phase 3.1: Skip iMessage DB history reload when conversation is already WARM
      // (touched recently). Warm context means we still have prior messages in memory
      // and the LLM session pool likely still has the KV cache hot too.
      // Only cold conversations (new or >10 min idle) trigger the full history load.
      let context = this.conversations.get(chatGuid);
      const isWarm = context && (Date.now() - context.lastActivity < WARM_CONTEXT_MS);

      // Fetch iMessage history only when cold (saves ~100-300ms per warm message)
      let history: IMessage[] = [];
      if (!isWarm) {
        history = await iMessageService.getConversationHistory(chatGuid, 10);
      } else {
        // Warm path: still grab 1 message for time-awareness accuracy
        history = await iMessageService.getConversationHistory(chatGuid, 1);
      }

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
        log('debug', 'Cold-start: loaded conversation history from iMessage', {
          chatGuid,
          messagesLoaded: context.messages.length,
        });
      } else if (isWarm) {
        log('debug', 'Warm conversation: reusing in-memory context (skipped full history reload)', {
          chatGuid,
          messageCount: context.messages.length,
        });
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

      // Auto-save resolved contact name as a user fact if it's a real name (not a phone number)
      if (contactName && contactName !== userHandle && !/^[\d\s()+-]+$/.test(contactName)) {
        try {
          const factContent = `Name is ${contactName}`;
          const existingFacts = memoryService.getUserFacts(userHandle);
          const alreadySaved = existingFacts.some((f) => f.content === factContent);
          if (!alreadySaved) {
            memoryService.saveFact(userHandle, factContent, 'preference', 'contact_lookup', 1.0);
            log('info', 'Auto-saved contact name as user fact', { handle: userHandle, contactName });
          }
        } catch { /* non-fatal */ }
      }

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

      // Phase 5.3: Load most recent conversation summary for cold-start context.
      // When a returning user messages after their session was evicted, the summary
      // gives the LLM structural recall of the prior conversation without needing to
      // prefill the full message history.
      let conversationSummary: string | null = null;
      if (!isWarm) {
        try {
          const db = getDatabase();
          const conv = db.prepare('SELECT id FROM conversations WHERE chat_guid = ?').get(chatGuid) as { id: string } | undefined;
          if (conv) {
            const latest = memoryService.getLatestSummary(conv.id);
            if (latest) {
              conversationSummary = latest.summary;
              log('debug', 'Loaded conversation summary for cold-start', {
                chatGuid,
                summaryLength: conversationSummary.length,
              });
            }
          }
        } catch (err) {
          log('debug', 'Failed to load conversation summary (non-fatal)', {
            chatGuid,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Generate AI response (Phase 3: pass tool context + prompt context)
      let response = await localLLMService.generateResponse(
        message.text,
        context.messages.slice(0, -1), // Exclude the current message (it's passed separately)
        undefined, // systemPrompt — use PromptBuilder default
        { date: dateContext, contactName, userFacts, chatType, conversationSummary: conversationSummary ?? undefined },
        { userId: userHandle, chatGuid }
      );

      // Retry once if first attempt failed (context may have been recycled after error)
      if (!response) {
        log('warn', 'LLM returned null, retrying once...', { chatGuid, from: userHandle });
        response = await localLLMService.generateResponse(
          message.text,
          context.messages.slice(0, -1),
          undefined,
          { date: dateContext, contactName, userFacts, chatType, conversationSummary: conversationSummary ?? undefined },
          { userId: userHandle, chatGuid }
        );
      }

      // If agent called 'wait' tool, skip sending a text response entirely
      if (response && response.toolsUsed?.includes('wait')) {
        log('info', 'Agent chose to wait — no text response sent', {
          from: userHandle,
          chatGuid,
          toolsUsed: response.toolsUsed?.join(', '),
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          durationMs: response.durationMs,
          userMessagePreview: message.text.substring(0, 80),
        });
        if (response.durationMs) {
          metricsService.recordLatency(response.durationMs, isWarm ? 'warm' : 'cold', response.toolsUsed?.length || 0);
        }
        metricsService.recordEvent(chatGuid, 'wait');
        // Save user message to DB even if we didn't respond
        this.saveMessageToDb(chatGuid, userHandle, message.text, '', contactName);
        return;
      }

      // If response content is empty but tools were used (e.g. raw tool call
      // was stripped after execution), skip sending — the tool action was the response.
      if (response && (!response.content || response.content.trim() === '') && response.toolsUsed?.length > 0) {
        log('info', 'Tool-only response — no text to send', {
          from: userHandle,
          chatGuid,
          toolsUsed: response.toolsUsed?.join(', '),
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          durationMs: response.durationMs,
        });
        if (response.durationMs) {
          metricsService.recordLatency(response.durationMs, isWarm ? 'warm' : 'cold', response.toolsUsed?.length || 0);
        }
        metricsService.recordEvent(chatGuid, 'tool_only');
        this.saveMessageToDb(chatGuid, userHandle, message.text, '', contactName);
        return;
      }

      if (response && response.content) {
        const typingDelayMs = 0; // Removed for responsiveness — inference already provides natural delay

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
          this.saveMessageToDb(chatGuid, userHandle, message.text, fullResponse, contactName);

          // Phase 5.4: record metrics for successful response
          if (response.durationMs) {
            metricsService.recordLatency(response.durationMs, isWarm ? 'warm' : 'cold', response.toolsUsed?.length || 0);
          }
          metricsService.recordEvent(chatGuid, 'sent');

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
            inferenceDurationMs: response.durationMs,
            warmPath: isWarm,
          });

          this.emit('messageSent', {
            chatGuid,
            userHandle,
            userMessage: message.text,
            assistantResponse: fullResponse,
          });
        } else {
          log('error', 'Failed to send response');
          metricsService.recordEvent(chatGuid, 'error');
        }
      } else {
        log('error', 'No response generated from local LLM');
        metricsService.recordEvent(chatGuid, 'error');
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
      metricsService.recordEvent(chatGuid, 'error');
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

  /**
   * Phase 5.4: Observability hook for the /api/metrics endpoint.
   * Returns per-chat queue depths and an aggregate count.
   */
  getQueueStats(): {
    activeChats: number;
    totalQueued: number;
    perChat: Array<{ chatGuid: string; queueLength: number }>;
  } {
    const perChat: Array<{ chatGuid: string; queueLength: number }> = [];
    let totalQueued = 0;
    for (const [chatGuid, q] of this.chatQueues) {
      perChat.push({ chatGuid, queueLength: q.length });
      totalQueued += q.length;
    }
    return {
      activeChats: this.chatLocks.size,
      totalQueued,
      perChat,
    };
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
    assistantResponse: string,
    contactName?: string
  ): void {
    try {
      const db = getDatabase();

      // Determine display name: use resolved contact name if available, else handle
      const displayName = (contactName && contactName !== userHandle && !/^[\d\s()+-]+$/.test(contactName))
        ? contactName
        : userHandle;

      // Get or create user (id is TEXT, so we need to generate a UUID)
      let user = db
        .prepare('SELECT id, display_name FROM users WHERE handle = ?')
        .get(userHandle) as { id: string; display_name: string | null } | undefined;

      if (!user) {
        const userId = crypto.randomUUID();
        log('info', 'Creating new user', { userId, handle: userHandle, displayName });
        try {
          db.prepare('INSERT INTO users (id, handle, display_name) VALUES (?, ?, ?)')
            .run(userId, userHandle, displayName);
          user = { id: userId, display_name: displayName };
        } catch (insertError: any) {
          log('error', 'Failed to create user', { error: insertError.message });
          // Try to fetch again in case of race condition
          user = db
            .prepare('SELECT id, display_name FROM users WHERE handle = ?')
            .get(userHandle) as { id: string; display_name: string | null } | undefined;
        }
      } else if (displayName !== userHandle && user.display_name === userHandle) {
        // Update display_name if we now have a real contact name but DB still has the phone number
        db.prepare('UPDATE users SET display_name = ?, updated_at = datetime(\'now\') WHERE handle = ?')
          .run(displayName, userHandle);
        log('info', 'Updated user display name from contacts', { handle: userHandle, displayName });
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
   * Budget check — enforces a daily token cap for local inference.
   * Setting value 0 = unlimited.
   */
  private isBudgetExceeded(): boolean {
    try {
      const dailyTokenBudget = getSettingInt('security.dailyBudgetCents', 0);
      if (dailyTokenBudget <= 0) return false;

      const db = getDatabase();
      const today = new Date().toISOString().split('T')[0];
      const row = db.prepare(
        'SELECT SUM(total_tokens) as totalTokens FROM api_usage WHERE date = ?'
      ).get(today) as { totalTokens: number | null } | undefined;

      const totalTokens = row?.totalTokens || 0;
      if (totalTokens >= dailyTokenBudget) {
        log('warn', 'Daily token budget exceeded', { dailyTokenBudget, totalTokens });
        return true;
      }
      return false;
    } catch {
      return false;
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
