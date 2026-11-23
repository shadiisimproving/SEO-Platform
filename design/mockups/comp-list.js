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
  /* The same, for a sentence that holds HTML (logos): the words are escaped, the values must already be. */
  const fillHtml = (key, values = {}) => esc(t(key)).replace(/\{(\w+)\}/g, (all, name) => (name in values ? values[name] : all));
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
  const list = { rows: null, site: null, scroll: 0, flash: null, follow: null };
  const view = { data: null, filter: "all", limit: 50, kw: "shared", sort: { key: "keyword", dir: 1 } };
  /* The long tables have pages and a search (table-pages.js), like every long table in the app. The timeline is a list of days, with Show more. */
  const PAGES = { list: "cl-list", keywords: "cl-kw", timeline: "cl-tl" }, EVIDENCE = (domain) => `cl-ev:${domain}`;
  const FIND_FROM = 11; // more than 10 rows, as on every table: a search box shows from this many rows, or while a search is on
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
  /* A blocked read: the server's few words (seo/competitors/crawl.py BLOCKED_TEXT), the full sentence in a tip. Reads saved
     before 2026-11-11 carry the full sentence as their message: they are said the same way. Any other message stays as sent. */
  const BLOCKED_TEXT = "Blocks bots, so edits can't be tracked.";
  const BLOCKED_TIP = "This site doesn't allow automated visitors, so its edits can't be tracked. The app doesn't try to get past that.";
  const blockedWords = (message) => (!message || message === BLOCKED_TEXT || message === BLOCKED_TIP ? null : message);
  const blockedHtml = (message) => { const own = blockedWords(message); return own ? esc(say(own)) : `${esc(t(BLOCKED_TEXT))}${UI.tip(BLOCKED_TIP)}`; };
  const crawling = (crawl) => crawl?.status === "queued" || crawl?.status === "running";

  /* retry is { id, site }: with it, a failed read gets a Try again button that asks for a read at once. */
  /* follow: on a profile, how the site is followed rides on the same line ("Last read 3 h ago · every page read daily"),
     with the full sentence on hover, so it costs no room. */
  /* In a table row (every call without follow), the row says only its state (2026-11-11): a read that worked is a check mark
     ("Watching" in its tooltip) and when; Blocked and Read failed carry their sentence in the tooltip, and watchNotes() says it
     once under the table with a count. The profile header (follow) keeps the sentence: one competitor, said once. */
  function watching(crawl, retry, { follow = false } = {}) {
    const c = crawl || { status: "none" };
    const row = !follow;
    let inner;
    const how = follow && COMP.reading?.follow ? COMP.reading.follow(c) : null;
    const howWords = how ? ` · <span class="cl-follow" data-tip="${esc(how.text)}" tabindex="0">${esc(how.short)}</span>` : "";
    const retryButton = retry ? `<button type="button" class="btn btn-small cl-retry" data-cl-retry="${retry.id}" data-cl-retry-site="${retry.site}">${icon("refresh-cw")}${t("Try again")}</button>` : "";
    const withTip = (html, words) => `<span class="cl-state-tip" tabindex="0" data-tip="${esc(words)}" aria-label="${esc(words)}">${html}</span>`;
    if (c.status === "ok" && row) inner = `<span class="cl-read-ok">${COMP.iconTip("circle-check", t("Watching"), "cl-ok-ic")}<span>${esc(fill("Read {when}", { when: COMP.ago(c.finished_at) }))}</span></span>`;
    else if (c.status === "ok") inner = `<span class="second">${esc(fill("Read {when}", { when: COMP.ago(c.finished_at) }))}${howWords}</span>`;
    else if (c.status === "running") inner = `<span class="status sec">${icon("refresh-cw", "spin")}${esc(t("Reading…"))}</span>${c.pages_read ? `<span class="second">${esc(many(c.pages_read, "{n} page read", "{n} pages read"))}</span>` : ""}`;
    else if (c.status === "queued") inner = `<span class="status sec">${icon("clock")}${esc(t("Waiting"))}</span>`;
    else if (c.status === "blocked" && row) inner = withTip(UI.status("warn", t("Blocked")), say(blockedWords(c.message) || BLOCKED_TIP));
    else if (c.status === "blocked") inner = `${UI.status("warn", t("Blocked"))}<span class="second cl-wrap">${blockedHtml(c.message)}</span>`;
    else if (c.status === "failed" && row) inner = `${withTip(UI.status("crit", t("Read failed")), t("Retries at the next daily read."))}${retryButton}`;
    else if (c.status === "failed") inner = `${UI.status("crit", t("Read failed"))}<span class="second cl-wrap">${esc(t("Trying again at the next daily read."))}</span>${retryButton}`;
    else inner = `<span class="status sec">${icon("clock")}${esc(t("Not read yet"))}</span>`;
    return `<span class="cl-watch">${inner}</span>`;
  }
  /* Under a table of competitors, once per kind: how many block bots or failed their last read, and which. Paused rows aren't read, so they don't count.
     rows: [{ host, crawl, tracking }]. */
  const BLOCKED_MANY = "These sites don't allow automated visitors, so their edits can't be tracked. The app doesn't try to get past that.";
  function watchNotes(rows) {
    const live = (rows || []).filter((r) => r && r.tracking !== "off");
    const hostsWith = (state) => live.filter((r) => r.crawl?.status === state).map((r) => r.display || r.host);
    const names = (hosts) => esc(hosts.slice(0, 3).join(", ") + (hosts.length > 3 ? ` ${fill("and {n} more", { n: UI.num(hosts.length - 3) })}` : ""));
    const blocked = hostsWith("blocked"), failed = hostsWith("failed");
    return [
      blocked.length ? `<p class="help cl-watch-note">${icon("triangle-alert")}<span>${many(blocked.length, "{n} blocks bots: {hosts} — edits can't be tracked.", "{n} block bots: {hosts} — edits can't be tracked.", { hosts: names(blocked) })}${UI.tip(blocked.length === 1 ? BLOCKED_TIP : BLOCKED_MANY)}</span></p>` : "",
      failed.length ? `<p class="help cl-watch-note"><span>${fill("Read failed ×{n}: {hosts} — retries at the next daily read.", { n: UI.num(failed.length), hosts: names(failed) })}</span></p>` : "",
    ].join("");
  }
  COMP.watchNotes = watchNotes;
  const howAdded = (source) => t(source === "suggested" ? "From a suggestion" : "Added by hand");

  // ---- My competitors: the list ---------------------------------------------------------------
  COMP.watching = (crawl, retry) => watching(crawl, retry);

  function listBody() {
    const rows = list.rows;
    if (!rows.length) {
      const waiting = findData()?.suggestions?.length || 0;
      return COMP.empty(
        t("No competitors yet"),
        waiting ? many(waiting, "{n} suggestion is waiting in Find competitors.", "{n} suggestions are waiting in Find competitors.") : t("Upload keywords in Find competitors to see who ranks against you."),
        `<div class="cl-empty-acts"><button class="btn btn-main" data-cl-go-find>${icon("target")}${t("Find competitors")}</button><button class="btn" id="cl-add-open">${icon("plus")}${t("Add by hand")}</button></div>`
      );
    }
    const site = COMP.site()?.host || "";
    const q = TP.state(PAGES.list).q, found = rows.filter((c) => TP.matches(PAGES.list, c.display, c.host)), page = TP.view(PAGES.list, found);
    const search = rows.length >= FIND_FROM || q ? `<div class="cp-tools cl-tools">${TP.search(PAGES.list, t("Find a competitor"))}</div>` : "";
    return `<section class="tool-band cl-band" aria-label="${attr("My competitors")}">
        <p>${many(rows.length, "Watching {n} competitor for {site}.", "Watching {n} competitors for {site}.", { site: `<span class="mono">${esc(site)}</span>` })}</p>
        <button class="btn btn-main" id="cl-add-open">${icon("plus")}${t("Add a competitor")}</button>
      </section>
      ${search}${found.length ? `<div class="cl-pages"><div class="table-wrap"><table class="data" id="cl-table">
        <thead><tr><th scope="col">${t("Competitor")}</th><th scope="col" class="c">${t("Shared keywords")}</th><th scope="col" class="c">${t("They lead")}</th><th scope="col" class="c">${t("You lead")}</th><th scope="col" class="c">${t("Only them")}</th><th scope="col" class="c">${t("Edits in 30 days")}</th><th scope="col">${t("Watching")}</th><th scope="col">${t("Tracking")}</th><th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead>
        <tbody>${page.rows.map(listRow).join("")}</tbody>
      </table></div>${TP.footer(PAGES.list, page, { noun: t("competitors") })}${watchNotes(found)}</div>` : `<div class="table-wrap"><div class="empty"><p>${esc(fill("No competitor matches “{text}”.", { text: q }))}</p><button type="button" class="btn btn-small" data-tp-clear data-tp-key="${PAGES.list}">${t("Clear search")}</button></div></div>`}`;
  }

  const kwCell = (c, n) => (COMP.trackingOf?.(c) ?? "on") === "on" ? UI.num(n) : `<span class="muted" title="${attr("Not tracked for keywords.")}">—</span>`;
  const listRow = (c) => `<tr data-cl-row="${c.id}" class="${list.flash === c.id ? "flash" : ""}${c.tracking && c.tracking !== "on" ? ` ct-row-${c.tracking}` : ""}">
      <td class="head-cell"><span class="with-logo">${UI.siteLogo(c.host)}<span class="logo-text"><button class="kw cl-name" data-cl-open="${c.id}" dir="auto">${esc(c.display || c.host)}</button>${c.source === "suggested" ? "" : ` ${COMP.iconTip("user", howAdded(c.source), "cl-hand")}`}</span></span></td>
      <td class="c" data-label="${attr("Shared keywords")}">${kwCell(c, c.shared)}</td>
      <td class="c" data-label="${attr("They lead")}">${kwCell(c, c.they_ahead)}</td>
      <td class="c" data-label="${attr("You lead")}">${kwCell(c, c.i_ahead)}</td>
      <td class="c" data-label="${attr("Only them")}">${kwCell(c, c.theirs_only)}</td>
      <td class="c" data-label="${attr("Edits in 30 days")}">${c.crawl?.status === "blocked" ? `<span class="muted" title="${attr("Edits can't be tracked on this site.")}">—</span>` : UI.num(c.edits_30d)}</td>
      <td data-label="${attr("Watching")}" data-cl-watch="${c.id}">${c.tracking === "off" ? `<span class="status sec">${icon("pause")}${esc(t("Paused"))}</span>` : watching(c.crawl, { id: c.id, site: COMP.siteId })}</td>
      <td data-label="${attr("Tracking")}">${COMP.trackingSwitch?.(c) ?? ""}</td>
      <td class="r nowrap" data-label=""><button class="icon-btn cl-row-btn" data-cl-remove="${c.id}" aria-label="${attr("Remove")}: ${esc(c.host)}" data-tip="${attr("Remove")}">${icon("trash-2")}</button></td>
    </tr>`;

  function openProfile(id) {
    list.scroll = UI.$("#main")?.scrollTop || 0;
    listTab.competitorId = id;
    view.data = null;
    COMP.tab = "list"; // the profile is the list tab's second screen; the Competitors tab stays lit
    COMP.reload({ quiet: true });
  }
  /* Back to the merged Competitors tab (comp-summary.js), where the rows are. */
  function backToList() {
    listTab.competitorId = null;
    COMP.profileTabs?.leave?.();
    view.data = null;
    COMP.open("summary");
  }

  /* While something is being read, only its state is redrawn. When it ends, the numbers are fetched again.
     One follow at a time, through COMP.poll: paused while the browser tab is hidden, slower over time, never for ever.
     An open profile asks only for its read's state (competitors/<id>/reading), not the whole list. */
  function watchCrawls() {
    list.follow?.stop();
    list.follow = null;
    const id = listTab.competitorId;
    const site = COMP.siteId;
    const showing = id && view.data ? [view.data] : list.rows || [];
    if (!showing.some((c) => crawling(c.crawl))) return;
    const still = () => here("list", site) && listTab.competitorId === id;
    list.follow = COMP.poll(async () => {
      if (!still()) return false;
      if (id) {
        const fresh = await COMP.api("GET", `competitors/${id}/reading?site_id=${site}`);
        if (!still()) return false;
        if (!view.data) { COMP.reload({ quiet: true }); return false; }
        const was = view.data.crawl?.status;
        view.data.crawl = fresh.crawl;
        if (!crawling(fresh.crawl)) { COMP.reload({ quiet: true }); return false; }
        if (fresh.crawl.status !== was) paintWatch();
        return true;
      }
      const rows = (await COMP.api("GET", `competitors?site_id=${site}`)).competitors;
      if (!still()) return false;
      list.rows = rows;
      if (!rows.some((c) => crawling(c.crawl))) { COMP.paint(); return false; }
      rows.forEach((c) => { const cell = UI.$(`[data-cl-watch="${c.id}"]`); if (cell && c.tracking !== "off") UI.setHTML(cell, watching(c.crawl, { id: c.id, site })); });
      return true;
    }, { every: 2500, grow: 1.2, slowest: 30000, most: 30 * 60000, onEnd: (why) => { if (why === "gone" && still()) COMP.reload({ quiet: true }); } });
  }

  // ---- Add and remove ---------------------------------------------------------------------------
  const fieldError = (input, box, message) => {
    input?.classList.add("invalid");
    if (box) UI.setHTML(box, `<div class="error" role="alert">${icon("octagon-alert")}<span>${esc(message)}</span></div>`);
    input?.focus();
  };
  const fieldClear = (input, box) => { input?.classList.remove("invalid"); if (box) box.replaceChildren(); };

  /* One per line, or commas, semicolons, tabs. A line with spaces only splits when every piece looks like an address,
     so "not a url" stays one line and is refused as typed. One site counts once. */
  function splitAddresses(text) {
    const seen = new Set();
    const pieces = String(text || "").split(/[\n\r,;\t]+/).flatMap((line) => {
      const words = line.trim().split(/\s+/).filter(Boolean);
      return words.length > 1 && words.every((w) => /\.[a-z]{2,}/i.test(w)) ? words : [line.trim()];
    });
    return pieces.map((a) => a.trim().replace(/^["'<]+|["'>]+$/g, "")).filter((a) => {
      const key = a.toLowerCase().split("://").pop().split("/")[0].replace(/^www\./, "");
      if (!a || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const ADD_AT_MOST = 200;

  /* Opens from My competitors (one site) and from Summary (may be All my sites, so it asks which site). */
  function openAdd(opener) {
    const all = COMP.siteId === COMP.ALL;
    const site = all ? (UI.preferredSite(COMP.sites)?.id ?? null) : COMP.siteId;
    const sub = all ? t("Paste one or many") : `${t("For")} <span class="mono">${esc(COMP.site()?.host || "")}</span>`;
    const picker = all ? `<label class="field"><span>${t("Competitor of which site?")}</span><select class="select" id="cl-add-site" style="width:100%">${COMP.sites.map((s) => `<option value="${s.id}" ${s.id === site ? "selected" : ""}>${esc(s.host)}</option>`).join("")}</select></label>` : "";
    UI.openPanel(`${UI.panelHead(t("Add competitors"), sub)}
      <form class="panel-body" id="cl-add-form" novalidate>
        ${picker}
        <label class="field"><span>${t("Website addresses")} <span class="req">*</span></span><textarea class="input mono cl-paste-box" id="cl-add-address" rows="6" dir="ltr" autocomplete="off" spellcheck="false" placeholder="https://rival-one.example\nrival-two.example" data-autofocus aria-describedby="cl-add-help cl-add-error cl-add-result"></textarea><div class="help" id="cl-add-help">${esc(fill("One per line, or a spreadsheet column. Up to {n}.", { n: ADD_AT_MOST }))} <strong id="cl-add-count" aria-live="polite"></strong></div><div id="cl-add-error"></div></label>
        <div id="cl-add-result"></div>
        <p class="help">${t("Respects each site's rules for bots.")}${UI.tip("The app reads public pages slowly and follows each site's rules for automated visitors. If a site says no, it says so here and doesn't try to get past it.")}</p>
      </form>
      <div class="panel-foot"><button class="btn btn-main" id="cl-add-save">${t("Add")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener, { key: `cl-add|${COMP.siteId}`, reopen: () => openAdd(opener), after: paintAddCount });
  }

  function paintAddCount() {
    const n = splitAddresses(UI.$("#cl-add-address")?.value).length;
    const count = UI.$("#cl-add-count"), save = UI.$("#cl-add-save");
    if (count) count.textContent = n > 1 ? many(n, "{n} website", "{n} websites") : "";
    if (save) save.textContent = n > 1 ? many(n, "Add {n} competitor", "Add {n} competitors") : t("Add");
  }

  /* Open and Undo side by side: the toast helper holds one action, so the second is added to its row. */
  function addedToast(made, sourceSite) {
    const name = (list.rows || []).find((c) => c.id === made.id)?.display || made.display || made.host;
    const open = () => COMP.open("list", { competitorId: made.id }, sourceSite);
    const undo = async () => {
      try {
        await COMP.api("DELETE", `competitors/${made.id}?site_id=${sourceSite}`);
        UI.toast(fill("{host} removed.", { host: name }), { kind: "info" });
        refreshHere();
      } catch (err) { fail(err); }
    };
    const el = UI.toast(fill("{host} added.", { host: name }), { undo });
    const button = document.createElement("button");
    button.className = "link-btn";
    button.textContent = t("Open");
    button.onclick = () => { el.remove(); open(); };
    el.querySelector(".acts")?.prepend(button);
  }
  const refreshHere = () => { if (UI.state.route === "competitors" && ["list", "find", "summary"].includes(COMP.tab)) return COMP.reload({ quiet: true }); return null; };

  function manyAddedToast(added, sourceSite, extra) {
    const undo = async () => {
      try {
        for (const made of added) await COMP.api("DELETE", `competitors/${made.id}?site_id=${sourceSite}`);
        UI.toast(many(added.length, "{n} competitor removed.", "{n} competitors removed."), { kind: "info" });
        refreshHere();
      } catch (err) { fail(err); refreshHere(); }
    };
    UI.toast(`${many(added.length, "{n} competitor added.", "{n} competitors added.")}${extra ? ` ${extra}` : ""}`, { undo });
  }

  async function submitAdd() {
    const input = UI.$("#cl-add-address"), box = UI.$("#cl-add-error"), save = UI.$("#cl-add-save"), result = UI.$("#cl-add-result");
    if (!input || save?.disabled) return;
    const addresses = splitAddresses(input.value);
    fieldClear(input, box);
    result?.replaceChildren();
    if (!addresses.length) { fieldError(input, box, t("Enter the competitor's address.")); return; }
    if (addresses.length > ADD_AT_MOST) { fieldError(input, box, fill("Add up to {max} at a time. This list has {n}.", { max: ADD_AT_MOST, n: addresses.length })); return; }
    const picked = UI.$("#cl-add-site");
    const site = picked ? Number(picked.value) : COMP.siteId;
    save.disabled = true;
    try {
      const { added, already, refused } = await COMP.api("POST", "competitors/many", { site_id: site, addresses: addresses.join("\n") });
      const alreadyNote = already.length ? many(already.length, "{n} was already there.", "{n} were already there.") : "";
      if (added.length) {
        list.flash = added[0].id;
        if (!refused.length) {
          UI.forgetPanelForm();
          UI.closePanel({ keep: false });
          pending = () => focusAttr("data-cl-open", added[0].id)?.focus({ preventScroll: true });
        }
        await refreshHere();
        if (added.length === 1 && !already.length) addedToast(added[0], site);
        else manyAddedToast(added, site, alreadyNote);
      }
      if (refused.length || !added.length) {
        // What's left in the box is only what still needs fixing, each with its reason.
        const left = refused.length ? refused : already;
        input.value = left.map((r) => r.address).join("\n");
        paintAddCount();
        const head = refused.length
          ? (added.length ? many(added.length, "{n} added. These weren't:", "{n} added. These weren't:") : t("None added:"))
          : t("Already your competitors:");
        input.classList.toggle("invalid", Boolean(refused.length));
        UI.setHTML(result, `<div class="note cl-add-note ${refused.length ? "crit" : ""}" role="alert">${icon(refused.length ? "octagon-alert" : "info")}<div><span>${esc(head)}</span><ul class="cl-add-why">${left.map((r) => { const host = r.address.toLowerCase().split("://").pop().split("/")[0].replace(/^www\./, ""); return `<li>${r.reason.toLowerCase().includes(host) ? "" : `<span class="mono" dir="ltr">${esc(r.address)}</span> `}${esc(say(r.reason))}</li>`; }).join("")}</ul>${refused.length && already.length ? `<span class="small">${esc(alreadyNote)}</span>` : ""}</div></div>`);
        input.focus();
      }
    } catch (err) {
      fieldError(input, box, say(err.message));
    } finally {
      if (save.isConnected) save.disabled = false;
    }
  }

  function confirmRemove(id) {
    const row = (list.rows || []).find((c) => c.id === id) || (view.data?.id === id ? view.data : null) || COMP.summaryRival?.(id);
    if (!row) return;
    const dlg = UI.$("#dlg");
    dlg.classList.remove("wide");
    UI.setHTML(dlg, `<div class="dlg-head"><h2 id="dlg-title" dir="auto">${esc(fill("Remove {host}?", { host: row.display || row.host }))}</h2><button class="icon-btn" data-close-dlg aria-label="${attr("Close")}">${icon("x")}</button></div>
      <div class="dlg-body"><p>${esc(fill("No longer compared with {site}. Its data is kept.", { site: COMP.site()?.host || "" }))}</p><p class="small sec" style="margin-top:8px">${t("Its page pairs here are removed; automatic ones return if re-added.")}</p></div>
      <div class="dlg-foot"><button class="btn" data-close-dlg>${t("Cancel")}</button><button class="btn btn-main" data-cl-remove-yes="${id}">${t("Remove")}</button></div>`);
    dlg.showModal();
    UI.$("[data-cl-remove-yes]", dlg)?.focus();
  }

  async function removeNow(id) {
    const row = (list.rows || []).find((c) => c.id === id) || (view.data?.id === id ? view.data : null) || COMP.summaryRival?.(id);
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
    UI.toast(t("Removed. Data kept."), {
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
  const EDIT_KINDS = ["title", "meta", "h1", "headings", "canonical", "robots", "schema", "content", "search_title"];
  const TIMELINE_FILTERS = [
    ["all", "All", null], ["edits", "Page edits", EDIT_KINDS], ["new", "New pages", ["new_page"]], ["gone", "Removed|pages", ["page_gone"]],
    ["rank", "Ranking moves", ["rank_new", "rank_lost", "rank_up", "rank_down"]], ["ai", "AI Overview", ["ai_cited", "ai_dropped"]],
  ];
  const KINDS = {
    title: ["pencil", "Title changed"], meta: ["pencil", "Meta description changed"], h1: ["pencil", "Main heading changed"], headings: ["pencil", "Subheadings changed"],
    canonical: ["pencil", "Canonical changed"], robots: ["pencil", "Indexing changed"], schema: ["pencil", "Structured data changed"], content: ["file-text", "Content changed"],
    search_title: ["search", "Search title changed"], // as Today names it (today-live.js KINDS)
    new_page: ["plus", "New page"], page_gone: ["minus", "Page removed"],
    rank_new: ["trending-up", "Started ranking for"], rank_lost: ["arrow-down", "Stopped ranking for"], rank_up: ["arrow-up", "Moved up on"], rank_down: ["arrow-down", "Moved down on"],
    ai_cited: ["sparkles", "Cited in AI Overview for"], ai_dropped: ["sparkles", "Dropped from AI Overview for"],
  };

  function compareTile(label, mine, theirs, { note = "", verdict = "" } = {}) {
    const side = (who, value) => `<div class="cl-side"><span class="cl-who">${who}</span><span class="cl-fig tabular">${value}</span></div>`;
    return `<div class="tile cl-cmp"><div class="lab">${esc(label)}</div><div class="cl-sides">${side(COMP.who("you"), mine)}${side(COMP.who("them"), theirs)}</div><div class="delta">${verdict}${note ? `<span class="ab">${esc(note)}</span>` : ""}</div></div>`;
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
      <div class="tile cl-cmp"><div class="lab">${t("Shared keywords")}</div><div class="cl-sides"><div class="cl-side"><span class="cl-who">${t("You and them")}</span><span class="cl-fig tabular">${UI.num(c.shared)}</span></div></div><div class="delta">${c.level ? `<span class="ab">${esc(many(c.level, "Level on {n}", "Level on {n}"))}</span>` : ""}</div></div>
      ${compareTile(t("Average position (shared)"), place(c.my_average), place(c.their_average), { verdict: verdict(c.my_average, c.their_average, true), note: c.my_average === null ? t("Nothing shared yet.") : t("Lower is better.") })}
      ${compareTile(t("Who leads"), figure(c.i_ahead), figure(c.they_ahead), { verdict: c.shared ? verdict(c.i_ahead, c.they_ahead) : "" })}
      ${compareTile(t("Only one ranks"), figure(c.mine_only), figure(c.theirs_only), { note: t("The other isn't in the results checked.") })}
      ${compareTile(t("Pages known"), figure(c.pages?.mine?.pages), blocked ? dash : figure(c.pages?.theirs?.pages), { note: theirPages })}
      ${compareTile(t("Words per page"), figure(c.pages?.mine?.average_words), blocked ? dash : figure(c.pages?.theirs?.average_words), { note: theirPages })}
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
        // How many words the edit touched, when known: a small one says so, so a changed price isn't read as a rewrite.
        const touched = Number.isFinite(e.changed_words) && e.changed_words > 0
          ? ` · ${e.changed_words < 15 ? fill(e.changed_words === 1 ? "small edit, {n} word" : "small edit, {n} words", { n: UI.num(e.changed_words) }) : fill("~{n} words changed", { n: UI.num(e.changed_words) })}`
          : "";
        return `<div class="d tabular">${esc(fill("{from} → {to} words", { from: UI.num(Number(from[1])), to: UI.num(Number(to[1])) }) + touched)}</div>`;
      }
    }
    const was = asList(e.before), now = asList(e.after);
    if (was || now) {
      const before = listItems(was), after = listItems(now);
      const added = after.filter((x) => !before.includes(x)), gone = before.filter((x) => !after.includes(x));
      if (!added.length && !gone.length) return `<div class="d">${t("Same items, new order.")}</div>`;
      return `<div class="cl-change">${gone.length ? changeLine(t("Taken out"), gone.join(" · "), "was") : ""}${added.length ? changeLine(t("Added"), added.join(" · ")) : ""}</div>`;
    }
    return `<div class="cl-change">${changeLine(t("Before"), e.before, "was")}${changeLine(t("After"), e.after)}</div>`;
  }

  /* The engine and tool are logos (2026-11-11). `common` (moveCommon) is what every move in view shares: said once over the list, left out here. */
  function moveDetail(e, common = null) {
    const from = e.kind === "rank_new" ? COMP.pos(null, e.depth) : COMP.pos(e.from, e.depth);
    const to = e.kind === "rank_lost" ? COMP.pos(null, e.depth) : COMP.pos(e.to, e.depth);
    return `<div class="d cl-move"><span class="cl-move-places">${from}${icon("arrow-right")}<span class="sr">${t("now")}</span>${to}</span>${common?.source ? "" : COMP.toolLogos(e.engine, e.tool)}</div>`;
  }

  /* Ranking moves and AI Overview rows: what every one in view shares (country, device, location, results checked, engine and tool)
     goes on one line over the list, and each row keeps only what differs (2026-11-11). A fact that any row lacks or has otherwise
     stays on every row. Details keeps every fact on each row. */
  const isMoveKind = (e) => e.kind.startsWith("rank_") || e.kind.startsWith("ai_");
  const MOVE_FACTS = {
    country: (e) => (known(e.country) ? String(e.country).toUpperCase() : ""),
    device: (e) => (known(e.device) ? e.device : ""),
    location: (e) => (known(e.location) && String(e.location).toUpperCase() !== String(e.country || "").toUpperCase() ? e.location : ""),
    depth: (e) => (known(e.depth) ? String(e.depth) : ""),
    source: (e) => (e.engine || e.tool ? `${e.engine || ""}|${e.tool || ""}` : ""),
  };
  function moveCommon(rows) {
    const moves = (rows || []).filter(isMoveKind);
    if (moves.length < 2) return null;
    const common = { first: moves[0] };
    Object.entries(MOVE_FACTS).forEach(([key, of]) => {
      const values = new Set(moves.map(of));
      if (values.size === 1 && !values.has("")) common[key] = true;
    });
    return Object.keys(common).length > 1 ? common : null;
  }
  function moveCommonLine(common) {
    if (!common) return "";
    const e = common.first;
    const bits = [
      common.country ? esc(UI.countryName(String(e.country).toUpperCase())) : "",
      common.device ? esc(t(e.device === "mobile" ? "Mobile" : e.device === "desktop" ? "Desktop" : e.device)) : "",
      common.location ? esc(e.location) : "",
      common.depth ? esc(fill("top {n} checked", { n: UI.num(e.depth) })) : "",
      common.source ? COMP.toolLogos(e.engine, e.tool) : "",
    ].filter(Boolean);
    return `<p class="small sec cl-moves-common">${esc(t("All moves:"))} ${bits.join(" · ")}</p>`;
  }
  COMP.moveCommon = moveCommon;
  COMP.moveCommonLine = moveCommonLine;

  /* Everything known behind a change, asked for on 2026-11-10 ("as much data as possible"). One line of the facts that matter most
     stays in view; the rest sits behind "Details", so the list still reads in seconds. Unknown is left out, never shown as 0. */
  const known = (v) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length);
  const aDate = (v) => {
    if (!known(v)) return "";
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
    return Number.isNaN(d.getTime()) ? String(v) : UI.fmtDateOnly(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : d.toISOString());
  };
  const factChip = (text, tip = "") => `<span class="cl-fact"${tip ? ` data-tip="${attr(tip)}"` : ""}>${text}</span>`;
  const factRow = (label, value) => (value ? `<div class="cl-dl-row"><dt>${esc(t(label))}</dt><dd dir="auto">${value}</dd></div>` : "");
  const plain = (v) => (known(v) ? esc(String(v)) : "");
  const count = (v) => (known(v) ? `<span class="tabular">${UI.num(Number(v))}</span>` : "");
  const tags = (list) => (known(list) ? `<span class="cp-tags">${list.map((x) => `<span class="tag" dir="auto">${esc(x)}</span>`).join(" ")}</span>` : "");

  function pageFactsLine(p) {
    const bits = [
      known(p.words) ? factChip(esc(many(p.words, "{n} word", "{n} words"))) : "",
      known(p.headings_total) && p.headings_total ? factChip(esc(many(p.headings_total, "{n} heading", "{n} headings"))) : "",
      known(p.images) && p.images ? factChip(esc(many(p.images, "{n} image", "{n} images"))) : "",
      p.videos ? factChip(esc(many(p.videos, "{n} video", "{n} videos"))) : "",
      known(p.internal_links) ? factChip(esc(fill("{a} internal · {b} external links", { a: UI.num(p.internal_links), b: UI.num(p.external_links ?? 0) }))) : "",
      known(p.schema) ? factChip(esc(p.schema.slice(0, 3).join(", ") + (p.schema.length > 3 ? ` +${p.schema.length - 3}` : "")), "Structured data") : "",
      known(p.published) ? factChip(esc(fill("published {date}", { date: aDate(p.published) })), "Date the page gives") : known(p.sitemap_date) ? factChip(esc(fill("sitemap {date}", { date: aDate(p.sitemap_date) }))) : "",
      p.edits > 1 ? factChip(esc(many(p.edits, "changed {n} time", "changed {n} times"))) : "",
    ].filter(Boolean);
    return `${known(p.title) ? `<div class="cl-facts-title" dir="auto">${esc(p.title)}</div>` : ""}${bits.length ? `<div class="cl-facts">${bits.join("")}</div>` : ""}`;
  }

  function pageDetails(p) {
    const outline = known(p.headings)
      ? `<ol class="cl-outline">${p.headings.map(([level, text]) => `<li class="cl-h-${esc(String(level).toLowerCase())}"><span class="cl-h-tag">${esc(String(level).toUpperCase())}</span><span dir="auto">${esc(text)}</span></li>`).join("")}</ol>${p.headings_total > p.headings.length ? `<p class="small sec">${esc(fill("First {n} of {total}.", { n: UI.num(p.headings.length), total: UI.num(p.headings_total) }))}</p>` : ""}`
      : "";
    const images = known(p.images) ? `${count(p.images)}${p.images_no_alt ? ` <span class="sec">${esc(fill("({n} without alt text)", { n: UI.num(p.images_no_alt) }))}</span>` : ""}` : "";
    const reader = p.read_with === "firecrawl" ? t("Firecrawl") : p.js_only ? t("Browser (needs JavaScript)") : "";
    return [
      factRow("Title", plain(p.title) + (known(p.title) ? ` <span class="sec small">· ${esc(many(String(p.title).length, "{n} character", "{n} characters"))}</span>` : "")),
      factRow("Meta description", plain(p.description) + (known(p.description) ? ` <span class="sec small">· ${esc(many(String(p.description).length, "{n} character", "{n} characters"))}</span>` : "")),
      factRow("Main heading (H1)", known(p.h1) ? p.h1.map(esc).join("<br>") : ""),
      factRow("Headings", outline),
      factRow("Questions in headings", known(p.questions) ? `<ul class="cl-questions">${p.questions.map((q) => `<li dir="auto">${esc(q)}</li>`).join("")}</ul>` : ""),
      factRow("Words", count(p.words)),
      factRow("Characters", count(p.characters)),
      factRow("Images", images),
      factRow("Videos", count(p.videos)),
      factRow("Tables", count(p.tables)),
      factRow("Lists", count(p.lists)),
      factRow("Forms", count(p.forms)),
      factRow("Internal links", count(p.internal_links)),
      factRow("External links", count(p.external_links)),
      factRow("Structured data", tags(p.schema)),
      factRow("Language", plain(p.lang)),
      factRow("Languages (hreflang)", tags(p.hreflang)),
      factRow("Preferred address (canonical)", known(p.canonical) ? COMP.link(p.canonical) : ""),
      factRow("Instructions to search engines", plain(p.robots)),
      factRow("Answer code", count(p.status)),
      factRow("Published (page says)", plain(aDate(p.published))),
      factRow("Updated (page says)", plain(aDate(p.modified))),
      factRow("Sitemap date", plain(aDate(p.sitemap_date))),
      factRow("First archived", plain(aDate(p.first_archived))),
      factRow("First found", plain(aDate(p.first_seen))),
      factRow("Last changed", plain(aDate(p.last_changed))),
      factRow("Last read", plain(aDate(p.last_read))),
      factRow("Changes seen", known(p.edits) ? count(p.edits) : ""),
      factRow("Read with", plain(reader)),
    ].join("");
  }

  function moveFactsLine(e, common = null) {
    const bits = [
      known(e.country) && !common?.country ? factChip(esc(UI.countryName(String(e.country).toUpperCase()))) : "",
      known(e.device) && !common?.device ? factChip(esc(t(e.device === "mobile" ? "Mobile" : e.device === "desktop" ? "Desktop" : e.device))) : "",
      known(e.location) && !common?.location && String(e.location).toUpperCase() !== String(e.country || "").toUpperCase() ? factChip(esc(e.location)) : "", // "FR" again after France says nothing
      known(e.depth) && !common?.depth ? factChip(esc(fill("top {n} checked", { n: UI.num(e.depth) }))) : "",
    ].filter(Boolean);
    const mine = e.mine ? `<div class="cl-facts cl-facts-you">${factChip(`${COMP.who("you")} ${COMP.pos(e.mine.position, e.depth ?? 100)}${e.mine.host ? ` <span class="mono">${esc(e.mine.host)}</span>` : ""}`, "Your best position, same check")}</div>` : "";
    return `${known(e.title) ? `<div class="cl-facts-title" dir="auto">${esc(e.title)}</div>` : ""}${bits.length ? `<div class="cl-facts">${bits.join("")}</div>` : ""}${mine}`;
  }

  function moveDetails(e) {
    const place = (n) => (known(n) ? `#${UI.num(n)}` : "");
    return [
      factRow("Keyword", plain(e.keyword)),
      factRow("Their page", known(e.url) ? COMP.link(e.url) : ""),
      factRow("Title in results", plain(e.title)),
      factRow("Was", e.kind === "rank_new" ? esc(t("Not in the results checked")) : plain(place(e.from))),
      factRow("Now", e.kind === "rank_lost" ? esc(t("Not in the results checked")) : plain(place(e.to))),
      factRow("Your position", e.mine ? `${COMP.pos(e.mine.position, e.depth ?? 100)}${e.mine.url ? ` ${COMP.link(e.mine.url)}` : ""}` : ""),
      factRow("Search engine", plain(engineName(e.engine))),
      factRow("Tool", plain(e.tool)),
      factRow("Country", known(e.country) ? esc(UI.countryName(String(e.country).toUpperCase())) : ""),
      factRow("Language", plain(e.language)),
      factRow("Device", known(e.device) ? esc(t(e.device === "mobile" ? "Mobile" : e.device === "desktop" ? "Desktop" : e.device)) : ""),
      factRow("Location", plain(e.location)),
      factRow("Results checked", count(e.depth)),
      factRow("Checked", plain(aDate(e.at))),
    ].join("");
  }

  function factsOf(e, common = null) {
    const isMove = e.kind.startsWith("rank_") || e.kind.startsWith("ai_");
    if (!isMove && !e.page) return "";
    const line = isMove ? moveFactsLine(e, common) : pageFactsLine(e.page);
    const rows = isMove ? moveDetails(e) : pageDetails(e.page);
    return `${line}${rows ? `<details class="cl-more-facts"><summary>${icon("chevron-right")}${t("Details")}</summary><dl class="cl-dl">${rows}</dl></details>` : ""}`;
  }
  COMP.changeFacts = factsOf;
  /* For other tabs listing changes (the Competitors table's "See your edits"): the kind in words, and the one short line. */
  COMP.changeWord = (kind) => t(KINDS[kind]?.[1] || kind);
  COMP.changeShort = (e) => shortChange(e);
  COMP.TIMELINE_FILTERS = TIMELINE_FILTERS; // Who is moving (comp-summary.js) filters the same way

  /* `who` says whose timeline it is when the row isn't on that competitor's profile: { id, rival, own }. */
  function timelineFind(e, word, who = null) {
    const rival = who?.rival ?? view.data?.host ?? "", about = e.keyword || e.url || "", own = who ? who.own : view.data?.site?.host;
    const key = `timeline|${who?.id ?? view.data?.id}|${e.kind}|${about}|${e.at || ""}`;
    return { title: `${rival}: ${t(word)}${about ? ` · ${e.keyword || COMP.shortUrl(e.url)}` : ""}`, host: own, source: { type: "competitor", label: `${rival}: ${t(word)}`, host: own, facts: [e.keyword, e.url, e.at ? UI.fmtDateOnly(e.at) : ""].filter(Boolean), link: `#competitors/list/${who?.id ?? view.data?.id}`, key } };
  }

  function timelineRow(e, focusable, who = null, common = null) {
    const [ic, word] = KINDS[e.kind] || ["circle-dot", e.kind];
    const isMove = e.kind.startsWith("rank_");
    const isAi = e.kind.startsWith("ai_");
    const about = isMove || isAi ? ` <span class="kw">${KeywordLink.html(e.keyword, { id: e.keyword_id, host: who ? who.own : view.data?.site?.host || COMP.site?.()?.host })}</span>` : "";
    const aiSource = isAi && !common?.source ? COMP.toolLogos(e.engine, e.tool) : "";
    const detail = isMove ? moveDetail(e, common) : isAi ? (aiSource ? `<div class="d">${aiSource}</div>` : "") : e.kind === "new_page" || e.kind === "page_gone" ? "" : changeDetail(e);
    /* Only a marker of the kind of change, never a button: no box, just a coloured icon. */
    const tone = ["new_page", "rank_new", "rank_up", "ai_cited"].includes(e.kind) ? "up" : ["page_gone", "rank_lost", "rank_down", "ai_dropped"].includes(e.kind) ? "down" : "edit";
    return `<li ${focusable ? 'tabindex="-1" data-cl-first-new' : ""}><span class="cl-tl-ico cl-tl-${tone}" aria-hidden="true">${icon(ic)}</span><div class="what">${who ? `<div class="d cs-who"><span class="with-logo">${UI.siteLogo(who.rival, 16)}<span class="logo-text mono" dir="auto">${esc(who.display || who.rival)}</span></span> · ${esc(COMP.ago(e.at))}</div>` : ""}<div class="t">${esc(t(word))}${about}</div>${detail}${factsOf(e, common)}${window.ChangeSummary?.slot(e) || ""}${e.url ? `<div class="d">${COMP.link(e.url)}</div>` : ""}</div><div class="acts">${UI.taskButton(timelineFind(e, word, who), { label: "Task" })}</div></li>`;
  }
  COMP.timelineRow = (e, who, common = null) => timelineRow(e, false, who, common);

  /* The profile's timeline (2026-11-12). The owner found it about 10,000 px tall with hundreds of changes, each a tall block.
     Now: one compact row per change, paged like every long list (TP: 25/50/100 and a search), filtered by kind and period.
     Repeats are grouped: the same page with the same kind of change in the period is one row, "×3", dated by its latest.
     Why that grouping: the question here is "which of their pages are they working on, and how", and a page edited on six
     days is one story, not six rows; a day with many pages stays as many rows, each still dated. Everything known about a
     change (before and after, the page's facts, every date of a group) is behind the row's Details. Task shows on hover.
     Who is moving (comp-summary.js) keeps COMP.timelineRow: this only changes the profile. */
  const TL_PERIODS = [[7, "7 days"], [30, "30 days"], [0, "All"]];
  const TL_KIND = (kind) => (kind === "new_page" ? ["plus", "Added|change", "up"] : kind === "page_gone" ? ["minus", "Removed|change", "down"]
    : kind.startsWith("rank_") ? [KINDS[kind]?.[0] || "arrow-up", ["rank_new", "rank_up"].includes(kind) ? "Moved up|change" : "Moved down|change", ["rank_new", "rank_up"].includes(kind) ? "up" : "down"]
    : kind.startsWith("ai_") ? ["sparkles", kind === "ai_cited" ? "Cited by AI|change" : "Dropped by AI|change", kind === "ai_cited" ? "up" : "down"]
    : [KINDS[kind]?.[0] || "pencil", "Changed|change", "edit"]);
  const wordsOf = (v) => { const m = String(v ?? "").match(/^(\d+) words$/); return m ? Number(m[1]) : null; };
  const signed = (n) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${UI.num(Math.abs(n))}`;
  /* One short "what changed", in plain words. */
  function shortChange(e) {
    if (e.kind === "content") {
      const a = wordsOf(e.before), b = wordsOf(e.after);
      if (a !== null && b !== null) return tag(fill("{n} words|delta", { n: signed(b - a) })) + (Number.isFinite(e.changed_words) && e.changed_words > 0 && Math.abs(b - a) !== e.changed_words ? ` · ${fill("~{n} changed", { n: UI.num(e.changed_words) })}` : "");
      return t("Content changed");
    }
    if (e.kind === "headings" || e.kind === "h1" || e.kind === "schema") {
      const was = listItems(asList(e.before)), now = listItems(asList(e.after));
      const added = now.filter((x) => !was.includes(x)).length, gone = was.filter((x) => !now.includes(x)).length;
      const noun = e.kind === "schema" ? ["{n} structured data type", "{n} structured data types"] : ["{n} heading", "{n} headings"];
      const bits = [added ? `+${many(added, ...noun)}` : "", gone ? `−${many(gone, ...noun)}` : ""].filter(Boolean);
      return bits.length ? bits.join(", ") : t("Same items, new order.");
    }
    if (e.kind.startsWith("rank_")) return `${e.kind === "rank_new" ? `>${UI.num(e.depth || 10)}` : `#${UI.num(e.from)}`} → ${e.kind === "rank_lost" ? `>${UI.num(e.depth || 10)}` : `#${UI.num(e.to)}`}`;
    if (e.kind.startsWith("ai_")) return t(e.kind === "ai_cited" ? "Now cited in the AI Overview" : "No longer cited in the AI Overview");
    if (e.kind === "new_page" || e.kind === "page_gone") return e.page?.words ? many(e.page.words, "{n} word", "{n} words") : "";
    return t(KINDS[e.kind]?.[1] || e.kind); // title, meta, canonical…: the kind says it; before and after are in Details
  }
  const groupKey = (e) => `${e.kind.startsWith("rank_") || e.kind.startsWith("ai_") ? `k:${e.keyword}` : `u:${e.url || ""}`}|${e.kind}`;
  function timelineGroups(list) {
    const groups = new Map();
    list.forEach((e) => { const key = groupKey(e); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(e); });
    return [...groups.values()].map((all) => ({ e: all[0], all })); // the list comes newest first, so each group's first is its latest
  }
  const tlPath = (url) => { try { const u = new URL(url); return `${u.pathname}${u.search}` || "/"; } catch { return COMP.shortUrl(url); } };
  /* `who` (Who is moving, comp-summary.js, 2026-11-12): the row is in every competitor's list, so a Competitor column
     follows the date and the Task names that competitor. */
  function tlRow(g, common, who = null) {
    const e = g.e, [ic, word, tone] = TL_KIND(e.kind), [, full] = KINDS[e.kind] || ["", e.kind];
    const isMove = e.kind.startsWith("rank_") || e.kind.startsWith("ai_");
    const title = isMove ? e.keyword : e.page?.title || "";
    /* who.inline (the Competitors cards screen, 2026-11-16): no Competitor column. The page's title is the link, and the
       line under it says whose page it is, by logo and site, then its path, as in the owner's benchmark screenshot. */
    const inline = Boolean(who?.inline);
    /* A keyword's row: the keyword opens its details like every keyword in the app, so the page's address under it is the link to the page. */
    const path = !e.url ? "" : isMove ? COMP.link(e.url, tlPath(e.url), "cl-tl-path") : `<span class="cl-tl-path" dir="auto">${esc(tlPath(e.url))}</span>`;
    const owner = inline ? `<span class="second cl-tl-owner">${UI.siteLogo(who.rival, 14)}<span class="cl-tl-site" dir="auto">${esc(who.display || who.rival)}</span>${path ? `<span aria-hidden="true">·</span>${path}` : ""}</span>` : "";
    const where = inline
      ? `${isMove ? `<span class="kw cl-tl-title cl-tl-kw" dir="auto">${window.KeywordLink ? KeywordLink.html(e.keyword || "", { id: e.keyword_id, host: who.own }) : esc(e.keyword || "")}</span>` : e.url ? COMP.link(e.url, title || tlPath(e.url), "cl-tl-title cl-tl-link") : title ? `<span class="cl-tl-title" dir="auto">${esc(title)}</span>` : ""}${owner}`
      : isMove
        ? `<span class="kw" dir="auto">${esc(e.keyword || "")}</span>${e.url ? `<span class="second">${COMP.link(e.url, tlPath(e.url))}</span>` : ""}`
        : `${title ? `<span class="cl-tl-title" dir="auto">${esc(title)}</span>` : ""}${e.url ? `<span class="${title ? "second" : ""}">${COMP.link(e.url, tlPath(e.url))}</span>` : ""}`;
    const times = g.all.length > 1 ? `<span class="tag tabular cl-tl-times" data-tip="${esc(g.all.map((x) => UI.fmtDateOnly(x.at)).join(", "))}" tabindex="0">×${UI.num(g.all.length)}</span>` : "";
    const detail = isMove ? moveDetail(e, common) : e.kind === "new_page" || e.kind === "page_gone" ? "" : changeDetail(e);
    const dates = g.all.length > 1 ? `<div class="cl-dl-row"><dt>${esc(t("Dates"))}</dt><dd>${esc(g.all.map((x) => UI.fmtDateOnly(x.at)).join(" · "))}</dd></div>` : "";
    const facts = isMove ? moveDetails(e) : e.page ? pageDetails(e.page) : "";
    const more = `<details class="cl-more-facts cl-tl-more"><summary>${icon("chevron-right")}${t("Details")}</summary><div class="cl-tl-detail"><div class="t">${esc(t(full))}</div>${detail}${window.ChangeSummary?.slot(e) || ""}<dl class="cl-dl">${dates}${facts}</dl></div></details>`;
    return `<tr data-cl-tl-row="${esc(groupKey(e))}">
      <td class="nowrap cl-tl-date" data-label="${attr("Date")}">${COMP.ageCell(e.at)}</td>
      ${who && !inline ? `<td class="nowrap cl-tl-rival" data-label="${attr("Competitor")}"><span class="with-logo">${UI.siteLogo(who.rival, 16)}<span class="logo-text" dir="auto">${esc(who.display || who.rival)}</span></span></td>` : ""}
      <td class="nowrap cl-tl-kindcell" data-label="${esc(tag("Change|kind"))}"><span class="cl-tl-kind cl-tl-${tone}" data-tip="${esc(t(full))}">${icon(ic)}<span>${esc(tag(word))}</span></span>${times}</td>
      <td class="cl-tl-where" data-label="${attr(isMove ? "Keyword" : "Page")}">${where}</td>
      <td class="cl-tl-what" data-label="${attr("What changed")}"><span class="cl-tl-short">${esc(shortChange(e))}</span>${more}</td>
      <td class="r nowrap" data-label=""><span class="row-act">${UI.taskButton(timelineFind(e, full, who), { label: "Task" })}</span></td>
    </tr>`;
  }
  COMP.timelineTableRow = (e, who, common = null) => tlRow({ e, all: [e] }, common, who);

  function timelineBody(p) {
    const every = p.timeline || [];
    const days = view.tlDays || 0, since = days ? Date.now() - days * 86400000 : 0;
    const inPeriod = days ? every.filter((e) => new Date(e.at).getTime() >= since) : every;
    const filter = TIMELINE_FILTERS.find(([id]) => id === view.filter) || TIMELINE_FILTERS[0];
    const ofKind = (x, list) => (x[2] ? list.filter((e) => x[2].includes(e.kind)) : list);
    const searched = inPeriod.filter((e) => TP.matches(PAGES.timeline, e.keyword, e.url, e.page?.title, e.title, t(KINDS[e.kind]?.[1] || "")));
    const chips = `<div class="chips" role="group" aria-label="${attr("Filter the timeline")}">${TIMELINE_FILTERS.filter((x) => x[0] === "all" || x[0] === view.filter || ofKind(x, searched).length > 0).map((x) => `<button class="chip" data-cl-tl="${x[0]}" aria-pressed="${view.filter === x[0]}">${esc(tag(x[1]))}<b>${UI.num(ofKind(x, searched).length)}</b></button>`).join("")}</div>`;
    const period = `<div class="seg cl-tl-period" role="group" aria-label="${attr("Period")}">${TL_PERIODS.map(([n, w]) => `<button type="button" data-cl-tl-days="${n}" aria-pressed="${days === n}">${esc(t(w))}</button>`).join("")}</div>`;
    const search = every.length >= FIND_FROM || TP.state(PAGES.timeline).q ? TP.search(PAGES.timeline, t("Search pages, keywords, titles")) : "";
    const tools = `<div class="cp-tools cl-tl-tools">${search}${period}</div>${chips}`;
    const shown = ofKind(filter, searched);
    if (!shown.length) {
      const blocked = p.crawl?.status === "blocked" && ["edits", "new", "gone"].includes(filter[0]);
      const early = !p.crawl?.baseline_done && !blocked;
      const words = TP.state(PAGES.timeline).q ? t("No change matches these filters.") : blocked ? t("Site blocks bots: page changes can't be tracked.") : early ? t("Nothing yet: changes show from the second read.") : filter[0] === "rank" ? t("No moves yet: a move needs two checks by one tool.") : days && every.length ? t("Nothing in this period") : t("Nothing here yet.");
      return `${tools}<p class="cl-none small sec">${esc(words)}</p>`;
    }
    const groups = timelineGroups(shown);
    const page = TP.view(PAGES.timeline, groups);
    const common = moveCommon(page.rows.map((g) => g.e)); // what every move shown shares, said once over the list
    return `${tools}${moveCommonLine(common)}
      <div class="cl-pages"><div class="table-wrap cl-scroll"><table class="data cl-tl-table" data-tt-off>
        <thead><tr><th scope="col">${t("Date")}</th><th scope="col">${esc(tag("Change|kind"))}</th><th scope="col">${t("Page")}</th><th scope="col">${t("What changed")}</th><th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead>
        <tbody>${page.rows.map((g) => tlRow(g, common)).join("")}</tbody>
      </table></div>${TP.footer(PAGES.timeline, page, { noun: t(groups.length === shown.length ? "changes" : "rows") })}</div>
      ${groups.length < shown.length ? `<p class="small sec cl-tl-grouped">${esc(fill("{n} changes in {rows} rows: the same page with the same kind of change is one row (×).", { n: UI.num(shown.length), rows: UI.num(groups.length) }))}</p>` : ""}`;
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

  /* `unknown` is the reason this site's keyword numbers aren't known (no list, or never checked): then no counts, and one line that says why. */
  function keywordsBody(p, unknown = COMP.profileTabs?.keywordsWhy?.() ?? "") {
    // The search narrows every group, so each count says what that choice holds.
    const q = TP.state(PAGES.keywords).q, found = (k) => TP.matches(PAGES.keywords, k.keyword);
    const everyKeyword = p.keywords.length + (p.past_keywords || []).length;
    const listed = p.keywords.filter(found);
    const groups = { shared: listed.filter((k) => k.status === "shared"), theirs_only: listed.filter((k) => k.status === "theirs_only"), mine_only: listed.filter((k) => k.status === "mine_only"), past: (p.past_keywords || []).filter(found) };
    const seg = `<div class="seg cl-seg" role="group" aria-label="${attr("Which keywords")}">${[["shared", "Shared"], ["theirs_only", "Only them", "them"], ["mine_only", "Only you", "you"], ["past", "Past"]].map(([id, word, who]) => `<button data-cl-kw="${id}" aria-pressed="${view.kw === id}">${who ? COMP.who(who, null, t(word)) : t(word)}${unknown ? "" : ` <span class="tabular muted">${UI.num(groups[id].length)}</span>`}</button>`).join("")}</div>`;
    if (unknown && !p.keywords.length && !(p.past_keywords || []).length) return `<p class="cl-none small sec" data-cl-kw-unknown>${esc(unknown)}</p>`; // nothing to choose between yet, so no Shared / Only them buttons
    const search = everyKeyword >= FIND_FROM || q ? `<div class="cp-tools cl-tools">${TP.search(PAGES.keywords, t("Search keywords"))}</div>` : "";
    const rows = groups[view.kw] || [];
    const page = TP.view(PAGES.keywords, sortRows(rows, view.sort.key, view.sort.dir)), sorted = page.rows;
    const head = (key, label, cls = "", logo = "") => {
      const on = view.sort.key === key;
      return `<th scope="col" class="${cls}" aria-sort="${on ? (view.sort.dir > 0 ? "ascending" : "descending") : "none"}"><button type="button" class="th-btn" data-cl-sort="${key}">${logo}${t(label)}${icon(on && view.sort.dir < 0 ? "arrow-down" : "arrow-up")}</button></th>`;
    };
    const emptyWords = { shared: "No shared keywords yet.", theirs_only: "No keyword only they rank on.", mine_only: "No keyword only you rank on.", past: "None yet: keywords they've lost show here." };
    if (!rows.length && q) return `${seg}${search}<p class="cl-none small sec">${esc(t("No keyword matches."))} <button type="button" class="link-btn" data-tp-clear data-tp-key="${PAGES.keywords}">${t("Clear search")}</button></p>`;
    if (!rows.length) return `${seg}${search}<p class="cl-none small sec">${t(emptyWords[view.kw])}${view.kw === "past" ? UI.tip("A keyword lands here when they used to rank for it and the latest check no longer shows them.") : ""}</p>`;
    const place = (n, url, depth) => `<span class="cl-cell">${COMP.pos(n, depth)}${url ? `<span class="cl-url">${COMP.link(url)}</span>` : ""}</span>`;
    const table = view.kw === "past"
      ? `<table class="data cl-table"><thead><tr>${head("keyword", "Keyword")}${head("last_position", "Last position", "pt-col-them", UI.siteLogo(p.host, 16))}${head("last_seen", "Last seen")}<th scope="col">${t("Tool")}</th></tr></thead><tbody>${sorted.map((k) => `<tr>
          <td class="head-cell"><span class="kw">${KeywordLink.html(k.keyword, { id: k.keyword_id, host: COMP.site?.()?.host || p.site?.host })}</span></td>
          <td data-label="${attr("Last position")}">${place(k.last_position, k.last_url)}</td>
          <td data-label="${attr("Last seen")}">${COMP.ageCell(k.last_seen)}</td>
          <td data-label="${attr("Tool")}">${COMP.toolLogos(k.engine, k.tool)}</td></tr>`).join("")}</tbody></table>`
      : keywordTable(sorted, head, place);
    return `${seg}${search}<div class="cl-pages"><div class="cl-scroll">${table}</div>${TP.footer(PAGES.keywords, page, { noun: t("keywords") })}</div>`;
  }

  /* Positions centred under centred headings. When every row was checked by the same tool at the same age, that's said once under the table. */
  /* Recheck from a competitor's Keywords tab (2026-11-12, the owner): tick rows for "Recheck" in the selection bar, or use a row's own
     Recheck (shown on hover with the simpler screens). Both open Keywords' Refresh dialog through window.KW.recheck: the same preview,
     free-credit cost and Confirm, and nothing is spent without Confirm. A profile keyword has no id, so the site's tracked keywords
     (GET rankings) give it, by keyword and country. Once the dialog closes, the profile is asked again every few seconds until those
     keywords carry a newer check, then the positions and the Checked column are drawn again. */
  const kwKey = (k) => `${String(k.keyword).toLowerCase()}|${String(k.country || "").toUpperCase()}`;
  const recheck = { site: null, ids: null, loading: null, follow: null };
  function keywordIds() {
    const site = COMP.siteId;
    if (recheck.site === site && recheck.ids) return Promise.resolve(recheck.ids);
    if (recheck.site === site && recheck.loading) return recheck.loading;
    recheck.site = site; recheck.ids = null;
    recheck.loading = COMP.api("GET", `rankings?site_id=${site}`).then((d) => {
      const ids = new Map();
      (d.rows || []).forEach((r) => { if (r.keyword_id) ids.set(`${String(r.keyword).toLowerCase()}|${String(r.country || "").toUpperCase()}`, r.keyword_id); });
      if (recheck.site === site) recheck.ids = ids;
      return ids;
    }).finally(() => { recheck.loading = null; });
    return recheck.loading;
  }
  async function recheckKeywords(keys, opener) {
    if (!window.KW?.recheck) { UI.toast(t("Refresh needs the Keywords screen: open Keywords once, then try again."), { kind: "info" }); return; }
    const rows = (view.data?.keywords || []).filter((k) => keys.includes(kwKey(k)));
    if (!rows.length) return;
    let ids;
    try { ids = await keywordIds(); } catch (err) { fail(err); return; }
    const engine = rows[0].engine || "google";
    const wanted = rows.filter((k) => (k.engine || "google") === engine).map((k) => ids.get(kwKey(k))).filter(Boolean);
    if (!wanted.length) { UI.toast(t("These keywords aren't in your keyword list, so they can't be rechecked here."), { kind: "info" }); return; }
    const before = new Map(rows.map((k) => [kwKey(k), k.checked_at || ""]));
    const runsBefore = document.querySelectorAll(".kwr-run").length;
    const opened = await window.KW.recheck(wanted, { engine, opener });
    if (!opened) return;
    UI.$("#dlg")?.addEventListener("close", () => {
      if (document.querySelectorAll(".kwr-run").length <= runsBefore) return; // closed without Confirm: nothing runs, nothing to follow
      view.kwPicked?.clear(); paintKeywords();
      followRecheck(before);
    }, { once: true });
  }
  function followRecheck(before) {
    recheck.follow?.stop?.();
    const id = view.data?.id, site = COMP.siteId;
    recheck.follow = COMP.poll(async () => {
      if (view.data?.id !== id || COMP.siteId !== site || UI.state.route !== "competitors") return false;
      const fresh = await COMP.api("GET", `competitors/${id}/profile?site_id=${site}`, null, { fresh: true });
      const newer = (fresh.keywords || []).filter((k) => before.has(kwKey(k)) && (k.checked_at || "") > before.get(kwKey(k)));
      if (!newer.length) return true;
      Object.assign(view.data, { keywords: fresh.keywords, past_keywords: fresh.past_keywords, compare: fresh.compare });
      paintKeywords();
      return newer.length < before.size; // all of them newer: done
    }, { every: 4000, grow: 1.1, slowest: 15000, most: 10 * 60000 });
  }
  function kwSelbar() {
    const n = view.kwPicked?.size || 0;
    if (!n) return "";
    return `<div class="selbar cg-selbar cl-kw-selbar" id="cl-kw-selbar" role="region" aria-label="${attr("selected")}"><b class="cg-sel-count">${UI.num(n)} ${t("selected")}</b>
      <button type="button" class="btn btn-main btn-small" data-cl-recheck-picked>${icon("refresh-cw")}${t("Refresh")}</button>
      <button type="button" class="icon-btn" data-cl-kw-clear aria-label="${attr("Clear selection")}" data-tip="${attr("Clear selection")}">${icon("x")}</button></div>`;
  }

  function keywordTable(sorted, head, place) {
    const toolOf = (k) => `${k.tool || ""} · ${engineName(k.engine)}`;
    const ages = new Set(sorted.map((k) => COMP.ago(k.checked_at))), tools = new Set(sorted.map(toolOf));
    const once = sorted.length > 1 && tools.size === 1 && ages.size === 1;
    const toolCell = (k) => `<td data-label="${attr("Checked")}"><span class="cl-checked">${COMP.toolLogos(k.engine, k.tool)} ${COMP.ageCell(k.checked_at)}</span></td>`; // engine and tool as logos, then the age
    const logo = (host) => (host ? UI.siteLogo(host, 16) : ""); // You and Them carry their site's logo and colour, as on every table of the profile
    view.kwPicked ||= new Set();
    const allPicked = sorted.length > 0 && sorted.every((k) => view.kwPicked.has(kwKey(k)));
    return `<table class="data cl-table cl-kw-table"><thead><tr><th scope="col" class="chk-cell"><input type="checkbox" class="chk" data-cl-kw-all aria-label="${attr("Select all shown")}" ${allPicked ? "checked" : ""}></th>${head("keyword", "Keyword")}${head("my_position", "You", "c pt-col-you", logo(COMP.site?.()?.host || view.data?.site?.host))}${head("their_position", "Them", "c pt-col-them", logo(view.data?.host))}${once ? "" : head("checked_at", "Checked")}<th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead><tbody>${sorted.map((k) => `<tr data-cl-kw-row="${esc(kwKey(k))}">
          <td class="chk-cell"><input type="checkbox" class="chk" data-cl-kw-pick="${esc(kwKey(k))}" aria-label="${esc(fill("Select {keyword}", { keyword: k.keyword }))}" ${view.kwPicked.has(kwKey(k)) ? "checked" : ""}></td>
          <td class="head-cell"><span class="kw">${KeywordLink.html(k.keyword, { id: k.keyword_id, host: COMP.site?.()?.host || view.data?.site?.host })}</span>${COMP.profileTabs?.keywordMarks?.(k) ?? ""}</td>
          <td class="c" data-label="${attr("You")}">${place(k.my_position, k.my_url, k.depth)}</td>
          <td class="c" data-label="${attr("Them")}">${place(k.their_position, k.their_url, k.depth)}</td>
          ${once ? "" : toolCell(k)}
          <td class="r nowrap" data-label=""><button type="button" class="btn btn-small row-act" data-cl-recheck="${esc(kwKey(k))}" aria-label="${esc(fill("Refresh {keyword}", { keyword: k.keyword }))}">${icon("refresh-cw")}${t("Refresh")}</button></td></tr>`).join("")}</tbody></table>${once ? `<p class="small sec cl-kw-foot">${fillHtml("All checked with {tool}, {when}.", { tool: COMP.toolLogos(sorted[0].engine, sorted[0].tool), when: esc(COMP.ago(sorted[0].checked_at)) })}</p>` : ""}<div id="cl-kw-selbar-box">${kwSelbar()}</div>`;
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
    return `<section class="card" aria-label="${attr("Page vs page")}"><div class="card-head"><h2>${t("Page vs page")}</h2>${rows.length ? `<span class="tag tabular">${UI.num(rows.length)}</span>` : ""}</div>
      ${rows.length ? `<ul class="rows cl-pairs">${rows.map((x) => `<li>
        <div class="what cl-pair">${page(COMP.who("them"), x.their_title, x.their_url)}${page(COMP.who("you"), x.my_title, x.my_url)}</div>
        <div class="acts"><span class="small muted nowrap">${esc(many(x.shared_keywords || 0, "{n} shared keyword", "{n} shared keywords"))}</span><button class="btn btn-small" data-cl-pair="${x.id}">${icon("columns-3")}${t("Compare")}</button></div>
      </li>`).join("")}</ul>` : `<p class="cl-none small sec">${t("No pairs yet: one appears when you both rank for a keyword.")}</p>`}</section>`;
  }

  const headNote = (p) => baseNote(p) + (COMP.reading ? COMP.reading.box(p, COMP.siteId) : ""); // comp-reading.js: sitemap, big site, JavaScript, Firecrawl
  function baseNote(p) {
    const c = p.crawl || {};
    if (c.status === "blocked") return COMP.reading ? "" : `<p class="note warn cl-head-note">${icon("triangle-alert")}<span>${blockedHtml(c.message)} ${esc(t("Rankings, AI Overviews and shared keywords still work."))}</span></p>`;
    if (c.status === "failed") return `<p class="note crit cl-head-note">${icon("octagon-alert")}<span>${esc(t("Last read failed. Trying again at the next daily read; rankings still work."))}${c.message ? ` <span class="small mono cl-wrap" dir="auto">${esc(say(c.message))}</span>` : ""}</span></p>`; // the app's own sentences (reading.STOPPED_READ…) in French; a raw error stays as sent
    return "";
  }
  const paused = (p) => p.tracking === "off"; // tracking off: nothing is read, so no "Watching" and no Read now
  const watchArea = (p) => (paused(p) ? `<span class="cl-watch"><span class="status sec">${icon("pause")}${esc(t("Paused"))}</span></span>` : `${watching(p.crawl, null, { follow: true })}`);
  function paintWatch() {
    const p = view.data, box = UI.$("#cl-watch-state");
    if (!p || !box) return;
    UI.setHTML(box, watchArea(p));
    const read = UI.$("[data-cl-read]");
    if (read) read.disabled = crawling(p.crawl);
    if (read) read.hidden = paused(p);
    const note = UI.$("#cl-head-note");
    if (note) UI.setHTML(note, headNote(p));
  }

  /* Simpler screens, the profile header (plan section 2): "Tracking: On ▾" is one button that opens the three choices, and
     Refresh data and Remove sit behind a ⋯ after Notes. The choices and buttons are the same controls as before. */
  const TRACK_WORD = { on: "On", pages: "Pages only", off: "Off" };
  const trackButton = (p) => `<button type="button" class="btn btn-small cl-track-btn" data-cl-track="${p.id}" aria-haspopup="menu" aria-expanded="false">${esc(fill("Tracking: {state}", { state: t(TRACK_WORD[COMP.trackingOf?.(p) || "on"]) }))}${icon("chevron-down", "chev")}</button>`;
  function openTrackMenu(button) {
    const p = view.data;
    if (!p) return;
    UI.popover(button, `<div class="cs-menu" role="menu" aria-label="${attr("Tracking")}"><p class="cs-menu-lab">${t("Tracking")}</p>${COMP.trackingSwitch?.(p) ?? ""}</div>`, "cs-menu-pop");
  }
  function openMoreMenu(button) {
    const p = view.data;
    if (!p) return;
    UI.popover(button, `<div class="cs-menu" role="menu" aria-label="${attr("More")}">
      <button type="button" class="cs-menu-item" role="menuitem" data-cl-read="${p.id}" ${crawling(p.crawl) || paused(p) ? "disabled" : ""}>${icon("refresh-cw")}${t("Refresh data")}</button>
      <button type="button" class="cs-menu-item" role="menuitem" data-cl-remove="${p.id}">${icon("trash-2")}${t("Remove")}</button></div>`, "cs-menu-pop");
  }

  function profileBody() {
    const p = view.data;
    const simpleHead = Boolean(UI.simple?.());
    const url = `https://${p.host}/`;
    return `<p class="cl-back"><button type="button" class="btn btn-ghost btn-small" data-cl-back>${icon("chevron-left")}${t("Back to competitors")}</button></p>
      <section class="card cl-head" aria-labelledby="cl-profile-title">
        <div class="cl-head-row">
          <div class="cl-head-main">
            <h2 id="cl-profile-title" tabindex="-1">${UI.siteLogo(p.host, 24)} ${COMP.link(url, p.display || p.host, "cl-head-link")}${icon("external-link", "muted")}${simpleHead ? trackButton(p) : COMP.trackingSwitch?.(p) ?? ""}</h2>
            ${COMP.profileTabs?.factsLine?.(p, view.insights) ?? ""}
            ${UI.relatedTag?.({ host: "", item: { kind: "competitor", ref: p.id }, label: p.host }) ?? ""}
            <p class="small sec cl-head-meta" data-tip="${esc(`${howAdded(p.source)} · ${fill("added {when}", { when: COMP.ago(p.added_at) })}`)}">${COMP.siteId === COMP.ALL ? `${esc(fill("compared with {site}", { site: p.site?.host || "" }))} · ` : ""}<span id="cl-watch-state" class="cl-head-watch">${watchArea(p)}</span></p>
          </div>
          <div class="cl-head-acts">${COMP.notes?.button?.([{ label: p.display || p.host, icon: "crosshair", where: { scope: "competitor", competitorId: p.id, siteId: COMP.siteId } }]) ?? ""}${simpleHead ? `<button type="button" class="icon-btn cl-more-btn" data-cl-more="${p.id}" aria-haspopup="menu" aria-expanded="false" aria-label="${attr("More")}" data-tip="${attr("Refresh data and Remove")}">${icon("ellipsis")}</button>` : `<button class="btn" data-cl-read="${p.id}" ${crawling(p.crawl) ? "disabled" : ""} ${paused(p) ? "hidden" : ""}>${icon("refresh-cw")}${t("Refresh data")}</button><button class="btn btn-ghost" data-cl-remove="${p.id}">${icon("trash-2")}${t("Remove")}</button>`}</div>
        </div>
        <div id="cl-head-note">${headNote(p)}</div>
        ${COMP.profileTabs?.headBlock?.(p, view.insights) ?? ""}
      </section>
      ${COMP.profileTabs ? COMP.profileTabs.body(p, view.insights, profileParts) : `${compareBody(p)}${pairsCard(p)}`}`;
  }
  /* What the tabs in comp-profile-tabs.js borrow from here: the keyword table and the timeline stay in this file. */
  const profileParts = {
    keywordsBody: (p) => keywordsBody(p),
    timelineBody: (p) => timelineBody(p),
    showKeywords: (kind) => { view.kw = kind; view.sort = { key: "keyword", dir: 1 }; TP.reset(PAGES.keywords); },
  };

  async function readNow(id, button) {
    if (button) button.disabled = true;
    try {
      await COMP.api("POST", `competitors/${id}/crawl?site_id=${COMP.siteId}`);
      const set = (crawl) => ({ ...(crawl || {}), status: "queued" });
      if (view.data?.id === id) { view.data.crawl = set(view.data.crawl); paintWatch(); }
      const row = (list.rows || []).find((c) => c.id === id);
      if (row) row.crawl = set(row.crawl);
      UI.toast(t("Reading its pages, 3 seconds apart. It can take a while."), { kind: "info" });
      watchCrawls();
    } catch (err) {
      if (button?.isConnected) button.disabled = false;
      fail(err);
    }
  }

  /* Try again on a failed read, from the list or the All my sites summary. The cell follows the read until it ends,
     and comp:crawl tells other screens (the summary keeps its own copy of the rows). */
  function paintCrawl(id, site, crawl) {
    UI.$$(`[data-cl-watch="${id}"]`).forEach((cell) => UI.setHTML(cell, watching(crawl, { id, site })));
    window.dispatchEvent(new CustomEvent("comp:crawl", { detail: { id, crawl } }));
  }
  function followRead(id, site) {
    COMP.poll(async () => {
      if (!UI.$(`[data-cl-watch="${id}"]`)) return false; // the screen moved on
      const { crawl } = await COMP.api("GET", `competitors/${id}/reading?site_id=${site}`);
      paintCrawl(id, site, crawl);
      return crawling(crawl);
    }, { every: 2500, grow: 1.2, slowest: 30000, most: 30 * 60000 });
  }
  async function retryRead(id, site, button) {
    button.disabled = true;
    try {
      await COMP.api("POST", `competitors/${id}/crawl?site_id=${site}`);
    } catch (err) {
      if (button.isConnected) button.disabled = false;
      fail(err);
      return;
    }
    const row = COMP.siteId === site ? (list.rows || []).find((c) => c.id === id) : null;
    const crawl = { ...(row?.crawl || {}), status: "queued" };
    if (row) row.crawl = crawl;
    paintCrawl(id, site, crawl);
    UI.toast(t("Reading its pages, 3 seconds apart. It can take a while."), { kind: "info" });
    if (row && here("list", site) && !listTab.competitorId) watchCrawls();
    else followRead(id, site);
  }

  // ---- Tab: My competitors --------------------------------------------------------------------------
  const listTab = {
    id: "list", order: 10, label: "My competitors", icon: "crosshair", hidden: true, // merged into Competitors (comp-summary.js) on 2026-11-09; this tab only draws the profile
    competitorId: null,
    init(helpers) {
      UI = helpers; bindEvents();
      TP.on(PAGES.list, () => COMP.paint()); // another page, another size or a search; the helper keeps the focus
      TP.on(PAGES.keywords, () => paintKeywords());
      TP.on(PAGES.timeline, () => paintTimeline());
    },
    async load() {
      const site = COMP.siteId;
      if (list.site !== null && list.site !== site) { TP.state(PAGES.list).q = ""; TP.reset(PAGES.list); }
      const [answer, found] = await Promise.all([
        COMP.api("GET", `competitors?site_id=${site}`),
        COMP.api("GET", `competitors/suggestions?site_id=${site}`).catch(() => null), // only for the empty state and the count on the tab
      ]);
      const id = listTab.competitorId;
      let detail = null;
      let insights = null;
      if (id && answer.competitors.some((c) => c.id === id)) {
        try { detail = await COMP.api("GET", `competitors/${id}/profile?site_id=${site}`); } catch (err) { fail(err); }
        if (detail) insights = await COMP.profileTabs?.load?.(detail, site); // a failure here leaves the rest of the profile working
      }
      if (site !== COMP.siteId || listTab.competitorId !== id) return;
      list.rows = answer.competitors;
      list.site = site;
      if (found) { find.data = found; find.site = site; }
      if (!detail) listTab.competitorId = null;
      else if (view.shownId !== id) {
        // A different competitor starts at the top, with the keyboard on its name.
        Object.assign(view, { filter: "all", limit: 50, kw: "shared", sort: { key: "keyword", dir: 1 }, shownId: id });
        TP.state(PAGES.keywords).q = ""; TP.reset(PAGES.keywords);
        pending = () => {
          const main = UI.$("#main");
          if (main) main.scrollTop = 0;
          UI.$("#cl-profile-title")?.focus({ preventScroll: true });
        };
      }
      if (!detail) view.shownId = null;
      view.data = detail;
      view.insights = insights || null;
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
    const stay = t("Keeps going if you leave.");
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
    const state = !d.keywords_checked ? t("None checked yet.") : left ? many(left, "{n} left to check.", "{n} left to check.") : "";
    return `<section class="card cl-waiting" id="cl-waiting" aria-label="${attr("Waiting for a search tool")}">
      <div class="cl-waiting-main">
        <span class="ico">${icon("clock")}</span>
        <div class="cl-waiting-words">
          <h2>${esc(saved)} ${esc(state)} ${t("Nothing is lost.")}</h2>
          <p class="sec">${esc(say(run.stop_reason || "No search tool connected: add a key in Settings."))}</p>
          <p class="small muted">${t("Free tools only. Resumes by itself when a tool is ready or checks refill.")}</p>
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
    const stillMine = () => find.polling === key;
    COMP.poll(async () => {
      if (!stillMine()) return false;
      if (!here("find", site)) { find.polling = null; return false; }
      const now = await COMP.api("GET", `keywords/runs/${run.id}`);
      if (!stillMine()) return false;
      if (!here("find", site)) { find.polling = null; return false; }
      if (live ? runActive(now) : now.status === "waiting") {
        if (live) paintRun(now);
        return true;
      }
      find.polling = null;
      await COMP.reload({ quiet: true });
      if (now.status === "complete" && here("find", site)) {
        const n = findData()?.suggestions?.length || 0;
        UI.toast(`${many(now.checked || 0, "{n} keyword checked.", "{n} keywords checked.")} ${many(n, "{n} suggestion to review.", "{n} suggestions to review.")}`);
      }
      return false;
    }, {
      // A run in progress: every 1.5 s, slower as it goes. A list waiting for a tool: every 4 s, then every half minute at most.
      every: live ? 1500 : 4000, grow: live ? 1.05 : 1.3, slowest: live ? 10000 : 30000, most: live ? 60 * 60000 : 30 * 60000,
      onEnd: (why) => { if (why !== "done" && find.polling === key) find.polling = null; },
    });
  }

  // ---- Find competitors: the suggestions --------------------------------------------------------------
  /* Up to 100 keywords a suggestion ranks on, in pages. Each fold has its own pages, and draws only itself again. */
  function evidenceTable(item) {
    const key = EVIDENCE(item.domain), page = TP.view(key, item.evidence || []), rows = page.rows;
    TP.on(key, () => {
      const inner = UI.$$("[data-cl-evidence]").find((fold) => fold.dataset.clEvidence === item.domain)?.querySelector(".cl-evidence-body");
      if (inner) UI.setHTML(inner, evidenceTable(item));
    });
    const place = (e) => `<span class="cl-cell">${COMP.pos(e.position, e.my_depth)}${e.url ? `<span class="cl-url">${COMP.link(e.url)}</span>` : ""}</span>`;
    const capped = (item.keywords || 0) > page.total ? fill("First {n} shown.", { n: UI.num(page.total) }) : null;
    // Engine and tool as logos, then the age. When every row says the same, the column goes and it's said once under the table (2026-11-11).
    const once = rows.length > 1 && new Set(rows.map((e) => `${e.engine || ""}|${e.tool || ""}|${COMP.ago(e.checked_at)}`)).size === 1;
    const onceLine = once ? `<p class="small sec cl-kw-foot">${fillHtml("All checked with {tool}, {when}.", { tool: COMP.toolWords(rows[0].engine, rows[0].tool), when: esc(COMP.ago(rows[0].checked_at)) })}</p>` : "";
    return `<div class="cl-pages"><div class="cl-scroll"><table class="data cl-table"><thead><tr><th scope="col">${t("Keyword")}</th><th scope="col" class="pt-col-them">${COMP.who("them", null, t("Their position"))}</th><th scope="col" class="pt-col-you">${COMP.who("you", null, t("Your position"))}</th>${once ? "" : `<th scope="col">${t("Checked")}</th>`}</tr></thead><tbody>
      ${rows.map((e) => `<tr>
        <td class="head-cell"><span class="kw">${KeywordLink.html(e.keyword, { id: e.keyword_id, host: COMP.site?.()?.host })}</span></td>
        <td data-label="${attr("Their position")}">${place(e)}</td>
        <td data-label="${attr("Your position")}">${COMP.pos(e.my_position, e.my_depth)}</td>
        ${once ? "" : `<td data-label="${attr("Checked")}"><span class="cl-checked">${COMP.toolLogos(e.engine, e.tool)} ${COMP.ageCell(e.checked_at)}</span></td>`}
      </tr>`).join("")}</tbody></table></div>${TP.footer(key, page, { noun: t("keywords"), capped })}</div>${onceLine}`;
  }

  function evidenceFold(item) {
    if (!item.evidence?.length) return "";
    const open = find.open.has(item.domain);
    return `<details class="cl-evidence" data-cl-evidence="${esc(item.domain)}" ${open ? "open" : ""}><summary>${icon("chevron-right")}${t("Evidence")}</summary><div class="cl-evidence-body">${open ? evidenceTable(item) : ""}</div></details>`;
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
      ${fact(t("Top 3 on"), UI.num(item.top3))}
      ${fact(t("Shared keywords"), UI.num(item.both_rank))}
    </div>`;
  }

  function suggestionRow(item, d) {
    const name = item.display || item.domain;
    return `<li class="cl-sug" data-cl-sug="${esc(item.domain)}">
      <div class="what">
        <div class="cl-sug-name">${UI.siteLogo(item.domain, 18)}<span class="kw" dir="auto">${esc(name)}</span>${item.new ? `<span class="tag">${esc(tag("New|tag"))}</span>` : ""}${item.kind ? `<span class="tag">${t(item.kind === "public" ? "Public body" : "Big site")}</span>` : ""}</div>
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
        <div class="cl-sug-name">${UI.siteLogo(item.domain, 18)}<span class="kw" dir="auto">${esc(name)}</span><span class="small muted">${esc(fill("Dismissed {when}", { when: COMP.ago(item.dismissed_at) }))}</span></div>
        ${seen}
      </div>
      <div class="acts"><button class="btn btn-small" data-cl-restore="${esc(item.domain)}" aria-label="${attr("Restore")}: ${esc(name)}">${t("Restore")}</button></div>
      ${evidenceFold(item)}
    </li>`;
  }

  function groupCard(id, title, n, intro, rows, tip = "") {
    if (!n) return "";
    return `<details class="card cl-group" data-cl-group="${id}" ${find.groups.has(id) ? "open" : ""}><summary class="card-head">${icon("chevron-right")}<h2>${t(title)}</h2><span class="tag tabular">${UI.num(n)}</span></summary>
      <p class="help cl-group-intro">${t(intro)}${tip ? UI.tip(tip) : ""}</p>
      <ul class="rows">${rows}</ul></details>`;
  }

  function checkedBand(d, run) {
    const bits = [d.last_check ? fill("Checked {when}", { when: COMP.ago(d.last_check) }) : t("Not checked")];
    if (d.tools?.length) bits.push(d.tools.join(", "));
    bits.push(many(d.keywords_total, "{done} of {n} keyword", "{done} of {n} keywords", { done: UI.num(d.keywords_checked) }));
    const failed = run?.status === "complete" && run.failed ? many(run.failed, "{n} check failed last run.", "{n} checks failed last run.") : "";
    const rule = d.min_appearances > 1 ? fill("A domain needs {n}+ keywords to be suggested.", { n: UI.num(d.min_appearances) }) : "";
    const canCheck = d.keywords_checked > 0 && run?.status !== "waiting";
    return `<section class="tool-band cl-band" aria-label="${attr("Your keyword list")}">
      <p><span class="cl-band-main">${icon("clock")}<span id="cl-checked-line">${esc(bits.join(" · "))}</span></span>${failed || rule ? `<span class="small muted cl-band-sub">${esc([failed, rule].filter(Boolean).join(" "))}</span>` : ""}</p>
      <div class="cl-band-acts"><button class="btn" data-cl-upload>${icon("upload")}${t("Upload keywords")}</button>${canCheck ? `<button class="btn" id="cl-check-again" ${runActive(run) ? "disabled" : ""}>${icon("refresh-cw")}${t("Refresh")}</button>` : ""}</div>
    </section>`;
  }

  function findBody() {
    remember();
    const d = findData();
    if (!d) return COMP.loading();
    const run = d.run;
    const rule = `<p class="prospect-note">${icon("info")}<span>${t("Suggestions from search results, no AI. Nothing is added until you accept.")}</span></p>`;
    if (!d.keywords_total && !runActive(run) && run?.status !== "waiting") {
      return `${rule}${COMP.empty(t("No keywords yet"), t("See who ranks most on your keywords, using free tools only."), `<button class="btn btn-main" data-cl-upload>${icon("upload")}${t("Upload keywords")}</button>`, UI.tip("Each keyword is checked once, with free tools only, then the domains that appear most often are suggested."))}`;
    }
    const suggestions = d.suggestions?.length
      ? `<section class="card" aria-label="${attr("Suggestions")}"><div class="card-head"><h2>${t("Suggestions")}</h2><span class="tag tabular">${UI.num(d.suggestions.length)}</span></div><ul class="rows">${d.suggestions.map((x) => suggestionRow(x, d)).join("")}</ul></section>`
      : `<section class="card"><div class="empty cl-none-big"><h3>${t(d.keywords_checked ? "No suggestions" : "No suggestions yet")}</h3><p>${t(d.keywords_checked ? "No domain appears often enough on your keywords yet." : "They appear once your keywords are checked.")}</p></div></section>`;
    return `${rule}
      ${runActive(run) ? runBanner(run) : ""}
      ${run?.status === "waiting" ? waitingNote(run, d) : ""}
      ${checkedBand(d, run)}
      ${suggestions}
      ${groupCard("platforms", "Big sites and public bodies", d.platforms?.length || 0, "They rank for almost everything, so rarely real competitors.", (d.platforms || []).map((x) => suggestionRow(x, d)).join(""), "These rank for almost everything, so they're rarely real competitors. You can still accept one if you want to watch it.")}
      ${groupCard("dismissed", "Dismissed", d.dismissed?.length || 0, "They stay dismissed until you restore them.", (d.dismissed || []).map((x) => dismissedRow(x, d)).join(""))}`;
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
      UI.toast(fill("{host} dismissed until you restore it.", { host: domain }), {
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
      UI.toast(shown ? fill("{host} restored.", { host: domain }) : fill("{host} restored; it returns if seen often enough.", { host: domain }), { kind: "info" });
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
      <div class="dlg-body"><p>${esc(many(d.keywords_total, "Uses {n} free check.", "Uses {n} free checks."))}</p><p class="small sec" style="margin-top:8px">${t("Never spends paid credits. If free checks run out, it pauses and resumes when they refill.")}</p></div>
      <div class="dlg-foot"><button class="btn" data-close-dlg>${t("Cancel")}</button><button class="btn btn-main" data-cl-check-yes>${t("Refresh")}</button></div>`);
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
  const ENCODINGS = [["windows-1252", "Western European"], ["windows-1256", "Arabic"], ["shift_jis", "Japanese"], ["euc-kr", "Korean"], ["gbk", "Chinese, simplified"], ["big5", "Chinese, traditional"], ["windows-1251", "Cyrillic"], ["windows-1250", "Central European"], ["windows-1253", "Greek"], ["windows-1254", "Turkish"], ["windows-1255", "Hebrew"], ["windows-874", "Thai"], ["windows-1258", "Vietnamese"]];
  const LIKELY_ENCODING = { ar: "windows-1256", fa: "windows-1256", ur: "windows-1256", ja: "shift_jis", ko: "euc-kr", zh: "gbk", ru: "windows-1251", uk: "windows-1251", bg: "windows-1251", sr: "windows-1251", kk: "windows-1251", cs: "windows-1250", sk: "windows-1250", pl: "windows-1250", hu: "windows-1250", ro: "windows-1250", hr: "windows-1250", sl: "windows-1250", sq: "windows-1250", el: "windows-1253", tr: "windows-1254", he: "windows-1255", th: "windows-874", vi: "windows-1258" };

  const languageOptions = () => UI.languageOptions("");

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
      UI.setHTML(info, `<div class="cl-file-row">${icon("file-text")}<span class="mono small cl-file-name" dir="auto">${esc(upload.file.name)}</span><button type="button" class="link-btn" id="cl-file-remove">${t("Remove file")}</button></div>
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
    UI.openPanel(`${UI.panelHead(t("Upload keywords"), `${t("For")} <span class="mono">${esc(COMP.site()?.host || "")}</span>`)}
      <form class="panel-body" id="cl-upload-form" novalidate>
        <div class="cl-drop" id="cl-drop">${icon("upload")}<b>${t("Drop a file here")}</b><span>${t("or")} <button type="button" class="link-btn" id="cl-file-pick" style="font-size:inherit" data-autofocus>${t("choose a file")}</button></span><span class="small muted">${t(".csv or .txt, any encoding, 10 MB max.")}</span><input type="file" id="cl-file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden></div>
        <div id="cl-file-info" class="cl-file-info cl-hide"></div>
        <div id="cl-file-error"></div>
        <label class="field cl-hide" id="cl-encoding"><span>${t("Not Unicode. If the words above look wrong, pick its encoding.")}</span><select class="select" id="cl-up-encoding" style="width:100%">${ENCODINGS.map(([id, name]) => `<option value="${id}">${t(name)}</option>`).join("")}</select></label>
        <label class="field" id="cl-paste"><span>${t("Or paste your keywords, one per line")}</span><textarea class="input cl-paste-box" id="cl-up-text" rows="7" dir="auto" spellcheck="false" aria-describedby="cl-up-count cl-up-error"></textarea><div class="help" id="cl-up-count" aria-live="polite"></div><div id="cl-up-error"></div></label>
        <div class="field-row">
          <label class="field"><span>${t("Country")}</span><select class="select" id="cl-up-country" style="width:100%"><option value="">${t("Any country")}</option>${UI.countryOptions("")}</select></label>
          <label class="field"><span>${t("Language")}</span><select class="select" id="cl-up-language" style="width:100%"><option value="">${t("Any language")}</option>${languageOptions()}</select></label>
        </div>
        <div id="cl-up-market-error"></div>
        <p class="note">${icon("info")}<span>${t("Free tools only, never paid credits. If free checks run out, it pauses and resumes when they refill.")}</span></p>
      </form>
      <div class="panel-foot"><button class="btn btn-main" id="cl-up-save">${t("Save and check")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener, { key: `cl-upload|${site}`, reopen: () => openUpload(opener), after: paintUpload });
  }

  async function pickFile(file) {
    if (!file) return;
    const box = UI.$("#cl-file-error");
    if (box) box.replaceChildren();
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) { fieldError(null, box, t("Choose a .csv or .txt file.")); return; }
    if (file.size > MAX_BYTES) { fieldError(null, box, t("File too large: 10 MB at most.")); return; }
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
      const message = t("No keywords found. Use one per line, or a column named keyword.");
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
      if (run.status === "complete" && !run.new_keywords) UI.toast(many(run.total, "Already checked: nothing searched.", "{n} keywords already checked: nothing searched."), { kind: "info" });
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
      if (tabButton?.dataset.compTab === "list" || tabButton?.dataset.compTab === "summary") { listTab.competitorId = null; COMP.profileTabs?.leave?.(); }
      sendKeyToServer(e);
    }, true);

    document.addEventListener("click", (e) => {
      if (performance.now() < ignoreUntil) return;
      const hit = (sel) => e.target.closest?.(sel);
      let el;
      if (hit(".cs-menu [data-ct-set], .cs-menu [data-cl-read], .cs-menu [data-cl-remove]") && UI.$("[data-cl-track][aria-expanded=\"true\"], [data-cl-more][aria-expanded=\"true\"]")) {
        const from = UI.$("[data-cl-track][aria-expanded=\"true\"]") ? "[data-cl-track]" : "[data-cl-more]";
        COMP.refocus = from;
        setTimeout(() => { UI.closePopover?.(); if (!document.activeElement || document.activeElement === document.body) UI.$(from)?.focus({ preventScroll: true }); }, 0);
      }

      // My competitors
      if (hit("#cl-add-open")) { openAdd(hit("#cl-add-open")); return; }
      if (hit("#cl-add-save")) { submitAdd(); return; }
      if (hit("[data-cl-go-find]")) { COMP.open("find"); pending = () => UI.$("[data-cl-upload]")?.focus({ preventScroll: true }); return; }
      if ((el = hit("[data-cl-remove-yes]"))) { const id = Number(el.dataset.clRemoveYes); UI.$("#dlg").close(); hold(); removeNow(id); return; }
      if ((el = hit("[data-cl-remove]"))) { confirmRemove(Number(el.dataset.clRemove)); return; }
      if ((el = hit("[data-cl-retry]"))) { retryRead(Number(el.dataset.clRetry), Number(el.dataset.clRetrySite), el); return; }
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
      if ((el = hit("[data-cl-track]"))) { openTrackMenu(el); return; }
      if ((el = hit("[data-cl-more]"))) { openMoreMenu(el); return; }
      if ((el = hit("[data-cl-recheck]"))) { recheckKeywords([el.dataset.clRecheck], el); return; }
      if ((el = hit("[data-cl-recheck-picked]"))) { recheckKeywords([...(view.kwPicked || [])], el); return; }
      if (hit("[data-cl-kw-clear]")) { view.kwPicked?.clear(); paintKeywords(() => UI.$("[data-cl-kw-all]")?.focus({ preventScroll: true })); return; }
      if ((el = hit("[data-cl-tl-days]"))) {
        view.tlDays = Number(el.dataset.clTlDays) || 0;
        TP.reset(PAGES.timeline);
        paintTimeline(() => focusAttr("data-cl-tl-days", String(view.tlDays))?.focus({ preventScroll: true }));
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
        view.sort = { key: "keyword", dir: 1 };
        TP.reset(PAGES.keywords);
        paintKeywords(() => focusAttr("data-cl-kw", id)?.focus({ preventScroll: true }));
        return;
      }
      if ((el = hit("[data-cl-sort]"))) {
        const key = el.dataset.clSort;
        view.sort = view.sort.key === key ? { key, dir: -view.sort.dir } : { key, dir: key === "checked_at" || key === "last_seen" ? -1 : 1 };
        TP.reset(PAGES.keywords);
        paintKeywords(() => focusAttr("data-cl-sort", key)?.focus({ preventScroll: true }));
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
    document.addEventListener("input", (e) => { if (e.target.id === "cl-add-address") { fieldClear(e.target, UI.$("#cl-add-error")); paintAddCount(); } });
    // In the address box Enter starts a new line, so Cmd or Ctrl + Enter adds.
    document.addEventListener("keydown", (e) => { if (e.target.id === "cl-add-address" && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitAdd(); } });
    document.addEventListener("change", (e) => {
      if (e.target.matches?.("[data-cl-kw-pick], [data-cl-kw-all]")) {
        view.kwPicked ||= new Set();
        const boxes = UI.$$("[data-cl-kw-pick]");
        if (e.target.matches("[data-cl-kw-all]")) boxes.forEach((b) => { b.checked = e.target.checked; });
        boxes.forEach((b) => { if (b.checked) view.kwPicked.add(b.dataset.clKwPick); else view.kwPicked.delete(b.dataset.clKwPick); });
        const all = UI.$("[data-cl-kw-all]");
        if (all) { const on = boxes.filter((b) => b.checked).length; all.checked = on > 0 && on === boxes.length; all.indeterminate = on > 0 && on < boxes.length; }
        const box = UI.$("#cl-kw-selbar-box");
        if (box) UI.setHTML(box, kwSelbar());
        return;
      }
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
    if (!host) refuse("Not a website address.");
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
    if (at < 0) refuse("Competitor not found.", 404);
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
    if (!sampleHost(clean)) refuse("Not a website domain.");
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
    if (!names.length) refuse("No keywords found. Use one per line, or a column named keyword.");
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
    if (runActive(answer.run)) refuse("A check is already running.", 409);
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
    if (!row) refuse("Competitor not found.", 404);
    simulateRead(row.host);
    return { ok: true };
  });
  COMP.sampleWrite("POST keywords/upload", (match, body, opts) => sampleUpload(body, opts));
  COMP.sampleWrite("POST keywords/refresh", (match, body) => sampleRefresh(body));

  // ---- French ------------------------------------------------------------------------------------------------------
  Object.assign(window.FR, {
    "Added|change": "Ajoutée", "Removed|change": "Retirée", "Changed|change": "Modifiée", "Moved up|change": "Monte", "Moved down|change": "Descend",
    "Now cited in the AI Overview": "Désormais cité dans l'aperçu IA", "No longer cited in the AI Overview": "Plus cité dans l'aperçu IA",
    "Cited by AI|change": "Citée par l'IA", "Dropped by AI|change": "Plus citée par l'IA", "Change|kind": "Changement", "rows": "lignes",
    "{n} words|delta": "{n} mots", "~{n} changed": "~{n} modifiés", "{n} structured data type": "{n} type de données structurées", "{n} structured data types": "{n} types de données structurées",
    "{n} changes in {rows} rows: the same page with the same kind of change is one row (×).": "{n} changements en {rows} lignes : une même page avec le même type de changement tient sur une ligne (×).",
    "Tracking: {state}": "Suivi : {state}", "Refresh data and Remove": "Actualiser et retirer",
    "Recheck {keyword}": "Revérifier {keyword}", "Refresh {keyword}": "Actualiser {keyword}", "Refresh needs the Keywords screen: open Keywords once, then try again.": "L'actualisation passe par l’écran Mots-clés : ouvrez-le une fois, puis réessayez.", "Select {keyword}": "Sélectionner {keyword}",
    "Recheck needs the Keywords screen: open Keywords once, then try again.": "La revérification passe par l’écran Mots-clés : ouvrez-le une fois, puis réessayez.",
    "These keywords aren't in your keyword list, so they can't be rechecked here.": "Ces mots-clés ne sont pas dans votre liste, ils ne peuvent pas être revérifiés ici.",
    "Details": "Détails", "{n} word": "{n} mot", "{n} words": "{n} mots", "{n} heading": "{n} titre", "{n} headings": "{n} titres",
    "{n} image": "{n} image", "{n} images": "{n} images", "{n} video": "{n} vidéo", "{n} videos": "{n} vidéos",
    "{a} internal · {b} external links": "{a} liens internes · {b} externes", "published {date}": "publiée le {date}", "sitemap {date}": "sitemap {date}",
    "Date the page gives": "Date donnée par la page", "changed {n} time": "modifiée {n} fois", "changed {n} times": "modifiée {n} fois",
    "First {n} of {total}.": "{n} premiers sur {total}.", "({n} without alt text)": "({n} sans texte alternatif)",
    "Firecrawl": "Firecrawl", "Browser (needs JavaScript)": "Navigateur (JavaScript requis)",
    "{n} character": "{n} caractère", "{n} characters": "{n} caractères",
    "Title": "Titre", "Meta description": "Méta-description", "Main heading (H1)": "Titre principal (H1)", "Headings": "Titres", "Questions in headings": "Questions dans les titres",
    "Words": "Mots", "Characters": "Caractères", "Images": "Images", "Videos": "Vidéos", "Tables": "Tableaux", "Lists": "Listes", "Forms": "Formulaires",
    "Internal links": "Liens internes", "External links": "Liens externes", "Structured data": "Données structurées", "Language": "Langue",
    "Languages (hreflang)": "Langues (hreflang)", "Preferred address (canonical)": "Adresse préférée (canonique)", "Instructions to search engines": "Instructions aux moteurs de recherche",
    "Answer code": "Code de réponse", "Published (page says)": "Publiée (selon la page)", "Updated (page says)": "Mise à jour (selon la page)", "Sitemap date": "Date du sitemap",
    "First archived": "Première archive", "First found": "Première détection", "Last changed": "Dernière modification", "Last read": "Dernière lecture",
    "Changes seen": "Changements vus", "Read with": "Lue avec",
    "Mobile": "Mobile", "Desktop": "Ordinateur", "top {n} checked": "top {n} vérifié", "Your best position, same check": "Votre meilleure position, même vérification",
    "Keyword": "Mot-clé", "Their page": "Leur page", "Title in results": "Titre dans les résultats", "Was": "Avant", "Now": "Maintenant", "Your position": "Votre position",
    "Search engine": "Moteur de recherche", "Tool": "Outil", "Country": "Pays", "Device": "Appareil", "Location": "Lieu", "Results checked": "Résultats vérifiés", "Checked": "Vérifié",
    "All checked with {tool}, {when}.": "Tous vérifiés avec {tool}, {when}.",
    "Search keywords": "Chercher un mot-clé", "Find a competitor": "Chercher un concurrent", "competitors": "concurrents", "keywords": "mots-clés",
    "No competitor matches “{text}”.": "Aucun concurrent ne correspond à « {text} ».", "No keyword matches.": "Aucun mot-clé ne correspond.", "Clear search": "Effacer la recherche",
    // Words that change with where they sit
    "New|tag": "Nouveau",
    "Removed|pages": "Retirées",

    // Tabs and the list
    "My competitors": "Mes concurrents",
    "Find competitors": "Trouver des concurrents",
    "No competitors yet": "Aucun concurrent pour l'instant",
    "{n} suggestion is waiting in Find competitors.": "{n} suggestion attend dans Trouver des concurrents.",
    "{n} suggestions are waiting in Find competitors.": "{n} suggestions attendent dans Trouver des concurrents.",
    "Upload keywords in Find competitors to see who ranks against you.": "Importez vos mots-clés dans Trouver des concurrents pour voir qui se classe face à vous.",
    "Add by hand": "Ajouter à la main",
    "Add a competitor": "Ajouter un concurrent",
    "Watching {n} competitor for {site}.": "{n} concurrent suivi pour {site}.",
    "Watching {n} competitors for {site}.": "{n} concurrents suivis pour {site}.",
    "Competitor": "Concurrent",
    "Shared keywords": "Mots-clés partagés",
    "They lead": "Ils mènent",
    "You lead": "Vous menez",
    
    "Edits in 30 days": "Modifications en 30 jours",
    "Watching": "Suivi",
    "Read {when}": "Lu {when}",
    "Reading…": "Lecture…",
    "{n} page read": "{n} page lue",
    "{n} pages read": "{n} pages lues",
    "Waiting": "En attente",
    "Blocked": "Bloqué",
    "Read failed": "Lecture échouée",
    "Trying again at the next daily read.": "Nouvel essai à la prochaine lecture quotidienne.",
    "Not read yet": "Pas encore lu",
    "From a suggestion": "Depuis une suggestion",
    "Added by hand": "Ajouté à la main",
    "Edits can't be tracked on this site.": "Les modifications de ce site ne peuvent pas être suivies.",
    "Blocks bots, so edits can't be tracked.": "Bloque les robots : modifications non suivies.",

    // Add and remove
    "For": "Pour",
    "Its website address": "Adresse de son site",
    "Add competitors": "Ajouter des concurrents",
    "Paste one or many": "Collez-en un ou plusieurs",
    "Website addresses": "Adresses des sites",
    "One per line, or a spreadsheet column. Up to {n}.": "Une par ligne, ou une colonne de tableur. Jusqu'à {n}.",
    "{n} website": "{n} site",
    "{n} websites": "{n} sites",
    "Add {n} competitor": "Ajouter {n} concurrent",
    "Add {n} competitors": "Ajouter {n} concurrents",
    "{n} competitor added.": "{n} concurrent ajouté.",
    "{n} competitors added.": "{n} concurrents ajoutés.",
    "{n} competitor removed.": "{n} concurrent retiré.",
    "{n} competitors removed.": "{n} concurrents retirés.",
    "{n} was already there.": "{n} figurait déjà dans la liste.",
    "{n} were already there.": "{n} figuraient déjà dans la liste.",
    "{n} added. These weren't:": "{n} ajoutés. Ceux-ci non :",
    "None added:": "Aucun ajouté :",
    "Already your competitors:": "Déjà vos concurrents :",
    "Add up to {max} at a time. This list has {n}.": "Ajoutez-en jusqu'à {max} à la fois. Cette liste en compte {n}.",
    "Respects each site's rules for bots.": "Respecte les règles de chaque site pour les robots.",
    "Enter the competitor's address.": "Saisissez l'adresse du concurrent.",
    "{host} added.": "{host} ajouté.",
    "{host} removed.": "{host} retiré.",
    "Remove {host}?": "Retirer {host} ?",
    "No longer compared with {site}. Its data is kept.": "Il n'est plus comparé à {site}. Ses données sont conservées.",
    "Its page pairs here are removed; automatic ones return if re-added.": "Ses paires de pages ici sont retirées ; les automatiques reviennent s'il est rajouté.",
    "Removed. Data kept.": "Retiré. Données conservées.",
    "Not a website address.": "Ce n'est pas une adresse de site.",
    "Not a website domain.": "Ce n'est pas un domaine de site.",
    "Not a public website.": "Ce n'est pas un site public.",
    "Competitor not found.": "Ce concurrent n'est pas rattaché à ce site.",
    "Enter the address.": "Saisissez l'adresse.",

    // The profile
    "Back to competitors": "Retour aux concurrents",
    "added {when}": "ajouté {when}",
    "compared with {site}": "comparé à {site}",
    "Refresh data": "Actualiser les données",
    "Reading its pages, 3 seconds apart. It can take a while.": "Lecture de ses pages, à 3 secondes d'intervalle. Cela peut prendre un moment.",
    "Rankings, AI Overviews and shared keywords still work.": "Classements, AI Overviews et mots-clés communs fonctionnent toujours.",
    "Last read failed. Trying again at the next daily read; rankings still work.": "Dernière lecture échouée. Nouvel essai à la prochaine lecture quotidienne ; les classements fonctionnent toujours.",
    "How you compare": "Votre comparaison",
    "You": "Vous",
    "Them": "Eux",
    "You and them": "Vous et eux",
    "Level": "À égalité",
    "You're ahead": "Vous êtes devant",
    "They're ahead": "Ils sont devant",
    
    "Level on {n}": "À égalité sur {n}",
    "Average position (shared)": "Position moyenne (mots-clés communs)",
    "Nothing shared yet.": "Rien en commun pour l'instant.",
    "Lower is better.": "Plus c'est bas, mieux c'est.",
    "Who leads": "Qui est devant",
    "Only one ranks": "Un seul se classe",
    "The other isn't in the results checked.": "L'autre est absent des résultats vérifiés.",
    "Pages known": "Pages connues",
    "Words per page": "Mots par page",
    "New pages in 30 days": "Nouvelles pages en 30 jours",
    "Their pages can't be read.": "Leurs pages ne peuvent pas être lues.",
    "AI Overview citations": "Citations dans les AI Overviews",
    "Of {n} AI Overview seen.": "Sur {n} AI Overview vu.",
    "Of {n} AI Overviews seen.": "Sur {n} AI Overviews vus.",
    "No AI Overview seen yet.": "Aucun AI Overview vu pour l'instant.",
    "Timeline": "Chronologie",
    "Moves only compare two checks by the same tool and place, so a tool change never shows as a move.": "Les mouvements ne comparent que deux vérifications du même outil et du même endroit : un changement d'outil ne compte jamais comme un mouvement.",
    "Filter the timeline": "Filtrer la chronologie",
    "Page edits": "Modifications de pages",
    "New pages": "Nouvelles pages",
    "Ranking moves": "Mouvements de classement",
    "AI Overview": "AI Overview",
    "Title changed": "Titre modifié",
    "Search title changed": "Titre dans les résultats modifié",
    "Meta description changed": "Meta description modifiée",
    "Main heading changed": "Titre principal modifié",
    "Subheadings changed": "Sous-titres modifiés",
    "Canonical changed": "Canonique modifiée",
    "Indexing changed": "Indexation modifiée",
    "Structured data changed": "Données structurées modifiées",
    "Content changed": "Contenu modifié",
    "New page": "Nouvelle page",
    "Page removed": "Page retirée",
    "Started ranking for": "A commencé à se classer sur",
    "Stopped ranking for": "Ne se classe plus sur",
    "Moved up on": "A gagné des places sur",
    "Moved down on": "A perdu des places sur",
    "Cited in AI Overview for": "Cité dans l'AI Overview sur",
    "Dropped from AI Overview for": "Retiré de l'AI Overview sur",
    "{from} → {to} words": "{from} → {to} mots",
    "small edit, {n} word": "petite modification, {n} mot", "small edit, {n} words": "petite modification, {n} mots",
    "~{n} words changed": "~{n} mots changés",
    "Same items, new order.": "Mêmes éléments, autre ordre.",
    "Empty": "Vide",
    "Taken out": "Enlevé",
    "Added": "Ajouté",
    "Before": "Avant",
    "After": "Après",
    "now": "maintenant",
    "Site blocks bots: page changes can't be tracked.": "Le site bloque les robots : changements de pages non suivis.",
    "Nothing yet: changes show from the second read.": "Rien pour l'instant : les changements s'affichent dès la deuxième lecture.",
    "No moves yet: a move needs two checks by one tool.": "Aucun mouvement : il faut deux vérifications du même outil.",
    "Nothing here yet.": "Rien ici pour l'instant.",
    "Which keywords": "Quels mots-clés",
    "Shared": "Partagés",
    "Only them": "Eux seuls",
    "Only you": "Vous seul",
    "Past": "Passés",
    "Last position": "Dernière position",
    "Last seen": "Vu pour la dernière fois",
    
    "No shared keywords yet.": "Aucun mot-clé commun pour l'instant.",
    "No keyword only they rank on.": "Aucun mot-clé où eux seuls se classent.",
    "No keyword only you rank on.": "Aucun mot-clé où vous seul vous classez.",
    "None yet: keywords they've lost show here.": "Aucun pour l'instant : les mots-clés qu'ils ont perdus s'affichent ici.",
    "Page vs page": "Page contre page",
    "{n} shared keyword": "{n} mot-clé partagé",
    "{n} shared keywords": "{n} mots-clés partagés",
    "Compare": "Comparer",
    "No pairs yet: one appears when you both rank for a keyword.": "Aucune paire : elle apparaît quand vous vous classez tous deux sur un mot-clé.",

    // Find competitors
    "Suggestions from search results, no AI. Nothing is added until you accept.": "Des suggestions seulement. Rien n'est ajouté tant que vous n'acceptez pas. Compté à partir des résultats de recherche, sans IA.",
    "No keywords yet": "Aucun mot-clé pour l'instant",
    "See who ranks most on your keywords, using free tools only.": "Voyez qui se classe le plus sur vos mots-clés, avec des outils gratuits uniquement.",
    "Upload keywords": "Importer des mots-clés",
    "Add keywords": "Ajouter des mots-clés",
    
    "Check again": "Vérifier à nouveau",
    "Checked {when}": "Vérifié {when}",
    "Not checked": "Non contrôlé",
    "{done} of {n} keyword": "{done} mot-clé sur {n}",
    "{done} of {n} keywords": "{done} mots-clés sur {n}",
    "{n} check failed last run.": "{n} vérification échouée au dernier passage.",
    "{n} checks failed last run.": "{n} vérifications échouées au dernier passage.",
    "A domain needs {n}+ keywords to be suggested.": "Un domaine doit apparaître sur {n} mots-clés ou plus pour être suggéré.",
    "Your keyword list": "Votre liste de mots-clés",
    "Suggestions": "Suggestions",
    "No suggestions": "Aucune suggestion",
    "No suggestions yet": "Pas encore de suggestions",
    "No domain appears often enough on your keywords yet.": "Aucun domaine n'apparaît encore assez souvent sur vos mots-clés.",
    "They appear once your keywords are checked.": "Elles apparaissent une fois vos mots-clés vérifiés.",
    "Ranks for {k} of {n} keyword": "Se classe sur {k} mot-clé sur {n}",
    "Ranks for {k} of {n} keywords": "Se classe sur {k} mots-clés sur {n}",
    "Average position": "Position moyenne",
    "Best position": "Meilleure position",
    "Top 3 on": "Top 3 sur",
    
    "Public body": "Organisme public",
    "Big site": "Grand site",
    "Accept": "Accepter",
    "Dismiss": "Écarter",
    "Restore": "Rétablir",
    "Evidence": "Preuves",
    "Their position": "Leur position",
    "Your position": "Votre position",
    "Checked with": "Vérifié avec",
    "First {n} shown.": "{n} premiers affichés.",
    "Big sites and public bodies": "Grands sites et organismes publics",
    "They rank for almost everything, so rarely real competitors.": "Ils se classent sur presque tout : rarement de vrais concurrents.",
    "Dismissed": "Écartés",
    "They stay dismissed until you restore them.": "Ils restent écartés jusqu'à ce que vous les rétablissiez.",
    "Dismissed {when}": "Écarté {when}",
    "Not in your latest results": "Absent de vos derniers résultats",
    "{host} dismissed until you restore it.": "{host} écarté jusqu'à ce que vous le rétablissiez.",
    "{host} restored.": "{host} rétabli.",
    "{host} restored; it returns if seen often enough.": "{host} rétabli ; il revient s'il apparaît assez souvent.",
    "Check your keywords again?": "Vérifier à nouveau vos mots-clés ?",
    "Uses {n} free check.": "Utilise {n} vérification gratuite.",
    "Uses {n} free checks.": "Utilise {n} vérifications gratuites.",
    "Never spends paid credits. If free checks run out, it pauses and resumes when they refill.": "Aucun crédit payant. Si les vérifications gratuites s'épuisent, tout s'arrête puis reprend quand elles reviennent.",
    "A check is already running.": "Une vérification est déjà en cours.",
    "Upload your keyword list first.": "Importez d'abord votre liste de mots-clés.",

    // The run
    "Keeps going if you leave.": "Vous pouvez quitter cette page : la vérification continue.",
    "Waiting to start…": "En attente de démarrage…",
    "Checking your keywords: {done} of {total}": "Vérification de vos mots-clés : {done} sur {total}",
    "Using {tool}.": "Avec {tool}.",
    "{n} check failed.": "{n} vérification a échoué.",
    "{n} checks failed.": "{n} vérifications ont échoué.",
    "{n} keyword saved.": "{n} mot-clé enregistré.",
    "{n} keywords saved.": "{n} mots-clés enregistrés.",
    
    "{n} left to check.": "Encore {n} à vérifier.",
    "None checked yet.": "Aucun vérifié pour l'instant.",
    "Nothing is lost.": "Rien n'est perdu.",
    "Free tools only. Resumes by itself when a tool is ready or checks refill.": "Outils gratuits uniquement. Reprend seule quand un outil est prêt ou que les vérifications reviennent.",
    "Open Settings": "Ouvrir les réglages",
    "Waiting for a search tool": "En attente d'un outil de recherche",
    "{n} keyword checked.": "{n} mot-clé vérifié.",
    "{n} keywords checked.": "{n} mots-clés vérifiés.",
    "{n} suggestion to review.": "{n} suggestion à examiner.",
    "{n} suggestions to review.": "{n} suggestions à examiner.",
    "No search tool connected: add a key in Settings.": "Aucun outil de recherche connecté : ajoutez une clé dans les réglages.",
    "DuckDuckGo stopped at a bot check.": "DuckDuckGo s'est arrêté sur une vérification anti-robot.",
    "The app won't bypass it.": "L'application ne la contourne pas.",
    "DuckDuckGo asked us to slow down, so this tool stopped.": "DuckDuckGo a demandé de ralentir, cet outil s'est donc arrêté.",
    "SerpApi refused the key.": "SerpApi a refusé la clé.",
    "SerpApi has no free searches left for now.": "SerpApi n'a plus de recherches gratuites pour l'instant.",
    "Progress is saved; the rest resumes when a tool has free checks.": "La progression est enregistrée ; le reste reprend quand un outil a des vérifications gratuites.",

    // The upload panel
    "Drop a file here": "Déposez un fichier ici",
    ".csv or .txt, any encoding, 10 MB max.": ".csv ou .txt, tout encodage, 10 Mo max.",
    "Not Unicode. If the words above look wrong, pick its encoding.": "Pas en Unicode. Si les mots ci-dessus semblent faux, choisissez son encodage.",
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
    "Free tools only, never paid credits. If free checks run out, it pauses and resumes when they refill.": "Outils gratuits uniquement, aucun crédit payant. Si les vérifications gratuites s'épuisent, tout s'arrête puis reprend quand elles reviennent.",
    "Save and check": "Enregistrer et vérifier",
    "Remove file": "Retirer le fichier",
    "{n} keyword found": "{n} mot-clé trouvé",
    "{n} keywords found": "{n} mots-clés trouvés",
    "{n} repeat counted once": "{n} doublon compté une fois",
    "{n} repeats counted once": "{n} doublons comptés une fois",
    "and more": "et d'autres",
    "{n} keyword": "{n} mot-clé",
    "{n} keywords": "{n} mots-clés",
    "Choose a .csv or .txt file.": "Choisissez un fichier .csv ou .txt.",
    "File too large: 10 MB at most.": "Fichier trop volumineux : 10 Mo maximum.",
    "Choose a file, or paste your keywords.": "Choisissez un fichier, ou collez vos mots-clés.",
    "No keywords found. Use one per line, or a column named keyword.": "Aucun mot-clé trouvé. Un par ligne, ou une colonne nommée keyword.",
    "Already checked: nothing searched.": "Déjà vérifié : aucune recherche.",
    "{n} keywords already checked: nothing searched.": "{n} mots-clés déjà vérifiés : aucune recherche.",
    "The country must be a two-letter code, such as FR.": "Le pays doit être un code à deux lettres, comme FR.",
    "The language must be a code, such as fr.": "La langue doit être un code, comme fr.",
    // 2026-11-11: table rows say only their state; the sentence is said once under the table, with a count
    "{n} blocks bots: {hosts} — edits can't be tracked.": "{n} bloque les robots : {hosts} — modifications non suivies.",
    "{n} block bots: {hosts} — edits can't be tracked.": "{n} bloquent les robots : {hosts} — modifications non suivies.",
    "These sites don't allow automated visitors, so their edits can't be tracked. The app doesn't try to get past that.": "Ces sites n'autorisent pas les visiteurs automatisés, donc leurs modifications ne peuvent pas être suivies. L'application n'essaie pas de contourner ce choix.",
    "Read failed ×{n}: {hosts} — retries at the next daily read.": "Lecture échouée ×{n} : {hosts} — nouvel essai à la prochaine lecture quotidienne.",
    "Retries at the next daily read.": "Nouvel essai à la prochaine lecture quotidienne.",
    "and {n} more": "et {n} de plus",
    "Checked": "Vérifié",
    "All moves:": "Tous les mouvements :",
  });
})();
