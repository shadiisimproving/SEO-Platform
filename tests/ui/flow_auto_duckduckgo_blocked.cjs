// DuckDuckGo blocks the hosting server, as it did live on 2026-11-11: DuckDuckGo direct meets a bot check, and the next
// Refresh data goes to Bright Data's free credits instead, never to SerpApi. Made-up sites only.
// Needs a demo world where DuckDuckGo answers DuckDuckGo direct with its bot check and Bright Data reads its HTML page:
//   DDG_BLOCKED=1 DB_NAME_TEST=test_autoddg_test .venv/bin/python <wrapper adding the DuckDuckGo tools to tests/ui/app_server.py> --port 8273
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8273/";
const OUT = path.resolve("var/ui-auto-duckduckgo-blocked") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const failed = [];
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/api/auth/me")) failed.push(`${r.status()} ${r.url()}`); });
  const call = async (method, p, body) => (await page.request.fetch(BASE + "api/" + p, { method, data: body })).json();
  const settle = () => page.waitForTimeout(1200);
  const until = async (test, ms = 90000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return true; await page.waitForTimeout(700); } return false; };
  const textOf = async (sel) => { const el = await page.$(sel); return el ? (await el.textContent()) || "" : ""; };
  const ddg = async () => ((await call("GET", "rankings")).rows || []).map((r) => r.engines?.duckduckgo?.main).filter((m) => m && m.status === "ok");
  const idle = async () => !((await call("GET", "refresh/runs")).runs || []).length;
  const pressRefreshData = async () => {
    await page.goto("about:blank"); await page.goto(BASE + "#content"); await settle();
    const button = await page.$("[data-lv-collect]:not([data-lv-collect-sources])");
    if (button) await button.click();
    return Boolean(button);
  };

  await page.goto(BASE + "#keywords"); await settle();
  check("no DuckDuckGo positions before", (await ddg()).length === 0);

  // First press: DuckDuckGo direct gets its one try, and meets the bot check.
  check("Refresh data is there", await pressRefreshData());
  await until(async () => /DuckDuckGo positions are being checked too/.test(await textOf("body")), 15000);
  await until(idle);
  check("DuckDuckGo direct stopped on the bot check, nothing saved", (await ddg()).length === 0);

  // Second press: DuckDuckGo direct rests, and Bright Data reads DuckDuckGo instead.
  await pressRefreshData();
  const said = await until(async () => /DuckDuckGo positions are being checked too/.test(await textOf("body")), 15000);
  check("Refresh data says DuckDuckGo positions are being checked", said);
  await page.screenshot({ path: OUT + "1-refresh-data-again.png" });
  const filled = await until(async () => (await ddg()).length > 0 && (await idle()));
  const rows = await ddg();
  check("DuckDuckGo positions arrive", filled && rows.length > 0, rows.length);
  check("they come from Bright Data, never SerpApi", rows.every((m) => m.tool === "Bright Data"), JSON.stringify([...new Set(rows.map((m) => m.tool))]));
  check("my site at #4, as on the fake DuckDuckGo page", rows.some((m) => m.p === 4) && rows.every((m) => m.p === 4 || !m.p));

  await page.goto("about:blank"); await page.goto(BASE + "#keywords"); await settle();
  await page.click('[data-engine="duckduckgo"]'); await settle();
  await page.screenshot({ path: OUT + "2-keywords-duckduckgo-from-bright-data.png" });

  const real = problems.filter((p) => !(failed.length === 0 && /Failed to load resource: .*404/.test(p)));  // /api/auth/me: no login in the harness
  check("no page errors", real.length === 0, real.join(" | "));
  check("no failed requests", failed.length === 0, failed.slice(0, 5).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASS");
  process.exit(bad ? 1 : 0);
})();
