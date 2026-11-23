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
const ready = (page) => page.waitForSelector(`${CARD} .rt-tabs`, { timeout: 15000 });
const facts = (page) => page.evaluate((sel) => {
  const card = document.querySelector(sel);
  return {
    copies: document.querySelectorAll(sel).length,
    tab: card.querySelector('.rt-tab[aria-selected="true"]')?.dataset.rtTab,
    source: card.querySelector('[data-rt-source][aria-pressed="true"]')?.dataset.rtSource,
    counts: Object.fromEntries([...card.querySelectorAll(".rt-tab")].map((b) => [b.dataset.rtTab, Number(b.querySelector(".rt-n").textContent)])),
    rows: [...card.querySelectorAll(".rt-rows > li")].map((li) => ({ name: li.querySelector(".t a, .t span")?.textContent.trim(), up: !!li.querySelector(".chg.good"), down: !!li.querySelector(".chg.crit"), pos: li.querySelector(".rt-pos")?.textContent.replace(/\D*#/, "#") })),
    note: card.querySelector(".rt-note")?.textContent || "",
    all: card.querySelector(".rt-all")?.getAttribute("href") || null,
    words: card.innerText,
    wide: document.documentElement.scrollWidth > innerWidth + 1,
    keywordInMoves: [...document.querySelectorAll(".today-moves .rows li")].some((li) => li.querySelector("[data-today-keyword]")),
  };
}, CARD);

(async () => {
  const { browser, page, problems } = await open({ url: `${BASE}#today` });
  await page.evaluate(() => { try { localStorage.removeItem("seo-cc-rank-trends-source"); } catch { /* none kept */ } });
  await page.reload();

  // ---- Today ----------------------------------------------------------------------------------------
  await ready(page);
  let f = await facts(page);
  check(f.copies === 1 && f.tab === "top" && f.source === "checks", `Today: one card, on Top, on our checks (${f.copies}, ${f.tab}, ${f.source})`);
  check(f.rows.length > 0 && f.rows.length <= 5, `Today: at most 5 rows first (${f.rows.length})`);
  const places = f.rows.map((r) => Number(r.pos.slice(1)));
  check(places.every((p, i) => !i || p >= places[i - 1]), `Today: Top is best placed first (${places.join(", ")})`);
  check(f.note.includes("Google") && f.all === "#keywords", "Today: the foot says where the numbers come from, and links to all keywords");
  check(!f.keywordInMoves, "Today: Going down and Going up keep the pages only");
  await page.locator(CARD).screenshot({ path: `${out}/today-top.png` });

  await page.click(`${CARD} [data-rt-tab="up"]`);
  f = await facts(page);
  check(f.tab === "up" && f.rows.length > 0 && f.rows.every((r) => r.up), `Trending up: every row went up (${f.rows.length} rows)`);
  check(f.rows.length <= f.counts.up, `Trending up: the tab counts keywords (${f.counts.up}), similar ones share a row`);
  await page.keyboard.press("ArrowRight");
  f = await facts(page);
  check(f.tab === "down" && f.rows.every((r) => r.down), "Right arrow moves to Trending down, and every row went down");
  check(await page.evaluate(() => document.activeElement?.dataset.rtTab === "down"), "the keyboard stays on the tab it moved to");
  await page.locator(CARD).screenshot({ path: `${out}/today-down.png` });

  // ---- the switch -------------------------------------------------------------------------------------
  await page.click(`${CARD} [data-rt-source="gsc"]`);
  f = await facts(page);
  check(f.source === "gsc" && f.note.includes("Search Console") && f.all === "#overview", "Search Console: its own note, and the link goes to Overview");
  await page.locator(CARD).screenshot({ path: `${out}/today-search-console.png` });

  // ---- Keywords: the choice is remembered, and the card doesn't link to the screen it is on --------------------
  await page.goto(`${BASE}#keywords`);
  await ready(page);
  f = await facts(page);
  check(f.copies === 1 && f.source === "gsc", "Keywords: the card is there, still on Search Console");
  await page.click(`${CARD} [data-rt-source="checks"]`);
  f = await facts(page);
  check(f.source === "checks" && f.all === null, "Keywords: on our checks there is no link to Keywords itself");
  await page.screenshot({ path: `${out}/keywords.png` });

  // ---- Overview, then French, then a phone ---------------------------------------------------------------
  await page.goto(`${BASE}#overview`);
  await ready(page);
  f = await facts(page);
  check(f.copies === 1 && f.all === "#keywords", "Overview: the card is there, and our checks link to Keywords");
  await menu(page, "lang"); await page.waitForTimeout(700);
  f = await facts(page);
  check(f.words.includes("Mots-clés par position") && f.words.includes("En hausse") && f.words.includes("Nos vérifications"), "French: the card's words are in French");
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
