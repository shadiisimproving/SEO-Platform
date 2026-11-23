/* The same three tools on every table (2026-11-11): tick boxes that feed Add a note, a Filter button, and headings that sort
   when clicked. The owner asked for them on all tables, so a screen needs no code to have them: this reads each table after
   it is drawn, the way export.js adds its button.

   - A heading a screen already sorts keeps its own sort. Every other heading sorts here: up, down, then back to the default.
   - A paged table is sorted and filtered across all its pages, not just the one on show. TP.view hands the whole list to
     arrange(), and watch() notes the function the screen draws its rows with, so a row's cells can be read without showing it.
   - A table with its own tick boxes keeps them, and its bar gains Add a note.
   - Left alone: tables with no heading row, fixed comparisons (.cp-facts, .pt-vs), and anything marked data-tt-off.

   Quiet tables, on the simpler screens only (html[data-simple="1"], UI.simple(); 2026-11-11). Nothing is taken away:
   - Filter and its chips sit in the card's head (.card-head) when the card holds just this table. Elsewhere a screen marks
     the place with data-tt-slot: empty, for the first table after it in the same card or section; or naming a table's id
     or key, data-tt-slot="kw-table". Without either, the row above the table stays.
   - A count badge (.n-badge) follows the title of that head. A footer with nothing to press (one page, 25 rows or fewer)
     then hides; its markup stays. data-tt-own-count: the screen shows the count itself, so no badge, and the footer hides.
   - data-tt-filter-off on a table or around it: no Filter. Ticks and sorting stay.
   - Row tick boxes, the ones added here and a screen's own, show on hover or focus of their row, and on every row once one
     is ticked (table.tt-some). A screen marks a row's own buttons with .row-act to have them do the same (table-tools.css).
   With the switch off, none of these marks does anything, so a screen can add them unconditionally. */
(() => {
  "use strict";
  const TABLES = "table.data, table.lc-table, table.mini";
  const LEFT_ALONE = ".cp-facts, .pt-vs, [data-tt-off]";
  const OWN_BARS = ".selbar:not(#tt-bar), .ov-selbar, .pr-pick-bar";
  const MAX_VALUES = 30; // more different values than this and a column is filtered by typing instead of ticking
  const DAY = 86400000;

  const U = () => window.UI;
  const t = (key) => (U()?.t ? U().t(key) : key);
  const esc = (value) => U().esc(value);
  const num = (n) => U().num(n);
  const fold = (value) => window.TP.fold(value);
  const fill = (text, values) => Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, v), t(text));

  const simple = () => (U()?.simple ? !!U().simple() : document.documentElement.dataset.simple === "1"); // mockup.js's switch

  const states = new Map();
  function stateOf(key) {
    if (!states.has(key)) states.set(key, { sort: null, filters: new Map(), draw: null, all: [], cache: new Map(), paged: false, domRows: [], col: null });
    return states.get(key);
  }
  const active = (st) => !!st.sort || st.filters.size > 0;

  // ---- reading a cell ------------------------------------------------------------------------------
  const EMPTY = /^[\s—–\-·?…]*$/;
  function cellText(td) {
    const copy = td.cloneNode(true);
    copy.querySelectorAll("select").forEach((s) => s.replaceWith(s.selectedOptions[0]?.textContent || ""));
    copy.querySelectorAll(".sr, svg, style, script, .icon-btn").forEach((extra) => extra.remove());
    copy.querySelectorAll("*:not(b, i, em, strong, sup, sub)").forEach((el) => el.after(" ")); // lines drawn apart stay apart as words
    const text = copy.textContent.replace(/\s+/g, " ").trim();
    if (text) return text;
    // A cell of logos has no words of its own: its names are on the logos.
    return [...td.querySelectorAll("[alt], [title], [data-tip]")].map((x) => x.getAttribute("alt") || x.getAttribute("title") || x.getAttribute("data-tip")).filter(Boolean).join(", ");
  }
  const readCell = (td) => ({ text: cellText(td), sort: td.dataset.sort ?? null });

  /* Rows that aren't on show are read in a separate inert document: nothing in it runs, and no logo is fetched for them. */
  const parser = new DOMParser();
  function cellsFromHtml(st, html) {
    let cells = st.cache.get(html);
    if (cells) return cells;
    const tr = parser.parseFromString(`<table>${html}</table>`, "text/html").querySelector("tr");
    cells = tr ? [...tr.cells].map(readCell) : [];
    if (st.cache.size > 30000) st.cache.clear();
    st.cache.set(html, cells);
    return cells;
  }
  function rowCells(st, row, i) {
    try { return cellsFromHtml(st, String(st.draw(row, i))); } catch { return []; }
  }
  const columnCells = (st, col) => (st.paged ? st.all.map((row, i) => rowCells(st, row, i)[col]) : st.domRows.map((tr) => { const td = dataCells(tr)[col]; return td ? readCell(td) : undefined; }));

  // ---- what a value is -----------------------------------------------------------------------------
  const MONTH = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
  const FRENCH_MONTHS = [[/\bjanv\w*/, "jan"], [/\bfevr\w*/, "feb"], [/\bmars\b/, "mar"], [/\bavr\w*/, "apr"], [/\bmai\b/, "may"], [/\bjuin\b/, "jun"], [/\bjuil\w*/, "jul"], [/\baout\b/, "aug"]];
  const UNIT_DAYS = [[/^(min|minutes?)$/, 1 / 1440], [/^(h|hours?|heures?)$/, 1 / 24], [/^(d|j|days?|jours?)$/, 1], [/^(w|weeks?|sem|semaines?)$/, 7], [/^(mo|months?|mois)$/, 30], [/^(y|years?|ans?)$/, 365]];
  function whenOf(text) {
    let s = fold(text).trim();
    if (/^(today|aujourd'hui|just now|a l'instant)/.test(s)) return Date.now();
    if (/^(yesterday|hier)/.test(s)) return Date.now() - DAY;
    const ago = s.replace(/^il y a\s+/, "").match(/^(\d+)\s*([a-z]+)(\s+ago)?$/);
    if (ago) {
      const unit = UNIT_DAYS.find(([re]) => re.test(ago[2]));
      if (unit) return Date.now() - Number(ago[1]) * unit[1] * DAY;
    }
    const iso = s.match(/^\d{4}-\d{2}(-\d{2})?/);
    if (iso) return Date.parse(iso[0]) || null;
    FRENCH_MONTHS.forEach(([re, en]) => { s = s.replace(re, en); });
    const named = s.match(new RegExp(`^(\\d{1,2}\\s+)?(${MONTH})[a-z]*\\.?(\\s+\\d{1,2})?(,?\\s+\\d{4})?`));
    if (!named) return null;
    return Date.parse(/\d{4}/.test(named[0]) ? named[0] : `${named[0]} ${new Date().getFullYear()}`) || null;
  }
  function numberOf(text) {
    const m = String(text).replace(/[  ]/g, " ").trim().match(/^[#≈~<>]?\s*([+\-−]?\s?\d[\d ,.]*)\s*(k\b|m\b|%)?/i);
    if (!m) return null;
    const raw = m[1].replace(/\s/g, "").replace("−", "-");
    const n = parseFloat(U()?.state?.lang === "fr" ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, ""));
    if (Number.isNaN(n)) return null;
    return n * ({ k: 1e3, m: 1e6 }[m[2]?.toLowerCase()] || 1);
  }
  const isBlank = (cell) => !cell || (cell.sort === null && EMPTY.test(cell.text));

  /* A column is dates or numbers when nearly all its filled cells are; otherwise it is words. */
  function kindOf(cells) {
    const filled = cells.filter((c) => !isBlank(c)).map((c) => c.sort ?? c.text);
    if (!filled.length) return "text";
    const share = (read) => filled.filter((v) => read(v) !== null).length / filled.length;
    if (share(whenOf) >= 0.8) return "date";
    return share(numberOf) >= 0.8 ? "number" : "text";
  }
  const valueOf = (cell, kind) => { const raw = cell.sort ?? cell.text; return kind === "date" ? whenOf(raw) : kind === "number" ? numberOf(raw) : raw; };

  /* Blank cells stay at the bottom whichever way the column runs. */
  function compare(a, b, kind, dir) {
    const x = isBlank(a) ? null : valueOf(a, kind), y = isBlank(b) ? null : valueOf(b, kind);
    if (x === null || y === null) return (x === null) - (y === null);
    return (kind === "text" ? String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" }) : x - y) * dir;
  }
  function passes(filter, cell) {
    const text = cell?.text || "";
    if (filter.kind === "values") return filter.values.has(EMPTY.test(text) ? "" : text);
    if (filter.kind === "range") {
      const n = numberOf(text);
      return n !== null && (filter.min === null || n >= filter.min) && (filter.max === null || n <= filter.max);
    }
    const words = fold(filter.q).trim().split(/\s+/), hay = fold(text);
    return words.every((word) => hay.includes(word));
  }

  // ---- paged tables: called by TP.view -------------------------------------------------------------
  function arrange(key, list) {
    const st = stateOf(key);
    st.all = list;
    st.count = list.length;
    if (!st.draw || !active(st)) return list;
    const cells = list.map((row, i) => rowCells(st, row, i));
    const order = list.map((_, i) => i).filter((i) => [...st.filters].every(([col, f]) => passes(f, cells[i][col])));
    if (st.sort) {
      const { col, dir } = st.sort, kind = kindOf(order.map((i) => cells[i][col]));
      order.sort((a, b) => compare(cells[a][col], cells[b][col], kind, dir));
    }
    st.count = order.length;
    return order.map((i) => list[i]);
  }
  /* Notes how this table draws a row, from the screen's own rows.map(...). A map that doesn't make table rows is ignored. */
  function watch(key, rows) {
    Object.defineProperty(rows, "map", {
      enumerable: false,
      value(fn, that) {
        const out = Array.prototype.map.call(this, fn, that);
        if (typeof out[0] === "string" && /<t[rd][\s>]/i.test(out[0])) stateOf(key).draw = that ? fn.bind(that) : fn;
        return out;
      },
    });
    return rows;
  }
  /* A filter can leave nothing: the footer stays, so the table is still known as this one and the filter can be undone. */
  function emptyFoot(key) {
    if (!stateOf(key).filters.size) return "";
    return `<div class="tp-foot" data-tp-foot="${esc(key)}"${simple() ? ` data-tp-total="0"` : ""}><span class="tp-range">${t("No row matches these filters.")}</span></div>`;
  }

  // ---- a table's parts -----------------------------------------------------------------------------
  const dataCells = (tr) => [...tr.cells].filter((c) => !c.classList.contains("tt-pick"));
  const headRowOf = (table) => table.tHead?.rows[table.tHead.rows.length - 1] || null;
  const wrapOf = (table) => table.closest(".table-wrap, .cl-scroll") || table;
  function footOf(table) {
    for (const node of [table, wrapOf(table)]) {
      const next = node.nextElementSibling;
      if (next?.matches("[data-tp-foot]")) return next;
    }
    return null;
  }
  const pagedKey = (table) => footOf(table)?.dataset.tpFoot ?? null;
  function headLabel(th) {
    const copy = th.cloneNode(true);
    copy.querySelectorAll(".sr, .sr-only, svg, img, .th-sub, input").forEach((extra) => extra.remove()); // a head only a screen reader hears (Task) gets no sort arrow
    return copy.textContent.replace(/\s+/g, " ").trim();
  }
  const tableOf = (key) => document.querySelector(`table[data-tt-key="${CSS.escape(key)}"]`);

  // ---- ticking rows --------------------------------------------------------------------------------
  const picked = new Map(); // rows ticked in the boxes added here
  const ownPicked = new Map(); // rows ticked in a screen's own boxes, kept so a note can cover other pages of the table
  const rowKey = (tr) => {
    if (!tr._ttKey) tr._ttKey = `${dataCells(tr).map(cellText).join("|")}|${tr.querySelector('a[href^="http"]')?.href || ""}`;
    return tr._ttKey;
  };

  const screenId = () => U()?.state?.route || "";
  const notesKnow = (id) => { const name = window.COMP?.notes?.screenName?.(id); return !!id && name !== id && name !== t("A screen"); };

  /* What a note on this row is about: the row's own keyword, website, task or page. Otherwise the screen it was ticked on. */
  function whereOf(table, tr, labels, texts) {
    const siteId = U().siteIdPicked?.() ?? null;
    const task = tr.closest("#tk-table") ? (tr.dataset.taskOpen ?? tr.querySelector("[data-task-open]")?.dataset.taskOpen) : null;
    if (task != null && task !== "") return { scope: "task", taskId: Number(task), task: texts[0], siteId };
    const at = labels.findIndex((label, i) => label && !EMPTY.test(texts[i] || ""));
    if (at >= 0) {
      const first = dataCells(tr)[at], text = texts[at];
      if (/^(keyword|query|search term|mot-cle|mots-cles|requete)/.test(fold(labels[at]))) {
        const words = first.querySelector(".kw, .t, [dir='auto']")?.textContent.trim() || text;
        return { scope: "keyword", keyword: words, siteId };
      }
      const link = first.querySelector('a[href^="http"]')?.href;
      const host = text.match(/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?=$|\s)/i);
      if (host && !(link && new URL(link).pathname.length > 1)) return { scope: "domain", domain: host[0] };
      if (link) return { scope: "page", pageUrl: link, siteId };
    }
    const screen = screenId();
    return notesKnow(screen) ? { scope: "screen", screen, siteId } : { scope: "site", siteId };
  }
  function recordOf(table, tr) {
    const head = headRowOf(table), labels = dataCells(head).map(headLabel), cells = dataCells(tr), texts = cells.map(cellText);
    const lines = labels.map((label, i) => (label && !EMPTY.test(texts[i] || "") ? `${label}: ${texts[i]}` : null)).filter(Boolean);
    return { where: whereOf(table, tr, labels, texts), context: lines.join("\n") };
  }
  /* A screen whose own picks reach past the page on show (Keywords' "Select all") names the picked rows itself. Each is read
     through the screen's own row drawing, the way a filter reads rows that aren't shown, so its note matches a ticked row's. */
  const ownSources = new Map(); // the bar's id → () => [the table's key, the picked rows' data]
  function recordsOf(key, list) {
    const st = stateOf(key), table = tableOf(key);
    if (!st.draw || !table) return null;
    const out = new Map();
    list.forEach((row, i) => {
      const tr = parser.parseFromString(`<table>${st.draw(row, i)}</table>`, "text/html").querySelector("tr");
      if (tr) out.set(`${key}\u0001${rowKey(tr)}`, recordOf(table, tr));
    });
    return out;
  }
  function ownRecords(button) {
    const bar = button.closest(OWN_BARS), from = bar?.id ? ownSources.get(bar.id)?.() : null;
    return (from && recordsOf(from[0], from[1])) || ownPicked;
  }

  function paintBar() {
    let bar = document.getElementById("tt-bar");
    if (window.ACCESS && !window.ACCESS.canEdit("notes")) { bar?.remove(); return; } // "Add a note" needs Notes, Can edit
    if (!picked.size) { bar?.remove(); return; }
    if (!bar) { bar = document.createElement("div"); bar.id = "tt-bar"; bar.className = "selbar cg-selbar tt-bar"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", t("selected")); document.body.append(bar); }
    U().setHTML(bar, `<b class="cg-sel-count">${num(picked.size)} ${t("selected")}</b>
      <button type="button" class="btn btn-main btn-small" data-tt-note>${U().icon("pencil")}${t("Add a note")}</button>
      <button type="button" class="icon-btn" data-tt-clear-picks aria-label="${t("Clear selection")}" data-tip="${t("Clear selection")}">${U().icon("x")}</button>`);
  }
  function paintTicks(table, key, rows) {
    let on = 0;
    rows.forEach((tr) => {
      const box = tr.querySelector(":scope > .tt-pick input"), yes = picked.has(`${key}\u0001${rowKey(tr)}`);
      if (box) box.checked = yes;
      tr.classList.toggle("is-picked", yes);
      if (yes && !tr.hidden) on += 1;
    });
    const all = headRowOf(table)?.querySelector(":scope > .tt-pick input");
    const shown = rows.filter((tr) => !tr.hidden).length;
    if (all) { all.checked = shown > 0 && on === shown; all.indeterminate = on > 0 && on < shown; }
    if (simple()) table.classList.toggle("tt-some", anyOf(picked, key)); // once one row is ticked, every row shows its box
  }
  const anyOf = (map, key) => { const start = `${key}\u0001`; for (const id of map.keys()) if (id.startsWith(start)) return true; return false; };
  function clearPicks() {
    picked.clear();
    paintBar();
    document.querySelectorAll("table[data-tt-key]").forEach((table) => paintTicks(table, table.dataset.ttKey, rowsOf(table, dataCells(headRowOf(table)).length)));
  }

  // ---- one note per ticked row ---------------------------------------------------------------------
  let noteFrom = null;
  function openNote(opener, source) {
    if (!source.size) return;
    noteFrom = source;
    const n = source.size, shown = [...source.values()].map((r) => r.context).join("\n\n———\n\n");
    U().openPanel(`${U().panelHead(t("Add a note"), esc(n === 1 ? t("One note on this row") : fill("One note per row, {n} rows", { n: num(n) })))}
      <form class="panel-body" id="tt-note-form" novalidate>
        <label class="field"><span>${t("Your note")}</span><textarea class="input" id="tt-note-text" rows="5" dir="auto" data-autofocus></textarea></label>
        <div class="field"><span>${t("Saved with it")}</span><pre class="pt-qn-context" dir="auto" tabindex="0">${esc(shown)}</pre></div>
        <div id="tt-note-error"></div>
      </form>
      <div class="panel-foot"><button type="button" class="btn btn-main" data-tt-note-save>${t("Save note")}</button><button type="button" class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener, { key: "tt-note", reopen: () => openNote(opener, source) });
  }
  async function saveNote(button) {
    const words = document.getElementById("tt-note-text")?.value.trim() || "", source = noteFrom, total = source?.size || 0;
    if (!total) return;
    button.disabled = true;
    try {
      for (const [key, record] of [...source]) { // one at a time, each dropped once saved, so trying again never writes a note twice
        await window.COMP.notes.add(record.where, `${words ? `${words}\n\n` : ""}${record.context}`);
        source.delete(key);
      }
      U().closePanel({ keep: false });
      if (source === picked) clearPicks();
      else document.querySelectorAll(OWN_BARS).forEach((bar) => bar.querySelector("[data-ov-pick-clear], #pr-pick-clear, .icon-btn:last-child")?.click());
      window.COMP.notes.loadAllOnce?.();
      U().toast?.(total === 1 ? t("Note saved.") : fill("{n} notes saved.", { n: num(total) }));
    } catch (err) {
      button.disabled = false;
      U().setHTML(document.getElementById("tt-note-error"), `<p class="note warn">${U().icon("triangle-alert")}<span>${esc(err.message || t("The note didn't save. Your text is still here."))}</span></p>`);
    }
  }

  // ---- the Filter button ---------------------------------------------------------------------------
  const describe = (f) => {
    if (f.kind === "text") return `“${f.q}”`;
    if (f.kind === "range") return f.min !== null && f.max !== null ? `${num(f.min)}–${num(f.max)}` : f.min !== null ? `≥ ${num(f.min)}` : `≤ ${num(f.max)}`;
    const names = [...f.values].map((v) => v || t("Empty"));
    return names.length <= 2 ? names.join(", ") : fill("{n} values", { n: num(names.length) });
  };
  function labelsOf(key) {
    const table = tableOf(key), head = table && headRowOf(table);
    return head ? dataCells(head).map(headLabel) : [];
  }
  /* host: on the simpler screens, the card head or data-tt-slot the tools sit in (else the row above the table); off: no Filter. */
  function paintTools(table, key, st, rowCount, host = null, off = false) {
    const wrap = wrapOf(table);
    let bar = wrap.previousElementSibling?.matches?.(".tt-tools") ? wrap.previousElementSibling : null;
    if (host) { bar?.remove(); bar = headBar(key, host); }
    if (off || (rowCount < 2 && !st.filters.size)) { bar?.remove(); return; }
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "tt-tools";
      if (host) { // at the head's end, on the title's line: before a hint that takes a line of its own
        bar.classList.add("tt-in-head");
        bar.dataset.ttFor = key;
        host.insertBefore(bar, host.querySelector(":scope > .hint-text"));
        claimed.add(bar);
      } else wrap.before(bar);
    }
    const labels = dataCells(headRowOf(table)).map(headLabel), k = esc(key);
    const chips = [...st.filters].map(([col, f]) => `<span class="tt-chip"><span>${esc(labels[col] || "")}: ${esc(describe(f))}</span><button type="button" class="tt-chip-x" data-tt-key="${k}" data-tt-unfilter="${col}" aria-label="${esc(fill("Remove the filter on {column}", { column: labels[col] || "" }))}">${U().icon("x")}</button></span>`).join("");
    const signature = `${key}|${U().state?.lang}|${labels.join("|")}|${chips}`;
    if (bar.dataset.signature === signature) return;
    bar.dataset.signature = signature;
    U().setHTML(bar, `${chips}${st.filters.size > 1 ? `<button type="button" class="link-btn" data-tt-key="${k}" data-tt-unfilter-all>${t("Clear all")}</button>` : ""}<button type="button" class="btn btn-small tt-filter" data-tt-key="${k}" data-tt-filter aria-haspopup="dialog" aria-expanded="false">${U().icon("filter")}${t("Filter")}${st.filters.size ? ` <b class="tt-count">${num(st.filters.size)}</b>` : ""}</button>`);
  }

  let pop = null;
  function closePop(focusBack = false) {
    if (!pop) return;
    const key = pop.key;
    pop.el.remove();
    pop = null;
    document.querySelectorAll(`[data-tt-filter][data-tt-key="${CSS.escape(key)}"]`).forEach((b) => b.setAttribute("aria-expanded", "false"));
    if (focusBack) document.querySelector(`[data-tt-filter][data-tt-key="${CSS.escape(key)}"]`)?.focus();
  }
  function controlHtml(st, col) {
    const cells = columnCells(st, col).filter(Boolean), kind = kindOf(cells), f = st.filters.get(col);
    if (kind === "number") {
      return `<div class="tt-range"><label class="field"><span>${t("From")}</span><input class="input" type="number" step="any" data-tt-min value="${f?.kind === "range" && f.min !== null ? f.min : ""}"></label><label class="field"><span>${t("To")}</span><input class="input" type="number" step="any" data-tt-max value="${f?.kind === "range" && f.max !== null ? f.max : ""}"></label></div>`;
    }
    const counts = new Map();
    cells.forEach((c) => { const text = EMPTY.test(c.text) ? "" : c.text; counts.set(text, (counts.get(text) || 0) + 1); });
    if (counts.size > MAX_VALUES) return `<label class="field"><span>${t("Contains")}</span><input class="input" type="search" data-tt-text dir="auto" autocomplete="off" value="${esc(f?.kind === "text" ? f.q : "")}"></label>`;
    const values = [...counts].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: "base" }));
    return `<div class="tt-values">${values.map(([value, n]) => `<label class="opt"><input type="checkbox" class="chk" style="margin:0" data-tt-value="${esc(value)}" ${f?.kind === "values" && f.values.has(value) ? "checked" : ""}><span dir="auto">${esc(value || t("Empty"))}</span><span class="tt-n">${num(n)}</span></label>`).join("")}</div>`;
  }
  function paintPop() {
    const { key, el } = pop, st = stateOf(key), labels = labelsOf(key);
    const columns = labels.map((label, i) => [label, i]).filter(([label]) => label);
    if (!columns.some(([, i]) => i === st.col)) st.col = [...st.filters.keys()][0] ?? columns[0]?.[1] ?? null;
    if (st.col === null) { closePop(); return; }
    const on = st.sort?.col === st.col ? st.sort.dir : 0;
    U().setHTML(el, `<label class="field"><span>${t("Column")}</span><select class="select" data-tt-column>${columns.map(([label, i]) => `<option value="${i}" ${i === st.col ? "selected" : ""}>${esc(label)}${st.filters.has(i) ? " •" : ""}</option>`).join("")}</select></label>
      <div data-tt-control>${controlHtml(st, st.col)}</div>
      <div class="tt-sortrow"><span>${t("Sort")}</span><button type="button" class="btn btn-small" data-tt-dir="1" aria-pressed="${on === 1}">${U().icon("arrow-up")}${t("Ascending")}</button><button type="button" class="btn btn-small" data-tt-dir="-1" aria-pressed="${on === -1}">${U().icon("arrow-down")}${t("Descending")}</button></div>
      <div class="tt-popfoot"><button type="button" class="link-btn" data-tt-col-clear ${st.filters.has(st.col) ? "" : "disabled"}>${t("Clear this filter")}</button><button type="button" class="btn btn-main btn-small" data-tt-done>${t("Done")}</button></div>`);
  }
  function openPop(button) {
    const key = button.dataset.ttKey;
    if (pop?.key === key) { closePop(true); return; }
    closePop();
    button.setAttribute("aria-expanded", "true");
    const el = document.createElement("div");
    el.className = "popover tt-pop";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", t("Filter"));
    document.body.append(el);
    pop = { key, el };
    paintPop();
    if (!pop) return;
    const at = button.getBoundingClientRect(), box = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(at.right - box.width, innerWidth - box.width - 8))}px`;
    el.style.top = `${at.bottom + box.height + 12 > innerHeight ? Math.max(8, at.top - box.height - 6) : at.bottom + 6}px`;
    el.querySelector("[data-tt-column]")?.focus();
  }
  function setFilter(f) {
    const st = stateOf(pop.key);
    if (f) st.filters.set(st.col, f); else st.filters.delete(st.col);
    rearrange(pop.key);
    const clear = pop.el.querySelector("[data-tt-col-clear]");
    if (clear) clear.disabled = !f;
  }

  // ---- quiet tables, on the simpler screens only (see the top of this file) ----------------------------
  const BOX = ".card, section, details, .panel, dialog";
  const before = (a, b) => !a.contains(b) && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  /* The place a screen chose: a data-tt-slot naming this table, or an empty one before it in the same box, with no other
     table between them. */
  function slotFor(table, key) {
    for (const name of [table.id, key]) {
      const named = name && document.querySelector(`[data-tt-slot="${CSS.escape(name)}"]`);
      if (named && !named.contains(table)) return named;
    }
    const box = table.closest(BOX), scope = box || table.closest("#page, #panel") || document.body;
    const slot = [...scope.querySelectorAll('[data-tt-slot=""]')].filter((s) => s.closest(BOX) === box && before(s, table)).pop();
    if (!slot) return null;
    return [...scope.querySelectorAll(TABLES)].some((other) => other !== table && before(slot, other) && before(other, table)) ? null : slot;
  }
  /* Else the head of a card that holds this one table, unless the table sits further in, in a fold or a section of its own. */
  function cardHeadFor(table) {
    const card = table.closest(".card");
    if (!card || table.closest(BOX) !== card || card.querySelectorAll(TABLES).length !== 1) return null;
    const head = [...card.children].find((child) => child.classList.contains("card-head"));
    return head && before(head, table) ? head : null;
  }
  /* The head tools and badges drawn in this pass. Any other one is left over (its table went, or now sits elsewhere) and goes. */
  const claimed = new Set();
  function headBar(key, host) {
    const bar = host.querySelector(`:scope > .tt-in-head[data-tt-for="${CSS.escape(key)}"]`);
    if (bar) claimed.add(bar);
    return bar;
  }
  /* The count badge after the head's title, before the title's (i). A footer with nothing to press then hides (CSS). */
  function paintCount(table, key, count, host) {
    const own = !!table.closest("[data-tt-own-count]");
    const title = own || !host ? null : (host.closest(".card-head") || host).querySelector("h2, h3");
    if (title) {
      let badge = title.querySelector(`:scope > .n-badge[data-tt-badge-for="${CSS.escape(key)}"]`);
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "n-badge";
        badge.dataset.ttBadgeFor = key;
        title.insertBefore(badge, [...title.children].find((child) => child.matches(".def-i, .comp-info, .icon-btn, [data-tip]")) || null);
      }
      claimed.add(badge);
      const text = num(count);
      if (badge.textContent !== text) badge.textContent = text;
    }
    footOf(table)?.classList.toggle("tt-counted", own || !!title);
  }
  /* A screen's own tick boxes: the column whose heading holds a box. They show the same way as the ones added here. */
  function markOwnTicks(head, rows) {
    const at = [...head.cells].findIndex((cell) => !cell.classList.contains("tt-pick") && cell.querySelector("input[type=checkbox]"));
    if (at < 0) return;
    rows.forEach((tr) => { const td = tr.cells[at]; if (td?.querySelector("input[type=checkbox]")) td.classList.add("tt-own-pick"); });
  }
  function finishQuiet() {
    document.querySelectorAll("table[data-tt-key]").forEach((table) => {
      if (!table.querySelector(":scope > tbody > tr > td.tt-own-pick")) return;
      const key = table.dataset.ttKey;
      table.classList.toggle("tt-some", !!table.querySelector(":scope > tbody > tr > td.tt-own-pick input:checked") || anyOf(ownPicked, key));
    });
    // A head or title can outlive its table: its tools and badge go with the table.
    document.querySelectorAll(".tt-in-head, .n-badge[data-tt-badge-for]").forEach((el) => { if (!claimed.has(el)) el.remove(); });
    claimed.clear();
  }
  /* A chip removed from a head leaves the keyboard on that table's Filter, beside it, rather than at the top of the page. */
  const backToFilter = (el) => (simple() ? () => document.querySelector(`[data-tt-filter][data-tt-key="${CSS.escape(el.dataset.ttKey)}"]`)?.focus() : undefined);

  // ---- drawing the tools on a table ----------------------------------------------------------------
  function rowsOf(table, count) {
    return [...table.tBodies].flatMap((body) => [...body.rows]).filter((tr) => dataCells(tr).length === count && ![...tr.cells].some((c) => c.colSpan > 1));
  }
  const iconHtml = (name, cls) => U().icon(name, cls);

  function paintHead(table, key, st, cells, canArrange) {
    cells.forEach((th, i) => {
      if (th.querySelector("input")) return;
      const own = th.querySelector("button:not(.icon-btn):not([data-tt-sort])");
      if (own) {
        if (st.sort) th.setAttribute("aria-sort", "none");
        if (!own.querySelector("svg")) own.insertAdjacentHTML("beforeend", iconHtml("chevrons-up-down", "tt-idle"));
        return;
      }
      let button = th.querySelector("[data-tt-sort]");
      if (!button) {
        if (!canArrange || !headLabel(th) || th.querySelector("button, a, select")) return;
        button = document.createElement("button");
        button.type = "button";
        button.className = "th-btn tt-th";
        button.dataset.ttSort = String(i);
        button.dataset.ttKey = key;
        // A definition mark (i) is focusable on its own, so it stays beside the sort button, never inside it (a control in a control).
        const marks = [...th.childNodes].filter((n) => n.nodeType === 1 && n.matches(".def-i"));
        button.append(...[...th.childNodes].filter((n) => !marks.includes(n)));
        th.append(button, ...marks);
        th.dataset.ttCol = "";
      }
      const dir = st.sort?.col === i ? st.sort.dir : 0, shown = String(dir);
      th.setAttribute("aria-sort", dir === 1 ? "ascending" : dir === -1 ? "descending" : "none");
      if (button.dataset.ttShown === shown) return;
      button.dataset.ttShown = shown;
      button.querySelector("svg.tt-arrow")?.remove();
      button.insertAdjacentHTML("beforeend", iconHtml(dir === 1 ? "arrow-up" : dir === -1 ? "arrow-down" : "chevrons-up-down", dir ? "tt-arrow" : "tt-arrow tt-idle"));
    });
  }
  function addTicks(table, head, rows) {
    if (window.ACCESS && !window.ACCESS.canEdit("notes")) return; // the ticks only lead to "Add a note"
    if (!head.querySelector(":scope > .tt-pick")) {
      const th = document.createElement("th");
      th.scope = "col";
      th.className = "chk-cell tt-pick";
      U().setHTML(th, `<input type="checkbox" class="chk" style="margin:0" data-tt-all aria-label="${t("Select all shown")}">`);
      head.prepend(th);
      [...table.tHead.rows].filter((r) => r !== head).forEach((r) => { const blank = document.createElement("th"); blank.className = "tt-pick"; r.prepend(blank); });
    }
    rows.forEach((tr) => {
      if (tr.querySelector(":scope > .tt-pick")) return;
      const td = document.createElement("td");
      td.className = "chk-cell tt-pick";
      td.dataset.label = "";
      U().setHTML(td, `<input type="checkbox" class="chk" style="margin:0" data-tt-row aria-label="${esc(`${t("Select")}: ${cellText(dataCells(tr)[0] || td).slice(0, 80)}`)}">`);
      tr.prepend(td);
    });
    // A full-width line under a row, or a totals row, must stay as wide as the table.
    [...table.tBodies].flatMap((body) => [...body.rows]).concat(table.tFoot ? [...table.tFoot.rows] : []).filter((tr) => !rows.includes(tr) && !tr._ttWide).forEach((tr) => {
      tr._ttWide = true;
      const last = tr.cells[0];
      if (last) last.colSpan += 1;
    });
  }
  /* A table with every row on screen is sorted and filtered right here. */
  function arrangeDom(table, st, rows, count) {
    const body = table.tBodies[0];
    rows.forEach((tr, i) => { if (tr._ttAt === undefined) tr._ttAt = i; });
    const cellAt = (tr, col) => { const td = dataCells(tr)[col]; return td ? readCell(td) : undefined; };
    rows.forEach((tr) => {
      tr.hidden = ![...st.filters].every(([col, f]) => passes(f, cellAt(tr, col)));
      if (tr.nextElementSibling && dataCells(tr.nextElementSibling).length !== count) tr.nextElementSibling.hidden = tr.hidden;
    });
    let order = [...rows].sort((a, b) => a._ttAt - b._ttAt);
    if (st.sort) {
      const { col, dir } = st.sort, kind = kindOf(rows.map((tr) => cellAt(tr, col)));
      order = order.sort((a, b) => compare(cellAt(a, col), cellAt(b, col), kind, dir));
    }
    if (order.some((tr, i) => tr !== rows[i])) order.forEach((tr) => { const under = tr.nextElementSibling && dataCells(tr.nextElementSibling).length !== count ? tr.nextElementSibling : null; body.append(tr); if (under) body.append(under); });
  }

  function enhance(table) {
    if (table.matches(LEFT_ALONE)) return;
    const head = headRowOf(table);
    if (!head || !head.cells.length) return;
    const cells = dataCells(head), count = cells.length;
    const paged = pagedKey(table);
    const key = paged || `dom:${screenId()}|${table.id || cells.map(headLabel).join("|")}`;
    const st = stateOf(key);
    table.dataset.ttKey = key;
    st.paged = !!paged;
    const rows = rowsOf(table, count);
    const wide = cells.some((c) => c.colSpan > 1);
    // data-tt-arrange-off: the screen sorts and filters this table with its own, plainer controls (Competitors → Changes,
    // whose rows sit in named groups a column sort would break up). Tick boxes and Add a note stay.
    const canArrange = !wide && !table.hasAttribute("data-tt-arrange-off") && (paged ? !!st.draw : table.tBodies.length === 1);
    const ownTicks = !!head.querySelector("input[type=checkbox]:not([data-tt-all])");

    if (ownTicks) syncOwn(table, key, rows);
    else if (rows.length || head.querySelector(":scope > .tt-pick")) addTicks(table, head, rows);
    paintHead(table, key, st, cells, canArrange);
    table.classList.toggle("tt-sorted", !!st.sort);
    if (!paged && canArrange) {
      st.domRows = rows;
      if (active(st) || table._ttArranged) arrangeDom(table, st, rows, count);
      table._ttArranged = active(st);
    }
    if (!ownTicks) paintTicks(table, key, rows);
    const quiet = simple(), host = quiet ? slotFor(table, key) || cardHeadFor(table) : null;
    if (canArrange) paintTools(table, key, st, paged ? st.all.length : rows.length, host, quiet && !!table.closest("[data-tt-filter-off]"));
    if (!quiet) return;
    if (ownTicks) markOwnTicks(head, rows);
    const total = paged ? Number(footOf(table)?.dataset.tpTotal ?? st.count ?? st.all.length) : rows.filter((tr) => !tr.hidden).length;
    paintCount(table, key, total, host);
  }
  function syncOwn(table, key, rows) {
    rows.forEach((tr) => {
      const box = tr.querySelector("input[type=checkbox]");
      if (!box) return;
      const id = `${key}\u0001${rowKey(tr)}`;
      if (box.checked) { if (!ownPicked.has(id)) ownPicked.set(id, recordOf(table, tr)); } else ownPicked.delete(id);
    });
  }
  /* A screen's own "N selected" bar gets Add a note. */
  function paintOwnBars() {
    let any = false;
    document.querySelectorAll(OWN_BARS).forEach((bar) => {
      if (bar.hidden || !bar.childElementCount || bar.querySelector("[data-pt-q-note]")) return;
      any = true;
      if (bar.querySelector("[data-tt-note-own]")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-small";
      button.dataset.ttNoteOwn = "";
      U().setHTML(button, `${U().icon("pencil")}${t("Add a note")}`);
      const clear = bar.querySelector("[data-ov-pick-clear], #pr-pick-clear, .icon-btn:last-child");
      if (clear) clear.before(button); else bar.append(button);
    });
    if (!any) ownPicked.clear();
  }

  function run() {
    if (!window.UI?.icon || !window.TP) return;
    claimed.clear();
    document.querySelectorAll(TABLES).forEach(enhance);
    paintOwnBars();
    if (simple()) finishQuiet();
    observer.takeRecords(); // what this just changed needn't be looked at again
  }
  function rearrange(key, focus) {
    const st = stateOf(key);
    if (st.paged) { window.TP.reset(key); window.TP.paint(key, focus); return; }
    const table = tableOf(key);
    if (table) { enhance(table); observer.takeRecords(); }
    if (focus) requestAnimationFrame(focus);
  }

  const observer = new MutationObserver(run);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // ---- clicks and typing ---------------------------------------------------------------------------
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (pop && !pop.el.contains(target) && !target.closest?.("[data-tt-filter]")) closePop();
    if (!target.closest) return;
    if (target.closest(".tt-pick input")) { event.stopPropagation(); return; } // a tick never opens the row
    const sort = target.closest("[data-tt-sort]");
    if (sort) {
      event.preventDefault(); event.stopPropagation();
      const key = sort.dataset.ttKey, col = Number(sort.dataset.ttSort), st = stateOf(key);
      st.sort = st.sort?.col !== col ? { col, dir: 1 } : st.sort.dir === 1 ? { col, dir: -1 } : null;
      rearrange(key, () => document.querySelector(`[data-tt-key="${CSS.escape(key)}"][data-tt-sort="${col}"]`)?.focus());
      return;
    }
    const own = target.closest("th button:not(.icon-btn)");
    if (own) { const key = own.closest("table")?.dataset.ttKey; if (key) stateOf(key).sort = null; return; } // the screen's sort takes over
    let el;
    if ((el = target.closest("[data-tt-filter]"))) { event.preventDefault(); event.stopPropagation(); openPop(el); return; }
    if ((el = target.closest("[data-tt-unfilter]"))) { event.stopPropagation(); stateOf(el.dataset.ttKey).filters.delete(Number(el.dataset.ttUnfilter)); rearrange(el.dataset.ttKey, backToFilter(el)); if (pop) paintPop(); return; }
    if ((el = target.closest("[data-tt-unfilter-all]"))) { event.stopPropagation(); stateOf(el.dataset.ttKey).filters.clear(); rearrange(el.dataset.ttKey, backToFilter(el)); if (pop) paintPop(); return; }
    if (target.closest("[data-tt-note]")) { event.stopPropagation(); openNote(target.closest("[data-tt-note]"), picked); return; }
    if ((el = target.closest("[data-tt-note-own]"))) { event.stopPropagation(); run(); openNote(el, ownRecords(el)); return; }
    if ((el = target.closest("[data-tt-note-save]"))) { event.stopPropagation(); saveNote(el); return; }
    if (target.closest("[data-tt-clear-picks]")) { event.stopPropagation(); clearPicks(); return; }
    if (!pop || !pop.el.contains(target)) return;
    if (target.closest("[data-tt-done]")) { closePop(true); return; }
    if (target.closest("[data-tt-col-clear]")) { setFilter(null); paintPop(); return; }
    if ((el = target.closest("[data-tt-dir]"))) {
      const st = stateOf(pop.key), dir = Number(el.dataset.ttDir);
      st.sort = st.sort?.col === st.col && st.sort.dir === dir ? null : { col: st.col, dir };
      rearrange(pop.key);
      paintPop();
    }
  }, true);

  document.addEventListener("change", (event) => {
    const box = event.target;
    if (box.matches?.("[data-tt-row]")) {
      const tr = box.closest("tr"), table = tr.closest("table"), key = table.dataset.ttKey, id = `${key}\u0001${rowKey(tr)}`;
      if (box.checked) picked.set(id, recordOf(table, tr)); else picked.delete(id);
      paintTicks(table, key, rowsOf(table, dataCells(headRowOf(table)).length));
      paintBar();
      return;
    }
    if (box.matches?.("[data-tt-all]")) {
      const table = box.closest("table"), key = table.dataset.ttKey, rows = rowsOf(table, dataCells(headRowOf(table)).length).filter((tr) => !tr.hidden);
      rows.forEach((tr) => { const id = `${key}\u0001${rowKey(tr)}`; if (box.checked) picked.set(id, recordOf(table, tr)); else picked.delete(id); });
      paintTicks(table, key, rowsOf(table, dataCells(headRowOf(table)).length));
      paintBar();
      return;
    }
    if (box.matches?.("table input[type=checkbox]")) { setTimeout(run); return; } // a screen's own tick: read it after the screen has
    if (!pop || !pop.el.contains(box)) return;
    if (box.matches("[data-tt-column]")) { stateOf(pop.key).col = Number(box.value); paintPop(); pop?.el.querySelector("[data-tt-column]")?.focus(); return; }
    if (box.matches("[data-tt-value]")) {
      const values = new Set([...pop.el.querySelectorAll("[data-tt-value]:checked")].map((x) => x.dataset.ttValue));
      setFilter(values.size ? { kind: "values", values } : null);
    }
  }, true);

  let typing = 0;
  document.addEventListener("input", (event) => {
    if (!pop || !pop.el.contains(event.target) || !event.target.matches("[data-tt-text], [data-tt-min], [data-tt-max]")) return;
    clearTimeout(typing);
    typing = setTimeout(() => {
      if (!pop) return;
      const text = pop.el.querySelector("[data-tt-text]");
      if (text) { setFilter(text.value.trim() ? { kind: "text", q: text.value.trim() } : null); return; }
      const read = (sel) => { const v = pop.el.querySelector(sel)?.value.trim(); return v === "" || v === undefined || Number.isNaN(Number(v)) ? null : Number(v); };
      const min = read("[data-tt-min]"), max = read("[data-tt-max]");
      setFilter(min === null && max === null ? null : { kind: "range", min, max });
    }, 200);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && pop) { event.stopImmediatePropagation(); event.preventDefault(); closePop(true); }
  }, true);
  window.addEventListener("hashchange", () => { closePop(); picked.clear(); ownPicked.clear(); paintBar(); });

  window.TT = { arrange, watch, emptyFoot, run, ownSource: (barId, fn) => ownSources.set(barId, fn) };

  Object.assign(window.FR = window.FR || {}, {
    "Filter": "Filtrer", "Column": "Colonne", "From": "De", "To": "À", "Contains": "Contient", "Empty": "Vide", "Sort": "Trier", "Ascending": "Croissant", "Descending": "Décroissant",
    "Clear this filter": "Retirer ce filtre", "Clear all": "Tout retirer", "Done": "Terminé", "{n} values": "{n} valeurs", "Remove the filter on {column}": "Retirer le filtre sur {column}",
    "No row matches these filters.": "Aucune ligne ne correspond à ces filtres.",
    "One note on this row": "Une note sur cette ligne", "One note per row, {n} rows": "Une note par ligne, {n} lignes",
    "Note saved.": "Note enregistrée.", "{n} notes saved.": "{n} notes enregistrées.",
  });
})();
