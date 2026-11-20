/* AI search → What AI says (fifth tab, 2026-11-20). What ChatGPT, Perplexity, Gemini, Google AI Mode and Google's AI
   Overviews answer when asked about the company. The server is /api/ai-brand (seo/ai_brand/); the providers are in
   seo/ai_brand/README.md.

   Answer first (2026-11-20 rework, after Semrush AI, Profound, Peec, Otterly and Ahrefs Brand Radar): (1) one verdict from
   every answer: named by how many AIs, the tone as "% positive" with its change since the last run. (2) A switch, All AIs or
   one AI, that filters everything under it. (3) One small table, a row per AI: names you, tone score, cites your site, how
   many sites; a row picks that AI, its Answers button opens the full answers. (4) Strengths and weak points, the same point
   said by several AIs once, ranked by how many said it; each AI mark opens its answer. (5) Competitors named, ranked by how
   many AIs named them. (6) Sources: four groups (your site, competitors, social & forums, press & other) as one bar, then
   the ranked list, yours marked You. (7) Since the last run: new and lost sources. Then one line: read signed out.
   The server works the numbers out (run.picture, seo/ai_brand/service.py: picture()); this file only filters by AI.
   Asking costs money, so Ask the AIs first shows the count and the price, and asks only on the owner's yes. Nothing here
   runs on a schedule. The questions (the owner's, and suggestions from the brand and the top keywords) are edited in a panel.
   GEO round (2026-11-20, after Mickaz's "Attributs de marque" and "Benchmark perception IA"): every point carries "On your
   site?" (Said / Hinted / Missing against the site's own read pages, the page that says it as a link, a Task on Missing) with
   a ring of the totals; "You or them?" asks "<brand> or <competitor>?" for each followed competitor (one row each: who the AIs
   pick, since the last run, x/y covered), a row opens both sides in a wide panel with the sources' real links and the
   answers. An unsaved brand name gets one prompt to set it. Server: seo/ai_brand/onsite.py and service.head_to_head().
   ai-search-view.js draws the tab with window.AIBrand.tab(). Every word is in English and French below. */
(() => {
  "use strict";
  const B = { site: undefined, data: null, loading: false, error: "", ask: null, polling: 0, suggest: null, busy: false, showAll: false, pick: "", allPoints: false, allRivals: false, checking: false };
  window.AIBrand = B;
  const UI = () => window.UI;
  const t = (w) => UI().t(w);
  const esc = (v) => UI().esc(v);
  const num = (v) => UI().num(v);
  const icon = (n, c) => UI().icon(n, c);
  const tf = (s, values) => String(t(s)).replace(/\{(\w+)\}/g, (_, k) => String(values?.[k] ?? ""));
  const api = (...args) => window.COMP.api(...args);
  const day = (iso) => (iso ? new Intl.DateTimeFormat(UI().locale(), { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso.length > 10 ? `${iso.slice(0, 19)}Z` : `${iso}T00:00:00`)) : "");
  const money = (value, currency) => { const n = Number(value || 0); const d = n && n < 1 ? 4 : 2; return new Intl.NumberFormat(UI().locale(), { style: "currency", currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(n); };
  const ENGINE_WORD = { chatgpt: "ChatGPT", perplexity: "Perplexity", gemini: "Gemini", ai_mode: "Google AI Mode", ai_overview: "Google AI Overviews" };
  const KEY_OF = { brightdata: "brightdata_ai", semscraper: "semscraper" };
  const KEY_WORD = { brightdata: "Bright Data AI scrapers", semscraper: "Semscraper" };
  const redraw = () => { if (UI().state.route === "ai" && !UI().$("#panel")) UI().render({ keepScroll: true }); };
  const site = () => UI().siteIdPicked() || null;

  // ---- the server ------------------------------------------------------------------------------------
  function load({ force = false } = {}) {
    const id = site();
    if (!window.COMP?.server || !id) return;
    if (!force && B.site === id && (B.data || B.loading || B.error)) return;
    if (B.site !== id) { B.ask = null; B.suggest = null; B.showAll = false; B.pick = ""; B.allPoints = false; B.allRivals = false; }
    B.site = id; B.loading = true; B.error = "";
    return api("GET", `ai-brand?site_id=${id}`)
      .then((d) => { if (B.site === id) { B.data = d; if (d.running) poll(d.running.id); } })
      .catch((err) => { if (B.site === id) { B.error = err.message; B.data = null; } })
      .finally(() => { B.loading = false; redraw(); paintPanel(); });
  }
  B.load = load;
  B.has = () => Boolean(B.data?.last);
  B.count = () => (B.site === site() && B.data?.last ? B.data.last.engines.length : null);
  function poll(runId) {
    if (B.polling === runId) return;
    B.polling = runId;
    const step = () => {
      if (B.polling !== runId) return;
      api("GET", `ai-brand/runs/${runId}`).then((run) => {
        if (B.polling !== runId || !B.data) return;
        if (["queued", "running"].includes(run.status)) { B.data.running = run; redraw(); setTimeout(step, 5000); return; }
        B.polling = 0;
        UI().toast(run.status === "failed" ? t("No AI answered. See why in What AI says.") : t("The AIs answered."), { kind: run.status === "failed" ? "crit" : "good" });
        load({ force: true });
      }).catch(() => setTimeout(step, 10000));
    };
    setTimeout(step, 4000);
  }

  // ---- small pieces ----------------------------------------------------------------------------------
  // Google's two get their logo from brands.js beside the word "Google"; the others take their site's icon.
  const aiMark = (id, host) => `<span class="ab-ai-name">${host && host !== "google.com" ? UI().siteLogo(host, 18) : ""}<span>${esc(t(ENGINE_WORD[id] || id))}</span></span>`;
  // The short name, with its logo drawn here (brand-mention stops brands.js adding a second one): the switch and the "who said it" marks.
  const SHORT = { chatgpt: "ChatGPT", perplexity: "Perplexity", gemini: "Gemini", ai_mode: "AI Mode", ai_overview: "AI Overviews" };
  const hostOf = (id) => (B.data?.engines.find((e) => e.id === id) || {}).host || "";
  const google = (size) => (window.BRANDS?.FILES?.Google ? `<img class="logo brand-logo" src="logos/${window.BRANDS.FILES.Google}" width="${size}" height="${size}" alt="">` : "");
  const aiLogo = (id, size) => (hostOf(id) === "google.com" && google(size) ? google(size) : hostOf(id) ? UI().siteLogo(hostOf(id), size) : "");
  const aiShort = (id, size = 14) => `<span class="brand-mention ab-ai-short">${aiLogo(id, size)}<span>${esc(t(SHORT[id] || id))}</span></span>`;
  const TONE = { positive: ["good", "Positive"], negative: ["crit", "Negative"], mixed: ["warn", "Mixed"], neutral: ["info", "Neutral"] };
  const toneChip = (tone) => (!tone || !TONE[tone] ? "" : UI().status(TONE[tone][0], t(TONE[tone][1])));
  const toneWord = (tone) => (!tone || !TONE[tone] ? "" : `<span class="ab-tone-word ${TONE[tone][0]}">${esc(t(TONE[tone][1]))}</span>`);
  const namedChip = (named, of) => (of === 0 ? "" : named ? UI().status("good", of > 1 ? tf("Names you in {n} of {m}", { n: num(named), m: num(of) }) : t("Names you")) : UI().status("warn", t("Doesn't name you")));
  const you = () => window.COMP?.who ? window.COMP.who("you") : `<span class="who who-you">${t("You")}</span>`;
  const sourceLink = (s, text) => (s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer nofollow" dir="ltr" class="ab-src-link">${esc(text || s.host)}</a>` : `<span dir="ltr">${esc(text || s.host)}</span>`);
  const snippet = (words, n = 160) => { const s = String(words || "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
  // "▲13" / "▼8": the change in points against the run before; the words are there for screen readers.
  const delta = (n, quiet = false) => (n === null || n === undefined || (quiet && n === 0) ? "" : n === 0 ? `<span class="ab-delta flat">${esc(t("same as last run"))}</span>`
    : `<span class="ab-delta ${n > 0 ? "up" : "down"}"><span aria-hidden="true">${n > 0 ? "▲" : "▼"}${num(Math.abs(n))}</span><span class="sr">${esc(tf(n > 0 ? "up {n} points since the last run" : "down {n} points since the last run", { n: num(Math.abs(n)) }))}</span></span>`);
  const pct = (n) => tf("{n}% positive", { n: num(n) });

  /* One AI's answers in the last run, for its summary line and its panel. */
  function perAi(run) {
    return run.engines.map((id) => {
      const all = run.answers.filter((a) => a.engine === id);
      const done = all.filter((a) => a.status === "done");
      const said = done.filter((a) => !a.no_answer);
      // A warning first, since that's what to act on; else the first answer that names you.
      const lead = said.find((a) => a.brand_named && a.tone === "negative" && a.summary) || said.find((a) => a.brand_named && a.summary) || said.find((a) => a.summary) || said[0] || null;
      const failed = all.filter((a) => a.status === "failed");
      return { id, host: hostOf(id), all, done, said, lead, failed };
    });
  }
  const picked = (run) => (B.pick && run.engines.includes(B.pick) ? B.pick : "");

  // ---- "On your site?": Said / Hinted / Missing against the site's own read pages -------------------------------------
  const MARK = { said: ["good", "check", "Said"], hinted: ["warn", "contrast", "Hinted"], missing: ["crit", "x", "Missing"] };
  const pathOf = (url) => { try { const u = new URL(url); return `${u.pathname}${u.search}` || "/"; } catch { return String(url || ""); } };
  const ownHost = () => B.data?.host || UI().siteHostPicked?.() || "";
  const quote = (w) => (UI().state.lang === "fr" ? `« ${w} »` : `“${w}”`);
  function markChip(o) {
    if (!o || !MARK[o.mark]) return "";
    const [tone, ic, word] = MARK[o.mark];
    return `<span class="status ${tone} ab-mark" data-mark="${o.mark}"><span aria-hidden="true">${icon(ic)}</span><span class="sr">${esc(t("On your site?"))} </span>${esc(t(word))}</span>`;
  }
  /* What a Task on a Missing point says: our own point to write, or a competitor's point to cover. */
  function pointTask(p, side, rival) {
    const host = ownHost();
    const title = (side === "them" ? tf("Cover on your site: {p} (the AIs say it of {r})", { p: quote(p.text), r: rival?.name || rival?.host || "" }) : tf("Say on your site: {p}", { p: quote(p.text) })).slice(0, 180);
    return {
      title, host, description: t(side === "them" ? "The AIs give this point to a competitor, and no page of your site covers it. Add it to the page that fits best." : "The AIs say this about you, but no page of your site does. Add it to the page that fits best."),
      source: { type: "search", label: title, host, facts: [tf(p.ais === 1 ? "{n} AI" : "{n} AIs", { n: num(p.ais) }), t("What AI says")], link: "#ai", key: `ai|onsite|${host}|${side}|${p.key}` },
    };
  }
  /* The mark, the page that says it (a link), and a Task when no page does. */
  function siteLine(p, side = "us", rival = null) {
    const o = p.onsite;
    if (!o || !MARK[o.mark]) return "";
    const page = o.url && o.mark !== "missing" ? PageLink.html(o.url, { text: pathOf(o.url), host: ownHost(), cls: "mono ab-mark-page" }) : "";
    const task = o.mark === "missing" ? UI().taskButton(pointTask(p, side, rival), { label: "Task" }) : "";
    return `<span class="ab-mark-row">${markChip(o)}${page}${task}</span>`;
  }
  const countMarks = (points) => { const c = { said: 0, hinted: 0, missing: 0 }; points.forEach((p) => { if (p.onsite && c[p.onsite.mark] !== undefined) c[p.onsite.mark] += 1; }); return c; };
  /* The ring: one arc per mark, its length its share, the number of points checked in the middle. */
  function ring(c) {
    const total = c.said + c.hinted + c.missing, r = 24, len = 2 * Math.PI * r;
    let at = 0;
    const arcs = total ? ["said", "hinted", "missing"].filter((m) => c[m]).map((m) => {
      const part = (c[m] / total) * len, gap = c[m] === total ? 0 : 2;
      const arc = `<circle class="ab-ring-arc ${m}" r="${r}" cx="30" cy="30" stroke-dasharray="${Math.max(part - gap, 0.5).toFixed(2)} ${len.toFixed(2)}" stroke-dashoffset="${(-at).toFixed(2)}"></circle>`;
      at += part;
      return arc;
    }).join("") : "";
    const label = tf("{s} said, {h} hinted, {m} missing", { s: num(c.said), h: num(c.hinted), m: num(c.missing) });
    return `<span class="ab-ring" role="img" aria-label="${esc(label)}"><svg viewBox="0 0 60 60" width="60" height="60" aria-hidden="true"><circle class="ab-ring-track" r="${r}" cx="30" cy="30"></circle><g transform="rotate(-90 30 30)">${arcs}</g></svg><b class="tabular" aria-hidden="true">${num(total)}</b></span>`;
  }
  function siteCard(run, points) {
    const o = run.onsite;
    if (!o) return "";
    const head = `<h4 class="ab-site-h" id="ab-site-h">${esc(t("On your site?"))}</h4>`;
    if (!o.pages) {
      return `<div class="ab-site-card none" role="group" aria-labelledby="ab-site-h"><span class="ab-site-ico" aria-hidden="true">${icon("file-text")}</span><div class="ab-site-body">${head}
        <p class="ab-site-sub">${esc(t("None of your pages has been read yet, so nothing can be checked."))}</p>
        <div class="ab-site-acts"><button type="button" class="btn btn-small" data-ab-read-pages>${esc(t("Read my pages"))}</button><button type="button" class="btn btn-small btn-ghost" data-ab-check ${B.checking ? "disabled" : ""}>${esc(t(B.checking ? "Checking…" : "Check again"))}</button></div></div></div>`;
    }
    const c = countMarks(points);
    const key = (m) => `<li><span class="ab-site-dot ${m}" aria-hidden="true">${icon(MARK[m][1])}</span><span>${esc(t(MARK[m][2]))}</span><b class="tabular">${num(c[m])}</b></li>`;
    const by = o.by === "ai" ? t("read by your AI") : t("by word match");
    const note = o.note ? `<p class="small muted ab-site-note">${esc(tf("AI not used this time: {why}", { why: t(o.note) }))}</p>` : "";
    return `<div class="ab-site-card" role="group" aria-labelledby="ab-site-h">${ring(c)}<div class="ab-site-body">${head}<ul class="ab-site-keys">${key("said")}${key("hinted")}${key("missing")}</ul>
      <p class="small muted ab-site-sub">${esc(tf(o.pages === 1 ? "Checked against {n} page of your site, {by}." : "Checked against {n} pages of your site, {by}.", { n: num(o.pages), by }))} <button type="button" class="link-btn" data-ab-check ${B.checking ? "disabled" : ""}>${esc(t(B.checking ? "Checking…" : "Check again"))}</button></p>${note}</div></div>`;
  }

  // ---- "You or them?": head-to-head questions, one row per competitor ----------------------------------------------------
  const VERDICT = { us: ["good", "You"], them: ["crit", "Them"], tie: ["info", "Tie"], none: ["", "Unclear"] };
  const verdictChip = (v) => (!v || !VERDICT[v] ? `<span class="muted">—</span>` : `<span class="status ${VERDICT[v][0]} ab-verdict-chip">${esc(t(VERDICT[v][1]))}</span>`);
  const covered = (points) => { const marks = points.map((p) => p.onsite?.mark).filter(Boolean); return { n: marks.filter((m) => m !== "missing").length, of: marks.length }; };
  /* The rows as the AI switch sees them: one AI picked shows its own pick and its own points. */
  function vsRows(run) {
    const id = picked(run);
    return (run.versus || []).map((v) => {
      const keep = (list) => (id ? list.filter((p) => p.engines.includes(id)) : list);
      const us = keep(v.us), them = keep(v.them);
      return { ...v, verdict: id ? (v.by_engine[id] ?? null) : v.verdict, trend: id ? null : v.trend, us, them, ours: covered(us), theirs: covered(them), onlyAi: id };
    });
  }
  const rivalMark = (v, size = 18) => `<span class="ab-rival">${UI().siteLogo(v.host, size)}<span dir="auto">${esc(v.name || v.host)}</span></span>`;
  function trendCell(v) {
    if (v.onlyAi || !v.trend) return `<span class="muted">—</span>`;
    if (v.trend === "first") return `<span class="small muted">${esc(t("1st reading"))}</span>`;
    if (v.trend === "same") return `<span class="small muted">${esc(t("Same"))}</span>`;
    const up = v.trend === "up";
    return `<span class="ab-trend ${up ? "good" : "crit"}">${icon(up ? "trending-up" : "arrow-down")}<span>${esc(t(up ? "Better" : "Worse"))}</span></span><span class="sr"> ${esc(tf("was {v}", { v: t(VERDICT[v.verdict_before]?.[1] || "") }))}</span>`;
  }
  const ratio = (c) => (c.of ? `<span class="tabular">${esc(tf("{n} / {m}", { n: num(c.n), m: num(c.of) }))}</span>` : `<span class="muted">—</span>`);
  function headToHead(d, run) {
    const listed = d.questions.filter((q) => q.rival_id);
    const head = `<div class="ab-h-row"><h3 class="ab-h">${esc(t("You or them?"))}</h3></div>`;
    if (!d.rivals?.length && !run.versus?.length) {
      return `<section class="ab-sec ab-vs">${head}<p class="ab-vs-empty muted">${esc(t("Follow a competitor to ask the AIs to choose between you."))} <button type="button" class="link-btn" data-go="competitors">${esc(t("Competitors"))} ›</button></p></section>`;
    }
    if (!run.versus?.length) {
      const missing = d.rivals.filter((r) => !listed.some((q) => q.rival_id === r.id));
      const body = listed.length && !missing.length ? `<p class="ab-vs-empty muted">${esc(t("Your head-to-head questions haven't been asked yet. Ask again: the price shows first."))}</p>`
        : `<p class="ab-vs-empty">${esc(tf(missing.length === 1 ? "Ask the AIs to choose between you and the competitor you follow: “{b} or {r}?”" : "Ask the AIs to choose between you and each of the {n} competitors you follow: “{b} or {r}?”", { n: num(missing.length), b: d.brand, r: missing[0].name }))}</p>
          <div class="ab-vs-empty-acts"><button type="button" class="btn btn-small" data-ab-add-vs ${B.busy ? "disabled" : ""}>${icon("plus")}<span>${esc(tf(missing.length === 1 ? "Add {n} head-to-head question" : "Add {n} head-to-head questions", { n: num(missing.length) }))}</span></button></div>`;
      return `<section class="ab-sec ab-vs">${head}${body}</section>`;
    }
    const rows = vsRows(run).map((v) => {
      const failed = !v.answered && v.failed;
      const pick = failed ? `<span class="crit small">${esc(t("Didn't answer"))}</span>` : verdictChip(v.verdict);
      return `<tr data-ab-vs="${v.rival_id}" tabindex="0" aria-label="${esc(tf("Open {b} or {r}", { b: d.brand, r: v.name || v.host }))}">
        <th scope="row" data-label="${esc(t("Competitor"))}">${rivalMark(v)}</th>
        <td data-label="${esc(t("The AIs pick"))}">${pick}</td><td data-label="${esc(t("Since the last run"))}">${trendCell(v)}</td>
        <td class="r" data-label="${esc(t("Your points on your site"))}">${ratio(v.ours)}</td><td class="r" data-label="${esc(t("Their points you cover"))}">${ratio(v.theirs)}</td>
        <td class="ab-row-go"><span class="link-btn" aria-hidden="true">${esc(t("Compare"))}${icon("chevron-right")}</span></td></tr>`;
    }).join("");
    const unasked = d.rivals.filter((r) => !listed.some((q) => q.rival_id === r.id));
    const more = unasked.length ? `<p class="small muted ab-vs-more">${esc(tf(unasked.length === 1 ? "{n} competitor you follow has no head-to-head question yet." : "{n} competitors you follow have no head-to-head question yet.", { n: num(unasked.length) }))} <button type="button" class="link-btn" data-ab-add-vs>${esc(t("Add them"))}</button></p>` : "";
    return `<section class="ab-sec ab-vs">${head}<div class="ab-table-wrap"><table class="ab-ai-table ab-vs-table"><caption class="sr">${esc(t("Who the AIs pick, you or each competitor"))}</caption>
      <thead><tr><th scope="col">${esc(t("Competitor"))}</th><th scope="col">${esc(t("The AIs pick"))}</th><th scope="col">${esc(t("Since the last run"))}</th><th scope="col" class="r">${esc(t("Your points on your site"))}</th><th scope="col" class="r">${esc(t("Their points you cover"))}</th><th scope="col"><span class="sr">${esc(t("Compare"))}</span></th></tr></thead>
      <tbody>${rows}</tbody></table></div>${more}</section>`;
  }
  /* Both sides of one head-to-head question, side by side, in a wide panel: each side's points with their marks, the
     sources with their real links, and the answers themselves. */
  function vsPanel(rivalId, opener) {
    const d = B.data, run = d?.last; if (!run) return;
    const v = (run.versus || []).find((x) => String(x.rival_id) === String(rivalId)); if (!v) return;
    const answers = v.answers.map((id) => run.answers.find((a) => a.id === id)).filter(Boolean);
    const perAi = Object.entries(v.by_engine).map(([e, w]) => `<li>${aiShort(e, 14)}${verdictChip(w)}</li>`).join("");
    const point = (p, side) => {
      const who = p.engines.map((e) => aiShort(e, 12)).join("");
      return `<li><span class="ab-pt-text" dir="auto">${esc(p.text)}</span>${siteLine(p, side, v)}<span class="ab-pt-who ab-src-ais">${who}</span></li>`;
    };
    const col = (side, logoHost, name, points, c) => `<section class="ab-vs-col ${side}"><h3 class="ab-vs-col-h">${UI().siteLogo(logoHost, 18)}<span dir="auto">${esc(tf("{x}, by the AIs", { x: name }))}</span></h3>
      <p class="small muted">${esc(c.of ? tf(side === "us" ? "{n} of {m} on your site" : "{n} of {m} covered on your site", { n: num(c.n), m: num(c.of) }) : t("No points named."))}</p>
      ${points.length ? `<ul class="ab-vs-pts">${points.map((p) => point(p, side)).join("")}</ul>` : ""}</section>`;
    const src = v.sources.length ? `<ul class="ab-p-src">${v.sources.map((s) => {
      const first = s.urls[0];
      // The address itself is the link text, so where it goes shows; the page's title follows when the answer gave one.
      const link = first ? `${sourceLink({ url: first.url, host: s.host }, `${s.host}${pathOf(first.url) === "/" ? "" : pathOf(first.url)}`)}${first.title ? ` <span class="small muted ab-src-title" dir="auto">${esc(snippet(first.title, 70))}</span>` : ""}`
        : `<a href="https://${esc(s.host)}/" target="_blank" rel="noopener noreferrer nofollow" class="ab-src-link" dir="ltr">${esc(s.host)}</a> <span class="small muted">${esc(t("(home page: the answer gave no address)"))}</span>`;
      const more = s.urls.length > 1 ? ` <span class="small muted">${esc(tf(s.urls.length === 2 ? "+{n} page" : "+{n} pages", { n: num(s.urls.length - 1) }))}</span>` : "";
      return `<li>${UI().siteLogo(s.host, 14)}${link}${more}${s.mine ? ` ${you()}` : ""}<span class="small muted tabular"> · ${esc(tf(s.answers === 1 ? "{n} answer" : "{n} answers", { n: num(s.answers) }))}</span></li>`;
    }).join("")}</ul>` : `<p class="small muted">${esc(t("No sources cited in these answers."))}</p>`;
    const raw = answers.map((a) => {
      const body = a.status === "failed" ? `<p class="crit small">${esc(tf("Didn't answer: {why}", { why: t(a.error || "unknown error") }))}</p>` : a.no_answer ? `<p class="muted small">${esc(t("No answer."))}</p>`
        : `<details class="fold ab-p-full"><summary>${icon("chevron-right")}${aiShort(a.engine, 14)} <span class="small muted">${esc(snippet(a.summary || a.answer_text, 90))}</span></summary><div class="ab-p-text" dir="auto">${esc(a.answer_text)}</div></details>`;
      return a.status === "done" && !a.no_answer ? body : `<div class="ab-vs-raw-bad">${aiShort(a.engine, 14)}${body}</div>`;
    }).join("");
    const words = v.read_by === "words" ? `<p class="note lv-note small">${icon("info")}<span>${esc(t("Read from the answers' words. Pick an AI in Settings → AI for a closer reading."))}</span></p>` : "";
    const title = tf("{b} or {r}?", { b: d.brand, r: v.name || v.host });
    UI().openPanel(`${UI().panelHead(title, esc(tf("Asked on {d}", { d: day(run.created_at) })))}
      <div class="panel-body ab-panel ab-vs-panel">
        <div class="ab-vs-top"><p class="ab-vs-verdict"><span class="muted">${esc(t("The AIs pick"))}</span> ${verdictChip(v.verdict)}${v.trend && v.trend !== "first" ? ` ${trendCell(v)}` : ""}</p>${perAi ? `<ul class="ab-vs-ais" aria-label="${esc(t("Each AI"))}">${perAi}</ul>` : ""}</div>
        ${words}
        <div class="ab-vs-cols">${col("us", d.host, d.brand, v.us, covered(v.us))}${col("them", v.host, v.name || v.host, v.them, covered(v.them))}</div>
        <h3 class="ab-vs-sub-h">${esc(t("Sources the AIs used"))} <span class="muted tabular">${num(v.sources.length)}</span></h3>${src}
        <h3 class="ab-vs-sub-h">${esc(t("The answers"))} <span class="muted tabular">${num(answers.length)}</span></h3><div class="ab-vs-raw">${raw}</div>
        ${v.questions.map((q) => `<p class="small muted ab-vs-q">${esc(t("Question asked:"))} <span dir="auto">${esc(q)}</span></p>`).join("")}
      </div>`, opener, { wide: true });
  }
  async function addHeadToHead() {
    if (B.busy) return;
    B.busy = true; redraw();
    try {
      const found = await api("POST", "ai-brand/suggest", { site_id: B.site });
      for (const v of found.versus || []) await api("POST", "ai-brand/questions", { site_id: B.site, text: v.text, source: "suggested", rival_id: v.rival_id });
      UI().toast(tf((found.versus || []).length === 1 ? "{n} head-to-head question added. Ask again to see who the AIs pick." : "{n} head-to-head questions added. Ask again to see who the AIs pick.", { n: num((found.versus || []).length) }), { kind: "good" });
    } catch (err) { UI().toast(t(err.message), { kind: "crit" }); }
    B.busy = false;
    load({ force: true });
  }
  async function checkAgain() {
    const run = B.data?.last; if (!run || B.checking) return;
    B.checking = true; redraw();
    try { await api("POST", `ai-brand/runs/${run.id}/check-site`, {}); UI().toast(t("Checked against your pages again."), { kind: "good" }); } catch (err) { UI().toast(t(err.message), { kind: "crit" }); }
    B.checking = false;
    load({ force: true });
  }
  /* "Also known as": the company's other names (the company behind the site, its web address), one field, commas between. */
  const akaField = (d, id) => `<label class="field ab-aka" for="${id}"><span>${esc(t("Also known as"))}</span><input class="input" id="${id}" name="f_aliases" dir="auto" value="${esc((d.aliases || []).join(", "))}" maxlength="420" placeholder="${esc(t("Another name, the company behind it, your web address"))}" aria-describedby="${id}-help"></label>
    <p class="help" id="${id}-help">${esc(tf("Other names the AIs may use for you, up to {n}, separated by commas. An answer naming any of them counts as naming you.", { n: num(d.max_aliases || 5) }))}</p>`;
  const aliasesOf = (form) => String(form.elements.f_aliases?.value || "").split(",").map((w) => w.trim()).filter(Boolean);
  /* The name the AIs are asked about, while it is still a guess. */
  function namePrompt(d) {
    if (d.brand_saved) return "";
    const from = d.brand_from === "brand_words" ? "It was guessed from your brand words." : "It was guessed from your site's address.";
    return `<form class="ab-name-ask" data-ab-name-ask aria-labelledby="ab-name-h"><p class="ab-name-text">${icon("info")}<span><b id="ab-name-h">${esc(tf("Is “{b}” your company's real name?", { b: d.brand }))}</b> ${esc(t(from))} ${esc(t("The AIs are asked about this name, so use the one your customers know."))}</span></p>
      <label class="field ab-aka" for="ab-name-input"><span>${esc(t("Company name the AIs should name"))}</span><input class="input" id="ab-name-input" name="f_brand" dir="auto" value="${esc(d.brand)}" maxlength="80" autocomplete="organization"></label>
      ${akaField(d, "ab-aka-ask")}<div><button class="btn btn-small btn-main" type="submit" ${B.busy ? "disabled" : ""}>${esc(t("Save names"))}</button></div></form>`;
  }

  // ---- the tab -----------------------------------------------------------------------------------------
  function emptyCard(html, buttons = "") {
    return `<div class="empty ab-empty"><p>${html}</p>${buttons ? `<div class="ab-empty-acts">${buttons}</div>` : ""}</div>`;
  }
  function keysEmpty(d) {
    const missing = Object.entries(d.keys).filter(([, on]) => !on).map(([p]) => p);
    return emptyCard(`${t("To ask the AIs, paste a key in Settings:")} <b>${t("Bright Data AI scrapers")}</b> ${t("for ChatGPT, Perplexity, Gemini and Google AI Mode")}, ${t("or")} <b>Semscraper</b> ${t("for Google AI Overviews.")}`,
      missing.map((p) => `<button class="btn ${p === "brightdata" ? "btn-main" : ""}" data-lv-connect="${KEY_OF[p]}">${tf("Connect {k}", { k: t(KEY_WORD[p]) })}</button>`).join(""));
  }
  function headLine(d) {
    const asked = d.questions.filter((q) => q.active).length;
    const running = d.running;
    const button = running ? `<span class="ai-chip busy">${icon("refresh-cw")}<span>${esc(tf("Asking… {n} of {m} answers in", { n: num(running.done + running.failed), m: num(running.total) }))}</span></span>`
      : `<button class="btn ${d.last ? "" : "btn-main"}" data-ab-ask ${asked && !B.ask ? "" : "disabled"}>${icon("sparkles")}<span>${t(d.last ? "Ask again" : "Ask the AIs")}</span></button>`;
    return `<div class="ab-head"><p class="ab-brand"><span class="muted">${t("About")}</span> <b dir="auto">${esc(d.brand)}</b> · ${esc(tf(asked === 1 ? "{n} question" : "{n} questions", { n: num(asked) }))} <button class="link-btn" data-ab-questions>${t("Edit questions")}</button></p>${button}</div>`;
  }
  function confirmBox(d) {
    const a = B.ask;
    if (!a) return "";
    if (a.loading && !a.est) return `<div class="ai-confirm ab-confirm" role="status">${t("Working out the price…")}</div>`;
    if (a.error) return `<div class="ai-confirm ab-confirm" role="alert"><span class="error" style="margin:0">${esc(t(a.error))}</span><button class="btn btn-small btn-ghost" data-ab-cancel>${t("Close")}</button></div>`;
    const est = a.est, picks = a.picked;
    const qs = Math.min(est.questions, est.max_questions);
    const lines = est.lines.map((line) => {
      const n = line.engines.filter((e) => picks.has(e)).length * qs;
      return n ? { ...line, n, total: Number(line.each) * n } : null;
    }).filter(Boolean);
    const total = lines.reduce((s, l) => s + l.n, 0);
    const price = lines.map((l) => `${esc(t(KEY_WORD[l.provider]))}: ${esc(tf("{n} × {p}", { n: num(l.n), p: money(l.each, l.currency) }))} = <b>${esc(money(l.total, l.currency))}</b>`).join(" · ");
    const boxes = est.engines.map((e) => `<label class="ab-pick ${e.connected ? "" : "off"}"><input type="checkbox" data-ab-pick="${e.id}" ${picks.has(e.id) ? "checked" : ""} ${e.connected ? "" : "disabled"}> ${aiMark(e.id, e.host)}${e.connected ? "" : ` <span class="small muted">${t("needs a key")}</span>`}</label>`).join("");
    return `<div class="ai-confirm ab-confirm" role="group" aria-label="${esc(t("Ask the AIs"))}">
      <fieldset class="ab-picks"><legend class="sr">${t("Which AIs")}</legend>${boxes}</fieldset>
      <p class="ab-price">${esc(tf("This asks {q} to {n}: {a}.", { q: tf(qs === 1 ? "{n} question" : "{n} questions", { n: num(qs) }), n: tf(picks.size === 1 ? "{n} AI" : "{n} AIs", { n: num(picks.size) }), a: tf(total === 1 ? "{n} answer" : "{n} answers", { n: num(total) }) }))}${est.versus ? ` ${esc(tf(est.versus === 1 ? "Including {n} head-to-head question." : "Including {n} head-to-head questions.", { n: num(est.versus) }))}` : ""}<br><span class="small">${price || esc(t("Pick at least one AI."))}</span></p>
      <div class="ab-confirm-acts"><button class="btn btn-small btn-main" data-ab-go ${total && !a.sending ? "" : "disabled"}>${t("Ask now")}</button><button class="btn btn-small btn-ghost" data-ab-cancel>${t("Cancel")}</button></div></div>`;
  }

  /* (1) The verdict, from every answer: named by how many AIs, the tone as a number and its change, your site cited. */
  function verdict(run) {
    const p = run.picture;
    const named = tf(p.answered_by === 1 ? "Named by {n} of {m} AI" : "Named by {n} of {m} AIs", { n: num(p.named_by), m: num(p.answered_by) });
    const tone = p.tone_score === null ? "" : ` <span class="ab-v-sep" aria-hidden="true">·</span> <span class="ab-v-tone">${esc(pct(p.tone_score))}</span>${delta(p.tone_change)}${toneWord(p.tone_word)}`;
    const cited = p.answers ? (p.cited_mine ? tf("Your site is cited in {n} of {m} answers.", { n: num(p.cited_mine), m: num(p.answers) }) : t("Your site isn't cited in these answers.")) : "";
    return `<section class="ab-verdict" aria-label="${esc(t("All AIs together"))}"><p class="ab-v-line"><span class="ab-v-named ${p.named_by ? "" : "warn"}">${esc(named)}</span>${tone}</p>
      ${cited ? `<p class="ab-v-sub ${p.cited_mine ? "" : "warn"}">${esc(cited)}</p>` : ""}</section>`;
  }
  /* (2) The switch: All AIs, then each AI asked. It filters everything under it. */
  function aiSwitch(run) {
    const now = picked(run);
    const btn = (id, label) => `<button type="button" data-ab-pick-ai="${id}" aria-pressed="${now === id}">${label}</button>`;
    return `<div class="seg ab-seg" role="group" aria-label="${esc(t("Which AI"))}">${btn("", esc(t("All AIs")))}${run.engines.map((id) => btn(id, aiShort(id))).join("")}</div>`;
  }
  /* (3) One row per AI: names you, tone as a score, cites your site (in how many answers), how many sites. A row picks that AI. */
  function aiTable(run) {
    const now = picked(run);
    const rows = run.picture.engines.map((r) => {
      const x = perAi(run).find((y) => y.id === r.engine);
      const failedAll = !r.answered && r.failed;
      const nothing = !r.answered && !r.failed;
      const named = failedAll ? `<span class="crit">${esc(t("Didn't answer"))}</span>` : nothing ? `<span class="muted">${esc(t("No answer"))}</span>`
        : r.named ? `<span class="good">${esc(t("Yes"))}</span>${r.answered > 1 ? ` <span class="small muted">${esc(tf("{n} of {m}", { n: num(r.named), m: num(r.answered) }))}</span>` : ""}` : `<span class="warn">${esc(t("No"))}</span>`;
      const tone = r.tone_score === null ? `<span class="muted">—</span>` : `<span class="tabular ab-score">${esc(tf("{n}%", { n: num(r.tone_score) }))}</span>${delta(r.tone_change, true)} ${toneWord(r.tone_word)}`;
      const cited = !r.answered ? `<span class="muted">—</span>` : r.cited_mine ? `<span class="good">${esc(t("Yes"))}</span> <span class="small muted">${esc(tf(r.cited_mine === 1 ? "{n} answer" : "{n} answers", { n: num(r.cited_mine) }))}</span>` : `<span class="warn">${esc(t("No"))}</span>`;
      const why = failedAll ? `<span class="small crit ab-row-why">${esc(t(x.failed[0].error || "unknown error"))}</span>` : r.failed ? `<span class="small warn ab-row-why">${esc(tf("{n} didn't answer", { n: num(r.failed) }))}</span>` : "";
      return `<tr data-ab-row="${r.engine}" class="${now === r.engine ? "on" : ""}" aria-selected="${now === r.engine}" tabindex="0">
        <th scope="row" data-label="${esc(t("AI"))}"><span class="ab-row-who">${aiMark(r.engine, r.host)}${why}</span></th>
        <td data-label="${esc(t("Names you"))}">${named}</td><td data-label="${esc(t("Tone"))}">${tone}</td><td data-label="${esc(t("Cites your site"))}">${cited}</td>
        <td class="r" data-label="${esc(t("Sources"))}"><span class="tabular">${r.answered ? num(r.sources) : "—"}</span></td>
        <td class="ab-row-go"><button type="button" class="link-btn" data-ab-open="${r.engine}" aria-label="${esc(tf("Open {ai}'s answers", { ai: t(ENGINE_WORD[r.engine]) }))}">${esc(t("Read answers"))}${icon("chevron-right")}</button></td></tr>`;
    }).join("");
    return `<div class="ab-table-wrap"><table class="ab-ai-table"><caption class="sr">${esc(t("Each AI"))}</caption>
      <thead><tr><th scope="col">${t("AI")}</th><th scope="col">${t("Names you")}</th><th scope="col">${t("Tone")}</th><th scope="col">${t("Cites your site")}</th><th scope="col" class="r">${t("Sources")}</th><th scope="col"><span class="sr">${t("Read answers")}</span></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }
  /* The picked AI's own words: its summary (a warning first), or the start of its answer. */
  function pickedLine(run) {
    const id = picked(run); if (!id) return "";
    const x = perAi(run).find((y) => y.id === id); if (!x) return "";
    const said = !x.said.length ? `<span class="muted">${esc(t(x.id === "ai_overview" ? "Google showed no AI Overview for these questions." : "No answer."))}</span>`
      : x.lead?.summary ? `<span class="ab-ai-said" dir="auto">${esc(x.lead.summary)}</span>` : `<span class="ab-ai-said muted" dir="auto">“${esc(snippet(x.lead?.answer_text))}”</span>`;
    return `<p class="ab-picked">${said} <button type="button" class="link-btn" data-ab-open="${id}">${esc(tf("Read {ai}'s answers", { ai: t(SHORT[id]) }))} ›</button></p>`;
  }
  /* (4) Strengths and weak points: the same point once, ranked by how many AIs said it, with who said it (a click opens the answer). */
  function points(run) {
    const id = picked(run), p = run.picture;
    const keep = (list) => (id ? list.filter((x) => x.engines.includes(id)) : list);
    const pros = keep(p.pros), cons = keep(p.cons);
    if (!pros.length && !cons.length) return "";
    const most = B.allPoints ? Infinity : 5;
    const col = (items, cls, ic, title, none) => {
      const list = items.slice(0, most).map((x) => {
        const who = x.engines.map((e) => {
          const ids = x.answers.filter((a) => a.engine === e).map((a) => a.id);
          return `<button type="button" class="ab-who" data-ab-open="${e}" data-ab-focus="${ids.join(",")}" aria-label="${esc(tf("Open {ai}'s answer", { ai: t(ENGINE_WORD[e]) }))}">${aiShort(e, 12)}</button>`;
        }).join("");
        return `<li><span class="ab-pt-mark ${cls}" aria-hidden="true">${icon(ic)}</span><span class="ab-pt-body"><span class="ab-pt-text" dir="auto">${esc(x.text)}</span>
          ${siteLine(x)}<span class="ab-pt-who"><span class="small muted tabular">${esc(tf(x.ais === 1 ? "{n} AI" : "{n} AIs", { n: num(x.ais) }))}</span>${who}</span></span></li>`;
      }).join("");
      return `<div class="ab-pts-col"><h4 class="ab-h4 ${cls}">${esc(t(title))} <span class="muted tabular">${num(items.length)}</span></h4>${list ? `<ul class="ab-pts">${list}</ul>` : `<p class="small muted">${esc(t(none))}</p>`}</div>`;
    };
    const more = Math.max(pros.length, cons.length) > 5 ? `<button type="button" class="link-btn ab-more" data-ab-all-points>${esc(t(B.allPoints ? "Show fewer" : "Show all points"))}</button>` : "";
    return `<section class="ab-sec"><h3 class="ab-h">${t("What the AIs say about you")}</h3>${siteCard(run, [...pros, ...cons])}<div class="ab-pts-grid">${col(pros, "good", "plus", "Strengths", "No strengths named.")}${col(cons, "crit", "minus", "Weak points", "No weak points named.")}</div>${more}</section>`;
  }
  /* (5) Competitors named: each brand once, ranked by how many AIs named it. */
  function rivals(run) {
    const id = picked(run), p = run.picture;
    const list = id ? p.competitors.filter((c) => c.engines.includes(id)) : p.competitors;
    if (!list.length) return "";
    const of = Math.max(1, id ? 1 : p.answered_by);
    const most = B.allRivals ? Infinity : 8;
    const rows = list.slice(0, most).map((c) => `<li><span class="ab-rv-name" dir="auto">${esc(c.name)}</span>
      <span class="ab-rv-bar" aria-hidden="true"><i style="width:${Math.round(100 * Math.min(c.ais, of) / of)}%"></i></span>
      <span class="small tabular ab-rv-n">${esc(id ? tf((c.by_engine?.[id] || 0) === 1 ? "{n} answer" : "{n} answers", { n: num(c.by_engine?.[id] || 0) }) : tf(c.ais === 1 ? "{n} AI" : "{n} AIs", { n: num(c.ais) }))}</span></li>`).join("");
    const more = list.length > 8 ? `<button type="button" class="link-btn ab-more" data-ab-all-rivals>${esc(B.allRivals ? t("Show fewer") : tf("Show all {n}", { n: num(list.length) }))}</button>` : "";
    return `<section class="ab-sec"><h3 class="ab-h">${t("Competitors named")}</h3><ul class="ab-rv">${rows}</ul>${more}</section>`;
  }
  /* (6) Sources: the four groups as one bar, then the ranked list with links. */
  const GROUPS = [["mine", "Your site"], ["competitor", "Competitors"], ["social", "Social & forums"], ["other", "Press & other"]];
  const GROUP_TAG = { competitor: "Competitor", social: "Social & forums" };
  function sourcesBlock(run) {
    const id = picked(run);
    const rows = (id ? run.sources.filter((s) => s.engines.includes(id)).map((s) => ({ ...s, answers: s.by_engine?.[id] || 0 })).sort((a, b) => b.answers - a.answers || (b.mine - a.mine) || a.host.localeCompare(b.host)) : run.sources);
    if (!rows.length) return `<section class="ab-sec"><h3 class="ab-h">${t("Sources the AIs cite")}</h3><p class="muted">${t("No sources cited in these answers.")}</p></section>`;
    const groups = Object.fromEntries(GROUPS.map(([g]) => [g, { sites: 0, citations: 0 }]));
    rows.forEach((s) => { const g = groups[s.group || "other"]; g.sites += 1; g.citations += s.answers; });
    const bar = `<div class="ab-gbar" role="img" aria-label="${esc(GROUPS.map(([g, w]) => `${t(w)}: ${num(groups[g].citations)}`).join(", "))}">${GROUPS.filter(([g]) => groups[g].citations).map(([g]) => `<i class="g-${g}" style="flex-grow:${groups[g].citations}"></i>`).join("")}</div>`;
    const keys = `<ul class="ab-gkeys">${GROUPS.map(([g, w]) => `<li class="${groups[g].sites ? "" : "none"}"><i class="ab-gdot g-${g}" aria-hidden="true"></i><span>${esc(t(w))}</span> <b class="tabular">${num(groups[g].sites)}</b><span class="small muted tabular">${esc(tf(groups[g].citations === 1 ? "{n} citation" : "{n} citations", { n: num(groups[g].citations) }))}</span></li>`).join("")}</ul>`;
    const columns = [
      { key: "host", label: "Site", html: (s) => `<span class="ab-src">${UI().siteLogo(s.host, 16)}${sourceLink(s.urls[0] ? { ...s, url: s.urls[0].url } : s, s.host)}${s.mine ? ` ${you()}` : ""}${GROUP_TAG[s.group] ? ` <span class="ab-gtag g-${s.group}">${esc(t(GROUP_TAG[s.group]))}</span>` : ""}${s.urls.length > 1 ? ` <span class="small muted">${esc(tf("{n} pages", { n: num(s.urls.length) }))}</span>` : ""}</span>` },
      { key: "answers", label: "Answers citing it", num: true },
      ...(id ? [] : [{ key: "engines", label: "AIs", get: (s) => s.engines.map((e) => t(SHORT[e])).join(", "), html: (s) => `<span class="ab-src-ais">${s.engines.map((e) => aiShort(e, 12)).join("")}</span>` }]),
    ];
    return `<section class="ab-sec"><div class="ab-h-row"><h3 class="ab-h">${t("Sources the AIs cite")}</h3><span data-tt-slot=""></span></div>
      <div class="ab-groups">${bar}${keys}</div>${window.LV.dataTable(id ? `ab-sources-${id}` : "ab-sources", columns, rows, { empty: "No sources cited in these answers." })}</section>`;
  }
  function sinceBlock(d) {
    const s = d.since;
    if (!s) return "";
    const list = (hosts) => hosts.map((h) => `<span class="ab-host">${UI().siteLogo(h, 14)}<span dir="ltr">${esc(h)}</span></span>`).join("");
    const body = !s.new.length && !s.lost.length ? `<p class="muted">${esc(t("Same sources as last time."))}</p>`
      : `${s.new.length ? `<p class="ab-since"><span class="good">${icon("plus")}${esc(tf("New ({n})", { n: num(s.new.length) }))}</span>${list(s.new)}</p>` : ""}${s.lost.length ? `<p class="ab-since"><span class="crit">${icon("minus")}${esc(tf("Lost ({n})", { n: num(s.lost.length) }))}</span>${list(s.lost)}</p>` : ""}`;
    return `<section class="ab-sec"><h3 class="ab-h">${esc(tf("Since the last run ({d})", { d: day(s.previous_at) }))}</h3>${body}</section>`;
  }
  function tab() {
    if (!window.UI || !window.COMP?.server) return emptyCard(t("Open the app from its server to ask the AIs."));
    if (!site()) return emptyCard(t("Pick a site to see what AI says about it."));
    load();
    if (B.site !== site() || (B.loading && !B.data)) return UI().skeleton ? UI().skeleton("rows", { rows: 4 }) : emptyCard(t("Loading…"));
    if (B.error && !B.data) return UI().failCard ? UI().failCard(B.error, { retry: "data-ab-retry" }) : emptyCard(esc(t(B.error)), `<button class="btn" data-ab-retry>${t("Try again")}</button>`);
    const d = B.data;
    if (!d.keys.brightdata && !d.keys.semscraper && !d.last) return keysEmpty(d);
    const head = headLine(d) + namePrompt(d) + confirmBox(d);
    const reader = d.reader === "none" ? `<p class="note lv-note ab-reader">${icon("info")}<span>${t("Pick an AI in Settings to get the summary.")}</span> <button class="link-btn" data-go="settings">${t("Settings")} ›</button></p>` : "";
    if (!d.questions.length) return head + emptyCard(t("Add the questions to ask, or let the app suggest some from your brand and keywords."), `<button class="btn btn-main" data-ab-questions data-ab-suggest-first>${t("Suggest questions")}</button><button class="btn" data-ab-questions>${t("Add a question")}</button>`);
    const failed = d.failed && (!d.last || d.failed.id > d.last.id) && !d.running ? `<p class="ab-failed crit" role="alert">${icon("octagon-alert")}<span>${esc(tf("The last run got no answer: {why}", { why: t(d.failed.error || "unknown error") }))}</span></p>` : "";
    if (!d.last) return head + failed + (d.running || B.ask ? "" : emptyCard(t("No answers yet. Press Ask the AIs: the price shows first."))) + reader;
    const run = d.last;
    const note = `<p class="small muted ab-note">${icon("info")}<span>${esc(tf("One answer per AI, read signed out on {d}. AIs answer differently each time.", { d: day(run.created_at) }))}</span></p>`;
    const ordinary = run.picture.answers || run.picture.engines.some((r) => r.asked);
    return head + failed + reader + (ordinary ? verdict(run) : "") + `<div class="ab-pick-row">${aiSwitch(run)}</div>` + (ordinary ? aiTable(run) + pickedLine(run) + points(run) : "") + headToHead(d, run) + (ordinary ? rivals(run) + sourcesBlock(run) + sinceBlock(d) : "") + note;
  }
  B.tab = tab;
  B.info = () => ["Each AI is asked your questions once, signed out, only when you press the button.", "Tone: each answer that names you counts positive 1, neutral ½, negative 0; the score is their average.", "Sources: every site an answer cites, yours marked You.",
    "On your site?: each point is looked for in the pages of your site the app has read. Said: a page says it. Hinted: a page touches on it. Missing: no page says it.",
    "You or them?: x / y counts the points your site says or hints at, of the points the AIs made."];

  // ---- one AI's answers, in the side panel (the ones asked for first) -----------------------------------
  function answerPanel(id, opener, focus = []) {
    const run = B.data?.last; if (!run) return;
    const x = perAi(run).find((r) => r.id === id); if (!x) return;
    const one = (a) => {
      const status = a.status === "failed" ? `<p class="crit">${esc(tf("Didn't answer: {why}", { why: t(a.error || "unknown error") }))}</p>`
        : a.no_answer ? `<p class="muted">${t("Google showed no AI Overview for this question.")}</p>` : "";
      const summary = a.summary ? `<div class="ab-p-sum"><span class="tag">${t("AI summary")}</span> <span dir="auto">${esc(a.summary)}</span></div>` : a.read_error ? `<p class="small muted">${esc(t(a.read_error))}</p>` : "";
      const src = a.sources.length ? `<h4>${esc(tf("Sources ({n})", { n: num(a.sources.length) }))}</h4><ul class="ab-p-src">${a.sources.map((s) => `<li>${UI().siteLogo(s.host, 14)}${sourceLink(s, s.title || s.url || s.host)}${s.mine ? ` ${you()}` : ""}<span class="small muted" dir="ltr"> ${esc(s.host)}</span></li>`).join("")}</ul>` : "";
      const pc = (a.pros?.length || a.cons?.length) ? `<div class="ab-p-pc">${(a.pros || []).map((w) => `<span class="ab-p-pro">${icon("plus", "good")}<span dir="auto">${esc(w)}</span></span>`).join("")}${(a.cons || []).map((w) => `<span class="ab-p-con">${icon("minus", "crit")}<span dir="auto">${esc(w)}</span></span>`).join("")}</div>` : "";
      const open = !focus.length || focus.includes(a.id);
      const words = a.answer_text ? `<details class="fold ab-p-full" ${open ? "open" : ""}><summary>${icon("chevron-right")}${t("The full answer")}</summary><div class="ab-p-text" dir="auto">${esc(a.answer_text)}</div></details>` : "";
      return `<section class="ab-p-one ${focus.includes(a.id) ? "focus" : ""}" data-ab-answer="${a.id}"><h3 dir="auto">${esc(a.question)}</h3><div class="ab-ai-marks">${a.status === "done" && !a.no_answer ? namedChip(a.brand_named ? 1 : 0, 1) : ""}${toneChip(a.brand_named ? a.tone : null)}</div>${status}${summary}${pc}${words}${src}</section>`;
    };
    const order = [...x.all.filter((a) => focus.includes(a.id)), ...x.all.filter((a) => !focus.includes(a.id))];
    UI().openPanel(`${UI().panelHead(t(ENGINE_WORD[id]), esc(tf("Read signed out on {d}", { d: day(run.created_at) })))}
      <div class="panel-body ab-panel">${order.map(one).join("")}<p class="small muted">${t("AIs answer differently each time.")}</p></div>`, opener);
  }

  // ---- the questions panel -----------------------------------------------------------------------------
  function questionsHtml() {
    const d = B.data; if (!d) return "";
    const active = d.questions.filter((q) => q.active).length;
    const rows = d.questions.map((q) => `<li class="ab-q" data-ab-q="${q.id}">
      <label class="ab-q-tick"><input type="checkbox" data-ab-q-active="${q.id}" ${q.active ? "checked" : ""} ${!q.active && active >= d.max_questions ? "disabled" : ""}><span class="sr">${t("Ask this one")}</span></label>
      <input class="input" dir="auto" data-ab-q-text="${q.id}" value="${esc(q.text)}" aria-label="${esc(t("Question"))}" maxlength="400">
      ${q.rival_id ? `<span class="tag ab-vs-tag" title="${esc(q.rival_host || "")}">${q.rival_host ? UI().siteLogo(q.rival_host, 12) : ""}${t("You or them")}</span>` : q.source === "suggested" ? `<span class="tag">${t("suggested")}</span>` : ""}
      <button type="button" class="icon-btn" data-ab-q-del="${q.id}" aria-label="${esc(tf("Remove: {q}", { q: q.text }))}">${icon("trash-2")}</button></li>`).join("");
    const sug = B.suggest ? (B.suggest.length ? `<div class="ab-sug"><div class="ab-sug-head"><h3>${t("Suggestions")}</h3><button type="button" class="btn btn-small" data-ab-sug-all>${t("Add all")}</button></div><ul>${B.suggest.map((w, i) => `<li><span class="ab-sug-text"><span dir="auto">${esc(w.text)}</span>${w.rival_id ? ` <span class="tag ab-vs-tag">${UI().siteLogo(w.host, 12)}${t("You or them")}</span>` : ""}</span><button type="button" class="btn btn-small" data-ab-sug="${i}">${t("Add")}</button></li>`).join("")}</ul></div>` : `<p class="small muted">${t("No new suggestions: they're all in the list.")}</p>`) : "";
    return `<form class="ab-brand-form" data-ab-brand-form><label class="field"><span>${t("Company name the AIs should name")}</span><input class="input" name="f_brand" dir="auto" value="${esc(d.brand)}" maxlength="80" autocomplete="organization"></label>
      ${akaField(d, "ab-aka-panel")}<div class="ab-brand-save"><button class="btn btn-small" type="submit" ${B.busy ? "disabled" : ""}>${t("Save")}</button></div></form>
      <p class="help">${esc(tf("Ticked questions are asked, at most {n} a run. Asked in {l}.", { n: num(d.max_questions), l: t(d.language === "fr" ? "French" : "English") }))}</p>
      ${rows ? `<ul class="ab-qs">${rows}</ul>` : `<p class="muted">${t("No questions yet.")}</p>`}
      <form class="ab-add" data-ab-add><input class="input" name="f_question" dir="auto" maxlength="400" placeholder="${esc(t(d.language === "fr" ? "Que pensez-vous de …" : "What do you think of …"))}" aria-label="${esc(t("Add a question"))}"><button class="btn btn-small" type="submit" ${B.busy ? "disabled" : ""}>${t("Add")}</button></form>
      <p class="error" data-ab-q-error role="alert" hidden></p>
      <div class="ab-sug-wrap"><button type="button" class="btn btn-small" data-ab-suggest ${B.busy ? "disabled" : ""}>${icon("sparkles")}<span>${t("Suggest questions")}</span></button>${sug}</div>`;
  }
  function paintPanel() {
    const body = UI()?.$?.("#ab-q-body");
    if (body) UI().setHTML(body, questionsHtml());
  }
  function questionsPanel(opener, suggestFirst = false) {
    if (!B.data) return;
    UI().openPanel(`${UI().panelHead(t("Questions for the AIs"), esc(t("Your own, and suggestions you can edit.")))}<div class="panel-body" id="ab-q-body">${questionsHtml()}</div>`, opener);
    if (suggestFirst) suggest();
  }
  async function change(call, { focus } = {}) {
    B.busy = true;
    const box = UI().$("[data-ab-q-error]");
    if (box) box.hidden = true;
    try {
      await call();
      B.data = await api("GET", `ai-brand?site_id=${B.site}`);
      B.ask = null;
      B.busy = false;
      B.dirty = true;
      paintPanel();
      if (focus) UI().$(focus)?.focus();
    } catch (err) {
      B.busy = false;
      paintPanel();
      const again = UI().$("[data-ab-q-error]");
      if (again) { again.textContent = t(err.message); again.hidden = false; }
    }
  }
  function suggest() {
    B.busy = true; paintPanel();
    api("POST", "ai-brand/suggest", { site_id: B.site }).then((r) => { B.suggest = [...r.suggestions.map((text) => ({ text })), ...(r.versus || []).map((v) => ({ text: v.text, rival_id: v.rival_id, host: v.host }))]; }).catch((err) => { B.suggest = null; UI().toast(t(err.message), { kind: "crit" }); })
      .finally(() => { B.busy = false; paintPanel(); });
  }

  // ---- asking ------------------------------------------------------------------------------------------
  function openAsk() {
    const d = B.data; if (!d) return;
    B.ask = { loading: true, est: null, picked: new Set(), error: "", sending: false };
    redraw();
    api("POST", "ai-brand/estimate", { site_id: B.site })
      .then((est) => { B.ask = { ...B.ask, loading: false, est, picked: new Set(est.usable) }; if (!est.usable.length) B.ask.error = "Paste a Bright Data or Semscraper key in Settings first."; })
      .catch((err) => { B.ask = { ...B.ask, loading: false, error: err.message }; })
      .finally(() => { redraw(); UI().$("[data-ab-go]")?.focus({ preventScroll: true }); });
  }
  async function go() {
    const a = B.ask; if (!a?.est) return;
    a.sending = true; redraw();
    try {
      const run = await api("POST", "ai-brand/runs", { site_id: B.site, engines: [...a.picked] });
      B.ask = null;
      B.data.running = run;
      UI().toast(tf("Asking {n}. The answers show here in a few minutes.", { n: tf(run.total === 1 ? "{n} answer" : "{n} answers", { n: num(run.total) }) }), { kind: "good" });
      poll(run.id);
    } catch (err) {
      B.ask = { ...a, sending: false, error: err.message };
    }
    redraw();
  }

  // ---- events ------------------------------------------------------------------------------------------
  document.addEventListener("click", (e) => {
    const hit = (sel) => e.target.closest?.(sel);
    let el;
    if (!window.UI || (UI().state.route !== "ai" && !hit("#panel"))) return;
    if (hit("[data-ab-retry]")) { B.error = ""; B.data = null; load({ force: true }); redraw(); return; }
    if ((el = hit("[data-ab-questions]"))) { questionsPanel(el, el.hasAttribute("data-ab-suggest-first")); return; }
    if (hit("[data-ab-ask]")) { openAsk(); return; }
    if (hit("[data-ab-cancel]")) { B.ask = null; redraw(); UI().$("[data-ab-ask]")?.focus({ preventScroll: true }); return; }
    if (hit("[data-ab-go]")) { go(); return; }
    if ((el = hit("[data-ab-open]"))) { answerPanel(el.dataset.abOpen, el, (el.dataset.abFocus || "").split(",").filter(Boolean).map(Number)); return; }
    if ((el = hit("[data-ab-pick-ai]"))) { pickAi(el.dataset.abPickAi, `[data-ab-pick-ai="${el.dataset.abPickAi}"]`); return; }
    if ((el = hit("[data-ab-row]"))) { pickAi(B.pick === el.dataset.abRow ? "" : el.dataset.abRow, `[data-ab-row="${el.dataset.abRow}"]`); return; }
    if (hit("[data-ab-all-points]")) { B.allPoints = !B.allPoints; redraw(); return; }
    if (hit("[data-ab-all-rivals]")) { B.allRivals = !B.allRivals; redraw(); return; }
    if ((el = hit("[data-ab-q-del]"))) { const id = el.dataset.abQDel; change(() => api("DELETE", `ai-brand/questions/${id}`)); return; }
    if (hit("[data-ab-suggest]")) { suggest(); return; }
    if ((el = hit("[data-ab-sug]"))) { const one = B.suggest[Number(el.dataset.abSug)]; B.suggest = B.suggest.filter((w) => w !== one); change(() => api("POST", "ai-brand/questions", { site_id: B.site, text: one.text, source: "suggested", ...(one.rival_id ? { rival_id: one.rival_id } : {}) })); return; }
    if (hit("[data-ab-sug-all]")) {
      const all = [...B.suggest]; B.suggest = [];
      change(async () => { for (const one of all) await api("POST", "ai-brand/questions", { site_id: B.site, text: one.text, source: "suggested", ...(one.rival_id ? { rival_id: one.rival_id } : {}) }); });
      return;
    }
    if (hit("[data-ab-add-vs]")) { addHeadToHead(); return; }
    if (hit("[data-ab-check]")) { checkAgain(); return; }
    if (hit("[data-ab-read-pages]")) {
      api("POST", "ai-brand/read-pages", { site_id: B.site }).then(() => UI().toast(t("Your pages are being read. Press Check again in a few minutes."), { kind: "good" })).catch((err) => UI().toast(t(err.message), { kind: "crit" }));
      return;
    }
    if ((el = hit("[data-ab-vs]")) && !hit("a, button")) { vsPanel(el.dataset.abVs, el); }
  });
  // A row of the AI table works from the keyboard too: Enter or Space picks that AI.
  document.addEventListener("keydown", (e) => {
    if (!window.UI || UI().state.route !== "ai" || (e.key !== "Enter" && e.key !== " ")) return;
    const vs = e.target.closest?.("[data-ab-vs]");
    if (vs && e.target === vs) { e.preventDefault(); vsPanel(vs.dataset.abVs, vs); return; }
    const row = e.target.closest?.("[data-ab-row]");
    if (!row || e.target !== row) return;
    e.preventDefault();
    pickAi(B.pick === row.dataset.abRow ? "" : row.dataset.abRow, `[data-ab-row="${row.dataset.abRow}"]`);
  });
  function pickAi(id, focus) {
    B.pick = id || "";
    redraw();
    UI().$(focus)?.focus({ preventScroll: true });
  }
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.matches?.("[data-ab-pick]") && B.ask) { if (el.checked) B.ask.picked.add(el.dataset.abPick); else B.ask.picked.delete(el.dataset.abPick); redraw(); UI().$(`[data-ab-pick="${el.dataset.abPick}"]`)?.focus({ preventScroll: true }); return; }
    if (el.matches?.("[data-ab-q-active]")) { const id = el.dataset.abQActive; change(() => api("PUT", `ai-brand/questions/${id}`, { active: el.checked }), { focus: `[data-ab-q-active="${id}"]` }); return; }
    if (el.matches?.("[data-ab-q-text]")) {
      const id = el.dataset.abQText, words = el.value.trim(), was = B.data?.questions.find((q) => String(q.id) === id)?.text;
      if (words && words !== was) change(() => api("PUT", `ai-brand/questions/${id}`, { text: words }));
    }
  });
  document.addEventListener("submit", (e) => {
    const form = e.target.closest?.("[data-ab-add], [data-ab-brand-form], [data-ab-name-ask]");
    if (!form) return;
    e.preventDefault();
    if (form.matches("[data-ab-add]")) {
      const words = form.elements.f_question.value;
      change(() => api("POST", "ai-brand/questions", { site_id: B.site, text: words }), { focus: "[data-ab-add] input" });
    } else if (form.matches("[data-ab-name-ask]")) {
      const name = form.elements.f_brand.value;
      B.busy = true; redraw();
      api("PUT", "ai-brand/brand", { site_id: B.site, brand: name, aliases: aliasesOf(form) })
        .then(() => { UI().toast(t("Name saved. Your questions still use the old name: edit them, or suggest new ones."), { kind: "good" }); })
        .catch((err) => UI().toast(t(err.message), { kind: "crit" }))
        .finally(() => { B.busy = false; load({ force: true }); });
    } else {
      const name = form.elements.f_brand.value;
      const aliases = aliasesOf(form);
      change(() => api("PUT", "ai-brand/brand", { site_id: B.site, brand: name, aliases })).then(() => UI().toast(t("Name saved"), { kind: "good" }));
    }
  });
  // Back on the screen after the questions panel closes: the tab shows what the panel changed.
  setInterval(() => { if (B.dirty && window.UI && !UI().$("#panel")) { B.dirty = false; redraw(); } }, 400);

  const fr = {
    "What AI says": "Ce que dit l'IA", "ChatGPT": "ChatGPT", "Perplexity": "Perplexity", "Gemini": "Gemini", "Google AI Mode": "Google Mode IA", "Google AI Overviews": "Aperçus IA de Google",
    "Positive": "Positif", "Negative": "Négatif", "Neutral": "Neutre", "Names you": "Vous cite", "Names you in {n} of {m}": "Vous cite dans {n} sur {m}", "Doesn't name you": "Ne vous cite pas", "You": "Vous",
    "To ask the AIs, paste a key in Settings:": "Pour interroger les IA, collez une clé dans Réglages :", "Bright Data AI scrapers": "Scrapers IA Bright Data",
    "for ChatGPT, Perplexity, Gemini and Google AI Mode": "pour ChatGPT, Perplexity, Gemini et Google Mode IA", "or": "ou", "for Google AI Overviews.": "pour les aperçus IA de Google.", "Connect {k}": "Connecter {k}",
    "Asking… {n} of {m} answers in": "Interrogation… {n} réponses sur {m} reçues", "Ask again": "Redemander", "Ask the AIs": "Interroger les IA", "About": "Sur", "{n} question": "{n} question", "{n} questions": "{n} questions",
    "Edit questions": "Modifier les questions", "Working out the price…": "Calcul du prix…", "Close": "Fermer", "{n} × {p}": "{n} × {p}", "needs a key": "clé requise", "Which AIs": "Quelles IA",
    "This asks {q} to {n}: {a}.": "Cela pose {q} à {n} : {a}.", "{n} AI": "{n} IA", "{n} AIs": "{n} IA", "{n} answer": "{n} réponse", "{n} answers": "{n} réponses", "Pick at least one AI.": "Choisissez au moins une IA.",
    "Ask now": "Interroger maintenant", "Cancel": "Annuler", "Didn't answer: {why}": "Pas de réponse : {why}", "unknown error": "erreur inconnue",
    "Google showed no AI Overview for these questions.": "Google n'a montré aucun aperçu IA pour ces questions.", "No answer.": "Pas de réponse.", "{n} didn't answer": "{n} sans réponse",
    "Open {ai}'s answers": "Ouvrir les réponses de {ai}", "What each AI says": "Ce que dit chaque IA", "Sources the AIs cite": "Les sources citées par les IA", "No sources cited in these answers.": "Aucune source citée dans ces réponses.",
    "Your site is cited in {n} of {m} answers.": "Votre site est cité dans {n} réponses sur {m}.", "Your site isn't cited in these answers.": "Votre site n'est cité dans aucune de ces réponses.",
    "Site": "Site", "{n} pages": "{n} pages", "Answers citing it": "Réponses qui le citent", "AIs": "IA", "Pros and cons": "Points forts et points faibles", "No pros or cons about you.": "Aucun point fort ni faible sur vous.",
    "Also named:": "Aussi cités :", "Same sources as last time.": "Mêmes sources que la dernière fois.", "Mixed": "Mitigé", "New ({n})": "Nouvelles ({n})", "Lost ({n})": "Perdues ({n})", "Since the last run ({d})": "Depuis la dernière fois ({d})",
    "Open the app from its server to ask the AIs.": "Ouvrez l'appli depuis son serveur pour interroger les IA.", "Pick a site to see what AI says about it.": "Choisissez un site pour voir ce que l'IA en dit.", "Loading…": "Chargement…", "Try again": "Réessayer",
    "Pick an AI in Settings to get the summary.": "Choisissez une IA dans Réglages pour obtenir le résumé.", "Settings": "Réglages",
    "Add the questions to ask, or let the app suggest some from your brand and keywords.": "Ajoutez les questions à poser, ou laissez l'appli en proposer à partir de votre marque et de vos mots-clés.",
    "Suggest questions": "Proposer des questions", "Add a question": "Ajouter une question", "The last run got no answer: {why}": "La dernière demande n'a reçu aucune réponse : {why}",
    "No answers yet. Press Ask the AIs: the price shows first.": "Pas encore de réponse. Cliquez sur Interroger les IA : le prix s'affiche d'abord.",
    "One answer per AI, read signed out on {d}. AIs answer differently each time.": "Une réponse par IA, lue sans compte le {d}. Les IA répondent différemment à chaque fois.",
    "Each AI is asked your questions once, signed out, only when you press the button.": "Chaque IA reçoit vos questions une fois, sans compte, seulement quand vous cliquez sur le bouton.",
    "Sources: every site an answer cites, yours marked You.": "Sources : chaque site cité par une réponse, le vôtre marqué Vous.",
    "Google showed no AI Overview for this question.": "Google n'a montré aucun aperçu IA pour cette question.", "AI summary": "Résumé IA", "Sources ({n})": "Sources ({n})", "The full answer": "La réponse complète",
    "Read signed out on {d}": "Lue sans compte le {d}", "AIs answer differently each time.": "Les IA répondent différemment à chaque fois.", "Ask this one": "Poser celle-ci", "Question": "Question", "suggested": "suggérée",
    "Remove: {q}": "Retirer : {q}", "Suggestions": "Suggestions", "Add all": "Tout ajouter", "Add": "Ajouter", "No new suggestions: they're all in the list.": "Pas de nouvelle suggestion : elles sont toutes dans la liste.",
    "Company name the AIs should name": "Nom de l'entreprise que les IA doivent citer", "Save": "Enregistrer", "Ticked questions are asked, at most {n} a run. Asked in {l}.": "Les questions cochées sont posées, {n} au plus par demande. Posées en {l}.",
    "French": "français", "English": "anglais", "No questions yet.": "Pas encore de question.", "What do you think of …": "What do you think of …", "Que pensez-vous de …": "Que pensez-vous de …",
    "Questions for the AIs": "Questions pour les IA", "Your own, and suggestions you can edit.": "Les vôtres, et des suggestions que vous pouvez modifier.",
    "Paste a Bright Data or Semscraper key in Settings first.": "Collez d'abord une clé Bright Data ou Semscraper dans Réglages.",
    "Asking {n}. The answers show here in a few minutes.": "Demande de {n}. Les réponses s'affichent ici dans quelques minutes.", "Name saved": "Nom enregistré",
    "No AI answered. See why in What AI says.": "Aucune IA n'a répondu. Voyez pourquoi dans Ce que dit l'IA.", "The AIs answered.": "Les IA ont répondu.",
    // the combined picture (2026-11-20)
    "same as last run": "comme la dernière fois", "up {n} points since the last run": "en hausse de {n} points depuis la dernière fois", "down {n} points since the last run": "en baisse de {n} points depuis la dernière fois",
    "{n}% positive": "{n} % positif", "Named by {n} of {m} AI": "Cité par {n} IA sur {m}", "Named by {n} of {m} AIs": "Cité par {n} IA sur {m}", "All AIs together": "Toutes les IA ensemble",
    "Which AI": "Quelle IA", "All AIs": "Toutes les IA", "AI Mode": "Mode IA", "AI Overviews": "Aperçus IA", "Didn't answer": "Pas de réponse", "No answer": "Pas de réponse", "Yes": "Oui", "No": "Non",
    "{n} of {m}": "{n} sur {m}", "{n}%": "{n} %", "AI": "IA", "Tone": "Ton", "Cites your site": "Cite votre site", "Sources": "Sources", "Read answers": "Lire les réponses", "Each AI": "Chaque IA",
    "Read {ai}'s answers": "Lire les réponses de {ai}", "Open {ai}'s answer": "Ouvrir la réponse de {ai}", "Show fewer": "En montrer moins", "Show all points": "Voir tous les points", "Show all {n}": "Voir les {n}",
    "What the AIs say about you": "Ce que les IA disent de vous", "Strengths": "Points forts", "Weak points": "Points faibles", "No strengths named.": "Aucun point fort cité.", "No weak points named.": "Aucun point faible cité.",
    "Competitors named": "Concurrents cités", "Your site": "Votre site", "Competitors": "Concurrents", "Social & forums": "Réseaux sociaux et forums", "Press & other": "Presse et autres", "Competitor": "Concurrent",
    "{n} citation": "{n} citation", "{n} citations": "{n} citations",
    "Tone: each answer that names you counts positive 1, neutral ½, negative 0; the score is their average.": "Ton : chaque réponse qui vous cite compte positif 1, neutre ½, négatif 0 ; le score est leur moyenne.",
    // GEO round (2026-11-20): "On your site?", "You or them?", the name prompt
    "On your site?": "Sur votre site ?", "Said": "Dit", "Hinted": "Évoqué", "Missing": "Absent", "Task": "Tâche",
    "Say on your site: {p}": "Le dire sur votre site : {p}", "Cover on your site: {p} (the AIs say it of {r})": "Le traiter sur votre site : {p} (les IA le disent de {r})",
    "The AIs say this about you, but no page of your site does. Add it to the page that fits best.": "Les IA disent cela de vous, mais aucune page de votre site ne le dit. Ajoutez-le à la page qui convient le mieux.",
    "The AIs give this point to a competitor, and no page of your site covers it. Add it to the page that fits best.": "Les IA attribuent ce point à un concurrent, et aucune page de votre site ne le traite. Ajoutez-le à la page qui convient le mieux.",
    "{s} said, {h} hinted, {m} missing": "{s} dits, {h} évoqués, {m} absents",
    "None of your pages has been read yet, so nothing can be checked.": "Aucune de vos pages n'a encore été lue : rien ne peut être vérifié.", "Read my pages": "Lire mes pages",
    "Checking…": "Vérification…", "Check again": "Vérifier à nouveau", "read by your AI": "lu par votre IA", "by word match": "par correspondance des mots",
    "AI not used this time: {why}": "IA non utilisée cette fois : {why}",
    "Checked against {n} page of your site, {by}.": "Vérifié sur {n} page de votre site, {by}.", "Checked against {n} pages of your site, {by}.": "Vérifié sur {n} pages de votre site, {by}.",
    "Them": "Eux", "Tie": "Égalité", "Unclear": "Pas clair", "1st reading": "1er relevé", "Same": "Pareil", "Better": "Mieux", "Worse": "Moins bien", "was {v}": "avant : {v}",
    "{n} / {m}": "{n} / {m}", "You or them?": "Vous ou eux ?", "Follow a competitor to ask the AIs to choose between you.": "Suivez un concurrent pour demander aux IA de choisir entre vous.",
    "Your head-to-head questions haven't been asked yet. Ask again: the price shows first.": "Vos questions face à face n'ont pas encore été posées. Redemandez : le prix s'affiche d'abord.",
    "Ask the AIs to choose between you and the competitor you follow: “{b} or {r}?”": "Demandez aux IA de choisir entre vous et le concurrent que vous suivez : « {b} ou {r} ? »",
    "Ask the AIs to choose between you and each of the {n} competitors you follow: “{b} or {r}?”": "Demandez aux IA de choisir entre vous et chacun des {n} concurrents que vous suivez : « {b} ou {r} ? »",
    "Add {n} head-to-head question": "Ajouter {n} question face à face", "Add {n} head-to-head questions": "Ajouter {n} questions face à face",
    "Open {b} or {r}": "Ouvrir {b} ou {r}", "The AIs pick": "Le choix des IA", "Since the last run": "Depuis la dernière fois",
    "Your points on your site": "Vos points sur votre site", "Their points you cover": "Leurs points traités chez vous", "Compare": "Comparer",
    "{n} competitor you follow has no head-to-head question yet.": "{n} concurrent suivi n'a pas encore de question face à face.",
    "{n} competitors you follow have no head-to-head question yet.": "{n} concurrents suivis n'ont pas encore de question face à face.", "Add them": "Les ajouter",
    "Who the AIs pick, you or each competitor": "Qui les IA choisissent, vous ou chaque concurrent", "{x}, by the AIs": "{x}, selon les IA",
    "{n} of {m} on your site": "{n} sur {m} sur votre site", "{n} of {m} covered on your site": "{n} sur {m} traités sur votre site", "No points named.": "Aucun point cité.",
    "(home page: the answer gave no address)": "(page d'accueil : la réponse ne donnait pas d'adresse)",
    "Read from the answers' words. Pick an AI in Settings → AI for a closer reading.": "Lu d'après les mots des réponses. Choisissez une IA dans Réglages → IA pour une lecture plus fine.",
    "{b} or {r}?": "{b} ou {r} ?", "Asked on {d}": "Demandé le {d}", "Sources the AIs used": "Les sources utilisées par les IA", "The answers": "Les réponses", "Question asked:": "Question posée :",
    "{n} head-to-head question added. Ask again to see who the AIs pick.": "{n} question face à face ajoutée. Redemandez pour voir qui les IA choisissent.",
    "{n} head-to-head questions added. Ask again to see who the AIs pick.": "{n} questions face à face ajoutées. Redemandez pour voir qui les IA choisissent.",
    "Checked against your pages again.": "Vérifié à nouveau sur vos pages.", "Your pages are being read. Press Check again in a few minutes.": "Vos pages sont en cours de lecture. Cliquez sur Vérifier à nouveau dans quelques minutes.",
    "It was guessed from your brand words.": "Il a été deviné à partir de vos mots de marque.", "It was guessed from your site's address.": "Il a été deviné à partir de l'adresse de votre site.",
    "Is “{b}” your company's real name?": "« {b} » est-il le vrai nom de votre entreprise ?", "The AIs are asked about this name, so use the one your customers know.": "Les IA sont interrogées sur ce nom : mettez celui que vos clients connaissent.",
    "Save name": "Enregistrer le nom", "Save names": "Enregistrer les noms", "Name saved. Your questions still use the old name: edit them, or suggest new ones.": "Nom enregistré. Vos questions utilisent encore l'ancien nom : modifiez-les, ou proposez-en de nouvelles.",
    "Also known as": "Aussi appelé", "Another name, the company behind it, your web address": "Un autre nom, la société derrière, votre adresse web",
    "Other names the AIs may use for you, up to {n}, separated by commas. An answer naming any of them counts as naming you.": "D'autres noms que les IA peuvent utiliser pour vous, {n} au plus, séparés par des virgules. Une réponse qui cite l'un d'eux compte comme vous citant.",
    "Up to 5 other names.": "5 autres noms au plus.", "Keep each name under 80 characters.": "Chaque nom doit faire moins de 80 caractères.", "Type the other names separated by commas.": "Tapez les autres noms séparés par des virgules.",
    "You or them": "Vous ou eux", "+{n} page": "+{n} page", "+{n} pages": "+{n} pages", "Including {n} head-to-head question.": "Dont {n} question face à face.", "Including {n} head-to-head questions.": "Dont {n} questions face à face.",
    "On your site?: each point is looked for in the pages of your site the app has read. Said: a page says it. Hinted: a page touches on it. Missing: no page says it.": "Sur votre site ? : chaque point est cherché dans les pages de votre site que l'appli a lues. Dit : une page le dit. Évoqué : une page l'aborde. Absent : aucune page ne le dit.",
    "You or them?: x / y counts the points your site says or hints at, of the points the AIs made.": "Vous ou eux ? : x / y compte les points que votre site dit ou évoque, sur les points cités par les IA.",
    "Pick one of the competitors you follow.": "Choisissez un des concurrents que vous suivez.", "That run isn't there any more.": "Cette demande n'existe plus.",
    // the server's words
    "Type the question first.": "Tapez d'abord la question.", "That question is already in the list.": "Cette question est déjà dans la liste.", "Keep a question under 400 characters.": "Une question doit faire moins de 400 caractères.",
    "A run asks at most 10 questions. Untick one first.": "Une demande pose au plus 10 questions. Décochez-en une d'abord.", "A run asks at most 10 questions. Untick some first.": "Une demande pose au plus 10 questions. Décochez-en d'abord.",
    "The list holds at most 30 questions. Remove one first.": "La liste contient au plus 30 questions. Retirez-en une d'abord.", "Add a question first.": "Ajoutez d'abord une question.",
    "The AIs are already being asked. The answers show here when they're in.": "Les IA sont déjà interrogées. Les réponses s'affichent ici dès leur arrivée.",
    "Type the company's name.": "Tapez le nom de l'entreprise.", "Keep the name under 80 characters.": "Le nom doit faire moins de 80 caractères.", "Pick at least one AI": "Choisissez au moins une IA",
    "No answer after 30 minutes.": "Pas de réponse après 30 minutes.", "Stopped while being sent. Not sent again, in case it was charged.": "Arrêté pendant l'envoi. Pas renvoyé, au cas où ce serait facturé.",
    "The AI gave no answer.": "L'IA n'a donné aucune réponse.", "Bright Data sent no answer for this question.": "Bright Data n'a renvoyé aucune réponse pour cette question.",
    "No AI chosen yet, so nothing is sent. Pick one in Settings → AI.": "Aucune IA choisie : rien n'est envoyé. Choisissez-en une dans Réglages → IA.",
    "The AI's reading wasn't usable. Try again.": "La lecture de l'IA est inutilisable. Réessayez.",
    // Settings → the two keys (data.js)
    "Asks ChatGPT, Perplexity, Gemini and Google AI Mode what they say about you": "Demande à ChatGPT, Perplexity, Gemini et Google Mode IA ce qu'ils disent de vous",
    "$1.50 per 1,000 answers": "1,50 $ pour 1 000 réponses", "5,000 free answers a month": "5 000 réponses gratuites par mois",
    "Optional: without it, the key saved for Bright Data search is used. Only AI search → What AI says uses it, on a click, after showing the price.": "Facultatif : sans elle, la clé enregistrée pour la recherche Bright Data sert. Seul Recherche IA → Ce que dit l'IA l'utilise, sur un clic, après avoir montré le prix.",
    "Sends your questions to Bright Data. Nothing about your leads.": "Envoie vos questions à Bright Data. Rien sur vos leads.", "Open your account": "Ouvrez votre compte", "Sign in to Bright Data, or create an account.": "Connectez-vous à Bright Data, ou créez un compte.",
    "Open Bright Data": "Ouvrir Bright Data", "Copy the API key": "Copiez la clé API", "In Account settings → API keys, copy a key. The search zone isn't needed here.": "Dans Paramètres du compte → Clés API, copiez une clé. La zone de recherche n'est pas utile ici.", "API keys": "Clés API",
    "Paste it above and press Save. Its first use shows if it works (Test can't check it for free).": "Collez-la ci-dessus et cliquez sur Enregistrer. Sa première utilisation montre si elle marche (Tester ne peut pas la vérifier gratuitement).",
    "Reads Google's AI Overviews for What AI says": "Lit les aperçus IA de Google pour Ce que dit l'IA", "€0.30 per 1,000 searches": "0,30 € pour 1 000 recherches", "1,000 free searches at sign-up": "1 000 recherches gratuites à l'inscription",
    "Only AI search → What AI says uses it, on a click, after showing the price.": "Seul Recherche IA → Ce que dit l'IA l'utilise, sur un clic, après avoir montré le prix.",
    "Sends your questions to Semscraper. Nothing about your leads.": "Envoie vos questions à Semscraper. Rien sur vos leads.", "Create an account. Prepaid, no subscription.": "Créez un compte. Prépayé, sans abonnement.", "Open Semscraper": "Ouvrir Semscraper",
    "Copy your API key from your account page.": "Copiez votre clé API depuis la page de votre compte.", "Documentation": "Documentation", "Paste it, press Test (free, shows your balance), then Save.": "Collez-la, cliquez sur Tester (gratuit, affiche votre solde), puis Enregistrer.", "Balance": "Solde",
  };
  window.FR = window.FR || {};
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
