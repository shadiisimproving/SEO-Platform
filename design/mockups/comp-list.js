/* Competitors area: "My competitors" with each competitor's full profile, and "Find competitors".

   One code path: COMP.api answers from the server, or from comp-sample-data.js when opened as a plain file.
   The handlers at the bottom make every write work in the sample too, by changing COMP_SAMPLE.get in place.
   Suggestions are counted from search results, never by AI. All HTML goes through setHTML, all values through esc,
   and text from other websites always carries dir="auto". */
(() => {
  "use strict";
  const COMP = window.COMP;
  let UI = null;
  let bound = false;

  window.ICONS.upload = '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>';

  // ---- words ------------------------------------------------------------------------------
  const t = (s) => UI.t(s);
  const esc = (v) => UI.esc(v);
  const icon = (name, cls) => UI.icon(name, cls);
  const attr = (s) => esc(t(s));
  /* The same English word can need two French ones. "New|tag" shows as "New" in English. */
  const tag = (key) => t(key).split("|")[0];
  /* Fills {names} in a sentence, so French can put them in its own order. The result is plain text, unless the values are HTML. */
  const fill = (key, values = {}) => t(key).replace(/\{(\w+)\}/g, (all, name) => (name in values ? values[name] : all));
  const many = (n, one, other, values = {}) => fill((UI.state.lang === "fr" ? n < 2 : n === 1) ? one : other, { n: UI.num(n), ...values });
  const dash = '<span class="muted">—</span>';
  const engineName = (id) => UI.ENGINES.find(([key]) => key === id)?.[1] || id || "";

  /* Sentences from the server. Most are fixed; these carry a name or a number. */
  const FR_SENTENCES = [
    [/^(.+) is already one of this website's competitors\.$/, "$1 fait déjà partie des concurrents de ce site."],
    [/^(.+) is part of your own websites, so it can't be a competitor\.$/, "$1 fait partie de vos sites, donc pas un concurrent."],
    [/^(.+) is already added as your own website\.$/, "$1 est déjà ajouté comme l'un de vos sites."],
    [/^(.+) is already added as a competitor\.$/, "$1 est déjà ajouté comme concurrent."],
    [/^That's (\d+) keywords\. The limit for one list is (\d+)\.$/, "Cela fait $1 mots-clés. La limite pour une liste est de $2."],
    [/^(.+) has no free checks left this month\.$/, "$1 n'a plus de vérifications gratuites ce mois-ci."],
  ];
  function say(message) {
    const text = String(message ?? "");
    if (UI.state.lang !== "fr") return text;
    if (window.FR[text] !== undefined) return window.FR[text];
    return text.split(/(?<=\.)\s+/).map((part) => {
      if (window.FR[part] !== undefined) return window.FR[part];
      const known = FR_SENTENCES.find(([pattern]) => pattern.test(part));
      return known ? part.replace(known[0], known[1]) : part;
    }).join(" ");
  }
  const fail = (err) => UI.toast(say(err.message), { kind: "crit" });

  // ---- what the tabs hold -----------------------------------------------------------------
  const list = { rows: null, site: null, scroll: 0, flash: null, timer: null };
  const view = { data: null, filter: "all", limit: 50, kw: "shared", sort: { key: "keyword", dir: 1 }, kwLimit: 100 };
  const find = { data: null, site: null, open: new Set(), groups: new Set(), polling: null, lastBadge: null };
  const upload = { file: null, bytes: null, text: "", unicode: true, reencode: false, encoding: "" };

  const here = (tabId, site) => UI.state.route === "competitors" && COMP.tab === tabId && COMP.siteId === site;
  const findData = () => (find.site === COMP.siteId ? find.data : null);

  // ---- focus: a repaint must never drop the keyboard ----------------------------------------
  let pending = null;
  let remembered = null;
  let ignoreUntil = 0;
  const hold = () => { UI.ignoreClicks(); ignoreUntil = performance.now() + 400; }; // the second half of a double click must not press what's underneath

  function remember() {
    remembered = null;
    const el = document.activeElement;
    if (!el?.closest?.("#comp-body")) return;
    const mark = [...el.attributes].find((a) => a.name === "id" || a.name.startsWith("data-cl-"));
    if (mark) remembered = [mark.name, mark.value];
  }
  function settleFocus() {
    const action = pending;
    pending = null;
    if (action) { remembered = null; action(); return; }
    if (!remembered) return;
    const [name, value] = remembered;
    remembered = null;
    const box = UI.$("#comp-body");
    if (box) UI.$$(`[${name}]`, box).find((el) => el.getAttribute(name) === value)?.focus({ preventScroll: true });
  }
  const focusAttr = (name, value) => { const box = UI.$("#comp-body"); return box && UI.$$(`[${name}]`, box).find((el) => el.getAttribute(name) === String(value)); };

  /* The count on the tab is drawn with the page. It can change without a redraw, so it's kept right here. */
  function syncBadge() {
    const button = UI.$('[data-comp-tab="find"]');
    if (!button) return;
    const n = findTab.badge();
    if (n === find.lastBadge && Boolean(button.querySelector(".count")) === Boolean(n)) return;
    find.lastBadge = n;
    let count = button.querySelector(".count");
    if (!n) count?.remove();
    else {
      if (!count) { count = document.createElement("span"); count.className = "count"; button.append(count); }
      count.textContent = n;
    }
    window.dispatchEvent(new Event("resize")); // puts the highlight behind the current tab back in place
  }

  // ---- the watching state ------------------------------------------------------------------
  const BLOCKED_TEXT = "This site doesn't allow automated visitors, so its edits can't be tracked. The app doesn't try to get past that.";
  const crawling = (crawl) => crawl?.status === "queued" || crawl?.status === "running";

  function watching(crawl) {
    const c = crawl || { status: "none" };
    let inner;
    if (c.status === "ok") inner = `${UI.status("good", t("Watching"))}<span class="second">${esc(fill("Last read {when}", { when: COMP.ago(c.finished_at) }))}</span>`;
    else if (c.status === "running") inner = `<span class="status sec">${icon("refresh-cw", "spin")}${esc(t("Reading now"))}</span>${c.pages_read ? `<span class="second">${esc(many(c.pages_read, "{n} page read so far", "{n} pages read so far"))}</span>` : ""}`;
    else if (c.status === "queued") inner = `<span class="status sec">${icon("clock")}${esc(t("Waiting to read"))}</span>`;
    else if (c.status === "blocked") inner = `${UI.status("warn", t("Blocked"))}<span class="second cl-wrap">${esc(say(c.message || BLOCKED_TEXT))}</span>`;
    else if (c.status === "failed") inner = `${UI.status("crit", t("Last read failed"))}<span class="second cl-wrap">${esc(t("It tries again at the next daily read."))}</span>`;
    else inner = `<span class="status sec">${icon("clock")}${esc(t("Not read yet"))}</span>`;
    return `<span class="cl-watch">${inner}</span>`;
  }
  const howAdded = (source) => t(source === "suggested" ? "From a suggestion" : "Added by hand");

  // ---- My competitors: the list ---------------------------------------------------------------
  COMP.watching = (crawl) => watching(crawl);

  function listBody() {
    const rows = list.rows;
    if (!rows.length) {
      const waiting = findData()?.suggestions?.length || 0;
      return COMP.empty(
        t("No competitors yet"),
        waiting ? many(waiting, "{n} suggestion is waiting in Find competitors. Accept it, or add a competitor by hand.", "{n} suggestions are waiting in Find competitors. Accept one, or add a competitor by hand.") : t("Upload your keyword list in Find competitors to see who really ranks against you, or add a competitor by hand."),
        `<div class="cl-empty-acts"><button class="btn btn-main" data-cl-go-find>${icon("target")}${t("Find competitors")}</button><button class="btn" id="cl-add-open">${icon("plus")}${t("Add one by hand")}</button></div>`
      );
    }
    const site = COMP.site()?.host || "";
    return `<section class="tool-band cl-band" aria-label="${attr("My competitors")}">
        <p>${many(rows.length, "You're watching {n} competitor for {site}. Open it to see everything about it.", "You're watching {n} competitors for {site}. Open one to see everything about it.", { site: `<span class="mono">${esc(site)}</span>` })}</p>
        <button class="btn btn-main" id="cl-add-open">${icon("plus")}${t("Add a competitor")}</button>
      </section>
      <div class="table-wrap"><table class="data" id="cl-table">
        <thead><tr><th scope="col">${t("Competitor")}</th><th scope="col" class="c">${t("Shared keywords")}</th><th scope="col" class="c">${t("They're ahead on")}</th><th scope="col" class="c">${t("You're ahead on")}</th><th scope="col" class="c">${t("Only they rank on")}</th><th scope="col" class="c">${t("Edits in 30 days")}</th><th scope="col">${t("Watching")}</th><th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead>
        <tbody>${rows.map(listRow).join("")}</tbody>
      </table></div>`;
  }

  const listRow = (c) => `<tr data-cl-row="${c.id}" class="${list.flash === c.id ? "flash" : ""}">
      <td class="head-cell"><span class="with-logo">${UI.siteLogo(c.host)}<span class="logo-text"><button class="kw cl-name" data-cl-open="${c.id}" dir="auto">${esc(c.display || c.host)}</button>${c.source === "suggested" ? "" : `<span class="second">${esc(howAdded(c.source))}</span>`}</span></span></td>
      <td class="c" data-label="${attr("Shared keywords")}">${UI.num(c.shared)}</td>
      <td class="c" data-label="${attr("They're ahead on")}">${UI.num(c.they_ahead)}</td>
      <td class="c" data-label="${attr("You're ahead on")}">${UI.num(c.i_ahead)}</td>
      <td class="c" data-label="${attr("Only they rank on")}">${UI.num(c.theirs_only)}</td>
      <td class="c" data-label="${attr("Edits in 30 days")}">${c.crawl?.status === "blocked" ? `<span class="muted" title="${attr("Edits can't be tracked on this site.")}">—</span>` : UI.num(c.edits_30d)}</td>
      <td data-label="${attr("Watching")}" data-cl-watch="${c.id}">${watching(c.crawl)}</td>
      <td class="r nowrap" data-label=""><button class="icon-btn cl-row-btn" data-cl-remove="${c.id}" aria-label="${attr("Remove")}: ${esc(c.host)}" data-tip="${attr("Remove")}">${icon("trash-2")}</button></td>
    </tr>`;

  function openProfile(id) {
    list.scroll = UI.$("#main")?.scrollTop || 0;
    listTab.competitorId = id;
    view.data = null;
    COMP.reload({ quiet: true });
  }
  function backToList() {
    const id = listTab.competitorId;
    listTab.competitorId = null;
    view.data = null;
    pending = () => {
      const main = UI.$("#main");
      if (main) main.scrollTop = list.scroll;
      (focusAttr("data-cl-open", id) || UI.$("#cl-add-open"))?.focus({ preventScroll: true });
    };
    COMP.reload({ quiet: true });
  }

  /* While something is being read, only its state is redrawn. When it ends, the numbers are fetched again. */
  function watchCrawls() {
    clearTimeout(list.timer);
    const id = listTab.competitorId;
    const site = COMP.siteId;
    const showing = id && view.data ? [view.data] : list.rows || [];
    if (!showing.some((c) => crawling(c.crawl))) return;
    list.timer = setTimeout(async () => {
      if (!here("list", site) || listTab.competitorId !== id) return;
      let rows;
      try { rows = (await COMP.api("GET", `competitors?site_id=${site}`)).competitors; } catch { watchCrawls(); return; }
      if (!here("list", site) || listTab.competitorId !== id) return;
      if (id) {
        const row = rows.find((c) => c.id === id);
        if (!row || !view.data) { COMP.reload({ quiet: true }); return; }
        const was = view.data.crawl?.status;
        view.data.crawl = row.crawl;
        if (!crawling(row.crawl)) { COMP.reload({ quiet: true }); return; }
        if (row.crawl.status !== was) paintWatch();
      } else {
        list.rows = rows;
        if (!rows.some((c) => crawling(c.crawl))) { COMP.paint(); return; }
        rows.forEach((c) => { const cell = UI.$(`[data-cl-watch="${c.id}"]`); if (cell) UI.setHTML(cell, watching(c.crawl)); });
      }
      watchCrawls();
    }, 2500);
  }

  // ---- Add and remove ---------------------------------------------------------------------------
  const fieldError = (input, box, message) => {
    input?.classList.add("invalid");
    if (box) UI.setHTML(box, `<div class="error" role="alert">${icon("octagon-alert")}<span>${esc(message)}</span></div>`);
    input?.focus();
  };
  const fieldClear = (input, box) => { input?.classList.remove("invalid"); if (box) box.replaceChildren(); };

  function openAdd(opener) {
    const site = COMP.siteId;
    UI.openPanel(`${UI.panelHead(t("Add a competitor"), `${t("For")} <span class="mono">${esc(COMP.site()?.host || "")}</span>`)}
      <form class="panel-body" id="cl-add-form" novalidate>
        <label class="field"><span>${t("Its website address")} <span class="req">*</span></span><input class="input mono" id="cl-add-address" dir="ltr" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://" data-autofocus aria-describedby="cl-add-error"><div id="cl-add-error"></div></label>
        <p class="help">${t("The app reads its public pages slowly and follows its rules for automated visitors. If the site says no, it says so here and doesn't try to get past it.")}</p>
      </form>
      <div class="panel-foot"><button class="btn btn-main" id="cl-add-save">${t("Add")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener, { key: `cl-add|${site}`, reopen: () => openAdd(opener) });
  }

  /* Open and Undo side by side: the toast helper holds one action, so the second is added to its row. */
  function addedToast(made, sourceSite) {
    const name = (list.rows || []).find((c) => c.id === made.id)?.display || made.display || made.host;
    const open = () => COMP.open("list", { competitorId: made.id });
    const undo = async () => {
      try {
        await COMP.api("DELETE", `competitors/${made.id}?site_id=${sourceSite}`);
        UI.toast(fill("{host} is no longer one of your competitors.", { host: name }), { kind: "info" });
        refreshHere();
      } catch (err) { fail(err); }
    };
    const el = UI.toast(fill("{host} is now one of your competitors.", { host: name }), { undo });
    const button = document.createElement("button");
    button.className = "link-btn";
    button.textContent = t("Open");
    button.onclick = () => { el.remove(); open(); };
    el.querySelector(".acts")?.prepend(button);
  }
  const refreshHere = () => { if (UI.state.route === "competitors" && (COMP.tab === "list" || COMP.tab === "find")) return COMP.reload({ quiet: true }); return null; };

  async function submitAdd() {
    const input = UI.$("#cl-add-address"), box = UI.$("#cl-add-error"), save = UI.$("#cl-add-save");
    if (!input || save?.disabled) return;
    const address = input.value.trim();
    fieldClear(input, box);
    if (!address) { fieldError(input, box, t("Enter the competitor's address.")); return; }
    save.disabled = true;
    const site = COMP.siteId;
    try {
      const made = await COMP.api("POST", "competitors", { site_id: site, address });
      UI.forgetPanelForm();
      UI.closePanel({ keep: false });
      list.flash = made.id;
      pending = () => focusAttr("data-cl-open", made.id)?.focus({ preventScroll: true });
      await refreshHere();
      addedToast(made, site);
    } catch (err) {
      fieldError(input, box, say(err.message));
    } finally {
      if (save.isConnected) save.disabled = false;
    }
  }

  function confirmRemove(id) {
    const row = (list.rows || []).find((c) => c.id === id) || (view.data?.id === id ? view.data : null);
    if (!row) return;
    const dlg = UI.$("#dlg");
    dlg.classList.remove("wide");
    UI.setHTML(dlg, `<div class="dlg-head"><h2 id="dlg-title" dir="auto">${esc(fill("Remove {host}?", { host: row.display || row.host }))}</h2><button class="icon-btn" data-close-dlg aria-label="${attr("Close")}">${icon("x")}</button></div>
      <div class="dlg-body"><p>${esc(fill("It stops being compared with {site}. Its data is kept, so nothing is lost if you add it back.", { site: COMP.site()?.host || "" }))}</p><p class="small sec" style="margin-top:8px">${t("Its page pairs on this website are removed. Automatic ones come back if you add it again.")}</p></div>
      <div class="dlg-foot"><button class="btn" data-close-dlg>${t("Cancel")}</button><button class="btn btn-main" data-cl-remove-yes="${id}">${t("Remove")}</button></div>`);
    dlg.showModal();
    UI.$("[data-cl-remove-yes]", dlg)?.focus();
  }

  async function removeNow(id) {
    const row = (list.rows || []).find((c) => c.id === id) || view.data;
    const site = COMP.siteId;
    const rows = list.rows || [];
    const at = rows.findIndex((c) => c.id === id);
    const next = rows[at + 1]?.id ?? rows[at - 1]?.id ?? null;
    try {
      await COMP.api("DELETE", `competitors/${id}?site_id=${site}`);
    } catch (err) { fail(err); return; }
    if (listTab.competitorId === id) listTab.competitorId = null;
    view.data = null;
    pending = () => (focusAttr("data-cl-open", next) || UI.$("#cl-add-open"))?.focus({ preventScroll: true });
    await refreshHere();
    UI.toast(t("Removed. Its data is kept."), {
      kind: "info",
      undo: async () => {
        try {
          const back = row.source === "suggested"
            ? await COMP.api("POST", "competitors/suggestions/accept", { site_id: site, domain: row.host })
            : await COMP.api("POST", "competitors", { site_id: site, address: row.host });
          list.flash = back.id;
          pending = () => focusAttr("data-cl-open", back.id)?.focus({ preventScroll: true });
          await refreshHere();
        } catch (err) { fail(err); }
      },
    });
  }

  // ---- The profile ---------------------------------------------------------------------------------
  const EDIT_KINDS = ["title", "meta", "h1", "headings", "canonical", "robots", "schema", "content"];
  const TIMELINE_FILTERS = [
    ["all", "All", null], ["edits", "Page edits", EDIT_KINDS], ["new", "New pages", ["new_page"]], ["gone", "Removed|pages", ["page_gone"]],
    ["rank", "Ranking moves", ["rank_new", "rank_lost", "rank_up", "rank_down"]], ["ai", "AI Overview", ["ai_cited", "ai_dropped"]],
  ];
  const KINDS = {
    title: ["pencil", "Title changed"], meta: ["pencil", "Meta description changed"], h1: ["pencil", "Main heading changed"], headings: ["pencil", "Subheadings changed"],
    canonical: ["pencil", "Preferred address changed"], robots: ["pencil", "Instructions to search engines changed"], schema: ["pencil", "Structured data changed"], content: ["file-text", "Page text changed"],
    new_page: ["plus", "New page found"], page_gone: ["minus", "Page removed"],
    rank_new: ["trending-up", "Started ranking for"], rank_lost: ["arrow-down", "Dropped out of the results for"], rank_up: ["arrow-up", "Moved up on"], rank_down: ["arrow-down", "Moved down on"],
    ai_cited: ["sparkles", "Cited in the AI Overview for"], ai_dropped: ["sparkles", "No longer cited in the AI Overview for"],
  };

  function compareTile(label, mine, theirs, { note = "", verdict = "" } = {}) {
    const side = (who, value) => `<div class="cl-side"><span class="cl-who">${who}</span><span class="cl-fig tabular">${value}</span></div>`;
    return `<div class="tile cl-cmp"><div class="lab">${esc(label)}</div><div class="cl-sides">${side(t("You"), mine)}${side(t("Them"), theirs)}</div><div class="delta">${verdict}${note ? `<span class="ab">${esc(note)}</span>` : ""}</div></div>`;
  }
  /* Said in words with an icon, never by colour alone. */
  function verdict(mine, theirs, lowerWins = false) {
    if (mine === null || mine === undefined || theirs === null || theirs === undefined) return "";
    if (mine === theirs) return UI.status("info", t("Level"));
    return (lowerWins ? mine < theirs : mine > theirs) ? UI.status("good", t("You're ahead")) : UI.status("warn", t("They're ahead"));
  }

  function compareBody(p) {
    const c = p.compare;
    const figure = (n) => (n === null || n === undefined ? dash : UI.num(n));
    const place = (n) => (n === null || n === undefined ? dash : `#${esc(UI.dec(n))}`);
    const blocked = p.crawl?.status === "blocked";
    const theirPages = ""; // a blocked site's warning sits at the top of the profile, once; these tiles just show a dash
    return `<section class="tiles cl-tiles" aria-label="${attr("How you compare")}">
      <div class="tile cl-cmp"><div class="lab">${t("Keywords you both rank on")}</div><div class="cl-sides"><div class="cl-side"><span class="cl-who">${t("You and them")}</span><span class="cl-fig tabular">${UI.num(c.shared)}</span></div></div><div class="delta">${c.level ? `<span class="ab">${esc(many(c.level, "Level on {n}", "Level on {n}"))}</span>` : ""}</div></div>
      ${compareTile(t("Average position on shared keywords"), place(c.my_average), place(c.their_average), { verdict: verdict(c.my_average, c.their_average, true), note: c.my_average === null ? t("Nothing shared yet.") : t("Lower is better.") })}
      ${compareTile(t("Ahead on shared keywords"), figure(c.i_ahead), figure(c.they_ahead), { verdict: c.shared ? verdict(c.i_ahead, c.they_ahead) : "" })}
      ${compareTile(t("Keywords only one of you ranks on"), figure(c.mine_only), figure(c.theirs_only), { note: t("The other isn't in the results checked.") })}
      ${compareTile(t("Pages known"), figure(c.pages?.mine?.pages), blocked ? dash : figure(c.pages?.theirs?.pages), { note: theirPages })}
      ${compareTile(t("Average words per page"), figure(c.pages?.mine?.average_words), blocked ? dash : figure(c.pages?.theirs?.average_words), { note: theirPages })}
      ${compareTile(t("New pages in 30 days"), figure(c.pages?.mine?.new_pages_30d), blocked ? dash : figure(c.pages?.theirs?.new_pages_30d), { note: theirPages })}
      ${compareTile(t("AI Overview citations"), figure(c.ai_cited_me), figure(c.ai_cited_them), { verdict: c.ai_overviews ? verdict(c.ai_cited_me, c.ai_cited_them) : "", note: c.ai_overviews ? many(c.ai_overviews, "Of {n} AI Overview seen.", "Of {n} AI Overviews seen.") : t("No AI Overview seen yet.") })}
    </section>`;
  }

  /* h1, headings and schema are saved as JSON lists. Anything else stays plain text. */
  function asList(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string" || !/^\s*\[/.test(value)) return null;
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : null; } catch { return null; }
  }
  const listItems = (items) => (items || []).map((item) => (Array.isArray(item) ? item[item.length - 1] : item)).map((item) => (typeof item === "string" ? item : JSON.stringify(item))).filter((item) => item !== "");

  const changeLine = (label, text, cls = "") => `<div class="cl-change-line ${cls}"><span class="cl-change-label">${esc(label)}</span><span class="cl-change-text" dir="auto">${text === "" || text === null || text === undefined ? `<span class="muted">${t("Empty")}</span>` : esc(text)}</span></div>`;

  function changeDetail(e) {
    if (e.kind === "content") {
      const from = String(e.before ?? "").match(/^(\d+) words$/), to = String(e.after ?? "").match(/^(\d+) words$/);
      if (from && to) {
        return `<div class="d tabular">${esc(fill("{from} words, now {to}", { from: UI.num(Number(from[1])), to: UI.num(Number(to[1])) }))}</div>`;
      }
    }
    const was = asList(e.before), now = asList(e.after);
    if (was || now) {
      const before = listItems(was), after = listItems(now);
      const added = after.filter((x) => !before.includes(x)), gone = before.filter((x) => !after.includes(x));
      if (!added.length && !gone.length) return `<div class="d">${t("The same items, in a different order.")}</div>`;
      return `<div class="cl-change">${gone.length ? changeLine(t("Taken out"), gone.join(" · "), "was") : ""}${added.length ? changeLine(t("Added"), added.join(" · ")) : ""}</div>`;
    }
    return `<div class="cl-change">${changeLine(t("Before"), e.before, "was")}${changeLine(t("After"), e.after)}</div>`;
  }

  function moveDetail(e) {
    const from = e.kind === "rank_new" ? COMP.pos(null, e.depth) : COMP.pos(e.from, e.depth);
    const to = e.kind === "rank_lost" ? COMP.pos(null, e.depth) : COMP.pos(e.to, e.depth);
    return `<div class="d cl-move"><span class="cl-move-places">${from}${icon("arrow-right")}<span class="sr">${t("now")}</span>${to}</span><span>${esc(engineName(e.engine))} · ${esc(e.tool || "")}</span></div>`;
  }

  /* `who` says whose timeline it is when the row isn't on that competitor's profile: { id, rival, own }. */
  function timelineFind(e, word, who = null) {
    const rival = who?.rival ?? view.data?.host ?? "", about = e.keyword || e.url || "", own = who ? who.own : view.data?.site?.host;
    const key = `timeline|${who?.id ?? view.data?.id}|${e.kind}|${about}|${e.at || ""}`;
    return { title: `${rival}: ${t(word)}${about ? ` · ${e.keyword || COMP.shortUrl(e.url)}` : ""}`, host: own, source: { type: "competitor", label: `${rival}: ${t(word)}`, host: own, facts: [e.keyword, e.url, e.at ? UI.fmtDateOnly(e.at) : ""].filter(Boolean), link: `#competitors/list/${who?.id ?? view.data?.id}`, key } };
  }

  function timelineRow(e, focusable, who = null) {
    const [ic, word] = KINDS[e.kind] || ["circle-dot", e.kind];
    const isMove = e.kind.startsWith("rank_");
    const isAi = e.kind.startsWith("ai_");
    const about = isMove || isAi ? ` <span class="kw" dir="auto">${esc(e.keyword)}</span>` : "";
    const detail = isMove ? moveDetail(e) : isAi ? `<div class="d">${esc(engineName(e.engine))} · ${esc(e.tool || "")}</div>` : e.kind === "new_page" || e.kind === "page_gone" ? "" : changeDetail(e);
    return `<li ${focusable ? 'tabindex="-1" data-cl-first-new' : ""}><span class="ico cl-tl-ico">${icon(ic)}</span><div class="what">${who ? `<div class="d cs-who"><span class="with-logo">${UI.siteLogo(who.rival, 16)}<span class="logo-text mono" dir="auto">${esc(who.display || who.rival)}</span></span> · ${esc(COMP.ago(e.at))}</div>` : ""}<div class="t">${esc(t(word))}${about}</div>${detail}${window.ChangeSummary?.slot(e) || ""}${e.url ? `<div class="d">${COMP.link(e.url)}</div>` : ""}</div><div class="acts">${UI.taskButton(timelineFind(e, word, who), { label: "Task" })}</div></li>`;
  }
  COMP.timelineRow = (e, who) => timelineRow(e, false, who);

  function timelineBody(p) {
    const all = p.timeline || [];
    const filter = TIMELINE_FILTERS.find(([id]) => id === view.filter) || TIMELINE_FILTERS[0];
    const kinds = (x) => (x[2] ? all.filter((e) => x[2].includes(e.kind)).length : all.length);
    const chips = `<div class="chips" role="group" aria-label="${attr("Filter the timeline")}">${TIMELINE_FILTERS.filter((x) => x[0] === "all" || x[0] === view.filter || kinds(x) > 0).map((x) => `<button class="chip" data-cl-tl="${x[0]}" aria-pressed="${view.filter === x[0]}">${esc(tag(x[1]))}<b>${UI.num(kinds(x))}</b></button>`).join("")}</div>`;
    const shown = filter[2] ? all.filter((e) => filter[2].includes(e.kind)) : all;
    if (!shown.length) {
      const blocked = p.crawl?.status === "blocked" && ["edits", "new", "gone"].includes(filter[0]);
      const early = !p.crawl?.baseline_done && !blocked;
      return `${chips}<p class="cl-none small sec">${esc(blocked ? t("Page changes can't be tracked, because this site doesn't allow automated visitors.") : early ? t("Nothing yet. The first read only sets a starting point, so changes appear from the next read on.") : filter[0] === "rank" ? t("No ranking moves yet. A move needs two checks by the same tool.") : t("Nothing here yet."))}</p>`;
    }
    const part = shown.slice(0, view.limit);
    const days = new Map();
    part.forEach((e, i) => {
      const day = String(e.at || "").slice(0, 10);
      if (!days.has(day)) days.set(day, []);
      days.get(day).push([e, i]);
    });
    const firstNew = view.limit > 50 ? view.limit - 50 : -1;
    const left = shown.length - part.length;
    return `${chips}
      <div class="cl-days">${[...days.entries()].map(([day, entries]) => `<section class="cl-day"><h3 class="cl-day-name">${esc(UI.fmtDateOnly(`${day}T00:00:00Z`))}</h3><ul class="rows cl-tl">${entries.map(([e, i]) => timelineRow(e, i === firstNew)).join("")}</ul></section>`).join("")}</div>
      ${left ? `<p class="cl-more"><button class="btn btn-small" data-cl-tl-more>${t("Show more")} (${UI.num(left)})</button></p>` : ""}`;
  }

  function paintTimeline(focus) {
    const box = UI.$("#cl-timeline");
    if (!box || !view.data) return;
    UI.setHTML(box, timelineBody(view.data));
    focus?.();
  }

  const sortRows = (rows, key, dir) => {
    const value = (r) => r[key];
    return [...rows].sort((a, b) => {
      const x = value(a), y = value(b);
      if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1; // "not in the results" always goes last
      if (y === null || y === undefined) return -1;
      const order = typeof x === "number" ? x - y : String(x).localeCompare(String(y), UI.state.lang);
      return order * dir;
    });
  };

  function keywordsBody(p) {
    const groups = { shared: p.keywords.filter((k) => k.status === "shared"), theirs_only: p.keywords.filter((k) => k.status === "theirs_only"), mine_only: p.keywords.filter((k) => k.status === "mine_only"), past: p.past_keywords || [] };
    const seg = `<div class="seg cl-seg" role="group" aria-label="${attr("Which keywords")}">${[["shared", "Shared"], ["theirs_only", "Only them"], ["mine_only", "Only you"], ["past", "Past"]].map(([id, word]) => `<button data-cl-kw="${id}" aria-pressed="${view.kw === id}">${t(word)} <span class="tabular muted">${UI.num(groups[id].length)}</span></button>`).join("")}</div>`;
    const rows = groups[view.kw] || [];
    const sorted = sortRows(rows, view.sort.key, view.sort.dir).slice(0, view.kwLimit);
    const head = (key, label, cls = "") => {
      const on = view.sort.key === key;
      return `<th scope="col" class="${cls}" ${on ? `aria-sort="${view.sort.dir > 0 ? "ascending" : "descending"}"` : ""}><button data-cl-sort="${key}">${t(label)}${icon(on && view.sort.dir < 0 ? "arrow-down" : "arrow-up")}</button></th>`;
    };
    const emptyWords = { shared: "You don't rank together on any keyword yet.", theirs_only: "They don't rank on any keyword without you.", mine_only: "You don't rank on any keyword without them.", past: "Nothing yet. A keyword lands here when they used to rank for it and the latest check no longer shows them." };
    if (!rows.length) return `${seg}<p class="cl-none small sec">${t(emptyWords[view.kw])}</p>`;
    const place = (n, url, depth) => `<span class="cl-cell">${COMP.pos(n, depth)}${url ? `<span class="cl-url">${COMP.link(url)}</span>` : ""}</span>`;
    const left = rows.length - sorted.length;
    const table = view.kw === "past"
      ? `<table class="data cl-table"><thead><tr>${head("keyword", "Keyword")}${head("last_position", "Their last position")}${head("last_seen", "Last seen")}<th scope="col">${t("Tool")}</th></tr></thead><tbody>${sorted.map((k) => `<tr>
          <td class="head-cell"><span class="kw" dir="auto">${esc(k.keyword)}</span></td>
          <td data-label="${attr("Their last position")}">${place(k.last_position, k.last_url)}</td>
          <td data-label="${attr("Last seen")}"><span class="nowrap">${esc(COMP.ago(k.last_seen))}</span></td>
          <td data-label="${attr("Tool")}"><span class="cl-cell">${esc(k.tool || "")}<span class="second">${esc(engineName(k.engine))}</span></span></td></tr>`).join("")}</tbody></table>`
      : `<table class="data cl-table"><thead><tr>${head("keyword", "Keyword")}${head("my_position", "You")}${head("their_position", "Them")}${head("checked_at", "Tool and age")}</tr></thead><tbody>${sorted.map((k) => `<tr>
          <td class="head-cell"><span class="kw" dir="auto">${esc(k.keyword)}</span></td>
          <td data-label="${attr("You")}">${place(k.my_position, k.my_url, k.depth)}</td>
          <td data-label="${attr("Them")}">${place(k.their_position, k.their_url, k.depth)}</td>
          <td data-label="${attr("Tool and age")}"><span class="cl-cell">${esc(k.tool || "")} · ${esc(engineName(k.engine))}<span class="second">${esc(COMP.ago(k.checked_at))}</span></span></td></tr>`).join("")}</tbody></table>`;
    return `${seg}<div class="cl-scroll">${table}</div>${left ? `<p class="cl-more"><button class="btn btn-small" data-cl-kw-more>${t("Show more")} (${UI.num(left)})</button></p>` : ""}`;
  }

  function paintKeywords(focus) {
    const box = UI.$("#cl-keywords");
    if (!box || !view.data) return;
    UI.setHTML(box, keywordsBody(view.data));
    focus?.();
  }

  function pairsCard(p) {
    const rows = (p.pairs || []).filter((x) => !x.hidden);
    const page = (who, title, url) => `<div class="cl-pair-side"><span class="cl-who">${who}</span><span class="t" dir="auto">${esc(title || COMP.shortUrl(url))}</span>${COMP.link(url)}</div>`;
    return `<section class="card" aria-label="${attr("Their pages against mine")}"><div class="card-head"><h2>${t("Their pages against mine")}</h2>${rows.length ? `<span class="tag tabular">${UI.num(rows.length)}</span>` : ""}</div>
      ${rows.length ? `<ul class="rows cl-pairs">${rows.map((x) => `<li>
        <div class="what cl-pair">${page(t("Them"), x.their_title, x.their_url)}${page(t("You"), x.my_title, x.my_url)}</div>
        <div class="acts"><span class="small muted nowrap">${esc(many(x.shared_keywords || 0, "{n} shared keyword", "{n} shared keywords"))}</span><button class="btn btn-small" data-cl-pair="${x.id}">${icon("columns-3")}${t("Compare")}</button></div>
      </li>`).join("")}</ul>` : `<p class="cl-none small sec">${t("No pages to compare yet. A pair appears when you both rank for the same keyword.")}</p>`}</section>`;
  }

  function headNote(p) {
    const c = p.crawl || {};
    if (c.status === "blocked") return `<p class="note warn cl-head-note">${icon("triangle-alert")}<span>${esc(say(c.message || BLOCKED_TEXT))} ${esc(t("Everything from search results still works: rankings, AI Overviews and shared keywords."))}</span></p>`;
    if (c.status === "failed") return `<p class="note crit cl-head-note">${icon("octagon-alert")}<span>${esc(t("The last read failed. It tries again at the next daily read, and everything from search results still works."))}${c.message ? ` <span class="small mono cl-wrap" dir="auto">${esc(c.message)}</span>` : ""}</span></p>`;
    return "";
  }
  const watchArea = (p) => `${watching(p.crawl)}`;
  function paintWatch() {
    const p = view.data, box = UI.$("#cl-watch-state");
    if (!p || !box) return;
    UI.setHTML(box, watchArea(p));
    const read = UI.$("[data-cl-read]");
    if (read) read.disabled = crawling(p.crawl);
    const note = UI.$("#cl-head-note");
    if (note) UI.setHTML(note, headNote(p));
  }

  function profileBody() {
    const p = view.data;
    const url = `https://${p.host}/`;
    return `<p class="cl-back"><button class="btn btn-ghost" data-cl-back>${icon("chevron-left")}${t("Back to competitors")}</button></p>
      <section class="card cl-head" aria-labelledby="cl-profile-title">
        <div class="cl-head-row">
          <div class="cl-head-main">
            <h2 id="cl-profile-title" tabindex="-1">${UI.siteLogo(p.host, 24)} ${COMP.link(url, p.display || p.host, "cl-head-link")}${icon("external-link", "muted")}</h2>
            <p class="small sec">${esc(howAdded(p.source))} · ${esc(fill("added {when}", { when: COMP.ago(p.added_at) }))} · ${esc(fill("compared with {site}", { site: p.site?.host || COMP.site()?.host || "" }))}</p>
            <div id="cl-watch-state" class="cl-head-watch">${watchArea(p)}</div>
          </div>
          <div class="cl-head-acts"><button class="btn" data-cl-read="${p.id}" ${crawling(p.crawl) ? "disabled" : ""}>${icon("refresh-cw")}${t("Read now")}</button><button class="btn btn-ghost" data-cl-remove="${p.id}">${icon("trash-2")}${t("Remove")}</button></div>
        </div>
        <div id="cl-head-note">${headNote(p)}</div>
      </section>
      <h2 class="cl-section">${t("How you compare")}</h2>
      ${compareBody(p)}
      <section class="card" aria-label="${attr("Timeline")}"><div class="card-head"><h2>${t("Timeline")}</h2><span class="end small muted cl-end">${t("Ranking moves only compare two checks by the same tool, from the same place, so a change of tool never reads as a move.")}</span></div>
        <div class="cl-section-body" id="cl-timeline">${timelineBody(p)}</div></section>
      <section class="card" aria-label="${attr("Keywords")}"><div class="card-head"><h2>${t("Keywords")}</h2></div>
        <div class="cl-section-body" id="cl-keywords">${keywordsBody(p)}</div></section>
      ${pairsCard(p)}
      ${COMP.notes?.block?.({ scope: "competitor", competitorId: p.id }) || ""}`;
  }

  async function readNow(id, button) {
    if (button) button.disabled = true;
    try {
      await COMP.api("POST", `competitors/${id}/crawl?site_id=${COMP.siteId}`);
      const set = (crawl) => ({ ...(crawl || {}), status: "queued" });
      if (view.data?.id === id) { view.data.crawl = set(view.data.crawl); paintWatch(); }
      const row = (list.rows || []).find((c) => c.id === id);
      if (row) row.crawl = set(row.crawl);
      UI.toast(t("Reading its pages now. It waits 3 seconds between pages, so this can take a while."), { kind: "info" });
      watchCrawls();
    } catch (err) {
      if (button?.isConnected) button.disabled = false;
      fail(err);
    }
  }

  // ---- Tab: My competitors --------------------------------------------------------------------------
  const listTab = {
    id: "list", order: 10, label: "My competitors", icon: "crosshair",
    competitorId: null,
    init(helpers) { UI = helpers; bindEvents(); },
    async load() {
      const site = COMP.siteId;
      const [answer, found] = await Promise.all([
        COMP.api("GET", `competitors?site_id=${site}`),
        COMP.api("GET", `competitors/suggestions?site_id=${site}`).catch(() => null), // only for the empty state and the count on the tab
      ]);
      const id = listTab.competitorId;
      let detail = null;
      if (id && answer.competitors.some((c) => c.id === id)) {
        try { detail = await COMP.api("GET", `competitors/${id}/profile?site_id=${site}`); } catch (err) { fail(err); }
      }
      if (site !== COMP.siteId || listTab.competitorId !== id) return;
      list.rows = answer.competitors;
      list.site = site;
      if (found) { find.data = found; find.site = site; }
      if (!detail) listTab.competitorId = null;
      else if (view.shownId !== id) {
        // A different competitor starts at the top, with the keyboard on its name.
        Object.assign(view, { filter: "all", limit: 50, kw: "shared", sort: { key: "keyword", dir: 1 }, kwLimit: 100, shownId: id });
        pending = () => {
          const main = UI.$("#main");
          if (main) main.scrollTop = 0;
          UI.$("#cl-profile-title")?.focus({ preventScroll: true });
        };
      }
      if (!detail) view.shownId = null;
      view.data = detail;
    },
    body() {
      remember();
      if (list.site !== COMP.siteId || !list.rows) return COMP.loading();
      return listTab.competitorId && view.data ? profileBody() : listBody();
    },
    after() {
      syncBadge();
      settleFocus();
      list.flash = null;
      watchCrawls();
      if (listTab.competitorId && view.data) COMP.notes?.mount?.();
    },
  };

  // ---- Find competitors: the run ---------------------------------------------------------------------
  const runActive = (run) => run?.status === "queued" || run?.status === "running";

  function runWords(run) {
    const total = run.new_keywords || run.total || 0;
    const done = (run.checked || 0) + (run.failed || 0);
    const stay = t("You can leave this page: it carries on.");
    return {
      text: run.status === "queued" && !done ? t("Waiting to start…") : fill("Checking your keywords: {done} of {total}", { done: UI.num(done), total: UI.num(total) }),
      sub: `${run.tool ? `${fill("Using {tool}.", { tool: run.tool })} ` : ""}${run.failed ? `${many(run.failed, "{n} check failed.", "{n} checks failed.")} ` : ""}${stay}`,
      share: total ? Math.min(1, done / total) : 0,
    };
  }
  function runBanner(run) {
    const words = runWords(run);
    return `<section class="card lc-progress cl-run" id="cl-run" role="status">
      <div class="top"><span class="spin-wrap">${icon("refresh-cw", "spin")}</span><div class="lc-progress-words"><b id="cl-run-text">${esc(words.text)}</b><span class="small sec" id="cl-run-sub">${esc(words.sub)}</span></div></div>
      <div class="tray-bar"><i id="cl-run-bar" style="--p:${words.share}"></i></div>
    </section>`;
  }
  /* Only the numbers change, so focus and everything else on the page stay as they are. */
  function paintRun(run) {
    const words = runWords(run);
    const text = UI.$("#cl-run-text"), sub = UI.$("#cl-run-sub"), bar = UI.$("#cl-run-bar");
    if (text) text.textContent = words.text;
    if (sub) sub.textContent = words.sub;
    if (bar) bar.style.setProperty("--p", words.share);
  }

  function waitingNote(run, d) {
    const left = Math.max(0, d.keywords_total - d.keywords_checked);
    const saved = many(d.keywords_total, "{n} keyword saved.", "{n} keywords saved.");
    const state = !d.keywords_checked ? t("None checked yet.") : left ? many(left, "{n} is still to check.", "{n} are still to check.") : "";
    return `<section class="card cl-waiting" id="cl-waiting" aria-label="${attr("Waiting for a search tool")}">
      <div class="cl-waiting-main">
        <span class="ico">${icon("clock")}</span>
        <div class="cl-waiting-words">
          <h2>${esc(saved)} ${esc(state)} ${t("Nothing is lost.")}</h2>
          <p class="sec">${esc(say(run.stop_reason || "No search tool is connected yet. The keywords are saved, and they'll be checked once a tool's key is added in Settings."))}</p>
          <p class="small muted">${t("Free tools only. It carries on by itself when a tool is ready or free checks refill.")}</p>
        </div>
      </div>
      <div class="cl-waiting-act"><button class="btn btn-main" data-cl-settings>${icon("settings")}${t("Open Settings")}</button></div>
    </section>`;
  }

  /* A run in progress reports every 1.5 s. A list waiting for a tool is looked at less often, so it notices when a key arrives. */
  function pollRun() {
    const run = findData()?.run;
    const live = runActive(run), waiting = run?.status === "waiting";
    if (!live && !waiting) { find.polling = null; return; }
    const site = COMP.siteId;
    const key = `${site}:${run.id}:${live}`;
    if (find.polling === key) return; // one loop per run, however often the tab repaints
    find.polling = key;
    const gap = live ? 1500 : 4000;
    const tick = async () => {
      if (find.polling !== key) return;
      if (!here("find", site)) { find.polling = null; return; }
      let now;
      try { now = await COMP.api("GET", `keywords/runs/${run.id}`); } catch { setTimeout(tick, 4000); return; }
      if (find.polling !== key) return;
      if (!here("find", site)) { find.polling = null; return; }
      if (live ? runActive(now) : now.status === "waiting") {
        if (live) paintRun(now);
        setTimeout(tick, gap);
        return;
      }
      find.polling = null;
      await COMP.reload({ quiet: true });
      if (now.status === "complete" && here("find", site)) {
        const n = findData()?.suggestions?.length || 0;
        UI.toast(`${many(now.checked || 0, "{n} keyword checked.", "{n} keywords checked.")} ${many(n, "{n} suggestion to look at.", "{n} suggestions to look at.")}`);
      }
    };
    setTimeout(tick, gap);
  }

  // ---- Find competitors: the suggestions --------------------------------------------------------------
  function evidenceTable(item) {
    const rows = item.evidence || [];
    const place = (e) => `<span class="cl-cell">${COMP.pos(e.position, e.my_depth)}${e.url ? `<span class="cl-url">${COMP.link(e.url)}</span>` : ""}</span>`;
    return `<div class="cl-scroll"><table class="data cl-table"><thead><tr><th scope="col">${t("Keyword")}</th><th scope="col">${t("Their position")}</th><th scope="col">${t("Your position")}</th><th scope="col">${t("Checked with")}</th></tr></thead><tbody>
      ${rows.map((e) => `<tr>
        <td class="head-cell"><span class="kw" dir="auto">${esc(e.keyword)}</span></td>
        <td data-label="${attr("Their position")}">${place(e)}</td>
        <td data-label="${attr("Your position")}">${COMP.pos(e.my_position, e.my_depth)}</td>
        <td data-label="${attr("Checked with")}"><span class="cl-cell">${esc(engineName(e.engine))} · ${esc(e.tool || "")}<span class="second">${esc(COMP.ago(e.checked_at))}</span></span></td>
      </tr>`).join("")}</tbody></table></div>${(item.keywords || 0) > rows.length ? `<p class="help">${esc(fill("Showing the first {n}.", { n: UI.num(rows.length) }))}</p>` : ""}`;
  }

  function evidenceFold(item) {
    if (!item.evidence?.length) return "";
    const open = find.open.has(item.domain);
    return `<details class="cl-evidence" data-cl-evidence="${esc(item.domain)}" ${open ? "open" : ""}><summary>${icon("chevron-right")}${t("See the evidence")}</summary><div class="cl-evidence-body">${open ? evidenceTable(item) : ""}</div></details>`;
  }

  function sharePart(item, d) {
    const total = d.keywords_checked || d.keywords_total || 0;
    const width = Math.round((item.share ?? (total ? item.keywords / total : 0)) * 100);
    return `<div class="cl-share"><span class="small">${esc(many(total, "Ranks for {k} of {n} keyword", "Ranks for {k} of {n} keywords", { k: UI.num(item.keywords || 0) }))}</span><div class="meter cl-meter" aria-hidden="true"><i style="width:${Math.max(2, width)}%"></i></div></div>`;
  }

  function factsPart(item) {
    const fact = (label, value) => `<span>${esc(label)} <b class="tabular">${value}</b></span>`;
    return `<div class="cl-facts small sec">
      ${fact(t("Average position"), `#${esc(UI.dec(item.average_position))}`)}
      ${fact(t("Best position"), `#${UI.num(item.best_position)}`)}
      ${fact(t("In the top 3 on"), UI.num(item.top3))}
      ${fact(t("You both rank on"), UI.num(item.both_rank))}
    </div>`;
  }

  function suggestionRow(item, d) {
    const name = item.display || item.domain;
    return `<li class="cl-sug" data-cl-sug="${esc(item.domain)}">
      <div class="what">
        <div class="cl-sug-name"><span class="kw" dir="auto">${esc(name)}</span>${item.new ? `<span class="tag">${esc(tag("New|tag"))}</span>` : ""}${item.kind ? `<span class="tag">${t(item.kind === "public" ? "Public body" : "Big site")}</span>` : ""}</div>
        ${sharePart(item, d)}
        ${factsPart(item)}
      </div>
      <div class="acts"><button class="btn btn-main btn-small" data-cl-accept="${esc(item.domain)}" aria-label="${attr("Accept")}: ${esc(name)}">${t("Accept")}</button><button class="btn btn-small" data-cl-dismiss="${esc(item.domain)}" aria-label="${attr("Dismiss")}: ${esc(name)}">${t("Dismiss")}</button></div>
      ${evidenceFold(item)}
    </li>`;
  }

  function dismissedRow(item, d) {
    const name = item.display || item.domain;
    const seen = item.keywords ? sharePart(item, d) : `<div class="cl-share"><span class="small muted">${t("Not in your latest results")}</span></div>`;
    return `<li class="cl-sug" data-cl-sug="${esc(item.domain)}">
      <div class="what">
        <div class="cl-sug-name"><span class="kw" dir="auto">${esc(name)}</span><span class="small muted">${esc(fill("Dismissed {when}", { when: COMP.ago(item.dismissed_at) }))}</span></div>
        ${seen}
      </div>
      <div class="acts"><button class="btn btn-small" data-cl-restore="${esc(item.domain)}" aria-label="${attr("Restore")}: ${esc(name)}">${t("Restore")}</button></div>
      ${evidenceFold(item)}
    </li>`;
  }

  function groupCard(id, title, n, intro, rows) {
    if (!n) return "";
    return `<details class="card cl-group" data-cl-group="${id}" ${find.groups.has(id) ? "open" : ""}><summary class="card-head">${icon("chevron-right")}<h2>${t(title)}</h2><span class="tag tabular">${UI.num(n)}</span></summary>
      <p class="help cl-group-intro">${t(intro)}</p>
      <ul class="rows">${rows}</ul></details>`;
  }

  function checkedBand(d, run) {
    const bits = [d.last_check ? fill("Last checked {when}", { when: COMP.ago(d.last_check) }) : t("Not checked yet")];
    if (d.tools?.length) bits.push(d.tools.join(", "));
    bits.push(many(d.keywords_total, "{done} of {n} keyword", "{done} of {n} keywords", { done: UI.num(d.keywords_checked) }));
    const failed = run?.status === "complete" && run.failed ? many(run.failed, "{n} check failed in the last run.", "{n} checks failed in the last run.") : "";
    const rule = d.min_appearances > 1 ? fill("A domain is suggested once it appears on at least {n} keywords.", { n: UI.num(d.min_appearances) }) : "";
    const canCheck = d.keywords_checked > 0 && run?.status !== "waiting";
    return `<section class="tool-band cl-band" aria-label="${attr("Your keyword list")}">
      <p><span class="cl-band-main">${icon("clock")}<span id="cl-checked-line">${esc(bits.join(" · "))}</span></span>${failed || rule ? `<span class="small muted cl-band-sub">${esc([failed, rule].filter(Boolean).join(" "))}</span>` : ""}</p>
      <div class="cl-band-acts"><button class="btn" data-cl-upload>${icon("upload")}${t("Upload keyword list")}</button>${canCheck ? `<button class="btn" id="cl-check-again" ${runActive(run) ? "disabled" : ""}>${icon("refresh-cw")}${t("Check again")}</button>` : ""}</div>
    </section>`;
  }

  function findBody() {
    remember();
    const d = findData();
    if (!d) return COMP.loading();
    const run = d.run;
    const rule = `<p class="prospect-note">${icon("info")}<span>${t("Suggestions only. Nothing is added until you accept. Counted from search results, no AI.")}</span></p>`;
    if (!d.keywords_total && !runActive(run) && run?.status !== "waiting") {
      return `${rule}${COMP.empty(t("No keywords yet"), t("Upload your keyword list. We check who ranks for each keyword once, using free tools only, then suggest the domains that appear most often."), `<button class="btn btn-main" data-cl-upload>${icon("upload")}${t("Upload your keyword list")}</button>`)}`;
    }
    const suggestions = d.suggestions?.length
      ? `<section class="card" aria-label="${attr("Suggestions")}"><div class="card-head"><h2>${t("Suggestions")}</h2><span class="tag tabular">${UI.num(d.suggestions.length)}</span></div><ul class="rows">${d.suggestions.map((x) => suggestionRow(x, d)).join("")}</ul></section>`
      : `<section class="card"><div class="empty cl-none-big"><h3>${t(d.keywords_checked ? "No suggestions right now" : "No suggestions yet")}</h3><p>${t(d.keywords_checked ? "No other domain appears often enough on your keywords. New checks can change that." : "They appear here as soon as your keywords have been checked.")}</p></div></section>`;
    return `${rule}
      ${runActive(run) ? runBanner(run) : ""}
      ${run?.status === "waiting" ? waitingNote(run, d) : ""}
      ${checkedBand(d, run)}
      ${suggestions}
      ${groupCard("platforms", "Big sites and public bodies", d.platforms?.length || 0, "These rank for almost everything, so they're rarely real competitors. You can still accept one if you want to watch it.", (d.platforms || []).map((x) => suggestionRow(x, d)).join(""))}
      ${groupCard("dismissed", "Dismissed", d.dismissed?.length || 0, "These stay dismissed whatever new checks show, until you restore them.", (d.dismissed || []).map((x) => dismissedRow(x, d)).join(""))}`;
  }

  /* After a row leaves, the keyboard moves to the next suggestion, or the one before. */
  function nextFocus(domain) {
    const li = UI.$$("[data-cl-sug]").find((el) => el.dataset.clSug === domain);
    const near = li?.nextElementSibling?.dataset?.clSug || li?.previousElementSibling?.dataset?.clSug || null;
    return () => {
      const row = near && UI.$$("[data-cl-sug]").find((el) => el.dataset.clSug === near);
      (row?.querySelector("button") || UI.$("[data-cl-upload]"))?.focus({ preventScroll: true });
    };
  }

  async function accept(domain, button) {
    if (button) button.disabled = true;
    const site = COMP.siteId;
    const after = nextFocus(domain);
    try {
      const made = await COMP.api("POST", "competitors/suggestions/accept", { site_id: site, domain });
      find.open.delete(domain);
      pending = after;
      await refreshHere();
      addedToast(made, site);
    } catch (err) {
      if (button?.isConnected) button.disabled = false;
      fail(err);
    }
  }

  async function dismiss(domain, button) {
    if (button) button.disabled = true;
    const site = COMP.siteId;
    const after = nextFocus(domain);
    try {
      await COMP.api("POST", "competitors/suggestions/dismiss", { site_id: site, domain });
      find.open.delete(domain);
      pending = after;
      await refreshHere();
      UI.toast(fill("{host} dismissed. It won't be suggested again unless you restore it.", { host: domain }), {
        kind: "info",
        undo: async () => {
          try {
            await COMP.api("POST", "competitors/suggestions/restore", { site_id: site, domain });
            await refreshHere();
          } catch (err) { fail(err); }
        },
      });
    } catch (err) {
      if (button?.isConnected) button.disabled = false;
      fail(err);
    }
  }

  async function restore(domain, button) {
    if (button) button.disabled = true;
    const site = COMP.siteId;
    const after = nextFocus(domain);
    try {
      await COMP.api("POST", "competitors/suggestions/restore", { site_id: site, domain });
      pending = after;
      await refreshHere();
      const d = findData();
      const shown = [...(d?.suggestions || []), ...(d?.platforms || [])].some((x) => x.domain === domain);
      UI.toast(shown ? fill("{host} is back in the suggestions.", { host: domain }) : fill("{host} is no longer dismissed. It's suggested again if it shows up often enough in your results.", { host: domain }), { kind: "info" });
    } catch (err) {
      if (button?.isConnected) button.disabled = false;
      fail(err);
    }
  }

  function confirmCheck() {
    const d = findData();
    if (!d) return;
    const dlg = UI.$("#dlg");
    dlg.classList.remove("wide");
    UI.setHTML(dlg, `<div class="dlg-head"><h2 id="dlg-title">${t("Check your keywords again?")}</h2><button class="icon-btn" data-close-dlg aria-label="${attr("Close")}">${icon("x")}</button></div>
      <div class="dlg-body"><p>${esc(many(d.keywords_total, "This uses {n} check from your free tools.", "This uses {n} checks from your free tools."))}</p><p class="small sec" style="margin-top:8px">${t("It never spends paid credits. If free checks run out it stops and says so, and the rest carry on when credits refill.")}</p></div>
      <div class="dlg-foot"><button class="btn" data-close-dlg>${t("Cancel")}</button><button class="btn btn-main" data-cl-check-yes>${t("Check again")}</button></div>`);
    dlg.showModal();
    UI.$("[data-cl-check-yes]", dlg)?.focus();
  }

  async function checkAgain() {
    try {
      await COMP.api("POST", "keywords/refresh", { site_id: COMP.siteId });
      pending = () => UI.$("[data-cl-upload]")?.focus({ preventScroll: true });
      await refreshHere();
    } catch (err) {
      fail(err);
      refreshHere();
    }
  }

  /* Settings is still a mockup screen, so it's told the truth about the one tool the app can use, and its key reaches the server. */
  async function openSettings() {
    if (await COMP.isServer()) {
      try {
        const state = await COMP.api("GET", "connections/SerpApi");
        const c = window.CONNECTIONS?.find((x) => x.id === "serpapi");
        if (c) { c.status = state.connected ? "ok" : "off"; c.last4 = state.last4 || ""; }
        const tool = window.TOOLS?.find((x) => x.name === "SerpApi");
        if (tool) tool.connected = Boolean(state.connected);
      } catch { /* the panel still opens, with what it knows */ }
    }
    UI.openConnection("serpapi");
  }
  async function sendKeyToServer(e) {
    const save = e.target.closest?.("#conn-save");
    if (!save || save.dataset.id !== "serpapi") return;
    const key = UI.$("#conn-key")?.value.trim();
    if (!key || !(await COMP.isServer())) return;
    try { await COMP.api("PUT", "connections/SerpApi", { key }); } catch (err) { fail(err); }
  }

  // ---- The upload panel ----------------------------------------------------------------------------------
  const MAX_BYTES = 10 * 1024 * 1024;
  const HEADER_NAMES = new Set(["keyword", "keywords", "query", "queries", "search term", "term", "mot-clé", "mot clé", "mots-clés", "mot-cle", "requête", "requete"]);
  const LANGUAGES = "af ar az bg bn ca cs da de el en es et fa fi fil fr he hi hr hu hy id it ja ka kk ko lt lv ms nb nl pa pl pt ro ru si sk sl sq sr sv sw ta te th tr uk ur uz vi zh".split(" ");
  const ENCODINGS = [["windows-1252", "Western European"], ["windows-1256", "Arabic"], ["shift_jis", "Japanese"], ["euc-kr", "Korean"], ["gbk", "Chinese, simplified"], ["big5", "Chinese, traditional"], ["windows-1251", "Cyrillic"], ["windows-1250", "Central European"], ["windows-1253", "Greek"], ["windows-1254", "Turkish"], ["windows-1255", "Hebrew"], ["windows-874", "Thai"], ["windows-1258", "Vietnamese"]];
  const LIKELY_ENCODING = { ar: "windows-1256", fa: "windows-1256", ur: "windows-1256", ja: "shift_jis", ko: "euc-kr", zh: "gbk", ru: "windows-1251", uk: "windows-1251", bg: "windows-1251", sr: "windows-1251", kk: "windows-1251", cs: "windows-1250", sk: "windows-1250", pl: "windows-1250", hu: "windows-1250", ro: "windows-1250", hr: "windows-1250", sl: "windows-1250", sq: "windows-1250", el: "windows-1253", tr: "windows-1254", he: "windows-1255", th: "windows-874", vi: "windows-1258" };

  function languageOptions() {
    const lang = UI.state.lang === "fr" ? "fr" : "en";
    let names;
    try { names = new Intl.DisplayNames([lang], { type: "language" }); } catch { names = null; }
    return LANGUAGES
      .map((code) => { const name = names?.of(code) || code; return [code, name.charAt(0).toLocaleUpperCase(lang) + name.slice(1)]; })
      .sort((a, b) => a[1].localeCompare(b[1], lang))
      .map(([code, name]) => `<option value="${code}">${esc(name)}</option>`).join("");
  }

  /* The same reading of a list as the server: one keyword per line, or a table with a keyword column. */
  function readRows(source) {
    let text = source.replace(/^﻿/, "");
    const end = text.match(/\r\n|\r|\n/);
    const first = end ? text.slice(0, end.index) : text;
    const sep = first.trim().match(/^sep=(.)$/i);
    let delimiter = ",";
    if (sep) { delimiter = sep[1]; text = end ? text.slice(end.index + end[0].length) : ""; } else {
      const counts = { ",": 0, ";": 0, "\t": 0 };
      let quoted = false;
      for (const ch of first) { if (ch === '"') quoted = !quoted; else if (!quoted && ch in counts) counts[ch] += 1; }
      for (const d of [",", ";", "\t"]) if (counts[d] > counts[delimiter]) delimiter = d;
    }
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false; } else cell += ch;
      } else if (ch === '"' && !cell) quoted = true;
      else if (ch === delimiter) { row.push(cell); cell = ""; } else if (ch === "\r" || ch === "\n") {
        if (ch === "\r" && text[i + 1] === "\n") i += 1;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  }
  function readKeywords(source) {
    const rows = readRows(source);
    if (!rows.length) return { keywords: [], repeated: 0 };
    const at = rows[0].map((c) => c.trim().toLowerCase()).findIndex((name) => HEADER_NAMES.has(name));
    const cells = at >= 0 ? rows.slice(1).filter((r) => at < r.length).map((r) => r[at]) : rows.map((r) => r[0]);
    const seen = new Set(), keywords = [];
    let repeated = 0;
    for (const cell of cells) {
      const keyword = String(cell ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
      if (!keyword || keyword.length > 300) continue;
      const key = keyword.toLowerCase();
      if (seen.has(key)) { repeated += 1; continue; }
      seen.add(key);
      keywords.push(keyword);
    }
    return { keywords, repeated };
  }

  /* UTF-8 and "Unicode text" read by themselves. Anything else can't be told apart for sure, so the person checks the words shown, and can pick the encoding. */
  function decodeFile(bytes, encoding) {
    const utf16 = (name) => new TextDecoder(name).decode(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: utf16("utf-16le"), unicode: true, reencode: false };
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: utf16("utf-16be"), unicode: true, reencode: false };
    const head = bytes.subarray(0, 400);
    const zeros = (from) => { let n = 0; for (let i = from; i < head.length; i += 2) if (head[i] === 0) n += 1; return n; };
    if (head.length > 3 && zeros(1) > head.length / 4) return { text: utf16("utf-16le"), unicode: true, reencode: true };
    if (head.length > 3 && zeros(0) > head.length / 4) return { text: utf16("utf-16be"), unicode: true, reencode: true };
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), unicode: true, reencode: false };
    } catch {
      return { text: new TextDecoder(encoding || "windows-1252").decode(bytes), unicode: false, reencode: true };
    }
  }

  function paintUpload() {
    const count = UI.$("#cl-up-count");
    if (!count) return;
    const hasFile = Boolean(upload.file);
    UI.$("#cl-drop").classList.toggle("cl-hide", hasFile);
    UI.$("#cl-paste").classList.toggle("cl-hide", hasFile);
    const info = UI.$("#cl-file-info");
    info.classList.toggle("cl-hide", !hasFile);
    UI.$("#cl-encoding").classList.toggle("cl-hide", !hasFile || upload.unicode);
    if (hasFile) {
      const { keywords, repeated } = readKeywords(upload.text);
      const sample = keywords.slice(0, 3).map((k) => `<span class="tag cl-preview" dir="auto">${esc(k)}</span>`).join(" ");
      UI.setHTML(info, `<div class="cl-file-row">${icon("file-text")}<span class="mono small cl-file-name" dir="auto">${esc(upload.file.name)}</span><button type="button" class="link-btn" id="cl-file-remove">${t("Remove the file")}</button></div>
        <p class="small sec">${esc(many(keywords.length, "{n} keyword found", "{n} keywords found"))}${repeated ? ` · ${esc(many(repeated, "{n} repeat counted once", "{n} repeats counted once"))}` : ""}</p>
        ${sample ? `<p class="cl-previews">${sample}${keywords.length > 3 ? ` <span class="small muted">${t("and more")}</span>` : ""}</p>` : ""}`);
      return;
    }
    const { keywords, repeated } = readKeywords(UI.$("#cl-up-text")?.value || "");
    count.textContent = `${many(keywords.length, "{n} keyword", "{n} keywords")}${repeated ? ` · ${many(repeated, "{n} repeat counted once", "{n} repeats counted once")}` : ""}`;
  }

  function openUpload(opener) {
    Object.assign(upload, { file: null, bytes: null, text: "", unicode: true, reencode: false, encoding: "" });
    const site = COMP.siteId;
    UI.openPanel(`${UI.panelHead(t("Upload your keyword list"), `${t("For")} <span class="mono">${esc(COMP.site()?.host || "")}</span>`)}
      <form class="panel-body" id="cl-upload-form" novalidate>
        <div class="cl-drop" id="cl-drop">${icon("upload")}<b>${t("Drop a file here")}</b><span>${t("or")} <button type="button" class="link-btn" id="cl-file-pick" style="font-size:inherit" data-autofocus>${t("choose a file")}</button></span><span class="small muted">${t(".csv or .txt, in any encoding, up to 10 MB.")}</span><input type="file" id="cl-file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden></div>
        <div id="cl-file-info" class="cl-file-info cl-hide"></div>
        <div id="cl-file-error"></div>
        <label class="field cl-hide" id="cl-encoding"><span>${t("This file isn't saved as Unicode. If the words above look wrong, choose its encoding.")}</span><select class="select" id="cl-up-encoding" style="width:100%">${ENCODINGS.map(([id, name]) => `<option value="${id}">${t(name)}</option>`).join("")}</select></label>
        <label class="field" id="cl-paste"><span>${t("Or paste your keywords, one per line")}</span><textarea class="input cl-paste-box" id="cl-up-text" rows="7" dir="auto" spellcheck="false" aria-describedby="cl-up-count cl-up-error"></textarea><div class="help" id="cl-up-count" aria-live="polite"></div><div id="cl-up-error"></div></label>
        <div class="field-row">
          <label class="field"><span>${t("Country")}</span><select class="select" id="cl-up-country" style="width:100%"><option value="">${t("Any country")}</option>${UI.countryOptions("")}</select></label>
          <label class="field"><span>${t("Language")}</span><select class="select" id="cl-up-language" style="width:100%"><option value="">${t("Any language")}</option>${languageOptions()}</select></label>
        </div>
        <div id="cl-up-market-error"></div>
        <p class="note">${icon("info")}<span>${t("Free tools only. It never spends paid credits. If free checks run out it stops and says so, and the rest carry on when credits refill.")}</span></p>
      </form>
      <div class="panel-foot"><button class="btn btn-main" id="cl-up-save">${t("Save and check")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener, { key: `cl-upload|${site}`, reopen: () => openUpload(opener), after: paintUpload });
  }

  async function pickFile(file) {
    if (!file) return;
    const box = UI.$("#cl-file-error");
    if (box) box.replaceChildren();
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) { fieldError(null, box, t("Choose a .csv or .txt file.")); return; }
    if (file.size > MAX_BYTES) { fieldError(null, box, t("That file is too big. The limit is 10 MB.")); return; }
    upload.file = file;
    upload.bytes = new Uint8Array(await file.arrayBuffer());
    upload.encoding = LIKELY_ENCODING[UI.$("#cl-up-language")?.value] || "windows-1252";
    decodeNow();
    UI.$("#cl-file-remove")?.focus();
  }
  function decodeNow() {
    const read = decodeFile(upload.bytes, upload.encoding);
    Object.assign(upload, read);
    const select = UI.$("#cl-up-encoding");
    if (select) select.value = upload.encoding;
    paintUpload();
  }
  function forgetFile() {
    Object.assign(upload, { file: null, bytes: null, text: "", unicode: true, reencode: false, encoding: "" });
    const input = UI.$("#cl-file");
    if (input) input.value = "";
    paintUpload();
    UI.$("#cl-file-pick")?.focus();
  }

  async function submitUpload() {
    const save = UI.$("#cl-up-save");
    if (!save || save.disabled) return;
    const area = UI.$("#cl-up-text"), textBox = UI.$("#cl-up-error"), fileBox = UI.$("#cl-file-error"), marketBox = UI.$("#cl-up-market-error");
    fieldClear(area, textBox);
    fileBox.replaceChildren();
    marketBox.replaceChildren();
    const site = COMP.siteId;
    const country = UI.$("#cl-up-country").value, language = UI.$("#cl-up-language").value;
    if (upload.file ? !readKeywords(upload.text).keywords.length : !readKeywords(area.value).keywords.length) {
      const message = t("No keywords found. Put one keyword on each line, or use a column named keyword.");
      if (upload.file) fieldError(null, fileBox, message); else fieldError(area, textBox, upload.file || area.value.trim() ? message : t("Choose a file, or paste your keywords."));
      return;
    }
    save.disabled = true;
    try {
      let run;
      if (upload.file) {
        const form = new FormData();
        form.append("site_id", String(site));
        form.append("country", country);
        form.append("language", language);
        // What the person checked on screen is what gets saved, whatever the file's encoding was.
        form.append("file", upload.reencode ? new File([upload.text], upload.file.name, { type: "text/plain" }) : upload.file, upload.file.name);
        run = await COMP.api("POST", "keywords/upload", undefined, { form });
      } else {
        run = await COMP.api("POST", "keywords/upload", { site_id: site, text: area.value, country, language });
      }
      UI.forgetPanelForm();
      UI.closePanel({ keep: false });
      Object.assign(upload, { file: null, bytes: null, text: "" });
      pending = () => UI.$("[data-cl-upload]")?.focus({ preventScroll: true });
      if (COMP.tab !== "find") COMP.open("find"); else await refreshHere();
      if (run.status === "complete" && !run.new_keywords) UI.toast(many(run.total, "This keyword was already checked, so nothing new was searched.", "These {n} keywords were already checked, so nothing new was searched."), { kind: "info" });
      else UI.toast(many(run.total, "{n} keyword saved.", "{n} keywords saved."));
    } catch (err) {
      const message = say(err.message);
      if (/country|language/i.test(err.message)) fieldError(null, marketBox, message);
      else if (upload.file) fieldError(null, fileBox, message);
      else fieldError(area, textBox, message);
    } finally {
      if (save.isConnected) save.disabled = false;
    }
  }

  // ---- Tab: Find competitors ---------------------------------------------------------------------------------
  const findTab = {
    id: "find", order: 20, label: "Find competitors", icon: "target",
    async load() {
      const site = COMP.siteId;
      const answer = await COMP.api("GET", `competitors/suggestions?site_id=${site}`);
      if (site === COMP.siteId) { find.data = answer; find.site = site; }
    },
    body: findBody,
    after() {
      syncBadge();
      settleFocus();
      pollRun();
    },
    // Only domains seen for the first time this week: a long-standing list isn't news.
    badge() { return findData()?.suggestions?.filter((x) => x.new).length || 0; },
  };

  COMP.addTab(listTab);
  COMP.addTab(findTab);

  // ---- events --------------------------------------------------------------------------------------------------
  function bindEvents() {
    if (bound) return;
    bound = true;

    // Pressing a tab always shows its first screen. Focus stays on the tab, for keyboard use.
    document.addEventListener("click", (e) => {
      const tabButton = e.target.closest?.("[data-comp-tab]");
      if (tabButton?.dataset.compTab === "list") listTab.competitorId = null;
      sendKeyToServer(e);
    }, true);

    document.addEventListener("click", (e) => {
      if (performance.now() < ignoreUntil) return;
      const hit = (sel) => e.target.closest?.(sel);
      let el;

      // My competitors
      if (hit("#cl-add-open")) { openAdd(hit("#cl-add-open")); return; }
      if (hit("#cl-add-save")) { submitAdd(); return; }
      if (hit("[data-cl-go-find]")) { COMP.open("find"); pending = () => UI.$("[data-cl-upload]")?.focus({ preventScroll: true }); return; }
      if ((el = hit("[data-cl-remove-yes]"))) { const id = Number(el.dataset.clRemoveYes); UI.$("#dlg").close(); hold(); removeNow(id); return; }
      if ((el = hit("[data-cl-remove]"))) { confirmRemove(Number(el.dataset.clRemove)); return; }
      if ((el = hit("[data-cl-open]"))) { openProfile(Number(el.dataset.clOpen)); return; }
      if ((el = hit("[data-cl-row]")) && !hit("a, button, input, select, textarea, summary, label")) { openProfile(Number(el.dataset.clRow)); return; }

      // The profile
      if (hit("[data-cl-back]")) { backToList(); return; }
      if ((el = hit("[data-cl-read]"))) { readNow(Number(el.dataset.clRead), el); return; }
      if ((el = hit("[data-cl-tl]"))) {
        const id = el.dataset.clTl;
        view.filter = id;
        view.limit = 50;
        paintTimeline(() => focusAttr("data-cl-tl", id)?.focus({ preventScroll: true }));
        return;
      }
      if (hit("[data-cl-tl-more]")) {
        view.limit += 50;
        paintTimeline(() => (UI.$("[data-cl-first-new]") || UI.$("[data-cl-tl-more]"))?.focus());
        return;
      }
      if ((el = hit("[data-cl-kw]"))) {
        const id = el.dataset.clKw;
        view.kw = id;
        view.kwLimit = 100;
        view.sort = { key: "keyword", dir: 1 };
        paintKeywords(() => focusAttr("data-cl-kw", id)?.focus({ preventScroll: true }));
        return;
      }
      if ((el = hit("[data-cl-sort]"))) {
        const key = el.dataset.clSort;
        view.sort = view.sort.key === key ? { key, dir: -view.sort.dir } : { key, dir: key === "checked_at" || key === "last_seen" ? -1 : 1 };
        paintKeywords(() => focusAttr("data-cl-sort", key)?.focus({ preventScroll: true }));
        return;
      }
      if (hit("[data-cl-kw-more]")) {
        view.kwLimit += 100;
        paintKeywords(() => UI.$("[data-cl-kw-more]")?.focus({ preventScroll: true }));
        return;
      }
      if ((el = hit("[data-cl-pair]"))) { COMP.open("pairs", { openPairId: Number(el.dataset.clPair) }); return; }

      // Find competitors
      if ((el = hit("[data-cl-upload]"))) { openUpload(el); return; }
      if (hit("#cl-up-save")) { submitUpload(); return; }
      if (hit("#cl-file-pick")) { UI.$("#cl-file")?.click(); return; }
      if (hit("#cl-file-remove")) { forgetFile(); return; }
      if ((el = hit("[data-cl-accept]"))) { accept(el.dataset.clAccept, el); return; }
      if ((el = hit("[data-cl-dismiss]"))) { dismiss(el.dataset.clDismiss, el); return; }
      if ((el = hit("[data-cl-restore]"))) { restore(el.dataset.clRestore, el); return; }
      if (hit("[data-cl-settings]")) { openSettings(); return; }
      if (hit("#cl-check-again")) { confirmCheck(); return; }
      if (hit("[data-cl-check-yes]")) { UI.$("#dlg").close(); hold(); checkAgain(); }
    });

    document.addEventListener("input", (e) => { if (e.target.id === "cl-up-text") { fieldClear(e.target, UI.$("#cl-up-error")); paintUpload(); } });
    document.addEventListener("input", (e) => { if (e.target.id === "cl-add-address") fieldClear(e.target, UI.$("#cl-add-error")); });
    document.addEventListener("change", (e) => {
      if (e.target.id === "cl-file") pickFile(e.target.files[0]);
      else if (e.target.id === "cl-up-encoding" && upload.bytes) { upload.encoding = e.target.value; decodeNow(); }
      else if (e.target.id === "cl-up-language" && upload.bytes && !upload.unicode && LIKELY_ENCODING[e.target.value]) { upload.encoding = LIKELY_ENCODING[e.target.value]; decodeNow(); }
    });
    document.addEventListener("submit", (e) => { if (e.target.id === "cl-add-form") { e.preventDefault(); submitAdd(); } });

    // A dropped file goes in the same way as a chosen one.
    ["dragover", "dragenter"].forEach((name) => document.addEventListener(name, (e) => { const box = e.target.closest?.(".cl-drop"); if (box) { e.preventDefault(); box.classList.add("over"); } }));
    document.addEventListener("dragleave", (e) => { const box = e.target.closest?.(".cl-drop"); if (box && !box.contains(e.relatedTarget)) box.classList.remove("over"); });
    document.addEventListener("drop", (e) => { const box = e.target.closest?.(".cl-drop"); if (box) { e.preventDefault(); box.classList.remove("over"); pickFile(e.dataTransfer.files[0]); } });

    // Folds remember being open, and an evidence table is only drawn when asked for: a long list stays quick.
    document.addEventListener("toggle", (e) => {
      const fold = e.target;
      if (fold.dataset?.clGroup) { if (fold.open) find.groups.add(fold.dataset.clGroup); else find.groups.delete(fold.dataset.clGroup); return; }
      const domain = fold.dataset?.clEvidence;
      if (!domain) return;
      if (fold.open) find.open.add(domain); else find.open.delete(domain);
      const inner = fold.querySelector(".cl-evidence-body");
      if (fold.open && inner && !inner.firstChild) {
        const d = findData();
        const item = [...(d?.suggestions || []), ...(d?.platforms || []), ...(d?.dismissed || [])].find((x) => x.domain === domain);
        if (item) UI.setHTML(inner, evidenceTable(item));
      }
    }, true);
  }

  // ---- The sample: writes change COMP_SAMPLE.get in place, so screens update as they would for real -------------
  const SAMPLE = () => window.COMP_SAMPLE.get;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const findKey = (site) => `competitors/suggestions?site_id=${site}`;
  const listKey = (site) => `competitors?site_id=${site}`;
  const profileKey = (id, site) => `competitors/${id}/profile?site_id=${site}`;
  const refuse = (message, status = 400) => { const err = new Error(message); err.status = status; throw err; };
  const round1 = (n) => Math.round(n * 10) / 10;
  const FIRST = {
    small: clone(SAMPLE()[findKey(window.COMP_SAMPLE.sites?.["site-two.example"] ?? 2)]),
    emptyFind: clone(SAMPLE()[findKey(window.COMP_SAMPLE.empty_site_id)]),
  };
  const parked = new Map(); // what a removed competitor had, for when it comes back
  let nextId = 900, nextRun = 900;

  const sampleFind = (site) => (SAMPLE()[findKey(site)] ||= clone(FIRST.emptyFind));
  const sampleList = (site) => (SAMPLE()[listKey(site)] ||= { competitors: [] });
  const sampleProfiles = (site = null) => Object.keys(SAMPLE()).filter((k) => /^competitors\/\d+\/profile\?/.test(k) && (site === null || k.endsWith(`site_id=${site}`))).map((k) => SAMPLE()[k]);
  const sampleOwnHost = (site) => SAMPLE()["links/sites"].sites.find((s) => s.id === site)?.host || "";
  const orderItems = (items) => items.sort((a, b) => b.keywords - a.keywords || a.average_position - b.average_position || a.domain.localeCompare(b.domain));

  function sampleHost(raw) {
    if (/\s/.test(raw)) return "";
    let url;
    try { url = new URL(raw.includes("://") ? raw : `https://${raw}`); } catch { return ""; }
    if (!/^https?:$/.test(url.protocol) || url.username) return "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const labels = host.split(".");
    return labels.length > 1 && labels.every(Boolean) && labels[labels.length - 1].length >= 2 && !/^\d+$/.test(labels[labels.length - 1]) ? host : "";
  }

  function setCrawl(host, patch) {
    for (const key of Object.keys(SAMPLE())) {
      if (/^competitors\?site_id=/.test(key)) SAMPLE()[key].competitors.filter((c) => c.host === host).forEach((c) => { c.crawl = { ...c.crawl, ...patch }; });
      else if (/^competitors\/\d+\/profile\?/.test(key) && SAMPLE()[key].host === host) SAMPLE()[key].crawl = { ...SAMPLE()[key].crawl, ...patch };
    }
  }
  /* A read takes a few seconds here. A site that blocks stays blocked, as it would for real. */
  function simulateRead(host, fresh = false) {
    const wasBlocked = sampleProfiles().some((p) => p.host === host && p.crawl?.status === "blocked");
    setCrawl(host, { status: "queued" });
    setTimeout(() => setCrawl(host, { status: "running", started_at: stamp(), pages_read: 0 }), 900);
    setTimeout(() => {
      if (wasBlocked) { setCrawl(host, { status: "blocked", finished_at: stamp(), message: BLOCKED_TEXT, pages_known: 0, pages_read: 0 }); return; }
      const known = sampleProfiles().find((p) => p.host === host)?.compare?.pages?.theirs?.pages;
      const pages = known || 12;
      setCrawl(host, { status: "ok", baseline_done: true, finished_at: stamp(), message: null, pages_known: pages, pages_read: pages });
      if (fresh) {
        sampleProfiles().filter((p) => p.host === host).forEach((p) => { p.compare.pages.theirs = { pages, average_words: 640, new_pages_30d: 0, last_changed: null }; });
      }
    }, 3000);
  }

  /* What I know about my own rankings on this site, from the competitors it already has. */
  function myRankings(site) {
    const mine = new Map();
    sampleProfiles(site).forEach((p) => p.keywords.forEach((k) => { if (k.my_position !== null && !mine.has(k.keyword)) mine.set(k.keyword, k); }));
    return mine;
  }

  function sampleProfile(site, id, host, source, item) {
    const seen = sampleProfiles().find((p) => p.host === host);
    const mine = myRankings(site);
    const own = sampleOwnHost(site);
    const evidence = item?.evidence || [];
    const rows = evidence.map((e) => ({
      keyword: e.keyword, country: e.location, engine: e.engine, tool: e.tool, location: e.location, depth: e.my_depth, checked_at: e.checked_at,
      my_position: e.my_position, my_url: e.my_position === null ? null : mine.get(e.keyword)?.my_url || `https://${own}/`,
      their_position: e.position, their_url: e.url, status: e.my_position === null ? "theirs_only" : "shared",
    }));
    const covered = new Set(rows.map((r) => r.keyword));
    mine.forEach((k, keyword) => { if (!covered.has(keyword)) rows.push({ ...k, their_position: null, their_url: null, status: "mine_only" }); });
    rows.sort((a, b) => ({ shared: 0, theirs_only: 1, mine_only: 2 }[a.status] - { shared: 0, theirs_only: 1, mine_only: 2 }[b.status]) || a.keyword.localeCompare(b.keyword));
    const shared = rows.filter((r) => r.status === "shared");
    const average = (list) => (list.length ? round1(list.reduce((sum, n) => sum + n, 0) / list.length) : null);
    const anyHere = sampleProfiles(site)[0];
    return {
      id, host, display: host, domain: host, source, added_at: stamp(), site: { id: site, host: own }, crawl: { status: "queued", pages_known: 0, pages_read: 0, message: null, baseline_done: false, started_at: null, finished_at: null },
      compare: {
        shared: shared.length, they_ahead: shared.filter((r) => r.their_position < r.my_position).length, i_ahead: shared.filter((r) => r.my_position < r.their_position).length, level: shared.filter((r) => r.my_position === r.their_position).length,
        theirs_only: rows.filter((r) => r.status === "theirs_only").length, mine_only: rows.filter((r) => r.status === "mine_only").length,
        my_average: average(shared.map((r) => r.my_position)), their_average: average(shared.map((r) => r.their_position)),
        ai_cited_me: anyHere?.compare?.ai_cited_me || 0, ai_cited_them: 0, ai_overviews: anyHere?.compare?.ai_overviews || 0,
        pages: { mine: anyHere?.compare?.pages?.mine || { pages: 0, average_words: null, new_pages_30d: 0, last_changed: null }, theirs: seen?.compare?.pages?.theirs || { pages: 0, average_words: null, new_pages_30d: 0, last_changed: null } },
      },
      keywords: rows, past_keywords: [], timeline: seen ? seen.timeline.filter((e) => !e.kind.startsWith("rank_") && !e.kind.startsWith("ai_")) : [], pairs: [],
    };
  }

  function sampleAdd(site, address, source) {
    const raw = String(address ?? "").trim();
    if (!raw) refuse("Enter the competitor's address.");
    const host = sampleHost(raw);
    if (!host) refuse("That doesn't look like a website address.");
    if (SAMPLE()["links/sites"].sites.some((s) => s.host === host)) refuse(`${host} is part of your own websites, so it can't be a competitor.`);
    const rows = sampleList(site).competitors;
    if (rows.some((c) => c.host === host)) refuse(`${host} is already one of this website's competitors.`, 409);
    const answer = sampleFind(site);
    let item = null;
    for (const group of ["suggestions", "platforms", "dismissed"]) {
      const at = answer[group].findIndex((x) => x.domain === host);
      if (at >= 0) item = answer[group].splice(at, 1)[0];
    }
    const memo = parked.get(`${site}|${host}`);
    if (memo) {
      parked.delete(`${site}|${host}`);
      rows.push({ ...memo.row, source, added_at: stamp() });
      if (memo.pairs?.length) (SAMPLE()[`page-pairs?site_id=${site}`] ||= { pairs: [] }).pairs.push(...memo.pairs);
      const profile = SAMPLE()[profileKey(memo.row.id, site)];
      if (profile) { profile.source = source; profile.added_at = stamp(); profile.pairs = memo.profilePairs || profile.pairs; }
      memo.item ||= item;
    } else {
      const seen = sampleProfiles().find((p) => p.host === host);
      const id = seen?.id ?? nextId++;
      const profile = (SAMPLE()[profileKey(id, site)] ||= sampleProfile(site, id, host, source, item));
      profile.crawl = seen?.crawl ? { ...seen.crawl } : profile.crawl;
      SAMPLE()[`notes?competitor_id=${id}`] ||= { notes: [] };
      SAMPLE()[`sites/${id}/pages`] ||= { pages: [] };
      rows.push({ id, host, display: host, source, added_at: stamp(), shared: profile.compare.shared, they_ahead: profile.compare.they_ahead, i_ahead: profile.compare.i_ahead, theirs_only: profile.compare.theirs_only, edits_30d: profile.timeline.length, crawl: profile.crawl });
      parked.set(`item|${site}|${host}`, item);
      simulateRead(host, !seen);
      rows.sort((a, b) => b.shared + b.theirs_only - (a.shared + a.theirs_only) || a.host.localeCompare(b.host));
      return { id, host, source };
    }
    const row = rows[rows.length - 1];
    rows.sort((a, b) => b.shared + b.theirs_only - (a.shared + a.theirs_only) || a.host.localeCompare(b.host));
    simulateRead(host);
    return { id: row.id, host, source };
  }

  function itemFromProfile(p, total) {
    const evidence = p.keywords.filter((k) => k.their_position !== null).map((k) => ({ keyword: k.keyword, position: k.their_position, url: k.their_url, engine: k.engine, tool: k.tool, location: k.location, my_position: k.my_position, my_depth: k.depth, checked_at: k.checked_at })).sort((a, b) => a.position - b.position || a.keyword.localeCompare(b.keyword));
    if (!evidence.length) return null;
    const places = evidence.map((e) => e.position);
    return {
      domain: p.host, display: p.display || p.host, keywords: evidence.length, share: Math.round((evidence.length / Math.max(1, total)) * 1000) / 1000, average_position: round1(places.reduce((sum, n) => sum + n, 0) / places.length),
      best_position: Math.min(...places), top3: places.filter((n) => n <= 3).length, both_rank: evidence.filter((e) => e.my_position !== null).length, engines: [...new Set(evidence.map((e) => e.engine))], kind: null, new: false, first_seen: p.added_at, evidence,
    };
  }

  function sampleRemove(site, id) {
    const rows = sampleList(site).competitors;
    const at = rows.findIndex((c) => c.id === id);
    if (at < 0) refuse("That competitor isn't on this website.", 404);
    const [row] = rows.splice(at, 1);
    const pairsAnswer = SAMPLE()[`page-pairs?site_id=${site}`];
    const pairs = pairsAnswer?.pairs?.filter((x) => x.competitor_id === id) || [];
    if (pairsAnswer) pairsAnswer.pairs = pairsAnswer.pairs.filter((x) => x.competitor_id !== id);
    const profile = SAMPLE()[profileKey(id, site)];
    parked.set(`${site}|${row.host}`, { row, pairs, profilePairs: profile?.pairs });
    if (profile) profile.pairs = [];
    // It can be suggested again, as it would be for real: the numbers come from search results, not from being on the list.
    const answer = sampleFind(site);
    const item = parked.get(`item|${site}|${row.host}`) || (profile && itemFromProfile(profile, answer.keywords_checked));
    if (item && !answer.dismissed.some((x) => x.domain === row.host) && item.keywords >= answer.min_appearances) {
      const group = item.kind ? answer.platforms : answer.suggestions;
      group.push(item);
      orderItems(group);
    }
    return { ok: true };
  }

  function sampleDecide(action, site, domain) {
    const clean = String(domain ?? "").trim().toLowerCase();
    if (!sampleHost(clean)) refuse("That doesn't look like a website's domain.");
    const answer = sampleFind(site);
    if (action === "accept") return sampleAdd(site, clean, "suggested");
    if (action === "dismiss") {
      let item = null;
      for (const group of ["suggestions", "platforms"]) {
        const at = answer[group].findIndex((x) => x.domain === clean);
        if (at >= 0) item = answer[group].splice(at, 1)[0];
      }
      if (!answer.dismissed.some((x) => x.domain === clean)) answer.dismissed.push({ ...(item || { domain: clean, display: clean, keywords: 0, evidence: [] }), dismissed_at: stamp() });
      return { ok: true };
    }
    const at = answer.dismissed.findIndex((x) => x.domain === clean);
    if (at >= 0) {
      const [item] = answer.dismissed.splice(at, 1);
      delete item.dismissed_at;
      if (item.keywords >= answer.min_appearances && item.keywords) {
        const group = item.kind ? answer.platforms : answer.suggestions;
        group.push(item);
        orderItems(group);
      }
    }
    return { ok: true };
  }

  /* An uploaded list on a site with nothing yet gets the small site's answers, under the keywords just uploaded. */
  function answersFor(names, site) {
    const source = clone(FIRST.small);
    const all = [...source.suggestions, ...source.platforms];
    const originals = [...new Set(all.flatMap((x) => x.evidence.map((e) => e.keyword)))];
    const rename = new Map(originals.map((name, i) => [name, names[i % names.length]]));
    const at = stamp();
    all.forEach((item) => {
      const seen = new Set();
      item.evidence = item.evidence.filter((e) => {
        const name = rename.get(e.keyword);
        if (seen.has(name)) return false;
        seen.add(name);
        e.keyword = name;
        e.checked_at = at;
        return true;
      });
      const places = item.evidence.map((e) => e.position);
      Object.assign(item, { keywords: item.evidence.length, share: Math.round((item.evidence.length / names.length) * 1000) / 1000, average_position: round1(places.reduce((sum, n) => sum + n, 0) / places.length), best_position: Math.min(...places), top3: places.filter((n) => n <= 3).length, new: true, first_seen: at });
    });
    const least = names.length >= 5 ? 2 : 1;
    const taken = new Set(sampleList(site).competitors.map((c) => c.host));
    const keep = (items) => orderItems(items.filter((x) => x.keywords >= least && !taken.has(x.domain)));
    return { suggestions: keep(source.suggestions), platforms: keep(source.platforms), min_appearances: least, last_check: at, tools: ["SerpApi"], engines: ["google"], keywords_total: names.length, keywords_checked: names.length, keywords_waiting: 0 };
  }

  function simulateRun(site, run, done) {
    const patch = (values) => {
      Object.assign(SAMPLE()[`keywords/runs/${run.id}`], values);
      const answer = sampleFind(site);
      if (answer.run?.id === run.id) Object.assign(answer.run, values);
    };
    const steps = 8;
    let step = 0;
    const tick = () => {
      step += 1;
      patch({ status: "running", tool: "SerpApi", checked: Math.min(run.new_keywords, Math.ceil((run.new_keywords * step) / steps)) });
      if (step < steps) { setTimeout(tick, 500); return; }
      patch({ status: "complete", finished_at: stamp() });
      done();
    };
    setTimeout(tick, 400);
  }

  function startSampleRun(site, values) {
    const run = { id: nextRun++, site_id: site, file_name: null, engine: "google", kind: "upload", status: "queued", stop_reason: null, total: 0, new_keywords: 0, checked: 0, failed: 0, tool: null, created_at: stamp(), finished_at: null, ...values };
    SAMPLE()[`keywords/runs/${run.id}`] = run;
    sampleFind(site).run = { ...run };
    return run;
  }

  async function sampleUpload(body, opts) {
    const form = opts?.form;
    const site = Number(form ? form.get("site_id") : body?.site_id);
    const country = String((form ? form.get("country") : body?.country) || "");
    const language = String((form ? form.get("language") : body?.language) || "");
    if (country && !/^[A-Za-z]{2}$/.test(country)) refuse("The country must be a two-letter code, such as FR.");
    if (language && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(language)) refuse("The language must be a code, such as fr.");
    const file = form?.get("file");
    const source = file ? decodeFile(new Uint8Array(await file.arrayBuffer())).text : String(body?.text || "");
    const names = readKeywords(source).keywords;
    if (!names.length) refuse("No keywords found. Put one keyword on each line, or use a column named keyword.");
    if (names.length > 20000) refuse(`That's ${names.length} keywords. The limit for one list is 20000.`);
    const answer = sampleFind(site);
    const known = new Set([...answer.suggestions, ...answer.platforms, ...answer.dismissed].flatMap((x) => (x.evidence || []).map((e) => e.keyword)));
    sampleProfiles(site).forEach((p) => p.keywords.forEach((k) => known.add(k.keyword)));
    const fresh = names.filter((name) => !known.has(name));
    const wasEmpty = !answer.keywords_total;
    if (!fresh.length) {
      const run = startSampleRun(site, { file_name: file?.name || null, total: names.length, status: "complete", finished_at: stamp() });
      return clone(run);
    }
    answer.keywords_total += fresh.length;
    answer.keywords_waiting = answer.keywords_total - answer.keywords_checked;
    const run = startSampleRun(site, { file_name: file?.name || null, total: names.length, new_keywords: fresh.length });
    simulateRun(site, run, () => {
      if (wasEmpty) Object.assign(answer, answersFor(names, site));
      else Object.assign(answer, { keywords_checked: answer.keywords_checked + fresh.length, keywords_waiting: 0, last_check: stamp(), tools: answer.tools?.length ? answer.tools : ["SerpApi"], engines: answer.engines?.length ? answer.engines : ["google"] });
    });
    return clone(run);
  }

  function sampleRefresh(body) {
    const site = Number(body?.site_id);
    const answer = sampleFind(site);
    if (!answer.keywords_total) refuse("Upload your keyword list first.");
    if (runActive(answer.run)) refuse("A check of this website's keywords is already running.", 409);
    const run = startSampleRun(site, { kind: "refresh", total: answer.keywords_total, new_keywords: answer.keywords_total });
    simulateRun(site, run, () => {
      const at = stamp();
      Object.assign(answer, { last_check: at, keywords_checked: answer.keywords_total, keywords_waiting: 0, tools: answer.tools?.length ? answer.tools : ["SerpApi"] });
      [...answer.suggestions, ...answer.platforms, ...answer.dismissed].forEach((x) => (x.evidence || []).forEach((e) => { e.checked_at = at; }));
    });
    return clone(run);
  }

  COMP.sampleWrite("POST competitors", (match, body) => sampleAdd(Number(body?.site_id), body?.address, "manual"));
  COMP.sampleWrite("DELETE competitors/(\\d+)\\?site_id=(\\d+)", (match) => sampleRemove(Number(match[2]), Number(match[1])));
  COMP.sampleWrite("POST competitors/suggestions/(accept|dismiss|restore)", (match, body) => sampleDecide(match[1], Number(body?.site_id), body?.domain));
  COMP.sampleWrite("POST competitors/(\\d+)/crawl\\?site_id=(\\d+)", (match) => {
    const row = sampleList(Number(match[2])).competitors.find((c) => c.id === Number(match[1]));
    if (!row) refuse("That competitor isn't on this website.", 404);
    simulateRead(row.host);
    return { ok: true };
  });
  COMP.sampleWrite("POST keywords/upload", (match, body, opts) => sampleUpload(body, opts));
  COMP.sampleWrite("POST keywords/refresh", (match, body) => sampleRefresh(body));

  // ---- French ------------------------------------------------------------------------------------------------------
  Object.assign(window.FR, {
    // Words that change with where they sit
    "New|tag": "Nouveau",
    "Removed|pages": "Retirées",

    // Tabs and the list
    "My competitors": "Mes concurrents",
    "Find competitors": "Trouver des concurrents",
    "No competitors yet": "Aucun concurrent pour l'instant",
    "{n} suggestion is waiting in Find competitors. Accept it, or add a competitor by hand.": "{n} suggestion attend dans Trouver des concurrents. Acceptez-la, ou ajoutez un concurrent à la main.",
    "{n} suggestions are waiting in Find competitors. Accept one, or add a competitor by hand.": "{n} suggestions attendent dans Trouver des concurrents. Acceptez-en une, ou ajoutez un concurrent à la main.",
    "Upload your keyword list in Find competitors to see who really ranks against you, or add a competitor by hand.": "Importez votre liste de mots-clés dans Trouver des concurrents pour voir qui se classe vraiment face à vous, ou ajoutez un concurrent à la main.",
    "Add one by hand": "En ajouter un à la main",
    "Add a competitor": "Ajouter un concurrent",
    "You're watching {n} competitor for {site}. Open it to see everything about it.": "Vous suivez {n} concurrent pour {site}. Ouvrez-le pour tout voir à son sujet.",
    "You're watching {n} competitors for {site}. Open one to see everything about it.": "Vous suivez {n} concurrents pour {site}. Ouvrez-en un pour tout voir à son sujet.",
    "Competitor": "Concurrent",
    "Shared keywords": "Mots-clés partagés",
    "They're ahead on": "Ils sont devant sur",
    "You're ahead on": "Vous êtes devant sur",
    "Only they rank on": "Eux seuls se classent sur",
    "Edits in 30 days": "Modifications en 30 jours",
    "Watching": "Suivi",
    "Last read {when}": "Dernière lecture {when}",
    "Reading now": "Lecture en cours",
    "{n} page read so far": "{n} page lue pour l'instant",
    "{n} pages read so far": "{n} pages lues pour l'instant",
    "Waiting to read": "En attente de lecture",
    "Blocked": "Bloqué",
    "Last read failed": "Dernière lecture échouée",
    "It tries again at the next daily read.": "Nouvel essai à la prochaine lecture quotidienne.",
    "Not read yet": "Pas encore lu",
    "From a suggestion": "Depuis une suggestion",
    "Added by hand": "Ajouté à la main",
    "Edits can't be tracked on this site.": "Les modifications de ce site ne peuvent pas être suivies.",
    "This site doesn't allow automated visitors, so its edits can't be tracked. The app doesn't try to get past that.": "Ce site n'autorise pas les visiteurs automatisés, donc ses modifications ne peuvent pas être suivies. L'application n'essaie pas de contourner ce choix.",

    // Add and remove
    "For": "Pour",
    "Its website address": "Adresse de son site",
    "The app reads its public pages slowly and follows its rules for automated visitors. If the site says no, it says so here and doesn't try to get past it.": "L'application lit ses pages publiques lentement et respecte ses règles pour les visiteurs automatisés. Si le site refuse, elle l'indique ici et n'essaie pas de contourner ce choix.",
    "Enter the competitor's address.": "Saisissez l'adresse du concurrent.",
    "{host} is now one of your competitors.": "{host} fait maintenant partie de vos concurrents.",
    "{host} is no longer one of your competitors.": "{host} ne fait plus partie de vos concurrents.",
    "Remove {host}?": "Retirer {host} ?",
    "It stops being compared with {site}. Its data is kept, so nothing is lost if you add it back.": "Il n'est plus comparé à {site}. Ses données sont conservées : rien n'est perdu si vous le rajoutez.",
    "Its page pairs on this website are removed. Automatic ones come back if you add it again.": "Ses paires de pages sur ce site sont retirées. Les paires automatiques reviennent si vous le rajoutez.",
    "Removed. Its data is kept.": "Retiré. Ses données sont conservées.",
    "That doesn't look like a website address.": "Cela ne ressemble pas à une adresse de site.",
    "That doesn't look like a website's domain.": "Cela ne ressemble pas au domaine d'un site.",
    "That address isn't a public website.": "Cette adresse n'est pas un site public.",
    "That competitor isn't on this website.": "Ce concurrent n'est pas rattaché à ce site.",
    "Enter the website's address.": "Saisissez l'adresse du site.",

    // The profile
    "Back to competitors": "Retour aux concurrents",
    "added {when}": "ajouté {when}",
    "compared with {site}": "comparé à {site}",
    "Read now": "Lire maintenant",
    "Reading its pages now. It waits 3 seconds between pages, so this can take a while.": "Lecture de ses pages en cours. Elle attend 3 secondes entre chaque page, cela peut donc prendre un moment.",
    "Everything from search results still works: rankings, AI Overviews and shared keywords.": "Tout ce qui vient des résultats de recherche fonctionne toujours : classements, AI Overviews et mots-clés partagés.",
    "The last read failed. It tries again at the next daily read, and everything from search results still works.": "La dernière lecture a échoué. Nouvel essai à la prochaine lecture quotidienne, et tout ce qui vient des résultats de recherche fonctionne toujours.",
    "How you compare": "Votre comparaison",
    "You": "Vous",
    "Them": "Eux",
    "You and them": "Vous et eux",
    "Level": "À égalité",
    "You're ahead": "Vous êtes devant",
    "They're ahead": "Ils sont devant",
    "Keywords you both rank on": "Mots-clés où vous vous classez tous les deux",
    "Level on {n}": "À égalité sur {n}",
    "Average position on shared keywords": "Position moyenne sur les mots-clés partagés",
    "Nothing shared yet.": "Rien en commun pour l'instant.",
    "Lower is better.": "Plus c'est bas, mieux c'est.",
    "Ahead on shared keywords": "Devant sur les mots-clés partagés",
    "Keywords only one of you ranks on": "Mots-clés où un seul de vous se classe",
    "The other isn't in the results checked.": "L'autre est absent des résultats vérifiés.",
    "Pages known": "Pages connues",
    "Average words per page": "Mots par page en moyenne",
    "New pages in 30 days": "Nouvelles pages en 30 jours",
    "Their pages can't be read.": "Leurs pages ne peuvent pas être lues.",
    "AI Overview citations": "Citations dans les AI Overviews",
    "Of {n} AI Overview seen.": "Sur {n} AI Overview vu.",
    "Of {n} AI Overviews seen.": "Sur {n} AI Overviews vus.",
    "No AI Overview seen yet.": "Aucun AI Overview vu pour l'instant.",
    "Timeline": "Chronologie",
    "Ranking moves only compare two checks by the same tool, from the same place, so a change of tool never reads as a move.": "Les mouvements de classement ne comparent que deux vérifications du même outil, depuis le même endroit : un changement d'outil ne compte jamais comme un mouvement.",
    "Filter the timeline": "Filtrer la chronologie",
    "Page edits": "Modifications de pages",
    "New pages": "Nouvelles pages",
    "Ranking moves": "Mouvements de classement",
    "AI Overview": "AI Overview",
    "Title changed": "Titre modifié",
    "Meta description changed": "Meta description modifiée",
    "Main heading changed": "Titre principal modifié",
    "Subheadings changed": "Sous-titres modifiés",
    "Preferred address changed": "Adresse préférée modifiée",
    "Instructions to search engines changed": "Instructions aux moteurs de recherche modifiées",
    "Structured data changed": "Données structurées modifiées",
    "Page text changed": "Texte de la page modifié",
    "New page found": "Nouvelle page trouvée",
    "Page removed": "Page retirée",
    "Started ranking for": "A commencé à se classer sur",
    "Dropped out of the results for": "A quitté les résultats sur",
    "Moved up on": "A gagné des places sur",
    "Moved down on": "A perdu des places sur",
    "Cited in the AI Overview for": "Cité dans l'AI Overview sur",
    "No longer cited in the AI Overview for": "N'est plus cité dans l'AI Overview sur",
    "{from} words, now {to}": "{from} mots, maintenant {to}",
    "The same items, in a different order.": "Les mêmes éléments, dans un autre ordre.",
    "Empty": "Vide",
    "Taken out": "Enlevé",
    "Added": "Ajouté",
    "Before": "Avant",
    "After": "Après",
    "now": "maintenant",
    "Page changes can't be tracked, because this site doesn't allow automated visitors.": "Les changements de pages ne peuvent pas être suivis, car ce site n'autorise pas les visiteurs automatisés.",
    "Nothing yet. The first read only sets a starting point, so changes appear from the next read on.": "Rien pour l'instant. La première lecture ne fixe qu'un point de départ : les changements apparaissent à partir de la suivante.",
    "No ranking moves yet. A move needs two checks by the same tool.": "Aucun mouvement de classement pour l'instant. Il faut deux vérifications du même outil.",
    "Nothing here yet.": "Rien ici pour l'instant.",
    "Which keywords": "Quels mots-clés",
    "Shared": "Partagés",
    "Only them": "Eux seuls",
    "Only you": "Vous seul",
    "Past": "Passés",
    "Their last position": "Leur dernière position",
    "Last seen": "Vu pour la dernière fois",
    "Tool and age": "Outil et ancienneté",
    "You don't rank together on any keyword yet.": "Vous ne vous classez ensemble sur aucun mot-clé pour l'instant.",
    "They don't rank on any keyword without you.": "Ils ne se classent sur aucun mot-clé sans vous.",
    "You don't rank on any keyword without them.": "Vous ne vous classez sur aucun mot-clé sans eux.",
    "Nothing yet. A keyword lands here when they used to rank for it and the latest check no longer shows them.": "Rien pour l'instant. Un mot-clé arrive ici quand ils se classaient dessus et que la dernière vérification ne les montre plus.",
    "Their pages against mine": "Leurs pages face aux miennes",
    "{n} shared keyword": "{n} mot-clé partagé",
    "{n} shared keywords": "{n} mots-clés partagés",
    "Compare": "Comparer",
    "No pages to compare yet. A pair appears when you both rank for the same keyword.": "Aucune page à comparer pour l'instant. Une paire apparaît quand vous vous classez tous les deux sur le même mot-clé.",

    // Find competitors
    "Suggestions only. Nothing is added until you accept. Counted from search results, no AI.": "Des suggestions seulement. Rien n'est ajouté tant que vous n'acceptez pas. Compté à partir des résultats de recherche, sans IA.",
    "No keywords yet": "Aucun mot-clé pour l'instant",
    "Upload your keyword list. We check who ranks for each keyword once, using free tools only, then suggest the domains that appear most often.": "Importez votre liste de mots-clés. Nous vérifions une fois qui se classe sur chaque mot-clé, avec des outils gratuits uniquement, puis nous suggérons les domaines qui reviennent le plus souvent.",
    "Upload your keyword list": "Importer votre liste de mots-clés",
    "Add keywords": "Ajouter des mots-clés",
    "Upload keyword list": "Importer une liste de mots-clés",
    "Check again": "Vérifier à nouveau",
    "Last checked {when}": "Dernière vérification {when}",
    "Not checked yet": "Pas encore vérifié",
    "{done} of {n} keyword": "{done} mot-clé sur {n}",
    "{done} of {n} keywords": "{done} mots-clés sur {n}",
    "{n} check failed in the last run.": "{n} vérification a échoué lors du dernier passage.",
    "{n} checks failed in the last run.": "{n} vérifications ont échoué lors du dernier passage.",
    "A domain is suggested once it appears on at least {n} keywords.": "Un domaine est suggéré dès qu'il apparaît sur au moins {n} mots-clés.",
    "Your keyword list": "Votre liste de mots-clés",
    "Suggestions": "Suggestions",
    "No suggestions right now": "Aucune suggestion pour l'instant",
    "No suggestions yet": "Pas encore de suggestions",
    "No other domain appears often enough on your keywords. New checks can change that.": "Aucun autre domaine n'apparaît assez souvent sur vos mots-clés. De nouvelles vérifications peuvent changer cela.",
    "They appear here as soon as your keywords have been checked.": "Elles apparaissent ici dès que vos mots-clés ont été vérifiés.",
    "Ranks for {k} of {n} keyword": "Se classe sur {k} mot-clé sur {n}",
    "Ranks for {k} of {n} keywords": "Se classe sur {k} mots-clés sur {n}",
    "Average position": "Position moyenne",
    "Best position": "Meilleure position",
    "In the top 3 on": "Dans le top 3 sur",
    "You both rank on": "Vous vous classez tous les deux sur",
    "Public body": "Organisme public",
    "Big site": "Grand site",
    "Accept": "Accepter",
    "Dismiss": "Écarter",
    "Restore": "Rétablir",
    "See the evidence": "Voir les preuves",
    "Their position": "Leur position",
    "Your position": "Votre position",
    "Checked with": "Vérifié avec",
    "Showing the first {n}.": "Affichage des {n} premiers.",
    "Big sites and public bodies": "Grands sites et organismes publics",
    "These rank for almost everything, so they're rarely real competitors. You can still accept one if you want to watch it.": "Ils se classent sur presque tout, ce sont donc rarement de vrais concurrents. Vous pouvez quand même en accepter un si vous voulez le suivre.",
    "Dismissed": "Écartés",
    "These stay dismissed whatever new checks show, until you restore them.": "Ils restent écartés quoi que montrent les nouvelles vérifications, jusqu'à ce que vous les rétablissiez.",
    "Dismissed {when}": "Écarté {when}",
    "Not in your latest results": "Absent de vos derniers résultats",
    "{host} dismissed. It won't be suggested again unless you restore it.": "{host} écarté. Il ne sera plus suggéré, sauf si vous le rétablissez.",
    "{host} is back in the suggestions.": "{host} est de retour dans les suggestions.",
    "{host} is no longer dismissed. It's suggested again if it shows up often enough in your results.": "{host} n'est plus écarté. Il sera de nouveau suggéré s'il apparaît assez souvent dans vos résultats.",
    "Check your keywords again?": "Vérifier à nouveau vos mots-clés ?",
    "This uses {n} check from your free tools.": "Cela utilise {n} vérification de vos outils gratuits.",
    "This uses {n} checks from your free tools.": "Cela utilise {n} vérifications de vos outils gratuits.",
    "It never spends paid credits. If free checks run out it stops and says so, and the rest carry on when credits refill.": "Aucun crédit payant n'est jamais dépensé. Si les vérifications gratuites s'épuisent, tout s'arrête et l'application le dit, et le reste reprend quand les crédits reviennent.",
    "A check of this website's keywords is already running.": "Une vérification des mots-clés de ce site est déjà en cours.",
    "Upload your keyword list first.": "Importez d'abord votre liste de mots-clés.",

    // The run
    "You can leave this page: it carries on.": "Vous pouvez quitter cette page : la vérification continue.",
    "Waiting to start…": "En attente de démarrage…",
    "Checking your keywords: {done} of {total}": "Vérification de vos mots-clés : {done} sur {total}",
    "Using {tool}.": "Avec {tool}.",
    "{n} check failed.": "{n} vérification a échoué.",
    "{n} checks failed.": "{n} vérifications ont échoué.",
    "{n} keyword saved.": "{n} mot-clé enregistré.",
    "{n} keywords saved.": "{n} mots-clés enregistrés.",
    "{n} is still to check.": "{n} reste à vérifier.",
    "{n} are still to check.": "{n} restent à vérifier.",
    "None checked yet.": "Aucun vérifié pour l'instant.",
    "Nothing is lost.": "Rien n'est perdu.",
    "Free tools only. It carries on by itself when a tool is ready or free checks refill.": "Outils gratuits uniquement. La vérification reprend d'elle-même quand un outil est prêt ou que les vérifications gratuites reviennent.",
    "Open Settings": "Ouvrir les réglages",
    "Waiting for a search tool": "En attente d'un outil de recherche",
    "{n} keyword checked.": "{n} mot-clé vérifié.",
    "{n} keywords checked.": "{n} mots-clés vérifiés.",
    "{n} suggestion to look at.": "{n} suggestion à regarder.",
    "{n} suggestions to look at.": "{n} suggestions à regarder.",
    "No search tool is connected yet. The keywords are saved, and they'll be checked once a tool's key is added in Settings.": "Aucun outil de recherche n'est encore connecté. Les mots-clés sont enregistrés, et ils seront vérifiés dès qu'une clé d'outil sera ajoutée dans les réglages.",
    "DuckDuckGo asked for a bot check, so this tool stopped.": "DuckDuckGo a demandé une vérification anti-robot, cet outil s'est donc arrêté.",
    "The app does not try to get past it.": "L'application n'essaie pas de la contourner.",
    "DuckDuckGo asked us to slow down, so this tool stopped.": "DuckDuckGo a demandé de ralentir, cet outil s'est donc arrêté.",
    "SerpApi refused the key.": "SerpApi a refusé la clé.",
    "SerpApi has no free searches left for now.": "SerpApi n'a plus de recherches gratuites pour l'instant.",
    "Everything checked so far is saved, and the rest carries on when a tool has free checks again.": "Tout ce qui a été vérifié est enregistré, et le reste reprend quand un outil a de nouveau des vérifications gratuites.",

    // The upload panel
    "Drop a file here": "Déposez un fichier ici",
    ".csv or .txt, in any encoding, up to 10 MB.": ".csv ou .txt, dans n'importe quel encodage, jusqu'à 10 Mo.",
    "This file isn't saved as Unicode. If the words above look wrong, choose its encoding.": "Ce fichier n'est pas enregistré en Unicode. Si les mots ci-dessus semblent incorrects, choisissez son encodage.",
    "Western European": "Europe de l'Ouest",
    "Arabic": "Arabe",
    "Japanese": "Japonais",
    "Korean": "Coréen",
    "Chinese, simplified": "Chinois simplifié",
    "Chinese, traditional": "Chinois traditionnel",
    "Cyrillic": "Cyrillique",
    "Central European": "Europe centrale",
    "Greek": "Grec",
    "Turkish": "Turc",
    "Hebrew": "Hébreu",
    "Thai": "Thaï",
    "Vietnamese": "Vietnamien",
    "Or paste your keywords, one per line": "Ou collez vos mots-clés, un par ligne",
    "Country": "Pays",
    "Any country": "Tous les pays",
    "Any language": "Toutes les langues",
    "Free tools only. It never spends paid credits. If free checks run out it stops and says so, and the rest carry on when credits refill.": "Outils gratuits uniquement. Aucun crédit payant n'est jamais dépensé. Si les vérifications gratuites s'épuisent, tout s'arrête et l'application le dit, et le reste reprend quand les crédits reviennent.",
    "Save and check": "Enregistrer et vérifier",
    "Remove the file": "Retirer le fichier",
    "{n} keyword found": "{n} mot-clé trouvé",
    "{n} keywords found": "{n} mots-clés trouvés",
    "{n} repeat counted once": "{n} doublon compté une fois",
    "{n} repeats counted once": "{n} doublons comptés une fois",
    "and more": "et d'autres",
    "{n} keyword": "{n} mot-clé",
    "{n} keywords": "{n} mots-clés",
    "Choose a .csv or .txt file.": "Choisissez un fichier .csv ou .txt.",
    "That file is too big. The limit is 10 MB.": "Ce fichier est trop volumineux. La limite est de 10 Mo.",
    "Choose a file, or paste your keywords.": "Choisissez un fichier, ou collez vos mots-clés.",
    "No keywords found. Put one keyword on each line, or use a column named keyword.": "Aucun mot-clé trouvé. Mettez un mot-clé par ligne, ou utilisez une colonne nommée keyword.",
    "This keyword was already checked, so nothing new was searched.": "Ce mot-clé avait déjà été vérifié : aucune nouvelle recherche.",
    "These {n} keywords were already checked, so nothing new was searched.": "Ces {n} mots-clés avaient déjà été vérifiés : aucune nouvelle recherche.",
    "The country must be a two-letter code, such as FR.": "Le pays doit être un code à deux lettres, comme FR.",
    "The language must be a code, such as fr.": "La langue doit être un code, comme fr.",
  });
})();
