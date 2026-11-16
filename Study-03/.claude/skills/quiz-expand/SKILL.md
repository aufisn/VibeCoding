---
name: quiz-expand
description: Grow the Study-03 question bank safely. Analyses the bank (structure, counts and distribution, missing categories, duplicates), backs it up, drafts new questions to fill gaps, checks them for duplicates and against the format and question rules before adding them as "verified": false, and writes a report. Use when asked to add, generate or expand quiz questions, fill a category, or analyse the question bank.
argument-hint: "[analyze] | [category] [easy|medium|hard] [count]"
allowed-tools: Bash(node scripts/analyze-bank.mjs:*), Bash(node scripts/backup-questions.mjs:*), Bash(node scripts/add-questions.mjs:*), Bash(node scripts/validate-questions.mjs:*), Bash(node scripts/find-superlatives.mjs:*), Bash(node scripts/list-questions.mjs:*), Bash(node --test:*), Read, Write(reports/*)
---

# quiz-expand

The game checks the question bank every time a game starts (`js/bank-analysis.js`) but never writes questions itself. This skill is where new questions are made, with the user's rules built in. Work from the Study-03 folder. Arguments: `$ARGUMENTS`

## Rules (from CLAUDE.md, never relax them)

- Every new question has `"verified": false`. **Never set `"verified": true`**: the user fact-checks and marks questions themselves.
- Only facts you are highly confident about, with a `sourceHint` naming where to check them (e.g. "Encyclopaedia Britannica: Nile River").
- Follow the **Quiz Question Cross-Verification Guidelines**: one correct answer (state conditions), measured superlatives ("by area"), a clear time and scope, nothing that changes quickly unless dated ("as of 2025").
- Format: question at most 25 words, exactly 4 different options of at most 8 words, no "all/none of the above", a one-sentence explanation, correct answer in a varied position (`correctIndex` 0 to 3).
- No more than 2 questions on the same sub-topic in a category; no duplicates of existing questions (the script checks wording; you check the topic).

## Steps

1. **Analyse.** Run `node scripts/analyze-bank.mjs` and summarise: totals, per-category and per-difficulty counts, missing or short categories, duplicates, and the gaps to full single-difficulty rounds. If the argument is `analyze`, stop here and show the analysis.

2. **Plan** what to add, from the arguments or, if none, from the gaps: e.g. `History hard 3` means three hard History questions; `Science 4` means four Science questions spread over the difficulties with the biggest gaps. Without arguments, propose a plan (no more than 12 questions per run, so each batch stays easy to fact-check) and ask the user to confirm before drafting.

3. **Read the category first** (`node scripts/list-questions.mjs <Category>`) so new questions cover different sub-topics and don't overlap existing ones.

4. **Draft** the questions into a scratch file (an array; no `id`, they're assigned). Example:

   ```json
   [{ "category": "Geography", "difficulty": "medium",
      "question": "Which river flows through Budapest, the capital of Hungary?",
      "options": ["Vistula", "Danube", "Elbe", "Rhine"], "correctIndex": 1,
      "explanation": "Budapest straddles the Danube, which divides historic Buda and Pest.",
      "sourceHint": "Encyclopaedia Britannica: Budapest", "verified": false }]
   ```

5. **Check** without writing: `node scripts/add-questions.mjs <draft file> --dry-run`. It checks format and rules, duplicates against the bank and each other, and that the bank stays valid. Fix every error; reconsider every "look at" (similar wording or the same answer as another question). Check that every superlative in the drafts ("largest", "first"...) states its measure.

6. **Add**: `node scripts/add-questions.mjs <draft file>`. It **backs up** `data/questions.json` to `backups/questions-<timestamp>.json` first, then writes the new questions (after their category's last question, ids `hist-11`, `sci-12`...).

7. **Verify the result**: `node scripts/validate-questions.mjs`, `node scripts/analyze-bank.mjs` and `node --test`. Then bump `CACHE_VERSION` in `sw.js` (offline players get the new questions; online players get them on their next load anyway).

8. **Report**: write `reports/quiz-expand-YYYY-MM-DD.md` (add `-2`... if it exists) with: the analysis before and after (counts table), the backup path, each added question (id, category, difficulty, question, answer, sourceHint), anything rejected and why, and the next step: fact-check the new ids, e.g. `/quiz-check hist-11`. Show the summary in the chat with the report's path.

If any step fails, stop, show the error, and leave `data/questions.json` as it was (the backup is there if a write went wrong).
