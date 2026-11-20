/* AI search → What AI says (fifth tab, 2026-11-20). What ChatGPT, Perplexity, Gemini, Google AI Mode and Google's AI
   Overviews answer when asked about the company. The server is /api/ai-brand (seo/ai_brand/); the providers are in
   seo/ai_brand/README.md.

   Answer first: (1) one line per AI: does it name you, its tone and a short summary; a line opens the full answers.
   (2) The sites the AIs cite, the most cited first, yours marked You, each a link. (3) Pros and cons per AI. (4) Since the
   last run: new and lost sources. Then one line: one answer per AI, read signed out, AIs answer differently each time.
   Asking costs money, so Ask the AIs first shows the count and the price, and asks only on the owner's yes. Nothing here
   runs on a schedule. The questions (the owner's, and suggestions from the brand and the top keywords) are edited in a panel.
   ai-search-view.js draws the tab with window.AIBrand.tab(). Every word is in English and French below. */
(() => {
  "use strict";
  const B = { site: undefined, data: null, loading: false, error: "", ask: null, polling: 0, suggest: null, busy: false, showAll: false };
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
    if (B.site !== id) { B.ask = null; B.suggest = null; B.showAll = false; }
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
  const TONE = { positive: ["good", "Positive"], negative: ["crit", "Negative"], mixed: ["warn", "Mixed"], neutral: ["info", "Neutral"] };
  const toneChip = (tone) => (!tone || !TONE[tone] ? "" : UI().status(TONE[tone][0], t(TONE[tone][1])));
  const namedChip = (named, of) => (of === 0 ? "" : named ? UI().status("good", of > 1 ? tf("Names you in {n} of {m}", { n: num(named), m: num(of) }) : t("Names you")) : UI().status("warn", t("Doesn't name you")));
  const you = () => window.COMP?.who ? window.COMP.who("you") : `<span class="who who-you">${t("You")}</span>`;
  const sourceLink = (s, text) => (s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer nofollow" dir="ltr" class="ab-src-link">${esc(text || s.host)}</a>` : `<span dir="ltr">${esc(text || s.host)}</span>`);
  const snippet = (words, n = 160) => { const s = String(words || "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

  /* One AI's answers in the last run, put together for its line. */
  function perAi(run) {
    return run.engines.map((id) => {
      const all = run.answers.filter((a) => a.engine === id);
      const done = all.filter((a) => a.status === "done");
      const said = done.filter((a) => !a.no_answer);
      const named = said.filter((a) => a.brand_named).length;
      const tones = said.filter((a) => a.brand_named && a.tone).map((a) => a.tone);
      const bad = tones.includes("negative"), good = tones.includes("positive");
      const tone = bad && good ? "mixed" : bad ? "negative" : good ? "positive" : tones.length ? "neutral" : null;
      // The line's summary: a warning first, since that's what to act on; else the first answer that names you.
      const lead = said.find((a) => a.brand_named && a.tone === "negative" && a.summary) || said.find((a) => a.brand_named && a.summary) || said.find((a) => a.summary) || said[0] || null;
      const failed = all.filter((a) => a.status === "failed");
      return { id, host: (B.data.engines.find((e) => e.id === id) || {}).host, all, done, said, named, tone, lead, failed };
    });
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
    const est = a.est, picked = a.picked;
    const qs = Math.min(est.questions, est.max_questions);
    const lines = est.lines.map((line) => {
      const n = line.engines.filter((e) => picked.has(e)).length * qs;
      return n ? { ...line, n, total: Number(line.each) * n } : null;
    }).filter(Boolean);
    const total = lines.reduce((s, l) => s + l.n, 0);
    const price = lines.map((l) => `${esc(t(KEY_WORD[l.provider]))}: ${esc(tf("{n} × {p}", { n: num(l.n), p: money(l.each, l.currency) }))} = <b>${esc(money(l.total, l.currency))}</b>`).join(" · ");
    const boxes = est.engines.map((e) => `<label class="ab-pick ${e.connected ? "" : "off"}"><input type="checkbox" data-ab-pick="${e.id}" ${picked.has(e.id) ? "checked" : ""} ${e.connected ? "" : "disabled"}> ${aiMark(e.id, e.host)}${e.connected ? "" : ` <span class="small muted">${t("needs a key")}</span>`}</label>`).join("");
    return `<div class="ai-confirm ab-confirm" role="group" aria-label="${esc(t("Ask the AIs"))}">
      <fieldset class="ab-picks"><legend class="sr">${t("Which AIs")}</legend>${boxes}</fieldset>
      <p class="ab-price">${esc(tf("This asks {q} to {n}: {a}.", { q: tf(qs === 1 ? "{n} question" : "{n} questions", { n: num(qs) }), n: tf(picked.size === 1 ? "{n} AI" : "{n} AIs", { n: num(picked.size) }), a: tf(total === 1 ? "{n} answer" : "{n} answers", { n: num(total) }) }))}<br><span class="small">${price || esc(t("Pick at least one AI."))}</span></p>
      <div class="ab-confirm-acts"><button class="btn btn-small btn-main" data-ab-go ${total && !a.sending ? "" : "disabled"}>${t("Ask now")}</button><button class="btn btn-small btn-ghost" data-ab-cancel>${t("Cancel")}</button></div></div>`;
  }
  function aiLines(run) {
    const rows = perAi(run).map((x) => {
      const failedAll = !x.done.length && x.failed.length;
      const said = failedAll ? `<span class="crit">${esc(tf("Didn't answer: {why}", { why: t(x.failed[0].error || "unknown error") }))}</span>`
        : !x.said.length ? `<span class="muted">${esc(t(x.id === "ai_overview" ? "Google showed no AI Overview for these questions." : "No answer."))}</span>`
        : x.lead?.summary ? `<span class="ab-ai-said" dir="auto">${esc(x.lead.summary)}</span>`
        : `<span class="ab-ai-said muted" dir="auto">“${esc(snippet(x.lead?.answer_text))}”</span>`;
      const extra = x.failed.length && x.done.length ? ` <span class="small warn">${esc(tf("{n} didn't answer", { n: num(x.failed.length) }))}</span>` : "";
      return `<li><button type="button" class="ab-ai" data-ab-open="${x.id}" aria-label="${esc(tf("Open {ai}'s answers", { ai: t(ENGINE_WORD[x.id]) }))}">
        <span class="ab-ai-who">${aiMark(x.id, x.host)}</span>
        <span class="ab-ai-marks">${failedAll ? "" : namedChip(x.named, x.said.length)}${toneChip(x.tone)}${extra}</span>
        <span class="ab-ai-sum">${said}</span><span class="ab-ai-go" aria-hidden="true">${icon("chevron-right")}</span></button></li>`;
    }).join("");
    return `<section class="ab-sec"><h3 class="ab-h">${t("What each AI says")}</h3><ul class="ab-ais">${rows}</ul></section>`;
  }
  function sourcesBlock(run) {
    const rows = run.sources;
    if (!rows.length) return `<section class="ab-sec"><h3 class="ab-h">${t("Sources the AIs cite")}</h3><p class="muted">${t("No sources cited in these answers.")}</p></section>`;
    const mine = rows.filter((s) => s.mine);
    const lead = mine.length ? tf("Your site is cited in {n} of {m} answers.", { n: num(mine.reduce((s, x) => Math.max(s, x.answers), 0)), m: num(run.done) }) : t("Your site isn't cited in these answers.");
    const columns = [
      { key: "host", label: "Site", html: (s) => `<span class="ab-src">${UI().siteLogo(s.host, 16)}${sourceLink(s.urls[0] ? { ...s, url: s.urls[0].url } : s, s.host)}${s.mine ? ` ${you()}` : ""}${s.urls.length > 1 ? ` <span class="small muted">${esc(tf("{n} pages", { n: num(s.urls.length) }))}</span>` : ""}</span>` },
      { key: "answers", label: "Answers citing it", num: true },
      { key: "engines", label: "AIs", get: (s) => s.engines.map((e) => t(ENGINE_WORD[e])).join(", "), html: (s) => `<span class="small">${esc(s.engines.map((e) => t(ENGINE_WORD[e])).join(", "))}</span>` },
    ];
    return `<section class="ab-sec"><div class="ab-h-row"><h3 class="ab-h">${t("Sources the AIs cite")}</h3><span data-tt-slot=""></span></div>
      <p class="ab-lead ${mine.length ? "" : "warn"}">${esc(lead)}</p>${window.LV.dataTable("ab-sources", columns, rows, { empty: "No sources cited in these answers." })}</section>`;
  }
  function prosCons(run) {
    const cards = perAi(run).map((x) => {
      const pros = [...new Set(x.said.flatMap((a) => a.pros || []))], cons = [...new Set(x.said.flatMap((a) => a.cons || []))], rivals = [...new Set(x.said.flatMap((a) => a.competitors || []))];
      if (!pros.length && !cons.length && !rivals.length) return "";
      const list = (items, cls, ic) => (items.length ? `<ul class="ab-pc ${cls}">${items.map((w) => `<li>${icon(ic, cls)}<span dir="auto">${esc(w)}</span></li>`).join("")}</ul>` : "");
      return `<div class="ab-pc-card"><div class="ab-pc-head">${aiMark(x.id, x.host)}</div>
        ${pros.length || cons.length ? `${list(pros, "good", "plus")}${list(cons, "crit", "minus")}` : `<p class="small muted">${t("No pros or cons about you.")}</p>`}
        ${rivals.length ? `<p class="small ab-rivals"><span class="muted">${t("Also named:")}</span> <span dir="auto">${esc(rivals.join(", "))}</span></p>` : ""}</div>`;
    }).filter(Boolean).join("");
    if (!cards) return "";
    return `<section class="ab-sec"><h3 class="ab-h">${t("Pros and cons")}</h3><div class="ab-pc-grid">${cards}</div></section>`;
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
    const head = headLine(d) + confirmBox(d);
    const reader = d.reader === "none" ? `<p class="note lv-note ab-reader">${icon("info")}<span>${t("Pick an AI in Settings to get the summary.")}</span> <button class="link-btn" data-go="settings">${t("Settings")} ›</button></p>` : "";
    if (!d.questions.length) return head + emptyCard(t("Add the questions to ask, or let the app suggest some from your brand and keywords."), `<button class="btn btn-main" data-ab-questions data-ab-suggest-first>${t("Suggest questions")}</button><button class="btn" data-ab-questions>${t("Add a question")}</button>`);
    const failed = d.failed && (!d.last || d.failed.id > d.last.id) && !d.running ? `<p class="ab-failed crit" role="alert">${icon("octagon-alert")}<span>${esc(tf("The last run got no answer: {why}", { why: t(d.failed.error || "unknown error") }))}</span></p>` : "";
    if (!d.last) return head + failed + (d.running || B.ask ? "" : emptyCard(t("No answers yet. Press Ask the AIs: the price shows first."))) + reader;
    const run = d.last;
    const note = `<p class="small muted ab-note">${icon("info")}<span>${esc(tf("One answer per AI, read signed out on {d}. AIs answer differently each time.", { d: day(run.created_at) }))}</span></p>`;
    return head + failed + reader + aiLines(run) + sourcesBlock(run) + prosCons(run) + sinceBlock(d) + note;
  }
  B.tab = tab;
  B.info = () => ["Each AI is asked your questions once, signed out, only when you press the button.", "Sources: every site an answer cites, yours marked You."];

  // ---- one AI's answers, in the side panel -----------------------------------------------------------
  function answerPanel(id, opener) {
    const run = B.data?.last; if (!run) return;
    const x = perAi(run).find((r) => r.id === id); if (!x) return;
    const one = (a) => {
      const status = a.status === "failed" ? `<p class="crit">${esc(tf("Didn't answer: {why}", { why: t(a.error || "unknown error") }))}</p>`
        : a.no_answer ? `<p class="muted">${t("Google showed no AI Overview for this question.")}</p>` : "";
      const summary = a.summary ? `<div class="ab-p-sum"><span class="tag">${t("AI summary")}</span> <span dir="auto">${esc(a.summary)}</span></div>` : a.read_error ? `<p class="small muted">${esc(t(a.read_error))}</p>` : "";
      const src = a.sources.length ? `<h4>${esc(tf("Sources ({n})", { n: num(a.sources.length) }))}</h4><ul class="ab-p-src">${a.sources.map((s) => `<li>${UI().siteLogo(s.host, 14)}${sourceLink(s, s.title || s.url || s.host)}${s.mine ? ` ${you()}` : ""}<span class="small muted" dir="ltr"> ${esc(s.host)}</span></li>`).join("")}</ul>` : "";
      const pc = (a.pros?.length || a.cons?.length) ? `<div class="ab-p-pc">${(a.pros || []).map((w) => `<span class="ab-p-pro">${icon("plus", "good")}<span dir="auto">${esc(w)}</span></span>`).join("")}${(a.cons || []).map((w) => `<span class="ab-p-con">${icon("minus", "crit")}<span dir="auto">${esc(w)}</span></span>`).join("")}</div>` : "";
      const words = a.answer_text ? `<details class="fold ab-p-full" open><summary>${icon("chevron-right")}${t("The full answer")}</summary><div class="ab-p-text" dir="auto">${esc(a.answer_text)}</div></details>` : "";
      return `<section class="ab-p-one"><h3 dir="auto">${esc(a.question)}</h3><div class="ab-ai-marks">${a.status === "done" && !a.no_answer ? namedChip(a.brand_named ? 1 : 0, 1) : ""}${toneChip(a.brand_named ? a.tone : null)}</div>${status}${summary}${pc}${words}${src}</section>`;
    };
    UI().openPanel(`${UI().panelHead(t(ENGINE_WORD[id]), esc(tf("Read signed out on {d}", { d: day(run.created_at) })))}
      <div class="panel-body ab-panel">${x.all.map(one).join("")}<p class="small muted">${t("AIs answer differently each time.")}</p></div>`, opener);
  }

  // ---- the questions panel -----------------------------------------------------------------------------
  function questionsHtml() {
    const d = B.data; if (!d) return "";
    const active = d.questions.filter((q) => q.active).length;
    const rows = d.questions.map((q) => `<li class="ab-q" data-ab-q="${q.id}">
      <label class="ab-q-tick"><input type="checkbox" data-ab-q-active="${q.id}" ${q.active ? "checked" : ""} ${!q.active && active >= d.max_questions ? "disabled" : ""}><span class="sr">${t("Ask this one")}</span></label>
      <input class="input" dir="auto" data-ab-q-text="${q.id}" value="${esc(q.text)}" aria-label="${esc(t("Question"))}" maxlength="400">
      ${q.source === "suggested" ? `<span class="tag">${t("suggested")}</span>` : ""}
      <button type="button" class="icon-btn" data-ab-q-del="${q.id}" aria-label="${esc(tf("Remove: {q}", { q: q.text }))}">${icon("trash-2")}</button></li>`).join("");
    const sug = B.suggest ? (B.suggest.length ? `<div class="ab-sug"><div class="ab-sug-head"><h3>${t("Suggestions")}</h3><button type="button" class="btn btn-small" data-ab-sug-all>${t("Add all")}</button></div><ul>${B.suggest.map((w, i) => `<li><span dir="auto">${esc(w)}</span><button type="button" class="btn btn-small" data-ab-sug="${i}">${t("Add")}</button></li>`).join("")}</ul></div>` : `<p class="small muted">${t("No new suggestions: they're all in the list.")}</p>`) : "";
    return `<form class="ab-brand-form" data-ab-brand-form><label class="field"><span>${t("Company name the AIs should name")}</span><span class="ab-inline"><input class="input" name="f_brand" dir="auto" value="${esc(d.brand)}" maxlength="80"><button class="btn btn-small" type="submit" ${B.busy ? "disabled" : ""}>${t("Save")}</button></span></label></form>
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
    api("POST", "ai-brand/suggest", { site_id: B.site }).then((r) => { B.suggest = r.suggestions; }).catch((err) => { B.suggest = null; UI().toast(t(err.message), { kind: "crit" }); })
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
    if ((el = hit("[data-ab-open]"))) { answerPanel(el.dataset.abOpen, el); return; }
    if ((el = hit("[data-ab-q-del]"))) { const id = el.dataset.abQDel; change(() => api("DELETE", `ai-brand/questions/${id}`)); return; }
    if (hit("[data-ab-suggest]")) { suggest(); return; }
    if ((el = hit("[data-ab-sug]"))) { const words = B.suggest[Number(el.dataset.abSug)]; B.suggest = B.suggest.filter((w) => w !== words); change(() => api("POST", "ai-brand/questions", { site_id: B.site, text: words, source: "suggested" })); return; }
    if (hit("[data-ab-sug-all]")) {
      const all = [...B.suggest]; B.suggest = [];
      change(async () => { for (const words of all) await api("POST", "ai-brand/questions", { site_id: B.site, text: words, source: "suggested" }); });
    }
  });
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
    const form = e.target.closest?.("[data-ab-add], [data-ab-brand-form]");
    if (!form) return;
    e.preventDefault();
    if (form.matches("[data-ab-add]")) {
      const words = form.elements.f_question.value;
      change(() => api("POST", "ai-brand/questions", { site_id: B.site, text: words }), { focus: "[data-ab-add] input" });
    } else {
      const name = form.elements.f_brand.value;
      change(() => api("PUT", "ai-brand/brand", { site_id: B.site, brand: name })).then(() => UI().toast(t("Name saved"), { kind: "good" }));
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
