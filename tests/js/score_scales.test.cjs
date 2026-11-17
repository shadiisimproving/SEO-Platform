// Scores of different tools never sort as one (SEO review 2026-11-17, #7): the browser copy of cleaner.scale_of / scale_ranks,
// and the [group, value] sort the Backlinks, Link gaps and Shared links tables share.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const cleaner = require(path.join(__dirname, "..", "..", "design", "mockups", "cleaner.js"));

test("scaleOf reads the tool from a label, as the server does", () => {
  assert.strictEqual(cleaner.scaleOf("Authority Score (SEMrush)"), "semrush");
  assert.strictEqual(cleaner.scaleOf("SEMrush"), "semrush");
  assert.strictEqual(cleaner.scaleOf("DR (CSV)"), "dr (csv)");
  assert.notStrictEqual(cleaner.scaleOf("DR (CSV)"), cleaner.scaleOf("DA (CSV)"));
});

test("the tool most rows use leads, ties A to Z", () => {
  const ranks = cleaner.scaleRanks(["A (Ubersuggest)", "B (SEMrush)", "C (SEMrush)"]);
  assert.deepStrictEqual([...ranks], [["semrush", 0], ["ubersuggest", 1]]);
});

test("an Ubersuggest 70 never sorts above a SEMrush 54, either way round", () => {
  const rows = [[1, 70], [0, 54], [0, 60], [1000, 8]]; // [group, value]: SEMrush 0, Ubersuggest 1, Open PageRank last
  const down = [...rows].sort((x, y) => cleaner.compareScored(x, y, -1)).map((r) => r[1]);
  const up = [...rows].sort((x, y) => cleaner.compareScored(x, y, 1)).map((r) => r[1]);
  assert.deepStrictEqual(down, [60, 54, 70, 8]);
  assert.deepStrictEqual(up, [54, 60, 70, 8]);
  assert.strictEqual(cleaner.compareScored(5, 6, 1), null);
});
