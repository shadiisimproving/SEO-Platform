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

  /* COMP.api("GET", "competitors?site_id=1"), COMP.api("POST", "notes", {...}), or { form: FormData } for files.
     A refused request rejects with the server's own sentence as err.message. */
  COMP.api = async (method, path, body, opts = {}) => {
    if (!(await isServer())) return sampleCall(method, path, body, opts);
    const init = { method };
    if (opts.form) init.body = opts.form;
    else if (body !== undefined) { init.headers = { "Content-Type": "application/json" }; init.body = JSON.stringify(body); }
    const reply = await fetch(`api/${path}`, init);
    const data = await reply.json().catch(() => ({}));
    if (!reply.ok) {
      const err = new Error(data.error || `Error ${reply.status}`);
      err.status = reply.status;
      err.headers = data.headers;
      throw err;
    }
    return data;
  };

  // ---- small shared pieces ------------------------------------------------------------------
  COMP.loading = () => `<div class="card"><div class="empty"><p>${UI.t("Loading…")}</p></div></div>`;
  COMP.empty = (title, text, action = "") => `<div class="table-wrap"><div class="empty"><h3>${UI.esc(title)}</h3><p>${UI.esc(text)}</p>${action}</div></div>`;
  COMP.fail = (err) => UI.toast(UI.t(err.message), { kind: "crit" });
  COMP.site = () => COMP.sites.find((s) => s.id === COMP.siteId) || null;

  /* How long ago, in the language on screen. */
  COMP.ago = (iso) => {
    if (!iso) return "—";
    const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    const fr = UI.state.lang === "fr";
    const word = minutes < 1 ? (fr ? "à l'instant" : "just now") : minutes < 60 ? `${minutes} min` : minutes < 2880 ? `${Math.round(minutes / 60)} h` : minutes < 86400 ? `${Math.round(minutes / 1440)} ${fr ? "j" : "d"}` : `${Math.round(minutes / 43200)} ${fr ? "mois" : "mo"}`;
    return minutes < 1 ? word : fr ? `il y a ${word}` : `${word} ago`;
  };

  /* A position beside its tool. Beyond the depth checked it says so: it never reads as a number. */
  COMP.pos = (n, depth = 10) => (n === null || n === undefined ? `<span class="muted" title="${UI.t("Not in the results checked")}">&gt;${depth}</span>` : `<span class="tabular">#${n}</span>`);
  COMP.shortUrl = (url) => String(url || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") || "/";
  /* Text from other websites can be any language or direction, so it always carries dir="auto" and goes through esc. */
  COMP.link = (url, text = null, cls = "mono small") => `<a class="${cls} comp-url" dir="auto" href="${UI.esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${UI.esc(text ?? COMP.shortUrl(url)).replace(/([/-])/g, "$1<wbr>")}</a>`; // an address breaks after a slash or hyphen, not mid-word
  COMP.foreign = (text) => `<span dir="auto">${UI.esc(text)}</span>`;

  // ---- the shell ----------------------------------------------------------------------------
  COMP.currentTab = () => COMP.tabs.find((tab) => tab.id === (COMP.siteId === ALL ? "summary" : COMP.tab)) || COMP.tabs[0];
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
      if (COMP.currentTab() === tab) { const box = UI.$("#comp-body"); if (box) UI.setHTML(box, COMP.empty(UI.t("That didn't load"), UI.t(err.message))); }
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
        if (UI.state.route === "competitors" && UI.$("#comp-body")) COMP.paint(); else if (["backlinks"].includes(UI.state.route)) UI.render();
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
    if (!COMP.ready) return `${head}<div class="content page-enter">${COMP.loading()}</div>`;
    if (!COMP.sites.length) {
      return `${head}<div class="content page-enter"><div class="table-wrap"><div class="empty" id="comp-no-sites"><h3>${t("No websites added yet")}</h3><p>${t("Add your own website, then upload its keyword list.")}</p><button class="btn btn-main" id="site-add">${icon("plus")}${t("Add a website")}</button></div></div></div>`;
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
      UI.replaceNextUrl();
    }
    COMP.tabFromAddress = false;
    COMP.lastPicked = picked;
    const tab = COMP.currentTab();
    const all = COMP.siteId === ALL;
    const allOption = COMP.canShowAll() ? `<option value="${ALL}" ${all ? "selected" : ""}>${t("All my sites")}</option>` : "";
    return `${head}<div class="content page-enter">
      <div class="comp-bar"><label class="field comp-site"><span>${t("Competitors of")}</span><select class="select" id="comp-site">${allOption}${COMP.sites.map((s) => `<option value="${s.id}" ${s.id === COMP.siteId ? "selected" : ""}>${esc(s.host)}</option>`).join("")}</select></label>${UI.showingNote(COMP.site()?.host)}</div>
      ${all ? "" : `<div class="tabs comp-tabs" role="tablist" aria-label="${t("Competitors")}">${COMP.tabs.map((x) => `<button class="tab" role="tab" data-comp-tab="${x.id}" aria-selected="${x.id === tab.id}">${x.icon ? icon(x.icon) : ""}${esc(t(x.label))}${x.badge?.() ? `<span class="count">${x.badge()}</span>` : ""}</button>`).join("")}</div>`}
      <div id="comp-body">${tab.loadedFor === COMP.siteId ? tab.body() : COMP.loading()}</div>
    </div>`;
  }

  function after() {
    if (!COMP.ready) {
      loadSites().then(() => { if (UI.state.route === "competitors") UI.render(); }).catch(COMP.fail);
      return;
    }
    const tab = COMP.currentTab();
    if (!tab || !COMP.sites.length) return;
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
  };

  Object.assign(window.FR, {
    "Who ranks against you, and what they do": "Qui se classe face à vous, et ce qu'ils font",
    "Competitors of": "Concurrents de",
    "All my sites": "Tous mes sites",
    "Add your own website, then upload its keyword list.": "Ajoutez votre site, puis importez sa liste de mots-clés.",
    "That didn't load": "Le chargement a échoué",
    "Not in the results checked": "Absent des résultats vérifiés",
  });
})();
