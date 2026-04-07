# TextMyAgent — Revised Implementation Plan (v2)

> Based on findings from UPGRADE_REVIEW_REPORT.md
> Updated: Added Anthropic web_search + web_fetch tools and response processing pipeline
> Items marked [CHANGED] or [NEW] differ from the original upgrade documents

---

## Pre-Phase: Foundation Fixes (~1 day)

These must be completed before any feature work begins.

| # | Task | Rationale |
|---|------|-----------|
| 0.1 | **[NEW]** Enable WAL mode: `db.pragma('journal_mode = WAL')` in `database.ts` after opening DB | Critical: concurrent read/write safety for multi-service architecture |
| 0.2 | **[NEW]** Add typed setting helpers to `database.ts`: `getSettingBool(key, default)`, `getSettingInt(key, default)`, `getSettingFloat(key, default)` | Every new service needs these; avoids scattered `parseInt()` calls |
| 0.3 | **[NEW]** Add settings key allowlist + type validation to `PUT /config` in `dashboard.ts` | Security prerequisite before adding 30+ new settings keys |
| 0.4 | **[NEW]** Create `electron/backend/types.ts` with shared interfaces (`GenerateResult`, `ToolDefinition`, `SecurityEvent`, `UserFact`, etc.) | All subsequent phases depend on shared types |
| 0.5 | **[NEW]** Sync version strings: root + dashboard `package.json`, remove hardcoded version in `Sidebar.tsx`, fix fallback in `dashboard.ts` routes | Three places currently diverge (1.7.0, 1.6.0, 1.6.0) |
| 0.6 | **[NEW]** Add iMessage reaction filter in `iMessageService.pollNewMessages()` — skip messages prefixed with "Liked", "Loved", "Laughed at", "Emphasized", "Questioned", "Disliked" | Prevents wasted API calls on tapback messages |

---

## Phase 1: Security Foundation (~3-4 days)

| # | Task | Files | Notes |
|---|------|-------|-------|
| 1.1 | Enforce `is_blocked` check in `handleIncomingMessage()` | `AgentService.ts` | One-line fix: query `users.is_blocked`, return if true |
| 1.2 | Create `RateLimiter.ts` — **sliding window** for per-user, fixed window for global | New `RateLimiter.ts`, `AgentService.ts` | **[CHANGED]** from fixed-window to sliding-window for per-user limits (avoids 2x burst at window boundaries) |
| 1.3 | Add budget circuit breaker in **AgentService** (not ClaudeService) | `AgentService.ts`, `database.ts` | **[CHANGED]** location — AgentService is the orchestrator, ClaudeService stays a dumb proxy |
| 1.4 | **[NEW]** Add per-message cost cap (max 6 API calls per message including tool iterations) | `AgentService.ts` | Prevents single tool-calling chain from consuming entire budget |
| 1.5 | Add `[SAFETY]` section to system prompt (hardcoded initially) | `ClaudeService.ts` | Externalized in Phase 2a |
| 1.6 | Create DB migrations 4-6: `security_events` (INTEGER PK AUTOINCREMENT), `tool_executions` (TEXT PK), ALTER `context` ADD COLUMN `source`/`last_used_at` | `database.ts` | **[CHANGED]** PK types: INTEGER for high-volume logs, TEXT for user-facing entities. Add idempotent checks before ALTER TABLE |
| 1.7 | Create `seedDefaultSettings()` — runs on every startup with `INSERT OR IGNORE` | `database.ts` | Called after `initializeDatabase()` in `server.ts` |
| 1.8 | Add `logSecurityEvent()` helper and wire to `logger.ts` with `tags` field | `logger.ts`, `database.ts` | Dual-write: in-memory buffer (SSE) + persistent `security_events` table |
| 1.9 | Create Security dashboard page + API routes | New `routes/security.ts`, new `dashboard/app/security/page.tsx`, `dashboard/lib/api.ts`, `hooks.ts` | |
| 1.10 | Add block/unblock to Users page (primary location) | `dashboard/app/users/page.tsx`, `dashboard/lib/api.ts` | Security page gets read-only blocked list with quick-unblock |

---

## Phase 2a: Prompt System + Response Processing (~4-5 days)

| # | Task | Files | Notes |
|---|------|-------|-------|
| 2.1 | Create `PromptBuilder.ts` — loads template from settings, injects dynamic variables | New `PromptBuilder.ts` | Variables: `{{date}}`, `{{contactName}}`, `{{userFacts}}`, `{{conversationSummary}}`, `{{enabledTools}}`, `{{chatType}}` |
| 2.2 | Restructure prompt into sections: `[IDENTITY]`, `[PERSONA]`, `[CAPABILITIES]`, `[CONSTRAINTS]`, `[CONTEXT USAGE]`, `[SAFETY]`, `[TOOL USAGE]` | `PromptBuilder.ts` | Store base template in settings table |
| 2.3 | Add iMessage-specific rules to `[CONSTRAINTS]` | `PromptBuilder.ts` | Max ~300 chars default, no markdown, 0-2 emoji, plain text only |
| 2.4 | Add contact name resolution with **phone number normalization** | `AgentService.ts`, `iMessageService.ts` | **[CHANGED]** — normalize to last-10-digits for contact lookup to handle format mismatches |
| 2.5 | Enable prompt caching — ensure static block exceeds **1,024 tokens** | `ClaudeService.ts` | **[CHANGED]** — include tool definitions in cached prefix to meet Anthropic's minimum token requirement |
| 2.6 | **[CHANGED]** Refactor `ClaudeService.generateResponse()` from positional args to options object | `ClaudeService.ts` | Current: `(userMessage, conversationHistory, systemPrompt?)`. New: options object with `systemBlocks[]`, `tools[]`. Return `GenerateResult` (rename `content` → `text`) |
| 2.7 | Add `cache_read_tokens` and `cache_creation_tokens` columns to `api_usage` with `DEFAULT 0` | `database.ts` | New migration. DEFAULT 0 so existing rows work without backfill |
| 2.8 | **[NEW]** Create `MessageFormatter.ts` — comprehensive response processing pipeline (see §Response Processing Pipeline below) | New `MessageFormatter.ts` | **CRITICAL**: Currently ZERO processing between Claude output and iMessage send |
| 2.9 | **[NEW]** Wire `MessageFormatter` into `AgentService.handleIncomingMessage()` — replace direct `sendMessage(response.content)` with full pipeline | `AgentService.ts` | Every response must pass through formatting before send |
| 2.10 | Create Agent dashboard page (prompt editor, behavior config, preview) | New `dashboard/app/agent/page.tsx`, new `routes/agent.ts` | |
| 2.11 | Update Dashboard home with budget progress widget | `dashboard/app/page.tsx` | |

---

## Phase 2b: Memory System (~3-4 days)

| # | Task | Files | Notes |
|---|------|-------|-------|
| 2.10 | Create `MemoryService.ts` with context table CRUD | New `MemoryService.ts` | `saveUserFact()`, `getUserFacts()`, `deleteExpiredFacts()`, `refreshFactTTL()` |
| 2.11 | Wire user fact injection into PromptBuilder `[USER FACTS]` section | `AgentService.ts`, `PromptBuilder.ts` | Before each API call, load active facts for user |
| 2.12 | **[CHANGED]** Implement fact extraction via **tool calling** — add `save_user_fact` tool definition, let Claude call it organically | `ToolRegistry.ts` (early creation), `ClaudeService.ts` | Avoids separate API call for fact extraction (was doubling costs) |
| 2.13 | Implement conversation summarization — trigger **asynchronously after response is sent** | `MemoryService.ts`, `AgentService.ts` | **[CHANGED]** — not in hot path. Also summarize on eviction |
| 2.14 | Add context importance filtering (skip filler: "ok", "k", "lol", "thanks", "👍") | `AgentService.ts` | Filter before sending to Claude. Always keep most recent 5 messages |
| 2.15 | Create `OutputSanitizer.ts` with **sentinel phrase detection** | New `OutputSanitizer.ts` | **[CHANGED]** — use set of static prompt markers, not "first 50 chars". Check for "My instructions say..." patterns |
| 2.16 | Create Memory dashboard page + API routes | New `dashboard/app/memory/page.tsx`, new `routes/memory.ts` | Facts table, summaries, purge button, export |
| 2.17 | Add Memory widget to Dashboard home ("X facts for Y users") | `dashboard/app/page.tsx` | |

---

## Phase 3: Tool Calling + Web Search (~6-7 days)

| # | Task | Files | Notes |
|---|------|-------|-------|
| 3.1 | Create `ToolRegistry.ts` — manages tool definitions + dispatch | New `ToolRegistry.ts` | Handles both custom tools AND Anthropic server-side tools |
| 3.2 | Add tool calling loop to ClaudeService with **cumulative token tracking per invocation** | `ClaudeService.ts` | **[NEW]** Track total tokens across multi-turn tool calls. Respect per-message cap from 1.4 |
| 3.3 | Implement `setReminder` tool with **future-time validation** | New `tools/setReminder.ts` | **[CHANGED]** — reject `scheduled_at` in the past, return error to Claude |
| 3.4 | Create `ReminderService.ts` — background checker every 30s | New `ReminderService.ts` | Sends due reminders via iMessage, marks delivered |
| 3.5 | Implement `createTrigger` tool with **simple schedule format** (not cron) | New `tools/createTrigger.ts` | **[CHANGED]** — use `{ interval, time, dayOfWeek? }` JSON, avoid `cron-parser` dependency |
| 3.6 | Create `TriggerService.ts` — background checker | New `TriggerService.ts` | |
| 3.7 | Implement `getUserFacts` and `searchHistory` tools | New `tools/getUserFacts.ts`, `tools/searchHistory.ts` | |
| 3.8 | **[NEW]** Enable Anthropic `web_search` server-side tool (see §Anthropic Server Tools below) | `ClaudeService.ts`, `ToolRegistry.ts` | No custom handler needed — Anthropic executes it server-side. Set `max_uses` + cost controls |
| 3.9 | **[NEW]** Enable Anthropic `web_fetch` server-side tool | `ClaudeService.ts`, `ToolRegistry.ts` | Set `max_content_tokens` limit to control token usage. Works with web_search results |
| 3.10 | **[NEW]** Add web search/fetch prompt instructions to `[TOOL USAGE]` section | `PromptBuilder.ts` | When to search web vs. local history, citation formatting rules for iMessage |
| 3.11 | **[NEW]** Add web search/fetch settings to dashboard (toggles, max_uses, budget allocation) | `dashboard/app/tools/page.tsx` | |
| 3.12 | Add group chat detection and awareness | `AgentService.ts`, `iMessageService.ts` | Detect from chatGuid format, add participant count method, cap at 5 names in context |
| 3.13 | Wire background services into `server.ts` startup AND `main.ts` suspend/resume/quit | `server.ts`, `main.ts` | Order: stop triggers → stop reminders → stop agent |
| 3.14 | Add Microsoft Spotlighting with per-session random delimiter | `PromptBuilder.ts`, `AgentService.ts` | Moved from Phase 1 — depends on PromptBuilder |
| 3.15 | Create Tools dashboard page + API routes | New `dashboard/app/tools/page.tsx`, new `routes/tools.ts` | Tool toggles (including web search/fetch), reminders CRUD, triggers CRUD, execution log |

---

## Phase 4: Polish & Optimization (~3-4 days)

| # | Task | Files | Notes |
|---|------|-------|-------|
| 4.1 | Implement adaptive polling (setTimeout chain replacing setInterval) | `iMessageService.ts` | Three tiers with configurable thresholds via settings |
| 4.2 | Add persona depth / SOUL.md-style config | `PromptBuilder.ts`, settings | |
| 4.3 | Fix usage page dynamic cost calculation (include web search token costs) | `dashboard/app/usage/page.tsx` | Use model pricing from backend, not hardcoded Haiku rates. Include server tool costs |
| 4.4 | Update Settings page with polling config, caching toggle | `dashboard/app/settings/page.tsx` | |
| 4.5 | **[NEW]** Reorganize Sidebar with grouped navigation sections | `dashboard/components/Sidebar.tsx` | 11 items → grouped into logical sections |
| 4.6 | **[NEW]** Add unit tests for RateLimiter, OutputSanitizer, PromptBuilder, MessageFormatter | New test files | Use Node's built-in `node:test` runner — no dependency needed |
| 4.7 | End-to-end testing of all new features (including web search → iMessage formatting) | | |
| 4.8 | Version bump to 2.0.0 across all files | `package.json` (both), `Sidebar.tsx`, `dashboard.ts` | |

---

## New Files Summary

### Backend Services (8)
| File | Purpose |
|------|---------|
| `electron/backend/services/PromptBuilder.ts` | Template loading + dynamic assembly |
| `electron/backend/services/MemoryService.ts` | Context table CRUD, summarization |
| `electron/backend/services/RateLimiter.ts` | Sliding-window per-user + fixed-window global |
| `electron/backend/services/OutputSanitizer.ts` | Response scanning before iMessage send |
| `electron/backend/services/ReminderService.ts` | Background due-reminder checker |
| `electron/backend/services/TriggerService.ts` | Background trigger executor |
| `electron/backend/services/ToolRegistry.ts` | Tool definitions + dispatch |
| `electron/backend/services/MessageFormatter.ts` | **[NEW]** Response processing pipeline — formatting, splitting, sanitization before iMessage send |

### Backend Tools (5 custom + 2 Anthropic server-side)
| File | Type | Purpose |
|------|------|---------|
| `electron/backend/tools/setReminder.ts` | Custom | Reminder creation with future-time validation |
| `electron/backend/tools/createTrigger.ts` | Custom | Trigger creation with simple schedule format |
| `electron/backend/tools/saveUserFact.ts` | Custom | Save user fact to context table |
| `electron/backend/tools/getUserFacts.ts` | Custom | Retrieve user's stored facts |
| `electron/backend/tools/searchHistory.ts` | Custom | Full-text search across messages table |
| *(Anthropic built-in)* `web_search` | Server-side | Web search — Anthropic executes, no custom handler |
| *(Anthropic built-in)* `web_fetch` | Server-side | Fetch full page content — Anthropic executes, no custom handler |

### Backend Routes (4)
| File | Purpose |
|------|---------|
| `electron/backend/routes/agent.ts` | Prompt CRUD, preview, behavior config |
| `electron/backend/routes/security.ts` | Security config, events, budget, blocking |
| `electron/backend/routes/memory.ts` | Facts CRUD, summaries, purge, export |
| `electron/backend/routes/tools.ts` | Tool config, reminders, triggers, execution log |

### Backend Types (1)
| File | Purpose |
|------|---------|
| `electron/backend/types.ts` | Shared TypeScript interfaces |

### Dashboard Pages (4)
| File | Purpose |
|------|---------|
| `dashboard/app/agent/page.tsx` | Persona, prompt editor, behavior settings |
| `dashboard/app/security/page.tsx` | Rate limits, budget, content safety, blocked users |
| `dashboard/app/memory/page.tsx` | Facts overview, summaries, stats, purge/export |
| `dashboard/app/tools/page.tsx` | Tool toggles, reminders, triggers, execution log |

### Dashboard Types (1)
| File | Purpose |
|------|---------|
| `dashboard/lib/types.ts` | Frontend TypeScript interfaces |

**Total: 23 new files** (22 original + 1 MessageFormatter)

---

---

## Response Processing Pipeline (NEW — Phase 2a, tasks 2.8-2.9)

**Problem:** Currently `AgentService.ts:188-190` sends raw Claude output directly to iMessage with ZERO processing. This is especially dangerous with web search/fetch returning URLs, citations, markdown, and long content.

### `MessageFormatter.ts` — Full Processing Pipeline

Every Claude response passes through these stages **in order** before reaching iMessage:

```
Claude API Response
  │
  ▼
┌─────────────────────────────────────────┐
│  Stage 1: SANITIZE (OutputSanitizer)    │
│  - Check for system prompt leaks        │
│  - Check for PII patterns               │
│  - Check for prompt injection echoing   │
│  - If flagged → replace with safe msg   │
│  - Log security event if triggered      │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  Stage 2: STRIP MARKDOWN                │
│  - Remove # ## ### headers              │
│  - Remove **bold** and *italic* markers │
│  - Remove ```code fences```             │
│  - Remove [link](url) → keep text only │
│    unless URL was explicitly requested  │
│  - Remove bullet markers (- * •) for    │
│    short lists, keep for 3+ items       │
│  - Remove horizontal rules (---)        │
│  - Preserve natural line breaks         │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  Stage 3: FORMAT CITATIONS              │
│  - Web search results may include       │
│    source URLs and titles               │
│  - Reformat as natural iMessage text:   │
│    "According to [Source Name]..."       │
│  - Optionally append source URL on a    │
│    new line (if setting enabled)         │
│  - Remove duplicate/redundant citations │
│  - Cap at 2 source references per msg   │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  Stage 4: CLEAN WHITESPACE              │
│  - Collapse 3+ consecutive newlines → 2 │
│  - Trim leading/trailing whitespace     │
│  - Remove invisible/zero-width chars    │
│  - Normalize unicode quotes → ASCII     │
│  - Normalize em/en dashes → hyphens     │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  Stage 5: ENFORCE LENGTH LIMITS         │
│  - If total length ≤ maxResponseChars   │
│    (default 500): send as single msg    │
│  - If total > maxResponseChars:         │
│    → proceed to Stage 6 (splitting)     │
│  - Hard cap: 2000 chars absolute max    │
│    (truncate with "..." if exceeded)    │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  Stage 6: MULTI-MESSAGE SPLITTING       │
│  - Split at natural boundaries:         │
│    1. Double newlines (paragraph break) │
│    2. Single newline after sentence end │
│    3. Sentence boundary (. ! ? + space) │
│    4. Hard split at 800 chars if none   │
│  - Max 3 chunks per response            │
│  - If still overflows: truncate last    │
│    chunk with "..."                     │
│  - Return array of message strings      │
└─────────────────┬───────────────────────┘
                  ▼
┌─────────────────────────────────────────┐
│  Stage 7: SEND                          │
│  - If single message: sendMessage()     │
│  - If multiple: sendMessages() with     │
│    configurable delay between each      │
│    (default 1.5s per chunk)             │
│  - Log each chunk sent                  │
└─────────────────────────────────────────┘
```

### MessageFormatter Interface

```typescript
interface FormatterOptions {
  maxResponseChars: number;      // default 500 (from settings)
  hardMaxChars: number;          // default 2000
  maxChunks: number;             // default 3
  chunkDelayMs: number;          // default 1500
  stripMarkdown: boolean;        // default true
  allowUrls: boolean;            // default false (true if user asked for links)
  maxCitations: number;          // default 2
  enableSplitting: boolean;      // default true (from settings)
}

interface FormatterResult {
  chunks: string[];              // 1-3 message chunks ready to send
  wasTruncated: boolean;         // true if content was cut
  wasSanitized: boolean;         // true if security filter triggered
  originalLength: number;        // length before processing
  processedLength: number;       // total length after processing
}

class MessageFormatter {
  format(rawResponse: string, options?: Partial<FormatterOptions>): FormatterResult;
}
```

### How AgentService Changes

**Current (BEFORE):**
```typescript
// AgentService.ts:188-190 — raw output, zero processing
if (response && response.content) {
  const sent = await iMessageService.sendMessage(chatGuid, response.content);
}
```

**New (AFTER):**
```typescript
if (response && response.text) {
  // Determine if user asked for URLs/links
  const userAskedForLinks = /\b(link|url|website|source|http)\b/i.test(message.text);

  // Run full processing pipeline
  const formatted = messageFormatter.format(response.text, {
    maxResponseChars: getSettingInt('agent.maxResponseChars', 500),
    allowUrls: userAskedForLinks,
    enableSplitting: getSettingBool('agent.multiMessageSplit', true),
    chunkDelayMs: getSettingFloat('agent.splitDelaySeconds', 1.5) * 1000,
  });

  // Security check
  if (formatted.wasSanitized) {
    logSecurityEvent('output_sanitized', userHandle, {
      originalLength: formatted.originalLength,
    }, 'medium');
  }

  // Send (single or multi-message)
  let sent: boolean;
  if (formatted.chunks.length === 1) {
    sent = await iMessageService.sendMessage(chatGuid, formatted.chunks[0]);
  } else {
    sent = await iMessageService.sendMessages(
      chatGuid,
      formatted.chunks,
      formatted.chunkDelayMs
    );
  }
}
```

### Web Search Response Formatting Examples

**Claude returns (raw, from web search):**
```
Based on my search, here are the latest results:

## Weather in Austin, TX

According to [Weather.com](https://weather.com/austin), it's currently **78°F** with 
partly cloudy skies. The forecast for today:

- **High**: 85°F
- **Low**: 62°F  
- **Humidity**: 45%

[Source: Weather.com](https://weather.com/austin)
[Source: AccuWeather](https://accuweather.com/austin)
```

**After MessageFormatter (sent to iMessage):**
```
According to Weather.com, it's currently 78°F in Austin with partly cloudy skies.

Today's forecast: High 85°F, Low 62°F, Humidity 45%.
```

**What happened:**
- ✅ Stripped `##` header
- ✅ Stripped `**bold**` markers
- ✅ Stripped `[link](url)` → kept text "Weather.com"
- ✅ Collapsed bullet list into prose (≤3 items)
- ✅ Removed duplicate source citations (capped at 2, then reformatted)
- ✅ Removed markdown horizontal rules
- ✅ Result is clean iMessage text, under 500 chars

**If user said "What's the weather? Send me a link":**
```
According to Weather.com, it's currently 78°F in Austin with partly cloudy skies.

Today's forecast: High 85°F, Low 62°F, Humidity 45%.

weather.com/austin
```
- ✅ URL preserved because user asked for a link

---

## Anthropic Server-Side Tools (NEW — Phase 3, tasks 3.8-3.11)

### How Server-Side Tools Work

Unlike custom tools (where YOUR code executes the tool), Anthropic's server-side tools are **executed by Anthropic's servers**. You only need to:

1. **Declare them** in the API request
2. **Set limits** (max_uses, max_content_tokens)
3. **Process the final text response** (which already incorporates search/fetch results)

### ClaudeService Integration

```typescript
// In ClaudeService.generateResponse():
const tools = [];

// Custom tools (from ToolRegistry)
tools.push(...toolRegistry.getEnabledToolDefinitions());

// Anthropic server-side tools (if enabled in settings)
if (getSettingBool('tools.webSearch', true)) {
  tools.push({
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: getSettingInt('tools.webSearchMaxUses', 3),  // Max searches per message
  });
}

if (getSettingBool('tools.webFetch', false)) {  // Off by default (expensive)
  tools.push({
    type: 'web_fetch_20250305',
    name: 'web_fetch',
    max_content_tokens: getSettingInt('tools.webFetchMaxTokens', 5000),
  });
}
```

### Cost Implications

| Tool | Cost Impact | Default | Control |
|------|-------------|---------|--------|
| `web_search` | Extra input tokens for search results injected into context | Enabled, max 3 uses/msg | `tools.webSearch`, `tools.webSearchMaxUses` |
| `web_fetch` | Can be VERY expensive — full page content as tokens | **Disabled by default** | `tools.webFetch`, `tools.webFetchMaxTokens` |

**Budget interaction:** Web search/fetch token costs count toward the daily budget circuit breaker. The per-message cost cap (max 6 API calls) also applies — web search is one of those 6 iterations.

### Prompt Instructions for Web Search

Added to `[TOOL USAGE]` section in PromptBuilder:

```
Web Search:
- Use web_search when the user asks about current events, weather, news, prices,
  or anything that requires up-to-date information beyond your training data.
- Do NOT search for things you already know well (basic facts, math, definitions).
- When presenting search results to the user:
  - Summarize findings naturally — don't list raw search results
  - Mention the source by name ("According to Weather.com...") but don't include URLs
    unless the user specifically asks for a link
  - Keep the same concise iMessage style — don't write a research paper
  - If search results conflict, mention the discrepancy briefly
  - Max 2 source references per response

Web Fetch:
- Only use web_fetch if the user provides a specific URL they want summarized,
  or if a search result needs deeper reading to answer the question.
- Do NOT fetch pages speculatively or multiple pages per question.
- Summarize fetched content concisely — don't dump raw page text.
```

### New Settings Keys for Web Tools

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `tools.webSearch` | boolean | true | Enable web search tool |
| `tools.webSearchMaxUses` | number | 3 | Max search calls per message |
| `tools.webFetch` | boolean | false | Enable web fetch tool (expensive, off by default) |
| `tools.webFetchMaxTokens` | number | 5000 | Max tokens per page fetch |

---

## Updated Tool List (7 total)

| # | Tool | Type | Default | Purpose |
|---|------|------|---------|--------|
| 1 | `setReminder` | Custom | On | One-time reminder |
| 2 | `createTrigger` | Custom | On | Recurring scheduled action |
| 3 | `saveUserFact` | Custom | On | Store persistent user fact |
| 4 | `getUserFacts` | Custom | On | Retrieve stored facts |
| 5 | `searchHistory` | Custom | On | Full-text search local messages |
| 6 | `web_search` | Anthropic server-side | **On** | Search the internet |
| 7 | `web_fetch` | Anthropic server-side | **Off** | Fetch full page content |

All configurable on/off via Tools dashboard page.

---

## Key Differences from Original Plan

| Area | Original | Revised | Why |
|------|----------|---------|-----|
| WAL mode | "Already enabled" | Must be explicitly enabled | `better-sqlite3` doesn't enable by default |
| Prompt cache | Just add `cache_control` | Must ensure 1,024+ token minimum | Anthropic silently ignores under-minimum blocks |
| Budget check | In ClaudeService | In AgentService | Separation of concerns |
| Rate limiter | Fixed window | Sliding window (per-user) | Prevents 2x burst at window boundaries |
| Fact extraction | Separate API call | Via tool calling | Avoids doubling API costs |
| Summarization | In hot path (before response) | Async (after response) | Avoids 1-3s user-facing latency |
| Output sanitizer | "First 50 chars" comparison | Sentinel phrase detection | Catches rephrased leaks |
| Trigger schedules | cron-parser dependency | Simple JSON format | Simpler, no new dependency |
| ClaudeService refactor | Documented wrong signature | Corrected: positional → options | Actual current signature differs from docs |
| Per-message cost cap | Not mentioned | Max 6 API calls per message | Prevents tool-loop budget drain |
| Phase 2 | Single 13-item phase | Split into 2a (Prompt) + 2b (Memory) | More manageable milestones |
| **Response processing** | **Not mentioned** | **Full 7-stage MessageFormatter pipeline** | **Currently ZERO processing — raw Claude → iMessage** |
| **Web search** | **Not mentioned** | **Anthropic web_search + web_fetch** | **Built-in Anthropic tools, no custom backend needed** |
| **Web fetch** | **Not mentioned** | **Disabled by default, expensive** | **Full page fetch can blow through token budget** |

---

## Estimated Timeline

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Pre-Phase: Foundations | 1 day | 1 day |
| Phase 1: Security | 3-4 days | 4-5 days |
| Phase 2a: Prompt + Response Processing | 4-5 days | 8-10 days |
| Phase 2b: Memory System | 3-4 days | 11-14 days |
| Phase 3: Tool Calling + Web Search | 6-7 days | 17-21 days |
| Phase 4: Polish | 3-4 days | 20-25 days |
| **Total** | **~5 weeks** | |
