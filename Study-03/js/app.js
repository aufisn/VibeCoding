// Entry point. Phase 1: load and validate the question bank only.
// The game UI arrives in Phase 2.

import { validateQuestions } from "./validate.js";

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

/** Replace the whole page body with an error screen listing `messages`. */
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
  document.body.replaceChildren(main);
}

function showLoaded(count) {
  const status = document.getElementById("status");
  status.textContent = `Questions loaded: ${count}`;
  status.classList.add("is-ready");
}

async function init() {
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

  showLoaded(questions.length);
}

init();
