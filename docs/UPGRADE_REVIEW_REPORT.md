# TextMyAgent Upgrade Documents — Deep Review Report

> Every claim verified against actual source code and external documentation
> Covers: Factual errors, contradictions, gaps, edge cases, and a revised plan

---

## 1. Factual Errors (Claims vs. Actual Code)

### F1 — ClaudeService return type is WRONG in Impact Analysis
**Claim:** "Returns `string`"
**Actual (`ClaudeService.ts`):** Returns `Promise<ClaudeResponse | null>` with `{ content, inputTokens, outputTokens, stopReason }`.
**Impact:** Migration is `ClaudeResponse` → `GenerateResult`, not `string` → `GenerateResult`. Less disruptive than described. Token extraction already exists. **Severity: MEDIUM**

### F2 — ClaudeService signature is WRONG in Impact Analysis
**Claim:** `generateResponse(messages, systemPrompt?, model?, temperature?, maxTokens?)`
**Actual:** `generateResponse(userMessage: string, conversationHistory: Message[], systemPrompt?: string)` — separate params, no model/temp/maxTokens args (those use class methods).
**Impact:** Implementers following the doc would write incorrect migration code. **Severity: HIGH**

### F3 — Audit line numbers for system prompt are wrong
**Claim:** `ClaudeService.ts:84-92`. **Actual:** Lines 10-16. **Severity: LOW**

### F4 — iMessageService quality under-documented
The docs don't acknowledge existing safeguards: concurrent poll guard, GUID dedup, batch ROWID persistence, BER variable-length parsing. Gives misleading impression of code quality. **Severity: LOW**

### F5 — Agent auto-start location
Auto-start is inside `server.ts:122-132` (Express listen callback), not directly in Electron lifecycle. Correct conceptually but misrepresented. **Severity: LOW**

### F7 — Version mismatch is worse than documented
Root=1.7.0, dashboard=1.6.0 (documented), PLUS Sidebar.tsx:90 hardcodes "v1.6.0" and dashboard.ts:37,96 fallback to '1.6.0'. Three places need updates, docs mention two. **Severity: LOW**

---

## 2. Internal Contradictions Between Documents

### C1 — Migration numbering conflict
Upgrade Plan: Migration 4 = "no new tables" (settings only). Impact Analysis: Migration 4 = `tool_executions` table. Off by one.
**Fix:** Drop Upgrade Plan's Migration 4. Use Impact Analysis ordering.

### C2 — security_events.id type conflict
Upgrade Plan: `INTEGER PRIMARY KEY AUTOINCREMENT`. Impact Analysis implies `TEXT PRIMARY KEY`.
**Fix:** Use `INTEGER AUTOINCREMENT` for high-volume append-only logs (like existing `api_usage`).

### C3 — Budget check location conflict
Upgrade Plan: Inside `ClaudeService`. Impact Analysis: Inside `AgentService`.
**Fix:** AgentService is correct — it's the orchestrator. ClaudeService should stay a dumb proxy.

### C4 — Rate limiter single-window approach has burst edge case
Fixed-window allows 2x burst at window boundaries. **Fix:** Use sliding window for per-user limits.

### C5 — Adaptive polling tier boundaries
Upgrade Plan uses fixed numbers. Impact Analysis uses configurable settings with multiplicative derivation. **Fix:** Use explicit settings for each tier boundary.

### C6 — Blocked users management in 2-3 places
**Fix:** Primary on Users page, read-only list on Security page.

---

## 3. Technical Gaps (Critical)

### G1 — WAL mode NOT enabled (CRITICAL)
**Claim (§4.6):** "Already enabled in database.ts" — **FALSE**. `better-sqlite3` does NOT enable WAL by default. Without it, concurrent read/write from multiple services will cause `SQLITE_BUSY` errors.
**Fix:** Add `db.pragma('journal_mode = WAL')` after opening database.

### G2 — Prompt caching minimum token requirement
Anthropic requires **minimum 1,024 tokens** for Haiku cache. Current prompt is ~110 tokens. Even expanded prompt may not meet minimum. Cache will silently do nothing.
**Fix:** Include tool definitions in cached block, or ensure static block exceeds 1,024 tokens.

### G3 — Tool calling loop has no per-message cost cap
5 iterations = 6 API calls per message. Budget only checks daily totals.
**Fix:** Add per-message cumulative cost tracking + cap.

### G4 — Fact extraction via separate Claude call doubles API cost
**Fix:** Use tool calling (`save_user_fact`) instead — zero extra API calls.

### G5 — Summarization in hot path adds 1-3s latency
**Fix:** Summarize asynchronously after response, or on eviction.

### G6 — OutputSanitizer "first 50 chars" comparison is brittle
**Fix:** Use sentinel phrase set from static prompt sections.

### G7 — No migration rollback / idempotency checks
**Fix:** Check column existence before ALTER TABLE.

### G9 — No DEFAULT for new api_usage columns
**Fix:** Use `DEFAULT 0` so existing rows work.

### G10 — Spotlighting delimiter details missing
**Fix:** Per-session token, documented in system prompt `[SAFETY]` section.

---

## 4. Edge Cases Not Addressed

| # | Edge Case | Fix |
|---|-----------|-----|
| E1 | Race condition: two chats pass budget check simultaneously | Use mutex or accept soft-limit overshoot |
| E2 | System sleep during tool execution | Retry-once for in-flight API calls after resume |
| E3 | Reminder scheduled in the past | Validate `scheduled_at > now` in tool handler |
| E4 | International phone number format mismatch | Normalize to last-10-digits for contact lookup |
| E5 | Group chat with 50+ participants | Cap participant list in context |
| E6 | Settings table accepts arbitrary keys | Implement key allowlist before adding 30+ keys |
| E7 | MemoryService closure captures stale ClaudeService | Use late binding in callback |
| E8 | SSE stream leaks security event details | Add auth or strip sensitive metadata |

---

## 5. Architectural & Dependency Notes

- **A1:** 7+ services need start/stop ordering → consider a `ServiceManager` class
- **A2:** Don't add all CRUD to `database.ts` — let each service own its queries
- **A3:** ~4,900 new lines on ~3,500 existing = 140% growth; split Phase 2 into 2a/2b
- **D1:** `cron-parser` unnecessary initially — use simple JSON schedule format
- **D3:** `crypto.randomUUID()` is built-in, no `uuid` package needed
- **SQL4:** Foreign keys are not enforced — `PRAGMA foreign_keys` never set

---

## 6. API & Web Research Findings

- **Prompt caching:** Correct syntax, but 1,024-token minimum for Haiku. Cache writes cost 25% MORE than regular input. Plan doesn't mention this.
- **Tool calling:** Format correct. Missing `tool_choice` parameter discussion.
- **better-sqlite3:** Synchronous single-threaded — "concurrent" writes are sequential on event loop. WAL helps reads not block writes.
- **Token fields:** Anthropic uses `cache_read_input_tokens` / `cache_creation_input_tokens` — map correctly.

---

## 7. What the Documents Get Right

- Circular dependency callback pattern (§4.1)
- Service initialization order (§4.2)
- Tool error propagation via `is_error: true` (§4.4)
- Settings read consistency analysis (§4.3)
- `is_blocked` as one-line critical fix
- "Files That Need NO Changes" list is accurate
- Missing Items section (§8) catches real issues
- The Architecture Audit is more accurate than both upgrade docs

---

## 8. Dashboard Frontend Gaps

- **FE2:** 11 sidebar items is crowded → use grouped navigation
- **FE4:** `useUsers` hook missing `RETRY_OPTS`
- **FE5:** Usage page hardcodes Haiku pricing, not included in any phase

---

## Summary

| Category | Count | Critical |
|----------|:-----:|:--------:|
| Factual errors | 7 | 2 |
| Internal contradictions | 6 | 1 |
| Technical gaps | 10 | 2 |
| Edge cases missed | 8 | 1 |
| Other (arch/deps/frontend) | 19 | 0 |
| **Total** | **50** | **7** |

**Top 7 Critical Findings:**
1. WAL mode not enabled — will cause SQLITE_BUSY under load (G1)
2. Prompt caching 1,024-token minimum not met (G2)
3. ClaudeService signature documented incorrectly (F2)
4. ClaudeService return type documented incorrectly (F1)
5. Budget check in wrong service (C3)
6. Fact extraction doubles API cost (G4)
7. Tool loop has no per-message cost cap (G3)
