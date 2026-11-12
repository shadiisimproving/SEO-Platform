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
    "{n}+ impressions since first shown": "{n}+ impressions depuis la première apparition",
  };
  Object.keys(WORDS).forEach((w) => { if (window.FR && window.FR[w] === undefined) window.FR[w] = WORDS[w]; });

  const t = (s) => (window.UI ? UI.t(s) : s);
  const fill = (s, values) => Object.entries(values).reduce((out, [k, v]) => out.split(`{${k}}`).join(v), t(s));
  const esc = (s) => (window.UI ? UI.esc(s) : String(s ?? ""));
  const num = (n) => (window.UI ? UI.num(n) : String(n));
  const plural = (n, one, many) => (n === 1 ? t(one) : fill(many, { n: num(n) }));
  const pathOf = (url) => { try { return new URL(url).pathname || "/"; } catch { return url || ""; } };
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
  const GROUP_SHOWN = 3;
  // Which searches a day's row counts: the same floor for every row, so it's said once, under the list. Only if the
  // rows ever had different floors would each row say its own.
  const floorOf = (item) => item.detail?.min_impressions || 10;
  const floorHtml = (n, cls = "") => `<p class="bell-meta bell-floor ${cls}">${esc(fill("{n}+ impressions since first shown", { n: num(n) }))}</p>`;
  let floorOnRows = false;
  // A search tracked since opens its keyword in Keywords; any other, Overview → Queries (keyword-links.js).
  const goTip = (query, host) => t(window.KW?.trackedId?.(query || "", host || null) ? "See this keyword" : "Open in Overview → Queries");
  /* The day's new searches for one site, in one row: the three most shown, the rest behind Show them. */
  function groupHtml(item, readBtn, logo) {
    const d = item.detail || {}, queries = d.queries || [], open = B.opened === item.id;
    const list = (open ? queries : queries.slice(0, GROUP_SHOWN)).map((q, i) => `<li><button type="button" class="bell-go" data-bell-go="${item.id}" data-q="${i}" title="${esc(goTip(q.query, item.host))}"><span dir="auto">${esc(q.query)}</span></button>
        <span class="bell-num">${esc([place(q.position), plural(q.impressions, "1 impression", "{n} impressions")].filter(Boolean).join(" · "))}</span>
        <button type="button" class="icon-btn bell-track-one" data-bell-track="${item.id}" data-q="${i}" aria-label="${esc(`${t("Track")}: ${q.query}`)}" title="${esc(t("Track"))}">${UI.icon("plus")}</button></li>`).join("");
    const more = queries.length > GROUP_SHOWN ? `<button type="button" class="link-btn" data-bell-more="${item.id}" aria-expanded="${open}">${esc(open ? t("Hide") : fill("Show all {n}", { n: num(queries.length) }))}</button>` : "";
    return `<li class="bell-row ${item.read ? "" : "unread"}" data-bell-row="${item.id}">
      <span class="bell-dot" aria-hidden="true"></span>
      <div class="bell-body">
        <p class="bell-title">${esc(plural(d.count || queries.length, "1 new Google search", "{n} new Google searches"))}</p>
        <p class="bell-meta">${logo}<span>${esc(item.host)}</span><span>·</span><span>${esc(fill("Up to {d}", { d: dayLabel(d.day) }))}</span></p>
        <ul class="bell-more bell-group">${list}</ul>${more}${floorOnRows ? floorHtml(floorOf(item)) : ""}
      </div>
      <div class="bell-acts">${readBtn}</div>
    </li>`;
  }

  function rowHtml(item) {
    const d = item.detail || {}, logo = UI.siteLogo ? UI.siteLogo(item.host, 14) : "";
    const readBtn = `<button type="button" class="icon-btn bell-mark" data-bell-read="${item.id}" data-read="${!item.read}" aria-label="${esc(t(item.read ? "Mark as unread" : "Mark as read"))}" title="${esc(t(item.read ? "Mark as unread" : "Mark as read"))}">${UI.icon(item.read ? "circle" : "check")}</button>`;
    if (item.kind === "new_queries") return groupHtml(item, readBtn, logo);
    if (item.kind === "new_query_more") {
      const open = B.opened === item.id;
      const list = open ? `<ul class="bell-more">${(d.queries || []).map((q, i) => `<li><button type="button" class="bell-go" data-bell-go="${item.id}" data-q="${i}" title="${esc(goTip(q.query, item.host))}"><span dir="auto">${esc(q.query)}</span></button><span class="bell-num">${esc(place(q.position))}</span></li>`).join("")}</ul>` : "";
      return `<li class="bell-row ${item.read ? "" : "unread"}" data-bell-row="${item.id}">
        <span class="bell-dot" aria-hidden="true"></span>
        <div class="bell-body">
          <p class="bell-title">${esc(fill("{n} more new searches", { n: num(d.count || 0) }))}</p>
          <p class="bell-meta">${logo}<span>${esc(item.host)}</span><span>·</span><span>${esc(dayLabel(d.day))}</span></p>
          <button type="button" class="link-btn" data-bell-more="${item.id}" aria-expanded="${open}">${esc(t(open ? "Hide" : "Show"))}</button>
          ${list}
        </div>
        <div class="bell-acts">${readBtn}</div>
      </li>`;
    }
    const facts = [place(d.position), d.impressions !== undefined ? plural(d.impressions, "1 impression", "{n} impressions") : "", d.clicks ? plural(d.clicks, "1 click", "{n} clicks") : ""].filter(Boolean);
    return `<li class="bell-row bell-row-go ${item.read ? "" : "unread"}" data-bell-row="${item.id}">
      <span class="bell-dot" aria-hidden="true"></span>
      <div class="bell-body">
        <p class="bell-title"><button type="button" class="bell-go" data-bell-go="${item.id}" title="${esc(goTip(d.query, item.host))}"><span class="bell-kind" role="img" title="${esc(t("New search on Google"))}" aria-label="${esc(t("New search on Google"))}">${UI.icon("search")}</span> <b dir="auto">“${esc(d.query || "")}”</b></button></p>
        <p class="bell-meta">${logo}<span>${esc(item.host)}</span>${d.page ? `<span>·</span>${PageLink.html(d.page, { text: pathOf(d.page), host: item.host, cls: "bell-path" })}` : ""}<span>·</span><span>${esc(dayLabel(d.day))}</span></p>
        <p class="bell-meta">${facts.map((f) => `<span>${esc(f)}</span>`).join("<span>·</span>")}</p>
      </div>
      <div class="bell-acts">
        <button type="button" class="btn btn-ghost bell-track" data-bell-track="${item.id}">${UI.icon("plus")}${esc(t("Track"))}</button>
        ${readBtn}
      </div>
    </li>`;
  }

  function panelHtml() {
    const sampleTag = window.BOOT ? "" : ` <span class="tag">${esc(t("Sample"))}</span>`;
    const head = `<div class="bell-head"><h2 id="bell-title">${esc(t("Notifications"))}${sampleTag}</h2>${B.unread ? `<button type="button" class="link-btn" id="bell-read-all">${esc(t("Mark all read"))}</button>` : ""}</div>`;
    if (B.failed && !B.loaded) return `${head}<p class="bell-empty">${esc(t("Notifications didn't load. Trying again in a few minutes."))}</p>`;
    if (!B.items.length) return `${head}<div class="bell-empty"><p><b>${esc(t("No notifications yet"))}</b></p><p>${esc(t("First-time Google searches for your sites appear here."))}</p></div>`;
    const floors = [...new Set(B.items.filter((i) => i.kind === "new_queries").map(floorOf))];
    floorOnRows = floors.length > 1;
    return `${head}<ul class="bell-list">${B.items.map(rowHtml).join("")}</ul>${floors.length === 1 ? floorHtml(floors[0], "bell-foot") : ""}`;
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
