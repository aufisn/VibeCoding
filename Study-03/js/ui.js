// Rendering and event handling only. All game rules live in state.js.
// The DOM is built with createElement/textContent; question data never
// goes through innerHTML.

import { NICKNAME_MAX } from "./config.js";
import { SCREENS } from "./state.js";

const LETTERS = ["A", "B", "C", "D"];
const SVG_NS = "http://www.w3.org/2000/svg";
const ICON_PATHS = {
  check: "M5 12.5l4.5 4.5L19 7.5",
  cross: "M6.5 6.5l11 11M17.5 6.5l-11 11",
};

/* ---------- DOM helpers ---------- */

/**
 * Create an element. `props` keys: className, text, attrs (object),
 * on (object of event handlers), plus any direct DOM property.
 */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  const { className, text, attrs, on, ...rest } = props;
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (on) for (const [type, fn] of Object.entries(on)) node.addEventListener(type, fn);
  Object.assign(node, rest);
  node.append(...children.filter(Boolean));
  return node;
}

function icon(kind) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", `icon icon-${kind}`);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICON_PATHS[kind]);
  svg.append(path);
  return svg;
}

/** Text only screen readers hear. */
function srOnly(text) {
  return el("span", { className: "visually-hidden", text });
}

/** "Arts & Culture" -> "arts-culture", used to pick the accent colour. */
function categorySlug(category) {
  return String(category).toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
}

/** Heading that receives focus when its screen appears. */
function focusHeading(level, text, className = "screen-title") {
  return el(level, { className, text, attrs: { tabindex: "-1", "data-autofocus": "" } });
}

/* ---------- UI ---------- */

/**
 * @param {HTMLElement} container where screens are rendered, one at a time
 * @param {ReturnType<import("./state.js").createGame>} game
 * @param {{ onResults?: () => void }} [hooks] onResults runs each time the
 *   Results screen renders (the app saves there; the state guards against
 *   double-saving)
 */
export function createUI(container, game, { onResults = () => {} } = {}) {
  const exitDialog = buildExitDialog();
  document.body.append(exitDialog.dialog);

  function render({ focus = true } = {}) {
    const state = game.getState();
    const screen = {
      [SCREENS.START]: renderStart,
      [SCREENS.QUESTION]: renderQuestion,
      [SCREENS.SUMMARY]: renderSummary,
      [SCREENS.RESULTS]: renderResults,
    }[state.screen](state);

    container.replaceChildren(screen);
    if (state.screen === SCREENS.RESULTS) onResults();
    if (focus) screen.querySelector("[data-autofocus]")?.focus();
  }

  /* ----- Start ----- */

  function renderStart(state) {
    const input = el("input", {
      id: "nickname",
      type: "text",
      value: state.nickname,
      maxLength: NICKNAME_MAX,
      autocomplete: "nickname",
      spellcheck: false,
      attrs: { "aria-describedby": "nickname-hint" },
    });

    const form = el(
      "form",
      {
        className: "start-form",
        on: {
          submit(event) {
            event.preventDefault();
            if (game.start(input.value)) render();
          },
        },
      },
      [
        el("label", { htmlFor: "nickname", text: "Nickname (optional)" }),
        input,
        el("p", { id: "nickname-hint", className: "hint", text: `Up to ${NICKNAME_MAX} characters.` }),
        el("button", {
          type: "submit",
          className: "btn btn-primary",
          text: "Start",
          // After "Play again", focus Start so one press begins the new run.
          attrs: state.nickname ? { "data-autofocus": "" } : {},
        }),
      ]
    );

    return el("section", { className: "screen screen-start" }, [
      el("h1", { className: "app-title", text: "Quiz Game", attrs: { tabindex: "-1", ...(state.nickname ? {} : { "data-autofocus": "" }) } }),
      el("p", { className: "app-tagline", text: "General knowledge in four categories" }),
      el("ul", { className: "rules" }, [
        el("li", { text: "40 questions: History, Science, Geography, then Arts & Culture." }),
        el("li", { text: "One try per question. No skipping, no going back, no timer." }),
      ]),
      form,
    ]);
  }

  /* ----- Question ----- */

  function renderQuestion(state) {
    const { question } = state;
    const slug = categorySlug(state.category);

    const scoreValue = el("span", { text: String(state.score) });
    const progressFill = el("div", { className: "progress-fill" });
    const progress = el(
      "div",
      {
        className: "progress",
        attrs: {
          role: "progressbar",
          "aria-label": "Quiz progress",
          "aria-valuemin": "0",
          "aria-valuemax": String(state.totalQuestions),
        },
      },
      [progressFill]
    );
    function setProgress(answered) {
      progress.setAttribute("aria-valuenow", String(answered));
      progress.setAttribute("aria-valuetext", `${answered} of ${state.totalQuestions} answered`);
      progressFill.style.width = `${(answered / state.totalQuestions) * 100}%`;
    }
    setProgress(state.answeredCount);

    const heading = focusHeading("h2", question.question, "question-text");
    heading.id = "question-text";

    const feedback = el("div", { className: "feedback", attrs: { "aria-live": "polite" } });
    const nextButton = el("button", {
      type: "button",
      className: "btn btn-primary",
      text: "Next",
      disabled: true,
      on: {
        click() {
          if (game.next()) render();
        },
      },
    });

    const optionButtons = question.options.map((text, i) =>
      el(
        "button",
        {
          type: "button",
          className: "option",
          on: { click: () => choose(i) },
        },
        [
          el("span", { className: "option-letter", text: LETTERS[i], attrs: { "aria-hidden": "true" } }),
          srOnly(`${LETTERS[i]}: `),
          el("span", { className: "option-text", text }),
          el("span", { className: "option-mark" }),
        ]
      )
    );

    // All feedback is applied synchronously, in the click handler.
    function choose(optionIndex) {
      if (!game.answer(optionIndex)) return;
      const { answer, score, answeredCount } = game.getState();

      optionButtons.forEach((button, i) => {
        button.disabled = true;
        const mark = button.querySelector(".option-mark");
        if (i === answer.correctIndex) {
          button.classList.add("is-correct");
          mark.append(icon("check"), srOnly(" (correct answer)"));
        } else if (i === answer.chosenIndex) {
          button.classList.add("is-wrong");
          mark.append(icon("cross"), srOnly(" (your answer, incorrect)"));
        }
        if (i === answer.chosenIndex) button.setAttribute("aria-pressed", "true");
      });

      feedback.replaceChildren(
        el("p", { className: `feedback-result ${answer.correct ? "is-correct" : "is-wrong"}` }, [
          icon(answer.correct ? "check" : "cross"),
          el("span", { text: answer.correct ? "Correct" : "Incorrect" }),
        ]),
        el("p", { className: "feedback-explanation", text: question.explanation })
      );

      scoreValue.textContent = String(score);
      setProgress(answeredCount);
      nextButton.disabled = false;
      // The chosen button just became disabled and lost focus; keep keyboard
      // users in place. The live region still announces the feedback.
      nextButton.focus();
    }

    const exitButton = el("button", {
      type: "button",
      className: "btn btn-quiet exit-button",
      text: "Exit",
      on: { click: () => exitDialog.open() },
    });

    return el("section", { className: "screen screen-question", attrs: { "data-category": slug } }, [
      el("div", { className: "question-header" }, [
        el("p", { className: "category-name", text: state.category }),
        exitButton,
      ]),
      el("div", { className: "question-meta" }, [
        el("span", { text: `${state.positionInCategory} of ${state.categorySize}` }),
        el("span", {}, [document.createTextNode("Score: "), scoreValue]),
      ]),
      progress,
      heading,
      el("div", { className: "options", attrs: { role: "group", "aria-labelledby": "question-text" } }, optionButtons),
      feedback,
      el("div", { className: "actions" }, [nextButton]),
    ]);
  }

  /* ----- Category summary ----- */

  function renderSummary(state) {
    return el("section", { className: "screen screen-summary", attrs: { "data-category": categorySlug(state.category) } }, [
      el("p", { className: "category-name", text: `Category ${state.categoryIndex + 1} of ${state.categoryCount} complete` }),
      focusHeading("h2", state.category),
      el("p", { className: "big-score" }, [
        el("span", { className: "big-score-value", text: String(state.categoryScore) }),
        el("span", { className: "big-score-max", text: ` / ${state.categorySize}` }),
      ]),
      el("p", { className: "running-total", text: `Total so far: ${state.score} / ${state.answeredCount}` }),
      el("div", { className: "actions" }, [
        el("button", {
          type: "button",
          className: "btn btn-primary",
          text: state.isLastCategory ? "See results" : "Continue",
          on: {
            click() {
              if (game.next()) render();
            },
          },
        }),
      ]),
    ]);
  }

  /* ----- Results ----- */

  function renderResults(state) {
    const rows = Object.entries(state.byCategory).map(([category, n]) =>
      el("tr", { attrs: { "data-category": categorySlug(category) } }, [
        el("th", { scope: "row", text: category }),
        el("td", { text: `${n} / ${state.categorySize}` }),
      ])
    );

    return el("section", { className: "screen screen-results" }, [
      focusHeading("h2", state.nickname ? `Well played, ${state.nickname}!` : "Your results"),
      el("p", { className: "big-score" }, [
        el("span", { className: "big-score-value", text: String(state.total) }),
        el("span", { className: "big-score-max", text: ` / ${state.totalQuestions}` }),
      ]),
      el("p", { className: "tier" }, [
        el("span", { className: "tier-label", text: "Rank: " }),
        el("strong", { className: "tier-name", text: state.tier.name }),
      ]),
      el("table", { className: "category-table" }, [
        el("caption", { text: "Score by category" }),
        el("tbody", {}, rows),
      ]),
      document.createComment(" PHASE 3 PLACEHOLDER: 'Review mistakes' and 'Leaderboard' links go here. "),
      el("section", { className: "placeholder", attrs: { "data-placeholder": "phase-3", "aria-label": "Coming soon" } }, [
        el("p", { className: "placeholder-title", text: "Coming soon" }),
        el("ul", {}, [
          el("li", { text: "Review mistakes" }),
          el("li", { text: "Leaderboard" }),
        ]),
      ]),
      el("div", { className: "actions" }, [
        el("button", {
          type: "button",
          className: "btn btn-primary",
          text: "Play again",
          on: {
            click() {
              if (game.toStart()) render();
            },
          },
        }),
      ]),
    ]);
  }

  /* ----- Exit confirmation (native <dialog>) ----- */

  function buildExitDialog() {
    const title = el("h2", { id: "exit-title", text: "Leave this quiz?" });
    const cancel = el("button", { type: "button", className: "btn btn-secondary", text: "Keep playing" });
    const confirm = el("button", { type: "button", className: "btn btn-danger", text: "Exit quiz" });
    const dialog = el(
      "dialog",
      { className: "dialog", attrs: { "aria-labelledby": "exit-title", "aria-describedby": "exit-desc" } },
      [
        title,
        el("p", { id: "exit-desc", text: "Your progress in this run will be lost and nothing will be saved." }),
        el("div", { className: "dialog-actions" }, [cancel, confirm]),
      ]
    );

    cancel.addEventListener("click", () => dialog.close());
    confirm.addEventListener("click", () => {
      dialog.close();
      if (game.exit()) render();
    });
    // Escape fires "cancel" and closes the dialog natively: that resumes play.

    return {
      dialog,
      open() {
        dialog.showModal();
        cancel.focus(); // safe default: the non-destructive choice
      },
    };
  }

  return { render };
}
