/* Competitors area: the one line that says what's missing, above every tab (2026-11-09).

   With no keywords, nine screens were empty, each with its own instruction. Now one sentence says the real blocker
   and the one or two places that fix it: no competitors, no keyword list, a list never checked. Nothing else.
   It reads the same collective/rivals answer the Competitors tab uses, once per site, so it costs nothing extra. */
(() => {
  "use strict";
  const COMP = window.COMP;
  const UI = () => window.UI;
  const t = (s) => UI().t(s);
  const esc = (v) => UI().esc(v);
  const fill = (key, values = {}) => t(key).replace(/\{(\w+)\}/g, (all, name) => (name in values ? values[name] : all));
  const S = { site: null, data: null, list: null, at: 0, loading: null };
  const FRESH_MS = 20000;

  /* What's missing for this site, or null when nothing is. Each state names one fix, and a second way when there is one. */
  function state() {
    const d = S.data;
    if (!d || COMP.siteId === COMP.ALL) return null;
    const host = COMP.site()?.host || "";
    const c = d.coverage || {};
    // Counted as the Competitors table counts them (comp-summary.js allRivals): the summary's rows, which are only those with tracking On,
    // plus the ones the list answer adds, on Pages only or Off. So this line can't say "no competitors" over a table that lists some.
    const rivals = new Set([...(d.rivals || []), ...(S.list || [])].map((r) => r.id)).size;
    if (!rivals && !c.keywords) return { key: "nothing", words: fill("No competitors and no keyword list for {host} yet.", { host }), main: ["find", "Find competitors"], other: ["keywords", "Add keywords"] };
    if (!rivals) return { key: "no-rivals", words: fill("No competitors yet for {host}.", { host }), main: ["find", "Find competitors"], other: ["add", "Add one by hand"] };
    if (!c.keywords) return { key: "no-keywords", words: fill("No keyword list for {host}, so there's nothing to compare positions on.", { host }), main: ["keywords", "Add keywords"], other: ["check", "Keyword check"] };
    if (!c.checked) return { key: "unchecked", words: fill("{n} keywords saved, never checked, so positions show — for now.", { n: UI().num(c.keywords) }), main: ["keywords", "Open Keywords"], other: ["check", "Keyword check"] };
    return null;
  }

  function button([what, label], main) {
    const host = COMP.site()?.host || "";
    const cls = `btn btn-small${main ? " btn-main" : ""}`;
    if (what === "keywords") return `<button type="button" class="${cls}" data-setup="keywords" data-setup-host="${esc(host)}">${UI().icon("key-round")}${t(label)}</button>`;
    if (what === "find") return `<button type="button" class="${cls}" data-cl-go-find>${UI().icon("target")}${t(label)}</button>`;
    if (what === "add") return `<button type="button" class="${cls}" data-cs-setup-add>${UI().icon("plus")}${t(label)}</button>`;
    if (what === "check") return `<button type="button" class="${cls}" data-cs-setup-tab="check">${UI().icon("list-ordered")}${t(label)}</button>`;
    return "";
  }

  function html() {
    const s = state();
    if (!s) return "";
    const tab = COMP.tabs.find((x) => x.id === "check");
    // On the Competitors tab the empty card under this line already has the Add button, so it isn't said twice.
    const addInCard = s.other[0] === "add" && COMP.currentTab()?.id === "summary";
    const other = (s.other[0] === "check" && !tab) || addInCard ? "" : button(s.other, false);
    return `<section class="comp-setup" role="status" data-setup-state="${s.key}"><span class="comp-setup-words">${UI().icon("info")}<span>${esc(s.words)}</span></span><span class="comp-setup-acts">${button(s.main, true)}${other}</span></section>`;
  }

  function paint() {
    const box = UI().$("#comp-setup");
    if (box) UI().setHTML(box, html());
    window.dispatchEvent(new Event("comp:setup-painted")); // a profile drawn before this answer shows — for its keyword figures once it's known there's no list
  }

  /* Why this site's keyword numbers aren't known: "no-keywords", "unchecked", or "" when they are (or it isn't known yet). */
  function keywordsUnknown() {
    const d = S.data;
    if (!d || S.site !== COMP.siteId || COMP.siteId === COMP.ALL) return "";
    const c = d.coverage || {};
    return !c.keywords ? "no-keywords" : !c.checked ? "unchecked" : "";
  }

  /* Fetches once per site, then again after 20 s or when something changed (comp:setup-changed). */
  async function refresh({ force = false } = {}) {
    const site = COMP.siteId;
    if (!COMP.ready || !COMP.sites.length || site === COMP.ALL || site === null) { S.data = null; S.site = site; paint(); return; }
    if (!force && S.site === site && S.data && Date.now() - S.at < FRESH_MS) { paint(); return; }
    if (S.loading && S.site === site && !force) return;
    S.site = site;
    const both = Promise.all([COMP.api("GET", `collective/rivals?site_id=${site}`), COMP.api("GET", `competitors?site_id=${site}`).then((a) => a.competitors || []).catch(() => [])]);
    S.loading = both.then(([d, list]) => { if (S.site === site) { S.data = d; S.list = list; S.at = Date.now(); paint(); } }).catch(() => { if (S.site === site) { S.data = null; paint(); } }).finally(() => { S.loading = null; });
    await S.loading;
  }

  COMP.setup = { html, refresh, paint, keywordsUnknown };

  document.addEventListener("click", (e) => {
    const hit = (sel) => e.target.closest?.(sel);
    let el;
    if ((el = hit("[data-cs-setup-tab]"))) { COMP.open(el.dataset.csSetupTab); return; }
    if (hit("[data-cs-setup-add]")) { document.querySelector("#cl-add-open")?.click() || COMP.open("summary"); }
  });
  // A competitor added or removed, or keywords saved, changes the line.
  window.addEventListener("seocc:site-added", () => refresh({ force: true }));
  window.addEventListener("comp:setup-changed", () => refresh({ force: true }));

  Object.assign(window.FR, {
    "No competitors and no keyword list for {host} yet.": "Pas encore de concurrents ni de liste de mots-clés pour {host}.",
    "No competitors yet for {host}.": "Pas encore de concurrents pour {host}.",
    "No keyword list for {host}, so there's nothing to compare positions on.": "Aucune liste de mots-clés pour {host} : il n'y a pas de positions à comparer.",
    "{n} keywords saved, never checked, so positions show — for now.": "{n} mots-clés enregistrés, jamais vérifiés : les positions affichent — pour l'instant.",
    "Add keywords": "Ajouter des mots-clés",
    "Open Keywords": "Ouvrir Mots-clés",
    "Keyword check": "Vérifier des mots-clés",
    "Add one by hand": "En ajouter un à la main",
  });
})();
