#!/usr/bin/env node
// Tries the two FridgeChef models through the OpenRouter API and shows what
// they return, how long they took and how many tokens they used.
//
// Usage:
//   node scripts/try-models.mjs text  [--model provider/model] [--ingredients "eggs, milk, spinach"]
//   node scripts/try-models.mjs image <photo.jpg|png|webp | https://...> [--model provider/model]
//
// Models default to OPENROUTER_TEXT_MODEL / OPENROUTER_VISION_MODEL from .env.
// The key is read from .env and never printed. Paid (non-":free") models are
// refused unless you add --allow-paid, so a test can't cost money by accident.

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../server/config.mjs";
import { createOpenRouterClient } from "../server/openrouter.mjs";

export const IMAGE_TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const VISION_PROMPT = `You are looking at a photo of food, usually the inside of a refrigerator.
List every food ingredient you can see. Answer with JSON only, no other text, in this shape:
{"ingredients":[{"name":"eggs","quantity":"about 6","confidence":"high"}],"notes":"anything unclear"}
Use simple ingredient names in English. confidence is high, medium or low. Don't list containers or brands as ingredients unless the contents are clear.`;

export const recipePrompt = (ingredients) => `Ingredients available: ${ingredients}.
Write one simple home recipe that uses mainly these ingredients (salt, pepper, oil and water may be added).
Format: a title line, then "Ingredients:" as a list with amounts, then "Steps:" as a numbered list, then "Time:" in minutes. Keep it under 200 words.`;

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

/** A data: URL for a local image, or the https URL unchanged. */
export async function imageUrlFor(source, read = readFile) {
  if (/^https:\/\//i.test(source)) return source;
  if (/^[a-z]+:\/\//i.test(source)) throw new Error("Unsupported image URL: use https://, or a local file.");
  const type = IMAGE_TYPES[extname(source).toLowerCase()];
  if (!type) throw new Error(`Unsupported image type "${extname(source)}". Use ${Object.keys(IMAGE_TYPES).join(", ")}.`);
  const data = await read(source);
  if (data.length > MAX_IMAGE_BYTES) throw new Error(`Image is ${(data.length / 1048576).toFixed(1)} MB; the limit is 5 MB.`);
  return `data:${type};base64,${data.toString("base64")}`;
}

async function withRetry(fn, label) {
  try {
    return await fn();
  } catch (err) {
    if (![429, 502, 503].includes(err.status)) throw err;
    console.log(`  ${label} is busy (${err.status}); trying again in 20 s…`);
    await new Promise((r) => setTimeout(r, 20_000));
    return fn();
  }
}

async function main(argv) {
  const args = [...argv];
  const opt = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args.splice(i, 2)[1];
  };
  const allowPaid = args.includes("--allow-paid");
  if (allowPaid) args.splice(args.indexOf("--allow-paid"), 1);
  const modelArg = opt("--model");
  const ingredients = opt("--ingredients") ?? "eggs, spinach, cheddar cheese, tomatoes, milk, butter";
  const [kind, source] = args;

  const { config, problems } = loadConfig();
  if (problems.length) return fail(problems.join("\n  "));
  if (!["text", "image"].includes(kind) || (kind === "image" && !source)) {
    return fail("Usage: node scripts/try-models.mjs text | image <photo or https URL> [--model ...]");
  }
  const model = modelArg ?? (kind === "text" ? config.OPENROUTER_TEXT_MODEL : config.OPENROUTER_VISION_MODEL);
  if (!model.endsWith(":free") && !allowPaid) {
    return fail(`${model} is a paid model. Add --allow-paid to try it (it costs a little per request).`);
  }
  const client = createOpenRouterClient({ apiKey: config.OPENROUTER_API_KEY });

  let messages;
  if (kind === "text") {
    console.log(`Text generation with ${model}\nPrompt ingredients: ${ingredients}\n`);
    messages = [{ role: "user", content: recipePrompt(ingredients) }];
  } else {
    const url = await imageUrlFor(source);
    console.log(`Image recognition with ${model}\nImage: ${source}${url.startsWith("data:") ? ` (sent as ${Math.round((url.length * 3) / 4 / 1024)} KB base64)` : " (OpenRouter fetches the URL)"}\n`);
    messages = [{ role: "user", content: [{ type: "text", text: VISION_PROMPT }, { type: "image_url", image_url: { url } }] }];
  }

  const started = Date.now();
  try {
    const reply = await withRetry(() => client.chat({ model, messages, maxTokens: kind === "text" ? 900 : 700, temperature: 0.3 }), model);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const u = reply.usage ?? {};
    console.log(`✔ Answered in ${seconds} s by ${reply.model} · tokens in ${u.prompt_tokens ?? "?"}, out ${u.completion_tokens ?? "?"}${typeof u.cost === "number" ? ` · cost $${u.cost.toFixed(6)}` : ""}\n`);
    if (kind === "image") {
      const json = extractJson(reply.text);
      if (json?.ingredients) {
        console.log("Ingredients found:");
        for (const i of json.ingredients) console.log(`  - ${i.name}${i.quantity ? ` (${i.quantity})` : ""}${i.confidence ? ` [${i.confidence}]` : ""}`);
        if (json.notes) console.log(`Notes: ${json.notes}`);
        console.log("\n✔ The answer is valid JSON in the expected shape.");
      } else {
        console.log(reply.text);
        console.log("\n⚠ The answer wasn't the JSON shape asked for.");
        process.exitCode = 1;
      }
    } else {
      console.log(reply.text.trim());
    }
  } catch (err) {
    console.log(`✖ ${err.message}`);
    process.exitCode = 1;
  }
}

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.argv.slice(2));
}
