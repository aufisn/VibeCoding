// Rendering and event handling only. All game rules live in state.js, and
// keyboard rules in keys.js. The DOM is built with createElement/textContent;
// question and saved data never go through innerHTML.

import {
  ALL_SUBJECTS,
  CATEGORIES,
  MODES,
  NICKNAME_MAX,
  QUESTIONS_PER_CATEGORY,
  SCORING,
  SPEED_PER_CATEGORY,
  SPEED_SECONDS,
  SPEED_SUBJECT,
  TOTAL_QUESTIONS,
} from "./config.js";
import { SCREENS } from "./state.js";
import { mapKey } from "./keys.js";
import { runMode, topRuns } from "./storage.js";

const LETTERS = ["A", "B", "C", "D"];
const LEADERBOARD_SIZE = 10;
const TICK_MS = 200; // Speed Quiz countdown refresh
const WARN_SECONDS = 5; // countdown turns urgent (and is announced) here
const MODE_LABELS = { [MODES.FULL]: "Full Challenge", [MODES.CATEGORY]: "By Category", [MODES.SPEED]: "Speed Quiz" };
const DIFFICULTY_LABELS = { easy: "easy", medium: "medium", hard: "hard" };
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
  speed: "M13 2L4 14h7l-1 8 9-12h-7z",
  star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z",
  flame: "M12 22c4 0 7-2.7 7-6.6 0-3.1-2-5.6-3.6-7.4-.3 1.9-1.2 3.2-2.4 3.7.2-3.4-1.2-6.4-4-8.7 0 3.4-4 6.2-4 11.6C5 19 8 22 12 22z",
  timer: "M12 8v5l3 2M9 2h6M12 4a9 9 0 1 0 0 18a9 9 0 1 0 0-18",
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

const capitalize = (text) => String(text).charAt(0).toUpperCase() + String(text).slice(1);

/** Base points for a correct answer at this difficulty. */
const pointsFor = (difficulty) => Math.round(SCORING.base * (SCORING.multipliers[difficulty] ?? 1));

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
  let countdown = null; // Speed Quiz interval id
  let leaderboardMode = MODES.FULL; // which mode the leaderboard shows

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
    description: "This deletes every saved run on this device, in all modes. It can't be undone.",
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

  function stopCountdown() {
    if (countdown !== null) clearInterval(countdown);
    countdown = null;
  }

  function render({ focus = true } = {}) {
    stopCountdown();
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

    function card(subject, { slug, name, detail, className = "" }) {
      return el(
        "button",
        {
          type: "submit",
          name: "subject",
          value: subject,
          className: `subject-card ${className}`.trim(),
          attrs: { "data-category": slug },
        },
        [
          el("span", { className: "subject-icon" }, [lineIcon(slug)]),
          el("span", { className: "subject-text" }, [
            el("span", { className: "subject-name", text: name }),
            el("span", { className: "subject-count", text: detail }),
          ]),
        ]
      );
    }

    const modeCards = [
      card(ALL_SUBJECTS, {
        slug: "all",
        name: "Full Challenge",
        detail: `All ${TOTAL_QUESTIONS} questions, category by category`,
        className: "mode-card subject-all",
      }),
      card(SPEED_SUBJECT, {
        slug: "speed",
        name: "Speed Quiz",
        detail: `${SPEED_PER_CATEGORY * CATEGORIES.length} mixed questions, ${SPEED_SECONDS} seconds each`,
        className: "mode-card subject-speed",
      }),
    ];
    const categoryCards = CATEGORIES.map((category) =>
      card(category, { slug: categorySlug(category), name: category, detail: `${QUESTIONS_PER_CATEGORY} questions` })
    );

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
          el("legend", { text: "Choose a game mode" }),
          el("div", { className: "mode-grid" }, modeCards),
          el("p", { className: "group-label", id: "by-category", text: "By Category" }),
          el("div", { className: "subject-grid", attrs: { role: "group", "aria-labelledby": "by-category" } }, categoryCards),
        ]),
      ]
    );

    return el("section", { className: "screen screen-start" }, [
      el("div", { className: "hero" }, [
        focusHeading("h1", "How much do you know?", "app-title"),
        el("p", { className: "app-tagline", text: "Earn points for every right answer. Be quick, skip the hints and build a streak for bonuses." }),
      ]),
      form,
      el("div", { className: "start-links" }, [
        button("Leaderboard", {
          className: "btn btn-secondary",
          iconKind: "trophy",
          onClick() {
            leaderboardMode = MODES.FULL;
            if (game.openLeaderboard()) render();
          },
        }),
      ]),
      el("div", { className: "how-to card" }, [
        el("h2", { className: "how-to-title", text: "How it works" }),
        el("ul", { className: "rules" }, [
          el("li", { text: "One try per question: your first answer locks, and you see right away if it was right." }),
          el("li", {}, [
            el("strong", { text: "Points:" }),
            document.createTextNode(
              ` ${SCORING.base} per correct answer, ×${SCORING.multipliers.medium} for medium and ×${SCORING.multipliers.hard} for hard questions. ` +
                `+${SCORING.fastBonus} for answering in under ${SCORING.fastMs / 1000} seconds, +${SCORING.noHintBonus} for not using Eliminate, ` +
                `and a streak bonus at 3 (+${SCORING.streakBonuses[3]}), 5 (+${SCORING.streakBonuses[5]}) and every 10 (+${SCORING.streakBonuses[10]}) right in a row.`
            ),
          ]),
          el("li", {}, [el("strong", { text: "Eliminate" }), document.createTextNode(" removes one wrong answer from the current question.")]),
          el("li", {}, [el("strong", { text: "Skip" }), document.createTextNode(" moves on without answering. A skipped question scores 0 and ends your streak.")]),
          el("li", {}, [
            el("strong", { text: "Speed Quiz:" }),
            document.createTextNode(` ${SPEED_SECONDS} seconds per question. When time runs out, the question scores 0.`),
          ]),
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
    const isSpeed = state.mode === MODES.SPEED;

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

    // Points and streak: updated in place after each answer.
    const pointsValue = el("span", { className: "stat-value", text: String(state.points) });
    const streakValue = el("span", { className: "stat-value", text: String(state.streak) });
    const pointsPill = el("span", { className: "stat-pill points-pill" }, [
      lineIcon("star"),
      pointsValue,
      el("span", { className: "stat-unit", text: " pts" }),
    ]);
    const streakPill = el("span", { className: `stat-pill streak-pill${state.streak >= 2 ? " is-hot" : ""}` }, [
      lineIcon("flame"),
      el("span", { className: "visually-hidden", text: "Streak: " }),
      streakValue,
      el("span", { className: "stat-unit", text: " in a row" }),
    ]);

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
      lifelineStatus.textContent = `Option ${LETTERS[removed]} removed: it was a wrong answer. No-hint bonus lost for this question.`;
      eliminateButton.disabled = !after.canEliminate;
      if (eliminateButton.disabled) optionButtons.find((b) => !isLocked(b))?.focus();
    }

    /* Speed Quiz countdown. The state decides when time is up (timeOut()
       refuses early calls); this only displays it and asks. */
    const timer = isSpeed ? buildTimer(state.timeLimitMs) : null;
    if (timer) {
      timer.update(state.timeLeftMs);
      countdown = setInterval(() => {
        const left = game.getState().timeLeftMs;
        if (left === null) return stopCountdown();
        timer.update(left);
        if (left <= 0 && game.timeOut()) reveal(game.getState());
      }, TICK_MS);
    }

    // All feedback is applied synchronously, in the click/key handler.
    function choose(optionIndex) {
      if (isLocked(optionButtons[optionIndex]) || !game.answer(optionIndex)) return;
      reveal(game.getState());
    }

    /** Lock the question and show the result (answered or timed out). */
    function reveal(after) {
      stopCountdown();
      const { answer } = after;
      const correctLabel = `${LETTERS[answer.correctIndex]}: ${answer.correctText}`;
      if (timer) timer.stop(answer.timedOut);

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

      let resultText = "Correct";
      if (answer.timedOut) resultText = `Time's up. The correct answer is ${correctLabel}`;
      else if (!answer.correct) resultText = `Incorrect. The correct answer is ${correctLabel}`;

      feedback.replaceChildren(
        el("div", { className: "feedback" }, [
          el("p", { className: `feedback-result ${answer.correct ? "is-correct" : "is-wrong"}` }, [
            answer.timedOut ? lineIcon("timer") : icon(answer.correct ? "check" : "cross"),
            el("span", { text: resultText }),
          ]),
          pointsBreakdown(answer, question, state.streak),
          el("p", { className: "feedback-explanation", text: question.explanation }),
        ])
      );

      pointsValue.textContent = String(after.points);
      streakValue.textContent = String(after.streak);
      streakPill.classList.toggle("is-hot", after.streak >= 2);
      if (answer.points.total > 0) {
        // Decorative pop (after the feedback is already shown; off with reduced motion).
        pointsPill.classList.remove("is-bumped");
        void pointsPill.offsetWidth;
        pointsPill.classList.add("is-bumped");
      }
      setProgress(after.answeredCount);
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

    let position;
    if (state.mode === MODES.FULL) {
      position = `Question ${state.positionInCategory} of ${state.categorySize} · ${state.index + 1} of ${state.totalQuestions} overall`;
    } else {
      position = `Question ${state.index + 1} of ${state.totalQuestions}`;
    }

    return el("section", { className: "screen screen-question", attrs: { "data-category": slug } }, [
      el("div", { className: "question-header" }, [
        el("p", { className: "category-chip" }, [
          lineIcon(slug),
          el("span", { text: isSpeed ? `Speed · ${state.category}` : state.category }),
        ]),
        exitButton,
      ]),
      el("div", { className: "question-meta" }, [
        el("span", { className: "position", text: position }),
        el("span", { className: "stats-row" }, [streakPill, pointsPill]),
      ]),
      progress,
      timer ? timer.element : null,
      el("div", { className: "card question-card" }, [
        el("p", { className: "difficulty", text: `${capitalize(question.difficulty)} · ${pointsFor(question.difficulty)} pts` }),
        heading,
        el("div", { className: "options", attrs: { role: "group", "aria-labelledby": "question-text" } }, optionButtons),
        el("div", { className: "lifelines" }, [eliminateButton, skipButton]),
        lifelineStatus,
      ]),
      feedback,
      el("div", { className: "actions" }, [nextButton]),
    ]);
  }

  /** "+15 base (medium ×1.5) +3 fast +2 no hint +2 streak of 3" as chips. */
  function pointsBreakdown(answer, question, streakBefore) {
    const p = answer.points;
    if (!answer.correct) {
      const note = streakBefore >= 2 ? `0 points. Your streak of ${streakBefore} ended.` : "0 points.";
      return el("p", { className: "points-line" }, [el("span", { text: note })]);
    }
    const multiplier = SCORING.multipliers[question.difficulty] ?? 1;
    const chips = [
      `${p.base} ${DIFFICULTY_LABELS[question.difficulty] ?? ""}${multiplier !== 1 ? ` ×${multiplier}` : ""}`,
      p.time ? `+${p.time} fast` : null,
      p.noHint ? `+${p.noHint} no hint` : null,
      p.streak ? `+${p.streak} streak of ${answer.points.streakAfter}` : null,
    ].filter(Boolean);
    return el("p", { className: "points-line" }, [
      el("strong", { className: "points-total", text: `+${p.total} points` }),
      el("span", { className: "visually-hidden", text: ": " }),
      // Commas only for screen readers, so the chips read as a list.
      ...chips.map((text, i) => el("span", { className: "chip" }, [document.createTextNode(text), i < chips.length - 1 ? srOnly(",") : null])),
    ]);
  }

  /** The Speed Quiz countdown: a bar plus seconds as text, never colour alone. */
  function buildTimer(limitMs) {
    const seconds = el("span", { className: "timer-seconds" });
    const fill = el("div", { className: "timer-fill" });
    // Announced once, at WARN_SECONDS, not every second.
    const announce = el("span", { className: "visually-hidden", attrs: { "aria-live": "assertive" } });
    const element = el("div", { className: "timer" }, [
      el("div", { className: "timer-label" }, [lineIcon("timer"), seconds]),
      el("div", { className: "timer-track", attrs: { "aria-hidden": "true" } }, [fill]),
      announce,
    ]);
    let warned = false;
    return {
      element,
      update(leftMs) {
        const s = Math.ceil(leftMs / 1000);
        seconds.textContent = `${s} s left`;
        fill.style.width = `${Math.max(0, Math.min(1, leftMs / limitMs)) * 100}%`;
        const urgent = s <= WARN_SECONDS;
        element.classList.toggle("is-urgent", urgent);
        if (urgent && !warned && s > 0) {
          warned = true;
          announce.textContent = `${WARN_SECONDS} seconds left`;
        }
      },
      stop(timedOut) {
        element.classList.add("is-stopped");
        if (timedOut) {
          seconds.textContent = "Time's up";
          fill.style.width = "0%";
        }
      },
    };
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
      el("p", { className: "running-total", text: `Total so far: ${state.score} / ${state.answeredCount} correct · ${state.points} points` }),
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
    const isCategory = state.mode === MODES.CATEGORY;
    const rows = Object.entries(state.byCategory).map(([category, n]) =>
      el("tr", { attrs: { "data-category": categorySlug(category) } }, [
        el("th", { scope: "row", text: category }),
        el("td", { text: `${n} / ${state.categoryTotals[category] ?? QUESTIONS_PER_CATEGORY}` }),
      ])
    );
    const stats = [
      isCategory ? `${MODE_LABELS[state.mode]}: ${state.subject}` : MODE_LABELS[state.mode],
      `Best streak: ${state.bestStreak}`,
      `Hints used: ${state.eliminationsUsed}`,
      `Skipped: ${state.skippedCount}`,
      state.mode === MODES.SPEED ? `Timed out: ${state.timedOutCount}` : null,
    ].filter(Boolean);

    const t = state.pointTotals;
    const breakdown = el("table", { className: "breakdown-table" }, [
      el("caption", { text: "How you scored" }),
      el(
        "tbody",
        {},
        [
          ["Correct answers (with difficulty)", t.base],
          [`Speed bonus (under ${SCORING.fastMs / 1000} s)`, t.time],
          ["No-hint bonus", t.noHint],
          ["Streak bonus", t.streak],
        ].map(([label, value]) =>
          el("tr", {}, [el("th", { scope: "row", text: label }), el("td", { text: value > 0 ? `+${value}` : "0" })])
        )
      ),
      el("tfoot", {}, [el("tr", {}, [el("th", { scope: "row", text: "Total" }), el("td", { text: `${t.total} pts` })])]),
    ]);

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
      {
        className: "screen screen-results",
        attrs: {
          "data-category": isCategory ? categorySlug(state.subject) : state.mode === MODES.SPEED ? "speed" : "all",
        },
      },
      [
        el("div", { className: "card results-card" }, [
          focusHeading("h2", state.nickname ? `Well played, ${state.nickname}!` : "Your results"),
          el("p", { className: "big-score" }, [
            el("span", { className: "big-score-value", text: String(state.points) }),
            el("span", { className: "big-score-max", text: " points" }),
          ]),
          el("p", { className: "correct-line", text: `${state.total} of ${state.maxScore} correct` }),
          el("p", { className: "tier" }, [
            el("span", { className: "tier-label", text: "Rank: " }),
            el("strong", { className: "tier-name", text: state.tier.name }),
          ]),
          el("ul", { className: "stats" }, stats.map((text) => el("li", { text }))),
        ]),
        breakdown,
        isCategory
          ? null
          : el("table", { className: "category-table" }, [
              el("caption", { text: "Correct answers by category" }),
              el("tbody", {}, rows),
            ]),
        el("div", { className: "results-links" }, [
          review,
          button("Leaderboard", {
            className: "btn btn-secondary",
            iconKind: "trophy",
            onClick() {
              leaderboardMode = state.mode;
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
                  m.skipped ? lineIcon("skip") : m.timedOut ? lineIcon("timer") : icon("cross"),
                  el("span", {}, [
                    el("span", { className: "review-label", text: "Your answer: " }),
                    el("span", { text: m.skipped ? "Skipped" : m.timedOut ? "No answer (time ran out)" : m.chosenText }),
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

    const wrong = state.mistakes.filter((m) => !m.skipped && !m.timedOut).length;
    const skipped = state.mistakes.filter((m) => m.skipped).length;
    const timedOut = state.mistakes.filter((m) => m.timedOut).length;
    const parts = [`${wrong} wrong`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    if (timedOut > 0) parts.push(`${timedOut} timed out`);

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
      runs = topRuns(getRuns(), LEADERBOARD_SIZE, leaderboardMode);
    } catch {
      runs = []; // corrupt or blocked storage: show the empty state
    }
    let anyRuns = runs.length > 0;
    if (!anyRuns) {
      try {
        anyRuns = topRuns(getRuns(), 1).length > 0;
      } catch {
        anyRuns = false;
      }
    }
    const highlight = fromResults ? justFinished : null;
    const highlightShown = runs.some((r) => sameRun(r, highlight));
    const highlightInMode = highlight && runMode(highlight) === leaderboardMode;

    const back = button(fromResults ? "Back to results" : "Back", {
      className: "btn btn-quiet",
      iconKind: "back",
      onClick() {
        if (game.closeLeaderboard()) render();
      },
    });

    // Mode filter: one leaderboard per mode, since 20, 10 and 40-question
    // runs can't be compared fairly.
    const tabs = el(
      "div",
      { className: "mode-tabs", attrs: { role: "group", "aria-label": "Show runs for" } },
      [MODES.FULL, MODES.CATEGORY, MODES.SPEED].map((mode) =>
        el("button", {
          type: "button",
          className: "mode-tab",
          text: MODE_LABELS[mode],
          attrs: { "aria-pressed": String(mode === leaderboardMode), "data-mode": mode },
          on: {
            click() {
              if (leaderboardMode === mode) return;
              leaderboardMode = mode;
              render({ focus: false });
              container.querySelector(`.mode-tab[data-mode="${mode}"]`)?.focus();
            },
          },
        })
      )
    );

    let body;
    if (runs.length === 0) {
      body = el("p", {
        className: "empty-state card",
        text: anyRuns
          ? `No ${MODE_LABELS[leaderboardMode]} runs yet. Finish one to appear here.`
          : "No saved runs yet. Finish a game to appear here.",
      });
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
            runMode(run) === MODES.CATEGORY && typeof run.subject === "string"
              ? el("span", { className: "lb-subject", text: run.subject })
              : null,
          ]),
          el("td", { className: "lb-points", text: typeof run.points === "number" ? String(run.points) : "–" }),
          el("td", { className: "lb-score" }, [
            el("span", { text: `${run.total} / ${max}` }),
            typeof run.tier === "string" ? el("span", { className: "lb-tier", text: run.tier }) : null,
          ]),
          el("td", { className: "lb-date", text: formatDate(run.finishedAt) }),
        ]);
      });
      body = el("div", { className: "table-scroll" }, [
        el("table", { className: "leaderboard-table" }, [
          el("caption", { className: "visually-hidden", text: `Top ${LEADERBOARD_SIZE} ${MODE_LABELS[leaderboardMode]} runs` }),
          el("thead", {}, [
            el(
              "tr",
              {},
              [
                ["#", "#"],
                ["Name", "Name"],
                ["Points", "Pts"],
                ["Correct and rank", "Correct"],
                ["Date", "Date"],
              ].map(([full, short]) =>
                el("th", { scope: "col" }, [
                  el("span", { text: short, attrs: { "aria-hidden": "true" } }),
                  srOnly(full),
                ])
              )
            ),
          ]),
          el("tbody", {}, rows),
        ]),
      ]);
    }

    return el("section", { className: "screen screen-leaderboard" }, [
      el("div", { className: "screen-head" }, [back]),
      focusHeading("h2", "Leaderboard"),
      el("p", { className: "app-tagline", text: `Your top ${LEADERBOARD_SIZE} runs on this device, by points.` }),
      tabs,
      highlightInMode && !highlightShown && runs.length > 0
        ? el("p", {
            className: "hint",
            text: `Your latest run (${highlight.points} points) isn't in your top ${LEADERBOARD_SIZE}.`,
          })
        : null,
      body,
      anyRuns
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
