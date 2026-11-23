/* Keywords by ranking: one card with Top, Trending up and Trending down, similar keywords named under their first one
   (owner, 2026-11-20, from Search Console's "Queries leading to your site" card: "something like this, based on our ranking").

   Two rankings behind one switch, never mixed in a list: our own rank checks, and Search Console's average position.
   The same card sits on Today, Keywords and Overview:  RankTrends.card("today" | "keywords" | "overview")  returns its
   HTML at once (grey rows until the answer is in) and fills every copy on screen when GET /api/rank-trends answers.
   It draws itself: a choice never asks the screen around it to redraw.

   At rest the card is its answer and one control (owner, 2026-11-23: Today had 47 controls against about 33): the list
   and the ranking are chosen in its View menu, with Show more and the link to every keyword. Up and Down are the one
   rule of seo/serp/moves.py: 1 place or more, "New" (it entered) an Up, "Lost" (it ranked before, not now) a Down. */
(() => {
  "use strict";
  const UI = () => window.UI;
  const t = (word) => UI().t(word);
  const esc = (text) => UI().esc(text);
  const icon = (name, cls) => UI().icon(name, cls);
  const fill = (word, values) => t(word).replace(/\{(\w+)\}/g, (_, key) => values[key]);
  const place = (value) => new Intl.NumberFormat(UI().locale(), { maximumFractionDigits: 1 }).format(value);
  const day = (iso) => new Intl.DateTimeFormat(UI().locale(), { day: "numeric", month: "short" }).format(new Date(String(iso).length > 10 ? iso : `${iso}T00:00:00`));

  const TABS = [["top", "Top"], ["up", "Trending up"], ["down", "Trending down"]];
  const SOURCES = [["checks", "Our checks"], ["gsc", "Search Console"]];
  const FIRST = 5, FRESH_MS = 20000, KEEP = "seo-cc-rank-trends-source";
  const S = { tab: "top", source: null, more: false, cache: new Map() };
  try { const kept = localStorage.getItem(KEEP); if (kept === "checks" || kept === "gsc") S.source = kept; } catch { /* private window: the choice lasts for this visit */ }

  const siteKey = () => String(UI().siteIdPicked?.() || "all");
  const allSites = () => UI().state?.site === "all";

  const pathOf = (key) => `rank-trends${key === "all" ? "" : `?site_id=${key}`}`;
  const shared = () => Boolean(window.SCREEN_DATA?.on?.());
  function load(key) {
    const entry = S.cache.get(key) || {};
    if (entry.loading) return;
    // The simpler screens: the warm-up may hold this answer already (screen-data.js), so the card draws at once.
    // Its age isn't known here: the next look, FRESH_MS later, goes through SCREEN_DATA.get, which asks again only if it's old.
    const held = shared() && !entry.data ? window.SCREEN_DATA.peek(pathOf(key)) : null;
    if (held) { S.cache.set(key, { data: held, loading: false, at: Date.now() }); return; }
    S.cache.set(key, { ...entry, loading: true });
    const done = (next) => { S.cache.set(key, { ...next, loading: false, at: Date.now() }); paint(); };
    (shared() ? window.SCREEN_DATA.get(pathOf(key)) : window.COMP.api("GET", pathOf(key)))
      .then((data) => done({ data }))
      .catch((error) => done({ data: entry.data, error: entry.data ? null : error })); // an older answer stays on screen
  }

  /* The ranking shown: the one picked, or the first that has something to say. */
  function sourceOf(data) {
    if (S.source) return S.source;
    return data.checks.state !== "ok" && data.gsc.state === "ok" ? "gsc" : "checks";
  }

  // ---- a row ------------------------------------------------------------------------------------------
  const pos = (value) => `<span class="rt-pos"><span class="sr-only">${t("Position")} </span>#${esc(place(value))}</span>`;
  function move(row) {
    // Lost / New: the word says why it counts as Down or Up.
    if (row.move === "lost" || row.move === "new") {
      const lost = row.move === "lost";
      const words = lost ? fill("Lost: was #{was}, not found now", { was: place(row.was) }) : t("New: not found before");
      return `<span class="rt-move"><span class="chg ${lost ? "crit" : "good"} rt-word" title="${esc(words)}">${icon(lost ? "arrow-down" : "arrow-up")}<span aria-hidden="true">${esc(t(lost ? "Lost|move" : "New|move").split("|")[0])}</span><span class="sr-only">${esc(words)}</span></span></span>`;
    }
    if (!row.places) return `<span class="rt-move rt-same" title="${esc(t(row.was === null ? "Nothing earlier to compare with" : "Same place as before"))}"><span aria-hidden="true">–</span><span class="sr-only">${t(row.was === null ? "Nothing earlier to compare with" : "Same place as before")}</span></span>`;
    const up = row.places > 0, size = place(Math.abs(row.places));
    const one = Math.abs(row.places) === 1;
    const words = fill(up ? (one ? "Up 1 place, from #{was}" : "Up {n} places, from #{was}") : one ? "Down 1 place, from #{was}" : "Down {n} places, from #{was}", { n: size, was: place(row.was) });
    return `<span class="rt-move"><span class="chg ${up ? "good" : "crit"}" title="${esc(words)}">${icon(up ? "arrow-up" : "arrow-down")}<span aria-hidden="true">${esc(size)}</span><span class="sr-only">${esc(words)}</span></span></span>`;
  }
  function similar(row) {
    if (!row.similar.length) return "";
    const rest = row.similar_count - row.similar.length;
    const names = row.similar.map((s) => `<span class="rt-sim">${window.KeywordLink.html(s.keyword, { id: s.keyword_id, host: row.host })}&nbsp;<span class="rt-sim-pos">${s.now === null || s.now === undefined ? esc(t("Lost|move").split("|")[0]) : `#${esc(place(s.now))}`}</span></span>`).join("");
    return `<div class="d rt-similar"><span class="sr-only">${t("Similar keywords")}: </span>${names}${rest > 0 ? `<span class="rt-sim">+${esc(place(rest))}</span>` : ""}</div>`;
  }
  const hostTag = (host) => (host && allSites() ? ` <span class="small muted today-host" dir="auto">${esc(host)}</span>` : "");
  const rowHtml = (row) => `<li><div class="what"><div class="t">${window.KeywordLink.html(row.keyword, { id: row.keyword_id, host: row.host })}${hostTag(row.host)}</div>${similar(row)}</div>${move(row)}${row.now === null || row.now === undefined ? `<span class="rt-pos rt-gone" aria-hidden="true">—</span>` : pos(row.now)}</li>`;

  // ---- what to say when a list is empty ------------------------------------------------------------------
  function empty(source, found, screen) {
    const goKeywords = screen === "keywords" ? "" : `<button class="btn" data-go="keywords">${t("Open Keywords")}</button>`;
    const say = (title, words, button = "") => `<div class="empty rt-empty"><h3>${t(title)}</h3>${words ? `<p>${t(words)}</p>` : ""}${button}</div>`;
    if (source === "checks") {
      if (found.state === "no_keywords") return say("No keywords followed yet", "Add the keywords to follow, and their ranking shows here.", goKeywords);
      if (found.state === "not_checked") return say("No rank check yet", "Refresh in Keywords runs the first one.", goKeywords);
      if (found.state === "not_ranked") return say("Not found in the results checked", "Your site wasn't in the results for any keyword followed.");
      if (S.tab === "up") return say("No keyword went up", "By a place or more, or newly found, since the check before by the same tool.");
      if (S.tab === "down") return say("No keyword went down", "By a place or more, or lost, since the check before by the same tool.");
    } else {
      if (found.state === "not_connected") return say("Search Console isn't connected", "", UI().canSettings?.() === false ? "" : `<button class="btn" data-go="settings">${t("Open Settings")}</button>`);
      if (found.state === "no_rows") return say("Too few searches in the last 7 days", "A query counts from 10 impressions in the week.");
      if (S.tab === "up") return say("No query went up", "By a place or more, or newly shown: the last 7 days against the first 7 of the last 28.");
      if (S.tab === "down") return say("No query went down", "By a place or more, or lost: the last 7 days against the first 7 of the last 28.");
    }
    return say("Nothing to show", "");
  }

  /* Where the numbers come from, said once under the list. */
  function note(source, found) {
    if (found.state !== "ok") return "";
    if (source === "gsc") return `${t("Search Console average position, all countries")} · ${fill("{a} – {b} against {c} – {d}", { a: day(found.from), b: day(found.through), c: day(found.before_from || found.from), d: day(found.before_through || found.through) })}`;
    const bits = [`Google · ${found.tools.map(esc).join(", ")}`];
    if (found.last_check) bits.push(`${t("latest check")} ${day(found.last_check)}`);
    bits.push(t("moves: against the check before, same tool"));
    return bits.join(" · ");
  }

  // ---- the card ---------------------------------------------------------------------------------------
  /* What the View menu offers besides the choices: Show more, and the way to every keyword. */
  function links(data, screen) {
    const source = sourceOf(data), found = data[source], rows = found[S.tab] || [];
    const all = source === "checks" ? "keywords" : "overview";
    return {
      more: rows.length > FIRST ? (S.more ? t("Show fewer") : fill("Show {n} more", { n: place(rows.length - FIRST) })) : "",
      elsewhere: all === screen || found.state !== "ok" ? null : { go: all, words: t(source === "checks" ? "All keywords" : "All queries") },
    };
  }

  function body(data, screen) {
    const source = sourceOf(data), found = data[source];
    const rows = found[S.tab] || [], shown = S.more ? rows : rows.slice(0, FIRST);
    const list = found.state === "ok" && rows.length
      ? `<ul class="rows rt-rows" aria-label="${esc(t(TABS.find(([id]) => id === S.tab)[1]))}">${shown.map(rowHtml).join("")}</ul>`
      : empty(source, found, screen);
    const said = note(source, found);
    const foot = said ? `<div class="rt-foot"><span class="small muted rt-note" dir="auto">${said}</span></div>` : "";
    return `${list}${foot}`;
  }

  /* The answer in the head, as text: how many went up and down, on the ranking chosen. */
  function counts(found) {
    if (!found || found.state !== "ok") return "";
    const c = found.counts;
    const bit = (cls, mark, n, words) => `<span class="rt-count ${cls}" title="${esc(words)}">${mark}<span aria-hidden="true">${esc(place(n))}</span><span class="sr-only">${esc(words)}</span></span>`;
    return `<span class="rt-counts">${bit("rt-c-up", icon("arrow-up"), c.up, fill("{n} up", { n: place(c.up) }))}${bit("rt-c-down", icon("arrow-down"), c.down, fill("{n} down", { n: place(c.down) }))}</span>`;
  }

  function menuHtml(data, screen) {
    const source = sourceOf(data), found = data[source];
    const option = (attr, id, name, on, n) => `<button type="button" ${attr}="${id}" aria-pressed="${on}" ${on ? "data-autofocus" : ""}><span>${esc(t(name))}</span>${n === undefined ? "" : `<span class="rt-pop-n">${esc(place(n))}</span>`}<span class="tick" aria-hidden="true">${on ? icon("check") : ""}</span></button>`;
    const lists = found.state === "ok" ? `<p class="rt-pop-h" aria-hidden="true">${esc(t("Show"))}</p>${TABS.map(([id, name]) => option("data-rt-tab", id, name, S.tab === id, found.counts[id])).join("")}<hr>` : "";
    const ranking = `<p class="rt-pop-h" aria-hidden="true">${esc(t("Ranking"))}</p>${SOURCES.map(([id, name]) => option("data-rt-source", id, name, source === id)).join("")}`;
    const { more, elsewhere } = found.state === "ok" ? links(data, screen) : { more: "", elsewhere: null };
    const extra = more || elsewhere ? `<hr>${more ? `<button type="button" data-rt-more aria-expanded="${S.more}">${esc(more)}</button>` : ""}${elsewhere ? `<button type="button" class="rt-all" data-go="${elsewhere.go}"><span>${esc(elsewhere.words)}</span><span class="tick" aria-hidden="true">${icon("chevron-right")}</span></button>` : ""}` : "";
    return `${lists}${ranking}${extra}`;
  }

  function card(screen) {
    if (S.server === false) return ""; // opened as a plain file: the sample has no rankings of this kind
    const key = siteKey(), entry = S.cache.get(key);
    if (!entry || (!entry.loading && Date.now() - (entry.at || 0) > FRESH_MS)) load(key);
    const now = S.cache.get(key) || {};
    if (now.error?.status === 403 || now.error?.message === "Not in the sample data.") return ""; // chosen access without Keywords or Overview, or the plain-file sample: no card
    const data = now.data;
    const picked = data ? sourceOf(data) : S.source || "checks";
    // One control at rest: View, naming what is shown. Its menu holds the list, the ranking, Show more and All keywords.
    const face = `${t(TABS.find(([id]) => id === S.tab)[1])} · ${t(SOURCES.find(([id]) => id === picked)[1])}`;
    const view = `<button type="button" class="btn btn-small rt-view" data-rt-view data-pop-toggle aria-haspopup="true" aria-expanded="false" aria-label="${esc(`${t("View")}: ${face}`)}" ${data ? "" : "disabled"}><span class="rt-view-face">${esc(face)}</span>${icon("chevron-down")}</button>`;
    const sw = `<span class="rt-head-end">${data ? counts(data[picked]) : ""}${view}</span>`;
    const inside = data ? body(data, screen)
      : now.error ? `<div class="empty rt-empty"><h3>${t("Couldn't load the rankings")}</h3><button class="btn" data-rt-retry>${t("Try again")}</button></div>`
      : `<ul class="rows rt-rows rt-wait" aria-busy="true" aria-label="${t("Loading…")}">${"<li><span></span><span></span></li>".repeat(FIRST)}</ul>`;
    return `<section class="card rt-card" data-rank-trends="${esc(screen)}" data-rt-list="${S.tab}" data-rt-ranking="${picked}"><div class="card-head"><h2>${t("Keywords by ranking")}</h2>${sw}</div>${inside}</section>`;
  }

  /* Every copy on screen is drawn again; after a choice in the menu the keyboard goes back to its View button. */
  function paint(focusView = null) {
    document.querySelectorAll("[data-rank-trends]").forEach((el) => {
      const held = focusView === el.dataset.rankTrends || Boolean(el.contains(document.activeElement) && document.activeElement.hasAttribute("data-rt-view"));
      const html = card(el.dataset.rankTrends);
      if (!html) { el.remove(); return; }
      el.insertAdjacentHTML("afterend", html);
      const fresh = el.nextElementSibling;
      el.remove();
      if (held) fresh.querySelector("[data-rt-view]")?.focus();
    });
  }

  document.addEventListener("click", (e) => {
    const el = e.target instanceof Element ? e.target.closest("[data-rt-view], [data-rt-tab], [data-rt-source], [data-rt-more], [data-rt-retry]") : null;
    if (!el) return;
    if (el.hasAttribute("data-rt-view")) {
      const screen = el.closest("[data-rank-trends]")?.dataset.rankTrends, data = S.cache.get(siteKey())?.data;
      if (!data) return;
      if (el.getAttribute("aria-expanded") === "true") { UI().closePopover?.({ focus: true }); return; }
      const pop = UI().popover?.(el, menuHtml(data, screen), "rt-pop");
      if (pop) { pop.dataset.rtFor = screen; pop.setAttribute("role", "group"); pop.setAttribute("aria-label", `${t("View")}: ${t("Keywords by ranking")}`); }
      return;
    }
    const screen = el.closest("#popover")?.dataset.rtFor || null;
    if (el.dataset.rtTab) { S.tab = el.dataset.rtTab; S.more = false; }
    else if (el.dataset.rtSource) {
      S.source = el.dataset.rtSource; S.more = false;
      try { localStorage.setItem(KEEP, S.source); } catch { /* kept for this visit only */ }
    } else if (el.hasAttribute("data-rt-more")) S.more = !S.more;
    else { S.cache.delete(siteKey()); }
    if (screen) UI().closePopover?.();
    paint(screen);
  });

  /* A rank check or a data pull just finished: the next draw asks again. */
  const stale = () => { S.cache.forEach((entry) => { entry.at = 0; }); if (shared()) window.SCREEN_DATA.forget("rank-trends"); };

  window.COMP?.isServer?.().then((yes) => { S.server = yes; if (!yes) paint(); });

  window.RankTrends = { card, stale };
  // Its answer joins the first-view lists of the screens it's drawn on, for the warm-up and the menu hover.
  ["today", "overview", "keywords"].forEach((route) => window.SCREEN_DATA?.also?.(route, () => (UI()?.state ? [pathOf(siteKey())] : [])));

  const fr = {
    "Keywords by ranking": "Mots-clés par position", "Top": "Meilleurs", "Trending up": "En hausse", "Trending down": "En baisse",
    "Our checks": "Nos vérifications", "Which ranking": "Quel classement", "Which keywords": "Quels mots-clés", "Position": "Position",
    "Similar keywords": "Mots-clés proches", "Same place as before": "Même place qu'avant", "Nothing earlier to compare with": "Rien d'antérieur à comparer",
    "Up 1 place, from #{was}": "+1 place, depuis #{was}", "Down 1 place, from #{was}": "−1 place, depuis #{was}", "Up {n} places, from #{was}": "+{n} places, depuis #{was}", "Down {n} places, from #{was}": "−{n} places, depuis #{was}",
    "All keywords": "Tous les mots-clés", "All queries": "Toutes les requêtes", "Show {n} more": "Afficher {n} de plus", "Show fewer": "Afficher moins",
    "Open Keywords": "Ouvrir Mots-clés", "No keywords followed yet": "Aucun mot-clé suivi", "Add the keywords to follow, and their ranking shows here.": "Ajoutez les mots-clés à suivre : leur position s'affiche ici.",
    "No rank check yet": "Aucune vérification de position", "Refresh in Keywords runs the first one.": "Actualiser, dans Mots-clés, lance la première.",
    "Not found in the results checked": "Absent des résultats vérifiés", "Your site wasn't in the results for any keyword followed.": "Votre site n'était dans les résultats d'aucun mot-clé suivi.",
    "No keyword went up": "Aucun mot-clé en hausse", "No keyword went down": "Aucun mot-clé en baisse", "Since the check before, by the same tool.": "Depuis la vérification précédente, par le même outil.",
    "Search Console isn't connected": "Search Console n'est pas connecté", "Too few searches in the last 7 days": "Trop peu de recherches ces 7 derniers jours",
    "A query counts from 10 impressions in the week.": "Une requête compte à partir de 10 impressions dans la semaine.",
    "No query went up": "Aucune requête en hausse", "No query went down": "Aucune requête en baisse", "By a place or more, against the week before.": "D'une place ou plus, par rapport à la semaine précédente.",
    "Nothing to show": "Rien à afficher", "Search Console average position, all countries": "Position moyenne Search Console, tous pays",
    "{a} – {b} against the 7 days before": "{a} – {b} par rapport aux 7 jours précédents", "latest check": "dernière vérification",
    "moves: against the check before, same tool": "mouvements : par rapport à la vérification précédente, même outil",
    "Couldn't load the rankings": "Impossible de charger les positions", "Try again": "Réessayer",
    "View": "Affichage", "Show": "Afficher", "Ranking": "Classement", "{n} up": "{n} en hausse", "{n} down": "{n} en baisse",
    "Lost|move": "Perdu", "New|move": "Nouveau", "Lost: was #{was}, not found now": "Perdu : était #{was}, introuvable maintenant", "New: not found before": "Nouveau : introuvable avant",
    "By a place or more, or newly found, since the check before by the same tool.": "D'une place ou plus, ou nouvellement trouvé, depuis la vérification précédente par le même outil.",
    "By a place or more, or lost, since the check before by the same tool.": "D'une place ou plus, ou perdu, depuis la vérification précédente par le même outil.",
    "By a place or more, or newly shown: the last 7 days against the first 7 of the last 28.": "D'une place ou plus, ou nouvellement affichée : les 7 derniers jours par rapport aux 7 premiers des 28 derniers.",
    "By a place or more, or lost: the last 7 days against the first 7 of the last 28.": "D'une place ou plus, ou perdue : les 7 derniers jours par rapport aux 7 premiers des 28 derniers.",
    "{a} – {b} against {c} – {d}": "{a} – {b} par rapport au {c} – {d}",
  };
  Object.keys(fr).forEach((word) => { if (window.FR && window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
