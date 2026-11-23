// Screens open instantly (plan-seo-command-center-simplify-screens-like-mickaz.md, change 7; track E, 2026-11-11).
// With the simpler-screens switch on (?simple=1), for every screen that loads through window.SCREEN_DATA (screen-data.js):
//   1. after the first screen has drawn, the warm-up fetches the other screens' answers one at a time, at least 250 ms apart;
//   2. a first visit after it asks nothing for the screen's answers and draws its data in under 50 ms, with no loading card;
//   3. a second visit makes no request at all (logo images come from the browser's cache) and draws in under 50 ms;
//   4. a pointer resting 80 ms on a menu item fetches that screen first, and the click then asks nothing; passing asks nothing;
//   5. a new site or period forgets everything; an answer older than 5 minutes, or one asked before a change was sent,
//      shows at once and is asked again quietly;
//   6. a hidden tab pauses the warm-up, and a 429 stops it;
//   7. get() answers from memory with a copy, and logo looks (SCREEN_DATA.logos) go through the queue, 5 s apart, only
//      while a letter on the page waits for its logo.
// With the switch off, SCREEN_DATA asks nothing, holds nothing and leaves fetch alone.
// Which screens: those that called SCREEN_DATA.screen(). Before Phase 2 none has, so the flow turns on the opt-in hook
// SCREEN_DATA.adoptLV(): Channels, Conversions, Content and AI search then load through it. Once the Phase 2 tracks register
// Today, Overview, Insights, Keywords and Competitors, steps 2, 3 and 5 check them too, with no change here.
// Requests on the page's own clock (the bell, Health's alerts, Today's menu badge, the logo-list looks of the pollers that
// Phase 2 folds into SCREEN_DATA.logos()) are listed apart, not counted against a visit.
// Needs a demo world, made-up sites only:  DB_NAME_TEST=<name>_test .venv/bin/python tests/ui/app_server.py --port 8284 --slow 0
// Run:  BASE=http://127.0.0.1:8284 node tests/ui/flow_screen_speed.cjs
const { open } = require("./pw.cjs");
const BASE = (process.env.BASE || "http://127.0.0.1:8284").replace(/\/$/, "");
const fails = [];
const check = (ok, what, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${extra !== "" ? `  [${extra}]` : ""}`); if (!ok) fails.push(what); };
const BACKGROUND = /^api\/(notifications|alerts|logos|today\/attention)(\?|$)/;
const LOADING = "#page [aria-busy='true']:not(button), #page .comp-skel";
const SD = (page, fn, arg) => page.evaluate(fn, arg);
const short = (list) => list.map((r) => `${r.method && r.method !== "GET" ? `${r.method} ` : ""}${r.url.slice(0, 60)}`).join(", ");

/* Every /api/ request the page sends, and whether the browser answered it from its own cache (so no server saw it). */
async function network(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const seen = new Map();
  cdp.on("Network.requestWillBeSent", (e) => {
    const url = e.request.url.replace(/^https?:\/\/[^/]+\//, "");
    if (url.startsWith("api/")) seen.set(e.requestId, { url, method: e.request.method, at: Date.now(), cached: false });
  });
  cdp.on("Network.requestServedFromCache", (e) => { const r = seen.get(e.requestId); if (r) r.cached = true; });
  cdp.on("Network.responseReceived", (e) => {
    const r = seen.get(e.requestId);
    if (r && (e.response.fromDiskCache || e.response.fromPrefetchCache || e.response.fromServiceWorker)) r.cached = true;
  });
  return (since) => [...seen.values()].filter((r) => r.at >= since);
}

/* Click a menu item and time it: the click's own draw, and until the next frame is painted. Then wait for what it asks.
   own: what reached the server for this visit. Apart: the pollers' requests, and the warm-up's quiet asks for other screens
   that happened to run meanwhile (SCREEN_DATA.log() names them). */
async function visit(page, sent, route, settle = 1500) {
  const since = Date.now();
  const timing = await page.evaluate(async ({ r, loading }) => {
    const button = document.querySelector(`#sidebar button[data-go="${r}"]`);
    const t0 = performance.now();
    button.click();
    const drawn = performance.now() - t0;
    await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
    return { t0: Math.round(t0) - 1, drawn: Math.round(drawn), painted: Math.round(performance.now() - t0), loading: Boolean(document.querySelector(loading)) };
  }, { r: route, loading: LOADING });
  await page.waitForTimeout(settle);
  const warmed = new Set((await page.evaluate(() => window.SCREEN_DATA.log())).filter((x) => x.quiet && x.start >= timing.t0).map((x) => `api/${x.path}`));
  const server = sent(since).filter((r) => !r.cached);
  const apart = (r) => BACKGROUND.test(r.url) || warmed.has(r.url);
  return { ...timing, own: server.filter((r) => !apart(r)), background: server.filter(apart) };
}
const away = async (page) => { await page.click('#sidebar button[data-go="tasks"]'); await page.waitForTimeout(500); };
const log = (page) => page.evaluate(() => window.SCREEN_DATA.log());
const quietSince = (list, t) => list.filter((x) => x.quiet && x.start >= t);
const nowIn = (page) => page.evaluate(() => Math.round(performance.now()));
const until = async (page, test, ms, arg) => { const end = Date.now() + ms; while (Date.now() < end) { if (await page.evaluate(test, arg)) return true; await page.waitForTimeout(150); } return false; };
const warmDone = () => { const s = window.SCREEN_DATA.stats(); return s.queue === 0 && s.flying === 0 && s.rounds >= 1; };
const pickSite = (host) => { const s = window.SITES.find((x) => x.host === host); window.UI.state.site = s.id; window.UI.render(); return s.realId; };
const middleOf = async (page, route) => { const r = await page.locator(`#sidebar button[data-go="${route}"]`).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };

(async () => {
  // ---- the switch off: nothing of it runs ---------------------------------------------------------------
  {
    const { browser, page, problems } = await open({ url: `${BASE}/?flow=${Date.now()}&simple=0#tasks` });
    page.setDefaultTimeout(10000);
    await page.waitForSelector(".nav-item"); await page.waitForTimeout(2500);
    await page.evaluate(pickSite, "site-one.example");
    await page.click('#sidebar button[data-go="channels"]'); await page.waitForTimeout(1500);
    const off = await page.evaluate(() => ({ stats: window.SCREEN_DATA.stats(), adopted: window.SCREEN_DATA.adoptLV(), lvIsAMap: window.LV.cache instanceof Map, log: window.SCREEN_DATA.log().length, fetch: window.fetch.name }));
    check(off.stats.on === false && !off.stats.watching && off.fetch !== "watchedFetch", "switch off: SCREEN_DATA is off and fetch isn't watched", JSON.stringify({ on: off.stats.on, watching: off.stats.watching, fetch: off.fetch }));
    check(off.stats.asked + off.stats.quiet === 0 && off.stats.held === 0 && off.log === 0, "switch off: it asked nothing and holds nothing", `${off.stats.asked + off.stats.quiet} asks`);
    check(off.adopted === false && off.lvIsAMap, "switch off: the opt-in hook does nothing, LV keeps its own cache");
    check(!problems.some((p) => p.startsWith("pageerror")), "switch off: no script error", problems.filter((p) => p.startsWith("pageerror")).join(" | "));
    await browser.close();
  }

  // ---- the switch on ------------------------------------------------------------------------------------------
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  page.setDefaultTimeout(10000);
  const sent = await network(page);
  await page.goto(`${BASE}/?flow=${Date.now()}&simple=1#tasks`);
  await page.waitForSelector(".nav-item");
  const siteOne = await page.evaluate(pickSite, "site-one.example");
  const registered = await SD(page, () => window.SCREEN_DATA.screens());
  const hooked = registered.length ? false : await SD(page, () => window.SCREEN_DATA.adoptLV());
  const screens = await SD(page, () => window.SCREEN_DATA.screens());
  console.log(`     screens through SCREEN_DATA: ${screens.join(", ")}${hooked ? " (the opt-in hook SCREEN_DATA.adoptLV(): no screen has registered yet)" : ""}`);
  const menu = await SD(page, () => [...document.querySelectorAll("#sidebar button[data-go]")].map((b) => b.dataset.go));
  const later = ["today", "channels", "conversions", "content", "overview", "insights", "keywords", "competitors", "ai"].filter((r) => menu.includes(r) && !screens.includes(r));
  if (later.length) console.log(`     not through it yet (Phase 2): ${later.join(", ")}. Once they register, steps 2, 3 and 5 check them too.`);
  check(screens.length > 0 && (await SD(page, () => window.SCREEN_DATA.on())), "switch on: SCREEN_DATA is on, with screens to warm", screens.join(", "));

  // 1. The warm-up, after the first screen has drawn: one at a time, 250 ms apart.
  check(await until(page, warmDone, 20000), "the warm-up ran and finished");
  const warm = (await log(page)).filter((x) => x.why === "warm").sort((a, b) => a.start - b.start);
  const wanted = await SD(page, (list) => list.flatMap((r) => window.SCREEN_DATA.paths(r)), screens);
  check(wanted.every((p) => warm.some((x) => x.path === p)), "every screen's first-view answers were fetched", `${warm.length} of ${wanted.length}`);
  const gaps = warm.slice(1).map((x, i) => x.start - warm[i].end);
  check(gaps.every((g) => g >= 240), "never two warm-up asks at once, at least 250 ms apart", `smallest gap ${gaps.length ? Math.min(...gaps) : "—"} ms`);
  check(warm.length <= 20 && warm.every((x) => x.status === 200), "at most 20 in a round, all answered", `${warm.length} asks`);

  // 2. A first visit after the warm-up: nothing asked for the screen's answers, drawn at once.
  for (const route of screens) {
    const mine = await SD(page, (r) => window.SCREEN_DATA.paths(r), route);
    const v = await visit(page, sent, route);
    const asked = v.own.filter((r) => mine.some((p) => r.url === `api/${p}`));
    const others = v.own.filter((r) => !asked.includes(r));
    // Competitors: the warm-up holds only its site list until the screen's first visit (it learns its sites then), and never
    // its Changes or links (owner, 2026-11-16: 5 to 8 MB a site on live). So its first visit may show those loading.
    const firstLoads = route === "competitors";
    check(asked.length === 0 && v.painted < 50 && (firstLoads || !v.loading), `${route}: a first visit after the warm-up asks nothing for its answers and draws at once`, `${v.painted} ms${others.length ? `; not through SCREEN_DATA yet: ${short(others)}` : ""}`);
    await away(page);
  }

  // 3. A second visit: no request at all, under 50 ms.
  for (const route of screens) {
    const v = await visit(page, sent, route);
    check(v.own.length === 0 && v.painted < 50 && !v.loading, `${route}: a second visit makes no request and draws in under 50 ms`, `${v.painted} ms, ${v.own.length} requests${v.own.length ? `: ${short(v.own)}` : ""}${v.background.length ? `; background: ${short(v.background)}` : ""}`);
    await away(page);
  }

  // 4. A new period forgets everything. A pointer passing over a menu item asks nothing; resting on it fetches that screen.
  const target = screens.includes("conversions") ? "conversions" : screens[0];
  const passBy = screens.find((r) => r !== target) || target;
  const roundsBefore = (await SD(page, () => window.SCREEN_DATA.stats())).rounds;
  await SD(page, () => window.UI.range.set({ preset: "7d" }));
  const afterPeriod = await SD(page, () => window.SCREEN_DATA.stats());
  check(afterPeriod.held === 0 && afterPeriod.context.includes('"7d"'), "a new period forgets every answer", `${afterPeriod.held} held`);
  let t = await nowIn(page);
  const hoversSince = async (since) => (await log(page)).filter((x) => x.why === "hover" && x.start >= since);
  const pass = await middleOf(page, passBy);
  await page.mouse.move(pass.x, pass.y); await page.mouse.move(700, 450);
  await page.waitForTimeout(300);
  check((await hoversSince(t)).length === 0, "a pointer passing over a menu item asks nothing");
  t = await nowIn(page);
  const rest = await middleOf(page, target);
  await page.mouse.move(rest.x, rest.y); await page.waitForTimeout(200);
  const hovered = await hoversSince(t);
  const targetPaths = await SD(page, (r) => window.SCREEN_DATA.paths(r), target);
  check(targetPaths.every((p) => hovered.some((x) => x.path === p)), `resting 80 ms on ${target} fetches its answers for the new period`, `${hovered.length} asks`);
  await until(page, (paths) => paths.every((p) => window.SCREEN_DATA.peek(p) !== null), 4000, targetPaths);
  const v4 = await visit(page, sent, target);
  check(v4.own.filter((r) => targetPaths.some((p) => r.url === `api/${p}`)).length === 0 && v4.painted < 50 && !v4.loading, `${target}: the click after the hover asks nothing and draws at once`, `${v4.painted} ms`);
  await away(page);
  check(await until(page, (before) => { const s = window.SCREEN_DATA.stats(); return s.rounds > before && s.queue === 0 && s.flying === 0; }, 15000, roundsBefore), "the new period's warm-up ran too");

  // 5. A new site forgets everything: the next visit asks for the new site, and the old site's answers are gone.
  const siteTwo = await page.evaluate(pickSite, "site-two.example");
  const first = screens.includes("channels") ? "channels" : screens[0];
  await visit(page, sent, first);
  const forSite = (await log(page)).filter((x) => x.path.includes(`site_id=${siteTwo}`));
  const oldGone = await SD(page, ({ one, two }) => window.SCREEN_DATA.screens().flatMap((r) => window.SCREEN_DATA.paths(r)).map((p) => p.replace(`site_id=${two}`, `site_id=${one}`)).every((p) => window.SCREEN_DATA.peek(p) === null), { one: siteOne, two: siteTwo });
  check(forSite.length > 0 && oldGone, "a new site forgets the old site's answers and asks for the new one", `${forSite.length} asks for site ${siteTwo}`);
  await away(page);
  const v5 = await visit(page, sent, first);
  check(v5.own.length === 0 && v5.painted < 50 && !v5.loading, `${first}: on the new site a second visit makes no request`, `${v5.painted} ms, ${v5.own.length} requests${v5.own.length ? `: ${short(v5.own)}` : ""}${v5.background.length ? `; apart: ${short(v5.background)}` : ""}`);
  await away(page);
  await page.evaluate(pickSite, "site-one.example");
  await page.waitForTimeout(300);

  // 6. An answer older than 5 minutes shows at once and is asked again quietly; so is one asked before a change was sent.
  await visit(page, sent, target); await away(page); // held again, for site one
  await SD(page, () => window.SCREEN_DATA.age(window.SCREEN_DATA.TTL + 1000));
  t = await nowIn(page);
  const v6 = await visit(page, sent, target);
  const again = (await log(page)).filter((x) => x.start >= t && !x.quiet);
  check(!v6.loading && v6.painted < 50 && again.length === targetPaths.length && again.every((x) => x.status === 200), `${target}: 5 minutes later the old answer shows at once and is asked again`, `${v6.painted} ms, ${again.length} asks`);
  await away(page);
  const v6b = await visit(page, sent, target);
  check(v6b.own.length === 0, `${target}: and is then kept again`, `${v6b.own.length} requests`);
  await away(page);
  const content = screens.includes("content") ? "content" : first;
  await visit(page, sent, content); await away(page);
  const changes = (await SD(page, () => window.SCREEN_DATA.stats())).changes;
  await SD(page, () => fetch("api/no-such-change", { method: "POST" }).then((r) => r.status)); // refused by the server, but still a change sent
  check((await SD(page, () => window.SCREEN_DATA.stats())).changes > changes, "a change sent to the server is noticed");
  t = await nowIn(page);
  const v7 = await visit(page, sent, content);
  const contentPaths = await SD(page, (r) => window.SCREEN_DATA.paths(r), content);
  const asked7 = (await log(page)).filter((x) => x.start >= t && !x.quiet).map((x) => x.path);
  check(!v7.loading && v7.painted < 50 && contentPaths.every((p) => asked7.includes(p)), `${content}: after a change, held answers show at once and are asked again`, `${v7.painted} ms, ${asked7.length} asks`);
  await away(page);

  // 7. A hidden tab pauses the warm-up; it carries on when the tab shows again.
  const hide = (hidden) => page.evaluate((h) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  await hide(true);
  t = await nowIn(page);
  const rounds = (await SD(page, () => window.SCREEN_DATA.stats())).rounds;
  await SD(page, () => window.UI.range.set({ preset: "3m" }));
  await page.waitForTimeout(3500);
  check(quietSince(await log(page), t).length === 0, "with the tab hidden, the warm-up asks nothing");
  await hide(false);
  await until(page, (before) => { const s = window.SCREEN_DATA.stats(); return s.rounds > before && s.queue === 0 && s.flying === 0; }, 15000, rounds);
  check(quietSince(await log(page), t).length > 0, "shown again, the warm-up carries on", `${quietSince(await log(page), t).length} asks`);

  // 8. The promise style (Today, Competitors' tabs, Keywords in Phase 2): from memory under 5 minutes, a copy each time.
  const heldPath = (await SD(page, (r) => window.SCREEN_DATA.paths(r), target))[0];
  let since = Date.now();
  const got = await SD(page, async (path) => {
    const a = await window.SCREEN_DATA.get(path), b = await window.SCREEN_DATA.get(path);
    a.flowMark = true;
    return { copies: a !== b, untouched: window.SCREEN_DATA.peek(path)?.flowMark === undefined };
  }, heldPath);
  check(sent(since).filter((r) => r.url === `api/${heldPath}`).length === 0 && got.copies && got.untouched, "get(): an answer held under 5 minutes comes from memory, a copy each time");

  // 9. Logo looks go through the same queue (Phase 2 points the two pollers at SCREEN_DATA.logos()): a direct look asks at
  //    once; a watch looks again, 5 s apart, only while a letter on the page waits for its logo.
  await SD(page, () => { window.flowLooks = 0; const was = window.COMP.refreshLogos; window.COMP.refreshLogos = (o) => { if (!o?.watch) window.flowLooks += 1; return was(o); }; });
  await SD(page, () => window.SCREEN_DATA.logos());
  await page.waitForTimeout(400);
  check((await SD(page, () => window.flowLooks)) === 1, "SCREEN_DATA.logos() looks at the list of logos once");
  await SD(page, () => { window.flowLooks = 0; return window.SCREEN_DATA.logos({ watch: true }); }); // no letter waits on Tasks
  await page.waitForTimeout(5600);
  const idleLooks = await SD(page, () => window.flowLooks);
  await SD(page, () => { window.flowLooks = 0; document.getElementById("page").insertAdjacentHTML("beforeend", '<span class="site-logo letter" id="flow-letter">L</span>'); });
  await page.waitForTimeout(11000);
  const letterLooks = await SD(page, () => window.flowLooks);
  check(idleLooks === 0 && letterLooks >= 1 && letterLooks <= 3, "a logo watch looks only while a letter waits for its logo, 5 s apart", `${idleLooks} with no letter, ${letterLooks} in 11 s with one`);
  await SD(page, () => document.getElementById("flow-letter")?.remove());

  // 10. A 429 stops the warm-up, and hover fetches wait too.
  const blocked = (await SD(page, (r) => window.SCREEN_DATA.paths(r), target))[0].split("?")[0];
  await page.route(`**/api/${blocked}?**`, (route) => route.fulfill({ status: 429, headers: { "Retry-After": "5" }, contentType: "application/json", body: '{"error":"Too many requests."}' }));
  t = await nowIn(page);
  await SD(page, () => window.UI.range.set({ preset: "28d" }));
  check(await until(page, () => window.SCREEN_DATA.stats().stopped === "429", 12000), "a 429 stops the warm-up", await SD(page, () => String(window.SCREEN_DATA.stats().stopped)));
  const hit = (await log(page)).find((x) => x.quiet && x.status === 429 && x.start >= t);
  await page.waitForTimeout(2500);
  const after429 = (await log(page)).filter((x) => x.quiet && hit && x.start > hit.start);
  const left = await SD(page, () => window.SCREEN_DATA.stats().waiting);
  check(Boolean(hit) && after429.length === 0 && left.warm === 0, "nothing quiet is asked after the 429, and the rest of the round is dropped", `${after429.length} after, ${left.warm} warm-up asks left; waiting out the cool-down: ${left.hover} hover, ${left.logos} logo look`);
  const other = await middleOf(page, passBy);
  await page.mouse.move(other.x, other.y); await page.waitForTimeout(300); await page.mouse.move(700, 450);
  check((await log(page)).filter((x) => x.quiet && hit && x.start > hit.start).length === 0, "after a 429, resting on a menu item waits too");
  await page.unroute(`**/api/${blocked}?**`);

  // Expected lines: 404 for auth/me (no sign-in on a test server), 405 for the refused change above, 429 from step 8.
  const errors = problems.filter((p) => p.startsWith("pageerror") || (p.startsWith("console") && !/status of (404|405|429)\b/.test(p)));
  check(errors.length === 0, "no script error on the way", errors.join(" | "));
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
