/* One side panel for every table row (plan-seo-command-center-simplify-screens-like-mickaz.md, change 6). Owner: track D.
   The same 760 px layout on every screen: a "kind · period" line and the row's name, three to six numbers, one chart over
   time, up to two short lists, and the row's actions in the foot. Only the simpler screens use it (UI.simple()), so with
   the switch off nothing on any screen changes. Looks: row-panel.css. Server answers: seo/web/metrics_api.py.

   UI.rowPanel(spec) opens it and returns { el, update(patch), close() }. Every key is optional but title:
     kind      what the row is, in English (t() translates it): "Channel", "Page", "Assistant", "Referring site", "Keyword".
     period    what the numbers cover: { from, to, compare_from, compare_to } as the server answers it, a ready string,
               false for none, or left out for the app's period (UI.range).
     title     the row's name, plain text (dir="auto").           page   { path, host } or { url }: the name becomes a link
     logo      a domain: its logo before the name.                       to the page, and the foot gets Open page ↗.
     sub       one short line under the name, plain text.
     numbers   3 to 6 [{ id, label, value, before, fmt, lowerIsBetter, def, sub }]. value null is unknown: "—", never 0.
               fmt: "num" (default), "pct" (0.073 → 7.3%), "dec", "pos" (a position: lower is better), or a function.
               The change pill is worked out from before: counts in %, rates in points, positions in places, each with an
               arrow and the word better or worse. sub replaces the "before → now" line.
     chart     { days, series: [{ name, values: { day: n | null }, color, dash }], invert, unit, dayLabel, label } drawn by
               LV.lineChart at 160 px, or a list of them: a small switch then picks one. UI.rowPanel.chart() builds one from
               the days a detail route answers, with the period before dashed on the same days.
     sections  up to two [{ title, badge, columns: [{ label, key, get, html, num, fmt }], rows, total, limit = 15, more, empty }]
               shown as table.data. Past `limit` rows: "15 of 40", and See all when more = { label, href } or { label, onClick }.
               { title, html } or { title, text } for anything that isn't a list.
     actions   [{ label, main, icon, href, external, onClick(event, panel), attrs, disabled }]: the foot, the main one first.
     task      a task "find" for UI.taskButton: Task in the foot.   note   { label, where } (Notes) or true: Add a note.
     opener    the row (a tr, or something in it): it stays highlighted, and focus goes back to it on Escape.
     nav       (step) => void for ↑ and ↓. Left out: the row above or below the opener, found by the opener's own data-
               attribute, is clicked, so a screen whose rows open on click needs nothing more.
     load      async () => patch: the panel opens at once with grey shapes, then draws what load() gives (any keys above).
               A failure shows Try again inside the panel.
     id        a word naming the panel (data-rp): the chart's id, and what tests look for.
   Example: UI.rowPanel({ kind: "Channel", title: "Direct", opener: tr, numbers: [{ label: "Visits", value: 120, before: 100 }] }).

   Ready-made panels for the detail routes, so a screen only marks its rows (or calls UI.rowPanel.open(kind, key, opener)):
     <tr data-rp-open="channel"   data-rp-key="Organic Search">      GET /api/metrics/channel?name=
     <tr data-rp-open="referrer"  data-rp-key="blog.example">        GET /api/metrics/referrer?domain=
     <tr data-rp-open="page"      data-rp-key="/visa/" data-rp-host="site.example">   GET /api/metrics/page?path=&host=
     <tr data-rp-open="assistant" data-rp-key="chatgpt.com">         GET /api/metrics/assistant?source=
   A click on such a row (not on its links, buttons or tick box) opens its panel, and so does Enter on the focused row. */
(() => {
  "use strict";
  const UI = window.UI;
  if (!UI) return;
  const { t, esc, num, icon } = UI;
  const fr = () => UI.state.lang === "fr";
  // Words whose shared French means something else elsewhere ("Change" is also "Modifier"): these read as this panel means them.
  const OWN_FR = { Change: "Évolution" };
  const word = (s) => (fr() && OWN_FR[s] !== undefined ? OWN_FR[s] : t(s));
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);

  let seq = 0;
  let open = null; // the panel on screen: { token, spec, chart, loading, error, opener }

  // ---- days, as the server writes them (YYYY-MM-DD), counted in UTC so a clock change never skips one ----
  const toDate = (s) => new Date(`${s}T00:00:00Z`);
  const isoOf = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };
  const dayDiff = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
  const everyDay = (a, b) => { const out = []; for (let d = a; d <= b && out.length < 800; d = addDays(d, 1)) out.push(d); return out; };
  const shortDay = (day) => new Intl.DateTimeFormat(UI.locale(), { day: "numeric", month: "short" }).format(new Date(`${day}T00:00:00`));

  // ---- numbers ----------------------------------------------------------------------------------------------
  const pctText = (v) => `${UI.dec(Math.round(v * 1000) / 10)}${fr() ? " %" : "%"}`;
  function fmt(kind, v) {
    if (!isNum(v)) return "—";
    if (typeof kind === "function") return esc(kind(v));
    if (kind === "pct") return pctText(v);
    if (kind === "dec" || kind === "pos") return UI.dec(Math.round(v * 10) / 10);
    return num(Math.round(v * 100) / 100);
  }
  // A status colour always comes with an arrow and a word (MASTER). One run of text: in the flex pill a second element
  // would lose the space before it.
  const pill = (good, text, up) => `<span class="${good ? "good" : "crit"} d-pill">${icon(up ? "arrow-up" : "arrow-down")}${text} ${esc(t(good ? "better" : "worse"))}</span>`;
  const same = () => `<span class="sec d-pill">${icon("minus")}${esc(word("No change"))}</span>`;
  function change(kind, now, before, lowerIsBetter = false) {
    if (!isNum(now) || !isNum(before)) return "";
    if (kind === "pct") { // a rate moves in points
      const d = Math.round((now - before) * 1000) / 10;
      return d === 0 ? same() : pill(d > 0 !== lowerIsBetter, `${d > 0 ? "+" : "−"}${UI.dec(Math.abs(d))} ${esc(t("pts"))}`, d > 0);
    }
    if (kind === "pos") { // a position moves in places, and up the page is better
      const places = Math.round((before - now) * 10) / 10;
      return places === 0 ? same() : pill(places > 0, `${UI.dec(Math.abs(places))} ${esc(t(Math.abs(places) === 1 ? "place" : "places"))}`, places > 0);
    }
    if (before === 0) return ""; // no percentage from nothing: the line under it says 0 → n
    const p = Math.round(((now - before) / before) * 100);
    return p === 0 ? same() : pill(p > 0 !== lowerIsBetter, `${p > 0 ? "+" : "−"}${num(Math.abs(p))}%`, p > 0);
  }
  function number(n) {
    const kind = n.fmt || "num";
    const known = n.value !== null && n.value !== undefined && n.value !== "";
    const shown = !known ? "—" : typeof n.value === "number" ? fmt(kind, n.value) : esc(n.value);
    const moved = known && typeof n.value === "number" ? change(kind, n.value, n.before, n.lowerIsBetter || kind === "pos") : "";
    const sub = n.sub !== undefined && n.sub !== null ? esc(t(n.sub)) : known && typeof n.value === "number" && isNum(n.before) ? `${fmt(kind, n.before)} → ${fmt(kind, n.value)}` : "";
    const def = UI.defIcon ? UI.defIcon(n.def || n.label) : "";
    return `<div class="rp-num" role="listitem"${n.id ? ` data-rp-num="${esc(n.id)}"` : ""}>
        <div class="rp-num-lab"><span class="rp-num-name">${esc(word(n.label))}</span>${def}</div>
        <div class="rp-num-row"><span class="rp-num-val${known ? "" : " unknown"}">${shown}</span>${moved}</div>
        ${sub ? `<div class="rp-num-sub">${sub}</div>` : ""}</div>`;
  }
  const numbers = (list) => {
    const shown = (list || []).filter(Boolean).slice(0, 6);
    return shown.length ? `<div class="rp-nums" role="list" data-n="${shown.length}" aria-label="${esc(t("Numbers"))}">${shown.map(number).join("")}</div>` : "";
  };

  // ---- the chart ----------------------------------------------------------------------------------------------
  const charts = (s) => (Array.isArray(s.spec.chart) ? s.spec.chart : s.spec.chart ? [s.spec.chart] : []).filter((c) => c && c.days);
  const chartId = (s, pick, many) => `rp-${s.spec.id || "row"}${many ? `-${pick}` : ""}`;
  function chartBlock(s) {
    const list = charts(s);
    if (!list.length) return "";
    const pick = Math.min(s.chart, list.length - 1), c = list[pick], id = chartId(s, pick, list.length > 1);
    const filled = c.series.some((line) => c.days.some((d) => isNum(line.values?.[d])));
    const lines = c.series.map((line, i) => ({ ...line, name: line.name || c.label || "", color: line.color || (line.dash ? "var(--muted)" : `var(--ch-${i + 1})`) }));
    const drawn = filled && window.LV?.lineChart
      ? window.LV.lineChart(id, c.days, lines, { invert: !!c.invert, unit: c.unit || "", dayLabel: c.dayLabel || null, legend: lines.length > 1 })
      : `<div class="empty rp-empty"><p>${esc(t(c.empty || "No data in this period."))}</p></div>`;
    const switcher = list.length > 1 ? `<span class="seg rp-chart-pick" role="group" aria-label="${esc(t("Chart"))}">${list.map((x, i) => `<button type="button" data-rp-chart="${i}" aria-pressed="${i === pick}">${esc(word(x.label || x.series?.[0]?.name || ""))}</button>`).join("")}</span>` : "";
    const title = list.length > 1 ? "" : c.label;
    return `<div class="rp-chart-head">${title ? `<h3>${esc(word(title))}</h3>` : ""}${switcher}</div>${drawn}`;
  }
  const chartSlot = (s) => (charts(s).length ? `<section class="rp-chart" data-rp-chart-box>${chartBlock(s)}</section>` : "");

  // ---- lists ----------------------------------------------------------------------------------------------------
  function cell(c, row) {
    const v = c.get ? c.get(row) : row[c.key];
    const html = c.html ? c.html(row) : v === null || v === undefined || v === "" ? `<span class="muted">—</span>` : c.num ? fmt(c.fmt || "num", v) : `<span dir="auto">${esc(v)}</span>`;
    return `<td class="${c.num ? "c" : ""}" data-label="${esc(word(c.label))}">${html}</td>`;
  }
  function moreLine(sec, i, shown, total) {
    const words = `${num(shown)} ${t("of")} ${num(total)}`;
    const label = esc(t(sec.more?.label || "See all"));
    if (sec.more?.href) return `<p class="rp-more"><span>${words}</span><a class="link-btn" href="${esc(sec.more.href)}" data-rp-more="${i}">${label}</a></p>`;
    if (sec.more?.onClick) return `<p class="rp-more"><span>${words}</span><button type="button" class="link-btn" data-rp-more="${i}">${label}</button></p>`;
    return `<p class="rp-more"><span>${words}</span></p>`;
  }
  function section(s, sec, i) {
    const rows = sec.rows || [];
    const total = isNum(sec.total) ? Math.max(sec.total, rows.length) : rows.length;
    const shown = rows.slice(0, sec.limit || 15);
    const badge = sec.badge !== undefined ? sec.badge : sec.columns ? total : null;
    // The table tools (table-tools.js) put Filter in this head (data-tt-slot); the badge here is the list's real length,
    // which can be more than the rows shown, so theirs stays out (data-tt-own-count).
    const head = `<div class="rp-sec-head" data-tt-slot><h3>${esc(word(sec.title || ""))}</h3>${badge !== null && badge !== undefined && badge !== "" ? `<span class="rp-badge">${isNum(badge) ? num(badge) : esc(badge)}</span>` : ""}</div>`;
    const start = `<section class="rp-sec" data-rp-sec="${i}" data-tt-own-count>${head}`;
    if (sec.html !== undefined) return `${start}<div class="rp-sec-html">${sec.html}</div></section>`;
    if (sec.text !== undefined) return `${start}<p class="rp-text" dir="auto">${esc(t(sec.text))}</p></section>`;
    if (!shown.length || !sec.columns?.length) return `${start}<p class="rp-none">${esc(t(sec.empty || "Nothing in this period."))}</p></section>`;
    const cols = sec.columns;
    const table = `<div class="table-wrap rp-table"><table class="data" id="${esc(`rp-${s.spec.id || "row"}-${i}`)}"><thead><tr>${cols.map((c) => `<th scope="col" class="${c.num ? "c" : ""}">${esc(word(c.label))}</th>`).join("")}</tr></thead>
      <tbody>${shown.map((row) => `<tr>${cols.map((c) => cell(c, row)).join("")}</tr>`).join("")}</tbody></table></div>`;
    return `${start}${table}${total > shown.length ? moreLine(sec, i, shown.length, total) : ""}</section>`;
  }
  const sectionsOf = (spec) => (spec.sections || spec.lists || []).filter(Boolean).slice(0, 2);

  // ---- head and foot ------------------------------------------------------------------------------------------------
  function periodWords(period) {
    if (period === false) return [];
    if (typeof period === "string") return period ? [period] : [];
    let p = period;
    if (!p) { const g = UI.range?.get?.({ hours: false }); p = g ? { from: g.from, to: g.to, compare_from: g.compareFrom, compare_to: g.compareTo } : null; }
    if (!p?.from || !p?.to) return [];
    const out = [UI.fmtRange(p.from, p.to)];
    // The same words as the screen's head: "vs 16 Sept – 13 Oct", "par rapport au 16 sept. – 13 oct.".
    if (p.compare_from && p.compare_to) out.push(t("vs {range}").split("{range}").join(UI.fmtRange(p.compare_from, p.compare_to)));
    return out;
  }
  const pageHref = (p) => (p.page && window.PageLink ? window.PageLink.href(p.page.url || p.page.path, p.page.host) : "");
  function head(p) {
    const line = [p.kind ? word(p.kind) : "", ...periodWords(p.period)].filter(Boolean).map(esc).join(`<span class="rp-sep" aria-hidden="true"> · </span>`);
    const name = p.title ?? p.page?.path ?? p.page?.url ?? "";
    const title = pageHref(p) ? window.PageLink.html(p.page.url || p.page.path, { host: p.page.host, text: name, cls: "rp-title-link", title: "" }) : `<span dir="auto">${esc(name)}</span>`;
    const logo = p.logo ? `<span class="rp-logo">${UI.siteLogo(p.logo, 20)}</span>` : "";
    return `<div class="panel-head rp-head"><div class="rp-titles">
        ${line ? `<div class="rp-kind">${line}</div>` : ""}
        <h2 id="panel-title" dir="auto">${logo}${title}</h2>
        ${p.sub ? `<div class="sub rp-sub" dir="auto">${esc(p.sub)}</div>` : ""}
      </div><button class="icon-btn" data-close-panel aria-label="${esc(t("Close"))}">${icon("x")}</button></div>`;
  }
  const actionsOf = (p) => { const list = (p.actions || []).filter(Boolean); return [...list.filter((a) => a.main), ...list.filter((a) => !a.main)]; };
  const SAFE_ATTR = /^(data-[a-z0-9-]+|aria-[a-z]+|id|title)$/;
  function actionHtml(a, i) {
    const cls = `btn${a.main ? " btn-main" : ""}`;
    const inner = `${a.icon ? icon(a.icon) : ""}${esc(word(a.label))}${a.external ? ' <span aria-hidden="true">↗</span>' : ""}`;
    const attrs = Object.entries(a.attrs || {}).filter(([k]) => SAFE_ATTR.test(k)).map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
    if (a.href) return `<a class="${cls}" href="${esc(a.href)}"${a.external ? ' target="_blank" rel="noopener noreferrer"' : ""}${attrs} data-rp-act="${i}">${inner}</a>`;
    return `<button type="button" class="${cls}"${attrs} data-rp-act="${i}"${a.disabled ? " disabled" : ""}>${inner}</button>`;
  }
  const NOTE_ICONS = { domain: "link-2", page: "file-text", keyword: "key-round", section: "folder-open", date: "calendar-days", competitor: "crosshair" };
  function noteButton(note) {
    const choices = note === true ? [] : [note].flat().filter((c) => c?.where).map((c) => ({ label: c.label, icon: c.icon || NOTE_ICONS[c.where.scope] || "pencil", where: c.where }));
    return `<button type="button" class="btn rp-note" data-notes-open="${esc(JSON.stringify(choices))}">${icon("pencil")}${esc(t("Add a note"))}</button>`;
  }
  function foot(p) {
    const parts = actionsOf(p).map(actionHtml);
    if (p.task && UI.taskButton) parts.push(UI.taskButton(p.task, { label: "Task", cls: "btn" }));
    if (p.note) parts.push(noteButton(p.note));
    const href = p.open === false ? "" : pageHref(p);
    if (href) parts.push(`<a class="btn rp-open-page" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(t("Open page"))} <span aria-hidden="true">↗</span></a>`);
    return parts.length ? `<div class="panel-foot rp-foot">${parts.join("")}</div>` : "";
  }

  // ---- drawing ----------------------------------------------------------------------------------------------------
  function body(s) {
    if (s.loading) return UI.skeleton("panel");
    if (s.error) return UI.failCard(s.error, { retry: "data-rp-retry" });
    const p = s.spec;
    const out = `${numbers(p.numbers)}${chartSlot(s)}${sectionsOf(p).map((sec, i) => section(s, sec, i)).join("")}${p.html || ""}`;
    return out || `<div class="empty rp-empty"><p>${esc(t(p.empty || "Nothing in this period."))}</p></div>`;
  }
  const frame = (s) => `${head(s.spec)}<div class="panel-body rp-body" aria-busy="${s.loading ? "true" : "false"}">${body(s)}</div>${s.loading || s.error ? "" : foot(s.spec)}`;
  const alive = (s) => Boolean(s) && UI.$("#panel.rp")?.dataset.rpToken === String(s.token);

  // The sliding highlight of a switch, as mockup.js's placeInks draws it for the page.
  function placeInk(box) {
    box.querySelector(":scope > .ink")?.remove();
    const active = box.querySelector('button[aria-pressed="true"]');
    if (!active) return;
    const ink = document.createElement("span");
    ink.className = "ink"; ink.setAttribute("aria-hidden", "true");
    box.prepend(ink);
    Object.assign(ink.style, { transform: `translate(${active.offsetLeft}px,${active.offsetTop}px)`, width: `${active.offsetWidth}px`, height: `${active.offsetHeight}px` });
  }
  function after(s) {
    const el = UI.$("#panel");
    if (!el) return;
    el.dataset.rpToken = String(s.token);
    el.querySelectorAll(".seg").forEach(placeInk);
    const list = charts(s);
    // The chart's own table view pages inside this panel, not on the screen behind it.
    if (list.length && window.TP) window.TP.on(`lv-chart-${chartId(s, Math.min(s.chart, list.length - 1), list.length > 1)}`, () => paintChart(s));
  }
  function paint(s) {
    const el = UI.$("#panel");
    if (!el || !alive(s)) return;
    const had = el.contains(document.activeElement) ? document.activeElement : null;
    const twin = had && had !== el ? [...had.attributes].find((a) => a.name === "data-close-panel" || a.name.startsWith("data-rp") || a.name === "data-lv-table") : null;
    const scroll = el.querySelector(".panel-body")?.scrollTop || 0;
    UI.setHTML(el, frame(s));
    after(s);
    const box = el.querySelector(".panel-body");
    if (box) box.scrollTop = scroll;
    if (had && !had.isConnected) ((twin && el.querySelector(`[${twin.name}${twin.value ? `="${CSS.escape(twin.value)}"` : ""}]`)) || el).focus({ preventScroll: true });
  }
  function paintChart(s, focus = null) {
    const slot = alive(s) ? UI.$("#panel [data-rp-chart-box]") : null;
    if (!slot) return;
    UI.setHTML(slot, chartBlock(s));
    after(s);
    if (focus) slot.querySelector(focus)?.focus({ preventScroll: true });
  }
  async function run(s) {
    try {
      const patch = await s.spec.load();
      if (!alive(s)) return;
      Object.assign(s.spec, patch || {});
      s.error = null;
    } catch (err) {
      if (!alive(s)) return;
      s.error = err;
    }
    s.loading = false;
    paint(s);
  }
  const rowOf = (el) => (el?.closest?.("tr") && !el.closest("#panel") ? el.closest("tr") : null);
  function mark(opener) {
    document.querySelectorAll("tr.open").forEach((r) => r.classList.remove("open"));
    rowOf(opener)?.classList.add("open");
  }
  function handle(s) {
    return {
      get el() { return alive(s) ? UI.$("#panel") : null; },
      update(patch) { if (!alive(s)) return; Object.assign(s.spec, patch || {}); s.loading = false; s.error = null; paint(s); },
      close() { if (alive(s)) UI.closePanel(); },
    };
  }

  function rowPanel(spec = {}) {
    const swap = Boolean(UI.$("#panel.rp")); // ↑ or ↓ from one row to the next: the panel stays put instead of sliding in again
    const opener = spec.opener || document.activeElement;
    const s = { token: ++seq, spec: { ...spec }, chart: 0, loading: typeof spec.load === "function", error: null, opener };
    open = s;
    // openPanel(html, opener) and then .wide: a wide panel with no form must not go through the draft-keeping path.
    UI.openPanel(frame(s), opener);
    const el = UI.$("#panel");
    el.classList.add("wide", "rp");
    if (swap) el.classList.add("rp-swap");
    el.dataset.rp = spec.id || String(spec.kind || "row").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    after(s);
    mark(opener);
    if (s.loading) run(s);
    return handle(s);
  }

  // ---- ↑ and ↓: the row above or below ----------------------------------------------------------------------------
  const dataName = (el, skip = /^data-(tt|tip|label)/) => [...(el?.attributes || [])].find((a) => a.name.startsWith("data-") && !skip.test(a.name)) || null;
  function current(s) {
    if (s.opener?.isConnected) return s.opener;
    const mark = dataName(s.opener); // the screen drew its table again: the same row, found by what marks it
    return mark ? document.querySelector(`#page [${mark.name}="${CSS.escape(mark.value)}"]`) : null;
  }
  function neighbour(s, step) {
    const opener = current(s), row = rowOf(opener);
    if (!row) return null;
    const inner = opener === row ? null : dataName(opener)?.name;
    const rowMark = dataName(row)?.name;
    for (let next = step > 0 ? row.nextElementSibling : row.previousElementSibling; next; next = step > 0 ? next.nextElementSibling : next.previousElementSibling) {
      if (next.hidden || !next.getClientRects().length) continue;
      if (inner) { const el = next.querySelector(`[${inner}]`); if (el) return el; continue; }
      if (!rowMark || next.hasAttribute(rowMark)) return next;
    }
    return null;
  }
  const NOT_FOR_ARROWS = "input, textarea, select, [contenteditable], .lv-chart, [role=tablist], .seg, .tp-pager, .popover";
  document.addEventListener("keydown", (e) => {
    if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
    const s = open;
    if (!alive(s) || UI.$("#popover") || document.querySelector("dialog[open]")) return;
    const target = e.target instanceof Element ? e.target : null;
    const onRow = rowOf(current(s))?.contains(target);
    if (!target || (!UI.$("#panel").contains(target) && !onRow) || target.closest(NOT_FOR_ARROWS)) return;
    const step = e.key === "ArrowDown" ? 1 : -1;
    e.preventDefault();
    if (typeof s.spec.nav === "function") { s.spec.nav(step); return; }
    neighbour(s, step)?.click();
  });

  // ---- clicks inside the panel: before the screens' own handlers, so nothing redraws the page behind it ----------------
  document.addEventListener("click", (e) => {
    const s = open;
    const target = e.target instanceof Element ? e.target : null;
    if (!target || !alive(s) || !target.closest("#panel.rp")) return;
    let el;
    if ((el = target.closest("[data-lv-table]")) && window.LV) {
      e.preventDefault(); e.stopPropagation();
      const id = el.dataset.lvTable;
      window.LV.tables.set(id, !window.LV.tables.get(id));
      paintChart(s, `[data-lv-table="${CSS.escape(id)}"]`);
      return;
    }
    if ((el = target.closest("[data-rp-chart]"))) {
      e.preventDefault(); e.stopPropagation();
      s.chart = Number(el.dataset.rpChart) || 0;
      paintChart(s, `[data-rp-chart="${s.chart}"]`);
      return;
    }
    if (target.closest("[data-rp-retry]")) { e.stopPropagation(); s.loading = true; s.error = null; paint(s); run(s); return; }
    if ((el = target.closest("[data-rp-act]"))) {
      const action = actionsOf(s.spec)[Number(el.dataset.rpAct)];
      if (action?.onClick) { if (!action.href) e.preventDefault(); action.onClick(e, handle(s)); }
      return;
    }
    if ((el = target.closest("[data-rp-more]"))) {
      const more = sectionsOf(s.spec)[Number(el.dataset.rpMore)]?.more;
      if (more?.onClick) { e.preventDefault(); more.onClick(e, handle(s)); }
    }
  }, true);

  // ---- a chart from a detail route's days ------------------------------------------------------------------------------
  /* rows: [{ day, …numbers }] as the server answers them; key: which number. Every day of the period is on the axis, so a
     day the source didn't report is a gap; the period before is drawn dashed on the days it lines up with.
     opts: { label, name, beforeName, period: { from, to, compare_from }, invert, unit, everyDay: true, dayLabel }. */
  rowPanel.chart = (rows, key, before = null, { label = "", name = "", beforeName = "The period before", period = null, invert = false, unit = "", everyDay: fill = true, dayLabel = null } = {}) => {
    const list = (rows || []).filter((r) => r?.day);
    const start = period?.from || list[0]?.day, end = period?.to || list[list.length - 1]?.day;
    const days = fill && start && end && start <= end ? everyDay(start, end) : list.map((r) => r.day);
    const now = new Map(list.map((r) => [r.day, isNum(r[key]) ? r[key] : null]));
    const series = [{ name: name || label || key, values: Object.fromEntries(days.map((d) => [d, now.get(d) ?? null])) }];
    const from = period?.compare_from;
    if (before?.length && from && start) {
      const shift = dayDiff(from, start), was = new Map();
      before.forEach((r) => { if (r?.day && isNum(r[key])) was.set(addDays(r.day, shift), r[key]); });
      series.push({ name: beforeName, dash: true, values: Object.fromEntries(days.map((d) => [d, was.get(d) ?? null])) });
    }
    return { label: label || name || key, days, series, invert, unit, dayLabel };
  };

  // ---- the ready-made panels -----------------------------------------------------------------------------------------
  const asked = () => { const parts = [UI.range.days()], site = UI.siteIdPicked(); if (site) parts.push(`site_id=${site}`); return parts.join("&"); };
  const enc = encodeURIComponent;
  const withLogo = (name) => (String(name || "").includes(".") ? `<span class="with-logo">${UI.siteLogo(name, 16)}<span class="logo-text" dir="auto">${esc(name)}</span></span>` : `<span dir="auto">${esc(t(name))}</span>`);
  const pageCell = (r) => (window.PageLink ? window.PageLink.html(r.path, { host: r.host, cls: "mono rp-url" }) : `<span class="mono" dir="auto">${esc(r.path)}</span>`);
  const changeCell = (r) => (!isNum(r.change) ? `<span class="muted">—</span>` : r.change === 0 ? `<span class="sec">0%</span>`
    : `<span class="${r.change > 0 ? "good" : "crit"} d-pill">${icon(r.change > 0 ? "arrow-up" : "arrow-down")}${r.change > 0 ? "+" : "−"}${num(Math.abs(r.change))}%</span>`);
  const learn = (d) => { (d.logos || []).forEach((n) => window.LOGOS_KNOWN?.add?.(n)); return d; };
  const visitsAndLeads = [{ label: "Visits", key: "sessions", num: true }, { label: "Leads", key: "leads", num: true }];
  const facts = (d) => [d.totals && isNum(d.totals.sessions) ? `${t("Visits")}: ${num(d.totals.sessions)}` : "", d.period ? periodWords(d.period).join(" ") : ""].filter(Boolean);
  const where = (scope, extra) => ({ scope, siteId: UI.siteIdPicked(), ...extra });
  const trafficNumbers = (d, first = "Visits") => [
    { id: "visits", label: first, value: d.totals?.sessions ?? null, before: d.before?.sessions },
    { id: "leads", label: "Leads", value: d.totals?.leads ?? null, before: d.before?.leads },
    { id: "rate", label: "Lead rate", fmt: "pct", value: d.totals?.rate ?? null, before: d.before?.rate },
  ];
  const trafficCharts = (d, first = "Visits") => [
    rowPanel.chart(d.days, "sessions", d.days_before, { label: first, period: d.period }),
    rowPanel.chart(d.days, "leads", d.days_before, { label: "Leads", period: d.period }),
  ];
  const KINDS = {
    channel: {
      kind: "Channel", title: (key) => t(key),
      url: (key) => `metrics/channel?name=${enc(key)}&${asked()}`,
      spec: (d, key) => ({
        period: d.period,
        numbers: [...trafficNumbers(d), { id: "share", label: "Share", fmt: "pct", value: d.totals?.share ?? null }],
        chart: trafficCharts(d),
        sections: [
          { title: "Sources", rows: d.sources, total: d.sources_total, columns: [{ label: "Source", key: "source", html: (r) => withLogo(r.source) }, ...visitsAndLeads, { label: "Change", key: "change", num: true, html: changeCell }] },
          { title: "Mediums", rows: d.mediums, total: d.mediums_total, columns: [{ label: "Medium", key: "medium", html: (r) => `<span dir="auto">${esc(r.medium)}</span>` }, ...visitsAndLeads, { label: "Change", key: "change", num: true, html: changeCell }] },
        ],
        // AI assistants is AI search's own count, by its rules: the way there (expert review 2026-11-17, #22).
        actions: key === "AI assistants" ? [{ label: "Open AI search", icon: "sparkles", attrs: { "data-rp-ai": "1" }, onClick: (e, panel) => { panel.close(); UI.go("ai"); } }] : [],
        task: { title: `${t("Look into a channel")}: ${t(key)}`, host: UI.siteHostPicked(), priority: "medium", source: { type: "other", label: t(key), host: UI.siteHostPicked() || undefined, facts: facts(d), link: "#channels", key: `channel|${UI.siteHostPicked() || ""}|${key}` } },
        note: true,
      }),
    },
    referrer: {
      kind: "Referring site", title: (key) => key, logo: (key) => key,
      url: (key) => `metrics/referrer?domain=${enc(key)}&${asked()}`,
      spec: (d, key) => ({
        period: d.period,
        numbers: trafficNumbers(d),
        chart: trafficCharts(d),
        sections: [{ title: "Landing pages", rows: d.pages, total: d.pages_total, columns: [{ label: "Page", key: "path", html: pageCell }, ...visitsAndLeads] }],
        actions: [{ label: "Open site", href: `https://${key}`, external: true }],
        task: { title: `${t("Look into a referring site")}: ${key}`, host: UI.siteHostPicked(), priority: "medium", source: { type: "other", label: key, host: UI.siteHostPicked() || undefined, facts: facts(d), link: "#channels", key: `referrer|${UI.siteHostPicked() || ""}|${key}` } },
        note: { label: key, where: where("domain", { domain: key }) },
      }),
    },
    page: {
      kind: "Page", title: (key) => key,
      url: (key, o) => `metrics/page?path=${enc(key)}${o.host ? `&host=${enc(o.host)}` : ""}&${asked()}`,
      spec: (d) => ({
        period: d.period, page: { path: d.path, host: d.host },
        sub: [t(d.category), UI.siteHostPicked() ? "" : d.host].filter(Boolean).join(" · "),
        numbers: [
          { id: "visits", label: "Visits", value: d.totals?.sessions ?? null, before: d.before?.sessions, sub: d.ga4?.state === "not_connected" ? "Google Analytics not connected" : undefined },
          { id: "leads", label: "Leads", value: d.totals?.leads ?? null, before: d.before?.leads },
          { id: "rate", label: "Lead rate", fmt: "pct", value: d.totals?.rate ?? null, before: d.before?.rate },
          { id: "clicks", label: "Google clicks", value: d.totals?.clicks ?? null, before: d.before?.clicks, def: "Clicks", sub: d.gsc?.state === "not_connected" ? "Search Console not connected" : undefined },
          { id: "position", label: "Position", fmt: "pos", value: d.totals?.position ?? null, before: d.before?.position },
          { id: "ai", label: "AI visits", value: d.totals?.ai ?? null, before: d.before?.ai },
        ],
        chart: [
          rowPanel.chart(d.days, "sessions", d.days_before, { label: "Visits", period: d.periods?.ga4 || d.period }),
          rowPanel.chart(d.days, "clicks", d.days_before, { label: "Google clicks", period: d.periods?.gsc || d.period }),
        ],
        sections: [
          {
            title: "Searches that bring it", rows: d.queries, total: d.queries_total,
            columns: [{ label: "Query", key: "query", html: (r) => `<span class="mono">${KeywordLink.html(r.query, { host: d.host })}</span>` }, { label: "Clicks", key: "clicks", num: true }, { label: "Impressions", key: "impressions", num: true }, { label: "Position", key: "position", num: true, fmt: "dec" }],
            more: d.addresses?.length && window.OV?.openPage ? { label: "See all", onClick: (e, panel) => { panel.close(); window.OV.openPage({ host: d.host, page: d.addresses[0] }); } } : null,
            empty: "No searches in this period.",
          },
          {
            title: "Where AI visits come from", rows: d.ai_sources, total: d.ai_sources_total,
            columns: [{ label: "Assistant", key: "source", html: (r) => withLogo(r.source) }, { label: "AI visits", key: "sessions", num: true }, { label: "Change", key: "change", num: true, html: changeCell }],
            more: { label: "See all", onClick: (e, panel) => { panel.close(); UI.go("ai"); } },
            empty: "No AI visits in this period.",
          },
        ],
        // Everything else known about the page (rankings, backlinks, tasks, notes, technical, content) is on Pages.
        actions: window.SCREENS?.pages ? [{ label: "All about this page", icon: "layers", attrs: { "data-rp-pages": d.url }, onClick: (e, panel) => { panel.close(); window.SCREENS.pages.open(d.url); } }] : [],
        task: { title: `${t("Look into a page")}: ${d.path}`, host: d.host, priority: "medium", pages: [d.url], source: { type: "other", label: d.path, host: d.host, facts: facts(d), link: `#${UI.state.route}`, key: `page|${d.host}|${d.path}` } },
        note: { label: d.path, where: where("page", { pageUrl: d.url }) },
      }),
    },
    assistant: {
      kind: "Assistant", title: (key) => key, logo: (key) => (String(key).includes(".") ? key : ""),
      url: (key) => `metrics/assistant?source=${enc(key)}&${asked()}`,
      spec: (d, key) => {
        const weeks = (d.weekly || []).map((w) => ({ day: w.end, sessions: w.sessions }));
        const rateNeeds = d.totals && d.totals.rate === null && isNum(d.totals.rate_needs) && d.totals.sessions < d.totals.rate_needs;
        return {
          period: d.period,
          numbers: [
            { id: "visits", label: "AI visits", value: d.totals?.sessions ?? null, before: d.before?.sessions },
            { id: "leads", label: "Leads", value: d.totals?.leads ?? null, before: d.before?.leads },
            { id: "rate", label: "Lead rate", fmt: "pct", value: d.totals?.rate ?? null, before: d.before?.rate, sub: rateNeeds ? t("Needs {n} visits").replace("{n}", num(d.totals.rate_needs)) : undefined },
            { id: "share", label: "Share of AI visits", fmt: "pct", value: d.totals?.share ?? null },
          ],
          chart: { ...rowPanel.chart(weeks, "sessions", null, { label: "AI visits per week", everyDay: false }), dayLabel: (end) => `${t("Week to")} ${shortDay(end)}` },
          sections: [d.pages === null
            ? { title: "Landing pages", text: "Google Analytics didn't name this assistant, so not where it landed either." }
            : { title: "Landing pages", rows: d.pages, total: d.pages_total, columns: [{ label: "Page", key: "path", html: pageCell }, ...visitsAndLeads], empty: "No landing pages in this period." }],
          task: { title: `${t("Look into an assistant")}: ${key}`, host: UI.siteHostPicked(), priority: "medium", source: { type: "other", label: key, host: UI.siteHostPicked() || undefined, facts: facts(d), link: "#ai", key: `assistant|${UI.siteHostPicked() || ""}|${key}` } },
          note: String(key).includes(".") ? { label: key, where: where("domain", { domain: key }) } : true,
        };
      },
    },
  };
  /* Opens a ready-made panel. key: the channel name, the page's path, the assistant's or referring site's domain.
     opts: { host } for a page on All sites, and any spec keys to add (actions, nav…). */
  rowPanel.open = (kind, key, opener = null, opts = {}) => {
    const k = KINDS[kind];
    if (!k || !key) return null;
    const { host = null, ...extra } = opts;
    return rowPanel({
      id: kind, kind: k.kind, title: k.title(key), logo: k.logo?.(key) || "", opener,
      ...(kind === "page" ? { page: { path: key, host: host || UI.siteHostPicked() } } : {}),
      ...extra,
      load: async () => ({ ...k.spec(learn(await window.COMP.api("GET", k.url(key, { host }))), key), ...extra }),
    });
  };
  rowPanel.kinds = Object.keys(KINDS);

  // A row marked data-rp-open opens its panel on a click or Enter: links, buttons, fields and tick boxes in it keep their own job.
  function openRow(row) {
    if (!row.hasAttribute("tabindex")) row.setAttribute("tabindex", "-1"); // so focus can come back to it
    rowPanel.open(row.dataset.rpOpen, row.dataset.rpKey, row, { host: row.dataset.rpHost || null });
  }
  document.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const row = target?.closest("tr[data-rp-open]");
    if (!row || e.defaultPrevented || !UI.simple?.() || target.closest("a, button, input, select, textarea, label, summary, .chk-cell, .tt-pick, [data-rp-skip]")) return;
    openRow(row);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !(e.target instanceof Element) || !e.target.matches("tr[data-rp-open]") || !UI.simple?.()) return;
    e.preventDefault();
    openRow(e.target);
  });

  UI.rowPanel = rowPanel;

  // French for this file's words. window.FR is shared: only words nobody has yet.
  const FR = {
    "Numbers": "Chiffres", "The period before": "La période précédente", "This period": "Cette période", "See all": "Tout voir",
    "Channel": "Canal", "Page": "Page", "Assistant": "Assistant", "Referring site": "Site référent", "Keyword": "Mot-clé",
    "Sources": "Sources", "Source": "Source", "Mediums": "Supports", "Medium": "Support", "Share": "Part", "Share of all visits": "Part des visites",
    "Landing pages": "Pages d'arrivée", "Open site": "Ouvrir le site", "Open page": "Ouvrir la page", "All about this page": "Tout sur cette page", "Add a note": "Ajouter une note", "Task": "Tâche",
    "Searches that bring it": "Les recherches qui y mènent", "Where AI visits come from": "D'où viennent les visites IA", "Share of AI visits": "Part des visites IA",
    "AI visits per week": "Visites IA par semaine", "Week to": "Semaine au", "Needs {n} visits": "Il faut {n} visites",
    "No searches in this period.": "Aucune recherche sur cette période.", "No AI visits in this period.": "Aucune visite IA sur cette période.",
    "No landing pages in this period.": "Aucune page d'arrivée sur cette période.",
    "Google Analytics didn't name this assistant, so not where it landed either.": "Google Analytics n'a pas nommé cet assistant, ni donc où il est arrivé.",
    "Google Analytics not connected": "Google Analytics non connecté", "Search Console not connected": "Search Console non connectée",
    "Look into a channel": "Examiner un canal", "Look into a referring site": "Examiner un site référent", "Look into a page": "Examiner une page", "Look into an assistant": "Examiner un assistant",
    "better": "mieux", "worse": "moins bien", "No change": "Sans changement", "pts": "pts", "place": "place", "places": "places",
    "vs {range}": "par rapport au {range}",
  };
  window.FR = window.FR || {};
  Object.keys(FR).forEach((w) => { if (window.FR[w] === undefined) window.FR[w] = FR[w]; });
})();
