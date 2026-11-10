/* Pages and a search box for any long table, the same everywhere (2026-11-10). The owner asked for every table to work like
   Search → Overview's query table: 25 / 50 / 100 rows a page, Previous and Next with page numbers in the footer, the real total,
   and a search that filters as you type. A screen keeps its own filters; this only adds the paging and the search.

   Use:
     const view = TP.view("cg", rows);            // the rows on this page: { rows, from, at, pages, total }
     html += TP.search("cg", t("Search domains")) // a box that filters as you type; TP.matches("cg", text) tests a row
     html += TP.footer("cg", view)                 // "1–25 of 758", the pages, and how many rows a page holds
     TP.on("cg", () => repaint())                  // how to draw again when the page, the size or the search changes
     TP.reset("cg")                                // back to page 1, for when a screen's own filter changes

   Each table's rows-per-page choice is remembered in this browser. Focus stays on the box or button that was used. */
(() => {
  "use strict";
  const PER = [25, 50, 100];
  const states = new Map();
  const painters = new Map();
  const U = () => window.UI;
  const t = (key) => (U()?.t ? U().t(key) : key);
  const esc = (value) => U().esc(value);
  const num = (n) => U().num(n);

  const remembered = (key) => {
    try { const n = Number(localStorage.getItem(`tp-per:${key}`)); return PER.includes(n) ? n : PER[0]; } catch { return PER[0]; }
  };
  const remember = (key, per) => { try { localStorage.setItem(`tp-per:${key}`, String(per)); } catch { /* private window: the choice lasts this visit */ } };

  function state(key) {
    if (!states.has(key)) states.set(key, { page: 0, per: remembered(key), q: "" });
    return states.get(key);
  }

  /* Letters as people read them: case and accents don't matter. */
  const fold = (value) => String(value ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

  function view(key, list) {
    const s = state(key), total = list.length, pages = Math.max(1, Math.ceil(total / s.per));
    s.page = Math.max(0, Math.min(s.page, pages - 1));
    const from = s.page * s.per;
    return { rows: list.slice(from, from + s.per), from, at: s.page, pages, total };
  }

  /* The first, the last, and the ones around where you are, with a gap mark between far ones. */
  const pageNumbers = (pages, at) => {
    if (pages <= 7) return [...Array(pages).keys()];
    const keep = [...new Set([0, 1, at - 1, at, at + 1, pages - 2, pages - 1])].filter((p) => p >= 0 && p < pages).sort((a, b) => a - b);
    return keep.flatMap((p, i) => (i && p - keep[i - 1] > 1 ? [null, p] : [p]));
  };

  function footer(key, v, { noun = "", capped = null } = {}) {
    if (!v.total) return "";
    const { icon } = U(), s = state(key), last = v.pages - 1, k = esc(key);
    const pager = v.pages > 1 ? `<nav class="tp-pager" aria-label="${t("Pages")}">
        <button type="button" class="btn btn-small" data-tp-key="${k}" data-tp-page="${v.at - 1}" data-tp-step="prev" ${v.at === 0 ? "disabled" : ""}>${icon("chevron-left")}${t("Previous")}</button>
        <span class="tp-list">${pageNumbers(v.pages, v.at).map((p) => (p === null ? `<span class="tp-gap" aria-hidden="true">…</span>` : `<button type="button" class="tp-num" data-tp-key="${k}" data-tp-page="${p}" aria-label="${t("Page")} ${num(p + 1)}" ${p === v.at ? `aria-current="page"` : ""}>${num(p + 1)}</button>`)).join("")}</span>
        <span class="tp-of">${t("Page")} ${num(v.at + 1)} ${t("of")} ${num(v.pages)}</span>
        <button type="button" class="btn btn-small" data-tp-key="${k}" data-tp-page="${v.at + 1}" data-tp-step="next" ${v.at === last ? "disabled" : ""}>${t("Next")}${icon("chevron-right")}</button></nav>` : "";
    const per = v.total > PER[0] ? `<label class="tp-per"><span class="sr">${t("Rows per page")}</span><select class="select" data-tp-key="${k}" data-tp-per>${PER.map((n) => `<option value="${n}" ${s.per === n ? "selected" : ""}>${num(n)} ${t("per page")}</option>`).join("")}</select></label>` : "";
    const cut = capped ? `<span class="tp-capped">${esc(capped)}</span>` : "";
    return `<div class="tp-foot" data-tp-foot="${k}"><span class="tp-range">${num(v.from + 1)}–${num(v.from + v.rows.length)} ${t("of")} ${num(v.total)}${noun ? ` ${esc(noun)}` : ""}</span>${pager}${per}${cut}</div>`;
  }

  function search(key, placeholder) {
    const { icon } = U(), s = state(key), k = esc(key);
    return `<label class="tp-search">${icon("search")}<span class="sr">${esc(placeholder)}</span><input type="search" class="input" data-tp-key="${k}" data-tp-search placeholder="${esc(placeholder)}" value="${esc(s.q)}" autocomplete="off" spellcheck="false">${s.q ? `<button type="button" class="icon-btn tp-clear" data-tp-key="${k}" data-tp-clear aria-label="${t("Clear the search")}" data-tip="${t("Clear the search")}">${icon("x")}</button>` : ""}</label>`;
  }

  /* Whether a row's words hold the search, wherever they are in it. An empty search matches everything. */
  const matches = (key, ...texts) => {
    const q = fold(state(key).q).trim();
    return !q || q.split(/\s+/).every((word) => texts.some((text) => fold(text).includes(word)));
  };

  const reset = (key) => { state(key).page = 0; };
  const on = (key, paint) => { painters.set(key, paint); };

  function paint(key, focus) {
    const draw = painters.get(key);
    if (!draw) return;
    draw();
    if (focus) requestAnimationFrame(() => focus());
  }

  /* Another page brings the table's top back into view, and keeps focus where the person is: on the button pressed with a
     mouse, so Next can be pressed again, or on the same box while typing. */
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-tp-page], [data-tp-clear]");
    if (!button || button.disabled) return;
    const key = button.dataset.tpKey, s = state(key);
    event.preventDefault();
    if (button.hasAttribute("data-tp-clear")) {
      s.q = ""; s.page = 0;
      paint(key, () => document.querySelector(`[data-tp-search][data-tp-key="${CSS.escape(key)}"]`)?.focus());
      return;
    }
    const step = button.dataset.tpStep;
    s.page = Number(button.dataset.tpPage);
    paint(key, () => {
      const foot = document.querySelector(`[data-tp-foot="${CSS.escape(key)}"]`);
      // The list just above this footer: a card can hold more than one table, and a list isn't always a table.
      const table = foot?.previousElementSibling || foot?.parentElement?.querySelector("table");
      table?.scrollIntoView?.({ block: "start", behavior: "instant" });
      const again = step ? foot?.querySelector(`[data-tp-step="${step}"]:not([disabled])`) : foot?.querySelector(`[aria-current="page"]`);
      (again || foot?.querySelector(`[aria-current="page"]`))?.focus({ preventScroll: true });
    });
  }, true);

  document.addEventListener("change", (event) => {
    const select = event.target.closest?.("[data-tp-per]");
    if (!select) return;
    const key = select.dataset.tpKey, s = state(key);
    s.per = Number(select.value) || PER[0]; s.page = 0; remember(key, s.per);
    paint(key, () => document.querySelector(`[data-tp-per][data-tp-key="${CSS.escape(key)}"]`)?.focus());
  }, true);

  const typing = new Map();
  document.addEventListener("input", (event) => {
    const box = event.target.closest?.("[data-tp-search]");
    if (!box) return;
    const key = box.dataset.tpKey;
    clearTimeout(typing.get(key));
    typing.set(key, setTimeout(() => {
      const s = state(key), at = box.selectionStart;
      s.q = box.value; s.page = 0;
      paint(key, () => {
        const again = document.querySelector(`[data-tp-search][data-tp-key="${CSS.escape(key)}"]`);
        if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch { /* not a text box any more */ } }
      });
    }, 180));
  }, true);

  window.TP = { PER, view, footer, search, matches, reset, on, state, fold };

  Object.assign(window.FR = window.FR || {}, {
    "Pages": "Pages", "Previous": "Précédent", "Next": "Suivant", "Page": "Page", "of": "sur", "Rows per page": "Lignes par page", "per page": "par page",
    "Clear the search": "Effacer la recherche",
  });
})();
