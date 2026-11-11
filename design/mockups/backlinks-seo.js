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
    const get = getters[sort.id], dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x === null || x === undefined) return 1; // unknown goes last either way
      if (y === null || y === undefined) return -1;
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }
  function sortHead(attr, sort, id, label, cls = "", tip = "") {
    const on = sort?.id === id;
    return `<th scope="col" class="${cls}" aria-sort="${on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}" ${tip ? `data-tip="${esc(tip)}"` : ""}><button type="button" class="th-btn" ${attr}="${id}">${t(label)}${on ? UI.icon(sort.dir === "asc" ? "arrow-up" : "arrow-down") : ""}</button></th>`;
  }
  const MANY_OUTBOUND = 100, SPAM_SCORE = 30, CURRENCIES = ["USD", "EUR", "AED", "GBP"];

  const VERDICT = { counts: ["vd-counts", "Counts"], weak: ["vd-weak", "Weak"], none: ["vd-none", "Doesn't count"] };
  const REASONS = {
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
  const ANCHORS = {
    brand: ["Brand", "Your brand or domain name. The safest kind of anchor."],
    url: ["Bare URL", "The address itself, such as www.example.com. Safe and natural."],
    exact: ["Exact keyword", "Exactly one of your tracked keywords. Helps the most, but too many look bought."],
    partial: ["Partial keyword", "Holds one of your tracked keywords among other words."],
    generic: ["Generic", "Words like click here or read more. Natural, but tell Google little."],
    other: ["Other", "None of the kinds above."],
  };
  const t = (w) => UI.t(w), esc = (v) => UI.esc(v);
  const siteIdOf = (host) => (H.sites?.() || []).find((s) => s.host === host)?.id ?? null;
  const pickedHost = () => UI.siteHostPicked?.() || null;

  // ---- in the table ---------------------------------------------------------------------------------
  function reasonsText(list) {
    return (list || []).map((r) => t(REASONS[r] || r)).join(" ");
  }

  /* Beside the status: the verdict, then what Google's own list says. Only for a link that was read or that Search Console listed. */
  function badge(b) {
    const parts = [];
    const c = b.check;
    if (c?.verdict && b.status === "live") {
      const [cls, word] = VERDICT[c.verdict];
      const tip = c.verdict === "counts" ? t("Google can see this page and the link passes value.") : reasonsText(c.reasons);
      parts.push(`<span class="tag vd-tag ${cls}" data-tip="${esc(tip)}" tabindex="0">${t(word)}</span>`);
    }
    if (b.status === "live" && b.sourceIndex?.state === "not_indexed") parts.push(`<span class="tag vd-tag vd-none" data-tip="${esc(t(REASONS.source_not_indexed))}" tabindex="0">${t("Linking page not indexed")}</span>`);
    const ix = b.status === "live" ? b.targetIndex : null;
    if (ix && (ix.state === "not_indexed" || ix.state === "unknown")) parts.push(`<span class="tag vd-tag vd-weak" data-tip="${esc(indexWhy(ix))}" tabindex="0">${t("Your page isn't indexed")}</span>`);
    const g = b.gsc || {};
    if (g.seen === "page") parts.push(`<span class="tag vd-tag vd-google" data-tip="${esc(t("Search Console lists this page among your links"))}${g.crawled ? ` · ${esc(t("last crawled"))} ${esc(g.crawled)}` : ""}" tabindex="0">${t("Google sees it")}</span>`);
    else if (g.seen === "site") parts.push(`<span class="tag vd-tag vd-google" data-tip="${esc(t("Search Console lists this site among your links, but not this exact page."))}" tabindex="0">${t("Google sees the site")}</span>`);
    else if (g.not_listed) parts.push(`<span class="tag vd-tag" data-tip="${esc(t("Placed more than 60 days before your last Search Console upload, and not in it. Its list is a sample, so this is only a hint."))}" tabindex="0">${t("Not listed by Google yet")}</span>`);
    if (b.disavow) parts.push(`<span class="tag vd-tag vd-none" data-tip="${esc(t("Marked as spam: it's in the disavow file."))}" tabindex="0">${t("Spam")}</span>`);
    return parts.length ? `<span class="vd-row">${parts.join("")}</span>` : "";
  }

  /* The Live card's second line: how many live links pass value, once any has been read. */
  function liveNote(links) {
    const read = links.filter((b) => b.status === "live" && b.check?.verdict);
    if (!read.length) return "";
    const counts = read.filter((b) => b.check.verdict === "counts").length;
    return `<span class="ab" data-tip="${esc(t("Read on the last check: followed, on a page Google can index."))}">${UI.num(counts)} ${t(counts === 1 ? "counts for Google" : "count for Google")}</span>`;
  }

  /* Authority: the file's DA, or else Open PageRank with its name, because two tools' scores don't compare. */
  function authorityCell(b) {
    if (b.auth) return UI.dec(b.auth);
    if (b.opr !== null && b.opr !== undefined) return `<span data-tip="${esc(t("Open PageRank, 0 to 10. Not the same scale as DA."))}" tabindex="0">${UI.dec(b.opr)} <span class="tag">OPR</span></span>`;
    return "—";
  }

  const looksSpammy = (b) => (b.check?.outbound_links || 0) > MANY_OUTBOUND || (b.spam !== null && b.spam !== undefined && b.spam >= SPAM_SCORE);

  // ---- on a link's panel -----------------------------------------------------------------------------
  /* The panel reads in seconds: one verdict on top, then one short question per row with its answer on the right.
     The proof behind an answer opens under its row. A row opens by itself only when it holds something to do. */
  const tagOf = (cls, word) => `<span class="tag vd-tag ${cls}">${t(word)}</span>`;
  const quiet = (word) => `<span class="muted">${t(word)}</span>`;
  const indexBad = (ix) => ix?.state === "not_indexed" || ix?.state === "unknown";

  /* [tone, headline, one sentence or nothing]: is this link doing its job, and if not, the one reason that matters most. */
  function answerOf(b) {
    const c = b.check || {}, firstReason = c.reasons?.[0] ? t(REASONS[c.reasons[0]] || c.reasons[0]) : "";
    if (b.disavow) return ["bad", t("Marked as spam"), t("It's in the disavow file.")];
    if (b.status === "planned") return ["idle", t("Not placed yet"), ""];
    if (b.status === "lost") return ["bad", t("This link is lost"), t(c.outcome === "page_gone" ? "The page no longer exists." : "The link is no longer on the page.")];
    if (c.target_http === 404 || c.target_http === 410) return ["bad", t("Your page is gone"), t("Your target page answers {n}, so this link is wasted until the page redirects to a live one.").replace("{n}", c.target_http)];
    if (c.misses > 0) return ["warn", t("Not found on the last check"), t("It's read once more tomorrow before it counts as lost.")];
    if (c.verdict === "none") return ["bad", t("Google doesn't count it"), firstReason];
    if (b.sourceIndex?.state === "not_indexed") return ["bad", t("Linking page not indexed"), t("Ask the website to get it indexed, or the link passes nothing.")];
    if (indexBad(b.targetIndex)) return ["warn", t("Your page isn't indexed"), ""]; // its row opens below with the why and a task
    if (c.verdict === "weak") return ["warn", t("Weak link"), firstReason];
    if (c.verdict === "counts") return ["good", t("Working"), t("The link is live and Google counts it.")];
    if (c.outcome === "unknown") return ["idle", t("Couldn't check it"), t("A page that can't be read never counts as a lost link.")];
    return ["idle", t("Not checked yet"), ""];
  }

  function answerInner(b) {
    const [tone, word, why] = answerOf(b);
    const mark = { good: "circle-check", warn: "triangle-alert", bad: "octagon-alert", idle: "info" }[tone];
    return `<div class="vd-answer ${tone}">${UI.icon(mark)}<div><strong>${esc(word)}</strong>${why ? `<p>${esc(why)}</p>` : ""}</div></div>`;
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
    html += qRow("link", t("Is the link on the page?"), linkStatus(b.status), check, b.status === "live" && !b.check?.checked_at);
    if (google) html += qRow("google", t("Does Google count it?"), googleValue(b), google);
    if (index) html += qRow("index", t("Is your page in Google?"), indexValue(b), index, indexBad(b.targetIndex));
    if (server && id) {
      html += `<div id="vd-effect" data-id="${id}">${effectInner(id)}</div>`;
      if (!S.effects.has(id)) loadEffect(id);
    } else if (sampleEffect) html += qRow("effect", t("Before and after"), sampleEffect.value, sampleEffect.body);
    html += qRow("traffic", t("Traffic from this link"), trafficValue, traffic);
    if (spammy && spam) html += qRow("spam", t("Spam"), tagOf("vd-none", b.disavow ? "Marked as spam" : "Looks like spam"), spam);
    html += qRow("details", t("Details"), anchor ? `<span class="muted" dir="auto">${esc(anchor)}</span>` : "", details + (spammy ? "" : spam));
    return html;
  }

  /* After Run again: the verdict and the answers on the right change, and any row the person opened stays open. */
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
      const reasons = (c.reasons || []).map((r) => `<li>${esc(t(REASONS[r] || r))}</li>`).join("");
      html += c.verdict === "counts" ? `<p class="lk-result">${t("Google can see this page and the link passes value.")}</p>` : reasons ? `<ul class="vd-reasons">${reasons}</ul>` : "";
      const lang = (v) => (v || "").slice(0, 2);
      if (lang(c.page_lang) && lang(c.target_lang) && lang(c.page_lang) !== lang(c.target_lang)) {
        html += `<p class="note">${UI.icon("info")}<span>${t("The linking page is in {a} and your page is in {b}. Links from pages in the same language and on the same topic usually help more.").replace("{a}", esc(lang(c.page_lang).toUpperCase())).replace("{b}", esc(lang(c.target_lang).toUpperCase()))}</span></p>`;
      }
    }
    html += sourceLine(b, server);
    if (c.target_http === 404 || c.target_http === 410) {
      html += `<p class="note warn">${UI.icon("triangle-alert")}<span>${t("Your target page answers {n}, so this link is wasted until the page redirects to a live one.").replace("{n}", c.target_http)}</span></p>`;
    }
    const g = b.gsc || {};
    if (g.seen || g.not_listed) html += `<p class="small sec">${UI.icon("search")} ${g.seen === "page" ? t("Search Console lists this page among your links") : g.seen === "site" ? t("Search Console lists this site among your links, but not this exact page.") : t("Not in your last Search Console upload.")}${g.crawled ? ` · ${t("last crawled")} ${esc(g.crawled)}` : ""}</p>`;
    return html;
  }

  // ---- is the linking page on Google: free signals, then a site: search ----------------------------------------
  function sourceLine(b, server) {
    if (b.status !== "live") return "";
    const si = b.sourceIndex, facts = S.sites.get(b.site) || {};
    const via = si?.via === "Search Console" ? t("Search Console lists the link") : si?.via ? t("a site: search on {tool}").replace("{tool}", esc(si.via)) : "";
    const when = si?.at ? ` · ${esc(si.at)}` : "";
    if (!si) {
      if (!server) return "";
      return `<p class="small sec">${UI.icon("search")} ${facts.site_search ? t("Whether Google has the linking page is searched on the next check.") : t("Connect a rankings search tool, such as SerpApi, to check whether Google has the linking page. Only free searches are used.")}</p>`;
    }
    if (si.state === "indexed") return `<p class="small sec">${UI.icon("circle-check")} ${t("The linking page is on Google")}: ${via}${when}</p>`;
    if (si.state === "not_found") return `<p class="small sec">${UI.icon("search")} ${t("Not found on Google yet: a site: search didn't show the linking page. Search results are incomplete, so it's searched again in a few days, and only a second miss marks it not indexed.")}${when}</p>`;
    if (si.state === "not_indexed") return `<p class="note warn">${UI.icon("triangle-alert")}<span>${t("Google doesn't have the linking page: two site: searches in a row didn't find it. Ask the website to get it indexed, or the link passes nothing.")}${when}</span></p>`;
    return ""; // not_indexable: the reasons above already say why
  }

  // ---- filters, By website, anchor types and site traffic, in the Done table ------------------------------------
  const domainOf = (b) => b.domain || window.BacklinkCleaner?.rootDomain?.(b.src) || "";
  const isUseful = (b) => b.status === "live" && b.check?.verdict === "counts";
  const isUseless = (b) => b.status === "live" && (b.check?.verdict === "weak" || b.check?.verdict === "none");
  const notIndexed = (b) => b.status === "live" && ["not_indexed", "not_indexable"].includes(b.sourceIndex?.state);
  const sendsVisits = (b) => (b.visits || 0) > 0;
  const FILTERS = { useful: isUseful, visits: sendsVisits, noindex: notIndexed, useless: isUseless, lost: (b) => b.status === "lost" };

  function filterRows(list, filter) {
    const mine = S.domain ? list.filter((b) => domainOf(b) === S.domain) : list;
    return FILTERS[filter] ? mine.filter(FILTERS[filter]) : mine;
  }

  /* The four answers a person asks of their links. A chip shows once it has something, or while it's picked. */
  function filterChips(list, picked) {
    const chip = (key, word, tip) => {
      const n = list.filter(FILTERS[key]).length;
      return n || picked === key ? `<button class="chip" data-bl-filter="${key}" aria-pressed="${picked === key}" data-tip="${esc(t(tip))}">${t(word)}<b>${UI.num(n)}</b></button>` : "";
    };
    const site = S.domain ? `<button class="chip" data-vd-domain="" aria-pressed="true">${t("Site")}: <span class="mono" dir="auto">${esc(S.domain)}</span> ${UI.icon("x")}</button>` : "";
    return site + chip("useful", "Useful", "Live, followed, on a page Google can index") + chip("visits", "Sends visits", "Brought at least one visit")
      + chip("noindex", "Linking page not indexed", "Google doesn't have the page the link is on, or can't index it") + chip("useless", "Not useful", "Nofollow, sponsored, or on a page that passes nothing");
  }

  const byWebsite = () => S.view === "website";
  function viewSwitch() {
    const one = (key, word) => `<button class="tab" role="tab" data-vd-view="${key}" aria-selected="${S.view === key}">${t(word)}</button>`;
    return `<span class="tabs vd-view" role="tablist" aria-label="${esc(t("Show"))}">${one("page", "By page")}${one("website", "By site")}</span>`;
  }

  const ahrefsOn = () => [...S.sites.values()].some((f) => f.ahrefs);
  const trafficHead = () => (ahrefsOn() ? `<th scope="col" class="r" data-tip="${esc(t("Ahrefs' estimate of the linking site's monthly visits from Google"))}">${t("Site traffic")}</th>` : "");
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
    const rank = { counts: 3, weak: 2, none: 1 };
    const list = [...groups].map(([domain, links]) => {
      const best = links.filter((b) => b.status === "live" && b.check?.verdict).sort((x, y) => rank[y.check.verdict] - rank[x.check.verdict])[0];
      const auth = Math.max(...links.map((b) => b.auth || 0)), opr = Math.max(...links.map((b) => b.opr ?? -1));
      const sum = trafficTotals(links), visits = sum.known ? sum.visits : null;
      return { domain, links, best, auth, opr, visits, traffic: links.find((b) => b.siteTraffic !== null && b.siteTraffic !== undefined)?.siteTraffic ?? null, live: links.filter((b) => b.status === "live").length };
    }).sort((x, y) => (y.auth - x.auth) || (y.opr - x.opr) || (y.links.length - x.links.length) || x.domain.localeCompare(y.domain));
    if (!list.length) return COMP.empty(t("No links match"), t("Pick another filter."));
    const found = list.filter((g) => TP.matches(PAGES.sites, g.domain));
    if (!found.length) return COMP.empty(t("No site matches this search"), t("Change the search or pick another filter."));
    const shown = sortRows(found, S.siteSort, { domain: (g) => g.domain, links: (g) => g.links.length, authority: (g) => g.auth || (g.opr >= 0 ? g.opr : null), traffic: (g) => g.traffic, visits: (g) => g.visits });
    const page = TP.view(PAGES.sites, shown);
    const head = (id, label, cls, tip) => sortHead("data-bls-sort", S.siteSort, id, label, cls, tip);
    return `<div class="bl-list"><div class="table-wrap"><table class="data" id="bl-sites"><thead><tr>${head("domain", "Site")}${head("links", "Links", "r")}<th scope="col" data-tip="${esc(t("The best of this site's links, as the last check read it"))}">${t("Best link")}</th>${head("authority", "Authority", "r")}${ahrefsOn() ? head("traffic", "Site traffic", "r", t("Ahrefs' estimate of the linking site's monthly visits from Google")) : ""}${head("visits", "Visits", "r")}</tr></thead><tbody>
      ${page.rows.map((g) => {
        const tag = g.best ? `<span class="tag vd-tag ${VERDICT[g.best.check.verdict][0]}">${t(VERDICT[g.best.check.verdict][1])}</span>` : '<span class="muted">—</span>';
        const authority = g.auth ? UI.dec(g.auth) : g.opr >= 0 ? `${UI.dec(g.opr)} <span class="tag">OPR</span>` : '<span class="muted">—</span>';
        return `<tr><td class="head-cell"><span class="with-logo">${UI.siteLogo ? UI.siteLogo(g.domain) : ""}<span class="logo-text"><button class="kw mono small" data-vd-domain="${esc(g.domain)}" style="text-align:start" data-tip="${esc(t("Show this site's links"))}"><span dir="auto">${esc(g.domain)}</span></button><span class="second">${g.live} ${t("live")}</span></span></span></td>
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
    if (ix.state === "unknown") return t("Google doesn't know this page yet, so the link can't help it rank. Add it to your sitemap or ask for indexing in Search Console.");
    return `${t("Google hasn't indexed this page, so the link can't help it rank yet.")}${ix.coverage ? ` ${t("Google says:")} “${ix.coverage}”` : ""}`;
  }

  function indexBody(b, server) {
    if (b.status !== "live") return "";
    const ix = b.targetIndex, facts = S.sites.get(b.site) || {};
    if (!ix) {
      if (!server) return "";
      if (!facts.index_check) return `<p class="small sec">${t("Connect Search Console for this site and Google is asked whether your target page is indexed.")} <a href="#settings">${t("Data sources")}</a></p>`;
      return `<p class="small sec">${t("Google is asked on the next check. Press Run to ask today.")}</p>`;
    }
    const page = pathOf(ix.url);
    const from = `<p class="small muted vd-from">${t("From Search Console's URL Inspection")}${ix.checked ? `, ${esc(ix.checked)}` : ""}.</p>`;
    if (ix.state === "error") return `<p class="small sec">${UI.icon("triangle-alert")} ${esc(t(ix.error))}</p>${from}`;
    if (ix.state === "indexed") {
      return `<p class="lk-result">${PageLink.html(ix.url, { text: page, cls: "mono small" })}${ix.crawled ? ` · ${t("last crawled")} ${esc(ix.crawled)}` : ""}</p>${from}`;
    }
    const canonical = ix.google_canonical ? `<p class="small sec">${t("Google treats another page as the main version:")} ${PageLink.html(ix.google_canonical, { text: pathOf(ix.google_canonical), cls: "mono" })}</p>` : "";
    const task = UI.taskButton ? UI.taskButton({ title: `${t("Get indexed:")} ${page}`, host: b.site, source: { type: "backlink", label: page, host: b.site, facts: [ix.coverage || t("Not indexed")], link: "#backlinks", key: `index|${b.site}|${page}` } }, { label: "Task" }) : "";
    return `<p class="lk-result">${PageLink.html(ix.url, { text: page, cls: "mono small" })}</p>
      <p class="note warn">${UI.icon("triangle-alert")}<span>${esc(indexWhy(ix))}</span></p>${canonical}<div style="margin:6px 0">${task}</div>${from}`;
  }

  /* Below the link check: the one thing a person decides about a bad link. */
  function spamBody(b, server) {
    if (!server || !b.serverId) return "";
    return `<p class="small sec vd-spam">${looksSpammy(b) ? `${t("This page looks like spam: it has many outbound links or a high spam score.")} ` : ""}${t("Mark a link you can't get removed and that could look paid or spammy. It goes in the disavow file.")}</p>
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
    if (e.state === "waiting") return qRow("effect", label, quiet("Not ready yet"), `<p class="small sec">${t("The days after the link aren't all in Search Console yet, so there's nothing fair to compare.")} ${t("Ready on")} ${esc(UI.fmtDateOnly ? UI.fmtDateOnly(e.ready_on) : e.ready_on)}.</p>`); // F11
    if (e.state !== "ok") return e.state === "no_date" ? qRow("effect", label, '<span class="muted">—</span>', `<p class="small sec">${t(e.note)}</p>`) : "";
    const pct = (v) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${UI.num(v)}%`);
    const unit = UI.state.lang === "fr" ? "j" : "d";
    const line = (word, value) => `<tr><td class="sec">${t(word)}</td><td class="tabular">${value}</td></tr>`;
    return qRow("effect", label, `<span class="tabular">${UI.num(e.before.clicks)} → ${UI.num(e.after.clicks)}</span> ${t("clicks")}`, `<p class="small sec">${t("Clicks to the target page")} · ${e.days} ${unit} ${t("before")} / ${t("after")}</p>
      <table class="mini"><tbody>${line("This page", pct(e.page_change))}${line("The whole site", pct(e.site_change))}${e.after.position ? line("Position", `${UI.dec(e.before.position ?? "—")} → ${UI.dec(e.after.position)}`) : ""}</tbody></table>
      <p class="small muted vd-from">${t("From Search Console. Timing only: this does not prove the link caused the change.")}</p>`);
  }

  async function toggleDisavow(button) {
    const id = Number(button.dataset.vdDisavow), on = !button.dataset.on;
    button.disabled = true;
    try { await COMP.api("POST", `backlinks/${id}/disavow`, { disavow: on }); } catch (err) { UI.toast(t(err.message), { kind: "crit" }); button.disabled = false; return; }
    [...(window.BACKLINKS || []), ...(window.FOUND_LINKS || [])].forEach((b) => { if (b.serverId === id) b.disavow = on; });
    UI.toast(t(on ? "Marked as spam" : "No longer marked as spam"), { kind: "info" });
    UI.closePanel?.({ keep: false });
    UI.render();
  }

  // ---- Found but never logged ------------------------------------------------------------------------
  function foundTools(siteHost) {
    const server = H.server?.();
    const marked = [...(window.BACKLINKS || []), ...(window.FOUND_LINKS || [])].filter((b) => b.disavow && (!siteHost || b.site === siteHost)).length;
    const id = siteIdOf(siteHost);
    const disavow = server && marked
      ? (id ? `<a class="btn btn-small" href="api/backlinks/disavow.txt?site_id=${id}" download data-tip="${esc(t("Google says most sites never need one. Upload it in Search Console only for spam links you can't get removed."))}">${UI.icon("download")}${t("Download disavow file")} <span class="muted">${UI.num(marked)}</span></a>` : `<span class="small sec">${t("Pick a site to download its disavow file.")}</span>`)
      : "";
    return `<button class="btn btn-small" id="gsc-open">${UI.icon("search")}${t("Import from Search Console")}</button>${disavow}`;
  }

  function foundButton(f) {
    if (!H.server?.() || !f.serverId) return "";
    return ` <button class="icon-btn" style="width:28px;height:28px;vertical-align:middle" data-vd-disavow="${f.serverId}" data-on="${f.disavow ? "1" : ""}" aria-label="${esc(t(f.disavow ? "Not spam" : "Mark as spam"))}" data-tip="${esc(t(f.disavow ? "Not spam" : "Mark as spam"))}">${UI.icon(f.disavow ? "check" : "ban")}</button>`;
  }

  function foundSeen(f) {
    return `${esc(f.seen)}${f.crawled ? ` <span class="second">${t("last crawled")} ${esc(f.crawled)}</span>` : ` <span class="second">${t("first seen")} ${esc(f.first)}</span>`}`;
  }

  // ---- Search Console upload ---------------------------------------------------------------------------
  function openGsc(opener) {
    const sites = H.server?.() ? H.sites() : (window.SITES || []).map((s) => ({ id: s.id, host: s.host }));
    const host = pickedHost();
    const dlg = UI.$("#dlg");
    dlg.classList.remove("wide");
    UI.setHTML(dlg, `<div class="dlg-head"><h2 id="dlg-title">${t("Import from Search Console")}</h2><button class="icon-btn" data-close-dlg aria-label="${t("Close")}">${UI.icon("x")}</button></div>
      <div class="dlg-body">
        <p class="note">${UI.icon("info")}<span>${t("Search Console doesn't share its links with other apps, so download them once and upload the file here. About a minute per site.")}</span></p>
        <ol class="gsc-steps">
          <li>${t("In Search Console, open Links in the menu on the left.")}</li>
          <li>${t("Click Export external links at the top right, choose Latest links, then Download CSV.")}</li>
          <li>${t("Upload that file here. Top linking sites and Top linked pages exports work too.")}</li>
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
      if (a.kinds.includes("latest")) lines.push(`${UI.num(a.added)} ${t("new links in Found but never logged")}`, `${UI.num(a.seen)} ${t("logged links Google sees")}`);
      if (a.kinds.includes("sites")) lines.push(`${UI.num(a.domains)} ${t("linking sites")}`);
      if (a.kinds.includes("pages")) lines.push(`${UI.num(a.pages)} ${t("of your pages with links. Each is read once a month for Reclaim.")}`);
      if (a.skipped) lines.push(`${UI.num(a.skipped)} ${t("rows skipped: your own pages or the same page twice")}`);
      UI.setHTML(box, `<div class="note good">${UI.icon("circle-check")}<span>${lines.map(esc).join("<br>")}</span></div>`);
      S.reclaim.clear();
      await H.reload?.();
    } catch (err) {
      UI.setHTML(box, `<div class="error" role="alert">${UI.icon("octagon-alert")}<span>${esc(t(err.message))}</span></div>`);
    }
    button.disabled = false;
    UI.setHTML(button, `${UI.icon("list-plus")}${t("Upload another file")}`);
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
    if (!list.length) return COMP.empty(t("Nothing to reclaim"), t("Pages of yours that are gone but still have links show here."));
    const found = list.filter((p) => TP.matches(PAGES.reclaim, p.path, p.page, p.site, ...(p.domains || [])));
    const shown = sortRows(found, S.rcSort, { page: (p) => p.path || p.page, http: (p) => Number(p.http) || null, sites: (p) => p.sites || p.logged_links || 0 });
    const page = TP.view(PAGES.reclaim, shown);
    const head = (id, label, cls) => sortHead("data-rc-sort", S.rcSort, id, label, cls);
    // The search shows once the list is long enough to need it, or while it holds something.
    const search = list.length > 10 || TP.state(PAGES.reclaim).q ? `<div class="chips bl-search-line">${TP.search(PAGES.reclaim, t("Search pages or linking sites"))}</div>` : "";
    return `<p class="note">${UI.icon("info")}<span>${t("Other sites link to these pages of yours, but the pages are gone. Redirect each one to the closest live page and the links count again.")}</span></p>
      ${search}
      ${found.length ? `<div class="bl-list"><div class="table-wrap"><table class="data" id="rc-table"><thead><tr>${head("page", "Your page")}${head("http", "Answers")}${head("sites", "Sites linking", "r")}<th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead><tbody>
      ${page.rows.map((p) => `<tr style="cursor:default"><td class="head-cell mono small url-cell" data-tip="${esc(p.page)}">${PageLink.html(p.page || p.path, { text: p.path, host: p.site, title: "" })}${UI.state.site === "all" ? `<span class="second">${t("For")} ${esc(p.site)}</span>` : ""}${p.domains.length ? `<span class="second">${esc(p.domains.slice(0, 3).join(", "))}${p.domains.length > 3 ? "…" : ""}</span>` : ""}</td>
        <td data-label="${t("Answers")}">${UI.status("serious", String(p.http))}</td>
        <td class="r" data-label="${t("Sites linking")}">${UI.num(p.sites || p.logged_links)}${p.gsc_links ? `<span class="second">${UI.num(p.gsc_links)} ${t("links")}</span>` : ""}</td>
        <td class="r nowrap">${window.UI.taskButton({ title: `${t("Redirect")} ${p.path} ${t("to a live page")}`, host: p.site, source: { type: "backlink", label: p.path, host: p.site, facts: [`${p.http}`, `${p.sites || p.logged_links} ${t("sites linking")}`], link: "#backlinks", key: `reclaim|${p.site}|${p.path}` } }, { label: "Task" })}${p.gsc_id ? ` <button class="btn btn-small" data-rc-dismiss="${p.gsc_id}">${t("Dismiss")}</button>` : ""}</td></tr>`).join("")}
      </tbody></table></div>
      ${TP.footer(PAGES.reclaim, page, { noun: t("pages") })}</div>` : COMP.empty(t("No page matches this search"), t("Change the search to see more pages."))}`;
  }

  async function dismissReclaim(button) {
    button.disabled = true;
    try { await COMP.api("POST", `backlinks/reclaim/${button.dataset.rcDismiss}/dismiss`, {}); } catch (err) { UI.toast(t(err.message), { kind: "crit" }); button.disabled = false; return; }
    S.reclaim.clear();
    UI.render();
  }

  // ---- budget, in the Mediators tab ------------------------------------------------------------------------
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
    const edit = `<button class="btn btn-small" data-vd-budget="${id}">${UI.icon("pencil")}${t(got ? "Budget" : "Set a monthly budget")}</button>`;
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
    UI.openPanel(`${UI.panelHead(t("Monthly budget"), t("For buying links on this site, in one currency"))}
      <form class="panel-body" id="vd-budget-form" data-id="${id}" novalidate>
        <div class="field-row"><label class="field"><span>${t("Amount")}</span><input class="input tabular" id="vd-amount" type="number" min="0" step="1" value="${esc(got.amount ?? "")}" data-autofocus></label>
        <label class="field"><span>${t("Currency")}</span><select class="select" id="vd-currency" style="width:100%">${CURRENCIES.map((c) => `<option ${c === (got.currency || "USD") ? "selected" : ""}>${c}</option>`).join("")}</select></label></div>
        <p class="help">${t("Leave the amount empty to remove the budget. Only prices in this currency are added up.")}</p><div id="vd-budget-err"></div>
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
    UI.setHTML(box, same ? `<p class="note warn">${UI.icon("copy")}<span>${t("This website already links to {site}: {n}. Another link from the same website usually adds much less than a link from a new one.").replace("{site}", esc(site)).replace("{n}", same === 1 ? t("1 link") : `${UI.num(same)} ${t("links")}`)}</span></p>` : "");
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
    if (earlier) return { lang: earlier.check.page_lang.slice(0, 2), why: t("read on an earlier check of this site") };
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
    UI.setHTML(box, differs ? `<p class="note">${UI.icon("info")}<span>${t("This page looks to be in {a} ({why}), and {site} is in {b}. A link from another language still counts, but one from a page in the same language usually helps more. The first check reads the page and says for sure.").replace("{a}", esc(theirs.lang.toUpperCase())).replace("{why}", esc(theirs.why)).replace("{site}", esc(site)).replace("{b}", esc(mine.toUpperCase()))}</span></p>` : "");
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

  function bind() {
    document.addEventListener("click", (e) => {
      const hit = (sel) => e.target.closest?.(sel);
      let el;
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
    init(ui, helpers) { UI = ui; H = helpers; bind(); sample(); TP.on(PAGES.sites, () => UI.render()); TP.on(PAGES.reclaim, () => UI.render()); },
    noteSite: (host, facts) => { if (host && facts) S.sites.set(host, facts); },
    filterRows, filterChips, viewSwitch, trafficTotals, byWebsite, websiteTable, searchBox, resetPages, sortRows, sortHead, nextSort, PAGES, trafficHead, trafficCell, anchorTag, anchorWord, anchorOptions,
    badge, liveNote, authorityCell, panelBlocks, repaint, foundTools, foundButton, foundSeen, reclaimBody, reclaimCount, budgetBar, duplicateNote,
    forget: () => { S.reclaim.clear(); S.budgets.clear(); S.effects.clear(); },
  };

  const fr = {
    "Counts": "Compte", "Weak": "Faible", "Doesn't count": "Ne compte pas", "Spam": "Spam", "Google sees it": "Vu par Google", "Google sees the site": "Site vu par Google", "Not listed by Google yet": "Pas encore listé par Google",
    "Google can see this page and the link passes value.": "Google peut voir cette page et le lien transmet de la valeur.",
    "Search Console lists this page among your links": "Search Console liste cette page parmi vos liens", "last crawled": "dernière exploration",
    "Search Console lists this site among your links, but not this exact page.": "Search Console liste ce site parmi vos liens, mais pas cette page précise.",
    "Placed more than 60 days before your last Search Console upload, and not in it. Its list is a sample, so this is only a hint.": "Placé plus de 60 jours avant votre dernier import Search Console, et absent de celui-ci. Sa liste n'est qu'un échantillon : ce n'est qu'un indice.",
    "Marked as spam: it's in the disavow file.": "Marqué comme spam : il est dans le fichier de désaveu.",
    "Read on the last check: followed, on a page Google can index.": "Lu au dernier contrôle : suivi, sur une page que Google peut indexer.", "counts for Google": "compte pour Google", "count for Google": "comptent pour Google",
    "Open PageRank, 0 to 10. Not the same scale as DA.": "Open PageRank, de 0 à 10. Pas la même échelle que le DA.",
    "The page is set to noindex, so Google drops the page and the link with it.": "La page est en noindex : Google l'écarte, et le lien avec.",
    "The site's robots.txt stops Google from reading the page.": "Le robots.txt du site empêche Google de lire la page.",
    "The page tells Google not to follow any of its links.": "La page demande à Google de ne suivre aucun de ses liens.",
    "Marked nofollow: Google takes it as a hint and usually passes no ranking value.": "Marqué nofollow : Google le prend comme une indication et ne transmet en général aucune valeur de classement.",
    "Marked sponsored: right for a paid link, but it passes little or no ranking value.": "Marqué sponsored : normal pour un lien payé, mais il transmet peu ou pas de valeur de classement.",
    "Marked ugc (user content): it passes little or no ranking value.": "Marqué ugc (contenu d'utilisateurs) : il transmet peu ou pas de valeur de classement.",
    "The page names another page as its main version, so Google may count that one instead.": "La page désigne une autre page comme version principale : Google peut compter celle-là à la place.",
    "The page links to more than 100 other sites, which looks like a link list.": "La page pointe vers plus de 100 autres sites, ce qui ressemble à une liste de liens.",
    "Does Google count it?": "Google le compte-t-il ?",
    "Is the link on the page?": "Le lien est-il sur la page ?", "Working": "Ça fonctionne", "The link is live and Google counts it.": "Le lien est en ligne et Google le compte.", "Weak link": "Lien faible", "Google doesn't count it": "Google ne le compte pas",
    "Not placed yet": "Pas encore placé", "Your page is gone": "Votre page n'existe plus", "Not found on the last check": "Introuvable au dernier contrôle", "Couldn't check it": "Contrôle impossible", "It's in the disavow file.": "Il est dans le fichier de désaveu.",
    "The page no longer exists.": "La page n'existe plus.", "The link is no longer on the page.": "Le lien n'est plus sur la page.", "Ask the website to get it indexed, or the link passes nothing.": "Demandez au site de la faire indexer, sinon le lien ne transmet rien.",
    "Not checked": "Non contrôlé", "Not ready yet": "Pas encore prêt", "Looks like spam": "Ressemble à du spam", "The whole site": "Tout le site", "visit": "visite", "visits": "visites", "lead": "prospect", "leads": "prospects", "clicks": "clics",
    "The linking page is in {a} and your page is in {b}. Links from pages in the same language and on the same topic usually help more.": "La page qui fait le lien est en {a} et votre page en {b}. Les liens venant de pages de même langue et de même sujet aident en général davantage.",
    "Your target page answers {n}, so this link is wasted until the page redirects to a live one.": "Votre page cible répond {n} : ce lien est perdu tant qu'elle ne redirige pas vers une page en ligne.",
    "Not in your last Search Console upload.": "Absent de votre dernier import Search Console.",
    "This page looks like spam: it has many outbound links or a high spam score.": "Cette page ressemble à du spam : beaucoup de liens sortants ou un score de spam élevé.",
    "Mark a link you can't get removed and that could look paid or spammy. It goes in the disavow file.": "Marquez un lien que vous ne pouvez pas faire retirer et qui pourrait passer pour payé ou spam. Il ira dans le fichier de désaveu.",
    "Mark as spam": "Marquer comme spam", "Not spam": "Pas du spam", "Marked as spam": "Marqué comme spam", "No longer marked as spam": "N'est plus marqué comme spam",
    "The days after the link aren't all in Search Console yet, so there's nothing fair to compare.": "Les jours qui suivent le lien ne sont pas encore tous dans Search Console : rien de juste à comparer pour l'instant.", "Ready on": "Prêt le",
    "Before and after": "Avant et après", "Correlation, not proof": "Corrélation, pas preuve", "Clicks to the target page": "Clics vers la page cible", "before": "avant", "after": "après", "This page": "Cette page", "the whole site": "tout le site", "position": "position",
    "From Search Console. Timing only: this does not prove the link caused the change.": "Depuis Search Console. Simple coïncidence de dates : cela ne prouve pas que le lien a causé le changement.",
    "It needs a target page and a date placed.": "Il faut une page cible et une date de mise en ligne.", "The date placed isn't written as YYYY-MM-DD, so it can't be compared.": "La date de mise en ligne n'est pas au format AAAA-MM-JJ : la comparaison est impossible.",
    "Google says most sites never need one. Upload it in Search Console only for spam links you can't get removed.": "Google indique que la plupart des sites n'en ont jamais besoin. Importez-le dans Search Console seulement pour des liens spam impossibles à faire retirer.",
    "Download disavow file": "Télécharger le fichier de désaveu", "Pick a site to download its disavow file.": "Choisissez un site pour télécharger son fichier de désaveu.",
    "Import from Search Console": "Importer depuis Search Console",
    "Search Console doesn't share its links with other apps, so download them once and upload the file here. About a minute per site.": "Search Console ne partage pas ses liens avec d'autres applications : téléchargez-les une fois et importez le fichier ici. Environ une minute par site.",
    "In Search Console, open Links in the menu on the left.": "Dans Search Console, ouvrez Liens dans le menu de gauche.",
    "Click Export external links at the top right, choose Latest links, then Download CSV.": "Cliquez sur Exporter les liens externes en haut à droite, choisissez Derniers liens, puis Télécharger au format CSV.",
    "Upload that file here. Top linking sites and Top linked pages exports work too.": "Importez ce fichier ici. Les exports Principaux sites de liens et Pages les plus liées fonctionnent aussi.",
    "Choose the file Search Console downloaded.": "Choisissez le fichier téléchargé depuis Search Console.", "Needs the running app": "Nécessite l'application en marche", "Uploading…": "Import en cours…", "Upload": "Importer", "Upload another file": "Importer un autre fichier",
    "new links in Found but never logged": "nouveaux liens dans Trouvés mais jamais saisis", "logged links Google sees": "liens saisis vus par Google", "linking sites": "sites qui font des liens",
    "of your pages with links. Each is read once a month for Reclaim.": "de vos pages ont des liens. Chacune est lue une fois par mois pour À récupérer.", "rows skipped: your own pages or the same page twice": "lignes ignorées : vos propres pages, ou la même page deux fois",
    "That doesn't look like a Search Console Links export. In Search Console open Links, then Export external links, and choose Latest links.": "Ce n'est pas un export Liens de Search Console. Dans Search Console, ouvrez Liens, puis Exporter les liens externes, et choisissez Derniers liens.",
    "Download it from Search Console as CSV, not Excel.": "Téléchargez-le depuis Search Console au format CSV, pas Excel.", "That .zip file has no .csv inside.": "Ce fichier .zip ne contient aucun .csv.", "That .zip file can't be opened.": "Ce fichier .zip ne peut pas être ouvert.",
    "That file is too large. A Search Console export is well under 10 MB.": "Ce fichier est trop volumineux. Un export Search Console fait bien moins de 10 Mo.",
    "Reclaim": "À récupérer", "Nothing to reclaim": "Rien à récupérer", "Pages of yours that are gone but still have links show here.": "Vos pages disparues qui ont encore des liens apparaissent ici.",
    "Other sites link to these pages of yours, but the pages are gone. Redirect each one to the closest live page and the links count again.": "D'autres sites pointent vers ces pages, mais elles n'existent plus. Redirigez chacune vers la page en ligne la plus proche et les liens comptent à nouveau.",
    "Your page": "Votre page", "Answers": "Répond", "Sites linking": "Sites qui font un lien", "sites linking": "sites qui font un lien", "links": "liens", "1 link": "1 lien", "Redirect": "Rediriger", "to a live page": "vers une page en ligne", "Dismiss": "Écarter", "That page isn't in the list.": "Cette page n'est pas dans la liste.",
    "Pick a site to set its monthly budget.": "Choisissez un site pour fixer son budget mensuel.", "Budget": "Budget", "Set a monthly budget": "Fixer un budget mensuel", "This month": "Ce mois-ci", "of": "sur", "per site that counts": "par site qui compte",
    "Monthly budget": "Budget mensuel", "For buying links on this site, in one currency": "Pour l'achat de liens sur ce site, dans une seule devise", "Amount": "Montant", "Currency": "Devise",
    "Leave the amount empty to remove the budget. Only prices in this currency are added up.": "Laissez le montant vide pour supprimer le budget. Seuls les prix dans cette devise sont additionnés.",
    "The budget must be a number.": "Le budget doit être un nombre.", "Choose one of USD, EUR, AED, GBP.": "Choisissez USD, EUR, AED ou GBP.",
    "This website already links to {site}: {n}. Another link from the same website usually adds much less than a link from a new one.": "Ce site pointe déjà vers {site} : {n}. Un lien de plus depuis le même site apporte en général bien moins qu'un lien d'un nouveau site.",
    "Say whether to mark this link as spam.": "Indiquez si ce lien doit être marqué comme spam.",
    "Is your page in Google?": "Votre page est-elle dans Google ?", "Indexed": "Indexée", "Not indexed": "Non indexée", "Unknown to Google": "Inconnue de Google", "Your page isn't indexed": "Votre page n'est pas indexée",
    "Google hasn't indexed this page, so the link can't help it rank yet.": "Google n'a pas indexé cette page : le lien ne peut pas encore l'aider à se classer.", "Google says:": "Google indique :",
    "Google doesn't know this page yet, so the link can't help it rank. Add it to your sitemap or ask for indexing in Search Console.": "Google ne connaît pas encore cette page : le lien ne peut pas l'aider à se classer. Ajoutez-la à votre sitemap ou demandez son indexation dans Search Console.",
    "Google treats another page as the main version:": "Google considère une autre page comme version principale :", "Get indexed:": "Faire indexer :",
    "From Search Console's URL Inspection": "Depuis l'inspection d'URL de Search Console",
    "Connect Search Console for this site and Google is asked whether your target page is indexed.": "Connectez Search Console pour ce site, et Google sera interrogé pour savoir si votre page cible est indexée.", "Data sources": "Sources de données",
    "Google is asked on the next check. Press Run to ask today.": "Google sera interrogé au prochain contrôle. Cliquez sur Lancer pour le faire aujourd'hui.",
    "This page isn't in the site's Search Console property, so Google won't inspect it.": "Cette page n'est pas dans la propriété Search Console du site : Google ne l'inspectera pas.",
    "This page looks to be in {a} ({why}), and {site} is in {b}. A link from another language still counts, but one from a page in the same language usually helps more. The first check reads the page and says for sure.": "Cette page semble être en {a} ({why}), et {site} est en {b}. Un lien depuis une autre langue compte quand même, mais un lien depuis une page de même langue aide en général davantage. Le premier contrôle lit la page et le confirme.",
    "Google doesn't have the linking page: two site: searches in a row didn't find it. A page Google doesn't have passes nothing.": "Google n'a pas la page qui fait le lien : deux recherches site: de suite ne l'ont pas trouvée. Une page absente de Google ne transmet rien.",
    "Linking page not indexed": "Page source non indexée", "Search Console lists the link": "Search Console liste le lien", "a site: search on {tool}": "une recherche site: sur {tool}",
    "Whether Google has the linking page is searched on the next check.": "Le prochain contrôle cherchera si Google a la page qui fait le lien.",
    "Connect a rankings search tool, such as SerpApi, to check whether Google has the linking page. Only free searches are used.": "Connectez un outil de recherche des positions, comme SerpApi, pour vérifier si Google a la page qui fait le lien. Seules les recherches gratuites sont utilisées.",
    "The linking page is on Google": "La page qui fait le lien est dans Google",
    "Not found on Google yet: a site: search didn't show the linking page. Search results are incomplete, so it's searched again in a few days, and only a second miss marks it not indexed.": "Pas encore trouvée dans Google : une recherche site: n'a pas montré la page qui fait le lien. Les résultats sont incomplets : elle est recherchée à nouveau dans quelques jours, et seul un second échec la marque comme non indexée.",
    "Google doesn't have the linking page: two site: searches in a row didn't find it. Ask the website to get it indexed, or the link passes nothing.": "Google n'a pas la page qui fait le lien : deux recherches site: de suite ne l'ont pas trouvée. Demandez au site de la faire indexer, sinon le lien ne transmet rien.",
    "Useful": "Liens utiles", "Sends visits": "Envoient des visites", "Not useful": "Liens non utiles", "Site": "Site", "Show": "Afficher", "By page": "Par page", "By site": "Par site",
    "Live, followed, on a page Google can index": "En ligne, suivi, sur une page que Google peut indexer", "Brought at least one visit": "A apporté au moins une visite",
    "Google doesn't have the page the link is on, or can't index it": "Google n'a pas la page qui porte le lien, ou ne peut pas l'indexer", "Nofollow, sponsored, or on a page that passes nothing": "Nofollow, sponsored, ou sur une page qui ne transmet rien",
    "Site traffic": "Trafic du site", "Ahrefs' estimate of the linking site's monthly visits from Google": "Estimation Ahrefs des visites mensuelles venant de Google sur le site qui fait le lien",
    "Brand": "Marque", "Bare URL": "URL nue", "Exact keyword": "Mot-clé exact", "Partial keyword": "Mot-clé partiel", "Generic": "Générique",
    "Automatic": "Automatique", "Set by hand.": "Choisi à la main.", "set by hand": "choisi à la main", "None of the kinds above.": "Aucun des types ci-dessus.",
    "Your brand or domain name. The safest kind of anchor.": "Votre marque ou votre nom de domaine. Le type d'ancre le plus sûr.",
    "The address itself, such as www.example.com. Safe and natural.": "L'adresse elle-même, comme www.example.com. Sûr et naturel.",
    "Exactly one of your tracked keywords. Helps the most, but too many look bought.": "Exactement un de vos mots-clés suivis. Aide le plus, mais en excès cela paraît acheté.",
    "Holds one of your tracked keywords among other words.": "Contient un de vos mots-clés suivis parmi d'autres mots.",
    "Words like click here or read more. Natural, but tell Google little.": "Des mots comme cliquez ici ou en savoir plus. Naturel, mais cela dit peu de choses à Google.",
    "No links match": "Aucun lien ne correspond", "Pick another filter.": "Choisissez un autre filtre.", "Links": "Liens", "live": "en ligne", "Best link": "Meilleur lien", "The best of this site's links, as the last check read it": "Le meilleur des liens de ce site, d'après le dernier contrôle", "Show this site's links": "Voir les liens de ce site",
    "Monthly Google traffic of each site that links to you": "Trafic Google mensuel de chaque site qui pointe vers vous", "Paid": "Payant", "About 50 API units per site a month": "Environ 50 unités d'API par site et par mois",
    "Off until you paste a key. The Site traffic column on Backlinks only shows while it's connected. At most 200 sites a month, about 10,000 units.": "Désactivé tant que vous ne collez pas de clé. La colonne Trafic du site des Backlinks n'apparaît que lorsqu'il est connecté. Au plus 200 sites par mois, environ 10 000 unités.",
    "Check your plan": "Vérifiez votre forfait", "The Ahrefs API needs a plan with API units. Your plan page says how many you have.": "L'API Ahrefs nécessite un forfait avec des unités d'API. La page de votre forfait indique combien vous en avez.", "Open your limits": "Ouvrir vos limites",
    "Create a key": "Créer une clé", "Open API keys in your Ahrefs account, press Create API key, and copy it.": "Ouvrez Clés API dans votre compte Ahrefs, cliquez sur Créer une clé API, puis copiez-la.", "Open API keys": "Ouvrir les clés API",
    "Paste it in the API key box above and press Save. Test uses ahrefs.com, which Ahrefs never charges units for.": "Collez-la dans le champ Clé API ci-dessus et cliquez sur Enregistrer. Le test utilise ahrefs.com, pour lequel Ahrefs ne facture jamais d'unités.",
    "Your Ahrefs plan's units, every month": "Les unités de votre forfait Ahrefs, chaque mois",
    "read on an earlier check of this site": "lu lors d'un contrôle précédent de ce site", "from {x} in the address": "d'après {x} dans l'adresse",
    "Search sites": "Rechercher un site", "Search links": "Rechercher un lien", "Search pages or linking sites": "Rechercher une page ou un site", "sites": "sites", "pages": "pages",
    "No site matches this search": "Aucun site ne correspond à cette recherche", "Change the search or pick another filter.": "Modifiez la recherche ou choisissez un autre filtre.",
    "No page matches this search": "Aucune page ne correspond à cette recherche", "Change the search to see more pages.": "Modifiez la recherche pour voir plus de pages.",
  };
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
