---
description: Teacher mode, all in one. Runs teacher-collect, teacher-overview, teacher-compare and teacher-insights in order on the class's backup files, and saves one combined Markdown report in reports/. Use when a teacher wants the full picture of the class, or says "teacher mode".
argument-hint: "[folder | sample] [player, player, ...] [since YYYY-MM-DD] [full|category|speed] [threshold NN] [inactive N]"
allowed-tools: Bash(node scripts/teacher-report.mjs:*), Bash(ls:*), Read, Write
---

# /teacher-mode: the full class report

This runs the four teacher commands together, in order, on the same files and filters:

| Step | Command | What it adds |
| --- | --- | --- |
| 1 | `/teacher-collect` | Reads and checks the backups: duplicates, shared devices, impossible scores |
| 2 | `/teacher-overview` | Every player in one ranked table |
| 3 | `/teacher-compare` | Players side by side, with the leader of each measure |
| 4 | `/teacher-insights` | Weakest topics, who needs support, who improved, habits |

Work from the Study-03 folder. Arguments: `$ARGUMENTS`

1. **Source and filters:**
   - Source: the arguments give the folder; `sample` → `examples/class` plus `--now 2026-11-18T12:00`; otherwise `class/`.
   - Filters: names → `--players`, `since` → `--since`, a mode → `--mode`, `threshold` → `--threshold`, `inactive` → `--inactive`.
   - If the source folder is missing or empty, explain how to collect backups (as in `/teacher-collect`) and stop.
2. **Collect.** Run `node scripts/teacher-report.mjs <folder> collect [filters]`. If no file could be read, stop and say why. Otherwise, summarize what was read and anything flagged, in 2 to 4 lines.
3. **Overview, compare, insights.** Run all three and write the combined report in one go:

   ```sh
   node scripts/teacher-report.mjs <folder> all [filters] --out reports/teacher-<YYYY-MM-DD>.md
   ```

   If that file already exists, add `-2`, `-3`… rather than overwriting it.
   The report is generated from the files, so don't edit its numbers. Add a closing **Teacher's summary** section to the file with the observations from steps 4 and 5.
4. **Reply in chat:**
   - The overview table.
   - 3 to 5 key observations: the leader, the most improved, who needs support, and the class's weakest category.
   - The path of the saved report.
   - Offer next steps: compare specific players (`/teacher-compare Ana, Ben`), look at only recent games (`since <date>`), or one mode.
5. **Privacy:**
   - `class/` is git-ignored. Reports about real pupils go in `reports/` and may contain their nicknames, so **ask before committing a report made from real class data**.
   - Reports made from `sample` can be committed.
   - Never change the backup files.

The individual commands also work on their own: use them to dig into one part.
