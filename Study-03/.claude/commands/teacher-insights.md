---
description: Teacher mode, step 4. Class-wide findings to act on. Covers the class's weakest category and difficulty, players who need support, the most improved, top performers, inactive players, players without enough data, and habits such as heavy Eliminate use, skipping or running out of time. Use when a teacher asks what to focus on or who needs help.
argument-hint: "[folder | sample] [threshold NN] [inactive N days] [since YYYY-MM-DD]"
allowed-tools: Bash(node scripts/teacher-report.mjs:*), Read
---

# /teacher-insights: what to act on

Work from the Study-03 folder. Arguments: `$ARGUMENTS`

1. Source: as in `/teacher-collect` (default `class/`, `sample` → `examples/class` with `--now 2026-11-18T12:00`). Options:
   - `threshold NN` → `--threshold NN`: accuracy under which a player needs support. Default 60.
   - `inactive N` → `--inactive N`: days without a game. Default 7.
   - `since <date>` → `--since`.
   - A player list → `--players`.
2. Run:

   ```sh
   node scripts/teacher-report.mjs <folder> insights [options]
   ```

3. Present the findings in this order, briefly:
   1. **Suggested focus:** the class's weakest category, and where players differ most (a big gap suggests pairing stronger and weaker players).
   2. **Needs support:** each name with the reason (low accuracy, or falling) and their weakest category. If they're also improving fast, say so first: it's good news.
   3. **Most improved** and **top performers:** worth praising.
   4. **Inactive**, and **not enough data yet:** encourage them to play a few more games before drawing conclusions.
   5. **Habits:**
      - Heavy Eliminate use means guessing support: suggest trying without it.
      - Skipping means avoiding hard questions.
      - Running out of time in Speed Quiz means practising pace.
4. Keep the tone kind and practical. This is for helping players, not labelling them. Base claims only on the numbers shown. Don't guess at reasons (home life, effort) the data can't show.
