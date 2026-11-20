// FridgeChef's one job: a fridge photo in, ingredients and a recipe out.
// Used by the local server (POST /api/analyze) and the GitHub job
// (ci/run-request.mjs), so both give exactly the same answer.

import { IMAGE_MEDIA_TYPES } from "./claude.mjs";

export const MAX_IMAGE_BASE64 = 7 * 1024 * 1024; // about 5 MB of image

/** Throws a plain error unless `image` is { base64, mediaType } FridgeChef accepts. Pure. */
export function checkImage(image) {
  if (!image || typeof image.base64 !== "string" || !image.base64) throw Object.assign(new Error("No photo was sent."), { status: 400 });
  if (!IMAGE_MEDIA_TYPES.includes(image.mediaType)) throw Object.assign(new Error(`Unsupported photo type. Use ${IMAGE_MEDIA_TYPES.join(", ")}.`), { status: 400 });
  if (image.base64.length > MAX_IMAGE_BASE64) throw Object.assign(new Error("The photo is too large (over 5 MB)."), { status: 413 });
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image.base64)) throw Object.assign(new Error("The photo data is damaged."), { status: 400 });
}

/**
 * Asks Claude for the ingredients in the photo, then for a recipe using them.
 * @returns {{ ingredients, notes, recipe, model, cost, seconds }} (recipe is "" when nothing was found)
 */
export async function analyzeFridge(claude, image, now = () => Date.now()) {
  checkImage(image);
  const started = now();
  const found = await claude.identifyIngredients({ base64: image.base64, mediaType: image.mediaType });
  const ingredients = Array.isArray(found.ingredients) ? found.ingredients : [];
  let recipe = "";
  let cost = found.cost ?? 0;
  // Only confident finds go into the recipe: a guess shouldn't decide dinner.
  const usable = ingredients.filter((i) => i.confidence !== "low").map((i) => i.name);
  if (usable.length) {
    const written = await claude.writeRecipe(usable);
    recipe = written.text.trim();
    cost += written.cost ?? 0;
  }
  return {
    ingredients,
    notes: found.notes ?? "",
    recipe,
    model: found.model,
    cost: Math.round(cost * 1e6) / 1e6,
    seconds: Math.round((now() - started) / 100) / 10,
  };
}
