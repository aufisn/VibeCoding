# Quiz Game

A single-player general knowledge quiz: 4-option multiple choice in four categories (History, Science, Geography, Arts & Culture). A full game has 40 questions, 10 per category, picked from a bank of 52 (13 per category) that can keep growing. Plain HTML, CSS and vanilla JavaScript (ES modules). No frameworks, no build step, no backend, no dependencies.

**Status: Phase 3 (polish and launch) done.** Subject choice, Eliminate, Skip, review of mistakes, a personal leaderboard, keyboard and screen-reader support, a light/dark switch, and offline play. See [DEPLOY.md](DEPLOY.md) to publish it.

## How to play

Enter an optional nickname, then pick a game mode:

| Mode | Questions | Notes |
| --- | --- | --- |
| **Full Challenge** | All 40 | Four rounds (History, Science, Geography, Arts & Culture) with a summary after each. Pressing Enter in the nickname box starts it. |
| **By Category** | 10 | All the questions of the category you pick. |
| **Speed Quiz** | 20 | 5 random questions from each category, mixed. **15 seconds per question**; when time runs out the question scores 0 and the answer is shown. |

Above the modes, pick a **difficulty**: **Mixed** (every question, the default), **Easy**, **Medium** or **Hard**. Easy, Medium and Hard play only questions of that difficulty, so rounds are shorter: with the current bank (4 easy, 5 medium and 4 hard per category), a Full Challenge has 16, 20 or 16 questions, a category round 4, 5 or 4, and a Speed Quiz 16, 20 or 16. Rounds grow as questions are added, up to 10 per category. The cards show the count for the chosen difficulty. Your choice is kept for the next game.

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
- **Leaderboard** (also on the Start screen) shows your top 10 runs on this device. Choose a period (**Overall**, **This week** from Monday 00:00, or **Today** from midnight, in your local time), a mode (Full Challenge, By Category, Speed Quiz) and a difficulty, since runs of different lengths can't be compared fairly. Runs saved before difficulty existed count as Mixed. Runs are ranked by points, then correct answers, then newest. The run you just finished is marked "This run". Runs saved before points existed show "–" and rank last.
- **Statistics** (also on the Start screen) covers every game you've finished: games played, accuracy, total and average points, best streak, accuracy per category (with your strongest and weakest category) and per difficulty, and games, best and average points per mode.
- **Backup and restore** (on the Statistics screen): **Download backup** saves a file such as `quiz-backup-2026-11-16.json` with your games and statistics. **Restore from file** loads one, for example on a new phone or another browser. Restoring **replaces** what's on this device, after a confirmation. Files that aren't Quiz Game backups are refused, and every value in a file is checked and cleaned before use.
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

## Claude Code skills

Five project skills live in `.claude/skills/`. Open a Claude Code session in this folder and type the command (or just ask in plain words):

| Command | What it does |
| --- | --- |
| `/quiz-validate` | Lists superlatives ("most", "first", "largest"...) and whether each states its measure (guideline 2). |
| `/quiz-check [History \| geo-03 \| sci] [unverified]` | Fact-checks answers, wrong options and explanations against two reliable sources each, following the Cross-Verification Guidelines, and writes `reports/quiz-check-YYYY-MM-DD.md`. Never edits questions or sets `verified`. |
| `/quiz-stats <backup.json \| sample>` | Statistics from a backup file (Statistics → Download backup): overview, by mode, category and difficulty, trends, practice tips. `/quiz-stats change: ...` guides code changes to what the game tracks. |
| `/quiz-leaderboard <backup.json \| sample> [overall \| week \| today] [full \| category \| speed] [difficulty]` | Leaderboards from a backup; `audit <file>` flags impossible scores; `change: ...` guides changes to rank tiers, sorting and periods. |
| `/quiz-expand [analyze \| category] [difficulty] [count]` | Analyses the bank, backs it up, drafts and checks new questions for the gaps, adds them unverified, writes a report. See "Growing the bank". |

`sample` means `examples/sample-backup.json`: 36 simulated games, made with the game's own engine. The scripts behind the skills also work on their own:

```sh
node scripts/list-questions.mjs History                    # questions with their correct answers
node scripts/backup-report.mjs examples/sample-backup.json stats
node scripts/backup-report.mjs examples/sample-backup.json leaderboard --period week --mode speed
node scripts/backup-report.mjs examples/sample-backup.json audit
```

## Teacher mode

Teacher mode compares many players at a glance. Each player's results stay in their own browser, so the teacher collects one backup per device (**Statistics → Download backup**) into a `class/` folder. That folder is git-ignored, so pupils' data stays on the teacher's computer. Then, in a Claude Code session opened in this folder:

| Command | What it does |
| --- | --- |
| `/teacher-collect [folder \| sample]` | Reads and checks every backup. It merges them, skips games handed in twice, notes shared devices and nicknames found on several devices, and leaves out impossible (edited) scores. |
| `/teacher-overview [folder \| sample] [since date] [mode]` | One table of every player, ranked by accuracy. It shows games, best Full and Speed scores, streak, rank, strongest and weakest category, trend and last played. |
| `/teacher-compare [folder \| sample] Ana, Ben` | Chosen players (or everyone) side by side: general measures, each category, each difficulty and best score per mode, with the leader of each row. |
| `/teacher-insights [folder \| sample] [threshold 60] [inactive 7]` | What to act on: the class's weakest category, who needs support, the most improved, top performers, inactive players, and habits such as heavy Eliminate use, skipping and running out of time. |
| `/teacher-csv [report.md \| latest]` | Reads a saved teacher report and writes it as CSV files for Excel, Numbers or Google Sheets (one per table, plus `…-lists.csv` for the insights) in `reports/teacher-YYYY-MM-DD-csv/`. |
| `/teacher-mode [folder \| sample] [players] [since date] [mode]` | **All of the above in order.** It saves `reports/teacher-YYYY-MM-DD.md` with a short teacher's summary, plus its CSV folder. |

These are custom commands in `.claude/commands/` (Claude Code treats them like skills). `sample` means `examples/class/`, a pretend class of 7 players. It covers a shared library computer, one pupil on two devices, a backup handed in twice, and an edited score the audit catches; `scripts/make-sample-class.mjs` rebuilds it. A sample report is in `reports/teacher-2026-11-18.md`, with its CSV files in `reports/teacher-2026-11-18-csv/`.

Fair comparison:
- Players are ranked by **accuracy**, because points depend on mode and run length. Points are only compared within one mode.
- Players with fewer than 20 questions are listed but not ranked.
- Trend compares the latest games with the earlier ones and needs 4 or more games.

The script also works on its own:

```sh
node scripts/teacher-report.mjs class all --out reports/teacher-$(date +%F).md
node scripts/teacher-report.mjs examples/class compare --players "Ana,Ben" --now 2026-11-18T12:00
node scripts/teacher-report.mjs class insights --since 2026-11-01 --threshold 50 --json
node scripts/report-to-csv.mjs reports/teacher-2026-11-18.md     # → reports/teacher-2026-11-18-csv/
```

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
| `js/bank-analysis.js` | Pure question bank analysis (structure, counts, missing categories, duplicates, gaps) run at every game start; `checkNewQuestions` for additions |
| `scripts/analyze-bank.mjs`, `backup-questions.mjs`, `add-questions.mjs`, `bank-tools.mjs` | Analyse, back up and safely grow the question bank (used by `/quiz-expand`) |
| `js/data-manager.js` | `LocalDataManager` class: automatic saving, statistics, the latest 100 games, Overall / Weekly / Daily leaderboards, backup export and restore (never throws) |
| `js/storage.js` | `saveRun`, `loadRuns`, `clearRuns` for the `quiz.runs` history in localStorage (never throw), and pure `topRuns(runs, n, mode)` and `runMode(run)` for the leaderboard |
| `js/ui.js` | Renders one screen at a time and handles events. No game rules |
| `data/questions.json` | The question bank (52 questions) |
| `tests/fixtures/questions-40.json` | A fixed copy of the original 40-question bank, for tests that depend on exact counts |
| `scripts/validate-questions.mjs` | Command-line validator |
| `scripts/find-superlatives.mjs` | Lists superlative and ranking words in the questions (used by `/quiz-validate`) |
| `scripts/list-questions.mjs` | Prints questions with their correct answers (used by `/quiz-check`) |
| `scripts/backup-report.mjs` | Statistics, leaderboards and an audit from a backup file (used by `/quiz-stats` and `/quiz-leaderboard`) |
| `examples/sample-backup.json` | A sample backup of 36 simulated games, for trying the skills |
| `scripts/teacher-report.mjs` | Teacher mode: merges many players' backups and prints collect, overview, compare and insights reports (used by the `/teacher-*` commands) |
| `scripts/report-to-csv.mjs` | Turns a teacher report into CSV files, one per table plus the lists; defuses spreadsheet formulas in nicknames (used by `/teacher-csv`) |
| `scripts/make-sample-class.mjs`, `examples/class/` | Builds, and is, the pretend class used by `sample` in teacher mode |
| `.claude/skills/` | The Claude Code skills: `quiz-validate`, `quiz-check`, `quiz-stats`, `quiz-leaderboard`, `quiz-expand` |
| `.claude/commands/` | The teacher-mode commands: `teacher-collect`, `teacher-overview`, `teacher-compare`, `teacher-insights`, `teacher-csv`, and `teacher-mode`, which runs them all |
| `tests/*.test.mjs` | Unit tests (validator, quiz, scoring, score manager, state, storage, keys, service worker precache list); `tests/helpers.mjs` has shared fakes |
| `package.json` | Only marks `.js` files as ES modules for Node. Nothing to install |

## Question bank check

Every time a game starts (and when the page loads), the game analyses the question bank with `js/bank-analysis.js`:

- **Structure**: every question has the right fields and follows the format rules (the validator's checks).
- **Counts and distribution**: questions per category and per difficulty, how many are verified, and how many different full rounds each category can supply.
- **Missing categories**: categories with no questions, too few for a round (at least 3 easy, 4 medium and 3 hard), or unknown ones.
- **Duplicates**: the same id, the same question (ignoring case, punctuation, and "Two" vs "II"), questions with very similar wording, and the same correct answer twice in a category.

The result is the **Question bank** panel at the bottom of the Start screen (open it for the details), and a collapsible report in the browser console. The check only reports; it never stops a game (the bank was validated when it loaded) and it never changes questions. The same analysis runs from the command line:

```sh
node scripts/analyze-bank.mjs     # add --json for machine-readable output
```

## Growing the bank

The bank can hold more than 40 questions. A game picks from it: a Full Challenge still has 10 per category in a 3 easy / 4 medium / 3 hard mix (so scores stay comparable), and Easy, Medium and Hard rounds use up to 10 per category, so they get longer as the bank grows. The validator requires at least 10 per category with that mix.

New questions are made with the **`/quiz-expand`** Claude Code skill, never by the game itself: it analyses the bank, plans what to add for the gaps, drafts questions following the rules and guidelines in `CLAUDE.md`, checks them, **backs up** `data/questions.json` to `backups/questions-<timestamp>.json`, adds them as `"verified": false`, and writes a report to `reports/`. Fact-check the new questions (`/quiz-check <ids>`) before marking them verified. The scripts it uses:

```sh
node scripts/backup-questions.mjs                     # back up the bank
node scripts/add-questions.mjs drafts.json --dry-run  # check drafts: format, rules, duplicates
node scripts/add-questions.mjs drafts.json            # back up, then add (ids assigned)
```

`backups/` stays on your computer (it's in `.gitignore`; git history keeps every version too).

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
- Each category needs at least 10 questions: at least 3 easy, 4 medium and 3 hard. A game picks 10 per category from them.
- `options` must be exactly 4 unique, non-empty strings. `correctIndex` is the 0-based position of the right answer.

## Saved results

Saving is automatic and handled by the `LocalDataManager` class (`js/data-manager.js`). It keeps two localStorage entries:

- `quiz.runs`: the latest 100 finished games, newest first.
- `quiz.stats`: running statistics, updated after every game: totals, per mode, per category, and each mode's all-time top 10. Because it keeps counting, statistics include games older than the latest 100, and a best score stays on the Overall leaderboard after it drops out of them. If it's missing or corrupt, it's rebuilt from `quiz.runs`.

Your data never leaves the device unless you download a backup. A saved game looks like this:

```json
{ "nickname": "Sam", "finishedAt": "2026-11-15T12:00:00.000Z",
  "mode": "full", "subject": "All", "points": 612, "total": 30, "maxScore": 40,
  "byCategory": { "History": 8, "Science": 7, "Geography": 9, "Arts & Culture": 6 },
  "skipped": 2, "timedOut": 0, "eliminated": 5, "bestStreak": 9,
  "bonuses": { "base": 450, "time": 75, "noHint": 50, "streak": 37 }, "tier": "Expert" }
```

Newer games also save `difficulty` (`"mixed"`, `"easy"`, `"medium"` or `"hard"`), `questionsByCategory` and `byDifficulty` (questions asked and answered correctly per category and per difficulty), for the statistics. `mode` is `"full"`, `"category"` or `"speed"`. `subject` is `"All"`, a category name, or `"Speed"`. For a category run `maxScore` is 10 and `byCategory` has only that category; for a Speed Quiz it's 20. Exiting mid-run saves nothing. If storage is blocked, full or corrupt, the game still plays and just doesn't save. `nickname` is `""` when none was entered.

## Rank tiers

The rank comes from correct answers, not points, scaled to the run length.

| Rank | Full Challenge (of 40) | Speed Quiz (of 20) | By Category (of 10) |
| --- | --- | --- | --- |
| Novice | 0 | 0 | 0 |
| Apprentice | 12 | 6 | 3 |
| Scholar | 20 | 10 | 5 |
| Expert | 28 | 14 | 7 |
| Grandmaster | 36 | 18 | 9 |
