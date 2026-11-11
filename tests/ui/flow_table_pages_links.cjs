// The Backlinks and Site health tables work like every long table (2026-11-10): pages of 25 / 50 / 100 with Previous, Next
// and page numbers, the real total, a search that filters as you type, the table's own filters, and sorted headings.
// The demo world has few rows, so long made-up lists are added to the screens' answers (made-up sites only).
//   DB_NAME_TEST=seo_cc_f_test .venv/bin/python tests/ui/app_server.py --port 8282
//   node tests/ui/flow_table_pages_links.cjs http://127.0.0.1:8282/
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8282/";
const OUT = path.resolve("var/ui-table-pages-links") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${String(extra).slice(0, 220)}]` : ""}`); };
const day = (n) => new Date(Date.UTC(2026, 10, 10) - n * 864e5).toISOString().replace(/\.\d+Z$/, "Z");

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const wait = (ms) => page.waitForTimeout(ms);

  // ---- long made-up lists, added to what the demo answers -----------------------------------------------
  await page.route(/\/api\/backlinks\?site_id=1$/, async (route) => {
    const res = await route.fetch(); const d = await res.json();
    const base = d.backlinks.find((b) => b.status === "live") || d.backlinks[0];
    const row = (i, extra) => ({ ...base, id: 10000 + i, source_url: `https://made-up-${i}.example/post-${i}`, domain: `made-up-${i}.example`, anchor: `anchor ${i}`, keyword: null, mediator: i % 3 ? "LinkAgency" : "Nour Media", authority: (i * 7) % 90, check: { ...base.check, verdict: null, reasons: [] }, ...extra });
    for (let i = 0; i < 300; i++) d.backlinks.push(row(i, { status: i % 4 === 0 ? "lost" : "live" }));
    for (let i = 300; i < 360; i++) d.backlinks.push(row(i, { status: "planned", sent_at: i % 2 ? "2026-11-01T10:00:00Z" : null, link_type: "Guest post", article_url: "https://docs.example/d" }));
    for (let i = 360; i < 400; i++) d.backlinks.push(row(i, { status: "found", found_by: "Search Console", mediator: null }));
    await route.fulfill({ response: res, json: d });
  });
  await page.route(/\/api\/backlinks\/reclaim\?site_id=1$/, async (route) => {
    const pages = [...Array(60).keys()].map((i) => ({ page: `https://site-one.example/old-${i}`, path: `/old-${i}`, http: i % 5 ? 404 : 410, sites: 1 + (i % 9), logged_links: 1, gsc_links: i % 4, domains: [`ref-${i}.example`, `other-${i % 7}.example`], gsc_id: 9000 + i }));
    await route.fulfill({ json: { pages } });
  });
  await page.route(/\/api\/mediators$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch(); const d = await res.json();
    for (let i = 0; i < 40; i++) d.mediators.push({ id: 7000 + i, name: `Made-up Agency ${String(i).padStart(2, "0")}`, contact: `agency${i}@made-up.example`, platform: i % 2 ? "Fiverr" : "Direct", price_text: null, notes: null, links: 0, live: 0, lost: 0, planned: 0 });
    await route.fulfill({ response: res, json: d });
  });
  await page.route(/\/api\/health\/sites\/1\/audits$/, async (route) => {
    const res = await route.fetch(); const d = await res.json();
    const base = d.audits[d.audits.length - 1];
    for (let i = 0; i < 40; i++) d.audits.push({ ...base, id: 5000 + i, created_at: day(60 + i * 30), score: 50 + (i % 40), trigger: i % 3 ? "monthly" : "button" });
    await route.fulfill({ response: res, json: d });
  });
  await page.route(/\/api\/health\/audits\/\d+$/, async (route) => {
    const res = await route.fetch(); const d = await res.json();
    if (d.internal_links) {
      const pages = [...Array(400).keys()].map((i) => ({ url: `https://site-one.example/page-${i}`, links_in: i % 12, clicks: (i * 13) % 200, impressions: 100 }));
      Object.assign(d.internal_links, { pages, pages_read: 1200, few_links: pages.slice(0, 10).map((p, i) => ({ ...p, links_in: i % 3, clicks: 300 - i * 20 })), few_links_count: 37 });
    }
    await route.fulfill({ response: res, json: d });
  });
  await page.route(/\/api\/health\/sites\/1\/indexing$/, async (route) => {
    const not = [...Array(120).keys()].map((i) => ({ url: `https://site-one.example/unseen-${i}`, state: "not_indexed", coverage: i % 3 ? "Crawled - currently not indexed" : "Discovered - currently not indexed", checked: "2026-11-09", clicks: 0 }));
    await route.fulfill({ json: { on: true, pages: 400, checked: 380, indexed: 260, not_indexed: not, not_indexed_count: 120, unchecked: 20, days_left: 1, per_day: 1200, errors: 0 } });
  });
  const SCANS = [...Array(40).keys()].map((i) => ({ id: 8000 + i, site_id: 1, host: "site-one.example", status: "complete", trigger: i % 2 ? "weekly" : "button", max_pages: null, check_external: true, stop_reason: null, stop_requested: false, pages_read: 40 + i, links_checked: 400, skipped_robots: 0, too_large: 0, pages_not_read: 0, external_not_checked: 0, external_left: 0, requests_used: 400, paused_until: null, error: null, created_at: day(i * 7), finished_at: day(i * 7), counts: { broken: 120, unverified: 30, redirect: 8, slow: 2 } }));
  await page.route(/\/api\/links\/sites\/1\/scans$/, (route) => route.fulfill({ json: { scans: SCANS } }));
  await page.route(/\/api\/links\/scans\/\d+$/, (route) => {
    const id = Number(route.request().url().match(/(\d+)$/)[1]), scan = SCANS.find((s) => s.id === id) || SCANS[0];
    const groups = [["broken", 120, 404, "Page not found"], ["unverified", 30, 403, "The site blocked the check"], ["redirect", 8, 301, "3 redirects before the final page"], ["slow", 2, 200, "Took 6.2 s to answer"]];
    const issues = groups.flatMap(([category, n, code, reason]) => [...Array(n).keys()].map((i) => ({ category, target_url: `https://site-one.example/${category}-${i}`, status_code: code, reason, pages: [`https://site-one.example/from-${i}`] })));
    route.fulfill({ json: { scan, counts: scan.counts, issues } });
  });

  const go = async (hash, w = 1440) => { await page.setViewportSize({ width: w, height: 950 }); await page.goto("about:blank"); await page.goto(`${BASE}?p=${Date.now()}#${hash}`); await wait(2500); };
  const foot = (key) => page.locator(`[data-tp-foot="${key}"]`);
  const range = async (key) => ((await foot(key).locator(".tp-range").textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  const focused = () => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName}|${a.dataset.tpKey || ""}|${a.dataset.tpStep || ""}|${a.hasAttribute("data-tp-search") ? "search" : ""}|${a.id}` : ""; });
  const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && (document.querySelector("#main")?.scrollWidth || 0) <= innerWidth + 1);
  const shot = (name, full = false) => page.screenshot({ path: OUT + name + ".png", fullPage: full });
  const clearNotes = () => page.evaluate(() => document.querySelectorAll(".toast").forEach((x) => x.remove()));

  /* The paging every table shares: Next keeps focus on Next, a page number, 100 a page, a search that keeps the cursor. */
  async function drive(name, key, rows, total, noun, term, matches) {
    check(`${name}: the footer says 1–25 of ${total} ${noun}`, (await range(key)) === `1–25 of ${total} ${noun}`, await range(key));
    check(`${name}: 25 rows on the first page`, (await page.locator(rows).count()) === 25, await page.locator(rows).count());
    await foot(key).locator('[data-tp-step="next"]').click(); await wait(400);
    if (total > 50) {
      check(`${name}: Next shows 26–50, focus stays on Next`, (await range(key)).startsWith("26–50") && /\|next\|/.test(await focused()), `${await range(key)} ${await focused()}`);
      await foot(key).locator('.tp-num[data-tp-page="2"]').click(); await wait(400);
      check(`${name}: page 3 starts at 51`, (await range(key)).startsWith("51–"), await range(key));
    } else { // Next leads to the last page: Next is off there, so focus goes to the page number
      check(`${name}: Next shows the last page, focus on its number`, (await range(key)).startsWith(`26–${total}`) && (await page.evaluate(() => document.activeElement?.getAttribute("aria-current"))) === "page", `${await range(key)} ${await focused()}`);
      await foot(key).locator('.tp-num[data-tp-page="0"]').click(); await wait(400);
      check(`${name}: page 1 again`, (await range(key)).startsWith("1–25"), await range(key));
    }
    await foot(key).locator("[data-tp-per]").selectOption("100"); await wait(400);
    check(`${name}: 100 a page`, (await page.locator(rows).count()) === Math.min(100, total) && (await range(key)).startsWith(`1–${Math.min(100, total)}`), await range(key));
    await foot(key).locator("[data-tp-per]").selectOption("25"); await wait(300);
    if (term) {
      const box = page.locator(`[data-tp-search][data-tp-key="${key}"]`);
      await box.click(); await box.pressSequentially(term, { delay: 30 }); await wait(600);
      check(`${name}: the search filters as you type, the cursor stays in the box`, (await range(key)).endsWith(`of ${matches} ${noun}`) && /search/.test(await focused()), `${await range(key)} ${await focused()}`);
      await page.locator(`[data-tp-clear][data-tp-key="${key}"]`).click(); await wait(400);
      check(`${name}: clearing the search brings every row back`, (await range(key)) === `1–25 of ${total} ${noun}`, await range(key));
    }
  }
  /* The floating Notes button must not sit on the footer's controls. */
  async function notesClear(key) {
    const hit = await page.evaluate((k) => {
      const fab = document.querySelector(".nb-fab")?.getBoundingClientRect(), f = document.querySelector(`[data-tp-foot="${k}"]`);
      if (!fab || !f) return "no fab or footer";
      return [...f.querySelectorAll("button, select")].filter((el) => { const r = el.getBoundingClientRect(); return r.width && !(r.right <= fab.left || r.left >= fab.right || r.bottom <= fab.top || r.top >= fab.bottom); }).map((el) => el.textContent.trim() || el.tagName).join(",");
    }, key);
    check("the Notes button covers no footer control", hit === "", hit);
  }

  // ---- Backlinks → Done, By page ----------------------------------------------------------------------
  await go("backlinks?site=site-one.example");
  await drive("By page", "bl-links", "#bl-table tbody tr[data-bl]", 305, "links", "made-up-1", 111);
  await shot("1-by-page");
  await notesClear("bl-links");
  await page.click('[data-bl-filter="lost"]'); await wait(400);
  check("By page: the Lost chip goes back to page 1 with the lost ones", /^1–25 of 77 links$/.test(await range("bl-links")), await range("bl-links"));
  await page.click('[data-bl-filter="all"]'); await wait(400);
  await page.click('[data-bl-sort="authority"]'); await wait(400);
  const auths = await page.locator("#bl-table tbody tr td:nth-child(6)").evaluateAll((c) => c.slice(0, 5).map((x) => Number(x.textContent.trim()) || 0));
  check("By page: Authority sorts biggest first, focus on the heading", auths.every((n, i) => !i || auths[i - 1] >= n) && auths[0] >= 80 && (await page.evaluate(() => document.activeElement?.dataset.blSort)) === "authority", auths.join(","));
  check("By page: the sorted heading says so", (await page.locator('th:has([data-bl-sort="authority"])').getAttribute("aria-sort")) === "descending");
  await page.click('[data-bl-sort="authority"]'); await wait(300);
  await page.click('[data-bl-sort="authority"]'); await wait(300);
  check("By page: a third click goes back to the usual order", (await page.locator('th:has([data-bl-sort="authority"])').getAttribute("aria-sort")) === "none");
  // The row still opens its panel.
  await page.locator("#bl-table tbody tr[data-bl]").first().click(); await wait(500);
  check("By page: a row still opens its panel", (await page.locator("#panel").count()) === 1);
  await page.keyboard.press("Escape"); await wait(300);

  // ---- By site ----
  await page.click('[data-vd-view="website"]'); await wait(500);
  await drive("By site", "bl-sites", "#bl-sites tbody tr", 305, "sites", "made-up-2", 111);
  await page.click('[data-bls-sort="authority"]'); await wait(400);
  const siteAuth = await page.locator("#bl-sites tbody tr td:nth-child(4)").evaluateAll((c) => c.slice(0, 5).map((x) => Number(x.textContent.trim()) || 0));
  check("By site: Authority sorts, biggest first by default", siteAuth.every((n, i) => !i || siteAuth[i - 1] >= n), siteAuth.join(","));
  await page.click('[data-bls-sort="domain"]'); await wait(400);
  const names = await page.locator("#bl-sites tbody tr [data-vd-domain]").allTextContents();
  check("By site: Site sorts A to Z", names.slice(0, 5).every((n, i, a) => !i || a[i - 1].localeCompare(n) <= 0), names.slice(0, 3).join(","));
  await shot("2-by-site");
  await page.locator('#bl-sites [data-vd-domain="made-up-10.example"]').click(); await wait(500);
  check("By site: a site opens its links By page, from page 1", (await range("bl-links")) === "1–1 of 1 links", await range("bl-links"));
  await page.click('[data-vd-domain=""]'); await wait(400);

  // ---- Found but never logged ----
  await page.click('[data-bl-tab="found"]'); await wait(500);
  check("Found: 40 made-up links, with a search", (await range("bl-found")) === "1–25 of 40 links" && (await page.locator('[data-tp-search][data-tp-key="bl-found"]').count()) === 1, await range("bl-found"));
  await foot("bl-found").locator('[data-tp-step="next"]').click(); await wait(400);
  check("Found: Next shows 26–40", (await range("bl-found")) === "26–40 of 40 links", await range("bl-found"));
  const box = page.locator('[data-tp-search][data-tp-key="bl-found"]');
  await box.click(); await box.pressSequentially("made-up-377", { delay: 30 }); await wait(600);
  check("Found: the search finds one, the cursor stays", (await range("bl-found")) === "1–1 of 1 links" && /search/.test(await focused()), await range("bl-found"));
  await box.fill(""); await wait(500);
  await shot("3-found");

  // ---- Mediators ----
  await page.click('[data-bl-tab="mediators"]'); await wait(800);
  await drive("Mediators", "bl-mediators", "#md-table tbody tr", 42, "mediators", "agency 35", 1);
  await page.click('[data-md-sort="links"]'); await wait(400);
  const links = await page.locator("#md-table tbody tr td:nth-child(4)").evaluateAll((c) => c.slice(0, 3).map((x) => Number(x.textContent.trim())));
  check("Mediators: Links sorts biggest first", links[0] >= links[1] && links[0] >= 1, links.join(","));
  await shot("4-mediators");

  // ---- Reclaim ----
  await page.click('[data-bl-tab="reclaim"]'); await wait(600);
  await drive("Reclaim", "bl-reclaim", "#rc-table tbody tr", 60, "pages", "other-3", 9);
  await page.click('[data-rc-sort="sites"]'); await wait(400);
  const sites = await page.locator("#rc-table tbody tr td:nth-child(3)").evaluateAll((c) => c.slice(0, 5).map((x) => parseInt(x.firstChild.textContent, 10)));
  check("Reclaim: Sites linking sorts biggest first", sites.every((n, i) => !i || sites[i - 1] >= n) && sites[0] === 9, sites.join(","));
  await shot("5-reclaim");

  // ---- To do ----
  await page.click('[data-bl-section="todo"]'); await wait(600);
  await drive("To do", "bl-todo", "#td-table tbody tr[id^=todo-]", 61, "links", "made-up-30", 10);
  await page.click('[data-td-sent-filter="sent"]'); await wait(400);
  check("To do: Sent shows the sent ones only, from page 1", (await range("bl-todo")) === "1–25 of 30 links" && (await page.locator('#td-table [data-td-sent] option[value="sent"]:checked').count()) === 25, await range("bl-todo"));
  await page.click('[data-td-sent-filter="tosend"]'); await wait(400);
  check("To do: To send shows the rest", (await range("bl-todo")) === "1–25 of 31 links", await range("bl-todo"));
  await page.selectOption("#td-filter", "Nour Media"); await wait(400);
  const chipWords = (await page.locator(".td-sent-chips").innerText()).replace(/\s+/g, " ");
  check("To do: the chips count for the mediator picked", /All\s*21/.test(chipWords) && (await range("bl-todo")).endsWith("of 11 links"), `${chipWords} / ${await range("bl-todo")}`);
  await shot("6-todo");
  await page.selectOption("#td-filter", ""); await wait(300);
  await page.click('[data-td-sent-filter=""]'); await wait(300);

  // ---- In consideration ----
  await page.click('[data-bl-section="consideration"]'); await wait(500);
  const already = await page.evaluate(() => window.PROSPECTS.filter((p) => p.site === "site-one.example").length); // what other flows left on this test world
  await page.evaluate(() => {
    for (let i = 0; i < 260; i++) window.PROSPECTS.push({ id: `made-up-p${i}`, url: `https://prospect-${i}.example/page`, domain: `prospect-${i}.example`, authority: (i * 11) % 95, pageAuthority: (i * 5) % 60, spam: i % 17, file: i % 2 ? "semrush.csv" : "ubersuggest.csv", site: "site-one.example", stage: "new" });
    window.UI.render();
  });
  await wait(500);
  await drive("In consideration", "bl-prospects", "#pr-table tbody tr[id^=prospect-]", 260 + already, "links", "prospect-1", 111);
  await page.fill('[data-pr-filter="da"]', "80"); await wait(500);
  check("In consideration: DA at least 80 goes back to page 1, with the count", (await range("bl-prospects")).startsWith("1–") && (await page.locator("#pr-count").innerText()).startsWith(((await range("bl-prospects")).match(/of (\d+)/) || [])[1] || "x"), `${await range("bl-prospects")} / ${await page.locator("#pr-count").innerText()}`);
  await page.fill('[data-pr-filter="da"]', ""); await wait(500);
  await page.click('[data-pr-sort="da"]'); await wait(400);
  const da = await page.locator("#pr-table tbody tr td:nth-child(3)").evaluateAll((c) => c.slice(0, 5).map((x) => Number(x.textContent.trim())));
  check("In consideration: DA sorts biggest first", da.every((n, i) => !i || da[i - 1] >= n) && da[0] >= 90, da.join(","));
  await page.check("#pr-all"); await wait(300);
  check("In consideration: Select all picks only the 25 on this page", (await page.locator("#pr-pick-count").innerText()).startsWith("25"), await page.locator("#pr-pick-count").innerText());
  await foot("bl-prospects").locator('[data-tp-step="next"]').click(); await wait(400);
  check("In consideration: another page lets the picks go", (await page.locator("#pr-pick-bar").isHidden()) && /\|next\|/.test(await focused()), await focused());
  await shot("7-consideration");
  await notesClear("bl-prospects");

  // ---- Site health → Monthly health test ----
  await go("health/test?site=site-one.example");
  await wait(1500);
  await drive("Not on Google", "ht-not-indexed", "#ht-not-indexed tbody tr", 120, "pages", "discovered", 40);
  check("Not on Google: no Show all button any more", (await page.locator("[data-ht-index-all]").count()) === 0);
  check("Few links in: the 10 the server sends, and how many there are", (await range("ht-few-links")) === "1–10 of 10 pages" && /The 10 with the most clicks are listed, of 37/.test(await foot("ht-few-links").innerText()), await foot("ht-few-links").innerText());
  await page.click('[data-ht-sort="few"][data-ht-sort-by="links_in"]'); await wait(400);
  const fewIn = await page.locator("#ht-few-links tbody tr td:nth-child(2)").evaluateAll((c) => c.map((x) => Number(x.textContent)));
  check("Few links in: Links in sorts", fewIn.every((n, i) => !i || fewIn[i - 1] >= n), fewIn.join(","));
  await page.click("[data-ht-links-all]"); await wait(500);
  await drive("Every page's links in", "ht-links-in", "#ht-links-in tbody tr", 400, "pages", "page-39", 11);
  check("Every page's links in: the footer says the list is cut", /The 400 with the fewest links in are listed, of 1,200/.test(await foot("ht-links-in").innerText()), await foot("ht-links-in").innerText());
  await drive("Health history", "ht-history", "#ht-history tbody tr", 47, "tests");
  await shot("8-health-test");
  await page.locator("#ht-history tbody tr [data-ht-open]").nth(3).click(); await wait(800);
  check("Health history: opening an older test still works", (await page.locator(".ht-past").count()) === 1);

  // ---- Site health → Links checker ----
  await go("health/links?site=site-one.example");
  await wait(1500);
  check("Links checker: each group pages on its own", (await range("lc-broken")) === "1–25 of 120 links" && (await range("lc-unverified")) === "1–25 of 30 links" && (await range("lc-redirect")) === "1–8 of 8 links", `${await range("lc-broken")} / ${await range("lc-unverified")} / ${await range("lc-redirect")}`);
  await foot("lc-broken").locator('[data-tp-step="next"]').click(); await wait(400);
  check("Links checker: Next on Broken shows 26–50, focus stays", (await range("lc-broken")).startsWith("26–50") && /\|next\|/.test(await focused()), await focused());
  const find = page.locator('[data-tp-search][data-tp-key="lc-find"]');
  await find.click(); await find.pressSequentially("from-1", { delay: 30 }); await wait(600);
  check("Links checker: one search finds across groups, back to page 1, cursor kept", (await range("lc-broken")) === "1–25 of 31 links" && (await range("lc-unverified")) === "1–11 of 11 links" && /search/.test(await focused()), `${await range("lc-broken")} / ${await range("lc-unverified")}`);
  await find.fill("nothing-like-this"); await wait(600);
  check("Links checker: an empty group says nothing matches", (await page.locator(".lc-group .lc-none").first().innerText()).includes("matches the search"));
  await find.fill(""); await wait(500);
  await drive("Links history", "lc-history", "#lc-history tbody tr", 40, "link checks");
  await shot("9-links-checker");

  // ---- French ----
  await go("backlinks?site=site-one.example");
  await page.evaluate(() => { window.UI.state.lang = "fr"; window.UI.render(); }); await wait(500);
  const fr = (await range("bl-links"));
  check("French: the footer and the search are in French", /^1–25 sur 305 liens$/.test(fr) && (await page.locator('[data-tp-search][data-tp-key="bl-links"]').getAttribute("placeholder")) === "Rechercher un lien", fr);
  await shot("10-french");
  await page.click('[data-bl-section="todo"]'); await wait(400);
  check("French: To do's search and chips", (await page.locator('[data-tp-search][data-tp-key="bl-todo"]').getAttribute("placeholder")) === "Rechercher un site ou un intermédiaire" && /À envoyer/.test(await page.locator(".td-sent-chips").innerText()));
  await go("health/links?site=site-one.example");
  await page.evaluate(() => { window.UI.state.lang = "fr"; window.UI.render(); }); await wait(600);
  check("French: the links checker's search", (await page.locator('[data-tp-search][data-tp-key="lc-find"]').getAttribute("placeholder")) === "Rechercher dans les liens trouvés" && /sur 40 contrôles de liens/.test(await range("lc-history")), await range("lc-history"));
  await page.evaluate(() => { window.UI.state.lang = "en"; window.UI.render(); }); await wait(300);

  // ---- A phone ----
  for (const [hash, name, prep] of [["backlinks?site=site-one.example", "11-phone-by-page"], ["backlinks/todo?site=site-one.example", "12-phone-todo"], ["backlinks/consideration?site=site-one.example", "13-phone-consideration"], ["health/test?site=site-one.example", "14-phone-health"], ["health/links?site=site-one.example", "15-phone-links"]]) {
    await go(hash, 390);
    if (prep) await prep();
    check(`phone: no sideways scroll on ${hash.split("?")[0]}`, await noSideways());
    await shot(name);
  }
  await go("backlinks?site=site-one.example", 390);
  await page.locator('[data-tp-foot="bl-links"]').scrollIntoViewIfNeeded(); await wait(300);
  await shot("16-phone-footer");
  await notesClear("bl-links");

  const real = problems.filter((p) => !/Failed to load resource|favicon/.test(p));
  check("no errors in the page", real.length === 0, real.slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `\n${bad} FAILED` : "\nall passed");
  process.exit(bad ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
