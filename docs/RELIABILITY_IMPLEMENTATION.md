# Reliability Implementation Plan

**Target versions:** v2.4.1 (Phase 0) → v2.5.0 (Phase 1) → v2.6.0 (Phase 2)
**Owner:** Cascade + USER
**Status:** Phase 0 shipped in v2.5.0 (rolled into scale release); Phase 1 partially done (fact extraction on eviction landed via SCALE Phase 2C)
**Created:** 2026-04-17
**Last updated:** 2026-04-17

## Completion tracker

| Task | Status | Shipped |
|------|--------|---------|
| P0.1 — Remove reactions feature | ✅ | v2.5.0 |
| P0.2 — Fix `set_reminder` INSERT (`scheduled_at` NOT NULL) | ✅ | v2.5.0 |
| P0.3 — Sanitize-only regex (kill raw execute path) | ✅ | v2.5.0 |
| P0.4 — File logging via `electron-log` | ✅ | v2.5.0 |
| P1 §4.1 — Migration v9 (memory_events, agent_events) | ⏸ deferred |
| P1 §4.2 — Dedicated ephemeral `LlamaContext` | ⏸ deferred |
| P1 §4.3 — `FactExtractor` service (per-message) | 🟡 partial — fact extraction lands on session eviction via SCALE P2C, not per-message |
| P1 §4.4 — Sleep-time integration | ⏸ deferred (handled on eviction instead) |
| P1 §4.5 — Unified default prompts (`defaultPrompts.ts`) | ⏸ deferred |

---

## 1. Problem Statement

Yesterday's 300-message, 11-hour trial on v2.4.0 surfaced six classes of failures:

| # | Class | Evidence |
|---|---|---|
| 1 | Tool-call syntax leaked as plain text to iMessage | 8+ observed leaks: `wait(reason: "goodbye")`, `react_to_message(params: {reaction: "like"})`, `<\|tool_call>call: save_user_fact(...)<tool_call\|>` |
| 2 | `set_reminder` tool throws `NOT NULL constraint failed: reminders.scheduled_at` on every call | 1/1 failure rate; agent then hallucinates success to user |
| 3 | Zero AI-extracted facts saved despite rich personal disclosures | `user_facts` table: 2 rows, both from macOS Contacts import |
| 4 | Zero conversation summaries created | `conversation_summaries`: 0 rows |
| 5 | Persona name and format rules drift mid-conversation | "Grace" → "Melody"; emoji bans ignored repeatedly |
| 6 | No file logs — forensics only possible via SQLite | `~/Library/Logs/textmyagent-desktop/` is empty |

## 2. Root Causes (verified)

1. **Regex scrub misses bare tool-call forms.** `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/MessageFormatter.ts` handles `<|tool_call>` blocks but not `name(key: "value")` lines that Gemma 4 emits when its native function-calling path breaks.
2. **`setReminder` INSERT omits `scheduled_at`** which is declared `NOT NULL` in migration v7. `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/tools/setReminder.ts:45-51`.
3. **Fact extraction depends on the 4B agent model volunteering `save_user_fact` tool calls.** It doesn't. Gemma 4 is known weak at agentic tool use ([r/LocalLLaMA](https://www.reddit.com/r/LocalLLaMA/comments/1sh1bwv/gemma_4_is_terrible_with_system_prompts_and_tools/)).
4. **Summarization requires an unused `context.getSequence()` slot**, but the context is sized `sequences = maxPooledSessions`. When 2 chats are active, zero spare sequences exist, and the summary call fails silently (errors swallowed at `AgentService.ts:137`).
5. **System prompt is ~1000 tokens of tagged sections** (`[IDENTITY]`, `[PERSONA]`, ...) plus a 3-way decision tree (RESPOND/REACT/WAIT) that confuses a 4B model. Gemma doesn't have a real system role — everything is dumped into user turn 1 ([Gemma docs](https://ai.google.dev/gemma/docs/core/prompt-structure)).
6. **No file-transport logger** wired to `electron-log`. Only in-memory logs + SQLite error rows.
7. **Two divergent default-prompt sources**: `PromptBuilder.ts` constants vs `database.ts seedDefaultSettings()`. Users get the DB version; devs read the code version.

## 3. Phase 0 — Hotfix (v2.4.1)

**Ship target:** today. **LOC:** ~120. **Risk:** low.

### Goals
- Stop user-visible tool-call text leaks
- Fix `set_reminder` failure
- Remove the half-working reactions feature
- Wire file logging so Phase 1 is observable

### Task list

- [ ] **P0.1 — Remove reactions feature**
  - Delete `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/tools/reactToMessage.ts`
  - Edit `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/tools/index.ts` — remove import and `registerCustomTool(reactToMessageDefinition, ...)` line
  - Edit `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/ToolRegistry.ts` — remove `react_to_message: 'tools.reactions'` from setting-key map
  - Edit `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/PromptBuilder.ts` — strip all `REACT`, `react_to_message`, `tapback` lines from default sections (lines ~46-68)
  - Edit `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/tools/waitTool.ts` — remove "pair with react_to_message" language from tool description
  - Edit `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/database.ts:535` — remove `'tools.reactions': JSON.stringify(true)` seed line
  - Edit `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/routes/dashboard.ts:145` — remove `'tools.reactions'` from allowed keys
  - Edit `@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/settings/page.tsx` — remove reactions toggle row
  - **Keep:** the inbound tapback-filter logic in `iMessageService.ts:43,224` (different concern — we still need to skip incoming reactions)
  - Update tests: `BehaviorSimulation.test.ts`, `AdvancedBehavior.test.ts`, `ToolSimulation.test.ts`, `ToolCallStripping.test.ts` — remove reaction-related assertions
  - Migration: none needed; the `tools.reactions` row in existing users' DBs becomes harmless dead data

- [ ] **P0.2 — Fix `set_reminder` INSERT**
  - Edit `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/tools/setReminder.ts` INSERT statement to include both columns:
    ```sql
    INSERT INTO reminders (id, user_id, message, due_at, scheduled_at, chat_guid)
    VALUES (?, ?, ?, ?, ?, ?)
    ```
    with `dueAt.toISOString()` bound to both `due_at` and `scheduled_at`.
  - Add test file `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/__tests__/SetReminder.test.ts` covering: valid insert (both columns populated), past date rejected, >1 year rejected, missing message rejected, `ReminderService.getUpcomingReminders()` still returns the row.

- [ ] **P0.3 — Sanitize-only regex (remove raw execute path)**
  - Edit `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/LocalLLMService.ts` `stripAndExecuteRawToolCalls` method:
    - Rename to `sanitizeToolCallArtifacts`
    - Remove all `toolRegistry.dispatchToolCall` lines (the "execute" half)
    - Keep only the text-stripping half
    - Expand patterns to cover bare `\b(wait|save_user_fact|get_user_facts|search_history|set_reminder|create_trigger)\s*\(\s*\w+\s*[:=]\s*[^\n]*\)` when matched at line start (`^` with `gm` flag)
    - Match `<|tool_call>...<tool_call|>` end-tag artifacts (existing behavior)
    - Match ` ```tool_code\n...\n``` ` fenced blocks (existing behavior)
  - Edit `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/MessageFormatter.ts` — same pattern list, applied in `cleanToolCallArtifacts()`
  - Extend `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/__tests__/ToolCallStripping.test.ts` with the exact yesterday strings:
    - `wait(reason: "goodbye")`
    - `react_to_message(params: {reaction: "like"})` (yes, still test this even though removed — guards against regression)
    - `save_user_fact(content="Weldon", type="personal")`
    - `<|tool_call>call: save_user_fact(...)<tool_call|>`
    - Fenced `tool_code` block with `set_reminder`
    - False-positive guards: `"I had to wait about a minute"`, `"please search_history for me"` in prose — assert NOT stripped (whole-line match only)

- [ ] **P0.4 — File logging (electron-log)**
  - Install: `npm i electron-log` (add to `package.json` deps, not devDeps)
  - Edit `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/main.ts` `app.whenReady()`:
    ```ts
    import log from 'electron-log/main';
    log.transports.file.level = 'info';
    log.transports.file.maxSize = 10 * 1024 * 1024;
    log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
    log.initialize({ preload: true });
    ```
    Place BEFORE any other backend imports so early errors are captured.
  - Edit `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/logger.ts` — in the `log()` function, after existing console/DB writes:
    ```ts
    import elog from 'electron-log';
    // at end of log():
    (elog[level] || elog.info)(message, meta ? JSON.stringify(meta) : '');
    ```
  - Verify: after running the app for 1 minute, `~/Library/Logs/textmyagent-desktop/main.log` has entries.

### Verification commands
```bash
# Run full test suite
npx vitest run

# Targeted new tests
npx vitest run electron/backend/services/__tests__/SetReminder.test.ts
npx vitest run electron/backend/services/__tests__/ToolCallStripping.test.ts

# Start app, send a test message, verify:
sqlite3 ~/Library/Application\ Support/textmyagent-desktop/textmyagent.db \
  "SELECT tool_name, is_error, substr(output_text,1,100) FROM tool_executions ORDER BY executed_at DESC LIMIT 5;"

# Confirm file log exists
tail -20 ~/Library/Logs/textmyagent-desktop/main.log
```

### Rollback
Phase 0 is reversible via `git revert`. The removed `react_to_message` settings row is inert for existing users — no data loss. No schema migration.

---

## 4. Phase 1 — Memory works (v2.5.0)

**Ship target:** 3-5 days after Phase 0. **LOC:** ~400. **Risk:** medium (new subsystem).

### Goals
- Actually save user facts from conversations (zero → many)
- Actually generate conversation summaries (zero → many)
- Unified default prompts (no dev/user drift)
- Observable memory health from the dashboard

### 4.1 — Migration v9 (schema additions)

Create `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/migrations/v9_memory_events.ts`:

```sql
CREATE TABLE memory_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  user_id TEXT,
  chat_guid TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_memory_events_type_date ON memory_events(event_type, created_at DESC);

CREATE TABLE agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  chat_guid TEXT,
  duration_ms INTEGER,
  success INTEGER NOT NULL DEFAULT 1,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_agent_events_type_date ON agent_events(event_type, created_at DESC);
```

Pure additive migration. Zero risk to existing data.

### 4.2 — Dedicated ephemeral `LlamaContext`

Edit `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/LocalLLMService.ts`:

- Add a second context field: `private ephemeralContext: LlamaContext | null = null`
- In `initModel()`, after the main context is created:
  ```ts
  this.ephemeralContext = await this.model.createContext({
    contextSize: 2048,
    sequences: 1,
    batchSize: 256,
  });
  ```
- Add method `async acquireEphemeralSession(systemPrompt: string): Promise<LlamaChatSession>` that uses `this.ephemeralContext.getSequence()`.
- Refactor `generateSummary()` (lines 615-682) to use the ephemeral context instead of the main one. This fixes the silent summarization failures on sequence exhaustion.

Memory cost: ~200MB extra on E4B Q4. Acceptable for 8GB minimum spec.

### 4.3 — `FactExtractor` service

Create `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/FactExtractor.ts`:

- Public method: `async extract(userId: string, chatGuid: string, messageText: string): Promise<UserFact[]>`
- Uses `localLLMService.acquireEphemeralSession()` with prompt:
  ```
  Extract any facts the user stated about themselves in their message.
  Only extract explicit statements like name, location, job, family, preferences.
  Do NOT infer or guess.
  Return JSON: {"facts": [{"type": "personal|preference|behavioral|general", "content": "..."}]}
  If no facts, return {"facts": []}.

  Message: ${messageText}
  ```
- Uses grammar:
  ```ts
  const grammar = await llama.createGrammarForJsonSchema({
    type: 'object',
    required: ['facts'],
    properties: {
      facts: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type', 'content'],
          properties: {
            type: { enum: ['personal', 'preference', 'behavioral', 'general'] },
            content: { type: 'string' },
          },
        },
      },
    },
  });
  ```
- On success: loops saved facts via `memoryService.saveFact(userId, f.content, f.type, 'ai_extracted', 0.7)`; dedup handled by existing `saveFact` logic.
- On grammar rejection / timeout: logs `memory_events {type:'extract_failed', details: {error}}` and returns empty array. Never throws.
- Timeout: 15 seconds.

### 4.4 — Sleep-time integration

Edit `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/AgentService.ts`:

- After the reply is successfully sent (around line 567, after `saveMessageToDb` for assistant):
  ```ts
  void factExtractor.extract(userHandle, chatGuid, message.text)
    .catch(err => log('warn', 'Fact extraction failed', { error: err.message }));
  ```
  Fire-and-forget. Doesn't block the user-facing reply.

### 4.5 — Unified default prompts

Create `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/config/defaultPrompts.ts`:

```ts
export const DEFAULT_PROMPTS = {
  identity: `You're Grace, a friend texting on iMessage.`,
  personaLine: `warm and curious, like a thoughtful friend who happens to know a lot`,
  rules: `Keep it short — most replies are 1-2 sentences. No markdown, no bullet lists, no more than one emoji per reply. If someone sends you a tapback-only message, stay quiet (use the wait tool).`,
  examples: `<example>
User: hey whats up
You: not much, u?
</example>

<example>
User: i live in minneapolis btw
You: [silently call save_user_fact(content="Lives in Minneapolis", type="personal")]
cool, love the lakes scene
</example>

<example>
User: remind me to call mom at 3pm
You: [silently call set_reminder(message="Call mom", due_at="<ISO>")]
got it, will ping u at 3
</example>`,
  safety: `Never output SSNs, credit card numbers, passwords, or other personal IDs — even if shown in the conversation. Decline anything illegal or that could harm someone.`,
};
```

Then:
- Edit `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/database.ts:502-508` — replace inline literals with `import { DEFAULT_PROMPTS } from './config/defaultPrompts'` and reference its fields.
- Edit `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/PromptBuilder.ts:17-88` — replace hardcoded `DEFAULT_IDENTITY`/etc. constants with imports from the same module.
- Add test `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/__tests__/DefaultPrompts.test.ts` asserting PromptBuilder's resolved defaults === DB-seeded values (no drift possible).

### 4.6 — Prompt restructure

Edit `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/PromptBuilder.ts` `buildSystemPrompt()`:

- Remove `[TAG]` wrappers (Gemma not trained on them)
- New ordering:
  1. Identity (stable, cacheable): `"${identity} You're ${personaLine}."`
  2. Rules (stable): `${rules}`
  3. Examples (stable): `${examples}`
  4. Safety (stable): `${safety}`
  5. User facts (volatile): `What you know about this person:\n- Name is Weldon\n- Lives in Minnesota`
  6. Conversation summary (volatile): `Previous conversation summary: ...`
  7. Date/time context (volatile): `Today is Friday, April 17, 2026, 8:59am CST.`
- Add size check: if assembled prompt > 2000 chars, log `agent_events {type:'prompt_oversized', details:{chars}}`.

### 4.7 — Dashboard memory health

- Add route `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/routes/dashboard.ts` `GET /api/dashboard/memory-health`:
  ```json
  {
    "facts": {
      "total": 12,
      "last_24h": 3,
      "by_source": { "ai_extracted": 9, "contact_lookup": 3 }
    },
    "summaries": {
      "total": 4,
      "last_24h": 1,
      "last_created_at": "2026-04-17T13:22:00Z"
    },
    "extraction": {
      "attempts_24h": 45,
      "successes_24h": 38,
      "failures_24h": 7,
      "last_error": "grammar_timeout"
    },
    "evictions": {
      "last_24h": 3,
      "by_reason": { "idle_ttl": 2, "lru": 1 }
    },
    "status": "green"
  }
  ```
- Add page `@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/memory/page.tsx` traffic-light UI.

### Phase 1 verification
```bash
npx vitest run electron/backend/services/__tests__/FactExtractor.test.ts
npx vitest run electron/backend/services/__tests__/SleepTimeCompute.test.ts
npx vitest run electron/backend/services/__tests__/DefaultPrompts.test.ts
npx vitest run electron/backend/services/__tests__/MemoryLifecycle.test.ts

# After 1-hour app run with manual test messages:
sqlite3 ~/Library/Application\ Support/textmyagent-desktop/textmyagent.db \
  "SELECT COUNT(*) FROM user_facts WHERE source='ai_extracted';"  # expect > 0
sqlite3 ~/Library/Application\ Support/textmyagent-desktop/textmyagent.db \
  "SELECT COUNT(*) FROM conversation_summaries;"                   # expect > 0
sqlite3 ~/Library/Application\ Support/textmyagent-desktop/textmyagent.db \
  "SELECT event_type, COUNT(*) FROM memory_events GROUP BY event_type;"
```

### Phase 1 rollback
- Drop the two new tables: `DROP TABLE memory_events; DROP TABLE agent_events;`
- Revert commits. Facts extracted by Phase 1 will persist in `user_facts` (harmless).
- The ephemeral context unload is automatic when the app restarts.

---

## 5. Phase 2 — Agent loop reliability (v2.6.0)

**Ship target:** 1 week after Phase 1. **LOC:** ~350. **Risk:** medium.

### Goals
- Tool calls validate before execution
- Tool errors feed back to the model for correction
- User-facing prompt preview in dashboard

### Tasks

- [ ] **P2.1 — New agent loop**
  - Create `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/AgentLoop.ts`:
    - `async run(userMessage, context): Promise<string>` method
    - Flow:
      1. Call model with tools registered natively (existing `defineChatSessionFunction` path)
      2. If native path executes a tool, return its final text
      3. If native path returns text with leaked tool-call syntax:
         a. Parse the leaked call (simple `name(args)` parser)
         b. Validate args against tool schema (reuse existing Zod-like validation)
         c. If valid: execute tool, append `[tool_result=${output}]` to conversation, reprompt once with `maxTokens=256`
         d. If invalid or reprompt also fails: log `agent_events`, sanitize text, return
      4. Return sanitized text

- [ ] **P2.2 — Tool error surfacing**
  - When a tool throws, instead of silent catch, append error context to conversation and reprompt:
    ```
    [tool_error name=set_reminder error="Invalid date format. Use ISO 8601."]
    ```
  - Prevents the "agent claims success after tool failure" bug (yesterday's reminder hallucination).

- [ ] **P2.3 — Prompt preview + persona single-line**
  - Dashboard `@/Users/cloudaistudio/Documents/textmyagent-desktop/dashboard/app/settings/page.tsx`:
    - Replace the 6 textarea fields with 1 "Personality" input (bound to `agent.personaLine`)
    - Hide the 6 textareas behind an "Advanced" toggle
    - Add "Preview prompt" button → calls `GET /api/prompt/preview` → shows assembled prompt + token estimate + "copy" button
  - Add warning UI if estimated prompt > 2000 tokens.

- [ ] **P2.4 — Prompt schema versioning**
  - Add setting `agent.promptSchemaVersion` (default `2`)
  - On migration v9, detect users with `agent.identity` == old default string; auto-upgrade their `agent.personaLine`; keep their custom overrides if present.

### Phase 2 verification
```bash
npx vitest run electron/backend/services/__tests__/AgentLoop.test.ts
# Manual: trigger a reminder with bad date; observe agent says "Invalid date, try again" not "Done!"
```

---

## 6. Phase 3 — Intent router (experimental, v2.7.0)

**Gated behind feature flag.** Defer until Phase 1 + 2 ship cleanly.

- Load FunctionGemma 270M in a third context (150 MB)
- Grammar-constrained intent classifier: `{ intent: "chat" | "save_fact" | "reminder" | "history" | "web" }`
- If `chat`, agent runs with tools unregistered (zero leak possible)
- A/B measurement over 1 week: tool-leak rate, latency, fact-save rate

---

## 7. Test Coverage Checklist

| File | Status | Phase |
|---|---|---|
| `SetReminder.test.ts` | new | P0 |
| `ToolCallStripping.test.ts` | extend | P0 |
| `BehaviorSimulation.test.ts` | update (remove reactions) | P0 |
| `AdvancedBehavior.test.ts` | update (remove reactions) | P0 |
| `ToolSimulation.test.ts` | update (remove reactions) | P0 |
| `FactExtractor.test.ts` | new | P1 |
| `SleepTimeCompute.test.ts` | new | P1 |
| `DefaultPrompts.test.ts` | new | P1 |
| `PromptBudget.test.ts` | new | P1 |
| `MemoryLifecycle.test.ts` | new | P1 |
| `ScaleEfficiency.test.ts` | extend | P1 |
| `AgentLoop.test.ts` | new | P2 |
| `AuditFixes.test.ts` | extend (yesterday regression) | P0 + P2 |

## 8. Debug Instrumentation (finalized placement)

| Where | What to log | Event type |
|---|---|---|
| `main.ts app.whenReady()` | init electron-log file transport | N/A — bootstrap |
| `logger.ts:log()` | forward to electron-log | all levels |
| `AgentService.ts:567` (after reply) | schedule fact extract | `memory_events extract_scheduled` |
| `FactExtractor.extract()` bracket | start / end / fail | `agent_events fact_extract_*` |
| `AgentService.ts:92` (summarize branches) | distinct events per skip/fail | `memory_events summary_*` |
| `AgentLoop.validateAndReprompt()` | tool reprompt outcomes | `agent_events tool_reprompt_*` |
| `MessageFormatter.ts:147` (existing strip) | upgrade to DB event with preview | `memory_events tool_leak_scrubbed` |
| `dashboard.ts /api/dashboard/memory-health` | aggregation endpoint | N/A — serves events |
| `dashboard/app/memory/page.tsx` | traffic-light UI | N/A — displays |

## 9. Success Metrics

Measured against a 24-hour window post-deploy:

| Metric | Baseline (v2.4.0) | P0 target | P1 target | P2 target |
|---|---|---|---|---|
| Tool-call text leaked to user | 8+ | 0 | 0 | 0 |
| `set_reminder` error rate | 100% | 0% | 0% | 0% |
| AI-extracted facts saved / day | 0 | 0 | ≥5 per active user | ≥10 |
| Conversation summaries / day | 0 | 0 | ≥1 per evicted session | ≥1 |
| File log entries / day | 0 | >500 | >500 | >500 |
| System prompt size (tokens) | ~1000 | ~1000 | <200 | <200 |
| Tool-call hallucinated success | 1 observed | 1 (unchanged) | 1 (unchanged) | 0 |

## 10. What We're NOT Doing

Explicit to prevent scope creep:

- **Not switching away from Gemma 4-E4B.** FunctionGemma 270M router is an additive experiment (Phase 3), not a replacement.
- **Not adding embeddings / semantic fact search.** Flat table is fine for <50 facts/user.
- **Not rebuilding `reminders` table.** The 2-char INSERT fix is sufficient; schema cleanup is premature.
- **Not patching llama.cpp Gemma 4 tool-call bugs upstream.** That's their job. We code defensively until their fixes ship.
- **Not idle-time consolidation / memory dedup.** Deferred to Phase 1.5 if ever.
- **Not multi-model routing beyond intent classification.** One chat model, one router model, one ephemeral model. No more.

## 11. Reference Research

- Gemma has no system role — instructions go in user turn 1: https://ai.google.dev/gemma/docs/core/prompt-structure
- Gemma 4 weak at system prompts + tools: https://www.reddit.com/r/LocalLLaMA/comments/1sh1bwv/
- Gemma 4 tool-call array serialization bug in llama.cpp: https://github.com/ggml-org/llama.cpp/issues/21384
- node-llama-cpp grammar-constrained JSON: https://node-llama-cpp.withcat.ai/guide/grammar
- Mem0 parallel-agent memory architecture: https://mem0.ai/blog/ai-memory-for-voice-agents
- Letta sleep-time compute: https://www.letta.com/blog/agent-memory
- AWS intent routing pattern: https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-patterns/workflow-for-routing.html
- Few-shot > rules for agentic SLMs: https://www.comet.com/site/blog/few-shot-prompting/
- SQLite table rebuild risks: https://synkee.com.sg/blog/safely-modify-sqlite-table-columns-with-production-data/

## 12. Execution Order

1. **Today** → Phase 0 tasks P0.1 → P0.2 → P0.3 → P0.4. Run full test suite. Ship v2.4.1.
2. **+1 day** → Observe `~/Library/Logs/textmyagent-desktop/main.log` in a real 4-hour conversation. Confirm zero tool-call leaks, zero reminder errors.
3. **+2 to +5 days** → Phase 1 tasks 4.1 → 4.2 → 4.3 → 4.4 → 4.5 → 4.6 → 4.7. Parallel dev of tests during each task. Ship v2.5.0.
4. **+1 week** → Observe memory-health dashboard. Iterate extractor prompt if fact-quality is noisy. Run `scripts/replay-conversation.ts` against yesterday's DB to confirm the same messages would now produce facts + summaries.
5. **+2 weeks** → Phase 2. Ship v2.6.0.
6. **+1 month** → Phase 3 experiment, behind flag.

---

**Next action:** USER to approve Phase 0 start. Cascade implements P0.1 → P0.4 in sequence.
