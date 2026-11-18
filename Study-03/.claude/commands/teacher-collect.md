---
description: Teacher mode, step 1. Gather the players' quiz backup files from a folder, check each one, merge them, skip duplicates and set aside impossible scores. Use when a teacher wants to load or check the class's backup files.
argument-hint: "[folder or files, default class/ | sample]"
allowed-tools: Bash(node scripts/teacher-report.mjs:*), Bash(ls:*), Read
---

# /teacher-collect: gather the class's backups

Each player's results live in their own browser. To compare players, the teacher collects one backup per device: on each device, **Statistics → Download backup**, then put the `quiz-backup-*.json` files in one folder (default `class/`, which git ignores so student data stays private).

Work from the Study-03 folder. Arguments: `$ARGUMENTS`

1. Choose the source: the folder or files in the arguments, `sample` → `examples/class` (a pretend class of 7 players), or `class/` if nothing is given. If the folder is missing or empty, explain how to collect backups (above) and stop.
2. Run:

   ```sh
   node scripts/teacher-report.mjs <folder> collect
   ```

   Add `--now <date>` for the sample (`--now 2026-11-18T12:00`), so "days ago" makes sense.
3. Report in plain words:
   - How many files were read and how many games and players were found. Any file that isn't a backup, and why.
   - **Duplicates skipped:** the same game handed in twice, for example two backups from the same device a week apart. That's normal.
   - **Shared devices:** files holding several nicknames. Each nickname counts as its own player.
   - **One nickname in several files:** merged as one player, which is usually the same person on two devices. Ask the teacher to confirm if two pupils might share a nickname.
   - **Games without a nickname:** kept per file, because they can't be matched to a person.
   - **Impossible scores:** runs the game can't produce (from `auditRuns`), most likely an edited file. They're left out of every comparison. Name the player and file. Mention `--include-flagged` only if the teacher wants them counted anyway.
4. Never change, rename or delete the backup files.

Next step: `/teacher-overview`, or `/teacher-mode` for the full report.
