---
description: Teacher mode, step 3. Compare chosen players side by side (or the whole class) by accuracy, points per question, streak, trend, hints, each category, each difficulty and best score per mode, with the leader of each row. Use when a teacher wants to compare two or more players.
argument-hint: "[folder | sample] [player, player, ...] [since YYYY-MM-DD] [full|category|speed]"
allowed-tools: Bash(node scripts/teacher-report.mjs:*), Read
---

# /teacher-compare: players side by side

Work from the Study-03 folder. Arguments: `$ARGUMENTS`

1. Source: as in `/teacher-collect` (default `class/`, `sample` → `examples/class` with `--now 2026-11-18T12:00`).
2. Players: names in the arguments → `--players "Ana,Ben"`. Names ignore case and extra spaces. With no names, compare the whole class, but if there are more than 6 players, suggest picking a few, since the table gets wide.
3. Run:

   ```sh
   node scripts/teacher-report.mjs <folder> compare --players "..." [--since ...] [--mode ...]
   ```

   A `⚠ No games for: ...` line means a name wasn't found. Show the nicknames that do exist (from `overview`) and ask which was meant.
4. Show the four tables (General, by category, by difficulty, best by mode), then a short head-to-head in plain words:
   - where each player is ahead
   - the biggest gap
   - one thing each player could practise, usually their weakest category
5. Fairness notes, when they apply:
   - "Leader" ignores missing values (–).
   - For hints, fewer is better.
   - A player with very few questions in a category can lead by luck, so say so.

Comparing points across modes isn't fair. Compare accuracy, and compare points only within one mode (the "Best scores by mode" table, or `--mode`).
