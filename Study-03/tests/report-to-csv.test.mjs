import { test } from "node:test";
import assert from "node:assert/strict";

import { cleanCell, csvField, parseReport, reportFiles, slug, splitRow, toCsv } from "../scripts/report-to-csv.mjs";
import { collectClass, summarizeClass, renderCollect, renderOverview, renderCompare, renderInsights, comparePlayers, classInsights } from "../scripts/teacher-report.mjs";
import { makeClass } from "../scripts/make-sample-class.mjs";
import { loadFixedBank } from "./helpers.mjs";

test("splitRow keeps escaped pipes and cleans Markdown", () => {
  assert.deepEqual(splitRow("| a | **b** | x\\|y | `c` |"), ["a", "b", "x|y", "c"]);
  assert.equal(cleanCell("\\* Fewer"), "* Fewer");
});

test("csvField quotes commas, quotes and line breaks", () => {
  assert.equal(csvField("plain"), "plain");
  assert.equal(csvField("a, b"), '"a, b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField("two\nlines"), '"two\nlines"');
  assert.equal(toCsv([["a", "b"], ["1", "2"]]), "a,b\r\n1,2\r\n");
});

test("csvField defuses spreadsheet formulas but keeps numbers", () => {
  assert.equal(csvField("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvField("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvField("+cmd"), "'+cmd");
  assert.equal(csvField("-5"), "-5");
  assert.equal(csvField("+34"), "+34");
  assert.equal(csvField("-2.5%"), "-2.5%");
});

test("slug makes safe file names", () => {
  assert.equal(slug("Insights Class accuracy by category (weakest first)"), "insights-class-accuracy-by-category-weakest-first");
  assert.equal(slug("**Arts & Culture**"), "arts-culture");
});

test("a whole teacher report becomes one CSV per table plus the lists", async () => {
  const bank = await loadFixedBank();
  const now = new Date("2026-11-18T12:00:00Z");
  const sources = Object.entries(makeClass(bank)).map(([name, data]) => ({ name, text: JSON.stringify(data) }));
  const c = collectClass(sources, { now });
  const players = summarizeClass(c.runs, now);
  const opts = { threshold: 60, inactiveDays: 7 };
  const md = ["# Teacher report", renderCollect(c), renderOverview(players), renderCompare(comparePlayers(players)), renderInsights(classInsights(players, opts), opts)].join("\n\n");

  const parsed = parseReport(md);
  assert.equal(parsed.title, "Teacher report");
  const files = reportFiles(parsed);
  const overview = files.find((f) => f.name.endsWith("class-overview.csv"));
  assert.ok(overview);
  assert.equal(overview.rows[0][1], "Player");
  assert.equal(overview.rows.length - 1, players.length);
  assert.ok(files.every((f) => f.rows.every((r) => r.length === f.rows[0].length)), "every row has every column");
  assert.deepEqual(files.map((f) => f.name), [...files.map((f) => f.name)].sort(), "names sort in report order");
  const lists = files.at(-1);
  assert.match(lists.name, /lists\.csv$/);
  assert.ok(lists.rows.some((r) => r[1].startsWith("Needs support") && r[2].startsWith("Dev")));
});

test("a report without tables gives no files", () => {
  assert.deepEqual(reportFiles(parseReport("# Nothing\n\nJust text.")), []);
});
