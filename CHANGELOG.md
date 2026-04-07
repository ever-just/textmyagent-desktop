# Changelog

All notable changes to TextMyAgent Desktop will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Conversation summarization
- User context/memory system
- Scheduled reminders
- Automation triggers
- Multi-language support

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
