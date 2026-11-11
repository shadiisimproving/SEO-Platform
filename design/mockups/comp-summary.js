/* Competitors area: Summary. All my competitors together, across my sites (COMP.ALL) or narrowed to one by the dropdown.
   Four questions, each loading and failing on its own, so a slow list of links can't hold up the rest.
   It only reads. Numbers come from seo/competitors/collective.py, which holds the counting rules. */
(() => {
  "use strict";
  const COMP = window.COMP;
  let UI = null, t = null, esc = null;
  const SECTIONS = ["rivals", "keywords", "moves", "links"];
  /* Every table, Who is moving too since 2026-11-10, has pages (table-pages.js), as every long table in the app. */
  const FIRST_ROWS = { moves: 5 }, MORE_ROWS = 50;
  const PAGES = { rivals: "cs-rivals", keywords: "cs-keywords", links: "cs-links", flagged: "cs-flagged", moves: "cs-moves" };
  const S = { site: null, token: 0, data: {}, errors: {}, limit: {}, list: null, order: null, orderSite: null, find: "", sort: null, kwRival: "", kwSort: null, lnSort: null, flaggedOpen: false, linkQ: "", mvKind: "all", mvRival: "", mvDays: 30 };
  const FIND_FROM = 11; // more than 10 rows, as on every table: a search box shows from this many rows, or while a search is on

  const fill = (words, values) => t(words).replace(/\{(\w+)\}/g, (all, name) => (name in values ? values[name] : all));
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
      const answer = await COMP.api("GET", pathFor(part, site));
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
      const answer = await COMP.api("GET", `competitors?site_id=${site}`);
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
    const open = t(c.all === 1 ? "Click it to open it." : "Click one to open it.");
    if (!watched) return plural(c.all, "{n} competitor, paused. Switch it to On to compare keywords.", "{n} competitors, all paused. Switch one to On to compare keywords.");
    const first = c.off ? fill(watched === 1 ? "You're watching 1 of {n} competitors." : "You're watching {w} of {n} competitors.", { w: UI.num(watched), n: UI.num(c.all) }) : plural(c.all, "You're watching {n} competitor.", "You're watching {n} competitors.");
    return `${first} ${c.on ? open : t("None is tracked for keywords: switch one to On to compare keywords.")}`;
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
    if (tiles) UI.setHTML(tiles, tilesHtml());
    if (basisLine) UI.setHTML(basisLine, basisHtml());
  }

  const refreshLinks = () => fetchSection("links", S.token, S.site);

  // ---- the top of the page ---------------------------------------------------------------------
  function basisHtml() {
    const c = S.data.rivals?.coverage;
    if (!c || !c.keywords || !c.checked) return ""; // no list, or a list never checked: the setup banner above the tabs already says so, once
    const when = c.newest === c.oldest ? fill("checked {when}", { when: COMP.ago(c.newest) }) : fill("newest check {newest}, oldest {oldest}", { newest: COMP.ago(c.newest), oldest: COMP.ago(c.oldest) });
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
      one("keywords", "Keywords they beat you on", known(d.keywords, d.keywords?.coverage.checked > 0 && !noneOn(), d.keywords?.total), d.keywords && noneOn() ? t("No competitor is tracked for keywords") : "", "trending-up"),
      one("moves", S.data.moves?.days === 365 ? "Changes in the last year" : fill("Changes in {n} days", { n: UI.num(S.data.moves?.days || 30) }), known(d.moves, d.moves?.total > 0 || (!allOff() && !nothingRead && !allFirstRead()), d.moves?.total), d.moves && !d.moves.total ? (allOff() ? t("Every competitor is paused") : nothingRead ? (allRivals().length ? t("None of their pages could be read yet") : "") : allFirstRead() ? t("First reads only set the starting point") : "") : "", "activity", movesLine(d.moves)),
      one("links", "Domains linking to 2 or more", known(d.links, hasLinks, d.links?.funnel.shared), hasLinks ? plural(d.links.funnel.good, "{n} good domain in all", "{n} good domains in all") : d.links && allOff() ? t("Every competitor is paused") : "", "link-2"),
    ].join("");
  }

  // ---- shared pieces -------------------------------------------------------------------------------
  const sectionHead = (title, sub = "", info = "") => `<div class="cs-head"><h2 tabindex="-1">${esc(t(title))}${info ? COMP.info(info) : ""}</h2>${sub ? `<p class="small sec">${esc(sub)}</p>` : ""}</div>`;
  /* Every competitor in view, so a link can be ticked for one a domain isn't listed under yet. */
  const rivalsInView = (d) => [...new Map([...(d.rivals || []), ...[...d.gaps, ...d.flagged].flatMap((row) => row.rivals)].map((r) => [r.id, r])).values()].sort((a, b) => a.host.localeCompare(b.host));
  const linksHead = (title, sub, d) => `<div class="cs-head-row">${sectionHead(title, sub, "Spam is flagged, never removed, and only good domains can be added.")}${rivalsInView(d).length ? `<button class="btn btn-small" data-cs-add-domain>${UI.icon("plus")}${t("Add a domain")}</button>` : ""}</div>`;
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
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), UI.state.lang)) * up;
    });
  }
  /* A search that finds nothing says so, with the way back. */
  const noneFound = (words, key) => `<div class="table-wrap"><div class="empty cs-find-none"><p>${esc(words)}</p><button type="button" class="btn btn-small" data-tp-clear data-tp-key="${esc(key)}">${t("Clear the search")}</button></div></div>`;
  function moreButton(part, shown, total, word = "Show more") {
    if (shown >= total) return "";
    return `<div class="cs-more"><span class="small sec">${esc(fill("Showing {shown} of {total}", { shown: UI.num(shown), total: UI.num(total) }))}</span><button class="btn btn-small" data-cs-more="${part}">${t(word)} (${UI.num(total - shown)})</button></div>`;
  }
  /* All my sites: each of my sites as its icon, with the name on hover and for screen readers, so the row stays one line. */
  const siteChip = (rival, site) => `<button type="button" class="cs-site" data-cs-open="${rival.id}" data-cs-site="${site.id}" data-tip="${esc(site.host)}" aria-label="${esc(fill("Open {rival} for {site}", { rival: rival.display || rival.host, site: site.host }))}">${UI.siteLogo(site.host, 18)}<span class="sr">${esc(site.host)}</span></button>`;

  // ---- 1. Who are my biggest rivals? ---------------------------------------------------------------
  /* The whole row opens the competitor, for its first site. The name is the real button, so it works from the keyboard too. */
  /* Unknown is unknown: no check yet, or a site not read yet, shows — and never 0. */
  const unknown = (why) => `<span class="muted" title="${attr(why)}">—</span>`;
  const trackedOn = (r) => (listRow(r.id)?.tracking ?? "on") === "on";
  function leadCell(r) {
    if (!trackedOn(r)) return unknown("Keyword tracking isn't on for this competitor.");
    if (r.ranks_on === null || r.ranks_on === undefined) return unknown("No ranking check yet");
    const side = (who, n, cls) => `<span class="cs-lead-side"><i class="pt-key pt-key-${cls}" aria-hidden="true"></i>${t(who)} <b class="tabular">${UI.num(n || 0)}</b></span>`;
    const absent = r.not_found ? `<span class="second">${esc(plural(r.not_found, "you're absent on {n}", "you're absent on {n}"))}</span>` : "";
    return `<span class="cs-lead-cell"><span class="cs-lead">${side("Them", r.they_ahead, "them")}${side("You", r.i_ahead, "you")}</span>${absent}</span>`; // one box, so a phone's card keeps both sides on a line with the note under them
  }
  /* Added in the last day, with no edit seen: its pages have been read once, and a first read only sets the starting point.
     So 0 would claim something the app can't know yet. (The API sends no count of reads, hence the day.) */
  const FIRST_READ = "The first read only sets the starting point. Edits show from the next daily read.";
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
  const rivalRow = (r) => {
    const all = S.site === COMP.ALL, l = listRow(r.id);
    const name = `${UI.siteLogo(r.host)}<span class="logo-text kw mono" dir="auto">${esc(r.display || r.host)}</span>`;
    return `<tr${r.sites[0] ? ` data-cs-row="${r.id}" data-cs-row-site="${r.sites[0].id}"` : ""} class="${l?.tracking && l.tracking !== "on" ? `ct-row-${l.tracking}` : ""}">
      <td class="head-cell">${r.sites[0]
        ? `<button type="button" class="cs-rival-open with-logo" data-cs-open="${r.id}" data-cs-site="${r.sites[0].id}" aria-label="${attr(fill("Open {rival}", { rival: r.display || r.host }))}">${name}</button>`
        : `<span class="with-logo">${name}</span>`}${!all && l && l.source !== "suggested" ? `<span class="second">${t("Added by hand")}</span>` : ""}</td>
      ${all ? `<td data-label="${attr("Your sites")}"><span class="cs-sites">${r.sites.map((site) => siteChip(r, site)).join("")}</span></td>` : ""}
      <td class="c" data-label="${attr("Ranks on your keywords")}">${trackedOn(r) ? count(r.ranks_on) : unknown("Keyword tracking isn't on for this competitor.")}</td>
      <td class="c" data-label="${attr("Who leads")}">${leadCell(r)}</td>
      <td class="c" data-label="${attr("Edits in 30 days")}">${editsCell(r)}</td>
      <td data-label="${attr("Watching")}" data-cl-watch="${r.id}">${l?.tracking === "off" ? `<span class="status sec">${UI.icon("pause")}${esc(t("Paused"))}</span>` : COMP.watching(r.crawl, r.sites[0] ? { id: r.id, site: r.sites[0].id } : null)}</td>
      ${all ? "" : `<td data-label="${attr("Tracking")}">${l ? COMP.trackingSwitch?.({ ...l, tracking: l.tracking || "on" }) ?? "" : ""}</td>
      <td class="r nowrap" data-label=""><button class="icon-btn cl-row-btn" data-cl-remove="${r.id}" aria-label="${attr("Remove")}: ${esc(r.host)}" data-tip="${attr("Remove")}">${UI.icon("trash-2")}</button></td>`}
    </tr>`;
  };

  function rivalsHtml() {
    const title = "Competitors";
    if (S.errors.rivals) return failedCard("rivals", title);
    const d = S.data.rivals;
    if (!d) return loadingCard(title);
    const all = S.site === COMP.ALL;
    const head = `<div class="cs-head-row">${sectionHead(title, watchingWords(), all ? "Most keywords where they beat you first. The icons are your sites: one opens the competitor for that site." : "Most keywords where they beat you first.")}<button class="btn btn-main" id="cl-add-open">${UI.icon("plus")}${t(all ? "Add competitors" : "Add a competitor")}</button></div>`;
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
    const all = S.site === COMP.ALL;
    const every = orderedRivals().filter(matches), page = TP.view(PAGES.rivals, every), rows = page.rows;
    if (S.find && !every.length) return `<div class="table-wrap"><div class="empty cs-find-none"><p>${esc(fill("No competitor matches “{text}”.", { text: S.find }))}</p><button type="button" class="btn btn-small" data-cs-find-clear>${t("Show all")}</button></div></div>`;
    return `<div class="cs-pages"><div class="table-wrap"><table class="data cs-merged" id="cs-rivals-table">
        <thead><tr>${sortHead("name", "Competitor")}${all ? `<th scope="col">${t("Your sites")}</th>` : ""}${sortHead("ranks", "Ranks on your keywords", "c")}${sortHead("leads", "Who leads", "c", "Who is ahead on the keywords you share, and how many keywords you weren't found on")}${sortHead("edits", "Edits in 30 days", "c")}<th scope="col">${t("Watching")}</th>${all ? "" : `<th scope="col">${t("Tracking")}</th><th scope="col"><span class="sr">${t("Action")}</span></th>`}</tr></thead>
        <tbody>${rows.map(rivalRow).join("")}</tbody>
      </table></div>${TP.footer(PAGES.rivals, page, { noun: t("competitors") })}</div>${S.find ? `<p class="small sec cs-find-count">${esc(fill("{n} of {total} competitors match.", { n: UI.num(every.length), total: UI.num(allRivals().length) }))}</p>` : ""}`;
  }
  function paintRivalsList() {
    const box = UI.$("#cs-rivals-list");
    if (box) UI.setHTML(box, rivalsList());
    UI.syncUrl?.(); // the search and sort are in the address, so a reload keeps them
  }

  // ---- 2. Which keywords do they beat me on? --------------------------------------------------------
  /* Each competitor is compared with the sites it's linked to, which isn't always the site doing best overall. */
  function aheadChip(k, a) {
    const other = a.my_host && a.my_host !== k.my_best?.host ? `<span class="second">${esc(fill("ahead of {site}, {position}", { site: a.my_host, position: `#${a.my_position}` }))}</span>` : "";
    return `<li><span class="with-logo">${UI.siteLogo(a.host, 16)}<span class="logo-text"><span class="mono small" dir="auto">${esc(a.display || a.host)}</span> <b class="tabular">#${a.position}</b>${other}</span></span></li>`;
  }

  function keywordFind(k) {
    const host = k.my_best?.host || k.my_sites[0];
    const who = k.rivals_ahead.map((a) => a.host);
    return { title: `${t("Competitors ahead on")} ${k.keyword}`, host, keywords: [k.keyword], source: { type: "competitor", label: k.keyword, host, facts: [engineName(k.engine), k.tool, ...who.slice(0, 3)].filter(Boolean), link: "#competitors/summary", key: `summary|keyword|${k.keyword_id}` } };
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
  const SHOWN_AHEAD = 3;
  function aheadCell(k) {
    const all = k.rivals_ahead;
    const fold = all.length >= SHOWN_AHEAD + 2;
    const first = fold ? all.slice(0, SHOWN_AHEAD) : all, rest = fold ? all.slice(SHOWN_AHEAD) : [];
    return `<ul class="cs-ahead">${first.map((a) => aheadChip(k, a)).join("")}</ul>${rest.length ? `<details class="cs-rest"><summary><span class="cs-rest-closed">${esc(fill(t("Show {n} more"), { n: UI.num(rest.length) }))}</span><span class="cs-rest-open">${esc(t("Show less"))}</span></summary><ul class="cs-ahead">${rest.map((a) => aheadChip(k, a)).join("")}</ul></details>` : ""}`;
  }

  /* Four columns: the keyword (with where and when it was checked), your place and its last move, who's ahead, a task. */
  /* Where a keyword was checked. When every row shown says the same, with the same age, it's said once under the table. */
  const whereChecked = (k) => `${k.country} · ${engineName(k.engine)} · ${k.tool}`;
  const sameCheck = (rows) => rows.length > 1 && new Set(rows.map((k) => `${whereChecked(k)}|${COMP.ago(k.checked_at)}`)).size === 1;
  function keywordRow(k, once = false) {
    const many = S.site === COMP.ALL && k.my_best?.host;
    return `<tr>
      <td class="head-cell"><span class="kw mono" dir="auto">${esc(k.keyword)}</span>${once ? "" : `<span class="second">${esc(whereChecked(k))} · ${esc(COMP.ago(k.checked_at))}</span>`}</td>
      <td class="c cs-my-place" data-label="${attr("Your position")}"><div>${COMP.pos(k.my_best?.position, k.depth)}${many ? `<span class="second mono" dir="auto">${esc(k.my_best.host)}</span>` : ""}<span class="cs-move">${moveCell(k)}</span></div></td>
      <td data-label="${attr("Ahead of you")}"><div>${aheadCell(k)}</div></td>
      <td class="r nowrap" data-label="">${UI.taskButton(keywordFind(k), { label: "Task" })}</td>
    </tr>`;
  }

  function keywordsHtml() {
    const title = "Keywords they beat you on";
    if (S.errors.keywords) return failedCard("keywords", title);
    const d = S.data.keywords;
    if (!d) return loadingCard(title);
    // None is On: nothing is compared, so this isn't "nobody beats you". The switch is in the table above, so no button here.
    if (!d.total && d.coverage.checked && noneOn()) return `${sectionHead(title)}${COMP.empty(t("No competitor is tracked for keywords"), t("Switch a competitor to On in the table above, and the keywords they beat you on show here."))}`;
    if (!d.total) {
      const noChecks = !d.coverage.checked;
      // The banner at the top says what's missing and where to go; this box only says what will show here.
      const words = noChecks ? t("Positions appear here after the first check of your keywords. Viewing this page never spends a check.") : t("No competitor beats you on any keyword checked.");
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
        <option value="">${t("All competitors, together")} (${UI.num(searched.length)})</option>
        ${rivals.map((a) => `<option value="${esc(a.host)}" ${a.host === S.kwRival ? "selected" : ""}>${esc(a.display || a.host)} (${UI.num(countFor(a.host))})</option>`).join("")}
      </select></label>` : "";
    const tools = search || choose ? `<div class="cp-tools cs-tools">${search}${choose}</div>` : "";
    const head = `${sectionHead(title, t("Most competitors ahead first."), "A keyword counts once, however many of your sites track it. Where and when it was checked is under each keyword, or once under the table when it's the same for all.")}${tools}`;
    if (!shown.length) return `${head}${TP.state(PAGES.keywords).q ? noneFound(t("No keyword matches this search."), PAGES.keywords) : COMP.empty(t("Nothing to show with these filters"), t("Pick another competitor to see more keywords."))}`;
    const once = sameCheck(rows);
    const checkedOnce = once ? `<p class="small sec cs-kw-foot">${esc(fill("All checked with {tool}, {when}.", { tool: whereChecked(rows[0]), when: COMP.ago(rows[0].checked_at) }))}</p>` : "";
    const capped = d.total > d.keywords.length ? fill("The {sent} with the most competitors ahead are listed, of {total}.", { sent: UI.num(d.keywords.length), total: UI.num(d.total) }) : null;
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
    return [
      d.blocked.length ? `<p class="help">${UI.icon("triangle-alert")} ${esc(fill("Page changes can't be tracked for {hosts}: they don't allow automated visitors, so no change here doesn't mean nothing changed.", { hosts: names(d.blocked) }))}</p>` : "",
      d.not_started.length ? `<p class="help">${esc(fill("Not watched yet: {hosts}. The first read only sets a starting point.", { hosts: names(d.not_started) }))}</p>` : "",
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
        <option value="">${t("All competitors, together")} (${UI.num(inKind(searched).length)})</option>
        ${rivals.map((r) => `<option value="${esc(r.id)}" ${String(r.id) === S.mvRival ? "selected" : ""}>${esc(r.display || r.host)} (${UI.num(inKind(searched).filter((e) => e.rival.id === r.id).length)})</option>`).join("")}
      </select></label>` : "";
    const period = `<label class="field"><span>${t("Period")}</span><select class="select" id="cs-mv-days">${PERIODS.map((n) => `<option value="${n}" ${n === S.mvDays ? "selected" : ""}>${esc(fill(n === 365 ? "The last year" : "The last {n} days", { n: UI.num(n) }))}</option>`).join("")}</select></label>`;
    return `<div class="cp-tools cs-tools">${TP.search(PAGES.moves, t("Search pages, keywords, titles"))}${choose}${period}</div>${chips}`;
  }

  function movesHtml() {
    const title = "Who is moving";
    if (S.errors.moves) return failedCard("moves", title);
    const d = S.data.moves;
    if (!d) return loadingCard(title);
    const days = d.days || S.mvDays;
    const sub = fill(days === 365 ? "The last year, newest first. Open All the details on a row for everything known about that page or check." : "The last {n} days, newest first. Open All the details on a row for everything known about that page or check.", { n: UI.num(days) });
    if (!d.moves.length) return `${sectionHead(title, sub)}${movesTools(d, (x) => x)}${movesNote(d)}${COMP.empty(t(days === 365 ? "Nothing in the last year" : "Nothing in this period"), t("Page changes and ranking moves appear here as they're found."))}`;
    const kind = (COMP.TIMELINE_FILTERS || []).find((f) => f[0] === S.mvKind);
    const inKind = (list) => (kind?.[2] ? list.filter((e) => kind[2].includes(e.kind)) : list);
    const shown = inKind(d.moves.filter((e) => TP.matches(PAGES.moves, moveText(e)))).filter((e) => !S.mvRival || String(e.rival.id) === S.mvRival);
    const page = TP.view(PAGES.moves, shown);
    const capped = d.total > d.moves.length ? fill("The newest {sent} are listed, of {total}.", { sent: UI.num(d.moves.length), total: UI.num(d.total) }) : null;
    const list = shown.length
      ? `<section class="card cs-compact"><ul class="rows cl-tl" id="cs-moves-list">${page.rows.map((e) => COMP.timelineRow(e, { id: e.rival.id, rival: e.rival.host, display: e.rival.display, own: e.rival.sites[0]?.host })).join("")}</ul></section>${TP.footer(PAGES.moves, page, { noun: t("changes"), capped })}`
      : noneFound(t("No change matches these filters."), PAGES.moves);
    return `${sectionHead(title, sub)}${movesTools(d, inKind)}${movesNote(d)}<div class="cs-pages">${list}</div>`;
  }

  // ---- 4. Which links do many rivals share? ---------------------------------------------------------
  /* Good for one site can be flagged for another, so each of my sites says where it stands. Only a good one can be added. */
  function siteState(g, s) {
    const label = `<span class="mono small" dir="auto">${esc(s.host)}</span>`;
    const lost = s.lost_link ? `<span class="tag cg-lost">${UI.icon("link-2-off")}${t("You lost this link")}</span>` : "";
    let state;
    if (s.in_consideration || COMP.gapConsidered(g.domain, s.host)) state = `<span class="tag cp-yours">${t("In consideration")}</span>`;
    else if (s.quality === "good") state = `<button class="btn btn-small" data-cs-add="${esc(g.domain)}" data-cs-add-site="${s.id}" data-cs-add-host="${esc(s.host)}" aria-label="${esc(fill("Add {domain} for {site}", { domain: g.display || g.domain, site: s.host }))}">${UI.icon("plus")}${t("Add")}</button>`;
    else if (s.quality === "spam") state = `<span class="tag cg-flag">${UI.icon("ban")}${t("Spam")}</span><span class="second cg-why">${esc(COMP.spamWhy(s))}</span><button class="link-btn small" data-cs-review="${s.id}">${t("Open Link gaps")}</button>`;
    else state = `<span class="tag">${t("Still being checked")}</span>`;
    return `<li>${label}<span class="cs-state">${lost}${state}</span></li>`;
  }

  const linkRow = (g) => `<tr>
      <td class="head-cell"><span class="with-logo">${UI.siteLogo(g.domain)}<span class="logo-text"><span class="kw mono" dir="auto">${esc(g.display || g.domain)}</span>${g.title ? `<span class="second cg-title" dir="auto">${esc(g.title)}</span>` : ""}${g.is_competitor ? `<span class="tag">${t("One of your competitors")}</span>` : ""}</span></span></td>
      <td data-label="${attr("Links to")}"><span class="cp-tags cg-rivals">${g.rivals.map((r) => `<span class="tag" dir="auto">${esc(r.host)}</span>`).join(" ")}</span></td>
      <td class="c" data-label="${attr("How many")}">${UI.num(g.rival_count)}</td>
      <td class="c" data-label="${attr("Authority")}">${COMP.gapAuthority(g)}</td>
      <td data-label="${attr("Your sites")}"><ul class="cs-states">${g.sites.map((s) => siteState(g, s)).join("")}</ul></td>
      <td class="r nowrap" data-label=""><button class="btn btn-small" data-cs-edit="${esc(g.domain)}" aria-label="${attr("Edit")}: ${esc(g.display || g.domain)}">${UI.icon("pencil")}${t("Edit")}</button></td>
    </tr>`;

  /* Both tables (good and flagged) share one search and one order, and each has its own pages. */
  const linkHead = (key, label, cls = "") => sortButtonHead("data-cs-ln-sort", key, label, S.lnSort, cls);
  const linkTable = (id, key, page, noun, capped = null) => `<div class="cs-pages"><div class="table-wrap"><table class="data" id="${id}">
      <thead><tr>${linkHead("domain", "Domain")}<th scope="col">${t("Links to")}</th>${linkHead("count", "How many", "c")}${linkHead("authority", "Authority", "c")}<th scope="col">${t("Your sites")}</th><th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead>
      <tbody>${page.rows.map(linkRow).join("")}</tbody>
    </table></div>${TP.footer(key, page, { noun, capped })}</div>`;
  const LN_SORTS = { domain: (g) => g.display || g.domain, count: (g) => g.rival_count, authority: (g) => g.authority ?? null };
  const LN_FIRST = { domain: "up", count: "down", authority: "down" };

  function linksHtml() {
    const title = "Links many competitors share";
    if (S.errors.links) return failedCard("links", title);
    const d = S.data.links;
    if (!d) return loadingCard(title);
    const f = d.funnel;
    if (!f.found) return `${linksHead(title, "", d)}${COMP.empty(t("No link data yet"), t("Upload a file for a competitor in Link gaps, and domains appear here."), `<button class="btn" data-cs-review="${COMP.siteId === COMP.ALL ? (UI.preferredSite(COMP.sites)?.id ?? "") : COMP.siteId}">${UI.icon("link-2-off")}${t("Open Link gaps")}</button>`)}`;
    // One search for both lists. A new search starts the flagged list on its first page too.
    const q = TP.state(PAGES.links).q;
    if (q !== S.linkQ) { S.linkQ = q; TP.reset(PAGES.flagged); }
    const find = (g) => TP.matches(PAGES.links, g.domain, g.display, g.title);
    const value = LN_SORTS[S.lnSort?.key] || (() => 0);
    const goodRows = sortList(d.gaps.filter(find), value, S.lnSort), flaggedRows = sortList(d.flagged.filter(find), value, S.lnSort);
    const page = TP.view(PAGES.links, goodRows), flaggedPage = TP.view(PAGES.flagged, flaggedRows);
    const search = d.gaps.length + d.flagged.length >= FIND_FROM || q ? `<div class="cp-tools cs-tools">${TP.search(PAGES.links, t("Search domains"))}</div>` : "";
    const facts = [
      fill("{with} of {total} competitors have link data", { with: UI.num(d.rivals_with_data), total: UI.num(d.rivals_total) }),
      f.checking ? plural(f.checking, "{n} domain still being checked", "{n} domains still being checked") : "",
    ].filter(Boolean).join(" · ");
    const capped = (sent, total) => (total > sent ? fill("The {sent} with the most competitors are listed, of {total}.", { sent: UI.num(sent), total: UI.num(total) }) : null);
    const flaggedBody = flaggedRows.length ? linkTable("cs-flagged-table", PAGES.flagged, flaggedPage, t("domains"), capped(d.flagged.length, f.flagged)) : `<p class="small sec cs-find-count">${esc(fill("No domain matches “{text}”.", { text: q }))}</p>`;
    const flagged = d.flagged.length ? `<details class="fold cs-flagged" ${S.flaggedOpen ? "open" : ""}><summary>${UI.icon("chevron-right")}${esc(plural(f.flagged, "{n} flagged as spam", "{n} flagged as spam"))}</summary>${flaggedBody}</details>` : "";
    const good = goodRows.length ? linkTable("cs-links-table", PAGES.links, page, t("domains"), capped(d.gaps.length, f.good))
      : q && d.gaps.length ? noneFound(fill("No domain matches “{text}”.", { text: q }), PAGES.links)
        : COMP.empty(t("No good domains yet"), t("None of the domains found has passed the spam check yet."));
    return `${linksHead(title, `${t("Most competitors first.")} ${facts}.`, d)}${search}${good}${flagged}`;
  }

  const SECTION = { rivals: rivalsHtml, keywords: keywordsHtml, moves: movesHtml, links: linksHtml };
  const SORT_DIRS = new Set(["up", "down"]);

  // ---- the tab ---------------------------------------------------------------------------------------
  const tab = {
    id: "summary", order: 0, label: "Competitors", icon: "crosshair",
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
        return COMP.empty(t("Know one already?"), t("Add a competitor's address by hand, one or up to 200 at once."), `<div class="cl-empty-acts"><button class="btn" id="cl-add-open">${UI.icon("plus")}${t("Add competitors")}</button></div>`);
      }
      if (S.data.rivals && !allRivals().length) {
        return COMP.empty(t("No competitors yet"), t("Upload your keyword list in Find competitors to see who really ranks against you, or add a competitor by hand."), `<div class="cl-empty-acts"><button class="btn btn-main" data-cl-go-find>${UI.icon("target")}${t("Find competitors")}</button><button class="btn" id="cl-add-open">${UI.icon("plus")}${t("Add competitors")}</button></div>`);
      }
      return `<p class="small sec cs-basis" id="cs-basis">${basisHtml()}</p>
        <section class="tiles cs-tiles" id="cs-tiles" aria-label="${attr("Summary")}">${tilesHtml()}</section>
        ${SECTIONS.map((part) => `<section class="cs-section" id="cs-${part}">${SECTION[part]()}</section>`).join("")}`;
    },
  };
  COMP.addTab(tab);

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
      if ((el = hit("[data-cs-mv-kind]"))) {
        S.mvKind = el.dataset.csMvKind; TP.reset(PAGES.moves); paintSection("moves");
        UI.$(`[data-cs-mv-kind="${S.mvKind}"]`)?.focus({ preventScroll: true });
        return;
      }
      if ((el = hit("[data-cs-jump]"))) {
        const section = UI.$(`#cs-${el.dataset.csJump}`);
        section?.scrollIntoView({ block: "start" });
        section?.querySelector("h2")?.focus({ preventScroll: true });
        return;
      }
      if ((el = hit("[data-cs-open]"))) { COMP.open("list", { competitorId: Number(el.dataset.csOpen) }, Number(el.dataset.csSite)); return; }
      if ((el = hit("[data-cs-row]")) && !hit("a, button, input, select, textarea, summary, label")) { COMP.open("list", { competitorId: Number(el.dataset.csRow) }, Number(el.dataset.csRowSite)); return; }
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
    "Filter the changes": "Filtrer les changements", "Period": "Période", "The last year": "La dernière année", "The last {n} days": "Les {n} derniers jours",
    "Search pages, keywords, titles": "Chercher une page, un mot-clé, un titre", "changes": "changements", "No change matches these filters.": "Aucun changement ne correspond à ces filtres.",
    "The last {n} days, newest first. Open All the details on a row for everything known about that page or check.": "Les {n} derniers jours, du plus récent au plus ancien. Ouvrez Tous les détails sur une ligne pour tout ce qu'on sait de cette page ou de cette vérification.",
    "The last year, newest first. Open All the details on a row for everything known about that page or check.": "La dernière année, du plus récent au plus ancien. Ouvrez Tous les détails sur une ligne pour tout ce qu'on sait de cette page ou de cette vérification.",
    "Nothing in the last year": "Rien sur la dernière année", "Nothing in this period": "Rien sur cette période",
    "Changes in {n} days": "Changements sur {n} jours", "Changes in the last year": "Changements sur la dernière année",
    "Know one already?": "Vous en connaissez déjà un ?",
    "competitors": "concurrents", "keywords": "mots-clés", "domains": "domaines",
    "Search keywords": "Chercher un mot-clé", "Search domains": "Chercher un domaine",
    "Competitor": "Concurrent", "All competitors, together": "Tous les concurrents, ensemble",
    "No keyword matches this search.": "Aucun mot-clé ne correspond à cette recherche.",
    "No domain matches “{text}”.": "Aucun domaine ne correspond à « {text} ».",
    "Nothing to show with these filters": "Rien à afficher avec ces filtres",
    "Pick another competitor to see more keywords.": "Choisissez un autre concurrent pour voir d'autres mots-clés.",
    "Clear the search": "Effacer la recherche",
    "Keyword": "Mot-clé", "Domain": "Domaine", "How many": "Combien", "Authority": "Autorité",
    "Find a competitor": "Chercher un concurrent",
    "No competitor matches “{text}”.": "Aucun concurrent ne correspond à « {text} ».",
    "{n} of {total} competitors match.": "{n} concurrents sur {total} correspondent.",
    "Show all": "Tout afficher",
    "Add a competitor's address by hand, one or up to 200 at once.": "Ajoutez l'adresse d'un concurrent à la main, une seule ou jusqu'à 200 à la fois.",
    "Summary": "Synthèse",
    "Ranks on your keywords": "Se classe sur vos mots-clés",
    "Who leads": "Qui est devant",
    "Who is ahead on the keywords you share, and how many keywords you weren't found on": "Qui est devant sur les mots-clés communs, et sur combien de mots-clés vous êtes introuvable",
    "you're absent on {n}": "vous êtes absent sur {n}",
    "No ranking check yet": "Aucune vérification de classement",
    "The first read isn't done yet.": "La première lecture n'est pas terminée.",
    "Tracking is off: its pages aren't read.": "Suivi désactivé : ses pages ne sont pas lues.",
    "You're watching {n} competitor.": "Vous suivez {n} concurrent.", "You're watching {n} competitors.": "Vous suivez {n} concurrents.",
    "You're watching {w} of {n} competitors.": "Vous suivez {w} concurrents sur {n}.", "You're watching 1 of {n} competitors.": "Vous suivez 1 concurrent sur {n}.",
    "The first read only sets the starting point. Edits show from the next daily read.": "La première lecture ne fait que poser le point de départ. Les modifications apparaissent à partir de la prochaine lecture quotidienne.",
    "First reads only set the starting point": "Les premières lectures ne font que poser le point de départ",
    "None of their pages could be read yet": "Aucune de leurs pages n'a encore pu être lue",
    "Every competitor is paused": "Tous les concurrents sont en pause",
    "A keyword counts once, however many of your sites track it. Where and when it was checked is under each keyword, or once under the table when it's the same for all.": "Un mot-clé compte une fois, quel que soit le nombre de vos sites qui le suivent. Où et quand il a été vérifié figure sous chaque mot-clé, ou une seule fois sous le tableau quand c'est pareil pour tous.",
    "Click it to open it.": "Cliquez dessus pour l'ouvrir.", "Click one to open it.": "Cliquez sur l'un d'eux pour l'ouvrir.",
    "{n} competitor, paused. Switch it to On to compare keywords.": "{n} concurrent, en pause. Passez-le sur Activé pour comparer les mots-clés.",
    "{n} competitors, all paused. Switch one to On to compare keywords.": "{n} concurrents, tous en pause. Passez-en un sur Activé pour comparer les mots-clés.",
    "None is tracked for keywords: switch one to On to compare keywords.": "Aucun n'est suivi pour les mots-clés : passez-en un sur Activé pour les comparer.",
    "No competitor is tracked for keywords": "Aucun concurrent n'est suivi pour les mots-clés",
    "Switch a competitor to On in the table above, and the keywords they beat you on show here.": "Passez un concurrent sur Activé dans le tableau ci-dessus : les mots-clés où il vous bat s'afficheront ici.",
    "Most keywords where they beat you first. The icons are your sites: one opens the competitor for that site.": "D'abord ceux qui vous battent sur le plus de mots-clés. Les icônes sont vos sites : chacune ouvre le concurrent pour ce site.",
    "Most keywords where they beat you first.": "D'abord ceux qui vous battent sur le plus de mots-clés.",
    "Add competitors": "Ajouter des concurrents",
    "Positions appear here after the first check of your keywords. Viewing this page never spends a check.": "Les positions apparaissent ici après la première vérification de vos mots-clés. Consulter cette page ne consomme aucune vérification.",
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
    "Open {rival}": "Ouvrir {rival}",
    "Open {rival} for {site}": "Ouvrir {rival} pour {site}",
    "across {n} site": "sur {n} site",
    "across {n} sites": "sur {n} sites",
    "Keywords they beat you on": "Mots-clés où ils vous battent",
    "Changes in 30 days": "Changements en 30 jours",
    "Domains linking to 2 or more": "Domaines liés à 2 concurrents ou plus",
    "{n} good domain in all": "{n} bon domaine au total",
    "{n} good domains in all": "{n} bons domaines au total",
    "No keywords uploaded yet, so there's nothing to compare positions on.": "Aucun mot-clé importé pour l'instant : il n'y a pas de positions à comparer.",
    "{n} keyword saved, none checked yet. Ranking numbers show — until they are.": "{n} mot-clé enregistré, aucun vérifié. Les chiffres de classement affichent — en attendant.",
    "{n} keywords saved, none checked yet. Ranking numbers show — until they are.": "{n} mots-clés enregistrés, aucun vérifié. Les chiffres de classement affichent — en attendant.",
    "checked {when}": "vérifiés {when}",
    "newest check {newest}, oldest {oldest}": "vérification la plus récente {newest}, la plus ancienne {oldest}",
    "{checked} of {total} keywords checked, with {tools}": "{checked} mots-clés vérifiés sur {total}, avec {tools}",
    "Positions are only compared inside one check.": "Les positions ne sont comparées qu'au sein d'une même vérification.",
    "Showing {shown} of {total}": "{shown} affichés sur {total}",
    "The {sent} with the most competitors are listed, of {total}.": "Les {sent} liés au plus de concurrents sont listés, sur {total}.",
    "The {sent} with the most competitors ahead are listed, of {total}.": "Les {sent} avec le plus de concurrents devant vous sont listés, sur {total}.",
    "The newest {sent} are listed, of {total}.": "Les {sent} plus récents sont listés, sur {total}.",
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
    "Page changes and ranking moves appear here as they're found.": "Les changements de pages et de classement apparaissent ici dès qu'ils sont repérés.",
    "Page changes can't be tracked for {hosts}: they don't allow automated visitors, so no change here doesn't mean nothing changed.": "Impossible de suivre les pages de {hosts} : ces sites refusent les visiteurs automatisés. Aucun changement affiché ne veut donc pas dire qu'il ne s'est rien passé.",
    "Not watched yet: {hosts}. The first read only sets a starting point.": "Pas encore surveillés : {hosts}. La première lecture ne fixe qu'un point de départ.",
    "Links many competitors share": "Liens communs à plusieurs concurrents",
    "Add {domain} for {site}": "Ajouter {domain} pour {site}",
    "Open Link gaps": "Ouvrir Liens manquants",
    "No link data yet": "Pas encore de données de liens",
    "Upload a file for a competitor in Link gaps, and domains appear here.": "Importez un fichier pour un concurrent dans Liens manquants, et les domaines apparaîtront ici.",
    "{with} of {total} competitors have link data": "{with} concurrents sur {total} ont des données de liens",
    "{n} domain still being checked": "{n} domaine encore en cours de vérification",
    "{n} domains still being checked": "{n} domaines encore en cours de vérification",
    "{n} flagged as spam": "{n} signalés comme spam",
    "No good domains yet": "Pas encore de bons domaines",
    "None of the domains found has passed the spam check yet.": "Aucun des domaines trouvés n'a encore passé le contrôle anti-spam.",
    "Most competitors first. Spam is flagged, never removed, and only good domains can be added.": "D'abord ceux liés au plus de concurrents. Le spam est signalé, jamais retiré, et seuls les bons domaines peuvent être ajoutés.",
  });
})();
