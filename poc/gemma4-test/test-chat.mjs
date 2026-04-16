/**
 * Test: Multi-turn chat with Gemma 4 E4B via node-llama-cpp
 *
 * This tests the critical risk identified in the research plan:
 * - Can E4B maintain coherent multi-turn conversation?
 * - Does the system prompt work correctly?
 * - Are responses short/natural enough for iMessage-style chat?
 *
 * Model: ggml-org/gemma-4-E4B-it-GGUF (Q4_K_M)
 */

import path from "path";
import { fileURLToPath } from "url";
import { getLlama, resolveModelFile, LlamaChatSession } from "node-llama-cpp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.join(__dirname, "models");

// --- System prompt (mirrors TextMyAgent's PromptBuilder style) ---
const SYSTEM_PROMPT = `You are Grace, a chill AI friend who texts via iMessage.
You reply like a real person texting — short, casual, and natural.

CRITICAL RULES:
- Respond in 1-2 sentences MAX. Treat every response like a text message, not an email.
- Most replies should be under 100 characters. A few words is often enough.
- NEVER send paragraph-length responses unless the user explicitly asks for detail.
- NEVER use bullet points, numbered lists, or any structured formatting.
- Use 0-1 emoji per response. Don't overdo it.
- Match the user's tone and length. If they send 3 words, reply with 3-8 words.
- If you don't know, just say "not sure" or "idk tbh"
- No greetings like "Hey!" or "Hi there!" unless the user greeted you first.
- Write plain text only — no markdown syntax.`;

// --- Multi-turn conversation to test ---
const CONVERSATION = [
  "hey whats up",
  "not much just bored at work lol",
  "do you remember what we talked about yesterday?",
  "i told you i was thinking about getting a dog",
  "yeah what breed do you think would be good for an apartment?",
  "ok thanks, also completely different topic — whats the capital of france?",
  "cool. hey gotta go, talk later",
];

async function main() {
  console.log("=== Gemma 4 E4B Multi-Turn Chat Test ===\n");

  // Resolve model file (auto-downloads if missing)
  console.log("Loading model...");
  const modelPath = await resolveModelFile(
    "hf:ggml-org/gemma-4-E4B-it-GGUF:Q4_K_M",
    modelsDir
  );

  const llama = await getLlama("lastBuild");
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext();

  const session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt: SYSTEM_PROMPT,
  });

  console.log(`Model loaded: ${modelPath}`);
  console.log(`System prompt set (${SYSTEM_PROMPT.length} chars)`);
  console.log("\n--- Conversation Start ---\n");

  for (let i = 0; i < CONVERSATION.length; i++) {
    const userMsg = CONVERSATION[i];
    console.log(`[Turn ${i + 1}] User: ${userMsg}`);

    const startTime = Date.now();
    const response = await session.prompt(userMsg, {
      temperature: 0.7,
      repeatPenalty: {
        penalty: 1.15, // Prevents degenerate loops (per benchmark findings)
      },
    });
    const elapsed = Date.now() - startTime;

    console.log(`[Turn ${i + 1}] Grace: ${response}`);
    console.log(`  (${elapsed}ms, ${response.length} chars)\n`);
  }

  console.log("--- Conversation End ---\n");

  // Evaluate results
  console.log("=== Quick Assessment ===");
  console.log("Check the output above for:");
  console.log("1. Did responses stay short and casual (iMessage-style)?");
  console.log("2. Did the model maintain context across turns?");
  console.log("3. Did it handle the memory question (turn 3-4) reasonably?");
  console.log("4. Did it handle the topic switch (turn 6) gracefully?");
  console.log("5. Did it respond naturally to the goodbye (turn 7)?");
  console.log("6. Any repetition loops or degenerate output?");

  await context.dispose();
  await model.dispose();
}

main().catch(console.error);
