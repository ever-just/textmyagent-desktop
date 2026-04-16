# Gemma 4 E4B — Proof of Concept

Tests local Gemma 4 inference for the TextMyAgent desktop app before committing to the full Claude → Gemma 4 migration.

## Model Source

**Official GGUF**: [`ggml-org/gemma-4-E4B-it-GGUF`](https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF)
- Maintained by the llama.cpp team from Google's official [`google/gemma-4-E4B-it`](https://huggingface.co/google/gemma-4-E4B-it) weights
- Quantization: Q4_K_M (~5 GB download)
- License: Apache 2.0

## Setup

```bash
cd poc/gemma4-test
npm install
```

## Tests

### 1. Download Model (~5 GB)
```bash
npm run download
```

### 2. Multi-Turn Chat Test
Tests whether E4B can maintain coherent iMessage-style conversation across 7 turns.
```bash
npm test
```

### 3. Tool Calling Test
Tests whether E4B can reliably call functions (save_user_fact, react_to_message, set_reminder, etc.).
```bash
npm run test:tools
```

## What We're Validating

| Risk | Test |
|---|---|
| E4B multi-turn failure (0% in one benchmark) | `test-chat.mjs` — 7-turn conversation |
| Tool calling reliability (75% benchmark) | `test-tools.mjs` — 6 scenarios with 5 tools |
| Response style (short/casual for iMessage) | Both tests — check response length/tone |
| Repetition degeneration | Both tests — repeatPenalty: 1.15 applied |
| Latency on Apple Silicon | Both tests — timing logged per turn |

## Hardware Requirements

- **Minimum**: 8 GB unified memory (Apple Silicon) — tight but works
- **Recommended**: 16 GB — comfortable with headroom for OS + app
