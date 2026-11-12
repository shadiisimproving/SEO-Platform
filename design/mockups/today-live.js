/* Today on real data. Only used when served by the app: as a plain file, the sample Today stays. */
(() => {
  "use strict";
  if (!window.BOOT) return;
  let UI, t, esc;
  // at: when the last answer landed (not when it was asked), so a slow server isn't asked again the moment it answers (F5).
  // busy: one load at a time. failed: the query that failed, so it isn't asked again until Try again or something changes.
  const T = { key: null, data: null, error: "", summary: {}, at: 0, busy: false, failed: null };
  const KINDS = { new_page: "New page", page_gone: "Page removed", title: "Title changed", search_title: "Search title changed", meta: "Meta description changed", h1: "Main heading changed", headings: "Headings changed", content: "Content changed", canonical: "Canonical changed", schema: "Structured data changed", links: "Links changed", redirect: "Redirect changed", status: "Status changed", robots: "Indexing changed" };

  const words = (title) => {
    if (UI.state.lang !== "fr") return title;
    let m;
    if ((m = title.match(/^Clarity data lost in (\d+) h$/))) return `Données Clarity perdues dans ${m[1]} h`;
    if ((m = title.match(/^(.+): the security certificate expires on (.+)$/))) return `${m[1]} : le certificat de sécurité expire le ${m[2]}`;
    if ((m = title.match(/^(.+): the security certificate has expired$/))) return `${m[1]} : le certificat de sécurité a expiré`;
    if ((m = title.match(/^(.+): the domain name expires on (.+)$/))) return `${m[1]} : le nom de domaine expire le ${m[2]}`;
    if ((m = title.match(/^(.+): the domain name has expired$/))) return `${m[1]} : le nom de domaine a expiré`;
    if ((m = title.match(/^(.+): health fell from (\d+) to (\d+)$/))) return `${m[1]} : la santé est passée de ${m[2]} à ${m[3]}`;
    if ((m = title.match(/^(.+) stopped working on (\d+) sites$/))) return `${m[1]} ne fonctionne plus sur ${m[2]} sites`;
    if ((m = title.match(/^(.+) stopped working$/))) return `${m[1]} ne fonctionne plus`;
    // A big drop, as alerts store it: the wording since 2026-11-11, and the old one rows saved before still carry.
    if ((m = title.match(/^(.+): −(\d+)% Google clicks$/) || title.match(/^(.+) lost (\d+)% of its Google clicks$/))) return `${m[1]} : −${m[2]} % de clics Google`;
    if ((m = title.match(/^(?:Week on week|Last 7 days against the 7 before): (.+)$/))) return `Semaine sur semaine : ${m[1]}`;
    if ((m = title.match(/^(?:~(\d+) clicks\/month|About (\d+) clicks a month) at stake(?:\. See Search → Insights\.)?$/))) return `~${m[1] || m[2]} clics/mois en jeu`;
    if ((m = title.match(/^A background job stopped: (.+)$/))) return `Une tâche de fond s'est arrêtée : ${m[1]}`;
    return t(title);
  };
  const ago = (minutes) => {
    if (minutes === null || minutes === undefined) return "";
    if (minutes < 1) return t("just now");
    const word = minutes < 60 ? `${minutes} min` : minutes < 2880 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} ${t("d")}`;
    return UI.state.lang === "fr" ? `il y a ${word}` : `${word} ago`;
  };
  const when = (iso) => { if (!iso) return ""; const m = Math.round((Date.now() - new Date(iso)) / 60000); return ago(Math.max(m, 0)); };

  /* The site and the app's one date range, as Today asks for them. Search Console's end is worked out on the server
     (seo.metrics.search.resolve), the very rule Overview uses, so Google clicks here are Overview's for the same range. */
  const askFor = () => {
    const site = UI.siteIdPicked(), parts = [];
    if (site) parts.push(`site_id=${site}`);
    if (UI.range?.search) parts.push(UI.range.search());
    return parts.length ? `?${parts.join("&")}` : "";
  };
  /* ---- the simpler screens (UI.simple() and SCREEN_DATA on): one call, kept 5 minutes ---------------------------------------
     /api/today?…&include=backlinks carries the backlinks numbers (and the setup line's facts, once mockup.js takes them
     through UI.setupFacts), so Today asks once instead of five times. SCREEN_DATA keeps the answer: coming back within
     5 minutes asks nothing (no more 10-second re-ask), an older answer shows at once and is replaced quietly, and a mark
     as seen, a source or a site changed makes it old. Off, everything below runs as before. */
  const quick = () => Boolean(window.SCREEN_DATA?.on?.());
  const pathFor = (query = askFor()) => `today${query}${query ? "&" : "?"}include=${UI.setupFacts ? "setup," : ""}backlinks`;
  let held = null, applied = null; // the SCREEN_DATA entry Today last drew from, and the answer last taken in
  function takeIn(data, query) {
    if (applied === data) return;
    applied = data;
    T.key = query; T.data = data; T.summary = data.backlinks || {}; T.error = ""; T.failed = null; T.at = Date.now();
    window.ATTENTION = data.todo.map((a) => ({ id: a.id, sev: a.severity, title: say(a, "title"), detail: a.detail, host: a.host, act: "Open", key: a.kind }));
    if (Array.isArray(data.setup)) UI.setupFacts?.(data.setup);
    if (data.results?.window?.to) UI.range?.end?.("today", data.results.window.to, "Search Console");
    T.badgeLate = true; // taken in while the page draws, after the side menu: after() draws it again with the new count
  }
  // What Today shows now: the held answer for the site and period picked, asked for when there's none (one ask at a time).
  function quickEntry() {
    const query = askFor();
    held = window.SCREEN_DATA.entry(pathFor(query), { route: "today" });
    if (held.data !== undefined) takeIn(held.data, query);
    return held;
  }
  // After a change on Today itself (Mark as seen, Undo): the new answer now, not on the next visit.
  async function reload() {
    if (!quick()) return load();
    const query = askFor();
    try { takeIn(await window.SCREEN_DATA.get(pathFor(query), { fresh: true }), query); } catch (err) { UI.toast(err.message, { kind: "crit" }); }
    if (UI.state.route === "today" && !UI.$("#panel")) UI.render();
  }

  async function load() {
    if (quick()) { quickEntry(); return; }
    if (T.busy) return;
    const query = askFor();
    T.key = query; T.busy = true;
    const site = UI.siteIdPicked();
    try {
      const [data, summary] = await Promise.all([
        window.COMP.api("GET", `today${query}`),
        window.COMP.api("GET", `backlinks/summary${site ? `?site_id=${site}` : ""}`).catch(() => null),
      ]);
      if (T.key === query) { // not when another site or range was picked, or a source changed, while this was on its way
        T.data = data; T.summary = summary || {}; T.error = ""; T.failed = null;
        window.ATTENTION = data.todo.map((a) => ({ id: a.id, sev: a.severity, title: say(a, "title"), detail: a.detail, host: a.host, act: "Open", key: a.kind }));
        if (data.results?.window?.to) UI.range?.end?.("today", data.results.window.to, "Search Console");
      }
    } catch (err) {
      if (T.key === query) { T.error = err.message; T.failed = query; }
    } finally {
      T.busy = false;
      T.at = Date.now();
    }
    if (T.key !== query || query !== askFor()) { if (UI.state.route === "today") load(); return; } // ask again for what's wanted now
    if (UI.state.route === "today" && !UI.$("#panel")) UI.render();
  }

  /* A sentence the server sends as an English key and its values: put into the reader's language, then filled in. */
  const DEVICE_WORDS = { MOBILE: "Mobile", DESKTOP: "Desktop", TABLET: "Tablet" };
  function say(a, part) {
    const pair = a.words?.[part];
    if (!pair) return part === "title" ? words(a.title) : a.detail ? words(a.detail) : "";
    const [key, values] = pair;
    return Object.entries(values || {}).reduce((out, [k, v]) => out.split(`{${k}}`).join(shownValue(a, k, v)), t(key));
  }
  function shownValue(a, k, v) {
    let shown = typeof v === "number" ? UI.num(v) : String(v ?? "");
    if (k === "segment" && a.words.segment_dim === "device") shown = t(DEVICE_WORDS[String(v).toUpperCase()] || shown);
    if (k === "day" && /^\d{4}-\d{2}-\d{2}$/.test(shown)) shown = new Intl.DateTimeFormat(UI.locale(), { day: "numeric", month: "long" }).format(new Date(`${shown}T00:00:00`));
    return shown;
  }
  /* The same title as HTML, the searched words in it a link to that keyword (keyword-links.js). The sentence and every
     value are escaped here; only the link is markup. */
  const KEYWORD_SLOTS = new Set(["query", "keyword"]);
  function sayHtml(a, part) {
    const pair = a.words?.[part];
    if (!pair || !window.KeywordLink) return esc(say(a, part));
    const [key, values] = pair;
    const slots = Object.entries(values || {}), marks = []; // each value is marked in the sentence first, so a value holding "{x}" can't be filled again
    const out = esc(slots.reduce((text, [k], i) => text.split(`{${k}}`).join(`\u0000${i}\u0000`), t(key)));
    slots.forEach(([k, v], i) => {
      const shown = shownValue(a, k, v);
      marks[i] = KEYWORD_SLOTS.has(k) && shown.trim() ? window.KeywordLink.html(shown, { id: a.keyword_id || null, host: a.host || null }) : esc(shown);
    });
    return out.replace(/\u0000(\d+)\u0000/g, (_, i) => marks[Number(i)]);
  }
  const MAIN_WORD = { source_failing: "Fix", backlink_lost: "Review", backlink_changed: "Review", page_drop: "See page", search_finding: "See why", ai_overview: "See it" };
  const mainButton = (a) => {
    if (a.kind === "page_drop" && a.open?.page) return `<button class="btn btn-small" data-today-page="${esc(a.open.page)}" data-today-host="${esc(a.host || "")}" data-today-range="${esc(a.open.range || "")}">${t("See page")}</button>`;
    const link = a.host && a.link && !a.link.includes("?") ? `${a.link}?site=${encodeURIComponent(a.host)}` : a.link;
    return `<a class="btn btn-small" href="${esc(link || "#today")}">${t(MAIN_WORD[a.kind] || "Open")}</a>`;
  };
  const todoItem = (a) => {
    const title = say(a, "title"), detail = say(a, "detail");
    return {
      id: a.id, severity: a.severity, kind: a.kind, reason: a.reason, title, titleHtml: sayHtml(a, "title"), detail, host: a.host,
      seenAttr: a.alert_ids ? `data-lv-seen="${esc(a.alert_ids.join(","))}"` : a.seen_key ? `data-lv-drop="${esc(a.seen_key)}"` : "",
      mainHtml: mainButton(a),
      find: a.kind === "search_finding" ? { title, host: a.host || null, priority: "medium", pages: a.page ? [a.page] : [], keywords: a.query ? [a.query] : [], source: { type: "search", key: a.seen_key, label: title, host: a.host || undefined, facts: detail ? [detail] : [], link: a.link } } : { title, host: a.host || null, priority: a.severity === "crit" ? "high" : "medium", ...(a.page ? { pages: [a.page] } : {}), ...(a.query ? { keywords: [a.query] } : {}), source: { type: "alert", label: title, host: a.host || undefined, facts: detail ? [detail] : [], link: a.link, key: a.seen_key ? `drop|${a.seen_key}` : `alert|${a.kind}|${a.host || ""}|${a.title}` } },
    };
  };
  const pathOf = (url) => { try { return new URL(url).pathname || "/"; } catch { return url; } };
  const siteToPick = (host) => window.SITES.find((s) => s.host === host)?.id;

  const view = (d, setupHtml = "") => window.TodayView.page({ ...vmOf(d), setupHtml });
  /* The sites shown that have neither Search Console nor Google Analytics, so "Connect Google" can say which site it's for. */
  function withoutGoogle(d) {
    const picked = UI.siteHostPicked?.() || null;
    const hosts = picked ? [picked] : (d.sites || []).map((s) => s.host);
    return hosts.filter((host) => !d.sources.some((s) => s.host === host && (s.source === "gsc" || s.source === "ga4")));
  }
  function vmOf(d) {
    const stale = d.lanes.filter((l) => l.stale);
    return {
      results: d.results, googleStopped: d.google_stopped, todo: d.todo.map(todoItem), goingDown: d.going_down, goingUp: d.going_up, otherEdits: d.other_edits,
      rivals: d.rival_changes.map((c) => ({ ...c, label: t(KINDS[c.kind] || c.kind), path: pathOf(c.url), my_path: pathOf(c.my_url), when: when(c.when) })),
      followUp: T.summary.follow_up, renewals: T.summary.renewals_30d,
      sources: { ok: d.sources.filter((s) => s.ok).length, waiting: d.sources.filter((s) => s.waiting).length, total: d.sources.length, hosts: withoutGoogle(d), connectAttr: `data-today-connect="${esc(withoutGoogle(d)[0] || "")}"`, note: stale.length ? `${t("Background work")}: ${t("Last ran")} ${ago(stale[0].minutes) || t("never")}` : "" },
      sites: d.sites.map((s) => ({ ...s, pick: siteToPick(s.host) })),
      range: UI.range?.get ? UI.range.get({ end: d.results?.window?.to, hours: false }) : null,
    };
  }

  // The simpler head: the day in words, then the dates, the comparison and one sources chip; caveats behind the (i).
  function quickHead(d) {
    const line = esc(new Intl.DateTimeFormat(UI.locale(), { weekday: "long", day: "numeric", month: "long" }).format(new Date()));
    const parts = d ? window.TodayView.headParts(vmOf(d)) : { source: null, info: [] };
    return UI.head({ title: t("Today"), period: true, line, source: parts.source, info: parts.info });
  }
  function quickPage() {
    const setup = UI.setupCard();
    if (!window.SITES.length) return `${quickHead(null)}<div class="content page-enter">${setup}</div>`;
    const e = quickEntry();
    if (e.data === undefined && e.error) {
      const head = quickHead(null);
      return `${head}<div class="content page-enter">${setup}${UI.failCard(e.error, { retry: "data-today-retry" })}</div>`;
    }
    if (e.data === undefined) return `${quickHead(null)}<div class="content page-enter">${setup}${UI.skeleton("page", { tiles: 3, chart: true })}</div>`;
    return `${quickHead(e.data)}<div class="content page-enter">${window.TodayView.page({ ...vmOf(e.data), sourcesInHead: true, setupHtml: setup })}</div>`;
  }

  function page() {
    if (quick() && UI.head) return quickPage();
    const query = askFor();
    const head = UI.topbar(t("Today"), esc(new Intl.DateTimeFormat(UI.locale(), { weekday: "long", day: "numeric", month: "long" }).format(new Date())), "", true);
    const setup = UI.setupCard();
    if (!window.SITES.length) return `${head}<div class="content page-enter">${setup}</div>`; // nothing to ask yet: the sites come first
    // Coming back to Today shows what's true now; a failed load waits for Try again or a new choice.
    if (!T.busy && (T.key !== query ? T.failed !== query : !T.error && Date.now() - T.at > 10000)) load();
    if (T.error && (!T.data || T.key !== query)) {
      const failed = UI.failCard ? UI.failCard(T.error, { retry: "data-today-retry" }) : `<section class="card"><div class="empty"><h3>${t("That didn't load")}</h3><p>${esc(T.error)}</p><div style="margin-top:12px"><button class="btn" data-today-retry>${t("Try again")}</button></div></div></section>`;
      return `${head}<div class="content page-enter">${setup}${failed}</div>`;
    }
    if (!T.data) return `${head}<div class="content page-enter">${setup}${UI.skeleton ? UI.skeleton("page", { tiles: 3, chart: true }) : `<section class="card" aria-busy="true"><div class="empty"><p>${t("Loading…")}</p></div></section>`}</div>`;
    return `${head}<div class="content page-enter">${view(T.data, setup)}</div>`; // the setup line sits under the answer, not above it
  }

  /* The side menu's Today badge on another screen: the to-do list only, for every site (the menu filters by the site
     picked), asked once per page load. Today's own load replaces it with its full list. */
  const B = { asked: false };
  async function badge() {
    if (B.asked || !window.SITES.length) return; // once per load, and only when there's a site to ask about
    B.asked = true;
    try {
      const { todo } = await window.COMP.api("GET", "today/attention");
      if (T.data) return;
      window.ATTENTION = todo.map((a) => ({ id: a.id, sev: a.severity, title: say(a, "title"), detail: a.detail, host: a.host, act: "Open", key: a.kind }));
      const host = UI.siteHostPicked?.() || null, item = UI.$('.nav-item[data-go="today"]');
      const urgent = window.ATTENTION.filter((a) => !UI.state.seen?.has(a.id) && (a.sev === "crit" || a.sev === "warn") && (!host || !a.host || a.host === host)).length;
      if (!item || UI.state.firstRun) return;
      item.querySelector(".count")?.remove();
      if (urgent) item.append(UI.fragment(`<span class="count" aria-label="${urgent} ${esc(t("Needs attention"))}">${urgent}</span>`));
    } catch { /* the badge stays as it was; Today itself says what failed */ }
  }

  /* "See page": that page in Search → Overview → Pages, over the days the row speaks of. Overview owns its own state:
     OV.openPage when it has one, otherwise the same steps OV.openQuery takes for a search. */
  function openPage(page, host, range) {
    if (range && UI.range?.set) UI.range.set({ preset: range });
    if (window.OV?.openPage) { window.OV.openPage({ host, page }); return; }
    const OV = window.OV;
    if (!OV) { UI.go("overview"); return; }
    if (host) UI.pickSite(host);
    Object.assign(OV, { tab: "page", show: "all", page: 0, sort: null, moreFilters: false, toTable: true });
    OV.selected?.clear?.();
    OV.filters = OV.filters || {};
    OV.filters.page = { q: page, q_mode: "exact", min_clicks: "", min_impressions: "", pos_from: "", pos_to: "" };
    UI.go("overview");
  }
  /* A keyword in Going up / Going down opens like every keyword link (keyword-links.js): its Keywords panel when tracked,
     Overview → Queries filtered to it when not. Over the same 7 days the row speaks of, so the range is set first. */
  function openKeyword(query, host, keywordId, range) {
    if (range && UI.range?.set) UI.range.set({ preset: range });
    if (window.KeywordLink) { window.KeywordLink.open({ id: keywordId || null, keyword: query, host: host || null }); return; }
    if (window.OV?.openQuery) { window.OV.openQuery({ host, query }); return; }
    UI.go(keywordId ? "keywords" : "overview");
  }

  window.SCREENS = window.SCREENS || {};
  window.SCREENS.today = {
    init(helpers) {
      UI = helpers; ({ t, esc } = helpers);
      document.addEventListener("click", async (e) => {
        const el = e.target.closest?.("[data-lv-seen], [data-lv-drop]");
        if (!el) return;
        const { lvSeen, lvDrop } = el.dataset;
        // A source failing on several sites is one row, so its mark covers them all.
        const send = (seen) => (lvDrop ? window.COMP.api("POST", "today/seen", { key: lvDrop, seen }) : Promise.all(lvSeen.split(",").map((id) => window.COMP.api("POST", `alerts/${id}/seen`, { seen }))));
        el.disabled = true;
        try {
          await send(true);
          await reload();
          UI.toast(t("Marked as seen"), { undo: async () => { await send(false); await reload(); UI.toast(t("Restored"), { kind: "info" }); } });
        } catch (err) { el.disabled = false; UI.toast(err.message, { kind: "crit" }); }
      });
      document.addEventListener("click", (e) => {
        const connect = e.target.closest?.("[data-today-connect]");
        if (connect) { UI.state.connHost = connect.dataset.todayConnect || null; UI.openConnection("google"); return; } // the site it names is the one picked in the panel
        if (e.target.closest?.("[data-today-retry]")) {
          if (quick()) { window.SCREEN_DATA.forget(pathFor()); held = null; UI.render(); return; } // forgotten, so the draw asks again
          T.error = ""; T.failed = null; T.key = null; load(); UI.render(); return;
        }
        const el = e.target.closest?.("[data-today-page]");
        if (el) openPage(el.dataset.todayPage, el.dataset.todayHost, el.dataset.todayRange);
        const kw = e.target.closest?.("[data-today-keyword]");
        if (kw && (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)) return; // a new tab follows the link
        if (kw) { e.preventDefault(); openKeyword(kw.dataset.todayKeyword, kw.dataset.todayHost, kw.dataset.todayKeywordId, kw.dataset.todayRange); }
      });
      window.addEventListener("seocc:site-added", () => { T.key = null; T.failed = null; });
      window.addEventListener("seocc:sources-changed", () => { T.key = null; T.failed = null; });
      // Health fires this each time it syncs its alerts, at start-up too: an answer already on its way is as fresh as that.
      window.addEventListener("seocc:alerts-changed", () => {
        // With the switch on: forget Today's answer, unless it is on its way (it is as fresh as that), so the next draw asks.
        if (quick()) { if (!held?.loading) window.SCREEN_DATA.forget("today"); return; }
        if (T.busy) return; T.key = null; T.failed = null;
      });
      // Today's first-view answer, for SCREEN_DATA's warm-up and the menu hover (read when they run: the site and period then).
      window.SCREEN_DATA?.screen?.("today", () => (window.SITES.length ? [pathFor()] : []));
      UI.range?.on?.(() => { T.failed = null; });
      // Today loads its own data when it's drawn. Any other screen only needs the side menu's Today badge: one light call.
      setTimeout(() => { if (UI.state.route !== "today" && !T.data && !T.busy) badge(); }, 0);
      window.addEventListener("seocc:site-added", () => { if (UI.state.route !== "today" && !T.data && !B.asked) badge(); });
    },
    page,
    // The side menu is drawn before the page, so a to-do list taken in during the draw redraws the menu for its badge.
    after() { if (!T.badgeLate) return; T.badgeLate = false; UI.renderSidebar?.(); },
  };
  const fr = {
    "just now": "à l'instant", "See page": "Voir la page", "See why": "Voir pourquoi", "See it": "Voir", "Try again": "Réessayer",
    "Clarity data lost in {n} h": "Données Clarity perdues dans {n} h", "Clarity data is being lost": "Des données Clarity sont en train d'être perdues",
    "Clarity keeps only 3 days of data.": "Clarity ne garde que 3 jours de données.",
    "{path}: −{percent}% Google clicks": "{path} : −{percent} % de clics Google", "Week on week: {was} → {now}": "Semaine sur semaine : {was} → {now}",
    "~{n} clicks/month at stake": "~{n} clics/mois en jeu",
    "{path} dropped out of Google": "{path} est sortie de Google", "{path} is slowly losing clicks": "{path} perd lentement des clics",
    "“{query}” is almost on page 1": "« {query} » est presque en page 1", "“{query}” is close to the top 3": "« {query} » est proche du top 3",
    "“{query}” is clicked less than usual": "« {query} » est moins cliquée que d'habitude", "“{query}” is seen but never clicked": "« {query} » est vue mais jamais cliquée",
    "Two of your pages compete for “{query}”": "Deux de vos pages se disputent « {query} »", "Google clicks fell on {day}": "Les clics Google ont baissé le {day}",
    "“{query}” lost places on Google": "« {query} » a perdu des places sur Google", "{segment} carries most of the drop in clicks": "{segment} porte l'essentiel de la baisse des clics",
    "Google keeps moving “{query}” up and down": "Google fait monter et descendre « {query} » sans arrêt", "Non-brand clicks fell {percent}%, hidden by brand searches": "Les clics hors marque ont baissé de {percent} %, masqués par les recherches de marque",
    "“{query}” is slowly losing places": "« {query} » perd lentement des places", "{path} is close to page 1 on many searches": "{path} est proche de la page 1 sur beaucoup de recherches",
    "“{query}” has no page of its own": "« {query} » n'a pas de page à elle", "Searches with “{word}” have no strong page": "Les recherches avec « {word} » n'ont pas de page forte",
    "{path} brings leads and is losing clicks": "{path} apporte des leads et perd des clics", "Shown on Google, but it's broken": "Affichée sur Google, mais cassée", "Google shows {path}, but it's broken": "Google affiche {path}, mais elle est cassée",
    "“{keyword}”: Google's AI Overview no longer cites you": "« {keyword} » : l'AI Overview de Google ne vous cite plus", "“{keyword}”: an AI Overview now shows, without you": "« {keyword} » : un AI Overview s'affiche désormais, sans vous",
    "“{keyword}”: Google's AI Overview now cites you": "« {keyword} » : l'AI Overview de Google vous cite désormais", "“{keyword}”: a new AI Overview cites you": "« {keyword} » : un nouvel AI Overview vous cite",
    "“{keyword}”: the AI Overview has gone": "« {keyword} » : l'AI Overview a disparu", "Last two AI Overview checks": "Deux derniers relevés de l'AI Overview",
    "Mobile": "Mobile", "Desktop": "Ordinateur", "Tablet": "Tablette",
    "Background work": "Tâches de fond", "Last ran": "Dernier passage", "never": "jamais", "Marked as seen": "Marqué comme vu",
    "New page": "Nouvelle page", "Page removed": "Page retirée", "Title changed": "Titre modifié", "Search title changed": "Titre dans les résultats modifié", "Meta description changed": "Méta description modifiée", "Main heading changed": "Titre principal modifié", "Headings changed": "Titres modifiés", "Content changed": "Contenu modifié", "Canonical changed": "Canonique modifiée", "Structured data changed": "Données structurées modifiées", "Links changed": "Liens modifiés", "Redirect changed": "Redirection modifiée", "Status changed": "Statut modifié", "Indexing changed": "Indexation modifiée",
  };
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
