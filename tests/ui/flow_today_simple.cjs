// Today with the simpler screens switch on (?simple=1, track T1 of phase 2, 2026-11-12), used the way a person uses it.
// flow_today.cjs and flow_today_numbers.cjs keep checking the old Today (switch off); this one checks what the switch changes:
// the head (date line, period buttons, the sources chip), the setup line, three number cards with their own graph (no axis
// numbers, no "Show as a table"), Task on hover, "7 days" in the move cards, one call per visit kept 5 minutes, and the
// same behaviour as before for Mark as seen, Show all, links, a slow or failing answer, French, dark and a phone.
// Needs the real app on a port of your own:
//   DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8401 --slow 0
//   node tests/ui/flow_today_simple.cjs http://127.0.0.1:8401/ [screenshots folder]
const { open } = require("./pw.cjs");
const fs = require("fs");
const BASE = process.argv[2] || "http://127.0.0.1:8401/";
const OUT = (process.argv[3] || "reports/simplify-p2/t1/flow").replace(/\/$/, "");
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
let passed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (ok) passed += 1; else fails.push(what); };
const settle = (page, ms = 700) => page.waitForTimeout(ms);
const SITE = "site-one.example";
const url = (extra = "") => `${BASE}?flow=${Date.now()}&simple=1${extra}#today?site=${SITE}`;
const digits = (s) => Number(String(s || "").replace(/[^\d]/g, "")) || null;
const facts = (page) => page.evaluate(() => ({
  lead: [".today-verdict", ".today-state"].map((sel) => document.querySelector(sel)?.textContent || "").join(" ").trim(), second: document.querySelector(".today-second")?.textContent,
  badge: Number(document.querySelector('.nav-item[data-go="today"] .count')?.textContent || 0),
}));
const count = (s) => Number((String(s || "").match(/^(\d+)/) || [0, 0])[1]);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
// The comparison's own count: controls a person sees at rest (tests/ui/measure_screens.cjs).
const controls = (page) => page.evaluate(() => {
  const shown = (el) => { const r = el.getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) return false;
    let o = 1; for (let n = el; n && n !== document.body; n = n.parentElement) { const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden") return false; o *= Number(s.opacity); } return o > 0.05; };
  // A row's tick box stays faintly visible since 2026-11-12 (UI critique: hidden ones weren't discovered); it isn't counted here.
  const rowTick = (el) => el.matches('tbody :is(.tt-pick, .tt-own-pick) input[type="checkbox"]');
  // The Keywords by ranking card counts too since 2026-11-23: its tabs and switch moved into one View menu, so at rest it
  // brings its View button and the keyword links of its answer (every keyword is a link: keyword-links.js).
  return [...document.querySelector("#main").querySelectorAll("button,select,input,textarea,a[href],summary,[role=button],[role=tab]")].filter((el) => !rowTick(el)).filter(shown).length;
});
const visible = (page, sel) => page.$eval(sel, (el) => { let o = 1; for (let n = el; n && n !== document.body; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o > 0.5; });

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  const asked = [];
  page.on("request", (r) => { const m = r.url().match(/\/api\/([^#]*)/); if (m) asked.push(m[1]); });
  const api = (p) => page.evaluate((u) => fetch(u).then((r) => r.json()), `${BASE}api/${p}`);
  const go = async (route, ms = 1200) => { await page.click(`button[data-go="${route}"]`); await settle(page, ms); };

  // ---- first view
  await page.goto(url()); await page.waitForSelector(".today-verdict", { timeout: 20000 }); await settle(page, 1500);
  check(await page.evaluate(() => window.UI.simple() && document.documentElement.dataset.simple === "1"), "the switch is on");
  await page.mouse.move(5, 5); await settle(page, 300);
  await page.screenshot({ path: `${OUT}/1-today-1440.png` });
  const head = await page.evaluate(() => ({
    title: document.querySelector("#topbar h1")?.textContent,
    line: document.querySelector("#topbar .head-line")?.textContent.replace(/\s+/g, " ").trim(),
    presets: [...document.querySelectorAll("#topbar .head-period [data-preset]")].map((b) => `${b.dataset.preset}:${b.getAttribute("aria-pressed")}`),
    more: Boolean(document.querySelector("#topbar #period")), compare: Boolean(document.querySelector("#topbar #compare")),
    chip: document.querySelector('#topbar .head-line [data-go="settings"], #topbar .head-line [data-lv-connect], #topbar .head-line [data-today-connect]')?.textContent.trim(),
  }));
  check(head.title === "Today", "the head says Today");
  check(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \d+ \w+/.test(head.line) && /–/.test(head.line) && /vs /.test(head.line), `one date line: the day, the dates, the comparison: ${head.line}`);
  check(head.presets.join() === "7d:false,28d:true,3m:false,12m:false" && head.more && head.compare, `four period buttons and More, 28 days pressed: ${head.presets}`);
  check(/sources OK|connect Google/i.test(head.chip || ""), `the sources are one chip in the date line: ${head.chip}`);
  check(!(await page.$(".today-sources")), "the Data sources row has left My work");
  check(!(await page.$(".today-caption")), "no caption under the cards: the dates are in the head");
  check(!(await page.$(".today-moves-head")), "no Week on week line: each move card says 7 days");
  const moveHeads = await page.$$eval(".today-moves .card-head .end", (els) => els.map((x) => x.textContent.trim()));
  // Since the review fixes of 2026-11-17 the move cards name their two weeks ("14 Nov – 20 Nov vs 7 Nov – 13 Nov").
  check(moveHeads.length === 2 && moveHeads.every((x) => /(^|·)7 days$| vs /.test(x)), `Going down and Going up say their 7 days in their heads: ${moveHeads}`);
  const setup = await page.$(".setup-line");
  if (setup) {
    check((await setup.boundingBox()).height <= 60, "the setup card is one line");
    await page.click(".setup-line .setup-open"); await page.waitForSelector("#panel .setup-list", { timeout: 8000 });
    check(true, "the setup line opens the checklist");
    await page.keyboard.press("Escape"); await settle(page, 400);
  } else console.log("     every setup step is done in this world: no setup line");

  // ---- the three numbers
  const cards = await page.$$eval(".today-nums .ncard", (els) => els.map((el) => ({ id: el.dataset.card, href: el.getAttribute("href"), tall: el.classList.contains("is-tall"), graph: Boolean(el.querySelector(".ncard-graph")), fig: el.querySelector(".ncard-fig")?.textContent.trim(), sub: el.querySelector(".ncard-rest")?.textContent.trim() })));
  check(cards.map((c) => c.id).join() === "leads,visits,clicks", `three number cards, Leads, Visits, Google clicks: ${JSON.stringify(cards)}`);
  check(cards.every((c) => c.tall && c.graph), "each card has its own tall graph");
  check(cards.map((c) => (c.href || "").split("?")[0]).join() === "#conversions,#channels,#overview" && cards.every((c) => c.href.includes(`site=${SITE}`)), "each card opens its screen, keeping the site");
  check(!(await page.$(".today-num [data-lv-chart], [data-lv-table]")) && !(await page.$(".today-num .lv-ylab")), "no axis numbers and no Show as a table on the cards");
  const answer = await api(`today?site_id=1&range=28d&compare=prev`);
  check(digits(cards[2].fig) === answer.results.clicks.value && digits(cards[1].fig) === answer.results.visits.value, `the figures are the server's: ${cards[1].fig} / ${cards[2].fig}`);
  check(cards.slice(1).every((c) => /→/.test(c.sub || "")), `before → now under Visits and Google clicks: ${cards.slice(1).map((c) => c.sub)}`);
  const graph = await page.$('.ncard[data-card="visits"] .ncard-graph');
  const box = await graph.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2); await settle(page, 200);
  const read = await page.$eval('.ncard[data-card="visits"] .ncard-read', (x) => x.textContent);
  check(/\d/.test(read) && /before/.test(read), `hovering a graph reads that day: ${read}`);
  await page.mouse.move(5, 5); await settle(page, 200);
  await page.focus('.ncard[data-card="clicks"]'); await page.keyboard.press("End"); await settle(page, 150);
  const keyed = await page.$eval('.ncard[data-card="clicks"] .ncard-read', (x) => x.textContent);
  check(/\d/.test(keyed), `the arrow keys read a graph: ${keyed}`);
  await page.keyboard.press("Escape");
  const leadsTip = await page.$eval('.ncard[data-card="leads"]', (x) => x.dataset.tip || "");
  check(/running total/.test(leadsTip), "Graph: running total is behind the Leads card's (i)");

  // ---- the to-do: Task on hover, Mark as seen, Show all
  await page.mouse.move(5, 5); await settle(page, 300);
  check(!(await visible(page, "[data-row] .row-act")), "Task is hidden at rest");
  await page.hover("[data-row] .what"); await settle(page, 300);
  check(await visible(page, "[data-row] .row-act"), "and shows on the row's hover");
  await page.mouse.move(5, 5); await settle(page, 300);
  const n = await controls(page);
  const inCard = await page.evaluate(() => [...document.querySelectorAll(".rt-card button, .rt-card a[href]")].filter((el) => el.getBoundingClientRect().width > 1).length);
  // 47 with the Keywords by ranking card's five tabs and switches, its Show more and its link (2026-11-23); 41 with them in
  // its View menu: 35 elsewhere + View + its five keyword links. Target about 33.
  check(n <= 41 && inCard <= 6, `controls at rest: ${n}, ${inCard} of them in the Keywords by ranking card (47 before its View menu)`);
  const f = await facts(page);
  check(count(f.second) === f.badge, `the headline count ${count(f.second)} matches the menu badge ${f.badge}`);
  const drop = await page.$("[data-lv-drop]");
  check(Boolean(drop), "a big page drop is in the to-do with Mark as seen");
  if (drop) {
    const key = await drop.getAttribute("data-lv-drop");
    asked.length = 0;
    await drop.click(); await settle(page, 1200);
    const after = await facts(page);
    check(after.badge === f.badge - 1 && count(after.second) === after.badge, "Mark as seen lowers the headline and the badge together");
    check(asked.filter((p) => p.startsWith("today?")).length === 1, `and asks for Today once: ${asked.join(", ")}`);
    await page.click(".toast button"); await settle(page, 1200);
    check((await facts(page)).badge === f.badge, "Undo brings it back");
    await page.evaluate((k) => window.COMP.api("POST", "today/seen", { key: k, seen: false }), key);
  }
  const all = await page.$("#show-all");
  if (all) {
    const before = await page.$$eval("[data-row]", (els) => els.length);
    await all.click(); await settle(page, 300);
    check((await page.$$eval("[data-row]", (els) => els.length)) > before, "Show all shows every row");
    await page.click("#show-all"); await settle(page, 200);
  }

  // ---- one call, kept: no backlinks/summary, no re-ask within 5 minutes
  await page.goto("about:blank"); asked.length = 0;
  await page.goto(url()); await page.waitForSelector(".today-num", { timeout: 20000 }); await settle(page, 1500);
  const own = asked.filter((p) => /^(today|backlinks\/summary)/.test(p));
  check(own.length === 1 && /include=.*backlinks/.test(own[0]), `Today opens with one call: ${own.join(", ")}`);
  await settle(page, 11000); // longer than the old 10-second re-ask
  asked.length = 0;
  await go("tasks", 600); await go("today", 1200);
  check(!asked.some((p) => p.startsWith("today?")), `coming back within 5 minutes asks nothing: ${asked.filter((p) => p.startsWith("today")).join(", ") || "no call"}`);
  check(await page.$$eval(".today-nums .ncard", (els) => els.length) === 3, "and shows the numbers at once");

  // ---- the period buttons
  await page.click('#topbar .head-period [data-preset="7d"]'); await settle(page, 1800);
  const seven = await api("today?site_id=1&range=7d&compare=prev");
  const fig7 = digits(await page.textContent('.ncard[data-card="clicks"] .ncard-fig'));
  check(fig7 === seven.results.clicks.value, `7 days in the head: Google clicks ${fig7}, the server's ${seven.results.clicks.value}`);
  check(await page.$eval('#topbar [data-preset="7d"]', (b) => b.getAttribute("aria-pressed") === "true"), "and 7 days is pressed");
  await page.click('#topbar .head-period [data-preset="28d"]'); await settle(page, 1500);

  // ---- links land where they say
  await page.click('.ncard[data-card="clicks"]'); await settle(page, 1500);
  check(page.url().includes("#overview"), "Google clicks opens Overview");
  await page.goBack(); await page.waitForSelector(".today-num"); await settle(page, 600);
  const seePage = await page.$("[data-today-page]");
  if (seePage) {
    const wanted = await seePage.getAttribute("data-today-page");
    await seePage.click(); await settle(page, 1800);
    const where = await page.evaluate(() => ({ tab: window.OV?.tab, q: window.OV?.filters?.page?.q, route: window.UI.state.route }));
    check(where.route === "overview" && where.tab === "page" && where.q === wanted, `See page opens Overview → Pages on that page: ${JSON.stringify(where)}`);
    await page.evaluate(() => window.UI.range.set({ preset: "28d" }));
  }
  await page.goto(url()); await page.waitForSelector(".today-num"); await settle(page, 1200);
  const compare = await page.$("[data-today-pair]");
  if (compare) { await compare.click(); await page.waitForSelector("#cp-back", { timeout: 8000 }); check(true, "Compare opens the pair"); }
  await page.goto(url()); await page.waitForSelector(".today-num"); await settle(page, 1000);
  const chip = await page.$('#topbar .head-line [data-go="settings"]');
  if (chip) { await chip.click(); await settle(page, 800); check((await page.evaluate(() => window.UI.state.route)) === "settings", "the sources chip opens Settings"); }

  // ---- French, dark, phone
  await page.goto(url("&lang=fr")); await page.waitForSelector(".today-num"); await settle(page, 1500);
  const fr = await page.evaluate(() => ({ lead: document.querySelector(".today-verdict").textContent, title: document.querySelector("#topbar h1").textContent, seven: document.querySelector('#topbar [data-preset="7d"]').textContent, label: document.querySelector('.ncard[data-card="visits"] .ncard-name').textContent, heads: [...document.querySelectorAll(".today-moves .card-head .end")].map((x) => x.textContent), rows: [...document.querySelectorAll("[data-row] .t")].map((x) => x.textContent) }));
  check(/à traiter|Rien d'urgent|Urgent/.test(fr.lead) && fr.title === "Aujourd'hui" && fr.seven === "7 jours" && fr.label === "Visites" && fr.heads.every((x) => /(^|·)7 jours$| vs /.test(x)), `French: ${JSON.stringify({ ...fr, rows: undefined })}`);
  check(!fr.rows.some((r) => /\b(lost|clicks|no longer|health fell)\b/i.test(r)), "the to-do rows are in French");
  await page.mouse.move(5, 5); await page.screenshot({ path: `${OUT}/2-today-1440-fr.png` });
  await page.goto(url("&theme=dark&lang=en")); await page.waitForSelector(".today-num"); await settle(page, 1500);
  await page.mouse.move(5, 5); await page.screenshot({ path: `${OUT}/3-today-1440-dark.png` });
  for (const extra of ["&theme=light", "&theme=dark&lang=fr"]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url(extra)); await page.waitForSelector(".today-num"); await settle(page, 1500);
    check(!(await overflow(page)), `390 px phone${extra}: no sideways scroll`);
    await page.screenshot({ path: `${OUT}/4-today-390${extra.replace(/[&=]/g, "-")}.png`, fullPage: true });
  }
  await page.goto(url("&theme=light&lang=en")); await page.waitForSelector(".today-num"); await settle(page, 600);
  await page.setViewportSize({ width: 1440, height: 900 });

  // ---- a slow answer: one ask at a time (F5)
  let hits = 0;
  await page.route(/\/api\/today\?/, async (route) => { hits += 1; await new Promise((r) => setTimeout(r, 12000)); await route.continue().catch(() => {}); });
  await page.goto("about:blank"); await page.goto(url()); await settle(page, 20000);
  check(hits <= 2, `a 12-second answer is asked for twice at most in 20 s: ${hits}`);
  await page.unroute(/\/api\/today\?/);
  // ---- a failing answer: not asked again by itself, Try again brings it back
  hits = 0;
  await page.route(/\/api\/today\?/, (route) => { hits += 1; route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Server down for the test" }) }); });
  await page.goto("about:blank"); await page.goto(url()); await settle(page, 6000);
  const atStart = hits;
  await settle(page, 15000);
  check(hits === atStart && atStart <= 3, `a failure is not asked again by itself: ${atStart} at the start, ${hits - atStart} after`);
  check(Boolean(await page.$("[data-today-retry]")), "and offers Try again");
  await page.screenshot({ path: `${OUT}/5-today-failed.png` });
  await page.unroute(/\/api\/today\?/);
  await page.click("[data-today-retry]"); await page.waitForSelector(".today-num", { timeout: 15000 });
  check(true, "Try again brings Today back");

  // ---- the switch off: Today exactly as before
  await page.goto(`${BASE}?flow=${Date.now()}&simple=0#today?site=${SITE}`); await page.waitForSelector(".today-num", { timeout: 20000 }); await settle(page, 1500);
  const old = await page.evaluate(() => ({ simple: window.UI.simple(), ncards: document.querySelectorAll(".ncard").length, charts: document.querySelectorAll(".today-num [data-lv-chart]").length, caption: Boolean(document.querySelector(".today-caption")), sources: Boolean(document.querySelector(".today-sources, .stat-row [data-lv-connect], .stat-row [data-today-connect]")), rowAct: document.querySelectorAll(".row-act").length }));
  check(!old.simple && !old.ncards && old.charts === 3 && old.caption && old.sources && !old.rowAct, `with the switch off Today is as before: ${JSON.stringify(old)}`);

  const seen = problems.filter((x) => !/favicon|status of 404|status of 500/.test(String(x)));
  check(!seen.length, `no page errors: ${JSON.stringify(seen).slice(0, 400)}`);
  await browser.close();
  console.log(fails.length ? `\n${passed} passed, ${fails.length} FAILED:\n- ${fails.join("\n- ")}` : `\nall ${passed} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
