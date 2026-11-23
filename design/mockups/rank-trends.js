/* Keywords by ranking: one card with Top, Trending up and Trending down, similar keywords named under their first one
   (owner, 2026-11-20, from Search Console's "Queries leading to your site" card: "something like this, based on our ranking").

   Two rankings behind one switch, never mixed in a list: our own rank checks, and Search Console's average position.
   The same card sits on Today, Keywords and Overview:  RankTrends.card("today" | "keywords" | "overview")  returns its
   HTML at once (grey rows until the answer is in) and fills every copy on screen when GET /api/rank-trends answers.
   It draws itself: a tab or the switch never asks the screen around it to redraw. */
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

  function load(key) {
    const entry = S.cache.get(key) || {};
    if (entry.loading) return;
    S.cache.set(key, { ...entry, loading: true });
    const done = (next) => { S.cache.set(key, { ...next, loading: false, at: Date.now() }); paint(); };
    window.COMP.api("GET", `rank-trends${key === "all" ? "" : `?site_id=${key}`}`)
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
    if (!row.places) return `<span class="rt-move rt-same" title="${esc(t(row.was === null ? "Nothing earlier to compare with" : "Same place as before"))}"><span aria-hidden="true">–</span><span class="sr-only">${t(row.was === null ? "Nothing earlier to compare with" : "Same place as before")}</span></span>`;
    const up = row.places > 0, size = place(Math.abs(row.places));
    const one = Math.abs(row.places) === 1;
    const words = fill(up ? (one ? "Up 1 place, from #{was}" : "Up {n} places, from #{was}") : one ? "Down 1 place, from #{was}" : "Down {n} places, from #{was}", { n: size, was: place(row.was) });
    return `<span class="rt-move"><span class="chg ${up ? "good" : "crit"}" title="${esc(words)}">${icon(up ? "arrow-up" : "arrow-down")}<span aria-hidden="true">${esc(size)}</span><span class="sr-only">${esc(words)}</span></span></span>`;
  }
  function similar(row) {
    if (!row.similar.length) return "";
    const rest = row.similar_count - row.similar.length;
    const names = row.similar.map((s) => `<span class="rt-sim">${window.KeywordLink.html(s.keyword, { id: s.keyword_id, host: row.host })}&nbsp;<span class="rt-sim-pos">#${esc(place(s.now))}</span></span>`).join("");
    return `<div class="d rt-similar"><span class="sr-only">${t("Similar keywords")}: </span>${names}${rest > 0 ? `<span class="rt-sim">+${esc(place(rest))}</span>` : ""}</div>`;
  }
  const hostTag = (host) => (host && allSites() ? ` <span class="small muted today-host" dir="auto">${esc(host)}</span>` : "");
  const rowHtml = (row) => `<li><div class="what"><div class="t">${window.KeywordLink.html(row.keyword, { id: row.keyword_id, host: row.host })}${hostTag(row.host)}</div>${similar(row)}</div>${move(row)}${pos(row.now)}</li>`;

  // ---- what to say when a list is empty ------------------------------------------------------------------
  function empty(source, found, screen) {
    const goKeywords = screen === "keywords" ? "" : `<button class="btn" data-go="keywords">${t("Open Keywords")}</button>`;
    const say = (title, words, button = "") => `<div class="empty rt-empty"><h3>${t(title)}</h3>${words ? `<p>${t(words)}</p>` : ""}${button}</div>`;
    if (source === "checks") {
      if (found.state === "no_keywords") return say("No keywords followed yet", "Add the keywords to follow, and their ranking shows here.", goKeywords);
      if (found.state === "not_checked") return say("No rank check yet", "Refresh in Keywords runs the first one.", goKeywords);
      if (found.state === "not_ranked") return say("Not found in the results checked", "Your site wasn't in the results for any keyword followed.");
      if (S.tab === "up") return say("No keyword went up", "Since the check before, by the same tool.");
      if (S.tab === "down") return say("No keyword went down", "Since the check before, by the same tool.");
    } else {
      if (found.state === "not_connected") return say("Search Console isn't connected", "", UI().canSettings?.() === false ? "" : `<button class="btn" data-go="settings">${t("Open Settings")}</button>`);
      if (found.state === "no_rows") return say("Too few searches in the last 7 days", "A query counts from 10 impressions in the week.");
      if (S.tab === "up") return say("No query went up", "By a place or more, against the week before.");
      if (S.tab === "down") return say("No query went down", "By a place or more, against the week before.");
    }
    return say("Nothing to show", "");
  }

  /* Where the numbers come from, said once under the list. */
  function note(source, found) {
    if (found.state !== "ok") return "";
    if (source === "gsc") return `${t("Search Console average position, all countries")} · ${fill("{a} – {b} against the 7 days before", { a: day(found.from), b: day(found.through) })}`;
    const bits = [`Google · ${found.tools.map(esc).join(", ")}`];
    if (found.last_check) bits.push(`${t("latest check")} ${day(found.last_check)}`);
    bits.push(t("moves: against the check before, same tool"));
    return bits.join(" · ");
  }

  // ---- the card ---------------------------------------------------------------------------------------
  function body(data, screen) {
    const source = sourceOf(data), found = data[source];
    const rows = found[S.tab] || [], shown = S.more ? rows : rows.slice(0, FIRST);
    const tabs = `<div class="rt-tabs" role="tablist" aria-label="${t("Which keywords")}">${TABS.map(([id, name]) =>
      `<button type="button" class="rt-tab" role="tab" data-rt-tab="${id}" aria-selected="${S.tab === id}" tabindex="${S.tab === id ? 0 : -1}">${t(name)}<span class="rt-n">${esc(place(found.counts[id]))}</span></button>`).join("")}</div>`;
    const list = found.state === "ok" && rows.length
      ? `<ul class="rows rt-rows" role="tabpanel" aria-label="${t(TABS.find(([id]) => id === S.tab)[1])}">${shown.map(rowHtml).join("")}</ul>`
      : empty(source, found, screen);
    const all = source === "checks" ? "keywords" : "overview";
    const elsewhere = all === screen || found.state !== "ok" ? "" : `<a class="link-btn rt-all" href="#${all}" data-go="${all}">${t(source === "checks" ? "All keywords" : "All queries")}${icon("chevron-right")}</a>`;
    const more = rows.length > FIRST ? `<button type="button" class="link-btn" data-rt-more aria-expanded="${S.more}">${S.more ? t("Show fewer") : fill("Show {n} more", { n: place(rows.length - FIRST) })}</button>` : "";
    const said = note(source, found);
    const foot = said || more || elsewhere ? `<div class="rt-foot"><span class="small muted rt-note" dir="auto">${said}</span><span class="rt-foot-acts">${more}${elsewhere}</span></div>` : "";
    return `${found.state === "ok" ? tabs : ""}${list}${foot}`;
  }

  function card(screen) {
    if (S.server === false) return ""; // opened as a plain file: the sample has no rankings of this kind
    const key = siteKey(), entry = S.cache.get(key);
    if (!entry || (!entry.loading && Date.now() - (entry.at || 0) > FRESH_MS)) load(key);
    const now = S.cache.get(key) || {};
    if (now.error?.status === 403 || now.error?.message === "Not in the sample data.") return ""; // chosen access without Keywords or Overview, or the plain-file sample: no card
    const data = now.data;
    const picked = data ? sourceOf(data) : S.source || "checks";
    const sw = `<span class="seg rt-seg end" role="group" aria-label="${t("Which ranking")}">${SOURCES.map(([id, name]) => `<button type="button" data-rt-source="${id}" aria-pressed="${picked === id}">${t(name)}</button>`).join("")}</span>`;
    const inside = data ? body(data, screen)
      : now.error ? `<div class="empty rt-empty"><h3>${t("Couldn't load the rankings")}</h3><button class="btn" data-rt-retry>${t("Try again")}</button></div>`
      : `<ul class="rows rt-rows rt-wait" aria-busy="true" aria-label="${t("Loading…")}">${"<li><span></span><span></span></li>".repeat(FIRST)}</ul>`;
    return `<section class="card rt-card" data-rank-trends="${esc(screen)}"><div class="card-head"><h2>${t("Keywords by ranking")}</h2>${sw}</div>${inside}</section>`;
  }

  /* Every copy on screen is drawn again, and the keyboard stays where it was. */
  function paint() {
    document.querySelectorAll("[data-rank-trends]").forEach((el) => {
      const held = el.contains(document.activeElement) ? document.activeElement : null;
      const again = held ? ["data-rt-tab", "data-rt-source", "data-rt-more"].map((name) => (held.hasAttribute(name) ? `[${name}${held.getAttribute(name) ? `="${held.getAttribute(name)}"` : ""}]` : "")).find(Boolean) : null;
      const html = card(el.dataset.rankTrends);
      if (!html) { el.remove(); return; }
      el.insertAdjacentHTML("afterend", html);
      const fresh = el.nextElementSibling;
      el.remove();
      if (again) (again.startsWith("[data-rt-tab") ? fresh.querySelector('[data-rt-tab][aria-selected="true"]') : fresh.querySelector(again))?.focus();
    });
  }

  document.addEventListener("click", (e) => {
    const el = e.target instanceof Element ? e.target.closest("[data-rt-tab], [data-rt-source], [data-rt-more], [data-rt-retry]") : null;
    if (!el) return;
    if (el.dataset.rtTab) { S.tab = el.dataset.rtTab; S.more = false; }
    else if (el.dataset.rtSource) {
      S.source = el.dataset.rtSource; S.more = false;
      try { localStorage.setItem(KEEP, S.source); } catch { /* kept for this visit only */ }
    } else if (el.hasAttribute("data-rt-more")) S.more = !S.more;
    else { S.cache.delete(siteKey()); }
    paint();
  });
  // Left and right walk the tabs, as a tab list should.
  document.addEventListener("keydown", (e) => {
    const tab = e.target instanceof Element ? e.target.closest("[data-rt-tab]") : null;
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const ids = TABS.map(([id]) => id), at = ids.indexOf(tab.dataset.rtTab);
    S.tab = e.key === "Home" ? ids[0] : e.key === "End" ? ids[ids.length - 1] : ids[(at + (e.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length];
    S.more = false;
    paint();
  });

  /* A rank check or a data pull just finished: the next draw asks again. */
  const stale = () => S.cache.forEach((entry) => { entry.at = 0; });

  window.COMP?.isServer?.().then((yes) => { S.server = yes; if (!yes) paint(); });

  window.RankTrends = { card, stale };

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
  };
  Object.keys(fr).forEach((word) => { if (window.FR && window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
