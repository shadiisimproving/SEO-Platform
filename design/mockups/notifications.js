/* The bell at the top of every screen. News worth knowing that isn't a problem, starting with a search on Google that one
   of the sites never showed up for before (seo/notifications/new_queries.py). Problems stay on Today, as alerts.
   It asks the server every 5 minutes and when the tab comes back. New searches come as one row per site per day; "read"
   is each person's own once people sign in. */
(() => {
  "use strict";
  const POLL_MS = 5 * 60 * 1000;
  const B = { items: [], unread: 0, loaded: false, failed: false, open: false, opener: null, shown: new Set(), lastLoad: 0, firstLoad: true };
  window.Bell = B;

  const WORDS = {
    "Notifications": "Notifications",
    "Mark all read": "Tout marquer comme lu",
    "New search on Google": "Nouvelle recherche sur Google",
    "Position {n}": "Position {n}",
    "{n} impressions": "{n} impressions",
    "1 impression": "1 impression",
    "{n} clicks": "{n} clics",
    "1 click": "1 clic",
    "Track": "Suivre",
    "Mark as read": "Marquer comme lu",
    "Mark as unread": "Marquer comme non lu",
    "{n} more new searches": "{n} autres nouvelles recherches",
    "Show": "Afficher",
    "Hide": "Masquer",
    "No notifications yet": "Aucune notification pour l'instant",
    "First-time Google searches for your sites appear here.": "Les recherches Google où vos sites apparaissent pour la première fois s'affichent ici.",
    "Notifications, {n} unread": "Notifications, {n} non lues",
    "Notifications didn't load. Trying again in a few minutes.": "Les notifications ne se sont pas chargées. Nouvel essai dans quelques minutes.",
    "1 new Google search": "1 nouvelle recherche Google",
    "{n} new Google searches": "{n} nouvelles recherches Google",
    "Add it in Keywords.": "Ajoutez-le dans Mots-clés.",
    "Sample": "Exemple",
    "Open in Overview → Queries": "Ouvrir dans Vue d'ensemble → Requêtes",
    "Show all {n}": "Les afficher toutes ({n})", "Up to {d}": "Jusqu'au {d}",
    "Today": "Aujourd'hui", "Yesterday": "Hier", "Show less": "Afficher moins", "{n} more": "{n} de plus",
    "New on Google": "Nouveau sur Google", "Pos.": "Pos.", "Impr.": "Impr.", "{n} new": "{n} nouvelles",
    "{n}+ impressions only": "Seulement {n}+ impressions",
  };
  Object.keys(WORDS).forEach((w) => { if (window.FR && window.FR[w] === undefined) window.FR[w] = WORDS[w]; });

  const t = (s) => (window.UI ? UI.t(s) : s);
  const fill = (s, values) => Object.entries(values).reduce((out, [k, v]) => out.split(`{${k}}`).join(v), t(s));
  const esc = (s) => (window.UI ? UI.esc(s) : String(s ?? ""));
  const num = (n) => (window.UI ? UI.num(n) : String(n));
  const plural = (n, one, many) => (n === 1 ? t(one) : fill(many, { n: num(n) }));
  const dayLabel = (iso) => (iso ? new Intl.DateTimeFormat(UI.locale(), { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00`)) : "");
  const place = (p) => (p === null || p === undefined ? "" : fill("Position {n}", { n: UI.dec(Math.round(p * 10) / 10) }));

  // ---- the sample, when the screens are opened as a plain file -----------------------------------
  let sample = null;
  function sampleItems() {
    if (sample) return sample;
    const hosts = (window.SITES || []).map((s) => s.host).filter(Boolean);
    const host = hosts[0] || "shop-one.test", other = hosts[1] || host;
    const day = (back) => { const d = new Date(); d.setDate(d.getDate() - back); return d.toISOString().slice(0, 10); };
    sample = [
      { id: 3, host, kind: "new_query", title: "", detail: { query: "how much does it cost to open a company", day: day(1), impressions: 14, clicks: 1, position: 7.4, page: `https://${host}/prices/` }, read: false },
      { id: 2, host: other, kind: "new_query", title: "", detail: { query: "company setup timeline", day: day(2), impressions: 3, clicks: 0, position: 18.2, page: `https://${other}/guide/` }, read: false },
      { id: 1, host, kind: "new_query_more", title: "", detail: { day: day(3), count: 2, queries: [{ query: "open a bank account abroad", impressions: 2, position: 24 }, { query: "best free zone", impressions: 1, position: 31 }] }, read: true },
    ];
    return sample;
  }

  async function ask(method, path, body) {
    if (!window.COMP?.isServer || !(await COMP.isServer())) {
      const items = sampleItems();
      if (path === "notifications") return { items, unread: items.filter((i) => !i.read).length };
      const one = path.match(/^notifications\/(\d+)\/read$/);
      if (one) { const item = items.find((i) => i.id === Number(one[1])); if (item) item.read = body?.read !== false; return { ok: true }; }
      if (path === "notifications/read-all") { items.forEach((i) => { i.read = true; }); return { marked: 0 }; }
      return {};
    }
    return COMP.api(method, path, body);
  }

  // ---- loading -----------------------------------------------------------------------------------
  async function load() {
    B.lastLoad = Date.now();
    try {
      const answer = await ask("GET", "notifications");
      const fresh = (answer.items || []).filter((i) => !i.read && !B.shown.has(i.id));
      B.items = answer.items || [];
      B.unread = answer.unread || 0;
      B.loaded = true;
      B.failed = false;
      if (!B.firstLoad && fresh.length && window.UI) {
        const count = fresh.reduce((n, i) => n + (i.kind === "new_query_more" || i.kind === "new_queries" ? i.detail?.count || 0 : 1), 0);
        UI.toast(plural(count, "1 new Google search", "{n} new Google searches"), { kind: "info" });
      }
      B.items.forEach((i) => B.shown.add(i.id));
      B.firstLoad = false;
    } catch (err) {
      if (err?.status === 401) return; // signed out: the sign-in screen takes over
      B.failed = true;
    }
    paintButtons();
    if (B.open) paintPanel();
  }

  // ---- the button, drawn into every topbar (UI.topbar calls this) -------------------------------
  const label = () => (B.unread ? fill("Notifications, {n} unread", { n: num(B.unread) }) : t("Notifications"));
  const badge = () => (B.unread ? `<span class="bell-count" aria-hidden="true">${B.unread > 99 ? "99+" : num(B.unread)}</span>` : "");
  B.button = () => `<button type="button" class="icon-btn bell-btn" id="bell-open" aria-haspopup="true" aria-expanded="${B.open}" aria-controls="bell-pop" aria-label="${esc(label())}" title="${esc(t("Notifications"))}">${UI.icon("bell")}${badge()}</button>`;

  function paintButtons() {
    if (!window.UI) return;
    document.querySelectorAll("#bell-open").forEach((btn) => {
      btn.setAttribute("aria-label", label());
      btn.setAttribute("aria-expanded", String(B.open));
      btn.querySelector(".bell-count")?.remove();
      if (B.unread) btn.append(UI.fragment(badge()));
    });
  }

  // ---- the list ----------------------------------------------------------------------------------
  // One block per site (logo and name said once), a short day label per day, then one line per search: the search,
  // its position and its impressions as two columns headed once, and + to track it. Best position first.
  const GROUP_SHOWN = 3;
  const floorOf = (item) => item.detail?.min_impressions || 10;
  const goTip = (query, host) => t(window.KW?.trackedId?.(query || "", host || null) ? "See this keyword" : "Open in Overview → Queries");
  const shortDay = (iso) => {
    if (!iso) return "";
    const d = new Date(`${iso}T00:00:00`), now = new Date(); now.setHours(0, 0, 0, 0);
    const back = Math.round((now - d) / 86400000);
    return back === 0 ? t("Today") : back === 1 ? t("Yesterday") : dayLabel(iso);
  };
  const countOf = (item) => (item.kind === "new_query" ? 1 : item.detail?.count || item.detail?.queries?.length || 0);

  function lineHtml(item, q, i) {
    const qi = i === null ? "" : ` data-q="${i}"`, p = q.position;
    const pos = p === null || p === undefined ? "—" : UI.dec(Math.round(p * 10) / 10);
    const impr = q.impressions === undefined || q.impressions === null ? "—" : num(q.impressions);
    return `<li class="bell-q">
      <button type="button" class="bell-go" data-bell-go="${item.id}"${qi} title="${esc(`${q.query} — ${goTip(q.query, item.host)}`)}"><span dir="auto">${esc(q.query || "")}</span></button>
      <span class="bell-n${p !== null && p !== undefined && p <= 10 ? " bell-top" : ""}">${esc(pos)}</span>
      <span class="bell-n">${esc(impr)}</span>
      <button type="button" class="icon-btn bell-track-one" data-bell-track="${item.id}"${qi} aria-label="${esc(`${t("Track")}: ${q.query}`)}" title="${esc(t("Track"))}">${UI.icon("plus")}</button>
    </li>`;
  }

  function dayHtml(item) {
    const d = item.detail || {}, open = B.opened === item.id;
    const readBtn = `<button type="button" class="icon-btn bell-mark" data-bell-read="${item.id}" data-read="${!item.read}" aria-label="${esc(t(item.read ? "Mark as unread" : "Mark as read"))}" title="${esc(t(item.read ? "Mark as unread" : "Mark as read"))}">${UI.icon(item.read ? "circle" : "check")}</button>`;
    let lines, hidden = 0;
    if (item.kind === "new_query") lines = lineHtml(item, d, null);
    else {
      const all = (d.queries || []).map((q, i) => ({ q, i })).sort((x, y) => (x.q.position ?? 999) - (y.q.position ?? 999));
      const keep = item.kind === "new_query_more" ? (open ? all.length : 0) : open ? all.length : GROUP_SHOWN;
      hidden = item.kind === "new_query_more" ? d.count || all.length : Math.max(0, all.length - GROUP_SHOWN);
      lines = all.slice(0, keep).map(({ q, i }) => lineHtml(item, q, i)).join("");
    }
    const more = hidden ? `<button type="button" class="link-btn bell-more-btn" data-bell-more="${item.id}" aria-expanded="${open}">${esc(open ? t("Show less") : fill("{n} more", { n: num(hidden) }))}</button>` : "";
    return `<li class="bell-row ${item.read ? "" : "unread"}" data-bell-row="${item.id}">
      <div class="bell-day"><span class="bell-dot" aria-hidden="true"></span><span class="bell-day-name">${esc(shortDay(d.day))}</span>${readBtn}</div>
      <ul class="bell-group">${lines}</ul>${more}
    </li>`;
  }

  function panelHtml() {
    const sampleTag = window.BOOT ? "" : ` <span class="tag">${esc(t("Sample"))}</span>`;
    const head = `<div class="bell-head"><h2 id="bell-title">${esc(t("Notifications"))}${sampleTag}</h2>${B.unread ? `<button type="button" class="link-btn" id="bell-read-all">${esc(t("Mark all read"))}</button>` : ""}</div>`;
    if (B.failed && !B.loaded) return `${head}<p class="bell-empty">${esc(t("Notifications didn't load. Trying again in a few minutes."))}</p>`;
    if (!B.items.length) return `${head}<div class="bell-empty"><p><b>${esc(t("No notifications yet"))}</b></p><p>${esc(t("First-time Google searches for your sites appear here."))}</p></div>`;
    const cols = `<div class="bell-cols" aria-hidden="true"><span>${esc(t("New on Google"))}</span><span>${esc(t("Pos."))}</span><span>${esc(t("Impr."))}</span><span></span></div>`;
    const hosts = [];
    B.items.forEach((i) => { let h = hosts.find((x) => x.host === i.host); if (!h) hosts.push((h = { host: i.host, items: [] })); h.items.push(i); });
    const sites = hosts.map((h) => {
      const n = h.items.reduce((sum, i) => sum + countOf(i), 0);
      return `<section class="bell-site"><p class="bell-site-head">${UI.siteLogo ? UI.siteLogo(h.host, 14) : ""}<span class="bell-host">${esc(h.host)}</span><span class="bell-site-n">${esc(fill("{n} new", { n: num(n) }))}</span></p>
        <ul class="bell-list">${h.items.map(dayHtml).join("")}</ul></section>`;
    }).join("");
    const floors = [...new Set(B.items.filter((i) => i.kind === "new_queries").map(floorOf))];
    const foot = floors.length === 1 ? `<p class="bell-floor bell-foot">${esc(fill("{n}+ impressions only", { n: num(floors[0]) }))}</p>` : "";
    return `${head}${cols}${sites}${foot}`;
  }

  function place_(el, anchor) {
    const box = anchor.getBoundingClientRect(), width = Math.min(400, innerWidth - 16);
    el.style.width = `${width}px`;
    el.style.left = `${Math.max(8, Math.min(box.right - width, innerWidth - width - 8))}px`;
    el.style.top = `${box.bottom + 6}px`;
    el.style.maxHeight = `${Math.max(200, innerHeight - box.bottom - 16)}px`;
  }

  function paintPanel() {
    const el = document.getElementById("bell-pop");
    if (!el) return;
    UI.setHTML(el, panelHtml());
    const anchor = document.getElementById("bell-open");
    if (anchor) place_(el, anchor);
  }

  function openPanel(anchor) {
    closePanel();
    const el = document.createElement("div");
    el.id = "bell-pop";
    el.className = "popover bell-pop";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-labelledby", "bell-title");
    document.body.append(el);
    B.open = true;
    B.opener = anchor;
    paintPanel();
    paintButtons();
    (el.querySelector("#bell-read-all") || el.querySelector("button") || el).focus?.();
    if (Date.now() - B.lastLoad > 30000) load();
  }

  function closePanel({ focus = false } = {}) {
    const el = document.getElementById("bell-pop");
    if (el) el.remove();
    if (!B.open) return;
    B.open = false;
    B.opened = null;
    paintButtons();
    if (focus) document.getElementById("bell-open")?.focus();
  }

  async function setRead(id, read) {
    const item = B.items.find((i) => i.id === id);
    if (!item || item.read === read) return;
    item.read = read;
    B.unread = Math.max(0, B.unread + (read ? -1 : 1));
    paintButtons();
    if (B.open) paintPanel();
    try { await ask("POST", `notifications/${id}/read`, { read }); } catch { load(); }
  }

  // ---- clicks and keys ---------------------------------------------------------------------------
  document.addEventListener("click", async (event) => {
    const hit = (sel) => event.target.closest(sel);
    let el;
    if ((el = hit("#bell-open"))) { if (B.open) closePanel({ focus: true }); else openPanel(el); return; }
    if (!hit("#bell-pop")) { if (B.open) closePanel(); return; }
    if ((el = hit("#bell-read-all"))) {
      B.items.forEach((i) => { i.read = true; });
      B.unread = 0;
      paintButtons();
      paintPanel();
      try { await ask("POST", "notifications/read-all", {}); } catch { load(); }
      document.querySelector("#bell-pop button, #bell-pop")?.focus?.();
      return;
    }
    if ((el = hit("[data-bell-read]"))) { setRead(Number(el.dataset.bellRead), el.dataset.read === "true"); return; }
    if ((el = hit("[data-bell-more]"))) {
      const id = Number(el.dataset.bellMore);
      B.opened = B.opened === id ? null : id;
      setRead(id, true);
      paintPanel();
      document.querySelector(`[data-bell-more="${id}"]`)?.focus();
      return;
    }
    if ((el = hit("[data-bell-track]"))) {
      const item = B.items.find((i) => i.id === Number(el.dataset.bellTrack));
      if (!item) return;
      const query = el.dataset.q !== undefined ? item.detail.queries?.[Number(el.dataset.q)]?.query : item.detail.query;
      setRead(item.id, true);
      const opener = document.getElementById("bell-open");
      closePanel();
      if (!window.KW) { UI.toast(t("Add it in Keywords."), { kind: "info" }); return; }
      window.KW.track([query], item.host, opener, {});
      return;
    }
    // The search itself, or anywhere on its row but a button or link, opens it: its keyword when tracked, else Overview → Queries.
    const go = hit("[data-bell-go]") || (!hit("button, a, input") && hit(".bell-row-go"));
    if (go) {
      const item = B.items.find((i) => i.id === Number(go.dataset.bellGo || go.dataset.bellRow));
      if (!item) return;
      const d = item.detail || {}, one = go.dataset.q !== undefined ? d.queries?.[Number(go.dataset.q)] : null, q = one ? one.query : d.query;
      setRead(item.id, true);
      closePanel();
      // Tracked (or not known yet): the keyword's panel, as every keyword link opens it. Surely untracked: Overview over a
      // period that holds the search's first day, which only OV.openQuery is told.
      const tracked = window.KW?.trackedId ? window.KW.trackedId(q || "", item.host || null) : null;
      if (tracked !== null && window.KeywordLink) window.KeywordLink.open({ id: tracked || null, keyword: q, host: item.host });
      else if (window.OV?.openQuery) window.OV.openQuery({ host: item.host, query: q, day: one?.first_day || d.day });
      else UI.go("overview");
      return;
    }
    if ((el = hit("[data-bell-row]"))) setRead(Number(el.dataset.bellRow), true);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && B.open) { event.stopPropagation(); closePanel({ focus: true }); }
  }, true);
  addEventListener("resize", () => { if (B.open) paintPanel(); });
  // A screen that redraws after loading scrolls too, so the list follows the bell and closes only once the bell is gone.
  document.getElementById("main")?.addEventListener("scroll", () => {
    if (!B.open) return;
    const anchor = document.getElementById("bell-open"), el = document.getElementById("bell-pop");
    if (!anchor || anchor.getBoundingClientRect().bottom < 0) closePanel();
    else if (el) place_(el, anchor);
  }, { passive: true });

  // ---- when to ask -------------------------------------------------------------------------------
  function start() {
    if (!window.UI) return;
    load();
    setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - B.lastLoad > 60000) load(); });
  }
  if (document.readyState === "complete") setTimeout(start, 0);
  else addEventListener("load", () => setTimeout(start, 0));
})();
