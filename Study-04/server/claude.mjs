// FridgeChef's Claude client (Anthropic API, official SDK). One model does
// both steps: it reads the fridge photo and writes the recipe. The API key is
// held by the SDK client inside this module and sent only to api.anthropic.com.
// Errors returned to callers are short plain messages without the key.

import Anthropic from "@anthropic-ai/sdk";

import { CATEGORIES } from "../public/options.js";

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";

/** USD per million tokens (input, output), to show what each request cost. */
export const PRICES = Object.freeze({
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
});

export const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** The answer shape for ingredient recognition, enforced by structured outputs. */
export const INGREDIENTS_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          quantity: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          category: { type: "string", enum: CATEGORIES },
        },
        required: ["name", "quantity", "confidence", "category"],
        additionalProperties: false,
      },
    },
    notes: { type: "string" },
  },
  required: ["ingredients", "notes"],
  additionalProperties: false,
});

export const VISION_PROMPT = `This is a photo of food, usually the inside of a refrigerator.
List every food ingredient you can see, with a rough quantity, how confident you are (high, medium or low), and its category (${CATEGORIES.join(", ")}).
Use simple English ingredient names, such as "eggs" or "cheddar cheese". Name what's inside a container only when you can tell; otherwise describe it (e.g. "leftovers in a container") with low confidence. Skip non-food items.
In notes, mention anything unclear in one or two short sentences, or leave it empty.`;

export const recipePrompt = (ingredients) => `Ingredients available: ${ingredients}.
Write one simple home recipe that uses mainly these ingredients (salt, pepper, oil and water may be added).
Format: a title line, then "Ingredients:" as a list with amounts, then "Steps:" as a numbered list, then "Time:" in minutes. Keep it under 200 words.`;

/** The answer shape for "two recipes", enforced by structured outputs. */
export const RECIPES_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    recipes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          cuisine: { type: "string" },
          difficulty: { type: "string", enum: ["Easy", "Medium", "Hard"] },
          minutes: { type: "integer" },
          servings: { type: "integer" },
          ingredients: {
            type: "array",
            items: { type: "object", properties: { item: { type: "string" }, amount: { type: "string" } }, required: ["item", "amount"], additionalProperties: false },
          },
          steps: { type: "array", items: { type: "string" } },
          extra: { type: "array", items: { type: "string" } },
        },
        required: ["title", "summary", "cuisine", "difficulty", "minutes", "servings", "ingredients", "steps", "extra"],
        additionalProperties: false,
      },
    },
  },
  required: ["recipes"],
  additionalProperties: false,
});

/** The prompt for two recipes from a checked ingredient list and checked options. Pure. */
export const recipesPrompt = (ingredients, o) => `Ingredients available: ${ingredients.join(", ")}.
Write two different home recipes that use mainly these ingredients.
- Cuisine: ${o.cuisine === "Any" ? "any (pick what suits the ingredients; make the two recipes different styles)" : o.cuisine}
- Difficulty: ${o.difficulty} or easier
- Total time: at most ${o.maxMinutes} minutes, including preparation
- Servings: ${o.servings}
Salt, pepper, oil and water may always be added. In "extra", list anything else a recipe needs that isn't in the list (keep it short; empty if nothing).
Give amounts for ${o.servings} serving(s). Steps are short, clear sentences without numbers. "summary" is one sentence. "minutes" is the honest total time.`;

/** Cost in USD of one response's usage, or null for an unknown model. Pure. */
export function costOf(model, usage) {
  const p = PRICES[model];
  if (!p || !usage) return null;
  return ((usage.input_tokens ?? 0) * p.input + (usage.output_tokens ?? 0) * p.output) / 1_000_000;
}

/** A plain message for an SDK error, never containing the key. Pure. */
export function describeClaudeError(err) {
  const status = err?.status;
  const apiMessage = String(err?.error?.error?.message ?? "");
  if (status === 400 && /download/i.test(apiMessage)) {
    return "Anthropic couldn't download the image from that URL (some sites block it). Save the photo and use the file instead.";
  }
  if (status === 400 && /workspace/i.test(apiMessage)) {
    return "This API key isn't scoped to a workspace. Either create a key inside a workspace (Claude Console → API keys), or set ANTHROPIC_WORKSPACE_ID=wrkspc_… in .env.";
  }
  const known = {
    400: "Claude couldn't use the request (for example an unreadable or oversized image).",
    401: "Anthropic refused the API key. Check ANTHROPIC_API_KEY in .env, or create a new key in the Claude Console.",
    403: "This API key isn't allowed to use that model.",
    404: "That model isn't available. Check ANTHROPIC_MODEL in .env.",
    413: "The image is too large. Use a photo under 5 MB.",
    429: "Too many requests or spending limit reached. Wait a moment and try again.",
    529: "Claude is overloaded right now. Try again shortly.",
  };
  if (known[status]) return known[status];
  if (status >= 500) return "Anthropic had a server error. Try again shortly.";
  if (err?.name === "APIConnectionTimeoutError") return "Claude took too long to answer.";
  if (err?.name === "APIConnectionError") return "Couldn't reach Anthropic. Check the internet connection.";
  return "The request to Claude failed.";
}

export class ClaudeError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ClaudeError";
    this.status = status;
  }
}

/**
 * @param {{ apiKey?: string, model?: string, sdk?: object }} options
 *   `sdk` replaces the Anthropic client in tests.
 */
export function createClaudeClient({ apiKey, model = DEFAULT_CLAUDE_MODEL, workspaceId, sdk } = {}) {
  if (!apiKey && !sdk) throw new Error("createClaudeClient needs an apiKey");
  // A key that isn't scoped to a workspace must name one on every request.
  const defaultHeaders = workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined;
  const client = sdk ?? new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000, defaultHeaders });

  async function ask(content, extra = {}) {
    let response;
    try {
      // Server-side fallback: if Claude declines on safety grounds, the API
      // retries on a suitable model within the same call.
      response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages: [{ role: "user", content }],
        ...extra,
      });
    } catch (err) {
      throw new ClaudeError(describeClaudeError(err), err?.status ?? 0);
    }
    if (response.stop_reason === "refusal") throw new ClaudeError("Claude declined this request.", 200);
    if (response.stop_reason === "max_tokens") throw new ClaudeError("The answer was cut off. Try again.", 200);
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    if (!text.trim()) throw new ClaudeError("Claude returned an empty answer. Try again.", 200);
    // Price by the model that actually answered (a fallback may differ from the
    // one asked for); costOf gives null for a model it has no price for.
    return { text, model: response.model, usage: response.usage, cost: costOf(response.model || model, response.usage) };
  }

  return {
    model,

    /** Checks the key and the model without generating anything (no cost). */
    async checkModel() {
      try {
        const info = await client.models.retrieve(model);
        return { id: info.id, name: info.display_name ?? info.id };
      } catch (err) {
        throw new ClaudeError(describeClaudeError(err), err?.status ?? 0);
      }
    },

    /**
     * Ingredients in a photo. `image` is { base64, mediaType } or { url } (https).
     * @returns {{ ingredients: {name, quantity, confidence}[], notes: string, usage, cost, model }}
     */
    async identifyIngredients(image) {
      let source;
      if (image?.url) {
        if (!/^https:\/\//i.test(image.url)) throw new ClaudeError("Image URLs must start with https://", 400);
        source = { type: "url", url: image.url };
      } else {
        if (!IMAGE_MEDIA_TYPES.includes(image?.mediaType)) throw new ClaudeError(`Unsupported image type. Use ${IMAGE_MEDIA_TYPES.join(", ")}.`, 400);
        source = { type: "base64", media_type: image.mediaType, data: image.base64 };
      }
      const reply = await ask(
        [
          { type: "image", source },
          { type: "text", text: VISION_PROMPT },
        ],
        { output_config: { format: { type: "json_schema", schema: INGREDIENTS_SCHEMA } } }
      );
      let parsed;
      try {
        parsed = JSON.parse(reply.text);
      } catch {
        throw new ClaudeError("Claude's ingredient list couldn't be read. Try again.", 200);
      }
      return { ingredients: parsed.ingredients, notes: parsed.notes, usage: reply.usage, cost: reply.cost, model: reply.model };
    },

    /**
     * Two recipes from checked ingredient names and checked options (see public/options.js).
     * @returns {{ recipes: object[], usage, cost, model }}
     */
    async writeRecipes(ingredients, options) {
      const reply = await ask(recipesPrompt(ingredients, options), { output_config: { format: { type: "json_schema", schema: RECIPES_SCHEMA } } });
      let parsed;
      try {
        parsed = JSON.parse(reply.text);
      } catch {
        throw new ClaudeError("Claude's recipes couldn't be read. Try again.", 200);
      }
      const recipes = (parsed.recipes ?? []).slice(0, 2);
      if (!recipes.length) throw new ClaudeError("Claude didn't return any recipes. Try again.", 200);
      return { recipes, usage: reply.usage, cost: reply.cost, model: reply.model };
    },

    /** A recipe (plain text) from a list or comma-separated string of ingredients. */
    async writeRecipe(ingredients) {
      const list = Array.isArray(ingredients) ? ingredients.join(", ") : String(ingredients);
      return ask(recipePrompt(list));
    },
  };
}
