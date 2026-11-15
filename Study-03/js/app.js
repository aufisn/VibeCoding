// Entry point: load and validate the questions (blocking error screen on
// failure), then wire the game state, the UI and storage together.

import { validateQuestions } from "./validate.js";
import { createGame } from "./state.js";
import { createUI } from "./ui.js";
import { saveRun, loadRuns, clearRuns } from "./storage.js";
import { bindThemeToggle } from "./theme.js";

const QUESTIONS_URL = "data/questions.json";

async function loadQuestions() {
  // The timestamp query defeats any HTTP cache, so edits to the JSON show
  // up on a plain reload (some browsers ignore `cache: "no-store"`).
  const response = await fetch(`${QUESTIONS_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load ${QUESTIONS_URL} (HTTP ${response.status})`);
  }
  try {
    return await response.json();
  } catch (err) {
    throw new Error(`${QUESTIONS_URL} is not valid JSON: ${err.message}`);
  }
}

/** Replace the page's <main> with an error screen listing `messages`. */
function showErrorScreen(title, messages) {
  const main = document.createElement("main");
  main.className = "error-screen";
  main.setAttribute("role", "alert");

  const h1 = document.createElement("h1");
  h1.textContent = title;

  const intro = document.createElement("p");
  intro.textContent =
    "The quiz can't start until these problems in the question data are fixed:";

  const list = document.createElement("ul");
  for (const message of messages) {
    const li = document.createElement("li");
    li.textContent = message; // textContent, never innerHTML: data is untrusted
    list.append(li);
  }

  main.append(h1, intro, list);
  // Keep the top bar (and its theme switch); replace only the content.
  const current = document.querySelector("main");
  if (current) current.replaceWith(main);
  else document.body.append(main);
}

async function init() {
  const toggle = document.getElementById("theme-toggle");
  if (toggle) bindThemeToggle(toggle);

  let questions;
  try {
    questions = await loadQuestions();
  } catch (err) {
    showErrorScreen("Couldn't load questions", [err.message]);
    return;
  }

  const { errors, warnings } = validateQuestions(questions);
  if (warnings.length > 0) {
    console.info(`Question bank: ${warnings.length} warning(s)`, warnings);
  }
  if (errors.length > 0) {
    showErrorScreen(`Question data has ${errors.length} error(s)`, errors);
    return;
  }

  const game = createGame(questions);
  const ui = createUI(document.getElementById("app"), game, {
    onResults() {
      // takeResultToSave() hands out each finished run once, so a
      // re-rendered Results screen can't save it twice.
      const record = game.takeResultToSave();
      return record && saveRun(record) ? record : null;
    },
    getRuns: () => loadRuns(),
    clearRuns: () => clearRuns(),
  });
  ui.render({ focus: false });
  registerServiceWorker(() => ui.setOfflineReady());
}

/**
 * Offline support (sw.js). Only on https or localhost, where browsers allow
 * service workers. Any failure is ignored: the game works without it.
 * @param {() => void} onReady runs once the precache is complete
 */
function registerServiceWorker(onReady) {
  try {
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
    if (!("serviceWorker" in navigator) || (location.protocol !== "https:" && !local)) return;
    navigator.serviceWorker
      .register("sw.js")
      // ready resolves once a worker is active, i.e. its install (the
      // precache) has finished.
      .then(() => navigator.serviceWorker.ready)
      .then(() => onReady())
      .catch((err) => console.info("Service worker not available:", err));
  } catch (err) {
    console.info("Service worker not available:", err);
  }
}

init();
