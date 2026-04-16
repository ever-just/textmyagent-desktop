# Multi-Conversation Optimization Research Plan

> Created: Apr 16, 2026  
> Purpose: Evaluate whether the current architecture handles multiple simultaneous conversations optimally, and identify improvements based on best practices from node-llama-cpp, Vercel AI SDK, llama.cpp, and multi-agent system patterns.

---

## 1. Current Architecture Assessment

### What We Have Now

| Component | Current Implementation | Status |
|---|---|---|
| **Context management** | Single persistent `LlamaContext` with per-request `LlamaChatSession` | ✅ Good (after recent fix) |
| **Conversation isolation** | `Map<chatGuid, ConversationContext>` with message history per chat | ✅ Good |
| **Concurrency control** | Per-chat lock (`chatLocks: Set<string>`) — one message processed per chat at a time | ✅ Good |
| **Message queuing** | Per-chat FIFO queue (max 5 messages), overflow rejected | ✅ Good |
| **Parallel inference** | ❌ NOT supported — only 1 context sequence, so all chats serialize | ⚠️ Bottleneck |
| **Context reuse** | Session disposed per request, context reused across requests | ✅ Good (after recent fix) |
| **Conversation eviction** | TTL-based (1 hour) + LRU when >500 conversations | ✅ Good |
| **Message deduplication** | GUID-based dedup set | ✅ Good |

### Key Finding: Serialized Inference Is the Main Bottleneck

Currently, even if messages arrive from 5 different people simultaneously, they're processed **one at a time** because:
1. There's only **1 `LlamaContext`** with **1 sequence** (`context.getSequence()`)
2. Each message blocks the context during inference (15-60+ seconds)
3. The per-chat lock means other chats queue up behind the active inference

This means if Person A texts first and inference takes 30s, Person B waits 30s+ just for their inference to *start*.

---

## 2. Research Sources & Key Learnings

### 2a. node-llama-cpp: Multi-Sequence Batching

**Source:** [node-llama-cpp Batching Guide](https://node-llama-cpp.withcat.ai/guide/batching)

**Key insight:** A single `LlamaContext` can have **multiple sequences** that process in parallel via batched inference:

```typescript
const context = await model.createContext({ sequences: 2 });
const sequence1 = context.getSequence();
const sequence2 = context.getSequence();

// These run in PARALLEL via batching:
const [a1, a2] = await Promise.all([
  session1.prompt(q1),
  session2.prompt(q2)
]);
```

**Trade-offs:**
- Each sequence increases memory usage (KV cache is per-sequence)
- With 8192 context size and 2 sequences = ~8 GB KV cache needed
- Diminishing returns beyond 2-3 sequences on consumer GPUs (M1/M2/M3)
- Aborting one sequence doesn't affect others — they continue independently

**Recommendation for TextMyAgent:** Use `sequences: 2` to allow 2 concurrent inferences. This is the sweet spot for M-series Macs with 8-16 GB RAM — doubles throughput for multi-chat scenarios without overwhelming GPU memory.

### 2b. llama.cpp: Continuous Batching & KV Cache Sharing

**Source:** [llama.cpp Parallel Discussion #4130](https://github.com/ggml-org/llama.cpp/discussions/4130)

**Key insights:**
- `--parallel N` splits context into N slots, each handling a separate conversation
- KV cache is shared across parallel slots — common system prompt prefix is cached once
- With a shared system prompt (our ~970 tokens), the first evaluation of each new session can reuse the cached KV state for those tokens
- The total context size should be `N * max_per_conversation_tokens`

**Relevance:** Our system prompt is identical across all conversations. This means with multi-sequence support, the system prompt KV cache entries are computed once and shared, saving significant work for each new conversation.

### 2c. Vercel AI SDK v6: Agent Architecture Patterns

**Source:** [Vercel AI SDK 6 Blog Post](https://vercel.com/blog/ai-sdk-6)

**Key patterns applicable to our architecture:**

1. **ToolLoopAgent** — Handles the complete tool execution loop: call LLM → execute tools → feed results back → repeat. This is essentially what our `LocalLLMService.generateResponse()` already does with the `maxToolLoops` parameter.

2. **Call Options with prepareCall** — Per-request customization (user ID, account type) injected into the system prompt. Our `PromptBuilder` already does this with `contactName`, `userFacts`, `chatType`.

3. **DurableAgent (Workflow DevKit)** — Each tool execution becomes a retryable, observable step. Useful for reliability. We partially have this with our retry mechanism but could formalize it.

4. **Key difference:** Vercel AI SDK targets cloud APIs (fast, parallelizable by nature). Our bottleneck is fundamentally different — single local GPU. Their patterns for prompt composition and tool loops are applicable, but their concurrency model assumes cloud-scale parallel inference which we don't have.

### 2d. Multi-Tenant Agent Patterns

**Sources:** Various enterprise agent architecture guides

**Applicable patterns:**
1. **Per-user namespace isolation** — We already do this: `conversations Map` keyed by `chatGuid`, `user_facts` keyed by `userHandle`
2. **FIFO queuing with backpressure** — We already do this: `chatQueues` with `MAX_CHAT_QUEUE_SIZE = 5`
3. **Priority queuing** — NOT implemented. Could prioritize allowlisted contacts over everyone
4. **Circuit breaker for inference** — Partially implemented via our 90s timeout + context recycling
5. **Message coalescing** — NOT implemented. If a user sends 3 rapid messages, we could batch them into a single LLM call

---

## 3. Optimization Plan (Ranked by Impact)

### 🔴 High Impact

#### 3.1 Enable Multi-Sequence Parallel Inference
**What:** Create context with `sequences: 2` instead of `sequences: 1` (default). Maintain a pool of 2 sequences, dispatching incoming messages to the first available.

**Expected impact:** 2x throughput for multi-user scenarios (Person A and Person B get responses simultaneously instead of serialized).

**Memory cost:** ~2-4 GB additional KV cache for the second sequence (depends on context size).

**Risk:** Low. node-llama-cpp handles batching automatically. If GPU memory is insufficient, it falls back gracefully.

**Implementation:**
```
1. LocalLLMService: createContext({ sequences: 2 })
2. Maintain a sequence pool (array of sequences with availability flags)
3. generateResponse() acquires a sequence, runs inference, releases it
4. If no sequence available, queue the request (already handled by chatLocks)
```

#### 3.2 Message Coalescing for Rapid-Fire Messages
**What:** If a user sends multiple messages within a short window (e.g., 2 seconds), merge them into a single inference call instead of processing each separately.

**Expected impact:** Reduces redundant inference calls. Common pattern in texting: "Hey" → "Quick question" → "How do I..." — these should be one LLM call, not three.

**Implementation:**
```
1. On new message, start a 2-second coalescing timer per chat
2. If more messages arrive before timer fires, append to buffer
3. When timer fires, combine all buffered messages into one
4. User sees: "Hey\nQuick question\nHow do I..." as a single input
```

### 🟡 Medium Impact

#### 3.3 Priority Queue for Allowlisted Contacts
**What:** When using allowlist mode, give priority to allowlisted contacts when the inference queue is full.

**Expected impact:** Ensures VIP contacts get faster responses during high-traffic periods.

#### 3.4 Persistent Session State (KV Cache Save/Restore)
**What:** node-llama-cpp supports saving/restoring context sequence state to disk. For frequent contacts, save the KV cache state after each conversation so the next message from that contact doesn't need to re-process the entire history.

**Expected impact:** Could save 5-15 seconds per message for returning contacts. The system prompt + conversation history is already in the cached KV state.

**Complexity:** High. Requires managing serialized state files per contact.

### 🟢 Low Impact (Already Good)

#### 3.5 Conversation Context Management ✅
Already well-implemented with TTL eviction, LRU overflow, and per-chat isolation.

#### 3.6 Tool Loop Architecture ✅
Already matches Vercel AI SDK's ToolLoopAgent pattern with bounded tool calls.

---

## 4. Comparison: Our Architecture vs. Best Practices

| Best Practice | Our Status | Gap |
|---|---|---|
| Per-conversation context isolation | ✅ Done | None |
| Message deduplication | ✅ Done | None |
| Per-chat concurrency lock | ✅ Done | None |
| Configurable tool loop bounds | ✅ Done (maxApiCallsPerMessage) | None |
| Inference timeout + retry | ✅ Done (90s timeout + 1 retry) | None |
| Persistent context reuse | ✅ Done | None |
| Multi-sequence parallel inference | ❌ Missing | **Critical** |
| Message coalescing | ❌ Missing | Medium |
| Priority queuing | ❌ Missing | Low |
| KV cache persistence | ❌ Missing | Low (complex) |
| System prompt cache sharing | 🟡 Implicit | Unlocked by multi-sequence |

---

## 5. Recommended Next Steps

1. **Implement multi-sequence context (3.1)** — Biggest single improvement for multi-user. Low risk, moderate effort.
2. **Implement message coalescing (3.2)** — Quick win for better UX with rapid-fire texters.
3. **Priority queuing (3.3)** — Only if users report slowness with many contacts.
4. **KV cache persistence (3.4)** — Explore in a later phase; high complexity.

---

## 6. Sources

- [node-llama-cpp Batching Guide](https://node-llama-cpp.withcat.ai/guide/batching)
- [node-llama-cpp Chat Session Guide](https://node-llama-cpp.withcat.ai/guide/chat-session)
- [node-llama-cpp LlamaContextOptions](https://node-llama-cpp.withcat.ai/api/type-aliases/LlamaContextOptions)
- [llama.cpp Parallel Discussion #4130](https://github.com/ggml-org/llama.cpp/discussions/4130)
- [llama.cpp KV Cache Persistence #8860](https://github.com/ggml-org/llama.cpp/discussions/8860)
- [Vercel AI SDK 6 Blog](https://vercel.com/blog/ai-sdk-6)
- [Vercel AI SDK Agents Documentation](https://vercel.com/kb/guide/how-to-build-ai-agents-with-vercel-and-the-ai-sdk)
- [Multi-Tenant AI Agent Infrastructure](https://medium.com/@vamshidhar.pandrapagada/how-to-deploy-multi-tenant-ai-agent-infrastructure-that-actually-scales-433f44515837)
- [Azure AI Agent Orchestration Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns)
- [Agent Memory: Persistent Q4 KV Cache (arxiv)](https://arxiv.org/html/2603.04428v1)
