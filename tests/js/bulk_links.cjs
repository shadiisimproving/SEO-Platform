// Runs the browser's bulk upload code from the Python tests. Reads one JSON request on stdin, answers with JSON.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const bulk = require(path.join(__dirname, "..", "..", "design", "mockups", "bulk-links.js"));

/* The words on screen with no French. Loads the same scripts the page does, in the same order. */
function noFrench(words) {
  const page = { window: {} };
  page.self = page.window;
  page.window.BacklinkCleaner = require(path.join(__dirname, "..", "..", "design", "mockups", "cleaner.js"));
  vm.createContext(page);
  for (const name of ["data.js", "bulk-links.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", "design", "mockups", name), "utf8"), page);
  return words.filter((word) => page.window.FR[word] === undefined);
}

const ask = JSON.parse(fs.readFileSync(0, "utf8"));
const answers = {
  french: () => noFrench(ask.words),
  template: () => ({ text: bulk.TEMPLATE_TEXT, columns: bulk.TEMPLATE_COLUMNS, examples: bulk.EXAMPLE_SOURCES }),
  prices: () => ask.values.map((value) => bulk.parsePrice(value)),
  currencies: () => ask.values.map((value) => bulk.currencyOf(value)),
  statuses: () => ask.values.map((value) => bulk.statusOf(value)),
  columns: () => bulk.matchColumns(ask.headers),
  header: () => bulk.looksLikeHeader(ask.row),
  table: () => bulk.readTable(bulk.decode(new Uint8Array(Buffer.from(ask.base64, "base64")))),
  limits: () => ({ limits: bulk.LIMITS, most: bulk.MAX_ROWS, fields: bulk.FIELDS.map(([key, label]) => [key, label]) }),
  sources: () => ask.values.map((value) => bulk.sourceKey(value)),
  sites: () => ask.values.map((value) => bulk.siteKey(value)),
  check: () => bulk.checkRows(ask.table),
  tagged: () => ask.links.map((link) => bulk.taggedLink(link)),
};
process.stdout.write(JSON.stringify(answers[ask.command]()));
