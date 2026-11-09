/* Competitors area: Summary. All my competitors together, across my sites (COMP.ALL) or narrowed to one by the dropdown.
   Four questions, each loading and failing on its own, so a slow list of links can't hold up the rest.
   It only reads. Numbers come from seo/competitors/collective.py, which holds the counting rules. */
(() => {
  "use strict";
  const COMP = window.COMP;
  let UI = null, t = null, esc = null;
  const SECTIONS = ["rivals", "keywords", "moves", "links"];
  const FIRST_ROWS = 25, MORE_ROWS = 50;
  const S = { site: null, token: 0, data: {}, errors: {}, limit: {} };

  const fill = (words, values) => t(words).replace(/\{(\w+)\}/g, (all, name) => (name in values ? values[name] : all));
  const attr = (words) => esc(t(words));
  const plural = (n, one, many) => fill(n === 1 ? one : many, { n: UI.num(n) });
  const engineName = (id) => UI.ENGINES.find(([key]) => key === id)?.[1] || id || "";
  const blank = `<span class="muted">—</span>`;
  const count = (n) => (n === null || n === undefined ? blank : UI.num(n));
  const pathFor = (part, site) => `collective/${part}${site === COMP.ALL ? "" : `?site_id=${site}`}`;

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

  function paintSection(part) {
    if (UI.state.route !== "competitors" || COMP.currentTab() !== tab) return;
    if (part === "rivals" && S.data.rivals && !S.data.rivals.rivals.length) { COMP.paint(); return; } // no competitors: the whole page becomes one message
    const box = UI.$(`#cs-${part}`);
    if (box) UI.setHTML(box, SECTION[part]());
    const tiles = UI.$("#cs-tiles"), basisLine = UI.$("#cs-basis");
    if (tiles) UI.setHTML(tiles, tilesHtml());
    if (basisLine) UI.setHTML(basisLine, basisHtml());
  }

  const refreshLinks = () => fetchSection("links", S.token, S.site);

  // ---- the top of the page ---------------------------------------------------------------------
  function basisHtml() {
    const c = S.data.rivals?.coverage;
    if (!c) return "";
    if (!c.keywords) return esc(t("No keywords uploaded yet, so there's nothing to compare positions on."));
    if (!c.checked) return esc(plural(c.keywords, "{n} keyword saved, none checked yet. Ranking numbers show — until they are.", "{n} keywords saved, none checked yet. Ranking numbers show — until they are."));
    const when = c.newest === c.oldest ? fill("checked {when}", { when: COMP.ago(c.newest) }) : fill("newest check {newest}, oldest {oldest}", { newest: COMP.ago(c.newest), oldest: COMP.ago(c.oldest) });
    return esc(`${fill("{checked} of {total} keywords checked, with {tools}", { checked: UI.num(c.checked), total: UI.num(c.keywords), tools: c.tools.join(", ") })}, ${when}. ${t("Positions are only compared inside one check.")}`);
  }

  /* Unknown is unknown: with nothing checked, read or uploaded, a card says — and not 0. */
  function tilesHtml() {
    const one = (part, label, value, sub, ic) => {
      const words = value === null ? "…" : value === undefined ? "—" : UI.num(value);
      return `<button type="button" class="cs-jump" data-cs-jump="${part}" aria-label="${attr(label)}: ${esc(words)}">${UI.tile(t(label), value === null || value === undefined ? `<span class="muted">${words}</span>` : UI.num(value), sub ? `<span class="ab">${esc(sub)}</span>` : "", { ic })}</button>`;
    };
    const d = S.data;
    const siteCount = (d.rivals || d.keywords || d.moves || d.links)?.sites?.length;
    const known = (answer, isKnown, value) => (!answer ? null : isKnown ? value : undefined);
    const nothingRead = d.moves && d.rivals && d.moves.blocked.length + d.moves.not_started.length >= d.rivals.rivals.length;
    const hasLinks = d.links && d.links.rivals_with_data > 0;
    return [
      one("rivals", "Competitors", d.rivals ? d.rivals.rivals.length : null, siteCount ? plural(siteCount, "across {n} site", "across {n} sites") : "", "crosshair"),
      one("keywords", "Keywords they beat you on", known(d.keywords, d.keywords?.coverage.checked > 0, d.keywords?.total), "", "trending-up"),
      one("moves", "Changes in 30 days", known(d.moves, d.moves?.total > 0 || !nothingRead, d.moves?.total), "", "activity"),
      one("links", "Domains linking to 2 or more", known(d.links, hasLinks, d.links?.funnel.shared), hasLinks ? plural(d.links.funnel.good, "{n} good domain in all", "{n} good domains in all") : "", "link-2"),
    ].join("");
  }

  // ---- shared pieces -------------------------------------------------------------------------------
  const sectionHead = (title, sub = "") => `<div class="cs-head"><h2 tabindex="-1">${esc(t(title))}</h2>${sub ? `<p class="small sec">${esc(sub)}</p>` : ""}</div>`;
  /* Every competitor in view, so a link can be ticked for one a domain isn't listed under yet. */
  const rivalsInView = (d) => [...new Map([...(d.rivals || []), ...[...d.gaps, ...d.flagged].flatMap((row) => row.rivals)].map((r) => [r.id, r])).values()].sort((a, b) => a.host.localeCompare(b.host));
  const linksHead = (title, sub, d) => `<div class="cs-head-row">${sectionHead(title, sub)}${rivalsInView(d).length ? `<button class="btn btn-small" data-cs-add-domain>${UI.icon("plus")}${t("Add a domain")}</button>` : ""}</div>`;
  const loadingCard = (title) => `${sectionHead(title)}${COMP.loading()}`;
  const failedCard = (part, title) => `${sectionHead(title)}<div class="table-wrap"><div class="empty"><h3>${t("That didn't load")}</h3><p>${esc(t(S.errors[part]))}</p><button class="btn" data-cs-retry="${part}">${UI.icon("refresh-cw")}${t("Try again")}</button></div></div>`;
  const limitOf = (part) => S.limit[part] || FIRST_ROWS;
  function moreButton(part, shown, total) {
    if (shown >= total) return "";
    return `<div class="cs-more"><span class="small sec">${esc(fill("Showing {shown} of {total}", { shown: UI.num(shown), total: UI.num(total) }))}</span><button class="btn btn-small" data-cs-more="${part}">${t("Show more")}</button></div>`;
  }
  /* The server keeps its lists short. Say so when there's more than it sent. */
  const sentNote = (sent, total) => (total > sent ? `<p class="help">${esc(fill("The {sent} with the most competitors are listed, of {total}.", { sent: UI.num(sent), total: UI.num(total) }))}</p>` : "");
  const siteChip = (rival, site) => `<button type="button" class="chip cs-site mono" dir="auto" data-cs-open="${rival.id}" data-cs-site="${site.id}" aria-label="${esc(fill("Open {rival} for {site}", { rival: rival.display || rival.host, site: site.host }))}">${esc(site.host)}</button>`;

  // ---- 1. Who are my biggest rivals? ---------------------------------------------------------------
  const rivalRow = (r) => `<tr>
      <td class="head-cell"><span class="with-logo">${UI.siteLogo(r.host)}<span class="logo-text kw mono" dir="auto">${esc(r.display || r.host)}</span></span></td>
      <td data-label="${attr("Your sites")}"><span class="cs-sites">${r.sites.map((site) => siteChip(r, site)).join("")}</span></td>
      <td class="c" data-label="${attr("Keywords it ranks on")}">${count(r.ranks_on)}</td>
      <td class="c" data-label="${attr("They're ahead on")}">${count(r.they_ahead)}</td>
      <td class="c" data-label="${attr("You're ahead on")}">${count(r.i_ahead)}</td>
      <td class="c" data-label="${attr("You weren't found on")}">${count(r.not_found)}</td>
      <td class="c" data-label="${attr("Edits in 30 days")}">${r.crawl?.status === "blocked" ? `<span class="muted" title="${attr("Edits can't be tracked on this site.")}">—</span>` : UI.num(r.edits_30d)}</td>
      <td data-label="${attr("Watching")}">${COMP.watching(r.crawl)}</td>
    </tr>`;

  function rivalsHtml() {
    const title = "Your biggest competitors";
    if (S.errors.rivals) return failedCard("rivals", title);
    const d = S.data.rivals;
    if (!d) return loadingCard(title);
    const rows = d.rivals.slice(0, limitOf("rivals"));
    return `${sectionHead(title, t("Most keywords where they beat you first. Pick one of your sites to open that competitor."))}
      <div class="table-wrap"><table class="data" id="cs-rivals-table">
        <thead><tr><th scope="col">${t("Competitor")}</th><th scope="col">${t("Your sites")}</th><th scope="col" class="c">${t("Keywords it ranks on")}</th><th scope="col" class="c">${t("They're ahead on")}</th><th scope="col" class="c">${t("You're ahead on")}</th><th scope="col" class="c" data-tip="${attr("Not in the results checked")}">${t("You weren't found on")}</th><th scope="col" class="c">${t("Edits in 30 days")}</th><th scope="col">${t("Watching")}</th></tr></thead>
        <tbody>${rows.map(rivalRow).join("")}</tbody>
      </table></div>${moreButton("rivals", rows.length, d.rivals.length)}`;
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

  function keywordRow(k) {
    return `<tr>
      <td class="head-cell"><span class="kw mono" dir="auto">${esc(k.keyword)}</span><span class="second">${esc(k.country)}</span></td>
      <td class="c cs-my-place" data-label="${attr("Your position")}"><div>${COMP.pos(k.my_best?.position, k.depth)}${k.my_best ? `<span class="second mono" dir="auto">${esc(k.my_best.host)}</span>` : ""}</div></td>
      <td data-label="${attr("Latest change")}"><div>${moveCell(k)}</div></td>
      <td class="c" data-label="${attr("How many")}">${UI.num(k.rivals_ahead.length)}</td>
      <td data-label="${attr("Ahead of you")}"><div>${aheadCell(k)}</div></td>
      <td data-label="${attr("Checked with")}"><div><span class="small">${esc(engineName(k.engine))} · ${esc(k.tool)}</span><span class="second">${esc(COMP.ago(k.checked_at))}</span></div></td>
      <td class="r nowrap" data-label="">${UI.taskButton(keywordFind(k), { label: "Task" })}</td>
    </tr>`;
  }

  function keywordsHtml() {
    const title = "Keywords they beat you on";
    if (S.errors.keywords) return failedCard("keywords", title);
    const d = S.data.keywords;
    if (!d) return loadingCard(title);
    if (!d.total) {
      const noChecks = !d.coverage.checked;
      const words = noChecks ? t("This needs ranking checks. Add a search tool's key in Settings, then press Refresh on one of your sites. Viewing this page never spends a check.") : t("No competitor beats you on any keyword checked.");
      return `${sectionHead(title)}${COMP.empty(t(noChecks ? "No ranking checks yet" : "Nothing here"), words, noChecks ? `<button class="btn" data-cl-settings>${UI.icon("settings")}${t("Open Settings")}</button>` : "")}`;
    }
    const rows = d.keywords.slice(0, limitOf("keywords"));
    return `${sectionHead(title, t("Most competitors ahead first. A keyword counts once, however many of your sites track it."))}
      <div class="table-wrap"><table class="data" id="cs-keywords-table">
        <thead><tr><th scope="col">${t("Keyword")}</th><th scope="col" class="c">${t("Your position")}</th><th scope="col">${t("Latest change")}</th><th scope="col" class="c">${t("How many")}</th><th scope="col">${t("Ahead of you")}</th><th scope="col">${t("Checked with")}</th><th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead>
        <tbody>${rows.map(keywordRow).join("")}</tbody>
      </table></div>${moreButton("keywords", rows.length, d.keywords.length)}${d.total > d.keywords.length ? `<p class="help">${esc(fill("The {sent} with the most competitors ahead are listed, of {total}.", { sent: UI.num(d.keywords.length), total: UI.num(d.total) }))}</p>` : ""}`;
  }

  // ---- 3. Who is moving right now? ------------------------------------------------------------------
  function movesNote(d) {
    const names = (hosts) => hosts.slice(0, 3).join(", ") + (hosts.length > 3 ? ` ${fill("and {n} more", { n: UI.num(hosts.length - 3) })}` : "");
    return [
      d.blocked.length ? `<p class="help">${UI.icon("triangle-alert")} ${esc(fill("Page changes can't be tracked for {hosts}: they don't allow automated visitors, so no change here doesn't mean nothing changed.", { hosts: names(d.blocked) }))}</p>` : "",
      d.not_started.length ? `<p class="help">${esc(fill("Not watched yet: {hosts}. The first read only sets a starting point.", { hosts: names(d.not_started) }))}</p>` : "",
    ].join("");
  }

  function movesHtml() {
    const title = "Who is moving";
    if (S.errors.moves) return failedCard("moves", title);
    const d = S.data.moves;
    if (!d) return loadingCard(title);
    const sub = t("The last 30 days, newest first.");
    if (!d.moves.length) return `${sectionHead(title, sub)}${movesNote(d)}${COMP.empty(t("Nothing in the last 30 days"), t("Page changes and ranking moves appear here as they're found."))}`;
    const rows = d.moves.slice(0, limitOf("moves"));
    return `${sectionHead(title, sub)}${movesNote(d)}
      <section class="card"><ul class="rows cl-tl" id="cs-moves-list">${rows.map((e) => COMP.timelineRow(e, { id: e.rival.id, rival: e.rival.host, display: e.rival.display, own: e.rival.sites[0]?.host })).join("")}</ul></section>
      ${moreButton("moves", rows.length, d.moves.length)}${d.total > d.moves.length ? `<p class="help">${esc(fill("The newest {sent} are listed, of {total}.", { sent: UI.num(d.moves.length), total: UI.num(d.total) }))}</p>` : ""}`;
  }

  // ---- 4. Which links do many rivals share? ---------------------------------------------------------
  /* Good for one site can be flagged for another, so each of my sites says where it stands. Only a good one can be added. */
  function siteState(g, s) {
    const label = `<span class="mono small" dir="auto">${esc(s.host)}</span>`;
    const lost = s.lost_link ? `<span class="tag cg-lost">${UI.icon("link-2-off")}${t("You lost this link")}</span>` : "";
    let state;
    if (s.in_consideration || COMP.gapConsidered(g.domain, s.host)) state = `<span class="tag cp-yours">${t("In consideration")}</span>`;
    else if (s.quality === "good") state = `<button class="btn btn-small" data-cs-add="${esc(g.domain)}" data-cs-add-site="${s.id}" data-cs-add-host="${esc(s.host)}" aria-label="${esc(fill("Add {domain} for {site}", { domain: g.display || g.domain, site: s.host }))}">${UI.icon("plus")}${t("Add")}</button>`;
    else if (s.quality === "spam") state = `<span class="tag cg-flag">${UI.icon("ban")}${t("Spam")}</span><span class="second cg-why">${esc(t(s.reason_words || "Flagged as spam"))}</span><button class="link-btn small" data-cs-review="${s.id}">${t("Open Link gaps")}</button>`;
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

  const linkTable = (id, rows) => `<div class="table-wrap"><table class="data" id="${id}">
      <thead><tr><th scope="col">${t("Domain")}</th><th scope="col">${t("Links to")}</th><th scope="col" class="c">${t("How many")}</th><th scope="col" class="c">${t("Authority")}</th><th scope="col">${t("Your sites")}</th><th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead>
      <tbody>${rows.map(linkRow).join("")}</tbody>
    </table></div>`;

  function linksHtml() {
    const title = "Links many competitors share";
    if (S.errors.links) return failedCard("links", title);
    const d = S.data.links;
    if (!d) return loadingCard(title);
    const f = d.funnel;
    if (!f.found) return `${linksHead(title, "", d)}${COMP.empty(t("No link data yet"), t("Run Common Crawl or upload a file for a competitor in Link gaps, and domains appear here."), `<button class="btn" data-cs-review="${COMP.siteId === COMP.ALL ? (UI.preferredSite(COMP.sites)?.id ?? "") : COMP.siteId}">${UI.icon("link-2-off")}${t("Open Link gaps")}</button>`)}`;
    const rows = d.gaps.slice(0, limitOf("links"));
    const facts = [
      fill("{with} of {total} competitors have link data", { with: UI.num(d.rivals_with_data), total: UI.num(d.rivals_total) }),
      f.checking ? plural(f.checking, "{n} domain still being checked", "{n} domains still being checked") : "",
    ].filter(Boolean).join(" · ");
    const flagged = d.flagged.length ? `<details class="fold cs-flagged"><summary>${UI.icon("chevron-right")}${esc(plural(f.flagged, "{n} flagged as spam", "{n} flagged as spam"))}</summary>${linkTable("cs-flagged-table", d.flagged.slice(0, limitOf("flagged")))}${moreButton("flagged", Math.min(limitOf("flagged"), d.flagged.length), d.flagged.length)}${sentNote(d.flagged.length, f.flagged)}</details>` : "";
    const good = rows.length ? linkTable("cs-links-table", rows) : COMP.empty(t("No good domains yet"), t("None of the domains found has passed the spam check yet."));
    return `${linksHead(title, `${t("Most competitors first. Spam is flagged, never removed, and only good domains can be added.")} ${facts}.`, d)}${good}${moreButton("links", rows.length, d.gaps.length)}${sentNote(d.gaps.length, f.good)}${flagged}`;
  }

  const SECTION = { rivals: rivalsHtml, keywords: keywordsHtml, moves: movesHtml, links: linksHtml };

  // ---- the tab ---------------------------------------------------------------------------------------
  const tab = {
    id: "summary", order: 0, label: "Summary", icon: "layout-dashboard",
    init(helpers) { UI = helpers; t = helpers.t; esc = helpers.esc; bindEvents(); },
    load() {
      S.token += 1;
      S.site = COMP.siteId;
      S.data = {};
      S.errors = {};
      S.limit = {};
      SECTIONS.forEach((part) => { fetchSection(part, S.token, S.site); });
    },
    body() {
      if (S.site !== COMP.siteId) return COMP.loading();
      if (S.data.rivals && !S.data.rivals.rivals.length) {
        return COMP.empty(t("No competitors yet"), t("Upload your keyword list in Find competitors to see who really ranks against you, or add a competitor by hand."), `<div class="cl-empty-acts"><button class="btn btn-main" data-cl-go-find>${UI.icon("target")}${t("Find competitors")}</button><button class="btn" id="cl-add-open">${UI.icon("plus")}${t("Add competitors")}</button></div>`);
      }
      return `<p class="small sec cs-basis" id="cs-basis">${basisHtml()}</p>
        <section class="tiles cs-tiles" id="cs-tiles" aria-label="${attr("Summary")}">${tilesHtml()}</section>
        ${SECTIONS.map((part) => `<section class="cs-section" id="cs-${part}">${SECTION[part]()}</section>`).join("")}`;
    },
  };
  COMP.addTab(tab);

  function bindEvents() {
    document.addEventListener("click", async (e) => {
      if (UI.state.route !== "competitors" || COMP.currentTab() !== tab) return;
      const hit = (selector) => e.target.closest?.(selector);
      let el;
      if ((el = hit("[data-cs-jump]"))) {
        const section = UI.$(`#cs-${el.dataset.csJump}`);
        section?.scrollIntoView({ block: "start" });
        section?.querySelector("h2")?.focus({ preventScroll: true });
        return;
      }
      if ((el = hit("[data-cs-open]"))) { COMP.open("list", { competitorId: Number(el.dataset.csOpen) }, Number(el.dataset.csSite)); return; }
      if ((el = hit("[data-cs-review]"))) { COMP.open("gaps", {}, Number(el.dataset.csReview)); return; }
      if ((el = hit("[data-cs-retry]"))) {
        const part = el.dataset.csRetry;
        delete S.errors[part];
        paintSection(part);
        fetchSection(part, S.token, S.site);
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
    "Summary": "Synthèse",
    "Your sites": "Vos sites",
    "Keywords it ranks on": "Mots-clés où il se classe",
    "You weren't found on": "Où vous êtes introuvable",
    "Your biggest competitors": "Vos principaux concurrents",
    "Most keywords where they beat you first. Pick one of your sites to open that competitor.": "D'abord ceux qui vous battent sur le plus de mots-clés. Choisissez l'un de vos sites pour ouvrir ce concurrent.",
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
    "Run Common Crawl or upload a file for a competitor in Link gaps, and domains appear here.": "Lancez Common Crawl ou importez un fichier pour un concurrent dans Liens manquants, et les domaines apparaîtront ici.",
    "{with} of {total} competitors have link data": "{with} concurrents sur {total} ont des données de liens",
    "{n} domain still being checked": "{n} domaine encore en cours de vérification",
    "{n} domains still being checked": "{n} domaines encore en cours de vérification",
    "{n} flagged as spam": "{n} signalés comme spam",
    "No good domains yet": "Pas encore de bons domaines",
    "None of the domains found has passed the spam check yet.": "Aucun des domaines trouvés n'a encore passé le contrôle anti-spam.",
    "Most competitors first. Spam is flagged, never removed, and only good domains can be added.": "D'abord ceux liés au plus de concurrents. Le spam est signalé, jamais retiré, et seuls les bons domaines peuvent être ajoutés.",
  });
})();
