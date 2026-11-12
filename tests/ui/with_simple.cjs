// Runs any flow with the simpler screens switch on (track T1, 2026-11-12), without touching the flow:
//   node tests/ui/with_simple.cjs flow_today.cjs <the flow's own arguments>
// Every browser the flow opens through pw.cjs remembers the switch as on (seocc2-simple = 1) before its first page loads,
// exactly as ?simple=1 would leave it. A page address with ?simple=0 still turns it off.
const path = require("path");
const pw = require("./pw.cjs");
const plain = pw.open;
pw.open = async (opts = {}) => {
  const { url, ...rest } = opts;
  const run = await plain(rest);
  await run.context.addInitScript(() => {
    try { if (new URLSearchParams(location.search).get("simple") !== "0") localStorage.setItem("seocc2-simple", "1"); } catch { /* a page with no storage */ }
  });
  if (url) await run.page.goto(url);
  return run;
};
const flow = process.argv[2];
if (!flow) { console.error("Say which flow: node tests/ui/with_simple.cjs flow_today.cjs …"); process.exit(2); }
process.argv.splice(2, 1);
require(path.resolve(__dirname, flow));
