/* Search → Overview. Search Console's numbers the way its own screen shows them, read for an SEO:
   one sentence on top, four numbers that switch lines on the chart, the chart, then one card with tabs.
   Ranges are Search Console's own and are worked out on the server (seo/metrics/search.py), because only the server knows
   the newest day Google has. Track and Create task sit on row hover and in the side panel, never as a column of buttons.

   Simpler screens (UI.simple(), ?simple=1; plan-seo-command-center-simplify-screens-like-mickaz.md, section 2). With the switch
   off nothing below changes. With it on:
   - the head is UI.head: dates and comparison from the app's period, then one chip "Search Console · live ✓" (or saved, or
     differs ⚠) that opens the check panel (checkPanel: where the numbers come from, not-final days, Compare with Search
     Console, Read those days again). The chip keeps .ov-trust as a hook. Old subtitle, not-final days, "no comparison that far
     back" and the 24-hour note go behind the head's (i). The period line under the head goes (the head has the dates).
   - the four numbers are UI.card switches (data-card = metric id, still .ov-card and data-ov-line), each graph in its own
     chart line's colour (overview.css), so card 4 is orange like its line.
   - the tabbed card: underline tabs (.page-tabs.in-card) with "Queries 7"; one controls row: Show · brand · filter box ·
     More filters. How the text matches sits inside More filters while the box is empty, beside the box once it has text.
     The query count, "N small ones hidden" and each opportunity's explanation go behind an (i) in that row. No table-layer
     Filter (data-tt-filter-off): the card has its own. The footer hides while there is one page and nothing to choose.
   - a row opens UI.rowPanel (760 px): four numbers, clicks and position over time, its pages or queries, countries; Track
     and Create task in the foot with the same data-ov-track / data-ov-task hooks.
   - answers come through SCREEN_DATA (5 minutes, warm-up list: overview and the table on show). */
(() => {
  "use strict";
  let UI = null, t, esc, num, icon;
  const RANGES = [["24h", "Last 24 hours"], ["7d", "Last 7 days"], ["28d", "Last 28 days"], ["3m", "Last 3 months"], ["6m", "Last 6 months"], ["12m", "Last 12 months"], ["16m", "Last 16 months"], ["tm", "This month"], ["lm", "Last month"], ["custom", "Custom"]];
  const COMPARES = [["prev", "vs previous period"], ["yoy", "vs last year"], ["none", "No comparison"]];
  const METRICS = [
    // The card colours in their order (look-clear.css): blue, teal, indigo, grey. Never purple (a competitor) or a status colour.
    { id: "clicks", name: "Clicks", color: "var(--c-blue)", ic: "mouse-pointer-click" },
    { id: "impressions", name: "Impressions", color: "var(--c-teal)", ic: "eye" },
    { id: "click_rate", name: "Click rate", color: "var(--c-indigo)", ic: "percent" },
    { id: "position", name: "Average position", color: "var(--c-grey)", ic: "arrow-up-narrow-wide", invert: true },
  ];
  const TABS = [["query", "Queries"], ["page", "Pages"], ["country", "Countries"], ["device", "Devices"], ["opportunities", "Opportunities"]];
  const SHOWS = [["all", "All"], ["gaining", "Gaining clicks"], ["losing", "Losing clicks"], ["new", "New"], ["lost", "Lost"], ["top3", "Top 3"], ["4-10", "Positions 4–10"], ["11-20", "Positions 11–20"], ["21+", "Positions 21+"]];
  const OPPS = [
    ["almost", "Almost on page 1", "Positions 11–20, close to page 1.", "Queries at positions 11 to 20 with real impressions. A small push brings them onto page 1."],
    ["low_ctr", "Low click rate", "Clicked less than usual: rewrite the title and description.", "Non-brand queries clicked far less than this site's own queries at the same position. Rewrite the title and description."],
    ["compete", "Two pages compete", "Two or more of your pages split the impressions.", "Queries where two or more of your pages each get a fair share of the impressions, so Google can't pick one."],
    ["lost", "Lost queries", "Had clicks before, now gone.", "Queries that had clicks in the period before and now show nowhere. Small ones are left out."],
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
  const NUMBER_FILTERS = [["min_clicks", "Min clicks"], ["min_impressions", "Min impressions"], ["pos_from", "Position from"], ["pos_to", "Position to"]];
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
  const simple = () => Boolean(UI?.simple?.());
  const shared = () => Boolean(window.SCREEN_DATA?.on?.()); // the simpler screens' 5-minute cache (screen-data.js)
  function load(path, extra = {}) {
    const key = `search/${path}?${query(extra)}`;
    if (shared()) {
      const ask = OV.fresh && path === "overview" ? `${key}&fresh=1` : undefined;
      if (path === "overview") OV.fresh = false;
      const route = UI.state.route;
      return window.SCREEN_DATA.entry(key, { route, ask, redraw: () => redraw(route) });
    }
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
  const forget = () => { OV.cache.clear(); if (shared()) window.SCREEN_DATA.forget("search/"); };
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
    const word = Math.abs(places) === 1 ? t(places > 0 ? "place" : "place") : t(places > 0 ? "places" : "places");
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
    const tip = lowerIsBetter ? t(good ? "Moved up in Google" : "Moved down in Google") : t("vs period before");
    return `<span class="ov-d ${good ? "good" : "crit"}" title="${tip}">${text}</span>`;
  };
  const numCell = (value, change) => `<span class="ov-nc"><span class="ov-v">${value}</span>${change === null ? "" : `<span class="ov-dslot">${change}</span>`}</span>`;
  const posBadge = (p) => (p === null || p === undefined ? "—" : `<span class="pos ${p <= 3 ? "pos-top3" : p <= 10 ? "pos-top10" : ""}">${dec1(p)}</span>`);
  window.OV_CELLS = { cellChange, numCell, posBadge }; // the same cells on Insights

  // ---- the sentence on top ----------------------------------------------------------------------
  // The sentence is HTML: a page in it opens that page, and everything taken from the data is escaped here.
  const driverName = (d) => (d.dim === "page" ? PageLink.html(d.name, { text: pathOf(d.name) }) : KeywordLink.html(d.name, { host: hostPicked(), text: fr() ? `« ${d.name} »` : `“${d.name}”` }));
  const pathOf = (url) => { try { const u = new URL(url); return u.pathname || "/"; } catch { return url; } };
  /* Only what the cards below don't say (critique, 2026-11-12): the Clicks card already holds the total and its change, so no
     badge or "Clicks 1,200 → 1,350" here. What's left is who drove it: the biggest gains or losses as rows, or the top query
     and page. Nothing to add, nothing drawn. */
  function sentence(a) {
    if (!a) return "";
    if (a.kind === "summary") {
      const rows = [a.top_query ? [fr() ? "Requête qui apporte le plus" : "Top query", driverName({ dim: "query", name: a.top_query })] : null, a.top_page ? [fr() ? "Page qui apporte le plus" : "Top page", driverName({ dim: "page", name: a.top_page })] : null].filter(Boolean);
      return rows.length ? `<ul class="ov-ans-list ov-ans-tops">${rows.map(([label, name]) => `<li><span class="ov-ans-label">${label}</span><span class="ov-ans-name">${name}</span></li>`).join("")}</ul>` : "";
    }
    if (a.kind === "steady" || !a.drivers?.length) return "";
    const up = a.kind === "up";
    const top = Math.max(1, ...a.drivers.map((d) => Math.abs(d.change)));
    const rows = a.drivers.map((d) => `<li><span class="ov-ans-name">${driverName(d)}</span><span class="ov-ans-bar" aria-hidden="true"><i class="${d.change < 0 ? "down" : "up"}" style="width:${Math.max(4, Math.round(Math.abs(d.change) / top * 100))}%"></i></span><b class="${d.change < 0 ? "down" : "up"}">${d.change > 0 ? "+" : "−"}${num(Math.abs(d.change))}</b></li>`).join("");
    return `<span class="ov-ans-label">${fr() ? (up ? "Plus forts gains de clics" : "Plus fortes pertes de clics") : up ? "Biggest gains in clicks" : "Biggest losses in clicks"}</span><ul class="ov-ans-list">${rows}</ul>`;
  }

  // ---- trust line ------------------------------------------------------------------------------
  function trust(d) {
    // Simpler screens: the line is the head's chip; only Google's failure stays here, since it carries what to do.
    if (simple()) return d.origin !== "live" && d.live_error ? liveErrorNote(d.live_error) : "";
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
    const steps = window.FIX?.html ? window.FIX.html(message, { tool: "Search Console", id: "google", retry: "refresh" }, { said: true }) : ""; // first: it teaches t() the French of sentences built from a name
    // The fix box's sentences don't name the tool (2026-11-11), so its logo says once which one this is.
    const why = fix?.summary ? `Search Console: ${esc(t(fix.summary))}` : esc(t("Google didn't answer."));
    return `<div class="note warn ov-live-error" role="alert">${icon("triangle-alert")}<div><p><b>${t("These are the last saved numbers.")}</b> ${why}</p>${steps}
      <p class="ov-empty-act"><button class="btn btn-small" data-ov-fix-google>${icon("settings")}${t("Open the Google connection")}</button></p></div></div>`;
  }

  // ---- four numbers, each a switch for its line ----------------------------------------------------
  /* Simpler screens: the shared number card (UI.card) as a switch. Its graph and its top line take the chart line's colour. */
  const CARD_FMT = { clicks: "num", impressions: "num", click_rate: (v) => rate(v), position: (v) => dec1(v) };
  const CARD_UNIT = { clicks: "%", impressions: "%", click_rate: "pts", position: "places" };
  function simpleCards(d) {
    const was = d.compare_series || [];
    return `<section class="tiles ov-cards" aria-label="${t("Totals")}">${METRICS.map((m) => {
      const now = d.totals?.[m.id], before = d.before?.[m.id], on = OV.lines.has(m.id);
      return UI.card({
        id: m.id, label: m.name, value: now ?? null, format: CARD_FMT[m.id],
        change: before === null || before === undefined || now === null || now === undefined ? null : { now, before, unit: CARD_UNIT[m.id] },
        spark: { now: d.series.map((p) => p[m.id]), before: was.length ? d.series.map((_, i) => was[i]?.[m.id] ?? null) : [], days: d.series.map((p) => p.day), invert: m.invert },
        toggle: { pressed: on, color: m.color }, cls: `tile ov-card${on ? " on" : ""}`,
        attrs: { "data-ov-line": m.id, "aria-label": `${t(m.name)}: ${fmt[m.id](now ?? null)}. ${t(on ? "Shown on the chart" : "Press to show it on the chart")}` },
      });
    }).join("")}</section>`;
  }
  function cards(d) {
    if (simple() && UI.card) return simpleCards(d);
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

  // ---- chart: one small chart per number, stacked on the same days ------------------------------
  /* Clicks (tens) and impressions (thousands) on twin axes both looked flat, and the two scales invited a false comparison.
     So each number shown gets its own strip with its own scale, on one shared row of days, one crosshair and one tooltip.
     Position runs upside down (1 at the top), the comparison is dashed, days not final yet are lighter. */
  const W = 1000, H = 220;
  function chart(d) {
    const pts = d.series;
    if (!pts.length) return `<div class="empty"><p>${t("No data in this period.")}</p>${UI.longerPeriodButton ? UI.longerPeriodButton() : ""}</div>`;
    const shown = METRICS.filter((m) => OV.lines.has(m.id));
    if (!shown.length) return `<div class="empty"><p>${t("Press a number above to show its line.")}</p></div>`;
    const x = (i) => (pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W);
    const freshAt = pts.findIndex((p) => p.fresh);
    const grid = [0, 0.5, 1].map((f) => `<line class="lv-grid" x1="0" x2="${W}" y1="${8 + f * (H - 16)}" y2="${8 + f * (H - 16)}"/>`).join("");
    // Markers sit on the point whose day (or week) holds them.
    const markAt = (m) => { let at = -1; pts.forEach((p, i) => { if (p.day.slice(0, 10) <= m.day) at = i; }); return at; };
    const marks = (d.markers || []).map((m) => ({ ...m, at: markAt(m) })).filter((m) => m.at >= 0);
    const flags = marks.map((m) => `<g class="ov-flag ${m.kind}"><line x1="${x(m.at)}" x2="${x(m.at)}" y1="0" y2="${H}"/></g>`).join("");
    const strip = (m) => {
      const values = pts.map((p) => p[m.id]);
      const was = (d.compare_series || []).map((p) => p[m.id]);
      const all = [...values, ...was].filter((v) => v !== null && v !== undefined);
      let lo = all.length ? Math.min(...all) : 0, hi = all.length ? Math.max(...all) : 1;
      if (!m.invert) lo = 0;
      if (hi === lo) hi = lo + 1;
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
      const lines = `${was.length ? `<path class="lv-line ov-was" d="${path(was)}" stroke="${m.color}"/>` : ""}
        ${solidEnd >= 0 ? `<path class="lv-line" d="${path(values, 0, solidEnd)}" stroke="${m.color}"/>` : ""}
        ${freshAt >= 0 ? `<path class="lv-line ov-fresh" d="${path(values, Math.max(0, freshAt - 1))}" stroke="${m.color}"/>` : ""}
        ${pts.length === 1 && values[0] !== null ? `<circle cx="${x(0)}" cy="${y(values[0])}" r="4" fill="${m.color}"/>` : ""}`;
      const [top, bottom] = m.invert ? [lo, hi] : [hi, lo];
      // Grey text that passes contrast, with the line's colour as a small mark beside the strip's name.
      const key = `<i class="ov-ylab-key" style="background:${m.color}" aria-hidden="true"></i>`;
      const name = shown.length > 1 ? `<span class="ov-strip-name">${key}${esc(t(m.name))}</span>` : "";
      return `<div class="ov-strip" data-ov-strip="${m.id}">${name}
          <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${grid}${flags}${lines}<line class="lv-cross" x1="0" x2="0" y1="0" y2="${H}" hidden/></svg>
          <span class="ov-ylab left">${shown.length > 1 ? "" : key}${esc(fmt[m.id](top))}</span><span class="ov-ylab left bottom">${esc(fmt[m.id](bottom))}</span>
        </div>`;
    };
    const every = Math.max(1, Math.floor(pts.length / 6));
    const inner = pts.map((p, i) => [p, i]).filter(([, i]) => i > 0 && i % every === 0 && i < pts.length - every / 2).slice(0, 5);
    const ticks = [[pts[0], 0], ...inner, ...(pts.length > 1 ? [[pts[pts.length - 1], pts.length - 1]] : [])]; // the last day always shows
    window.OV.chart = { pts, was: d.compare_series || [], shown, marks };
    const legend = `<div class="lv-legend">${shown.length === 1 ? `<span><i class="lv-key" style="background:${shown[0].color}"></i>${esc(t(shown[0].name))}</span>` : ""}
      ${d.compare_series ? `<span><i class="ov-key-dash" aria-hidden="true"></i>${t("Period before")}</span>` : ""}
      ${freshAt >= 0 ? `<span><i class="ov-key-fresh" aria-hidden="true"></i>${t("Not final yet")}</span>` : ""}
      ${marks.length ? `<span><i class="ov-key-flag" aria-hidden="true"></i>${t("Notes and finished tasks")}</span>` : ""}</div>`;
    return `<div class="lv-chart ov-chart${shown.length > 1 ? " ov-multi" : ""}" style="--ov-strips:${shown.length}" data-ov-chart tabindex="0" role="img" aria-label="${t("Chart")}: ${esc(shown.map((m) => t(m.name)).join(", "))}. ${t("Use the arrow keys to read each day.")}">
        ${shown.map(strip).join("")}
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
    const tip = box.querySelector(".lv-tip"), svg = box.querySelector("svg");
    box.querySelectorAll(".lv-cross").forEach((cross) => { cross.removeAttribute("hidden"); cross.setAttribute("x1", xs); cross.setAttribute("x2", xs); });
    const rows = info.shown.map((m) => `<div><span><i class="lv-key" style="background:${m.color}"></i>${esc(t(m.name))}</span><span>${esc(fmt[m.id](p[m.id]))}${w ? ` <span class="muted">(${esc(fmt[m.id](w[m.id]))})</span>` : ""}</span></div>`).join("");
    const notes = info.marks.filter((m) => m.at === i).map((m) => `<div class="ov-tip-note">${esc(m.text)}</div>`).join("");
    UI.setHTML(tip, `<b>${esc(dayLabel(p.day, true))}${p.fresh ? ` · ${t("not final")}` : ""}</b>${rows}${w ? `<div class="muted ov-tip-was">${t("In brackets: period before")} (${esc(dayLabel(w.day))})</div>` : ""}${notes}`);
    tip.hidden = false;
    const rect = svg.getBoundingClientRect(), left = (xs / W) * rect.width + 18, room = box.clientWidth - tip.offsetWidth - 8;
    tip.style.left = `${Math.max(8, Math.min(room, left + 12 > room ? left - tip.offsetWidth - 12 : left + 12))}px`;
  }

  // ---- the tabbed card ----------------------------------------------------------------------------
  const nameCell = (dim, r) => {
    if (dim === "page") { const link = PageLink.html(r.name, { text: pathOf(r.name), cls: "ov-name" }); return window.PageThumb ? window.PageThumb.row(r.name, { inner: `<div class="mono small">${link}</div>`, size: 36 }) : link; }
    if (dim === "country") return `<span class="ov-name">${esc(r.code ? UI.countryName(r.code) : t("Unknown"))}</span>`;
    if (dim === "device") return `<span class="ov-name">${esc(t({ MOBILE: "Mobile", DESKTOP: "Computer", TABLET: "Tablet" }[r.name] || r.name))}</span>`;
    return `<span class="ov-name">${KeywordLink.html(r.name, { host: hostPicked() })}</span>${r.tracked ? ` <span class="ov-tracked" title="${t("Tracked in Keywords")}">${icon("check")}${t("Tracked")}</span>` : ""}`;
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
    if (!rows.length) return `<div class="empty"><p>${t("Nothing for this choice.")}</p></div>`;
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
      return `<th class="${c.num ? "ov-n" : ""}${on ? " ov-sorted" : ""}" scope="col" aria-sort="${on ? (OV.sort.dir === "asc" ? "ascending" : "descending") : "none"}"><button class="th-btn" data-ov-sort="${c.id}" data-table="${key}" ${c.tip || UI.def(c.label) ? `data-tip="${esc(c.tip ? t(c.tip) : UI.def(c.label))}"` : ""}>${esc(t(c.label))}${on ? icon(OV.sort.dir === "asc" ? "arrow-up" : "arrow-down") : ""}</button>${selectable && c.id === "name" ? selBar("head") : ""}</th>`;
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
      <div class="lv-foot ov-foot${simple() && view.pages === 1 && list.length <= PER[0] && total <= list.length ? " is-quiet" : ""}"><span class="ov-range">${num(view.from + 1)}–${num(view.from + view.rows.length)} ${t("of")} ${num(total)}</span>${pager}${perPick}${total > list.length ? `<span class="ov-capped">${t("First %n shown. Filter to see the rest.").replace("%n", num(list.length))}</span>` : ""}</div></div>`;
  }
  const columnsFor = (dim, compare) => [
    { id: "name", label: { query: "Query", page: "Page", country: "Country", device: "Device" }[dim], get: (r) => r.name, html: (r) => `<div class="ov-cell">${nameCell(dim, r)}${rowActions(dim, r)}</div>` },
    { id: "clicks", label: "Clicks", num: true, get: (r) => r.clicks, html: (r) => numCell(num(r.clicks), compare ? cellChange(r.clicks, r.clicks_before) : null) },
    { id: "impressions", label: "Impressions", num: true, get: (r) => r.impressions, html: (r) => numCell(num(r.impressions), compare ? cellChange(r.impressions, r.impressions_before) : null) },
    { id: "position", label: "Position", num: true, get: (r) => r.position, html: (r) => numCell(posBadge(r.position), compare ? cellChange(r.position, r.position_before, true) : null) },
  ];

  function tabsCard(d) {
    if (simple()) { // underline tabs, the query count on Queries, and the table layer's Filter left out: the card has its own
      const badge = (id) => (id === "query" && d.queries !== null && d.queries !== undefined ? ` <span class="n-badge">${num(d.queries)}</span>` : "");
      const tabs = `<div class="page-tabs in-card" role="tablist" aria-label="${t("Split by")}">${TABS.map(([id, name]) => `<button class="page-tab tab" role="tab" data-ov-tab="${id}" aria-selected="${OV.tab === id}">${t(name)}${badge(id)}</button>`).join("")}</div>`;
      return `<section class="card ov-tabs-card is-simple" data-tt-filter-off>${tabs}${OV.tab === "opportunities" ? opportunitiesBody(d) : breakdownBody(d)}</section>`;
    }
    const tabs = `<div class="tabs" role="tablist" aria-label="${t("Split by")}">${TABS.map(([id, name]) => `<button class="tab" role="tab" data-ov-tab="${id}" aria-selected="${OV.tab === id}">${t(name)}</button>`).join("")}</div>`;
    return `<section class="card ov-tabs-card"><div class="card-head ov-tabs-head">${tabs}</div>${OV.tab === "opportunities" ? opportunitiesBody(d) : breakdownBody(d)}</section>`;
  }
  function breakdownBody(d) {
    const compare = d.compare !== "none";
    if (!compare && !["all", "top3", "4-10", "11-20", "21+"].includes(OV.show)) OV.show = "all";
    const entry = load("breakdown", breakdownArgs());
    const counts = entry.data?.counts || {};
    const choices = SHOWS.filter(([id]) => (compare || !["gaining", "losing", "new", "lost"].includes(id)) && (OV.tab === "query" || OV.tab === "page" || ["all", "gaining", "losing"].includes(id)));
    // Simpler screens: the query count and "small ones hidden" sit behind an (i) beside Show instead of two lines of small print.
    const b0 = entry.data, aside = !simple() || !b0 ? "" : UI.info([
      OV.tab === "query" && d.queries !== null && d.queries !== undefined ? `${num(d.queries)} ${t("queries with impressions")}${d.queries_before !== null && d.queries_before !== undefined ? ` · ${num(d.queries_before)} ${t("before")}` : ""}. ${t("Google leaves out rare searches, so queries never add up to the total clicks.")}` : "",
      b0.small_hidden ? `${num(b0.small_hidden)} ${t("small ones hidden (under 3 clicks and 50 impressions).")}` : "",
    ]);
    const controls = `<div class="ov-controls">
      <label class="ov-show"><span>${t("Show")}</span><select class="select" data-ov-show>${choices.map(([id, name]) => `<option value="${id}" ${OV.show === id ? "selected" : ""}>${t(name)}${counts[id] !== undefined ? ` (${num(counts[id])})` : ""}</option>`).join("")}</select></label>${aside}
      ${OV.tab === "query" ? brandToggle(d) : ""}
      ${filterBar(OV.tab)}
    </div>`;
    if (entry.loading) return `${controls}${UI.skeleton("rows", { rows: 8 })}`;
    if (entry.error) return `${controls}<div class="empty"><p>${esc(t(entry.error))}</p>${filterOn(filterOf(OV.tab)) ? `<div class="ov-empty-act"><button class="btn" data-ov-filter-clear>${t("Clear filters")}</button></div>` : ""}</div>`;
    const b = entry.data;
    const fresh = b.fresh_included?.from ? `<p class="small muted ov-hint ov-fresh-note" role="note">${icon("clock")}${t("Includes not-final days")} (${esc(b.fresh_included.from === b.fresh_included.to ? dayLabel(b.fresh_included.from) : `${dayLabel(b.fresh_included.from)} – ${dayLabel(b.fresh_included.to)}`)})</p>` : "";
    const note = (b.small_hidden && !simple() ? `<p class="small muted ov-hint">${num(b.small_hidden)} ${t("small ones hidden (under 3 clicks and 50 impressions).")}</p>` : "") + fresh;
    const queriesLine = OV.tab === "query" && d.queries !== null && !simple() ? `<p class="small muted ov-hint">${num(d.queries)} ${t("queries with impressions")}${d.queries_before !== null && d.queries_before !== undefined ? ` · ${num(d.queries_before)} ${t("before")}` : ""}. ${t("Rare searches left out.")}${UI.tip("Google leaves out rare searches, so queries never add up to the total clicks.")}</p>` : "";
    if (!b.rows.length && filterOn(filterOf(OV.tab))) return `${controls}<div class="empty"><p>${t(OV.tab === "page" ? "No pages match these filters." : "No queries match these filters.")}</p><div class="ov-empty-act"><button class="btn" data-ov-filter-clear>${t("Clear filters")}</button></div></div>`;
    return `${controls}${queriesLine}${note}${table(OV.tab, b.rows, { columns: columnsFor(OV.tab, compare), selectable: OV.tab === "query", total: b.total ?? b.rows.length })}`;
  }
  /* What the table on show asks the server: also the warm-up's list (SCREEN_DATA.screen). */
  const breakdownArgs = () => ({ dim: OV.tab, show: OV.show, brand: OV.tab === "query" ? OV.brand : "all", ...filterArgs(OV.tab), ...(freshWanted() ? { include_fresh: 1 } : {}) });
  /* One box for the text, like Search Console's own filter, and the number filters behind one button. */
  function filterBar(dim) {
    const f = filterOf(dim);
    if (!f) return "";
    const extra = numbersOn(f), open = OV.moreFilters || extra > 0;
    const modes = TEXT_MODES.map(([id, name]) => `<option value="${id}" ${f.q_mode === id ? "selected" : ""}>${t(name)}</option>`).join("");
    const holder = t(dim === "page" ? "Filter pages" : "Filter queries");
    // Simpler screens: how the text matches waits inside More filters until the box has text, then sits beside it.
    const modeBeside = !simple() || f.q.trim() || f.q_mode !== "contains";
    const modeSelect = `<label class="sr" for="ov-f-mode">${t("How the text matches")}</label><select class="select" id="ov-f-mode" data-ov-f="q_mode">${modes}</select>`;
    const modeInside = modeBeside ? "" : `<label class="ov-filter-num ov-filter-mode"><span>${t("How the text matches")}</span><select class="select" id="ov-f-mode" data-ov-f="q_mode">${modes}</select></label>`;
    const numbers = open ? `<div class="ov-filter-more" role="group" aria-label="${t("More filters")}">${modeInside}${NUMBER_FILTERS.map(([id, name]) => `<label class="ov-filter-num"><span>${t(name)}</span><input class="input" type="number" inputmode="decimal" min="0" step="any" data-ov-f="${id}" value="${esc(f[id])}"></label>`).join("")}</div>` : "";
    return `<form class="ov-filter" id="ov-filter-form" role="search" aria-label="${esc(holder)}">
        <span class="ov-filter-box${modeBeside ? "" : " no-mode"}">${modeBeside ? modeSelect : ""}
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
    const [, , why, whyTip] = OPPS.find(([id]) => id === OV.opp);
    const entry = load("opportunities", { kind: OV.opp });
    const pick = `<label class="ov-show"><span>${t("Show")}</span><select class="select" data-ov-opp>${OPPS.map(([id, name]) => `<option value="${id}" ${OV.opp === id ? "selected" : ""}>${t(name)}</option>`).join("")}</select></label>`;
    // Simpler screens: the explanation goes behind an (i) beside Show.
    const controls = simple() ? `<div class="ov-controls">${pick}${UI.info([why, whyTip])}</div>` : `<div class="ov-controls">${pick}</div><p class="small muted ov-hint">${t(why)}${UI.tip(whyTip)}</p>`;
    if (entry.loading) return `${controls}${UI.skeleton("rows", { rows: 8 })}`;
    if (entry.error) return `${controls}<div class="empty"><p>${esc(entry.error)}</p></div>`;
    const o = entry.data;
    if (o.needs === "brand_words") return `${controls}<div class="empty"><p>${t("Needs your brand words.")}${UI.tip("Brand searches are clicked far more, so they'd make every other query look weak.")}</p><div class="ov-empty-act"><button class="btn btn-main" data-ov-brand-edit>${t("Add your brand words")}</button></div></div>`;
    if (o.needs === "more_data") return `${controls}<div class="empty"><p>${t("Not enough queries yet.")}${UI.tip("Not enough queries yet to know this site's usual click rate at each position.")}</p></div>`;
    const name = { id: "name", label: "Query", get: (r) => r.name, html: (r) => `<div class="ov-cell">${nameCell("query", r)}${rowActions("query", r)}</div>` };
    const cols = {
      almost: [name, { id: "position", label: "Position", num: true, get: (r) => r.position, html: (r) => dec1(r.position) }, { id: "impressions", label: "Impressions", num: true, get: (r) => r.impressions, html: (r) => num(r.impressions) }, { id: "clicks", label: "Clicks", num: true, get: (r) => r.clicks, html: (r) => num(r.clicks) }],
      low_ctr: [name, { id: "click_rate", label: "Click rate", num: true, get: (r) => r.click_rate, html: (r) => rate(r.click_rate) }, { id: "expected_rate", label: "Usual rate", tip: "Usual click rate at this position", num: true, get: (r) => r.expected_rate, html: (r) => rate(r.expected_rate) }, { id: "position", label: "Position", num: true, get: (r) => r.position, html: (r) => dec1(r.position) }],
      compete: [name, { id: "impressions", label: "Impressions", num: true, get: (r) => r.impressions, html: (r) => num(r.impressions) }, { id: "pages", label: "Pages sharing it", get: (r) => r.pages.length, html: (r) => `<ul class="ov-pages">${r.pages.map((p) => `<li>${PageLink.html(p.page, { text: pathOf(p.page) })} <span class="muted">${num(p.share)}% · ${t("pos.")} ${dec1(p.position)}</span></li>`).join("")}</ul>` }],
      lost: [name, { id: "clicks_before", label: "Clicks before", num: true, get: (r) => r.clicks_before, html: (r) => num(r.clicks_before) }, { id: "impressions_before", label: "Impressions before", num: true, get: (r) => r.impressions_before, html: (r) => num(r.impressions_before) }, { id: "position_before", label: "Position before", num: true, get: (r) => r.position_before, html: (r) => dec1(r.position_before) }],
    }[OV.opp];
    return `${controls}${table("query", o.rows, { columns: cols, key: `opp-${OV.opp}` })}`;
  }

  // ---- side panel: one query or one page ------------------------------------------------------------
  /* Simpler screens: the shared row panel (row-panel.js, 760 px). Search/detail has no period before, so no change pills. */
  function rowPanel(dim, value, opener) {
    const isQuery = dim === "query";
    const shares = (data) => isQuery && data.split.some((p) => p.share !== null && p.share !== undefined);
    const numberCols = [
      { label: "Clicks", key: "clicks", num: true }, { label: "Impressions", key: "impressions", num: true },
      { label: "Pos.", key: "position", num: true, html: (r) => esc(dec1(r.position)) },
    ];
    UI.rowPanel({
      id: "ov-detail", kind: isQuery ? "Query" : "Page", title: isQuery ? value : pathOf(value), opener,
      ...(isQuery ? {} : { page: { url: value } }),
      load: async () => {
        const data = await window.COMP.api("GET", `search/detail?${query({ [dim]: value })}`);
        const tot = data.totals || null, series = data.series || [];
        const opts = { everyDay: false };
        return {
          numbers: [
            { id: "clicks", label: "Clicks", value: tot ? tot.clicks : null },
            { id: "impressions", label: "Impressions", value: tot ? tot.impressions : null },
            { id: "click_rate", label: "Click rate", value: tot ? tot.click_rate : null, fmt: (v) => rate(v) },
            { id: "position", label: "Position", value: tot ? tot.position : null, fmt: (v) => dec1(v), lowerIsBetter: true },
          ],
          chart: [UI.rowPanel.chart(series, "clicks", null, { ...opts, label: "Clicks" }), UI.rowPanel.chart(series, "position", null, { ...opts, label: "Position", invert: true })],
          sections: [
            data.split?.length ? {
              title: isQuery ? "Pages" : "Queries", rows: data.split, total: data.split.length,
              columns: [
                { label: isQuery ? "Page" : "Query", key: "name", html: (r) => (isQuery ? PageLink.html(r.name, { text: pathOf(r.name) }) : KeywordLink.html(r.name, { host: hostPicked() })) },
                ...(shares(data) ? [{ label: "Share", key: "share", num: true, html: (r) => (r.share === null || r.share === undefined ? "" : `${num(r.share)}${fr() ? " %" : "%"}`) }] : []),
                ...numberCols,
              ],
            } : null,
            data.countries?.length ? {
              title: "Countries", rows: data.countries, total: data.countries.length, limit: 8,
              columns: [{ label: "Country", key: "code", html: (r) => esc(r.code ? UI.countryName(r.code) : t("Unknown")) }, ...numberCols],
            } : data.countries_error ? { title: "Countries", text: t("Countries: Google didn't answer.") } : null,
          ].filter(Boolean),
          actions: [
            ...(isQuery ? [data.tracked ? { label: "Tracked in Keywords", icon: "check", disabled: true } : { label: "Track", main: true, icon: "plus", attrs: { "data-ov-track": value } }] : []),
            { label: "Create task", icon: "square-check", main: !isQuery, attrs: { "data-ov-task": dim, "data-value": value } },
          ],
        };
      },
    });
  }
  async function openDetail(dim, value, opener) {
    if (dim !== "query" && dim !== "page") return;
    if (simple() && UI.rowPanel) { rowPanel(dim, value, opener); return; }
    const mine = dim === "page" && window.PageThumb?.mine(value);
    const name = dim === "query" ? value : (mine && window.PageThumb.title(value)) || pathOf(value);
    const head = UI.panelHead(name, dim === "query" ? t("Query") : `${mine && name !== pathOf(value) ? `<span class="mono">${esc(pathOf(value))}</span> · ` : `${t("Page")} · `}${PageLink.html(value, { text: t("Open page"), title: value, cls: "page-open" })}`,
      mine ? window.PageThumb.html(value, { size: 44 }) : "");
    UI.openPanel(`${head}<div class="panel-body">${UI.skeleton("panel")}</div>`, opener);
    let data;
    try { data = await window.COMP.api("GET", `search/detail?${query({ [dim]: value })}`); }
    catch (err) { if (UI.$("#panel")) UI.setHTML(UI.$("#panel .panel-body"), `<p class="error">${esc(err.message)}</p>`); return; }
    if (!UI.$("#panel")) return;
    const tot = data.totals;
    const spark = (id, invert) => { const v = data.series.map((p) => p[id]).filter((x) => x !== null); return v.length > 1 ? UI.spark(v, { w: 260, h: 48, invert }) : ""; };
    /* Clicks, impressions and position named once in a heading row; the rows hold the numbers only. The first column's name
       is the section title just above, so it is said to screen readers only. */
    const numHeads = `<th scope="col" class="ov-sn">${t("Clicks")}</th><th scope="col" class="ov-sn">${t("Impressions")}</th><th scope="col" class="ov-sn">${t("Pos.")}</th>`;
    const numCells = (r) => `<td class="ov-sn">${num(r.clicks)}</td><td class="ov-sn">${num(r.impressions)}</td><td class="ov-sn">${dec1(r.position)}</td>`;
    const shares = dim === "query" && data.split.some((p) => p.share !== null && p.share !== undefined);
    const split = data.split.length ? `<h3 class="ov-h3">${t(dim === "query" ? "Pages" : "Queries")}</h3>
      ${dim === "query" ? `<p class="small muted">${t("Shares of impressions.")}${UI.tip("Search Console counts each page apart, so these don't add up to the query.")}</p>` : ""}
      <table class="mini ov-split"><thead><tr><th scope="col"><span class="sr">${t(dim === "query" ? "Page" : "Query")}</span></th>${shares ? `<th scope="col" class="ov-sn"><span class="sr">${t("Share")}</span></th>` : ""}${numHeads}</tr></thead>
      <tbody>${data.split.slice(0, 15).map((p) => `<tr><td class="ov-sname" dir="auto">${dim === "query" ? PageLink.html(p.name, { text: pathOf(p.name) }) : KeywordLink.html(p.name, { host: hostPicked() })}</td>${shares ? `<td class="ov-sn ov-share">${p.share !== null && p.share !== undefined ? `${num(p.share)}${fr() ? " %" : "%"}` : ""}</td>` : ""}${numCells(p)}</tr>`).join("")}</tbody></table>` : "";
    const places = data.countries ? `<h3 class="ov-h3">${t("Countries")}</h3><table class="mini ov-split"><thead><tr><th scope="col"><span class="sr">${t("Country")}</span></th>${numHeads}</tr></thead>
      <tbody>${data.countries.slice(0, 8).map((c) => `<tr><td class="ov-sname">${esc(c.code ? UI.countryName(c.code) : t("Unknown"))}</td>${numCells(c)}</tr>`).join("")}</tbody></table>`
      : data.countries_error ? `<p class="small muted">${t("Countries: Google didn't answer.")}</p>` : "";
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
      <div class="panel-foot">${dim === "query" ? (tracked ? `<span class="ov-tracked">${icon("check")}${t("Tracked in Keywords")}</span><button class="link-btn" data-ov-kw-open="${esc(value)}">${icon("arrow-right")}${t("Open in Keywords")}</button>` : `<button class="btn btn-main" data-ov-track="${esc(value)}">${icon("plus")}${t("Track")}</button>`) : ""}
        <button class="btn" data-ov-task="${dim}" data-value="${esc(value)}">${icon("square-check")}${t("Create task")}</button></div>`, opener);
  }

  // ---- brand words, notes, the check -----------------------------------------------------------------
  async function brandPanel(opener) {
    const site = UI.siteIdPicked();
    let words = [];
    try { words = await window.COMP.api("GET", `search/brand?${site ? `site_id=${site}` : ""}`); } catch { words = []; }
    UI.openPanel(`${UI.panelHead(t("Brand words"), t("Searches containing any of these count as brand. Case and accents ignored."))}
      <div class="panel-body">
        ${words.length ? `<ul class="rows">${words.map((w) => `<li><div class="what"><div class="t" dir="auto">${esc(w.pattern)}</div><div class="s muted">${esc(w.site_id ? (window.SITES.find((s) => s.realId === w.site_id)?.host || "") : t("All my sites"))}</div></div><button class="btn btn-small btn-ghost" data-ov-brand-del="${w.id}">${t("Remove")}</button></li>`).join("")}</ul>` : `<p class="muted">${t("No brand words yet.")}</p>`}
        <form class="ov-brand-form" id="ov-brand-form"><label class="field"><span>${t("Add a brand word")}</span><input class="input" name="f_word" dir="auto" autocomplete="off" placeholder="${esc(t("Company or site name"))}" data-autofocus></label>
        <div class="error" id="ov-brand-error" role="alert" hidden></div><button class="btn btn-main" type="submit">${t("Add")}</button></form>
      </div>`, opener);
  }
  function notePanel(opener, d) {
    UI.openPanel(`${UI.panelHead(t("Add a note"), t("Mark a change, like new titles, to see what followed."))}
      <form class="panel-body" id="ov-note-form" novalidate>
        <label class="field"><span>${t("Day")}</span><input class="input" type="date" name="f_day" value="${esc(d.to)}" min="${esc(d.from)}" max="${esc(d.newest || d.to)}" required></label>
        <label class="field"><span>${t("Note")}</span><input class="input" name="f_text" maxlength="300" dir="auto" autocomplete="off" data-autofocus></label>
        <div class="error" id="ov-note-error" role="alert" hidden></div>
      </form>
      <div class="panel-foot"><button class="btn btn-main" data-ov-note-save>${t("Save note")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener, { key: "ov-note", reopen: () => notePanel(opener, d) });
  }
  /* Simpler screens: the head's Search Console chip opens this. Where the numbers come from, how fresh, and the check. */
  function checkPanel(opener) {
    const d = current();
    if (!d) return;
    const v = d.verify;
    const line = (ic, tone, words) => `<li class="${tone}">${icon(ic)}<span>${words}</span></li>`;
    const rows = [d.origin === "live" ? line("circle-check", "good", t("Live from Search Console"))
      : line("clock", "", `${t("Saved data")}${d.last_pull ? ` · ${t("last pulled")} ${esc(since(d.last_pull))}` : ""}`)];
    if (d.fresh_from && d.fresh_from <= d.to) rows.push(line("clock", "", `${t("Days from")} ${esc(dayLabel(d.fresh_from))} ${t("aren't final yet")}`));
    if (v && v.ok) rows.push(line("circle-check", "good", `${t("Matches Search Console")}${v.checked_at ? ` · ${t("checked")} ${esc(since(v.checked_at))}` : ""}`));
    else if (v) rows.push(line("triangle-alert", "warn", `${t("Differs from Search Console")}${v.checked_at ? ` · ${t("checked")} ${esc(since(v.checked_at))}` : ""}`));
    else rows.push(line("info", "", t("Not compared with Search Console yet.")));
    const differs = v && !v.ok ? `<p>${t(v.fixable ? "Google changed some days after saving. Reading them again fixes it." : "Every day matches. Google's range totals differ from its days; a new pull can't change that.")}</p>
      <p class="small muted">${t("Last 28 days")}. ${t("Clicks / impressions.")}</p>${diffList("Days", v.days, "Date")}${diffList("Queries", v.queries, "Query")}${diffList("Pages", v.pages, "Page")}` : "";
    const fix = v && !v.ok && v.fixable, compare = d.single_site && d.origin === "live";
    UI.openPanel(`${UI.panelHead(t("Search Console check"), t("Your Google results, from Search Console"))}
      <div class="panel-body"><ul class="ov-check">${rows.join("")}</ul>${differs}</div>
      <div class="panel-foot">${fix ? `<button class="btn btn-main" data-ov-verify-fix>${t("Read those days again")}</button>` : ""}${compare ? `<button class="btn ${fix ? "" : "btn-main"}" data-ov-verify-run>${t("Compare with Search Console")}</button>` : ""}<button class="btn" data-close-panel>${t("Close")}</button></div>`, opener);
  }
  const diffList = (title, rows, label) => (rows?.length ? `<h3 class="ov-h3">${t(title)}</h3><div class="table-wrap"><table class="data"><thead><tr><th>${t(label)}</th><th class="c">Search Console</th><th class="c">${t("Saved here")}</th></tr></thead><tbody>${rows.map((r) => `<tr><td dir="auto">${esc(r.day ? dayLabel(r.day, true) : r.name)}</td><td class="c">${num(r.google.clicks)} / ${num(r.google.impressions)}</td><td class="c">${num(r.saved.clicks)} / ${num(r.saved.impressions)}</td></tr>`).join("")}</tbody></table></div>` : "");
  function verifyPanel(opener, v) {
    const list = (title, rows, label) => (rows?.length ? `<h3 class="ov-h3">${t(title)}</h3><div class="table-wrap"><table class="data"><thead><tr><th>${t(label)}</th><th class="c">Search Console</th><th class="c">${t("Saved here")}</th></tr></thead><tbody>${rows.map((r) => `<tr><td dir="auto">${r.day ? esc(dayLabel(r.day, true)) : label === "Query" ? KeywordLink.html(r.name, { host: hostPicked() }) : esc(r.name)}</td><td class="c">${num(r.google.clicks)} / ${num(r.google.impressions)}</td><td class="c">${num(r.saved.clicks)} / ${num(r.saved.impressions)}</td></tr>`).join("")}</tbody></table></div>` : "");
    UI.openPanel(`${UI.panelHead(t("Differs from Search Console"), `${t("Last 28 days, checked")} ${esc(since(v.checked_at))}. ${t("Clicks / impressions.")}`)}
      <div class="panel-body">
        <p>${t(v.fixable ? "Google changed some days after saving. Reading them again fixes it." : "Every day matches. Google's range totals differ from its days; a new pull can't change that.")}</p>
        ${list("Days", v.days, "Date")}${list("Queries", v.queries, "Query")}${list("Pages", v.pages, "Page")}
      </div>
      <div class="panel-foot">${v.fixable ? `<button class="btn btn-main" data-ov-verify-fix>${t("Read those days again")}</button>` : ""}<button class="btn" data-close-panel>${t("Close")}</button></div>`, opener);
  }

  // ---- the page -------------------------------------------------------------------------------------
  const STATES = { no_sites: 1, not_connected: 1, not_used: 1, failing: 1, waiting: 1 };
  /* The dates come from the shared picker in the top bar. Here, the days the server really used, and both periods in words. */
  function periodLine(d) {
    if (!d || !d.from) return "";
    if (d.final_through || d.to) UI.range.end("overview", d.final_through || d.to, "Search Console");
    const now = d.hourly ? t("Last 24 hours") : `${dayLabel(d.from)} – ${dayLabel(d.to, true)}`;
    const before = d.compare_from && d.compare_to ? ` ${t("vs")} ${dayLabel(d.compare_from)} – ${dayLabel(d.compare_to, true)}` : "";
    const none = d.compare_unavailable === "history" ? ` · ${t("No comparison: Search Console doesn't keep that far back.")}` : "";
    return `<p class="ov-span small muted" role="status">${esc(now + before)}${esc(none)}</p>`;
  }
  /* Simpler screens: the head's one chip for where the numbers come from. It keeps .ov-trust as the flows' hook. */
  function sourceChip(d) {
    if (!d || (STATES[d.state] && !d.totals)) return null;
    const v = d.verify, open = "data-ov-check";
    if (v && !v.ok) return { word: t("Search Console · differs"), sev: "warn", open };
    if (d.origin === "live") return { word: `${t("Search Console · live")} ✓`, open };
    return { word: `${t("Search Console · saved data")}${d.last_pull ? ` ${since(d.last_pull)}` : ""}`, sev: d.live_error ? "warn" : "", open };
  }
  function simpleHead(d, main) {
    const info = ["Your Google results, from Search Console"];
    if (d?.fresh_from && d.to && d.fresh_from <= d.to) info.push(`${t("Days from")} ${dayLabel(d.fresh_from)} ${t("aren't final yet")}.`);
    if (d?.compare_unavailable === "history") info.push("No comparison: Search Console doesn't keep that far back.");
    if (d?.hourly) info.push("Tables below show the last 2 whole days.");
    return UI.head({ title: t("Overview"), period: true, source: sourceChip(d), info, main })
      .replace(/class="([^"]*)" data-ov-check/, 'class="$1 ov-trust" data-ov-check');
  }
  function overviewPage() {
    const entry = load("overview");
    const d = entry.data;
    const refresh = `<button class="btn" data-ov-refresh ${OV.poll ? "disabled" : ""}>${icon("refresh-cw")}${t(OV.poll ? "Reading…" : "Refresh data")}</button>`;
    const main = `${d && !STATES[d.state] ? refresh : ""}`;
    const head = simple() && UI.head ? simpleHead(d, main) : UI.topbar(t("Overview"), t("Your Google results, from Search Console"), main);
    const span = periodLine(d); // it also tells the app's period its last day, so it runs on the simpler screens too
    const wrap = (body) => `${head}<div class="content page-enter ov">${simple() ? "" : span}${body}</div>`;
    if (entry.loading) return wrap(UI.skeleton("page"));
    if (entry.noServer) return wrap(`<section class="card"><div class="empty"><h3>${t("Needs the running app")}</h3><p>${t("Opened as a file: no real data.")}</p></div></section>`);
    if (entry.error) return wrap(UI.failCard(entry.error, { retry: "data-ov-retry" }));
    if (STATES[d.state] && !d.totals) return wrap(window.LV?.stateCard ? window.LV.stateCard({ data: d }, "gsc") : `<section class="card"><div class="empty"><p>${esc(d.state)}</p></div></section>`);
    if (!d.totals) return wrap(`${trust(d)}<section class="card"><div class="empty"><h3>${t("No data in this period.")}</h3><p>${t("Pick a longer or earlier period.")}</p>${UI.longerPeriodButton ? `<div style="margin-top:12px">${UI.longerPeriodButton()}</div>` : ""}</div></section>`);
    const chartHead = `<div class="card-head"><h2>${t({ hour: "Hour by hour", week: "Week by week", day: "Day by day" }[d.granularity])}</h2>
      <span class="end ov-chart-tools">${d.single_site ? `<button class="link-btn" data-ov-note-add>${icon("plus")}${t("Add a note")}</button>` : ""}<button class="link-btn" data-ov-table aria-expanded="${OV.table}">${t(OV.table ? "Hide table" : "Show table")}</button></span></div>`;
    return wrap(`${trust(d)}
      ${(() => { const said = sentence(d.answer); return said ? `<div class="ov-answer" dir="auto">${said}</div>` : ""; })()}
      ${cards(d)}
      <section class="card ov-chart-card">${chartHead}${chart(d)}</section>
      ${d.hourly && !simple() ? `<p class="small muted ov-hint">${t("Tables below show the last 2 whole days.")}</p>` : ""}
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
        if (now.last_pull && now.last_pull !== before) { stopPolling(); UI.toast(t("Search Console data updated.")); }
      } catch { stopPolling(); }
    }, 5000);
    UI.render({ keepScroll: true });
  }
  function stopPolling() { clearInterval(OV.poll); OV.poll = null; forget(); redraw(); }

  // ---- events ---------------------------------------------------------------------------------------
  const current = () => (shared() ? window.SCREEN_DATA.peek(`search/overview?${query()}`) : OV.cache.get(`search/overview?${query()}`)?.data);
  const hostPicked = () => UI.siteHostPicked() || window.SITES.find((s) => s.realId)?.host || null;
  function track(queries, opener) {
    const d = current();
    if (!window.KW) { UI.toast(t("Add it in Keywords."), { kind: "info" }); return; }
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
      if ((el = hit("[data-ov-kw-open]"))) { KeywordLink.open({ keyword: el.dataset.ovKwOpen, host: hostPicked() }); return; }
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
      if (hit("[data-ov-check]")) { checkPanel(hit("[data-ov-check]")); return; }
      if (hit("[data-ov-verify-open]")) { const v = current()?.verify; if (v) verifyPanel(hit("[data-ov-verify-open]"), v); return; }
      if ((el = hit("[data-ov-verify-run]"))) {
        el.disabled = true;
        try { const v = await window.COMP.api("POST", "search/verify", { site_id: UI.siteIdPicked() }); if (el.closest("#panel")) UI.closePanel(); forget(); UI.render({ keepScroll: true }); UI.toast(t(v.ok ? "It matches Search Console." : "It differs from Search Console. See the warning."), { kind: v.ok ? "good" : "info" }); }
        catch (err) { UI.toast(err.message, { kind: "crit" }); el.disabled = false; }
        return;
      }
      if (hit("[data-ov-verify-fix]")) {
        try { await window.COMP.api("POST", "search/verify", { site_id: UI.siteIdPicked(), fix: true }); UI.closePanel(); UI.toast(t("Re-reading those days. Updates here when done.")); startPolling(current()?.last_pull); } catch (err) { UI.toast(err.message, { kind: "crit" }); }
        return;
      }
      if ((el = hit("[data-ov-refresh]"))) {
        const site = UI.siteIdPicked(), ids = site ? [site] : window.SITES.map((s) => s.realId).filter(Boolean);
        const before = current()?.last_pull;
        el.disabled = true;
        try {
          const answers = await Promise.all(ids.map((id) => window.COMP.api("POST", `sites/${id}/collect`, {})));
          if (answers.some((a) => a.pages) && window.LV?.PAGES_NOTE) UI.toast(t(window.LV.PAGES_NOTE), { kind: "info" }); // my pages are read too (2026-11-10)
          if (answers.some((a) => a.rankings) && window.LV?.DDG_NOTE) UI.toast(t(window.LV.DDG_NOTE), { kind: "info" }); // and DuckDuckGo positions (2026-11-11)
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
      if (box && !box.contains(e.relatedTarget) && document.activeElement !== box) { box.querySelector(".lv-tip").hidden = true; box.querySelectorAll(".lv-cross").forEach((c) => c.setAttribute("hidden", "")); }
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
      // Simpler screens: what Overview shows first, for SCREEN_DATA's warm-up and menu hover (does nothing with the switch off).
      window.SCREEN_DATA?.screen?.("overview", () => [`search/overview?${query()}`, OV.tab === "opportunities" ? `search/opportunities?${query({ kind: OV.opp })}` : `search/breakdown?${query(breakdownArgs())}`]);
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
    "vs previous period": "vs période précédente", "vs last year": "vs l'an dernier", "No comparison": "Sans comparaison", "this period": "cette période",
    "Queries": "Requêtes", "Pages": "Pages", "Countries": "Pays", "Devices": "Appareils", "Opportunities": "Opportunités", "Split by": "Répartir par",
    "All": "Toutes", "Gaining clicks": "Gagnent des clics", "Losing clicks": "Perdent des clics", "New": "Nouvelles", "Lost": "Perdues", "Top 3": "Top 3", "Positions 4–10": "Positions 4–10", "Positions 11–20": "Positions 11–20", "Positions 21+": "Positions 21+",
    "Almost on page 1": "Presque en page 1", "Low click rate": "Taux de clic faible", "Two pages compete": "Deux pages en concurrence", "Lost queries": "Requêtes perdues",
    "Positions 11–20, close to page 1.": "Positions 11 à 20, proches de la page 1.",
    "Clicked less than usual: rewrite the title and description.": "Moins cliquées que d'habitude : réécrivez le titre et la description.",
    "Two or more of your pages split the impressions.": "Deux de vos pages ou plus se partagent les impressions.",
    "Had clicks before, now gone.": "Avaient des clics avant, disparues depuis.",
    "pts": "pts", "place": "place", "places": "places", "No change": "Sans changement",
    "Live from Search Console": "En direct de la Search Console", "Saved data": "Données enregistrées", "last pulled": "dernière lecture", "Days from": "Les jours à partir du", "aren't final yet": "ne sont pas encore définitifs",
    "Matches Search Console": "Identique à la Search Console", "checked": "vérifié", "Differs from Search Console": "Diffère de la Search Console", "Check now": "Vérifier maintenant", "Compare with Search Console": "Comparer avec la Search Console",
    "Google didn't answer.": "Google n'a pas répondu.", "just now": "à l'instant", "Totals": "Totaux",
    "Shown on the chart": "Affiché sur le graphique", "Press to show it on the chart": "Appuyez pour l'afficher sur le graphique", "Press a number above to show its line.": "Appuyez sur un chiffre au-dessus pour afficher sa courbe.",
    "Period before": "Période précédente", "Not final yet": "Pas encore définitif", "not final": "provisoire", "Notes and finished tasks": "Notes et tâches terminées", "Delete the note": "Supprimer la note",
    "Week from": "Semaine du", "Hour": "Heure", "Clicks before": "Clics avant", "Impressions before": "Impressions avant", "Position before": "Position avant", "In brackets: period before": "Entre parenthèses : période précédente",
    "Unknown": "Inconnu", "Mobile": "Mobile", "Tablet": "Tablette", "Computer": "Ordinateur", "Tracked in Keywords": "Suivi dans Mots-clés", "Open in Keywords": "Ouvrir dans Mots-clés", "Tracked": "Suivi", "Track": "Suivre", "Moved up in Google": "Monté dans Google", "Moved down in Google": "Descendu dans Google", "vs period before": "vs période précédente", "Task": "Tâche",
    "Nothing for this choice.": "Rien pour ce choix.", "Pick": "Choisir", "Pick all shown": "Tout choisir", "Show": "Afficher",
    "Previous": "Précédent", "Next": "Suivant", "Page": "Page", "Rows per page": "Lignes par page", "per page": "par page", "First %n shown. Filter to see the rest.": "%n premières affichées. Filtrez pour voir les autres.", "query picked": "requête choisie", "queries picked": "requêtes choisies", "Track them": "Les suivre", "Clear": "Effacer",
    "small ones hidden (under 3 clicks and 50 impressions).": "petites écartées (moins de 3 clics et 50 impressions).", "queries with impressions": "requêtes avec des impressions", "before": "avant",
    "Rare searches left out.": "Recherches rares exclues.",
    "Add your brand words": "Ajoutez vos mots de marque", "Brand searches": "Recherches de marque", "Non-brand": "Hors marque", "Brand": "Marque", "Brand words": "Mots de marque",
    "Needs your brand words.": "Il faut vos mots de marque.",
    "Not enough queries yet.": "Pas encore assez de requêtes.",
    "Contains": "Contient", "Doesn't contain": "Ne contient pas", "Exactly": "Exactement", "Matches regex": "Correspond à la regex",
    "Min clicks": "Clics minimum", "Min impressions": "Impressions minimum", "Position from": "Position de", "Position to": "Position jusqu'à",
    "Filter queries": "Filtrer les requêtes", "Filter pages": "Filtrer les pages", "How the text matches": "Comment le texte correspond", "More filters": "Plus de filtres", "Clear filters": "Effacer les filtres",
    "No queries match these filters.": "Aucune requête ne correspond à ces filtres.", "No pages match these filters.": "Aucune page ne correspond à ces filtres.",
    "That pattern isn't valid.": "Cette expression n'est pas valide.", "Filters take numbers.": "Les filtres prennent des nombres.", "Filter too long.": "Filtre trop long.",
    "Usual rate": "Taux habituel", "Pages sharing it": "Pages qui la partagent", "pos.": "pos.", "Pos.": "Pos.", "Share": "Part", "Country": "Pays", "Query": "Requête",
    "Shares of impressions.": "Parts des impressions.",
    "clicks": "clics", "impressions": "impressions", "Countries: Google didn't answer.": "Pays : Google n'a pas répondu.",
    "Clicks, day by day": "Clics, jour par jour", "Position, day by day (higher is better)": "Position, jour par jour (plus haut, c'est mieux)", "Create task": "Créer une tâche",
    "Searches containing any of these count as brand. Case and accents ignored.": "Les recherches contenant l'un de ces mots comptent comme marque. Majuscules et accents ignorés.",
    "All my sites": "Tous mes sites", "No brand words yet.": "Pas encore de mots de marque.", "Add a brand word": "Ajouter un mot de marque", "Company or site name": "Nom de la société ou du site", "Add": "Ajouter",
    "Brand word added": "Mot de marque ajouté", "Brand word removed": "Mot de marque retiré",
    "Mark a change, like new titles, to see what followed.": "Marquez un changement, comme de nouveaux titres, pour voir la suite.",
    "Day": "Jour", "Note": "Note", "Save note": "Enregistrer la note", "Note added": "Note ajoutée", "Note deleted": "Note supprimée", "Add a note": "Ajouter une note",
    "Saved here": "Enregistré ici", "Last 28 days, checked": "28 derniers jours, vérifiés", "Clicks / impressions.": "Clics / impressions.", "Days": "Jours",
    "Google changed some days after saving. Reading them again fixes it.": "Google a modifié certains jours après leur enregistrement. Les relire corrige cela.",
    "Every day matches. Google's range totals differ from its days; a new pull can't change that.": "Chaque jour correspond. Les totaux de Google sur une période diffèrent de ses jours ; une nouvelle lecture n'y change rien.",
    "Read those days again": "Relire ces jours", "Includes not-final days": "Inclut des jours provisoires", "These are the last saved numbers.": "Voici les derniers chiffres enregistrés.", "Open the Google connection": "Ouvrir la connexion Google", "From": "Du", "To": "Au", "Period": "Période", "Compare with": "Comparer avec", "Reading…": "Lecture…",
    "Hour by hour": "Heure par heure", "Week by week": "Semaine par semaine", "Day by day": "Jour par jour",
    "Tables below show the last 2 whole days.": "Les tableaux ci-dessous montrent les 2 derniers jours entiers.",
    "Search Console data updated.": "Données Search Console à jour.", "Add it in Keywords.": "Ajoutez-le dans Mots-clés.",
    "It matches Search Console.": "C'est identique à la Search Console.", "It differs from Search Console. See the warning.": "Cela diffère de la Search Console. Voir l'alerte.",
    "Re-reading those days. Updates here when done.": "Relecture de ces jours. Mise à jour ici une fois terminé.",
    "Already a brand word.": "Déjà un mot de marque.", "That note is already on that day.": "Cette note existe déjà ce jour-là.", "Type what the rule should match.": "Indiquez ce que la règle doit reconnaître.",
    "Type a short note, up to 300 characters.": "Saisissez une note courte, 300 caractères au plus.", "Pick one site for a note.": "Choisissez un site pour la note.",
    // Simpler screens (2026-11-12): the head's chip and its check panel.
    "Search Console · live": "Search Console · en direct", "Search Console · differs": "Search Console · diffère", "Search Console · saved data": "Search Console · données enregistrées",
    "Search Console check": "Vérification Search Console", "Not compared with Search Console yet.": "Pas encore comparé avec la Search Console.",
  };
  Object.keys(words).forEach((w) => { if (window.FR[w] === undefined) window.FR[w] = words[w]; });
})();
