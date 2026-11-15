# Quiz Game

A single-player general knowledge quiz: 4-option multiple choice, 10 questions in each of four categories (History, Science, Geography, Arts & Culture), 40 in total. Plain HTML, CSS and vanilla JavaScript (ES modules). No frameworks, no build step, no backend, no dependencies.

**Status: Phase 2 (core game) done.** Phase 3 adds "Review mistakes" and a leaderboard (placeholders are on the Results screen).

## How to play

Enter an optional nickname and press **Start**. Questions come in four rounds of 10: History, Science, Geography, then Arts & Culture. Question and answer order are reshuffled every run. You get one try per question: the first answer you pick locks, and you see right away whether it was correct, plus a one-line explanation. Press **Next** to go on. After each category you see your score out of 10, and at the end your total out of 40 and your rank (see [Rank tiers](#rank-tiers)).

## How to run

ES modules and `fetch` don't work from `file://`, so serve the folder over HTTP. From this folder, run one of:

```sh
python3 -m http.server 8000     # then open http://localhost:8000
npx serve                       # then open the URL it prints
```

If the data is valid, the page shows **Questions loaded: 40**. If not, it shows an error screen listing each problem.

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

Uses Node's built-in test runner (Node 18+). Tests are in `tests/*.test.mjs`.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | Page shell with the `#app` container; loads `js/app.js` |
| `css/style.css` | Mobile-first styles, colour and category accent variables, dark mode, reduced motion |
| `js/app.js` | Entry point: fetches and validates the questions (error screen on failure), then wires state, UI and storage |
| `js/config.js` | `CATEGORIES` (play order), `QUESTIONS_PER_CATEGORY`, `NICKNAME_MAX`, `DIFFICULTY_MIX`, `RANK_TIERS` |
| `js/validate.js` | Pure validation functions (no DOM), shared by the browser and Node |
| `js/quiz.js` | Pure: `shuffle` (Fisher-Yates), `seededRng`, `shuffleOptions`, `buildRun` |
| `js/scoring.js` | Pure: `tierFor`, `summarize` |
| `js/state.js` | Run state machine (`createGame`): `start`, `answer`, `next`, `exit`, `toStart`, `getState`. No DOM |
| `js/storage.js` | `saveRun`, `loadRuns` for the `quiz.runs` history in localStorage (never throws) |
| `js/ui.js` | Renders one screen at a time and handles events. No game rules |
| `data/questions.json` | The 40 questions |
| `scripts/validate-questions.mjs` | Command-line validator |
| `tests/*.test.mjs` | Unit tests (validator, quiz, scoring, state, storage); `tests/helpers.mjs` has shared fakes |
| `package.json` | Only marks `.js` files as ES modules for Node. Nothing to install |

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
{ "nickname": "Sam", "finishedAt": "2026-11-15T12:00:00.000Z", "total": 30,
  "byCategory": { "History": 8, "Science": 7, "Geography": 9, "Arts & Culture": 6 }, "tier": "Expert" }
```

Exiting mid-run saves nothing. If storage is blocked, full or corrupt, the game still plays and just doesn't save. `nickname` is `""` when none was entered.

## Rank tiers

| Rank | Minimum score (of 40) |
| --- | --- |
| Novice | 0 |
| Apprentice | 12 |
| Scholar | 20 |
| Expert | 28 |
| Grandmaster | 36 |
