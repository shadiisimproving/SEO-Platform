// The Keywords by ranking card on Today, Keywords and Overview, the way a person uses it, with screenshots to look at.
// Needs the real app on the fake internet, on a database of your own:
//   DB_NAME_TEST=test_ranktrends_ui_test .venv/bin/python tests/ui/app_server.py --port 8296 --slow 0
// Run: SEOCC_REAL_DEFAULT=1 node tests/ui/flow_rank_trends.cjs <screenshots folder> http://127.0.0.1:8296/
const { open, menu } = require("./pw.cjs");
const out = process.argv[2] || "reports/rank-trends-2026-11-20";
const BASE = process.argv[3] || "http://127.0.0.1:8296/";
require("fs").mkdirSync(out, { recursive: true });
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const CARD = "[data-rank-trends]";
// Since 2026-11-23 the list (Top / Trending up / Trending down) and the ranking are chosen in the card's View menu.
const ready = (page) => page.waitForSelector(`${CARD} .rt-view:not([disabled])`, { timeout: 15000 });
// A scroll of the screen closes any menu (mockup.js), so the card is brought into view before View is pressed.
const openView = async (page) => { await page.locator(`${CARD} .rt-view`).scrollIntoViewIfNeeded(); await page.waitForTimeout(250); await page.click(`${CARD} .rt-view`); await page.waitForSelector("#popover.rt-pop"); };
const choose = async (page, attr, id) => { await openView(page); await page.click(`#popover [${attr}="${id}"]`); await page.waitForTimeout(300); };
const facts = (page) => page.evaluate((sel) => {
  const card = document.querySelector(sel);
  return {
    copies: document.querySelectorAll(sel).length,
    tab: card.dataset.rtList,
    source: card.dataset.rtRanking,
    face: card.querySelector(".rt-view")?.textContent.trim(),
    counts: { up: Number(card.querySelector(".rt-c-up > span[aria-hidden]")?.textContent), down: Number(card.querySelector(".rt-c-down > span[aria-hidden]")?.textContent) },
    atRest: [...card.querySelectorAll("button, a[href]")].filter((el) => !el.closest(".rt-rows")).length,
    rows: [...card.querySelectorAll(".rt-rows > li")].map((li) => ({ name: li.querySelector(".t a, .t span")?.textContent.trim(), up: !!li.querySelector(".chg.good"), down: !!li.querySelector(".chg.crit"), pos: li.querySelector(".rt-pos")?.textContent.replace(/\D*#/, "#") })),
    note: card.querySelector(".rt-note")?.textContent || "",
    all: null, // the way to every keyword is in the View menu: menuFacts
    words: card.innerText,
    wide: document.documentElement.scrollWidth > innerWidth + 1,
    keywordInMoves: [...document.querySelectorAll(".today-moves .rows li")].some((li) => li.querySelector("[data-today-keyword]")),
  };
}, CARD);

(async () => {
  const { browser, page, problems } = await open({ url: `${BASE}#today` });
  // One choice of ranking for the whole app since 2026-11-23 (rank-trends.js RankSource), Search Console by default.
  await page.evaluate(() => { try { localStorage.removeItem("seocc2-kwb-source"); } catch { /* none kept */ } });
  await page.reload();

  // ---- Today ----------------------------------------------------------------------------------------
  await ready(page);
  let f = await facts(page);
  check(f.copies === 1 && f.tab === "top" && f.source === "gsc" && /Top · Search Console/.test(f.face), `Today: one card, on Top, on Search Console by default (${f.copies}, ${f.tab}, ${f.source})`);
  check(f.note.includes("Search Console"), "Today: on Search Console the foot says so");
  await choose(page, "data-rt-source", "checks");
  f = await facts(page);
  check(f.source === "checks", "Our checks from the View menu");
  check(f.rows.length > 0 && f.rows.length <= 5, `Today: at most 5 rows first (${f.rows.length})`);
  const places = f.rows.map((r) => Number(r.pos.slice(1)));
  check(places.every((p, i) => !i || p >= places[i - 1]), `Today: Top is best placed first (${places.join(", ")})`);
  check(f.note.includes("Google"), "Today: the foot says where the numbers come from");
  check(f.atRest === 1 && /Top · Our checks/.test(f.face), `Today: one control at rest besides the keywords, View, naming what is shown (${f.atRest}, ${f.face})`);
  await openView(page);
  const menuWords = await page.locator("#popover").innerText();
  check(/Trending up/.test(menuWords) && /Search Console/.test(menuWords) && /All keywords/.test(menuWords) && await page.evaluate(() => document.activeElement?.dataset.rtTab === "top"), `View opens the menu on the chosen list (${menuWords.replace(/\s+/g, " ")})`);
  await page.locator("#popover").screenshot({ path: `${out}/today-menu.png` });
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  check(!(await page.$("#popover")) && await page.evaluate(() => document.activeElement?.hasAttribute("data-rt-view")), "Escape closes it, back on View");
  check(!f.keywordInMoves, "Today: Going down and Going up keep the pages only");
  await page.locator(CARD).screenshot({ path: `${out}/today-top.png` });

  await choose(page, "data-rt-tab", "up");
  f = await facts(page);
  check(f.tab === "up" && f.rows.length > 0 && f.rows.every((r) => r.up), `Trending up: every row went up (${f.rows.length} rows)`);
  check(f.rows.length <= f.counts.up, `Trending up: the head counts keywords (${f.counts.up}), similar ones share a row`);
  check(await page.evaluate(() => document.activeElement?.hasAttribute("data-rt-view")), "after a choice the keyboard is back on View");
  await page.keyboard.press("Enter"); await page.waitForSelector("#popover.rt-pop");
  await page.click('#popover [data-rt-tab="down"]'); await page.waitForTimeout(300);
  f = await facts(page);
  check(f.tab === "down" && f.rows.every((r) => r.down), "Trending down from the keyboard-opened menu, and every row went down");
  await page.locator(CARD).screenshot({ path: `${out}/today-down.png` });

  // ---- the switch -------------------------------------------------------------------------------------
  await choose(page, "data-rt-source", "gsc");
  f = await facts(page);
  await openView(page);
  const allGo = await page.getAttribute("#popover .rt-all", "data-go").catch(() => null);
  await page.keyboard.press("Escape");
  check(f.source === "gsc" && f.note.includes("Search Console") && allGo === "overview", `Search Console: its own note, and All queries goes to Overview (${allGo})`);
  await page.locator(CARD).screenshot({ path: `${out}/today-search-console.png` });

  // ---- Keywords: the one choice is remembered, the table follows it, and the card doesn't link to the screen it is on -----
  const chipTip = () => page.getAttribute('.kw-chips [data-filter="up"], #kw-tiles [data-filter="up"], [data-filter="up"]', "data-tip").catch(() => "");
  await page.goto(`${BASE}#keywords`);
  await ready(page);
  f = await facts(page);
  check(f.copies === 1 && f.source === "gsc", "Keywords: the card is there, still on Search Console");
  check(/^Search Console/.test(await chipTip() || ""), `Keywords: the table's Up chip counts on Search Console too (${await chipTip()})`);
  await choose(page, "data-rt-source", "checks");
  f = await facts(page);
  check(/^Our checks/.test(await chipTip() || ""), `the card's View menu switched the table's chips to our checks as well (${await chipTip()})`);
  check(await page.evaluate(() => document.activeElement?.hasAttribute("data-rt-view")), "and the keyboard is back on View after the screen redrew");
  await openView(page);
  const selfLink = await page.$("#popover .rt-all");
  await page.keyboard.press("Escape");
  check(f.source === "checks" && !selfLink, "Keywords: on our checks there is no link to Keywords itself");
  // The other way: By bucket's own switch moves the card too, then back to our checks for what follows.
  await page.click('[data-view="bucket"]'); await page.waitForSelector("[data-kwb-src]");
  await page.click('[data-kwb-src="gsc"]'); await page.waitForTimeout(600);
  f = await facts(page);
  check(f.source === "gsc", `By bucket's Search Console switch moved the card as well (${f.source})`);
  await page.click('[data-kwb-src="checks"]'); await page.waitForTimeout(600);
  await page.click('[data-view="positions"]'); await page.waitForTimeout(600);
  f = await facts(page);
  await page.screenshot({ path: `${out}/keywords.png` });

  // ---- Overview, then French, then a phone ---------------------------------------------------------------
  await page.goto(`${BASE}#overview`);
  await ready(page);
  f = await facts(page);
  await openView(page);
  const toKeywords = await page.getAttribute("#popover .rt-all", "data-go").catch(() => null);
  await page.keyboard.press("Escape");
  check(f.copies === 1 && toKeywords === "keywords", "Overview: the card is there, and our checks link to Keywords");
  await menu(page, "lang"); await page.waitForTimeout(700);
  f = await facts(page);
  check(f.words.includes("Mots-clés par position") && f.words.includes("en hausse") && f.words.includes("Nos vérifications"), `French: the card's words are in French (${f.face})`);
  await page.locator(CARD).screenshot({ path: `${out}/overview-french.png` });
  await menu(page, "lang"); await page.waitForTimeout(500);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  f = await facts(page);
  check(!f.wide, "phone: nothing wider than the screen");
  await page.locator(CARD).screenshot({ path: `${out}/overview-phone.png` });

  const real = problems.filter((p) => !p.includes("api/auth/me") && !p.includes("404"));
  check(!real.length, `no console errors ${JSON.stringify(real)}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL OK");
  process.exit(fails.length ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(2); });
