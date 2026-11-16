---
name: quiz-leaderboard
description: Manage the Study-03 quiz ranking system. Shows Overall / This week / Today leaderboards from a game backup file by mode and difficulty, audits a backup for impossible or inconsistent scores, and guides changes to the ranking rules in the code (rank tiers, sort order, periods, leaderboard size, points). Use when asked about quiz rankings, leaderboards, rank tiers or suspicious scores.
argument-hint: "[path/to/quiz-backup.json | sample] [overall|week|today] [full|category|speed] [mixed|easy|medium|hard] | audit <file> | change: what to change"
allowed-tools: Bash(node scripts/backup-report.mjs:*), Bash(node --test:*), Read
---

# quiz-leaderboard

Rankings are computed in each player's browser from their saved games, so this skill works on a **backup file** or the **code**.

Work from the Study-03 folder. Arguments: `$ARGUMENTS`

## A. Show leaderboards from a backup

Use this when the arguments include a backup path (or `sample` = `examples/sample-backup.json`).

1. Turn the words into options: `overall` → `--period all`, `week`/`this week` → `--period week`, `today` → `--period day`; `full`, `category`, `speed` → `--mode`; `mixed`, `easy`, `medium`, `hard` → `--difficulty`. Leave out what isn't given (all modes, every difficulty).

   ```sh
   node scripts/backup-report.mjs <file> leaderboard [--period all|week|day] [--mode ...] [--difficulty ...] --json
   ```

   "This week" starts Monday 00:00 and "Today" at midnight, in local time. For a backup from the past, the week and day are relative to today unless you pass `--now 2026-11-14`. Say which date you used.

2. Show one table per mode: rank, name ("Anonymous" if empty), points, correct / questions, rank tier, difficulty, subject (By Category only), date. Point out ties and anything notable (the same player holding several top places, a mode with no runs).

## B. Audit a backup

Use this for `audit <file>`, or whenever a leaderboard looks wrong.

```sh
node scripts/backup-report.mjs <file> audit
```

It flags runs the game can't produce: more correct answers than questions, categories that don't add up, impossible points for the number of correct answers, a points breakdown that doesn't add up, a streak longer than the correct answers, a rank tier that doesn't match the score, future dates, and duplicates. Explain each finding in plain words and what it likely means (an edited file, or a bug worth investigating). Exit code 2 means problems were found. Don't change the file.

## C. Change the ranking rules (code)

Use this when the arguments start with `change` or describe a rule change. Plan first, then make the change.

Where things live:
- `js/config.js`: `RANK_TIERS` (minimum correct answers out of 40), `SCORING` (points and bonuses).
- `js/scoring.js`, `tierFor()`: scales tier minimums to shorter runs (10, 12, 16, 20 questions).
- `js/storage.js`, `topRuns()`: sort order (points, then correct, then newest).
- `js/data-manager.js`: `periodStart()` (week starts Monday), `getLeaderboard()`, `HALL_OF_FAME_SIZE` (all-time top kept per mode and difficulty).
- `js/ui.js`: `LEADERBOARD_SIZE`, `renderLeaderboard()`.
- Tests: `tests/scoring.test.mjs` (tier boundaries), `tests/storage.test.mjs` (sorting), `tests/data-manager.test.mjs` (periods, leaderboards), `tests/backup-report.test.mjs` (audit).

Checklist:
- [ ] Update the boundary tests (every tier's lowest and highest score, for 40 and for shorter runs).
- [ ] Changing `RANK_TIERS` or `SCORING` doesn't rewrite saved games: their stored `tier` and `points` stay as they were, and the audit will then flag old ranks. Tell the user, and decide together whether that's acceptable.
- [ ] Keep `auditRuns()`/`maxPointsFor()` in `scripts/backup-report.mjs` in line with `SCORING`.
- [ ] Update the "Rank tiers" and "Points" tables in `README.md`.
- [ ] Bump `CACHE_VERSION` in `sw.js`.
- [ ] Run `node --test`, then check the Leaderboard screen in the browser.

If there are no arguments, briefly explain A, B and C and ask which the user wants (and for A or B, the path to their backup file, or offer `sample`).
