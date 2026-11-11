// Runs the AI search screen's own helpers from the Python tests (tests/test_ai_search.py). Reads one JSON request on stdin.
// "fold": rows of 1 folding into one line. "french": every word the screen writes that has no French.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const DIR = path.join(__dirname, "..", "..", "design", "mockups");

function load() {
  const page = { window: {}, console };
  page.window.window = page.window;
  page.window.addEventListener = () => {};
  page.document = { addEventListener: () => {}, querySelectorAll: () => [] };
  page.window.document = page.document;
  page.setInterval = () => 0;
  vm.createContext(page);
  // The same order as index.html, for the files that hold the words this screen borrows.
  for (const name of ["data.js", "shared-ui.js", "tasks.js", "screens-live.js", "google-ai-report.js", "ai-search-view.js"]) {
    try { vm.runInContext(`with (window) {${fs.readFileSync(path.join(DIR, name), "utf8")}}`, page); } catch (err) { if (name === "ai-search-view.js") throw err; }
  }
  return page.window;
}

/* The words the screen passes to t() or tf(), and the labels it gives tables and buttons. */
function words() {
  const source = fs.readFileSync(path.join(DIR, "ai-search-view.js"), "utf8").split("const fr = {")[0];
  const found = new Set();
  const literal = /(?:\bt|\btf|\bplural)\(\s*"((?:[^"\\]|\\.)*)"(?:\s*,\s*"((?:[^"\\]|\\.)*)")?/g;
  for (const m of source.matchAll(literal)) { found.add(m[1]); if (m[2]) found.add(m[2]); }
  for (const m of source.matchAll(/\bplural\([^,()]+(?:\([^()]*\))?[^,()]*,\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"/g)) { found.add(m[1]); found.add(m[2]); }
  for (const m of source.matchAll(/\b(?:label|word|allWord|empty|markName|name):\s*"((?:[^"\\]|\\.)*)"/g)) found.add(m[1]);
  for (const m of source.matchAll(/\[\s*"[a-z_]+",\s*"([A-Z](?:[^"\\]|\\.)*)"\s*\]/g)) found.add(m[1]);
  for (const m of source.matchAll(/\b(?:ga4|clarity_live|clarity_download):\s*"([A-Z](?:[^"\\]|\\.)*)"/g)) found.add(m[1]);
  return [...found].map((w) => JSON.parse(`"${w}"`));
}

const ask = JSON.parse(fs.readFileSync(0, "utf8"));
const w = load();
let answer;
if (ask.ask === "fold") answer = w.AISearch.foldRows(ask.rows, (r) => r.v === 1, ask.min);
else if (ask.ask === "french") answer = words().filter((word) => w.FR[word] === undefined && !/^(AI Overview|SerpApi|Clarity|Google Analytics|Search Console)$/.test(word));
process.stdout.write(JSON.stringify(answer));
