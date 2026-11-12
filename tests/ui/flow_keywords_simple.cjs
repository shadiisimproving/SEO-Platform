// Keywords on the simpler screens (?simple=1, track T5, 2026-11-12), driven by hand like a normal user, with screenshots:
// the head's one line, engine tabs above the cards, one row of search, chips, Filter and ⋯, rows that open their panel (click,
// Enter, ↑ ↓), the tools said once under the table, Keyword ideas at the top of Add keywords, and KW.recheck from another
// screen (switch on and off). With the switch off, Keywords keeps its old layout. Google's suggestions are answered here.
// Needs a fresh demo world (no login):
//   DB_NAME_TEST=test_t5_p2_ideas_test .venv/bin/python tests/ui/app_server.py --port 8445
//   node tests/ui/flow_keywords_simple.cjs <folder for screenshots> http://127.0.0.1:8445/
const { open } = require("./pw.cjs");
const out = process.argv[2] || "/tmp";
const BASE = process.argv[3] || "http://127.0.0.1:8445/";
const note = (...a) => console.log(...a);
const fails = [];
const check = (ok, what) => { note(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const settle = (page, ms = 500) => page.waitForTimeout(ms);
const IDEAS = ["abonnement", "Abonnement Café", "abonnement netflix", "abonnement free", "abonnement canal+"];
// The same counting as tests/ui/measure_screens.cjs: controls a person sees at rest.
const seen = () => {
  const main = document.querySelector("#main");
  const shown = (el) => { const r = el.getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) return false;
    let o = 1; for (let n = el; n && n !== document.body; n = n.parentElement) { const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden") return false; o *= Number(s.opacity); } return o > 0.05; };
  return [...main.querySelectorAll("button,select,input,textarea,a[href],summary,[role=button],[role=tab]")].filter(shown).length;
};
const opacity = (page, sel) => page.locator(sel).evaluate((el) => Number(getComputedStyle(el.closest(".kw-more-items") || el).opacity));
const inView = (page, sel) => page.locator(sel).evaluate((el) => el.offsetParent !== null);
const top = (page, sel) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().top);
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => "");
const has = async (page, sel) => (await page.locator(sel).count()) > 0;

async function start(simple, { width = 1440, height = 900, hash = "keywords?site=site-one.example" } = {}) {
  const run = await open({ width, height });
  run.failed = [];
  // The harness has no login (auth/me 404s); anything else that fails counts.
  run.page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/api/auth/me")) run.failed.push(`${r.status()} ${r.url()}`); });
  run.asked = [];
  await run.page.route("**/api/keyword-ideas*", (route) => { run.asked.push(Object.fromEntries(new URL(route.request().url()).searchParams)); route.fulfill({ json: { ideas: IDEAS } }); });
  await run.page.goto(`${BASE}?flow=${Date.now()}&simple=${simple}#${hash}`);
  return run;
}
const errorsOf = (run) => [...run.problems.filter((p) => !/Failed to load resource/.test(p)), ...run.failed];

(async () => {
  // ---- the screen at rest ---------------------------------------------------------------------------------------------
  const a = await start("1");
  const { page } = a;
  await page.waitForSelector("#kw-table", { timeout: 20000 }); await settle(page, 1500);
  check(await page.evaluate(() => window.UI.simple() === true && document.documentElement.dataset.simple === "1"), "the switch is on");
  await page.mouse.move(5, 5); await settle(page, 300);
  await page.screenshot({ path: `${out}/s01-keywords.png` });
  const line = (await text(page, "#topbar .head-line")).replace(/\s+/g, " ");
  check(/through/.test(line) && /(Last check|Refreshed)/.test(line) && / with/.test(line), `the head says how fresh, in one line (${line})`);
  check(!(await has(page, "#period")) && await has(page, "#topbar .head-line .def-i"), "no period, and the screen's sentence is behind the (i)");
  check(await top(page, ".kw-tabs-row") < await top(page, "#kw-tiles"), "the engine tabs sit above the cards, since the cards follow the engine");
  check(await page.locator("#kw-tiles .ncard").count() === 4, "four number cards");
  check(await page.locator(".kw-tabs-row [data-view]").count() === 3, "Positions, By bucket and Queries at the end of the tabs' row");
  check(!(await has(page, "#kw-table button.kw")) && await page.locator("#kw-table [data-kwr-open]").count() >= 8, "the keyword is text, not a button, and still names its row");
  check(!(await has(page, "#kw-table [data-kwr-deeper]")), "no Check deeper in the rows (it's in the panel)");
  const heads = () => page.locator("#kw-table thead th").allInnerTexts().then((x) => x.join("|"));
  check(!(await heads()).includes("Trend"), "Trend isn't a default column");
  const src = await text(page, "#kw-src");
  check(/Scraped results:/.test(src), `the tools and ages are said once under the table (${src.trim()})`);
  check(await has(page, ".kw-bar .tt-filter"), "Filter sits in the chips' row");
  check(await opacity(page, "#density") < 0.05 && await opacity(page, "#columns") < 0.05, "Compact rows and Columns are out of sight at rest");
  const controls = await page.evaluate(seen);
  check(controls <= 39, `about 39 controls at rest (${controls})`);
  check(!(await has(page, "[data-lv-ideas]")), "Keyword ideas left the screen (it's in Add keywords)");

  // ---- ⋯, Columns and Compact rows -----------------------------------------------------------------------------------------
  await page.hover("#kw-more"); await settle(page, 300);
  check(await opacity(page, "#density") > 0.9, "the pointer on ⋯ shows Compact rows and Columns");
  await page.screenshot({ path: `${out}/s02-more.png`, clip: { x: 700, y: 0, width: 740, height: 420 } });
  await page.click("#columns"); await settle(page, 300);
  await page.check('#popover [data-col="trend"]'); await settle(page, 400);
  check((await heads()).includes("Trend"), "Columns turns Trend on");
  await page.uncheck('#popover [data-col="trend"]'); await page.keyboard.press("Escape"); await settle(page, 300);
  await page.click("#density"); await settle(page, 300);
  check(await has(page, ".table-wrap.dense #kw-table"), "Compact rows still works from the ⋯");
  await page.click("#density"); await settle(page, 300);
  await page.mouse.move(5, 5); await page.click("#kw-more"); await page.mouse.move(5, 5); await settle(page, 300);
  check(await page.getAttribute("#kw-more", "aria-expanded") === "true" && await opacity(page, "#density") > 0.9, "pressing ⋯ keeps them shown, for touch and keyboard");
  await page.click("#kw-more"); await settle(page, 200);

  // ---- a row opens its panel ---------------------------------------------------------------------------------------------
  await page.click("#kw-table tbody tr:nth-child(1) td:nth-child(5)"); // the Change cell: no link, no button
  await page.waitForSelector("#tool-table", { timeout: 10000 }); await settle(page, 600);
  check(await page.locator("#panel").evaluate((p) => p.classList.contains("wide") && Math.round(p.getBoundingClientRect().width) === 760), "a click anywhere on the row opens its panel, 760 px wide");
  check(await page.locator("#kw-table tbody tr:nth-child(1)").evaluate((r) => r.classList.contains("open")), "the row stays highlighted");
  await page.screenshot({ path: `${out}/s03-panel.png` });
  const firstName = (await text(page, "#panel .panel-head h2")).trim();
  await page.keyboard.press("ArrowDown"); await settle(page, 300); await page.waitForSelector("#tool-table", { timeout: 10000 }); await settle(page, 500);
  const secondName = (await text(page, "#panel .panel-head h2")).trim();
  check(secondName && secondName !== firstName, `↓ opens the next row (${firstName} → ${secondName})`);
  await page.keyboard.press("ArrowUp"); await settle(page, 300); await page.waitForSelector("#tool-table", { timeout: 10000 }); await settle(page, 500);
  check((await text(page, "#panel .panel-head h2")).trim() === firstName, "↑ goes back");
  await page.keyboard.press("Escape"); await settle(page, 500);
  check(!(await has(page, "#panel")) && await page.evaluate(() => Boolean(document.activeElement?.matches?.("#kw-table tbody tr[data-kwr-row]"))), "Escape closes it, and the keyboard is back on the row");
  await page.keyboard.press("Enter"); await page.waitForSelector("#tool-table", { timeout: 10000 }).catch(() => {}); await settle(page, 400);
  check(await has(page, "#panel"), "Enter on a focused row opens it");
  await page.keyboard.press("Escape"); await settle(page, 400);
  await page.locator("#kw-table tbody tr:nth-child(1) .chk-cell input").click(); await settle(page, 300);
  check(!(await has(page, "#panel")) && await has(page, "#kwr-selbar"), "the tick box picks the row, without opening it");
  await page.click("#kwr-sel-clear"); await settle(page, 200);

  // ---- Keyword ideas at the top of Add keywords --------------------------------------------------------------------------
  await page.click("#kwr-add"); await page.waitForSelector("#kwr-ideas-slot [data-lv-ideas]", { timeout: 8000 }); await settle(page, 500);
  check(await top(page, "#kwr-ideas-slot") < await top(page, "#kwr-add-form"), "Keyword ideas shows at the top of Add keywords");
  check(await page.inputValue("#kwr-ideas-slot [name=f_country]") === "FR", "its country starts on the one the site's keywords use most");
  await page.fill("#kwr-ideas-slot [name=f_q]", "abonnement");
  await page.selectOption("#kwr-ideas-slot [name=f_language]", "fr");
  await page.click("#kwr-ideas-slot button[type=submit]");
  await page.waitForSelector("#kwr-ideas-slot .lv-ideas-bar", { timeout: 8000 }).catch(() => {}); await settle(page, 400);
  check(a.asked.at(-1)?.q === "abonnement" && a.asked.at(-1)?.country === "FR" && a.asked.at(-1)?.language === "fr", "the search sends the words, country and language");
  check(await has(page, "#panel #kwr-add-form") && await has(page, "#kwr-ideas-slot .lv-ideas-bar"), "the panel stays open, with the results in it");
  const ideaRow = (word) => page.locator("#kwr-ideas-slot .rows li", { has: page.locator(".t", { hasText: new RegExp(`^${word.replace("+", "\\+")}$`) }) }).first();
  check(/Already tracked/.test(await ideaRow("Abonnement Café").innerText()), "an idea already tracked says so");
  await page.screenshot({ path: `${out}/s04-add-ideas.png` });
  await ideaRow("abonnement netflix").getByRole("button").click(); await settle(page, 300);
  check(await page.inputValue("#kwr-add-text") === "abonnement netflix", "Add puts the idea in the list below");
  check(await page.inputValue("#kwr-add-country") === "FR" && await page.inputValue("#kwr-add-language") === "fr", "with the ideas' country and language");
  check(/these ideas/.test(await text(page, "#kwr-add-form")), "and says where they come from");
  check(/In the list/.test(await ideaRow("abonnement netflix").innerText()), "the pressed Add says it's in the list");
  await page.click("#kwr-ideas-slot [data-lv-idea-all]"); await settle(page, 300);
  check(await page.inputValue("#kwr-add-text") === "abonnement netflix\nabonnement\nabonnement free\nabonnement canal+", "Add all adds each idea not tracked and not in the list yet, once");
  await page.keyboard.press("Escape"); await settle(page, 400);
  check(/Draft kept|Reopen/.test(await text(page, "#toasts")), "Escape keeps the list as a draft");
  await page.click("#kwr-add"); await page.waitForSelector("#kwr-add-form"); await settle(page, 400);
  check((await page.inputValue("#kwr-add-text")).includes("abonnement canal+"), "and it comes back");
  await page.click("#kwr-add-save"); await settle(page, 2500);
  check(!(await has(page, "#panel")), "Add keywords saves and closes");
  check(await page.evaluate(async () => (await (await fetch("api/rankings")).json()).rows.some((r) => r.keyword === "abonnement netflix")), "the ideas are now tracked");

  // ---- French and dark ------------------------------------------------------------------------------------------------------
  await page.evaluate(() => { window.UI.state.lang = "fr"; window.UI.state.theme = "dark"; window.UI.render(); }); await settle(page, 800);
  const lineFr = await text(page, "#topbar .head-line");
  check(/jusqu'au/.test(lineFr) && / avec/.test(lineFr), `the head's line reads in French (${lineFr.replace(/\s+/g, " ")})`);
  check(/Résultats relevés/.test(await text(page, "#kw-src")), "so does the line under the table");
  await page.screenshot({ path: `${out}/s05-fr-dark.png` });
  await page.click("#kwr-add"); await page.waitForSelector("#kwr-ideas-slot [data-lv-ideas]"); await settle(page, 400);
  check(/Idées de mots-clés/.test(await text(page, "#kwr-ideas-slot")), "Keyword ideas reads in French in the panel");
  await page.screenshot({ path: `${out}/s06-fr-dark-add.png` });
  await page.click("[data-discard-panel]"); await settle(page, 300);
  await page.evaluate(() => { window.UI.state.lang = "en"; window.UI.state.theme = "light"; window.UI.render(); }); await settle(page, 300);

  // ---- KW.recheck from another screen, before Keywords was ever opened -----------------------------------------------------
  for (const simple of ["1", "0"]) {
    const word = `switch ${simple === "1" ? "on" : "off"}:`;
    const b = await start(simple, { hash: "competitors" });
    await b.page.waitForSelector(".nav-item"); await settle(b.page, 2500);
    const ids = await b.page.evaluate(async () => (await (await fetch("api/rankings")).json()).rows.slice(0, 2).map((r) => r.keyword_id));
    const opened = await b.page.evaluate(async (list) => { const opener = document.querySelector('button[data-go="competitors"]'); opener.focus(); return window.KW.recheck(list, { engine: "google", opener }); }, ids);
    await b.page.waitForSelector("#kwr-summary p", { timeout: 10000 }).catch(() => {}); await settle(b.page, 500);
    const dlg = await text(b.page, "#dlg");
    check(opened === true && await b.page.locator("#dlg").evaluate((d) => d.open) && /Refresh keywords/.test(dlg) && /\b2\b/.test(dlg), `${word} KW.recheck opens the Refresh dialog for 2 keywords from Competitors`);
    check(await b.page.evaluate(() => window.UI.state.route === "competitors"), `${word} without leaving the screen`);
    check((await text(b.page, "#kwr-summary")).trim().length > 0 && await has(b.page, "#kwr-confirm"), `${word} with its preview and Confirm (${(await text(b.page, "#kwr-summary")).replace(/\s+/g, " ").slice(0, 90)})`);
    if (simple === "1") await b.page.screenshot({ path: `${out}/s07-recheck-from-competitors.png` });
    await b.page.keyboard.press("Escape"); await settle(b.page, 300);
    check(!(await b.page.locator("#dlg").evaluate((d) => d.open)) && await b.page.evaluate(() => document.activeElement?.dataset?.go === "competitors"), `${word} Escape closes it, focus back on the opener`);
    check(await b.page.evaluate(() => window.KW.recheck([])) === false, `${word} nothing to check opens nothing`);
    const real = errorsOf(b);
    check(!real.length, `${word} no console errors on Competitors ${real.slice(0, 3).join(" | ")}`);
    await b.browser.close();
  }

  // ---- phone ------------------------------------------------------------------------------------------------------------------
  const c = await start("1", { width: 390, height: 844 });
  await c.page.waitForSelector("#kw-table", { timeout: 20000 }); await settle(c.page, 1200);
  check(await c.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, "no sideways scroll at 390 px");
  check(await inView(c.page, "#kwr-add-small"), "Add keywords can be reached at phone width");
  check(!(await inView(c.page, "#density")), "on a phone the ⋯'s tools take no room until it's pressed");
  await c.page.click("#kw-more"); await settle(c.page, 300);
  check(await inView(c.page, "#density"), "and show once it is");
  await c.page.screenshot({ path: `${out}/s08-phone.png`, fullPage: true });
  check(!errorsOf(c).length, "no console errors at phone width");
  await c.browser.close();

  // ---- the switch off: Keywords as before ---------------------------------------------------------------------------------------
  const d = await start("0");
  await d.page.waitForSelector("#kw-table", { timeout: 20000 }); await settle(d.page, 1200);
  check(await has(d.page, "#kw-table button.kw[data-kwr-open]") && !(await has(d.page, ".kw-simple")) && !(await has(d.page, "#kw-src")), "switch off: the old table, keyword buttons and all");
  check(await has(d.page, "[data-lv-ideas]") && await has(d.page, ".tabs-row .tabs") && !(await has(d.page, "#kw-more")), "switch off: Keyword ideas on the screen, the old tabs, no ⋯");
  await d.page.click("#kwr-add"); await d.page.waitForSelector("#kwr-add-form"); await settle(d.page, 300);
  check(!(await has(d.page, "#kwr-ideas-slot")) && await has(d.page, "form.panel-body#kwr-add-form"), "switch off: Add keywords as before");
  await d.page.screenshot({ path: `${out}/s09-switch-off.png` });
  check(!errorsOf(d).length, "switch off: no console errors");
  await d.browser.close();

  const real = errorsOf(a);
  note("problems:", JSON.stringify(real.slice(0, 12)));
  check(!real.length, "no console errors");
  await a.browser.close();
  note(fails.length ? `FAILED ${fails.length}` : "ALL OK");
  process.exit(fails.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
