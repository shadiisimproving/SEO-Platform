// Competitors after the simpler-screens work and the owner's 2026-11-12 requests, driven by hand like a normal user.
// Both ways: node tests/ui/flow_competitors_simple.cjs <demo address> [on|off]  (on: the simpler screens, ?simple=1)
// Needs the demo world: DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8452
// Checks, with the switch on and off: the "You" line (one wide row, no blank cells, See your edits), the profile's four number
// cards (each opens what it counts), the Activity timeline (compact rows, pages, grouping, kind and period filters, no tooltip
// left open after a scroll) and Recheck on the Keywords tab (opens the Refresh dialog, never spends: the flow cancels it).
// With the switch on only: the head (Add a competitor), page tabs, the row's ⋯ (Tracking and Remove), the lower card's three
// tabs, the keyword panel, and the profile header's Tracking button and ⋯. Made-up sites only.
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = (process.argv[2] || "http://127.0.0.1:8452/").replace(/\/?$/, "/");
const MODE = process.argv[3] === "off" ? "0" : "1";
const OUT = path.resolve(`var/ui-competitors-simple-${MODE === "1" ? "on" : "off"}`) + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
const inPage = (page, fn, arg) => page.evaluate(fn, arg);

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const settle = (ms = 1200) => page.waitForTimeout(ms);
  // A competitor with hundreds of made-up changes, so the timeline has pages and repeats to group.
  await page.route(/\/api\/competitors\/\d+\/profile\?/, async (route) => {
    const res = await route.fetch(); const d = await res.json();
    const base = (d.timeline || []).filter((e) => e.page);
    if (base.length) {
      const out = [];
      for (let i = 0; i < 300; i++) {
        const b = JSON.parse(JSON.stringify(base[i % base.length]));
        b.at = new Date(Date.now() - Math.floor(i / 3) * 86400000 - (i % 3) * 3600000).toISOString(); b.id = 5000 + i;
        if (i % 4 === 0) { b.kind = "content"; b.before = `${1000 + i} words`; b.after = `${1200 + i} words`; b.changed_words = 200; }
        if (i % 7 === 0) b.url = `https://${d.host}/made-up-${i}`; // some pages changed once only
        out.push(b);
      }
      d.timeline = [...d.timeline, ...out].sort((a, b) => (a.at < b.at ? 1 : -1));
    }
    route.fulfill({ response: res, json: d });
  });
  // Since 2026-11-16 the simpler screens show Competitors as cards (flow_competitor_cards.cjs), folded to logos under
  // 1600 px until opened (2026-11-20). With the switch on, this flow opens the cards and checks the same promises on them.
  if (MODE === "1") await page.addInitScript(() => { try { localStorage.setItem("seocc-cs-slim", "0"); } catch { /* no storage */ } });
  await page.goto(`${BASE}?simple=${MODE}#competitors/summary?site=site-one.example`);
  await page.waitForSelector(MODE === "1" ? ".cs-card[data-cs-card]" : "#cs-rivals-table tbody tr[data-cs-row]", { timeout: 20000 });
  await settle(1500);
  const trackingOf = (id) => page.evaluate((cid) => fetch("api/links/sites").then((r) => r.json()).then(({ sites }) => fetch(`api/competitors?site_id=${sites.find((x) => x.host === "site-one.example").id}`)).then((r) => r.json()).then((d) => d.competitors.find((c) => String(c.id) === String(cid))?.tracking), id);

  // ---- the "You" line --------------------------------------------------------------------------------------------------
  if (MODE === "1") {
    const you = await inPage(page, () => { const c = document.querySelector(".cs-cards .cs-card-you"); return { first: c && c === document.querySelector(".cs-cards > *:first-child, .cs-cards li:first-child"), text: (c?.textContent || "").replace(/\s+/g, " ").trim(), mono: !!c?.querySelector(".mono"), reading: /Reading…/.test(c?.textContent || "") }; });
    check("your card comes first", Boolean(you.first), JSON.stringify(you));
    check("your card reads plainly: your site, its edits, no code font", /Your site/.test(you.text) && /edit/.test(you.text) && !you.mono && !you.reading, you.text);
  } else {
    const you = await inPage(page, () => {
      const tr = document.querySelector("#cs-rivals-table > tbody > tr:first-child");
      const cols = document.querySelector("#cs-rivals-table thead tr").cells.length;
      const cell = tr?.querySelector("td.cs-you-cell");
      return { isYou: tr?.classList.contains("cs-you-row"), cells: tr?.cells.length, span: Number(cell?.getAttribute("colspan") || 0), cols, text: (cell?.textContent || "").replace(/\s+/g, " ").trim(), mono: !!tr?.querySelector(".mono"), reading: /Reading…/.test(tr?.textContent || "") };
    });
    check("the You line is the first row, one wide cell across every column", you.isYou && you.cells === 1 && you.span === you.cols, JSON.stringify(you));
    check("the You line reads as a sentence: your site, its edits, how it's read", /Your site/.test(you.text) && /edit/.test(you.text) && !you.mono && !you.reading, you.text);
  }
  const see = await page.$("[data-cs-you-edits]");
  check("See your edits is there", Boolean(see));
  if (see) {
    await see.click(); await settle(800);
    const panel = await inPage(page, () => ({ rows: document.querySelectorAll("#panel tbody tr").length, text: (document.querySelector("#panel")?.textContent || "").replace(/\s+/g, " ").slice(0, 160) }));
    check("See your edits opens your own edits in the side panel", panel.rows > 0, JSON.stringify(panel));
    await page.screenshot({ path: OUT + "1-your-edits.png" });
    await page.keyboard.press("Escape"); await settle(400);
  }

  if (MODE === "1") {
    // ---- the head, page tabs, the card's ⋯ --------------------------------------------------------------------------------
    check("the head has Add a competitor as its one main action", Boolean(await page.$("#topbar #cl-add-open")));
    // 2026-11-16, the owner: "remove the More section, make the tabs normally": every tab in the row, no More.
    const tabNames = (await page.locator(".comp-tabs.page-tabs [data-comp-tab]").allTextContents()).map((x) => x.trim());
    check("page tabs in the underline look, every one in the row and no More", ["Competitors", "Find competitors", "Keyword check", "Notes"].every((x) => tabNames.includes(x)) && (await page.locator(".comp-tabs.page-tabs #comp-tabs-more").count()) === 0, tabNames.join());
    check("no Tracking switch or Remove button sits on the cards", (await page.locator(".cs-card [data-ct-set], .cs-card [data-cl-remove]").count()) === 0);
    const firstId = await page.evaluate(() => document.querySelector(".cs-cards .cs-card[data-cs-card]").dataset.csCard);
    await page.click(`.cs-card[data-cs-card="${firstId}"] [data-cs-menu]`); await settle(400);
    check("the card's ⋯ holds Tracking (On / Pages only / Off) and Remove", (await page.locator("#popover [data-ct-set]").count()) === 3 && (await page.locator("#popover [data-cl-remove]").count()) === 1);
    await page.screenshot({ path: OUT + "2-row-menu.png" });
    await page.click("#popover [data-ct-set=pages]"); await settle(2500);
    check("a choice closes the menu and the competitor is Pages only", !(await page.$("#popover")) && (await trackingOf(firstId)) === "pages");
    await page.click(`.cs-card[data-cs-card="${firstId}"] [data-cs-menu]`); await settle(300);
    await page.click("#popover [data-ct-set=on]"); await settle(2500);
    check("and back to On", (await trackingOf(firstId)) === "on");

    // ---- the lower card: three tabs ---------------------------------------------------------------------------------------
    // Changes comes first on the cards screen since read-like-a-person (2026-11-20).
    const tabs = await inPage(page, () => [...document.querySelectorAll("[data-cs-low]")].map((b) => [b.dataset.csLow, b.getAttribute("aria-selected")]));
    check("one card, three tabs, Changes first", JSON.stringify(tabs.map((x) => x[0]).sort()) === '["keywords","links","moves"]' && tabs[0][0] === "moves" && tabs[0][1] === "true", JSON.stringify(tabs));
    const moves = await inPage(page, () => ({ shown: !document.querySelector("#cs-moves").hidden, rows: document.querySelectorAll("#cs-moves-list > li, #cs-moves-list tbody tr").length, chips: document.querySelectorAll("[data-cs-mv-kind]").length, days: document.querySelectorAll("[data-cs-mv-days-btn]").length }));
    check("Changes shows its rows, with its kind and period filters", moves.shown && moves.rows > 0 && moves.chips > 0 && moves.days > 0, JSON.stringify(moves));
    await page.click("[data-cs-low=links]"); await settle(500);
    check("Shared links opens on its tab", await inPage(page, () => !document.querySelector("#cs-links").hidden));
    await page.click("[data-cs-low=keywords]"); await settle(500);
    await page.click("tr[data-cs-kw] td:nth-child(3)"); await settle(1200);
    const kwPanel = await inPage(page, () => ({ title: document.querySelector("#panel h2")?.textContent.trim(), rows: document.querySelectorAll("#panel tbody tr").length, task: /Task/.test(document.querySelector("#panel .panel-foot")?.textContent || "") }));
    check("a keyword row opens its panel: who's ahead, with their pages, and Task", Boolean(kwPanel.title) && kwPanel.rows > 0 && kwPanel.task, JSON.stringify(kwPanel));
    await page.screenshot({ path: OUT + "3-keyword-panel.png" });
    await page.keyboard.press("Escape"); await settle(400);
  }

  // ---- the profile: four cards, Activity, Recheck ------------------------------------------------------------------------
  if (MODE === "1") await page.click(".cs-cards .cs-card[data-cs-card] .cs-card-open");
  else await page.click("#cs-rivals-table tbody tr[data-cs-row] td:nth-child(3)");
  await page.waitForSelector("[data-pt-tab]", { timeout: 15000 }); await settle(1500);
  const cards = await inPage(page, () => [...document.querySelectorAll("[data-pt-card]")].map((c) => c.dataset.ptCard));
  check("four number cards: Shared keywords, Only them, Only you, Pages", ["shared", "theirs_only", "mine_only", "pages"].every((id) => cards.includes(id)), JSON.stringify(cards));
  check("no squares, logos and coloured labels mixed on one line", (await page.locator(".pt-strip .pt-fig-val, .pt-strip .pt-fig-sub").count()) === 0);
  await page.click('[data-pt-card="theirs_only"]'); await settle(600);
  check("Only them opens the Keywords tab on Only them", (await page.getAttribute('[data-cl-kw="theirs_only"]', "aria-pressed")) === "true");
  await page.click('[data-pt-card="pages"]'); await settle(600);
  check("Pages opens the Pages tab", (await page.getAttribute('[data-pt-tab="pages"]', "aria-selected")) === "true");
  await page.locator(".cl-head").screenshot({ path: OUT + "4-profile-cards.png" });

  if (MODE === "1") {
    check("the profile header: one Tracking button and a ⋯, no three-way switch in view", Boolean(await page.$("[data-cl-track]")) && Boolean(await page.$("[data-cl-more]")) && (await page.locator(".cl-head [data-ct-set]").count()) === 0);
    await page.click("[data-cl-more]"); await settle(300);
    check("the ⋯ holds Refresh data and Remove", (await page.locator("#popover [data-cl-read]").count()) === 1 && (await page.locator("#popover [data-cl-remove]").count()) === 1);
    await page.keyboard.press("Escape"); await settle(300);
  }

  // Recheck: a row's own button, and ticked rows in the bar. Both open the Refresh dialog; the flow cancels, so nothing is spent.
  await page.click('[data-pt-tab="keywords"]'); await settle(500);
  await page.click('[data-cl-kw="shared"]'); await settle(500);
  await page.hover("tr[data-cl-kw-row]");
  await page.click("[data-cl-recheck] >> nth=0"); await settle(2500);
  const dlg = await inPage(page, () => ({ open: !!document.querySelector("#dlg")?.open, text: (document.querySelector("#dlg")?.textContent || "").replace(/\s+/g, " ").slice(0, 80) }));
  check("a row's Recheck opens the Refresh dialog with its preview", dlg.open && /Refresh/i.test(dlg.text), JSON.stringify(dlg));
  await page.keyboard.press("Escape"); await settle(400);
  await page.click("[data-cl-kw-pick] >> nth=0", { force: true }); await page.click("[data-cl-kw-pick] >> nth=1", { force: true }); await settle(400);
  check("ticked rows give Recheck in the selection bar", /2 selected/.test(await page.textContent("#cl-kw-selbar")) && Boolean(await page.$("#cl-kw-selbar [data-cl-recheck-picked]")));
  await page.click("#cl-kw-selbar [data-cl-recheck-picked]"); await settle(2500);
  check("the bar's Recheck opens the dialog for both", await inPage(page, () => !!document.querySelector("#dlg")?.open && /2 keywords/.test(document.querySelector("#dlg").textContent)));
  await page.keyboard.press("Escape"); await settle(400);
  await page.click("[data-cl-kw-clear]"); await settle(300);

  // Changes (Activity until 2026-11-20): compact rows in pages, repeats grouped, kind and period filters.
  await page.click('[data-pt-tab="changes"]'); await page.waitForSelector("#cl-timeline"); await settle(800); // the timeline moved from Activity to Changes (2026-11-20)
  const tl = await inPage(page, () => ({ rows: document.querySelectorAll("#cl-timeline .cl-tl-table tbody tr").length, pager: !!document.querySelector("#cl-timeline [data-tp-foot]"), more: !!document.querySelector("[data-cl-tl-more]"), grouped: document.querySelectorAll("#cl-timeline .cl-tl-times").length, height: document.querySelector("#cl-timeline").getBoundingClientRect().height }));
  check("the timeline is compact rows, 25 a page at most, with the shared pager and no Show more", tl.rows > 0 && tl.rows <= 25 && tl.pager && !tl.more, JSON.stringify(tl));
  check("repeated changes of one page are one row with a count", tl.grouped > 0, tl.grouped);
  check("the timeline stays short", tl.height < 2600, Math.round(tl.height));
  await page.click('[data-cl-tl-days="7"]'); await settle(500);
  check("the period filter: 7 days", (await page.getAttribute('[data-cl-tl-days="7"]', "aria-pressed")) === "true");
  await page.click('[data-cl-tl="new"]'); await settle(500);
  const onlyNew = await inPage(page, () => [...document.querySelectorAll("#cl-timeline .cl-tl-kind span")].map((x) => x.textContent.trim()));
  check("the kind filter: New pages shows only added pages", onlyNew.length > 0 && onlyNew.every((w) => w === onlyNew[0]), JSON.stringify([...new Set(onlyNew)]));
  await page.click('[data-cl-tl="all"]'); await page.click('[data-cl-tl-days="0"]'); await settle(500);
  check("every row keeps All the details behind Details", (await page.locator("#cl-timeline .cl-more-facts").count()) > 0);
  // A tooltip opened on a row must not stay behind after a scroll.
  await page.hover("#cl-timeline .cl-tl-kind >> nth=0"); await settle(600);
  await inPage(page, () => document.querySelector("#main").scrollBy(0, 300)); await settle(300);
  check("no tooltip is left open after a scroll", (await page.locator("body > .tooltip").count()) === 0);
  await page.locator("#cl-timeline").screenshot({ path: OUT + "5-timeline.png" });

  await page.setViewportSize({ width: 390, height: 844 }); await settle(600);
  check("no sideways scroll on a phone", !(await inPage(page, () => document.documentElement.scrollWidth > window.innerWidth + 1)));
  check("no page errors", problems.filter((x) => !/404/.test(x)).length === 0, problems.slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})();
