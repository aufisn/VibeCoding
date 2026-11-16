# Question bank expansion: 16 November 2026

Made with the `/quiz-expand` workflow (scripts/analyze-bank.mjs, add-questions.mjs). All new questions are `"verified": false` until you fact-check them.

## Summary

- **Added:** 12 questions, one per category and difficulty.
- **Rejected:** none. The dry run found no rule problems, duplicates or near-duplicates.
- **Backup of the previous bank:** `backups/questions-20261116-171212.json` (on this computer only; git history also has it).
- **Checks after adding:** validator 0 errors (52 "not verified" warnings), bank analysis "all checks passed", superlatives all state their measure, `node --test` passes.

## Before and after

| Category | Before (easy/medium/hard) | After (easy/medium/hard) |
| --- | --- | --- |
| History | 10 (3/4/3) | 13 (4/5/4) |
| Science | 10 (3/4/3) | 13 (4/5/4) |
| Geography | 10 (3/4/3) | 13 (4/5/4) |
| Arts & Culture | 10 (3/4/3) | 13 (4/5/4) |
| **Total** | **40** | **52** |

A Full Challenge still has 40 questions (10 per category, 3/4/3), now picked from 13 per category, so games vary more. Easy, Medium and Hard rounds now have 4, 5 and 4 questions per category (16, 20 and 16 in a Full Challenge).

## Topics chosen

New sub-topics, so no category has more than 2 questions on one sub-topic: no third capital city in Geography (Australia and Canada already), no third painting in Arts & Culture (Mona Lisa and The Starry Night already). Correct answers were placed to even out answer positions within each category.

## Added questions

| Id | Category | Difficulty | Question | Answer | Where to check |
| --- | --- | --- | --- | --- | --- |
| hist-11 | History | easy | Which ship carried the Pilgrims from England to North America in 1620? | Mayflower | Encyclopaedia Britannica: Mayflower |
| hist-12 | History | medium | Who crowned himself Emperor of the French at Notre-Dame in Paris in 1804? | Napoleon Bonaparte | Encyclopaedia Britannica: Napoleon I |
| hist-13 | History | hard | Which Roman emperor dedicated Constantinople, the former Byzantium, as his new capital in 330 CE? | Constantine the Great | Encyclopaedia Britannica: Constantine I |
| sci-11 | Science | easy | At sea level, at what temperature in degrees Celsius does pure water boil? | 100 | Encyclopaedia Britannica: boiling point |
| sci-12 | Science | medium | Which organ in the human body produces the hormone insulin? | Pancreas | NIDDK (US National Institutes of Health): insulin and the pancreas |
| sci-13 | Science | hard | Which mineral is rated 10, the highest hardness, on the Mohs scale? | Diamond | Encyclopaedia Britannica: Mohs hardness |
| geo-11 | Geography | easy | On which continent is the Sahara Desert? | Africa | Encyclopaedia Britannica: Sahara |
| geo-12 | Geography | medium | Which country is the largest in the world by total area? | Russia | Encyclopaedia Britannica: Russia |
| geo-13 | Geography | hard | Which strait separates Spain in Europe from Morocco in Africa? | Strait of Gibraltar | Encyclopaedia Britannica: Strait of Gibraltar |
| art-11 | Arts & Culture | easy | Which instrument has 88 keys in its standard modern form? | Piano | Encyclopaedia Britannica: piano |
| art-12 | Arts & Culture | medium | Which author wrote the novel Nineteen Eighty-Four? | George Orwell | Encyclopaedia Britannica: Nineteen Eighty-four |
| art-13 | Arts & Culture | hard | Which ancient Greek playwright wrote the tragedy Oedipus Rex? | Sophocles | Encyclopaedia Britannica: Oedipus Rex |

## Next step

Fact-check these 12 before marking them verified, e.g. `/quiz-check hist-11` ... or all at once by category. Only you set `"verified": true`.
