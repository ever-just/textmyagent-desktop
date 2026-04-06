# Setup Guide

## Prerequisites

Before installing TextMyAgent Desktop, ensure you have:

1. **macOS 12.0 (Monterey) or later**
2. **Messages app configured** with iMessage or SMS
3. **Anthropic API key** from [console.anthropic.com](https://console.anthropic.com/settings/keys)

---

## Installation

### Option 1: Download Release (Recommended)

1. Go to [Releases](https://github.com/ever-just/textmyagent-desktop/releases)
2. Download the latest `.dmg` file
3. Open the DMG
4. Drag TextMyAgent to your Applications folder
5. Launch TextMyAgent

### Option 2: Build from Source

```bash
# Clone repository
git clone https://github.com/ever-just/textmyagent-desktop.git
cd textmyagent-desktop

# Install dependencies
npm install
cd dashboard && npm install && cd ..

# Build dashboard
cd dashboard && npm run build && cd ..

# Build and package
npm run build:electron
npm run package:mac

# App is in build/mac/TextMyAgent.app
```

---

## First Launch Setup

### Step 1: Grant Full Disk Access

TextMyAgent needs to read your iMessage database. This requires Full Disk Access.

1. When prompted, click "Open System Settings"
2. Or manually: **System Settings → Privacy & Security → Full Disk Access**
3. Click the **+** button
4. Navigate to **Applications** and select **TextMyAgent**
5. Toggle TextMyAgent **ON**
6. **Restart TextMyAgent** for changes to take effect

> ⚠️ The app will not work without Full Disk Access

### Step 2: Configure API Key

1. Click the TextMyAgent icon in your menu bar
2. Select **Open Dashboard**
3. Go to **Settings** page
4. Enter your Anthropic API key
5. Click **Save**

To get an API key:
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign in or create an account
3. Go to **Settings → API Keys**
4. Click **Create Key**
5. Copy the key (starts with `sk-ant-`)

### Step 3: Grant Automation Permission

When the agent sends its first message, macOS will prompt for Automation access.

1. Click **OK** when prompted
2. Or manually: **System Settings → Privacy & Security → Automation**
3. Find TextMyAgent and enable **Messages**

### Step 4: (Optional) Grant Contacts Access

To display contact names instead of phone numbers:

1. **System Settings → Privacy & Security → Contacts**
2. Find TextMyAgent and toggle **ON**

---

## Verify Setup

### Check Dashboard

1. Open the dashboard (menu bar → Open Dashboard)
2. Go to **Overview** page
3. Verify all status indicators are green:
   - Agent: Running
   - iMessage: Connected
   - Database: Online

### Check Permissions

1. Go to **Settings** page
2. Check the Permissions section
3. All required permissions should show ✓

### Test the Agent

1. Send yourself an iMessage from another device
2. Or have a friend send you a message
3. Watch the **Logs** page for activity
4. The agent should respond within a few seconds

---

## Configuration Options

### Dashboard Settings

| Setting | Description | Default |
|---------|-------------|---------|
| API Key | Anthropic API key | Required |
| Model | Claude model to use | claude-3-5-haiku-latest |
| Temperature | Response creativity (0-1) | 0.7 |
| Max Tokens | Maximum response length | 350 |

### Environment Variables

For development or advanced configuration:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Override stored API key |
| `SKIP_NOTARIZATION` | Skip notarization in builds |

---

## Data Storage

### Database Location
```
~/Library/Application Support/textmyagent-desktop/textmyagent.db
```

### Logs Location
```
~/Library/Logs/textmyagent-desktop/
```

### API Key Storage
- Stored securely in macOS Keychain
- Service name: `textmyagent-desktop`
- Account: `anthropic-api-key`

---

## Troubleshooting

### "Agent not starting"

1. Check Full Disk Access is enabled
2. Verify API key is configured in Settings
3. Check Logs page for errors

### "Messages not being detected"

1. Verify Full Disk Access is granted
2. Restart the app after granting permission
3. Check that Messages app is running and signed in

### "Messages not sending"

1. Check Automation permission is granted
2. Verify Messages app is signed into iMessage
3. Check Logs for AppleScript errors

### "Permission denied errors"

1. Remove TextMyAgent from Full Disk Access
2. Re-add it
3. Restart the app

### Reset Everything

To completely reset the app:

```bash
# Remove database
rm -rf ~/Library/Application\ Support/textmyagent-desktop/

# Remove from Keychain (API key)
security delete-generic-password -s "textmyagent-desktop" -a "anthropic-api-key"

# Remove from Full Disk Access manually in System Settings
```

---

## Updating

### Automatic Updates

TextMyAgent checks for updates automatically and will prompt you when a new version is available.

### Manual Update

1. Download the latest release
2. Quit TextMyAgent
3. Replace the app in Applications
4. Launch the new version

Your data and settings are preserved between updates.

---

## Uninstalling

1. Quit TextMyAgent
2. Delete from Applications
3. (Optional) Remove data:
   ```bash
   rm -rf ~/Library/Application\ Support/textmyagent-desktop/
   ```
4. (Optional) Remove from System Settings → Privacy & Security
