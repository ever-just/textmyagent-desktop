# Research Plan: 10K Users + 100 Concurrent Convos/Hour on 8GB Local Mac

> Created: Apr 16, 2026  
> Target: **10,000 long-term users, ~100 conversations/hour, 8GB RAM, 100% local**

---

## Reframing the Scale Problem

### What "100 conversations/hour" actually means

| Metric | Value |
|---|---|
| Conversations in a 1-hour window | 100 |
| Avg messages per conversation in that hour | ~5-10 |
| Total messages/hour | ~500-1000 |
| **Avg message rate** | **~1 msg every 4-7 seconds** |
| **Peak simultaneous messages** | **~5-10 at any single instant** |
| Avg inference time per message | ~10-20 seconds |
| **Required throughput** | **~0.15-0.25 msg/sec sustained** |

**Conclusion:** We don't need to serve 100 parallel inferences. We need to serve ~5-10 simultaneous (at peak) plus fast resume from disk for the rest.

### What 8GB RAM actually allows

| Component | Memory |
|---|---|
| macOS + background apps | ~3-4 GB |
| Gemma 4 E4B (Q4_K_M weights) | ~3-4 GB |
| Electron + Node + SQLite overhead | ~0.5-1 GB |
| **Available for KV cache + buffers** | **~0.5-1.5 GB** |

**Conclusion:** Pool of 2-4 hot sessions is realistic. The other 10,000 users live in SQLite.

---

## Core Architectural Insight

The game-changing realization for 10K users on 8GB:

> **Keep minimal KV cache in RAM. Keep everything else on disk. Resume cheaply.**

This means:
1. **Hot tier (GPU KV cache):** 2-4 active conversations — instant response
2. **Warm tier (SQLite + summaries):** 10,000 users — 10-20s resume time
3. **Cold tier (full history on disk):** Archival — rarely touched

The question isn't "how do we fit 100 KV caches in 1 GB?" (impossible). It's **"how do we make each warm→hot transition fast enough that users don't notice?"**

---

## Research Questions (Focused & Scoped)

### 🎯 Core Questions

**Q1: How do we compress conversation state so 10K users fit on disk efficiently?**
- What's the smallest per-user memory representation that preserves personality/context?
- How do successful local agents (Letta, Mem0, MemGPT) compress long histories?
- What's the tradeoff between summary quality and size?

**Q2: How do we make "warm→hot" resume as fast as possible?**
- Prefix caching: can we cache the common system prompt (~970 tokens) once?
- Prompt compression: can we squeeze the per-user state into fewer tokens?
- Speculative decoding: can we use a small draft model to predict faster?
- Does node-llama-cpp support these? What about llama.cpp directly?

**Q3: What's the efficient frontier for KV cache on 8GB?**
- 2-bit KV quantization (KIVI, etc.) — does node-llama-cpp support it?
- Attention sinks + sliding window (StreamingLLM) — applies to Gemma?
- H2O-style heavy-hitter eviction — viable for chat?

**Q4: How do we handle the peak-10-simultaneous-messages case?**
- Is 2-4 pool slots + queue enough for ~10 peak?
- What's the max pool size at 8GB with quantized KV?
- Queueing strategy when pool is full

**Q5: What's the scalable memory architecture for 10K users?**
- How do Letta/Mem0 do it?
- Is SQLite FTS enough for search, or do we need a vector store?
- What's the right balance of structured (facts) vs semantic (RAG) memory?

### 🔍 Supporting Questions

**Q6:** Is Gemma 4 E4B the right model for this constraint? (vs Gemma 3 1B, Phi-3 mini, Qwen 2.5 0.5B)  
**Q7:** What are Apple's MLX framework advantages for multi-session on M-series?  
**Q8:** Can we use CoreML Neural Engine (ANE) for faster inference freeing GPU for pool?  
**Q9:** Are there Mac-specific memory techniques (unified memory tricks)?  
**Q10:** How do other local-first agent platforms (Ollama, LM Studio) handle multi-user?

---

## Research Methodology

### Phase 1: Small-Model & Quantization Deep Dive (2-3 hours)

**Target:** Identify the smallest model + most aggressive KV quantization that preserves quality.

**Sources to investigate:**
- llama.cpp KV cache quantization modes (`q4_0`, `q8_0`, `f16`)
- KIVI and KVQuant papers
- Gemma 3 1B vs 4B quality comparisons
- Phi-3.5 mini benchmarks
- Qwen 2.5 3B benchmarks
- node-llama-cpp KV quantization docs

**Key queries:**
1. `node-llama-cpp KV cache quantization type_k type_v memory reduction`
2. `llama.cpp 2-bit KV cache quantization quality degradation chat`
3. `Gemma 4 E4B vs Gemma 3 1B quality benchmark chat agent`
4. `Apple MLX framework chat LLM memory efficient Mac`
5. `StreamingLLM attention sinks local llama.cpp implementation`

### Phase 2: Long-Term Memory Architecture (2-3 hours)

**Target:** Find the proven pattern for persisting 10K user states cheaply.

**Sources to investigate:**
- Letta (formerly MemGPT) architecture docs
- Mem0 architecture + GitHub
- LangChain memory primitives (buffer, summary, vector)
- MemGPT paper — hierarchical memory
- "A-MEM: Agentic Memory for LLM Agents" (recent paper)
- Character.AI's character state persistence
- Research on conversation summarization quality vs compression ratio

**Key queries:**
1. `Letta persistent agent memory SQLite scaling users`
2. `Mem0 open source memory architecture production scale`
3. `MemGPT paper hierarchical memory working set recall storage`
4. `conversation summarization LLM agents long-term compression ratio`
5. `vector database local SQLite embeddings chat history RAG`
6. `A-MEM agentic memory dynamic organization LLM`

### Phase 3: Local Serving Optimization (2-3 hours)

**Target:** Max out what node-llama-cpp + Gemma can do on 8GB.

**Sources to investigate:**
- node-llama-cpp advanced context options docs
- llama.cpp server multi-user deployment patterns
- Continuous batching in llama.cpp
- Prompt cache reuse (prefix caching)
- Speculative decoding in llama.cpp (draft models)

**Key queries:**
1. `llama.cpp prompt cache prefix system prompt reuse performance`
2. `node-llama-cpp context state save restore disk KV cache`
3. `llama.cpp speculative decoding draft model small`
4. `llama.cpp batch inference low memory concurrent users`
5. `node-llama-cpp prefix caching system prompt sharing sequences`

### Phase 4: SMS/Async Chat Architecture Patterns (1-2 hours)

**Target:** Understand patterns specifically for async message-based agents.

**Sources to investigate:**
- Twilio AI assistant engineering blogs
- Bland.ai phone AI architecture (similar async constraints)
- Rasa open source chatbot at scale
- BotPress multi-user architecture
- SMS bot best practices

**Key queries:**
1. `SMS AI agent architecture async latency user scale`
2. `Twilio AI assistant message queue design`
3. `Rasa open source chatbot 10000 users scaling`
4. `asynchronous chat agent backend queue processing`

### Phase 5: Synthesis & Prototyping (2-3 hours)

Build a prototype implementation plan combining winning techniques from Phase 1-4.

---

## Expected Deliverables

### D1: `MODEL_QUANTIZATION_ANALYSIS.md`
Hard numbers on:
- KV cache memory with different quantization levels for our model
- Quality degradation expected from each
- Max pool size achievable at each setting
- Recommendation: which combo hits target with highest quality

### D2: `MEMORY_HIERARCHY_DESIGN.md`
Three-tier memory design:
- **Tier 1 (in-RAM pool):** 2-4 hot sessions
- **Tier 2 (SQLite):** Structured facts + summaries per user
- **Tier 3 (cold archive):** Full message history
- Promotion/demotion rules between tiers
- Fast warm→hot resume mechanism

### D3: `PREFIX_CACHE_STRATEGY.md`
Specifically on how to reuse the system prompt across all 10K users' inferences:
- Does node-llama-cpp do this automatically?
- How to verify it's happening
- Expected speedup

### D4: `SUMMARIZATION_PIPELINE.md`
How to keep per-user memory compact:
- When to summarize (every N messages, time-based, size-based)
- What to summarize (rolling window? entire history?)
- Summary quality evaluation
- Integration with existing MemoryService

### D5: `CAPACITY_VERIFICATION_PLAN.md`
How we'll actually prove 10K + 100/hr works:
- Load test setup
- Metrics to measure (memory, latency, throughput)
- Pass/fail criteria

### D6: `IMPLEMENTATION_ROADMAP.md`
The concrete build plan:
- Phase 1 (quick wins, ~1 week): KV quantization, prefix cache, bigger pool
- Phase 2 (memory architecture, ~2 weeks): Summarization, tiered storage
- Phase 3 (scale validation, ~1 week): Load testing, tuning

---

## Success Criteria for the Research

Before we build anything, the research must answer:

✅ **Capacity:** Can 8GB actually hold enough KV cache for 5-10 peak simultaneous sessions?  
✅ **Latency:** Can warm→hot resume stay under ~10s for 95th percentile?  
✅ **Storage:** Can 10K users' compact state fit in a reasonable SQLite DB (<1GB)?  
✅ **Throughput:** Can we sustain ~0.25 msg/sec average on an 8GB Mac?  
✅ **Quality:** Does aggressive summarization/quantization still produce decent responses?

If any of these are NO, we document the gap and propose mitigations.

---

## Out of Scope (Intentionally)

- Cloud/hybrid architectures (user explicitly wants 100% local)
- Model replacement (Gemma 4 E4B stays unless research shows it's the blocker)
- Multi-machine / distributed setups
- Fine-tuning or model training
- Sub-1B models (likely too weak for agent use)

---

## Research Execution Plan

**Total estimated research time:** 10-15 focused hours before any code changes.

Can execute in two modes:
- **Fast mode:** I batch all the web searches + paper reads in one session (~2-3 hours of tool calls)
- **Deep mode:** We split into phases, review findings between each, refine direction

Which mode do you want?
