# Architecture

## Overview

TextMyAgent Desktop is built with Electron and follows a multi-process architecture with a clear separation between the main process, renderer process, and backend services.

## Process Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron App                              │
├─────────────────────────────────────────────────────────────────┤
│  Main Process (electron/main.ts)                                │
│  ├── Window Management                                          │
│  ├── System Tray                                                │
│  ├── Auto-Updater                                               │
│  └── IPC Handlers                                               │
├─────────────────────────────────────────────────────────────────┤
│  Backend Server (electron/backend/server.ts)                    │
│  ├── Express.js API Server (port 3001)                          │
│  ├── Dashboard Routes                                           │
│  └── Services Layer                                             │
├─────────────────────────────────────────────────────────────────┤
│  Renderer Process (dashboard/)                                  │
│  └── Next.js Dashboard UI                                       │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
textmyagent-desktop/
├── electron/                     # Electron main process
│   ├── main.ts                   # App entry point, window management
│   ├── preload.ts                # Preload script for IPC
│   ├── tsconfig.json             # TypeScript config for Electron
│   ├── backend/                  # Backend server
│   │   ├── server.ts             # Express server setup
│   │   ├── database.ts           # SQLite database & migrations
│   │   ├── logger.ts             # Log buffer, SSE broadcast, LogEntry type
│   │   ├── routes/
│   │   │   └── dashboard.ts      # All API endpoints
│   │   └── services/
│   │       ├── AgentService.ts       # Message processing orchestration
│   │       ├── iMessageService.ts    # iMessage database polling
│   │       ├── ClaudeService.ts      # Anthropic Claude API
│   │       └── PermissionService.ts  # macOS permission checks
│   └── utils/
│       ├── secure-storage.ts     # Keychain API key storage
│       ├── auto-updater.ts       # Electron auto-update
│       └── tray.ts               # System tray menu
├── dashboard/                    # Next.js frontend
│   ├── app/                      # App router pages
│   ├── components/               # React components
│   └── lib/                      # Utilities
├── resources/                    # Build resources
│   ├── icons/                    # App icons (.icns, .png)
│   ├── entitlements.mac.plist    # macOS entitlements (main app)
│   └── entitlements.inherit.plist # Entitlements for helper processes
├── electron-builder.yml          # Build configuration
├── notarize.js                   # Apple notarization script
└── package.json
```

## Services

### AgentService

The core orchestration service that:
- Listens for new messages from iMessageService
- Maintains conversation context per chat (with 1-hour TTL eviction)
- Queues messages when a chat is locked (up to 5 per chat, FIFO drain)
- Sends messages to ClaudeService for AI responses
- Sends responses back via iMessageService
- Saves conversations to the database

```typescript
class AgentService extends EventEmitter {
  start(): Promise<boolean>    // Start the agent
  stop(): Promise<void>        // Stop the agent
  getStatus(): AgentStatus     // Get current status
}
```

### iMessageService

Handles all iMessage database interactions:
- Polls `~/Library/Messages/chat.db` for new messages
- Extracts text from `attributedBody` for newer macOS
- Sends messages via AppleScript/osascript
- Persists last processed ROWID to prevent duplicates

```typescript
class IMessageServiceClass extends EventEmitter {
  startPolling(intervalMs: number): Promise<void>
  stopPolling(): Promise<void>
  sendMessage(chatGuid: string, text: string): Promise<boolean>
  getConversationHistory(chatGuid: string, limit: number): Promise<IMessage[]>
}
```

### ClaudeService

Manages Anthropic Claude API interactions:
- Builds conversation context for Claude
- Handles API calls with error handling
- Tracks token usage

```typescript
class ClaudeServiceClass {
  generateResponse(userMessage: string, history: Message[]): Promise<ClaudeResponse>
  isConfigured(): boolean
  refreshClient(): void
}
```

### PermissionService

Checks and manages macOS permissions:
- Full Disk Access (via file access test)
- Automation (via AppleScript test)
- Contacts (via node-mac-contacts)

```typescript
class PermissionServiceClass {
  checkAllPermissions(): Promise<PermissionsCheckResult>
  openFullDiskAccessSettings(): Promise<void>
  requestContactsPermission(): Promise<boolean>
}
```

## Database Schema

SQLite database stored at `~/Library/Application Support/textmyagent-desktop/textmyagent.db`

### Tables

| Table | Purpose |
|-------|---------|
| `users` | People who have messaged (handle, display_name) |
| `conversations` | Chat sessions linked to users |
| `messages` | Message history (user/assistant/system) |
| `settings` | Key-value configuration store |
| `api_usage` | Token usage tracking per day |
| `reminders` | Scheduled reminders (future) |
| `triggers` | Automation triggers (future) |
| `context` | User context/memory (future) |
| `_migrations` | Schema version tracking |

### Entity Relationships

```
users (1) ──────< conversations (many)
                       │
                       └────< messages (many)
```

## API Endpoints

All endpoints are prefixed with `/api/dashboard/`

### Status & Health
- `GET /api/health` - Health check
- `GET /status` - System status
- `GET /config` - Configuration

### Agent Control
- `GET /agent/status` - Agent status
- `POST /agent/start` - Start agent
- `POST /agent/stop` - Stop agent
- `POST /agent/restart` - Restart agent

### Permissions
- `GET /permissions` - Check all permissions
- `GET /permissions/needs-setup` - Check if setup needed
- `POST /permissions/open-settings` - Open system settings
- `POST /permissions/request-automation` - Request automation

### Data
- `GET /users` - List users
- `GET /messages/all` - List messages
- `GET /users/:userId/messages` - User messages
- `GET /usage` - API usage stats
- `GET /logs` - Application logs

### Setup
- `GET /setup/status` - Setup status
- `POST /setup/credentials` - Save API key
- `POST /setup/test-anthropic` - Test API key

## Message Flow

1. **Polling**: iMessageService polls chat.db every 2 seconds
2. **Detection**: New messages detected by ROWID > lastMessageRowId
3. **Filtering**: Only incoming messages (is_from_me = 0) with text
4. **Event**: iMessageService emits 'message' event
5. **Processing**: AgentService receives and queues message
6. **Context**: Load/create conversation context with history
7. **AI**: Send to ClaudeService for response generation
8. **Response**: ClaudeService calls Anthropic API
9. **Send**: iMessageService sends response via AppleScript
10. **Save**: AgentService saves to database
11. **Persist**: Update lastMessageRowId in settings

## Security

### API Key Storage
- Encrypted via Electron's `safeStorage` API (backed by macOS Keychain)
- Validated on write: must match `sk-ant-` prefix, ≤256 chars
- Masked in renderer process (IPC returns `••••••••` instead of raw key)
- Accessed via `SecureStorage` utility with in-memory cache

### Entitlements
- `com.apple.security.cs.allow-jit` - V8 JIT compilation
- `com.apple.security.cs.allow-unsigned-executable-memory` - Native modules
- `com.apple.security.cs.disable-library-validation` - Native modules
- `com.apple.security.network.client` - Outbound API calls
- `com.apple.security.network.server` - Local dashboard server
- `com.apple.security.personal-information.addressbook` - Contacts
- `com.apple.security.automation.apple-events` - Messages automation

### Hardened Runtime
- Enabled for production builds
- Code signing with Developer ID
- Notarization for Gatekeeper approval

## Build Process

1. **TypeScript Compilation**: `tsc -p electron/tsconfig.json`
2. **Dashboard Build**: `next build` (static export)
3. **Electron Package**: `electron-builder --mac`
4. **Code Signing**: Automatic with Developer ID Application certificate (identity configured in `electron-builder.yml`)
5. **Notarization**: Via `notarize.js` afterSign hook using Keychain-stored credentials (profile: `textmyagent-notarize`)
