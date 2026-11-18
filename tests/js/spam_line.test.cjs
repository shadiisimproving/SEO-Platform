// One spam line everywhere (SEO review 2026-11-17, B5): above 30 is spam, 30 itself is not, as cleaner.is_spam_score on the server.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const cleaner = require(path.join(__dirname, "..", "..", "design", "mockups", "cleaner.js"));

test("a score of 30 is not spam, 30.5 and 31 are, unknown is not", () => {
  assert.strictEqual(cleaner.isSpamScore(30), false);
  assert.strictEqual(cleaner.isSpamScore(30.5), true);
  assert.strictEqual(cleaner.isSpamScore(31), true);
  assert.strictEqual(cleaner.isSpamScore(null), false);
  assert.strictEqual(cleaner.isSpamScore(undefined), false);
});
