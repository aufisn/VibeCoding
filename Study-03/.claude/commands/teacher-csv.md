---
description: Teacher mode, step 5. Read a teacher report (reports/teacher-*.md) and save it as CSV files for Excel, Numbers or Google Sheets, one per table plus one for the insight lists. Use when a teacher wants the report as CSV or in a spreadsheet.
argument-hint: "[reports/teacher-YYYY-MM-DD.md | latest] [--out folder]"
allowed-tools: Bash(node scripts/report-to-csv.mjs:*), Bash(ls:*), Read
---

# /teacher-csv: save a teacher report as CSV

Work from the Study-03 folder. Arguments: `$ARGUMENTS`

1. **Choose the report:**
   - A path in the arguments.
   - Otherwise, or with `latest`, the newest `reports/teacher-*.md`. List them with `ls -t reports/teacher-*.md` and say which one you picked.
   - If there's none, say so and suggest `/teacher-mode` (or `/teacher-mode sample`) to make one first.
2. **Run:**

   ```sh
   node scripts/report-to-csv.mjs <report.md> [--out <folder>]
   ```

   By default the files go in a folder next to the report, named after it: `reports/teacher-2026-11-18.md` → `reports/teacher-2026-11-18-csv/`. Running it again replaces the files in that folder. The report itself is never changed.
3. **Report the result.** List the files it wrote, with each one's rows and columns and the report section it came from. Point out the main ones:
   - `…-class-overview.csv`: one row per player, the table most teachers want.
   - `…-side-by-side-comparison-…csv`: the comparison tables, one column per player.
   - `…-lists.csv`: the insights (needs support, most improved, inactive, habits) and the teacher's summary, one bullet per row, with its section and heading.
4. **Spreadsheet notes**, mentioned briefly:
   - The files are UTF-8 with a byte order mark, so ✔, → and accents show correctly in Excel. Excel can open them directly; in Google Sheets, use File → Import.
   - Values are copied from the report as written. For example, accuracy reads "87% (118/135)", so sort by the Accuracy column as text, or split it in the spreadsheet.
   - Nicknames come from players. Any cell that a spreadsheet would run as a formula (starting with =, @, + or −, other than a plain number) gets a leading apostrophe, so it shows as text.
5. **Privacy.** CSVs made from real class data contain pupils' nicknames. Ask before committing them; CSVs from the sample report are fine to commit.

The script only converts files whose title is `# Teacher report`. `--force` converts the tables of any Markdown file, but use it only if the user asks.
