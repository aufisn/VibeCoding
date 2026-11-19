#!/usr/bin/env node
// Checks that FridgeChef's OpenRouter setup works, without ever printing the
// key (only a masked form like "sk-or-…74dd").
//
// Usage: node scripts/check-key.mjs [--no-models]
//   1. reads .env and checks the settings and file permissions
//   2. asks OpenRouter about the key (GET /key: label, usage, limit)
//   3. sends each model a one-word test prompt (skip with --no-models)
// Exit code: 0 when everything works, 1 otherwise.

import { loadConfig, maskKey } from "../server/config.mjs";
import { createOpenRouterClient } from "../server/openrouter.mjs";

const skipModels = process.argv.includes("--no-models");
const { config, problems, warnings } = loadConfig();

console.log("FridgeChef: OpenRouter setup check\n");
console.log(`Key:           ${maskKey(config.OPENROUTER_API_KEY)}`);
console.log(`Vision model:  ${config.OPENROUTER_VISION_MODEL}`);
console.log(`Text model:    ${config.OPENROUTER_TEXT_MODEL}`);
console.log(`Server:        http://${config.HOST}:${config.PORT}\n`);
for (const w of warnings) console.log(`⚠ ${w}`);
if (problems.length) {
  for (const p of problems) console.log(`✖ ${p}`);
  process.exit(1);
}

const client = createOpenRouterClient({ apiKey: config.OPENROUTER_API_KEY });
let ok = true;

try {
  const info = await client.keyInfo();
  const money = (v) => (typeof v === "number" ? `$${v.toFixed(4)}` : "–");
  console.log("✔ OpenRouter accepts the key");
  // OpenRouter's default label is part of the key itself: don't show it.
  const label = !info.label || /^sk-or/i.test(info.label) ? "(default)" : info.label;
  console.log(`  Label: ${label} · Used: ${money(info.usage)} · Limit: ${info.limit === null ? "none" : money(info.limit)} · Free tier: ${info.isFreeTier ? "yes" : "no"}`);
} catch (err) {
  console.log(`✖ ${err.message}`);
  process.exit(1);
}

if (!skipModels) {
  for (const [label, model] of [["Vision", config.OPENROUTER_VISION_MODEL], ["Text", config.OPENROUTER_TEXT_MODEL]]) {
    try {
      const started = Date.now();
      const ask = () => client.chat({ model, messages: [{ role: "user", content: "Reply with the single word: ready" }], maxTokens: 20, temperature: 0 });
      let reply;
      try {
        reply = await ask();
      } catch (err) {
        // Free models are often busy (429/502/503): wait once, then try again.
        if (![429, 502, 503].includes(err.status)) throw err;
        console.log(`  ${label} model is busy; trying again in 20 s…`);
        await new Promise((r) => setTimeout(r, 20_000));
        reply = await ask();
      }
      console.log(`✔ ${label} model answers (${((Date.now() - started) / 1000).toFixed(1)} s): "${reply.text.trim().slice(0, 40)}"`);
    } catch (err) {
      ok = false;
      console.log(`✖ ${label} model (${model}): ${err.message}`);
    }
  }
}

console.log(ok ? "\nAll set. Start the app with: npm start" : "\nSome checks failed (see above).");
process.exitCode = ok ? 0 : 1;
