/* Backlinks: does each link count for Google, what Search Console lists, links to reclaim, spam and the disavow file, and a monthly budget.
   mockup.js calls these from the Backlinks screen. On the plain-file sample a few sample links get made-up verdicts so the screen shows them. */
(() => {
  "use strict";
  const COMP = window.COMP;
  let UI = null, H = {};
  const S = { reclaim: new Map(), budgets: new Map(), effects: new Map(), sites: new Map(), gscBusy: false, view: "page", domain: "", siteSort: null, rcSort: null };
  /* The tables' pages and search (table-pages.js), like every long table in the app. "bl-links" is the By page table, drawn by mockup.js. */
  const PAGES = { links: "bl-links", sites: "bl-sites", reclaim: "bl-reclaim" };
  /* Sorting by a heading, as on Competitors → Link gaps: names A to Z, numbers biggest first, a third click goes back to the usual order. */
  const nextSort = (sort, id, first) => (sort?.id !== id ? { id, dir: first } : sort.dir === first ? { id, dir: first === "asc" ? "desc" : "asc" } : null);
  function sortRows(list, sort, getters) {
    if (!sort || !getters[sort.id]) return list;
    // A getter with prepare() first looks at the whole list (the authority sort learns which tool leads).
    const get = getters[sort.id].prepare ? getters[sort.id].prepare(list) : getters[sort.id], dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x === null || x === undefined) return 1; // unknown goes last either way
      if (y === null || y === undefined) return -1;
      const scored = window.BacklinkCleaner.compareScored(x, y, dir);
      if (scored !== null) return scored;
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }
  /* Authority sorts one tool's scores against each other (SEO review 2026-11-17, #7): the tool most links are scored with
     first, then each other tool's on its own scale, then Open PageRank (0–10), never an OPR 8 beside a DA 8. */
  const OPR_GROUP = 1000;
  const scaleKey = (label) => window.BacklinkCleaner.scaleOf(label || "DA");
  function authoritySort(scoreOf) {
    const get = (ranks) => (row) => { const v = scoreOf(row); return !v ? null : v.opr ? [OPR_GROUP, v.value] : [ranks.get(scaleKey(v.label)) ?? OPR_GROUP - 1, v.value]; };
    const sorter = get(new Map());
    sorter.prepare = (list) => get(window.BacklinkCleaner.scaleRanks(list.map(scoreOf).filter((v) => v && !v.opr).map((v) => v.label || "DA")));
    return sorter;
  }
  /* A link's score and whose scale it's on: its file's DA with the tool, else Open PageRank. */
  const linkScore = (b) => (b.auth ? { value: b.auth, label: b.authLabel } : b.opr !== null && b.opr !== undefined ? { value: b.opr, opr: true } : null);
  const authorityOf = authoritySort(linkScore);
  function sortHead(attr, sort, id, label, cls = "", tip = "") {
    const on = sort?.id === id;
    return `<th scope="col" class="${cls}" aria-sort="${on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}" ${tip ? `data-tip="${esc(tip)}"` : ""}><button type="button" class="th-btn" ${attr}="${id}">${t(label)}${on ? UI.icon(sort.dir === "asc" ? "arrow-up" : "arrow-down") : ""}</button></th>`;
  }
  const MANY_OUTBOUND = 100, SPAM_SCORE = 30, CURRENCIES = ["USD", "EUR", "AED", "GBP"];

  /* The verdict in plain words (2026-11-12 critique: "Counts" and "Weak" read as jargon). The same three words name the Useful and
     Not useful filters, so a badge and the filter that finds it agree. */
  const VERDICT = { counts: ["vd-counts", "Useful"], weak: ["vd-weak", "Barely useful"], none: ["vd-none", "Not useful"] };
  const APP_CHECK = "The app's own check of the linking page: is the link followed, and can the page be indexed? Not data from Google.";
  const MOVED_WHY = "The last check found this link pointing at another page of your site, not the target page you logged.";
  const COUNTS_WHY = "The app's check: the link is followed, on a page that can be indexed.";
  const REASONS = {
    noindex: "Page set to noindex.",
    robots_blocked: "Blocked by robots.txt.",
    page_nofollow: "Page-wide nofollow.",
    nofollow: "Marked nofollow.",
    sponsored: "Marked sponsored.",
    ugc: "Marked ugc.",
    canonical_elsewhere: "Main version is another page.",
    many_outbound: "Links to 100+ sites.",
    source_not_indexed: "Linking page not on Google.",
  };
  /* The whole sentence behind each short reason: the (i) beside it in the panel, and the verdict badge's tooltip. */
  const REASON_TIPS = {
    noindex: "The page is set to noindex, so Google drops the page and the link with it.",
    robots_blocked: "The site's robots.txt stops Google from reading the page.",
    page_nofollow: "The page tells Google not to follow any of its links.",
    nofollow: "Marked nofollow: Google takes it as a hint and usually passes no ranking value.",
    sponsored: "Marked sponsored: right for a paid link, but it passes little or no ranking value.",
    ugc: "Marked ugc (user content): it passes little or no ranking value.",
    canonical_elsewhere: "The page names another page as its main version, so Google may count that one instead.",
    many_outbound: "The page links to more than 100 other sites, which looks like a link list.",
    source_not_indexed: "Google doesn't have the linking page: two site: searches in a row didn't find it. A page Google doesn't have passes nothing.",
  };
  const reasonTip = (r) => (REASON_TIPS[r] ? UI.tip(REASON_TIPS[r]) : "");
  const UNKNOWN_WHY = "Google doesn't know this page yet, so the link can't help it rank.";
  /* Search Console and site: search dates come as 2026-10-28; they read as the app's other dates do. */
  const day = (v) => (/^\d{4}-\d{2}-\d{2}/.test(v || "") && UI.fmtDateOnly ? UI.fmtDateOnly(String(v).slice(0, 10)) : v);
  const ANCHORS = {
    brand: ["Brand", "Your brand or domain. The safest anchor."],
    /* An exact-match domain (creer-societe-dubai.fr): its name is a tracked keyword, so the anchor is a money anchor too (links F8). */
    brand_kw: ["Brand + keyword", "Your domain name holds a tracked keyword, so this anchor is also an exact-match keyword. Count it with Exact keyword."],
    url: ["Bare URL", "The address, like www.example.com. Safe and natural."],
    exact: ["Exact keyword", "Exactly one tracked keyword. Helps most; too many look bought."],
    partial: ["Partial keyword", "A tracked keyword among other words."],
    generic: ["Generic", "Words like click here or read more. Natural, but tell Google little."],
    other: ["Other", "None of the above."],
  };
  const t = (w) => UI.t(w), esc = (v) => UI.esc(v);
  const siteIdOf = (host) => (H.sites?.() || []).find((s) => s.host === host)?.id ?? null;
  const pickedHost = () => UI.siteHostPicked?.() || null;

  // ---- in the table ---------------------------------------------------------------------------------
  function reasonsText(list) {
    return (list || []).map((r) => t(REASON_TIPS[r] || REASONS[r] || r)).join(" ");
  }

  /* Beside the status: the verdict, then what Google's own list says. Only for a link that was read or that Search Console listed. */
  function badge(b) {
    const parts = [];
    const c = b.check;
    if (c?.verdict && b.status === "live") {
      const [cls, word] = VERDICT[c.verdict];
      const tip = c.verdict === "counts" ? t(COUNTS_WHY) : reasonsText(c.reasons);
      parts.push(`<span class="tag vd-tag ${cls}" data-tip="${esc(tip)}" tabindex="0">${t(word)}</span>`);
    }
    if (movedTarget(b)) parts.push(`<span class="tag vd-tag vd-weak" data-tip="${esc(t(MOVED_WHY))}" tabindex="0">${t("Points elsewhere")}</span>`);
    if (b.status === "live" && b.sourceIndex?.state === "not_indexed") parts.push(`<span class="tag vd-tag vd-none" data-tip="${esc(t(REASON_TIPS.source_not_indexed))}" tabindex="0">${t("Linking page not indexed")}</span>`);
    const ix = b.status === "live" ? b.targetIndex : null;
    if (ix && (ix.state === "not_indexed" || ix.state === "unknown")) parts.push(`<span class="tag vd-tag vd-weak" data-tip="${esc(ix.state === "unknown" ? `${t(UNKNOWN_WHY)} ${indexWhy(ix)}` : indexWhy(ix))}" tabindex="0">${t("Your page isn't indexed")}</span>`);
    const g = b.gsc || {};
    // What Search Console's list says: its logo and one word, the whole sentence in the tooltip.
    const listed = (cls, tip, word) => `<span class="tag vd-tag${cls}" data-tip="${esc(tip)}" tabindex="0">${UI.logoOnly("Search Console", tip)} ${t(word)}</span>`;
    if (g.seen === "page") parts.push(listed(" vd-google", `${t("Google sees it: Search Console lists this page among your links.")}${g.crawled ? ` · ${t("crawled")} ${day(g.crawled)}` : ""}`, "Listed"));
    else if (g.seen === "site") parts.push(listed(" vd-google", t("Google sees the site: Search Console lists the site, not this page."), "Site listed"));
    else if (g.not_listed) parts.push(listed("", `${t("Not listed by Google yet.")} ${t("Placed 60+ days before your last Search Console upload, yet missing from it. Its list is a sample: only a hint.")}`, "Not listed"));
    if (b.disavow) parts.push(`<span class="tag vd-tag vd-none" data-tip="${esc(t("In the disavow file."))}" tabindex="0">${t("Spam")}</span>`);
    return parts.length ? `<span class="vd-row">${parts.join("")}</span>` : "";
  }

  /* The Live card's second line: how many live links pass value, once any has been read. */
  function liveNote(links) {
    const read = links.filter((b) => b.status === "live" && b.check?.verdict);
    if (!read.length) return "";
    const counts = read.filter((b) => b.check.verdict === "counts").length;
    return `<span class="ab" data-tip="${esc(t(COUNTS_WHY))}">${UI.num(counts)} ${t("useful")}</span>`;
  }

  /* Authority: the file's DA with its tool's name, or else Open PageRank with its name, because two tools' scores don't compare. */
  function scoreCell(v) {
    if (!v) return "—";
    if (v.opr) return `<span data-tip="${esc(t("Open PageRank, 0–10, not the DA scale."))}" tabindex="0">${UI.dec(v.value)} <span class="tag">OPR</span></span>`;
    const label = v.label || "", tool = label.match(/\(([^)]+)\)/)?.[1] || label || "DA";
    const mark = window.BRANDS?.FILES?.[tool] && UI.logoOnly ? UI.logoOnly(tool, label) : `<span class="tag" data-tip="${esc(label || t("Domain authority from your file"))}" tabindex="0">${esc(tool)}</span>`;
    return `<span class="nowrap">${UI.dec(v.value)} ${mark}</span>`;
  }
  const authorityCell = (b) => scoreCell(linkScore(b));

  const looksSpammy = (b) => (b.check?.outbound_links || 0) > MANY_OUTBOUND || (b.spam !== null && b.spam !== undefined && b.spam >= SPAM_SCORE);

  // ---- on a link's panel -----------------------------------------------------------------------------
  /* The panel reads in seconds: one verdict on top, then one short question per row with its answer on the right.
     The proof behind an answer opens under its row. A row opens by itself only when it holds something to do. */
  const tagOf = (cls, word) => `<span class="tag vd-tag ${cls}">${t(word)}</span>`;
  const quiet = (word) => `<span class="muted">${t(word)}</span>`;
  const indexBad = (ix) => ix?.state === "not_indexed" || ix?.state === "unknown";

  /* [tone, headline, one sentence or nothing, its (i) or nothing]: is this link doing its job, and if not, the one reason that matters most. */
  function answerOf(b) {
    const c = b.check || {}, firstReason = c.reasons?.[0] ? t(REASONS[c.reasons[0]] || c.reasons[0]) : "", firstTip = c.reasons?.[0] ? reasonTip(c.reasons[0]) : "";
    if (b.disavow) return ["bad", t("Marked as spam"), t("In the disavow file.")];
    if (b.status === "planned") return ["idle", t("Not placed yet"), ""];
    if (b.status === "lost") return ["bad", t("Link lost"), t(c.outcome === "page_gone" ? "Page gone." : "Link gone from the page.")];
    if (c.target_http === 404 || c.target_http === 410) return ["bad", t("Your page is gone"), t("Answers {n}: redirect it to a live page.").replace("{n}", c.target_http), UI.tip("Your target page answers {n}, so this link is wasted until the page redirects to a live one.", { n: c.target_http })];
    if (c.misses > 0) return ["warn", t("Missing on last check"), t("Rechecked tomorrow before it counts as lost.")];
    if (movedTarget(b)) return ["warn", t("Points elsewhere"), t(MOVED_WHY)];
    // The badge's own words, so one verdict has one name (SEO review 2026-11-17, #12). It's the app's check, never Google's word.
    if (c.verdict === "none") return ["bad", t(VERDICT.none[1]), firstReason, firstTip];
    if (b.sourceIndex?.state === "not_indexed") return ["bad", t("Linking page not indexed"), t("Ask the site to get it indexed."), UI.tip("Ask the website to get it indexed, or the link passes nothing.")];
    if (indexBad(b.targetIndex)) return ["warn", t("Your page isn't indexed"), ""]; // its row opens below with the why and a task
    if (c.verdict === "weak") return ["warn", t(VERDICT.weak[1]), firstReason, firstTip];
    if (c.verdict === "counts") return ["good", t(VERDICT.counts[1]), t("Live, and it passes value."), UI.tip(APP_CHECK)];
    if (c.outcome === "unknown" && c.reason === "home_page") return ["warn", t("Article address needed"), t("Only the website's address is saved. Paste the article's address.")];
    if (c.outcome === "unknown") return ["idle", t("Couldn't check it"), t("An unreadable page never counts as a lost link.")];
    return ["idle", t("Not checked"), ""];
  }

  function answerInner(b) {
    const [tone, word, why, more = ""] = answerOf(b);
    const mark = { good: "circle-check", warn: "triangle-alert", bad: "octagon-alert", idle: "info" }[tone];
    return `<div class="vd-answer ${tone}">${UI.icon(mark)}<div><strong>${esc(word)}</strong>${why ? `<p>${esc(why)}${more}</p>` : ""}</div></div>`;
  }

  const qRow = (key, label, value, body, open = false) => `<details class="fold vd-q" data-vd-row="${key}" ${open ? "open" : ""}><summary>${UI.icon("chevron-right")}<span class="vd-q-label">${label}</span><span class="vd-q-value">${value}</span></summary><div class="vd-q-body">${body}</div></details>`;
  const googleValue = (b) => (b.check?.verdict ? tagOf(VERDICT[b.check.verdict][0], VERDICT[b.check.verdict][1]) : quiet("Not checked"));
  function indexValue(b) {
    const ix = b.targetIndex;
    if (!ix) return quiet("Not checked");
    if (ix.state === "indexed") return tagOf("vd-counts", "Indexed");
    if (ix.state === "error") return quiet("Couldn't check");
    return tagOf("vd-none", ix.state === "unknown" ? "Unknown to Google" : "Not indexed");
  }

  /* The whole panel body. mockup.js hands over the parts it owns: the link check, the traffic and the details table. */
  function panelBlocks(b, { server, linkStatus, check, traffic, trafficValue, sampleEffect, details, anchor }) {
    S.linkStatus = linkStatus;
    const id = b.serverId, google = googleBody(b, server), index = indexBody(b, server), spammy = looksSpammy(b) || b.disavow, spam = spamBody(b, server);
    let html = `<div id="vd-answer" data-id="${id ?? ""}">${answerInner(b)}</div>`;
    html += qRow("link", t("Link on the page?"), linkStatus(b.status), check, b.status === "live" && !b.check?.checked_at);
    // The app's own reading of the page, so no Google logo and no Google name on it (#12). URL Inspection below is Google's.
    if (google) html += qRow("google", `${t("Does it pass value?")}${UI.tip(APP_CHECK)}`, googleValue(b), google);
    if (index) html += qRow("index", t("Your page in Google?"), indexValue(b), index, indexBad(b.targetIndex));
    if (server && id) {
      html += `<div id="vd-effect" data-id="${id}">${effectInner(id)}</div>`;
      if (!S.effects.has(id)) loadEffect(id);
    } else if (sampleEffect) html += qRow("effect", t("Before and after"), sampleEffect.value, sampleEffect.body);
    html += qRow("traffic", t("Traffic from this link"), trafficValue, traffic);
    if (spammy && spam) html += qRow("spam", t("Spam"), tagOf("vd-none", b.disavow ? "Marked as spam" : "Likely spam"), spam);
    html += qRow("details", t("Details"), anchor ? `<span class="muted" dir="auto">${esc(anchor)}</span>` : "", details + (spammy ? "" : spam));
    return html;
  }

  /* After Refresh: the verdict and the answers on the right change, and any row the person opened stays open. */
  function repaint(b) {
    const box = UI.$(`#vd-answer[data-id="${b.serverId}"]`);
    if (!box) return;
    UI.setHTML(box, answerInner(b));
    const fill = (key, value, body) => {
      const row = UI.$(`[data-vd-row="${key}"]`);
      if (!row) return;
      UI.setHTML(row.querySelector(".vd-q-value"), value);
      if (body !== undefined) UI.setHTML(row.querySelector(".vd-q-body"), body);
    };
    if (S.linkStatus) fill("link", S.linkStatus(b.status));
    fill("google", googleValue(b), googleBody(b, true));
    fill("index", indexValue(b), indexBody(b, true));
  }

  function googleBody(b, server) {
    const c = b.check || {};
    let html = "";
    if (c.verdict) {
      const reasons = (c.reasons || []).map((r) => `<li>${esc(t(REASONS[r] || r))}${reasonTip(r)}</li>`).join("");
      html += c.verdict === "counts" ? `<p class="lk-result">${t(COUNTS_WHY)}</p>` : reasons ? `<ul class="vd-reasons">${reasons}</ul>` : "";
      const lang = (v) => (v || "").slice(0, 2);
      if (lang(c.page_lang) && lang(c.target_lang) && lang(c.page_lang) !== lang(c.target_lang)) {
        html += `<p class="note">${UI.icon("info")}<span>${t("Linking page in {a}, yours in {b}.").replace("{a}", esc(lang(c.page_lang).toUpperCase())).replace("{b}", esc(lang(c.target_lang).toUpperCase()))}${UI.tip("Links from pages in the same language and on the same topic usually help more.")}</span></p>`;
      }
    }
    html += sourceLine(b, server);
    // Said once: the answer box on top already says it when it's the link's main problem.
    if ((c.target_http === 404 || c.target_http === 410) && answerOf(b)[1] !== t("Your page is gone")) {
      html += `<p class="note warn">${UI.icon("triangle-alert")}<span>${t("Answers {n}: redirect it to a live page.").replace("{n}", c.target_http)}${UI.tip("Your target page answers {n}, so this link is wasted until the page redirects to a live one.", { n: c.target_http })}</span></p>`;
    }
    const g = b.gsc || {};
    if (g.seen || g.not_listed) html += `<p class="small sec">${UI.icon("search")} ${g.seen === "page" ? t("Search Console lists this page") : g.seen === "site" ? t("Search Console lists the site, not this page.") : t("Not in your last Search Console upload.")}${g.crawled ? ` · ${t("crawled")} ${esc(day(g.crawled))}` : ""}</p>`;
    return html;
  }

  // ---- is the linking page on Google: free signals, then a site: search ----------------------------------------
  function sourceLine(b, server) {
    if (b.status !== "live") return "";
    const si = b.sourceIndex, facts = S.sites.get(b.site) || {};
    const via = si?.via === "Search Console" ? t("Search Console lists the link") : si?.via ? t("a site: search on {tool}").replace("{tool}", esc(si.via)) : "";
    const when = si?.at ? ` · ${esc(day(si.at))}` : "";
    if (!si) {
      if (!server) return "";
      return `<p class="small sec">${UI.icon("search")} ${facts.site_search ? t("The next check looks for the linking page on Google.") : t("Connect a search tool, such as SerpApi, to see if Google has the linking page. Free searches only.")}</p>`;
    }
    if (si.state === "indexed") return `<p class="small sec">${UI.icon("circle-check")} ${t("Linking page on Google")}: ${via}${when}</p>`;
    if (si.state === "not_found") return `<p class="small sec">${UI.icon("search")} ${t("Not found on Google yet; searched again in a few days.")}${UI.tip("A site: search didn't show the linking page. Search results are incomplete, so only a second miss marks it not indexed.")}${when}</p>`;
    if (si.state === "not_indexed") return `<p class="note warn">${UI.icon("triangle-alert")}<span>${t("Ask the site to get it indexed.")}${UI.tip("Google doesn't have the linking page: two site: searches in a row didn't find it. Until it's indexed, the link passes nothing.")}${when}</span></p>`;
    return ""; // not_indexable: the reasons above already say why
  }

  // ---- filters, By website, anchor types and site traffic, in the Done table ------------------------------------
  const domainOf = (b) => b.domain || window.BacklinkCleaner?.rootDomain?.(b.src) || "";
  const isUseful = (b) => b.status === "live" && b.check?.verdict === "counts";
  const isUseless = (b) => b.status === "live" && (b.check?.verdict === "weak" || b.check?.verdict === "none");
  const notIndexed = (b) => b.status === "live" && ["not_indexed", "not_indexable"].includes(b.sourceIndex?.state);
  const sendsVisits = (b) => (b.visits || 0) > 0;
  /* A link the last check found pointing at another page of my site than the one logged (links F3): agencies move paid links. */
  const movedTarget = (b) => b.status === "live" && b.check?.to_target === false && Boolean(b.target);
  const FILTERS = { useful: isUseful, visits: sendsVisits, noindex: notIndexed, useless: isUseless, lost: (b) => b.status === "lost", moved: movedTarget };

  function filterRows(list, filter) {
    const mine = S.domain ? list.filter((b) => domainOf(b) === S.domain) : list;
    return FILTERS[filter] ? mine.filter(FILTERS[filter]) : mine;
  }

  /* The answers a person asks of their links, Lost first. A chip shows once it has something, or while it's picked. Lost is one of
     them, not a status filter of its own beside the section tabs (critique 2026-11-12): mockup.js's older "2 lost" chip is taken
     out after each draw (dropDuplicateLost). */
  function filterChips(list, picked) {
    const chip = (key, word, tip) => {
      const n = list.filter(FILTERS[key]).length;
      return n || picked === key ? `<button class="chip vd-chip" data-bl-filter="${key}" aria-pressed="${picked === key}" data-tip="${esc(t(tip))}">${t(word)}<b>${UI.num(n)}</b></button>` : "";
    };
    const site = S.domain ? `<button class="chip" data-vd-domain="" aria-pressed="true">${t("Site")}: <span class="mono" dir="auto">${esc(S.domain)}</span> ${UI.icon("x")}</button>` : "";
    return site + chip("lost", "Lost", "Gone from the page, or the page is gone") + chip("moved", "Points elsewhere", MOVED_WHY) + chip("useful", "Useful", COUNTS_WHY) + chip("visits", "Sends visits", "At least one visit")
      + chip("noindex", "Linking page not indexed", "Linking page not in Google, or not indexable") + chip("useless", "Not useful", "Barely or not useful: nofollow, sponsored, or on a page that passes nothing");
  }

  const byWebsite = () => S.view === "website";
  function viewSwitch() {
    const one = (key, word) => `<button class="tab" role="tab" data-vd-view="${key}" aria-selected="${S.view === key}">${t(word)}</button>`;
    return `<span class="tabs vd-view" role="tablist" aria-label="${esc(t("Show"))}">${one("page", "By page")}${one("website", "By site")}</span>`;
  }

  const ahrefsOn = () => [...S.sites.values()].some((f) => f.ahrefs);
  const trafficHead = () => (ahrefsOn() ? `<th scope="col" class="r" data-tip="${esc(t("Ahrefs estimate: the linking site's monthly Google visits"))}">${t("Site traffic")}</th>` : "");
  const trafficValue = (v) => (v === null || v === undefined ? '<span class="muted">—</span>' : UI.num(v));
  const trafficCell = (b) => (ahrefsOn() ? `<td class="r tabular" data-label="${t("Site traffic")}">${trafficValue(b.siteTraffic)}</td>` : "");

  /* A type set by hand says so in its tip. One worked out from the anchor text doesn't. */
  function anchorTag(b) {
    const a = ANCHORS[b.anchorType];
    if (!a) return "";
    const tip = b.anchorKind ? `${t(a[1])} ${t("Set by hand.")}` : t(a[1]);
    return `<span class="tag vd-anchor" data-tip="${esc(tip)}" tabindex="0">${t(a[0])}</span>`;
  }
  const anchorWord = (b) => (ANCHORS[b.anchorType] ? `${t(ANCHORS[b.anchorType][0])}${b.anchorKind ? ` · ${t("set by hand")}` : ""}` : "");
  /* The form's choices. Automatic means the app works it out from the anchor text and your keywords. */
  const anchorOptions = (picked) => [["", "Automatic"], ...Object.entries(ANCHORS).map(([key, [word]]) => [key, word])]
    .map(([key, word]) => `<option value="${key}" ${(picked || "") === key ? "selected" : ""}>${esc(t(word))}</option>`).join("");

  /* Visits and leads of a list of links, each shared number counted once (F10). Several links from one website to one page,
     or with the same UTM, can't be told apart, so each row carries the group's whole number: three links sharing 40 visits
     are 40, not 120. The server names the group; without it, the same website and target page with a "shared" mark is one. */
  const groupOf = (b) => b.group || b.trafficGroup || b.traffic_group || (b.shared ? `${domainOf(b)}|${b.target || ""}` : `id:${b.serverId ?? b.id}`);
  function trafficTotals(rows) {
    const seen = new Set();
    let visits = 0, leads = 0, known = false;
    rows.forEach((b) => {
      if (b.visits === null || b.visits === undefined) return;
      known = true;
      const g = groupOf(b);
      if (seen.has(g)) return;
      seen.add(g);
      visits += b.visits || 0; leads += b.leads || 0;
    });
    return { visits, leads, known };
  }

  /* One row per linking website: how many links, the best of them, and what the website is worth. */
  function websiteTable(rows) {
    const groups = new Map();
    rows.forEach((b) => { const d = domainOf(b); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(b); });
    const ranks = window.BacklinkCleaner.scaleRanks(rows.map(linkScore).filter((v) => v && !v.opr).map((v) => v.label || "DA"));
    const groupOfScore = (v) => (v.opr ? OPR_GROUP : ranks.get(scaleKey(v.label)) ?? OPR_GROUP - 1);
    const compareScore = (x, y) => groupOfScore(x) - groupOfScore(y) || y.value - x.value;
    const rank = { counts: 3, weak: 2, none: 1 };
    const list = [...groups].map(([domain, links]) => {
      const best = links.filter((b) => b.status === "live" && b.check?.verdict).sort((x, y) => rank[y.check.verdict] - rank[x.check.verdict])[0];
      // The site's best score on the leading tool's scale, never the biggest number of any tool (#7).
      const score = links.map(linkScore).filter(Boolean).sort((x, y) => compareScore(x, y))[0] || null;
      const sum = trafficTotals(links), visits = sum.known ? sum.visits : null;
      return { domain, links, best, score, visits, traffic: links.find((b) => b.siteTraffic !== null && b.siteTraffic !== undefined)?.siteTraffic ?? null, live: links.filter((b) => b.status === "live").length };
    }).sort((x, y) => (x.score && y.score ? compareScore(x.score, y.score) : (y.score ? 1 : 0) - (x.score ? 1 : 0)) || (y.links.length - x.links.length) || x.domain.localeCompare(y.domain));
    // Each empty state says what to do, with one button that does it (critique 2026-11-12).
    const clearSearch = (key) => `<button type="button" class="btn btn-small" data-tp-key="${esc(key)}" data-tp-clear>${UI.icon("x")}${t("Clear search")}</button>`;
    if (!list.length) return COMP.empty(t("No links match"), t("Pick another filter."), `<button type="button" class="btn btn-small" data-bl-filter="all">${t("Show all links")}</button>`);
    const found = list.filter((g) => TP.matches(PAGES.sites, g.domain));
    if (!found.length) return COMP.empty(t("No site matches"), t("Change the search."), clearSearch(PAGES.sites));
    const shown = sortRows(found, S.siteSort, { domain: (g) => g.domain, links: (g) => g.links.length, authority: authoritySort((g) => g.score), traffic: (g) => g.traffic, visits: (g) => g.visits });
    const page = TP.view(PAGES.sites, shown);
    const head = (id, label, cls, tip) => sortHead("data-bls-sort", S.siteSort, id, label, cls, tip);
    return `<div class="bl-list"><div class="table-wrap"><table class="data" id="bl-sites"><thead><tr>${head("domain", "Site")}${head("links", "Links", "r")}<th scope="col" data-tip="${esc(t("Its best link, per the last check"))}">${t("Best link")}</th>${head("authority", "Authority", "r")}${ahrefsOn() ? head("traffic", "Site traffic", "r", t("Ahrefs estimate: the linking site's monthly Google visits")) : ""}${head("visits", "Visits", "r")}</tr></thead><tbody>
      ${page.rows.map((g) => {
        const tag = g.best ? `<span class="tag vd-tag ${VERDICT[g.best.check.verdict][0]}">${t(VERDICT[g.best.check.verdict][1])}</span>` : '<span class="muted">—</span>';
        const authority = g.score ? scoreCell(g.score) : '<span class="muted">—</span>';
        return `<tr><td class="head-cell"><span class="with-logo">${UI.siteLogo ? UI.siteLogo(g.domain) : ""}<span class="logo-text"><button class="kw mono small" data-vd-domain="${esc(g.domain)}" style="text-align:start" data-tip="${esc(t("Show its links"))}"><span dir="auto">${esc(g.domain)}</span></button><span class="second">${g.live} ${t("live")}</span></span></span></td>
          <td class="r tabular" data-label="${t("Links")}">${UI.num(g.links.length)}</td><td data-label="${t("Best link")}">${tag}</td><td class="r" data-label="${t("Authority")}">${authority}</td>
          ${ahrefsOn() ? `<td class="r tabular" data-label="${t("Site traffic")}">${trafficValue(g.traffic)}</td>` : ""}<td class="r tabular" data-label="${t("Visits")}">${g.visits === null ? '<span class="muted">—</span>' : UI.num(g.visits)}</td></tr>`;
      }).join("")}</tbody></table></div>
      ${TP.footer(PAGES.sites, page, { noun: t("sites") })}</div>`;
  }

  /* The search box of the view on show, for the line above the table: links by page, or linking sites. */
  const searchBox = () => (byWebsite() ? TP.search(PAGES.sites, t("Search sites")) : TP.search(PAGES.links, t("Search links")));
  /* Back to the first page, the usual order and no search: another site was picked in the side menu. */
  function resetPages() {
    Object.values(PAGES).forEach((key) => { TP.state(key).q = ""; TP.reset(key); });
    S.siteSort = null; S.rcSort = null;
  }

  // ---- is my page indexed: Search Console's URL Inspection, about my own target page ------------------------
  const pathOf = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url || ""; } };

  function indexWhy(ix) {
    if (ix.state === "unknown") return t("Add it to your sitemap or request indexing in Search Console.");
    return `${t("The link can't help it rank yet.")}${ix.coverage ? ` ${t("Google says:")} “${ix.coverage}”` : ""}`;
  }

  function indexBody(b, server) {
    if (b.status !== "live") return "";
    const ix = b.targetIndex, facts = S.sites.get(b.site) || {};
    if (!ix) {
      if (!server) return "";
      if (!facts.index_check) return `<p class="small sec">${t("Connect Search Console to check if your page is indexed.")} <a href="#settings">${t("Data sources")}</a></p>`;
      return `<p class="small sec">${t("Asked at the next check, or press Check.")}</p>`;
    }
    const page = pathOf(ix.url);
    const from = `<p class="small muted vd-from">${t("From Search Console's URL Inspection")}${ix.checked ? `, ${esc(day(ix.checked))}` : ""}.</p>`;
    if (ix.state === "error") return `<p class="small sec">${UI.icon("triangle-alert")} ${esc(t(ix.error))}</p>${from}`;
    if (ix.state === "indexed") {
      return `<p class="lk-result">${PageLink.html(ix.url, { text: page, cls: "mono small" })}${ix.crawled ? ` · ${t("crawled")} ${esc(day(ix.crawled))}` : ""}</p>${from}`;
    }
    const canonical = ix.google_canonical ? `<p class="small sec">${t("Google's main version:")} ${PageLink.html(ix.google_canonical, { text: pathOf(ix.google_canonical), cls: "mono" })}</p>` : "";
    const task = UI.taskButton ? UI.taskButton({ title: `${t("Get indexed:")} ${page}`, host: b.site, source: { type: "backlink", label: page, host: b.site, facts: [ix.coverage || t("Not indexed")], link: "#backlinks", key: `index|${b.site}|${page}` } }, { label: "Task" }) : "";
    return `<p class="lk-result">${PageLink.html(ix.url, { text: page, cls: "mono small" })}</p>
      <p class="note warn">${UI.icon("triangle-alert")}<span>${esc(indexWhy(ix))}${ix.state === "unknown" ? UI.tip(UNKNOWN_WHY) : ""}</span></p>${canonical}<div style="margin:6px 0">${task}</div>${from}`;
  }

  /* Below the link check: the one thing a person decides about a bad link. */
  function spamBody(b, server) {
    if (!server || !b.serverId) return "";
    return `<p class="small sec vd-spam">${looksSpammy(b) ? `${t("Many outbound links or a high spam score.")} ` : ""}${t("It goes in the disavow file.")}${UI.tip("Mark a link you can't get removed and that could look paid or spammy.")}</p>
      <button class="btn btn-small" data-vd-disavow="${b.serverId}" data-on="${b.disavow ? "1" : ""}">${UI.icon(b.disavow ? "check" : "ban")}${t(b.disavow ? "Not spam" : "Mark as spam")}</button>`;
  }

  async function loadEffect(id) {
    S.effects.set(id, { loading: true });
    try { S.effects.set(id, await COMP.api("GET", `backlinks/${id}/before-after`)); } catch { S.effects.set(id, { state: "error" }); }
    const box = UI.$(`#vd-effect[data-id="${id}"]`);
    if (box) UI.setHTML(box, effectInner(id));
  }

  function effectInner(id) {
    const e = S.effects.get(id);
    if (!e || e.loading) return "";
    const label = t("Before and after");
    if (e.state === "waiting") return qRow("effect", label, quiet("Not ready yet"), `<p class="small sec">${t("Waiting for Search Console data.")}${UI.tip("The days after the link aren't all in Search Console yet, so there's nothing fair to compare.")} ${t("Ready on")} ${esc(UI.fmtDateOnly ? UI.fmtDateOnly(e.ready_on) : e.ready_on)}.</p>`); // F11
    if (e.state !== "ok") return e.state === "no_date" ? qRow("effect", label, '<span class="muted">—</span>', `<p class="small sec">${t(e.note)}</p>`) : "";
    const pct = (v) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${UI.num(v)}%`);
    const unit = UI.state.lang === "fr" ? "j" : "d";
    const line = (word, value) => `<tr><td class="sec">${t(word)}</td><td class="tabular">${value}</td></tr>`;
    return qRow("effect", label, `<span class="tabular">${UI.num(e.before.clicks)} → ${UI.num(e.after.clicks)}</span> ${t("clicks")}`, `<p class="small sec">${t("Target page clicks")} · ${e.days} ${unit} ${t("before")} / ${t("after")}</p>
      <table class="mini"><tbody>${line("This page", pct(e.page_change))}${line("Whole site", pct(e.site_change))}${e.after.position ? line("Position", `${UI.dec(e.before.position ?? "—")} → ${UI.dec(e.after.position)}`) : ""}</tbody></table>
      <p class="small muted vd-from">${t("From Search Console. Timing, not proof of cause.")}</p>`);
  }

  async function toggleDisavow(button) {
    const id = Number(button.dataset.vdDisavow), on = !button.dataset.on;
    button.disabled = true;
    try { await COMP.api("POST", `backlinks/${id}/disavow`, { disavow: on }); } catch (err) { UI.toast(t(err.message), { kind: "crit" }); button.disabled = false; return; }
    [...(window.BACKLINKS || []), ...(window.FOUND_LINKS || [])].forEach((b) => { if (b.serverId === id) b.disavow = on; });
    UI.toast(t(on ? "Marked as spam" : "Spam mark removed"), { kind: "info" });
    UI.closePanel?.({ keep: false });
    UI.render();
  }

  // ---- Links you didn't add (found by Search Console or another tool, never logged) ------------------------------------------------------------------------
  function foundTools(siteHost) {
    const server = H.server?.();
    const marked = [...(window.BACKLINKS || []), ...(window.FOUND_LINKS || [])].filter((b) => b.disavow && (!siteHost || b.site === siteHost)).length;
    const id = siteIdOf(siteHost);
    const disavow = server && marked
      ? (id ? `<a class="btn btn-small" href="api/backlinks/disavow.txt?site_id=${id}" download data-tip="${esc(t("Google: most sites never need one. Upload it in Search Console only for spam links you can't get removed."))}">${UI.icon("download")}${t("Disavow file")} <span class="muted">${UI.num(marked)}</span></a>` : `<span class="small sec">${t("Pick a site to download its disavow file.")}</span>`)
      : "";
    return `<button class="btn btn-small" id="gsc-open">${UI.icon("search")}${t("Import from Search Console")}</button>${disavow}`;
  }

  function foundButton(f) {
    if (!H.server?.() || !f.serverId) return "";
    return ` <button class="icon-btn" style="width:28px;height:28px;vertical-align:middle" data-vd-disavow="${f.serverId}" data-on="${f.disavow ? "1" : ""}" aria-label="${esc(t(f.disavow ? "Not spam" : "Mark as spam"))}" data-tip="${esc(t(f.disavow ? "Not spam" : "Mark as spam"))}">${UI.icon(f.disavow ? "check" : "ban")}</button>`;
  }

  /* The source repeats on every imported row (usually Search Console): its logo, the name in the tooltip. One with no logo stays as words. */
  function foundSeen(f) {
    const by = window.BRANDS?.FILES?.[f.seen] && UI.logoOnly ? UI.logoOnly(f.seen) : esc(f.seen);
    return `${by}${f.crawled ? ` <span class="second">${t("crawled")} ${esc(day(f.crawled))}</span>` : ` <span class="second">${t("first seen")} ${esc(day(f.first))}</span>`}`;
  }

  // ---- Search Console upload ---------------------------------------------------------------------------
  function openGsc(opener) {
    const sites = H.server?.() ? H.sites() : (window.SITES || []).map((s) => ({ id: s.id, host: s.host }));
    const host = pickedHost();
    const dlg = UI.$("#dlg");
    dlg.classList.remove("wide");
    UI.setHTML(dlg, `<div class="dlg-head"><h2 id="dlg-title">${t("Import from Search Console")}</h2><button class="icon-btn" data-close-dlg aria-label="${t("Close")}">${UI.icon("x")}</button></div>
      <div class="dlg-body">
        <p class="note">${UI.icon("info")}<span>${t("Download from Search Console, then upload here. About a minute per site.")}${UI.tip("Search Console doesn't share its links with other apps, so download them once and upload the file here.")}</span></p>
        <ol class="gsc-steps">
          <li>${t("In Search Console, open Links (left menu).")}</li>
          <li>${t("Export external links (top right) → Latest links → Download CSV.")}</li>
          <li>${t("Upload it below. Top linking sites or Top linked pages work too.")}</li>
        </ol>
        <label class="field"><span>${t("Our site")}</span><select class="select" id="gsc-site" style="width:100%">${sites.map((s) => `<option value="${esc(s.id)}" ${s.host === host ? "selected" : ""}>${esc(s.host)}</option>`).join("")}</select></label>
        <label class="field"><span>${t("File")}</span><input class="input" type="file" id="gsc-file" accept=".csv,.zip,text/csv,application/zip"></label>
        <div id="gsc-result" role="status"></div>
      </div>
      <div class="dlg-foot"><button class="btn btn-main" id="gsc-send">${UI.icon("list-plus")}${t("Upload")}</button><button class="btn" data-close-dlg>${t("Cancel")}</button></div>`);
    if (!dlg.open) dlg.showModal();
    UI.$("#gsc-file")?.focus();
    S.opener = opener;
  }

  async function sendGsc(button) {
    const file = UI.$("#gsc-file")?.files?.[0], box = UI.$("#gsc-result");
    if (!file) { UI.setHTML(box, `<div class="error" role="alert">${UI.icon("octagon-alert")}<span>${t("Choose the file Search Console downloaded.")}</span></div>`); return; }
    if (!H.server?.()) { UI.setHTML(box, `<p class="note">${UI.icon("info")}<span>${t("Needs the running app")}</span></p>`); return; }
    const form = new FormData();
    form.append("file", file);
    form.append("site_id", UI.$("#gsc-site").value);
    button.disabled = true;
    UI.setHTML(button, `${UI.icon("refresh-cw", "spin")}${t("Uploading…")}`);
    try {
      const a = await COMP.api("POST", "backlinks/gsc-import", undefined, { form });
      const lines = [];
      if (a.kinds.includes("latest")) lines.push(`${UI.num(a.added)} ${t("new links you didn't add")}`, `${UI.num(a.seen)} ${t("logged links Google sees")}`);
      if (a.kinds.includes("sites")) lines.push(`${UI.num(a.domains)} ${t("linking sites")}`);
      if (a.kinds.includes("pages")) lines.push(`${UI.num(a.pages)} ${t("of your pages have links; each is read monthly for Reclaim.")}`);
      if (a.skipped) lines.push(`${UI.num(a.skipped)} ${t("rows skipped: own pages or duplicates")}`);
      UI.setHTML(box, `<div class="note good">${UI.icon("circle-check")}<span>${lines.map(esc).join("<br>")}</span></div>`);
      S.reclaim.clear();
      await H.reload?.();
    } catch (err) {
      UI.setHTML(box, `<div class="error" role="alert">${UI.icon("octagon-alert")}<span>${esc(t(err.message))}</span></div>`);
    }
    button.disabled = false;
    UI.setHTML(button, `${UI.icon("list-plus")}${t("Upload another")}`);
  }

  // ---- Reclaim -------------------------------------------------------------------------------------------
  function reclaimFor(host) {
    const id = siteIdOf(host);
    if (!id) return [];
    const got = S.reclaim.get(id);
    if (got === undefined) {
      S.reclaim.set(id, null);
      COMP.api("GET", `backlinks/reclaim?site_id=${id}`).then((r) => { S.reclaim.set(id, r.pages.map((p) => ({ ...p, site: host }))); if (UI.state.route === "backlinks") UI.render(); }).catch(() => S.reclaim.set(id, []));
      return [];
    }
    return got || [];
  }

  function reclaimPages() {
    if (!H.server?.()) return [];
    const host = pickedHost();
    return host ? reclaimFor(host) : (H.sites() || []).flatMap((s) => reclaimFor(s.host));
  }
  const reclaimCount = () => reclaimPages().length;

  function reclaimBody() {
    const list = reclaimPages();
    if (!list.length) return COMP.empty(t("Nothing to reclaim"), t("Upload Search Console's Top linked pages to find gone pages that still have links."), `<button type="button" class="btn btn-small" id="gsc-open">${UI.icon("search")}${t("Import from Search Console")}</button>`);
    const found = list.filter((p) => TP.matches(PAGES.reclaim, p.path, p.page, p.site, ...(p.domains || [])));
    const shown = sortRows(found, S.rcSort, { page: (p) => p.path || p.page, http: (p) => Number(p.http) || null, sites: (p) => p.sites || p.logged_links || 0 });
    const page = TP.view(PAGES.reclaim, shown);
    const head = (id, label, cls) => sortHead("data-rc-sort", S.rcSort, id, label, cls);
    // The search shows once the list is long enough to need it, or while it holds something.
    const search = list.length > 10 || TP.state(PAGES.reclaim).q ? `<div class="chips bl-search-line">${TP.search(PAGES.reclaim, t("Search pages or linking sites"))}</div>` : "";
    return `<p class="note">${UI.icon("info")}<span>${t("Redirect each to the closest live page to get its links back.")}${UI.tip("Other sites link to these pages of yours, but the pages are gone. Redirect each one to the closest live page and the links count again.")}</span></p>
      ${search}
      ${found.length ? `<div class="bl-list"><div class="table-wrap"><table class="data" id="rc-table"><thead><tr>${head("page", "Your page")}${head("http", "Answers")}${head("sites", "Sites linking", "r")}<th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead><tbody>
      ${page.rows.map((p) => `<tr style="cursor:default"><td class="head-cell mono small url-cell" data-tip="${esc(p.page)}">${PageLink.html(p.page || p.path, { text: p.path, host: p.site, title: "" })}${UI.state.site === "all" ? `<span class="second">${t("For")} ${esc(p.site)}</span>` : ""}${p.domains.length ? `<span class="second">${esc(p.domains.slice(0, 3).join(", "))}${p.domains.length > 3 ? "…" : ""}</span>` : ""}</td>
        <td data-label="${t("Answers")}">${UI.status("serious", String(p.http))}</td>
        <td class="r" data-label="${t("Sites linking")}">${UI.num(p.sites || p.logged_links)}${p.gsc_links ? `<span class="second">${UI.num(p.gsc_links)} ${t("links")}</span>` : ""}</td>
        <td class="r nowrap">${window.UI.taskButton({ title: `${t("Redirect")} ${p.path} ${t("to a live page")}`, host: p.site, source: { type: "backlink", label: p.path, host: p.site, facts: [`${p.http}`, `${p.sites || p.logged_links} ${t("sites linking")}`], link: "#backlinks", key: `reclaim|${p.site}|${p.path}` } }, { label: "Task" })}${p.gsc_id ? ` <button class="btn btn-small" data-rc-dismiss="${p.gsc_id}">${t("Dismiss")}</button>` : ""}</td></tr>`).join("")}
      </tbody></table></div>
      ${TP.footer(PAGES.reclaim, page, { noun: t("pages") })}</div>` : COMP.empty(t("No page matches"), t("Change the search."), `<button type="button" class="btn btn-small" data-tp-key="${PAGES.reclaim}" data-tp-clear>${UI.icon("x")}${t("Clear search")}</button>`)}`;
  }

  async function dismissReclaim(button) {
    button.disabled = true;
    try { await COMP.api("POST", `backlinks/reclaim/${button.dataset.rcDismiss}/dismiss`, {}); } catch (err) { UI.toast(t(err.message), { kind: "crit" }); button.disabled = false; return; }
    S.reclaim.clear();
    UI.render();
  }

  // ---- budget, in the Mediators tab (people and agencies who place links) ------------------------------------------------------------------------
  function budgetBar(all) {
    if (!H.server?.()) return "";
    const host = pickedHost(), id = siteIdOf(host);
    if (!id) return `<span class="small sec">${t("Pick a site to set its monthly budget.")}</span>`;
    const got = S.budgets.get(id);
    if (got === undefined) {
      S.budgets.set(id, null);
      COMP.api("GET", `backlinks/budget?site_id=${id}`).then((r) => { S.budgets.set(id, r.budget || false); if (UI.state.route === "backlinks") UI.render(); }).catch(() => S.budgets.set(id, false));
      return "";
    }
    const edit = `<button class="btn btn-small" data-vd-budget="${id}">${UI.icon("pencil")}${t(got ? "Budget" : "Monthly budget")}</button>`;
    if (!got) return edit;
    const month = new Date().toISOString().slice(0, 7);
    const mine = all.filter((b) => b.site === host && b.status !== "planned" && b.cost && H.currencyOf(b) === got.currency);
    const spent = mine.filter((b) => (/^\d{4}-\d{2}/.test(b.placed || "") ? b.placed.slice(0, 7) : (b.createdAt || "").slice(0, 7)) === month).reduce((s, b) => s + b.cost, 0);
    const counting = new Set(all.filter((b) => b.site === host && b.check?.verdict === "counts").map((b) => b.domain)).size;
    const total = mine.reduce((s, b) => s + b.cost, 0);
    const over = spent > got.amount;
    return `<span class="small ${over ? "serious" : "sec"}">${t("This month")}: <b class="tabular">${H.money(got.currency, UI.num(Math.round(spent)))}</b> ${t("of")} ${H.money(got.currency, UI.num(got.amount))}${counting && total ? ` · ${t("per site that counts")}: ${H.money(got.currency, UI.num(Math.round(total / counting)))}` : ""}</span>${edit}`;
  }

  function openBudget(button) {
    const id = Number(button.dataset.vdBudget), got = S.budgets.get(id) || {};
    UI.openPanel(`${UI.panelHead(t("Monthly budget"), t("For buying links, in one currency"))}
      <form class="panel-body" id="vd-budget-form" data-id="${id}" novalidate>
        <div class="field-row"><label class="field"><span>${t("Amount")}</span><input class="input tabular" id="vd-amount" type="number" min="0" step="1" value="${esc(got.amount ?? "")}" data-autofocus></label>
        <label class="field"><span>${t("Currency")}</span><select class="select" id="vd-currency" style="width:100%">${CURRENCIES.map((c) => `<option ${c === (got.currency || "USD") ? "selected" : ""}>${c}</option>`).join("")}</select></label></div>
        <p class="help">${t("Leave empty to remove. Only prices in this currency count.")}</p><div id="vd-budget-err"></div>
      </form>
      <div class="panel-foot"><button class="btn btn-main" id="vd-budget-save">${t("Save")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, button, { key: `budget|${id}` });
  }

  async function saveBudget(button) {
    const form = UI.$("#vd-budget-form"), id = Number(form.dataset.id);
    button.disabled = true;
    try {
      const r = await COMP.api("PUT", "backlinks/budget", { site_id: id, amount: UI.$("#vd-amount").value.trim(), currency: UI.$("#vd-currency").value });
      S.budgets.set(id, r.budget || false);
    } catch (err) {
      UI.setHTML(UI.$("#vd-budget-err"), `<div class="error" role="alert">${UI.icon("octagon-alert")}<span>${esc(t(err.message))}</span></div>`);
      button.disabled = false;
      return;
    }
    UI.closePanel({ keep: false });
    UI.render();
  }

  // ---- Add backlink: the same website twice ------------------------------------------------------------------
  function duplicateNote() {
    const input = UI.$("#bl-src"), site = UI.$("#bl-site")?.value;
    if (!input || !site) return;
    let box = UI.$("#bl-dup");
    if (!box) { box = document.createElement("div"); box.id = "bl-dup"; box.setAttribute("role", "status"); input.closest(".field")?.after(box); }
    const domain = window.BacklinkCleaner.rootDomain(input.value.trim());
    const editing = UI.$("#bl-form")?.dataset.edit || "";
    const same = domain ? (window.BACKLINKS || []).filter((b) => b.site === site && b.domain === domain && String(b.id) !== editing && b.status !== "planned").length : 0;
    languageNote(input.value.trim(), domain, site);
    UI.setHTML(box, same ? `<p class="note warn">${UI.icon("copy")}<span>${t("Already links to {site}: {n}.").replace("{site}", esc(site)).replace("{n}", same === 1 ? t("1 link") : `${UI.num(same)} ${t("links")}`)}${UI.tip("Another link from the same website usually adds much less than a link from a new one.")}</span></p>` : "");
  }

  // ---- Add backlink: a page in another language ------------------------------------------------------------
  const LANGS = new Set("en fr de es it nl pt pl ru ja zh ar sv da no nb fi cs el tr ro hu ko he uk id th vi".split(" "));
  // Country endings that mostly mean one language. Endings used by everyone (.co, .io, .me, .tv) or by several languages (.be, .ch, .ca, .ma, .ae) aren't guessed from.
  const TLD_LANG = { fr: "fr", de: "de", at: "de", es: "es", mx: "es", cl: "es", it: "it", nl: "nl", pt: "pt", br: "pt", pl: "pl", ru: "ru", jp: "ja", cn: "zh", se: "sv", dk: "da", no: "no", fi: "fi", cz: "cs", gr: "el", tr: "tr", ro: "ro", hu: "hu", kr: "ko", il: "he", ua: "uk", uk: "en", au: "en", nz: "en", ie: "en", sa: "ar", eg: "ar" };
  const sameLang = (a, b) => a === b || (["no", "nb"].includes(a) && ["no", "nb"].includes(b));

  function siteLang(host) {
    const known = S.sites.get(host)?.lang;
    if (known) return known;
    const counts = {};
    (window.BACKLINKS || []).forEach((b) => { const l = (b.site === host && b.check?.target_lang || "").slice(0, 2); if (l) counts[l] = (counts[l] || 0) + 1; });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;
  }

  /* The linking page's language, before anything is read: an earlier check of that website, else what the address says. */
  function guessLang(address, domain) {
    const earlier = (window.BACKLINKS || []).find((b) => b.domain === domain && b.check?.page_lang);
    if (earlier) return { lang: earlier.check.page_lang.slice(0, 2), why: t("from an earlier check") };
    let u;
    try { u = new URL(address); } catch { return null; }
    const first = u.pathname.split("/").filter(Boolean)[0] || "";
    const m = first.match(/^([a-z]{2})(?:[-_][a-z]{2})?$/i);
    if (m && LANGS.has(m[1].toLowerCase())) return { lang: m[1].toLowerCase(), why: t("from {x} in the address").replace("{x}", `/${first}/`) };
    const labels = u.hostname.toLowerCase().split(".");
    if (labels.length > 2 && LANGS.has(labels[0])) return { lang: labels[0], why: t("from {x} in the address").replace("{x}", `${labels[0]}.`) };
    const tld = labels[labels.length - 1];
    if (TLD_LANG[tld]) return { lang: TLD_LANG[tld], why: t("from {x} in the address").replace("{x}", `.${tld}`) };
    return null;
  }

  function languageNote(address, domain, site) {
    const input = UI.$("#bl-src");
    let box = UI.$("#bl-lang");
    if (!box) { box = document.createElement("div"); box.id = "bl-lang"; box.setAttribute("role", "status"); (UI.$("#bl-dup") || input?.closest(".field"))?.after(box); }
    const mine = siteLang(site), theirs = domain ? guessLang(address, domain) : null;
    const differs = mine && theirs && !sameLang(theirs.lang, mine);
    UI.setHTML(box, differs ? `<p class="note">${UI.icon("info")}<span>${t("Looks to be in {a} ({why}); {site} is in {b}.").replace("{a}", esc(theirs.lang.toUpperCase())).replace("{why}", esc(theirs.why)).replace("{site}", esc(site)).replace("{b}", esc(mine.toUpperCase()))}${UI.tip("A link from another language still counts, but one from a page in the same language usually helps more. The first check reads the page and says for sure.")}</span></p>` : "");
  }

  // ---- the plain-file sample -------------------------------------------------------------------------------
  function sample() {
    const set = (id, check, extra = {}) => { const b = (window.BACKLINKS || []).find((x) => x.id === id); if (b && !b.check) Object.assign(b, { check, ...extra }); };
    const b1 = (window.BACKLINKS || []).find((x) => x.id === "b1"), b2 = (window.BACKLINKS || []).find((x) => x.id === "b2");
    const page = (b, path) => `https://${b?.site || "example.com"}${b?.target || path}`;
    set("b1", { verdict: "counts", reasons: [], page_lang: "fr", target_lang: "fr" }, { gsc: { seen: "page", crawled: "2026-10-28" }, targetIndex: { state: "indexed", url: page(b1, "/"), crawled: "2026-10-27", checked: "2026-11-02" } });
    const extra = (id, fields) => { const b = (window.BACKLINKS || []).find((x) => x.id === id); if (b && !b.anchorType) Object.assign(b, fields); };
    extra("b1", { anchorType: "exact", sourceIndex: { state: "indexed", via: "Search Console", at: "2026-10-28" } });
    extra("b2", { anchorType: "brand", sourceIndex: { state: "indexed", via: "SerpApi", at: "2026-11-01" } });
    extra("b5", { anchorType: "partial", sourceIndex: { state: "not_indexed", via: "SerpApi", at: "2026-11-03" }, check: { verdict: "none", reasons: ["source_not_indexed"] } });
    extra("b6", { anchorType: "partial", sourceIndex: { state: "not_found", via: "HasData", at: "2026-11-04" } });
    set("b2", { verdict: "weak", reasons: ["nofollow"], is_nofollow: true }, { gsc: { seen: "site" }, targetIndex: { state: "not_indexed", url: page(b2, "/"), coverage: "Crawled - currently not indexed", crawled: "2026-10-12", checked: "2026-11-02" } });
  }

  // ---- the simpler Backlinks (UI.simple(), ?simple=1; UI critique 2026-11-12) ------------------------------------------
  /* mockup.js draws the Backlinks screen. On the simpler screens it is reshaped here right after each draw, before the browser
     paints (a MutationObserver on #page), so the default screen stays as it was and every button keeps mockup.js's handlers.
     - The answer first: a verdict, then one row per thing that needs you (lost links, links that don't help, gone pages, links
       you didn't add, To do), each with its number and one action.
     - Four number cards: Live, New, Visits, Leads. Total is Live + Lost, and Lost is the answer's first row.
     - One tab tier, the sections. What to show (All links, Mediators, Links you didn't add, Gone pages), the filters and By page /
       By site sit behind one Filter button, and the ones in use show as chips beside it, each with its ×.
     - The links table shows at most five columns; the rest are under More columns. A column that holds only "—" in the rows on
       show hides by itself and is listed there as empty.
     - The imports sit behind the arrow of the Add backlink split button. */
  const SIMPLE = { cols: new Map(), refocus: "", last: "", needsOpen: false };
  const simpleOn = () => !!(UI?.simple?.() && UI.state.route === "backlinks");
  const linksHere = () => (window.LinkTodo?.links?.() || []).filter((b) => b.status !== "planned"); // To do never counts
  const foundHere = () => { const host = pickedHost(); return (window.FOUND_LINKS || []).filter((f) => !f.ignored && (!host || !f.site || f.site === host)); };
  const FILTER_WORDS = { lost: "Lost", useful: "Useful", visits: "Sends visits", noindex: "Linking page not indexed", useless: "Not useful" };
  const SHOW_WORDS = { all: "All links", mediators: "Mediators", found: "Links you didn't add", reclaim: "Gone pages" };
  /* The links table's columns, as mockup.js draws them: [key, heading(s), shown by default]. The source page always shows. */
  const COLS = [["target", ["Target"], true], ["keyword", ["Keyword"], false], ["anchor", ["Anchor type"], false], ["status", ["Status"], true], ["authority", ["Authority"], true],
    ["traffic", ["Site traffic"], false], ["visits", ["Visits"], true], ["leads", ["Leads"], false], ["cost", ["Cost per visit"], false], ["mediator", ["Mediator", "Mediator"], false]];
  const EMPTY_CELL = /^[\s—–-]*$/;

  function needsYou(all) {
    const n = (test) => all.filter(test).length;
    const lost = n(FILTERS.lost), useless = n(isUseless), gone = reclaimCount(), found = foundHere().length, todo = window.LinkTodo?.count?.() || 0;
    return [
      lost && { key: "lost", mark: UI.status("serious", t("Lost ")), word: "Links lost", n: lost, act: "Show them" },
      useless && { key: "useless", mark: UI.status("warn", t("Not useful")), word: "Links that barely help your ranking", n: useless, act: "Show them" },
      gone && { key: "reclaim", mark: UI.status("serious", t("Page gone")), word: "Your gone pages that still have links", n: gone, act: "Fix them" },
      found && { key: "found", mark: UI.status("info", t("Not added")), word: "Links you didn't add", n: found, act: "Review them" },
      todo && { key: "todo", mark: UI.status("planned", t("To do")), word: "Links waiting to be placed", n: todo, act: "Open To do" },
    ].filter(Boolean);
  }

  function answerHtml(all) {
    const rows = needsYou(all);
    const head = rows.length
      ? `<div class="vd-answer warn">${UI.icon("triangle-alert")}<div><strong>${esc(rows.length === 1 ? t("1 thing needs you") : t("{n} things need you").replace("{n}", UI.num(rows.length)))}</strong></div></div>`
      : `<div class="vd-answer good">${UI.icon("circle-check")}<div><strong>${esc(t("Nothing needs you"))}</strong><p>${esc(t("No lost links, and nothing waiting."))}</p></div></div>`;
    // On a phone the first three rows show and the rest wait behind "Show N more", so a link row still fits on the first screen.
    const list = rows.map((r, i) => `<li class="bl-need${i >= 3 ? " bl-need-more" : ""}" data-need="${r.key}"><span class="bl-need-mark">${r.mark}</span><span class="bl-need-word">${esc(t(r.word))}</span><b class="bl-need-n tabular">${UI.num(r.n)}</b><button type="button" class="btn btn-small" data-bl-go="${r.key}">${esc(t(r.act))}</button></li>`).join("");
    const more = rows.length > 3 ? `<li class="bl-need-toggle"><button type="button" class="link-btn" data-bl-needs-more aria-expanded="${SIMPLE.needsOpen}">${esc(t("Show {n} more").replace("{n}", UI.num(rows.length - 3)))}</button></li>` : "";
    return `<section class="card bl-answer" aria-label="${esc(t("What needs you"))}">${head}${list ? `<ul class="bl-needs${SIMPLE.needsOpen ? " open" : ""}">${list}${more}</ul>` : ""}</section>`;
  }

  /* An answer row's action: the section, the list and the filter that show those links, then the keyboard goes to the list. */
  function goTo(where) {
    const s = UI.state;
    if (where === "todo") s.blSection = "todo";
    else {
      Object.assign(s, { blSection: "done", blTab: where === "found" || where === "reclaim" ? where : "all", blMediator: "" });
      if (where === "lost" || where === "useless") s.blFilter = where;
      S.domain = ""; S.view = "page";
    }
    TP.reset(PAGES.links);
    SIMPLE.refocus = "#bl-filter-btn";
    UI.render();
  }

  /* The filters in use, as chips beside Filter: each × puts that one back. */
  function activeChips() {
    const s = UI.state, chips = [];
    const chip = (attr, value, words) => chips.push(`<button type="button" class="chip bl-on" ${attr}="${esc(value)}" aria-label="${esc(t("Remove the filter"))}: ${esc(words)}"><span dir="auto">${esc(words)}</span>${UI.icon("x")}</button>`);
    if (s.blTab !== "all") chip("data-bl-tab", "all", t(SHOW_WORDS[s.blTab] || s.blTab));
    if (s.blTab === "all") {
      if (s.blFilter && s.blFilter !== "all") chip("data-bl-filter", "all", t(FILTER_WORDS[s.blFilter] || s.blFilter));
      if (s.blMediator) chip("data-bl-mediator", "", `${t("Mediator")}: ${s.blMediator}`);
      if (S.domain) chip("data-vd-domain", "", `${t("Site")}: ${S.domain}`);
      if (byWebsite()) chip("data-vd-view", "page", t("By site"));
    }
    return chips;
  }

  function filterPop(anchor, all) {
    const s = UI.state, num = UI.num;
    const choice = (attr, value, words, n, on) => `<button type="button" class="chip" ${attr}="${esc(value)}" aria-pressed="${on}">${esc(words)}${n === null ? "" : `<b>${num(n)}</b>`}</button>`;
    const group = (title, inner) => `<div class="bl-fgroup" role="group" aria-label="${esc(title)}"><p class="bl-fhead">${esc(title)}</p><div class="chips">${inner}</div></div>`;
    const gone = reclaimCount();
    let html = group(t("Show"), [["all", all.length], ["mediators", window.LinkExtras?.count?.(all) ?? null], ["found", foundHere().length], ...(gone || s.blTab === "reclaim" ? [["reclaim", gone]] : [])]
      .map(([key, n]) => choice("data-bl-tab", key, t(SHOW_WORDS[key]), n, s.blTab === key)).join(""));
    if (s.blTab === "all") {
      const byPerson = s.blMediator ? all.filter((b) => b.mediator === s.blMediator) : all;
      html += group(t("Links"), choice("data-bl-filter", "all", t("All"), byPerson.length, !s.blFilter || s.blFilter === "all") + filterChips(byPerson, s.blFilter));
      html += group(t("View"), choice("data-vd-view", "page", t("By page"), null, !byWebsite()) + choice("data-vd-view", "website", t("By site"), null, byWebsite()));
    }
    UI.popover(anchor, `<div class="bl-fpop">${html}</div>`, "bl-pop");
  }

  /* Which column a heading or a cell is, by its words (the cells carry their column's name in data-label). */
  const colOfWords = (words) => COLS.find(([, names]) => names.some((n) => t(n) === words))?.[0] || null;
  function columnsOf(table) {
    const info = new Map(COLS.map(([key, , def]) => [key, { def, cells: [], heads: [] }]));
    table.querySelectorAll("thead th").forEach((th) => { const key = colOfWords(th.textContent.replace(/\s+/g, " ").trim()); if (key) { th.dataset.blCol = key; info.get(key).heads.push(th); } });
    table.querySelectorAll("tbody td[data-label]").forEach((td) => { const key = colOfWords(td.dataset.label); if (key) info.get(key).cells.push(td); });
    info.forEach((c, key) => {
      c.empty = c.cells.length > 0 && c.cells.every((td) => EMPTY_CELL.test(td.textContent));
      c.on = SIMPLE.cols.has(key) ? SIMPLE.cols.get(key) : c.def && !c.empty; // a choice made under More columns wins
      c.present = c.heads.length > 0;
    });
    return info;
  }
  function applyColumns() {
    const table = UI.$("#bl-table");
    if (!table) return null;
    const info = columnsOf(table);
    info.forEach((c) => [...c.heads, ...c.cells].forEach((el) => el.classList.toggle("bl-col-off", !c.on)));
    const hidden = [...info.values()].filter((c) => c.present && !c.on).length, button = UI.$("#bl-cols-btn b");
    if (button) button.textContent = hidden ? UI.num(hidden) : "";
    return info;
  }
  function columnsPop(anchor) {
    const info = applyColumns();
    if (!info) return;
    const rows = COLS.filter(([key]) => info.get(key).present).map(([key, names]) => {
      const c = info.get(key);
      return `<label class="opt bl-col-opt"><input type="checkbox" class="chk" data-bl-col-pick="${key}" ${c.on ? "checked" : ""}><span>${esc(t(names[0]))}</span>${c.empty ? `<span class="small muted">${esc(t("empty here"))}</span>` : ""}</label>`;
    }).join("");
    UI.popover(anchor, `<div class="bl-fpop" role="group" aria-label="${esc(t("Columns"))}"><p class="bl-fhead">${esc(t("Columns"))}</p>${rows}</div>`, "bl-pop");
  }

  /* The split button's arrow: the other ways to add. An item presses the arrow itself under the old button's id (bulk-open,
     gsc-open, bulk-template), so mockup.js and this file open their panel or dialog with the arrow as the opener, and closing it
     gives the keyboard back to the arrow. */
  function addMenu(anchor) {
    const item = (id, icon, words) => `<button type="button" class="bl-menu-item" data-bl-add="${id}" role="menuitem">${UI.icon(icon)}${esc(t(words))}</button>`;
    UI.popover(anchor, `<div class="bl-menu" role="menu" aria-label="${esc(t("More ways to add"))}">${item("bulk-open", "list-plus", "Import a CSV file")}${item("gsc-open", "search", "Import from Search Console")}${item("bulk-template", "download", "Download the CSV template")}</div>`, "bl-pop");
  }

  function splitAdd() {
    const add = UI.$("#add-backlink");
    if (!add || add.parentElement.classList.contains("bl-split")) return;
    const wrap = document.createElement("span");
    wrap.className = "bl-split";
    add.replaceWith(wrap);
    wrap.append(add, UI.fragment(`<button type="button" class="btn btn-main bl-split-more" id="bl-add-more" data-pop-toggle aria-haspopup="menu" aria-expanded="false" aria-label="${esc(t("More ways to add"))}" data-tip="${esc(t("Import a CSV file or from Search Console"))}">${UI.icon("chevron-down")}</button>`));
  }

  function toolbar(content, all) {
    const s = UI.state, tab = s.blTab, sections = content.querySelector(":scope > .tabs.sections");
    const on = activeChips();
    const bar = UI.fragment(`<div class="bl-sbar"><span class="bl-sbar-search"></span><button type="button" class="btn btn-small" id="bl-filter-btn" data-pop-toggle aria-haspopup="dialog" aria-expanded="false">${UI.icon("filter")}${esc(t("Filter"))}${on.length ? `<b class="bl-count">${UI.num(on.length)}</b>` : ""}</button>${on.join("")}<span class="bl-sbar-end"></span></div>`).firstElementChild;
    if (tab === "all") {
      const row = content.querySelector(":scope > .chips");
      const search = row?.querySelector(".tp-search");
      if (search) bar.querySelector(".bl-sbar-search").replaceWith(search);
      if (row) row.replaceWith(bar); else sections?.after(bar);
      if (UI.$("#bl-table", content)) bar.querySelector(".bl-sbar-end").append(UI.fragment(`<button type="button" class="btn btn-small" id="bl-cols-btn" data-pop-toggle aria-haspopup="dialog" aria-expanded="false">${UI.icon("columns-3")}${esc(t("More columns"))}<b class="bl-count"></b></button>`));
    } else {
      sections?.after(bar);
      // Links you didn't add: its own line keeps its search, Show ignored and the disavow file; the upload is in the split button.
      content.querySelector(":scope > .chips #gsc-open")?.remove();
    }
    bar.querySelector(".bl-sbar-search:empty")?.remove();
    // An empty list asks for one thing: a CSV. Search Console is in the split button's menu.
    content.querySelector(".empty .bl-tools #gsc-open")?.remove();
  }

  function simplify() {
    const content = UI.$("#page .content");
    if (!content || !content.querySelector(":scope > .tabs.sections")) return; // still loading, or it failed: the card says so
    content.classList.add("bl-simple");
    content.setAttribute("data-tt-filter-off", ""); // one Filter on this screen: the one below, not table-tools' as well
    const all = linksHere(), tiles = content.querySelector("#bl-tiles");
    if (tiles) {
      const cards = [...tiles.children];
      if (cards.length === 6) { cards[2].remove(); cards[0].remove(); } // Total and Lost: Live + Lost, and the answer's first row
      // The answer and the cards side by side on a wide screen, one above the other on a phone.
      const top = document.createElement("div");
      top.className = "bl-top";
      tiles.replaceWith(top);
      top.append(UI.fragment(answerHtml(all)), tiles);
    }
    content.querySelectorAll(":scope > .tabs[role=tablist]:not(.sections)").forEach((el) => el.remove()); // one tab tier
    splitAdd();
    if (UI.state.blSection === "done") toolbar(content, all);
    applyColumns();
    if (SIMPLE.refocus) { const el = UI.$(SIMPLE.refocus); SIMPLE.refocus = ""; el?.focus({ preventScroll: true }); el?.scrollIntoView?.({ block: "nearest" }); }
    else if (SIMPLE.last && (!document.activeElement || document.activeElement === document.body)) UI.$(`#${CSS.escape(SIMPLE.last)}`)?.focus({ preventScroll: true });
  }

  /* Both modes: the chip line has one Lost, the one filterChips draws with the other answers. */
  function dropDuplicateLost() {
    UI.$$('#page .chips > [data-bl-filter="lost"]:not(.vd-chip)').forEach((chip) => chip.remove());
  }

  function watchPage() {
    const page = document.getElementById("page");
    if (!page) return;
    new MutationObserver(() => {
      if (UI.state.route !== "backlinks") return;
      dropDuplicateLost();
      if (simpleOn()) simplify();
    }).observe(page, { childList: true });
    // The keyboard stays on Filter or More columns when a list loads late and the screen draws again (the Mediators list does).
    document.addEventListener("focusin", (e) => { SIMPLE.last = e.target.closest?.(".bl-sbar [id]")?.id || ""; });
  }

  function simpleClicks(e) {
    if (!simpleOn()) return false;
    const hit = (sel) => e.target.closest?.(sel);
    let el;
    // A choice in the Filter menu: the menu closes, the screen draws again, and the keyboard goes back to Filter.
    if (hit("#popover.bl-pop") && hit("[data-bl-tab], [data-bl-filter], [data-vd-view], [data-bl-mediator], [data-vd-domain]")) { SIMPLE.refocus = "#bl-filter-btn"; UI.closePopover(); return false; }
    if (hit(".bl-on")) { SIMPLE.refocus = "#bl-filter-btn"; return false; } // a chip's ×: mockup.js or the lines below do the rest
    if ((el = hit("#popover.bl-pop [data-bl-add]"))) {
      e.stopPropagation();
      UI.closePopover();
      const arrow = UI.$("#bl-add-more");
      if (!arrow) return true;
      arrow.id = el.dataset.blAdd; // for this one press only
      try { arrow.click(); } finally { arrow.id = "bl-add-more"; }
      return true;
    }
    const toggle = (id, open) => { if ((el = hit(id))) { e.stopPropagation(); if (UI.$("#popover") && el.getAttribute("aria-expanded") === "true") UI.closePopover({ focus: true }); else open(el); return true; } return false; };
    if (toggle("#bl-filter-btn", (b) => filterPop(b, linksHere()))) return true;
    if (toggle("#bl-cols-btn", columnsPop)) return true;
    if (toggle("#bl-add-more", addMenu)) return true;
    if ((el = hit("[data-bl-needs-more]"))) { SIMPLE.needsOpen = true; el.closest(".bl-needs").classList.add("open"); el.setAttribute("aria-expanded", "true"); el.closest(".bl-needs").querySelector(".bl-need-more button")?.focus(); return true; }
    if ((el = hit("[data-bl-go]"))) { e.stopPropagation(); goTo(el.dataset.blGo); return true; }
    return false;
  }

  function bind() {
    document.addEventListener("change", (e) => {
      const box = e.target.closest?.("[data-bl-col-pick]");
      if (!box) return;
      SIMPLE.cols.set(box.dataset.blColPick, box.checked);
      applyColumns();
    });
    document.addEventListener("click", (e) => {
      const hit = (sel) => e.target.closest?.(sel);
      let el;
      if (simpleClicks(e)) return;
      if ((el = hit("#gsc-open"))) { openGsc(el); return; }
      if ((el = hit("#gsc-send"))) { sendGsc(el); return; }
      if ((el = hit("[data-vd-disavow]"))) { e.stopPropagation(); toggleDisavow(el); return; }
      if ((el = hit("[data-rc-dismiss]"))) { dismissReclaim(el); return; }
      if ((el = hit("[data-vd-budget]"))) { openBudget(el); return; }
      if ((el = hit("#vd-budget-save"))) { saveBudget(el); return; }
      if ((el = hit("[data-vd-view]"))) { S.view = el.dataset.vdView; UI.render(); UI.$(`[data-vd-view="${S.view}"]`)?.focus(); return; }
      if ((el = hit("[data-vd-domain]"))) { e.stopPropagation(); S.domain = el.dataset.vdDomain; S.view = "page"; TP.reset(PAGES.links); UI.render(); return; }
      if ((el = hit("[data-bls-sort]"))) { const id = el.dataset.blsSort; S.siteSort = nextSort(S.siteSort, id, id === "domain" ? "asc" : "desc"); TP.reset(PAGES.sites); UI.render(); UI.$(`[data-bls-sort="${id}"]`)?.focus(); return; }
      if ((el = hit("[data-rc-sort]"))) { const id = el.dataset.rcSort; S.rcSort = nextSort(S.rcSort, id, id === "page" ? "asc" : "desc"); TP.reset(PAGES.reclaim); UI.render(); UI.$(`[data-rc-sort="${id}"]`)?.focus(); return; }
    }, true);
    document.addEventListener("input", (e) => { if (e.target.id === "bl-src") duplicateNote(); });
    document.addEventListener("change", (e) => { if (e.target.id === "bl-site") duplicateNote(); });
    document.addEventListener("submit", (e) => { if (e.target.id === "vd-budget-form") { e.preventDefault(); const b = UI.$("#vd-budget-save"); if (b && !b.disabled) saveBudget(b); } });
    window.addEventListener("seocc:backlinks-changed", () => S.reclaim.clear());
  }

  window.BacklinkSeo = {
    init(ui, helpers) { UI = ui; H = helpers; bind(); sample(); watchPage(); TP.on(PAGES.sites, () => UI.render()); TP.on(PAGES.reclaim, () => UI.render()); },
    noteSite: (host, facts) => { if (host && facts) S.sites.set(host, facts); },
    filterRows, filterChips, viewSwitch, trafficTotals, byWebsite, websiteTable, searchBox, resetPages, sortRows, sortHead, nextSort, PAGES, trafficHead, trafficCell, anchorTag, anchorWord, anchorOptions,
    badge, liveNote, authorityCell, authorityOf, authoritySort, scoreCell, panelBlocks, repaint, foundTools, foundButton, foundSeen, reclaimBody, reclaimCount, budgetBar, duplicateNote,
    forget: () => { S.reclaim.clear(); S.budgets.clear(); S.effects.clear(); },
  };

  const fr = {
    "All links": "Tous les liens", "Links you didn't add": "Liens non ajoutés", "Gone pages": "Pages disparues", "Links lost": "Liens perdus",
    "Links that barely help your ranking": "Liens qui aident peu votre classement", "Your gone pages that still have links": "Vos pages disparues qui ont encore des liens",
    "Show {n} more": "Voir {n} de plus", "Links waiting to be placed": "Liens en attente de pose",
    "Show them": "Les voir", "Fix them": "Les corriger", "Review them": "Les passer en revue", "Open To do": "Ouvrir À faire", "Not added": "Non ajouté",
    "1 thing needs you": "1 point demande votre attention", "{n} things need you": "{n} points demandent votre attention", "Nothing needs you": "Rien ne demande votre attention",
    "No lost links, and nothing waiting.": "Aucun lien perdu, et rien en attente.", "What needs you": "Ce qui demande votre attention", "Remove the filter": "Retirer le filtre",
    "More columns": "Plus de colonnes", "empty here": "vide ici", "More ways to add": "Autres façons d'ajouter", "Import a CSV file": "Importer un fichier CSV",
    "Download the CSV template": "Télécharger le modèle CSV", "Import a CSV file or from Search Console": "Importer un fichier CSV ou depuis Search Console",
    "Barely useful": "Peu utile", "Spam": "Spam", "Listed": "Listé", "Site listed": "Site listé", "Not listed": "Pas listé",
    "Google sees the page; the link passes value.": "Google voit la page ; le lien transmet de la valeur.",
    "Search Console lists this page": "Search Console liste cette page", "crawled": "exploré le",
    "Search Console lists the site, not this page.": "Search Console liste le site, pas cette page.",
    "Placed 60+ days before your last Search Console upload, yet missing from it. Its list is a sample: only a hint.": "Placé plus de 60 jours avant votre dernier import Search Console, mais absent. Sa liste est un échantillon : simple indice.",
    "In the disavow file.": "Dans le fichier de désaveu.",
    "Last check: followed, on a page Google can index.": "Dernier contrôle : suivi, sur une page indexable par Google.", "useful": "utiles",
    "Open PageRank, 0–10, not the DA scale.": "Open PageRank, de 0 à 10, pas l'échelle du DA.",
    "Page set to noindex.": "Page en noindex.",
    "Blocked by robots.txt.": "Bloquée par robots.txt.",
    "Page-wide nofollow.": "Nofollow sur toute la page.",
    "Marked nofollow.": "Marqué nofollow.",
    "Marked sponsored.": "Marqué sponsored.",
    "Marked ugc.": "Marqué ugc.",
    "Main version is another page.": "La version principale est une autre page.",
    "Links to 100+ sites.": "Pointe vers plus de 100 sites.",
    "Counted by Google?": "Compté par Google ?",
    "Link on the page?": "Lien sur la page ?", "Working": "Ça fonctionne", "Live, and Google counts it.": "En ligne, et Google le compte.", "Weak link": "Lien faible", "Google doesn't count it": "Google ne le compte pas",
    "Not placed yet": "Pas encore placé", "Your page is gone": "Votre page n'existe plus", "Missing on last check": "Absent au dernier contrôle", "Couldn't check it": "Contrôle impossible", 
    "Page gone.": "Page disparue.", "Link gone from the page.": "Lien absent de la page.", 
    "Not checked": "Non contrôlé", "Not ready yet": "Pas encore prêt", "Likely spam": "Spam probable", "Whole site": "Tout le site", "visit": "visite", "visits": "visites", "lead": "prospect", "leads": "prospects", "clicks": "clics",
    "Linking page in {a}, yours in {b}.": "Page source en {a}, la vôtre en {b}.",
    "Answers {n}: redirect it to a live page.": "Répond {n} : redirigez-la vers une page en ligne.",
    "Not in your last Search Console upload.": "Absent de votre dernier import Search Console.",
    "Many outbound links or a high spam score.": "Beaucoup de liens sortants ou un score de spam élevé.",
    "It goes in the disavow file.": "Il ira dans le fichier de désaveu.",
    "Mark as spam": "Marquer comme spam", "Not spam": "Pas du spam", "Marked as spam": "Marqué comme spam", "Spam mark removed": "Marquage spam retiré",
    "Waiting for Search Console data.": "En attente des données Search Console.", "Ready on": "Prêt le",
    "Before and after": "Avant et après", "Correlation, not proof": "Corrélation, pas preuve", "Target page clicks": "Clics de la page cible", "before": "avant", "after": "après", "This page": "Cette page", "the whole site": "tout le site", "position": "position",
    "From Search Console. Timing, not proof of cause.": "Depuis Search Console. Simple coïncidence de dates, pas une preuve.",
    "It needs a target page and a date placed.": "Il faut une page cible et une date de mise en ligne.", "Date placed must be YYYY-MM-DD.": "La date de pose doit être au format AAAA-MM-JJ.",
    "Google: most sites never need one. Upload it in Search Console only for spam links you can't get removed.": "Google : la plupart des sites n'en ont jamais besoin. Importez-le dans Search Console seulement pour des liens spam impossibles à faire retirer.",
    "Disavow file": "Fichier de désaveu", "Pick a site to download its disavow file.": "Choisissez un site pour télécharger son fichier de désaveu.",
    "Import from Search Console": "Importer depuis Search Console",
    "Download from Search Console, then upload here. About a minute per site.": "Téléchargez depuis Search Console, puis importez ici. Environ une minute par site.",
    "In Search Console, open Links (left menu).": "Dans Search Console, ouvrez Liens (menu de gauche).",
    "Export external links (top right) → Latest links → Download CSV.": "Exporter les liens externes (en haut à droite) → Derniers liens → Télécharger au format CSV.",
    "Upload it below. Top linking sites or Top linked pages work too.": "Importez-le ci-dessous. Principaux sites de liens ou Pages les plus liées marchent aussi.",
    "Choose the file Search Console downloaded.": "Choisissez le fichier téléchargé depuis Search Console.", "Needs the running app": "Nécessite l'application en marche", "Uploading…": "Import en cours…", "Upload": "Importer", "Upload another": "Importer un autre",
    "new links you didn't add": "nouveaux liens que vous n'avez pas ajoutés", "logged links Google sees": "liens saisis vus par Google", "linking sites": "sites qui font des liens",
    "of your pages have links; each is read monthly for Reclaim.": "de vos pages ont des liens ; chacune est lue chaque mois pour À récupérer.", "rows skipped: own pages or duplicates": "lignes ignorées : vos pages ou doublons",
    "Not a Search Console Links export. Open Links, then Export external links, and choose Latest links.": "Ce n'est pas un export Liens de Search Console. Ouvrez Liens, puis Exporter les liens externes, et choisissez Derniers liens.",
    "Download it as CSV, not Excel.": "Téléchargez-le en CSV, pas en Excel.", "No .csv inside that .zip.": "Aucun .csv dans ce .zip.", "Can't open that .zip.": "Impossible d'ouvrir ce .zip.",
    "File too large: a Search Console export is well under 10 MB.": "Fichier trop volumineux : un export Search Console fait bien moins de 10 Mo.",
    "Reclaim": "À récupérer", "Nothing to reclaim": "Rien à récupérer", "Gone pages that still have links show here.": "Vos pages disparues qui ont encore des liens s'affichent ici.",
    "Redirect each to the closest live page to get its links back.": "Redirigez chacune vers la page en ligne la plus proche pour récupérer ses liens.",
    "Your page": "Votre page", "Answers": "Répond", "Sites linking": "Sites qui font un lien", "sites linking": "sites qui font un lien", "links": "liens", "1 link": "1 lien", "Redirect": "Rediriger", "to a live page": "vers une page en ligne", "Dismiss": "Écarter", "That page isn't in the list.": "Cette page n'est pas dans la liste.",
    "Pick a site to set its monthly budget.": "Choisissez un site pour fixer son budget mensuel.", "Budget": "Budget", "This month": "Ce mois-ci", "of": "sur", "per site that counts": "par site qui compte",
    "Monthly budget": "Budget mensuel", "For buying links, in one currency": "Pour l'achat de liens, dans une seule devise", "Amount": "Montant", "Currency": "Devise",
    "Leave empty to remove. Only prices in this currency count.": "Laissez vide pour supprimer. Seuls les prix dans cette devise comptent.",
    "The budget must be a number.": "Le budget doit être un nombre.", "Choose one of USD, EUR, AED, GBP.": "Choisissez USD, EUR, AED ou GBP.",
    "Already links to {site}: {n}.": "Pointe déjà vers {site} : {n}.",
    "Say whether to mark this link as spam.": "Indiquez si ce lien doit être marqué comme spam.",
    "Your page in Google?": "Votre page dans Google ?", "Indexed": "Indexée", "Not indexed": "Non indexée", "Unknown to Google": "Inconnue de Google", "Your page isn't indexed": "Votre page n'est pas indexée",
    "The link can't help it rank yet.": "Le lien ne peut pas encore l'aider à se classer.", "Google says:": "Google indique :",
    "Add it to your sitemap or request indexing in Search Console.": "Ajoutez-la à votre sitemap ou demandez son indexation dans Search Console.",
    "Google's main version:": "Version principale pour Google :", "Get indexed:": "Faire indexer :",
    "From Search Console's URL Inspection": "Depuis l'inspection d'URL de Search Console",
    "Connect Search Console to check if your page is indexed.": "Connectez Search Console pour vérifier si votre page est indexée.", "Data sources": "Sources de données",
    "Asked at the next check, or press Check.": "Demandé au prochain contrôle, ou cliquez sur Vérifier.",
    "Not in the site's Search Console property, so not inspected.": "Absente de la propriété Search Console du site : pas d'inspection.",
    "Looks to be in {a} ({why}); {site} is in {b}.": "Semble en {a} ({why}) ; {site} est en {b}.",
    "Linking page not on Google.": "Page source absente de Google.",
    "Linking page not indexed": "Page source non indexée", "Search Console lists the link": "Search Console liste le lien", "a site: search on {tool}": "une recherche site: sur {tool}",
    "The next check looks for the linking page on Google.": "Le prochain contrôle cherchera la page source dans Google.",
    "Connect a search tool, such as SerpApi, to see if Google has the linking page. Free searches only.": "Connectez un outil de recherche, comme SerpApi, pour voir si Google a la page source. Recherches gratuites uniquement.",
    "Linking page on Google": "Page source dans Google",
    "Not found on Google yet; searched again in a few days.": "Pas encore trouvée dans Google ; nouvelle recherche dans quelques jours.",
    "Ask the site to get it indexed.": "Demandez au site de la faire indexer.",
    "Useful": "Utile", "Show all links": "Voir tous les liens", "Upload Search Console's Top linked pages to find gone pages that still have links.": "Importez les Pages les plus liées de Search Console pour trouver les pages disparues qui ont encore des liens.", "Gone from the page, or the page is gone": "Absent de la page, ou page disparue", "Sends visits": "Envoient des visites", "Not useful": "Pas utile", "Site": "Site", "Show": "Afficher", "By page": "Par page", "By site": "Par site",
    "Live, followed, on a page Google can index": "En ligne, suivi, sur une page que Google peut indexer", "At least one visit": "Au moins une visite",
    "Linking page not in Google, or not indexable": "Page source absente de Google ou non indexable", "Barely or not useful: nofollow, sponsored, or on a page that passes nothing": "Peu ou pas utile : nofollow, sponsored, ou sur une page qui ne transmet rien",
    "Site traffic": "Trafic du site", "Ahrefs estimate: the linking site's monthly Google visits": "Estimation Ahrefs : visites Google mensuelles du site source",
    "Brand": "Marque", "Bare URL": "URL nue", "Exact keyword": "Mot-clé exact", "Partial keyword": "Mot-clé partiel", "Generic": "Générique",
    "Automatic": "Automatique", "Set by hand.": "Choisi à la main.", "set by hand": "choisi à la main", "None of the above.": "Aucun des types précédents.",
    "Your brand or domain. The safest anchor.": "Votre marque ou domaine. L'ancre la plus sûre.",
    "Brand + keyword": "Marque + mot-clé",
    "Points elsewhere": "Pointe ailleurs", "The last check found this link pointing at another page of your site, not the target page you logged.": "Le dernier contrôle a trouvé ce lien vers une autre page de votre site, pas la page cible enregistrée.",
    "The app's own check of the linking page: is the link followed, and can the page be indexed? Not data from Google.": "Le contrôle de l'app sur la page source : le lien est-il suivi, et la page peut-elle être indexée ? Ce ne sont pas des données de Google.",
    "The app's check: the link is followed, on a page that can be indexed.": "Contrôle de l'app : le lien est suivi, sur une page indexable.",
    "Does it pass value?": "Transmet-il de la valeur ?", "Live, and it passes value.": "En ligne, et il transmet de la valeur.",
    "Domain authority from your file": "Autorité de domaine d'après votre fichier",
    "Your domain name holds a tracked keyword, so this anchor is also an exact-match keyword. Count it with Exact keyword.": "Votre nom de domaine contient un mot-clé suivi : cette ancre est donc aussi un mot-clé exact. Comptez-la avec Mot-clé exact.",
    "The address, like www.example.com. Safe and natural.": "L'adresse, comme www.example.com. Sûr et naturel.",
    "Exactly one tracked keyword. Helps most; too many look bought.": "Exactement un mot-clé suivi. Aide le plus ; trop nombreux, cela paraît acheté.",
    "A tracked keyword among other words.": "Un mot-clé suivi parmi d'autres mots.",
    "Words like click here or read more. Natural, but tell Google little.": "Des mots comme cliquez ici ou en savoir plus. Naturel, mais cela dit peu de choses à Google.",
    "No links match": "Aucun lien ne correspond", "Pick another filter.": "Choisissez un autre filtre.", "Links": "Liens", "live": "en ligne", "Best link": "Meilleur lien", "Its best link, per the last check": "Son meilleur lien, d'après le dernier contrôle", "Show its links": "Voir ses liens",
    "Monthly Google traffic of each site that links to you": "Trafic Google mensuel de chaque site qui pointe vers vous", "Paid": "Payant", "About 50 API units per site a month": "Environ 50 unités d'API par site et par mois",
    "Off until you paste a key. The Site traffic column on Backlinks only shows while it's connected. At most 200 sites a month, about 10,000 units.": "Désactivé tant que vous ne collez pas de clé. La colonne Trafic du site des Backlinks n'apparaît que lorsqu'il est connecté. Au plus 200 sites par mois, environ 10 000 unités.",
    "Check your plan": "Vérifiez votre forfait", "Needs a plan with API units. Your plan page shows how many.": "Il faut un forfait avec des unités d'API. La page du forfait en indique le nombre.", "Your limits": "Vos limites",
    "Create a key": "Créer une clé", "In API keys, press Create API key and copy it.": "Dans Clés API, cliquez sur Créer une clé API et copiez-la.", "API keys": "Ouvrir les clés API",
    "Paste it above and press Save. Test uses no units.": "Collez-la ci-dessus et cliquez sur Enregistrer. Le test n'utilise aucune unité.",
    "Monthly, per your plan": "Chaque mois, selon votre forfait",
    "from an earlier check": "d'après un contrôle précédent", "from {x} in the address": "d'après {x} dans l'adresse",
    "Search sites": "Rechercher un site", "Search links": "Rechercher un lien", "Search pages or linking sites": "Rechercher une page ou un site", "sites": "sites", "pages": "pages",
    "No site matches": "Aucun site ne correspond", "Change the search or filter.": "Modifiez la recherche ou le filtre.",
    "No page matches": "Aucune page ne correspond", "Change the search.": "Modifiez la recherche.",
  };
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
