// DuckDuckGo positions come by themselves now (owner, 2026-11-11): Refresh data starts a free DuckDuckGo check, the
// Keywords tray follows it as "Automatic DuckDuckGo check", and the DuckDuckGo note says so. Made-up sites only.
// Needs a demo world whose DuckDuckGo direct reads a fake DuckDuckGo page (app_server.py has no DuckDuckGo tool of its own):
//   DB_NAME_TEST=test_autoddg_test .venv/bin/python tests/ui/ddg_app_server.py --port 8273
const { open, menu } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8273/";
const OUT = path.resolve("var/ui-auto-duckduckgo") + "/";
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
  const ddgPositions = async () => ((await call("GET", "rankings")).rows || []).map((r) => r.engines?.duckduckgo?.main).filter((m) => m && m.status === "ok");
  const textOf = async (sel) => { const el = await page.$(sel); return el ? (await el.textContent()) || "" : ""; };
  // Since 2026-11-11 the note is a few words, and the whole sentence is its (i) tip (UI.tip: a .def-i with data-tip).
  const tipOf = async (sel) => { const el = await page.$(`${sel} .def-i[data-tip]`); return el ? (await el.getAttribute("data-tip")) || "" : ""; };

  await page.goto(BASE + "#keywords"); await settle();
  const before = await ddgPositions();
  check("no DuckDuckGo positions before", before.length === 0, before.length);
  // Nothing checked on DuckDuckGo yet: it has no tab and isn't named on Keywords (owner, 2026-11-24). The tab comes with the first check.
  check("no DuckDuckGo tab before its first check", (await page.locator('[data-engine="duckduckgo"]').count()) === 0);

  // Refresh data starts the free DuckDuckGo check, and says so. The first screen of the demo that shows the button.
  let button = null, where = "";
  for (const route of ["channels", "content", "today", "overview"]) {
    await page.goto("about:blank"); await page.goto(BASE + "#" + route); await settle();
    button = (await page.$("[data-lv-collect]:not([data-lv-collect-sources])")) || (await page.$("[data-ov-refresh]"));
    if (button) { where = route; break; }
  }
  check("a Refresh data button is there", Boolean(button), where);
  if (button) await button.click();
  const said = await until(async () => /DuckDuckGo positions are being checked too/.test(await textOf("body")), 15000);
  check("Refresh data says DuckDuckGo positions are being checked too", said);
  await page.screenshot({ path: OUT + "2-refresh-data-toast.png" });

  const runs = (await call("GET", "refresh/runs")).runs || [];
  check("an automatic DuckDuckGo run is going", runs.some((r) => r.by === "Automatic" && r.engines.join() === "duckduckgo"), JSON.stringify(runs.map((r) => [r.by, r.engines, r.status])));

  // The Keywords tray follows it and names it.
  await page.goto("about:blank"); await page.goto(BASE + "#keywords"); await settle();
  const tray = await until(async () => /Automatic DuckDuckGo check/.test(await textOf("#tray-root")), 10000);
  check("the tray names it Automatic DuckDuckGo check", tray, await textOf("#tray-root"));
  await page.screenshot({ path: OUT + "3-keywords-tray.png" });
  const refreshButton = await page.$("#kwr-refresh");
  check("the Refresh button stays usable while it runs", Boolean(refreshButton) && !(await refreshButton.isDisabled()));

  const filled = await until(async () => (await ddgPositions()).length > 0 && !((await call("GET", "refresh/runs")).runs || []).length);
  const after = await ddgPositions();
  check("DuckDuckGo positions arrive", filled && after.length > 0, after.length);
  // The fake DuckDuckGo page lists site-one.example at #4 and no other site of mine, so theirs read "not in the top 10".
  check("my site is at #4, as on the fake DuckDuckGo page", after.some((m) => m.p === 4) && after.every((m) => m.p === 4 || !m.p) && after.every((m) => m.tool === "DuckDuckGo direct"), JSON.stringify(after.slice(0, 2)));

  // Pressing Refresh data again right away searches nothing new: those keywords were just checked.
  const site = ((await call("GET", "links/sites")).sites || [])[0];
  const again = await call("POST", `sites/${site.id}/collect`, {});
  check("a second Refresh data right after starts no new DuckDuckGo check", again.rankings === false, JSON.stringify(again.rankings));

  await page.goto("about:blank"); await page.goto(BASE + "#keywords"); await settle();
  check("the DuckDuckGo tab is there once it has positions", (await page.locator('[data-engine="duckduckgo"]').count()) === 1);
  await page.click('[data-engine="duckduckgo"]'); await settle();
  const note = await textOf(".content .note"), noteTip = await tipOf(".content .note");
  check("the DuckDuckGo note says it's checked every day, on free searches only", /Checked daily by itself, on free searches/.test(note) && /checks its positions by itself every day, oldest first, on free searches only/.test(noteTip), `${note.trim()} | tip: ${noteTip}`);
  await page.screenshot({ path: OUT + "1-keywords-duckduckgo-note.png" });
  await page.screenshot({ path: OUT + "4-keywords-duckduckgo-filled.png" });

  // French.
  await menu(page, "lang"); await settle();
  await page.click('[data-engine="duckduckgo"]').catch(() => {}); await settle();
  const fr = await textOf(".content .note"), frTip = await tipOf(".content .note");
  check("the note is in French too", /Relevé chaque jour automatiquement/.test(fr) && /vérifie ses positions toute seule chaque jour/.test(frTip), `${fr.trim()} | tip: ${frTip}`);
  await page.screenshot({ path: OUT + "5-keywords-duckduckgo-fr.png" });
  await menu(page, "lang"); await settle();

  // The harness runs without login, so /api/auth/me answers 404 by design: its console line is the only one allowed.
  const real = problems.filter((p) => !(failed.length === 0 && /Failed to load resource: .*404/.test(p)));
  check("no page errors", real.length === 0, real.join(" | "));
  check("no failed requests", failed.length === 0, failed.slice(0, 5).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASS");
  process.exit(bad ? 1 : 0);
})();
