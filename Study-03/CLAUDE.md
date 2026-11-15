# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this project.

## Overview

Single-player general knowledge quiz: 4-option multiple choice, 10 questions in each of four categories (History, Science, Geography, Arts & Culture), 40 in total. Static web app in plain HTML, CSS and vanilla JavaScript (ES modules). No frameworks, no build step, no backend, no npm dependencies (`package.json` only sets `"type": "module"`). Mobile-first.

Phase 1 (foundation and question content) and Phase 2 (core game) are done. Phase 3 is "Review mistakes" and a leaderboard; a marked placeholder (`data-placeholder="phase-3"`) waits on the Results screen.

## Commands

```sh
node scripts/validate-questions.mjs   # validate data/questions.json; exits 1 on errors
node --test                           # unit tests in tests/
python3 -m http.server 8000           # serve the folder, then open http://localhost:8000
```

ES modules and `fetch` need HTTP, so the page doesn't work from `file://`.

## Structure

- `js/config.js`: `CATEGORIES` (also the play order), `QUESTIONS_PER_CATEGORY`, `NICKNAME_MAX`, `DIFFICULTY_MIX`, `RANK_TIERS`. Single source of truth for these values.
- `js/validate.js`: pure validation (no DOM), shared by the browser and Node. `validateQuestions(list)` returns `{ errors, warnings }`.
- `js/app.js`: entry point. Loads and validates the questions, shows a blocking error screen (`role="alert"`) on errors, then wires state, UI and storage.
- `js/quiz.js`, `js/scoring.js`: pure functions. `buildRun(questions, rng)` shuffles questions within each category and options within each question, tracking the correct option by identity and storing its new `correctIndex`.
- `js/state.js`: `createGame()` state machine (screens: start, question, summary, results). The only place game rules live. `takeResultToSave()` returns the finished run once, which is what stops double-saving.
- `js/storage.js`: `saveRun`/`loadRuns` for `quiz.runs`. Every storage access is in try/catch and must never throw.
- `js/ui.js`: rendering and events only. Build DOM with `createElement`/`textContent`; never `innerHTML` with question data.
- `data/questions.json`: the question bank. Schema and rules are in `README.md`.

## Conventions

- Keep game logic out of the DOM so it stays testable in Node. Inject `rng`, `now` and storage in tests (see `tests/helpers.mjs`).
- Feedback is applied synchronously in the click handler: no setTimeout or animation before locking. Never signal right/wrong by colour alone; always an icon plus text.
- Colours are CSS variables in `css/style.css` and are chosen to pass WCAG AA in light and dark mode. Re-check contrast if you change one.

## Question rules

- Each category has exactly 3 easy, 4 medium and 3 hard questions. Ids are `hist-NN`, `sci-NN`, `geo-NN`, `art-NN`.
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
