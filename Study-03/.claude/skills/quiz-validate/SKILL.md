---
name: quiz-validate
description: Find superlative and ranking expressions (most, first, largest, longest, only...) in the Study-03 quiz questions and display them, with whether each states its measurement criterion. Use when asked to check, list or review superlatives in the quiz questions.
argument-hint: "[explanations] [extra words, comma-separated]"
allowed-tools: Bash(node scripts/find-superlatives.mjs:*), Read
---

# quiz-validate

List every superlative or ranking expression in the quiz questions (`data/questions.json`), so each can be checked against guideline 2 of the "Quiz Question Cross-Verification Guidelines" in `CLAUDE.md`: *specify measurement criteria for expressions like 'largest', 'smallest', etc.*

This skill only reports. **Do not edit `data/questions.json` or any other file.**

## Steps

1. Work from the Study-03 folder (the folder that contains this `.claude` folder, `data/` and `scripts/`).

2. Build the command from the arguments: `$ARGUMENTS`
   - If they include the word `explanations`, add `--explanations` (also search the explanations).
   - Any other words are extra expressions to look for: add `--words word1,word2`.
   - No arguments: run it as is (questions and options only).

3. Run the finder and use its output as the source of truth (don't search by hand):

   ```sh
   node scripts/find-superlatives.mjs --json [--explanations] [--words a,b]
   ```

   It matches whole words only, case-insensitively, from the list in `SUPERLATIVES` in `scripts/find-superlatives.mjs` (most, least, first, last, only, largest, longest, highest, oldest, fastest and more).

4. Display the results as a table, one row per match, in question-id order:

   | # | ID | Category | Where | Expression | Text | Criterion stated? |
   | --- | --- | --- | --- | --- | --- | --- |

   - **Where**: question, option A–D, or explanation.
   - **Text**: the full text with the matched word in **bold**.
   - **Criterion stated?**: your judgement against guideline 2. "Yes" plus the criterion in a few words when the measure, time or scope is explicit (e.g. "by surface area", "by volume", "on the Moon"). "Unclear" plus one short reason when another reading could give a different answer (e.g. "first" with no scope, "largest" with no measure). For an expression in an option or explanation that doesn't affect which answer is correct, write "n/a".

5. End with a one-line summary: total matches, number of questions, and a count per expression (the finder's report gives these: run it again without `--json` if useful).

6. If there are no matches, say "No superlative expressions found" and stop.

If the command fails (for example the questions file is missing or isn't valid JSON), show the error message and stop.
