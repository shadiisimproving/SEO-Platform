// Semscraper as the main tool for Google and its AI Overviews (owner, 2026-11-23), driven like a normal user. A fake Semscraper
// answers (tests/ui/fake_semscraper.py): made-up .example sites, nothing is spent, no real API is called.
//   DB_NAME_TEST=test_mzsemui_test .venv/bin/python tests/ui/app_server.py --port 8330 --semscraper &
//   DB_NAME_TEST=test_mzsemui_test .venv/bin/python tests/ui/seed_keywords_track_c.py
//   DB_NAME_TEST=test_mzsemui_test .venv/bin/python tests/ui/seed_semscraper.py 156
//   node tests/ui/flow_semscraper.cjs var/shots-semscraper http://127.0.0.1:8330/
// Checks: Settings shows Semscraper among the Refresh tools with no key field of its own and one paid switch; Check AI
// Overviews says SerpApi while Semscraper's paid use is off and offers the one click; then Semscraper with its € price for
// 156 keywords; Confirm fills the AI column; main tool = Semscraper makes a Refresh use it with its € price; when the fake
// Semscraper fails, SerpApi takes over; French words.
const fs = require("fs");
const path = require("path");
const { open, menu } = require("./pw.cjs");
const out = process.argv[2] || "/tmp";
const BASE = process.argv[3] || "http://127.0.0.1:8330/";
const FAIL_FILE = path.resolve(__dirname, "..", "..", "var", "fake-semscraper-fail");
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const settle = (page, ms = 500) => page.waitForTimeout(ms);
const waitRun = async (page, id) => { for (let i = 0; i < 120; i++) { const d = await api(page, "GET", `refresh/runs/${id}`); if (!["queued", "running"].includes(d.status)) return d; await page.waitForTimeout(1000); } return null; };
const waitNoRuns = async (page) => { for (let i = 0; i < 120; i++) { const d = await api(page, "GET", "refresh/runs"); if (!d.runs.length) return; await page.waitForTimeout(1000); } };
const words = async (loc) => (await loc.innerText()).replace(/\s+/g, " ");
const api = (page, method, url, body) => page.evaluate(async ([m, u, b]) => { const r = await fetch(`/api/${u}`, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return r.json(); }, [method, url, body]);

async function start({ width = 1440, height = 900, lang = "", hash = "keywords?site=site-one.example" } = {}) {
  const run = await open({ width, height });
  run.failed = [];
  run.page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/api/auth/me")) run.failed.push(`${r.status()} ${r.url()}`); });
  await run.page.goto(`${BASE}?flow=${Date.now()}&simple=1${lang ? `&lang=${lang}` : ""}#${hash}`);
  await run.page.waitForSelector(hash.startsWith("keywords") ? "#kw-table" : ".content", { timeout: 20000 }); await settle(run.page, 1500);
  return run;
}
const errorsOf = (run) => [...run.problems.filter((p) => !/Failed to load resource/.test(p)), ...run.failed];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  if (fs.existsSync(FAIL_FILE)) fs.unlinkSync(FAIL_FILE);
  const a = await start();
  const { page } = a;
  await api(page, "PUT", "tools/Semscraper/paid", { on: false });
  await api(page, "PATCH", "tools/settings", { main_tool: "" });

  // ---- 1. Settings: Semscraper is a Refresh tool, shares the Extras key, one paid switch ----------------------------------
  await page.goto(`${BASE}?flow=${Date.now()}&simple=1#settings`); await page.waitForSelector("#conn-semscraper-serp", { timeout: 15000 }); await settle(page, 800);
  const row = page.locator("#conn-semscraper-serp");
  check(/Semscraper/.test(await row.innerText()) && /Paid/.test(await row.innerText()), `Semscraper is listed under Refresh tools, marked paid (${(await row.innerText()).replace(/\s+/g, " ")})`);
  await row.locator("[data-conn]").click(); await page.waitForSelector("#panel #kwr-paid-on", { timeout: 8000 }); await settle(page, 400);
  const panel = await words(page.locator("#panel"));
  check(!(await page.locator("#panel #conn-key").count()) && /Extras → Semscraper/.test(panel), "no key field of its own: it points to the Extras key");
  check(/€0\.30 per 1,000/.test(panel) && !(await page.locator("#panel #kwr-paid-on").isChecked()), "its price shows and paid use starts off");
  await page.screenshot({ path: `${out}/s01-settings-semscraper-panel.png` });
  await page.click("#panel #conn-test"); await settle(page, 1200);
  check(/Works/.test(await page.locator("#conn-test-result").innerText()) && /€12\.50/.test(await page.locator("#conn-test-result").innerText()), `Test reads the balance for free (${await page.locator("#conn-test-result").innerText()})`);
  await page.keyboard.press("Escape"); await settle(page, 600);

  // ---- 2. Check AI Overviews with paid use off: SerpApi, and the one click --------------------------------------------------
  await page.goto(`${BASE}?flow=${Date.now()}&simple=1#keywords?site=site-one.example`); await page.waitForSelector("#kw-table", { timeout: 20000 }); await settle(page, 1500);
  const aio = page.locator("#kw-aio-all");
  const unchecked = Number((await aio.locator(".tt-count").innerText()).replace(/\D/g, ""));
  check(unchecked === 156, `156 keywords have no AI Overview check (${unchecked})`);
  await aio.click(); await page.waitForSelector("#dlg[open] #kwr-cost", { timeout: 10000 }); await settle(page, 600);
  let dlg = await words(page.locator("#dlg"));
  check(/156 keywords have no AI Overview check yet/.test(dlg) && /SerpApi checks/.test(dlg) && /Semscraper's paid use is off/.test(dlg), "paid use off: it says SerpApi will check them, and why not Semscraper");
  await page.screenshot({ path: `${out}/s02-aio-semscraper-off.png` });
  await page.click("#kwr-aio-paid-on"); await page.waitForFunction(() => /Semscraper checks/.test((document.querySelector("#dlg")?.innerText || "").replace(/\s+/g, " ")), null, { timeout: 8000 }); await settle(page, 400);
  dlg = await words(page.locator("#dlg"));
  const price = (dlg.match(/about €[\d.,]+|less than €[\d.,]+/) || [""])[0];
  check(/Semscraper checks 156 keywords: about €0\.05/.test(dlg), `one click: Semscraper, 156 keywords, ${price}`);
  check(/About 1,000 of the first 1,000 free Semscraper searches left/.test(dlg) && /If Semscraper fails, SerpApi takes over/.test(dlg), "it says the free searches left and the fallback");
  const button = await words(page.locator("#kwr-confirm"));
  check(/Check with Semscraper · 156 searches · about €0\.05/.test(button) && !(await page.locator("#kwr-confirm").isDisabled()), `the button names the tool, the count and the price (${button})`);
  console.log("ESTIMATE SHOWN:", price, "|", button);
  await page.screenshot({ path: `${out}/s03-aio-semscraper-price.png` });
  await page.locator("#dlg [data-close-dlg]").first().click(); await settle(page, 500);

  // Run it on a few only (the whole 156 takes a while on the fake): the same dialog, through the selection's own path.
  const few = await page.evaluate(async () => {
    const r = await fetch("/api/rankings"); const d = await r.json();
    return d.rows.filter((x) => x.site === "site-one.example" && x.ai?.state === "not-captured" && !/^espresso tip/.test(x.keyword)).map((x) => x.keyword_id).slice(0, 6);
  });
  const started = await api(page, "POST", "refresh/runs", { keyword_ids: few, engines: ["google"], depth: 10, mode: "ai", picked: [], allow_paid: true, paid_cap: 0.01, include_recent: true, token: `flow-aio-${Date.now()}` });
  check(Boolean(started.id), `the AI Overviews run starts (${started.id})`);
  const done = await waitRun(page, started.id);
  check(done.status === "done" && done.done === few.length, `all ${few.length} checked (${done.status}, ${done.done})`);
  await page.reload(); await page.waitForSelector("#kw-table", { timeout: 20000 }); await settle(page, 1500);
  const listed = await api(page, "GET", "rankings");
  const tools = listed.rows.filter((x) => few.includes(x.keyword_id) && x.site === "site-one.example").map((x) => x.ai?.tool || x.engines?.google?.main?.tool);
  const checked = listed.rows.filter((x) => few.includes(x.keyword_id) && x.site === "site-one.example");
  // "cafe decaffeine": the fake shows an overview Google hadn't finished writing, so it stays Not checked, never a "no"
  check(checked.length === few.length && checked.every((x) => x.engines.google.main?.tool === "Semscraper") && checked.every((x) => x.ai?.state !== "not-captured" || x.keyword === "cafe decaffeine"), `each of them was checked by Semscraper and read (${checked.map((x) => `${x.keyword}: ${x.ai?.state}`).join(", ")})`);
  const aiCells = await page.locator('#kw-table td[data-label="AI"]').allInnerTexts();
  check(aiCells.some((c) => /AIO/.test(c)), "the AI column reads AIO where Semscraper saw an overview");
  await page.screenshot({ path: `${out}/s04-after-semscraper-aio.png` });

  // ---- 3. Main tool = Semscraper, then a Refresh uses it, with its € price ----------------------------------------------------
  await page.goto(`${BASE}?flow=${Date.now()}&simple=1#settings`); await page.waitForSelector("#kwr-main-tool", { timeout: 15000 }); await settle(page, 800);
  await page.selectOption("#kwr-main-tool", "Semscraper"); await settle(page, 1500);
  check(await page.locator("#kwr-main-tool").inputValue() === "Semscraper" && (await page.locator("#conn-semscraper-serp").evaluate((li) => [...li.parentElement.children].indexOf(li))) === 0, "Semscraper is the main tool and first in Google's order");
  await page.screenshot({ path: `${out}/s05-settings-main-tool.png` });
  await page.goto(`${BASE}?flow=${Date.now()}&simple=1#keywords?site=site-one.example`); await page.waitForSelector("#kw-table", { timeout: 20000 }); await settle(page, 1500);
  await page.fill('[data-tp-search][data-tp-key="kw"]', "espresso tip 77"); await settle(page, 800); // one never checked, so nothing is left out as recent
  const firstBox = page.locator("#kw-table tbody [data-kwr-select]").first();
  await firstBox.check(); await settle(page, 300);
  await page.screenshot({ path: `${out}/s05b-selected.png` });
  await page.click("#kwr-sel-refresh"); await page.waitForSelector("#dlg[open] #kwr-cost", { timeout: 10000 }); await settle(page, 800);
  dlg = await words(page.locator("#dlg"));
  check(await page.locator("#kwr-paid").isChecked() && /paid Semscraper search/.test(dlg) && /€/.test(await page.locator("#kwr-confirm").innerText()), `the Refresh dialog uses Semscraper first, paid use ticked, its € price on the button (${await page.locator("#kwr-confirm").innerText()})`);
  await page.screenshot({ path: `${out}/s06-refresh-semscraper-price.png` });
  await page.click("#kwr-confirm"); await settle(page, 1000);
  const firstId = await firstBox.getAttribute("data-kwr-select");
  await waitNoRuns(page);
  await settle(page, 2000);
  const rowsNow = await api(page, "GET", "rankings");
  const mine = rowsNow.rows.find((x) => String(x.id) === String(firstId));
  check(mine?.engines?.google?.main?.tool === "Semscraper", `the row's ranking is now Semscraper's (${mine?.engines?.google?.main?.tool})`);
  await page.screenshot({ path: `${out}/s07-after-refresh.png` });

  // ---- 4. Semscraper fails: SerpApi takes over --------------------------------------------------------------------------------
  fs.mkdirSync(path.dirname(FAIL_FILE), { recursive: true }); fs.writeFileSync(FAIL_FILE, "fail");
  const other = rowsNow.rows.find((x) => x.site === "site-one.example" && String(x.id) !== String(firstId) && /^espresso tip/.test(x.keyword));
  const run2 = await api(page, "POST", "refresh/runs", { keyword_ids: [other.keyword_id], engines: ["google"], depth: 10, mode: "auto", picked: [], allow_paid: true, paid_cap: 1, include_recent: true, token: `flow-fail-${Date.now()}` });
  await waitRun(page, run2.id);
  const after = await api(page, "GET", "rankings");
  const fell = after.rows.find((x) => x.keyword_id === other.keyword_id);
  check(fell?.engines?.google?.main?.tool === "SerpApi", `with Semscraper failing, SerpApi did the check (${fell?.engines?.google?.main?.tool})`);
  fs.unlinkSync(FAIL_FILE);
  await page.reload(); await page.waitForSelector("#kw-table", { timeout: 20000 }); await settle(page, 1500);
  await page.screenshot({ path: `${out}/s08-fallback-serpapi.png` });
  check(errorsOf(a).length === 0, `no errors on the page (${errorsOf(a).join(" | ")})`);
  await a.browser.close();

  // ---- 5. French ---------------------------------------------------------------------------------------------------------------
  const fr = await start({ lang: "fr" });
  await fr.page.click("#kw-aio-all"); await fr.page.waitForSelector("#dlg[open] #kwr-cost", { timeout: 10000 }); await settle(fr.page, 800);
  const frDlg = await words(fr.page.locator("#dlg"));
  check(/Semscraper vérifie/.test(frDlg) && /environ/.test(frDlg) && /SerpApi prend le relais/.test(frDlg), `the dialog in French (${frDlg.replace(/\s+/g, " ").slice(0, 200)})`);
  await fr.page.screenshot({ path: `${out}/s09-aio-french.png` });
  await fr.page.locator("#dlg [data-close-dlg]").first().click();
  await fr.page.goto(`${BASE}?flow=${Date.now()}&simple=1&lang=fr#settings`); await fr.page.waitForSelector("#conn-semscraper-serp", { timeout: 15000 }); await settle(fr.page, 800);
  await fr.page.locator("#conn-semscraper-serp [data-conn]").click(); await fr.page.waitForSelector("#panel #kwr-paid-on", { timeout: 8000 }); await settle(fr.page, 400);
  check(/Utilise la clé enregistrée dans Extras/.test(await fr.page.locator("#panel").innerText()), "the Settings panel in French");
  await fr.page.screenshot({ path: `${out}/s10-settings-french.png` });
  check(errorsOf(fr).length === 0, `no errors in French (${errorsOf(fr).join(" | ")})`);
  await fr.browser.close();

  // ---- 6. a phone ----------------------------------------------------------------------------------------------------------------
  const phone = await start({ width: 390, height: 844 });
  if (await phone.page.locator("#kw-aio-all").count()) {
    await phone.page.click("#kw-aio-all"); await phone.page.waitForSelector("#dlg[open] #kwr-cost", { timeout: 10000 }); await settle(phone.page, 600);
    check(!(await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), "no sideways scroll on a phone");
    await phone.page.screenshot({ path: `${out}/s11-aio-phone.png` });
  }
  await phone.browser.close();

  console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})().catch((err) => { console.error(err); if (fs.existsSync(FAIL_FILE)) fs.unlinkSync(FAIL_FILE); process.exit(1); });
