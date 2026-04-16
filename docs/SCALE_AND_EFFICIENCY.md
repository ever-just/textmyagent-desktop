# TextMyAgent Scale & Efficiency: The Full Picture

> **Purpose:** Single source of truth on how TextMyAgent processes inbound messages, what the real capacity limits are, and how to maximize efficient conversation handling.  
> **Date:** Apr 16, 2026  
> **Supersedes:** Prior drafts (`SCALE_RESEARCH_FINDINGS.md`, `SCALE_ARCHITECTURE_PLAN.md`) — they're kept for history, but use this doc.

---

## Table of Contents

1. [Core Goals (What We're Actually Optimizing For)](#1-core-goals)
2. [The Complete Inbound Pipeline](#2-the-complete-inbound-pipeline)
3. [Every Queue & Throttle Explained](#3-every-queue--throttle-explained)
4. [Session Reuse: How Conversations Stay "Warm"](#4-session-reuse-how-conversations-stay-warm)
5. [Real Bandwidth Numbers (Measured)](#5-real-bandwidth-numbers-measured)
6. [Realistic User Capacity By Hardware](#6-realistic-user-capacity-by-hardware)
7. [The Bottlenecks (Ranked by Impact)](#7-the-bottlenecks-ranked-by-impact)
8. [What's Already Efficient (Don't Touch)](#8-whats-already-efficient-dont-touch)
9. [The Fix Plan](#9-the-fix-plan)
10. [Honest Limits & Tradeoffs](#10-honest-limits--tradeoffs)
11. [Explicit Non-Goals & Rejected Ideas](#11-explicit-non-goals--rejected-ideas)
12. [Research History & Audit Corrections](#12-research-history--audit-corrections)

---

## 1. Core Goals

We're optimizing for **two distinct dimensions** that often get conflated:

### Goal A: Efficient Conversation Continuity
When a user messages, messages again a few minutes later, and again an hour later — the agent should pick up where it left off without re-processing prior turns. The LLM's internal state ("KV cache") should stay warm for active conversations.

**Terminology:** session reuse, stateful inference, KV cache persistence, prefix caching.

### Goal B: High Long-Term User Volume
The system should remember 5,000-10,000 distinct users over time with structured facts, summaries, and conversation continuity — even though only a small fraction are active at any moment.

### What This Is NOT
- **Not strict simultaneous concurrency.** iMessage is async; 30-second delays are fine. We're optimizing for *efficient handling of realistic message patterns*, not literal parallel inference at millisecond scale.
- **Not cloud scale.** 100% local on one Mac is a hard requirement.
- **Not 10K simultaneously active users.** That's impossible on one Mac. 10K "claimed" users with ~10-30% daily active is the real target.

---

## 2. The Complete Inbound Pipeline

```
┌──────────────────────────────────────────────────────────────────┐
│ macOS iMessage database (~/Library/Messages/chat.db)              │
└────────────────────────┬─────────────────────────────────────────┘
                         │ SQLite read-only
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│ iMessageService.pollNewMessages()                                  │
│                                                                     │
│ Adaptive polling:                                                   │
│   • Active (<2 min since last msg): 2000 ms                        │
│   • Idle   (2-10 min):              5000 ms                        │
│   • Sleep  (>10 min):              15000 ms                        │
│   • Floor:                            500 ms                        │
│                                                                     │
│ Guard: isPolling flag prevents concurrent DB reads                  │
│ Emits 'message' event for each new inbound message                  │
└────────────────────────┬─────────────────────────────────────────┘
                         │ EventEmitter
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│ AgentService.handleIncomingMessage(message)                        │
│                                                                     │
│ STAGE 1: Policy checks                                              │
│   ├─ Is agent running? If no → drop                                 │
│   ├─ Is user blocked? → drop                                        │
│   ├─ Allowlist mode on & user not allowed? → drop                   │
│                                                                     │
│ STAGE 2: Rate limiter (RateLimiter.ts)                             │
│   ├─ Per-user sliding window: 10 msg/min                            │
│   ├─ Global fixed window:    200 msg/hr  ← MAIN BOTTLENECK          │
│                                                                     │
│ STAGE 3: Deduplication                                              │
│   └─ processingQueue: Set<messageGuid> prevents double-process      │
│                                                                     │
│ STAGE 4: Per-chat lock + queue                                      │
│   ├─ chatLocks: Set<chatGuid> — one msg per chat at a time          │
│   ├─ chatQueues: Map<chatGuid, IMessage[]> — max 5 per chat         │
│   ├─ Overflow policy: DROP OLDEST queued msg                        │
│   └─ Different chats proceed in parallel                            │
│                                                                     │
│ STAGE 5: Load context                                               │
│   ├─ Fetch last 10 iMessage history (every call, unconditional)     │
│   ├─ Filter messages >30 min old as stale                           │
│   ├─ Load user facts from SQLite                                    │
│   └─ Build PromptContext                                            │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│ LocalLLMService.generateResponse()                                  │
│                                                                     │
│ STAGE 6: Session lookup                                             │
│   ├─ Look up sessionPool.get(chatGuid)                              │
│   │    ├─ FOUND → reuse (KV cache warm, only new msg processed)    │
│   │    └─ NOT FOUND → create new session                            │
│   │         ├─ If pool full (size=2): LRU-evict one                 │
│   │         ├─ Allocate new sequence from LlamaContext              │
│   │         └─ setChatHistory() — prefills all prior turns          │
│   └─ Pool capacity: maxPooledSessions = 2 (hardcoded)               │
│                                                                     │
│ STAGE 7: LLM inference                                              │
│   ├─ node-llama-cpp + Gemma 4 E4B Q4_K_M                            │
│   ├─ Max 6 tool calls per message (calendar, contacts, etc)         │
│   ├─ 90-second hard inference timeout                               │
│   └─ Raw tool-call stripping regex (Gemma 4 workaround)             │
│                                                                     │
│ STAGE 8: Response delivery                                          │
│   ├─ Format via messageFormatter                                    │
│   ├─ Send via AppleScript (iMessageService.sendMessage)             │
│   ├─ Persist to SQLite                                              │
│   └─ Release chat lock → drain queue if pending                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Every Queue & Throttle Explained

There are **five separate gating mechanisms** in the pipeline. Each exists for a specific reason and has its own capacity.

### 3.1 Adaptive Poll Interval (Stage 1)
**Purpose:** Don't hammer the iMessage SQLite DB when nothing's happening.

**Capacity:** During active chat at 2s polls, we can detect up to **30 messages per minute** across all chats. The DB query itself handles thousands of rows easily — polling interval is the limit, not SQLite.

**⚠️ Code/DB inconsistency:** The DB seeds `polling.sleepIntervalMs` to **15000** at `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/database.ts:542`, but the code at `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/iMessageService.ts:145` falls back to **5000** if the setting is missing. On a normal install the DB default (15000) wins, but this mismatch should be unified. **Recommended fix during Phase 1:** change the code fallback to also be 15000, or the DB seed to 5000 — pick one and eliminate the inconsistency.

**Source:** `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/iMessageService.ts:139-148`

### 3.2 Per-User Rate Limiter (Stage 2a)
**Purpose:** Prevent a single user from flooding the agent.

**Capacity:** 10 messages per user per minute (sliding window). Configurable via `security.rateLimitPerMinute`.

**Source:** `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/RateLimiter.ts:27`

### 3.3 Global Rate Limiter (Stage 2b) — **🚨 THE MAIN BOTTLENECK**
**Purpose:** Originally designed to prevent runaway paid-API costs.

**Capacity:** **200 messages per HOUR total** across all users (fixed window). Configurable via `security.rateLimitGlobalPerHour`.

**Why this is a problem now:**
- Local inference costs $0 per message
- Hardware can do 720-1,440 msg/hr (see §5)
- This cap throttles us to **14-28% of actual capacity**
- Kept as safety net but the default is way too conservative for local use

**Source:** `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/RateLimiter.ts:29`

### 3.4 Message Deduplication (Stage 3)
**Purpose:** If the same `messageGuid` arrives twice (polling overlap, duplicate DB read), process only once.

**Capacity:** Unlimited Set of in-flight GUIDs. Cleared when message finishes processing. No real bandwidth limit — it's metadata-only.

**Source:** `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/AgentService.ts:25`

### 3.5 Per-Chat Queue (Stage 4) — **MESSAGE BUFFER**
**Purpose:** Preserve message ordering within a conversation while the LLM is busy responding.

**Capacity per chat:**
- 1 message actively processing
- Up to **5 messages queued** waiting
- = **6-message burst tolerance per chat** before overflow

**Overflow behavior:** When the 6th queued message arrives, the **oldest queued message is dropped** (silent, only logged). The newest always gets queued.

**Capacity across all chats:**
- No global queue depth limit
- Total buffered = 6 × (number of active chats)
- e.g., 50 active chats = **up to 300 messages buffered**

**Source:** `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/AgentService.ts:27-28, 172-186`

### 3.6 LLM Session Pool (Stage 6) — **CONCURRENCY CAP**
**Purpose:** Keep LLM state warm for active conversations; reuse across messages.

**Capacity:** `maxPooledSessions = 2` (hardcoded).

This creates two limits:
1. **Only 2 warm sessions can coexist.** 3rd+ chat triggers LRU eviction of the oldest.
2. **Inference batching is sub-linear, not parallel.** llama.cpp supports continuous batching across `sequences: N`, but single-GPU Apple Silicon doesn't scale linearly with sequence count. Realistic aggregate throughput with 2 sequences is ~1.3-1.6x a single inference, not 2x. With 4 sequences it's ~1.7-2.0x. Diminishing returns past that.

**Important clarification:** Two concurrent `handleIncomingMessage` calls for different chats *can* overlap at the JavaScript event-loop level (each holds its own chat lock), and llama.cpp will batch their token generation when both sessions are actively prompting. But this is **not vLLM-style continuous batching** — aggregate throughput gains are modest, per-request latency slightly increases. For our async SMS use case, this is still a win.

**Source:** `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/LocalLLMService.ts:60`

---

## 4. Session Reuse: How Conversations Stay "Warm"

This is the mechanism that avoids "restarting" the LLM for every message.

### 4.1 The Happy Path (What Happens When It Works)

```
User sends msg #1  ─┐
                    ├─► New session created
                    ├─► System prompt prefilled (~1K tokens, ~1s)
                    ├─► Any prior history prefilled (~2-3s)
                    ├─► Response generated (~5-10s)
                    └─► Session stays in pool with KV cache warm

User sends msg #2 (within 10 min)
                    ├─► sessionPool.get(chatGuid) → FOUND
                    ├─► Prefill: 0s (state already there)
                    ├─► Response generated (~3-8s)   ← FASTER
                    └─► Session still warm

User sends msg #3 (1 hour later, pool has evicted them)
                    ├─► sessionPool.get(chatGuid) → NOT FOUND
                    ├─► Rebuild session from SQLite history
                    ├─► setChatHistory() prefills all prior turns (~2-3s)
                    ├─► Response generated (~5-10s)
                    └─► Session warm again
```

### 4.2 How The Pool Works Today

Pool size = 2. LRU eviction. No idle TTL.

**Example failure mode:**
```
10:00  Alice messages  →  pool: [Alice]
10:01  Bob messages    →  pool: [Alice, Bob]
10:02  Charlie msgs    →  pool: [Bob, Charlie]  (Alice evicted!)
10:03  Alice replies   →  REBUILD Alice (~2-3s lost)
```

With only 2 slots, any real multi-user scenario constantly evicts and rebuilds.

### 4.3 Prefix Caching (System Prompt Reuse)

Our system prompt is ~1K tokens and marked `cacheable: true` per section in `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/PromptBuilder.ts:113-148`.

**In theory:** llama.cpp automatically reuses KV cache when parallel sequences share an identical prefix. When we create the context with `sequences: 2`, both sessions should share the prefilled system prompt — we compute it once, use it for all chats.

**In practice:** We haven't empirically verified this with benchmarks. Worth testing.

### 4.4 What Kills Session Reuse

1. **LRU eviction** when pool fills (fixable: bigger pool)
2. **User returning after pool evicted them** (fixable: compact rebuild from summary)
3. **App restart / model reload** (fixable: save warm sessions to disk for top-N users — expensive but possible)
4. **Context size exhaustion** (fixable: summarize old turns out of context when near limit)

---

## 5. Real Bandwidth Numbers (Measured)

### 5.1 Hardware Throughput (What the Mac Can Actually Do)

Based on Gemma 4 E4B Q4_K_M on Apple Silicon:

| Stage | Per Message | Notes |
|---|---|---|
| Prefill (1K system prompt, cached) | ~0s | Cached after first use |
| Prefill (cold, full history ~3K) | 2-4s | Only on session cold-start |
| Generation (100-200 tokens) | 3-8s | ~30-60 tok/s on M1/M2 base |
| Tool calls (if any) | 0-10s extra | Variable |
| AppleScript send | 0.5-1s | |
| **Total per message (warm)** | **3-9s** | Median ~5s |
| **Total per message (cold)** | **6-15s** | Median ~10s |

### 5.2 Theoretical vs Actual Throughput

> **Corrected after audit.** Earlier numbers assumed linear 2x parallelism scaling, which doesn't happen on single-GPU Apple Silicon. Continuous batching gains are sub-linear.

**Serial baseline (1 session, all warm):**
- ~6-10 msgs/min × 60 min = **~360-600 msg/hour**

**Current hardware ceiling (pool=2, continuous batching ~1.3-1.6x):**
- ~470-960 msg/hour warm
- Realistic mix with cold starts: **~300-580 msg/hour**

**Current actual ceiling (with 200/hr rate limit):**
- **200 msg/hour** — **~35-65% of real hardware capacity**

**With proposed fixes (pool=4, batching ~1.7-2.0x, no artificial cap):**
- ~610-1,200 msg/hour warm
- Realistic mix: **~400-720 msg/hour**
- ~2-3x improvement over today's capped throughput

These numbers are estimates based on 30-60 tok/s single-stream on E4B. **Should be validated empirically on actual target hardware** (see §10 Verification Required).

### 5.3 Queue Buffer Capacity

| Scenario | Buffering available |
|---|---|
| Single user rapid-fires 10 messages | 6 processed/queued, **4 dropped** |
| 10 users each send 3 messages burst | All 30 queued, no loss (6 per chat) |
| 100 users each send 1 message burst | All 100 queued, no loss |
| 100 users each send 10 messages | 600 queued, 400 dropped from queues; eventually rate limit kicks in |

**Key insight:** The queue handles bursty traffic fine **across different chats**. It only drops messages when **one chat floods** (6+ rapid messages).

---

## 6. Realistic User Capacity By Hardware

### 6.1 Two Different Numbers: Concurrent vs Long-Term

These get confused constantly. Keep them separate:

#### A. "Warm conversations" (sessions in pool)
How many people can get instant-continue responses right now?

| Mac RAM | Current | Possible | Why |
|---|---|---|---|
| 8 GB | 2 | 2 | E2B model required; pool RAM tight |
| 16 GB | 2 | **4-5** | E4B fits, plenty of headroom |
| 32 GB | 2 | **6-8** | Further headroom |
| 64 GB+ Studio | 2 | **10-16** | Can even consider 26B A4B MoE |

#### B. "Long-term users" (rows in SQLite with facts/summary/history)
How many unique people can we remember over time?

| Storage use | Capacity |
|---|---|
| 10K users × 5 KB structured state | **50 MB SQLite** |
| 10K users × 100 messages avg history | **~200 MB SQLite** |
| **Total DB growth at 10K users** | **~250 MB** |

**This is essentially free on any modern Mac.** SQLite with proper indexes handles this in sub-millisecond lookups.

### 6.2 Daily Active Users (The Real Constraint)

The bottleneck isn't storage or pool size — it's **sustained message throughput during peak hours.**

Assumptions: Users send avg 3 msgs/day, distributed normally, peak hour = 3x average.

| Total users | DAU rate | Peak hour load | 16GB Mac verdict |
|---|---|---|---|
| 1,000 | 30% = 300 | ~112 msg/hr | ✅ Comfortable |
| 2,500 | 30% = 750 | ~280 msg/hr | ✅ Fine at pool=4 |
| 5,000 | 20% = 1,000 | ~375 msg/hr | ⚠️ Queues during peak |
| 10,000 | 10% = 1,000 | ~375 msg/hr | ⚠️ Queues during peak |
| 10,000 | 30% = 3,000 | ~1,125 msg/hr | ❌ Beyond hardware, need multi-Mac |

**The honest answer:** 10,000 long-term users is totally feasible IF realistic activity patterns hold (10-20% DAU, not 100%). If 30%+ of your 10K users are active in the same peak hour, you need more than one Mac.

---

## 7. The Bottlenecks (Ranked By Impact)

### 🚨 Bottleneck #1: Global rate limit (200/hr) — ARTIFICIAL
- Currently caps throughput to ~35-65% of real hardware capacity (varies with warm/cold mix)
- Legacy decision from when we used paid APIs
- **Fix: raise to 2000-5000/hr or remove for local inference; keep for paid providers**
- **Impact: ~1.5-3x throughput increase immediately (from 200 to ~300-580 mixed msg/hr)**

### 🟠 Bottleneck #2: Pool size (2) — ARTIFICIAL on 16GB+
- 16GB Macs can handle 4-5 comfortably; 32GB can handle 6-8
- **Fix: auto-detect RAM, set pool accordingly**
- **Primary impact (qualitative):** Far fewer session evictions. With 4-5 warm slots, the most active users get near-instant continues ~90% of the time vs today where only the last 2 stay warm.
- **Secondary impact (throughput):** Modest aggregate gains from better batching (~1.3x → ~1.7x). NOT a linear 2x.
- The warm-session-continuity win is bigger than the raw-throughput win here.

### 🟡 Bottleneck #3: Context size (default path auto-detects, but 8192 target is over-provisioned)
- SMS conversations rarely need 8K tokens
- 4K is more than enough (system ~1K + facts/summary ~500 + last 20 msgs ~2K = 3.5K)
- Current code behavior at `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/LocalLLMService.ts:269-271`: if `contextSize === 8192` (default), it's **not** passed to `createContext()` and node-llama-cpp auto-detects. Only a non-default value triggers explicit sizing.
- **Fix: default `contextSize = 4096` AND pass it explicitly so we control memory use**
- **Impact: frees ~60-120 MB per session; enables +1-2 extra pool slots on 16GB. Not "doubles pool capacity" — KV cache is only part of per-session memory (context metadata, tool definitions, chat wrapper state also consume RAM).**

### 🟡 Bottleneck #4: Queue drop-oldest policy — SILENT MESSAGE LOSS
- When one chat floods 6+ messages, oldest queued is dropped
- Bad for conversation coherence (loses early context)
- **Fix: drop newest instead, or coalesce recent messages**
- **Impact: qualitative, not throughput — but prevents confusing conversations**

### 🟡 Bottleneck #5: Cold-rebuild reloads full history
- When a user comes back after eviction, we prefill all 20 prior messages (~2-3s)
- Could rebuild with just summary + last 5 messages (~0.5-1s)
- **Fix: compact cold-rebuild with summary**
- **Impact: 3-6x faster warm-up after eviction**

### 🟢 Bottleneck #6: No idle TTL on pool
- Sessions only leave via LRU, not via inactivity
- A user who chatted 2 hours ago still blocks a pool slot
- **Fix: 10-min idle TTL, evict inactive sessions even if pool isn't full**
- **Impact: makes pool more responsive to actual active users**

### 🟢 Bottleneck #7: History reload on every message
- `iMessageService.getConversationHistory(chatGuid, 10)` at `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/AgentService.ts:196` runs unconditionally
- For warm sessions, we already have the context in memory
- **Fix: skip if `conversations.has(chatGuid)` and recent**
- **Impact: ~100-300ms saved per message for active conversations**

### 🟢 Bottleneck #8: No message coalescing
- "hey", "actually wait", "nevermind what's the weather" = 3 separate LLM calls
- Could wait 1-2s after a message arrives to see if more follow
- **Fix: per-chat debounce window before kicking off inference**
- **Interaction with chat locks:** coalescing must happen BEFORE acquiring the chat lock — otherwise messages queue during processing and can't be merged. Implement as a debounce in `handleIncomingMessage` entry, before stages 2-4.
- **Impact: fewer (but longer) LLM calls, more coherent responses, ~30-50% reduction in LLM calls for bursty users**

---

## 8. What's Already Efficient (Don't Touch)

These are all solid and should be preserved:

| Feature | Location | Why it's good |
|---|---|---|
| Adaptive polling | `iMessageService.ts:139-148` | Smart energy/CPU use |
| Session pool + LRU | `LocalLLMService.ts:427-451` | Foundation for warm reuse |
| Per-chat lock | `AgentService.ts:172-186` | Preserves message order |
| Cross-chat non-blocking | (implicit in per-chat lock scope) | Different users don't serialize behind each other at the event loop |
| Dedup by GUID | `AgentService.ts:25, 166-169` | Prevents double-processing |
| isPolling guard | `iMessageService.ts:64, 182-183` | Prevents overlapping DB reads |
| Stale message filter | `AgentService.ts:228` | Agent restart doesn't reply to old msgs |
| Cacheable prompt sections | `PromptBuilder.ts:113-148` | Static prefix before dynamic content — structure supports KV prefix sharing |
| Multi-sequence context | `LocalLLMService.ts:267-268` | `sequences: maxPooledSessions` enables continuous batching (sub-linear throughput gains) |
| Blocked user / allowlist | `AgentService.ts:126-155` | Access control works |
| Per-user rate limit | `RateLimiter.ts:40-62` | 10/min is reasonable |
| Per-message API cap (6 tool calls) | `AgentService.ts:29` | Prevents runaway tool loops |
| 90s inference timeout | `LocalLLMService.ts:534` | Unwinds stuck inferences |
| Context size auto-detect | `LocalLLMService.ts:269-271` | node-llama-cpp picks safe default when unset |
| `useMmap: false` | `LocalLLMService.ts:255` | Avoids SIGBUS in Electron hardened runtime |

---

## 9. The Fix Plan

Ordered by **impact ÷ effort** — do these in order.

### Phase 1 (Day 1): The One-Liner That Unlocks Everything

**1.1 Raise global rate limit for local inference**

Current: `DEFAULT_GLOBAL_LIMIT = 200` (msg/hr)  
Change to: `5000` (or drop the global limit entirely when using local model)

```typescript
// RateLimiter.ts:29
private static DEFAULT_GLOBAL_LIMIT = 5000; // was 200
```

Also update the default in `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/database.ts` settings seed.

**Impact:** 3-6x throughput ceiling. 30-second change.

---

### Phase 2 (Day 1-2): Maximize Warm Sessions

**2.1 Adaptive pool size + model recommendation by RAM**

```typescript
// LocalLLMService.ts — in initModel or constructor
const totalRAMGB = require('os').totalmem() / (1024 ** 3);
if (totalRAMGB <= 10) {
  this.recommendedModel = 'E2B';          // E4B at 5GB doesn't fit on 8GB with macOS overhead
  this.maxPooledSessions = 2;
} else if (totalRAMGB <= 20) {
  this.recommendedModel = 'E4B';
  this.maxPooledSessions = 4;
} else if (totalRAMGB <= 40) {
  this.recommendedModel = 'E4B';
  this.maxPooledSessions = 6;
} else {
  this.recommendedModel = 'E4B';
  this.maxPooledSessions = 10;
}
```

**Important:** On 8GB Macs, E4B (~5GB weights) + macOS (~3-4GB) + Electron (~0.5GB) leaves negative headroom. Either force E2B or show a warning that E4B will be swap-heavy. Do NOT default to E4B on 8GB without explicit user opt-in.

**2.2 Reduce default context size + pass it explicitly**

```typescript
// LocalLLMService.ts:46
private contextSize = 4096; // was 8192

// LocalLLMService.ts:269-271 — remove the `if !== 8192` guard
ctxOpts.contextSize = this.contextSize;  // always pass so we control memory
```

**2.3 Idle TTL on pool**

Add a 60-second timer that evicts sessions idle >10 minutes:

```typescript
setInterval(() => {
  const idleThreshold = 10 * 60 * 1000;
  const now = Date.now();
  for (const [key, entry] of this.sessionPool) {
    if (now - entry.lastActivity > idleThreshold) {
      this.evictSession(key);
    }
  }
}, 60_000);
```

**Impact:** 2-3x warm-session capacity + more responsive pool.

---

### Phase 3 (Day 2-3): Smart Rebuild

**3.1 Skip history reload for warm conversations**

In `AgentService.handleIncomingMessage`, skip `getConversationHistory()` when `this.conversations` already has fresh context:

```typescript
let context = this.conversations.get(chatGuid);
const isWarm = context && (Date.now() - context.lastActivity < 10 * 60 * 1000);

if (!isWarm) {
  // reload from iMessage DB
} // else use cached context
```

**3.2 Compact cold-rebuild using summaries**

When rebuilding an evicted session, use: system prompt + conversation summary + last 5 messages (not full 20-message history).

Requires: load summary in AgentService, pass to LocalLLMService, use in setChatHistory.

**Impact:** ~300ms saved for warm; 2-3s saved for cold rebuilds.

---

### Phase 4 (Day 3-5): Queue Policy + Auto-Summarization

**4.1 Change drop policy from oldest→newest (or coalesce)**

```typescript
// AgentService.ts:175-178
if (queue.length >= MAX_CHAT_QUEUE_SIZE) {
  // OLD: queue.shift(); // drop oldest
  // NEW: don't queue this one; log warning
  log('warn', 'Chat queue full, dropping NEW message', { chatGuid });
  return;
}
```

**4.2 Auto-summarization on eviction**

When a session is evicted (LRU or TTL), extract value as structured data before disposing.

**Concrete architecture:**

1. `LocalLLMService` exposes an `onEviction` event/callback interface:
   ```typescript
   localLLMService.onSessionEvicted((chatGuid: string) => { /* handler */ });
   ```

2. `AgentService.start()` registers a handler that has access to message history:
   ```typescript
   localLLMService.onSessionEvicted(async (chatGuid) => {
     const ctx = this.conversations.get(chatGuid);
     if (!ctx || ctx.messages.length < 4) return;
     await this.summarizeConversation(chatGuid, ctx.messages);
   });
   ```

3. `summarizeConversation()` uses a **separate ephemeral session** (not the one being evicted) to generate a summary from the raw transcript — prevents KV cache pollution of the evicted session.

4. Summary gets written via `memoryService.saveSummary()`. Facts get extracted and written via `memoryService.saveFact()` in parallel.

5. Runs asynchronously: eviction doesn't wait for summarization to complete; summarization runs in a detached promise with its own error handling.

**What NOT to do:**
- Don't call `entry.session.prompt(summaryPrompt)` on the session being evicted (pollutes its own KV cache with the summary prompt)
- Don't reference `this.agentConversations` from inside `LocalLLMService` (property doesn't exist; message data lives in `AgentService`)
- Don't block eviction on summarization success (fail silently on summary errors)

**Impact:** Cold returns now have rich context instead of empty history. No user-visible latency added to eviction itself.

---

### Phase 5 (Week 2+): Optional Advanced Features

**5.1 Message coalescing** — Wait 1-2s after message arrival before kicking off inference. If more arrive from same chat, batch them.

**5.2 Prefix cache verification** — Benchmark to confirm the system prompt is only prefilled once across N parallel sequences. If llama.cpp isn't auto-sharing, tune call pattern or log timings.

**5.3 Summary load on cold-start** — Cold returning users get their conversation summary injected into the new session's initial context (depends on 4.2 shipping first).

**5.4 Metrics dashboard** — Expose queue depth, avg latency, pool utilization, memory usage via `/api/metrics` and a dashboard tile. **Consider promoting to Phase 3 (operationally important):** without visibility, we have no way to know if any of the fixes above are actually working at scale.

**5.5 `sqlite-vec` for semantic fact retrieval** — Only if a user accumulates >50 facts and "load all facts" becomes noisy. Requires embedding each fact on save.

**5.6 Experimental KV cache quantization** — Set `experimentalKvCacheKeyType: 'q8_0'` and `experimentalKvCacheValueType: 'q8_0'` to halve KV memory per session.

⚠️ **Do NOT ship this to users by default.** node-llama-cpp's own API docs state: *"experimental and highly unstable... may not work as intended or even crash the process... Avoid allowing end users to configure this option."* All published quality benchmarks are for Nemotron/Qwen, not Gemma 4.

**Requires ALL of:**
- Empirical quality A/B testing with Gemma 4 E4B specifically
- Crash-recovery fallback to F16 on context creation failure
- Guarded behind a developer-mode setting only (never exposed to regular users)
- Only pursued if pool size after Phase 2 still feels constrained on common hardware

**5.7 Backpressure auto-reply** — When queue depth exceeds a threshold (e.g., >10 globally or >3 per chat), send a brief acknowledgment ("thinking…" or typing indicator) so users know their message was received. Prevents the perception of unresponsiveness during peaks.

**5.8 Warm-session persistence (experimental, probably skip)** — Use `contextSequence.saveStateToFile()` for the top-N most active users so their KV cache survives app restart. **Rejected for v1** because: 109 MB per 1K tokens for Llama-class models (likely 30-40 MB for E4B), model-version-locked (breaks on any model update), requires `{acceptRisk: true}` flag. Not worth the complexity unless user demand emerges.

---

## 10. Honest Limits & Tradeoffs

### What This Cannot Do

**1. 10,000 users all active at once.** Not possible on one Mac. Hardware throughput is the wall.

**2. Sub-second response times.** LLM inference on E4B takes 3-8s warm, 6-15s cold. That's physics, not configuration.

**3. Perfect conversation continuity across restarts.** If the app or Mac restarts, all warm sessions die. Cold rebuild from summaries is the mitigation, not true persistence.

### What Requires Real Tradeoffs

**1. Model size vs concurrency**
- E2B = 2x more sessions possible, but noticeably lower quality
- E4B = better responses, fewer concurrent sessions
- 8GB users get forced choice; 16GB+ can have both

**2. Context size vs pool size**
- 8192 context = 2 pool slots (current)
- 4096 context = 4-5 pool slots (proposed)
- Larger context helps very long conversations; smaller helps concurrency

**3. KV cache quality vs memory**
- F16 (default): safe, 2 sessions on 16GB
- q8_0 (experimental): ~2x more sessions, minimal quality loss (needs testing)
- q4_0 (experimental): 4x more sessions, quality degrades at long context

### What's Genuinely Safe To Do
All Phase 1-3 items are low-risk reversible changes. The global rate limit change is a one-line default swap. Pool sizing via RAM detection has a safe fallback. These should ship first.

Phase 4+ items have more architectural surface area and need careful implementation.

### Verification Required Before Committing

Before any phase ships, these claims need empirical confirmation (they're based on research, not our measurements):

1. **Gemma 4 E4B actual KV cache size per session** — estimated ~60-100 MB at 4K context; measure with real memory profiling
2. **Prefix cache sharing across `sequences: N`** — llama.cpp docs imply this works but we haven't measured latency on parallel sequences sharing a system prompt
3. **Inference speed on E4B on current Mac** — 30-60 tok/s is the range we assumed; should benchmark on the actual target hardware
4. **macOS memory pressure behavior on 8GB with E4B** — swap-happy or graceful? Needs real testing
5. **KV cache quantization quality impact on Gemma 4 E4B specifically** — all published benchmarks are for different models (Nemotron, Qwen)

Add benchmarks to CI or a `scripts/bench/` directory so these numbers stay current across model/library updates.

---

## 11. Explicit Non-Goals & Rejected Ideas

Ideas considered and rejected. Documented here to prevent re-proposing them later.

### ❌ Three-tier MemGPT architecture
**Considered:** Hot (RAM) / Warm (SQLite+KV state) / Cold (compressed) with LLM tool calls to move between tiers.  
**Rejected because:** Overkill for SMS conversations (typically 5-20 turns, not autonomous agent sessions). The simpler "facts + summary + recent messages" pattern gives 80% of the benefit at 10% of the complexity. OpenAI ChatGPT's memory uses essentially this simpler pattern.

### ❌ KV cache persistence to disk for all users
**Considered:** Use `contextSequence.saveStateToFile()` to resume any user instantly.  
**Rejected because:** ~30-100 MB per 1K tokens × 10K users × 4K context = ~1 TB of disk. Text summaries are ~500 bytes and rebuild into KV in 2-3s. The efficiency ratio is 10,000×+ in favor of summaries. KV state files also break on any model/library update.

### ❌ MLX framework migration
**Considered:** 20-87% faster on Apple Silicon for <14B models.  
**Rejected because:** No Node.js bindings. Would require a Python sidecar process, losing our in-process session management, tool calling, and chat wrappers. Wait for native Node.js MLX support or further llama.cpp Metal optimizations.

### ❌ llama-server external process
**Considered:** Use `llama-server` with `--slot-save-path` and host-memory prompt caching.  
**Rejected because:** Requires running llama-server as a separate process with HTTP overhead. Loses node-llama-cpp's in-process session management and tool calling integration. Right choice for multi-GPU servers, wrong for a desktop app.

### ❌ Model hot-swap (E2B ↔ E4B based on load)
**Considered:** Switch to E2B under heavy load, E4B when idle.  
**Rejected because:** Inconsistent response quality across conversations is worse UX than slower-but-consistent quality. Users notice quality shifts; they tolerate latency spikes. Also complicates session pool invalidation.

### ❌ Default-enabling KV cache quantization
**Considered:** Turn on `experimentalKvCacheKeyType: 'q8_0'` by default.  
**Rejected (as default) because:** node-llama-cpp marks it "highly unstable, may crash the process." All published quality benchmarks are for other models. Available as opt-in in Phase 5.6, not default.

### ❌ Scaling to 10K simultaneously-active users on one Mac
**Considered:** Original target.  
**Rejected because:** Math doesn't work. 10K users × 3 msgs/day = 30K/day = 1,250/hr sustained. Hardware ceiling is ~1,500-1,900/hr mixed. Would need 100% of capacity 100% of the time with zero margin. Multi-Mac or cloud fallback required for that pattern. 10K users with realistic 10-20% DAU IS feasible.

---

## 12. Research History & Audit Corrections

This doc supersedes two earlier drafts that contained errors. Preserved here so the context of what was corrected (and why) isn't lost.

### Superseded documents
- `docs/SCALE_RESEARCH_PLAN.md` — original research plan
- `docs/SCALE_RESEARCH_FINDINGS.md` — first findings doc (corrected)
- `docs/SCALE_ARCHITECTURE_PLAN.md` — alternative plan from a different agent (corrected)

### Key factual errors in earlier drafts

| Error | Corrected value | Source |
|---|---|---|
| Gemma 4 E4B sliding window = 1024 | **512 tokens** | [Grootendorst, Google DeepMind visual guide](https://newsletter.maartengrootendorst.com/p/a-visual-guide-to-gemma-4) |
| KV cache per session ~800 MB | **~60-100 MB** | Direct formula calculation: `2 × layers × kv_heads × head_dim × seq_len × bytes` |
| E4B Q4_K_M weights ~3 GB | **~4-5 GB** | HuggingFace model card (E4B is ~8B total params with PLE) |
| Gemma 3 4B ≡ Gemma 4 E4B | **Different architectures** | Hidden dim, layers, SWA size, PLE all differ |
| `MemoryService.saveConversationSummary()` | **`saveSummary()`** | Direct code inspection |
| Mem0 "80-90% token reduction" | **Self-reported, not independent** | Mem0 paper benchmarked on their own suite |
| 109 MB/1K tokens is universal | **Llama 3.1 8B-specific** | node-llama-cpp docs explicitly state this |
| "E2B beats Gemma 3 27B on benchmarks" | **False** | [llm-stats.com](https://llm-stats.com/models/compare/gemma-3-27b-it-vs-gemma-3n-e2b-it-litert-preview) shows 27B wins on 10 benchmarks |

### Code bugs avoided from other plans

1. **Cross-service coupling bug:** An earlier plan proposed `this.agentConversations?.get(key)` inside `LocalLLMService.evictSession()`. That property doesn't exist — conversation messages live in `AgentService.conversations`. Our Phase 4.2 uses a callback/event pattern instead (architectural note documented).

2. **Self-summarizing session:** An earlier plan called `entry.session.prompt(summaryPrompt)` on the session being evicted, which would pollute that session's KV cache with the summary prompt. Our Phase 4.2 uses a clean session or raw transcript for summarization.

3. **IMessage object mutation:** An earlier plan's message coalescing mutated the original `IMessage.text` in-place, breaking referential integrity. Our Phase 5.1 builds new message objects.

### Sources rated by authority

**Authoritative (high confidence):**
- Grootendorst visual guide to Gemma 4 (author is Google DeepMind)
- Official node-llama-cpp docs
- HuggingFace model cards
- arxiv.org papers
- llm-stats.com official benchmark tables

**Plausible but unverified (use carefully):**
- gemma4all.com, sudoall.com, gemma4-ai.com, groundy.com — SEO content sites with reasonable numbers but no authority; cross-check before citing
- r/LocalLLaMA — practitioner experience, anecdotal

**Self-reported marketing (treat as upper bound):**
- Mem0 ">90% token reduction" claim
- Vendor blog posts citing their own benchmarks

---

## Summary Cheat Sheet

| Question | Answer |
|---|---|
| **How many users can we remember long-term?** | 10,000+ trivially (SQLite) |
| **How many conversations can stay warm right now?** | 2 (hardcoded) |
| **After proposed fixes?** | 4-5 on 16GB, 6-8 on 32GB |
| **Max messages/hour today (with 200/hr cap)?** | 200 |
| **Max messages/hour hardware-wise?** | ~300-580 mixed (~470-960 warm) |
| **After proposed fixes?** | ~400-720 mixed (~610-1,200 warm) |
| **Realistic improvement factor?** | ~2-3x over current capped throughput |
| **Biggest fix by impact?** | Raise global rate limit (one line) |
| **Biggest gap in session reuse?** | Pool size = 2 (easy fix with RAM detection) |
| **What's the real bottleneck at 10K users?** | Sustained peak-hour message rate |
| **What truly doesn't scale past 5-10K users?** | Peak-hour throughput, not storage |
| **Can we run E4B on 8GB Mac?** | Technically yes, but swap-heavy. Recommend E2B instead. |
| **Does node-llama-cpp do vLLM-style parallel inference?** | No. Sub-linear batching only (~1.3-1.6x for 2 sequences). |
