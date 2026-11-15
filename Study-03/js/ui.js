// Rendering and event handling only. All game rules live in state.js, and
// keyboard rules in keys.js. The DOM is built with createElement/textContent;
// question and saved data never go through innerHTML.

import { ALL_SUBJECTS, CATEGORIES, NICKNAME_MAX, QUESTIONS_PER_CATEGORY, TOTAL_QUESTIONS } from "./config.js";
import { SCREENS } from "./state.js";
import { mapKey } from "./keys.js";
import { topRuns } from "./storage.js";

const LETTERS = ["A", "B", "C", "D"];
const LEADERBOARD_SIZE = 10;
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
  trophy: "M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5v1.5A3.5 3.5 0 0 0 8 11M16 6h3.5v1.5A3.5 3.5 0 0 1 16 11M12 13v4M8.5 20h7M10 17h4v3h-4z",
  review: "M4 5h16M4 12h10M4 19h7M16 16l2 2 4-4",
  back: "M15 5l-7 7 7 7",
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

function svgIcon(d, className) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", className);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

const icon = (kind) => svgIcon(ICON_PATHS[kind], `icon icon-${kind}`);
const lineIcon = (kind) => svgIcon(LINE_ICON_PATHS[kind], `icon-line icon-${kind}`);

/** Text only screen readers hear. */
function srOnly(text) {
  return el("span", { className: "visually-hidden", text });
}

/** "Arts & Culture" -> "arts-culture", used to pick the accent colour. */
function categorySlug(category) {
  return String(category).toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
}

/** The screen's heading. It receives focus on every screen change. */
function focusHeading(level, text, className = "screen-title") {
  return el(level, { className, text, attrs: { tabindex: "-1", "data-autofocus": "" } });
}

function button(label, { className = "btn btn-primary", iconKind, onClick } = {}) {
  return el(
    "button",
    { type: "button", className, on: onClick ? { click: onClick } : undefined },
    [iconKind ? lineIcon(iconKind) : null, el("span", { text: label })]
  );
}

/** Date in the user's locale; "Unknown date" if unparseable. */
function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  try {
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

const sameRun = (a, b) =>
  Boolean(a && b) && a.finishedAt === b.finishedAt && a.total === b.total && a.nickname === b.nickname;

/* ---------- UI ---------- */

/**
 * @param {HTMLElement} container where screens are rendered, one at a time
 * @param {ReturnType<import("./state.js").createGame>} game
 * @param {object} [hooks]
 * @param {() => object | null} [hooks.onResults] runs each time the Results
 *   screen renders and returns the record it saved, if any (the state hands
 *   each run out once, so nothing is saved twice). Used for the leaderboard
 *   highlight.
 * @param {() => object[]} [hooks.getRuns] saved runs (never throws)
 * @param {() => boolean} [hooks.clearRuns] remove the saved runs
 */
export function createUI(
  container,
  game,
  { onResults = () => null, getRuns = () => [], clearRuns = () => false } = {}
) {
  let justFinished = null; // the record saved for the run that just ended
  let offlineReady = false;
  let questionView = null; // { choose(i), next() } while a question is showing

  const exitDialog = buildConfirmDialog({
    id: "exit",
    title: "Leave this quiz?",
    description: "Your progress in this run will be lost and nothing will be saved.",
    cancelText: "Keep playing",
    confirmText: "Exit quiz",
    onConfirm() {
      if (game.exit()) render();
    },
  });
  const clearDialog = buildConfirmDialog({
    id: "clear",
    title: "Clear history?",
    description: "This deletes every saved run on this device. It can't be undone.",
    cancelText: "Cancel",
    confirmText: "Clear history",
    onConfirm() {
      clearRuns();
      justFinished = null;
      render();
    },
  });
  document.body.append(exitDialog.dialog, clearDialog.dialog);
  document.addEventListener("keydown", onKeydown);

  function render({ focus = true } = {}) {
    const state = game.getState();
    questionView = null;
    if (state.screen === SCREENS.RESULTS) {
      const saved = onResults();
      if (saved) justFinished = saved;
    }
    const screen = {
      [SCREENS.START]: renderStart,
      [SCREENS.QUESTION]: renderQuestion,
      [SCREENS.SUMMARY]: renderSummary,
      [SCREENS.RESULTS]: renderResults,
      [SCREENS.REVIEW]: renderReview,
      [SCREENS.LEADERBOARD]: renderLeaderboard,
    }[state.screen](state);

    container.replaceChildren(screen);
    if (focus) screen.querySelector("[data-autofocus]")?.focus();
  }

  /** Show the "Offline ready" note (the service worker has precached). */
  function setOfflineReady() {
    offlineReady = true;
    const note = container.querySelector(".offline-note");
    if (note) note.hidden = false;
  }

  /* ----- Keyboard shortcuts (Question screen) ----- */

  function onKeydown(event) {
    if (!questionView || event.repeat) return;
    const state = game.getState();
    const target = event.target instanceof Element ? event.target : null;
    const action = mapKey(event.key, {
      screen: state.screen,
      answered: Boolean(state.answer),
      dialogOpen: Boolean(document.querySelector("dialog[open]")),
      inTextField: Boolean(target?.closest("input, textarea, select, [contenteditable]")),
      // Exit, Eliminate, Skip and the theme switch handle Enter/Space natively.
      onOtherControl: Boolean(target?.closest("button, a[href]")) && !target.closest(".option, .next-button"),
      modifier: event.ctrlKey || event.metaKey || event.altKey,
      optionCount: state.question.options.length,
      eliminated: state.eliminated,
    });
    if (!action) return;
    // Stops the browser's own click on a focused button, so one key press
    // is handled exactly once.
    event.preventDefault();
    if (action.type === "select") questionView.choose(action.index);
    else questionView.next();
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
      if (game.start(input.value, subject)) render();
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
      return el(
        "button",
        {
          type: "submit",
          name: "subject",
          value: subject,
          className: `subject-card${isAll ? " subject-all" : ""}`,
          attrs: { "data-category": slug },
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
        focusHeading("h1", "How much do you know?", "app-title"),
        el("p", { className: "app-tagline", text: "Pick one subject for a quick round of 10, or play all four." }),
      ]),
      form,
      el("div", { className: "start-links" }, [
        button("Leaderboard", {
          className: "btn btn-secondary",
          iconKind: "trophy",
          onClick() {
            if (game.openLeaderboard()) render();
          },
        }),
      ]),
      el("div", { className: "how-to card" }, [
        el("h2", { className: "how-to-title", text: "How it works" }),
        el("ul", { className: "rules" }, [
          el("li", { text: "One try per question: your first answer locks, and you see right away if it was right." }),
          el("li", {}, [el("strong", { text: "Eliminate" }), document.createTextNode(" removes one wrong answer from the current question.")]),
          el("li", {}, [el("strong", { text: "Skip" }), document.createTextNode(" moves on without answering. A skipped question scores 0.")]),
          el("li", {}, [
            el("strong", { text: "Keyboard:" }),
            document.createTextNode(" press A to D (or 1 to 4) to answer, then Enter or Space for the next question."),
          ]),
        ]),
      ]),
      el("p", { className: "offline-note", hidden: !offlineReady, attrs: { role: "status" } }, [
        icon("check"),
        el("span", { text: "Offline ready: you can play without a connection." }),
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
    function setProgress(done) {
      progress.setAttribute("aria-valuenow", String(done));
      progress.setAttribute("aria-valuetext", `${done} of ${state.totalQuestions} done`);
      progressFill.style.width = `${(done / state.totalQuestions) * 100}%`;
    }
    setProgress(state.answeredCount);

    const heading = focusHeading("h2", question.question, "question-text");
    heading.id = "question-text";

    // The live region is always in the DOM (and never display:none) so
    // screen readers reliably announce what is put into it.
    const feedback = el("div", { className: "feedback-region", attrs: { "aria-live": "polite" } });

    const nextButton = el("button", {
      type: "button",
      className: "btn btn-primary next-button",
      text: "Next",
      disabled: true,
      on: { click: next },
    });

    function next() {
      if (game.next()) render();
    }

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
          srOnly(`Option ${LETTERS[i]}: `),
          el("span", { className: "option-text", text }),
          el("span", { className: "option-mark" }),
        ]
      )
    );
    // Locked options use aria-disabled (not `disabled`) so they stay
    // focusable and readable by screen reader users.
    const lock = (b) => b.setAttribute("aria-disabled", "true");
    const isLocked = (b) => b.getAttribute("aria-disabled") === "true";

    function markEliminated(b) {
      lock(b);
      b.classList.add("is-eliminated");
      b.querySelector(".option-mark").replaceChildren(srOnly(" (eliminated)"));
    }
    for (const i of state.eliminated) markEliminated(optionButtons[i]);

    const lifelineStatus = el("p", { className: "lifeline-status", attrs: { "aria-live": "polite" } });

    const eliminateButton = button("Eliminate", {
      className: "btn btn-secondary lifeline",
      iconKind: "eliminate",
      onClick: eliminate,
    });
    eliminateButton.disabled = !state.canEliminate;

    const skipButton = button("Skip", {
      className: "btn btn-secondary lifeline",
      iconKind: "skip",
      onClick() {
        if (game.skip()) render();
      },
    });
    skipButton.disabled = !state.canSkip;

    function eliminate() {
      const before = new Set(game.getState().eliminated);
      if (!game.eliminate()) return;
      const after = game.getState();
      const removed = after.eliminated.find((i) => !before.has(i));
      markEliminated(optionButtons[removed]);
      lifelineStatus.textContent = `Option ${LETTERS[removed]} removed: it was a wrong answer.`;
      eliminateButton.disabled = !after.canEliminate;
      if (eliminateButton.disabled) optionButtons.find((b) => !isLocked(b))?.focus();
    }

    // All feedback is applied synchronously, in the click/key handler.
    function choose(optionIndex) {
      if (isLocked(optionButtons[optionIndex]) || !game.answer(optionIndex)) return;
      const { answer, score, answeredCount } = game.getState();
      const correctLabel = `${LETTERS[answer.correctIndex]}: ${answer.correctText}`;

      eliminateButton.disabled = true;
      skipButton.disabled = true;
      optionButtons.forEach((b, i) => {
        lock(b);
        const mark = b.querySelector(".option-mark");
        if (i === answer.correctIndex) {
          b.classList.add("is-correct");
          mark.append(icon("check"), srOnly(" (correct answer)"));
        } else if (i === answer.chosenIndex) {
          b.classList.add("is-wrong");
          mark.append(icon("cross"), srOnly(" (your answer, incorrect)"));
        }
        if (i === answer.chosenIndex) b.setAttribute("aria-pressed", "true");
      });

      feedback.replaceChildren(
        el("div", { className: "feedback" }, [
          el("p", { className: `feedback-result ${answer.correct ? "is-correct" : "is-wrong"}` }, [
            icon(answer.correct ? "check" : "cross"),
            el("span", { text: answer.correct ? "Correct" : `Incorrect. The correct answer is ${correctLabel}` }),
          ]),
          el("p", { className: "feedback-explanation", text: question.explanation }),
        ])
      );

      scoreValue.textContent = String(score);
      setProgress(answeredCount);
      nextButton.disabled = false;
      // Keyboard users land on Next; the live region announces the result.
      nextButton.focus();
    }

    questionView = { choose, next };

    const exitButton = button("Exit", {
      className: "btn btn-quiet exit-button",
      iconKind: "exit",
      onClick: (event) => exitDialog.open(event.currentTarget),
    });

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
        button(state.isLastCategory ? "See results" : "Continue", {
          onClick() {
            if (game.next()) render();
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

    const review =
      state.mistakes.length > 0
        ? button(`Review mistakes (${state.mistakes.length})`, {
            className: "btn btn-secondary",
            iconKind: "review",
            onClick() {
              if (game.openReview()) render();
            },
          })
        : el("p", { className: "perfect" }, [icon("check"), el("span", { text: "Perfect score, nothing to review" })]);

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
        el("div", { className: "results-links" }, [
          review,
          button("Leaderboard", {
            className: "btn btn-secondary",
            iconKind: "trophy",
            onClick() {
              if (game.openLeaderboard()) render();
            },
          }),
        ]),
        el("div", { className: "actions" }, [
          button("Play again", {
            onClick() {
              if (game.toStart()) render();
            },
          }),
        ]),
      ]
    );
  }

  /* ----- Review mistakes ----- */

  function renderReview(state) {
    const back = (className) =>
      button("Back to results", {
        className,
        iconKind: "back",
        onClick() {
          if (game.closeReview()) render();
        },
      });

    const groups = state.playCategories
      .map((category) => [category, state.mistakes.filter((m) => m.category === category)])
      .filter(([, list]) => list.length > 0)
      .map(([category, list]) =>
        el("section", { className: "review-group", attrs: { "data-category": categorySlug(category) } }, [
          el("h3", { className: "review-category" }, [
            lineIcon(categorySlug(category)),
            el("span", { text: `${category} (${list.length})` }),
          ]),
          el(
            "ol",
            { className: "review-list" },
            list.map((m) =>
              el("li", { className: "card review-item" }, [
                el("p", { className: "review-question", text: m.question }),
                el("p", { className: "review-answer is-wrong" }, [
                  m.skipped ? lineIcon("skip") : icon("cross"),
                  el("span", {}, [
                    el("span", { className: "review-label", text: "Your answer: " }),
                    el("span", { text: m.skipped ? "Skipped" : m.chosenText }),
                  ]),
                ]),
                el("p", { className: "review-answer is-correct" }, [
                  icon("check"),
                  el("span", {}, [
                    el("span", { className: "review-label", text: "Correct answer: " }),
                    el("span", { text: m.correctText }),
                  ]),
                ]),
                el("p", { className: "review-explanation", text: m.explanation }),
              ])
            )
          ),
        ])
      );

    const wrong = state.mistakes.filter((m) => !m.skipped).length;
    const skipped = state.mistakes.length - wrong;
    const parts = [`${wrong} wrong`];
    if (skipped > 0) parts.push(`${skipped} skipped`);

    return el("section", { className: "screen screen-review" }, [
      el("div", { className: "screen-head" }, [back("btn btn-quiet")]),
      focusHeading("h2", "Review mistakes"),
      el("p", { className: "app-tagline", text: `${parts.join(", ")}. The right answers are below.` }),
      ...groups,
      el("div", { className: "actions" }, [back("btn btn-primary")]),
    ]);
  }

  /* ----- Leaderboard ----- */

  function renderLeaderboard(state) {
    const fromResults = state.leaderboardFrom === SCREENS.RESULTS;
    let runs = [];
    try {
      runs = topRuns(getRuns(), LEADERBOARD_SIZE);
    } catch {
      runs = []; // corrupt or blocked storage: show the empty state
    }
    const highlight = fromResults ? justFinished : null;
    const highlightShown = runs.some((r) => sameRun(r, highlight));

    const back = button(fromResults ? "Back to results" : "Back", {
      className: "btn btn-quiet",
      iconKind: "back",
      onClick() {
        if (game.closeLeaderboard()) render();
      },
    });

    let body;
    if (runs.length === 0) {
      body = el("p", { className: "empty-state card", text: "No saved runs yet. Finish a game to appear here." });
    } else {
      const rows = runs.map((run, i) => {
        const isNew = sameRun(run, highlight);
        const name = typeof run.nickname === "string" && run.nickname.trim() ? run.nickname : "Anonymous";
        const max = Number.isInteger(run.maxScore) && run.maxScore > 0 ? run.maxScore : TOTAL_QUESTIONS;
        return el("tr", { className: isNew ? "is-new" : "", attrs: isNew ? { "aria-current": "true" } : {} }, [
          el("td", { className: "lb-rank", text: String(i + 1) }),
          el("th", { scope: "row", className: "lb-name" }, [
            el("span", { text: name }),
            isNew ? el("span", { className: "new-badge", text: "This run" }) : null,
            typeof run.subject === "string" && run.subject !== ALL_SUBJECTS
              ? el("span", { className: "lb-subject", text: run.subject })
              : null,
          ]),
          el("td", { className: "lb-score", text: `${run.total} / ${max}` }),
          el("td", { className: "lb-tier", text: typeof run.tier === "string" ? run.tier : "" }),
          el("td", { className: "lb-date", text: formatDate(run.finishedAt) }),
        ]);
      });
      body = el("div", { className: "table-scroll" }, [
        el("table", { className: "leaderboard-table" }, [
          el("caption", { className: "visually-hidden", text: `Top ${LEADERBOARD_SIZE} saved runs` }),
          el("thead", {}, [
            el("tr", {}, ["#", "Name", "Score", "Rank", "Date"].map((h) => el("th", { scope: "col", text: h }))),
          ]),
          el("tbody", {}, rows),
        ]),
      ]);
    }

    return el("section", { className: "screen screen-leaderboard" }, [
      el("div", { className: "screen-head" }, [back]),
      focusHeading("h2", "Leaderboard"),
      el("p", { className: "app-tagline", text: `Your top ${LEADERBOARD_SIZE} runs on this device.` }),
      highlight && !highlightShown && runs.length > 0
        ? el("p", {
            className: "hint",
            text: `Your latest run (${highlight.total} / ${highlight.maxScore ?? TOTAL_QUESTIONS}) isn't in your top ${LEADERBOARD_SIZE}.`,
          })
        : null,
      body,
      runs.length > 0
        ? el("div", { className: "actions" }, [
            button("Clear history", {
              className: "btn btn-danger-outline",
              onClick: (event) => clearDialog.open(event.currentTarget),
            }),
          ])
        : null,
    ]);
  }

  /* ----- Confirmation dialogs (native <dialog>) ----- */

  function buildConfirmDialog({ id, title, description, cancelText, confirmText, onConfirm }) {
    const cancel = el("button", { type: "button", className: "btn btn-secondary", text: cancelText });
    const confirm = el("button", { type: "button", className: "btn btn-danger", text: confirmText });
    const dialog = el(
      "dialog",
      { className: "dialog", attrs: { "aria-labelledby": `${id}-title`, "aria-describedby": `${id}-desc` } },
      [
        el("h2", { id: `${id}-title`, text: title }),
        el("p", { id: `${id}-desc`, text: description }),
        el("div", { className: "dialog-actions" }, [cancel, confirm]),
      ]
    );

    let trigger = null;
    let confirmed = false;

    cancel.addEventListener("click", () => dialog.close());
    confirm.addEventListener("click", () => {
      confirmed = true;
      dialog.close();
    });
    // Escape fires "cancel" and closes natively; "close" covers every path.
    dialog.addEventListener("close", () => {
      const wasConfirmed = confirmed;
      confirmed = false;
      if (wasConfirmed) onConfirm(); // re-renders and focuses the new heading
      else trigger?.focus(); // back to the button that opened it
    });
    // Keep Tab inside the dialog.
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const items = [cancel, confirm];
      const i = items.indexOf(document.activeElement);
      event.preventDefault();
      const nextIndex = i === -1 ? 0 : (i + (event.shiftKey ? -1 : 1) + items.length) % items.length;
      items[nextIndex].focus();
    });

    return {
      dialog,
      open(from) {
        trigger = from ?? null;
        confirmed = false;
        dialog.showModal();
        cancel.focus(); // safe default: the non-destructive choice
      },
    };
  }

  return { render, setOfflineReady };
}
