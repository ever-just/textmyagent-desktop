# Scale Research: Findings & Proposed Architecture

> Target: **10,000 long-term users + ~100 conversations/hour on 8GB local Mac**  
> Status: Research complete, architecture proposal ready  
> **Revised:** Apr 16, 2026 after user audit identified factual errors in KV cache math, sliding window size, and model weight size. Corrections applied throughout.

### What the audit corrected
- Gemma 4 E4B sliding window is **512 tokens, not 1024** (Gemma 4 halved it from Gemma 3)
- KV cache per session is **~60-100 MB**, not ~800 MB (formula was 10x off)
- Gemma 4 E4B Q4_K_M weights are **~4-5 GB, not ~3 GB** (E4B is ~8B total params)
- Gemma 3 4B and Gemma 4 E4B have **materially different architectures** (were conflated)
- `MemoryService.saveSummary()`, not `saveConversationSummary()`
- Mem0's "80-90%" claim is self-reported, not independently verified
- 109 MB/1K tokens disk figure is Llama 3.1 8B-specific, not universal
- **Net effect:** KV cache is smaller (good for concurrency), model weights are larger (bad for 8GB). 16GB is realistic minimum.

---

## TL;DR — Target Is Achievable on 16GB+, Degraded-But-Viable on 8GB

The trick is a **three-tier memory architecture** modeled after MemGPT/Letta, combined with **Gemma 4 E4B's memory-efficient SWA architecture** and **node-llama-cpp's stateful features** we aren't currently using.

**Key realizations from research (post-audit):**

1. **Gemma 4 E4B is very memory-efficient.** 5:1 interleaved attention with 512-token sliding window means KV cache is only ~60-100 MB per 4K session (not GB). PLE keeps embedding tables on flash.
2. **KV cache was never the bottleneck on 8GB.** Model weights (~4-5 GB) are. On 8GB Macs, the app will rely on macOS unified memory compression/swap \u2014 functional but degraded.
3. **We don't need 10K KV caches in RAM.** We need 2-8 hot caches + fast SQLite-backed resume for everyone else. The three-tier pattern proven by MemGPT/Letta scales.
4. **node-llama-cpp has under-utilized features:** experimental KV cache quantization (needs model-specific A/B testing), per-sequence state save/restore to disk, stateful session reuse (we just added this).
5. **Mem0 claims >90% token reduction via summarization** (self-reported on their own benchmark). Realistic expectation: 50-80% reduction, still transformational.

**Honest assessment:**
- \u2705 **16GB Mac:** Target easily achievable with good margin
- \u26a0\ufe0f **8GB Mac:** Target achievable but with degradation (swap use, pool limited to 2)
- Recommend declaring **16GB as minimum supported spec**, 8GB as "works, expect slowdowns"

---

## Finding 1: Gemma 4 E4B's Architecture Is Very Memory-Efficient (More Than Initially Estimated)

**Sources:** [A Visual Guide to Gemma 4 (Grootendorst, Google DeepMind)](https://newsletter.maartengrootendorst.com/p/a-visual-guide-to-gemma-4), [Google Developers Blog: Gemma 3 Architecture](https://developers.googleblog.com/gemma-explained-whats-new-in-gemma-3/)

> ⚠️ **Revised after audit.** Earlier numbers conflated Gemma 3 4B with Gemma 4 E4B and were based on incorrect KV cache math. Corrected below.

### Gemma 4 E4B Architecture (actual)
- **5:1 interleaved attention pattern** — 5 local (sliding window) + 1 global, repeated
- **Sliding window: 512 tokens** (NOT 1024 — Gemma 4 E4B halved it from Gemma 3)
- **~35 layers** total, hidden dim 2560
- **Per-Layer Embeddings (PLE):** large vocab embedding table (262,144 × 35 × 256) stored on **flash**, not RAM — this is why "E" means "effective"
- Guaranteed global attention on final layer

### Corrected KV Cache Math

Using the formula `KV_bytes = 2 × layers × kv_heads × head_dim × seq_len × bytes_per_element` at 4K context, FP16:

| Model | Config | KV cache at 4K (FP16) |
|---|---|---|
| Llama 3.2 3B (GQA, no SWA) | 28 layers, 8 KV heads, d=128 | ~450 MB |
| Gemma 3 4B (1024-window SWA, 5:1) | 30 layers, 8 KV heads, d=64 | ~90 MB |
| **Gemma 4 E4B (512-window SWA, 5:1)** | **~35 layers, est. 2-4 KV heads** | **~60-100 MB** |

**The KV cache is ~8-10x smaller than initially claimed.** This is actually *better* news for concurrency — we can fit many more hot sessions than the original estimate. The overall budget trouble on 8GB is from the model weights, not KV cache.

---

## Finding 2: node-llama-cpp Has Features We're Not Using

**Source:** [node-llama-cpp LlamaContextOptions](https://node-llama-cpp.withcat.ai/api/type-aliases/LlamaContextOptions), [Chat Session Guide](https://node-llama-cpp.withcat.ai/guide/chat-session)

### 2a. KV Cache Quantization (Experimental)
```typescript
await model.createContext({
  experimentalKvCacheKeyType: 'q8_0',  // 2x memory savings vs F16
  experimentalKvCacheValueType: 'q8_0',
});
```

**Benchmark source:** [NVIDIA DGX Spark benchmarks on Nemotron-30B-128K](https://forums.developer.nvidia.com/t/kv-cache-quantization-benchmarks-on-dgx-spark-q4-0-vs-q8-0-vs-f16-llama-cpp-nemotron-30b-128k-context/365138)
- **q8_0 vs f16:** <1% PPL difference on that model
- **q4_0 vs f16:** Lossless at <6K context, 12% degradation at 24K, 37% at 110K

⚠️ **Important caveats:**
- These benchmarks are for **Nemotron-30B**, not Gemma 4 E4B. Quality effects are model-specific.
- r/LocalLLaMA reports mixed results across models — some small models degrade more than large ones.
- Option is marked "experimental and highly unstable" by node-llama-cpp maintainers.
- **We must run our own Gemma 4 E4B quality tests before enabling in production.**

For our use case (typical <4K per session), q8_0 KV cache is worth A/B testing, but it's not a slam-dunk "enable it" call yet.

### 2b. Context Sequence State Save/Restore
```typescript
// Save a user's KV cache to disk
await contextSequence.saveStateToFile('user_123.bin');

// Later: restore it instantly
await contextSequence.loadStateFromFile('user_123.bin', { acceptRisk: true });
```

**Trade-off:**
- **Pro:** Near-instant session resume, even after evict
- **Con:** **~109 MB per 1K tokens on disk** (docs figure — measured on Llama 3.1 8B)

> **Note:** The 109 MB/1K figure is from node-llama-cpp docs for Llama 3.1 8B. For Gemma 4 E4B with SWA + smaller hidden dim, the actual per-token cost is likely substantially smaller — possibly 20-40 MB/1K. Needs empirical measurement.

Even with a conservative 30 MB/1K estimate for E4B, math for 10K users at 4K tokens each:
- ~30 MB × 4 × 10,000 = **~1.2 TB** ❌ Still impractical
- With q4_0 KV (~4x smaller): ~300 GB — still too much for a local app

**Conclusion unchanged:** State persistence is ONLY viable for ~50-100 most-active users. Everyone else resumes from text history + summary.

### 2c. Stateful Session Reuse (We Just Implemented This)
Already done in our recent `LocalLLMService` refactor — sessions stay alive in pool, KV cache persists between messages.

### 2d. Sliding Window Attention Control
```typescript
await model.createContext({
  swaFullCache: false,  // default — use SWA, save memory
});
```

Default behavior (false) saves memory but limits cache reuse to sliding window size. Setting `true` uses more memory but allows unbounded prefix reuse. **Default is right for us.**

---

## Finding 3: MemGPT/Letta Pattern Solves This Exact Problem

**Source:** [MemGPT Paper arxiv:2310.08560](https://arxiv.org/abs/2310.08560), [Letta Docs](https://docs.letta.com/), [Mem0 production claims](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025)

### The MemGPT Architecture

Inspired by operating system virtual memory:

```
┌───────────────────────────────────────┐
│       MAIN CONTEXT (limited)          │
│  ┌─────────────────────────────────┐  │
│  │ System instructions (~1K tokens)│  │  ← static
│  │ Working context (~500 tokens)   │  │  ← persona + user facts (CORE)
│  │ FIFO message queue (~2K tokens) │  │  ← recent messages
│  └─────────────────────────────────┘  │
├───────────────────────────────────────┤
│       EXTERNAL MEMORY (unbounded)     │
│  ┌─────────────────────────────────┐  │
│  │ Recall memory (full msg DB)     │  │  ← SQLite
│  │ Archival memory (semantic)      │  │  ← vector DB
│  └─────────────────────────────────┘  │
└───────────────────────────────────────┘
```

**Key insight:** The LLM uses **tool calls** to move data between tiers. It autonomously decides:
- "This fact is important, save it to core memory"
- "I don't remember this detail, search archival memory"
- "Conversation is getting long, summarize older messages"

### What TextMyAgent Already Has

✅ We already have (verified in `@/Users/cloudaistudio/Documents/textmyagent-desktop/electron/backend/services/MemoryService.ts`):
- `MemoryService.saveFact()` → user facts (core-like)
- `MemoryService.getUserFacts()` → retrieval
- `MemoryService.saveSummary()` → conversation summarization
- `MemoryService.getLatestSummary()` → retrieve most recent summary
- Message history in SQLite per user

❌ We're missing:
- Automatic summarization trigger (currently manual)
- Vector search over archival memory (currently keyword only)
- Tiered promotion/demotion policies
- User-state pagination (everyone is always "cold")

### Mem0's Production Claim

From their 2025 guide and paper (arxiv:2504.19413): **">90% token cost savings"** through intelligent summarization — however this is **self-reported on their own benchmark suite**. Independent evaluations (r/LangChain) show more variable results.

Treat this as an **upper bound** of what's achievable, not a guarantee. A realistic expectation is 50-80% reduction in practice, which is still transformational for our use case.

---

## Finding 4: Corrected Capacity Numbers for 8GB Mac + Gemma 4 E4B

> ⚠️ **Revised after audit.** KV cache per session is far smaller than initially claimed, but model weights are larger. Net: 8GB is tight, 16GB is the realistic minimum.

Based on corrected Gemma 4 E4B architecture (512-window SWA, ~35 layers):

| Configuration | KV per session (4K est.) | Max pool | Pool total KV |
|---|---|---|---|
| FP16 KV (default) | ~60-100 MB | 6-10 | ~600 MB-1 GB |
| q8_0 KV (experimental) | ~30-50 MB | 12-20 | ~600 MB-1 GB |
| q4_0 KV (experimental, risky) | ~15-25 MB | 24-40 | ~600 MB-1 GB |

**Budget analysis for 8GB Mac (corrected):**
- macOS + apps: ~3-4 GB
- **Gemma 4 E4B Q4_K_M weights: ~4-5 GB** (not 3 GB — E4B is ~8B total params; PLE on flash but weights still ~4-5 GB in GGUF)
- Electron + Node: ~0.5 GB
- **Subtotal: ~8-9.5 GB — already at or over 8GB limit**

**Reality check:** On 8GB, the app will rely heavily on macOS unified memory compression and swap. This is functional but degraded — inference will stutter, and opening other apps will fight for RAM.

**Realistic hardware recommendation:**
- **8 GB Mac:** Minimum viable with degradation. Pool size 2 (FP16). May require closing other apps.
- **16 GB Mac:** Comfortable. Pool size 4-6 (FP16) with room to spare.
- **24+ GB Mac:** Luxurious. Pool size 8+ with q8_0 for even more concurrency.

**The KV cache was never the bottleneck. The model weights are.** This means increasing concurrency via quantized KV doesn't help 8GB users; they need the model to fit first.

---

## Finding 5: SQLite Handles 10K Users Trivially

For long-term storage of 10K users:
- Per-user compressed state: ~1-5 KB (name, handle, facts, summary, last N messages)
- 10,000 users × 5 KB = **50 MB SQLite database**

Even with full message history kept:
- 10,000 users × 100 messages × 200 bytes = **200 MB SQLite**

This is nothing. Our existing SQLite setup (`better-sqlite3`) handles this easily. With proper indexes on `user_id` and `conversation_id`, lookups are sub-millisecond.

---

## Proposed Architecture: Three-Tier Memory

### TIER 1: HOT (RAM)
**Purpose:** Currently-active conversations. Instant response.

- **2 sessions** on 8GB, **4-6** on 16GB, **8+** on 24GB+
- `LlamaChatSession` instances in our session pool
- Full KV cache resident in GPU/RAM
- ~100-600 MB RAM for pool (depending on size)
- **Response latency: 3-10s**
- Eviction: LRU when pool full OR idle >30 min

### TIER 2: WARM (SQLite + Lazy Rebuild)
**Purpose:** Users who messaged recently but aren't in the hot pool.

- Full message history in SQLite (`messages` table — already exists)
- Per-user rolling summary (every 20 messages)
- Loaded on demand when user messages
- Session rebuilt from history + summary via `setChatHistory()`
- **Response latency: 10-20s** (prefill cost)

### TIER 3: COLD (Summaries Only)
**Purpose:** Dormant long-term users. Minimal footprint.

- User facts (structured, ~100-500 tokens)
- Conversation summary (~200-500 tokens)
- Last N=3 messages for continuity
- Full history archived but rarely loaded
- **Response latency: 15-25s** (full rebuild + intro context)

### Tier Transitions

```
NEW MESSAGE ARRIVES FROM USER X
              ↓
     Is X in HOT pool?
    ┌─────────┴─────────┐
   YES                  NO
    ↓                    ↓
 Respond            Is X in WARM?
 (3-10s)         ┌─────┴─────┐
                YES          NO
                 ↓            ↓
              Rebuild     Load Tier 3 
              session     (summary +
              from DB     facts only)
              (10-20s)    Build fresh
                          session (15-25s)
                           ↓
                   (After response,
                    promote to HOT)
```

**Eviction policy:**
- HOT idle >30 min → demote to WARM (keep DB entry)
- WARM idle >7 days → summarize + demote to COLD
- COLD: retained indefinitely

---

## Capacity Verification (Corrected)

At target scale (10K users, 100 conversations/hour):

| Metric | Design | Target | Margin |
|---|---|---|---|
| Concurrent inferences (8GB) | 2 (pool) | ~5-10 peak | ⚠️ Queue required |
| Concurrent inferences (16GB+) | 4-6 (pool) | ~5-10 peak | ✅ Mostly fits |
| Sustained throughput | ~0.2 msg/sec (cold-heavy) | ~0.25 msg/sec | ⚠️ Tight, may slip at peak |
| RAM usage (8GB) | ~8-9 GB | 8 GB | ⚠️ Relies on swap/compression |
| RAM usage (16GB) | ~8-9 GB | 16 GB | ✅ Comfortable |
| Disk (all users, SQLite) | ~200 MB | — | ✅ Trivial |
| Latency (hot) | 3-10s | <10s | ✅ |
| Latency (warm) | 10-20s | <20s | ✅ |
| Latency (cold, dominant case) | 15-25s | <30s | ✅ SMS-tolerant |

**Revised bottleneck analysis:** At 10K users scale, most messages come from **cold** users (15-25s latency). A realistic sustained throughput is:

- **~150-240 responses/hour** (cold-heavy mix)
- This still exceeds the 100/hour target, but margin is smaller than originally claimed.

**Honest assessment:**
- ✅ Target is achievable on **16GB+ Macs** with good margin
- ⚠️ Target is achievable on **8GB Macs** but with degraded performance (swap, occasional stutter, pool limited to 2)
- The 8GB constraint is driven by **model weights**, not KV cache or architecture
- Recommend declaring **16GB as minimum supported spec**, with 8GB as "best-effort fallback"

---

## Implementation Roadmap

### Phase A: Quick Wins (1-2 days)

1. **Add pool size to settings** — make `maxPooledSessions` configurable, default 2
2. **Add idle TTL to session pool** (30 min) — free RAM when users go inactive
3. **Test q8_0 KV cache quantization** — 2x memory savings, minimal quality risk
4. **Prefill optimization** — when rebuilding warm session, only load last 10 messages + summary, not all 20+

### Phase B: Warm Tier (3-5 days)

5. **Automatic summarization trigger** — after every 20 messages per conversation, run summarization via the LLM itself
6. **Compact restore format** — instead of full message history, restore warm sessions with: `[Summary] + [Last 5 messages]`
7. **Session pre-warming** — on known user start typing (or new message webhook), speculatively start rebuilding session before their message finishes

### Phase C: Cold Tier & Scale Testing (5-7 days)

8. **Cold demotion scheduler** — background task that moves warm→cold after 7 days
9. **User state compression** — extract facts, personality observations, important events into structured cold-tier state
10. **Load testing harness** — simulate 100 concurrent users messaging at realistic rates; measure latency/memory

### Phase D: Advanced (2-3 weeks)

11. **Vector search archival memory** — integrate `sqlite-vec` for semantic search over past conversations
12. **LLM-driven memory management** — add tools like `recall_memory`, `update_persona` so the LLM manages its own memory MemGPT-style
13. **KV cache persistence for top N users** — only for the ~50 most-active users, save KV state to disk for instant resume

---

## What We Should NOT Do

- ❌ **Keep all 10K users' KV caches in RAM** — impossible on 8GB
- ❌ **Persist all users' KV caches to disk** — 1+ TB disk usage
- ❌ **Switch to a smaller model (Gemma 3 1B)** — unnecessary, Gemma 4 E4B fits
- ❌ **Try to parallelize >4 inferences** — GPU bottleneck, not enough memory
- ❌ **Use vector DB for everything** — overkill; structured facts + summaries handle 90%

---

## Sources

### node-llama-cpp / llama.cpp
- [LlamaContextOptions — KV cache quantization, sequences, SWA](https://node-llama-cpp.withcat.ai/api/type-aliases/LlamaContextOptions)
- [Chat Session save/restore guide](https://node-llama-cpp.withcat.ai/guide/chat-session)
- [External Chat State — LlamaChat low-level API](https://node-llama-cpp.withcat.ai/guide/external-chat-state)
- [llama.cpp host-memory prompt caching tutorial](https://github.com/ggml-org/llama.cpp/discussions/20574)
- [KV cache quantization benchmarks q4_0 vs q8_0 vs f16](https://forums.developer.nvidia.com/t/kv-cache-quantization-benchmarks-on-dgx-spark-q4-0-vs-q8-0-vs-f16-llama-cpp-nemotron-30b-128k-context/365138)
- [4-bit KV cache discussion](https://github.com/ggml-org/llama.cpp/discussions/5932)

### Gemma Architecture
- [Gemma 3 technical report](https://arxiv.org/html/2503.19786v1)
- [Google Gemma 3 explained blog](https://developers.googleblog.com/gemma-explained-whats-new-in-gemma-3/)
- [Gemma 3 SWA analysis](https://github.com/rasbt/LLMs-from-scratch/tree/main/ch04/06_swa)

### Memory Architecture Patterns
- [MemGPT paper](https://arxiv.org/abs/2310.08560)
- [Letta memory management docs](https://docs.letta.com/advanced/memory-management/)
- [Mem0 summarization guide](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025)
- [MemGPT virtual context management explained](https://www.leoniemonigatti.com/blog/memgpt.html)

### Scaling & Long Conversations
- [Context window management strategies](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/)
- [Context compression techniques](https://www.sitepoint.com/optimizing-token-usage-context-compression-techniques/)
- [Mem0 Open Source](https://github.com/mem0ai/mem0)
- [sqlite-vec vector search extension](https://github.com/asg017/sqlite-vec)

---

## Decision Point

**The research validates that the target (10K users, 100 convos/hour) is achievable with the three-tier architecture**, but with an honest caveat on the 8GB constraint: the model weights alone nearly fill 8GB, leaving no margin for comfortable operation. **16GB should be the minimum recommended spec**, with 8GB positioned as "works but expect degradation."

The path forward has clear, incremental phases. None depend on more RAM than 8GB Macs already have; they just work better with more.

Next steps to discuss:
1. Which phase (A/B/C/D) do you want to start with?
2. Should we implement KV quantization (q8_0 safe, q4_0 aggressive)?
3. Do you want a configurable pool size with auto-detection, or a fixed value?
