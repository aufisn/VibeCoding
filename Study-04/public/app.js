// FridgeChef page, in three steps like the book's app:
//   1 Recognize: a photo → ingredients by category
//   2 Adjust:    tick off what's wrong, add what's missing
//   3 Cook:      cuisine, difficulty, time, servings → two recipes
// plus Saved recipes (this device only) with a text download.
//
// Two ways to run, picked automatically:
// - local:  opened from this Mac's server (npm start) → /api/recognize, /api/recipes
// - GitHub: opened from GitHub Pages → encrypted requests through a secret Gist
//           and a GitHub Actions job (see remote.js)
// Either way the page never has the Anthropic key. Everything Claude returns
// is shown as text (textContent), never as HTML.

import { preparePhoto } from "./photo.js";
import { CATEGORIES, checkIngredients, checkOptions, cleanName, CUISINES, DEFAULT_OPTIONS, DIFFICULTIES, recipeText, SERVINGS, TIME, validIngredients, validRecipes, validSaved } from "./options.js";
import { askGitHub, forgetSettings, loadSettings, pendingRequest, saveSettings, SETTING_FIELDS, settingsProblems, waitForAnswer } from "./remote.js";

const $ = (id) => document.getElementById(id);
const LOCAL = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(location.hostname);
const KEYS = { ingredients: "fridgechef.ingredients.v1", options: "fridgechef.options.v1", saved: "fridgechef.saved.v1", recipes: "fridgechef.recipes.v1" };

let photo = null; // the prepared photo { base64, mediaType, ... }
let busy = false;
let localReady = false;
// Saved data is shape-checked: a bad entry is dropped instead of stopping the page.
let ingredients = validIngredients(load(KEYS.ingredients, [])); // [{ name, quantity, confidence, category, use }]
let recipes = validRecipes(load(KEYS.recipes, [])); // the last two recipes
let saved = validSaved(load(KEYS.saved, [])); // [{ savedAt, recipe }]
let sessionSettings = null; // GitHub settings kept for this visit only, when the browser won't store them
let waiting = null; // AbortController of the GitHub wait in progress, so "Forget" can stop it
const githubSettings = () => sessionSettings ?? loadSettings();

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return Array.isArray(fallback) ? (Array.isArray(v) ? v : fallback) : v ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the page still works for this visit */
  }
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, onClick, className = "secondary") {
  const b = el("button", text, className);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/* ---------- Tabs, progress, errors ---------- */

function showTab(name) {
  for (const t of document.querySelectorAll(".tab")) t.hidden = t.id !== `tab-${name}`;
  for (const b of document.querySelectorAll(".steps button")) {
    if (b.dataset.tab === name) b.setAttribute("aria-current", "step");
    else b.removeAttribute("aria-current");
  }
  if (name === "cook") renderCook();
  // On a phone the user may be far down the previous step: bring the new one into view.
  const section = $(`tab-${name}`);
  if (section.getBoundingClientRect().top < 0) section.scrollIntoView({ block: "start" });
}
for (const b of document.querySelectorAll(".steps button")) {
  b.addEventListener("click", () => {
    if (!busy) $("progress").textContent = ""; // an old "Done" line belongs to the step it came from
    showTab(b.dataset.tab);
  });
}

/** Marks the page as working: spinner, running timer, and a sticky status bar. Returns a stop function. */
function startBusy(started = Date.now()) {
  const bar = $("statusbar");
  const tick = () => ($("elapsed").textContent = `${Math.round((Date.now() - started) / 1000)} s`);
  bar.classList.add("busy");
  tick();
  const timer = setInterval(tick, 1000);
  return () => {
    clearInterval(timer);
    bar.classList.remove("busy");
    $("elapsed").textContent = "";
  };
}

function setError(message, link) {
  const box = $("error");
  box.replaceChildren();
  box.hidden = !message;
  if (!message) return;
  box.append(el("span", `✖ ${message}`));
  if (link && link.startsWith("https://github.com/")) {
    const a = el("a", " Open it");
    a.href = link;
    a.rel = "noreferrer";
    box.append(a);
  }
  // The button the user pressed may be far below on a phone: make sure the error is seen.
  if (box.getBoundingClientRect().top < 0) box.scrollIntoView({ block: "center" });
}

const ready = () => (LOCAL ? localReady : settingsProblems(githubSettings()).length === 0);
function updateButtons() {
  $("recognize").disabled = busy || !photo || !ready();
  $("cook").disabled = busy || !ready() || !ingredients.some((i) => i.use);
  // Say why a button is greyed out, so the next action is always clear.
  const notReady = ready() ? "" : LOCAL ? "The local server isn't ready: see the message at the top." : "First set up the GitHub connection.";
  setHint("recognize-hint", busy ? "" : notReady || (photo ? "" : "Choose a photo first."));
  setHint("cook-hint", busy ? "" : notReady || (ingredients.some((i) => i.use) ? "" : "Tick at least one ingredient in step 2 (Adjust) first."));
}
function setHint(id, text) {
  const hint = $(id);
  hint.replaceChildren();
  hint.hidden = !text;
  if (!text) return;
  hint.append(el("span", text));
  if (!LOCAL && !ready()) {
    hint.append(
      button("Open the connection form", () => {
        const setup = $("github-setup");
        setup.open = true;
        setup.scrollIntoView({ block: "start" });
        setup.querySelector("input")?.focus({ preventScroll: true });
      }, "link")
    );
  }
}

/** Sends a request (local server or GitHub) and hands the answer to `show`. */
async function run(payload, show) {
  busy = true;
  setError("");
  const started = Date.now();
  const pressed = $(payload.type === "recognize" ? "recognize" : "cook");
  const label = pressed.textContent;
  pressed.textContent = "Working…";
  const stopBusy = startBusy(started);
  updateButtons();
  const stage = (text) => ($("progress").textContent = text);
  try {
    let answer;
    if (LOCAL) {
      stage(payload.type === "recognize" ? "Claude is looking at your fridge…" : "Claude is writing two recipes…");
      const res = await fetch(`/api/${payload.type}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      answer = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(answer.error || `The server answered ${res.status}.`);
    } else {
      waiting = new AbortController();
      answer = await askGitHub({ settings: githubSettings(), payload, onStage: stage, signal: waiting.signal });
    }
    showAnswer(answer, started, show);
  } catch (err) {
    stage(err.name === "AbortError" ? "Stopped waiting." : "");
    if (err.name !== "AbortError") setError(err.message, err.link);
  } finally {
    stopBusy();
    pressed.textContent = label;
    waiting = null;
    busy = false;
    updateButtons();
  }
}

function showAnswer(answer, started, show) {
  if (answer.ok === false) throw new Error(answer.error || "Claude couldn't answer.");
  (show ?? (answer.type === "recipes" ? showRecipes : showIngredients))(answer);
  const cost = typeof answer.cost === "number" ? ` · cost $${answer.cost.toFixed(4)}` : "";
  $("progress").textContent = `✔ Done in ${Math.round((Date.now() - started) / 1000)} s${cost}.`;
}

/* ---------- 1. Recognize ---------- */

$("photo").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  setError("");
  photo = null;
  updateButtons();
  if (!file) return;
  try {
    $("progress").textContent = "Preparing the photo…";
    photo = await preparePhoto(file);
    const preview = $("preview");
    if (preview.src) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    $("no-photo").hidden = true;
    $("progress").textContent = `Photo ready (${photo.width}×${photo.height}, ${photo.kb} KB).`;
  } catch (err) {
    // Don't leave the previous photo on show for a file that wasn't usable.
    const preview = $("preview");
    if (preview.src) URL.revokeObjectURL(preview.src);
    preview.removeAttribute("src");
    preview.hidden = true;
    $("no-photo").hidden = false;
    $("progress").textContent = "";
    setError(err.message);
  }
  updateButtons();
});

$("recognize").addEventListener("click", () => {
  if (photo) run({ type: "recognize", image: { base64: photo.base64, mediaType: photo.mediaType } });
});

function showIngredients(answer) {
  // Low-confidence guesses start unticked: you decide whether they're really there.
  ingredients = (answer.ingredients ?? []).map((i) => ({ ...i, name: cleanName(i.name), use: i.confidence !== "low" }));
  store(KEYS.ingredients, ingredients);
  $("notes").textContent = answer.notes ?? "";
  renderIngredients();
  showTab("adjust");
}

/* ---------- 2. Adjust ---------- */

function renderIngredients() {
  const box = $("groups");
  box.replaceChildren();
  const groups = CATEGORIES.map((c) => [c, ingredients.filter((i) => (i.category ?? "other") === c)]).filter(([, list]) => list.length);
  $("found-summary").textContent = ingredients.length
    ? `${ingredients.length} ingredient${ingredients.length === 1 ? "" : "s"} across ${groups.length} categor${groups.length === 1 ? "y" : "ies"}. Untick anything that's wrong.`
    : "Nothing yet: recognize a photo first, or add ingredients yourself.";
  for (const [category, list] of groups) {
    const group = el("fieldset", null, "group");
    group.append(el("legend", `${category} · ${list.length}`));
    for (const item of list) {
      const label = el("label", null, "item");
      const box2 = el("input");
      box2.type = "checkbox";
      box2.checked = item.use;
      box2.addEventListener("change", () => {
        item.use = box2.checked;
        store(KEYS.ingredients, ingredients);
        updateButtons();
      });
      label.append(box2, el("span", item.name), item.quantity ? el("span", item.quantity, "qty") : "");
      if (item.confidence === "low" || item.confidence === "medium") label.append(el("span", item.confidence === "low" ? "unsure" : "likely", `badge ${item.confidence}`));
      group.append(label);
    }
    box.append(group);
  }
  updateButtons();
}

$("add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = cleanName($("add-name").value);
  if (!name) return;
  if (!ingredients.some((i) => i.name.toLowerCase() === name.toLowerCase())) ingredients.push({ name, quantity: "", confidence: "high", category: "other", use: true, added: true });
  else ingredients.find((i) => i.name.toLowerCase() === name.toLowerCase()).use = true;
  $("add-name").value = "";
  store(KEYS.ingredients, ingredients);
  renderIngredients();
});

$("to-cook").addEventListener("click", () => showTab("cook"));

/* ---------- 3. Cook ---------- */

function fillOptions() {
  const o = { ...DEFAULT_OPTIONS, ...load(KEYS.options, {}) };
  for (const [id, list] of [["cuisine", CUISINES], ["difficulty", DIFFICULTIES]]) {
    $(id).replaceChildren(...list.map((v) => Object.assign(el("option", v), { value: v })));
  }
  Object.assign($("time"), { min: TIME.min, max: TIME.max, step: TIME.step });
  Object.assign($("servings"), { min: SERVINGS.min, max: SERVINGS.max, step: 1 });
  try {
    const ok = checkOptions(o);
    $("cuisine").value = ok.cuisine;
    $("difficulty").value = ok.difficulty;
    $("time").value = ok.maxMinutes;
    $("servings").value = ok.servings;
  } catch {
    Object.assign($("cuisine"), { value: DEFAULT_OPTIONS.cuisine });
  }
  showOptionValues();
}
function readOptions() {
  return checkOptions({ cuisine: $("cuisine").value, difficulty: $("difficulty").value, maxMinutes: Number($("time").value), servings: Number($("servings").value) });
}
function showOptionValues() {
  $("time-out").textContent = `${$("time").value} min`;
  $("servings-out").textContent = $("servings").value;
}
for (const id of ["cuisine", "difficulty", "time", "servings"]) {
  $(id).addEventListener("input", () => {
    showOptionValues();
    store(KEYS.options, readOptions());
  });
}

function renderCook() {
  const using = ingredients.filter((i) => i.use).map((i) => i.name);
  $("using").textContent = using.length ? `Using: ${using.join(", ")}` : "No ingredients ticked: go back to step 2.";
  updateButtons();
}

$("cook").addEventListener("click", () => {
  try {
    const list = checkIngredients(ingredients.filter((i) => i.use).map((i) => i.name));
    run({ type: "recipes", ingredients: list, options: readOptions() });
  } catch (err) {
    setError(err.message);
  }
});

function showRecipes(answer) {
  recipes = answer.recipes ?? [];
  store(KEYS.recipes, recipes);
  renderRecipes();
  showTab("cook");
  // On a narrow screen the recipes land below the options: show them.
  if (matchMedia("(max-width: 760px)").matches) $("recipes").scrollIntoView({ block: "start" });
}

function renderRecipes() {
  $("recipes").replaceChildren(...recipes.map((r) => recipeCard(r, { save: true })));
}

/* ---------- Recipes and Saved ---------- */

function download(recipe) {
  const url = URL.createObjectURL(new Blob([recipeText(recipe)], { type: "text/plain;charset=utf-8" }));
  const a = el("a");
  a.href = url;
  a.download = `${(recipe.title || "recipe").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "recipe"}.txt`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function recipeCard(r, { save, savedAt, onDelete } = {}) {
  const card = el("article", null, "recipe");
  // Title with its actions beside it, so Save is in view as soon as the recipe appears.
  const head = el("div", null, "recipe-head");
  const row = el("div", null, "row");
  head.append(el("h3", r.title), row);
  card.append(head);
  if (r.summary) card.append(el("p", r.summary, "summary"));
  card.append(el("p", `${r.cuisine} · ${r.difficulty} · ${r.minutes} min · serves ${r.servings}`, "facts"));
  // Ingredients and steps side by side, so a recipe fits on one screen.
  const body = el("div", null, "recipe-body");
  const left = el("div");
  const ul = el("ul");
  for (const i of r.ingredients ?? []) ul.append(el("li", `${i.amount ? `${i.amount} ` : ""}${i.item}`));
  left.append(el("h4", "Ingredients"), ul);
  const right = el("div");
  const ol = el("ol");
  for (const s of r.steps ?? []) ol.append(el("li", s));
  right.append(el("h4", "Steps"), ol);
  body.append(left, right);
  card.append(body);
  if (r.extra?.length) card.append(el("p", `You may need: ${r.extra.join(", ")}`, "note"));
  if (save) {
    const already = saved.some((s) => s.recipe.title === r.title && s.recipe.steps?.join() === r.steps?.join());
    const b = button(already ? "✔ Saved" : "Save", () => {
      saved.unshift({ savedAt: new Date().toISOString(), recipe: r });
      saved = saved.slice(0, 50);
      store(KEYS.saved, saved);
      b.textContent = "✔ Saved";
      b.disabled = true;
      renderSaved();
    });
    b.disabled = already;
    row.append(b);
  }
  row.append(Object.assign(button("Download .txt", () => download(r)), { title: "Download this recipe as a text file" }));
  if (onDelete) row.append(button("Delete", onDelete));
  if (savedAt) card.append(el("p", `Saved ${new Date(savedAt).toLocaleDateString()}`, "note"));
  return card;
}

function renderSaved() {
  $("saved-count").textContent = saved.length ? `(${saved.length})` : "";
  const box = $("saved");
  box.replaceChildren();
  if (!saved.length) box.append(el("p", "No saved recipes yet. Use Save under a recipe.", "note"));
  saved.forEach((s, n) => {
    const details = el("details", null, "saved-item");
    details.append(el("summary", s.recipe.title));
    details.append(
      recipeCard(s.recipe, {
        savedAt: s.savedAt,
        onDelete: () => {
          if (!confirm(`Delete "${s.recipe.title}" from your saved recipes? This can't be undone.`)) return;
          saved.splice(n, 1);
          store(KEYS.saved, saved);
          renderSaved();
          renderRecipes();
        },
      })
    );
    box.append(details);
  });
}

/* ---------- Start-up ---------- */

fillOptions();
renderIngredients();
renderRecipes();
renderSaved();

if (LOCAL) {
  // The server status lives in the header line, so every step keeps its full height.
  $("mode").textContent = "Local server · checking…";
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    if (!res.ok || !data.ready) throw new Error();
    localReady = Boolean(data.analyze);
    if (localReady) $("mode").textContent = `✔ Local server ready (${data.models.vision}) · your API key stays on it`;
    else {
      $("mode").textContent = "Local server not ready";
      setError("The server is using OpenRouter, which can't read photos. Add ANTHROPIC_API_KEY to .env and restart it.");
    }
  } catch {
    $("mode").textContent = "Local server not running";
    setError("The local server isn't running. Start it with: npm start, then reload this page.");
  }
} else {
  $("mode").textContent = "Running through GitHub (no laptop needed)";
  const setup = $("github-setup");
  setup.hidden = false;
  const form = $("settings");
  const fill = () => {
    const s = githubSettings();
    for (const f of SETTING_FIELDS) form.elements[f].value = s[f];
    const problems = settingsProblems(s);
    setup.open = problems.length > 0;
    $("settings-msg").textContent = problems.length ? "Fill in all four to start." : sessionSettings ? "✔ Connection set for this visit only." : "✔ Connection saved on this device.";
  };
  fill();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const s = Object.fromEntries(SETTING_FIELDS.map((f) => [f, form.elements[f].value.trim()]));
    const problems = settingsProblems(s);
    if (problems.length) {
      $("settings-msg").textContent = `✖ ${problems.join(" ")}`;
      return;
    }
    sessionSettings = saveSettings(s) ? null : s;
    $("settings-msg").textContent = sessionSettings
      ? "⚠ This browser won't save it (storage is blocked or full), so it works only until you close this page."
      : "✔ Saved on this device.";
    setup.open = false;
    updateButtons();
  });
  $("forget").addEventListener("click", () => {
    waiting?.abort(); // stop any wait: its answer can't be decrypted without the passphrase anyway
    sessionSettings = null;
    forgetSettings();
    fill();
    updateButtons();
  });

  // A request still waiting from last time (page closed or reloaded mid-wait)?
  const pending = pendingRequest();
  if (pending && ready()) {
    busy = true;
    waiting = new AbortController();
    const started = Date.now();
    const stopBusy = startBusy(started);
    $("progress").textContent = "Picking up your last request…";
    waitForAnswer({ settings: githubSettings(), id: pending, resumed: true, signal: waiting.signal, onStage: (t) => ($("progress").textContent = t) })
      .then((answer) => showAnswer(answer, started))
      .catch((err) => {
        $("progress").textContent = err.name === "AbortError" ? "Stopped waiting." : "";
        if (err.name !== "AbortError") setError(err.message, err.link);
      })
      .finally(() => {
        stopBusy();
        waiting = null;
        busy = false;
        updateButtons();
      });
  }
}
showTab("recognize");
updateButtons();
