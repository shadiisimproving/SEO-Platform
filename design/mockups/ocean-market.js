/* The new design (Cobalt) for the market screens: only acts when document.documentElement.dataset.brand === "ocean".
   Competitors (summary cards, you vs them, who moved), Backlinks, Link gaps, Check any keyword, AI Overview watch.
   Every part here reads answers the screens already hold (COMP.summaryState, the screens' own data), and every button
   it draws carries the data-* the screen already listens to, so nothing is asked twice and every action stays the one
   the old design has. Blue = you, purple = them, green/amber/red only for status with a word or an arrow. */
(() => {
  "use strict";
  const UI = () => window.UI;
  const t = (w) => UI().t(w);
  const esc = (x) => UI().esc(x);
  const num = (v) => UI().num(v);
  const icon = (n) => UI().icon(n);
  const on = () => document.documentElement.dataset.brand === "ocean";
  const logo = (host, size = 16) => (UI().siteLogo ? UI().siteLogo(host, size) : "");
  const fill = (words, values) => t(words).replace(/\{(\w+)\}/g, (all, k) => (k in values ? values[k] : all));
  const dash = `<span class="muted">—</span>`;
  const big = (v) => (v === null || v === undefined ? "—" : num(v));
  const pct = (part, whole) => (whole ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : 0);

  /* ---- small parts, the Today ones (look-ocean.css cb-*) ---- */
  /* A small time graph on a number card: the new design's one chart look (cb-chart.js, "soft area"). */
  const mini = (now, was) => (window.CBChart ? `<span class="cb-mini-area">${window.CBChart.mini(now, was || [])}</span>` : "");
  /* A number card. attrs: the data-* the screen already answers (a button), or href (a link). */
  function kpi({ label, value, sub = "", extra = "", attrs = "", href = "", tone = "" }) {
    const inner = `<span class="cb-l">${esc(t(label))}</span><span class="cb-v"><b class="${tone}">${value === null ? "…" : big(value)}</b></span>${sub ? `<span class="cb-s">${sub}</span>` : ""}${extra}`;
    const aria = esc(`${t(label)}: ${value === null ? "…" : value === undefined ? "—" : num(value)}`);
    return href ? `<a class="card cb-kpi cbm-kpi" href="${esc(href)}" aria-label="${aria}">${inner}</a>`
      : `<button type="button" class="card cb-kpi cbm-kpi" ${attrs} aria-label="${aria}">${inner}</button>`;
  }
  /* A bar split in parts: [[value, class, label]]. Blank parts are left out; all blank draws an empty track. */
  function split(parts, label) {
    const total = parts.reduce((s, [v]) => s + (v || 0), 0);
    const bits = total ? parts.filter(([v]) => v > 0).map(([v, cls, l]) => `<i class="${cls}" style="flex:${v}" title="${esc(`${t(l)}: ${num(v)}`)}"></i>`).join("") : "";
    return `<span class="cbm-split" role="img" aria-label="${esc(label || parts.map(([v, , l]) => `${t(l)} ${num(v || 0)}`).join(", "))}">${bits}</span>`;
  }
  const legend = (parts) => `<span class="cbm-legend">${parts.map(([cls, l, v]) => `<span><i class="${cls}"></i>${esc(t(l))}${v === undefined ? "" : ` <b>${num(v)}</b>`}</span>`).join("")}</span>`;
  const card = (id, title, meta, more, body, cls = "") => `<section class="card cb-card cbm-card ${cls}"${id ? ` id="${id}"` : ""}><div class="cb-ch"><h2>${esc(t(title))}</h2>${meta ? `<span class="cb-meta">${meta}</span>` : ""}${more || ""}</div><div class="cb-body">${body}</div></section>`;

  /* ================= Competitors: the summary tab ================= */
  const KIND = { new_page: "added", page_gone: "removed", title: "changed the title of", search_title: "changed the title of", meta: "changed the description of", h1: "changed headings on", headings: "changed headings on", content: "changed content on", canonical: "changed", schema: "changed structured data on", links: "changed links on", redirect: "redirected", robots: "changed" };
  const isMove = (e) => e.kind.startsWith("rank_") || e.kind.startsWith("ai_");
  const pathOf = (url) => (window.COMP?.changePath ? window.COMP.changePath(url) : String(url || ""));
  const kwLink = (k, id, host) => (window.KeywordLink ? window.KeywordLink.html(k, { id, host }) : esc(k));
  const pageLink = (url) => (url && window.PageLink ? window.PageLink.html(url, { text: pathOf(url) }) : esc(pathOf(url)));

  function vsCard(st) {
    const rows = (st.rivals || []).filter((r) => r.compared > 0 || r.they_ahead || r.i_ahead);
    const siteOf = (r) => r.sites?.[0]?.id;
    const sorted = rows.slice().sort((a, b) => (b.they_ahead || 0) - (a.they_ahead || 0) || (a.host < b.host ? -1 : 1));
    const you = rows.reduce((s, r) => s + (r.i_ahead || 0), 0), them = rows.reduce((s, r) => s + (r.they_ahead || 0), 0);
    const max = Math.max(1, ...sorted.map((r) => (r.i_ahead || 0) + (r.they_ahead || 0)));
    const line = (r) => {
      const a = r.i_ahead || 0, b = r.they_ahead || 0, name = r.display || r.host, w = pct(a + b, max);
      const open = siteOf(r) ? `data-cs-open="${r.id}" data-cs-site="${siteOf(r)}"` : `data-cs-open="${r.id}"`;
      return `<li><button type="button" class="cbm-who" ${open} aria-label="${esc(fill("Open {rival}", { rival: name }))}">${logo(r.host, 16)}<span dir="auto">${esc(name)}</span></button>
        <span class="cbm-vs-bar" style="--w:${w}%">${split([[a, "you", "You ahead"], [b, "them", "They're ahead"]], fill("You ahead on {a}, {rival} ahead on {b}", { a: num(a), b: num(b), rival: name }))}</span>
        <span class="cbm-vs-n"><b class="you">${num(a)}</b><span aria-hidden="true">·</span><b class="them">${num(b)}</b></span></li>`;
    };
    const head = rows.length ? `<div class="cb-big cb-big-sm cbm-vs-total"><b class="cbm-you-t">${num(you)}</b><span>${t("keywords where you're ahead")}</span><b class="cbm-them-t">${num(them)}</b><span>${t("where they are")}</span></div>` : "";
    const body = !st.rivals ? `<p class="cb-s">${t("Loading…")}</p>` : rows.length
      ? `${head}${legend([["you", "You ahead"], ["them", "They're ahead"]])}<ul class="cbm-vs">${sorted.slice(0, 8).map(line).join("")}</ul>${sorted.length > 8 ? `<button type="button" class="cb-more cb-more-under" data-cs-jump="keywords">${fill("{n} more in They beat you on", { n: num(sorted.length - 8) })}${icon("chevron-right")}</button>` : ""}`
      : `<p class="cb-s">${t("No keyword checked against them yet.")}</p>`;
    return card("cbm-vs", "You vs them", t("keywords both of you rank for"), `<button type="button" class="cb-more" data-cs-jump="keywords">${t("They beat you on")}${icon("chevron-right")}</button>`, body, "cbm-vs-card");
  }

  function movedCard(st) {
    const d = st.data.moves;
    let body;
    if (!d) body = `<p class="cb-s">${t("Loading…")}</p>`;
    else {
      const edits = d.moves.filter((e) => !isMove(e) && !e.minor);
      // The newest edit of each competitor first, so one busy site can't fill the card; then the rest by date.
      const pool = edits.length ? edits : d.moves, seen = new Set(), first = [];
      pool.forEach((e) => { const k = e.rival?.id; if (!seen.has(k)) { seen.add(k); first.push(e); } });
      const list = first.concat(pool.filter((e) => !first.includes(e))).slice(0, 6);
      const kinds = { edits: d.moves.filter((e) => !isMove(e)).length, up: d.moves.filter((e) => e.kind === "rank_up" || e.kind === "rank_new").length, down: d.moves.filter((e) => e.kind === "rank_down" || e.kind === "rank_lost").length };
      const row = (e) => {
        const r = e.rival || {}, site = r.sites?.[0]?.id;
        const what = isMove(e)
          ? `${kwLink(e.keyword || "", e.keyword_id, e.my_page?.host || e.mine?.host)} <em>#${e.from ?? "—"} → #${e.to ?? "—"}</em>`
          : `${esc(t(KIND[e.kind] || "changed"))} ${pageLink(e.url)}`;
        return `<li>${logo(r.host, 16)}<span class="cb-x" dir="auto"><b>${esc(r.display || r.host || "")}</b> ${what}<em> · ${esc(window.COMP?.ago ? window.COMP.ago(e.at) : "")}</em></span><button type="button" class="btn btn-small" data-cs-open="${r.id}"${site ? ` data-cs-site="${site}"` : ""}>${t("Open")}</button></li>`;
      };
      body = `<div class="cbm-chips">${[["edits", "Page edits", ""], ["up", "Went up", "cb-up"], ["down", "Went down", "cb-down"]].map(([k, l, c]) => `<span class="cbm-chip ${c}">${c ? icon(c === "cb-up" ? "arrow-up" : "arrow-down") : icon("pencil")}${esc(t(l))} <b>${num(kinds[k])}</b></span>`).join("")}</div>
        ${list.length ? `<ul class="cb-feed">${list.map(row).join("")}</ul>` : `<p class="cb-s">${t("No changes in this period.")}</p>`}`;
    }
    const total = d?.total;
    return card("cbm-moved", "Competitors moved", total ? `${fill("last {n} days", { n: num(st.moveDays) })} · ${num(total)} ${t("changes")}` : "", `<button type="button" class="cb-more" data-cs-jump="moves">${t("All changes")}${icon("chevron-right")}</button>`, body, "cbm-moved-card");
  }

  function summaryTop() {
    const st = window.COMP?.summaryState?.();
    if (!st) return "";
    const d = st.data, rivals = st.rivals;
    const kw = d.keywords ? (d.keywords.coverage?.checked > 0 && !st.noneOn ? d.keywords.total : undefined) : null;
    const mv = d.moves ? d.moves.total : null;
    const f = d.links?.funnel, links = d.links ? (d.links.rivals_with_data > 0 ? f.good : undefined) : null;
    const tracked = rivals ? rivals.length : null;
    const reading = rivals ? rivals.filter((r) => r.crawl?.baseline_done).length : 0;
    const kpis = `<div class="cb-grid cb-kpis cbm-kpis">
      ${kpi({ label: "Competitors", value: tracked, sub: rivals ? `<b>${num(reading)}</b> ${t("with pages read")}` : "", attrs: 'data-cs-jump="rivals"',
        extra: rivals && rivals.length ? `<span class="cbm-logos" aria-hidden="true">${rivals.slice(0, 8).map((r) => logo(r.host, 20)).join("")}${rivals.length > 8 ? `<em>+${num(rivals.length - 8)}</em>` : ""}</span>` : "" })}
      ${kpi({ label: "They beat you on", value: kw, sub: kw === undefined ? t("None checked yet") : d.keywords ? `${t("keywords")} · ${t("of")} <b>${num(d.keywords.coverage?.keywords || 0)}</b> ${t("tracked")}` : "", attrs: 'data-cs-jump="keywords"', tone: kw ? "cbm-them-t" : "",
        extra: d.keywords && d.keywords.coverage?.keywords ? `<span class="cb-share cbm-share-them" aria-hidden="true"><i class="now" style="width:${pct(kw || 0, d.keywords.coverage.keywords)}%"></i></span>` : "" })}
      ${kpi({ label: "Changes", value: mv, sub: d.moves ? fill("last {n} days", { n: num(st.moveDays) }) : "", attrs: 'data-cs-jump="moves"', extra: mv ? mini(st.line) : "" })}
      ${kpi({ label: "Shared links", value: links, sub: f ? `${t("good domains")} · <b>${num(f.shared)}</b> ${t("link to 2+")}` : "", attrs: 'data-cs-jump="links"',
        extra: f && f.found ? `<span class="cbm-split-sm">${split([[f.good, "good", "Good ones"], [f.flagged, "spam", "Flagged as spam"], [f.old, "old", "Old links"]])}</span>` : "" })}
    </div>`;
    return `${kpis}<div class="cb-grid cbm-row2">${vsCard(st)}${movedCard(st)}</div>`;
  }

  /* The competitor page: you ahead vs they're ahead on shared keywords, one split bar with both counts. */
  function vsBar(you, them, name) {
    return `<div class="cbm-pvs"><b class="you">${num(you)}</b>${split([[you, "you", "You ahead"], [them, "them", "They're ahead"]], fill("You ahead on {a}, {rival} ahead on {b}", { a: num(you), b: num(them), rival: name }))}<b class="them">${num(them)}</b>
      ${legend([["you", "You ahead"], ["them", "They're ahead"]])}</div>`;
  }

  /* ================= Backlinks (backlinks-seo.js simplify) ================= */
  /* Where every link stands, as one split bar: In consideration → To do → Live → Lost. Each part is a button that opens that
     section, with the same data-bl-section / data-bl-go the screen's own tabs and answer rows use. */
  function backlinks(content, all) {
    const top = content.querySelector(".bl-top");
    if (!top || top.querySelector("#cbm-bl-pipe")) return;
    const countOf = (section) => { const n = content.querySelector(`[data-bl-section="${section}"] .muted`)?.textContent; return n ? Number(n.replace(/\D/g, "")) || 0 : 0; };
    const cons = countOf("consideration"), todo = window.LinkTodo?.count?.() || 0;
    const lost = all.filter((b) => b.status === "lost").length, live = all.length - lost;
    const parts = [[cons, "cons", "In consideration", "consideration"], [todo, "todo", "To do", "todo"], [live, "live", "Live", "done"], [lost, "lost", "Lost", "lost"]];
    const total = cons + todo + live + lost;
    const here = UI().state.blSection;
    const btn = ([v, cls, label, go]) => `<button type="button" class="cbm-pipe-b" ${go === "lost" ? 'data-bl-go="lost"' : `data-bl-section="${go}"${go === here ? ' aria-current="true"' : ""}`}><i class="${cls}"></i><span>${esc(t(label))}</span><b>${num(v)}</b>${go === "lost" && v ? `<span class="cbm-st-down">${icon("arrow-down")}${t("lost")}</span>` : ""}</button>`;
    const html = card("cbm-bl-pipe", "Where your links stand", total ? `${num(total)} ${t("links")}` : "", "",
      `${split(parts.map(([v, cls, l]) => [v, cls, l]))}<div class="cbm-pipe">${parts.map(btn).join("")}</div>`, "cbm-pipe-card");
    top.classList.add("cbm-bl-top");
    top.append(UI().fragment(html));
  }

  /* ================= Link gaps (comp-gaps.js summaryLine) ================= */
  /* Domains found split into good / spam / old, each part a button for that filter; then a bar per competitor (purple: theirs),
     a button that shows only that competitor's domains. The capped note, Being checked, No links yet and Add all stay beside. */
  function gapsTop(g) {
    const parts = [[g.good, "good", "Good ones", "good"], [g.spam, "spam", "Flagged as spam", "spam"], ...(g.old && !g.oldIncluded ? [[g.old, "old", "Old links, left out", null]] : g.old ? [[g.old, "old", "Old links, included", null]] : [])];
    const leg = parts.map(([v, cls, l, q]) => (q ? `<button type="button" class="cbm-leg-b" data-cg-quality="${q}"><i class="${cls}"></i>${esc(t(l))} <b>${num(v)}</b></button>` : `<span class="cbm-leg-b"><i class="${cls}"></i>${esc(t(l))} <b>${num(v)}</b></span>`)).join("");
    const app = g.appFlagged ? `<button type="button" class="cbm-leg-b" data-cg-quality="app" data-tip="${esc(t("The file's spam score keeps them, but the app's own check flagged them. Each row says what it saw."))}"><span class="cbm-st-warn">${icon("triangle-alert")}</span>${esc(t("App flagged"))} <b>${num(g.appFlagged)}</b></button>` : "";
    const max = Math.max(1, ...g.per.map((c) => c.n));
    const rows = g.per.slice(0, 6).map((c) => `<li><button type="button" class="cbm-who" data-cg-choose="${esc(String(c.id))}" aria-label="${esc(fill("Show only {rival}'s domains", { rival: c.host }))}">${logo(c.host, 16)}<span dir="auto">${esc(c.host)}</span></button><span class="cbm-bar-them"><i style="width:${pct(c.n, max)}%"></i></span><b class="them">${num(c.n)}</b></li>`).join("");
    const found = `<section class="card cbm-card cbm-gap-found"><div class="cb-ch"><h2>${t("Domains found")}</h2><span class="cb-meta">${t("linking to competitors, not to you")}</span></div><div class="cb-body">
      <div class="cb-big cb-big-sm"><b>${num(g.found)}</b><span>${t("domains")}</span><b class="cbm-you-t">${num(g.good)}</b><span>${t("good ones to ask")}</span></div>
      ${split(parts.map(([v, cls, l]) => [v, cls, l]))}<div class="cbm-legend cbm-leg-btns">${leg}${app}</div></div></section>`;
    const per = rows ? `<section class="card cbm-card cbm-gap-per"><div class="cb-ch"><h2>${t("Good ones by competitor")}</h2>${g.per.length > 6 ? `<span class="cb-meta">${t("top 6")}</span>` : ""}</div><div class="cb-body"><ul class="cbm-bars">${rows}</ul></div></section>` : "";
    return `<div class="cb-grid cbm-gap-top${per ? "" : " cbm-one"}" role="group" aria-label="${esc(t("Spam filter"))}">${found}${per}</div>${g.extra ? `<div class="cg-summary cbm-gap-extra">${g.extra}</div>` : ""}`;
  }

  /* ================= AI Overview watch (comp-ai.js) ================= */
  /* Four number cards, then who the AI Overviews cite: you first (blue), each competitor (purple), out of the overviews found. */
  function aiTop(s, keywords, myHost) {
    const ids = new Map();
    (keywords || []).forEach((r) => (r.competitors_cited || []).forEach((c) => ids.set(c.host, c.id)));
    const top = s.rivals[0];
    const of = (n, w) => `${t("of")} <b>${num(n)}</b> ${t(w)}`;
    const toolLine = s.tools?.length ? ` · ${esc(s.tools.join(", "))}` : "";
    const kpis = `<div class="cb-grid cb-kpis cbm-kpis">
      ${kpi({ label: "With AI Overview", value: s.with_overview, sub: `${of(s.captured, "checked")}${toolLine}`, attrs: 'data-ca-filter="overview"', extra: s.tracked ? `<span class="cb-share" aria-hidden="true"><i class="now" style="width:${pct(s.with_overview, s.tracked)}%"></i></span>` : "" })}
      ${kpi({ label: "You're cited", value: s.cited_me, sub: of(s.with_overview, "overviews"), attrs: 'data-ca-filter="cited"', tone: "cbm-you-t", extra: s.with_overview ? `<span class="cb-share" aria-hidden="true"><i class="now" style="width:${pct(s.cited_me, s.with_overview)}%"></i></span>` : "" })}
      ${kpi({ label: "Not checked", value: s.not_captured, sub: of(s.tracked, "keywords"), attrs: 'data-ca-filter="notcaptured"' })}
      ${top ? `<button type="button" class="card cb-kpi cbm-kpi" ${ids.has(top.host) ? `data-ca-rival="${esc(String(ids.get(top.host)))}"` : ""} aria-label="${esc(`${t("Competitor cited most")}: ${top.host}`)}"><span class="cb-l">${t("Competitor cited most")}</span><span class="cb-v cbm-v-host">${logo(top.host, 20)}<b class="cb-word cbm-them-t" dir="auto">${esc(top.host)}</b></span><span class="cb-s"><b>${num(top.keywords)}</b> ${t("keywords")}</span></button>`
        : kpi({ label: "Competitor cited most", value: undefined, sub: t("None cited yet") })}
    </div>`;
    const max = Math.max(1, s.with_overview || 0);
    const line = (host, n, who, id) => `<li>${who === "you" ? `<span class="cbm-who">${logo(host, 16)}<span dir="auto">${esc(host || t("You"))}</span></span>` : `<button type="button" class="cbm-who" ${id !== undefined ? `data-ca-rival="${esc(String(id))}"` : ""}>${logo(host, 16)}<span dir="auto">${esc(host)}</span></button>`}<span class="cbm-bar-them${who === "you" ? " cbm-bar-you" : ""}"><i style="width:${pct(n, max)}%"></i></span><b class="${who}">${num(n)}</b></li>`;
    const list = s.with_overview ? `<ul class="cbm-bars">${line(myHost, s.cited_me, "you")}${s.rivals.slice(0, 7).map((r) => line(r.host, r.keywords, "them", ids.get(r.host))).join("")}</ul>` : `<p class="cb-s">${t("No AI Overview found yet.")}</p>`;
    const who = card("cbm-ai-who", "Who AI Overviews cite", s.with_overview ? `${t("out of")} ${num(s.with_overview)} ${t("overviews")}` : "", "", `${legend([["you", "You"], ["them", "Competitors"]])}${list}`, "cbm-ai-who");
    return `${kpis}<div class="cb-grid cbm-one-row">${who}</div>`;
  }

  /* ================= Check any keyword (comp-probe.js) ================= */
  /* With keywords: four number cards (checked, you rank, a competitor above you, you lead) and a split bar of the checked ones.
     With none: three short steps above the form. */
  function probeTop(d) {
    const list = d.keywords || [];
    if (!list.length) {
      const step = (n, w) => `<li><span class="cbm-step-n">${n}</span>${esc(t(w))}</li>`;
      return `<ol class="cbm-steps" aria-label="${esc(t("How it works"))}">${step(1, "Type a few keywords below")}${step(2, "Check them: nothing is searched until you confirm")}${step(3, "See which competitors rank, and where you are")}</ol>`;
    }
    const checked = list.filter((k) => k.checked);
    const best = (k) => Math.min(99, ...(k.competitors || []).map((c) => c.position));
    const behind = checked.filter((k) => (k.competitors || []).length && (!k.me || best(k) < k.me.position)).length;
    const mine = checked.filter((k) => k.me).length;
    const lead = checked.filter((k) => k.me && (!(k.competitors || []).length || k.me.position < best(k))).length;
    const none = checked.length - behind - lead;
    return `<div class="cb-grid cb-kpis cbm-kpis">
      ${kpi({ label: "Keywords checked", value: checked.length, sub: `${t("of")} <b>${num(list.length)}</b>`, attrs: 'data-kc-sort="keyword"', extra: `<span class="cb-share" aria-hidden="true"><i class="now" style="width:${pct(checked.length, list.length)}%"></i></span>` })}
      ${kpi({ label: "You rank", value: checked.length ? mine : undefined, sub: `${t("in the top")} ${num(d.depth || 10)}`, attrs: 'data-kc-sort="me"', tone: "cbm-you-t" })}
      ${kpi({ label: "A competitor is above you", value: checked.length ? behind : undefined, sub: t("or you're not there"), attrs: 'data-kc-sort="rivals"', tone: "cbm-them-t" })}
      ${kpi({ label: "You lead", value: checked.length ? lead : undefined, sub: checked.length ? `${split([[lead, "you", "You lead"], [behind, "them", "A competitor is above you"], [none, "old", "Nobody ranks"]])}` : "", attrs: 'data-kc-sort="me"' })}
    </div>`;
  }

  /* ================= Page vs page (comp-pairs.js) ================= */
  /* Your page beside theirs: how many pairs they lead, you lead, even. Each part is the chip the screen already has. */
  function pairsTop(c, total, picked) {
    const parts = [[c.ahead, "you", "You're ahead", "ahead"], [c.behind, "them", "They're ahead", "behind"], [c.level, "old", "Even", "level"], [c.none, "spam", "Not compared", null]];
    const btn = ([v, cls, l, id]) => (id && (v || id !== "level") ? `<button type="button" class="cbm-leg-b" data-cp-verdict="${id}" aria-pressed="${picked === id}"><i class="${cls}"></i>${esc(t(l))} <b>${num(v)}</b></button>` : "");
    return `<section class="card cbm-card cbm-pairs-top"><div class="cb-ch"><h2>${t("Your pages vs theirs")}</h2><span class="cb-meta">${num(total)} ${t("pairs")}</span></div><div class="cb-body">
      <div class="cbm-pairs-row"><b class="you">${num(c.ahead)}</b>${split(parts.map(([v, cls, l]) => [v, cls, l]))}<b class="them">${num(c.behind)}</b></div>
      <div class="cbm-legend cbm-leg-btns">${parts.map(btn).join("")}</div></div></section>`;
  }

  window.OceanMarket = { on, summaryTop, vsBar, backlinks, gapsTop, aiTop, probeTop, pairsTop, kpi, split, legend, card, mini };

  const words = {
    "You vs them": "Vous contre eux", "keywords both of you rank for": "mots-clés où vous êtes tous deux classés", "You ahead": "Vous devant", "They're ahead": "Eux devant",
    "keywords where you're ahead": "mots-clés où vous êtes devant", "where they are": "où ils le sont", "{n} more in They beat you on": "{n} de plus dans Ils vous battent sur",
    "You ahead on {a}, {rival} ahead on {b}": "Vous devant sur {a}, {rival} devant sur {b}", "No keyword checked against them yet.": "Aucun mot-clé encore comparé avec eux.",
    "Competitors moved": "Mouvements des concurrents", "Page edits": "Pages modifiées", "Went up": "En hausse", "Went down": "En baisse", "All changes": "Tous les changements",
    "No changes in this period.": "Aucun changement sur cette période.", "last {n} days": "{n} derniers jours", "changes": "changements", "added": "a ajouté", "redirected": "a redirigé",
    "removed": "a retiré", "changed": "a modifié", "changed content on": "a modifié le contenu de", "changed structured data on": "a modifié les données structurées de",
    "changed the title of": "a modifié le titre de", "changed the description of": "a modifié la description de", "changed headings on": "a modifié les titres de", "changed links on": "a modifié les liens de",
    "with pages read": "aux pages lues", "None checked yet": "Rien de vérifié", "keywords": "mots-clés", "of": "sur", "tracked": "suivis", "Changes": "Changements",
    "good domains": "bons domaines", "link to 2+": "liés à 2+", "Good ones": "Bons", "Flagged as spam": "Signalés comme spam", "Old links": "Anciens liens", "Open": "Ouvrir",
    "Where your links stand": "Où en sont vos liens", "links": "liens", "In consideration": "À l'étude", "To do": "À faire", "Live": "En ligne", "Lost": "Perdus", "lost": "perdu",
    "Domains found": "Domaines trouvés", "linking to competitors, not to you": "liés à vos concurrents, pas à vous", "domains": "domaines", "good ones to ask": "bons à démarcher",
    "Good ones by competitor": "Bons domaines par concurrent", "top 6": "les 6 premiers", "Show only {rival}'s domains": "Voir seulement les domaines de {rival}",
    "With AI Overview": "Avec un aperçu IA", "You're cited": "Vous êtes cité", "Not checked": "Non vérifiés", "Competitor cited most": "Concurrent le plus cité", "checked": "vérifiés",
    "overviews": "aperçus", "None cited yet": "Aucun cité pour l'instant", "Who AI Overviews cite": "Qui les aperçus IA citent", "out of": "sur", "You": "Vous",
    "No AI Overview found yet.": "Aucun aperçu IA trouvé pour l'instant.",
    "How it works": "Comment ça marche", "Type a few keywords below": "Tapez quelques mots-clés ci-dessous", "Check them: nothing is searched until you confirm": "Vérifiez-les : rien n'est cherché sans votre accord",
    "See which competitors rank, and where you are": "Voyez quels concurrents sont classés, et où vous êtes", "Keywords checked": "Mots-clés vérifiés", "You rank": "Vous êtes classé",
    "in the top": "dans le top", "A competitor is above you": "Un concurrent est devant vous", "or you're not there": "ou vous n'y êtes pas", "You lead": "Vous menez", "Nobody ranks": "Personne n'est classé",
    "Your pages vs theirs": "Vos pages contre les leurs", "pairs": "paires", "Even": "À égalité", "Not compared": "Non comparées",
    "Shared links": "Liens partagés", "They beat you on": "Ils vous battent sur", "Competitors": "Concurrents", "Open {rival}": "Ouvrir {rival}",
  };
  window.OceanMarketWords = words;
  window.FR = window.FR || {};
  Object.entries(words).forEach(([k, v]) => { if (window.FR[k] === undefined) window.FR[k] = v; });
})();
