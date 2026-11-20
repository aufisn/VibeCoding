// FridgeChef page. Two ways to run, picked automatically:
// - local:  opened from this Mac's server (npm start) → POST /api/analyze
// - GitHub: opened from GitHub Pages → encrypted request through a secret Gist
//           and a GitHub Actions job (see remote.js)
// Either way the page never has the Anthropic key. Everything Claude returns
// is shown as text (textContent), never as HTML.

import { preparePhoto } from "./photo.js";
import { parseRecipe } from "./recipe.js";
import { askGitHub, forgetSettings, loadSettings, pendingRequest, saveSettings, SETTING_FIELDS, settingsProblems, waitForAnswer } from "./remote.js";

const $ = (id) => document.getElementById(id);
const LOCAL = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(location.hostname);
let photo = null; // the prepared photo { base64, mediaType, ... }
let busy = false;
let localReady = false;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
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
}

function updateButton() {
  const ready = LOCAL ? localReady : settingsProblems(loadSettings()).length === 0;
  $("go").disabled = busy || !photo || !ready;
}

function showResult(answer) {
  $("result").hidden = false;
  const list = $("ingredients");
  list.replaceChildren();
  for (const i of answer.ingredients ?? []) {
    const li = el("li");
    li.append(el("span", i.name), i.quantity ? el("span", ` · ${i.quantity}`, "qty") : "", el("span", i.confidence, `badge ${i.confidence}`));
    list.append(li);
  }
  if (!answer.ingredients?.length) list.append(el("li", "No food found in this photo."));
  $("notes").textContent = answer.notes ?? "";

  const box = $("recipe");
  box.replaceChildren();
  if (answer.recipe) {
    for (const b of parseRecipe(answer.recipe)) {
      if (b.type === "title") box.append(el("h3", b.text));
      else if (b.type === "heading") box.append(el("h4", b.text));
      else if (b.type === "para") box.append(el("p", b.text));
      else {
        const l = el(b.type === "steps" ? "ol" : "ul");
        for (const item of b.items) l.append(el("li", item));
        box.append(l);
      }
    }
  } else {
    box.append(el("p", "No recipe: Claude wasn't confident about any ingredient. Try a clearer, brighter photo."));
  }
  const cost = typeof answer.cost === "number" ? ` · cost $${answer.cost.toFixed(4)}` : "";
  $("meta").textContent = `${answer.model ?? "Claude"}${answer.seconds ? ` · Claude took ${answer.seconds} s` : ""}${cost}`;
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function askLocal(image) {
  const res = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
  return data;
}

async function run(task) {
  busy = true;
  updateButton();
  setError("");
  const started = Date.now();
  try {
    const answer = await task((text) => ($("progress").textContent = text));
    if (answer.ok === false) throw new Error(answer.error || "Claude couldn't answer.");
    showResult(answer);
    $("progress").textContent = `✔ Done in ${Math.round((Date.now() - started) / 1000)} s.`;
  } catch (err) {
    $("progress").textContent = "";
    setError(err.message, err.link);
  } finally {
    busy = false;
    updateButton();
  }
}

$("photo").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  setError("");
  photo = null;
  updateButton();
  if (!file) return;
  try {
    $("progress").textContent = "Preparing the photo…";
    photo = await preparePhoto(file);
    const preview = $("preview");
    if (preview.src) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    $("progress").textContent = `Photo ready (${photo.width}×${photo.height}, ${photo.kb} KB).`;
  } catch (err) {
    $("progress").textContent = "";
    setError(err.message);
  }
  updateButton();
});

$("go").addEventListener("click", () => {
  if (!photo) return;
  const image = { base64: photo.base64, mediaType: photo.mediaType };
  run(async (stage) => {
    if (LOCAL) {
      stage("Claude is looking at your fridge and writing a recipe…");
      return askLocal(image);
    }
    return askGitHub({ settings: loadSettings(), image, onStage: stage });
  });
});

/* ---------- Start-up ---------- */

if (LOCAL) {
  $("mode").textContent = "Running on this computer (local server)";
  $("local-setup").hidden = false;
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    if (!res.ok || !data.ready) throw new Error();
    localReady = Boolean(data.analyze);
    $("status").textContent = localReady
      ? `✔ Ready: the server has your Claude key (${data.models.vision}).`
      : "The server is using OpenRouter, which can't read photos here. Add ANTHROPIC_API_KEY to .env and restart.";
  } catch {
    $("status").textContent = "✖ The server isn't running. Start it with: npm start";
  }
} else {
  $("mode").textContent = "Running through GitHub (no laptop needed)";
  const setup = $("github-setup");
  setup.hidden = false;
  const form = $("settings");
  const fill = () => {
    const s = loadSettings();
    for (const f of SETTING_FIELDS) form.elements[f].value = s[f];
    const problems = settingsProblems(s);
    setup.open = problems.length > 0;
    $("settings-msg").textContent = problems.length ? "Fill in all four to start." : "✔ Connected settings saved on this device.";
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
    saveSettings(s);
    $("settings-msg").textContent = "✔ Saved on this device.";
    setup.open = false;
    updateButton();
  });
  $("forget").addEventListener("click", () => {
    forgetSettings();
    fill();
    updateButton();
  });

  // A request still waiting from last time (page closed or reloaded mid-wait)?
  const pending = pendingRequest();
  if (pending && settingsProblems(loadSettings()).length === 0) {
    run((stage) => {
      stage("Picking up your last request…");
      return waitForAnswer({ settings: loadSettings(), id: pending, onStage: stage });
    });
  }
}
updateButton();
