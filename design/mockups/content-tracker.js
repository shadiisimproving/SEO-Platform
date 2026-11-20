/* Content → Content tracker (2026-11-20, the agency board's "Suivi des contenus"): did my articles work?

   Every published piece of my sites, newest first: its title (a link to the page) and path, when it was published, the search
   it targets (a link to that keyword) and its Google position, read again each month, then visits, Google clicks, average
   position and leads for the period picked, counted from the publish date.
   - Counts on top that also filter the list (All, Bring clicks, No clicks yet, Bring leads, Top 10), as on Pages.
   - The table is the traffic screens' shared table (LV.dataTable): sorting, search, pages of 25/50/100, ticks and Filter.
   - A row opens its panel: the numbers as rows, the position and clicks month by month, and the target query, publish date
     and title to change. Stop tracking has Undo.
   - "New pages found": pages the reader saw dated in the last 90 days, one press to track.
   Server: GET /api/content/tracker, GET /api/content/tracker/piece, POST /api/content/tracker (seo/content/tracker.py).
   screens-live.js draws it as the Content screen's second tab with window.ContentTracker.body(). English and French below. */
(() => {
  "use strict";
  const CT = { key: "", data: null, loading: false, failed: "", filter: "", piece: null, pieceFor: "" };
  const UI = () => window.UI;
  const t = (w) => UI().t(w);
  const esc = (v) => UI().esc(v);
  const num = (v) => UI().num(v);
  const icon = (n, c) => UI().icon(n, c);
  const fill = (s, values) => String(t(s)).replace(/\{(\w+)\}/g, (_, k) => String(values?.[k] ?? ""));
  const TABLE = "ctr";
  const known = (v) => v !== null && v !== undefined;
  const dec1 = (v) => (known(v) ? UI().dec(Math.round(v * 10) / 10) : "—");
  const day = (iso) => (iso ? new Intl.DateTimeFormat(UI().locale(), { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${iso.slice(0, 10)}T00:00:00`)) : "");
  const shortDay = (iso) => (iso ? new Intl.DateTimeFormat(UI().locale(), { day: "numeric", month: "short" }).format(new Date(`${iso.slice(0, 10)}T00:00:00`)) : "");
  const monthWord = (m) => new Intl.DateTimeFormat(UI().locale(), { month: "short", year: "2-digit" }).format(new Date(`${m}-01T00:00:00`));
  const periodQuery = () => { const parts = [UI().range.days()]; const site = UI().siteIdPicked(); if (site) parts.push(`site_id=${site}`); return parts.join("&"); };
  const keyOf = (r) => `${r.site_id}|${r.path}`;
  // A closing panel stays in the page for 120 ms: "closing" ones don't hold a redraw back.
  const redraw = () => { if (UI().state.route === "content" && !UI().$("#panel:not(.closing)")) UI().render({ keepScroll: true }); };
  const canEdit = () => !window.ACCESS || window.ACCESS.canEdit("content");
  const posBadge = (p) => (window.OV_CELLS?.posBadge ? window.OV_CELLS.posBadge(p) : esc(dec1(p)));
  const DATE_FROM = { typed: "Typed", page: "From the page", sitemap: "From the sitemap", archive: "Wayback Machine", first_seen: "First seen by the app" };

  // ---- the server -----------------------------------------------------------------------------------
  async function load(force = false) {
    if (!window.COMP?.server) return;
    const key = periodQuery();
    if (CT.loading || (!force && CT.key === key && (CT.data || CT.failed))) return;
    CT.loading = true; CT.key = key; CT.failed = "";
    try { CT.data = await window.COMP.api("GET", `content/tracker?${key}`); } catch (err) { CT.data = null; CT.failed = err.message; }
    CT.loading = false;
    redraw();
  }
  async function loadPiece(item) {
    const forKey = `${keyOf(item)}|${item.query || ""}`;
    if (CT.pieceFor === forKey && CT.piece) return CT.piece;
    CT.pieceFor = forKey; CT.piece = null;
    const q = item.query ? `&query=${encodeURIComponent(item.query)}` : "";
    CT.piece = await window.COMP.api("GET", `content/tracker/piece?site_id=${item.site_id}&page=${encodeURIComponent(item.path)}${q}`);
    return CT.piece;
  }
  async function save(body) {
    const saved = await window.COMP.api("POST", "content/tracker", body);
    CT.pieceFor = "";
    await load(true);
    return saved;
  }

  // ---- the list -------------------------------------------------------------------------------------
  const FILTERS = [["", "All pieces"], ["clicks", "Bring clicks"], ["noclicks", "No clicks yet"], ["leads", "Bring leads"], ["top10", "Top 10"]];
  const inTop10 = (r) => known(r.position?.value) && r.position.value <= 10;
  const PASS = { clicks: (r) => r.clicks > 0, noclicks: (r) => !r.after_period && known(r.clicks) && !r.clicks, leads: (r) => r.leads > 0, top10: inTop10 };
  const passes = (r) => (PASS[CT.filter] ? PASS[CT.filter](r) : true);

  function contentCell(r) {
    const many = !UI().siteHostPicked();
    const title = r.title || r.path;
    return `<div class="ct-piece">${window.PageLink ? PageLink.html(r.url, { text: title, cls: "ct-title" }) : esc(title)}
      <span class="ct-path mono" dir="auto">${many ? esc(r.host) : ""}${esc(r.path)}</span></div>`;
  }
  function dateCell(r) {
    if (!r.published) return `<span class="muted">—</span>`;
    const from = r.published_from && !["page", "typed"].includes(r.published_from) ? `<span class="ct-sub">${esc(t(DATE_FROM[r.published_from]))}</span>` : "";
    return `<span class="tabular">${esc(day(r.published))}</span>${from}`;
  }
  function queryCell(r) {
    if (!r.query) return canEdit() ? `<button type="button" class="link-btn ct-pick" data-ct-edit="${esc(keyOf(r))}">${icon("plus")}${t("Pick a query")}</button>` : `<span class="muted">—</span>`;
    const link = window.KeywordLink ? KeywordLink.html(r.query, { host: r.host }) : esc(r.query);
    // Picked by the app: one quiet word, the source in its tip (the long words wrapped to 3 lines in French).
    return `<span class="ct-query" dir="auto">${link}</span>${r.query_from === "search_console" ? `<span class="ct-sub" data-tip="${esc(t("Search Console's top search for this page. Open the row to change it."))}">${t("Suggested")}</span>` : ""}`;
  }
  function positionWords(p) {
    if (p.from === "check") {
      const tool = window.COMP?.toolWords ? window.COMP.toolWords("google", p.tool) : p.tool || "";
      return fill("Checked {day} · {tool}", { day: shortDay(p.read_on), tool });
    }
    return fill("Monthly · {day}", { day: shortDay(p.read_on) });
  }
  function positionCell(r) {
    const p = r.position;
    if (!p) return `<span class="muted">—</span>`;
    const badge = known(p.value) ? posBadge(p.value) : `<span class="pos ct-out">${esc(fill("Not in top {n}", { n: num(p.out_of || 100) }))}</span>`;
    const via = p.via ? `<span class="ct-sub ct-via">${t("via")} ${window.PageLink ? PageLink.html(p.via, { host: r.host, cls: "mono" }) : esc(p.via)}</span>` : "";
    const tip = p.from === "check" ? "" : ` data-tip="${esc(fill("Search Console's average for this search on this page, over the 28 days to {day}. Read again every month.", { day: day(p.read_on) }))}"`;
    return `<div class="ct-pos">${badge}${via}<span class="ct-sub ct-when"${tip}>${esc(positionWords(p))}</span></div>`;
  }
  const numOr = (v) => (known(v) ? num(v) : `<span class="muted">—</span>`);
  const COLUMNS = () => [
    { key: "title", label: "Content", get: (r) => `${r.title || ""} ${r.path}`, html: contentCell },
    { key: "published", label: "Published", get: (r) => r.published, html: dateCell },
    { key: "query", label: "Target query", get: (r) => r.query, html: queryCell },
    { key: "position", label: "Google position", num: true, get: (r) => r.position?.value ?? null, html: positionCell },
    { key: "sessions", label: "Visits", num: true, html: (r) => numOr(r.sessions) },
    { key: "clicks", label: "Google clicks", num: true, html: (r) => numOr(r.clicks) },
    { key: "avg_position", label: "Avg. position", num: true, html: (r) => (known(r.avg_position) ? `<span class="tabular">${dec1(r.avg_position)}</span>` : `<span class="muted">—</span>`) },
    { key: "leads", label: "Leads", num: true, html: (r) => numOr(r.leads) },
  ];

  function suggestionsCard(list) {
    if (!list?.length || !canEdit()) return "";
    const many = !UI().siteHostPicked();
    return `<section class="card ct-new" aria-labelledby="ct-new-h"><div class="card-head"><h2 id="ct-new-h">${t("New pages found")}</h2><span class="n-badge tabular">${num(list.length)}</span>
        <span class="end small muted">${t("Dated in the last 90 days, not tracked yet")}</span></div>
      <ul class="ct-new-list">${list.map((s) => `<li>
        <div class="ct-new-what">${window.PageLink ? PageLink.html(s.url, { text: s.title || s.path, cls: "ct-title" }) : esc(s.title || s.path)}<span class="ct-path mono" dir="auto">${many ? esc(s.host) : ""}${esc(s.path)}</span></div>
        <span class="ct-new-day small sec">${esc(day(s.published))} · ${esc(t(DATE_FROM[s.published_from] || ""))}</span>
        <button type="button" class="btn btn-small" data-ct-track="${esc(`${s.site_id}|${s.path}`)}">${icon("plus")}${t("Track")}</button>
      </li>`).join("")}</ul></section>`;
  }

  function body() {
    const L = window.LV;
    if (!window.COMP?.server) return L.emptyCard(t("Needs the running app"), t("Opened as a file: no real data."));
    load();
    if (CT.failed) return UI().failCard ? UI().failCard(CT.failed, { retry: "data-ct-retry" }) : `<p class="error">${esc(CT.failed)}</p>`;
    if (!CT.data || CT.key !== periodQuery()) return UI().skeleton("table", { rows: 6 });
    const d = CT.data, s = d.summary;
    if (d.gsc?.state === "no_sites") return L.emptyCard(t("No site yet"), t("Add a site to see its data."));
    const add = canEdit() ? `<button type="button" class="btn btn-small" data-ct-add>${icon("plus")}${t("Add a page")}</button>` : "";
    if (!d.items.length) {
      return `<section class="card"><div class="empty ct-empty"><h3>${t("No published piece tracked yet")}</h3>
        <p>${t("Articles show here once the page reader has read your site and found their publish date. You can also add any page.")}</p>
        ${add ? `<div style="margin-top:12px">${add.replace("btn btn-small", "btn btn-main")}</div>` : ""}</div></section>${suggestionsCard(d.suggestions)}`;
    }
    const counts = { "": s.pieces, clicks: s.with_clicks, noclicks: d.items.filter(PASS.noclicks).length, leads: s.with_leads, top10: s.top10 };
    const chips = `<div class="pg-counts ct-counts" role="group" aria-label="${t("Show")}">${FILTERS.map(([id, word]) => `<button type="button" class="pg-count" data-ct-filter="${id}" aria-pressed="${CT.filter === id}"><b class="tabular">${num(counts[id] || 0)}</b><span>${t(word)}</span></button>`).join("")}</div>`;
    const rows = d.items.filter(passes);
    const missing = [d.gsc?.state !== "ok" && "Search Console", d.ga4?.state !== "ok" && "Google Analytics"].filter(Boolean);
    const note = missing.length ? `<p class="note warn ct-note" role="status">${icon("triangle-alert")}<span>${esc(fill("{names}: not connected, so some numbers show —.", { names: missing.map((n) => t(n)).join(", ") }))}</span><button type="button" class="btn btn-small" data-lv-connect="google">${t("Connect")}</button></p>` : "";
    const g = UI().range.get();
    const table = L.dataTable(TABLE, COLUMNS(), rows, {
      search: "Search content", empty: "No piece matches.", wrapAttrs: "data-tt-own-count",
      rowAttrs: (r) => `data-ct-open="${esc(keyOf(r))}" tabindex="0"`,
    });
    return `${note}${chips}<section class="card ct-card"><div class="card-head"><h2>${t(FILTERS.find(([id]) => id === CT.filter)[1])}</h2><span class="n-badge tabular">${num(rows.length)}</span>
        <span class="end ct-head-end"><span class="small muted">${esc(UI().fmtRange(g.from, g.to))} · ${t("from the publish date")}</span>${add}</span></div>
      ${table}
      <p class="help ct-foot">${t("A lead counts on the page the visit landed on. Position: your rank check when the query is a tracked keyword, else Search Console's average over 28 days.")}</p></section>
      ${suggestionsCard(d.suggestions)}`;
  }

  // ---- one piece: the panel ------------------------------------------------------------------------
  const find = (key) => CT.data?.items.find((r) => keyOf(r) === key);
  function monthsTable(piece) {
    if (!piece) return `<div class="ct-months-wait">${UI().skeleton("table", { rows: 3 })}</div>`;
    if (piece.failed) return `<p class="small muted">${t("The months didn't load.")}</p>`;
    const months = piece.months.filter((m, i, all) => i >= all.findIndex((x) => known(x.position) || known(x.clicks) || known(x.sessions)));
    if (!months.length) return `<p class="small muted">${t("No Search Console or Analytics data for this page yet.")}</p>`;
    return `<div class="table-wrap ct-months"><table class="mini" data-tt-off><thead><tr><th scope="col">${t("Month")}</th><th scope="col" class="c">${t("Position")}</th><th scope="col" class="c">${t("Google clicks")}</th><th scope="col" class="c">${t("Visits")}</th><th scope="col" class="c">${t("Leads")}</th></tr></thead>
      <tbody>${months.slice().reverse().map((m) => `<tr><th scope="row">${esc(monthWord(m.month))}</th><td class="c">${known(m.position) ? `${posBadge(m.position)}${m.via ? ` <span class="small muted">${t("via")}</span>` : ""}` : `<span class="muted">—</span>`}</td><td class="c tabular">${numOr(m.clicks)}</td><td class="c tabular">${numOr(m.sessions)}</td><td class="c tabular">${numOr(m.leads)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function choicesHtml(piece) {
    const sc = piece?.choices?.search_console || [];
    if (!sc.length) return "";
    return `<div class="ct-choices" role="group" aria-label="${t("Searches that bring it")}"><span class="small muted">${t("Searches that bring it")}</span>${sc.slice(0, 5).map((c) => `<button type="button" class="tag ct-choice" data-ct-choice="${esc(c.query)}" dir="auto">${esc(c.query)} <span class="muted tabular">${num(c.clicks)}</span></button>`).join("")}</div>`;
  }
  function datalist(piece) {
    const c = piece?.choices || {};
    const all = [...new Set([...(c.search_console || []).map((x) => x.query), ...(c.tasks || []), ...(c.keywords || [])])];
    return all.map((q) => `<option value="${esc(q)}"></option>`).join("");
  }
  function panelHtml(r, piece) {
    const rows = [
      ["Published", r.published ? `${esc(day(r.published))} <span class="small muted">${esc(t(DATE_FROM[r.published_from] || ""))}</span>` : "—"],
      ["Google position", positionCell(r)],
      ["Visits", numOr(r.sessions)], ["Google clicks", numOr(r.clicks)], ["Avg. position", known(r.avg_position) ? dec1(r.avg_position) : "—"], ["Leads", numOr(r.leads)],
    ];
    const edit = canEdit() ? `<form id="ct-form" class="ct-form" novalidate>
        <h3>${t("What you track")}</h3>
        <label class="field"><span>${t("Target query")}</span><input class="input" name="f_query" id="ct-query" value="${esc(r.query_from === "typed" ? r.query : "")}" placeholder="${esc(r.query_from === "search_console" ? r.query : t("Type or pick a search"))}" list="ct-queries" maxlength="400" autocomplete="off" dir="auto" data-autofocus><datalist id="ct-queries">${datalist(piece)}</datalist></label>
        <p class="help">${t("Left empty, Search Console's top search for the page is used.")}</p>
        <div id="ct-choices">${choicesHtml(piece)}</div>
        <div class="field-row">
          <label class="field"><span>${t("Published")}</span><input class="input" type="date" name="f_published" id="ct-published" value="${esc(r.published_from === "typed" ? r.published : "")}"></label>
          <label class="field"><span>${t("Title")}</span><input class="input" name="f_label" id="ct-title" value="${esc(r.title_from === "typed" ? r.title : "")}" placeholder="${esc(r.title_from === "typed" ? "" : r.title || r.path)}" maxlength="500" dir="auto"></label>
        </div>
        <p class="help">${r.published && r.published_from !== "typed" ? esc(fill("Found: {day}, {from}. Type a date to change it.", { day: day(r.published), from: t(DATE_FROM[r.published_from] || "").toLowerCase() })) : t("Left empty, the date the app finds is used.")}</p>
        <div id="ct-error"></div>
      </form>` : "";
    return `${UI().panelHead(r.title || r.path, window.PageLink ? PageLink.html(r.url, { text: `${r.host}${r.path} ↗`, cls: "mono" }) : esc(r.url))}
      <div class="panel-body ct-panel">
        <ul class="rows ct-rows">${rows.map(([label, value]) => `<li><div class="what"><div class="t">${t(label)}</div></div><div class="acts">${value}</div></li>`).join("")}</ul>
        <p class="small muted">${esc(fill("Numbers for {period}, counted from {day}.", { period: UI().fmtRange(UI().range.get().from, UI().range.get().to), day: r.counted_from ? day(r.counted_from) : "—" }))}</p>
        <h3>${t("Month by month")}</h3><div id="ct-months">${monthsTable(piece)}</div>
        ${edit}
      </div>
      <div class="panel-foot">${canEdit() ? `<button class="btn btn-main" id="ct-save" data-key="${esc(keyOf(r))}">${t("Save")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button>
        <button class="btn btn-ghost" id="ct-task" data-key="${esc(keyOf(r))}">${icon("square-check")}${t("New task")}</button>
        <button class="btn btn-ghost danger" id="ct-stop" data-key="${esc(keyOf(r))}">${t("Stop tracking")}</button>` : `<button class="btn" data-close-panel>${t("Close")}</button>`}</div>`;
  }
  async function openPiece(key, opener) {
    const r = find(key);
    if (!r) return;
    UI().openPanel(panelHtml(r, null), opener, { key: `ct|${key}` });
    try { await loadPiece(r); } catch (err) { CT.piece = { failed: err.message }; }
    if (!UI().$("#ct-months") || UI().$("#ct-save")?.dataset.key !== key && canEdit()) return;
    UI().setHTML(UI().$("#ct-months"), monthsTable(CT.piece));
    const choices = UI().$("#ct-choices");
    if (choices) UI().setHTML(choices, choicesHtml(CT.piece));
    const list = UI().$("#ct-queries");
    if (list) UI().setHTML(list, datalist(CT.piece));
  }
  async function savePiece(button) {
    const r = find(button.dataset.key);
    if (!r) return;
    const box = UI().$("#ct-error");
    const body = { site_id: r.site_id, page: r.path, target_query: UI().$("#ct-query").value.trim(), published_on: UI().$("#ct-published").value, title: UI().$("#ct-title").value.trim() };
    button.disabled = true;
    try {
      await save(body);
      UI().forgetPanelForm(); UI().closePanel(); redraw();
      UI().toast(t("Saved"));
    } catch (err) {
      UI().setHTML(box, `<div class="error" role="alert">${icon("octagon-alert")}<span>${esc(t(err.message))}</span></div>`);
    } finally { if (button.isConnected) button.disabled = false; }
  }
  async function stopTracking(key) {
    const r = find(key);
    if (!r) return;
    try {
      await save({ site_id: r.site_id, page: r.path, removed: true });
      UI().forgetPanelForm(); UI().closePanel(); redraw();
      UI().toast(fill("Stopped tracking {page}", { page: r.path }), { undo: async () => { try { await save({ site_id: r.site_id, page: r.path, removed: false }); } catch (err) { UI().toast(t(err.message), { kind: "crit" }); } }, undoLabel: t("Undo") });
    } catch (err) { UI().toast(t(err.message), { kind: "crit" }); }
  }
  function newTask(key) {
    const r = find(key);
    if (!r || !UI().openTask) return;
    UI().closePanel();
    UI().openTask({ title: fill("Rework {title}", { title: r.title || r.path }), host: r.host, pages: [r.url], keywords: r.query ? [r.query] : [], kind: "Content" });
  }

  // ---- adding a page ---------------------------------------------------------------------------------
  function openAdd(opener) {
    const sites = (window.BOOT?.sites || []).filter((s) => s.kind === undefined || s.kind === "own");
    const picked = UI().siteIdPicked();
    const siteField = picked ? "" : `<label class="field"><span>${t("Site")}</span><select class="select" name="f_site" id="ct-add-site" style="width:100%">${sites.map((s) => `<option value="${esc(String(s.id))}">${esc(s.host)}</option>`).join("")}</select></label>`;
    UI().openPanel(`${UI().panelHead(t("Track a page"), t("Any page of your site: an article, a guide, a service page."))}
      <div class="panel-body"><form id="ct-add-form" novalidate>
        ${siteField}
        <label class="field"><span>${t("Page address")} <span class="req">*</span></span><input class="input mono" name="f_page" id="ct-add-page" placeholder="/guide-2026/" spellcheck="false" autocapitalize="off" autocomplete="off" maxlength="1000" data-autofocus></label>
        <label class="field"><span>${t("Target query")}</span><input class="input" name="f_query" id="ct-add-query" maxlength="400" autocomplete="off" dir="auto" placeholder="${esc(t("Optional: Search Console suggests one"))}"></label>
        <label class="field"><span>${t("Published")}</span><input class="input" type="date" name="f_published" id="ct-add-published"></label>
        <p class="help">${t("Left empty, the date the app finds is used.")}</p>
        <div id="ct-add-error"></div>
      </form></div>
      <div class="panel-foot"><button class="btn btn-main" id="ct-add-save">${t("Track")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener, { key: "ct|add" });
  }
  async function addPage(button) {
    const page = UI().$("#ct-add-page"), box = UI().$("#ct-add-error");
    UI().setHTML(box, "");
    page.classList.remove("invalid");
    if (!page.value.trim()) { page.classList.add("invalid"); page.focus(); UI().setHTML(box, `<div class="error" role="alert">${icon("octagon-alert")}<span>${t("Say which page.")}</span></div>`); return; }
    const siteId = Number(UI().siteIdPicked() || UI().$("#ct-add-site")?.value);
    const body = { site_id: siteId, page: page.value.trim() };
    const query = UI().$("#ct-add-query").value.trim(), published = UI().$("#ct-add-published").value;
    if (query) body.target_query = query;
    if (published) body.published_on = published;
    button.disabled = true;
    try {
      const saved = await save({ ...body, removed: false });
      UI().forgetPanelForm(); UI().closePanel(); redraw();
      UI().toast(fill("Tracking {page}", { page: saved.path }));
    } catch (err) {
      UI().setHTML(box, `<div class="error" role="alert">${icon("octagon-alert")}<span>${esc(t(err.message))}</span></div>`);
    } finally { if (button.isConnected) button.disabled = false; }
  }
  async function track(button) {
    const [site, ...rest] = button.dataset.ctTrack.split("|");
    button.disabled = true;
    try {
      const saved = await save({ site_id: Number(site), page: rest.join("|"), removed: false });
      UI().toast(fill("Tracking {page}", { page: saved.path }));
    } catch (err) { button.disabled = false; UI().toast(t(err.message), { kind: "crit" }); }
  }

  // ---- events ----------------------------------------------------------------------------------------
  document.addEventListener("click", (e) => {
    const el = e.target instanceof Element ? e.target : null;
    if (!el || !window.UI) return;
    let hit;
    if ((hit = el.closest("[data-ct-filter]"))) { CT.filter = hit.dataset.ctFilter; window.TP?.reset?.(`lv-${TABLE}`); UI().render({ keepScroll: true }); UI().$(`[data-ct-filter="${CT.filter}"]`)?.focus({ preventScroll: true }); return; }
    if (el.closest("[data-ct-retry]")) { CT.key = ""; CT.failed = ""; UI().render(); return; }
    if ((hit = el.closest("[data-ct-add]"))) { openAdd(hit); return; }
    if ((hit = el.closest("#ct-add-save"))) { addPage(hit); return; }
    if ((hit = el.closest("[data-ct-track]"))) { track(hit); return; }
    if ((hit = el.closest("[data-ct-edit]"))) { openPiece(hit.dataset.ctEdit, hit); return; }
    if ((hit = el.closest("#ct-save"))) { savePiece(hit); return; }
    if ((hit = el.closest("#ct-stop"))) { stopTracking(hit.dataset.key); return; }
    if ((hit = el.closest("#ct-task"))) { newTask(hit.dataset.key); return; }
    if ((hit = el.closest("[data-ct-choice]"))) { const box = UI().$("#ct-query"); if (box) { box.value = hit.dataset.ctChoice; box.focus(); } return; }
    // A row opens its panel, except its own links and buttons (the page, the keyword) and the tick box.
    if ((hit = el.closest("tr[data-ct-open]")) && !el.closest("a, button, input, label, select")) openPiece(hit.dataset.ctOpen, hit);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target instanceof Element && e.target.matches("tr[data-ct-open]")) { e.preventDefault(); openPiece(e.target.dataset.ctOpen, e.target); return; }
    if (e.key === "Enter" && e.target instanceof Element && e.target.closest("#ct-form, #ct-add-form") && e.target.matches("input:not([type='date'])")) {
      e.preventDefault();
      (UI().$("#ct-save") || UI().$("#ct-add-save"))?.click();
    }
  });
  document.addEventListener("submit", (e) => { if (e.target.id === "ct-form" || e.target.id === "ct-add-form") e.preventDefault(); });
  window.addEventListener("seocc:site-added", () => { CT.key = ""; CT.data = null; });

  window.ContentTracker = {
    body,
    count: () => CT.data?.summary?.pieces,
    shown: () => (CT.data ? CT.data.items.filter(passes).map((r) => `${r.host}|${r.path}`) : null), // export.js: the rows on screen, as the export names them
    forget: () => { CT.key = ""; CT.data = null; },
  };

  const fr = {
    "Content tracker": "Suivi des contenus", "All pieces": "Tous les contenus", "Bring clicks": "Apportent des clics", "No clicks yet": "Pas encore de clic", "Bring leads": "Apportent des demandes", "Top 10": "Top 10",
    "Content": "Contenu", "Published": "Publié le", "Target query": "Requête visée", "Google position": "Position Google", "Avg. position": "Pos. moyenne",
    "Pick a query": "Choisir une requête", "Checked {day} · {tool}": "Vérifiée le {day} · {tool}",
    "Monthly · {day}": "Chaque mois · {day}", "Suggested": "Suggérée", "Search Console's top search for this page. Open the row to change it.": "La première recherche Search Console pour cette page. Ouvrez la ligne pour la changer.",
    "Search Console's average for this search on this page, over the 28 days to {day}. Read again every month.": "Moyenne Search Console de cette recherche sur cette page, sur les 28 jours jusqu'au {day}. Relevée à nouveau chaque mois.", "Not in top {n}": "Hors top {n}", "via": "via",
    "Typed": "Saisie", "From the page": "Indiquée par la page", "From the sitemap": "D'après le sitemap", "Wayback Machine": "Wayback Machine", "First seen by the app": "Première visite de l'app",
    "New pages found": "Nouvelles pages trouvées", "Dated in the last 90 days, not tracked yet": "Datées des 90 derniers jours, pas encore suivies", "Track": "Suivre",
    "No published piece tracked yet": "Aucun contenu publié suivi pour l'instant",
    "Articles show here once the page reader has read your site and found their publish date. You can also add any page.": "Les articles s'affichent ici dès que le lecteur de pages a lu votre site et trouvé leur date de publication. Vous pouvez aussi ajouter n'importe quelle page.",
    "{names}: not connected, so some numbers show —.": "{names} : non connecté, certains chiffres affichent donc —.",
    "Search content": "Chercher un contenu", "No piece matches.": "Aucun contenu ne correspond.", "from the publish date": "depuis la date de publication",
    "A lead counts on the page the visit landed on. Position: your rank check when the query is a tracked keyword, else Search Console's average over 28 days.": "Une demande compte sur la page d'arrivée de la visite. Position : votre vérification quand la requête est un mot-clé suivi, sinon la moyenne Search Console sur 28 jours.",
    "The months didn't load.": "Les mois n'ont pas chargé.", "No Search Console or Analytics data for this page yet.": "Pas encore de données Search Console ou Analytics pour cette page.",
    "Month": "Mois", "Position": "Position", "Google clicks": "Clics Google", "Visits": "Visites", "Leads": "Demandes", "Searches that bring it": "Recherches qui y mènent",
    "What you track": "Ce que vous suivez", "Type or pick a search": "Saisir ou choisir une recherche", "Left empty, Search Console's top search for the page is used.": "Vide, la première recherche Search Console de la page est utilisée.",
    "Title": "Titre", "Found: {day}, {from}. Type a date to change it.": "Trouvée : {day}, {from}. Saisissez une date pour la changer.", "Left empty, the date the app finds is used.": "Vide, la date trouvée par l'app est utilisée.",
    "Numbers for {period}, counted from {day}.": "Chiffres pour {period}, comptés depuis le {day}.", "Month by month": "Mois par mois",
    "Save": "Enregistrer", "Cancel": "Annuler", "New task": "Nouvelle tâche", "Stop tracking": "Ne plus suivre", "Close": "Fermer", "Saved": "Enregistré",
    "Stopped tracking {page}": "{page} n'est plus suivie", "Undo": "Annuler", "Rework {title}": "Retravailler {title}", "Tracking {page}": "{page} est suivie",
    "Track a page": "Suivre une page", "Any page of your site: an article, a guide, a service page.": "N'importe quelle page de votre site : un article, un guide, une page de service.",
    "Site": "Site", "Page address": "Adresse de la page", "Optional: Search Console suggests one": "Facultatif : Search Console en propose une", "Say which page.": "Indiquez la page.",
    "Add a page": "Ajouter une page", "Show": "Afficher", "Connect": "Connecter", "Needs the running app": "Nécessite l'application en marche", "Opened as a file: no real data.": "Ouvert comme fichier : pas de vraies données.",
    "That page isn't on this site.": "Cette page n'est pas sur ce site.", "Write the publish date as YYYY-MM-DD.": "Écrivez la date de publication au format AAAA-MM-JJ.",
    "The target query is too long. It can hold 400 characters.": "La requête visée est trop longue : 400 caractères au maximum.", "That piece isn't tracked.": "Ce contenu n'est pas suivi.",
  };
  Object.keys(fr).forEach((word) => { if (window.FR && window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
