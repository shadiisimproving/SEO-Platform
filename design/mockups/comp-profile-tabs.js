/* A competitor's profile, built around what an SEO person checks:
     an answer in one sentence, four tiles, then one tab per question —
     Keywords (where do they beat me?), Pages (which of their pages matter?),
     Activity (how fast are they moving?), Their site (how strong is it, and how do they build pages?).

   comp-list.js owns the header, the keyword table and the timeline. This file draws the rest from
   GET competitors/<id>/insights, and in the plain-file sample builds the same answer from the profile.
   Facts only: it compares, it never recommends. Anything not measured says so, never 0. */
(() => {
  "use strict";
  const COMP = window.COMP;
  const TABS = [["keywords", "Keywords", "key-round"], ["pages", "Pages", "file-text"], ["activity", "Activity", "activity"], ["site", "Their site", "globe"]];
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
  const KW_WHY = { "no-keywords": "There's no keyword list for this site yet.", unchecked: "This site's keywords haven't been checked yet." };
  const kwUnknown = () => COMP.setup?.keywordsUnknown?.() || "";
  const share = (v) => (known(v) ? `${Math.round(v * 100)}%` : dash);
  /* The app doesn't read my own site's pages yet, so a "You" there would be a false 0. Leave "You" out and say why once. */
  const mineRead = (ins) => Boolean(ins?.facts?.my_pages);
  /* Why "You" is missing: my site is being read for the first time, couldn't be read, or waits for tonight's run. */
  const notReadNote = () => {
    const r = S.ins?.facts?.my_reading;
    const words = !r ? "Only their pages are shown. Your own site's pages are read tonight for the first time, then your figures appear here."
      : ["queued", "running"].includes(r.status) && !r.read_once ? "Only their pages are shown. Your own site's pages are being read for the first time. Your figures appear here when that's done."
      : r.status === "blocked" || r.status === "failed" ? "Only their pages are shown. Your own site couldn't be read. The app tries again tonight."
      : "Only their pages are shown. No pages of your site were found to compare.";
    return `<p class="pt-note small">${icon("info")}<span>${esc(t(words))}</span></p>`;
  };

  /* Every competitor opens on Keywords, where the answer sentence points. The tab isn't kept across competitors or visits. */
  function currentTab() {
    if (!S.tab) S.tab = "keywords";
    return TABS.some(([id]) => id === S.tab) ? S.tab : "keywords";
  }

  // ---- loading ------------------------------------------------------------------------------
  async function load(p, site) {
    if (!(await COMP.isServer())) {
      const key = `competitors/${p.id}/insights?site_id=${site}`;
      window.COMP_SAMPLE.get[key] ||= sampleInsights(p);
    }
    try { return await COMP.api("GET", `competitors/${p.id}/insights?site_id=${site}`); } catch { return null; }
  }

  // ---- the answer, in one sentence ------------------------------------------------------------
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
    if (!ins?.facts?.my_pages) missing.push(t("Your own site hasn't been read yet, so its pages can't be compared."));
    const acts = [];
    if (!off && c.theirs_only) acts.push(`<button class="btn btn-small" data-pt-only-them>${icon("key-round")}${esc(many(c.theirs_only, "See the {n} keyword", "See the {n} keywords"))}</button>`);
    // With no check yet, the banner above the tabs says what to do: no second button here that only switches tabs.
    if (first || second) {
      const site = p.site?.host || "";
      acts.push(UI().taskButton({ title: `${p.host}: ${[first, second].filter(Boolean).join(" ")}`.slice(0, 180), host: site, source: { type: "competitor", label: p.host, host: site, facts: [first, second].filter(Boolean), link: `#competitors/list/${p.id}`, key: `answer|${p.id}` } }));
    }
    const words = [first, second].filter(Boolean).join(" ");
    const verdict = !off && c.shared ? (c.i_ahead === c.they_ahead ? UI().status("info", t("Level")) : c.i_ahead > c.they_ahead ? UI().status("good", t("You're ahead")) : UI().status("warn", t("They're ahead"))) : "";
    // The buttons go on the figures' row (tiles), so the sentence and its actions cost one line less of height.
    return { acts, html: `<section class="pt-answer" aria-label="${esc(t("In one sentence"))}">
      ${words ? `<p class="pt-answer-text">${verdict}${esc(words)}</p>` : ""}
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
    if (known(f.pages)) out.push(many(f.pages, "{n} page", "{n} pages"));
    if (f.cms) out.push(esc(f.cms));
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
    const fig = (label, value, sub = "", tip = "") => `<div class="pt-fig" ${tip ? `data-tip="${esc(tip)}"` : ""}><span class="pt-fig-lab">${esc(label)}</span><span class="pt-fig-val"><b class="tabular">${value}</b>${sub ? `<span class="pt-fig-sub">${sub}</span>` : ""}</span></div>`;
    const them = `<i class="pt-key pt-key-them" aria-hidden="true"></i>`, you = `<i class="pt-key pt-key-you" aria-hidden="true"></i>`;
    const out = [];
    if (!off) {
      const why = kwUnknown();
      const blank = why ? `<span class="muted" title="${esc(t(KW_WHY[why]))}">—</span>` : "";
      if (why) [["Shared keywords"], ["Only them"], ["Only you"]].forEach(([label]) => out.push(fig(t(label), blank, "", t(KW_WHY[why]))));
      else {
      out.push(fig(t("Shared keywords"), figure(c.shared), c.shared ? esc(fill("{them} lead {they} · {you} lead {mine}", { them: t("Them"), they: num(c.they_ahead), you: t("You"), mine: num(c.i_ahead) })) : "", t("Keywords you both rank on in the results checked.")));
      out.push(fig(t("Only them"), figure(c.theirs_only), "", t("Keywords they rank on and you weren't found on.")));
      out.push(fig(t("Only you"), figure(c.mine_only), "", t("Keywords you rank on and they weren't found on.")));
      }
    }
    // The big number is theirs, and says so: "8  Them 8 · You 8", like the shared-keywords figure beside it. Yours is — until your site is read.
    const theirPages = p.crawl?.status === "blocked" ? dash : figure(f.pages);
    const pagesBoth = `${them}${t("Them")} ${theirPages} · ${you}${t("You")} ${known(f.my_pages) && f.my_pages > 0 ? num(f.my_pages) : dash}`;
    out.push(fig(t("Pages"), theirPages, pagesBoth, f.my_pages ? t("Pages found on each site.") : t("Yours are counted once your site is read.")));
    if (known(f.da) || known(f.my_da)) out.push(fig(t("Authority"), figure(f.da), known(f.my_da) ? `${you}${t("You")} ${num(f.my_da)}` : "", t("Moz Domain Authority.")));
    return `<section class="pt-strip" aria-label="${esc(t("How you compare"))}">${out.join("")}${acts.length ? `<div class="pt-answer-acts">${acts.join("")}</div>` : ""}</section>`;
  }

  // ---- the tabs ------------------------------------------------------------------------------
  function tabBar() {
    const now = currentTab();
    return `<div class="cp-tabs pt-tabs" role="tablist" aria-label="${esc(t("About this competitor"))}">${TABS.map(([id, label, ic]) => `<button class="cp-tab" role="tab" id="pt-tab-${id}" data-pt-tab="${id}" aria-selected="${id === now}" aria-controls="pt-panel" tabindex="${id === now ? 0 : -1}">${icon(ic)}${t(label)}</button>`).join("")}</div>`;
  }

  function panel() {
    const tab = currentTab(), p = S.p, ins = S.ins, parts = S.parts;
    if (tab === "pages") return pagesTab(p, ins);
    if (tab === "activity") return activityTab(p, ins, parts);
    if (tab === "site") return siteTab(p, ins);
    const off = p.tracking && p.tracking !== "on";
    return `<section class="card"><div class="cl-section-body" id="cl-keywords">${off ? COMP.trackingNote?.(p) ?? "" : parts.keywordsBody(p)}</div></section>`;
  }

  // Keywords: small marks beside a keyword, from the same checks. "Not captured" stays silent.
  function keywordMarks(k) {
    const ins = S.ins?.keywords || {};
    const out = [];
    const f = ins.features?.[k.keyword];
    if (f?.snippet === "them") out.push(`<span class="tag pt-mark" data-tip="${esc(t("They hold the featured snippet"))}">${icon("sparkles")}${t("Snippet")}</span>`);
    if (f?.snippet === "me") out.push(`<span class="tag pt-mark pt-mark-you" data-tip="${esc(t("You hold the featured snippet"))}">${icon("sparkles")}${t("Your snippet")}</span>`);
    if (f?.rich?.length) out.push(`<span class="tag pt-mark" data-tip="${esc(f.rich.map((r) => t(RICH[r] || r)).join(", "))}">${icon("circle-dot")}${t("Rich result")}</span>`);
    if (f?.ai) out.push(`<span class="tag pt-mark" data-tip="${esc(t("An AI Overview shows for this keyword"))}">${icon("sparkles")}AI</span>`);
    const pages = ins.cannibal?.[k.keyword];
    if (pages > 1) out.push(`<span class="tag pt-mark" data-tip="${esc(t("Their results for this keyword landed on different pages across checks."))}">${esc(many(pages, "{n} page", "{n} pages"))}</span>`);
    return out.length ? `<span class="pt-marks">${out.join("")}</span>` : "";
  }
  const RICH = { rating: "Star rating", faq: "FAQ", sitelinks: "Sitelinks", video: "Video" };

  // Pages: their strongest pages, their sections, and questions they answer.
  function pagesTab(p, ins) {
    if (!ins) return unavailable();
    const best = ins.best_pages || [];
    const sections = ins.sections || [];
    const questions = ins.questions || [];
    const bestTable = best.length ? bestPages(p, best) : `<p class="cl-none small sec">${t("None yet. Their strongest pages are the ones that rank for your keywords, so they appear after a ranking check.")}</p>`;
    const showMine = mineRead(ins);
    const sectionTable = sections.length ? sectionsBody(sections, showMine, p.host) : `<p class="cl-none small sec">${t("Sections appear once their pages are read.")}</p>`;
    const qs = Array.isArray(questions) ? { groups: [], total: 0, related: 0, judged: false } : questions;
    const questionList = qs.groups?.length ? questionsBody(p, qs, showMine) : `<p class="cl-none small sec">${t("No questions found in their pages' headings yet.")}</p>`;
    return `<section class="card"><div class="card-head"><h2>${t("Their strongest pages")}</h2><span class="end small muted">${t("By how many of your keywords each page ranks for")}</span></div><div class="cl-section-body">${bestTable}</div></section>
      <section class="card"><div class="card-head"><h2>${t("Where their pages are")}</h2><span class="end small muted">${t("Grouped by the first folder of each address")}</span></div><div class="cl-section-body">${sectionTable}</div></section>
      <section class="card"><div class="card-head"><h2>${t("Questions they answer")}</h2>${COMP.info("Read from the headings of their pages that end in a question mark. Author, tag, category and home pages are left out: their headings are other posts' titles.")}</div><div class="cl-section-body">${questionList}</div></section>`;
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
    const tools = best.length > 10 ? `<div class="pt-tools">${TP().search(BEST, t("Search their pages"))}</div>` : "";
    if (!rows.length) return `${tools}<p class="cl-none small sec">${t("No page matches the search.")}</p>`;
    return `${tools}<div class="cl-scroll"><table class="data cl-table pt-table" id="pt-best"><thead><tr><th scope="col">${t("Their page")}</th>${head("keywords", "Keywords")}${head("position", "Best position")}<th scope="col">${t("Your page")}</th></tr></thead><tbody>${page.rows.map((b) => `<tr>
          <td class="head-cell"><span class="cl-cell"><span class="t" dir="auto">${esc(b.title || COMP.shortUrl(b.url))}</span><span class="second">${COMP.link(b.url)}</span></span></td>
          <td class="c tabular" data-label="${esc(t("Keywords"))}">${num(b.keywords)}</td>
          <td class="c" data-label="${esc(t("Best position"))}">${COMP.pos(b.best_position)}</td>
          <td data-label="${esc(t("Your page"))}">${b.my_url ? `<span class="cl-cell"><span class="t" dir="auto">${esc(b.my_title || COMP.shortUrl(b.my_url))}</span><span class="second">${b.pair_id ? `<button class="link-btn" data-cl-pair="${b.pair_id}">${t("Compare")}</button>` : COMP.link(b.my_url)}</span></span>` : `<span class="pt-none">${t("No page")}</span> ${UI().taskButton({ title: fill("Write a page against {url}", { url: COMP.shortUrl(b.url) }), host: p.site?.host, source: { type: "competitor", label: p.host, host: p.site?.host, facts: [b.url, many(b.keywords, "{n} keyword", "{n} keywords")], link: `#competitors/list/${p.id}`, key: `best|${p.id}|${b.url}` } }, { label: "Task" })}`}</td>
        </tr>`).join("")}</tbody></table></div>${TP().footer(BEST, page, { noun: t("pages") })}`;
  }

  /* One plain sentence first, then the folders. "You" only when my pages are read. "Last change" only when one is known. */
  function sectionsBody(sections, showMine, host) {
    const total = sections.reduce((n, x) => n + (x.pages || 0), 0);
    const top = sections[0];
    const lead = top ? `<p class="pt-lead">${esc(fill("Most of their pages are in {path}: {n} of {total}.", { path: top.path, n: num(top.pages), total: num(total) }))}${top.new_90d ? ` ${esc(many(top.new_90d, "{n} of them is new in the last 90 days.", "{n} of them are new in the last 90 days."))}` : ""}</p>` : "";
    const changes = sections.some((x) => x.last_change);
    const head = `<th scope="col">${t("Folder")}</th><th scope="col" class="c">${t("Their pages")}</th>${showMine ? `<th scope="col" class="c">${t("Your pages")}</th>` : ""}<th scope="col" class="c">${t("New in 90 days")}</th>${changes ? `<th scope="col">${t("Last change")}</th>` : ""}`;
    const rows = sections.map((x) => `<tr>
        <td class="head-cell">${PageLink.html(x.path, { host, cls: "mono", dir: "ltr" })}</td>
        <td class="c tabular" data-label="${esc(t("Their pages"))}">${num(x.pages)}</td>
        ${showMine ? `<td class="c tabular" data-label="${esc(t("Your pages"))}">${num(x.my_pages || 0)}</td>` : ""}
        <td class="c tabular" data-label="${esc(t("New in 90 days"))}">${x.new_90d ? `<b>${num(x.new_90d)}</b>` : `<span class="muted">0</span>`}</td>
        ${changes ? `<td data-label="${esc(t("Last change"))}"><span class="nowrap">${x.last_change ? esc(COMP.ago(x.last_change)) : dash}</span></td>` : ""}
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
    const lead = !qs.judged
      ? t("Grouped by the page that answers them. Once Search Console is connected or you add keywords, the ones on your topics come first and the rest are folded away.")
      : related.length
        ? fill("{n} of their questions are on your topics, on {pages}. Each row is one page of theirs: answer its questions on your site in one task.", { n: num(qs.related), pages: many(related.length, "{n} page", "{n} pages") })
        : t("None of their questions are on your topics: they write about other subjects.");
    const unread = showMine ? "" : ` ${t("Your own pages haven't been read yet, so some of these may already be on your site.")}`;
    const row = (g) => {
      const open = S.qOpen?.has(g.url);
      const list = open ? g.questions : g.questions.slice(0, PAGE_QS);
      const hidden = g.questions.length - list.length;
      const task = UI().taskButton({
        title: g.questions.length === 1 ? fill("Answer \"{q}\" on your site", { q: g.questions[0] }) : fill("Answer {n} questions from {page} on your site", { n: num(g.questions.length), page: COMP.shortUrl(g.url) }),
        host,
        source: { type: "competitor", label: p.host, host, facts: [...g.questions, g.url], link: `#competitors/list/${p.id}`, key: `questions|${p.id}|${g.url}` },
      }, { label: "Task" });
      return `<li class="pt-qpage">
        <div class="pt-qpage-head"><span class="cl-cell"><span class="t" dir="auto">${esc(g.title || COMP.shortUrl(g.url))}</span><span class="second">${COMP.link(g.url)}</span></span><span class="pt-act">${task}</span></div>
        <ul class="pt-qlist">${list.map((q) => `<li dir="auto">${esc(q)}</li>`).join("")}</ul>
        ${hidden > 0 ? `<button class="link-btn small" data-pt-qpage="${esc(g.url)}">${esc(fill("+{n} more", { n: num(hidden) }))}</button>` : open && g.questions.length > PAGE_QS ? `<button class="link-btn small" data-pt-qpage="${esc(g.url)}">${t("Show fewer")}</button>` : ""}
      </li>`;
    };
    // Pages of 25, like every long list, and one search through their pages and questions for both lists.
    const found = (list) => list.filter((g) => TP().matches(QS, g.title, g.url, ...g.questions));
    const first = qs.judged ? related : qs.groups;
    const hits = found(first), page = TP().view(QS, hits);
    const otherHits = found(others), otherPage = TP().view(QO, otherHits);
    const tools = qs.groups.length > 10 ? `<div class="pt-tools">${TP().search(QS, t("Search their pages and questions"))}</div>` : "";
    const noHit = `<p class="cl-none small sec">${t("No page matches the search.")}</p>`;
    const main = hits.length ? `<div class="pt-qmain"><ul class="rows pt-qpages" id="pt-questions">${page.rows.map(row).join("")}</ul>${TP().footer(QS, page, { noun: t("pages") })}</div>` : first.length ? noHit : "";
    const otherBlock = qs.judged && others.length
      ? `<div class="pt-qother">${S.qOthers
          ? `<p class="small sec">${esc(many(otherCount, "{n} question on other topics", "{n} questions on other topics"))} <button class="link-btn small" data-pt-q-others>${t("Hide them")}</button></p>${otherHits.length ? `<ul class="rows pt-qpages pt-qpages-other">${otherPage.rows.map(row).join("")}</ul>${TP().footer(QO, otherPage, { noun: t("pages") })}` : noHit}`
          : `<button class="btn btn-small btn-ghost" data-pt-q-others>${esc(many(otherCount, "Show {n} question on other topics", "Show {n} questions on other topics"))}</button>`}</div>`
      : "";
    return `<p class="pt-lead">${esc(lead + unread)}</p>${tools}${main}${otherBlock}`;
  }

  // Activity: one sentence on how fast they publish, the months as bars with their numbers on, then the timeline.
  function activityTab(p, ins, parts) {
    const r = ins?.rhythm;
    const showMine = mineRead(ins);
    S.showMine = showMine;
    const months = r?.months || [];
    const total = months.reduce((n, m) => n + (m.theirs || 0), 0);
    const peak = months.reduce((best, m) => ((m.theirs || 0) > (best?.theirs || 0) ? m : best), null);
    const myTotal = showMine ? months.reduce((n, m) => n + (m.mine || 0), 0) : null;
    const said = [];
    if (r && months.length) {
      const year = total ? many(total, "They added {n} page in the last 12 months", "They added {n} pages in the last 12 months") + (peak && total > 1 ? ` ${fill("(most in {month}: {k})", { month: longMonth(peak.month), k: num(peak.theirs) })}` : "") : t("They added no pages in the last 12 months");
      said.push(`${year}${showMine ? `; ${many(myTotal, "you added {n}", "you added {n}")}` : ""}.`);
      const recent = r.new_30d ? many(r.new_30d, "{n} new", "{n} new") : t("nothing new");
      const gone = r.removed_30d ? many(r.removed_30d, "{n} removed", "{n} removed") : t("nothing removed");
      said.push(fill("In the last 30 days: {recent}, {gone}.", { recent, gone }));
      if (known(r.updated_12m?.theirs)) said.push(fill("{share} of their pages were updated in the last year.", { share: share(r.updated_12m.theirs) }));
    }
    const lead = said.length ? `<p class="pt-lead">${esc(said.join(" "))}</p>` : "";
    const busyMonths = months.filter((m) => (m.theirs || 0) + (showMine ? m.mine || 0 : 0) > 0);
    const asWords = months.filter((m) => (m.theirs || 0) || (showMine && m.mine)).map((m) => `${esc(longMonth(m.month))}: ${num(m.theirs || 0)}${showMine ? ` (${t("you")} ${num(m.mine || 0)})` : ""}`).join(" · ");
    // A chart needs a shape: under three months with pages, the figures are said in a line instead of an empty 12-month axis.
    const chart = !months.length ? `<p class="cl-none small sec">${t("The months fill in once pages are read. A page's date comes from the page itself, the Wayback Machine, or the day the app first saw it.")}</p>`
      : busyMonths.length < 3 ? (busyMonths.length ? `<p class="small sec pt-few-months">${asWords}.</p>` : "")
      : monthChart(months, showMine);
    const years = historyBlock(ins);
    return `<section class="card"><div class="card-head"><h2>${t("How fast they publish")}</h2><span class="end small muted">${t("New pages each month, from the dates on their pages")}</span></div><div class="cl-section-body">${lead}${chart}${showMine || !months.length ? "" : notReadNote()}</div></section>
      ${years}
      <section class="card" aria-label="${esc(t("Timeline"))}"><div class="card-head"><h2>${t("Timeline")}</h2>${COMP.info("Ranking moves only compare two checks by the same tool, from the same place, so a change of tool never reads as a move.")}</div>
        <div class="cl-section-body" id="cl-timeline">${parts.timelineBody(p)}</div></section>`;
  }

  /* Bars drawn in HTML at a fixed height, so the numbers stay the same size on any screen. The key above the chart
     is the facts row, so there's no second legend. A hover label per month, and the same numbers as a short table. */
  function monthChart(months, showMine) {
    const max = Math.max(1, ...months.flatMap((m) => [m.theirs || 0, showMine ? m.mine || 0 : 0]));
    const step = niceStep(max), ceil = Math.ceil(max / step) * step;
    const height = (v) => (v ? `max(3px, ${(v / ceil) * 100}%)` : "0");
    const ticks = [];
    for (let v = 0; v <= ceil; v += step) ticks.push(`<span class="pt-tick" style="bottom:${(v / ceil) * 100}%"><span class="tabular">${num(v)}</span></span>`);
    const cols = months.map((m, i) => `<div class="pt-month" data-pt-month="${i}"><div class="pt-pair"><i class="pt-bar-them" style="height:${height(m.theirs)}">${m.theirs ? `<b class="pt-bar-val tabular">${num(m.theirs)}</b>` : ""}</i>${showMine ? `<i class="pt-bar-you" style="height:${height(m.mine)}">${m.mine ? `<b class="pt-bar-val tabular">${num(m.mine)}</b>` : ""}</i>` : ""}</div><span class="pt-mlabel">${esc(shortMonth(m.month))}</span></div>`).join("");
    const label = showMine ? t("New pages each month, them against you") : t("Their new pages each month");
    const table = `<details class="pt-as-table"><summary class="small">${t("See these numbers as a table")}</summary><div class="cl-scroll"><table class="data cl-table pt-narrow"><thead><tr><th scope="col">${t("Month")}</th><th scope="col" class="c">${t("Them")}</th>${showMine ? `<th scope="col" class="c">${t("You")}</th>` : ""}</tr></thead><tbody>${months.map((m) => `<tr><td class="head-cell">${esc(longMonth(m.month))}</td><td class="c tabular">${num(m.theirs || 0)}</td>${showMine ? `<td class="c tabular">${num(m.mine || 0)}</td>` : ""}</tr>`).join("")}</tbody></table></div></details>`;
    const key = showMine ? `<p class="pt-chart-key small sec"><span><i class="pt-key pt-key-them" aria-hidden="true"></i>${t("Them")}</span><span><i class="pt-key pt-key-you" aria-hidden="true"></i>${t("You")}</span></p>` : "";
    return `${key}<div class="pt-chart-wrap"><div class="pt-chart${showMine ? " pt-two" : ""}" role="img" aria-label="${esc(label)}"><div class="pt-plot">${ticks.join("")}<div class="pt-cols">${cols}</div></div></div><div class="pt-tip" id="pt-tip" hidden></div></div>${table}`;
  }
  const niceStep = (max) => { const raw = max / 4; const mag = 10 ** Math.floor(Math.log10(raw)); const n = raw / mag; return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag); };
  const shortMonth = (ym) => { try { return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(UI().state.lang || undefined, { month: "short", timeZone: "UTC" }); } catch { return ym; } };
  const longMonth = (ym) => { try { return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(UI().state.lang || undefined, { month: "long", year: "numeric", timeZone: "UTC" }); } catch { return ym; } };

  /* Their site's age, in one sentence: online since, domain registered, how much the Wayback Machine kept.
     The per-year bars count what the archive saved, not what they published, so they sit folded with that said. */
  function historyBlock(ins) {
    const f = ins?.facts || {}, h = f.history || {}, years = ins?.rhythm?.by_year || [];
    const bits = [];
    if (f.first_capture) bits.push(fill("Online since {date}", { date: monthYear(f.first_capture) }));
    if (f.registered_on) bits.push(fill("domain registered {date}", { date: monthYear(f.registered_on) }));
    let first = bits.join(", ");
    if (first) first = `${first[0].toUpperCase()}${first.slice(1)}.`;
    let body;
    if (h.status === "ok" && years.length) {
      const max = Math.max(1, ...years.map((x) => x.pages));
      const busiest = years.reduce((b, x) => (x.pages > b.pages ? x : b), years[0]);
      const said = `${first} ${fill("The Wayback Machine has saved {n} of their pages, most of them first in {year}.", { n: num(h.archived_pages || 0), year: String(busiest.year) })}${h.capped ? ` ${t("The archive holds more than the first 5,000 read here.")}` : ""}`;
      body = `<p class="pt-lead">${esc(said.trim())}</p>
        <details class="pt-as-table"><summary class="small">${t("Pages first saved by the archive, each year")}</summary>
          <p class="small sec">${t("The archive doesn't save every page, so these counts are lower than the dates on their pages above.")}</p>
          <ul class="pt-years">${years.map((x) => `<li><span class="tabular">${esc(String(x.year))}</span><span class="pt-year-bar" style="--w:${(x.pages / max) * 100}%"><i class="pt-key-them"></i></span><span class="tabular">${num(x.pages)}</span></li>`).join("")}</ul></details>`;
    } else {
      const why = h.status === "failed" ? t("The Wayback Machine didn't answer this time. It tries again tomorrow.")
        : h.status === "ok" ? t("The Wayback Machine has no copy of this site.")
        : h.message ? t("The Wayback Machine is busy. The app asks again in a few minutes.")
        : t("Looking them up in the Wayback Machine. It takes a minute or two after a competitor is added, then it's checked again each month.");
      body = `${first ? `<p class="pt-lead">${esc(first)}</p>` : ""}<p class="cl-none small sec">${esc(why)}</p>`;
    }
    const renew = f.expires_on ? `<p class="small muted pt-dates">${esc(fill("Their domain renews by {date}.", { date: UI().fmtDateOnly(`${f.expires_on}T00:00:00Z`) }))}</p>` : "";
    return `<section class="card"><div class="card-head"><h2>${t("How old their site is")}</h2><span class="end small muted">${t("From the Wayback Machine and the domain registry")}</span></div><div class="cl-section-body">${body}${renew}</div></section>`;
  }

  // Their site: authority, who links to them, and how they build pages.
  function siteTab(p, ins) {
    if (!ins) return unavailable();
    const f = ins.facts || {}, l = ins.links || {};
    const row = (label, mine, theirs) => `<tr><th scope="row" class="head-cell">${esc(label)}</th><td class="c tabular" data-label="${esc(t("You"))}">${mine}</td><td class="c tabular" data-label="${esc(t("Them"))}">${theirs}</td></tr>`;
    const authority = strengthBody(p, f, l, row);
    const top = l.top || [];
    const links = top.length
      ? `<ul class="rows pt-links">${top.slice(0, 10).map((d) => `<li><div class="what"><span class="with-logo">${UI().siteLogo(d.domain, 16)}<span class="logo-text mono" dir="ltr">${esc(d.domain)}</span></span>${d.spam ? ` ${UI().status("warn", t("Looks like spam"))}` : ""}</div><div class="acts small muted tabular">${known(d.authority) ? `${num(d.authority)} · ${esc((d.authority_label || t("Authority")).replace(/^Authority score\s*\(([^)]+)\)$/i, "$1"))}` : ""}</div></li>`).join("")}</ul>
        ${l.not_to_me ? `<p class="pt-gap-line">${esc(many(l.not_to_me, "{n} of these doesn't link to you.", "{n} of these don't link to you."))} <button class="btn btn-small" data-pt-gaps>${icon("link-2")}${t("Open Link gaps")}</button></p>` : ""}`
      : `<div class="pt-empty-links"><p class="small sec">${esc(fill("No linking sites known yet. Upload a CSV of links to {host} from any backlink tool (Semrush, Ubersuggest, Ahrefs…), or add the ones you know one by one.", { host: p.host }))}</p><div class="pt-btns">${linkButtons(true)}</div></div>`;
    const build = (ins.build || []);
    const main = build.filter((b) => !b.more), more = build.filter((b) => b.more);
    const showMine = mineRead(ins);
    const buildRow = (b) => (showMine ? row(t(b.label), value(b, b.mine), value(b, b.theirs)) : `<tr><th scope="row" class="head-cell">${esc(t(b.label))}</th><td class="c tabular" data-label="${esc(t("Them"))}">${value(b, b.theirs)}</td></tr>`);
    const buildTable = build.length
      ? `<table class="data cl-table pt-table pt-vs pt-narrow"><thead><tr><th scope="col">${t("What")}</th>${showMine ? `<th scope="col" class="c">${t("You")}</th>` : ""}<th scope="col" class="c">${t("Them")}</th></tr></thead><tbody>${main.map(buildRow).join("")}${S.buildMore ? more.map(buildRow).join("") : ""}</tbody></table>${showMine ? "" : notReadNote()}
         ${more.length ? `<p class="cl-more"><button class="btn btn-small" data-pt-build-more aria-expanded="${S.buildMore}">${t(S.buildMore ? "Fewer details" : "More details")}</button></p>` : ""}`
      : `<p class="cl-none small sec">${t("These facts appear once their pages are read.")}</p>`;
    return `<div class="pt-grid"><section class="card"><div class="card-head"><h2>${t("How strong they are")}</h2></div><div class="cl-section-body"><div class="cl-scroll">${authority}</div></div></section>
      <section class="card"><div class="card-head"><h2>${t("Who links to them")}</h2>${known(l.linking_domains) ? `<span class="tag tabular">${num(l.linking_domains)}</span>` : ""}${top.length ? `<span class="end pt-btns">${linkButtons(false)}</span>` : ""}</div><div class="cl-section-body">${links}</div></section></div>
      <section class="card"><div class="card-head"><h2>${t("How they build pages")}</h2>${COMP.info("Facts read from the pages, not advice")}</div><div class="cl-section-body"><div class="cl-scroll">${buildTable}</div></div></section>`;
  }

  /* Each figure says where it comes from. Rows with nothing yet aren't a wall of dashes: they're listed under the
     table with the reason and the one thing that fills them. */
  function strengthBody(p, f, l, row) {
    const myHost = COMP.site?.()?.host || p.site?.host || "";
    const mozWait = !known(f.da) && !known(f.my_da);
    const theirLinks = known(l.linking_domains) ? l.linking_domains : f.moz_links;
    const myLinks = known(l.my_linking_domains) ? l.my_linking_domains : f.my_moz_links;
    const linkSource = known(l.linking_domains) ? t("from Link gaps uploads") : known(f.moz_links) ? t("from Moz") : "";
    const h = f.history?.status;
    const items = [
      { label: t("Moz Domain Authority"), mine: f.my_da, theirs: f.da, show: figure, why: "moz" },
      { label: t("Websites linking to the site"), sub: linkSource, mine: myLinks, theirs: theirLinks, show: figure, why: "links", needTheirs: true },
      { label: t("Popularity (Cloudflare)"), mine: f.my_popularity, theirs: f.popularity, show: (v) => (v ? esc(v) : dash), why: "moz" },
      { label: t("Domain registered"), mine: f.my_registered_on, theirs: f.registered_on, show: (v) => (v ? esc(monthYear(v)) : dash), why: "registry" },
    ];
    // A row is only a comparison when their side is known; mine alone (my Backlinks list against nothing) moves to "Not known yet".
    const shows = (x) => (x.needTheirs ? known(x.theirs) : known(x.mine) || known(x.theirs));
    const has = items.filter(shows);
    const missing = items.filter((x) => !shows(x));
    const said = [];
    if (f.registered_on && f.my_registered_on) {
      const them = monthYear(f.registered_on), you = monthYear(f.my_registered_on);
      said.push(them === you ? fill("Both domains were registered in {month}.", { month: them })
        : fill(f.registered_on < f.my_registered_on ? "Their domain is older than yours: {them} against {you}." : "Your domain is older than theirs: {you} against {them}.", { them, you }));
    }
    if (known(f.da) && known(f.my_da)) said.push(fill("Moz rates them {them} out of 100, you {you}.", { them: num(f.da), you: num(f.my_da) }));
    if (known(theirLinks) && known(myLinks)) said.push(fill("{them} websites link to them, {you} to you.", { them: num(theirLinks), you: num(myLinks) }));
    else if (known(theirLinks)) said.push(many(theirLinks, "{n} website links to them.", "{n} websites link to them."));
    if (f.registered_on && !f.my_registered_on) said.push(fill("Their domain was registered in {month}.", { month: monthYear(f.registered_on) }));
    const lead = said.length ? `<p class="pt-lead">${esc(said.join(" "))}</p>` : "";
    // "You" only when at least one of my figures is known: a column of dashes says nothing.
    const withMine = has.some((x) => known(x.mine));
    const line = (x) => (withMine ? row(x.label, x.show(x.mine), x.show(x.theirs)) : `<tr><th scope="row" class="head-cell">${esc(x.label)}</th><td class="c tabular" data-label="${esc(t("Them"))}">${x.show(x.theirs)}</td></tr>`);
    const table = has.length
      ? `<table class="data cl-table pt-table pt-vs pt-narrow"><thead><tr><th scope="col">${t("What")}</th>${withMine ? `<th scope="col" class="c">${t("You")}</th>` : ""}<th scope="col" class="c">${t("Them")}</th></tr></thead><tbody>
          ${has.map((x) => line(x).replace(`${esc(x.label)}</th>`, `${esc(x.label)}${x.sub ? `<span class="second small muted">${esc(x.sub)}</span>` : ""}</th>`)).join("")}
        </tbody></table>`
      : "";
    const why = {
      moz: () => `<li><div class="what"><b>${t("Authority and popularity")}</b><span class="small sec">${t("From Moz and Cloudflare, free, once a month. Not looked up yet.")}</span>${S.strengthError ? `<span class="small crit" role="alert">${esc(t(S.strengthError))}</span>` : ""}</div><div class="acts"><button class="btn btn-small" data-pt-strength-fetch ${S.strengthBusy ? 'disabled aria-busy="true"' : ""}>${icon(S.strengthBusy ? "loader" : "download")}${t(S.strengthBusy ? "Fetching…" : "Get these numbers")}</button></div></li>`,
      links: () => `<li><div class="what"><b>${t("Websites linking to them")}</b><span class="small sec">${esc(known(myLinks) ? fill("You have {n} in your Backlinks list. Theirs aren't known: upload a list of their links (a CSV from any backlink tool).", { n: num(myLinks) }) : t("Not known: upload a list of their links (a CSV from any backlink tool)."))}</span></div><div class="acts"><button class="btn btn-small" data-pt-gaps>${icon("link-2")}${t("Open Link gaps")}</button></div></li>`,
      registry: () => `<li><div class="what"><b>${t("Domain registered")}</b><span class="small sec">${t(h === "failed" ? "The domain registry didn't answer. The app asks again tomorrow." : "Being looked up in the domain registry. It's ready a few minutes after a competitor is added.")}</span></div></li>`,
    };
    const kinds = [...new Set(missing.map((x) => x.why))];
    const list = kinds.length ? `<div class="pt-missing">${has.length ? `<h3 class="small sec">${t("Not known yet")}</h3>` : `<p class="pt-lead">${t("None of these are known yet. Here's what fills each one.")}</p>`}<ul class="rows">${kinds.map((k) => why[k]()).join("")}</ul></div>` : "";
    void mozWait; void myHost;
    return `${lead}${table}${list}`;
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
        <p class="small sec" style="margin-bottom:12px">${t("A CSV of the sites that link to them, exported from any backlink tool. It needs a column with a link or a domain. Spam is flagged, never removed.")}</p>
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
  const unavailable = () => `<section class="card"><p class="cl-none small sec">${t("This part didn't load. Everything else on the page still works.")}</p></section>`;

  // ---- drawing and events -------------------------------------------------------------------------
  /* comp-list.js calls this inside the profile. parts: { keywordsBody(p), timelineBody(p) }. */
  function body(p, ins, parts) {
    Object.assign(S, { p, ins, parts });
    if (S.shownId !== p.id) {
      S.shownId = p.id; S.tab = "keywords"; S.buildMore = false; S.qOpen = new Set(); S.qOthers = false; S.bestSort = null;
      [BEST, QS, QO].forEach((key) => { TP().state(key).q = ""; TP().reset(key); }); // another competitor starts on page 1, unsearched
    }
    [BEST, QS, QO].forEach((key) => TP().on(key, () => repaint()));
    return `${tabBar()}<div class="pt-panel" id="pt-panel" role="tabpanel" aria-labelledby="pt-tab-${currentTab()}">${panel()}</div>`;
  }
  /* comp-list.js puts this inside the header card, under the name: the answer, then the figures. */
  function headBlock(p, ins) {
    Object.assign(S, { p, ins, kwShown: kwUnknown() });
    const said = answer(p, ins);
    return `${said.html}${tiles(p, ins, said.acts)}`;
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
    const tip = UI().$("#pt-tip"), wrap = g.closest(".pt-chart-wrap");
    const months = S.ins?.rhythm?.months || [];
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
    const tip = UI().$("#pt-tip");
    if (tip) tip.hidden = true;
    UI().$$(".pt-month.dim").forEach((g) => g.classList.remove("dim"));
  }

  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener("click", (e) => {
      const hit = (sel) => e.target.closest?.(sel);
      let el;
      if ((el = hit("[data-pt-tab]"))) { pickTab(el.dataset.ptTab); return; }
      if (hit("[data-pt-only-them]")) { S.parts?.showKeywords?.("theirs_only"); pickTab("keywords", { focus: false }); UI().$('[data-cl-kw="theirs_only"]')?.focus({ preventScroll: false }); return; }
      if ((el = hit("[data-pt-go]"))) { UI().go?.(el.dataset.ptGo); return; }
      if (hit("[data-pt-gaps]")) { COMP.open("gaps"); return; }
      if ((el = hit("[data-pt-best-sort]"))) {
        const id = el.dataset.ptBestSort, first = BEST_SORT[id][1];
        S.bestSort = S.bestSort?.id !== id ? { id, dir: first } : S.bestSort.dir === first ? { id, dir: first === "asc" ? "desc" : "asc" } : null;
        TP().reset(BEST);
        repaint(() => UI().$(`[data-pt-best-sort="${id}"]`)?.focus({ preventScroll: true }));
        return;
      }
      if ((el = hit("[data-pt-qpage]"))) { const url = el.dataset.ptQpage; S.qOpen ||= new Set(); S.qOpen.has(url) ? S.qOpen.delete(url) : S.qOpen.add(url); repaint(() => UI().$(`[data-pt-qpage="${CSS.escape(url)}"]`)?.focus({ preventScroll: true })); return; }
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
        { key: "words", label: "Average words per page", kind: "number", mine: p.compare?.pages?.mine?.average_words ?? 640, theirs: 1279 },
        { key: "title", label: "Average title length", kind: "number", mine: 52, theirs: 61 },
        { key: "meta", label: "Pages with a meta description", kind: "share", mine: 0.9, theirs: 1 },
        { key: "schema", label: "Structured data", kind: "list", mine: [["Organization", 1]], theirs: [["FAQPage", 0.45], ["Article", 0.8], ["BreadcrumbList", 1]] },
        { key: "questions", label: "Pages with questions in headings", kind: "share", mine: 0.2, theirs: 0.55 },
        { key: "videos", label: "Pages with a video", kind: "share", mine: 0, theirs: 0.12 },
        { key: "dupes", label: "Pages sharing a title with another", kind: "number", mine: 0, theirs: 3 },
        { key: "noindex", label: "Pages hidden from search (noindex)", kind: "number", mine: 1, theirs: 0 },
        { key: "sitemap", label: "Pages in the sitemap, of pages found", kind: "share", mine: 1, theirs: 0.86 },
        { key: "cms", label: "Built with", kind: "text", mine: "Astro", theirs: "WordPress" },
        { key: "alt", label: "Images without alt text", kind: "share", mine: 0.05, theirs: 0.3, more: true },
        { key: "internal", label: "Average links to their own pages", kind: "number", mine: 24, theirs: 41, more: true },
        { key: "hreflang", label: "Language versions (hreflang)", kind: "list", mine: [], theirs: ["fr", "en"], more: true },
        { key: "tables", label: "Pages with a table", kind: "share", mine: 0.1, theirs: 0.35, more: true },
      ],
      keywords: { features, cannibal },
    };
  }

  // Pages and searches on the long lists (10 Nov).
  Object.assign(window.FR, {
    "Search their pages": "Rechercher une de leurs pages", "Search their pages and questions": "Rechercher une page ou une question",
    "No page matches the search.": "Aucune page ne correspond à la recherche.", "pages": "pages",
  });

  // The 10 Nov rework of Activity, questions and strength.
  Object.assign(window.FR, {
    "No questions found in their pages' headings yet.": "Aucune question trouvée dans les titres de leurs pages pour l'instant.",
    "Questions they answer": "Questions auxquelles ils répondent",
    "Read from the headings of their pages that end in a question mark. Author, tag, category and home pages are left out: their headings are other posts' titles.": "Lues dans les titres de leurs pages qui finissent par un point d'interrogation. Les pages d'auteur, d'étiquette, de catégorie et d'accueil sont exclues : leurs titres sont ceux d'autres articles.",
    "Grouped by the page that answers them. Once Search Console is connected or you add keywords, the ones on your topics come first and the rest are folded away.": "Regroupées par la page qui y répond. Une fois Search Console connecté ou des mots-clés ajoutés, celles sur vos sujets passent en premier et les autres sont repliées.",
    "{n} of their questions are on your topics, on {pages}. Each row is one page of theirs: answer its questions on your site in one task.": "{n} de leurs questions portent sur vos sujets, sur {pages}. Chaque ligne est une de leurs pages : répondez à ses questions sur votre site en une seule tâche.",
    "None of their questions are on your topics: they write about other subjects.": "Aucune de leurs questions ne porte sur vos sujets : ils écrivent sur autre chose.",
    "Your own pages haven't been read yet, so some of these may already be on your site.": "Vos pages n'ont pas encore été lues, certaines de ces questions sont peut-être déjà sur votre site.",
    "Answer {n} questions from {page} on your site": "Répondre sur votre site aux {n} questions de {page}",
    "+{n} more": "+{n} de plus",
    "Show {n} more page": "Afficher {n} page de plus",
    "Show {n} more pages": "Afficher {n} pages de plus",
    "{n} question on other topics": "{n} question sur d'autres sujets",
    "{n} questions on other topics": "{n} questions sur d'autres sujets",
    "Show {n} question on other topics": "Afficher {n} question sur d'autres sujets",
    "Show {n} questions on other topics": "Afficher {n} questions sur d'autres sujets",
    "Hide them": "Les masquer",
    "They added {n} page in the last 12 months": "Ils ont ajouté {n} page en 12 mois",
    "They added {n} pages in the last 12 months": "Ils ont ajouté {n} pages en 12 mois",
    "(most in {month}: {k})": "(surtout en {month} : {k})",
    "They added no pages in the last 12 months": "Ils n'ont ajouté aucune page en 12 mois",
    "you added {n}": "vous en avez ajouté {n}",
    "{n} new": "{n} nouvelle(s)", "nothing new": "rien de nouveau",
    "In the last 30 days: {recent}, {gone}.": "Sur les 30 derniers jours : {recent}, {gone}.",
    "{n} removed": "{n} retirée(s)",
    "nothing removed": "rien de retiré",
    "{share} of their pages were updated in the last year.": "{share} de leurs pages ont été mises à jour dans l'année.",
    "How fast they publish": "À quel rythme ils publient",
    "New pages each month, from the dates on their pages": "Nouvelles pages par mois, d'après les dates de leurs pages",
    "you": "vous",
    "domain registered {date}": "domaine enregistré en {date}",
    "The Wayback Machine has saved {n} of their pages, most of them first in {year}.": "La Wayback Machine a gardé {n} de leurs pages, la plupart vues pour la première fois en {year}.",
    "Pages first saved by the archive, each year": "Pages gardées pour la première fois par l'archive, par an",
    "The archive doesn't save every page, so these counts are lower than the dates on their pages above.": "L'archive ne garde pas toutes les pages, ces chiffres sont donc plus bas que les dates de leurs pages plus haut.",
    "Their domain renews by {date}.": "Leur domaine est à renouveler avant le {date}.",
    "How old their site is": "L'âge de leur site",
    "From the Wayback Machine and the domain registry": "D'après la Wayback Machine et le registre des domaines",
    "Both domains were registered in {month}.": "Les deux domaines ont été enregistrés en {month}.",
    "{n} website links to them.": "{n} site fait un lien vers eux.", "{n} websites link to them.": "{n} sites font un lien vers eux.",
    "Their domain was registered in {month}.": "Leur domaine a été enregistré en {month}.",
    "Websites linking to the site": "Sites qui font un lien vers le site",
    "Their domain is older than yours: {them} against {you}.": "Leur domaine est plus ancien que le vôtre : {them} contre {you}.",
    "Your domain is older than theirs: {you} against {them}.": "Votre domaine est plus ancien que le leur : {you} contre {them}.",
    "Moz rates them {them} out of 100, you {you}.": "Moz leur donne {them} sur 100, à vous {you}.",
    "{them} websites link to them, {you} to you.": "{them} sites font un lien vers eux, {you} vers vous.",
    "Authority and popularity": "Autorité et popularité",
    "From Moz and Cloudflare, free, once a month. Not looked up yet.": "Par Moz et Cloudflare, gratuit, une fois par mois. Pas encore cherché.",
    "Websites linking to them": "Sites qui font un lien vers eux",
    "You have {n} in your Backlinks list. Theirs aren't known: upload a list of their links (a CSV from any backlink tool).": "Vous en avez {n} dans votre liste de backlinks. Les leurs ne sont pas connus : importez une liste de leurs liens (un CSV de n'importe quel outil de backlinks).",
    "Not known: upload a list of their links (a CSV from any backlink tool).": "Inconnu : importez une liste de leurs liens (un CSV de n'importe quel outil de backlinks).",
  });

  Object.assign(window.FR, {
    "There's no keyword list for this site yet.": "Ce site n'a pas encore de liste de mots-clés.",
    "This site's keywords haven't been checked yet.": "Les mots-clés de ce site n'ont pas encore été vérifiés.",
    "{them} lead {they} · {you} lead {mine}": "{them} devant sur {they} · {you} devant sur {mine}",
    "Keywords you both rank on in the results checked.": "Mots-clés sur lesquels vous vous classez tous les deux dans les résultats vérifiés.",
    "Keywords they rank on and you weren't found on.": "Mots-clés où ils se classent et où vous êtes introuvable.",
    "Keywords you rank on and they weren't found on.": "Mots-clés où vous vous classez et où ils sont introuvables.",
    "Pages found on each site.": "Pages trouvées sur chaque site.",
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
    "No ranking check has seen you both yet.": "Aucune vérification de classement ne vous a encore vus tous les deux.", "Your own site hasn't been read yet, so its pages can't be compared.": "Votre site n'a pas encore été lu, donc ses pages ne peuvent pas être comparées.",
    "See the {n} keyword": "Voir le mot-clé", "See the {n} keywords": "Voir les {n} mots-clés", "Check your keywords": "Vérifier vos mots-clés",
    "Online since {date}": "En ligne depuis {date}", "DA {n}": "DA {n}", "{n} page": "{n} page", "{n} pages": "{n} pages",
    "Shared keywords": "Mots-clés communs", "You're ahead on {mine}, they're ahead on {they}.": "Vous êtes devant sur {mine}, eux sur {they}.", "Authority": "Autorité", "Moz Domain Authority.": "Domain Authority de Moz.",
    "Mark the domain important under Backlinks to get its Moz score.": "Marquez le domaine comme important dans Backlinks pour obtenir son score Moz.", "Yours are counted once your site is read.": "Les vôtres sont comptées une fois votre site lu.",
    "They hold the featured snippet": "Ils ont l'extrait optimisé", "You hold the featured snippet": "Vous avez l'extrait optimisé", "Snippet": "Extrait", "Your snippet": "Votre extrait", "Rich result": "Résultat enrichi",
    "An AI Overview shows for this keyword": "Un aperçu IA s'affiche pour ce mot-clé", "Their results for this keyword landed on different pages across checks.": "Pour ce mot-clé, leurs résultats sont tombés sur des pages différentes selon les vérifications.",
    "Star rating": "Note en étoiles", "FAQ": "FAQ", "Sitelinks": "Liens de site", "Video": "Vidéo",
    "Their page": "Leur page", "Best position": "Meilleure position", "Your page": "Votre page", "No page": "Pas de page", "Write a page against {url}": "Écrire une page face à {url}",
    "None yet. Their strongest pages are the ones that rank for your keywords, so they appear after a ranking check.": "Rien pour l'instant. Leurs pages les plus fortes sont celles qui se classent sur vos mots-clés : elles apparaissent après une vérification.",
    "Section": "Rubrique", "Pages, them and you": "Pages, eux et vous", "New in 90 days": "Nouvelles en 90 jours", "Last change": "Dernier changement", "Sections appear once their pages are read.": "Les rubriques apparaissent une fois leurs pages lues.",
    "People also ask": "Autres questions posées", "In their headings": "Dans leurs titres", "Showing 30 of {n}.": "30 sur {n} affichées.",
    "None found yet. Questions come from their page headings and from Google's People also ask.": "Aucune pour l'instant. Les questions viennent de leurs titres de page et des « Autres questions posées » de Google.",
    "Their strongest pages": "Leurs pages les plus fortes", "By how many of your keywords each page ranks for": "Selon le nombre de vos mots-clés où chaque page se classe", "Their sections": "Leurs rubriques", "By the first folder of each address": "Selon le premier dossier de chaque adresse",
    "Questions they answer that you don't": "Questions auxquelles ils répondent et pas vous",
    "Pages updated in the last 12 months": "Pages mises à jour en 12 mois", "New pages in 30 days": "Nouvelles pages en 30 jours", "Pages removed in 30 days": "Pages retirées en 30 jours",
    "The months fill in once pages are read. A page's date comes from the page itself, the Wayback Machine, or the day the app first saw it.": "Les mois se remplissent une fois les pages lues. La date d'une page vient de la page elle-même, de la Wayback Machine, ou du jour où l'application l'a vue.",
    "New pages each month": "Nouvelles pages par mois", "Them against you, over 12 months": "Eux face à vous, sur 12 mois", "See these numbers as a table": "Voir ces chiffres en tableau", "Month": "Mois", "New pages each month, them against you": "Nouvelles pages par mois, eux face à vous",
    "First archived {date}. {n} of their pages are in the archive.": "Archivé pour la première fois le {date}. {n} de leurs pages sont dans l'archive.", "The archive holds more than the first 5,000 read here.": "L'archive en contient plus que les 5 000 premières lues ici.",
    "The Wayback Machine didn't answer this time. It tries again tomorrow.": "La Wayback Machine n'a pas répondu cette fois. Nouvel essai demain.", "The Wayback Machine has no copy of this site.": "La Wayback Machine n'a aucune copie de ce site.",
    "Looking them up in the Wayback Machine. It takes a minute or two after a competitor is added, then it's checked again each month.": "Recherche dans la Wayback Machine. Cela prend une à deux minutes après l'ajout d'un concurrent, puis c'est revérifié chaque mois.",
    "The Wayback Machine is busy. The app asks again in a few minutes.": "La Wayback Machine est occupée. L'application redemande dans quelques minutes.",
    "Domain registered {date}": "Domaine enregistré le {date}", "renews by {date}": "à renouveler avant le {date}", "How their site grew": "Comment leur site a grandi", "New pages each year, from the Wayback Machine": "Nouvelles pages par an, d'après la Wayback Machine",
    "What": "Quoi", "Moz Domain Authority": "Domain Authority de Moz", "Sites linking to them": "Sites qui font un lien vers eux", "Popularity (Cloudflare)": "Popularité (Cloudflare)", "Domain registered": "Domaine enregistré",
    "Looks like spam": "Ressemble à du spam", "{n} of these doesn't link to you.": "{n} d'entre eux ne fait pas de lien vers vous.", "{n} of these don't link to you.": "{n} d'entre eux ne font pas de lien vers vous.", "Open Link gaps": "Ouvrir les liens manquants",
    "No linking sites known yet. They come from a CSV uploaded in Link gaps.": "Aucun site liant connu pour l'instant. Ils viennent d'un CSV importé dans les liens manquants.",
    "More details": "Plus de détails", "Fewer details": "Moins de détails", "These facts appear once their pages are read.": "Ces faits apparaissent une fois leurs pages lues.",
    "How strong they are": "Leur force", "Upload their links": "Importer leurs liens", "Add a linking site": "Ajouter un site qui fait un lien", "Upload links to {host}": "Importer les liens vers {host}", "File": "Fichier", "Upload": "Importer", "Uploading…": "Import…",
    "No linking sites known yet. Upload a CSV of links to {host} from any backlink tool (Semrush, Ubersuggest, Ahrefs…), or add the ones you know one by one.": "Aucun site qui fait un lien n'est encore connu. Importez un CSV des liens vers {host} depuis n'importe quel outil de backlinks (Semrush, Ubersuggest, Ahrefs…), ou ajoutez un par un ceux que vous connaissez.",
    "A CSV of the sites that link to them, exported from any backlink tool. It needs a column with a link or a domain. Spam is flagged, never removed.": "Un CSV des sites qui font un lien vers eux, exporté de n'importe quel outil de backlinks. Il lui faut une colonne avec un lien ou un domaine. Le spam est signalé, jamais retiré.",
    "{n} linking sites added. Spam is checked next.": "{n} sites ajoutés. Le spam est vérifié ensuite.", "Where their pages are": "Où sont leurs pages", "Grouped by the first folder of each address": "Regroupées par le premier dossier de chaque adresse", "Folder": "Dossier", "Their pages": "Leurs pages", "Your pages": "Vos pages",
    "Most of their pages are in {path}: {n} of {total}.": "La plupart de leurs pages sont dans {path} : {n} sur {total}.", "{n} of them is new in the last 90 days.": "{n} est nouvelle sur les 90 derniers jours.", "{n} of them are new in the last 90 days.": "{n} sont nouvelles sur les 90 derniers jours.",
    "Only their pages are shown. Your own site's pages are read tonight for the first time, then your figures appear here.": "Seules leurs pages sont affichées. Les pages de votre site sont lues cette nuit pour la première fois, puis vos chiffres apparaissent ici.",
    "Only their pages are shown. Your own site's pages are being read for the first time. Your figures appear here when that's done.": "Seules leurs pages sont affichées. Les pages de votre site sont en cours de première lecture. Vos chiffres apparaissent ici une fois terminé.",
    "Only their pages are shown. Your own site couldn't be read. The app tries again tonight.": "Seules leurs pages sont affichées. Votre site n'a pas pu être lu. L'application réessaie cette nuit.",
    "Only their pages are shown. No pages of your site were found to compare.": "Seules leurs pages sont affichées. Aucune page de votre site n'a été trouvée pour comparer.",
    "Over the last 12 months": "Sur les 12 derniers mois", "Their new pages each month": "Leurs nouvelles pages par mois",
    "{n} question": "{n} question", "{n} questions": "{n} questions", "Question": "Question", "Where they answer it": "Où ils y répondent", "Answer \"{q}\" on your site": "Répondre à « {q} » sur votre site",
    "Showing {shown} of {total}": "{shown} sur {total} affichées", "Show {n} more": "En voir {n} de plus", "Show all": "Tout afficher", "All {total} shown": "Les {total} sont affichées", "Show fewer": "En voir moins",
    "from Link gaps uploads": "d'après les fichiers de Liens manquants", "from Moz": "d'après Moz", "Not known yet": "Pas encore connu", "None of these are known yet. Here's what fills each one.": "Rien de tout cela n'est encore connu. Voici ce qui remplit chaque ligne.",
    "Looked up by itself for each website, once a month, while free Moz rows last. Not here yet: the button gets it now.": "Consulté tout seul pour chaque site, une fois par mois, tant qu'il reste des lignes Moz gratuites. Pas encore là : le bouton le récupère tout de suite.",
    "Get these numbers": "Obtenir ces chiffres", "Fetching…": "Récupération…",
    "No list of their links yet. Upload one in Link gaps (a CSV from any backlink tool), or get Moz's count with the button above.": "Pas encore de liste de leurs liens. Importez-en une dans Link gaps (un CSV de n'importe quel outil de backlinks), ou obtenez le total de Moz avec le bouton ci-dessus.",
    "The domain registry didn't answer. The app asks again tomorrow.": "Le registre des domaines n'a pas répondu. L'application redemande demain.",
    "Being looked up in the domain registry. It's ready a few minutes after a competitor is added.": "Recherche en cours dans le registre des domaines. C'est prêt quelques minutes après l'ajout d'un concurrent.", "Who links to them": "Qui fait un lien vers eux", "How they build pages": "Comment ils construisent leurs pages", "Facts read from the pages, not advice": "Des faits lus sur les pages, pas des conseils",
    "This part didn't load. Everything else on the page still works.": "Cette partie n'a pas chargé. Le reste de la page fonctionne.",
    "Average words per page": "Mots par page en moyenne", "Average title length": "Longueur moyenne du titre", "Pages with a meta description": "Pages avec une méta-description", "Structured data": "Données structurées",
    "Pages with questions in headings": "Pages avec des questions dans les titres", "Pages with a video": "Pages avec une vidéo", "Pages sharing a title with another": "Pages qui partagent un titre avec une autre", "Pages hidden from search (noindex)": "Pages masquées aux moteurs (noindex)",
    "Pages in the sitemap, of pages found": "Pages dans le sitemap, sur les pages trouvées", "Built with": "Construit avec", "Images without alt text": "Images sans texte alternatif", "Average links to their own pages": "Liens internes par page en moyenne",
    "Language versions (hreflang)": "Versions linguistiques (hreflang)", "Pages with a table": "Pages avec un tableau",
  });

  bind();
  COMP.profileTabs = {
    headBlock, load, body, factsLine, keywordMarks, sampleInsights,
    keywordsWhy: () => (kwUnknown() ? t(KW_WHY[kwUnknown()]) : "") };
  // The banner's answer can land after the profile is drawn: redraw once, so 0 becomes — the moment it's known there's no list.
  window.addEventListener("comp:setup-painted", () => { if (S.p && UI().$("#pt-panel") && UI().$(".cl-head .pt-strip") && S.kwShown !== kwUnknown()) COMP.paint(); });
})();
