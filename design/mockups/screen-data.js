/* Screens open instantly (plan-seo-command-center-simplify-screens-like-mickaz.md, change 7). Owner: track E.
   window.SCREEN_DATA keeps each screen's answers for 5 minutes, fetches the other screens' answers quietly once the first
   screen has drawn, and fetches a screen's answers when the pointer rests on its menu item. Loaded after live.js, before the
   screens. It acts only with the simpler-screens switch on (UI.simple()) and a real server. With the switch off a screen keeps
   its old path behind `if (SCREEN_DATA.on())`, and nothing here asks the server or touches a request.

   A SCREEN ADOPTS IT IN PHASE 2 WITH A FEW LINES
     1. Its loader asks through it:   if (window.SCREEN_DATA?.on()) return SCREEN_DATA.entry(key);   then the old code.
        SCREEN_DATA.entry(path, { route, ask, redraw }) → { loading, data, error, stale, at }, the shape of an LV entry.
          nothing held  asks through COMP.api (it waits out a 429, gives plain words), then redraws the screen that asked:
                        UI.render() keeping the keyboard where it was, never under an open panel; or `redraw` when given
                        (Overview's own, which keeps the cursor in its filter box).
          under 5 min   given back at once: no request.
          older         the old answer at once (stale: true), asked again in the background, then a redraw. No loading card.
                        That redraw waits for the next draw while a panel is open or someone is typing.
          ask           the address asked when it differs from the key, such as Overview's `&fresh=1`.
        A loader that awaits (Today, Competitors' tabs, Keywords):   const data = await SCREEN_DATA.get(path, { fresh })
        gives a copy, from memory under 5 minutes.
     2. Its first-view answers, once at init, for the warm-up and the menu hover. The function runs when they do, so it
        reads the site and period then:   SCREEN_DATA.screen("channels", () => [`metrics/channels?${periodQuery()}`]);
     3. Its own forget() also calls SCREEN_DATA.forget(), or forget("metrics/") for one family: Try again, a rule added,
        a refresh's reads finished.
     4. Logo pollers: SCREEN_DATA.logos({ watch: true }) for COMP.refreshLogos({ watch: true }), and SCREEN_DATA.logos() in a
        timer. Looks go through the same queue, 5 s apart; a watch look is skipped while no letter on the page waits for a logo.
     Also: peek(path) the held data or null, never asking (don't change it); put(path, data) keeps an answer got another
     way; prefetch(route) what the menu hover calls.
     First-view answers each screen asks today (demo, 11 Nov), for its list. Keep a round under 20, so after D's folds:
       Today        today?…, backlinks/summary?site_id=…          (T1; D folds the second into /api/today)
       Channels     metrics/channels?…                            (T2; D folds the known logos into it)
       Conversions  metrics/conversions?…                         (T2)
       Content      metrics/content?…, metrics/clarity?…, metrics/clarity-reports?…, metrics/speed?…   (T2; D folds Clarity and speed)
       Overview     search/overview?…, search/breakdown?…          (T3)
       Insights     insights?…, search/countries?site_id=…         (T4; insights/ai only when an AI button is used)
       Keywords     rankings, tools                               (T5)
       Competitors  links/sites, competitors?…, collective/rivals?…, collective/keywords?…   (T6; moves and links when their tab opens)
       AI search    metrics/ai?…                                  (T7; search/ai-report and the refresh preview when opened)

   WHAT IT FORGETS BY ITSELF
     Everything when the site or the period changes (however it was changed), a site is added, sources change, keywords
     are added, or Refresh data's reads have all finished (screens-live.js's seocc:reading). After any change sent to the
     server (Refresh data, Run again, Keywords' Refresh, a rule, a note, a mark as seen) every answer counts as old: still
     shown at once, asked again in the background on its next use. A run that finishes later (Keywords' Refresh, Overview's
     re-read) is the screen's own forget().

   THE WARM-UP, GENTLE ON PURPOSE (the live host answers 429 to bursts)
     Once the first screen has drawn and no request has been on its way for a moment, the answers of each other screen that
     gave a list are fetched one at a time, in menu order, 250 ms apart, at most 20, waiting (up to 3 s each) while a screen's
     own requests are on their way. It pauses while the tab is hidden. Any 429, ours or a screen's own (COMP.coolUntil), or a
     network failure stops it for this page, and hover fetches wait a minute. A new round runs after a site or period change,
     and after a forget at most once a minute. A pointer or keyboard focus resting 80 ms on a menu item fetches that screen first.

   BEFORE PHASE 2: SCREEN_DATA.adoptLV(), a tiny opt-in hook
     Routes screens-live.js's LV.cache through entry() (Channels, Conversions, Content, and AI search through LV.load) and
     gives their first-view lists, so the cache can be checked on real screens now. tests/ui/flow_screen_speed.cjs calls it
     when no screen has registered yet. Does nothing with the switch off. T2 may call it from screens-live.js's init instead of
     editing load(), or adopt entry() directly and leave it unused.

   FOR FLOWS: stats(), log() (the last asks, with times), paths(route), screens(), age(ms) (every held answer as if it
   came ms earlier). */
(() => {
  "use strict";
  const TTL = 5 * 60 * 1000;       // an answer is kept 5 minutes
  const GAP = 250;                 // between two quiet asks
  const REST = 80;                 // a pointer resting this long on a menu item fetches that screen
  const ROUND_MOST = 20;           // quiet asks in one warm-up round
  const ROUND_EVERY = 60000;       // after a forget, a new round at most once a minute
  const WAIT_QUIET = 3000;         // a warm-up ask waits at most this long for a screen's own requests
  const COOL = 60000;              // after a 429, no quiet ask for a minute, or as long as Retry-After says
  const KEEP_MOST = 150;           // answers held at once: the oldest go first
  const LOOK_EVERY = 5000, WATCH_FOR = 60000; // logo looks: 5 s apart, a watch lasts a minute
  const CHANGES_NOTHING = /^(refresh\/preview|auth\/)/; // POSTs that change no answer: AI search's preview, signing in
  const served = location.protocol.startsWith("http");

  const UIx = () => window.UI;
  const on = () => { if (!served) return false; try { return Boolean(UIx()?.simple?.()); } catch { return false; } };
  // mockup.js's switch (?simple=1|0, kept as seocc2-simple), read here before mockup.js runs, so the request watch below is
  // in place before the first screen asks. UI.simple() is still the one that decides.
  const switchWanted = (() => {
    const asked = new URLSearchParams(location.search).get("simple");
    if (asked === "1" || asked === "0") return asked === "1";
    try { return localStorage.getItem("seocc2-simple") !== "0"; } catch { return true; }
  })();

  const held = new Map();          // path → entry
  const flying = new Map();        // path → the ask on its way
  const lists = new Map();         // route → () => its first-view paths
  const queue = [];                // quiet work, one at a time: { kind: "hover" | "warm" | "logos", path, route, gen }
  const recent = [];               // the last asks, for flows
  const count = { asked: 0, quiet: 0, served: 0, kept: 0, warmed: 0, rounds: 0, forgets: 0, changes: 0 };
  let gen = 0;                     // a forget: an answer asked before it is thrown away
  let epoch = 0;                   // a change sent: an answer asked before it counts as old
  let context = null, started = false, stopped = null, coolUntil = 0, lastRound = -Infinity, wantRound = false;
  let othersFlying = 0, quietFlying = 0;

  const blank = () => ({ loading: false, data: undefined, error: "", stale: false, at: 0, epoch: -1, route: null, redraw: null });
  const contextNow = () => { const s = UIx()?.state; return s ? `${s.site}|${JSON.stringify(s.rng)}` : ""; };
  const isFresh = (e) => e.epoch === epoch && Date.now() - e.at < (on() ? TTL : Infinity);
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const copy = (v) => (v === undefined || v === null ? v : typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
  const busy = () => othersFlying - quietFlying > 0; // a screen's own request is on its way
  const mark = (e, route, opts) => { if (route) e.route = route; if (opts.redraw) e.redraw = opts.redraw; return e; };
  const retryMs = (said) => { if (!said) return 0; const ms = /^\d+$/.test(said.trim()) ? Number(said) * 1000 : new Date(said).getTime() - Date.now(); return Number.isFinite(ms) ? Math.min(ms, 600000) : 0; };

  /* Every request the page sends is counted, so the warm-up only asks while nothing else is on its way, and a change sent
     to the server (anything but a GET) makes every held answer old. Only with the switch wanted: off, fetch is left alone. */
  if (served && switchWanted && typeof window.fetch === "function") {
    const before = window.fetch;
    window.fetch = function watchedFetch(input, init) {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input ?? "");
      const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      const path = (url.match(/(?:^|\/)api\/([^?#]*)/) || [])[1];
      const change = path !== undefined && method !== "GET" && method !== "HEAD" && !CHANGES_NOTHING.test(path);
      if (change) changed();
      othersFlying += 1;
      let sent;
      try { sent = Promise.resolve(before.call(this, input, init)); } catch (err) { othersFlying -= 1; throw err; }
      return sent.finally(() => { othersFlying -= 1; if (change) changed(); }); // again once it's done: answers asked meanwhile are old too
    };
  }
  function changed() { if (on()) { epoch += 1; count.changes += 1; } }

  // ---- asking --------------------------------------------------------------------------------------
  /* The warm-up's and the hover's ask: one plain GET that never waits or tries again, so a 429 is seen at once. */
  async function quietGet(url) {
    quietFlying += 1;
    let reply;
    // An answer that never comes would hold the queue: past 20 s it is given up, and the warm-up stops.
    try { reply = await window.fetch(`api/${url}`, AbortSignal.timeout ? { signal: AbortSignal.timeout(20000) } : undefined); } finally { quietFlying -= 1; }
    if (!reply.ok) throw Object.assign(new Error(`Error ${reply.status}`), { status: reply.status, retryAfter: reply.headers.get("Retry-After") });
    return reply.json();
  }
  /* One ask per path at a time. A screen joining a quiet ask that fails asks again itself, through COMP.api as before. */
  function ask(path, { ask: url = path, quiet = false, fresh = false, why = "screen" } = {}) {
    const now = flying.get(path);
    if (now && !fresh && now.gen === gen && now.epoch === epoch) return now.quiet && !quiet ? now.promise.catch(() => ask(path, { ask: url })) : now.promise;
    const req = { path, gen, epoch, quiet, why, start: Math.round(performance.now()), end: null, status: null };
    count[quiet ? "quiet" : "asked"] += 1;
    recent.push(req); if (recent.length > 80) recent.shift();
    req.promise = (quiet ? quietGet(url) : window.COMP.api("GET", url)).then((data) => { land(req, data); return data; });
    flying.set(path, req);
    const done = (err) => { req.end = Math.round(performance.now()); req.status = err ? err.status ?? 0 : 200; if (flying.get(path) === req) flying.delete(path); };
    req.promise.then(() => done(), done);
    return req.promise;
  }
  function land(req, data) {
    if (req.dropped || req.gen !== gen) return; // forgotten while on its way
    let e = held.get(req.path);
    if (e && !e.loading && e.data !== undefined && e.epoch > req.epoch) return; // a newer answer is already here
    if (!e) { e = blank(); held.set(req.path, e); trim(); }
    const old = !e.loading;
    Object.assign(e, { loading: false, data, error: "", stale: false, refreshing: false, at: Date.now(), epoch: req.epoch });
    count.kept += 1;
    if (e.route) redraw(e, old);
  }
  function trim() {
    if (held.size <= KEEP_MOST) return;
    [...held.entries()].filter(([, e]) => !e.loading).sort((a, b) => a[1].at - b[1].at).slice(0, held.size - KEEP_MOST).forEach(([path]) => held.delete(path));
  }

  // ---- what a screen calls ----------------------------------------------------------------------------
  function entry(path, opts = {}) {
    look();
    const route = opts.route || UIx()?.state?.route || null;
    let e = held.get(path);
    if (e && (e.loading || isFresh(e))) { if (!e.loading) count.served += 1; return mark(e, route, opts); }
    if (e && e.data !== undefined) { // older than 5 minutes, or a change was sent since: shown at once, asked again quietly
      count.served += 1;
      mark(e, route, opts).stale = true;
      if (!e.refreshing) {
        e.refreshing = true;
        ask(path, { ask: opts.ask }).catch(() => { if (held.get(path) === e) Object.assign(e, { refreshing: false, at: Date.now(), epoch }); });
      }
      return e;
    }
    e = mark(Object.assign(blank(), { loading: true }), route, opts);
    held.set(path, e); trim();
    ask(path, { ask: opts.ask }).catch((err) => {
      if (held.get(path) !== e) return;
      Object.assign(e, { loading: false, error: err?.message || "Error", at: Date.now(), epoch }); // kept until Try again, as before
      redraw(e, false);
    });
    return e;
  }
  async function get(path, { ask: url, fresh = false } = {}) {
    if (!on()) return window.COMP.api("GET", url || path); // the switch off: a plain ask, nothing kept
    look();
    const e = held.get(path);
    if (!fresh && e && !e.loading && !e.error && e.data !== undefined && isFresh(e)) { count.served += 1; return copy(e.data); }
    return copy(await ask(path, { ask: url, fresh }));
  }
  const peek = (path) => { const e = held.get(path); return e && !e.loading && e.data !== undefined ? e.data : null; };
  function put(path, data) {
    if (data === undefined) return;
    let e = held.get(path);
    if (!e) { e = blank(); held.set(path, e); trim(); }
    Object.assign(e, { loading: false, data, error: "", stale: false, refreshing: false, at: Date.now(), epoch });
  }
  /* Everything, or the paths that start with `prefix`. Answers on their way are thrown away when they land. */
  function forget(prefix) {
    if (typeof prefix === "string" && prefix) {
      [...held.keys()].filter((k) => k.startsWith(prefix)).forEach((k) => held.delete(k));
      [...flying.entries()].filter(([k]) => k.startsWith(prefix)).forEach(([k, req]) => { req.dropped = true; flying.delete(k); });
    } else drop();
    arm();
  }
  function drop(redrawWaiting = true) {
    // A screen still showing a loading card asks again on its next draw, as LV's own forget did: drawn now unless its caller does.
    const waiting = redrawWaiting ? [...held.entries()].filter(([, e]) => e.loading && e.route).map(([path, e]) => ({ path, route: e.route, fn: e.redraw })) : [];
    gen += 1; count.forgets += 1;
    held.clear(); flying.clear();
    for (let i = queue.length - 1; i >= 0; i -= 1) if (queue[i].kind !== "logos") queue.splice(i, 1);
    if (waiting.length) setTimeout(() => {
      const ui = UIx(), mine = waiting.filter((w) => w.route === ui?.state?.route && !held.has(w.path));
      if (!mine.length) return;
      if (mine[0].fn) { try { mine[0].fn(); } catch (err) { console.error(err); } } else if (!ui.$("#panel")) drawKeepingFocus(ui);
    }, 0);
  }
  /* A new site or period: nothing held is about it any more, and the warm-up starts again for it. */
  function look() {
    if (!on()) return;
    start();
    const now = contextNow();
    if (now === context) return;
    const first = context === null;
    context = now;
    if (first) return;
    drop(false); // the screen is being drawn for the new site or period already
    lastRound = -Infinity;
    arm();
  }
  function screen(route, list) {
    lists.set(route, typeof list === "function" ? list : () => list || []);
    if (started) arm();
  }
  function paths(route) {
    try { return (lists.get(route)?.() || []).filter((p) => typeof p === "string" && p); } catch (err) { console.error(err); return []; }
  }

  // ---- redrawing -----------------------------------------------------------------------------------------
  /* The screen that showed an answer is drawn again when it lands: once for answers landing together, never on another screen,
     never under an open panel (as the screens did). An old answer on screen waits for the next draw while someone types. */
  const redraws = new Map();
  function redraw(e, onlyOld) {
    const route = e.route, job = redraws.get(route);
    if (!route) return;
    if (job) { job.onlyOld = job.onlyOld && onlyOld; job.fn = e.redraw || job.fn; return; }
    redraws.set(route, { fn: e.redraw, onlyOld });
    setTimeout(() => {
      const { fn, onlyOld: quiet } = redraws.get(route);
      redraws.delete(route);
      const ui = UIx();
      if (!ui || ui.state.route !== route) return;
      if (fn) { try { fn(); } catch (err) { console.error(err); } return; }
      if (ui.$("#panel")) return;
      if (quiet && document.activeElement?.matches?.("input, textarea, select, [contenteditable='true']")) return;
      drawKeepingFocus(ui);
    }, 0);
  }
  /* A redraw replaces the page and the menu. The keyboard goes back to the same control, found again by its id or data- attribute. */
  function drawKeepingFocus(ui) {
    const was = document.activeElement;
    const again = was && was !== document.body && document.getElementById("app")?.contains(was) ? twinOf(was) : "";
    ui.render({ keepScroll: true });
    if (again && !was.isConnected) ui.$(again)?.focus({ preventScroll: true });
  }
  function twinOf(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const named = [...el.attributes].find((a) => a.name.startsWith("data-") && a.value);
    return named ? `${el.localName}[${named.name}="${CSS.escape(named.value)}"]` : "";
  }

  // ---- the warm-up and the hover ------------------------------------------------------------------------
  let armTimer = 0, pumping = false;
  function arm() {
    if (!on() || !started || stopped) return;
    clearTimeout(armTimer);
    armTimer = setTimeout(() => settle(Date.now(), 0), Math.max(1200, lastRound + ROUND_EVERY - Date.now()));
  }
  /* "The first screen has drawn": the page has loaded and no request has been on its way for 600 ms (8 s at most). */
  function settle(since, calm) {
    armTimer = 0;
    if (!on() || stopped) return;
    if (document.hidden) { wantRound = true; return; }
    calm = busy() || document.readyState !== "complete" ? 0 : calm + 200;
    if (calm < 600 && Date.now() - since < 8000) { armTimer = setTimeout(() => settle(since, calm), 200); return; }
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 50));
    idle(() => round(), { timeout: 2000 });
  }
  function round() {
    if (!on() || stopped) return;
    if (document.hidden) { wantRound = true; return; }
    look();
    wantRound = false;
    const here = UIx()?.state?.route;
    let room = ROUND_MOST;
    const menu = [...document.querySelectorAll("#sidebar [data-go]")].map((b) => b.dataset.go);
    for (const route of new Set([...menu.filter((r) => lists.has(r)), ...lists.keys()])) {
      if (route === here) continue; // the screen on view asks for its own
      for (const path of paths(route)) {
        if (room <= 0) break;
        if (held.has(path) || flying.has(path) || queue.some((x) => x.path === path)) continue;
        queue.push({ kind: "warm", path, route, gen });
        room -= 1;
      }
    }
    if (room === ROUND_MOST) return; // nothing to fetch: it doesn't count as a round
    lastRound = Date.now(); count.rounds += 1;
    pump();
  }
  function prefetch(route) {
    if (!on() || !lists.has(route) || Date.now() < coolUntil) return 0;
    look();
    if (route === UIx()?.state?.route) return 0;
    const wanted = paths(route).filter((p) => { const e = held.get(p); return !flying.has(p) && !(e && (e.loading || isFresh(e))); });
    for (let i = wanted.length - 1; i >= 0; i -= 1) {
      const at = queue.findIndex((x) => x.path === wanted[i]);
      if (at >= 0) queue.splice(at, 1);
      queue.unshift({ kind: "hover", path: wanted[i], route, gen });
    }
    pump();
    return wanted.length;
  }
  /* One quiet ask at a time, 250 ms apart. A warm-up ask lets a screen's own requests land first. */
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      let waited = 0;
      while (queue.length && on() && !document.hidden && !cooling()) {
        const next = queue[0];
        if (next.kind === "warm" && busy() && waited < WAIT_QUIET) { await sleep(100); waited += 100; continue; }
        waited = 0;
        queue.shift();
        if (await run(next)) await sleep(GAP);
      }
    } finally { pumping = false; }
  }
  async function run(task) {
    if (task.kind === "logos") return lookLogos(task);
    look();
    if (task.gen !== gen || flying.has(task.path)) return false; // another site or period now, or the screen asked it meanwhile
    const e = held.get(task.path);
    if (e && (task.kind === "warm" || e.loading || isFresh(e))) return false;
    try { await ask(task.path, { quiet: true, why: task.kind }); if (task.kind === "warm") count.warmed += 1; }
    catch (err) { if (err?.status === 429) stop("429", retryMs(err.retryAfter)); else if (!err?.status) stop("offline"); } // other failures: the screen asks itself
    return true;
  }
  /* A 429 anywhere (ours, or a screen's own, which COMP.api keeps in COMP.coolUntil) stops the warm-up; the rest waits it out. */
  let theirsSeen = 0;
  function cooling() {
    const theirs = window.COMP?.coolUntil || 0;
    if (theirs > Date.now() && theirs !== theirsSeen) { theirsSeen = theirs; stop("429", theirs - Date.now()); }
    return Date.now() < coolUntil;
  }
  function stop(why, ms = 0) {
    if (!stopped) stopped = why;
    const until = Date.now() + Math.max(COOL, ms);
    if (until > coolUntil) { coolUntil = until; setTimeout(pump, until - Date.now() + 50); }
    for (let i = queue.length - 1; i >= 0; i -= 1) if (queue[i].kind === "warm") queue.splice(i, 1);
    clearTimeout(armTimer);
  }

  // ---- logo looks, folded into the same queue ------------------------------------------------------------
  let watchUntil = 0, lastLook = -Infinity, logoTask = null;
  function logos({ watch = false } = {}) {
    if (!on()) return Promise.resolve(window.COMP?.refreshLogos?.({ watch }));
    look();
    if (watch) watchUntil = Math.max(watchUntil, Date.now() + WATCH_FOR);
    return lookSoon(!watch);
  }
  function lookSoon(always) {
    if (logoTask) { logoTask.always = logoTask.always || always; return logoTask.done; }
    const task = (logoTask = { kind: "logos", always });
    task.done = new Promise((resolve) => { task.resolve = resolve; });
    setTimeout(() => { queue.push(task); pump(); }, Math.max(0, lastLook + LOOK_EVERY - Date.now()));
    return task.done;
  }
  async function lookLogos(task) {
    logoTask = null;
    const asking = task.always || Boolean(document.querySelector("#page .site-logo.letter")); // a watch look only while a letter waits for its logo
    if (asking) {
      lastLook = Date.now();
      try { await window.COMP?.refreshLogos?.(); } catch { /* the next look */ }
      cooling();
    }
    task.resolve();
    if (Date.now() < watchUntil) setTimeout(() => lookSoon(false), LOOK_EVERY);
    return asking;
  }

  // ---- the hover, the events, the start ------------------------------------------------------------------
  let restTimer = 0, restingOn = null;
  const menuRoute = (el) => el?.closest?.("#sidebar [data-go]")?.dataset.go || null;
  function rest(route) {
    if (route === restingOn) return;
    clearTimeout(restTimer);
    restingOn = route;
    if (route && on()) restTimer = setTimeout(() => prefetch(route), REST);
  }
  function start() {
    if (started || !on()) return;
    started = true;
    context = contextNow();
    window.addEventListener("seocc:range", () => look());
    ["seocc:site-added", "seocc:sources-changed", "seocc:keywords-added"].forEach((name) => window.addEventListener(name, () => forget()));
    // Refresh data's reads have all finished (screens-live.js says so on each look at them): what was held is from before.
    document.addEventListener("seocc:reading", () => { const r = window.LV?.reading; if (r && r.total && r.done >= r.total) forget(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) return; if (wantRound) arm(); pump(); });
    document.addEventListener("pointerover", (e) => rest(menuRoute(e.target)));
    document.addEventListener("focusin", (e) => rest(menuRoute(e.target)));
    document.addEventListener("focusout", () => rest(null));
    if (document.readyState === "complete") arm(); else window.addEventListener("load", () => arm(), { once: true });
  }
  document.addEventListener("DOMContentLoaded", () => start()); // mockup.js has run by then, so UI.simple() can answer

  // ---- before Phase 2: screens-live.js's screens through the cache, on request ---------------------------------
  function adoptLV() {
    const LV = window.LV;
    if (!on() || !LV?.cache) return false;
    if (LV.cache.screenData) return true;
    start();
    // What LV already holds shows at once and, its age unknown, is asked again quietly on its next use.
    LV.cache.forEach?.((e, key) => { if (e && !e.loading && !e.error && e.data !== undefined) { put(key, e.data); held.get(key).at = 0; } });
    LV.cache = {
      screenData: true,
      get: (key) => entry(key),
      set(key, value) { if (value && !value.loading && value.data !== undefined) put(key, value.data); return this; },
      has: (key) => held.has(key),
      delete: (key) => { const had = held.has(key); held.delete(key); return had; },
      clear: () => forget(),
      forEach: (fn) => held.forEach((e, key) => fn(e, key)),
      get size() { return held.size; },
      keys: () => held.keys(), values: () => held.values(), entries: () => held.entries(), [Symbol.iterator]: () => held.entries(),
    };
    // screens-live.js's periodQuery(): the app's dates as days, and the site.
    const days = () => { const site = UIx().siteIdPicked(); return [UIx().range.days(), site ? `site_id=${site}` : ""].filter(Boolean).join("&"); };
    const firstView = { channels: ["metrics/channels"], conversions: ["metrics/conversions"], content: ["metrics/content", "metrics/clarity", "metrics/clarity-reports", "metrics/speed"], ai: ["metrics/ai"] };
    Object.entries(firstView).forEach(([route, names]) => { if (!lists.has(route)) screen(route, () => names.map((name) => `${name}?${days()}`)); });
    return true;
  }

  window.SCREEN_DATA = {
    TTL, on, entry, get, peek, put, forget, screen, prefetch, logos, adoptLV, paths,
    screens: () => [...lists.keys()],
    stats: () => ({
      on: on(), ...count, held: held.size, flying: flying.size, queue: queue.length, stopped, context, watching: served && switchWanted,
      waiting: Object.fromEntries(["warm", "hover", "logos"].map((kind) => [kind, queue.filter((x) => x.kind === kind).length])),
    }),
    log: () => recent.map(({ path, quiet, why, start: began, end, status }) => ({ path, quiet, why, start: began, end, status })), // why: screen, warm, hover
    age(ms) { held.forEach((e) => { e.at -= ms; }); },
  };
})();
