# Quiz Game

A single-player general knowledge quiz: 4-option multiple choice, 10 questions in each of four categories (History, Science, Geography, Arts & Culture), 40 in total. Plain HTML, CSS and vanilla JavaScript (ES modules). No frameworks, no build step, no backend, no dependencies.

**Status: Phase 3 (polish and launch) done.** Subject choice, Eliminate, Skip, review of mistakes, a personal leaderboard, keyboard and screen-reader support, a light/dark switch, and offline play. See [DEPLOY.md](DEPLOY.md) to publish it.

## How to play

Enter an optional nickname, then pick a subject: **History**, **Science**, **Geography** or **Arts & Culture** for a round of 10, or **All subjects** for all 40 (four rounds in that order, with a score summary after each). Pressing Enter in the nickname box starts All subjects. Question and answer order are reshuffled every run.

You get one try per question: the first answer you pick locks, and you see right away whether it was correct, plus a one-line explanation. Press **Next** to go on. Before answering you can also press:

- **Eliminate**: removes one wrong answer from the current question (once per question).
- **Skip**: moves to the next question without answering. A skipped question scores 0 and isn't shown again.

At the end you see your score, your rank (see [Rank tiers](#rank-tiers)), and how many questions you skipped and eliminations you used. From there:

- **Review mistakes** lists every question you got wrong or skipped, grouped by category, with your answer, the correct answer and the explanation. It's kept in memory for the current run only. A perfect run shows "Perfect score, nothing to review" instead.
- **Leaderboard** (also on the Start screen) shows your 10 best saved runs on this device: highest score first, ties newest first. The run you just finished is marked "This run". **Clear history** deletes the saved runs after a confirmation.

**Keyboard:** on a question, press A to D (or 1 to 4) to answer, then Enter or Space for the next question. Everything else works with Tab, Enter and Escape. Focus moves to each screen's heading, and results are announced to screen readers.

**Offline:** after one visit online (over https or on localhost), the game works without a connection. The Start screen shows "Offline ready" once everything is stored.

The **Dark mode** switch in the top bar changes the theme. The choice is remembered in the browser (`quiz.theme`); until you use it, the page follows your system setting.

## How to run locally

ES modules and `fetch` don't work from `file://`, so serve the folder over HTTP. From this folder, run one of:

```sh
python3 -m http.server 8000     # then open http://localhost:8000
npx serve                       # then open the URL it prints
```

If the data is valid, the Start screen appears. If not, it shows an error screen listing each problem.

The service worker caches the game, so while developing, a plain reload can show old code. In Chrome DevTools, use **Application → Service workers → Update on reload**, or bump `CACHE_VERSION` (see below).

## How to validate the questions

```sh
node scripts/validate-questions.mjs
```

This prints every error and warning, then a summary. It exits with code `1` if there are errors and `0` otherwise, so you can use it in scripts or CI. You can pass another file to check: `node scripts/validate-questions.mjs path/to/file.json`.

- **Errors** block the game: wrong counts, a bad schema, the wrong difficulty mix, questions longer than 25 words, options longer than 8 words, or "all/none of the above" options.
- **Warnings** list every question whose `verified` isn't `true`. Set `"verified": true` on each question once you've fact-checked it.

## Running the tests

```sh
node --test
```

Run it from this folder. It uses Node's built-in test runner (Node 18+). Tests are in `tests/*.test.mjs`. They include a check that `sw.js` precaches every file `index.html` and the JS modules load.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | Page shell: top bar with the dark mode switch, and the `#app` container; loads `js/app.js` |
| `css/style.css` | Mobile-first styles, colour and category accent variables, dark mode, reduced motion |
| `js/app.js` | Entry point: fetches and validates the questions (error screen on failure), then wires state, UI and storage |
| `js/config.js` | `CATEGORIES` (play order), `ALL_SUBJECTS`, `QUESTIONS_PER_CATEGORY`, `ELIMINATE_PER_QUESTION`, `NICKNAME_MAX`, `DIFFICULTY_MIX`, `RANK_TIERS` |
| `js/validate.js` | Pure validation functions (no DOM), shared by the browser and Node |
| `js/quiz.js` | Pure: `shuffle` (Fisher-Yates), `seededRng`, `shuffleOptions`, `buildRun` |
| `js/scoring.js` | Pure: `tierFor`, `summarize` |
| `js/state.js` | Run state machine (`createGame`): `start(name, subject)`, `answer`, `eliminate`, `skip`, `next`, `exit`, `toStart`, `openReview`, `openLeaderboard` and more, `getState`. Tracks mistakes for the review. No DOM |
| `js/theme.js` | Light/dark switch, remembered under `quiz.theme` |
| `js/keys.js` | Pure: `mapKey(key, context)` keyboard shortcuts for the Question screen |
| `sw.js` | Service worker: precache, cache-first for files, network-first for the questions. Holds `CACHE_VERSION` |
| `manifest.webmanifest`, `icons/` | Install and home-screen metadata; placeholder icons |
| `scripts/make-icons.mjs` | Regenerates the placeholder icons (no dependencies) |
| `DEPLOY.md` | How to publish, plus the launch checklist |
| `js/storage.js` | `saveRun`, `loadRuns`, `clearRuns` for the `quiz.runs` history in localStorage (never throw), and pure `topRuns(runs, n)` for the leaderboard |
| `js/ui.js` | Renders one screen at a time and handles events. No game rules |
| `data/questions.json` | The 40 questions |
| `scripts/validate-questions.mjs` | Command-line validator |
| `tests/*.test.mjs` | Unit tests (validator, quiz, scoring, state, storage, keys, service worker precache list); `tests/helpers.mjs` has shared fakes |
| `package.json` | Only marks `.js` files as ES modules for Node. Nothing to install |

## How to edit questions

1. Edit `data/questions.json` (format below). Keep exactly 3 easy, 4 medium and 3 hard per category.
2. Follow the cross-verification guidelines in `CLAUDE.md`: one correct answer, clear superlatives, a clear time and scope.
3. Set `"verified": true` only after you have fact-checked the question.
4. Run `node scripts/validate-questions.mjs` and `node --test`.
5. Bump `CACHE_VERSION` in `sw.js` (see the checklist below).

Players who are online get corrected questions on their next load even without the bump, because the service worker fetches `questions.json` network-first. The bump also refreshes the copy used offline.

## Releasing a change: checklist

- [ ] Changed questions or code, bump `CACHE_VERSION` in `sw.js` (`"v1"` → `"v2"` and so on). Without it, players keep the old cached code.
- [ ] Added a new file the page loads (JS module, icon, stylesheet)? Add it to `PRECACHE_URLS` in `sw.js`. `node --test` fails if one is missing.
- [ ] `node scripts/validate-questions.mjs` shows 0 errors.
- [ ] `node --test` passes.

## Question format

```json
{
  "id": "geo-03",
  "category": "Geography",
  "difficulty": "easy",
  "question": "Which river flows through the Egyptian capital, Cairo?",
  "options": ["Nile", "Tigris", "Congo", "Euphrates"],
  "correctIndex": 0,
  "explanation": "One sentence explaining the answer.",
  "sourceHint": "Encyclopaedia Britannica: Cairo",
  "verified": false
}
```

- Ids: `hist-01`…`hist-10`, `sci-01`…`sci-10`, `geo-01`…`geo-10`, `art-01`…`art-10`.
- Each category needs exactly 3 easy, 4 medium and 3 hard questions.
- `options` must be exactly 4 unique, non-empty strings. `correctIndex` is the 0-based position of the right answer.

## Saved results

Each finished run is saved in the browser's localStorage under `quiz.runs`, newest first, at most 100 entries:

```json
{ "nickname": "Sam", "finishedAt": "2026-11-15T12:00:00.000Z", "subject": "All",
  "total": 30, "maxScore": 40,
  "byCategory": { "History": 8, "Science": 7, "Geography": 9, "Arts & Culture": 6 },
  "skipped": 2, "eliminated": 5, "tier": "Expert" }
```

`subject` is a category name or `"All"`; for a one-subject run `maxScore` is 10 and `byCategory` has only that category. Exiting mid-run saves nothing. If storage is blocked, full or corrupt, the game still plays and just doesn't save. `nickname` is `""` when none was entered.

## Rank tiers

| Rank | Minimum score (of 40) | One subject (of 10) |
| --- | --- | --- |
| Novice | 0 | 0 |
| Apprentice | 12 | 3 |
| Scholar | 20 | 5 |
| Expert | 28 | 7 |
| Grandmaster | 36 | 9 |
