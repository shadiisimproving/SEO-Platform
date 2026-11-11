// Every long table in Competitors has pages, a search where people look for one row, and its filters (2026-11-10).
// The model is Search → Overview's query table: 25 / 50 / 100 a page, Previous / Next and page numbers, the real total.
// The demo world has only a few rows, so each screen's answer is made long here with made-up rows (page.route).
//   DB_NAME_TEST=seo_cc_b_test .venv/bin/python tests/ui/app_server.py --port 8281
//   node tests/ui/flow_table_pages_competitors.cjs http://127.0.0.1:8281/ [summary|pairs|ai|check|profile|find]
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8281/";
const ONLY = process.argv[3] || ""; // one part only
const OUT = path.resolve("var/ui-table-pages-competitors") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
const want = (part) => !ONLY || ONLY === part;

/* The same row many times over, each with a made-up name, so the table is long. */
const many = (list, n, make) => { const base = list[0]; const out = []; for (let i = 0; i < n; i += 1) out.push(make(JSON.parse(JSON.stringify(base)), i)); return out; };
async function longer(page, pattern, change) {
  await page.route(pattern, async (route) => {
    const res = await route.fetch();
    let d;
    try { d = await res.json(); } catch { return route.fulfill({ response: res }); }
    change(d, route.request().url());
    await route.fulfill({ response: res, json: d });
  });
}

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const settle = (ms = 700) => page.waitForTimeout(ms);
  const text = (sel) => page.locator(sel).first().textContent({ timeout: 3000 }).then((x) => (x || "").replace(/\s+/g, " ").trim()).catch(() => "");
  const rows = (sel) => page.locator(`${sel} > tbody > tr`).count();
  const all = (sel, fn) => page.locator(sel).evaluateAll(fn);
  const one = (sel, fn) => page.locator(sel).first().evaluate(fn);
  const focusIs = (test) => page.evaluate(test);
  const foot = (key) => `[data-tp-foot="${key}"]`;
  const range = (key) => text(`${foot(key)} .tp-range`);
  const next = async (key) => { await page.locator(`${foot(key)} [data-tp-step="next"]`).click(); await settle(); };
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const french = async () => { await page.evaluate(() => { window.UI.state.lang = "fr"; window.UI.render(); }); await settle(1800); };
  const english = async () => { await page.evaluate(() => { window.UI.state.lang = "en"; window.UI.render(); }); await settle(1500); };
  const phone = async (on) => { await page.setViewportSize(on ? { width: 390, height: 844 } : { width: 1440, height: 950 }); await settle(900); };
  /* The floating Notes button must not sit on top of a control in the footer. */
  const notesClear = (key) => page.evaluate((k) => {
    const notes = [...document.querySelectorAll("button, a")].find((b) => getComputedStyle(b).position === "fixed" && b.offsetParent !== null);
    const footer = document.querySelector(`[data-tp-foot="${k}"]`);
    if (!notes || !footer) return true;
    const n = notes.getBoundingClientRect();
    return [...footer.querySelectorAll("button, select")].every((c) => { const r = c.getBoundingClientRect(); return r.right <= n.left || r.left >= n.right || r.bottom <= n.top || r.top >= n.bottom; });
  }, key);
  const searchBox = (key) => page.locator(`[data-tp-search][data-tp-key="${key}"]`);
  const typeIn = async (key, words) => { await searchBox(key).click(); await page.keyboard.type(words, { delay: 25 }); await settle(900); };
  const clearBox = async (key) => { await searchBox(key).fill(""); await settle(900); };
  /* What a person sees: the screen with that part at the top (an element shot can't show a footer that sticks). */
  const shot = async (sel, name) => { await page.evaluate((x) => document.querySelector(x)?.scrollIntoView({ block: "start" }), sel); await settle(300); await page.screenshot({ path: OUT + name }); };
  const keptFocus = (key) => page.evaluate((k) => document.activeElement?.dataset?.tpKey === k && document.activeElement.hasAttribute("data-tp-search"), key);

  await page.goto(BASE + "#today"); await settle(1500);
  const sites = await page.evaluate(async () => (await (await fetch("api/links/sites")).json()).sites);
  const site = sites.find((s) => s.host === "site-one.example") || sites[0];

  // ---- Competitors (Summary): the competitors, the keywords they beat me on, the links they share ------------------
  if (want("summary")) {
    await longer(page, /\/api\/collective\/rivals(\?.*)?$/, (d) => { d.rivals = [...d.rivals, ...many(d.rivals, 57, (r, i) => ({ ...r, id: 90000 + i, host: `made-up-rival-${i}.example`, display: `made-up-rival-${i}.example`, ranks_on: (i * 7) % 40, they_ahead: i % 9, i_ahead: i % 5 }))]; });
    await longer(page, /\/api\/collective\/keywords(\?.*)?$/, (d) => {
      const r = d.keywords[0].rivals_ahead;
      d.keywords = [...d.keywords, ...many(d.keywords, 131, (k, i) => ({ ...k, keyword_id: 90000 + i, keyword: `made-up keyword ${i}`, my_best: i % 4 ? { host: "site-one.example", position: 2 + (i % 30) } : null, rivals_ahead: r.slice(0, 1 + (i % r.length)) }))];
      d.total = 200; // the server says there are more than it sent
    });
    await longer(page, /\/api\/collective\/links(\?.*)?$/, (d) => {
      d.gaps = [...d.gaps, ...many(d.gaps, 291, (g, i) => ({ ...g, domain: `made-up-link-${i}.example`, display: `made-up-link-${i}.example`, title: "", authority: (i * 11) % 97, rival_count: 1 + (i % 3) }))];
      d.flagged = [...d.flagged, ...many(d.flagged, 52, (g, i) => ({ ...g, domain: `made-up-spam-${i}.example`, display: `made-up-spam-${i}.example`, authority: i % 30 }))];
      d.funnel.flagged = d.flagged.length; d.funnel.good = d.gaps.length;
    });
    await page.goto(BASE + "#competitors/summary"); await page.waitForSelector("#cs-rivals-table tbody tr", { timeout: 20000 }); await settle(2500);
    const rivalsTotal = Number((await range("cs-rivals")).match(/of (\d+)/)?.[1] || 0);

    // Competitors table
    check("S1. competitors: 25 on the first page", (await rows("#cs-rivals-table")) === 25, await rows("#cs-rivals-table"));
    check("S1. competitors: the real total", rivalsTotal >= 60 && /^1–25 of \d+ competitors$/.test(await range("cs-rivals")), await range("cs-rivals"));
    await next("cs-rivals");
    check("S1. competitors: Next shows 26–50", /^26–50 of /.test(await range("cs-rivals")), await range("cs-rivals"));
    check("S1. competitors: focus stays on Next", await focusIs(() => document.activeElement?.dataset?.tpStep === "next"));
    await page.locator(`${foot("cs-rivals")} .tp-num`).filter({ hasText: /^3$/ }).click(); await settle();
    check("S1. competitors: page 3 holds the rest", /^51–/.test(await range("cs-rivals")) && (await focusIs(() => document.activeElement?.getAttribute("aria-current") === "page")), await range("cs-rivals"));
    await page.selectOption(`${foot("cs-rivals")} [data-tp-per]`, "100"); await settle();
    check("S1. competitors: 100 a page shows them all", (await rows("#cs-rivals-table")) === rivalsTotal && !(await page.$(`${foot("cs-rivals")} .tp-pager`)) && (await focusIs(() => document.activeElement?.hasAttribute("data-tp-per"))));
    await page.selectOption(`${foot("cs-rivals")} [data-tp-per]`, "25"); await settle();
    await next("cs-rivals");
    await page.click("#cs-find"); await page.keyboard.type("rival-1", { delay: 30 }); await settle(900);
    check("S1. competitors: a search goes back to page 1 and keeps the focus", /^1–11 of 11 competitors$/.test(await range("cs-rivals")) && (await focusIs(() => document.activeElement?.id === "cs-find")), await range("cs-rivals"));
    await page.fill("#cs-find", ""); await settle(700);
    await page.click('[data-cs-sort="ranks"]'); await settle();
    const ranks = await all("#cs-rivals-table tbody tr", (r) => r.slice(0, 6).map((x) => Number(x.querySelector('td[data-label="Ranks on your keywords"]')?.textContent.replace(/\D/g, "")) || 0));
    check("S1. competitors: sorting by Ranks puts the most first, on page 1", ranks.every((n, i) => !i || ranks[i - 1] >= n) && /^1–25/.test(await range("cs-rivals")), JSON.stringify(ranks));
    check("S1. competitors: the sorted heading says so", await one('[data-cs-sort="ranks"]', (b) => b.classList.contains("on") && b.closest("th").getAttribute("aria-sort") === "descending"));
    await shot("#cs-rivals", "s1-competitors.png");

    // Keywords they beat me on
    await page.locator("#cs-keywords").scrollIntoViewIfNeeded();
    check("S2. keywords: 25 a page, with the real total", (await rows("#cs-keywords-table")) === 25 && /^1–25 of 140 keywords/.test(await range("cs-keywords")), await range("cs-keywords"));
    check("S2. keywords: says the server sent 140 of 200", /listed, of 200/.test(await text(`${foot("cs-keywords")} .tp-capped`)), await text(`${foot("cs-keywords")} .tp-capped`));
    const kwOptions = await page.locator("#cs-kw-rival option").allTextContents();
    check("S2. keywords: a competitor choice, each with its count", kwOptions.length >= 3 && /All competitors, together \(140\)/.test(kwOptions[0]), JSON.stringify(kwOptions));
    await next("cs-keywords");
    await page.selectOption("#cs-kw-rival", { index: 2 }); await settle();
    const oneRival = await range("cs-keywords");
    check("S2. keywords: one competitor goes back to page 1, focus on the choice", /^1–/.test(oneRival) && (await focusIs(() => document.activeElement?.id === "cs-kw-rival")), oneRival);
    await page.selectOption("#cs-kw-rival", ""); await settle();
    await typeIn("cs-keywords", "keyword 1");
    check("S2. keywords: search filters as you type, focus kept", /of \d+ keywords/.test(await range("cs-keywords")) && (await keptFocus("cs-keywords")), await range("cs-keywords"));
    await page.keyboard.type("zzz"); await settle(900);
    check("S2. keywords: no match says so, with a way back", /No keyword matches/.test(await text("#cs-keywords")) && Boolean(await page.$("#cs-keywords .cs-find-none [data-tp-clear]")));
    await page.click("#cs-keywords .cs-find-none [data-tp-clear]"); await settle();
    check("S2. keywords: Clear the search brings them all back, focus in the box", /of 140 keywords/.test(await range("cs-keywords")) && (await keptFocus("cs-keywords")));
    await page.click('[data-cs-kw-sort="position"]'); await settle();
    const pos = await all("#cs-keywords-table tbody tr td.cs-my-place", (c) => c.slice(0, 8).map((x) => Number(x.textContent.match(/#\s*(\d+)/)?.[1] || 999)));
    check("S2. keywords: sort by your position, the best first", pos.every((n, i) => !i || pos[i - 1] <= n), JSON.stringify(pos));
    check("S2. keywords: focus stays on the heading", await focusIs(() => document.activeElement?.dataset?.csKwSort === "position"));
    await shot("#cs-keywords", "s2-keywords.png");

    // Links many competitors share
    await page.locator("#cs-links").scrollIntoViewIfNeeded();
    check("S3. links: 25 a page, with the real total", (await rows("#cs-links-table")) === 25 && /^1–25 of 300 domains/.test(await range("cs-links")), await range("cs-links"));
    await next("cs-links");
    check("S3. links: Next", /^26–50 of 300/.test(await range("cs-links")));
    await page.click('#cs-links-table [data-cs-ln-sort="authority"]'); await settle();
    const auth = await all("#cs-links-table tbody tr", (r) => r.slice(0, 6).map((x) => Number(x.children[3].textContent.replace(/\D/g, "")) || 0));
    check("S3. links: sort by authority, the highest first, back on page 1", auth.every((n, i) => !i || auth[i - 1] >= n) && /^1–25/.test(await range("cs-links")), JSON.stringify(auth));
    await page.click(".cs-flagged > summary"); await settle();
    check("S3. links: the spam list has its own pages", (await rows("#cs-flagged-table")) === 25 && /of 60 domains/.test(await range("cs-flagged")), await range("cs-flagged"));
    await next("cs-flagged");
    check("S3. links: the spam fold stays open on another page", (await one(".cs-flagged", (d) => d.open)) && /^26–50/.test(await range("cs-flagged")));
    await typeIn("cs-links", "made-up-spam-1");
    check("S3. links: one search filters both lists", /^1–11 of 11/.test(await range("cs-flagged")) && /No domain matches/.test(await text("#cs-links")) && (await keptFocus("cs-links")), await range("cs-flagged"));
    await shot("#cs-links", "s3-links-search.png");
    await clearBox("cs-links");
    await page.locator(foot("cs-links")).scrollIntoViewIfNeeded();
    check("S3. Notes button leaves the footer free", await notesClear("cs-links"));
    await page.mouse.wheel(0, -500); await settle(400);
    await page.screenshot({ path: OUT + "s4-summary-sticky.png" });

    await french();
    check("S4. French: the footer and filters", /sur 300 domaines/.test(await range("cs-links")) && /Tous les concurrents, ensemble/.test(await text("#cs-kw-rival")) && /Suivant/.test(await text(foot("cs-keywords"))), await range("cs-links"));
    await shot("#cs-keywords", "s5-keywords-fr.png");
    await english();
    await phone(true);
    check("S5. 390px: no sideways scroll", !(await sideways()));
    await shot("#cs-keywords", "s6-keywords-phone.png");
    await phone(false);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }

  const openTab = async (id, extra = {}) => { await page.goto(BASE + "#today"); await settle(800); await page.evaluate(([x, e, s]) => window.COMP.open(x, e, s), [id, extra, site.id]); await settle(2200); };

  // ---- Page vs page: the list of pairs, and one pair's keywords ------------------------------------------------------
  if (want("pairs")) {
    const rivals = await page.evaluate(async (s) => (await (await fetch(`api/competitors?site_id=${s}`)).json()).competitors, site.id);
    await longer(page, /\/api\/page-pairs\?site_id=\d+$/, (d) => {
      d.pairs = [...d.pairs, ...many(d.pairs, 120, (p, i) => {
        const c = rivals[i % rivals.length], mine = 1 + (i % 9), theirs = 1 + ((i * 5) % 9);
        return { ...p, id: 80000 + i, source: "auto", competitor: c.host, competitor_id: c.id, my_title: `Made-up page ${i}`, my_url: `https://${site.host}/made-up-page-${i}`, their_url: `https://${c.host}/their-page-${i}`,
          ranking: { ...p.ranking, keywords: [{ depth: 10, keyword: `made-up pair keyword ${i}`, my_position: mine, their_position: theirs }], keywords_total: 1, shared: 1, they_ahead: theirs < mine ? 1 : 0, i_ahead: mine < theirs ? 1 : 0, level: mine === theirs ? 1 : 0, gap: mine - theirs, only_mine: 0, only_theirs: 0 } };
      })];
    });
    await longer(page, /\/api\/page-pairs\/12$/, (d) => { d.keywords = [...d.keywords, ...many(d.keywords, 70, (k, i) => ({ ...k, keyword: `made-up shared keyword ${i}`, my_position: 1 + (i % 10), their_position: 1 + ((i * 3) % 10) }))]; });
    await openTab("pairs");
    await page.click('[data-cp-verdict="all"]'); await settle();
    const total = Number((await range("cp-pairs")).match(/of (\d+)/)?.[1] || 0);
    check("P1. pairs: 25 a page, with the real total", (await rows("#cp-table")) === 25 && total >= 120, await range("cp-pairs"));
    await next("cp-pairs");
    check("P1. pairs: Next", /^26–50/.test(await range("cp-pairs")));
    await page.click('[data-cp-verdict="behind"]'); await settle();
    check("P1. pairs: a chip goes back to page 1, focus on it", /^1–/.test(await range("cp-pairs")) && (await focusIs(() => document.activeElement?.dataset?.cpVerdict === "behind")), await range("cp-pairs"));
    await page.click('[data-cp-verdict="all"]'); await settle();
    await page.selectOption("#cp-filter", String(rivals[1].id)); await settle();
    const one = await range("cp-pairs");
    check("P1. pairs: one competitor, focus on the choice", /^1–25 of 4\d/.test(one) && (await focusIs(() => document.activeElement?.id === "cp-filter")), one);
    await page.selectOption("#cp-filter", ""); await settle();
    await typeIn("cp-pairs", "page 11");
    const found = await range("cp-pairs");
    check("P1. pairs: search finds pages by address or title, focus kept", /^1–\d+ of \d+ pairs$/.test(found) && (await keptFocus("cp-pairs")) && (await rows("#cp-table")) < 25, found);
    const counted = await page.locator("#cp-filter option").first().textContent();
    check("P1. pairs: the competitor choice counts what the search found", counted.includes(`(${found.match(/of (\d+)/)?.[1]})`), counted);
    await typeIn("cp-pairs", "zzz");
    check("P1. pairs: no match says so, with a way back", /No pair matches this search/.test(await text("#comp-body")) && Boolean(await page.$("#comp-body .empty [data-tp-clear]")));
    await page.click("#comp-body .empty [data-tp-clear]"); await settle();
    await page.click('[data-cp-sort="mine"]'); await settle();
    const mine = await all("#cp-table tbody tr", (r) => r.slice(0, 8).map((x) => Number(x.children[3].textContent.match(/\d+/)?.[0] || 999)));
    check("P1. pairs: sort by your position, the best first", mine.every((n, i) => !i || mine[i - 1] <= n) && (await focusIs(() => document.activeElement?.dataset?.cpSort === "mine")), JSON.stringify(mine));
    await shot("#comp-body", "p1-pairs.png");
    await page.click('[data-cp-sort="mine"]'); await settle(); await page.click('[data-cp-sort="mine"]'); await settle(); // back to the usual order

    await page.goto("about:blank"); await page.goto(BASE + "#competitors/pairs/12"); await page.waitForSelector("#cp-kw", { timeout: 15000 }); await settle(1500);
    check("P2. a pair's keywords: 25 a page, with the real total", (await page.locator("#cp-kw > tbody").count()) === 25 && /^1–25 of 72 keywords/.test(await range("cp-kw")), await range("cp-kw"));
    await next("cp-kw");
    check("P2. a pair's keywords: Next", /^26–50 of 72/.test(await range("cp-kw")) && (await focusIs(() => document.activeElement?.dataset?.tpStep === "next")));
    await typeIn("cp-kw", "shared keyword 4");
    check("P2. a pair's keywords: search (every word counts: 4, 14, 24… 40–49), focus kept", /^1–16 of 16/.test(await range("cp-kw")) && (await keptFocus("cp-kw")), await range("cp-kw"));
    await shot("#comp-body", "p2-pair-keywords.png");
    await clearBox("cp-kw");
    await french();
    check("P3. French", /sur 72 mots-clés/.test(await range("cp-kw")) && (await searchBox("cp-kw").getAttribute("placeholder")) === "Chercher un mot-clé", await range("cp-kw"));
    await english();
    await phone(true);
    check("P3. 390px: no sideways scroll on a pair", !(await sideways()));
    await shot(foot("cp-kw"), "p3-pair-phone.png");
    await phone(false);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }

  // ---- AI Overview watch --------------------------------------------------------------------------------------------
  if (want("ai")) {
    await longer(page, /\/api\/ai-watch\?site_id=\d+$/, (d) => {
      const cited = [...new Map(d.keywords.flatMap((r) => r.competitors_cited).map((c) => [c.id, c])).values()];
      d.keywords = [...d.keywords, ...many(d.keywords, 110, (r, i) => ({ ...r, keyword: `made-up ai keyword ${i}`, state: ["present", "absent", "not_captured"][i % 3], cited_me: i % 3 === 2 ? null : i % 2 === 0, competitors_cited: i % 3 === 0 ? cited.slice(0, 1 + (i % Math.max(1, cited.length))) : [] }))];
    });
    await openTab("ai");
    const total = Number((await range("ca-kw")).match(/of (\d+)/)?.[1] || 0);
    check("A1. AI keywords: 25 a page, with the real total", (await rows("#ca-table")) === 25 && total === 120, await range("ca-kw"));
    await next("ca-kw");
    await page.click('[data-ca-filter="overview"]'); await settle();
    check("A1. a chip goes back to page 1", /^1–/.test(await range("ca-kw")) && (await focusIs(() => document.activeElement?.dataset?.caFilter === "overview")), await range("ca-kw"));
    await page.click('[data-ca-filter="all"]'); await settle();
    const opts = await page.locator("#ca-rival option").allTextContents();
    check("A1. a competitor choice, each with its count", opts.length >= 3 && /All competitors, together \(120\)/.test(opts[0]), JSON.stringify(opts));
    if (opts.length >= 2) {
      await page.selectOption("#ca-rival", { index: 1 }); await settle();
      const n = Number(opts[1].match(/\((\d+)\)/)?.[1] || -1);
      check("A1. one competitor shows only where it's cited", new RegExp(`of ${n} keywords`).test(await range("ca-kw")) && (await focusIs(() => document.activeElement?.id === "ca-rival")), await range("ca-kw"));
      await page.selectOption("#ca-rival", ""); await settle();
    }
    await typeIn("ca-kw", "ai keyword 10");
    check("A1. search, focus kept", /^1–\d+ of \d+ keywords$/.test(await range("ca-kw")) && (await keptFocus("ca-kw")), await range("ca-kw"));
    await shot("#comp-body", "a1-ai.png");
    await clearBox("ca-kw");
    await page.selectOption(`${foot("ca-kw")} [data-tp-per]`, "50"); await settle();
    check("A1. 50 a page", (await rows("#ca-table")) === 50);
    await french();
    check("A2. French", /sur 120 mots-clés/.test(await range("ca-kw")) && /Concurrent cité/.test(await text("#comp-body .ca-tools")), await range("ca-kw"));
    await english();
    await phone(true);
    check("A2. 390px: no sideways scroll", !(await sideways()));
    await shot(".ca-tools", "a2-ai-phone.png");
    await phone(false);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }

  // ---- Keyword check ------------------------------------------------------------------------------------------------
  if (want("check")) {
    const rivals = await page.evaluate(async (s) => (await (await fetch(`api/competitors?site_id=${s}`)).json()).competitors, site.id);
    await longer(page, /\/api\/keyword-check\?site_id=\d+$/, (d) => {
      d.keywords = [];
      for (let i = 0; i < 140; i += 1) {
        const checked = i % 7 !== 6;
        d.keywords.push({ id: 70000 + i, keyword: `made-up check keyword ${i}`, country: "FR", language: "fr", checked, checked_at: checked ? "2026-11-10T09:00:00Z" : null, tool: checked ? "SerpApi" : null, tracked: i % 5 === 0,
          me: checked && i % 3 ? { position: 1 + (i % 10) } : null,
          competitors: checked ? rivals.slice(0, i % (rivals.length + 1)).map((c, j) => ({ id: c.id, host: c.host, display: c.host, position: 1 + ((i + j) % 10), url: `https://${c.host}/x` })) : [] });
      }
      d.run = null;
    });
    await openTab("check");
    check("K1. keyword check: 25 a page, with the real total", (await rows("#kc-table")) === 25 && /^1–25 of 140 keywords/.test(await range("kc")), await range("kc"));
    await page.locator(`${foot("kc")} .tp-num`).filter({ hasText: /^6$/ }).click(); await settle();
    check("K1. page 6 holds the last 15", (await rows("#kc-table")) === 15 && /^126–140/.test(await range("kc")), await range("kc"));
    await page.click('[data-kc-sort="rivals"]'); await settle();
    const counts = await all("#kc-table tbody tr", (r) => r.slice(0, 10).map((x) => x.querySelectorAll(".kc-rival").length));
    check("K1. sort by competitors, the most first, back on page 1", counts.every((n, i) => !i || counts[i - 1] >= n) && /^1–25/.test(await range("kc")) && (await focusIs(() => document.activeElement?.dataset?.kcSort === "rivals")), JSON.stringify(counts));
    await page.fill("[data-kc-words]", "half typed");
    await typeIn("kc", "keyword 13");
    check("K1. search, focus kept, the half-typed form kept", /^1–\d+ of \d+ keywords$/.test(await range("kc")) && (await keptFocus("kc")) && (await page.inputValue("[data-kc-words]")) === "half typed", await range("kc"));
    await shot("#comp-body", "k1-check.png");
    await clearBox("kc");
    await french();
    check("K2. French", /sur 140 mots-clés/.test(await range("kc")), await range("kc"));
    await english();
    await phone(true);
    check("K2. 390px: no sideways scroll", !(await sideways()));
    await shot(foot("kc"), "k2-check-phone.png");
    await phone(false);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }

  // ---- A competitor's profile: its keywords ------------------------------------------------------------------------
  if (want("profile")) {
    const rivals = await page.evaluate(async (s) => (await (await fetch(`api/competitors?site_id=${s}`)).json()).competitors, site.id);
    const rival = rivals.find((c) => c.host === "rival-one.example") || rivals[0];
    await longer(page, new RegExp(`/api/competitors/${rival.id}/profile\\?site_id=\\d+$`), (d) => {
      d.keywords = [...d.keywords, ...many(d.keywords, 150, (k, i) => ({ ...k, keyword: `made-up profile keyword ${i}`, status: ["shared", "theirs_only", "mine_only"][i % 3], my_position: i % 3 === 1 ? null : 1 + (i % 10), their_position: i % 3 === 2 ? null : 1 + ((i * 7) % 10) }))];
    });
    await openTab("list", { competitorId: rival.id });
    await page.waitForSelector("#cl-keywords", { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => document.querySelector("#cl-keywords")?.scrollIntoView());
    const shared = await range("cl-kw");
    check("C1. profile keywords: 25 a page, with the real total", (await rows("#cl-keywords .cl-table")) === 25 && /^1–25 of \d{2} keywords$/.test(shared), shared);
    await next("cl-kw");
    check("C1. Next", /^26–50/.test(await range("cl-kw")) && (await focusIs(() => document.activeElement?.dataset?.tpStep === "next")));
    await page.click('[data-cl-kw="theirs_only"]'); await settle();
    check("C1. another group goes back to page 1, focus on it", /^1–/.test(await range("cl-kw")) && (await focusIs(() => document.activeElement?.dataset?.clKw === "theirs_only")), await range("cl-kw"));
    await page.click('[data-cl-kw="shared"]'); await settle();
    await next("cl-kw");
    await page.click('[data-cl-sort="their_position"]'); await settle();
    const theirs = await all("#cl-keywords .cl-table tbody tr", (r) => r.slice(0, 8).map((x) => Number(x.children[2].textContent.match(/\d+/)?.[0] || 999)));
    check("C1. sort by their position, back on page 1", theirs.every((n, i) => !i || theirs[i - 1] <= n) && /^1–/.test(await range("cl-kw")) && (await focusIs(() => document.activeElement?.dataset?.clSort === "their_position")), JSON.stringify(theirs));
    await typeIn("cl-kw", "profile keyword 1");
    const segText = await text("#cl-keywords .cl-seg");
    check("C1. search, focus kept, the group counts follow it", /^1–\d+ of \d+ keywords$/.test(await range("cl-kw")) && (await keptFocus("cl-kw")) && /Shared \d+/.test(segText), `${await range("cl-kw")} | ${segText}`);
    await shot("#cl-keywords", "c1-profile-keywords.png");
    await clearBox("cl-kw");
    await french();
    check("C2. French", /sur \d+ mots-clés/.test(await range("cl-kw")), await range("cl-kw"));
    await english();
    await phone(true);
    check("C2. 390px: no sideways scroll", !(await sideways()));
    await shot(foot("cl-kw"), "c2-profile-phone.png");
    await phone(false);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }

  // ---- Find competitors: the evidence under a suggestion -----------------------------------------------------------
  if (want("find")) {
    await longer(page, /\/api\/competitors\/suggestions\?site_id=\d+$/, (d) => {
      [...d.suggestions, ...d.platforms].filter((x) => x.evidence?.length).forEach((item) => {
        item.evidence = many(item.evidence, 100, (e, i) => ({ ...e, keyword: `made-up evidence keyword ${i}`, position: 1 + (i % 10) }));
        item.keywords = 140;
      });
    });
    await openTab("find");
    const item = await page.evaluate(() => document.querySelector("[data-cl-evidence]")?.dataset.clEvidence);
    await page.locator("details.cl-group").evaluateAll((folds) => folds.forEach((d) => { d.open = true; }));
    await page.locator(`[data-cl-evidence="${item}"] > summary`).click(); await settle();
    const key = `cl-ev:${item}`;
    check("F1. evidence: 25 a page, says it's the first 100 of 140", /^1–25 of 100 keywords/.test(await range(key)) && /Showing the first 100/.test(await text(`${foot(key)} .tp-capped`)), await range(key));
    await next(key);
    check("F1. evidence: Next keeps the fold open", /^26–50/.test(await range(key)) && (await one(`[data-cl-evidence="${item}"]`, (d) => d.open)));
    await shot(`[data-cl-evidence="${item}"]`, "f1-evidence.png");
    await french();
    check("F2. French", /sur 100 mots-clés/.test(await range(key)), await range(key));
    await english();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }

  const shown = problems.filter((p) => !/Failed to load resource|favicon/.test(p));
  check("no errors on the page", shown.length === 0, shown.slice(0, 4).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})();
