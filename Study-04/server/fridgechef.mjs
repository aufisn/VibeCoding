// FridgeChef's two jobs, used by the local server and the GitHub job
// (ci/run-request.mjs), so both give exactly the same answers:
//   recognize: a fridge photo in → ingredients (with categories)
//   cook:      ingredient names + options in → two recipes

import { IMAGE_MEDIA_TYPES } from "./claude.mjs";
import { CATEGORIES, checkIngredients, checkOptions } from "../public/options.js";

export const MAX_IMAGE_BASE64 = Math.ceil((5 * 1024 * 1024) / 3) * 4; // base64 of exactly 5 MB

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const round = (n) => Math.round(n * 1e6) / 1e6;

/** Throws a plain error unless `image` is { base64, mediaType } FridgeChef accepts. Pure. */
export function checkImage(image) {
  if (!image || typeof image.base64 !== "string" || !image.base64) throw fail("No photo was sent.");
  if (!IMAGE_MEDIA_TYPES.includes(image.mediaType)) throw fail(`Unsupported photo type. Use ${IMAGE_MEDIA_TYPES.join(", ")}.`);
  if (image.base64.length > MAX_IMAGE_BASE64) throw fail("The photo is too large (over 5 MB).", 413);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image.base64)) throw fail("The photo data is damaged.");
}

/** @returns {{ type: "recognize", ingredients, notes, model, cost, seconds }} */
export async function recognize(claude, image, now = () => Date.now()) {
  checkImage(image);
  const started = now();
  const found = await claude.identifyIngredients({ base64: image.base64, mediaType: image.mediaType });
  const ingredients = (Array.isArray(found.ingredients) ? found.ingredients : []).map((i) => ({
    ...i,
    category: CATEGORIES.includes(i.category) ? i.category : "other",
  }));
  return { type: "recognize", ingredients, notes: found.notes ?? "", model: found.model, cost: round(found.cost ?? 0), seconds: Math.round((now() - started) / 100) / 10 };
}

/** @returns {{ type: "recipes", recipes, ingredients, options, model, cost, seconds }} */
export async function cook(claude, { ingredients, options }, now = () => Date.now()) {
  const names = checkIngredients(ingredients);
  const opts = checkOptions(options);
  const started = now();
  const written = await claude.writeRecipes(names, opts);
  return { type: "recipes", recipes: written.recipes, ingredients: names, options: opts, model: written.model, cost: round(written.cost ?? 0), seconds: Math.round((now() - started) / 100) / 10 };
}

/** Runs a request from the page: { type: "recognize", image } or { type: "recipes", ingredients, options }. */
export async function handleRequest(claude, request, now) {
  if (request?.type === "recognize") return recognize(claude, request.image, now);
  if (request?.type === "recipes") return cook(claude, request, now);
  throw fail("Unknown request type.");
}
