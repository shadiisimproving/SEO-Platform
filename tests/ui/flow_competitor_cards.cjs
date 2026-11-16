// The Competitors cards screen (simpler screens, 2026-11-16, from the owner's benchmark screenshot), driven by hand.
// node tests/ui/flow_competitor_cards.cjs <demo address>
// Needs the demo world: DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8452
// Checks: cards down the left (your site first, then each competitor with its home page's name and words, its added and
// edited counts and its pages), Changes first on the right with no Competitor column, a card as the competitor filter (and
// its chip to take it off), the kind and period buttons, the card's ⋯ and Open, They beat you on following the card,
// See your edits, the keyboard, and a phone. Made-up sites only.
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = (process.argv[2] || "http://127.0.0.1:8452/").replace(/\/?$/, "/");
const OUT = path.resolve("var/ui-competitor-cards") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const settle = (ms = 900) => page.waitForTimeout(ms);
  const asked = [];
  page.on("request", (r) => { if (r.url().includes("/api/collective/moves")) asked.push(r.url()); });
  await page.goto(`${BASE}?simple=1#competitors/summary?site=site-one.example`);
  await page.waitForSelector(".cs-cards .cs-card[data-cs-card]", { timeout: 20000 });
  await page.waitForSelector("#cs-moves-list tbody tr", { timeout: 20000 });
  await settle(1200);
  await page.screenshot({ path: OUT + "1-cards.png" });

  // ---- the cards ---------------------------------------------------------------------------------------------------
  const cards = await page.evaluate(() => [...document.querySelectorAll(".cs-cards > .cs-card")].map((c) => ({
    you: c.classList.contains("cs-card-you"), id: c.dataset.csCard || null,
    name: c.querySelector(".cs-card-name")?.textContent.trim(), host: c.querySelector(".cs-card-host")?.textContent.replace(/\s+/g, " ").trim(),
    about: c.querySelector(".cs-card-about")?.textContent.trim() || "", counts: c.querySelector(".cs-card-counts")?.textContent.replace(/\s+/g, " ").trim(),
    logo: Boolean(c.querySelector(".cs-card-logo img, .cs-card-logo .site-logo, .cs-card-logo [class*=logo]")),
  })));
  check("your site's card comes first", cards[0]?.you && /Your site/.test(cards[0].host), JSON.stringify(cards[0]));
  const one = cards.find((c) => /rival-one/.test(c.host || ""));
  check("a competitor's card is named by its home page and says what it does", one && one.name === "Rival One" && /Coffee club/.test(one.about), JSON.stringify(one));
  check("the card splits its 30 days into added and edited, with its pages", one && /1 added in 30 days/.test(one.counts) && /3 edited in 30 days/.test(one.counts) && /9 pages/.test(one.counts), one?.counts);
  const blocked = cards.find((c) => /cafe-monde/.test(c.host || ""));
  check("a site that blocks bots says so, and shows no 0s", blocked && /Blocked/.test(blocked.counts) && !/0 added/.test(blocked.counts), blocked?.counts);
  check("every card has a logo", cards.every((c) => c.logo), cards.filter((c) => !c.logo).map((c) => c.host).join(", "));

  // ---- Changes first, the table the screenshot's way -----------------------------------------------------------------
  const first = await page.evaluate(() => ({
    tab: document.querySelector("#cs-low-tabs [aria-selected=true]")?.dataset.csLow,
    heads: [...document.querySelectorAll("#cs-moves-list thead th")].map((th) => th.textContent.trim()).filter(Boolean),
    ...(() => { const row = document.querySelector("#cs-moves-list .cl-tl-link")?.closest("tr"); return { link: row?.querySelector(".cl-tl-link")?.textContent.trim(), owner: row?.querySelector(".cl-tl-owner")?.textContent.replace(/\s+/g, " ").trim() }; })(),
    rows: document.querySelectorAll("#cs-moves-list tbody tr").length,
    tiles: Boolean(document.querySelector("#cs-tiles")), table: Boolean(document.querySelector("#cs-rivals-table")),
  }));
  check("Changes is the tab open first", first.tab === "moves", first.tab);
  check("the table has no Competitor column", !first.heads.includes("Competitor") && first.heads.includes("Page"), first.heads.join(" | "));
  check("a page row shows its title as the link, with the site and path under it", Boolean(first.link) && /\.example/.test(first.owner || "") && /\//.test(first.owner || ""), `${first.link} / ${first.owner}`);
  check("the number cards and the old Competitors table are gone", !first.tiles && !first.table);
  const headTop = await page.evaluate(() => document.querySelector("#cs-moves .cs-mv-head")?.getBoundingClientRect().top ?? 9999);
  check("the changes start at the top of the screen, not under other cards", headTop < 300, headTop);

  // ---- a card is the filter ------------------------------------------------------------------------------------------
  const allRows = first.rows;
  await page.click(`[data-cs-pick="${one.id}"]`); await settle();
  const picked = await page.evaluate((id) => ({
    pressed: document.querySelector(`[data-cs-pick="${id}"]`)?.getAttribute("aria-pressed"), on: document.querySelector(`[data-cs-card="${id}"]`)?.classList.contains("on"),
    chip: document.querySelector(".cs-mv-who")?.textContent.trim(), owners: [...document.querySelectorAll("#cs-moves-list .cl-tl-owner")].map((o) => o.textContent),
    rows: document.querySelectorAll("#cs-moves-list tbody tr").length, focus: document.activeElement?.dataset?.csPick,
  }), one.id);
  check("pressing a card shows only that competitor's changes", picked.pressed === "true" && picked.on && picked.owners.length > 0 && picked.owners.every((o) => /rival-one/.test(o)), JSON.stringify({ ...picked, owners: picked.owners.length }));
  check("a chip says who is shown, and the focus stays on the card", /rival-one/.test(picked.chip || "") && picked.focus === String(one.id), `${picked.chip} / ${picked.focus}`);
  await page.screenshot({ path: OUT + "2-one-competitor.png" });
  await page.click(".cs-mv-who"); await settle();
  const back = await page.evaluate(() => ({ rows: document.querySelectorAll("#cs-moves-list tbody tr").length, chip: Boolean(document.querySelector(".cs-mv-who")), on: document.querySelectorAll(".cs-card.on").length }));
  check("the chip's × shows everyone again", back.rows === allRows && !back.chip && back.on === 0, JSON.stringify(back));

  // ---- kind and period buttons ---------------------------------------------------------------------------------------
  await page.click('[data-cs-mv-kind="new"]'); await settle();
  const added = await page.evaluate(() => [...document.querySelectorAll("#cs-moves-list tbody tr .cl-tl-kind")].map((k) => k.textContent.trim()));
  check("Added shows only added pages", added.length > 0 && added.every((w) => /Added/.test(w)), added.join(", "));
  await page.click('[data-cs-mv-kind="all"]'); await settle();
  const before = asked.length;
  await page.click('[data-cs-mv-days-btn="7"]'); await settle(1500);
  const week = await page.evaluate(() => ({ pressed: document.querySelector('[data-cs-mv-days-btn="7"]')?.getAttribute("aria-pressed"), busy: document.querySelector("#cs-moves")?.getAttribute("aria-busy") }));
  check("7 days asks for 7 days and stays pressed", asked.slice(before).some((u) => /days=7/.test(u)) && week.pressed === "true" && !week.busy, JSON.stringify({ ...week, asked: asked.slice(before) }));
  await page.click('[data-cs-mv-days-btn="30"]'); await settle(1500);

  // ---- ⋯ and Open on a card don't filter ---------------------------------------------------------------------------------
  await page.click(`[data-cs-card="${one.id}"] [data-cs-menu]`); await settle(500);
  const menu = await page.evaluate(() => ({ text: (document.querySelector(".cs-menu")?.textContent || "").replace(/\s+/g, " "), on: document.querySelectorAll(".cs-card.on").length }));
  check("the card's ⋯ opens Tracking and Remove without picking the card", /Remove/.test(menu.text) && menu.on === 0, JSON.stringify(menu));
  await page.keyboard.press("Escape"); await settle(400);

  // ---- They beat you on follows the card -----------------------------------------------------------------------------
  await page.click(`[data-cs-pick="${one.id}"]`); await settle();
  await page.click('[data-cs-low="keywords"]'); await settle();
  const kw = await page.evaluate(() => ({ shown: !document.querySelector("#cs-keywords")?.hidden, rival: document.querySelector("#cs-kw-rival")?.value }));
  check("They beat you on shows the picked competitor too", kw.shown && kw.rival === "rival-one.example", JSON.stringify(kw));
  await page.screenshot({ path: OUT + "3-they-beat-you.png" });
  await page.click('[data-cs-low="moves"]'); await settle();
  await page.click(`[data-cs-pick="${one.id}"]`); await settle(); // off again

  // ---- See your edits, and Open ---------------------------------------------------------------------------------------
  const see = await page.$(".cs-card-you [data-cs-you-edits]");
  check("your card has See your edits", Boolean(see));
  if (see) {
    await see.click(); await settle(800);
    const rows = await page.evaluate(() => document.querySelectorAll("#panel tbody tr, .row-panel tbody tr").length);
    check("See your edits opens your edits in the side panel", rows > 0, rows);
    await page.keyboard.press("Escape"); await settle(400);
  }

  // ---- the keyboard -------------------------------------------------------------------------------------------------
  await page.focus(`[data-cs-pick="${one.id}"]`);
  await page.keyboard.press("Enter"); await settle();
  const keyed = await page.evaluate((id) => document.querySelector(`[data-cs-pick="${id}"]`)?.getAttribute("aria-pressed"), one.id);
  check("a card is picked from the keyboard", keyed === "true", keyed);
  await page.keyboard.press("Enter"); await settle();
  const ring = await page.evaluate((id) => getComputedStyle(document.querySelector(`[data-cs-pick="${id}"]`)).outlineStyle, one.id);
  check("a focused card shows a focus ring", ring !== "none", ring);

  await page.click(`[data-cs-card="${one.id}"] [data-cs-open]`); await settle(1500);
  check("Open on a card opens that competitor", /competitors\/list/.test(page.url()) || Boolean(await page.$(".cl-profile, [data-cl-profile], .cp-head")), page.url());

  // ---- a phone --------------------------------------------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}?simple=1#competitors/summary?site=site-one.example`);
  await page.waitForSelector(".cs-cards .cs-card[data-cs-card]", { timeout: 20000 }); await settle(1500);
  const phone = await page.evaluate(() => {
    const strip = document.querySelector(".cs-cards");
    return { pageWide: document.documentElement.scrollWidth > window.innerWidth + 1, strip: strip.scrollWidth > strip.clientWidth, segsInside: [...document.querySelectorAll(".cs-seg")].every((s) => s.getBoundingClientRect().right <= window.innerWidth + 1) };
  });
  check("on a phone the page doesn't scroll sideways, the cards do", !phone.pageWide && phone.strip, JSON.stringify(phone));
  check("on a phone the filter buttons fit the screen", phone.segsInside);
  await page.screenshot({ path: OUT + "4-phone.png", fullPage: true });

  const real = problems.filter((p) => !/status of 404/.test(p)); // /api/auth/me answers 404 without --login
  check("no page errors", real.length === 0, real.slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
