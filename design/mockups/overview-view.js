/* Search → Overview. Search Console's numbers the way its own screen shows them, read for an SEO:
   one sentence on top, four numbers that switch lines on the chart, the chart, then one card with tabs.
   Ranges are Search Console's own and are worked out on the server (seo/metrics/search.py), because only the server knows
   the newest day Google has. Track and Create task sit on row hover and in the side panel, never as a column of buttons. */
(() => {
  "use strict";
  let UI = null, t, esc, num, icon;
  const RANGES = [["24h", "Last 24 hours"], ["7d", "Last 7 days"], ["28d", "Last 28 days"], ["3m", "Last 3 months"], ["6m", "Last 6 months"], ["12m", "Last 12 months"], ["16m", "Last 16 months"], ["tm", "This month"], ["lm", "Last month"], ["custom", "Custom"]];
  const COMPARES = [["prev", "vs previous period"], ["yoy", "vs same period last year"], ["none", "No comparison"]];
  const METRICS = [
    { id: "clicks", name: "Clicks", color: "var(--ch-1)", ic: "mouse-pointer-click" },
    { id: "impressions", name: "Impressions", color: "var(--ch-2)", ic: "eye" },
    { id: "click_rate", name: "Click rate", color: "var(--ch-3)", ic: "percent" },
    { id: "position", name: "Average position", color: "var(--ch-5)", ic: "arrow-up-narrow-wide", invert: true },
  ];
  const TABS = [["query", "Queries"], ["page", "Pages"], ["country", "Countries"], ["device", "Devices"], ["opportunities", "Opportunities"]];
  const SHOWS = [["all", "All"], ["gaining", "Gaining clicks"], ["losing", "Losing clicks"], ["new", "New"], ["lost", "Lost"], ["top3", "Top 3"], ["4-10", "Positions 4 to 10"], ["11-20", "Positions 11 to 20"], ["21+", "Position 21 and after"]];
  const OPPS = [
    ["almost", "Almost on page 1", "Queries at positions 11 to 20 with real impressions. A small push brings them onto page 1."],
    ["low_ctr", "Low click rate", "Non-brand queries clicked far less than this site's own queries at the same position. Rewrite the title and description."],
    ["compete", "Two pages compete", "Queries where two or more of your pages each get a fair share of the impressions, so Google can't pick one."],
    ["lost", "Lost queries", "Queries that had clicks in the period before and now show nowhere. Small ones are left out."],
  ];
  const PER = [25, 50, 100]; // rows on a page: a site has hundreds of queries, so the table is paged
  const OV = {
    range: "28d", compare: "prev", from: "", to: "", lines: new Set(["clicks", "impressions"]), tab: "query", show: "all", brand: "all", opp: "almost",
    cache: new Map(), selected: new Set(), page: 0, per: 50, sort: null, table: false, poll: null, fresh: false,
    filters: { query: blankFilter(), page: blankFilter() }, moreFilters: false, toTable: false,
  };
  window.OV = OV;

  // ---- filters on Queries and Pages, worked out on the server (search.filter_from) -----------------
  function blankFilter() { return { q: "", q_mode: "contains", min_clicks: "", min_impressions: "", pos_from: "", pos_to: "" }; }
  const TEXT_MODES = [["contains", "Contains"], ["not", "Doesn't contain"], ["exact", "Exactly"], ["regex", "Matches regex"]];
  const NUMBER_FILTERS = [["min_clicks", "Clicks at least"], ["min_impressions", "Impressions at least"], ["pos_from", "Position from"], ["pos_to", "Position to"]];
  const filterOf = (dim) => OV.filters[dim] || null;
  const ADDR = { min_clicks: "minc", min_impressions: "mini", pos_from: "pf", pos_to: "pt" }; // short names in the address
  const numbersOn = (f) => NUMBER_FILTERS.filter(([id]) => String(f[id]).trim() !== "").length;
  const filterOn = (f) => Boolean(f && (f.q.trim() || numbersOn(f)));
  function filterArgs(dim) {
    const f = filterOf(dim);
    if (!filterOn(f)) return {};
    const out = { q: f.q.trim(), q_mode: f.q.trim() ? f.q_mode : "" };
    NUMBER_FILTERS.forEach(([id]) => { out[id] = String(f[id]).trim(); });
    return out;
  }

  // ---- asking the server ------------------------------------------------------------------------
  /* The app's one date range (UI.range): the preset itself, so the server ends it on Google's last final day. */
  function query(extra = {}) {
    const parts = { ...Object.fromEntries(new URLSearchParams(UI.range.search())), ...extra };
    const site = UI.siteIdPicked();
    if (site) parts.site_id = site;
    return Object.entries(parts).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  }
  function load(path, extra = {}) {
    const key = `search/${path}?${query(extra)}`;
    const held = OV.cache.get(key);
    if (held) return held;
    const entry = { loading: true, route: UI.state.route };
    OV.cache.set(key, entry);
    const ask = OV.fresh && path === "overview" ? `${key}&fresh=1` : key;
    if (path === "overview") OV.fresh = false;
    window.COMP.api("GET", ask).then((data) => { entry.data = data; })
      .catch((err) => { entry.error = err.message; entry.noServer = err.message === "Not in the sample data."; })
      .finally(() => { entry.loading = false; redraw(entry.route); });
    return entry;
  }
  /* Redraws when the answer comes. An open side panel waits: drawing under it would move focus. One that is closing doesn't. */
  function redraw(route = "overview") {
    if (UI.state.route !== route) return;
    const open = UI.$("#panel:not(.closing)");
    if (!open) { draw(); return; }
    clearTimeout(OV.later);
    OV.later = setTimeout(() => redraw(route), 400);
  }
  const forget = () => OV.cache.clear();
  OV.forget = forget; // Settings calls it after a connection is saved, so Overview doesn't keep "not connected"
  /* A redraw replaces the filter box, so typing in it would lose the cursor: it is put back where it was. */
  function draw() {
    const was = document.activeElement, field = was?.dataset?.ovF;
    let from = null, to = null;
    try { from = was.selectionStart; to = was.selectionEnd; } catch { /* number fields have no cursor to read */ }
    UI.render({ keepScroll: true });
    if (field) {
      const el = UI.$(`[data-ov-f="${field}"]`);
      if (el && el !== was) { el.focus({ preventScroll: true }); try { if (from !== null) el.setSelectionRange(from, to); } catch { /* same */ } }
    }
    scrollToTable();
  }
  /* Arriving from the bell: once the table has its rows, bring it into view. */
  function scrollToTable() {
    if (!OV.toTable || UI.state.route !== "overview") return;
    const card = UI.$(".ov-tabs-card");
    if (!card || card.querySelector("[aria-busy]")) return;
    OV.toTable = false;
    card.scrollIntoView({ block: "start" });
  }

  // ---- words and numbers -----------------------------------------------------------------------
  const fr = () => UI.state.lang === "fr";
  const dec1 = (v) => (v === null || v === undefined ? "—" : UI.dec(Math.round(v * 10) / 10));
  const rate = (v) => (v === null || v === undefined ? "—" : `${dec1(v)}${fr() ? " %" : "%"}`);
  const fmt = { clicks: (v) => num(v), impressions: (v) => num(v), click_rate: rate, position: dec1 };
  const dayLabel = (key, long = false) => {
    if (key.length > 10) return new Intl.DateTimeFormat(UI.locale(), { hour: "2-digit", minute: "2-digit", ...(long ? { day: "numeric", month: "short" } : {}) }).format(new Date(key));
    return new Intl.DateTimeFormat(UI.locale(), { day: "numeric", month: "short", ...(long ? { year: "numeric" } : {}) }).format(new Date(`${key}T00:00:00`));
  };
  const since = (iso) => {
    if (!iso) return "";
    const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (minutes < 1) return t("just now");
    if (minutes < 60) return fr() ? `il y a ${minutes} min` : `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return fr() ? `il y a ${hours} h` : `${hours} h ago`;
  };
  const pill = (good, text, neutral = false) => `<span class="${neutral ? "sec" : good ? "good" : "crit"} d-pill">${neutral ? "" : icon(good ? "arrow-up" : "arrow-down")}${text}</span>`;
  /* Each number changes in its own unit: counts in %, click rate in points, position in places. */
  function changeOf(id, now, before) {
    if (before === null || before === undefined || now === null || now === undefined) return "";
    if (id === "clicks" || id === "impressions") {
      if (!before) return `<span class="ab">${num(before)} → ${num(now)}</span>`;
      const p = Math.round(((now - before) / before) * 100);
      return `${p === 0 ? pill(true, t("No change"), true) : pill(p > 0, `${p > 0 ? "+" : "−"}${num(Math.abs(p))}%`)} <span class="ab">${num(before)} → ${num(now)}</span>`;
    }
    if (id === "click_rate") {
      const d = Math.round((now - before) * 10) / 10;
      return `${d === 0 ? pill(true, t("No change"), true) : pill(d > 0, `${d > 0 ? "+" : "−"}${UI.dec(Math.abs(d))} ${t("pts")}`)} <span class="ab">${rate(before)} → ${rate(now)}</span>`;
    }
    const places = Math.round((before - now) * 10) / 10; // fewer is better
    if (places === 0) return `${pill(true, t("No change"), true)} <span class="ab">${dec1(before)} → ${dec1(now)}</span>`;
    const word = Math.abs(places) === 1 ? t(places > 0 ? "place better" : "place worse") : t(places > 0 ? "places better" : "places worse");
    return `${pill(places > 0, `${UI.dec(Math.abs(places))} ${word}`)} <span class="ab">${dec1(before)} → ${dec1(now)}</span>`;
  }
  /* A number cell: the value, then its change in a slot of its own so changes line up down the column.
     Counts show the plain difference (+82, −524). Position shows places moved on the page: ↑ is up the page
     (better), ↓ is down it, so the arrow always matches what happened instead of the number going up. */
  const cellChange = (now, before, lowerIsBetter = false) => {
    if (before === undefined || now === null || before === null) return "";
    const d = Math.round((now - before) * 10) / 10;
    if (d === 0) return "";
    const good = lowerIsBetter ? d < 0 : d > 0;
    const text = lowerIsBetter ? `${good ? "↑" : "↓"}${UI.dec(Math.abs(d))}` : `${d > 0 ? "+" : "−"}${num(Math.abs(d))}`;
    const tip = lowerIsBetter ? t(good ? "Moved up in Google" : "Moved down in Google") : t("Change from the period before");
    return `<span class="ov-d ${good ? "good" : "crit"}" title="${tip}">${text}</span>`;
  };
  const numCell = (value, change) => `<span class="ov-nc"><span class="ov-v">${value}</span>${change === null ? "" : `<span class="ov-dslot">${change}</span>`}</span>`;
  const posBadge = (p) => (p === null || p === undefined ? "—" : `<span class="pos ${p <= 3 ? "pos-top3" : p <= 10 ? "pos-top10" : ""}">${dec1(p)}</span>`);
  window.OV_CELLS = { cellChange, numCell, posBadge }; // the same cells on Insights

  // ---- the sentence on top ----------------------------------------------------------------------
  // The sentence is HTML: a page in it opens that page, and everything taken from the data is escaped here.
  const driverName = (d) => (d.dim === "page" ? PageLink.html(d.name, { text: pathOf(d.name) }) : esc(fr() ? `« ${d.name} »` : `“${d.name}”`));
  const pathOf = (url) => { try { const u = new URL(url); return u.pathname || "/"; } catch { return url; } };
  function sentence(a, window_) {
    if (!a) return "";
    const range = t(RANGES.find(([id]) => id === window_.range)?.[1] || "this period").toLowerCase();
    if (a.kind === "summary") {
      const top = [a.top_query ? (fr() ? `la requête qui apporte le plus est ${driverName({ dim: "query", name: a.top_query })}` : `the top query is ${driverName({ dim: "query", name: a.top_query })}`) : "", a.top_page ? (fr() ? `la page ${driverName({ dim: "page", name: a.top_page })}` : `the top page ${driverName({ dim: "page", name: a.top_page })}`) : ""].filter(Boolean);
      return fr() ? `${num(a.clicks)} clics sur ${range}${top.length ? ` ; ${top.join(", ")}` : ""}.` : `${num(a.clicks)} clicks over ${range}${top.length ? `; ${top.join(", ")}` : ""}.`;
    }
    if (a.kind === "steady") return fr() ? `Les clics sont stables (${num(a.clicks)} ; ${num(a.before)} avant).` : `Clicks are steady (${num(a.clicks)}; ${num(a.before)} before).`;
    const up = a.kind === "up";
    const head = fr() ? `Les clics sont en ${up ? "hausse" : "baisse"} de ${num(Math.abs(a.percent))} % (${num(a.before)} → ${num(a.clicks)}).` : `Clicks ${up ? "rose" : "fell"} ${num(Math.abs(a.percent))}% (${num(a.before)} → ${num(a.clicks)}).`;
    if (!a.drivers?.length) return head;
    const list = a.drivers.map((d) => `${driverName(d)} ${d.change > 0 ? "+" : "−"}${num(Math.abs(d.change))}`).join(", ");
    return `${head} ${fr() ? (up ? "Plus forts gains" : "Plus fortes pertes") : up ? "Biggest gains" : "Biggest losses"}: ${list}.`;
  }

  // ---- trust line ------------------------------------------------------------------------------
  function trust(d) {
    const parts = [];
    parts.push(d.origin === "live"
      ? `<span class="ov-live">${icon("circle-check")}${t("Live from Search Console")}</span>`
      : `<span class="ov-saved">${icon("clock")}${t("Saved data")}${d.last_pull ? ` · ${t("last pulled")} ${esc(since(d.last_pull))}` : ""}</span>`);
    if (d.fresh_from && d.fresh_from <= d.to) parts.push(`<span>${t("Days from")} ${esc(dayLabel(d.fresh_from))} ${t("aren't final yet")}</span>`);
    const v = d.verify;
    if (v && v.ok) parts.push(`<span class="ov-match good">${icon("circle-check")}${t("Matches Search Console")}${v.checked_at ? ` · ${t("checked")} ${esc(since(v.checked_at))}` : ""}</span>`);
    else if (v && !v.ok) parts.push(`<button class="link-btn ov-match warn" data-ov-verify-open>${icon("triangle-alert")}${t("Differs from Search Console")}</button>`);
    if (d.single_site && d.origin === "live") parts.push(`<button class="link-btn" data-ov-verify-run>${t("Compare with Search Console")}</button>`);
    const line = `<p class="ov-trust small" role="status">${parts.join(`<span class="ov-dot" aria-hidden="true">·</span>`)}</p>`;
    return line + (d.origin !== "live" && d.live_error ? liveErrorNote(d.live_error) : "");
  }
  /* Google refused or failed: why, in plain words, what to do, and the button that opens the Google connection itself.
     Before, every cause read "Google didn't answer", and the reason was four steps away in Settings. */
  function liveErrorNote(message) {
    const fix = window.FIX?.explain ? window.FIX.explain(message, { tool: "Search Console", id: "google", retry: "refresh" }) : null;
    const why = fix?.summary ? t(fix.summary) : t("Google didn't answer, so this is the last pull.");
    const steps = window.FIX?.html ? window.FIX.html(message, { tool: "Search Console", id: "google", retry: "refresh" }, { said: true }) : "";
    return `<div class="note warn ov-live-error" role="alert">${icon("triangle-alert")}<div><p><b>${t("These are the last saved numbers.")}</b> ${esc(why)}</p>${steps}
      <p class="ov-empty-act"><button class="btn btn-small" data-ov-fix-google>${icon("settings")}${t("Open the Google connection")}</button></p></div></div>`;
  }

  // ---- four numbers, each a switch for its line ----------------------------------------------------
  function cards(d) {
    return `<section class="tiles ov-cards" aria-label="${t("Totals")}">${METRICS.map((m) => {
      const now = d.totals?.[m.id], before = d.before?.[m.id];
      const on = OV.lines.has(m.id);
      const line = d.series.map((p) => p[m.id]).filter((v) => v !== null && v !== undefined);
      const def = UI.def(m.name); // what the number means, on hover and focus (shared-ui.js)
      return `<button class="tile ov-card ${on ? "on" : ""}" style="--ov-c:${m.color}" data-ov-line="${m.id}" aria-pressed="${on}" ${def ? `data-tip="${esc(def)}"` : ""} aria-label="${esc(t(m.name))}: ${esc(fmt[m.id](now ?? null))}. ${t(on ? "Shown on the chart" : "Press to show it on the chart")}${def ? ` ${esc(def)}` : ""}">
        <div class="tile-top"><div class="lab"><i class="ov-tick" aria-hidden="true"></i>${t(m.name)}</div><span class="ico">${icon(m.ic)}</span></div>
        <div class="fig-row"><div class="fig">${now === null || now === undefined ? "—" : m.id === "clicks" || m.id === "impressions" ? UI.cnt(now) : fmt[m.id](now)}</div>${line.length > 1 ? `<div class="tile-spark">${UI.spark(line, { w: 88, h: 34, invert: m.invert })}</div>` : ""}</div>
        <div class="delta">${changeOf(m.id, now, before)}</div></button>`;
    }).join("")}</section>`;
  }

  // ---- chart: one axis per line, position upside down, comparison dashed, not-final days lighter -----
  const W = 1000, H = 220;
  function chart(d) {
    const pts = d.series;
    if (!pts.length) return `<div class="empty"><p>${t("No data in this period.")}</p></div>`;
    const shown = METRICS.filter((m) => OV.lines.has(m.id));
    if (!shown.length) return `<div class="empty"><p>${t("Press a number above to show its line.")}</p></div>`;
    const x = (i) => (pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W);
    const freshAt = pts.findIndex((p) => p.fresh);
    const axes = {};
    const draw = shown.map((m) => {
      const values = pts.map((p) => p[m.id]);
      const was = (d.compare_series || []).map((p) => p[m.id]);
      const all = [...values, ...was].filter((v) => v !== null && v !== undefined);
      let lo = Math.min(...all), hi = Math.max(...all);
      if (!m.invert) lo = 0;
      if (hi === lo) hi = lo + 1;
      axes[m.id] = { lo, hi };
      const y = (v) => (m.invert ? 8 + ((v - lo) / (hi - lo)) * (H - 16) : H - 8 - ((v - lo) / (hi - lo)) * (H - 16));
      const path = (list, from = 0, to = list.length - 1) => {
        let s = "", pen = false;
        for (let i = from; i <= to && i < pts.length; i++) {
          const v = list[i];
          if (v === null || v === undefined) { pen = false; continue; }
          s += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
          pen = true;
        }
        return s;
      };
      const solidEnd = freshAt > 0 ? freshAt - 1 : freshAt === 0 ? -1 : values.length - 1;
      return `${was.length ? `<path class="lv-line ov-was" d="${path(was)}" stroke="${m.color}"/>` : ""}
        ${solidEnd >= 0 ? `<path class="lv-line" d="${path(values, 0, solidEnd)}" stroke="${m.color}"/>` : ""}
        ${freshAt >= 0 ? `<path class="lv-line ov-fresh" d="${path(values, Math.max(0, freshAt - 1))}" stroke="${m.color}"/>` : ""}
        ${pts.length === 1 && values[0] !== null ? `<circle cx="${x(0)}" cy="${y(values[0])}" r="4" fill="${m.color}"/>` : ""}`;
    }).join("");
    const grid = [0, 0.5, 1].map((f) => `<line class="lv-grid" x1="0" x2="${W}" y1="${8 + f * (H - 16)}" y2="${8 + f * (H - 16)}"/>`).join("");
    // Markers sit on the point whose day (or week) holds them.
    const markAt = (m) => { let at = -1; pts.forEach((p, i) => { if (p.day.slice(0, 10) <= m.day) at = i; }); return at; };
    const marks = (d.markers || []).map((m) => ({ ...m, at: markAt(m) })).filter((m) => m.at >= 0);
    const flags = marks.map((m) => `<g class="ov-flag ${m.kind}"><line x1="${x(m.at)}" x2="${x(m.at)}" y1="0" y2="${H}"/></g>`).join("");
    const every = Math.max(1, Math.floor(pts.length / 6));
    const inner = pts.map((p, i) => [p, i]).filter(([, i]) => i > 0 && i % every === 0 && i < pts.length - every / 2).slice(0, 5);
    const ticks = [[pts[0], 0], ...inner, ...(pts.length > 1 ? [[pts[pts.length - 1], pts.length - 1]] : [])]; // the last day always shows
    const axisLabel = (m, side) => {
      const a = axes[m.id];
      if (!a) return "";
      const [top, bottom] = m.invert ? [a.lo, a.hi] : [a.hi, a.lo];
      // Grey text that passes contrast, with the line's colour as a small mark beside it (the purple alone was 4.2 to 1).
      const key = `<i class="ov-ylab-key" style="background:${m.color}" aria-hidden="true"></i>`;
      return `<span class="ov-ylab ${side}">${key}${esc(fmt[m.id](top))}</span><span class="ov-ylab ${side} bottom">${key}${esc(fmt[m.id](bottom))}</span>`;
    };
    window.OV.chart = { pts, was: d.compare_series || [], shown, marks };
    const legend = `<div class="lv-legend">${shown.map((m) => `<span><i class="lv-key" style="background:${m.color}"></i>${esc(t(m.name))}</span>`).join("")}
      ${d.compare_series ? `<span><i class="ov-key-dash" aria-hidden="true"></i>${t("Period before")}</span>` : ""}
      ${freshAt >= 0 ? `<span><i class="ov-key-fresh" aria-hidden="true"></i>${t("Not final yet")}</span>` : ""}
      ${marks.length ? `<span><i class="ov-key-flag" aria-hidden="true"></i>${t("Notes and finished tasks")}</span>` : ""}</div>`;
    return `<div class="lv-chart ov-chart" data-ov-chart tabindex="0" role="img" aria-label="${t("Chart")}: ${esc(shown.map((m) => t(m.name)).join(", "))}. ${t("Use the arrow keys to read each day.")}">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${grid}${flags}${draw}<line class="lv-cross" x1="0" x2="0" y1="0" y2="${H}" hidden/></svg>
        ${shown[0] ? axisLabel(shown[0], "left") : ""}${shown.length === 2 ? axisLabel(shown[1], "right") : ""}
        <div class="lv-tip" hidden></div>
        <div class="lv-axis" aria-hidden="true">${ticks.map(([p]) => `<span>${esc(dayLabel(p.day))}</span>`).join("")}</div>
      </div>${legend}
      ${marks.length ? `<ul class="ov-marks">${marks.map((m) => `<li>${icon(m.kind === "task" ? "circle-check" : "pencil")}<span class="muted">${esc(dayLabel(m.day))}</span> ${m.kind === "dated" ? `<button class="link-btn" dir="auto" data-notes-open="${esc(JSON.stringify([{ label: dayLabel(m.day), icon: "calendar-days", where: { scope: "date", day: m.day, siteId: m.site_id } }]))}">${esc(m.text)}</button>` : `<span dir="auto">${esc(m.text)}</span>`}${m.kind === "note" ? `<button class="icon-btn ov-mark-del" data-ov-note-del="${m.id}" aria-label="${t("Delete the note")}">${icon("x")}</button>` : ""}</li>`).join("")}</ul>` : ""}
      ${OV.table ? chartTable(d) : ""}`;
  }
  /* The chart as a table, in pages like every long table (table-pages.js): a year of days is 365 rows. */
  function chartTable(d) {
    const was = d.compare_series || [], key = "ov-chart-table";
    window.TP.on(key, () => UI.render({ keepScroll: true }));
    const view = window.TP.view(key, d.series.map((p, i) => [p, i]));
    return `<div class="table-wrap ov-chart-table"><table class="data"><thead><tr><th>${t(d.granularity === "week" ? "Week from" : d.granularity === "hour" ? "Hour" : "Date")}</th>${METRICS.map((m) => `<th class="c">${esc(t(m.name))}</th>`).join("")}${was.length ? `<th class="c">${t("Clicks before")}</th>` : ""}</tr></thead>
      <tbody>${view.rows.map(([p, i]) => `<tr><td data-label="${t("Date")}">${esc(dayLabel(p.day, true))}${p.fresh ? ` <span class="muted small">${t("not final")}</span>` : ""}</td>${METRICS.map((m) => `<td class="c" data-label="${esc(t(m.name))}">${esc(fmt[m.id](p[m.id]))}</td>`).join("")}${was.length ? `<td class="c" data-label="${t("Clicks before")}">${was[i] ? num(was[i].clicks) : "—"}</td>` : ""}</tr>`).join("")}</tbody></table></div>${window.TP.footer(key, view)}`;
  }
  function moveCross(box, index) {
    const info = window.OV.chart;
    if (!info) return;
    const i = Math.max(0, Math.min(info.pts.length - 1, index));
    box.dataset.at = i;
    const p = info.pts[i], w = info.was[i];
    const xs = info.pts.length === 1 ? W / 2 : (i / (info.pts.length - 1)) * W;
    const cross = box.querySelector(".lv-cross"), tip = box.querySelector(".lv-tip"), svg = box.querySelector("svg");
    cross.removeAttribute("hidden"); cross.setAttribute("x1", xs); cross.setAttribute("x2", xs);
    const rows = info.shown.map((m) => `<div><span><i class="lv-key" style="background:${m.color}"></i>${esc(t(m.name))}</span><span>${esc(fmt[m.id](p[m.id]))}${w ? ` <span class="muted">(${esc(fmt[m.id](w[m.id]))})</span>` : ""}</span></div>`).join("");
    const notes = info.marks.filter((m) => m.at === i).map((m) => `<div class="ov-tip-note">${esc(m.text)}</div>`).join("");
    UI.setHTML(tip, `<b>${esc(dayLabel(p.day, true))}${p.fresh ? ` · ${t("not final")}` : ""}</b>${rows}${w ? `<div class="muted ov-tip-was">${t("In brackets: the period before")} (${esc(dayLabel(w.day))})</div>` : ""}${notes}`);
    tip.hidden = false;
    const rect = svg.getBoundingClientRect(), left = (xs / W) * rect.width + 18, room = box.clientWidth - tip.offsetWidth - 8;
    tip.style.left = `${Math.max(8, Math.min(room, left + 12 > room ? left - tip.offsetWidth - 12 : left + 12))}px`;
  }

  // ---- the tabbed card ----------------------------------------------------------------------------
  const nameCell = (dim, r) => {
    if (dim === "page") return PageLink.html(r.name, { text: pathOf(r.name), cls: "ov-name" });
    if (dim === "country") return `<span class="ov-name">${esc(r.code ? UI.countryName(r.code) : t("Unknown"))}</span>`;
    if (dim === "device") return `<span class="ov-name">${esc(t({ MOBILE: "Mobile", DESKTOP: "Computer", TABLET: "Tablet" }[r.name] || r.name))}</span>`;
    return `<span class="ov-name" dir="auto">${esc(r.name)}</span>${r.tracked ? ` <span class="ov-tracked" title="${t("Tracked in Keywords")}">${icon("check")}${t("Tracked")}</span>` : ""}`;
  };
  const rowActions = (dim, r) => {
    if (dim !== "query" && dim !== "page") return "";
    const value = esc(r.name);
    return `<span class="ov-acts">${dim === "query" && !r.tracked ? `<button class="btn btn-small" data-ov-track="${value}">${icon("plus")}${t("Track")}</button>` : ""}<button class="btn btn-small btn-ghost" data-ov-task="${dim}" data-value="${value}">${icon("square-check")}${t("Task")}</button></span>`;
  };
  /* The rows on the page the table shows right now (after sort), and which of them can still be picked. */
  const pageOf = (list) => { const pages = Math.max(1, Math.ceil(list.length / OV.per)); OV.page = Math.max(0, Math.min(OV.page, pages - 1)); return { pages, from: OV.page * OV.per, rows: list.slice(OV.page * OV.per, (OV.page + 1) * OV.per) }; };
  const shownRows = () => pageOf(OV.rows?.list || []).rows;
  /* Page numbers to offer: the first, the last, and the ones around where you are, with a gap mark between far ones. */
  const pageNumbers = (pages, at) => {
    const keep = [...new Set([0, 1, at - 1, at, at + 1, pages - 2, pages - 1])].filter((p) => p >= 0 && p < pages).sort((a, b) => a - b);
    return pages <= 7 ? [...Array(pages).keys()] : keep.flatMap((p, i) => (i && p - keep[i - 1] > 1 ? [null, p] : [p]));
  };
  const pickable = (rows) => rows.filter((r) => !r.tracked).map((r) => r.name ?? r.key);
  /* What is picked and what to do with it. On a computer it rides in the heading, which stays in view down a long list, so it is
     always at hand and never pushes the rows down under the pointer. Where the heading can't stick, it floats at the foot instead. */
  const selBar = (where) => (OV.selected.size ? `<span class="ov-selbar ov-selbar-${where}" role="status"><span>${num(OV.selected.size)} ${t(OV.selected.size === 1 ? "query picked" : "queries picked")}</span><button class="btn btn-main btn-small" data-ov-track-picked>${icon("plus")}${t("Track them")}</button><button class="link-btn" data-ov-pick-clear>${t("Clear")}</button></span>` : "");
  function table(dim, rows, { columns, selectable = false, key = dim, total = rows.length }) {
    if (!rows.length) return `<div class="empty"><p>${t("Nothing to show for this choice.")}</p></div>`;
    let list = rows;
    if (OV.sort?.table === key) {
      const col = columns.find((c) => c.id === OV.sort.id);
      list = [...rows].sort((a, b) => { const x = col.get(a), y = col.get(b); if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1; return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * (OV.sort.dir === "asc" ? 1 : -1); });
    }
    OV.rows = { list, columns, dim };
    const view = pageOf(list);
    // One box in the heading picks every row on this page that isn't tracked yet, so tracking 50 at once is one click.
    const free = selectable ? pickable(view.rows) : [];
    const allOn = free.length > 0 && free.every((id) => OV.selected.has(id)), someOn = !allOn && free.some((id) => OV.selected.has(id));
    if (selectable) queueMicrotask(() => { const box = UI.$("[data-ov-pick-all]"); if (box) box.indeterminate = someOn; });
    const head = `${selectable ? `<th class="ov-pick-col"><input type="checkbox" data-ov-pick-all aria-label="${t("Pick all shown")}" title="${t("Pick all shown")}" ${allOn ? "checked" : ""} ${free.length ? "" : "disabled"}></th>` : ""}${columns.map((c) => {
      const on = OV.sort?.table === key && OV.sort.id === c.id;
      return `<th class="${c.num ? "ov-n" : ""}${on ? " ov-sorted" : ""}" scope="col" aria-sort="${on ? (OV.sort.dir === "asc" ? "ascending" : "descending") : "none"}"><button class="th-btn" data-ov-sort="${c.id}" data-table="${key}" ${UI.def(c.label) ? `data-tip="${esc(UI.def(c.label))}"` : ""}>${esc(t(c.label))}${on ? icon(OV.sort.dir === "asc" ? "arrow-up" : "arrow-down") : ""}</button>${selectable && c.id === "name" ? selBar("head") : ""}</th>`;
    }).join("")}`;
    const body = view.rows.map((r) => {
      const id = r.name ?? r.key;
      return `<tr class="ov-row" data-ov-open="${esc(dim)}" data-value="${esc(id)}" tabindex="0">${selectable ? `<td class="ov-pick-col"><input type="checkbox" data-ov-pick="${esc(id)}" aria-label="${t("Pick")} ${esc(id)}" ${OV.selected.has(id) ? "checked" : ""} ${r.tracked ? "disabled" : ""}></td>` : ""}${columns.map((c) => `<td class="${c.num ? "ov-n" : ""}${OV.sort?.table === key && OV.sort.id === c.id ? " ov-sorted" : ""}" data-label="${esc(t(c.label))}">${c.html(r)}</td>`).join("")}</tr>`;
    }).join("");
    // Footer: which rows these are, the pages, how many rows a page holds, and the download (always the whole list, not the page).
    const at = OV.page, last = view.pages - 1;
    const pager = view.pages > 1 ? `<nav class="ov-pager" aria-label="${t("Pages")}">
        <button class="btn btn-small" data-ov-page="${at - 1}" data-ov-step="prev" ${at === 0 ? "disabled" : ""}>${icon("chevron-left")}${t("Previous")}</button>
        <span class="ov-pg-list">${pageNumbers(view.pages, at).map((p) => (p === null ? `<span class="ov-pg-gap" aria-hidden="true">…</span>` : `<button class="ov-pg" data-ov-page="${p}" aria-label="${t("Page")} ${num(p + 1)}" ${p === at ? `aria-current="page"` : ""}>${num(p + 1)}</button>`)).join("")}</span>
        <span class="ov-pg-of">${t("Page")} ${num(at + 1)} ${t("of")} ${num(view.pages)}</span>
        <button class="btn btn-small" data-ov-page="${at + 1}" data-ov-step="next" ${at === last ? "disabled" : ""}>${t("Next")}${icon("chevron-right")}</button></nav>` : "";
    const perPick = list.length > PER[0] ? `<label class="ov-per"><span class="sr">${t("Rows per page")}</span><select class="select" data-ov-per>${PER.map((n) => `<option value="${n}" ${OV.per === n ? "selected" : ""}>${num(n)} ${t("per page")}</option>`).join("")}</select></label>` : "";
    // One box around the table and its footer: the footer sticks to the bottom of the screen only while the table itself is in view.
    return `<div class="ov-list"><div class="table-wrap ov-table"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${selectable ? selBar("foot") : ""}
      <div class="lv-foot ov-foot"><span class="ov-range">${num(view.from + 1)}–${num(view.from + view.rows.length)} ${t("of")} ${num(total)}</span>${pager}${perPick}${total > list.length ? `<span class="ov-capped">${t("Only the first %n can be shown. Filter to see the rest.").replace("%n", num(list.length))}</span>` : ""}</div></div>`;
  }
  const columnsFor = (dim, compare) => [
    { id: "name", label: { query: "Query", page: "Page", country: "Country", device: "Device" }[dim], get: (r) => r.name, html: (r) => `<div class="ov-cell">${nameCell(dim, r)}${rowActions(dim, r)}</div>` },
    { id: "clicks", label: "Clicks", num: true, get: (r) => r.clicks, html: (r) => numCell(num(r.clicks), compare ? cellChange(r.clicks, r.clicks_before) : null) },
    { id: "impressions", label: "Impressions", num: true, get: (r) => r.impressions, html: (r) => numCell(num(r.impressions), compare ? cellChange(r.impressions, r.impressions_before) : null) },
    { id: "position", label: "Position", num: true, get: (r) => r.position, html: (r) => numCell(posBadge(r.position), compare ? cellChange(r.position, r.position_before, true) : null) },
  ];

  function tabsCard(d) {
    const tabs = `<div class="tabs" role="tablist" aria-label="${t("Split by")}">${TABS.map(([id, name]) => `<button class="tab" role="tab" data-ov-tab="${id}" aria-selected="${OV.tab === id}">${t(name)}</button>`).join("")}</div>`;
    return `<section class="card ov-tabs-card"><div class="card-head ov-tabs-head">${tabs}</div>${OV.tab === "opportunities" ? opportunitiesBody(d) : breakdownBody(d)}</section>`;
  }
  function breakdownBody(d) {
    const compare = d.compare !== "none";
    if (!compare && !["all", "top3", "4-10", "11-20", "21+"].includes(OV.show)) OV.show = "all";
    const entry = load("breakdown", { dim: OV.tab, show: OV.show, brand: OV.tab === "query" ? OV.brand : "all", ...filterArgs(OV.tab), ...(freshWanted() ? { include_fresh: 1 } : {}) });
    const counts = entry.data?.counts || {};
    const choices = SHOWS.filter(([id]) => (compare || !["gaining", "losing", "new", "lost"].includes(id)) && (OV.tab === "query" || OV.tab === "page" || ["all", "gaining", "losing"].includes(id)));
    const controls = `<div class="ov-controls">
      <label class="ov-show"><span>${t("Show")}</span><select class="select" data-ov-show>${choices.map(([id, name]) => `<option value="${id}" ${OV.show === id ? "selected" : ""}>${t(name)}${counts[id] !== undefined ? ` (${num(counts[id])})` : ""}</option>`).join("")}</select></label>
      ${OV.tab === "query" ? brandToggle(d) : ""}
      ${filterBar(OV.tab)}
    </div>`;
    if (entry.loading) return `${controls}${UI.skeleton("rows", { rows: 8 })}`;
    if (entry.error) return `${controls}<div class="empty"><p>${esc(t(entry.error))}</p>${filterOn(filterOf(OV.tab)) ? `<div class="ov-empty-act"><button class="btn" data-ov-filter-clear>${t("Clear filters")}</button></div>` : ""}</div>`;
    const b = entry.data;
    const fresh = b.fresh_included?.from ? `<p class="small muted ov-hint ov-fresh-note" role="note">${icon("clock")}${t("Includes days not final yet")} (${esc(b.fresh_included.from === b.fresh_included.to ? dayLabel(b.fresh_included.from) : `${dayLabel(b.fresh_included.from)} – ${dayLabel(b.fresh_included.to)}`)})</p>` : "";
    const note = (b.small_hidden ? `<p class="small muted ov-hint">${num(b.small_hidden)} ${t("small ones hidden (under 3 clicks and 50 impressions).")}</p>` : "") + fresh;
    const queriesLine = OV.tab === "query" && d.queries !== null ? `<p class="small muted ov-hint">${num(d.queries)} ${t("queries with impressions")}${d.queries_before !== null && d.queries_before !== undefined ? ` · ${num(d.queries_before)} ${t("before")}` : ""}. ${t("Google leaves out rare searches, so queries never add up to the total clicks.")}</p>` : "";
    if (!b.rows.length && filterOn(filterOf(OV.tab))) return `${controls}<div class="empty"><p>${t(OV.tab === "page" ? "No pages match these filters." : "No queries match these filters.")}</p><div class="ov-empty-act"><button class="btn" data-ov-filter-clear>${t("Clear filters")}</button></div></div>`;
    return `${controls}${queriesLine}${note}${table(OV.tab, b.rows, { columns: columnsFor(OV.tab, compare), selectable: OV.tab === "query", total: b.total ?? b.rows.length })}`;
  }
  /* One box for the text, like Search Console's own filter, and the number filters behind one button. */
  function filterBar(dim) {
    const f = filterOf(dim);
    if (!f) return "";
    const extra = numbersOn(f), open = OV.moreFilters || extra > 0;
    const modes = TEXT_MODES.map(([id, name]) => `<option value="${id}" ${f.q_mode === id ? "selected" : ""}>${t(name)}</option>`).join("");
    const holder = t(dim === "page" ? "Filter pages" : "Filter queries");
    const numbers = open ? `<div class="ov-filter-more" role="group" aria-label="${t("More filters")}">${NUMBER_FILTERS.map(([id, name]) => `<label class="ov-filter-num"><span>${t(name)}</span><input class="input" type="number" inputmode="decimal" min="0" step="any" data-ov-f="${id}" value="${esc(f[id])}"></label>`).join("")}</div>` : "";
    return `<form class="ov-filter" id="ov-filter-form" role="search" aria-label="${esc(holder)}">
        <span class="ov-filter-box"><label class="sr" for="ov-f-mode">${t("How the text matches")}</label><select class="select" id="ov-f-mode" data-ov-f="q_mode">${modes}</select>
        <span class="ov-filter-text">${icon("search")}<label class="sr" for="ov-f-q">${esc(holder)}</label><input class="input" id="ov-f-q" type="search" data-ov-f="q" value="${esc(f.q)}" placeholder="${esc(holder)}" autocomplete="off" spellcheck="false" dir="auto"></span></span>
        <button type="button" class="btn btn-small ${extra ? "is-on" : ""}" data-ov-more-filters aria-expanded="${open}">${icon("filter")}${t("More filters")}${extra ? ` <b class="ov-filter-count">${num(extra)}</b>` : ""}</button>
        ${filterOn(f) ? `<button type="button" class="link-btn" data-ov-filter-clear>${t("Clear filters")}</button>` : ""}
        ${numbers}
      </form>`;
  }
  let typing = null;
  function setFilter(id, value, { wait = 0 } = {}) {
    const f = filterOf(OV.tab);
    if (!f || f[id] === value) return;
    f[id] = value;
    OV.page = 0;
    OV.selected.clear();
    clearTimeout(typing);
    // The match choice alone changes nothing while the box is empty.
    if (id === "q_mode" && !f.q.trim()) return;
    typing = setTimeout(draw, wait);
  }
  /* A new search from the bell is often only in days Google hasn't made final yet. For that one exact search, the table may
     include those days (include_fresh=1, honoured by the server only with an exact filter); totals and sentences never do. */
  const freshWanted = () => {
    const w = OV.includeFresh, f = w ? OV.filters[w.dim] : null;
    return Boolean(w && OV.tab === w.dim && f && f.q_mode === "exact" && f.q.trim() && f.q.trim() === w.q);
  };
  /* The bell opens one new search here: its site, Queries, that exact search, over a period that holds its day. */
  OV.openQuery = ({ host, query: text, day }) => {
    if (host) UI.pickSite(host);
    OV.tab = "query"; OV.show = "all"; OV.brand = "all"; OV.page = 0; OV.sort = null; OV.moreFilters = false;
    OV.selected.clear();
    OV.filters.query = { ...blankFilter(), q: text || "", q_mode: "exact" };
    OV.includeFresh = (text || "").trim() ? { dim: "query", q: text.trim() } : null; // only while this exact search stays in the box
    // A period that holds the query's day: the shared range grows if it has to, and stays as it is otherwise.
    const back = day ? Math.ceil((Date.now() - new Date(`${day}T00:00:00`).getTime()) / 86400000) + 2 : 0;
    const SPANS = [["7d", 7], ["28d", 28], ["3m", 90], ["6m", 180], ["12m", 365], ["16m", 486]];
    const r = UI.range.get(), preset = r.preset;
    const now = preset === "custom" ? (r.to >= (day || "") ? r.days + 3 : 0) : preset === "24h" ? 1 : preset === "tm" || preset === "lm" ? 0 : SPANS.find(([id]) => id === preset)?.[1] || 0;
    if (now < back || preset === "24h") UI.range.set({ preset: (SPANS.find(([, n]) => n >= back) || SPANS[SPANS.length - 1])[0] });
    OV.toTable = true;
    UI.go("overview");
    setTimeout(scrollToTable, 0);
  };
  /* Today's "See page" opens that page here: its site, the Pages tab, that exact address. The address keeps it. */
  OV.openPage = ({ host, page }) => {
    if (host) UI.pickSite(host);
    OV.tab = "page"; OV.show = "all"; OV.page = 0; OV.sort = null; OV.moreFilters = false;
    OV.filters.page = { ...blankFilter(), q: page || "", q_mode: "exact" };
    OV.includeFresh = (page || "").trim() ? { dim: "page", q: page.trim() } : null;
    OV.toTable = true;
    UI.go("overview");
    setTimeout(scrollToTable, 0);
  };
  function brandToggle(d) {
    if (!d.has_brand) return `<button class="link-btn ov-brand-link" data-ov-brand-edit>${t("Add your brand words")}</button>`;
    return `<span class="seg" role="group" aria-label="${t("Brand searches")}">${[["all", "All"], ["non_brand", "Non-brand"], ["brand", "Brand"]].map(([id, name]) => `<button data-ov-brand="${id}" aria-pressed="${OV.brand === id}">${t(name)}</button>`).join("")}</span><button class="link-btn" data-ov-brand-edit>${t("Brand words")}</button>`;
  }
  function opportunitiesBody(d) {
    const [, , why] = OPPS.find(([id]) => id === OV.opp);
    const entry = load("opportunities", { kind: OV.opp });
    const controls = `<div class="ov-controls"><label class="ov-show"><span>${t("Show")}</span><select class="select" data-ov-opp>${OPPS.map(([id, name]) => `<option value="${id}" ${OV.opp === id ? "selected" : ""}>${t(name)}</option>`).join("")}</select></label></div><p class="small muted ov-hint">${t(why)}</p>`;
    if (entry.loading) return `${controls}${UI.skeleton("rows", { rows: 8 })}`;
    if (entry.error) return `${controls}<div class="empty"><p>${esc(entry.error)}</p></div>`;
    const o = entry.data;
    if (o.needs === "brand_words") return `${controls}<div class="empty"><p>${t("Add your brand words to see this. Brand searches are clicked far more, so they'd make every other query look weak.")}</p><div class="ov-empty-act"><button class="btn btn-main" data-ov-brand-edit>${t("Add your brand words")}</button></div></div>`;
    if (o.needs === "more_data") return `${controls}<div class="empty"><p>${t("Not enough queries yet to know this site's usual click rate at each position.")}</p></div>`;
    const name = { id: "name", label: "Query", get: (r) => r.name, html: (r) => `<div class="ov-cell">${nameCell("query", r)}${rowActions("query", r)}</div>` };
    const cols = {
      almost: [name, { id: "position", label: "Position", num: true, get: (r) => r.position, html: (r) => dec1(r.position) }, { id: "impressions", label: "Impressions", num: true, get: (r) => r.impressions, html: (r) => num(r.impressions) }, { id: "clicks", label: "Clicks", num: true, get: (r) => r.clicks, html: (r) => num(r.clicks) }],
      low_ctr: [name, { id: "click_rate", label: "Click rate", num: true, get: (r) => r.click_rate, html: (r) => rate(r.click_rate) }, { id: "expected_rate", label: "Usual at this position", num: true, get: (r) => r.expected_rate, html: (r) => rate(r.expected_rate) }, { id: "position", label: "Position", num: true, get: (r) => r.position, html: (r) => dec1(r.position) }],
      compete: [name, { id: "impressions", label: "Impressions", num: true, get: (r) => r.impressions, html: (r) => num(r.impressions) }, { id: "pages", label: "Pages that share it", get: (r) => r.pages.length, html: (r) => `<ul class="ov-pages">${r.pages.map((p) => `<li>${PageLink.html(p.page, { text: pathOf(p.page) })} <span class="muted">${num(p.share)}% · ${t("pos.")} ${dec1(p.position)}</span></li>`).join("")}</ul>` }],
      lost: [name, { id: "clicks_before", label: "Clicks before", num: true, get: (r) => r.clicks_before, html: (r) => num(r.clicks_before) }, { id: "impressions_before", label: "Impressions before", num: true, get: (r) => r.impressions_before, html: (r) => num(r.impressions_before) }, { id: "position_before", label: "Position before", num: true, get: (r) => r.position_before, html: (r) => dec1(r.position_before) }],
    }[OV.opp];
    return `${controls}${table("query", o.rows, { columns: cols, key: `opp-${OV.opp}` })}`;
  }

  // ---- side panel: one query or one page ------------------------------------------------------------
  async function openDetail(dim, value, opener) {
    if (dim !== "query" && dim !== "page") return;
    const head = UI.panelHead(dim === "query" ? value : pathOf(value), dim === "query" ? t("Query") : `${t("Page")} · ${PageLink.html(value, { text: t("Open page"), title: value, cls: "page-open" })}`);
    UI.openPanel(`${head}<div class="panel-body">${UI.skeleton("panel")}</div>`, opener);
    let data;
    try { data = await window.COMP.api("GET", `search/detail?${query({ [dim]: value })}`); }
    catch (err) { if (UI.$("#panel")) UI.setHTML(UI.$("#panel .panel-body"), `<p class="error">${esc(err.message)}</p>`); return; }
    if (!UI.$("#panel")) return;
    const tot = data.totals;
    const spark = (id, invert) => { const v = data.series.map((p) => p[id]).filter((x) => x !== null); return v.length > 1 ? UI.spark(v, { w: 260, h: 48, invert }) : ""; };
    const split = data.split.length ? `<h3 class="ov-h3">${t(dim === "query" ? "Pages that show for it" : "Queries that bring it")}</h3>
      ${dim === "query" ? `<p class="small muted">${t("Shares of impressions. Search Console counts each page apart, so these don't add up to the query.")}</p>` : ""}
      <ul class="rows ov-split">${data.split.slice(0, 15).map((p) => `<li><div class="what"><div class="t" dir="auto">${dim === "query" ? PageLink.html(p.name, { text: pathOf(p.name) }) : esc(p.name)}</div><div class="s muted">${num(p.clicks)} ${t("clicks")} · ${num(p.impressions)} ${t("impressions")} · ${t("pos.")} ${dec1(p.position)}</div></div>${dim === "query" && p.share !== null ? `<span class="ov-share">${num(p.share)}%</span>` : ""}</li>`).join("")}</ul>` : "";
    const places = data.countries ? `<h3 class="ov-h3">${t("Countries")}</h3><ul class="rows ov-split">${data.countries.slice(0, 8).map((c) => `<li><div class="what"><div class="t">${esc(c.code ? UI.countryName(c.code) : t("Unknown"))}</div><div class="s muted">${num(c.impressions)} ${t("impressions")} · ${t("pos.")} ${dec1(c.position)}</div></div><span>${num(c.clicks)}</span></li>`).join("")}</ul>`
      : data.countries_error ? `<p class="small muted">${t("Countries come from Google live, and it didn't answer.")}</p>` : "";
    const tracked = dim === "query" && data.tracked;
    UI.openPanel(`${head}<div class="panel-body">
        <div class="ov-panel-nums">
          <div><span class="lab">${t("Clicks")}</span><b>${tot ? num(tot.clicks) : "—"}</b></div>
          <div><span class="lab">${t("Impressions")}</span><b>${tot ? num(tot.impressions) : "—"}</b></div>
          <div><span class="lab">${t("Click rate")}</span><b>${tot ? rate(tot.click_rate) : "—"}</b></div>
          <div><span class="lab">${t("Position")}</span><b>${tot ? dec1(tot.position) : "—"}</b></div>
        </div>
        ${spark("clicks") ? `<div class="ov-panel-spark"><span class="lab">${t("Clicks, day by day")}</span>${spark("clicks")}</div>` : ""}
        ${spark("position") ? `<div class="ov-panel-spark"><span class="lab">${t("Position, day by day (higher is better)")}</span>${spark("position", true)}</div>` : ""}
        ${split}${places}
      </div>
      <div class="panel-foot">${dim === "query" ? (tracked ? `<span class="ov-tracked">${icon("check")}${t("Tracked in Keywords")}</span>` : `<button class="btn btn-main" data-ov-track="${esc(value)}">${icon("plus")}${t("Track as a keyword")}</button>`) : ""}
        <button class="btn" data-ov-task="${dim}" data-value="${esc(value)}">${icon("square-check")}${t("Create a task")}</button></div>`, opener);
  }

  // ---- brand words, notes, the check -----------------------------------------------------------------
  async function brandPanel(opener) {
    const site = UI.siteIdPicked();
    let words = [];
    try { words = await window.COMP.api("GET", `search/brand?${site ? `site_id=${site}` : ""}`); } catch { words = []; }
    UI.openPanel(`${UI.panelHead(t("Brand words"), t("Searches that contain one of these count as brand searches. Case and accents don't matter."))}
      <div class="panel-body">
        ${words.length ? `<ul class="rows">${words.map((w) => `<li><div class="what"><div class="t" dir="auto">${esc(w.pattern)}</div><div class="s muted">${esc(w.site_id ? (window.SITES.find((s) => s.realId === w.site_id)?.host || "") : t("All my sites"))}</div></div><button class="btn btn-small btn-ghost" data-ov-brand-del="${w.id}">${t("Remove")}</button></li>`).join("")}</ul>` : `<p class="muted">${t("No brand words yet.")}</p>`}
        <form class="ov-brand-form" id="ov-brand-form"><label class="field"><span>${t("Add a brand word")}</span><input class="input" name="f_word" dir="auto" autocomplete="off" placeholder="${esc(t("Such as your company or site name"))}" data-autofocus></label>
        <div class="error" id="ov-brand-error" role="alert" hidden></div><button class="btn btn-main" type="submit">${t("Add")}</button></form>
      </div>`, opener);
  }
  function notePanel(opener, d) {
    UI.openPanel(`${UI.panelHead(t("Add a note to the chart"), t("Mark a change you made, such as new titles, so you can see what followed."))}
      <form class="panel-body" id="ov-note-form" novalidate>
        <label class="field"><span>${t("Day")}</span><input class="input" type="date" name="f_day" value="${esc(d.to)}" min="${esc(d.from)}" max="${esc(d.newest || d.to)}" required></label>
        <label class="field"><span>${t("Note")}</span><input class="input" name="f_text" maxlength="300" dir="auto" autocomplete="off" data-autofocus></label>
        <div class="error" id="ov-note-error" role="alert" hidden></div>
      </form>
      <div class="panel-foot"><button class="btn btn-main" data-ov-note-save>${t("Save the note")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener, { key: "ov-note", reopen: () => notePanel(opener, d) });
  }
  function verifyPanel(opener, v) {
    const list = (title, rows, label) => (rows?.length ? `<h3 class="ov-h3">${t(title)}</h3><div class="table-wrap"><table class="data"><thead><tr><th>${t(label)}</th><th class="c">Search Console</th><th class="c">${t("Saved here")}</th></tr></thead><tbody>${rows.map((r) => `<tr><td dir="auto">${esc(r.day ? dayLabel(r.day, true) : r.name)}</td><td class="c">${num(r.google.clicks)} / ${num(r.google.impressions)}</td><td class="c">${num(r.saved.clicks)} / ${num(r.saved.impressions)}</td></tr>`).join("")}</tbody></table></div>` : "");
    UI.openPanel(`${UI.panelHead(t("Differs from Search Console"), `${t("Last 28 days, checked")} ${esc(since(v.checked_at))}. ${t("Clicks / impressions.")}`)}
      <div class="panel-body">
        <p>${t(v.fixable ? "Some days changed at Google after they were saved. Reading them again fixes it." : "Every day matches. Google adds up some tables over a range differently from its days, which a new pull can't change.")}</p>
        ${list("Days", v.days, "Date")}${list("Queries", v.queries, "Query")}${list("Pages", v.pages, "Page")}
      </div>
      <div class="panel-foot">${v.fixable ? `<button class="btn btn-main" data-ov-verify-fix>${t("Read those days again")}</button>` : ""}<button class="btn" data-close-panel>${t("Close")}</button></div>`, opener);
  }

  // ---- the page -------------------------------------------------------------------------------------
  const STATES = { no_sites: 1, not_connected: 1, not_used: 1, failing: 1, waiting: 1 };
  /* The dates come from the shared picker in the top bar. Here, the days the server really used, and both periods in words. */
  function periodLine(d) {
    if (!d || !d.from) return "";
    if (d.final_through || d.to) UI.range.end("overview", d.final_through || d.to);
    const now = d.hourly ? t("Last 24 hours") : `${dayLabel(d.from)} – ${dayLabel(d.to, true)}`;
    const before = d.compare_from && d.compare_to ? ` ${t("vs")} ${dayLabel(d.compare_from)} – ${dayLabel(d.compare_to, true)}` : "";
    const none = d.compare_unavailable === "history" ? ` · ${t("No comparison: Search Console doesn't keep that far back.")}` : "";
    return `<p class="ov-span small muted" role="status">${esc(now + before)}${esc(none)}</p>`;
  }
  function overviewPage() {
    const entry = load("overview");
    const d = entry.data;
    const refresh = `<button class="btn" data-ov-refresh ${OV.poll ? "disabled" : ""}>${icon("refresh-cw")}${t(OV.poll ? "Reading…" : "Refresh data")}</button>`;
    const head = UI.topbar(t("Overview"), t("How the site does on Google, from Search Console"), `${d && !STATES[d.state] ? refresh : ""}`);
    const wrap = (body) => `${head}<div class="content page-enter ov">${periodLine(d)}${body}</div>`;
    if (entry.loading) return wrap(UI.skeleton("page"));
    if (entry.noServer) return wrap(`<section class="card"><div class="empty"><h3>${t("Needs the running app")}</h3><p>${t("Opened as a plain file there's no real data to show here.")}</p></div></section>`);
    if (entry.error) return wrap(UI.failCard(entry.error, { retry: "data-ov-retry" }));
    if (STATES[d.state] && !d.totals) return wrap(window.LV?.stateCard ? window.LV.stateCard({ data: d }, "gsc") : `<section class="card"><div class="empty"><p>${esc(d.state)}</p></div></section>`);
    if (!d.totals) return wrap(`${trust(d)}<section class="card"><div class="empty"><h3>${t("No data in this period.")}</h3><p>${t("Pick a longer or earlier period.")}</p></div></section>`);
    const chartHead = `<div class="card-head"><h2>${t({ hour: "Hour by hour", week: "Week by week", day: "Day by day" }[d.granularity])}</h2>
      <span class="end ov-chart-tools">${d.single_site ? `<button class="link-btn" data-ov-note-add>${icon("plus")}${t("Add a note")}</button>` : ""}<button class="link-btn" data-ov-table aria-expanded="${OV.table}">${t(OV.table ? "Hide the table" : "Show as a table")}</button></span></div>`;
    return wrap(`${trust(d)}
      ${d.answer ? `<p class="ov-answer" dir="auto">${sentence(d.answer, d)}</p>` : ""}
      ${cards(d)}
      <section class="card ov-chart-card">${chartHead}${chart(d)}</section>
      ${d.hourly ? `<p class="small muted ov-hint">${t("Tables below use whole days, so they show the last 2 days.")}</p>` : ""}
      ${tabsCard(d)}`);
  }

  // ---- after Refresh: wait for the pull, gently ------------------------------------------------------
  function startPolling(before) {
    clearInterval(OV.poll);
    const started = Date.now();
    OV.poll = setInterval(async () => {
      if (document.hidden || UI.state.route !== "overview") return;
      if (Date.now() - started > 120000) { stopPolling(); return; }
      try {
        const now = await window.COMP.api("GET", `search/overview?${query()}`);
        if (now.last_pull && now.last_pull !== before) { stopPolling(); UI.toast(t("Search Console data is up to date.")); }
      } catch { stopPolling(); }
    }, 5000);
    UI.render({ keepScroll: true });
  }
  function stopPolling() { clearInterval(OV.poll); OV.poll = null; forget(); redraw(); }

  // ---- events ---------------------------------------------------------------------------------------
  const current = () => OV.cache.get(`search/overview?${query()}`)?.data;
  const hostPicked = () => UI.siteHostPicked() || window.SITES.find((s) => s.realId)?.host || null;
  function track(queries, opener) {
    const d = current();
    if (!window.KW) { UI.toast(t("Open Keywords to add it."), { kind: "info" }); return; }
    window.KW.track(queries, hostPicked(), opener, d?.market || {});
  }
  function bind() {
    document.addEventListener("click", async (e) => {
      if (UI.state.route !== "overview" && !e.target.closest?.("#panel")) return;
      const hit = (sel) => e.target.closest?.(sel);
      let el;
      if ((el = hit("[data-ov-line]"))) { const id = el.dataset.ovLine; if (OV.lines.has(id)) OV.lines.delete(id); else OV.lines.add(id); UI.render({ keepScroll: true }); return; }
      if ((el = hit("[data-ov-fix-google]"))) { UI.openConnection?.("google", el); return; }
      if ((el = hit("[data-ov-tab]"))) { OV.tab = el.dataset.ovTab; OV.show = "all"; OV.moreFilters = false; OV.page = 0; OV.sort = null; UI.render({ keepScroll: true }); UI.$(`[data-ov-tab="${OV.tab}"]`)?.focus({ preventScroll: true }); return; }
      if ((el = hit("[data-ov-brand]"))) { OV.brand = el.dataset.ovBrand; OV.page = 0; UI.render({ keepScroll: true }); return; }
      if (hit("[data-ov-brand-edit]")) { brandPanel(hit("[data-ov-brand-edit]")); return; }
      if ((el = hit("[data-ov-brand-del]"))) {
        try { await window.COMP.api("DELETE", `rules/${el.dataset.ovBrandDel}`); forget(); await brandPanel(); redraw(); UI.toast(t("Brand word removed")); } catch (err) { UI.toast(err.message, { kind: "crit" }); }
        return;
      }
      if (hit("[data-ov-table]")) { OV.table = !OV.table; UI.render({ keepScroll: true }); UI.$("[data-ov-table]")?.focus({ preventScroll: true }); return; }
      if (hit("[data-ov-more-filters]")) {
        const f = filterOf(OV.tab), open = OV.moreFilters || numbersOn(f) > 0;
        if (open && numbersOn(f)) { UI.$('[data-ov-f="min_clicks"]')?.focus(); return; } // filters in use stay in sight
        OV.moreFilters = !open; UI.render({ keepScroll: true });
        (OV.moreFilters ? UI.$('[data-ov-f="min_clicks"]') : UI.$("[data-ov-more-filters]"))?.focus({ preventScroll: true });
        return;
      }
      if (hit("[data-ov-filter-clear]")) {
        OV.filters[OV.tab] = blankFilter(); OV.moreFilters = false; OV.page = 0; OV.selected.clear();
        UI.render({ keepScroll: true }); UI.$("#ov-f-q")?.focus({ preventScroll: true });
        return;
      }
      // Another page: the table's top comes back into view. With the keyboard (a click with no pointer, detail 0) focus goes to the
      // first row; with a mouse it stays on the button pressed, so Next can be pressed again without hunting for it.
      // Right after a page change the rows under the pointer are new ones: a second click from a hurried double click must not land on them.
      if (Date.now() - (OV.paged || 0) < 400 && hit(".ov-table tbody")) { e.preventDefault(); return; }
      if ((el = hit("[data-ov-page]"))) {
        if (el.disabled) return;
        const step = el.dataset.ovStep;
        OV.page = Number(el.dataset.ovPage);
        OV.paged = Date.now();
        UI.render({ keepScroll: true });
        UI.$(".ov-tabs-card .ov-table")?.scrollIntoView({ block: "start", behavior: "instant" });
        if (e.detail === 0) UI.$(".ov-tabs-card .ov-row")?.focus({ preventScroll: true });
        else (UI.$(step ? `[data-ov-step="${step}"]:not([disabled])` : `.ov-pg[aria-current="page"]`) || UI.$(`.ov-pg[aria-current="page"]`))?.focus({ preventScroll: true });
        return;
      }
      if ((el = hit("[data-ov-pick-all]"))) {
        e.stopPropagation();
        const ids = pickable(shownRows());
        ids.forEach((id) => (el.checked ? OV.selected.add(id) : OV.selected.delete(id)));
        UI.render({ keepScroll: true }); UI.$("[data-ov-pick-all]")?.focus({ preventScroll: true });
        return;
      }
      if ((el = hit("[data-ov-sort]"))) { const same = OV.sort?.table === el.dataset.table && OV.sort.id === el.dataset.ovSort; OV.sort = { table: el.dataset.table, id: el.dataset.ovSort, dir: same && OV.sort.dir === "desc" ? "asc" : "desc" }; OV.page = 0; UI.render({ keepScroll: true }); UI.$(`[data-ov-sort="${OV.sort.id}"][data-table="${OV.sort.table}"]`)?.focus({ preventScroll: true }); return; }
      if (hit("[data-ov-retry]")) { forget(); UI.render(); return; }
      if ((el = hit("[data-ov-track]"))) { e.stopPropagation(); track(el.dataset.ovTrack, el); return; }
      if (hit("[data-ov-track-picked]")) { track([...OV.selected], hit("[data-ov-track-picked]")); return; }
      if (hit("[data-ov-pick-clear]")) { OV.selected.clear(); UI.render({ keepScroll: true }); UI.$("[data-ov-pick-all]")?.focus({ preventScroll: true }); return; }
      if ((el = hit("[data-ov-pick]"))) {
        e.stopPropagation();
        const id = el.dataset.ovPick;
        if (el.checked) OV.selected.add(id); else OV.selected.delete(id);
        UI.render({ keepScroll: true });
        [...document.querySelectorAll("[data-ov-pick]")].find((box) => box.dataset.ovPick === id)?.focus({ preventScroll: true });
        return;
      }
      if ((el = hit("[data-ov-task]"))) {
        e.stopPropagation();
        const dim = el.dataset.ovTask, value = el.dataset.value;
        UI.openTask?.({ title: `${t(dim === "query" ? "Query" : "Page")}: ${dim === "query" ? value : pathOf(value)}`, host: hostPicked(), opener: el, keywords: dim === "query" ? [value] : [], pages: dim === "page" ? [value] : [], source: { type: dim === "query" ? "keyword" : "page", label: t("Search Console"), facts: [value], link: "#overview" } });
        return;
      }
      if ((el = hit("[data-ov-open]"))) { if (hit("button, input, a")) return; openDetail(el.dataset.ovOpen, el.dataset.value, el); return; }
      if (hit("[data-ov-note-add]")) { notePanel(hit("[data-ov-note-add]"), current()); return; }
      if (hit("[data-ov-note-save]")) { saveNote(); return; }
      if ((el = hit("[data-ov-note-del]"))) {
        try { await window.COMP.api("DELETE", `search/notes/${el.dataset.ovNoteDel}`); forget(); UI.render({ keepScroll: true }); UI.toast(t("Note deleted")); } catch (err) { UI.toast(err.message, { kind: "crit" }); }
        return;
      }
      if (hit("[data-ov-verify-open]")) { const v = current()?.verify; if (v) verifyPanel(hit("[data-ov-verify-open]"), v); return; }
      if ((el = hit("[data-ov-verify-run]"))) {
        el.disabled = true;
        try { const v = await window.COMP.api("POST", "search/verify", { site_id: UI.siteIdPicked() }); forget(); UI.render({ keepScroll: true }); UI.toast(t(v.ok ? "It matches Search Console." : "It differs from Search Console. Press the warning to see where."), { kind: v.ok ? "good" : "info" }); }
        catch (err) { UI.toast(err.message, { kind: "crit" }); el.disabled = false; }
        return;
      }
      if (hit("[data-ov-verify-fix]")) {
        try { await window.COMP.api("POST", "search/verify", { site_id: UI.siteIdPicked(), fix: true }); UI.closePanel(); UI.toast(t("Reading those days again. It updates here when done.")); startPolling(current()?.last_pull); } catch (err) { UI.toast(err.message, { kind: "crit" }); }
        return;
      }
      if ((el = hit("[data-ov-refresh]"))) {
        const site = UI.siteIdPicked(), ids = site ? [site] : window.SITES.map((s) => s.realId).filter(Boolean);
        const before = current()?.last_pull;
        el.disabled = true;
        try {
          const answers = await Promise.all(ids.map((id) => window.COMP.api("POST", `sites/${id}/collect`, {})));
          if (answers.some((a) => a.pages) && window.LV?.PAGES_NOTE) UI.toast(t(window.LV.PAGES_NOTE), { kind: "info" }); // my pages are read too (2026-11-10)
          OV.fresh = true; forget();
          startPolling(before);
        } catch (err) { UI.toast(err.message, { kind: "crit" }); el.disabled = false; }
      }
    });
    document.addEventListener("change", (e) => {
      if (UI.state.route !== "overview") return;
      const el = e.target;
      if (el.matches?.("[data-ov-f]")) { setFilter(el.dataset.ovF, el.value); return; }
      if (el.matches?.("[data-ov-per]")) { OV.per = Number(el.value); OV.page = 0; UI.render({ keepScroll: true }); UI.$(".ov-tabs-card .ov-table")?.scrollIntoView({ block: "start", behavior: "instant" }); UI.$("[data-ov-per]")?.focus({ preventScroll: true }); return; }
      if (el.matches?.("[data-ov-show]")) { OV.show = el.value; OV.page = 0; UI.render({ keepScroll: true }); UI.$("[data-ov-show]")?.focus({ preventScroll: true }); return; }
      if (el.matches?.("[data-ov-opp]")) { OV.opp = el.value; OV.page = 0; OV.sort = null; UI.render({ keepScroll: true }); UI.$("[data-ov-opp]")?.focus({ preventScroll: true }); }
    });
    // Text applies as you type; numbers when you leave the box or press Enter, so "1" doesn't redraw before "10".
    document.addEventListener("input", (e) => {
      if (UI.state.route !== "overview" || !e.target.matches?.('[data-ov-f="q"]')) return;
      setFilter("q", e.target.value, { wait: 350 });
    });
    document.addEventListener("submit", async (e) => {
      if (e.target.id === "ov-filter-form") {
        e.preventDefault();
        const el = document.activeElement;
        if (el?.dataset?.ovF) { const f = filterOf(OV.tab); if (f) { f[el.dataset.ovF] = el.value; OV.page = 0; clearTimeout(typing); draw(); } }
        return;
      }
      if (e.target.id === "ov-note-form") { e.preventDefault(); saveNote(); return; }
      if (e.target.id !== "ov-brand-form") return;
      e.preventDefault();
      const box = UI.$("#ov-brand-error");
      box.hidden = true;
      try {
        await window.COMP.api("POST", "search/brand", { word: e.target.elements.f_word.value, site_id: UI.siteIdPicked() || null });
        forget(); UI.toast(t("Brand word added")); await brandPanel(); redraw();
      } catch (err) { box.textContent = t(err.message); box.hidden = false; }
    });
    document.addEventListener("keydown", (e) => {
      if (UI.state.route !== "overview") return;
      const row = e.target.closest?.("[data-ov-open]");
      if (row && e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openDetail(row.dataset.ovOpen, row.dataset.value, row); return; }
      const box = e.target.closest?.("[data-ov-chart]");
      if (!box || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const count = window.OV.chart?.pts.length || 1, at = box.dataset.at === undefined ? count - 1 : +box.dataset.at;
      moveCross(box, e.key === "ArrowLeft" ? at - 1 : e.key === "ArrowRight" ? at + 1 : e.key === "Home" ? 0 : count - 1);
    });
    document.addEventListener("pointermove", (e) => {
      const box = e.target.closest?.("[data-ov-chart]");
      if (!box || !window.OV.chart) return;
      const rect = box.querySelector("svg").getBoundingClientRect();
      moveCross(box, Math.round(((e.clientX - rect.left) / rect.width) * (window.OV.chart.pts.length - 1)));
    });
    document.addEventListener("pointerout", (e) => {
      const box = e.target.closest?.("[data-ov-chart]");
      if (box && !box.contains(e.relatedTarget) && document.activeElement !== box) { box.querySelector(".lv-tip").hidden = true; box.querySelector(".lv-cross").setAttribute("hidden", ""); }
    });
    window.addEventListener("seocc:keywords-added", () => { OV.selected.clear(); forget(); redraw(); });
    // A site added since the last answer: that answer said "No site yet", so it's asked again.
    window.addEventListener("seocc:site-added", () => { forget(); });
    window.addEventListener("seocc:sources-changed", () => { forget(); });
  }
  async function saveNote() {
    const form = UI.$("#ov-note-form"), box = UI.$("#ov-note-error");
    box.hidden = true;
    try {
      await window.COMP.api("POST", "search/notes", { site_id: UI.siteIdPicked(), day: form.elements.f_day.value, text: form.elements.f_text.value });
      UI.forgetPanelForm(); UI.closePanel(); forget(); UI.render({ keepScroll: true }); UI.toast(t("Note added"));
    } catch (err) { box.textContent = t(err.message); box.hidden = false; form.elements.f_text.focus(); }
  }
  /* Downloads (PDF, Excel, CSV) are the Export button in the top bar: export.js, with OV's range, tab, filters and sort. */

  // ---- register: replaces the old Overview page, keeps its shared setup -----------------------------
  window.SCREENS = window.SCREENS || {};
  const old = window.SCREENS.overview || {};
  window.SCREENS.overview = {
    init(helpers) {
      old.init?.(helpers); UI = helpers; ({ t, esc, num, icon } = helpers); bind();
      UI.range.on(() => { OV.page = 0; OV.selected.clear(); });
    },
    page: overviewPage,
    /* The view in the address: tab, show, brand, and the filters of Queries and Pages. */
    address() {
      const out = {};
      if (OV.tab !== "query") out.tab = OV.tab;
      if (OV.show !== "all") out.show = OV.show;
      if (OV.brand !== "all" && OV.tab === "query") out.brand = OV.brand;
      if (OV.tab === "opportunities" && OV.opp !== "almost") out.opp = OV.opp;
      const f = filterOf(OV.tab);
      if (filterOn(f)) {
        if (f.q.trim()) { out.q = f.q.trim(); if (f.q_mode !== "contains") out.qm = f.q_mode; }
        if (freshWanted()) out.fresh = 1;
        NUMBER_FILTERS.forEach(([id]) => { if (String(f[id]).trim()) out[ADDR[id]] = String(f[id]).trim(); });
      }
      return out;
    },
    fromAddress(q) {
      const tab = q.get("tab");
      OV.tab = TABS.some(([id]) => id === tab) ? tab : "query";
      OV.show = SHOWS.some(([id]) => id === q.get("show")) ? q.get("show") : "all";
      OV.brand = ["all", "brand", "nonbrand", "non_brand"].includes(q.get("brand")) ? q.get("brand") : "all";
      OV.opp = OPPS.some(([id]) => id === q.get("opp")) ? q.get("opp") : "almost";
      OV.page = 0; OV.sort = null;
      if (OV.filters[OV.tab]) {
        const f = blankFilter();
        if (q.get("q")) { f.q = q.get("q").slice(0, 200); f.q_mode = TEXT_MODES.some(([id]) => id === q.get("qm")) ? q.get("qm") : "contains"; }
        NUMBER_FILTERS.forEach(([id]) => { const v = q.get(ADDR[id]); if (v && /^\d+(\.\d+)?$/.test(v)) f[id] = v; });
        OV.filters[OV.tab] = f;
        OV.moreFilters = numbersOn(f) > 0;
        OV.includeFresh = q.get("fresh") === "1" && f.q_mode === "exact" && f.q.trim() ? { dim: OV.tab, q: f.q.trim() } : null;
      }
    },
  };

  const words = {
    "Last 24 hours": "Dernières 24 heures", "Last 7 days": "7 derniers jours", "Last 28 days": "28 derniers jours", "Last 3 months": "3 derniers mois", "Last 6 months": "6 derniers mois", "Last 12 months": "12 derniers mois", "Last 16 months": "16 derniers mois", "Custom": "Personnalisée",
    "vs previous period": "vs période précédente", "vs same period last year": "vs même période l'an dernier", "No comparison": "Sans comparaison", "this period": "cette période",
    "Queries": "Requêtes", "Pages": "Pages", "Countries": "Pays", "Devices": "Appareils", "Opportunities": "Opportunités", "Split by": "Répartir par",
    "All": "Toutes", "Gaining clicks": "Gagnent des clics", "Losing clicks": "Perdent des clics", "New": "Nouvelles", "Lost": "Perdues", "Top 3": "Top 3", "Positions 4 to 10": "Positions 4 à 10", "Positions 11 to 20": "Positions 11 à 20", "Position 21 and after": "Position 21 et au-delà",
    "Almost on page 1": "Presque en page 1", "Low click rate": "Taux de clic faible", "Two pages compete": "Deux pages en concurrence", "Lost queries": "Requêtes perdues",
    "Queries at positions 11 to 20 with real impressions. A small push brings them onto page 1.": "Requêtes en positions 11 à 20 avec de vraies impressions. Un petit effort les amène en page 1.",
    "Non-brand queries clicked far less than this site's own queries at the same position. Rewrite the title and description.": "Requêtes hors marque bien moins cliquées que les autres requêtes du site à la même position. Réécrivez le titre et la description.",
    "Queries where two or more of your pages each get a fair share of the impressions, so Google can't pick one.": "Requêtes pour lesquelles deux de vos pages ou plus reçoivent chacune une bonne part des impressions : Google n'arrive pas à en choisir une.",
    "Queries that had clicks in the period before and now show nowhere. Small ones are left out.": "Requêtes qui avaient des clics sur la période précédente et n'apparaissent plus. Les petites sont écartées.",
    "pts": "pts", "place better": "place de mieux", "place worse": "place de moins", "places better": "places de mieux", "places worse": "places de moins", "No change": "Sans changement",
    "Live from Search Console": "En direct de la Search Console", "Saved data": "Données enregistrées", "last pulled": "dernière lecture", "Days from": "Les jours à partir du", "aren't final yet": "ne sont pas encore définitifs",
    "Matches Search Console": "Identique à la Search Console", "checked": "vérifié", "Differs from Search Console": "Diffère de la Search Console", "Check now": "Vérifier maintenant", "Compare with Search Console": "Comparer avec la Search Console",
    "Google didn't answer, so this is the last pull.": "Google n'a pas répondu : voici la dernière lecture.", "just now": "à l'instant", "Totals": "Totaux",
    "Shown on the chart": "Affiché sur le graphique", "Press to show it on the chart": "Appuyez pour l'afficher sur le graphique", "Press a number above to show its line.": "Appuyez sur un chiffre au-dessus pour afficher sa courbe.",
    "Period before": "Période précédente", "Not final yet": "Pas encore définitif", "not final": "provisoire", "Notes and finished tasks": "Notes et tâches terminées", "Delete the note": "Supprimer la note",
    "Week from": "Semaine du", "Hour": "Heure", "Clicks before": "Clics avant", "Impressions before": "Impressions avant", "Position before": "Position avant", "In brackets: the period before": "Entre parenthèses : la période précédente",
    "Unknown": "Inconnu", "Mobile": "Mobile", "Tablet": "Tablette", "Computer": "Ordinateur", "Tracked in Keywords": "Suivi dans Mots-clés", "Tracked": "Suivi", "Track": "Suivre", "Moved up in Google": "Monté dans Google", "Moved down in Google": "Descendu dans Google", "Change from the period before": "Écart avec la période d’avant", "Task": "Tâche",
    "Nothing to show for this choice.": "Rien à afficher pour ce choix.", "Pick": "Choisir", "Pick all shown": "Tout choisir", "Show": "Afficher",
    "Previous": "Précédent", "Next": "Suivant", "Page": "Page", "Rows per page": "Lignes par page", "per page": "par page", "Only the first %n can be shown. Filter to see the rest.": "Seules les %n premières s’affichent. Filtrez pour voir les autres.", "query picked": "requête choisie", "queries picked": "requêtes choisies", "Track them": "Les suivre", "Clear": "Effacer",
    "small ones hidden (under 3 clicks and 50 impressions).": "petites écartées (moins de 3 clics et 50 impressions).", "queries with impressions": "requêtes avec des impressions", "before": "avant",
    "Google leaves out rare searches, so queries never add up to the total clicks.": "Google écarte les recherches rares : les requêtes n'additionnent donc jamais tous les clics.",
    "Add your brand words": "Ajoutez vos mots de marque", "Brand searches": "Recherches de marque", "Non-brand": "Hors marque", "Brand": "Marque", "Brand words": "Mots de marque",
    "Add your brand words to see this. Brand searches are clicked far more, so they'd make every other query look weak.": "Ajoutez vos mots de marque pour voir ceci. Les recherches de marque sont bien plus cliquées : elles feraient paraître faibles toutes les autres requêtes.",
    "Not enough queries yet to know this site's usual click rate at each position.": "Pas encore assez de requêtes pour connaître le taux de clic habituel du site à chaque position.",
    "Contains": "Contient", "Doesn't contain": "Ne contient pas", "Exactly": "Exactement", "Matches regex": "Correspond à la regex",
    "Clicks at least": "Clics au moins", "Impressions at least": "Impressions au moins", "Position from": "Position de", "Position to": "Position jusqu'à",
    "Filter queries": "Filtrer les requêtes", "Filter pages": "Filtrer les pages", "How the text matches": "Comment le texte correspond", "More filters": "Plus de filtres", "Clear filters": "Effacer les filtres",
    "No queries match these filters.": "Aucune requête ne correspond à ces filtres.", "No pages match these filters.": "Aucune page ne correspond à ces filtres.",
    "That pattern isn't valid.": "Cette expression n'est pas valide.", "Filters take numbers.": "Les filtres prennent des nombres.", "That filter is too long.": "Ce filtre est trop long.",
    "Usual at this position": "Habituel à cette position", "Pages that share it": "Pages qui se la partagent", "pos.": "pos.",
    "Pages that show for it": "Pages qui apparaissent pour elle", "Queries that bring it": "Requêtes qui l'amènent", "Shares of impressions. Search Console counts each page apart, so these don't add up to the query.": "Parts des impressions. La Search Console compte chaque page à part : elles ne s'additionnent pas pour donner la requête.",
    "clicks": "clics", "impressions": "impressions", "Countries come from Google live, and it didn't answer.": "Les pays viennent de Google en direct, et il n'a pas répondu.",
    "Clicks, day by day": "Clics, jour par jour", "Position, day by day (higher is better)": "Position, jour par jour (plus haut, c'est mieux)", "Track as a keyword": "Suivre comme mot-clé", "Create a task": "Créer une tâche",
    "Searches that contain one of these count as brand searches. Case and accents don't matter.": "Les recherches qui contiennent l'un de ces mots comptent comme recherches de marque. Majuscules et accents n'ont pas d'importance.",
    "All my sites": "Tous mes sites", "No brand words yet.": "Pas encore de mots de marque.", "Add a brand word": "Ajouter un mot de marque", "Such as your company or site name": "Par exemple le nom de votre société ou de votre site", "Add": "Ajouter",
    "Brand word added": "Mot de marque ajouté", "Brand word removed": "Mot de marque retiré",
    "Add a note to the chart": "Ajouter une note au graphique", "Mark a change you made, such as new titles, so you can see what followed.": "Marquez un changement que vous avez fait, comme de nouveaux titres, pour voir ce qui a suivi.",
    "Day": "Jour", "Note": "Note", "Save the note": "Enregistrer la note", "Note added": "Note ajoutée", "Note deleted": "Note supprimée", "Add a note": "Ajouter une note",
    "Saved here": "Enregistré ici", "Last 28 days, checked": "28 derniers jours, vérifiés", "Clicks / impressions.": "Clics / impressions.", "Days": "Jours",
    "Some days changed at Google after they were saved. Reading them again fixes it.": "Certains jours ont changé chez Google après leur enregistrement. Les relire corrige cela.",
    "Every day matches. Google adds up some tables over a range differently from its days, which a new pull can't change.": "Chaque jour correspond. Google additionne certains tableaux sur une période autrement que jour par jour, ce qu'une nouvelle lecture ne peut pas changer.",
    "Read those days again": "Relire ces jours", "Includes days not final yet": "Inclut des jours pas encore définitifs", "These are the last saved numbers.": "Voici les derniers chiffres enregistrés.", "Open the Google connection": "Ouvrir la connexion Google", "From": "Du", "To": "Au", "Period": "Période", "Compare with": "Comparer avec", "Reading…": "Lecture…",
    "Hour by hour": "Heure par heure", "Week by week": "Semaine par semaine", "Day by day": "Jour par jour",
    "Tables below use whole days, so they show the last 2 days.": "Les tableaux ci-dessous utilisent des journées entières : ils montrent les 2 derniers jours.",
    "Search Console data is up to date.": "Les données de la Search Console sont à jour.", "Open Keywords to add it.": "Ouvrez Mots-clés pour l'ajouter.",
    "It matches Search Console.": "C'est identique à la Search Console.", "It differs from Search Console. Press the warning to see where.": "Cela diffère de la Search Console. Appuyez sur l'alerte pour voir où.",
    "Reading those days again. It updates here when done.": "Relecture de ces jours. La page se met à jour une fois terminé.",
    "That brand word is already there.": "Ce mot de marque est déjà là.", "That note is already on that day.": "Cette note existe déjà ce jour-là.", "Type what the rule should match.": "Indiquez ce que la règle doit reconnaître.",
    "Type a short note, up to 300 characters.": "Saisissez une note courte, 300 caractères au plus.", "Pick one site for a note.": "Choisissez un site pour la note.",
  };
  Object.keys(words).forEach((w) => { if (window.FR[w] === undefined) window.FR[w] = words[w]; });
})();
