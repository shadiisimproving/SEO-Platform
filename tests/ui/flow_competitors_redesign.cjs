// The Competitors area after the 2026-11-09 redesign (reports/ux-competitors-fable-2026-11-09.md): one merged
// "Competitors" tab, seven tabs, a table that says — for what it doesn't know, a profile that is one card,
// the setup banner on an empty app, page paths as links, no sideways scroll, and French.
// Needs two apps on the fake internet, one with the demo data and one empty:
//   DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8230
//   DB_NAME_TEST=test_y_test .venv/bin/python tests/ui/app_server.py --port 8231 --empty
// Run: node tests/ui/flow_competitors_redesign.cjs [demo address] [empty address]
//   or COMP_URL=http://127.0.0.1:8234/ COMP_EMPTY_URL=http://127.0.0.1:8235/ node tests/ui/flow_competitors_redesign.cjs
// It adds one made-up site (setup-banner.example) to the empty app, because the banner needs a site to talk about.
const { open } = require("./pw.cjs");
const slash = (u) => (u.endsWith("/") ? u : `${u}/`);
const BASE = slash(process.argv[2] || process.env.COMP_URL || "http://127.0.0.1:8230/");
const EMPTY = slash(process.argv[3] || process.env.COMP_EMPTY_URL || "http://127.0.0.1:8231/");
const BANNER_SITE = "setup-banner.example";
const tally = { pass: 0, fail: 0, skip: 0 };
const say = (word, name, extra) => console.log(`${word}  ${name}${extra !== "" && extra !== undefined ? `  [${typeof extra === "string" ? extra : JSON.stringify(extra)}]` : ""}`);
const check = (name, ok, extra = "") => { tally[ok ? "pass" : "fail"] += 1; say(ok ? "PASS" : "FAIL", name, extra); };
const skip = (name, why) => { tally.skip += 1; say("SKIP", name, why); };

const TABS_EN = [/^Competitors$/, /^Find( competitors)?$/, /^Keyword check$/, /^Page vs page$/, /^Link gaps$/, /^AI Overview( watch)?$/, /^Notes$/];
const TABS_FR = ["Concurrents", "Trouver des concurrents", "Vérifier des mots-clés", "Page contre page", "Liens manquants", "Suivi des AI Overviews", "Notes"];
const HEADS_EN = ["Competitor", "Ranks on your keywords", "Who leads", "Edits in 30 days", "Watching"];
const HEADS_FR = ["Concurrent", "Se classe sur vos mots-clés", "Qui est devant", "Modifications en 30 jours", "Suivi", "Niveau de suivi"];
// English words that must not be left in the French tabs, table and banner. Site names (rival-one.example) hold none of them.
const EN_LEFT = /\b(Competitors?|Watching|Tracking|Pages only|Last read|Blocked|Paused|Them|You|Remove|Who leads|Edits in|Ranks on|Click one|Find competitors|Keyword check|Add keywords|Add one by hand|Page vs page|Link gaps|No competitors|keyword list)\b/;

// What a screen shows, the way flow_page_links.cjs looks at it: its page links, any lone /path/ left as plain text,
// and any other link whose words are a bare path (so it didn't go through PageLink).
const survey = () => {
  const lone = (s) => /^\/[\w\-./%À-ÿ]*$/.test(s);
  const links = [...document.querySelectorAll("#main a.page-link")].map((a) => ({ href: a.getAttribute("href"), text: a.textContent.trim(), target: a.target }));
  // The same cells flow_page_links.cjs reads, plus any element with no children whose only words are a path.
  const plain = [...document.querySelectorAll("#main td, #main .t, #main .second, #main .lv-url, #main .mono"), ...[...document.querySelectorAll("#main *")].filter((el) => !el.children.length)]
    .filter((el) => !el.closest("a, button, input, textarea, code, select, option, svg") && !el.querySelector("a, button"))
    .map((el) => el.textContent.trim()).filter(lone);
  const otherLinks = [...document.querySelectorAll("#main a:not(.page-link)")].map((a) => a.textContent.trim()).filter(lone);
  const addresses = document.querySelectorAll("#main a.comp-url").length; // full addresses (site.example/page) drawn by COMP.link: links, but not PageLink
  return { links, plain: [...new Set(plain)], otherLinks: [...new Set(otherLinks)], addresses };
};
const widths = () => { const m = document.querySelector("#main"); return { page: document.documentElement.scrollWidth, window: window.innerWidth, main: m ? m.scrollWidth : 0, mainBox: m ? m.clientWidth : 0 }; };
const fits = (w) => w.page <= w.window + 1 && w.main <= w.mainBox + 1;

const fakeQuestions = (host, about) => { const groups = Array.from({ length: 25 }, (_, i) => ({ url: `https://${host}/guide/p-${i + 1}`, title: `Page ${i + 1} about ${i < 15 ? about : "the weather"}`, questions: Array.from({ length: i % 3 ? 2 : 5 }, (_, k) => `Question ${i + 1}.${k + 1} about ${i < 15 ? about : "the weather"}?`), other: [], related: i < 15, score: i < 15 ? 1 : 0 })); return { judged: true, dropped: 4, groups, related: groups.filter((g) => g.related).reduce((n, g) => n + g.questions.length, 0), total: groups.reduce((n, g) => n + g.questions.length, 0) }; };

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  const settle = (ms = 1200) => page.waitForTimeout(ms);
  const call = (base, method, p, body) => page.evaluate(([m, u, b]) => fetch(u, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [method, `${base}api/${p}`, body]);
  // A goto that only differs after # doesn't load the page again, so every load starts from a blank page.
  const fresh = async (hash, base = BASE) => { await page.goto("about:blank"); await page.goto(`${base}#${hash}`); };
  const tableReady = () => page.waitForSelector("#cs-rivals-table tbody tr", { timeout: 15000 });
  const lang = async (to) => { await page.evaluate((l) => { window.UI.state.lang = l; window.UI.render?.(); }, to); await settle(); };
  const tabsNow = () => page.evaluate(() => [...document.querySelectorAll("[data-comp-tab]")].map((b) => ({ id: b.dataset.compTab, text: [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim(), lit: b.getAttribute("aria-selected") === "true" })));
  const headsNow = () => page.evaluate(() => [...document.querySelectorAll("#cs-rivals-table thead th")].map((th) => th.textContent.trim()));
  const rowIds = () => page.evaluate(() => [...document.querySelectorAll("#cs-rivals-table tbody tr[data-cs-row]")].map((tr) => Number(tr.dataset.csRow)));
  const onProfile = () => page.evaluate(() => Boolean(document.querySelector("[data-pt-tab], #cl-profile-title")));
  // Each part runs on its own: one that breaks is one FAIL line, and the rest still run.
  const part = async (name, fn) => { try { await fn(); } catch (err) { check(`${name}: ran to the end`, false, String(err.message || err).split("\n")[0]); } };

  // ---- the demo app: the site with the most competitors ----------------------------------------
  await page.goto(`${BASE}#today`);
  let site = null, rivals = [];
  for (const s of (await call(BASE, "GET", "links/sites")).sites) {
    const rows = (await call(BASE, "GET", `competitors?site_id=${s.id}`)).competitors || [];
    if (rows.length > rivals.length) { site = s; rivals = rows; }
  }
  if (!site || rivals.length < 2) {
    check("the demo app has a site with at least two competitors", false, `${BASE} has ${rivals.length}`);
    await browser.close();
    console.log(`\n${tally.pass} passed, ${tally.fail} failed, ${tally.skip} skipped`);
    process.exit(1);
  }
  const setTracking = (id, to) => call(BASE, "PUT", `competitors/${id}/tracking`, { site_id: site.id, tracking: to });
  for (const c of rivals) if ((c.tracking || "on") !== "on") await setTracking(c.id, "on"); // a rerun starts clean
  const at = (tab) => `competitors/${tab}?site=${encodeURIComponent(site.host)}`;
  const openSummary = async () => { await fresh(at("summary")); await tableReady(); await settle(); };
  const openProfile = async (id) => {
    await openSummary();
    await page.click(id ? `.cs-rival-open[data-cs-open="${id}"]` : "#cs-rivals-table tbody tr .cs-rival-open");
    await page.waitForSelector("[data-pt-tab]", { timeout: 15000 });
    await settle(1500);
  };
  console.log(`      demo ${BASE} (${site.host}, ${rivals.length} competitors) · empty ${EMPTY}`);

  // ---- 1. one merged tab ------------------------------------------------------------------------
  await part("1 merged tab", async () => {
    for (const old of ["summary", "list"]) {
      await fresh(at(old)); await tableReady(); await settle(600);
      const lit = (await tabsNow()).filter((x) => x.lit);
      const profile = await onProfile();
      check(`1. #competitors/${old} opens the Competitors tab`, lit.length === 1 && lit[0].id === "summary" && lit[0].text === "Competitors" && !profile, { lit, profile });
    }
    check("1. there is no My competitors tab left", !(await tabsNow()).some((x) => x.id === "list" || /My competitors/.test(x.text)));
  });

  // ---- 2. seven tabs, in order ------------------------------------------------------------------
  await part("2 tabs", async () => {
    const tabs = (await tabsNow()).map((x) => x.text);
    check("2. seven tabs, in order: Competitors, Find, Keyword check, Page vs page, Link gaps, AI Overview, Notes", tabs.length === 7 && TABS_EN.every((re, i) => re.test(tabs[i] || "")), tabs.join(" · "));
  });

  // ---- 3. the merged table's columns ------------------------------------------------------------
  await part("3 columns", async () => {
    const heads = await headsNow();
    check("3. one site: Competitor, Ranks on your keywords, Who leads, Edits in 30 days, Watching, Tracking", JSON.stringify(heads.slice(0, 6)) === JSON.stringify([...HEADS_EN, "Tracking"]), heads.join(" | "));
    check("3. one site: 'Your sites' is hidden", !heads.includes("Your sites"));
    const rows = await page.evaluate(() => [...document.querySelectorAll("#cs-rivals-table tbody tr")].map((tr) => ({ remove: (tr.querySelector("[data-cl-remove]")?.getAttribute("aria-label") || ""), tracking: tr.querySelectorAll("[data-ct-set]").length })));
    check("3. one site: every row has Remove and the tracking choice", rows.length > 0 && rows.every((r) => /^Remove/.test(r.remove) && r.tracking === 3), rows);
    if (await page.$('#comp-site option[value="all"]')) {
      await page.selectOption("#comp-site", "all"); await tableReady(); await settle();
      const all = await headsNow();
      const extras = await page.evaluate(() => document.querySelectorAll("#cs-rivals-table [data-cl-remove], #cs-rivals-table [data-ct-set]").length);
      check("3. All my sites: 'Your sites' shows, Tracking and Remove don't", all.includes("Your sites") && !all.includes("Tracking") && extras === 0, `${all.join(" | ")} · ${extras} row buttons`);
      await page.selectOption("#comp-site", String(site.id)); await tableReady(); await settle();
      check("3. back to one site: 'Your sites' goes again", !(await headsNow()).includes("Your sites"));
    } else skip("3. All my sites: 'Your sites' shows, Tracking and Remove don't", "this app has one site, so there is no All my sites");
  });

  // ---- 4. unknown is —, never a bare 0 ----------------------------------------------------------
  const cells = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#cs-rivals-table tbody tr[data-cs-row]")].map((tr) => {
    const cell = (label) => (tr.querySelector(`td[data-label="${label}"]`)?.textContent || "").replace(/\s+/g, " ").trim();
    return [tr.dataset.csRow, { ranks: cell("Ranks on your keywords"), leads: cell("Who leads"), edits: cell("Edits in 30 days") }];
  })));
  await part("4 unknowns", async () => {
    await openSummary();
    const server = (await call(BASE, "GET", `collective/rivals?site_id=${site.id}`)).rivals;
    const shown = await cells();
    const wrong = [], seen = [];
    for (const r of server) {
      const c = r.crawl || {}, got = shown[r.id];
      if (!got) continue;
      if (r.ranks_on === null || r.ranks_on === undefined) { seen.push(`${r.host} ranks`); if (got.ranks !== "—" || got.leads !== "—") wrong.push(`${r.host}: ranks "${got.ranks}", who leads "${got.leads}"`); }
      if (c.status === "blocked" || !c.status || c.status === "none" || c.status === "queued" || !c.baseline_done) { seen.push(`${r.host} edits`); if (got.edits !== "—") wrong.push(`${r.host}: edits "${got.edits}"`); }
    }
    if (seen.length) check("4. demo rows: a number the app doesn't know shows —", wrong.length === 0, wrong.length ? wrong : seen.join(", "));
    else skip("4. demo rows: a number the app doesn't know shows —", "every competitor of this site is read and checked; the next line covers it with a made-up answer");

    // The same server answer with one competitor never checked and never read.
    const target = server[server.length - 1];
    await page.route("**/api/collective/rivals*", async (route) => {
      const reply = await route.fetch(), body = await reply.json();
      const r = (body.rivals || []).find((x) => x.id === target.id);
      if (r) Object.assign(r, { ranks_on: null, they_ahead: null, i_ahead: null, not_found: null, edits_30d: 0, crawl: { ...(r.crawl || {}), status: "none", baseline_done: false, message: null } });
      await route.fulfill({ response: reply, json: body });
    });
    await openSummary();
    const fake = (await cells())[target.id];
    await page.unroute("**/api/collective/rivals*");
    check("4. never checked, never read: ranks, who leads and edits all show —, not 0", fake && fake.ranks === "—" && fake.leads === "—" && fake.edits === "—", fake);
  });

  // ---- 5. Try again doesn't open the competitor -------------------------------------------------
  await part("5 try again", async () => {
    // The demo has no failed read, so the first competitor's read is shown as failed (same answer, one field changed),
    // and the request for a new read is answered here so nothing is really read.
    const target = rivals.find((c) => c.crawl?.status === "ok") || rivals[0];
    let asked = 0;
    await page.route("**/api/collective/rivals*", async (route) => {
      const reply = await route.fetch(), body = await reply.json();
      const r = (body.rivals || []).find((x) => x.id === target.id);
      if (r) r.crawl = { ...(r.crawl || {}), status: "failed", message: "The site didn't answer." };
      await route.fulfill({ response: reply, json: body });
    });
    await page.route("**/api/competitors/*/crawl*", (route) => { if (route.request().method() !== "POST") return route.continue(); asked += 1; return route.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
    await openSummary();
    const button = page.locator(`#cs-rivals-table [data-cl-retry="${target.id}"]`);
    if (!(await button.count())) {
      check("5. a failed read shows Try again in its row", false, `no [data-cl-retry="${target.id}"] in #cs-rivals-table; the cell says "${await page.locator(`[data-cl-watch="${target.id}"]`).textContent().catch(() => "")}"`);
    } else {
      check("5. a failed read shows Try again in its row", /Try again/.test(await button.textContent()));
      await button.click(); await settle(1500);
      const after = { profile: await onProfile(), table: Boolean(await page.$("#cs-rivals-table")), hash: await page.evaluate(() => location.hash), asked };
      check("5. Try again asks for a read and doesn't open the competitor", !after.profile && after.table && asked === 1, after);
    }
    await page.unroute("**/api/collective/rivals*");
    await page.unroute("**/api/competitors/*/crawl*");
  });

  // ---- 6. tracking: three states, and the row stays where it is ---------------------------------
  await part("6 tracking", async () => {
    await openSummary();
    const before = await rowIds(), first = before[0];
    const words = await page.evaluate((id) => [...document.querySelectorAll(`#cs-rivals-table [data-cs-row="${id}"] [data-ct-set]`)].map((b) => `${b.dataset.ctSet}:${b.textContent.trim()}`), first);
    check("6. tracking has three states: On, Pages only, Off", words.join() === "on:On,pages:Pages only,off:Off", words.join());
    const pressed = (to) => page.getAttribute(`#cs-rivals-table [data-ct-id="${first}"][data-ct-set="${to}"]`, "aria-pressed");
    const saved = async () => (await call(BASE, "GET", `competitors?site_id=${site.id}`)).competitors.find((c) => c.id === first)?.tracking;
    for (const to of ["pages", "off", "on"]) {
      await page.click(`#cs-rivals-table [data-ct-id="${first}"][data-ct-set="${to}"]`); await settle(1500);
      const now = await rowIds();
      check(`6. ${to}: saved, and the row stays in place`, (await pressed(to)) === "true" && (await saved()) === to && now.join() === before.join(), `rows ${before.join()} -> ${now.join()}`);
    }
  });
  for (const c of rivals) await setTracking(c.id, "on");

  // ---- 6b. every competitor Off: the line above the tabs counts them as the table does ----------
  // The server's summary only lists competitors with tracking On. The table adds the others from the list answer, and so must the banner:
  // it once said "No competitors yet" over a table that listed them.
  await part("6b all off", async () => {
    for (const c of rivals) await setTracking(c.id, "off");
    try {
      await openSummary();
      await page.waitForFunction((n) => document.querySelectorAll("#cs-rivals-table tbody tr[data-cs-row]").length === n, rivals.length, { timeout: 15000 }).catch(() => {});
      await settle(1500); // the banner's own answer
      const s = await page.evaluate(() => ({ rows: document.querySelectorAll("#cs-rivals-table tbody tr[data-cs-row]").length, paused: [...document.querySelectorAll("#cs-rivals-table tbody tr[data-cs-row]")].filter((tr) => /Paused/.test(tr.textContent)).length, state: document.querySelector("#comp-setup .comp-setup")?.dataset.setupState || "", banner: (document.querySelector("#comp-setup")?.textContent || "").replace(/\s+/g, " ").trim(), find: document.querySelectorAll("#comp-setup [data-cl-go-find]").length }));
      check("6b. all Off: the table still lists every competitor, each Paused", s.rows === rivals.length && s.paused === rivals.length, s);
      check("6b. all Off: the banner doesn't say there are no competitors", !["nothing", "no-rivals"].includes(s.state) && !/No competitors/.test(s.banner) && s.find === 0, s);
      if (process.env.COMP_SHOT) await page.screenshot({ path: process.env.COMP_SHOT });
    } finally {
      for (const c of rivals) await setTracking(c.id, "on");
    }
    const back = (await call(BASE, "GET", `competitors?site_id=${site.id}`)).competitors;
    check("6b. every competitor is back On", back.every((c) => c.tracking === "on"), back.map((c) => `${c.host}:${c.tracking}`).join());
  });

  // ---- 7. the profile is one card ---------------------------------------------------------------
  const open1 = rivals.find((c) => c.crawl?.status === "ok") || rivals[0];
  await part("7 profile", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openProfile(open1.id);
    const p = await page.evaluate(() => {
      const head = document.querySelectorAll("#comp-body section.card.cl-head"), card = head[0];
      const kids = card ? [...card.parentElement.children] : [];
      const row = document.querySelector("#pt-panel table tbody tr");
      return {
        back: [...document.querySelectorAll("#main [data-cl-back]"), ...[...document.querySelectorAll("#main a, #main button")].filter((el) => /^\s*(←\s*)?(Back|Retour)\b/i.test(el.textContent) || /^(Back|Retour)\b/i.test(el.getAttribute("aria-label") || ""))].map((el) => el.outerHTML.slice(0, 120)),
        cards: head.length,
        inCard: card ? ["#cl-profile-title", ".ct-switch", "[data-cl-read]", "[data-cl-remove]", ".cl-head-meta", ".pt-answer", ".pt-strip"].filter((s) => !card.querySelector(s)) : ["no card"],
        next: kids[kids.indexOf(card) + 1]?.className || "",
        tiles: document.querySelectorAll("#comp-body .tile").length,
        figures: [...document.querySelectorAll("#comp-body .cl-head .pt-strip .pt-fig .pt-fig-lab")].map((x) => x.textContent.trim()),
        tab: document.querySelector('[data-pt-tab][aria-selected="true"]')?.dataset.ptTab,
        scroll: document.querySelector("#main")?.scrollTop || 0,
        rowTop: row ? Math.round(row.getBoundingClientRect().top) : null,
      };
    });
    check("7. no Back link on the profile", p.back.length === 0, p.back);
    check("7. one card holds the name, tracking, actions, the answer and the figures, with the tabs right under it", p.cards === 1 && p.inCard.length === 0 && /pt-tabs/.test(p.next) && p.tiles === 0, { cards: p.cards, missing: p.inCard, next: p.next, tiles: p.tiles });
    const four = p.figures.slice(0, 4).join() === "Shared keywords,Only them,Only you,Pages";
    check("7. the figure strip has 4 figures (a fifth only for Authority, when a score is known)", four && (p.figures.length === 4 || (p.figures.length === 5 && p.figures[4] === "Authority")), p.figures.join(" · "));
    check("7. the profile opens on Keywords", p.tab === "keywords", p.tab);
    check("7. the first keyword row starts above y=600 at 1440×900", p.rowTop !== null && p.scroll === 0 && p.rowTop < 600, `y=${p.rowTop}`);
  });

  // ---- 10. page paths are links (the profile, on the real answer) -------------------------------
  const linkCheck = async (where) => {
    const s = await page.evaluate(survey);
    const bad = s.links.filter((l) => !/^https?:\/\/[^/]+/.test(l.href || "") || l.target !== "_blank");
    const name = `10. ${where}: every page path is a PageLink`;
    if (!s.links.length && !s.plain.length && !s.otherLinks.length) { skip(name, `no bare page path on this screen with the demo data${s.addresses ? `; ${s.addresses} full addresses are links made by COMP.link (a.comp-url), not PageLink` : ""}`); return; }
    check(name, bad.length === 0 && s.plain.length === 0 && s.otherLinks.length === 0, `${s.links.length} page links${s.links[0] ? `, e.g. ${s.links[0].text}` : ""}${s.plain.length ? ` · plain text: ${s.plain.slice(0, 5).join(" ")}` : ""}${s.otherLinks.length ? ` · links not made by PageLink: ${s.otherLinks.slice(0, 5).join(" ")}` : ""}${bad.length ? ` · not a full address in a new tab: ${JSON.stringify(bad.slice(0, 2))}` : ""}`);
  };
  await part("10 page links, profile", async () => {
    if (!(await onProfile())) await openProfile(open1.id);
    for (const id of ["keywords", "pages", "activity", "site"]) {
      await page.click(`[data-pt-tab="${id}"]`); await settle(700);
      await linkCheck(`profile, ${id}`);
    }
  });

  // ---- 8. questions: in pages, a Task each -------------------------------------------------------
  await part("8 questions", async () => {
    // 79 made-up questions on the real answer, as flow_competitor_profile_ux.cjs does: the demo competitor has too few for Show more.
    await page.route("**/api/competitors/*/insights*", async (route) => {
      const reply = await route.fetch(), body = await reply.json();
      body.questions = fakeQuestions(open1.host, "coffee beans");
      await route.fulfill({ response: reply, json: body });
    });
    await openProfile(open1.id);
    await page.click('[data-pt-tab="pages"]'); await settle(700);
    // Since 2026-11-10 long lists come in pages of 25 (table-pages.js) instead of Show more: the 15 pages on my topics fit on one.
    const q = await page.evaluate(() => { const rows = [...document.querySelectorAll("#pt-questions > li")]; return { rows: rows.length, tasks: rows.filter((li) => /Task|Tâche/.test(li.querySelector(".pt-act button")?.textContent || "")).length, more: Boolean(document.querySelector("[data-pt-q-more]")), foot: document.querySelector('[data-tp-foot="pt-q"] .tp-range')?.textContent.trim() || "" }; });
    check("8. questions: the 15 pages on my topics, in pages with the total", q.rows === 15 && !q.more && q.foot === "1–15 of 15 pages", q);
    check("8. every page of questions has a Task button", q.rows > 0 && q.tasks === q.rows, `${q.tasks}/${q.rows}`);
    await page.unroute("**/api/competitors/*/insights*");
  });

  // ---- 10. page paths are links (Link gaps, Page vs page) ---------------------------------------
  await part("10 page links, tabs", async () => {
    await fresh(at("gaps")); await page.waitForSelector("#comp-body table, #comp-body .empty", { timeout: 15000 }); await settle();
    await linkCheck("Link gaps");
    await fresh(at("pairs")); await page.waitForSelector("#cp-table, #comp-body .empty", { timeout: 15000 }); await settle();
    await page.locator('[data-cp-verdict="all"]').click().catch(() => {}); await settle(600);
    await linkCheck("Page vs page, the list");
    const compare = page.locator("#cp-table [data-cp-open]").first();
    if (await compare.count()) { await compare.click(); await settle(2000); await linkCheck("Page vs page, one pair"); }
    else skip("10. Page vs page, one pair: every page path is a PageLink", "no pair to open in this app");
  });

  // ---- 11. no sideways scroll -------------------------------------------------------------------
  await part("11 sideways scroll", async () => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await openSummary();
      let w = await page.evaluate(widths);
      check(`11. no sideways scroll at ${width}: Competitors tab`, fits(w), w);
      await openProfile(open1.id);
      w = await page.evaluate(widths);
      check(`11. no sideways scroll at ${width}: a profile`, fits(w), w);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  // ---- 12. French -------------------------------------------------------------------------------
  await part("12 French", async () => {
    await openSummary(); await lang("fr"); await tableReady();
    const tabs = (await tabsNow()).map((x) => x.text), heads = await headsNow();
    check("12. French: the seven tab names", tabs.join("|") === TABS_FR.join("|"), tabs.join(" · "));
    check("12. French: the merged table's headers", heads.slice(0, 6).join("|") === HEADS_FR.join("|"), heads.join(" | "));
    const words = await page.evaluate(() => `${document.querySelector(".comp-tabs")?.textContent || ""} ¦ ${document.querySelector(".comp-bar label span")?.textContent || ""} ¦ ${document.querySelector("#cs-rivals")?.textContent || ""}`.replace(/\s+/g, " "));
    const left = words.match(new RegExp(EN_LEFT.source, "g")) || [];
    check("12. French: no English left in the tabs and the competitors table", left.length === 0, [...new Set(left)].join(", "));
    const w = await page.evaluate(widths);
    check("12. French: no sideways scroll at 1440 on the Competitors tab", fits(w), w);
    await lang("en");
  });

  // ---- 9. the empty app: what to do next --------------------------------------------------------
  await part("9 setup banner", async () => {
    await page.goto("about:blank"); await page.goto(`${EMPTY}#today`); await settle(800);
    let sites = (await call(EMPTY, "GET", "links/sites")).sites;
    if (!sites.length) {
      await fresh("competitors", EMPTY); await page.waitForSelector("#comp-no-sites", { timeout: 15000 });
      const none = await page.evaluate(() => ({ words: document.querySelector("#comp-no-sites h3")?.textContent, add: document.querySelector("#comp-no-sites #site-add")?.textContent.trim(), banner: Boolean(document.querySelector(".comp-setup")) }));
      check("9. no site yet: one message, with Add a site", none.words === "No sites added yet" && none.add === "Add a site" && !none.banner, none);
    } else skip("9. no site yet: one message, with Add a website", `${EMPTY} already has ${sites.length} site(s); start it again with --empty to see this`);
    let mine = sites.find((s) => s.host === BANNER_SITE);
    if (!mine) { await call(EMPTY, "POST", "sites", { address: BANNER_SITE, kind: "own" }); sites = (await call(EMPTY, "GET", "links/sites")).sites; mine = sites.find((s) => s.host === BANNER_SITE); }
    if (!mine) { check("9. the setup banner shows on the empty app", false, `couldn't add ${BANNER_SITE} to ${EMPTY}`); return; }
    await fresh(`competitors/summary?site=${BANNER_SITE}`, EMPTY);
    await page.waitForSelector("#comp-site", { timeout: 15000 });
    if ((await page.inputValue("#comp-site")) !== String(mine.id)) await page.selectOption("#comp-site", String(mine.id));
    const banner = async () => { await page.waitForSelector("#comp-setup .comp-setup", { timeout: 10000 }).catch(() => {}); return page.evaluate(() => { const b = document.querySelector("#comp-setup .comp-setup"); return b && { state: b.dataset.setupState, words: b.querySelector(".comp-setup-words")?.textContent.trim(), buttons: [...b.querySelectorAll(".comp-setup-acts button")].map((x) => x.textContent.trim()), main: b.querySelector(".comp-setup-acts .btn-main")?.textContent.trim(), aboveBody: Boolean(b.compareDocumentPosition(document.querySelector("#comp-body")) & Node.DOCUMENT_POSITION_FOLLOWING) }; }); };
    const en = await banner();
    check("9. the setup banner shows on the empty app, above the tab's body", Boolean(en) && en.aboveBody, en || "no #comp-setup .comp-setup");
    check("9. it says what's missing for this site", Boolean(en) && en.state === "nothing" && en.words === `No competitors and no keyword list for ${BANNER_SITE} yet.`, en?.words);
    check("9. its buttons say what to do next: Find competitors (main), Add keywords", Boolean(en) && en.buttons.join("|") === "Find competitors|Add keywords" && en.main === "Find competitors", en?.buttons);
    const w = await page.evaluate(widths);
    check("9. no sideways scroll with the banner at 1440", fits(w), w);

    await lang("fr");
    const fr = await banner();
    check("12. French: the setup banner and its buttons", Boolean(fr) && fr.words === `Pas encore de concurrents ni de liste de mots-clés pour ${BANNER_SITE}.` && fr.buttons.join("|") === "Trouver des concurrents|Ajouter des mots-clés", fr);
    check("12. French: no English left in the banner", Boolean(fr) && !EN_LEFT.test(`${fr.words} ${fr.buttons.join(" ")}`), fr && `${fr.words} ${fr.buttons.join(" ")}`.match(EN_LEFT)?.[0]);
    await lang("en");

    if (en) {
      await page.click("#comp-setup [data-cl-go-find]"); await settle(1500);
      const there = await page.evaluate(() => ({ hash: location.hash, lit: document.querySelector('[data-comp-tab][aria-selected="true"]')?.dataset.compTab, banner: Boolean(document.querySelector("#comp-setup .comp-setup")) }));
      check("9. Find competitors in the banner opens that tab, and the banner stays above it", there.lit === "find" && there.hash.startsWith("#competitors/find") && there.banner, there);
    }
  });

  const real = problems.filter((p) => !/404/.test(p)); // /api/auth/me answers 404 when the test server runs without --login
  check("no page errors", real.length === 0, real.slice(0, 3).join(" | "));
  await browser.close();
  console.log(`\n${tally.pass} passed, ${tally.fail} failed, ${tally.skip} skipped`);
  process.exit(tally.fail ? 1 : 0);
})().catch((err) => { console.log(`FAIL  the flow stopped: ${err.message}`); process.exit(1); });
