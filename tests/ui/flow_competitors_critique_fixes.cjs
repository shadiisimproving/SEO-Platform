// The UI critique of 2026-11-12, Competitors and Link gaps (Track 2), driven like a normal user:
//  1. opening a competitor from All my sites keeps the side menu on All sites; the profile names its site; Back returns to All my sites;
//  2. Link gaps fits its card at 1440 px: Strength, Links, Status, a ⋯ per row; Mark as spam in the picked bar and the ⋯;
//  3. spam on a domain In consideration takes it off the list, the toast says so, and Undo puts both back;
//  4. ?simple=1: Link gaps has one search, the competitor menu and one Filter button; five data columns; tabs behind More;
//  5. the "Your sites" column names each site; the competitor's name is a real button.
//   DB_NAME_TEST=test_uifix_t2_test .venv/bin/python tests/ui/app_server.py --port 8260
//   node tests/ui/flow_competitors_critique_fixes.cjs http://127.0.0.1:8260/ [folder for screenshots]
const { open, menu } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = (process.argv[2] || "http://127.0.0.1:8260/").replace(/\/?$/, "/");
const OUT = (process.argv[3] || path.resolve("var/ui-competitors-critique")) + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  const settle = (ms = 900) => page.waitForTimeout(ms);
  const appSite = () => page.evaluate(() => UI.state.site);

  // ---- 1. the profile keeps the side menu's site --------------------------------------------------------------------
  await page.goto(BASE + "#competitors/summary");
  await page.waitForSelector("#cs-rivals-table tbody tr .cs-rival-open", { timeout: 20000 }); await settle();
  check("starts on All sites", (await appSite()) === "all" && (await page.evaluate(() => COMP.siteId)) === "all");
  const siteCells = await page.locator("#cs-rivals-table .cs-site").allTextContents();
  check("Your sites names each site, not a letter", siteCells.length > 0 && siteCells.every((x) => /\.example$/.test(x.trim())), siteCells.slice(0, 3).join(" | "));
  check("the competitor's name is a real button", (await page.locator("#cs-rivals-table .cs-rival-open").first().evaluate((el) => el.tagName)) === "BUTTON");
  await page.screenshot({ path: OUT + "1-list-all-sites.png" });
  await page.locator("#cs-rivals-table tbody tr .cs-rival-open").first().click();
  await page.waitForSelector("#cl-profile-title", { timeout: 15000 }); await settle();
  check("opening a competitor leaves the side menu on All sites", (await appSite()) === "all");
  const chip = (await page.locator("#comp-scope").textContent().catch(() => "")).trim();
  check("the profile names its own site in a chip", /^For .+\.example$/.test(chip), chip);
  check("no local site menu while the profile has its own site", (await page.locator("#comp-site").count()) === 0);
  check("the address carries no site", !/site=/.test(await page.evaluate(() => location.hash)));
  await page.screenshot({ path: OUT + "2-profile-own-site.png" });
  await page.goBack(); await settle(1500); // the browser's Back
  check("Back returns to the list", (await page.locator("#cs-rivals-table").count()) === 1 && (await page.locator("#cl-profile-title").count()) === 0);
  check("…with All sites still picked", (await appSite()) === "all" && (await page.evaluate(() => COMP.siteId)) === "all");

  // ---- the verdict badge and the Activity table -----------------------------------------------------------------------
  await page.locator("#cs-rivals-table tbody tr .cs-rival-open").first().click();
  await page.waitForSelector("#cl-profile-title", { timeout: 15000 }); await settle();
  const answer = (await page.locator(".pt-answer").textContent().catch(() => "")).replace(/\s+/g, " ").trim();
  check("no packed sentence over the cards", !/beat you on|of \d+ shared keywords|published/i.test(answer), answer);
  // 2026-11-20: what changed left Activity for the profile's first tab, Changes, which is the one open.
  await page.click('[data-pt-tab="changes"]'); await settle();
  const firstCard = (await page.locator(".pt-panel section.card h2").first().textContent()).trim();
  check("the Changes tab starts with what changed", firstCard === "What changed", firstCard);
  await page.click('[data-pt-tab="activity"]'); await settle();
  const sentence = await page.evaluate(() => [...document.querySelectorAll(".pt-panel .pt-lead")].map((p) => p.textContent).join(" "));
  check("Activity has no sentence of numbers", !/They added|Last 30 days|they made/i.test(sentence), sentence);
  check("Activity shows a You/Them table", (await page.locator(".pt-side-table tr.pt-row-them").count()) >= 1);
  await page.click('[data-pt-tab="questions"]'); await settle();
  check("their questions have their own tab", (await page.locator(".pt-panel h2", { hasText: "Questions they answer" }).count()) === 1);
  await page.click('[data-pt-tab="site"]'); await settle();
  const aheadBg = await page.evaluate(() => [...document.querySelectorAll(".pt-side-ahead")].map((el) => ({ who: el.classList.contains("pt-side-them") ? "them" : "you", bg: getComputedStyle(el).backgroundColor })));
  const purple = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--c-purple-pale").trim());
  check("a side ahead is coloured by whose it is", aheadBg.every((x) => x.who === "you" || x.bg !== "rgb(232, 243, 251)"), JSON.stringify(aheadBg) + " " + purple);
  await page.screenshot({ path: OUT + "3-their-site.png", fullPage: true });
  await page.click('[data-comp-tab="gaps"]'); await settle(1500);
  check("choosing Link gaps from that profile picks its site, by that click", (await appSite()) !== "all" && (await page.locator("#cg-table, #comp-body .empty").count()) >= 1);

  // ---- 2. Link gaps fits its card ------------------------------------------------------------------------------------
  await page.goto(BASE + "#competitors/gaps?site=site-one.example"); await page.waitForSelector("#cg-table", { timeout: 20000 }); await settle();
  const fit = await page.evaluate(() => { const w = document.querySelector("#cg-table").closest(".table-wrap"); return { scroll: w.scrollWidth, client: w.clientWidth, page: document.documentElement.scrollWidth - innerWidth }; });
  check("1440 px: the table fits its card, no sideways scroll", fit.scroll <= fit.client + 1 && fit.page <= 1, JSON.stringify(fit));
  const heads = (await page.locator("#cg-table > thead th").allTextContents()).map((x) => x.trim()).filter((x) => x && x !== "Action");
  check("columns: Domain, Links to, Strength, Links, Status", heads.join() === "Domain,Links to,Strength,Links,Status", heads.join(" | "));
  check("no Mark as spam column on the rows", (await page.locator("#cg-table .cg-spam-btn").count()) === 0);
  await page.screenshot({ path: OUT + "4-gaps-1440.png" });

  // ---- 3. spam on a domain In consideration -------------------------------------------------------------------------
  const free = page.locator("#cg-table tbody tr[data-cg-row]:not(.cg-off)").first();
  const domain = await free.getAttribute("data-cg-row");
  await free.locator("[data-cg-pick]").check(); await settle(300);
  check("the picked bar has Mark as spam", (await page.locator(".cg-selbar [data-cg-spam-picked]").count()) === 1);
  await page.click("#cg-add"); await settle(1500);
  const row = page.locator(`#cg-table tr[data-cg-row="${domain}"]`);
  check("added: the row says In consideration", /In consideration/.test(await row.textContent()));
  await row.locator("[data-cg-menu]").scrollIntoViewIfNeeded(); await settle(500); // a scroll closes an open menu, so scroll first
  await row.locator("[data-cg-menu]").click(); await settle(300);
  const menuText = await page.locator("#popover").textContent();
  check("the row's ⋯ has Edit and Mark as spam, and says it takes it off the list", /Edit/.test(menuText) && /Mark as spam/.test(menuText) && /Takes it off In consideration/.test(menuText), menuText.replace(/\s+/g, " "));
  await page.locator('#popover [data-cg-decide="spam"]').click(); await settle(1500);
  const after = await row.locator("td").nth(5).textContent();
  check("after spam: Spam, never In consideration with it", /Spam/.test(after) && !/In consideration/.test(after), after.replace(/\s+/g, " ").trim());
  const toast = page.locator(".toast", { hasText: domain }).last();
  check("the toast says it was taken off In consideration, with Undo", /taken off In consideration/.test(await toast.textContent()) && (await toast.locator("[data-undo]").count()) === 1, (await toast.textContent()).trim());
  check("it left the In consideration list", await page.evaluate((d) => !window.PROSPECTS.some((p) => p.domain === d), domain));
  await page.screenshot({ path: OUT + "5-spam-toast.png" });
  await toast.locator("[data-undo]").click(); await settle(1800);
  const undone = await page.locator(`#cg-table tr[data-cg-row="${domain}"] td`).nth(5).textContent();
  check("Undo puts both back: In consideration, not Spam", /In consideration/.test(undone) && !/Spam/.test(undone), undone.replace(/\s+/g, " ").trim());
  check("…and back on the In consideration list", await page.evaluate((d) => window.PROSPECTS.some((p) => p.domain === d), domain));

  // ---- phone and dark, default mode -----------------------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 }); await settle(600);
  check("390 px: no sideways scroll on Link gaps", (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
  await page.screenshot({ path: OUT + "6-gaps-phone.png" });
  await page.setViewportSize({ width: 1440, height: 900 }); await settle(300);
  await menu(page, "theme"); await settle(500);
  await page.screenshot({ path: OUT + "7-gaps-dark.png" });
  await menu(page, "theme"); await settle(300);

  // ---- 4. ?simple=1 ----------------------------------------------------------------------------------------------------
  await page.goto(BASE + "?simple=1#competitors/gaps?site=site-one.example"); await page.waitForSelector("#cg-table", { timeout: 20000 }); await settle();
  const tools = await page.evaluate(() => [...document.querySelectorAll(".cg-tools input, .cg-tools select, .cg-tools button")].filter((el) => el.offsetParent && !el.closest("[data-tp-clear]") && !el.matches("[data-tp-clear]")).map((el) => el.id || el.dataset.tpSearch !== undefined && "search" || el.className));
  check("simple: one search, the competitor menu and one Filter button", tools.length === 3 && tools.includes("cg-filter") && tools.includes("cg-filters"), tools.join(" | "));
  check("simple: Upload links and Add a domain are in the head", (await page.locator("#topbar #cg-upload-head").count()) === 1 && (await page.locator("#topbar #cg-add-domain-head").count()) === 1);
  const dataCols = (await page.locator("#cg-table > thead th").allTextContents()).map((x) => x.trim()).filter((x) => x && x !== "Action");
  check("simple: five data columns or fewer", dataCols.length <= 5, dataCols.join(" | "));
  await page.locator("#cg-filters").scrollIntoViewIfNeeded(); await settle(400);
  await page.click("#cg-filters"); await settle(300);
  check("Filter holds Links to, Page Authority, the spam choice and Hide added", (await page.locator("#popover #cg-reach, #popover #cg-pa, #popover [data-cg-quality], #popover #cg-hide").count()) === 6);
  await page.selectOption("#popover #cg-pa", "10"); await settle(500);
  check("a filter change keeps the box open and focus on it", (await page.locator("#popover.cg-filter-pop").count()) === 1 && (await page.evaluate(() => document.activeElement?.id)) === "cg-pa");
  check("the Filter button counts what's on", /1/.test(await page.locator("#cg-filters").textContent()));
  await page.screenshot({ path: OUT + "8-simple-filter.png" });
  await page.click("#popover [data-cg-unfilter]"); await settle(400);
  await page.keyboard.press("Escape"); await settle(200);
  const sfit = await page.evaluate(() => { const w = document.querySelector("#cg-table").closest(".table-wrap"); return w.scrollWidth - w.clientWidth; });
  check("simple 1440 px: the table fits", sfit <= 1, sfit);
  // 2026-11-16, the owner: "remove the More section, make the tabs normally": every tab sits in the row, no More.
  check("simple: every tab in the row, no More", (await page.locator(".comp-tabs [data-comp-tab]").count()) >= 4 && (await page.locator("#comp-tabs-more").count()) === 0);
  await page.screenshot({ path: OUT + "9-simple-gaps.png" });
  await page.setViewportSize({ width: 390, height: 844 }); await settle(600);
  check("simple 390 px: no sideways scroll", (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
  await page.screenshot({ path: OUT + "10-simple-gaps-phone.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await menu(page, "theme"); await settle(500);
  // Since 2026-11-16 the simpler Competitors screen is cards (one per competitor), folded to logos under 1600 px until
  // opened: the flow opens them, and a card's Open opens the profile.
  await page.goto(BASE + "?simple=1#competitors/summary"); await page.waitForSelector(".cs-card[data-cs-card]", { timeout: 20000 }); await settle();
  if (await page.$(".cs-bench-slim")) { await page.click("[data-cs-slim]"); await settle(); }
  await page.locator(".cs-card[data-cs-card] .cs-card-open").first().click(); await page.waitForSelector("#cl-profile-title", { timeout: 15000 }); await settle();
  check("simple: the profile keeps All sites too", (await appSite()) === "all" && /^For /.test((await page.locator("#comp-scope").textContent().catch(() => "")).trim()));
  await page.screenshot({ path: OUT + "11-simple-profile-dark.png" });
  await page.click('[data-comp-tab="summary"]'); await settle(1500);
  check("the Competitors tab goes back to the cards, still on All sites", (await page.locator(".cs-card[data-cs-card]").count()) > 0 && (await appSite()) === "all" && (await page.evaluate(() => COMP.siteId)) === "all");
  await menu(page, "theme"); await settle(300);

  const real = problems.filter((p) => !/Failed to load resource|status of 404/.test(p));
  check("no console errors", real.length === 0, real.slice(0, 3).join(" / "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
