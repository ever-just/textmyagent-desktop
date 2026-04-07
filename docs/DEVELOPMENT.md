# Development Guide

## Prerequisites

- Node.js 20.x or later
- npm 10.x or later
- macOS 12.0+ (for testing)
- Xcode Command Line Tools

## Getting Started

```bash
# Clone the repository
git clone https://github.com/ever-just/textmyagent-desktop.git
cd textmyagent-desktop

# Install root dependencies
npm install

# Install dashboard dependencies
cd dashboard && npm install && cd ..
```

## Development Workflow

### Running in Development Mode

```bash
# Terminal 1: Run dashboard dev server
cd dashboard && npm run dev

# Terminal 2: Run Electron in dev mode
npm run dev
```

### Building

```bash
# Build TypeScript (Electron)
npm run build:electron

# Build dashboard for production
cd dashboard && npm run build && cd ..

# Package the app
npm run package:mac
```

## Project Structure

```
textmyagent-desktop/
├── electron/                 # Main process code
│   ├── main.ts              # Entry point
│   ├── preload.ts           # Preload script
│   ├── tsconfig.json        # TS config
│   ├── backend/
│   │   ├── server.ts        # Express server
│   │   ├── database.ts      # SQLite + migrations
│   │   ├── logger.ts        # Log buffer + SSE broadcast
│   │   ├── routes/
│   │   │   └── dashboard.ts # API endpoints
│   │   └── services/
│   │       ├── AgentService.ts
│   │       ├── iMessageService.ts
│   │       ├── ClaudeService.ts
│   │       └── PermissionService.ts
│   └── utils/
│       ├── secure-storage.ts
│       ├── auto-updater.ts
│       └── tray.ts
├── dashboard/                # Next.js frontend
│   ├── app/                # Pages
│   ├── components/         # React components
│   └── lib/               # Utilities
├── resources/
│   ├── icons/
│   └── entitlements.mac.plist
├── electron-builder.yml
├── notarize.js
└── package.json
```

## Key Files

### electron/main.ts
- Creates BrowserWindow
- Starts backend server
- Sets up system tray
- Handles app lifecycle

### electron/backend/server.ts
- Express.js server on port 3001
- Mounts dashboard routes
- Auto-starts agent on launch

### electron/backend/services/AgentService.ts
- Core message processing
- Conversation context management
- Coordinates iMessage and Claude services

### electron/backend/services/iMessageService.ts
- Polls iMessage database
- Sends messages via AppleScript
- Handles message deduplication

### electron/backend/services/ClaudeService.ts
- Anthropic API integration
- Response generation
- Token tracking

## Adding a New API Endpoint

1. Open `electron/backend/routes/dashboard.ts`
2. Add your route:

```typescript
router.get('/my-endpoint', async (req: Request, res: Response) => {
  try {
    // Your logic here
    res.json({ success: true, data: {} });
  } catch (error: any) {
    log('error', 'My endpoint failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});
```

3. Rebuild: `npm run build:electron`

## Adding a New Service

1. Create `electron/backend/services/MyService.ts`:

```typescript
import { EventEmitter } from 'events';
import { log } from '../logger';

class MyServiceClass extends EventEmitter {
  private static instance: MyServiceClass;

  static getInstance(): MyServiceClass {
    if (!MyServiceClass.instance) {
      MyServiceClass.instance = new MyServiceClass();
    }
    return MyServiceClass.instance;
  }

  async doSomething(): Promise<void> {
    log('info', 'Doing something');
    // Implementation
  }
}

export const myService = MyServiceClass.getInstance();
```

2. Import in routes or other services as needed

## Database Migrations

Migrations are in `electron/backend/database.ts`.

To add a new migration:

```typescript
const migrations: Migration[] = [
  // ... existing migrations
  {
    version: 4,
    name: 'add_my_table',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS my_table (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
    },
  },
];
```

Migrations run automatically on app start.

## Testing

### Manual Testing

1. Build and run the app
2. Check the dashboard at http://127.0.0.1:3001
3. Test API endpoints with curl:

```bash
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1:3001/api/dashboard/agent/status
```

### Testing iMessage Integration

1. Ensure Full Disk Access is granted
2. Send yourself a message from another device
3. Check logs for processing

## Debugging

### Electron DevTools

In development mode, DevTools open automatically. In production:
- Menu bar → View → Toggle Developer Tools
- Or: `Cmd+Option+I`

### Backend Logs

Check the Logs page in the dashboard or:
```bash
tail -f ~/Library/Logs/textmyagent-desktop/*.log
```

### Database Inspection

```bash
sqlite3 ~/Library/Application\ Support/textmyagent-desktop/textmyagent.db
.tables
SELECT * FROM settings;
SELECT * FROM messages LIMIT 10;
```

## Code Style

- TypeScript strict mode
- Async/await for all async operations
- EventEmitter for service communication
- Singleton pattern for services
- Log all important operations

## Building for Release

### Prerequisites

- Apple Developer account with active Developer Program membership
- Developer ID Application certificate installed in Keychain
- App Store Connect API key (`.p8` file)

### One-Time Setup: Store Notarization Credentials

```bash
xcrun notarytool store-credentials "textmyagent-notarize" \
  --key ~/.appstoreconnect/private_keys/AuthKey_YOURKEYID.p8 \
  --key-id YOURKEYID \
  --issuer YOUR-ISSUER-UUID
```

### Build Steps

```bash
# Build everything and package with signing + notarization
npm run dist:mac

# Or skip notarization for faster dev builds
SKIP_NOTARIZATION=true npm run dist:mac
```

The `notarize.js` afterSign hook automatically submits to Apple's notary service using the stored keychain profile.

### Creating a Release

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Commit and tag: `git tag v1.x.0`
4. Build: `npm run dist:mac`
5. Create GitHub release and upload DMG/ZIP artifacts from `build/`

## Troubleshooting Development

### "Cannot find module" errors
```bash
rm -rf node_modules package-lock.json
npm install
```

### TypeScript errors
```bash
npm run build:electron
# Check for errors in output
```

### Dashboard not loading
```bash
cd dashboard
rm -rf .next node_modules
npm install
npm run build
```

### Native module issues
```bash
npm run rebuild
# Or manually:
npx electron-rebuild
```
