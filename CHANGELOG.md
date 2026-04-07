# Changelog

All notable changes to TextMyAgent Desktop will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Multi-language support

## [2.1.0] - 2026-04-07

### Added
- **Comprehensive core behavior test suite** — 16 new tests in `CoreBehavior.test.ts` verifying:
  - Multi-bubble response splitting at sentence and paragraph boundaries
  - Typing indicator delay simulation (800ms min, 3000ms max, scales with response length)
  - Double-text queue serialization with GUID deduplication and FIFO processing
  - Chunk delivery with configurable inter-bubble delays and fail-fast on send errors
- **Advanced behavior test suite** — 23 new tests in `AdvancedBehavior.test.ts` verifying:
  - Mass response prevention (exactly 1 response per incoming message)
  - Rate limiting blocks message floods from single user
  - Agent restart: stale history filtered (>30min), responds to most recent message only
  - Tool call end-to-end: web search → tool result → intelligent response with appropriate length
  - Tool calls produce single post-execution response (no double-messaging)
  - Audio/dictation message handling (voice-to-text treated identically to typed messages)
  - Tapback filtering (all 6 tapback prefixes verified)
  - Agentic loop safety: max API calls prevents infinite tool loops
- **Dynamic version display** — Sidebar version now reads from `package.json` at build time via `NEXT_PUBLIC_APP_VERSION` instead of being hardcoded

### Technical
- 157 unit tests passing across 7 test files (up from 134)
- Dashboard version synced with root package version (2.1.0)

## [2.0.1] - 2026-04-07

### Fixed
- **[C1] Database schema mismatch** — Added migration v8 to align `reminders` and `triggers` table schemas with actual tool/service usage. Adds `chat_guid`, `due_at`, `is_sent` columns to reminders and `chat_guid`, `message`, `last_fired_at` columns to triggers, with automatic data back-fill from old columns. Removed redundant `CREATE TABLE IF NOT EXISTS` statements from `setReminder`, `createTrigger`, `ReminderService`, and `TriggerService`.
- **[H1] Budget circuit breaker using wrong pricing** — `isBudgetExceeded()` now reads the configured model from settings and applies correct per-model pricing (Haiku: $0.80/$4.00, Sonnet: $3.00/$15.00 per MTok) instead of hardcoding Haiku rates for all models.
- **[H2] Rate limiting not logged as security event** — Added `logSecurityEvent('rate_limit_exceeded', ...)` call when a message is rate-limited, so it appears in the Security dashboard.
- **[H3] RateLimiter memory leak** — `rateLimiter.cleanup()` is now called every 5 minutes via `setInterval` in `server.ts`, and the interval is cleared on shutdown.
- **[H4] URL allowlist inconsistency** — `PermissionService.openSystemSettings()` now includes `https://console.anthropic.com/` in its allowlist, matching the dashboard route.
- **[M2] Conversation history misattribution** — `isFromMe` messages in iMessage history are no longer blindly mapped to `role: 'assistant'`. The agent now cross-references its own saved messages database; only messages it actually sent are attributed as assistant responses. Manually-sent messages from the Mac user are excluded.
- **[M4] Old facts never expired** — `memoryService.expireOldFacts()` now runs once on startup and every 24 hours via `setInterval` in `server.ts`.
- **[M6] Phantom web_fetch tool in prompt** — Removed the "Web Fetch" section from `PromptBuilder`'s `DEFAULT_TOOL_USAGE` and the `tools.webFetch` / `tools.webFetchMaxTokens` entries from default settings, since the tool was never implemented.
- **[L1] Tools page inconsistent data fetching** — Refactored the Tools dashboard page to use SWR hooks (`useToolDefinitions`, `useToolExecutions`, `useReminders`, `useTriggers`) matching the pattern used by all other dashboard pages. Provides automatic background revalidation, caching, and retry.
- **[L6] Blocking alert() dialogs in dashboard** — Replaced `alert()` calls in the Memory and Settings pages with inline status/error banners that auto-dismiss.
- **[L7] Contact names not resolved** — `normalizeContactName()` now attempts real contact lookup via `node-mac-contacts` (with an in-memory cache) before falling back to phone number formatting.

### Added
- **Audit fix test suite** — 28 new tests in `AuditFixes.test.ts` covering all 11 fixes with source-level verification. Total test count: 90.
- **SWR hooks for tools** — `useToolDefinitions()`, `useToolExecutions()`, `useReminders()`, `useTriggers()` in `dashboard/lib/hooks.ts`.

### Technical
- TypeScript strict mode passes with 0 errors (Electron + Dashboard)
- 90 unit tests passing (62 existing + 28 new)
- Dashboard Next.js build compiles all 12 pages successfully

## [1.7.0] - 2026-04-07

### Security
- **AppleScript injection prevention** — All user-derived strings (chatGuid, address, message text) are now escaped before embedding in AppleScript commands
- **Service type whitelisting** — `sendMessageFallback` validates the service type against an allowlist (`iMessage`, `SMS`) instead of interpolating raw input
- **Centralized API key validation** — `setAnthropicApiKey()` now validates format (`sk-ant-` prefix), length (≤256), and non-empty before storing, preventing invalid keys from being saved through any code path
- **URL scheme allowlisting** — The `/permissions/open-settings` endpoint now restricts URLs to safe prefixes (`x-apple.systempreferences:`, `https://console.anthropic.com/`)
- **Renderer API key masking** — The `secure-storage:get` IPC handler returns `••••••••` instead of the raw API key to the renderer process

### Fixed
- **Infinite retry loop in ClaudeService** — Replaced broken recursive `retryWithBackoff` (which always reset the attempt counter to 1) with Anthropic SDK's built-in `maxRetries: 3`
- **Message drops under per-chat lock** — Messages arriving while a chat is locked are now queued (up to 5 per chat) instead of being silently dropped. Queued messages drain automatically in FIFO order.
- **Cache invalidation on storage clear** — `SecureStorage.clearAll()` now sets `cachedData = null` so subsequent reads don't return stale in-memory data
- **Agent not stopped on app quit** — The `will-quit` handler now explicitly calls `agentService.stop()` before closing the database, preventing polling errors during shutdown
- **Agent state leak on stop** — `stop()` now clears `chatQueues`, `chatLocks`, and `processingQueue` to prevent stale state on restart
- **BER indefinite-length handling** — `extractTextFromAttributedBody` now correctly handles the `0x80` BER indefinite-length marker by skipping it instead of misinterpreting it as a 128-byte length
- **BER length upper bound** — Added a 100KB sanity check on parsed text lengths to prevent wild reads on corrupted `attributedBody` data

### Added
- **Per-chat message queue** — New `chatQueues` map in AgentService with configurable max size (5) to buffer messages during lock contention
- **`downloadUpdate` preload binding** — Exposes `download-update` IPC channel to the renderer so the frontend can trigger update downloads
- **Extracted logger module** — `electron/backend/logger.ts` provides `log()`, `logBuffer`, `logSubscribers`, and `LogEntry` to break circular dependencies between dashboard routes and services
- **Conversation context eviction** — Stale conversation contexts are automatically evicted after 1 hour (TTL) with a hard cap of 500 active conversations to prevent memory leaks
- **Entitlements for child processes** — Added `resources/entitlements.inherit.plist` with minimal entitlements for Electron helper processes

### Changed
- **Notarization uses Keychain profile** — `notarize.js` now uses `xcrun notarytool` keychain credentials (profile: `textmyagent-notarize`) instead of environment-variable-based Apple ID authentication
- **Explicit code signing identity** — `electron-builder.yml` now specifies `identity: "EVERJUST COMPANY (8769U6225R)"` and `type: distribution` to guarantee Developer ID signing
- **Removed dead code** — Deleted unused `broadcastLog` export from logger and its import/re-export from dashboard routes

### Technical
- TypeScript strict mode passes with 0 errors
- All binaries verified signed with `codesign --verify --deep --strict`
- Notarization verified accepted by Apple notary service

## [1.6.0-alpha.1] - 2026-04-06

### Added
- Initial release of TextMyAgent Desktop
- Native iMessage integration (no BlueBubbles required)
- Claude AI powered responses via Anthropic API
- Next.js dashboard for monitoring and configuration
- PermissionService for macOS privacy permission management
- Full Disk Access, Automation, and Contacts permission handling
- SQLite database for message history and settings
- API usage tracking and statistics
- Real-time log streaming
- System tray with quick controls
- Apple notarization support for distribution
- Hardened runtime for production security

### Technical
- Electron 39.x for macOS Sequoia compatibility
- better-sqlite3 for database operations
- node-mac-contacts for Contacts integration
- Secure API key storage in macOS Keychain
- 2-second polling interval for message detection
- Persistent lastRowId to prevent duplicate processing
