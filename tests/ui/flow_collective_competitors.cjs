// The collective competitor view, driven by hand like a normal user, with the mistakes a hurried person makes.
// Needs the real app on a fake internet: DB_NAME_TEST=test_collective_test .venv/bin/python tests/ui/app_server.py --port 8217
// Usage: node tests/ui/flow_collective_competitors.cjs [folder for screenshots]
const { open } = require("./pw.cjs");

const ROOT = process.env.SCREENS_URL || "http://127.0.0.1:8210/";
const SHOTS = process.argv[2];
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `: ${JSON.stringify(detail)}`}`); };

async function session(opts = {}) {
  const s = await open({ width: 1440, height: 1000, ...opts });
  s.bad = [];
  s.page.on("request", (r) => { if (/site_id=(all|NaN|null|undefined)|\/(all|NaN)\//.test(r.url())) s.bad.push(r.url()); });
  s.page.on("response", (r) => { if (r.status() >= 400 && !/api\/logos|api\/auth\/me/.test(r.url())) s.bad.push(`${r.status()} ${r.url()}`); });
  return s;
}
const fresh = async (page, hash = "competitors") => { await page.goto("about:blank"); await page.goto(`${ROOT}#${hash}`); };
// Every section has answered, or the whole tab is the "no competitors" message.
const summaryReady = (page) => page.waitForFunction(() => {
  const body = document.querySelector("#comp-body");
  if (!body || body.textContent.includes("Loading…") || body.textContent.includes("Chargement…")) return false;
  const answered = (id, full) => document.querySelector(`#cs-${id} ${full}, #cs-${id} .empty`);
  return document.querySelector("#cs-rivals") ? answered("rivals", "table") && answered("keywords", "table") && answered("moves", ".rows") && answered("links", "table") : body.querySelector(".empty");
}, null, { timeout: 15000 });
const picked = (page) => page.$eval("#comp-site", (x) => x.options[x.selectedIndex].textContent.trim());
const menu = (page) => page.evaluate(() => window.UI.siteHostPicked());
const route = (page) => page.evaluate(() => location.hash);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const sitesCount = (page) => page.$eval("#cs-rivals-table", (t) => [...t.querySelectorAll("tbody tr[data-cs-row]")].map((r) => [r.querySelector(".kw").textContent.trim(), r.querySelectorAll(".cs-site").length]));

(async () => {
  const { browser, page, problems, bad } = await session();

  // ---- All my sites ---------------------------------------------------------------------------
  await fresh(page);
  await summaryReady(page);
  check("menu on All sites opens All my sites", (await picked(page)) === "All my sites");
  check("All my sites is the first choice", (await page.$eval("#comp-site", (x) => x.options[0].value)) === "all");
  check("no tabs at All my sites", (await page.$$("[data-comp-tab]")).length === 0);
  check("the address says summary, with no site", (await route(page)) === "#competitors/summary", await route(page));
  check("a rival on two sites shows both", JSON.stringify(await sitesCount(page)).includes('["rival-two.example",2]'), await sitesCount(page));
  await shot(page, "all");

  // ---- narrowing with the dropdown --------------------------------------------------------------
  await page.selectOption("#comp-site", { label: "site-one.example" });
  await summaryReady(page);
  check("picking a site keeps the view, on the Summary tab", (await page.getAttribute('[data-comp-tab="summary"]', "aria-selected")) === "true");
  check("the side menu follows the dropdown", (await menu(page)) === "site-one.example");
  check("the address carries the site", (await route(page)) === "#competitors/summary?site=site-one.example", await route(page));
  // One site: every row belongs to it, and the "Your sites" column is gone, since it would repeat the same site on each row (2026-11-09).
  const narrowed = await page.$eval("#cs-rivals-table", (t) => ({ sites: [...new Set([...t.querySelectorAll("tbody tr[data-cs-row]")].map((r) => r.dataset.csRowSite))], rows: t.querySelectorAll("tbody tr[data-cs-row]").length, chips: t.querySelectorAll(".cs-site").length, heads: [...t.querySelectorAll("thead th")].map((h) => h.textContent.trim()) }));
  const siteOne = await page.$eval("#comp-site", (x) => x.value);
  check("narrowed rows are only that site's, with no Your sites column", narrowed.rows > 0 && narrowed.sites.length === 1 && narrowed.sites[0] === siteOne && narrowed.chips === 0 && !narrowed.heads.includes("Your sites"), narrowed);
  await page.selectOption("#comp-site", "all");
  await summaryReady(page);
  check("back to All my sites hides the tabs", (await page.$$("[data-comp-tab]")).length === 0);
  check("the side menu goes back to All sites", (await menu(page)) === null);

  // ---- a site with nothing ------------------------------------------------------------------------
  await page.selectOption("#comp-site", { label: "site-three.example" });
  await summaryReady(page);
  // Since 2026-11-10 the line above the tabs says it and offers Find competitors, once; the card under it only keeps Add competitors.
  await page.waitForSelector("#comp-setup [data-cl-go-find]", { timeout: 10000 }).catch(() => {});
  const emptySite = await page.evaluate(() => ({ find: document.querySelectorAll("[data-cl-go-find]").length, inBanner: Boolean(document.querySelector("#comp-setup [data-cl-go-find]")), addInCard: Boolean(document.querySelector("#comp-body .empty #cl-add-open")) }));
  check("an empty site says so, and offers Find competitors", emptySite.find === 1 && emptySite.inBanner && emptySite.addInCard, emptySite);
  await shot(page, "empty-site");
  await page.click("#comp-setup [data-cl-go-find]");
  await page.waitForFunction(() => location.hash.startsWith("#competitors/find"));
  check("Find competitors opens for that site", (await picked(page)) === "site-three.example");

  // ---- the side menu drives it ----------------------------------------------------------------------
  await page.evaluate(() => { window.UI.pickSite("all"); window.UI.render(); });
  await summaryReady(page);
  check("All sites in the menu, from another tab, opens All my sites", (await picked(page)) === "All my sites" && (await route(page)) === "#competitors/summary", await route(page));
  await page.evaluate(() => { window.UI.pickSite("site-two.example"); window.UI.render(); });
  await summaryReady(page);
  check("a site in the menu narrows the same view", (await picked(page)) === "site-two.example" && (await route(page)).startsWith("#competitors/summary"), await route(page));

  // ---- addresses ---------------------------------------------------------------------------------------
  await fresh(page, "competitors/summary?site=site-two.example");
  await summaryReady(page);
  check("reload on a narrowed Summary stays narrowed", (await picked(page)) === "site-two.example" && (await menu(page)) === "site-two.example");
  await fresh(page, "competitors/summary");
  await summaryReady(page);
  check("reload on Summary stays on All my sites", (await picked(page)) === "All my sites");
  await fresh(page, "competitors/gaps?site=site-two.example");
  await page.waitForSelector('[data-comp-tab="gaps"][aria-selected="true"]');
  check("an address naming a tab and a site goes there", (await picked(page)) === "site-two.example");
  await fresh(page, "competitors/list");
  await page.waitForSelector('[data-comp-tab="summary"][aria-selected="true"]');
  check("an old address naming a tab, no site, opens one site as before", (await picked(page)) !== "All my sites", await picked(page));
  await fresh(page, "today");
  await page.click('[data-go="competitors"]');
  await summaryReady(page);
  await page.goBack();
  await page.waitForFunction(() => location.hash.startsWith("#today"), null, { timeout: 5000 }).catch(() => {});
  check("Back from Competitors goes straight to the screen before", (await route(page)).startsWith("#today"), await route(page));
  // Again with the screen already loaded once, coming from a site to All sites by way of another screen.
  await fresh(page, "competitors/list?site=site-one.example");
  await page.waitForSelector('[data-comp-tab="summary"][aria-selected="true"]');
  await page.click('[data-go="today"]');
  await page.waitForFunction(() => location.hash.startsWith("#today"));
  await page.evaluate(() => { window.UI.pickSite("all"); window.UI.render(); });
  await page.click('[data-go="competitors"]');
  await summaryReady(page);
  check("the menu on All sites opens All my sites on a return visit", (await picked(page)) === "All my sites");
  await page.goBack();
  await page.waitForFunction(() => location.hash.startsWith("#today"), null, { timeout: 5000 }).catch(() => {});
  check("Back on a return visit doesn't skip the screen before", (await route(page)).startsWith("#today"), await route(page));

  // ---- opening a rival, from each of its sites -------------------------------------------------------------
  for (const host of ["site-one.example", "site-two.example"]) {
    await fresh(page);
    await summaryReady(page);
    await page.click(`#cs-rivals-table tr:has-text("rival-two.example") .cs-site:has-text("${host}")`);
    await page.waitForSelector("#cl-profile-title");
    const title = await page.$eval("#cl-profile-title", (x) => x.textContent);
    check(`the rival opens for ${host}`, title.includes("rival-two.example") && (await picked(page)) === host && (await menu(page)) === host, title);
    await page.goBack();
    await summaryReady(page);
    check(`Back from that profile returns to All my sites (${host})`, (await picked(page)) === "All my sites" && (await menu(page)) === null, await picked(page));
  }

  // ---- every other tab after leaving All my sites --------------------------------------------------------------
  await fresh(page);
  await summaryReady(page);
  await page.selectOption("#comp-site", { label: "site-one.example" });
  await summaryReady(page);
  for (const id of ["find", "check", "pairs", "gaps", "ai", "notes", "summary"]) { // "list" has no tab of its own since the merge; Keyword check is the new one
    await page.click(`[data-comp-tab="${id}"]`);
    await page.waitForFunction((tab) => document.querySelector(`[data-comp-tab="${tab}"]`)?.getAttribute("aria-selected") === "true" && !document.querySelector("#comp-body")?.textContent.includes("That didn't load"), id);
    await page.waitForTimeout(250);
    check(`tab ${id} works after All my sites`, !(await page.$eval("#comp-body", (x) => x.textContent)).includes("Not in the sample"));
  }

  // ---- switching quickly while things are still loading ------------------------------------------------------------
  await fresh(page);
  await summaryReady(page);
  let slow = true;
  await page.route("**/api/collective/**", async (r) => { if (slow && !r.request().url().includes("site_id")) await new Promise((d) => setTimeout(d, 1200)); await r.continue(); });
  await page.selectOption("#comp-site", { label: "site-one.example" });
  await page.selectOption("#comp-site", "all");
  await page.selectOption("#comp-site", { label: "site-two.example" });
  await page.waitForTimeout(1700);
  slow = false;
  await summaryReady(page);
  // At one site the rows carry their site's id (the Your sites column is hidden there), so a late All-my-sites answer would show as another id or as site icons.
  const landed = await page.$eval("#cs-rivals-table", (t) => ({ sites: [...new Set([...t.querySelectorAll("tbody tr[data-cs-row]")].map((r) => r.dataset.csRowSite))], chips: t.querySelectorAll(".cs-site").length }));
  check("a late answer never lands on the site now shown", landed.sites.length === 1 && landed.sites[0] === (await page.$eval("#comp-site", (x) => x.value)) && landed.chips === 0 && (await picked(page)) === "site-two.example", landed);
  await page.unroute("**/api/collective/**");

  // ---- adding a link for one site -------------------------------------------------------------------------------------
  await fresh(page);
  await summaryReady(page);
  // Any domain that's a good gap for two sites at once: which ones those are depends on the demo data.
  const domain = await page.evaluate(async () => (await (await fetch("api/collective/links")).json()).gaps.find((g) => g.sites.filter((x) => x.quality === "good" && !x.in_consideration).length >= 2).domain);
  const domainRow = `#cs-links-table tr:has-text("${domain}")`;
  const [first, second] = await page.$$eval(`${domainRow} [data-cs-add-host]`, (x) => x.map((b) => b.dataset.csAddHost));
  const secondId = await page.getAttribute(`${domainRow} [data-cs-add-host="${second}"]`, "data-cs-add-site");
  const add = `${domainRow} [data-cs-add-host="${second}"]`;
  const onServer = () => page.evaluate(async ([id, d]) => (await (await fetch(`api/prospects?site_id=${id}`)).json()).prospects.filter((p) => p.domain === d).length, [secondId, domain]);
  await page.dblclick(add);
  await page.waitForSelector(`${domainRow} li:has-text("${second}") .cp-yours`);
  check("added for the chosen site only, even on a double click", Boolean(await page.$(`${domainRow} [data-cs-add-host="${first}"]`)) && !(await page.$(add)), domain);
  check("one prospect on the server", (await onServer()) === 1, await onServer());
  await shot(page, "added");
  await page.click('.toast button:has-text("Undo")');
  await page.waitForSelector(add);
  check("Undo gives the Add button back", true);
  check("Undo removes it from the server", (await onServer()) === 0, await onServer());
  await page.click(".cs-flagged > summary");
  check("spam stays visible, with no Add button", (await page.$$("#cs-flagged-table tbody tr")).length > 0 && (await page.$$("#cs-flagged-table [data-cs-add]")).length === 0);
  await shot(page, "flagged");

  // ---- things that can go wrong -------------------------------------------------------------------------------------------
  await page.route("**/api/collective/keywords**", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "It fell over." }) }));
  await fresh(page);
  await page.waitForSelector("#cs-keywords [data-cs-retry]");
  await page.waitForSelector("#cs-rivals-table");
  check("one section failing leaves the rest working", Boolean(await page.waitForSelector("#cs-links-table", { timeout: 10000 }).catch(() => null)) && Boolean(await page.$("#cs-moves .rows")));
  await shot(page, "section-failed");
  await page.unroute("**/api/collective/keywords**");
  await page.click("#cs-keywords [data-cs-retry]");
  await page.waitForSelector("#cs-keywords-table");
  check("Try again brings the section back", true);
  bad.length = 0; problems.length = 0;

  const none = (extra) => (r) => r.request().url().includes("/collective/") ? extra(r) : r.continue();
  await page.route("**/api/collective/rivals**", async (r) => { const a = await (await r.fetch()).json(); a.coverage = { keywords: 5, checked: 0, tools: [], newest: null, oldest: null }; a.rivals.forEach((x) => Object.assign(x, { compared: 0, ranks_on: null, they_ahead: null, i_ahead: null, level: null, not_found: null })); await r.fulfill({ json: a }).catch(() => {}); }); // a request still in flight when the routes are taken away below (the setup banner asks for this too) is dropped, not an error
  await page.route("**/api/collective/keywords**", none((r) => r.fulfill({ json: { sites: [], coverage: { keywords: 5, checked: 0, tools: [], newest: null, oldest: null }, total: 0, keywords: [] } })));
  await page.route("**/api/collective/moves**", none((r) => r.fulfill({ json: { sites: [], days: 30, total: 0, moves: [], blocked: ["cafe-monde.example"], not_started: ["new.example"] } })));
  await page.route("**/api/collective/links**", none((r) => r.fulfill({ json: { sites: [], gaps: [], flagged: [], funnel: { found: 0, good: 0, flagged: 0, checking: 0, shared: 0 }, rivals_total: 3, rivals_with_data: 0 } })));
  await fresh(page);
  await summaryReady(page);
  const cells = await page.$$eval("#cs-rivals-table tbody tr[data-cs-row] td.c", (x) => x.map((c) => c.textContent.trim()));
  check("no checks shows —, never 0", cells.length >= 2 && cells.slice(0, 2).every((c) => c === "—"), cells); // the merged table has two keyword cells (Ranks on your keywords, Who leads); the third is edits, which is known here
  const cards = await page.$$eval("#cs-tiles .cs-jump", (x) => x.map((c) => c.getAttribute("aria-label")));
  check("number cards say — when nothing is known, never 0", cards[1].endsWith("—") && cards[3].endsWith("—"), cards);
  check("a real zero stays 0: one rival here is being read and hasn't changed", cards[2].endsWith(": 0"), cards);
  // Since 2026-11-09 the one "what's missing" line above the tabs (comp-setup.js) says what to do; this box only says what it will show, with no button of its own.
  const noChecks = await page.$eval("#cs-keywords", (x) => ({ title: x.querySelector(".empty h3")?.textContent.trim(), buttons: x.querySelectorAll(".empty button, .empty a").length }));
  check("no checks says so in one box, with no second instruction", noChecks.title === "No ranking check yet" && noChecks.buttons === 0, noChecks);
  check("a blocked rival is named when nothing moved", (await page.$eval("#cs-moves", (x) => x.textContent)).includes("cafe-monde.example"));
  await shot(page, "no-data");
  await page.click("#cs-links [data-cs-review]");
  await page.waitForSelector('[data-comp-tab="gaps"][aria-selected="true"]');
  check("Open Link gaps from All my sites lands on a real site", (await picked(page)) !== "All my sites");
  await page.unrouteAll({ behavior: "ignoreErrors" });

  await page.route("**/api/links/sites", async (r) => { const a = await (await r.fetch()).json(); a.sites = a.sites.slice(0, 1); r.fulfill({ json: a }); });
  await fresh(page);
  await page.waitForSelector("#comp-site");
  await page.waitForTimeout(500);
  check("one site has no All my sites choice", !(await page.$$eval("#comp-site option", (o) => o.map((x) => x.value))).includes("all"));
  check("one site still has its Summary tab", Boolean(await page.$('[data-comp-tab="summary"]')));
  await page.unrouteAll();

  // ---- keyboard only -----------------------------------------------------------------------------------------------------------
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fresh(page);
  await summaryReady(page);
  await page.focus('[data-cs-jump="links"]');
  await page.keyboard.press("Enter");
  check("a number card moves the keyboard to its section", (await page.evaluate(() => `${document.activeElement.tagName}:${document.activeElement.textContent.trim()}`)) === "H2:Links many competitors share"); // the heading now ends with its (i) button, an icon with no words
  await page.focus("#comp-site");
  await page.selectOption("#comp-site", { label: "site-one.example" });
  await summaryReady(page);
  check("the dropdown keeps focus after a change", (await page.evaluate(() => document.activeElement.id)) === "comp-site" && (await picked(page)) !== "All my sites");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // ---- every look, language and width ---------------------------------------------------------------------------------------------
  await fresh(page);
  await summaryReady(page);
  for (const [theme, lang] of [["light", "en"], ["dark", "en"], ["light", "fr"], ["dark", "fr"]]) {
    await page.evaluate(([th, la]) => { window.UI.state.theme = th; window.UI.state.lang = la; window.UI.render(); }, [theme, lang]);
    await summaryReady(page);
    for (const width of [390, 640, 641, 860, 861, 1240, 1241, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);
      const fit = await page.evaluate(() => {
        const main = document.querySelector("#main") || document.documentElement;
        const cut = [...document.querySelectorAll("#comp-body td, #comp-body td *, #comp-body .tile")].filter((c) => {
          if (!c.getClientRects().length || c.getBoundingClientRect().right <= innerWidth + 1) return false;
          // Tablet widths may scroll inside the table's own box, with the app's edge cue. Nowhere else.
          const wrap = c.closest(".table-wrap");
          return !(innerWidth <= 860 && innerWidth > 640 && wrap && getComputedStyle(wrap).overflowX === "auto" && wrap.classList.contains("more-right"));
        }).length;
        const squeezed = [...document.querySelectorAll("#comp-body .cs-site")].filter((c) => c.getClientRects().length && c.getBoundingClientRect().height > 60).length;
        const small = [...document.querySelectorAll("#comp-body *")].filter((c) => c.children.length === 0 && c.textContent.trim() && c.getClientRects().length && parseFloat(getComputedStyle(c).fontSize) < 12 && !c.closest(".site-logo, .logo, [class*=logo-letter]")).length;
        return { sideways: document.documentElement.scrollWidth > innerWidth + 1 || main.scrollWidth > main.clientWidth + 1, cut, small, squeezed };
      });
      check(`${theme} ${lang} ${width}px fits`, !fit.sideways && !fit.cut && !fit.small && !fit.squeezed, fit);
      if (width === 390 || width === 1440) await shot(page, `${theme}-${lang}-${width}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  check("nothing ever asked the server for site_id=all, and no request failed", bad.length === 0, bad);
  check("no page errors", problems.filter((p) => !p.includes("Failed to load resource")).length === 0, problems);
  await browser.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e.message.split("\n").slice(0, 3).join(" ")); process.exit(1); });

