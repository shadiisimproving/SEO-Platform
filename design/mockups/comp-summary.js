/* Competitors area: Summary. All my competitors together, across my sites (COMP.ALL) or narrowed to one by the dropdown.
   Four questions, each loading and failing on its own, so a slow list of links can't hold up the rest.
   It only reads. Numbers come from seo/competitors/collective.py, which holds the counting rules. */
(() => {
  "use strict";
  const COMP = window.COMP;
  let UI = null, t = null, esc = null;
  if (window.ICONS && !window.ICONS.ellipsis) window.ICONS.ellipsis = '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>';
  const SECTIONS = ["rivals", "keywords", "moves", "links"];
  /* Every table, Who is moving too since 2026-11-10, has pages (table-pages.js), as every long table in the app. */
  const FIRST_ROWS = { moves: 5 }, MORE_ROWS = 50;
  const PAGES = { rivals: "cs-rivals", keywords: "cs-keywords", links: "cs-links", flagged: "cs-flagged", moves: "cs-moves" };
  const S = { site: null, token: 0, data: {}, errors: {}, limit: {}, list: null, order: null, orderSite: null, find: "", sort: null, kwRival: "", kwSort: null, lnSort: null, lnOld: false, flaggedOpen: false, linkQ: "", mvKind: "all", mvRival: "", mvDays: 30, low: "moves", mvOpen: new Set(), mvSort: "behind", mvDir: 1, mvBehind: false };
  /* The simpler screens (UI.simple(), plan section 2): the head says how the positions were checked, four number cards, the
     Competitors table with one ⋯ per row (Tracking and Remove), then one card with three tabs: They beat you on (first),
     Who is moving (all its filters) and Shared links. Each tab keeps its ids (#cs-keywords, #cs-moves, #cs-links), so a card
     or a link opens it. With the switch off, every function here draws exactly what it drew before. */
  const simple = () => Boolean(UI?.simple?.());
  /* 2026-11-16, the owner's benchmark screenshot: competitors as cards down the left, their changes on the right, so the
     changes come first and a card is the competitor filter. The number cards and the Competitors table went. */
  const LOW = [["moves", "Changes"], ["keywords", "They beat you on"], ["links", "Shared links"]];
  const FIND_FROM = 11; // more than 10 rows, as on every table: a search box shows from this many rows, or while a search is on

  const fill = (words, values) => t(words).replace(/\{(\w+)\}/g, (all, name) => (name in values ? values[name] : all));
  /* The same, for a sentence that holds HTML (logos): the words are escaped, the values must already be. */
  const fillHtml = (words, values) => esc(t(words)).replace(/\{(\w+)\}/g, (all, name) => (name in values ? values[name] : all));
  const attr = (words) => esc(t(words));
  const plural = (n, one, many) => fill(n === 1 ? one : many, { n: UI.num(n) });
  const engineName = (id) => UI.ENGINES.find(([key]) => key === id)?.[1] || id || "";
  const blank = `<span class="muted">—</span>`;
  const count = (n) => (n === null || n === undefined ? blank : UI.num(n));
  const pathFor = (part, site) => {
    const q = new URLSearchParams();
    if (site !== COMP.ALL) q.set("site_id", site);
    if (part === "moves" && S.mvDays !== 30) q.set("days", S.mvDays);
    return `collective/${part}${q.size ? `?${q}` : ""}`;
  };

  // ---- loading: each section on its own, and a late answer for another site is dropped --------------
  async function fetchSection(part, token, site) {
    try {
      const path = pathFor(part, site);
      const answer = window.SCREEN_DATA?.on?.() ? await window.SCREEN_DATA.get(path) : await COMP.api("GET", path);
      if (token !== S.token) return;
      S.data[part] = answer;
      delete S.errors[part];
    } catch (err) {
      if (token !== S.token) return;
      S.errors[part] = err.message;
    }
    paintSection(part);
  }

  /* One site: the competitors table also carries each one's tracking and how it was added, which only the list API knows. */
  async function fetchList(token, site) {
    if (site === COMP.ALL) { S.list = null; return; }
    try {
      const path = `competitors?site_id=${site}`;
      const answer = window.SCREEN_DATA?.on?.() ? await window.SCREEN_DATA.get(path) : await COMP.api("GET", path);
      if (token !== S.token) return;
      S.list = new Map(answer.competitors.map((c) => [c.id, c]));
    } catch { if (token === S.token) S.list = new Map(); }
    paintSection("rivals");
    if (UI.$("#cs-keywords")) paintSection("keywords"); // its empty box depends on whether any competitor is On
  }
  const listRow = (id) => S.list?.get(id) || null;
  /* The summary only counts competitors whose tracking is On. One set to Pages only or Off stays in the table, with — for its keyword numbers,
     so the switch that turned it down is still there to turn it back up. */
  function allRivals() {
    const d = S.data.rivals;
    if (!d) return [];
    if (!S.list || S.site === COMP.ALL) return d.rivals;
    const have = new Set(d.rivals.map((r) => r.id));
    const mine = d.sites?.find((s) => String(s.id) === String(S.site)) || { id: Number(S.site), host: "" };
    const extra = [...S.list.values()].filter((l) => !have.has(l.id)).map((l) => ({ id: l.id, host: l.host, display: l.display, crawl: l.crawl, edits_30d: l.edits_30d, ranks_on: null, they_ahead: null, i_ahead: null, not_found: 0, sites: [mine] }));
    return extra.length ? [...d.rivals, ...extra] : d.rivals;
  }
  const listPending = () => S.site !== COMP.ALL && S.list === null;
  /* How many competitors are On, Pages only and Off. At All my sites the summary only sends the ones that are On. */
  function trackingCounts() {
    const rows = allRivals(), out = { all: rows.length, on: 0, pages: 0, off: 0 };
    rows.forEach((r) => { out[S.list?.get(r.id)?.tracking || "on"] += 1; });
    return out;
  }
  /* No competitor is tracked for keywords (none is On): the keyword numbers aren't zero, they're unknown. */
  const noneOn = () => { const c = trackingCounts(); return c.all > 0 && c.on === 0; };
  /* Every competitor Off: none of their pages is read, so a count of changes or links is unknown, not 0. */
  const allOff = () => { const c = trackingCounts(); return c.all > 0 && c.off === c.all; };
  /* The line under "Competitors": only what's true. Off is paused; Pages only is still watched, but gives no keyword numbers. */
  function watchingWords() {
    const c = trackingCounts(), watched = c.on + c.pages;
    const open = t(c.all === 1 ? "Click to open." : "Click to open.");
    if (!watched) return plural(c.all, "{n} competitor, paused: set it to On to compare keywords.", "{n} competitors, all paused: set one to On to compare.");
    const first = c.off ? fill(watched === 1 ? "Watching 1 of {n} competitors." : "Watching {w} of {n} competitors.", { w: UI.num(watched), n: UI.num(c.all) }) : plural(c.all, "Watching {n} competitor.", "Watching {n} competitors.");
    return `${first} ${c.on ? open : t("None tracked for keywords: set one to On.")}`;
  }
  /* For comp-list.js: Remove and its Undo need the row even when the list tab was never drawn. */
  COMP.summaryRival = (id) => { const r = allRivals().find((x) => x.id === id); const l = listRow(id); return r ? { ...r, source: l?.source, tracking: l?.tracking } : l; };

  /* Rows keep the order they were first shown in for this site, so a change of tracking doesn't move one under the hand.
     A sort picked on a column header sets that order once, when it's picked; it isn't worked out again on each redraw. */
  const SORTS = {
    name: (r) => String(r.display || r.host).toLocaleLowerCase(),
    ranks: (r) => (trackedOn(r) && r.ranks_on !== null && r.ranks_on !== undefined ? r.ranks_on : null),
    leads: (r) => (trackedOn(r) && r.they_ahead !== null && r.they_ahead !== undefined ? (r.they_ahead || 0) - (r.i_ahead || 0) : null),
    edits: (r) => (r.crawl?.baseline_done && listRow(r.id)?.tracking !== "off" ? r.edits_30d || 0 : null),
  };
  function sortedOnce(rows) {
    const { key, dir } = S.sort, value = SORTS[key], up = dir === "up" ? 1 : -1;
    // Unknown (—) always goes last, whichever way: it isn't a small number.
    return [...rows].sort((a, b) => {
      const x = value(a), y = value(b);
      if (x === null || y === null) return (x === null) - (y === null);
      return (x < y ? -1 : x > y ? 1 : 0) * up || rows.indexOf(a) - rows.indexOf(b);
    });
  }
  function orderedRivals() {
    const rows = allRivals();
    if (S.orderSite !== S.site || !S.order) {
      S.orderSite = S.site;
      const first = S.sort && SORTS[S.sort.key] ? sortedOnce(rows) : rows;
      S.order = new Map(first.map((r, i) => [r.id, i]));
      return first;
    }
    const at = (r) => (S.order.has(r.id) ? S.order.get(r.id) : S.order.size + rows.indexOf(r));
    return [...rows].sort((a, b) => at(a) - at(b));
  }
  /* Typed part of a name: case, accents and "www." don't matter. */
  const folded = (text) => String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/^www\./, "").trim();
  const matches = (r) => !S.find || folded(`${r.display || ""} ${r.host}`).includes(folded(S.find));

  function paintSection(part) {
    if (UI.state.route !== "competitors" || COMP.currentTab() !== tab) return;
    if (part === "rivals" && S.data.rivals && !listPending() && (!allRivals().length || !UI.$("#cs-rivals"))) { COMP.paint(); return; } // no competitors: the whole page becomes one message
    const box = UI.$(`#cs-${part}`);
    const finding = part === "rivals" && document.activeElement?.id === "cs-find" ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    if (box) UI.setHTML(box, SECTION[part]());
    if (finding) { const input = UI.$("#cs-find"); input?.focus({ preventScroll: true }); try { input?.setSelectionRange(...finding); } catch { /* not a text box */ } }
    const tiles = UI.$("#cs-tiles"), basisLine = UI.$("#cs-basis");
    const oceanTop = UI.$("#cbm-top"); // the new design's number cards and charts (ocean-market.js)
    if (oceanTop && window.OceanMarket?.on?.()) UI.setHTML(oceanTop, window.OceanMarket.summaryTop());
    if (tiles) UI.setHTML(tiles, tilesHtml());
    if (basisLine) UI.setHTML(basisLine, basisHtml());
    if (simple()) COMP.paintHead?.();
    const lowTabs = UI.$("#cs-low-tabs");
    if (lowTabs && simple()) { const focused = document.activeElement?.dataset?.csLow; UI.setHTML(lowTabs, lowTabsHtml()); if (focused) UI.$(`[data-cs-low="${focused}"]`)?.focus({ preventScroll: true }); }
  }

  const refreshLinks = () => fetchSection("links", S.token, S.site);

  // ---- the top of the page ---------------------------------------------------------------------
  function basisHtml() {
    const c = S.data.rivals?.coverage;
    if (!c || !c.keywords || !c.checked) return ""; // no list, or a list never checked: the setup banner above the tabs already says so, once
    const when = c.newest === c.oldest ? fill("checked {when}", { when: COMP.ago(c.newest) }) : fill("newest check {newest}, oldest {oldest}", { newest: COMP.ago(c.newest), oldest: COMP.ago(c.oldest) });
    if (simple()) return `<span class="head-sep"> · </span>${esc(fill("{checked} of {total} keywords checked", { checked: UI.num(c.checked), total: UI.num(c.keywords) }))}<span class="head-sep"> · </span>${esc(c.tools.join(", "))}<span class="head-sep"> · </span>${esc(when)}`;
    return `${esc(`${fill("{checked} of {total} keywords checked, with {tools}", { checked: UI.num(c.checked), total: UI.num(c.keywords), tools: c.tools.join(", ") })}, ${when}.`)} ${COMP.info("Positions are only compared inside one check.")}`;
  }

  /* Changes per day over the window, for the tile's small graph. Only when every change is in hand, so the line is the truth. */
  function movesLine(d) {
    if (!d || !d.moves.length || d.total > d.moves.length) return null;
    const days = d.days || 30, today = Date.now(), counts = new Array(days).fill(0);
    d.moves.forEach((m) => { const ago = Math.floor((today - new Date(m.at).getTime()) / 86400000); if (ago >= 0 && ago < days) counts[days - 1 - ago] += 1; });
    return counts;
  }

  /* Unknown is unknown: with nothing checked, read or uploaded, a card says — and not 0. */
  function tilesHtml() {
    const one = (part, label, value, sub, ic, line = null) => {
      if (simple()) {
        const words = value === null ? "…" : value === undefined ? null : value;
        return UI.card({ id: `cs-${part}`, label: esc(t(label)), value: words, sub: sub ? esc(sub) : "", spark: value && line ? line : null, def: false, button: true, cls: "cs-jump", attrs: { "data-cs-jump": part, "aria-label": `${t(label)}: ${value === null ? "…" : value === undefined ? "—" : UI.num(value)}` } });
      }
      const words = value === null ? "…" : value === undefined ? "—" : UI.num(value);
      return `<button type="button" class="cs-jump" data-cs-jump="${part}" aria-label="${attr(label)}: ${esc(words)}">${UI.tile(t(label), value === null || value === undefined ? `<span class="muted"${value === undefined && sub ? ` title="${attr(sub)}"` : ""}>${words}</span>` : UI.num(value), sub ? `<span class="ab">${esc(sub)}</span>` : "", { ic, line: value ? line : null })}</button>`;
    };
    const d = S.data;
    const siteCount = (d.rivals || d.keywords || d.moves || d.links)?.sites?.length;
    const known = (answer, isKnown, value) => (!answer ? null : isKnown ? value : undefined);
    const nothingRead = d.moves && d.rivals && d.moves.blocked.length + d.moves.not_started.length >= allRivals().length;
    const hasLinks = d.links && d.links.rivals_with_data > 0;
    return [
      one("rivals", "Competitors", d.rivals ? allRivals().length : null, siteCount ? plural(siteCount, "across {n} site", "across {n} sites") : "", "crosshair"),
      one("keywords", "Keywords they beat you on", known(d.keywords, d.keywords?.coverage.checked > 0 && !noneOn(), d.keywords?.total), d.keywords && noneOn() ? t("None tracked for keywords") : "", "trending-up"),
      one("moves", S.data.moves?.days === 365 ? "Changes, past year" : fill("Changes in {n} days", { n: UI.num(S.data.moves?.days || 30) }), known(d.moves, d.moves?.total > 0 || (!allOff() && !nothingRead && !allFirstRead()), d.moves?.total), d.moves && !d.moves.total ? (allOff() ? t("All paused") : nothingRead ? (allRivals().length ? t("No pages read yet") : "") : allFirstRead() ? t("Only first reads so far") : "") : "", "activity", movesLine(d.moves)),
      one("links", "Domains linking to 2+", known(d.links, hasLinks, d.links?.funnel.shared), hasLinks ? plural(d.links.funnel.good, "{n} good domain", "{n} good domains") : d.links && allOff() ? t("All paused") : "", "link-2"),
    ].join("");
  }

  // ---- shared pieces -------------------------------------------------------------------------------
  /* subTip: the full sentence behind (i), right after the sub line (UI.tip). */
  const sectionHead = (title, sub = "", info = "", subTip = "") => simple()
    ? `<div class="cs-head cs-head-quiet"><h2 class="sr" tabindex="-1">${esc(t(title))}</h2>${sub ? `<p class="sr">${esc(sub)}</p>` : ""}</div>`
    : `<div class="cs-head"><h2 tabindex="-1">${esc(t(title))}${info ? COMP.info(info) : ""}</h2>${sub ? `<p class="small sec">${esc(sub)}${subTip ? UI.tip(subTip) : ""}</p>` : ""}</div>`;
  /* Every competitor in view, so a link can be ticked for one a domain isn't listed under yet. */
  const rivalsInView = (d) => [...new Map([...(d.rivals || []), ...[...d.gaps, ...d.flagged].flatMap((row) => row.rivals)].map((r) => [r.id, r])).values()].sort((a, b) => a.host.localeCompare(b.host));
  /* Open Link gaps always sits in the head (COMPARISON 2026-11-17, place 3): it used to show only when something was spam.
     At All my sites it opens the first site. */
  const reviewSiteId = () => (COMP.siteId === COMP.ALL ? (UI.preferredSite(COMP.sites)?.id ?? "") : COMP.siteId);
  const linksHead = (title, sub, d) => `<div class="cs-head-row">${sectionHead(title, sub, "Spam is flagged, never removed, and only good domains can be added.")}<span class="cs-head-acts">${rivalsInView(d).length ? `<button class="btn btn-small" data-cs-add-domain>${UI.icon("plus")}${t("Add a domain")}</button>` : ""}<button class="btn btn-small" data-cs-review="${reviewSiteId()}" data-tip="${attr("Sites linking to your competitors, not to you")}">${UI.icon("link-2-off")}${t("Open Link gaps")}</button></span></div>`;
  const loadingCard = (title) => `${sectionHead(title)}${COMP.loading()}`;
  const failedCard = (part, title) => `${sectionHead(title)}<div class="table-wrap"><div class="empty"><h3>${t("That didn't load")}</h3><p>${esc(t(S.errors[part]))}</p><button class="btn" data-cs-retry="${part}">${UI.icon("refresh-cw")}${t("Try again")}</button></div></div>`;
  const limitOf = (part) => S.limit[part] || FIRST_ROWS[part] || 25;
  /* A header that sorts, in the screen's own look: data names the button's attribute, so each table keeps its own order. */
  function sortButtonHead(data, key, label, current, cls = "", tip = "") {
    const on = current?.key === key, dir = on ? current.dir : null;
    const arrow = on ? UI.icon(dir === "up" ? "arrow-up" : "arrow-down") : "";
    return `<th scope="col" class="${cls}" aria-sort="${on ? (dir === "up" ? "ascending" : "descending") : "none"}"${tip ? ` data-tip="${attr(tip)}"` : ""}><button type="button" class="cs-sort${on ? " on" : ""}" ${data}="${key}">${t(label)}${arrow}</button></th>`;
  }
  /* First press: names A to Z, numbers the way that matters first. The second press turns it round, the third goes back to the usual order. */
  function nextSort(current, key, first) {
    if (current?.key !== key) return { key, dir: first };
    return current.dir === first ? { key, dir: first === "up" ? "down" : "up" } : null;
  }
  /* Unknown (null) always goes last, whichever way: it isn't a small number. */
  function sortList(list, value, sort) {
    if (!sort) return list;
    const up = sort.dir === "up" ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = value(a), y = value(b);
      if (x === null || x === undefined || y === null || y === undefined) return (x === null || x === undefined) - (y === null || y === undefined);
      const scored = window.BacklinkCleaner.compareScored(x, y, up);
      if (scored !== null) return scored;
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), UI.state.lang)) * up;
    });
  }
  /* A search that finds nothing says so, with the way back. */
  const noneFound = (words, key) => `<div class="table-wrap"><div class="empty cs-find-none"><p>${esc(words)}</p><button type="button" class="btn btn-small" data-tp-clear data-tp-key="${esc(key)}">${t("Clear search")}</button></div></div>`;
  function moreButton(part, shown, total, word = "Show more") {
    if (shown >= total) return "";
    return `<div class="cs-more"><span class="small sec">${esc(fill("{shown} of {total}", { shown: UI.num(shown), total: UI.num(total) }))}</span><button class="btn btn-small" data-cs-more="${part}">${t(word)} (${UI.num(total - shown)})</button></div>`;
  }
  /* All my sites: each of my sites as its icon, with the name on hover and for screen readers, so the row stays one line. */
  /* All my sites: each of my sites by its icon and its name, since two sites without an icon would show the same letter. */
  const siteChip = (rival, site) => `<button type="button" class="cs-site" data-cs-open="${rival.id}" data-cs-site="${site.id}" aria-label="${esc(fill("Open {rival} for {site}", { rival: rival.display || rival.host, site: site.host }))}">${UI.siteLogo(site.host, 18)}<span class="cs-site-name mono" dir="auto">${esc(site.host)}</span></button>`;

  // ---- 1. Who are my biggest rivals? ---------------------------------------------------------------
  /* The whole row opens the competitor, for its first site. The name is the real button, so it works from the keyboard too. */
  /* Unknown is unknown: no check yet, or a site not read yet, shows — and never 0. */
  const unknown = (why) => `<span class="muted" title="${attr(why)}">—</span>`;
  const trackedOn = (r) => (listRow(r.id)?.tracking ?? "on") === "on";
  function leadCell(r) {
    if (!trackedOn(r)) return unknown("Not tracked for keywords.");
    if (r.ranks_on === null || r.ranks_on === undefined) return unknown("No ranking check yet");
    const side = (who, n, cls) => `<span class="cs-lead-side">${COMP.who(cls, null, t(who))} <b class="tabular">${UI.num(n || 0)}</b></span>`;
    const absent = r.not_found ? `<span class="second">${esc(plural(r.not_found, "you're absent on {n}", "you're absent on {n}"))}</span>` : "";
    return `<span class="cs-lead-cell"><span class="cs-lead">${side("Them", r.they_ahead, "them")}${side("You", r.i_ahead, "you")}</span>${absent}</span>`; // one box, so a phone's card keeps both sides on a line with the note under them
  }
  /* Added in the last day, with no edit seen: its pages have been read once, and a first read only sets the starting point.
     So 0 would claim something the app can't know yet. (The API sends no count of reads, hence the day.) */
  const FIRST_READ = "First read sets the starting point; edits show from the next one.";
  const firstReadOnly = (r) => { const at = listRow(r.id)?.added_at; return !r.edits_30d && Boolean(at) && Date.now() - new Date(at).getTime() < 86400000; };
  const allFirstRead = () => { const rows = allRivals().filter((r) => listRow(r.id)?.tracking !== "off"); return rows.length > 0 && rows.every((r) => firstReadOnly(r) || !r.crawl?.baseline_done); };
  function editsCell(r) {
    const c = r.crawl || {};
    if (c.status === "blocked") return unknown("Edits can't be tracked on this site.");
    if (listRow(r.id)?.tracking === "off") return unknown("Tracking is off: its pages aren't read.");
    if (!c.status || c.status === "none" || c.status === "queued" || !c.baseline_done) return unknown("The first read isn't done yet.");
    if (firstReadOnly(r)) return unknown(FIRST_READ);
    return UI.num(r.edits_30d);
  }
  /* The competitor's name opens it, on both screens: a real button, so the keyboard and screen readers get it without help. */
  const rivalOpen = (r, site, name) => `<button type="button" class="cs-rival-open cs-row-link with-logo" data-cs-open="${r.id}" data-cs-site="${site.id}" aria-label="${attr(fill("Open {rival}", { rival: r.display || r.host }))}">${name}</button>`;
  const menuButton = (r) => `<button type="button" class="icon-btn cs-row-menu" data-cs-menu="${r.id}" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(fill("More for {rival}", { rival: r.display || r.host }))}" data-tip="${attr("Tracking and Remove")}">${UI.icon("ellipsis")}</button>`;
  function simpleRivalRow(r) {
    const all = S.site === COMP.ALL, l = listRow(r.id);
    const name = `${UI.siteLogo(r.host)}<span class="logo-text kw" dir="auto">${esc(r.display || r.host)}</span>`;
    const site = r.sites[0];
    return `<tr${site ? ` data-cs-row="${r.id}" data-cs-row-site="${site.id}"` : ""} class="${l?.tracking && l.tracking !== "on" ? `ct-row-${l.tracking}` : ""}">
      <td class="head-cell">${site ? rivalOpen(r, site, name) : `<span class="with-logo">${name}</span>`}${!all && l && l.source !== "suggested" ? ` ${COMP.iconTip("user", t("Added by hand"), "cl-hand")}` : ""}${l?.tracking === "pages" ? ` <span class="tag cs-track-tag">${esc(t("Pages only"))}</span>` : ""}</td>
      ${all ? `<td data-label="${attr("Your sites")}"><span class="cs-sites">${r.sites.map((x) => siteChip(r, x)).join("")}</span></td>` : ""}
      <td class="c" data-label="${attr("Ranks on your keywords")}">${trackedOn(r) ? count(r.ranks_on) : unknown("Not tracked for keywords.")}</td>
      <td class="c" data-label="${attr("Who leads")}">${leadCell(r)}</td>
      <td class="c" data-label="${attr("Edits in 30 days")}">${editsCell(r)}</td>
      <td data-label="${attr("Watching")}" data-cl-watch="${r.id}">${l?.tracking === "off" ? `<span class="status sec">${UI.icon("pause")}${esc(t("Paused"))}</span>` : COMP.watching(r.crawl, site ? { id: r.id, site: site.id } : null)}</td>
      ${all ? "" : `<td class="r nowrap cs-menu-cell" data-label="">${l ? menuButton(r) : ""}</td>`}
    </tr>`;
  }
  const rivalRow = (r) => {
    if (simple()) return simpleRivalRow(r);
    const all = S.site === COMP.ALL, l = listRow(r.id);
    const name = `${UI.siteLogo(r.host)}<span class="logo-text kw mono" dir="auto">${esc(r.display || r.host)}</span>`;
    return `<tr${r.sites[0] ? ` data-cs-row="${r.id}" data-cs-row-site="${r.sites[0].id}"` : ""} class="${l?.tracking && l.tracking !== "on" ? `ct-row-${l.tracking}` : ""}">
      <td class="head-cell">${r.sites[0]
        ? `<button type="button" class="cs-rival-open with-logo" data-cs-open="${r.id}" data-cs-site="${r.sites[0].id}" aria-label="${attr(fill("Open {rival}", { rival: r.display || r.host }))}">${name}</button>`
        : `<span class="with-logo">${name}</span>`}${!all && l && l.source !== "suggested" ? ` ${COMP.iconTip("user", t("Added by hand"), "cl-hand")}` : ""}</td>
      ${all ? `<td data-label="${attr("Your sites")}"><span class="cs-sites">${r.sites.map((site) => siteChip(r, site)).join("")}</span></td>` : ""}
      <td class="c" data-label="${attr("Ranks on your keywords")}">${trackedOn(r) ? count(r.ranks_on) : unknown("Not tracked for keywords.")}</td>
      <td class="c" data-label="${attr("Who leads")}">${leadCell(r)}</td>
      <td class="c" data-label="${attr("Edits in 30 days")}">${editsCell(r)}</td>
      <td data-label="${attr("Watching")}" data-cl-watch="${r.id}">${l?.tracking === "off" ? `<span class="status sec">${UI.icon("pause")}${esc(t("Paused"))}</span>` : COMP.watching(r.crawl, r.sites[0] ? { id: r.id, site: r.sites[0].id } : null)}</td>
      ${all ? "" : `<td data-label="${attr("Tracking")}">${l ? COMP.trackingSwitch?.({ ...l, tracking: l.tracking || "on" }) ?? "" : ""}</td>
      <td class="r nowrap" data-label=""><button class="icon-btn cl-row-btn" data-cl-remove="${r.id}" aria-label="${attr("Remove")}: ${esc(r.host)}" data-tip="${attr("Remove")}">${UI.icon("trash-2")}</button></td>`}
    </tr>`;
  };

  /* My own sites, pinned above the competitors: the same count over the same 30 days, in the same column, shown once.
     Drawn outside the table's pages and with wide blank cells, so table-tools gives it no tick box and sorting, filtering and paging leave it on top. */
  const DAY = 86400000;
  function youEdits(m) {
    const c = m.crawl || {}, since = m.reading_since ? new Date(m.reading_since).getTime() : null;
    if (c.status === "blocked") return unknown("Edits can't be tracked on this site.");
    if (!c.baseline_done) return unknown("The first read isn't done yet.");
    if (!m.edits_30d && since && Date.now() - since < DAY) return unknown(FIRST_READ);
    const short = since && Date.now() - since < 30 * DAY; // read for less than the period: say from when, so it isn't taken for a full 30 days
    return `<span class="cs-lead-cell">${UI.num(m.edits_30d)}${short ? `<span class="second">${esc(sinceWords(m.reading_since))}</span>` : ""}</span>`; // one box, so a phone's card keeps the date under the number
  }
  /* 2026-11-12, the owner found the pinned row "looks bad": a half-empty competitor row with a mono address and blank cells.
     Now one slim, muted line across the whole table: "[logo] Your site · site-one.example · 4 edits in 30 days · all pages
     daily · See your edits". No blank cells, "Reading now" only while a read runs, and the edits open in a side panel.
     It stays a row of the table (tr.cs-you-row, first in tbody, one wide cell), so table-tools gives it no tick box and
     sorting, filtering and paging leave it on top. */
  const youCols = (all) => (UI.simple?.() ? 6 : all ? 6 : 7);
  /* "since 12 Nov 2026" when that is today read wrong (UI critique 2026-11-12): today and yesterday get their own words. */
  const dayAgo = (iso) => {
    const d = new Date(iso), now = new Date();
    const key = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
    if (key(d) === key(now)) return 0;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    return key(d) === key(y) ? 1 : null;
  };
  function sinceWords(iso, n) {
    const ago = dayAgo(iso);
    if (n === undefined) return ago === 0 ? t("today") : ago === 1 ? t("since yesterday") : fill("since {date}", { date: UI.fmtDateOnly(iso) });
    const num = `<b class="tabular">${UI.num(n)}</b>`;
    if (ago === 0) return fillHtml(n === 1 ? "{n} edit today" : "{n} edits today", { n: num });
    if (ago === 1) return fillHtml(n === 1 ? "{n} edit since yesterday" : "{n} edits since yesterday", { n: num });
    return fillHtml(n === 1 ? "{n} edit since {date}" : "{n} edits since {date}", { n: num, date: esc(UI.fmtDateOnly(iso)) });
  }
  function youEditsWords(m) {
    const c = m.crawl || {}, since = m.reading_since ? new Date(m.reading_since).getTime() : null;
    if (c.status === "blocked") return `<span class="sec" data-tip="${attr("Edits can't be tracked on this site.")}" tabindex="0">${esc(t("Edits not tracked"))}</span>`;
    if (!c.baseline_done) return `<span class="sec" data-tip="${attr("The first read isn't done yet.")}" tabindex="0">${esc(t("Edits show after the first read"))}</span>`;
    if (!m.edits_30d && since && Date.now() - since < DAY) return `<span class="sec" data-tip="${attr(FIRST_READ)}" tabindex="0">${esc(t("Edits show from the next read"))}</span>`;
    const short = since && Date.now() - since < 30 * DAY; // read for less than the period: say from when, so it isn't taken for a full 30 days
    const n = `<b class="tabular">${UI.num(m.edits_30d)}</b>`;
    return short ? sinceWords(m.reading_since, m.edits_30d)
      : fillHtml(m.edits_30d === 1 ? "{n} edit in 30 days" : "{n} edits in 30 days", { n });
  }
  function youReading(m) {
    const c = m.crawl || {};
    if (c.status === "running" || c.status === "queued") return `<span class="status sec">${UI.icon("refresh-cw", "spin")}${esc(t("Reading now"))}</span>`;
    if (c.status === "blocked") return COMP.watching(c, null);
    if (c.status === "failed") return `<span class="crit-t">${esc(t("Last read failed"))}</span>`;
    const how = COMP.reading?.follow?.(c);
    if (how) return `<span data-tip="${esc(how.text)}" tabindex="0">${esc(how.short)}</span>`;
    return c.finished_at ? esc(fill("Read {when}", { when: COMP.ago(c.finished_at) })) : "";
  }
  const youRow = (m, all) => {
    const bits = [youEditsWords(m), youReading(m)].filter(Boolean);
    const see = m.recent_edits?.length ? `<button type="button" class="link-btn cs-you-edits" data-cs-you-edits="${esc(m.id)}">${t("See your edits")}</button>` : "";
    return `<tr class="cs-you-row" data-cs-you="${esc(m.id)}"><td class="cs-you-cell" colspan="${youCols(all)}"><div class="cs-you-line">
      <span class="cs-you-name">${COMP.who("you", m.host, t("Your site"))} <span class="sec" dir="auto">${esc(m.display || m.host)}</span></span>
      ${bits.map((b) => `<span class="cs-you-bit">${b}</span>`).join("")}${see ? `<span class="cs-you-act">${see}</span>` : ""}
    </div></td></tr>`;
  };
  /* "See your edits": my own site's edits in the 30 days, newest first, in the side panel. */
  function openYourEdits(id, opener) {
    const m = (S.data.rivals?.mine || []).find((x) => String(x.id) === String(id));
    if (!m) return;
    const rows = m.recent_edits || [];
    const path = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return COMP.shortUrl(url); } };
    if (UI.simple?.() && UI.rowPanel) {
      UI.rowPanel({ kind: "Your site", id: "your-edits", title: m.display || m.host, logo: m.host, period: false, opener, sub: t("Edits in 30 days"),
        numbers: [{ id: "edits", label: "Edits in 30 days", value: m.edits_30d }, { id: "pages", label: "Pages changed", value: new Set(rows.map((e) => e.url)).size }],
        sections: [{ title: t("Your edits"), badge: rows.length, limit: 50, rows, columns: [
          { label: t("Date"), html: (e) => COMP.ageCell(e.at) },
          { label: t("Change|kind").split("|")[0], get: (e) => COMP.changeWord?.(e.kind) || e.kind },
          { label: t("Page"), html: (e) => COMP.link(e.url, path(e.url)) },
          { label: t("What changed"), get: (e) => COMP.changeShort?.(e) || "" },
        ] }] });
      return;
    }
    const list = rows.map((e) => `<tr><td class="nowrap">${COMP.ageCell(e.at)}</td><td>${esc(COMP.changeWord?.(e.kind) || e.kind)}</td><td>${COMP.link(e.url, path(e.url))}</td><td class="sec">${esc(COMP.changeShort?.(e) || "")}</td></tr>`).join("");
    UI.openPanel(`${UI.panelHead(fill("Your edits on {site}", { site: m.display || m.host }), esc(fill(m.edits_30d === 1 ? "{n} edit in 30 days" : "{n} edits in 30 days", { n: UI.num(m.edits_30d) })), UI.siteLogo(m.host, 34))}
      <div class="panel-body"><div class="table-wrap"><table class="data cs-you-edits-table" data-tt-off><thead><tr><th scope="col">${t("Date")}</th><th scope="col">${esc(t("Change|kind").split("|")[0])}</th><th scope="col">${t("Page")}</th><th scope="col">${t("What changed")}</th></tr></thead><tbody>${list}</tbody></table></div>
      ${m.edits_30d > rows.length ? `<p class="small sec">${esc(fill("The newest {n} shown.", { n: UI.num(rows.length) }))}</p>` : ""}</div>`, opener);
  }

  function rivalsHtml() {
    const title = "Competitors";
    const cardHead = `<div class="card-head"><h2 tabindex="-1">${t(title)}</h2></div>`;
    if (simple() && S.errors.rivals) return `${cardHead}${failedCard("rivals", title)}`;
    if (simple() && !S.data.rivals) return `${cardHead}${COMP.loading()}`;
    if (S.errors.rivals) return failedCard("rivals", title);
    const d = S.data.rivals;
    if (!d) return loadingCard(title);
    const all = S.site === COMP.ALL;
    if (simple()) {
      const finder = allRivals().length >= FIND_FROM || S.find
        ? `<div class="cs-find"><label class="cs-find-box">${UI.icon("search")}<span class="sr">${t("Find a competitor")}</span><input type="search" class="input" id="cs-find" placeholder="${attr("Find a competitor")}" value="${esc(S.find)}" autocomplete="off" spellcheck="false"></label></div>`
        : "";
      return `<h2 class="sr" tabindex="-1">${t(title)}</h2><div class="cs-side-top">${finder}${slimToggle()}</div><div id="cs-rivals-list">${cardsList()}</div>`;
    }
    const head = `<div class="cs-head-row">${sectionHead(title, watchingWords(), all ? "Most wins over you first. Each icon is one of your sites: click to open the competitor there." : "Most wins over you first.")}<button class="btn btn-main" id="cl-add-open">${UI.icon("plus")}${t(all ? "Add competitors" : "Add a competitor")}</button></div>`;
    const finder = allRivals().length >= FIND_FROM || S.find
      ? `<div class="cs-find"><label class="cs-find-box">${UI.icon("search")}<span class="sr">${t("Find a competitor")}</span><input type="search" class="input" id="cs-find" placeholder="${attr("Find a competitor")}" value="${esc(S.find)}" autocomplete="off" spellcheck="false"></label></div>`
      : "";
    return `${head}${finder}<div id="cs-rivals-list">${rivalsList()}</div>`;
  }
  /* A header that sorts: first press most first (A to Z for names), the next one the other way. */
  function sortHead(key, label, cls = "", tip = "") {
    const on = S.sort?.key === key, dir = on ? S.sort.dir : null;
    const aria = ` aria-sort="${on ? (dir === "up" ? "ascending" : "descending") : "none"}"`;
    const arrow = on ? UI.icon(dir === "up" ? "arrow-up" : "arrow-down") : "";
    return `<th scope="col" class="${cls}"${aria}${tip ? ` data-tip="${attr(tip)}"` : ""}><button type="button" class="cs-sort${on ? " on" : ""}" data-cs-sort="${key}">${t(label)}${arrow}</button></th>`;
  }
  /* The table and its pages, redrawn alone while someone types in the search box, so the box keeps its focus. */
  function rivalsList() {
    if (simple()) return cardsList();
    const all = S.site === COMP.ALL;
    const every = orderedRivals().filter(matches), page = TP.view(PAGES.rivals, every), rows = page.rows;
    if (S.find && !every.length) return `<div class="table-wrap"><div class="empty cs-find-none"><p>${esc(fill("No competitor matches “{text}”.", { text: S.find }))}</p><button type="button" class="btn btn-small" data-cs-find-clear>${t("Show all")}</button></div></div>`;
    return `<div class="cs-pages"><div class="table-wrap"><table class="data cs-merged" id="cs-rivals-table">
        <thead><tr>${sortHead("name", "Competitor")}${all ? `<th scope="col">${t("Your sites")}</th>` : ""}${sortHead("ranks", "Ranks on your keywords", "c")}${sortHead("leads", "Who leads", "c", "Who's ahead on shared keywords, and how many you're absent on.")}${sortHead("edits", "Edits in 30 days", "c")}<th scope="col">${t("Watching")}</th>${all ? "" : simple() ? `<th scope="col"><span class="sr">${t("Actions")}</span></th>` : `<th scope="col">${t("Tracking")}</th><th scope="col"><span class="sr">${t("Action")}</span></th>`}</tr></thead>
        <tbody>${(S.data.rivals?.mine || []).map((m) => youRow(m, all)).join("")}${rows.map(rivalRow).join("")}</tbody>
      </table></div>${TP.footer(PAGES.rivals, page, { noun: t("competitors") })}${simple() ? "" : COMP.watchNotes?.([...(S.data.rivals?.mine || []), ...every.map((r) => ({ host: r.host, display: r.display, crawl: r.crawl, tracking: listRow(r.id)?.tracking }))]) || ""}</div>${S.find ? `<p class="small sec cs-find-count">${esc(fill("{n} of {total} competitors match.", { n: UI.num(every.length), total: UI.num(allRivals().length) }))}</p>` : ""}`;
  }
  function paintRivalsList() {
    const box = UI.$("#cs-rivals-list");
    if (box) UI.setHTML(box, rivalsList());
    UI.syncUrl?.(); // the search and sort are in the address, so a reload keeps them
  }

  // ---- 1b. The cards (simpler screens, 2026-11-16) -------------------------------------------------
  /* One card per competitor, as in the owner's benchmark screenshot: logo, the name its home page gives itself, its address,
     what it says about itself, then its last 30 days as two counts and its page count. The card is the filter for Changes
     (and for They beat you on): press it to see only that competitor, press it again for everyone. "Open" opens its profile. */
  /* A home page title is often "Brand - what we do": the part before the dash is the name, the rest stays in the description. */
  function cardName(r) {
    const title = String(r.about?.title || "").trim();
    if (!title) return { name: r.display || r.host, rest: "" };
    const cut = title.split(/\s+[-–—|·:]\s+/);
    return cut.length > 1 && cut[0].length >= 2 && cut[0].length <= 40 ? { name: cut[0], rest: cut.slice(1).join(" – ") } : { name: title, rest: "" };
  }
  /* Unknown is unknown: a site never read, blocked or paused says so, and its counts aren't shown as 0. */
  function cardCounts(r, edits, paused) {
    const c = r.crawl || {};
    if (paused) return `<span class="status sec">${UI.icon("pause")}${esc(t("Paused"))}</span>`;
    if (c.status === "blocked") return COMP.watching(c, null);
    if (!c.baseline_done) { const bar = COMP.reading?.progress?.(c); return bar && bar.tried ? bar.html : `<span class="sec small">${esc(t(c.status === "running" || c.status === "queued" ? "Reading its pages now" : "Not read yet"))}</span>`; }
    if (firstReadOnly(r)) return `<span class="sec small" data-tip="${attr(FIRST_READ)}" tabindex="0">${esc(t("Edits show from the next read"))}</span>`;
    const pill = (n, one, many, tone) => `<span class="cs-card-n cs-card-${tone}${n ? "" : " zero"}"><b class="tabular">${UI.num(n)}</b> ${esc(t(n === 1 ? one : many))}</span>`;
    return `${pill(r.added_30d ?? 0, "added in 30 days", "added in 30 days", "new")}${pill(edits, "edited in 30 days", "edited in 30 days", "edit")}`;
  }
  const pagesWords = (r) => {
    const c = r.crawl || {};
    if (c.status === "blocked") return t("can't read its pages");
    const n = c.pages_known ?? c.pages_read;
    return n ? plural(n, "{n} page", "{n} pages") : "";
  };
  /* Who leads, on the card's last line beside Open: three short counts, never a sentence. */
  function cardLead(r) {
    const side = (who, word, n) => `<span class="cs-lead-side">${COMP.who(who, null, t(word))}<b class="tabular">${UI.num(n || 0)}</b></span>`;
    const absent = r.not_found ? `<span class="cs-lead-side cs-lead-absent" aria-label="${attr(plural(r.not_found, "you're absent on {n}", "you're absent on {n}"))}"><span>${esc(t("Absent"))}</span><b class="tabular">${UI.num(r.not_found)}</b></span>` : "";
    return `<span class="cs-card-lead" role="group" aria-label="${attr("Who leads")}">${side("them", "Them", r.they_ahead)}${side("you", "You", r.i_ahead)}${absent}</span>`;
  }
  /* The folded rail: the logo only picks (filters Changes), so each logo gets its own small Open beside it (2026-11-23, the
     owner: on a 1440 laptop you couldn't open a competitor without unfolding the cards). It shows on hover or focus, stays
     shown on touch screens and on the picked logo, and its tooltip says what it does, unlike the logo's. */
  const railOpen = (r, site, name) => `<button type="button" class="cs-rail-open" data-cs-open="${r.id}" data-cs-site="${site.id}" aria-label="${attr(fill("Open {rival}'s page", { rival: name }))}" data-tip="${attr(fill("Open {rival}'s page", { rival: name }))}">${UI.icon("arrow-right")}</button>`;
  function rivalCard(r) {
    const all = S.site === COMP.ALL, l = listRow(r.id), paused = l?.tracking === "off";
    const { name, rest } = cardName(r);
    const about = [rest, r.about?.description].filter(Boolean).join(". ");
    const picked = S.mvRival === String(r.id);
    const site = r.sites[0];
    const edits = r.edited_30d ?? r.edits_30d ?? 0;
    const lead = trackedOn(r) && r.ranks_on !== null && r.ranks_on !== undefined ? cardLead(r) : "";
    const pages = pagesWords(r);
    return `<li class="cs-card${picked ? " on" : ""}${paused ? " paused" : ""}" data-cs-card="${r.id}">
      <button type="button" class="cs-card-pick" data-cs-pick="${r.id}" data-cs-pick-host="${esc(r.host)}" aria-pressed="${picked}"${S.slim ? ` data-tip="${attr(fill(picked ? "Showing only {rival}: show all competitors" : "Show only {rival}'s changes", { rival: name }))}"` : ""} aria-label="${attr(fill(picked ? "Showing only {rival}: show all competitors" : "Show only {rival}", { rival: name }))}"></button>
      <div class="cs-card-top">
        <span class="cs-card-logo">${UI.siteLogo(r.host, 32)}</span>
        <span class="cs-card-id"><span class="cs-card-name" dir="auto">${esc(name)}</span><span class="cs-card-host" dir="auto">${esc(r.display || r.host)}</span></span>
        ${all || !l ? "" : menuButton(r)}
      </div>
      ${about ? `<p class="cs-card-about" dir="auto">${esc(about)}</p>` : ""}
      <div class="cs-card-counts">${cardCounts(r, edits, paused)}${pages ? `<span class="cs-card-pages sec">${esc(pages)}</span>` : ""}</div>
      ${all ? `<span class="cs-sites">${r.sites.map((x) => siteChip(r, x)).join("")}</span>` : ""}
      ${lead || site ? `<div class="cs-card-foot">${lead}${site ? `<button type="button" class="link-btn cs-card-open" data-cs-open="${r.id}" data-cs-site="${site.id}" aria-label="${attr(fill("Open {rival}", { rival: name }))}">${esc(t("Open"))}${UI.icon("arrow-right")}</button>` : ""}</div>` : ""}
      ${S.slim && site ? railOpen(r, site, name) : ""}
    </li>`;
  }
  /* My own site first, the same counts, so they compare. Its edits open in the side panel (they aren't in Changes). */
  function youCard(m) {
    const { name, rest } = cardName(m);
    const about = [rest, m.about?.description].filter(Boolean).join(". ");
    const edits = m.edited_30d ?? m.edits_30d ?? 0;
    const counts = m.crawl?.status === "blocked" || !m.crawl?.baseline_done ? youEditsWords(m) : cardCounts({ ...m, crawl: m.crawl }, edits, false);
    const pages = pagesWords(m);
    return `<li class="cs-card cs-card-you" data-cs-you="${esc(m.id)}"${S.slim ? ` data-tip="${esc(`${t("Your site")}: ${name}`)}" tabindex="0"` : ""}>
      <div class="cs-card-top">
        <span class="cs-card-logo">${UI.siteLogo(m.host, 32)}</span>
        <span class="cs-card-id"><span class="cs-card-name" dir="auto">${esc(name)}</span><span class="cs-card-host">${COMP.who("you", null, t("Your site"))}<span dir="auto">${esc(m.display || m.host)}</span></span></span>
      </div>
      ${about ? `<p class="cs-card-about" dir="auto">${esc(about)}</p>` : ""}
      <div class="cs-card-counts">${counts}${pages ? `<span class="cs-card-pages sec">${esc(pages)}</span>` : ""}</div>
      ${m.recent_edits?.length ? `<div class="cs-card-foot"><button type="button" class="link-btn cs-card-open" data-cs-you-edits="${esc(m.id)}">${t("See your edits")}${UI.icon("arrow-right")}</button></div>` : ""}
    </li>`;
  }
  function cardsList() {
    const every = orderedRivals().filter(matches);
    if (S.find && !every.length) return `<div class="empty cs-find-none"><p>${esc(fill("No competitor matches “{text}”.", { text: S.find }))}</p><button type="button" class="btn btn-small" data-cs-find-clear>${t("Show all")}</button></div>`;
    const mine = S.find ? [] : S.data.rivals?.mine || [];
    return `<ul class="cs-cards" aria-label="${attr("Competitors")}">${mine.map(youCard).join("")}${every.map(rivalCard).join("")}</ul>`;
  }
  /* A card pressed: Changes and They beat you on show only that competitor. Pressed again, or Show all: everyone. */
  function pickRival(id, host) {
    const again = S.mvRival === String(id);
    S.mvRival = again ? "" : String(id);
    S.kwRival = again ? "" : host || "";
    TP.reset(PAGES.moves); TP.reset(PAGES.keywords);
    paintSection("moves"); paintSection("keywords");
    const box = UI.$("#cs-rivals-list");
    if (box) UI.setHTML(box, cardsList());
    UI.$(`[data-cs-pick="${id}"]`)?.focus({ preventScroll: true });
    if (window.matchMedia?.("(max-width: 900px)").matches) UI.$("#cs-lower")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // ---- 2. Which keywords do they beat me on? --------------------------------------------------------
  /* Each competitor is compared with the sites it's linked to, which isn't always the site doing best overall. */
  function aheadChip(k, a) {
    const name = a.display || a.host;
    const other = a.my_host && a.my_host !== k.my_best?.host ? ` · ${fill("ahead of {site}, {position}", { site: a.my_host, position: `#${a.my_position}` })}` : "";
    const says = `${name} #${a.position}${other}`;
    const site = (COMP.sites || []).find((x) => x.host === (a.my_host || k.my_best?.host || k.my_sites?.[0]));
    return `<li><button type="button" class="cs-ahead-logo" data-cs-open="${esc(a.id)}"${site ? ` data-cs-site="${esc(site.id)}"` : ""} data-tip="${esc(says)}" aria-label="${esc(says)}">${UI.siteLogo(a.host, 20)}<b class="tabular">#${a.position}</b></button></li>`;
  }

  function keywordFind(k) {
    const host = k.my_best?.host || k.my_sites[0];
    const who = k.rivals_ahead.map((a) => a.host);
    return { title: `${t("Competitors ahead on")} ${k.keyword}`, host, keywords: [k.keyword], rivals: who, source: { type: "competitor", label: k.keyword, host, facts: [engineName(k.engine), k.tool, ...who.slice(0, 3)].filter(Boolean), link: "#competitors/summary", key: `summary|keyword|${k.keyword_id}` } };
  }

  /* What changed last, in words. Up and down are status, so they get a colour, an icon and a word. */
  function moveCell(k) {
    const move = k.my_move, now = k.my_best?.position ?? null;
    if (!move) return `<span class="muted">${t("First check")}</span>`;
    const when = esc(COMP.ago(move.at));
    if (!move.changed) return `<span class="sec">${t("No change")}</span><span class="second">${esc(t("Since"))} ${when}</span>`;
    const badge = (up, words) => `<span class="cp-verdict ${up ? "good" : "crit"}">${UI.icon(up ? "arrow-up" : "arrow-down")}<span>${esc(words)}</span></span>`;
    const was = move.was === null ? `>${UI.num(k.depth)}` : `#${UI.num(move.was)}`;
    const line = `<span class="second">${esc(fill(t("was {place}"), { place: was }))} · ${when}</span>`;
    if (move.was === null) return `${badge(true, t("Now in the results"))}${line}`;
    if (now === null) return `${badge(false, t("Out of the results"))}${line}`;
    const places = Math.abs(move.was - now);
    return `${badge(move.was > now, fill(t(move.was > now ? "Up {n}" : "Down {n}"), { n: UI.num(places) }))}${line}`;
  }

  /* Collapsing one competitor would take a line to hide a line, so a list only folds when that saves at least two. */
    /* Who's ahead: each competitor as its logo and place, all in a row; a click opens its profile (2026-11-12: "only
     competitors' logos, no name, and make the logo clickable"). The name, and on another site of yours its place there, on hover. */
  function aheadCell(k) {
    return `<ul class="cs-ahead">${k.rivals_ahead.map((a) => aheadChip(k, a)).join("")}</ul>`;
  }

  /* Four columns: the keyword (with where and when it was checked), your place and its last move, who's ahead, a task. */
  /* Where a keyword was checked. When every row shown says the same, with the same age, it's said once under the table. */
  const whereChecked = (k) => `${k.country} · ${engineName(k.engine)} · ${k.tool}`;
  /* …as drawn: the country, then the engine and tool as logos (2026-11-11). */
  const whereHtml = (k) => `${k.country ? `${UI.flag(k.country)} ` : ""}${COMP.toolLogos(k.engine, k.tool)}`;
  const sameCheck = (rows) => rows.length > 1 && new Set(rows.map((k) => `${whereChecked(k)}|${COMP.ago(k.checked_at)}`)).size === 1;
  function keywordRow(k, once = false) {
    const many = S.site === COMP.ALL && k.my_best?.host;
    return `<tr${simple() ? ` data-cs-kw="${esc(k.keyword_id)}" class="cs-kw-row"` : ""}>
      <td class="head-cell"><span class="kw mono">${KeywordLink.html(k.keyword, { id: k.keyword_id, host: k.my_best?.host || k.my_sites?.[0] })}</span>${once ? "" : `<span class="second cs-where">${whereHtml(k)} ${COMP.ageCell(k.checked_at)}</span>`}</td>
      <td class="c cs-my-place" data-label="${attr("Your position")}"><div>${COMP.pos(k.my_best?.position, k.depth)}${many ? `<span class="second mono" dir="auto">${esc(k.my_best.host)}</span>` : ""}<span class="cs-move">${moveCell(k)}</span></div></td>
      <td data-label="${attr("Ahead of you")}"><div>${aheadCell(k)}</div></td>
      <td class="r nowrap" data-label="">${simple() ? `<span class="row-act">${UI.taskButton(keywordFind(k), { label: "Task" })}</span>` : UI.taskButton(keywordFind(k), { label: "Task" })}</td>
    </tr>`;
  }

  function keywordsHtml() {
    const title = "Keywords they beat you on";
    if (S.errors.keywords) return failedCard("keywords", title);
    const d = S.data.keywords;
    if (!d) return loadingCard(title);
    // None is On: nothing is compared, so this isn't "nobody beats you". The switch is in the table above, so no button here.
    if (!d.total && d.coverage.checked && noneOn()) return `${sectionHead(title)}${COMP.empty(t("None tracked for keywords"), t("Set a competitor to On above to see where they beat you."))}`;
    if (!d.total) {
      const noChecks = !d.coverage.checked;
      // The banner at the top says what's missing and where to go; this box only says what will show here.
      const words = noChecks ? t("Positions appear after your keywords' first check. Viewing never spends one.") : t("No competitor beats you on any keyword checked.");
      return `${sectionHead(title)}${COMP.empty(t(noChecks ? "No ranking check yet" : "Nothing here"), words)}`;
    }
    // A search, and one competitor or all of them together, each choice saying how many keywords it holds.
    const searched = d.keywords.filter((k) => TP.matches(PAGES.keywords, k.keyword));
    const rivals = [...new Map(d.keywords.flatMap((k) => k.rivals_ahead).map((a) => [a.host, a])).values()].sort((a, b) => String(a.display || a.host).localeCompare(String(b.display || b.host)));
    if (S.kwRival && !rivals.some((a) => a.host === S.kwRival)) S.kwRival = "";
    const countFor = (host) => searched.filter((k) => k.rivals_ahead.some((a) => a.host === host)).length;
    const picked = S.kwRival ? searched.filter((k) => k.rivals_ahead.some((a) => a.host === S.kwRival)) : searched;
    const shown = sortList(picked, KW_SORTS[S.kwSort?.key] || (() => 0), S.kwSort), page = TP.view(PAGES.keywords, shown), rows = page.rows;
    const search = d.keywords.length >= FIND_FROM || TP.state(PAGES.keywords).q ? TP.search(PAGES.keywords, t("Search keywords")) : "";
    const choose = rivals.length > 1 ? `<label class="field"><span>${t("Competitor")}</span><select class="select" id="cs-kw-rival">
        <option value="">${t("All competitors")} (${UI.num(searched.length)})</option>
        ${rivals.map((a) => `<option value="${esc(a.host)}" ${a.host === S.kwRival ? "selected" : ""}>${esc(a.display || a.host)} (${UI.num(countFor(a.host))})</option>`).join("")}
      </select></label>` : "";
    const tools = simple() ? `<div class="cp-tools cs-tools cs-panel-tools">${search}${choose}<span class="cs-tools-end" data-tt-slot></span></div>` : search || choose ? `<div class="cp-tools cs-tools">${search}${choose}</div>` : "";
    const head = `${sectionHead(title, t("Most competitors ahead first."), "A keyword counts once across your sites. Where and when it was checked shows under it, or once under the table.")}${tools}`;
    if (!shown.length) return `${head}${TP.state(PAGES.keywords).q ? noneFound(t("No keyword matches."), PAGES.keywords) : COMP.empty(t("Nothing matches these filters"), t("Pick another competitor."))}`;
    const once = sameCheck(rows);
    const checkedOnce = once ? `<p class="small sec cs-kw-foot">${fillHtml("All checked with {tool}, {when}.", { tool: whereHtml(rows[0]), when: esc(COMP.ago(rows[0].checked_at)) })}</p>` : "";
    const capped = d.total > d.keywords.length ? fill("{sent} of {total}, most competitors ahead first", { sent: UI.num(d.keywords.length), total: UI.num(d.total) }) : null;
    const kwHead = (key, label, cls = "") => sortButtonHead("data-cs-kw-sort", key, label, S.kwSort, cls);
    return `${head}
      <div class="cs-pages"><div class="table-wrap"><table class="data" id="cs-keywords-table">
        <thead><tr>${kwHead("keyword", "Keyword")}${kwHead("position", "Your position", "c")}${kwHead("ahead", "Ahead of you")}<th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead>
        <tbody>${rows.map((k) => keywordRow(k, once)).join("")}</tbody>
      </table></div>${TP.footer(PAGES.keywords, page, { noun: t("keywords"), capped })}</div>${checkedOnce}`;
  }
  /* Your position: the best first. Ahead of you: the most competitors first. Not in the results always goes last. */
  const KW_SORTS = { keyword: (k) => k.keyword, position: (k) => k.my_best?.position ?? null, ahead: (k) => k.rivals_ahead.length };
  const KW_FIRST = { keyword: "up", position: "up", ahead: "down" };

  // ---- 3. Who is moving right now? ------------------------------------------------------------------
  function movesNote(d) {
    const names = (hosts) => hosts.slice(0, 3).join(", ") + (hosts.length > 3 ? ` ${fill("and {n} more", { n: UI.num(hosts.length - 3) })}` : "");
    if (simple()) {
      const notes = [
        d.blocked.length ? fill("Page changes can't be tracked for {hosts}: they don't allow automated visitors, so no change here doesn't mean nothing changed.", { hosts: names(d.blocked) }) : "",
        d.not_started.length ? `${fill("Not watched yet: {hosts}.", { hosts: names(d.not_started) })} ${t("The first read only sets a starting point.")}` : "",
      ].filter(Boolean);
      return notes.length ? `<p class="small sec cs-moves-note">${d.blocked.length ? UI.status("warn", fill("{n} not watched", { n: UI.num(d.blocked.length + d.not_started.length) })) : esc(fill("{n} not watched", { n: UI.num(d.blocked.length + d.not_started.length) }))}${UI.info(notes)}</p>` : "";
    }
    return [
      d.blocked.length ? `<p class="help">${UI.icon("triangle-alert")} ${esc(fill("Can't see page changes for {hosts}: they block bots.", { hosts: names(d.blocked) }))}${UI.tip("Page changes can't be tracked for {hosts}: they don't allow automated visitors, so no change here doesn't mean nothing changed.", { hosts: names(d.blocked) })}</p>` : "",
      d.not_started.length ? `<p class="help">${esc(fill("Not watched yet: {hosts}.", { hosts: names(d.not_started) }))}${UI.tip("The first read only sets a starting point.")}</p>` : "",
    ].join("");
  }

  /* Every competitor's moves together, or one competitor's, one kind of change, a period and a search (2026-11-10: "for each
     website and collective, as much data as possible"). Each row carries all that's known about its page or check (comp-list.js). */
  const PERIODS = [7, 30, 90, 365];
  const moveText = (e) => [e.keyword, e.url, e.title, e.page?.title, e.page?.description, ...(e.page?.h1 || []), e.rival.host, e.rival.display, e.before, e.after].filter(Boolean).join(" ");
  function movesTools(d, inKind) {
    const filters = COMP.TIMELINE_FILTERS || [["all", "All", null]];
    const ofKind = (f, list) => (f[2] ? list.filter((e) => f[2].includes(e.kind)) : list);
    const forRival = (list) => (S.mvRival ? list.filter((e) => String(e.rival.id) === S.mvRival) : list);
    const searched = d.moves.filter((e) => TP.matches(PAGES.moves, moveText(e)));
    const chips = `<div class="chips" role="group" aria-label="${attr("Filter the changes")}">${filters.filter((f) => f[0] === "all" || f[0] === S.mvKind || ofKind(f, forRival(searched)).length).map((f) => `<button type="button" class="chip" data-cs-mv-kind="${f[0]}" aria-pressed="${S.mvKind === f[0]}">${esc(t(f[1]).split("|")[0])}<b>${UI.num(ofKind(f, forRival(searched)).length)}</b></button>`).join("")}</div>`;
    const rivals = [...new Map(d.moves.map((e) => [String(e.rival.id), e.rival])).values()].sort((a, b) => String(a.display || a.host).localeCompare(String(b.display || b.host)));
    if (S.mvRival && !rivals.some((r) => String(r.id) === S.mvRival)) S.mvRival = "";
    const choose = rivals.length > 1 ? `<label class="field"><span>${t("Competitor")}</span><select class="select" id="cs-mv-rival">
        <option value="">${t("All competitors")} (${UI.num(inKind(searched).length)})</option>
        ${rivals.map((r) => `<option value="${esc(r.id)}" ${String(r.id) === S.mvRival ? "selected" : ""}>${esc(r.display || r.host)} (${UI.num(inKind(searched).filter((e) => e.rival.id === r.id).length)})</option>`).join("")}
      </select></label>` : "";
    const period = `<label class="field"><span>${t("Period")}</span><select class="select" id="cs-mv-days">${PERIODS.map((n) => `<option value="${n}" ${n === S.mvDays ? "selected" : ""}>${esc(fill(n === 365 ? "Past year" : "Past {n} days", { n: UI.num(n) }))}</option>`).join("")}</select></label>`;
    return `<div class="cp-tools cs-tools">${TP.search(PAGES.moves, t("Search pages, keywords, titles"))}${choose}${period}</div>${chips}`;
  }

  /* 2026-11-12, the owner: "a normal table, I can select items from it, with pages". One table row per change, the same row
     as a competitor's own timeline plus a Competitor column (COMP.timelineTableRow, comp-list.js). table-tools.js gives it
     tick boxes (Add a note), Filter and sorting across every page, since the rows are drawn with page.rows.map. */
  const moveRow = (e, common) => COMP.timelineTableRow(e, { id: e.rival.id, rival: e.rival.host, display: e.rival.display, own: e.rival.sites[0]?.host }, common);
  /* The cards screen's Changes (2026-11-16): one head line with the count, the kind of change and the period as buttons,
     as in the owner's screenshot. The competitor is picked on its card, so there's no competitor list here, only a chip
     that says who is shown and takes it off. Rows say whose page it is under the page, so there's no Competitor column. */
  const BENCH_KINDS = [["all", "All"], ["new", "Added"], ["edits", "Edited|pages"], ["gone", "Removed|pages"], ["rank", "Rankings"], ["ai", "AI Overview"]];
  const BENCH_DAYS = [[7, "7 days"], [30, "30 days"], [90, "3 months"], [365, "1 year"]];
  /* One row per competitor page (2026-11-20, the owner: "too much data is hard", "think as a human"). A page they rewrote,
     retitled and that then moved up on two keywords is one story, not five rows; a competitor cited by AI on three
     keywords with the same page is one row. The row leads with the change that weighs most. */
  const LEAD = ["new_page", "page_gone", "redirect", "content", "title", "h1", "headings", "search_title", "rank_new", "rank_lost", "rank_up", "rank_down", "ai_cited", "ai_dropped", "canonical", "robots", "meta", "schema"];
  const leadRank = (e) => { const i = LEAD.indexOf(e.kind); return (i < 0 ? LEAD.length : i) + (e.minor ? LEAD.length : 0); };
  const isMoveKind = (e) => e.kind.startsWith("rank_") || e.kind.startsWith("ai_");
  const pageKey = (url) => String(url || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  /* A page that enters and leaves the top 10 five times in a month has not moved: per keyword, only where it started the
     period and where it is now counts (2026-11-20, real data: one page, 57 moves, most of them the same keywords flipping).
     OUT stands for "not in the results checked". */
  const OUT = 1000;
  function netMoves(all) {
    const by = new Map();
    all.filter((e) => e.kind.startsWith("rank_")).forEach((e) => { const k = `${e.keyword_id ?? e.keyword}|${e.country || ""}|${e.engine || ""}`; if (!by.has(k)) by.set(k, []); by.get(k).push(e); });
    return [...by.values()].map((list) => {
      const last = list[0], first = list[list.length - 1]; // the list comes newest first
      const from = first.kind === "rank_new" ? OUT : first.from, to = last.kind === "rank_lost" ? OUT : last.to;
      // Me beside them now, from the same check as their latest position: who is higher on this keyword.
      const mine = last.mine?.position ?? OUT;
      return { e: last, from, to, mine, side: mine === OUT && to === OUT ? 0 : mine < to ? 1 : -1, dir: from === to ? 0 : to < from ? 1 : -1, size: Math.abs(from - to), flips: list.length };
    });
  }
  function storiesOf(events) {
    const groups = new Map();
    events.forEach((e) => {
      // A move with no page named (an AI Overview citation) joins the competitor's others of that kind: "cited on 3 keywords".
      const key = `${e.rival.id}|${e.url ? `u:${pageKey(e.url)}` : `k:${e.kind}`}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });
    return [...groups.entries()].map(([key, all]) => {
      const lead = all.reduce((best, e) => (leadRank(e) < leadRank(best) ? e : best), all[0]);
      const mine = (all.find((e) => e.my_page?.pair_id) || [...all].filter((e) => e.my_page).sort((a, b) => (b.my_page.clicks ?? -1) - (a.my_page.clicks ?? -1))[0])?.my_page || null;
      const pageEdit = all.find((e) => !isMoveKind(e));
      const nets = netMoves(all), ups = nets.filter((n) => n.dir > 0).length, downs = nets.filter((n) => n.dir < 0).length;
      return { key, all, lead, rival: lead.rival, at: all[0].at, mine, ups, downs, nets, ahead: nets.filter((n) => n.side > 0).length, behind: nets.filter((n) => n.side < 0).length, minor: all.every((e) => e.minor), words: Math.max(0, ...all.map((e) => (e.kind === "new_page" ? e.page?.words : e.changed_words) || 0)), title: COMP.readable(pageEdit?.page?.title) || COMP.readable(all.find((e) => e.title)?.title) };
    });
  }
  /* What my page brings first; then a page they edited before one that only moved; then the most text changed, the most keywords moved, the newest. */
  const edited = (s) => (s.all.some((e) => !isMoveKind(e)) ? 1 : 0);
  const byWeight = (a, b) => (b.mine?.clicks ?? -1) - (a.mine?.clicks ?? -1) || edited(b) - edited(a) || b.words - a.words || b.behind - a.behind || (b.ups + b.downs) - (a.ups + a.downs) || (a.at < b.at ? 1 : -1);
  /* The reader's own order inside each group, from one plain list over the table (2026-11-20, the owner: sorting and
     filtering by column arrows and a Filter box was "very hard"). The groups, my pages by their clicks, stay as they are. */
  const byDate = (a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);
  const MV_KEYS = { keywords: (s) => s.nets.length, up: (s) => s.ups, down: (s) => s.downs, behind: (s) => s.behind, ahead: (s) => s.ahead };
  /* A heading is the sort (2026-11-20): pressed once, the biggest first; again, the smallest first. "behind" with the
     biggest first is the opening order, which also puts an edited page before one that only moved. Rows are sorted
     inside their group, so my pages stay where they are. */
  function sorterOf(id, dir) {
    if (id === "seen") return (a, b) => byDate(a, b) * dir;
    if (id === "behind" && dir === 1) return byWeight;
    const get = MV_KEYS[id] || MV_KEYS.behind;
    return (a, b) => (get(b) - get(a)) * dir || byDate(a, b);
  }
  const byNews = (a, b) => (leadRank(a.lead) < 2 ? 0 : 1) - (leadRank(b.lead) < 2 ? 0 : 1) || b.words - a.words || (a.at < b.at ? 1 : -1); // new and removed pages, the longest first
  /* The page reads by my pages (2026-11-20, "think about the full page"): every competitor page beside my home page sits
     under one line that names my page and says once what it brings, instead of repeating it on each row. My pages come
     by their clicks; then what competitors did elsewhere, and small edits, both folded. */
  const myName = (url) => (COMP.changePath(url) === "/" ? t("Home page") : COMP.changePath(url));
  function storySections(stories, maxClicks) {
    const mine = new Map();
    stories.filter((s) => s.mine && !s.minor).forEach((s) => { const k = pageKey(s.mine.url); if (!mine.has(k)) mine.set(k, { page: s.mine, rows: [] }); mine.get(k).rows.push(s); });
    const pages = [...mine.entries()].sort((a, b) => (b[1].page.clicks ?? -1) - (a[1].page.clicks ?? -1) || b[1].rows.length - a[1].rows.length);
    const order = sorterOf(S.mvSort, S.mvDir);
    const small = stories.filter((s) => s.mine && s.minor).sort(order);
    const other = stories.filter((s) => !s.mine).sort(S.mvSort === "behind" && S.mvDir === 1 ? byNews : order);
    /* A group's line says where I stand on that page of mine across every row under it, so the folded list of my pages
       reads as a summary on its own. */
    const stand = (rows) => { const b = rows.reduce((n, r) => n + r.behind, 0), a = rows.reduce((n, r) => n + r.ahead, 0); return b + a ? `<span class="cs-group-stand">${b ? `<span class="rd-down">${esc(fill("Behind on {n}", { n: UI.num(b) }))}</span>` : ""}${a ? `<span class="rd-up">${esc(fill("Ahead on {n}", { n: UI.num(a) }))}</span>` : ""}</span>` : ""; };
    const worth = (m) => (m.clicks === null || m.clicks === undefined ? "" : `${RD.bar(m.clicks, maxClicks)}<span><span class="rd-num">${UI.num(m.clicks)}</span> ${esc(t(m.clicks === 1 ? "click" : "clicks"))}</span>${RD.delta(m.clicks, m.clicks_before) || '<span class="rd-delta"></span>'}`);
    return [
      ...pages.map(([k, g]) => ({ id: `p:${k}`, label: fill("Beside your {page}", { page: myName(g.page.url) }), rows: g.rows.sort(order), extra: `<span class="cs-group-worth">${worth(g.page)}</span><a class="icon-btn cs-group-open" href="#pages?page=${encodeURIComponent(g.page.url)}" aria-label="${attr("Open your page")}" data-tip="${attr("Open your page")}">${UI.icon("external-link")}</a>` })),
      { id: "other", label: "On their other pages", rows: other, folded: pages.length > 0 },
      { id: "small", label: "Small edits", rows: small, folded: true },
    ];
  }
  /* Why the row matters to me, as its own column so it can be read down and sorted: my page beside theirs and the Google
     clicks it brings, with a bar against the biggest page on show. No page of mine beside theirs: a quiet dash. */
  function mineCell(story) {
    const label = attr("You vs them");
    if (!(story.ahead + story.behind)) return `<td class="cs-mine" data-label="${label}" data-sort="-1">${RD.quiet()}</td>`;
    const one = story.nets.length === 1;
    return `<td class="cs-mine" data-label="${label}" data-sort="${story.behind}"><span class="cs-mine-sides">${story.behind ? `<span class="rd-down">${esc(fill(one ? "They're ahead" : "Behind on {n}", { n: UI.num(story.behind) }))}</span>` : ""}${story.ahead ? `<span class="rd-up">${esc(fill(one ? "You're ahead" : "Ahead on {n}", { n: UI.num(story.ahead) }))}</span>` : ""}</span></td>`;
  }
  /* What they did, the heaviest first: three lines at most, the rest behind Details. */
  const placeOf = (n, e) => (n === OUT ? `>${UI.num(e.depth || 10)}` : `#${UI.num(n)}`);
  /* Their move on one keyword over the period, coloured by its direction; no move is one grey position. */
  const netMove = (n) => (n.dir
    ? `<span class="cs-net-move tabular rd-${n.dir > 0 ? "up" : "down"}"><span class="cs-net-from">${esc(placeOf(n.from, n.e))}</span>${UI.icon("arrow-right")}<b>${esc(placeOf(n.to, n.e))}</b></span>`
    : `<span class="cs-net-move tabular cs-net-same">${esc(placeOf(n.to, n.e))}</span>`);
  /* Details of a page's ranking moves: one line per keyword, the biggest move first, me beside them. */
  function netTable(story, common) {
    const rows = [...story.nets].sort((a, b) => (b.dir ? 1 : 0) - (a.dir ? 1 : 0) || b.size - a.size);
    const line = (n) => `<tr class="${n.dir ? "" : "cs-net-quiet"}"><td class="cs-net-kw" dir="auto">${window.KeywordLink ? KeywordLink.html(n.e.keyword || "", { id: n.e.keyword_id, host: story.rival.sites[0]?.host }) : esc(n.e.keyword || "")}</td><td>${netMove(n)}</td><td class="tabular cs-net-mine${n.side > 0 ? " cs-net-won" : ""}">${n.e.mine ? esc(placeOf(n.mine, n.e)) : RD.quiet()}</td></tr>`;
    return `<table class="cs-net" data-tt-off><thead><tr><th scope="col">${esc(t("Keyword"))}</th><th scope="col">${esc(t("Them"))}</th><th scope="col">${esc(t("You"))}</th></tr></thead><tbody>${rows.map(line).join("")}</tbody></table>
      <p class="cs-net-note">${esc(fill("From the start of the period to now. {n} moves seen in all.", { n: UI.num(story.all.filter((e) => e.kind.startsWith("rank_")).length) }))}</p>`;
  }
  const moveSize = (e) => (e.kind === "rank_new" || e.kind === "rank_lost" ? 1000 : Math.abs((e.from || 0) - (e.to || 0)));
  function storyShort(story) {
    const order = [...story.all].sort((a, b) => leadRank(a) - leadRank(b) || moveSize(b) - moveSize(a));
    /* A page with ranking moves: how many keywords ended higher and how many lower as two marks, then its two biggest
       moves, one line each: the keyword cut to fit on the left, the move on the right. The rest is counted, quietly. */
    if (story.nets.length > 1) {
      const edits = order.filter((e) => !isMoveKind(e)).slice(0, 2);
      const moved = story.nets.filter((n) => n.dir).sort((a, b) => b.size - a.size), same = story.nets.length - moved.length;
      const tally = moved.length ? `<span class="cs-story-tally">${story.ups ? `<span class="cs-tally cs-tally-up">${UI.icon("arrow-up")}${esc(fill("{n} up", { n: UI.num(story.ups) }))}</span>` : ""}${story.downs ? `<span class="cs-tally cs-tally-down">${UI.icon("arrow-down")}${esc(fill("{n} down", { n: UI.num(story.downs) }))}</span>` : ""}</span>` : "";
      const kw = (n) => `<span class="cs-story-line"><span class="cs-story-kw" dir="auto" title="${esc(n.e.keyword || "")}">${esc(n.e.keyword || "")}</span>${netMove(n)}</span>`;
      const rest = moved.length - Math.min(2, moved.length);
      const quiet = [rest > 0 ? fill("+{n} more", { n: UI.num(rest) }) : "", same ? fill("{n} unchanged", { n: UI.num(same) }) : ""].filter(Boolean).join(" · ");
      return edits.map((e) => `<span class="cl-tl-short">${esc(COMP.changeShort(e))}</span>`).join("") + tally + `<span class="cs-story-lines">${moved.slice(0, 2).map(kw).join("")}</span>` + (quiet ? `<span class="cs-story-more">${esc(quiet)}</span>` : "");
    }
    const sameMove = order.every((e) => e.kind === order[0].kind) && isMoveKind(order[0]); // the Change cell already says it: only the keywords differ
    const keyword = (e) => `<span class="kw cs-story-kw" dir="auto">${window.KeywordLink ? KeywordLink.html(e.keyword || "", { id: e.keyword_id, host: story.rival.sites[0]?.host }) : esc(e.keyword || "")}</span>`;
    const line = (e) => `<span class="cl-tl-short">${isMoveKind(e) ? `${keyword(e)}${sameMove && e.kind.startsWith("ai_") ? "" : ` ${esc(COMP.changeShort(e))}`}` : esc(COMP.changeShort(e))}</span>`;
    const more = order.length > 3 ? `<span class="cl-tl-short cs-story-more">${esc(fill("+{n} more", { n: UI.num(order.length - 3) }))}</span>` : "";
    return order.slice(0, 3).map(line).join("") + more;
  }
  /* One line per competitor page (2026-11-20, the owner on the first build: "this ui ux is like shit"; rows were five
     lines tall with pills, tallies and links all at once). A row now says four things on one line: whose page, what
     happened, where I stand beside it, and when. Everything else opens under the row when it is pressed. No kind pill:
     "Rankings" on every row said nothing; the words in What happened say the kind. */
  const EDIT_WORDS = { title: "title", h1: "main heading", headings: "subheadings", meta: "description", schema: "structured data", canonical: "canonical", robots: "indexing", search_title: "search title" };
  /* What happened, in a word or two (2026-11-20, the owner: "too much data for a human to understand easily", after a
     version with five number columns). A row says the kind of thing that happened; every count is under the row. */
  function whatLine(story) {
    const kinds = new Set(story.all.map((e) => e.kind)), bits = [];
    const say = (words, icon, tone) => bits.push(`<span class="cs-what-main${tone ? ` cs-what-${tone}` : ""}">${icon ? UI.icon(icon) : ""}${esc(t(words))}</span>`);
    // The newest of added, removed and moved says what the address is now: a page first found this week that then moved
    // to another address reads as moved, with where it went (the events come newest first).
    const life = story.all.find((e) => e.kind === "new_page" || e.kind === "page_gone" || e.kind === "redirect");
    if (life?.kind === "redirect") bits.push(`<span class="cs-what-main">${esc(t("Moved to another address"))}${life.after ? ` <span class="cs-what-to" dir="auto">→ ${esc(COMP.changePath(life.after))}</span>` : ""}</span>`);
    else if (life?.kind === "new_page") say("New page");
    else if (life?.kind === "page_gone") say("Page removed");
    else if (kinds.has("content")) say(story.all.some((e) => e.kind === "content" && !e.minor) ? "Text rewritten" : "Small text edit");
    else { const k = [...kinds].find((x) => EDIT_WORDS[x]); if (k) bits.push(`<span class="cs-what-main">${esc(fill("New {list}", { list: t(EDIT_WORDS[k]) }))}</span>`); }
    const net = story.ups - story.downs;
    if (story.nets.length) say(net > 0 ? "Rising" : net < 0 ? "Falling" : "Steady", net > 0 ? "arrow-up" : net < 0 ? "arrow-down" : "", net === 0 ? "quiet" : "");
    if (story.all.some((e) => e.kind === "ai_cited")) say("Cited by AI", "sparkles");
    else if (story.all.some((e) => e.kind === "ai_dropped")) say("Dropped by AI", "sparkles");
    return bits.slice(0, 2).join('<span class="cs-what-sep" aria-hidden="true"></span>');
  }
  /* Me beside them on this row's keywords: a two-part bar (behind, ahead) and the two counts. Nothing to compare: quiet. */
  function versus(story) {
    const b = story.behind, all = story.behind + story.ahead;
    if (!all) return RD.quiet();
    if (!b) return `<span class="cs-vs-none">${esc(t("None"))}</span>`;
    return `<span class="cs-vs"><span class="cs-vs-n"><b class="tabular">${UI.num(b)}</b> ${esc(fill("of {n}", { n: UI.num(all) }))}</span><span class="cs-vs-bar" aria-hidden="true"><i style="width:${Math.max(6, Math.round((b / all) * 100))}%"></i></span></span>`;
  }
  /* A number in its own column, right-aligned, with a small bar against the biggest value on show: a column can be read
     down and compared without reading a word. Zero is a quiet dash. */
  function numCellHtml(cls, label, n, max, tone) {
    return `<td class="cs-num ${cls}" data-label="${attr(label)}" data-sort="${n}">${n ? `<span class="cs-num-n${tone ? ` rd-${tone}` : ""}">${UI.num(n)}</span>${RD.bar(n, max, { tone: tone || "muted" })}` : RD.quiet()}</td>`;
  }
  const MV_COLS = [["keywords", "Keywords", (s) => s.nets.length, ""], ["up", "Up", (s) => s.ups, "up"], ["down", "Down", (s) => s.downs, "down"], ["behind", "Behind", (s) => s.behind, "down"], ["ahead", "Ahead", (s) => s.ahead, "up"]];
  function storyDetail(story, common) {
    const who = { id: story.rival.id, rival: story.rival.host, display: story.rival.display, own: story.rival.sites[0]?.host };
    const edits = story.all.filter((e) => !isMoveKind(e));
    const ai = story.all.filter((e) => e.kind.startsWith("ai_"));
    const page = edits.find((e) => e.page)?.page;
    const url = story.lead.url || story.all.find((e) => e.url)?.url;
    return `<div class="cs-detail-box">
      ${edits.map((e) => COMP.changePart(e, common)).join("")}
      ${story.nets.length ? `<p class="cs-detail-sum">${[story.ups ? `<span class="rd-up">${esc(fill("{n} up", { n: UI.num(story.ups) }))}</span>` : "", story.downs ? `<span class="rd-down">${esc(fill("{n} down", { n: UI.num(story.downs) }))}</span>` : "", story.nets.length - story.ups - story.downs ? `<span>${esc(fill("{n} unchanged", { n: UI.num(story.nets.length - story.ups - story.downs) }))}</span>` : ""].filter(Boolean).join("")}<span class="cs-detail-when">${esc(fill("Last seen {when}", { when: COMP.ago(story.at) }))}</span></p>${netTable(story, common)}` : ""}
      ${ai.length ? `<ul class="cs-detail-ai">${ai.map((e) => `<li><span class="${e.kind === "ai_cited" ? "rd-up" : "rd-down"}">${esc(t(e.kind === "ai_cited" ? "Cited by AI" : "Dropped by AI"))}</span> <span dir="auto">${window.KeywordLink ? KeywordLink.html(e.keyword || "", { id: e.keyword_id, host: who.own }) : esc(e.keyword || "")}</span> <span class="cs-what-sub">${esc(UI.fmtDateOnly(e.at))}</span></li>`).join("")}</ul>` : ""}
      ${page ? `<details class="cl-more-facts cs-detail-facts"><summary>${UI.icon("chevron-right")}${esc(t("Everything about their page"))}</summary>${COMP.pageFacts(page)}</details>` : ""}
      <div class="cs-detail-foot">${COMP.changeTask(story.lead, who)}${url ? COMP.link(url, t("Open their page"), "cs-detail-open") : ""}</div>
    </div>`;
  }
  function storyRow(story, common, maxes) {
    const open = S.mvOpen.has(story.key), rival = story.rival;
    const url = story.lead.url || story.all.find((e) => e.url)?.url;
    const path = url ? COMP.changePath(url) : "";
    const keywords = new Set(story.all.map((e) => e.keyword).filter(Boolean)).size;
    const name = url ? COMP.link(url, story.title || path, "cs-line-title") : `<span class="cs-line-title">${esc(fill(keywords === 1 ? "{n} keyword" : "{n} keywords", { n: UI.num(keywords) }))}</span>`;
    const label = attr("Details");
    return `<tr class="cs-line${open ? " open" : ""}" data-cs-line="${esc(story.key)}">
      <td class="cs-line-page" data-label="${attr("Their page")}">${UI.siteLogo(rival.host, 20)}<span class="cs-line-id">${name}<span class="cs-line-host" dir="auto">${esc(rival.display || rival.host)}${story.title && path && path !== "/" ? `<span aria-hidden="true"> · </span>${esc(path)}` : ""}</span></span></td>
      <td class="cs-line-what" data-label="${attr("What happened")}"><span class="cs-what">${whatLine(story)}</span></td>
      <td class="cs-line-vs" data-label="${attr("Keywords where they beat you")}" data-sort="${story.behind}">${versus(story)}</td>
      <td class="cs-line-go"><button type="button" class="icon-btn cs-line-chev" data-cs-detail="${esc(story.key)}" aria-expanded="${open}" aria-label="${label}">${UI.icon(open ? "chevron-up" : "chevron-down")}</button></td>
    </tr>${open ? `<tr class="cs-detail-row"><td colspan="4">${storyDetail(story, common)}</td></tr>` : ""}`;
  }

  const MV_TIPS = { keywords: "Keywords of yours this page ranks on that moved in the period.", up: "Keywords where their page ended the period higher than it started.", down: "Keywords where their page ended the period lower than it started.", behind: "Keywords where their page is above yours in the latest check.", ahead: "Keywords where your page is above theirs in the latest check." };
  function mvSortHead(id, label, cls) {
    const on = S.mvSort === id;
    return `<th scope="col" class="${cls}"${on ? ` aria-sort="${S.mvDir === 1 ? "descending" : "ascending"}"` : ""}><button type="button" class="cs-sort${on ? " on" : ""}" data-cs-mv-sort="${id}"${MV_TIPS[id] ? ` data-tip="${attr(MV_TIPS[id])}"` : ""}>${on ? UI.icon(S.mvDir === 1 ? "arrow-down" : "arrow-up") : ""}<span>${esc(t(label))}</span></button></th>`;
  }
  function benchMovesHtml() {
    const title = "Changes";
    if (S.errors.moves) return failedCard("moves", title);
    const d = S.data.moves;
    if (!d) return `<div class="cs-mv-head"><h2 tabindex="-1">${esc(t(title))}</h2></div>${COMP.loading()}`;
    const filters = COMP.TIMELINE_FILTERS || [["all", "All", null]];
    const kindOf = (id) => filters.find((f) => f[0] === id);
    const ofKind = (id, list) => { const f = kindOf(id); return f?.[2] ? list.filter((e) => f[2].includes(e.kind)) : list; };
    const rivals = new Map(d.moves.map((e) => [String(e.rival.id), e.rival]));
    const pickedRival = S.mvRival ? allRivals().find((r) => String(r.id) === S.mvRival) || rivals.get(S.mvRival) : null;
    if (S.mvRival && !pickedRival) S.mvRival = "";
    const forRival = (list) => (S.mvRival ? list.filter((e) => String(e.rival.id) === S.mvRival) : list);
    const searched = forRival(d.moves.filter((e) => TP.matches(PAGES.moves, moveText(e))));
    if (S.mvKind !== "all" && !kindOf(S.mvKind)) S.mvKind = "all";
    const shown = ofKind(S.mvKind, searched);
    const kinds = BENCH_KINDS.filter(([id]) => kindOf(id) && (id === "all" || id === S.mvKind || ofKind(id, searched).length));
    const kindSeg = kinds.length < 2 ? "" : `<div class="seg cs-seg cs-kinds" role="group" aria-label="${attr("Filter the changes")}">${kinds.map(([id, label]) => `<button type="button" data-cs-mv-kind="${id}" aria-pressed="${S.mvKind === id}">${esc(t(label).split("|")[0])}<span class="cs-seg-n tabular">${UI.num(ofKind(id, searched).length)}</span></button>`).join("")}</div>`;
    const days = d.days || S.mvDays;
    const daySeg = `<div class="seg cs-seg cs-days" role="group" aria-label="${attr("Period")}">${BENCH_DAYS.map(([n, label]) => `<button type="button" data-cs-mv-days-btn="${n}" aria-pressed="${S.mvDays === n}">${esc(t(label))}</button>`).join("")}</div>`;
    const whoChip = pickedRival ? `<button type="button" class="cs-mv-who" data-cs-pick="${esc(pickedRival.id)}" data-cs-pick-host="${esc(pickedRival.host)}" aria-label="${attr(fill("Showing only {rival}: show all competitors", { rival: pickedRival.display || pickedRival.host }))}">${UI.siteLogo(pickedRival.host, 16)}<span dir="auto">${esc(pickedRival.display || pickedRival.host)}</span>${UI.icon("x")}</button>` : "";
    const total = S.mvRival || S.mvKind !== "all" || TP.state(PAGES.moves).q ? shown.length : d.total;
    /* Two lines over the table, and nothing else: the title, who is shown and the period; then the kinds of change with,
       at their end, the sites not watched and the table's Filter (table-tools.js puts it in the slot named after the table). */
    const note = S.mvRival ? "" : movesNote(d); // the note names other sites: not while one is picked
    const finder = d.moves.length >= FIND_FROM || TP.state(PAGES.moves).q ? TP.search(PAGES.moves, t("Search pages, keywords, titles")) : "";
    const head = `<div class="cs-mv-head"><h2 tabindex="-1">${esc(t(title))}${total ? `<span class="n-badge">${UI.num(total)}</span>` : ""}</h2>${whoChip}${note}${daySeg}</div>
      <div class="cs-mv-bar">${finder}${kindSeg}<div class="cs-mv-end"></div></div>`;
    const search = ""; // the search box sits in the one toolbar line, before the kinds
    if (!d.moves.length) return `${head}${COMP.empty(t(days === 365 ? "Nothing in the past year" : "Nothing in this period"), t("Changes and moves show here as found."))}`;
    /* Rows are competitor pages, in named groups, the pages beside mine first and by what my page brings (reading.js). */
    const stories = storiesOf(shown).filter((s) => !S.mvBehind || s.behind > 0);
    const maxClicks = Math.max(0, ...stories.map((s) => s.mine?.clicks || 0));
    const sec = RD.sections(PAGES.moves, storySections(stories, maxClicks), 4, () => paintSection("moves"));
    const page = sec.page;
    const capped = d.total > d.moves.length && !S.mvRival ? fill("{sent} of {total}, newest first", { sent: UI.num(d.moves.length), total: UI.num(d.total) }) : null;
    const common = COMP.moveCommon?.(page.rows.flatMap((s) => s.all)) || null;
    const maxes = Object.fromEntries(MV_COLS.map(([id, , get]) => [id, Math.max(0, ...stories.map(get))]));
    const rowsHtml = page.rows.map((story) => storyRow(story, common, maxes));
    const none = pickedRival && !searched.length && !TP.state(PAGES.moves).q
      ? COMP.empty(fill("No change from {rival} in this period", { rival: pickedRival.display || pickedRival.host }), t("Try a longer period, or show all competitors."))
      : noneFound(t("No change matches these filters."), PAGES.moves);
    const list = shown.length && stories.length
      ? `<div class="table-wrap"><table class="data cs-lines cs-lines-plain" id="cs-moves-list" data-tt-arrange-off>
          <thead><tr><th scope="col" class="cs-lh-page">${t("Their page")}</th><th scope="col" class="cs-lh-what">${t("What happened")}</th><th scope="col" class="cs-lh-vs">${t("Keywords where they beat you")}${UI.info([t("On how many of the keywords you both rank for their page is above yours, in the latest check. The list starts with the pages ahead of you on the most.")])}</th><th scope="col" class="cs-lh-go"><span class="sr">${t("Details")}</span></th></tr></thead>
          <tbody>${rowsHtml.map((html, i) => sec.before(page.rows[i], i) + html).join("")}${sec.after}</tbody>
        </table></div>${TP.footer(PAGES.moves, page, { noun: t("pages"), capped })}`
      : none;
    return `${head}${search}<div class="cs-pages">${list}</div>${shown.length ? COMP.moveCommonLine?.(common) || "" : ""}`; // what every move shares is a footnote, as under They beat you on
  }
  function movesHtml() {
    if (simple()) return benchMovesHtml();
    const title = "Who is moving";
    if (S.errors.moves) return failedCard("moves", title);
    const d = S.data.moves;
    if (!d) return loadingCard(title);
    const days = d.days || S.mvDays;
    const sub = fill(days === 365 ? "Past year, newest first." : "Past {n} days, newest first.", { n: UI.num(days) });
    const subTip = "Open Details on a row for everything known about that page or check.";
    if (!d.moves.length) return `${sectionHead(title, sub)}${movesTools(d, (x) => x)}${movesNote(d)}${COMP.empty(t(days === 365 ? "Nothing in the past year" : "Nothing in this period"), t("Changes and moves show here as found."))}`;
    const kind = (COMP.TIMELINE_FILTERS || []).find((f) => f[0] === S.mvKind);
    const inKind = (list) => (kind?.[2] ? list.filter((e) => kind[2].includes(e.kind)) : list);
    const shown = inKind(d.moves.filter((e) => TP.matches(PAGES.moves, moveText(e)))).filter((e) => !S.mvRival || String(e.rival.id) === S.mvRival);
    const page = TP.view(PAGES.moves, shown);
    const capped = d.total > d.moves.length ? fill("{sent} of {total}, newest first", { sent: UI.num(d.moves.length), total: UI.num(d.total) }) : null;
    const common = COMP.moveCommon?.(page.rows) || null; // what every move on this page shares, said once over the list (comp-list.js)
    const list = shown.length
      ? `${COMP.moveCommonLine?.(common) || ""}<div class="table-wrap"><table class="data cl-tl-table cs-moves-table" id="cs-moves-list">
          <thead><tr><th scope="col">${t("Date")}</th><th scope="col">${t("Competitor")}</th><th scope="col">${esc(t("Change|kind").split("|")[0])}</th><th scope="col">${t("Page")}</th><th scope="col">${t("What changed")}</th><th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead>
          <tbody>${page.rows.map((e) => moveRow(e, common)).join("")}</tbody>
        </table></div>${TP.footer(PAGES.moves, page, { noun: t("changes"), capped })}`
      : noneFound(t("No change matches these filters."), PAGES.moves);
    return `${sectionHead(title, sub, "", subTip)}${movesTools(d, inKind)}${movesNote(d)}<div class="cs-pages">${list}</div>`;
  }

  // ---- 4. Which links do many rivals share? ---------------------------------------------------------
  /* Good for one site can be flagged for another, so each of my sites says where it stands. Only a good one can be added. */
  /* In the flagged fold, Open Link gaps is said once on the fold's line, not on every row (2026-11-11). */
  function siteState(g, s, inFold = false) {
    const label = `<span class="mono small" dir="auto">${esc(s.host)}</span>`;
    const lost = s.lost_link ? `<span class="tag cg-lost">${UI.icon("link-2-off")}${t("Lost link")}</span>` : "";
    // Good only through links last seen 6+ months before their file (Link gaps' rule): said on the site's line.
    const old = s.quality === "good" && s.old_link ? `<span class="tag cg-old">${UI.icon("calendar-days")}${esc(fill("Old link (last seen {day})", { day: UI.fmtDateOnly(s.old_link.last_seen) }))}</span>` : "";
    let state;
    if (s.in_consideration || COMP.gapConsidered(g.domain, s.host)) state = `<span class="tag cp-yours">${t("In consideration")}</span>`;
    else if (s.quality === "good") state = `<button class="btn btn-small" data-cs-add="${esc(g.domain)}" data-cs-add-site="${s.id}" data-cs-add-host="${esc(s.host)}" aria-label="${esc(fill("Add {domain} for {site}", { domain: g.display || g.domain, site: s.host }))}">${UI.icon("plus")}${t("Add")}</button>`;
    else if (s.quality === "spam") state = `<span class="tag cg-flag">${UI.icon("ban")}${t("Spam")}</span><span class="second cg-why">${COMP.spamWhyHtml(s)}</span>${inFold ? "" : `<button class="link-btn small" data-cs-review="${s.id}">${t("Open Link gaps")}</button>`}`;
    else state = `<span class="tag">${t("Being checked")}</span>`;
    return `<li>${label}<span class="cs-state">${lost}${old}${state}</span></li>`;
  }

  const linkRow = (g, inFold = false) => `<tr>
      <td class="head-cell"><span class="with-logo">${UI.siteLogo(g.domain)}<span class="logo-text"><span class="kw mono" dir="auto">${esc(g.display || g.domain)}</span>${g.title ? `<span class="second cg-title" dir="auto">${esc(g.title)}</span>` : ""}${g.is_competitor ? `<span class="tag">${t("Competitor")}</span>` : ""}</span></span></td>
      <td data-label="${attr("Links to")}"><span class="cp-tags cg-rivals">${g.rivals.map((r) => `<span class="tag" dir="auto">${esc(r.host)}</span>`).join(" ")}</span></td>
      <td class="c" data-label="${attr("How many")}">${UI.num(g.rival_count)}</td>
      <td class="c" data-label="${attr("Authority")}">${COMP.gapAuthority(g)}</td>
      <td data-label="${attr("Your sites")}"><ul class="cs-states">${g.sites.map((s) => siteState(g, s, inFold)).join("")}</ul></td>
      <td class="r nowrap" data-label=""><button class="btn btn-small" data-cs-edit="${esc(g.domain)}" aria-label="${attr("Edit")}: ${esc(g.display || g.domain)}">${UI.icon("pencil")}${t("Edit")}</button></td>
    </tr>`;

  /* Both tables (good and flagged) share one search and one order, and each has its own pages. */
  const linkHead = (key, label, cls = "") => sortButtonHead("data-cs-ln-sort", key, label, S.lnSort, cls);
  const linkTable = (id, key, page, noun, capped = null, inFold = false) => `<div class="cs-pages"><div class="table-wrap"><table class="data" id="${id}">
      <thead><tr>${linkHead("domain", "Domain")}<th scope="col">${t("Links to")}</th>${linkHead("count", "How many", "c")}${linkHead("authority", "Authority", "c")}<th scope="col">${t("Your sites")}</th><th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead>
      <tbody>${page.rows.map((g) => linkRow(g, inFold)).join("")}</tbody>
    </table></div>${TP.footer(key, page, { noun, capped })}</div>`;
  // Authority sorts one tool's scores together, the leading tool first (SEO review #7): the server gives each row its scale_rank.
  const LN_SORTS = { domain: (g) => g.display || g.domain, count: (g) => g.rival_count, authority: (g) => (g.authority === null || g.authority === undefined ? null : [g.scale_rank ?? 0, g.authority]) };
  const LN_FIRST = { domain: "up", count: "down", authority: "down" };

  function linksHtml() {
    const title = "Links many competitors share";
    if (S.errors.links) return failedCard("links", title);
    const d = S.data.links;
    if (!d) return loadingCard(title);
    const f = d.funnel;
    if (!f.found) return `${linksHead(title, "", d)}${COMP.empty(t("No link data yet"), t("Upload a competitor's link file in Link gaps."))}`;
    // One search for both lists. A new search starts the flagged list on its first page too.
    const q = TP.state(PAGES.links).q;
    if (q !== S.linkQ) { S.linkQ = q; TP.reset(PAGES.flagged); }
    const find = (g) => TP.matches(PAGES.links, g.domain, g.display, g.title);
    const value = LN_SORTS[S.lnSort?.key] || (() => 0);
    // Old links (final re-check 2026-11-18, 3.4): left out of the good ones, as on Link gaps, until the chip asks for them.
    const oldRows = S.lnOld ? d.old || [] : [];
    const goodRows = sortList([...d.gaps, ...oldRows].filter(find), value, S.lnSort), flaggedRows = sortList(d.flagged.filter(find), value, S.lnSort);
    const page = TP.view(PAGES.links, goodRows), flaggedPage = TP.view(PAGES.flagged, flaggedRows);
    const oldChip = f.old ? `<button type="button" class="chip cg-old-chip" data-cs-old aria-pressed="${S.lnOld}" data-tip="${esc(t("Domains whose links were last seen more than 6 months before their file. Probably gone."))}">${t("Include old links")}<b>${UI.num(f.old)}</b></button>` : "";
    const findBox = d.gaps.length + d.flagged.length >= FIND_FROM || q ? TP.search(PAGES.links, t("Search domains")) : "";
    const search = findBox || oldChip ? `<div class="cp-tools cs-tools">${findBox}${oldChip}</div>` : "";
    const facts = [
      fill("{with} of {total} competitors have link data", { with: UI.num(d.rivals_with_data), total: UI.num(d.rivals_total) }),
      f.old ? `${UI.num(f.old)} ${t(S.lnOld ? "Old links, included" : "Old links, left out").toLowerCase()}` : "",
      f.checking ? plural(f.checking, "{n} domain still being checked", "{n} domains still being checked") : "",
    ].filter(Boolean).join(" · ");
    const capped = (sent, total) => (total > sent ? fill("{sent} of {total}, most competitors first", { sent: UI.num(sent), total: UI.num(total) }) : null);
    const flaggedBody = flaggedRows.length ? linkTable("cs-flagged-table", PAGES.flagged, flaggedPage, t("domains"), capped(d.flagged.length, f.flagged), true) : `<p class="small sec cs-find-count">${esc(fill("No domain matches “{text}”.", { text: q }))}</p>`;
    const flagged = d.flagged.length ? `<div class="cs-flagged-wrap"><details class="fold cs-flagged" ${S.flaggedOpen ? "open" : ""}><summary>${UI.icon("chevron-right")}${esc(plural(f.flagged, "{n} flagged as spam", "{n} flagged as spam"))}</summary>${flaggedBody}</details></div>` : "";
    const good = goodRows.length ? linkTable("cs-links-table", PAGES.links, page, t("domains"), capped(d.gaps.length + oldRows.length, f.good + (S.lnOld ? f.old || 0 : 0)))
      : q && d.gaps.length ? noneFound(fill("No domain matches “{text}”.", { text: q }), PAGES.links)
        : COMP.empty(t("No good domains yet"), t("No domain has passed the spam check yet."));
    return `${linksHead(title, `${t("Most competitors first.")} ${facts}.`, d)}${search}${good}${flagged}`;
  }

  const SECTION = { rivals: rivalsHtml, keywords: keywordsHtml, moves: movesHtml, links: linksHtml };
  const SORT_DIRS = new Set(["up", "down"]);

  /* The cards side can fold to a rail of logos (2026-11-20, the owner: the cards took a third of the width and the changes
     were tight). A logo still picks its competitor. The choice is kept in this browser; with none made, a window under
     1600 px starts folded, because there the table needs the room more than the cards do. */
  const SLIM_KEY = "seocc-cs-slim";
  const savedSlim = () => { try { return localStorage.getItem(SLIM_KEY); } catch { return null; } };
  S.slim = savedSlim() === null ? window.innerWidth < 1600 : savedSlim() === "1";
  const slimToggle = () => `<button type="button" class="icon-btn cs-slim-toggle" data-cs-slim aria-pressed="${S.slim}" aria-label="${attr(S.slim ? "Show the competitor cards" : "Hide the competitor cards")}" data-tip="${attr(S.slim ? "Show the competitor cards" : "Hide the competitor cards")}">${UI.icon("panel-left")}</button>`;

  // ---- the tab ---------------------------------------------------------------------------------------
  /* The lower card's tabs, each with how many rows it holds once known. */
  function lowTabsHtml() {
    // Shared links counts the rows its list shows (the good linking domains, and the old ones when asked for). It said
    // 61 (domains linking to 2+ competitors) over a list of 322 (test walk 2026-11-23).
    const f = S.data.links?.funnel;
    const n = { keywords: S.data.keywords?.total, moves: S.data.moves?.total, links: f ? (f.good || 0) + (S.lnOld ? f.old || 0 : 0) : undefined };
    return LOW.map(([part, label]) => `<button type="button" class="page-tab" role="tab" id="cs-low-${part}" data-cs-low="${part}" aria-controls="cs-${part}" aria-selected="${S.low === part}" tabindex="${S.low === part ? 0 : -1}">${esc(t(label))}${n[part] ? `<span class="n-badge">${UI.num(n[part])}</span>` : ""}</button>`).join("");
  }
  function showLow(part, { focus = true, scroll = false } = {}) {
    S.low = part;
    UI.$$("[data-cs-low]").forEach((b) => { const on = b.dataset.csLow === part; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; });
    LOW.forEach(([id]) => { const panel = UI.$(`#cs-${id}`); if (panel) panel.hidden = id !== part; });
    if (scroll) UI.$("#cs-lower")?.scrollIntoView({ block: "start" });
    if (focus) UI.$(`[data-cs-low="${part}"]`)?.focus({ preventScroll: true });
    window.TT?.run?.(); // a table shown for the first time gets its tools
  }

  /* A "keyword they beat you on" in the side panel: your place and its last move, who's ahead with their pages, and the actions. */
  function openKeywordPanel(id, opener) {
    const k = S.data.keywords?.keywords?.find((x) => String(x.keyword_id) === String(id));
    if (!k || !UI.rowPanel) return;
    const now = k.my_best?.position ?? null, was = k.my_move?.changed ? k.my_move.was : null;
    const best = k.rivals_ahead.reduce((m, a) => Math.min(m, a.position), 99);
    UI.rowPanel({
      kind: "Keyword", id: "cs-keyword", title: k.keyword, period: false, opener,
      sub: [k.country, engineName(k.engine), k.tool, COMP.ago(k.checked_at)].filter(Boolean).join(" · "),
      numbers: [
        { id: "you", label: "Your position", value: now, before: was, fmt: "pos", sub: now === null ? fill("Not in the top {n}", { n: UI.num(k.depth) }) : undefined },
        { id: "ahead", label: "Competitors ahead", value: k.rivals_ahead.length },
        { id: "best", label: "Best of them", value: best === 99 ? null : best, fmt: "pos" },
      ],
      sections: [{ title: t("Ahead of you"), badge: k.rivals_ahead.length, rows: k.rivals_ahead, columns: [
        { label: t("Competitor"), html: (a) => `<span class="with-logo">${UI.siteLogo(a.host, 16)}<span class="logo-text" dir="auto">${esc(a.display || a.host)}</span></span>` },
        { label: t("Position"), num: true, html: (a) => `#${UI.num(a.position)}` },
        { label: t("Their page"), html: (a) => (a.url ? COMP.link(a.url) : `<span class="muted">—</span>`) },
      ] }],
      task: keywordFind(k), note: true,
      actions: [{ label: t("Compare pages"), icon: "columns-3", onClick: (e, panel) => { panel.close(); COMP.open("pairs"); } }],
    });
  }

  /* Tracking and Remove, behind the row's ⋯ (simpler screens). The switch and Remove are the same controls as before, so
     comp-tracking.js and comp-list.js handle them; the menu closes once one is pressed and the keyboard goes back to the ⋯. */
  function openRowMenu(button) {
    const id = Number(button.dataset.csMenu), l = listRow(id);
    if (!l) return;
    const name = l.display || l.host;
    UI.popover(button, `<div class="cs-menu" role="menu" aria-label="${esc(fill("More for {rival}", { rival: name }))}">
      <p class="cs-menu-lab">${t("Tracking")}</p>${COMP.trackingSwitch?.({ ...l, tracking: l.tracking || "on" }) ?? ""}
      <p class="cs-menu-help small sec">${esc(t({ on: "Keywords, pages and links: everything.", pages: "No keyword numbers; pages still read and links still count.", off: "Paused: no keyword numbers, no page reads. Stays in your list." }[l.tracking || "on"]))}</p>
      <button type="button" class="cs-menu-item" role="menuitem" data-cl-remove="${id}">${UI.icon("trash-2")}${t("Remove")}</button>
    </div>`, "cs-menu-pop");
  }

  const tab = {
    id: "summary", order: 0, label: "Competitors", icon: "crosshair",
    /* The simpler head (competitors.js simpleHead): how the positions were checked, and Add a competitor. */
    headLine: () => basisHtml(),
    headMain: () => (S.data.rivals && allRivals().length ? `<button type="button" class="btn btn-main" id="cl-add-open" data-comp-main="add">${UI.icon("plus")}<span>${t(S.site === COMP.ALL ? "Add competitors" : "Add a competitor")}</span></button>` : ""),
    headInfo: () => ["Positions are only compared inside one check.", "Rows: most wins over you first. Click one to open it."],
    /* In the address (competitors.js asks): #competitors/summary?site=…&find=rival&sort=ranks-down. */
    address() {
      return { find: S.find.trim() || undefined, sort: S.sort ? `${S.sort.key}-${S.sort.dir}` : undefined };
    },
    fromAddress(q) {
      S.find = (q.get("find") || "").slice(0, 100);
      const [key, dir] = (q.get("sort") || "").split("-");
      S.sort = SORTS[key] && SORT_DIRS.has(dir) ? { key, dir } : null;
      S.order = null;
      TP.reset(PAGES.rivals);
    },
    init(helpers) {
      UI = helpers; t = helpers.t; esc = helpers.esc; bindEvents();
      // Another page, another size or a search: only that section is drawn again.
      TP.on(PAGES.rivals, paintRivalsList);
      TP.on(PAGES.keywords, () => paintSection("keywords"));
      TP.on(PAGES.links, () => paintSection("links"));
      TP.on(PAGES.moves, () => paintSection("moves"));
      TP.on(PAGES.flagged, () => paintSection("links"));
    },
    load() {
      /* The same site again (a tracking change, an added competitor): what's on screen stays until the new answer is in,
         and the caller can wait for the table, so focus can go back to the button that was pressed. */
      const again = S.site === COMP.siteId && Boolean(S.data.rivals) && !S.errors.rivals;
      S.token += 1;
      S.site = COMP.siteId;
      if (!again) {
        S.data = {}; S.list = null; S.limit = {};
        // Another site: every table starts on its first page, and the searches and choices made for the last site go.
        S.kwRival = ""; S.flaggedOpen = false;
        S.mvKind = "all"; S.mvRival = "";
        [PAGES.keywords, PAGES.links, PAGES.moves].forEach((key) => { TP.state(key).q = ""; });
        Object.values(PAGES).forEach((key) => TP.reset(key));
      }
      S.errors = {};
      const asked = SECTIONS.map((part) => fetchSection(part, S.token, S.site));
      const list = fetchList(S.token, S.site);
      return again ? Promise.all([asked[SECTIONS.indexOf("rivals")], list]).then(() => {}) : undefined;
    },
    body() {
      if (S.site !== COMP.siteId) return COMP.loading();
      if (S.data.rivals && !S.data.rivals.rivals.length && listPending()) return COMP.loading();
      // One site: the line above the tabs (comp-setup.js) already says there are none and offers Find competitors, so this card only adds what it doesn't.
      if (S.data.rivals && !allRivals().length && S.site !== COMP.ALL && COMP.setup) {
        return COMP.empty(t("Know one already?"), t("Add its address by hand, up to 200 at once."), `<div class="cl-empty-acts"><button class="btn" id="cl-add-open">${UI.icon("plus")}${t("Add competitors")}</button></div>`);
      }
      if (S.data.rivals && !allRivals().length) {
        return COMP.empty(t("No competitors yet"), t("Upload keywords in Find competitors to see who ranks against you."), `<div class="cl-empty-acts"><button class="btn btn-main" data-cl-go-find>${UI.icon("target")}${t("Find competitors")}</button><button class="btn" id="cl-add-open">${UI.icon("plus")}${t("Add competitors")}</button></div>`);
      }
      if (simple()) {
        // The new design (html[data-brand="ocean"]) adds number cards and charts above the same bench; nothing else changes.
        const oceanTop = window.OceanMarket?.on?.() ? `<div id="cbm-top" class="cbm-top">${window.OceanMarket.summaryTop()}</div>` : "";
        return `${oceanTop}<div class="cs-bench${S.slim ? " cs-bench-slim" : ""}">
          <section class="cs-section cs-rivals-side" id="cs-rivals" aria-label="${attr("Competitors")}">${SECTION.rivals()}</section>
          <section class="cs-lower" id="cs-lower" aria-label="${attr("More about your competitors")}">
            <div class="cs-low-tabs" id="cs-low-tabs" role="tablist" aria-label="${attr("More about your competitors")}">${lowTabsHtml()}</div>
            ${LOW.map(([part]) => `<div class="card cs-section cs-low-panel" id="cs-${part}" role="tabpanel" aria-labelledby="cs-low-${part}" ${S.low === part ? "" : "hidden"}>${SECTION[part]()}</div>`).join("")}
          </section>
        </div>`;
      }
      return `<p class="small sec cs-basis" id="cs-basis">${basisHtml()}</p>
        <section class="tiles cs-tiles" id="cs-tiles" aria-label="${attr("Summary")}">${tilesHtml()}</section>
        ${SECTIONS.map((part) => `<section class="cs-section" id="cs-${part}">${SECTION[part]()}</section>`).join("")}`;
    },
  };
  COMP.addTab(tab);
  /* What the new design's summary cards read (ocean-market.js): the same answers, never asked again. */
  COMP.summaryState = () => ({ data: S.data, rivals: S.data.rivals ? allRivals() : null, site: S.site, low: S.low, moveDays: S.data.moves?.days || S.mvDays, line: movesLine(S.data.moves), noneOn: S.data.keywords ? noneOn() : false });

  function bindEvents() {
    document.addEventListener("input", (e) => {
      if (e.target.id !== "cs-find" || UI.state.route !== "competitors" || COMP.currentTab() !== tab) return;
      S.find = e.target.value.slice(0, 100);
      TP.reset(PAGES.rivals);
      paintRivalsList();
    });
    document.addEventListener("change", (e) => {
      if (UI.state.route !== "competitors" || COMP.currentTab() !== tab) return;
      if (e.target.id === "cs-mv-rival") { S.mvRival = e.target.value; TP.reset(PAGES.moves); paintSection("moves"); UI.$("#cs-mv-rival")?.focus({ preventScroll: true }); return; }
      if (e.target.id === "cs-mv-days") {
        S.mvDays = Number(e.target.value) || 30; TP.reset(PAGES.moves);
        delete S.data.moves; paintSection("moves");
        fetchSection("moves", S.token, S.site).then(() => UI.$("#cs-mv-days")?.focus({ preventScroll: true }));
        return;
      }
    });
    document.addEventListener("change", (e) => {
      if (e.target.id !== "cs-kw-rival" || UI.state.route !== "competitors" || COMP.currentTab() !== tab) return;
      S.kwRival = e.target.value;
      TP.reset(PAGES.keywords);
      paintSection("keywords");
      UI.$("#cs-kw-rival")?.focus({ preventScroll: true });
    });
    // Simpler screens: a keyword row opens on Enter, as a link does (the competitor's name is a button).
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !simple() || UI.state.route !== "competitors") return;
      const target = e.target.closest?.("tr[data-cs-kw]");
      if (!target || (target.matches("tr") && e.target !== target)) return;
      e.preventDefault();
      target.click();
    });
    // The spam fold stays open or shut as it was left when its section is drawn again.
    document.addEventListener("toggle", (e) => { if (e.target.classList?.contains("cs-flagged")) S.flaggedOpen = e.target.open; }, true);
    // Try again on a failed read (comp-list.js) changes a rival's state: keep this copy in step for the next redraw.
    window.addEventListener("comp:crawl", (e) => {
      const rival = S.data?.rivals?.rivals?.find((r) => r.id === e.detail.id);
      if (rival) rival.crawl = e.detail.crawl;
      const listed = S.list?.get(e.detail.id);
      if (listed) listed.crawl = e.detail.crawl;
    });
    document.addEventListener("click", async (e) => {
      if (UI.state.route !== "competitors" || COMP.currentTab() !== tab) return;
      const hit = (selector) => e.target.closest?.(selector);
      let el;
      if ((el = hit("[data-cs-pick]"))) { pickRival(el.dataset.csPick, el.dataset.csPickHost); return; }
      if ((el = hit("[data-cs-mv-days-btn]"))) {
        const n = Number(el.dataset.csMvDaysBtn) || 30;
        if (n === S.mvDays && S.data.moves) return;
        S.mvDays = n; TP.reset(PAGES.moves);
        paintSection("moves"); // the old rows stay, with the new period pressed, until its answer is in: no blank flash
        UI.$("#cs-moves")?.setAttribute("aria-busy", "true");
        fetchSection("moves", S.token, S.site).then(() => { UI.$("#cs-moves")?.removeAttribute("aria-busy"); UI.$(`[data-cs-mv-days-btn="${n}"]`)?.focus({ preventScroll: true }); });
        return;
      }
      if ((el = hit("[data-cs-mv-sort]"))) {
        const id = el.dataset.csMvSort;
        if (S.mvSort === id) S.mvDir = -S.mvDir; else { S.mvSort = id; S.mvDir = 1; }
        TP.reset(PAGES.moves); paintSection("moves");
        UI.$(`[data-cs-mv-sort="${id}"]`)?.focus({ preventScroll: true });
        return;
      }
      if (hit("[data-cs-mv-behind]")) {
        S.mvBehind = !S.mvBehind; TP.reset(PAGES.moves); paintSection("moves");
        UI.$("[data-cs-mv-behind]")?.focus({ preventScroll: true });
        return;
      }
      if (hit("[data-cs-slim]")) {
        S.slim = !S.slim;
        try { localStorage.setItem(SLIM_KEY, S.slim ? "1" : "0"); } catch { /* private window: the choice lasts this visit */ }
        UI.$(".cs-bench")?.classList.toggle("cs-bench-slim", S.slim);
        paintSection("rivals");
        UI.$("[data-cs-slim]")?.focus({ preventScroll: true });
        return;
      }
      if ((el = hit("[data-cs-detail]")) || ((el = hit("tr[data-cs-line]")) && !hit("a, button, input, label, select, summary"))) {
        const key = el.dataset.csDetail || el.dataset.csLine;
        if (S.mvOpen.has(key)) S.mvOpen.delete(key); else S.mvOpen.add(key);
        paintSection("moves");
        document.querySelector(`[data-cs-detail="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
        return;
      }
      if ((el = hit("[data-cs-mv-kind]"))) {
        S.mvKind = el.dataset.csMvKind; TP.reset(PAGES.moves); paintSection("moves");
        UI.$(`[data-cs-mv-kind="${S.mvKind}"]`)?.focus({ preventScroll: true });
        return;
      }
      if (simple() && (el = hit("[data-cs-low]"))) { showLow(el.dataset.csLow); return; }
      if (simple() && (el = hit("[data-cs-menu]"))) { openRowMenu(el); return; }
      if (simple() && hit(".cs-menu [data-ct-set], .cs-menu [data-cl-remove]")) {
        const menuFor = UI.$("[data-cs-menu][aria-expanded=\"true\"]")?.dataset.csMenu;
        if (menuFor) COMP.refocus = `[data-cs-menu="${menuFor}"]`;
        setTimeout(() => UI.closePopover?.(), 0);
        return;
      }
      if (simple() && (el = hit("tr[data-cs-kw]")) && !hit("a, button, input, select, textarea, summary, label, .row-act")) { openKeywordPanel(el.dataset.csKw, el); return; }
      if (simple() && (el = hit("[data-cs-jump]"))) {
        const part = el.dataset.csJump;
        if (part === "rivals") { UI.$("#cs-rivals")?.scrollIntoView({ block: "start" }); UI.$("#cs-rivals h2")?.focus({ preventScroll: true }); }
        else showLow(part, { scroll: true });
        return;
      }
      if ((el = hit("[data-cs-jump]"))) {
        const section = UI.$(`#cs-${el.dataset.csJump}`);
        section?.scrollIntoView({ block: "start" });
        section?.querySelector("h2")?.focus({ preventScroll: true });
        return;
      }
      if ((el = hit("[data-cs-open]"))) { COMP.open("list", { competitorId: Number(el.dataset.csOpen) }, el.dataset.csSite ? Number(el.dataset.csSite) : undefined); return; }
      if ((el = hit("[data-cs-row]")) && !hit("a, button, input, select, textarea, summary, label")) { COMP.open("list", { competitorId: Number(el.dataset.csRow) }, Number(el.dataset.csRowSite)); return; }
      if ((el = hit("[data-cs-you-edits]"))) { openYourEdits(el.dataset.csYouEdits, el); return; }
      if ((el = hit("[data-cs-review]"))) { COMP.open("gaps", {}, Number(el.dataset.csReview)); return; }
      if ((el = hit("[data-cs-retry]"))) {
        const part = el.dataset.csRetry;
        delete S.errors[part];
        paintSection(part);
        fetchSection(part, S.token, S.site);
        return;
      }
      if ((el = hit("[data-cs-sort]"))) {
        const key = el.dataset.csSort, first = key === "name" ? "up" : "down";
        S.sort = S.sort?.key === key ? { key, dir: S.sort.dir === "up" ? "down" : "up" } : { key, dir: first };
        S.order = null; // worked out once, now
        TP.reset(PAGES.rivals);
        paintRivalsList();
        UI.$(`[data-cs-sort="${key}"]`)?.focus({ preventScroll: true });
        return;
      }
      if (hit("[data-cs-find-clear]")) { S.find = ""; TP.reset(PAGES.rivals); const input = UI.$("#cs-find"); if (input) input.value = ""; paintRivalsList(); input?.focus(); return; }
      if ((el = hit("[data-cs-kw-sort]"))) {
        const key = el.dataset.csKwSort;
        S.kwSort = nextSort(S.kwSort, key, KW_FIRST[key]);
        TP.reset(PAGES.keywords);
        paintSection("keywords");
        UI.$(`[data-cs-kw-sort="${key}"]`)?.focus({ preventScroll: true });
        return;
      }
      if (hit("[data-cs-old]")) {
        S.lnOld = !S.lnOld;
        TP.reset(PAGES.links);
        paintSection("links");
        const lowTabs = UI.$("#cs-low-tabs");
        if (lowTabs) UI.setHTML(lowTabs, lowTabsHtml()); // the tab's count follows the old links in or out
        UI.$("[data-cs-old]")?.focus({ preventScroll: true });
        return;
      }
      if ((el = hit("[data-cs-ln-sort]"))) {
        const key = el.dataset.csLnSort, inFlagged = Boolean(el.closest("#cs-flagged-table"));
        S.lnSort = nextSort(S.lnSort, key, LN_FIRST[key]);
        TP.reset(PAGES.links); TP.reset(PAGES.flagged);
        paintSection("links");
        UI.$(`${inFlagged ? "#cs-flagged-table" : "#cs-links-table"} [data-cs-ln-sort="${key}"]`)?.focus({ preventScroll: true });
        return;
      }
      if ((el = hit("[data-cs-more]"))) {
        const part = el.dataset.csMore;
        S.limit[part] = limitOf(part) + MORE_ROWS;
        // The flagged list lives inside the links section, so that's the one to redraw. It stays open.
        const box = UI.$(part === "flagged" ? "#cs-links" : `#cs-${part}`);
        if (box) UI.setHTML(box, SECTION[part === "flagged" ? "links" : part]());
        if (part === "flagged") { const fold = UI.$(".cs-flagged"); if (fold) fold.open = true; }
        return;
      }
      if ((el = hit("[data-cs-edit]"))) {
        const d = S.data.links, gap = [...d.gaps, ...d.flagged].find((row) => row.domain === el.dataset.csEdit);
        if (gap) COMP.editGap(gap, rivalsInView(d), el, refreshLinks);
        return;
      }
      if ((el = hit("[data-cs-add-domain]"))) { COMP.editGap(null, rivalsInView(S.data.links), el, refreshLinks); return; }
      if ((el = hit("[data-cs-add]"))) {
        if (el.disabled) return;
        const domain = el.dataset.csAdd;
        el.disabled = true;
        try {
          await COMP.addGap(Number(el.dataset.csAddSite), el.dataset.csAddHost, domain, refreshLinks);
        } catch (err) {
          el.disabled = false;
          COMP.fail(err);
          return;
        }
        // The row was redrawn, so the keyboard goes to what's left of it.
        UI.$(`[data-cs-add="${CSS.escape(domain)}"]`)?.focus({ preventScroll: true });
      }
    });
  }

  Object.assign(window.FR, {
    "On pages that compete with yours": "Sur les pages en concurrence avec les vôtres", "On their other pages": "Sur leurs autres pages", "Small edits": "Petites modifications", "Home page": "Page d'accueil", "Keywords where they beat you": "Mots-clés où ils vous devancent", "None": "Aucun", "of {n}": "sur {n}", "Rising": "En hausse", "Falling": "En baisse", "Steady": "Stable", "Text rewritten": "Texte réécrit", "Small text edit": "Petite retouche du texte", "Last seen {when}": "Vu {when}",
    "On how many of the keywords you both rank for their page is above yours, in the latest check. The list starts with the pages ahead of you on the most.": "Sur combien des mots-clés où vous êtes tous deux classés leur page est au-dessus de la vôtre, au dernier contrôle. La liste commence par les pages devant vous sur le plus de mots-clés.", "Up": "Hausse", "Down": "Baisse", "Behind": "Derrière", "Ahead": "Devant", "Back where they were": "Revenus à leur place",
    "Keywords of yours this page ranks on that moved in the period.": "Vos mots-clés sur lesquels cette page est classée et qui ont bougé sur la période.", "Keywords where their page ended the period higher than it started.": "Mots-clés où leur page finit la période plus haut qu'au début.", "Keywords where their page ended the period lower than it started.": "Mots-clés où leur page finit la période plus bas qu'au début.", "Keywords where their page is above yours in the latest check.": "Mots-clés où leur page est au-dessus de la vôtre au dernier contrôle.", "Keywords where your page is above theirs in the latest check.": "Mots-clés où votre page est au-dessus de la leur au dernier contrôle.", "What happened": "Ce qui s'est passé", "Seen": "Vu", "Text": "Texte", "New {list}": "Nouveau : {list}", "{list} too": "{list} aussi",
    "title": "titre", "main heading": "titre principal", "subheadings": "sous-titres", "description": "description", "structured data": "données structurées", "canonical": "canonique", "indexing": "indexation", "search title": "titre dans Google",
    "of {n} keyword": "sur {n} mot-clé", "of {n} keywords": "sur {n} mots-clés", "on {n} keyword": "sur {n} mot-clé", "on {n} keywords": "sur {n} mots-clés", "{n} keyword, back where it was": "{n} mot-clé, revenu à sa place", "{n} keywords, back where they were": "{n} mots-clés, revenus à leur place",
    "{n} behind": "{n} derrière", "{n} ahead": "{n} devant", "Everything about their page": "Tout sur leur page", "Open their page": "Ouvrir leur page", "They're ahead": "Ils sont devant", "Sort": "Trier", "Where you're behind": "Là où vous êtes derrière", "Newest first": "Les plus récents", "Most keywords moved": "Le plus de mots-clés déplacés", "Only where they're ahead": "Seulement là où ils sont devant", "Show the competitor cards": "Afficher les fiches des concurrents", "Hide the competitor cards": "Masquer les fiches des concurrents", "Beside your {page}": "Face à votre {page}", "Open your page": "Ouvrir votre page", "You vs them": "Vous et eux",
    "On how many of this row's keywords their page is above yours, and on how many yours is above theirs, in the latest check.": "Sur combien de mots-clés de cette ligne leur page est au-dessus de la vôtre, et sur combien la vôtre est au-dessus, au dernier contrôle.", "{n} unchanged": "{n} inchangés", "All {n} keywords": "Les {n} mots-clés", "Ahead": "Devant", "From the start of the period to now. {n} moves seen in all.": "Du début de la période à maintenant. {n} mouvements vus au total.", "Behind on {n}": "Derrière sur {n}", "Ahead on {n}": "Devant sur {n}", "{n} up": "{n} en hausse", "{n} down": "{n} en baisse", "{n} keyword back where it was": "{n} mot-clé revenu à sa place", "{n} keywords back where they were": "{n} mots-clés revenus à leur place", "Your page": "Votre page", "click": "clic", "clicks": "clics", "No page of yours beside it": "Aucune de vos pages en face",
    "The page of yours that ranks beside theirs, on how many of this row's keywords you are behind or ahead of them, and your page's Google clicks in the last 28 days against the 28 before.": "Votre page classée face à la leur, le nombre de mots-clés de cette ligne où vous êtes derrière ou devant eux, et les clics Google de votre page sur les 28 derniers jours par rapport aux 28 précédents.",
    "Changes": "Changements", "Added": "Ajoutées", "Edited": "Modifiées", "Edited|pages": "Modifiées", "Rankings": "Classements",
    "7 days": "7 jours", "30 days": "30 jours", "3 months": "3 mois", "1 year": "1 an", "Seen on": "Repéré le",
    "added in 30 days": "ajoutées en 30 j", "edited in 30 days": "modifiées en 30 j", "{n} page": "{n} page", "{n} pages": "{n} pages",
    "can't read its pages": "pages illisibles", "Reading its pages now": "Lecture de ses pages en cours", "Not read yet": "Pas encore lu",
    "Open": "Ouvrir", "Show only {rival}": "Afficher seulement {rival}", "Showing only {rival}: show all competitors": "Seulement {rival} : afficher tous les concurrents",
    "No change from {rival} in this period": "Aucun changement de {rival} sur cette période", "Try a longer period, or show all competitors.": "Essayez une période plus longue, ou affichez tous les concurrents.",
    "They beat you on": "Ils vous battent sur", "Shared links": "Liens communs", "More about your competitors": "Plus sur vos concurrents",
    "More for {rival}": "Plus pour {rival}", "Tracking and Remove": "Suivi et retrait", "Competitors ahead": "Concurrents devant",
    "Best of them": "Le meilleur d'entre eux", "Compare pages": "Comparer les pages", "Not in the top {n}": "Hors du top {n}",
    "{n} not watched": "{n} non suivis", "{checked} of {total} keywords checked": "{checked} mots-clés vérifiés sur {total}",
    "Rows: most wins over you first. Click one to open it.": "Lignes : d'abord ceux qui vous battent le plus. Cliquez sur l'une pour l'ouvrir.",
    "Filter the changes": "Filtrer les changements", "Period": "Période", "Past year": "Dernière année", "Past {n} days": "{n} derniers jours",
    "Search pages, keywords, titles": "Chercher une page, un mot-clé, un titre", "changes": "changements", "No change matches these filters.": "Aucun changement ne correspond à ces filtres.",
    "Past {n} days, newest first.": "{n} derniers jours, du plus récent au plus ancien.",
    "Past year, newest first.": "Dernière année, du plus récent au plus ancien.",
    "Nothing in the past year": "Rien sur la dernière année", "Nothing in this period": "Rien sur cette période",
    "Changes in {n} days": "Changements sur {n} jours", "Changes, past year": "Changements, dernière année",
    "Know one already?": "Vous en connaissez déjà un ?",
    "competitors": "concurrents", "keywords": "mots-clés", "domains": "domaines",
    "Search keywords": "Chercher un mot-clé", "Search domains": "Chercher un domaine",
    "Competitor": "Concurrent", "All competitors": "Tous les concurrents",
    "No keyword matches.": "Aucun mot-clé ne correspond.",
    "No domain matches “{text}”.": "Aucun domaine ne correspond à « {text} ».",
    "Nothing matches these filters": "Rien ne correspond à ces filtres",
    "Pick another competitor.": "Choisissez un autre concurrent.",
    "Clear search": "Effacer la recherche",
    "Keyword": "Mot-clé", "Domain": "Domaine", "How many": "Combien", "Authority": "Autorité",
    "Find a competitor": "Chercher un concurrent",
    "No competitor matches “{text}”.": "Aucun concurrent ne correspond à « {text} ».",
    "{n} of {total} competitors match.": "{n} concurrents sur {total} correspondent.",
    "Show all": "Tout afficher",
    "Add its address by hand, up to 200 at once.": "Ajoutez son adresse à la main, jusqu'à 200 à la fois.",
    "Summary": "Synthèse",
    "Ranks on your keywords": "Se classe sur vos mots-clés",
    "Who leads": "Qui est devant", "Absent": "Absent",
    "since {date}": "depuis le {date}", "today": "aujourd'hui", "since yesterday": "depuis hier",
    "{n} edit today": "{n} modification aujourd'hui", "{n} edits today": "{n} modifications aujourd'hui", "{n} edit since yesterday": "{n} modification depuis hier", "{n} edits since yesterday": "{n} modifications depuis hier",
    "Your site": "Votre site", "Edits not tracked": "Modifications non suivies", "Edits show after the first read": "Modifications visibles après la première lecture",
    "Edits show from the next read": "Modifications visibles dès la prochaine lecture", "{n} edit since {date}": "{n} modification depuis le {date}", "{n} edits since {date}": "{n} modifications depuis le {date}",
    "{n} edit in 30 days": "{n} modification en 30 jours", "{n} edits in 30 days": "{n} modifications en 30 jours", "Reading now": "Lecture en cours", "Last read failed": "Dernière lecture échouée",
    "See your edits": "Voir vos modifications", "Your edits": "Vos modifications", "Your edits on {site}": "Vos modifications sur {site}", "Pages changed": "Pages modifiées",
    "The newest {n} shown.": "Les {n} plus récentes sont affichées.",
    "Who's ahead on shared keywords, and how many you're absent on.": "Qui est devant sur les mots-clés communs, et sur combien vous êtes absent.",
    "you're absent on {n}": "vous êtes absent sur {n}",
    "No ranking check yet": "Aucune vérification de classement",
    "The first read isn't done yet.": "La première lecture n'est pas terminée.",
    "Tracking is off: its pages aren't read.": "Suivi désactivé : ses pages ne sont pas lues.",
    "Watching {n} competitor.": "{n} concurrent suivi.", "Watching {n} competitors.": "{n} concurrents suivis.",
    "Watching {w} of {n} competitors.": "{w} concurrents suivis sur {n}.", "Watching 1 of {n} competitors.": "1 concurrent suivi sur {n}.",
    "First read sets the starting point; edits show from the next one.": "La première lecture pose le point de départ ; les modifications apparaissent dès la suivante.",
    "Only first reads so far": "Seulement des premières lectures",
    "No pages read yet": "Aucune page lue pour l'instant",
    "All paused": "Tous en pause",
    "A keyword counts once across your sites. Where and when it was checked shows under it, or once under the table.": "Un mot-clé compte une fois pour tous vos sites. Où et quand il a été vérifié figure dessous, ou une fois sous le tableau.",
    "Click to open.": "Cliquez pour ouvrir.",
    "{n} competitor, paused: set it to On to compare keywords.": "{n} concurrent, en pause : passez-le sur Activé pour comparer les mots-clés.",
    "{n} competitors, all paused: set one to On to compare.": "{n} concurrents, tous en pause : passez-en un sur Activé pour comparer.",
    "None tracked for keywords: set one to On.": "Aucun suivi pour les mots-clés : passez-en un sur Activé.",
    "None tracked for keywords": "Aucun suivi pour les mots-clés",
    "Set a competitor to On above to see where they beat you.": "Passez un concurrent sur Activé ci-dessus pour voir où il vous bat.",
    "Most wins over you first. Each icon is one of your sites: click to open the competitor there.": "D'abord ceux qui vous battent le plus. Chaque icône est l'un de vos sites : cliquez pour y ouvrir le concurrent.",
    "Most wins over you first.": "D'abord ceux qui vous battent le plus.",
    "Add competitors": "Ajouter des concurrents",
    "Positions appear after your keywords' first check. Viewing never spends one.": "Les positions apparaissent après la première vérification de vos mots-clés. Consulter ne consomme rien.",
    "Most competitors ahead first.": "D'abord les mots-clés avec le plus de concurrents devant vous.",
    "A keyword counts once, however many of your sites track it. The second line under each keyword says where and when it was checked.": "Un mot-clé compte une fois, quel que soit le nombre de vos sites qui le suivent. La deuxième ligne sous chaque mot-clé dit où et quand il a été vérifié.",
    "See all": "Tout voir",
    "Most competitors first.": "D'abord ceux liés au plus de concurrents.",
    "Spam is flagged, never removed, and only good domains can be added.": "Le spam est signalé, jamais retiré, et seuls les bons domaines peuvent être ajoutés.",
    "Your sites": "Vos sites",
    "Keywords it ranks on": "Mots-clés où il se classe",
    "You weren't found on": "Où vous êtes introuvable",
    "Your biggest competitors": "Vos principaux concurrents",
    "Most keywords where they beat you first. Click a competitor to open it.": "D'abord ceux qui vous battent sur le plus de mots-clés. Cliquez sur un concurrent pour l'ouvrir.",
    "Open {rival}": "Ouvrir {rival}", "Open {rival}'s page": "Ouvrir la page de {rival}", "Show only {rival}'s changes": "Afficher seulement les changements de {rival}",
    "Open {rival} for {site}": "Ouvrir {rival} pour {site}",
    "across {n} site": "sur {n} site",
    "across {n} sites": "sur {n} sites",
    "Keywords they beat you on": "Mots-clés où ils vous battent",
    "Changes in 30 days": "Changements en 30 jours",
    "Domains linking to 2+": "Domaines liés à 2+ concurrents",
    "{n} good domain": "{n} bon domaine",
    "{n} good domains": "{n} bons domaines",
    "No keywords uploaded yet, so there's nothing to compare positions on.": "Aucun mot-clé importé pour l'instant : il n'y a pas de positions à comparer.",
    "{n} keyword saved, none checked yet. Ranking numbers show — until they are.": "{n} mot-clé enregistré, aucun vérifié. Les chiffres de classement affichent — en attendant.",
    "{n} keywords saved, none checked yet. Ranking numbers show — until they are.": "{n} mots-clés enregistrés, aucun vérifié. Les chiffres de classement affichent — en attendant.",
    "checked {when}": "vérifiés {when}",
    "newest check {newest}, oldest {oldest}": "vérification la plus récente {newest}, la plus ancienne {oldest}",
    "{checked} of {total} keywords checked, with {tools}": "{checked} mots-clés vérifiés sur {total}, avec {tools}",
    "Positions are only compared inside one check.": "Les positions ne sont comparées qu'au sein d'une même vérification.",
    "{shown} of {total}": "{shown} sur {total}",
    "{sent} of {total}, most competitors first": "{sent} sur {total}, par nombre de concurrents",
    "{sent} of {total}, most competitors ahead first": "{sent} sur {total}, par nombre de concurrents devant vous",
    "{sent} of {total}, newest first": "{sent} sur {total}, les plus récents d'abord",
    "ahead of {site}, {position}": "devant {site}, {position}",
    "Competitors ahead on": "Concurrents devant sur",
    "Your position": "Votre position", "Latest change": "Dernier changement", "First check": "Première vérification", "No change": "Aucun changement", "Since": "Depuis", "was {place}": "était {place}", "Up {n}": "En hausse de {n}", "Down {n}": "En baisse de {n}", "Now in the results": "Entrée dans les résultats", "Out of the results": "Sortie des résultats", "Show {n} more": "Afficher {n} de plus", "Show less": "Afficher moins",
    "Ahead of you": "Devant vous",
    "and {n} more": "et {n} de plus",
    "This needs ranking checks. Add a search tool's key in Settings, then press Refresh on one of your sites. Viewing this page never spends a check.": "Il faut des vérifications de classement. Ajoutez la clé d'un outil de recherche dans Réglages, puis lancez Actualiser sur l'un de vos sites. Consulter cette page ne consomme aucune vérification.",
    "No competitor beats you on any keyword checked.": "Aucun concurrent ne vous bat sur les mots-clés vérifiés.",
    "No ranking checks yet": "Aucune vérification de classement",
    "Most competitors ahead first. A keyword counts once, however many of your sites track it.": "D'abord les mots-clés avec le plus de concurrents devant vous. Un mot-clé compte une fois, quel que soit le nombre de vos sites qui le suivent.",
    "Who is moving": "Qui bouge",
    "The last 30 days, newest first.": "Les 30 derniers jours, du plus récent au plus ancien.",
    "Nothing in the last 30 days": "Rien sur les 30 derniers jours",
    "Changes and moves show here as found.": "Les changements et mouvements s'affichent ici dès qu'ils sont repérés.",
    "Can't see page changes for {hosts}: they block bots.": "Changements de pages invisibles pour {hosts} : ces sites bloquent les robots.",
    "Not watched yet: {hosts}.": "Pas encore surveillés : {hosts}.",
    "Links many competitors share": "Liens communs à plusieurs concurrents", "Sites linking to your competitors, not to you": "Sites qui font un lien vers vos concurrents, pas vers vous",
    "Add {domain} for {site}": "Ajouter {domain} pour {site}",
    "Open Link gaps": "Ouvrir Liens manquants",
    "No link data yet": "Pas encore de données de liens",
    "Upload a competitor's link file in Link gaps.": "Importez le fichier de liens d'un concurrent dans Liens manquants.",
    "{with} of {total} competitors have link data": "{with} concurrents sur {total} ont des données de liens",
    "{n} domain still being checked": "{n} domaine encore en cours de vérification",
    "{n} domains still being checked": "{n} domaines encore en cours de vérification",
    "{n} flagged as spam": "{n} signalés comme spam",
    "No good domains yet": "Pas encore de bons domaines",
    "No domain has passed the spam check yet.": "Aucun domaine n'a encore passé le contrôle anti-spam.",
    "Most competitors first. Spam is flagged, never removed, and only good domains can be added.": "D'abord ceux liés au plus de concurrents. Le spam est signalé, jamais retiré, et seuls les bons domaines peuvent être ajoutés.",
  });
})();
