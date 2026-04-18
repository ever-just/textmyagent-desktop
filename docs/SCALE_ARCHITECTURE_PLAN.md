# TextMyAgent Scale Architecture Plan

> **Author:** Independent research audit — replaces `SCALE_RESEARCH_FINDINGS.md`  
> **Date:** April 2026  
> **Target:** 10,000 users, 100 conversations/hour, single Mac  

## Implementation Status (v2.5.0)

| Phase | Status | Ships in |
|-------|--------|----------|
| 1A — Adaptive pool sizing by RAM | ✅ | v2.4.0 |
| 1B — Idle session TTL (10 min) | ✅ | v2.4.0 |
| 1C — Prompt section ordering lock + test | ✅ | **v2.5.0** |
| 2A — Eviction hook (`onSessionEvicted`) | ✅ | v2.4.0 |
| 2B — `generateSummary()` (ephemeral session) | ✅ | v2.4.0 |
| 2C — Fact extraction piggyback on eviction | ✅ | **v2.5.0** |
| 2D — Cold-start summary recall | ✅ | v2.4.0 |
| 3A — Global priority queue | ❌ skipped (per-chat design is correct per §3.4) |
| 3B — Message coalescing on queue drain | ✅ | **v2.5.0** |
| 3C — `/api/dashboard/metrics` endpoint | ✅ | v2.4.0 |
| 4 — Advanced (sqlite-vec, hot-swap, …) | ⏸ deferred |

---

## 1. Executive Summary

The previous Codex-generated plan proposed a three-tier MemGPT-style architecture with KV cache persistence to disk. That approach solves the **wrong problem**. 

The real bottleneck for TextMyAgent is **serial inference throughput** — not RAM. Messages are processed one at a time through a single LLM. No amount of tiered memory changes this fundamental constraint.

This plan proposes a simpler, more effective architecture based on:
1. **Compressed context reconstruction** (facts + summaries, not KV cache dumps)
2. **Adaptive resource sizing** (model and pool sized to actual hardware)
3. **Queue-aware processing** (accept that iMessage is async, design for it)
4. **Auto-summarization on eviction** (extract value before discarding sessions)

**Key corrections from previous plan:**
- Gemma 4 E4B weighs **~5 GB at Q4**, not ~3 GB — 8 GB Macs can't comfortably run it
- E4B sliding window is **512 tokens**, not 1024
- KV cache per session is **~60-120 MB**, not ~800 MB
- KV cache save to disk is **109 MB per 1K tokens** — absurdly expensive vs ~500 bytes for a text summary
- KV cache quantization is marked **"highly unstable"** in node-llama-cpp — not production-ready

---

## 2. The Real Bottleneck Analysis

### 2.1 It's Serial Inference, Not RAM

TextMyAgent processes messages through this pipeline:

```
iMessage poll (2s) → chat lock → build context → LLM prefill → LLM generate → format → send via AppleScript
```

Only ONE message generates at a time. Response latency per message:

| Scenario | Prefill | Generation | Total |
|----------|---------|------------|-------|
| Hot session (in pool) | ~0s (cached) | ~3-8s | **3-8s** |
| Warm (summary exists) | ~1-3s (3-4K tokens) | ~3-8s | **4-11s** |
| Cold (no history) | ~2-5s (system prompt only) | ~3-8s | **5-13s** |

Maximum throughput (all hot): **720 msg/hr**. Realistic mix: **~240-480 msg/hr**.

### 2.2 Message Arrival Pattern

10K users sending 2-5 messages/day:

```
Daily:     20K-50K messages
Hourly avg: 833-2083 messages  
Peak hour:  ~2-5x average = 1666-10K messages
```

At ~300 msg/hr capacity, peak hour WILL queue. This is **fine for iMessage** — people don't expect instant text replies. A 30s-2min delay during peaks feels natural.

### 2.3 RAM Budget (Corrected)

Sources: [gemma4all.com hardware guide](https://gemma4all.com/blog/gemma-4-hardware-requirements), [HuggingFace Gemma 4 E4B](https://huggingface.co/google/gemma-4-E4B), [sudoall.com benchmarks](https://sudoall.com/gemma-4-31b-apple-silicon-local-guide/)

| Component | 8 GB Mac | 16 GB Mac | 32 GB Mac |
|-----------|----------|-----------|-----------|
| macOS + apps | 3-4 GB | 3-4 GB | 3-4 GB |
| **Model: E2B Q4** | **~3.2 GB** | — | — |
| **Model: E4B Q4** | ⚠️ ~5 GB | **~5 GB** | **~5 GB** |
| Model: 26B A4B Q4 | ❌ | ⚠️ ~15.6 GB | ✅ ~15.6 GB |
| KV per session (~4K ctx) | ~60-120 MB | ~60-120 MB | ~60-120 MB |
| Session pool capacity | 1 (E2B) | 3-4 (E4B) | 5-8 (E4B) |
| Electron + Node | ~0.5 GB | ~0.5 GB | ~0.5 GB |
| **Headroom** | **~0.3-1.3 GB** | **~5-7 GB** | **~21-23 GB** |

> **8 GB verdict:** Use E2B (3.2 GB). E4B at 5 GB leaves no headroom — macOS will swap heavily.  
> **16 GB verdict:** E4B fits comfortably with 3-4 hot sessions. This is the target hardware.  
> **32 GB verdict:** E4B with large pool, or 26B A4B for quality leap.

---

## 3. What Already Works (Don't Over-Engineer)

The current codebase already implements most of what's needed. Before adding complexity, recognize what's already solid:

### 3.1 Session Pool with LRU Eviction ✅
```typescript
// LocalLLMService.ts — already implemented
private sessionPool: Map<string, SessionPoolEntry> = new Map();
private maxPooledSessions = 2;
// LRU eviction on pool full — works correctly
```

### 3.2 User Facts in SQLite ✅
```typescript
// MemoryService.ts — already extracts and stores user facts
saveFact(userId, content, type, source, confidence)
getUserFacts(userId, type)  // with expiration filtering
expireOldFacts()            // periodic cleanup
```

### 3.3 Conversation Summaries Schema ✅
```typescript
// MemoryService.ts — schema exists, manual save works
saveSummary(conversationId, summary, messageRangeStart, messageRangeEnd)
getConversationSummaries(conversationId)
```

### 3.4 Per-Chat Concurrency Control ✅
```typescript
// AgentService.ts — per-chat lock + queue (max 5)
private chatLocks: Set<string> = new Set();
private chatQueues: Map<string, IMessage[]> = new Map();
```

### 3.5 Stale Context Filtering ✅
```typescript
// AgentService.ts — only loads messages from last 30 minutes
const staleThresholdMs = 30 * 60 * 1000;
```

### 3.6 Prompt Caching Readiness ✅
```typescript
// PromptBuilder.ts — already marks static sections as cacheable
sections.push({ tag: 'IDENTITY', content: ..., cacheable: true });
// node-llama-cpp auto-reuses KV cache for matching prefixes
```

---

## 4. The Plan: Four Phases

### Phase 1: Adaptive Resource Sizing (1-2 days)

**Goal:** Right-size model and session pool to actual hardware.

#### 1A. Auto-detect RAM and set defaults

```typescript
// In LocalLLMService initialization
const totalRAM = os.totalmem() / (1024 ** 3); // GB
if (totalRAM <= 10) {
  this.recommendedModel = 'E2B';
  this.maxPooledSessions = 1;
} else if (totalRAM <= 20) {
  this.recommendedModel = 'E4B';
  this.maxPooledSessions = 3;
} else {
  this.recommendedModel = 'E4B'; // or suggest 26B A4B
  this.maxPooledSessions = 5;
}
```

#### 1B. Idle session TTL

Currently sessions only leave via LRU eviction. Add a 10-minute idle TTL:

```typescript
// Add to a periodic timer (every 60s)
cleanIdleSessions() {
  const idleThreshold = 10 * 60 * 1000; // 10 minutes
  const now = Date.now();
  for (const [key, entry] of this.sessionPool) {
    if (now - entry.lastActivity > idleThreshold) {
      this.evictSession(key, 'idle_ttl');
    }
  }
}
```

#### 1C. Prompt ordering lock

Verify that `PromptBuilder.build()` always emits static (cacheable) sections before dynamic sections. The current code already does this — just add a comment and test to prevent regression.

**Files changed:** `LocalLLMService.ts`, `PromptBuilder.ts`  
**Tests:** Verify pool sizing per RAM tier, idle TTL eviction, prompt section ordering

---

### Phase 2: Auto-Summarization on Eviction (2-3 days)

**Goal:** When a session leaves the pool, extract its value as a compressed summary.

This is the single highest-impact feature. It turns every evicted conversation into reusable context for the next interaction.

#### 2A. Eviction hook

```typescript
private async evictSession(key: string, reason: string) {
  const entry = this.sessionPool.get(key);
  if (!entry) return;
  
  // Summarize if conversation had meaningful turns
  const conversationContext = this.agentConversations?.get(key);
  if (conversationContext && conversationContext.messages.length >= 4) {
    await this.summarizeBeforeEviction(entry, conversationContext);
  }
  
  try { entry.session?.dispose?.(); } catch {}
  this.sessionPool.delete(key);
  log('debug', `Session evicted (${reason})`, { key, poolSize: this.sessionPool.size });
}
```

#### 2B. Summarization prompt

Use the existing model to generate a summary BEFORE disposing the session:

```typescript
private async summarizeBeforeEviction(entry: SessionPoolEntry, context: ConversationContext) {
  try {
    const messages = context.messages.slice(-20); // Last 20 turns
    const transcript = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    
    const summaryPrompt = 
      `Summarize this conversation in 2-3 sentences. Include: key topics discussed, ` +
      `any commitments or action items, and notable preferences or facts about the user.\n\n` +
      `Conversation:\n${transcript}`;
    
    // Use a lightweight prompt call (no tools, short response)
    const result = await entry.session.prompt(summaryPrompt, { maxTokens: 200 });
    
    if (result && result.trim().length > 20) {
      memoryService.saveSummary(context.chatGuid, result.trim());
      log('info', 'Auto-summary saved on eviction', { chatGuid: context.chatGuid });
    }
  } catch (err) {
    log('warn', 'Auto-summarization failed', { error: (err as Error).message });
    // Non-fatal — session eviction continues regardless
  }
}
```

#### 2C. Fact extraction (piggyback on summarization)

```typescript
// After summarization, also extract facts
const factPrompt = 
  `From this conversation, extract personal facts about the user as a JSON array ` +
  `of strings. Only include concrete facts (name, preferences, job, family, etc). ` +
  `Return [] if no new facts.\n\n${transcript}`;

const factsResult = await entry.session.prompt(factPrompt, { maxTokens: 300 });
// Parse and save each fact via memoryService.saveFact()
```

#### 2D. Load summary for cold sessions

In `AgentService.handleIncomingMessage`, when creating a new context and no hot session exists:

```typescript
// Load latest conversation summary for cold-start context
let conversationSummary: string | undefined;
if (conversation) {
  const summaries = memoryService.getConversationSummaries(conversation.id);
  if (summaries.length > 0) {
    conversationSummary = summaries[0].summary; // Most recent
  }
}

// Pass to PromptBuilder via promptContext
const response = await localLLMService.generateResponse(
  message.text,
  context.messages.slice(0, -1),
  undefined,
  { date: dateContext, contactName, userFacts, chatType, conversationSummary },
  { userId: userHandle, chatGuid }
);
```

**Files changed:** `LocalLLMService.ts`, `AgentService.ts`, `MemoryService.ts`  
**Tests:** Verify summary generation on eviction, fact extraction, cold-start with summary

---

### Phase 3: Smart Queue & Metrics (1-2 days)

**Goal:** Handle traffic spikes gracefully with visibility.

#### 3A. Global priority queue

Replace per-chat queues with a global queue sorted by wait time:

```typescript
interface QueuedMessage {
  message: IMessage;
  enqueuedAt: number;
  priority: number; // higher = process sooner
}

private messageQueue: QueuedMessage[] = [];
private readonly MAX_QUEUE_DEPTH = 50;

private enqueue(message: IMessage) {
  if (this.messageQueue.length >= this.MAX_QUEUE_DEPTH) {
    // Drop oldest lowest-priority message
    this.messageQueue.sort((a, b) => a.priority - b.priority);
    this.messageQueue.shift();
  }
  
  const priority = this.calculatePriority(message);
  this.messageQueue.push({ message, enqueuedAt: Date.now(), priority });
  this.messageQueue.sort((a, b) => b.priority - a.priority);
}
```

#### 3B. Message coalescing

If a user sends 3 messages before getting a response, combine them:

```typescript
// Before dequeuing, check if same user has multiple pending messages
private coalesceUserMessages(chatGuid: string): IMessage {
  const userMsgs = this.messageQueue.filter(q => q.message.chatGuid === chatGuid);
  if (userMsgs.length <= 1) return userMsgs[0].message;
  
  // Combine into single message
  const combined = userMsgs.map(q => q.message.text).join('\n');
  const latest = userMsgs[userMsgs.length - 1].message;
  latest.text = combined;
  
  // Remove all but the combined one from queue
  this.messageQueue = this.messageQueue.filter(q => 
    q.message.chatGuid !== chatGuid || q === userMsgs[userMsgs.length - 1]
  );
  
  return latest;
}
```

#### 3C. Dashboard metrics

Expose via API and dashboard:
- Queue depth (current)
- Average response latency (last 100 messages)
- Messages processed per hour
- Session pool utilization
- Memory usage (model + KV cache)

```typescript
// New endpoint: GET /api/metrics
{
  queueDepth: number,
  avgLatencyMs: number,
  p95LatencyMs: number,
  messagesPerHour: number,
  poolUtilization: { used: number, max: number },
  memoryMB: { model: number, kvCache: number, system: number }
}
```

**Files changed:** `AgentService.ts`, `dashboard.ts` (routes), dashboard components  
**Tests:** Queue priority ordering, message coalescing, metric accuracy

---

### Phase 4: Advanced (Optional, 3-5 days)

Only pursue these after Phases 1-3 are proven in production:

#### 4A. sqlite-vec for semantic fact retrieval
When a user accumulates 50+ facts, basic "load all facts" becomes noisy. Use sqlite-vec to embed facts and retrieve only the most relevant ones for the current message.

**Prerequisites:** `npm install sqlite-vec`, generate embeddings using the LLM's token embeddings or a lightweight embedding model.

#### 4B. Rolling summary condensation
When a conversation has multiple summaries (long-running relationship), periodically condense them into a single "relationship summary" that captures the full history.

#### 4C. Backpressure auto-reply
If queue depth exceeds a threshold (configurable), automatically send a brief "thinking..." acknowledgment so the user knows they're being heard.

#### 4D. Model hot-swap
Allow switching between E2B (fast, lower quality) and E4B (slower, higher quality) based on current load. Under heavy load, switch to E2B for throughput. When idle, use E4B for quality.

---

## 5. What NOT To Build (and Why)

### ❌ KV Cache Persistence to Disk
- 109 MB per 1K tokens (confirmed from [node-llama-cpp docs](https://node-llama-cpp.withcat.ai/guide/chat-session))
- A text summary of the same conversation: ~500 bytes
- That's **218,000x** more efficient for compressed context
- Risk of model mismatch crashes on restore
- `saveStateToFile` requires `{acceptRisk: true}` parameter — the API itself warns you

### ❌ KV Cache Quantization (experimentalKvCacheKeyType)
- Marked **"highly unstable"** in [node-llama-cpp API docs](https://node-llama-cpp.withcat.ai/api/type-aliases/LlamaContextOptions)
- "May not work as intended or even crash the process"
- "Avoid allowing end users to configure this option"
- KV cache for E4B at 4K context is only ~60-120 MB anyway — savings minimal

### ❌ Three-Tier MemGPT Architecture  
- Overkill for iMessage agent conversations (typically 5-20 turns)
- MemGPT designed for autonomous agents running continuously, not request-response
- The simple "facts + summary + recent messages" approach gives 80% of the benefit at 10% complexity
- OpenAI ChatGPT's memory uses essentially this simpler pattern

### ❌ MLX Migration
- 20-87% faster on Apple Silicon for <14B models ([Groundy benchmarks](https://groundy.com/articles/mlx-vs-llamacpp-on-apple-silicon-which-runtime-to-use-for-local-llm-inference/))
- But NO Node.js bindings — would require Python sidecar process
- Would lose all node-llama-cpp integration (session management, tool calling, chat wrappers)
- Wait for Node.js MLX bindings or official llama.cpp Metal optimizations

### ❌ llama-server with --slot-save-path
- The [llama-server approach](https://github.com/ggml-org/llama.cpp/discussions/20572) requires running llama-server as a separate process
- Loses node-llama-cpp's in-process session management
- Adds HTTP overhead and deployment complexity
- Would be right if we were running a multi-GPU server, but we're running a desktop app

---

## 6. Capacity Projections (Evidence-Based)

### Sources
- E4B speed: 40-60+ tok/s on 16GB Mac ([sudoall.com](https://sudoall.com/gemma-4-31b-apple-silicon-local-guide/))
- E2B speed: ~30 tok/s on phone, faster on Mac ([gemma4-ai.com](https://gemma4-ai.com/blog/gemma4-e2b-vs-e4b))
- E4B model size: ~5 GB at Q4 ([gemma4all.com](https://gemma4all.com/blog/gemma-4-hardware-requirements))
- E2B model size: ~3.2 GB at Q4 ([gemma4all.com](https://gemma4all.com/blog/gemma-4-hardware-requirements))

### Response Time Breakdown

| Phase | Hot (in pool) | Warm (summary) | Cold (new user) |
|-------|--------------|----------------|-----------------|
| Prefill | 0s | 1-3s | 2-5s |
| Generation (100 tokens) | 2-3s | 2-3s | 2-3s |
| Tool calls (if any) | 0-5s | 0-5s | 0-5s |
| **Total** | **2-8s** | **3-11s** | **4-13s** |

### Throughput by Hardware

| Hardware | Model | Hot msg/hr | Mixed msg/hr | Max daily users |
|----------|-------|-----------|-------------|-----------------|
| 8 GB Mac | E2B | ~720 | ~400 | ~3,200 |
| 16 GB Mac | E4B | ~450 | ~300 | ~2,400 |
| 32 GB Mac | E4B | ~450 | ~320 | ~2,500 |
| 32 GB Mac | 26B A4B | ~300 | ~200 | ~1,600 |

> **To reach 10K users at 3 msg/day (30K messages), a 16 GB Mac needs ~100 effective hours of processing daily.** That's more than 24 hours — meaning sustained peak is **not possible on a single Mac at 10K users**.

### Realistic Scale Targets

| Hardware | Comfortable max users | Stretch max users |
|----------|----------------------|-------------------|
| 8 GB Mac (E2B) | 1,500 | 3,000 |
| 16 GB Mac (E4B) | 2,000 | 4,000 |
| 32 GB Mac (E4B) | 2,500 | 5,000 |
| Mac Studio 64GB (26B) | 3,000 | 6,000 |

> **10K users on a single Mac is not feasible with on-device inference.** The path to 10K requires either:
> 1. Multiple Mac instances with load balancing
> 2. Cloud LLM fallback for overflow (Gemini API, etc.)
> 3. Accepting much longer response times (5-15 min during peaks)
> 4. Reducing message volume (e.g., daily digest mode)

---

## 7. Implementation Priority Matrix

| Task | Impact | Effort | Priority |
|------|--------|--------|----------|
| Adaptive pool sizing by RAM | High | 2-4 hrs | **P0** |
| Idle session TTL | Medium | 1-2 hrs | **P0** |
| Auto-summarization on eviction | High | 4-8 hrs | **P1** |
| Fact extraction on eviction | Medium | 2-4 hrs | **P1** |
| Load summaries for cold-start | High | 2-3 hrs | **P1** |
| Adaptive model selection by RAM | Medium | 2-3 hrs | **P1** |
| Queue metrics dashboard | Medium | 4-6 hrs | **P2** |
| Message coalescing | Low | 2-3 hrs | **P2** |
| sqlite-vec for facts | Low | 8-12 hrs | **P3** |
| Backpressure auto-reply | Low | 2-3 hrs | **P3** |

**Total estimated effort for P0+P1: 2-3 days**

---

## 8. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Auto-summarization slows eviction | Medium | Low | Run async, don't block new session creation |
| Summary quality is poor | Medium | Medium | Test with real conversations, tune prompt |
| E2B quality too low for agent tasks | Low | High | E2B beats Gemma 3 27B on benchmarks — likely sufficient |
| macOS memory pressure kills process | Medium (8GB) | High | Auto-detect RAM, warn user, default to E2B |
| Queue grows unbounded during peaks | High | Medium | Max queue depth + oldest-first drop policy |

---

## Appendix A: Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    TextMyAgent Desktop                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  iMessage DB ──poll(2s)──► AgentService                          │
│                              │                                   │
│                              ├─ Rate limiter                     │
│                              ├─ Chat lock (per-conversation)     │
│                              ├─ Load user facts (SQLite)         │
│                              ├─ Load conversation summary        │
│                              │                                   │
│                              ▼                                   │
│                         PromptBuilder                            │
│                     [Static prefix cached]                       │
│                     [+ dynamic: facts, summary, contact]         │
│                              │                                   │
│                              ▼                                   │
│                     LocalLLMService                              │
│                    ┌──────────────────┐                          │
│                    │  Session Pool    │                           │
│                    │  (1-5 by RAM)    │                           │
│                    │  [LRU + idle TTL]│                           │
│                    └──────┬───────────┘                           │
│                           │                                      │
│                    On eviction:                                   │
│                    ├─ Summarize conversation                     │
│                    ├─ Extract user facts                         │
│                    └─ Dispose session                            │
│                                                                  │
│  ┌─────────── SQLite (better-sqlite3) ──────────────┐           │
│  │  users │ conversations │ messages │ user_facts │  │           │
│  │  conversation_summaries │ settings │ api_usage │  │           │
│  └──────────────────────────────────────────────────┘           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Appendix B: Sources

1. **Gemma 4 E4B hardware requirements** — [gemma4all.com](https://gemma4all.com/blog/gemma-4-hardware-requirements) — "plan for roughly 7-8 GB of available GPU memory or unified memory" for E4B
2. **Gemma 4 on Apple Silicon benchmarks** — [sudoall.com](https://sudoall.com/gemma-4-31b-apple-silicon-local-guide/) — E4B: "40-60+ tokens per second on 16GB Mac"
3. **E2B vs E4B comparison** — [gemma4-ai.com](https://gemma4-ai.com/blog/gemma4-e2b-vs-e4b) — "12 points gap on average benchmarks"
4. **Gemma 4 architecture (PLE, SWA)** — [Visual Guide by Maarten Grootendorst (Google DeepMind)](https://newsletter.maartengrootendorst.com/p/a-visual-guide-to-gemma-4) — "E4B has sliding window of 512 tokens"
5. **HuggingFace Gemma 4 E4B** — [huggingface.co/google/gemma-4-E4B](https://huggingface.co/google/gemma-4-E4B) — "8B total params, uses PLE"
6. **node-llama-cpp KV cache quantization** — [API docs](https://node-llama-cpp.withcat.ai/api/type-aliases/LlamaContextOptions) — "highly unstable, may crash the process"
7. **node-llama-cpp state save/restore** — [Chat session guide](https://node-llama-cpp.withcat.ai/guide/chat-session) — "109MB for only 1K tokens"
8. **MLX vs llama.cpp benchmarks** — [Groundy.com](https://groundy.com/articles/mlx-vs-llamacpp-on-apple-silicon-which-runtime-to-use-for-local-llm-inference/) — "MLX leads by 20-87% for models under 14B"
9. **llama-server host-memory prompt caching** — [GitHub Discussion #20574](https://github.com/ggml-org/llama.cpp/discussions/20574) — "93% reduction in TTFT for cached requests"
10. **LLM memory design patterns** — [Serokell blog](https://serokell.io/blog/design-patterns-for-long-term-memory-in-llm-powered-architectures) — Comparison of MemGPT, OpenAI, Claude, and toolkit approaches
