/**
 * Test: Tool/Function calling with Gemma 4 E4B via node-llama-cpp
 *
 * This tests whether E4B can reliably call functions that mirror
 * the TextMyAgent tool set:
 * - save_user_fact (save info about the user)
 * - get_user_facts (retrieve saved info)
 * - react_to_message (send a tapback reaction)
 * - set_reminder (schedule a reminder)
 * - wait (stay silent, don't respond)
 *
 * Model: ggml-org/gemma-4-E4B-it-GGUF (Q4_K_M)
 */

import path from "path";
import { fileURLToPath } from "url";
import {
  getLlama,
  resolveModelFile,
  LlamaChatSession,
  defineChatSessionFunction,
} from "node-llama-cpp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.join(__dirname, "models");

// --- System prompt with tool usage guidance ---
const SYSTEM_PROMPT = `You are Grace, a chill AI friend who texts via iMessage.
You reply like a real person texting — short, casual, and natural.

RESPOND vs REACT vs WAIT — Decision Guide:
You have three choices for every incoming message:
1. RESPOND with text (default for questions, requests, conversation)
2. REACT with a tapback using react_to_message + optionally WAIT (for acknowledgments, thanks, goodbyes)
3. WAIT silently using the wait tool (for messages needing no reply)

Decision table:
- Question → RESPOND with text
- Simple acknowledgment (ok, got it, k) → react_to_message(like) + wait
- Gratitude (thanks, ty) → react_to_message(love) + wait
- Goodbye (bye, ttyl, gn) → react_to_message(love) + wait

When you learn something personal about the user, save it with save_user_fact.
When you need to recall something, use get_user_facts.
When the user asks to be reminded, use set_reminder.`;

// --- Simulated tool data ---
const savedFacts = [];
const reminders = [];

// --- Tool definitions (mirrors TextMyAgent's real tools) ---
const functions = {
  save_user_fact: defineChatSessionFunction({
    description:
      "Save a fact or preference about the user for future reference. Use when you learn something personal about them.",
    params: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The fact to save about the user",
        },
        type: {
          type: "string",
          enum: ["preference", "personal", "behavioral", "general"],
          description: "Category of the fact",
        },
      },
      required: ["content", "type"],
    },
    async handler(params) {
      savedFacts.push(params);
      console.log(`    [TOOL] save_user_fact called:`, params);
      return `Saved: "${params.content}" (type: ${params.type})`;
    },
  }),

  get_user_facts: defineChatSessionFunction({
    description:
      "Retrieve saved facts about the user. Use when you need to recall something you learned about them.",
    params: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["preference", "personal", "behavioral", "general", "all"],
          description: "Filter facts by type, or 'all' for everything",
        },
      },
    },
    async handler(params) {
      console.log(`    [TOOL] get_user_facts called:`, params);
      if (savedFacts.length === 0) return "No facts saved yet.";
      const filtered =
        params.type === "all"
          ? savedFacts
          : savedFacts.filter((f) => f.type === params.type);
      return JSON.stringify(filtered);
    },
  }),

  react_to_message: defineChatSessionFunction({
    description:
      "Send a tapback reaction to the user's message. Use for acknowledgments, thanks, or emotional responses.",
    params: {
      type: "object",
      properties: {
        reaction: {
          type: "string",
          enum: ["love", "like", "dislike", "laugh", "emphasize", "question"],
          description: "The tapback reaction type",
        },
      },
      required: ["reaction"],
    },
    async handler(params) {
      console.log(`    [TOOL] react_to_message called:`, params);
      return `Reacted with ${params.reaction}`;
    },
  }),

  set_reminder: defineChatSessionFunction({
    description:
      "Set a reminder for the user. They will be notified at the specified time.",
    params: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The reminder message",
        },
        delay_minutes: {
          type: "number",
          description: "How many minutes from now to send the reminder",
        },
      },
      required: ["message", "delay_minutes"],
    },
    async handler(params) {
      reminders.push(params);
      console.log(`    [TOOL] set_reminder called:`, params);
      return `Reminder set: "${params.message}" in ${params.delay_minutes} minutes`;
    },
  }),

  wait: defineChatSessionFunction({
    description:
      "Stay silent and do not send any text response. Use after reacting to a message that needs no reply (goodbyes, simple acknowledgments).",
    params: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Why you chose to stay silent",
        },
      },
    },
    async handler(params) {
      console.log(`    [TOOL] wait called:`, params);
      return "Staying silent.";
    },
  }),
};

// --- Test scenarios ---
const TESTS = [
  {
    name: "1. Simple question (should just respond, no tools)",
    message: "whats the weather like in new york usually in summer?",
    expectTools: [],
  },
  {
    name: "2. Personal info (should call save_user_fact)",
    message: "btw i just got a golden retriever puppy, his name is max!",
    expectTools: ["save_user_fact"],
  },
  {
    name: "3. Recall info (should call get_user_facts)",
    message: "wait what was my dog's name again?",
    expectTools: ["get_user_facts"],
  },
  {
    name: "4. Reminder request (should call set_reminder)",
    message: "remind me in 30 minutes to take max for a walk",
    expectTools: ["set_reminder"],
  },
  {
    name: "5. Thank you (should call react_to_message + wait)",
    message: "thanks!",
    expectTools: ["react_to_message"],
  },
  {
    name: "6. Goodbye (should call react_to_message + wait)",
    message: "ok gotta go bye!",
    expectTools: ["react_to_message"],
  },
];

async function main() {
  console.log("=== Gemma 4 E4B Tool Calling Test ===\n");

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

  console.log("Model loaded!\n");

  let passed = 0;
  let failed = 0;

  for (const test of TESTS) {
    console.log(`--- ${test.name} ---`);
    console.log(`User: ${test.message}`);

    const startTime = Date.now();
    const response = await session.prompt(test.message, {
      functions,
      temperature: 0.7,
      repeatPenalty: {
        penalty: 1.15,
      },
    });
    const elapsed = Date.now() - startTime;

    console.log(`Grace: ${response || "(no text response — tool-only)"}`);
    console.log(`  (${elapsed}ms)\n`);
  }

  console.log("\n=== Summary ===");
  console.log(`Saved facts: ${JSON.stringify(savedFacts, null, 2)}`);
  console.log(`Reminders: ${JSON.stringify(reminders, null, 2)}`);
  console.log("\nCheck the [TOOL] lines above to verify:");
  console.log("1. Test 1: NO tools called (just text response)");
  console.log("2. Test 2: save_user_fact called with dog info");
  console.log("3. Test 3: get_user_facts called to recall the dog");
  console.log("4. Test 4: set_reminder called with ~30 min delay");
  console.log("5. Test 5: react_to_message(love) called");
  console.log("6. Test 6: react_to_message(love) + possibly wait called");

  await context.dispose();
  await model.dispose();
}

main().catch(console.error);
