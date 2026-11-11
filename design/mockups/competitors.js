/* Competitors area: the shell. Each tab lives in its own file and registers with COMP.addTab().

   One code path: COMP.api() calls the real server when there is one. Opened as a plain file there is no
   server, so it answers from comp-sample-data.js, a snapshot of real API answers made by design/build_comp_sample.py.
   All HTML goes through UI.setHTML (DOMPurify), and values through UI.esc. No AI anywhere in this area. */
(() => {
  "use strict";
  let UI = null;
  const ALL = "all"; // COMP.siteId when every one of my sites is on screen. Only the Summary tab can show that.
  const COMP = (window.COMP = {
    ALL,
    tabs: [],
    tab: "list",
    siteId: null,
    sites: [],
    ready: false,
    server: null,
    sampleWrites: [], // [regex string for "METHOD path", (match, body, opts) => answer]. Writes change COMP_SAMPLE.get in place.
    addTab(tab) { COMP.tabs.push(tab); COMP.tabs.sort((a, b) => a.order - b.order); },
    sampleWrite(pattern, fn) { COMP.sampleWrites.push([new RegExp(`^${pattern}$`), fn]); },
  });

  // ---- talking to the server, or to the sample --------------------------------------------
  // Served by the app, it is always the real server: a failed request shows its error, never sample rows.
  // Sample data is only for the screens opened as a plain file, with no app behind them.
  const isServer = () => {
    if (!COMP.server) COMP.server = Promise.resolve(location.protocol.startsWith("http"));
    return COMP.server;
  };
  COMP.isServer = isServer;

  const later = (value) => new Promise((done) => setTimeout(() => done(value), 80));
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function sampleCall(method, path, body, opts) {
    const data = window.COMP_SAMPLE;
    if (method === "GET") {
      if (path in data.get) return later(clone(data.get[path]));
      // A site with no snapshot, such as one added just now, answers like the empty site.
      const asEmpty = path.replace(/site_id=\d+/, `site_id=${data.empty_site_id}`).replace(/(sites\/)[^/]+(\/audits)/, `$1${data.empty_site_id}$2`);
      if (asEmpty in data.get) return later(clone(data.get[asEmpty]));
      return Promise.reject(new Error("Not in the sample data."));
    }
    for (const [pattern, fn] of COMP.sampleWrites) {
      const match = `${method} ${path}`.match(pattern);
      if (match) {
        try { return later(fn(match, body, opts)); } catch (err) { return Promise.reject(err); }
      }
    }
    return Promise.reject(new Error("That isn't available in the sample data."));
  }

  /* The app's one way to call the server (F17, F19, F20). Any script may use it: it is loaded before every screen.

       COMP.api("GET", "competitors?site_id=1")            → the answer's JSON
       COMP.api("POST", "notes", { scope: "all", body })    → JSON body; PATCH, PUT, DELETE the same
       COMP.api("POST", "notes/4/files", null, { form })    → a FormData upload
       opts: { keepalive: true } lets a save outlive the page; { fresh: true } never shares a GET.

     A refusal rejects with an Error whose message is the server's own sentence (or a plain one), with err.status
     (0 when the server can't be reached), and err.data, the answer's JSON.
     - The same GET asked while one is on its way shares that one request. Each caller gets its own copy of the answer.
       A change sent in between starts a new GET, so nobody is handed an answer from before their own change.
     - 429: waits as long as the server's Retry-After says (1 to 30 s, 5 s if it says nothing), then tries again, twice
       at most. COMP.coolUntil holds that moment, and COMP.poll waits for it too. Then it rejects with a plain sentence.
     - 403 "This page is out of date": asks auth/me again once (window.whoAmI.again) and sends the change again. */
  const inflight = new Map();
  /* Counts changes sent by any script, through COMP.api or not, so a GET started before one is never shared after it. */
  let changes = 0;
  if (location.protocol.startsWith("http") && !window.fetch.countsChanges) {
    const pageFetch = window.fetch;
    window.fetch = function countingFetch(input, init) {
      const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method === "GET" || method === "HEAD") return pageFetch(input, init);
      changes += 1;
      return pageFetch(input, init).finally(() => { changes += 1; });
    };
    window.fetch.countsChanges = true;
  }
  const RETRIES_429 = 2;
  COMP.coolUntil = 0;
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const BUSY = "Server busy. Try again in a minute.";
  const OFFLINE = "Server unreachable. Check the connection, then try again.";
  const BROKEN = "Something went wrong on the server. Try again.";
  function retryAfter(reply) {
    const said = reply.headers.get("Retry-After");
    let ms = said === null ? 5000 : /^\d+$/.test(said.trim()) ? Number(said) * 1000 : new Date(said).getTime() - Date.now();
    if (!Number.isFinite(ms)) ms = 5000;
    return Math.min(30000, Math.max(1000, ms));
  }
  async function call(method, path, body, opts) {
    let busyTries = 0, askedAgain = false;
    for (;;) {
      const wait = COMP.coolUntil - Date.now();
      if (wait > 0) await sleep(wait);
      const init = { method };
      if (opts.keepalive) init.keepalive = true;
      if (opts.form) init.body = opts.form;
      else if (body !== undefined && body !== null) { init.headers = { "Content-Type": "application/json" }; init.body = JSON.stringify(body); }
      let reply;
      try { reply = await fetch(`api/${path}`, init); } catch (cause) { throw Object.assign(new Error(OFFLINE), { status: 0, cause }); }
      if (reply.status === 429 && busyTries < RETRIES_429) { // nothing was done: safe to send again, even a change
        busyTries += 1;
        COMP.coolUntil = Math.max(COMP.coolUntil, Date.now() + retryAfter(reply));
        continue;
      }
      const data = await reply.json().catch(() => ({}));
      if (reply.status === 403 && !askedAgain && method !== "GET" && /out of date/.test(data.error || "") && window.whoAmI?.again) {
        askedAgain = true;
        await window.whoAmI.again();
        continue;
      }
      if (!reply.ok) {
        const words = reply.status === 429 ? BUSY : data.error || (reply.status >= 500 ? BROKEN : `Error ${reply.status}`);
        throw Object.assign(new Error(words), { status: reply.status, headers: data.headers, data });
      }
      return data;
    }
  }
  COMP.api = async (method, path, body, opts = {}) => {
    if (!(await isServer())) return sampleCall(method, path, body, opts);
    method = String(method || "GET").toUpperCase();
    if (method !== "GET" || opts.fresh) return call(method, path, body, opts);
    let shared = inflight.get(path);
    if (!shared || shared.changes !== changes) {
      const promise = call(method, path, body, opts);
      shared = { promise, changes };
      inflight.set(path, shared);
      const forget = () => { if (inflight.get(path) === shared) inflight.delete(path); };
      promise.then(forget, forget);
    }
    return shared.promise.then(clone);
  };

  /* One way to follow something on the server while it works (F21, F60, F115, F181, F187). Any script may use it.

       const follow = COMP.poll(async () => { const now = await COMP.api("GET", "…"); paint(now); return stillRunning(now); },
                                { every: 2500, slowest: 30000, grow: 1.2, most: 15 * 60000, onEnd: (why, err) => … });
       follow.stop();

     step() runs after `every` ms. It answers false to stop; anything else carries on. The wait grows by `grow` after each
     answer and doubles after each failure, up to `slowest`. It pauses while the browser tab is hidden and starts again
     when it shows, waits out a 429 cool-down, and stops by itself on a 401 or 404, after `errors` failures in a row (6),
     or after `most` ms of watching with the tab in view (15 min). onEnd(why) says why: "done", "gone", "errors", "ceiling", "stopped". */
  COMP.poll = (step, { every = 2500, slowest = 30000, grow = 1, errors = 6, most = 15 * 60000, onEnd } = {}) => {
    let delay = every, failures = 0, timer = null, stopped = false, running = false, watched = 0, since = Date.now();
    const end = (why, err) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", seen);
      try { onEnd?.(why, err); } catch { /* the caller's own clean-up */ }
    };
    const later = (ms) => { clearTimeout(timer); timer = setTimeout(tick, ms); };
    function seen() {
      if (stopped) return;
      if (document.hidden) { watched += Date.now() - since; clearTimeout(timer); timer = null; return; }
      since = Date.now();
      if (!timer && !running) later(Math.min(delay, 1000)); // back in view: look soon
    }
    async function tick() {
      timer = null;
      if (stopped || document.hidden) return; // seen() starts it again
      const cool = COMP.coolUntil - Date.now();
      if (cool > 0) { later(cool); return; }
      if (watched + (Date.now() - since) > most) { end("ceiling"); return; }
      running = true;
      let more;
      try {
        more = await step();
        failures = 0;
        delay = Math.min(slowest, delay * grow);
      } catch (err) {
        running = false;
        if (err?.status === 401 || err?.status === 404) { end("gone", err); return; }
        failures += 1;
        if (failures >= errors) { end("errors", err); return; }
        delay = Math.min(slowest, delay * 2);
      }
      running = false;
      if (stopped) return;
      if (more === false) { end("done"); return; }
      later(delay);
    }
    document.addEventListener("visibilitychange", seen);
    later(every);
    return { stop: () => end("stopped"), get active() { return !stopped; } };
  };

  // ---- small shared pieces ------------------------------------------------------------------
  /* Loading: a few grey lines where the rows will be, so the page doesn't flash a sentence. The words stay for screen readers. */
  COMP.loading = () => `<div class="card comp-skel" role="status" aria-label="${UI.esc(UI.t("Loading…"))}"><span class="sr">${UI.t("Loading…")}</span><i></i><i></i><i></i></div>`;
  /* `tip` is HTML from UI.tip: the full sentence behind (i), right after the short text. */
  COMP.empty = (title, text, action = "", tip = "") => `<div class="table-wrap"><div class="empty"><h3>${UI.esc(title)}</h3><p>${UI.esc(text)}${tip}</p>${action}</div></div>`;
  COMP.fail = (err) => UI.toast(UI.t(err.message), { kind: "crit" });
  /* Try again on a screen or tab that didn't load. It loads the same thing again, from the list of sites if that failed. */
  COMP.retryButton = () => `<button type="button" class="btn btn-main" data-comp-retry>${UI.icon("refresh-cw")}${UI.t("Try again")}</button>`;
  /* The app's failure card (shared-ui.js) when it's there: a plain reason and Try again. `what` says what didn't load. */
  COMP.failed = (err, what = "") => {
    const why = UI.errorWords ? UI.errorWords(err) : UI.t(err?.message || "");
    const words = what ? `${UI.t(what)} ${why}` : why;
    return UI.failCard ? UI.failCard(words, { retry: "data-comp-retry" }) : COMP.empty(UI.t("That didn't load"), words, COMP.retryButton());
  };
  COMP.site = () => COMP.sites.find((s) => s.id === COMP.siteId) || null;
  /* Mine and theirs, one look across the app: blue is you, purple is them, always with the word. With a host, its logo replaces the dot. */
  COMP.who = (who, host, label) => `<span class="who who-${who}">${host ? UI.siteLogo(host, 16) : `<i class="pt-key pt-key-${who}" aria-hidden="true"></i>`}<span>${label || UI.t(who === "you" ? "You" : "Them")}</span></span>`;

  /* How long ago, in the language on screen. */
  const minutesSince = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  const ageWord = (minutes) => {
    const fr = UI.state.lang === "fr";
    return minutes < 1 ? (fr ? "à l'instant" : "just now") : minutes < 60 ? `${minutes} min` : minutes < 2880 ? `${Math.round(minutes / 60)} h` : minutes < 86400 ? `${Math.round(minutes / 1440)} ${fr ? "j" : "d"}` : `${Math.round(minutes / 43200)} ${fr ? "mois" : "mo"}`;
  };
  COMP.ago = (iso) => {
    if (!iso) return "—";
    const minutes = minutesSince(iso), word = ageWord(minutes);
    return minutes < 1 ? word : UI.state.lang === "fr" ? `il y a ${word}` : `${word} ago`;
  };
  /* The same age in a table cell, where the column already says it's past: "3 h", not "3 h ago" (2026-11-11).
     Sentences ("Read 3 h ago", "All checked with …, 3 h ago.") and toasts keep COMP.ago. */
  COMP.age = (iso) => (iso ? ageWord(minutesSince(iso)) : "—");
  /* …as the cell shows it: the exact date and time on hover. */
  COMP.ageCell = (iso) => (iso ? `<span class="nowrap tabular" title="${UI.esc(UI.fmtStamp ? UI.fmtStamp(iso) : iso)}">${UI.esc(COMP.age(iso))}</span>` : `<span class="muted">—</span>`);

  /* Where a position came from, as logos instead of names repeated on every row: the search engine, then the tool, each name in
     its tooltip and for screen readers (2026-11-11). A brand with no logo keeps its name. */
  COMP.engineName = (id) => UI.ENGINES?.find(([key]) => key === id)?.[1] || id || "";
  COMP.toolLogos = (engine, tool) => {
    const names = [COMP.engineName(engine), tool].filter(Boolean);
    return names.length ? `<span class="comp-src">${names.map((name) => UI.logoOnly(name)).join("")}</span>` : "";
  };
  /* An icon that stands for words (Added by hand, Watching, Flagged by the system): the words are its tooltip and its name for screen readers. */
  COMP.iconTip = (name, words, cls = "") => `<span class="comp-ic${cls ? ` ${cls}` : ""}" role="img" title="${UI.esc(words)}" data-tip="${UI.esc(words)}" aria-label="${UI.esc(words)}">${UI.icon(name)}</span>`;

  /* A position beside its tool. Beyond the depth checked it says so: it never reads as a number. */
  COMP.pos = (n, depth = 10) => (n === null || n === undefined ? `<span class="muted" title="${UI.t("Not in the results checked")}">&gt;${depth}</span>` : `<span class="tabular">#${n}</span>`);
  /* Why a domain is flagged. The file's reason and a person's already say who; the system's own checks say so first. */
  COMP.spamWhy = (gap) => {
    const words = UI.t(gap.reason_words || "Flagged as spam");
    return gap.flagged_by === "system" ? `${UI.t("Flagged by the system")}: ${words}` : words;
  };
  /* The same, drawn in a cell: the system's own flag is a cog with "Flagged by the system" as its tooltip, then the reason (2026-11-11).
     COMP.spamWhy stays the plain sentence, for text-only places. */
  COMP.spamWhyHtml = (gap) => {
    const words = UI.esc(UI.t(gap.reason_words || "Flagged as spam"));
    return gap.flagged_by === "system" ? `${COMP.iconTip("settings", UI.t("Flagged by the system"), "comp-ic-system")}${words}` : words;
  };
  COMP.shortUrl = (url) => String(url || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") || "/";
  /* Text from other websites can be any language or direction, so it always carries dir="auto" and goes through esc. */
  /* Every address goes through PageLink (page-links.js), like the rest of the app: a click opens the page and never the row it sits in.
     It keeps its comp-url class, nofollow, and a break after each slash or hyphen, so an address wraps there and not mid-word. */
  COMP.link = (url, text = null, cls = "mono small") => {
    const breaks = (label) => label.replace(/\//g, "/<wbr>"); // only after a slash: a domain like my-shop.example stays whole
    if (!window.PageLink) return `<a class="${cls} comp-url" dir="auto" href="${UI.esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${breaks(UI.esc(text ?? COMP.shortUrl(url)))}</a>`;
    return window.PageLink.html(url, { text: text ?? COMP.shortUrl(url), cls: `${cls} comp-url` })
      .replace('rel="noopener noreferrer"', 'rel="noopener noreferrer nofollow"')
      .replace(/>([^<]*)<\/(a|span)>$/, (all, label, tag) => `>${breaks(label)}</${tag}>`);
  };
  COMP.foreign = (text) => `<span dir="auto">${UI.esc(text)}</span>`;
  /* A caveat behind an (i): the sentence shows on hover or focus, instead of sitting over the table. */
  COMP.info = (text) => `<button type="button" class="comp-info" data-tip="${UI.esc(UI.t(text))}" aria-label="${UI.esc(UI.t(text))}">${UI.icon("info")}</button>`;

  // ---- the shell ----------------------------------------------------------------------------
  /* "My competitors" (id list) lives inside the Competitors tab (id summary) since 2026-11-09: with no competitor open, the merged tab shows.
     An old address naming either tab lands on the same screen. */
  COMP.currentTab = () => {
    let id = COMP.siteId === ALL ? "summary" : COMP.tab;
    if (id === "list" && !COMP.tabs.find((x) => x.id === "list")?.competitorId) id = "summary";
    return COMP.tabs.find((tab) => tab.id === id) || COMP.tabs[0];
  };
  /* The Competitors tab stays lit while one of its competitors is open. */
  COMP.tabLit = (x, current) => x.id === current.id || (x.id === "summary" && current.id === "list");
  COMP.canShowAll = () => COMP.sites.length >= 2;

  /* Show a site, or ALL, here and in the side menu. Every tab loads again for it. */
  COMP.useSite = (id) => {
    COMP.siteId = id;
    COMP.tabs.forEach((tab) => { tab.loadedFor = undefined; });
    UI.pickSite(id === ALL ? ALL : COMP.site()?.host);
    COMP.lastPicked = UI.siteHostPicked();
  };

  /* Redraw only the body of the current tab: the site picker and tabs keep their state and focus. */
  COMP.paint = () => {
    const box = UI.$("#comp-body");
    const tab = COMP.currentTab();
    if (!box || !tab) return;
    UI.setHTML(box, tab.body());
    tab.after?.();
  };

  /* Load the tab's data again, then redraw it. Pass { quiet: true } to keep what's on screen while it loads. */
  COMP.reload = async ({ quiet = false } = {}) => {
    const tab = COMP.currentTab();
    if (!tab) return;
    const site = COMP.siteId;
    tab.loadedFor = site;
    if (!quiet) { const box = UI.$("#comp-body"); if (box) UI.setHTML(box, COMP.loading()); }
    try {
      await tab.load?.();
    } catch (err) {
      if (COMP.currentTab() === tab) { const box = UI.$("#comp-body"); if (box) UI.setHTML(box, COMP.failed(err)); }
      return;
    }
    if (COMP.currentTab() === tab && COMP.siteId === site) COMP.paint();
  };

  /* Go to a tab. `props` lands on the tab's object, for example { competitorId: 4 } on the list tab. */
  COMP.open = (id, props = {}, siteId) => {
    const tab = COMP.tabs.find((x) => x.id === id);
    if (!tab) return;
    Object.assign(tab, props);
    COMP.tab = id;
    tab.loadedFor = undefined;
    // Every tab but Summary works on one site, so it can't open at All my sites.
    if (siteId !== undefined && siteId !== COMP.siteId) COMP.useSite(siteId);
    else if (COMP.siteId === ALL && id !== "summary") COMP.useSite(UI.preferredSite(COMP.sites)?.id ?? null);
    if (UI.state.route !== "competitors") UI.go("competitors");
    else UI.render();
  };

  /* Which sites have an icon. Icons arrive a little after a site is added, so a page showing letters looks again for a minute. */
  window.LOGOS_KNOWN = new Set();
  let logoWatch = null;
  COMP.refreshLogos = async ({ watch = false } = {}) => {
    if (!(await isServer())) return;
    const started = Date.now();
    const look = async () => {
      let domains = [];
      try { domains = (await COMP.api("GET", "logos")).domains; } catch { return; }
      const fresh = domains.some((d) => !window.LOGOS_KNOWN.has(d));
      window.LOGOS_KNOWN = new Set(domains);
      if (fresh && UI) {
        const active = document.activeElement;
        if (active?.matches?.("input, textarea, select")) return; // never redraw under someone typing: the next look catches up
        const scroll = UI.$("#main")?.scrollTop;
        if (UI.state.route === "competitors" && UI.$("#comp-body")) COMP.paint(); else if (["backlinks", "channels"].includes(UI.state.route)) UI.render();
        // The site menu's button was drawn with letters before the list arrived. An open menu is left alone: it has the icons already.
        if (!UI.$("#popover")) UI.renderSidebar?.();
        if (UI.$("#main") && scroll !== undefined) UI.$("#main").scrollTop = scroll;
      }
    };
    await look();
    if (!watch) return;
    clearInterval(logoWatch);
    logoWatch = setInterval(() => { if (Date.now() - started > 60000) clearInterval(logoWatch); else look(); }, 5000);
  };

  async function loadSites() {
    const answer = await COMP.api("GET", "links/sites");
    const server = await isServer();
    COMP.sites = !server && UI.state.firstRun ? [] : answer.sites;
    const stillThere = COMP.siteId === ALL ? COMP.canShowAll() : COMP.sites.some((s) => s.id === COMP.siteId);
    if (!stillThere) COMP.siteId = UI.preferredSite(COMP.sites)?.id ?? null;
    COMP.ready = true;
  }

  function page() {
    const { t, esc, icon, topbar } = UI;
    const head = topbar(t("Competitors"), t("Who ranks against you, and what they do"), "", false);
    // The list of sites didn't come: say what failed and offer Try again, instead of loading for ever (UX review bug 3).
    if (!COMP.ready && COMP.loadError) return `${head}<div class="content page-enter" id="comp-load-failed">${COMP.failed(COMP.loadError, "The list of sites didn't load.")}</div>`;
    if (!COMP.ready) return `${head}<div class="content page-enter">${COMP.loading()}</div>`;
    if (!COMP.sites.length) {
      return `${head}<div class="content page-enter"><div class="table-wrap"><div class="empty" id="comp-no-sites"><h3>${t("No sites added yet")}</h3><p>${t("Add your site, then its keyword list.")}</p><button class="btn btn-main" id="site-add">${icon("plus")}${t("Add a site")}</button></div></div></div>`;
    }
    const picked = UI.siteHostPicked();
    const match = picked && COMP.sites.find((s) => s.host === picked);
    if (match && match.id !== COMP.siteId && COMP.lastPicked !== picked) { COMP.siteId = match.id; COMP.tabs.forEach((tab) => { tab.loadedFor = undefined; }); }
    // The side menu on All sites opens All my sites. An address naming another tab, or a site still arriving, goes to one site as it asked.
    const menuOnAll = !picked && !UI.siteComing() && COMP.canShowAll() && COMP.lastPicked !== picked && COMP.siteId !== ALL;
    if (menuOnAll && !COMP.tabFromAddress) {
      COMP.siteId = ALL;
      COMP.tab = "summary"; // choosing a site after this narrows the same view
      COMP.tabs.forEach((tab) => { tab.loadedFor = undefined; });
      // Only when the address is about to change. Asked while it already reads #competitors/summary, the request was left waiting,
      // and it swallowed the next real step: opening a competitor from All my sites, so Back skipped this screen.
      if (location.hash !== "#competitors/summary") UI.replaceNextUrl();
    }
    COMP.tabFromAddress = false;
    COMP.lastPicked = picked;
    const tab = COMP.currentTab();
    const all = COMP.siteId === ALL;
    const allOption = COMP.canShowAll() ? `<option value="${ALL}" ${all ? "selected" : ""}>${t("All my sites")}</option>` : "";
    return `${head}<div class="content page-enter">
      <div class="comp-bar"><label class="field comp-site"><span>${t("Competitors of")}</span><select class="select" id="comp-site">${allOption}${COMP.sites.map((s) => `<option value="${s.id}" ${s.id === COMP.siteId ? "selected" : ""}>${esc(s.host)}</option>`).join("")}</select></label>${UI.showingNote(COMP.site()?.host)}</div>
      ${all ? "" : `<div class="tabs comp-tabs" role="tablist" aria-label="${t("Competitors")}">${COMP.tabs.filter((x) => !x.hidden).map((x) => `<button class="tab" role="tab" data-comp-tab="${x.id}" aria-selected="${COMP.tabLit(x, tab)}">${x.icon ? icon(x.icon) : ""}${esc(t(x.label))}${x.badge?.() ? `<span class="count">${x.badge()}</span>` : ""}</button>`).join("")}</div>`}
      <div id="comp-setup">${COMP.setup?.html?.() ?? ""}</div>
      <div id="comp-body">${tab.loadedFor === COMP.siteId ? tab.body() : COMP.loading()}</div>
    </div>`;
  }

  function after() {
    if (!COMP.ready) {
      if (COMP.loadError || COMP.loadingSites) return; // Try again asks again
      COMP.loadingSites = true;
      loadSites().then(() => { COMP.loadError = null; }, (err) => { COMP.loadError = err; })
        .finally(() => { COMP.loadingSites = false; if (UI.state.route === "competitors") UI.render(); });
      return;
    }
    const tab = COMP.currentTab();
    if (!tab || !COMP.sites.length) return;
    COMP.setup?.refresh?.(); // the one "what's missing" line above every tab (comp-setup.js)
    if (tab.loadedFor !== COMP.siteId) COMP.reload();
    else tab.after?.();
  }

  window.SCREENS = window.SCREENS || {};
  window.SCREENS.competitors = {
    init(helpers) {
      UI = helpers;
      COMP.UI = helpers;
      COMP.tabs.forEach((tab) => tab.init?.(helpers));
      COMP.refreshLogos();
      document.addEventListener("click", (e) => {
        if (e.target.closest?.("[data-comp-retry]")) {
          if (!COMP.ready) { COMP.loadError = null; UI.render(); } else COMP.reload();
          return;
        }
        const button = e.target.closest?.("[data-comp-tab]");
        if (!button) return;
        COMP.tab = button.dataset.compTab;
        COMP.currentTab().loadedFor = undefined;
        UI.render();
        UI.$(`[data-comp-tab="${COMP.tab}"]`)?.focus(); // the redraw replaced the tab, so the keyboard stays on it
      });
      document.addEventListener("change", (e) => {
        if (e.target.id !== "comp-site") return;
        // Summary carries on from All my sites to one site, so the dropdown is what narrows it.
        if (e.target.value === ALL || COMP.siteId === ALL) COMP.tab = "summary";
        COMP.useSite(e.target.value === ALL ? ALL : Number(e.target.value));
        UI.render();
        UI.$("#comp-site")?.focus();
      });
      window.addEventListener("seocc:site-added", () => { COMP.ready = false; COMP.server = COMP.server; loadSites().then(() => { if (UI.state.route === "competitors") UI.render(); }); });
    },
    page,
    after,
    /* The open tab's own view in the address (mockup.js asks), such as the Competitors table's search and sort. */
    address: () => COMP.currentTab?.()?.address?.() || {},
    fromAddress: (q) => COMP.tabs.forEach((tab) => tab.fromAddress?.(q)),
  };

  Object.assign(window.FR, {
    "Who ranks against you, and what they do": "Qui se classe face à vous, et ce qu'ils font",
    "Competitors of": "Concurrents de",
    "All my sites": "Tous mes sites",
    "Add your site, then its keyword list.": "Ajoutez votre site, puis sa liste de mots-clés.",
    "No sites added yet": "Aucun site ajouté", "Add a site": "Ajouter un site",
    "That didn't load": "Le chargement a échoué",
    "The list of sites didn't load.": "La liste des sites ne s'est pas chargée.",
    "Server busy. Try again in a minute.": "Serveur occupé. Réessayez dans une minute.",
    "Server unreachable. Check the connection, then try again.": "Serveur injoignable. Vérifiez la connexion, puis réessayez.",
    "Something went wrong on the server. Try again.": "Un problème est survenu sur le serveur. Réessayez.",
    "Not in the results checked": "Absent des résultats vérifiés",
  });
})();
