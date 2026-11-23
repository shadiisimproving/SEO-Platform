/* The screens fed only from real data: Overview, Channels, Conversions, Content, AI search, Google Ads and Resources.
   Each asks the server when opened. Empty always says why and what to do. Opened as a plain file there's no data, and it says that. */
(() => {
  "use strict";
  let UI = null, t, esc, num, icon;
  const LV = (window.LV = { cache: new Map(), chartData: new Map(), tables: new Map() });
  const CHANNEL_SLOTS = { "Organic Search": 1, Direct: 2, Referral: 3, "Organic Social": 4, "Paid Search": 5 };
  const colourOf = (name) => {
    if (name === "Other") return "var(--ch-other)";
    if (CHANNEL_SLOTS[name]) return `var(--ch-${CHANNEL_SLOTS[name]})`;
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `var(--ch-${(h % 5) + 1})`; // the same name always gets the same colour, whatever else is on the chart
  };

  // ---- asking the server ----------------------------------------------------------------------
  // "38.5%" in English, "38,5 %" in French: the language's own way, never built by hand.
  const pct = (v, digits = 1) => (v === null || v === undefined ? "—" : new Intl.NumberFormat(UI.locale(), { style: "percent", maximumFractionDigits: digits }).format(v));
  const shortDay = (day) => new Intl.DateTimeFormat(UI.locale(), { day: "numeric", month: "short" }).format(new Date(`${day}T00:00:00`));
  const dayDate = (d) => { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const shift = (day, by) => { const d = new Date(`${day}T00:00:00`); d.setDate(d.getDate() + by); return dayDate(d); };

  /* The app's one date range (UI.range), as days. The server trims an end past its last day and answers the dates it used. */
  function periodQuery(route) {
    const parts = [UI.range.days(route ? { route } : undefined)];
    const site = UI.siteIdPicked();
    if (site) parts.push(`site_id=${site}`);
    return parts.join("&");
  }

  /* What a screen has now. The first call fetches and redraws when the answer comes, so a page never waits on a blank. */
  function load(name, extra = "") {
    const key = `${name}?${periodQuery()}${extra}`;
    // The simpler screens keep answers 5 minutes and fetch the next screens quietly (screen-data.js); off, LV's own cache as before.
    if (window.SCREEN_DATA?.on()) return window.SCREEN_DATA.entry(key);
    const held = LV.cache.get(key);
    if (held) return held;
    const entry = { loading: true };
    LV.cache.set(key, entry);
    window.COMP.api("GET", key).then((data) => { entry.loading = false; entry.data = data; })
      .catch((err) => { entry.loading = false; entry.error = err.message; entry.noServer = err.message === "Not in the sample data."; })
      .finally(() => { if (UI.state.route === entry.route && !UI.$("#panel")) UI.render(); });
    entry.route = UI.state.route;
    return entry;
  }
  const forget = () => { LV.cache.clear(); if (window.SCREEN_DATA?.on()) window.SCREEN_DATA.forget(); };
  LV.forget = forget;
  window.addEventListener("seocc:site-added", () => forget()); // an answer from before said "No site yet"

  // ---- states ---------------------------------------------------------------------------------
  const loadingCard = () => UI.skeleton("page");
  // An empty period always offers the way out: a longer period, one click (UI.longerPeriodButton, mockup.js).
  const emptyCard = (title, body, action = "") => {
    const act = action || (title === t("No data in this period.") && UI.longerPeriodButton ? UI.longerPeriodButton() : "");
    return `<section class="card"><div class="empty"><h3>${esc(title)}</h3><p>${body}</p>${act ? `<div style="margin-top:12px">${act}</div>` : ""}</div></section>`;
  };
  const connectBtn = (id, word = "Connect") => `<button class="btn btn-main" data-lv-connect="${id}">${t(word)}</button>`;
  const NAMES = { gsc: "Search Console", ga4: "Google Analytics" };

  function stateCard(entry, source) {
    if (entry.loading) return loadingCard();
    if (entry.noServer) return emptyCard(t("Needs the running app"), t("Opened as a file: no real data."));
    if (entry.error) return UI.failCard(entry.error, { retry: "data-lv-retry" });
    const name = t(NAMES[source]);
    const d = entry.data;
    /* Numbers saved before the source was disconnected or broke stay on screen, with a note saying so, like Overview does.
       Before, Channels said "not connected" over 6,000 saved visits that Today was counting ("2 of 3 sites"). */
    const saved = Boolean(d.channels?.length || d.sessions || d.totals || d.pages?.length || d.rows?.length);
    if (saved && ["not_connected", "not_used", "failing"].includes(d.state)) {
      const why = d.state === "failing" ? `${name}: ${t("stopped working")}` : `${name}: ${t("not connected now")}`;
      LV.savedNote = `<p class="note warn lv-saved-note" role="status">${icon("clock")}<span>${esc(why)}. ${t("These are the numbers saved before.")}</span>${connectBtn("google", d.state === "failing" ? "Fix" : "Connect").replace("btn btn-main", "btn btn-small")}</p>`;
      return "";
    }
    if (d.state === "no_sites") return emptyCard(t("No site yet"), t("Add a site to see its data."), `<button class="btn btn-main" id="site-switch-hint" data-lv-add-site>${t("Add a site")}</button>`);
    if (d.state === "not_connected") return emptyCard(`${name}: ${t("not connected")}`, t("Connect it in Settings and pick this site's property."), connectBtn("google"));
    if (d.state === "not_used") return emptyCard(`${name}: ${t("not used")}`, t("This site doesn't use it, as you said. Change that in Settings."), connectBtn("google", "Open Settings"));
    if (d.state === "failing") {
      // The plain sentence and what to do first; Google's own long message folds away below.
      const fix = window.FIX?.html(d.error || "", { tool: name, retry: "refresh" }, { summary: true, said: true }) || esc(d.error || "");
      return `<section class="card"><div class="empty"><h3>${esc(`${name}: ${t("stopped working")}`)}</h3>${fix}<div style="margin-top:12px">${connectBtn("google", "Fix")}</div></div></section>`;
    }
    if (d.state === "waiting") return emptyCard(t("Connected. Waiting for data"), t("Arrives after the next run. Refresh data starts one now."), refreshBtn(true));
    return "";
  }

  const readingWord = () => fillIn(t("Reading {done} of {total}…"), LV.reading);
  const refreshBtn = (main = false) => `<button class="btn ${main ? "btn-main" : ""}" data-lv-collect ${LV.reading ? "disabled" : ""}>${icon("refresh-cw")}<span data-lv-collect-word>${LV.reading ? esc(readingWord()) : t("Refresh data")}</span></button>`;
  const fillIn = (text, values) => text.replace(/\{(\w+)\}/g, (_, k) => String(values?.[k] ?? ""));

  /* Refresh data only queues reads; a worker runs them (cron each minute on hosting). So the screen follows the reads
     until they finish, then redraws: before, it looked once after 6 seconds, usually too early, and kept the old answer. */
  const POLL_MS = 3000, POLL_LIMIT_MS = 180000, OVER = new Set(["done", "dead", "waiting"]);
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  function showReading() {
    document.querySelectorAll("[data-lv-collect]").forEach((b) => { b.disabled = !!LV.reading; });
    document.querySelectorAll("[data-lv-collect-word]").forEach((w) => { w.textContent = LV.reading ? readingWord() : t("Refresh data"); });
  }
  async function watchReads(answers, { redraw = true } = {}) {
    const entries = answers.flatMap((a) => a.jobs || []);
    const ids = [...new Set(entries.map((e) => e.job_id).filter(Boolean))];
    const clarityLater = entries.some((e) => e.skipped === "clarity_daily");
    // A full Refresh data also starts a read of my site's pages (owner, 2026-11-10); it runs on its own, so every message after it says so.
    // DuckDuckGo positions too (owner, 2026-11-11): they have no site-owner tool, so Refresh data starts a free check of them.
    const pagesNote = (answers.some((a) => a.pages) ? ` ${t(PAGES_NOTE)}` : "") + (answers.some((a) => a.rankings) ? ` ${t(DDG_NOTE)}` : "");
    const laterNote = (clarityLater ? ` ${t("Clarity already read today. Next read after midnight UTC.")}` : "") + pagesNote;
    if (!ids.length) {
      UI.toast(pagesNote ? laterNote.trim() : t("Nothing to read: connect a data source, or it's already running.") + laterNote, { kind: pagesNote ? "good" : "info" });
      return;
    }
    UI.toast(t("Reading the latest data…") + pagesNote, { kind: "good" });
    LV.reading = { done: 0, total: ids.length };
    // Each read's own state, so a screen can show Queued → Reading… → ✓ beside its source (AI search's chips).
    LV.readingJobs = entries.filter((e) => e.job_id).map((e) => ({ id: e.job_id, source: e.source, status: "queued" }));
    document.dispatchEvent(new CustomEvent("seocc:reading"));
    showReading();
    const began = Date.now();
    let states = [];
    while (Date.now() - began < POLL_LIMIT_MS) {
      await sleep(POLL_MS);
      try { states = (await window.COMP.api("GET", `collect-jobs?ids=${ids.join(",")}`)).jobs; } catch { continue; }
      // A job missing from the answer was cleaned away, so it's over too.
      LV.reading.done = ids.length - states.filter((s) => !OVER.has(s.status)).length;
      LV.readingJobs = states;
      document.dispatchEvent(new CustomEvent("seocc:reading"));
      showReading();
      if (LV.reading.done >= ids.length) break;
    }
    const finished = LV.reading.done >= ids.length;
    const failed = states.filter((s) => s.error);
    LV.reading = null; LV.readingJobs = null;
    showReading();
    if (redraw) { forget(); if (!UI.$("#panel")) UI.render(); }
    if (!finished) { UI.toast(t("Still reading in the background. Press Refresh data again in a few minutes.") + laterNote, { kind: "info" }); return; }
    if (failed.length) {
      // Which source failed and why, in the message itself, with the button that opens its connection.
      const why = failed.map((s) => { const name = t(SOURCE_NAMES[s.source] || s.source), plain = window.FIX?.explain?.(s.error, { tool: name, retry: "refresh" })?.summary; return `${name}: ${t(plain || UI.errorWords(s.error))}`; });
      const google = failed.some((s) => ["gsc", "ga4", "pagespeed"].includes(s.source));
      UI.toast(`${fillIn(t("{ok} of {total} read."), { ok: ids.length - failed.length, total: ids.length })} ${[...new Set(why)].join(" ")}${laterNote}`, { kind: "crit", stay: true, undo: () => UI.openConnection(google ? "google" : failed[0].source), undoLabel: t("Fix it") });
      return;
    }
    const read = [...new Set(entries.filter((e) => e.job_id).map((e) => t(SOURCE_NAMES[e.source] || e.source)))];
    UI.toast((read.length ? fillIn(t("Updated: {names}."), { names: read.join(", ") }) : t("Up to date.")) + laterNote, { kind: "good" });
  }
  const PAGES_NOTE = "Your pages are being read too, 3 seconds apart.";
  LV.PAGES_NOTE = PAGES_NOTE;
  const DDG_NOTE = "DuckDuckGo positions are being checked too, on free searches. They show on Keywords when it finishes.";
  LV.DDG_NOTE = DDG_NOTE;
  const SOURCE_NAMES = { gsc: "Search Console", ga4: "Google Analytics", bing: "Bing Webmaster", yandex: "Yandex Webmaster", clarity: "Microsoft Clarity", pagespeed: "PageSpeed Insights" };
  LV.watchReads = watchReads;
  /* A short note the server sends after the dates, and the full sentence behind its (i). */
  const EXTRA_TIPS = { "Lags 2–3 days": "Search Console lags 2 to 3 days and counts days in Pacific time." };
  /* Both periods in words, from the dates the server really used, then how far the data goes. */
  const throughNote = (through, extra = "", d = null) => {
    const p = d?.period, bits = [];
    if (p?.from && p?.to) bits.push(`${esc(UI.fmtRange(p.from, p.to))}${p.compare_from && p.compare_to ? ` ${t("vs")} ${esc(UI.fmtRange(p.compare_from, p.compare_to))}` : ""}`);
    if (through) { bits.push(`${t("Data through")} ${esc(shortDay(through))}`); UI.range.end(UI.state.route, through); }
    if (extra) bits.push(`${esc(t(extra))}${UI.tip(EXTRA_TIPS[extra] || "")}`);
    return bits.length ? `<span class="small muted">${bits.join(" · ")}</span>` : "";
  };
  const hiddenNote = (hid) => (hid ? `<p class="note lv-note">${icon("info")}<span>${t("Google Analytics hid rows with few visits.")}${UI.tip("Google Analytics hid some rows with few visits, so small numbers may be missing. A longer period may show them.")}</span></p>` : "");

  const change = (now, before, opts = {}) => {
    if (before === null || before === undefined || now === null || now === undefined) return "";
    const good = opts.lowerIsBetter ? now < before : now > before;
    if (before === 0) return `<span class="ab">${num(before)} → ${num(now)}</span>`;
    const percent = Math.round(((now - before) / before) * 100);
    if (percent === 0) return `<span class="ab">${t("No change")}</span>`;
    return `<span class="${good ? "good" : "crit"} d-pill">${icon(percent > 0 ? "arrow-up" : "arrow-down")}${percent > 0 ? "+" : "−"}${num(Math.abs(percent))}% ${t(good ? "better" : "worse")}</span> <span class="ab">${opts.fmt ? opts.fmt(before) : num(before)} → ${opts.fmt ? opts.fmt(now) : num(now)}</span>`;
  };
  const decimal = (v) => (v === null || v === undefined ? "—" : UI.dec(v));

  // ---- line chart: one axis, gaps stay gaps, hover and keyboard read-out, and a table view --------
  LV.lineChart = lineChart;
  /* Which points get a date under them: evenly spaced, counted back from the last point so it always has its date, at most
     `most` of them. Each date then sits under its own point (axisHtml), never spread evenly whatever the gaps. */
  LV.axisTicks = (count, most = 6) => {
    if (count <= 0) return [];
    if (count === 1) return [0];
    const step = Math.max(1, Math.ceil((count - 1) / (most - 1)));
    const out = [];
    for (let i = count - 1; i >= 0; i -= step) out.unshift(i);
    return out;
  };
  /* ticks: [[index, words]]. Placed at index / (count − 1) of the width, as the line's own points are; the first and last
     are held inside the chart. */
  LV.axisHtml = (ticks, count) => `<div class="lv-axis lv-axis-placed" aria-hidden="true">${ticks.map(([i, words]) => {
    const at = count <= 1 ? 0.5 : i / (count - 1);
    const edge = at <= 0.04 ? " first" : at >= 0.96 ? " last" : "";
    const safe = String(words ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    return `<span class="lv-tick${edge}" style="left:${(at * 100).toFixed(2)}%">${safe}</span>`;
  }).join("")}</div>`;
  /* marks: { day: count } draws a dot on the first line for those days, such as a lead in that week; markName names it in the
     read-out. dayLabel: how a day reads in the read-out and the table, such as "Week to 9 Nov". */
  function lineChart(id, days, series, { invert = false, unit = "", legend = true, marks = null, markName = "Leads", dayLabel = null } = {}) {
    if (!days.length) return `<div class="empty"><p>${t("No data in this period.")}</p>${UI.longerPeriodButton ? UI.longerPeriodButton() : ""}</div>`;
    const all = series.flatMap((s) => days.map((d) => s.values[d]).filter((v) => v !== null && v !== undefined));
    const top = Math.max(...all, 1), low = invert ? Math.min(...all, 1) : 0;
    const W = 1000, H = 200;
    const x = (i) => (days.length === 1 ? W / 2 : (i / (days.length - 1)) * W);
    const y = (v) => (invert ? ((v - low) / (top - low || 1)) * H : H - (v / top) * H);
    const paths = series.map((s) => {
      let d = "", pen = false;
      days.forEach((day, i) => {
        const v = s.values[day];
        if (v === null || v === undefined) { pen = false; return; }
        d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      const single = days.length === 1 && s.values[days[0]] !== undefined ? `<circle cx="${x(0)}" cy="${y(s.values[days[0]])}" r="4" fill="${s.color}"/>` : "";
      // A point with a gap on both sides has no line to sit on, so it would not show at all: it gets a round dot of its own.
      const has = (i) => s.values[days[i]] !== null && s.values[days[i]] !== undefined;
      const lone = days.length === 1 ? "" : days.map((day, i) => (has(i) && !has(i - 1) && !has(i + 1) ? `<path class="lv-line lv-lone" d="M${x(i).toFixed(1)},${y(s.values[day]).toFixed(1)}h0" stroke="${s.color}"/>` : "")).join("");
      return `<path class="lv-line" d="${d}" stroke="${s.color}"${s.dash ? ' stroke-dasharray="5 5"' : ""}/>${single}${lone}`;
    }).join("");
    const grid = [0, .5, 1].map((f) => `<line class="lv-grid" x1="0" x2="${W}" y1="${f * H}" y2="${f * H}"/>`).join("");
    // Dots sit over the chart in HTML: inside the stretched SVG a circle would turn into an oval.
    const dots = marks ? days.map((day, i) => (marks[day] && series[0]?.values[day] !== null && series[0]?.values[day] !== undefined ? `<span class="lv-mark" aria-hidden="true" style="left:calc(18px + ${(x(i) / W).toFixed(4)} * (100% - 36px));top:calc(14px + ${(y(series[0].values[day]) / H).toFixed(4)} * var(--lv-h, 220px))"></span>` : "")).join("") : "";
    const label = (v) => `${num(top >= 20 ? Math.round(v) : Math.round(v * 10) / 10)}${unit}`;
    const labels = invert ? [[0, low], [100, top]] : [[0, top], [50, top / 2], [100, 0]];
    const ticks = LV.axisTicks(days.length); // indexes: each date under its own point (2 and 9 Nov used to vanish)
    LV.chartData.set(id, { days, series, W, unit, marks, markName, dayLabel });
    const dayName = (day) => (dayLabel ? dayLabel(day) : shortDay(day));
    const open = LV.tables.get(id);
    // The table view has pages like every long table (table-pages.js): a year of days is 365 rows.
    const tableKey = `lv-chart-${id}`, tableView = open ? window.TP.view(tableKey, days) : null;
    if (open) window.TP.on(tableKey, () => UI.render());
    const table = !open ? "" : `<table class="data"><thead><tr><th>${t("Date")}</th>${series.map((s) => `<th class="c">${esc(t(s.name))}</th>`).join("")}${marks ? `<th class="c">${esc(t(markName))}</th>` : ""}</tr></thead><tbody>${tableView.rows.map((day) => `<tr><td data-label="${t("Date")}">${esc(dayName(day))}</td>${series.map((s) => `<td class="c" data-label="${esc(t(s.name))}">${s.values[day] === null || s.values[day] === undefined ? "—" : num(s.values[day])}</td>`).join("")}${marks ? `<td class="c" data-label="${esc(t(markName))}">${num(marks[day] || 0)}</td>` : ""}</tr>`).join("")}</tbody></table>`;
    return `<div class="lv-chart" data-lv-chart="${id}" tabindex="0" role="img" aria-label="${t("Chart")}: ${esc(series.map((s) => t(s.name)).join(", "))}. ${t("Use the arrow keys to read each day.")}">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${grid}${paths}<line class="lv-cross" x1="0" x2="0" y1="0" y2="${H}" hidden/></svg>${dots}
        ${labels.map(([pos, v]) => `<span class="lv-ylab" style="top:calc(14px + ${pos / 100} * var(--lv-h, 220px))">${label(v)}</span>`).join("")}
        <div class="lv-tip" hidden></div>
        ${LV.axisHtml(ticks.map((i) => [i, shortDay(days[i])]), days.length)}
      </div>
      ${series.length > 1 && legend ? `<div class="lv-legend">${series.map((s) => `<span><i class="lv-key" style="background:${s.color}"></i>${esc(t(s.name))}</span>`).join("")}</div>` : ""}
      <div class="lv-foot"><button class="link-btn" data-lv-table="${id}" aria-expanded="${open ? "true" : "false"}">${t(open ? "Hide table" : "Show table")}</button></div>
      ${open ? `<div class="table-wrap lv-chart-table">${table}</div>${window.TP.footer(tableKey, tableView)}` : ""}`;
  }

  function moveCross(box, index) {
    const info = LV.chartData.get(box.dataset.lvChart);
    if (!info) return;
    const i = Math.max(0, Math.min(info.days.length - 1, index));
    box.dataset.at = i;
    const svg = box.querySelector("svg"), cross = box.querySelector(".lv-cross"), tip = box.querySelector(".lv-tip");
    const xSvg = info.days.length === 1 ? info.W / 2 : (i / (info.days.length - 1)) * info.W;
    cross.removeAttribute("hidden"); cross.setAttribute("x1", xSvg); cross.setAttribute("x2", xSvg);
    const day = info.days[i];
    const markLine = info.marks ? `<div><span><i class="lv-key lv-key-dot"></i>${esc(t(info.markName))}</span><span>${num(info.marks[day] || 0)}</span></div>` : "";
    UI.setHTML(tip, `<b>${esc(info.dayLabel ? info.dayLabel(day) : shortDay(day))}</b>${info.series.map((s) => `<div><span><i class="lv-key" style="background:${s.color}"></i>${esc(t(s.name))}</span><span>${s.values[day] === null || s.values[day] === undefined ? "—" : num(s.values[day])}${info.unit}</span></div>`).join("")}${markLine}`);
    tip.hidden = false;
    const rect = svg.getBoundingClientRect(), left = (xSvg / info.W) * rect.width + 18;
    const room = box.clientWidth - tip.offsetWidth - 8;
    tip.style.left = `${Math.max(8, Math.min(room, left + 12 > room ? left - tip.offsetWidth - 12 : left + 12))}px`;
  }

  // ---- bars and tables --------------------------------------------------------------------------
  const bars = (rows, { value = (r) => r.value, label = (r) => r.label, fmt = num } = {}) => {
    const max = Math.max(...rows.map(value), 1);
    return `<div class="lv-bars">${rows.map((r) => `<div class="lv-bar"><span class="lab" dir="auto">${esc(label(r))}</span><span class="track"><i style="width:${Math.max(value(r) ? 2 : 0, (value(r) / max) * 100)}%"></i></span><span class="val">${fmt(value(r))}</span></div>`).join("")}</div>`;
  };

  /* columns: { key, label, num, get, html }. Sort is kept per table, and blanks always sort last.
     Pages of 25, 50 or 100 rows and, past 25 rows, a search through the table's words (search: its placeholder), the same as
     every long table in the app (table-pages.js). */
  const SORTS = new Map();
  const pagesKey = (id) => `lv-${id}`;
  /* rowAttrs(row): the row's own attributes, such as data-rp-open for its side panel (simpler screens); wrapAttrs: the table's
     box's, such as data-tt-own-count; compact: the table as wide as its words, the numbers right beside them. */
  function dataTable(id, columns, rows, { csv = false, empty = "Nothing in this period.", search = "Search table", rowAttrs = null, wrapAttrs = "", compact = false } = {}) { // downloads are the Export button in the top bar (export.js)
    if (!rows.length) return `<div class="empty"><p>${t(empty)}</p></div>`;
    const TP = window.TP, key = pagesKey(id);
    TP.on(key, () => UI.render());
    const sort = SORTS.get(id);
    const value = (col, row) => (col.get ? col.get(row) : row[col.key]);
    const words = columns.filter((c) => !c.num);
    // The box stays while a search is typed in it, even if the period changed and fewer rows came back.
    const box = rows.length > 10 || TP.state(key).q ? /* more than 10 rows, as on every table */ `<div class="lv-tools">${TP.search(key, t(search))}</div>` : "";
    let shown = box ? rows.filter((row) => TP.matches(key, ...words.map((c) => value(c, row)))) : rows;
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      shown = [...shown].sort((a, b) => {
        const x = value(col, a), y = value(col, b);
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        const order = typeof x === "number" ? x - y : String(x).localeCompare(String(y), UI.state.lang);
        return sort.dir === "asc" ? order : -order;
      });
    }
    const view = TP.view(key, shown);
    const head = columns.map((c) => {
      const on = sort?.key === c.key;
      return `<th class="${c.num ? "c" : ""}" scope="col" aria-sort="${on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}"><button class="th-btn" data-lv-sort="${id}" data-key="${c.key}" ${UI.def(c.label) ? `data-tip="${esc(UI.def(c.label))}"` : ""}>${esc(t(c.label))}${on ? icon(sort.dir === "asc" ? "arrow-up" : "arrow-down") : ""}</button></th>`;
    }).join("");
    LV.chartData.set(`table-${id}`, { columns, rows: shown });
    if (!shown.length) return `${box}<div class="empty"><p>${t("Nothing matches.")}</p></div>`;
    const body = view.rows.map((row) => `<tr ${(rowAttrs && rowAttrs(row)) || 'style="cursor:default"'}>${columns.map((c) => {
      const v = value(c, row);
      return `<td class="${c.num ? "c" : ""}" data-label="${esc(t(c.label))}">${c.html ? c.html(row) : v === null || v === undefined ? `<span class="muted">—</span>` : c.num ? num(v) : esc(v)}</td>`;
    }).join("")}</tr>`).join("");
    return `${box}<div class="table-wrap${compact ? " lv-compact" : ""}" style="box-shadow:none"${wrapAttrs ? ` ${wrapAttrs}` : ""}><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${TP.footer(key, view)}
      ${csv ? `<div class="lv-foot"><button class="link-btn end" data-lv-csv="${id}">${icon("download")}${t("Download CSV")}</button></div>` : ""}`;
  }

  function downloadCsv(id) {
    const info = LV.chartData.get(`table-${id}`);
    if (!info) return;
    const cell = (v) => { const s = v === null || v === undefined ? "" : String(v); return /^[=+\-@\t\r]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [info.columns.map((c) => cell(t(c.label))).join(","), ...info.rows.map((row) => info.columns.map((c) => cell(c.get ? c.get(row) : row[c.key])).join(","))];
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`﻿${lines.join("\n")}`], { type: "text/csv;charset=utf-8" }));
    link.download = `${id}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  const rateCell = (r) => pct(r.rate);
  const topbarFor = (title, sub, entry) => UI.topbar(t(title), t(sub), entry?.data && !["no_sites", "not_connected", "not_used"].includes(entry.data.state) ? refreshBtn() : "");
  const page = (head, body) => {
    const note = LV.savedNote || ""; LV.savedNote = ""; // stateCard's note for saved numbers goes on top of this page only
    return `${head}<div class="content page-enter${UI.simple?.() ? " lv-page" : ""}">${note}${body}</div>`;
  };
  /* On All sites, /contact/ can be on several sites, so a page row says whose it is. It sorts and exports that way too. */
  const siteOfPage = (r) => (!UI.siteHostPicked() && r.host ? `<div class="lv-cat mono" dir="auto">${esc(r.host)}</div>` : "");
  const pageName = (r) => (!UI.siteHostPicked() && r.host ? `${r.host}${r.path}` : r.path);
  /* GA4's "(not set)" isn't a page of the site (owner, 2026-11-12): the server sends it last, marked unknown, and it reads as
     words with its reason, never as a link to "/(not set)/". */
  const UNKNOWN_TIP = "Google Analytics couldn't tell which page these visits landed on, often visits that left before the page loaded.";
  const unknownPage = (r) => `<span class="lv-unknown" dir="auto">${t("Unknown page (not set)")}</span>${UI.simple?.() && UI.info ? UI.info(UNKNOWN_TIP) : UI.tip(UNKNOWN_TIP)}${siteOfPage(r)}`;
  /* Where a table's numbers come from and for which days, said in its card head, so two tables that count the same page
     differently (Google Analytics for the period picked, a Clarity download for its own) never clash unexplained. */
  const sourceAndDays = (source) => { const g = UI.range.get(); return `${esc(t(source))} · ${esc(UI.fmtRange(g.from, g.to))}`; };
  /* Social networks, one row per network with its logo; the ways GA4 wrote it are the name's tip (m.facebook.com, meta…). */
  const socialBars = (rows) => {
    const max = Math.max(...rows.map((r) => r.sessions), 1);
    return `<div class="lv-bars">${rows.map((r) => {
      const ways = (r.sources || []).filter((x) => x && x !== r.source);
      return `<div class="lv-bar"><span class="lab with-logo">${r.domain ? UI.siteLogo(r.domain, 16) : ""}<span class="logo-text" dir="auto"${ways.length ? ` data-tip="${esc(ways.join(", "))}"` : ""}>${esc(t(r.source))}</span></span><span class="track"><i style="width:${Math.max(r.sessions ? 2 : 0, (r.sessions / max) * 100)}%"></i></span><span class="val">${num(r.sessions)}</span></div>`;
    }).join("")}</div>`;
  };

  // ---- Overview ---------------------------------------------------------------------------------
  const METRICS = [["clicks", "Clicks"], ["impressions", "Impressions"], ["position", "Average position"]];
  let overviewMetric = "clicks";
  function overviewPage() {
    const entry = load("metrics/overview");
    const blocked = stateCard(entry, "gsc");
    const head = topbarFor("Overview", "Your Google results, from Search Console", entry);
    if (blocked) return page(head, blocked);
    const d = entry.data, now = d.totals, before = d.before;
    if (!now) return page(head, emptyCard(t("No data in this period."), `${t("Search Console has data through")} ${esc(d.through ? shortDay(d.through) : "—")}. ${t("Pick a longer or earlier period.")}`));
    const tileRow = `<section class="tiles">
      ${UI.tile(t("Clicks"), UI.cnt(now.clicks), change(now.clicks, before?.clicks), { ic: "mouse-pointer-click" })}
      ${UI.tile(t("Impressions"), UI.cnt(now.impressions), change(now.impressions, before?.impressions), { ic: "eye" })}
      ${UI.tile(t("Click rate"), pct(now.click_rate), change(now.click_rate, before?.click_rate, { fmt: pct }), { ic: "percent" })}
      ${UI.tile(t("Average position"), decimal(now.position), change(now.position, before?.position, { lowerIsBetter: true, fmt: decimal }), { ic: "arrow-up-narrow-wide" })}
      ${UI.tile(t("Ranking queries"), UI.cnt(d.queries), `<span class="ab">${t("in this period")}</span>`, { ic: "key-round" })}
    </section>`;
    const days = d.series.map((r) => r.day);
    const values = Object.fromEntries(d.series.map((r) => [r.day, r[overviewMetric]]));
    const chart = `<section class="card"><div class="card-head"><h2>${t("Last 12 months")}</h2>
        <span class="seg end" role="group" aria-label="${t("Chart")}">${METRICS.map(([id, name]) => `<button data-lv-metric="${id}" aria-pressed="${overviewMetric === id}">${t(name)}</button>`).join("")}</span></div>
        ${lineChart("overview", days, [{ name: METRICS.find(([id]) => id === overviewMetric)[1], color: "var(--ch-1)", values }], { invert: overviewMetric === "position" })}</section>`;
    const move = (r) => `<span class="${r.change > 0 ? "good" : "crit"} d-pill">${icon(r.change > 0 ? "arrow-up" : "arrow-down")}${r.change > 0 ? "+" : "−"}${num(Math.abs(r.change))}</span>`;
    const moves = (id, rows, word) => dataTable(id, [
      { key: "query", label: "Query", html: (r) => `<span class="mono" dir="auto">${esc(r.query)}</span>` },
      { key: "clicks", label: "Clicks", num: true },
      { key: "change", label: "Change", num: true, html: move },
    ], rows, { csv: false, empty: word, search: "Search queries" });
    const compareOff = UI.range.get().compare === "none";
    return page(head, `
      <p class="small muted" style="margin:0 0 12px">${throughNote(d.through, d.lag_note, d)}</p>
      ${tileRow}${chart}
      <div class="lv-two">
        <section class="card"><div class="card-head"><h2>${t("Queries gaining clicks")}</h2></div>${compareOff ? `<div class="empty"><p>${t("Pick a comparison above.")}</p></div>` : moves("gaining", d.gaining, "No query gained clicks.")}</section>
        <section class="card"><div class="card-head"><h2>${t("Queries losing clicks")}</h2></div>${compareOff ? `<div class="empty"><p>${t("Pick a comparison above.")}</p></div>` : moves("losing", d.losing, "No query lost clicks.")}</section>
      </div>
      <section class="card" style="margin-top:14px"><div class="card-head"><h2>${t("Queries by position")}</h2></div>${bars(d.distribution, { value: (r) => r.queries, label: (r) => r.bucket })}</section>
      ${speedCard()}${ideasCard()}`);
  }

  /* PageSpeed columns, the same on every screen (expert review 2026-11-17): the score is always Google's lab test, so it says
     so; the timings are real visitors' when Google has them, and the last column says whose (this page or the whole site)
     with Google's own verdict, Passed or Failed. A run with no real visitors says "Lab test only". */
  const speedVerdict = (r) => {
    if (!r.field) return `<span class="muted">${t("Lab test only")}</span>`;
    const whose = t(r.field === "site" ? "whole site" : "this page");
    const verdict = r.passed === true ? `<span class="good">${t("Passed")}</span>` : r.passed === false ? `<span class="crit">${t("Failed")}</span>` : "—";
    return `${verdict} <span class="small muted">${esc(whose)}</span>`;
  };
  const speedColumns = (ms) => [
    { key: "performance", label: "Lab score", num: true },
    { key: "lcp_ms", label: "Largest content (s)", num: true, get: (r) => ms(r.lcp_ms), html: (r) => (r.lcp_ms === null ? `<span class="muted">—</span>` : decimal(ms(r.lcp_ms))) },
    { key: "inp_ms", label: "Response (ms)", num: true },
    { key: "cls", label: "Layout shift", num: true, html: (r) => (r.cls === null ? `<span class="muted">—</span>` : decimal(Math.round(r.cls * 100) / 100)) },
    { key: "field", label: "Real visitors", get: (r) => (r.field ? `${r.passed === true ? t("Passed") : r.passed === false ? t("Failed") : ""} ${t(r.field === "site" ? "whole site" : "this page")}` : t("Lab test only")), html: speedVerdict },
  ];

  function speedCard() {
    const entry = load("metrics/speed");
    if (entry.loading || entry.error || !entry.data.runs.length) return "";
    const ms = (v) => (v === null || v === undefined ? null : Math.round(v / 100) / 10);
    return `<section class="card" style="margin-top:14px"><div class="card-head"><h2>${t("Page speed")}</h2><span class="end small muted">${t("Home page")}</span></div>${dataTable("speed", [
      { key: "host", label: "Site", html: (r) => `<span class="mono" dir="auto">${esc(r.host)}</span>` },
      { key: "strategy", label: "Device", get: (r) => t(r.strategy === "mobile" ? "Phone" : "Computer") },
      ...speedColumns(ms),
    ], entry.data.runs, { csv: false })}</section>`;
  }

  /* Keyword ideas. Keywords passes ctx: the site's keywords, to mark ideas already tracked, and the country and language
     they use most, picked until someone picks another on that site. Google answers for the country asked, else for where the app runs. */
  const ideas = { query: "", rows: null, error: "", picks: {}, asked: {} };
  const ideasCard = (ctx = {}) => {
    const market = ctx.market || {}, tracked = ctx.tracked || new Set();
    const pick = ideas.picks[UI.siteHostPicked() || "all"];
    const country = pick ? pick.country : market.country || "", language = pick ? pick.language : market.language || "";
    const isTracked = (word) => tracked.has(word.toLowerCase());
    const fresh = (ideas.rows || []).filter((word) => !isTracked(word));
    ideas.fresh = fresh; // what Add all adds
    const langName = (code) => {
      const lang = UI.state.lang === "fr" ? "fr" : "en";
      let name = code;
      try { name = new Intl.DisplayNames([lang], { type: "language" }).of(code) || code; } catch { /* the code itself */ }
      return name.charAt(0).toLocaleUpperCase(lang) + name.slice(1); // as the Language list writes it
    };
    const where = [ideas.asked.country ? UI.countryName(ideas.asked.country) : t("Any country"), ideas.asked.language ? langName(ideas.asked.language) : ""].filter(Boolean).join(" · ");
    const row = (word, i) => `<li><div class="what"><div class="t mono" dir="auto">${esc(word)}</div></div><div class="acts">${isTracked(word)
      ? `<span class="small muted lv-idea-tracked">${icon("check")}${t("Already tracked")}</span>`
      : `<button class="btn btn-small" data-lv-idea="${i}" aria-label="${esc(`${t("Add to my keywords")}: ${word}`)}">${icon("plus")}${t("Add")}</button>`}</div></li>`;
    return `<section class="card" style="margin-top:14px"><div class="card-head"><h2>${t("Keyword ideas")}</h2><span class="end small muted">${t("From Google's suggestions")}${UI.tip("Free and unofficial, so it can stop working.")}</span></div>
      <form class="lv-rule-form" data-lv-ideas style="border-top:0"><input class="input" name="f_q" dir="auto" value="${esc(ideas.query)}" placeholder="${t("A word or two")}" aria-label="${t("A word or two")}" autocomplete="off">
        <select class="select" name="f_country" aria-label="${t("Country")}"><option value="">${t("Any country")}</option>${UI.countryOptions(country)}</select>
        <select class="select" name="f_language" aria-label="${t("Language")}"><option value="">${t("Any language")}</option>${UI.languageOptions(language)}</select>
        <button class="btn btn-small" type="submit">${t("Find ideas")}</button></form>
      ${market.country || market.language ? `<p class="small muted" style="padding:0 18px 10px;margin:-4px 0 0">${t("Country and language start on the ones this site's keywords use most.")}</p>` : ""}
      ${ideas.error ? `<p class="error" style="padding:0 18px 12px;margin:0" role="alert">${esc(t(ideas.error))}</p>` : ""}
      ${ideas.rows ? (ideas.rows.length ? `<div class="lv-ideas-bar small muted"><span>${num(ideas.rows.length)} ${t("ideas")} · ${esc(where)}</span>${fresh.length > 1 ? `<button class="btn btn-small" data-lv-idea-all>${icon("plus")}${t("Add all")} (${num(fresh.length)})</button>` : ""}</div>
        <ul class="rows">${ideas.rows.map(row).join("")}</ul>` : `<div class="empty" style="padding:20px"><p>${t("No suggestions.")}</p></div>`) : ""}</section>`;
  };
  // Adding opens the usual Add keywords panel, with the country and language the ideas came from.
  const trackIdeas = (words, opener) => window.KW?.track(words, UI.siteHostPicked(), opener, { ...ideas.asked, why: "The country and language of these ideas." });

  // ---- Channels ---------------------------------------------------------------------------------
  function rulesCard(kind, title, hint, patternHint, valueHint, rules) {
    return `<section class="card" style="margin-top:14px"><div class="card-head"><h2>${t(title)}</h2></div>
      <p class="help" style="padding:10px 18px 2px;margin:0">${t(hint)}</p>
      ${rules.map((r) => `<div class="lv-rule"><span class="grow mono" dir="auto">${esc(r.pattern)}${r.value ? ` → ${esc(r.value)}` : ""}</span><button class="btn btn-small btn-ghost" data-lv-rule-del="${r.id}" aria-label="${t("Remove")}: ${esc(r.pattern)}">${t("Remove")}</button></div>`).join("")}
      <form class="lv-rule-form" data-lv-rule-form="${kind}"><input class="input mono" spellcheck="false" autocapitalize="off" name="f_pattern" placeholder="${esc(patternHint)}" aria-label="${t("Matches")}" autocomplete="off">${valueHint ? `<input class="input" name="f_value" placeholder="${esc(t(valueHint))}" aria-label="${t(valueHint)}" autocomplete="off">` : ""}<button class="btn btn-small" type="submit">${t("Add rule")}</button><span class="error" data-lv-rule-error hidden></span></form></section>`;
  }

  /* AI visits are their own channel, counted by AI search's rules (seo/metrics/service.py AI_CHANNEL): its row links there. */
  const AI_CHANNEL = "AI assistants";
  const aiLink = (name) => (name === AI_CHANNEL ? ` <a class="small lv-ai-link" href="#ai">${t("AI search")} →</a>` : "");

  function channelsPage() {
    if (simple()) return channelsSimple();
    const entry = load("metrics/channels");
    const blocked = stateCard(entry, "ga4");
    const head = topbarFor("Channels", "Visit and lead sources, from Google Analytics", entry);
    if (blocked) return page(head, blocked);
    const d = entry.data;
    if (!d.channels.length) return page(head, emptyCard(t("No data in this period."), `${t("Google Analytics has data through")} ${esc(d.through ? shortDay(d.through) : "—")}.`));
    const days = d.series.map((r) => r.day);
    const series = d.series_names.map((name) => ({ name, color: colourOf(name), values: Object.fromEntries(d.series.map((r) => [r.day, r.values[name] ?? 0])) }));
    const swatch = (name) => `<i class="lv-key" style="background:${colourOf(name)}"></i>${esc(t(name))}${aiLink(name)}`;
    // The server starts fetching these sites' icons when this data is asked for, so look for them once per list.
    const referrerList = d.referrers.map((r) => r.domain).join(",");
    if (referrerList !== LV.referrersWatched) { LV.referrersWatched = referrerList; window.COMP?.refreshLogos?.({ watch: true }); }
    return page(head, `
      <p class="small muted" style="margin:0 0 12px">${throughNote(d.through, "", d)}</p>${hiddenNote(d.hid_rows)}
      <section class="tiles">
        ${UI.tile(t("Visits"), UI.cnt(d.total.sessions), change((d.compared || d.total).sessions, d.before?.sessions), { ic: "activity" })}
        ${UI.tile(t(W("Leads", d)), num(d.total.leads), change((d.compared || d.total).leads, d.before?.leads), { ic: "filter" })}
        ${UI.tile(t(W("Lead rate", d)), pct(ratePct(d.total) === null ? null : ratePct(d.total) / 100), "", { ic: "percent" })}
        ${UI.tile(t("Channels"), UI.cnt(d.channels.length), "", { ic: "layers" })}
      </section>
      <section class="card"><div class="card-head"><h2>${t("Visits by channel")}</h2></div>${lineChart("channels", days, series)}</section>
      <section class="card" style="margin-top:14px"><div class="card-head"><h2>${t("Every channel")}</h2></div>${dataTable("channels", [
        { key: "channel", label: "Channel", html: (r) => swatch(r.channel) },
        { key: "sessions", label: "Visits", num: true },
        { key: "share", label: "Share", num: true, get: (r) => r.share, html: (r) => pct(r.share) },
        { key: "leads", label: W("Leads", d), num: true },
        { key: "rate", label: W("Lead rate", d), num: true, get: (r) => r.rate, html: rateCell },
        { key: "change", label: "Change", num: true, html: (r) => (r.change === null ? `<span class="muted">—</span>` : `<span class="${r.change >= 0 ? "good" : "crit"} d-pill">${r.change >= 0 ? "+" : "−"}${num(Math.abs(r.change))}%</span>`) },
      ], d.channels)}</section>
      <section class="card" style="margin-top:14px"><div class="card-head"><h2>${t("Referring sites")}</h2></div>${dataTable("referrers", [
        { key: "domain", label: "Site", html: (r) => `<span class="with-logo">${UI.siteLogo(r.domain, 16)}<span class="logo-text mono" dir="auto">${esc(r.domain)}</span></span>` },
        { key: "sessions", label: "Visits", num: true },
        { key: "leads", label: W("Leads", d), num: true },
      ], d.referrers, { empty: "No referring sites in this period.", search: "Search sites" })}</section>
      ${rulesCard("channel", "Channel rules", "Rename channels by source/medium (* = anything). Past days change too.", "chatgpt.com/*", "Channel name", d.rules)}`);
  }

  // ---- Conversions ------------------------------------------------------------------------------
  function conversionsPage() {
    if (simple()) return conversionsSimple();
    const entry = load("metrics/conversions");
    const blocked = stateCard(entry, "ga4");
    const head = topbarFor("Conversions", "From visit to lead. Counts only, no personal data.", entry);
    if (blocked) return page(head, blocked);
    const d = entry.data;
    if (!d.sessions) return page(head, emptyCard(t("No data in this period."), `${t("Google Analytics has data through")} ${esc(d.through ? shortDay(d.through) : "—")}.`));
    const setUp = d.key_events_set_up ? "" : `<p class="note warn lv-note">${icon("triangle-alert")}<span>${t("No key events. Mark your forms as key events in GA4.")}</span></p>`;
    const funnel = d.funnel.map((r) => {
      const max = Math.max(...d.funnel.map((x) => x.sessions), 1);
      // The words are said once, in the card head; a row holds its numbers, with the full words kept for screen readers.
      const words = `${num(r.sessions)} ${t("visits")} → ${num(r.leads)} ${t("leads")} · ${pct(r.rate)} · ${num(r.lost)} ${t("without a lead")}`;
      return `<div><div class="small" style="display:flex;justify-content:space-between;gap:8px"><b dir="auto">${esc(t(r.channel))}</b><span class="lv-funnel-nums"><span aria-hidden="true">${num(r.sessions)} → ${num(r.leads)} · ${pct(r.rate)} · <span class="muted">${num(r.lost)}</span></span><span class="sr">${words}</span></span></div>
        <div class="lv-bar" style="grid-template-columns:1fr"><span class="track"><i style="width:${Math.max(r.sessions ? 2 : 0, (r.sessions / max) * 100)}%"></i></span></div></div>`;
    }).join("");
    const funnelKey = `<span class="end small muted" aria-hidden="true">${t("Visits")} → ${t("Leads")} · ${t("Rate")} · ${t("Without a lead")}</span>`;
    return page(head, `
      <p class="small muted" style="margin:0 0 12px">${throughNote(d.through, "", d)}</p>${hiddenNote(d.hid_rows)}${setUp}
      <section class="tiles">
        ${UI.tile(t("Visits"), UI.cnt(d.sessions), "", { ic: "activity" })}
        ${UI.tile(t(W("Leads", d)), d.key_events_set_up ? num(d.leads) : "—", d.key_events_set_up ? "" : `<span class="ab">${t("Not set up")}</span>`, { ic: "filter" })}
        ${UI.tile(t(W("Lead rate", d)), d.key_events_set_up ? pct(d.rate) : "—", "", { ic: "percent" })}
      </section>
      <section class="card"><div class="card-head"><h2>${t("From visit to lead, by channel")}</h2>${funnelKey}</div><div class="lv-funnel">${funnel}</div></section>
      <div class="lv-two" style="margin-top:14px">
        <section class="card"><div class="card-head"><h2>${t("Page types")}</h2></div>${dataTable("types", [
          { key: "type", label: "Type", get: (r) => t(r.type), html: (r) => `<span dir="auto">${esc(t(r.type))}</span>` },
          { key: "pages", label: "Pages", num: true }, { key: "sessions", label: "Visits", num: true }, { key: "leads", label: W("Leads", d), num: true },
          { key: "rate", label: W("Lead rate", d), num: true, html: rateCell },
        ], d.page_types, { csv: false })}</section>
        <section class="card"><div class="card-head"><h2>${t("Pages that bring leads")}</h2></div>${dataTable("converting", [
          { key: "path", label: "Page", get: pageName, html: (r) => (r.unknown ? unknownPage(r) : `${PageLink.html(r.path, { host: r.host, cls: "mono lv-url" })}${siteOfPage(r)}`) },
          { key: "sessions", label: "Visits", num: true }, { key: "leads", label: W("Leads", d), num: true }, { key: "rate", label: W("Lead rate", d), num: true, html: rateCell },
        ], d.pages, { csv: false, empty: "No page brought a lead in this period.", search: "Search pages" })}</section>
      </div>`);
  }

  // ---- Content ----------------------------------------------------------------------------------
  function contentPage() {
    if (simple()) return contentSimple();
    const entry = load("metrics/content");
    const head = topbarFor("Content", "Every page and its results", entry);
    if (entry.loading || entry.error) return page(head, stateCard(entry, "ga4"));
    const d = entry.data;
    // Read before the "no pages" answer: Clarity has its own days, such as old imported ones with no Google data beside them.
    const heat = load("metrics/clarity");
    const known = (value) => (value === null ? "—" : UI.cnt(value)); // old recordings days never had clicks: unknown isn't zero
    const sessionsOnly = heat.data?.sessions_only_days;
    const clarityCard = heat.data?.has_data ? `<section class="tiles">
        ${UI.tile(t("Clarity sessions"), UI.cnt(heat.data.sessions), `<span class="ab">${t("Data through")} ${esc(shortDay(heat.data.through))}</span>`, { ic: "activity" })}
        ${UI.tile(t("Scroll depth"), heat.data.scroll_depth === null ? "—" : pct(heat.data.scroll_depth / 100), "", { ic: "layers" })}
        ${UI.tile(t("Rage clicks"), known(heat.data.rage_clicks), "", { ic: "mouse-pointer-click" })}
        ${UI.tile(t("Dead clicks"), known(heat.data.dead_clicks), "", { ic: "mouse-pointer-click" })}
      </section>${sessionsOnly ? `<p class="note lv-note">${icon("info")}<span>${num(sessionsOnly)} ${t(sessionsOnly === 1 ? "day has Clarity sessions only: no scroll depth or clicks." : "days have Clarity sessions only: no scroll depth or clicks.")}</span></p>` : ""}` : "";
    if (!d.pages.length) {
      const blocked = stateCard({ data: { ...d, state: d.ga4.state === "ok" ? d.gsc.state : d.ga4.state, through: d.ga4.through, error: d.ga4.error || d.gsc.error } }, d.ga4.state === "ok" ? "gsc" : "ga4");
      return page(head, clarityReportCard("dashboard") + clarityCard + (blocked || emptyCard(t("No data in this period."), t("Pick a longer or earlier period."))));
    }
    const missing = d.ga4.state !== "ok" ? "Visits and leads stay blank until Google Analytics is connected." : d.gsc.state !== "ok" ? "Google clicks and position stay blank until Search Console is connected." : "";
    return page(head, `
      ${missing ? `<p class="note lv-note">${icon("info")}<span>${t(missing)}</span></p>` : ""}${hiddenNote(d.hid_rows)}${clarityReportCard("dashboard")}${clarityCard}
      <section class="card"><div class="card-head"><h2>${t("All pages")}</h2><span class="end small muted">${num(d.total_pages)} ${t(d.total_pages === 1 ? "page" : "pages")} · ${sourceAndDays("Google Analytics and Search Console")}</span></div>${dataTable("content", [
        { key: "path", label: "Page", get: pageName, html: (r) => pageCell(r, r.unknown ? "" : `<div class="lv-cat" dir="auto">${esc(t(r.category))}</div>${UI.relatedTag?.({ host: r.host || UI.siteHostPicked() || "", page: r.path }) || ""}`) },
        { key: "sessions", label: "Visits", num: true }, { key: "leads", label: W("Leads", d), num: true }, { key: "clicks", label: "Google clicks", num: true },
        { key: "position", label: "Position", num: true, html: (r) => decimal(r.position) }, { key: "ai", label: "AI visits", num: true },
      ], d.pages, { search: "Search pages", rowAttrs: (r) => (r.unknown || !window.SCREENS?.pages ? 'style="cursor:default"' : `data-pg-goto="${esc(`https://${r.host || UI.siteHostPicked() || ""}${r.path}`)}" tabindex="0" title="${esc(t("All about this page"))}"`) })}</section>
      <section class="card" style="margin-top:14px"><div class="card-head"><h2>${t("Social networks")}</h2><span class="end small muted">${sourceAndDays("Google Analytics")}</span></div>${d.social.length ? socialBars(d.social) : `<div class="empty"><p>${t("No visits from social networks in this period.")}</p></div>`}</section>
      ${speedCard()}`); // Page speed moved here from Overview on 2026-11-09: it's about pages, not Google results
  }

  // ---- Clarity downloads: totals for the file's own period, shown apart from the period picked above ----
  const crTabs = { dashboard: "pages" };
  const pctOf = (v) => (v === null || v === undefined ? "—" : pct(v / 100)); // v is already in percent
  const realVisits = (d) => (d.sessions === null || d.sessions === undefined ? null : Math.max(0, d.sessions - (d.bot_sessions || 0)));
  const spanOf = (r) => `${esc(shortDay(r.period_start))} – ${esc(shortDay(r.period_end))}`;
  const grade = (value, good, poor, text) => (value === null || value === undefined ? "—" : `<span class="${value <= good ? "good" : value <= poor ? "warn" : "crit"}">${text}</span> <span class="small muted">${t(value <= good ? "good" : value <= poor ? "needs work" : "slow")}</span>`);
  const crTabRow = (kind, tabs) => `<div class="tabs" role="tablist" aria-label="${t("Clarity report")}" style="margin:6px 18px 0">${tabs.map(([id, word]) => `<button class="tab" role="tab" data-cr-tab="${kind}:${id}" aria-selected="${crTabs[kind] === id}">${t(word)}</button>`).join("")}</div>`;
  // A row names its file's period only when it differs from the one the card head shows for every site.
  const pickSite = (s, kind, shared = "") => {
    const ui = window.SITES.find((x) => x.realId === s.site_id)?.id, span = spanOf(s[kind]);
    return `${ui ? `<button class="link-btn mono" data-pick-site="${esc(ui)}" dir="ltr">${esc(s.host)}</button>` : `<span class="mono" dir="ltr">${esc(s.host)}</span>`}${span === shared ? "" : `<div class="lv-cat">${span}</div>`}`;
  };
  // The period most of these sites' files cover, said once in the card head.
  const sharedSpan = (sites, kind) => {
    const counts = new Map();
    sites.forEach((s) => { const span = spanOf(s[kind]); counts.set(span, (counts.get(span) || 0) + 1); });
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  };
  const uploadHint = () => `<p class="note lv-note">${icon("info")}<span>${t("Clarity dashboard downloads can go in too.")}${UI.tip("Upload them in Settings → Microsoft Clarity → Clarity dashboard downloads.")} <button class="link-btn" data-lv-connect="clarity">${t("Open it")}</button></span></p>`;

  function clarityReportCard(kind) {
    const entry = load("metrics/clarity-reports");
    if (!entry.data) return "";
    const sites = entry.data.sites.filter((s) => s[kind]);
    if (!sites.length) return uploadHint();
    const one = sites.length === 1 && UI.siteIdPicked();
    const r = sites[0][kind];
    const older = sites.some((s) => s[kind].older) ? ` · ${t("older downloads are kept")}` : "";
    const shared = one ? "" : sharedSpan(sites, kind);
    const headOf = (title) => `<div class="card-head"><h2>${t(title)}</h2><span class="end small muted">${one ? `${spanOf(r)} · ` : shared ? `${shared} · ` : ""}${t("from a Clarity download")}${older}</span></div>`;
    if (kind === "dashboard") {
      if (!one) {
        return `<section class="card" style="margin-bottom:14px">${headOf("Clarity report")}${dataTable("cr-sites", [
          { key: "host", label: "Site", html: (s) => pickSite(s, "dashboard", shared) },
          { key: "real", label: "Real visits", num: true, get: (s) => realVisits(s.dashboard) },
          { key: "bots", label: "Bots", num: true, get: (s) => s.dashboard.bot_sessions },
          { key: "scroll", label: "Scroll depth", num: true, get: (s) => s.dashboard.scroll_depth, html: (s) => pctOf(s.dashboard.scroll_depth) },
          { key: "dead", label: "Dead clicks", num: true, get: (s) => s.dashboard.insights?.dead_clicks?.share, html: (s) => pctOf(s.dashboard.insights?.dead_clicks?.share) },
        ], sites, { csv: false })}<p class="small muted" style="margin:0;padding:10px 18px 14px">${t("Press a site to see its pages, referrers and problems.")}</p></section>`;
      }
      const real = realVisits(r), ins = r.insights || {}, perf = r.performance || {};
      const answer = r.sessions ? `${num(real)} ${t("real visits")}: ${t("Clarity counted")} ${num(r.sessions)} ${t("and marked")} ${num(r.bot_sessions || 0)} ${t("as bots")} (${pctOf((100 * (r.bot_sessions || 0)) / r.sessions)}).` : t("No visits in this file.");
      const tab = crTabs.dashboard;
      const body = tab === "referrers"
        ? `${dataTable("cr-referrers", [{ key: "source", label: "Referrer", html: (x) => `<span class="mono" dir="ltr">${esc(x.source)}</span>` }, { key: "sessions", label: "Visits", num: true }], r.referrers || [], { csv: false, empty: "No referrers in this file.", search: "Search sites" })}${r.own_referrals ? `<p class="small muted" style="margin:0;padding:0 18px 14px">${num(r.own_referrals)} ${t("visits from the site's own pages left out.")}</p>` : ""}`
        : tab === "problems"
          ? `<div class="lv-two" style="padding:12px 18px 16px;gap:14px">
              <div><h3 class="small" style="margin:0 0 8px">${t("What visitors ran into")}</h3>${bars([["Dead clicks", ins.dead_clicks], ["Quick back clicks", ins.quick_back], ["Rage clicks", ins.rage_clicks], ["Excessive scrolling", ins.excessive_scrolling]].filter(([, v]) => v).map(([name, v]) => ({ name: t(name), sessions: v.sessions })), { value: (x) => x.sessions, label: (x) => x.name })}
                <h3 class="small" style="margin:14px 0 8px">${t("JavaScript errors")}: ${num(r.js_errors?.total || 0)}</h3>${(r.js_errors?.top || []).length ? `<ul class="small" style="margin:0;padding-left:18px">${r.js_errors.top.map((x) => `<li><span class="mono">${esc(x.message)}</span> · ${num(x.sessions)}</li>`).join("")}</ul>` : `<p class="small muted" style="margin:0">${t("None.")}</p>`}</div>
              <div><h3 class="small" style="margin:0 0 8px">${t("Page speed, real visitors")}</h3><ul class="rows" style="margin:0">
                <li><div class="what"><div class="t">${t("Score")}</div></div><div class="acts">${perf.score === undefined || perf.score === null ? "—" : num(Math.round(perf.score))} / 100</div></li>
                <li><div class="what"><div class="t">${t("Largest content")} (LCP)</div></div><div class="acts">${grade(perf.lcp_ms, 2500, 4000, perf.lcp_ms === null || perf.lcp_ms === undefined ? "" : `${decimal(Math.round(perf.lcp_ms / 100) / 10)} s`)}</div></li>
                <li><div class="what"><div class="t">${t("Click response")} (INP)</div></div><div class="acts">${grade(perf.inp_ms, 200, 500, `${num(perf.inp_ms)} ms`)}</div></li>
                <li><div class="what"><div class="t">${t("Layout shift")} (CLS)</div></div><div class="acts">${grade(perf.cls, 0.1, 0.25, decimal(perf.cls))}</div></li></ul></div></div>`
          : tab === "visitors"
            ? `<div class="lv-two" style="padding:12px 18px 16px;gap:14px">
                <div><h3 class="small" style="margin:0 0 8px">${t("Browsers")}</h3>${bars((r.browsers || []).slice(0, 8), { value: (x) => x.sessions, label: (x) => x.name })}</div>
                <div><ul class="rows" style="margin:0">
                  <li><div class="what"><div class="t">${t("Unique visitors")}</div></div><div class="acts">${num(r.unique_users)}</div></li>
                  <li><div class="what"><div class="t">${t("Returning visitors' visits")}</div></div><div class="acts">${num(r.returning_user_sessions)}</div></li>
                  <li><div class="what"><div class="t">${t("Pages per visit")}</div></div><div class="acts">${decimal(r.pages_per_session === null || r.pages_per_session === undefined ? null : Math.round(r.pages_per_session * 100) / 100)}</div></li>
                  <li><div class="what"><div class="t">${t("Active time per visit")}</div></div><div class="acts">${num(r.active_seconds)} s</div></li>
                  ${(r.smart_events || []).map((x) => `<li><div class="what"><div class="t" dir="auto">${esc(t(x.name))}</div><div class="s">${t("Smart event")}</div></div><div class="acts">${num(x.sessions)}</div></li>`).join("")}</ul></div></div>`
            : dataTable("cr-pages", [{ key: "url", label: "Page", html: (x) => PageLink.html(x.url, { text: x.url.replace(/^https?:\/\/[^/]+/, "") || "/", cls: "mono lv-url", dir: "ltr" }) }, { key: "sessions", label: "Visits", num: true }], r.top_pages || [], { csv: false, empty: "No pages in this file.", search: "Search pages" });
      return `<section class="card" style="margin-bottom:14px">${headOf("Clarity report")}
        <p style="margin:0;padding:12px 18px 0">${answer}</p>
        <section class="tiles" style="padding:12px 18px 0;margin:0">
          ${UI.tile(t("Real visits"), UI.cnt(real), `<span class="ab">${t("of")} ${num(r.sessions)}</span>`, { ic: "activity" })}
          ${UI.tile(t("Scroll depth"), pctOf(r.scroll_depth), "", { ic: "layers" })}
          ${UI.tile(t("Dead clicks"), pctOf(ins.dead_clicks?.share), `<span class="ab">${num(ins.dead_clicks?.sessions)} ${t("visits")}</span>`, { ic: "mouse-pointer-click" })}
          ${UI.tile(t("Speed score"), perf.score === undefined || perf.score === null ? "—" : num(Math.round(perf.score)), `<span class="ab">/ 100</span>`, { ic: "clock" })}
        </section>
        ${crTabRow("dashboard", [["pages", "Top pages"], ["referrers", "Referrers"], ["problems", "Problems"], ["visitors", "Visitors"]])}${body}</section>`;
    }
    return ""; // the "ai" kind (Copilot's citations) is drawn by ai-search-view.js now
  }

  // ---- the simpler screens: Channels, Conversions and Content (UI.simple(), ?simple=1; track T2, 2026-11-12) ----------------
  /* The model the other screens copy (plan-seo-command-center-simplify-screens-like-mickaz.md, section 2). Each screen:
     - draws UI.head: the period buttons, the dates, the source and how fresh, and its caveats behind the (i) (nothing between
       the head and the first card but page tabs);
     - answers with UI.card number cards, each with its own graph of this period and the period before;
     - shows one main thing first, the rest one tab or one panel away;
     - marks rows data-rp-open so a click opens UI.rowPanel (row-panel.js), and leaves the ticks, Filter and the count to the
       table layer (table-tools.js), which places them in the card head or in a data-tt-slot;
     - loads through SCREEN_DATA in one call: the folded answers (?include=) instead of one call per part.
     With the switch off none of this runs: each page function returns its old drawing. */
  const INCLUDE = { "metrics/channels": "&include=logos", "metrics/content": "&include=clarity,speed,clarity_reports" };
  const simple = () => Boolean(UI.simple?.());
  const HID_TIP = "Google Analytics hid some rows with few visits, so small numbers may be missing. A longer period may show them.";
  const TABS = { content: "pages", conversions: "pages", clarity: "" };
  const blockedStates = ["no_sites", "not_connected", "not_used"];
  function simpleHead(title, entry, { source = null, status = null, info = [] } = {}) {
    const main = entry?.data && !blockedStates.includes(entry.data.state) ? refreshBtn() : "";
    return UI.head({ title: t(title), period: true, source, status, info: info.filter(Boolean), main });
  }
  /* A source that isn't there becomes the head's status chip, which opens its connection. */
  const SOURCE_STATE = { not_connected: "not connected", not_used: "not used", failing: "stopped working", waiting: "waiting for data" };
  const sourceStatus = (state, name) => (state && state !== "ok" && SOURCE_STATE[state] ? { sev: state === "failing" ? "crit" : "warn", word: `${t(name)}: ${t(SOURCE_STATE[state])}`, open: 'data-lv-connect="google"' } : null);
  // Page tabs in the underline style (screen-parts.css). inCard: right under a card's top, with the table's tools beside them.
  const pageTabs = (group, tabs, label, inCard = false) => `<div class="page-tabs${inCard ? " in-card" : ""}" role="tablist" aria-label="${esc(t(label))}">${tabs.map(([id, word, count]) => `<button type="button" class="page-tab" role="tab" data-lv-ptab="${group}:${id}" aria-selected="${TABS[group] === id}">${esc(word)}${count !== undefined ? ` <span class="n-badge">${num(count)}</span>` : ""}</button>`).join("")}</div>`;
  const pickTab = (group, tabs) => { if (!tabs.some(([id]) => id === TABS[group])) TABS[group] = tabs[0]?.[0] || ""; };
  // The days both periods reported, for a card's graph: this period solid, the period before dashed (UI.card).
  const daySpark = (d, pick) => (d?.days?.length > 1 ? { days: d.days.map((r) => r.day), now: d.days.map(pick), before: (d.days_before || []).map(pick) } : null);
  // Visits that became a lead (or had a key event) out of all visits, never over 100% (W8). A blank count stays blank.
  // Out of the visits of the sites that record leads or key events ("rated"), when the server says it (W2b).
  const ratePct = (r) => {
    const top = r ? (r.converted !== undefined ? r.converted : r.leads) : null;
    const base = r ? (r.rated !== undefined && r.rated !== null ? r.rated : r.sessions) : null;
    return r && base && top !== null && top !== undefined ? Math.min(top, base) / base * 100 : null;
  };
  /* A card's change. When only some sites had a fair period before, the server sends their totals now ("compared"):
     the change sets them against the period before, so like is compared with like (final review N1). */
  const versus = (d, pick) => (d.compared ? pick(d.compared) : null);
  /* While key events are counted, a rate counts each key event as a visit with one, up to the visits: an upper bound of
     Google Analytics' own rate, which counts visits with at least one key event (final review N4). */
  const rateInfo = (d) => (window.GA4W.keyEvents(d) || window.GA4W.mixed(d) ? ["Key event rate, at most: each key event counts as one visit, never more than the visits. Google Analytics' own rate counts visits with at least one key event, so it can be lower."] : "");
  const W = (english, d) => window.GA4W.word(english, d);
  const known = (v) => v !== null && v !== undefined;
  // Rows that open their side panel (row-panel.js): a click, or Enter on the focused row.
  const opensPanel = (kind, key, host = "") => `data-rp-open="${kind}" data-rp-key="${esc(key)}"${host ? ` data-rp-host="${esc(host)}"` : ""} tabindex="0"`;
  const pageRow = (r) => (r.unknown ? 'style="cursor:default"' : opensPanel("page", r.path, r.host || UI.siteHostPicked() || ""));
  /* Google's #section jump links for the page, said apart: the page's clicks, click rate and position are its own address's
     (expert review 2026-11-17, 3.3). */
  const jumpLine = (r) => (r.jump_impressions ? `<div class="lv-cat lv-jump">${esc(t("Jump links: {n} impressions").replace("{n}", num(r.jump_impressions)))}</div>` : "");
  // A page of my sites: its picture and title, the address and anything else under them (page-thumbs.js).
  const pageCell = (r, under = "") => (r.unknown ? unknownPage(r) : window.PageThumb
    ? window.PageThumb.row(r.path, { host: r.host, inner: `<div class="mono lv-url">${PageLink.html(r.path, { host: r.host })}</div>${siteOfPage(r)}${jumpLine(r)}${under}` })
    : `<div class="mono lv-url">${PageLink.html(r.path, { host: r.host })}</div>${siteOfPage(r)}${jumpLine(r)}${under}`);

  // ---- Channels: cards, every channel (rules in a panel), then the chart beside the referring sites
  function channelsSimple() {
    const entry = load("metrics/channels", INCLUDE["metrics/channels"]);
    const d = entry.data;
    if (d?.through) UI.range.end(UI.state.route, d.through);
    const head = simpleHead("Channels", entry, { source: { name: "Google Analytics", through: d?.through }, info: ["Visit and lead sources, from Google Analytics", d?.hid_rows && HID_TIP] });
    const blocked = stateCard(entry, "ga4");
    if (blocked) return page(head, blocked);
    if (!d.channels.length) return page(head, emptyCard(t("No data in this period."), `${t("Google Analytics has data through")} ${esc(d.through ? shortDay(d.through) : "—")}.`));
    // The icons the server already has come with the answer; a list with letters still waiting looks again, in the quiet queue.
    if (Array.isArray(d.logos) && window.LOGOS_KNOWN?.add) d.logos.forEach((name) => window.LOGOS_KNOWN.add(name));
    const referrerList = d.referrers.map((r) => r.domain).join(",");
    if (referrerList !== LV.referrersWatched) {
      LV.referrersWatched = referrerList;
      if (d.referrers.some((r) => UI.siteLogo(r.domain).includes("letter"))) (window.SCREEN_DATA?.logos || window.COMP?.refreshLogos)?.({ watch: true });
    }
    const before = d.before, top = d.channels[0];
    const cards = `<section class="tiles lv-cards">
        ${UI.card({ id: "visits", label: "Visits", value: d.total.sessions, change: { now: versus(d, (c) => c.sessions) ?? d.total.sessions, before: before?.sessions }, spark: daySpark(d, (r) => r.sessions) })}
        ${UI.card({ id: "leads", label: W("Leads", d), value: d.total.leads, change: { now: versus(d, (c) => c.leads) ?? d.total.leads, before: before?.leads }, spark: daySpark(d, (r) => r.leads) })}
        ${UI.card({ id: "rate", label: W("Lead rate", d), value: ratePct(d.total), format: "pct", change: { now: versus(d, ratePct) ?? ratePct(d.total), before: ratePct(before), unit: "pts" }, spark: daySpark(d, ratePct), info: rateInfo(d) })}
        ${UI.card({ id: "channels", label: "Channels", value: d.channels.length, sub: top ? esc(fillIn(t("Most visits: {name}"), { name: t(top.channel) })) : "" })}
      </section>${window.GA4W.notes(d)}`;
    const swatch = (name) => `<i class="lv-key" style="background:${colourOf(name)}"></i>${esc(t(name))}${aiLink(name)}`;
    const days = d.series.map((r) => r.day);
    const series = d.series_names.map((name) => ({ name, color: colourOf(name), values: Object.fromEntries(d.series.map((r) => [r.day, r.values[name] ?? 0])) }));
    return page(head, `${cards}
      <section class="card"><div class="card-head"><h2>${t("Every channel")}</h2><button type="button" class="btn btn-small end" data-lv-rules aria-haspopup="dialog">${icon("pencil")}${t("Channel rules")}</button></div>${dataTable("channels", [
        { key: "channel", label: "Channel", html: (r) => swatch(r.channel) },
        { key: "sessions", label: "Visits", num: true },
        { key: "share", label: "Share", num: true, get: (r) => r.share, html: (r) => pct(r.share) },
        { key: "leads", label: W("Leads", d), num: true },
        { key: "rate", label: W("Lead rate", d), num: true, get: (r) => r.rate, html: rateCell },
        { key: "change", label: "Change", num: true, html: (r) => (r.change === null ? `<span class="muted">—</span>` : `<span class="${r.change >= 0 ? "good" : "crit"} d-pill">${icon(r.change >= 0 ? "arrow-up" : "arrow-down")}${r.change >= 0 ? "+" : "−"}${num(Math.abs(r.change))}%</span>`) },
      ], d.channels, { rowAttrs: (r) => opensPanel("channel", r.channel) })}</section>
      <div class="lv-two lv-pair">
        <section class="card"><div class="card-head"><h2>${t("Visits by channel")}</h2></div><div class="lv-chart-sm">${lineChart("channels", days, series, d.unusual?.days && Object.keys(d.unusual.days).length ? { marks: Object.fromEntries(Object.keys(d.unusual.days).map((k) => [k, 1])), markName: "Unusual day" } : {})}</div></section>
        <section class="card"><div class="card-head"><h2>${t("Referring sites")}</h2></div>${dataTable("referrers", [
          { key: "domain", label: "Site", html: (r) => `<span class="with-logo">${UI.siteLogo(r.domain, 16)}<span class="logo-text mono" dir="auto">${esc(r.domain)}</span></span>` },
          { key: "sessions", label: "Visits", num: true },
          { key: "leads", label: W("Leads", d), num: true },
        ], d.referrers, { empty: "No referring sites in this period.", search: "Search sites", rowAttrs: (r) => opensPanel("referrer", r.domain) })}</section>
      </div>`);
  }
  // Channel rules, one click from the channel table's head: the hint, the rules and the form, in a side panel.
  const channelsKey = () => `metrics/channels?${periodQuery()}${INCLUDE["metrics/channels"]}`;
  const rulesBody = (rules) => `<p class="help lv-rules-help">${t("Rename channels by source/medium (* = anything). Past days change too.")}</p>
      ${rules.length ? `<div class="lv-rules-list">${rules.map((r) => `<div class="lv-rule"><span class="grow mono" dir="auto">${esc(r.pattern)}${r.value ? ` → ${esc(r.value)}` : ""}</span><button class="btn btn-small btn-ghost" data-lv-rule-del="${r.id}" aria-label="${t("Remove")}: ${esc(r.pattern)}">${t("Remove")}</button></div>`).join("")}</div>` : `<p class="small muted lv-rules-none">${t("No rules yet.")}</p>`}
      <form class="lv-rule-form" data-lv-rule-form="channel"><input class="input mono" spellcheck="false" autocapitalize="off" name="f_pattern" placeholder="chatgpt.com/*" aria-label="${t("Matches")}" autocomplete="off" data-autofocus><input class="input" name="f_value" placeholder="${esc(t("Channel name"))}" aria-label="${t("Channel name")}" autocomplete="off"><button class="btn btn-small" type="submit">${t("Add rule")}</button><span class="error" data-lv-rule-error hidden></span></form>`;
  function rulesPanel(opener) {
    const rules = window.SCREEN_DATA?.peek(channelsKey())?.rules || LV.cache.get?.(channelsKey())?.data?.rules || [];
    UI.openPanel(`${UI.panelHead(t("Channel rules"), "")}<div class="panel-body" data-lv-rules-body>${rulesBody(rules)}</div>`, opener);
  }
  /* After a rule is added or removed. Off, or with no rules panel open: forget and redraw, as before. In the panel: the
     channels are asked again, the page under it redrawn, and the panel's list drawn from the new answer. */
  async function afterRuleChange() {
    forget();
    const body = UI.$("#panel [data-lv-rules-body]");
    if (!simple() || !body || !window.SCREEN_DATA?.on()) { UI.render(); return; }
    try { await window.SCREEN_DATA.get(channelsKey()); } catch { /* the page says it on its next draw */ }
    UI.render();
    const data = window.SCREEN_DATA.peek(channelsKey());
    const still = UI.$("#panel [data-lv-rules-body]");
    if (still && data) { UI.setHTML(still, rulesBody(data.rules || [])); still.querySelector('[name="f_pattern"]')?.focus({ preventScroll: true }); }
  }

  // ---- Conversions: cards, the visit-to-lead line per channel, then pages and page types as two tabs of one card
  function conversionsSimple() {
    const entry = load("metrics/conversions");
    const d = entry.data;
    const through = d?.through || (d?.period?.trimmed ? d.period.to : null);
    if (through) UI.range.end(UI.state.route, through);
    const head = simpleHead("Conversions", entry, { source: { name: "Google Analytics", through }, info: ["From visit to lead, by channel and by page.", "Counts only: no personal data comes into this app.", d?.hid_rows && HID_TIP] });
    const blocked = stateCard(entry, "ga4");
    if (blocked) return page(head, blocked);
    if (!d.sessions) return page(head, emptyCard(t("No data in this period."), `${t("Google Analytics has data through")} ${esc(d.through ? shortDay(d.through) : "—")}.`));
    const set = d.key_events_set_up, was = d.before;
    // A line that carries an action stays on screen: without key events there are no leads to count.
    const setUp = set || d.lead_kind === "leads" ? "" : `<p class="note warn lv-note">${icon("triangle-alert")}<span>${t("No key events. Mark your forms as key events in GA4.")}</span></p>`;
    const cards = `<section class="tiles lv-cards">
        ${UI.card({ id: "visits", label: "Visits", value: d.sessions, change: { now: versus(d, (c) => c.sessions) ?? d.sessions, before: was?.sessions }, spark: daySpark(d, (r) => r.sessions) })}
        ${UI.card({ id: "leads", label: W("Leads", d), value: set ? d.leads : null, sub: set ? null : esc(t("Not set up")), change: set ? { now: versus(d, (c) => c.leads) ?? d.leads, before: was?.leads } : null, spark: set ? daySpark(d, (r) => r.leads) : null })}
        ${UI.card({ id: "rate", label: W("Lead rate", d), value: set && known(d.rate) ? d.rate * 100 : null, format: "pct", sub: set ? null : esc(t("Not set up")), change: set && known(d.rate) ? { now: (versus(d, (c) => c.rate) ?? d.rate) * 100, before: known(was?.rate) ? was.rate * 100 : null, unit: "pts" } : null, spark: set ? daySpark(d, ratePct) : null, info: rateInfo(d) })}
      </section>${set ? window.GA4W.notes(d) : ""}`;
    const max = Math.max(...d.funnel.map((x) => x.sessions), 1);
    // One line per channel; the visits that didn't become a lead are the bar's tip.
    const funnel = d.funnel.map((r) => `<div class="lv-bar lv-fline"><span class="lab" dir="auto">${esc(t(r.channel))}</span><span class="track" data-tip="${esc(fillIn(t(W("{n} visits didn't become a lead", d)), { n: num(r.lost) }))}"><i style="width:${Math.max(r.sessions ? 2 : 0, (r.sessions / max) * 100)}%"></i></span><span class="val">${num(r.sessions)} ${t("visits")} → ${num(r.leads)} ${t(W("leads", d))} · ${pct(r.rate)}<span class="sr"> · ${num(r.lost)} ${t(W("without a lead", d))}</span></span></div>`).join("");
    const tabs = [["pages", t(W("Pages that bring leads", d)), d.pages.length], ["types", t("Page types"), d.page_types.length]];
    pickTab("conversions", tabs);
    const table = TABS.conversions === "types"
      ? dataTable("types", [
        { key: "type", label: "Type", get: (r) => t(r.type), html: (r) => `<span dir="auto">${esc(t(r.type))}</span>` },
        { key: "pages", label: "Pages", num: true }, { key: "sessions", label: "Visits", num: true }, { key: "leads", label: W("Leads", d), num: true },
        { key: "rate", label: W("Lead rate", d), num: true, html: rateCell },
      ], d.page_types, { wrapAttrs: "data-tt-own-count" })
      : dataTable("converting", [
        { key: "path", label: "Page", get: pageName, html: (r) => (r.unknown ? unknownPage(r) : `${PageLink.html(r.path, { host: r.host, cls: "mono lv-url" })}${siteOfPage(r)}`) },
        { key: "sessions", label: "Visits", num: true }, { key: "leads", label: W("Leads", d), num: true }, { key: "rate", label: W("Lead rate", d), num: true, html: rateCell },
      ], d.pages, { empty: W("No page brought a lead in this period.", d), search: "Search pages", rowAttrs: pageRow, wrapAttrs: "data-tt-own-count" });
    return page(head, `${setUp}${cards}
      <section class="card"><div class="card-head"><h2>${t(W("From visit to lead, by channel", d))}</h2></div><div class="lv-bars lv-funnel-lines">${funnel}</div></section>
      <section class="card lv-tab-card"><div class="lv-tabbar">${pageTabs("conversions", tabs, "Pages", true)}<span class="lv-tab-tools" data-tt-slot></span></div>${table}</section>`);
  }

  // ---- Content: page tabs; All pages first, then social networks, page speed, and Clarity once it has something
  function contentSimple() {
    const entry = load("metrics/content", INCLUDE["metrics/content"]);
    const d = entry.data;
    const ok = (s) => s?.state === "ok";
    const sources = d ? [ok(d.ga4) && { name: "Google Analytics", through: d.ga4.through }, ok(d.gsc) && { name: "Search Console", through: d.gsc.through }].filter(Boolean) : null;
    const status = d ? sourceStatus(d.ga4?.state, "Google Analytics") || sourceStatus(d.gsc?.state, "Search Console") : null;
    // Google clicks follow the app's one period rule (they end on Search Console's last final day); visits run to GA4's last day.
    const gw = d?.gsc_window, clicksDays = gw?.from && gw?.to && gw.to !== UI.range.get().to ? fillIn(t("Google clicks: {a} – {b}."), { a: shortDay(gw.from), b: shortDay(gw.to) }) : "";
    const head = simpleHead("Content", entry, { source: sources?.length ? sources : null, status, info: ["Every page and its results", d?.hid_rows && HID_TIP, clicksDays] });
    if (entry.loading || entry.error || entry.noServer) return page(head, stateCard(entry, "ga4"));
    const heat = d.clarity, reports = d.clarity_reports, runs = d.speed?.runs || [];
    const downloads = (reports?.sites || []).filter((s) => s.dashboard);
    // Content tracker (2026-11-20): every published piece and whether it worked, second after All pages (content-tracker.js).
    const tabs = [["pages", t("All pages")], ...(window.ContentTracker ? [["published", t("Content tracker"), window.ContentTracker.count()]] : []), ["social", t("Social networks")], ["speed", t("Page speed")]];
    if (heat?.has_data || downloads.length) tabs.push(["clarity", "Clarity"]);
    pickTab("content", tabs);
    const tab = TABS.content;
    let body;
    if (tab === "published") {
      body = window.ContentTracker.body();
    } else if (tab === "social") {
      body = `<section class="card"><div class="card-head"><h2>${t("Social networks")}</h2><span class="end small muted">${sourceAndDays("Google Analytics")}</span></div>${d.social?.length ? socialBars(d.social) : `<div class="empty"><p>${t("No visits from social networks in this period.")}</p></div>`}</section>`;
    } else if (tab === "speed") {
      body = speedSimple(runs, downloads);
    } else if (tab === "clarity") {
      body = claritySimple(heat, downloads);
    } else if (!d.pages.length) {
      const blocked = stateCard({ data: { ...d, state: d.ga4.state === "ok" ? d.gsc.state : d.ga4.state, through: d.ga4.through, error: d.ga4.error || d.gsc.error } }, d.ga4.state === "ok" ? "gsc" : "ga4");
      body = blocked || emptyCard(t("No data in this period."), t("Pick a longer or earlier period."));
    } else {
      body = `<section class="card"><div class="card-head"><h2>${t("All pages")}</h2><span class="end small muted">${sourceAndDays("Google Analytics and Search Console")}</span></div>${dataTable("content", [
        { key: "path", label: "Page", get: pageName, html: (r) => pageCell(r, r.unknown ? "" : `<div class="lv-cat" dir="auto">${esc(t(r.category))}</div>${UI.relatedTag?.({ host: r.host || UI.siteHostPicked() || "", page: r.path }) || ""}`) },
        { key: "sessions", label: "Visits", num: true }, { key: "leads", label: W("Leads", d), num: true }, { key: "clicks", label: "Google clicks", num: true },
        { key: "position", label: "Position", num: true, html: (r) => decimal(r.position) }, { key: "ai", label: "AI visits", num: true },
      ], d.pages, { search: "Search pages", rowAttrs: pageRow })}</section>`;
    }
    return page(head, `${pageTabs("content", tabs, "Content")}${body}`);
  }
  // Page speed: the PageSpeed tests, then the real visitors' speed from a Clarity download (it isn't Clarity's own data).
  function speedSimple(runs, downloads) {
    const ms = (v) => (v === null || v === undefined ? null : Math.round(v / 100) / 10);
    const tests = runs.length ? dataTable("speed", [
      { key: "host", label: "Site", html: (r) => `<span class="mono" dir="auto">${esc(r.host)}</span>` },
      { key: "strategy", label: "Device", get: (r) => t(r.strategy === "mobile" ? "Phone" : "Computer") },
      ...speedColumns(ms),
    ], runs) : `<div class="empty"><p>${t("No speed test yet. Refresh data runs one.")}</p></div>`;
    const one = downloads.length === 1 && UI.siteIdPicked() ? downloads[0].dashboard : null, perf = one?.performance || null;
    const real = perf && Object.values(perf).some(known) ? `<section class="card"><div class="card-head"><h2>${t("Page speed, real visitors")}</h2><span class="end small muted">${esc(t("Clarity download"))} · ${spanOf(one)}</span></div>
      <ul class="rows lv-speed-real">
        <li><div class="what"><div class="t">${t("Speed score")}</div></div><div class="acts">${known(perf.score) ? num(Math.round(perf.score)) : "—"} / 100</div></li>
        <li><div class="what"><div class="t">${t("Largest content")} (LCP)</div></div><div class="acts">${grade(perf.lcp_ms, 2500, 4000, known(perf.lcp_ms) ? `${decimal(Math.round(perf.lcp_ms / 100) / 10)} s` : "")}</div></li>
        <li><div class="what"><div class="t">${t("Click response")} (INP)</div></div><div class="acts">${grade(perf.inp_ms, 200, 500, `${num(perf.inp_ms)} ms`)}</div></li>
        <li><div class="what"><div class="t">${t("Layout shift")} (CLS)</div></div><div class="acts">${grade(perf.cls, 0.1, 0.25, decimal(perf.cls))}</div></li></ul></section>` : "";
    return `<section class="card"><div class="card-head"><h2>${t("Page speed")}</h2><span class="end small muted">${esc(t("PageSpeed Insights"))} · ${t("Home page")}</span></div>${tests}</section>${real}`;
  }
  /* One Clarity block (owner, 2026-11-12): what Clarity counts live for the period picked first, then a download's report for its
     own days behind a tab. Each says its source and days, so its numbers never pass for Google Analytics'. */
  function claritySimple(heat, downloads) {
    const live = Boolean(heat?.has_data);
    const one = downloads.length === 1 && UI.siteIdPicked();
    const span = one ? spanOf(downloads[0].dashboard) : sharedSpan(downloads, "dashboard");
    const views = [...(live ? [["live", `${t("Live data")} · ${UI.fmtRange(UI.range.get().from, UI.range.get().to)}`]] : []), ...(downloads.length ? [["download", `${t("Clarity download")}${span ? ` · ${span.replace(/&ndash;|–/g, "–")}` : ""}`]] : [])];
    pickTab("clarity", views);
    const view = TABS.clarity;
    const tabRow = views.length > 1 ? pageTabs("clarity", views, "Clarity", true) : "";
    const sessionsOnly = heat?.sessions_only_days;
    // The tabs say each view's source and days; with one view, the card head says them.
    const head = (word) => `<div class="card-head"><h2>Microsoft Clarity</h2>${tabRow ? "" : `<span class="end small muted">${word}</span>`}</div>`;
    if (view === "live") {
      // Days with sessions only (an old recordings import): said behind the sessions card's (i).
      const info = sessionsOnly ? fillIn(t(sessionsOnly === 1 ? "1 day has Clarity sessions only: no scroll depth or clicks." : "{n} days have Clarity sessions only: no scroll depth or clicks."), { n: num(sessionsOnly) }) : "";
      return `<section class="card lv-clarity">${head(`${esc(t("Live data"))} · ${sourceAndDays("Microsoft Clarity")}`)}${tabRow}
        <section class="tiles lv-cards lv-in-card">
          ${UI.card({ id: "clarity-sessions", label: "Clarity sessions", value: heat.sessions, info, sub: `${esc(t("Data through"))} ${esc(shortDay(heat.through))}` })}
          ${UI.card({ id: "scroll", label: "Scroll depth", value: heat.scroll_depth, format: "pct" })}
          ${UI.card({ id: "rage", label: "Rage clicks", value: heat.rage_clicks })}
          ${UI.card({ id: "dead", label: "Dead clicks", value: heat.dead_clicks })}
        </section></section>`;
    }
    return `<section class="card lv-clarity">${head(`${esc(t("Clarity download"))}${span ? ` · ${span}` : ""}`)}${tabRow}${clarityDownload(downloads, one)}</section>`;
  }
  // A Clarity download's report, for its own days: compact tables, and no speed (that is on Page speed).
  function clarityDownload(sites, one) {
    if (!one) {
      return dataTable("cr-sites", [
        { key: "host", label: "Site", html: (s) => pickSite(s, "dashboard", sharedSpan(sites, "dashboard")) },
        { key: "real", label: "Real visits", num: true, get: (s) => realVisits(s.dashboard) },
        { key: "bots", label: "Bots", num: true, get: (s) => s.dashboard.bot_sessions },
        { key: "scroll", label: "Scroll depth", num: true, get: (s) => s.dashboard.scroll_depth, html: (s) => pctOf(s.dashboard.scroll_depth) },
        { key: "dead", label: "Dead clicks", num: true, get: (s) => s.dashboard.insights?.dead_clicks?.share, html: (s) => pctOf(s.dashboard.insights?.dead_clicks?.share) },
      ], sites, { compact: true, wrapAttrs: "data-tt-own-count" });
    }
    const r = sites[0].dashboard, real = realVisits(r), ins = r.insights || {};
    const answer = r.sessions ? `${num(real)} ${t("real visits")}: ${t("Clarity counted")} ${num(r.sessions)} ${t("and marked")} ${num(r.bot_sessions || 0)} ${t("as bots")} (${pctOf((100 * (r.bot_sessions || 0)) / r.sessions)}).` : t("No visits in this file.");
    const tab = crTabs.dashboard;
    const body = tab === "referrers"
      ? `${dataTable("cr-referrers", [{ key: "source", label: "Referrer", html: (x) => `<span class="with-logo">${UI.siteLogo(x.source, 16)}<span class="logo-text mono" dir="ltr">${esc(x.source)}</span></span>` }, { key: "sessions", label: "Visits", num: true }], r.referrers || [], { empty: "No referrers in this file.", search: "Search sites", compact: true, wrapAttrs: "data-tt-own-count" })}${r.own_referrals ? `<p class="small muted lv-pad">${num(r.own_referrals)} ${t("visits from the site's own pages left out.")}</p>` : ""}`
      : tab === "problems"
        ? `<div class="lv-pad"><h3 class="small lv-h3">${t("What visitors ran into")}</h3>${bars([["Dead clicks", ins.dead_clicks], ["Quick back clicks", ins.quick_back], ["Rage clicks", ins.rage_clicks], ["Excessive scrolling", ins.excessive_scrolling]].filter(([, v]) => v).map(([name, v]) => ({ name: t(name), sessions: v.sessions })), { value: (x) => x.sessions, label: (x) => x.name })}
            <h3 class="small lv-h3">${t("JavaScript errors")}: ${num(r.js_errors?.total || 0)}</h3>${(r.js_errors?.top || []).length ? `<ul class="small lv-errors">${r.js_errors.top.map((x) => `<li><span class="mono">${esc(x.message)}</span> · ${num(x.sessions)}</li>`).join("")}</ul>` : `<p class="small muted">${t("None.")}</p>`}</div>`
        : tab === "visitors"
          ? `<div class="lv-two lv-pad"><div><h3 class="small lv-h3">${t("Browsers")}</h3>${bars((r.browsers || []).slice(0, 8), { value: (x) => x.sessions, label: (x) => x.name })}</div>
              <div><ul class="rows">
                <li><div class="what"><div class="t">${t("Unique visitors")}</div></div><div class="acts">${num(r.unique_users)}</div></li>
                <li><div class="what"><div class="t">${t("Returning visitors' visits")}</div></div><div class="acts">${num(r.returning_user_sessions)}</div></li>
                <li><div class="what"><div class="t">${t("Pages per visit")}</div></div><div class="acts">${decimal(known(r.pages_per_session) ? Math.round(r.pages_per_session * 100) / 100 : null)}</div></li>
                <li><div class="what"><div class="t">${t("Active time per visit")}</div></div><div class="acts">${num(r.active_seconds)} s</div></li>
                ${(r.smart_events || []).map((x) => `<li><div class="what"><div class="t" dir="auto">${esc(t(x.name))}</div><div class="s">${t("Smart event")}</div></div><div class="acts">${num(x.sessions)}</div></li>`).join("")}</ul></div></div>`
          : dataTable("cr-pages", [{ key: "url", label: "Page", html: (x) => PageLink.html(x.url, { text: x.url.replace(/^https?:\/\/[^/]+/, "") || "/", cls: "mono lv-url", dir: "ltr" }) }, { key: "sessions", label: "Visits", num: true }], r.top_pages || [], { empty: "No pages in this file.", search: "Search pages", compact: true, wrapAttrs: "data-tt-own-count" });
    return `<p class="lv-pad lv-answer">${answer}</p>
      <section class="tiles lv-cards lv-in-card">
        ${UI.card({ id: "cr-real", label: "Real visits", value: real, sub: `${esc(t("of"))} ${num(r.sessions)}` })}
        ${UI.card({ id: "cr-scroll", label: "Scroll depth", value: known(r.scroll_depth) ? Math.round(r.scroll_depth * 10) / 10 : null, format: "pct" })}
        ${UI.card({ id: "cr-dead", label: "Dead clicks", value: known(ins.dead_clicks?.share) ? Math.round(ins.dead_clicks.share * 10) / 10 : null, format: "pct", sub: `${num(ins.dead_clicks?.sessions)} ${esc(t("visits"))}` })}
      </section>
      ${crTabRow("dashboard", [["pages", "Top pages"], ["referrers", "Referrers"], ["problems", "Problems"], ["visitors", "Visitors"]])}${body}`;
  }

  // ---- AI search: its own file since 2026-11-10 (ai-search-view.js), with what it needs from here on LV ----------------

  // ---- Google Ads -------------------------------------------------------------------------------
  function adsPage() {
    const entry = load("metrics/ads");
    const blocked = stateCard(entry, "ga4");
    const head = topbarFor("Google Ads", "Cost, clicks and leads from Google Ads, via Google Analytics", entry);
    if (blocked) return page(head, blocked);
    const d = entry.data;
    if (!d.linked) return page(head, emptyCard(t("No Google Ads data yet"), t("Link the Google Analytics property to Google Ads; data shows the next day.")));
    const money = (value, currency) => new Intl.NumberFormat(UI.locale(), currency ? { style: "currency", currency } : { maximumFractionDigits: 2 }).format(value);
    return page(head, `
      <p class="small muted" style="margin:0 0 12px">${throughNote(d.through, "", d)}</p>
      <section class="tiles">
        ${d.costs.length ? d.costs.map((c) => UI.tile(`${t("Cost")}${d.costs.length > 1 ? ` · ${esc(c.currency || "")}` : ""}`, esc(money(c.cost, c.currency)), d.costs.length > 1 ? `<span class="ab">${t("Currencies aren't added together")}</span>` : "", { ic: "megaphone" })).join("") : UI.tile(t("Cost"), "—", "", { ic: "megaphone" })}
        ${UI.tile(t("Clicks"), UI.cnt(d.clicks), "", { ic: "mouse-pointer-click" })}
        ${UI.tile(t(W("Leads", d)), num(d.leads), "", { ic: "filter" })}
      </section>
      <section class="card"><div class="card-head"><h2>${t("Clicks")}</h2></div>${lineChart("ads", d.series.map((r) => r.day), [{ name: "Clicks", color: "var(--ch-1)", values: Object.fromEntries(d.series.map((r) => [r.day, r.clicks])) }])}</section>
      <section class="card" style="margin-top:14px"><div class="card-head"><h2>${t("Campaigns")}</h2></div>${dataTable("campaigns", [
        { key: "campaign", label: "Campaign", html: (r) => `<span dir="auto">${esc(r.campaign)}</span>` },
        { key: "cost", label: "Cost", num: true, html: (r) => esc(money(r.cost, r.currency)) },
        { key: "clicks", label: "Clicks", num: true }, { key: "sessions", label: "Visits", num: true }, { key: "leads", label: W("Leads", d), num: true },
      ], d.campaigns, { empty: "No campaigns in this period.", search: "Search campaigns" })}</section>
      <p class="note lv-note" style="margin-top:14px">${icon("info")}<span>${t("Exact Google Ads API data needs an approved developer token: not built.")}</span></p>`);
  }

  // ---- Resources --------------------------------------------------------------------------------
  const R = { rows: null, error: "", tag: "" };
  // Offered before anyone has tagged anything; tags already used come first, most used first.
  const STARTER_TAGS = ["Brief", "Report", "Guide", "Login", "Template", "Checklist"];
  const sameTag = (a, b) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
  function knownTags() {
    const count = new Map();
    (R.rows || []).forEach((r) => r.tags.forEach((tag) => {
      const name = [...count.keys()].find((k) => sameTag(k, tag)) || tag;
      count.set(name, (count.get(name) || 0) + 1);
    }));
    const used = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], UI.state.lang)).map(([tag]) => tag);
    return [...used, ...STARTER_TAGS.filter((tag) => !used.some((u) => sameTag(u, tag)))];
  }
  const tagForm = () => document.getElementById("lv-resource-form");
  const pickedTags = (form) => { try { return JSON.parse(form.elements.f_tags.value) || []; } catch { return []; } };
  function setTags(form, tags) { form.elements.f_tags.value = JSON.stringify(tags); drawTags(form); }
  function addTag(form, raw) {
    const tag = raw.split(/\s+/).filter(Boolean).join(" ").slice(0, 40);
    const tags = pickedTags(form);
    if (tag && !tags.some((x) => sameTag(x, tag))) tags.push(knownTags().find((k) => sameTag(k, tag)) || tag);
    form.querySelector("[data-rs-tag-input]").value = "";
    setTags(form, tags);
  }
  // Every tag goes through esc(): tags are typed by users.
  function drawTags(form) {
    if (!form) return;
    const tags = pickedTags(form), typed = form.querySelector("[data-rs-tag-input]").value.trim();
    UI.setHTML(form.querySelector("[data-rs-picked]"), tags.map((tag) => `<span class="rs-chip" dir="auto">${esc(tag)}<button type="button" class="rs-chip-x" data-rs-tag-remove="${esc(tag)}" aria-label="${esc(t("Remove {tag}").replace("{tag}", tag))}">${icon("x")}</button></span>`).join(""));
    const list = knownTags().filter((tag) => !typed || tag.toLocaleLowerCase().includes(typed.toLocaleLowerCase()));
    const isNew = typed && !knownTags().some((k) => sameTag(k, typed)) && !tags.some((k) => sameTag(k, typed));
    UI.setHTML(form.querySelector("[data-rs-tag-list]"), list.map((tag) => `<button type="button" class="chip" data-rs-tag-toggle="${esc(tag)}" aria-pressed="${tags.some((x) => sameTag(x, tag))}" dir="auto">${esc(tag)}</button>`).join("")
      + (isNew ? `<button type="button" class="chip rs-chip-new" data-rs-tag-toggle="${esc(typed)}" aria-pressed="false">${icon("plus")}${esc(t("Add “{tag}”").replace("{tag}", typed))}</button>` : ""));
  }
  async function loadResources() {
    try { R.rows = (await window.COMP.api("GET", "resources")).resources; R.error = ""; } catch (err) { R.rows = []; R.error = err.message === "Not in the sample data." ? "noServer" : err.message; }
    if (UI.state.route === "resources" && !UI.$("#panel:not(.closing)")) UI.render(); // a panel sliding shut after Save must not hold back the new row
  }
  function resourcesPage() {
    if (R.rows === null) loadResources();
    const head = UI.topbar(t("Resources"), t("Links and documents, per site"), `<button class="btn btn-main" data-lv-resource="new">${icon("plus")}${t("Add a resource")}</button>`, false);
    if (R.rows === null) return page(head, loadingCard());
    if (R.error === "noServer") return page(head, emptyCard(t("Needs the running app"), t("Opened as a file: no real data.")));
    if (R.error) return page(head, emptyCard(t("That didn't load"), esc(R.error)));
    const host = UI.siteHostPicked();
    const onSite = R.rows.filter((r) => !host || !r.host || r.host === host);
    if (!onSite.length) return page(head, emptyCard(t("No resources yet"), t("Keep briefs, login pages, reports and links here for the team.")));
    const used = knownTags().filter((tag) => onSite.some((r) => r.tags.some((x) => sameTag(x, tag))));
    if (R.tag && !used.some((tag) => sameTag(tag, R.tag))) R.tag = "";
    const rows = onSite.filter((r) => !R.tag || r.tags.some((x) => sameTag(x, R.tag)));
    const filter = used.length ? `<div class="chips" role="group" aria-label="${t("Filter by tag")}"><button class="chip" data-rs-filter="" aria-pressed="${!R.tag}">${t("All")}<b>${num(onSite.length)}</b></button>${used.map((tag) => `<button class="chip" data-rs-filter="${esc(tag)}" aria-pressed="${sameTag(tag, R.tag)}" dir="auto">${esc(tag)}<b>${num(onSite.filter((r) => r.tags.some((x) => sameTag(x, tag))).length)}</b></button>`).join("")}</div>` : "";
    return page(head, `<section class="card">${filter}${dataTable("resources", [
      { key: "title", label: "Title", html: (r) => `<button class="link-btn" data-lv-resource="${r.id}" dir="auto">${esc(r.title)}</button>${r.notes ? `<div class="lv-cat" dir="auto">${esc(r.notes)}</div>` : ""}` },
      { key: "tags", label: "Tags", get: (r) => (r.tags.length ? r.tags.join(", ") : null), html: (r) => (r.tags.length ? `<span class="rs-tags">${r.tags.map((tag) => `<span class="tag" dir="auto">${esc(tag)}</span>`).join("")}</span>` : `<span class="muted">—</span>`) },
      { key: "host", label: "Site", html: (r) => `<span class="mono" dir="auto">${esc(r.host || t("All sites"))}</span>` },
      { key: "url", label: "Link", html: (r) => (r.url ? `<a class="ext-link lv-url" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" title="${esc(t("Open"))}" aria-label="${esc(`${t("Open")} ${r.title || r.url}`)}">${icon("external-link")}</a>` : `<span class="muted">—</span>`) },
    ], rows, { csv: false, search: "Search resources" })}</section>`);
  }
  function resourcePanel(id, opener) {
    const r = id === "new" ? {} : R.rows.find((x) => String(x.id) === String(id)) || {};
    const editing = Boolean(r.id);
    const picked = UI.siteHostPicked();
    UI.openPanel(`${UI.panelHead(t(editing ? "Edit resource" : "Add a resource"), "")}
      <form class="panel-body" id="lv-resource-form" data-id="${r.id || ""}" novalidate>
        <label class="field"><span>${t("Title")}</span><input class="input" name="f_title" dir="auto" value="${esc(r.title || "")}" autocomplete="off"></label>
        <label class="field"><span>${t("Link")}</span><input class="input mono" type="url" inputmode="url" spellcheck="false" autocapitalize="off" name="f_url" dir="ltr" value="${esc(r.url || "")}" placeholder="https://" autocomplete="off"></label>
        <label class="field"><span>${t("Site")}</span><select class="select" name="f_site_id" style="width:100%">${window.ACCESS?.limited && !window.ACCESS.everySite() ? "" : `<option value="">${t("All sites")}</option>`}${window.SITES.filter((s) => s.realId).map((s) => `<option value="${s.realId}" ${(editing ? r.site_id === s.realId : picked === s.host) ? "selected" : ""}>${esc(s.host)}</option>`).join("")}</select></label>
        <div class="field"><span id="rs-tags-label">${t("Tags")}</span>
          <input type="hidden" name="f_tags" value="${esc(JSON.stringify(r.tags || []))}">
          <div class="input rs-tagbox" data-rs-tagbox><span class="rs-picked" data-rs-picked></span><input class="rs-tag-input" data-rs-tag-input dir="auto" maxlength="40" placeholder="${t("Type a tag, then Enter")}" aria-labelledby="rs-tags-label" autocomplete="off"></div>
          <div class="chips rs-tag-list" role="group" aria-label="${t("Your tags")}" data-rs-tag-list></div>
        </div>
        <label class="field"><span>${t("Notes")}</span><textarea class="input" name="f_notes" dir="auto" rows="3">${esc(r.notes || "")}</textarea></label>
        <div class="error" data-lv-form-error role="alert" hidden></div>
      </form>
      <div class="panel-foot"><button class="btn btn-main" data-lv-resource-save>${t("Save")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button>${editing ? `<button class="btn btn-ghost danger" data-lv-resource-del="${r.id}">${t("Delete")}</button>` : ""}</div>`, opener, { key: `resource|${id}`, reopen: () => resourcePanel(id, opener), after: () => drawTags(tagForm()) });
  }

  // ---- events -----------------------------------------------------------------------------------
  function bind() {
    document.addEventListener("click", async (e) => {
      const hit = (sel) => e.target.closest?.(sel);
      let el;
      if ((el = hit("[data-lv-connect]"))) { UI.openConnection(el.dataset.lvConnect); return; }
      if (hit("[data-lv-retry]")) { forget(); UI.render(); return; }
      if (hit("[data-lv-add-site]")) { document.getElementById("site-switch")?.click(); return; }
      if ((el = hit("[data-lv-metric]"))) { overviewMetric = el.dataset.lvMetric; UI.render(); return; }
      if ((el = hit("[data-lv-idea]"))) { trackIdeas([ideas.rows[Number(el.dataset.lvIdea)]], el); return; }
      if ((el = hit("[data-lv-idea-all]"))) { trackIdeas(ideas.fresh || [], el); return; }
      if ((el = hit("[data-lv-rules]"))) { rulesPanel(el); return; }
      if ((el = hit("[data-lv-ptab]"))) { // the simpler screens' page tabs and in-card tabs
        const [group, id] = el.dataset.lvPtab.split(":");
        TABS[group] = id;
        UI.render();
        document.querySelector(`[data-lv-ptab="${CSS.escape(el.dataset.lvPtab)}"]`)?.focus({ preventScroll: true });
        return;
      }
      if ((el = hit("[data-cr-tab]"))) {
        const [kind, tab] = el.dataset.crTab.split(":");
        crTabs[kind] = tab;
        UI.render();
        document.querySelector(`[data-cr-tab="${kind}:${tab}"]`)?.focus({ preventScroll: true });
        return;
      }
      if ((el = hit("[data-lv-table]"))) { const id = el.dataset.lvTable; LV.tables.set(id, !LV.tables.get(id)); UI.render(); document.querySelector(`[data-lv-table="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }); return; }
      if ((el = hit("[data-lv-sort]"))) {
        const id = el.dataset.lvSort, key = el.dataset.key, now = SORTS.get(id);
        SORTS.set(id, { key, dir: now?.key === key && now.dir === "desc" ? "asc" : "desc" });
        window.TP.reset(pagesKey(id));
        UI.render();
        document.querySelector(`[data-lv-sort="${CSS.escape(id)}"][data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
        return;
      }
      if ((el = hit("[data-lv-csv]"))) { downloadCsv(el.dataset.lvCsv); return; }
      if ((el = hit("[data-lv-collect]"))) {
        if (LV.reading || el.disabled) return;
        const site = UI.siteIdPicked(), ids = site ? [site] : window.SITES.map((s) => s.realId).filter(Boolean);
        const only = el.dataset.lvCollectSources ? { sources: el.dataset.lvCollectSources.split(",") } : {}; // "Refresh this one"
        el.disabled = true;
        document.dispatchEvent(new CustomEvent("seocc:collect-start"));
        try {
          const answers = await Promise.all(ids.map((id) => window.COMP.api("POST", `sites/${id}/collect`, only)));
          await watchReads(answers);
        } catch (err) { LV.reading = null; showReading(); UI.toast(err.message, { kind: "crit" }); }
        el.disabled = !!LV.reading;
        return;
      }
      if ((el = hit("[data-lv-rule-del]"))) {
        try { await window.COMP.api("DELETE", `rules/${el.dataset.lvRuleDel}`); await afterRuleChange(); UI.toast(t("Rule removed")); } catch (err) { UI.toast(err.message, { kind: "crit" }); }
        return;
      }
      if ((el = hit("[data-rs-filter]"))) { R.tag = el.dataset.rsFilter; UI.render(); document.querySelector(`[data-rs-filter="${CSS.escape(R.tag)}"]`)?.focus({ preventScroll: true }); return; }
      if ((el = hit("[data-rs-tag-remove]"))) { const form = tagForm(); setTags(form, pickedTags(form).filter((x) => !sameTag(x, el.dataset.rsTagRemove))); form.querySelector("[data-rs-tag-input]").focus(); return; }
      if ((el = hit("[data-rs-tag-toggle]"))) {
        const form = tagForm(), tag = el.dataset.rsTagToggle, tags = pickedTags(form);
        if (tags.some((x) => sameTag(x, tag))) setTags(form, tags.filter((x) => !sameTag(x, tag))); else addTag(form, tag);
        (form.querySelector(`[data-rs-tag-toggle="${CSS.escape(tag)}"]`) || form.querySelector("[data-rs-tag-input]")).focus({ preventScroll: true });
        return;
      }
      if (hit("[data-rs-tagbox]") && !hit("input")) { tagForm().querySelector("[data-rs-tag-input]").focus(); return; }
      if ((el = hit("[data-lv-resource]"))) { resourcePanel(el.dataset.lvResource, el); return; }
      if (hit("[data-lv-resource-save]")) { saveResource(); return; }
      if ((el = hit("[data-lv-resource-del]"))) {
        const id = el.dataset.lvResourceDel;
        try {
          await window.COMP.api("DELETE", `resources/${id}`);
          UI.forgetPanelForm(); UI.closePanel(); await loadResources();
          UI.toast(t("Resource deleted"), { kind: "info", undo: async () => { await window.COMP.api("POST", `resources/${id}/restore`, {}); loadResources(); } });
        } catch (err) { UI.toast(err.message, { kind: "crit" }); }
      }
    });
    document.addEventListener("submit", async (e) => {
      const form = e.target.closest?.("[data-lv-rule-form]");
      if (form) {
        e.preventDefault();
        const box = form.querySelector("[data-lv-rule-error]");
        box.hidden = true;
        const site = UI.siteIdPicked();
        try {
          await window.COMP.api("POST", "rules", { kind: form.dataset.lvRuleForm, pattern: form.elements.f_pattern.value, value: form.elements.f_value?.value, site_id: site || null });
          await afterRuleChange(); UI.toast(t("Rule added"));
        } catch (err) { box.textContent = t(err.message); box.hidden = false; form.elements.f_pattern.focus(); }
        return;
      }
      if (e.target.id === "lv-resource-form") { e.preventDefault(); saveResource(); return; }
      if (e.target.matches?.("[data-lv-ideas]")) {
        e.preventDefault();
        const f = e.target.elements;
        const picked = { country: f.f_country.value, language: f.f_language.value };
        ideas.query = f.f_q.value; ideas.picks[UI.siteHostPicked() || "all"] = picked;
        const ask = new URLSearchParams({ q: ideas.query, ...picked });
        try { ideas.rows = (await window.COMP.api("GET", `keyword-ideas?${ask}`)).ideas; ideas.error = ""; ideas.asked = picked; }
        catch (err) { ideas.rows = null; ideas.error = err.message; }
        UI.render();
      }
    });
    document.addEventListener("input", (e) => { if (e.target.matches?.("[data-rs-tag-input]")) drawTags(tagForm()); });
    document.addEventListener("keydown", (e) => {
      if (!e.target.matches?.("[data-rs-tag-input]")) return;
      const form = tagForm(), box = e.target;
      if ((e.key === "Enter" || e.key === ",") && box.value.trim()) { e.preventDefault(); addTag(form, box.value); }
      else if (e.key === ",") e.preventDefault();
      else if (e.key === "Backspace" && !box.value) { const tags = pickedTags(form); if (tags.length) { e.preventDefault(); setTags(form, tags.slice(0, -1)); } }
    });
    const chartAt = (e) => e.target.closest?.("[data-lv-chart]");
    document.addEventListener("pointermove", (e) => {
      const box = chartAt(e);
      if (!box) return;
      const info = LV.chartData.get(box.dataset.lvChart), rect = box.querySelector("svg").getBoundingClientRect();
      if (info) moveCross(box, Math.round(((e.clientX - rect.left) / rect.width) * (info.days.length - 1)));
    });
    document.addEventListener("pointerout", (e) => {
      const box = chartAt(e);
      if (box && !box.contains(e.relatedTarget) && document.activeElement !== box) { box.querySelector(".lv-tip").hidden = true; box.querySelector(".lv-cross").setAttribute("hidden", ""); }
    });
    document.addEventListener("keydown", (e) => {
      const box = chartAt(e);
      if (!box || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const count = LV.chartData.get(box.dataset.lvChart)?.days.length || 1;
      const at = box.dataset.at === undefined ? count - 1 : +box.dataset.at;
      moveCross(box, e.key === "ArrowLeft" ? at - 1 : e.key === "ArrowRight" ? at + 1 : e.key === "Home" ? 0 : count - 1);
    });
  }

  async function saveResource() {
    const form = document.getElementById("lv-resource-form");
    const box = form.querySelector("[data-lv-form-error]"), id = form.dataset.id;
    const typed = form.querySelector("[data-rs-tag-input]").value; // a tag typed without Enter still counts
    if (typed.trim()) addTag(form, typed);
    const body = { title: form.elements.f_title.value, url: form.elements.f_url.value, tags: pickedTags(form), notes: form.elements.f_notes.value, site_id: form.elements.f_site_id.value ? +form.elements.f_site_id.value : null };
    box.hidden = true;
    try {
      await window.COMP.api(id ? "PUT" : "POST", id ? `resources/${id}` : "resources", body);
      UI.forgetPanelForm(); UI.closePanel(); await loadResources(); UI.toast(t("Resource saved"));
    } catch (err) { box.textContent = t(err.message); box.hidden = false; }
  }

  // ---- register ---------------------------------------------------------------------------------
  window.SCREENS = window.SCREENS || {};
  const screen = (route, draw) => { window.SCREENS[route] = { page: draw }; };
  window.SCREENS.overview = { init(helpers) { UI = helpers; ({ t, esc, num, icon } = helpers); bind(); registerFirstViews(); }, page: overviewPage };
  /* Each screen's first-view answer, for SCREEN_DATA's warm-up and the menu hover: the same addresses load() asks, so a visit
     after the warm-up asks nothing. Read when they run, with the site and period of that moment. Off, nothing asks for them. */
  function registerFirstViews() {
    if (!window.SCREEN_DATA?.screen) return;
    [["channels", "metrics/channels"], ["conversions", "metrics/conversions"], ["content", "metrics/content"]]
      .forEach(([route, name]) => {
        window.SCREEN_DATA.screen(route, () => [`${name}?${periodQuery(route)}${INCLUDE[name] || ""}`]);
        // Google Analytics' last day, as the screen learns it on its visit (UI.range.end), so the warm-up asks those dates.
        window.SCREEN_DATA.learn?.(route, (path, d) => { const through = d?.through || (d?.period?.trimmed ? d.period.to : null); if (through) UI.range.end(route, through); });
      });
  }
  screen("channels", channelsPage); screen("conversions", conversionsPage); screen("content", contentPage);
  // Google Ads stays out of the menu for now (owner, 2026-11-05): it shows Soon. To bring it back, add screen("ads", adsPage). GA4 still stores its daily numbers, so nothing is lost meanwhile.
  screen("resources", resourcesPage); // AI search registers itself from ai-search-view.js
  Object.assign(LV, { load, pct, change, hiddenNote, siteOfPage, pageName, shortDay, fillIn, emptyCard, refreshBtn, readingWord, SOURCE_NAMES }); // for screens in their own files
  LV.dataTable = (...args) => dataTable(...args);
  LV.contentTab = () => (simple() ? TABS.content : "pages"); // export.js: the Content tracker tab exports its own file
  LV.ideasCard = (ctx) => ideasCard(ctx); // Keyword ideas sit on Keywords since 2026-11-09
  LV.stateCard = (...args) => stateCard(...args); // Overview's own file shows the same not-connected, failing and waiting cards

  const fr = {
    "Search table": "Rechercher dans le tableau", "Nothing matches.": "Rien ne correspond.", "Search pages": "Rechercher une page", "Search sites": "Rechercher un site",
    "Search queries": "Rechercher une requête", "Search resources": "Rechercher une ressource", "Search campaigns": "Rechercher une campagne",
    "Loading…": "Chargement…", "Needs the running app": "Il faut lancer l'application", "Opened as a file: no real data.": "Ouverte comme fichier : pas de vraies données.",
    "That didn't load": "Le chargement a échoué", "No site yet": "Pas encore de site", "Add a site to see its data.": "Ajoutez un site pour voir ses données.",
    "not connected now": "plus connecté", "These are the numbers saved before.": "Ce sont les chiffres enregistrés avant.",
    "not connected": "non connecté", "not used": "non utilisé", "stopped working": "ne fonctionne plus", "Google Analytics": "Google Analytics", "Search Console": "Search Console",
    "Connect it in Settings and pick this site's property.": "Connectez-le dans les réglages et choisissez la propriété du site.",
    "This site doesn't use it, as you said. Change that in Settings.": "Ce site ne l'utilise pas, comme indiqué. Modifiable dans les réglages.",
    "Open Settings": "Ouvrir les réglages", "Fix": "Corriger", "Connected. Waiting for data": "Connecté. En attente de données",
    "Arrives after the next run. Refresh data starts one now.": "Arrive après le prochain passage. Actualiser les données en lance un tout de suite.",
    "Refresh data": "Actualiser les données", "No change": "Sans changement", "No data in this period.": "Aucune donnée sur cette période.", "Chart": "Graphique", "Date": "Date",
    "Use the arrow keys to read each day.": "Utilisez les flèches pour lire chaque jour.", "Hide table": "Masquer le tableau", "Show table": "Afficher le tableau", "Download CSV": "Télécharger le CSV", "Show more": "Afficher plus",
    "Nothing in this period.": "Rien sur cette période.", "Your Google results, from Search Console": "Vos résultats Google, d'après la Search Console",
    "Search Console has data through": "La Search Console a des données jusqu'au", "Google Analytics has data through": "Google Analytics a des données jusqu'au", "Pick a longer or earlier period.": "Choisissez une période plus longue ou plus ancienne.",
    "Clicks": "Clics", "Impressions": "Impressions", "Click rate": "Taux de clic", "Average position": "Position moyenne", "Ranking queries": "Requêtes positionnées", "in this period": "sur cette période",
    "Last 12 months": "12 derniers mois", "Query": "Requête", "Change": "Évolution", "Queries gaining clicks": "Requêtes qui gagnent des clics", "Queries losing clicks": "Requêtes qui perdent des clics",
    "Pick a comparison above.": "Choisissez une comparaison en haut.", "No query gained clicks.": "Aucune requête n'a gagné de clics.", "No query lost clicks.": "Aucune requête n'a perdu de clics.", "Queries by position": "Requêtes par position",
    "Lags 2–3 days": "2 à 3 jours de retard",
    "Key event rate, at most: each key event counts as one visit, never more than the visits. Google Analytics' own rate counts visits with at least one key event, so it can be lower.": "Taux d'événements clés, au plus : chaque événement clé compte pour une visite, jamais plus que les visites. Le taux de Google Analytics compte les visites avec au moins un événement clé : il peut être plus bas.",
    "Visit and lead sources, from Google Analytics": "Sources des visites et des leads, d'après Google Analytics", "Visits": "Visites", "Leads": "Leads", "Lead rate": "Taux de lead", "Channels": "Canaux",
    "Visits by channel": "Visites par canal", "Every channel": "Tous les canaux", "Channel": "Canal", "Share": "Part", "Referring sites": "Sites référents", "Site": "Site", "No referring sites in this period.": "Aucun site référent sur cette période.",
    "Channel rules": "Règles de canaux", "Rename channels by source/medium (* = anything). Past days change too.": "Renommez les canaux par source/support (* = n'importe quoi). Les jours passés changent aussi.",
    "Channel name": "Nom du canal", "Matches": "Correspond à", "Add rule": "Ajouter la règle", "Remove": "Retirer", "Rule removed": "Règle retirée", "Rule added": "Règle ajoutée", "Type what the rule should match.": "Indiquez ce que la règle doit reconnaître.", "Type the channel name.": "Indiquez le nom du canal.",
    "Organic Search": "Recherche organique", "Direct": "Direct", "Referral": "Sites référents", "Organic Social": "Réseaux sociaux", "Paid Search": "Recherche payante", "Other": "Autre",
    // GA4's other default channel groups, which reached the French screen in English (test walk 2026-11-23: Organic Video, Paid Other).
    "Organic Video": "Vidéo organique", "Paid Other": "Autre payant", "Paid Social": "Réseaux sociaux payants", "Paid Video": "Vidéo payante", "Paid Shopping": "Shopping payant",
    "Organic Shopping": "Shopping organique", "Display": "Display", "Email": "E-mail", "Affiliates": "Affiliation", "Audio": "Audio", "SMS": "SMS", "Mobile Push Notifications": "Notifications push mobiles", "Cross-network": "Multiréseau",
    "From visit to lead. Counts only, no personal data.": "De la visite au lead. Des chiffres, aucune donnée personnelle.",
    "No key events. Mark your forms as key events in GA4.": "Aucun événement clé. Marquez vos formulaires comme événements clés dans GA4.",
    "Not set up": "Non configuré", "visits": "visites", "leads": "leads", "without a lead": "sans lead", "From visit to lead, by channel": "De la visite au lead, par canal", "Rate": "Taux", "Without a lead": "Sans lead", "Open": "Ouvrir",
    "Page types": "Types de pages", "Pages": "Pages", "Home page": "Page d'accueil", "Other pages": "Autres pages", "Pages that bring leads": "Pages qui apportent des leads", "No page brought a lead in this period.": "Aucune page n'a apporté de lead sur cette période.", "Page": "Page",
    "Every page and its results": "Chaque page et ses résultats", "All pages": "Toutes les pages", "page": "page", "pages": "pages", "Google clicks": "Clics Google", "Position": "Position", "AI visits": "Visites IA",
    "Visits and leads stay blank until Google Analytics is connected.": "Les visites et les leads restent vides tant que Google Analytics n'est pas connecté.",
    "Google clicks and position stay blank until Search Console is connected.": "Les clics Google et la position restent vides tant que la Search Console n'est pas connectée.",
    "Social networks": "Réseaux sociaux", "No visits from social networks in this period.": "Aucune visite des réseaux sociaux sur cette période.",
    "Google Analytics hid rows with few visits.": "Google Analytics a masqué des lignes à faibles visites.",
    "Visits from AI assistants, from Google Analytics": "Les visites des assistants IA, d'après Google Analytics", "AI assistant visits": "Visites des assistants IA", "By assistant": "Par assistant", "Assistant": "Assistant", "Landing pages": "Pages d'arrivée", "No landing pages in this period.": "Aucune page d'arrivée sur cette période.",
    "No AI visits in this period.": "Aucune visite IA sur cette période.", "That's a real zero: Google Analytics has data, and none of it came from the assistants listed below.": "C'est un vrai zéro : Google Analytics a des données, et aucune ne vient des assistants listés ci-dessous.",
    "Share of all visits": "Part des visites", "Whether your pages appear in Google's AI Overviews is in Competitors, under AI Overview watch.": "La présence de vos pages dans les AI Overviews de Google se trouve dans Concurrents, sous Suivi des AI Overviews.", "Open it": "L'ouvrir",
    "The AI list": "La liste IA", "Add a site to this list": "Ajouter un site à cette liste", "Add": "Ajouter",
    "Cost, clicks and leads from Google Ads, via Google Analytics": "Coût, clics et leads de Google Ads, via Google Analytics", "No Google Ads data yet": "Pas encore de données Google Ads",
    "Link the Google Analytics property to Google Ads; data shows the next day.": "Liez la propriété Google Analytics à Google Ads ; les données arrivent le lendemain.",
    "Cost": "Coût", "Currencies aren't added together": "Les devises ne sont pas additionnées", "Campaigns": "Campagnes", "Campaign": "Campagne", "No campaigns in this period.": "Aucune campagne sur cette période.",
    "Exact Google Ads API data needs an approved developer token: not built.": "Données exactes via l'API Google Ads : il faut un jeton développeur approuvé. Pas encore développé.",
    "Links and documents, per site": "Liens et documents, par site", "Add a resource": "Ajouter une ressource", "Edit resource": "Modifier la ressource", "No resources yet": "Pas encore de ressources",
    "Keep briefs, login pages, reports and links here for the team.": "Gardez ici les briefs, pages de connexion, rapports et liens pour l'équipe.",
    "Title": "Titre", "Link": "Lien", "Notes": "Notes", "Tags": "Étiquettes", "Type a tag, then Enter": "Tapez une étiquette, puis Entrée", "Your tags": "Vos étiquettes", "Remove {tag}": "Retirer {tag}", "Add “{tag}”": "Ajouter « {tag} »", "Filter by tag": "Filtrer par étiquette",
    "Tags are a list of words.": "Les étiquettes sont une liste de mots.", "A tag is 40 characters at most.": "Une étiquette fait 40 caractères au plus.", "A resource takes 20 tags at most.": "Une ressource prend 20 étiquettes au plus.", "Resource saved": "Ressource enregistrée", "Resource deleted": "Ressource supprimée",
    "A resource needs a title.": "Une ressource a besoin d'un titre.", "A link starts with https://.": "Un lien commence par https://.",
    "Page speed": "Vitesse des pages", "Device": "Appareil", "Phone": "Téléphone", "Computer": "Ordinateur", "Score": "Score", "Largest content (s)": "Plus grand contenu (s)", "Response (ms)": "Réactivité (ms)", "Layout shift": "Décalage visuel", "Measured on": "Mesuré sur", "Real visitors": "Vrais visiteurs", "Test run": "Test",
    "AI assistants": "Assistants IA", "AI search": "Recherche IA", "Open AI search": "Ouvrir Recherche IA",
    "Lab score": "Score labo", "Lab test only": "Test labo seulement", "Passed": "Réussi", "Failed": "Échoué", "whole site": "site entier", "this page": "cette page",
    "Keyword ideas": "Idées de mots-clés", "From Google's suggestions": "D'après les suggestions de Google", "A word or two": "Un ou deux mots", "Find ideas": "Trouver des idées", "Any language": "Toutes les langues", "Already tracked": "Déjà suivi", "Add": "Ajouter", "Add all": "Tout ajouter", "ideas": "idées", "Add to my keywords": "Ajouter à mes mots-clés",
    "Country and language start on the ones this site's keywords use most.": "Pays et langue partent de ceux que les mots-clés du site utilisent le plus.", "The country and language of these ideas.": "Le pays et la langue de ces idées.","No suggestions.": "Aucune suggestion.", "Type a word or two first.": "Saisissez d'abord un ou deux mots.",
    "Your SERP API's name, such as serp_api1.": "Le nom de votre SERP API, par exemple serp_api1.", "My zones": "Mes zones",
    "Robot key saved": "Clé robot enregistrée", "Paste a new one to replace it.": "Collez-en une nouvelle pour la remplacer.",
    "Settings and display": "Réglages et affichage", "Settings, display and sign out": "Réglages, affichage et déconnexion",
    "Clarity report": "Rapport Clarity", "from a Clarity download": "d'après un export Clarity", "older downloads are kept": "les exports plus anciens sont conservés",
    "Real visits": "Vraies visites", "Bots": "Robots", "Press a site to see its pages, referrers and problems.": "Appuyez sur un site pour voir ses pages, ses sites référents et ses problèmes.",
    "real visits": "vraies visites", "Clarity counted": "Clarity a compté", "and marked": "et en a marqué", "as bots": "comme robots", "No visits in this file.": "Aucune visite dans ce fichier.",
    "Referrer": "Site référent", "No referrers in this file.": "Aucun site référent dans ce fichier.", "visits from the site's own pages left out.": "visites venues des pages du site, écartées.",
    "What visitors ran into": "Ce qui a gêné les visiteurs", "Quick back clicks": "Retours rapides", "Excessive scrolling": "Défilement excessif", "JavaScript errors": "Erreurs JavaScript", "None.": "Aucune.",
    "Page speed, real visitors": "Vitesse des pages, vrais visiteurs", "Largest content": "Plus grand contenu", "Click response": "Réaction au clic", "good": "bon", "needs work": "à améliorer", "slow": "lent",
    "Browsers": "Navigateurs", "Unique visitors": "Visiteurs uniques", "Returning visitors' visits": "Visites de visiteurs revenus", "Pages per visit": "Pages par visite", "Active time per visit": "Temps actif par visite", "Smart event": "Événement intelligent",
    "No pages in this file.": "Aucune page dans ce fichier.", "Speed score": "Score de vitesse", "Top pages": "Pages les plus vues", "Referrers": "Sites référents", "Problems": "Problèmes", "Visitors": "Visiteurs",
    "Cited by Microsoft Copilot": "Cité par Microsoft Copilot", "Citations": "Citations", "Share of authority": "Part d'autorité", "Press a site to see which pages and questions.": "Appuyez sur un site pour voir quelles pages et quelles questions.",
    "Copilot cited this site": "Copilot a cité ce site", "time": "fois", "times": "fois", "most often": "le plus souvent", "Copilot didn't cite this site in this file's period.": "Copilot n'a pas cité ce site sur la période de ce fichier.",
    "No questions in this download. Include them in Clarity's export, then upload again.": "Pas de questions dans cet export. Incluez-les dans l'export Clarity, puis importez-le à nouveau.",
    "Question": "Question", "No questions in this file.": "Aucune question dans ce fichier.", "No cited pages in this file.": "Aucune page citée dans ce fichier.",
    "of Copilot's answers on these questions": "des réponses de Copilot sur ces questions", "counted by Clarity": "comptées par Clarity", "Cited pages": "Pages citées", "Questions": "Questions",
    "Clarity dashboard downloads can go in too.": "Les exports du tableau de bord Clarity peuvent aussi être ajoutés.",
    "Contact us": "Nous contacter", "Outbound click": "Clic sortant", "Submit form": "Envoi de formulaire", "Request quote": "Demande de devis", "Book": "Réservation", "Checkout": "Paiement", "See reviews": "Voir les avis",
    "Clarity sessions": "Sessions Clarity", "Scroll depth": "Profondeur de défilement", "Rage clicks": "Clics de rage", "Dead clicks": "Clics morts",
    "DuckDuckGo positions are being checked too, on free searches. They show on Keywords when it finishes.": "Les positions DuckDuckGo sont vérifiées aussi, avec des recherches gratuites. Elles s'affichent dans Mots-clés une fois terminé.",
    "Your pages are being read too, 3 seconds apart.": "Vos pages sont lues aussi, à 3 secondes d'intervalle.",
    "Reading the latest data…": "Lecture des dernières données…", "Nothing to read: connect a data source, or it's already running.": "Rien à lire : connectez une source de données, ou la lecture est en cours.",
  };
  Object.assign(fr, {
    "Reading {done} of {total}…": "Lecture {done} sur {total}…",
    "Clarity already read today. Next read after midnight UTC.": "Clarity déjà lu aujourd'hui. Prochaine lecture après minuit UTC.",
    "Still reading in the background. Press Refresh data again in a few minutes.": "Lecture en cours en arrière-plan. Appuyez de nouveau sur Actualiser les données dans quelques minutes.",
    "{ok} of {total} read.": "{ok} sur {total} lus.",
    "{names} failed: the card on the page says why.": "{names} a échoué : la carte sur la page explique pourquoi.", "Fix it": "Corriger",
    "Up to date.": "À jour.", "Updated: {names}.": "Mis à jour : {names}.",
  });
  Object.assign(fr, { // Content's fixes and the simpler Channels, Conversions and Content (2026-11-12)
    "Unknown page (not set)": "Page inconnue (not set)", "Jump links: {n} impressions": "Liens vers une section : {n} impressions",
    "Google Analytics couldn't tell which page these visits landed on, often visits that left before the page loaded.": "Google Analytics n'a pas pu dire sur quelle page ces visites sont arrivées, souvent des visites parties avant le chargement de la page.",
    "Google Analytics and Search Console": "Google Analytics et Search Console", "Most visits: {name}": "Le plus de visites : {name}", "Google clicks: {a} – {b}.": "Clics Google : {a} – {b}.", "No rules yet.": "Pas encore de règle.",
    "From visit to lead, by channel and by page.": "De la visite au lead, par canal et par page.",
    "Counts only: no personal data comes into this app.": "Des chiffres seulement : aucune donnée personnelle n'entre dans cette application.",
    "Google Analytics hid some rows with few visits, so small numbers may be missing. A longer period may show them.": "Google Analytics a masqué des lignes à faibles visites : de petits nombres peuvent manquer. Une période plus longue peut les montrer.",
    "{n} visits didn't become a lead": "{n} visites ne sont pas devenues un lead", "waiting for data": "en attente de données",
    "Live data": "En direct", "Clarity download": "Export Clarity", "No speed test yet. Refresh data runs one.": "Pas encore de test de vitesse. Actualiser les données en lance un.",
    "1 day has Clarity sessions only: no scroll depth or clicks.": "1 jour n'a que des sessions Clarity : ni défilement ni clics.",
    "{n} days have Clarity sessions only: no scroll depth or clicks.": "{n} jours n'ont que des sessions Clarity : ni défilement ni clics.",
    "X (Twitter)": "X (Twitter)",
  });
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
