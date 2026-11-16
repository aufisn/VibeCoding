# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this project.

## Overview

Single-player general knowledge quiz: 4-option multiple choice in four categories (History, Science, Geography, Arts & Culture). The bank holds at least 10 questions per category (52 today: 13 per category, 4/5/4); a game picks 10 per category. Static web app in plain HTML, CSS and vanilla JavaScript (ES modules). No frameworks, no build step, no backend, no npm dependencies (`package.json` only sets `"type": "module"`). Mobile-first.

Phases 1 to 3 are done, plus points and game modes: question content, core game, three modes (Full Challenge 40, By Category 10, Speed Quiz 20 with 15 s per question), ScoreManager points (difficulty multiplier, time, no-hint and streak bonuses), Eliminate (removes one wrong option per question), Skip (scores 0), a light/dark switch, Review mistakes, a personal leaderboard, keyboard and screen-reader support, and offline play (service worker). Publishing steps and the launch checklist are in `DEPLOY.md`.

## Commands

```sh
node scripts/validate-questions.mjs   # validate data/questions.json; exits 1 on errors
node scripts/find-superlatives.mjs    # list "most", "first", "largest"... (guideline 2); /quiz-validate wraps it
node scripts/list-questions.mjs [filter]          # questions with correct answers; /quiz-check uses it
node scripts/backup-report.mjs <file> stats|leaderboard|audit   # /quiz-stats and /quiz-leaderboard use it
node --test                           # unit tests in tests/
python3 -m http.server 8000           # serve the folder, then open http://localhost:8000
```

ES modules and `fetch` need HTTP, so the page doesn't work from `file://`.

## Structure

- `js/config.js`: `CATEGORIES` (also the play order), `ALL_SUBJECTS`, `QUESTIONS_PER_CATEGORY`, `ELIMINATE_PER_QUESTION`, `NICKNAME_MAX`, `DIFFICULTY_MIX`, `RANK_TIERS`. Single source of truth for these values. Rank minimums are out of 40; `tierFor` scales them for a 10-question run.
- `js/validate.js`: pure validation (no DOM), shared by the browser and Node. `validateQuestions(list)` returns `{ errors, warnings }`.
- `js/app.js`: entry point. Loads and validates the questions, shows a blocking error screen (`role="alert"`) on errors, then wires state, UI and storage.
- `js/score-manager.js`: pure ScoreManager. Rules live in `SCORING` in config.js; state.js passes in the answer time (from the injected `now`) and whether Eliminate was used.
- `js/quiz.js`, `js/scoring.js`: pure functions. `buildSpeedRun` picks 5 per category and mixes them. `buildRun(questions, rng)` shuffles questions within each category and options within each question, tracking the correct option by identity and storing its new `correctIndex`.
- `js/state.js`: `createGame()` state machine (screens: start, question, summary, results, review, leaderboard, stats). The only place game rules live, including `eliminate()`, `skip()`, the review and leaderboard screens, and the mistake list (`getState().mistakes`, in memory only, never saved). A one-subject run goes from its last question straight to results. Difficulty (`start(name, subject, level)`, `setDifficulty`, `questionCount`) filters the question pool before the run is built. `takeResultToSave()` returns the finished run once, which is what stops double-saving.
- `js/bank-analysis.js`: pure question bank analysis (`analyzeBank`, `findDuplicates`, `checkNewQuestions`, `nextId`). ui.js runs it at load and every time a game starts (Start screen panel plus console); it reports and never blocks or writes. Scripts `analyze-bank.mjs`, `backup-questions.mjs` and `add-questions.mjs` (with `bank-tools.mjs`, which writes the file in its hand-written layout) use the same code; `/quiz-expand` drives them.
- `js/data-manager.js`: `LocalDataManager` class, the only thing app.js and ui.js use for saved data: `saveGame`, `getGames`, `getStats`, `getCategoryStats`, `getLeaderboard({ period, mode, limit })`, `hasGames`, `clear`. Keeps `quiz.runs` (latest 100, via storage.js) and `quiz.stats` (running totals plus each mode's all-time top 10; rebuilt from the runs if missing or corrupt). Periods use local time; weeks start on Monday. Hall of fame is keyed by mode and difficulty (`"full/hard"`). Backups: `exportBackup()`, `parseBackup(text)` (validates and sanitizes untrusted files; rebuilds stats that don't match), `restoreBackup()` (replaces). Bump `STATS_VERSION` when the stats shape changes: older stats are rebuilt automatically. Pure helpers (`applyGame`, `rebuildStats`, `periodStart`, `filterByPeriod`, `sanitizeRun`, `parseBackup`) are exported for tests.
- `js/storage.js`: `saveRun`/`loadRuns`/`clearRuns` for `quiz.runs`, plus pure `topRuns(runs, n)`. Every storage access is in try/catch and must never throw.
- `js/keys.js`: pure `mapKey(key, context)` for the Question screen shortcuts. ui.js gathers the context and calls `preventDefault()` on handled keys so a focused button never also clicks.
- `sw.js`: service worker. Cache-first for files in `PRECACHE_URLS`, network-first for `data/questions.json`. Bump `CACHE_VERSION` whenever code or questions change, and add new files to `PRECACHE_URLS` (a test checks this).
- `js/theme.js`: light/dark switch in the top bar (`html[data-theme]`, stored as `quiz.theme`). `index.html` applies a stored choice before first paint.
- `js/ui.js`: rendering and events only. Build DOM with `createElement`/`textContent`; never `innerHTML` with question data.
- `data/questions.json`: the question bank. Schema and rules are in `README.md`.

## Skills

Project skills in `.claude/skills/`: `quiz-expand` (analyse, back up and grow the bank), `quiz-validate` (superlatives), `quiz-check` (fact-check answers; never edits questions or sets `verified`), `quiz-stats` and `quiz-leaderboard` (work on a backup file via `scripts/backup-report.mjs`, or guide code changes with a checklist). The scripts load backups through the game's own code, so keep them working when `js/data-manager.js` changes; `auditRuns()` must stay in line with `SCORING` and `RANK_TIERS`.

## Conventions

- Keep game logic out of the DOM so it stays testable in Node. Inject `rng`, `now` and storage in tests (see `tests/helpers.mjs`).
- Tests that depend on exact counts or ids use `loadFixedBank()` (the original 40 in `tests/fixtures/`), not the real bank, which grows. Tests of the real bank check rules, not sizes.
- Feedback is applied synchronously in the click handler: no setTimeout or animation before locking. The Speed Quiz countdown (setInterval in ui.js) only displays time; `timeOut()` in state.js decides, refuses early calls, and late answers count as timed out. Clear the interval on every render (`stopCountdown`). Never signal right/wrong by colour alone; always an icon plus text.
- Dialog buttons act in their own click handlers (and Escape in the "cancel" event), never in the async "close" event, which can arrive after the dialog has reopened.
- Every screen change focuses that screen's heading (`data-autofocus`). Locked options use `aria-disabled`, not `disabled`, so they stay readable. Dialogs come from `buildConfirmDialog` in ui.js (focus trap, focus returns to the opener on cancel).
- No external requests (fonts, CDNs, analytics).
- Colours are CSS variables in `css/style.css` and are chosen to pass WCAG AA in light and dark mode. Re-check contrast if you change one. The dark values appear twice (system setting and `[data-theme="dark"]`); keep both copies in sync.

## Question rules

- Each category has at least 3 easy, 4 medium and 3 hard questions (10 or more). `buildRun` picks 10 per category: a 3/4/3 mix for Mixed games, up to 10 of one difficulty otherwise. Ids are `hist-NN`, `sci-NN`, `geo-NN`, `art-NN`.
- Add questions with `scripts/add-questions.mjs` (via `/quiz-expand`), not by hand: it checks rules and duplicates and backs up the bank first.
- Questions are at most 25 words and options at most 8. No "all/none of the above".
- No more than 2 questions on the same sub-topic in a category. Vary the position of the correct answer.
- Never set `"verified": true`. The user fact-checks each question and sets it themselves.
- Run the validator and `node --test` after any change to the questions.

## Quiz Question Cross-Verification Guidelines

### Checklist for Writing All Questions

1. Is there only one correct answer?
   - Specify conditions if other interpretations are possible (e.g., based on area, as of 2024)
2. Is there a standard for superlative expressions?
   - Specify measurement criteria for expressions like 'largest', 'smallest', etc.
3. Are the time and scope clear?
   - Specify the point in time for information that may change
   - Clarify geographic and categorical scope
4. Has cross-verification been done?
   - For temporary/rapid information, check at least two sources
