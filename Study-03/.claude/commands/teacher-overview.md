---
description: Teacher mode, step 2. One table of every player at a glance, ranked by accuracy, with games, best scores, streak, rank, strongest and weakest category, trend and last played. Use when a teacher asks how the class or each player is doing.
argument-hint: "[folder | sample] [since YYYY-MM-DD] [full|category|speed]"
allowed-tools: Bash(node scripts/teacher-report.mjs:*), Read
---

# /teacher-overview: the class at a glance

Work from the Study-03 folder. Arguments: `$ARGUMENTS`

1. Source: as in `/teacher-collect` (default `class/`, `sample` → `examples/class` with `--now 2026-11-18T12:00`). Turn words into options: `since <date>` → `--since`, and `full`, `category` or `speed` → `--mode`.
2. Run:

   ```sh
   node scripts/teacher-report.mjs <folder> overview [--since ...] [--mode ...]
   ```

3. Show the table as it is, then add 3 to 5 short observations a teacher can act on:
   - who leads, and by how much
   - who is improving (Trend +10 or more) or slipping (−10 or less)
   - the most common weakest category
   - who hasn't played lately
4. Explain the ranking whenever it matters:
   - Ranking uses **accuracy** (correct ÷ questions asked), not points, because points depend on the mode and run length.
   - Players with fewer than 20 questions are listed last with `*` and are not ranked yet.
   - Trend compares the latest games with the earlier ones, in percentage points, and needs 4 or more games.

If the files haven't been checked yet in this conversation, run `/teacher-collect` first and mention anything it flagged.
