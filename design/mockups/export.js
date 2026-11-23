/* Export: one button in the top bar of every screen with data, opening a small menu: PDF, Excel, CSV.
   The file is made on the server (seo/exports) from the same service functions the screen's own data comes from,
   for the site, days and filters on screen. Nothing here is drawn by the screens themselves: the button is added
   after each redraw, so a screen needs no code to have it. A screen may still open the menu from its own button
   with window.EXPORT.open(button). */
(() => {
  "use strict";
  const FR = {
    "Export": "Exporter", "Export this screen": "Exporter cet écran", "PDF report": "Rapport PDF", "Excel workbook": "Classeur Excel", "CSV file": "Fichier CSV",
    "To send or print": "À envoyer ou imprimer", "One sheet per table": "Une feuille par tableau", "Rows on screen; a .zip for several tables": "Lignes à l'écran ; un .zip pour plusieurs tableaux",
    "Preparing the file…": "Préparation du fichier…", "Downloaded": "Téléchargé", "Export failed. Try again.": "Échec de l'export. Réessayez.",
    "First rows only: the list is too long for one export.": "Premières lignes seulement : la liste est trop longue pour un export.",
    "Pick one site to export its links.": "Choisissez un site pour exporter ses liens.", "Pick one site to export its competitors.": "Choisissez un site pour exporter ses concurrents.",
    "ascending order": "ordre croissant", "descending order": "ordre décroissant",
    "Needs the running app": "Nécessite l'application en marche", "Please sign in.": "Veuillez vous connecter.",
  };
  const ui = () => window.UI;
  const t = (s) => (ui()?.state.lang === "fr" && FR[s] !== undefined ? FR[s] : ui()?.t(s) ?? s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const icon = (name) => (ui()?.icon ? ui().icon(name) : "");

  // ---- which export a screen has, and with what ------------------------------------------------
  const dayOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const shift = (day, by) => { const d = new Date(`${day}T00:00:00`); d.setDate(d.getDate() + by); return dayOf(d); };
  /* The days and comparison in the top bar, exactly as the traffic screens send them (UI.range.days). */
  function period() {
    const U = ui();
    if (U.range) return Object.fromEntries(new URLSearchParams(U.range.days()));
    const { from, to } = U.periodWindow();
    return { from, to };
  }
  const site = () => ui().siteIdPicked();

  // ---- what is on screen: rows a screen filters or sorts in the browser, and its filters in words ----
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3 || (n.nodeType === 1 && !["B", "SVG", "svg"].includes(n.tagName) && !n.classList.contains("tag"))).map((n) => n.textContent).join("").replace(/\s+/g, " ").trim();
  /* A pressed chip that isn't "All": its words without the count. */
  function chipWords(selector, attr, label = "Filter") {
    const chip = $$(`#page ${selector}[aria-pressed="true"]`).find((el) => !["", "all"].includes(el.dataset[attr] ?? ""));
    return chip ? [[label, ownText(chip)]] : [];
  }
  /* The column the table is sorted by, read from its heading. */
  function sortWords(root = "#page") {
    const th = document.querySelector(`${root} th[aria-sort="ascending"]:not([data-tt-col]), ${root} th[aria-sort="descending"]:not([data-tt-col])`);
    if (!th) return [];
    const copy = th.cloneNode(true);
    copy.querySelectorAll("svg, img, .th-sub").forEach((extra) => { extra.textContent = ""; });
    return [["Sorted by", `${copy.textContent.replace(/\s+/g, " ").trim()}, ${t(th.getAttribute("aria-sort") === "ascending" ? "ascending order" : "descending order")}`]];
  }
  /* Every filter box that holds something: its label and what was picked or typed. */
  function controlWords(selector) {
    return $$(`#page ${selector}`).map((el) => {
      if (el.type === "checkbox" || el.type === "radio" || !String(el.value || "").trim()) return null;
      const field = el.closest("label");
      const label = (field ? ownText(field.querySelector("span") || field) : "") || el.getAttribute("aria-label") || el.placeholder || t("Filter");
      const value = el.tagName === "SELECT" ? el.selectedOptions[0]?.textContent.trim() || el.value : el.value.trim();
      return [label, value];
    }).filter(Boolean);
  }
  /* A table drawn by the shared table of the traffic screens (screens-live.js): its rows as sorted, if it is on screen now. */
  const pageKey = (r) => `${r.host || ""}|${r.path || ""}`;
  function lvSeen(pairs) {
    const seen = {};
    pairs.forEach(([lvId, tableId, key]) => {
      const rows = document.querySelector(`#page [data-lv-sort="${lvId}"]`) ? window.LV?.chartData?.get(`table-${lvId}`)?.rows : null;
      if (rows) seen[tableId] = rows.map(key);
    });
    return seen;
  }
  const traffic = (view, pairs = [], table = "") => () => ({ view, params: { ...period(), site_id: site() }, table, seen: lvSeen(pairs), words: sortWords() });

  function overview() {
    const OV = window.OV || {};
    // The same range the screen asked for (UI.range.search), so the file holds what is on screen.
    const params = { ...Object.fromEntries(new URLSearchParams(ui().range.search())), site_id: site(), dim: OV.tab };
    if (OV.tab === "opportunities") params.kind = OV.opp;
    else { params.show = OV.show; if (OV.tab === "query") params.brand = OV.brand; }
    const f = OV.filters?.[OV.tab];
    if (f && (String(f.q || "").trim() || ["min_clicks", "min_impressions", "pos_from", "pos_to"].some((k) => String(f[k] ?? "").trim() !== ""))) {
      if (String(f.q || "").trim()) Object.assign(params, { q: f.q.trim(), q_mode: f.q_mode });
      ["min_clicks", "min_impressions", "pos_from", "pos_to"].forEach((k) => { params[k] = String(f[k] ?? "").trim(); });
    }
    if (OV.sort?.id) Object.assign(params, { sort: OV.sort.id, dir: OV.sort.dir });
    return { view: "overview", params, table: OV.tab };
  }
  function keywords() {
    const U = ui(), engine = U.state.engine === "all" ? "google" : U.state.engine;
    const ids = window.KW_REAL?.seen?.();
    return { view: "keywords", params: { site_id: site(), engine }, seen: ids ? { keywords: ids } : {}, words: [...chipWords("[data-filter]", "filter"), ...sortWords()] };
  }
  function backlinks() {
    const U = ui(), s = U.state.blSection, raw = U.exportSeen?.() || {};
    // On a real server a row's id is the saved one with "srv" in front.
    const plain = (ids) => (ids ? ids.map((id) => String(id).replace(/^srv/, "")) : null);
    const seen = { done: plain(raw.done), consideration: plain(raw.consideration) };
    const params = { site_id: site() };
    if (s === "consideration") return { view: "backlinks", params, table: "consideration", seen: { consideration: seen.consideration || [] }, words: controlWords("[data-pr-filter]") };
    if (s === "todo") {
      const todo = window.LinkTodo?.seen?.();
      return { view: "backlinks", params, table: "todo", seen: todo ? { todo: plain(todo.ids) } : {}, words: todo?.mediator ? [["Mediator", todo.mediator]] : [] };
    }
    const tab = U.state.blTab;
    if (tab !== "all") return { view: "backlinks", params, table: { mediators: "mediators", found: "found", reclaim: "reclaim" }[tab] || "done" };
    const words = [...chipWords("[data-bl-filter]", "blFilter")];
    const linking = document.querySelector('#page [data-vd-domain][aria-pressed="true"] .mono'); // "Website: x", picked from the by-website view
    if (linking) words.push(["Linking websites", linking.textContent.trim()]);
    if (U.state.blMediator) words.push(["Mediator", U.state.blMediator]);
    return { view: "backlinks", params, table: "done", seen: seen.done ? { done: seen.done } : {}, words };
  }
  function tasks() {
    // The board and the table draw every task that passes the filters, so the page itself is the list.
    // When the filters match nothing, nothing is on screen, so the file is empty too. Only while loading is there no list yet.
    const rows = $$("#page [data-task-row]").map((el) => el.dataset.taskRow), cards = $$("#page [data-task-card]").map((el) => el.dataset.taskCard);
    const body = document.querySelector("#page #tk-body"), drawn = body && !body.querySelector(".comp-skel");
    return { view: "tasks", params: { site_id: site() }, seen: drawn ? { tasks: rows.length ? rows : cards } : {}, words: [...chipWords("[data-task-period]", "taskPeriod", "Period"), ...controlWords(".tk-filters input, .tk-filters select")] };
  }
  function notes() {
    const params = {}, kind = document.getElementById("nv-list")?.dataset.noteKind || "", q = (window.COMP?.notes?.every?.search?.() || "").trim();
    if (kind) params.kind = kind;
    if (q) params.q = q;
    return { view: "notes", params };
  }
  function competitors() {
    const COMP = window.COMP || {};
    let tab = null;
    try { tab = COMP.currentTab?.()?.id || COMP.tab; } catch { tab = null; }
    const own = typeof COMP.siteId === "number" ? COMP.siteId : site();
    const params = { site_id: own };
    if (tab === "list") {
      const id = COMP.tabs?.find?.((x) => x.id === "list")?.competitorId;
      if (Number.isInteger(id)) return { view: "competitor", params: { ...params, competitor_id: id } };
    }
    const view = { check: "keyword-check", pairs: "page-pairs", gaps: "link-gaps", ai: "ai-watch", notes: "competitor-notes" }[tab] || "competitors";
    return { view, params };
  }
  function health() {
    const U = ui(), tab = U.state.healthTab, params = { site_id: site() };
    if (tab === "test") { const id = window.HealthTest?.shownAudit?.(); if (id) params.audit_id = id; return { view: "health", params }; }
    if (tab === "uptime") return { view: "uptime", params };
    const scan = U.exportSeen?.().scan;
    if (scan) params.scan_id = scan;
    return { view: "links", params };
  }
  const SCREENS = {
    // The period on screen (UI.range.search), so the file holds Today's numbers for that period, not always 28 days.
    today: () => ({ view: "today", params: { ...Object.fromEntries(new URLSearchParams(ui().range.search())), site_id: site() } }),
    channels: traffic("channels", [["channels", "channels", (r) => r.channel], ["referrers", "referrers", (r) => r.domain]]),
    conversions: traffic("conversions", [["types", "page_types", (r) => r.type], ["converting", "pages", pageKey]]),
    // Content tracker is its own export (seo/exports/views_traffic.py content_tracker), with the rows as filtered on screen.
    content: () => (window.LV?.contentTab?.() === "published"
      ? { view: "content-tracker", params: { ...period(), site_id: site() }, table: "pieces", seen: window.ContentTracker?.shown?.() ? { pieces: window.ContentTracker.shown() } : {}, words: [...chipWords("[data-ct-filter]", "ctFilter"), ...sortWords()] }
      : traffic("content", [["content", "pages", pageKey]], "pages")()),
    ai: traffic("ai", [["ai-sources", "sources", (r) => r.source], ["ai-pages", "pages", pageKey]]),
    ads: traffic("ads", [["campaigns", "campaigns", (r) => r.campaign]], "campaigns"),
    overview,
    insights: () => ({ view: "insights", params: { site_id: site(), group: window.INSIGHTS?.tab, status: window.INSIGHTS?.status } }),
    keywords, competitors, backlinks, health, tasks, notes,
    // Pages: the list for the period, or the one page on show.
    pages: () => {
      const open = window.SCREENS?.pages?.shown?.();
      return open ? { view: "site-page", params: { site_id: open.siteId, url: open.url } } : { view: "pages", params: { ...period(), site_id: site() } };
    },
    resources: () => ({ view: "resources", params: { site_id: site() }, seen: lvSeen([["resources", "resources", (r) => r.id]]), words: [...chipWords("[data-rs-filter]", "rsFilter", "Tag"), ...sortWords()] }),
    settings: () => ({ view: "connections", params: {} }),
  };
  function current() {
    const U = ui();
    if (!U || !U.state.served) return null; // opened as a plain file there is no server to make a file
    const make = SCREENS[U.state.route];
    try { return make ? make() : null; } catch { return null; }
  }
  function address(fmt, target) {
    const params = { ...target.params, lang: ui().state.lang === "fr" ? "fr" : "en" };
    if (fmt === "csv" && target.table) params.table = target.table;
    const query = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    return `api/export/${target.view}.${fmt}${query ? `?${query}` : ""}`;
  }

  /* A screen that filters or sorts in the browser says which rows it shows and in what order (never more than the server
     would give for this site: it only narrows and orders them), and its filters in words for the file's header. */
  function ask(fmt, target) {
    const seen = target.seen && Object.keys(target.seen).length ? target.seen : null, words = (target.words || []).filter((w) => w[0] && w[1]);
    if (!seen && !words.length) return fetch(address(fmt, target), { credentials: "same-origin", headers: { Accept: "*/*" } });
    const body = { ...target.params, lang: ui().state.lang === "fr" ? "fr" : "en" };
    Object.keys(body).forEach((k) => { if (body[k] === undefined || body[k] === null || body[k] === "") delete body[k]; else body[k] = String(body[k]); });
    if (target.table) body.table = target.table;
    if (seen) body.seen = seen;
    if (words.length) body.seen_words = words;
    return fetch(`api/export/${target.view}.${fmt}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "*/*" }, body: JSON.stringify(body) });
  }

  // ---- the menu -----------------------------------------------------------------------------------
  const FORMATS = [["pdf", "file-text", "PDF report", "To send or print"], ["xlsx", "columns-3", "Excel workbook", "One sheet per table"], ["csv", "rows-3", "CSV file", "Rows on screen; a .zip for several tables"]];
  let anchor = null, busy = false;
  /* The formats this server can make: a host without the PDF library still offers Excel and CSV. */
  const can = new Set(["pdf", "xlsx", "csv"]);
  if (location.protocol.startsWith("http")) fetch("api/export/views", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (Array.isArray(d?.formats) && d.formats.length) { can.clear(); d.formats.forEach((f) => can.add(f)); } }).catch(() => {});
  function close({ focus = false } = {}) {
    const menu = document.getElementById("export-menu");
    if (!menu) return;
    menu.remove();
    anchor?.setAttribute("aria-expanded", "false");
    if (focus && anchor?.isConnected) anchor.focus();
    anchor = null;
  }
  function open(button) {
    if (document.getElementById("export-menu")) { close({ focus: true }); return; }
    const target = current();
    if (!target) return;
    document.getElementById("popover")?.remove(); // one small menu at a time
    const menu = document.createElement("div");
    menu.id = "export-menu"; menu.className = "popover export-menu"; menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", t("Export this screen"));
    menu.innerHTML = FORMATS.filter(([fmt]) => can.has(fmt)).map(([fmt, ic, label, hint]) => `<button type="button" role="menuitem" data-export-fmt="${fmt}">${icon(ic)}<span class="export-words"><b>${esc(t(label))}</b><small>${esc(t(hint))}</small></span></button>`).join("");
    document.body.append(menu);
    anchor = button;
    button.setAttribute("aria-expanded", "true");
    const box = button.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(box.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
    const below = innerHeight - box.bottom - 16;
    menu.style.top = menu.offsetHeight > below && box.top > below ? `${Math.max(8, box.top - 6 - menu.offsetHeight)}px` : `${box.bottom + 6}px`;
    menu.querySelector("button").focus();
  }

  async function download(fmt) {
    const target = current();
    if (!target || busy) return;
    const U = ui();
    // Chosen access without every site: an export is of one of their sites (the server refuses "all sites" for them).
    if (window.ACCESS?.limited && !window.ACCESS.everySite() && target.params && !target.params.site_id) {
      U.toast(t("Pick one of your sites first, then export."), { kind: "info" });
      return;
    }
    busy = true;
    document.querySelectorAll("[data-export-open]").forEach((b) => { b.setAttribute("aria-busy", "true"); b.disabled = true; });
    const waiting = t("Preparing the file…");
    U.toast(waiting, { kind: "info", stay: true });
    const done = () => document.querySelectorAll("#toasts .toast").forEach((el) => { if (el.dataset.words === waiting) el.remove(); });
    try {
      const reply = await ask(fmt, target);
      if (!reply.ok) {
        let message = "Export failed. Try again.";
        try { message = (await reply.json()).error || message; } catch { /* not JSON: keep the plain message */ }
        throw new Error(message);
      }
      const blob = await reply.blob();
      done();
      const name = /filename="([^"]+)"/.exec(reply.headers.get("Content-Disposition") || "")?.[1] || `${target.view}.${fmt}`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob); link.download = name;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
      if (reply.headers.get("X-Export-Capped") === "1") U.toast(t("First rows only: the list is too long for one export."), { kind: "warn", stay: true });
      else U.toast(`${t("Downloaded")}: ${name}`);
    } catch (err) {
      done();
      U.toast(t(err.message === "Failed to fetch" ? "Export failed. Try again." : err.message), { kind: "crit" });
    } finally {
      busy = false;
      document.querySelectorAll("[data-export-open]").forEach((b) => { b.removeAttribute("aria-busy"); b.disabled = false; });
    }
  }

  // ---- the button, in the same place on every screen ----------------------------------------------
  const buttonHtml = () => `<button type="button" id="export-btn" class="export-btn" data-export-open data-label="${esc(t("Export"))}" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(t("Export this screen"))}">${icon("download")}<span>${esc(t("Export"))}</span></button>`;
  /* Screens in their own files draw their top bar with UI.topbar: the button goes into that markup, so it is there from
     the first paint and the bar's height is right when the screen measures it. */
  function wrapTopbar() {
    const U = ui();
    if (!U || U.topbar.exportWrapped) return;
    const plain = U.topbar;
    U.topbar = (...args) => {
      const html = plain(...args);
      const end = html.lastIndexOf("</div>");
      return current() && end > 0 ? `${html.slice(0, end)}${buttonHtml()}${html.slice(end)}` : html;
    };
    U.topbar.exportWrapped = true;
  }
  /* After every redraw: add the button where a screen drew its bar another way, and keep it in its spot,
     after the search, bell and date picks, before the screen's own main button. */
  function place() {
    const tools = document.querySelector("#topbar .tools");
    if (!tools) return;
    let button = tools.querySelector("#export-btn");
    if (!current()) { button?.remove(); return; }
    if (!button) {
      const holder = document.createElement("div");
      holder.innerHTML = buttonHtml();
      button = holder.firstElementChild;
      tools.append(button);
      // The bar may now be a row taller on a narrow screen: sticky table headings sit under it by this height.
      document.documentElement.style.setProperty("--topbar-h", `${document.getElementById("topbar").offsetHeight}px`);
    }
    const before = [...tools.children].find((el) => el !== button && el.matches(".btn:not(.kbd-hint):not(.btn-ghost)"));
    if (before && button.nextElementSibling !== before) tools.insertBefore(button, before);
  }
  function watch() {
    const page = document.getElementById("page");
    if (!page) return;
    wrapTopbar();
    let queued = false;
    new MutationObserver(() => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; close(); place(); }); }).observe(page, { childList: true });
    place();
  }

  document.addEventListener("click", (e) => {
    const opener = e.target.closest?.("[data-export-open]");
    if (opener) { e.preventDefault(); e.stopPropagation(); open(opener); return; }
    const pick = e.target.closest?.("[data-export-fmt]");
    if (pick) { e.preventDefault(); e.stopPropagation(); const fmt = pick.dataset.exportFmt; close(); download(fmt); return; }
    if (document.getElementById("export-menu")) close();
  }, true);
  document.addEventListener("keydown", (e) => {
    const menu = document.getElementById("export-menu");
    if (!menu) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close({ focus: true }); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [...menu.querySelectorAll("button")], at = items.indexOf(document.activeElement);
      items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    }
    if (e.key === "Tab") close();
  }, true);
  addEventListener("resize", () => close());

  window.EXPORT = { open, download, current, address };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();
})();
