# API Reference

## Base URL

```
http://127.0.0.1:3001/api
```

## Health Check

### GET /health

Returns application health status.

**Response:**
```json
{
  "status": "ok",
  "version": "1.6.0-alpha.1",
  "packaged": true,
  "platform": "darwin",
  "arch": "x64"
}
```

---

## Dashboard Endpoints

All dashboard endpoints are prefixed with `/api/dashboard/`

### Status

#### GET /status

Returns overall system status.

**Response:**
```json
{
  "agent": {
    "status": "online",
    "uptime": 3600.5,
    "memory": 52428800,
    "version": "1.6.0-alpha.1",
    "isPackaged": true
  },
  "database": {
    "status": "online",
    "type": "sqlite"
  },
  "imessage": {
    "status": "online",
    "configured": true
  },
  "configured": true
}
```

#### GET /config

Returns application configuration.

**Response:**
```json
{
  "anthropic": {
    "model": "claude-3-5-haiku-latest",
    "temperature": 0.7,
    "responseMaxTokens": 350,
    "contextWindowTokens": 7000,
    "enableWebSearch": true,
    "hasApiKey": true
  },
  "imessage": {
    "configured": true,
    "sendEnabled": true
  },
  "app": {
    "version": "1.6.0-alpha.1",
    "platform": "darwin",
    "arch": "x64"
  }
}
```

---

### Agent Control

#### GET /agent/status

Returns current agent status.

**Response:**
```json
{
  "isRunning": true,
  "isConnected": true,
  "activeConversations": 3,
  "processingCount": 0
}
```

#### POST /agent/start

Starts the AI agent.

**Response:**
```json
{
  "success": true,
  "message": "Agent started"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Anthropic API key not configured"
}
```

#### POST /agent/stop

Stops the AI agent.

**Response:**
```json
{
  "success": true,
  "message": "Agent stopped"
}
```

#### POST /agent/restart

Restarts the AI agent.

**Response:**
```json
{
  "success": true,
  "message": "Agent restarted"
}
```

---

### Permissions

#### GET /permissions

Returns status of all macOS permissions.

**Response:**
```json
{
  "allGranted": true,
  "requiredGranted": true,
  "permissions": [
    {
      "id": "full_disk_access",
      "name": "Full Disk Access",
      "description": "Required to read your iMessage history",
      "status": "granted",
      "required": true,
      "settingsUrl": "x-apple.systempreferences:...",
      "instructions": ["Open System Settings", "..."]
    },
    {
      "id": "automation",
      "name": "Automation",
      "description": "Required to send messages",
      "status": "granted",
      "required": true,
      "settingsUrl": "...",
      "instructions": ["..."]
    },
    {
      "id": "contacts",
      "name": "Contacts",
      "description": "Display contact names",
      "status": "granted",
      "required": false,
      "settingsUrl": "...",
      "instructions": ["..."]
    }
  ],
  "services": [...],
  "apiKeys": [...]
}
```

#### GET /permissions/needs-setup

Check if onboarding is needed.

**Response:**
```json
{
  "needsSetup": false,
  "isFirstLaunch": false,
  "missingPermissions": []
}
```

#### POST /permissions/open-settings

Opens system settings for a specific permission.

**Request:**
```json
{
  "permissionId": "full_disk_access"
}
```

**Response:**
```json
{
  "success": true
}
```

#### POST /permissions/request-automation

Triggers the automation permission prompt.

**Response:**
```json
{
  "success": true,
  "status": "granted",
  "needsSettings": false
}
```

---

### Users

#### GET /users

Returns all users who have messaged.

**Response:**
```json
{
  "users": [
    {
      "id": "uuid-here",
      "handle": "+15551234567",
      "displayName": "John Doe",
      "isBlocked": 0,
      "createdAt": "2024-01-01 12:00:00",
      "conversationCount": 1,
      "lastMessageAt": "2024-01-15 14:30:00"
    }
  ]
}
```

---

### Messages

#### GET /messages/all

Returns all messages with pagination.

**Query Parameters:**
- `limit` (default: 50) - Number of messages
- `offset` (default: 0) - Offset for pagination

**Response:**
```json
{
  "messages": [
    {
      "id": "uuid-here",
      "role": "user",
      "content": "Hello!",
      "createdAt": "2024-01-15 14:30:00",
      "conversationId": "conv-uuid",
      "userHandle": "+15551234567",
      "userDisplayName": "John Doe"
    },
    {
      "id": "uuid-here",
      "role": "assistant",
      "content": "Hi there! How can I help?",
      "createdAt": "2024-01-15 14:30:01",
      "conversationId": "conv-uuid",
      "userHandle": "+15551234567",
      "userDisplayName": "John Doe"
    }
  ]
}
```

#### GET /users/:userId/messages

Returns messages for a specific user.

**Response:**
```json
{
  "messages": [...]
}
```

#### POST /messages/send

Send a manual message from the dashboard.

**Request:**
```json
{
  "chatGuid": "iMessage;-;+15551234567",
  "message": "Hello from dashboard!"
}
```

**Response:**
```json
{
  "success": true
}
```

---

### Usage

#### GET /usage

Returns API token usage statistics.

**Query Parameters:**
- `period` (default: "day") - Aggregation period

**Response:**
```json
{
  "usage": [
    {
      "period": "2024-01-15",
      "inputTokens": 15000,
      "outputTokens": 3000,
      "totalTokens": 18000,
      "requestCount": 25
    }
  ],
  "totals": {
    "inputTokens": 150000,
    "outputTokens": 30000,
    "totalTokens": 180000,
    "requestCount": 250
  }
}
```

---

### Logs

#### GET /logs

Returns application logs.

**Query Parameters:**
- `level` - Filter by level (error, warn, info, debug)
- `search` - Search in message/metadata
- `limit` (default: 100) - Number of logs

**Response:**
```json
{
  "logs": [
    {
      "timestamp": "2024-01-15T14:30:00.000Z",
      "level": "info",
      "message": "Agent started successfully",
      "metadata": {}
    }
  ]
}
```

#### GET /logs/stream

Server-Sent Events stream for real-time logs.

**Response:** SSE stream

---

### Setup

#### GET /setup/status

Returns setup/onboarding status.

**Response:**
```json
{
  "isConfigured": true,
  "steps": {
    "apiKey": true,
    "fullDiskAccess": true,
    "automation": true,
    "contacts": true
  },
  "permissions": {
    "allGranted": true,
    "requiredGranted": true,
    "details": [...]
  },
  "needsSetup": false
}
```

#### POST /setup/credentials

Save API credentials.

**Request:**
```json
{
  "anthropicApiKey": "sk-ant-..."
}
```

**Response:**
```json
{
  "success": true,
  "isConfigured": true,
  "details": {
    "apiKey": true,
    "imessage": true
  }
}
```

#### POST /setup/test-anthropic

Test Anthropic API key.

**Request:**
```json
{
  "apiKey": "sk-ant-..."
}
```

**Response:**
```json
{
  "success": true,
  "model": "claude-3-5-haiku-latest"
}
```

#### POST /setup/test-imessage

Test iMessage database access.

**Response:**
```json
{
  "success": true,
  "hasAccess": true,
  "recentChats": 15
}
```

---

### Contacts

#### POST /contacts/import

Import contacts from macOS Contacts.

**Response:**
```json
{
  "success": true,
  "imported": 50,
  "contacts": [...]
}
```

#### POST /contacts/request-permission

Request Contacts permission.

**Response:**
```json
{
  "success": true,
  "status": "granted",
  "needsSettings": false
}
```

---

### Settings

#### POST /settings/api-key

Save an API key.

**Request:**
```json
{
  "key": "anthropic",
  "value": "sk-ant-..."
}
```

**Response:**
```json
{
  "success": true
}
```
