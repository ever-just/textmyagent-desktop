# Changelog

All notable changes to TextMyAgent Desktop will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Multi-language support
- Message coalescing (Phase 5.1 in scale plan)
- Prefix cache empirical verification benchmarks
- Optional experimental KV cache quantization (dev-mode only)

## [2.4.0] - 2026-04-16

**Scale & Efficiency release.** Removes artificial throughput bottlenecks, adds adaptive hardware sizing, and makes conversation continuity far more efficient. See `docs/SCALE_AND_EFFICIENCY.md` for the full plan + honest limits.

### Added

- **Adaptive resource sizing (Phase 2.1)** — On model load, detect total RAM and auto-size the session pool + recommend the right model variant: 8GB → E2B, pool 2; 16GB → E4B, pool 4; 32GB → E4B, pool 6; 64GB+ → E4B, pool 10. Logged with full rationale so operators can see what was picked.
- **Idle TTL on session pool (Phase 2.3)** — Warm sessions are now evicted after 10 minutes of inactivity, freeing pool slots for actually-active users instead of waiting for LRU pressure. Sweep runs every 60s.
- **Auto-summarization on eviction (Phase 4.2)** — When any session leaves the pool (LRU, idle TTL, manual), `AgentService` captures the conversation as a 2-3 sentence summary before the KV cache is lost. Uses an ephemeral summarization session with a tight 30s timeout; never pollutes the evicted session's state. Persisted via `memoryService.saveSummary()`.
- **Cold-start summary recall (Phase 5.3)** — Returning users whose session was evicted now have their most recent `conversation_summary` injected into the prompt context, giving the LLM structural recall without needing to prefill the full message history.
- **`/api/dashboard/metrics` endpoint (Phase 5.4)** — New observability route exposing: per-message latency (avg/p50/p95/max) with warm/cold/summary scenario breakdown, throughput estimate (messages/hour extrapolated from 15-min window), outcome counts (sent/rate_limited/queue_dropped/error/tool_only/wait), system resources (RAM usage, process RSS), LLM pool state (size/max/per-session ages), rate limiter state, and per-chat queue depths.
- **`MetricsService`** — In-memory ring-buffer metrics (500 samples) with reset for tests. Zero external dependencies, zero DB I/O, safe to call frequently.
- **`LocalLLMService.generateSummary()`** — Dedicated summarization API that bypasses the tool pipeline, uses an ephemeral (non-pooled) session, and is immune to rate-limit counters so internal summarization calls don't exhaust user quotas.
- **`LocalLLMService.onSessionEvicted()` callback pattern** — Eviction handlers can be registered by any service; runs before session dispose with per-handler error isolation. Enables the summarization flow without coupling `LocalLLMService` to `AgentService`'s message history.
- **35 new regression tests** in `ScaleEfficiency.test.ts` covering adaptive pool sizing across 4 RAM tiers, idle TTL eviction, eviction callback safety (sync/async errors), metrics ring buffer + percentiles + throughput estimation, and 11 structural source-code invariants to catch future regressions.
- **Contact picker UI** on the dashboard home page — manage reply-mode (everyone vs. allowlist) and the allowed-contacts list directly from the main dashboard. Includes search, add/remove flow, live save indicator.
- **Contacts import API** (`POST /api/dashboard/contacts/import`) — imports macOS Contacts into the app's user directory for use in the allowlist picker. `MacContact` type exported from `dashboard/lib/api.ts`.

### Changed

- **Global rate limit default raised 200 → 5000 per hour** (`RateLimiter.DEFAULT_GLOBAL_LIMIT`). The 200/hr default was a legacy paid-API cost-control measure that capped local inference to ~17% of real hardware capacity. DB seed updated to match for new installs; existing installs keep their configured value.
- **Default context size lowered 8192 → 4096 tokens** (`LocalLLMService.contextSize`). SMS-style conversations rarely need more than ~3.5K tokens (system prompt ~1K + facts/summary ~500 + last 20 messages ~2K), and the lower default frees ~60-120 MB per session to fund more pool slots.
- **Context size now passed explicitly** to `model.createContext()` instead of relying on node-llama-cpp's auto-detection. We control memory deterministically rather than guessing.
- **Per-chat queue overflow policy: drop-newest instead of drop-oldest (Phase 4.1)** — When a chat's queue fills (>5 pending messages), the newest incoming message is rejected rather than silently dropping the oldest queued one. Preserves earliest conversational context for the pending LLM response instead of leaving the agent responding to phantom mid-conversation state.
- **Warm-conversation fast path (Phase 3.1)** — Conversations active within the last 10 minutes now skip the full `iMessage` history reload (saves ~100-300ms per warm message), relying on the in-memory `conversations` map instead. Cold conversations still get the full reload.
- **LRU eviction now fires registered eviction handlers** — Previously silent; now triggers the auto-summarization hook before session disposal.
- **`polling.sleepIntervalMs` code/DB default unified at 15000ms** — Previously the DB seeded 15s but the code fallback was 5s, creating a silent mismatch when the DB setting was missing.
- **Permission check caching** — `PermissionService.checkAllPermissions()` now caches results for 30 seconds, reducing redundant OS-level authorization probes.
- **Permission polling interval 5s → 60s** — Dashboard `usePermissions()` hook refreshes once a minute instead of every 5 seconds. Permissions rarely change during a session.
- **Reduced log verbosity** — Per-permission-check info logs downgraded to debug level so normal operation is quieter.
- **Version alignment** — Dashboard `package.json` was stuck at 2.1.0 while root was at 2.3.0, causing the app-footer version display (bottom-left sidebar) to show a stale number. Both are now synchronized at 2.4.0.

### Fixed

- **Silent queue message loss** during conversation bursts — drop-oldest policy meant early context could be lost without the agent realizing. Drop-newest now logs every rejection with chatGuid + preview.
- **Session-reuse assumption test** (`BehaviorSimulation`, `AdvancedBehavior`, `CoreBehavior`, `ToolSimulation`, `AuditFixes`) — 5 test-file mocks updated to expose the new `onSessionEvicted`, `getPoolStats`, `detectRecommendedPoolSize`, `sweepIdleSessions`, `generateSummary`, `evictSession` methods so test suites load `AgentService` correctly.

### Documentation

- **`docs/SCALE_AND_EFFICIENCY.md`** — New 12-section consolidated plan covering: complete inbound pipeline diagram, every queue & throttle with capacity numbers, session reuse mechanism, measured bandwidth vs theoretical, realistic user capacity by hardware tier, 8 bottlenecks ranked by impact, 13 things already efficient (preserve list), 5-phase fix plan, honest limits & tradeoffs, explicit non-goals & rejected ideas, and research history with audit corrections.
- **`docs/SCALE_RESEARCH_FINDINGS.md`** + **`docs/SCALE_ARCHITECTURE_PLAN.md`** — Earlier drafts retained for audit trail (superseded by `SCALE_AND_EFFICIENCY.md`).

### Performance Impact (estimated)

| Metric | 2.3.0 | 2.4.0 |
|---|---|---|
| Max sustained throughput | 200 msg/hr (artificial cap) | ~300-580 msg/hr mixed |
| Warm session capacity (16GB Mac) | 2 conversations | 4 conversations |
| Warm session capacity (32GB Mac) | 2 conversations | 6 conversations |
| Latency for returning user (was evicted, had summary) | Full history replay | Summary-based cold-start |
| Observability | None | `/api/dashboard/metrics` |

## [2.3.0] - 2026-04-16

### Fixed
- **Tool call text leak** — Gemma 4 sometimes outputs raw tool-call tokens as plain text instead of invoking the function API. Added two-layer defense: `stripAndExecuteRawToolCalls()` in LocalLLMService detects, executes, and strips 5 known patterns; MessageFormatter sanitize stage provides a safety net for any residuals.
- **Memory system underuse** — Strengthened prompt instructions so the agent automatically calls `save_user_fact` when users share personal details, without being asked. Silent tool-only responses (no text, just tool execution) are now handled gracefully instead of sending empty messages.

### Changed
- **Multi-message splitting enabled by default** — Responses now split into up to 3 iMessage bubbles at paragraph boundaries. `maxChunks` raised from 1→3, `hardMaxChars` from 500→1200, `maxResponseChars` from 300→400. Prompt updated to encourage natural paragraph breaks instead of forbidding splits.
- **Faster typing delay** — Reduced artificial typing indicator from 800–3000ms to 200–1000ms range (scale factor 15→8 ms/char) to make responses feel snappier.
- **Inter-bubble delay** — Reduced `splitDelaySeconds` from 1.5→1.0s for quicker multi-bubble delivery.

### Added
- **Inference timing telemetry** — `durationMs` field added to `LLMResponse` interface. Logged as `inferenceDurationMs` in "Response sent", "wait" skip, and "tool-only" skip log entries for performance monitoring.
- **Behavior simulation tests** — 24 new end-to-end simulations (BehaviorSimulation.test.ts) covering tool leak prevention, multi-bubble splitting, memory auto-save, typing delay, and inference telemetry.
- **Tool call stripping tests** — 20 new unit tests (ToolCallStripping.test.ts) for regex detection, fallback execution, malformed JSON handling, and formatter safety net.

## [2.2.0] - 2026-04-15

### Added
- **Local LLM migration** — Replaced Anthropic Claude API with local Gemma 4 E4B model via `node-llama-cpp`. All inference now runs on-device.
- **Onboarding flow** — New 4-step gated stepper (Welcome → Permissions → Model Download → Launch) with real-time permission polling and auto-download.
- **Model management UI** — Settings page now shows read-only model info card, live status badge, and action buttons (Download, Load, Re-download).
- **GPU Layers setting** — Configurable GPU layer offloading (`-1` = auto, `0` = CPU only) with live propagation and `setGpuLayers()` API.
- **`getSettingValue()` function** — Added missing database helper that was causing silent settings sync failures.

### Fixed
- **[C1] Unbounded tool loop** — `maxToolLoops` setting is now enforced inside tool handlers; tool calls beyond the limit return an error message instead of executing.
- **[C2] Budget system semantic mismatch** — Replaced stale Anthropic Haiku pricing with token-based budget enforcement. `isBudgetExceeded()` now queries actual token usage from `api_usage` table.
- **[C3] Skip-to-Dashboard redirect loop** — "Skip to Dashboard" now sets a `localStorage` flag; layout guard respects it. Flag clears when setup completes.
- **[H1+H2] `syncSettings()` safety** — Replaced `dynamic require()` + `Number()` with statically-imported `getSettingInt`/`getSettingFloat` helpers that have NaN guards.
- **[H3] Download polling interval leaks** — Both setup and settings pages now store polling intervals in `useRef` with cleanup on unmount.
- **[H4] `gpuLayers` not propagated on save** — Added `setGpuLayers()` to `LocalLLMService` and wired it into the `/config` PUT handler.
- **[H5] No UI feedback for reload-required settings** — Context size and GPU layers inputs now show "Requires model reload" hint.
- **[H6] Empty catch blocks** — Replaced silent error swallowing with `console.error` / `log()` calls in permission actions and `syncSettings()`.
- **[M1] Duplicate `getSettingValue`** — Removed local copy in `dashboard.ts` route handler; now imports from `database.ts`.
- **[M4] Vacuous truth on permissions** — `allRequiredGranted` now requires `requiredPermissions.length > 0` to prevent premature button enabling.
- **[M5] Stale `apiKeys` type** — Removed from `getPermissions` response type and deleted dead API Keys section from permissions page.
- **[M6] Dead `model` state** — Removed unused `model` state variable from settings page (model name is now read-only).
- **[M7] No-op Tailwind class** — Removed `duration-300` from setup step containers (animation duration is defined in CSS).
- **[L3] `any` types in permission filtering** — Replaced with proper `Permission` type import.

### Removed
- **Anthropic Claude integration** — `ClaudeService.ts` deleted; all references to API keys and cloud pricing removed.

### Technical
- TypeScript strict mode passes with 0 errors (Electron + Dashboard)
- 155 unit tests passing across 7 test files
- Full audit findings documented in `docs/CODEX_AUDIT_FINDINGS.md`

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
