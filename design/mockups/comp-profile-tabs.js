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
  const S = { tab: null, p: null, ins: null, parts: null, buildMore: false };
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
  const share = (v) => (known(v) ? `${Math.round(v * 100)}%` : dash);

  function currentTab() {
    if (!S.tab) { try { S.tab = UI().store.get(TAB_KEY) || "keywords"; } catch { S.tab = "keywords"; } }
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
    if (r?.new_30d) second = r.top_section ? many(r.new_30d, "They published {n} page in 30 days, mostly in {section}.", "They published {n} pages in 30 days, mostly in {section}.", { section: r.top_section }) : many(r.new_30d, "They published {n} page in 30 days.", "They published {n} pages in 30 days.");
    else if (r && r.months?.length && p.crawl?.baseline_done) second = t("They published nothing new in 30 days.");
    const off = p.tracking && p.tracking !== "on"; // keyword numbers are switched off for this competitor
    const missing = [];
    if (!off && !c.shared && !c.theirs_only) missing.push(t("No ranking check has seen you both yet."));
    if (!ins?.facts?.my_pages) missing.push(t("Your own site hasn't been read yet, so its pages can't be compared."));
    const acts = [];
    if (!off && c.theirs_only) acts.push(`<button class="btn btn-small" data-pt-only-them>${icon("key-round")}${esc(many(c.theirs_only, "See the {n} keyword", "See the {n} keywords"))}</button>`);
    if (!off && !c.shared && !c.theirs_only) acts.push(`<button class="btn btn-small" data-pt-go="keywords">${icon("refresh-cw")}${t("Check your keywords")}</button>`);
    if (first || second) {
      const site = p.site?.host || "";
      acts.push(UI().taskButton({ title: `${p.host}: ${[first, second].filter(Boolean).join(" ")}`.slice(0, 180), host: site, source: { type: "competitor", label: p.host, host: site, facts: [first, second].filter(Boolean), link: `#competitors/list/${p.id}`, key: `answer|${p.id}` } }));
    }
    const words = [first, second].filter(Boolean).join(" ");
    return `<section class="pt-answer" aria-label="${esc(t("In one sentence"))}">
      ${words ? `<p class="pt-answer-text">${esc(words)}</p>` : ""}
      ${off ? COMP.trackingNote?.(p, { short: true }) ?? "" : ""}
      ${missing.length ? `<p class="pt-answer-missing small sec">${icon("info")}<span>${esc(missing.join(" "))}</span></p>` : ""}
      ${acts.length ? `<div class="pt-answer-acts">${acts.join("")}</div>` : ""}
    </section>`;
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

  // ---- four tiles ------------------------------------------------------------------------------
  function tile(label, mine, theirs, note = "", single = null) {
    const side = (who, value, cls) => `<div class="cl-side"><span class="cl-who pt-who-${cls}">${who}</span><span class="cl-fig tabular">${value}</span></div>`;
    const sides = single !== null ? `<div class="cl-sides">${side(t("You and them"), single, "both")}</div>` : `<div class="cl-sides">${side(t("You"), mine, "you")}${side(t("Them"), theirs, "them")}</div>`;
    return `<div class="tile cl-cmp"><div class="lab">${esc(label)}</div>${sides}<div class="delta">${note}</div></div>`;
  }

  function tiles(p, ins) {
    const c = p.compare || {}, f = ins?.facts || {};
    const off = p.tracking && p.tracking !== "on";
    const verdict = c.shared ? (c.i_ahead === c.they_ahead ? UI().status("info", t("Level")) : c.i_ahead > c.they_ahead ? UI().status("good", t("You're ahead")) : UI().status("warn", t("They're ahead"))) : "";
    const keywordTiles = off
      ? "" // the answer box above already says the keyword numbers are hidden: said once is enough
      : `${tile(t("Shared keywords"), null, null, `${verdict}${c.shared ? `<span class="ab">${esc(fill("You're ahead on {mine}, they're ahead on {they}.", { mine: num(c.i_ahead), they: num(c.they_ahead) }))}</span>` : `<span class="ab">${t("Nothing shared yet.")}</span>`}`, figure(c.shared))}
        ${tile(t("Keywords only one of you ranks on"), figure(c.mine_only), figure(c.theirs_only), `<span class="ab">${t("The other isn't in the results checked.")}</span>`)}`;
    const pagesMine = known(f.my_pages) && f.my_pages > 0 ? num(f.my_pages) : dash;
    const daNote = known(f.da) || known(f.my_da) ? `<span class="ab">${t("Moz Domain Authority.")}</span>` : COMP.trackingAllowsMoz?.(p) === false ? "" : `<span class="ab">${t("Mark the domain important under Backlinks to get its Moz score.")}</span>`;
    return `<section class="tiles cl-tiles pt-tiles" aria-label="${esc(t("How you compare"))}">
      ${keywordTiles}
      ${tile(t("Pages"), pagesMine, p.crawl?.status === "blocked" ? dash : figure(f.pages), f.my_pages ? "" : `<span class="ab">${t("Yours are counted once your site is read.")}</span>`)}
      ${tile(t("Authority"), figure(f.my_da), figure(f.da), daNote)}
    </section>`;
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
    const bestTable = best.length
      ? `<div class="cl-scroll"><table class="data cl-table pt-table"><thead><tr><th scope="col">${t("Their page")}</th><th scope="col" class="c">${t("Keywords")}</th><th scope="col" class="c">${t("Best position")}</th><th scope="col">${t("Your page")}</th></tr></thead><tbody>${best.map((b) => `<tr>
          <td class="head-cell"><span class="cl-cell"><span class="t" dir="auto">${esc(b.title || COMP.shortUrl(b.url))}</span><span class="second">${COMP.link(b.url)}</span></span></td>
          <td class="c tabular" data-label="${esc(t("Keywords"))}">${num(b.keywords)}</td>
          <td class="c" data-label="${esc(t("Best position"))}">${COMP.pos(b.best_position)}</td>
          <td data-label="${esc(t("Your page"))}">${b.my_url ? `<span class="cl-cell"><span class="t" dir="auto">${esc(b.my_title || COMP.shortUrl(b.my_url))}</span><span class="second">${b.pair_id ? `<button class="link-btn" data-cl-pair="${b.pair_id}">${t("Compare")}</button>` : COMP.link(b.my_url)}</span></span>` : `<span class="pt-none">${t("No page")}</span> ${UI().taskButton({ title: fill("Write a page against {url}", { url: COMP.shortUrl(b.url) }), host: p.site?.host, source: { type: "competitor", label: p.host, host: p.site?.host, facts: [b.url, many(b.keywords, "{n} keyword", "{n} keywords")], link: `#competitors/list/${p.id}`, key: `best|${p.id}|${b.url}` } }, { label: "Task" })}`}</td>
        </tr>`).join("")}</tbody></table></div>`
      : `<p class="cl-none small sec">${t("None yet. Their strongest pages are the ones that rank for your keywords, so they appear after a ranking check.")}</p>`;
    const sectionTable = sections.length
      ? `<div class="cl-scroll"><table class="data cl-table pt-table"><thead><tr><th scope="col">${t("Section")}</th><th scope="col" class="c">${t("Pages, them and you")}</th><th scope="col" class="c">${t("New in 90 days")}</th><th scope="col">${t("Last change")}</th></tr></thead><tbody>${sections.map((s) => `<tr>
          <td class="head-cell"><span class="mono" dir="ltr">${esc(s.path)}</span></td>
          <td class="c tabular" data-label="${esc(t("Pages, them and you"))}">${num(s.pages)} <span class="muted">·</span> ${s.my_pages ? num(s.my_pages) : `<span class="muted">0</span>`}</td>
          <td class="c tabular" data-label="${esc(t("New in 90 days"))}">${s.new_90d ? `<b>${num(s.new_90d)}</b>` : `<span class="muted">0</span>`}</td>
          <td data-label="${esc(t("Last change"))}"><span class="nowrap">${s.last_change ? esc(COMP.ago(s.last_change)) : dash}</span></td>
        </tr>`).join("")}</tbody></table></div>`
      : `<p class="cl-none small sec">${t("Sections appear once their pages are read.")}</p>`;
    const questionList = questions.length
      ? `<ul class="pt-questions">${questions.slice(0, 30).map((q) => `<li><span dir="auto">${esc(q.text)}</span><span class="second small muted">${esc(t(q.source === "people_also_ask" ? "People also ask" : "In their headings"))}${q.url ? ` · ${COMP.link(q.url)}` : ""}</span></li>`).join("")}</ul>${questions.length > 30 ? `<p class="small muted">${esc(fill("Showing 30 of {n}.", { n: num(questions.length) }))}</p>` : ""}`
      : `<p class="cl-none small sec">${t("None found yet. Questions come from their page headings and from Google's People also ask.")}</p>`;
    return `<section class="card"><div class="card-head"><h2>${t("Their strongest pages")}</h2><span class="end small muted">${t("By how many of your keywords each page ranks for")}</span></div><div class="cl-section-body">${bestTable}</div></section>
      <section class="card"><div class="card-head"><h2>${t("Their sections")}</h2><span class="end small muted">${t("By the first folder of each address")}</span></div><div class="cl-section-body">${sectionTable}</div></section>
      <section class="card"><div class="card-head"><h2>${t("Questions they answer that you don't")}</h2>${questions.length ? `<span class="tag tabular">${num(questions.length)}</span>` : ""}</div><div class="cl-section-body">${questionList}</div></section>`;
  }

  // Activity: how fast they publish, against you, then the timeline.
  function activityTab(p, ins, parts) {
    const r = ins?.rhythm;
    const facts = r ? `<div class="pt-facts-row">
        ${fact(t("Pages updated in the last 12 months"), share(r.updated_12m?.theirs), share(r.updated_12m?.mine))}
        ${fact(t("New pages in 30 days"), figure(r.new_30d), figure(r.my_new_30d))}
        ${fact(t("Pages removed in 30 days"), figure(r.removed_30d), figure(r.my_removed_30d))}
      </div>` : "";
    const chart = r?.months?.length ? monthChart(r.months) : `<p class="cl-none small sec">${t("The months fill in once pages are read. A page's date comes from the page itself, the Wayback Machine, or the day the app first saw it.")}</p>`;
    const years = historyBlock(ins);
    return `<section class="card"><div class="card-head"><h2>${t("New pages each month")}</h2><span class="end small muted">${t("Them against you, over 12 months")}</span></div><div class="cl-section-body">${facts}${chart}</div></section>
      ${years}
      <section class="card" aria-label="${esc(t("Timeline"))}"><div class="card-head"><h2>${t("Timeline")}</h2><span class="end small muted cl-end">${t("Ranking moves only compare two checks by the same tool, from the same place, so a change of tool never reads as a move.")}</span></div>
        <div class="cl-section-body" id="cl-timeline">${parts.timelineBody(p)}</div></section>`;
  }
  const fact = (label, theirs, mine) => `<div class="pt-fact"><span class="lab small sec">${esc(label)}</span><span class="pt-fact-figs"><span><i class="pt-key pt-key-them" aria-hidden="true"></i>${t("Them")} <b class="tabular">${theirs}</b></span><span><i class="pt-key pt-key-you" aria-hidden="true"></i>${t("You")} <b class="tabular">${mine}</b></span></span></div>`;

  /* Grouped bars, them and you per month. One axis, thin bars with rounded tops, a 2px gap, a legend, a hover
     label per month, and the same numbers as a table for anyone who'd rather read them. */
  function monthChart(months) {
    const w = 1100, h = 210, left = 30, right = 8, top = 14, bottom = 26;
    const max = Math.max(1, ...months.flatMap((m) => [m.theirs || 0, m.mine || 0]));
    const step = niceStep(max);
    const ceil = Math.ceil(max / step) * step;
    const y = (v) => top + (h - top - bottom) * (1 - v / ceil);
    const slot = (w - left - right) / months.length;
    const bar = Math.max(4, Math.min(16, (slot - 10) / 2));
    const grid = [];
    for (let v = 0; v <= ceil; v += step) grid.push(`<line class="pt-grid" x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}"/><text class="pt-axis" x="${left - 6}" y="${y(v) + 3}" text-anchor="end">${num(v)}</text>`);
    const rounded = (x, value, cls) => {
      if (!value) return "";
      const top_ = y(value), base = y(0), r = Math.min(4, (base - top_) / 2, bar / 2);
      return `<path class="${cls}" d="M${x},${base} V${top_ + r} Q${x},${top_} ${x + r},${top_} H${x + bar - r} Q${x + bar},${top_} ${x + bar},${top_ + r} V${base} Z"/>`;
    };
    const groups = months.map((m, i) => {
      const cx = left + slot * i + slot / 2;
      const x1 = cx - bar - 1, x2 = cx + 1;
      const label = i % 2 === 0 || months.length <= 6 ? `<text class="pt-axis" x="${cx}" y="${h - 8}" text-anchor="middle">${esc(shortMonth(m.month))}</text>` : "";
      return `<g class="pt-month" data-pt-month="${i}">${rounded(x1, m.theirs, "pt-bar-them")}${rounded(x2, m.mine, "pt-bar-you")}${label}<rect class="pt-hit" x="${left + slot * i}" y="${top}" width="${slot}" height="${h - top - bottom}"><title>${esc(`${longMonth(m.month)}: ${t("Them")} ${m.theirs || 0}, ${t("You")} ${m.mine || 0}`)}</title></rect></g>`;
    }).join("");
    const table = `<details class="pt-as-table"><summary class="small">${t("See these numbers as a table")}</summary><div class="cl-scroll"><table class="data cl-table"><thead><tr><th scope="col">${t("Month")}</th><th scope="col" class="c">${t("Them")}</th><th scope="col" class="c">${t("You")}</th></tr></thead><tbody>${months.map((m) => `<tr><td class="head-cell">${esc(longMonth(m.month))}</td><td class="c tabular">${num(m.theirs || 0)}</td><td class="c tabular">${num(m.mine || 0)}</td></tr>`).join("")}</tbody></table></div></details>`;
    return `<div class="pt-legend small"><span><i class="pt-key pt-key-them" aria-hidden="true"></i>${t("Them")}</span><span><i class="pt-key pt-key-you" aria-hidden="true"></i>${t("You")}</span></div>
      <div class="pt-chart-wrap"><svg class="pt-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(t("New pages each month, them against you"))}">${grid.join("")}${groups}</svg><div class="pt-tip" id="pt-tip" hidden></div></div>${table}`;
  }
  const niceStep = (max) => { const raw = max / 4; const mag = 10 ** Math.floor(Math.log10(raw)); const n = raw / mag; return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag); };
  const shortMonth = (ym) => { try { return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(UI().state.lang || undefined, { month: "short", timeZone: "UTC" }); } catch { return ym; } };
  const longMonth = (ym) => { try { return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(UI().state.lang || undefined, { month: "long", year: "numeric", timeZone: "UTC" }); } catch { return ym; } };

  /* The Wayback Machine's memory of them: since when, and how many pages first appeared each year. */
  function historyBlock(ins) {
    const f = ins?.facts || {}, h = f.history || {}, years = ins?.rhythm?.by_year || [];
    let body;
    if (h.status === "ok" && years.length) {
      const max = Math.max(1, ...years.map((x) => x.pages));
      body = `<p class="small sec">${esc(fill("First archived {date}. {n} of their pages are in the archive.", { date: UI().fmtDateOnly(`${f.first_capture}T00:00:00Z`), n: num(h.archived_pages || 0) }))}${h.capped ? ` ${esc(t("The archive holds more than the first 5,000 read here."))}` : ""}</p>
        <ul class="pt-years">${years.map((x) => `<li><span class="tabular">${esc(String(x.year))}</span><span class="pt-year-bar" style="--w:${(x.pages / max) * 100}%"><i class="pt-key-them"></i></span><span class="tabular">${num(x.pages)}</span></li>`).join("")}</ul>`;
    } else if (h.status === "failed") body = `<p class="cl-none small sec">${esc(t("The Wayback Machine didn't answer this time. It tries again tomorrow."))}</p>`;
    else if (h.status === "ok") body = `<p class="cl-none small sec">${t("The Wayback Machine has no copy of this site.")}</p>`;
    else if (h.message) body = `<p class="cl-none small sec">${t("The Wayback Machine is busy. The app asks again in a few minutes.")}</p>`;
    else body = `<p class="cl-none small sec">${t("Looking them up in the Wayback Machine. It takes a minute or two after a competitor is added, then it's checked again each month.")}</p>`;
    const dates = [f.registered_on ? fill("Domain registered {date}", { date: UI().fmtDateOnly(`${f.registered_on}T00:00:00Z`) }) : "", f.expires_on ? fill("renews by {date}", { date: UI().fmtDateOnly(`${f.expires_on}T00:00:00Z`) }) : ""].filter(Boolean).join(", ");
    return `<section class="card"><div class="card-head"><h2>${t("How their site grew")}</h2><span class="end small muted">${t("New pages each year, from the Wayback Machine")}</span></div><div class="cl-section-body">${body}${dates ? `<p class="small muted pt-dates">${esc(dates)}.</p>` : ""}</div></section>`;
  }

  // Their site: authority, who links to them, and how they build pages.
  function siteTab(p, ins) {
    if (!ins) return unavailable();
    const f = ins.facts || {}, l = ins.links || {};
    const row = (label, mine, theirs) => `<tr><th scope="row" class="head-cell">${esc(label)}</th><td class="c tabular" data-label="${esc(t("You"))}">${mine}</td><td class="c tabular" data-label="${esc(t("Them"))}">${theirs}</td></tr>`;
    const authority = `<table class="data cl-table pt-table pt-vs"><thead><tr><th scope="col">${t("What")}</th><th scope="col" class="c">${t("You")}</th><th scope="col" class="c">${t("Them")}</th></tr></thead><tbody>
        ${row(t("Moz Domain Authority"), figure(f.my_da), figure(f.da))}
        ${row(t("Sites linking to them"), figure(l.my_linking_domains), figure(l.linking_domains))}
        ${row(t("Popularity (Cloudflare)"), f.my_popularity ? esc(f.my_popularity) : dash, f.popularity ? esc(f.popularity) : dash)}
        ${row(t("Domain registered"), f.my_registered_on ? esc(monthYear(f.my_registered_on)) : dash, f.registered_on ? esc(monthYear(f.registered_on)) : dash)}
      </tbody></table>`;
    const top = l.top || [];
    const links = top.length
      ? `<ul class="rows pt-links">${top.slice(0, 10).map((d) => `<li><div class="what"><span class="with-logo">${UI().siteLogo(d.domain, 16)}<span class="logo-text mono" dir="ltr">${esc(d.domain)}</span></span>${d.spam ? ` ${UI().status("warn", t("Looks like spam"))}` : ""}</div><div class="acts small muted tabular">${known(d.authority) ? esc(`${d.authority_label || t("Authority")} ${d.authority}`) : ""}</div></li>`).join("")}</ul>
        ${l.not_to_me ? `<p class="pt-gap-line">${esc(many(l.not_to_me, "{n} of these doesn't link to you.", "{n} of these don't link to you."))} <button class="btn btn-small" data-pt-gaps>${icon("link-2")}${t("Open Link gaps")}</button></p>` : ""}`
      : `<p class="cl-none small sec">${t("No linking sites known yet. They come from a CSV uploaded in Link gaps.")}</p>`;
    const build = (ins.build || []);
    const main = build.filter((b) => !b.more), more = build.filter((b) => b.more);
    const buildRow = (b) => row(t(b.label), value(b, b.mine), value(b, b.theirs));
    const buildTable = build.length
      ? `<table class="data cl-table pt-table pt-vs"><thead><tr><th scope="col">${t("What")}</th><th scope="col" class="c">${t("You")}</th><th scope="col" class="c">${t("Them")}</th></tr></thead><tbody>${main.map(buildRow).join("")}${S.buildMore ? more.map(buildRow).join("") : ""}</tbody></table>
         ${more.length ? `<p class="cl-more"><button class="btn btn-small" data-pt-build-more aria-expanded="${S.buildMore}">${t(S.buildMore ? "Fewer details" : "More details")}</button></p>` : ""}`
      : `<p class="cl-none small sec">${t("These facts appear once their pages are read.")}</p>`;
    return `<section class="card"><div class="card-head"><h2>${t("How strong they are")}</h2></div><div class="cl-section-body"><div class="cl-scroll">${authority}</div></div></section>
      <section class="card"><div class="card-head"><h2>${t("Who links to them")}</h2>${known(l.linking_domains) ? `<span class="tag tabular">${num(l.linking_domains)}</span>` : ""}</div><div class="cl-section-body">${links}</div></section>
      <section class="card"><div class="card-head"><h2>${t("How they build pages")}</h2><span class="end small muted">${t("Facts read from the pages, not advice")}</span></div><div class="cl-section-body"><div class="cl-scroll">${buildTable}</div></div></section>`;
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
    return `${answer(p, ins)}${tiles(p, ins)}${tabBar()}<div class="pt-panel" id="pt-panel" role="tabpanel" aria-labelledby="pt-tab-${currentTab()}">${panel()}</div>`;
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
    try { UI().store.set(TAB_KEY, id); } catch { /* a private window: the tab just isn't remembered */ }
    UI().$$("[data-pt-tab]").forEach((b) => { const on = b.dataset.ptTab === id; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; });
    repaint();
    if (focus) UI().$(`[data-pt-tab="${id}"]`)?.focus({ preventScroll: true });
  }

  function showTip(g) {
    const tip = UI().$("#pt-tip"), wrap = g.closest(".pt-chart-wrap");
    const months = S.ins?.rhythm?.months || [];
    const m = months[Number(g.dataset.ptMonth)];
    if (!tip || !wrap || !m) return;
    UI().setHTML(tip, `<b>${esc(longMonth(m.month))}</b><span><i class="pt-key pt-key-them"></i>${t("Them")} <b class="tabular">${num(m.theirs || 0)}</b></span><span><i class="pt-key pt-key-you"></i>${t("You")} <b class="tabular">${num(m.mine || 0)}</b></span>`);
    tip.hidden = false;
    const box = g.getBoundingClientRect(), outer = wrap.getBoundingClientRect();
    const x = Math.min(Math.max(box.left - outer.left + box.width / 2, 70), outer.width - 70);
    tip.style.left = `${x}px`;
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
    const questions = ["How long does it take to get started?", "What does it cost per month?", "Can I change plans later?", "Is there a free trial?"].map((text, i) => ({ text, source: i % 2 ? "people_also_ask" : "heading", url: i % 2 ? null : best[0]?.url || `https://${p.host}/` }));
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

  Object.assign(window.FR, {
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
    "How strong they are": "Leur force", "Who links to them": "Qui fait un lien vers eux", "How they build pages": "Comment ils construisent leurs pages", "Facts read from the pages, not advice": "Des faits lus sur les pages, pas des conseils",
    "This part didn't load. Everything else on the page still works.": "Cette partie n'a pas chargé. Le reste de la page fonctionne.",
    "Average words per page": "Mots par page en moyenne", "Average title length": "Longueur moyenne du titre", "Pages with a meta description": "Pages avec une méta-description", "Structured data": "Données structurées",
    "Pages with questions in headings": "Pages avec des questions dans les titres", "Pages with a video": "Pages avec une vidéo", "Pages sharing a title with another": "Pages qui partagent un titre avec une autre", "Pages hidden from search (noindex)": "Pages masquées aux moteurs (noindex)",
    "Pages in the sitemap, of pages found": "Pages dans le sitemap, sur les pages trouvées", "Built with": "Construit avec", "Images without alt text": "Images sans texte alternatif", "Average links to their own pages": "Liens internes par page en moyenne",
    "Language versions (hreflang)": "Versions linguistiques (hreflang)", "Pages with a table": "Pages avec un tableau",
  });

  bind();
  COMP.profileTabs = { load, body, factsLine, keywordMarks, sampleInsights };
})();
