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
  const pct = (v, digits = 1) => (v === null || v === undefined ? "—" : `${String(+(v * 100).toFixed(digits)).replace(".", UI.state.lang === "fr" ? "," : ".")} %`);
  const shortDay = (day) => new Intl.DateTimeFormat(UI.locale(), { day: "numeric", month: "short" }).format(new Date(`${day}T00:00:00`));
  const dayDate = (d) => { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const shift = (day, by) => { const d = new Date(`${day}T00:00:00`); d.setDate(d.getDate() + by); return dayDate(d); };

  /* The app's one date range (UI.range), as days. The server trims an end past its last day and answers the dates it used. */
  function periodQuery() {
    const parts = [UI.range.days()];
    const site = UI.siteIdPicked();
    if (site) parts.push(`site_id=${site}`);
    return parts.join("&");
  }

  /* What a screen has now. The first call fetches and redraws when the answer comes, so a page never waits on a blank. */
  function load(name) {
    const key = `${name}?${periodQuery()}`;
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
  const forget = () => LV.cache.clear();
  LV.forget = forget;
  window.addEventListener("seocc:site-added", () => forget()); // an answer from before said "No site yet"

  // ---- states ---------------------------------------------------------------------------------
  const loadingCard = () => UI.skeleton("page");
  const emptyCard = (title, body, action = "") => `<section class="card"><div class="empty"><h3>${esc(title)}</h3><p>${body}</p>${action ? `<div style="margin-top:12px">${action}</div>` : ""}</div></section>`;
  const connectBtn = (id, word = "Connect") => `<button class="btn btn-main" data-lv-connect="${id}">${t(word)}</button>`;
  const NAMES = { gsc: "Search Console", ga4: "Google Analytics" };

  function stateCard(entry, source) {
    if (entry.loading) return loadingCard();
    if (entry.noServer) return emptyCard(t("Needs the running app"), t("Opened as a plain file there's no real data to show here."));
    if (entry.error) return UI.failCard(entry.error, { retry: "data-lv-retry" });
    const name = t(NAMES[source]);
    const d = entry.data;
    if (d.state === "no_sites") return emptyCard(t("No site yet"), t("Add a site to see its data."), `<button class="btn btn-main" id="site-switch-hint" data-lv-add-site>${t("Add a site")}</button>`);
    if (d.state === "not_connected") return emptyCard(`${name}: ${t("not connected")}`, t("Connect it in Settings, and pick which property this site uses."), connectBtn("google"));
    if (d.state === "not_used") return emptyCard(`${name}: ${t("not used")}`, t("You said this site doesn't use it, so there's nothing to show. That's fine. You can change this in Settings."), connectBtn("google", "Open Settings"));
    if (d.state === "failing") {
      // The plain sentence and what to do first; Google's own long message folds away below.
      const fix = window.FIX?.html(d.error || "", { tool: name, retry: "refresh" }, { summary: true, said: true }) || esc(d.error || "");
      return `<section class="card"><div class="empty"><h3>${esc(`${name}: ${t("stopped working")}`)}</h3>${fix}<div style="margin-top:12px">${connectBtn("google", "Fix")}</div></div></section>`;
    }
    if (d.state === "waiting") return emptyCard(t("Connected. Waiting for its first data"), t("It arrives after the next run. Press Refresh data to start one now."), refreshBtn(true));
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
    const pagesNote = answers.some((a) => a.pages) ? ` ${t(PAGES_NOTE)}` : "";
    const laterNote = (clarityLater ? ` ${t("Clarity was already read today. It reads again after midnight UTC.")}` : "") + pagesNote;
    if (!ids.length) {
      UI.toast(pagesNote ? laterNote.trim() : t("Nothing to read yet: connect a data source first, or it's already running.") + laterNote, { kind: pagesNote ? "good" : "info" });
      return;
    }
    UI.toast(t("Reading the latest data. It appears here when it arrives.") + pagesNote, { kind: "good" });
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
    if (!finished) { UI.toast(t("Still reading in the background. The numbers appear here when it finishes: press Refresh data again in a few minutes.") + laterNote, { kind: "info" }); return; }
    if (failed.length) {
      // Which source failed and why, in the message itself, with the button that opens its connection.
      const why = failed.map((s) => { const name = t(SOURCE_NAMES[s.source] || s.source), plain = window.FIX?.explain?.(s.error, { tool: name, retry: "refresh" })?.summary; return `${name}: ${t(plain || UI.errorWords(s.error))}`; });
      const google = failed.some((s) => ["gsc", "ga4", "pagespeed"].includes(s.source));
      UI.toast(`${fillIn(t("{ok} of {total} read."), { ok: ids.length - failed.length, total: ids.length })} ${[...new Set(why)].join(" ")}${laterNote}`, { kind: "crit", stay: true, undo: () => UI.openConnection(google ? "google" : failed[0].source), undoLabel: t("Fix it") });
      return;
    }
    const read = [...new Set(entries.filter((e) => e.job_id).map((e) => t(SOURCE_NAMES[e.source] || e.source)))];
    UI.toast((read.length ? fillIn(t("Updated: {names}."), { names: read.join(", ") }) : t("Updated with the latest data.")) + laterNote, { kind: "good" });
  }
  const PAGES_NOTE = "Your site's pages are being read too. That takes a while: it waits 3 seconds between pages.";
  LV.PAGES_NOTE = PAGES_NOTE;
  const SOURCE_NAMES = { gsc: "Search Console", ga4: "Google Analytics", bing: "Bing Webmaster", yandex: "Yandex Webmaster", clarity: "Microsoft Clarity", pagespeed: "PageSpeed Insights" };
  LV.watchReads = watchReads;
  /* Both periods in words, from the dates the server really used, then how far the data goes. */
  const throughNote = (through, extra = "", d = null) => {
    const p = d?.period, bits = [];
    if (p?.from && p?.to) bits.push(`${esc(UI.fmtRange(p.from, p.to))}${p.compare_from && p.compare_to ? ` ${t("vs")} ${esc(UI.fmtRange(p.compare_from, p.compare_to))}` : ""}`);
    if (through) { bits.push(`${t("Data through")} ${esc(shortDay(through))}`); UI.range.end(UI.state.route, through); }
    if (extra) bits.push(esc(t(extra)));
    return bits.length ? `<span class="small muted">${bits.join(" · ")}</span>` : "";
  };
  const hiddenNote = (hid) => (hid ? `<p class="note lv-note">${icon("info")}<span>${t("Google Analytics hid some rows with few visits, so small numbers may be missing. A longer period may show them.")}</span></p>` : "");

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
  /* marks: { day: count } draws a dot on the first line for those days, such as a lead in that week; markName names it in the
     read-out. dayLabel: how a day reads in the read-out and the table, such as "Week to 9 Nov". */
  function lineChart(id, days, series, { invert = false, unit = "", legend = true, marks = null, markName = "Leads", dayLabel = null } = {}) {
    if (!days.length) return `<div class="empty"><p>${t("No data in this period.")}</p></div>`;
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
    const every = Math.max(1, Math.floor(days.length / 5));
    const picked = days.filter((_, i) => i === 0 || i === days.length - 1 || (i % every === 0 && i < days.length - every / 2));
    const ticks = picked.length > 6 ? [...picked.slice(0, 5), days[days.length - 1]] : picked; // the last day always has its date
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
        <div class="lv-axis" aria-hidden="true">${ticks.map((d) => `<span>${esc(shortDay(d))}</span>`).join("")}</div>
      </div>
      ${series.length > 1 && legend ? `<div class="lv-legend">${series.map((s) => `<span><i class="lv-key" style="background:${s.color}"></i>${esc(t(s.name))}</span>`).join("")}</div>` : ""}
      <div class="lv-foot"><button class="link-btn" data-lv-table="${id}" aria-expanded="${open ? "true" : "false"}">${t(open ? "Hide the table" : "Show as a table")}</button></div>
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
  function dataTable(id, columns, rows, { csv = false, empty = "Nothing in this period.", search = "Search the table" } = {}) { // downloads are the Export button in the top bar (export.js)
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
    if (!shown.length) return `${box}<div class="empty"><p>${t("Nothing matches the search.")}</p></div>`;
    const body = view.rows.map((row) => `<tr style="cursor:default">${columns.map((c) => {
      const v = value(c, row);
      return `<td class="${c.num ? "c" : ""}" data-label="${esc(t(c.label))}">${c.html ? c.html(row) : v === null || v === undefined ? `<span class="muted">—</span>` : c.num ? num(v) : esc(v)}</td>`;
    }).join("")}</tr>`).join("");
    return `${box}<div class="table-wrap" style="box-shadow:none"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${TP.footer(key, view)}
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
  const page = (head, body) => `${head}<div class="content page-enter">${body}</div>`;
  /* On All sites, /contact/ can be on several sites, so a page row says whose it is. It sorts and exports that way too. */
  const siteOfPage = (r) => (!UI.siteHostPicked() && r.host ? `<div class="lv-cat mono" dir="auto">${esc(r.host)}</div>` : "");
  const pageName = (r) => (!UI.siteHostPicked() && r.host ? `${r.host}${r.path}` : r.path);

  // ---- Overview ---------------------------------------------------------------------------------
  const METRICS = [["clicks", "Clicks"], ["impressions", "Impressions"], ["position", "Average position"]];
  let overviewMetric = "clicks";
  function overviewPage() {
    const entry = load("metrics/overview");
    const blocked = stateCard(entry, "gsc");
    const head = topbarFor("Overview", "How the site does on Google, from Search Console", entry);
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
        <section class="card"><div class="card-head"><h2>${t("Queries gaining clicks")}</h2></div>${compareOff ? `<div class="empty"><p>${t("Pick a comparison above to see this.")}</p></div>` : moves("gaining", d.gaining, "No query gained clicks.")}</section>
        <section class="card"><div class="card-head"><h2>${t("Queries losing clicks")}</h2></div>${compareOff ? `<div class="empty"><p>${t("Pick a comparison above to see this.")}</p></div>` : moves("losing", d.losing, "No query lost clicks.")}</section>
      </div>
      <section class="card" style="margin-top:14px"><div class="card-head"><h2>${t("Queries by position")}</h2></div>${bars(d.distribution, { value: (r) => r.queries, label: (r) => r.bucket })}</section>
      ${speedCard()}${ideasCard()}`);
  }

  function speedCard() {
    const entry = load("metrics/speed");
    if (entry.loading || entry.error || !entry.data.runs.length) return "";
    const ms = (v) => (v === null || v === undefined ? null : Math.round(v / 100) / 10);
    return `<section class="card" style="margin-top:14px"><div class="card-head"><h2>${t("Page speed")}</h2><span class="end small muted">${t("Home page")}</span></div>${dataTable("speed", [
      { key: "host", label: "Site", html: (r) => `<span class="mono" dir="auto">${esc(r.host)}</span>` },
      { key: "strategy", label: "Device", get: (r) => t(r.strategy === "mobile" ? "Phone" : "Computer") },
      { key: "performance", label: "Score", num: true },
      { key: "lcp_ms", label: "Largest content (s)", num: true, get: (r) => ms(r.lcp_ms), html: (r) => (r.lcp_ms === null ? `<span class="muted">—</span>` : decimal(ms(r.lcp_ms))) },
      { key: "inp_ms", label: "Response (ms)", num: true },
      { key: "cls", label: "Layout shift", num: true, html: (r) => (r.cls === null ? `<span class="muted">—</span>` : decimal(Math.round(r.cls * 100) / 100)) },
      { key: "field_data", label: "Measured on", get: (r) => t(r.field_data ? "Real visitors" : "A test run") },
    ], entry.data.runs, { csv: false })}</section>`;
  }

  const ideas = { query: "", rows: null, error: "" };
  const ideasCard = () => `<section class="card" style="margin-top:14px"><div class="card-head"><h2>${t("Keyword ideas")}</h2><span class="end small muted">${t("From Google's suggestions. Free and unofficial, so it can stop working.")}</span></div>
      <form class="lv-rule-form" data-lv-ideas style="border-top:0"><input class="input" name="f_q" dir="auto" value="${esc(ideas.query)}" placeholder="${t("A word or two")}" aria-label="${t("A word or two")}" autocomplete="off"><button class="btn btn-small" type="submit">${t("Find ideas")}</button></form>
      ${ideas.error ? `<p class="error" style="padding:0 18px 12px;margin:0" role="alert">${esc(t(ideas.error))}</p>` : ""}
      ${ideas.rows ? (ideas.rows.length ? `<ul class="rows">${ideas.rows.map((word) => `<li><div class="what"><div class="t mono" dir="auto">${esc(word)}</div></div></li>`).join("")}</ul>` : `<div class="empty" style="padding:20px"><p>${t("No suggestions for that.")}</p></div>`) : ""}</section>`;

  // ---- Channels ---------------------------------------------------------------------------------
  function rulesCard(kind, title, hint, patternHint, valueHint, rules) {
    return `<section class="card" style="margin-top:14px"><div class="card-head"><h2>${t(title)}</h2></div>
      <p class="help" style="padding:10px 18px 2px;margin:0">${t(hint)}</p>
      ${rules.map((r) => `<div class="lv-rule"><span class="grow mono" dir="auto">${esc(r.pattern)}${r.value ? ` → ${esc(r.value)}` : ""}</span><button class="btn btn-small btn-ghost" data-lv-rule-del="${r.id}" aria-label="${t("Remove")}: ${esc(r.pattern)}">${t("Remove")}</button></div>`).join("")}
      <form class="lv-rule-form" data-lv-rule-form="${kind}"><input class="input mono" name="f_pattern" placeholder="${esc(patternHint)}" aria-label="${t("Matches")}" autocomplete="off">${valueHint ? `<input class="input" name="f_value" placeholder="${esc(t(valueHint))}" aria-label="${t(valueHint)}" autocomplete="off">` : ""}<button class="btn btn-small" type="submit">${t("Add rule")}</button><span class="error" data-lv-rule-error hidden></span></form></section>`;
  }

  function channelsPage() {
    const entry = load("metrics/channels");
    const blocked = stateCard(entry, "ga4");
    const head = topbarFor("Channels", "Where visits and leads come from, from Google Analytics", entry);
    if (blocked) return page(head, blocked);
    const d = entry.data;
    if (!d.channels.length) return page(head, emptyCard(t("No data in this period."), `${t("Google Analytics has data through")} ${esc(d.through ? shortDay(d.through) : "—")}.`));
    const days = d.series.map((r) => r.day);
    const series = d.series_names.map((name) => ({ name, color: colourOf(name), values: Object.fromEntries(d.series.map((r) => [r.day, r.values[name] ?? 0])) }));
    const swatch = (name) => `<i class="lv-key" style="background:${colourOf(name)}"></i>${esc(t(name))}`;
    // The server starts fetching these sites' icons when this data is asked for, so look for them once per list.
    const referrerList = d.referrers.map((r) => r.domain).join(",");
    if (referrerList !== LV.referrersWatched) { LV.referrersWatched = referrerList; window.COMP?.refreshLogos?.({ watch: true }); }
    return page(head, `
      <p class="small muted" style="margin:0 0 12px">${throughNote(d.through, "", d)}</p>${hiddenNote(d.hid_rows)}
      <section class="tiles">
        ${UI.tile(t("Visits"), UI.cnt(d.total.sessions), change(d.total.sessions, d.before?.sessions), { ic: "activity" })}
        ${UI.tile(t("Leads"), num(d.total.leads), change(d.total.leads, d.before?.leads), { ic: "filter" })}
        ${UI.tile(t("Lead rate"), pct(d.total.sessions ? d.total.leads / d.total.sessions : null), "", { ic: "percent" })}
        ${UI.tile(t("Channels"), UI.cnt(d.channels.length), "", { ic: "layers" })}
      </section>
      <section class="card"><div class="card-head"><h2>${t("Visits by channel")}</h2></div>${lineChart("channels", days, series)}</section>
      <section class="card" style="margin-top:14px"><div class="card-head"><h2>${t("Every channel")}</h2></div>${dataTable("channels", [
        { key: "channel", label: "Channel", html: (r) => swatch(r.channel) },
        { key: "sessions", label: "Visits", num: true },
        { key: "share", label: "Share", num: true, get: (r) => r.share, html: (r) => pct(r.share) },
        { key: "leads", label: "Leads", num: true },
        { key: "rate", label: "Lead rate", num: true, get: (r) => r.rate, html: rateCell },
        { key: "change", label: "Change", num: true, html: (r) => (r.change === null ? `<span class="muted">—</span>` : `<span class="${r.change >= 0 ? "good" : "crit"} d-pill">${r.change >= 0 ? "+" : "−"}${num(Math.abs(r.change))}%</span>`) },
      ], d.channels)}</section>
      <section class="card" style="margin-top:14px"><div class="card-head"><h2>${t("Referring sites")}</h2></div>${dataTable("referrers", [
        { key: "domain", label: "Site", html: (r) => `<span class="with-logo">${UI.siteLogo(r.domain, 16)}<span class="logo-text mono" dir="auto">${esc(r.domain)}</span></span>` },
        { key: "sessions", label: "Visits", num: true },
        { key: "leads", label: "Leads", num: true },
      ], d.referrers, { empty: "No referring sites in this period.", search: "Search sites" })}</section>
      ${rulesCard("channel", "Channel rules", "Rename where a visit counts. A change applies to past days too. Match source/medium, with * for anything.", "chatgpt.com/*", "Channel name", d.rules)}`);
  }

  // ---- Conversions ------------------------------------------------------------------------------
  function conversionsPage() {
    const entry = load("metrics/conversions");
    const blocked = stateCard(entry, "ga4");
    const head = topbarFor("Conversions", "From visit to lead. Counts only: no personal data comes into this app", entry);
    if (blocked) return page(head, blocked);
    const d = entry.data;
    if (!d.sessions) return page(head, emptyCard(t("No data in this period."), `${t("Google Analytics has data through")} ${esc(d.through ? shortDay(d.through) : "—")}.`));
    const setUp = d.key_events_set_up ? "" : `<p class="note warn lv-note">${icon("triangle-alert")}<span>${t("No key events found. Set up your forms as key events in Google Analytics, and leads appear here.")}</span></p>`;
    const funnel = d.funnel.map((r) => {
      const max = Math.max(...d.funnel.map((x) => x.sessions), 1);
      return `<div><div class="small" style="display:flex;justify-content:space-between;gap:8px"><b dir="auto">${esc(t(r.channel))}</b><span>${num(r.sessions)} ${t("visits")} → ${num(r.leads)} ${t("leads")} · ${pct(r.rate)}</span></div>
        <div class="lv-bar" style="grid-template-columns:1fr"><span class="track"><i style="width:${Math.max(r.sessions ? 2 : 0, (r.sessions / max) * 100)}%"></i></span></div>
        <div class="small muted">${num(r.lost)} ${t("visits didn't become a lead")}</div></div>`;
    }).join("");
    return page(head, `
      <p class="small muted" style="margin:0 0 12px">${throughNote(d.through, "", d)}</p>${hiddenNote(d.hid_rows)}${setUp}
      <section class="tiles">
        ${UI.tile(t("Visits"), UI.cnt(d.sessions), "", { ic: "activity" })}
        ${UI.tile(t("Leads"), d.key_events_set_up ? num(d.leads) : "—", d.key_events_set_up ? "" : `<span class="ab">${t("Key events not set up")}</span>`, { ic: "filter" })}
        ${UI.tile(t("Lead rate"), d.key_events_set_up ? pct(d.rate) : "—", "", { ic: "percent" })}
      </section>
      <section class="card"><div class="card-head"><h2>${t("From visit to lead, by channel")}</h2></div><div class="lv-funnel">${funnel}</div></section>
      <div class="lv-two" style="margin-top:14px">
        <section class="card"><div class="card-head"><h2>${t("Page types")}</h2></div>${dataTable("types", [
          { key: "type", label: "Type", get: (r) => t(r.type), html: (r) => `<span dir="auto">${esc(t(r.type))}</span>` },
          { key: "pages", label: "Pages", num: true }, { key: "sessions", label: "Visits", num: true }, { key: "leads", label: "Leads", num: true },
          { key: "rate", label: "Lead rate", num: true, html: rateCell },
        ], d.page_types, { csv: false })}</section>
        <section class="card"><div class="card-head"><h2>${t("Pages that bring leads")}</h2></div>${dataTable("converting", [
          { key: "path", label: "Page", get: pageName, html: (r) => `${PageLink.html(r.path, { host: r.host, cls: "mono lv-url" })}${siteOfPage(r)}` },
          { key: "sessions", label: "Visits", num: true }, { key: "leads", label: "Leads", num: true }, { key: "rate", label: "Lead rate", num: true, html: rateCell },
        ], d.pages, { csv: false, empty: "No page brought a lead in this period.", search: "Search pages" })}</section>
      </div>`);
  }

  // ---- Content ----------------------------------------------------------------------------------
  function contentPage() {
    const entry = load("metrics/content");
    const head = topbarFor("Content", "Every page: visits, leads, Google clicks, position and AI visits", entry);
    if (entry.loading || entry.error) return page(head, stateCard(entry, "ga4"));
    const d = entry.data;
    // Read before the "no pages" answer: Clarity has its own days, such as old imported ones with no Google data beside them.
    const heat = load("metrics/clarity");
    const known = (value) => (value === null ? "—" : UI.cnt(value)); // old recordings days never had clicks: unknown isn't zero
    const sessionsOnly = heat.data?.sessions_only_days;
    const clarityCard = heat.data?.has_data ? `<section class="tiles">
        ${UI.tile(t("Clarity sessions"), UI.cnt(heat.data.sessions), `<span class="ab">${t("Data through")} ${esc(shortDay(heat.data.through))}</span>`, { ic: "activity" })}
        ${UI.tile(t("Scroll depth"), heat.data.scroll_depth === null ? "—" : `${decimal(heat.data.scroll_depth)} %`, "", { ic: "layers" })}
        ${UI.tile(t("Rage clicks"), known(heat.data.rage_clicks), "", { ic: "mouse-pointer-click" })}
        ${UI.tile(t("Dead clicks"), known(heat.data.dead_clicks), "", { ic: "mouse-pointer-click" })}
      </section>${sessionsOnly ? `<p class="note lv-note">${icon("info")}<span>${num(sessionsOnly)} ${t(sessionsOnly === 1 ? "day here has Clarity sessions only: scroll depth and clicks weren't recorded for it." : "days here have Clarity sessions only: scroll depth and clicks weren't recorded for them.")}</span></p>` : ""}` : "";
    if (!d.pages.length) {
      const blocked = stateCard({ data: { ...d, state: d.ga4.state === "ok" ? d.gsc.state : d.ga4.state, through: d.ga4.through, error: d.ga4.error || d.gsc.error } }, d.ga4.state === "ok" ? "gsc" : "ga4");
      return page(head, clarityReportCard("dashboard") + clarityCard + (blocked || emptyCard(t("No data in this period."), t("Pick a longer or earlier period."))));
    }
    const missing = d.ga4.state !== "ok" ? "Visits and leads need Google Analytics. Until it's connected, they stay blank." : d.gsc.state !== "ok" ? "Google clicks and position need Search Console. Until it's connected, they stay blank." : "";
    return page(head, `
      ${missing ? `<p class="note lv-note">${icon("info")}<span>${t(missing)}</span></p>` : ""}${hiddenNote(d.hid_rows)}${clarityReportCard("dashboard")}${clarityCard}
      <section class="card"><div class="card-head"><h2>${t("All pages")}</h2><span class="end small muted">${num(d.total_pages)} ${t(d.total_pages === 1 ? "page" : "pages")}</span></div>${dataTable("content", [
        { key: "path", label: "Page", get: pageName, html: (r) => `<div class="mono lv-url">${PageLink.html(r.path, { host: r.host })}</div>${siteOfPage(r)}<div class="lv-cat" dir="auto">${esc(t(r.category))}</div>${UI.relatedTag?.({ host: r.host || UI.siteHostPicked() || "", page: r.path }) || ""}` },
        { key: "sessions", label: "Visits", num: true }, { key: "leads", label: "Leads", num: true }, { key: "clicks", label: "Google clicks", num: true },
        { key: "position", label: "Position", num: true, html: (r) => decimal(r.position) }, { key: "ai", label: "AI visits", num: true },
      ], d.pages, { search: "Search pages" })}</section>
      <section class="card" style="margin-top:14px"><div class="card-head"><h2>${t("Traffic from social networks")}</h2></div>${d.social.length ? bars(d.social, { value: (r) => r.sessions, label: (r) => r.source }) : `<div class="empty"><p>${t("No visits from social networks in this period.")}</p></div>`}</section>
      ${speedCard()}`); // Page speed moved here from Overview on 2026-11-09: it's about pages, not Google results
  }

  // ---- Clarity downloads: totals for the file's own period, shown apart from the period picked above ----
  const crTabs = { dashboard: "pages" };
  const pctOf = (v) => (v === null || v === undefined ? "—" : `${decimal(Math.round(v * 10) / 10)} %`);
  const realVisits = (d) => (d.sessions === null || d.sessions === undefined ? null : Math.max(0, d.sessions - (d.bot_sessions || 0)));
  const spanOf = (r) => `${esc(shortDay(r.period_start))} – ${esc(shortDay(r.period_end))}`;
  const grade = (value, good, poor, text) => (value === null || value === undefined ? "—" : `<span class="${value <= good ? "good" : value <= poor ? "warn" : "crit"}">${text}</span> <span class="small muted">${t(value <= good ? "good" : value <= poor ? "needs work" : "slow")}</span>`);
  const crTabRow = (kind, tabs) => `<div class="tabs" role="tablist" aria-label="${t("Clarity report")}" style="margin:6px 18px 0">${tabs.map(([id, word]) => `<button class="tab" role="tab" data-cr-tab="${kind}:${id}" aria-selected="${crTabs[kind] === id}">${t(word)}</button>`).join("")}</div>`;
  const pickSite = (s, kind) => {
    const ui = window.SITES.find((x) => x.realId === s.site_id)?.id;
    return `${ui ? `<button class="link-btn mono" data-pick-site="${esc(ui)}" dir="ltr">${esc(s.host)}</button>` : `<span class="mono" dir="ltr">${esc(s.host)}</span>`}<div class="lv-cat">${spanOf(s[kind])}</div>`;
  };
  const uploadHint = () => `<p class="note lv-note">${icon("info")}<span>${t("Clarity's own dashboard downloads can go in too: Settings → Microsoft Clarity → Clarity dashboard downloads.")} <button class="link-btn" data-lv-connect="clarity">${t("Open it")}</button></span></p>`;

  function clarityReportCard(kind) {
    const entry = load("metrics/clarity-reports");
    if (!entry.data) return "";
    const sites = entry.data.sites.filter((s) => s[kind]);
    if (!sites.length) return uploadHint();
    const one = sites.length === 1 && UI.siteIdPicked();
    const r = sites[0][kind];
    const older = sites.some((s) => s[kind].older) ? ` · ${t("older downloads are kept")}` : "";
    const headOf = (title) => `<div class="card-head"><h2>${t(title)}</h2><span class="end small muted">${one ? `${spanOf(r)} · ` : ""}${t("from a Clarity download")}${older}</span></div>`;
    if (kind === "dashboard") {
      if (!one) {
        return `<section class="card" style="margin-bottom:14px">${headOf("Clarity report")}${dataTable("cr-sites", [
          { key: "host", label: "Site", html: (s) => pickSite(s, "dashboard") },
          { key: "real", label: "Real visits", num: true, get: (s) => realVisits(s.dashboard) },
          { key: "bots", label: "Bots", num: true, get: (s) => s.dashboard.bot_sessions },
          { key: "scroll", label: "Scroll depth", num: true, get: (s) => s.dashboard.scroll_depth, html: (s) => pctOf(s.dashboard.scroll_depth) },
          { key: "dead", label: "Dead clicks", num: true, get: (s) => s.dashboard.insights?.dead_clicks?.share, html: (s) => pctOf(s.dashboard.insights?.dead_clicks?.share) },
        ], sites, { csv: false })}<p class="small muted" style="margin:0;padding:10px 18px 14px">${t("Press a site to see its pages, referrers and problems.")}</p></section>`;
      }
      const real = realVisits(r), ins = r.insights || {}, perf = r.performance || {};
      const answer = r.sessions ? `${num(real)} ${t("real visits")}: ${t("Clarity counted")} ${num(r.sessions)} ${t("and marked")} ${num(r.bot_sessions || 0)} ${t("as bots")} (${pctOf((100 * (r.bot_sessions || 0)) / r.sessions)}).` : t("Clarity counted no visits in this file.");
      const tab = crTabs.dashboard;
      const body = tab === "referrers"
        ? `${dataTable("cr-referrers", [{ key: "source", label: "Referrer", html: (x) => `<span class="mono" dir="ltr">${esc(x.source)}</span>` }, { key: "sessions", label: "Visits", num: true }], r.referrers || [], { csv: false, empty: "No referrers in this file.", search: "Search sites" })}${r.own_referrals ? `<p class="small muted" style="margin:0;padding:0 18px 14px">${num(r.own_referrals)} ${t("visits came from the site's own pages, so they're left out.")}</p>` : ""}`
        : tab === "problems"
          ? `<div class="lv-two" style="padding:12px 18px 16px;gap:14px">
              <div><h3 class="small" style="margin:0 0 8px">${t("What visitors ran into")}</h3>${bars([["Dead clicks", ins.dead_clicks], ["Quick back clicks", ins.quick_back], ["Rage clicks", ins.rage_clicks], ["Excessive scrolling", ins.excessive_scrolling]].filter(([, v]) => v).map(([name, v]) => ({ name: t(name), sessions: v.sessions })), { value: (x) => x.sessions, label: (x) => x.name })}
                <h3 class="small" style="margin:14px 0 8px">${t("JavaScript errors")}: ${num(r.js_errors?.total || 0)}</h3>${(r.js_errors?.top || []).length ? `<ul class="small" style="margin:0;padding-left:18px">${r.js_errors.top.map((x) => `<li><span class="mono">${esc(x.message)}</span> · ${num(x.sessions)}</li>`).join("")}</ul>` : `<p class="small muted" style="margin:0">${t("None.")}</p>`}</div>
              <div><h3 class="small" style="margin:0 0 8px">${t("Page speed, real visitors")}</h3><ul class="rows" style="margin:0">
                <li><div class="what"><div class="t">${t("Score")}</div></div><div class="acts">${perf.score === undefined || perf.score === null ? "—" : num(Math.round(perf.score))} / 100</div></li>
                <li><div class="what"><div class="t">${t("Largest content")} (LCP)</div></div><div class="acts">${grade(perf.lcp_ms, 2500, 4000, perf.lcp_ms === null || perf.lcp_ms === undefined ? "" : `${decimal(Math.round(perf.lcp_ms / 100) / 10)} s`)}</div></li>
                <li><div class="what"><div class="t">${t("Response to a click")} (INP)</div></div><div class="acts">${grade(perf.inp_ms, 200, 500, `${num(perf.inp_ms)} ms`)}</div></li>
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

  // ---- AI search: its own file since 2026-11-10 (ai-search-view.js), with what it needs from here on LV ----------------

  // ---- Google Ads -------------------------------------------------------------------------------
  function adsPage() {
    const entry = load("metrics/ads");
    const blocked = stateCard(entry, "ga4");
    const head = topbarFor("Google Ads", "Cost, clicks and leads, from Google Analytics when it's linked to Google Ads", entry);
    if (blocked) return page(head, blocked);
    const d = entry.data;
    if (!d.linked) return page(head, emptyCard(t("No Google Ads data yet"), t("In Google Analytics, link the property to your Google Ads account. Cost and clicks appear here the day after.")));
    const money = (value, currency) => new Intl.NumberFormat(UI.locale(), currency ? { style: "currency", currency } : { maximumFractionDigits: 2 }).format(value);
    return page(head, `
      <p class="small muted" style="margin:0 0 12px">${throughNote(d.through, "", d)}</p>
      <section class="tiles">
        ${d.costs.length ? d.costs.map((c) => UI.tile(`${t("Cost")}${d.costs.length > 1 ? ` · ${esc(c.currency || "")}` : ""}`, esc(money(c.cost, c.currency)), d.costs.length > 1 ? `<span class="ab">${t("Currencies aren't added together")}</span>` : "", { ic: "megaphone" })).join("") : UI.tile(t("Cost"), "—", "", { ic: "megaphone" })}
        ${UI.tile(t("Clicks"), UI.cnt(d.clicks), "", { ic: "mouse-pointer-click" })}
        ${UI.tile(t("Leads"), num(d.leads), "", { ic: "filter" })}
      </section>
      <section class="card"><div class="card-head"><h2>${t("Clicks")}</h2></div>${lineChart("ads", d.series.map((r) => r.day), [{ name: "Clicks", color: "var(--ch-1)", values: Object.fromEntries(d.series.map((r) => [r.day, r.clicks])) }])}</section>
      <section class="card" style="margin-top:14px"><div class="card-head"><h2>${t("Campaigns")}</h2></div>${dataTable("campaigns", [
        { key: "campaign", label: "Campaign", html: (r) => `<span dir="auto">${esc(r.campaign)}</span>` },
        { key: "cost", label: "Cost", num: true, html: (r) => esc(money(r.cost, r.currency)) },
        { key: "clicks", label: "Clicks", num: true }, { key: "sessions", label: "Visits", num: true }, { key: "leads", label: "Leads", num: true },
      ], d.campaigns, { empty: "No campaigns in this period.", search: "Search campaigns" })}</section>
      <p class="note lv-note" style="margin-top:14px">${icon("info")}<span>${t("Exact data through the Google Ads API isn't built: it needs an approved developer token first.")}</span></p>`);
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
    if (R.error === "noServer") return page(head, emptyCard(t("Needs the running app"), t("Opened as a plain file there's no real data to show here.")));
    if (R.error) return page(head, emptyCard(t("That didn't load"), esc(R.error)));
    const host = UI.siteHostPicked();
    const onSite = R.rows.filter((r) => !host || !r.host || r.host === host);
    if (!onSite.length) return page(head, emptyCard(t("No resources yet"), t("Keep briefs, logins pages, reports and useful links here, so the team finds them.")));
    const used = knownTags().filter((tag) => onSite.some((r) => r.tags.some((x) => sameTag(x, tag))));
    if (R.tag && !used.some((tag) => sameTag(tag, R.tag))) R.tag = "";
    const rows = onSite.filter((r) => !R.tag || r.tags.some((x) => sameTag(x, R.tag)));
    const filter = used.length ? `<div class="chips" role="group" aria-label="${t("Filter by tag")}"><button class="chip" data-rs-filter="" aria-pressed="${!R.tag}">${t("All")}<b>${num(onSite.length)}</b></button>${used.map((tag) => `<button class="chip" data-rs-filter="${esc(tag)}" aria-pressed="${sameTag(tag, R.tag)}" dir="auto">${esc(tag)}<b>${num(onSite.filter((r) => r.tags.some((x) => sameTag(x, tag))).length)}</b></button>`).join("")}</div>` : "";
    return page(head, `<section class="card">${filter}${dataTable("resources", [
      { key: "title", label: "Title", html: (r) => `<button class="link-btn" data-lv-resource="${r.id}" dir="auto">${esc(r.title)}</button>${r.notes ? `<div class="lv-cat" dir="auto">${esc(r.notes)}</div>` : ""}` },
      { key: "tags", label: "Tags", get: (r) => (r.tags.length ? r.tags.join(", ") : null), html: (r) => (r.tags.length ? `<span class="rs-tags">${r.tags.map((tag) => `<span class="tag" dir="auto">${esc(tag)}</span>`).join("")}</span>` : `<span class="muted">—</span>`) },
      { key: "host", label: "Site", html: (r) => `<span class="mono" dir="auto">${esc(r.host || t("All sites"))}</span>` },
      { key: "url", label: "Link", html: (r) => (r.url ? `<a class="ext-link lv-url" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${icon("external-link")}${t("Open")}</a>` : `<span class="muted">—</span>`) },
    ], rows, { csv: false, search: "Search resources" })}</section>`);
  }
  function resourcePanel(id, opener) {
    const r = id === "new" ? {} : R.rows.find((x) => String(x.id) === String(id)) || {};
    const editing = Boolean(r.id);
    const picked = UI.siteHostPicked();
    UI.openPanel(`${UI.panelHead(t(editing ? "Edit the resource" : "Add a resource"), "")}
      <form class="panel-body" id="lv-resource-form" data-id="${r.id || ""}" novalidate>
        <label class="field"><span>${t("Title")}</span><input class="input" name="f_title" dir="auto" value="${esc(r.title || "")}" autocomplete="off"></label>
        <label class="field"><span>${t("Link")}</span><input class="input mono" name="f_url" dir="ltr" value="${esc(r.url || "")}" placeholder="https://" autocomplete="off"></label>
        <label class="field"><span>${t("Site")}</span><select class="select" name="f_site_id" style="width:100%"><option value="">${t("All sites")}</option>${window.SITES.filter((s) => s.realId).map((s) => `<option value="${s.realId}" ${(editing ? r.site_id === s.realId : picked === s.host) ? "selected" : ""}>${esc(s.host)}</option>`).join("")}</select></label>
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
        try { await window.COMP.api("DELETE", `rules/${el.dataset.lvRuleDel}`); forget(); UI.render(); UI.toast(t("Rule removed")); } catch (err) { UI.toast(err.message, { kind: "crit" }); }
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
          forget(); UI.render(); UI.toast(t("Rule added"));
        } catch (err) { box.textContent = t(err.message); box.hidden = false; form.elements.f_pattern.focus(); }
        return;
      }
      if (e.target.id === "lv-resource-form") { e.preventDefault(); saveResource(); return; }
      if (e.target.matches?.("[data-lv-ideas]")) {
        e.preventDefault();
        ideas.query = e.target.elements.f_q.value;
        try { ideas.rows = (await window.COMP.api("GET", `keyword-ideas?q=${encodeURIComponent(ideas.query)}`)).ideas; ideas.error = ""; }
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
  window.SCREENS.overview = { init(helpers) { UI = helpers; ({ t, esc, num, icon } = helpers); bind(); }, page: overviewPage };
  screen("channels", channelsPage); screen("conversions", conversionsPage); screen("content", contentPage);
  // Google Ads stays out of the menu for now (owner, 2026-11-05): it shows Soon. To bring it back, add screen("ads", adsPage). GA4 still stores its daily numbers, so nothing is lost meanwhile.
  screen("resources", resourcesPage); // AI search registers itself from ai-search-view.js
  Object.assign(LV, { load, pct, change, hiddenNote, siteOfPage, pageName, shortDay, fillIn, emptyCard, refreshBtn, readingWord, SOURCE_NAMES }); // for screens in their own files
  LV.dataTable = (...args) => dataTable(...args);
  LV.ideasCard = () => ideasCard(); // Keyword ideas sit on Keywords since 2026-11-09
  LV.stateCard = (...args) => stateCard(...args); // Overview's own file shows the same not-connected, failing and waiting cards

  const fr = {
    "Search the table": "Rechercher dans le tableau", "Nothing matches the search.": "Rien ne correspond à la recherche.", "Search pages": "Rechercher une page", "Search sites": "Rechercher un site",
    "Search queries": "Rechercher une requête", "Search resources": "Rechercher une ressource", "Search campaigns": "Rechercher une campagne",
    "Loading…": "Chargement…", "Needs the running app": "Il faut lancer l'application", "Opened as a plain file there's no real data to show here.": "Ouverte comme simple fichier, l'application n'a pas de vraies données à afficher ici.",
    "That didn't load": "Le chargement a échoué", "No site yet": "Pas encore de site", "Add a site to see its data.": "Ajoutez un site pour voir ses données.",
    "not connected": "non connecté", "not used": "non utilisé", "stopped working": "ne fonctionne plus", "Google Analytics": "Google Analytics", "Search Console": "Search Console",
    "Connect it in Settings, and pick which property this site uses.": "Connectez-le dans les réglages, puis choisissez la propriété de ce site.",
    "You said this site doesn't use it, so there's nothing to show. That's fine. You can change this in Settings.": "Vous avez indiqué que ce site ne l'utilise pas : il n'y a donc rien à afficher, et c'est normal. Vous pouvez changer cela dans les réglages.",
    "Open Settings": "Ouvrir les réglages", "Fix": "Corriger", "Connected. Waiting for its first data": "Connecté. En attente des premières données",
    "It arrives after the next run. Press Refresh data to start one now.": "Elles arrivent après le prochain passage. Appuyez sur Actualiser les données pour en lancer un.",
    "Refresh data": "Actualiser les données", "No change": "Sans changement", "No data in this period.": "Aucune donnée sur cette période.", "Chart": "Graphique", "Date": "Date",
    "Use the arrow keys to read each day.": "Utilisez les flèches pour lire chaque jour.", "Hide the table": "Masquer le tableau", "Show as a table": "Afficher en tableau", "Download CSV": "Télécharger le CSV", "Show more": "Afficher plus",
    "Nothing in this period.": "Rien sur cette période.", "How the site does on Google, from Search Console": "Les résultats du site sur Google, d'après la Search Console",
    "Search Console has data through": "La Search Console a des données jusqu'au", "Google Analytics has data through": "Google Analytics a des données jusqu'au", "Pick a longer or earlier period.": "Choisissez une période plus longue ou plus ancienne.",
    "Clicks": "Clics", "Impressions": "Impressions", "Click rate": "Taux de clic", "Average position": "Position moyenne", "Ranking queries": "Requêtes positionnées", "in this period": "sur cette période",
    "Last 12 months": "12 derniers mois", "Query": "Requête", "Change": "Évolution", "Queries gaining clicks": "Requêtes qui gagnent des clics", "Queries losing clicks": "Requêtes qui perdent des clics",
    "Pick a comparison above to see this.": "Choisissez une comparaison en haut pour voir ceci.", "No query gained clicks.": "Aucune requête n'a gagné de clics.", "No query lost clicks.": "Aucune requête n'a perdu de clics.", "Queries by position": "Requêtes par position",
    "Search Console lags 2 to 3 days and counts days in Pacific time.": "La Search Console a 2 à 3 jours de retard et compte les jours en heure du Pacifique.",
    "Where visits and leads come from, from Google Analytics": "D'où viennent les visites et les leads, d'après Google Analytics", "Visits": "Visites", "Leads": "Leads", "Lead rate": "Taux de lead", "Channels": "Canaux",
    "Visits by channel": "Visites par canal", "Every channel": "Tous les canaux", "Channel": "Canal", "Share": "Part", "Referring sites": "Sites référents", "Site": "Site", "No referring sites in this period.": "Aucun site référent sur cette période.",
    "Channel rules": "Règles de canaux", "Rename where a visit counts. A change applies to past days too. Match source/medium, with * for anything.": "Renommez le canal d'une visite. Le changement s'applique aussi aux jours passés. Indiquez source/support, avec * pour n'importe quoi.",
    "Channel name": "Nom du canal", "Matches": "Correspond à", "Add rule": "Ajouter la règle", "Remove": "Retirer", "Rule removed": "Règle retirée", "Rule added": "Règle ajoutée", "Type what the rule should match.": "Indiquez ce que la règle doit reconnaître.", "Type the name it should get.": "Indiquez le nom à lui donner.",
    "Organic Search": "Recherche organique", "Direct": "Direct", "Referral": "Sites référents", "Organic Social": "Réseaux sociaux", "Paid Search": "Recherche payante", "Other": "Autre",
    "From visit to lead. Counts only: no personal data comes into this app": "De la visite au lead. Des chiffres uniquement : aucune donnée personnelle n'entre dans l'application",
    "No key events found. Set up your forms as key events in Google Analytics, and leads appear here.": "Aucun événement clé trouvé. Configurez vos formulaires comme événements clés dans Google Analytics, et les leads apparaîtront ici.",
    "Key events not set up": "Événements clés non configurés", "visits": "visites", "leads": "leads", "visits didn't become a lead": "visites sans lead", "From visit to lead, by channel": "De la visite au lead, par canal",
    "Page types": "Types de pages", "Pages": "Pages", "Home page": "Page d'accueil", "Other pages": "Autres pages", "Pages that bring leads": "Pages qui apportent des leads", "No page brought a lead in this period.": "Aucune page n'a apporté de lead sur cette période.", "Page": "Page",
    "Every page: visits, leads, Google clicks, position and AI visits": "Chaque page : visites, leads, clics Google, position et visites IA", "All pages": "Toutes les pages", "page": "page", "pages": "pages", "Google clicks": "Clics Google", "Position": "Position", "AI visits": "Visites IA",
    "Visits and leads need Google Analytics. Until it's connected, they stay blank.": "Les visites et les leads nécessitent Google Analytics. Tant qu'il n'est pas connecté, ils restent vides.",
    "Google clicks and position need Search Console. Until it's connected, they stay blank.": "Les clics Google et la position nécessitent la Search Console. Tant qu'elle n'est pas connectée, ils restent vides.",
    "Traffic from social networks": "Trafic des réseaux sociaux", "No visits from social networks in this period.": "Aucune visite des réseaux sociaux sur cette période.",
    "Google Analytics hid some rows with few visits, so small numbers may be missing. A longer period may show them.": "Google Analytics a masqué des lignes à faibles visites : de petits chiffres peuvent manquer. Une période plus longue peut les révéler.",
    "Visits from AI assistants, from Google Analytics": "Les visites des assistants IA, d'après Google Analytics", "AI assistant visits": "Visites des assistants IA", "By assistant": "Par assistant", "Assistant": "Assistant", "Pages they land on": "Pages d'arrivée", "No landing pages in this period.": "Aucune page d'arrivée sur cette période.",
    "No visits from AI assistants in this period.": "Aucune visite d'assistant IA sur cette période.", "That's a real zero: Google Analytics has data, and none of it came from the assistants listed below.": "C'est un vrai zéro : Google Analytics a des données, et aucune ne vient des assistants listés ci-dessous.",
    "Share of all visits": "Part des visites", "Whether your pages appear in Google's AI Overviews is in Competitors, under AI Overview watch.": "La présence de vos pages dans les AI Overviews de Google se trouve dans Concurrents, sous Suivi des AI Overviews.", "Open it": "L'ouvrir",
    "Which sites count as AI assistants": "Quels sites comptent comme assistants IA", "Add a site to this list": "Ajouter un site à cette liste", "Add to the list": "Ajouter à la liste",
    "Cost, clicks and leads, from Google Analytics when it's linked to Google Ads": "Coût, clics et leads, d'après Google Analytics quand il est lié à Google Ads", "No Google Ads data yet": "Pas encore de données Google Ads",
    "In Google Analytics, link the property to your Google Ads account. Cost and clicks appear here the day after.": "Dans Google Analytics, liez la propriété à votre compte Google Ads. Le coût et les clics apparaissent ici le lendemain.",
    "Cost": "Coût", "Currencies aren't added together": "Les devises ne sont pas additionnées", "Campaigns": "Campagnes", "Campaign": "Campagne", "No campaigns in this period.": "Aucune campagne sur cette période.",
    "Exact data through the Google Ads API isn't built: it needs an approved developer token first.": "Les données exactes via l'API Google Ads ne sont pas construites : il faut d'abord un jeton développeur approuvé.",
    "Links and documents, per site": "Liens et documents, par site", "Add a resource": "Ajouter une ressource", "Edit the resource": "Modifier la ressource", "No resources yet": "Pas encore de ressources",
    "Keep briefs, logins pages, reports and useful links here, so the team finds them.": "Gardez ici les briefs, pages de connexion, rapports et liens utiles, pour que l'équipe les retrouve.",
    "Title": "Titre", "Link": "Lien", "Notes": "Notes", "Tags": "Étiquettes", "Type a tag, then Enter": "Tapez une étiquette, puis Entrée", "Your tags": "Vos étiquettes", "Remove {tag}": "Retirer {tag}", "Add “{tag}”": "Ajouter « {tag} »", "Filter by tag": "Filtrer par étiquette",
    "Tags are a list of words.": "Les étiquettes sont une liste de mots.", "A tag is 40 characters at most.": "Une étiquette fait 40 caractères au plus.", "A resource takes 20 tags at most.": "Une ressource prend 20 étiquettes au plus.", "Resource saved": "Ressource enregistrée", "Resource deleted": "Ressource supprimée",
    "A resource needs a title.": "Une ressource a besoin d'un titre.", "A link starts with https://.": "Un lien commence par https://.",
    "Page speed": "Vitesse des pages", "Device": "Appareil", "Phone": "Téléphone", "Computer": "Ordinateur", "Score": "Score", "Largest content (s)": "Plus grand contenu (s)", "Response (ms)": "Réactivité (ms)", "Layout shift": "Décalage visuel", "Measured on": "Mesuré sur", "Real visitors": "Vrais visiteurs", "A test run": "Un test",
    "Keyword ideas": "Idées de mots-clés", "From Google's suggestions. Free and unofficial, so it can stop working.": "D'après les suggestions de Google. Gratuit et non officiel : cela peut cesser de fonctionner.", "A word or two": "Un ou deux mots", "Find ideas": "Trouver des idées", "No suggestions for that.": "Aucune suggestion pour cela.", "Type a word or two first.": "Saisissez d'abord un ou deux mots.",
    "The name you gave your SERP API, such as serp_api1. In Bright Data's control panel, open that SERP API: the zone name and the API key are on its Overview tab.": "Le nom donné à votre SERP API, par exemple serp_api1. Dans le panneau de contrôle de Bright Data, ouvrez cette SERP API : le nom de la zone et la clé API sont dans son onglet Overview.", "Open my zones": "Ouvrir mes zones",
    "A robot key is saved": "Une clé robot est enregistrée", "Paste a new one only to replace it.": "Collez-en une nouvelle seulement pour la remplacer.",
    "Settings and display": "Réglages et affichage", "Settings, display and sign out": "Réglages, affichage et déconnexion",
    "Clarity report": "Rapport Clarity", "from a Clarity download": "d'après un export Clarity", "older downloads are kept": "les exports plus anciens sont conservés",
    "Real visits": "Vraies visites", "Bots": "Robots", "Press a site to see its pages, referrers and problems.": "Appuyez sur un site pour voir ses pages, ses sites référents et ses problèmes.",
    "real visits": "vraies visites", "Clarity counted": "Clarity a compté", "and marked": "et en a marqué", "as bots": "comme robots", "Clarity counted no visits in this file.": "Clarity n'a compté aucune visite dans ce fichier.",
    "Referrer": "Site référent", "No referrers in this file.": "Aucun site référent dans ce fichier.", "visits came from the site's own pages, so they're left out.": "visites venaient des pages du site lui-même : elles sont écartées.",
    "What visitors ran into": "Ce qui a gêné les visiteurs", "Quick back clicks": "Retours rapides", "Excessive scrolling": "Défilement excessif", "JavaScript errors": "Erreurs JavaScript", "None.": "Aucune.",
    "Page speed, real visitors": "Vitesse des pages, vrais visiteurs", "Largest content": "Plus grand contenu", "Response to a click": "Réaction à un clic", "good": "bon", "needs work": "à améliorer", "slow": "lent",
    "Browsers": "Navigateurs", "Unique visitors": "Visiteurs uniques", "Returning visitors' visits": "Visites de visiteurs revenus", "Pages per visit": "Pages par visite", "Active time per visit": "Temps actif par visite", "Smart event": "Événement intelligent",
    "No pages in this file.": "Aucune page dans ce fichier.", "Speed score": "Score de vitesse", "Top pages": "Pages les plus vues", "Referrers": "Sites référents", "Problems": "Problèmes", "Visitors": "Visiteurs",
    "Cited by Microsoft Copilot": "Cité par Microsoft Copilot", "Citations": "Citations", "Share of authority": "Part d'autorité", "Press a site to see which pages and questions.": "Appuyez sur un site pour voir quelles pages et quelles questions.",
    "Copilot cited this site": "Copilot a cité ce site", "time": "fois", "times": "fois", "most often": "le plus souvent", "Copilot didn't cite this site in this file's period.": "Copilot n'a pas cité ce site sur la période de ce fichier.",
    "This download has no questions table. In Clarity, include the questions when you export, then upload it again.": "Cet export n'a pas le tableau des questions. Dans Clarity, incluez les questions lors de l'export, puis importez-le à nouveau.",
    "Question": "Question", "No questions in this file.": "Aucune question dans ce fichier.", "No cited pages in this file.": "Aucune page citée dans ce fichier.",
    "of Copilot's answers on these questions": "des réponses de Copilot sur ces questions", "counted by Clarity": "comptées par Clarity", "Cited pages": "Pages citées", "Questions": "Questions",
    "Clarity's own dashboard downloads can go in too: Settings → Microsoft Clarity → Clarity dashboard downloads.": "Les exports du tableau de bord Clarity peuvent aussi être ajoutés : Réglages → Microsoft Clarity → Exports du tableau de bord Clarity.",
    "Contact us": "Nous contacter", "Outbound click": "Clic sortant", "Submit form": "Envoi de formulaire", "Request quote": "Demande de devis", "Book": "Réservation", "Checkout": "Paiement", "See reviews": "Voir les avis",
    "Clarity sessions": "Sessions Clarity", "Scroll depth": "Profondeur de défilement", "Rage clicks": "Clics de rage", "Dead clicks": "Clics morts",
    "Your site's pages are being read too. That takes a while: it waits 3 seconds between pages.": "Les pages de votre site sont lues aussi. Cela prend un moment : 3 secondes d'attente entre chaque page.",
    "Reading the latest data. It appears here when it arrives.": "Lecture des dernières données. Elles s'affichent ici dès leur arrivée.", "Nothing to read yet: connect a data source first, or it's already running.": "Rien à lire pour l'instant : connectez d'abord une source de données, ou la lecture est déjà en cours.",
  };
  Object.assign(fr, {
    "Reading {done} of {total}…": "Lecture {done} sur {total}…",
    "Clarity was already read today. It reads again after midnight UTC.": "Clarity a déjà été lu aujourd'hui. Il sera relu après minuit UTC.",
    "Still reading in the background. The numbers appear here when it finishes: press Refresh data again in a few minutes.": "La lecture continue en arrière-plan. Les chiffres apparaîtront ici à la fin : appuyez de nouveau sur Actualiser les données dans quelques minutes.",
    "{ok} of {total} read.": "{ok} sur {total} lus.",
    "{names} failed: the card on the page says why.": "{names} a échoué : la carte sur la page explique pourquoi.", "Fix it": "Corriger",
    "Updated with the latest data.": "Mis à jour avec les dernières données.", "Updated: {names}.": "Mis à jour : {names}.",
  });
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
