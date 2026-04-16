<div align="center">
  <img src="resources/icons/icon.png" alt="TextMyAgent" width="140" height="140" style="border-radius: 28px;">
  <h1>TextMyAgent Desktop</h1>
  <p><strong>AI Executive Assistant for macOS via iMessage</strong></p>
  <p>Runs entirely on your Mac — no cloud, no API keys, no subscriptions.</p>

  <a href="https://github.com/ever-just/textmyagent-desktop/releases/latest"><img src="https://img.shields.io/github/v/release/ever-just/textmyagent-desktop?style=flat-square&color=2563EB&label=latest" alt="Latest Release"></a>
  <img src="https://img.shields.io/badge/platform-macOS%2012%2B-000?style=flat-square&logo=apple&logoColor=white" alt="macOS">
  <img src="https://img.shields.io/badge/model-Gemma%204%20E4B-4285F4?style=flat-square&logo=google&logoColor=white" alt="Gemma">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/tests-155%20passing-brightgreen?style=flat-square" alt="Tests">

  <br><br>

  <a href="#download">Download</a>&ensp;·&ensp;<a href="#features">Features</a>&ensp;·&ensp;<a href="#setup">Setup</a>&ensp;·&ensp;<a href="#development">Development</a>&ensp;·&ensp;<a href="#architecture">Architecture</a>
</div>

---

## Download

> All builds are code-signed with Developer ID. Right-click → Open on first launch.

| Chip | Installer | Zip |
|------|-----------|-----|
| **Apple Silicon** (M1–M4) | [TextMyAgent-2.2.0-arm64.dmg](https://github.com/ever-just/textmyagent-desktop/releases/download/v2.2.0/TextMyAgent-2.2.0-arm64.dmg) | [zip](https://github.com/ever-just/textmyagent-desktop/releases/download/v2.2.0/TextMyAgent-2.2.0-arm64-mac.zip) |
| **Intel** | [TextMyAgent-2.2.0.dmg](https://github.com/ever-just/textmyagent-desktop/releases/download/v2.2.0/TextMyAgent-2.2.0.dmg) | [zip](https://github.com/ever-just/textmyagent-desktop/releases/download/v2.2.0/TextMyAgent-2.2.0-mac.zip) |

---

## Features

- **Native iMessage** — Reads and responds to messages directly from Messages.app
- **On-Device AI** — Powered by Google's Gemma 4 E4B model via `node-llama-cpp`. Zero cloud dependency.
- **Privacy First** — All data stays on your Mac in a local SQLite database
- **Dashboard** — Beautiful Next.js control panel for monitoring and configuration
- **Real-time** — 2-second polling for near-instant responses
- **Memory** — Remembers user facts and preferences across conversations with auto-expiration
- **Reminders & Triggers** — Schedule reminders and create automation triggers via natural language
- **Contact Resolution** — Resolves phone numbers to real names via macOS Contacts
- **GPU Accelerated** — Configurable GPU layer offloading for fast inference on Apple Silicon
- **Auto-Update** — Built-in update checking with user-controlled downloads

---

## Requirements

| Requirement | Minimum |
|-------------|---------|
| **macOS** | 12.0 (Monterey) |
| **RAM** | 8 GB (16 GB recommended) |
| **Disk** | ~4 GB (model download) |
| **Architecture** | Apple Silicon or Intel |

### Permissions

| Permission | Purpose |
|------------|---------|
| **Full Disk Access** | Read iMessage database (`~/Library/Messages/chat.db`) |
| **Automation** | Send messages via Messages.app |
| **Contacts** *(optional)* | Display contact names instead of phone numbers |

---

## Setup

1. **Download & install** — Drag TextMyAgent to Applications, right-click → Open
2. **Grant permissions** — The setup wizard walks you through Full Disk Access, Automation, and Contacts
3. **Download the model** — Gemma 4 E4B downloads automatically (~3.4 GB, one-time)
4. **Launch** — The agent starts responding to your iMessages

No API keys or accounts needed.

---

## Dashboard

| Page | Description |
|------|-------------|
| **Overview** | System status, agent state, quick stats |
| **Messages** | Conversation history |
| **Users** | Contact management |
| **Tools** | AI tools, reminders, automation triggers |
| **Memory** | User facts, summaries, knowledge base |
| **Logs** | Real-time application logs |
| **Usage** | Token usage statistics |
| **Security** | Rate limiting, budget controls, security events |
| **Settings** | Model config, persona, tools, memory, security |

---

## Development

### From Source

```bash
git clone https://github.com/ever-just/textmyagent-desktop.git
cd textmyagent-desktop

npm install
cd dashboard && npm install && cd ..

npm run dev          # development mode
npm test             # run 155 tests
npm run dist:mac     # build signed DMGs
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev mode (dashboard + electron) |
| `npm test` | Run test suite |
| `npm run build` | Build dashboard + electron |
| `npm run dist:mac` | Package signed macOS DMGs |

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  iMessage DB    │────▶│  iMessageService │────▶│  AgentService   │
│  (chat.db)      │     │  (polling)       │     │  (processing)   │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Messages.app   │◀────│  AppleScript     │◀────│  LocalLLMService│
│  (send)         │     │  (osascript)     │     │  (Gemma 4 E4B)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Stack

| Layer | Technology |
|-------|------------|
| **Desktop** | Electron 39 |
| **Dashboard** | Next.js 15, React 19, Tailwind CSS |
| **AI** | Gemma 4 E4B via node-llama-cpp |
| **Database** | better-sqlite3 |
| **Contacts** | node-mac-contacts |

---

## Building for Distribution

### Code Signing

Builds are signed with Developer ID Application certificate. Identity configured in `electron-builder.yml`.

### Notarization

```bash
# One-time: store credentials in Keychain
xcrun notarytool store-credentials "textmyagent-notarize" \
  --key ~/.appstoreconnect/private_keys/AuthKey_YOURKEYID.p8 \
  --key-id YOURKEYID \
  --issuer YOUR-ISSUER-UUID

# Build with notarization
npm run dist:mac

# Skip notarization (dev builds)
SKIP_NOTARIZATION=true npm run dist:mac
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Agent not starting | Check Full Disk Access is enabled in System Settings |
| Messages not sending | Check Automation permission for Messages.app |
| Model won't load | Ensure ~4 GB free disk space; try Re-download in Settings |
| Slow inference | Increase GPU Layers in Settings (requires model reload) |

---

## License

MIT License

## Credits

Created by [Weldon Makori](https://weldonmakori.com)
