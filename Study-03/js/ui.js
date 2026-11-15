// Rendering and event handling only. All game rules live in state.js.
// The DOM is built with createElement/textContent; question data never
// goes through innerHTML.

import { ALL_SUBJECTS, CATEGORIES, NICKNAME_MAX, QUESTIONS_PER_CATEGORY } from "./config.js";
import { SCREENS } from "./state.js";

const LETTERS = ["A", "B", "C", "D"];
const SVG_NS = "http://www.w3.org/2000/svg";
const ICON_PATHS = {
  check: "M5 12.5l4.5 4.5L19 7.5",
  cross: "M6.5 6.5l11 11M17.5 6.5l-11 11",
};
// Outline icons (drawn thinner than check/cross).
const LINE_ICON_PATHS = {
  history: "M3 21h18M5 21v-9M9.7 21v-9M14.3 21v-9M19 21v-9M2.5 9.5L12 4l9.5 5.5z",
  science: "M9 3h6M10 3v6.5L4.8 18.4A1.8 1.8 0 0 0 6.4 21h11.2a1.8 1.8 0 0 0 1.6-2.6L14 9.5V3M7.3 15h9.4",
  geography: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3.5 9h17M3.5 15h17M12 3c-3.5 4-3.5 14 0 18M12 3c3.5 4 3.5 14 0 18",
  "arts-culture": "M12 3a9 9 0 0 0 0 18c1.4 0 2-.9 2-1.8 0-1.2-1-1.6-1-2.7 0-1 .8-1.5 1.8-1.5H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3zM7.5 12h.01M9 7.5h.01M14.5 7h.01",
  all: "M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z",
  eliminate: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M8 12h8",
  skip: "M5 6l6 6-6 6M13 6l6 6-6 6",
  exit: "M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10",
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

function lineIcon(kind) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", `icon-line icon-${kind}`);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", LINE_ICON_PATHS[kind]);
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
  let hasPlayed = false; // decides what the Start screen focuses
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
      placeholder: "e.g. Sam",
      attrs: { "aria-describedby": "nickname-hint" },
    });

    function startWith(subject) {
      if (game.start(input.value, subject)) {
        hasPlayed = true;
        render();
      }
    }

    // Enter in the nickname box plays every subject (the form's implicit
    // submit would otherwise pick the first card, History).
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        startWith(ALL_SUBJECTS);
      }
    });

    const subjects = [...CATEGORIES, ALL_SUBJECTS].map((subject) => {
      const isAll = subject === ALL_SUBJECTS;
      const slug = isAll ? "all" : categorySlug(subject);
      const count = isAll ? CATEGORIES.length * QUESTIONS_PER_CATEGORY : QUESTIONS_PER_CATEGORY;
      // After "Play again", focus the subject just played: one press replays it.
      const autofocus = hasPlayed && subject === state.subject;
      return el(
        "button",
        {
          type: "submit",
          name: "subject",
          value: subject,
          className: `subject-card${isAll ? " subject-all" : ""}`,
          attrs: { "data-category": slug, ...(autofocus ? { "data-autofocus": "" } : {}) },
        },
        [
          el("span", { className: "subject-icon" }, [lineIcon(slug)]),
          el("span", { className: "subject-text" }, [
            el("span", { className: "subject-name", text: isAll ? "All subjects" : subject }),
            el("span", { className: "subject-count", text: `${count} questions` }),
          ]),
        ]
      );
    });

    const form = el(
      "form",
      {
        className: "start-form",
        on: {
          submit(event) {
            event.preventDefault();
            startWith(event.submitter?.value ?? ALL_SUBJECTS);
          },
        },
      },
      [
        el("div", { className: "field" }, [
          el("label", { htmlFor: "nickname", text: "Nickname (optional)" }),
          input,
          el("p", { id: "nickname-hint", className: "hint", text: `Up to ${NICKNAME_MAX} characters.` }),
        ]),
        el("fieldset", { className: "subjects" }, [
          el("legend", { text: "Choose a subject to start" }),
          el("div", { className: "subject-grid" }, subjects),
        ]),
      ]
    );

    return el("section", { className: "screen screen-start" }, [
      el("div", { className: "hero" }, [
        el("h1", {
          className: "app-title",
          text: "How much do you know?",
          attrs: { tabindex: "-1", ...(hasPlayed ? {} : { "data-autofocus": "" }) },
        }),
        el("p", { className: "app-tagline", text: "Pick one subject for a quick round of 10, or play all four." }),
      ]),
      form,
      el("div", { className: "how-to card" }, [
        el("h2", { className: "how-to-title", text: "How it works" }),
        el("ul", { className: "rules" }, [
          el("li", { text: "One try per question: your first answer locks, and you see right away if it was right." }),
          el("li", {}, [el("strong", { text: "Eliminate" }), document.createTextNode(" removes one wrong answer from the current question.")]),
          el("li", {}, [el("strong", { text: "Skip" }), document.createTextNode(" moves on without answering. A skipped question scores 0.")]),
        ]),
      ]),
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
      progress.setAttribute("aria-valuetext", `${answered} of ${state.totalQuestions} done`);
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
    // Restore options already removed, in case this question is re-rendered.
    for (const i of state.eliminated) markEliminated(optionButtons[i]);

    function markEliminated(button) {
      button.disabled = true;
      button.classList.add("is-eliminated");
      button.querySelector(".option-mark").replaceChildren(srOnly(" (eliminated)"));
    }

    const lifelineStatus = el("p", { className: "lifeline-status", attrs: { "aria-live": "polite" } });

    const eliminateButton = el(
      "button",
      {
        type: "button",
        className: "btn btn-secondary lifeline",
        disabled: !state.canEliminate,
        on: { click: eliminate },
      },
      [lineIcon("eliminate"), el("span", { text: "Eliminate" })]
    );

    const skipButton = el(
      "button",
      {
        type: "button",
        className: "btn btn-secondary lifeline",
        disabled: !state.canSkip,
        on: {
          click() {
            if (game.skip()) render();
          },
        },
      },
      [lineIcon("skip"), el("span", { text: "Skip" })]
    );

    function eliminate() {
      const before = new Set(game.getState().eliminated);
      if (!game.eliminate()) return;
      const after = game.getState();
      const removed = after.eliminated.find((i) => !before.has(i));
      markEliminated(optionButtons[removed]);
      lifelineStatus.textContent = `Option ${LETTERS[removed]} removed: it was a wrong answer.`;
      eliminateButton.disabled = !after.canEliminate;
      if (eliminateButton.disabled) optionButtons.find((b) => !b.disabled)?.focus();
    }

    // All feedback is applied synchronously, in the click handler.
    function choose(optionIndex) {
      if (!game.answer(optionIndex)) return;
      const { answer, score, answeredCount } = game.getState();

      eliminateButton.disabled = true;
      skipButton.disabled = true;
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

    const exitButton = el(
      "button",
      {
        type: "button",
        className: "btn btn-quiet exit-button",
        on: { click: () => exitDialog.open() },
      },
      [lineIcon("exit"), el("span", { text: "Exit" })]
    );

    const position =
      state.categoryCount > 1
        ? `Question ${state.positionInCategory} of ${state.categorySize} · ${state.index + 1} of ${state.totalQuestions} overall`
        : `Question ${state.positionInCategory} of ${state.categorySize}`;

    return el("section", { className: "screen screen-question", attrs: { "data-category": slug } }, [
      el("div", { className: "question-header" }, [
        el("p", { className: "category-chip" }, [lineIcon(slug), el("span", { text: state.category })]),
        exitButton,
      ]),
      el("div", { className: "question-meta" }, [
        el("span", { text: position }),
        el("span", { className: "score-pill" }, [document.createTextNode("Score "), scoreValue]),
      ]),
      progress,
      el("div", { className: "card question-card" }, [
        heading,
        el("div", { className: "options", attrs: { role: "group", "aria-labelledby": "question-text" } }, optionButtons),
        el("div", { className: "lifelines" }, [eliminateButton, skipButton]),
        lifelineStatus,
      ]),
      feedback,
      el("div", { className: "actions" }, [nextButton]),
    ]);
  }

  /* ----- Category summary ----- */

  function renderSummary(state) {
    return el("section", { className: "screen screen-summary card", attrs: { "data-category": categorySlug(state.category) } }, [
      el("span", { className: "summary-icon" }, [lineIcon(categorySlug(state.category))]),
      el("p", { className: "category-name", text: `Category ${state.categoryIndex + 1} of ${state.categoryCount} complete` }),
      focusHeading("h2", state.category),
      el("p", { className: "big-score" }, [
        el("span", { className: "big-score-value", text: String(state.categoryScore) }),
        el("span", { className: "big-score-max", text: ` / ${state.categorySize}` }),
      ]),
      state.categorySkipped > 0
        ? el("p", { className: "running-total", text: `Skipped: ${state.categorySkipped}` })
        : null,
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
    const single = state.playCategories.length === 1;
    const rows = Object.entries(state.byCategory).map(([category, n]) =>
      el("tr", { attrs: { "data-category": categorySlug(category) } }, [
        el("th", { scope: "row", text: category }),
        el("td", { text: `${n} / ${QUESTIONS_PER_CATEGORY}` }),
      ])
    );
    const stats = [
      `Subject: ${single ? state.subject : "All subjects"}`,
      `Skipped: ${state.skippedCount}`,
      `Eliminations used: ${state.eliminationsUsed}`,
    ];

    return el(
      "section",
      { className: "screen screen-results", attrs: single ? { "data-category": categorySlug(state.subject) } : {} },
      [
        el("div", { className: "card results-card" }, [
          focusHeading("h2", state.nickname ? `Well played, ${state.nickname}!` : "Your results"),
          el("p", { className: "big-score" }, [
            el("span", { className: "big-score-value", text: String(state.total) }),
            el("span", { className: "big-score-max", text: ` / ${state.maxScore}` }),
          ]),
          el("p", { className: "tier" }, [
            el("span", { className: "tier-label", text: "Rank: " }),
            el("strong", { className: "tier-name", text: state.tier.name }),
          ]),
          el("ul", { className: "stats" }, stats.map((text) => el("li", { text }))),
        ]),
        single
          ? null
          : el("table", { className: "category-table" }, [
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
      ]
    );
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
