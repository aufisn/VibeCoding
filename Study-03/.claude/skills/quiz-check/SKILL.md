---
name: quiz-check
description: Verify the accuracy of the Study-03 quiz answers by cross-checking each question's correct answer, wrong options and explanation against at least two reliable web sources, following the Cross-Verification Guidelines in CLAUDE.md. Reports findings and suggested fixes; never edits the questions or sets "verified". Use when asked to fact-check, verify or check the accuracy of quiz questions or answers.
argument-hint: "[category | question id | id prefix] [unverified]"
allowed-tools: Bash(node scripts/list-questions.mjs:*), Read, WebSearch, WebFetch, Write(reports/*)
---

# quiz-check

Fact-check the quiz answers in `data/questions.json`. The goal is a report the user can act on when deciding which questions to mark `"verified": true`.

## Rules

- **Never edit `data/questions.json`** and **never set `"verified": true`**. The user does that after reading the report (see "Question rules" in `CLAUDE.md`). Suggest fixes; don't apply them unless the user asks in a later message.
- Use **at least two independent, reliable sources** per question: encyclopedias (e.g. Britannica), official bodies (NASA, NOAA, national statistics offices, UNESCO, museum or government sites), academic or reference works. Avoid forums, content farms, and AI-generated pages. Wikipedia can be one source but not both.
- Quote sources only briefly (a few words); summarise in your own words.

## Steps

1. Work from the Study-03 folder.

2. Choose the questions from the arguments: `$ARGUMENTS`
   - A category ("History", "Arts & Culture"), an id ("geo-03") or an id prefix ("sci"): only those.
   - `unverified`: skip questions already marked verified.
   - Nothing: all 40. Checking all of them takes a while, so work category by category and give a one-line progress update after each.

   ```sh
   node scripts/list-questions.mjs [filter] [--unverified] --json
   ```

3. For each question, check against the **Cross-Verification Guidelines** in `CLAUDE.md`:
   1. **One correct answer**: is the marked answer right, and is every other option clearly wrong? (A wrong option that is arguably correct is a problem too.)
   2. **Superlatives**: "largest", "first", "most"... have a stated measure (by area, by volume...). `node scripts/find-superlatives.mjs` lists them.
   3. **Time and scope**: facts that change over time state a point in time; the place and category are clear.
   4. **Cross-verification**: two sources agree. For facts that change (records, populations, office holders), say how current the sources are.
   Also check that the **explanation** is accurate and that the `sourceHint` points somewhere sensible.

4. Give each question one verdict:
   - **✅ Confirmed**: two sources agree, guidelines met.
   - **⚠️ Needs attention**: the answer is right but the wording is ambiguous, a distractor is arguably correct, the explanation has an error, or a time/scope/criterion is missing.
   - **❌ Incorrect**: the marked answer is wrong.

5. Write a report to `reports/quiz-check-YYYY-MM-DD.md` (today's date; add `-2`, `-3` if it exists). Include:
   - A summary line: how many checked, confirmed, needing attention, incorrect.
   - A table: id, verdict, one-line finding.
   - For every ⚠️ and ❌: the problem, a suggested rewrite (keeping the rules in `CLAUDE.md`: question at most 25 words, options at most 8, exactly 4 options, same difficulty), and the sources with links.
   - For every ✅: the two sources with links.
   - A closing note listing the ids that look ready for the user to mark `"verified": true` themselves.

6. In the chat, show the summary table and the ⚠️/❌ items, and give the report's path. Offer to apply the suggested fixes; if the user accepts, edit the questions, run `node scripts/validate-questions.mjs` and `node --test`, and bump `CACHE_VERSION` in `sw.js`.

If a fact can't be confirmed from two reliable sources, mark it ⚠️ and say what's missing. Don't guess.
