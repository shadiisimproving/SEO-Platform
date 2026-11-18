/* Competitors area: Link gaps. Domains that link to my competitors but not to me, from files the owner uploads.
   Nothing here calls a paid tool. Adding a domain makes a prospect on the Backlinks page: it isn't a backlink and never touches the top cards. */
(() => {
  "use strict";
  let UI = null;
  const S = { site: null, data: null, filter: "", hide: false, followed: null, old: false, quality: "all", reason: "", reach: "any", pa: "", sort: null, picked: new Set(), adding: false, openLink: null, linkSort: null };
  const PAGES = "cg"; // the table's pages and search (table-pages.js), like every long table in the app
  const LINK_PAGES = "cg-links"; // the same for the links of the one domain that is open
  let sync = Promise.resolve(); // calls caused by the Backlinks page, kept in the order they happened

  const t = (s) => UI.t(s);
  const esc = (v) => UI.esc(v);
  const fill = (words, values) => Object.entries(values).reduce((out, [key, value]) => out.split(`{${key}}`).join(value), t(words));
  const onScreen = () => UI.state.route === "competitors" && COMP.tab === "gaps";
  // An empty state with the short line on screen and the reason behind an (i) right after it.
  const emptyTip = (title, text, tip, action = "") => COMP.empty(title, text, action).replace("</p>", () => `${UI.tip(tip)}</p>`);

  /* The server's own sentences, in the language on screen. Headers and limits inside them change. */
  const serverWords = (message) => {
    const text = String(message);
    if (UI.state.lang !== "fr") return text;
    const noColumn = text.match(/^This CSV has no URL or domain column\. Headers found: (.*)\.$/);
    if (noColumn) return `Ce CSV n'a pas de colonne URL ou domaine. En-têtes trouvés : ${noColumn[1]}.`;
    return t(text);
  };

  // ---- the In consideration list on the Backlinks page -------------------------------------------
  const hostOf = (siteId) => COMP.sites.find((s) => s.id === siteId)?.host || "";
  const toProspect = (row, host) => ({
    id: `gap-${row.id}`, url: row.url, domain: row.domain, authority: row.authority ?? null, authorityLabel: row.authority_label || null,
    spam: row.spam_score ?? null, file: row.source_file || "", site: host, serverId: row.id, siteId: row.site_id, owner: row.owner || "", stage: row.stage || "new", sourceKind: row.source_kind || "link_gap", pageAuthority: row.page_authority ?? null, rating: row.rating ?? null,
  });
  /* Bring server rows into window.PROSPECTS, never twice. Returns the ones that are new here. */
  function absorb(rows, host) {
    const fresh = rows.filter((row) => !window.PROSPECTS.some((p) => p.serverId === row.id)).map((row) => toProspect(row, host));
    if (fresh.length) window.PROSPECTS = fresh.concat(window.PROSPECTS);
    return fresh;
  }
  const inConsideration = (gap) => gap.in_consideration || window.PROSPECTS.some((p) => p.domain === gap.domain && p.site === COMP.site()?.host);

  /* Every site's prospects in one request on load (not one per site), each filed under its own site. */
  async function loadExistingProspects() {
    const [answer, all] = await Promise.all([COMP.api("GET", "links/sites"), COMP.api("GET", "prospects").catch(() => null)]);
    if (!all) return; // the server can't answer now: what's on screen stays
    const hosts = new Map(answer.sites.map((site) => [site.id, site.host]));
    hosts.forEach((host, id) => absorb(all.prospects.filter((row) => row.site_id === id), host));
    if (UI.state.route === "backlinks") UI.render();
  }

  const quietly404 = (err) => { if (err.status !== 404) throw err; };

  /* Removed on the Backlinks page. Saving a link is that page's job: here the prospect only leaves the server, if saving the link hasn't already done it. */
  function prospectRemoved(event) {
    const gone = event.detail;
    if (!gone?.serverId) { tab.loadedFor = undefined; return; }
    tab.loadedFor = undefined;
    sync = sync.then(async () => {
      if (!gone.removedOnServer) await COMP.api("DELETE", `prospects/${gone.serverId}`).catch(quietly404);
    }).catch((err) => {
      // It's still on the server, so it goes back on screen.
      if (!window.PROSPECTS.some((p) => p.serverId === gone.serverId)) window.PROSPECTS.unshift(gone);
      if (UI.state.route === "backlinks") UI.render();
      COMP.fail(err);
    });
  }

  /* Undo on the Backlinks page puts the row back on screen, so it goes back on the server too, under a new number. */
  function prospectRestored(event) {
    const back = event.detail;
    if (!back?.serverId) return;
    tab.loadedFor = undefined;
    sync = sync.then(async () => {
      let row;
      if (back.sourceKind === "csv") {
        const answer = await COMP.api("POST", "prospects", { site_id: back.siteId, file: back.file || null, authority_label: back.authorityLabel || null, rows: [{ url: back.url, authority: back.authority, page_authority: back.pageAuthority ?? null, rating: back.rating ?? null, spam_score: back.spam, owner: back.owner || null, stage: back.stage || "new" }] });
        row = answer.added[0];
      } else {
        const answer = await COMP.api("POST", "link-gaps/add", { site_id: back.siteId, domains: [back.domain] });
        if (answer.added.includes(back.domain)) {
          row = (await COMP.api("GET", `prospects?site_id=${back.siteId}`)).prospects.find((p) => p.domain === back.domain);
          // The gap list only knows the domain, so what someone had set comes back separately.
          if (row && ((back.stage && back.stage !== "new") || back.owner || back.rating)) await COMP.api("PATCH", `prospects/${row.id}`, { stage: back.stage || "new", owner: back.owner || "", rating: back.rating ?? null });
        }
      }
      if (!row) { // it can't go back on the server, so say so rather than show a row that a reload would lose
        window.PROSPECTS = window.PROSPECTS.filter((p) => p !== back);
        UI.toast(`${t("Couldn't bring it back")}: ${back.domain}`, { kind: "crit" });
      } else { back.serverId = row.id; back.id = `gap-${row.id}`; }
      if (UI.state.route === "backlinks") UI.render();
    }).catch(COMP.fail);
  }

  /* Links chosen from a CSV. Saved in batches, so a long list can't hit the limit on one request.
     Whatever was saved before a failure stays saved, and `failed` says the rest wasn't. */
  const CSV_BATCH = 2000;
  COMP.absorbProspects = absorb;
  COMP.saveCsvProspects = async (siteId, host, rows, file, authorityLabel) => {
    const items = [], skipped = [];
    let failed = null;
    for (let at = 0; at < rows.length && !failed; at += CSV_BATCH) {
      try {
        const answer = await COMP.api("POST", "prospects", { site_id: siteId, file: file || null, authority_label: authorityLabel || null, rows: rows.slice(at, at + CSV_BATCH) });
        items.push(...absorb(answer.added, host));
        skipped.push(...answer.skipped);
      } catch (err) { failed = err; }
    }
    tab.loadedFor = undefined; // a domain in consideration shows differently on the gap list
    if (items.length) COMP.refreshLogos?.({ watch: true });
    return { items, skipped, failed };
  };
  COMP.removeCsvProspects = async (items) => {
    const ids = items.map((p) => p.serverId);
    const gone = new Set(ids), before = window.PROSPECTS;
    window.PROSPECTS = window.PROSPECTS.filter((p) => !gone.has(p.serverId));
    tab.loadedFor = undefined;
    try {
      for (let at = 0; at < ids.length; at += CSV_BATCH) await COMP.api("POST", "prospects/remove", { ids: ids.slice(at, at + CSV_BATCH) });
    } catch (err) { window.PROSPECTS = before; throw err; }
  };

  function seeThem(host, section = "consideration") {
    const own = window.SITES.find((s) => s.host === host);
    if (UI.state.site !== "all" && UI.state.site !== own?.id) UI.state.site = own?.id || "all";
    UI.state.blSection = section;
    UI.go("backlinks");
  }

  // ---- what's on screen -------------------------------------------------------------------------
  /* Spam is flagged, never removed: every domain stays in one list, the good ones first. Only the good ones can be added. */
  const allRows = () => [...(S.data?.gaps || []), ...(S.data?.filtered || [])];
  const isFlagged = (gap) => gap.quality === "spam";
  /* One competitor, or all of them together; "2 or more" keeps the domains that link to several, the strongest gaps. */
  /* The search finds a domain by its name, its title, or the anchor text and pages of its links. */
  const searched = () => allRows().filter((g) => TP.matches(PAGES, g.domain, g.display, g.title, ...(g.links || []).flatMap((l) => [l.anchor, l.source_title, l.source_url, l.target_url])) && !(S.hide && (inConsideration(g) || g.in_todo)) && !(followOn() && g.followed === false) && !oldHidden(g));
  /* Followed links only (SEO review 2026-11-17, #13): a domain whose file says every link is nofollow, sponsored or ugc passes
     little, so it waits behind one tick. A file that doesn't say (Ubersuggest) leaves it unknown: then the box isn't ticked,
     because a tick would read as "all of these are followed" (links C1). Unknown ones always show, counted apart. */
  const followKnown = () => allRows().some((g) => g.followed === true || g.followed === false);
  const followOn = () => (S.followed === null ? followKnown() : S.followed);
  const notFollowed = () => allRows().filter((g) => g.followed === false && TP.matches(PAGES, g.domain, g.display, g.title)).length;
  function followedBox() {
    const known = followKnown(), unknown = S.data?.funnel?.follow_unknown || 0;
    const note = !known ? t("This file doesn't say which links are followed") : unknown ? fill("{n} not known: their file doesn't say", { n: UI.num(unknown) }) : "";
    return `<label class="opt cg-followed"><input type="checkbox" class="chk" id="cg-followed" style="margin:0" ${followOn() ? "checked" : ""} ${known ? "" : "disabled"}${note ? ' aria-describedby="cg-followed-note"' : ""}><span>${t("Followed links only")}${note ? `<span class="small sec cg-opt-note" id="cg-followed-note">${esc(note)}</span>` : ""}</span>${UI.tip("Leaves out domains whose file says every link is nofollow, sponsored or ugc. Lost links in a file are never listed.")}</label>`;
  }
  /* Old links (links B1): a good domain whose links a file last saw more than 6 months before the file was made is probably
     gone. It is left out of Good ones until someone asks for it, with one chip. */
  const isOld = (g) => Boolean(g.old_link) && !isFlagged(g);
  const oldHidden = (g) => !S.old && isOld(g);
  const oldCount = () => allRows().filter((g) => isOld(g) && TP.matches(PAGES, g.domain, g.display, g.title)).length;
  const oldChip = () => { const n = allRows().filter(isOld).length; return n ? `<button type="button" class="chip cg-old-chip" data-cg-old aria-pressed="${S.old}" data-tip="${esc(t("Domains whose links were last seen more than 6 months before their file. Probably gone."))}">${t("Include old links")}<b>${UI.num(n)}</b></button>` : ""; };
  /* "any", "1" for exactly one competitor, or a number for that many or more. */
  const reachOk = (g, reach) => reach === "any" || (reach === "1" ? g.competitor_count === 1 : g.competitor_count >= Number(reach));
  const reaches = (g) => reachOk(g, S.reach);
  /* A domain's links, only those to the chosen competitor when one is chosen. The server sends them strongest page first. */
  const linksOf = (g) => (g.links || []).filter((l) => !S.filter || String(l.competitor_id) === S.filter);
  const linkHits = (l) => TP.matches(PAGES, l.anchor, l.source_title, l.source_url, l.target_url);
  const isSet = (n) => n !== null && n !== undefined;
  /* The link the row speaks for: its strongest page, among the links holding the words while searching. Page authority and anchor text always come from this same link. */
  function topLink(g) {
    const links = linksOf(g), hits = TP.state(PAGES).q?.trim() ? links.filter(linkHits) : [];
    return (hits.length ? hits : links).reduce((best, l) => (best === null || (l.page_authority ?? -1) > (best.page_authority ?? -1) ? l : best), null);
  }
  const bestPa = (g) => topLink(g)?.page_authority ?? null;
  const strongEnough = (g) => !S.pa || (bestPa(g) ?? -1) >= Number(S.pa);
  const ofRival = (g) => !S.filter || g.competitors.some((c) => String(c.id) === S.filter);
  const byRival = () => searched().filter((g) => ofRival(g) && reaches(g) && strongEnough(g));
  /* Status sorts by how far along a domain is: To do, In consideration, a lost link, nothing yet, then spam. */
  const statusRank = (g) => (g.in_todo ? 3 : inConsideration(g) ? 2 : g.lost_link ? 1 : isFlagged(g) ? -1 : 0);
  const SORTS = {
    domain: (g) => g.display || g.domain, links: (g) => g.competitor_count, authority: (g) => (isSet(g.authority) ? [g.scale_rank ?? 0, g.authority] : null), spam: (g) => g.spam_score, pa: bestPa, anchor: (g) => topLink(g)?.anchor || null, count: (g) => (linksOf(g).length ? linkTotal(g, linksOf(g)) : null), status: statusRank,
  };
  const LINK_SORTS = { anchor: (l) => l.anchor || null, pa: (l) => l.page_authority, from: (l) => l.source_url, to: (l) => l.target_url || null };
  const PA_STEPS = [10, 20, 30, 40, 50];
  /* Each value is read once. What has no value goes last, whichever way the column is sorted. */
  function sortBy(list, get, order) {
    const dir = order === "asc" ? 1 : -1;
    return list.map((item) => [get(item), item]).sort(([x], [y]) => {
      if (!isSet(x)) return isSet(y) ? 1 : 0;
      if (!isSet(y)) return -1;
      const scored = window.BacklinkCleaner.compareScored(x, y, dir); // one tool's scores against each other (#7)
      if (scored !== null) return scored;
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
    }).map(([, item]) => item);
  }
  // Without a chosen column, the server's order: most competitors first, then the best authority.
  const sorted = (list) => (S.sort ? sortBy(list, SORTS[S.sort.id], S.sort.dir) : list);
  /* Why a flagged domain is flagged, as one key: who flagged it and the reason's words. */
  const reasonKey = (g) => `${g.flagged_by || ""}|${g.reason_words || ""}`;
  const reasonOk = (g) => S.quality !== "spam" || !S.reason || reasonKey(g) === S.reason;
  const qualityOk = (g) => (S.quality === "all" || (S.quality === "app" ? !isFlagged(g) && Boolean(g.app_flag) : (S.quality === "spam") === isFlagged(g)));
  const shownGaps = () => sorted(byRival().filter((g) => qualityOk(g) && reasonOk(g)));
  const canPick = (gap) => !isFlagged(gap) && !inConsideration(gap) && !gap.in_todo;
  const pickable = () => TP.view(PAGES, shownGaps()).rows.filter(canPick); // only rows on this page: "Select all shown" means shown

  // The rules of the list sit behind an (i) beside its buttons, not in a box over the table.
  const INTRO = "Spam is flagged, never removed, and only good ones can be added. From your uploads and domains added by hand: no paid tool, no AI. Adding a domain creates no backlink and leaves the Backlinks top cards alone.";


  /* A site shown by its logo alone; its name comes on hover or focus and is read out by a screen reader. */
  const LOGOS_SHOWN = 8;
  const logoOnly = (host, size) => `<span class="cg-logo" role="img" tabindex="0" data-tip="${esc(host)}" aria-label="${esc(host)}">${UI.siteLogo(host, size)}</span>`;

  /* One line, so the table is what you see first. Everything the tiles used to offer is still here. */
  function summaryLine(d) {
    const f = d.funnel;
    const stat = (n, label) => `<span class="cg-stat"><b class="tabular">${UI.num(n)}</b> ${t(label)}</span>`;
    // Good ones leave out old links unless they are asked for; the app's own flags on good ones are counted apart (links A1, B1).
    const oldOut = S.old ? 0 : f?.old || 0;
    const stats = f && f.found ? `${stat(f.found, "Domains found")}${stat(f.filtered, "Flagged as spam")}${stat(f.good - oldOut, "Good ones")}${f.old ? stat(f.old, S.old ? "Old links, included" : "Old links, left out") : ""}${f.app_flagged ? `<span class="cg-stat" tabindex="0" data-tip="${esc(t("The file's spam score keeps them, but the app's own check flagged them. Each row says what it saw."))}"><b class="tabular">${UI.num(f.app_flagged)}</b> ${t("App flagged")}</span>` : ""}` : "";
    const goodSent = allRows().filter((g) => !isFlagged(g) && !oldHidden(g)).length;
    const capped = f && f.good - oldOut > goodSent ? `<span class="cg-stat sec">${esc(t("{sent} of {total}, most competitors first").replace("{sent}", UI.num(goodSent)).replace("{total}", UI.num(f.good)))}</span>` : "";
    const checking = f?.checking ? `<span class="cg-stat sec">${UI.icon("refresh-cw", "spin")}<b class="tabular">${UI.num(f.checking)}</b> ${t("Being checked")}</span>` : "";
    // A competitor with nothing yet is named here, with the way to feed it.
    const empty = d.competitors.some((c) => c.has_data) ? d.competitors.filter((c) => !c.has_data) : [];
    const rest = empty.slice(LOGOS_SHOWN);
    const faces = `<span class="cg-logos">${empty.slice(0, LOGOS_SHOWN).map((c) => logoOnly(c.host, 20)).join("")}${rest.length ? `<span class="cg-logos-more tabular" tabindex="0" data-tip="${esc(rest.map((c) => c.host).join(", "))}">+${UI.num(rest.length)}</span>` : ""}</span>`;
    const missing = empty.length ? `<span class="cg-stat">${t("No links yet for")} ${faces} <button class="link-btn" id="cg-up-missing" data-cg-upload="${empty[0].id}">${t("Add links")}</button></span>` : "";
    const open = allRows().filter((g) => canPick(g) && !oldHidden(g)).length;
    const addAll = open ? `<button class="btn btn-main btn-small cg-add-all" id="cg-add-all" data-cg-add-all>${UI.icon("plus")}${t("Add all good ones")} (${UI.num(open)})</button>` : "";
    if (!stats && !checking && !missing && !addAll) return "";
    return `<div class="cg-summary" aria-label="${t("Spam filter")}" role="group">${stats}${capped}${checking}${missing}${addAll}</div>`;
  }

  /* Files are uploaded per competitor. The window opens on the first one still without links, and lets you pick another. */
  const uploadTarget = (d) => (d.competitors.find((c) => !c.has_data) || d.competitors[0]).id;
  const uploadButton = (d, cls = "btn btn-small") => `<button class="${cls}" id="cg-upload" data-cg-upload="${uploadTarget(d)}">${UI.icon("list-plus")}${t("Upload links")}</button>`;

  /* The competitor choice. A native list can't show pictures, so it's a button and a menu, each competitor with its logo and its count. */
  function competitorPick(base, rivals, countFor) {
    S.choices = [{ id: "", host: null, word: t("All competitors"), n: base.length }, ...rivals.map((c) => ({ id: String(c.id), host: c.host, word: c.host, n: countFor(c.id) }))];
    const on = S.choices.find((c) => c.id === (S.filter || "")) || S.choices[0];
    return `<div class="field"><span id="cg-filter-label">${t("Competitor")}</span><button type="button" class="select cg-pick" id="cg-filter" data-pop-toggle aria-haspopup="true" aria-expanded="false" aria-labelledby="cg-filter-label cg-filter">${choiceFace(on)}</button></div>`;
  }
  const choiceFace = (c) => `${c.host ? UI.siteLogo(c.host, 16) : `<span class="cg-pick-all" aria-hidden="true">${UI.icon("users")}</span>`}<span class="cg-pick-word" dir="auto">${esc(c.word)}</span><span class="cg-pick-n tabular">${UI.num(c.n)}</span>`;
  function openCompetitorPick(anchor) {
    if (anchor.getAttribute("aria-expanded") === "true") { UI.closePopover({ focus: true }); return; }
    const now = S.filter || "";
    const menu = UI.popover(anchor, S.choices.map((c, i) => `${i === 1 ? "<hr>" : ""}<button type="button" data-cg-choose="${esc(c.id)}" aria-pressed="${c.id === now}" ${c.id === now ? "data-autofocus" : ""}>${choiceFace(c)}${c.id === now ? `<span class="tick">${UI.icon("check")}</span>` : ""}</button>`).join(""), "cg-pick-menu");
    menu.style.minWidth = `${Math.max(240, anchor.offsetWidth)}px`;
  }

  /* Whose scale a score is on: the tool's logo alone, the full label ("Authority Score (SEMrush)") on hover.
     A source with no logo (a plain CSV, a tool typed by hand) keeps its name in a small tag. */
  const scaleOf = (label) => label.match(/\(([^)]+)\)/)?.[1] || label;
  const scaleMark = (label) => {
    const brand = scaleOf(label);
    return window.BRANDS?.FILES?.[brand] ? UI.logoOnly(brand, label) : `<span class="tag" data-tip="${esc(label)}" tabindex="0">${esc(brand)}</span>`;
  };
  const authorityCell = (gap) => {
    // One line per row: the value and whose scale it is. The full name stays on hover.
    const label = gap.authority_label || "";
    if (gap.authority !== null && gap.authority !== undefined) return `<span class="cg-auth"><span class="tabular">${UI.num(gap.authority)}</span>${label ? scaleMark(label) : ""}${gap.authority_by_hand ? `<span class="cg-by-hand" data-tip="${t("Typed by hand")}" tabindex="0" role="img" aria-label="${t("Typed by hand")}">${UI.icon("pencil")}</span>` : ""}</span>`;
    // Common Crawl's rank is a different scale, so it's never shown as if it were a score.
    return `<span class="muted" title="${esc(t("No authority score yet."))}">—</span>`; // unknown is —, with the reason on hover, as everywhere in Competitors. An old Common Crawl rank isn't a score: left out since that source was removed.
  };
  const dash = (why) => `<span class="muted" title="${esc(t(why))}">—</span>`;
  const linkTotal = (gap, links) => (S.filter ? links.length : Math.max(gap.link_count || 0, links.length));
  /* 2026-11-12 (UI critique): Authority, Page authority and Spam score share one Strength cell, so the table fits its card at
     1440 px with no sideways scroll. The authority leads, on its tool's scale; the strongest linking page's Page authority and
     the spam score sit under it, each named in its tooltip. The column sorts by authority. */
  function strengthCell(gap) {
    const pa = bestPa(gap), spam = gap.spam_score;
    const subs = [
      isSet(pa) ? `<span tabindex="0" data-tip="${t("Page authority of the linking page")}">${esc(t("Page"))} <b class="tabular">${UI.num(pa)}</b></span>` : "",
      isSet(spam) ? `<span tabindex="0" data-tip="${t("Spam score")}">${esc(t("Spam"))} <b class="tabular">${UI.dec(spam)}</b></span>` : "",
    ].filter(Boolean);
    return `<span class="cg-strength">${authorityCell(gap)}${subs.length ? `<span class="cg-str-sub">${subs.join(`<span aria-hidden="true">·</span>`)}</span>` : ""}</span>`;
  }
  /* The row says how many links; the button opens them all under the row, each with its anchor text and Page authority. */
  function linksCell(gap) {
    const links = linksOf(gap);
    if (!links.length) return dash("No link details in the file.");
    const total = linkTotal(gap, links), open = S.openLink === gap.domain;
    const word = total === 1 ? t("1 link") : t("{n} links").replace("{n}", UI.num(total));
    return `<button type="button" class="cg-links-btn" data-cg-links="${esc(gap.domain)}" aria-expanded="${open}" aria-label="${esc(gap.display || gap.domain)}: ${esc(word)}">${esc(word)}${UI.icon("chevron-down")}</button>`;
  }
  /* A page of the row's own site needs only its path; the domain is already on the row. */
  const pathOf = (url) => { try { const u = new URL(url), path = `${u.pathname}${u.search}`; try { return decodeURI(path); } catch { return path; } } catch { return url; } };
  function linkRow(l) {
    const rival = S.data.competitors.find((c) => c.id === l.competitor_id)?.host;
    const to = l.target_url ? `<span class="cg-link-to">${rival ? logoOnly(rival, 16) : ""}${COMP.link(l.target_url, pathOf(l.target_url), "cg-page mono")}</span>` : `<span class="muted">—</span>`;
    return `<tr>
      <td class="cg-link-anchor" data-label="${t("Anchor text")}">${l.anchor ? `<span dir="auto">${esc(l.anchor)}</span>` : `<span class="muted">${t("No anchor text")}</span>`}</td>
      <td class="c" data-label="${t("Page authority")}">${isSet(l.page_authority) ? `<span class="tabular">${UI.num(l.page_authority)}</span>` : `<span class="muted">—</span>`}</td>
      <td data-label="${t("Linking page")}">${COMP.link(l.source_url, pathOf(l.source_url), "cg-page mono")}</td>
      <td data-label="${t("Points to")}">${to}</td>
    </tr>`;
  }
  /* All of a domain's links in a table of their own, opened under its row: no other page. While searching, the links holding the words come first. */
  function linksPanel(gap) {
    let links = linksOf(gap);
    if (TP.state(PAGES).q?.trim()) links = [...links.filter(linkHits), ...links.filter((l) => !linkHits(l))];
    if (S.linkSort) links = sortBy(links, LINK_SORTS[S.linkSort.id], S.linkSort.dir);
    const page = TP.view(LINK_PAGES, links), total = linkTotal(gap, links);
    const head = (id, label, cls) => sortHead("data-cg-link-sort", S.linkSort, id, label, cls);
    const capped = total > links.length ? `<p class="small sec cg-links-capped">${esc(t("{shown} of {total}, strongest first").replace("{shown}", UI.num(links.length)).replace("{total}", UI.num(total)))}</p>` : "";
    return `<tr class="cg-links-row"><td colspan="${COLS}"><div class="cg-links-panel">
      <table class="data cg-links-table" aria-label="${esc(t("Links from {domain}").replace("{domain}", gap.display || gap.domain))}">
        <thead><tr>${head("anchor", "Anchor text")}${head("pa", "Page authority", "c")}${head("from", "Linking page")}${head("to", "Points to")}</tr></thead>
        <tbody>${page.rows.map(linkRow).join("")}</tbody>
      </table>
      ${links.length > TP.PER[0] ? TP.footer(LINK_PAGES, page, { noun: t("links") }) : ""}${capped}
    </div></td></tr>`;
  }
  const COLS = 7; // tick box, Domain, Links to, Strength, Links, Status, ⋯

  /* The file's spam score let a domain through (owner, 2026-11-10), but what the app's own check saw stays on its row (links A1).
     "Site down" can be stale, so it carries the day it was seen and is the weaker kind. */
  function appFlagNote(gap) {
    const f = gap.app_flag;
    if (!f || gap.kept) return "";
    if (isFlagged(gap)) return overruledNote(gap);
    const seen = f.reason === "leads_elsewhere" && f.to ? fill("redirects to {site}", { site: f.to }) : t(f.words || "Flagged as spam").toLowerCase();
    const day = f.at ? UI.fmtDateOnly(f.at) : "";
    const words = f.weak && day ? fill("The app saw: {what} on {day}", { what: seen, day }) : fill("The app saw: {what}", { what: seen });
    return `<span class="second cg-app-flag ${f.weak ? "weak" : ""}" ${day ? `data-tip="${esc(fill("Checked on {day}. The file's spam score keeps it in Good ones.", { day }))}" tabindex="0"` : ""}>${UI.icon(f.weak ? "clock" : "triangle-alert")}<span dir="auto">${esc(words)}</span></span>`;
  }

  /* A redirect, a parked domain or no home page beats the file's spam score (owner, 2026-11-18): the row is under Flagged, and
     says what the app saw (where it leads) and the score it overruled. Shown in every view: the reasons line above the table
     only gives the general reason. */
  function overruledNote(gap) {
    const f = gap.app_flag;
    if (!f || f.over_file === null || f.over_file === undefined) return "";
    const seen = f.reason === "leads_elsewhere" && f.to ? fill("Redirects to {site}", { site: f.to }) : t(f.words || "Flagged as spam");
    const day = f.at ? UI.fmtDateOnly(f.at) : "";
    const tip = t("A redirect, a parked domain or no home page beats the file's spam score. Not spam puts it back in Good ones.");
    return `<span class="second cg-why cg-overruled" tabindex="0" data-tip="${esc(day ? `${fill("Checked on {day}.", { day })} ${tip}` : tip)}">${COMP.iconTip("settings", t("Flagged by the system"), "comp-ic-system")}<span dir="auto">${esc(seen)}</span><span class="sec"> · ${esc(fill("file score {score} overruled", { score: UI.num(f.over_file) }))}</span></span>`;
  }

  /* Spam and In consideration never show together: a domain in consideration (or in To do) is the user's choice, which beats
     the filter, so its row shows that state alone. Marking one as spam takes it off the list (decide below). */
  function rowHtml(gap) {
    const considered = inConsideration(gap) || Boolean(gap.in_todo), flagged = isFlagged(gap) && !considered, picked = S.picked.has(gap.domain);
    const tags = [
      flagged ? `<span class="tag cg-flag" tabindex="0" data-tip="${esc(COMP.spamWhy(gap))}">${UI.icon("ban")}${t("Spam")}</span>` : "",
      gap.lost_link ? `<span class="tag cg-lost">${UI.icon("link-2-off")}${t("Lost link")}</span>` : "",
      gap.in_todo ? `<span class="tag cp-yours cg-todo-tag">${UI.icon("clock")}${t("In To do")}</span>` : considered ? `<span class="tag cp-yours">${t("In consideration")}</span>` : "",
      gap.is_competitor ? `<span class="tag">${t("Competitor")}</span>` : "",
      gap.kept ? `<span class="tag">${t("Kept by you")}</span>` : "",
      gap.page_note === "unread" ? `<span class="tag" data-tip="${t("The site blocked the app; that doesn't make it spam.")}">${t("Home page not read")}</span>` : "",
      isOld(gap) ? `<span class="tag cg-old">${UI.icon("calendar-days")}${esc(fill("Old link (last seen {day})", { day: UI.fmtDateOnly(gap.old_link.last_seen) }))}</span>` : "",
    ].filter(Boolean).join(" ");
    // With Flagged as spam on, the reasons are said once above the table, so a row keeps only its tag (the reason in its tooltip).
    const why = flagged && overruledNote(gap) ? overruledNote(gap) : flagged && S.quality !== "spam" ? `<span class="second cg-why">${COMP.spamWhyHtml(gap)}</span>` : appFlagNote(gap);
    const word = gap.reason === "my_choice" ? "Undo" : "Not spam";
    // A flagged row keeps its one-click way back; Edit and Mark as spam are in the row's ⋯ menu (and Mark as spam in the picked bar).
    // On a row the app flagged, the tip says a person's choice beats the app's check (owner, 2026-11-18).
    const backTip = gap.flagged_by === "system" ? ` data-tip="${esc(t("Overrides the app's check: back to Good ones."))}"` : "";
    const back = flagged ? `<button class="btn btn-small" data-cg-decide="${gap.reason === "my_choice" ? "auto" : "keep"}" data-domain="${esc(gap.domain)}" aria-label="${t(word)}: ${esc(gap.display || gap.domain)}"${backTip}>${t(word)}</button>` : "";
    const menu = `<button type="button" class="icon-btn cg-row-menu" data-pop-toggle data-cg-menu="${esc(gap.domain)}" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(t("More for {domain}").replace("{domain}", gap.display || gap.domain))}" data-tip="${t(flagged || gap.in_todo ? "Edit" : "Edit and Mark as spam")}">${UI.icon("ellipsis")}</button>`;
    const open = S.openLink === gap.domain && linksOf(gap).length > 0;
    const off = considered || isFlagged(gap);
    return `<tr data-cg-row="${esc(gap.domain)}" class="${picked ? "sel" : ""} ${open ? "open" : ""} ${off ? "cg-off" : ""} ${flagged ? "cg-flagged" : ""}">
      <td class="chk-cell"><input type="checkbox" class="chk" data-cg-pick="${esc(gap.domain)}" aria-label="${esc(gap.display || gap.domain)}" ${picked ? "checked" : ""} ${off ? "disabled" : ""}></td>
      <td class="head-cell"><span class="with-logo">${UI.siteLogo(gap.domain)}<span class="logo-text"><span class="nb-inline"><span class="kw mono" dir="auto">${esc(gap.display || gap.domain)}</span>${gap.sample_url ? `<a class="icon-btn cg-example-link" href="${esc(gap.sample_url)}" target="_blank" rel="noopener noreferrer nofollow" data-tip="${esc(t("Example link"))}: ${esc(COMP.shortUrl(gap.sample_url))}" aria-label="${esc(t("Example link"))}: ${esc(COMP.shortUrl(gap.sample_url))}">${UI.icon("external-link")}</a>` : ""}${COMP.notes?.badge ? COMP.notes.badge({ scope: "domain", domain: gap.domain, siteId: COMP.siteId ?? null }, gap.display || gap.domain) : ""}</span>${gap.title ? `<span class="second cg-title" dir="auto">${esc(gap.title)}</span>` : ""}</span></span></td>
      <td data-label="${t("Links to")}"><span class="cg-rivals"><b class="tabular cg-count" tabindex="0" data-tip="${t("Competitors it links to")}">${UI.num(gap.competitor_count)}</b><span class="cg-logos">${gap.competitors.map((c) => logoOnly(c.host, 20)).join("")}</span></span></td>
      <td class="c" data-label="${t("Strength")}">${strengthCell(gap)}</td>
      <td class="c" data-label="${t("Links")}">${linksCell(gap)}</td>
      <td data-label="${t("Status")}">${tags ? `<span class="cp-tags">${tags}</span>` : `<span class="muted">—</span>`}${why}</td>
      <td class="r nowrap cg-act-cell" data-label="">${back}${menu}</td>
    </tr>${open ? linksPanel(gap) : ""}`;
  }
  function openRowMenu(button) {
    const gap = allRows().find((g) => g.domain === button.dataset.cgMenu);
    if (!gap) return;
    if (button.getAttribute("aria-expanded") === "true") { UI.closePopover({ focus: true }); return; }
    const considered = inConsideration(gap), name = esc(gap.display || gap.domain);
    const spam = isFlagged(gap) || gap.in_todo ? "" : `<button type="button" class="cs-menu-item" role="menuitem" data-cg-decide="spam" data-domain="${esc(gap.domain)}" data-cg-from-menu>${UI.icon("ban")}<span>${t("Mark as spam")}${considered ? `<span class="small sec cg-menu-note">${t("Takes it off In consideration")}</span>` : ""}</span></button>`;
    UI.popover(button, `<div class="cs-menu" role="menu" aria-label="${name}">
      <button type="button" class="cs-menu-item" role="menuitem" data-cg-edit="${esc(gap.domain)}" data-cg-from-menu>${UI.icon("pencil")}${t("Edit")}</button>${spam}</div>`, "cs-menu-pop");
  }

  function selectionBar() {
    const n = S.picked.size;
    if (!n) return "";
    // A small pill in the middle, so the floating Notes button on the right never sits on top of it.
    const off = S.adding ? "disabled" : "";
    return `<div class="selbar cg-selbar" role="region" aria-label="${t("selected")}">
      <b id="cg-sel-count" class="cg-sel-count">${UI.num(n)} ${t("selected")}</b>
      <span class="cg-sel-group" role="group" aria-labelledby="cg-sel-to"><span class="cg-sel-to" id="cg-sel-to">${t("Add to")}</span>
        <button class="btn btn-main btn-small" id="cg-add" data-cg-add ${off}>${UI.icon("plus")}${t("In consideration")}</button>
        <button class="btn btn-small" id="cg-todo" data-cg-todo ${off}>${UI.icon("clock")}${t("To do")}</button>
      </span>
      <span class="cg-sel-sep" aria-hidden="true"></span>
      <button class="btn btn-small" id="cg-task" data-cg-task ${off}>${UI.icon("square-check")}${t("Create task")}</button>
      <button class="btn btn-small" id="cg-spam-picked" data-cg-spam-picked ${off}>${UI.icon("ban")}${t("Mark as spam")}</button>
      <button class="icon-btn" data-cg-clear aria-label="${t("Clear selection")}" data-tip="${t("Clear selection")}">${UI.icon("x")}</button>
    </div>`;
  }

  /* With Flagged as spam on: each reason once, with how many domains it flagged, instead of on every row. Each one narrows the list. */
  function reasonsLine() {
    if (S.quality !== "spam") return "";
    const groups = new Map();
    byRival().filter(isFlagged).forEach((g) => { const key = reasonKey(g), entry = groups.get(key) || { gap: g, n: 0 }; entry.n += 1; groups.set(key, entry); });
    if (S.reason && !groups.has(S.reason)) S.reason = "";
    if (!groups.size) return "";
    const list = [...groups].sort((a, b) => b[1].n - a[1].n);
    return `<div class="chips cg-reasons" role="group" aria-label="${esc(t("Why they're flagged"))}">${list.map(([key, e]) => `<button type="button" class="chip cg-reason" data-cg-reason="${esc(key)}" aria-pressed="${S.reason === key}">${COMP.spamWhyHtml(e.gap)}<b>×${UI.num(e.n)}</b></button>`).join("")}</div>`;
  }

  /* Every heading shows it can be sorted, before anyone has clicked it. */
  function sortHead(attr, sort, id, label, cls = "") {
    const on = sort?.id === id, arrow = on ? (sort.dir === "asc" ? "arrow-up" : "arrow-down") : "chevrons-up-down";
    return `<th scope="col" class="${cls}" aria-sort="${on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" class="th-btn cg-th" ${attr}="${id}">${t(label)}${UI.icon(arrow, on ? "" : "cg-th-idle")}</button></th>`;
  }

  /* How many competitors a domain links to. The choices stop at the most any domain reaches, and each says how many domains it holds. */
  function reachField() {
    const rows = searched().filter((g) => ofRival(g) && strongEnough(g));
    const most = allRows().reduce((top, g) => Math.max(top, g.competitor_count), Number(S.reach) || 0);
    const choices = [["any", t("Any number")], ["1", t("Only 1")]];
    for (let n = 2; n <= most; n += 1) choices.push([String(n), t("{n} or more").replace("{n}", UI.num(n))]);
    return `<label class="field cg-reach"><span>${t("Links to")}</span><select class="select" id="cg-reach">${choices.map(([id, word]) => `<option value="${id}" ${id === S.reach ? "selected" : ""}>${esc(word)} (${UI.num(rows.filter((g) => reachOk(g, id)).length)})</option>`).join("")}</select></label>`;
  }

  const simple = () => Boolean(UI.simple?.());
  /* Simpler screens: Links to, Page authority, Good ones / Flagged as spam and Hide added ones, behind one Filter button. */
  const filtersOn = () => (S.reach !== "any") + Boolean(S.pa) + (S.quality !== "all") + Boolean(S.hide) + Boolean(S.old);
  const filterButton = () => { const n = filtersOn(); return `<button type="button" class="btn btn-small cg-filters" id="cg-filters" data-pop-toggle aria-haspopup="dialog" aria-expanded="false">${UI.icon("filter")}${t("Filter")}${n ? ` <b class="tt-count tabular">${UI.num(n)}</b>` : ""}</button>`; };
  const qualityChips = () => `<div class="chips cp-chips" role="group" aria-label="${t("Flagged as spam")}">
          ${[["all", "All", byRival().length], ["good", "Good ones", byRival().filter((g) => !isFlagged(g)).length], ["spam", "Flagged as spam", byRival().filter(isFlagged).length], ["app", "App flagged", byRival().filter((g) => !isFlagged(g) && g.app_flag).length]].filter(([id, , n]) => id !== "app" || n || S.quality === "app").map(([id, word, n]) => `<button class="chip" data-cg-quality="${id}" aria-pressed="${S.quality === id}">${t(word)}<b>${UI.num(n)}</b></button>`).join("")}
        </div>`;
  const paField = () => `<label class="field"><span>${t("Page authority")}</span><select class="select" id="cg-pa">
          <option value="">${t("Any")}</option>
          ${PA_STEPS.map((n) => `<option value="${n}" ${String(n) === S.pa ? "selected" : ""}>${esc(t("{n} or more").replace("{n}", UI.num(n)))}</option>`).join("")}
        </select></label>`;
  const hideBox = () => `<label class="opt"><input type="checkbox" class="chk" id="cg-hide" style="margin:0" ${S.hide ? "checked" : ""}>${t("Hide added ones")}</label>`;
  const filterPop = () => `<div class="cg-filter-pop-body" role="group" aria-label="${t("Filter")}">${reachField()}${paField()}<div class="field"><span>${t("Spam filter")}</span>${qualityChips()}</div>${oldChip() ? `<div class="field"><span>${t("Old links")}</span><div class="chips">${oldChip()}</div></div>` : ""}${hideBox()}${followedBox()}${filtersOn() ? `<button type="button" class="link-btn" data-cg-unfilter>${t("Clear filters")}</button>` : ""}</div>`;
  function openFilters(anchor) {
    if (anchor.getAttribute("aria-expanded") === "true") { UI.closePopover({ focus: true }); return; }
    UI.popover(anchor, filterPop(), "cg-filter-pop");
  }
  /* A filter changed: the table is drawn again, and an open Filter box stays open with the keyboard where it was. */
  function refilter(focus) {
    const wasOpen = Boolean(UI.$("#popover.cg-filter-pop"));
    TP.reset(PAGES); trimPicked();
    if (wasOpen) UI.closePopover();
    COMP.paint();
    if (wasOpen && UI.$("#cg-filters")) UI.popover(UI.$("#cg-filters"), filterPop(), "cg-filter-pop");
    if (focus) UI.$(focus)?.focus();
  }

  function body() {
    const d = S.data;
    if (!d) return COMP.loading();
    if (!d.competitors.length) {
      return emptyTip(t("No competitors yet"), t("Add a competitor first."), "Link gaps show who links to your competitors but not to you.", `<button class="btn btn-main" data-cg-find>${UI.icon("search")}${t("Find competitors")}</button>`);
    }
    const strip = summaryLine(d);
    const hiddenNf = followOn() ? notFollowed() : 0;
    const hiddenOld = S.old ? 0 : oldCount();
    // Scores of different tools never sort as one (#7): the leading tool's come first, the others after, each on its own scale.
    const scales = new Set(allRows().filter((g) => isSet(g.scale_rank)).map((g) => g.scale_rank));
    const scaleNote = scales.size > 1 && d.score_scale ? `<p class="help cg-left">${esc(fill("Strength: {tool} scores are compared first; other tools' scores come after, on their own scale.", { tool: scaleOf(d.score_scale) }))}</p>` : "";
    const left = `${d.already_linking ? `<p class="help cg-left">${esc(leftOutWords(d.already_linking))}</p>` : ""}${scaleNote}${hiddenNf ? `<p class="help cg-left">${esc(hiddenNf === 1 ? t("1 domain with only nofollow, sponsored or ugc links is hidden.") : fill("{n} domains with only nofollow, sponsored or ugc links are hidden.", { n: UI.num(hiddenNf) }))} <button type="button" class="link-btn" data-cg-show-nofollow>${t("Show them")}</button></p>` : ""}${hiddenOld ? `<p class="help cg-left">${esc(hiddenOld === 1 ? t("1 domain whose links were last seen more than 6 months before its file is left out.") : fill("{n} domains whose links were last seen more than 6 months before their file are left out.", { n: UI.num(hiddenOld) }))} <button type="button" class="link-btn" data-cg-old>${t("Show them")}</button></p>` : ""}`;
    if (!d.competitors.some((c) => c.has_data)) {
      return `${strip}${emptyTip(t("No links yet"), t("Upload a CSV of a competitor's links, or add a domain."), "Export the CSV from a free SEMrush or Ubersuggest account. Domains that don't link to you appear here, with spam flagged.", `<button class="btn btn-main" id="cg-up-empty" data-cg-upload="${d.competitors[0].id}">${UI.icon("list-plus")}${t("Upload a CSV")}</button><button class="btn" data-cg-add-domain>${UI.icon("plus")}${t("Add a domain")}</button>`)}`;
    }
    if (!allRows().length) {
      const checking = d.funnel?.checking;
      return `${strip}${checking ? COMP.empty(t("Checking for spam…"), t("Domains appear as their home pages are read."), uploadButton(d, "btn")) : COMP.empty(t("No domains left"), t("All already link to you or are yours."), uploadButton(d, "btn"))}${left}`;
    }
    const reasons = reasonsLine(); // first: a reason no longer there stops narrowing the list
    const shown = shownGaps(), open = pickable(), page = TP.view(PAGES, shown);
    const all = open.length > 0 && open.every((g) => S.picked.has(g.domain));
    const some = open.some((g) => S.picked.has(g.domain));
    // How many domains each choice gives, with the other filters as they are, so the choice says what it holds.
    const base = searched().filter(reaches);
    const countFor = (id) => base.filter((g) => g.competitors.some((c) => String(c.id) === String(id))).length;
    const rivals = d.competitors.filter((c) => c.has_data);
    const head = (id, label, cls) => sortHead("data-cg-sort", S.sort, id, label, cls);
    const table = shown.length ? `<div class="cg-list"><div class="table-wrap"><table class="data" id="cg-table"${simple() ? " data-tt-filter-off" : ""}>
        <thead><tr>
          <th scope="col" class="chk-cell"><input type="checkbox" class="chk" id="cg-all" style="margin:0" aria-label="${t("Select all shown")}" ${all ? "checked" : ""} ${open.length ? "" : "disabled"} data-indeterminate="${!all && some}"></th>
          ${head("domain", "Domain")}${head("links", "Links to")}${head("authority", "Strength", "c")}${head("count", "Links", "c")}${head("status", "Status")}<th scope="col"><span class="sr">${t("Action")}</span></th>
        </tr></thead>
        <tbody>${page.rows.map(rowHtml).join("")}</tbody>
      </table></div>
      ${TP.footer(PAGES, page, { noun: t("domains") })}
      </div>` : COMP.empty(t("Nothing matches these filters"), t("Change the filters to see more."));
    // Simpler screens: one search, the competitor menu and one Filter button holding the rest. Upload and Add a domain are in the head.
    if (simple()) {
      return `${strip}
      <div class="cp-tools cg-tools cg-tools-simple">
        ${TP.search(PAGES, t("Search domains"))}
        ${competitorPick(base, rivals, countFor)}
        ${filterButton()}
      </div>
      ${reasons}
      ${table}
      ${left}
      <div id="cg-selbar">${selectionBar()}</div>`;
    }
    return `${strip}
      <div class="cp-tools cg-tools">
        ${TP.search(PAGES, t("Search domains"))}
        ${competitorPick(base, rivals, countFor)}
        ${reachField()}
        ${paField()}
        ${qualityChips()}
        ${oldChip()}
        ${hideBox()}
        ${followedBox()}
        <span class="cg-picktools">
          ${uploadButton(d)}
          <button class="btn btn-small" data-cg-add-domain>${UI.icon("plus")}${t("Add a domain")}</button>
          ${COMP.info(INTRO)}
        </span>
      </div>
      ${reasons}
      ${table}
      ${left}
      <div id="cg-selbar">${selectionBar()}</div>`;
  }

  const leftOutWords = (n) => (n === 1 ? t("1 domain already links to you, so it's left out.") : `${UI.num(n)} ${t("domains already link to you, so they're left out.")}`);

  /* A tick only updates the row, the header box and the bar, so focus stays where the user is. */
  function updateSelection() {
    UI.$$("[data-cg-row]").forEach((row) => row.classList.toggle("sel", S.picked.has(row.dataset.cgRow)));
    UI.$$("[data-cg-pick]").forEach((box) => { box.checked = S.picked.has(box.dataset.cgPick); });
    const open = pickable(), all = UI.$("#cg-all");
    if (all) {
      all.checked = open.length > 0 && open.every((g) => S.picked.has(g.domain));
      all.indeterminate = !all.checked && open.some((g) => S.picked.has(g.domain));
    }
    const bar = UI.$("#cg-selbar");
    if (!bar) return;
    // Only redraw when the bar appears or goes: a new one replays its entrance on every tick.
    const count = UI.$("#cg-sel-count");
    if (!S.picked.size || !count) { UI.setHTML(bar, selectionBar()); return; }
    count.textContent = `${UI.num(S.picked.size)} ${t("selected")}`;
    UI.$$(".cg-selbar .btn").forEach((b) => { b.disabled = !!S.adding; });
  }

  /* Keep only what can still be seen and added: "Add 3" must never add something off screen. */
  function trimPicked() {
    const open = new Set(pickable().map((g) => g.domain));
    S.picked.forEach((domain) => { if (!open.has(domain)) S.picked.delete(domain); });
  }

  async function reloadHere() {
    if (onScreen()) await COMP.reload({ quiet: true });
    else tab.loadedFor = undefined;
  }

  // ---- adding -----------------------------------------------------------------------------------
  async function addPicked() {
    const domains = [...S.picked], siteId = COMP.siteId, host = COMP.site()?.host || "";
    if (!domains.length || S.adding) return;
    S.adding = true;
    updateSelection();
    let added = [], skipped = [], items = [];
    try {
      const answer = await COMP.api("POST", "link-gaps/add", { site_id: siteId, domains });
      added = answer.added; skipped = answer.skipped;
      const rows = (await COMP.api("GET", `prospects?site_id=${siteId}`)).prospects;
      const known = new Set(added);
      items = absorb(rows.filter((row) => known.has(row.domain)), host);
    } catch (err) {
      S.adding = false;
      updateSelection();
      COMP.fail(err);
      return;
    }
    S.adding = false;
    S.picked.clear();
    COMP.refreshLogos({ watch: true });
    await COMP.reload({ quiet: true });
    UI.$("#cg-all")?.focus({ preventScroll: true });
    sayAdded(items, skipped, host);
  }

  /* Adding from the Summary, where a domain can be a gap for several sites. The server still decides what can be added. */
  COMP.addGap = async (siteId, host, domain, refresh) => {
    const answer = await COMP.api("POST", "link-gaps/add", { site_id: siteId, domains: [domain] });
    const known = new Set(answer.added);
    const items = absorb((await COMP.api("GET", `prospects?site_id=${siteId}`)).prospects.filter((row) => known.has(row.domain)), host);
    tab.loadedFor = undefined;
    COMP.refreshLogos({ watch: true });
    await refresh();
    sayAdded(items, answer.skipped, host, refresh);
    return items;
  };
  COMP.gapAuthority = (gap) => authorityCell(gap);

  // ---- facts typed by hand, from tools with no connection here -------------------------------------
  const TOOL_NAMES = ["Ahrefs", "SEMrush", "Moz", "Majestic", "Ubersuggest"];
  let editing = null; // { gap, rivals, refresh } while the panel is open
  const rivalsOf = (gap) => gap.rivals || gap.competitors || [];
  const autoWords = (gap) => {
    if (gap.auto_authority !== null && gap.auto_authority !== undefined) {
      const label = gap.auto_authority_label || "", brand = label && scaleOf(label);
      const source = !label ? "" : ` · ${esc(brand)}`; // a sentence: the tool by name (brands.js adds its logo)
      return `${t("From your files")}: ${UI.num(gap.auto_authority)}${source}`;
    }
    if (gap.top_percent) return `${t("From Common Crawl")}: ${t("Top")} ${UI.dec(gap.top_percent)}%`;
    return t("No score from a file yet");
  };
  COMP.editGap = (gap, rivals, opener, refresh) => {
    editing = { gap, rivals, refresh };
    const typed = gap?.edit || {}, name = gap ? gap.display || gap.domain : "", ticked = new Set(gap ? rivalsOf(gap).map((r) => r.id) : rivals.length === 1 ? [rivals[0].id] : []);
    const shownRivals = gap ? [...rivals, ...rivalsOf(gap).filter((r) => !rivals.some((x) => x.id === r.id))] : rivals;
    const head = gap ? UI.panelHead(t("Edit domain"), `<span class="mono" dir="auto">${esc(name)}</span>`, UI.siteLogo(gap.domain, 34)) : UI.panelHead(t("Add a domain"), t("Found in a tool not connected here"));
    UI.openPanel(`${head}
      <div class="panel-body"><form id="cg-edit-form" novalidate>
        ${gap ? `<p class="small sec cg-edit-intro">${t("From a tool not connected here. Uploads never overwrite it.")}</p>` : ""}
        <div id="cg-edit-error"></div>
        ${gap ? "" : `<label class="field"><span>${t("Domain or link")} <span class="req">*</span></span><input class="input mono" id="cg-edit-domain" placeholder="example.com" spellcheck="false" maxlength="2048" autocomplete="off" dir="auto" data-autofocus></label>`}
        <div class="field-row">
          <label class="field"><span>${t("Authority score, 0 to 100")}</span><input class="input tabular" type="number" id="cg-edit-score" min="0" max="100" step="1" value="${typed.authority ?? ""}" ${gap ? "data-autofocus" : ""}></label>
          <label class="field"><span>${t("Tool")}</span><input class="input" id="cg-edit-tool" spellcheck="false" value="${esc(typed.authority_label || "")}" list="cg-edit-tools" maxlength="120" autocomplete="off"><datalist id="cg-edit-tools">${TOOL_NAMES.map((tool) => `<option value="${esc(tool)}"></option>`).join("")}</datalist></label>
        </div>
        ${gap ? `<p class="help cg-edit-auto">${autoWords(gap)}</p>` : ""}
        <fieldset class="cg-edit-rivals"><legend>${t("Links to")}</legend>
          ${shownRivals.map((r) => `<label class="opt"><input type="checkbox" class="chk" data-cg-edit-rival="${r.id}" style="margin:0" ${ticked.has(r.id) ? "checked" : ""}><span class="mono small" dir="auto">${esc(r.host)}</span></label>`).join("")}
        </fieldset>
        <label class="field"><span>${t("Example link")}</span><input class="input mono" type="url" id="cg-edit-url" spellcheck="false" value="${esc(typed.sample_url || "")}" placeholder="${esc(gap ? gap.sample_url || `https://${gap.domain}/` : "https://example.com/page")}" maxlength="2048" autocomplete="off" dir="auto"></label>
        ${typed.at ? `<p class="help">${t("Edited")} ${esc(UI.fmtDateOnly(typed.at))}${typed.by ? ` · <span dir="auto">${esc(typed.by)}</span>` : ""}</p>` : ""}
      </form></div>
      <div class="panel-foot"><button class="btn btn-main" id="cg-edit-save">${t(gap ? "Save" : "Add")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button>${gap?.edit ? `<button class="btn btn-ghost ${gap.edit.hand_only ? "danger" : ""}" id="cg-edit-reset">${t(gap.edit.hand_only ? "Remove domain" : "Back to automatic")}</button>` : ""}</div>`,
    opener, { key: `gap-edit|${gap ? gap.domain : "new"}`, reopen: () => COMP.editGap(gap, rivals, opener, refresh) });
  };
  const editError = (words) => {
    UI.setHTML(UI.$("#cg-edit-error"), words ? `<div class="error" role="alert">${UI.icon("octagon-alert")}<span>${esc(t(words))}</span></div>` : "");
    if (words) UI.$("#panel .panel-body")?.scrollTo({ top: 0 });
  };
  /* The other tab keeps its own copy, so it reads again next time. */
  const afterEdit = async (refresh) => { tab.loadedFor = undefined; await refresh(); };
  async function saveEdit(button) {
    const { gap, refresh } = editing;
    editError("");
    const raw = UI.$("#cg-edit-score").value.trim(), tool = UI.$("#cg-edit-tool").value.trim();
    const before = new Set(gap ? rivalsOf(gap).map((r) => r.id) : []);
    const boxes = UI.$$("[data-cg-edit-rival]"), chosen = boxes.filter((box) => box.checked).map((box) => Number(box.dataset.cgEditRival));
    if (!gap && !UI.$("#cg-edit-domain").value.trim()) { editError("Say which domain."); UI.$("#cg-edit-domain").focus(); return; }
    if (!chosen.length) { editError(gap ? "A domain needs at least one competitor. To hide it, mark it as spam." : "Pick a competitor."); return; }
    button.disabled = true;
    let added = null;
    try {
      if (!gap) added = await COMP.api("POST", "link-gaps/add-domain", { domain: UI.$("#cg-edit-domain").value.trim(), competitors: chosen, authority: raw === "" ? null : Number(raw), authority_label: tool, sample_url: UI.$("#cg-edit-url").value.trim() });
      else await COMP.api("POST", "link-gaps/edit", {
        domain: gap.domain, authority: raw === "" ? null : Number(raw), authority_label: tool, sample_url: UI.$("#cg-edit-url").value.trim(),
        add_competitors: chosen.filter((id) => !before.has(id)), remove_competitors: [...before].filter((id) => !chosen.includes(id)),
      });
    } catch (err) {
      editError(err.message);
      button.disabled = false;
      return;
    }
    UI.forgetPanelForm();
    UI.closePanel();
    await afterEdit(refresh);
    if (!gap) { sayDomainAdded(added); return; }
    UI.toast(`${gap.display || gap.domain}: ${t("saved")}`);
  }
  /* A domain can be added and still not show in the list, so the message says why. */
  function sayDomainAdded(answer) {
    const words = [`${answer.domain}: ${t(answer.existing ? "already listed, so it was updated" : "added")}.`];
    if (answer.flagged) words.push(t("Its name looks like spam, so it's flagged."));
    if (answer.links_to.length) words.push(`${t("It already links to")} ${answer.links_to.join(", ")}, ${t("so it's left out there.")}`);
    UI.toast(words.join(" "), { kind: answer.flagged || answer.links_to.length ? "info" : undefined });
  }
  async function resetEdit(button) {
    const { gap, refresh } = editing, was = gap.edit;
    button.disabled = true;
    try {
      await COMP.api("POST", "link-gaps/edit/reset", { domain: gap.domain });
    } catch (err) {
      editError(err.message);
      button.disabled = false;
      return;
    }
    UI.forgetPanelForm();
    UI.closePanel();
    await afterEdit(refresh);
    UI.toast(`${gap.display || gap.domain}: ${t(was.hand_only ? "removed" : "back to automatic")}`, { undo: async () => {
      const again = { domain: gap.domain, authority: was.authority, authority_label: was.authority_label || "", sample_url: was.sample_url || "" };
      await (was.hand_only
        ? COMP.api("POST", "link-gaps/add-domain", { ...again, competitors: was.added })
        : COMP.api("POST", "link-gaps/edit", { ...again, add_competitors: was.added, remove_competitors: was.removed })).catch(COMP.fail);
      await afterEdit(refresh);
    } });
  }
  COMP.gapConsidered = (domain, host) => window.PROSPECTS.some((p) => p.domain === domain && p.site === host);

  function sayAdded(items, skipped, host, refresh = reloadHere) {
    const n = items.length;
    const words = `${UI.num(n)} ${t(n === 1 ? "domain added to In consideration" : "domains added to In consideration")}${skipped.length ? `. ${UI.num(skipped.length)} ${t("skipped")}` : ""}`;
    const toast = UI.toast(words, { undo: () => undoAdd(items, refresh) });
    const see = document.createElement("button");
    see.className = "link-btn";
    see.textContent = t("See them");
    see.addEventListener("click", () => { toast.remove(); seeThem(host); });
    toast.querySelector(".acts")?.prepend(see);
  }

  async function undoAdd(items, refresh = reloadHere) {
    const ids = new Set(items.map((p) => p.serverId)), before = window.PROSPECTS;
    window.PROSPECTS = window.PROSPECTS.filter((p) => !ids.has(p.serverId));
    try {
      await Promise.all(items.map((p) => COMP.api("DELETE", `prospects/${p.serverId}`).catch(quietly404)));
    } catch (err) { window.PROSPECTS = before; COMP.fail(err); }
    if (UI.state.route === "backlinks") UI.render();
    tab.loadedFor = undefined;
    await refresh();
  }

  // ---- the picked domains straight to To do, to a task, or to spam ---------------------------------
  const LINK_TYPES = ["Guest post", "Directory", "Press", "Sponsored", "Forum", "Other"]; // the same list as Backlinks → To do
  const pickedNames = () => [...S.picked].map((domain) => allRows().find((g) => g.domain === domain)?.display || domain);

  /* To do is a link on its way to a mediator, so it asks for one, as Backlinks → Move to To do does. */
  function openTodo(opener) {
    const n = S.picked.size;
    if (!n) return;
    const names = window.LinkExtras?.names?.() || [];
    UI.openPanel(`${UI.panelHead(t("Add to To do"), `${UI.num(n)} ${t(n === 1 ? "domain" : "domains")}`)}
      <form class="panel-body" id="cg-todo-form" novalidate>
        <label class="field"><span>${t("Mediator")} <span class="req">*</span></span><input class="input" id="cg-todo-mediator" list="cg-todo-mediators" dir="auto" spellcheck="false" autocomplete="off" data-autofocus aria-describedby="cg-todo-error" maxlength="180"><datalist id="cg-todo-mediators">${names.map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist><div id="cg-todo-error"></div></label>
        <label class="field"><span>${t("Link type")}</span><input class="input" id="cg-todo-type" list="cg-todo-types" dir="auto" spellcheck="false" autocomplete="off" value="Guest post" maxlength="100"><datalist id="cg-todo-types">${LINK_TYPES.map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist></label>
        <p class="help">${t("Straight to Backlinks → To do, skipping In consideration. Add each article's Google Docs link there.")}</p>
      </form>
      <div class="panel-foot"><button class="btn btn-main" id="cg-todo-save">${t("Add to To do")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener);
  }

  async function saveTodo(button) {
    const mediator = UI.$("#cg-todo-mediator").value.trim(), linkType = UI.$("#cg-todo-type").value.trim();
    const say = (words) => { UI.$("#cg-todo-mediator").classList.add("invalid"); UI.setHTML(UI.$("#cg-todo-error"), `<div class="error" role="alert">${UI.icon("octagon-alert")}<span>${esc(t(words))}</span></div>`); UI.$("#cg-todo-mediator").focus(); };
    if (!mediator) { say("Choose a mediator."); return; }
    const domains = [...S.picked], siteId = COMP.siteId, host = COMP.site()?.host || "";
    if (!domains.length || S.adding) return;
    button.disabled = true;
    S.adding = true;
    updateSelection();
    let made = [], skipped = [], ids = [], logged = 0;
    try {
      // The server only moves what is in consideration, so they pass through it on the way.
      const answer = await COMP.api("POST", "link-gaps/add", { site_id: siteId, domains });
      skipped = answer.skipped;
      const known = new Set(answer.added);
      ids = (await COMP.api("GET", `prospects?site_id=${siteId}`)).prospects.filter((row) => known.has(row.domain)).map((row) => row.id);
      if (ids.length) {
        const moved = await COMP.api("POST", "backlinks/todo/move", { prospect_ids: ids, mediator, link_type: linkType });
        made = moved.saved; logged = (moved.skipped || []).length;
        const gone = new Set(moved.prospects_removed || []);
        window.PROSPECTS = window.PROSPECTS.filter((p) => !gone.has(p.serverId));
      }
    } catch (err) {
      S.adding = false;
      button.disabled = false;
      updateSelection();
      // Added but not moved: they are in consideration, and the words say so.
      say(ids.length ? `${t("Added to In consideration, not To do")}: ${err.message}` : err.message);
      await COMP.reload({ quiet: true });
      return;
    }
    S.adding = false;
    S.picked.clear();
    UI.forgetPanelForm();
    UI.closePanel();
    UI.ignoreClicks();
    window.UI.reloadBacklinks?.();
    COMP.refreshLogos({ watch: true });
    await COMP.reload({ quiet: true });
    UI.$("#cg-all")?.focus({ preventScroll: true });
    const n = made.length;
    // A domain already in Backlinks (a lost link, say) can't be logged twice: it stays in In consideration, and the words say so.
    const words = `${UI.num(n)} ${t(n === 1 ? "domain added to To do" : "domains added to To do")}${logged ? `. ${UI.num(logged)} ${t(logged === 1 ? "is already in Backlinks: kept in In consideration" : "are already in Backlinks: kept in In consideration")}` : ""}${skipped.length ? `. ${UI.num(skipped.length)} ${t("skipped")}` : ""}`;
    const toast = UI.toast(words, n ? { undo: () => undoTodo(made), stay: Boolean(logged) } : { kind: "info", stay: Boolean(logged) });
    if (!n && !logged) return;
    const see = document.createElement("button");
    see.className = "link-btn";
    see.textContent = t("See them");
    see.addEventListener("click", () => { toast.remove(); seeThem(host, n ? "todo" : "consideration"); });
    toast.querySelector(".acts")?.prepend(see);
  }

  /* Undo takes them out of To do and out of In consideration, so the gap list is as it was. */
  async function undoTodo(made) {
    try {
      const back = await COMP.api("POST", "backlinks/todo/move-back", { ids: made.map((row) => row.id) });
      await Promise.all((back.prospects || []).map((row) => COMP.api("DELETE", `prospects/${row.id}`).catch(quietly404)));
    } catch (err) { COMP.fail(err); }
    window.UI.reloadBacklinks?.();
    tab.loadedFor = undefined;
    await reloadHere();
  }

  function taskPicked(opener) {
    const names = pickedNames(), host = COMP.site()?.host || null;
    if (!names.length) return;
    UI.openTask({
      title: `${t("Get a link from")} ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}`,
      host, opener,
      source: { type: "competitor", label: `${t("Link gaps")}: ${UI.num(names.length)} ${t(names.length === 1 ? "domain" : "domains")}`, facts: names.slice(0, 20), link: "#competitors/gaps" },
    });
  }

  async function spamPicked() {
    const domains = [...S.picked];
    if (!domains.length || S.adding) return;
    S.adding = true;
    updateSelection();
    const done = [];
    try {
      for (const domain of domains) { await COMP.api("POST", "link-gaps/decide", { site_id: COMP.siteId, domain, decision: "spam" }); done.push(domain); }
    } catch (err) { COMP.fail(err); }
    S.adding = false;
    done.forEach((domain) => S.picked.delete(domain));
    await COMP.reload({ quiet: true });
    if (!done.length) return;
    UI.toast(`${UI.num(done.length)} ${t(done.length === 1 ? "domain marked as spam" : "domains marked as spam")}`, { kind: "info", undo: async () => {
      await Promise.all(done.map((domain) => COMP.api("POST", "link-gaps/decide", { site_id: COMP.siteId, domain, decision: "auto" }).catch(COMP.fail)));
      await reloadHere();
    } });
  }

  // ---- a person's decision beats the filter -----------------------------------------------------
  const deciding = new Set();
  async function decide(domain, decision) {
    if (deciding.has(domain)) return; // a double click decides once
    deciding.add(domain);
    const host = COMP.site()?.host || "", siteId = COMP.siteId;
    let answer;
    try {
      answer = await COMP.api("POST", "link-gaps/decide", { site_id: siteId, domain, decision });
    } catch (err) { COMP.fail(err); return; } finally { deciding.delete(domain); }
    S.picked.delete(domain);
    // Spam and In consideration never together: the server took it off the list, so this page's copy follows.
    const removed = answer?.prospects_removed || [];
    const local = window.PROSPECTS.filter((p) => p.domain === domain && p.site === host && (!p.serverId || removed.some((r) => r.id === p.serverId)));
    if (decision === "spam" && local.length) { window.PROSPECTS = window.PROSPECTS.filter((p) => !local.includes(p)); window.UI.reloadBacklinks?.(); }
    const offList = decision === "spam" && (removed.length > 0 || local.length > 0);
    await COMP.reload({ quiet: true });
    if (decision === "auto") return;
    const words = decision === "keep" ? `${domain}: ${t("not spam: ready to add")}` : offList ? `${domain}: ${t("marked as spam and taken off In consideration")}` : `${domain}: ${t("marked as spam, can't be added")}`;
    UI.toast(words, { kind: "info", undo: async () => {
      // Undo puts back both: the filter decides again, and the domain returns to In consideration as it was.
      await COMP.api("POST", "link-gaps/decide", { site_id: siteId, domain, decision: "auto", ...(removed.length ? { restore: removed } : {}) }).catch(COMP.fail);
      if (offList) {
        const back = local.filter((p) => !p.serverId);
        if (back.length) window.PROSPECTS = back.concat(window.PROSPECTS);
        absorb(removed, host);
        window.UI.reloadBacklinks?.();
      }
      await reloadHere();
    } });
  }

  /* While home pages are being read, only the counts change, so nothing moves under the pointer until there's news. */
  const watch = { timer: null, started: 0 };
  function keepWatching() {
    clearTimeout(watch.timer);
    if (!onScreen() || !S.data?.funnel?.checking) { watch.started = 0; return; }
    if (!watch.started) watch.started = Date.now();
    if (Date.now() - watch.started > 180000) return; // the worker may not be running: the numbers on screen stay true
    watch.timer = setTimeout(async () => {
      if (!onScreen()) return;
      let answer;
      try { answer = await COMP.api("GET", `link-gaps?site_id=${COMP.siteId}`); } catch { keepWatching(); return; }
      if (JSON.stringify(answer.funnel) !== JSON.stringify(S.data?.funnel)) {
        S.data = answer;
        trimPicked();
        const focused = document.activeElement?.id;
        COMP.paint();
        if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
      }
      keepWatching();
    }, 3000);
  }

  // ---- the upload dialog ------------------------------------------------------------------------
  let uploadOpener = null;
  const dialogHead = () => `<div class="dlg-head"><h2 id="dlg-title">${t("Upload a competitor's links")}</h2><button class="icon-btn" data-close-dlg aria-label="${t("Close")}">${UI.icon("x")}</button></div>`;

  function uploadForm(competitorId, error = null) {
    const d = S.data;
    return `${dialogHead()}
      <div class="dlg-body">
        <p class="small sec" style="margin-bottom:12px">${t("A CSV of this competitor's links from a free SEMrush or Ubersuggest account, with a URL or domain column.")}</p>
        <label class="field"><span>${t("Competitor")}</span><select class="select" id="cg-up-who" style="width:100%">${d.competitors.map((c) => `<option value="${c.id}" ${c.id === competitorId ? "selected" : ""}>${esc(c.host)} · ${t(c.has_file ? "File uploaded" : c.has_data ? "Links found" : "No file yet")}</option>`).join("")}</select></label>
        <label class="field"><span>${t("File")}</span><input class="input" id="cg-up-file" type="file" accept=".csv,.tsv,.txt,text/csv"></label>
        <div id="cg-up-error">${error ? errorBox(error) : ""}</div>
      </div>
      <div class="dlg-foot"><button class="btn" data-close-dlg>${t("Cancel")}</button><button class="btn btn-main" id="cg-up-send" data-cg-send disabled>${UI.icon("list-plus")}${t("Upload")}</button></div>`;
  }
  const errorBox = (message) => `<div class="error cg-error" role="alert">${UI.icon("octagon-alert")}<span dir="auto">${esc(serverWords(message))}</span></div>`;

  function openUpload(competitorId, opener) {
    const dlg = UI.$("#dlg");
    uploadOpener = opener?.id || null;
    dlg.classList.remove("wide");
    UI.setHTML(dlg, uploadForm(competitorId));
    dlg.showModal();
    UI.$("#cg-up-file")?.focus();
  }

  function uploadResult(answer, competitorId) {
    const stat = (label, value, note = "") => `<div class="clean-stat"><div class="lab">${t(label)}</div><div class="n tabular">${UI.num(value)}</div>${note ? `<div class="small muted">${esc(note)}</div>` : ""}</div>`;
    const host = S.data?.competitors.find((c) => c.id === competitorId)?.host || "";
    UI.setHTML(UI.$("#dlg"), `${dialogHead()}
      <div class="dlg-body">
        <p class="small sec" style="margin-bottom:10px">${esc(t("Links to"))} <span class="mono" dir="auto">${esc(host)}</span>${answer.source_label ? ` · ${esc(answer.source_label)}` : ""}</p>
        <div class="clean-sum">${stat("Rows", answer.total)}${stat("Domains", answer.domains)}${stat("Flagged as spam", answer.flagged ?? answer.removed_spam ?? 0)}${stat("No address", answer.removed_no_url ?? 0)}</div>
        <p class="note" style="margin:12px 0 0">${UI.icon("info")}<span>${t("Next, each home page is read once to flag spam. Nothing is removed; only good ones can be added.")}</span></p>
      </div>
      <div class="dlg-foot"><button class="btn btn-ghost" data-cg-another="${competitorId}" style="margin-right:auto">${t("Upload another")}</button><button class="btn btn-main" id="cg-up-done" data-close-dlg>${t("Done")}</button></div>`);
    UI.$("#cg-up-done")?.focus();
  }

  async function sendUpload(button) {
    const input = UI.$("#cg-up-file"), file = input?.files?.[0];
    const competitorId = Number(UI.$("#cg-up-who")?.value);
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("site_id", String(COMP.siteId));
    form.append("competitor_id", String(competitorId));
    button.disabled = true;
    UI.setHTML(button, `${UI.icon("refresh-cw", "spin")}${t("Uploading…")}`);
    try {
      const answer = await COMP.api("POST", "link-gaps/import", undefined, { form });
      uploadResult(answer, competitorId);
      await COMP.reload({ quiet: true });
    } catch (err) {
      UI.setHTML(UI.$("#cg-up-error"), errorBox(err.message));
      UI.setHTML(button, `${UI.icon("list-plus")}${t("Upload")}`);
      button.disabled = false;
    }
  }

  // ---- events -----------------------------------------------------------------------------------
  function bind() {
    // Two fields and no button inside the form, so a browser won't send it on Enter by itself.
    document.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing && e.target.closest?.("#cg-todo-form")) { e.preventDefault(); UI.$("#cg-todo-save")?.click(); } });
    document.addEventListener("click", (e) => {
      const hit = (sel) => e.target.closest?.(sel);
      let el;
      if (hit("[data-cg-find]")) { COMP.open("find"); return; }
      if ((el = hit("#cg-filter"))) { openCompetitorPick(el); return; }
      if ((el = hit("[data-cg-choose]"))) { UI.closePopover(); S.filter = el.dataset.cgChoose; TP.reset(PAGES); trimPicked(); COMP.paint(); UI.$("#cg-filter")?.focus(); return; }
      if ((el = hit("[data-cg-upload]"))) { openUpload(Number(el.dataset.cgUpload), el); return; }
      if (hit("[data-cg-send]")) { sendUpload(hit("[data-cg-send]")); return; }
      if ((el = hit("[data-cg-another]"))) {
        UI.setHTML(UI.$("#dlg"), uploadForm(Number(el.dataset.cgAnother)));
        UI.$("#cg-up-file")?.focus();
        return;
      }
      if (hit("[data-cg-add]")) { addPicked(); return; }
      if ((el = hit("[data-cg-todo]"))) { openTodo(el); return; }
      if ((el = hit("#cg-todo-save"))) { saveTodo(el); return; }
      if ((el = hit("[data-cg-task]"))) { taskPicked(el); return; }
      if (hit("[data-cg-spam-picked]")) { spamPicked(); return; }
      if (hit("[data-cg-add-all]")) { allRows().filter((g) => canPick(g) && !oldHidden(g)).forEach((g) => S.picked.add(g.domain)); addPicked(); return; }
      if ((el = hit("[data-cg-menu]"))) { openRowMenu(el); return; }
      // From a row's ⋯ menu: the menu closes, and the ⋯ button is where the keyboard comes back to.
      if ((el = hit("[data-cg-from-menu]"))) {
        UI.closePopover();
        const opener = UI.$(`[data-cg-menu="${CSS.escape(el.dataset.domain || el.dataset.cgEdit)}"]`) || el;
        if (el.dataset.cgDecide) { COMP.refocus = `[data-cg-menu="${CSS.escape(el.dataset.domain)}"]`; decide(el.dataset.domain, el.dataset.cgDecide); return; }
        const gap = allRows().find((row) => row.domain === el.dataset.cgEdit);
        if (gap) COMP.editGap(gap, S.data.competitors.map((c) => ({ id: c.id, host: c.host })), opener, reloadHere);
        return;
      }
      if ((el = hit("[data-cg-decide]"))) { decide(el.dataset.domain, el.dataset.cgDecide); return; }
      if ((el = hit("[data-cg-edit]"))) {
        const gap = allRows().find((row) => row.domain === el.dataset.cgEdit);
        if (gap) COMP.editGap(gap, S.data.competitors.map((c) => ({ id: c.id, host: c.host })), el, reloadHere);
        return;
      }
      if ((el = hit("[data-cg-add-domain]"))) { COMP.editGap(null, S.data.competitors.map((c) => ({ id: c.id, host: c.host })), el, reloadHere); return; }
      if (hit("#cg-edit-save")) { saveEdit(hit("#cg-edit-save")); return; }
      if (hit("#cg-edit-reset")) { resetEdit(hit("#cg-edit-reset")); return; }
      if ((el = hit("[data-cg-reason]"))) {
        const key = el.dataset.cgReason;
        S.reason = S.reason === key ? "" : key;
        TP.reset(PAGES); trimPicked(); COMP.paint();
        [...UI.$$("[data-cg-reason]")].find((b) => b.dataset.cgReason === key)?.focus();
        return;
      }
      if ((el = hit("[data-cg-quality]"))) { S.quality = el.dataset.cgQuality; S.reason = ""; refilter(`[data-cg-quality="${S.quality}"]`); return; }
      if ((el = hit("#cg-filters"))) { openFilters(el); return; }
      if (hit("[data-cg-show-nofollow]")) { S.followed = false; refilter(); return; }
      if (hit("[data-cg-old]")) { S.old = !S.old; refilter(UI.$("#popover.cg-filter-pop") ? ".cg-filter-pop [data-cg-old]" : "[data-cg-old]"); return; }
      if (hit("[data-cg-unfilter]")) { Object.assign(S, { reach: "any", pa: "", quality: "all", hide: false, reason: "", old: false }); refilter("#cg-reach"); return; }
      if ((el = hit("[data-cg-sort]"))) {
        const id = el.dataset.cgSort, first = id === "domain" || id === "anchor" ? "asc" : "desc"; // words A to Z, numbers biggest first
        S.sort = S.sort?.id !== id ? { id, dir: first } : S.sort.dir === first ? { id, dir: first === "asc" ? "desc" : "asc" } : null; // a third click goes back to the usual order
        TP.reset(PAGES); trimPicked(); COMP.paint(); UI.$(`[data-cg-sort="${id}"]`)?.focus();
        return;
      }
      if ((el = hit("[data-cg-links]"))) {
        const domain = el.dataset.cgLinks;
        S.openLink = S.openLink === domain ? null : domain; // one at a time, so the list stays readable
        S.linkSort = null; TP.reset(LINK_PAGES);
        COMP.paint(); UI.$(`[data-cg-links="${CSS.escape(domain)}"]`)?.focus();
        return;
      }
      if ((el = hit("[data-cg-link-sort]"))) {
        const id = el.dataset.cgLinkSort, first = id === "pa" ? "desc" : "asc"; // numbers biggest first, words A to Z
        S.linkSort = S.linkSort?.id !== id ? { id, dir: first } : S.linkSort.dir === first ? { id, dir: first === "asc" ? "desc" : "asc" } : null;
        TP.reset(LINK_PAGES); COMP.paint(); UI.$(`[data-cg-link-sort="${id}"]`)?.focus();
        return;
      }
      if (hit("[data-cg-clear]")) { S.picked.clear(); updateSelection(); UI.$("#cg-all")?.focus({ preventScroll: true }); return; }
      // The whole row ticks its box, except where the click is on something of its own.
      const row = hit("#cg-table tbody tr");
      if (row && !hit("a, button, input, select, label") && !String(getSelection?.() || "")) {
        const domain = row.dataset.cgRow, gap = allRows().find((g) => g.domain === domain);
        if (!gap || !canPick(gap)) return;
        if (S.picked.has(domain)) S.picked.delete(domain); else S.picked.add(domain);
        updateSelection();
      }
    });
    document.addEventListener("change", (e) => {
      const id = e.target.id;
      if (e.target.matches?.("[data-cg-pick]")) {
        const domain = e.target.dataset.cgPick;
        if (e.target.checked) S.picked.add(domain); else S.picked.delete(domain);
        updateSelection();
        return;
      }
      if (id === "cg-all") {
        const open = pickable();
        if (e.target.checked) open.forEach((g) => S.picked.add(g.domain)); else open.forEach((g) => S.picked.delete(g.domain));
        updateSelection();
        return;
      }
      if (id === "cg-reach") { S.reach = e.target.value; refilter("#cg-reach"); return; }
      if (id === "cg-pa") { S.pa = e.target.value; refilter("#cg-pa"); return; }
      if (id === "cg-hide") { S.hide = e.target.checked; refilter("#cg-hide"); return; }
      if (id === "cg-followed") { S.followed = e.target.checked; refilter("#cg-followed"); return; }
      if (id === "cg-up-file") {
        UI.$("#cg-up-error")?.replaceChildren();
        const send = UI.$("#cg-up-send");
        if (send) send.disabled = !e.target.files?.length;
        return;
      }
      if (id === "cg-up-who") UI.$("#cg-up-error")?.replaceChildren();
    });
    // After the dialog, focus goes back to the upload button it came from. A reload may have rebuilt it.
    UI.$("#dlg").addEventListener("close", () => {
      if (uploadOpener) { document.getElementById(uploadOpener)?.focus({ preventScroll: true }); uploadOpener = null; }
    });
    window.addEventListener("seocc:prospect-removed", prospectRemoved);
    window.addEventListener("seocc:prospect-restored", prospectRestored);
    window.addEventListener("seocc:backlinks-changed", () => { tab.loadedFor = undefined; }); // a saved link can stop a domain being a gap
  }

  const tab = {
    id: "gaps", order: 40, label: "Link gaps", icon: "link-2-off",
    init(helpers) {
      UI = helpers;
      bind();
      TP.on(PAGES, () => { trimPicked(); COMP.paint(); }); // another page, another size, or a search: picks off screen are let go
      TP.on(LINK_PAGES, () => COMP.paint());
      COMP.isServer().then((server) => { if (server) return loadExistingProspects(); return null; }).catch(() => {});
    },
    async load() {
      const siteId = COMP.siteId;
      if (S.site !== siteId) { S.site = siteId; S.filter = ""; S.hide = false; S.followed = null; S.old = false; S.quality = "all"; S.reason = ""; S.reach = "any"; S.sort = null; S.openLink = null; S.linkSort = null; TP.state(PAGES).q = ""; TP.reset(PAGES); S.picked.clear(); }
      await sync; // anything the Backlinks page just changed is on the server before reading it back
      const [answer, competitors] = await Promise.all([COMP.api("GET", `link-gaps?site_id=${siteId}`), COMP.api("GET", `competitors?site_id=${siteId}`)]);
      if (siteId !== COMP.siteId) return; // another site was picked while this was on its way
      // Opened as a plain file, a competitor added just now isn't in the gap snapshot yet.
      const seen = new Set(answer.competitors.map((c) => c.id));
      competitors.competitors.forEach((c) => { if (!seen.has(c.id)) answer.competitors.push({ id: c.id, host: c.host, has_data: false }); });
      S.data = answer;
      if (S.filter && !answer.competitors.some((c) => String(c.id) === S.filter && c.has_data)) S.filter = "";
      trimPicked();
    },
    body,
    /* Simpler screens: the two ways to bring in domains sit in the head, so the bar over the table is only search and filters. */
    headMain: () => (S.data?.competitors?.length ? `<span class="cg-head-acts" data-comp-main="gaps"><button class="btn" id="cg-upload-head" data-cg-upload="${uploadTarget(S.data)}">${UI.icon("list-plus")}${t("Upload links")}</button><button class="btn" id="cg-add-domain-head" data-cg-add-domain>${UI.icon("plus")}${t("Add a domain")}</button></span>` : ""),
    headInfo: () => [INTRO],
    // Say what the list is in its head (COMPARISON, place 3): sites that link to competitors and not to me.
    headLine: () => `<span class="cg-head-line">${esc(t("Sites linking to your competitors, not to you"))}</span>`,
    after() {
      const all = UI.$("#cg-all");
      if (all) all.indeterminate = all.dataset.indeterminate === "true";
      keepWatching();
    },
  };
  COMP.addTab(tab);

  // ---- opened as a plain file: the same writes, changing the sample in place -------------------
  const sample = () => window.COMP_SAMPLE.get;
  const sampleGaps = (siteId) => {
    const key = `link-gaps?site_id=${siteId}`;
    sample()[key] = sample()[key] || { already_linking: 0, competitors: [], gaps: [] };
    return sample()[key];
  };
  const sampleProspects = (siteId) => {
    const key = `prospects?site_id=${siteId}`;
    sample()[key] = sample()[key] || { prospects: [] };
    return sample()[key].prospects;
  };
  const sampleOwnDomains = () => new Set(sample()["links/sites"].sites.map((s) => window.BacklinkCleaner.rootDomain(s.host) || s.host));
  let nextProspectId = 1;

  const recount = (report) => {
    const filtered = report.filtered || [];
    report.filtered = filtered;
    report.funnel = { found: report.gaps.length + filtered.length, filtered: filtered.length, checking: 0, good: report.gaps.length };
  };
  /* Plain-file mode can't read home pages, so it applies the name rules only. */
  const sampleNameReason = (domain) => {
    if (/casino|poker|betting|porn|xxx|viagra|cialis|escort|backlink|linkfarm/.test(domain)) return ["name_words", "Spam words in name", "system"];
    const tld = domain.split(".").pop();
    if (["tk", "ml", "ga", "cf", "gq"].includes(tld)) return ["free_tld", "Free domain ending spammers favour", "system"];
    if (["top", "click", "loan", "work", "bid", "win", "icu", "buzz"].includes(tld)) return ["abused_tld", "Domain ending known for abuse", "system"];
    return null;
  };
  COMP.sampleWrite("POST link-gaps/decide", (match, body) => {
    const report = sampleGaps(body.site_id);
    report.filtered = report.filtered || [];
    const inGood = report.gaps.findIndex((g) => g.domain === body.domain), inSpam = report.filtered.findIndex((g) => g.domain === body.domain);
    if (body.decision === "keep" && inSpam >= 0) {
      const [row] = report.filtered.splice(inSpam, 1);
      row.quality = "good"; row.kept = true; row.was = { reason: row.reason, words: row.reason_words, by: row.flagged_by }; row.reason = null; row.reason_words = null;
      report.gaps.unshift(row);
    } else if (body.decision === "spam" && inGood >= 0) {
      const [row] = report.gaps.splice(inGood, 1);
      row.quality = "spam"; row.reason = "my_choice"; row.reason_words = "Marked by you"; row.flagged_by = "you"; row.manual = true;
      report.filtered.unshift(row);
      // As the server does: spam takes it off In consideration, and the rows taken off go back to the page for Undo.
      const list = sampleProspects(body.site_id), gone = list.filter((p) => p.domain === body.domain);
      gone.forEach((p) => list.splice(list.indexOf(p), 1));
      row.in_consideration = false;
      recount(report);
      return { ok: true, prospects_removed: gone };
    } else if (body.decision === "auto") {
      if (Array.isArray(body.restore) && body.restore.length) {
        const list = sampleProspects(body.site_id);
        body.restore.forEach((p) => { if (!list.some((x) => x.id === p.id)) list.unshift(p); });
        const row = [...report.gaps, ...report.filtered].find((g) => g.domain === body.domain);
        if (row) row.in_consideration = true;
      }
      if (inGood >= 0 && report.gaps[inGood].kept) {
        const [row] = report.gaps.splice(inGood, 1);
        row.quality = "spam"; row.kept = false; row.reason = row.was?.reason; row.reason_words = row.was?.words; row.flagged_by = row.was?.by;
        report.filtered.unshift(row);
      } else if (inSpam >= 0 && report.filtered[inSpam].manual) {
        const [row] = report.filtered.splice(inSpam, 1);
        row.quality = "good"; row.manual = false; row.reason = null; row.reason_words = null;
        report.gaps.unshift(row);
      }
    }
    recount(report);
    return { ok: true };
  });

  /* Every copy of a domain in the sample: the Summary's and each site's Link gaps. */
  const sampleReports = () => Object.keys(sample()).filter((key) => key.startsWith("collective/links") || key.startsWith("link-gaps?")).map((key) => sample()[key]);
  const sampleRows = (report, domain) => ["gaps", "filtered", "flagged"].flatMap((list) => report[list] || []).filter((row) => row.domain === domain);
  function sampleResort(report) {
    const count = (g) => g.rival_count ?? g.competitor_count ?? 0;
    ["gaps", "filtered", "flagged"].forEach((list) => report[list]?.sort((a, b) => count(b) - count(a) || (b.authority ?? -1) - (a.authority ?? -1) || a.domain.localeCompare(b.domain)));
  }
  function sampleRewrite(domain, change) {
    const hosts = new Map();
    sampleReports().forEach((report) => ["gaps", "filtered", "flagged"].flatMap((list) => report[list] || []).forEach((row) => rivalsOf(row).forEach((r) => hosts.set(r.id, r.host))));
    sampleReports().forEach((report) => {
      sampleRows(report, domain).forEach((row) => {
        row.orig = row.orig || JSON.parse(JSON.stringify({ authority: row.authority, authority_label: row.authority_label, sample_url: row.sample_url, list: rivalsOf(row) }));
        change(row, hosts, report);
        const field = row.rivals ? "rivals" : "competitors";
        row[field] = row.list;
        delete row.list;
        if (row.rivals) row.rival_count = row.rivals.length; else row.competitor_count = row.competitors.length;
      });
      sampleResort(report);
    });
  }
  COMP.sampleWrite("POST link-gaps/edit/reset", (match, body) => {
    sampleRewrite(body.domain, (row) => {
      Object.assign(row, { authority: row.orig.authority, authority_label: row.orig.authority_label, sample_url: row.orig.sample_url, list: row.orig.list, authority_by_hand: false, edit: null });
    });
    // Only someone's typing kept it on the list.
    sampleReports().forEach((report) => { ["gaps", "filtered", "flagged"].forEach((list) => { if (report[list]) report[list] = report[list].filter((row) => row.domain !== body.domain || rivalsOf(row).length); }); sampleCount(report); });
    return { ok: true };
  });
  function sampleCount(report) {
    if (!report.funnel) return;
    const bad = (report.filtered || report.flagged || []).length;
    Object.assign(report.funnel, { found: report.gaps.length + bad, good: report.gaps.length, filtered: bad, flagged: bad });
  }
  const sampleTrackers = (id) => Object.keys(sample()).filter((key) => key.startsWith("link-gaps?") && sample()[key].competitors?.some((c) => c.id === id)).map((key) => Number(key.split("=")[1]));
  COMP.sampleWrite("POST link-gaps/add-domain", (match, body) => {
    const domain = window.BacklinkCleaner.rootDomain(body.domain || "");
    if (!domain) throw new Error("Not a web address.");
    if (!body.competitors?.length) throw new Error("Pick a competitor.");
    if (sampleOwnDomains().has(domain)) throw new Error("That's one of your own websites.");
    const score = body.authority, tool = (body.authority_label || "").trim();
    if (score !== null && (!Number.isInteger(score) || score < 0 || score > 100)) throw new Error("Score must be 0 to 100.");
    if (score !== null && !tool) throw new Error("Say which tool this score comes from.");
    if (tool && score === null) throw new Error("Type the score from that tool too.");
    const reports = sampleReports(), rows = reports.flatMap((report) => sampleRows(report, domain));
    const pasted = /^https?:\/\//i.test(body.domain) && !/^https?:\/\/[^/]+\/?$/i.test(body.domain) ? body.domain.trim() : "";
    const url = body.sample_url || pasted;
    if (url && window.BacklinkCleaner.rootDomain(url) !== domain) throw new Error(`That link isn't on ${domain}.`);
    const hosts = new Map();
    reports.forEach((report) => { (report.competitors || []).forEach((c) => hosts.set(c.id, c.host)); ["gaps", "filtered", "flagged"].flatMap((list) => report[list] || []).forEach((row) => rivalsOf(row).forEach((r) => hosts.set(r.id, r.host))); });
    const existing = rows.length > 0, spam = sampleNameReason(domain);
    const sites = sample()["links/sites"].sites;
    reports.forEach((report) => {
      const scoped = report.competitors ? new Set(report.competitors.map((c) => c.id)) : null;
      const here = report.sites && report.sites.length === 1 ? sampleTrackers : null;
      const wanted = body.competitors.filter((id) => (scoped ? scoped.has(id) : !here || sampleTrackers(id).includes(report.sites[0].id)));
      const now = sampleRows(report, domain);
      if (now.length) {
        now.forEach((row) => {
          const list = rivalsOf(row);
          wanted.forEach((id) => { if (!list.some((r) => r.id === id)) list.push({ id, host: hosts.get(id) }); });
          if (row.rivals) row.rival_count = list.length; else row.competitor_count = list.length;
          if (score !== null) { row.authority = score; row.authority_label = tool; row.authority_by_hand = true; }
          row.edit = row.edit || { authority: score, authority_label: tool || null, sample_url: url || null, by: window.TEAM?.[0] || "", at: new Date().toISOString(), added: wanted, removed: [], hand_only: false };
        });
      } else if (wanted.length) {
        const list = wanted.map((id) => ({ id, host: hosts.get(id) }));
        const common = { domain, display: domain, title: null, sample_url: url || null, authority: score, authority_label: score === null ? null : tool, top_percent: null, cc_rank: null, sources: ["By hand"], is_competitor: false, auto_authority: null, auto_authority_label: null, authority_by_hand: score !== null, orig: { authority: null, authority_label: null, sample_url: null, list: [] }, edit: { authority: score, authority_label: tool || null, sample_url: url || null, by: window.TEAM?.[0] || "", at: new Date().toISOString(), added: wanted, removed: [], hand_only: true } };
        const state = { quality: spam ? "spam" : "good", reason: spam?.[0] || null, reason_words: spam?.[1] || null, flagged_by: spam?.[2] || null, kept: false };
        const row = report.competitors
          ? { ...common, ...state, competitors: list, competitor_count: list.length, spam_score: null, first_seen: new Date().toISOString(), in_consideration: false, lost_link: false, page_note: null, outlinks: null }
          : { ...common, rivals: list, rival_count: list.length, sites: [...new Set(wanted.flatMap(sampleTrackers))].filter((id) => !report.sites || report.sites.some((s) => s.id === id)).map((id) => ({ id, host: sites.find((s) => s.id === id)?.host, ...state, reason: undefined, in_consideration: false, lost_link: false })) };
        const shelf = spam ? (report.competitors ? "filtered" : "flagged") : "gaps";
        report[shelf] = report[shelf] || [];
        report[shelf].push(row);
      }
      sampleResort(report);
      sampleCount(report);
    });
    return { domain, existing, flagged: Boolean(spam), links_to: [] };
  });
  COMP.sampleWrite("POST link-gaps/edit", (match, body) => {
    const score = body.authority, tool = (body.authority_label || "").trim(), url = body.sample_url || "";
    if (score !== null && (!Number.isInteger(score) || score < 0 || score > 100)) throw new Error("Score must be 0 to 100.");
    if (score !== null && !tool) throw new Error("Say which tool this score comes from.");
    if (tool && score === null) throw new Error("Type the score from that tool too.");
    if (url && !/^https?:\/\/\S+$/i.test(url)) throw new Error("Not a web address.");
    if (url && window.BacklinkCleaner.rootDomain(url) !== body.domain) throw new Error(`That link isn't on ${body.domain}.`);
    sampleRewrite(body.domain, (row, hosts, report) => {
      const inScope = (id) => !report.competitors || report.competitors.some((c) => c.id === id);
      const now = rivalsOf(row).filter((r) => !body.remove_competitors.includes(r.id));
      body.add_competitors.filter(inScope).forEach((id) => { if (!now.some((r) => r.id === id)) now.push({ id, host: hosts.get(id) || String(id) }); });
      row.list = now;
      row.auto_authority = row.orig.authority; row.auto_authority_label = row.orig.authority_label;
      row.authority = score ?? row.orig.authority; row.authority_label = score === null ? row.orig.authority_label : tool; row.authority_by_hand = score !== null;
      row.sample_url = url || row.orig.sample_url;
      const was = new Set(row.orig.list.map((r) => r.id));
      const added = now.filter((r) => !was.has(r.id)).map((r) => r.id), removed = [...was].filter((id) => !now.some((r) => r.id === id));
      row.edit = score !== null || url || added.length || removed.length ? { authority: score, authority_label: tool || null, sample_url: url || null, by: window.TEAM?.[0] || "", at: new Date().toISOString(), added, removed, hand_only: !row.orig.list.length } : null;
    });
    return { ok: true };
  });

  COMP.sampleWrite("POST link-gaps/add", (match, body) => {
    if (!Array.isArray(body.domains) || !body.domains.length) throw new Error("Pick a domain.");
    const report = sampleGaps(body.site_id), added = [], skipped = [];
    [...new Set(body.domains)].forEach((domain) => {
      const gap = report.gaps.find((g) => g.domain === domain);
      if (!gap || gap.in_consideration) { skipped.push(domain); return; }
      gap.in_consideration = true;
      sampleProspects(body.site_id).unshift({
        id: nextProspectId++, site_id: body.site_id, url: gap.sample_url || `https://${domain}/`, domain, authority: gap.authority, authority_label: gap.authority_label, spam_score: gap.spam_score,
        source_file: `Link gap: ${gap.competitors.map((c) => c.host).join(", ")}`.slice(0, 255), source_kind: "link_gap", created_at: new Date().toISOString(),
      });
      added.push(domain);
    });
    return { added, skipped };
  });

  COMP.sampleWrite("DELETE prospects/(\\d+)", (match) => {
    const id = Number(match[1]);
    for (const key of Object.keys(sample())) {
      if (!key.startsWith("prospects?site_id=")) continue;
      const list = sample()[key].prospects, at = list.findIndex((p) => p.id === id);
      if (at < 0) continue;
      const [gone] = list.splice(at, 1);
      const gap = sampleGaps(gone.site_id).gaps.find((g) => g.domain === gone.domain);
      if (gap) gap.in_consideration = false;
      return { ok: true };
    }
    const err = new Error("That prospect doesn't exist.");
    err.status = 404;
    throw err;
  });

  COMP.sampleWrite("POST backlinks", (match, body) => {
    const domain = window.BacklinkCleaner.rootDomain(body.source_url);
    if (!domain) throw new Error("Not a web address.");
    const status = body.status || "live";
    const report = sampleGaps(body.site_id), at = report.gaps.findIndex((g) => g.domain === domain);
    if (at >= 0 && (status === "live" || status === "found")) { report.gaps.splice(at, 1); report.already_linking += 1; } // lost and planned don't link to me
    const list = sampleProspects(body.site_id), there = list.findIndex((p) => p.domain === domain);
    if (there >= 0 && status !== "lost") list.splice(there, 1);
    return { id: Date.now(), domain, status };
  });

  async function sampleImport(form) {
    const file = form.get("file"), siteId = Number(form.get("site_id")), competitorId = Number(form.get("competitor_id"));
    window.BacklinkCleaner.checkUpload(file.name, file.size);
    const result = window.BacklinkCleaner.cleanCsv(new Uint8Array(await file.arrayBuffer()), new Map(), { needSpam: false, keepSpam: true });
    const report = sampleGaps(siteId);
    let rival = report.competitors.find((c) => c.id === competitorId);
    if (!rival) {
      const known = sample()[`competitors?site_id=${siteId}`]?.competitors.find((c) => c.id === competitorId);
      if (!known) throw new Error("Competitor not found.");
      rival = { id: competitorId, host: known.host, has_data: false };
      report.competitors.push(rival);
    }
    rival.has_data = true;
    // The best row for each domain, as on the server.
    const best = new Map();
    result.rows.forEach((row) => { const now = best.get(row.domain); if (!now || (row.authority ?? -1) > (now.authority ?? -1)) best.set(row.domain, row); });
    const own = sampleOwnDomains(), theirRoot = window.BacklinkCleaner.rootDomain(rival.host) || rival.host;
    best.forEach((row, domain) => {
      if (own.has(domain) || domain === theirRoot) return;
      let gap = report.gaps.find((g) => g.domain === domain);
      if (!gap) {
        gap = { authority: null, authority_label: null, competitor_count: 0, competitors: [], display: domain, domain, first_seen: new Date().toISOString(), in_consideration: false, is_competitor: false, lost_link: false, sample_url: row.url, sources: [], spam_score: null };
        // As on the server: the file's spam score decides when it has one, the name rules only when it doesn't.
        const fromFile = row.spam_score !== null && row.spam_score !== undefined;
        const spam = fromFile ? (window.BacklinkCleaner.isSpamScore(row.spam_score) ? ["spam_score", "File spam score above 30", "file"] : null) : sampleNameReason(domain);
        if (spam) {
          report.filtered = report.filtered || [];
          if (!report.filtered.some((g) => g.domain === domain)) report.filtered.push({ ...gap, quality: "spam", reason: spam[0], reason_words: spam[1], flagged_by: spam[2], authority: row.authority, authority_label: result.authority_label, spam_score: row.spam_score, sample_url: row.url, competitor_count: 1, competitors: [{ id: competitorId, host: rival.host }] });
          return;
        }
        report.gaps.push(gap);
      }
      if (!gap.competitors.some((c) => c.id === competitorId)) gap.competitors.push({ id: competitorId, host: rival.host });
      gap.competitor_count = gap.competitors.length;
      if (row.authority !== null && (gap.authority === null || row.authority > gap.authority)) { gap.authority = row.authority; gap.authority_label = result.authority_label; }
      if (row.spam_score !== null) gap.spam_score = Math.max(gap.spam_score || 0, row.spam_score);
      if (result.source_label && !gap.sources.includes(result.source_label)) gap.sources.push(result.source_label);
    });
    report.gaps.sort((a, b) => b.competitor_count - a.competitor_count || (b.authority ?? -1) - (a.authority ?? -1) || a.domain.localeCompare(b.domain));
    recount(report);
    return { total: result.total, kept: result.kept, removed: result.removed, removed_spam: result.removed_spam, removed_no_url: result.removed_no_url, flagged: [...best.keys()].filter((d) => report.filtered.some((g) => g.domain === d)).length, domains: best.size, source_label: result.source_label, unknown_spam: result.unknown_spam };
  }
  COMP.sampleWrite("POST link-gaps/import", (match, body, opts) => {
    const work = sampleImport(opts.form);
    work.catch(() => {}); // the caller gets this refusal a moment later: it isn't an unhandled one
    return work;
  });

  Object.assign(window.FR, {
    "Link gaps": "Liens manquants",
    "Add a domain": "Ajouter un domaine", "Found in a tool not connected here": "Trouvé dans un outil non connecté ici", "Domain or link": "Domaine ou lien", "Remove domain": "Retirer le domaine", "removed": "retiré", "added": "ajouté",
    "Say which domain.": "Indiquez quel domaine.", "Pick a competitor.": "Choisissez un concurrent.", "That's one of your own websites.": "C'est l'un de vos propres sites.", "That's the competitor itself.": "C'est le concurrent lui-même.",
    "already listed, so it was updated": "déjà dans la liste : mis à jour", "Its name looks like spam, so it's flagged.": "Son nom ressemble à du spam : il est signalé.", "It already links to": "Il pointe déjà vers", "so it's left out there.": "il n'apparaît donc pas pour ce site.",
    "Competitors it links to": "Concurrents vers lesquels il pointe",
    "Edit domain": "Modifier le domaine", "Typed by hand": "Saisi à la main", "From your files": "D'après vos fichiers", "From Common Crawl": "D'après Common Crawl", "No score from a file yet": "Aucun score issu d'un fichier pour l'instant",
    "From a tool not connected here. Uploads never overwrite it.": "Depuis un outil non connecté ici. Les imports ne l'écrasent jamais.",
    "Authority score, 0 to 100": "Score d'autorité, de 0 à 100", "Tool": "Outil", "Edited": "Modifié le", "Back to automatic": "Revenir à l'automatique", "back to automatic": "retour à l'automatique", "saved": "enregistré",
    "A domain needs at least one competitor. To hide it, mark it as spam.": "Un domaine a besoin d'au moins un concurrent. Pour le masquer, marquez-le comme spam.", "Score must be 0 to 100.": "Le score doit être entre 0 et 100.", "Say which tool this score comes from.": "Indiquez de quel outil vient ce score.", "Type the score from that tool too.": "Saisissez aussi le score de cet outil.",
    "Spam is flagged, never removed, and only good ones can be added. From your uploads and domains added by hand: no paid tool, no AI. Adding a domain creates no backlink and leaves the Backlinks top cards alone.": "Le spam est signalé, jamais retiré, et seuls les bons domaines peuvent être ajoutés. D'après vos imports et les domaines ajoutés à la main : aucun outil payant, aucune IA. Ajouter un domaine ne crée pas de backlink et ne touche pas aux cartes du haut de Backlinks.",
    "Flagged as spam": "Signalés comme spam", "Add all good ones": "Ajouter tous les bons", "Spam": "Spam", "Not spam": "Pas du spam", "Kept by you": "Gardé par vous", "not spam: ready to add": "pas du spam : prêt à être ajouté", "Checking for spam": "Recherche de spam en cours", "Checking for spam…": "Recherche de spam en cours…", "Strength": "Force", "Links": "Liens", "Page": "Page", "More for {domain}": "Plus pour {domain}", "Edit and Mark as spam": "Modifier et Marquer comme spam", "Takes it off In consideration": "Le retire de En considération", "marked as spam and taken off In consideration": "marqué comme spam et retiré de En considération", "Domains appear as their home pages are read.": "Les domaines apparaissent à mesure que leurs pages d'accueil sont lues.", "No domains left": "Plus aucun domaine", "All already link to you or are yours.": "Tous pointent déjà vers vous ou sont à vous.", "No address": "Sans adresse", "Next, each home page is read once to flag spam. Nothing is removed; only good ones can be added.": "Ensuite, chaque page d'accueil est lue une fois pour signaler le spam. Rien n'est retiré ; seuls les bons domaines peuvent être ajoutés.",
    "Spam filter": "Filtre anti-spam", "Domains found": "Domaines trouvés", "Filtered out as spam": "Retirés comme spam", "Being checked": "En vérification", "Reading home pages": "Lecture des pages d'accueil", "Good ones": "Bons domaines", "Add all": "Tout ajouter",
    "Common Crawl": "Common Crawl", "Links found": "Liens trouvés", "File uploaded": "Fichier importé", "domain": "domaine", "domains": "domaines", "Upload a CSV": "Importer un CSV",
    "It's free and needs no key. It finds domains only: no page or anchor text. It only sees the part of the web it crawled, so it finds fewer links than a paid tool. It runs on the Mac: about 11 GB passes through, about 7 minutes on your connection, and nothing big is kept.": "C'est gratuit et sans clé. Il ne trouve que des domaines : ni page ni texte d'ancre. Il ne voit que la partie du web qu'il a explorée : il trouve donc moins de liens qu'un outil payant. Il tourne sur le Mac : environ 11 Go transitent, environ 7 minutes avec votre connexion, et rien de lourd n'est conservé.",
    "Top": "Top", "Common Crawl rank": "Classement Common Crawl", "You kept this": "Vous l'avez gardé", "Home page not read": "Page d'accueil non lue", "The site blocked the app; that doesn't make it spam.": "Le site a bloqué l'application ; cela n'en fait pas du spam.", "Mark as spam": "Marquer comme spam", "Why": "Pourquoi", "Keep it": "Le garder", "Undo": "Annuler", "See why each one went. A rule can be wrong.": "Voyez pourquoi chacun a été retiré. Une règle peut se tromper.", "Showing the first": "Affichage des", "of": "sur", "Action": "Action", "Show more": "Afficher plus",
    "No links yet": "Aucun lien pour l'instant", "Upload a CSV of a competitor's links, or add a domain.": "Importez un CSV des liens d'un concurrent, ou ajoutez un domaine.", "Filtering out spam": "Retrait du spam en cours", "The good domains appear here as their home pages are read.": "Les bons domaines apparaissent ici à mesure que leurs pages d'accueil sont lues.", "No good domains left": "Plus aucun bon domaine", "Every domain is filtered out as spam, already links to you, or is one of your own.": "Chaque domaine est retiré comme spam, pointe déjà vers vous, ou vous appartient.",
    "kept. You can add it now.": "gardé. Vous pouvez l'ajouter.", "marked as spam, can't be added": "marqué comme spam, impossible à ajouter", "Spam is filtered next: each domain's home page is read once. Only the good ones can be added.": "Le spam est retiré ensuite : la page d'accueil de chaque domaine est lue une fois. Seuls les bons domaines peuvent être ajoutés.",
    "File spam score above 30": "Score de spam du fichier supérieur à 30", "Flagged by the system": "Signalé par le système", "Spam words in name": "Mots de spam dans le nom", "Free domain ending spammers favour": "Extension gratuite prisée des spammeurs", "Domain ending known for abuse": "Extension connue pour les abus", "Odd name": "Nom inhabituel", "Too far down Common Crawl's ranking": "Trop bas dans le classement Common Crawl", "Link farm: links to thousands of sites": "Ferme de liens : pointe vers des milliers de sites", "Link farm: thousands of subdomains": "Ferme de liens : des milliers de sous-domaines", "No home page": "Pas de page d'accueil", "Site down": "Site hors ligne", "Redirects to another site": "Redirige vers un autre site", "Parked or for sale": "Parqué ou à vendre", "Spam words on home page": "Mots de spam sur la page d'accueil", "Home page mostly outside links": "Page d'accueil surtout faite de liens sortants", "Near-empty home page": "Page d'accueil presque vide", "Home page hidden from search engines": "Page d'accueil cachée aux moteurs de recherche", "Couldn't read home page": "Page d'accueil impossible à lire", "Marked by you": "Marqué par vous", "Filtered out": "Retiré",
    "From files you upload. Nothing here calls a paid tool. Adding a domain doesn't create a backlink, and doesn't change the Backlinks top cards.": "À partir des fichiers que vous importez. Rien ici n'appelle un outil payant. Ajouter un domaine ne crée pas de backlink et ne change pas les cartes en haut de la page Backlinks.",
    "Where the links come from": "D'où viennent les liens",
    "Sources": "Sources", "No links yet for": "Pas encore de liens pour", "Add links": "Ajouter des liens",
    "Has a file": "Fichier importé",
    "No file yet": "Pas encore de fichier",
    "Upload links for this competitor": "Importer les liens de ce concurrent",
    "Upload a competitor's links": "Importer les liens d'un concurrent",
    "Lost link": "Lien perdu",
    
    "Links to": "Pointe vers",
    "Upload links": "Importer des liens", "Anchor text": "Texte d'ancre", "Linking page": "Page qui fait le lien", "1 link": "1 lien", "{n} links": "{n} liens", "links": "liens", "Links from {domain}": "Liens de {domain}",
    "Page authority of the linking page": "Autorité de la page qui fait le lien",
    "No anchor text": "Pas de texte d'ancre",
    "Points to": "Pointe vers",
    "{n} or more": "{n} ou plus",
    
    "{shown} of {total}, strongest first": "{shown} sur {total}, les plus forts d'abord",
    "No link details in the file.": "Pas de détail des liens dans le fichier.",
    "How many": "Combien",
    "Example link": "Exemple de lien",
    "Status": "Statut",
    "unknown": "inconnu", "No authority score yet.": "Pas encore de score d'autorité.", "No spam score yet.": "Pas encore de score de spam.",
    "Spam score": "Score de spam",
    "Authority": "Autorité",
    "Domain": "Domaine",
    "to In consideration": "à l'étude",
    "Add to": "Ajouter à", "In consideration": "À l'étude", "To do": "À faire", "Create task": "Créer une tâche",
    "Add to To do": "Ajouter à À faire", "Mediator": "Intermédiaire", "Link type": "Type de lien", "Choose a mediator.": "Choisissez un intermédiaire.",
    "Straight to Backlinks → To do, skipping In consideration. Add each article's Google Docs link there.": "Directement dans Backlinks → À faire, sans passer par À l'étude. Ajoutez-y le lien Google Docs de chaque article.",
    "Added to In consideration, not To do": "Ajoutés à À l'étude, pas à À faire",
    "domain added to To do": "domaine ajouté à À faire", "domains added to To do": "domaines ajoutés à À faire",
    "is already in Backlinks: kept in In consideration": "est déjà dans Backlinks : gardé dans À l'étude",
    "are already in Backlinks: kept in In consideration": "sont déjà dans Backlinks : gardés dans À l'étude",
    "domain marked as spam": "domaine marqué comme spam", "domains marked as spam": "domaines marqués comme spam",
    "Get a link from": "Obtenir un lien de", "In To do": "Dans À faire",
    "Add a competitor first.": "Ajoutez d'abord un concurrent.",
    "No files yet": "Aucun fichier pour l'instant",
    "Upload a CSV of links to one of your competitors, and the domains that don't link to you appear here.": "Importez un CSV des liens vers un de vos concurrents : les domaines qui ne pointent pas vers vous apparaîtront ici.",
    "No gaps in your files": "Aucun lien manquant dans vos fichiers",
    "Every domain in your files already links to you, or is one of your own.": "Tous les domaines de vos fichiers pointent déjà vers vous, ou sont les vôtres.",
    "Hide added ones": "Masquer les ajoutés", "Followed links only": "Liens suivis seulement",
    "This file doesn't say which links are followed": "Ce fichier ne dit pas quels liens sont suivis",
    "{n} not known: their file doesn't say": "{n} inconnus : leur fichier ne le dit pas",
    "Include old links": "Inclure les anciens liens", "Old links": "Anciens liens", "Old links, left out": "Anciens liens, écartés", "Old links, included": "Anciens liens, inclus",
    "Old link (last seen {day})": "Ancien lien (vu le {day})",
    "Domains whose links were last seen more than 6 months before their file. Probably gone.": "Domaines dont les liens ont été vus pour la dernière fois plus de 6 mois avant leur fichier. Sans doute disparus.",
    "1 domain whose links were last seen more than 6 months before its file is left out.": "1 domaine dont les liens ont été vus plus de 6 mois avant son fichier est écarté.",
    "{n} domains whose links were last seen more than 6 months before their file are left out.": "{n} domaines dont les liens ont été vus plus de 6 mois avant leur fichier sont écartés.",
    "App flagged": "Signalés par l'appli",
    "The file's spam score keeps them, but the app's own check flagged them. Each row says what it saw.": "Le score de spam du fichier les garde, mais le contrôle de l'appli les a signalés. Chaque ligne dit ce qu'il a vu.",
    "The app saw: {what}": "L'appli a vu : {what}", "The app saw: {what} on {day}": "L'appli a vu : {what} le {day}", "redirects to {site}": "redirige vers {site}",
    "Checked on {day}. The file's spam score keeps it in Good ones.": "Contrôlé le {day}. Le score de spam du fichier le garde parmi les bons.",
    "Redirects to {site}": "Redirige vers {site}", "file score {score} overruled": "score du fichier ({score}) écarté", "Checked on {day}.": "Contrôlé le {day}.",
    "A redirect, a parked domain or no home page beats the file's spam score. Not spam puts it back in Good ones.": "Une redirection, un domaine parqué ou l'absence de page d'accueil passe avant le score de spam du fichier. Pas du spam le remet parmi les bons.",
    "Overrides the app's check: back to Good ones.": "Passe avant le contrôle de l'appli : retour parmi les bons.",
    "Leaves out domains whose file says every link is nofollow, sponsored or ugc. Lost links in a file are never listed.": "Écarte les domaines dont le fichier indique que tous les liens sont nofollow, sponsored ou ugc. Les liens perdus d'un fichier ne sont jamais listés.",
    "1 domain with only nofollow, sponsored or ugc links is hidden.": "1 domaine qui n'a que des liens nofollow, sponsored ou ugc est masqué.",
    "{n} domains with only nofollow, sponsored or ugc links are hidden.": "{n} domaines qui n'ont que des liens nofollow, sponsored ou ugc sont masqués.",
    "Show them": "Les afficher",
    "Strength: {tool} scores are compared first; other tools' scores come after, on their own scale.": "Force : les scores {tool} sont comparés d'abord ; ceux des autres outils viennent après, sur leur propre échelle.",
    "Sites linking to your competitors, not to you": "Sites qui font un lien vers vos concurrents, pas vers vous",
    "Why they're flagged": "Pourquoi ils sont signalés",
    "Search domains": "Chercher un domaine", "Competitor": "Concurrent", "All competitors": "Tous les concurrents",
    "Any number": "Un ou plusieurs", "Only 1": "Un seul", "domains": "domaines",
    "Select all shown": "Tout sélectionner à l'écran",
    "Nothing matches these filters": "Rien ne correspond à ces filtres",
    "Change the filters to see more.": "Modifiez les filtres pour en voir plus.",
    "1 domain already links to you, so it's left out.": "1 domaine pointe déjà vers vous : il est laissé de côté.",
    "domains already link to you, so they're left out.": "domaines pointent déjà vers vous : ils sont laissés de côté.",
    "domain added to In consideration": "domaine ajouté à l'étude",
    "domains added to In consideration": "domaines ajoutés à l'étude",
    "skipped": "ignorés",
    "Couldn't bring it back": "Impossible de le rétablir", "saved": "enregistrés", "The rest wasn't saved. Add them again.": "Le reste n'a pas été enregistré. Ajoutez-les de nouveau.", "Nothing new": "Rien de nouveau", "Nothing was saved.": "Rien n'a été enregistré.", "Rating": "Note", "Status and owner": "Statut et responsable", "Website": "Site", "Filter the list": "Filtrer la liste", "Any": "Tous", "Not rated": "Sans note", "DA at least": "DA minimum", "PA at least": "PA minimum", "Spam at most": "Spam maximum", "More filters": "Plus de filtres", "Clear filters": "Effacer les filtres", "No owner": "Sans responsable", "File": "Fichier", "of": "sur", "No links match these filters": "Aucun lien ne correspond à ces filtres", "Change or clear them to see more.": "Modifiez-les ou effacez-les pour en voir plus.", "For added links": "Pour les liens ajoutés", "Domain authority: the site's score in the file, from any tool.": "Autorité du domaine : le score du site dans le fichier, quel que soit l'outil.", "Page authority: this page's score from the file.": "Autorité de la page : le score de cette page dans le fichier.", "Competitor of which site?": "Concurrent de quel site ?", "Add your own website first, then its competitors.": "Ajoutez d'abord votre site, puis ses concurrents.", "That website isn't saved yet.": "Ce site n'est pas encore enregistré.", "Type the website's address.": "Saisissez l'adresse du site.", "added as a competitor of": "ajouté comme concurrent de", "skipped (one link per domain, no spam)": "ignorés (un lien par domaine, pas de spam)",
    "See them": "Les voir",
    "A CSV of this competitor's links from a free SEMrush or Ubersuggest account, with a URL or domain column.": "Un CSV des liens de ce concurrent, depuis un compte gratuit SEMrush ou Ubersuggest, avec une colonne URL ou domaine.",
    "File": "Fichier",
    "Upload": "Importer",
    "Uploading…": "Import en cours…",
    "Rows": "Lignes",
    "Domains": "Domaines",
    "Upload another": "Importer un autre",
    "Pick a domain.": "Choisissez un domaine.",
    "Empty file.": "Fichier vide.",
    "Only headers, no data rows.": "Seulement des en-têtes, aucune ligne de données.",
    "Choose a CSV file.": "Choisissez un fichier CSV.",
  });
})();
