/* Competitors area: Page vs page. My page beside a competitor's page, facts only: the app makes no recommendation.
   The app picks pairs from who ranks for the same keywords. Any change makes a pair "Your choice", which rankings never replace. */
(() => {
  "use strict";
  let UI = null;
  const TYPE_OWN = "__own__"; // the "Type another address" choice in a page picker
  const WATCH_EVERY = 2000, WATCH_FOR = 60000;
  const S = { site: null, view: "list", filter: "", verdict: null, showSame: false, pairs: [], competitors: [], detail: null, dirty: false, listScroll: 0, rereading: null, readWaiting: false, section: "keywords", sort: null };
  const PAGES = "cp-pairs", KW_PAGES = "cp-kw"; // the pairs and a pair's keywords have pages and a search (table-pages.js), like every long table
  const FIND_FROM = 11; // more than 10 rows, as on every table: a search box shows from this many rows, or while a search is on
  const W = { key: null, started: 0, expired: false, timer: null };

  const t = (s) => UI.t(s);
  const esc = (v) => UI.esc(v);
  const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, key) => values[key]);
  const dash = () => `<span class="muted">—</span>`;
  const none = (word) => `<span class="muted">${esc(t(word))}</span>`;
  const isRead = (side) => side?.state === "read";
  const isWaiting = (state) => state === "not_read" || state === "not_modified";
  const site = () => COMP.site();
  const onScreen = () => UI.state.route === "competitors" && COMP.tab === "pairs";
  // An empty state with the short line on screen and the reason behind an (i) right after it.
  const emptyTip = (title, text, tip, action = "") => COMP.empty(title, text, action).replace("</p>", () => `${UI.tip(tip)}</p>`);
  const PAIRS_WHY = "Pairs appear once a competitor ranks for the same keywords as you.";
  // A check tool by its logo alone, its name on hover and for screen readers. A tool with no logo keeps its name.
  const toolMark = (tool) => (window.BRANDS?.FILES?.[tool] ? UI.logoOnly(tool) : `<span>${esc(tool)}</span>`);

  /* The server's own sentences, in the language on screen. The host inside this one changes, so it can't be a plain lookup. */
  const serverWords = (message) => {
    const wrongHost = String(message).match(/^That page isn't on (.+)\.$/);
    if (wrongHost && UI.state.lang === "fr") return `Cette page n'est pas sur ${wrongHost[1]}.`;
    return t(message);
  };

  // ---- reading states ---------------------------------------------------------------------------
  const LEADS_ELSEWHERE = ["Leads elsewhere", "Redirects to another website, so it wasn't followed."];
  const READ_WORDS = {
    robots: ["Not allowed", "robots.txt forbids reading this page. The app respects that."],
    blocked: ["Blocked", "The site blocked the app, e.g. with a bot check. The app won't bypass it."],
    gone: ["Page gone", "The site says this page no longer exists."],
    network_error: ["Couldn't reach it", "The site couldn't be reached. Try Read again later."],
    server_error: ["Site error", "The site had its own error. Try Read again later."],
    http_error: ["Site error", "The site answered with an error: nothing to read."],
    rate_limited: ["Too many requests", "The site asked to slow down. Try Read again later."],
    not_html: ["Not a web page", "Not a normal web page: no text to read."],
    too_large: ["Too large", "This page is too large to read."],
    too_many_redirects: ["Too many redirects", "This address redirects too many times, so the app stopped."],
    left_scope: LEADS_ELSEWHERE,
    redirect: LEADS_ELSEWHERE,
    refused: ["Not opened", "The app doesn't open this kind of address."],
  };
  const OTHER_WORDS = ["Couldn't read it", "Couldn't read this page. Try Read again later."];
  const wordsFor = (state) => READ_WORDS[state] || OTHER_WORDS;
  const plainStatus = (iconName, word, cls = "") => `<span class="status sec">${UI.icon(iconName, cls)}${esc(t(word))}</span>`;

  function stateBadge(state) {
    if (state === "read") return UI.status("good", t("Read"));
    if (isWaiting(state)) return W.expired ? plainStatus("clock", "Waiting") : plainStatus("refresh-cw", "Reading…", "spin");
    return UI.status("warn", t(wordsFor(state)[0]));
  }

  const sourceTag = (source) => (source === "manual" ? `<span class="tag cp-yours">${t("Your choice")}</span>` : `<span class="tag">${t("Picked automatically")}</span>`);

  // ---- who ranks higher ---------------------------------------------------------------------------
  const places = (n) => `${UI.num(n)} ${t(n === 1 ? "place" : "places")}`;
  function verdictOf(p) {
    const r = p.ranking;
    if (!r) return { kind: "none", text: "" };
    if (!r.shared) {
      if (r.only_theirs && !r.only_mine) return { kind: "behind", text: t("Only they rank") };
      if (r.only_mine && !r.only_theirs) return { kind: "ahead", text: t("Only you rank") };
      if (r.only_mine && r.only_theirs) return { kind: "level", text: t("Different keywords") };
      return { kind: "none", text: t("No shared keyword") };
    }
    const ofAll = (word, n) => fill(t(word), { a: UI.num(n), b: UI.num(r.shared) });
    if (r.they_ahead > r.i_ahead) return { kind: "behind", text: r.shared === 1 ? fill(t("They're {n} ahead"), { n: places(Math.abs(r.gap)) }) : ofAll("They're ahead on {a} of {b} keywords", r.they_ahead) };
    if (r.i_ahead > r.they_ahead) return { kind: "ahead", text: r.shared === 1 ? fill(t("You're {n} ahead"), { n: places(Math.abs(r.gap)) }) : ofAll("You're ahead on {a} of {b} keywords", r.i_ahead) };
    return { kind: "level", text: r.shared === 1 ? t("Same position") : fill(t("Even across {b} keywords"), { b: UI.num(r.shared) }) };
  }
  function verdictBadge(v) {
    if (!v.text) return "";
    const [cls, name] = { behind: ["crit", "arrow-down"], ahead: ["good", "arrow-up"], level: ["sec", "minus"], none: ["muted", "minus"] }[v.kind];
    return `<span class="cp-verdict ${cls}">${UI.icon(name)}<span>${esc(v.text)}</span></span>`;
  }
  /* How far behind this pair leaves me. Sorts the list, so the pages to look at first are on top. */
  // The furthest behind comes first. Being behind always beats being ahead, then the size of the gap decides.
  const pressure = (p) => {
    const r = p.ranking;
    if (!r) return -1e6;
    const kind = verdictOf(p).kind;
    return (kind === "behind" ? 1e5 : kind === "ahead" ? -1e5 : 0) + Math.abs(r.gap || 0) * (kind === "ahead" ? -100 : 100) + (r.only_theirs - r.only_mine) * 10;
  };

  // ---- the list ---------------------------------------------------------------------------------
  /* A search finds a pair by my page (its address or title), the competitor, or a keyword they share. */
  const found = (p) => TP.matches(PAGES, p.my_url, p.my_title, p.competitor, p.their_url, ...(p.ranking?.keywords || []).map((k) => k.keyword));
  const searchedPairs = () => S.pairs.filter(found);
  const byCompetitor = () => (S.filter ? searchedPairs().filter((p) => String(p.competitor_id) === S.filter) : searchedPairs());
  const shownPairs = () => { const list = byCompetitor(); return S.verdict === "all" || S.verdict === null ? list : list.filter((p) => verdictOf(p).kind === S.verdict); };
  const pathOf = (url) => { try { const parsed = new URL(url); return `${parsed.pathname}${parsed.search}`; } catch { return COMP.shortUrl(url); } };

  /* The keywords both pages rank for are why they're a pair. A keyword only one page ranks for may just mean
     another page of that site ranks instead, so those wait for the comparison page, where that can be said.
     The row shows one keyword: the one that best explains who's ahead, so the numbers and the words agree. */
  function leadKeyword(p) {
    const r = p.ranking;
    if (!r || !r.keywords.length) return null;
    const both = r.keywords.filter((k) => k.my_position !== null && k.their_position !== null);
    const list = both.length ? both : r.keywords;
    const worstFirst = verdictOf(p).kind !== "ahead";
    const keyword = [...list].sort((a, b) => (worstFirst ? keywordOrder(b) - keywordOrder(a) : keywordOrder(a) - keywordOrder(b)))[0];
    return { keyword, rest: (both.length ? r.shared : r.keywords_total) - 1 };
  }
  const youThemNumbers = (mine, theirs) => `<span class="cp-youthem">${youThemHead("mine")} <span class="tabular">${UI.num(mine)}</span> <span class="muted">·</span> ${youThemHead("theirs")} <span class="tabular">${UI.num(theirs)}</span></span>`;

  /* A competitor none of whose pages can be read is said once, not on every row. */
  function unreadableNotes(list) {
    const rivals = new Map();
    list.forEach((p) => { const entry = rivals.get(p.competitor_id) || { host: p.competitor, read: 0, state: "" }; if (p.their_facts) entry.read += 1; else if (!isWaiting(p.their_state)) entry.state = p.their_state; rivals.set(p.competitor_id, entry); });
    return [...rivals.values()].filter((r) => !r.read && r.state).map((r) => {
      const refused = r.state === "robots" || r.state === "blocked";
      const words = fill(t(refused ? "{host} blocks reading: rankings only." : "{host} couldn't be read this time: rankings only."), { host: r.host });
      // A refusal's full reason sits on the note's own info mark.
      const mark = refused ? UI.tip("{host} doesn't allow automated reading, so its pages can't be compared. The app doesn't try to get past that.", { host: r.host }).trim() : UI.icon("info");
      return `<p class="note cp-rival-note">${mark}<span>${esc(words)}</span></p>`;
    }).join("");
  }

  const pairFind = (p) => {
    const mine = COMP.shortUrl(p.my_url), theirs = COMP.shortUrl(p.their_url), host = COMP.site()?.host, verdict = verdictOf(p);
    const rival = p.competitor || COMP.shortUrl(p.their_url).split("/")[0], page = pathOf(p.my_url);
    // A task is a job, not a pair of addresses.
    const title = verdict.kind === "behind" ? `${t("Catch up with")} ${rival} ${t("on")} ${page}` : `${t("Compare")} ${page} ${t("with")} ${rival}`;
    return { title, host, pages: [p.my_url], priority: verdict.kind === "behind" ? "high" : "medium", source: { type: "competitor", label: `${mine} / ${theirs}`, host, facts: [verdict.text].filter(Boolean), link: `#competitors/pairs/${p.id}`, key: `pair|${p.id}` } };
  };

  /* Pages being read are counted once above the table; each row keeps only a small spinner, its words on hover. */
  const readingMark = () => `<span class="cp-reading" role="img" title="${esc(t("Reading…"))}" data-tip="${esc(t("Reading…"))}" aria-label="${esc(t("Reading…"))}">${UI.icon("refresh-cw", "spin")}</span>`;
  function readingLine(list) {
    if (W.expired) return "";
    const urls = new Set();
    list.forEach((p) => { if (isWaiting(p.my_state)) urls.add(p.my_url); if (isWaiting(p.their_state)) urls.add(p.their_url); });
    if (!urls.size) return "";
    return `<p class="note cp-rival-note cp-reading-line" role="status">${UI.icon("refresh-cw", "spin")}<span>${esc(fill(t(urls.size === 1 ? "Reading {n} page…" : "Reading {n} pages…"), { n: UI.num(urls.size) }))}</span></p>`;
  }

  /* The Competitor column shows only while the rows can differ: with one competitor picked under Against, it goes.
     With all of them, each row shows the competitor's logo alone, its host on hover and for screen readers. */
  function pairRow(p, withRival = true) {
    const lead = leadKeyword(p);
    const reading = isWaiting(p.my_state) || isWaiting(p.their_state);
    const position = (word, value) => `<td class="c cp-simple-pos" data-label="${t(word)}">${lead ? COMP.pos(value, lead.keyword.depth) : dash()}</td>`;
    const rival = p.competitor || COMP.shortUrl(p.their_url).split("/")[0];
    // "Your choice" and the reading spinner sit with my page, so they stay when the Competitor column goes.
    const marks = `${p.source === "manual" ? `<span class="tag cp-yours">${t("Your choice")}</span>` : ""}${reading ? (W.expired ? plainStatus("clock", "Waiting") : readingMark()) : ""}`;
    return `<tr data-cp-row="${p.id}">
      <td class="head-cell cp-page">${p.my_title ? `<span class="cp-page-title" dir="auto">${esc(p.my_title)}</span>${PageLink.html(p.my_url, { text: pathOf(p.my_url), cls: "second mono", dir: "ltr" })}` : PageLink.html(p.my_url, { text: pathOf(p.my_url), cls: "cp-page-title mono", dir: "ltr" })}${marks ? `<span class="cp-page-marks">${marks}</span>` : ""}</td>
      ${withRival ? `<td data-label="${t("Competitor")}"><div class="cp-val"><span class="cg-logo cp-rival-logo" role="img" tabindex="0" data-tip="${esc(rival)}" aria-label="${esc(rival)}">${window.UI.siteLogo(rival, 20)}</span></div></td>` : ""}
      <td data-label="${t("Keyword")}"><div class="cp-val">${lead ? `<span dir="auto">${esc(lead.keyword.keyword)}</span>${lead.rest > 0 ? `<span class="second">+ ${UI.num(lead.rest)} ${t(lead.rest === 1 ? "more" : "more")}</span>` : ""}` : `<span class="muted small">${t("None")}</span>`}</div></td>
      ${position("You", lead?.keyword.my_position)}
      ${position("Them", lead?.keyword.their_position)}
      <td data-label="${t("Who's ahead")}"><div class="cp-val">${verdictBadge(verdictOf(p))}</div></td>
      <td class="r nowrap cp-row-acts" data-label=""><button class="btn btn-small" id="cp-open-${p.id}" data-cp-open="${p.id}" aria-label="${t("Compare")}: ${esc(COMP.shortUrl(p.my_url))} / ${esc(COMP.shortUrl(p.their_url))}">${t("Compare")}${UI.icon("chevron-right")}</button></td>
    </tr>`;
  }

  function listBody() {
    const addButton = (cls = "") => `<button class="btn ${cls}" id="cp-add" data-cp-add>${UI.icon("plus")}${t("Add a pair")}</button>`;
    if (!S.competitors.length) {
      return emptyTip(t("No competitors yet"), t("Add a competitor first."), PAIRS_WHY, `<button class="btn btn-main" data-cp-find>${UI.icon("search")}${t("Find competitors")}</button>`);
    }
    if (!S.pairs.length) {
      return emptyTip(t("No pairs yet"), t("Add one by hand."), PAIRS_WHY, addButton("btn-main"));
    }
    const base = byCompetitor();
    const counts = { behind: 0, ahead: 0, level: 0, none: 0 };
    base.forEach((p) => { counts[verdictOf(p).kind] += 1; });
    // The losses are what this screen is for, so it opens on them.
    if (S.verdict === null) S.verdict = counts.behind ? "behind" : "all";
    const chip = (id, word, n) => `<button class="chip" data-cp-verdict="${id}" aria-pressed="${S.verdict === id}">${t(word)}<b>${UI.num(n)}</b></button>`;
    const tools = `<div class="cp-tools">
      ${S.pairs.length >= FIND_FROM || TP.state(PAGES).q ? TP.search(PAGES, t("Search pages and keywords")) : ""}
      <label class="field"><span>${t("Against")}</span><select class="select" id="cp-filter">
        <option value="">${t("All competitors")} (${UI.num(searchedPairs().length)})</option>
        ${S.competitors.map((c) => { const n = searchedPairs().filter((p) => p.competitor_id === c.id).length; return `<option value="${c.id}" ${String(c.id) === S.filter ? "selected" : ""}>${esc(c.display || c.host)} (${UI.num(n)})</option>`; }).join("")}
      </select></label>
      <div class="chips cp-chips" role="group" aria-label="${t("Who's ahead")}">
        ${chip("all", "All", base.length)}${chip("behind", "They're ahead", counts.behind)}${chip("ahead", "You're ahead", counts.ahead)}${counts.level ? chip("level", "Even", counts.level) : ""}
      </div>
      <span class="cp-how" tabindex="0" role="note" aria-label="${t("Your pages beside the competitor page ranking with them most, furthest behind first. Pairs you change stay.")}" data-tip="${t("Your pages beside the competitor page ranking with them most, furthest behind first. Pairs you change stay.")}">${UI.icon("info")}</span>
      ${addButton()}
    </div>
    ${unreadableNotes(base)}`;
    const shown = shownPairs();
    if (!shown.length) {
      if (TP.state(PAGES).q) return tools + COMP.empty(t("Nothing here"), t("No pair matches this search."), `<button type="button" class="btn btn-small" data-tp-clear data-tp-key="${PAGES}">${t("Clear search")}</button>`);
      return tools + (S.filter && !base.length ? emptyTip(t("Nothing here"), t("Add one by hand."), PAIRS_WHY) : COMP.empty(t("Nothing here"), t("No pair matches this filter.")));
    }
    // One list, the furthest behind on top, so the first row is always the first thing to look at. A heading can sort it another way.
    const page = TP.view(PAGES, sortedPairs(shown));
    const withRival = !S.filter; // Against names the one competitor, so every row would repeat it
    const head = (key, label, cls = "") => {
      const on = S.sort?.key === key;
      return `<th scope="col" class="${cls}" aria-sort="${on ? (S.sort.dir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" class="th-btn" data-cp-sort="${key}">${label}${on ? UI.icon(S.sort.dir === "asc" ? "arrow-up" : "arrow-down") : ""}</button></th>`;
    };
    return `${tools}${readingLine(shown)}
      <div class="cp-pages"><div class="table-wrap"><table class="data" id="cp-table">
        <thead><tr>${head("page", COMP.who("you", null, t("My page")))}${withRival ? `<th scope="col">${COMP.who("them", null, t("Competitor"))}</th>` : ""}<th scope="col">${t("Keyword")}</th>${head("mine", youThemHead("mine"), "c")}${head("theirs", youThemHead("theirs"), "c")}<th scope="col">${t("Who's ahead")}</th><th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead>
        <tbody>${page.rows.map((p) => pairRow(p, withRival)).join("")}</tbody>
      </table></div>${TP.footer(PAGES, page, { noun: t("pairs") })}</div>`;
  }
  /* My page: A to Z. You and Them: the position on the pair's keyword, the best first. Not in the results always goes last. */
  const PAIR_SORTS = { page: (p) => pathOf(p.my_url), mine: (p) => leadKeyword(p)?.keyword.my_position ?? null, theirs: (p) => leadKeyword(p)?.keyword.their_position ?? null };
  function sortedPairs(list) {
    const usual = [...list].sort((a, b) => pressure(b) - pressure(a) || a.my_url.localeCompare(b.my_url));
    if (!S.sort || !PAIR_SORTS[S.sort.key]) return usual;
    const value = PAIR_SORTS[S.sort.key], dir = S.sort.dir === "asc" ? 1 : -1;
    return usual.sort((a, b) => {
      const x = value(a), y = value(b);
      if (x === null || y === null) return (x === null) - (y === null);
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), UI.state.lang)) * dir;
    });
  }

  // ---- the detail: facts, row by row ------------------------------------------------------------
  /* A difference says who has more, so a dot in that page's colour can show it. The app still doesn't say which is better. */
  const more = (mine, theirs, one, many) => {
    if (mine === theirs) return mine ? t("Same") : "";
    const n = Math.abs(mine - theirs);
    return { who: theirs > mine ? "theirs" : "mine", text: fill(t(theirs > mine ? "They have {n} more {what}" : "You have {n} more {what}"), { n: UI.num(n), what: t(n === 1 ? one : many) }) };
  };
  const longer = (mine, theirs, theirWords, myWords) => {
    if (mine === theirs) return mine ? t("Same length") : "";
    const n = Math.abs(mine - theirs);
    return { who: theirs > mine ? "theirs" : "mine", text: fill(t(theirs > mine ? theirWords : myWords), { n: UI.num(n), what: t(n === 1 ? "character" : "characters") }) };
  };
  /* One colour per page, the same in every block, so nobody has to read a header to know whose number it is. */
  const diffNote = (note) => {
    if (!note) return "";
    const { who, text } = typeof note === "string" ? { who: null, text: note } : note;
    return `<span class="cp-diff-note">${who ? `<i class="cp-dot cp-dot-${who}" aria-hidden="true"></i>` : ""}<span>${esc(text)}</span></span>`;
  };
  const lengthNote = (n) => `<span class="second tabular">${UI.num(n)} ${t(n === 1 ? "character" : "characters")}</span>`;
  const textOr = (text, word) => (text ? `<span dir="auto">${esc(text)}</span>` : none(word));
  const count = (n) => `<span class="tabular">${UI.num(n)}</span>`;
  const tagList = (list, word) => (list?.length ? `<span class="cp-tags">${list.map((x) => `<span class="tag" dir="auto">${esc(x)}</span>`).join(" ")}</span>` : none(word));
  const lineList = (list, word) => (list?.length ? `<ul class="cp-list">${list.map((x) => `<li><span dir="auto">${esc(x)}</span></li>`).join("")}</ul>` : none(word));

  const languageName = (code) => {
    try { return new Intl.DisplayNames([UI.locale()], { type: "language" }).of(code) || code; } catch { return code; }
  };
  /* A date a page states about itself can be anything, so one that doesn't parse is shown as written. */
  const statedDate = (value) => {
    if (!value) return none("Not stated");
    return Number.isNaN(new Date(value).getTime()) ? `<span dir="auto">${esc(value)}</span>` : `<span class="tabular">${esc(UI.fmtDateOnly(value))}</span>`;
  };
  const stamp = (iso, word) => (iso ? `<span class="tabular">${esc(UI.fmtStamp(iso))}</span><span class="second">${esc(COMP.ago(iso))}</span>` : none(word));

  function onlyOneHas(mine, theirs) {
    const a = mine || [], b = theirs || [];
    const theirsOnly = b.filter((x) => !a.includes(x)), mineOnly = a.filter((x) => !b.includes(x));
    return [theirsOnly.length ? fill(t("Only they have: {list}"), { list: theirsOnly.join(", ") }) : "", mineOnly.length ? fill(t("Only you have: {list}"), { list: mineOnly.join(", ") }) : ""].filter(Boolean).join(". ");
  }

  function canonicalCell(side) {
    if (!side.canonical) return none("Not set");
    if (!side.canonical_elsewhere) return `<span class="sec">${t("This page")}</span>`;
    return `${UI.status("warn", t("Points elsewhere"))}<span class="second">${COMP.link(side.canonical)}</span>`;
  }
  function indexingCell(side) {
    const raw = side.robots_meta ? `<span class="second mono" dir="ltr">${esc(side.robots_meta)}</span>` : "";
    return `${side.noindex ? `${UI.status("warn", t("noindex"))}<span class="second">${t("Kept out of search")}</span>` : `<span class="sec">${t("Indexable")}</span>`}${raw}`;
  }

  /* Every fact we show, grouped. A row is the same on both pages when both sides draw the same thing.
     The Content tab shows Numbers and Text, the Technical tab shows Setup and Dates. */
  function factGroups(d) {
    const m = d.mine, o = d.theirs;
    const number = (label, key, one, many) => ({ label, show: (s) => count(s[key]), diff: () => more(m[key], o[key], one, many) });
    const headingCount = (s) => (s.h1 || []).length + (s.headings || []).length;
    const wordsNote = (s) => (s.js_only ? `<span class="second">${UI.status("warn", t("Not reliable"))}</span>` : "");
    const imagesNote = (s) => (s.images ? `<span class="second">${s.images_no_alt ? `${UI.num(s.images_no_alt)} ${t("with no alt text")}` : t("All have alt text")}</span>` : "");
    return [
      ["Numbers", [
        { label: "Words", show: (s) => `${count(s.word_count)}${wordsNote(s)}`, diff: () => more(m.word_count, o.word_count, "word", "words") },
        { label: "Headings", show: (s) => count(headingCount(s)), diff: () => more(headingCount(m), headingCount(o), "heading", "headings") },
        { label: "Images", show: (s) => `${count(s.images)}${imagesNote(s)}`, diff: () => more(m.images, o.images, "image", "images") },
        number("Internal links", "internal_links", "internal link", "internal links"),
        number("Outside links", "external_links", "outside link", "outside links"),
        number("Characters", "characters", "character", "characters"),
        number("Tables", "tables", "table", "tables"),
        number("Lists", "lists", "list", "lists"),
        number("Videos", "videos", "video", "videos"),
        number("Forms", "forms", "form", "forms"),
      ]],
      ["Text", [
        { label: "Title", show: (s) => `${textOr(s.title, "No title")}${s.title ? lengthNote(s.title_length) : ""}`, diff: () => longer(m.title_length, o.title_length, "Their title is {n} {what} longer", "Your title is {n} {what} longer") },
        { label: "Meta description", show: (s) => `${textOr(s.meta_description, "No description")}${s.meta_description ? lengthNote(s.meta_length) : ""}`, diff: () => longer(m.meta_length, o.meta_length, "Their description is {n} {what} longer", "Your description is {n} {what} longer") },
        { label: "H1", show: (s) => (s.h1?.length ? `${lineList(s.h1)}${s.h1.length > 1 ? `<span class="second">${UI.num(s.h1.length)} ${t("H1 headings")}</span>` : ""}` : none("No H1")) },
        { label: "Questions in headings", show: (s) => lineList(s.questions, "None"), diff: () => more((m.questions || []).length, (o.questions || []).length, "question", "questions") },
      ]],
      ["Setup", [
        { label: "Structured data", show: (s) => tagList(s.schema_types, "None found"), diff: () => onlyOneHas(m.schema_types, o.schema_types) },
        { label: "Language", show: (s) => (s.lang ? `<span>${esc(languageName(s.lang))}</span> <span class="muted mono small">${esc(s.lang)}</span>` : none("Not stated")), diff: () => (d.same_language ? "" : t("Different languages")) },
        { label: "Hreflang", show: (s) => tagList(s.hreflang, "None") },
        { label: "Canonical", show: canonicalCell },
        { label: "Indexing", show: indexingCell },
      ]],
      ["Dates", [
        { label: "Published", show: (s) => statedDate(s.published) },
        { label: "Modified", show: (s) => statedDate(s.modified) },
        { label: "Last changed", show: (s) => stamp(s.last_changed_at, "No change seen") },
      ]],
    ];
  }

  /* Why a side can't be read, said once, on the tabs that would have shown its facts. */
  function unreadNote(d) {
    const line = (side, who) => {
      if (isRead(side)) return "";
      if (isWaiting(side.state)) return t("Facts appear once both pages are read.");
      const code = side.state === "http_error" && side.http_status ? ` (${side.http_status})` : "";
      return `${t(who)}: ${t(wordsFor(side.state)[1])}${code}`;
    };
    const lines = [...new Set([line(d.mine, "My page"), line(d.theirs, "Their page")].filter(Boolean))];
    return lines.map((text) => `<p class="note cp-rival-note">${UI.icon("info")}<span>${esc(text)}</span></p>`).join("");
  }

  /* One table for a tab: only what differs, with what's the same one click away. With a side unread, what the app did read. */
  function factsTable(d, names, extraRow = "") {
    const m = d.mine, o = d.theirs;
    const wanted = factGroups(d).filter(([group]) => names.includes(group));
    if (!isRead(m) || !isRead(o)) {
      const known = isRead(m) ? m : isRead(o) ? o : null;
      const rows = known ? wanted.map(([group, list]) => `<tr class="cp-fact-group"><th colspan="2" scope="colgroup">${t(group)}</th></tr>${list.map((row) => `<tr><td class="head-cell cp-fact"><span class="kw">${esc(t(row.label))}</span></td><td data-label=""><div class="cp-val">${row.show(known)}</div></td></tr>`).join("")}`).join("") : "";
      return `${unreadNote(d)}${known ? `<div class="table-wrap"><table class="data cp-facts cp-facts-one"><thead><tr><th scope="col"><span class="sr">${t("Fact")}</span></th><th scope="col">${youThemHead(known === m ? "mine" : "theirs")}</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}`;
    }
    let same = 0;
    const groups = wanted.map(([group, list]) => {
      const rows = list.map((row) => {
        const a = row.show(m), b = row.show(o);
        const isSame = a === b;
        if (isSame) same += 1;
        if (isSame && !S.showSame) return "";
        return `<tr class="${isSame ? "cp-same" : ""}">
          <td class="head-cell cp-fact"><span class="kw">${esc(t(row.label))}</span></td>
          <td data-label="${t("You")}"><div class="cp-val">${a}</div></td>
          <td data-label="${t("Them")}"><div class="cp-val">${b}</div></td>
          <td class="cp-diff" data-label="${t("Difference")}">${diffNote(row.diff?.())}</td>
        </tr>`;
      }).join("");
      return rows ? `<tr class="cp-fact-group"><th colspan="4" scope="colgroup">${t(group)}</th></tr>${rows}` : "";
    }).join("");
    const toggle = same ? `<div class="cp-same-toggle"><button class="link-btn" id="cp-same" data-cp-same>${esc(S.showSame ? t("Hide what's the same") : fill(t(same === 1 ? "Show {n} identical fact" : "Show {n} identical facts"), { n: UI.num(same) }))}</button></div>` : "";
    return `<div class="table-wrap"><table class="data cp-facts" id="cp-facts">
        <thead><tr><th scope="col"><span class="sr">${t("Fact")}</span></th><th scope="col">${youThemHead("mine")}</th><th scope="col">${youThemHead("theirs")}</th><th scope="col">${t("Difference")}</th></tr></thead>
        <tbody>${groups}${extraRow}</tbody></table>${toggle}</div>`;
  }

  function sideNote(side) {
    if (isWaiting(side.state)) {
      return `<p class="note cp-note" role="status">${UI.icon(W.expired ? "clock" : "refresh-cw", W.expired ? "" : "spin")}<span>${t(W.expired ? "Not read yet. It's waiting for the next worker run." : "Reading this page…")}</span></p>`;
    }
    if (!isRead(side)) {
      return "";
    }
    const notes = [];
    if (side.js_only) notes.push(t("Needs JavaScript to show its text, so word counts aren't reliable."));
    if (side.last_status && !["ok", "not_modified"].includes(side.last_status)) notes.push(`${t(wordsFor(side.last_status)[1])} ${t("Facts from the last good read.")}`);
    return notes.map((text) => `<p class="note cp-note">${UI.icon("triangle-alert")}<span>${esc(text)}</span></p>`).join("");
  }

  function sideHead(who, side) {
    const lastRead = side.last_checked_at && side.state === "read" ? `<span class="small muted">${t("Read")} ${esc(COMP.ago(side.last_checked_at))}</span>` : "";
    return `<div class="cp-side cp-side-${who}">
      <div class="cp-side-top"><span class="cp-id cp-id-${who}"><i aria-hidden="true"></i>${t(who === "mine" ? "My page" : "Their page")}</span>${S.rereading ? plainStatus("refresh-cw", "Reading…", "spin") : side.state === "read" ? "" : stateBadge(side.state)}${lastRead}</div>
      ${side.title ? `<div class="cp-side-title"><span dir="auto">${esc(side.title)}</span></div>` : ""}
      ${COMP.link(side.url)}
      ${sideNote(side)}
    </div>`;
  }

  // ---- the detail: keywords ---------------------------------------------------------------------
  const MARKS = [["title", "Title"], ["h1", "H1"], ["headings", "Headings "], ["meta", "Meta"], ["body", "Body"]];
  /* Where the keyword appears on one page: a column per place, so the two pages line up and can be read downwards. */
  function markCells(use) {
    if (use === null || use === undefined) return `<td class="cp-marks-none" colspan="${MARKS.length}">${none("Not read")}</td>`;
    return MARKS.map(([key, label]) => {
      const value = use[key], on = Boolean(value);
      const shown = !on ? `<span class="cp-no" aria-hidden="true">–</span>` : key === "headings" ? `<span class="tabular" aria-hidden="true">${UI.num(value)}</span>` : `<span aria-hidden="true">${UI.icon("check")}</span>`;
      const said = !on ? t("No") : key === "headings" ? UI.num(value) : t("Yes");
      return `<td class="c cp-mark${on ? " on" : ""}" data-label="${esc(t(label))}">${shown}<span class="sr">${esc(t(label))}: ${esc(said)}</span></td>`;
    }).join("");
  }
  const citedCell = (cited) => (cited ? plainStatus("sparkles", "Cited") : `<span class="muted">${t("Not cited")}</span>`);
  const noAiWords = (row) => (row.ai_state === "not_captured"
    ? `<span class="muted" data-tip="${t("The tool can't see AI Overviews. One may still exist.")}">${t("Not captured")}</span>`
    : none("No AI Overview"));
  const otherPage = (other, word) => (other ? `<span class="second cp-other">${fill(esc(t(word)), { path: PageLink.html(other.url, { text: pathOf(other.url), cls: "mono", dir: "ltr" }), n: UI.num(other.position) })}</span>` : "");

  /* Who's ahead on this one keyword. A page missing from the results isn't a loss if another page of that site ranks instead. */
  function keywordResult(r) {
    const mine = r.my_position, theirs = r.their_position;
    if (mine !== null && theirs !== null) {
      const gap = mine - theirs;
      if (!gap) return { kind: "level", text: t("Same position") };
      return gap > 0 ? { kind: "behind", text: fill(t("{n} behind"), { n: places(gap) }) } : { kind: "ahead", text: fill(t("{n} ahead"), { n: places(-gap) }) };
    }
    if (theirs !== null) return { kind: r.my_other ? "level" : "behind", text: t("Only their page ranks") };
    if (mine !== null) return { kind: r.their_other ? "level" : "ahead", text: t("Only your page ranks") };
    return { kind: "none", text: "" };
  }
  /* The same order as the list: the furthest behind first, the biggest leads last. */
  function keywordOrder(r) {
    const mine = r.my_position, theirs = r.their_position;
    if (mine !== null && theirs !== null) return mine === theirs ? 0 : (mine > theirs ? 1000 : -1000) + mine - theirs;
    return theirs !== null ? 500 : mine !== null ? -500 : -2000;
  }
  function positionCell(position, other, depth, label) {
    const leads = position !== null && (other === null || position < other);
    return `<td class="r cp-pos${leads ? " cp-pos-lead" : ""}" data-label="${esc(label)}">${COMP.pos(position, depth)}</td>`;
  }
  function keywordRows(r, once) {
    const hasAi = r.ai_state === "present";
    // Checked with the same tool at the same age as every other row: said once under the table instead.
    const checked = once ? "" : `<span class="second cp-kw-checked">${toolMark(r.tool)}${window.BRANDS?.FILES?.[r.tool] ? "" : " ·"} ${esc(COMP.ago(r.checked_at))}</span>`;
    return `<tbody class="cp-kw-group">
      <tr class="cp-kw-mine">
        <td class="head-cell cp-kw-name" rowspan="2"><span class="kw" dir="auto">${esc(r.keyword)}</span>${checked}</td>
        <td class="cp-kw-result" rowspan="2" data-label="${t("Who's ahead")}">${verdictBadge(keywordResult(r))}${otherPage(r.my_other, "Your {path} is #{n}")}${otherPage(r.their_other, "Their {path} is #{n}")}</td>
        <td class="cp-kw-who">${youThemHead("mine")}</td>
        ${positionCell(r.my_position, r.their_position, r.depth, t("Position"))}
        ${markCells(r.mine)}
        ${hasAi ? `<td class="cp-kw-ai" data-label="${t("AI Overview")}">${citedCell(r.ai_cites_me)}</td>` : `<td class="cp-kw-ai cp-kw-ai-none" rowspan="2" data-label="${t("AI Overview")}">${noAiWords(r)}</td>`}
      </tr>
      <tr class="cp-kw-theirs">
        <td class="cp-kw-who">${youThemHead("theirs")}</td>
        ${positionCell(r.their_position, r.my_position, r.depth, t("Position"))}
        ${markCells(r.theirs)}
        ${hasAi ? `<td class="cp-kw-ai" data-label="${t("AI Overview")}">${citedCell(r.ai_cites_them)}</td>` : ""}
      </tr>
    </tbody>`;
  }
  function keywordsPanel(d) {
    if (!d.keywords.length) return `<div class="table-wrap"><div class="empty"><p>${t("Neither page ranks for your keywords.")}</p></div></div>`;
    // The furthest behind first, in pages, with a search for one keyword when there are enough to look through.
    const q = TP.state(KW_PAGES).q;
    const search = d.keywords.length >= FIND_FROM || q ? `<div class="cp-tools cp-kw-tools">${TP.search(KW_PAGES, t("Search keywords"))}</div>` : "";
    const list = [...d.keywords].filter((r) => TP.matches(KW_PAGES, r.keyword)).sort((a, b) => keywordOrder(b) - keywordOrder(a));
    if (!list.length) return `${search}<div class="table-wrap"><div class="empty"><p>${t("No keyword matches.")}</p><button type="button" class="btn btn-small" data-tp-clear data-tp-key="${KW_PAGES}">${t("Clear search")}</button></div></div>`;
    const page = TP.view(KW_PAGES, list);
    const missing = d.keywords.find((r) => r.my_position === null || r.their_position === null);
    // Every keyword checked with the same tool at the same age: said once under the table, not on each row (as on AI Overview watch).
    const once = list.length > 1 && new Set(list.map((r) => `${r.tool}|${COMP.ago(r.checked_at)}`)).size === 1;
    const checkedOnce = once ? fill(esc(t("All checked with {tool}, {when}.")), { tool: toolMark(list[0].tool), when: esc(COMP.ago(list[0].checked_at)) }) : "";
    const notes = [checkedOnce, esc(t("A tick: the keyword appears there.")), missing ? esc(fill(t(">{n}: not in the top {n}."), { n: UI.num(missing.depth) })) : ""].filter(Boolean).join(" ");
    return `${search}<div class="cp-pages"><div class="table-wrap"><table class="data cp-kw" id="cp-kw" data-tt-off>
      <thead><tr><th scope="col">${t("Keyword")}</th><th scope="col">${t("Who's ahead")}</th><th scope="col"><span class="sr">${t("Page")}</span></th><th scope="col" class="c">${t("Position")}</th>${MARKS.map(([, label]) => `<th scope="col" class="c">${t(label)}</th>`).join("")}<th scope="col">${t("AI Overview")}</th></tr></thead>
      ${page.rows.map((r) => keywordRows(r, once)).join("")}</table><p class="cp-foot-note">${notes}</p></div>${TP.footer(KW_PAGES, page, { noun: t("keywords") })}</div>`;
  }

  // ---- the detail: headings and words -----------------------------------------------------------
  /* A page's outline, as a reader meets it. A heading on both pages is marked, so the gaps show without a second list. */
  function outlineOf(side) {
    return [...(side.h1 || []).map((text) => [1, text]), ...(side.headings || []).map(([tag, text]) => [Number(String(tag).slice(1)) || 2, text])];
  }
  function outlineColumn(who, side, other) {
    const label = `<span class="cp-id cp-id-${who}"><i aria-hidden="true"></i>${t(who === "mine" ? "My page" : "Their page")}</span>`;
    if (!isRead(side)) {
      const words = isWaiting(side.state) ? t("Reading this page…") : t(wordsFor(side.state)[1]);
      return `<div class="cp-col"><h3>${label}</h3><p class="small muted">${esc(words)}</p></div>`;
    }
    const list = outlineOf(side);
    const elsewhere = new Set(outlineOf(other).map(([, text]) => fold(text).trim()));
    const items = list.map(([level, text]) => `<li class="cp-line cp-line-${Math.min(level, 6)}"><span class="cp-level">H${level}</span><span class="cp-line-text" dir="auto">${esc(text)}</span>${elsewhere.has(fold(text).trim()) ? `<span class="tag cp-both">${t("Both pages")}</span>` : ""}</li>`).join("");
    return `<div class="cp-col"><h3>${label} <span class="muted tabular cp-count">${UI.num(list.length)} ${t(list.length === 1 ? "heading" : "headings")}</span></h3>${items ? `<ol class="cp-outline">${items}</ol>` : `<p class="small muted">${t("No headings found.")}</p>`}</div>`;
  }
  function structureBlock(d) {
    const terms = (who, words, help, list) => `<div class="cp-col"><h3><i class="cp-dot cp-dot-${who}" aria-hidden="true"></i>${esc(t(words))} <span class="muted tabular">${UI.num(list.length)}</span></h3><p class="help">${esc(t(help))}${UI.tip("Plain word matching, no AI.")}</p>${list.length ? `<div class="cp-tags cp-terms">${list.map((x) => `<span class="tag" dir="auto">${esc(x.term)}</span>`).join(" ")}</div>` : `<p class="small muted">${t("None")}</p>`}</div>`;
    const bothRead = isRead(d.mine) && isRead(d.theirs);
    return `<section class="card"><div class="cp-pairbox">${outlineColumn("mine", d.mine, d.theirs)}${outlineColumn("theirs", d.theirs, d.mine)}</div></section>
      ${bothRead && d.same_language ? `<section class="card"><div class="cp-pairbox">${terms("mine", "Words only you use", "In your headings, nowhere on their page.", d.terms_i_use)}${terms("theirs", "Words only they use", "In their headings, nowhere on your page.", d.terms_they_use)}</div></section>` : ""}`;
  }

  /* Notes on either page open in the Notes panel, beside the comparison, instead of sitting at its end. */
  function notesButton(d) {
    return COMP.notes?.button?.([
      { label: t("Their page"), icon: "file-text", where: { scope: "page", pageUrl: d.their_url, competitorId: d.competitor_id, siteId: COMP.siteId } },
      { label: t("My page"), icon: "file-text", where: { scope: "page", pageUrl: d.my_url, competitorId: null, siteId: COMP.siteId } },
    ]) ?? "";
  }

  // ---- the detail: an answer on top, then one tab per question.
  const youThemHead = (side) => `<span class="cp-id cp-id-${side}"><i aria-hidden="true"></i>${t(side === "mine" ? "You" : "Them")}</span>`;
  const SECTIONS = [["keywords", "Keywords"], ["structure", "Page structure"], ["content", "Content"], ["technical", "Technical"]];

  function sectionPanel(d) {
    if (S.section === "structure") return structureBlock(d);
    if (S.section === "content") return `${factsTable(d, ["Numbers", "Text"])}<p class="cp-foot-note cp-foot-plain">${t("Facts only: no verdict on which is better.")}</p>`;
    if (S.section === "technical") {
      const speed = `<tr><td class="head-cell cp-fact"><span class="kw">${t("Speed")}</span></td><td colspan="3" data-label=""><div class="cp-speed"><span>${t("Needs PageSpeed Insights")}</span><button class="btn btn-small" data-cp-speed>${t("Connect")}</button></div></td></tr>`;
      return factsTable(d, ["Setup", "Dates"], speed);
    }
    return keywordsPanel(d);
  }
  function answerNote(d) {
    if (isRead(d.mine) && isRead(d.theirs)) return "";
    if (isWaiting(d.mine.state) || isWaiting(d.theirs.state)) return `<p class="cp-answer-note">${t("Facts appear once both pages are read.")}</p>`;
    const words = !isRead(d.theirs) && isRead(d.mine) ? "Their page can't be read: rankings only." : !isRead(d.mine) && isRead(d.theirs) ? "Your page can't be read: rankings only." : "Neither page could be read: rankings only.";
    return `<p class="cp-answer-note">${t(words)}</p>`;
  }

  function detailBody() {
    const d = S.detail;
    const busy = Boolean(S.rereading);
    const verdict = verdictOf(d);
    const current = SECTIONS.some(([id]) => id === S.section) ? S.section : "keywords";
    return `<section class="card cp-head">
        <div class="card-head">
          <button class="btn btn-ghost btn-small cp-back" id="cp-back">${UI.icon("chevron-left")}${t("All pairs")}</button>
          <h2>${fill(esc(t("My page against {competitor}")), { competitor: `<span dir="auto">${esc(d.competitor)}</span>` })}</h2>
          ${d.source === "manual" ? `<span class="tag cp-yours" data-tip="${esc(t("Rankings won't replace it."))}">${t("Your choice")}</span>` : ""}
          <span class="end cp-actions">
            <button class="btn btn-small" id="cp-read" data-cp-read ${busy ? "disabled" : ""}>${UI.icon("refresh-cw", busy ? "spin" : "")}${t("Read again")}</button>
            <button class="btn btn-small" id="cp-change" data-cp-change="${d.id}">${UI.icon("pencil")}${t("Change pair")}</button>
            ${notesButton(d)}
            ${UI.taskButton(pairFind(d))}
          </span>
        </div>
        <div class="cp-answer">${verdict.text ? verdictBadge(verdict) : ""}${answerNote(d)}</div>
        ${UI.relatedTasks({ host: COMP.site()?.host || "", page: d.my_url })}
        ${d.same_language === false ? `<p class="note cp-choice">${UI.icon("languages")}<span>${t("Different languages: comparing words means little.")}</span></p>` : ""}
        ${S.readWaiting ? `<p class="note cp-choice" role="status">${UI.icon("clock")}<span>${t("Waiting to start…")}</span></p>` : ""}
        <div class="cp-versus">${sideHead("mine", d.mine)}${sideHead("theirs", d.theirs)}</div>
      </section>
      <div class="cp-tabs" role="tablist" aria-label="${t("Page vs page")}">
        ${SECTIONS.map(([id, label]) => `<button class="cp-tab" role="tab" id="cp-tab-${id}" data-cp-section="${id}" aria-selected="${id === current}" aria-controls="cp-panel" tabindex="${id === current ? 0 : -1}">${t(label)}</button>`).join("")}
      </div>
      <div class="cp-panel" id="cp-panel" role="tabpanel" aria-labelledby="cp-tab-${current}">${sectionPanel(d)}</div>`;
  }

  // ---- keeping an eye on pages being read -------------------------------------------------------
  const unreadSide = (d) => isWaiting(d.mine.state) || isWaiting(d.theirs.state);
  const needsWatching = () => (S.view === "detail" && S.detail ? unreadSide(S.detail) || Boolean(S.rereading) : S.view === "list" && S.pairs.some((p) => isWaiting(p.my_state) || isWaiting(p.their_state)));
  function resetWatch() { clearTimeout(W.timer); W.timer = null; W.key = null; W.expired = false; }

  function keepWatching() {
    if (!onScreen() || !needsWatching()) { clearTimeout(W.timer); W.timer = null; return; }
    const key = S.view === "detail" ? `d${S.detail.id}` : `l${S.site}`;
    if (W.key !== key) { clearTimeout(W.timer); W.timer = null; W.key = key; W.started = Date.now(); W.expired = false; }
    if (W.expired || W.timer) return;
    W.timer = setTimeout(watchTick, WATCH_EVERY);
  }

  /* Redraw only when something changed, and leave focus where it was. A half-typed note is never redrawn away. */
  function repaint() {
    const active = document.activeElement;
    if (active?.matches?.("#comp-body textarea, #comp-body input[type=text]")) {
      active.addEventListener("blur", () => setTimeout(() => { if (onScreen()) repaint(); }, 400), { once: true });
      return false;
    }
    const id = active?.id;
    COMP.paint();
    if (id) document.getElementById(id)?.focus({ preventScroll: true });
    return true;
  }

  async function watchTick() {
    W.timer = null;
    if (!onScreen() || !needsWatching()) return;
    const key = W.key, timedOut = Date.now() - W.started >= WATCH_FOR;
    let changed = false;
    try {
      if (S.view === "detail") {
        const next = await COMP.api("GET", `page-pairs/${S.detail.id}`);
        if (W.key !== key || S.view !== "detail" || S.detail?.id !== next.id) return;
        changed = JSON.stringify(next) !== JSON.stringify(S.detail);
        S.detail = next;
        if (S.rereading && next.mine.last_checked_at !== S.rereading.mine && next.theirs.last_checked_at !== S.rereading.theirs) {
          S.rereading = null;
          S.dirty = changed = true;
          UI.toast(t("Both pages reread."));
        }
      } else {
        const next = (await COMP.api("GET", `page-pairs?site_id=${S.site}`)).pairs;
        if (W.key !== key || S.view !== "list") return;
        changed = JSON.stringify(next) !== JSON.stringify(S.pairs);
        S.pairs = next;
      }
    } catch { /* a passing failure just means the next look is the one that counts */ }
    if (timedOut && needsWatching()) {
      W.expired = true;
      if (S.rereading) { S.rereading = null; S.readWaiting = true; }
      changed = true;
    }
    if (onScreen() && changed) repaint();
    keepWatching();
  }

  // ---- change a pair, add a pair ----------------------------------------------------------------
  const pagesOf = async (siteId) => { try { return (await COMP.api("GET", `sites/${siteId}/pages`)).pages; } catch { return []; } };
  const optionText = (page) => (page.title ? `${page.title} · ${COMP.shortUrl(page.url)}` : COMP.shortUrl(page.url));
  function pickerOptions(pages, current) {
    const list = current && !pages.some((p) => p.url === current) ? [{ url: current, title: "" }, ...pages] : pages;
    return `${list.map((p) => `<option value="${esc(p.url)}" dir="auto" ${p.url === current ? "selected" : ""}>${esc(optionText(p))}</option>`).join("")}<option value="${TYPE_OWN}" ${current ? "" : "selected"}>${t("Type another address…")}</option>`;
  }
  function picker(key, label, pages, current, host) {
    return `<label class="field"><span>${label}</span><select class="select cp-pick" id="cp-${key}" data-cp-pick="${key}">${pickerOptions(pages, current)}</select></label>
      <label class="field cp-typed" id="cp-${key}-typed" hidden><span>${t("Address")}</span><input class="input mono" id="cp-${key}-url" type="text" inputmode="url" dir="ltr" autocomplete="off" spellcheck="false" placeholder="https://${esc(host)}/page" aria-describedby="cp-${key}-error"></label>
      <div id="cp-${key}-error" class="cp-field-error"></div>`;
  }
  function syncPickers() {
    UI.$$(".cp-pick").forEach((select) => {
      const key = select.dataset.cpPick, typed = select.value === TYPE_OWN;
      const box = UI.$(`#cp-${key}-typed`);
      if (box) box.hidden = !typed;
    });
  }
  const pickedValue = (key) => {
    const value = UI.$(`#cp-${key}`).value;
    return value === TYPE_OWN ? UI.$(`#cp-${key}-url`).value.trim() : value;
  };
  function clearFieldErrors() {
    ["my", "their"].forEach((key) => {
      const box = UI.$(`#cp-${key}-error`);
      if (box) box.replaceChildren();
      UI.$(`#cp-${key}-url`)?.classList.remove("invalid");
    });
  }
  function fieldError(key, message) {
    UI.setHTML(UI.$(`#cp-${key}-error`), `<div class="error" role="alert">${UI.icon("octagon-alert")}<span>${esc(message)}</span></div>`);
    const typed = UI.$(`#cp-${key}`).value === TYPE_OWN;
    const input = typed ? UI.$(`#cp-${key}-url`) : UI.$(`#cp-${key}`);
    if (typed) input.classList.add("invalid");
    input.focus();
  }
  /* Put the server's sentence by the field it's about. It names the host when a page is on the wrong site. */
  function errorField(err, myHost) {
    const host = String(err.message).match(/isn't on (.+)\.$/)?.[1];
    if (host) return host === myHost ? "my" : "their";
    if (/already compare/.test(err.message)) return "my";
    if (UI.$("#cp-my").value === TYPE_OWN) return "my";
    return UI.$("#cp-their").value === TYPE_OWN ? "their" : "my";
  }

  const panelFoot = (pair) => `<div class="panel-foot cp-foot">
      <button class="btn btn-main" id="cp-save">${t(pair ? "Save" : "Add")}</button>
      <button class="btn" data-discard-panel>${t("Cancel")}</button>
      ${pair?.source === "manual" ? `<button class="btn btn-ghost" id="cp-auto">${UI.icon("refresh-cw")}${t("Back to automatic")}</button>` : ""}
      ${pair ? `<button class="btn btn-ghost" id="cp-hide">${UI.icon("eye")}${t("Hide pair")}</button>` : ""}
    </div>`;

  async function openChange(id, opener) {
    const pair = S.detail?.id === id ? S.detail : S.pairs.find((p) => p.id === id);
    if (!pair) return;
    const [mine, theirs] = await Promise.all([pagesOf(S.site), pagesOf(pair.competitor_id)]);
    UI.openPanel(`${UI.panelHead(t("Change pair"), `<span dir="auto">${esc(pair.competitor)}</span>`)}
      <form class="panel-body" id="cp-form" data-cp-id="${pair.id}" novalidate>
        ${picker("my", COMP.who("you", null, t("My page")), mine, pair.my_url, site()?.host || "")}
        ${picker("their", COMP.who("them", null, t("Their page")), theirs, pair.their_url, pair.competitor)}
        <p class="note">${UI.icon("info")}<span>${t("Once saved, rankings won't replace it.")}</span></p>
      </form>
      ${panelFoot(pair)}`, opener, { key: `cp-change|${pair.id}`, reopen: () => openChange(id, opener), after: syncPickers });
    UI.$("#cp-my")?.focus({ preventScroll: true });
  }

  async function openAdd(opener) {
    // Start on a competitor whose pages can be read: a pair with a site that refuses the app has nothing to put side by side.
    const refused = new Set(S.pairs.filter((p) => !p.their_facts && (p.their_state === "robots" || p.their_state === "blocked")).map((p) => p.competitor_id));
    const preset = S.filter || String((S.competitors.find((c) => !refused.has(c.id)) || S.competitors[0])?.id ?? "");
    const competitor = S.competitors.find((c) => String(c.id) === preset);
    if (!competitor) return;
    const [mine, theirs] = await Promise.all([pagesOf(S.site), pagesOf(competitor.id)]);
    UI.openPanel(`${UI.panelHead(t("Add a pair"), t("Your page and theirs."))}
      <form class="panel-body" id="cp-form" novalidate>
        <label class="field"><span>${t("Competitor")}</span><select class="select" id="cp-comp" style="width:100%">${S.competitors.map((c) => `<option value="${c.id}" ${c.id === competitor.id ? "selected" : ""}>${esc(c.display || c.host)}</option>`).join("")}</select></label>
        ${picker("my", COMP.who("you", null, t("My page")), mine, "", site()?.host || "")}
        ${picker("their", COMP.who("them", null, t("Their page")), theirs, "", competitor.host)}
        <p class="note">${UI.icon("info")}<span>${t("Rankings won't replace a pair you add.")}</span></p>
      </form>
      ${panelFoot(null)}`, opener, { key: "cp-add", reopen: () => openAdd(opener), after: () => {
        // A picker with known pages starts on the first of them, so the form opens ready to save.
        ["my", "their"].forEach((key) => { const select = UI.$(`#cp-${key}`); if (select && select.options.length > 1 && select.value === TYPE_OWN && !UI.$(`#cp-${key}-url`).value) select.selectedIndex = 0; });
        syncPickers();
      } });
    UI.$("#cp-comp")?.focus({ preventScroll: true });
  }

  async function savePanel(button) {
    const form = UI.$("#cp-form");
    if (!form) return;
    clearFieldErrors();
    const mine = pickedValue("my"), theirs = pickedValue("their");
    if (!mine) { fieldError("my", t("Type an address.")); return; }
    if (!theirs) { fieldError("their", t("Type an address.")); return; }
    const id = form.dataset.cpId ? Number(form.dataset.cpId) : null;
    button.disabled = true;
    try {
      const answer = id
        ? await COMP.api("PATCH", `page-pairs/${id}`, { my_url: mine, their_url: theirs })
        : await COMP.api("POST", "page-pairs", { site_id: COMP.siteId, competitor_id: Number(UI.$("#cp-comp").value), my_url: mine, their_url: theirs });
      UI.forgetPanelForm();
      UI.closePanel();
      if (!id || S.view === "detail") { S.detail = answer; S.view = "detail"; S.rereading = null; S.readWaiting = false; }
      UI.toast(t(id ? "Saved. Rankings won't replace it." : "Pair added. Rankings won't replace it."));
      await COMP.reload({ quiet: true });
      if (S.view === "detail") { if (!id) UI.$("#main").scrollTop = 0; UI.$("#cp-change")?.focus({ preventScroll: true }); } else UI.$(`#cp-open-${id}`)?.focus({ preventScroll: true });
    } catch (err) {
      button.disabled = false;
      fieldError(errorField(err, site()?.host), serverWords(err.message));
    }
  }

  /* Hiding marks a pair as mine, so rankings can't bring it back by themselves. Undo returns it as it was. */
  async function hidePair(button) {
    const id = Number(UI.$("#cp-form")?.dataset.cpId);
    const pair = S.detail?.id === id ? S.detail : S.pairs.find((p) => p.id === id);
    if (!pair) return;
    const wasAutomatic = pair.source === "auto";
    button.disabled = true;
    try {
      await COMP.api("PATCH", `page-pairs/${id}`, { hidden: true });
    } catch (err) { button.disabled = false; COMP.fail(err); return; }
    UI.forgetPanelForm();
    UI.closePanel();
    S.view = "list"; S.detail = null; S.rereading = null;
    await refreshTab();
    UI.toast(t("Pair hidden"), { kind: "info", undo: async () => {
      try {
        if (wasAutomatic) await COMP.api("POST", `page-pairs/${id}/automatic`);
        else await COMP.api("PATCH", `page-pairs/${id}`, { hidden: false });
        await refreshTab();
        UI.$(`#cp-open-${id}`)?.focus({ preventScroll: true });
      } catch (err) { COMP.fail(err); }
    } });
  }

  async function backToAutomatic(button) {
    const id = Number(UI.$("#cp-form")?.dataset.cpId);
    button.disabled = true;
    let answer;
    try {
      answer = await COMP.api("POST", `page-pairs/${id}/automatic`);
    } catch (err) { button.disabled = false; COMP.fail(err); return; }
    UI.forgetPanelForm();
    UI.closePanel();
    if (answer.removed) {
      S.view = "list"; S.detail = null;
      UI.toast(t("Back to automatic. No shared keyword now, so the pair is gone."), { kind: "info" });
    } else {
      if (S.view === "detail") S.detail = answer;
      UI.toast(t("Back to automatic: rankings pick it again."));
    }
    await refreshTab();
  }

  async function refreshTab() {
    if (onScreen()) await COMP.reload({ quiet: true });
    else tab.loadedFor = undefined;
  }

  // ---- moving between the list and the detail ---------------------------------------------------
  async function openDetail(id) {
    S.listScroll = UI.$("#main")?.scrollTop || 0;
    let detail;
    try {
      detail = await COMP.api("GET", `page-pairs/${id}`);
    } catch (err) { COMP.fail(err); return; }
    if (S.detail?.id !== detail.id) { TP.state(KW_PAGES).q = ""; TP.reset(KW_PAGES); } // another pair starts on its first keywords
    S.detail = detail; S.view = "detail"; S.rereading = null; S.readWaiting = false; S.section = "keywords";
    resetWatch();
    COMP.paint();
    UI.syncUrl();
    UI.$("#main").scrollTop = 0;
    UI.$("#cp-back")?.focus({ preventScroll: true });
  }

  // For the address bar: which pair is open, and opening or closing one from an address.
  COMP.pairShown = () => (COMP.tab !== "pairs" ? null : tab.openPairId ?? S.loadingPair ?? (S.view === "detail" ? S.detail?.id : null));
  COMP.showPair = (id) => {
    if (id) tab.openPairId = id;
    else if (S.view === "detail") { S.view = "list"; S.detail = null; }
    tab.loadedFor = undefined;
  };

  async function backToList() {
    const id = S.detail?.id;
    S.view = "list"; S.detail = null; S.rereading = null; S.readWaiting = false;
    resetWatch();
    if (S.dirty) await COMP.reload({ quiet: true }); else COMP.paint();
    UI.$("#main").scrollTop = S.listScroll;
    UI.$(`#cp-open-${id}`)?.focus({ preventScroll: true });
  }

  async function readAgain(button) {
    const d = S.detail;
    if (!d) return;
    button.disabled = true;
    try {
      await COMP.api("POST", `page-pairs/${d.id}/read`);
    } catch (err) { button.disabled = false; COMP.fail(err); return; }
    S.rereading = { mine: d.mine.last_checked_at, theirs: d.theirs.last_checked_at };
    S.readWaiting = false;
    resetWatch();
    repaint();
    UI.$("#cp-change")?.focus({ preventScroll: true });
    keepWatching();
  }

  function bind() {
    document.addEventListener("click", (e) => {
      const hit = (sel) => e.target.closest?.(sel);
      let el;
      if (hit('[data-comp-tab="pairs"]')) { S.view = "list"; S.detail = null; S.rereading = null; return; }
      if ((el = hit("[data-cp-open]"))) { openDetail(Number(el.dataset.cpOpen)); return; }
      if ((el = hit("[data-cp-sort]"))) {
        const key = el.dataset.cpSort, first = "asc"; // names A to Z, positions the best (smallest) first
        S.sort = S.sort?.key !== key ? { key, dir: first } : S.sort.dir === first ? { key, dir: "desc" } : null; // a third press goes back to the usual order
        TP.reset(PAGES); COMP.paint(); UI.$(`[data-cp-sort="${key}"]`)?.focus();
        return;
      }
      if ((el = hit("[data-cp-verdict]"))) { S.verdict = el.dataset.cpVerdict; TP.reset(PAGES); COMP.paint(); UI.$(`[data-cp-verdict="${S.verdict}"]`)?.focus(); return; }
      if (hit("[data-cp-same]")) { S.showSame = !S.showSame; repaint(); UI.$("#cp-same")?.focus({ preventScroll: true }); return; }
      if ((el = hit("[data-cp-section]"))) { S.section = el.dataset.cpSection; repaint(); UI.$(`#cp-tab-${S.section}`)?.focus({ preventScroll: true }); return; }
      if (hit("#cp-back")) { backToList(); return; }
      if ((el = hit("[data-cp-change]"))) { openChange(Number(el.dataset.cpChange), el); return; }
      if ((el = hit("[data-cp-add]"))) { openAdd(el); return; }
      if (hit("[data-cp-find]")) { COMP.open("find"); return; }
      if ((el = hit("[data-cp-read]"))) { readAgain(el); return; }
      if (hit("[data-cp-speed]")) { UI.openConnection("pagespeed"); return; }
      if ((el = hit("#cp-save"))) { savePanel(el); return; }
      if ((el = hit("#cp-auto"))) { backToAutomatic(el); return; }
      if ((el = hit("#cp-hide"))) { hidePair(el); return; }
      const row = hit("#cp-table tbody tr[data-cp-row]");
      if (row && !hit("a, button, input, select, label") && !String(getSelection?.() || "")) openDetail(Number(row.dataset.cpRow));
    });
    document.addEventListener("change", async (e) => {
      const id = e.target.id;
      if (id === "cp-filter") {
        S.filter = e.target.value;
        TP.reset(PAGES);
        COMP.paint();
        UI.$("#cp-filter")?.focus();
        return;
      }
      if (e.target.matches?.(".cp-pick")) {
        syncPickers();
        const key = e.target.dataset.cpPick;
        clearFieldErrors();
        if (e.target.value === TYPE_OWN) UI.$(`#cp-${key}-url`)?.focus();
        return;
      }
      if (id === "cp-comp") {
        const competitor = S.competitors.find((c) => String(c.id) === e.target.value);
        const pages = competitor ? await pagesOf(competitor.id) : [];
        const select = UI.$("#cp-their");
        if (!select || UI.$("#cp-comp")?.value !== e.target.value) return; // the panel closed or the choice moved on meanwhile
        UI.setHTML(select, pickerOptions(pages, pages[0]?.url || ""));
        const input = UI.$("#cp-their-url");
        if (input && competitor) { input.placeholder = `https://${competitor.host}/page`; input.value = ""; }
        clearFieldErrors();
        syncPickers();
      }
    });
    // Enter in a typed address saves, as it would in any form.
    document.addEventListener("keydown", (e) => {
      if (e.target.matches?.("[data-cp-section]") && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        const ids = SECTIONS.map(([id]) => id), at = ids.indexOf(e.target.dataset.cpSection);
        S.section = { ArrowLeft: ids[(at - 1 + ids.length) % ids.length], ArrowRight: ids[(at + 1) % ids.length], Home: ids[0], End: ids[ids.length - 1] }[e.key];
        repaint();
        UI.$(`#cp-tab-${S.section}`)?.focus({ preventScroll: true });
        return;
      }
      if (e.key === "Enter" && e.target.matches?.("#cp-my-url, #cp-their-url")) {
        e.preventDefault();
        const save = UI.$("#cp-save");
        if (save && !save.disabled) savePanel(save);
      }
    });
  }

  // ---- the tab ----------------------------------------------------------------------------------
  const tab = {
    id: "pairs", order: 30, label: "Page vs page", icon: "columns-3",
    init(helpers) {
      UI = helpers; bind();
      TP.on(PAGES, () => COMP.paint()); // another page, another size or a search; the helper keeps the focus
      TP.on(KW_PAGES, () => COMP.paint());
    },
    async load() {
      const siteId = COMP.siteId;
      if (S.site !== siteId) {
        S.site = siteId; S.view = "list"; S.detail = null; S.filter = ""; S.verdict = null; S.rereading = null; S.readWaiting = false; S.sort = null;
        [PAGES, KW_PAGES].forEach((key) => { TP.state(key).q = ""; TP.reset(key); });
      }
      resetWatch();
      const openId = tab.openPairId;
      tab.openPairId = null;
      S.loadingPair = openId ?? null; // the address keeps naming it while it loads
      const [pairs, competitors] = await Promise.all([COMP.api("GET", `page-pairs?site_id=${siteId}`), COMP.api("GET", `competitors?site_id=${siteId}`)]);
      if (siteId !== COMP.siteId) return; // another site was picked while this was on its way
      S.pairs = pairs.pairs;
      S.competitors = competitors.competitors;
      S.dirty = false;
      if (S.filter && !S.competitors.some((c) => String(c.id) === S.filter)) S.filter = "";
      const wanted = openId ?? (S.view === "detail" ? S.detail?.id : null);
      if (!wanted) return;
      try {
        const next = await COMP.api("GET", `page-pairs/${wanted}`);
        if (S.detail?.id !== next.id) { TP.state(KW_PAGES).q = ""; TP.reset(KW_PAGES); }
        S.detail = next;
        S.view = "detail";
      } catch (err) {
        S.view = "list"; S.detail = null;
        if (openId) COMP.fail(err);
      }
    },
    body() { return S.view === "detail" && S.detail ? detailBody() : listBody(); },
    after() {
      S.loadingPair = null;
      UI.syncUrl();
      if (S.view === "detail") COMP.notes?.mount?.();
      keepWatching();
    },
  };
  COMP.addTab(tab);

  // ---- opened as a plain file: the same writes, changing the sample in place -------------------
  const sample = () => window.COMP_SAMPLE.get;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const sampleDetails = () => Object.keys(sample()).filter((key) => /^page-pairs\/\d+$/.test(key)).map((key) => sample()[key]);
  const sampleDetail = (id) => {
    const detail = sample()[`page-pairs/${id}`];
    if (!detail) throw new Error("That pair doesn't exist.");
    return detail;
  };
  const sampleHost = (siteId) => sample()["links/sites"].sites.find((s) => s.id === siteId)?.host || "";
  const originals = new Map(); // how an automatic pair looked before anyone changed it, for "Back to automatic"
  let rankIndex = null;

  /* Every position, citation and word use we know, by page and keyword. Taken before the first change. */
  function ranks() {
    if (rankIndex) return rankIndex;
    rankIndex = new Map();
    sampleDetails().forEach((d) => d.keywords.forEach((row) => {
      rankIndex.set(`${d.my_url}|${row.keyword}`, { row, position: row.my_position, cites: row.ai_cites_me, use: row.mine });
      rankIndex.set(`${d.their_url}|${row.keyword}`, { row, position: row.their_position, cites: row.ai_cites_them, use: row.theirs });
    }));
    return rankIndex;
  }
  const fold = (text) => String(text || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const wordsOf = (text) => fold(text).match(/[\p{L}\p{N}]+/gu) || [];
  const headingTexts = (side) => [...(side.h1 || []), ...(side.headings || []).map((h) => h[1])];
  const pageWords = (side) => new Set(wordsOf([side.title, side.meta_description, ...headingTexts(side)].join(" ")));
  function missingTerms(from, against) {
    const known = pageWords(against), counts = new Map();
    headingTexts(from).forEach((heading) => new Set(wordsOf(heading)).forEach((word) => {
      if (word.length >= 3 && !/^\d+$/.test(word) && !known.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
    }));
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([term, headings]) => ({ term, headings }));
  }
  const onlyHeadings = (a, b) => { const other = new Set(headingTexts(b).map((h) => fold(h).trim())); return headingTexts(a).filter((h) => !other.has(fold(h).trim())).slice(0, 50); };
  const includes = (text, keyword) => fold(text).includes(fold(keyword));
  const useOn = (side, keyword) => ({ title: includes(side.title, keyword), h1: (side.h1 || []).some((h) => includes(h, keyword)), headings: (side.headings || []).filter((h) => includes(h[1], keyword)).length, meta: includes(side.meta_description, keyword), body: false });
  function knownSide(url) {
    for (const d of sampleDetails()) {
      if (d.mine?.url === url) return copy(d.mine);
      if (d.theirs?.url === url) return copy(d.theirs);
    }
    return { url, state: "not_read", http_status: null };
  }
  function sampleKeywords(d) {
    const index = ranks();
    const names = new Set([...index.keys()].map((key) => key.slice(key.lastIndexOf("|") + 1)));
    const rows = [];
    names.forEach((keyword) => {
      const mine = index.get(`${d.my_url}|${keyword}`), theirs = index.get(`${d.their_url}|${keyword}`);
      const myPosition = mine?.position ?? null, theirPosition = theirs?.position ?? null;
      if (myPosition === null && theirPosition === null) return;
      rows.push({
        ...copy((mine || theirs).row), keyword, my_position: myPosition, their_position: theirPosition,
        ai_cites_me: Boolean(mine?.cites), ai_cites_them: Boolean(theirs?.cites),
        mine: isRead(d.mine) ? (mine?.use || useOn(d.mine, keyword)) : null, theirs: isRead(d.theirs) ? (theirs?.use || useOn(d.theirs, keyword)) : null,
      });
    });
    return rows.sort((a, b) => Number(a.my_position === null || a.their_position === null) - Number(b.my_position === null || b.their_position === null) || a.keyword.localeCompare(b.keyword));
  }
  function sampleRanking(rows) {
    const both = rows.filter((k) => k.my_position !== null && k.their_position !== null);
    const gaps = both.map((k) => k.my_position - k.their_position);
    const list = rows.map((k) => ({ keyword: k.keyword, my_position: k.my_position, their_position: k.their_position, depth: k.depth }))
      .sort((a, b) => Number(a.my_position === null || a.their_position === null) - Number(b.my_position === null || b.their_position === null) || Math.abs((b.my_position || 0) - (b.their_position || 0)) - Math.abs((a.my_position || 0) - (a.their_position || 0)) || a.keyword.localeCompare(b.keyword));
    return {
      shared: both.length, they_ahead: gaps.filter((g) => g > 0).length, i_ahead: gaps.filter((g) => g < 0).length, level: gaps.filter((g) => g === 0).length,
      only_mine: rows.filter((k) => k.my_position !== null && k.their_position === null).length, only_theirs: rows.filter((k) => k.my_position === null && k.their_position !== null).length,
      gap: gaps.length ? Math.round((gaps.reduce((x, y) => x + y, 0) / gaps.length) * 10) / 10 : null, keywords: list.slice(0, 5), keywords_total: list.length,
    };
  }
  const sampleFacts = (side) => (isRead(side) ? { words: side.word_count || 0, headings: (side.h1 || []).length + (side.headings || []).length, schema_types: side.schema_types || [], js_only: Boolean(side.js_only) } : null);

  function rebuildSample(d) {
    d.mine = knownSide(d.my_url);
    d.theirs = knownSide(d.their_url);
    d.my_title = d.mine.title || ""; d.their_title = d.theirs.title || "";
    d.my_state = d.mine.state; d.their_state = d.theirs.state;
    const bothRead = isRead(d.mine) && isRead(d.theirs), a = d.mine.lang, b = d.theirs.lang;
    d.same_language = !(a && b) || a.slice(0, 2).toLowerCase() === b.slice(0, 2).toLowerCase();
    d.terms_they_use = bothRead && d.same_language ? missingTerms(d.theirs, d.mine) : [];
    d.terms_i_use = bothRead && d.same_language ? missingTerms(d.mine, d.theirs) : [];
    d.headings_only_theirs = bothRead ? onlyHeadings(d.theirs, d.mine) : [];
    d.headings_only_mine = bothRead ? onlyHeadings(d.mine, d.theirs) : [];
    d.keywords = sampleKeywords(d);
    d.shared_keywords = d.keywords.filter((row) => row.my_position !== null && row.their_position !== null).length;
    d.ranking = sampleRanking(d.keywords);
    d.my_facts = sampleFacts(d.mine);
    d.their_facts = sampleFacts(d.theirs);
    d.updated_at = new Date().toISOString();
  }
  function syncSampleList(d) {
    const key = `page-pairs?site_id=${d.site_id}`;
    sample()[key] = sample()[key] || { pairs: [] };
    const list = sample()[key].pairs;
    const at = list.findIndex((p) => p.id === d.id);
    if (at >= 0) list.splice(at, 1);
    if (!d.hidden) {
      const { mine, theirs, keywords, same_language, terms_they_use, terms_i_use, headings_only_theirs, headings_only_mine, ...row } = copy(d);
      list.push(row);
    }
    list.sort((a, b) => Number(b.source === "manual") - Number(a.source === "manual") || b.shared_keywords - a.shared_keywords || a.my_url.localeCompare(b.my_url));
  }
  function cleanAddress(address, host) {
    const raw = String(address || "").trim();
    let parsed = null;
    try { parsed = new URL(raw.includes("://") ? raw : `https://${raw}`); } catch { /* said below */ }
    if (!parsed || !/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes(".")) throw new Error("Not a web address.");
    const name = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (name !== host && !name.endsWith(`.${host}`)) throw new Error(`That page isn't on ${host}.`);
    parsed.hash = "";
    return parsed.toString();
  }
  const remember = (d) => { if (d.source === "auto" && !originals.has(d.id)) originals.set(d.id, copy(d)); };
  function removeHiddenTwin(d, myUrl) {
    const twin = sampleDetails().find((x) => x.id !== d.id && x.site_id === d.site_id && x.competitor_id === d.competitor_id && x.my_url === myUrl);
    if (!twin) return;
    if (!twin.hidden) throw new Error("You already compare that page with this competitor. Change that pair instead.");
    delete sample()[`page-pairs/${twin.id}`];
  }

  COMP.sampleWrite("POST page-pairs", (match, body) => {
    ranks();
    const competitor = sample()[`competitors?site_id=${body.site_id}`]?.competitors.find((c) => c.id === body.competitor_id);
    if (!competitor) throw new Error("Competitor not found.");
    const mine = cleanAddress(body.my_url, sampleHost(body.site_id)), theirs = cleanAddress(body.their_url, competitor.host);
    let d = sampleDetails().find((x) => x.site_id === body.site_id && x.competitor_id === body.competitor_id && x.my_url === mine);
    if (d) {
      remember(d);
      d.their_url = theirs; d.source = "manual"; d.hidden = false;
    } else {
      const id = Math.max(0, ...sampleDetails().map((x) => x.id)) + 1;
      d = { id, site_id: body.site_id, competitor_id: body.competitor_id, competitor: competitor.host, my_url: mine, their_url: theirs, source: "manual", hidden: false, shared_keywords: 0 };
      sample()[`page-pairs/${id}`] = d;
    }
    rebuildSample(d);
    syncSampleList(d);
    return copy(d);
  });
  COMP.sampleWrite("PATCH page-pairs/(\\d+)", (match, body) => {
    ranks();
    const d = sampleDetail(match[1]);
    const mine = body.my_url !== undefined ? cleanAddress(body.my_url, sampleHost(d.site_id)) : d.my_url;
    const theirs = body.their_url !== undefined ? cleanAddress(body.their_url, d.competitor) : d.their_url;
    if (mine !== d.my_url) removeHiddenTwin(d, mine);
    remember(d);
    d.my_url = mine; d.their_url = theirs; d.source = "manual";
    if (body.hidden !== undefined) d.hidden = Boolean(body.hidden);
    if (body.my_url !== undefined || body.their_url !== undefined) rebuildSample(d);
    syncSampleList(d);
    return copy(d);
  });
  COMP.sampleWrite("POST page-pairs/(\\d+)/automatic", (match) => {
    const d = sampleDetail(match[1]);
    const before = originals.get(d.id);
    if (!before) {
      delete sample()[`page-pairs/${d.id}`];
      d.hidden = true;
      syncSampleList(d);
      return { removed: true };
    }
    originals.delete(d.id);
    const restored = copy(before);
    restored.hidden = false;
    sample()[`page-pairs/${d.id}`] = restored;
    syncSampleList(restored);
    return copy(restored);
  });
  COMP.sampleWrite("POST page-pairs/(\\d+)/read", (match) => {
    const d = sampleDetail(match[1]), now = new Date().toISOString();
    d.mine.last_checked_at = now;
    d.theirs.last_checked_at = now;
    return { ok: true };
  });

  Object.assign(window.FR, {
    "Page vs page": "Page contre page",
    "Search pages and keywords": "Chercher une page ou un mot-clé", "Search keywords": "Chercher un mot-clé",
    "pairs": "paires", "keywords": "mots-clés", "No pair matches this search.": "Aucune paire ne correspond à cette recherche.",
    "No keyword matches.": "Aucun mot-clé ne correspond.", "Clear search": "Effacer la recherche",
    "place": "place", "places": "places",
    "Only they rank": "Eux seuls se classent", "Only you rank": "Vous seul vous classez", "Different keywords": "Mots-clés différents",
    "No shared keyword": "Aucun mot-clé commun", 
    "They're {n} ahead": "Ils ont {n} d'avance", "You're {n} ahead": "Vous avez {n} d'avance",
    "They're ahead on {a} of {b} keywords": "Ils sont devant sur {a} mots-clés sur {b}", "You're ahead on {a} of {b} keywords": "Vous êtes devant sur {a} mots-clés sur {b}",
    "Same position": "Même position", "Even across {b} keywords": "À égalité sur {b} mots-clés", "You": "Vous", "Them": "Eux",
    "more": "de plus", "Words": "Mots", "Headings": "Titres", "Rankings": "Positions",
    "Who's ahead": "Qui est devant", "Compare": "Comparer", "All": "Toutes", "They're ahead": "Ils sont devant", "You're ahead": "Vous êtes devant", "Even": "À égalité",
    "Your pages beside the competitor page ranking with them most, furthest behind first. Pairs you change stay.": "Vos pages à côté de la page concurrente qui se classe le plus avec elles, les plus en retard d'abord. Les paires modifiées restent.",
    "{host} blocks reading: rankings only.": "{host} bloque la lecture : positions seulement.",
    "{host} couldn't be read this time: rankings only.": "{host} n'a pas pu être lu cette fois : positions seulement.",
    "Nothing here": "Rien ici", "No pair matches this filter.": "Aucune paire ne correspond à ce filtre.", "No title": "Pas de titre",
    "Dates": "Dates",
    "Facts appear once both pages are read.": "Les faits apparaissent une fois les deux pages lues.",
    "What the app read on your page": "Ce que l'application a lu sur votre page", "What the app read on their page": "Ce que l'application a lu sur leur page",
    "Hide what's the same": "Masquer ce qui est identique",
    "Show {n} identical fact": "Afficher {n} fait identique", "Show {n} identical facts": "Afficher {n} faits identiques",
    "{n} behind": "{n} de retard", "{n} ahead": "{n} d'avance", "Only their page ranks": "Seule leur page se classe", "Only your page ranks": "Seule votre page se classe",
    "Headings ": "Sous-titres", "Page structure": "Structure de la page", "Both pages": "Les deux pages", "No headings found.": "Aucun titre trouvé.", "A tick: the keyword appears there.": "Une coche : le mot-clé y apparaît.", ">{n}: not in the top {n}.": ">{n} : hors des {n} premiers.", 
    "Their page can't be read: rankings only.": "Leur page ne peut pas être lue : positions seulement.", "Your page can't be read: rankings only.": "Votre page ne peut pas être lue : positions seulement.", "Neither page could be read: rankings only.": "Aucune des deux pages n'a pu être lue : positions seulement.", "Position": "Position", "Difference": "Différence", "Numbers": "Chiffres", "Text": "Textes", "Setup": "Configuration",
    "Your {path} is #{n}": "Votre page {path} est n°{n}", "Their {path} is #{n}": "Leur page {path} est n°{n}",
    "Add a pair": "Ajouter une paire",
    "Add": "Ajouter",
    "No competitors yet": "Aucun concurrent pour l'instant",
    "Add a competitor first.": "Ajoutez d'abord un concurrent.",
    "Find competitors": "Trouver des concurrents",
    "No pairs yet": "Aucune paire pour l'instant",
    "Add one by hand.": "Ajoutez-en une à la main.",
    "No pairs with this competitor": "Aucune paire avec ce concurrent",
    "Competitor": "Concurrent",
    "All competitors": "Tous les concurrents",
    "The app picks these pairs from who ranks for the same keywords. Change a pair and your choice stays.": "L'application choisit ces paires selon qui se classe sur les mêmes mots-clés. Modifiez une paire et votre choix reste.",
    "Open this pair": "Ouvrir cette paire",
    "My page": "Ma page",
    "Their page": "Leur page",
    "Shared keywords": "Mots-clés communs",
    "Picked by": "Choisie par",
    "Reading": "Lecture",
    "Reading {n} page…": "Lecture de {n} page…", "Reading {n} pages…": "Lecture de {n} pages…",
    "All checked with {tool}, {when}.": "Tous vérifiés avec {tool}, {when}.",
    "Action": "Action",
    "Your choice": "Votre choix",
    "Picked automatically": "Choisie automatiquement",
    "Change pair": "Modifier la paire",
    "Read": "Lue",
    "Reading…": "Lecture…",
    "Waiting": "En attente",
    "Not allowed": "Non autorisée",
    "robots.txt forbids reading this page. The app respects that.": "robots.txt interdit la lecture de cette page. L'application le respecte.",
    "Blocked": "Bloquée",
    "The site blocked the app, e.g. with a bot check. The app won't bypass it.": "Le site a bloqué l'application, par exemple avec une vérification anti-robot. L'application ne la contourne pas.",
    "Page gone": "Page disparue",
    "The site says this page no longer exists.": "Le site indique que cette page n'existe plus.",
    "Couldn't reach it": "Site injoignable",
    "The site couldn't be reached. Try Read again later.": "Le site était injoignable. Réessayez plus tard avec Relire.",
    "Site error": "Erreur du site",
    "The site had its own error. Try Read again later.": "Le site a eu sa propre erreur. Réessayez plus tard avec Relire.",
    "The site answered with an error: nothing to read.": "Le site a répondu par une erreur : rien à lire.",
    "Too many requests": "Trop de requêtes",
    "The site asked to slow down. Try Read again later.": "Le site a demandé de ralentir. Réessayez plus tard avec Relire.",
    "Not a web page": "Pas une page web",
    "Not a normal web page: no text to read.": "Pas une page web normale : aucun texte à lire.",
    "Too large": "Trop volumineuse",
    "This page is too large to read.": "Cette page est trop volumineuse pour être lue.",
    "Too many redirects": "Trop de redirections",
    "This address redirects too many times, so the app stopped.": "Cette adresse redirige trop de fois : l'application s'est arrêtée.",
    "Leads elsewhere": "Mène ailleurs",
    "Redirects to another website, so it wasn't followed.": "Redirige vers un autre site : elle n'a pas été suivie.",
    "Not opened": "Non ouverte",
    "The app doesn't open this kind of address.": "L'application n'ouvre pas ce type d'adresse.",
    "Couldn't read it": "Lecture impossible",
    "Couldn't read this page. Try Read again later.": "Lecture de cette page impossible. Réessayez plus tard avec Relire.",
    "Not read yet. It's waiting for the next worker run.": "Pas encore lue. Elle attend le prochain passage du programme de lecture.",
    "Reading this page…": "Lecture de cette page…",
    "Needs JavaScript to show its text, so word counts aren't reliable.": "Il faut JavaScript pour afficher son texte : le nombre de mots n'est pas fiable.",
    "Facts from the last good read.": "Faits issus de la dernière lecture réussie.",
    "They have {n} more {what}": "Ils ont {n} {what} de plus",
    "You have {n} more {what}": "Vous avez {n} {what} de plus",
    "Same": "Identique",
    "Same length": "Même longueur",
    "Their title is {n} {what} longer": "Leur titre a {n} {what} de plus",
    "Your title is {n} {what} longer": "Votre titre a {n} {what} de plus",
    "Their description is {n} {what} longer": "Leur description a {n} {what} de plus",
    "Your description is {n} {what} longer": "Votre description a {n} {what} de plus",
    "character": "caractère", "characters": "caractères", "word": "mot", "words": "mots", "image": "image", "images": "images", "table": "tableau", "tables": "tableaux", "list": "liste", "lists": "listes", "video": "vidéo", "videos": "vidéos", "form": "formulaire", "forms": "formulaires", "internal link": "lien interne", "internal links": "liens internes", "outside link": "lien externe", "outside links": "liens externes", "question": "question", "questions": "questions", "heading": "titre", "headings": "titres",
    "Title": "Titre", "Meta description": "Meta description", "H1": "H1", "Words": "Mots", "Characters": "Caractères", "Language": "Langue", "Images": "Images", "Tables": "Tableaux", "Lists": "Listes", "Videos": "Vidéos", "Forms": "Formulaires", "Internal links": "Liens internes", "Outside links": "Liens externes", "Structured data": "Données structurées", "Canonical": "Canonique", "Indexing": "Indexation", "Published": "Publiée le", "Modified": "Modifiée le", "Last read": "Dernière lecture", "Last changed": "Dernier changement", "Questions in headings": "Questions dans les titres", "Hreflang": "Hreflang", "Speed": "Vitesse", "Fact": "Information",
    "No title": "Pas de titre", "No description": "Pas de description", "No H1": "Pas de H1", "H1 headings": "titres H1", "Not reliable": "Pas fiable", "Not stated": "Non indiquée", "Different languages": "Langues différentes", "with no alt text": "sans texte alternatif", "All have alt text": "Toutes ont un texte alternatif", "None found": "Aucune trouvée", "None": "Aucun", "Not set": "Non défini",
    "Only they have: {list}": "Eux seuls ont : {list}",
    "Only you have: {list}": "Vous seul avez : {list}",
    "This page": "Cette page",
    "Points elsewhere": "Pointe ailleurs",
    "noindex": "noindex",
    "Kept out of search": "Exclue des moteurs",
    "Indexable": "Indexable",
    "Not read yet": "Pas encore lue",
    "No change seen": "Aucun changement vu",
    "Needs PageSpeed Insights": "Nécessite PageSpeed Insights",
    "Connect": "Connecter",
    "Not read": "Non lue",
    "Meta": "Meta", "Body": "Texte",
    "The tool can't see AI Overviews. One may still exist.": "L'outil ne voit pas les AI Overviews. Il peut y en avoir un.",
    "Not captured": "Non capté",
    "No AI Overview": "Pas d'AI Overview",
    "Cited": "Citée",
    "Not cited": "Non citée",
    "Keywords in this pair": "Mots-clés de cette paire",
    "Neither page ranks for your keywords.": "Aucune des deux pages ne se classe sur vos mots-clés.",
    "AI Overview": "AI Overview",
    "Keyword": "Mot-clé",
    "Words only they use": "Mots qu'eux seuls utilisent",
    "Words only you use": "Mots que vous seul utilisez",
    "In their headings, nowhere on your page.": "Dans leurs titres, nulle part sur votre page.",
    "In your headings, nowhere on their page.": "Dans vos titres, nulle part sur leur page.",
    "Different languages: comparing words means little.": "Langues différentes : comparer les mots a peu de sens.",
    "Against": "Face à",
    "Notes on my page": "Notes sur ma page",
    "Notes on their page": "Notes sur leur page",
    "1 shared keyword": "1 mot-clé commun",
    "shared keywords": "mots-clés communs",
    "All pairs": "Toutes les paires", "Catch up with": "Rattraper", "with": "avec",
    "My page against {competitor}": "Ma page face à {competitor}",
    "Read again": "Relire",
    "Rankings won't replace it.": "Les classements ne la remplaceront pas.",
    "Waiting to start…": "En attente de démarrage…",
    "Facts only: no verdict on which is better.": "Des faits seulement : aucun avis sur la meilleure.",
    "Both pages reread.": "Les deux pages ont été relues.",
    "Type another address…": "Saisir une autre adresse…",
    "Address": "Adresse",
    "Type an address.": "Saisissez une adresse.",
    "Back to automatic": "Revenir à l'automatique",
    "Hide pair": "Masquer la paire",
    "Once saved, rankings won't replace it.": "Une fois enregistrée, les classements ne la remplaceront pas.",
    "Your page and theirs.": "Votre page et la leur.",
    "Rankings won't replace a pair you add.": "Les classements ne remplaceront pas une paire ajoutée.",
    "Saved. Rankings won't replace it.": "Enregistrée. Les classements ne la remplaceront pas.",
    "Pair added. Rankings won't replace it.": "Paire ajoutée. Les classements ne la remplaceront pas.",
    "Pair hidden": "Paire masquée",
    "Back to automatic. No shared keyword now, so the pair is gone.": "Retour à l'automatique. Plus de mot-clé commun : la paire disparaît.",
    "Back to automatic: rankings pick it again.": "Retour à l'automatique : les classements la choisissent à nouveau.",
    "Not a web address.": "Ce n'est pas une adresse web.",
    "Competitor not found.": "Concurrent introuvable.",
    "That pair doesn't exist.": "Cette paire n'existe pas.",
    "You already compare that page with this competitor. Change that pair instead.": "Vous comparez déjà cette page avec ce concurrent. Modifiez plutôt cette paire.",
  });
})();
