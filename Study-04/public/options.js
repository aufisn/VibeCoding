// What you can ask FridgeChef for, and the checks on it. Shared by the page,
// the local server and the GitHub job, so all three agree. Pure.

export const CATEGORIES = ["vegetables", "fruits", "dairy & eggs", "meat & seafood", "grains & bread", "sauces & condiments", "beverages", "other"];
export const CUISINES = ["Any", "Italian", "Mexican", "Asian", "Indian", "Middle Eastern", "Mediterranean", "American", "French"];
export const DIFFICULTIES = ["Easy", "Medium", "Hard"];
export const TIME = { min: 10, max: 120, step: 5, default: 30 };
export const SERVINGS = { min: 1, max: 8, default: 2 };
export const DEFAULT_OPTIONS = Object.freeze({ cuisine: "Any", difficulty: "Easy", maxMinutes: TIME.default, servings: SERVINGS.default });

export const MAX_INGREDIENTS = 60;
export const MAX_NAME = 60;

const bad = (message) => Object.assign(new Error(message), { status: 400 });

/** A tidy ingredient name: no control characters, single spaces, at most 60 characters. */
export const cleanName = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);

/** The ingredient names to cook with, cleaned and without duplicates; throws a plain error if unusable. */
export function checkIngredients(list) {
  if (!Array.isArray(list)) throw bad("Send the ingredients as a list.");
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const name = cleanName(typeof item === "string" ? item : item?.name);
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push(name);
    }
  }
  if (!out.length) throw bad("Pick at least one ingredient.");
  if (out.length > MAX_INGREDIENTS) throw bad(`That's too many ingredients (the limit is ${MAX_INGREDIENTS}).`);
  return out;
}

/** The recipe options, checked; missing ones get the defaults. Throws a plain error on a bad value. */
export function checkOptions(o = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "")) };
  if (!CUISINES.includes(opts.cuisine)) throw bad(`Cuisine must be one of: ${CUISINES.join(", ")}.`);
  if (!DIFFICULTIES.includes(opts.difficulty)) throw bad(`Difficulty must be one of: ${DIFFICULTIES.join(", ")}.`);
  const minutes = Number(opts.maxMinutes);
  const servings = Number(opts.servings);
  if (!Number.isInteger(minutes) || minutes < TIME.min || minutes > TIME.max) throw bad(`Max time must be ${TIME.min}–${TIME.max} minutes.`);
  if (!Number.isInteger(servings) || servings < SERVINGS.min || servings > SERVINGS.max) throw bad(`Servings must be ${SERVINGS.min}–${SERVINGS.max}.`);
  return { cuisine: opts.cuisine, difficulty: opts.difficulty, maxMinutes: minutes, servings };
}

/** A recipe as plain text, for downloading. Pure. */
export function recipeText(r) {
  const lines = [r.title, ""];
  if (r.summary) lines.push(r.summary, "");
  lines.push(`${r.cuisine} · ${r.difficulty} · ${r.minutes} min · serves ${r.servings}`, "", "Ingredients:");
  for (const i of r.ingredients ?? []) lines.push(`- ${i.amount ? `${i.amount} ` : ""}${i.item}`);
  lines.push("", "Steps:");
  (r.steps ?? []).forEach((s, n) => lines.push(`${n + 1}. ${s}`));
  if (r.extra?.length) lines.push("", `You may need: ${r.extra.join(", ")}`);
  lines.push("", "Made with FridgeChef (Claude)");
  return lines.join("\n");
}

/* ---------- Data saved on this device, checked on load ---------- */
// localStorage can hold anything (an old version, a hand edit, a cut-off
// write), so the page keeps only entries of the right shape. Pure.

const text = (v, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const texts = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === "string") : []);

/** Saved ingredients: entries with a name, tidied; anything else is dropped. */
export function validIngredients(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const i of list) {
    const name = typeof i?.name === "string" ? cleanName(i.name) : "";
    if (!name) continue;
    out.push({
      name,
      quantity: cleanName(i.quantity),
      confidence: ["high", "medium", "low"].includes(i.confidence) ? i.confidence : "high",
      category: CATEGORIES.includes(i.category) ? i.category : "other",
      use: i.use === true,
      ...(i.added === true ? { added: true } : {}),
    });
  }
  return out.slice(0, 200);
}

/** One recipe in the shape the page shows, or null. */
function validRecipe(r) {
  if (!r || typeof r !== "object" || typeof r.title !== "string" || !r.title.trim()) return null;
  return {
    title: text(r.title, 200),
    summary: text(r.summary),
    cuisine: text(r.cuisine, 60),
    difficulty: text(r.difficulty, 20),
    minutes: Number.isFinite(r.minutes) ? r.minutes : 0,
    servings: Number.isFinite(r.servings) ? r.servings : 0,
    ingredients: (Array.isArray(r.ingredients) ? r.ingredients : []).filter((i) => typeof i?.item === "string").map((i) => ({ item: text(i.item, 200), amount: text(i.amount, 100) })),
    steps: texts(r.steps),
    extra: texts(r.extra),
  };
}

/** Saved recipes (the last answer): valid ones only. */
export const validRecipes = (list) => (Array.isArray(list) ? list.map(validRecipe).filter(Boolean) : []);

/** The Saved list: [{ savedAt, recipe }] with a valid recipe, at most 50. */
export function validSaved(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => typeof s?.savedAt === "string")
    .map((s) => ({ savedAt: s.savedAt, recipe: validRecipe(s.recipe) }))
    .filter((s) => s.recipe)
    .slice(0, 50);
}
