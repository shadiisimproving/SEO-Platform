// The Competitors cards screen (simpler screens, 2026-11-16, from the owner's benchmark screenshot), driven by hand.
// node tests/ui/flow_competitor_cards.cjs <demo address>
// Needs the demo world: DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8452
// Checks: cards down the left (your site first, then each competitor with its home page's name and words, its added and
// edited counts and its pages), They beat you on first on the right and no Changes there (it lives in each competitor's
// page since 2026-11-20: flow_competitor_changes_in_profile.cjs), the card's ⋯, a card opening its competitor by click,
// keyboard and Open, Back to competitors, See your edits, and a phone. Made-up sites only.
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

  // ---- the right side: They beat you on first; Changes moved into each competitor's page (2026-11-20) ------------------
  const first = await page.evaluate(() => ({
    tab: document.querySelector("#cs-low-tabs [aria-selected=true]")?.dataset.csLow,
    tabs: [...document.querySelectorAll("#cs-low-tabs [data-cs-low]")].map((b) => b.dataset.csLow).join(),
    moves: Boolean(document.querySelector("#cs-moves, #cs-moves-list")),
    tiles: Boolean(document.querySelector("#cs-tiles")), table: Boolean(document.querySelector("#cs-rivals-table")),
  }));
  check("They beat you on is the tab open first", first.tab === "keywords" && first.tabs === "keywords,links", `${first.tab} / ${first.tabs}`);
  check("Changes isn't on this screen, and isn't asked for", !first.moves && asked.length === 0, asked.length);
  check("the number cards and the old Competitors table are gone", !first.tiles && !first.table);

  // ---- the card's ⋯ doesn't open the competitor ------------------------------------------------------------------------
  await page.click(`[data-cs-card="${one.id}"] [data-cs-menu]`); await settle(500);
  const menu = await page.evaluate(() => ({ text: (document.querySelector(".cs-menu")?.textContent || "").replace(/\s+/g, " "), profile: Boolean(document.querySelector("#cl-profile-title")) }));
  check("the card's ⋯ opens Tracking and Remove without opening the competitor", /Remove/.test(menu.text) && !menu.profile, JSON.stringify(menu));
  await page.keyboard.press("Escape"); await settle(400);
  // ---- See your edits, and Open ---------------------------------------------------------------------------------------
  const see = await page.$(".cs-card-you [data-cs-you-edits]");
  check("your card has See your edits", Boolean(see));
  if (see) {
    await see.click(); await settle(800);
    const rows = await page.evaluate(() => document.querySelectorAll("#panel tbody tr, .row-panel tbody tr").length);
    check("See your edits opens your edits in the side panel", rows > 0, rows);
    await page.keyboard.press("Escape"); await settle(400);
  }

  // ---- the keyboard, and Open ---------------------------------------------------------------------------------------
  await page.focus(`[data-cs-card="${one.id}"] .cs-card-pick`);
  const ring = await page.evaluate((id) => getComputedStyle(document.querySelector(`[data-cs-card="${id}"] .cs-card-pick`)).outlineStyle, one.id);
  check("a focused card shows a focus ring", ring !== "none", ring);
  await page.keyboard.press("Enter"); await settle(1500);
  check("a card opens its competitor from the keyboard", Boolean(await page.$("#cl-profile-title")), page.url());
  await page.click("[data-cl-back]"); await settle(1200);
  check("Back to competitors returns to the cards", !(await page.$("#cl-profile-title")) && Boolean(await page.$(".cs-cards .cs-card[data-cs-card]")));
  await page.click(`[data-cs-card="${one.id}"] .cs-card-open`); await settle(1500);
  check("Open on a card opens that competitor", Boolean(await page.$("#cl-profile-title")), page.url());

  // ---- a phone --------------------------------------------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}?simple=1#competitors/summary?site=site-one.example`);
  await page.waitForSelector(".cs-cards .cs-card[data-cs-card]", { timeout: 20000 }); await settle(1500);
  const phone = await page.evaluate(() => {
    const strip = document.querySelector(".cs-cards");
    return { pageWide: document.documentElement.scrollWidth > window.innerWidth + 1, strip: strip.scrollWidth > strip.clientWidth };
  });
  check("on a phone the page doesn't scroll sideways, the cards do", !phone.pageWide && phone.strip, JSON.stringify(phone));
  await page.screenshot({ path: OUT + "4-phone.png", fullPage: true });

  const real = problems.filter((p) => !/status of 404/.test(p)); // /api/auth/me answers 404 without --login
  check("no page errors", real.length === 0, real.slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
