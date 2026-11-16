# Quiz Game

A single-player general knowledge quiz: 4-option multiple choice, 10 questions in each of four categories (History, Science, Geography, Arts & Culture), 40 in total. Plain HTML, CSS and vanilla JavaScript (ES modules). No frameworks, no build step, no backend, no dependencies.

**Status: Phase 3 (polish and launch) done.** Subject choice, Eliminate, Skip, review of mistakes, a personal leaderboard, keyboard and screen-reader support, a light/dark switch, and offline play. See [DEPLOY.md](DEPLOY.md) to publish it.

## How to play

Enter an optional nickname, then pick a game mode:

| Mode | Questions | Notes |
| --- | --- | --- |
| **Full Challenge** | All 40 | Four rounds (History, Science, Geography, Arts & Culture) with a summary after each. Pressing Enter in the nickname box starts it. |
| **By Category** | 10 | All the questions of the category you pick. |
| **Speed Quiz** | 20 | 5 random questions from each category, mixed. **15 seconds per question**; when time runs out the question scores 0 and the answer is shown. |

Question and answer order are reshuffled every run.

### Points

Each correct answer earns points (the ScoreManager in `js/score-manager.js`; the numbers are in `SCORING` in `js/config.js`):

| | Points |
| --- | --- |
| Base | 10 × difficulty multiplier: easy ×1 (10), medium ×1.5 (15), hard ×2 (20) |
| Time bonus | +3 for answering in under 10 seconds |
| No-hint bonus | +2 if you didn't use Eliminate on that question |
| Streak bonus | +2 at 3 correct in a row, +5 at 5, +10 at 10 (and again at 20, 30, 40) |

A wrong, skipped or timed-out answer scores 0 and ends the streak. After each answer you see the points it earned and why. The top of the question shows your points and current streak. The best possible Full Challenge score is 847.

You get one try per question: the first answer you pick locks, and you see right away whether it was correct, plus a one-line explanation. Press **Next** to go on. Before answering you can also press:

- **Eliminate**: removes one wrong answer from the current question (once per question).
- **Skip**: moves to the next question without answering. A skipped question scores 0 and isn't shown again.

At the end you see your points, how many you got right, your rank (see [Rank tiers](#rank-tiers); it's based on correct answers), your best streak, and a breakdown of where the points came from. From there:

- **Review mistakes** lists every question you got wrong or skipped, grouped by category, with your answer, the correct answer and the explanation. It's kept in memory for the current run only. A perfect run shows "Perfect score, nothing to review" instead.
- **Leaderboard** (also on the Start screen) shows your top 10 runs on this device. Choose a period (**Overall**, **This week** from Monday 00:00, or **Today** from midnight, in your local time) and a mode (Full Challenge, By Category, Speed Quiz; 40, 10 and 20-question runs can't be compared fairly). Runs are ranked by points, then correct answers, then newest. The run you just finished is marked "This run". Runs saved before points existed show "–" and rank last.
- **Statistics** (also on the Start screen) covers every game you've finished: games played, accuracy, total and average points, best streak, accuracy per category (with your strongest and weakest category), and games, best and average points per mode.
- **Clear history** (on both screens) deletes the saved games and statistics after a confirmation. Your theme choice is kept.

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

### Checking superlatives

Guideline 2 in `CLAUDE.md` says expressions like "largest" need a stated measure. To list every superlative or ranking word (most, first, largest, longest, only and others) in the questions and options:

```sh
node scripts/find-superlatives.mjs                   # questions and options
node scripts/find-superlatives.mjs --explanations    # explanations too
node scripts/find-superlatives.mjs --words primary,major   # extra words
```

In Claude Code, the **`/quiz-validate`** skill (`.claude/skills/quiz-validate/`) runs this and shows a table that also says whether each question states its criterion (for example "by surface area"). It only reports; it never edits the questions. Add `explanations` or extra words after the command, for example `/quiz-validate explanations`.

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
| `js/config.js` | `CATEGORIES` (play order), `MODES`, `ALL_SUBJECTS`, `SPEED_SUBJECT`, `SPEED_PER_CATEGORY`, `SPEED_SECONDS`, `SCORING`, `QUESTIONS_PER_CATEGORY`, `ELIMINATE_PER_QUESTION`, `NICKNAME_MAX`, `DIFFICULTY_MIX`, `RANK_TIERS` |
| `js/validate.js` | Pure validation functions (no DOM), shared by the browser and Node |
| `js/quiz.js` | Pure: `shuffle` (Fisher-Yates), `seededRng`, `shuffleOptions`, `buildRun`, `buildSpeedRun` |
| `js/score-manager.js` | Pure ScoreManager: `scoreAnswer`, `streakBonus`, `createScoreManager` (points, bonuses, streaks) |
| `js/scoring.js` | Pure: `tierFor`, `summarize` |
| `js/state.js` | Run state machine (`createGame`): `start(name, subject)`, `answer`, `eliminate`, `skip`, `timeOut`, `next`, `exit`, `toStart`, `openReview`, `openLeaderboard` and more, `getState`. Times each answer, scores it, tracks mistakes. No DOM |
| `js/theme.js` | Light/dark switch, remembered under `quiz.theme` |
| `js/keys.js` | Pure: `mapKey(key, context)` keyboard shortcuts for the Question screen |
| `sw.js` | Service worker: precache, cache-first for files, network-first for the questions. Holds `CACHE_VERSION` |
| `manifest.webmanifest`, `icons/` | Install and home-screen metadata; placeholder icons |
| `scripts/make-icons.mjs` | Regenerates the placeholder icons (no dependencies) |
| `DEPLOY.md` | How to publish, plus the launch checklist |
| `js/data-manager.js` | `LocalDataManager` class: automatic saving, statistics, the latest 100 games, Overall / Weekly / Daily leaderboards (never throws) |
| `js/storage.js` | `saveRun`, `loadRuns`, `clearRuns` for the `quiz.runs` history in localStorage (never throw), and pure `topRuns(runs, n, mode)` and `runMode(run)` for the leaderboard |
| `js/ui.js` | Renders one screen at a time and handles events. No game rules |
| `data/questions.json` | The 40 questions |
| `scripts/validate-questions.mjs` | Command-line validator |
| `scripts/find-superlatives.mjs` | Lists superlative and ranking words in the questions (used by `/quiz-validate`) |
| `.claude/skills/quiz-validate/` | The `/quiz-validate` Claude Code skill |
| `tests/*.test.mjs` | Unit tests (validator, quiz, scoring, score manager, state, storage, keys, service worker precache list); `tests/helpers.mjs` has shared fakes |
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

Saving is automatic and handled by the `LocalDataManager` class (`js/data-manager.js`). It keeps two localStorage entries:

- `quiz.runs`: the latest 100 finished games, newest first.
- `quiz.stats`: running statistics, updated after every game: totals, per mode, per category, and each mode's all-time top 10. Because it keeps counting, statistics include games older than the latest 100, and a best score stays on the Overall leaderboard after it drops out of them. If it's missing or corrupt, it's rebuilt from `quiz.runs`.

A saved game looks like this:

```json
{ "nickname": "Sam", "finishedAt": "2026-11-15T12:00:00.000Z",
  "mode": "full", "subject": "All", "points": 612, "total": 30, "maxScore": 40,
  "byCategory": { "History": 8, "Science": 7, "Geography": 9, "Arts & Culture": 6 },
  "skipped": 2, "timedOut": 0, "eliminated": 5, "bestStreak": 9,
  "bonuses": { "base": 450, "time": 75, "noHint": 50, "streak": 37 }, "tier": "Expert" }
```

`questionsByCategory` (how many questions of each category the game had) is also saved, for the category statistics. `mode` is `"full"`, `"category"` or `"speed"`. `subject` is `"All"`, a category name, or `"Speed"`. For a category run `maxScore` is 10 and `byCategory` has only that category; for a Speed Quiz it's 20. Exiting mid-run saves nothing. If storage is blocked, full or corrupt, the game still plays and just doesn't save. `nickname` is `""` when none was entered.

## Rank tiers

The rank comes from correct answers, not points, scaled to the run length.

| Rank | Full Challenge (of 40) | Speed Quiz (of 20) | By Category (of 10) |
| --- | --- | --- | --- |
| Novice | 0 | 0 | 0 |
| Apprentice | 12 | 6 | 3 |
| Scholar | 20 | 10 | 5 |
| Expert | 28 | 14 | 7 |
| Grandmaster | 36 | 18 | 9 |
