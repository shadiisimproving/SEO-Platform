/* A competitor's profile, built around what an SEO person checks:
     a verdict badge, four number cards, then one tab per question —
     Keywords (where do they beat me?), Pages (which of their pages matter?),
     Activity (how fast are they moving?), Their site (how strong is it, and how do they build pages?).

   comp-list.js owns the header, the keyword table and the timeline. This file draws the rest from
   GET competitors/<id>/insights, and in the plain-file sample builds the same answer from the profile.
   Facts only: it compares, it never recommends. Anything not measured says so, never 0. */
(() => {
  "use strict";
  const COMP = window.COMP;
  /* Questions has its own tab since 2026-11-12 (UI critique): as the third card under Pages, the questions they answer and I
     don't were hard to find. */
  const TABS = [["changes", "Changes", "clock"], ["keywords", "Keywords", "key-round"], ["pages", "Pages", "file-text"], ["questions", "Questions", "message-circle-question"], ["activity", "Activity", "activity"], ["site", "Their site", "globe"], ["map", "Site map", "network"],
    /* 2026-11-23, the owner: Link gaps, Page vs page and the AI watch for this competitor alone, after the tabs above. Each is the
       Competitors tab of the same name, drawn by its own file with this competitor fixed (competitors.js COMP.embed). */
    ["gaps", "Link gaps", "link-2-off"], ["pairs", "Page vs page", "columns-3"], ["ai", "AI", "sparkles"]];
  const EMBEDDED = new Set(["gaps", "pairs", "ai"]);
  if (window.ICONS && !window.ICONS["message-circle-question"]) window.ICONS["message-circle-question"] = '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>';
  const TAB_KEY = "competitor-tab";
  const S = { tab: null, p: null, ins: null, parts: null, buildMore: false, strengthBusy: false, strengthError: "", shownId: null, bestSort: null };
  /* Long lists here have pages and a search, like every long table in the app (table-pages.js, loaded after this file). */
  const BEST = "pt-best", QS = "pt-q", QO = "pt-q-other";
  const TP = () => window.TP;
  const UI = () => window.UI;

  const t = (text) => UI().t(text);
  const esc = (text) => UI().esc(text);
  const icon = (name, cls) => UI().icon(name, cls);
  const num = (n) => UI().num(n);
  const fill = (text, values = {}) => t(text).replace(/\{(\w+)\}/g, (_, key) => (values[key] ?? ""));
  const many = (n, one, other, values = {}) => fill(n === 1 ? one : other, { n: num(n), ...values });
  const dash = `<span class="muted">—</span>`;
  const known = (v) => v !== null && v !== undefined;
  const figure = (v) => (known(v) ? num(v) : dash);
  /* A site with no keyword list, or a list never checked: its keyword figures aren't 0, they're unknown. comp-setup.js knows which. */
  const KW_WHY = { "no-keywords": "No keyword list yet.", unchecked: "Keywords not checked." };
  const kwUnknown = () => COMP.setup?.keywordsUnknown?.() || "";
  const share = (v) => (known(v) ? `${Math.round(v * 100)}%` : dash);
  /* The app doesn't read my own site's pages yet, so a "You" there would be a false 0. Leave "You" out and say why once. */
  const mineRead = (ins) => Boolean(ins?.facts?.my_pages);
  // You and Them column heads: the site's logo and the same colour as the charts, so the two sides can't be mixed up.
  const vsHead = (who, host, label) => `<th scope="col" class="c pt-col-${who}"><span class="pt-col-name">${host ? UI().siteLogo(host, 16) : `<i class="pt-key pt-key-${who}" aria-hidden="true"></i>`}${label || t(who === "you" ? "You" : "Them")}</span></th>`;
  /* Why "You" is missing: my site is being read for the first time, couldn't be read, or waits for tonight's run. */
  const notReadNote = () => {
    const r = S.ins?.facts?.my_reading;
    const words = !r ? "Only their pages: yours are read tonight for the first time."
      : ["queued", "running"].includes(r.status) && !r.read_once ? "Only their pages: yours are being read for the first time."
      : r.status === "blocked" || r.status === "failed" ? "Only their pages: your site couldn't be read. Trying again tonight."
      : "Only their pages: none of yours found to compare.";
    return `<p class="pt-note small">${icon("info")}<span>${esc(t(words))}</span></p>`;
  };

  /* Every competitor opens on Changes (2026-11-20: the list left the Competitors screen for this page). The tab isn't kept
     across competitors or visits. */
  function currentTab() {
    if (!S.tab) S.tab = "changes";
    return TABS.some(([id]) => id === S.tab) ? S.tab : "changes";
  }

  // ---- loading ------------------------------------------------------------------------------
  async function load(p, site) {
    if (!(await COMP.isServer())) {
      const key = `competitors/${p.id}/insights?site_id=${site}`;
      window.COMP_SAMPLE.get[key] ||= sampleInsights(p);
    }
    try {
        const answer = await COMP.api("GET", `competitors/${p.id}/insights?site_id=${site}`);
        // The server has just asked for the icons of the sites linking to them; they arrive a little later.
        if (answer?.links?.top?.some((d) => !window.LOGOS_KNOWN?.has(d.domain))) COMP.refreshLogos?.({ watch: true });
        return answer;
      } catch { return null; }
  }

  // ---- the answer: a verdict badge over the four number cards ----------------------------------
  /* 2026-11-12, UI critique: the sentence ("They beat you on 5 of 6 shared keywords and…") said again what the cards below
     show. On screen now only the verdict, as a badge; the numbers are the cards'. The words still name a task made from here. */
  function answer(p, ins) {
    const c = p.compare || {};
    const bits = [];
    if (c.shared) {
      bits.push(c.they_ahead >= c.i_ahead
        ? fill("They beat you on {they} of {shared} shared keywords", { they: num(c.they_ahead), shared: num(c.shared) })
        : fill("You beat them on {mine} of {shared} shared keywords", { mine: num(c.i_ahead), shared: num(c.shared) }));
    }
    if (c.theirs_only) bits.push(many(c.theirs_only, c.shared ? "and they rank on {n} keyword you don't" : "They rank on {n} keyword you don't", c.shared ? "and they rank on {n} keywords you don't" : "They rank on {n} keywords you don't"));
    let first = bits.join(" ");
    if (first) first += ".";
    const r = ins?.rhythm;
    let second = "";
    if (r?.new_30d) second = r.top_section && r.top_section !== "/" ? many(r.new_30d, "They published {n} page in 30 days, mostly in {section}.", "They published {n} pages in 30 days, mostly in {section}.", { section: r.top_section }) : many(r.new_30d, "They published {n} page in 30 days.", "They published {n} pages in 30 days.");
    else if (r && r.months?.length && p.crawl?.baseline_done) second = t("They published nothing new in 30 days.");
    const off = p.tracking && p.tracking !== "on"; // keyword numbers are switched off for this competitor
    const missing = [];
    if (!off && !c.shared && !c.theirs_only && !kwUnknown()) missing.push(t("No ranking check has seen you both yet.")); // with no keyword list at all, the line above the tabs and the Keywords tab already say so
    if (!ins?.facts?.my_pages) missing.push(t("Your site isn't read yet: no page comparison."));
    const acts = [];
    if (!off && c.theirs_only) acts.push(`<button class="btn btn-small" data-pt-only-them>${icon("key-round")}${esc(many(c.theirs_only, "See the {n} keyword", "See the {n} keywords"))}</button>`);
    // With no check yet, the banner above the tabs says what to do: no second button here that only switches tabs.
    if (first || second) {
      const site = p.site?.host || "";
      acts.push(UI().taskButton({ title: `${p.host}: ${[first, second].filter(Boolean).join(" ")}`.slice(0, 180), host: site, about: COMP.aboutRival(p.id, p.host), source: { type: "competitor", label: p.host, host: site, facts: [first, second].filter(Boolean), link: `#competitors/list/${p.id}`, key: `answer|${p.id}` } }));
    }
    // Status colour only for who ranks higher, always with its icon and word (MASTER.md).
    const verdict = !off && c.shared ? (c.i_ahead === c.they_ahead ? UI().status("info", t("Level")) : c.i_ahead > c.they_ahead ? UI().status("good", t("You're ahead")) : UI().status("warn", t("They're ahead"))) : "";
    // The buttons go on the figures' row (tiles).
    return { acts, html: `<section class="pt-answer" aria-label="${esc(t("Who leads"))}">
      ${verdict ? `<p class="pt-answer-text pt-answer-verdict"><span class="pt-verdict-lab">${esc(t("On shared keywords"))}</span>${verdict}</p>` : ""}
      ${verdict && window.OceanMarket?.on?.() ? window.OceanMarket.vsBar(c.i_ahead || 0, c.they_ahead || 0, p.display || p.host) : ""}
      ${off ? COMP.trackingNote?.(p, { short: true }) ?? "" : ""}
      ${missing.length ? `<p class="pt-answer-missing small sec">${icon("info")}<span>${esc(missing.join(" "))}</span></p>` : ""}
    </section>` };
  }

  /* One line of facts under the name. Only what's known: a fact not measured is left out, never shown as 0. */
  function factsLine(p, ins) {
    const f = ins?.facts || {};
    const out = [];
    if (f.first_capture) out.push(fill("Online since {date}", { date: monthYear(f.first_capture) }));
    if (known(f.da)) out.push(fill("DA {n}", { n: num(f.da) }));
    if (f.cms) out.push(esc(f.cms)); // the page count is in the figures below: said once
    if (f.languages?.length) out.push(f.languages.map((l) => esc(languageName(l))).join(", "));
    return out.length ? `<p class="pt-facts small">${out.join(" · ")}</p>` : "";
  }

  const monthYear = (iso) => { try { return new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString(UI().locale?.() || undefined, { month: "short", year: "numeric", timeZone: "UTC" }); } catch { return String(iso).slice(0, 7); } };
  const languageName = (code) => { try { return new Intl.DisplayNames([UI().state.lang || "en"], { type: "language" }).of(code) || code; } catch { return code; } };

  // ---- the figures ------------------------------------------------------------------------------
  /* One line of small figures under the answer, in the same card. Each says whose it is; a caveat sits on hover.
     Unknown is —. Authority only joins the line once someone has a score; until then the Their site tab says how to get it. */
  function tiles(p, ins, acts = []) {
    const c = p.compare || {}, f = ins?.facts || {};
    const off = p.tracking && p.tracking !== "on";
    /* Four equal number cards (2026-11-12, the owner found the one-line strip of squares, logos and coloured words hard to read):
       one big number, one plain sub line, and whose it is as one small coloured word (COMP.who). A card opens what it counts:
       Shared, Only them and Only you their Keywords choice, Pages the Pages tab. Simpler screens: UI.card; otherwise the same look. */
    const myHost = COMP.site?.()?.host || p.site?.host;
    const theirPages = p.crawl?.status === "blocked" ? null : known(f.pages) ? f.pages : null;
    const kwKnown = !off && !kwUnknown();
    const why = off ? t("Not tracked for keywords.") : t("Keywords not checked.");
    const cards = [
      { id: "shared", label: t("Shared keywords"), value: kwKnown ? c.shared : null, tip: t("Keywords you both rank on."),
        sub: !kwKnown ? esc(why) : c.shared ? esc(fill("They lead {they}, you lead {mine}", { they: num(c.they_ahead || 0), mine: num(c.i_ahead || 0) })) : esc(t("No shared keyword")), go: ["kw", "shared"] },
      { id: "theirs_only", label: COMP.who("them", null, t("Only them")), value: kwKnown ? c.theirs_only : null, tip: t("They rank, you weren't found."), sub: esc(kwKnown ? t("They rank, you don't") : why), go: ["kw", "theirs_only"] },
      { id: "mine_only", label: COMP.who("you", null, t("Only you")), value: kwKnown ? c.mine_only : null, tip: t("You rank, they weren't found."), sub: esc(kwKnown ? t("You rank, they don't") : why), go: ["kw", "mine_only"] },
      { id: "pages", label: t("Pages"), value: theirPages, tip: f.my_pages ? t("Pages found on each site.") : t("Yours are counted once your site is read."),
        sub: esc(f.my_pages ? fill("{mine} yours · {theirs} theirs", { mine: num(f.my_pages), theirs: theirPages === null ? "—" : num(theirPages) }) : theirPages === null ? (p.crawl?.status === "blocked" ? t("Their site blocks bots") : t("Not read yet")) : t("Theirs · yours once read")), go: ["tab", "pages"] },
    ];
    if (known(f.da) || known(f.my_da)) cards.push({ id: "authority", label: t("Authority"), value: known(f.da) ? f.da : null, tip: t("Moz Domain Authority."), sub: esc(known(f.my_da) ? fill("Yours {n}", { n: num(f.my_da) }) : t("Their score; yours not looked up")), go: ["tab", "site"] });
    const simple = UI().simple?.() && UI().card;
    const card = (x) => {
      const attrs = { "data-pt-card": x.id, "data-pt-go-kind": x.go[0], "data-pt-go-to": x.go[1], "title": x.tip };
      if (simple) return UI().card({ id: `pt-${x.id}`, label: `<span class="pt-fig-lab">${x.label}</span>`, value: x.value, sub: x.sub, info: x.tip, def: false, button: true, cls: "pt-card pt-fig", attrs });
      const fig = x.value === null || x.value === undefined ? `<span class="muted">—</span>` : num(x.value);
      return `<button type="button" class="pt-card pt-fig" data-pt-card="${x.id}" data-pt-go-kind="${x.go[0]}" data-pt-go-to="${x.go[1]}" data-tip="${esc(x.tip)}"><span class="pt-card-lab pt-fig-lab">${x.label}</span><span class="pt-card-row"><span class="pt-card-fig tabular">${fig}</span><span class="pt-card-sub">${x.sub}</span></span></button>`;
    };
    return `<section class="pt-strip pt-cards${simple ? " tiles" : ""}" aria-label="${esc(t("How you compare"))}">${cards.map(card).join("")}</section>`;
  }

  // ---- the tabs ------------------------------------------------------------------------------
  function tabBar() {
    const now = currentTab();
    return `<div class="cp-tabs pt-tabs" role="tablist" aria-label="${esc(t("About this competitor"))}">${TABS.map(([id, label, ic]) => `<button class="cp-tab" role="tab" id="pt-tab-${id}" data-pt-tab="${id}" aria-selected="${id === now}" aria-controls="pt-panel" tabindex="${id === now ? 0 : -1}">${icon(ic)}${t(label)}</button>`).join("")}</div>`;
  }

  function panel() {
    const tab = currentTab(), p = S.p, ins = S.ins, parts = S.parts;
    if (EMBEDDED.has(tab)) return embeddedPanel(tab, p);
    COMP.embed = null; // none of the Competitors tabs is shown in here now
    if (tab === "changes") return changesTab(p, parts);
    if (tab === "pages") return pagesTab(p, ins);
    if (tab === "questions") return questionsTab(p, ins);
    if (tab === "activity") return activityTab(p, ins, parts);
    if (tab === "site") return siteTab(p, ins);
    if (tab === "map") return window.SiteMap ? window.SiteMap.block({ competitorId: p.id, host: p.host, mine: { id: typeof COMP.siteId === "number" ? COMP.siteId : p.site?.id ?? null, host: COMP.site?.()?.host || p.site?.host || "" } }) : unavailable(); // site-map.js draws it by itself
    const off = p.tracking && p.tracking !== "on";
    return `<section class="card"><div class="cl-section-body" id="cl-keywords">${off ? COMP.trackingNote?.(p) ?? "" : parts.keywordsBody(p)}</div></section>`;
  }

  /* Link gaps, Page vs page or AI: the Competitors tab's own screen in a box, for this competitor only. Its file draws into the
     box and loads into it (COMP.paintTab / COMP.reloadTab), so its buttons, filters and pages work as they do on their own. */
  function embeddedPanel(id, p) {
    const tab = COMP.tabs?.find((x) => x.id === id);
    if (!tab) return unavailable();
    COMP.embed = { id, competitorId: p.id };
    const ready = tab.loadedFor === COMP.loadKey(tab);
    // Drawn once the box is on the page: its after() (the AI chart, a ticked box, a watch) needs it there.
    queueMicrotask(() => { if (!UI().$("#pt-embed") || !COMP.embedded(id)) return; if (ready) tab.after?.(); else COMP.reloadTab(tab); });
    return `<div class="pt-embed" id="pt-embed" data-pt-embed="${id}">${ready ? tab.body() : COMP.loading()}</div>`;
  }

  // Keywords: small marks beside a keyword, from the same checks. "Not captured" stays silent.
  function keywordMarks(k) {
    const ins = S.ins?.keywords || {};
    const out = [];
    const f = ins.features?.[k.keyword];
    if (f?.snippet === "them") out.push(`<span class="tag pt-mark" data-tip="${esc(t("They hold the featured snippet"))}">${icon("sparkles")}${t("Snippet")}</span>`);
    if (f?.snippet === "me") out.push(`<span class="tag pt-mark pt-mark-you" data-tip="${esc(t("You hold the featured snippet"))}">${icon("sparkles")}${t("Your snippet")}</span>`);
    if (f?.rich?.length) out.push(`<span class="tag pt-mark" data-tip="${esc(f.rich.map((r) => t(RICH[r] || r)).join(", "))}">${icon("circle-dot")}${t("Rich result")}</span>`);
    if (f?.ai) out.push(`<span class="tag pt-mark" data-tip="${esc(t("AI Overview shown"))}">${icon("sparkles")}AI</span>`);
    const pages = ins.cannibal?.[k.keyword];
    if (pages > 1) out.push(`<span class="tag pt-mark" data-tip="${esc(t("Different pages of theirs ranked across checks."))}">${esc(many(pages, "{n} page", "{n} pages"))}</span>`);
    return out.length ? `<span class="pt-marks">${out.join("")}</span>` : "";
  }
  const RICH = { rating: "Star rating", faq: "FAQ", sitelinks: "Sitelinks", video: "Video" };

  // Pages: their strongest pages, their sections, and questions they answer.
  function pagesTab(p, ins) {
    if (!ins) return unavailable();
    const best = ins.best_pages || [];
    const sections = ins.sections || [];
    const bestTable = best.length ? bestPages(p, best) : `<p class="cl-none small sec">${t("None yet: they appear after a ranking check.")}</p>`;
    const showMine = mineRead(ins);
    const sectionTable = sections.length ? sectionsBody(sections, showMine, p.host) : `<p class="cl-none small sec">${t("Sections appear once their pages are read.")}</p>`;
    return `<section class="card"><div class="card-head"><h2>${t("Their strongest pages")}</h2><span class="end small muted">${t("By your keywords they rank for")}</span></div><div class="cl-section-body">${bestTable}</div></section>
      <section class="card"><div class="card-head"><h2>${t("Where their pages are")}</h2><span class="end small muted">${t("By first folder")}</span></div><div class="cl-section-body">${sectionTable}</div></section>`;
  }

  // Questions: the questions their pages answer, one row per page of theirs, mine beside it.
  function questionsTab(p, ins) {
    if (!ins) return unavailable();
    const questions = ins.questions || [];
    const qs = Array.isArray(questions) ? { groups: [], total: 0, related: 0, judged: false } : questions;
    const questionList = qs.groups?.length ? questionsBody(p, qs, mineRead(ins)) : `<p class="cl-none small sec">${t("No questions in their headings yet.")}</p>`;
    const badge = qs.judged && qs.related ? `<span class="tag pt-count-tag tabular">${esc(many(qs.related, "{n} on your topics", "{n} on your topics"))}</span>` : "";
    return `<section class="card"><div class="card-head"><h2>${t("Questions they answer")}</h2>${badge}${COMP.info("From their headings that end in a question mark. Author, tag, category and home pages are left out: their headings are other posts' titles.")}</div><div class="cl-section-body">${questionList}</div></section>`;
  }

  /* Their pages that rank for my keywords, in pages of 25 with a search by title or address. Keywords and Best position
     sort, like Link gaps: a first click puts the best first, a second turns it round, a third goes back to the usual order. */
  const BEST_SORT = { keywords: [(b) => b.keywords, "desc"], position: [(b) => b.best_position, "asc"] };
  function bestPages(p, best) {
    const sort = S.bestSort;
    let rows = best.filter((b) => TP().matches(BEST, b.title, b.url, b.my_title, b.my_url));
    if (sort) { const [get] = BEST_SORT[sort.id]; rows = [...rows].sort((a, b) => (get(a) - get(b)) * (sort.dir === "asc" ? 1 : -1)); }
    const page = TP().view(BEST, rows);
    const head = (id, label) => {
      const on = sort?.id === id;
      return `<th scope="col" class="c" aria-sort="${on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" class="th-btn" data-pt-best-sort="${id}">${t(label)}${on ? icon(sort.dir === "asc" ? "arrow-up" : "arrow-down") : ""}</button></th>`;
    };
    const tools = best.length > 10 ? `<div class="pt-tools">${TP().search(BEST, t("Search pages"))}</div>` : "";
    if (!rows.length) return `${tools}<p class="cl-none small sec">${t("No page matches the search.")}</p>`;
    return `${tools}<div class="cl-scroll"><table class="data cl-table pt-table" id="pt-best"><thead><tr><th scope="col" class="pt-col-them">${COMP.who("them", p.host, t("Their page"))}</th>${head("keywords", "Keywords")}${head("position", "Best position")}<th scope="col" class="pt-col-you">${COMP.who("you", COMP.site?.()?.host || p.site?.host, t("Your page"))}</th></tr></thead><tbody>${page.rows.map((b) => `<tr>
          <td class="head-cell"><span class="cl-cell"><span class="t" dir="auto">${esc(b.title || COMP.shortUrl(b.url))}</span><span class="second">${COMP.link(b.url)}</span></span></td>
          <td class="c tabular" data-label="${esc(t("Keywords"))}">${num(b.keywords)}</td>
          <td class="c" data-label="${esc(t("Best position"))}">${COMP.pos(b.best_position)}</td>
          <td data-label="${esc(t("Your page"))}">${b.my_url ? `<span class="cl-cell"><span class="t" dir="auto">${esc(b.my_title || COMP.shortUrl(b.my_url))}</span><span class="second">${b.pair_id ? `<button class="link-btn" data-cl-pair="${b.pair_id}">${t("Compare")}</button>` : COMP.link(b.my_url)}</span></span>` : `<span class="pt-none">${t("No page")}</span> ${UI().taskButton({ title: fill("Write a page against {url}", { url: COMP.shortUrl(b.url) }), host: p.site?.host, about: COMP.aboutRival(p.id, p.host), source: { type: "competitor", label: p.host, host: p.site?.host, facts: [b.url, many(b.keywords, "{n} keyword", "{n} keywords")], link: `#competitors/list/${p.id}`, key: `best|${p.id}|${b.url}` } }, { label: "Task" })}`}</td>
        </tr>`).join("")}</tbody></table></div>${TP().footer(BEST, page, { noun: t("pages") })}`;
  }

  /* The folders, biggest first. "You" only when my pages are read. "Last change" only when one is known. */
  function sectionsBody(sections, showMine, host) {
    // No sentence over the table ("Most of their pages are in /: 7 of 8"): the first row says it, biggest folder first.
    const lead = "";
    const changes = sections.some((x) => x.last_change);
    // You first, as on every table here. Their page count, New and Last change are all about them, so all three carry their colour.
    const head = `<th scope="col">${t("Folder")}</th>${showMine ? vsHead("you", COMP.site?.()?.host || S.p?.site?.host, t("Your pages")) : ""}${vsHead("them", host, t("Their pages"))}<th scope="col" class="c pt-col-them">${t("New in 90 days")}</th>${changes ? `<th scope="col" class="pt-col-them">${t("Last change")}</th>` : ""}`;
    const rows = sections.map((x) => `<tr>
        <td class="head-cell">${PageLink.html(x.path, { host, cls: "mono", dir: "ltr" })}</td>
        ${showMine ? `<td class="c tabular" data-label="${esc(t("Your pages"))}">${num(x.my_pages || 0)}</td>` : ""}
        <td class="c tabular" data-label="${esc(t("Their pages"))}">${num(x.pages)}</td>
        <td class="c tabular" data-label="${esc(t("New in 90 days"))}">${x.new_90d ? `<b>${num(x.new_90d)}</b>` : `<span class="muted">0</span>`}</td>
        ${changes ? `<td data-label="${esc(t("Last change"))}"><span class="nowrap">${x.last_change ? COMP.ageCell(x.last_change) : dash}</span></td>` : ""}
      </tr>`).join("");
    return `${lead}<div class="cl-scroll"><table class="data cl-table pt-table pt-narrow"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>${showMine ? "" : notReadNote()}`;
  }

  /* One row per page of theirs: the page, the questions it answers, one task for all of them.
     Pages on my topics first; the others stay folded behind one button, so tourist questions don't bury the useful ones. */
  const PAGE_QS = 3; // questions shown per page before "+n more"
  function questionsBody(p, qs, showMine) {
    const host = COMP.site?.()?.host || p.site?.host;
    const related = qs.groups.filter((g) => g.related);
    const others = qs.groups.filter((g) => !g.related);
    const otherCount = others.reduce((n, g) => n + g.questions.length, 0);
    // The answer on screen; when the order changes, or how to use the rows, behind the (i) after it.
    const lead = !qs.judged
      ? `${esc(t("Grouped by the page that answers them."))}${UI().tip("Once Search Console is connected or you add keywords, the ones on your topics come first and the rest are folded away.")}`
      : related.length
        ? `${esc(many(related.length, "{n} page of theirs", "{n} pages of theirs"))}${UI().tip("Each row is one page of theirs: answer its questions on your site in one task.")}`
        : esc(t("None are on your topics."));
    const unread = showMine ? "" : ` ${esc(t("Your pages aren't read yet: some may already be answered."))}`;
    const row = (g) => {
      const open = S.qOpen?.has(g.url);
      const list = open ? g.questions : g.questions.slice(0, PAGE_QS);
      const myAll = g.mine?.questions || [], myList = open ? myAll : myAll.slice(0, PAGE_QS);
      const hidden = g.questions.length - list.length + myAll.length - myList.length;
      const folds = g.questions.length > PAGE_QS || myAll.length > PAGE_QS;
      const picked = S.qPicked?.has(g.url);
      const name = g.title || COMP.shortUrl(g.url);
      const task = UI().taskButton({
        title: g.questions.length === 1 ? fill("Answer \"{q}\" on your site", { q: g.questions[0] }) : fill("Answer {n} questions from {page} on your site", { n: num(g.questions.length), page: COMP.shortUrl(g.url) }),
        host,
        about: COMP.aboutRival(p.id, p.host),
        source: { type: "competitor", label: p.host, host, facts: [...g.questions, g.url], link: `#competitors/list/${p.id}`, key: `questions|${p.id}|${g.url}` },
      }, { label: "Task" });
      return `<li class="pt-qpage${picked ? " is-picked" : ""}">
        <div class="pt-qpage-head"><input type="checkbox" class="chk" data-pt-qpick="${esc(g.url)}" aria-label="${esc(fill("Select {page}", { page: name }))}" ${picked ? "checked" : ""}><span class="cl-cell"><span class="nb-inline"><span class="t" dir="auto">${esc(name)}</span>${COMP.notes?.badge ? COMP.notes.badge(noteWhere(p, g), COMP.shortUrl(g.url)) : ""}</span><span class="second">${COMP.link(g.url)}</span></span><span class="pt-act">${task}</span></div>
        <div class="pt-qcompare">
          <div class="pt-qside"><p class="pt-qside-lab">${COMP.who("them", p.host, t("Their questions"))}</p><ul class="pt-qlist">${list.map((q) => `<li dir="auto">${esc(q)}</li>`).join("")}</ul></div>
          <div class="pt-qside">${mySide(g.mine, myList, showMine, g)}</div>
        </div>
        ${hidden > 0 ? `<button class="link-btn small" data-pt-qpage="${esc(g.url)}">${esc(fill("+{n} more", { n: num(hidden) }))}</button>` : open && folds ? `<button class="link-btn small" data-pt-qpage="${esc(g.url)}">${t("Show fewer")}</button>` : ""}
      </li>`;
    };
    // Pages of 25, like every long list, and one search through their pages and questions for both lists.
    const found = (list) => list.filter((g) => TP().matches(QS, g.title, g.url, ...g.questions));
    const first = qs.judged ? related : qs.groups;
    const hits = found(first), page = TP().view(QS, hits);
    const otherHits = found(others), otherPage = TP().view(QO, otherHits);
    const tools = qs.groups.length > 10 ? `<div class="pt-tools">${TP().search(QS, t("Search pages and questions"))}</div>` : "";
    const noHit = `<p class="cl-none small sec">${t("No page matches the search.")}</p>`;
    const main = hits.length ? `<div class="pt-qmain"><ul class="rows pt-qpages" id="pt-questions">${page.rows.map(row).join("")}</ul>${TP().footer(QS, page, { noun: t("pages") })}</div>` : first.length ? noHit : "";
    const otherBlock = qs.judged && others.length
      ? `<div class="pt-qother">${S.qOthers
          ? `<p class="small sec">${esc(many(otherCount, "{n} question on other topics", "{n} questions on other topics"))} <button class="link-btn small" data-pt-q-others>${t("Hide")}</button></p>${otherHits.length ? `<ul class="rows pt-qpages pt-qpages-other">${otherPage.rows.map(row).join("")}</ul>${TP().footer(QO, otherPage, { noun: t("pages") })}` : noHit}`
          : `<button class="btn btn-small btn-ghost" data-pt-q-others>${esc(many(otherCount, "Show {n} question on other topics", "Show {n} questions on other topics"))}</button>`}</div>`
      : "";
    return `<p class="pt-lead">${lead}${unread}</p>${tools}${main}${otherBlock}<div id="pt-q-selbar">${questionBar()}</div>`;
  }

  /* The right half of a row: my page it's compared with, how it was matched, and the questions it asks. */
  const MATCH = { paired: ["Paired", "You paired these two in Page vs page."], keyword: ["Same keyword", "Both pages rank for the same keyword."], topic: ["Closest topic", "Best guess: main headings share the most words."] };
  function mySide(m, list, showMine, g) {
    const yours = COMP.who("you", COMP.site?.()?.host || S.p?.site?.host, t("Your page"));
    // Change: the owner picks the page of theirs to compare with, saved as a pair that rankings won't replace (2026-11-13).
    const change = `<button type="button" class="link-btn small pt-mine-pick" data-pt-mine-pick="${esc(g.url)}" aria-label="${esc(fill(m ? "Change your page compared with {page}" : "Pick your page compared with {page}", { page: g.title || COMP.shortUrl(g.url) }))}">${t(m ? "Change page" : "Pick a page")}</button>`;
    if (!m) return `<p class="pt-qside-lab">${yours} ${change}</p><p class="small sec">${t(showMine ? "None yet." : "Not read yet")}</p>`;
    const [word, tip] = MATCH[m.how] || MATCH.topic;
    const asks = !m.read ? t("Not read yet") : list.length ? "" : t("No questions.");
    return `<p class="pt-qside-lab">${yours} <span class="tag pt-mark" data-tip="${esc(t(tip))}">${t(word)}</span> ${change}</p>
      <span class="cl-cell"><span class="t" dir="auto">${esc(m.title || COMP.shortUrl(m.url))}</span><span class="second">${COMP.link(m.url)}</span></span>
      ${asks ? `<p class="small sec">${asks}</p>` : `<ul class="pt-qlist pt-qlist-mine">${list.map((q) => `<li dir="auto">${esc(q)}</li>`).join("")}</ul>`}`;
  }

  // ---- ticking rows, and one note on them ---------------------------------------------------------
  const noteWhere = (p, g) => ({ scope: "page", pageUrl: g.url, competitorId: p.id, competitor: p.host, siteId: typeof COMP.siteId === "number" ? COMP.siteId : p.site?.id ?? null });
  const pickedGroups = () => (S.ins?.questions?.groups || []).filter((g) => S.qPicked?.has(g.url));

  function questionBar() {
    const n = pickedGroups().length;
    if (!n) return "";
    return `<div class="selbar cg-selbar" role="region" aria-label="${t("selected")}">
      <b class="cg-sel-count">${num(n)} ${t("selected")}</b>
      <button class="btn btn-main btn-small" data-pt-q-note>${icon("pencil")}${t("Add a note")}</button>
      <button class="icon-btn" data-pt-q-clear aria-label="${t("Clear selection")}" data-tip="${t("Clear selection")}">${icon("x")}</button>
    </div>`;
  }

  /* What's saved under the note: both pages and all their questions, so the note still makes sense once the pages change. */
  function noteContext(g) {
    const bullets = (list) => list.map((q) => `- ${q}`);
    const m = g.mine;
    return [
      fill("Their page: {title}", { title: g.title || COMP.shortUrl(g.url) }), g.url, ...bullets(g.questions), "",
      ...(m ? [fill("Your page: {title}", { title: m.title || COMP.shortUrl(m.url) }), m.url, ...bullets(m.questions)] : [t("Your page: none yet")]),
    ].join("\n");
  }

  function openQuestionNote(opener) {
    const picked = pickedGroups();
    if (!picked.length) return;
    UI().openPanel(`${UI().panelHead(t("Add a note"), esc(many(picked.length, "One note on this page", "One note per page, {n} pages")))}
      <form class="panel-body" id="pt-qn-form" novalidate>
        <label class="field"><span>${t("Your note")}</span><textarea class="input" id="pt-qn-text" rows="5" dir="auto" data-autofocus></textarea></label>
        <div class="field"><span>${t("Saved with it")}</span><pre class="pt-qn-context" dir="auto" tabindex="0">${esc(picked.map(noteContext).join("\n\n———\n\n"))}</pre></div>
        <div id="pt-qn-error"></div>
      </form>
      <div class="panel-foot"><button class="btn btn-main" id="pt-qn-save" data-pt-qn-save>${t("Save note")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener, { key: `pt-qnote|${S.p.id}`, reopen: () => openQuestionNote(opener) });
  }

  async function saveQuestionNote(button) {
    const words = UI().$("#pt-qn-text")?.value.trim() || "", picked = pickedGroups(), total = picked.length;
    button.disabled = true;
    try {
      for (const g of picked) { // one at a time, each unticked once saved, so trying again never writes a note twice
        await COMP.notes.add(noteWhere(S.p, g), `${words ? `${words}\n\n` : ""}${noteContext(g)}`);
        S.qPicked.delete(g.url);
      }
      UI().closePanel({ keep: false });
      repaint();
      COMP.notes.loadAllOnce();
      UI().toast?.(many(total, "Note saved on {n} page.", "Note saved on {n} pages."));
    } catch (err) {
      button.disabled = false;
      UI().setHTML(UI().$("#pt-qn-error"), `<p class="note warn">${icon("triangle-alert")}<span>${esc(err.message || t("The note didn't save. Your text is still here."))}</span></p>`);
    }
  }

  /* A small You/Them table: one row per side (You first, as everywhere), one column per figure. No sentence of numbers
     (UI critique 2026-11-12). A figure nobody measures is —, never 0. */
  function sideTable(label, cols, rows) {
    return `<table class="data pt-side-table" data-tt-off aria-label="${esc(label)}"><thead><tr><th scope="col"><span class="sr">${esc(t("Whose"))}</span></th>${cols.map((c) => `<th scope="col" class="c">${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr class="pt-row-${r.who}"><th scope="row">${COMP.who(r.who, r.host)}</th>${r.cells.map((v, i) => `<td class="c tabular" data-label="${esc(cols[i])}">${v}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }

  // Changes: this competitor's timeline, the first thing its page shows.
  function changesTab(p, parts) {
    return `<section class="card" aria-label="${esc(t("Timeline"))}"><div class="card-head"><h2>${t("What changed")}</h2>${COMP.info("Moves only compare two checks by the same tool and place, so a tool change never shows as a move.")}</div>
        <div class="cl-section-body" id="cl-timeline">${parts.timelineBody(p)}</div></section>`;
  }

  // Activity: how fast they publish and edit, as small You/Them tables and charts.
  function activityTab(p, ins, parts) {
    const r = ins?.rhythm;
    const showMine = mineRead(ins);
    S.showMine = showMine;
    const months = r?.months || [];
    // "Added, 12 months": the new pages the chart below counts, month by month. It showed the pages *edited* (edited_pages,
    // which belongs to "How often they edit"), so it read 0 beside a chart of dozens of new pages (test walk 2026-11-23).
    const total = months.reduce((n, m) => n + (m.theirs || 0), 0);
    const myTotal = showMine ? months.reduce((n, m) => n + (m.mine || 0), 0) : null;
    const myHost = COMP.site?.()?.host || p.site?.host;
    const lead = r && months.length ? sideTable(t("New and removed pages"), [t("Added in 30 days"), t("Removed, 30 days"), t("Added, 12 months"), t("Updated, 12 months")], [
      ...(showMine ? [{ who: "you", host: myHost, cells: [figure(r.my_new_30d), figure(r.my_removed_30d), figure(myTotal), share(r.updated_12m?.mine)] }] : []),
      { who: "them", host: p.host, cells: [figure(r.new_30d), figure(r.removed_30d), figure(total), share(r.updated_12m?.theirs)] },
    ]) : "";
    const busyMonths = months.filter((m) => (m.theirs || 0) + (showMine ? m.mine || 0 : 0) > 0);
    // A chart needs a shape: under three months with pages, the figures are a small You/Them table instead of an empty 12-month axis.
    const chart = !months.length ? `<p class="cl-none small sec">${t("Fills in once their pages are read.")}${UI().tip("A page's date comes from the page itself, the Wayback Machine, or the day the app first saw it.")}</p>`
      : busyMonths.length < 3 ? (busyMonths.length ? `<div class="pt-few-months">${sideTable(t("New pages each month"), busyMonths.map((m) => longMonth(m.month)), [
        ...(showMine ? [{ who: "you", host: myHost, cells: busyMonths.map((m) => num(m.mine || 0)) }] : []),
        { who: "them", host: p.host, cells: busyMonths.map((m) => num(m.theirs || 0)) },
      ])}</div>` : "")
      : monthChart(months, showMine);
    const years = historyBlock(ins);
    const edits = editsCard(r, showMine, p);
    return `<section class="card"><div class="card-head"><h2>${t("How fast they publish")}</h2><span class="end small muted">${t("New pages each month")}${UI().tip("Counted from the dates on their pages.")}</span></div><div class="cl-section-body">${lead}${chart}${showMine || !months.length ? "" : notReadNote()}</div></section>
      ${edits}
      ${years}`;
  }

  /* Edits to pages they already had, per month, beside mine. The app only sees edits from the day it started watching,
     so the months before that are left out instead of shown as zero. */
  function editsCard(r, showMine, p) {
    const all = r?.edits || [];
    const since = r?.edits_since?.theirs;
    const from = since ? since.slice(0, 7) : null;
    const months = from ? all.filter((m) => m.month >= from) : [];
    S.editMonths = months; // the hover label reads the same months the bars were drawn from
    // Different pages edited, from the server: a page edited in two months is still one page (SEO review #11).
    const total = r?.edited_pages?.theirs ?? months.reduce((n, m) => n + (m.theirs || 0), 0);
    const myTotal = showMine ? r?.edited_pages?.mine ?? months.reduce((n, m) => n + (m.mine || 0), 0) : null;
    const now = months[months.length - 1];
    const sinceCol = sinceDay(since);
    const cols = [sinceCol, ...(now && months.length > 1 ? [t("This month")] : [])];
    const row = (who, host, sum, key) => ({ who, host, cells: [num(sum), ...(cols.length > 1 ? [num(now[key] || 0)] : [])] });
    const lead = from ? sideTable(t("Pages edited"), cols, [...(showMine ? [row("you", COMP.site?.()?.host || p?.site?.host, myTotal, "mine")] : []), row("them", p?.host, total, "theirs")]) : "";
    const busy = months.filter((m) => (m.theirs || 0) + (showMine ? m.mine || 0 : 0) > 0);
    const chart = !from ? `<p class="cl-none small sec">${t("Fills in once the app has read their pages twice.")}</p>`
      : !busy.length ? "" : monthChart(months, showMine, "edits");
    return `<section class="card"><div class="card-head"><h2>${t("How often they edit")}</h2><span class="end small muted">${t("Pages edited each month")}${UI().tip("Pages they already had where the app saw a change: title, text, headings and so on. A page counts once, however many things changed. Counted from the day the app started watching.")}</span></div><div class="cl-section-body">${lead}${chart}</div></section>`;
  }
  /* "Since 12 Nov 2026" on the day itself read wrong: today and yesterday say so. */
  const sinceDay = (iso) => {
    const today = new Date(), key = (d) => d.toISOString().slice(0, 10);
    const y = new Date(today); y.setUTCDate(today.getUTCDate() - 1);
    return iso === key(today) ? t("Since today") : iso === key(y) ? t("Since yesterday") : fill("Since {day}", { day: longDay(iso) });
  };
  const longDay = (iso) => { try { return new Date(`${iso}T00:00:00Z`).toLocaleDateString(UI().state.lang || undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); } catch { return iso; } };

  /* Bars drawn in HTML at a fixed height, so the numbers stay the same size on any screen. The key above the chart
     is the facts row, so there's no second legend. A hover label per month, and the same numbers as a short table. */
  function monthChart(months, showMine, series = "months") {
    const max = Math.max(1, ...months.flatMap((m) => [m.theirs || 0, showMine ? m.mine || 0 : 0]));
    const step = niceStep(max), ceil = Math.ceil(max / step) * step;
    const height = (v) => (v ? `max(3px, ${(v / ceil) * 100}%)` : "0");
    const ticks = [];
    for (let v = 0; v <= ceil; v += step) ticks.push(`<span class="pt-tick" style="bottom:${(v / ceil) * 100}%"><span class="tabular">${num(v)}</span></span>`);
    const cols = months.map((m, i) => `<div class="pt-month" data-pt-month="${i}"><div class="pt-pair"><i class="pt-bar-them" style="height:${height(m.theirs)}">${m.theirs ? `<b class="pt-bar-val tabular">${num(m.theirs)}</b>` : ""}</i>${showMine ? `<i class="pt-bar-you" style="height:${height(m.mine)}">${m.mine ? `<b class="pt-bar-val tabular">${num(m.mine)}</b>` : ""}</i>` : ""}</div><span class="pt-mlabel">${esc(shortMonth(m.month))}</span></div>`).join("");
    const label = series === "edits"
      ? (showMine ? t("Edits each month, them against you") : t("Their edits each month"))
      : (showMine ? t("New pages each month, them against you") : t("Their new pages each month"));
    const table = `<details class="pt-as-table"><summary class="small">${t("Show table")}</summary><div class="cl-scroll"><table class="data cl-table pt-narrow"><thead><tr><th scope="col">${t("Month")}</th>${vsHead("them", S.p?.host)}${showMine ? vsHead("you", COMP.site?.()?.host || S.p?.site?.host) : ""}</tr></thead><tbody>${months.map((m) => `<tr><td class="head-cell">${esc(longMonth(m.month))}</td><td class="c tabular">${num(m.theirs || 0)}</td>${showMine ? `<td class="c tabular">${num(m.mine || 0)}</td>` : ""}</tr>`).join("")}</tbody></table></div></details>`;
    const key = showMine ? `<p class="pt-chart-key small sec">${COMP.who("them", S.p?.host)}${COMP.who("you", COMP.site?.()?.host || S.p?.site?.host)}</p>` : "";
    return `${key}<div class="pt-chart-wrap" data-pt-series="${series}"><div class="pt-chart${showMine ? " pt-two" : ""}" role="img" aria-label="${esc(label)}"><div class="pt-plot">${ticks.join("")}<div class="pt-cols">${cols}</div></div></div><div class="pt-tip" hidden></div></div>${table}`;
  }
  const niceStep = (max) => { const raw = max / 4; const mag = 10 ** Math.floor(Math.log10(raw)); const n = raw / mag; return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag); };
  const shortMonth = (ym) => { try { return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(UI().state.lang || undefined, { month: "short", timeZone: "UTC" }); } catch { return ym; } };
  const longMonth = (ym) => { try { return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(UI().state.lang || undefined, { month: "long", year: "numeric", timeZone: "UTC" }); } catch { return ym; } };

  /* Their site's age: the dates as figures, then the pages the archive first saved each year, as columns.
     Where the numbers come from, and why they're lower than the monthly chart's, sits on the info mark. */
  function historyBlock(ins) {
    const f = ins?.facts || {}, h = f.history || {}, years = ins?.rhythm?.by_year || [];
    const fig = (label, value) => `<div class="pt-fig"><span class="pt-fig-lab">${t(label)}</span><span class="pt-fig-val"><b class="tabular">${esc(value)}</b></span></div>`;
    const ok = h.status === "ok" && years.length;
    const figs = [
      f.registered_on ? fig("Registered", monthYear(f.registered_on)) : "",
      f.first_capture ? fig("Online since", monthYear(f.first_capture)) : "",
      ok ? fig("Archived pages", `${num(h.archived_pages || 0)}${h.capped ? "+" : ""}`) : "",
      f.expires_on ? fig("Renews", monthYear(f.expires_on)) : "",
    ].join("");
    const facts = figs ? `<div class="pt-age-figs">${figs}</div>` : "";
    let chart = "";
    if (ok) {
      const max = Math.max(1, ...years.map((x) => x.pages));
      chart = `<p class="pt-age-title">${t("Pages first archived, by year")}</p>
        <ol class="pt-years">${years.map((x) => `<li style="--h:${x.pages / max}"><b class="tabular">${num(x.pages)}</b><i class="pt-key-them" aria-hidden="true"></i><span class="tabular">${esc(String(x.year))}</span></li>`).join("")}</ol>`;
    } else {
      const why = h.status === "failed" ? t("The Wayback Machine didn't answer. Trying again tomorrow.")
        : h.status === "ok" ? t("The Wayback Machine has no copy of this site.")
        : h.message ? t("The Wayback Machine is busy. Trying again in a few minutes.")
        : t("Looking them up in the Wayback Machine…");
      const lookingUp = h.status !== "failed" && h.status !== "ok" && !h.message;
      chart = `<p class="cl-none small sec">${esc(why)}${lookingUp ? UI().tip("It takes a minute or two after a competitor is added, then it's checked again each month.") : ""}</p>`;
    }
    return `<section class="card"><div class="card-head"><h2>${t("How old their site is")}</h2>${COMP.info("From the Wayback Machine and the domain registry. The archive misses pages, so counts are lower than the monthly chart.")}</div><div class="cl-section-body">${facts}${chart}</div></section>`;
  }

  // Their site: authority, who links to them, and how they build pages.
  function siteTab(p, ins) {
    if (!ins) return unavailable();
    const f = ins.facts || {}, l = ins.links || {};
    const row = (label, mine, theirs) => `<tr><th scope="row" class="head-cell">${esc(label)}</th><td class="c tabular pt-col-you" data-label="${esc(t("You"))}">${mine}</td><td class="c tabular pt-col-them" data-label="${esc(t("Them"))}">${theirs}</td></tr>`;
    const authority = strengthBody(p, f, l, row);
    const top = l.top || [];
    // How many link to them and how many of those skip you, said once in a sentence above the list, with the way to act on it.
    const linkCount = [known(l.linking_domains) ? many(l.linking_domains, "{n} website links to them.", "{n} websites link to them.") : "", l.not_to_me ? many(l.not_to_me, "{n} of these doesn't link to you.", "{n} of these don't link to you.") : ""].filter(Boolean).join(" ");
    const linkLine = linkCount ? `<p class="pt-gap-line pt-link-count"><span>${esc(linkCount)}</span>${l.not_to_me ? `<button class="btn btn-small" data-pt-gaps>${icon("link-2")}${t("Open Link gaps")}</button>` : ""}</p>` : "";
    const links = top.length
      ? `${linkLine}<ul class="rows pt-links">${top.slice(0, 10).map((d) => `<li><div class="what"><span class="with-logo">${UI().siteLogo(d.domain, 16)}<span class="logo-text mono" dir="ltr">${esc(d.domain)}</span></span>${d.spam ? ` ${UI().status("warn", t("Likely spam"))}` : d.old ? ` <span class="tag cg-old" data-tip="${esc(t("Domains whose links were last seen more than 6 months before their file. Probably gone."))}">${icon("calendar-days")}${t("Old link")}</span>` : ""}</div><div class="acts small muted tabular">${known(d.authority) ? linkScore(d) : ""}</div></li>`).join("")}</ul>`
      : `<div class="pt-empty-links"><p class="small sec">${esc(t("No linking sites known yet."))}${UI().tip("Upload a CSV of links to {host} from any backlink tool (SEMrush, Ubersuggest, Ahrefs…), or add the ones you know one by one.", { host: p.host })}</p><div class="pt-btns">${linkButtons(true)}</div></div>`;
    const build = (ins.build || []);
    const main = build.filter((b) => !b.more), more = build.filter((b) => b.more);
    const showMine = mineRead(ins);
    const buildRow = (b) => (showMine ? row(t(b.label), value(b, b.mine), value(b, b.theirs)) : `<tr><th scope="row" class="head-cell">${esc(t(b.label))}</th><td class="c tabular pt-col-them" data-label="${esc(t("Them"))}">${value(b, b.theirs)}</td></tr>`);
    const buildTable = build.length
      ? `<table class="data cl-table pt-table pt-vs pt-narrow"><thead><tr><th scope="col">${t("What")}</th>${showMine ? vsHead("you", COMP.site?.()?.host || p.site?.host) : ""}${vsHead("them", p.host)}</tr></thead><tbody>${main.map(buildRow).join("")}${S.buildMore ? more.map(buildRow).join("") : ""}</tbody></table>${showMine ? "" : notReadNote()}
         ${more.length ? `<p class="cl-more"><button class="btn btn-small" data-pt-build-more aria-expanded="${S.buildMore}">${t(S.buildMore ? "Fewer details" : "More details")}</button></p>` : ""}`
      : `<p class="cl-none small sec">${t("Facts appear once their pages are read.")}</p>`;
    return `<div class="pt-grid"><section class="card"><div class="card-head"><h2>${t("How strong they are")}</h2></div><div class="cl-section-body"><div class="cl-scroll">${authority}</div></div></section>
      <section class="card"><div class="card-head"><h2>${t("Who links to them")}</h2>${top.length ? `<span class="end pt-btns">${linkButtons(false)}</span>` : ""}</div><div class="cl-section-body">${links}</div></section></div>
      <section class="card"><div class="card-head"><h2>${t("How they build pages")}</h2>${COMP.info("Facts read from the pages, not advice")}</div><div class="cl-section-body"><div class="cl-scroll">${buildTable}</div></div></section>`;
  }

  /* Cloudflare gives a bucket such as ">200000": the words say what it means, the rank compares two sites (smaller is more popular). */
  const popularityRank = (v) => { if (/not ranked/i.test(v)) return Infinity; const m = String(v).match(/\d[\d,]*/); if (!m) return NaN; const n = Number(m[0].replace(/,/g, "")); return String(v).trim().startsWith(">") ? n + 1 : n; };
  function popularityWords(v) {
    const m = String(v).match(/\d[\d,]*/);
    if (!m) return t(String(v));
    const n = num(Number(m[0].replace(/,/g, "")));
    return fill(String(v).trim().startsWith(">") ? "Outside the top {n}" : "Top {n}", { n });
  }
  const ageWords = (iso) => { const years = Math.floor((Date.now() - Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`)) / 31557600000); return years < 1 ? t("Under a year old") : many(years, "{n} year old", "{n} years old"); };

  /* Each figure says where it comes from. Rows with nothing yet aren't a wall of dashes: they're listed under the
     table with the reason and the one thing that fills them. */
  function strengthBody(p, f, l, row) {
    const myHost = COMP.site?.()?.host || p.site?.host || "";
    const mozWait = !known(f.da) && !known(f.my_da);
    /* Linking sites compare like with like (SEO review 2026-11-17, #11): Moz's count for both sides when Moz has both. Otherwise
       theirs come from their link files and mine from my Backlinks list, two different sources: each side names its source and
       nobody is called Ahead. Spam domains never count; they're said apart as "+5 flagged". */
    const bothMoz = known(f.moz_links) && known(f.my_moz_links);
    const fromFiles = !bothMoz && known(l.linking_domains);
    const theirLinks = bothMoz ? f.moz_links : known(l.linking_domains) ? l.linking_domains : f.moz_links;
    const myLinks = bothMoz ? f.my_moz_links : known(l.my_linking_domains) ? l.my_linking_domains : f.my_moz_links;
    const linkSource = bothMoz ? t("from Moz") : fromFiles ? t("Different sources: no winner") : known(f.moz_links) ? t("from Moz") : "";
    const theirSrc = fromFiles ? [fill("from {source}", { source: (l.linking_sources || []).join(", ") || t("Link gaps") }), l.linking_flagged ? fill("+{n} flagged as spam", { n: num(l.linking_flagged) }) : "", l.linking_old ? fill("+{n} old links", { n: num(l.linking_old) }) : ""].filter(Boolean).join(" · ") : "";
    const mySrc = fromFiles && known(myLinks) ? t("from your Backlinks list") : "";
    const h = f.history?.status;
    const items = [
      { label: t("Moz Domain Authority"), mine: f.my_da, theirs: f.da, show: figure, why: "moz", bar: true, better: (a, b) => a - b },
      { label: t("Linking sites"), sub: linkSource, mine: myLinks, theirs: theirLinks, show: figure, why: "links", needTheirs: true, bar: !fromFiles, noWinner: fromFiles, srcMine: mySrc, srcTheirs: theirSrc, better: (a, b) => a - b },
      { label: t("Popularity"), sub: t("from Cloudflare"), mine: f.my_popularity, theirs: f.popularity, show: (v) => (v ? esc(popularityWords(v)) : dash), why: "moz", better: (a, b) => popularityRank(b) - popularityRank(a) },
      { label: t("Registered"), mine: f.my_registered_on, theirs: f.registered_on, show: (v) => (v ? esc(monthYear(v)) : dash), note: ageWords, why: "registry", better: (a, b) => (a < b ? 1 : a > b ? -1 : 0) },
    ];
    // A row is only a comparison when their side is known; mine alone (my Backlinks list against nothing) moves to "Not known yet".
    const shows = (x) => (x.needTheirs ? known(x.theirs) : known(x.mine) || known(x.theirs));
    const has = items.filter(shows);
    const missing = items.filter((x) => !shows(x));
    // "You" only when at least one of my figures is known: a side of dashes says nothing.
    const withMine = has.some((x) => known(x.mine));
    /* Who is ahead on a figure: 1 you, -1 them, 0 level or not comparable. */
    const lead = (x) => { if (x.noWinner || !known(x.mine) || !known(x.theirs)) return null; const n = x.better(x.mine, x.theirs); return n > 0 ? 1 : n < 0 ? -1 : 0; };
    const compared = has.map(lead).filter((n) => n !== null), mineWon = compared.filter((n) => n > 0).length, theirsWon = compared.filter((n) => n < 0).length;
    const verdict = !compared.length ? "" : `<p class="pt-verdict">${esc(mineWon === theirsWon ? (mineWon ? fill("You're level: each ahead on {n} of {total}.", { n: num(mineWon), total: num(compared.length) }) : t("Level on everything known.")) : fill(theirsWon > mineWon ? "They're ahead on {n} of {total}." : "You're ahead on {n} of {total}.", { n: num(Math.max(mineWon, theirsWon)), total: num(compared.length) }))}</p>`;
    const side = (x, who, host, won) => {
      const v = who === "you" ? x.mine : x.theirs, most = x.bar ? Math.max(x.mine ?? 0, x.theirs ?? 0) : 0;
      const bar = most > 0 && known(x.mine) && known(x.theirs) ? `<span class="pt-side-bar" aria-hidden="true"><i style="width:${Math.max(2, Math.round(((v ?? 0) / most) * 100))}%"></i></span>` : "";
      return `<div class="pt-side pt-side-${who}${won ? " pt-side-ahead" : ""}"><span class="pt-side-who">${host ? UI().siteLogo(host, 16) : ""}<span>${t(who === "you" ? "You" : "Them")}</span>${won ? `<span class="pt-side-flag">${t("Ahead")}</span>` : ""}</span><span class="pt-side-val tabular">${x.show(v)}</span>${x.note && known(v) ? `<span class="small sec">${esc(x.note(v))}</span>` : ""}${(who === "you" ? x.srcMine : x.srcTheirs) ? `<span class="small sec">${esc(who === "you" ? x.srcMine : x.srcTheirs)}</span>` : ""}${bar}</div>`;
    };
    const duel = (x) => { const n = lead(x); return `<li class="pt-duel"><div class="pt-duel-head"><b>${esc(x.label)}</b>${x.sub ? `<span class="small muted">${esc(x.sub)}</span>` : ""}</div><div class="pt-sides${withMine ? "" : " pt-sides-one"}">${withMine ? side(x, "you", myHost, n === 1) : ""}${side(x, "them", p.host, n === -1)}</div></li>`; };
    const table = has.length ? `<ul class="pt-duels">${has.map(duel).join("")}</ul>` : "";
    const why = {
      moz: () => `<li><div class="what"><b>${t(known(f.popularity) ? "Authority" : "Authority and popularity")}</b><span class="small sec">${t("Not looked up yet.")}${UI().tip(known(f.popularity) ? "From Moz, free, once a month." : "From Moz and Cloudflare, free, once a month.")}</span>${S.strengthError ? `<span class="small crit" role="alert">${esc(t(S.strengthError))}</span>` : ""}</div><div class="acts"><button class="btn btn-small" data-pt-strength-fetch ${S.strengthBusy ? 'disabled aria-busy="true"' : ""}>${icon(S.strengthBusy ? "loader" : "download")}${t(S.strengthBusy ? "Fetching…" : "Get these numbers")}</button></div></li>`,
      links: () => `<li><div class="what"><b>${t("Linking sites")}</b><span class="small sec">${esc(known(myLinks) ? fill("Theirs aren't known: upload a CSV of their links from any backlink tool. You have {n} in Backlinks.", { n: num(myLinks) }) : t("Not known: upload a CSV of their links from any backlink tool."))}</span></div><div class="acts"><button class="btn btn-small" data-pt-gaps>${icon("link-2")}${t("Open Link gaps")}</button></div></li>`,
      registry: () => `<li><div class="what"><b>${t("Registered")}</b><span class="small sec">${t(h === "failed" ? "The domain registry didn't answer. Trying again tomorrow." : "Looking it up in the domain registry…")}${h === "failed" ? "" : UI().tip("Ready a few minutes after a competitor is added.")}</span></div></li>`,
    };
    const kinds = [...new Set(missing.map((x) => x.why))];
    const list = kinds.length ? `<div class="pt-missing">${has.length ? `<h3 class="small sec">${t("Not known yet")}</h3>` : `<p class="pt-lead">${t("None known yet. What fills each one:")}</p>`}<ul class="rows">${kinds.map((k) => why[k]()).join("")}</ul></div>` : "";
    void mozWait;
    return `${verdict}${table}${list}`;
  }
  /* A linking site's score and whose scale it is: the tool's logo alone when it has one, the full label on hover. */
  function linkScore(d) {
    const label = d.authority_label || t("Authority");
    const brand = label.match(/\(([^)]+)\)/)?.[1] || label;
    const source = window.BRANDS?.FILES?.[brand] ? UI().logoOnly(brand, label) : esc(label.replace(/^(?:Authority score|Domain Authority)\s*\(([^)]+)\)$/i, "$1"));
    return `<span class="pt-link-score" tabindex="0" data-tip="${esc(label)}"><b>${num(d.authority)}</b> ${source}</span>`;
  }
  const linkButtons = (main) => `<button class="btn btn-small${main ? " btn-main" : ""}" data-pt-links-upload>${icon("upload")}${t("Upload their links")}</button><button class="btn btn-small" data-pt-links-add>${icon("plus")}${t("Add a linking site")}</button>`;

  /* The same upload as Link gaps, for this competitor only, without leaving the profile. */
  function openLinksUpload(opener) {
    const dlg = UI().$("#dlg");
    if (!dlg || !S.p) return;
    S.uploadOpener = opener;
    dlg.classList.remove("wide");
    UI().setHTML(dlg, `<div class="dlg-head"><h2 id="dlg-title">${esc(fill("Upload links to {host}", { host: S.p.host }))}</h2><button class="icon-btn" data-close-dlg aria-label="${t("Close")}">${icon("x")}</button></div>
      <div class="dlg-body">
        <p class="small sec" style="margin-bottom:12px">${t("A CSV from any backlink tool, with a link or domain column. Spam is flagged, never removed.")}</p>
        <label class="field"><span>${t("File")}</span><input class="input" id="pt-up-file" type="file" accept=".csv,.tsv,.txt,text/csv"></label>
        <div id="pt-up-error"></div>
      </div>
      <div class="dlg-foot"><button class="btn" data-close-dlg>${t("Cancel")}</button><button class="btn btn-main" id="pt-up-send" data-pt-up-send disabled>${icon("upload")}${t("Upload")}</button></div>`);
    dlg.showModal();
    UI().$("#pt-up-file")?.focus();
  }
  async function sendLinksUpload(button) {
    const file = UI().$("#pt-up-file")?.files?.[0];
    if (!file || !S.p) return;
    const form = new FormData();
    form.append("file", file);
    form.append("site_id", String(COMP.siteId));
    form.append("competitor_id", String(S.p.id));
    button.disabled = true;
    UI().setHTML(button, `${icon("refresh-cw", "spin")}${t("Uploading…")}`);
    try {
      const answer = await COMP.api("POST", "link-gaps/import", undefined, { form });
      UI().$("#dlg")?.close();
      UI().toast?.(fill("{n} linking sites added. Spam is checked next.", { n: num(answer.domains ?? 0) }));
      await reloadInsights();
      S.uploadOpener?.isConnected && S.uploadOpener.focus();
    } catch (err) {
      UI().setHTML(UI().$("#pt-up-error"), `<div class="error" role="alert">${icon("octagon-alert")}<span dir="auto">${esc(t(err.message))}</span></div>`);
      UI().setHTML(button, `${icon("upload")}${t("Upload")}`);
      button.disabled = false;
    }
  }
  /* Questions -> Change: which page of mine sits beside this page of theirs. A box that searches my pages by title or
     address (or takes any address of my site), saved as a pair through page-pairs/pick (2026-11-13). */
  const siteIdHere = () => (typeof COMP.siteId === "number" ? COMP.siteId : S.p?.site?.id ?? null);
  async function openMinePick(opener) {
    const g = (S.ins?.questions?.groups || []).find((x) => x.url === opener.dataset.ptMinePick);
    if (!g || !S.p) return;
    let mine = [];
    try { mine = (await COMP.api("GET", `sites/${siteIdHere()}/pages`)).pages || []; } catch { /* typing an address still works */ }
    const host = COMP.site?.()?.host || S.p?.site?.host || "";
    UI().openPanel(`${UI().panelHead(t("Your page to compare"), `<span dir="auto">${esc(g.title || COMP.shortUrl(g.url))}</span>`)}
      <form class="panel-body" id="pt-mp-form" data-their="${esc(g.url)}" novalidate>
        <label class="field"><span>${COMP.who("you", host, t("Your page"))}</span>
          <input class="input" id="pt-mp-url" type="text" list="pt-mp-pages" dir="auto" autocomplete="off" spellcheck="false" value="${esc(g.mine?.url || "")}" placeholder="${esc(fill("Search your pages, or type an address on {host}", { host }))}"></label>
        <datalist id="pt-mp-pages">${mine.map((x) => `<option value="${esc(x.url)}" label="${esc(x.title || "")}"></option>`).join("")}</datalist>
        <p class="note">${icon("info")}<span>${t("Saved as a pair: rankings won't replace it.")}</span></p>
        <div id="pt-mp-error"></div>
      </form>
      <div class="panel-foot"><button class="btn btn-main" data-pt-mp-save>${t("Save")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener, { key: `pt-mine|${S.p.id}|${g.url}` });
    const box = UI().$("#pt-mp-url");
    box?.focus({ preventScroll: true });
    box?.select();
  }
  async function saveMinePick(button) {
    const form = UI().$("#pt-mp-form"), url = UI().$("#pt-mp-url")?.value.trim() || "";
    if (!form || !S.p) return;
    const their = form.dataset.their;
    const say = (words) => UI().setHTML(UI().$("#pt-mp-error"), `<div class="error" role="alert">${icon("octagon-alert")}<span dir="auto">${esc(words)}</span></div>`);
    if (!url) { say(t("Pick one of your pages, or type its address.")); UI().$("#pt-mp-url")?.focus(); return; }
    button.disabled = true;
    try {
      await COMP.api("POST", "page-pairs/pick", { site_id: siteIdHere(), competitor_id: S.p.id, my_url: url, their_url: their });
      UI().forgetPanelForm?.();
      UI().closePanel({ keep: false });
      UI().toast?.(t("Saved. Rankings won't replace it."));
      await reloadInsights();
      UI().$$("[data-pt-mine-pick]").find((b) => b.dataset.ptMinePick === their)?.focus({ preventScroll: true });
    } catch (err) {
      say(t(err.message));
      button.disabled = false;
    }
  }
  async function reloadInsights() {
    if (!S.p) return;
    const fresh = await load(S.p, COMP.siteId);
    if (fresh && S.ins) Object.assign(S.ins, fresh);
    repaint();
  }

  function value(b, v) {
    if (!known(v) || (Array.isArray(v) && !v.length)) return dash;
    if (b.kind === "share") return share(v);
    if (b.kind === "list") return v.slice(0, 4).map((x) => esc(Array.isArray(x) ? `${x[0]} ${Math.round(x[1] * 100)}%` : x)).join("<br>");
    if (b.kind === "text") return esc(v);
    return num(v);
  }
  const unavailable = () => `<section class="card"><p class="cl-none small sec">${t("This part didn't load. The rest still works.")}</p></section>`;

  // ---- drawing and events -------------------------------------------------------------------------
  /* comp-list.js calls this inside the profile. parts: { keywordsBody(p), timelineBody(p) }. */
  function body(p, ins, parts) {
    Object.assign(S, { p, ins, parts });
    if (S.shownId !== p.id) {
      S.shownId = p.id; S.tab = "changes"; S.buildMore = false; S.qOpen = new Set(); S.qPicked = new Set(); S.qOthers = false; S.bestSort = null;
      [BEST, QS, QO].forEach((key) => { TP().state(key).q = ""; TP().reset(key); }); // another competitor starts on page 1, unsearched
    }
    [BEST, QS, QO].forEach((key) => TP().on(key, () => repaint()));
    return `${tabBar()}<div class="pt-panel" id="pt-panel" role="tabpanel" aria-labelledby="pt-tab-${currentTab()}">${panel()}</div>`;
  }
  /* comp-list.js puts this inside the header card, under the name: the answer, then the figures. */
  function headBlock(p, ins) {
    Object.assign(S, { p, ins, kwShown: kwUnknown() });
    const said = answer(p, ins);
    // The answer's buttons sit at the end of its sentence, so the four cards need no row of their own under them.
    const acts = said.acts.length ? `<div class="pt-answer-acts">${said.acts.join("")}</div>` : "";
    return `${acts ? said.html.replace(/<\/section>\s*$/, `${acts}</section>`) : said.html}${tiles(p, ins)}`;
  }

  function repaint(focus) {
    const box = UI().$("#pt-panel");
    if (!box || !S.p) return;
    UI().setHTML(box, panel());
    box.setAttribute("aria-labelledby", `pt-tab-${currentTab()}`);
    focus?.();
  }

  function pickTab(id, { focus = true } = {}) {
    S.tab = id;
    // Opening one of the Competitors tabs in here reads it again: it may have changed on its own tab since.
    if (EMBEDDED.has(id)) { const tab = COMP.tabs?.find((x) => x.id === id); if (tab) tab.loadedFor = undefined; }
    UI().$$("[data-pt-tab]").forEach((b) => { const on = b.dataset.ptTab === id; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; });
    repaint();
    if (focus) UI().$(`[data-pt-tab="${id}"]`)?.focus({ preventScroll: true });
  }


  /* Puts both domains on the Important domains list, then asks Moz and Cloudflare for just these two. */
  async function fetchStrength() {
    if (S.strengthBusy || !S.p) return;
    const theirs = S.p.host, mine = COMP.site?.()?.host || S.p.site?.host;
    S.strengthBusy = true; S.strengthError = "";
    repaint();
    const problems = [];
    try {
      for (const domain of [theirs, mine].filter(Boolean)) await COMP.api("POST", "important-domains", { domain });
      try { const moz = await COMP.api("POST", "important-domains/moz", { domains: [theirs, mine].filter(Boolean) }); if (moz.error) problems.push(`Moz: ${moz.error}`); } catch (err) { problems.push(err.message); }
      try { const cf = await COMP.api("POST", "important-domains/popularity", {}); if (cf.error) problems.push(`Cloudflare: ${cf.error}`); } catch (err) { problems.push(err.message); }
      const fresh = await load(S.p, COMP.siteId);
      if (fresh && S.ins) Object.assign(S.ins, fresh);
    } catch (err) { problems.push(err.message); }
    S.strengthBusy = false; S.strengthError = problems.join(" ");
    repaint(() => UI().$("[data-pt-strength-fetch], .pt-vs")?.focus?.({ preventScroll: true }));
  }

  function showTip(g) {
    const wrap = g.closest(".pt-chart-wrap"), tip = wrap?.querySelector(".pt-tip");
    const months = (wrap?.dataset.ptSeries === "edits" ? S.editMonths : S.ins?.rhythm?.months) || [];
    const m = months[Number(g.dataset.ptMonth)];
    if (!tip || !wrap || !m) return;
    UI().setHTML(tip, `<b>${esc(longMonth(m.month))}</b><span><i class="pt-key pt-key-them"></i>${t("Them")} <b class="tabular">${num(m.theirs || 0)}</b></span>${S.showMine ? `<span><i class="pt-key pt-key-you"></i>${t("You")} <b class="tabular">${num(m.mine || 0)}</b></span>` : ""}`);
    tip.hidden = false;
    // Just above this month's tallest bar, centred on it, and kept inside the chart.
    const box = g.getBoundingClientRect(), outer = wrap.getBoundingClientRect();
    const barTop = Math.min(...[...g.querySelectorAll(".pt-pair i")].map((bar) => bar.getBoundingClientRect().top));
    const half = tip.offsetWidth / 2 + 4;
    const x = Math.min(Math.max(box.left - outer.left + box.width / 2, half), outer.width - half);
    tip.style.left = `${x}px`;
    tip.style.top = `${Math.max(0, barTop - outer.top - tip.offsetHeight - 8)}px`;
    UI().$$(".pt-month", wrap).forEach((other) => other.classList.toggle("dim", other !== g));
  }
  function hideTip() {
    UI().$$(".pt-tip").forEach((tip) => { tip.hidden = true; });
    UI().$$(".pt-month.dim").forEach((g) => g.classList.remove("dim"));
  }

  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    // Enter in the page box saves, and never reloads the page.
    document.addEventListener("submit", (e) => { if (e.target.id === "pt-mp-form") { e.preventDefault(); const b = UI().$("[data-pt-mp-save]"); if (b && !b.disabled) saveMinePick(b); } });
    document.addEventListener("click", (e) => {
      const hit = (sel) => e.target.closest?.(sel);
      let el;
      if ((el = hit("[data-pt-tab]"))) { pickTab(el.dataset.ptTab); return; }
      if ((el = hit("[data-pt-card]"))) {
        if (el.dataset.ptGoKind === "kw") { S.parts?.showKeywords?.(el.dataset.ptGoTo); pickTab("keywords", { focus: false }); UI().$(`[data-cl-kw="${el.dataset.ptGoTo}"]`)?.focus({ preventScroll: false }); }
        else pickTab(el.dataset.ptGoTo);
        return;
      }
      if (hit("[data-pt-only-them]")) { S.parts?.showKeywords?.("theirs_only"); pickTab("keywords", { focus: false }); UI().$('[data-cl-kw="theirs_only"]')?.focus({ preventScroll: false }); return; }
      if ((el = hit("[data-pt-go]"))) { UI().go?.(el.dataset.ptGo); return; }
      if (hit("[data-pt-gaps]")) { pickTab("gaps"); UI().$("#pt-panel")?.scrollIntoView?.({ block: "start" }); return; } // this competitor's own Link gaps, a tab away
      if ((el = hit("[data-pt-best-sort]"))) {
        const id = el.dataset.ptBestSort, first = BEST_SORT[id][1];
        S.bestSort = S.bestSort?.id !== id ? { id, dir: first } : S.bestSort.dir === first ? { id, dir: first === "asc" ? "desc" : "asc" } : null;
        TP().reset(BEST);
        repaint(() => UI().$(`[data-pt-best-sort="${id}"]`)?.focus({ preventScroll: true }));
        return;
      }
      if ((el = hit("[data-pt-qpage]"))) { const url = el.dataset.ptQpage; S.qOpen ||= new Set(); S.qOpen.has(url) ? S.qOpen.delete(url) : S.qOpen.add(url); repaint(() => UI().$(`[data-pt-qpage="${CSS.escape(url)}"]`)?.focus({ preventScroll: true })); return; }
      if ((el = hit("[data-pt-q-note]"))) { openQuestionNote(el); return; }
      if ((el = hit("[data-pt-mine-pick]"))) { openMinePick(el); return; }
      if ((el = hit("[data-pt-mp-save]"))) { saveMinePick(el); return; }
      if ((el = hit("[data-pt-qn-save]"))) { saveQuestionNote(el); return; }
      if (hit("[data-pt-q-clear]")) { S.qPicked?.clear(); repaint(); return; }
      if (hit("[data-pt-q-others]")) { S.qOthers = !S.qOthers; repaint(() => UI().$("[data-pt-q-others]")?.focus({ preventScroll: true })); return; }
      if (hit("[data-pt-strength-fetch]")) { fetchStrength(); return; }
      if ((el = hit("[data-pt-links-upload]"))) { openLinksUpload(el); return; }
      if ((el = hit("[data-pt-links-add]")) && S.p) { COMP.editGap?.(null, [{ id: S.p.id, host: S.p.host, display: S.p.display }], el, reloadInsights); return; }
      if ((el = hit("[data-pt-up-send]"))) { sendLinksUpload(el); return; }
      if (hit("[data-pt-build-more]")) { S.buildMore = !S.buildMore; repaint(() => UI().$("[data-pt-build-more]")?.focus({ preventScroll: true })); }
    });
    // Arrow keys move between tabs, as tabs do.
    document.addEventListener("keydown", (e) => {
      const tab = e.target.closest?.("[data-pt-tab]");
      if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const ids = TABS.map(([id]) => id), at = ids.indexOf(tab.dataset.ptTab);
      const next = e.key === "Home" ? 0 : e.key === "End" ? ids.length - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length;
      pickTab(ids[next]);
    });
    document.addEventListener("change", (e) => {
      const url = e.target.dataset?.ptQpick;
      if (url === undefined) return;
      S.qPicked ||= new Set();
      e.target.checked ? S.qPicked.add(url) : S.qPicked.delete(url);
      e.target.closest(".pt-qpage")?.classList.toggle("is-picked", e.target.checked);
      const bar = UI().$("#pt-q-selbar");
      if (bar) UI().setHTML(bar, questionBar());
    });
    document.addEventListener("change", (e) => { if (e.target.id === "pt-up-file") { const b = UI().$("#pt-up-send"); if (b) b.disabled = !e.target.files?.length; } });
    document.addEventListener("pointerover", (e) => { const g = e.target.closest?.(".pt-month"); if (g) showTip(g); });
    document.addEventListener("pointerout", (e) => { if (e.target.closest?.(".pt-month") && !e.relatedTarget?.closest?.(".pt-month")) hideTip(); });
  }

  // ---- the plain-file sample: the same answer the server gives, made from the profile ------------
  function sampleInsights(p) {
    let seed = [...p.host].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const rand = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
    const theirs = p.keywords.filter((k) => k.their_url);
    const byUrl = new Map();
    theirs.forEach((k) => {
      const row = byUrl.get(k.their_url) || { url: k.their_url, title: null, keywords: 0, best_position: 99, my_url: null, my_title: null, pair_id: null };
      row.keywords += 1;
      row.best_position = Math.min(row.best_position, k.their_position);
      if (k.my_url && !row.my_url) row.my_url = k.my_url;
      byUrl.set(k.their_url, row);
    });
    const pairs = new Map((p.pairs || []).map((x) => [x.their_url, x]));
    const best = [...byUrl.values()].map((b) => ({ ...b, title: pairs.get(b.url)?.their_title || null, my_title: pairs.get(b.url)?.my_title || null, pair_id: pairs.get(b.url)?.id || null })).sort((a, b) => b.keywords - a.keywords || a.best_position - b.best_position);
    const folders = ["/blog/", "/services/", "/guides/", "/pricing/"];
    const sections = folders.map((path, i) => ({ path, pages: Math.round(4 + rand() * 30), my_pages: i === 3 ? 0 : Math.round(rand() * 14), new_90d: Math.round(rand() * (i === 0 ? 6 : 2)), last_change: new Date(Date.now() - rand() * 40 * 86400000).toISOString() }));
    const now = new Date();
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1));
      return { month: d.toISOString().slice(0, 7), theirs: Math.round(rand() * 5), mine: Math.round(rand() * 3) };
    });
    const start = 2019 + Math.floor(rand() * 4);
    const by_year = Array.from({ length: now.getUTCFullYear() - start + 1 }, (_, i) => ({ year: start + i, pages: Math.round(3 + rand() * 20) }));
    const pages = p.crawl?.status === "blocked" ? null : p.compare?.pages?.theirs?.pages || sections.reduce((s, x) => s + x.pages, 0); // a site that says no has no pages read
    const myPages = p.compare?.pages?.mine?.pages || 0;
    const qPage = (path, title, list, related) => ({ url: `https://${p.host}${path}`, title, questions: list, other: [], related, score: related ? 2 : 0 });
    const questions = { judged: true, dropped: 6, groups: [
      qPage("/guides/getting-started/", "Getting started: the full guide", ["How long does it take to get started?", "What papers do I need?", "Can I do it from abroad?", "Who signs the forms?"], true),
      qPage("/pricing/", "Prices and plans", ["What does it cost per month?", "Can I change plans later?"], true),
      qPage("/blog/weekend-ideas/", "Ten weekend ideas", ["Where to eat on a Friday?", "What to wear in summer?"], false),
    ] };
    questions.related = questions.groups.filter((g) => g.related).reduce((n, g) => n + g.questions.length, 0);
    questions.total = questions.groups.reduce((n, g) => n + g.questions.length, 0);
    const features = {};
    theirs.slice(0, 3).forEach((k, i) => { features[k.keyword] = { snippet: i === 0 ? "them" : null, rich: i === 1 ? ["rating"] : [], ai: i === 2 }; });
    const cannibal = theirs[3] ? { [theirs[3].keyword]: 2 } : {};
    return {
      facts: { first_capture: `${start}-0${1 + Math.floor(rand() * 8)}-14`, registered_on: `${start - 1}-11-02`, expires_on: `${now.getUTCFullYear() + 1}-11-02`, my_registered_on: "2018-03-20", da: 10 + Math.round(rand() * 25), my_da: 12, popularity: "Top 500,000", my_popularity: null, pages, my_pages: myPages, languages: ["fr"], cms: "WordPress", my_cms: "Astro", history: { status: "ok", fetched_at: now.toISOString(), archived_pages: 40 + Math.round(rand() * 200), capped: false } },
      best_pages: best,
      sections,
      questions,
      rhythm: { months, new_30d: months[11].theirs, my_new_30d: months[11].mine, top_section: months[11].theirs ? "/blog/" : null, updated_12m: { theirs: 0.62, mine: 0.31 }, removed_30d: 1, my_removed_30d: 0, by_year },
      links: { linking_domains: 21, my_linking_domains: 9, not_to_me: 14, top: [{ domain: "city-guide.example", authority: 41, authority_label: "DA", spam: false }, { domain: "business-news.example", authority: 35, authority_label: "DA", spam: false }, { domain: "free-links-directory.example", authority: 4, authority_label: "DA", spam: true }] },
      build: [
        { key: "words", label: "Words per page", kind: "number", mine: p.compare?.pages?.mine?.average_words ?? 640, theirs: 1279 },
        { key: "title", label: "Title length", kind: "number", mine: 52, theirs: 61 },
        { key: "meta", label: "With a meta description", kind: "share", mine: 0.9, theirs: 1 },
        { key: "schema", label: "Structured data", kind: "list", mine: [["Organization", 1]], theirs: [["FAQPage", 0.45], ["Article", 0.8], ["BreadcrumbList", 1]] },
        { key: "questions", label: "With questions in headings", kind: "share", mine: 0.2, theirs: 0.55 },
        { key: "videos", label: "With a video", kind: "share", mine: 0, theirs: 0.12 },
        { key: "dupes", label: "Duplicate titles", kind: "number", mine: 0, theirs: 3 },
        { key: "noindex", label: "Hidden (noindex)", kind: "number", mine: 1, theirs: 0 },
        { key: "sitemap", label: "In the sitemap", kind: "share", mine: 1, theirs: 0.86 },
        { key: "cms", label: "Built with", kind: "text", mine: "Astro", theirs: "WordPress" },
        { key: "alt", label: "Images without alt text", kind: "share", mine: 0.05, theirs: 0.3, more: true },
        { key: "internal", label: "Internal links per page", kind: "number", mine: 24, theirs: 41, more: true },
        { key: "hreflang", label: "Languages (hreflang)", kind: "list", mine: [], theirs: ["fr", "en"], more: true },
        { key: "tables", label: "With a table", kind: "share", mine: 0.1, theirs: 0.35, more: true },
      ],
      keywords: { features, cannibal },
    };
  }

  // Pages and searches on the long lists (10 Nov).
  Object.assign(window.FR, {
    "Search pages": "Rechercher une page", "Search pages and questions": "Rechercher une page ou une question",
    "No page matches the search.": "Aucune page ne correspond à la recherche.", "pages": "pages",
  });

  // Ticking question rows, my page beside theirs, and the age card (11 Nov).
  Object.assign(window.FR, {
    "Change page": "Changer de page", "Pick a page": "Choisir une page", "Change your page compared with {page}": "Changer votre page comparée à {page}", "Pick your page compared with {page}": "Choisir votre page comparée à {page}", "Your page to compare": "Votre page à comparer", "Search your pages, or type an address on {host}": "Cherchez parmi vos pages, ou saisissez une adresse sur {host}", "Saved as a pair: rankings won't replace it.": "Enregistrée comme paire : les positions ne la remplaceront pas.", "Pick one of your pages, or type its address.": "Choisissez une de vos pages, ou saisissez son adresse.", "Saved. Rankings won't replace it.": "Enregistré. Les positions ne le remplaceront pas.",
    "Their questions": "Leurs questions", "Your page": "Votre page", "Paired": "Associée", "Same keyword": "Même mot-clé", "Closest topic": "Sujet le plus proche",
    "You paired these two in Page vs page.": "Vous avez associé ces deux pages dans Page contre page.", "Both pages rank for the same keyword.": "Les deux pages se positionnent sur le même mot-clé.", "Best guess: main headings share the most words.": "Estimation : leurs titres principaux ont le plus de mots en commun.",
    "None yet.": "Aucune pour l'instant.", "Not read yet": "Pas encore lue", "No questions.": "Aucune question.",
    "Select {page}": "Sélectionner {page}", "Add a note": "Ajouter une note", "Your note": "Votre note", "Saved with it": "Enregistré avec", "Save note": "Enregistrer la note",
    "One note on this page": "Une note sur cette page", "One note per page, {n} pages": "Une note par page, {n} pages", "Note saved on {n} page.": "Note enregistrée sur {n} page.", "Note saved on {n} pages.": "Note enregistrée sur {n} pages.",
    "Their page: {title}": "Leur page : {title}", "Your page: {title}": "Votre page : {title}", "Your page: none yet": "Votre page : aucune pour l'instant", "The note didn't save. Your text is still here.": "La note n'a pas été enregistrée. Votre texte est toujours là.",
    "Registered": "Enregistré", "Online since": "En ligne depuis", "Archived pages": "Pages archivées", "Renews": "Renouvellement", "Pages first archived, by year": "Pages archivées pour la première fois, par an",
    "From the Wayback Machine and the domain registry. The archive misses pages, so counts are lower than the monthly chart.": "D'après la Wayback Machine et le registre du domaine. L'archive ne garde pas toutes les pages : ces chiffres sont plus bas que ceux du graphique mensuel.",
  });

  // The 10 Nov rework of Activity, questions and strength.
  Object.assign(window.FR, {
    "No questions in their headings yet.": "Aucune question dans leurs titres pour l'instant.",
    "Questions they answer": "Questions auxquelles ils répondent",
    "From their headings that end in a question mark. Author, tag, category and home pages are left out: their headings are other posts' titles.": "D'après leurs titres qui finissent par un point d'interrogation. Les pages d'auteur, d'étiquette, de catégorie et d'accueil sont exclues : leurs titres sont ceux d'autres articles.",
    "Grouped by the page that answers them.": "Regroupées par la page qui y répond.",
    "{n} of their questions are on your topics, on {pages}.": "{n} de leurs questions portent sur vos sujets, sur {pages}.",
    "None are on your topics.": "Aucune ne porte sur vos sujets.",
    "Your pages aren't read yet: some may already be answered.": "Vos pages ne sont pas encore lues : certaines y répondent peut-être déjà.",
    "Answer {n} questions from {page} on your site": "Répondre sur votre site aux {n} questions de {page}",
    "+{n} more": "+{n} de plus",
    "Show {n} more page": "Afficher {n} page de plus",
    "Show {n} more pages": "Afficher {n} pages de plus",
    "{n} question on other topics": "{n} question sur d'autres sujets",
    "{n} questions on other topics": "{n} questions sur d'autres sujets",
    "Show {n} question on other topics": "Afficher {n} question sur d'autres sujets",
    "Show {n} questions on other topics": "Afficher {n} questions sur d'autres sujets",
    "Hide": "Masquer",
    "They added {n} page in 12 months": "Ils ont ajouté {n} page en 12 mois",
    "They added {n} pages in 12 months": "Ils ont ajouté {n} pages en 12 mois",
    "(most in {month}: {k})": "(surtout en {month} : {k})",
    "They added no pages in 12 months": "Ils n'ont ajouté aucune page en 12 mois",
    "you added {n}": "vous en avez ajouté {n}",
    "{n} new": "{n} nouvelle(s)", "nothing new": "rien de nouveau",
    "Last 30 days: {recent}, {gone}.": "30 derniers jours : {recent}, {gone}.",
    "{n} removed": "{n} retirée(s)",
    "nothing removed": "rien de retiré",
    "{share} of their pages were updated in 12 months.": "{share} de leurs pages ont été mises à jour en 12 mois.",
    "How fast they publish": "À quel rythme ils publient",
    "How often they edit": "À quelle fréquence ils modifient", "Edits each month": "Modifications par mois",
    "Pages edited each month": "Pages modifiées par mois", "Pages edited": "Pages modifiées",
    "Different sources: no winner": "Sources différentes : pas de gagnant", "from {source}": "d'après {source}", "+{n} flagged as spam": "+{n} signalés comme spam", "+{n} old links": "+{n} anciens liens", "Old link": "Ancien lien",
    "from your Backlinks list": "d'après votre liste de backlinks",
    "Pages they already had where the app saw a change: title, text, headings and so on. A page counts once, however many things changed. Counted from the day the app started watching.": "Pages qu'ils avaient déjà et où l'app a vu un changement : titre, texte, intertitres, etc. Une page compte une fois, quel que soit le nombre de changements. Compté depuis le jour où l'app a commencé à les suivre.",
    "Edits each month, them against you": "Modifications par mois, eux face à vous", "Their edits each month": "Leurs modifications par mois",
    "they made {n} edit": "ils ont fait {n} modification", "they made {n} edits": "ils ont fait {n} modifications", "they made no edits": "ils n'ont fait aucune modification",
    "you made {n}": "vous {n}", "Since {day}:": "Depuis le {day} :", "This month: {theirs}{mine}.": "Ce mois-ci : {theirs}{mine}.",
    "Fills in once the app has read their pages twice.": "Se remplit quand l'app a lu leurs pages deux fois.",
    "Changes the app saw on pages they already had: title, text, headings and so on. Counted from the day the app started watching.": "Changements vus par l'app sur des pages qui existaient déjà : titre, texte, titres de section… Comptés depuis le jour où l'app a commencé à surveiller.",
    
    "you": "vous",
    "domain registered {date}": "domaine enregistré en {date}",
    "The Wayback Machine has saved {n} of their pages, most of them first in {year}.": "La Wayback Machine a gardé {n} de leurs pages, la plupart vues pour la première fois en {year}.",
    "Their domain renews by {date}.": "Leur domaine est à renouveler avant le {date}.",
    "How old their site is": "L'âge de leur site",
    "From the Wayback Machine and the domain registry": "D'après la Wayback Machine et le registre des domaines",
    "Both domains were registered in {month}.": "Les deux domaines ont été enregistrés en {month}.",
    "{n} website links to them.": "{n} site fait un lien vers eux.", "{n} websites link to them.": "{n} sites font un lien vers eux.",
    "Their domain was registered in {month}.": "Leur domaine a été enregistré en {month}.",
    "Linking sites": "Sites qui font un lien",
    "Their domain is older than yours: {them} against {you}.": "Leur domaine est plus ancien que le vôtre : {them} contre {you}.",
    "Your domain is older than theirs: {you} against {them}.": "Votre domaine est plus ancien que le leur : {you} contre {them}.",
    "Moz rates them {them}/100, you {you}.": "Moz leur donne {them}/100, à vous {you}.",
    "{them} websites link to them, {you} to you.": "{them} sites font un lien vers eux, {you} vers vous.",
    "Authority and popularity": "Autorité et popularité",
    "Not looked up yet.": "Pas encore cherché.",
    
    "Theirs aren't known: upload a CSV of their links from any backlink tool. You have {n} in Backlinks.": "Les leurs ne sont pas connus : importez un CSV de leurs liens depuis n'importe quel outil de backlinks. Vous en avez {n} dans Backlinks.",
    "Not known: upload a CSV of their links from any backlink tool.": "Inconnu : importez un CSV de leurs liens depuis n'importe quel outil de backlinks.",
  });

  Object.assign(window.FR, {
    "Whose": "À qui", "On shared keywords": "Sur les mots-clés communs", "New and removed pages": "Pages ajoutées et retirées",
    "Added in 30 days": "Ajoutées en 30 j", "Removed, 30 days": "Retirées, 30 jours", "Added, 12 months": "Ajoutées, 12 mois", "Updated, 12 months": "Mises à jour, 12 mois",
    "Since {day}": "Depuis le {day}", "Since today": "Depuis aujourd'hui", "Since yesterday": "Depuis hier", "Edits": "Modifications",
    "{n} on your topics": "{n} sur vos sujets", "{n} page of theirs": "{n} de leurs pages", "{n} pages of theirs": "{n} de leurs pages",
    "No keyword list yet.": "Pas encore de liste de mots-clés.",
    "Keywords not checked.": "Mots-clés non contrôlés.",
    "{them} lead {they} · {you} lead {mine}": "{them} devant sur {they} · {you} devant sur {mine}",
    "Keywords you both rank on.": "Mots-clés où vous vous classez tous les deux.",
    "They rank, you weren't found.": "Ils se classent, vous êtes introuvable.",
    "You rank, they weren't found.": "Vous vous classez, eux sont introuvables.",
    "Pages found on each site.": "Pages trouvées sur chaque site.",
    "They lead {they}, you lead {mine}": "Ils mènent sur {they}, vous sur {mine}", "They rank, you don't": "Ils se classent, pas vous", "You rank, they don't": "Vous vous classez, pas eux",
    "{mine} yours · {theirs} theirs": "{mine} à vous · {theirs} à eux", "Their site blocks bots": "Leur site bloque les robots", "Theirs · yours once read": "Les leurs · les vôtres une fois lues",
    "Yours {n}": "Le vôtre : {n}", "Their score; yours not looked up": "Le leur ; le vôtre pas encore cherché",
    "Questions in their headings": "Questions dans leurs titres",
    "Your own pages aren't read yet, so the app can't tell which of these you already answer.": "Vos propres pages ne sont pas encore lues : l'application ne peut pas dire lesquelles vous traitez déjà.",
    "Too few months to draw yet.": "Trop peu de mois pour tracer un graphique.",
    "No new pages in the last 12 months.": "Aucune nouvelle page sur les 12 derniers mois.",
    "Keywords": "Mots-clés", "Pages": "Pages", "Activity": "Activité", "Their site": "Leur site", "About this competitor": "À propos de ce concurrent", "In one sentence": "En une phrase",
    "They beat you on {they} of {shared} shared keywords": "Ils vous battent sur {they} des {shared} mots-clés communs", "You beat them on {mine} of {shared} shared keywords": "Vous les battez sur {mine} des {shared} mots-clés communs",
    "and they rank on {n} keyword you don't": "et ils se classent sur {n} mot-clé où vous n'êtes pas", "and they rank on {n} keywords you don't": "et ils se classent sur {n} mots-clés où vous n'êtes pas",
    "They rank on {n} keyword you don't": "Ils se classent sur {n} mot-clé où vous n'êtes pas", "They rank on {n} keywords you don't": "Ils se classent sur {n} mots-clés où vous n'êtes pas",
    "They published {n} page in 30 days, mostly in {section}.": "Ils ont publié {n} page en 30 jours, surtout dans {section}.", "They published {n} pages in 30 days, mostly in {section}.": "Ils ont publié {n} pages en 30 jours, surtout dans {section}.",
    "They published {n} page in 30 days.": "Ils ont publié {n} page en 30 jours.", "They published {n} pages in 30 days.": "Ils ont publié {n} pages en 30 jours.", "They published nothing new in 30 days.": "Ils n'ont rien publié de nouveau en 30 jours.",
    "No ranking check has seen you both yet.": "Aucune vérification de classement ne vous a encore vus tous les deux.", "Your site isn't read yet: no page comparison.": "Votre site n'est pas encore lu : pas de comparaison des pages.",
    "See the {n} keyword": "Voir le mot-clé", "See the {n} keywords": "Voir les {n} mots-clés", "Check your keywords": "Vérifier vos mots-clés",
    "Online since {date}": "En ligne depuis {date}", "DA {n}": "DA {n}", "{n} page": "{n} page", "{n} pages": "{n} pages",
    "Shared keywords": "Mots-clés communs", "You're ahead on {mine}, they're ahead on {they}.": "Vous êtes devant sur {mine}, eux sur {they}.", "Authority": "Autorité", "Moz Domain Authority.": "Domain Authority de Moz.",
    "Mark the domain important under Backlinks to get its Moz score.": "Marquez le domaine comme important dans Backlinks pour obtenir son score Moz.", "Yours are counted once your site is read.": "Les vôtres sont comptées une fois votre site lu.",
    "They hold the featured snippet": "Ils ont l'extrait optimisé", "You hold the featured snippet": "Vous avez l'extrait optimisé", "Snippet": "Extrait", "Your snippet": "Votre extrait", "Rich result": "Résultat enrichi",
    "AI Overview shown": "AI Overview affiché", "Different pages of theirs ranked across checks.": "Plusieurs de leurs pages se sont classées selon les vérifications.",
    "Star rating": "Note en étoiles", "FAQ": "FAQ", "Sitelinks": "Liens de site", "Video": "Vidéo",
    "Their page": "Leur page", "Best position": "Meilleure position", "Your page": "Votre page", "No page": "Pas de page", "Write a page against {url}": "Écrire une page face à {url}",
    "None yet: they appear after a ranking check.": "Rien pour l'instant : elles apparaissent après une vérification des classements.",
    "Section": "Rubrique", "Pages, them and you": "Pages, eux et vous", "New in 90 days": "Nouvelles en 90 jours", "Last change": "Dernier changement", "Sections appear once their pages are read.": "Les rubriques apparaissent une fois leurs pages lues.",
    "People also ask": "Autres questions posées", "In their headings": "Dans leurs titres", "Showing 30 of {n}.": "30 sur {n} affichées.",
    "None found yet. Questions come from their page headings and from Google's People also ask.": "Aucune pour l'instant. Les questions viennent de leurs titres de page et des « Autres questions posées » de Google.",
    "Their strongest pages": "Leurs pages les plus fortes", "By your keywords they rank for": "Selon vos mots-clés où elles se classent", "Their sections": "Leurs rubriques", "By the first folder of each address": "Selon le premier dossier de chaque adresse",
    "Questions they answer that you don't": "Questions auxquelles ils répondent et pas vous",
    "Pages updated in the last 12 months": "Pages mises à jour en 12 mois", "New pages in 30 days": "Nouvelles pages en 30 jours", "Pages removed in 30 days": "Pages retirées en 30 jours",
    "Fills in once their pages are read.": "Se remplit une fois leurs pages lues.",
    "New pages each month": "Nouvelles pages par mois", "Them against you, over 12 months": "Eux face à vous, sur 12 mois", "Show table": "Afficher le tableau", "Month": "Mois", "New pages each month, them against you": "Nouvelles pages par mois, eux face à vous",
    "First archived {date}. {n} of their pages are in the archive.": "Archivé pour la première fois le {date}. {n} de leurs pages sont dans l'archive.", "The archive holds more than the first 5,000 read here.": "L'archive en contient plus que les 5 000 premières lues ici.",
    "The Wayback Machine didn't answer. Trying again tomorrow.": "La Wayback Machine n'a pas répondu. Nouvel essai demain.", "The Wayback Machine has no copy of this site.": "La Wayback Machine n'a aucune copie de ce site.",
    "Looking them up in the Wayback Machine…": "Recherche dans la Wayback Machine…",
    "The Wayback Machine is busy. Trying again in a few minutes.": "La Wayback Machine est occupée. Nouvel essai dans quelques minutes.",
    "Domain registered {date}": "Domaine enregistré le {date}", "renews by {date}": "à renouveler avant le {date}", "How their site grew": "Comment leur site a grandi", "New pages each year, from the Wayback Machine": "Nouvelles pages par an, d'après la Wayback Machine",
    "What": "Quoi", "Moz Domain Authority": "Domain Authority de Moz", "Sites linking to them": "Sites qui font un lien vers eux", "Popularity (Cloudflare)": "Popularité (Cloudflare)", "Registered": "Enregistré",
    "Likely spam": "Spam probable", "{n} of these doesn't link to you.": "{n} d'entre eux ne fait pas de lien vers vous.", "{n} of these don't link to you.": "{n} d'entre eux ne font pas de lien vers vous.", "Open Link gaps": "Ouvrir les liens manquants",
    "No linking sites known yet. They come from a CSV uploaded in Link gaps.": "Aucun site liant connu pour l'instant. Ils viennent d'un CSV importé dans les liens manquants.",
    "More details": "Plus de détails", "Fewer details": "Moins de détails", "Facts appear once their pages are read.": "Les faits apparaissent une fois leurs pages lues.",
    "How strong they are": "Leur force", "Upload their links": "Importer leurs liens", "Add a linking site": "Ajouter un site qui fait un lien", "Upload links to {host}": "Importer les liens vers {host}", "File": "Fichier", "Upload": "Importer", "Uploading…": "Import…",
    "No linking sites known yet.": "Aucun site qui fait un lien n'est encore connu.",
    "A CSV from any backlink tool, with a link or domain column. Spam is flagged, never removed.": "Un CSV de n'importe quel outil de backlinks, avec une colonne lien ou domaine. Le spam est signalé, jamais retiré.",
    "{n} linking sites added. Spam is checked next.": "{n} sites ajoutés. Le spam est vérifié ensuite.", "Where their pages are": "Où sont leurs pages", "By first folder": "Par premier dossier", "Folder": "Dossier", "Their pages": "Leurs pages", "Your pages": "Vos pages",
    "Most of their pages are in {path}: {n} of {total}.": "La plupart de leurs pages sont dans {path} : {n} sur {total}.", "{n} is new in the last 90 days.": "{n} est nouvelle sur les 90 derniers jours.", "{n} are new in the last 90 days.": "{n} sont nouvelles sur les 90 derniers jours.",
    "Only their pages: yours are read tonight for the first time.": "Seulement leurs pages : les vôtres sont lues cette nuit pour la première fois.",
    "Only their pages: yours are being read for the first time.": "Seulement leurs pages : les vôtres sont en cours de première lecture.",
    "Only their pages: your site couldn't be read. Trying again tonight.": "Seulement leurs pages : votre site n'a pas pu être lu. Nouvel essai cette nuit.",
    "Only their pages: none of yours found to compare.": "Seulement leurs pages : aucune des vôtres trouvée pour comparer.",
    "Over the last 12 months": "Sur les 12 derniers mois", "Their new pages each month": "Leurs nouvelles pages par mois",
    "{n} question": "{n} question", "{n} questions": "{n} questions", "Question": "Question", "Where they answer it": "Où ils y répondent", "Answer \"{q}\" on your site": "Répondre à « {q} » sur votre site",
    "{shown} of {total}": "{shown} sur {total} affichées", "Show {n} more": "En voir {n} de plus", "Show all": "Tout afficher", "All {total} shown": "Les {total} sont affichées", "Show fewer": "En voir moins",
    "Popularity": "Popularité", "from Cloudflare": "d'après Cloudflare", "Ahead": "Devant", "They're ahead on {n} of {total}.": "Ils sont devant sur {n} critères sur {total}.", "You're ahead on {n} of {total}.": "Vous êtes devant sur {n} critères sur {total}.", "You're level: each ahead on {n} of {total}.": "À égalité : chacun devant sur {n} critères sur {total}.", "Level on everything known.": "À égalité sur tout ce qui est connu.", "Outside the top {n}": "Hors du top {n}", "Top {n}": "Top {n}", "Under a year old": "Moins d'un an", "{n} year old": "{n} an", "{n} years old": "{n} ans",
    "from Link gaps": "d'après Liens manquants", "from Moz": "d'après Moz", "Not known yet": "Pas encore connu", "None known yet. What fills each one:": "Rien de connu pour l'instant. Ce qui remplit chaque ligne :",
    "Looked up by itself for each website, once a month, while free Moz rows last. Not here yet: the button gets it now.": "Consulté tout seul pour chaque site, une fois par mois, tant qu'il reste des lignes Moz gratuites. Pas encore là : le bouton le récupère tout de suite.",
    "Get these numbers": "Obtenir ces chiffres", "Fetching…": "Récupération…",
    "No list of their links yet. Upload one in Link gaps (a CSV from any backlink tool), or get Moz's count with the button above.": "Pas encore de liste de leurs liens. Importez-en une dans Link gaps (un CSV de n'importe quel outil de backlinks), ou obtenez le total de Moz avec le bouton ci-dessus.",
    "The domain registry didn't answer. Trying again tomorrow.": "Le registre des domaines n'a pas répondu. Nouvel essai demain.",
    "Looking it up in the domain registry…": "Recherche dans le registre des domaines…", "Who links to them": "Qui fait un lien vers eux", "How they build pages": "Comment ils construisent leurs pages", "Facts read from the pages, not advice": "Des faits lus sur les pages, pas des conseils",
    "This part didn't load. The rest still works.": "Cette partie n'a pas chargé. Le reste fonctionne.",
    "Words per page": "Mots par page", "Title length": "Longueur du titre", "With a meta description": "Avec une méta-description", "Structured data": "Données structurées",
    "With questions in headings": "Avec des questions dans les titres", "With a video": "Avec une vidéo", "Duplicate titles": "Titres en double", "Hidden (noindex)": "Masquées (noindex)",
    "In the sitemap": "Dans le sitemap", "Built with": "Construit avec", "Images without alt text": "Images sans texte alternatif", "Internal links per page": "Liens internes par page",
    "Languages (hreflang)": "Langues (hreflang)", "With a table": "Avec un tableau",
  });

  bind();
  COMP.profileTabs = {
    /* The page was left: opened again, even the same competitor starts on Changes. */
    leave() { S.shownId = null; COMP.embed = null; },
    headBlock, load, body, factsLine, keywordMarks, sampleInsights,
    keywordsWhy: () => (kwUnknown() ? t(KW_WHY[kwUnknown()]) : "") };
  // The banner's answer can land after the profile is drawn: redraw once, so 0 becomes — the moment it's known there's no list.
  window.addEventListener("comp:setup-painted", () => { if (S.p && UI().$("#pt-panel") && UI().$(".cl-head .pt-strip") && S.kwShown !== kwUnknown()) COMP.paint(); });
})();
