// Competitors, 2026-11-23 (two edits the owner approved):
//   1. the folded rail of logos (under 1600 px wide) gives each logo its own Open, by mouse, keyboard and touch; the logo
//      still only filters Changes, and the two tooltips say which does what;
//   2. a competitor's page has Link gaps, Page vs page and AI tabs after the others, each for that competitor alone.
// Driven by hand:
//   DB_NAME_TEST=test_ec1_test DB_POOL_SIZE=2 .venv/bin/python tests/ui/app_server.py --port 8901
//   node tests/ui/flow_competitor_rail_open_and_tabs.cjs http://127.0.0.1:8901/ [folder for screenshots]
// Made-up sites only (the demo world).
const { open, menu } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = (process.argv[2] || "http://127.0.0.1:8901/").replace(/\/?$/, "/");
const OUT = (process.argv[3] ? path.resolve(process.argv[3]) : path.resolve("var/ui-competitor-rail-open-and-tabs")) + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
const SCREEN = `${BASE}?simple=1#competitors/summary?site=site-one.example`;

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const settle = (ms = 900) => page.waitForTimeout(ms);
  const run = (fn, arg) => page.evaluate(fn, arg); // Playwright: runs in the page
  const asked = [];
  page.on("request", (r) => { if (/\/api\/(link-gaps|page-pairs|ai-watch)\?/.test(r.url())) asked.push(r.url()); });
  await page.goto(SCREEN);
  await page.waitForSelector(".cs-cards .cs-card[data-cs-card]", { timeout: 20000 });
  await settle(1500);

  // ---- 1. the folded rail at 1440 px ------------------------------------------------------------------------------
  check("1440: the cards start folded to the rail", Boolean(await page.$(".cs-bench-slim")));
  const ids = await page.$$eval(".cs-cards .cs-card[data-cs-card]", (cards) => cards.map((c) => c.dataset.csCard));
  const opens = await page.$$eval(".cs-cards .cs-card[data-cs-card] > .cs-rail-open", (b) => b.length);
  check("every folded logo has its own Open", opens === ids.length && ids.length > 0, `${opens} of ${ids.length}`);
  const first = ids[0];
  const card = `.cs-card[data-cs-card="${first}"]`;
  const look = (p = page) => p.evaluate((sel) => {
    const b = document.querySelector(`${sel} > .cs-rail-open`), r = b.getBoundingClientRect();
    return { opacity: getComputedStyle(b).opacity, w: r.width, h: r.height, tip: b.dataset.tip, label: b.getAttribute("aria-label"), pickTip: document.querySelector(`${sel} .cs-card-pick`).dataset.tip };
  }, card);
  await page.mouse.move(700, 5);
  await settle(300);
  const rest = await look();
  check("at rest the Open stays out of the way", Number(rest.opacity) === 0, rest.opacity);
  check("the two tooltips say which does what", /changes/i.test(rest.pickTip) && /^Open .+'s page$/.test(rest.tip) && rest.label === rest.tip, `${rest.pickTip} | ${rest.tip}`);
  await page.hover(`${card} .cs-card-pick`);
  await settle(400);
  const hovered = await look();
  check("hovering the logo shows its Open", Number(hovered.opacity) === 1, hovered.opacity);
  check("the Open is at least 24 px", hovered.w >= 24 && hovered.h >= 24, `${hovered.w}x${hovered.h}`);
  await page.screenshot({ path: OUT + "rail-1440-hover.png" });

  // The logo itself still only filters.
  await page.click(`${card} .cs-card-pick`);
  await settle();
  check("the logo still filters, and doesn't open the page", !(await page.$("#cl-profile-title")) && (await page.getAttribute(`${card} .cs-card-pick`, "aria-pressed")) === "true");
  await page.mouse.move(700, 5);
  await settle(300);
  check("the picked logo keeps its Open shown", Number((await look()).opacity) === 1);
  await page.screenshot({ path: OUT + "rail-1440-picked.png" });

  // Mouse: Open opens that competitor's page.
  await page.hover(`${card} .cs-card-pick`);
  await page.click(`${card} > .cs-rail-open`);
  await page.waitForSelector("#cl-profile-title", { timeout: 20000 });
  await settle();
  check("Open on the rail opens the competitor's page", Boolean(await page.$("#cl-profile-title")));
  const openId = await run(() => String(window.COMP.tabs.find((x) => x.id === "list")?.competitorId));
  check("it is that competitor's page", openId === first, `${openId} | ${first}`);
  check("it opens on Changes", (await page.getAttribute('[data-pt-tab="changes"]', "aria-selected")) === "true");

  // ---- 2. the three tabs in a competitor's page -------------------------------------------------------------------
  const order = await page.$$eval("[data-pt-tab]", (b) => b.map((x) => x.dataset.ptTab));
  check("Changes first, then Link gaps, Page vs page and AI last", order[0] === "changes" && order.slice(-3).join(",") === "gaps,pairs,ai", order.join(" "));
  const tabCheck = async (id, api, menuSel, shot) => {
    asked.length = 0;
    await page.click(`[data-pt-tab="${id}"]`);
    await page.waitForSelector("#pt-embed", { timeout: 10000 });
    await settle(1800);
    const sent = asked.find((u) => u.includes(api));
    check(`${id}: asks the server for this competitor only`, Boolean(sent && sent.includes(`competitor_id=${first}`)), sent || "no request");
    check(`${id}: no competitor menu inside the page`, !(await page.$(`#pt-embed ${menuSel}`)));
    const text = (await page.textContent("#pt-embed")).trim();
    check(`${id}: shows something (rows or a plain empty state)`, text.length > 10, text.slice(0, 90));
    check(`${id}: the tab is marked as open`, (await page.getAttribute(`[data-pt-tab="${id}"]`, "aria-selected")) === "true");
    await page.screenshot({ path: OUT + shot, fullPage: true });
    return text;
  };
  await tabCheck("gaps", "link-gaps", "#cg-filter", "tab-gaps-1440.png");
  await tabCheck("pairs", "page-pairs", "#cp-filter", "tab-pairs-1440.png");
  // A pair opens inside the page, and its Back returns to this competitor's list.
  const compare = await page.$("#pt-embed [id^='cp-open-']");
  if (compare) {
    await compare.click();
    await page.waitForSelector("#pt-embed #cp-back", { timeout: 15000 }).catch(() => {});
    check("pairs: Compare opens the pair inside the page", Boolean(await page.$("#pt-embed #cp-back")) && Boolean(await page.$("#cl-profile-title")));
    await page.screenshot({ path: OUT + "tab-pairs-detail-1440.png", fullPage: true });
    await page.click("#pt-embed #cp-back");
    await settle(1200);
    check("pairs: Back returns to this competitor's pairs", !(await page.$("#pt-embed #cp-back")) && Boolean(await page.$("#pt-embed [id^='cp-open-']")));
  } else check("pairs: has a pair to open", false);
  await tabCheck("ai", "ai-watch", "#ca-rival", "tab-ai-1440.png");
  // Link gaps' own chips work inside the page.
  await page.click('[data-pt-tab="gaps"]');
  await page.waitForSelector("#pt-embed", { timeout: 10000 });
  await settle(1800);
  const chip = await page.$('#pt-embed [data-cg-shared="2"]');
  if (chip) {
    await chip.click();
    await settle(600);
    check("gaps: Shared links chip works in here", (await page.getAttribute('#pt-embed [data-cg-shared="2"]', "aria-pressed")) === "true");
  } else check("gaps: an empty state offers Upload a CSV", Boolean(await page.$("#pt-embed [data-cg-upload]")));
  // Keyboard: arrows move along the tabs, into and out of the new ones.
  await page.focus('[data-pt-tab="map"]');
  await page.keyboard.press("ArrowRight");
  await settle(1500);
  check("keyboard: ArrowRight from Site map opens Link gaps", (await page.getAttribute('[data-pt-tab="gaps"]', "aria-selected")) === "true" && Boolean(await page.$("#pt-embed")));
  await page.keyboard.press("End");
  await settle(1500);
  check("keyboard: End opens AI", (await page.getAttribute('[data-pt-tab="ai"]', "aria-selected")) === "true");
  await page.keyboard.press("Home");
  await settle(600);
  check("keyboard: Home goes back to Changes, no embedded screen left", (await page.getAttribute('[data-pt-tab="changes"]', "aria-selected")) === "true" && !(await page.$("#pt-embed")));

  // The collective Link gaps tab is whole again after the profile.
  asked.length = 0;
  await page.click("[data-cl-back]");
  await page.waitForSelector(".cs-cards", { timeout: 20000 });
  await page.click('[data-comp-tab="gaps"]');
  await settle(2500);
  const collective = asked.filter((u) => u.includes("link-gaps")).pop() || "";
  check("the Competitors Link gaps tab asks for every competitor", collective !== "" && !collective.includes("competitor_id"), collective);

  // ---- 1600 px: cards open, no rail Open; folding them brings it -------------------------------------------------
  await run(() => { try { localStorage.removeItem("seocc-cs-slim"); } catch { /* no storage */ } });
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("about:blank");
  await page.goto(SCREEN);
  await page.waitForSelector(".cs-cards .cs-card[data-cs-card]", { timeout: 20000 });
  await settle(1500);
  check("1600: the cards start open, with their own Open link", !(await page.$(".cs-bench-slim")) && Boolean(await page.$(".cs-card-open")) && !(await page.$(".cs-rail-open")));
  await page.screenshot({ path: OUT + "rail-1600-open.png" });
  await page.click("[data-cs-slim]");
  await settle(600);
  check("1600: folded by hand, every logo has its Open", (await page.$$eval(".cs-card[data-cs-card] > .cs-rail-open", (b) => b.length)) === ids.length);
  // Keyboard: Tab from the logo lands on its Open, Enter opens the page.
  await page.focus(`${card} .cs-card-pick`);
  await page.keyboard.press("Tab");
  await settle(300);
  const focused = await run(() => ({ open: document.activeElement?.classList.contains("cs-rail-open"), opacity: getComputedStyle(document.activeElement).opacity }));
  check("keyboard: Tab from a logo reaches its Open, and it shows", focused.open && Number(focused.opacity) === 1, JSON.stringify(focused));
  await page.screenshot({ path: OUT + "rail-1600-folded-focus.png" });
  await page.keyboard.press("Enter");
  await page.waitForSelector("#cl-profile-title", { timeout: 20000 }).catch(() => {});
  check("keyboard: Enter on the rail's Open opens the page", Boolean(await page.$("#cl-profile-title")));
  await settle();
  await page.click('[data-pt-tab="pairs"]');
  await settle(1800);
  await page.screenshot({ path: OUT + "tab-pairs-1600.png", fullPage: true });
  await page.click('[data-pt-tab="gaps"]');
  await settle(1800);
  await page.screenshot({ path: OUT + "tab-gaps-1600.png", fullPage: true });
  await page.click('[data-pt-tab="ai"]');
  await settle(1800);
  await page.screenshot({ path: OUT + "tab-ai-1600.png", fullPage: true });
  await run(() => { try { localStorage.removeItem("seocc-cs-slim"); } catch { /* no storage */ } });

  // ---- French -----------------------------------------------------------------------------------------------------
  await page.setViewportSize({ width: 1440, height: 950 });
  await menu(page, "lang");
  await settle(1500);
  const labels = await page.$$eval("[data-pt-tab]", (b) => b.slice(-3).map((x) => x.textContent.trim()));
  check("French: the three tabs are named in French", labels.join("|") === "Liens manquants|Page contre page|IA", labels.join("|"));
  await page.click('[data-pt-tab="gaps"]');
  await settle(1800);
  await page.screenshot({ path: OUT + "fr-tab-gaps-1440.png", fullPage: true });
  await page.click('[data-pt-tab="pairs"]');
  await settle(1800);
  await page.screenshot({ path: OUT + "fr-tab-pairs-1440.png", fullPage: true });
  await page.click('[data-pt-tab="ai"]');
  await settle(1800);
  await page.screenshot({ path: OUT + "fr-tab-ai-1440.png", fullPage: true });
  await page.goto("about:blank");
  await page.goto(SCREEN);
  await page.waitForSelector(".cs-cards .cs-card[data-cs-card]", { timeout: 20000 });
  await settle(1500);
  await page.hover(`${card} .cs-card-pick`);
  await settle(400);
  const fr = await look();
  check("French: the two tooltips are in French", /^Ouvrir la page de /.test(fr.tip) && /changements/.test(fr.pickTip), `${fr.pickTip} | ${fr.tip}`);
  await page.screenshot({ path: OUT + "fr-rail-1440.png" });

  // ---- a phone: no rail (the cards sit in a row with their own Open) --------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(800);
  check("phone: the rail's Open isn't shown (cards have their own)", await run(() => [...document.querySelectorAll(".cs-rail-open")].every((b) => getComputedStyle(b).display === "none")));
  await page.screenshot({ path: OUT + "fr-rail-390.png" });
  await page.click(`${card} .cs-card-open`);
  await page.waitForSelector("#cl-profile-title", { timeout: 20000 });
  await settle();
  await page.click('[data-pt-tab="gaps"]');
  await settle(1800);
  check("phone: no sideways scroll on the page with Link gaps open", !(await run(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await page.screenshot({ path: OUT + "fr-tab-gaps-390.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 950 }); // the account menu is in the side menu, which a phone folds away
  await menu(page, "lang"); // back to English
  await settle(1500);
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(800);
  await page.click('[data-pt-tab="ai"]');
  await settle(1800);
  check("phone: no sideways scroll with AI open", !(await run(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await page.screenshot({ path: OUT + "tab-ai-390.png", fullPage: true });
  await page.click('[data-pt-tab="pairs"]');
  await settle(1800);
  check("phone: no sideways scroll with Page vs page open", !(await run(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await page.screenshot({ path: OUT + "tab-pairs-390.png", fullPage: true });

  // ---- touch: a laptop-wide touch screen has no hover, so every Open stays shown and a tap opens the page --------
  const touch = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true, isMobile: true });
  const tp = await touch.newPage();
  tp.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await tp.goto(SCREEN);
  await tp.waitForSelector(".cs-cards .cs-card[data-cs-card]", { timeout: 20000 });
  await tp.waitForTimeout(1500);
  const shown = await tp.$$eval(".cs-card[data-cs-card] > .cs-rail-open", (b) => b.map((x) => getComputedStyle(x).opacity));
  check("touch: every Open on the rail is shown without hover", shown.length === ids.length && shown.every((o) => Number(o) === 1), shown.join(","));
  await tp.screenshot({ path: OUT + "rail-touch-1280.png" });
  await tp.tap(`${card} > .cs-rail-open`);
  await tp.waitForSelector("#cl-profile-title", { timeout: 20000 }).catch(() => {});
  check("touch: a tap on Open opens the page", Boolean(await tp.$("#cl-profile-title")));
  await touch.close();

  const real = problems.filter((p) => !/status of 404/.test(p));
  check("no errors in the browser", real.length === 0, real.slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
  process.exit(bad ? 1 : 0);
})();
