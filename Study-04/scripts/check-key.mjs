#!/usr/bin/env node
// Checks that FridgeChef's AI setup works, without ever printing a key (only a
// masked form like "sk-ant-…a1b2").
//
// Usage: node scripts/check-key.mjs [--no-models]
//   1. reads .env and checks the settings and file permissions
//   2. Anthropic (Claude): asks the free Models API whether the key can use the
//      model. Nothing is generated, so this costs nothing.
//      OpenRouter: asks about the key, then sends each :free model a one-word
//      test prompt (skip with --no-models).
// Exit code: 0 when everything works, 1 otherwise.

import { loadConfig, maskKey } from "../server/config.mjs";
import { createOpenRouterClient } from "../server/openrouter.mjs";
import { createClaudeClient } from "../server/claude.mjs";
import { activeKey, activeModels } from "../server.mjs";

const skipModels = process.argv.includes("--no-models");
const { config, problems, warnings } = loadConfig();
const models = activeModels(config);
const anthropic = config.AI_PROVIDER === "anthropic";

console.log("FridgeChef: AI setup check\n");
console.log(`Provider:      ${anthropic ? "Anthropic (Claude)" : "OpenRouter"}`);
console.log(`Key:           ${maskKey(activeKey(config))}`);
console.log(anthropic ? `Model:         ${models.text} (photo and recipe)` : `Vision model:  ${models.vision}\nText model:    ${models.text}`);
console.log(`Server:        http://${config.HOST}:${config.PORT}\n`);
for (const w of warnings) console.log(`⚠ ${w}`);
if (problems.length) {
  for (const p of problems) console.log(`✖ ${p}`);
  process.exit(1);
}

let ok = true;

if (anthropic) {
  try {
    const info = await createClaudeClient({ apiKey: config.ANTHROPIC_API_KEY, model: config.ANTHROPIC_MODEL }).checkModel();
    console.log(`✔ Anthropic accepts the key, and it can use ${info.name} (${info.id}).`);
    console.log("  (Checked with the Models API: nothing was generated, so this cost nothing.)");
  } catch (err) {
    ok = false;
    console.log(`✖ ${err.message}`);
  }
} else {
  const client = createOpenRouterClient({ apiKey: config.OPENROUTER_API_KEY });
  try {
    const info = await client.keyInfo();
    const money = (v) => (typeof v === "number" ? `$${v.toFixed(4)}` : "–");
    // OpenRouter's default label is part of the key itself: don't show it.
    const label = !info.label || /^sk-or/i.test(info.label) ? "(default)" : info.label;
    console.log("✔ OpenRouter accepts the key");
    console.log(`  Label: ${label} · Used: ${money(info.usage)} · Limit: ${info.limit === null ? "none" : money(info.limit)} · Free tier: ${info.isFreeTier ? "yes" : "no"}`);
  } catch (err) {
    console.log(`✖ ${err.message}`);
    process.exit(1);
  }
  if (!skipModels) {
    for (const [label, model] of [["Vision", models.vision], ["Text", models.text]]) {
      if (!model.endsWith(":free")) {
        console.log(`- ${label} model ${model} is paid: not test-prompted here (use scripts/try-models.mjs --allow-paid).`);
        continue;
      }
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
}

console.log(ok ? "\nAll set. Start the app with: npm start" : "\nSome checks failed (see above).");
process.exitCode = ok ? 0 : 1;
