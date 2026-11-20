#!/usr/bin/env node
// Tries FridgeChef's AI through the API and shows what comes back, how long it
// took, how many tokens it used and what it cost.
//
// Usage:
//   node scripts/try-models.mjs text  [--ingredients "eggs, milk, spinach"] [options]
//   node scripts/try-models.mjs image <photo.jpg|png|webp|gif | https://...> [options]
//
// Options:
//   --provider anthropic|openrouter   default: AI_PROVIDER from .env (Claude when an Anthropic key is set)
//   --model <id>                      default: the model in .env for that provider and step
//   --allow-paid                      required for paid models (every Claude model): a test can't cost money by accident
//
// Keys are read from .env and never printed.

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, PROVIDERS } from "../server/config.mjs";
import { createOpenRouterClient } from "../server/openrouter.mjs";
import { createClaudeClient, recipePrompt, VISION_PROMPT as CLAUDE_VISION_PROMPT } from "../server/claude.mjs";

export { recipePrompt };

export const IMAGE_TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// OpenRouter models have no enforced output schema, so the prompt spells out the JSON.
export const VISION_PROMPT = `${CLAUDE_VISION_PROMPT}
Answer with JSON only, no other text, in this shape:
{"ingredients":[{"name":"eggs","quantity":"about 6","confidence":"high"}],"notes":"anything unclear"}`;

/** The first JSON object in a model's answer, which may be wrapped in ``` fences or text. Pure. */
export function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** { url } for an https URL, or { base64, mediaType } for a local image file. */
export async function imageInputFor(source, read = readFile) {
  if (/^https:\/\//i.test(source)) return { url: source };
  if (/^[a-z]+:\/\//i.test(source)) throw new Error("Unsupported image URL: use https://, or a local file.");
  const mediaType = IMAGE_TYPES[extname(source).toLowerCase()];
  if (!mediaType) throw new Error(`Unsupported image type "${extname(source)}". Use ${Object.keys(IMAGE_TYPES).join(", ")}.`);
  const data = await read(source);
  if (data.length > MAX_IMAGE_BYTES) throw new Error(`Image is ${(data.length / 1048576).toFixed(1)} MB; the limit is 5 MB.`);
  return { base64: data.toString("base64"), mediaType };
}

/** A data: URL (OpenRouter's format) for a local image, or the https URL unchanged. */
export async function imageUrlFor(source, read = readFile) {
  const input = await imageInputFor(source, read);
  return input.url ?? `data:${input.mediaType};base64,${input.base64}`;
}

async function main(argv) {
  const args = [...argv];
  const opt = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args.splice(i, 2)[1];
  };
  const allowPaid = args.includes("--allow-paid");
  if (allowPaid) args.splice(args.indexOf("--allow-paid"), 1);
  const providerArg = opt("--provider");
  const modelArg = opt("--model");
  const ingredients = opt("--ingredients") ?? "eggs, spinach, cheddar cheese, tomatoes, milk, butter";
  const [kind, source] = args;

  const { config } = loadConfig();
  const provider = providerArg ?? config.AI_PROVIDER;
  if (!PROVIDERS.includes(provider)) return fail(`--provider must be one of: ${PROVIDERS.join(", ")}`);
  if (!["text", "image"].includes(kind) || (kind === "image" && !source)) {
    return fail("Usage: node scripts/try-models.mjs text | image <photo or https URL> [--provider ...] [--model ...] [--allow-paid]");
  }
  const anthropic = provider === "anthropic";
  const key = anthropic ? config.ANTHROPIC_API_KEY : config.OPENROUTER_API_KEY;
  if (!key) return fail(`${anthropic ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY"} isn't set in .env.`);
  const model = modelArg ?? (anthropic ? config.ANTHROPIC_MODEL : kind === "text" ? config.OPENROUTER_TEXT_MODEL : config.OPENROUTER_VISION_MODEL);
  const paid = anthropic || !model.endsWith(":free");
  if (paid && !allowPaid) return fail(`${model} is a paid model. Add --allow-paid to try it (each request costs a little; the cost is shown).`);

  const image = kind === "image" ? await imageInputFor(source).catch((err) => fail(err.message)) : null;
  console.log(`${kind === "text" ? "Text generation" : "Image recognition"} with ${model} (${anthropic ? "Anthropic" : "OpenRouter"})`);
  if (kind === "text") console.log(`Prompt ingredients: ${ingredients}`);
  else console.log(`Image: ${source}${image.url ? " (fetched by the API from the URL)" : ` (sent as ${Math.round((image.base64.length * 3) / 4 / 1024)} KB base64)`}`);
  console.log("");

  const started = Date.now();
  let result;
  try {
    if (anthropic) {
      const claude = createClaudeClient({ apiKey: key, model, workspaceId: config.ANTHROPIC_WORKSPACE_ID });
      result = kind === "text" ? await claude.writeRecipe(ingredients) : await claude.identifyIngredients(image);
    } else {
      const client = createOpenRouterClient({ apiKey: key });
      const content =
        kind === "text"
          ? recipePrompt(ingredients)
          : [{ type: "text", text: VISION_PROMPT }, { type: "image_url", image_url: { url: image.url ?? `data:${image.mediaType};base64,${image.base64}` } }];
      const reply = await client.chat({ model, messages: [{ role: "user", content }], maxTokens: 900, temperature: 0.3 });
      result = { ...reply, cost: reply.usage?.cost ?? null };
      if (kind === "image") {
        const json = extractJson(reply.text);
        if (!json?.ingredients) {
          console.log(reply.text);
          console.log("\n⚠ The answer wasn't the JSON shape asked for.");
          process.exitCode = 1;
          return;
        }
        Object.assign(result, json);
      }
    }
  } catch (err) {
    console.log(`✖ ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const u = result.usage ?? {};
  const inTok = u.input_tokens ?? u.prompt_tokens ?? "?";
  const outTok = u.output_tokens ?? u.completion_tokens ?? "?";
  const cost = typeof result.cost === "number" ? ` · cost $${result.cost.toFixed(4)}` : "";
  console.log(`✔ Answered in ${((Date.now() - started) / 1000).toFixed(1)} s by ${result.model} · tokens in ${inTok}, out ${outTok}${cost}\n`);
  if (kind === "image") {
    console.log(`Ingredients found (${result.ingredients.length}):`);
    for (const i of result.ingredients) console.log(`  - ${i.name}${i.quantity ? ` (${i.quantity})` : ""}${i.confidence ? ` [${i.confidence}]` : ""}`);
    if (result.notes) console.log(`Notes: ${result.notes}`);
  } else {
    console.log(result.text.trim());
  }
}

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.argv.slice(2));
}
