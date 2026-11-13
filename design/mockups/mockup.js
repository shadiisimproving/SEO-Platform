/* Clickable mockup. Vanilla JS standing in for what Jinja + HTMX + Alpine do in the app.
   All generated HTML goes through DOMPurify (setHTML), and values through esc(). */
(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const store = {
    get(k) { try { return localStorage.getItem("seocc2-" + k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem("seocc2-" + k, v); } catch { /* private mode */ } },
  };
  // target stays allowed, or every outside link replaces the app in its own tab. Each one also sets rel="noopener".
  const fragment = (html) => { const out = window.DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, ADD_ATTR: ["target"] }); window.BRANDS.mark(out); return out; };
  const setHTML = (el, html) => el.replaceChildren(fragment(html));
  // Rows alone would lose their <tr> and <td> on the way through DOMPurify, so they go in inside a table.
  const setRows = (tbody, html) => tbody.replaceChildren(...fragment(`<table><tbody>${html}</tbody></table>`).querySelector("tbody").children);

  // The menu collapses to icons by itself on small laptops, so tables keep every column.
  // Its toggle still wins. At 860 px and below the menu is a drawer, never icons only.
  const railWidth = matchMedia("(min-width: 861px) and (max-width: 1240px)");
  const drawerWidth = matchMedia("(max-width: 860px)");
  const wantsRail = () => {
    if (drawerWidth.matches) return false;
    const saved = store.get("rail");
    return saved === "1" || (saved !== "0" && railWidth.matches);
  };

  // The one look, in look-clear.css. An old choice still saved in a browser falls back to it.
  const LOOKS = [["clear"]];
  const validLook = (v) => (LOOKS.some(([id]) => id === v) ? v : null);

  const state = {
    look: validLook(params.get("look")) || validLook(store.get("look")) || "clear",
    theme: params.get("theme") || store.get("theme") || "light",
    lang: params.get("lang") || store.get("lang") || "en",
    firstRun: params.get("data") === "first" || Boolean(window.BOOT && !window.BOOT.sites.length), served: Boolean(window.BOOT),
    route: "today", site: "all", rng: null, // the one date range of the app: UI.range below
    engine: "google", view: "positions", filter: "all", sort: { key: "vol", dir: "descending" },
    selected: new Set(), dense: store.get("dense") === "1", rail: wantsRail(),
    cols: { vol: true, trend: true, page: true, ai: true },
    attentionAll: false, seen: new Set(), setupHidden: false,
    healthTab: "test", blSection: "done", blTab: "all", blFilter: "all", blLimit: 100, prospectLimit: 100, refreshBusy: false, lastRefresh: 2,
  };
  // The simpler screens (2026-11-11) are built behind this switch, so the owner can see old and new side by side.
  // ?simple=1 or ?simple=0 sets it and it is remembered. It shows as data-simple on <html>, read by CSS and by UI.simple().
  if (params.get("simple") === "1" || params.get("simple") === "0") store.set("simple", params.get("simple"));
  // Since 2026-11-12 (owner, after the UI critique) the simpler screens are the default: only ?simple=0 brings the old ones back.
  state.simple = store.get("simple") !== "0";
  root.dataset.simple = state.simple ? "1" : "0";

  // ---- text and numbers -----------------------------------------------------
  const t = (s) => (state.lang === "fr" && window.FR[s] !== undefined ? window.FR[s] : s);
  const num = (n) => new Intl.NumberFormat(state.lang === "fr" ? "fr-FR" : "en-GB").format(n);
  const dec = (n) => String(n).replace(".", state.lang === "fr" ? "," : ".");
  const money = (n) => (n === 0 ? "—" : `$${num(n)}`);
  const days = (d) => (d === 0 ? (state.lang === "fr" ? "à l'instant" : "just now") : `${d} ${state.lang === "fr" ? "j" : "d"}`);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const icon = (name, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${window.ICONS[name] || ""}</svg>`;
  const status = (sev, word) => {
    const map = { crit: ["octagon-alert", "crit"], warn: ["triangle-alert", "warn"], info: ["info", "sec"], good: ["circle-check", "good"], serious: ["triangle-alert", "serious"], planned: ["clock", "sec"] };
    return `<span class="status ${map[sev][1]}">${icon(map[sev][0])}${esc(word)}</span>`;
  };
  // Logos are copied into the project, so nothing loads from outside.
  const LOGOS = { google: "google.svg", googleads: "googleads.svg", duckduckgo: "duckduckgo.png", bing: "bing.svg", yandex: "yandex.png", "Bright Data": "brightdata.png", SerpApi: "serpapi.png", HasData: "hasdata.png", Searlo: "searlo.png", "DuckDuckGo direct": "duckduckgo.png", SearXNG: "searxng.svg", clarity: "clarity.png", analytics: "analytics.svg", openpagerank: "openpagerank.png", searchconsole: "searchconsole.png", pagespeed: "pagespeed.png", moz: "moz.png", cloudflare: "cloudflare.png", commoncrawl: "commoncrawl.jpg", indexnow: "indexnow.png", openrouter: "openrouter.png", ahrefs: "ahrefs.png", firecrawl: "firecrawl.png", anthropic: "anthropic.png" };
  const logo = (name, size = 18, cls = "") => (LOGOS[name]
    ? `<img class="logo ${cls}" src="logos/${LOGOS[name]}" alt="" width="${size}" height="${size}">`
    : `<span class="logo ${cls}" style="width:${size}px;height:${size}px" aria-hidden="true">${name === "Browser on this Mac" ? icon("globe") : esc(String(name || "?")[0].toUpperCase())}</span>`);

  /* These big sites tell bots to stay away, so our server can never fetch their icon: the app carries a copy. */
  const SITE_FILES = new Map([["facebook.com", "facebook.svg"], ["instagram.com", "instagram.svg"], ["linkedin.com", "linkedin.svg"], ["trustpilot.com", "trustpilot.svg"]]);

  /* A website's own icon, once our server has fetched it. A subdomain with none uses its parent's: m.facebook.com is Facebook. Until then its first letter, so rows still line up. */
  const siteLogo = (domain, size = 20) => {
    const names = String(domain || "").toLowerCase().split(".").map((_, i, all) => all.slice(i).join("."));
    const carried = names.find((name) => SITE_FILES.has(name));
    const fetched = names.find((name) => window.LOGOS_KNOWN?.has(name));
    if (!carried && !fetched) return `<span class="site-logo letter" style="width:${size}px;height:${size}px" aria-hidden="true">${esc(String(domain || "?")[0].toUpperCase())}</span>`;
    return `<img class="site-logo" src="${carried ? `logos/${SITE_FILES.get(carried)}` : `api/logos/${encodeURIComponent(fetched)}`}" alt="" width="${size}" height="${size}" loading="lazy">`;
  };

  /* The site menu's mark: the site's own icon once fetched, its first letter until then. */
  const siteMark = (host) => (window.LOGOS_KNOWN?.has(host)
    ? `<img class="dot-site dot-logo" src="api/logos/${encodeURIComponent(host)}" alt="" width="22" height="22">`
    : `<span class="dot-site">${esc(String(host || "?")[0].toUpperCase())}</span>`);

  const linkDomain = (url) => window.BacklinkCleaner.rootDomain(url) || "";

  // Any country: names come from the browser, in the language on screen.
  const COUNTRY_CODES = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW".split(" ");
  const countryName = (code) => { try { return new Intl.DisplayNames([state.lang === "fr" ? "fr" : "en"], { type: "region" }).of(code) || code; } catch { return code; } };
  /* A country as its flag, its name on hover and for screen readers (2026-11-12: "FR, change this with the France logo").
     A code that isn't two letters stays as text. */
  const flag = (code) => {
    const c = String(code || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) return c ? `<span class="small">${esc(c)}</span>` : "";
    const name = countryName(c);
    const emoji = String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
    return `<span class="flag" role="img" title="${esc(name)}" aria-label="${esc(name)}">${emoji}</span>`;
  };
  const countryOptions = (selected) => COUNTRY_CODES.map((c) => [c, countryName(c)]).sort((a, b) => a[1].localeCompare(b[1], state.lang)).map(([c, n]) => `<option value="${c}" ${c === selected ? "selected" : ""}>${esc(n)}</option>`).join("");
  // The languages a keyword list or an idea search can pick, named the same way.
  const LANGUAGE_CODES = "af ar az bg bn ca cs da de el en es et fa fi fil fr he hi hr hu hy id it ja ka kk ko lt lv ms nb nl pa pl pt ro ru si sk sl sq sr sv sw ta te th tr uk ur uz vi zh".split(" ");
  const languageOptions = (selected) => {
    const lang = state.lang === "fr" ? "fr" : "en";
    let names;
    try { names = new Intl.DisplayNames([lang], { type: "language" }); } catch { names = null; }
    return LANGUAGE_CODES
      .map((code) => { const name = names?.of(code) || code; return [code, name.charAt(0).toLocaleUpperCase(lang) + name.slice(1)]; })
      .sort((a, b) => a[1].localeCompare(b[1], lang))
      .map(([code, name]) => `<option value="${code}" ${code === selected ? "selected" : ""}>${esc(name)}</option>`).join("");
  };

  // ---- dates ------------------------------------------------------------------
  const TODAY = window.BOOT?.today || "2026-11-04", FIRST_DAY = window.BOOT ? "2020-01-01" : "2025-07-01";
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return iso(d); };
  const dayCount = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5) + 1;
  // The last day with data: Google Analytics is read through yesterday (F112). A screen that knows better says so (UI.range.end).
  const DATA_END = window.BOOT ? addDays(TODAY, -1) : "2026-11-01";
  const locale = () => (state.lang === "fr" ? "fr-FR" : "en-GB");
  const fmtDay = (s, opts = { day: "numeric", month: "short", year: "numeric" }) => new Intl.DateTimeFormat(locale(), opts).format(parseDay(s));
  const fmtShort = (s) => fmtDay(s, { day: "numeric", month: "short" });
  const fmtRange = (a, b) => (a === b ? fmtDay(a) : a.slice(0, 4) === b.slice(0, 4) ? `${fmtShort(a)} – ${fmtDay(b)}` : `${fmtDay(a)} – ${fmtDay(b)}`);

  /* ---- one date range for the whole app -------------------------------------------------------------
     Every dated screen draws the same picker in the same place (the top bar), and reads the same choice: it is kept in this
     browser and in the address, so it survives moving between screens, a reload and a pasted link. Presets end on the last day
     with data. Search Console screens send the preset itself (UI.range.search()) and the server ends it on Google's last final
     day; day-based screens send dates (UI.range.days()).
       UI.range.get({ end, hours })  → { preset, from, to, compare, compareFrom, compareTo, days, label, compareLabel }
       UI.range.set({ preset } | { from, to } | { compare })  saves, updates the address, tells listeners, redraws
       UI.range.on(fn)  → off();   window event "seocc:range" too
       UI.range.search() → "range=28d&compare=prev" (or range=custom&from=…&to=…)
       UI.range.days({ end }) → "from=…&to=…&compare_from=…&compare_to=…"
       UI.range.end(route, day, source)  the last day with data a screen learnt from its answer, so the picker's dates match it.
         With `source` ("Search Console"), a screen whose data ends before yesterday says why its dates differ from the others.
       UI.range.behind() → the sentence saying how far behind this screen's data runs, or "" */
  const RANGE_PRESETS = [["24h", "Last 24 hours"], ["7d", "Last 7 days"], ["28d", "Last 28 days"], ["3m", "Last 3 months"], ["6m", "Last 6 months"], ["12m", "Last 12 months"], ["16m", "Last 16 months"], ["tm", "This month"], ["lm", "Last month"]];
  const RANGE_COMPARES = [["prev", "vs previous period"], ["yoy", "vs last year"], ["none", "No comparison"]];
  const RANGE_DEFAULT = { preset: "28d", from: null, to: null, compare: "prev" };
  const HOURLY_SCREENS = new Set(["overview"]); // only these can show the last 24 hours hour by hour
  const DATED_SCREENS = new Set(["today", "overview", "insights", "channels", "conversions", "content", "ai", "backlinks"]);
  const validDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && iso(parseDay(v)) === v;
  function cleanRange(r = {}) {
    const out = { ...RANGE_DEFAULT };
    if (RANGE_COMPARES.some(([id]) => id === r.compare)) out.compare = r.compare;
    if (r.preset === "custom") { if (validDay(r.from) && validDay(r.to) && r.from <= r.to) Object.assign(out, { preset: "custom", from: r.from, to: r.to }); }
    else if (RANGE_PRESETS.some(([id]) => id === r.preset)) out.preset = r.preset;
    return out;
  }
  state.rng = cleanRange((() => { try { return JSON.parse(store.get("range") || "{}"); } catch { return {}; } })());
  const rangeEnds = {}, rangeSources = {}, rangeListeners = new Set();
  /* The same "28 days" ends on different days: Search Console runs 2 to 3 days behind, Google Analytics 1. Each period control
     shows its real dates, and this sentence says why when this screen's data ends before yesterday. */
  function rangeBehind(route = state.route) {
    const end = rangeEnds[route];
    if (!validDay(end) || end >= DATA_END) return "";
    const n = dayCount(end, DATA_END) - 1; // the days after its last one, up to yesterday
    const source = rangeSources[route];
    const words = t(source ? (n === 1 ? "{source} data runs 1 day behind, so these dates end on {day}." : "{source} data runs {n} days behind, so these dates end on {day}.")
      : (n === 1 ? "This data runs 1 day behind, so these dates end on {day}." : "This data runs {n} days behind, so these dates end on {day}."));
    return words.replace("{source}", t(source || "")).replace("{n}", num(n)).replace("{day}", fmtDay(end));
  }
  // The next longer period, as a button, for an empty card: 7 days → 28 days → 3 months → 6 → 12 → 16. Nothing past 16 months.
  const LONGER = { "24h": "7d", "7d": "28d", "28d": "3m", "3m": "6m", "6m": "12m", "12m": "16m", tm: "3m", lm: "3m", custom: "3m" };
  function longerPeriodButton() {
    const next = LONGER[state.rng.preset];
    if (!next) return "";
    const name = RANGE_PRESETS.find(([id]) => id === next)[1];
    return `<button type="button" class="btn btn-small" data-preset="${next}">${icon("calendar-days")}${esc(t("Show {period}").replace("{period}", t(name).toLowerCase()))}</button>`;
  }
  const behindMark = () => { const words = rangeBehind(); return words ? `<span class="def-i range-behind" role="img" tabindex="0" data-tip="${esc(words)}" aria-label="${esc(words)}">${icon("clock")}</span>` : ""; };
  const monthsBack = (day, n) => { const d = parseDay(day); return addDays(iso(new Date(d.getFullYear(), d.getMonth() - n, d.getDate())), 1); };
  function rangeGet({ end = null, hours = HOURLY_SCREENS.has(state.route) } = {}) {
    const r = state.rng, last = validDay(end) ? end : rangeEnds[state.route] || DATA_END;
    let from = last, to = last;
    switch (r.preset) {
      case "24h": break; // a day-based screen shows the last day; an hourly one asks the server for the hours
      case "7d": from = addDays(last, -6); break;
      case "28d": from = addDays(last, -27); break;
      case "3m": from = monthsBack(last, 3); break;
      case "6m": from = monthsBack(last, 6); break;
      case "12m": from = monthsBack(last, 12); break;
      case "16m": from = monthsBack(last, 16); break;
      case "tm": from = `${last.slice(0, 7)}-01`; break;
      case "lm": { const first = parseDay(`${last.slice(0, 7)}-01`); from = iso(new Date(first.getFullYear(), first.getMonth() - 1, 1)); to = iso(new Date(first.getFullYear(), first.getMonth(), 0)); break; }
      case "custom": from = r.from; to = r.to; break;
      default: from = addDays(last, -27);
    }
    const days = dayCount(from, to);
    let compareFrom = null, compareTo = null;
    if (r.compare === "prev") { compareTo = addDays(from, -1); compareFrom = addDays(compareTo, -(days - 1)); }
    if (r.compare === "yoy") { compareFrom = addDays(from, -364); compareTo = addDays(to, -364); }
    const name = RANGE_PRESETS.find(([id]) => id === r.preset)?.[1];
    const label = r.preset === "custom" ? fmtRange(from, to) : r.preset === "24h" && !hours ? fmtDay(to) : t(name);
    const compareLabel = r.compare === "none" ? t("No comparison") : `${t("vs")} ${fmtRange(compareFrom, compareTo)}`;
    return { preset: r.preset, from, to, compare: r.compare, compareFrom, compareTo, days, label, compareLabel, hours: r.preset === "24h" && hours };
  }
  function rangeSet(partial = {}) {
    const next = cleanRange({ ...state.rng, ...partial, ...(partial.from || partial.to ? { preset: "custom" } : {}) });
    if (JSON.stringify(next) === JSON.stringify(state.rng)) return;
    state.rng = next;
    store.set("range", JSON.stringify(next));
    const now = rangeGet();
    rangeListeners.forEach((fn) => { try { fn(now); } catch (err) { console.error(err); } });
    window.dispatchEvent(new CustomEvent("seocc:range", { detail: now }));
    if (urlReady) render({ enter: true });
  }
  const UIRange = {
    get: rangeGet, set: rangeSet,
    on(fn) { rangeListeners.add(fn); return () => rangeListeners.delete(fn); },
    // Called while a page is being drawn, so the picker is brought up to date just after, once the new top bar is in.
    end(route, day, source = "") {
      if (source) rangeSources[route] = source;
      if (!validDay(day) || rangeEnds[route] === day) return;
      rangeEnds[route] = day;
      setTimeout(() => {
        if (state.route !== route || $("#popover")) return;
        if (state.simple) { redrawHeadRange(); return; } // the simpler head: only its dates and comparison phrase
        const picks = $(".range-picks");
        if (picks) picks.replaceWith(fragment(datePicks()));
      }, 0);
    },
    search() {
      const r = state.rng, parts = [`range=${r.preset}`, `compare=${r.compare}`];
      if (r.preset === "custom") parts.push(`from=${r.from}`, `to=${r.to}`);
      return parts.join("&");
    },
    days(opts = {}) {
      const g = rangeGet({ end: opts.end || DATA_END, hours: false }), parts = [`from=${g.from}`, `to=${g.to}`];
      if (g.compareFrom) parts.push(`compare_from=${g.compareFrom}`, `compare_to=${g.compareTo}`);
      return parts.join("&");
    },
    behind: rangeBehind,
    presets: RANGE_PRESETS, compares: RANGE_COMPARES, isDefault: () => JSON.stringify(state.rng) === JSON.stringify(RANGE_DEFAULT),
  };
  // Older callers: the window as { from, to }, and its words.
  const periodWindow = () => { const g = rangeGet({ hours: false }); return { from: g.from, to: g.to }; };
  const periodLabel = () => rangeGet().label;

  // ---- shell ----------------------------------------------------------------
  const NAV = [
    { id: "today", label: "Today", icon: "layout-dashboard" },
    { group: "Traffic" },
    { id: "channels", label: "Channels", icon: "activity" }, { id: "conversions", label: "Conversions", icon: "filter" }, { id: "content", label: "Content", icon: "file-text" },
    { group: "Search" },
    { id: "overview", label: "Overview", icon: "search" }, { id: "pages", label: "Pages", icon: "layers" }, { id: "insights", label: "Insights", icon: "trending-up" }, { id: "keywords", label: "Keywords", icon: "key-round" }, { id: "competitors", label: "Competitors", icon: "crosshair" }, { id: "ai", label: "AI search", icon: "sparkles" },
    { group: "Ads" },
    { id: "ads", label: "Google Ads", icon: "megaphone", logo: "googleads" },
    { group: "Work" },
    { id: "tasks", label: "Tasks", icon: "square-check" }, { id: "notes", label: "Notes", icon: "sticky-note" }, { id: "backlinks", label: "Backlinks", icon: "link-2" }, { id: "resources", label: "Resources", icon: "folder-open" },
    { group: "Health" },
    { id: "health", label: "Site health", icon: "heart-pulse" },
  ];
  // Screens in their own files register in window.SCREENS, and get the helpers through window.UI below.
  const BUILT = new Set(["today", "keywords", "backlinks", "health", "settings", ...Object.keys(window.SCREENS || {})]);
  const siteName = () => (state.site === "all" ? t("All sites") : window.SITES.find((s) => s.id === state.site).host);
  // An alert about one site only shows on that site. One about the whole app shows everywhere.
  const visibleAttention = () => { const picked = state.site === "all" ? null : window.SITES.find((s) => s.id === state.site)?.host; return window.ATTENTION.filter((a) => !state.seen.has(a.id) && (!picked || !a.host || a.host === picked)); };
  const attentionCounts = () => {
    const list = visibleAttention();
    return { crit: list.filter((a) => a.sev === "crit").length, warn: list.filter((a) => a.sev === "warn").length, info: list.filter((a) => a.sev === "info").length + window.ATTENTION_EXTRA_INFO };
  };

  /* The foot of the side menu is one row: who is signed in, opening a small menu, and the collapse button.
     Settings, dark mode, language and sign out live in that menu, as in most apps. A first-run view for testing is at ?data=first. */
  const me = () => window.BOOT?.user || null;
  const sideAccount = () => {
    const user = me(), name = user ? user.name : t("Settings and display");
    const mark = user ? `<span class="acct-av" aria-hidden="true">${esc(String(user.name || "?").trim()[0]?.toUpperCase() || "?")}</span>` : icon("settings");
    const tip = state.rail ? `data-tip="${esc(name)}"` : "";
    return `<div class="side-acct">
      <button class="nav-item acct-btn" id="acct-btn" aria-haspopup="true" aria-expanded="false" aria-label="${esc(user ? `${name}: ${t("Settings, display and sign out")}` : name)}" ${state.route === "settings" ? 'aria-current="page"' : ""} ${tip}>${mark}<span class="label" dir="auto">${esc(name)}</span>${icon("chevron-up", "chev muted")}</button>
      <button class="icon-btn rail-toggle" id="rail-toggle" aria-label="${t(state.rail ? "Expand menu" : "Collapse menu")}" data-tip="${t(state.rail ? "Expand menu" : "Collapse menu")}">${icon("panel-left")}</button>
    </div>`;
  };
  const accountMenu = () => {
    const user = me(), dark = state.theme === "dark", fr = state.lang === "fr";
    const who = user ? `<div class="acct-who"><div class="t" dir="auto">${esc(user.name)}</div><div class="s muted" dir="auto">${esc(user.email || "")}</div></div><hr>` : "";
    return `${who}<button data-go="settings">${icon("settings")}${t("Settings")}</button>
      <button data-mock="theme" data-v="${dark ? "light" : "dark"}">${icon(dark ? "sun" : "moon")}${t(dark ? "Light mode" : "Dark mode")}</button>
      <button data-mock="lang" data-v="${fr ? "en" : "fr"}" lang="${fr ? "en" : "fr"}">${icon("languages")}${fr ? "English" : "Français"}</button>
      ${user ? `<hr><button data-lv-signout>${icon("log-out")}${t("Sign out")}</button>` : ""}`;
  };

  function renderSidebar() {
    const c = attentionCounts();
    const urgent = state.firstRun ? 0 : c.crit + c.warn;
    // Only the sections this person has, and a group heading only when something under it is left.
    const mine = [];
    NAV.forEach((n) => {
      if (n.group) { mine.push(n); return; }
      if (!window.ACCESS || ACCESS.can(n.id)) mine.push(n);
    });
    for (let i = mine.length - 1; i >= 0; i -= 1) if (mine[i].group && (!mine[i + 1] || mine[i + 1].group)) mine.splice(i, 1);
    const items = mine.map((n) => {
      if (n.group) return `<div class="nav-group">${t(n.group)}</div>`;
      const current = state.route === n.id ? 'aria-current="page"' : "";
      const healthAlerts = n.id === "health" ? (window.HealthTest?.openAlerts?.() || 0) : 0;
      // The count says what it counts: the button's own name carries the words ("Today, 6 to do"), the number is only seen.
      const countN = n.id === "today" && urgent ? urgent : healthAlerts;
      const countWords = !countN ? "" : t(n.id === "today" ? "{n} to do" : "{n} to fix").replace("{n}", num(countN));
      const badge = countN ? `<span class="count" aria-hidden="true">${num(countN)}</span>` : "";
      // Not built yet: it says so before anyone clicks, and there's nothing to click.
      if (!BUILT.has(n.id)) return `<span class="nav-item nav-soon" role="link" aria-disabled="true" ${state.rail ? `data-tip="${esc(t(n.label))} · ${t("Soon")}"` : ""} aria-label="${esc(t(n.label))}: ${t("Not built yet")}">${n.logo ? logo(n.logo) : icon(n.icon)}<span class="label">${t(n.label)}</span><span class="soon-tag">${t("Soon")}</span></span>`;
      const tip = state.rail ? `data-tip="${esc(t(n.label))}"` : "";
      return `<button class="nav-item" data-go="${n.id}" ${current} ${tip} aria-label="${esc(t(n.label))}${countWords ? `, ${esc(countWords)}` : ""}">${n.logo ? logo(n.logo) : icon(n.icon)}<span class="label">${t(n.label)}</span>${badge}</button>`;
    }).join("");
    setHTML($("#sidebar"), `
      <div class="brand"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17 9.5 10.5l4.5 3.5 6-8"/></svg></span><span class="brand-name">Command Center</span></div>
      <div class="side-top">
        <button class="switcher" id="site-switch" aria-haspopup="true" aria-label="${esc(siteName())}">
          ${state.site === "all" ? `<span class="dot-site">${icon("globe")}</span>` : siteMark(siteName())}
          <span class="name">${esc(siteName())}</span>${icon("chevron-down", "chev muted")}
        </button>
        ${state.simple ? sideSearch() : ""}
      </div>
      <nav class="nav" aria-label="Main">${items}</nav>
      <div class="side-foot">${sideAccount()}</div>`);
  }

  /* The one date control: the period in words, then what it's compared with, as dates. Same place on every dated screen. */
  const datePicks = () => {
    const g = rangeGet(), cmpName = t(RANGE_COMPARES.find(([id]) => id === g.compare)[1]);
    return `<span class="range-picks" role="group" aria-label="${t("Dates")}"><button class="pick" id="period" aria-haspopup="dialog" aria-expanded="false" aria-label="${t("Period")}: ${esc(g.label)}, ${esc(fmtRange(g.from, g.to))}" data-tip="${esc(g.hours ? t("Last 24 hours") : fmtRange(g.from, g.to))}">${icon("calendar-days")}<span class="pick-label">${g.hours || g.preset === "custom" ? esc(g.label) : `<span class="pick-name">${esc(g.label)}<span aria-hidden="true"> · </span></span><span class="pick-dates">${esc(fmtShort(g.from))} – ${esc(fmtShort(g.to))}</span>`}</span>${icon("chevron-down", "chev")}</button>
        <button class="pick" id="compare" aria-haspopup="true" aria-expanded="false" aria-label="${t("Compare with")}: ${esc(cmpName)}${g.compareFrom ? `, ${esc(fmtRange(g.compareFrom, g.compareTo))}` : ""}" data-tip="${esc(cmpName)}"><span class="pick-label">${esc(g.compareLabel)}</span>${icon("chevron-down", "chev")}</button>${behindMark()}</span>`;
  };
  // With the simpler screens switch on, the same call draws the new head (UI.head below), so screens not yet moved still draw.
  const topbar = (title, sub, main = "", withDates = true) => (state.simple ? drawHead({ title, period: withDates, main, ...subParts(sub) }) : `
    <header class="topbar" id="topbar">
      <button class="icon-btn menu-btn" id="menu-btn" aria-label="${t("Open menu")}">${icon("menu")}</button>
      <div class="grow"><h1>${esc(title)}</h1><p class="sub">${sub}</p></div>
      <div class="tools">
        <button class="btn btn-ghost kbd-hint" id="cmd-open" aria-label="${t("Search or jump to…")}">${icon("search")}<span class="kbd">⌘K</span></button>
        ${window.Bell ? window.Bell.button() : ""}
        ${withDates ? datePicks() : ""}
        ${main}
      </div>
    </header>`);

  /* ---- the simpler screens' head (plan-seo-command-center-simplify-screens-like-mickaz.md, 3.1) ---------------------------
     Drawn only while UI.simple() is on. The same place and shape on every screen: the title, one date line, and on the right
     the period as visible buttons, the bell, Export (export.js adds it to #topbar .tools) and the screen's one main action.
       UI.head({ title, period = true, source = null, status = null, line = "", info = "", main = "" })
     period  a dated screen: 7 days · 28 days · 3 months · 12 months · More, and the dates and the comparison phrase in the line
     source  { name, through } or a list of them: "Google Analytics, through 10 Nov", through only when the data ends before the
             period does. Or a chip that opens a panel: { word, open }, with sev "warn" | "crit" when it needs the owner.
     status  { sev: "good" | "warn" | "crit", word, open }: a chip, only when something needs the owner
     line    HTML: what the data covers and how fresh, on an undated screen (on a dated one it comes before the dates)
     info    a sentence or a list behind the (i) at the end of the line: the caveats and the screen's old subtitle sentence.
             English goes through t(), as with UI.info.
     main    the screen's one main action (HTML)
     open    a function, or the attributes of a control the app already handles, such as 'data-go="settings"'.
     #period (More) and #compare (the comparison phrase) keep their ids, so the date picker and flows find them. */
  const HEAD_PRESETS = [["7d", "7 days"], ["28d", "28 days"], ["3m", "3 months"], ["12m", "12 months"]];
  const HEAD_SEP = '<span class="head-sep"> · </span>';
  [["7 days", "7 jours"], ["28 days", "28 jours"], ["3 months", "3 mois"], ["12 months", "12 mois"], ["More", "Plus"], ["More periods", "Autres périodes"],
    ["vs {range}", "par rapport au {range}"], ["no comparison", "sans comparaison"], ["vs the 24 hours before", "par rapport aux 24 heures d'avant"],
    ["vs same days last year", "vs mêmes jours l'an dernier"], ["through {day}", "jusqu'au {day}"], ["{a} and {b}", "{a} et {b}"],
    ["Open the checklist", "Ouvrir la liste"], ["Set up {host}: {done} of {all} done", "Configurer {host} : {done} sur {all} faits"]]
    .forEach(([en, fr]) => { if (window.FR[en] === undefined) window.FR[en] = fr; });
  // UI critique fixes, 2026-11-12 (track 4).
  [["{n} to do", "{n} à faire"], ["{n} to fix", "{n} à corriger"],
    ["{source} data runs 1 day behind, so these dates end on {day}.", "Les données {source} ont 1 jour de retard : ces dates finissent le {day}."],
    ["{source} data runs {n} days behind, so these dates end on {day}.", "Les données {source} ont {n} jours de retard : ces dates finissent le {day}."],
    ["This data runs 1 day behind, so these dates end on {day}.", "Ces données ont 1 jour de retard : ces dates finissent le {day}."],
    ["This data runs {n} days behind, so these dates end on {day}.", "Ces données ont {n} jours de retard : ces dates finissent le {day}."],
    ["Show {period}", "Afficher : {period}"], ["Refreshed: {tool}", "Actualisé : {tool}"],
    ["Nothing to fix", "Rien à corriger"], ["{step} for {host}", "{step} pour {host}"]]
    .forEach(([en, fr]) => { if (window.FR[en] === undefined) window.FR[en] = fr; });
  const headWords = (key, vars = {}) => Object.entries(vars).reduce((text, [k, v]) => text.split(`{${k}}`).join(String(v)), t(key));
  const plainText = (html) => fragment(String(html ?? "")).textContent.replace(/\s+/g, " ").trim();
  // A function handed to the head as `open` is kept here, and the click finds it by number.
  const headOpeners = new Map();
  let headOpenerN = 0;
  function headOpen(open) {
    if (!open) return "";
    if (typeof open !== "function") return String(open);
    headOpenerN += 1;
    headOpeners.set(String(headOpenerN), open);
    if (headOpeners.size > 40) headOpeners.delete(headOpeners.keys().next().value);
    return `data-head-open="${headOpenerN}"`;
  }
  // The comparison's dates leave out the year when it is the period's own.
  function compareDates(g) {
    const sameYear = g.compareFrom.slice(0, 4) === g.to.slice(0, 4) && g.compareTo.slice(0, 4) === g.to.slice(0, 4);
    if (g.compareFrom === g.compareTo) return sameYear ? fmtShort(g.compareTo) : fmtDay(g.compareTo);
    return sameYear ? `${fmtShort(g.compareFrom)} – ${fmtShort(g.compareTo)}` : fmtRange(g.compareFrom, g.compareTo);
  }
  // The dates and the comparison phrase: the part UI.range.end draws again once a screen knows its last day.
  function headRange() {
    const g = rangeGet(), none = g.compare === "none" || !g.compareFrom;
    const phrase = none ? t("no comparison") : g.hours && g.compare === "prev" ? t("vs the 24 hours before") : headWords("vs {range}", { range: compareDates(g) });
    const cmpName = t(g.compare === "yoy" ? "vs same days last year" : RANGE_COMPARES.find(([id]) => id === g.compare)[1]);
    return `<span class="head-range"><span class="head-dates">${esc(g.hours ? t("Last 24 hours") : fmtRange(g.from, g.to))}</span>${behindMark()}${HEAD_SEP}<button type="button" class="head-cmp ${none ? "none" : ""}" id="compare" aria-haspopup="menu" aria-expanded="false" data-tip="${esc(`${t("Compare with")}: ${cmpName}`)}">${esc(phrase)}</button></span>`;
  }
  function headPeriod() {
    const g = rangeGet(), shown = HEAD_PRESETS.some(([id]) => id === g.preset);
    return `<span class="seg head-period" role="group" aria-label="${t("Period")}">${HEAD_PRESETS.map(([id, name]) => `<button type="button" data-preset="${id}" aria-pressed="${g.preset === id}">${t(name)}</button>`).join("")}<button type="button" class="head-more" id="period" aria-haspopup="dialog" aria-expanded="false" aria-pressed="${!shown}" ${shown ? `aria-label="${t("More periods")}"` : ""}><span class="head-more-label">${esc(shown ? t("More") : g.label)}</span>${icon("chevron-down", "chev")}</button></span>`;
  }
  function headSource(source, period) {
    if (!source) return "";
    if (source.word) { // a chip that opens a panel, a status chip when it needs the owner
      const sev = source.sev === "warn" || source.sev === "crit" ? source.sev : "";
      const open = headOpen(source.open), inner = `${sev ? icon(sev === "crit" ? "octagon-alert" : "triangle-alert") : ""}${esc(source.word)}`;
      if (!open) return `<span class="${sev ? `status ${sev} head-status` : "head-src"}">${inner}</span>`;
      return `<button type="button" class="${sev ? `status ${sev} head-status` : "head-chip"}" ${open}>${inner}${sev ? "" : '<span aria-hidden="true"> ›</span>'}</button>`;
    }
    const list = (Array.isArray(source) ? source : [source]).filter((s) => s && s.name);
    if (!list.length) return "";
    const names = list.map((s) => t(s.name));
    const named = names.length > 1 ? headWords("{a} and {b}", { a: names.slice(0, -1).join(", "), b: names[names.length - 1] }) : names[0];
    const through = list.map((s) => String(s.through || "").slice(0, 10)).filter(validDay).sort()[0];
    const shown = through && (!period || through < rangeGet().to); // only when the data ends before the period does
    return `<span class="head-src">${esc(named)}${shown ? `, ${esc(headWords("through {day}", { day: fmtShort(through) }))}` : ""}</span>`;
  }
  function headStatus(s) {
    if (!s?.word) return "";
    const [ic, cls] = { crit: ["octagon-alert", "crit"], good: ["circle-check", "good"] }[s.sev] || ["triangle-alert", "warn"];
    const open = headOpen(s.open);
    return open ? `<button type="button" class="status ${cls} head-status" ${open}>${icon(ic)}${esc(s.word)}</button>` : `<span class="status ${cls} head-status">${icon(ic)}${esc(s.word)}</span>`;
  }
  // The caveats' (i): UI.info (shared-ui.js) when it is there, else the same mark drawn here. Each caveat goes through t().
  const headInfo = (list) => (!list.length ? "" : window.UI?.info ? window.UI.info(list.length > 1 ? list : list[0]) : `<span class="def-i" role="img" tabindex="0" data-tip="${esc(list.map(t).join(" "))}" aria-label="${esc(list.map(t).join(" "))}">${icon("info")}</span>`);
  // On a phone the line is cut to one line, so this (i) holds all of it, and the caveats after it (mockup.css shows it there only).
  const headAllTip = (text, info) => [text, info].filter(Boolean).join(". ");
  function drawHead({ title = "", period = true, source = null, status = null, line = "", info = "", main = "" } = {}) {
    // info: a sentence or a list, in English (translated here) or already in the screen's language; markup is dropped.
    const infoList = (Array.isArray(info) ? info : [info]).map((x) => String(x ?? "").trim()).filter(Boolean).map((x) => (/<[a-z!/]/i.test(x) ? plainText(x) : x));
    const infoText = infoList.map(t).join(" ");
    const text = [line, period ? headRange() : "", headSource(source, period)].filter(Boolean).join(HEAD_SEP) + (status?.word ? ` ${headStatus(status)}` : "");
    const all = headAllTip(plainText(text), infoText);
    return `
    <header class="topbar head" id="topbar">
      <button class="icon-btn menu-btn" id="menu-btn" aria-label="${t("Open menu")}">${icon("menu")}</button>
      <div class="grow head-title">
        ${text || !infoText ? `<h1>${esc(title)}</h1>` : `<div class="head-name"><h1>${esc(title)}</h1>${headInfo(infoList)}</div>`}
        ${text ? `<p class="head-line"><span class="head-text">${text}</span>${headInfo(infoList)}<span class="def-i head-i-all" role="img" tabindex="0" data-tip="${esc(all)}" aria-label="${esc(all)}" data-info="${esc(infoText)}">${icon("info")}</span></p>` : ""}
      </div>
      <div class="tools">
        ${period ? headPeriod() : ""}
        ${window.Bell ? window.Bell.button() : ""}
        ${main}
      </div>
    </header>`;
  }
  function redrawHeadRange() {
    const range = $("#topbar .head-range");
    if (!range) return;
    const focused = document.activeElement?.id === "compare";
    range.replaceWith(fragment(headRange()));
    const all = $("#topbar .head-i-all");
    if (all) { all.dataset.tip = headAllTip(plainText($("#topbar .head-text")?.innerHTML), all.dataset.info); all.setAttribute("aria-label", all.dataset.tip); }
    if (focused) $("#compare")?.focus({ preventScroll: true });
  }
  // Where the keyboard is in the head, so a redraw can put it back: a period button, or anything with an id (More, the comparison).
  function headFocusKey() {
    const el = document.activeElement;
    if (!el?.closest?.("#topbar")) return null;
    if (el.dataset?.preset) return `#topbar [data-preset="${CSS.escape(el.dataset.preset)}"]`;
    return el.id ? `#${CSS.escape(el.id)}` : null;
  }
  /* The old subtitle of a screen that still calls topbar(): the sentence about the screen goes behind the (i), and every other
     part (a date, how fresh, a count the screen fills in later) stays on the date line. */
  const SCREEN_SENTENCES = ["Who ranks against you, and what they do", "Your Google results, from Search Console", "Worked out daily from your Search Console data",
    "Links and documents, per site", "Rankings from engines' own tools and our own checks", "Links built and what they brought", "Problems on your sites",
    "Connect tools and choose their sites", "Where each site's data comes from", "Who can sign in", "Domains worth a closer look", "Every note, on every site",
    "Who does what, where, by when", "Do AI assistants send you leads, and do AI answers cite you?", "Visit and lead sources, from Google Analytics",
    "From visit to lead. Counts only, no personal data.", "Every page and its results", "Cost, clicks and leads from Google Ads, via Google Analytics"];
  function subParts(sub) {
    const own = new Set(SCREEN_SENTENCES.map((s) => t(s)));
    const info = [], line = [], parts = String(sub ?? "").split(" · ");
    // A " · " inside a tag's attribute would cut the tag in two: then the whole subtitle stays on the line, as it was.
    if (parts.some((part) => (part.match(/</g) || []).length !== (part.match(/>/g) || []).length)) return { line: String(sub), info };
    parts.forEach((part) => {
      const markup = /<[a-z]/i.test(part), text = plainText(part);
      if (!text && !markup) return;
      if (!markup && own.has(text)) info.push(text); else line.push(part);
    });
    return { line: line.join(HEAD_SEP), info };
  }
  // The side menu's search row, under the site switcher (simpler screens): ⌘K moves here from the head, the shortcut is the same.
  const sideSearch = () => `<button class="nav-item side-search" id="cmd-open" aria-label="${t("Search or jump to…")}" aria-keyshortcuts="Meta+K Control+K" ${state.rail ? `data-tip="${t("Search or jump to…")} ⌘K"` : ""}>${icon("search")}<span class="label">${t("Search or jump to…")}</span><span class="kbd" aria-hidden="true">⌘K</span></button>`;

  // ---- small drawings ---------------------------------------------------------
  // A smooth line through the points, gentle enough not to overshoot them much.
  function smooth(pts) {
    if (pts.length < 3) return pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    const k = 0.16;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i - 1] || pts[i], [x1, y1] = pts[i], [x2, y2] = pts[i + 1], [x3, y3] = pts[i + 2] || pts[i + 1];
      d += `C${(x1 + (x2 - x0) * k).toFixed(1)},${(y1 + (y2 - y0) * k).toFixed(1)} ${(x2 - (x3 - x1) * k).toFixed(1)},${(y2 - (y3 - y1) * k).toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
    }
    return d;
  }

  function spark(values, { invert = false, w = 72, h = 22, area = false } = {}) {
    if (!values || values.length < 2) return "";
    const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
    const pts = values.map((v, i) => {
      const n = (v - lo) / span;
      return [3 + (i / (values.length - 1)) * (w - 6), 4 + (invert ? n : 1 - n) * (h - 8)];
    });
    const line = smooth(pts);
    const [lx, ly] = pts[pts.length - 1];
    return `<svg class="sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${area ? `<path class="spark-area" d="${line}L${lx.toFixed(1)},${h}L${pts[0][0].toFixed(1)},${h}Z" fill="url(#g-fill)"/>` : ""}<path class="spark-line" pathLength="1" d="${line}"/><circle class="spark-dot" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.4"/></svg>`;
  }

  function delta(value, opts = {}) {
    if (value === null || value === undefined) return "";
    const better = value > 0;
    const cls = value === 0 ? "sec" : better ? "good" : "crit";
    const ic = value === 0 ? "" : value > 0 ? icon("arrow-up") : icon("arrow-down");
    const word = value === 0 || opts.noWord ? "" : ` ${t(better ? "better" : "worse")}`;
    const sign = value > 0 ? "+" : value < 0 ? "−" : "";
    return `<span class="${cls} d-pill">${ic}${sign}${num(Math.abs(value))}${opts.unit || ""}${word}</span>`;
  }

  const cnt = (n) => `<span class="countup" data-n="${n}">${num(n)}</span>`;
  // A headline number. Its definition, if it has one (shared-ui.js), is one hover or focus away on the (i) after the label.
  // With the simpler screens switch on, the number card draws it (UI.card, plan 3.2), so every UI.tile caller changes at once:
  // no icon square (the card's colour is on its graph), the delta line is the card's sub line, and .tile stays on as a hook.
  const tile = (label, fig, extra = "", { ic = "", tone = "", line = null, def = null } = {}) => (state.simple && window.UI?.card
    ? window.UI.card({ label, value: fig, sub: extra, spark: line, def, cls: "tile" })
    : `<div class="tile">
    <div class="tile-top"><div class="lab">${label}${def === false ? "" : window.UI?.defIcon?.(def || label) || ""}</div>${ic ? `<span class="ico ${tone}">${icon(ic)}</span>` : ""}</div>
    <div class="fig-row"><div class="fig">${fig}</div>${line ? `<div class="tile-spark">${spark(line, { w: 88, h: 34, area: true })}</div>` : ""}</div>
    <div class="delta">${extra}</div></div>`);

  // ---- motion helpers ------------------------------------------------------------
  // Numbers count up when a page opens. The final text is always the exact number.
  function countUps() {
    if (reduceMotion()) return;
    $$(".page-enter .countup").forEach((el, i) => {
      const end = Number(el.dataset.n);
      if (!end) return;
      const start = performance.now() + i * 40, dur = 850;
      const tick = (now) => {
        if (!el.isConnected) return;
        const p = Math.min(1, Math.max(0, (now - start) / dur));
        el.textContent = num(Math.round(end * (1 - (1 - p) ** 3)));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  // The highlight behind the current tab, view or menu item slides from where it last was.
  const inkMemo = new Map();
  function placeInks({ instant = false } = {}) {
    [[".tabs", '.tab[aria-selected="true"]'], [".seg", 'button[aria-pressed="true"]'], [".nav", '.nav-item[aria-current="page"]']].forEach(([boxSel, activeSel]) => {
      $$(boxSel).forEach((box) => {
        box.querySelector(":scope > .ink")?.remove();
        const active = $(activeSel, box);
        const key = boxSel + (box.getAttribute("aria-label") || "");
        if (!active) { inkMemo.delete(key); return; }
        const ink = document.createElement("span");
        ink.className = "ink"; ink.setAttribute("aria-hidden", "true");
        box.prepend(ink);
        const to = [active.offsetLeft, active.offsetTop, active.offsetWidth, active.offsetHeight];
        const put = ([x, y, w, h]) => { ink.style.transform = `translate(${x}px,${y}px)`; ink.style.width = `${w}px`; ink.style.height = `${h}px`; };
        const from = !instant && !reduceMotion() ? inkMemo.get(key) : null;
        put(from || to);
        if (from) { ink.getBoundingClientRect(); ink.classList.add("moving"); put(to); }
        inkMemo.set(key, to);
      });
    });
  }

  // A soft edge shows on the side of a table that has more to scroll to.
  function updateCues() {
    $$(".table-wrap").forEach((w) => {
      const max = w.scrollWidth - w.clientWidth;
      w.classList.toggle("more-left", max > 1 && w.scrollLeft > 1);
      w.classList.toggle("more-right", max > 1 && w.scrollLeft < max - 1);
      const tick = w.querySelector("#kw-table th:first-child");
      if (tick) w.style.setProperty("--kw-check-w", `${tick.offsetWidth}px`); // the keyword column sticks right after the tick box
    });
  }
  document.addEventListener("scroll", (e) => { if (e.target.classList?.contains("table-wrap")) updateCues(); }, true);
  // Anything marked up as tabs moves with the arrow keys, as a screen reader says it will.
  document.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) || !e.target.matches?.('[role="tab"]')) return;
    const tabs = [...e.target.closest('[role="tablist"]').querySelectorAll('[role="tab"]')].filter((tab) => tab === e.target || tab.getAttribute("aria-disabled") !== "true");
    const at = tabs.indexOf(e.target);
    const next = tabs[{ ArrowLeft: (at - 1 + tabs.length) % tabs.length, ArrowRight: (at + 1) % tabs.length, Home: 0, End: tabs.length - 1 }[e.key]];
    e.preventDefault();
    next.focus();
    next.click();
  });
  /* Roving tab stop: Tab reaches a tab list once, on its selected tab; the arrow keys (above) move between tabs. Kept up to date
     for every tab list on screen, whoever drew it, as tabs are drawn or selected. */
  function rovingTabs() {
    document.querySelectorAll('[role="tablist"]').forEach((list) => {
      const tabs = [...list.querySelectorAll('[role="tab"]')].filter((tab) => tab.closest('[role="tablist"]') === list);
      if (!tabs.length) return;
      const live = tabs.filter((tab) => tab.getAttribute("aria-disabled") !== "true");
      const on = live.find((tab) => tab.getAttribute("aria-selected") === "true") || live[0];
      tabs.forEach((tab) => { const want = tab === on ? 0 : -1; if (tab.tabIndex !== want) tab.tabIndex = want; });
    });
  }
  let rovingQueued = false;
  new MutationObserver(() => { if (rovingQueued) return; rovingQueued = true; queueMicrotask(() => { rovingQueued = false; rovingTabs(); }); })
    .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
  // A menu opened from something on the page would be left floating over the wrong place. The top bar and menu don't scroll away.
  $("#main")?.addEventListener("scroll", () => { if (popAnchor && !popAnchor.closest(".topbar, .sidebar")) closePopover(); }, { passive: true });

  // ---- Today ------------------------------------------------------------------
  function todayPage() {
    const head = topbar(t("Today"), esc(new Intl.DateTimeFormat(locale(), { weekday: "long", day: "numeric", month: "long" }).format(new Date())), "", false);
    return `${head}<div class="content page-enter">${setupCard()}${window.TodayView.page(sampleToday())}</div>`;
  }

  /* The sample as the same plain data the server gives Today. */
  function sampleToday() {
    const sample = window.TODAY_SAMPLE;
    const picked = state.site === "all" ? null : window.SITES.find((s) => s.id === state.site)?.host;
    const here = (item) => !picked || item.host === picked || item.my_host === picked;
    const sites = state.firstRun ? [] : window.SITES.filter(here);
    // Rounded along the running total, so the days add up to the number shown above them.
    const spread = (amount, seed) => {
      const shape = Array.from({ length: 28 }, (_, i) => 1 + 0.2 * Math.sin(i / 2.2 + seed) + 0.12 * Math.sin(i * 0.9 + seed * 2));
      const whole = shape.reduce((sum, v) => sum + v, 0);
      let running = 0, given = 0;
      return shape.map((v) => { running += (v / whole) * amount; const next = Math.round(running), day = next - given; given = next; return day; });
    };
    const dayBack = (back) => { const d = new Date(`${sample.through}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - back); return d.toISOString().slice(0, 10); };
    const total = (name, change, absolute) => {
      if (!sites.length) return { value: null, change: null, sites: 0, of: 0, points: [] };
      const value = sites.reduce((sum, s) => sum + s[name], 0);
      const was = sites.reduce((sum, s) => sum + (absolute ? s[name] - s[change] : s[name] / (1 + s[change] / 100)), 0);
      const seed = name.length, nowDays = spread(value, seed), wasDays = spread(Math.round(was), seed + 3);
      return { value, change: absolute ? value - Math.round(was) : Math.round(((value - was) / was) * 100), sites: sites.length, of: sites.length, points: nowDays.map((now, i) => ({ day: dayBack(27 - i), now, was: wasDays[i] })) };
    };
    const empty = state.firstRun;
    const todo = empty ? [] : [...visibleAttention()].sort((a, b) => (a.rank ?? 5) - (b.rank ?? 5)).map((a) => ({
      id: a.id, severity: a.sev, kind: a.key, title: t(a.title), detail: t(a.detail), host: a.host,
      seenAttr: `data-ack="${esc(a.id)}"`, mainHtml: `<button class="btn btn-small" data-act="${esc(a.key)}">${t(a.act)}</button>`, find: alertFind(a),
    }));
    return {
      results: { leads: { ...total("leads", "ld", true), state: empty ? "no_ga4" : "ok" }, visits: total("visits", "vd"), clicks: total("clicks", "cd"), through: empty ? null : sample.through, days: 28 },
      googleStopped: !empty && !state.seen.has("a1"), todo,
      goingDown: empty ? [] : sample.goingDown.filter(here), goingUp: empty ? [] : sample.goingUp.filter(here),
      rivals: empty ? [] : sample.rivals.filter(here).map((r) => ({ ...r, label: t(r.label), when: state.lang === "fr" ? `il y a ${r.when}` : `${r.when} ago` })),
      otherEdits: empty ? 0 : sample.otherEdits[picked || "all"] || 0,
      followUp: empty ? 0 : sample.followUp, renewals: empty ? 0 : sample.renewals,
      sources: empty ? { ok: 0, total: 0, connectAttr: 'data-act="fix"' } : sample.sources,
      sites: sites.map((s) => ({ host: s.host, pick: s.id, leads: s.leads, leads_change: s.ld, leads_state: "ok", visits: s.visits, visits_change: s.vd, clicks: s.clicks, clicks_change: s.cd, alerts: s.alerts, through: s.thru === "31 Oct" ? "2026-10-31" : sample.through, trend: spread(s.visits, s.host.length) })),
    };
  }

  // ---- What a task starts with, from each kind of finding -------------------------------
  // A task states the fact, so whoever opens it doesn't have to redo the investigation.
  const ALERT_LINKS = { fix: "#settings/google", clarity: "#settings/clarity", backlinks: "#backlinks", health: "#health/test", uptime: "#health/uptime" };
  const alertFind = (a) => ({ title: t(a.title), host: a.host || null, priority: a.sev === "crit" ? "high" : "medium", source: { type: "alert", label: t(a.title), host: a.host || undefined, facts: [t(a.detail)], link: ALERT_LINKS[a.key] || "#today", key: `alert|${a.id}` } });
  const changeFind = (ch) => ({ title: `${ch.who}: ${ch.count ? `${ch.count} ` : ""}${t(ch.kind)} ${ch.page}`, source: { type: "competitor", label: `${ch.who}: ${t(ch.kind)}`, facts: [ch.page, ch.when].filter(Boolean), link: "#competitors", key: `change|${ch.id}` } });
  const backlinkFind = (b) => {
    const from = b.src.replace(/^https?:\/\//, "");
    return { title: `${t("Backlink")}: ${from}`, host: b.site, source: { type: "backlink", label: from, host: b.site, facts: [b.target, b.status ? t(b.status) : ""].filter(Boolean), link: `#backlinks/${encodeURIComponent(b.id)}`, key: `backlink|${b.id}` } };
  };
  function keywordFind(row) {
    const e = engineOf(), res = row.res[e] || {}, change = row.chg[e], engine = ENGINES.find(([id]) => id === e)[1], p = res.p;
    // A move is only stated when both checks can be compared. After a tool change there's no number here, so only today's position is.
    const title = typeof change === "number" && change !== 0 && p
      ? `${row.k} ${t(change < 0 ? "fell" : "rose")} #${p + change} → #${p} ${t("on")} ${engine}`
      : p ? `${row.k} ${t("is at")} #${p} ${t("on")} ${engine}` : `${row.k}: ${t("not found on")} ${engine}`;
    const facts = [p ? `#${p} · ${res.tool || ""}${res.age !== undefined ? ` · ${res.age} ${t("d")}` : ""}` : "", row.page || ""].filter(Boolean);
    return { title, host: row.site || null, keywords: [row.k], pages: row.page ? [row.page] : [], source: { type: "keyword", label: `${row.k} · ${engine}`, host: row.site || undefined, facts, link: `#keywords/${encodeURIComponent(row.k)}`, key: `keyword|${row.k}|${e}` } };
  }

  // ---- Keywords ---------------------------------------------------------------
  const ENGINES = [["google", "Google"], ["duckduckgo", "DuckDuckGo"], ["bing", "Bing"], ["yandex", "Yandex"]];
  const OWN_TOOL = { google: "Search Console", bing: "Bing Webmaster", yandex: "Yandex Webmaster" };
  const SAME_ON_2 = new Set(["coût de la vie séville", "visa séville prix"]);
  const engineOf = () => (state.engine === "all" ? "google" : state.engine);

  const siteKeywords = () => { const host = window.UI?.siteHostPicked(); return window.KEYWORDS.filter((row) => !host || row.site === host); };
  function filtered() {
    const e = engineOf();
    const pass = (row) => {
      const r = row.res[e], c = row.chg[e];
      switch (state.filter) {
        case "top3": return r.p && r.p <= 3;
        case "top10": return r.p && r.p <= 10;
        case "up": return c > 0;
        case "down": return c < 0;
        case "none": return !r.p;
        case "cited": return row.ai === "cited";
        case "two": return SAME_ON_2.has(row.k);
        default: return true;
      }
    };
    const list = siteKeywords().filter(pass);
    const { key, dir } = state.sort;
    const val = (row) => ({ k: row.k, own: row.own[e], pos: row.res[e].p, chg: row.chg[e], vol: row.vol }[key]);
    const sign = dir === "ascending" ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * sign;
    });
  }

  // Every tool that has checked this keyword on this engine, newest first in the plan order.
  function resultsFor(row, e) {
    const main = row.res[e];
    const others = [...(e === "google" ? row.tools.filter((x) => x.age !== null && x.age !== undefined) : []), ...(main.also || [])];
    const seen = new Set([main.tool]);
    const out = [main];
    others.forEach((x) => { if (!seen.has(x.tool)) { seen.add(x.tool); out.push(x); } });
    return out.slice(0, 3);
  }

  function posBadge(x) {
    if (x.p) return `<span class="pos ${x.p <= 3 ? "pos-top3" : x.p <= 10 ? "pos-top10" : ""}">#${x.p}</span>`;
    const words = t("Not in top 10").replace("10", x.depth || 10);
    return `<span class="pos pos-none" role="img" data-tip="${esc(words)}" aria-label="${esc(words)}">&gt;${x.depth || 10}</span>`;
  }

  function scrapedCell(row, e) {
    const list = resultsFor(row, e);
    const found = list.filter((x) => x.p).map((x) => x.p);
    const disagree = found.length > 1 && Math.max(...found) - Math.min(...found) >= 3;
    const lines = list.map((x, i) => {
      const suspect = x.flag === "suspect" ? `<span class="warn" role="img" data-tip="${t("Suspect result")}" aria-label="${t("Suspect result")}">${icon("shield-question")}</span>` : "";
      const differs = disagree && i === 0 ? `<span class="warn" role="img" data-tip="${t("Tools disagree")}" aria-label="${t("Tools disagree")}">${icon("triangle-alert")}</span>` : "";
      return `<span class="res-line">${logo(x.tool, 16)}${posBadge(x)}${suspect}${differs}<span class="res-meta">${esc(t(x.tool))} · ${days(x.age)}</span></span>`;
    }).join("");
    const deeper = row.res[e].p ? "" : `<button class="link-btn" data-deeper="${esc(row.k)}">${t("Check deeper")}</button>`;
    return `<span class="res">${lines}${deeper}</span>`;
  }

  function changeCell(row, e) {
    const c = row.chg[e];
    if (c === null || c === undefined) {
      if ((row.tools.some((x) => x.flag === "tool-changed") && e === "google") || row.res[e].toolChanged) return `<span class="cellval"><span class="muted">—</span><span class="second" data-tip="${t("Different tools: can't compare.")}">${t("tool changed")}<span class="sr">: ${t("Different tools: can't compare.")}</span></span></span>`;
      return `<span class="muted dash">—</span>`;
    }
    if (c === 0) return `<span class="muted">0</span>`;
    return `<span class="chg ${c > 0 ? "good" : "crit"}" aria-label="${c > 0 ? t("Up") : t("Down")} ${Math.abs(c)}">${icon(c > 0 ? "arrow-up" : "arrow-down")}${Math.abs(c)}</span>`;
  }

  const aiCell = (row) => ({
    cited: `<span class="nowrap">${icon("sparkles")} ${t("Cited")}</span>`,
    overview: `<span class="sec small">${t("Not cited")}</span>`,
    none: `<span class="muted small">${t("No overview")}</span>`,
    "not-captured": `<span class="muted small">${t("Not captured")}</span>`,
  }[row.ai]);

  function keywordRow(row) {
    const e = engineOf();
    const selected = state.selected.has(row.k);
    const own = row.own[e];
    const trend = row.trend.length >= 2 ? spark(row.trend, { invert: true }) : `<span class="muted dash" role="img" data-tip="${t("Needs 2 checks, same tool")}" aria-label="${t("Needs 2 checks, same tool")}">—</span>`;
    const allEngines = state.engine === "all";
    const cells = allEngines
      ? ENGINES.map(([id, name]) => `<td data-label="${name}">${scrapedCell(row, id)}</td>`).join("")
      : `${e !== "duckduckgo" ? `<td class="c" data-label="${OWN_TOOL[e]} · ${t("avg position")}"><span class="tabular">${own === null ? '<span class="muted dash">—</span>' : dec(own)}</span></td>` : ""}
         <td data-label="${t("Our check")}">${scrapedCell(row, e)}</td>
         <td class="c" data-label="${t("Change")}">${changeCell(row, e)}</td>
         ${state.cols.vol ? `<td class="r" data-label="${t("Impressions (28 days)")}">${num(row.vol)}</td>` : ""}
         ${state.cols.trend ? `<td data-label="${t("Trend")}">${trend}</td>` : ""}
         ${state.cols.page ? `<td class="url-cell mono small" data-label="${t("Page")}" ${row.page ? `data-tip="${esc(row.page)}"` : ""}>${row.page ? PageLink.html(row.page, { host: row.site, title: "" }) : '<span class="muted dash">—</span>'}</td>` : ""}
         ${state.cols.ai ? `<td data-label="${t("AI")}">${aiCell(row)}</td>` : ""}`;
    return `<tr data-kw="${esc(row.k)}" class="${selected ? "sel" : ""}">
      <td class="chk-cell"><input type="checkbox" class="chk" data-select="${esc(row.k)}" ${selected ? "checked" : ""} aria-label="${t("selected")}: ${esc(row.k)}"></td>
      <td class="head-cell"><button class="kw" data-open-kw="${esc(row.k)}" dir="auto" style="text-align:start">${esc(row.k)}</button>${state.site === "all" && row.site ? `<span class="second mono" dir="auto">${esc(row.site)}</span>` : ""}</td>
      ${cells}</tr>`;
  }

  function sortHeader(key, label, align = "", sub = "") {
    const on = state.sort.key === key;
    return `<th scope="col" class="${align === true ? "r" : align}" ${on ? `aria-sort="${state.sort.dir}"` : ""}><button data-sort="${key}"><span>${esc(label)}${sub ? `<span class="th-sub">${esc(sub)}</span>` : ""}</span>${icon(on && state.sort.dir === "ascending" ? "arrow-up" : "arrow-down")}</button></th>`;
  }

  function keywordsTable() {
    const e = engineOf();
    const rows = filtered();
    if (!rows.length) return `<div class="table-wrap"><div class="empty"><h3>${t("No keyword matches")}</h3><p>${t("Try another filter.")}</p><button class="btn" data-filter="all">${t("Show all")}</button></div></div>`;
    const allEngines = state.engine === "all";
    const head = allEngines
      ? ENGINES.map(([id, name]) => `<th scope="col"><span class="th-engine">${logo(id, 16)}${name}</span></th>`).join("")
      : `${e !== "duckduckgo" ? sortHeader("own", OWN_TOOL[e], "c", t("avg position")) : ""}
         ${sortHeader("pos", t("Our check"))}${sortHeader("chg", t("Change"), "c")}
         ${state.cols.vol ? sortHeader("vol", t("Impressions"), true, t("28 days")) : ""}
         ${state.cols.trend ? `<th scope="col">${t("Trend")}</th>` : ""}${state.cols.page ? `<th scope="col">${t("Page")}</th>` : ""}${state.cols.ai ? `<th scope="col">${t("AI")}</th>` : ""}`;
    const allChecked = rows.every((r) => state.selected.has(r.k));
    return `<div class="table-wrap ${state.dense ? "dense" : ""}"><table class="data" id="kw-table">
      <thead><tr><th scope="col" class="chk-cell"><input type="checkbox" class="chk" id="select-all" ${allChecked ? "checked" : ""} aria-label="${t("All")}"></th>${sortHeader("k", t("Keyword"))}${head}</tr></thead>
      <tbody>${rows.map(keywordRow).join("")}</tbody></table></div>`;
  }

  function selectionBar() {
    if (!state.selected.size) return "";
    return `<div class="selbar" role="region" aria-label="${t("selected")}"><b>${state.selected.size} ${t("selected")}</b>
      <button class="btn btn-main btn-small" id="sel-refresh">${icon("refresh-cw")}${t("Refresh")}</button>
      <button class="btn btn-small" data-toast="Not built yet">${t("Add to group")}</button>
      <button class="btn btn-small" id="sel-task">${t("Create task")}</button>
      <button class="icon-btn" id="sel-clear" aria-label="${t("Clear selection")}" data-tip="${t("Clear selection")}">${icon("x")}</button></div>`;
  }

  function bucketView() {
    const e = engineOf();
    const pos = siteKeywords().map((k) => k.res[e].p);
    const buckets = [["1-3", pos.filter((p) => p && p <= 3).length], ["4-10", pos.filter((p) => p > 3 && p <= 10).length], ["11-20", pos.filter((p) => p > 10 && p <= 20).length], ["21+", pos.filter((p) => p > 20).length], [t("Not ranked"), pos.filter((p) => !p).length]];
    const max = Math.max(...buckets.map((b) => b[1]), 1);
    return `<section class="card" style="padding:16px">${buckets.map(([name, n]) => `
      <div style="display:grid;grid-template-columns:90px 1fr 30px;gap:10px;align-items:center;padding:6px 0;font-size:13px">
        <span class="sec">${name}</span>
        <span class="bucket-bar"><span style="width:${(n / max) * 100}%"></span></span>
        <span class="tabular" style="text-align:right;font-weight:600">${n}</span></div>`).join("")}</section>`;
  }

  function queriesView() {
    const rows = siteKeywords().filter((k) => k.own.google).map((k, i) => {
      const impressions = k.vol * (3 - (i % 3)) + 120, clicks = Math.round(impressions * (0.09 / (1 + i / 3)));
      return { k: k.k, clicks, impressions, rate: (clicks / impressions) * 100, pos: k.own.google };
    });
    return `<div class="table-wrap"><table class="data"><thead><tr><th scope="col">${t("Keyword")}</th><th scope="col" class="r">${t("Clicks")}</th><th scope="col" class="r">Impressions</th><th scope="col" class="r">${t("Click rate")}</th><th scope="col" class="r">${t("Position")}</th></tr></thead>
      <tbody>${rows.map((r) => `<tr style="cursor:default"><td class="head-cell kw" dir="auto">${esc(r.k)}</td><td class="r" data-label="${t("Clicks")}">${num(r.clicks)}</td><td class="r" data-label="Impressions">${num(r.impressions)}</td><td class="r" data-label="${t("Click rate")}">${dec(r.rate.toFixed(1))}%</td><td class="r" data-label="${t("Position")}">${dec(r.pos)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function keywordsPage() {
    const e = engineOf();
    const main = `<button class="btn ${state.selected.size ? "" : "btn-main"}" id="open-refresh">${icon("refresh-cw")}${t("Refresh")}</button>`;
    const sub = `${t("Data through")} 1 Nov · ${t("Refreshed")} ${days(state.lastRefresh)}`;
    if (state.firstRun) {
      return topbar(t("Keywords"), t("Rankings from engines' own tools and our own checks"), "") + `<div class="content page-enter"><div class="table-wrap"><div class="empty">
        <h3>${t("No keywords yet")}</h3><p>${t("Add keywords to follow, or import them from Search Console.")}</p>
        <button class="btn btn-main" data-toast="Not built yet">${t("Add keywords")}</button> <button class="btn" data-toast="Not built yet">${t("Import from Search Console")}</button></div></div></div>`;
    }
    const all = siteKeywords();
    if (!all.length) {
      return topbar(t("Keywords"), t("Rankings from engines' own tools and our own checks"), "") + `<div class="content page-enter"><div class="table-wrap"><div class="empty">
        <h3>${t("No keywords yet")}</h3><p>${t("Add the keywords to follow.")}</p>
        <button class="btn btn-main" data-setup="keywords">${t("Add keywords")}</button></div></div></div>`;
    }
    const ranked = all.filter((k) => k.res[e].p).length, top10 = all.filter((k) => k.res[e].p && k.res[e].p <= 10).length, cited = all.filter((k) => k.ai === "cited").length;
    const count = (f) => all.filter((k) => f(k)).length;
    const chips = [["all", "All", all.length], ["top3", "Top 3", count((k) => k.res[e].p && k.res[e].p <= 3)], ["top10", "Top 10", top10], ["up", "Up", count((k) => k.chg[e] > 0)], ["down", "Down", count((k) => k.chg[e] < 0)], ["none", "Not ranked", count((k) => !k.res[e].p)], ["cited", "Cited by AI", cited], ["two", "Two pages compete", SAME_ON_2.size]];
    const views = [["positions", "Positions"], ["bucket", "By bucket"], ["queries", "Queries"]];
    const body = state.view === "bucket" ? bucketView() : state.view === "queries" ? queriesView() : `
      <div class="chips" role="group" aria-label="${t("Keywords")}">
        ${chips.map(([id, label, n]) => `<button class="chip" data-filter="${id}" aria-pressed="${state.filter === id}">${t(label)}<b>${n}</b></button>`).join("")}
        <span style="margin-left:auto" class="table-tools">
          <button class="icon-btn" id="density" aria-label="${t(state.dense ? "Comfortable rows" : "Compact rows")}" data-tip="${t(state.dense ? "Comfortable rows" : "Compact rows")}">${icon("rows-3")}</button>
          <button class="icon-btn" id="columns" aria-label="${t("Columns")}" data-tip="${t("Columns")}">${icon("columns-3")}</button>
          <button class="icon-btn" data-toast="Sample export ready" aria-label="${t("Export CSV")}" data-tip="${t("Export CSV")}">${icon("download")}</button>
        </span>
      </div>
      ${e === "duckduckgo" ? `<p class="note">${UI.tip("DuckDuckGo has no tool for site owners, so the app checks its positions by itself every day, oldest first, on free searches only. Refresh and Refresh data check them now.").trim()}<span>${t("Checked daily by itself, on free searches.")}</span></p>` : ""}
      ${keywordsTable()}${selectionBar()}`;
    return topbar(t("Keywords"), sub, main) + `
      <div class="content page-enter">
        <section class="tiles" id="kw-tiles">
          ${tile(t("Tracked"), cnt(all.length), "", { ic: "key-round", line: [8, 9, 9, 10, 10, 11, 12, 12] })}
          ${tile(t("Ranked"), cnt(ranked), `<span class="ab">${t("of")} ${all.length}</span>`, { ic: "list-ordered", line: [6, 7, 7, 8, 8, 9, 9, 10] })}
          ${tile(`${t("Top 10")} <span class="muted">· ${t("our checks")}</span>`, cnt(top10), delta(-1) + `<span class="ab">${top10 + 1} → ${top10}</span>`, { ic: "target", line: [3, 3, 4, 5, 5, 6, 5, 4] })}
          ${tile(t("Cited by AI"), cnt(cited), `<span class="ab">${t("of")} ${all.length}</span>`, { ic: "sparkles", line: [1, 1, 2, 2, 3, 3, 4, 4] })}
        </section>
        <div class="tabs-row">
          <div class="tabs" role="tablist" aria-label="${t("Engines")}">
            ${[...ENGINES, ["all", t("All engines")]].map(([id, name]) => `<button class="tab" role="tab" data-engine="${id}" aria-selected="${state.engine === id}">${id === "all" ? "" : logo(id, 16)}${name}</button>`).join("")}
          </div>
          <span class="seg" role="group" aria-label="${t("Positions")}">${views.map(([id, name]) => `<button data-view="${id}" aria-pressed="${state.view === id}">${t(name)}</button>`).join("")}</span>
        </div>
        ${body}
      </div>`;
  }

  // ---- Backlinks --------------------------------------------------------------
  const LABELS = { utm: ["UTM", "exact number for this link"], exact: ["exact", "exact number for this link"], domain: ["domain", "matched by domain and landing page"], shared: ["shared", "several links share these visits"] };
  const siteLinks = () => window.BACKLINKS.filter((b) => state.site === "all" || b.site === window.SITES.find((s) => s.id === state.site).host);

  /* What each mode keeps: the real links when there's a server, the sample rows in memory when this is a plain file. Served over http, nothing shows until we know which. */
  const bl = { server: false, ready: !location.protocol.startsWith("http"), sites: [], error: "" };
  const linkSites = () => (bl.server ? bl.sites : window.SITES);
  const pickedSite = (prefill) => prefill || (state.site === "all" ? "" : siteName());
  const siteOptions = (selected) => linkSites().map((s) => `<option ${s.host === selected ? "selected" : ""}>${esc(s.host)}</option>`).join("");
  const utmOf = (source, medium, campaign) => (source || medium || campaign ? { source: source || "", medium: medium || "", campaign: campaign || "" } : null);
  const toBacklink = (row, host) => ({
    id: `srv${row.id}`, serverId: row.id, src: row.source_url, domain: row.domain, site: host, target: row.target_url, anchor: row.anchor, status: row.status, auth: row.authority ?? null, spam: row.spam_score ?? null, authLabel: row.authority_label || null,
    // Unknown until something measures them. Unknown isn't 0: that would make a paid link look worthless.
    visits: row.visits ?? null, leads: row.leads ?? null, label: row.traffic_label || "no-ga4", shared: row.shared ?? null, group: row.traffic_group || null, check: row.check || null,
    cost: row.cost ?? 0, priceText: row.price_text, mediator: row.mediator, owner: row.owner, placed: row.placed, utm: utmOf(row.utm_source, row.utm_medium, row.utm_campaign), before: null, after: null,
    pageAuthority: row.page_authority ?? null, rating: row.rating ?? null, articleUrl: row.article_url || null, sentAt: row.sent_at || null,
    linkType: row.link_type, due: row.due, renewal: row.renewal, contact: row.contact, platform: row.platform, notes: row.notes, createdAt: row.created_at,
    opr: row.opr ?? null, foundBy: row.found_by || null, gsc: row.gsc || null, disavow: Boolean(row.disavow), targetIndex: row.target_index || null,
    sourceIndex: row.source_index || null, anchorType: row.anchor_type || row.anchor_kind || null, siteTraffic: row.site_traffic ?? null,
    keyword: row.keyword || null, anchorKind: row.anchor_kind || null, anchorAuto: row.anchor_auto || null,
  });
  const localLink = (id, x, site, status) => ({
    id, src: x.src, domain: window.BacklinkCleaner.rootDomain(x.src), site, target: x.target || null, anchor: x.anchor || null, status, auth: null, visits: 0, leads: 0, label: "none",
    cost: window.BulkLinks.parsePrice(x.cost) ?? 0, priceText: x.cost || null, mediator: x.mediator || null, owner: x.owner || null, placed: x.placed || null, utm: utmOf(x.utm_source, x.utm_medium, x.utm_campaign), before: null, after: null,
    linkType: x.link_type || null, due: x.due || null, renewal: x.renewal || null, contact: x.contact || null, platform: x.platform || null, notes: x.notes || null, createdAt: new Date().toISOString(),
    keyword: x.keyword || null, anchorKind: x.anchor_kind || null, anchorType: x.anchor_kind || null,
  });
  const serverRow = (x, site, status) => ({
    site_id: bl.sites.find((s) => s.host === site)?.id, source_url: x.src, status, target_url: x.target || null, anchor: x.anchor || null, link_type: x.link_type || null, placed: x.placed || null, due: x.due || null, renewal: x.renewal || null,
    price_text: x.cost || null, mediator: x.mediator || null, contact: x.contact || null, platform: x.platform || null, utm_source: x.utm_source || null, utm_medium: x.utm_medium || null, utm_campaign: x.utm_campaign || null, owner: x.owner || null, notes: x.notes || null,
    keyword: x.keyword || null, anchor_kind: x.anchor_kind || null,
  });

  /* Saves one link or many, where this mode keeps them. `items` are { record, site, status }. A refusal rejects with the server's sentence. */
  async function keepLinks(items) {
    if (!bl.server) {
      if (items.length > window.BulkLinks.MAX_ROWS) throw new Error("At most 5,000 rows per upload. Split the file and try again.");
      return { added: items.map((x, i) => localLink(`bulk${Date.now()}${i}`, x.record, x.site, x.status)), skipped: [], prospects: [] };
    }
    const answer = await COMP.api("POST", "backlinks/bulk", { rows: items.map((x) => serverRow(x.record, x.site, x.status)) });
    return { added: answer.saved.map((row) => toBacklink(row, bl.sites.find((s) => s.id === row.site_id)?.host)), skipped: answer.skipped, prospects: answer.prospects_removed };
  }

  /* Undo. On the server a few at a time, so a long list can't swamp it. A row that can't be removed stays on screen. */
  async function removeLinks(list) {
    const gone = new Set(list), left = list.filter((b) => b.serverId), stuck = [];
    window.BACKLINKS = window.BACKLINKS.filter((b) => !gone.has(b));
    await Promise.all(Array.from({ length: 5 }, async () => {
      while (left.length) {
        const b = left.shift();
        try { await COMP.api("DELETE", `backlinks/${b.serverId}`); } catch (err) { if (err.status !== 404) stuck.push(b); }
      }
    }));
    if (stuck.length) window.BACKLINKS.unshift(...stuck);
    backlinksChanged();
    return stuck;
  }
  const backlinksChanged = () => window.dispatchEvent(new CustomEvent("seocc:backlinks-changed"));

  const colon = () => (state.lang === "fr" ? " : " : ": ");
  const countWords = (n, one, many) => (n === 1 ? t(one) : `${num(n)} ${t(many)}`);

  /* A refusal in the server's own words, in the language on screen. A row's address comes first, and stays as it is. */
  const serverSays = (message) => {
    const row = String(message).match(/^(.+?): ([^:]+)$/s);
    return row ? `${row[1]}${colon()}${t(row[2])}` : t(String(message));
  };

  /* Prospects the server removed because their domain now has a link. They leave the screen too, and undo can bring them back. */
  const takeProspects = (ids) => {
    const gone = window.PROSPECTS.filter((p) => ids.includes(p.serverId));
    if (gone.length) window.PROSPECTS = window.PROSPECTS.filter((p) => !gone.includes(p));
    return gone;
  };
  const putBackProspect = (p) => {
    window.PROSPECTS.unshift(p);
    window.dispatchEvent(new CustomEvent("seocc:prospect-restored", { detail: p }));
  };

  function noteRealSites(sites) {
    bl.sites = sites;
    // So the site picker can show a real site's links too.
    // With realId, as boot.js's own sites have it: Settings, Refresh data and every screen ask the server by that id.
    // Without it, a site added on this page was saved as sites/undefined (a 405) until a reload.
    sites.forEach((s) => {
      const known = window.SITES.find((x) => x.host === s.host);
      if (!known) window.SITES.push({ id: `real-${s.id}`, realId: s.id, host: s.host, visits: 0, vd: 0, clicks: 0, cd: 0, alerts: 0, thru: "—", added: true });
      else if (!known.realId) known.realId = s.id;
    });
    // A tick still being saved wins over a list read before it was sent.
    sites.forEach((s) => { const kept = setupPending && Array.isArray(setupFacts[s.host]?.notUsed); setupFacts[s.host] = { ...setupFacts[s.host], siteId: s.id, notUsed: kept ? setupFacts[s.host].notUsed : s.setup_not_used || [] }; });
    // An address that named this site was waiting for it.
    if (wantedSite && window.SITES.some((x) => x.host === wantedSite)) { applySite(wantedSite); render(); }
  }

  /* With a server the sample rows go, whatever happens: a link that isn't really there must never be counted. */
  /* At start only the site list is read. Each site's links are read when Backlinks opens, not on every load (F17), and the old
     rows stay on screen until the new ones are in, so a redraw in between never shows 0 links. */
  async function loadRealSites() {
    if (!(await COMP.isServer())) return;
    bl.server = true;
    try { noteRealSites((await COMP.api("GET", "links/sites")).sites); } catch { /* Backlinks asks again when it opens */ }
  }
  async function loadRealBacklinks() {
    if (!(await COMP.isServer())) { if (!bl.ready) { bl.ready = true; if (state.route === "backlinks") render(); } return; }
    bl.server = true;
    bl.asked = true;
    if (!bl.ready) { window.BACKLINKS = []; window.FOUND_LINKS = []; }
    bl.error = "";
    try {
      noteRealSites((await COMP.api("GET", "links/sites")).sites);
      const lists = await Promise.all(bl.sites.map(async (site) => {
        const answer = await COMP.api("GET", `backlinks?site_id=${site.id}`);
        window.BacklinkSeo.noteSite(site.host, answer.site); // its language and whether Google can be asked if its pages are indexed
        return answer.backlinks.map((row) => toBacklink(row, site.host));
      }));
      const rows = lists.flat().sort((a, b) => b.serverId - a.serverId);
      window.BACKLINKS = rows.filter((b) => b.status !== "found" && b.status !== "ignored");
      window.FOUND_LINKS = rows.filter((b) => b.status === "found" || b.status === "ignored").map((b) => ({ src: b.src, target: b.target || "", seen: b.foundBy || "—", first: (b.createdAt || "").slice(0, 10), crawled: b.gsc?.crawled || null, auth: null, serverId: b.serverId, ignored: b.status === "ignored", site: b.site, disavow: b.disavow }));
    } catch (err) { bl.error = err.message; }
    bl.ready = true;
    if (state.route === "backlinks") render();
  }
  const backlinksWanted = () => { if (!bl.asked && state.served !== false) loadRealBacklinks(); };

  /* What was spent, per currency: adding AED to euros would make a number that means nothing. A price with no currency stays a bare number. */
  const inCurrency = (currency, n) => (currency === "USD" ? `$${n}` : currency === "EUR" ? `${n} €` : currency === "GBP" ? `£${n}` : currency ? `${currency} ${n}` : n);
  const currencyOfLink = (b) => (b.priceText ? window.BulkLinks.currencyOf(b.priceText) : "USD");
  // Only when it means something: one currency, and visits that were actually measured.
  function mediatorCost(list) {
    const visits = window.BacklinkSeo.trafficTotals(list).visits, spent = list.filter((b) => b.cost);
    const currencies = new Set(spent.map(currencyOfLink));
    if (!visits || !spent.length || currencies.size !== 1) return '<span class="muted">—</span>';
    return inCurrency([...currencies][0], dec((spent.reduce((s, b) => s + b.cost, 0) / visits).toFixed(2)));
  }
  function spentWords(list) {
    const sums = new Map();
    list.forEach((b) => { if (b.cost && b.status !== "planned") sums.set(currencyOfLink(b), (sums.get(currencyOfLink(b)) || 0) + b.cost); });
    return [...sums].map(([currency, n]) => inCurrency(currency, num(n))).join(" + ") || "—";
  }

  /* New in the period on screen, by the day it was placed, or else the day it was logged. Presets end when the data ends, but a link logged today is still new. */
  function isNewLink(b) {
    const { from, to } = periodWindow();
    const day = /^\d{4}-\d{2}-\d{2}/.test(b.placed || "") ? b.placed.slice(0, 10) : (b.createdAt || "").slice(0, 10);
    return b.status !== "lost" && Boolean(day) && day >= from && day <= (state.rng.preset === "custom" ? to : iso(new Date()));
  }

  function linkStatus(s) {
    if (s === "live") return status("good", t("Live "));
    if (s === "lost") return status("serious", t("Lost "));
    if (s === "planned") return status("planned", t("Planned"));
    return status("warn", t("Nofollow"));
  }

  function trafficCell(b) {
    if (b.label === "no-ga4") return `<span class="muted small" role="img" data-tip="${t("GA4 not connected")}" aria-label="${t("GA4 not connected")}">—</span>`;
    if (b.label === "none" || !b.visits) return `<span class="tabular muted" data-tip="${t("No visits yet. Links hiding their source count as Direct.")}">0<span class="sr">: ${t("No visits yet. Links hiding their source count as Direct.")}</span></span>`;
    const [name, why] = LABELS[b.label];
    const shown = b.label === "shared" ? `${name} · ${b.shared}` : name;
    return `<span class="cellval"><span class="tabular">${num(b.visits)}</span> <span class="tag" data-tip="${esc(t(why))}">${shown}<span class="sr">: ${esc(t(why))}</span></span></span>`;
  }

  // ---- In consideration: links we might pursue. Not built yet, so no status, visits, leads or cost ----
  const PROSPECT_NOTE = "Prospects only: filters a CSV and adds the links you keep to In consideration. No rankings or link tracking.";
  const DUP_WORDS = { todo: "Already in To do", done: "Already in Done", consideration: "Already in consideration", found: "In Links you didn't add", file: "Twice in this file" };
  const prospectsForSite = () => window.PROSPECTS.filter((p) => state.site === "all" || p.site === siteName());
  const dupFlag = (where) => (where ? `<span class="dup-flag">${icon("copy")}${esc(t(DUP_WORDS[where]))}</span>` : `<span class="muted">—</span>`);
  const spamText = (spam) => (spam === null ? `<span class="muted">${t("unknown")}</span>` : `<span class="tabular">${dec(spam)}</span>`);

  // Where each domain already is, for one site. Only reads: nothing is recorded until the user confirms.
  function knownDomains(host, skipProspects = false) {
    const known = new Map();
    const note = (url, where) => { const d = window.BacklinkCleaner.rootDomain(url); if (d && !known.has(d)) known.set(d, where); };
    if (!state.firstRun) window.BACKLINKS.filter((b) => b.site === host).forEach((b) => note(b.src, b.status === "planned" ? "todo" : "done"));
    if (!skipProspects) window.PROSPECTS.filter((p) => p.site === host).forEach((p) => note(p.url, "consideration"));
    if (!state.firstRun) window.FOUND_LINKS.forEach((f) => note(f.src, "found"));
    return known;
  }

  /* The list's filters. A row with no value doesn't match a number filter while it's on: unknown isn't the same as good. */
  const noProspectFilter = () => ({ stage: "", rating: "", da: "", spam: "", pa: "", owner: "", file: "" });
  let prFilter = noProspectFilter(), prMoreOpen = false;
  const prPicked = new Set(); // ticked to move to To do. What a filter hides stops being ticked, so what moves is what's on show.
  const isKnown = (value) => value !== null && value !== undefined;
  const atLeast = (value, min) => min === "" || (isKnown(value) && value >= Number(min));
  const atMost = (value, max) => max === "" || (isKnown(value) && value <= Number(max));
  const prospectMatches = (p) => (!prFilter.stage || (p.stage || "new") === prFilter.stage)
    && (!prFilter.rating || (prFilter.rating === "none" ? !p.rating : p.rating === Number(prFilter.rating)))
    && atLeast(p.authority, prFilter.da) && atLeast(p.pageAuthority, prFilter.pa) && atMost(p.spam, prFilter.spam)
    && (!prFilter.owner || (prFilter.owner === "none" ? !p.owner : p.owner === prFilter.owner))
    && (!prFilter.file || p.file === prFilter.file);
  const PROSPECT_STAGES = [["new", "Not contacted"], ["contacted", "Contacted"], ["agreed", "Agreed"], ["refused", "Refused"]];
  const ratingOptions = (chosen, blank) => [["", blank], ...[5, 4, 3, 2, 1].map((n) => [String(n), String(n)])].map(([value, word]) => `<option value="${value}" ${String(chosen ?? "") === value ? "selected" : ""}>${esc(word)}</option>`).join("");
  const numberOrDash = (value) => (isKnown(value) ? `<span class="tabular">${value}</span>` : '<span class="muted">—</span>');

  function prospectRows(list) {
    // Worked out once per page, so a long list stays quick.
    const elsewhere = new Map(), counts = new Map();
    window.PROSPECTS.forEach((p) => {
      const key = `${p.site}|${p.domain}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!elsewhere.has(p.site)) elsewhere.set(p.site, knownDomains(p.site, true));
    });
    return list.map((p) => { // the rows of the page on show (table-pages.js)
      const where = elsewhere.get(p.site).get(p.domain) || (counts.get(`${p.site}|${p.domain}`) > 1 ? "consideration" : null);
      const notes = [p.file ? `<span class="second" data-tip="${esc(p.file)}" dir="auto">${esc(p.file)}</span>` : "", state.site === "all" ? `<span class="second">${t("for")} ${esc(p.site)}</span>` : "", where ? `<span class="second">${dupFlag(where)}</span>` : ""].join("");
      return `<tr id="prospect-${p.id}" style="cursor:default">
        <td class="pr-tick" data-label=""><input type="checkbox" class="chk" style="margin:0" data-prospect-pick="${p.id}" aria-label="${t("Select")}: ${esc(p.domain)}" ${prPicked.has(p.id) ? "checked" : ""}></td>
        <td class="head-cell url-cell"><span class="with-logo">${siteLogo(p.domain)}<span class="logo-text"><span class="nb-inline"><a class="kw mono small" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer nofollow" data-tip="${esc(p.url)}">${esc(p.url.replace(/^https?:\/\//, ""))}</a>${window.COMP?.notes?.badge ? window.COMP.notes.badge({ scope: "domain", domain: p.domain, siteId: window.UI.siteIdPicked?.() ?? null }, p.domain) : ""}</span>${notes}</span></span></td>
        <td class="r" data-label="${t("Authority")}" ${p.authorityLabel ? `data-tip="${esc(p.authorityLabel)}"` : ""}>${numberOrDash(p.authority)}</td>
        <td class="r" data-label="${t("Page authority")}">${numberOrDash(p.pageAuthority)}</td>
        <td class="r" data-label="${t("Spam score")}">${spamText(p.spam)}</td>
        <td data-label="${t("Rating")}"><select class="select pr-rating" data-prospect-rating="${p.id}" aria-label="${t("Rating")}: ${esc(p.domain)}">${ratingOptions(p.rating, "—")}</select></td>
        <td data-label="${t("Status and owner")}"><span class="prospect-track"><select class="select" data-prospect-stage="${p.id}" aria-label="${t("Status")}: ${esc(p.domain)}">${PROSPECT_STAGES.map(([id, word]) => `<option value="${id}" ${(p.stage || "new") === id ? "selected" : ""}>${t(word)}</option>`).join("")}</select><input class="input" data-prospect-owner="${p.id}" value="${esc(p.owner || "")}" placeholder="${t("Owner")}" aria-label="${t("Owner")}: ${esc(p.domain)}" dir="auto"></span></td>
        <td class="r nowrap" data-label=""><button class="btn btn-small" data-prospect-done="${p.id}">${t("Link placed")}</button> <button class="icon-btn" style="width:28px;height:28px;vertical-align:middle" data-prospect-remove="${p.id}" aria-label="${t("Remove")}: ${esc(p.domain)}" data-tip="${t("Remove")}">${icon("trash-2")}</button></td>
      </tr>`;
    }).join("") || `<tr style="cursor:default"><td colspan="8"><div class="empty"><h3>${t("No links match these filters")}</h3><p>${t("Change or clear them to see more.")}</p></div></td></tr>`;
  }

  function paintProspectPicks(list = window.TP.view(PR_PAGES, prospectList()).rows) {
    const n = prPicked.size, all = $("#pr-all"), bar = $("#pr-pick-bar");
    if (all) { all.checked = n > 0 && n === list.length; all.indeterminate = n > 0 && n < list.length; }
    if (!bar) return;
    bar.hidden = !n;
    $("#pr-pick-count").textContent = `${num(n)} ${t("selected")}`;
  }

  /* Only the rows and the count change, so someone typing in a filter keeps their place. */
  function paintProspects() {
    const all = prospectsForSite(), list = prospectList(), page = window.TP.view(PR_PAGES, list);
    const shown = new Set(page.rows.map((p) => p.id)); // only rows on this page stay ticked, so what moves is what's on show
    [...prPicked].forEach((id) => { if (!shown.has(id)) prPicked.delete(id); });
    setRows($("#pr-table tbody"), prospectRows(page.rows));
    paintProspectPicks(page.rows);
    setHTML($("#pr-count"), `${num(list.length)} ${t("of")} ${num(all.length)}`);
    const foot = $(`[data-tp-foot="${PR_PAGES}"]`), footHtml = window.TP.footer(PR_PAGES, page, { noun: t("links") });
    if (foot) foot.replaceWith(fragment(footHtml)); else if (footHtml) $("#pr-table")?.closest(".table-wrap")?.after(fragment(footHtml));
    // The search box gains or loses its clear button; table-pages.js puts the cursor back in it.
    const box = $(`[data-tp-search][data-tp-key="${PR_PAGES}"]`)?.closest(".tp-search");
    if (box && Boolean(box.querySelector("[data-tp-clear]")) !== Boolean(window.TP.state(PR_PAGES).q)) box.replaceWith(fragment(window.TP.search(PR_PAGES, t("Search websites"))));
    const hiddenOn = ["pa", "owner", "file"].filter((key) => prFilter[key]).length;
    $("#pr-more-toggle").textContent = `${t("More filters")}${hiddenOn ? ` (${hiddenOn})` : ""}`;
    $("#pr-clear").hidden = !Object.values(prFilter).some(Boolean) && !window.TP.state(PR_PAGES).q;
  }

  function considerationBody() {
    const all = prospectsForSite(), list = prospectList(), page = window.TP.view(PR_PAGES, list), filtered = Object.values(prFilter).some(Boolean) || window.TP.state(PR_PAGES).q;
    const head = (id, label, tip) => window.BacklinkSeo.sortHead("data-pr-sort", prSort, id, label, id === "domain" ? "" : "r", tip);
    const distinct = (pick) => [...new Set(all.map(pick).filter(Boolean))].sort((x, y) => x.localeCompare(y));
    const owners = distinct((p) => p.owner), files = distinct((p) => p.file);
    const choose = (key, label, options) => `<label class="field"><span>${t(label)}</span><select class="select" data-pr-filter="${key}">${options.map(([value, word]) => `<option value="${esc(value)}" ${prFilter[key] === value ? "selected" : ""}>${esc(word)}</option>`).join("")}</select></label>`;
    const number = (key, label) => `<label class="field"><span>${t(label)}</span><input class="input tabular" type="number" min="0" inputmode="numeric" data-pr-filter="${key}" value="${esc(prFilter[key])}"></label>`;
    const hiddenOn = ["pa", "owner", "file"].filter((key) => prFilter[key]).length;
    return `<section class="tool-band" aria-label="${t("Filter a backlink CSV")}">
        <button class="btn btn-main" id="cleaner-open">${icon("filter")}${t("Filter a backlink CSV")}</button>
        <p>${t(PROSPECT_NOTE)}</p>
      </section>
      ${all.length ? `<section class="tool-band pr-filters" aria-label="${t("Filter the list")}">
          ${window.TP.search(PR_PAGES, t("Search websites"))}
          ${choose("stage", "Status", [["", t("Any")], ...PROSPECT_STAGES.map(([id, word]) => [id, t(word)])])}
          ${choose("rating", "Rating", [["", t("Any")], ...[5, 4, 3, 2, 1].map((n) => [String(n), String(n)]), ["none", t("Not rated")]])}
          ${number("da", "Authority at least")}
          ${number("spam", "Spam at most")}
          <button type="button" class="link-btn" id="pr-more-toggle" aria-expanded="${prMoreOpen}" aria-controls="pr-more">${t("More filters")}${hiddenOn ? ` (${hiddenOn})` : ""}</button>
          <span class="pr-end"><span class="small sec tabular" id="pr-count" role="status">${num(list.length)} ${t("of")} ${num(all.length)}</span><button type="button" class="link-btn" id="pr-clear" ${filtered ? "" : "hidden"}>${t("Clear filters")}</button></span>
          <div class="pr-more" id="pr-more" ${prMoreOpen ? "" : "hidden"}>
            ${number("pa", "Page authority at least")}
            ${choose("owner", "Owner", [["", t("Any")], ...owners.map((name) => [name, name]), ["none", t("No owner")]])}
            ${choose("file", "File", [["", t("Any")], ...files.map((name) => [name, name])])}
          </div>
        </section>
        <div class="pr-pick-bar" id="pr-pick-bar" role="status" ${[...prPicked].some((id) => page.rows.some((p) => p.id === id)) ? "" : "hidden"}><b id="pr-pick-count" class="tabular">${num(prPicked.size)} ${t("selected")}</b><button class="btn btn-main btn-small" id="pr-move">${icon("arrow-right")}${t("Move to To do")}</button><button type="button" class="link-btn" id="pr-pick-clear">${t("Clear")}</button></div>
        <div class="bl-list"><div class="table-wrap"><table class="data" id="pr-table">
        <thead><tr><th scope="col" class="pr-tick"><input type="checkbox" class="chk" style="margin:0" id="pr-all" aria-label="${t("Select all shown")}" ${prPicked.size && prPicked.size === page.rows.length ? "checked" : ""}></th>${head("domain", "Website")}${head("da", "DA", t("Domain authority: the site's score in the file, from any tool."))}${head("pa", "PA", t("Page authority: this page's score from the file."))}${head("spam", "Spam score")}<th scope="col">${t("Rating")}</th><th scope="col">${t("Status and owner")}</th><th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead>
        <tbody>${prospectRows(page.rows)}</tbody></table></div>
        ${window.TP.footer(PR_PAGES, page, { noun: t("links") })}</div>
        <p class="help" style="margin-top:10px">${t("Prospects aren't counted in the cards above.")}</p>`
      : `<div class="table-wrap"><div class="empty"><h3>${t("Nothing in consideration yet")}</h3><p>${t("Filter a backlink CSV, then pick links to pursue.")}</p></div></div>`}`;
  }

  // Found links of the site picked in the menu (all of them at All sites: F114).
  const foundHere = () => window.FOUND_LINKS.filter((f) => state.site === "all" || !f.site || f.site === siteName());
  const lostThisWeek = (links) => links.filter((b) => b.status === "lost" && b.check?.lost_at && Date.now() - new Date(b.check.lost_at) < 7 * 864e5).length;

  /* The Backlinks tables' pages, search and sorted headings (table-pages.js), like every long table in the app (2026-11-10).
     By site and Reclaim keep theirs in backlinks-seo.js, To do in links-todo.js, Mediators in link-extras.js. */
  const BL_PAGES = "bl-links", FOUND_PAGES = "bl-found", PR_PAGES = "bl-prospects";
  let blSort = null, foundSort = null, prSort = null, blPagedFor;
  const bareUrl = (url) => String(url || "").replace(/^https?:\/\/(www\.)?/, "");
  const BL_SORTS = { src: (b) => bareUrl(b.src), authority: (b) => b.auth || b.opr, visits: (b) => b.visits, leads: (b) => b.leads };
  const blSearched = (list) => list.filter((b) => window.TP.matches(BL_PAGES, b.src, b.anchor, b.check?.anchor, b.target, b.keyword, b.mediator, b.site));
  const foundSearched = (list) => list.filter(([f]) => window.TP.matches(FOUND_PAGES, f.src, f.target, f.site));
  const prSearched = (list) => list.filter((p) => window.TP.matches(PR_PAGES, p.url, p.domain, p.file, p.owner));
  const PR_SORTS = { domain: (p) => bareUrl(p.url), da: (p) => p.authority, pa: (p) => p.pageAuthority, spam: (p) => p.spam };
  /* In consideration as filtered, searched and sorted: what the table pages through, and what Export takes. */
  const prospectList = () => window.BacklinkSeo.sortRows(prSearched(prospectsForSite().filter(prospectMatches)), prSort, PR_SORTS);
  /* Another site picked in the side menu starts every Backlinks table again at page 1, unsorted, with no search. */
  function resetBacklinkPages() {
    [BL_PAGES, FOUND_PAGES, PR_PAGES, "bl-todo", "bl-mediators"].forEach((key) => { window.TP.state(key).q = ""; window.TP.reset(key); });
    blSort = null; foundSort = null; prSort = null;
    window.BacklinkSeo.resetPages();
  }
  [["Search websites", "Rechercher un site"], ["No link matches", "Aucun lien ne correspond"], ["Change the search.", "Modifiez la recherche."],
    ["Search links", "Rechercher un lien"], ["link checks", "contrôles de liens"], ["No link matches.", "Aucun lien ne correspond."]]
    .forEach(([en, fr]) => { if (window.FR[en] === undefined) window.FR[en] = fr; });
  window.TP.on(BL_PAGES, () => render());
  window.TP.on(FOUND_PAGES, () => render());
  window.TP.on(PR_PAGES, () => ($("#pr-table") ? paintProspects() : render())); // only the rows and the footer, so the filters keep their place

  function backlinksPage() {
    const section = state.blSection;
    if (blPagedFor !== state.site) { if (blPagedFor !== undefined) resetBacklinkPages(); blPagedFor = state.site; }
    const main = section === "done" ? `<button class="btn btn-main" id="add-backlink">${icon("plus")}${t("Add backlink")}</button>` : "";
    const title = t("Backlinks"), sub = t("Links built and what they brought");
    if (!bl.ready) return topbar(title, sub) + `<div class="content page-enter">${window.UI.skeleton("page", { tiles: 6, chart: false })}</div>`;
    if (bl.error) return topbar(title, sub) + `<div class="content page-enter">${window.UI.failCard(bl.error, { onRetry: () => { bl.error = ""; bl.ready = false; bl.asked = false; render(); } })}</div>`;
    const sections = `<div class="tabs sections" role="tablist" aria-label="${t("Backlink sections")}">
      <button class="tab" role="tab" data-bl-section="consideration" aria-selected="${section === "consideration"}">${icon("filter")}${t("In consideration")} <span class="muted">${prospectsForSite().length}</span></button>
      <button class="tab" role="tab" data-bl-section="todo" aria-selected="${section === "todo"}">${icon("clock")}${t("To do")} <span class="muted">${state.firstRun ? 0 : window.LinkTodo.count()}</span></button>
      <button class="tab" role="tab" data-bl-section="done" aria-selected="${section === "done"}">${icon("circle-check")}${t("Done")} <span class="muted">${state.firstRun ? 0 : siteLinks().filter((b) => b.status !== "planned").length}</span></button>
    </div>`;
    if (state.firstRun) {
      return topbar(title, sub, main) + `<div class="content page-enter">${sections}${section === "consideration" ? considerationBody() : section === "todo" ? window.LinkTodo.body() : `<div class="table-wrap"><div class="empty"><h3>${t("No backlinks yet")}</h3><p>${t("Log your links, or import a CSV.")}${window.UI.tip("A Google Sheet can be exported as CSV.")}</p><span class="bl-tools"><button class="btn" id="bulk-open">${icon("list-plus")}${t("Import CSV")}</button><button class="btn" id="gsc-open">${icon("search")}${t("Import from Search Console")}</button></span></div></div>`}</div>`;
    }
    const all = siteLinks().filter((b) => b.status !== "planned"); // not built yet, so it's in To do and never counts in the cards
    const real = all;
    const lost = real.filter((b) => b.status === "lost").length;
    const live = real.length - lost;
    const planned = all.length - real.length;
    // Links that share one GA4 number count it once (3 links sharing 40 visits are 40, not 120: F10).
    const sum = window.BacklinkSeo.trafficTotals(all), visits = sum.visits, leads = sum.leads, visitsKnown = sum.known;
    const tabs = [["all", "All backlinks", all.length], ["mediators", "Mediators", window.LinkExtras.count(all)], ["found", "Links you didn't add", foundHere().filter((f) => !f.ignored).length]];
    const reclaimN = window.BacklinkSeo.reclaimCount(); // a tab only when there's something to reclaim
    if (reclaimN || state.blTab === "reclaim") tabs.push(["reclaim", "Reclaim", reclaimN]);
    let body = "";
    if (state.blTab === "all") {
      const byPerson = state.blMediator ? all.filter((b) => b.mediator === state.blMediator) : all;
      const rows = window.BacklinkSeo.filterRows(byPerson, state.blFilter); // lost, useful, sends visits, not indexed, not useful, one website
      const page = window.TP.view(BL_PAGES, window.BacklinkSeo.sortRows(blSearched(rows), blSort, BL_SORTS));
      const head = (id, label, cls) => window.BacklinkSeo.sortHead("data-bl-sort", blSort, id, label, cls);
      body = !all.length ? `<div class="table-wrap"><div class="empty"><h3>${t("No backlinks yet")}</h3><p>${t("Log your links, or import a CSV.")}${window.UI.tip("A Google Sheet can be exported as CSV.")}</p><span class="bl-tools"><button class="btn" id="bulk-open">${icon("list-plus")}${t("Import CSV")}</button><button class="btn" id="gsc-open">${icon("search")}${t("Import from Search Console")}</button></span></div></div>` : `<div class="chips">${window.BacklinkSeo.searchBox()}<button class="chip" data-bl-filter="all" aria-pressed="${state.blFilter === "all"}">${t("All")}<b>${all.length}</b></button>
        ${state.blMediator ? `<button class="chip" data-bl-mediator="" aria-pressed="true">${t("Mediator")}: <span dir="auto">${esc(state.blMediator)}</span> ${icon("x")}</button>` : ""}
        ${window.BacklinkSeo.filterChips(byPerson, state.blFilter)}
        <span style="margin-left:auto" class="bl-tools">${window.BacklinkSeo.viewSwitch()}<button class="btn btn-small" id="gsc-open">${icon("search")}${t("Import from Search Console")}</button><button class="btn btn-small" id="bulk-open">${icon("list-plus")}${t("Import CSV")}</button></span></div>
      <h2 class="sr">${t("Links")}</h2>${window.BacklinkSeo.byWebsite() ? window.BacklinkSeo.websiteTable(rows) : `<div class="bl-list"><div class="table-wrap"><table class="data" id="bl-table">
        <thead><tr>${head("src", "Source page")}<th scope="col">${t("Target")}</th><th scope="col">${t("Keyword")}</th><th scope="col">${t("Anchor type")}</th><th scope="col">${t("Status")}</th>${head("authority", "Authority", "r")}${window.BacklinkSeo.trafficHead()}${head("visits", "Visits", "r")}${head("leads", "Leads", "r")}<th scope="col" class="r">${t("Cost per visit")}</th><th scope="col">${t("Mediator")}</th></tr></thead>
        <tbody>${page.rows.length ? "" : `<tr style="cursor:default"><td colspan="12"><div class="empty"><h3>${t("No link matches")}</h3><p>${t("Change the search or filter.")}</p></div></td></tr>`}${page.rows.map((b) => `<tr data-bl="${b.id}" id="row-${b.id}">
          <td class="head-cell url-cell"><span class="with-logo">${siteLogo(linkDomain(b.src))}<span class="logo-text"><span class="nb-inline">${PageLink.html(b.src, { text: b.src.replace(/^https?:\/\//, ""), cls: "kw mono small" })}<button class="sr" data-open-bl="${b.id}">${t("Open details")}</button>${window.COMP?.notes?.badge ? window.COMP.notes.badge({ scope: "domain", domain: linkDomain(b.src), siteId: window.UI.siteIdPicked?.() ?? null }, linkDomain(b.src)) : ""}</span><span class="second" dir="auto">${esc(b.anchor || b.check?.anchor || "—")}</span>${state.site === "all" && b.site ? `<span class="second mono" dir="auto">${t("For")} ${esc(b.site)}</span>` : ""}</span></span></td>
          <td class="mono small url-cell" data-label="${t("Target")}">${b.target ? PageLink.html(b.target, { host: b.site }) : "—"}</td>
          <td data-label="${t("Keyword")}">${b.keyword ? KeywordLink.html(b.keyword, { host: b.site }) : '<span class="muted">—</span>'}</td>
          <td data-label="${t("Anchor type")}">${window.BacklinkSeo.anchorTag(b) || '<span class="muted">—</span>'}</td>
          <td data-label="${t("Status")}">${linkStatus(b.status)}${window.LinkExtras.rowNote(b)}${window.BacklinkSeo.badge(b)}</td>
          <td class="r" data-label="${t("Authority")}">${window.BacklinkSeo.authorityCell(b)}</td>${window.BacklinkSeo.trafficCell(b)}
          <td class="r nowrap" data-label="${t("Visits")}">${trafficCell(b)}</td>
          <td class="r" data-label="${t("Leads")}">${b.leads === null ? '<span class="muted">—</span>' : num(b.leads)}</td>
          <td class="r ${b.status === "lost" ? "muted" : ""}" data-label="${t("Cost per visit")}" ${b.status === "lost" ? `data-tip="${t("Lost link: cost per visit from when it was live.")}"` : ""}>${b.shared ? `<span class="muted" role="img" data-tip="${t("Several links share these visits, so no single cost per visit.")}" aria-label="${t("Several links share these visits, so no single cost per visit.")}">—</span>` : b.cost && b.visits ? inCurrency(currencyOfLink(b), dec((b.cost / b.visits).toFixed(2))) : '<span class="muted">—</span>'}</td>
          <td data-label="${t("Mediator")}">${b.mediator ? `<span dir="auto">${esc(b.mediator)}</span>` : '<span class="muted">—</span>'}</td>
        </tr>`).join("")}</tbody></table></div>
      ${window.TP.footer(BL_PAGES, page, { noun: t("links") })}</div>`}`;
    } else if (state.blTab === "mediators") {
      body = window.LinkExtras.mediatorsBody(all, { spentWords, mediatorCost });
    } else if (state.blTab === "reclaim") {
      body = window.BacklinkSeo.reclaimBody();
    } else {
      const ignoredCount = foundHere().filter((f) => f.ignored).length;
      const foundAll = window.FOUND_LINKS.map((f, i) => [f, i]).filter(([f]) => (state.site === "all" || !f.site || f.site === siteName()) && (state.blShowIgnored || !f.ignored));
      const foundPage = window.TP.view(FOUND_PAGES, window.BacklinkSeo.sortRows(foundSearched(foundAll), foundSort, { src: ([f]) => bareUrl(f.src), authority: ([f]) => f.auth }));
      const foundHead = (id, label, cls) => window.BacklinkSeo.sortHead("data-found-sort", foundSort, id, label, cls);
      body = `<div class="chips">${foundAll.length > 10 || window.TP.state(FOUND_PAGES).q ? window.TP.search(FOUND_PAGES, t("Search links")) : ""}${ignoredCount ? `<button class="chip" data-found-show-ignored aria-pressed="${Boolean(state.blShowIgnored)}">${t("Show ignored")}<b>${num(ignoredCount)}</b></button>` : ""}<span style="margin-left:auto" class="bl-tools">${window.BacklinkSeo.foundTools(state.site === "all" ? null : siteName())}</span></div><div class="bl-list"><div class="table-wrap"><table class="data" id="found-table"><thead><tr>${foundHead("src", "Source page")}<th scope="col">${t("Target")}</th><th scope="col">${t("Seen by")}</th>${foundHead("authority", "Authority", "r")}<th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead><tbody>
        ${foundAll.length ? "" : `<tr style="cursor:default"><td colspan="5"><div class="empty"><h3>${t("Nothing found yet")}</h3><p>${t("Links found by other tools show here until logged.")}</p></div></td></tr>`}
        ${foundAll.length && !foundPage.rows.length ? `<tr style="cursor:default"><td colspan="5"><div class="empty"><h3>${t("No link matches")}</h3><p>${t("Change the search.")}</p></div></td></tr>` : ""}
        ${foundPage.rows.map(([f, i]) => `<tr style="cursor:default" class="${f.ignored ? "cg-off" : ""}"><td class="head-cell mono small url-cell" data-tip="${esc(f.src)}">${PageLink.html(f.src, { text: f.src.replace(/^https?:\/\//, ""), title: "" })}</td><td class="mono small" data-label="${t("Target")}">${f.target ? PageLink.html(f.target, { host: f.site }) : "—"}</td><td data-label="${t("Seen by")}">${window.BacklinkSeo.foundSeen(f)}</td><td class="r" data-label="${t("Authority")}">${f.auth === null ? "—" : dec(f.auth)}</td><td class="r nowrap"><button class="btn btn-small" data-log-found="${i}">${t("Log it")}</button> <button class="btn btn-small" data-found-ignore="${i}">${t(f.ignored ? "Bring back" : "Ignore")}</button>${window.BacklinkSeo.foundButton(f)} ${window.UI.taskButton({ title: `${t("Look into a link we didn't log")}: ${f.src.replace(/^https?:\/\//, "")}`, host: f.site || null, source: { type: "backlink", label: f.src.replace(/^https?:\/\//, ""), host: f.site || undefined, facts: [f.target, f.first].filter(Boolean), link: "#backlinks", key: `found|${f.src}` } }, { label: "Task" })}</td></tr>`).join("")}</tbody></table></div>
        ${window.TP.footer(FOUND_PAGES, foundPage, { noun: t("links") })}</div>`;
    }
    return topbar(title, sub, main) + `<div class="content page-enter">
      <h2 class="sr">${t("Totals")}</h2><section class="tiles" id="bl-tiles">
        ${tile(t("Total"), cnt(real.length), planned ? `<span class="ab">+ ${countWords(planned, "1 planned", "planned")}</span>` : "", { ic: "link-2" })}
        ${tile(t("Live"), cnt(live), window.BacklinkSeo.liveNote(real), { ic: "circle-check" })}
        ${tile(t("Lost"), lost ? cnt(lost) : "0", lost && !bl.server ? status("serious", t("lost this week")) : lostThisWeek(real) ? status("serious", lostThisWeek(real) === 1 ? t("1 lost this week") : `${num(lostThisWeek(real))} ${t("lost this week")}`) : "", { ic: "link-2-off", tone: lost ? "serious" : "" })}
        ${tile(t("New"), cnt((bl.server ? 0 : 2) + real.filter(isNewLink).length), `<span class="ab">${esc(periodLabel())}</span>`, { ic: "plus" })}
        ${bl.server ? tile(t("Visits"), visitsKnown ? cnt(visits) : "—", visitsKnown ? `<span class="ab">${t("Last 12 months")}</span>` : `<span class="ab">${t("GA4 not connected")}</span>`, { ic: "eye" }) : tile(t("Visits"), cnt(visits), delta(12, { unit: "%" }), { ic: "eye", line: [40, 44, 48, 52, 50, 58, 66, 72] })}
        ${bl.server ? tile(t("Leads"), visitsKnown ? cnt(leads) : "—", visitsKnown ? `<span class="ab">${t("Last 12 months")}</span>` : `<span class="ab">${t("GA4 not connected")}</span>`, { ic: "users" }) : tile(t("Leads"), cnt(leads), delta(1), { ic: "users", line: [1, 1, 2, 2, 3, 3, 3, 4] })}
      </section>
      ${sections}
      ${section === "consideration" ? considerationBody() : section === "todo" ? window.LinkTodo.body() : `<div class="tabs" role="tablist" aria-label="${t("Backlinks")}">${tabs.map(([id, label, n]) => `<button class="tab" role="tab" data-bl-tab="${id}" aria-selected="${state.blTab === id}">${t(label)} <span class="muted">${n}</span></button>`).join("")}</div>
      ${body}`}</div>`;
  }

  // ---- Site health: links checker ---------------------------------------------------
  // Talks to the real server when there is one (scans run in the worker). Opened as a plain
  // file there is no server, so sample data stands in, with the same rules.
  const LC_RULE = "Checks links on your own sites only, not rankings or backlinks.";
  const LC_LIMITS = "Reads plain <a> links only.";
  const LC_GROUPS = [["broken", "Broken"], ["unverified", "Couldn't verify"], ["redirect", "Redirect chains"], ["slow", "Slow"]];
  const WHOLE_SITE_WORDS = "Reads every page, about 3 seconds each: 1,000 pages take about an hour.";
  const BUDGET_PAUSE_WORDS = "Paused: today's request budget is used up. Resumes tomorrow.";
  const readingWords = (read, left) => t("Pages read: {read}, {left} to go").replace("{read}", num(read)).replace("{left}", num(left));
  const lc = { started: false, ready: false, api: null, sites: [], siteId: null, scans: [], open: null, activeId: null, active: null, timer: null, stopping: false, loadError: "" };
  const lcSite = () => lc.sites.find((s) => String(s.id) === String(lc.siteId)) || null;
  const isActiveScan = (s) => s.status === "queued" || s.status === "running";
  const fmtStamp = (iso) => (iso ? new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—"); // the database keeps UTC, people read their own clock
  // A plain calendar day stays that day. A moment in time is shown on the reader's own clock.
  const fmtDateOnly = (iso) => (iso ? new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", year: "numeric", ...(/T00:00:00(\.0+)?Z$|^\d{4}-\d{2}-\d{2}$/.test(iso) ? { timeZone: "UTC" } : {}) }).format(new Date(iso)) : "—");

  /* Through the app's one wrapper (COMP.api in competitors.js): it waits out a 429, shares a GET already on its way and asks
     auth/me again after a stale token, so this screen gets the same plain sentences as the others (F20). */
  async function apiCall(path, options = {}) {
    if (window.COMP?.api) {
      let body;
      try { body = options.body ? JSON.parse(options.body) : undefined; } catch { body = options.body; }
      return window.COMP.api(options.method || "GET", path, body);
    }
    const reply = await fetch(`api/${path}`, options);
    const body = await reply.json().catch(() => ({}));
    if (!reply.ok) { const err = new Error(body.error || `Error ${reply.status}`); err.status = reply.status; throw err; }
    return body;
  }
  const sendJson = (method, data) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data || {}) });
  const serverApi = {
    sites: () => apiCall("links/sites").then((b) => b.sites),
    addSite: (address, kind) => apiCall("sites", sendJson("POST", { address, kind })),
    saveSite: (id, patch) => apiCall(`links/sites/${id}`, sendJson("PATCH", patch)),
    startScan: (siteId, checkExternal) => apiCall("links/scan", sendJson("POST", { site_id: siteId, check_external: checkExternal })).then((b) => b.scan_id),
    scans: (siteId) => apiCall(`links/sites/${siteId}/scans`).then((b) => b.scans),
    scan: (id) => apiCall(`links/scans/${id}`),
    stop: (id) => apiCall(`links/scans/${id}/stop`, { method: "POST" }),
    remove: (id) => apiCall(`links/scans/${id}`, { method: "DELETE" }),
    exportScan: (id) => { const a = document.createElement("a"); a.href = `api/links/scans/${id}/export.csv`; a.download = `links-scan-${id}.csv`; document.body.append(a); a.click(); a.remove(); },
  };

  // Sample data for the plain file. Same rules: only my own sites, ever.
  const sampleApi = (() => {
    const scans = new Map(), flags = new Map();
    let nextId = 1;
    const own = () => (state.firstRun ? window.SITES.filter((s) => s.added) : window.SITES);
    const settings = (id) => { if (!flags.has(id)) flags.set(id, { weekly: true, check_external: true }); return flags.get(id); };
    const lastDone = (id) => [...scans.values()].filter((s) => s.site_id === id && s.status === "complete").pop();
    const addWeek = (iso) => new Date(new Date(iso).getTime() + 7 * 864e5).toISOString();
    const asSite = (s) => { const f = settings(s.id), last = lastDone(s.id); return { id: s.id, host: s.host, start_url: `https://${s.host}/`, ...f, last_checked_at: last ? last.created_at : null, next_check_at: last && f.weekly ? addWeek(last.created_at) : null }; };
    const later = (value) => new Promise((done) => setTimeout(() => done(value), 60));
    const fail = (message) => Promise.reject(Object.assign(new Error(message), {}));
    const sample = (host) => {
      const home = `https://${host}/`, pg = (p) => `https://${host}${p}`;
      return [
        { category: "broken", target_url: pg("/anciens-tarifs/"), status_code: 404, reason: "Page not found", pages: [home, pg("/services/"), pg("/contact/")] },
        { category: "broken", target_url: "https://partenaire.example/guide", status_code: 410, reason: "Page gone", external: true, pages: [pg("/blog/guide/")] },
        { category: "unverified", target_url: "https://reseau-pro.example/company/x", status_code: 999, reason: "Refuses automated checks", external: true, pages: [home] },
        { category: "unverified", target_url: "https://annuaire.example/fiche", status_code: 403, reason: "Blocked by site", external: true, pages: [pg("/presse/")] },
        { category: "unverified", target_url: "https://ancien-partenaire.example/", status_code: null, reason: "The request failed: timed out", external: true, pages: [pg("/blog/guide/")] },
        { category: "redirect", target_url: pg("/offre"), status_code: 200, reason: "3 redirects before the final page", hops: 3, final_url: pg("/offres/2026/"), pages: [home] },
        { category: "redirect", target_url: pg("/promo"), status_code: 302, reason: "Redirects to another website: https://autre-site.example/promo", hops: 1, final_url: "https://autre-site.example/promo", pages: [pg("/services/")] },
        { category: "slow", target_url: pg("/galerie/"), status_code: 200, reason: "Took 6.2 s to answer", seconds: 6.2, pages: [home, pg("/contact/")] },
      ];
    };
    const counts = (issues) => Object.fromEntries(LC_GROUPS.map(([g]) => [g, issues.filter((i) => i.category === g).length]));
    return {
      sites: () => later(own().map(asSite)),
      addSite(address, kind) {
        const host = window.BacklinkCleaner.rootDomain(address) ? (address.includes("://") ? address.split("://")[1] : address).split("/")[0].toLowerCase().replace(/^www\./, "") : "";
        if (!kind) return fail("Say whether this is your own website or a competitor.");
        if (!host) return fail("Not a website address.");
        const inOwn = window.SITES.some((s) => s.host === host), inRival = window.COMPETITOR_SITES.some((s) => s.host === host);
        if (inOwn || inRival) return fail(`${host} is already added as ${inOwn ? "your own website" : "a competitor"}.`);
        const site = { id: `site-${Date.now()}`, host, visits: 0, vd: 0, clicks: 0, cd: 0, alerts: 0, thru: "—", added: true };
        if (kind === "own") window.SITES.push(site); else window.COMPETITOR_SITES.push(site);
        return later({ id: site.id, host, kind });
      },
      saveSite(id, patch) { Object.assign(settings(id), patch); return later(asSite(own().find((s) => s.id === id))); },
      startScan(siteId, checkExternal) {
        const site = own().find((s) => s.id === siteId);
        if (!site) return fail("The links checker only runs on your own websites.");
        if ([...scans.values()].some((s) => s.site_id === siteId && isActiveScan(s))) return fail("A scan of this website is already running.");
        const id = nextId++;
        const total = 24, all = sample(site.host);
        const scan = { id, site_id: siteId, host: site.host, status: "queued", trigger: "button", max_pages: null, check_external: checkExternal, stop_reason: null, stop_requested: false, pages_read: 0, links_checked: 0, skipped_robots: 0, too_large: 0, pages_not_read: 0, external_not_checked: 0, external_left: 0, stopped_at_limit: false, requests_used: 0, paused_until: null, error: null, created_at: new Date().toISOString(), finished_at: null, issues: [], counts: counts([]) };
        scans.set(id, scan);
        const finish = (status) => {
          const share = status === "complete" ? 1 : scan.pages_read / total;
          scan.issues = all.filter((i, n) => (checkExternal || !i.external) && (status === "complete" || n / all.length <= share));
          scan.counts = counts(scan.issues);
          scan.status = status;
          scan.skipped_robots = 2;
          scan.external_not_checked = checkExternal ? 0 : all.filter((i) => i.external).length;
          scan.pages_not_read = total - scan.pages_read;
          scan.stop_reason = status === "stopped" ? "user" : null;
          scan.finished_at = new Date().toISOString();
        };
        const step = () => {
          if (scan.stop_requested) return finish("stopped");
          scan.status = "running";
          if (scan.pages_read < total) {
            scan.pages_read += 1; scan.links_checked += 4; scan.requests_used += 1;
            scan.pages_not_read = Math.min(total - scan.pages_read, scan.pages_read * 3 + 2); // more pages come to light as it reads
            if (scan.pages_read === total && checkExternal) scan.external_left = 5;
            return setTimeout(step, reduceMotion() ? 20 : 260);
          }
          if (scan.external_left > 0) { scan.external_left -= 1; scan.links_checked += 1; scan.requests_used += 1; return setTimeout(step, reduceMotion() ? 20 : 220); }
          return finish("complete");
        };
        setTimeout(step, 400);
        return later(id);
      },
      scans: (siteId) => later([...scans.values()].filter((s) => s.site_id === siteId).reverse().map((s) => ({ ...s, issues: undefined }))),
      scan: (id) => { const s = scans.get(id); return s ? later({ scan: { ...s, issues: undefined }, counts: s.counts, issues: s.issues }) : fail("That scan doesn't exist."); },
      stop(id) { const s = scans.get(id); if (s) s.stop_requested = true; return later({ ok: true }); },
      remove(id) { scans.delete(id); return later({ ok: true }); },
      exportScan(id) {
        const s = scans.get(id);
        const cell = (v) => { const text = v === null || v === undefined ? "" : String(v); return `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`; };
        const rows = [["Group", "Linking page", "Target URL", "Status code", "Reason", "Hops", "Seconds", "Final URL"]];
        s.issues.forEach((i) => (i.pages.length ? i.pages : [""]).forEach((page) => rows.push([LC_GROUPS.find(([g]) => g === i.category)[1], page, i.target_url, i.status_code, i.reason, i.hops, i.seconds, i.final_url])));
        const url = URL.createObjectURL(new Blob(["﻿", rows.map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url; a.download = `links-scan-${id}.csv`;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
    };
  })();

  // Served by the app, it is always the real server. A failed answer shows as an error, never as sample rows.
  // Sample data is only for the screen opened as a plain file, with no app behind it.
  async function pickLinksApi() {
    return location.protocol.startsWith("http") ? serverApi : sampleApi;
  }

  async function startLinks() {
    lc.started = true;
    lc.api = await pickLinksApi();
    await reloadLinkSites();
  }

  function resetLinks() {
    clearTimeout(lc.timer); lc.poll?.stop?.();
    Object.assign(lc, { started: false, ready: false, sites: [], siteId: null, scans: [], open: null, activeId: null, active: null, timer: null, stopping: false, loadError: "" });
  }

  async function reloadLinkSites(selectId = null) {
    try {
      lc.sites = await lc.api.sites();
      lc.loadError = "";
    } catch (err) { lc.sites = []; lc.loadError = err.message; }
    const wanted = selectId ?? lc.siteId;
    lc.siteId = lc.sites.some((s) => String(s.id) === String(wanted)) ? wanted : (preferredSite(lc.sites)?.id ?? null);
    lc.ready = true;
    await loadLinkHistory();
  }

  async function loadLinkHistory({ openLatest = true } = {}) {
    clearTimeout(lc.timer); lc.poll?.stop?.();
    lc.scans = lc.siteId === null ? [] : await lc.api.scans(lc.siteId);
    const running = lc.scans.find(isActiveScan);
    if (running) {
      lc.activeId = running.id; lc.active = running; lc.stopping = Boolean(running.stop_requested);
      if (state.route === "health") render();
      pollLinkScan();
      return;
    }
    lc.activeId = null; lc.active = null; lc.stopping = false;
    if (openLatest) lc.open = lc.scans[0] ? await lc.api.scan(lc.scans[0].id) : null;
    if (state.route === "health") render();
  }

  // Only the numbers change while a scan runs, so focus stays on the Stop button.
  function paintLinkProgress() {
    const s = lc.active, text = $("#lc-progress-text");
    if (!s || !text) return;
    const waiting = s.status === "queued", paused = Boolean(s.paused_until), read = s.pages_read || 0, left = s.pages_not_read || 0;
    const checkingOutside = s.external_left > 0, outsideDone = (s.links_checked || 0) - read;
    text.textContent = lc.stopping ? t("Stopping after this request…")
      : paused ? t(BUDGET_PAUSE_WORDS)
      : waiting ? t("Waiting to start…")
      : checkingOutside ? `${t("Checking outgoing links")}: ${num(s.external_left)} ${t("left")}`
      : readingWords(read, left);
    $("#lc-progress-sub").textContent = paused ? readingWords(read, left) : `${num(s.links_checked)} ${t("links checked")}. ${t("Keeps going if you leave.")}`;
    $("#lc-bar").style.setProperty("--p", checkingOutside ? outsideDone / Math.max(1, outsideDone + s.external_left) : read / Math.max(1, read + left));
    $("#lc-spin svg")?.classList.toggle("spin", !paused);
    const historyPages = $("[data-lc-live-pages]"), historyWord = $("[data-lc-live-word]");
    if (historyPages) historyPages.textContent = num(read);
    if (historyWord) historyWord.textContent = t(waiting ? "Waiting" : "Running");
  }

  /* A running links check is followed with the app's one poller (COMP.poll): paused while the tab is hidden, slower after
     failures, stopped on 404/401 (F115). As a plain file there's no poller, so a short timer stands in. */
  function pollLinkScan() {
    lc.poll?.stop?.();
    clearTimeout(lc.timer);
    const step = async () => {
      if (!lc.activeId) return false;
      const data = await lc.api.scan(lc.activeId);
      lc.active = data.scan;
      if (isActiveScan(data.scan)) { paintLinkProgress(); return true; }
      lc.activeId = null; lc.active = null; lc.stopping = false; lc.open = data;
      await loadLinkHistory({ openLatest: false });
      const word = data.scan.status === "complete" ? t("Links check finished") : data.scan.status === "stopped" ? t("Links check stopped") : t("Links check failed");
      toast(word, { kind: data.scan.status === "failed" ? "crit" : data.scan.status === "stopped" ? "info" : "good" });
      return false;
    };
    if (window.COMP?.poll && bl.server) { lc.poll = window.COMP.poll(step, { every: 900, grow: 1.1, slowest: 10000, errors: 6 }); return; }
    lc.timer = setTimeout(async () => { try { if (await step()) pollLinkScan(); } catch { pollLinkScan(); } }, 900);
  }

  function lcNotices(scan) {
    const notes = [];
    if (scan.status === "failed") notes.push(["crit", scan.error ? t(scan.error) : t("Scan failed.")]);
    if (scan.stop_reason === "user") notes.push(["warn", `${t("Stopped by you after")} ${num(scan.pages_read)} ${t(scan.pages_read === 1 ? "page" : "pages")}. ${t("Scan incomplete.")}`]);
    if (scan.skipped_robots) notes.push(["info", `${t("skipped by robots.txt")}: ${num(scan.skipped_robots)}`]);
    if (scan.too_large) notes.push(["info", `${t("too large to read")}: ${num(scan.too_large)}`]);
    if (scan.external_not_checked) notes.push(["info", `${t("outgoing links not checked")}: ${num(scan.external_not_checked)}`]);
    return notes;
  }

  function lcPagesCell(pages) {
    if (!pages.length) return `<span class="sec small">${t("The start page")}</span>`;
    const link = (p) => `<a class="mono small lc-url" href="${esc(p)}" target="_blank" rel="noopener noreferrer nofollow">${esc(p.replace(/^https?:\/\//, ""))}</a>`;
    if (pages.length === 1) return link(pages[0]);
    return `${link(pages[0])}<details class="lc-more"><summary>${t("and")} ${num(pages.length - 1)} ${t(pages.length === 2 ? "more page" : "more pages")}</summary>${pages.slice(1).map((p) => `<div>${link(p)}</div>`).join("")}</details>`;
  }

  // Saved checks keep the words they were saved with, so the wording that matches the health test is added on the way out.
  const lcReason = (reason) => t(reason === "Server error" ? "Server error: the page failed to answer" : reason);
  function linkFind(issue, group) {
    const host = lcSite()?.host, target = issue.target_url.replace(/^https?:\/\//, "");
    const onPages = issue.pages.length ? `${t("Found on")}: ${issue.pages.slice(0, 10).map((p) => p.replace(/^https?:\/\//, "")).join(", ")}${issue.pages.length > 10 ? ` +${issue.pages.length - 10}` : ""}` : t("The start page");
    return { title: `${t(group)}: ${target}`, host, source: { type: "link", label: `${t(group)} · ${target}`, host, facts: [issue.status_code ? `${t("Status")} ${issue.status_code}` : "", lcReason(issue.reason), onPages].filter(Boolean), link: "#health/links", key: `link|${lcSite()?.id}|${issue.target_url}` } };
  }

  /* Each group's pages, and one search over every group (table-pages.js), like every long table in the app (2026-11-10). */
  const LC_FIND = "lc-find", LC_HISTORY = "lc-history", lcKey = (id) => `lc-${id}`;
  const lcFound = (issues) => issues.filter((i) => window.TP.matches(LC_FIND, i.target_url, i.final_url, lcReason(i.reason), ...(i.pages || [])));
  LC_GROUPS.forEach(([id]) => window.TP.on(lcKey(id), () => render()));
  window.TP.on(LC_FIND, () => { LC_GROUPS.forEach(([id]) => window.TP.reset(lcKey(id))); render(); });
  window.TP.on(LC_HISTORY, () => render());

  /* Broken and Could not verify: the same reason and status on many rows is said once, as a heading with its count,
     biggest first, and the rows keep only the linking page and the target. Redirect chains and Slow keep their own
     columns: each row's reason carries its own numbers (hops, seconds). */
  const LC_BY_REASON = new Set(["broken", "unverified"]);
  const lcReasonKey = (i) => `${lcReason(i.reason)}\u0001${i.status_code ?? ""}`;
  const LC_REASON_TIPS = { 404: "Every link below points to a page that answers 404 (not found).", 410: "Every link below points to a page that answers 410 (gone): it was removed for good." };
  [["Every link below points to a page that answers 410 (gone): it was removed for good.", "Chaque lien ci-dessous pointe vers une page qui répond 410 (disparue) : elle a été supprimée pour de bon."]]
    .forEach(([en, fr]) => { if (window.FR[en] === undefined) window.FR[en] = fr; });
  function lcReasonHead(i, n) {
    const status = i.status_code === null || i.status_code === undefined ? "" : ` · <span class="tabular">${i.status_code}</span>`;
    const tip = i.category === "broken" ? window.UI.tip(LC_REASON_TIPS[i.status_code]) : "";
    return `<tr class="lc-sub" style="cursor:default"><th scope="colgroup" colspan="3">${esc(lcReason(i.reason))}${status}${n > 1 ? ` <span class="muted tabular">×${num(n)}</span>` : ""}${tip}</th></tr>`;
  }
  function lcGroup([id, name], issues, searching) {
    const byReason = LC_BY_REASON.has(id);
    let list = issues.filter((i) => i.category === id);
    const counts = new Map();
    if (byReason) {
      list.forEach((i) => counts.set(lcReasonKey(i), (counts.get(lcReasonKey(i)) || 0) + 1));
      const rank = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
      list = [...list].sort((a, b) => rank.indexOf(lcReasonKey(a)) - rank.indexOf(lcReasonKey(b)));
    }
    const page = window.TP.view(lcKey(id), list);
    const target = (i) => `<td data-label="${t("Target URL")}"><a class="mono small lc-url" href="${esc(i.target_url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(i.target_url.replace(/^https?:\/\//, ""))}</a>${byReason && i.final_url && !i.reason.includes(i.final_url) ? `<span class="second lc-url mono">→ ${esc(i.final_url.replace(/^https?:\/\//, ""))}</span>` : ""}</td>`;
    const drawn = page.rows.map((i) => `<tr style="cursor:default">
          <td class="head-cell" data-label="${t("Linking page")}">${lcPagesCell(i.pages)}</td>
          ${target(i)}${byReason ? "" : `
          <td data-label="${t("Status")}">${i.status_code === null || i.status_code === undefined ? '<span class="muted">—</span>' : `<span class="tag tabular">${i.status_code}</span>`}</td>
          <td class="small" data-label="${t("Reason")}">${esc(lcReason(i.reason))}${i.final_url && !i.reason.includes(i.final_url) ? `<span class="second lc-url mono">→ ${esc(i.final_url.replace(/^https?:\/\//, ""))}</span>` : ""}</td>`}
          <td class="r nowrap" data-label="">${window.UI.taskButton(linkFind(i, name), { label: "Task" })}</td>
        </tr>`);
    // A heading wherever the reason changes: once per reason here, or on each row while a column sort mixes them.
    let body = "", last = null;
    page.rows.forEach((i, at) => {
      if (byReason && lcReasonKey(i) !== last) body += lcReasonHead(i, counts.get(lcReasonKey(i)) || 0);
      last = lcReasonKey(i);
      body += drawn[at];
    });
    const heads = byReason ? "" : `<th scope="col">${t("Status")}</th><th scope="col">${t("Reason")}</th>`;
    return `<section class="card lc-group" data-group="${id}">
      <div class="card-head"><h2>${t(name)}</h2><span class="lc-count ${list.length && id === "broken" ? "crit" : "sec"}">${num(list.length)}</span></div>
      ${list.length ? `<table class="data lc-table" id="lc-table-${id}"><thead><tr><th scope="col">${t("Linking page")}</th><th scope="col">${t("Target URL")}</th>${heads}<th scope="col"><span class="sr-only">${t("Task")}</span></th></tr></thead><tbody>
        ${body}</tbody></table>
        ${window.TP.footer(lcKey(id), page, { noun: t("links") })}` : `<p class="lc-none small muted">${t(searching ? "No link matches." : "None found.")}</p>`}
    </section>`;
  }

  function lcResult() {
    if (!lc.open) return "";
    const { scan, issues, counts } = lc.open;
    const notes = lcNotices(scan);
    const how = scan.trigger === "weekly" ? t("Weekly check") : t("Run by hand");
    if (lc.pagedFor !== scan.id) { lc.pagedFor = scan.id; LC_GROUPS.forEach(([id]) => window.TP.reset(lcKey(id))); } // another check opens at page 1
    const q = window.TP.state(LC_FIND).q.trim(), found = lcFound(issues);
    // One search over every group, once there are enough links to need it.
    return `<section class="lc-result" aria-label="${t("Result")}">
      <div class="lc-result-head">
        <div><h2>${esc(scan.host || lcSite()?.host || "")}</h2><p class="small sec">${esc(fmtStamp(scan.created_at))} · ${how} · ${num(scan.pages_read)} ${t(scan.pages_read === 1 ? "page read" : "pages read")} · ${num(scan.links_checked)} ${t("links checked")}</p></div>
      </div>
      ${notes.length ? `<div class="lc-notes">${notes.map(([kind, text]) => `<p class="note ${kind === "info" ? "" : kind}" style="margin:0">${icon(kind === "crit" ? "octagon-alert" : kind === "warn" ? "triangle-alert" : "info")}<span>${esc(text)}</span></p>`).join("")}</div>` : ""}
      <div class="tiles lc-tiles">${LC_GROUPS.map(([id, name]) => `<a class="tile lc-jump" href="#lc-${id}" data-lc-jump="${id}"><div class="lab">${t(name)}</div><div class="fig tabular ${id === "broken" && counts[id] ? "crit" : ""}">${num(counts[id] || 0)}</div></a>`).join("")}</div>
      ${issues.length > 10 || q ? `<div class="chips lc-find">${window.TP.search(LC_FIND, t("Search links"))}</div>` : ""}
      ${LC_GROUPS.map((g) => lcGroup(g, found, Boolean(q))).join("")}
    </section>`;
  }

  function healthPage() {
    const head = topbar(t("Site health"), t("Problems on your sites"), "", false);
    const tabs = `<div class="tabs health-tabs" role="tablist" aria-label="${t("Site health")}"><button class="tab" role="tab" data-health-tab="test" aria-selected="${state.healthTab === "test"}">${icon("heart-pulse")}${t("Health test")}</button><button class="tab" role="tab" data-health-tab="links" aria-selected="${state.healthTab === "links"}">${icon("link-2")}${t("Links checker")}</button><button class="tab" role="tab" data-health-tab="uptime" aria-selected="${state.healthTab === "uptime"}">${icon("activity")}${t("Uptime")}</button></div>`;
    if (state.healthTab === "test" && window.HealthTest) return `${head}<div class="content page-enter">${tabs}${window.HealthTest.body()}</div>`;
    if (state.healthTab === "uptime") return `${head}<div class="content page-enter">${tabs}${window.UptimeWatch.body()}</div>`;
    if (!lc.ready) return `${head}<div class="content page-enter">${tabs}${window.UI.skeleton("table")}</div>`;
    if (!lc.sites.length && lc.loadError) { // the server refused or failed: never pretend there are no websites
      return `${head}<div class="content page-enter">${tabs}<div class="table-wrap"><div class="empty" id="lc-load-error" role="alert">
        <h3>${t("The server didn't answer")}</h3><p>${esc(lc.loadError)}. ${t("Wait a moment, then try again.")}</p>
        <button class="btn btn-main" id="lc-retry">${icon("refresh-cw")}${t("Try again")}</button></div></div></div>`;
    }
    if (!lc.sites.length) {
      return `${head}<div class="content page-enter">${tabs}<div class="table-wrap"><div class="empty" id="lc-empty">
        <h3>${t("No sites yet")}</h3><p>${t("Add your site, then check its links.")}</p>
        <button class="btn btn-main" id="site-add">${icon("plus")}${t("Add a site")}</button></div></div></div>`;
    }
    // The side menu leads here too, unless a check is running: its list is locked until then.
    const picked = window.UI.siteHostPicked();
    if (lc.ready && !lc.activeId && picked !== lc.lastPicked) {
      lc.lastPicked = picked;
      const match = picked && lc.sites.find((s) => s.host === picked);
      if (match && String(match.id) !== String(lc.siteId)) { lc.siteId = match.id; lc.open = null; loadLinkHistory(); }
    }
    const site = lcSite();
    const busy = Boolean(lc.activeId);
    if (lc.historyFor !== lc.siteId) { lc.historyFor = lc.siteId; window.TP.reset(LC_HISTORY); window.TP.state(LC_FIND).q = ""; } // another website starts at page 1
    const history = window.TP.view(LC_HISTORY, lc.scans);
    const weekly = site.weekly
      ? (site.next_check_at ? `${t("Next check")}: ${esc(fmtDateOnly(site.next_check_at))}` : t("First check: next weekly run"))
      : t("Only when you press Run");
    return `${head}<div class="content page-enter">${tabs}
      <section class="card lc-tool">
        <p class="prospect-note lc-rule">${icon("info")}<span>${t(LC_RULE)}</span></p>
        <div class="lc-form">
          <label class="field lc-site-field"><span>${t("Website")}</span><select class="select" id="lc-site" style="width:100%" ${busy ? "disabled" : ""}>${lc.sites.map((s) => `<option value="${esc(s.id)}" ${String(s.id) === String(lc.siteId) ? "selected" : ""}>${esc(s.host)}</option>`).join("")}</select></label>
          <button class="btn btn-main" id="lc-run" ${busy ? "disabled" : ""}>${icon("refresh-cw")}${t("Run check")}</button>
        </div>
        ${showingNote(site.host)}
        <p class="help" id="lc-whole-site">${t(WHOLE_SITE_WORDS)}</p>
        <div class="lc-options">
          <label class="opt"><input type="checkbox" class="chk" style="margin:0" id="lc-external" ${site.check_external ? "checked" : ""} ${busy ? "disabled" : ""}>${t("Check outgoing links")}<span class="small muted">(${t("one request each, pages never read")})</span></label>
          <label class="opt"><input type="checkbox" class="chk" style="margin:0" id="lc-weekly" ${site.weekly ? "checked" : ""}>${t("Check weekly")}<span class="small muted" id="lc-weekly-note">(${weekly})</span></label>
        </div>
        <p class="help">${esc(t(LC_LIMITS))}${UI.tip("Images and links added by JavaScript aren't checked.")}</p>
        <p class="help"><button class="link-btn" id="site-add">${t("Add a site")}</button></p>
      </section>
      ${busy ? `<section class="card lc-progress" role="status"><div class="top"><span class="spin-wrap" id="lc-spin">${icon("refresh-cw", "spin")}</span><div class="lc-progress-words"><b id="lc-progress-text"></b><span class="small sec" id="lc-progress-sub"></span></div><button class="btn" id="lc-stop" ${lc.stopping ? "disabled" : ""}>${t(lc.stopping ? "Stopping…" : "Stop")}</button></div><div class="tray-bar"><i id="lc-bar"></i></div></section>` : ""}
      ${lcResult()}
      <section class="card" aria-label="${t("History")}"><div class="card-head"><h2>${t("History")}</h2><span class="end small muted">${esc(site.host)}</span></div>
        ${lc.scans.length ? `<table class="data lc-table" id="lc-history"><thead><tr><th scope="col">${t("Date")}</th><th scope="col">${t("How")}</th><th scope="col" class="r">${t("Pages")}</th>${LC_GROUPS.map(([, n]) => `<th scope="col" class="r">${t(n)}</th>`).join("")}<th scope="col">${t("Result")}</th><th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead><tbody>
          ${history.rows.map((s) => `<tr style="cursor:default" class="${lc.open && lc.open.scan.id === s.id ? "open" : ""}">
            <td class="head-cell" data-label="${t("Date")}">${esc(fmtStamp(s.created_at))}</td>
            <td data-label="${t("How")}">${s.trigger === "weekly" ? t("Weekly check") : t("Run by hand")}</td>
            <td class="r" data-label="${t("Pages")}" ${isActiveScan(s) ? "data-lc-live-pages" : ""}>${num(s.pages_read)}</td>
            ${LC_GROUPS.map(([g, n]) => `<td class="r" data-label="${t(n)}">${num((s.counts || {})[g] || 0)}</td>`).join("")}
            <td data-label="${t("Result")}"><span class="small sec" ${isActiveScan(s) ? "data-lc-live-word" : ""}>${t({ queued: "Waiting", running: "Running", complete: "Complete", stopped: "Stopped", failed: "Failed" }[s.status])}</span></td>
            <td class="r nowrap" data-label=""><button class="btn btn-small" data-lc-open="${s.id}" ${isActiveScan(s) ? "disabled" : ""}>${t("Open")}</button> <button class="icon-btn" style="width:28px;height:28px;vertical-align:middle" data-lc-delete="${s.id}" aria-label="${t("Delete")}: ${esc(fmtStamp(s.created_at))}" data-tip="${t("Delete")}" ${isActiveScan(s) ? "disabled" : ""}>${icon("trash-2")}</button></td>
          </tr>`).join("")}</tbody></table>
        ${window.TP.footer(LC_HISTORY, history, { noun: t("link checks") })}` : `<p class="lc-none small muted">${t("No checks yet.")}</p>`}
      </section>
    </div>`;
  }

  function addSitePanel(opener, kind = "own") {
    const current = window.SITES.find((s) => s.id === state.site)?.host;
    const rivalOf = window.SITES.length
      ? `<label class="field"><span>${t("Competitor of which site?")}</span><select class="select" id="site-rival-site" style="width:100%">${window.SITES.map((s) => `<option ${s.host === current ? "selected" : ""}>${esc(s.host)}</option>`).join("")}</select></label>`
      : `<p class="help">${t("Add your own website first, then its competitors.")}</p>`;
    openPanel(`${panelHead(t("Add a site"), t("Yours, or a competitor to watch"))}
      <form class="panel-body" id="site-form" novalidate>
        <label class="field"><span>${t("Address")} <span class="req">*</span></span><input class="input mono" type="url" inputmode="url" spellcheck="false" autocapitalize="off" autocomplete="off" id="site-address" placeholder="https://" data-autofocus aria-describedby="site-error"><div id="site-error"></div><div class="help" id="site-preview" role="status"></div></label>
        <fieldset class="scope"><legend>${t("Whose site?")}</legend>
          <label class="opt"><input type="radio" name="site-kind" value="own" ${kind === "own" ? "checked" : ""}>${t("My site")}</label>
          <label class="opt"><input type="radio" name="site-kind" value="competitor" ${kind === "competitor" ? "checked" : ""}>${t("A competitor")}</label>
        </fieldset>
        <div id="site-rival-of" ${kind === "competitor" ? "" : "hidden"}>${rivalOf}</div>
        <p class="help">${t("Only your own sites go in the links checker.")}</p>
      </form>
      <div class="panel-foot"><button class="btn btn-main" id="site-save">${t("Add")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener, { key: `site|${kind}`, reopen: () => addSitePanel(opener, kind) });
  }

  async function runLinkCheck() {
    if (lc.starting) return; // a double click starts one scan
    lc.starting = true;
    const site = lcSite();
    const external = $("#lc-external").checked;
    try {
      await lc.api.startScan(site.id, external);
      lc.open = null;
      await loadLinkHistory({ openLatest: false });
      $("#lc-stop")?.focus();
      paintLinkProgress();
    } catch (err) {
      toast(t(err.message), { kind: "crit" });
    } finally {
      lc.starting = false;
    }
  }

  // ---- one site selector --------------------------------------------------------
  /* A page's own website list moves the side menu too, so the two can't disagree. Never a full redraw: one during a load
     would draw the old site's rows under the new site's name. */
  function pickSite(host) {
    const found = window.SITES.find((s) => s.host === host);
    const id = host === "all" ? "all" : found?.id;
    if (!id || state.site === id) return;
    state.site = id;
    renderSidebar();
    placeInks();
    syncUrl();
  }
  /* Said whenever the menu and the page aren't on the same site: at All sites, or on a site this screen doesn't have. */
  const showingNote = (shownHost) => {
    const picked = window.UI.siteHostPicked();
    return shownHost && picked !== shownHost ? `<p class="help showing-note" role="status">${t("Showing")} <b class="mono" dir="auto">${esc(shownHost)}</b>. ${t("Pick another site here.")}</p>` : "";
  };

  // ---- setting up a website -------------------------------------------------------
  /* The first run card and the panel after adding a site are the same list. Every step but the first can be Not used. */
  const setupFacts = {}; // host: what the server says about keywords and competitors
  const setupChoices = () => { try { return JSON.parse(store.get("siteSetup") || "{}"); } catch { return {}; } };
  // On the real app the server remembers, so every teammate sees the same list. As a plain file, this browser does.
  const SETUP_NOT_USED = (host, id) => (setupFacts[host]?.notUsed ? setupFacts[host].notUsed.includes(id) : Boolean(setupChoices()[host]?.[id]));
  /* On the real app the server keeps the choice. Ticks go in the order they were made, so a slow answer can't undo a later tick,
     and one made before the sites have loaded still gets there. */
  let setupSaving = Promise.resolve(), setupPending = 0;
  /* While a tick is on its way, nothing read from the server earlier (a site list, the setup facts) may put the old list back:
     the save sends the whole list, so an old copy taken in between would drop a tick (seen as "only [google]" after a reload). */
  function saveSetupNotUsed(host, id, on) {
    setupPending += 1;
    setupSaving = setupSaving.then(async () => {
      if (!(await COMP.isServer())) return;
      let facts = setupFacts[host];
      const knownId = window.SITES.find((s) => s.host === host)?.realId;
      if (!facts?.siteId || !Array.isArray(facts.notUsed)) {
        // Not known here yet: the server's own list, read now, is what the tick changes. Never an empty list on a guess.
        const site = (await COMP.api("GET", "links/sites", undefined, { fresh: true })).sites.find((s) => s.host === host || s.id === knownId);
        if (!site) throw new Error("That website isn't saved yet.");
        facts = setupFacts[host] = { ...setupFacts[host], siteId: site.id, notUsed: Array.isArray(setupFacts[host]?.notUsed) ? setupFacts[host].notUsed : site.setup_not_used || [] };
      }
      facts.notUsed = facts.notUsed.filter((x) => x !== id).concat(on ? [id] : []);
      await COMP.api("PATCH", `links/sites/${facts.siteId}`, { setup_not_used: facts.notUsed });
      if (id === "google" || id === "clarity") window.dispatchEvent(new CustomEvent("seocc:sources-changed"));
    }).finally(() => { setupPending -= 1; }).catch(async (err) => {
      toast(t(err.message), { kind: "crit" });
      // What's on screen goes back to what the server really has.
      try { noteRealSites((await COMP.api("GET", "links/sites")).sites); } catch { /* the next load shows it */ }
      if ($(`[data-setup-none][data-host="${host}"]`)) setHTML($("#panel"), setupPanelHtml(host));
      if (state.route === "today") render();
    });
  }
  function setSetupNotUsed(host, id, on) {
    const all = setupChoices();
    all[host] = { ...all[host], [id]: on };
    store.set("siteSetup", JSON.stringify(all));
    if (setupFacts[host]?.notUsed) setupFacts[host].notUsed = setupFacts[host].notUsed.filter((x) => x !== id).concat(on ? [id] : []);
    saveSetupNotUsed(host, id, on);
    // The connection's own per-site setting says the same thing, so Settings agrees.
    const site = window.SITES.find((s) => s.host === host), conn = window.CONNECTIONS.find((c) => c.id === id);
    if (!site || !conn) return;
    if (id === "google") { googleChoices(conn); if (on) conn.props[site.id] = { sc: "", ga4: "" }; else delete conn.props[site.id]; }
    if (id === "clarity") {
      const list = conn.sites === "all" ? window.SITES.map((s) => s.id) : [...conn.sites];
      conn.sites = on ? list.filter((x) => x !== site.id) : [...new Set([...list, site.id])];
    }
  }
  function siteSteps(host) {
    const site = window.SITES.find((s) => s.host === host);
    /* Connected means set up for this site. On the real app `linked` lists those sites; a pull that fails, here or on another
       site, still counts as connected: the data card and Settings say what's wrong. */
    const connected = (id) => {
      const c = window.CONNECTIONS.find((x) => x.id === id);
      if (!site || !c) return false;
      if (Array.isArray(c.linked)) return c.linked.includes(site.id);
      return (c.status === "ok" || c.status === "failing") && (c.sites === "all" || c.sites.includes(site.id));
    };
    const facts = setupFacts[host] || {};
    const steps = [
      { id: "site", word: "Add a site", done: Boolean(host), action: "Add", main: !host },
      { id: "google", word: "Connect Google", hint: "Clicks, positions and visits", done: connected("google"), action: "Connect", main: Boolean(host) },
      { id: "keywords", word: "Add keywords", hint: "The list to follow", done: Boolean(facts.keywords), action: "Add" },
      { id: "competitors", word: "Add competitors", hint: "Who to compare with", done: Boolean(facts.competitors), action: "Find" },
      { id: "clarity", word: "Connect Clarity", hint: "Sessions and scroll depth", done: connected("clarity"), action: "Connect" },
      { id: "checks", word: "Run the first health test", hint: "No score until the first test", done: Boolean(facts.checks), action: "Open" },
    ];
    return steps.map((step) => ({ ...step, skipped: step.id !== "site" && host ? SETUP_NOT_USED(host, step.id) : false }));
  }
  /* Each site's facts are asked once a minute at most, and a second ask while one is on its way waits for it (F3). The site's id
     comes from the list already loaded, not from another links/sites call. */
  const setupAsked = new Map(); // host: { at, promise }
  const SETUP_FRESH_MS = 60000;
  function loadSetupFacts(host, { force = false } = {}) {
    if (!host) return Promise.resolve();
    const held = setupAsked.get(host);
    if (held && !force && (held.loading || Date.now() - held.at < SETUP_FRESH_MS)) return held.promise;
    const entry = { at: Date.now(), loading: true };
    entry.promise = (async () => {
      if (!(await COMP.isServer())) return;
      const known = window.SITES.find((s) => s.host === host);
      let siteId = known?.realId, notUsed = null;
      if (!siteId) {
        const site = (await COMP.api("GET", "links/sites")).sites.find((s) => s.host === host);
        if (!site) return;
        siteId = site.id; notUsed = site.setup_not_used || null;
      }
      const [rivals, suggestions, audits] = await Promise.all([COMP.api("GET", `competitors?site_id=${siteId}`), COMP.api("GET", `competitors/suggestions?site_id=${siteId}`), COMP.api("GET", `health/sites/${siteId}/audits`)]);
      // The list as it is now (a tick may have changed it while these were asked), not as it was when they were asked.
      const current = setupFacts[host]?.notUsed;
      setupFacts[host] = { ...setupFacts[host], siteId, notUsed: Array.isArray(current) ? current : notUsed || undefined, competitors: rivals.competitors.length > 0, keywords: (suggestions.keywords_total || 0) > 0, checks: audits.audits.length > 0, loaded: true };
    })().catch(() => { /* unknown stays unknown: the card isn't drawn on a guess (F22) */ }).finally(() => { entry.loading = false; entry.at = Date.now(); });
    setupAsked.set(host, entry);
    return entry.promise;
  }
  const setupStillOpen = (host) => siteSteps(host).some((step) => !step.done && !step.skipped);
  const setupHidden = () => { try { return JSON.parse(store.get("setupHidden") || "[]"); } catch { return []; } };
  function setupHost() {
    const added = window.SITES.filter((s) => s.added && !setupHidden().includes(s.host));
    if (state.firstRun) return added[0]?.host || null;
    if (state.site !== "all") { const current = window.SITES.find((s) => s.id === state.site); return added.includes(current) ? current.host : null; }
    // At All sites, the first site still without keywords, so a half set-up site can't be forgotten.
    // Only a site known to have no keywords counts: one still loading is unknown, not "to do" (F22).
    return added.find((s) => setupFacts[s.host]?.loaded && setupFacts[s.host].keywords === false && !SETUP_NOT_USED(s.host, "keywords"))?.host || null;
  }
  /* Progress is read again whenever Today opens, so the card never disagrees with what's been done elsewhere. */
  let setupSeen = "";
  async function refreshSetup() {
    // One site picked: only that one. All sites: each site in turn until one still needs keywords, which is the one the card shows.
    const picked = state.site === "all" ? null : window.SITES.find((s) => s.id === state.site);
    const hosts = (picked ? [picked] : window.SITES).filter((s) => s.added && !setupHidden().includes(s.host)).slice(0, 10).map((s) => s.host);
    if (!hosts.length || !(await COMP.isServer())) return;
    for (const host of hosts) {
      await loadSetupFacts(host);
      if (picked || (setupFacts[host]?.keywords === false && !SETUP_NOT_USED(host, "keywords"))) break;
    }
    const now = JSON.stringify(hosts.map((h) => setupFacts[h]));
    if (now !== setupSeen) { setupSeen = now; if (state.route === "today" && !$("#panel")) render(); }
  }
  // A step's short button ("Connect", "Add", "Find", "Open") says to a screen reader what it acts on, and for which site.
  const stepName = (step, host) => (host && step.id !== "site" ? t("{step} for {host}").replace("{step}", t(step.word)).replace("{host}", host) : t(step.word));
  function setupCard() {
    const host = setupHost();
    if (state.setupHidden || (!state.firstRun && !host) || (host && !setupStillOpen(host))) return "";
    if (host && state.served && !setupFacts[host]?.loaded) return ""; // not loaded yet: unknown, so no card that may be wrong
    const steps = siteSteps(host), finished = steps.filter((s) => s.done || s.skipped).length;
    // The simpler screens: one line while a step is open, with the next step and Hide. The line opens the checklist panel.
    // Before any site is added the welcome card stays as it is: it is the whole of Today then, and there is no checklist yet.
    if (host) {
      const next = steps.find((s) => !s.done && !s.skipped), line = headWords("Set up {host}: {done} of {all} done", { host, done: finished, all: steps.length });
      return `<section class="setup setup-line" aria-label="${esc(line)}">
        <button type="button" class="setup-open" data-setup-panel="${esc(host)}" aria-label="${esc(`${line}. ${t("Open the checklist")}`)}"><span class="setup-meter" aria-hidden="true"><i style="width:${Math.round((finished / steps.length) * 100)}%"></i></span><span class="setup-words" dir="auto">${esc(line)}</span>${icon("chevron-right", "chev")}</button>
        ${next ? `<button class="btn ${next.main ? "btn-main" : ""} btn-small" data-setup="${next.id}" data-setup-host="${esc(host)}" aria-label="${esc(`${t(next.word)} · ${host}`)}">${t(next.word)}</button>` : ""}
        <button class="link-btn" data-setup-hide="${esc(host)}">${t("Hide")}</button>
      </section>`;
    }
    // The same six steps before and after the site is added, so the count never changes under the person's eyes.
    const heading = host ? `${t("Set up")} ${host} · ${finished} ${t("of")} ${steps.length} ${t("done")}` : `${t("Welcome.")} ${steps.length} ${t("steps to your first data. Only step 1 is required.")}`;
    const shown = steps;
    return `<section class="setup" aria-label="${esc(heading)}">
        <h2 dir="auto">${esc(heading)}</h2>
        ${shown.map((step, i) => `<div class="step ${step.done || step.skipped ? "done" : ""}"><span class="n">${step.done || step.skipped ? icon("check") : i + 1}</span>${t(step.word)}${step.skipped ? ` <span class="small muted">${t("Not used")}</span>` : ""}${step.done || step.skipped || (!host && step.id !== "site") ? "" : ` <button class="btn ${step.main ? "btn-main" : ""} btn-small" data-setup="${step.id}" data-setup-host="${esc(host || "")}" aria-label="${esc(stepName(step, host))}" ${step.id === "site" ? "data-add-site" : ""}>${t(step.action)}</button>`}</div>`).join("")}
        ${host ? `<button class="link-btn" data-setup-panel="${esc(host)}">${t("Say what this site doesn't use")}</button> <button class="link-btn" data-setup-hide="${esc(host)}">${t("Hide this")}</button>` : ""}
      </section>`;
  }
  function setupPanelHtml(host) {
    return `${panelHead(`${t("Set up")} ${host}`, t("Any order, any time. Missing one? Choose Not used: no alert."))}
      <div class="panel-body"><ul class="rows setup-list" aria-label="${t("Set up")}">${siteSteps(host).map((step) => `<li>
        <span class="step ${step.done || step.skipped ? "done" : ""}"><span class="n">${step.done || step.skipped ? icon("check") : ""}</span></span>
        <div class="what"><div class="t">${t(step.word)}</div>${step.hint ? `<div class="d">${t(step.hint)}</div>` : ""}</div>
        <div class="acts">${step.id === "site" ? status("good", t("Added")) : `${step.done ? status("good", t("Done")) : `<label class="opt small"><input type="checkbox" class="chk" style="margin:0" data-setup-none="${step.id}" data-host="${esc(host)}" ${step.skipped ? "checked" : ""}>${t("Not used")}</label><button class="btn btn-small" data-setup="${step.id}" data-setup-host="${esc(host)}" aria-label="${esc(stepName(step, host))}" ${step.skipped ? "disabled" : ""}>${t(step.action)}</button>`}`}</div>
      </li>`).join("")}</ul></div>
      <div class="panel-foot"><button class="btn btn-main" data-close-panel>${t("Done for now")}</button></div>`;
  }
  async function openSiteSetup(host, opener = null) {
    openPanel(setupPanelHtml(host), opener || $("#site-switch"));
    await loadSetupFacts(host, { force: true });
    if ($(".setup-list")) setHTML($("#panel"), setupPanelHtml(host));
  }
  function runSetupStep(id, host) {
    closePanel();
    if (id === "site") return;
    if (host) pickSite(host);
    if (id === "google" || id === "clarity") { state.connHost = host || null; openConnection(id); return; }
    if (id === "checks") { state.healthTab = "test"; go("health"); return; }
    COMP.tab = id === "keywords" ? "find" : "list";
    COMP.currentTab().loadedFor = undefined;
    go("competitors");
    if (id !== "keywords") return;
    // Straight to the upload, once the tab has loaded. It's the reason for pressing Add.
    const until = Date.now() + 4000;
    const openUpload = () => { const button = $("[data-cl-upload]"); if (button) button.click(); else if (Date.now() < until && state.route === "competitors") setTimeout(openUpload, 120); };
    setTimeout(openUpload, 120);
  }

  // ---- routing and rendering ---------------------------------------------------
  function render({ enter = false, keepScroll = true } = {}) {
    root.dataset.look = state.look; root.dataset.theme = state.theme; root.lang = state.lang;
    // The browser's own bar follows the theme chosen here, not only the computer's setting.
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.content = state.theme === "dark" ? "#14181D" : "#F6F7F9"; });
    $("#app").classList.toggle("rail", state.rail);
    renderSidebar();
    const main = $("#main");
    const top = main.scrollTop;
    const screen = window.SCREENS?.[state.route];
    const html = !mayOpen(state.route) ? noAccessPage() : screen ? screen.page() : state.route === "keywords" ? keywordsPage() : state.route === "backlinks" ? backlinksPage() : state.route === "settings" ? settingsPage() : state.route === "health" ? healthPage() : todayPage();
    // The simpler head is drawn again with the page: a period button or the comparison keeps the keyboard's place.
    const headFocus = state.simple ? headFocusKey() : null;
    setHTML($("#page"), html);
    if (headFocus) $(headFocus)?.focus({ preventScroll: true });
    nameTables($("#page"));
    defineHeaders($("#page"));
    if (!enter) $$(".page-enter", main).forEach((el) => el.classList.remove("page-enter"));
    if (keepScroll) main.scrollTop = top;
    syncTopbar();
    placeInks();
    updateCues();
    if (enter) countUps();
    screen?.after?.();
    if (state.route === "health") {
      if (state.healthTab === "test" && window.HealthTest) window.HealthTest.after?.();
      else if (state.healthTab === "uptime") window.UptimeWatch.after();
      else {
        if (!lc.started) startLinks();
        paintLinkProgress();
      }
    }
    document.title = `${state.route === "settings" ? t("Settings") : t(NAV.find((n) => n.id === state.route)?.label || "Today")} · SEO Command Center`;
    store.set("look", state.look); store.set("theme", state.theme); store.set("lang", state.lang);
    syncUrl();
    if (state.route === "today") refreshSetup();
    if (state.route === "backlinks") backlinksWanted();
    if (state.route === "settings") window.KW_REAL?.wanted?.();
  }
  /* A column heading that names a metric gets its definition (shared-ui.js), on every screen: on the heading's sort button
     if it has one, or as a small (i) after its words. Written once, so every table explains the same number the same way. */
  function defineHeaders(scope) {
    const UIx = window.UI;
    if (!UIx?.defKey) return;
    [...scope.querySelectorAll("table.data thead th")].forEach((th) => {
      if (th.querySelector(".def-i, [data-tip]") || th.dataset.tip) return;
      const key = UIx.defKey(th.textContent.replace(/\s+/g, " ").trim());
      if (!key) return;
      const button = th.querySelector("button");
      if (button) button.dataset.tip = UIx.def(key);
      else th.append(fragment(UIx.defIcon(key)));
    });
  }
  /* Every table gets a name for assistive tools: its card's heading, or the page title (WCAG 1.3.1). */
  function nameTables(scope) {
    [...scope.querySelectorAll("table.data:not([aria-label]):not([aria-labelledby])")].forEach((table) => {
      if (table.querySelector("caption")) return;
      const card = table.closest(".card, section, .panel");
      const heading = card?.querySelector(".card-head h2, h2, h3") || document.querySelector("#topbar h1");
      const tab = card?.querySelector('[role="tab"][aria-selected="true"]');
      const name = [heading?.textContent.trim(), tab?.textContent.trim()].filter(Boolean).join(" · ");
      if (name) table.setAttribute("aria-label", name);
    });
  }
  const syncTopbar = () => { const bar = $("#topbar"); if (bar) root.style.setProperty("--topbar-h", bar.offsetHeight + "px"); };
  addEventListener("resize", () => { syncTopbar(); placeInks({ instant: true }); updateCues(); });
  // Only the menu is redrawn, so resizing the window never disturbs the page or an open form.
  const syncRail = () => {
    const rail = wantsRail();
    if (rail === state.rail) return;
    state.rail = rail;
    $("#app").classList.toggle("rail", rail);
    renderSidebar();
    syncTopbar();
    placeInks({ instant: true });
    updateCues();
  };
  railWidth.addEventListener("change", syncRail);
  drawerWidth.addEventListener("change", syncRail);

  // ---- the address: screen, tab, one thing on it, and the site ------------------------
  /* #competitors/pairs/12?site=shop.example. Back goes back, and an address can be sent to a teammate. */
  let urlReady = false, wantedSite = null, replaceNext = false, following = false;
  function urlNow() {
    const parts = [state.route];
    if (state.route === "competitors") { parts.push(COMP.currentTab?.()?.id || COMP.tab); const pair = COMP.siteId === COMP.ALL ? null : COMP.pairShown?.(); if (pair) parts.push(pair); }
    if (state.route === "health") parts.push(state.healthTab);
    if (state.route === "backlinks") parts.push(state.blSection === "done" ? state.blTab : state.blSection);
    const host = state.site === "all" ? null : window.SITES.find((s) => s.id === state.site)?.host;
    const path = parts.filter((x) => x !== undefined && x !== null && x !== "").map((x) => encodeURIComponent(x)).join("/");
    // After the site: the dates on a dated screen (left out when they're the default), then the screen's own view.
    const q = new URLSearchParams();
    if (host) q.set("site", host);
    if (DATED_SCREENS.has(state.route) && !UIRange.isDefault()) {
      const r = state.rng;
      if (r.preset === "custom") { q.set("from", r.from); q.set("to", r.to); } else q.set("range", r.preset);
      if (r.compare !== "prev") q.set("cmp", r.compare);
    }
    Object.entries(screenAddress()).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "" && v !== false) q.set(k, String(v)); });
    const qs = q.toString().replace(/%2F/g, "/").replace(/%3A/g, ":");
    return `#${path}${qs ? `?${qs}` : ""}`;
  }
  /* The view itself, so a reload or a pasted link opens the same thing: Keywords' chip, engine, view and sort here; each screen
     file adds its own with SCREENS[route].address() and reads it back with SCREENS[route].fromAddress(params). */
  const SORTS = new Set(["k", "own", "pos", "chg", "vol"]);
  function screenAddress() {
    const out = {};
    if (state.route === "keywords") {
      if (state.filter !== "all") out.chip = state.filter;
      if (state.engine !== "google") out.engine = state.engine;
      if (state.view !== "positions") out.view = state.view;
      if (state.sort.key !== "vol" || state.sort.dir !== "descending") out.sort = `${state.sort.key}-${state.sort.dir === "ascending" ? "up" : "down"}`;
    }
    try { Object.assign(out, window.SCREENS?.[state.route]?.address?.() || {}); } catch (err) { console.error(err); }
    return out;
  }
  function applyScreenAddress(route, q) {
    if (route === "keywords") {
      const chip = q.get("chip"), engine = q.get("engine"), view = q.get("view"), sort = q.get("sort");
      state.filter = ["all", "top3", "top10", "up", "down", "none", "cited", "two"].includes(chip) ? chip : "all";
      state.engine = [...ENGINES.map(([id]) => id), "all"].includes(engine) ? engine : "google";
      state.view = ["positions", "bucket", "queries"].includes(view) ? view : "positions";
      const [key, dir] = (sort || "").split("-");
      state.sort = SORTS.has(key) ? { key, dir: dir === "up" ? "ascending" : "descending" } : { key: "vol", dir: "descending" };
    }
    try { window.SCREENS?.[route]?.fromAddress?.(q); } catch (err) { console.error(err); }
  }
  /* A new screen or tab is a step Back can return to. A change of site only updates the address. */
  function syncUrl() {
    if (!urlReady) return;
    const now = urlNow(), was = location.hash;
    const host = state.site === "all" ? null : window.SITES.find((s) => s.id === state.site)?.host;
    if (host) store.set("lastSite", host);
    if (now === was) return;
    // Only a step inside the same screen can be replaced: never the screen someone came from.
    const sameScreen = now.split("/")[0].split("?")[0] === was.split("/")[0].split("?")[0];
    const place = history[now.split("?")[0] === was.split("?")[0] || (replaceNext && sameScreen) ? "replaceState" : "pushState"];
    replaceNext = false;
    place.call(history, null, "", location.pathname + location.search + now);
  }
  function applySite(host) {
    // Someone given one site works on that site: there is no "All sites" for them.
    if (!host && window.ACCESS?.limited && window.SITES.length === 1) host = window.SITES[0].host;
    if (!host) { state.site = "all"; wantedSite = null; return; }
    const found = window.SITES.find((s) => s.host === host);
    if (found) { state.site = found.id; wantedSite = null; } else wantedSite = host; // a real site joins the list a moment after loading
  }
  function applyUrl() {
    const [path, query = ""] = location.hash.replace(/^#/, "").split("?");
    const [route, ...rest] = path.split("/").map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
    if (!BUILT.has(route)) return false;
    state.route = route;
    if (route === "competitors" && rest[0]) {
      const tab = COMP.tabs.find((x) => x.id === rest[0]);
      if (tab) { COMP.tab = rest[0]; tab.loadedFor = undefined; }
      if (tab && rest[0] !== "summary") COMP.tabFromAddress = true;
      COMP.showPair?.(rest[0] === "pairs" && rest[1] ? Number(rest[1]) : null);
    }
    if (route === "health" && ["test", "links", "uptime"].includes(rest[0])) state.healthTab = rest[0];
    if (route === "backlinks") {
      if (rest[0] === "consideration" || rest[0] === "todo") state.blSection = rest[0];
      else { state.blSection = "done"; if (["all", "mediators", "found"].includes(rest[0])) state.blTab = rest[0]; }
    }
    const q = new URLSearchParams(query);
    applySite(q.get("site"));
    // Dates named in the address win over the ones kept in this browser, and are kept from now on.
    if (q.get("from") || q.get("range") || q.get("cmp")) {
      const named = q.get("from") && q.get("to") ? { preset: "custom", from: q.get("from"), to: q.get("to") } : { preset: q.get("range") || state.rng.preset, from: state.rng.from, to: state.rng.to };
      state.rng = cleanRange({ ...named, compare: q.get("cmp") || "prev" });
      store.set("range", JSON.stringify(state.rng));
    }
    applyScreenAddress(route, q);
    return true;
  }
  /* Which site a screen with no site chosen shows: the last one used here, or the oldest, so a new empty site doesn't take over. */
  function preferredSite(list) {
    const last = store.get("lastSite");
    return list.find((s) => s.host === last) || [...list].sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))[0] || null;
  }

  // Chosen access (access.js): a section they weren't given is never drawn, whatever the address or link says.
  const mayOpen = (route) => !window.ACCESS || ACCESS.can(route);
  function noAccessPage() {
    const admin = (window.BOOT?.team || [])[0];
    return `<div class="content page-enter"><div class="card no-access" role="status">
      <h1 class="no-access-title">${t("You don't have access to this section")}</h1>
      <p class="sec">${admin ? esc(t("Ask {name} if you need it.").replace("{name}", admin)) : t("Ask an admin if you need it.")}</p>
      <p><button class="btn primary" data-go="${ACCESS.first()}">${t("Go to my first section")}</button></p></div></div>`;
  }
  function go(route, opts = {}) {
    if (!BUILT.has(route)) { toast(t("Not built yet"), { kind: "info" }); return; }
    if (!mayOpen(route)) { toast(t("You don't have access to this section"), { kind: "info" }); return; }
    closeNav();
    closePanel();
    state.route = route;
    render({ enter: true, keepScroll: false });
    $("#main").scrollTop = 0;
    if (!opts.noFocus) $("#main").focus({ preventScroll: true });
  }

  function simulateLoad(after) {
    const main = $("#main");
    main.classList.add("is-loading");
    $$(".tiles").forEach((x) => x.classList.add("is-updating"));
    setTimeout(() => {
      main.classList.remove("is-loading");
      $$(".tiles").forEach((x) => x.classList.remove("is-updating"));
      after();
      $$(".tile").forEach((x) => x.classList.add("fresh"));
    }, 520);
  }

  // ---- toasts and tooltips ------------------------------------------------------
  function toast(message, { kind = "good", undo = null, undoLabel = "", stay = false } = {}) {
    // Raw server or browser words ("Internal Server Error", "Failed to fetch", "Too Many Requests") become a plain sentence.
    if (kind === "crit" && typeof message === "string" && window.UI?.errorWords) message = window.UI.errorWords(message);
    const wrap = $("#toasts");
    // The same words twice would only be noise: the new one replaces the old one.
    [...wrap.children].forEach((old) => { if (old.dataset.words === message) old.remove(); });
    while (wrap.children.length >= 3) wrap.firstElementChild.remove();
    const el = document.createElement("div");
    el.className = "toast";
    el.dataset.words = message;
    const ic = kind === "crit" ? icon("octagon-alert", "crit") : kind === "info" ? icon("info", "sec") : icon("circle-check", "good");
    setHTML(el, `${ic}<span>${esc(message)}</span><span class="acts">${undo ? `<button class="link-btn" data-undo>${undoLabel || t("Undo")}</button>` : ""}<button class="icon-btn" style="width:20px;height:20px" aria-label="${t("Close")}" data-dismiss>${icon("x")}</button></span>`);
    el.style.setProperty("--life", `${undo ? 8000 : 4000}ms`);
    wrap.append(el);
    const leave = () => { el.classList.add("leaving"); setTimeout(() => el.remove(), 130); };
    el.querySelector("[data-dismiss]").onclick = leave;
    if (undo) el.querySelector("[data-undo]").onclick = () => { undo(); leave(); };
    if (!stay) setTimeout(leave, undo ? 8000 : 4000);
    return el;
  }

  let tipEl = null, tipTimer = null;
  function showTip(target) {
    hideTip();
    tipTimer = setTimeout(() => {
      if (!target.isConnected) return;
      tipEl = document.createElement("div");
      tipEl.className = "tooltip"; tipEl.setAttribute("role", "tooltip"); tipEl.textContent = target.dataset.tip; window.BRANDS.mark(tipEl);
      document.body.append(tipEl);
      const box = target.getBoundingClientRect(), tb = tipEl.getBoundingClientRect();
      if (target.closest(".app.rail .sidebar")) {
        // Beside the icon, so it never covers its neighbours in the collapsed menu.
        tipEl.style.left = box.right + 6 + "px";
        tipEl.style.top = Math.max(40, box.top + box.height / 2 - tb.height / 2) + "px";
        return;
      }
      tipEl.style.left = Math.max(8, Math.min(box.left + box.width / 2 - tb.width / 2, innerWidth - tb.width - 8)) + "px";
      tipEl.style.top = (box.top - tb.height - 6 > 40 ? box.top - tb.height - 6 : box.bottom + 6) + "px";
    }, 300);
  }
  function hideTip() { clearTimeout(tipTimer); if (tipEl) { tipEl.remove(); tipEl = null; } }
  // A tick box's whole cell takes the click, so the target is the cell (36 px and more), not the 17 px box (WCAG 2.5.8).
  document.addEventListener("click", (e) => {
    const cell = e.target.closest?.(".chk-cell, .ov-pick-col");
    if (!cell || e.target.closest("input, label, button, a")) return;
    const box = cell.querySelector('input[type="checkbox"]:not(:disabled)');
    if (box) { e.preventDefault(); e.stopPropagation(); box.click(); }
  }, true);
  // Esc closes a tooltip first, and only that (WCAG 1.4.13). A second Esc does what it did before.
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && tipEl) { hideTip(); e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  document.addEventListener("mouseover", (e) => { const el = e.target.closest?.("[data-tip]"); if (el) showTip(el); });
  document.addEventListener("mouseout", (e) => { if (e.target.closest?.("[data-tip]")) hideTip(); });
  document.addEventListener("focusin", (e) => { const el = e.target.closest?.("[data-tip]"); if (el && el.matches(":focus-visible")) showTip(el); });
  document.addEventListener("focusout", hideTip);

  // ---- side panel ----------------------------------------------------------------
  let panelOpener = null;
  // A form closed by accident keeps what was typed: it comes back as a draft when reopened.
  let panelForm = null;
  const drafts = new Map();
  // API keys are never kept in drafts.
  const formFields = (form) => [...form.elements].filter((el) => el.matches("input:not([type=password]):not([type=file]), select, textarea"));
  const isTick = (el) => el.type === "checkbox" || el.type === "radio";
  const readForm = (form) => ({ values: formFields(form).map((el) => (isTick(el) ? el.checked : el.value)), open: [...form.querySelectorAll("details")].map((d) => d.open) });
  const typedInPanel = () => {
    const form = panelForm && $("#panel form");
    if (!form) return null;
    const now = readForm(form);
    return JSON.stringify(now.values) === JSON.stringify(panelForm.initial.values) ? null : now;
  };
  function keepDraft() {
    if (!panelForm) return false;
    const typed = typedInPanel();
    if (typed) drafts.set(panelForm.key, typed); else drafts.delete(panelForm.key);
    return Boolean(typed);
  }
  const forgetPanelForm = () => { if (panelForm) drafts.delete(panelForm.key); panelForm = null; };
  let draftNotice = null;
  const draftToast = (reopen) => { draftNotice = toast(t("Draft kept"), { kind: "info", undo: reopen, undoLabel: t("Reopen") }); };

  function openPanel(html, opener, formInfo = null) {
    if (keepDraft()) draftToast(panelForm.reopen);
    panelOpener = opener || document.activeElement;
    // Named after what it holds (its title), not "Detail" whatever it is. A dialog that isn't modal: there is no backdrop and
    // the page beside it still works (a row can be read while its panel is open), so aria-modal is false and focus isn't
    // trapped. Tab past either end of the panel goes back to what opened it (keydown below), never off into the browser.
    setHTML($("#panel-root"), `<aside class="panel fresh ${formInfo?.wide ? "wide" : ""}" id="panel" role="dialog" aria-modal="false" tabindex="-1" aria-labelledby="panel-title">${html}</aside>`);
    const opened = $("#panel");
    if (!$("#panel-title")) { const h = opened.querySelector("h2, h3"); opened.removeAttribute("aria-labelledby"); opened.setAttribute("aria-label", h?.textContent.trim() || t("Detail")); }
    setTimeout(() => opened.classList.remove("fresh"), 800);
    panelForm = null;
    // Only a panel that asks to keep a draft (a key) and holds a form is read, so { wide: true } alone just opens wide.
    const form = formInfo?.key != null ? $("#panel form") : null;
    if (form) {
      panelForm = { ...formInfo, initial: readForm(form) };
      const draft = drafts.get(formInfo.key);
      if (draft) {
        draftNotice?.remove(); draftNotice = null; // the form is back, so "Reopen" no longer means anything
        formFields(form).forEach((el, i) => { if (isTick(el)) el.checked = draft.values[i]; else el.value = draft.values[i]; });
        form.querySelectorAll("details").forEach((d, i) => { d.open = draft.open[i]; });
        form.prepend(fragment(`<div class="note draft-note" role="status">${icon("info")}<span>${t("Draft restored")}</span><button type="button" class="link-btn" id="draft-clear">${t("Start over")}</button></div>`));
      }
    }
    placeInks();
    formInfo?.after?.();
    const first = $("#panel [data-autofocus]") || $("#panel");
    first.focus({ preventScroll: true });
  }
  function closePanel({ keep = true } = {}) {
    const panel = $("#panel");
    if (!panel) return;
    if (keep && keepDraft()) draftToast(panelForm.reopen);
    panelForm = null;
    // Leave the field while it is still on the page, so what it does on leaving happens: a note written in the Notes panel
    // joins its list then. Removed first, its "left the field" never came and the note stayed out of the list until a reload.
    if (panel.contains(document.activeElement)) document.activeElement.blur();
    panel.classList.add("closing");
    if (!following) syncUrl(); // an open item named in the address (a keyword) leaves it
    $$("tr.open").forEach((r) => r.classList.remove("open"));
    const opener = panelOpener;
    // A redraw may have replaced what opened the panel. Find its twin, or the keyboard falls back to the top of the page.
    const twin = opener && !opener.isConnected ? [...opener.attributes].find((a) => a.name === "id" || (a.name.startsWith("data-") && a.value)) : null;
    setTimeout(() => {
      if ($("#panel") !== panel) return; // another panel opened meanwhile
      $("#panel-root").replaceChildren();
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
      else if (twin) $(twin.name === "id" ? `#${CSS.escape(twin.value)}` : `[${twin.name}="${CSS.escape(twin.value)}"]`)?.focus({ preventScroll: true });
    }, reduceMotion() ? 0 : 120);
  }
  /* Asks before something that can't be undone. Resolves true on the danger button, false on Cancel, Escape or the close mark.
     UI.confirmDanger({ title, body, yes: "Remove" }) */
  function confirmDanger({ title, body = "", yes = "Delete" }) {
    const dlg = $("#dlg"), back = document.activeElement;
    if (!dlg) return Promise.resolve(window.confirm(`${title} ${body}`.trim()));
    dlg.classList.remove("wide");
    setHTML(dlg, `<div class="dlg-head"><h2 id="dlg-title">${esc(title)}</h2><button class="icon-btn" data-close-dlg aria-label="${t("Close")}">${icon("x")}</button></div>${body ? `<div class="dlg-body"><p>${esc(body)}</p></div>` : ""}<div class="dlg-foot"><button class="btn" data-close-dlg data-autofocus>${t("Cancel")}</button><button class="btn btn-danger" data-dlg-yes>${icon("trash-2")}${esc(yes)}</button></div>`);
    return new Promise((done) => {
      let said = false;
      const yesBtn = dlg.querySelector("[data-dlg-yes]");
      yesBtn.addEventListener("click", () => { said = true; dlg.close(); }, { once: true });
      dlg.addEventListener("close", () => { done(said); if (back?.isConnected) back.focus({ preventScroll: true }); }, { once: true });
      dlg.showModal();
      dlg.querySelector("[data-autofocus]")?.focus();
    });
  }
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  document.addEventListener("keydown", (e) => {
    const panel = $("#panel");
    if (e.key !== "Tab" || !panel || !panel.contains(document.activeElement)) return;
    const stops = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    const edge = e.shiftKey ? stops[0] : stops[stops.length - 1];
    const leaving = !stops.length || document.activeElement === edge || (e.shiftKey && document.activeElement === panel);
    if (!leaving || !panelOpener?.isConnected) return;
    e.preventDefault();
    panelOpener.focus({ preventScroll: true });
  });
  const panelHead = (title, sub = "", lead = "") => `<div class="panel-head">${lead}<div><h2 dir="auto" id="panel-title">${esc(title)}</h2>${sub ? `<div class="sub" ${lead ? 'dir="auto"' : ""}>${sub}</div>` : ""}</div><button class="icon-btn" data-close-panel aria-label="${t("Close")}">${icon("x")}</button></div>`;

  function rankChart(row, engine) {
    const values = row.trend.slice(-window.DATES.length);
    if (values.length < 2) return `<p class="note">${icon("info")}<span>${t("Needs 2 checks, same tool")}</span></p>`;
    const w = 440, h = 160, left = 26, right = 8, top = 10, bottom = 28;
    const labels = window.DATES.slice(-values.length);
    const hi = Math.max(...values) + 1;
    const x = (i) => left + (i / (values.length - 1)) * (w - left - right);
    const y = (v) => top + ((v - 1) / (hi - 1)) * (h - top - bottom);
    const ticks = [...new Set([1, Math.round((hi + 1) / 2), hi])];
    const path = smooth(values.map((v, i) => [x(i), y(v)]));
    const tool = row.res[engine].tool;
    const dots = values.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="var(--series-1)" stroke="var(--panel-solid)" stroke-width="2" data-tip="${labels[i]}: #${v} · ${esc(tool)}"/>`).join("");
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${t("Position history")}: ${values.map((v, i) => `${labels[i]} #${v}`).join(", ")}">
      ${ticks.map((v) => `<line x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("")}
      ${labels.map((d, i) => `<text x="${x(i)}" y="${h - 6}" text-anchor="${i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}">${d}</text>`).join("")}
      <path class="chart-line" d="${path}"/>${dots}</svg>
      <div class="legend" style="margin-top:6px"><span>${logo(tool, 14)} ${esc(t(tool))}</span></div>`;
  }

  const creditsLeftOf = (name) => { const tool = window.TOOLS.find((x) => x.name === name); return tool && tool.connected && tool.left !== null && tool.left !== undefined ? tool.left : null; };
  function keywordPanel(row, showTable = false) {
    const e = engineOf();
    const engineName = ENGINES.find(([id]) => id === e)[1];
    const r = row.res[e];
    const statusOf = (x) => x.flag === "suspect" ? status("warn", t("Suspect result")) : x.flag === "differs" ? status("warn", `${t("Differs by")} ${Math.abs(x.p - row.tools[0].p)}`) : x.flag === "tool-changed" ? `<span class="small sec">${t("tool changed")}</span>` : x.age === null ? "" : status("good", t("OK"));
    // Every connected tool that covers this engine is listed, so any keyword can be checked with a second tool.
    window.TOOLS.filter((x) => x.connected && x.engines.includes(e) && !row.tools.some((y) => y.tool === x.name)).forEach((x) => row.tools.push({ tool: x.name, p: null, age: null }));
    const toolRows = row.tools.map((x, i) => `<tr><td class="nowrap">${logo(x.tool, 16)} ${esc(t(x.tool))}</td><td>${x.age === null ? '<span class="muted">—</span>' : posBadge(x)}</td><td class="sec small">${x.age === null ? t("never") : days(x.age)}</td><td>${statusOf(x)}</td><td class="r"><button class="btn btn-small" data-recheck="${i}">${x.age === null ? t("Check") : t("Refresh")}</button>${creditsLeftOf(x.tool) === null ? "" : `<span class="second">${num(creditsLeftOf(x.tool))} ${t("left")}</span>`}</td></tr>`).join("");
    const values = row.trend.slice(-window.DATES.length);
    const labels = window.DATES.slice(-values.length);
    const chart = showTable
      ? `<table class="mini"><thead><tr><th>${t("Date")}</th><th>${t("Position")}</th><th>${t("Tool")}</th></tr></thead><tbody>${values.map((v, i) => `<tr><td>${labels[i]}</td><td class="pos">#${v}</td><td>${esc(r.tool)}</td></tr>`).join("")}</tbody></table>`
      : rankChart(row, e);
    const ownName = OWN_TOOL[e];
    const own = row.own[e];
    return `${panelHead(row.k, `${engineName} · France · Desktop`)}
      <div class="panel-body">
        <div class="kv">
          ${ownName ? `<div><div class="k">${ownName}</div><div class="v">${own === null ? '<span class="muted">—</span>' : dec(own)}${own === null ? "" : ` <span class="small muted" style="font-weight:400">${t("average")}</span>`}</div></div>` : ""}
          <div><div class="k">${t("Page")}</div><div class="mono small" style="margin-top:6px;overflow-wrap:anywhere">${row.page ? PageLink.html(row.page, { host: row.site }) : "—"}</div></div>
        </div>
        ${window.UI.relatedTasks({ host: row.site || "", keyword: row.k, page: row.page || "" })}
        <h3>${t("Results")} · France</h3>
        <table class="mini" id="tool-table"><thead><tr><th>${t("Tool")}</th><th>${t("Position")}</th><th>${t("Checked")}</th><th>${t("Status")}</th><th><span class="sr">${t("Action")}</span></th></tr></thead><tbody>${toolRows}</tbody></table>
        <h3>${t("Other locations")}</h3>
        <table class="mini"><tbody><tr><td>Browser (Mac, UAE)</td><td class="pos">#${Math.max(1, (r.p || 11) - 3)}</td><td class="sec small">${days(5)}</td><td class="sec small">${t("Not compared with France")}</td></tr></tbody></table>
        <h3>${t("Position history")} ${values.length >= 2 ? `<button class="link-btn end" id="chart-toggle">${t(showTable ? "Chart" : "Table")}</button>` : ""}</h3>
        <p class="small muted" style="margin-bottom:6px">${t("1 = top. One dot per check.")}</p>
        ${chart}
        <h3>${t("Competitors on this page")}</h3>
        <table class="mini"><thead><tr><th scope="col">${t("Position")}</th><th scope="col">${t("Website")}</th><th scope="col" class="r">${t("Change")}</th></tr></thead><tbody>${window.COMPETITORS_ON_PAGE.map(([host, pos, c]) => `<tr><td class="pos" style="width:40px">#${pos}</td><td class="mono small">${esc(host)}</td><td class="r">${c ? `<span class="chg ${c > 0 ? "good" : "crit"}">${icon(c > 0 ? "arrow-up" : "arrow-down")}${Math.abs(c)}</span>` : '<span class="muted">0</span>'}</td></tr>`).join("")}</tbody></table>
        <h3>${t("AI Overview")}</h3>
        ${aiCell(row)}
      </div>
      <div class="panel-foot">${window.UI.taskButton(keywordFind(row), { cls: "btn" })}</div>`;
  }

  function openKeyword(k, opener) {
    const row = window.KEYWORDS.find((x) => x.k === k);
    if (!row) return;
    state.panelKw = k; state.panelTable = false;
    openPanel(keywordPanel(row), opener);
    $$("tr.open").forEach((r) => r.classList.remove("open"));
    const tr = $$("#kw-table tbody tr").find((r) => r.dataset.kw === k);
    if (tr) tr.classList.add("open");
  }

  function refreshKeywordPanel() {
    const open = $("#panel");
    const row = window.KEYWORDS.find((k) => k.k === state.panelKw);
    if (!open || !row) return;
    const scroll = $(".panel-body", open).scrollTop;
    setHTML(open, keywordPanel(row, state.panelTable));
    $(".panel-body", open).scrollTop = scroll;
  }

  function diffPanel(id, opener) {
    const ch = window.CHANGES.find((c) => c.id === id);
    const d = ch.diff;
    const lines = d.text.map(([kind, text]) => `<div class="ln ${kind}"><span class="mk" aria-label="${kind === "add" ? "Added" : kind === "del" ? "Removed" : "Unchanged"}">${kind === "add" ? "+" : kind === "del" ? "−" : ""}</span><span ${d.rtl ? 'dir="rtl"' : 'dir="auto"'}>${esc(text)}</span></div>`).join("");
    openPanel(`${panelHead(ch.who, `${PageLink.html(ch.page, { host: ch.who, cls: "mono" })} · ${ch.when}`)}
      <div class="panel-body">
        <h3>${t(ch.kind)}</h3>
        ${d.title ? `<div class="diff"><div class="ln del"><span class="mk" aria-label="Removed">−</span><span>${esc(d.before)}</span></div><div class="ln add"><span class="mk" aria-label="Added">+</span><span>${esc(d.after)}</span></div></div>` : ""}
        <h3>${t("Page text")} <span class="end small muted">${t("Words")}: ${d.words[0]} → ${d.words[1]}</span></h3>
        <div class="diff">${lines}</div>
      </div>
      <div class="panel-foot">${window.UI.taskButton(changeFind(ch), { cls: "btn btn-main" })}${PageLink.href(ch.page, ch.who) ? `<a class="btn" href="${esc(PageLink.href(ch.page, ch.who))}" target="_blank" rel="noopener noreferrer">${icon("external-link")}${t("Open page")}</a>` : ""}</div>`, opener);
  }

  function backlinkPanel(b, opener) {
    const label = LABELS[b.label];
    const unit = state.lang === "fr" ? "j" : "d";
    const traffic = b.label === "no-ga4"
      ? `<p class="note">${icon("info")}<span>${t("GA4 not connected")}</span></p>`
      : label ? `<p class="small sec"><span class="tag">${label[0]}</span> ${t(label[1])}</p>` : `<p class="small sec">${t("No visits yet. Links hiding their source count as Direct.")}</p>`;
    const trafficValue = b.label === "no-ga4" ? '<span class="muted">—</span>' : `<span class="tabular">${num(b.visits)}</span> ${t(b.visits === 1 ? "visit" : "visits")} · <span class="tabular">${num(b.leads)}</span> ${t(b.leads === 1 ? "lead" : "leads")}`;
    const sampleEffect = b.before === null || b.before === undefined ? null : {
      value: `<span class="tabular">${num(b.before)} → ${num(b.after)}</span> ${t("clicks")}`,
      body: `<p class="small sec">${t("Target page clicks")} · 30 ${unit} ${t("before")} / ${t("after")}</p><p class="small muted vd-from">${t("Timing only, not proof the link caused it.")}</p>`,
    };
    // Only what has a value, so a link with one field isn't a page of dashes. Any language keeps its direction.
    const fact = (label, value, { cls = "", style = "" } = {}) => (value ? `<tr><td class="sec">${t(label)}</td><td class="${cls}" dir="auto" style="overflow-wrap:anywhere;${style}">${esc(value)}</td></tr>` : "");
    const utm = b.utm ? fact("Source", b.utm.source, { cls: "mono" }) + fact("Medium", b.utm.medium, { cls: "mono" }) + fact("Campaign", b.utm.campaign, { cls: "mono" }) : "";
    const check = bl.server ? window.LinkExtras.checkBlock(b, { linkStatus }) : `<p class="small sec" id="check-result">${b.status === "live" ? t("Checked today: live, follow, same anchor") : ""}</p><button class="btn btn-small" id="check-now">${t("Check now")}</button>`;
    const details = `<table class="mini"><tbody>
          ${fact("Site", b.site, { cls: "mono small" })}
          ${fact("Anchor text", b.anchor)}
          ${fact("Anchor type", window.BacklinkSeo.anchorWord(b))}
          ${b.keyword ? `<tr><td class="sec">${t("Keyword")}</td><td style="overflow-wrap:anywhere">${KeywordLink.html(b.keyword, { host: b.site })}</td></tr>` : ""}
          ${fact("Link type", b.linkType)}
          ${fact("Mediator", b.mediator)}
          ${fact("Contact", b.contact)}
          ${fact("Platform", b.platform)}
          ${fact("Price", b.priceText || (b.cost ? money(b.cost) : ""))}
          ${fact("Owner", b.owner)}
          ${fact("Date placed", b.placed)}
          ${fact("Due date", b.due)}
          ${fact("Renewal date", b.renewal)}
          ${fact("Notes", b.notes, { style: "white-space:pre-wrap" })}
        </tbody></table>`;
    const pagePath = b.src.replace(/^https?:\/\/[^/]+/, "") || "/";
    openPanel(`${panelHead(linkDomain(b.src), `<span class="vd-head-line">${PageLink.html(b.src, { text: pagePath, cls: "mono" })}</span><span class="vd-head-line">→ ${b.target ? PageLink.html(b.target, { host: b.site, cls: "mono" }) : "—"}</span>`, siteLogo(linkDomain(b.src), 34))}
      <div class="panel-body">
        ${window.BacklinkSeo.panelBlocks(b, { server: bl.server, linkStatus, check, traffic: traffic + (utm ? `<table class="mini"><tbody>${utm}</tbody></table>` : ""), trafficValue, sampleEffect, details, anchor: b.anchor || b.check?.anchor })}
        ${b.serverId ? window.UI.relatedTasks({ host: b.site || "", item: { kind: "backlink", ref: b.serverId } }) : ""}
      </div>
      <div class="panel-foot"><button class="btn btn-main" id="bl-edit" data-id="${esc(b.id)}">${icon("pencil")}${t("Edit")}</button>${window.UI.taskButton(backlinkFind(b), { cls: "btn" })}<button class="btn btn-ghost danger" id="bl-delete" data-id="${esc(b.id)}">${t("Delete")}</button></div>`, opener);
  }

  const LINK_TYPES = ["Guest post", "Directory", "Press", "Sponsored", "Forum", "Other"];

  function addBacklinkPanel(prefill = {}, opener) {
    const fold = (title, hint, inner, open = false) => `<details class="fold" ${open ? "open" : ""}><summary>${icon("chevron-right")}${t(title)}${hint ? `<span class="hint">${t(hint)}</span>` : ""}</summary><div style="padding-bottom:6px">${inner}</div></details>`;
    const fromProspect = prefill.prospect || "";
    const edit = prefill.edit || null; // the same form, filled in, when correcting a link already logged
    const had = (value) => esc(value || "");
    // A date typed some other way in a spreadsheet ("le 3 mars") stays as text: a date box would silently blank it.
    const dateBox = (id, value) => `<input class="input" id="${id}" type="${!value || /^\d{4}-\d{2}-\d{2}$/.test(value) ? "date" : "text"}" value="${had(value)}">`;
    const price = edit ? edit.priceText || (edit.cost ? String(edit.cost) : "") : "";
    const owners = [...new Set([...window.TEAM, ...(edit?.owner ? [edit.owner] : [])])];
    openPanel(`${panelHead(t(edit ? "Edit backlink" : "Add backlink"), edit ? "" : t(fromProspect ? "From In consideration; moves to Done when you save." : "Everything else is optional"))}
      ${fromProspect || edit ? "" : addModeSwitch("one")}
      <form class="panel-body" id="bl-form" data-prospect="${esc(fromProspect)}" data-edit="${edit ? esc(edit.id) : ""}" novalidate>
        <label class="field"><span>${t("Our site")} <span class="req">*</span></span>
          <select class="select" id="bl-site" style="width:100%">${siteOptions(pickedSite(prefill.site))}</select></label>
        <label class="field"><span>${t("Source page")} <span class="req">*</span></span>
          <input class="input mono" spellcheck="false" autocapitalize="off" autocomplete="off" id="bl-src" type="url" inputmode="url" placeholder="https://" value="${esc(prefill.src || "")}" ${fromProspect ? "" : "data-autofocus"} aria-describedby="bl-src-err"><div id="bl-src-err"></div></label>
        ${fold("Target", "optional", `
          <label class="field"><span>${t("Target page")}</span><input class="input mono" spellcheck="false" autocapitalize="off" autocomplete="off" id="bl-target" placeholder="/page/" value="${esc(prefill.target || "")}" ${fromProspect ? "data-autofocus" : ""}></label>
          <label class="field"><span>${t("Anchor text")}</span><input class="input" id="bl-anchor" dir="auto" value="${had(edit?.anchor)}"></label>
          <div class="field-row">
            <label class="field"><span>${t("Keyword")}</span><input class="input" id="bl-keyword" dir="auto" value="${had(edit?.keyword)}"></label>
            <label class="field"><span>${t("Anchor type")}</span><select class="select" id="bl-anchor-kind" style="width:100%">${window.BacklinkSeo.anchorOptions(edit?.anchorKind)}</select></label>
          </div>`, Boolean(prefill.target || fromProspect || edit?.anchor || edit?.keyword || edit?.anchorKind))}
        ${fold("Status and type", "optional", `
          <div class="field-row">
            <label class="field"><span>${t("Status")}</span><select class="select" id="bl-status" style="width:100%">${[["live", "Live "], ["lost", "Lost "], ["planned", "Planned"], ...(edit?.status === "nofollow" ? [["nofollow", "Nofollow"]] : [])].map(([value, word]) => `<option value="${value}" ${edit?.status === value ? "selected" : ""}>${t(word)}</option>`).join("")}</select></label>
            <label class="field"><span>${t("Link type")}</span><input class="input" id="bl-type" dir="auto" list="link-types" value="${had(edit?.linkType)}"><datalist id="link-types">${LINK_TYPES.map((name) => `<option value="${esc(t(name))}"></option>`).join("")}</datalist></label>
          </div>`, Boolean(edit))}
        ${fold("UTM in this link?", "optional", `
          <label class="field"><span>${t("Link as placed")}</span><input class="input mono" type="url" inputmode="url" spellcheck="false" autocapitalize="off" autocomplete="off" id="bl-paste" placeholder="https://site/page/?utm_source=…"><div id="bl-paste-note" class="help" role="status"></div></label>
          <div class="field-row">
            <label class="field"><span>${t("Source")}</span><input class="input mono" spellcheck="false" autocapitalize="off" autocomplete="off" id="bl-utm-source" value="${had(edit?.utm?.source)}"></label>
            <label class="field"><span>${t("Medium")}</span><input class="input mono" spellcheck="false" autocapitalize="off" autocomplete="off" id="bl-utm-medium" value="${had(edit?.utm?.medium)}"></label>
          </div>
          <label class="field"><span>${t("Campaign")}</span><input class="input mono" spellcheck="false" autocapitalize="off" autocomplete="off" id="bl-utm-campaign" value="${had(edit?.utm?.campaign)}"></label>
          <button type="button" class="btn btn-small" id="bl-generate">${t("Generate tagged link")}</button>
          <div id="bl-generated" class="help" style="overflow-wrap:anywhere" role="status"></div>`, Boolean(edit?.utm))}
        ${fold("Mediator", "optional", `
          <label class="field"><span>${t("Mediator")}</span><input class="input" id="bl-mediator" dir="auto" list="mediators" aria-describedby="bl-med-help" value="${had(edit?.mediator)}"><datalist id="mediators">${window.LinkExtras.names().map((m) => `<option value="${esc(m)}"></option>`).join("")}</datalist><div class="help" id="bl-med-help">${t("Pick a name or type a new one")}</div></label>
          <div class="field-row"><label class="field"><span>${t("Contact")}</span><input class="input" id="bl-contact" dir="auto" value="${had(edit?.contact)}"></label><label class="field"><span>${t("Platform")}</span><input class="input" id="bl-platform" dir="auto" value="${had(edit?.platform)}"></label></div>`, Boolean(edit?.mediator || edit?.contact || edit?.platform))}
        ${fold("Cost", "optional", `
          <div class="field-row"><label class="field"><span>${t("Price")}</span><input class="input" id="bl-cost" placeholder="150 €, AED 500" value="${esc(price)}"></label><label class="field"><span>${t("Owner")}</span><select class="select" id="bl-owner" style="width:100%"><option value="">—</option>${owners.map((n) => `<option ${n === edit?.owner ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label></div>
          <div class="field-row"><label class="field"><span>${t("Date placed")}</span>${dateBox("bl-placed", edit?.placed)}</label><label class="field"><span>${t("Due date")}</span>${dateBox("bl-due", edit?.due)}</label></div>
          <div class="field-row"><label class="field"><span>${t("Renewal date")}</span>${dateBox("bl-renewal", edit?.renewal)}</label></div>
          <label class="field"><span>${t("Notes")}</span><textarea class="input" id="bl-notes" rows="2" dir="auto">${had(edit?.notes)}</textarea></label>`, Boolean(price || edit?.owner || edit?.placed || edit?.due || edit?.renewal || edit?.notes))}
      </form>
      <div class="panel-foot"><button class="btn btn-main" id="bl-save">${t("Save")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener, { key: edit ? `backlink-edit|${edit.id}` : `backlink|${prefill.src || ""}`, reopen: () => addBacklinkPanel(prefill, opener) });
    window.BacklinkSeo.duplicateNote(); // a link from In consideration arrives with its address filled in
  }

  const addModeSwitch = (mode) => `<div class="panel-mode"><span class="seg" role="group" aria-label="${t("Add backlink")}"><button type="button" data-add-mode="one" aria-pressed="${mode === "one"}">${t("One link")}</button><button type="button" data-add-mode="bulk" aria-pressed="${mode === "bulk"}">${t("Import CSV")}</button></span></div>`;

  // ---- Filter a backlink CSV: only filters a file, and adds what the user keeps to In consideration ----
  let cleaner = null, prospectSeq = 0;
  const cleanerHead = () => `<div class="dlg-head"><h2 id="dlg-title">${t("Filter a backlink CSV")}</h2><button class="icon-btn" data-close-dlg aria-label="${t("Close")}">${icon("x")}</button></div>`;
  const cleanerNote = () => `<p class="prospect-note">${icon("info")}<span>${t(PROSPECT_NOTE)}</span></p>`;

  function openCleaner() {
    cleaner = { site: state.site === "all" ? window.SITES[0].host : siteName(), result: null, picked: new Set(), file: "", filter: { da: "", pa: "", spam: "" }, start: { stage: "new", rating: "", owner: "" } };
    $("#dlg").classList.add("wide");
    renderCleanerPick();
    $("#dlg").showModal();
    $("#cleaner-browse")?.focus();
  }

  function renderCleanerPick() {
    setHTML($("#dlg"), `${cleanerHead()}
      <div class="dlg-body">
        ${cleanerNote()}
        <label class="field"><span>${t("Prospects for")}</span><select class="select" id="cleaner-site" style="width:100%">${window.SITES.map((s) => `<option ${s.host === cleaner.site ? "selected" : ""}>${esc(s.host)}</option>`).join("")}</select></label>
        <div class="drop" id="cleaner-drop">${icon("filter")}<b>${t("Drop a CSV here")}</b><span>${t("or")} <button type="button" class="link-btn" id="cleaner-browse" style="font-size:inherit">${t("choose a file")}</button></span><span class="small">${t("SEMrush or Ubersuggest export, up to 10 MB.")}</span><input type="file" id="cleaner-file" accept=".csv,.tsv,.txt,text/csv" hidden></div>
        <div id="cleaner-error"></div>
        <ul class="clean-rules">
          <li>${t("Flags rows with spam score above 30 (shown, can't be added). Drops rows with no usable URL.")}</li>
          <li>${t("Flags domains already in In consideration, Done or Links you didn't add.")}</li>
          <li>${t("Nothing is added until you pick and confirm.")}</li>
        </ul>
        ${window.BOOT?.served ? "" : `<button type="button" class="link-btn" id="cleaner-sample">${t("Try a sample file")}</button>`}
      </div>
      <div class="dlg-foot"><button class="btn" data-close-dlg>${t("Cancel")}</button></div>`);
  }

  function cleanerErrorText(err) {
    if (err.code !== "missing_columns" || state.lang !== "fr") return t(err.message);
    const words = err.missing.map((m) => t(m === "backlink_url" ? "URL" : "spam score")).join(", ");
    return `${t("Missing columns")} : ${words}. ${t("Headers found")} : ${err.headers.join(", ")}.`;
  }

  const isFlaggedRow = (row) => row.spam_score !== null && row.spam_score !== undefined && row.spam_score > 30;
  function runCleaner(bytes, name, urlColumn = null) {
    try {
      // A file with no spam score is fine: every score is unknown. Spam is flagged and kept, never removed.
      cleaner.bytes = bytes; cleaner.name = name;
      cleaner.result = window.BacklinkCleaner.cleanCsv(bytes, knownDomains(cleaner.site), { needSpam: false, keepSpam: true, urlColumn });
      cleaner.file = name;
      cleaner.picked = new Set();
      cleaner.filter = { da: "", pa: "", spam: "" };
      renderCleanerResult();
    } catch (err) {
      if (!err.code) throw err;
      // Column names differ from tool to tool. If none is recognised, ask, rather than turning the file away.
      const headers = err.headers || err.missing_headers || [];
      const ask = err.code === "missing_columns" && headers.length ? `<label class="field" style="margin-bottom:10px"><span>${t("Which column holds the link?")}</span><select class="select" id="cleaner-url-col" style="width:100%"><option value="">${t("Choose a column")}</option>${headers.map((h, i) => `<option value="${i}">${esc(h)}</option>`).join("")}</select></label>` : `<div class="error" role="alert" style="margin-bottom:10px">${icon("octagon-alert")}<span>${esc(cleanerErrorText(err))}</span></div>`;
      setHTML($("#cleaner-error"), ask);
    }
  }

  async function loadCleanerFile(file) {
    if (!file || !cleaner) return;
    try {
      window.BacklinkCleaner.checkUpload(file.name, file.size);
    } catch (err) {
      setHTML($("#cleaner-error"), `<div class="error" role="alert" style="margin-bottom:10px">${icon("octagon-alert")}<span>${esc(cleanerErrorText(err))}</span></div>`);
      return;
    }
    runCleaner(new Uint8Array(await file.arrayBuffer()), file.name);
  }

  const cleanerMatches = (row) => atLeast(row.authority, cleaner.filter.da) && atLeast(row.page_authority, cleaner.filter.pa) && atMost(row.spam_score, cleaner.filter.spam);
  const cleanerSelectable = (row) => !isFlaggedRow(row) && cleanerMatches(row);
  const cleanerRowsHtml = () => cleaner.result.rows.map((row, i) => [row, i]).filter(([row]) => cleanerMatches(row)).slice(0, 200).map(([row, i]) => `<tr><td><input type="checkbox" class="chk" style="margin:0" data-cleaner-row="${i}" aria-label="${esc(row.url)}" ${isFlaggedRow(row) ? "disabled" : ""}></td><td class="mono" title="${esc(row.url)}">${esc(row.url.replace(/^https?:\/\//, ""))}</td><td class="mono">${esc(row.domain)}</td><td class="r tabular">${row.authority === null ? '<span class="muted">—</span>' : row.authority}</td><td class="r tabular">${isKnown(row.page_authority) ? row.page_authority : '<span class="muted">—</span>'}</td><td class="r">${spamText(row.spam_score)}</td><td>${dupFlag(row.duplicate_of)}</td></tr>`).join("");

  /* Only the rows and counts change, so someone typing a filter keeps their place. A tick on a row the filter hides goes too:
     what gets added is always what's on show. */
  function paintCleanerRows() {
    const { result: r, picked } = cleaner;
    [...picked].forEach((i) => { if (!cleanerMatches(r.rows[i])) picked.delete(i); });
    const matching = r.rows.filter(cleanerMatches), good = matching.filter((row) => !isFlaggedRow(row));
    setRows($("#cleaner-rows"), cleanerRowsHtml() || `<tr><td colspan="7"><div class="empty"><p>${t("No links match these filters")}</p></div></td></tr>`);
    $("#cleaner-select-all").textContent = `${t("Select all good ones")} (${num(good.length)})`;
    $("#cleaner-new-only").textContent = `${t("Select new links only")} (${num(good.filter((row) => !row.duplicate_of).length)})`;
    setHTML($("#cleaner-count"), `${num(matching.length)} ${t("of")} ${num(r.rows.length)}`);
    const more = $("#cleaner-more");
    more.hidden = matching.length <= 200;
    updateCleanerSelection();
  }

  function renderCleanerResult() {
    const r = cleaner.result;
    const stat = (label, value, note = "") => `<div class="clean-stat"><div class="lab">${t(label)}</div><div class="n tabular">${num(value)}</div>${note ? `<div class="small muted">${note}</div>` : ""}</div>`;
    const removedNote = r.removed_no_url ? `${num(r.removed_no_url)} ${t("no usable URL")}` : "";
    const number = (key, label) => `<label class="field"><span>${t(label)}</span><input class="input tabular" type="number" min="0" inputmode="numeric" data-cleaner-filter="${key}" value="${esc(cleaner.filter[key])}"></label>`;
    setHTML($("#dlg"), `${cleanerHead()}
      <div class="dlg-body">
        ${cleanerNote()}
        <div id="cleaner-save-error"></div>
        <div class="clean-sum">${stat("Total", r.total)}${stat("Kept", r.kept)}${stat("Flagged as spam", r.removed_spam || 0)}${stat("Left out", r.removed_no_url || 0, removedNote)}${stat("Duplicates", r.duplicates)}</div>
        <p class="small sec" style="margin-bottom:10px"><span class="mono">${esc(cleaner.file)}</span> · ${esc(r.source_label)} · ${t("for")} <span class="mono">${esc(cleaner.site)}</span>${r.unknown_spam ? ` · ${num(r.unknown_spam)} ${t("without spam score, kept as unknown")}` : ""}</p>
        ${r.kept ? `<div class="pr-filters clean-filters">${number("da", "Authority at least")}${number("pa", "Page authority at least")}${number("spam", "Spam at most")}<span class="pr-end small sec tabular" id="cleaner-count" role="status"></span></div>
        <div class="clean-tools"><button type="button" class="link-btn" id="cleaner-select-all"></button><button type="button" class="link-btn" id="cleaner-new-only"></button><button type="button" class="link-btn" id="cleaner-clear">${t("Clear")}</button></div>
        <div class="clean-table-wrap"><table class="bulk-table clean-table">
          <thead><tr><th style="width:34px"><input type="checkbox" class="chk" id="cleaner-all" style="margin:0" aria-label="${t("Select all")}"></th><th>${t("Source URL")}</th><th>${t("Domain")}</th><th class="r" ${r.authority_label ? `title="${esc(r.authority_label)}"` : ""}>DA</th><th class="r">PA</th><th class="r">${t("Spam score")}</th><th>${t("Duplicate")}</th></tr></thead>
          <tbody id="cleaner-rows"></tbody>
        </table><div class="bulk-more" id="cleaner-more" hidden>${t("First 200 shown; the Select buttons cover every kept row.")}</div></div>
        <fieldset class="scope clean-start"><legend>${t("For added links")}</legend>
          <label class="field"><span>${t("Status")}</span><select class="select" id="cleaner-start-stage">${PROSPECT_STAGES.map(([id, word]) => `<option value="${id}" ${cleaner.start.stage === id ? "selected" : ""}>${t(word)}</option>`).join("")}</select></label>
          <label class="field"><span>${t("Rating")}</span><select class="select" id="cleaner-start-rating">${ratingOptions(cleaner.start.rating, t("Not rated"))}</select></label>
          <label class="field"><span>${t("Owner")}</span><input class="input" id="cleaner-start-owner" value="${esc(cleaner.start.owner)}" dir="auto" maxlength="120"></label>
        </fieldset>`
        : `<p class="note">${icon("info")}<span>${t("No links left after filtering.")}</span></p>`}
      </div>
      <div class="dlg-foot"><button class="btn btn-ghost" id="cleaner-again" style="margin-right:auto">${t("Choose another file")}</button><button class="btn" data-close-dlg>${t("Cancel")}</button><button class="btn btn-main" id="cleaner-add" disabled>${t("Add to In consideration")}</button></div>`);
    if (r.kept) paintCleanerRows(); else updateCleanerSelection();
  }

  // Changing a tick only updates the counts, so focus stays where the user is.
  function updateCleanerSelection() {
    const n = cleaner.picked.size, total = cleaner.result.rows.filter(cleanerSelectable).length;
    $$("[data-cleaner-row]").forEach((b) => { b.checked = cleaner.picked.has(Number(b.dataset.cleanerRow)); });
    const all = $("#cleaner-all");
    if (all) { all.checked = n > 0 && n === total; all.indeterminate = n > 0 && n < total; }
    const add = $("#cleaner-add");
    add.disabled = !n;
    add.textContent = n ? `${t("Add")} ${num(n)} ${t("to In consideration")}` : t("Add to In consideration");
  }

  const cleanerStart = () => {
    const rating = $("#cleaner-start-rating")?.value;
    return { stage: $("#cleaner-start-stage")?.value || "new", rating: rating ? Number(rating) : null, owner: $("#cleaner-start-owner")?.value.trim() || "" };
  };
  /* On the real app the rows go to the server first, so what's on screen is what a reload brings back. */
  async function addPickedProspectsToServer() {
    const { result, picked, file, site } = cleaner;
    const add = $("#cleaner-add");
    add.disabled = true;
    add.textContent = t("Saving…");
    setHTML($("#cleaner-save-error"), "");
    const start = cleanerStart();
    const rows = [...picked].sort((a, b) => a - b).map((i) => ({ url: result.rows[i].url, authority: result.rows[i].authority, page_authority: result.rows[i].page_authority, spam_score: result.rows[i].spam_score, stage: start.stage, rating: start.rating, owner: start.owner || null }));
    const answer = await COMP.saveCsvProspects(bl.sites.find((s) => s.host === site)?.id, site, rows, file, result.authority_label);
    if (answer.failed && !answer.items.length) { // nothing was saved: the choices stay, so it can be tried again
      if ($("#cleaner-add")) updateCleanerSelection();
      // A toast would sit behind this window, so the message goes inside it.
      const say = $("#cleaner-save-error");
      if (say) setHTML(say, `<div class="error" role="alert" style="margin-bottom:10px">${icon("octagon-alert")}<span>${esc(t("Nothing was saved."))} ${esc(t(answer.failed.message))}</span></div>`);
      else toast(t(answer.failed.message), { kind: "crit" });
      return;
    }
    if ($("#dlg").open) $("#dlg").close();
    ignoreClicksUntil = performance.now() + 400; // the second half of a double click must not press what's underneath
    cleaner = null;
    prFilter = noProspectFilter(); prSort = null; window.TP.state(PR_PAGES).q = ""; window.TP.reset(PR_PAGES); // what was just added must be on show
    state.blSection = "consideration";
    render();
    answer.items.forEach((p) => $(`#prospect-${p.id}`)?.classList.add("flash"));
    if (answer.failed) { toast(`${num(answer.items.length)} ${t("saved")}. ${t("The rest wasn't saved. Add them again.")}`, { kind: "crit" }); return; }
    const n = answer.items.length, skipped = answer.skipped.length;
    const words = n ? `${num(n)} ${t(n === 1 ? "link added to In consideration" : "links added to In consideration")}` : t("Nothing new");
    toast(`${words}${skipped ? `. ${num(skipped)} ${t("skipped (one link per domain, no spam)")}` : ""}`, n ? { undo: async () => {
      try { await COMP.removeCsvProspects(answer.items); } catch (err) { toast(t(err.message), { kind: "crit" }); }
      render();
    } } : { kind: "info" });
  }

  function addPickedProspects() {
    if (bl.server) return addPickedProspectsToServer();
    const { result, picked, file, site } = cleaner;
    const start = cleanerStart();
    const added = [...picked].sort((a, b) => a - b).map((i) => {
      const row = result.rows[i];
      prospectSeq += 1;
      return { id: `p${prospectSeq}`, url: row.url, domain: row.domain, authority: row.authority, pageAuthority: row.page_authority, authorityLabel: result.authority_label, spam: row.spam_score, file, site, ...start };
    });
    prFilter = noProspectFilter(); prSort = null; window.TP.state(PR_PAGES).q = ""; window.TP.reset(PR_PAGES); // what was just added must be on show
    window.PROSPECTS = added.concat(window.PROSPECTS);
    $("#dlg").close();
    ignoreClicksUntil = performance.now() + 400; // the second half of a double click must not press what's underneath
    cleaner = null;
    state.blSection = "consideration";
    render();
    added.forEach((p) => $(`#prospect-${p.id}`)?.classList.add("flash"));
    const ids = new Set(added.map((p) => p.id));
    toast(`${num(added.length)} ${t(added.length === 1 ? "link added to In consideration" : "links added to In consideration")}`, { undo: () => {
      window.PROSPECTS = window.PROSPECTS.filter((p) => !ids.has(p.id));
      render();
    } });
  }

  // ---- bulk upload ---------------------------------------------------------------
  // The columns, the template and the checks live in bulk-links.js, so the tests can run them.
  const BULK_FIELDS = window.BulkLinks.FIELDS;
  let bulk = { headers: [], rows: [], map: [] };

  function readBulk(text) {
    const table = window.BulkLinks.readTable(text);
    if (!table.length) { bulk = { headers: [], rows: [], map: [] }; return; }
    const hasHeader = window.BulkLinks.looksLikeHeader(table[0]);
    const width = Math.max(...table.map((r) => r.length));
    const headers = hasHeader ? table[0] : Array.from({ length: width }, (_, i) => `${t("Column")} ${i + 1}`);
    const map = hasHeader ? window.BulkLinks.matchColumns(headers) : headers.map((_, i) => (i === 0 ? "src" : ""));
    // Keep what the person already matched by hand, if the columns are the same.
    if (bulk.headers.join("|") === headers.join("|")) bulk.map.forEach((m, i) => { map[i] = m; });
    bulk = { headers, map, rows: hasHeader ? table.slice(1) : table };
  }

  function checkBulk() {
    return window.BulkLinks.checkRows({ dayFirst: bulk.dayFirst !== false, rows: bulk.rows, map: bulk.map, sites: linkSites().map((s) => s.host), defaultSite: $("#bulk-site")?.value || "", known: window.BACKLINKS.map((b) => [b.site, b.src]) });
  }

  /* What a row says about itself, in the language on screen. */
  const rowWords = (r) => {
    const said = r.detail ? `${t(r.why)}${colon()}${t(r.detail)}` : t(r.why);
    return r.hint ? `${said}. ${t(r.hint)}` : said;
  };

  function updateBulk() {
    const box = $("#bulk-preview"), button = $("#bulk-import");
    if (!box) return;
    if (!bulk.rows.length) {
      setHTML(box, `<p class="help">${t("Paste or drop your list to preview it. Nothing is saved before Import.")}</p>`);
      button.disabled = true;
      setHTML(button, `${t("Import")}`);
      return;
    }
    const checked = checkBulk();
    const ok = checked.filter((r) => r.state === "ok").length, dup = checked.filter((r) => r.state === "dup").length, bad = checked.filter((r) => r.state === "bad").length, odd = checked.filter((r) => r.oddDate).length;
    // A column set to Ignore looks like nothing happened. If it could be the status, every link would quietly become Live.
    const statusNote = () => {
      if (bulk.map.includes("status")) return "";
      const likely = bulk.headers.find((h, i) => !bulk.map[i] && /state|status|statut|[eé]tat/i.test(h));
      return `<p class="note warn" style="margin:10px 0 0">${icon("triangle-alert")}<span>${likely ? `${t("This column may be the status:")} <b dir="auto">${esc(likely)}</b>. ${t("Ignored for now, so every link would import as Live. Set it to Status above.")}` : t("No Status column: every link imports as Live.")}</span></p>`;
    };
    // Fix a row here, rather than having to change the sheet and upload it all again.
    const fixFor = (r, n) => {
      if (r.state !== "bad") return "";
      const col = (field) => bulk.map.indexOf(field);
      if (r.why === "Not a full address" && col("src") >= 0) return `<input class="input mono bulk-fix" data-bulk-fix="${n}" data-bulk-fix-col="${col("src")}" value="${esc(r.cells[col("src")] || "")}" aria-label="${t("Source page")}: ${t("Row")} ${n + 1}" placeholder="https://">`;
      if (r.why === "Unknown status" && col("status") >= 0) return `<select class="select bulk-fix" data-bulk-fix="${n}" data-bulk-fix-col="${col("status")}" aria-label="${t("Status")}: ${t("Row")} ${n + 1}"><option value="">${t("Choose")}</option>${["Live", "Lost", "Planned"].map((word) => `<option value="${word}">${t(word)}</option>`).join("")}</select>`;
      if (r.why === "Not one of your sites" && col("site") >= 0) return `<select class="select bulk-fix" data-bulk-fix="${n}" data-bulk-fix-col="${col("site")}" aria-label="${t("Site")}: ${t("Row")} ${n + 1}"><option value="">${t("Choose")}</option>${linkSites().map((s) => `<option value="${esc(s.host)}">${esc(s.host)}</option>`).join("")}</select>`;
      return "";
    };
    const fieldOptions = (sel) => `<option value="">${t("Ignore")}</option>${BULK_FIELDS.map(([key, label]) => `<option value="${key}" ${sel === key ? "selected" : ""}>${t(label)}</option>`).join("")}`;
    const srcAt = bulk.map.indexOf("src");
    const icons = { ok: "good", dup: "warn", bad: "crit" };
    // The first rows, and every row with a problem wherever it is in the file: it's no use saying 3 have a problem and showing none of them.
    const shown = checked.map((r, n) => [r, n]).filter(([r, n]) => n < 8 || r.state !== "ok").slice(0, 60);
    setHTML(box, `
      <h3>${t("Match your columns")}</h3>
      <div class="map-grid">${bulk.headers.map((h, i) => `<label class="${bulk.map[i] ? "" : "map-ignored"}"><span class="head" dir="auto" title="${esc(h)}">${esc(h)}${bulk.map[i] ? "" : ` <span class="tag">${t("Not imported")}</span>`}</span><select class="select" data-bulk-col="${i}">${fieldOptions(bulk.map[i])}</select></label>`).join("")}</div>
      ${statusNote()}
      ${checked.some((r) => r.ambiguousDate) ? `<label class="field bulk-day"><span>${t("In this file, a date like 03/10/2026 means")}</span><select class="select" id="bulk-day-first"><option value="1" ${bulk.dayFirst !== false ? "selected" : ""}>${t("3 October (day first)")}</option><option value="0" ${bulk.dayFirst === false ? "selected" : ""}>${t("10 March (month first)")}</option></select></label>` : ""}
      <div class="bulk-sum" id="bulk-sum">${status("good", countWords(ok, "1 ready", "ready"))}${dup ? status("warn", `${dup} ${t("to skip")}`) : ""}${bad ? status("crit", `${bad} ${t("with a problem")}`) : ""}${odd ? status("warn", `${odd} ${t("with a date to check")}`) : ""}</div>
      <div class="bulk-table-wrap"><table class="bulk-table"><thead><tr><th>${t("Row")}</th><th>${t("Source page")}</th><th>${t("Row check")}</th>${bulk.headers.map((h, i) => (i === srcAt ? "" : `<th>${esc(h)}</th>`)).join("")}</tr></thead>
      <tbody>${shown.map(([r, n]) => `<tr><td class="muted">${n + 1}</td><td class="mono" dir="auto" title="${esc(r.record.src)}">${esc(r.record.src || "—")}</td><td class="${icons[r.state]}" style="white-space:normal;min-width:190px">${esc(rowWords(r))}${r.oddDate ? `<span class="second warn" dir="auto">${t("Check the date")}: ${esc(r.oddDate)}</span>` : ""}${fixFor(r, n)}</td>${r.cells.map((c, i) => (i === srcAt ? "" : `<td dir="auto" title="${esc(c)}">${esc(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table>
      ${checked.length > shown.length ? `<div class="bulk-more">+ ${checked.length - shown.length}</div>` : ""}</div>
      <div id="bulk-error" style="margin-top:10px"></div>`);
    button.disabled = !ok;
    setHTML(button, ok === 1 ? t("Import 1 backlink") : `${t("Import")} ${num(ok)} ${t("backlinks")}`);
  }

  function bulkPanel(opener) {
    bulk = { headers: [], rows: [], map: [] };
    openPanel(`${panelHead(t("Add backlink"), t("Only the source page is needed."))}
      ${addModeSwitch("bulk")}
      <form class="panel-body" id="bulk-form" novalidate>
        <label class="field"><span>${t("Site for rows without one")}</span><select class="select" id="bulk-site" style="width:100%">${siteOptions(pickedSite())}</select></label>
        <div class="drop" id="bulk-drop">${icon("list-plus")}<b>${t("Drop a CSV here")}</b><span>${t("or")} <button type="button" class="link-btn" id="bulk-browse" style="font-size:inherit">${t("choose a file")}</button></span><span class="small">${t("Excel and Google Sheets save as CSV.")}</span><input type="file" id="bulk-file" accept=".csv,.tsv,.txt,text/csv" hidden></div>
        <div class="bulk-links"><button type="button" class="link-btn" id="bulk-template">${t("Download template")}</button>${bl.server ? "" : `<button type="button" class="link-btn" id="bulk-sample">${t("Try sample rows")}</button>`}</div>
        <div id="bulk-file-note"></div>
        <label class="field"><span>${t("Or paste from your sheet")}</span><textarea class="input mono" id="bulk-text" rows="5" spellcheck="false" placeholder="https://site.example/page;/our-page/;anchor" data-autofocus></textarea></label>
        <div id="bulk-preview"></div>
      </form>
      <div class="panel-foot"><button class="btn btn-main" id="bulk-import" disabled>${t("Import")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener, { key: "bulk", wide: true, reopen: () => bulkPanel(opener), after: () => { readBulk($("#bulk-text").value); updateBulk(); } });
  }

  function loadBulkFile(file) {
    const note = $("#bulk-file-note");
    if (!file) return;
    const refuse = (words) => setHTML(note, `<p class="note warn">${icon("info")}<span>${esc(words)}</span></p>`);
    if (/\.xlsx?$/i.test(file.name)) { refuse(t("Excel files aren't read. In Excel, Save as CSV UTF-8.")); return; }
    try { window.BacklinkCleaner.checkUpload(file.name, file.size); } catch (err) { refuse(t(err.message)); return; }
    setHTML(note, "");
    // By its bytes: Excel can save in an older encoding, and reading that as UTF-8 would break every accent.
    file.arrayBuffer().then((data) => {
      if (!$("#bulk-text")) return;
      $("#bulk-text").value = window.BulkLinks.decode(new Uint8Array(data));
      readBulk($("#bulk-text").value);
      updateBulk();
    });
  }

  const showSkipped = (addresses) => {
    if (!addresses.length) return;
    const names = addresses.slice(0, 5).map((a) => a.replace(/^https?:\/\//, "")).join(", ");
    const rest = addresses.length > 5 ? ` ${t("and")} ${num(addresses.length - 5)} ${t("more")}` : "";
    toast(`${t("Skipped, already there")}${colon()}${names}${rest}`, { kind: "info", stay: true });
  };

  async function importBulk() {
    const checked = checkBulk(), ready = checked.filter((r) => r.state === "ok");
    const button = $("#bulk-import"), box = $("#bulk-error");
    setHTML(box, "");
    button.disabled = true; // a second press must not send it twice
    let result;
    try {
      result = await keepLinks(ready.map((r) => ({ record: r.record, site: r.site, status: r.status })));
    } catch (err) {
      if (!box.isConnected) { toast(serverSays(err.message), { kind: "crit" }); return; }
      setHTML(box, `<div class="error" role="alert">${icon("octagon-alert")}<span>${esc(serverSays(err.message))}</span></div>`);
      box.scrollIntoView({ block: "nearest" });
      button.disabled = false;
      return;
    }
    const { added } = result;
    window.BACKLINKS.unshift(...added);
    const prospects = takeProspects(result.prospects);
    backlinksChanged();
    forgetPanelForm();
    closePanel();
    state.blSection = added.length && added.every((b) => b.status === "planned") ? "todo" : "done"; state.blTab = "all"; state.blFilter = "all";
    blSort = null; window.TP.state(BL_PAGES).q = ""; window.TP.reset(BL_PAGES); // what was just added is on the first page
    // Each row has its own site now, so a filter on one site could hide what was just added.
    if (state.site !== "all" && added.some((b) => b.site !== siteName())) state.site = "all";
    render();
    added.forEach((b) => $(`#row-${b.id}`)?.classList.add("flash"));
    window.COMP?.refreshLogos?.({ watch: true }); // their icons arrive a moment later
    if (added.length) {
      toast(countWords(added.length, "1 backlink added", "backlinks added"), { undo: async () => {
        const stuck = await removeLinks(added);
        if (!stuck.length) prospects.forEach(putBackProspect);
        render();
        toast(t(stuck.length ? "Some links could not be removed" : "Backlinks removed"), { kind: stuck.length ? "crit" : "info" });
      } });
    } else toast(t("Nothing new"), { kind: "info" });
    showSkipped([...checked.filter((r) => r.state === "dup").map((r) => r.record.src), ...result.skipped.map((x) => x.source_url)]);
    // A toast says what went in. What didn't has to stay on screen until someone has seen it.
    const notAdded = checked.map((r, n) => ({ r, n })).filter(({ r }) => r.state === "bad");
    const oddDates = checked.map((r, n) => ({ r, n })).filter(({ r }) => r.state === "ok" && r.oddDate);
    if (notAdded.length || oddDates.length) bulkResultPanel(added.length, notAdded, oddDates, [...bulk.headers]);
  }

  function bulkResultPanel(addedCount, notAdded, oddDates, headers) {
    bulkLeftOver = { headers, rows: notAdded.map(({ r }) => [...r.cells, rowWords(r)]) };
    const line = ({ r, n }, words) => `<li><span class="muted">${t("Row")} ${num(n + 1)}</span> <span class="mono small" dir="auto">${esc(r.record.src || r.cells[0] || "—")}</span><div class="small sec" dir="auto">${esc(words)}</div></li>`;
    openPanel(`${panelHead(t("Import result"), `${num(addedCount)} ${t("added")} · ${num(notAdded.length)} ${t("not added")}`)}
      <div class="panel-body">
        ${notAdded.length ? `<h3>${t("Not added")} <span class="muted">${num(notAdded.length)}</span></h3><p class="help">${t("These rows stayed in your file. Fix them and import again.")}</p><ul class="bulk-result">${notAdded.map((x) => line(x, rowWords(x.r))).join("")}</ul><button class="btn btn-small" id="bulk-download">${icon("download")}${t("Download rows not added")}</button>` : ""}
        ${oddDates.length ? `<h3 style="margin-top:16px">${t("Added, with a date to check")} <span class="muted">${num(oddDates.length)}</span></h3><p class="help">${t("Unreadable dates, kept as typed: no renewal reminder for them.")}</p><ul class="bulk-result">${oddDates.map((x) => line(x, x.r.oddDate)).join("")}</ul>` : ""}
      </div>
      <div class="panel-foot"><button class="btn btn-main" data-close-panel>${t("Done")}</button></div>`, $("#bulk-open"));
  }
  let bulkLeftOver = null;

  /* The one-link form. Only here does a link get saved, and only here does a prospect it came from leave In consideration. */
  async function saveOneLink() {
    if (!validateSource()) { $("#bl-src").focus(); return; }
    if (!$("#bl-site").value) { setHTML($("#bl-src-err"), `<div class="error" role="alert">${icon("octagon-alert")}<span>${esc(t("Add your own website first"))}</span></div>`); return; }
    const field = (id) => $(id).value.trim();
    const record = {
      src: field("#bl-src"), target: field("#bl-target"), anchor: field("#bl-anchor"), link_type: field("#bl-type"), placed: field("#bl-placed"), due: field("#bl-due"), renewal: field("#bl-renewal"), cost: field("#bl-cost"),
      mediator: field("#bl-mediator"), contact: field("#bl-contact"), platform: field("#bl-platform"), utm_source: field("#bl-utm-source"), utm_medium: field("#bl-utm-medium"), utm_campaign: field("#bl-utm-campaign"), owner: field("#bl-owner"), notes: field("#bl-notes"),
      keyword: field("#bl-keyword"), anchor_kind: field("#bl-anchor-kind"),
    };
    const button = $("#bl-save"), box = $("#bl-src-err"), fromProspect = $("#bl-form").dataset.prospect;
    const logged = fromProspect ? window.PROSPECTS.find((p) => p.id === fromProspect) : null;
    const refuse = (words) => {
      setHTML(box, `<div class="error" role="alert">${icon("octagon-alert")}<span>${esc(words)}</span></div>`);
      button.disabled = false;
      $("#bl-src")?.focus();
    };
    button.disabled = true; // a second press must not save it twice
    const editing = window.BACKLINKS.find((b) => b.id === $("#bl-form").dataset.edit);
    if (editing) {
      const site = $("#bl-site").value, status = $("#bl-status").value;
      try {
        if (bl.server) {
          const answer = await COMP.api("PUT", `backlinks/${editing.serverId}`, serverRow(record, site, status));
          // A saved row doesn't carry the worked-out anchor type. It still holds while the anchor text is the same.
          const auto = (editing.anchor || "") === (record.anchor || "") ? editing.anchorAuto : null;
          Object.assign(editing, toBacklink(answer.saved, site));
          editing.anchorAuto = auto;
          editing.anchorType = editing.anchorKind || auto;
          takeProspects(answer.prospects_removed);
        } else {
          const key = window.BulkLinks.sourceKey(record.src);
          if (window.BACKLINKS.some((b) => b !== editing && b.site === site && window.BulkLinks.sourceKey(b.src) === key)) { refuse(t("Already logged")); return; }
          // What was measured about the link stays: only what was typed changes.
          const { id, auth, visits, leads, label, before, after, createdAt, shared } = editing;
          Object.assign(editing, localLink(id, record, site, status), { auth, visits, leads, label, before, after, createdAt, shared });
        }
      } catch (err) {
        if ($("#bl-form")) refuse(serverSays(err.message)); else toast(serverSays(err.message), { kind: "crit" });
        return;
      }
      forgetPanelForm();
      closePanel();
      backlinksChanged();
      render();
      toast(t("Backlink updated"));
      $(`#row-${editing.id}`)?.classList.add("flash");
      return;
    }
    let result;
    try {
      result = await keepLinks([{ record, site: $("#bl-site").value, status: $("#bl-status").value }]);
    } catch (err) {
      if ($("#bl-form")) refuse(serverSays(err.message)); else toast(serverSays(err.message), { kind: "crit" });
      return;
    }
    const b = result.added[0];
    if (!b && !logged) { refuse(t("Already logged")); return; }
    if (logged) {
      window.PROSPECTS = window.PROSPECTS.filter((p) => p !== logged);
      // The server's own save has dealt with the link gap. The sample has only this to keep its gaps in step.
      if (!bl.server && logged.serverId) await COMP.api("POST", "backlinks", { site_id: logged.siteId, source_url: b.src, status: b.status }).catch(() => {});
      window.dispatchEvent(new CustomEvent("seocc:prospect-removed", { detail: { ...logged, logged: true, removedOnServer: result.prospects.includes(logged.serverId) } }));
    }
    const others = takeProspects(result.prospects); // another prospect on the same domain, if this wasn't started from it
    forgetPanelForm();
    closePanel();
    state.blSection = b?.status === "planned" ? "todo" : "done"; state.blTab = "all"; state.blFilter = "all";
    blSort = null; window.TP.state(BL_PAGES).q = ""; window.TP.reset(BL_PAGES); // what was just saved is on the first page
    if (!b) { render(); toast(t("Already logged. Removed from In consideration."), { kind: "info" }); return; } // its address is already in Done, so it was done already
    window.BACKLINKS.unshift(b);
    backlinksChanged();
    if (state.site !== "all" && b.site !== siteName()) state.site = "all";
    render();
    toast(t("Backlink saved"), { undo: async () => {
      const stuck = await removeLinks([b]);
      if (!stuck.length) [...others, ...(logged ? [logged] : [])].forEach(putBackProspect);
      render();
      toast(t(stuck.length ? "Some links could not be removed" : "Backlinks removed"), { kind: stuck.length ? "crit" : "info" });
    } });
    window.COMP?.refreshLogos?.({ watch: true }); // its icon arrives a moment later
    const row = $(`#row-${b.id}`);
    if (row) { row.classList.add("flash"); row.scrollIntoView({ block: "nearest" }); }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob(["\ufeff", window.BulkLinks.TEMPLATE_TEXT], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "backlinks-template.csv";
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function validateSource() {
    const input = $("#bl-src"), box = $("#bl-src-err");
    const value = input.value.trim();
    const message = !value ? t("Enter the linking page") : !/^https?:\/\/[^\s.]+\.[^\s]+/.test(value) ? t("Enter a full https:// address") : "";
    input.classList.toggle("invalid", Boolean(message));
    input.setAttribute("aria-invalid", message ? "true" : "false");
    setHTML(box, message ? `<div class="error" role="alert">${icon("octagon-alert")}${esc(message)}</div>` : "");
    return !message;
  }

  // ---- Refresh -----------------------------------------------------------------
  const refresh = { engines: new Set(["google"]), depth: 10, keys: [], mode: "auto", picked: new Set(), paid: false, cap: 5 };
  const engineWords = (list) => list.map((e) => ENGINES.find(([id]) => id === e)[1]).join(", ");

  // Automatic: each keyword goes to the first tool down the list with credits. Choose tools: every ticked tool checks it.
  function allocate() {
    const pages = Math.ceil(refresh.depth / 10);
    const pools = window.TOOLS.map((tool) => ({ ...tool, used: 0, paidUsed: 0, noCredit: 0 }));
    const plan = [];
    let unassigned = 0, cost = 0;
    const hasFree = (p) => p.left === null || p.left - p.used >= pages;
    const canPay = (p) => refresh.paid && p.paidPer && cost + p.paidPer * pages <= refresh.cap;
    const take = (p) => {
      if (p.left === null) { p.noCredit += 1; return true; }
      if (hasFree(p)) { p.used += pages; return true; }
      if (canPay(p)) { p.paidUsed += pages; cost += p.paidPer * pages; return true; }
      return false;
    };
    refresh.engines.forEach((engine) => refresh.keys.forEach((key) => {
      const able = pools.filter((p) => p.connected && p.engines.includes(engine));
      if (refresh.mode === "pick") {
        const chosen = able.filter((p) => refresh.picked.has(p.name));
        if (!chosen.length) { unassigned += 1; return; }
        chosen.forEach((p) => { if (take(p)) plan.push({ key, engine, tool: p.name }); else unassigned += 1; });
        return;
      }
      const auto = able.filter((p) => !p.manualOnly);
      const p = auto.find(hasFree) || auto.find(canPay);
      if (p && take(p)) plan.push({ key, engine, tool: p.name }); else unassigned += 1;
    }));
    return { plan, pools, unassigned, total: plan.length, cost };
  }

  /* A tool this run would leave nearly empty is named, because the credits don't come back until it refills. */
  const lowAfterRun = (pools) => pools.filter((p) => p.used && p.left !== null && p.of && (p.left - p.used) / p.of < 0.2)
    .map((p) => `<p class="small sec" style="margin:6px 0 0">${esc(t(p.name))}: ${num(Math.max(0, p.left - p.used))} ${t("left after this")} · ${t(p.refills)}</p>`).join("");

  function refreshSummary() {
    const { pools, unassigned, total, cost } = allocate();
    const pages = Math.ceil(refresh.depth / 10);
    const plural = (n, one, many) => `${n} ${t(n === 1 ? one : many)}`;
    const credits = pools.reduce((s, p) => s + p.used + p.paidUsed, 0);
    const noCredit = pools.reduce((s, p) => s + p.noCredit, 0);
    const toolsEach = refresh.mode === "pick" ? ` × ${plural(refresh.picked.size, "tool per keyword", "tools per keyword")}` : "";
    const sum = refresh.keys.length && refresh.engines.size ? `<span class="muted"> (${plural(refresh.keys.length, "keyword", "keywords")} × ${plural(refresh.engines.size, "engine", "engines")} × ${plural(pages, "result page", "result pages")}${toolsEach})</span>` : "";
    return `<p class="small sec" style="margin:0">${t("Will use")} <b>${num(credits)}</b> ${t(credits === 1 ? "check" : "checks")}${noCredit ? ` + ${noCredit} ${t("no credits")}` : ""}.${sum}${cost ? ` <b>${t("Estimated cost")}: $${dec(cost.toFixed(2))}</b>` : ""}</p>
      ${lowAfterRun(pools)}
      ${unassigned ? `<p class="note warn" style="margin-top:10px;margin-bottom:0">${icon("triangle-alert")}<span>${t("Runs out after")} ${num(total)} ${t("checks")}.</span></p>` : ""}
      ${!refresh.engines.size ? `<p class="note" style="margin-top:10px;margin-bottom:0">${icon("info")}<span>${t("Pick an engine.")}</span></p>` : refresh.mode === "pick" && !refresh.picked.size ? `<p class="note" style="margin-top:10px;margin-bottom:0">${icon("info")}<span>${t("Pick a tool.")}</span></p>` : ""}`;
  }

  const refreshFootText = () => (refresh.paid ? `${t("Free tools first, then paid, up to")} $${refresh.cap}` : t("Free tools only"));

  // Changing an option only updates what changed in place, so focus stays where the user is.
  function updateRefreshSummary() {
    const { pools, total } = allocate();
    const pick = refresh.mode === "pick";
    $("#ref-tool-list").classList.toggle("auto", !pick);
    pools.forEach((p) => {
      const row = $$("[data-tool-row]").find((r) => r.dataset.toolRow === p.name);
      if (!row) return;
      const fits = [...refresh.engines].some((e) => p.engines.includes(e));
      const usable = p.connected && fits;
      row.classList.toggle("off", !usable || (!pick && p.manualOnly));
      const box = $("input", row);
      box.disabled = !pick || !usable;
      const checks = p.used + p.paidUsed + p.noCredit;
      const why = !p.connected ? `<button type="button" class="link-btn" data-conn-tool="${esc(p.name)}">${t("Connect")}</button>`
        : !fits ? `<span class="quiet">${t("Not for these engines")}</span>`
        : !pick && p.manualOnly ? `<span class="quiet">${t("Only if picked")}</span>`
        : checks ? `${num(checks)} ${t(checks === 1 ? "check" : "checks")}${p.paidUsed ? ` · ${num(p.paidUsed)} ${t("paid")}` : ""}` : "";
      setHTML($(".tool-checks", row), why);
    });
    setHTML($("#ref-summary"), refreshSummary());
    const usesNow = pools.reduce((s, p) => s + p.used + p.paidUsed, 0);
    $("#ref-foot").textContent = `${t("Will use")} ${num(usesNow)} ${t(usesNow === 1 ? "check" : "checks")} · ${refreshFootText()}`;
    $("#ref-paid-cap").hidden = !refresh.paid;
    $("#ref-confirm").disabled = !total;
  }

  function renderRefreshDialog() {
    const credit = (p) => (p.left === null ? t("No credits needed") : `${num(p.left)} ${t("of")} ${num(p.of)} ${t("left")} · ${t(p.refills)}`);
    setHTML($("#dlg"), `
      <div class="dlg-head"><h2 id="dlg-title">${t("Refresh keywords")}</h2><button class="icon-btn" data-close-dlg aria-label="${t("Close")}">${icon("x")}</button></div>
      <div class="dlg-body">
        <p style="margin-bottom:12px"><b>${refresh.keys.length}</b> ${t(refresh.keys.length === 1 ? "keyword" : "keywords")}</p>
        <fieldset style="border:0;padding:0;margin:0 0 8px"><legend class="small sec" style="padding:0;margin-bottom:6px;font-weight:500">${t("Engines")}</legend>
          ${ENGINES.map(([id, name]) => `<label class="opt engine-opt"><input type="checkbox" class="chk" style="margin:0" data-ref-engine="${id}" ${refresh.engines.has(id) ? "checked" : ""}>${logo(id, 16)}${name}</label>`).join("")}
        </fieldset>
        <label class="field" style="margin-bottom:6px"><span>${t("Depth")}</span><select class="select" id="ref-depth">${[10, 20, 30, 50].map((d) => `<option value="${d}" ${refresh.depth === d ? "selected" : ""}>${t("Top")} ${d}</option>`).join("")}</select></label>
        <div class="ref-tools-head"><span>${t("Tools")}</span><span class="seg" role="group" aria-label="${t("Tools")}"><button type="button" data-ref-mode="auto" aria-pressed="${refresh.mode === "auto"}">${t("Automatic: free first")}</button><button type="button" data-ref-mode="pick" aria-pressed="${refresh.mode === "pick"}">${t("Choose tools")}</button></span></div>
        <div class="tool-list" id="ref-tool-list">
          ${window.TOOLS.map((p) => `<label class="tool-row" data-tool-row="${esc(p.name)}">
            <input type="checkbox" class="chk" style="margin:0" data-ref-tool="${esc(p.name)}" ${refresh.picked.has(p.name) ? "checked" : ""}>
            ${logo(p.name, 22)}
            <span class="tool-main"><span class="t">${esc(t(p.name))}</span><span class="d">${t("Free")} · ${esc(credit(p))}${p.price ? ` · ${t("then")} ${esc(t(p.price))}` : ""}</span></span>
            <span class="tool-engines" role="img" aria-label="${esc(engineWords(p.engines))}" data-tip="${esc(engineWords(p.engines))}">${p.engines.map((e) => logo(e, 14)).join("")}</span>
            <span class="tool-checks"></span></label>`).join("")}
        </div>
        <div class="paid-row">
          <label class="opt"><input type="checkbox" class="chk" style="margin:0" id="ref-paid" ${refresh.paid ? "checked" : ""}>${t("Use paid credits after free ones")}</label>
          <label class="paid-cap" id="ref-paid-cap" ${refresh.paid ? "" : "hidden"}>${t("Limit to")} $<input class="input" id="ref-cap" type="number" min="1" step="1" value="${refresh.cap}"></label>
        </div>
        <div id="ref-summary" aria-live="polite"></div>
      </div>
      <div class="dlg-foot"><span class="left" id="ref-foot"></span><button class="btn" data-close-dlg>${t("Cancel")}</button><button class="btn btn-main" id="ref-confirm">${t("Confirm")}</button></div>`);
    updateRefreshSummary();
    placeInks({ instant: true });
  }

  function openRefresh(keys, engines, depth = 10) {
    if (window.KW_REAL) { window.KW_REAL.openRefresh(window.KW_REAL.filteredIds()); return; }
    if (state.refreshBusy) { toast(t("Already refreshing."), { kind: "info" }); return; }
    refresh.keys = keys;
    refresh.engines = new Set(engines || [state.engine === "all" ? "google" : state.engine]);
    refresh.depth = depth;
    $("#dlg").classList.remove("wide");
    renderRefreshDialog();
    $("#dlg").showModal();
    placeInks({ instant: true });
  }

  let run = null, ignoreClicksUntil = 0;
  function startRefresh() {
    const { plan } = allocate();
    $("#dlg").close();
    ignoreClicksUntil = performance.now() + 400; // the second half of a double click must not press what's underneath
    if (!plan.length) return;
    state.refreshBusy = true;
    state.selected.clear(); // used up by this run, and the bar would sit under the tray
    if (state.route === "keywords") render();
    run = { plan, i: 0, total: plan.length, msg: "", cancelled: false, lastTool: plan[0].tool, seen: new Set(), pages: Math.ceil(refresh.depth / 10) };
    renderTray();
    const step = () => {
      if (!run) return;
      if (run.cancelled) return finishRefresh(`${t("Stopped")} · ${run.i} ${t("saved")}`);
      if (run.i >= run.total) return finishRefresh(`${t("Finished")} · ${run.i} ${t("saved")}`);
      const item = run.plan[run.i];
      const previous = run.plan[run.i - 1];
      if (refresh.mode === "auto" && previous && item.tool !== run.lastTool && item.engine === previous.engine) {
        run.msg = `${t(run.lastTool)} ${t("out of credits, using")} ${t(item.tool)}`;
      }
      run.lastTool = item.tool;
      const row = window.KEYWORDS.find((k) => k.k === item.key);
      const res = row.res[item.engine];
      const spent = window.TOOLS.find((x) => x.name === item.tool);
      if (spent && spent.left !== null) spent.left = Math.max(0, spent.left - run.pages);
      const known = item.engine === "google" ? row.tools.find((x) => x.tool === item.tool) : null;
      const id = `${item.key}|${item.engine}`;
      if (run.seen.has(id)) {
        // A second tool in the same run: its result sits beside the first, it never replaces it.
        res.also = (res.also || []).filter((x) => x.tool !== item.tool);
        res.also.push({ tool: item.tool, p: res.p, age: 0, depth: refresh.depth });
        if (known) { known.age = 0; known.p = res.p; known.depth = refresh.depth; }
      } else {
        run.seen.add(id);
        const changedTool = res.tool !== item.tool;
        res.tool = item.tool; res.age = 0; res.depth = refresh.depth; res.toolChanged = changedTool;
        if (changedTool) { row.chg[item.engine] = null; } else if (res.p) { row.chg[item.engine] = 0; }
        if (known) { known.age = 0; known.p = res.p; known.depth = refresh.depth; }
      }
      run.i += 1;
      updateTray();
      if (state.route === "keywords") {
        const tr = $$("#kw-table tbody tr").find((r) => r.dataset.kw === item.key);
        if (tr) {
          const fresh = fragment(`<table><tbody>${keywordRow(row)}</tbody></table>`).querySelector("tr");
          fresh.classList.add("flash");
          tr.replaceWith(fresh);
        }
      }
      setTimeout(step, reduceMotion() ? 40 : 260);
    };
    setTimeout(step, 300);
  }

  function renderTray() {
    setHTML($("#tray-root"), `<div class="tray" id="tray" role="status">
      <div class="top">${icon("refresh-cw", "spin")}<span id="tray-title">${t("Refreshing")}</span><span class="end tabular" id="tray-count"></span></div>
      <div class="bar"><i id="tray-bar"></i></div>
      <div class="msg" id="tray-msg"></div>
      <div id="tray-actions" style="margin-top:8px"><button class="btn btn-small" id="tray-cancel">${t("Stop")}</button></div></div>`);
    updateTray();
  }
  function updateTray() {
    if (!run) return;
    $("#tray-count").textContent = `${run.i} / ${run.total}`;
    $("#tray-bar").style.setProperty("--p", run.i / run.total);
    $("#tray-msg").textContent = run.msg;
  }
  function finishRefresh(text) {
    state.refreshBusy = false;
    state.lastRefresh = 0;
    run = null;
    const tray = $("#tray");
    setHTML(tray.querySelector(".top"), `${icon("circle-check", "good")}<span>${esc(text)}</span>`);
    tray.querySelector("#tray-actions")?.remove();
    setTimeout(() => tray.classList.add("pill"), 5000);
    setTimeout(() => { if ($("#tray") === tray) $("#tray-root").replaceChildren(); }, 9000);
    // Redraw only after the last row's highlight has finished.
    setTimeout(() => { if (!state.refreshBusy && state.route === "keywords" && !$("#panel")) render(); }, 1300);
  }

  // ---- command bar ----------------------------------------------------------------
  function commands() {
    const pages = [...NAV.filter((n) => BUILT.has(n.id) && mayOpen(n.id)), { id: "settings", label: "Settings", icon: "settings" }].map((n) => ({ label: t(n.label), kind: t("Go to"), icon: n.icon, run: () => go(n.id) }));
    const may = (section, edit) => !window.ACCESS || (edit ? ACCESS.canEdit(section) : ACCESS.can(section));
    const actions = [
      { label: t("Add backlink"), kind: t("Action"), icon: "plus", run: () => { if (state.route === "backlinks") addBacklinkPanel(); else { go("backlinks"); setTimeout(() => addBacklinkPanel(), 200); } } },
      { label: t("Refresh keywords"), kind: t("Action"), icon: "refresh-cw", run: () => { const open = () => openRefresh(filtered().map((k) => k.k)); if (state.route === "keywords") open(); else { go("keywords"); setTimeout(open, 200); } } },
    ];
    if (!may("backlinks", true)) actions.splice(0, 1);
    if (!may("keywords", true)) actions.splice(actions.findIndex((a) => a.icon === "refresh-cw"), 1);
    const sites = window.SITES.map((s) => ({ label: s.host, kind: t("Site"), icon: "globe", run: () => { state.site = s.id; render(); } }));
    if (!may("keywords")) return [...pages, ...actions, ...sites, ...(may("competitors") ? cmdRivals.list.map((c) => ({ label: c.display || c.host, kind: `${t("Competitor")} · ${c.site}`, icon: "crosshair", run: () => { location.hash = `#competitors/list/${c.id}?site=${encodeURIComponent(c.site)}`; } })) : [])];
    const kws = window.KEYWORDS.map((k) => ({ label: k.k, kind: t("Keyword"), icon: "key-round", run: () => { const open = () => openKeyword(k.k); if (state.route === "keywords") open(); else { go("keywords"); setTimeout(open, 200); } } }));
    const rivals = !may("competitors") ? [] : cmdRivals.list.map((c) => ({ label: c.display || c.host, kind: `${t("Competitor")} · ${c.site}`, icon: "crosshair", run: () => { location.hash = `#competitors/list/${c.id}?site=${encodeURIComponent(c.site)}`; } }));
    return [...pages, ...actions, ...sites, ...kws, ...(window.KW_REAL?.commands?.() || []), ...rivals];
  }
  /* Competitors in ⌘K: each own site's list, asked only when the bar opens (never at load), kept a minute. A name opens
     that competitor's profile at its own address (#competitors/list/<id>). */
  const cmdRivals = { list: [], at: 0, loading: false };
  async function loadCmdRivals() {
    if (cmdRivals.loading || Date.now() - cmdRivals.at < 60000 || !(await COMP.isServer?.())) return;
    if (window.ACCESS && !ACCESS.can("competitors")) return;
    cmdRivals.loading = true;
    try {
      const own = window.SITES.filter((x) => x.realId);
      const lists = await Promise.all(own.map((site) => COMP.api("GET", `competitors?site_id=${site.realId}`).then((a) => (a.competitors || []).map((c) => ({ id: c.id, host: c.host, display: c.display, site: site.host }))).catch(() => [])));
      cmdRivals.list = lists.flat(); cmdRivals.at = Date.now();
    } finally { cmdRivals.loading = false; }
    if ($("#cmdk").open) renderCmdList($("#cmd-input")?.value || "");
  }
  let cmdList = [], cmdIndex = 0;
  function renderCmdList(query = "") {
    const q = query.trim().toLowerCase();
    cmdList = commands().filter((c) => !q || c.label.toLowerCase().includes(q)).slice(0, 9);
    cmdIndex = Math.min(cmdIndex, Math.max(0, cmdList.length - 1));
    setHTML($("#cmd-list"), cmdList.length
      ? cmdList.map((c, i) => `<li><button data-cmd="${i}" class="${i === cmdIndex ? "on" : ""}" dir="auto">${icon(c.icon, "muted")}<span>${esc(c.label)}</span><span class="kind">${esc(c.kind)}</span></button></li>`).join("")
      : `<li class="muted small" style="padding:14px">${t("No results")}</li>`);
  }
  function openCmd() {
    const d = $("#cmdk");
    setHTML(d, `<input id="cmd-input" placeholder="${t("Search or jump to…")}" aria-label="${t("Search or jump to…")}" autocomplete="off"><ul id="cmd-list"></ul>`);
    cmdIndex = 0;
    d.showModal();
    loadCmdRivals();
    renderCmdList();
    $("#cmd-input").focus();
  }
  function runCmd(i) { const c = cmdList[i]; if (!c) return; $("#cmdk").close(); c.run(); }

  // ---- popovers --------------------------------------------------------------------
  let popAnchor = null;
  function closePopover({ focus = false } = {}) {
    const el = $("#popover");
    if (!el) return;
    el.remove();
    popAnchor?.setAttribute("aria-expanded", "false");
    if (focus && popAnchor?.isConnected) popAnchor.focus();
    popAnchor = null;
    dp = null;
  }
  function placePopover(el, anchor) {
    const box = anchor.getBoundingClientRect();
    el.style.left = "0px"; // measured from the left edge, or its width is squeezed by where it last sat
    el.style.left = `${Math.max(8, Math.min(box.left, innerWidth - el.offsetWidth - 8))}px`;
    // Below the button, unless it's low on the screen and there's more room above.
    el.style.maxHeight = "";
    const below = innerHeight - box.bottom - 16, above = box.top - 16, wanted = el.scrollHeight;
    if (wanted > below && above > below) {
      const height = Math.min(wanted, above);
      el.style.top = `${box.top - 6 - height}px`;
      el.style.maxHeight = `${above}px`;
    } else {
      el.style.top = `${box.bottom + 6}px`;
      el.style.maxHeight = `${below}px`;
    }
  }
  function popover(anchor, html, cls = "") {
    closePopover();
    const el = document.createElement("div");
    el.id = "popover"; el.className = `popover ${cls}`;
    setHTML(el, html);
    document.body.append(el);
    popAnchor = anchor;
    anchor.setAttribute("aria-expanded", "true");
    placePopover(el, anchor);
    (el.querySelector("[data-autofocus]") || el.querySelector("button, input"))?.focus();
    return el;
  }

  // ---- date picker: a preset, one specific day, or any range ------------------------
  let dp = null;
  const monthOf = (day) => day.slice(0, 7);
  const addMonths = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const fmtMonth = (ym) => new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric" }).format(parseDay(`${ym}-01`));

  function calMonth(ym) {
    const [y, m] = ym.split("-").map(Number);
    const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7, total = new Date(y, m, 0).getDate();
    const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2026, 5, 1 + i)); // 1 June 2026 is a Monday
    const head = weekdays.map((d) => `<th scope="col" abbr="${esc(new Intl.DateTimeFormat(locale(), { weekday: "long" }).format(d))}">${esc(new Intl.DateTimeFormat(locale(), { weekday: "short" }).format(d).slice(0, 2))}</th>`).join("");
    let cells = "<td></td>".repeat(lead), rows = "", col = lead;
    for (let d = 1; d <= total; d++) {
      const day = `${ym}-${pad(d)}`;
      const off = day > TODAY || day < FIRST_DAY;
      cells += `<td><button type="button" class="dp-day ${day === TODAY ? "today" : ""} ${day > DATA_END && !off ? "nodata" : ""}" data-day="${day}" ${off ? "disabled" : ""} tabindex="${day === dp.focus ? 0 : -1}" aria-label="${esc(fmtDay(day, { day: "numeric", month: "long", year: "numeric" }))}">${d}</button></td>`;
      if (++col === 7) { rows += `<tr>${cells}</tr>`; cells = ""; col = 0; }
    }
    if (cells) rows += `<tr>${cells}${"<td></td>".repeat(7 - col)}</tr>`;
    return `<div class="dp-month"><table class="dp-grid" role="grid" aria-label="${esc(fmtMonth(ym))}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function paintRange() {
    if (!dp) return;
    const end = dp.phase === "end" && dp.hover ? dp.hover : dp.to;
    const [lo, hi] = dp.from <= end ? [dp.from, end] : [end, dp.from];
    $$(".dp-day").forEach((btn) => {
      const day = btn.dataset.day;
      btn.classList.toggle("start", day === lo);
      btn.classList.toggle("end", day === hi);
      btn.classList.toggle("in", day > lo && day < hi);
      btn.setAttribute("aria-pressed", String(day >= lo && day <= hi));
    });
  }

  function updateDpSum() {
    const n = dayCount(dp.from, dp.to);
    const what = dp.phase === "end"
      ? `<b>${esc(fmtDay(dp.from))}</b> · ${t("pick an end date, or apply this one day")}`
      : `<b>${esc(fmtRange(dp.from, dp.to))}</b> · ${n} ${t(n === 1 ? "day" : "days")}`;
    const warn = dp.to > DATA_END ? `<span class="dp-warn">${t("Data stops at")} ${esc(fmtDay(DATA_END))}.</span>` : "";
    setHTML($("#dp-sum"), what + warn);
    $("#dp-from").value = dp.from;
    $("#dp-to").value = dp.to;
  }

  function renderCal() {
    const left = addMonths(dp.right, -1);
    setHTML($("#dp-cal"), `<div class="dp-nav">
        <button type="button" class="icon-btn prev" data-dp-move="-1" aria-label="${t("Previous month")}" ${left <= monthOf(FIRST_DAY) ? "disabled" : ""}>${icon("chevron-left")}</button>
        <span class="title">${esc(fmtMonth(left))}</span><span class="title">${esc(fmtMonth(dp.right))}</span>
        <button type="button" class="icon-btn next" data-dp-move="1" aria-label="${t("Next month")}" ${dp.right >= monthOf(TODAY) ? "disabled" : ""}>${icon("chevron-right")}</button>
      </div><div class="dp-cals">${calMonth(left)}${calMonth(dp.right)}</div>`);
    paintRange();
    updateDpSum();
  }

  function openDatePicker(anchor) {
    const { from, to } = periodWindow();
    dp = { from, to, phase: "start", hover: null, right: monthOf(to), focus: to };
    // The simpler head's More: only the periods its buttons don't show, then the comparison, so a phone that cuts the date
    // line still reaches it.
    const inHead = state.simple && anchor.closest(".head-period");
    const presets = RANGE_PRESETS.filter(([id]) => (id !== "24h" || HOURLY_SCREENS.has(state.route)) && !(inHead && HEAD_PRESETS.some(([shown]) => shown === id)));
    const presetButtons = `<div class="dp-presets" role="group" aria-label="${t("Period")}">
        ${presets.map(([id, name]) => { const on = state.rng.preset === id; return `<button type="button" data-preset="${esc(id)}" aria-pressed="${on}" ${on ? "data-autofocus" : ""}>${t(name)}</button>`; }).join("")}
      </div>`;
    const compares = `<div class="dp-cmp" role="group" aria-labelledby="dp-cmp-label"><div class="dp-group" id="dp-cmp-label">${t("Compare with")}</div>${RANGE_COMPARES.map(([id, name]) => `<button type="button" data-compare="${esc(id)}" aria-pressed="${state.rng.compare === id}">${t(id === "yoy" ? "vs same days last year" : name)}</button>`).join("")}</div>`;
    const el = popover(anchor, `<div class="dp ${inHead ? "dp-head" : ""}" role="dialog" aria-label="${t("Choose dates")}">
      ${inHead ? `<div class="dp-side">${presetButtons}${compares}</div>` : presetButtons}
      <div class="dp-main">
        <div class="dp-title">${t("Custom date")}</div>
        <div class="dp-fields">
          <label>${t("From")}<input class="input" type="date" id="dp-from" min="${FIRST_DAY}" max="${TODAY}" value="${from}" ${state.rng.preset === "custom" ? "data-autofocus" : ""}></label>
          <label>${t("To")}<input class="input" type="date" id="dp-to" min="${FIRST_DAY}" max="${TODAY}" value="${to}"></label>
        </div>
        <div id="dp-cal"></div>
        <div class="dp-foot"><div class="dp-sum" id="dp-sum" aria-live="polite"></div><button type="button" class="btn btn-small" data-dp-cancel>${t("Cancel")}</button><button type="button" class="btn btn-main btn-small" id="dp-apply">${t("Apply")}</button></div>
      </div></div>`, "dp-pop");
    renderCal();
    placePopover(el, anchor);
  }

  function applyPeriod(focusId = "period") {
    closePopover();
    render({ enter: true });
    simulateLoad(() => {});
    $(`#${focusId}`)?.focus();
  }

  // ---- settings: connections -----------------------------------------------------
  const siteHost = (id) => window.SITES.find((s) => s.id === id)?.host || id;
  const connFor = (toolName) => window.CONNECTIONS.find((c) => c.tool === toolName);
  const sitesWord = (c) => (c.sites === "all" ? t("All sites") : c.sites.length ? c.sites.map(siteHost).join(", ") : "—");

  const connStatus = (c) => {
    const ago = (when) => (state.lang === "fr" ? `il y a ${when}` : `${when} ago`);
    // "Failing" says why on hover and focus: the plain reason, from the tool's own message (fix-hints.js).
    const why = c.status === "failing" && c.error ? (window.FIX?.explain?.(c.error, { tool: c.name })?.summary || c.error) : "";
    const failing = status("crit", c.since ? `${t("Failing")}, ${ago(c.since)}` : t("Failing"));
    return { ok: status("good", t("Connected")), failing: why ? `<span class="nowrap" data-tip="${esc(t(why))}">${failing}<span class="sr">: ${esc(t(why))}</span></span>` : failing, off: `<span class="status sec">${t("Not connected")}</span>`, nokey: status("good", t("No key needed")) }[c.status];
  };

  // What each limit does when it runs out. Asked for: what refills, and what is one-time.
  const RESETS = { google: "Daily", clarity: "Daily", bing: "Not published", yandex: "Not published", pagespeed: "Daily", openpagerank: "Monthly", brightdata: "Monthly, on the 1st", serpapi: "Monthly", hasdata: "Monthly", searlo: "Once only", ddg: "Nothing to refill", searxng: "Nothing to refill", browser: "Nothing to refill", moz: "Monthly", googleads: "Daily", cloudflare: "Every 5 minutes", indexnow: "No fixed limit", openrouter: "Daily", commoncrawl: "New release about monthly", ahrefs: "Monthly, per your plan" };

  // The paid price shows once, under Price: a Limit that ends in ", then $1.50 per 1,000" leaves that part out.
  const reEsc = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutPrice = (text, tool) => (tool?.price ? text.replace(new RegExp(`,\\s*(?:then|puis)\\s+${reEsc(t(tool.price))}\\s*$`), "") : text);
  function connFacts(c, tool) {
    const fact = (label, value) => `<div><dt>${t(label)}</dt><dd>${value}</dd></div>`;
    const runs = { site: "Daily, automatically", serp: tool?.manualOnly ? "Only if picked in Refresh" : "On Refresh only", extra: "Only when used" }[c.group];
    const engines = tool ? tool.engines.map((e) => `<span class="fact-engine">${logo(e, 14)}${esc(ENGINES.find(([id]) => id === e)?.[1] || e)}</span>`).join("") : "";
    return `<dl class="conn-facts">
      ${fact("Status", connStatus(c))}
      ${fact("Price", `<span class="tag">${esc(t(c.price))}</span>${tool?.price ? ` <span class="small sec">${t("after that")} ${esc(t(tool.price))}</span>` : ""}`)}
      ${fact("Limit", esc(withoutPrice(t(c.limit), tool)))}
      ${fact("Refills", esc(t(RESETS[c.id] || "Not published")))}
      ${fact("Runs", esc(t(runs)))}
      ${engines ? fact("Engines", `<span class="fact-engines">${engines}</span>`) : ""}
      ${fact("Used by", esc(sitesWord(c)))}
    </dl>
    ${window.KW_REAL?.connExtras?.(c) || ""}
    ${c.status === "failing" ? (window.FIX && c.error ? window.FIX.html(c.error, { tool: t(c.name).split(":")[0], id: c.id, keyUrl: window.FIX.keyUrl(c), refills: RESETS[c.id] ? t(RESETS[c.id]) : "", retry: "test", robot: c.robot }, { id: "conn-fix", summary: true, said: true })
      : `<p class="note crit" style="margin:0 0 12px">${icon("octagon-alert")}<span>${t("Stopped working. Paste a new key or check its access, then press Test.")}</span></p>`) : ""}
    ${c.note ? `<p class="note" style="margin:0 0 12px">${icon("info")}<span>${esc(t(c.note))}${c.noteTip ? UI.tip(c.noteTip) : ""}</span></p>` : ""}`;
  }

  // Which property each site uses. Empty means the site doesn't use it, and that's fine.
  function googleChoices(c) {
    c.props = c.props || {};
    // With nothing connected there's nothing to offer: a filled-in number looks the same as a right one.
    window.SITES.forEach((s, i) => { c.props[s.id] = c.props[s.id] || (state.served ? { sc: "", ga4: "" } : { sc: `sc-domain:${s.host}`, ga4: String(3120000 + i * 417) }); });
    return c.props;
  }

  function propSelect(kind, label, site, value, options) {
    const list = [...new Set([...options, ...(value ? [value] : [])])];
    return `<label class="prop-field"><span class="small sec">${label}</span>
      <select class="select" data-prop="${kind}" data-site="${site.id}" aria-label="${esc(site.host)}: ${label}">
        ${list.map((o) => `<option value="${esc(o)}" ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("")}
        <option value="" ${value ? "" : "selected"}>${t("Not used")}</option>
        <option value="__other">${t("Type another…")}</option>
      </select>
      <input class="input mono" spellcheck="false" autocapitalize="off" autocomplete="off" data-prop-other="${kind}" data-site="${site.id}" hidden placeholder="${kind === "sc" ? "sc-domain:example.com" : "123456789"}" aria-label="${esc(site.host)}: ${label}"></label>`;
  }

  function googleSitesBlock(c) {
    const props = googleChoices(c);
    const scOptions = [...new Set([...(window.LIVE?.scOptions?.() || []), ...window.SITES.flatMap((s) => [`sc-domain:${s.host}`, `https://${s.host}/`])])];
    const gaOptions = state.served ? (window.LIVE?.gaOptions?.() || []) : window.SITES.map((s, i) => String(3120000 + i * 417));
    // Arriving from one site's checklist, show that site.
    const focus = state.connHost ? window.SITES.filter((s) => s.host === state.connHost) : [];
    state.connHost = null;
    const shownSites = focus.length ? focus : window.SITES;
    return `<h3>${t("Which site uses what")}</h3>
      <p class="help" style="margin:0 0 8px">${t("Not used is fine: no alert is raised.")}${window.UI.tip("A site that doesn't have one can choose Not used. It just won't show that data, and no alert is raised.")}</p>
      <div class="prop-list">${shownSites.map((s) => `<div class="prop-row"><div class="mono small prop-site">${esc(s.host)}</div><div class="prop-pair">${propSelect("sc", "Search Console", s, props[s.id].sc, scOptions)}${propSelect("ga4", "GA4", s, props[s.id].ga4, gaOptions)}</div>${window.LIVE?.connectionSelect?.(s) || ""}</div>`).join("")}</div>`;
  }

  function perSiteBlock(c, keyInput) {
    return `<h3>${t("Which site uses what")}</h3>
      <p class="help" style="margin:0 0 8px">${t("One token per site. A site without one raises no alert.")}${window.UI.tip("A site that doesn't have a token is fine: it just won't show that data, and no alert is raised.")}</p>
      ${window.SITES.map((s) => { const unused = c.sites !== "all" && !c.sites.includes(s.id); return `<div class="token-row">${keyInput(`conn-token-${s.id}`, s.host, c.last4?.[s.id])}<label class="opt small"><input type="checkbox" class="chk" style="margin:0" data-site-none="${s.id}" ${unused ? "checked" : ""}>${t("Not used")}</label></div>`; }).join("")}`;
  }

  function syncSiteNone() {
    $$("[data-site-none]").forEach((box) => { const input = $(`#conn-token-${box.dataset.siteNone}`); if (input) input.disabled = box.checked; });
    $$("[data-prop]").forEach((sel) => { const other = $(`[data-prop-other="${sel.dataset.prop}"][data-site="${sel.dataset.site}"]`); if (other) other.hidden = sel.value !== "__other"; });
  }

  let connPrimary = null; // settingsPage: the one Connect button drawn as the main action
  function connRow(c, index, count) {
    const tool = c.tool ? window.TOOLS.find((x) => x.name === c.tool) : null;
    // A working row shows a tick, its word on hover. Not connected says nothing: the Connect button beside it says it.
    // Failing keeps its red words and time. The panel's facts keep every word.
    const okWord = c.status === "ok" ? t("Connected") : c.status === "nokey" ? t("No key needed") : "";
    const st = okWord ? `<span class="status good conn-ok" role="img" data-tip="${esc(okWord)}" aria-label="${esc(okWord)}">${icon("circle-check")}</span>` : c.status === "off" ? "" : connStatus(c);
    // A search tool shows its engines as logos, the names on hover; the sentence stays on hover and in the panel head.
    const engines = c.group === "serp" && tool?.engines?.length ? tool.engines.map((e) => ENGINES.find(([id]) => id === e)?.[1]).filter(Boolean) : [];
    const desc = engines.length
      ? `<div class="d conn-engines" title="${esc(t(c.desc))}">${engines.map((name) => window.UI.logoOnly(name, name)).join("")}</div>`
      : `<div class="d">${esc(t(c.desc))}</div>`;
    // Sites only where a tool isn't on every site.
    const sitesCell = c.sites === "all" ? "" : `${icon("globe", "muted")} ${esc(c.sites.length ? `${c.sites.length} ${t("of")} ${window.SITES.length} ${t("Sites").toLowerCase()}` : t("No sites"))}`;
    const left = tool && tool.left !== null && c.status === "ok"
      ? `<div class="meter" role="img" aria-label="${num(tool.left)} ${t("of")} ${num(tool.of)} ${t("left")}"><i style="width:${Math.max(2, (tool.left / tool.of) * 100)}%"></i></div><div class="small muted" style="margin-top:3px">${num(tool.left)} ${t("of")} ${num(tool.of)} ${t("left")} · ${t(tool.refills)}</div>` : "";
    const order = c.group === "serp" ? `<div class="order"><button class="icon-btn" data-tool-move="-1" data-tool="${esc(c.tool)}" aria-label="${t("Move up")}: ${esc(t(c.name))}" ${index === 0 ? "disabled" : ""}>${icon("arrow-up")}</button><button class="icon-btn" data-tool-move="1" data-tool="${esc(c.tool)}" aria-label="${t("Move down")}: ${esc(t(c.name))}" ${index === count - 1 ? "disabled" : ""}>${icon("arrow-down")}</button></div>` : "";
    return `<li class="conn-row ${order ? "ordered" : ""}" id="conn-${c.id}" data-conn-open="${c.id}">
      ${order}${logo(c.logo || c.name, 34, "conn-logo")}
      <div class="what"><div class="t" dir="auto">${esc(t(c.name))}</div>${desc}</div>
      <div class="conn-limit"><span class="tag">${esc(t(c.price))}</span> ${esc(t(c.limit))}${left}</div>
      <div class="conn-sites" ${sitesCell ? `title="${esc(sitesWord(c))}"` : ""}>${sitesCell}</div>
      <div class="conn-status">${st}</div>
      <div class="acts"><button class="btn btn-small ${c.status === "off" && c.id === connPrimary ? "btn-main" : ""}" data-conn="${c.id}" aria-label="${esc(`${t(c.status === "off" ? "Connect" : c.status === "nokey" ? "Details" : "Manage")}: ${t(c.name)}`)}">${t(c.status === "off" ? "Connect" : c.status === "nokey" ? "Details" : "Manage")}</button></div>
    </li>`;
  }

  /* As a plain file, the First run switch means nothing's connected yet, and leaving it brings the sample back. */
  let filledConnections = null;
  function applyFirstRun() {
    if (state.served) return;
    if (state.firstRun && !filledConnections) {
      filledConnections = { conns: window.CONNECTIONS.map((c) => ({ c, status: c.status })), tools: window.TOOLS.map((x) => ({ x, connected: x.connected })) };
      window.CONNECTIONS.forEach((c) => { if (c.status !== "nokey") c.status = "off"; });
      window.TOOLS.forEach((x) => { x.connected = false; });
    } else if (!state.firstRun && filledConnections) {
      filledConnections.conns.forEach(({ c, status: was }) => { c.status = was; });
      filledConnections.tools.forEach(({ x, connected }) => { x.connected = connected; });
      filledConnections = null;
    }
  }

  function settingsPage() {
    const list = window.CONNECTIONS;
    const on = list.filter((c) => c.status === "ok" || c.status === "nokey").length;
    const failing = list.filter((c) => c.status === "failing").length;
    // Credits from different tools aren't the same thing, so they aren't added up. What matters is which runs out first.
    const lowest = window.TOOLS.filter((x) => x.connected && x.left !== null && x.left !== undefined && x.of).sort((a, b) => a.left / a.of - b.left / b.of)[0];
    const group = (key) => (key === "serp" ? window.TOOLS.map((x) => connFor(x.name)) : list.filter((c) => c.group === key));
    // One main button: only the next source still to connect is blue, in the order the cards show them. The rest stay plain.
    connPrimary = ["site", "serp", "extra"].flatMap(group).find((c) => c && c.status === "off")?.id ?? null;
    const card = (key, title, hint) => { const items = group(key); return `<section class="card"><div class="card-head"><h2>${t(title)}</h2><div class="hint-text">${t(hint)}</div>${key === "serp" ? window.KW_REAL?.orderPicker?.() || "" : ""}</div><ul class="rows">${items.map((c, i) => connRow(c, i, items.length)).join("")}</ul></section>`; };
    return topbar(t("Settings"), t("Connect tools and choose their sites"), "", false) + `
      <div class="content page-enter">
        <section class="tiles" id="set-tiles">
          ${tile(t("Connected"), cnt(on), `<span class="ab">${t("of")} ${list.length}</span>`, { ic: "link-2" })}
          ${tile(t("Running out first"), lowest ? cnt(lowest.left) : "—", lowest ? `<span class="ab">${t("of")} ${num(lowest.of)} · ${esc(t(lowest.name))}</span>` : `<span class="ab">${t("No credit tools connected")}</span>`, { ic: "sparkles" })}
          ${failing ? tile(t("Needs a fix"), `<span class="crit">${cnt(failing)}</span>`, status("crit", t("Failing")), { ic: "triangle-alert", tone: "serious" })
            : tile(t("Needs a fix"), "0", `<span class="ab">${t("Nothing to fix")}</span>`, { ic: "circle-check", tone: "neutral" })}
        </section>
        <div class="tabs" role="tablist" aria-label="${t("Settings")}">${window.LIVE?.tabs?.() || `<button class="tab" role="tab" aria-selected="true">${t("Connections")}</button><span class="tab tab-soon" role="tab" aria-selected="false" aria-disabled="true">${t("Sites")}<span class="soon-tag">${t("Soon")}</span></span><span class="tab tab-soon" role="tab" aria-selected="false" aria-disabled="true">${t("Team")}<span class="soon-tag">${t("Soon")}</span></span>`}</div>
        ${card("site", "Your site data", "Runs daily once connected.")}
        ${card("serp", "Rankings: Refresh tools", "Refresh tries these in order, free first. Reorder with the arrows.")}
        ${card("extra", "Extras", "Optional, off until connected.")}
        ${window.AI_SETTINGS?.card?.() || ""}
      </div>`;
  }

  function connectionPanel(id, opener) {
    const c = window.CONNECTIONS.find((x) => x.id === id);
    const tool = c.tool ? window.TOOLS.find((x) => x.name === c.tool) : null;
    const keyInput = (fieldId, label, last4 = "") => `<label class="field"><span>${t(label)}</span><span class="key-field"><input class="input mono" id="${fieldId}" data-key-input type="password" autocomplete="off" spellcheck="false" placeholder="${last4 ? `•••• •••• ${esc(last4)}` : t("Paste the key")}"><button type="button" class="icon-btn" data-key-show aria-label="${t("Show key")}">${icon("eye")}</button></span></label>`;
    // A step is a plain sentence, or { title, text, code, url, link } when it has more to show.
    const stepList = (list) => `<ol class="steps guide-steps">${list.map((item) => {
      const s = typeof item === "string" ? { text: item } : item;
      return `<li>${s.title ? `<b class="step-title">${esc(t(s.title))}</b>` : ""}${esc(t(s.text))}${s.code ? `<span class="copy-row"><code class="mono" dir="ltr">${esc(s.code)}</code><button type="button" class="btn btn-small" data-copy="${esc(s.code)}">${t("Copy")}</button></span>` : ""}${UI.stepLink(s)}</li>`;
    }).join("")}</ol>`;
    let fields = "";
    if (c.auth === "key" || c.auth === "key+zone") fields = keyInput("conn-key", "API key", c.last4) + (c.auth === "key+zone" ? `<label class="field"><span>${t("Zone name")}</span><input class="input mono" spellcheck="false" autocapitalize="off" autocomplete="off" id="conn-zone" aria-describedby="conn-zone-help" value="${esc(c.zone ?? (c.status === "ok" ? "serp_api1" : ""))}"></label>
      <p class="help" id="conn-zone-help" style="margin:-6px 0 12px">${t("Your SERP API's name, such as serp_api1.")}${UI.tip("In the control panel, open that SERP API: the zone name and the API key are on its Overview tab.")} <a class="ext-link" href="https://brightdata.com/cp/zones" target="_blank" rel="noopener noreferrer">${icon("external-link")}${t("My zones")}</a></p>` : "");
    else if (c.auth === "url") fields = `<label class="field"><span>${t("Address")}</span><input class="input mono" type="url" inputmode="url" spellcheck="false" autocapitalize="off" autocomplete="off" id="conn-url" data-key-input placeholder="https://"></label>`;
    else if (c.auth === "per-site") fields = perSiteBlock(c, keyInput);
    else if (c.auth === "browser") fields = `<label class="field"><span>${t("This Mac's country")}</span><select class="select" id="conn-country" style="width:100%">${countryOptions(c.country || "AE")}</select></label><p class="help" style="margin:-4px 0 12px">${t("Results count for this country only.")}${window.UI.tip("For any other country they stay on a separate line and are never mixed in.")}</p>`;
    else if (c.auth === "google") {
      // Pick the kind first, then only that path: the steps sit above the boxes they fill. A connection already made stays on its own kind.
      // Adding another on the real app starts clean, on the suggested kind: the boxes aren't the saved connection's.
      const fresh = c.status === "off" || state.served, robot = fresh, keep = (last4) => (fresh ? "" : last4);
      const guide = (path) => `${stepList(path.steps)}
        <p class="note">${icon("info")}<span>${t(path.note)}</span></p>`;
      const notBuilt = window.LIVE?.googleExtras?.() || "";
      // With a connection already made, adding another is the rare case: it waits behind one button, so the panel opens on what's there.
      const addForm = `<p class="note">${icon("info")}<span>${t("Done once, by whoever runs Google for the team. About 20 minutes.")}</span></p><fieldset class="scope key-kinds"><legend>${t("Which kind of key?")}</legend>
          <label class="opt"><input type="radio" name="google-type" value="robot" ${robot ? "checked" : ""}><span><b>${t("Robot key")}</b> <span class="tag">${t("Suggested")}</span><span class="second">${t("A Google service account. No token, never expires.")}</span></span></label>
          <label class="opt"><input type="radio" name="google-type" value="oauth" ${robot ? "" : "checked"}><span><b>${t("OAuth keys")}</b><span class="second">${t("Client ID, secret and refresh token from your Google account. More steps.")}</span></span></label></fieldset>
        <div id="google-robot" ${robot ? "" : "hidden"}>${c.status === "off" ? guide(window.GOOGLE_GUIDE.robot) : `<details class="fold how"><summary>${icon("chevron-right")}${t("How to get these keys")}</summary>${guide(window.GOOGLE_GUIDE.robot)}</details>`}
          <label class="field"><span>${t("Robot key file (JSON)")}</span><textarea class="input mono" id="conn-json" data-key-input rows="4" spellcheck="false" autocomplete="off" autocapitalize="off" aria-describedby="conn-json-result" placeholder="${esc(window.LIVE?.savedGoogleNote?.() || t("Paste the JSON key"))}"></textarea></label><div id="conn-json-result" role="status"></div></div>
        <div id="google-oauth" ${robot ? "hidden" : ""}>${c.status === "off" ? guide(window.GOOGLE_GUIDE.oauth) : `<details class="fold how"><summary>${icon("chevron-right")}${t("How to get these keys")}</summary>${guide(window.GOOGLE_GUIDE.oauth)}</details>`}${keyInput("conn-client", "Client ID", keep("a81f"))}${keyInput("conn-secret", "Client secret", keep("77c0"))}${keyInput("conn-refresh", "Refresh token", keep("e219"))}</div>`;
      fields = `${notBuilt}${c.status === "off" ? addForm : `<details class="fold add-google"><summary>${icon("plus")}${t("Add another Google connection")}</summary>${addForm}</details>`}
        ${googleSitesBlock(c)}`;
    } else fields = `<p class="note">${icon("info")}<span>${t("Nothing to paste.")}</span></p>`;
    const canTest = c.auth !== "none" && c.auth !== "browser";
    const perSite = c.auth === "google" || c.auth === "per-site" || Boolean(window.KW_REAL && c.group === "serp") || Boolean(window.LIVE?.appWide?.(c)); // their list above says which site uses it. A real search tool, or a key for the whole app, serves every site.
    const on = c.sites === "all" ? [] : c.sites;
    const howWord = c.auth === "browser" ? "How to use it" : c.auth === "none" ? "How it works" : "How to connect";
    const credits = tool && tool.left !== null ? `<h3>${t("Credits")}</h3><div class="meter" style="max-width:none"><i style="width:${Math.max(2, (tool.left / tool.of) * 100)}%"></i></div><p class="small sec" style="margin-top:5px">${num(tool.left)} ${t("of")} ${num(tool.of)} ${t("left")} · ${t(tool.refills)}</p>` : ""; // the price after that is said once, under Price
    const steps = c.steps.length;
    const lead = logo(c.logo || c.name, 34, "panel-lead");
    openPanel(`${panelHead(t(c.name), esc(t(c.desc)), lead)}
      <form class="panel-body" id="conn-form" novalidate>
        ${connFacts(c, tool)}
        ${fields}
        ${canTest ? `<p class="help" style="margin:-4px 0 10px">${t("Stored encrypted; only the last 4 characters show.")}</p><div class="test-row"><button type="button" class="btn btn-small" id="conn-test">${t("Test")}</button><span id="conn-test-result" role="status"></span></div>` : ""}
        ${credits}
        ${perSite ? "" : `<fieldset class="scope" style="margin-top:16px"><legend>${t("Which sites?")}</legend>
          <label class="opt"><input type="radio" name="conn-scope" value="all" ${c.sites === "all" ? "checked" : ""}>${t("All sites, also new ones")}</label>
          <label class="opt"><input type="radio" name="conn-scope" value="some" ${c.sites === "all" ? "" : "checked"}>${t("Only these sites")}</label>
          <div class="site-checks" id="conn-site-checks" ${c.sites === "all" ? "hidden" : ""}>${window.SITES.map((s) => `<label class="opt"><input type="checkbox" class="chk" style="margin:0" data-conn-site="${s.id}" ${on.includes(s.id) ? "checked" : ""}>${esc(s.host)}</label>`).join("")}</div>
          <p class="help" style="margin:6px 0 0">${t("Sites left out won't use it.")}</p>
        </fieldset>`}
        ${!steps ? "" : `<details class="fold how" ${canTest && c.status !== "off" ? "" : "open"}><summary>${icon("chevron-right")}${t(howWord)}<span class="hint">${steps} ${t(steps === 1 ? "step" : "steps")}</span></summary>
          ${stepList(c.steps)}
          ${c.risk ? `<p class="note warn" style="margin:0 0 10px">${icon("triangle-alert")}<span>${esc(t(c.risk))}${c.riskTip ? UI.tip(c.riskTip) : ""}</span></p>` : ""}
          ${c.url && !c.steps.some((s) => s.url) ? `<p style="margin:0 0 10px"><a class="ext-link" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${icon("external-link")}${t("Official page")}</a></p>` : ""}
        </details>`}
        ${window.LIVE?.oldClarityData?.(c) || ""}
      </form>
      <div class="panel-foot"><button class="btn btn-main" id="conn-save" data-id="${c.id}">${t("Save")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button>${c.status === "ok" || c.status === "failing" ? `<button class="btn btn-ghost danger" id="conn-disconnect" data-id="${c.id}">${t("Disconnect")}</button>` : ""}</div>`,
    opener, { key: `conn|${id}`, reopen: () => connectionPanel(id, opener), after: () => { syncConnScope(); syncSiteNone(); syncGoogleKind(); } });
  }

  // A restored draft can bring back the other kind of key.
  function syncGoogleKind() {
    const kind = $('input[name="google-type"]:checked')?.value;
    if (!kind) return;
    $("#google-oauth").hidden = kind !== "oauth";
    $("#google-robot").hidden = kind !== "robot";
  }
  // A key file holds the robot's email. Showing it saves digging through the file for step 6, and proves the paste was whole.
  function readRobotKey() {
    const box = $("#conn-json"), raw = box?.value.trim();
    if (!raw) return { empty: true };
    try {
      const key = JSON.parse(raw);
      if (typeof key.client_email === "string" && key.client_email.includes("@") && key.private_key) return { email: key.client_email };
    } catch { /* falls through to the same message */ }
    return { bad: true };
  }
  function syncRobotEmail() {
    const out = $("#conn-json-result"), key = readRobotKey();
    if (!out) return;
    $("#conn-json").classList.toggle("invalid", !!key.bad);
    $("#conn-json").setAttribute("aria-invalid", key.bad ? "true" : "false");
    setHTML(out, key.bad ? `<div class="error" role="alert">${icon("octagon-alert")}<span>${t("That isn't the whole key file. Paste everything in the file, from the first { to the last }.")}</span></div>`
      : key.email ? `<p class="small sec" style="margin:0 0 6px">${t("Add this email in Search Console and Google Analytics")}</p><span class="copy-row"><code class="mono" dir="ltr">${esc(key.email)}</code><button type="button" class="btn btn-small" data-copy="${esc(key.email)}">${t("Copy")}</button></span>` : "");
  }

  function syncConnScope() {
    const box = $("#conn-site-checks");
    if (box) box.hidden = !$('input[name="conn-scope"][value="some"]')?.checked;
  }

  function openConnection(id) {
    const open = () => { connectionPanel(id); $(`#conn-${id}`)?.scrollIntoView({ block: "center" }); };
    if (state.route === "settings") open(); else { go("settings", { noFocus: true }); open(); }
  }

  const closeNav = () => $("#app").classList.remove("nav-open");
  // The links tab may never have been opened (Monthly health test comes first, and Competitors has this button too): ask which API first, or a served page only adds the site to the sample.
  const addSiteNow = async (address, kind, rivalOf) => {
    // A competitor belongs to one of my websites. Saved any other way, it wouldn't show under My competitors.
    if (kind === "competitor" && (await COMP.isServer())) {
      if (!rivalOf) throw new Error("Add your own website first, then its competitors.");
      const owner = (await COMP.api("GET", "links/sites")).sites.find((s) => s.host === rivalOf);
      if (!owner) throw new Error("That website isn't saved yet.");
      if (!address.trim()) throw new Error("Type the website's address.");
      return { ...(await COMP.api("POST", "competitors", { site_id: owner.id, address })), rivalOf };
    }
    if (!lc.api) lc.api = await pickLinksApi();
    return lc.api.addSite(address, kind);
  };

  // ---- events ------------------------------------------------------------------------
  document.addEventListener("click", (e) => {
    const target = e.target;
    const hit = (sel) => target.closest?.(sel);
    let el;
    if (performance.now() < ignoreClicksUntil) return;

    // Clicking away only closes the menu. It must not also press whatever is underneath.
    if ($("#popover") && !hit("#popover") && !hit("#site-switch") && !hit("#acct-btn") && !hit("#columns") && !hit("#period") && !hit("#compare") && !hit("[data-pop-toggle]")) { closePopover(); return; }
    if ($("#app").classList.contains("nav-open") && !hit("#sidebar") && !hit("#menu-btn")) closeNav();

    if ((el = hit("[data-mock]"))) {
      const key = el.dataset.mock, v = el.dataset.v;
      if (hit("#popover")) closePopover(); // from the account menu: its words would be out of date after the switch
      const apply = () => {
        if (key === "firstRun") { state.firstRun = v === "true"; state.setupHidden = false; state.selected.clear(); resetLinks(); applyFirstRun(); } else state[key] = v;
        closePanel();
        render();
      };
      if ((key === "look" || key === "theme") && document.startViewTransition && !reduceMotion()) document.startViewTransition(apply); else apply();
      return;
    }

    // Site health tabs
    if ((el = hit("[data-health-tab]"))) { state.healthTab = el.dataset.healthTab; render(); return; }

    // Links checker
    if ((el = hit("[data-setup-panel]"))) { openSiteSetup(el.dataset.setupPanel, el); return; }
    if ((el = hit("[data-setup-hide]"))) { store.set("setupHidden", JSON.stringify([...setupHidden(), el.dataset.setupHide])); render(); toast(t("Hidden. Still on the site's own Today."), { kind: "info" }); return; }
    if ((el = hit("[data-setup]")) && el.dataset.setup !== "site") { runSetupStep(el.dataset.setup, el.dataset.setupHost || setupHost()); return; }
    if (hit("#lc-retry")) { lc.ready = false; render(); reloadLinkSites().then(() => render()); return; }
    if (hit("#site-add") || hit("[data-add-site]")) { closePopover(); addSitePanel(hit("#site-add") || $("#site-switch")); return; }
    if ((el = hit("#site-save"))) {
      const address = $("#site-address").value, kind = $('input[name="site-kind"]:checked')?.value;
      el.disabled = true; // a double click adds it once
      try {
        const made = addSiteNow(address, kind, $("#site-rival-site")?.value);
        made.then(async (site) => {
          forgetPanelForm();
          closePanel();
          if (!lc.started) { lc.api = await pickLinksApi(); lc.started = true; }
          await reloadLinkSites(kind === "own" ? site.id : null);
          window.dispatchEvent(new CustomEvent("seocc:site-added", { detail: { ...site, kind } }));
          let listed = null;
          if (kind === "own") {
            // On the real API the site joins the menu's list by its address. Its own try, because the catch below is for the form, and that's closed now.
            try { if (await COMP.isServer()) noteRealSites((await COMP.api("GET", "links/sites")).sites); } catch { /* it stays out of the menu until the next load */ }
            COMP.refreshLogos?.({ watch: true }); // its icon arrives about a minute later
            listed = window.SITES.find((s) => s.host === site.host) || null;
            if (listed) state.site = listed.id;
          }
          render();
          toast(kind === "own" ? `${site.host}: ${t("added as your site")}` : site.rivalOf ? `${site.host}: ${t("added as a competitor of")} ${site.rivalOf}` : `${site.host}: ${t("added as a competitor (not in the links checker).")}`);
          if (listed) openSiteSetup(listed.host);
        }).catch((err) => {
          el.disabled = false;
          if (!$("#site-address")) { toast(t(err.message), { kind: "crit" }); return; } // the form has closed: it was saved, and something after that failed
          $("#site-address").classList.add("invalid");
          setHTML($("#site-error"), `<div class="error" role="alert">${icon("octagon-alert")}<span>${esc(t(err.message))}</span></div>`);
          $("#site-address").focus();
        });
      } catch (err) { el.disabled = false; toast(err.message, { kind: "crit" }); }
      return;
    }
    if (hit("#lc-run")) { runLinkCheck(); return; }
    if (hit("#lc-stop")) {
      lc.stopping = true;
      const btn = hit("#lc-stop");
      btn.disabled = true;
      btn.textContent = t("Stopping…");
      paintLinkProgress();
      lc.api.stop(lc.activeId).catch(() => {});
      return;
    }
    if ((el = hit("[data-lc-jump]"))) { e.preventDefault(); $(`.lc-group[data-group="${el.dataset.lcJump}"]`)?.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" }); return; }
    if ((el = hit("[data-lc-open]"))) {
      const id = el.dataset.lcOpen;
      lc.api.scan(/^\d+$/.test(id) ? Number(id) : id).then((data) => { lc.open = data; render(); $(".lc-result")?.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" }); }).catch((err) => toast(t(err.message), { kind: "crit" }));
      return;
    }
    if ((el = hit("[data-lc-delete]"))) {
      $("#dlg").classList.remove("wide");
      setHTML($("#dlg"), `<div class="dlg-head"><h2 id="dlg-title">${t("Delete this scan?")}</h2><button class="icon-btn" data-close-dlg aria-label="${t("Close")}">${icon("x")}</button></div><div class="dlg-body"><p>${t("Its results are deleted for good.")}</p></div><div class="dlg-foot"><button class="btn" data-close-dlg>${t("Cancel")}</button><button class="btn btn-danger" id="lc-delete-confirm" data-id="${esc(el.dataset.lcDelete)}">${icon("trash-2")}${t("Delete")}</button></div>`);
      $("#dlg").showModal();
      return;
    }
    if ((el = hit("#lc-delete-confirm"))) {
      const id = /^\d+$/.test(el.dataset.id) ? Number(el.dataset.id) : el.dataset.id;
      $("#dlg").close();
      ignoreClicksUntil = performance.now() + 400;
      lc.api.remove(id).then(async () => {
        if (lc.open && lc.open.scan.id === id) lc.open = null;
        await loadLinkHistory({ openLatest: !lc.open });
        toast(t("Scan deleted"), { kind: "info" });
      }).catch((err) => toast(t(err.message), { kind: "crit" }));
      return;
    }

    // The head's chips that open a panel with a function (UI.head's open)
    if ((el = hit("[data-head-open]"))) { const fn = headOpeners.get(el.dataset.headOpen); if (fn) { try { fn(el); } catch (err) { console.error(err); } } return; }
    // Dates
    if ((el = hit("#period"))) { if (popAnchor === el) closePopover({ focus: true }); else openDatePicker(el); return; }
    if ((el = hit("#compare"))) {
      if (popAnchor === el) { closePopover({ focus: true }); return; }
      popover(el, RANGE_COMPARES.map(([id, name]) => { const on = state.rng.compare === id; return `<button type="button" data-compare="${esc(id)}" aria-pressed="${on}" ${on ? "data-autofocus" : ""}>${t(state.simple && id === "yoy" ? "vs same days last year" : name)}${on ? `<span class="tick">${icon("check")}</span>` : ""}</button>`; }).join(""));
      return;
    }
    // The simpler head: a choice made in More's picker goes back to More, and a period button keeps the focus it had.
    if ((el = hit("[data-compare]"))) { const fromMore = state.simple && el.closest(".dp"); closePopover(); rangeSet({ compare: el.dataset.compare }); $(fromMore ? "#period" : "#compare")?.focus(); return; }
    if ((el = hit("[data-preset]"))) { const inHead = state.simple && el.closest(".head-period"); closePopover(); rangeSet({ preset: el.dataset.preset }); $(inHead ? `.head-period [data-preset="${CSS.escape(el.dataset.preset)}"]` : "#period")?.focus(); return; }
    if ((el = hit("[data-dp-move]"))) {
      dp.right = addMonths(dp.right, Number(el.dataset.dpMove));
      const move = el.dataset.dpMove;
      renderCal();
      $(`[data-dp-move="${move}"]`)?.focus();
      return;
    }
    if ((el = hit("[data-day]"))) {
      const day = el.dataset.day;
      if (dp.phase === "start") { dp.from = dp.to = day; dp.phase = "end"; } else {
        if (day < dp.from) { dp.to = dp.from; dp.from = day; } else dp.to = day;
        dp.phase = "start"; dp.hover = null;
      }
      dp.focus = day;
      paintRange();
      updateDpSum();
      $$(".dp-day").forEach((b) => { b.tabIndex = b.dataset.day === day ? 0 : -1; });
      return;
    }
    if (hit("#dp-apply")) { const { from, to } = dp; closePopover(); rangeSet({ preset: "custom", from, to }); $("#period")?.focus(); return; }
    if (hit("[data-dp-cancel]")) { closePopover({ focus: true }); return; }


    // Settings
    if ((el = hit("[data-conn]"))) { connectionPanel(el.dataset.conn, el); return; }
    if ((el = hit("[data-conn-open]")) && !hit("button, a, input, select, label")) { connectionPanel(el.dataset.connOpen, el.querySelector("[data-conn]")); return; }
    if ((el = hit("[data-conn-tool]"))) { $("#dlg").close(); openConnection(connFor(el.dataset.connTool).id); return; }
    if ((el = hit("[data-tool-move]"))) {
      const list = window.TOOLS, from = list.findIndex((x) => x.name === el.dataset.tool), to = from + Number(el.dataset.toolMove);
      if (to < 0 || to >= list.length) return;
      list.splice(to, 0, list.splice(from, 1)[0]);
      const name = el.dataset.tool, move = el.dataset.toolMove;
      render();
      const again = $$("[data-tool-move]").find((b) => b.dataset.tool === name && b.dataset.toolMove === move);
      (again && !again.disabled ? again : $$("[data-tool-move]").find((b) => b.dataset.tool === name && !b.disabled))?.focus();
      return;
    }
    if ((el = hit("[data-key-show]"))) { const input = el.parentElement.querySelector("input"); input.type = input.type === "password" ? "text" : "password"; return; }
    if ((el = hit("[data-copy]"))) {
      const text = el.dataset.copy;
      (navigator.clipboard?.writeText(text) ?? Promise.reject()).then(() => toast(t("Copied")), () => toast(t("Couldn't copy. Copy it by hand."), { kind: "info" }));
      return;
    }
    if (hit("#conn-test")) {
      const box = $("#conn-test-result"), btn = hit("#conn-test");
      const id = $("#conn-save").dataset.id, c = window.CONNECTIONS.find((x) => x.id === id);
      const typed = $$("[data-key-input]").some((i) => i.value.trim());
      if (!typed && c.status === "off") { setHTML(box, `<span class="error" style="margin:0">${icon("octagon-alert")}${t("Paste the key first.")}</span>`); return; }
      // Served by the real app, nothing here reaches the tool yet, so it mustn't say the key works. Sample mode keeps its demo answer.
      if (state.served) {
        setHTML(box, `<span class="note warn inline-note">${icon("triangle-alert")}<span>${t(id === "serpapi" ? "Not checked. Save it; the first search shows if it works." : "This tool can't be connected yet. Key not checked.")}</span></span>`);
        return;
      }
      setHTML(btn, icon("refresh-cw", "spin"));
      setHTML(box, "");
      setTimeout(() => {
        if (!btn.isConnected) return;
        btn.textContent = t("Test");
        const tool = c.tool ? window.TOOLS.find((x) => x.name === c.tool) : null;
        setHTML(box, status("good", `${t("Works.")}${tool && tool.left !== null ? ` ${num(tool.left)} ${t("of")} ${num(tool.of)} ${t("left")}` : ""}`));
      }, 800);
      return;
    }
    if ((el = hit("#conn-save"))) {
      const c = window.CONNECTIONS.find((x) => x.id === el.dataset.id);
      const untyped = $$("[data-prop]").find((sel) => sel.value === "__other" && !$(`[data-prop-other="${sel.dataset.prop}"][data-site="${sel.dataset.site}"]`).value.trim());
      if (untyped) {
        const other = $(`[data-prop-other="${untyped.dataset.prop}"][data-site="${untyped.dataset.site}"]`);
        other.classList.add("invalid");
        other.focus();
        toast(t("Type the property, or pick another option."), { kind: "crit" });
        return;
      }
      if (c.auth === "google" && readRobotKey().bad) { syncRobotEmail(); $("#conn-json").focus(); return; }
      const typed = $$("[data-key-input]").filter((i) => !i.disabled).map((i) => i.value.trim()).filter(Boolean);
      // A tool that needs a key can't be connected without one, so a blank Save says so beside the field and never "saved".
      if (["key", "key+zone", "url", "google"].includes(c.auth) && c.status === "off" && !typed.length) {
        const box = $("#conn-test-result");
        if (box) setHTML(box, `<span class="error" style="margin:0" role="alert">${icon("octagon-alert")}${t("Paste the key first.")}</span>`);
        const field = $$("[data-key-input]").find((i) => !i.disabled && i.offsetParent !== null);
        field?.classList.add("invalid");
        field?.focus();
        box?.scrollIntoView({ block: "nearest" });
        return;
      }
      const unbuilt = state.served && c.id !== "serpapi";
      if (typed.length && !unbuilt) {
        c.status = "ok";
        if (c.auth !== "per-site") c.last4 = typed[0].slice(-4);
        const tool = c.tool ? window.TOOLS.find((x) => x.name === c.tool) : null;
        if (tool) tool.connected = true;
      }
      const allOrThese = (ids) => (ids.length === window.SITES.length ? "all" : ids);
      if (c.auth === "google") {
        $$("[data-prop]").forEach((sel) => {
          const other = $(`[data-prop-other="${sel.dataset.prop}"][data-site="${sel.dataset.site}"]`);
          c.props[sel.dataset.site][sel.dataset.prop] = sel.value === "__other" ? other.value.trim() : sel.value;
        });
        c.sites = allOrThese(window.SITES.filter((s) => c.props[s.id].sc || c.props[s.id].ga4).map((s) => s.id));
      } else if (c.auth === "per-site") {
        c.sites = allOrThese(window.SITES.filter((s) => !$(`[data-site-none="${s.id}"]`)?.checked).map((s) => s.id));
      } else {
        const some = $('input[name="conn-scope"][value="some"]').checked;
        c.sites = some ? $$("[data-conn-site]").filter((x) => x.checked).map((x) => x.dataset.connSite) : "all";
      }
      if (c.auth === "browser") c.country = $("#conn-country").value;
      forgetPanelForm();
      closePanel();
      render();
      if (typed.length && unbuilt) { toast(t("This tool can't be connected yet. Key not kept."), { kind: "info" }); return; }
      toast(t("Connection saved"));
      $(`#conn-${c.id}`)?.classList.add("saved");
      return;
    }
    if ((el = hit("#conn-disconnect"))) {
      const c = window.CONNECTIONS.find((x) => x.id === el.dataset.id);
      const before = { status: c.status, last4: c.last4 };
      const tool = c.tool ? window.TOOLS.find((x) => x.name === c.tool) : null;
      c.status = "off"; c.last4 = "";
      if (tool) tool.connected = false;
      forgetPanelForm();
      closePanel();
      render();
      toast(t("Disconnected"), { kind: "info", undo: () => { Object.assign(c, before); if (tool) tool.connected = true; render(); } });
      return;
    }

    // Refresh options
    if ((el = hit("[data-ref-mode]"))) {
      refresh.mode = el.dataset.refMode;
      $$("[data-ref-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
      if (refresh.mode === "pick" && !refresh.picked.size) {
        // Start from what Automatic would have used, so the list isn't empty.
        refresh.mode = "auto";
        allocate().plan.forEach((p) => refresh.picked.add(p.tool));
        refresh.mode = "pick";
        $$("[data-ref-tool]").forEach((b) => { b.checked = refresh.picked.has(b.dataset.refTool); });
      }
      updateRefreshSummary();
      placeInks();
      el.focus();
      return;
    }

    // Bulk upload
    if ((el = hit("[data-add-mode]"))) {
      const opener = panelOpener;
      if (el.dataset.addMode === "bulk") { if (!$("#bulk-form")) bulkPanel(opener); } else if (!$("#bl-form")) addBacklinkPanel({}, opener);
      $(`[data-add-mode="${el.dataset.addMode}"]`)?.focus();
      return;
    }
    if (hit("#bulk-open")) { bulkPanel(hit("#bulk-open")); return; }
    if (hit("#bulk-browse")) { $("#bulk-file").click(); return; }
    if (hit("#bulk-template")) { downloadTemplate(); return; }
    if (hit("#bulk-sample")) { $("#bulk-text").value = window.BULK_SAMPLE; readBulk(window.BULK_SAMPLE); updateBulk(); return; }
    if (hit("#bulk-import")) { importBulk(); return; }
    if (hit("#bulk-download") && bulkLeftOver) {
      const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const text = [[...bulkLeftOver.headers, t("Why")], ...bulkLeftOver.rows].map((row) => row.map(cell).join(",")).join("\r\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(["\ufeff", text], { type: "text/csv;charset=utf-8" })); // the mark keeps accents right in Excel
      a.download = "backlinks-not-added.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    }

    if ((el = hit("[data-go]"))) { if (hit("#popover")) closePopover(); go(el.dataset.go); return; }
    if (hit("#acct-btn")) {
      if ($("#popover")) { closePopover(); return; }
      popover(hit("#acct-btn"), accountMenu(), "acct-menu");
      return;
    }
    if (hit("#rail-toggle")) {
      state.rail = !state.rail;
      // Remember the choice only when it differs from what this width does by itself.
      store.set("rail", state.rail === railWidth.matches ? "" : state.rail ? "1" : "0");
      render(); $("#rail-toggle")?.focus(); return;
    }
    if (hit("#menu-btn")) { $("#app").classList.toggle("nav-open"); return; }
    if (hit("#cmd-open")) { openCmd(); return; }
    if ((el = hit("[data-cmd]"))) { runCmd(Number(el.dataset.cmd)); return; }
    if (hit("#site-switch")) {
      if ($("#popover")) { closePopover(); return; }
      // Chosen access: "All sites" means all of theirs, so it only shows with two or more; adding a site is for those with every site.
      const allRow = window.ACCESS?.limited && window.SITES.length < 2 ? "" : `<button data-pick-site="all">${icon("globe")}${t("All sites")}</button><hr>`;
      const addRow = window.ACCESS?.limited ? "" : `<hr><button data-add-site>${icon("plus")}${t("Add a site")}</button>`;
      popover(hit("#site-switch"), `${allRow}${window.SITES.map((s) => `<button data-pick-site="${s.id}">${siteMark(s.host)}<span class="mono small">${esc(s.host)}</span></button>`).join("")}${addRow}`);
      return;
    }
    if ((el = hit("[data-pick-site]"))) { state.site = el.dataset.pickSite; closePopover(); render(); return; }
    if ((el = hit("[data-site]"))) { state.site = el.dataset.site; render(); return; }
    if (hit("#columns")) {
      if ($("#popover")) { closePopover(); return; }
      popover(hit("#columns"), Object.entries({ vol: "Impressions (28 days)", trend: "Trend", page: "Page", ai: "AI" }).map(([k, label]) => `<label class="opt" style="display:flex;padding:6px 8px;margin:0"><input type="checkbox" class="chk" style="margin:0" data-col="${k}" ${state.cols[k] ? "checked" : ""}>${t(label)}</label>`).join(""));
      return;
    }
    if ((el = hit("[data-toast]"))) { toast(t(el.dataset.toast), { kind: "info" }); closePopover(); return; }

    // Today
    if ((el = hit("[data-ack]"))) {
      const id = el.dataset.ack;
      state.seen.add(id);
      window.dispatchEvent(new CustomEvent("seocc:attention-seen", { detail: { id, seen: true } }));
      el.closest("li").style.opacity = "0";
      setTimeout(() => render(), reduceMotion() ? 0 : 150);
      toast(t("Marked as seen"), { undo: () => { state.seen.delete(id); window.dispatchEvent(new CustomEvent("seocc:attention-seen", { detail: { id, seen: false } })); render(); toast(t("Restored"), { kind: "info" }); } });
      return;
    }
    if (hit("#show-all")) { state.attentionAll = !state.attentionAll; render(); $("#show-all")?.focus(); return; }
    if ((el = hit("[data-act]"))) {
      const k = el.dataset.act;
      if (k === "fix") openConnection("google");
      else if (k === "clarity") toast(t("Clarity pull started"));
      else if (k === "backlinks") { state.blSection = "done"; state.blFilter = "lost"; state.blTab = "all"; go("backlinks"); }
      else if (k === "health") { state.healthTab = "test"; go("health"); }
      else if (k === "uptime") { state.healthTab = "uptime"; go("health"); }
      else if (k === "content") go("content");
      else toast(t("Not built yet"), { kind: "info" });
      return;
    }
    if ((el = hit("[data-diff]"))) { diffPanel(el.dataset.diff, el); return; }

    // Panels
    if (hit("[data-close-panel]")) { closePanel(); return; }
    if (hit("[data-discard-panel]")) {
      // Cancel means throw it away, but a slip can still be undone for a few seconds.
      const info = panelForm, typed = typedInPanel();
      forgetPanelForm();
      closePanel({ keep: false });
      if (typed) toast(t("Form cleared"), { kind: "info", undo: () => { drafts.set(info.key, typed); info.reopen(); } });
      return;
    }
    if (hit("#draft-clear")) { const { reopen } = panelForm; forgetPanelForm(); reopen(); return; }
    if ((el = hit("[data-recheck]"))) {
      const row = window.KEYWORDS.find((k) => k.k === state.panelKw);
      const entry = row.tools[Number(el.dataset.recheck)];
      // A check costs a credit. With few left, the first click asks.
      const left = creditsLeftOf(entry.tool);
      if (left !== null && left < 10 && !el.dataset.sure) { el.dataset.sure = "1"; el.textContent = `${t("Use 1 of")} ${num(left)}?`; return; }
      el.disabled = true;
      setHTML(el, icon("refresh-cw", "spin"));
      setTimeout(() => {
        entry.age = 0; entry.depth = entry.depth || 10;
        if (entry.p === null || entry.p === undefined) entry.p = row.res[engineOf()].p || 11;
        const e = engineOf(), res = row.res[e];
        // The result shows beside the first tool in the table straight away.
        if (e !== "google" && entry.tool !== res.tool) {
          res.also = (res.also || []).filter((x) => x.tool !== entry.tool);
          res.also.push({ tool: entry.tool, p: entry.p, age: 0, depth: entry.depth });
        }
        refreshKeywordPanel();
        const tr = $$("#kw-table tbody tr").find((r) => r.dataset.kw === row.k);
        if (tr) {
          const fresh = fragment(`<table><tbody>${keywordRow(row)}</tbody></table>`).querySelector("tr");
          fresh.classList.add("flash", "open");
          tr.replaceWith(fresh);
        }
        toast(t("Refreshed: {tool}").replace("{tool}", t(entry.tool)));
      }, 900);
      return;
    }
    if (hit("#chart-toggle")) {
      state.panelTable = !state.panelTable;
      refreshKeywordPanel();
      $("#chart-toggle")?.focus();
      return;
    }

    // Keywords
    if ((el = hit("[data-engine]"))) { state.engine = el.dataset.engine; state.filter = "all"; render(); $(`[data-engine="${state.engine}"]`)?.focus(); return; }
    if ((el = hit("[data-view]"))) { state.view = el.dataset.view; render(); $(`[data-view="${state.view}"]`)?.focus(); return; }
    if ((el = hit("[data-filter]"))) { state.filter = el.dataset.filter; render(); $(`[data-filter="${state.filter}"]`)?.focus(); return; }
    if ((el = hit("[data-sort]"))) {
      const key = el.dataset.sort;
      if (state.sort.key === key) state.sort.dir = state.sort.dir === "ascending" ? "descending" : "ascending";
      else state.sort = { key, dir: key === "vol" ? "descending" : "ascending" };
      render();
      $(`[data-sort="${key}"]`)?.focus();
      return;
    }
    if (hit("#density")) { state.dense = !state.dense; store.set("dense", state.dense ? "1" : "0"); render(); $("#density")?.focus(); return; }
    if ((el = hit("[data-deeper]"))) { openRefresh([el.dataset.deeper], [engineOf()], 20); return; }
    if ((el = hit("[data-open-kw]"))) { openKeyword(el.dataset.openKw, el); return; }
    if (hit("#open-refresh")) { openRefresh(state.selected.size ? [...state.selected] : filtered().map((k) => k.k)); return; }
    if (hit("#sel-refresh")) { openRefresh([...state.selected]); return; }
    if (hit("#sel-clear")) { state.selected.clear(); render(); return; }
    if (hit("#sel-task")) {
      const picked = [...state.selected];
      window.UI.openTask({ title: `${t("Keywords")}: ${picked.slice(0, 3).join(", ")}${picked.length > 3 ? ` +${picked.length - 3}` : ""}`, opener: hit("#sel-task"), keywords: picked, source: { type: "keyword", label: `${num(picked.length)} ${t(picked.length === 1 ? "keyword" : "keywords")}`, facts: picked.slice(0, 20), link: "#keywords" } });
      return;
    }
    if (hit("#ref-confirm")) { startRefresh(); return; }
    if (hit("[data-close-dlg]")) { $("#dlg").close(); return; }
    if (hit("#tray-cancel")) { if (run) { run.cancelled = true; setHTML(hit("#tray-cancel"), `${t("Stop")}…`); } return; }

    // Backlinks
    if ((el = hit("[data-bl-section]"))) { state.blSection = el.dataset.blSection; render(); $(`[data-bl-section="${state.blSection}"]`)?.focus(); return; }
    if (hit("#cleaner-open")) { openCleaner(); return; }
    if (hit("#cleaner-browse")) { $("#cleaner-file").click(); return; }
    if (hit("#cleaner-sample")) { runCleaner(new TextEncoder().encode(window.CLEANER_SAMPLE), "sample-semrush-export.csv"); return; }
    if (hit("#cleaner-again")) { renderCleanerPick(); $("#cleaner-browse")?.focus(); return; }
    if (hit("#cleaner-select-all")) { cleaner.picked = new Set(cleaner.result.rows.flatMap((row, i) => (cleanerSelectable(row) ? [i] : []))); updateCleanerSelection(); return; }
    if (hit("#cleaner-new-only")) { cleaner.picked = new Set(cleaner.result.rows.flatMap((row, i) => (row.duplicate_of || !cleanerSelectable(row) ? [] : [i]))); updateCleanerSelection(); return; }
    if (hit("#cleaner-clear")) { cleaner.picked = new Set(); updateCleanerSelection(); return; }
    if (hit("#cleaner-add")) { addPickedProspects(); return; }
    if (hit("#pr-move")) { window.LinkTodo.openMove(window.PROSPECTS.filter((p) => prPicked.has(p.id)), hit("#pr-move")); return; }
    if (hit("#pr-pick-clear")) { prPicked.clear(); $$("[data-prospect-pick]").forEach((b) => { b.checked = false; }); paintProspectPicks(); return; }
    if (hit("#pr-more-toggle")) { prMoreOpen = !prMoreOpen; $("#pr-more").hidden = !prMoreOpen; $("#pr-more-toggle").setAttribute("aria-expanded", String(prMoreOpen)); return; }
    if (hit("#pr-clear")) { prFilter = noProspectFilter(); window.TP.state(PR_PAGES).q = ""; window.TP.reset(PR_PAGES); render(); $("[data-pr-filter=\"stage\"]")?.focus(); return; }
    if ((el = hit("[data-pr-sort]"))) { const id = el.dataset.prSort; prSort = window.BacklinkSeo.nextSort(prSort, id, id === "domain" || id === "spam" ? "asc" : "desc"); window.TP.reset(PR_PAGES); render(); $(`[data-pr-sort="${id}"]`)?.focus(); return; }
    if ((el = hit("[data-prospect-done]"))) {
      const p = window.PROSPECTS.find((x) => x.id === el.dataset.prospectDone);
      addBacklinkPanel({ src: p.url, site: p.site, prospect: p.id }, el);
      return;
    }
    if ((el = hit("[data-prospect-remove]"))) {
      const at = window.PROSPECTS.findIndex((x) => x.id === el.dataset.prospectRemove);
      const [gone] = window.PROSPECTS.splice(at, 1);
      window.dispatchEvent(new CustomEvent("seocc:prospect-removed", { detail: gone }));
      render();
      toast(`${t("Removed from In consideration")}: ${gone.domain}`, { kind: "info", undo: () => { window.PROSPECTS.splice(at, 0, gone); window.dispatchEvent(new CustomEvent("seocc:prospect-restored", { detail: gone })); render(); } });
      return;
    }
    if ((el = hit("[data-bl-mediator]"))) { state.blMediator = el.dataset.blMediator; state.blTab = "all"; state.blFilter = "all"; window.TP.reset(BL_PAGES); render(); $("#main").scrollTop = 0; return; }
    if ((el = hit("[data-found-ignore]"))) {
      const f = window.FOUND_LINKS[Number(el.dataset.foundIgnore)];
      const set = async (ignored) => {
        if (f.serverId) await COMP.api("POST", `backlinks/${f.serverId}/ignore`, { ignored });
        f.ignored = ignored;
        render();
      };
      set(!f.ignored).then(() => toast(t(f.ignored ? "Ignored. It's kept under Show ignored." : "Back in the list"), f.ignored ? { undo: () => set(false).catch((err) => toast(t(err.message), { kind: "crit" })) } : { kind: "info" })).catch((err) => toast(t(err.message), { kind: "crit" }));
      return;
    }
    if (hit("[data-found-show-ignored]")) { state.blShowIgnored = !state.blShowIgnored; window.TP.reset(FOUND_PAGES); render(); $("[data-found-show-ignored]")?.focus(); return; }
    if ((el = hit("[data-found-sort]"))) { const id = el.dataset.foundSort; foundSort = window.BacklinkSeo.nextSort(foundSort, id, id === "src" ? "asc" : "desc"); window.TP.reset(FOUND_PAGES); render(); $(`[data-found-sort="${id}"]`)?.focus(); return; }
    if ((el = hit("[data-bl-sort]"))) { const id = el.dataset.blSort; blSort = window.BacklinkSeo.nextSort(blSort, id, id === "src" ? "asc" : "desc"); window.TP.reset(BL_PAGES); render(); $(`[data-bl-sort="${id}"]`)?.focus(); return; }
    if ((el = hit("[data-bl-tab]"))) { state.blTab = el.dataset.blTab; render(); $(`[data-bl-tab="${state.blTab}"]`)?.focus(); return; }
    if ((el = hit("[data-bl-filter]"))) { state.blFilter = el.dataset.blFilter; window.TP.reset(BL_PAGES); window.TP.reset(window.BacklinkSeo.PAGES.sites); render(); $(`[data-bl-filter="${state.blFilter}"]`)?.focus(); return; }
    if (hit("#add-backlink")) { addBacklinkPanel({}, hit("#add-backlink")); return; }
    if ((el = hit("[data-log-found]"))) { const f = window.FOUND_LINKS[Number(el.dataset.logFound)]; addBacklinkPanel({ src: f.src, target: f.target, site: f.site }, el); return; }
    if ((el = hit("[data-open-bl]"))) { backlinkPanel(window.BACKLINKS.find((b) => b.id === el.dataset.openBl), el); return; }
    if (hit("#check-now")) {
      const btn = hit("#check-now");
      setHTML(btn, icon("refresh-cw", "spin"));
      setTimeout(() => { $("#check-result").textContent = t("Checked just now"); btn.textContent = t("Check now"); }, 800);
      return;
    }
    if (hit("#bl-generate")) {
      // Filled in where empty, so what's saved on the link is exactly what's in the address, and GA4's numbers can be matched to it.
      const source = $("#bl-utm-source").value.trim() || ($("#bl-src").value.match(/^https?:\/\/(?:www\.)?([^./]+)/i)?.[1]?.toLowerCase() ?? "backlink");
      const medium = $("#bl-utm-medium").value.trim() || "backlink";
      const used = new Set(window.BACKLINKS.map((b) => b.utm?.campaign));
      let next = window.BACKLINKS.reduce((most, b) => Math.max(most, b.serverId || 0), 100) + 1;
      while (used.has(`bl-${next}`)) next += 1;
      const campaign = $("#bl-utm-campaign").value.trim() || `bl-${next}`;
      const made = window.BulkLinks.taggedLink({ site: $("#bl-site").value, target: $("#bl-target").value, source, medium, campaign });
      if (made.error) { setHTML($("#bl-generated"), `<div class="error" role="alert">${icon("octagon-alert")}<span>${esc(t(made.error))}</span></div>`); return; }
      $("#bl-utm-source").value = source; $("#bl-utm-medium").value = medium; $("#bl-utm-campaign").value = campaign;
      setHTML($("#bl-generated"), `${esc(t("Give this link to the mediator."))}<span class="tag-link"><code class="mono" dir="ltr">${esc(made.url)}</code><button type="button" class="btn btn-small" data-copy="${esc(made.url)}">${t("Copy")}</button></span>${esc(t("UTM values are case sensitive: don't retype it."))}`);
      return;
    }
    if (hit("#bl-save")) { saveOneLink(); return; }
    if ((el = hit("#bl-edit"))) {
      const b = window.BACKLINKS.find((x) => x.id === el.dataset.id);
      if (b) addBacklinkPanel({ edit: b, site: b.site, src: b.src, target: b.target });
      return;
    }
    if ((el = hit("#bl-delete"))) {
      const b = window.BACKLINKS.find((x) => x.id === el.dataset.id);
      if (!b) return;
      $("#dlg").classList.remove("wide");
      setHTML($("#dlg"), `<div class="dlg-head"><h2 id="dlg-title">${t("Delete this backlink?")}</h2><button class="icon-btn" data-close-dlg aria-label="${t("Close")}">${icon("x")}</button></div><div class="dlg-body"><p class="mono small" dir="auto" style="overflow-wrap:anywhere">${esc(b.src)}</p><p class="small sec" style="margin-top:8px">${t("Can't be undone. Its traffic and history go too.")}</p></div><div class="dlg-foot"><button class="btn" data-close-dlg>${t("Cancel")}</button><button class="btn btn-danger" id="bl-delete-yes" data-id="${esc(b.id)}">${icon("trash-2")}${t("Delete")}</button></div>`);
      $("#dlg").showModal();
      return;
    }
    if ((el = hit("#bl-delete-yes"))) {
      const b = window.BACKLINKS.find((x) => x.id === el.dataset.id);
      el.disabled = true; // a double click must not ask the server twice
      $("#dlg").close();
      if (!b) return;
      closePanel();
      removeLinks([b]).then((stuck) => { render(); toast(t(stuck.length ? "Some links could not be removed" : "Backlink deleted"), { kind: stuck.length ? "crit" : "info" }); });
      return;
    }

    // Row click opens detail, unless the click was on a control inside it.
    if (!hit("input, button, a, select, label")) {
      const kwRow = hit("#kw-table tbody tr");
      if (kwRow) { openKeyword(kwRow.dataset.kw, kwRow.querySelector("[data-open-kw]")); return; }
      const blRow = hit("#bl-table tbody tr");
      if (blRow) { backlinkPanel(window.BACKLINKS.find((b) => b.id === blRow.dataset.bl), blRow.querySelector("[data-open-bl]")); return; }
    }
  });

  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.name === "site-kind") { $("#site-rival-of").hidden = el.value !== "competitor"; return; }
    if ((el.dataset.setupNone)) {
      setSetupNotUsed(el.dataset.host, el.dataset.setupNone, el.checked);
      const focus = el.dataset.setupNone;
      setHTML($("#panel"), setupPanelHtml(el.dataset.host));
      $(`[data-setup-none="${focus}"]`)?.focus();
      if (state.route === "today") render();
      return;
    }
    if (el.id === "bulk-day-first") { bulk.dayFirst = el.value === "1"; updateBulk(); $("#bulk-day-first")?.focus(); return; }
    if (el.dataset.bulkFix !== undefined) {
      if (!el.value.trim()) return;
      bulk.rows[Number(el.dataset.bulkFix)][Number(el.dataset.bulkFixCol)] = el.value.trim();
      updateBulk();
      $(".bulk-fix")?.focus();
      return;
    }
    if (el.id === "cleaner-url-col") { if (el.value !== "") runCleaner(cleaner.bytes, cleaner.name, Number(el.value)); return; }
    if (el.dataset.prospectStage || el.dataset.prospectOwner || el.dataset.prospectRating) {
      const p = window.PROSPECTS.find((x) => x.id === (el.dataset.prospectStage || el.dataset.prospectOwner || el.dataset.prospectRating));
      if (!p) return;
      const change = el.dataset.prospectStage ? { stage: el.value } : el.dataset.prospectOwner ? { owner: el.value } : { rating: el.value ? Number(el.value) : null };
      const before = Object.fromEntries(Object.keys(change).map((key) => [key, p[key]]));
      Object.assign(p, change);
      if (p.serverId) COMP.api("PATCH", `prospects/${p.serverId}`, change).catch((err) => { Object.assign(p, before); toast(t(err.message), { kind: "crit" }); render(); });
      return;
    }
    if (el.id === "lc-site") {
      lc.siteId = /^\d+$/.test(el.value) ? Number(el.value) : el.value;
      lc.open = null;
      pickSite(lcSite()?.host);
      lc.lastPicked = window.UI.siteHostPicked();
      loadLinkHistory().then(() => $("#lc-site")?.focus());
      return;
    }
    if (el.id === "lc-external" || el.id === "lc-weekly") {
      const patch = el.id === "lc-weekly" ? { weekly: el.checked } : { check_external: el.checked };
      lc.api.saveSite(lc.siteId, patch).then((site) => {
        Object.assign(lcSite(), site);
        if (el.id === "lc-weekly") {
          $("#lc-weekly-note").textContent = `(${site.weekly ? (site.next_check_at ? `${t("Next check")}: ${fmtDateOnly(site.next_check_at)}` : t("First check: next weekly run")) : t("Only when you press Run")})`;
          toast(t(site.weekly ? "Weekly check on" : "Weekly check off"), { kind: "info" });
        }
      }).catch((err) => { el.checked = !el.checked; toast(t(err.message), { kind: "crit" }); });
      return;
    }
    if ((el.id === "dp-from" || el.id === "dp-to") && dp) {
      const v = el.value;
      if (!v || v < FIRST_DAY || v > TODAY) { updateDpSum(); return; }
      if (el.id === "dp-from") dp.from = v; else dp.to = v;
      if (dp.from > dp.to) [dp.from, dp.to] = [dp.to, dp.from];
      dp.phase = "start"; dp.right = monthOf(dp.to); dp.focus = dp.to;
      const id = el.id;
      renderCal();
      $(`#${id}`)?.focus();
      return;
    }
    if (el.dataset.refTool) {
      if (el.checked) refresh.picked.add(el.dataset.refTool); else refresh.picked.delete(el.dataset.refTool);
      updateRefreshSummary();
      return;
    }
    if (el.id === "ref-paid") { refresh.paid = el.checked; updateRefreshSummary(); return; }
    if (el.id === "ref-cap") { refresh.cap = Math.max(1, Number(el.value) || 1); el.value = refresh.cap; updateRefreshSummary(); return; }
    if (el.name === "conn-scope") { syncConnScope(); return; }
    if (el.dataset?.siteNone !== undefined || el.dataset?.prop !== undefined) {
      syncSiteNone();
      if (el.dataset.prop && el.value === "__other") $(`[data-prop-other="${el.dataset.prop}"][data-site="${el.dataset.site}"]`).focus();
      return;
    }
    if (el.name === "google-type") { $("#google-oauth").hidden = el.value !== "oauth"; $("#google-robot").hidden = el.value !== "robot"; return; }
    if (el.id === "bulk-file") { loadBulkFile(el.files[0]); el.value = ""; return; }
    if (el.id === "cleaner-site") { cleaner.site = el.value; return; }
    if (el.id === "cleaner-file") { loadCleanerFile(el.files[0]); el.value = ""; return; }
    if (el.id === "pr-all") {
      window.TP.view(PR_PAGES, prospectList()).rows.forEach((p) => { if (el.checked) prPicked.add(p.id); else prPicked.delete(p.id); }); // only the rows on this page
      $$("[data-prospect-pick]").forEach((b) => { b.checked = prPicked.has(b.dataset.prospectPick); });
      paintProspectPicks();
      return;
    }
    if (el.dataset.prospectPick) {
      if (el.checked) prPicked.add(el.dataset.prospectPick); else prPicked.delete(el.dataset.prospectPick);
      paintProspectPicks();
      return;
    }
    if (el.id === "cleaner-all") {
      cleaner.picked = el.checked ? new Set(cleaner.result.rows.flatMap((row, i) => (cleanerSelectable(row) ? [i] : []))) : new Set();
      updateCleanerSelection();
      return;
    }
    if (el.dataset.cleanerRow !== undefined) {
      const i = Number(el.dataset.cleanerRow);
      if (el.checked) cleaner.picked.add(i); else cleaner.picked.delete(i);
      updateCleanerSelection();
      return;
    }
    if (el.id === "bulk-site") { updateBulk(); return; }
    if (el.dataset.bulkCol !== undefined) {
      const i = Number(el.dataset.bulkCol);
      bulk.map = bulk.map.map((m, n) => (n !== i && m === el.value && el.value ? "" : m));
      bulk.map[i] = el.value;
      updateBulk();
      $(`[data-bulk-col="${i}"]`)?.focus();
      return;
    }
    if (el.dataset.select) {
      if (el.checked) state.selected.add(el.dataset.select); else state.selected.delete(el.dataset.select);
      render();
      $$("[data-select]").find((x) => x.dataset.select === el.dataset.select)?.focus();
      return;
    }
    if (el.id === "select-all") {
      filtered().forEach((k) => (el.checked ? state.selected.add(k.k) : state.selected.delete(k.k)));
      render();
      $("#select-all")?.focus();
      return;
    }
    if (el.dataset.col) { state.cols[el.dataset.col] = el.checked; render(); return; }
    if (el.dataset.refEngine) {
      if (el.checked) refresh.engines.add(el.dataset.refEngine); else refresh.engines.delete(el.dataset.refEngine);
      updateRefreshSummary();
      return;
    }
    if (el.id === "ref-depth") { refresh.depth = Number(el.value); updateRefreshSummary(); return; }
  });

  document.addEventListener("input", (e) => {
    if (e.target.id === "conn-json") syncRobotEmail();
    const el = e.target;
    if (el.id === "cmd-input") { cmdIndex = 0; renderCmdList(el.value); return; }
    if (el.dataset.prFilter) { prFilter[el.dataset.prFilter] = el.value; window.TP.reset(PR_PAGES); paintProspects(); return; }
    if (el.dataset.cleanerFilter) { cleaner.filter[el.dataset.cleanerFilter] = el.value; paintCleanerRows(); return; }
    if (el.id === "bulk-text") { readBulk(el.value); updateBulk(); return; }
    if (el.id === "site-address") {
      if (el.classList.contains("invalid")) { el.classList.remove("invalid"); setHTML($("#site-error"), ""); }
      // What will be kept, because "https://www.Shop.com/about" and "shop.com" are the same site.
      const host = el.value.trim().replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0].toLowerCase().replace(/^www\./, "");
      setHTML($("#site-preview"), host.includes(".") && host !== el.value.trim() ? `${t("Will be saved as")} <b class="mono" dir="auto">${esc(host)}</b>` : "");
    }
    if (el.id === "bl-paste") {
      try {
        const url = new URL(el.value.trim());
        const q = url.searchParams;
        if (q.get("utm_source") || q.get("utm_campaign")) {
          $("#bl-utm-source").value = q.get("utm_source") || "";
          $("#bl-utm-medium").value = q.get("utm_medium") || "";
          $("#bl-utm-campaign").value = q.get("utm_campaign") || "";
          $("#bl-paste-note").textContent = t("UTM values read from the link");
          if (!$("#bl-target").value) $("#bl-target").value = url.pathname;
        }
      } catch { /* still typing */ }
    }
    if (el.classList.contains("invalid") && el.id === "bl-src") validateSource();
    if (el.classList.contains("invalid") && el.id === "task-title" && el.value.trim()) el.classList.remove("invalid");
  });
  document.addEventListener("focusout", (e) => { if (e.target.id === "bl-src" && e.target.value.trim()) validateSource(); });
  document.addEventListener("submit", (e) => e.preventDefault());

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if ($("#cmdk").open) $("#cmdk").close(); else openCmd(); return; }
    if ($("#cmdk").open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = cmdList.length || 1;
        cmdIndex = (cmdIndex + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
        renderCmdList($("#cmd-input").value);
      } else if (e.key === "Enter") { e.preventDefault(); runCmd(cmdIndex); }
      return;
    }
    // Calendar keys: arrows move by day and week, Page Up and Down by month.
    const dayBtn = e.target.closest?.(".dp-day");
    if (dayBtn && dp) {
      const day = dayBtn.dataset.day, date = parseDay(day);
      const monday = (date.getDay() + 6) % 7;
      const shift = (months) => { const d = new Date(date.getFullYear(), date.getMonth() + months, date.getDate()); return iso(d); };
      const next = { ArrowLeft: addDays(day, -1), ArrowRight: addDays(day, 1), ArrowUp: addDays(day, -7), ArrowDown: addDays(day, 7), Home: addDays(day, -monday), End: addDays(day, 6 - monday), PageUp: shift(-1), PageDown: shift(1) }[e.key];
      if (next) {
        e.preventDefault();
        const target = next > TODAY ? TODAY : next < FIRST_DAY ? FIRST_DAY : next;
        const month = monthOf(target);
        if (month > dp.right) dp.right = month; else if (month < addMonths(dp.right, -1)) dp.right = addMonths(month, 1);
        dp.focus = target;
        renderCal();
        $(`.dp-day[data-day="${target}"]`)?.focus();
        return;
      }
    }
    if (e.key === "Enter" && (e.target.id === "dp-from" || e.target.id === "dp-to")) { e.preventDefault(); e.target.blur(); $("#dp-apply")?.click(); return; }
    if (e.key === "Escape") {
      if ($("#dlg").open) return;
      if ($("#popover")) { closePopover({ focus: true }); return; }
      if ($("#panel")) { closePanel(); return; }
      closeNav();
    }
  });

  // Tabbing out of the date picker closes it.
  document.addEventListener("focusin", (e) => { if (dp && $("#popover") && !$("#popover").contains(e.target) && e.target !== popAnchor) closePopover(); });
  // While choosing the end date, the range follows the pointer.
  document.addEventListener("mouseover", (e) => {
    if (!dp || dp.phase !== "end") return;
    const b = e.target.closest?.(".dp-day");
    if (b && !b.disabled && dp.hover !== b.dataset.day) { dp.hover = b.dataset.day; paintRange(); }
  });

  // Dropping a file on the bulk upload box.
  ["dragover", "dragenter"].forEach((name) => document.addEventListener(name, (e) => { const box = e.target.closest?.(".drop"); if (box) { e.preventDefault(); box.classList.add("over"); } }));
  document.addEventListener("dragleave", (e) => { const box = e.target.closest?.(".drop"); if (box && !box.contains(e.relatedTarget)) box.classList.remove("over"); });
  document.addEventListener("drop", (e) => {
    const box = e.target.closest?.(".drop");
    if (!box) return;
    e.preventDefault();
    box.classList.remove("over");
    if (box.id === "cleaner-drop") loadCleanerFile(e.dataTransfer.files[0]); else loadBulkFile(e.dataTransfer.files[0]);
  });

  // Light that follows the pointer across the glass, and a sky that shifts very slightly with it.
  if (matchMedia("(hover: hover)").matches) {
    let frame = 0, last = null;
    addEventListener("pointermove", (e) => {
      last = e;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!reduceMotion()) {
          const sky = $("#sky");
          sky.style.setProperty("--mx", (last.clientX / innerWidth - 0.5).toFixed(3));
          sky.style.setProperty("--my", (last.clientY / innerHeight - 0.5).toFixed(3));
        }
        const lit = last.target?.closest?.(".tile, .card");
        if (lit) {
          const b = lit.getBoundingClientRect();
          lit.style.setProperty("--x", `${(last.clientX - b.left).toFixed(0)}px`);
          lit.style.setProperty("--y", `${(last.clientY - b.top).toFixed(0)}px`);
        }
      });
    }, { passive: true });
  }

  // ---- a Member sees admin settings, but can't press what only fails on Save --------------------------------------
  /* The server refuses these to a Member (require_admin). So in Settings and in a connection's panel, they are greyed with
     the reason as their tip, and one line at the top says why. Copying, folding and closing still work. */
  const ADMIN_CONTROLS = "#conn-save, #conn-test, #conn-disconnect, [data-lv-google-test], [data-lv-google-del], [data-tool-move], [data-kwr-order], #kwr-paid-on, [data-ai-site], [data-ai-cap], [data-ai-save-cap], [data-prop], [data-prop-other], [data-lv-site-conn], [data-site-none], [data-conn-site], input[name=\"conn-scope\"], input[name=\"google-type\"], [data-key-input], #conn-json, #conn-client, #conn-secret, #conn-refresh, #conn-zone, #conn-url, #conn-country, #ca-file, #cr-file, #cr-site";
  function memberLock(scope) {
    if (!scope || window.UI?.canAdmin?.() !== false) return;
    const why = t("Only an admin can change connections.");
    let locked = 0;
    [...scope.querySelectorAll(ADMIN_CONTROLS)].forEach((el) => {
      if (el.disabled && el.dataset.memberLocked) return;
      el.disabled = true; el.dataset.memberLocked = "1"; el.setAttribute("aria-disabled", "true"); el.title = why;
      if (el.matches("button")) el.dataset.tip = why;
      locked += 1;
    });
    if (locked && !scope.querySelector(".member-note")) {
      const where = scope.querySelector(".panel-body") || scope.querySelector(".content");
      where?.prepend(fragment(`<p class="note member-note" role="note">${icon("lock")}<span>${esc(why)} ${t("View only: ask an admin for changes.")}</span></p>`));
    }
  }
  if (window.BOOT?.user && window.BOOT.user.role !== "admin") {
    let lockLater = 0;
    new MutationObserver(() => { cancelAnimationFrame(lockLater); lockLater = requestAnimationFrame(() => { if ($("#panel")) memberLock($("#panel")); if (state.route === "settings") memberLock($("#page")); }); })
      .observe(document.body, { childList: true, subtree: true });
  }

  // ---- View only: a section given to look at, not to change (chosen access, access.js) -----------------------------
  /* The server refuses every change there anyway (403, and COMP.api says "View only" before even asking). This keeps the
     screen honest: the buttons that start a change are hidden, forms in a panel are greyed, cards can't be dragged, and
     a small tag by the title says why. Reading, filtering, sorting, paging, exporting and opening details still work. */
  const EDIT_CONTROLS = [
    "#add-backlink", "#bl-save", "#bulk-import", "#cg-add", "#cg-add-all", "#cg-edit-save", "#cg-todo-save", "#cg-upload", "#cl-add-open", "#cl-add-save", "#cl-run",
    "#cl-up-save", "#cleaner-add", "#cp-add", "#cp-save", "#ht-run", "#kwr-add", "#kwr-add-save", "#kwr-refresh", "#kwr-sel-refresh", "#lc-run", "#md-add", "#md-save",
    "#open-refresh", "#pt-qn-save", "#sel-refresh", "#site-add", "#task-save", "#td-move-save", "#td-placed-save", "#vd-budget-save", "#ai-refresh-menu",
    "[data-cl-upload]", "[data-cl-remove]", "[data-ai-aio-check]", "[data-ov-track]", "[data-ov-check]", "[data-ov-brand-edit]", "[data-in-run]", "[data-cl-track]",
    "[data-up-check]", "[data-note-delete]", "[data-in-undismiss]", "[data-dp-move]", "[data-cg-upload]", "[data-vd-disavow]", "[data-task-new]", "[data-task-move]",
    "[data-ov-verify-run]", "[data-ov-track-picked]", "[data-ov-note-add]", "[data-note-status]", "[data-lv-rule-del]", "[data-kc-cancel]", "[data-in-track]",
    "[data-in-status]", "[data-in-dismiss]", "[data-ht-check]", "[data-cs-add]", "[data-cl-remove-yes]", "[data-cl-check-yes]", "[data-cg-decide]", "[data-cg-add-domain]",
    "[data-bell-track]", "[data-ai-rule-del]", "[data-ai-aio-cancel]", "[data-add-site]", "[data-vd-budget]", "[data-tt-note-save]", "[data-td-placed]", "[data-rs-tag-remove]",
    "[data-recheck]", "[data-rd-cancel]", "[data-rc-dismiss]", "[data-pt-links-upload]", "[data-pt-links-add]", "[data-prospect-remove]", "[data-ov-note-save]",
    "[data-ov-note-del]", "[data-ov-brand-del]", "[data-md-edit]", "[data-lv-resource-save]", "[data-lv-resource-del]", "[data-lv-drop]", "[data-link-remove]",
    "[data-lc-delete]", "[data-kwr-check]", "[data-kc-track]", "[data-kc-remove]", "[data-kc-add]", "[data-found-ignore]", "[data-dp-cancel]", "[data-cs-setup-add]",
    "[data-cs-edit]", "[data-cs-add-domain]", "[data-cp-add]", "[data-cl-restore]", "[data-cl-recheck-picked]", "[data-cl-recheck]", "[data-cl-first-new]",
    "[data-cl-dismiss]", "[data-cl-accept]", "[data-cg-edit-rival]", "[data-cg-edit]", "[data-cg-add-all]", "[data-cg-add]", "[data-ai-chip-run]", "[data-td-sent]",
    "[data-note-file-remove]", "[data-lv-collect]", "[data-ov-refresh]", "[data-lv-add-site]", "#bulk-open", "#gsc-open",
  ].join(", ");
  // Hidden with an inline style: the app's button styles would win over the hidden attribute.
  const hideForAccess = (el) => { if (el.dataset.viewOnly) return; el.dataset.viewOnly = "1"; el.style.setProperty("display", "none", "important"); };
  // Admin work wherever it shows (connecting Google, adding a site): never for chosen access.
  const ADMIN_BUTTONS = "[data-lv-connect], [data-add-site], [data-lv-add-site], #site-add, [data-cs-add-site], #ht-monthly, #lc-weekly, [data-up-watch], [data-up-date], [data-up-date-clear]";
  // Paid credits need their own tick; changes every site shares need every site (the owner's rules, 2026-11-12).
  const SPEND_CONTROLS = "[data-rd-ask], [data-rd-go], [data-in-ai], [data-in-ai-again], [data-in-weekly], [data-change-summary], [data-lv-moz], #kwr-paid, #kwr-paid-cap, #ref-paid, #ref-paid-cap";
  const GLOBAL_CONTROLS = "[data-cg-edit], [data-cg-edit-rival], [data-cg-add-domain], [data-cs-add-domain], #md-add, #md-save, [data-md-edit], [data-add-site], [data-lv-add-site], #site-add, [data-cl-crawl], [data-cs-add-site]";
  function creditsAndSharedLock() {
    if (!window.ACCESS?.limited) return;
    // Settings is only "My account" for them: its export (the connections list) is for admins.
    const hide = [ADMIN_BUTTONS, state.route === "settings" ? "[data-export-open]" : "", ACCESS.canSpend() ? "" : SPEND_CONTROLS, ACCESS.everySite() ? "" : GLOBAL_CONTROLS].filter(Boolean).join(", ");
    [$("#page"), $("#panel")].filter(Boolean).forEach((scope) => scope.querySelectorAll(hide).forEach((el) => {
      // The paid switch in a Refresh form is a label around its box: hide that whole row.
      hideForAccess(el.closest("label") || el);
    }));
  }
  const viewOnlyHere = () => Boolean(window.ACCESS?.limited) && state.route !== "settings" && mayOpen(state.route) && !ACCESS.canEdit(state.route);
  function viewLock() {
    if (!viewOnlyHere()) return;
    [$("#page"), $("#panel")].filter(Boolean).forEach((scope) => {
      scope.querySelectorAll(EDIT_CONTROLS).forEach(hideForAccess);
      scope.querySelectorAll("[draggable=true]").forEach((el) => el.setAttribute("draggable", "false"));
    });
    const panel = $("#panel");
    panel?.querySelectorAll("form input:not([type=search]), form textarea, form select").forEach((el) => { el.disabled = true; });
    panel?.querySelectorAll("form button[type=submit], form .btn-main").forEach(hideForAccess);
    const title = $("#page h1");
    if (title && !title.querySelector(".view-only-tag")) title.insertAdjacentHTML("beforeend", ` <span class="view-only-tag" role="note">${icon("eye")}${t("View only")}</span>`);
  }
  if (window.ACCESS?.limited) {
    // A link into a section they weren't given (Today's to-do, a finding, the bell) says so instead of opening a blank page.
    document.addEventListener("click", (e) => {
      const link = e.target.closest?.('a[href^="#"]');
      const route = link ? link.getAttribute("href").replace(/^#/, "").split(/[/?]/)[0] : "";
      if (!route || !BUILT.has(route) || mayOpen(route)) return;
      e.preventDefault(); e.stopImmediatePropagation(); toast(t("You don't have access to this section"), { kind: "info" });
    }, true);
    let viewLater = 0;
    new MutationObserver(() => { cancelAnimationFrame(viewLater); viewLater = requestAnimationFrame(() => { viewLock(); creditsAndSharedLock(); }); }).observe(document.body, { childList: true, subtree: true });
    // A file dropped or pasted on a View only screen would only be refused: it isn't taken in at all.
    ["drop", "paste"].forEach((kind) => document.addEventListener(kind, (e) => {
      if (!viewOnlyHere() || (kind === "paste" && !e.clipboardData?.files?.length)) return;
      e.preventDefault(); e.stopImmediatePropagation(); toast(t("View only: you can't change this."), { kind: "info" });
    }, true));
  }

  // ---- a session that ends while someone works: sign in again here, and nothing typed is lost --------------------
  /* auth.js asks this before sending the page to the sign-in screen. Answering true keeps the page: an open form, a half-typed
     task and the screen all stay, a small sign-in box opens on top, and after it the person presses Save again. */
  let reSigning = false;
  window.AUTH_HOOKS = window.AUTH_HOOKS || {};
  window.AUTH_HOOKS.signedOut = () => {
    try { sessionStorage.setItem("seocc-return", location.hash); } catch { /* private mode: the sign-in page starts on Today */ }
    if (!window.BOOT?.user) return false; // no login on this server: nothing to sign in to
    if (!reSigning) signInAgain();
    return true;
  };
  function signInAgain() {
    reSigning = true;
    const box = document.createElement("dialog");
    box.id = "resign"; box.className = "resign";
    box.setAttribute("aria-labelledby", "resign-title");
    setHTML(box, `<form id="resign-form" class="resign-form" novalidate>
      <h2 id="resign-title">${t("Session ended")}</h2>
      <p class="small sec">${t("Sign in again to carry on. Your work is still here.")}</p>
      <div class="error" id="resign-err" role="alert" hidden></div>
      <label class="field"><span>${t("Username or email")}</span><input class="input" id="resign-email" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(window.BOOT?.user?.email || "")}"></label>
      <label class="field"><span>${t("Password")}</span><input class="input" id="resign-password" type="password" autocomplete="current-password"></label>
      <div class="resign-acts"><button type="button" class="btn" id="resign-leave">${t("Go to the sign-in page")}</button><button type="submit" class="btn btn-main" id="resign-go">${t("Sign in")}</button></div>
    </form>`);
    document.body.append(box);
    box.showModal();
    (box.querySelector("#resign-email").value ? box.querySelector("#resign-password") : box.querySelector("#resign-email")).focus();
    const fail = (words) => { const err = box.querySelector("#resign-err"); err.textContent = words; err.hidden = !words; };
    const done = () => { reSigning = false; box.close(); box.remove(); };
    box.addEventListener("cancel", (e) => e.preventDefault()); // Esc mustn't leave a page that can't save
    box.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); } }); // nor close the form under it
    box.querySelector("#resign-leave").addEventListener("click", () => location.replace("login"));
    box.querySelector("#resign-form").addEventListener("submit", async (e) => {
      e.preventDefault(); fail("");
      const email = box.querySelector("#resign-email").value.trim(), password = box.querySelector("#resign-password").value;
      if (!email || !password) { fail(t("Enter your username and password.")); return; }
      const go = box.querySelector("#resign-go");
      go.disabled = true;
      try {
        const reply = await fetch("api/auth/login", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
        const data = await reply.json().catch(() => ({}));
        if (!reply.ok) { fail(t(data.error || "That didn't work. Try again.")); box.querySelector("#resign-password").value = ""; box.querySelector("#resign-password").focus(); return; }
        if (data.user?.must_change_password) { location.replace("login?change=1"); return; }
        await window.whoAmI?.again?.(); // the new session's token, so the next Save is accepted
        done();
        toast(t("Signed in again. Press Save to send your change."), { kind: "info", stay: true });
      } catch { fail(t("Can't reach the app. Check it's running, then try again.")); } finally { go.disabled = false; }
    });
  }

  // ---- what screens in their own files can use ------------------------------------------
  window.UI = {
    simple: () => state.simple, // the simpler screens switch, see state above
    head: drawHead, // the simpler screens' head (plan 3.1); UI.topbar draws it too while the switch is on
    $, $$, state, store, t, num, dec, esc, icon, status, logo, siteLogo, setHTML, fragment, locale, reduceMotion,
    topbar, tile, cnt, spark, delta, toast, render, renderSidebar, go, openPanel, closePanel, panelHead, forgetPanelForm,
    countryName, flag, countryOptions, COUNTRY_CODES, languageOptions, fmtStamp, fmtDateOnly, ENGINES, WHOLE_SITE_WORDS, BUDGET_PAUSE_WORDS, readingWords,
    siteHostPicked: () => (state.site === "all" ? null : window.SITES.find((x) => x.id === state.site)?.host || null),
    ignoreClicks: (ms = 400) => { ignoreClicksUntil = performance.now() + ms; },
    popover, closePopover, // a screen's own menu, such as a competitor choice with each logo: a native list can't show pictures
    confirmDanger, // the app's own confirm, with a danger button (settings-live.js)
    longerPeriodButton, // an empty period's way out (screens-live.js emptyCard, Overview)
    openConnection, pickSite, showingNote, preferredSite, syncUrl, periodWindow, settingsPage, setupCard, range: UIRange, fmtRange, fmtDay,
    /* export.js: the rows on screen, in their order, and the links scan that is open. */
    exportSeen: () => ({ done: ((rows) => (window.BacklinkSeo.byWebsite() ? rows : blSearched(rows)))(window.BacklinkSeo.filterRows(siteLinks().filter((b) => b.status !== "planned" && (!state.blMediator || b.mediator === state.blMediator)), state.blFilter)).map((b) => b.id), consideration: prospectList().map((p) => p.id), scan: lc.open?.scan?.id ?? null }),
    siteIdPicked: () => (state.site === "all" ? null : window.SITES.find((x) => x.id === state.site)?.realId || null), toBacklink,
    reloadBacklinks: loadRealBacklinks, // another screen moved links into Backlinks (Link gaps → To do), so its lists read again
    siteComing: () => Boolean(wantedSite), // an address named a site that hasn't joined the list yet
    replaceNextUrl: () => { replaceNext = true; }, // the next address replaces this one, so Back doesn't land on a step nobody chose
  };
  window.SHARED_UI?.install(window.UI); // skeleton, failCard, errorWords, definitions: before any screen draws
  Object.values(window.SCREENS || {}).forEach((screen) => screen.init?.(window.UI));
  window.HealthTest?.init?.(window.UI);
  window.UptimeWatch.init(window.UI);
  window.LinkExtras.init(window.UI);
  window.BacklinkSeo.init(window.UI, { server: () => bl.server, sites: () => bl.sites, reload: loadRealBacklinks, currencyOf: currencyOfLink, money: inCurrency });
  window.LinkTodo.init(window.UI, {
    siteLinks, LINK_TYPES, localLink, takeProspects, server: () => bl.server, reload: loadRealBacklinks,
    clearPicks: () => prPicked.clear(), hostOfSite: (id) => bl.sites.find((s) => s.id === id)?.host || "",
  });

  applyFirstRun();

  // ---- start -----------------------------------------------------------------------
  if (!applyUrl() && !mayOpen(state.route)) state.route = ACCESS.first();
  // Someone given one site works on that site: there is no "All sites" to pick for them.
  if (window.ACCESS?.limited && window.SITES.length === 1 && state.site === "all") state.site = window.SITES[0].id;
  const followUrl = () => {
    if (location.hash === urlNow()) return;
    following = true; closePanel(); following = false; // closing must not write the old view back over the address just opened
    if (applyUrl()) { render({ enter: true, keepScroll: false }); $("#main").scrollTop = 0; }
  };
  addEventListener("popstate", followUrl);
  addEventListener("hashchange", followUrl);
  $("#skip").addEventListener("click", (e) => { e.preventDefault(); $("#main").focus(); });
  render({ enter: true });
  urlReady = true;
  history.replaceState(null, "", location.pathname + location.search + urlNow());
  loadRealSites();
  window.addEventListener("seocc:site-added", (e) => {
    if (bl.server && e.detail?.kind === "own") COMP.api("GET", "links/sites").then((answer) => noteRealSites(answer.sites)).catch(() => {});
  });
  // Served by the real app, Google and most tools aren't connected, whatever the sample says.
  COMP.isServer?.().then((served) => {
    state.served = served;
    if (!served) return;
    if (state.route === "settings") render();
  }).catch(() => {});
  document.fonts?.ready.then(() => { placeInks({ instant: true }); syncTopbar(); });
})();
