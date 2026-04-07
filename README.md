# TextMyAgent Desktop

<p align="center">
  <img src="resources/icons/icon.png" alt="TextMyAgent Logo" width="128" height="128">
</p>

<p align="center">
  <strong>AI Executive Assistant for macOS via iMessage</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#setup">Setup</a> •
  <a href="#development">Development</a> •
  <a href="#architecture">Architecture</a>
</p>

---

## Overview

TextMyAgent Desktop is a native macOS application that provides an AI-powered executive assistant (Grace) directly through your iMessage conversations. Built with Electron and powered by Anthropic's Claude, it runs entirely on your Mac with no cloud servers required.

## Features

- **🍎 Native iMessage Integration** - Reads and responds to messages directly from your Messages app
- **🤖 Claude AI Powered** - Uses Anthropic's Claude 3.5 Haiku for intelligent, context-aware responses
- **🔒 Privacy First** - All data stays on your Mac in a local SQLite database
- **📊 Dashboard** - Beautiful Next.js dashboard for monitoring and configuration
- **⚡ Real-time** - 2-second polling for near-instant responses
- **🔐 Production Ready** - Hardened runtime, code signing, and notarization support

## Requirements

| Requirement | Version |
|-------------|---------|
| macOS | 12.0 (Monterey) or later |
| Node.js | 20.x or later |
| Architecture | Apple Silicon or Intel |

### Required Permissions

| Permission | Purpose |
|------------|---------|
| **Full Disk Access** | Read iMessage database (`~/Library/Messages/chat.db`) |
| **Automation** | Send messages via Messages.app |
| **Contacts** (optional) | Display contact names instead of phone numbers |

## Download

### macOS

| Chip | Download |
|------|----------|
| **Apple Silicon** (M1/M2/M3) | [TextMyAgent-1.6.0-arm64.dmg](https://github.com/ever-just/textmyagent-desktop/releases/download/v1.6.0/TextMyAgent-1.6.0-arm64.dmg) |
| **Intel** | [TextMyAgent-1.6.0.dmg](https://github.com/ever-just/textmyagent-desktop/releases/download/v1.6.0/TextMyAgent-1.6.0.dmg) |

> **First Launch:** Right-click the app and select "Open" to bypass Gatekeeper on first launch.

## Installation

### From Release

1. Download the DMG for your Mac from the links above
2. Open the DMG and drag TextMyAgent to Applications
3. **Right-click** TextMyAgent and select **Open** (required for first launch)
4. Follow the setup wizard

### From Source

```bash
# Clone the repository
git clone https://github.com/ever-just/textmyagent-desktop.git
cd textmyagent-desktop

# Install dependencies
npm install
cd dashboard && npm install && cd ..

# Build the dashboard
cd dashboard && npm run build && cd ..

# Build Electron
npm run build:electron

# Package the app
npm run package:mac
```

## Setup

### 1. Grant Permissions

On first launch, you'll need to grant permissions:

1. **Full Disk Access** (Required)
   - Open System Settings → Privacy & Security → Full Disk Access
   - Click the + button and add TextMyAgent
   - Restart TextMyAgent

2. **Automation** (Required)
   - Will be prompted automatically when sending first message
   - Enable "Messages" for TextMyAgent

3. **Contacts** (Optional)
   - Open System Settings → Privacy & Security → Contacts
   - Enable TextMyAgent

### 2. Configure API Key

1. Get an API key from [Anthropic Console](https://console.anthropic.com/settings/keys)
2. Open the TextMyAgent dashboard (click tray icon → Open Dashboard)
3. Go to Settings and enter your API key

### 3. Start the Agent

The agent starts automatically. You can control it from the dashboard:
- **Start/Stop** - Toggle agent on/off
- **Restart** - Restart with fresh state

## Usage

Once configured, TextMyAgent will:

1. Monitor your iMessage database for new incoming messages
2. Process messages through Claude AI
3. Send intelligent responses back via Messages.app
4. Log all conversations to the local database

### Dashboard Features

| Page | Description |
|------|-------------|
| **Overview** | System status, agent state, quick stats |
| **Messages** | View all conversations and message history |
| **Users** | Manage contacts who have messaged you |
| **Logs** | Real-time application logs |
| **Usage** | API token usage and costs |
| **Settings** | API keys, permissions, configuration |

## Development

### Commands

```bash
# Development
npm run dev                  # Run in development mode

# Building
npm run build:electron       # Compile TypeScript
npm run package:mac          # Build macOS app

# Dashboard
cd dashboard
npm run dev                  # Run dashboard dev server
npm run build                # Build for production
```

## Architecture

### Message Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  iMessage DB    │────▶│  iMessageService │────▶│  AgentService   │
│  (chat.db)      │     │  (polling)       │     │  (processing)   │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Messages.app   │◀────│  AppleScript     │◀────│  ClaudeService  │
│  (send)         │     │  (osascript)     │     │  (AI response)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## Building for Distribution

### Notarization

For distribution outside the App Store:

```bash
export APPLE_ID="your@email.com"
export APPLE_ID_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="YOURTEAMID"
npm run package:mac
```

## Troubleshooting

### Agent Not Starting
- Check Full Disk Access is enabled
- Verify API key is configured
- Check logs in dashboard

### Messages Not Sending
- Check Automation permission for Messages
- Verify Messages.app is signed into iMessage

## License

MIT License

## Credits

Created by [Weldon Makori](https://weldonmakori.com)
