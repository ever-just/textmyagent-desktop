# TextMyAgent Upgrade — Full Repo Impact Analysis

> Companion to `AGENT_UPGRADE_PLAN.md`
> Every existing file reviewed against every planned change
> Identifies exactly what must change, what breaks if it doesn't, and cross-file dependencies

---

## Table of Contents

1. [Files That Need Changes (Existing)](#1-files-that-need-changes)
2. [Files That Need NO Changes](#2-files-that-need-no-changes)
3. [New Files to Create](#3-new-files-to-create)
4. [Cross-Cutting Concerns & Gotchas](#4-cross-cutting-concerns)
5. [Dependency & Build Changes](#5-dependency--build-changes)
6. [Breaking Change Register](#6-breaking-change-register)
7. [Startup & Shutdown Sequence Changes](#7-startup--shutdown-sequence)
8. [Missing Items Not in the Upgrade Plan](#8-missing-items)

---

## 1. Files That Need Changes

### 1.1 `electron/backend/database.ts` (284 lines) — HEAVY

**Current role:** SQLite schema, migrations, getSetting/setSetting helpers.

**Changes required:**

- **4 new migrations** (append to existing migration chain):
  - Migration 4: `tool_executions` table (id, user_id, tool_name, input, output, success, error, duration_ms, created_at)
  - Migration 5: `security_events` table (id, event_type, user_handle, details, severity, created_at) + indexes
  - Migration 6: `ALTER TABLE context ADD COLUMN source TEXT DEFAULT 'agent'` + `ADD COLUMN last_used_at TEXT`
  - Migration 7: Seed all default settings — must be idempotent (`INSERT OR IGNORE` or check-then-set)

- **New typed setting helpers** — the existing `getSetting(key): string | null` returns raw strings. All new settings use typed values. Add:
  ```
  getSettingBool(key, defaultValue): boolean
  getSettingInt(key, defaultValue): number
  getSettingFloat(key, defaultValue): number
  ```
  These prevent every caller from having to `parseInt()` / `=== 'true'` manually.

- **New data access functions** (or expose them from new service files):
  - `logSecurityEvent(type, handle, details, severity)` — insert into security_events
  - `getSecurityEvents(filters)` — query security_events with type/severity/date filters
  - `logToolExecution(userId, toolName, input, output, success, error, durationMs)` — insert into tool_executions
  - `getToolExecutions(filters)` — query tool_executions
  - Context table CRUD: `saveUserFact()`, `getUserFacts(userId)`, `deleteUserFact(id)`, `getExpiredFacts()`, `purgeExpiredFacts()`, `touchFactLastUsed(id)`
  - Reminder helpers: `getDueReminders()`, `markReminderDelivered(id)`, `createReminder()`, `deleteReminder(id)`
  - Trigger helpers: `getDueTriggers()`, `updateTriggerLastRun(id, nextRunAt)`, `createTrigger()`, `deleteTrigger(id)`, `updateTrigger(id, fields)`

- **`seedDefaultSettings()` function** — called once after `initializeDatabase()`. Populates all 30+ setting keys with defaults using `INSERT OR IGNORE` semantics. Must be synchronous (runs before server starts).

**Breaks if skipped:** New services will crash querying non-existent tables. Settings will return null instead of defaults. Budget/rate limit features non-functional.

---

### 1.2 `electron/backend/services/ClaudeService.ts` (148 lines) — HEAVY

**Current role:** Wraps Anthropic SDK. Hardcoded system prompt. Returns `string`.

**Changes required:**

- **Remove hardcoded `defaultSystemPrompt`** (lines 83–91). Replace with: accept the assembled prompt from PromptBuilder via parameter.

- **Change `generateResponse()` signature:**
  ```
  // CURRENT (line ~93):
  async generateResponse(messages, systemPrompt?, model?, temperature?, maxTokens?): Promise<string>

  // NEW:
  async generateResponse(options: {
    messages: Array<{role: string, content: string}>,
    systemBlocks: Array<{type: 'text', text: string, cache_control?: {type: 'ephemeral'}}>,
    model?: string,
    temperature?: number,
    maxTokens?: number,
    tools?: ToolDefinition[],
  }): Promise<GenerateResult>
  ```

- **New return type `GenerateResult`:**
  ```
  interface GenerateResult {
    text: string;
    usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number };
    toolCalls?: Array<{ id: string; name: string; input: any }>;
    stopReason: string;
  }
  ```

- **Tool calling loop:** When `stop_reason === 'tool_use'`:
  1. Extract tool_use blocks from response
  2. Return them to the caller (AgentService) for execution
  3. Accept tool_result messages and continue the conversation
  4. Loop up to `MAX_TOOL_ITERATIONS = 5` to prevent runaway calls
  5. Each iteration is a separate API call — track cumulative usage

- **Prompt caching:** Pass the static system prompt block with `cache_control: { type: "ephemeral" }`. The `systemBlocks` parameter is an array so static and dynamic blocks are separate.

- **Token usage extraction:** The Anthropic SDK response already includes `response.usage.input_tokens` and `response.usage.output_tokens` — extract and return them in `GenerateResult.usage`.

**Breaks if skipped:** AgentService can't pass tools, can't get structured responses, can't track token usage for budget, can't use prompt caching. Essentially every new feature depends on this.

---

### 1.3 `electron/backend/services/AgentService.ts` (366 lines) — HEAVIEST

**Current role:** Core message processing loop. Manages in-memory conversation context. Calls ClaudeService. Sends responses via iMessageService.

**Changes required (in order of execution flow):**

1. **Import new services** at top of file:
   - PromptBuilder, MemoryService, RateLimiter, OutputSanitizer, ToolRegistry
   - Plus new DB helpers for security events, api_usage

2. **`handleIncomingMessage()` — add security gate (top of function, ~line 130):**
   ```
   // CHECK 1: Is user blocked?
   const user = db.prepare('SELECT is_blocked FROM users WHERE handle = ?').get(handleId);
   if (user?.is_blocked) {
     logSecurityEvent('blocked_user', handleId, { messagePreview: text.substring(0,50) }, 'medium');
     return; // Silent drop
   }

   // CHECK 2: Rate limit
   if (!rateLimiter.allowMessage(handleId)) {
     logSecurityEvent('rate_limit', handleId, {}, 'low');
     await iMessageService.sendMessage(chatGuid, getSettingOrDefault('rateLimit.responseMessage', '...'));
     return;
   }

   // CHECK 3: Budget circuit breaker
   if (budgetExceeded()) {
     logSecurityEvent('budget_exceeded', handleId, {}, 'high');
     await iMessageService.sendMessage(chatGuid, 'I\'ve reached my daily limit. I\'ll be back tomorrow!');
     return;
   }
   ```

3. **Replace system prompt assembly (~line 195):**
   - Currently: reads `systemPrompt` setting or uses hardcoded default
   - New: call `promptBuilder.assemble({ userId, contactName, chatType, userFacts, conversationSummary, enabledTools, date })`
   - This returns the structured system blocks (static + dynamic) for ClaudeService

4. **Contact name resolution (before prompt assembly):**
   - Look up `users.display_name` in DB
   - If null and Contacts permission granted: query `node-mac-contacts` by handle
   - Cache result in a `Map<string, string>` to avoid repeated lookups
   - Pass resolved name to PromptBuilder

5. **Group chat detection:**
   - Inspect `chatGuid` format — group chats contain multiple participants
   - Query iMessage DB for participant count if needed
   - Set `chatType = 'group' | 'direct'` for PromptBuilder
   - If group + behavior setting is "addressed only": check if message mentions agent name, skip if not

6. **Replace naive context truncation with smart context management (~line 170):**
   - Before: `if (messages.length > maxMessages) messages = messages.slice(-maxMessages)`
   - After:
     a. Filter low-value messages (filler: "ok", "k", "lol", "👍", etc.)
     b. If remaining messages > threshold (e.g., 12): summarize oldest N via MemoryService
     c. Replace summarized messages with summary text
     d. Read `agent.conversationTimeoutMin` and `agent.maxHistoryMessages` from settings instead of hardcoded values

7. **Pass tools to ClaudeService (~line 200):**
   - Get enabled tools from ToolRegistry (reads `tools.*` settings)
   - Pass tool definitions to `claudeService.generateResponse()`
   - Handle `GenerateResult.toolCalls`: execute each via ToolRegistry, collect results
   - If tool calls present: send tool results back to ClaudeService for final response (multi-turn)

8. **Post-response processing:**
   - **Fact extraction:** Call MemoryService to extract/save user facts from the conversation
   - **Output sanitization:** Run response through OutputSanitizer before sending
   - **Security event logging:** If sanitizer flags something, log it
   - **Multi-message splitting:** If response > threshold, split at natural boundaries, send with delays
   - **API usage logging:** Use the `GenerateResult.usage` data for accurate token tracking

9. **`evictStaleConversations()` enhancement:**
   - Before evicting: save conversation summary to `context` table via MemoryService
   - This preserves cross-session continuity

10. **`getStatus()` return type expansion:**
    - Add: `budgetExceeded: boolean`, `budgetUsedToday: number`, `budgetLimit: number`, `rateLimitedCount: number`
    - Dashboard polls this for status display

**Breaks if skipped:** The entire upgrade plan is dead — this file is the orchestration point for every new feature.

---

### 1.4 `electron/backend/services/iMessageService.ts` (503 lines) — MODERATE

**Current role:** Polls macOS iMessage DB. Sends messages via AppleScript.

**Changes required:**

1. **Adaptive polling — replace `setInterval` with `setTimeout` chain (lines 109–111):**
   ```
   // CURRENT:
   this.pollInterval = setInterval(async () => {
     await this.pollNewMessages();
   }, intervalMs);

   // NEW:
   private async schedulePoll(): Promise<void> {
     if (!this.isRunning) return;
     await this.pollNewMessages();
     const interval = this.getCurrentInterval();
     this.pollTimeout = setTimeout(() => this.schedulePoll(), interval);
   }

   private getCurrentInterval(): number {
     const now = Date.now();
     const idleTimeout = getSettingInt('polling.idleTimeoutMin', 2) * 60 * 1000;
     const timeSinceLastMsg = now - this.lastMessageTime;

     if (timeSinceLastMsg < idleTimeout) return getSettingInt('polling.activeIntervalMs', 2000);
     if (timeSinceLastMsg < idleTimeout * 5) return getSettingInt('polling.idleIntervalMs', 5000);
     return getSettingInt('polling.deepIdleIntervalMs', 15000);
   }
   ```
   - Add `private lastMessageTime: number = Date.now()` field
   - Update `lastMessageTime` when a message is emitted
   - Change `pollInterval: NodeJS.Timeout` to `pollTimeout: NodeJS.Timeout` (setTimeout, not setInterval)
   - Update `stopPolling()` to use `clearTimeout` instead of `clearInterval`

2. **Multi-message sending — add `sendMessages()` method:**
   ```
   async sendMessages(chatGuid: string, messages: string[], delayMs: number): Promise<boolean> {
     for (let i = 0; i < messages.length; i++) {
       const success = await this.sendMessage(chatGuid, messages[i]);
       if (!success) return false;
       if (i < messages.length - 1) await this.delay(delayMs);
     }
     return true;
   }
   ```

3. **Group chat participant resolution — add method:**
   ```
   async getChatParticipantCount(chatGuid: string): Promise<number>
   ```
   - Query iMessage DB: `SELECT COUNT(*) FROM chat_handle_join WHERE chat_id = (SELECT ROWID FROM chat WHERE guid = ?)`
   - Used by AgentService for group chat detection

4. **Contact name lookup — add method:**
   ```
   async resolveContactName(handle: string): Promise<string | null>
   ```
   - Use `node-mac-contacts` to search by phone/email
   - Return display name or null
   - Called by AgentService, result cached there

**Breaks if skipped:** Fixed 2-second polling wastes CPU during idle. No multi-message splitting. No group chat detection. No contact name display.

---

### 1.5 `electron/backend/routes/dashboard.ts` (752 lines) — HEAVY EXPANSION

**Current role:** All dashboard API endpoints (status, config, logs, users, messages, usage, permissions, agent control).

**Changes required:**

- **Split into multiple route files** to keep each under ~300 lines:
  - `routes/dashboard.ts` — keep existing routes (status, config, logs, users, messages, usage, permissions, agent control)
  - `routes/agent.ts` — NEW: prompt CRUD, prompt preview, behavior config
  - `routes/security.ts` — NEW: security config, events, budget status, user blocking
  - `routes/memory.ts` — NEW: facts CRUD, summaries, purge, export
  - `routes/tools.ts` — NEW: tool config, reminders CRUD, triggers CRUD, execution log

- **Existing routes that need modification in dashboard.ts:**
  - `GET /config` — add all new settings keys to the response
  - `PUT /config` — validate new settings keys and value types (e.g., rate limits must be positive integers, budget must be > 0)
  - `GET /status` — include budget status, memory stats, rate limit stats in response
  - `GET /users` — include `is_blocked` field in user list response
  - `GET /users/:id/messages` — no change needed

- **Settings validation on write** — currently `PUT /config` accepts any key/value with no validation. Needs:
  - Type checking: booleans must be "true"/"false", numbers must parse correctly
  - Range checking: `rateLimit.perUserPerMinute` must be 1–1000, `budget.dailyLimitCents` must be > 0, temperature must be 0–2
  - Key allowlist: reject unknown setting keys to prevent DB pollution

- **Import new services** in each new route file as needed

**Breaks if skipped:** Dashboard has no API to call for any new feature. All new UI pages render empty or error.

---

### 1.6 `electron/backend/server.ts` (186 lines) — MODERATE

**Current role:** Express server setup, route mounting, agent auto-start, graceful shutdown.

**Changes required:**

1. **Mount new route files:**
   ```
   import { agentRoutes } from './routes/agent';
   import { securityRoutes } from './routes/security';
   import { memoryRoutes } from './routes/memory';
   import { toolsRoutes } from './routes/tools';

   app.use('/api/dashboard/agent', agentRoutes);
   app.use('/api/dashboard/security', securityRoutes);
   app.use('/api/dashboard/memory', memoryRoutes);
   app.use('/api/dashboard/tools', toolsRoutes);
   ```

2. **Start background services after agent starts (~line 140):**
   ```
   // After agentService.start():
   reminderService.start();
   triggerService.start();
   ```

3. **Stop background services on shutdown (~line 170):**
   ```
   // BEFORE agentService.stop():
   triggerService.stop();
   reminderService.stop();
   // Then: agentService.stop()
   ```
   Order matters: background services send messages via iMessageService, which is owned by agentService.

4. **Call `seedDefaultSettings()` after DB init but before server starts.**

**Breaks if skipped:** New API routes unreachable. Background services (reminders, triggers) never start. Default settings never populated.

---

### 1.7 `electron/backend/logger.ts` (85 lines) — MINOR

**Current role:** In-memory circular log buffer, SSE broadcast.

**Changes required:**

1. **Extend `LogEntry` interface:**
   ```
   export interface LogEntry {
     timestamp: string;
     level: 'error' | 'warn' | 'info' | 'debug';
     message: string;
     metadata?: Record<string, any>;
     tags?: string[];  // NEW — e.g., ['security'], ['tool'], ['memory']
   }
   ```

2. **Update `log()` function to accept tags:**
   ```
   export function log(level, message, metadata?, tags?: string[])
   ```

3. **When `tags` includes `'security'`:** Also write to `security_events` table via the DB helper. This dual-writes security logs to both the in-memory buffer (for SSE) and persistent storage (for the security dashboard).

4. **Update `query()` to filter by tags:**
   ```
   if (filters.tags?.length) {
     result = result.filter(log => log.tags?.some(t => filters.tags.includes(t)));
   }
   ```

**Breaks if skipped:** Security events only go to the general log — no dedicated security event stream or persistent security audit trail.

---

### 1.8 `electron/main.ts` (266 lines) — MINOR

**Current role:** Electron app lifecycle, window management, IPC, power events.

**Changes required:**

1. **`will-quit` handler (line 189)** — stop background services before agent:
   ```
   // ADD before agentService.stop():
   try {
     const { triggerService } = require('./backend/services/TriggerService');
     const { reminderService } = require('./backend/services/ReminderService');
     await triggerService.stop();
     await reminderService.stop();
   } catch (_e) {}
   ```

2. **`suspend` handler (line 220)** — also pause background services:
   ```
   // ADD alongside agentService.stop():
   try {
     const { triggerService } = require('./backend/services/TriggerService');
     const { reminderService } = require('./backend/services/ReminderService');
     triggerService.stop();
     reminderService.stop();
   } catch (_e) {}
   ```

3. **`resume` handler (line 229)** — also restart background services:
   ```
   // ADD alongside agentService.start():
   triggerService.start();
   reminderService.start();
   ```

4. **Consider replacing `(global as any).__agentWasRunning`** with a cleaner service state tracker, but not strictly required.

**Breaks if skipped:** Reminders/triggers keep running during system sleep (wasted resources, stale DB connections). They don't restart after wake.

---

### 1.9 `dashboard/lib/api.ts` (237 lines) — HEAVY EXPANSION

**Current role:** HTTP client functions for all dashboard API calls.

**Changes required — ~25 new functions:**

```typescript
// Agent/Prompt
export async function getPrompt(): Promise<PromptConfig>
export async function updatePrompt(data: Partial<PromptConfig>): Promise<void>
export async function resetPrompt(): Promise<void>
export async function previewPrompt(sampleData: any): Promise<{ assembled: string }>

// Security
export async function getSecurityConfig(): Promise<SecurityConfig>
export async function updateSecurityConfig(data: Partial<SecurityConfig>): Promise<void>
export async function getSecurityEvents(filters?: SecurityEventFilters): Promise<{ events: SecurityEvent[] }>
export async function getBudgetStatus(): Promise<BudgetStatus>

// User blocking
export async function blockUser(userId: string): Promise<void>
export async function unblockUser(userId: string): Promise<void>

// User facts (memory per user)
export async function getUserFacts(userId: string): Promise<{ facts: UserFact[] }>
export async function addUserFact(userId: string, data: { type: string; content: string }): Promise<UserFact>
export async function deleteUserFact(userId: string, factId: string): Promise<void>

// Memory (global view)
export async function getMemoryFacts(filters?: MemoryFilters): Promise<{ facts: UserFact[] }>
export async function getMemorySummaries(): Promise<{ summaries: ConversationSummary[] }>
export async function purgeExpiredMemory(): Promise<{ purged: number }>
export async function exportMemory(): Promise<Blob>

// Tools
export async function getToolsConfig(): Promise<ToolsConfig>
export async function updateToolsConfig(data: Partial<ToolsConfig>): Promise<void>
export async function getReminders(): Promise<{ reminders: Reminder[] }>
export async function createReminder(data: ReminderInput): Promise<Reminder>
export async function deleteReminder(id: string): Promise<void>
export async function getTriggers(): Promise<{ triggers: Trigger[] }>
export async function createTrigger(data: TriggerInput): Promise<Trigger>
export async function deleteTrigger(id: string): Promise<void>
export async function updateTrigger(id: string, data: Partial<TriggerInput>): Promise<Trigger>
export async function getToolLog(): Promise<{ executions: ToolExecution[] }>
```

**Also needs:** TypeScript interfaces for all new data types (PromptConfig, SecurityConfig, SecurityEvent, BudgetStatus, UserFact, Reminder, Trigger, ToolExecution, etc.). These should go in a new `dashboard/lib/types.ts` file.

The existing `LogEntry` type export needs the `tags?: string[]` field added.

**Breaks if skipped:** All new dashboard pages have no way to fetch or mutate data.

---

### 1.10 `dashboard/lib/hooks.ts` (51 lines) — MODERATE EXPANSION

**Current role:** SWR data-fetching hooks.

**Changes required — ~11 new hooks:**

```typescript
export function usePrompt()           // fetches getPrompt()
export function useSecurityConfig()   // fetches getSecurityConfig()
export function useSecurityEvents()   // fetches getSecurityEvents()
export function useBudgetStatus()     // fetches getBudgetStatus(), refreshInterval: 30s
export function useUserFacts(userId)  // fetches getUserFacts(userId)
export function useMemoryFacts()      // fetches getMemoryFacts()
export function useMemorySummaries()  // fetches getMemorySummaries()
export function useToolsConfig()      // fetches getToolsConfig()
export function useReminders()        // fetches getReminders()
export function useTriggers()         // fetches getTriggers()
export function useToolLog()          // fetches getToolLog()
```

All follow the exact same `useSWR(key, fetcher)` pattern as existing hooks.

**Breaks if skipped:** New pages can't reactively fetch data.

---

### 1.11 `dashboard/components/Sidebar.tsx` (96 lines) — MODERATE

**Current role:** Navigation sidebar with 7 items + agent status indicator.

**Changes required:**

1. **Add 3-4 new navigation items** to the `navItems` array:
   - `{ href: '/agent', label: 'Agent', icon: Bot }` — between Dashboard and Messages
   - `{ href: '/security', label: 'Security', icon: Shield }` — after Permissions
   - `{ href: '/memory', label: 'Memory', icon: Brain }` — after Users
   - `{ href: '/tools', label: 'Tools', icon: Wrench }` — after Memory

2. **Import new Lucide icons:** `Bot`, `Shield`, `Brain`, `Wrench` (or similar)

3. **Optional:** Add a budget status indicator below the agent running status — show a colored dot if budget > 80% consumed.

**Breaks if skipped:** Users can't navigate to new pages.

---

### 1.12 `dashboard/app/page.tsx` — Dashboard Home (202 lines) — MODERATE

**Current role:** Shows agent status, 4 stat cards, system info.

**Changes required:**

1. **Add new widgets below existing stat cards:**
   - **Budget widget:** Progress bar showing `spentToday / dailyLimit` with color coding (green < 60%, yellow < 80%, red ≥ 80%)
   - **Memory widget:** "X facts stored for Y users"
   - **Security widget:** "X security events today" with severity breakdown
   - **Reminders widget:** "X pending reminders"

2. **Import new hooks:** `useBudgetStatus` (or include budget in existing status response to avoid extra fetch)

3. **New component needed:** A `ProgressCard` or extend `StatCard` with optional `progress?: number` prop for the budget bar. Could also be a standalone `BudgetWidget` component.

**Breaks if skipped:** Dashboard doesn't surface any new feature status. User has no visibility into budget, memory, or security.

---

### 1.13 `dashboard/app/settings/page.tsx` (262 lines) — MODERATE

**Current role:** API key, model, temperature, max tokens configuration.

**Changes required:**

1. **Add sections for new settings:**
   - **Prompt Caching:** Toggle switch for `cache.promptCaching`
   - **Polling Configuration:** Three number inputs (active/idle/deep-idle intervals) + idle timeout
   - **Context Window:** Dropdown or number input

2. **Remove settings that move to the Agent page** (if creating a separate Agent page):
   - Temperature and max tokens could stay here (they're API config) or move to Agent page (they're behavior config). Decision: keep them here since they're technically API parameters.

3. **Add validation feedback:** Currently saves silently. New settings like polling intervals need range validation (min 500ms, max 60000ms).

**Breaks if skipped:** Polling config, prompt caching, and context window are not configurable from UI.

---

### 1.14 `dashboard/app/users/page.tsx` (150 lines) — MODERATE

**Current role:** User list with click-to-view conversation history.

**Changes required:**

1. **User list view — add blocked indicator:**
   - Show a `StatusBadge` with `status="blocked"` (new status type) or a red dot next to blocked users
   - The API response for `GET /users` needs to include `is_blocked` field

2. **User detail view — add new panels after conversation history:**
   - **Block/Unblock toggle:** Button that calls `blockUser(userId)` / `unblockUser(userId)`
   - **User Facts panel:** List of facts from `context` table for this user
     - Each fact: type badge, content text, created date, delete button
     - "Add Fact" button with type dropdown + content textarea
   - Import `useUserFacts` hook and `addUserFact`, `deleteUserFact` API functions

3. **The user detail view is currently inline (state-based, not routed).** This is fine — just add more sections below the conversation history.

**Breaks if skipped:** No way to block users from UI. No visibility into what the agent "knows" about each user.

---

### 1.15 `dashboard/app/usage/page.tsx` (143 lines) — MINOR

**Current role:** Token usage stats and cost estimation.

**Changes required:**

1. **Dynamic cost calculation (lines 17–24):** The `estimateCost()` function hardcodes Haiku pricing ($0.25/$1.25 per million). Needs to:
   - Read the configured model from settings (or accept it as a parameter)
   - Use a pricing lookup table:
     ```
     const MODEL_PRICING: Record<string, { input: number; output: number }> = {
       'claude-3-5-haiku-20241022': { input: 0.25, output: 1.25 },
       'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
       'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
       // ... etc
     };
     ```
   - The pricing table should ideally come from the backend (in the usage API response) so it stays in sync

2. **Add budget context:** Show a "Daily Budget: $X.XX" line and a visual indicator of how today's spend relates to the limit.

**Breaks if skipped:** Cost estimates are wrong for non-Haiku models. User has no budget awareness on the usage page.

---

### 1.16 `dashboard/app/logs/page.tsx` (221 lines) — MINOR

**Current role:** Real-time log viewer with SSE streaming and level filters.

**Changes required:**

1. **Add "security" to the level filter buttons (line 145):**
   - Currently: `['all', 'error', 'warn', 'info', 'debug']`
   - Change: `['all', 'error', 'warn', 'info', 'debug', 'security']`
   - Or implement tag-based filtering if LogEntry gains `tags` field

2. **Highlight security events visually:** Add a `security` entry to `LEVEL_COLORS` and `LEVEL_BG` maps with a distinct color (e.g., orange/purple).

3. **The SSE `LogEntry` type** needs to include `tags` — update the import from api.ts.

**Breaks if skipped:** Security events mixed in with general logs with no way to filter them. Minor UX issue, not a functional break.

---

### 1.17 `dashboard/app/setup/page.tsx` (325 lines) — MINOR

**Current role:** First-run onboarding wizard (permissions → API key → start agent).

**Changes required:**

1. **Optional: Add a "Configure Agent" step** between API key and complete:
   - Let user set agent name, choose a persona style, set daily budget
   - Pre-populate defaults if they skip
   - This is a nice-to-have, not required

2. **On "Start Agent" (line 69):** Ensure `seedDefaultSettings()` has already run (it should have at DB init time). No code change needed if seeding is done at startup.

**Breaks if skipped:** Nothing breaks. Just a missed opportunity for guided initial configuration.

---

### 1.18 `dashboard/components/Card.tsx` (37 lines) — MINOR

**Changes required:**

1. **Add a `ProgressStatCard` variant** for the budget widget:
   ```
   interface ProgressStatCardProps extends StatCardProps {
     progress: number;     // 0-100
     progressColor?: string; // e.g., 'emerald' | 'amber' | 'red'
   }
   ```
   - Renders a progress bar below the value
   - Used on Dashboard home for budget display

**Breaks if skipped:** Budget widget on dashboard uses a plain StatCard without visual progress. Functional but less informative.

---

### 1.19 `dashboard/components/StatusBadge.tsx` (44 lines) — MINOR

**Changes required:**

1. **Add new status entries** to `STATUS_STYLES` and `LABELS`:
   ```
   rate_limited: { dot: 'bg-amber-500', text: '...', bg: '...' }
   budget_exceeded: { dot: 'bg-red-500', text: '...', bg: '...' }
   blocked: { dot: 'bg-red-500', text: '...', bg: '...' }
   active: { dot: 'bg-emerald-500', text: '...', bg: '...' }   // for tool/reminder status
   pending: { dot: 'bg-amber-400', text: '...', bg: '...' }    // for reminder status
   delivered: { dot: 'bg-gray-400', text: '...', bg: '...' }   // for reminder status
   ```

2. **Update the `StatusBadgeProps.status` union type** to include new values.

**Breaks if skipped:** New status values render with fallback "unknown" styling. Not broken, just ugly.

---

### 1.20 `dashboard/app/globals.css` (117 lines) — NO CHANGES

The existing CSS variables (`--color-success`, `--color-warning`, `--color-error`) and Tailwind utilities are sufficient for all new components. No new CSS variables needed.

---

## 2. Files That Need NO Changes

| File | Reason |
|------|--------|
| `electron/preload.ts` | Dashboard communicates via HTTP, not IPC. No new IPC channels needed. |
| `electron/utils/auto-updater.ts` | Self-contained auto-update logic. Unrelated to agent features. |
| `electron/utils/secure-storage.ts` | Already handles API key securely. No new secrets to store. |
| `electron/utils/tray.ts` | Could optionally add status indicators, but not required. |
| `electron/backend/services/PermissionService.ts` | Self-contained permission checking. Unrelated to new features. |
| `dashboard/components/Button.tsx` | Generic enough for all new UI. |
| `dashboard/components/EmptyState.tsx` | Generic enough for all new pages. |
| `dashboard/components/ErrorBoundary.tsx` | Generic error handling. No changes. |
| `dashboard/components/PageHeader.tsx` | Generic page header. No changes. |
| `dashboard/components/LoadingSpinner.tsx` | Generic loading indicator. No changes. |
| `dashboard/app/messages/page.tsx` | Could optionally add tool call indicators. Not required. |
| `dashboard/app/permissions/page.tsx` | Self-contained permission UI. No changes. |
| `dashboard/next.config.js` | `output: 'export'` handles new pages automatically. |
| `dashboard/tailwind.config.ts` | Content paths already cover new files. |
| `electron/tsconfig.json` | Include glob covers new directories. |
| `electron-builder.yml` | File globs cover new compiled output. |
| `dashboard/app/globals.css` | Existing CSS vars are sufficient. |

---

## 3. New Files to Create

### Backend Services (7 files)

| File | Purpose | Deps |
|------|---------|------|
| `electron/backend/services/PromptBuilder.ts` | Assembles system prompt from template + dynamic context | database.ts, MemoryService |
| `electron/backend/services/MemoryService.ts` | CRUD for context table, fact extraction, summarization | database.ts (accepts summarizer function to avoid circular dep with ClaudeService) |
| `electron/backend/services/RateLimiter.ts` | In-memory per-user and global rate limiting | database.ts (for settings) |
| `electron/backend/services/OutputSanitizer.ts` | Scans responses before sending | database.ts (for settings), logger.ts |
| `electron/backend/services/ReminderService.ts` | Background checker for due reminders | database.ts, iMessageService |
| `electron/backend/services/TriggerService.ts` | Background checker for due triggers | database.ts, iMessageService |
| `electron/backend/services/ToolRegistry.ts` | Manages tool definitions and dispatch | Tool modules, database.ts |

### Backend Tools (5 files)

| File | Purpose |
|------|---------|
| `electron/backend/tools/setReminder.ts` | Tool handler: create reminder in DB |
| `electron/backend/tools/createTrigger.ts` | Tool handler: create trigger in DB |
| `electron/backend/tools/saveUserFact.ts` | Tool handler: save fact to context table |
| `electron/backend/tools/getUserFacts.ts` | Tool handler: retrieve user's facts |
| `electron/backend/tools/searchHistory.ts` | Tool handler: full-text search messages table |

### Backend Routes (4 files)

| File | Purpose |
|------|---------|
| `electron/backend/routes/agent.ts` | Prompt CRUD, preview, behavior config |
| `electron/backend/routes/security.ts` | Security config, events, budget, user blocking |
| `electron/backend/routes/memory.ts` | Facts CRUD, summaries, purge, export |
| `electron/backend/routes/tools.ts` | Tool config, reminders CRUD, triggers CRUD, log |

### Backend Types (1 file)

| File | Purpose |
|------|---------|
| `electron/backend/types.ts` | Shared TypeScript interfaces: ToolDefinition, ToolResult, SecurityEvent, UserFact, GenerateResult, etc. |

### Dashboard Pages (4 files)

| File | Purpose |
|------|---------|
| `dashboard/app/agent/page.tsx` | Persona config, prompt editor, behavior settings, iMessage-specific settings |
| `dashboard/app/security/page.tsx` | Rate limits, budget controls, content safety toggles, blocked users, security event log |
| `dashboard/app/memory/page.tsx` | All facts table, conversation summaries, memory stats, purge button, export button |
| `dashboard/app/tools/page.tsx` | Tool toggles, reminders table + CRUD, triggers table + CRUD, execution log |

### Dashboard Types (1 file)

| File | Purpose |
|------|---------|
| `dashboard/lib/types.ts` | TypeScript interfaces matching backend types: SecurityEvent, UserFact, BudgetStatus, Reminder, Trigger, etc. |

**Total: 22 new files**

---

## 4. Cross-Cutting Concerns

### 4.1 Circular Dependency Prevention

The most dangerous circular dependency:

```
AgentService → MemoryService → ClaudeService → (imported by AgentService)
```

**Solution:** MemoryService should NOT import ClaudeService directly. Instead, AgentService passes a summarization callback:

```typescript
// In AgentService initialization:
memoryService.setSummarizer(async (messages: string) => {
  const result = await claudeService.generateResponse({
    messages: [{ role: 'user', content: `Summarize: ${messages}` }],
    systemBlocks: [{ type: 'text', text: 'You are a summarizer. Be concise.' }],
    maxTokens: 200,
  });
  return result.text;
});
```

### 4.2 Service Initialization Order

```
initializeDatabase()
  → seedDefaultSettings()
    → startBackendServer()
      → mount all routes
      → auto-start agent (if configured):
        → agentService.start()
          → iMessageService.startPolling()
          → reminderService.start()
          → triggerService.start()
```

All services must be importable (singleton module pattern) but only *started* in the correct order.

### 4.3 Settings Read Consistency

Multiple services read settings at different times. A setting changed via the dashboard API takes effect:
- **Immediately** for: rate limits (checked per-message), budget (checked per-message), output sanitization toggles
- **On next message** for: prompt template (assembled per-request), enabled tools (passed per-request)
- **On restart** for: polling intervals (only read when scheduling next poll)

Document this behavior so users understand when changes take effect.

### 4.4 Error Propagation in Tool Calling

If a tool execution fails (e.g., invalid date for reminder), the error must be:
1. Returned to Claude as a `tool_result` with `is_error: true`
2. Logged as a tool execution with `success: false`
3. Claude will then generate a user-friendly error message naturally

Do NOT crash the message processing pipeline on tool errors. Always catch and return error results.

### 4.5 Token Counting for Budget

The budget circuit breaker needs *pre-call* cost estimation (to prevent calls that would exceed budget). But exact token count is only known *post-call*.

**Solution:** Estimate pre-call using a rough heuristic (message character count / 4 ≈ tokens), and reconcile with actual usage post-call. Be conservative — reject if estimated cost would bring total to within 90% of limit.

### 4.6 Database Transaction Safety

Multiple new services write to the database concurrently:
- AgentService: messages, api_usage, users
- MemoryService: context (facts, summaries)
- ReminderService: reminders (mark delivered)
- TriggerService: triggers (update last_run)
- SecurityService: security_events
- Tool handlers: reminders, triggers, context

SQLite handles this via WAL mode (already enabled in database.ts). Ensure all writes use the same db instance. The existing singleton `db` in database.ts is shared — no change needed, but verify that `better-sqlite3` handles concurrent writes safely (it does in WAL mode).

---

## 5. Dependency & Build Changes

### 5.1 `package.json` (root)

**New dependency needed:**
- `cron-parser` (~15KB, no native modules) — for parsing trigger schedules (e.g., "every day at 9am")
- This is the ONLY new dependency. Everything else uses existing packages or pure TypeScript.

**Optional:** `uuid` for generating IDs (currently the codebase seems to use custom ID generation). Check if it already uses a pattern and be consistent.

**Version bump:** Increment to `2.0.0` given the scope of changes.

### 5.2 `dashboard/package.json`

**No new dependencies required.** The existing stack (Next.js, React, Tailwind, Lucide, SWR) is sufficient for all new pages.

**Optional:** If a rich prompt editor is desired, add `@monaco-editor/react`. But a styled `<textarea>` is simpler and more appropriate for the Electron context.

**Version bump:** Match root version.

### 5.3 Build Pipeline

No changes to:
- `electron-builder.yml` — existing globs cover new files
- `electron/tsconfig.json` — existing include covers new directories
- `dashboard/next.config.js` — static export handles new pages
- `dashboard/tailwind.config.ts` — content paths cover new files
- Build scripts in package.json — existing `build:electron` and `build:dashboard` commands work

---

## 6. Breaking Change Register

| # | Change | What Breaks | Migration |
|---|--------|-------------|-----------|
| 1 | `ClaudeService.generateResponse()` returns `GenerateResult` instead of `string` | AgentService call site, any test that mocks this | Update all callers to destructure `result.text` |
| 2 | `iMessageService.startPolling()` uses `setTimeout` instead of `setInterval` | `stopPolling()` must use `clearTimeout` | Update stop method |
| 3 | New DB migrations add tables/columns | Old DB missing tables | Migrations run automatically on startup |
| 4 | `AgentService.getStatus()` returns expanded object | Dashboard status parsing | Dashboard already uses dynamic property access — add new fields |
| 5 | `log()` function accepts optional `tags` param | No break (param is optional) | None needed |
| 6 | New settings keys expected by services | Services get `null` if seeding fails | `seedDefaultSettings()` must run reliably |
| 7 | Route split: new Express routers | 404 on new routes if not mounted | Ensure server.ts mounts all new routers |
| 8 | `LogEntry` type gains `tags` field | Dashboard TypeScript may need update | Add optional field to dashboard type |

**None of these break the existing user experience** — they're all additive. The agent continues to work as before; new features layer on top.

---

## 7. Startup & Shutdown Sequence

### Current Startup
```
app.whenReady()
  → initializeDatabase()
  → startBackendServer(3001)
    → Express app listens
    → Auto-start agent (if setting enabled):
      → agentService.start()
        → claudeService.init()
        → iMessageService.startPolling()
  → createMainWindow()
  → createTray()
  → setupAutoUpdater()
```

### New Startup
```
app.whenReady()
  → initializeDatabase()
  → seedDefaultSettings()              ← NEW
  → startBackendServer(3001)
    → Express app listens
    → Mount routes: dashboard, agent, security, memory, tools  ← NEW
    → Auto-start agent (if setting enabled AND NOT budget-paused):
      → agentService.start()
        → promptBuilder.init()          ← NEW (load template from settings)
        → claudeService.init()
        → toolRegistry.init()           ← NEW (load enabled tools from settings)
        → iMessageService.startPolling()
        → reminderService.start()       ← NEW
        → triggerService.start()        ← NEW
  → createMainWindow()
  → createTray()
  → setupAutoUpdater()
```

### Current Shutdown
```
will-quit
  → agentService.stop()
    → iMessageService.stopPolling()
  → stopBackendServer()
  → closeDatabase()
  → destroyTray()
```

### New Shutdown
```
will-quit
  → triggerService.stop()              ← NEW (must stop before iMessage)
  → reminderService.stop()            ← NEW (must stop before iMessage)
  → agentService.stop()
    → iMessageService.stopPolling()
  → stopBackendServer()
  → closeDatabase()
  → destroyTray()
```

---

## 8. Missing Items Not in the Upgrade Plan

Issues discovered during this full-repo review that the upgrade plan should account for:

### 8.1 API Route Authentication
The current dashboard API has **zero authentication** — all routes are open on `localhost:3001`. The upgrade adds sensitive routes (block users, modify prompt, delete data, export memory). While localhost-only provides some safety, any local process or browser extension can call these APIs. **Recommend:** Add a simple token-based auth (e.g., a random token generated on startup, passed via cookie to the Electron window).

### 8.2 Settings Type Helpers
The plan defines 30+ settings with specific types (boolean, number, string) but the existing `getSetting()` only returns `string | null`. Every consumer would need manual parsing. **Add helper functions:** `getSettingBool(key, default)`, `getSettingInt(key, default)`, `getSettingFloat(key, default)` to database.ts.

### 8.3 Dashboard Version Sync
Root `package.json` is v1.7.0, dashboard `package.json` is v1.6.0. These should be synchronized during the upgrade (both to 2.0.0).

### 8.4 Model Pricing Table
The budget circuit breaker and usage page both need model-to-cost mapping. This should be a single source of truth — either a config object in `ClaudeService.ts` or a settings entry. The usage page currently hardcodes Haiku pricing. Both need to read from the same place.

### 8.5 No Test Infrastructure
The repo has zero test files. The new services (RateLimiter, OutputSanitizer, PromptBuilder) are highly testable pure functions. **Recommend:** Add at minimum unit tests for these three services using Node's built-in `node:test` runner (no new dependency needed).

### 8.6 Contact Name Cache Invalidation
The plan says to cache contact names, but doesn't specify cache invalidation. Contacts can change (user edits their address book). **Recommend:** Cache with a 24-hour TTL, or cache permanently but allow manual refresh from the dashboard.

### 8.7 Conversation Summary Storage Location
The plan says summaries go in the `context` table with `type = 'summary'`. But summaries are per-conversation (chatGuid), not per-user. The `context` table has `user_id` but no `chat_guid`. **Options:**
- Store `chat_guid` in the `content` field as JSON: `{ chatGuid: "...", summary: "..." }`
- Add a `chat_guid` column to the `context` table (another migration)
- The simpler option: just store per-user summaries (combine all conversations). Good enough for 1:1 chats; for group chats, the user_id can be the chat identifier.

### 8.8 iMessage Reaction Handling
The audit mentions iMessage reactions ("Liked an image", "Laughed at..."). These are real messages in the iMessage DB. The current code processes them like normal messages, which wastes API calls. **Recommend:** Add a filter in `iMessageService.pollNewMessages()` to detect and skip reaction messages (they follow a pattern: starts with "Liked", "Loved", "Laughed at", "Emphasized", "Questioned", or "Disliked").

### 8.9 Group Chat Identity
For group chats, the `handleId` on incoming messages is the sender's handle, but the `chatGuid` is the group. The agent needs to respond to the *group* (chatGuid), not the individual (handleId). The current code already uses `chatGuid` for sending — this is correct. But the prompt context should show the sender's name for each message, which requires the contact name lookup per sender within a group.

### 8.10 `api_usage` Table — Cache Read/Write Tokens
Anthropic's prompt caching returns `cache_read_input_tokens` and `cache_creation_input_tokens` in addition to regular tokens. These have different pricing. The `api_usage` table currently stores `input_tokens` and `output_tokens`. **Recommend:** Add `cache_read_tokens` and `cache_creation_tokens` columns to track actual caching savings.

---

## Summary: File Change Count

| Category | Files Changed | Files Created | Files Unchanged |
|----------|:---:|:---:|:---:|
| **Electron Backend** | 8 | 17 | 4 |
| **Dashboard** | 10 | 5 | 8 |
| **Config/Build** | 2 | 0 | 5 |
| **Total** | **20** | **22** | **17** |

**Lines of code estimate:**
- Existing files modified: ~600 lines changed/added across 20 files
- New backend files: ~2,500 lines (services + tools + routes + types)
- New dashboard files: ~1,800 lines (4 pages + types file)
- **Total new/changed: ~4,900 lines**
