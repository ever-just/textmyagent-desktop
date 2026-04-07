# TextMyAgent Desktop — Complete Audit Findings

**Date:** April 7, 2026
**Scope:** Full codebase audit — security, functional, efficiency, quality, build

---

## CATEGORY A: SECURITY VULNERABILITIES

### A1. 🔴 CRITICAL — Command Injection in `/settings/open`
**File:** `electron/backend/routes/dashboard.ts:471-474`
```
const { settingsUrl } = req.body;
exec(`open "${settingsUrl}"`);
```
- `settingsUrl` from HTTP request body is interpolated directly into a shell command
- Any local process (or remote attacker via A2) can inject arbitrary shell commands
- Example payload: `"; rm -rf / #` → executes destructive command
- The `PermissionService` already uses `shell.openExternal()` safely for the same purpose

### A2. 🔴 CRITICAL — CORS Bypass via Substring Match
**File:** `electron/backend/server.ts:29-33`
```
origin.includes('localhost')
origin.includes('127.0.0.1')
```
- `includes()` matches ANY domain containing those substrings
- `https://evil.localhost.attacker.com` passes the check
- `https://127.0.0.1.attacker.com` passes the check
- Combined with A1: remote attacker-controlled website can execute shell commands on user's machine
- Combined with A6: remote attacker can read all messages, send messages, steal/replace API key

### A3. 🟠 HIGH — SSE Endpoint Hardcodes `Access-Control-Allow-Origin: *`
**File:** `electron/backend/routes/dashboard.ts:219`
```
res.setHeader('Access-Control-Allow-Origin', '*');
```
- Manually overrides the CORS middleware for the log stream endpoint
- Any website in any browser can subscribe and read real-time logs
- Logs contain: phone numbers, message previews, error details, system state

### A4. 🟠 HIGH — No Authentication on Local Express API
**File:** `electron/backend/server.ts` (entire server)
- Zero auth middleware on any endpoint
- Any local process can: read all messages, send messages as user, change API keys, start/stop agent
- Even with localhost binding, malware or other local apps can exploit this
- No per-session token, no bearer auth, no CSRF protection

### A5. 🟠 HIGH — `shell.openExternal` Without URL Validation
**File:** `electron/main.ts:92-94`
```
mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
});
```
- No validation of the URL scheme — `file://`, `javascript:`, or custom protocol URLs pass through
- The webContents loads from `http://127.0.0.1` so content is attacker-influenceable if CORS is bypassed
- Missing `will-navigate` handler — no protection against navigation to malicious URLs

### A6. 🟠 HIGH — Unvalidated `shell.openExternal` in PermissionService
**File:** `electron/backend/services/PermissionService.ts:244-246`
```
async openSystemSettings(settingsUrl: string): Promise<void> {
    await shell.openExternal(settingsUrl);
```
- `settingsUrl` parameter is not validated against an allowlist
- While currently only called with hardcoded `x-apple.systempreferences:` URLs internally, the public method accepts any string
- If ever called with user input, could open arbitrary URLs/protocols

### A7. 🟡 MEDIUM — Secure Storage File Has Default Permissions (World-Readable)
**File:** `electron/utils/secure-storage.ts:45,48`
```
fs.writeFileSync(storagePath, encrypted);
fs.writeFileSync(storagePath, jsonString);
```
- Default file mode (typically 0o644 after umask) — readable by any user on the system
- The file contains the encrypted (or plaintext fallback) Anthropic API key
- Should use `{ mode: 0o600 }` to restrict to owner only

### A8. 🟡 MEDIUM — Plaintext Fallback for Encrypted Storage
**File:** `electron/utils/secure-storage.ts:25-28, 46-48`
- If `safeStorage.isEncryptionAvailable()` returns false, API key is stored as plaintext JSON
- Combined with A7, the API key is readable by any local user
- No UI warning to user that encryption is unavailable
- Silent degradation of security

### A9. 🟡 MEDIUM — No Input Validation on API Key Storage
**File:** `electron/backend/routes/dashboard.ts:451-456`
- No validation on `value` — empty string, null, undefined, or 10MB string all accepted
- Empty string `""` makes `hasSecureValue()` return true (key exists in object)
- `isConfigured()` reports true while API key is useless
- No length limit, no format check, no sanitization

### A10. 🟡 MEDIUM — Custom URL Scheme `textmyagent://` Registered But Unhandled
**File:** `electron-builder.yml:46-49`
```
CFBundleURLTypes:
  - CFBundleURLName: TextMyAgent
    CFBundleURLSchemes:
      - textmyagent
```
- Registers a custom URL scheme but NO handler exists in `main.ts`
- Any website can craft `textmyagent://...` links that open the app
- Without a handler validating the URL, this is a potential attack vector if a handler is added later
- Currently a dead registration that provides no functionality

### A11. 🟡 MEDIUM — `setupSecureStorageIPC` Crashes If Called Twice
**File:** `electron/utils/secure-storage.ts:99-123`
- `ipcMain.handle()` throws if a handler for the same channel is already registered
- No guard against double-invocation
- If `startBackendServer` is called twice (restart flow), this crashes

### A12. 🟡 LOW — `getAnthropicApiKey()` Called Twice in Permissions Endpoint
**File:** `electron/backend/routes/dashboard.ts:438-439`
```
configured: !!SecureStorage.getAnthropicApiKey(),
masked: SecureStorage.getAnthropicApiKey() ? 'sk-ant-••••••••' : undefined,
```
- Each call to `getAnthropicApiKey()` reads and decrypts the file from disk
- The plaintext API key exists in memory twice, briefly — increases exposure window
- Minor, but unnecessary given the value could be read once

---

## CATEGORY B: FUNCTIONAL BUGS

### B1. 🔴 CRITICAL — Newlines in AI Responses Display as Literal `\n`
**File:** `electron/backend/services/iMessageService.ts:278-281`
```
const escapedText = text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
```
- Replaces `\n` with the two-character literal string `\n`
- AppleScript does NOT interpret `\n` inside double quotes as a newline
- AppleScript requires `return` or `linefeed` keywords for line breaks
- **Every multi-line Claude response displays with literal `\n` characters in the iMessage bubble**
- Also missing: `\r` (carriage return) escaping — a `\r` in Claude's response breaks AppleScript syntax entirely
- Also missing: `\t` (tab) escaping

### B2. 🔴 CRITICAL — `attributedBody` Parser Truncates Messages Over ~254 Characters
**File:** `electron/backend/services/iMessageService.ts:246-248`
```
const lengthByte = data[i + 1];
if (lengthByte > 0 && lengthByte < 255 && i + 2 + lengthByte <= data.length) {
```
- Reads a single byte for text length — max value 254
- NSArchiver uses variable-length integer encoding for longer strings
- On newer macOS where `text` is empty and content is in `attributedBody`:
  - **Any incoming iMessage longer than ~254 characters is silently dropped**
  - The agent never sees it, never responds
  - This is a data-loss bug on a core feature

### B3. 🔴 CRITICAL — App Cannot Quit When Log Stream Is Open (Deadlock)
**Files:** `electron/main.ts:163-177` + `electron/backend/server.ts:124-136`
- `will-quit` handler calls `event.preventDefault()` then `await stopBackendServer()`
- `stopBackendServer()` calls `server.close()` which waits for ALL connections to close
- SSE log stream connections (`dashboard.ts:215-231`) are kept alive indefinitely
- `server.close()` callback never fires → `app.exit(0)` never runs → **app hangs forever**
- User must force-quit the application
- No timeout exists on the cleanup

### B4. 🟠 HIGH — `getConversationHistory` Ignores `attributedBody` — History Is Incomplete
**File:** `electron/backend/services/iMessageService.ts:353-366`
```
WHERE c.guid = ? AND m.text IS NOT NULL
```
- Query filters `m.text IS NOT NULL` and doesn't select `attributedBody`
- On newer macOS, many messages have `text = NULL` with content only in `attributedBody`
- When conversation context is loaded for Claude, these messages are missing
- Claude sees an incomplete conversation → nonsensical or repetitive responses

### B5. 🟠 HIGH — Config Changes From Dashboard Never Take Effect on Claude
**File:** `electron/backend/routes/dashboard.ts:178-193`
- `PUT /config` writes settings to SQLite but never calls `claudeService.setModel()`, `.setMaxTokens()`, `.setTemperature()`
- The `ClaudeService` singleton keeps hardcoded defaults forever:
  - `model = 'claude-sonnet-4-20250514'` (line 20)
  - `maxTokens = 1024` (line 21)
  - `temperature = 0.7` (line 22)
- User thinks they changed the model/temperature/tokens — nothing happens

### B6. 🟠 HIGH — README and Config Default Claim Haiku, Code Uses Sonnet 4
- README says "Claude 3.5 Haiku"
- Config endpoint defaults to `'claude-3-5-haiku-latest'`
- `ClaudeService.ts:20` actually uses `'claude-sonnet-4-20250514'`
- Users expect Haiku pricing (~$0.25/$1.25 per MTok) but are charged Sonnet 4 (~$3/$15 per MTok)
- ~12x cost difference users don't know about

### B7. 🟠 HIGH — `recordApiUsage` Logs Wrong Model — Cost Tracking Inaccurate
**File:** `electron/backend/services/ClaudeService.ts:102`
```
recordApiUsage(response.usage.input_tokens, response.usage.output_tokens);
```
- Doesn't pass the model — defaults to `'claude-3-5-haiku-latest'` in `database.ts:270`
- Actual model is `'claude-sonnet-4-20250514'`
- Usage dashboard shows wrong model and wrong cost projections

### B8. 🟠 HIGH — `handleIncomingMessage` Doesn't Check `isRunning`
**File:** `electron/backend/services/AgentService.ts:25-28, 90`
- Event listener registered in constructor, never removed
- `handleIncomingMessage` never checks `this.isRunning`
- Messages arriving between `stop()` and `iMessageService.stopPolling()` completing are still processed
- Agent sends responses after user explicitly stopped it

### B9. 🟠 HIGH — `checkPermissions()` Leaks Database Connections on Error
**File:** `electron/backend/services/iMessageService.ts:432-434`
```
const testDb = new Database(IMESSAGE_DB_PATH, { readonly: true });
testDb.prepare('SELECT 1 FROM message LIMIT 1').get();
testDb.close();
```
- If `prepare().get()` throws, `testDb.close()` is skipped
- Called on every status check, config check, setup check from the dashboard
- Each leaked connection holds a file descriptor to `chat.db`
- Over time, exhausts file descriptors

### B10. 🟠 HIGH — `ClaudeService.initClient()` Permanently Fails After First Attempt Without Key
**File:** `electron/backend/services/ClaudeService.ts:29-43`
```
if (this.initialized) return;
this.initialized = true;
```
- If `initClient()` runs before API key is set: `initialized = true` but `client = null`
- All subsequent `generateResponse()` calls hit early return (already initialized)
- Client stuck as null forever until explicit `refreshClient()` call
- If auto-start in `server.ts:106-108` runs before user sets key → agent silently fails on every message

### B11. 🟡 MEDIUM — `/setup/test-anthropic` Doesn't Actually Test the API
**File:** `electron/backend/routes/dashboard.ts:697-703`
```
if (!testKey.startsWith('sk-ant-')) {
    return res.json({ success: false, error: 'Invalid API key format' });
}
res.json({ success: true });
```
- Only validates format prefix, not actual API validity
- Revoked, expired, or invalid keys pass
- Users discover failure only when agent silently fails to respond

### B12. 🟡 MEDIUM — `conversations.last_message_at` Is Never Updated
**File:** `electron/backend/database.ts:90` (schema) + `AgentService.ts:200-270` (writes)
- Schema defines `last_message_at TEXT` on conversations
- `saveMessageToDb` never sets it — column is always NULL
- Dead column in the schema

### B13. 🟡 MEDIUM — `is_blocked` and `is_muted` Fields Never Checked
**Files:** `electron/backend/database.ts:81,91` + `AgentService.ts:90-198`
- `users.is_blocked` and `conversations.is_muted` exist in schema
- Agent never checks these before processing messages or sending responses
- No endpoint to set them either
- A user cannot block or mute conversations even though schema supports it

### B14. 🟡 MEDIUM — `contact.identifier` Fallback to `Math.random()`
**File:** `electron/backend/routes/dashboard.ts:497`
```
id: c.identifier || String(Math.random()),
```
- If a contact has no identifier, a random float is used as the ID
- Not unique, not deterministic, not a valid identifier
- Should use `crypto.randomUUID()`

### B15. 🟡 LOW — `dateToAppleTime` Function Is Defined But Never Used
**File:** `electron/backend/services/iMessageService.ts:24-26`
- Dead code

---

## CATEGORY C: CONCURRENCY & RACE CONDITIONS

### C1. 🔴 CRITICAL — Concurrent Message Processing Race Condition on Same Chat
**File:** `electron/backend/services/AgentService.ts:99-103`
```
if (this.processingQueue.has(message.guid)) { return; }
this.processingQueue.add(message.guid);
```
- Dedup is on `message.guid`, not `chatGuid`
- Two messages in same poll cycle for same chat → both pass check (different GUIDs)
- Both run `handleIncomingMessage` concurrently:
  - Race condition on `context.messages` array (concurrent pushes)
  - Two Claude API calls simultaneously with overlapping context
  - Two responses sent, potentially out of order
  - Two DB writes — potentially interleaved

### C2. 🟠 HIGH — `pollNewMessages` Can Run Concurrently With Itself
**File:** `electron/backend/services/iMessageService.ts:112-114`
```
this.pollInterval = setInterval(async () => {
    await this.pollNewMessages();
}, intervalMs);
```
- `setInterval` does NOT await the async callback
- If `pollNewMessages()` takes >2s (slow DB, many messages), next tick fires while previous still running
- Both read `this.lastMessageRowId` at same value → process same messages twice
- `processedMessageGuids` partially mitigates but ROWID update is not atomic

### C3. 🟡 MEDIUM — `findAvailablePort` TOCTOU Race
**File:** `electron/backend/server.ts:138-150`
- Creates test server, binds port, closes it, returns the port number
- Between close and Express actually listening, another process can grab the port
- Classic time-of-check-time-of-use race condition

### C4. 🟡 MEDIUM — Secure Storage Read-Modify-Write Race
**File:** `electron/utils/secure-storage.ts:62-66`
```
export function setSecureValue(key: string, value: string): void {
    const data = loadSecureData();  // READ from disk
    data[key] = value;              // MODIFY in memory
    saveSecureData(data);           // WRITE to disk
}
```
- If two concurrent calls to `setSecureValue` with different keys, one write overwrites the other
- In practice unlikely since it's single-threaded, but if called from IPC + Express simultaneously, possible

---

## CATEGORY D: EFFICIENCY & PERFORMANCE

### D1. 🟠 HIGH — `lastMessageRowId` Written to Disk on Every Single Message
**File:** `electron/backend/services/iMessageService.ts:168-169`
```
this.lastMessageRowId = row.ROWID;
setSetting('imessage_last_rowid', String(this.lastMessageRowId));
```
- Runs for every message in the poll (up to 50 per cycle, every 2 seconds)
- Each call does `INSERT ... ON CONFLICT UPDATE` on SQLite
- Up to 25 writes/second of redundant I/O
- Should persist once after the loop, not per-message

### D2. 🟠 HIGH — `checkPermissions()` Opens and Closes a New DB Connection Every Call
**File:** `electron/backend/services/iMessageService.ts:432-434`
- Creates a new `better-sqlite3` Database connection, runs a query, closes it
- Called on every: status check, config check, setup check, permission check
- Dashboard polls status regularly → constant open/close cycle
- Should reuse the existing connection or cache the result

### D3. 🟡 MEDIUM — Conversation Context Memory Leak — Never Pruned
**File:** `electron/backend/services/AgentService.ts:16`
```
private conversations: Map<string, ConversationContext> = new Map();
```
- Entries added but never removed
- Each holds up to 20 messages of history
- Over weeks/months, grows unbounded with thousands of unique chats
- No TTL-based eviction

### D4. 🟡 MEDIUM — LogBuffer Shift Operation Is O(n)
**File:** `electron/backend/routes/dashboard.ts:33-35`
```
if (this.logs.length > this.maxSize) {
    this.logs.shift();
}
```
- `Array.shift()` is O(n) — moves every element
- Called on every log entry
- At 500 max entries, this is 500 element moves per log
- Should use a circular buffer or deque

### D5. 🟡 MEDIUM — Log Search Stringifies All Metadata on Every Query
**File:** `electron/backend/routes/dashboard.ts:50`
```
JSON.stringify(log.metadata || {}).toLowerCase().includes(searchLower)
```
- Serializes every log entry's metadata to JSON on every search query
- With 500 log entries, that's 500 `JSON.stringify` + `toLowerCase` calls per query
- No indexing or caching

### D6. 🟡 MEDIUM — `loadSecureData()` Reads + Decrypts From Disk on Every Access
**File:** `electron/utils/secure-storage.ts:15-36`
- `getSecureValue`, `setSecureValue`, `hasSecureValue`, `deleteSecureValue` all call `loadSecureData()`
- Each call reads the file from disk and decrypts it
- Multiple consecutive calls (like in the permissions endpoint) repeat this work
- Should cache in memory with invalidation on write

### D7. 🟡 LOW — Express JSON Body Size Limit Is 10MB
**File:** `electron/backend/server.ts:45`
```
express.json({ limit: '10mb' })
```
- API only handles small payloads (API keys, config, message sends)
- 10MB limit allows denial-of-service via large payloads
- Should be ~100KB at most

### D8. 🟡 LOW — `findAvailablePort` Has No Upper Bound — Potential Stack Overflow
**File:** `electron/backend/server.ts:138-150`
- Recursive with no limit — if ports 3001-65535 are all in use, recurses ~62,534 times
- Will overflow the call stack

---

## CATEGORY E: CODE QUALITY & MAINTAINABILITY

### E1. 🟡 MEDIUM — Circular Import Dependencies
**Files:** `dashboard.ts` ↔ `AgentService.ts`, `iMessageService.ts`, `ClaudeService.ts`
- `dashboard.ts` imports singletons from all three services
- All three services import `{ log }` from `dashboard.ts`
- Node.js handles this via partially-loaded modules, but it's fragile
- A refactor could break the load order and cause undefined imports

### E2. 🟡 MEDIUM — Global Namespace Pollution for SSE Subscribers
**File:** `electron/backend/routes/dashboard.ts:213`
```
(global as any).__logSubscribers = logSubscribers;
```
- `log()` function reads from `(global as any).__logSubscribers`
- Used to work around circular import of SSE subscribers
- Fragile, untraceable, breaks encapsulation

### E3. 🟡 MEDIUM — Unused Dependencies in `package.json`
- `socket.io-client` (^4.5.4) — not imported anywhere in the codebase
- `axios` (^1.12.2) — not imported anywhere in the codebase
- `chrono-node` (^2.6.6) — not imported anywhere in the codebase
- These add attack surface, bundle size, and maintenance burden for zero value

### E4. 🟡 MEDIUM — Dead Schema: 3 Tables Created But Never Used
**File:** `electron/backend/database.ts`
- `context` table (lines 106-113) — never read or written
- `reminders` table (lines 122-130) — never read or written
- `triggers` table (migration 2, lines 162-178) — never read or written
- Planned features never implemented — adds schema complexity for no value

### E5. 🟡 MEDIUM — No Tests Whatsoever
- Zero test files in the entire repository
- No unit tests, integration tests, or e2e tests
- For an app that reads private databases, makes API calls, sends messages as the user, and handles credentials
- Critical paths (message parsing, AppleScript escaping, attributedBody extraction) are completely untested

### E6. 🟡 MEDIUM — Preload Event Listeners Never Cleaned Up
**File:** `electron/preload.ts:28-39`
```
onBackendPort: (callback) => { ipcRenderer.on('backend-port', ...) },
onNavigate: (callback) => { ipcRenderer.on('navigate', ...) },
```
- No `removeListener` exposed
- If renderer calls these multiple times (React re-renders), listeners stack up
- Each fires on every event → duplicate callbacks and memory leaks

### E7. 🟡 LOW — `require('crypto')` Inside Function Body
**File:** `electron/backend/services/AgentService.ts:208`
```
const crypto = require('crypto');
```
- Dynamic require inside `saveMessageToDb` instead of top-level import
- Called on every message pair saved — module lookup overhead each time
- Should be a top-level import

### E8. 🟡 LOW — `require('child_process')` Inside Route Handler
**File:** `electron/backend/routes/dashboard.ts:473`
```
const { exec } = require('child_process');
```
- Dynamic require inside a request handler
- Same module already imported at top of `iMessageService.ts` and `PermissionService.ts`

### E9. 🟡 LOW — No TypeScript Strict Null Checks on `any` Casts
- Extensive use of `as any` throughout (especially in dashboard.ts SQL queries)
- SQL query results cast to `any[]` lose all type safety
- Runtime errors from schema changes would be invisible to compiler

---

## CATEGORY F: BUILD, PACKAGING & DISTRIBUTION

### F1. 🟡 MEDIUM — Auto-Updater `autoDownload: true` Without User Consent
**File:** `electron/utils/auto-updater.ts:6`
```
autoUpdater.autoDownload = true;
```
- Updates are downloaded automatically without asking the user
- User is only notified after download completes
- Best practice is to notify first and let user choose when to download/install
- Could be used to push a malicious update if the GitHub repo is compromised

### F2. 🟡 MEDIUM — Dashboard Source Code Missing From Repository
- `dashboard/` directory is empty
- README references a full Next.js dashboard
- `npm run build:dashboard` will fail
- App cannot be built from source as documented
- Either lives in separate repo (undocumented) or was never committed

### F3. 🟡 MEDIUM — `electron-builder.yml` References Dashboard Build Artifacts
**File:** `electron-builder.yml:11-12`
```
- dashboard/.next/static/**/*
- dashboard/out/**/*
```
- Build config expects dashboard static output to exist
- Since dashboard source is missing, packaging will include empty/missing directories

### F4. 🟡 LOW — Source Maps Generated in Electron tsconfig
**File:** `electron/tsconfig.json:15`
```
"sourceMap": true,
"declarationMap": true,
```
- Source maps generated during build
- `electron-builder.yml` filters `*.map` but during dev they're present
- `declarationMap` is dev-only artifact — adds build clutter

### F5. 🟡 LOW — `entitlementsInherit` Same as `entitlements`
**File:** `electron-builder.yml:30-31`
```
entitlements: resources/entitlements.mac.plist
entitlementsInherit: resources/entitlements.mac.plist
```
- Child processes inherit the same broad entitlements as the main process
- Includes: JIT, unsigned executable memory, disabled library validation, network server
- Child processes (e.g., `osascript`) get more permissions than they need

### F6. 🟡 LOW — `notarize: false` in mac Config Could Cause Confusion
**File:** `electron-builder.yml:32`
- `notarize: false` disables electron-builder's built-in notarization
- Notarization is handled by `afterSign: notarize.js` instead
- Not a bug, but the dual configuration is confusing

---

## CATEGORY G: SYSTEM INTERACTION EDGE CASES

### G1. 🟠 HIGH — System Sleep/Resume Doesn't Pause/Restart Polling
**File:** `electron/main.ts:187-193`
```
powerMonitor.on('suspend', () => { console.log('System suspending...'); });
powerMonitor.on('resume', () => { console.log('System resumed'); });
```
- Power events are logged but no action is taken
- During system sleep: polling timer keeps running (or queues up)
- On wake: iMessage DB may have many new messages → burst processing
- The iMessage DB connection may become stale after sleep
- No reconnection logic on wake

### G2. 🟡 MEDIUM — `activate` Handler Creates New Window Without Backend Port
**File:** `electron/main.ts:143-148`
```
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
```
- If all windows are closed and user clicks dock icon, `createMainWindow()` is called
- The new window loads `http://127.0.0.1:${backendPort || 3001}/`
- But `backendPort` might be stale if server was restarted
- No re-validation of the backend server state

### G3. 🟡 MEDIUM — No Retry/Backoff on Claude API Rate Limiting
**File:** `electron/backend/services/ClaudeService.ts:120-124`
```
if (error.status === 429) {
    log('warn', 'Rate limited by Anthropic API');
}
return null;
```
- Rate limit (429) is logged but not retried
- Message is silently dropped — user gets no response
- No exponential backoff, no queue for retry
- During high-traffic periods, multiple messages could be lost

### G4. 🟡 MEDIUM — iMessage DB WAL Mode Interaction
**File:** `electron/backend/services/iMessageService.ts:67`
```
this.db = new Database(IMESSAGE_DB_PATH, { readonly: true });
```
- Opens Apple's iMessage database in read-only mode
- Apple's Messages.app uses WAL mode for this database
- `better-sqlite3` in read-only mode with WAL can see stale data if WAL checkpoint hasn't occurred
- Polling may miss very recent messages until WAL is checkpointed by Messages.app
- This could cause delayed responses (seconds to minutes)

### G5. 🟡 LOW — Agent Auto-Start Timing May Race With Renderer
**File:** `electron/backend/server.ts:106-108`
```
const started = await agentService.start();
```
- Agent starts inside the server listen callback — before `createMainWindow()` returns
- If agent emits events that reference `mainWindow`, window may not be ready
- The `resolve(actualPort)` returns port to main.ts AFTER agent start
- If agent start fails, the port is still returned and window still created

---

## SUMMARY

| Category | 🔴 Critical | 🟠 High | 🟡 Medium | 🟡 Low | Total |
|----------|------------|---------|-----------|--------|-------|
| A. Security | 2 | 4 | 5 | 1 | 12 |
| B. Functional Bugs | 3 | 5 | 4 | 1 | 13 |
| C. Concurrency | 1 | 1 | 2 | 0 | 4 |
| D. Efficiency | 0 | 2 | 4 | 2 | 8 |
| E. Code Quality | 0 | 0 | 6 | 3 | 9 |
| F. Build/Distribution | 0 | 0 | 3 | 3 | 6 |
| G. System Edge Cases | 0 | 1 | 3 | 1 | 5 |
| **TOTAL** | **6** | **13** | **27** | **11** | **57** |

### Top 10 Priority Fixes
1. **A2 + A1** — CORS bypass + command injection (remote code execution chain)
2. **B1** — Newline escaping breaks every multi-line AI response
3. **B2** — Messages >254 chars silently dropped on newer macOS
4. **B3** — App deadlocks on quit when log stream is open
5. **A3** — SSE endpoint exposes logs to any website
6. **C1** — Concurrent processing corrupts conversation state
7. **B5 + B6 + B7** — Config never propagates + wrong model + wrong usage tracking
8. **A4** — No auth on local API
9. **C2** — Poll overlap causes duplicate processing
10. **B8** — Agent processes messages after being stopped
