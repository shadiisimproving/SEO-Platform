/* Pages, in the side menu (2026-11-12, the owner's request): every page of my sites, and one page with everything the app
   knows about it.

   The list leads with four counts that also filter it (all, getting clicks, not indexed, with open tasks), then one table:
   page, Google clicks, position, and what's linked to it (tasks, notes, backlinks). A row opens the page.
   The page view has the answer on top (the page's numbers for the period), two buttons (New task about this page, Add a
   note) and one tab per question: Search, Visits, Rankings, Backlinks, Tasks, Notes, Technical, Content.

   Server: GET /api/site-pages (the list), GET /api/site-pages/profile (one page), GET /api/metrics/page (its numbers for the
   period, the same answer as the Content row panel). Tasks come from tasks.js and notes from comp-notes.js, as everywhere.
   The address keeps the open page (#pages?page=https://site/path), and Back returns to the list. */
(() => {
  "use strict";
  let UI = null, t, esc, icon, num;
  const P = {
    key: "", list: null, loading: false, failed: "", filter: "",
    open: null, // { url, host, siteId } of the page on show, or null for the list
    tab: "search", profile: null, profileFor: "", metrics: null, metricsFor: "", failedPage: "",
  };
  const PAGES = "pg";
  const TABS = [["search", "Search", "search"], ["visits", "Visits", "activity"], ["rankings", "Rankings", "trending-up"], ["backlinks", "Backlinks", "link-2"],
    ["tasks", "Tasks", "square-check"], ["notes", "Notes", "sticky-note"], ["technical", "Technical", "heart-pulse"], ["content", "Content", "file-text"]];
  const FILTERS = [["", "Pages"], ["clicks", "Get clicks"], ["noclicks", "No clicks"], ["noindex", "Not indexed"], ["tasks", "Open tasks"], ["links", "Have backlinks"]];

  const cells = () => window.OV_CELLS || { numCell: (v) => v, cellChange: () => "", posBadge: (p) => (p === null || p === undefined ? "—" : esc(String(p))) };
  const dec1 = (v) => (v === null || v === undefined ? "—" : UI.dec ? UI.dec(v) : String(v));
  const pathOf = (url) => { try { const u = new URL(url); return decodeURI(u.pathname); } catch { return String(url || ""); } };
  const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const siteIdOf = (host) => (window.SITES || []).find((s) => s.host === host)?.realId || null;
  const periodQuery = () => { const parts = [UI.range.days()]; const site = UI.siteIdPicked(); if (site) parts.push(`site_id=${site}`); return parts.join("&"); };
  const when = (iso) => (iso ? UI.fmtDateOnly ? UI.fmtDateOnly(iso) : iso.slice(0, 10) : "");

  // ---- loading -----------------------------------------------------------------------------------
  async function loadList() {
    const key = periodQuery();
    if (P.loading || (P.key === key && (P.list || P.failed))) return;
    P.loading = true; P.key = key; P.failed = "";
    try { P.list = await window.COMP.api("GET", `site-pages?${key}`); } catch (err) { P.list = null; P.failed = err.message; }
    P.loading = false;
    if (UI.state.route === "pages" && !P.open) UI.render();
  }
  async function loadPage() {
    const o = P.open;
    if (!o) return;
    const forProfile = `${o.siteId}|${o.url}`, forMetrics = `${forProfile}|${periodQuery()}`;
    const jobs = [];
    if (P.profileFor !== forProfile) {
      P.profileFor = forProfile; P.profile = null; P.failedPage = "";
      jobs.push(window.COMP.api("GET", `site-pages/profile?site_id=${o.siteId}&url=${encodeURIComponent(o.url)}`).then((d) => { P.profile = d; }).catch((err) => { P.failedPage = err.message; }));
    }
    if (P.metricsFor !== forMetrics) {
      P.metricsFor = forMetrics; P.metrics = null;
      jobs.push(window.COMP.api("GET", `metrics/page?${UI.range.days()}&site_id=${o.siteId}&path=${encodeURIComponent(pathOf(o.url))}&host=${encodeURIComponent(o.host)}`)
        .then((d) => { P.metrics = d; }).catch(() => { P.metrics = { failed: true }; }));
    }
    if (!jobs.length) return;
    await Promise.all(jobs);
    if (UI.state.route === "pages" && P.open === o) { UI.render(); }
  }

  // ---- the list ----------------------------------------------------------------------------------
  const linkedBits = (r) => {
    const bit = (n, ic, one, many) => (n ? `<span class="pg-bit" title="${num(n)} ${t(n === 1 ? one : many)}">${icon(ic)}<span class="tabular">${num(n)}</span><span class="sr">${t(n === 1 ? one : many)}</span></span>` : "");
    const out = bit(r.tasks_open, "square-check", "open task", "open tasks") + bit(r.notes, "sticky-note", "note", "notes") + bit(r.backlinks, "link-2", "backlink", "backlinks");
    return out || `<span class="muted">—</span>`;
  };
  const PASS = { clicks: (r) => r.clicks > 0, noclicks: (r) => !r.clicks, noindex: (r) => r.indexed === false, tasks: (r) => r.tasks_open > 0, links: (r) => r.backlinks > 0 };
  const passes = (r) => (PASS[P.filter] ? PASS[P.filter](r) : true);

  function listBody() {
    if (P.failed) return UI.failCard ? UI.failCard(P.failed, { retry: 'id="pg-retry"' }) : `<p class="error">${esc(P.failed)}</p>`;
    if (!P.list) return UI.skeleton("table", { rows: 8 });
    const d = P.list, s = d.summary;
    if (!d.pages.length) {
      return window.COMP.empty(t("No pages yet"), t("Pages show here once Search Console or Google Analytics sends data, or once the page reader has read your site."),
        `<button class="btn" data-pg-go="settings">${t("Open Settings")}</button>`);
    }
    const counts = { "": s.pages, clicks: s.with_clicks, noclicks: s.pages - s.with_clicks, noindex: s.not_indexed, tasks: s.open_tasks, links: d.pages.filter(PASS.links).length };
    const chips = `<div class="pg-counts" role="group" aria-label="${t("Show")}">${FILTERS.map(([id, word]) => `<button type="button" class="pg-count${id === "noindex" && counts[id] ? " is-warn" : ""}" data-pg-filter="${id}" aria-pressed="${P.filter === id}"><b class="tabular">${num(counts[id] || 0)}</b><span>${t(word)}</span></button>`).join("")}</div>`;
    const rows = d.pages.filter(passes).filter((r) => window.TP.matches(PAGES, `${r.path} ${r.title} ${r.host}`));
    const view = window.TP.view(PAGES, rows);
    const many = !UI.siteIdPicked();
    const { numCell, cellChange, posBadge } = cells();
    const compare = d.pages.some((r) => r.clicks_before !== null);
    const table = rows.length ? `<div class="table-wrap"><table class="data pg-table" id="pg-table" data-tt-own-count>
      <thead><tr><th scope="col">${t("Page")}</th><th scope="col" class="num">${t("Google clicks")}</th><th scope="col" class="num">${t("Position")}</th><th scope="col">${t("Linked")}</th></tr></thead>
      <tbody>${view.rows.map((r) => `<tr data-pg-open="${esc(r.url)}" tabindex="0">
        <td class="head-cell pg-page"><button type="button" class="kw pg-title" data-pg-open-btn="${esc(r.url)}" dir="auto">${esc(r.title || r.path)}</button>
          <span class="second mono" dir="auto">${many ? `${esc(r.host)}` : ""}${esc(r.path)}</span>${r.indexed === false ? ` ${UI.status ? UI.status("warn", t("Not indexed")) : ""}` : ""}</td>
        <td class="num" data-label="${t("Google clicks")}">${r.clicks === null ? `<span class="muted">—</span>` : numCell(num(r.clicks), compare ? cellChange(r.clicks, r.clicks_before ?? 0) : null)}</td>
        <td class="num" data-label="${t("Position")}">${posBadge(r.position)}</td>
        <td data-label="${t("Linked")}"><span class="pg-bits">${linkedBits(r)}</span></td>
      </tr>`).join("")}</tbody></table></div>
      ${window.TP.footer(PAGES, view, { noun: t(view.total === 1 ? "page" : "pages") })}` : `<p class="muted pg-none">${t("No page matches.")}</p>`;
    return `${chips}<section class="card pg-card"><div class="card-head"><h2>${t(FILTERS.find(([id]) => id === P.filter)[1])}</h2><span class="n-badge tabular">${num(rows.length)}</span>
      <span class="end">${window.TP.search(PAGES, t("Search pages"))}</span></div>${table}</section>`;
  }

  // ---- one page ----------------------------------------------------------------------------------
  function headNumbers() {
    const m = P.metrics, p = P.profile;
    const tot = m && !m.failed ? m.totals : null, before = m && !m.failed ? m.before : null;
    const { cellChange } = cells();
    const tile = (label, value, change = "", sub = "") => `<div class="pg-num"><span class="pg-num-label">${t(label)}</span><span class="pg-num-v tabular">${value}${change ? ` ${change}` : ""}</span>${sub ? `<span class="pg-num-sub">${sub}</span>` : ""}</div>`;
    const loading = `<span class="muted">…</span>`;
    const ins = p?.technical?.inspection;
    const indexed = !p ? loading : !ins ? `<span class="muted pg-num-soft">${t("Not checked")}</span>` : ins.verdict === "PASS" ? `<span class="pg-good">${t("Yes")}</span>` : `<span class="pg-bad">${t("No")}</span>`;
    const speed = p?.technical?.speed?.mobile || p?.technical?.speed?.desktop;
    const tasks = UI.relatedTasks ? relatedOpen() : 0;
    return `<div class="pg-nums">
      ${tile("Google clicks", tot ? (tot.clicks === null ? "—" : num(tot.clicks)) : loading, tot && before ? cellChange(tot.clicks, before.clicks) : "")}
      ${tile("Position", tot ? dec1(tot.position) : loading, tot && before ? cellChange(tot.position, before.position, true) : "")}
      ${tile("Visits", tot ? (tot.sessions === null ? "—" : num(tot.sessions)) : loading, tot && before ? cellChange(tot.sessions, before.sessions) : "")}
      ${tile("Indexed", indexed, "", ins?.coverage && ins.verdict !== "PASS" ? esc(ins.coverage) : "")}
      ${!p || speed ? tile("Lab speed", !p ? loading : `<span class="${speed.score >= 90 ? "pg-good" : speed.score < 50 ? "pg-bad" : ""}">${num(speed.score)}</span><span class="muted">/100</span>`, "", speed ? realVisitors(speed) : "") : ""}
      ${tile("Open tasks", num(tasks))}
    </div>`;
  }
  /* The speed score is Google's lab test. Real visitors say Passed or Failed, and whose they are: this page, or the whole
     site when Google has too few visitors on the page (expert review 2026-11-17). */
  const realVisitors = (s) => {
    if (!s.field) return `<span class="muted">${t("No real-visitor data")}</span>`;
    const verdict = s.passed === true ? `<span class="pg-good">${t("Passed")}</span>` : s.passed === false ? `<span class="pg-bad">${t("Failed")}</span>` : "";
    return `${t("Real visitors")}: ${verdict} <span class="muted">${t(s.field === "site" ? "whole site" : "this page")}</span>`;
  };
  const relatedOpen = () => {
    const box = document.createElement("div");
    UI.setHTML(box, UI.relatedTasks({ host: P.open.host, page: P.open.url }));
    return box.querySelectorAll(".tk-rel-list li:not(.tk-rel-done)").length;
  };

  function tabCount(id) {
    const p = P.profile;
    if (!p) return "";
    const n = id === "rankings" ? p.rankings.length : id === "backlinks" ? p.backlinks.length : id === "technical" ? techIssues(p) : null;
    return n ? ` <span class="pg-tab-n tabular">${num(n)}</span>` : "";
  }
  const techIssues = (p) => p.technical.health.length + p.technical.links.length + (p.technical.inspection && p.technical.inspection.verdict !== "PASS" ? 1 : 0);

  function pageView() {
    const o = P.open;
    const p = P.profile;
    const title = p?.title || pathOf(o.url);
    const head = UI.topbar(title, `${PageLink.html(o.url, { text: `${o.host}${pathOf(o.url)} ↗`, cls: "pg-url" })}`,
      `<button class="btn" id="pg-note">${icon("sticky-note")}${t("Add a note")}</button><button class="btn btn-main" id="pg-task">${icon("plus")}${t("New task about this page")}</button>`, true);
    const back = `<button type="button" class="link-btn pg-back" id="pg-back">${icon("chevron-left")}${t("All pages")}</button>`;
    if (P.failedPage) return `${head}<div class="content page-enter">${back}${UI.failCard ? UI.failCard(P.failedPage, { retry: 'id="pg-retry-page"' }) : esc(P.failedPage)}</div>`;
    const tabs = `<div class="tabs pg-tabs" role="tablist" aria-label="${t("About this page")}">${TABS.map(([id, word, ic]) => `<button class="tab" role="tab" id="pg-tab-${id}" data-pg-tab="${id}" aria-selected="${P.tab === id}" aria-controls="pg-panel" tabindex="${P.tab === id ? 0 : -1}">${icon(ic)}${t(word)}${tabCount(id)}</button>`).join("")}</div>`;
    return `${head}<div class="content page-enter">${back}${headNumbers()}
      <section class="card pg-detail">${tabs}<div class="pg-panel" id="pg-panel" role="tabpanel" aria-labelledby="pg-tab-${P.tab}">${tabBody()}</div></section></div>`;
  }

  const waiting = () => UI.skeleton("rows", { rows: 4 });
  const emptyLine = (text) => `<p class="muted pg-empty">${text}</p>`;

  function tabBody() {
    const p = P.profile, m = P.metrics;
    const { numCell, cellChange, posBadge } = cells();
    if (P.tab === "search" || P.tab === "visits") {
      if (!m) return waiting();
      if (m.failed) return emptyLine(t("The numbers didn't load."));
      const search = P.tab === "search";
      const days = (m.days || []).map((d) => d.day);
      const values = (key) => Object.fromEntries((m.days || []).map((d) => [d.day, d[key]]));
      const has = (key) => (m.days || []).some((d) => d[key] !== null && d[key] !== undefined);
      if (search && !has("clicks")) return emptyLine(m.gsc?.state === "ok" ? t("Google shows no clicks or impressions for this page in this period.") : t("Connect Search Console to see this page's searches."));
      if (!search && !has("sessions")) return emptyLine(m.ga4?.state === "ok" ? t("No visits to this page in this period.") : t("Connect Google Analytics to see this page's visits."));
      const chart = window.LV?.lineChart ? window.LV.lineChart(`pg-chart-${P.tab}`, days, search
        ? [{ name: t("Clicks"), values: values("clicks"), color: "var(--series-1)" }]
        : [{ name: t("Visits"), values: values("sessions"), color: "var(--series-1)" }], { legend: false }) : "";
      if (search) {
        const q = m.queries || [];
        return `<h3 class="pg-h3 pg-h3-first">${t("Google clicks per day")}</h3><div class="pg-chart">${chart}</div><h3 class="pg-h3">${t("Searches that bring it")} <span class="muted tabular">${num(m.queries_total || 0)}</span></h3>
          ${q.length ? `<div class="table-wrap"><table class="data mini pg-mini" data-tt-off><thead><tr><th scope="col">${t("Search")}</th><th scope="col" class="num">${t("Clicks")}</th><th scope="col" class="num">${t("Impressions")}</th><th scope="col" class="num">${t("Position")}</th></tr></thead>
          <tbody>${q.map((r) => `<tr><td dir="auto">${KeywordLink.html(r.query, { host: P.open.host })}</td><td class="num">${numCell(num(r.clicks), r.clicks_before !== null && r.clicks_before !== undefined ? cellChange(r.clicks, r.clicks_before) : null)}</td><td class="num tabular">${num(r.impressions)}</td><td class="num">${posBadge(r.position)}</td></tr>`).join("")}</tbody></table></div>` : emptyLine(t("No searches recorded for this page."))}`;
      }
      const ai = m.ai_sources || [];
      return `<h3 class="pg-h3 pg-h3-first">${t("Visits per day")}</h3><div class="pg-chart">${chart}</div><h3 class="pg-h3">${t("AI assistants")}</h3>
        ${ai.length ? `<ul class="pg-list">${ai.map((a) => `<li>${UI.siteLogo ? UI.siteLogo(a.source, 16) : ""}<span dir="auto">${esc(a.source)}</span><span class="end tabular">${num(a.sessions)} ${t(a.sessions === 1 ? "visit" : "visits")}</span></li>`).join("")}</ul>` : emptyLine(t("No visits from AI assistants in this period."))}
        <p class="help">${t("Microsoft Clarity counts the whole site only, so it isn't shown per page.")}</p>`;
    }
    if (P.tab === "tasks") {
      const list = UI.relatedTasks({ host: P.open.host, page: P.open.url });
      return `${list.includes("tk-rel-list") ? list : emptyLine(t("No task is about this page yet."))}<p><button class="btn btn-small" id="pg-task-2">${icon("plus")}${t("New task about this page")}</button></p>`;
    }
    if (P.tab === "notes") {
      if (!window.COMP?.notes) return emptyLine(t("Notes need the running app."));
      return window.COMP.notes.block({ scope: "page", pageUrl: P.open.url, siteId: P.open.siteId, title: t("Notes on this page") });
    }
    if (!p) return waiting();
    if (P.tab === "rankings") {
      if (!p.rankings.length) return emptyLine(t("No tracked keyword ranks with this page. Track keywords on the Keywords screen."));
      const engines = [...new Set(p.rankings.flatMap((r) => Object.keys(r.engines)))];
      const ENG = { google: "Google", bing: "Bing", yandex: "Yandex", duckduckgo: "DuckDuckGo" };
      return `<div class="table-wrap"><table class="data mini pg-mini" data-tt-off><thead><tr><th scope="col">${t("Keyword")}</th>${engines.map((e) => `<th scope="col" class="num">${esc(ENG[e] || e)}</th>`).join("")}<th scope="col" class="num">${t("Impressions")}</th></tr></thead>
        <tbody>${p.rankings.map((r) => `<tr><td dir="auto">${KeywordLink.html(r.keyword, { host: P.open.host })}${r.country ? ` <span class="small muted">${esc(r.country.toUpperCase())}</span>` : ""}</td>${engines.map((e) => `<td class="num">${r.engines[e] ? posBadge(r.engines[e].position ?? r.engines[e].own) : "—"}</td>`).join("")}<td class="num tabular">${r.impressions === null || r.impressions === undefined ? "—" : num(r.impressions)}</td></tr>`).join("")}</tbody></table></div>`;
    }
    if (P.tab === "backlinks") {
      const linked = p.linked ? `<p class="help">${t("Search Console's Links report")}: ${num(p.linked.incoming || 0)} ${t("links from")} ${num(p.linked.sites || 0)} ${t("sites")}.</p>` : "";
      if (!p.backlinks.length) return `${emptyLine(t("No backlink you've logged points at this page."))}${linked}`;
      const VERD = { counts: ["good", "Counts"], weak: ["warn", "Weak"], none: ["serious", "Doesn't count"] };
      return `${linked}<div class="table-wrap"><table class="data mini pg-mini" data-tt-off><thead><tr><th scope="col">${t("Website")}</th><th scope="col">${t("Anchor")}</th><th scope="col">${t("Status")}</th></tr></thead>
        <tbody>${p.backlinks.map((b) => `<tr><td>${UI.siteLogo ? UI.siteLogo(b.domain, 16) : ""} ${PageLink.html(b.source, { text: b.domain })}</td><td dir="auto">${b.anchor ? esc(b.anchor) : `<span class="muted">—</span>`}</td>
          <td>${b.status === "lost" ? UI.status("serious", t("Lost")) : b.verdict && VERD[b.verdict] ? UI.status(VERD[b.verdict][0], t(VERD[b.verdict][1])) : `<span class="small sec">${esc(t(b.status === "live" ? "Live" : b.status))}</span>`}</td></tr>`).join("")}</tbody></table></div>`;
    }
    if (P.tab === "technical") {
      const x = p.technical;
      const row = (label, value) => `<div class="pg-fact"><dt>${t(label)}</dt><dd>${value}</dd></div>`;
      const ins = x.inspection;
      const speedLine = (s) => (s ? `<b class="tabular">${num(s.score)}</b>/100 <span class="small muted">${t("lab test")}</span>${s.lcp_ms ? ` · LCP ${UI.dec ? UI.dec(Math.round(s.lcp_ms / 100) / 10) : s.lcp_ms / 1000} s` : ""}<div class="small">${realVisitors(s)}</div>` : `<span class="muted">${t("Not measured")}</span>`);
      const health = x.health.length ? `<ul class="pg-list">${x.health.map((code) => `<li>${icon("triangle-alert", "warn")}<span>${esc(t(window.HealthTest?.checkWord?.(code) || code))}</span></li>`).join("")}</ul>` : `<span class="muted">${x.health_at ? t("Nothing found") : t("No health test yet")}</span>`;
      const links = x.links.length ? `<ul class="pg-list">${x.links.map((l) => `<li>${icon("link-2-off", "warn")}<span class="mono small" dir="auto">${PageLink.html(l.target)}</span><span class="end small sec">${l.status ? esc(String(l.status)) : esc(t(l.category))}</span></li>`).join("")}</ul>` : `<span class="muted">${x.links_at ? t("No broken links") : t("No links check yet")}</span>`;
      return `<dl class="pg-facts">
        ${row("Indexed", !ins ? `<span class="muted">${t("Not checked")}</span>` : `${ins.verdict === "PASS" ? `<span class="pg-good">${t("Yes")}</span>` : `<span class="pg-bad">${t("No")}</span>`}${ins.coverage ? ` · ${esc(ins.coverage)}` : ""}${ins.last_crawl ? ` · ${t("crawled")} ${esc(when(ins.last_crawl))}` : ""}`)}
        ${ins?.google_canonical && ins.google_canonical !== P.open.url ? row("Google's chosen address", PageLink.html(ins.google_canonical)) : ""}
        ${row("Speed on phone", speedLine(x.speed.mobile))}
        ${row("Speed on computer", speedLine(x.speed.desktop))}
        ${row("Health test", `${health}${x.health_at ? `<span class="small muted">${t("Test of")} ${esc(when(x.health_at))}</span>` : ""}`)}
        ${row("Broken links on it", `${links}${x.links_at ? `<span class="small muted">${t("Check of")} ${esc(when(x.links_at))}</span>` : ""}`)}
      </dl>`;
    }
    // Content: what the page reader saw.
    const r = p.read;
    if (!r || r.state !== "read") return emptyLine(t("The page reader hasn't read this page yet. Your site's pages are read every day."));
    const levelOf = (h) => Number(String(h).replace(/\D/g, "")) || 2; // stored as ["h2", "Why us"]
    const outline = [...(r.h1 || []).map((h) => [1, h]), ...(r.headings || []).filter((h) => Array.isArray(h) && levelOf(h[0]) > 1).map((h) => [levelOf(h[0]), h[1]])];
    const edits = p.edits.length ? `<h3 class="pg-h3">${t("Changes seen")}</h3><ul class="pg-list">${p.edits.map((e) => `<li><span class="small sec tabular">${esc(when(e.at))}</span><span>${esc(t(e.kind))}${e.words ? ` · ${num(e.words)} ${t("words")}` : ""}</span></li>`).join("")}</ul>` : "";
    return `<dl class="pg-facts">
        <div class="pg-fact"><dt>${t("Title")}</dt><dd dir="auto">${esc(r.title) || `<span class="muted">—</span>`} <span class="small muted tabular">${num(r.title_length)} ${t("characters")}</span></dd></div>
        <div class="pg-fact"><dt>${t("Description")}</dt><dd dir="auto">${esc(r.meta_description) || `<span class="muted">${t("None")}</span>`} ${r.meta_description ? `<span class="small muted tabular">${num(r.meta_length)} ${t("characters")}</span>` : ""}</dd></div>
        <div class="pg-fact"><dt>${t("Words")}</dt><dd class="tabular">${num(r.word_count)}</dd></div>
        <div class="pg-fact"><dt>${t("Links")}</dt><dd class="tabular">${num(r.internal_links)} ${t("inside the site")} · ${num(r.external_links)} ${t("to other sites")}</dd></div>
        ${r.schema_types?.length ? `<div class="pg-fact"><dt>${t("Structured data")}</dt><dd>${r.schema_types.map((s) => `<span class="tag">${esc(s)}</span>`).join(" ")}</dd></div>` : ""}
        ${r.noindex ? `<div class="pg-fact"><dt>${t("Robots")}</dt><dd><span class="pg-bad">noindex</span></dd></div>` : ""}
        <div class="pg-fact"><dt>${t("Read on")}</dt><dd>${esc(when(r.last_checked_at))}</dd></div>
      </dl>
      <h3 class="pg-h3">${t("Outline")}</h3>
      ${outline.length ? `<ol class="pg-outline">${outline.map(([level, text]) => `<li class="pg-h-${Math.min(level, 6)}"><span class="pg-hl">H${level}</span><span dir="auto">${esc(text)}</span></li>`).join("")}</ol>` : emptyLine(t("No headings on this page."))}
      ${edits}`;
  }

  // ---- the screen --------------------------------------------------------------------------------
  function page() {
    if (P.open) { loadPage(); return pageView(); }
    loadList();
    const head = UI.topbar(t("Pages"), t("Every page of your site, with what's linked to it"), "", true);
    return `${head}<div class="content page-enter">${listBody()}</div>`;
  }
  function after() {
    if (P.open && P.tab === "notes") window.COMP?.notes?.mount();
  }

  function openPage(url) {
    const host = hostOf(url);
    const siteId = siteIdOf(host) || UI.siteIdPicked();
    if (!siteId) { UI.toast?.(t("That page's site isn't one of yours.")); return; }
    history.pushState(null, "", location.href); // the list stays a step Back can return to
    P.open = { url, host, siteId };
    P.pushed = true;
    P.tab = "search";
    UI.render({ keepScroll: false });
    document.getElementById("main")?.scrollTo?.(0, 0);
  }
  function newTask(opener) {
    const o = P.open;
    UI.openTask?.({ host: o.host, title: "", pages: [o.url], about: { main: "page", items: [] }, opener });
  }

  function bind() {
    window.TP?.on(PAGES, () => { const box = UI.$(".content"); if (UI.state.route === "pages" && !P.open && box) { UI.setHTML(box, listBody()); } });
    // Any screen's row marked data-pg-goto (Content's table) opens that page here.
    const goto = (e) => {
      const row = e.target instanceof Element && e.target.closest("[data-pg-goto]");
      if (!row || e.target.closest("a, button, input, label, select")) return false;
      window.SCREENS.pages.open(row.dataset.pgGoto);
      return true;
    };
    document.addEventListener("click", (e) => { goto(e); });
    document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target instanceof Element && e.target.matches("[data-pg-goto]") && goto(e)) e.preventDefault(); });
    document.addEventListener("click", (e) => {
      if (!UI || UI.state.route !== "pages" || !(e.target instanceof Element)) return;
      const el = e.target;
      let hit;
      if ((hit = el.closest("[data-pg-filter]"))) { P.filter = hit.dataset.pgFilter; window.TP.reset(PAGES); UI.render(); UI.$(`[data-pg-filter="${P.filter}"]`)?.focus({ preventScroll: true }); return; }
      if ((hit = el.closest("[data-pg-open-btn]"))) { openPage(hit.dataset.pgOpenBtn); return; }
      if ((hit = el.closest("tr[data-pg-open]")) && !el.closest("a, button, input, label, select")) { openPage(hit.dataset.pgOpen); return; }
      if (el.closest("#pg-back")) {
        // Opened from the list: Back is the same step. Opened from a link: the list replaces the page in the address.
        if (P.pushed) { P.pushed = false; history.back(); } else { P.open = null; UI.render({ keepScroll: false }); }
        return;
      }
      if ((hit = el.closest("[data-pg-tab]"))) { P.tab = hit.dataset.pgTab; UI.render(); UI.$(`#pg-tab-${P.tab}`)?.focus({ preventScroll: true }); return; }
      if ((hit = el.closest("#pg-task, #pg-task-2"))) { newTask(hit); return; }
      if (el.closest("#pg-note")) { P.tab = "notes"; UI.render(); setTimeout(() => UI.$("#pg-panel textarea, #pg-panel [data-note-new], #pg-panel button")?.focus(), 60); return; }
      if (el.closest("#pg-retry")) { P.key = ""; P.failed = ""; UI.render(); return; }
      if (el.closest("#pg-retry-page")) { P.profileFor = ""; P.metricsFor = ""; P.failedPage = ""; UI.render(); return; }
      if ((hit = el.closest("[data-pg-go]"))) UI.go(hit.dataset.pgGo);
    });
    document.addEventListener("keydown", (e) => {
      if (!UI || UI.state.route !== "pages" || !(e.target instanceof Element)) return;
      if (e.key === "Enter" && e.target.matches("tr[data-pg-open]")) { e.preventDefault(); openPage(e.target.dataset.pgOpen); return; }
      // Arrow keys move between tabs, as tabs do.
      if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && e.target.matches("[data-pg-tab]")) {
        const at = TABS.findIndex(([id]) => id === P.tab), step = e.key === "ArrowRight" ? 1 : -1;
        P.tab = TABS[(at + step + TABS.length) % TABS.length][0];
        UI.render();
        UI.$(`#pg-tab-${P.tab}`)?.focus({ preventScroll: true });
      }
    });
    // A task saved anywhere changes the counts here.
    document.addEventListener("seocc:tasks-changed", () => { if (UI.state.route === "pages") { P.key = ""; if (!P.open) loadList(); } });
  }

  window.SCREENS = window.SCREENS || {};
  window.SCREENS.pages = {
    init(helpers) { UI = helpers; ({ t, esc, icon, num } = helpers); bind(); },
    page, after,
    address() { return P.open ? { page: P.open.url, tab: P.tab === "search" ? "" : P.tab } : P.filter ? { show: P.filter } : {}; },
    fromAddress(q) {
      const url = q.get("page");
      if (url && /^https?:\/\//i.test(url)) {
        const host = hostOf(url);
        const siteId = siteIdOf(host);
        P.open = siteId ? { url, host, siteId } : null;
        if (!siteId) UI.toast?.(t("That page's site isn't one of yours."));
        const tab = q.get("tab");
        P.tab = TABS.some(([id]) => id === tab) ? tab : "search";
      } else { P.open = null; P.pushed = false; }
      const show = q.get("show");
      P.filter = FILTERS.some(([id]) => id === show) ? show : "";
    },
    shown: () => P.open, // export.js: the page on show, if any
    open: (url) => { if (UI.state.route !== "pages") { P.open = null; UI.go("pages"); } openPage(url); },
  };

  const fr = {
    "Pages": "Pages", "Every page of your site, with what's linked to it": "Chaque page de votre site, avec ce qui y est lié", "Get clicks": "Reçoivent des clics",
    "Not indexed": "Non indexées", "Open tasks": "Tâches ouvertes", "No clicks": "Sans clic", "All about this page": "Tout sur cette page", "Have backlinks": "Avec backlinks", "Page": "Page", "Google clicks": "Clics Google", "Position": "Position", "Linked": "Lié",
    "open task": "tâche ouverte", "open tasks": "tâches ouvertes", "note": "note", "notes": "notes", "backlink": "backlink", "backlinks": "backlinks",
    "No pages yet": "Pas encore de pages", "Pages show here once Search Console or Google Analytics sends data, or once the page reader has read your site.": "Les pages s'affichent ici dès que Search Console ou Google Analytics envoie des données, ou que le lecteur de pages a lu votre site.",
    "Open Settings": "Ouvrir les réglages", "Search pages": "Chercher une page", "No page matches.": "Aucune page ne correspond.", "page": "page", "pages": "pages",
    "Add a note": "Ajouter une note", "New task about this page": "Nouvelle tâche sur cette page", "All pages": "Toutes les pages", "About this page": "À propos de cette page",
    "Search": "Recherche", "Visits": "Visites", "Rankings": "Positions", "Backlinks": "Backlinks", "Tasks": "Tâches", "Notes": "Notes", "Technical": "Technique", "Content": "Contenu",
    "Indexed": "Indexée", "Speed": "Vitesse", "Lab speed": "Vitesse (labo)", "lab test": "test labo", "No real-visitor data": "Pas de données de vrais visiteurs",
    "Real visitors": "Vrais visiteurs", "Passed": "Réussi", "Failed": "Échoué", "whole site": "site entier", "this page": "cette page", "Not checked": "Pas vérifié", "Yes": "Oui", "No": "Non",
    "The numbers didn't load.": "Les chiffres n'ont pas chargé.", "Google shows no clicks or impressions for this page in this period.": "Google n'indique ni clic ni impression pour cette page sur cette période.",
    "Connect Search Console to see this page's searches.": "Connectez Search Console pour voir les recherches de cette page.", "No visits to this page in this period.": "Aucune visite sur cette page pendant cette période.",
    "Connect Google Analytics to see this page's visits.": "Connectez Google Analytics pour voir les visites de cette page.", "Clicks": "Clics", "Impressions": "Impressions", "Leads": "Leads",
    "Searches that bring it": "Recherches qui y mènent", "Google clicks per day": "Clics Google par jour", "Visits per day": "Visites par jour", "No searches recorded for this page.": "Aucune recherche enregistrée pour cette page.", "AI assistants": "Assistants IA",
    "visit": "visite", "visits": "visites", "No visits from AI assistants in this period.": "Aucune visite d'assistants IA sur cette période.",
    "Microsoft Clarity counts the whole site only, so it isn't shown per page.": "Microsoft Clarity ne compte que le site entier : il n'apparaît pas par page.",
    "No task is about this page yet.": "Aucune tâche ne concerne encore cette page.", "Notes need the running app.": "Les notes demandent l'app lancée.", "Notes on this page": "Notes sur cette page",
    "No tracked keyword ranks with this page. Track keywords on the Keywords screen.": "Aucun mot-clé suivi ne se classe avec cette page. Suivez des mots-clés dans l'écran Mots-clés.",
    "Keyword": "Mot-clé", "Search Console's Links report": "Rapport Liens de Search Console", "links from": "liens depuis", "sites": "sites",
    "No backlink you've logged points at this page.": "Aucun backlink enregistré ne pointe vers cette page.", "Website": "Site", "Anchor": "Ancre", "Status": "Statut",
    "Lost": "Perdu", "Counts": "Compte", "Weak": "Faible", "Doesn't count": "Ne compte pas", "Live": "Actif",
    "Not measured": "Pas mesuré", "Nothing found": "Rien trouvé", "No health test yet": "Pas encore de test de santé", "No broken links": "Aucun lien cassé", "No links check yet": "Pas encore de contrôle des liens",
    "crawled": "explorée le", "Google's chosen address": "Adresse choisie par Google", "Speed on phone": "Vitesse sur mobile", "Speed on computer": "Vitesse sur ordinateur",
    "Health test": "Test de santé", "Test of": "Test du", "Broken links on it": "Liens cassés sur la page", "Check of": "Contrôle du",
    "The page reader hasn't read this page yet. Your site's pages are read every day.": "Le lecteur de pages n'a pas encore lu cette page. Les pages de votre site sont lues chaque jour.",
    "Changes seen": "Changements vus", "words": "mots", "Title": "Titre", "characters": "caractères", "Description": "Description", "None": "Aucune", "Words": "Mots", "Links": "Liens",
    "inside the site": "internes", "to other sites": "vers d'autres sites", "Structured data": "Données structurées", "Robots": "Robots", "Read on": "Lue le", "Outline": "Plan",
    "No headings on this page.": "Aucun titre sur cette page.", "That page's site isn't one of yours.": "Le site de cette page n'est pas un des vôtres.", "Show": "Afficher",
  };
  Object.keys(fr).forEach((word) => { if (window.FR && window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
