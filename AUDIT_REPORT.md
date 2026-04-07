# TextMyAgent Desktop — Codebase Audit Report

**Date:** 2025-07-15  
**Scope:** Full codebase audit covering architecture, security, bugs, code quality, performance, completeness, and testing.

---

## Executive Summary

TextMyAgent is a well-structured Electron + Next.js application that provides an AI-powered iMessage agent on macOS. The codebase demonstrates strong architectural patterns (migration system, service singletons, prompt caching, adaptive polling, rate limiting) and a comprehensive dashboard. However, the audit identified **1 critical bug**, **4 high-severity issues**, and several medium/low findings that should be addressed before production use.

---

## Critical Findings

### C1. Reminders & Triggers Schema Mismatch (CRITICAL)

**Files:**
- `electron/backend/database.ts` — Migration v1 (lines 122-130) and v2 (lines 162-178)
- `electron/backend/tools/setReminder.ts` (lines 44-54)
- `electron/backend/tools/createTrigger.ts` (lines 43-55)
- `electron/backend/services/ReminderService.ts` (lines 33-43)
- `electron/backend/services/TriggerService.ts` (lines 40-52)

**Problem:** The `reminders` table is defined with **incompatible schemas** in 3 places:

| Location | Columns |
|---|---|
| Migration v1 | `id, user_id, message, scheduled_at, delivered` |
| setReminder.ts + ReminderService.ts | `id, user_id, chat_guid, message, due_at, is_sent` |

Similarly, `triggers` has incompatible schemas:

| Location | Columns |
|---|---|
| Migration v2 | `id, user_id, name, schedule, action, is_active, last_run_at, next_run_at` |
| createTrigger.ts + TriggerService.ts | `id, user_id, chat_guid, name, message, schedule, is_active, last_fired_at` |

All use `CREATE TABLE IF NOT EXISTS`, so whichever runs first wins. Since migrations run at database initialization (before tools are registered), the migration schema takes effect. The tool and service code then tries to INSERT/SELECT columns that don't exist (`chat_guid`, `due_at`, `is_sent` for reminders; `chat_guid`, `message`, `last_fired_at` for triggers), causing **runtime SQLite errors** whenever a reminder or trigger is created.

**Fix:** Update migrations v1 and v2 to match the schemas used by the tools/services, or add a new migration that ALTERs the tables. Remove duplicate `CREATE TABLE IF NOT EXISTS` from tool and service files.

---

## High-Severity Findings

### H1. Budget Circuit Breaker Uses Wrong Pricing

**File:** `electron/backend/services/AgentService.ts` (lines 438-440)

```typescript
// Approximate cost calculation for Claude 3.5 Haiku
// Input: $1.00 / 1M tokens, Output: $5.00 / 1M tokens
const costCents = (inputTokens / 1_000_000) * 100 + (outputTokens / 1_000_000) * 500;
```

**Problem:** The budget check hardcodes Haiku pricing ($0.80 input / $4.00 output per 1M tokens) but the user can switch to Sonnet 3.5 or Sonnet 4 ($3.00 / $15.00 per 1M). When using Sonnet, actual cost is ~3.75x higher than what the circuit breaker calculates, allowing the budget to be exceeded significantly before triggering.

**Fix:** Read the current model from settings and use the same `MODEL_PRICING` map defined in `dashboard/app/usage/page.tsx`, or move pricing to a shared module.

### H2. Rate Limit Violations Not Logged to Security Events

**File:** `electron/backend/services/AgentService.ts` (lines 130-134)

**Problem:** When a message is rate-limited, only `log('warn', ...)` is called — not `logSecurityEvent()`. Rate limit violations don't appear in the Security Events dashboard, making it impossible for operators to detect abuse patterns.

**Fix:** Add `logSecurityEvent('rate_limit_exceeded', userHandle, { reason: rateCheck.reason }, 'medium')` when rate limiting triggers.

### H3. RateLimiter Memory Leak — cleanup() Never Called

**File:** `electron/backend/services/RateLimiter.ts` (lines 124-136)

**Problem:** `RateLimiter.cleanup()` exists to evict stale per-user entries but is never called from anywhere. The `perUserWindows` Map grows unbounded as new users message the agent. Over time, this leaks memory proportional to the number of unique users.

**Fix:** Set up a periodic interval (e.g., every 5 minutes) in `server.ts` to call `rateLimiter.cleanup()`.

### H4. PermissionService URL Allowlist Inconsistent

**Files:**
- `electron/backend/services/PermissionService.ts` (line 246-248) — allows only `x-apple.systempreferences:`
- `electron/backend/routes/dashboard.ts` (line 11-13) — allows `x-apple.systempreferences:` AND `https://console.anthropic.com/`

**Problem:** The dashboard route's `/settings/open` endpoint uses a separate `ALLOWED_SETTINGS_PREFIXES` array that includes `https://console.anthropic.com/`, but `PermissionService.openSystemSettings()` has its own stricter allowlist. If the dashboard tries to open Anthropic's console URL via the permission service, it will be silently blocked.

**Fix:** Consolidate to a single shared allowlist, or ensure the dashboard route calls `shell.openExternal()` directly for non-system-settings URLs.

---

## Medium-Severity Findings

### M1. No CSRF Protection on Backend API

**File:** `electron/backend/server.ts`

The Express API has CORS configured to allow `localhost` and `127.0.0.1`, but any local process can make requests to `http://127.0.0.1:3001/api/dashboard/*` including starting/stopping the agent, changing settings, and unblocking users. There are no CSRF tokens, authentication, or request signing.

**Impact:** Low in practice since this is a desktop app, but a malicious local process could manipulate the agent.

### M2. Conversation History Misattribution

**File:** `electron/backend/services/AgentService.ts` (lines 177-185)

When loading iMessage history for a new conversation, messages with `isFromMe = true` are mapped to `role: 'assistant'`. However, the Mac user may have manually sent those messages (not the AI). This could cause the AI to "claim" responses it didn't write, leading to confused or contradictory behavior.

### M3. PII Detection False Positives

**File:** `electron/backend/services/MessageFormatter.ts` (lines 45-49)

The SSN pattern (`\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b`) can match phone numbers (e.g., "555-12-3456"), zip+4 codes, and other numeric sequences. The email pattern flags any email in AI output, which would incorrectly redact legitimate responses like "You can reach them at support@example.com."

### M4. MemoryService.expireOldFacts() Never Auto-Runs

**File:** `electron/backend/services/MemoryService.ts` (line 133)

The method to expire old facts has a comment "Call periodically (e.g., daily)" but nothing schedules it. Facts only expire when a user manually clicks "Expire Old Facts" in the dashboard. Stale facts accumulate indefinitely.

### M5. Conversation Summarization Not Implemented

**Files:** `electron/backend/services/MemoryService.ts`, `electron/backend/services/PromptBuilder.ts`, `electron/backend/services/AgentService.ts`

The infrastructure for conversation summaries exists (database table, MemoryService CRUD, PromptBuilder section, settings toggle), but no code ever generates summaries. The `memory.enableSummarization` setting has no effect.

### M6. web_fetch Tool Mentioned But Not Implemented

**Files:** `electron/backend/services/PromptBuilder.ts` (DEFAULT_TOOL_USAGE), `electron/backend/database.ts` (seedDefaultSettings)

The system prompt instructs the AI about `web_fetch` usage, and settings keys `tools.webFetch` and `tools.webFetchMaxTokens` are seeded, but no web_fetch tool is registered in the ToolRegistry. The AI may attempt to use a tool that doesn't exist.

---

## Low-Severity Findings

### L1. Dashboard Tools Page Doesn't Use SWR

**File:** `dashboard/app/tools/page.tsx`

Unlike every other dashboard page that uses SWR hooks (auto-revalidation, caching, error retry), the Tools page manually manages state with `useState` + `useEffect`. This means it doesn't benefit from SWR's background refresh, cache deduplication, or error retry logic.

### L2. Circular Dependency: logger → database

**File:** `electron/backend/logger.ts` (line 109)

`logSecurityEvent()` uses `require('./database')` (CommonJS dynamic import) to break a circular dependency. This works but is fragile and bypasses TypeScript type checking at the import site.

### L3. Singleton Pattern Inconsistency

Most services use module-level `export const instance = new Service()` (AgentService, ClaudeService, MemoryService, etc.), but `PermissionService` uses a classical `getInstance()` singleton. Pick one pattern for consistency.

### L4. Mixed Naming Conventions in API Types

**File:** `dashboard/lib/api.ts`

`Reminder` and `Trigger` interfaces use snake_case (`due_at`, `is_sent`, `chat_guid`, `last_fired_at`), while `UserFact`, `ToolExecution`, and others use camelCase (`lastUsedAt`, `createdAt`, `durationMs`). The backend routes return a mix of both.

### L5. LogBuffer Query Performance

**File:** `electron/backend/logger.ts` (lines 28-56)

`LogBuffer.query()` builds a full ordered copy of the circular buffer on every call, then filters. With the 500-entry cap this is negligible, but the algorithm is O(n) per query regardless of the filter.

### L6. Dashboard Error Handling Uses `alert()`

**Files:** `dashboard/app/memory/page.tsx` (line 66), `dashboard/app/settings/page.tsx` (line 156)

Using `alert()` for error display blocks the UI thread and provides poor UX. Should use toast notifications or inline error messages.

### L7. Contact Name Resolution Doesn't Use Contacts API

**File:** `electron/backend/services/AgentService.ts` (lines 464-487)

`normalizeContactName()` only formats phone numbers into `(XXX) XXX-XXXX` format. Despite having Contacts permission checks and `node-mac-contacts` as a dependency, the actual contact names are never looked up. The AI always sees formatted phone numbers, not real names.

---

## Testing Gaps

### Current Coverage

| Service | Test File | Status |
|---|---|---|
| MessageFormatter | ✅ `__tests__/MessageFormatter.test.ts` | 191 lines, 22 test cases |
| PromptBuilder | ✅ `__tests__/PromptBuilder.test.ts` | 178 lines, 15 test cases |
| RateLimiter | ✅ `__tests__/RateLimiter.test.ts` | 130 lines, 10 test cases |
| AgentService | ❌ No tests | — |
| ClaudeService | ❌ No tests | — |
| ToolRegistry | ❌ No tests | — |
| MemoryService | ❌ No tests | — |
| iMessageService | ❌ No tests | — |
| ReminderService | ❌ No tests | — |
| TriggerService | ❌ No tests | — |
| Dashboard components | ❌ No tests | — |

### Recommended Test Additions (Priority Order)

1. **AgentService** — mock iMessageService + claudeService, test message flow, dedup, queue, budget check
2. **ToolRegistry** — test registration, dispatch, settings toggle, execution logging
3. **MemoryService** — test CRUD, dedup, max facts eviction, TTL expiration
4. **ClaudeService** — test agentic loop, tool call handling, error recovery
5. **Dashboard integration** — Playwright or React Testing Library for critical flows

---

## Architecture Notes (Positive)

These patterns are well-implemented and should be preserved:

- **Migration system** (`database.ts`) — versioned, transactional, idempotent
- **Adaptive polling** (`iMessageService.ts`) — reads intervals from settings, adjusts dynamically
- **Prompt caching** (`PromptBuilder.buildWithCacheControl`) — properly separates static/dynamic sections
- **Microsoft Spotlighting** (`PromptBuilder`) — per-session random delimiters against prompt injection
- **Per-chat concurrency locks** (`AgentService`) — prevents race conditions with message queue fallback
- **Conversation TTL eviction** (`AgentService.evictStaleConversations`) — prevents memory leaks
- **Secure storage** (`secure-storage.ts`) — uses macOS Keychain via `safeStorage`, in-memory cache, file permissions
- **IPC listener cleanup** (`preload.ts`) — returns cleanup functions to prevent listener stacking
- **Settings seed system** (`seedDefaultSettings`) — `INSERT OR IGNORE` ensures defaults without overwriting user changes
- **Output sanitization pipeline** (`MessageFormatter`) — 7-stage pipeline with system prompt leak detection

---

## Recommended Fix Priority

| Priority | Finding | Effort |
|---|---|---|
| **P0** | C1 — Schema mismatch (reminders & triggers broken) | Medium |
| **P1** | H1 — Budget uses wrong pricing | Small |
| **P1** | H2 — Rate limits not in security events | Small |
| **P1** | H3 — RateLimiter cleanup never called | Small |
| **P2** | H4 — URL allowlist inconsistency | Small |
| **P2** | M2 — History misattribution | Medium |
| **P2** | M4 — Auto-expire facts | Small |
| **P2** | M6 — Remove web_fetch references or implement | Small |
| **P3** | M1 — CSRF protection | Medium |
| **P3** | M3 — PII false positives | Medium |
| **P3** | M5 — Conversation summarization | Large |
| **P3** | L1–L7 — Code quality items | Small each |
| **P4** | Testing gaps | Large |
