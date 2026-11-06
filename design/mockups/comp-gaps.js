/* Competitors area: Link gaps. Domains that link to my competitors but not to me, from files the owner uploads.
   Nothing here calls a paid tool. Adding a domain makes a prospect on the Backlinks page: it isn't a backlink and never touches the top cards. */
(() => {
  "use strict";
  let UI = null;
  const S = { site: null, data: null, filter: "", hide: false, quality: "all", limit: 200, picked: new Set(), adding: false };
  let sync = Promise.resolve(); // calls caused by the Backlinks page, kept in the order they happened

  const t = (s) => UI.t(s);
  const esc = (v) => UI.esc(v);
  const onScreen = () => UI.state.route === "competitors" && COMP.tab === "gaps";

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

  async function loadExistingProspects() {
    const answer = await COMP.api("GET", "links/sites");
    await Promise.all(answer.sites.map(async (site) => {
      try { absorb((await COMP.api("GET", `prospects?site_id=${site.id}`)).prospects, site.host); } catch { /* a site that can't answer keeps what's on screen */ }
    }));
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

  function seeThem(host) {
    const own = window.SITES.find((s) => s.host === host);
    if (UI.state.site !== "all" && UI.state.site !== own?.id) UI.state.site = own?.id || "all";
    UI.state.blSection = "consideration";
    UI.go("backlinks");
  }

  // ---- what's on screen -------------------------------------------------------------------------
  /* Spam is flagged, never removed: every domain stays in one list, the good ones first. Only the good ones can be added. */
  const allRows = () => [...(S.data?.gaps || []), ...(S.data?.filtered || [])];
  const isFlagged = (gap) => gap.quality === "spam";
  const byRival = () => allRows().filter((g) => (!S.filter || g.competitors.some((c) => String(c.id) === S.filter)) && !(S.hide && inConsideration(g)));
  const shownGaps = () => byRival().filter((g) => S.quality === "all" || (S.quality === "spam") === isFlagged(g));
  const canPick = (gap) => !isFlagged(gap) && !inConsideration(gap);
  const pickable = () => shownGaps().slice(0, S.limit).filter(canPick); // only rows on screen: "Select all shown" means shown

  const intro = () => `<p class="note">${UI.icon("info")}<span>${t("Spam is flagged first, and only the good ones can be added. Nothing is removed. It comes from Common Crawl and files you upload: no paid tool, no AI. Adding a domain doesn't create a backlink, and doesn't change the Backlinks top cards.")}</span></p>`;

  /* The name Common Crawl gives a release spells out its months. */
  function releaseName(id) {
    const found = String(id || "").match(/^cc-main-(\d{4})-([a-z-]+)$/);
    if (!found) return id || "";
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const names = found[2].split("-").filter((m) => m in months).map((m) => new Intl.DateTimeFormat(UI.locale(), { month: "short" }).format(new Date(2026, months[m], 1)));
    return names.length ? `${names.join(", ")} ${found[1]}` : id;
  }

  /* One line, so the table is what you see first. Everything the tiles used to offer is still here. */
  function summaryLine(d) {
    const f = d.funnel;
    const stat = (n, label) => `<span class="cg-stat"><b class="tabular">${UI.num(n)}</b> ${t(label)}</span>`;
    const stats = f && f.found ? `${stat(f.found, "Domains found")}${stat(f.filtered, "Flagged as spam")}${stat(f.good, "Good ones")}` : "";
    const goodSent = allRows().filter((g) => !isFlagged(g)).length;
    const capped = f && f.good > goodSent ? `<span class="cg-stat sec">${esc(t("The {sent} with the most competitors are listed, of {total}.").replace("{sent}", UI.num(goodSent)).replace("{total}", UI.num(f.good)))}</span>` : "";
    const checking = f?.checking ? `<span class="cg-stat sec">${UI.icon("refresh-cw", "spin")}<b class="tabular">${UI.num(f.checking)}</b> ${t("Still being checked")}</span>` : "";
    // A competitor with nothing yet can only be fed from Sources, so say so here while Sources is folded away.
    const empty = d.competitors.some((c) => c.has_data) ? d.competitors.filter((c) => !c.has_data) : [];
    const names = empty.slice(0, 2).map((c) => `<span class="mono" dir="auto">${esc(c.host)}</span>`).join(", ");
    const missing = empty.length ? `<span class="cg-stat">${t("No links yet for")} ${names}${empty.length > 2 ? ` ${t("and")} ${UI.num(empty.length - 2)} ${t("more")}` : ""} <button class="link-btn" data-cg-show-sources>${t("Add links")}</button></span>` : "";
    const open = allRows().filter(canPick).length;
    const addAll = open ? `<button class="btn btn-main btn-small cg-add-all" id="cg-add-all" data-cg-add-all>${UI.icon("plus")}${t("Add all good ones")} (${UI.num(open)})</button>` : "";
    if (!stats && !checking && !missing && !addAll) return "";
    return `<div class="cg-summary" aria-label="${t("Spam filter")}" role="group">${stats}${capped}${checking}${missing}${addAll}</div>`;
  }

  /* How the list is fed. Folded once there's a list, and open while there's nothing else on the page to do. */
  function sourcesFold(d) {
    const open = S.sourcesOpen ?? !allRows().length;
    return `<details class="fold cg-sources-fold" id="cg-sources-fold" ${open ? "open" : ""}><summary>${UI.icon("chevron-right")}${t("Sources")}</summary>
      ${intro()}${sourcesStrip(d)}
    </details>`;
  }

  function sourcesStrip(d) {
    const line = (c) => [
      c.common_crawl ? `${t("Common Crawl")} ${esc(releaseName(c.common_crawl))}: ${UI.num(c.common_crawl_domains || 0)} ${t(c.common_crawl_domains === 1 ? "domain" : "domains")}` : t("Common Crawl not run yet"),
      c.has_file ? t("A file uploaded") : "",
    ].filter(Boolean).join(" · ");
    return `<section class="card" aria-label="${t("Where the links come from")}">
      <div class="card-head"><h2>${t("Where the links come from")}</h2></div>
      <ul class="rows cg-sources">${d.competitors.map((c) => `<li>
        <div class="what"><div class="t mono" dir="auto">${esc(c.host)}</div><div class="d">${line(c)}</div></div>
        <div class="acts"><button class="btn btn-small" id="cg-up-${c.id}" data-cg-upload="${c.id}">${UI.icon("list-plus")}${t("Upload links for this competitor")}</button></div>
      </li>`).join("")}</ul>
      <details class="fold cg-how"><summary>${UI.icon("chevron-right")}${t("How Common Crawl runs")}</summary>
        <p class="small sec">${t("It's free and needs no key. It finds domains only: no page or anchor text. It only sees the part of the web it crawled, so it finds fewer links than a paid tool. It runs on the Mac: about 11 GB passes through, about 7 minutes on your connection, and nothing big is kept.")}</p>
        <p class="small mono" dir="ltr">.venv/bin/python scripts/common_crawl_links.py</p>
      </details>
    </section>`;
  }

  const authorityCell = (gap) => {
    // One line per row: the value and whose scale it is. The full name stays on the tag.
    const label = gap.authority_label || "";
    if (gap.authority !== null && gap.authority !== undefined) return `<span class="cg-auth"><span class="tabular">${UI.num(gap.authority)}</span>${label ? `<span class="tag" data-tip="${esc(label)}" tabindex="0">${esc(label.match(/\(([^)]+)\)/)?.[1] || label)}</span>` : ""}${gap.authority_by_hand ? `<span class="cg-by-hand" data-tip="${t("Typed by hand")}" tabindex="0" role="img" aria-label="${t("Typed by hand")}">${UI.icon("pencil")}</span>` : ""}</span>`;
    // Common Crawl's rank is a different scale, so it's never shown as if it were a score.
    if (gap.top_percent) return `<span class="cg-auth"><span class="tabular">${t("Top")} ${UI.dec(gap.top_percent)}%</span><span class="tag" data-tip="${t("Common Crawl rank")}" tabindex="0">Common Crawl</span></span>`;
    return `<span class="muted">${t("unknown")}</span>`; // one word for one thing, as in the spam column
  };
  const spamCell = (gap) => (gap.spam_score === null || gap.spam_score === undefined ? `<span class="muted">${t("unknown")}</span>` : `<span class="tabular">${UI.dec(gap.spam_score)}</span>`);

  function rowHtml(gap) {
    const flagged = isFlagged(gap), considered = inConsideration(gap), picked = S.picked.has(gap.domain);
    const tags = [
      flagged ? `<span class="tag cg-flag">${UI.icon("ban")}${t("Spam")}</span>` : "",
      gap.lost_link ? `<span class="tag cg-lost">${UI.icon("link-2-off")}${t("You lost this link")}</span>` : "",
      considered ? `<span class="tag cp-yours">${t("In consideration")}</span>` : "",
      gap.is_competitor ? `<span class="tag">${t("One of your competitors")}</span>` : "",
      gap.kept ? `<span class="tag">${t("You said it isn't spam")}</span>` : "",
      gap.page_note === "unread" ? `<span class="tag" data-tip="${t("The site turned the app away, so its home page wasn't checked. That doesn't make it spam.")}">${t("Home page not read")}</span>` : "",
    ].filter(Boolean).join(" ");
    const why = flagged ? `<span class="second cg-why">${esc(t(gap.reason_words || "Flagged as spam"))}</span>` : "";
    const word = gap.reason === "my_choice" ? "Undo" : "Not spam";
    const action = flagged
      ? `<button class="btn btn-small" data-cg-decide="${gap.reason === "my_choice" ? "auto" : "keep"}" data-domain="${esc(gap.domain)}" aria-label="${t(word)}: ${esc(gap.display || gap.domain)}">${t(word)}</button>`
      : `<button class="icon-btn cg-spam-btn" data-cg-decide="spam" data-domain="${esc(gap.domain)}" aria-label="${t("Mark as spam")}: ${esc(gap.display || gap.domain)}" data-tip="${t("Mark as spam")}">${UI.icon("ban")}<span class="cg-spam-word">${t("Mark as spam")}</span></button>`;
    return `<tr data-cg-row="${esc(gap.domain)}" class="${picked ? "sel" : ""} ${considered || flagged ? "cg-off" : ""} ${flagged ? "cg-flagged" : ""}">
      <td class="chk-cell"><input type="checkbox" class="chk" data-cg-pick="${esc(gap.domain)}" aria-label="${esc(gap.display || gap.domain)}" ${picked ? "checked" : ""} ${considered || flagged ? "disabled" : ""}></td>
      <td class="head-cell"><span class="with-logo">${UI.siteLogo(gap.domain)}<span class="logo-text"><span class="kw mono" dir="auto">${esc(gap.display || gap.domain)}</span>${gap.title ? `<span class="second cg-title" dir="auto">${esc(gap.title)}</span>` : ""}</span></span></td>
      <td data-label="${t("Links to")}"><span class="cp-tags cg-rivals">${gap.competitors.map((c) => `<span class="tag" dir="auto">${esc(c.host)}</span>`).join(" ")}</span></td>
      <td class="r" data-label="${t("How many")}">${UI.num(gap.competitor_count)}</td>
      <td class="c" data-label="${t("Authority")}">${authorityCell(gap)}</td>
      <td class="r" data-label="${t("Spam score")}">${spamCell(gap)}</td>
      <td class="cg-example" data-label="${t("Example link")}">${gap.sample_url ? COMP.link(gap.sample_url) : `<span class="muted">—</span>`}</td>
      <td data-label="${t("Status")}">${tags ? `<span class="cp-tags">${tags}</span>` : `<span class="muted">—</span>`}${why}</td>
      <td class="r nowrap" data-label=""><button class="icon-btn" data-cg-edit="${esc(gap.domain)}" aria-label="${t("Edit")}: ${esc(gap.display || gap.domain)}" data-tip="${t("Edit")}">${UI.icon("pencil")}</button> ${action}</td>
    </tr>`;
  }

  function selectionBar() {
    const n = S.picked.size;
    if (!n) return "";
    return `<div class="selbar" role="region" aria-label="${t("selected")}">
      <b id="cg-sel-count">${UI.num(n)} ${t("selected")}</b>
      <button class="btn btn-main btn-small" id="cg-add" data-cg-add ${S.adding ? "disabled" : ""}>${UI.icon("plus")}<span id="cg-add-words">${t("Add")} ${UI.num(n)} ${t("to In consideration")}</span></button>
      <button class="icon-btn" data-cg-clear aria-label="${t("Clear selection")}" data-tip="${t("Clear selection")}">${UI.icon("x")}</button>
    </div>`;
  }

  function body() {
    const d = S.data;
    if (!d) return COMP.loading();
    if (!d.competitors.length) {
      return COMP.empty(t("No competitors yet"), t("Link gaps show who links to your competitors but not to you. Add a competitor first."), `<button class="btn btn-main" data-cg-find>${UI.icon("search")}${t("Find competitors")}</button>`);
    }
    const strip = `${summaryLine(d)}${sourcesFold(d)}`;
    const left = d.already_linking ? `<p class="help cg-left">${esc(leftOutWords(d.already_linking))}</p>` : "";
    if (!d.competitors.some((c) => c.has_data)) {
      return `${strip}${COMP.empty(t("No links yet"), t("Run Common Crawl, or upload a CSV of links to one of your competitors. The domains that don't link to you appear here, with spam flagged."), `<button class="btn" data-cg-add-domain>${UI.icon("plus")}${t("Add a domain")}</button>`)}`;
    }
    if (!allRows().length) {
      const checking = d.funnel?.checking;
      return `${strip}${checking ? COMP.empty(t("Checking for spam"), t("Domains appear here as their home pages are read.")) : COMP.empty(t("No domains left"), t("Every domain already links to you, or is one of your own."))}${left}`;
    }
    const shown = shownGaps(), open = pickable();
    const all = open.length > 0 && open.every((g) => S.picked.has(g.domain));
    const some = open.some((g) => S.picked.has(g.domain));
    return `${strip}
      <div class="cp-tools cg-tools">
        <label class="field"><span>${t("Links to")}</span><select class="select" id="cg-filter">
          <option value="">${t("All competitors")}</option>
          ${d.competitors.filter((c) => c.has_data).map((c) => `<option value="${c.id}" ${String(c.id) === S.filter ? "selected" : ""}>${esc(c.host)}</option>`).join("")}
        </select></label>
        <div class="chips cp-chips" role="group" aria-label="${t("Flagged as spam")}">
          ${[["all", "All", byRival().length], ["good", "Good ones", byRival().filter((g) => !isFlagged(g)).length], ["spam", "Flagged as spam", byRival().filter(isFlagged).length]].map(([id, word, n]) => `<button class="chip" data-cg-quality="${id}" aria-pressed="${S.quality === id}">${t(word)}<b>${UI.num(n)}</b></button>`).join("")}
        </div>
        <label class="opt"><input type="checkbox" class="chk" id="cg-hide" style="margin:0" ${S.hide ? "checked" : ""}>${t("Hide those already in consideration")}</label>
        <span class="cg-picktools">
          <button class="btn btn-small" data-cg-add-domain>${UI.icon("plus")}${t("Add a domain")}</button>
          <button class="link-btn" id="cg-select-all" data-cg-select-all ${open.length ? "" : "disabled"}>${t("Select all shown")} (${UI.num(open.length)})</button>
        </span>
      </div>
      ${shown.length ? `<div class="table-wrap"><table class="data" id="cg-table">
        <thead><tr>
          <th scope="col" class="chk-cell"><input type="checkbox" class="chk" id="cg-all" style="margin:0" aria-label="${t("Select all shown")}" ${all ? "checked" : ""} ${open.length ? "" : "disabled"} data-indeterminate="${!all && some}"></th>
          <th scope="col">${t("Domain")}</th><th scope="col">${t("Links to")}</th><th scope="col" class="r">${t("How many")}</th><th scope="col" class="c">${t("Authority")}</th><th scope="col" class="r">${t("Spam score")}</th><th scope="col">${t("Example link")}</th><th scope="col">${t("Status")}</th><th scope="col"><span class="sr">${t("Action")}</span></th>
        </tr></thead>
        <tbody>${shown.slice(0, S.limit).map(rowHtml).join("")}</tbody>
      </table>
      ${shown.length > S.limit ? `<div class="cp-same-toggle"><button class="link-btn" data-cg-more>${t("Show more")} (${UI.num(shown.length - S.limit)})</button></div>` : ""}
      </div>` : COMP.empty(t("Nothing to show with these filters"), t("Change the filters above to see more domains."))}
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
    const count = UI.$("#cg-sel-count"), words = UI.$("#cg-add-words"), add = UI.$("#cg-add");
    if (!S.picked.size || !count || !words || !add) { UI.setHTML(bar, selectionBar()); return; }
    count.textContent = `${UI.num(S.picked.size)} ${t("selected")}`;
    words.textContent = `${t("Add")} ${UI.num(S.picked.size)} ${t("to In consideration")}`;
    add.disabled = !!S.adding;
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
    UI.$("#cg-select-all")?.focus({ preventScroll: true });
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
    if (gap.auto_authority !== null && gap.auto_authority !== undefined) return `${t("From your files")}: ${UI.num(gap.auto_authority)}${gap.auto_authority_label ? ` · ${esc(gap.auto_authority_label.match(/\(([^)]+)\)/)?.[1] || gap.auto_authority_label)}` : ""}`;
    if (gap.top_percent) return `${t("From Common Crawl")}: ${t("Top")} ${UI.dec(gap.top_percent)}%`;
    return t("No score from a file yet");
  };
  COMP.editGap = (gap, rivals, opener, refresh) => {
    editing = { gap, rivals, refresh };
    const typed = gap?.edit || {}, name = gap ? gap.display || gap.domain : "", ticked = new Set(gap ? rivalsOf(gap).map((r) => r.id) : rivals.length === 1 ? [rivals[0].id] : []);
    const shownRivals = gap ? [...rivals, ...rivalsOf(gap).filter((r) => !rivals.some((x) => x.id === r.id))] : rivals;
    const head = gap ? UI.panelHead(t("Edit this domain"), `<span class="mono" dir="auto">${esc(name)}</span>`, UI.siteLogo(gap.domain, 34)) : UI.panelHead(t("Add a domain"), t("One you found in a tool that isn't connected here."));
    UI.openPanel(`${head}
      <div class="panel-body"><form id="cg-edit-form" novalidate>
        ${gap ? `<p class="small sec cg-edit-intro">${t("Type what you read in a tool that isn't connected here. Later uploads never change it.")}</p>` : ""}
        <div id="cg-edit-error"></div>
        ${gap ? "" : `<label class="field"><span>${t("Domain or link")} <span class="req">*</span></span><input class="input mono" id="cg-edit-domain" placeholder="example.com" maxlength="2048" autocomplete="off" dir="auto" data-autofocus></label>`}
        <div class="field-row">
          <label class="field"><span>${t("Authority score, 0 to 100")}</span><input class="input tabular" type="number" id="cg-edit-score" min="0" max="100" step="1" value="${typed.authority ?? ""}" ${gap ? "data-autofocus" : ""}></label>
          <label class="field"><span>${t("Which tool")}</span><input class="input" id="cg-edit-tool" value="${esc(typed.authority_label || "")}" list="cg-edit-tools" maxlength="120" autocomplete="off"><datalist id="cg-edit-tools">${TOOL_NAMES.map((tool) => `<option value="${esc(tool)}"></option>`).join("")}</datalist></label>
        </div>
        ${gap ? `<p class="help cg-edit-auto">${autoWords(gap)}</p>` : ""}
        <fieldset class="cg-edit-rivals"><legend>${t("Links to")}</legend>
          ${shownRivals.map((r) => `<label class="opt"><input type="checkbox" class="chk" data-cg-edit-rival="${r.id}" style="margin:0" ${ticked.has(r.id) ? "checked" : ""}><span class="mono small" dir="auto">${esc(r.host)}</span></label>`).join("")}
        </fieldset>
        <label class="field"><span>${t("Example link")}</span><input class="input mono" type="url" id="cg-edit-url" value="${esc(typed.sample_url || "")}" placeholder="${esc(gap ? gap.sample_url || `https://${gap.domain}/` : "https://example.com/page")}" maxlength="2048" autocomplete="off" dir="auto"></label>
        ${typed.at ? `<p class="help">${t("Last edited")} ${esc(UI.fmtDateOnly(typed.at))}${typed.by ? ` · <span dir="auto">${esc(typed.by)}</span>` : ""}</p>` : ""}
      </form></div>
      <div class="panel-foot"><button class="btn btn-main" id="cg-edit-save">${t(gap ? "Save" : "Add")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button>${gap?.edit ? `<button class="btn btn-ghost ${gap.edit.hand_only ? "danger" : ""}" id="cg-edit-reset">${t(gap.edit.hand_only ? "Remove this domain" : "Back to automatic data")}</button>` : ""}</div>`,
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
    if (!chosen.length) { editError(gap ? "A domain needs at least one competitor. To hide it, mark it as spam." : "Tick at least one competitor this domain links to."); return; }
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
    const words = [`${answer.domain}: ${t(answer.existing ? "already on the list, so this was added to it" : "added")}.`];
    if (answer.flagged) words.push(t("Its name looks like spam, so it's with the flagged ones."));
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
    UI.toast(`${gap.display || gap.domain}: ${t(was.hand_only ? "removed" : "back to automatic data")}`, { undo: async () => {
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

  // ---- a person's decision beats the filter -----------------------------------------------------
  const deciding = new Set();
  async function decide(domain, decision) {
    if (deciding.has(domain)) return; // a double click decides once
    deciding.add(domain);
    try {
      await COMP.api("POST", "link-gaps/decide", { site_id: COMP.siteId, domain, decision });
    } catch (err) { COMP.fail(err); return; } finally { deciding.delete(domain); }
    S.picked.delete(domain);
    await COMP.reload({ quiet: true });
    if (decision === "auto") return;
    UI.toast(decision === "keep" ? `${domain}: ${t("not spam. You can add it now.")}` : `${domain}: ${t("marked as spam. It can't be added.")}`, { kind: "info", undo: async () => {
      await COMP.api("POST", "link-gaps/decide", { site_id: COMP.siteId, domain, decision: "auto" }).catch(COMP.fail);
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
  const dialogHead = () => `<div class="dlg-head"><h2 id="dlg-title">${t("Upload links for a competitor")}</h2><button class="icon-btn" data-close-dlg aria-label="${t("Close")}">${UI.icon("x")}</button></div>`;

  function uploadForm(competitorId, error = null) {
    const d = S.data;
    return `${dialogHead()}
      <div class="dlg-body">
        <p class="small sec" style="margin-bottom:12px">${t("A CSV of links to this competitor, exported from a free SEMrush or Ubersuggest account. Needs a URL or domain column.")}</p>
        <label class="field"><span>${t("Competitor")}</span><select class="select" id="cg-up-who" style="width:100%">${d.competitors.map((c) => `<option value="${c.id}" ${c.id === competitorId ? "selected" : ""}>${esc(c.host)}</option>`).join("")}</select></label>
        <label class="field"><span>${t("File")}</span><input class="input" id="cg-up-file" type="file" accept=".csv,.tsv,.txt,text/csv"></label>
        <div id="cg-up-error">${error ? errorBox(error) : ""}</div>
      </div>
      <div class="dlg-foot"><button class="btn" data-close-dlg>${t("Cancel")}</button><button class="btn btn-main" id="cg-up-send" data-cg-send disabled>${UI.icon("list-plus")}${t("Upload")}</button></div>`;
  }
  const errorBox = (message) => `<div class="error cg-error" role="alert">${UI.icon("octagon-alert")}<span dir="auto">${esc(serverWords(message))}</span></div>`;

  function openUpload(competitorId, opener) {
    const dlg = UI.$("#dlg");
    uploadOpener = opener?.id || null;
    S.sourcesOpen = true; // focus comes back to this button, so Sources has to still be open after the reload
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
        <div class="clean-sum">${stat("Rows in the file", answer.total)}${stat("Domains", answer.domains)}${stat("Flagged as spam", answer.flagged ?? answer.removed_spam ?? 0)}${stat("Rows with no address", answer.removed_no_url ?? 0)}</div>
        <p class="note" style="margin:12px 0 0">${UI.icon("info")}<span>${t("Each domain's home page is read once next, and spam gets flagged. Nothing is removed, and only the good ones can be added.")}</span></p>
      </div>
      <div class="dlg-foot"><button class="btn btn-ghost" data-cg-another="${competitorId}" style="margin-right:auto">${t("Upload another file")}</button><button class="btn btn-main" id="cg-up-done" data-close-dlg>${t("Done")}</button></div>`);
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
    document.addEventListener("click", (e) => {
      const hit = (sel) => e.target.closest?.(sel);
      let el;
      if (hit("[data-cg-find]")) { COMP.open("find"); return; }
      if (hit("[data-cg-show-sources]")) {
        const fold = UI.$("#cg-sources-fold");
        if (fold) { S.sourcesOpen = true; fold.open = true; fold.querySelector("summary")?.focus({ preventScroll: true }); fold.scrollIntoView({ block: "nearest" }); }
        return;
      }
      // Only a person's click counts: the browser also fires "toggle" when a fold is drawn already open.
      if ((el = hit("#cg-sources-fold > summary"))) { S.sourcesOpen = !el.parentElement.open; return; }
      if ((el = hit("[data-cg-upload]"))) { openUpload(Number(el.dataset.cgUpload), el); return; }
      if (hit("[data-cg-send]")) { sendUpload(hit("[data-cg-send]")); return; }
      if ((el = hit("[data-cg-another]"))) {
        UI.setHTML(UI.$("#dlg"), uploadForm(Number(el.dataset.cgAnother)));
        UI.$("#cg-up-file")?.focus();
        return;
      }
      if (hit("[data-cg-add]")) { addPicked(); return; }
      if (hit("[data-cg-add-all]")) { allRows().filter(canPick).forEach((g) => S.picked.add(g.domain)); addPicked(); return; }
      if ((el = hit("[data-cg-decide]"))) { decide(el.dataset.domain, el.dataset.cgDecide); return; }
      if ((el = hit("[data-cg-edit]"))) {
        const gap = allRows().find((row) => row.domain === el.dataset.cgEdit);
        if (gap) COMP.editGap(gap, S.data.competitors.map((c) => ({ id: c.id, host: c.host })), el, reloadHere);
        return;
      }
      if ((el = hit("[data-cg-add-domain]"))) { COMP.editGap(null, S.data.competitors.map((c) => ({ id: c.id, host: c.host })), el, reloadHere); return; }
      if (hit("#cg-edit-save")) { saveEdit(hit("#cg-edit-save")); return; }
      if (hit("#cg-edit-reset")) { resetEdit(hit("#cg-edit-reset")); return; }
      if (hit("[data-cg-more]")) { S.limit += 200; COMP.paint(); return; }
      if ((el = hit("[data-cg-quality]"))) { S.quality = el.dataset.cgQuality; S.limit = 200; trimPicked(); COMP.paint(); UI.$(`[data-cg-quality="${S.quality}"]`)?.focus(); return; }
      if (hit("[data-cg-clear]")) { S.picked.clear(); updateSelection(); UI.$("#cg-select-all")?.focus({ preventScroll: true }); return; }
      if (hit("[data-cg-select-all]")) { pickable().forEach((g) => S.picked.add(g.domain)); updateSelection(); return; }
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
      if (id === "cg-filter") { S.filter = e.target.value; trimPicked(); COMP.paint(); UI.$("#cg-filter")?.focus(); return; }
      if (id === "cg-hide") { S.hide = e.target.checked; trimPicked(); COMP.paint(); UI.$("#cg-hide")?.focus(); return; }
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
      COMP.isServer().then((server) => { if (server) return loadExistingProspects(); return null; }).catch(() => {});
    },
    async load() {
      const siteId = COMP.siteId;
      if (S.site !== siteId) { S.site = siteId; S.filter = ""; S.hide = false; S.quality = "all"; S.limit = 200; S.picked.clear(); S.sourcesOpen = undefined; }
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
    if (/casino|poker|betting|porn|xxx|viagra|cialis|escort|backlink|linkfarm/.test(domain)) return ["name_words", "Spam words in its name"];
    const tld = domain.split(".").pop();
    if (["tk", "ml", "ga", "cf", "gq"].includes(tld)) return ["free_tld", "A free domain ending that spammers favour"];
    if (["top", "click", "loan", "work", "bid", "win", "icu", "buzz"].includes(tld)) return ["abused_tld", "A domain ending known for abuse"];
    return null;
  };
  COMP.sampleWrite("POST link-gaps/decide", (match, body) => {
    const report = sampleGaps(body.site_id);
    report.filtered = report.filtered || [];
    const inGood = report.gaps.findIndex((g) => g.domain === body.domain), inSpam = report.filtered.findIndex((g) => g.domain === body.domain);
    if (body.decision === "keep" && inSpam >= 0) {
      const [row] = report.filtered.splice(inSpam, 1);
      row.quality = "good"; row.kept = true; row.was = { reason: row.reason, words: row.reason_words }; row.reason = null; row.reason_words = null;
      report.gaps.unshift(row);
    } else if (body.decision === "spam" && inGood >= 0) {
      const [row] = report.gaps.splice(inGood, 1);
      row.quality = "spam"; row.reason = "my_choice"; row.reason_words = "You marked it as spam"; row.manual = true;
      report.filtered.unshift(row);
    } else if (body.decision === "auto") {
      if (inGood >= 0 && report.gaps[inGood].kept) {
        const [row] = report.gaps.splice(inGood, 1);
        row.quality = "spam"; row.kept = false; row.reason = row.was?.reason; row.reason_words = row.was?.words;
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
    if (!domain) throw new Error("That doesn't look like a web address.");
    if (!body.competitors?.length) throw new Error("Tick at least one competitor this domain links to.");
    if (sampleOwnDomains().has(domain)) throw new Error("That's one of your own websites.");
    const score = body.authority, tool = (body.authority_label || "").trim();
    if (score !== null && (!Number.isInteger(score) || score < 0 || score > 100)) throw new Error("The authority score goes from 0 to 100.");
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
        const state = { quality: spam ? "spam" : "good", reason: spam?.[0] || null, reason_words: spam?.[1] || null, kept: false };
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
    if (score !== null && (!Number.isInteger(score) || score < 0 || score > 100)) throw new Error("The authority score goes from 0 to 100.");
    if (score !== null && !tool) throw new Error("Say which tool this score comes from.");
    if (tool && score === null) throw new Error("Type the score from that tool too.");
    if (url && !/^https?:\/\/\S+$/i.test(url)) throw new Error("That doesn't look like a web address.");
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
    if (!Array.isArray(body.domains) || !body.domains.length) throw new Error("Pick at least one domain.");
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
    if (!domain) throw new Error("That doesn't look like a web address.");
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
      if (!known) throw new Error("That competitor isn't on this website.");
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
        const spam = row.spam_score !== null && row.spam_score > window.BacklinkCleaner.SPAM_THRESHOLD ? ["spam_score", "Its spam score is above 30"] : sampleNameReason(domain);
        if (spam) {
          report.filtered = report.filtered || [];
          if (!report.filtered.some((g) => g.domain === domain)) report.filtered.push({ ...gap, quality: "spam", reason: spam[0], reason_words: spam[1], authority: row.authority, authority_label: result.authority_label, spam_score: row.spam_score, sample_url: row.url, competitor_count: 1, competitors: [{ id: competitorId, host: rival.host }] });
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
    "Add a domain": "Ajouter un domaine", "One you found in a tool that isn't connected here.": "Un domaine trouvé dans un outil non connecté ici.", "Domain or link": "Domaine ou lien", "Remove this domain": "Retirer ce domaine", "removed": "retiré", "added": "ajouté",
    "Say which domain.": "Indiquez quel domaine.", "Tick at least one competitor this domain links to.": "Cochez au moins un concurrent vers lequel ce domaine pointe.", "That's one of your own websites.": "C'est l'un de vos propres sites.", "That's the competitor itself.": "C'est le concurrent lui-même.",
    "already on the list, so this was added to it": "déjà dans la liste : ces informations y ont été ajoutées", "Its name looks like spam, so it's with the flagged ones.": "Son nom ressemble à du spam : il est avec les domaines signalés.", "It already links to": "Il pointe déjà vers", "so it's left out there.": "il n'apparaît donc pas pour ce site.",
    "Edit this domain": "Modifier ce domaine", "Typed by hand": "Saisi à la main", "From your files": "D'après vos fichiers", "From Common Crawl": "D'après Common Crawl", "No score from a file yet": "Aucun score issu d'un fichier pour l'instant",
    "Type what you read in a tool that isn't connected here. Later uploads never change it.": "Saisissez ce que vous lisez dans un outil non connecté ici. Les imports suivants ne le modifient jamais.",
    "Authority score, 0 to 100": "Score d'autorité, de 0 à 100", "Which tool": "Quel outil", "Last edited": "Dernière modification", "Back to automatic data": "Revenir aux données automatiques", "back to automatic data": "retour aux données automatiques", "saved": "enregistré",
    "A domain needs at least one competitor. To hide it, mark it as spam.": "Un domaine a besoin d'au moins un concurrent. Pour le masquer, marquez-le comme spam.", "The authority score goes from 0 to 100.": "Le score d'autorité va de 0 à 100.", "Say which tool this score comes from.": "Indiquez de quel outil vient ce score.", "Type the score from that tool too.": "Saisissez aussi le score de cet outil.",
    "Spam is flagged first, and only the good ones can be added. Nothing is removed. It comes from Common Crawl and files you upload: no paid tool, no AI. Adding a domain doesn't create a backlink, and doesn't change the Backlinks top cards.": "Le spam est signalé d'abord, et seuls les bons domaines peuvent être ajoutés. Rien n'est retiré. Les données viennent de Common Crawl et des fichiers que vous importez : aucun outil payant, aucune IA. Ajouter un domaine ne crée pas de backlink et ne change pas les cartes du haut de la page Backlinks.",
    "Flagged as spam": "Signalés comme spam", "Add all good ones": "Ajouter tous les bons", "Spam": "Spam", "Not spam": "Pas du spam", "You said it isn't spam": "Vous avez dit que ce n'est pas du spam", "not spam. You can add it now.": "pas du spam. Vous pouvez l'ajouter.", "Checking for spam": "Recherche de spam en cours", "Domains appear here as their home pages are read.": "Les domaines apparaissent ici à mesure que leurs pages d'accueil sont lues.", "No domains left": "Plus aucun domaine", "Every domain already links to you, or is one of your own.": "Chaque domaine pointe déjà vers vous, ou vous appartient.", "Rows with no address": "Lignes sans adresse", "Each domain's home page is read once next, and spam gets flagged. Nothing is removed, and only the good ones can be added.": "La page d'accueil de chaque domaine est ensuite lue une fois, et le spam est signalé. Rien n'est retiré, et seuls les bons domaines peuvent être ajoutés.",
    "Spam filter": "Filtre anti-spam", "Domains found": "Domaines trouvés", "Filtered out as spam": "Retirés comme spam", "Still being checked": "Encore en vérification", "Reading home pages": "Lecture des pages d'accueil", "Good ones": "Bons domaines", "Add all": "Tout ajouter",
    "Common Crawl": "Common Crawl", "Common Crawl not run yet": "Common Crawl pas encore lancé", "A file uploaded": "Un fichier importé", "domain": "domaine", "domains": "domaines", "How Common Crawl runs": "Comment fonctionne Common Crawl",
    "It's free and needs no key. It finds domains only: no page or anchor text. It only sees the part of the web it crawled, so it finds fewer links than a paid tool. It runs on the Mac: about 11 GB passes through, about 7 minutes on your connection, and nothing big is kept.": "C'est gratuit et sans clé. Il ne trouve que des domaines : ni page ni texte d'ancre. Il ne voit que la partie du web qu'il a explorée : il trouve donc moins de liens qu'un outil payant. Il tourne sur le Mac : environ 11 Go transitent, environ 7 minutes avec votre connexion, et rien de lourd n'est conservé.",
    "Top": "Top", "Common Crawl rank": "Classement Common Crawl", "You kept this": "Vous l'avez gardé", "Home page not read": "Page d'accueil non lue", "The site turned the app away, so its home page wasn't checked. That doesn't make it spam.": "Le site a refusé l'application : sa page d'accueil n'a pas été vérifiée. Cela n'en fait pas du spam.", "Mark as spam": "Marquer comme spam", "Why": "Pourquoi", "Keep it": "Le garder", "Undo": "Annuler", "See why each one went. A rule can be wrong.": "Voyez pourquoi chacun a été retiré. Une règle peut se tromper.", "Showing the first": "Affichage des", "of": "sur", "Action": "Action", "Show more": "Afficher plus",
    "No links yet": "Aucun lien pour l'instant", "Run Common Crawl, or upload a CSV of links to one of your competitors. The domains that don't link to you appear here, with spam flagged.": "Lancez Common Crawl, ou importez un CSV de liens vers un de vos concurrents. Les domaines qui ne pointent pas vers vous apparaissent ici, avec le spam signalé.", "Filtering out spam": "Retrait du spam en cours", "The good domains appear here as their home pages are read.": "Les bons domaines apparaissent ici à mesure que leurs pages d'accueil sont lues.", "No good domains left": "Plus aucun bon domaine", "Every domain is filtered out as spam, already links to you, or is one of your own.": "Chaque domaine est retiré comme spam, pointe déjà vers vous, ou vous appartient.",
    "kept. You can add it now.": "gardé. Vous pouvez l'ajouter.", "marked as spam. It can't be added.": "marqué comme spam. Il ne peut pas être ajouté.", "Spam is filtered next: each domain's home page is read once. Only the good ones can be added.": "Le spam est retiré ensuite : la page d'accueil de chaque domaine est lue une fois. Seuls les bons domaines peuvent être ajoutés.",
    "Its spam score is above 30": "Son score de spam dépasse 30", "Spam words in its name": "Mots de spam dans son nom", "A free domain ending that spammers favour": "Une extension gratuite prisée des spammeurs", "A domain ending known for abuse": "Une extension connue pour les abus", "A name no real site would pick": "Un nom qu'aucun vrai site ne choisirait", "Too far down Common Crawl's ranking": "Trop bas dans le classement Common Crawl", "Links out to thousands of sites, like a link farm": "Pointe vers des milliers de sites, comme une ferme de liens", "Thousands of subdomains, like a link farm": "Des milliers de sous-domaines, comme une ferme de liens", "Its home page doesn't exist": "Sa page d'accueil n'existe pas", "The site is down": "Le site est hors ligne", "Its home page leads to another website": "Sa page d'accueil mène à un autre site", "Parked or for sale": "Parqué ou à vendre", "Spam words on its home page": "Mots de spam sur sa page d'accueil", "Its home page is mostly links to other sites": "Sa page d'accueil n'est presque que des liens vers d'autres sites", "Almost nothing on its home page": "Presque rien sur sa page d'accueil", "Its home page is hidden from search engines": "Sa page d'accueil est cachée aux moteurs de recherche", "You marked it as spam": "Vous l'avez marqué comme spam", "Filtered out": "Retiré",
    "From files you upload. Nothing here calls a paid tool. Adding a domain doesn't create a backlink, and doesn't change the Backlinks top cards.": "À partir des fichiers que vous importez. Rien ici n'appelle un outil payant. Ajouter un domaine ne crée pas de backlink et ne change pas les cartes en haut de la page Backlinks.",
    "Where the links come from": "D'où viennent les liens",
    "Sources": "Sources", "No links yet for": "Pas encore de liens pour", "Add links": "Ajouter des liens",
    "Has a file": "Fichier importé",
    "No file yet": "Pas encore de fichier",
    "Upload links for this competitor": "Importer les liens de ce concurrent",
    "Upload links for a competitor": "Importer les liens d'un concurrent",
    "You lost this link": "Vous avez perdu ce lien",
    "One of your competitors": "Un de vos concurrents",
    "Links to": "Pointe vers",
    "How many": "Combien",
    "Example link": "Exemple de lien",
    "Status": "Statut",
    "unknown": "inconnu",
    "Spam score": "Score de spam",
    "Authority": "Autorité",
    "Domain": "Domaine",
    "to In consideration": "à l'étude",
    "Link gaps show who links to your competitors but not to you. Add a competitor first.": "Les liens manquants montrent qui pointe vers vos concurrents mais pas vers vous. Ajoutez d'abord un concurrent.",
    "No files yet": "Aucun fichier pour l'instant",
    "Upload a CSV of links to one of your competitors, and the domains that don't link to you appear here.": "Importez un CSV des liens vers un de vos concurrents : les domaines qui ne pointent pas vers vous apparaîtront ici.",
    "No gaps in your files": "Aucun lien manquant dans vos fichiers",
    "Every domain in your files already links to you, or is one of your own.": "Tous les domaines de vos fichiers pointent déjà vers vous, ou sont les vôtres.",
    "Hide those already in consideration": "Masquer ceux déjà à l'étude",
    "Select all shown": "Tout sélectionner à l'écran",
    "Nothing to show with these filters": "Rien à afficher avec ces filtres",
    "Change the filters above to see more domains.": "Modifiez les filtres ci-dessus pour voir plus de domaines.",
    "1 domain already links to you, so it's left out.": "1 domaine pointe déjà vers vous : il est laissé de côté.",
    "domains already link to you, so they're left out.": "domaines pointent déjà vers vous : ils sont laissés de côté.",
    "domain added to In consideration": "domaine ajouté à l'étude",
    "domains added to In consideration": "domaines ajoutés à l'étude",
    "skipped": "ignorés",
    "Couldn't bring it back": "Impossible de le rétablir", "saved": "enregistrés", "The rest wasn't saved. Add them again.": "Le reste n'a pas été enregistré. Ajoutez-les de nouveau.", "Nothing new to add": "Rien de nouveau à ajouter", "Nothing was saved.": "Rien n'a été enregistré.", "Rating": "Note", "Status and owner": "Statut et responsable", "Website": "Site", "Filter the list": "Filtrer la liste", "Any": "Tous", "Not rated": "Sans note", "DA at least": "DA minimum", "PA at least": "PA minimum", "Spam at most": "Spam maximum", "More filters": "Plus de filtres", "Clear filters": "Effacer les filtres", "No owner": "Sans responsable", "File": "Fichier", "of": "sur", "No links match these filters": "Aucun lien ne correspond à ces filtres", "Change or clear them to see more.": "Modifiez-les ou effacez-les pour en voir plus.", "For the links you add": "Pour les liens que vous ajoutez", "Domain authority: the site's score from the file, whichever tool it came from.": "Autorité du domaine : le score du site dans le fichier, quel que soit l'outil.", "Page authority: this page's score from the file.": "Autorité de la page : le score de cette page dans le fichier.", "A competitor of which of your websites?": "Concurrent de quel site ?", "Add your own website first, then its competitors.": "Ajoutez d'abord votre site, puis ses concurrents.", "That website isn't saved yet.": "Ce site n'est pas encore enregistré.", "Type the website's address.": "Saisissez l'adresse du site.", "added as a competitor of": "ajouté comme concurrent de", "skipped: only one link per domain, and never spam": "ignorés : un seul lien par domaine, et jamais de spam",
    "See them": "Les voir",
    "A CSV of links to this competitor, exported from a free SEMrush or Ubersuggest account. Needs a URL or domain column.": "Un CSV des liens vers ce concurrent, exporté depuis un compte gratuit SEMrush ou Ubersuggest. Il faut une colonne URL ou domaine.",
    "File": "Fichier",
    "Upload": "Importer",
    "Uploading…": "Import en cours…",
    "Rows in the file": "Lignes du fichier",
    "Domains": "Domaines",
    "Upload another file": "Importer un autre fichier",
    "Pick at least one domain.": "Choisissez au moins un domaine.",
    "The file is empty.": "Le fichier est vide.",
    "This CSV has headers but no data rows.": "Ce CSV a des en-têtes mais aucune ligne de données.",
    "Choose a CSV file.": "Choisissez un fichier CSV.",
  });
})();
