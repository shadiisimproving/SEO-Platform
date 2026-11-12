// The simpler screens are the default since 2026-11-12 (owner, after the UI critique); ?simple=0 still opens the old ones and is remembered.
// Run against any sample app (no login):
//   DB_NAME_TEST=<your>_test .venv/bin/python tests/ui/app_server.py --port 8290
//   node tests/ui/flow_simple_default.cjs [http://127.0.0.1:8290/]
process.env.SEOCC_REAL_DEFAULT = "1"; // this flow checks the app's own default, so pw.cjs mustn't pin a mode
const { open } = require("./pw.cjs");
const BASE = (process.argv[2] || "http://127.0.0.1:8290/").replace(/\/?$/, "/");
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };
const mode = (page) => page.evaluate(() => ({ attr: document.documentElement.dataset.simple, ui: window.UI.simple(), stored: localStorage.getItem("seocc2-simple") }));
(async () => {
  const { browser, page, problems } = await open();
  await page.goto(`${BASE}?flow=${Date.now()}#today`); await page.waitForSelector(".nav-item");
  let m = await mode(page);
  check(m.attr === "1" && m.ui === true && m.stored === null, `a first visit gets the simpler screens: ${JSON.stringify(m)}`);
  await page.goto(`${BASE}?flow=${Date.now()}&simple=0#today`); await page.waitForSelector(".nav-item");
  m = await mode(page);
  check(m.attr === "0" && m.ui === false, `?simple=0 brings the old screens back: ${JSON.stringify(m)}`);
  await page.goto(`${BASE}?flow=${Date.now()}#today`); await page.waitForSelector(".nav-item");
  m = await mode(page);
  check(m.attr === "0" && m.stored === "0", `and it is remembered: ${JSON.stringify(m)}`);
  await page.goto(`${BASE}?flow=${Date.now()}&simple=1#today`); await page.waitForSelector(".nav-item");
  m = await mode(page);
  check(m.attr === "1" && m.stored === "1", `?simple=1 switches back: ${JSON.stringify(m)}`);
  const errors = problems.filter((p) => !/api\/auth\/me|404/.test(p));
  check(!errors.length, `no page errors ${errors.join(" | ")}`);
  await browser.close();
  console.log(fails.length ? `FAILED ${fails.length}` : "all passed");
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
