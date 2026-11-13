/* A keyword on screen is a link to everything known about it (2026-11-12: "anywhere I click on the keyword I see all the
   keyword details"). Never print a keyword as plain text: use KeywordLink.html.

   KeywordLink.html(keyword, { id, host, cls, text })
     id    the tracked keyword's keyword_id, when the data has it (the surest match)
     host  the site it belongs to; without it, the site picked in the menu
     text  what to show, when it isn't the keyword itself (escaped here)
   KeywordLink.open({ id, keyword, host })   the same, from code.

   A click opens Keywords on that site with the keyword's panel (KW.open, keywords-real.js). A search nobody tracks opens
   in Overview → Queries, filtered to that exact search (OV.openQuery). Cmd/Ctrl/middle click opens the Keywords list,
   searched for it, in a new tab. Many rows open their own panel when clicked: a click on the keyword opens the keyword
   only, never the row's panel too. */
(() => {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const bareHost = (host) => String(host || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^www\./i, "");

  function href(keyword, host) {
    const q = new URLSearchParams();
    const site = bareHost(host || window.UI?.siteHostPicked?.());
    if (site) q.set("site", site);
    q.set("q", String(keyword || "").trim());
    return `#keywords?${q.toString()}`;
  }

  function html(keyword, { id = null, host = null, cls = "", text = null } = {}) {
    const word = String(keyword ?? "").trim();
    const label = text ?? keyword ?? "";
    // Chosen access without Keywords: the word is plain text (a keyword's details open in Keywords).
    if (!word || (window.ACCESS && !window.ACCESS.can("keywords"))) return `<span class="${esc(cls)}" dir="auto">${esc(label)}</span>`;
    const tip = window.UI?.t ? window.UI.t("See this keyword") : "See this keyword";
    return `<a class="kw-link ${esc(cls)}" href="${esc(href(word, host))}" data-kw-link="${esc(word)}"${id ? ` data-kw-id="${esc(id)}"` : ""}${host ? ` data-kw-host="${esc(bareHost(host))}"` : ""} dir="auto" title="${esc(tip)}">${esc(label)}</a>`;
  }

  function open({ id = null, keyword = "", host = null } = {}) {
    const word = String(keyword || "").trim();
    if (!word && !id) return;
    host = bareHost(host) || window.UI?.siteHostPicked?.() || null;
    const KW = window.KW;
    if (!KW?.open) { window.OV?.openQuery ? window.OV.openQuery({ host, query: word }) : window.UI?.go?.("keywords"); return; }
    if (!id) {
      const known = KW.trackedId ? KW.trackedId(word, host) : undefined; // a number, null when surely untracked, undefined when not known yet
      if (known === null && window.OV?.openQuery) { window.OV.openQuery({ host, query: word }); return; }
      if (known) id = known;
    }
    KW.open({ keywordId: id ? Number(id) : null, keyword: word, host });
  }

  // Capture runs before any row's own handler, so the row stays shut.
  document.addEventListener("click", (e) => {
    const a = e.target instanceof Element ? e.target.closest("a.kw-link") : null;
    if (!a) return;
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // a new tab: the browser follows the href
    e.preventDefault();
    window.UI?.closePopover?.();
    open({ id: a.dataset.kwId || null, keyword: a.dataset.kwLink, host: a.dataset.kwHost || null });
  }, true);
  document.addEventListener("auxclick", (e) => { if (e.target instanceof Element && e.target.closest("a.kw-link")) e.stopPropagation(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target instanceof Element && e.target.closest("a.kw-link")) e.stopPropagation(); }, true);

  window.KeywordLink = { html, open, href };
})();
window.FR = window.FR || {};
Object.assign(window.FR, {
  "See this keyword": "Voir ce mot-clé",
});
