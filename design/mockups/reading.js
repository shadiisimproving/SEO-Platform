/* Reading helpers (2026-11-20, the owner: "too much data is hard, show it so a person can decide"). The same four pieces
   on every screen, so what matters looks the same everywhere:

   - RD.bar(value, max): a small bar beside a number, so a big row and a small one look different before any number is read.
   - RD.quiet(): the faint dash of a cell with nothing to say (no change, no data).
   - RD.why(parts): the grey line under a row's name that says why the row matters to me (my page, its clicks).
   - RD.sections(key, defs, cols, redraw): a long list split into a few named groups. A quiet group starts folded; its line
     says how many rows it holds. Nothing is removed. It sits on TP's pager, and when the reader sorts or filters the table
     (table-tools.js) the groups step aside and every row is one flat list again.

   Nothing here knows a screen: a screen hands in its rows and draws them itself. */
(() => {
  "use strict";
  const U = () => window.UI;
  const t = (key) => (U()?.t ? U().t(key) : key);
  const esc = (value) => U().esc(value);
  const num = (n) => U().num(n);

  /* The bar's length is the row's share of the biggest row on show. A value of 0 keeps an empty track: "nothing", seen. */
  function bar(value, max, { tone = "" } = {}) {
    const share = max > 0 && value > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
    return `<span class="rd-bar${tone ? ` rd-bar-${tone}` : ""}" aria-hidden="true"><i style="width:${share}%"></i></span>`;
  }

  const quiet = (label = "") => `<span class="rd-quiet"${label ? ` aria-label="${esc(t(label))}"` : ' aria-hidden="true"'}>–</span>`;

  /* Parts are ready-made bits of HTML; empty ones are left out. */
  const why = (parts) => {
    const shown = parts.filter(Boolean);
    return shown.length ? `<span class="rd-why">${shown.join('<span class="rd-dot" aria-hidden="true">·</span>')}</span>` : "";
  };

  /* A page of mine, opened in the app's own Pages screen (not the live site: the question is "how is it doing"). */
  const myPage = (url, label) => `<a class="rd-page" href="#pages?page=${encodeURIComponent(url)}" dir="auto">${esc(label)}</a>`;

  /* A signed change beside a number: +12 / −28, coloured, with words for a screen reader. */
  function delta(now, before) {
    if (now === null || now === undefined || before === null || before === undefined || now === before) return "";
    const d = now - before;
    return `<span class="rd-delta rd-${d > 0 ? "up" : "down"}">${d > 0 ? "+" : "−"}${num(Math.abs(d))}</span>`;
  }

  // ---- named groups over a paged table --------------------------------------------------------------
  const folds = new Map(); // table key -> Map(group id -> open?)
  const redraws = new Map();
  const foldsOf = (key) => { if (!folds.has(key)) folds.set(key, new Map()); return folds.get(key); };

  function sections(key, defs, cols, redraw) {
    if (redraw) redraws.set(key, redraw);
    const st = foldsOf(key), TP = window.TP;
    const live = defs.filter((d) => d.rows.length);
    const isOpen = (d) => (st.has(d.id) ? st.get(d.id) : !d.folded);
    const open = live.filter(isOpen), closed = live.filter((d) => !isOpen(d));
    const ordered = open.flatMap((d) => d.rows);
    let page = TP.view(key, ordered);
    const untouched = page.list.length === ordered.length && page.list.every((row, i) => row === ordered[i]);
    if (!untouched) {
      // Sorted or filtered by a column (table-tools.js): every row counts, folded or not, and the groups say nothing true any more.
      page = TP.view(key, live.flatMap((d) => d.rows));
      return { page, flat: true, before: () => "", after: "", total: page.total };
    }
    const groupOf = new Map();
    open.forEach((d) => d.rows.forEach((row) => groupOf.set(row, d)));
    const head = (d, on) => `<tr class="rd-group${on ? "" : " rd-group-shut"}"><th colspan="${cols}" scope="colgroup"><div class="rd-group-line"><button type="button" class="rd-fold" data-rd-fold="${esc(key)}" data-rd-id="${esc(d.id)}" aria-expanded="${on}">${U().icon(on ? "chevron-down" : "chevron-right")}<span class="rd-group-name">${esc(t(d.label))}</span><span class="rd-group-n tabular">${num(d.rows.length)}</span>${d.note ? `<span class="rd-group-note">${esc(d.note)}</span>` : ""}</button>${d.extra ? `<span class="rd-group-extra">${d.extra}</span>` : ""}</div></th></tr>`;
    const single = live.length === 1 && open.length === 1; // one group and it's open: its name adds nothing
    const before = (row, i) => (single ? "" : i === 0 || groupOf.get(row) !== groupOf.get(page.rows[i - 1]) ? head(groupOf.get(row), true) : "");
    // A folded group's line shows under every page of the open rows: page 1 must say what else there is.
    return { page, flat: false, before, after: closed.map((d) => head(d, false)).join(""), total: live.reduce((n, d) => n + d.rows.length, 0), closed: closed.length };
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest?.("[data-rd-fold]");
    if (!el) return;
    const key = el.dataset.rdFold, id = el.dataset.rdId;
    foldsOf(key).set(id, el.getAttribute("aria-expanded") !== "true");
    if (el.getAttribute("aria-expanded") === "true") window.TP?.reset?.(key);
    redraws.get(key)?.();
    document.querySelector(`[data-rd-fold="${CSS.escape(key)}"][data-rd-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  });

  window.RD = { bar, quiet, why, myPage, delta, sections };

  Object.assign(window.FR = window.FR || {}, {
    "clicks in 28 days": "clics en 28 jours", "No clicks in 28 days": "Aucun clic en 28 jours", "Competes with": "En concurrence avec",
  });
})();
