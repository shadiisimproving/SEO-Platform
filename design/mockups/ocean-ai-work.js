/* The new design (Cobalt) for the ai-work screens: only acts when document.documentElement.dataset.brand === "ocean".
   Owner, 2026-11-26: the screens laid out in the spirit of the new Today (today-ocean.js), every feature kept.

   AI search: ai-search-view.js hands its parts to OceanAIWork.ai(d, parts) and this file lays them out: four number cards,
     AI visits per week as bars (this period in cobalt, the weeks before in pale grey, the best week sky blue) with the
     assistants beside it, Next actions, and You vs them (Copilot's answers, Google's AI Overviews: blue you, purple them).
   Tasks: tasks.js asks OceanAIWork.tasksSummary(list) for four small cards above the board (open, late, this week, done).
   Notes, Resources, Social, Settings: restyled in look-ocean-ai-work.css; a few drawn parts are touched up here after each
   draw (status pills on Settings' connections, one next step in calm empty states). With the old design on, nothing here runs. */
(() => {
  "use strict";
  const on = () => document.documentElement.dataset.brand === "ocean";
  const UI = () => window.UI;
  const t = (w) => UI().t(w);
  const esc = (s) => UI().esc(s);
  const num = (v) => UI().num(v);
  const icon = (n, c) => UI().icon(n, c);
  const fill = (text, values) => String(t(text)).replace(/\{(\w+)\}/g, (_, k) => String(values?.[k] ?? ""));
  const fr = () => UI().state.lang === "fr";
  const pctWord = (v) => `${num(Math.round(v))}${fr() ? " %" : "%"}`;
  const day = (iso) => new Intl.DateTimeFormat(UI().locale(), { day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00`));

  /* A change as a pill with an arrow: green up, red down, never colour alone. */
  function pill(value, unit) {
    if (value === null || value === undefined || Number.isNaN(value)) return "";
    const r = Math.round(value);
    if (r === 0) return `<span class="cb-d cb-flat">±0</span>`;
    const up = r > 0;
    return `<span class="cb-d ${up ? "cb-up" : "cb-down"}">${icon(up ? "arrow-up" : "arrow-down")}${unit === "%" ? pctWord(Math.abs(r)) : num(Math.abs(r))}</span>`;
  }
  const kpiCard = ({ id, label, info = "", value, change = "", sub = "", foot = "" }) => `<section class="card cb-kpi ow-kpi" id="${id}">
    <span class="cb-l">${esc(t(label))}${info}</span>
    <span class="cb-v"><b>${value}</b>${change}</span>
    ${sub ? `<span class="cb-s">${sub}</span>` : ""}${foot}</section>`;

  /* ================= AI search ================= */
  const AI = { chart: "ga4" };
  /* Weeks of this period beside the same week of the period before: the n-th week now with the n-th week before. */
  function pairWeeks(weeks, from, field = "sessions") {
    const now = weeks.filter((w) => w.start >= from), before = weeks.filter((w) => w.start < from);
    const lead = before.length - now.length; // the weeks before are as many as now; if not, line them up from the end
    return now.map((w, i) => {
      const b = before[i + lead];
      return { day: w.start, end: w.end, now: w[field], was: b ? b[field] : null, wasDay: b?.start || null, mark: w.leads > 0 ? w.leads : 0, days: w.days };
    });
  }
  /* The weeks as the new design's one chart look (cb-chart.js, owner 2026-11-26 "soft area"): a cobalt line with a soft
     fade, the same weeks of the period before as a dashed grey line. Weeks with a key event: a small ink dot on the line. */
  const niceStep = (span) => [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000].find((s) => span / s <= 4.2) || 100000;
  function weekChart(points, { label, markWord = "" }) {
    if (!window.CBChart || points.length < 2) return "";
    const html = window.CBChart.plot({ points: points.map((p) => ({ day: p.day, now: p.now, was: p.was })), label, best: true, height: 230 });
    if (!html || !points.some((p) => p.mark)) return html;
    // The same scale cb-chart.js uses, to put the dots on the line.
    const vals = points.flatMap((p) => [p.now, p.was]).filter((v) => v !== null && v !== undefined);
    const H = 240, n = points.length, lo = Math.min(0, ...vals);
    let hi = Math.max(...vals); if (hi === lo) hi = lo + 1;
    const step = niceStep(hi - lo), top = Math.ceil(hi / step) * step, bottom = Math.min(0, Math.floor(lo / step) * step);
    const Y = (v) => H - ((v - bottom) / (top - bottom || 1)) * (H - 6);
    const dots = points.map((p, i) => (p.mark && p.now !== null && p.now !== undefined ? `<span class="ow-dot" title="${esc(`${markWord}: ${num(p.mark)}`)}" style="left:${((i / (n - 1)) * 100).toFixed(2)}%;top:${((Y(p.now) / H) * 100).toFixed(2)}%"></span>` : "")).join("");
    return html.replace('<div class="cb-dates"', `${dots}<div class="cb-dates"`);
  }
  /* The numbers behind the bars, folded under them (the line charts had Show table). */
  const weekTable = (points, markWord = "") => `<details class="ow-table"><summary>${t("Show table")}</summary><div class="table-wrap"><table class="data"><thead><tr><th scope="col">${t("Week")}</th><th scope="col" class="num">${t("This period")}</th><th scope="col" class="num">${t("Period before")}</th>${markWord ? `<th scope="col" class="num">${esc(markWord)}</th>` : ""}</tr></thead>
    <tbody>${points.map((p) => `<tr><td>${esc(day(p.day))} – ${esc(day(p.end || p.day))}</td><td class="num">${p.now === null || p.now === undefined ? "—" : num(p.now)}</td><td class="num">${p.was === null || p.was === undefined ? "—" : num(p.was)}</td>${markWord ? `<td class="num">${num(p.mark || 0)}</td>` : ""}</tr>`).join("")}</tbody></table></div></details>`;
  const legend = (extra = "") => `<span class="cb-legend"><span><i></i>${t("This period")}</span><span><i class="was"></i>${t("Period before")}</span>${extra}</span>`;

  function aiKpis(d, P) {
    const ga4 = P.stateOf(d, "ga4"), wait = P.notReady(ga4), off = P.NOT_ON.includes(ga4.state) || wait;
    const offWords = esc(t(wait ? "Waiting for data" : "Google Analytics not connected"));
    const from = d.period?.from || "";
    const nowWeeks = d.weekly.filter((w) => w.start >= from);
    const visits = kpiCard({ id: "ai-visits", label: "AI visits", value: off ? "—" : num(d.sessions),
      change: off ? "" : pill(d.change, "%"),
      sub: off ? offWords : d.before !== null && d.before !== undefined ? `${t("was")} <b>${num(d.before)}</b>` : esc(t("No earlier period")),
      foot: !off && window.CBChart && nowWeeks.length > 1 ? `<span class="cb-mini-area">${window.CBChart.mini(nowWeeks.map((w) => w.sessions), pairWeeks(d.weekly, from).map((p) => p.was))}</span>` : "" });
    const word = window.GA4W.word("Leads", d), has = (v) => v !== null && v !== undefined;
    const leads = kpiCard({ id: "ai-leads", label: word,
      value: off ? "—" : d.key_events_set_up ? num(d.leads) : `<span class="cb-word">${esc(t("Not set up"))}</span>`,
      change: !off && d.key_events_set_up && has(d.before_leads) ? pill(d.leads - d.before_leads) : "",
      sub: off ? "" : !d.key_events_set_up ? esc(t("Mark forms as GA4 key events")) : has(d.before_leads) ? `${t("was")} <b>${num(d.before_leads)}</b>` : "" });
    // The rate beside organic search's, as two short bars: the AI one cobalt, organic grey.
    const r = d.rate, o = d.organic, rateOff = off || !d.key_events_set_up;
    const rmax = Math.max(r.value || 0, o.value || 0) || 1;
    const rateBars = !rateOff && r.value !== null && o.value !== null ? `<span class="ow-pair" aria-hidden="true"><span class="cb-prog"><span>${t("AI")}</span><b>${P.pct(r.value)}</b><span class="cb-bar"><i style="width:${Math.round(((r.value || 0) / rmax) * 100)}%"></i></span></span><span class="cb-prog ow-grey"><span>${t("organic search")}</span><b>${P.pct(o.value)}</b><span class="cb-bar"><i style="width:${Math.round(((o.value || 0) / rmax) * 100)}%"></i></span></span></span>` : "";
    const rate = kpiCard({ id: "ai-rate", label: window.GA4W.word("Lead rate", d), info: UI().info ? UI().info("Key events per AI visit. It shows from 30 AI visits: below that, one more or less swings it too far.") : "",
      value: rateOff || r.value === null ? "—" : P.pct(r.value),
      sub: rateOff ? "" : r.value === null ? esc(fill("needs {need} AI visits, {n} so far", { need: num(r.needs), n: num(r.visits) })) : rateBars ? "" : o.value === null ? "" : `${esc(t("organic search"))} <b>${P.pct(o.value)}</b>`,
      foot: rateOff ? "" : r.value === null ? `<span class="cb-share" aria-hidden="true"><i class="now" style="width:${Math.min(100, Math.round(((r.visits || 0) / (r.needs || 30)) * 100))}%"></i></span>` : rateBars });
    const c = d.copilot, one = c.sites.length === 1 ? c.sites[0] : null, cited = has(c.citations);
    const before = one?.before && has(one.before.citations) ? one.before.citations : null;
    const cite = kpiCard({ id: "ai-citations", label: "Copilot citations", value: cited ? num(c.citations) : "—",
      change: cited && before !== null ? pill(c.citations - before) : "",
      sub: !cited ? `<button class="link-btn" data-lv-connect="clarity">${t("Upload a Clarity AI download")}</button>` : [has(c.share) ? `${esc(t("share"))} <b>${P.share(c.share)}</b>` : "", P.copilotSpan(one)].filter(Boolean).join(" · "),
      foot: cited && has(c.share) ? `<span class="cb-share" aria-hidden="true"><i class="now" style="width:${Math.min(100, Math.round(c.share))}%"></i></span>` : "" });
    return `<div class="cb-grid cb-kpis ai-tiles">${visits}${leads}${rate}${cite}</div>`;
  }

  function aiHero(d, P) {
    const ga4 = P.stateOf(d, "ga4"), live = P.stateOf(d, "clarity_live");
    const liveOn = !P.NOT_ON.includes(live.state);
    const from = d.period?.from || "";
    const word = window.GA4W.word("Leads", d);
    const g = pairWeeks(d.weekly, from), c = pairWeeks(d.clarity_weekly || [], from);
    const gDraw = !P.NOT_ON.includes(ga4.state) && !P.notReady(ga4) && d.weekly.some((w) => w.sessions) && g.length > 1 && Boolean(window.CBChart);
    const cDraw = liveOn && (d.clarity_weekly || []).some((w) => w.sessions) && c.length > 1 && Boolean(window.CBChart);
    if (AI.chart === "clarity" && !liveOn) AI.chart = "ga4";
    const pick = AI.chart;
    const switcher = liveOn ? `<div class="cb-seg" role="group" aria-label="${t("Source")}"><button type="button" data-ow-ai-chart="ga4" aria-pressed="${pick === "ga4"}">${t("Google Analytics")}</button><button type="button" data-ow-ai-chart="clarity" aria-pressed="${pick === "clarity"}">${t("Clarity live")}</button></div>` : "";
    const s = d.second_opinion;
    const second = !s || !liveOn ? "" : !s.days ? UI().info("No Clarity live reads on these days yet to compare.")
      : UI().info([fill("Second opinion: Clarity live saw {c} on the {n} read; Google Analytics saw {g}.", { c: fill(s.clarity === 1 ? "{n} AI visit" : "{n} AI visits", { n: num(s.clarity) }), n: s.days === 1 ? t("day") : fill("{n} days", { n: num(s.days) }), g: num(s.ga4) }), "Same days for both. They count differently, so they're never added."]);
    let body;
    if (pick === "ga4") {
      const total = d.sessions;
      body = gDraw ? `<div class="cb-big"><b>${num(total)}</b>${pill(d.change, "%")}<span>${d.before !== null && d.before !== undefined ? `${t("vs")} ${num(d.before)}` : ""}</span>${legend(d.key_events_set_up && g.some((p) => p.mark) ? `<span><i class="ow-dot-key"></i>${esc(t(word === "Leads" ? "a week with a lead" : "a week with a key event"))}</span>` : "")}</div>
        ${weekChart(g, { label: t("AI visits per week"), markWord: t(word) })}${weekTable(g, d.key_events_set_up ? t(word) : "")}`
        : `<div class="ow-half-state">${P.ga4Half(d)}</div>`;
    } else {
      const sum = c.reduce((n, p) => n + (p.now || 0), 0), was = c.reduce((n, p) => n + (p.was || 0), 0), anyWas = c.some((p) => p.was !== null && p.was !== undefined);
      body = cDraw ? `<div class="cb-big"><b>${num(sum)}</b>${anyWas && was ? pill(((sum - was) / was) * 100, "%") : ""}<span>${anyWas ? `${t("vs")} ${num(was)}` : ""}</span>${legend()}</div>${weekChart(c, { label: `${t("Clarity live")} · ${t("AI visits per week")}` })}${weekTable(c)}`
        : `<div class="ow-half-state">${P.clarityHalf(d)}</div>`;
    }
    const clarityLine = liveOn ? "" : `<p class="ai-clarity-line cb-s" data-ai-half="clarity">${esc(`${t("Clarity live")}: ${t(live.state === "not_used" ? "not used" : "not connected")}`)}${live.state === "not_connected" ? ` · <button class="link-btn" data-lv-connect="clarity">${t("Connect")}</button>` : ""}</p>`;
    // Beside it: which assistants sent the visits, one bar each, logo first.
    const src = (d.sources || []).filter((x) => x.sessions > 0), max = Math.max(1, ...src.map((x) => x.sessions));
    const right = `<div class="cb-hero-r"><h3>${t("Which assistants")}</h3>${src.length ? src.slice(0, 6).map((x) => `<div class="cb-prog"><span class="ow-who">${P.mark(x.source)}</span><b>${num(x.sessions)}</b><span class="cb-bar"><i style="width:${Math.round((x.sessions / max) * 100)}%"></i></span></div>`).join("")
      + (src.length > 6 ? `<button class="cb-more" data-ai-tab="assistants">${fill("All {n}", { n: num(src.length) })}${icon("chevron-right")}</button>` : "")
      : `<p class="cb-s">${esc(t(P.NOT_ON.includes(ga4.state) ? "Connect Google Analytics to see which assistants send visits." : "No AI visits in this period."))}</p>`}</div>`;
    return `<section class="card cb-hero ow-ai-hero"><div class="cb-hero-l"><div class="cb-ch"><h2>${t("AI visits per week")}</h2>${second}${switcher}</div>${body}${clarityLine}</div>${right}</section>`;
  }

  /* You vs them: of the AI answers that could name a site, how many name you (blue) and how many only others (purple). */
  function split(you, them, { youWord, themWord }) {
    const total = you + them;
    const w = total ? Math.round((you / total) * 100) : 0;
    return `<div class="ow-split" aria-hidden="true"><i class="you" style="flex:${you || 0.0001}"></i><i class="them" style="flex:${them || 0.0001}"></i></div>
      <ul class="ow-keys"><li><i class="you"></i><span>${esc(youWord)}</span><b>${pctWord(w)}</b></li><li><i class="them"></i><span>${esc(themWord)}</span><b>${pctWord(100 - w)}</b></li></ul>`;
  }
  function vsCard(d) {
    const c = d.copilot, o = d.ai_overviews, parts = [];
    if (c.share !== null && c.share !== undefined) {
      parts.push(`<div class="ow-vs-part"><h3>${t("Copilot's answers")}</h3><p class="cb-s">${esc(fill("Cited {n} times", { n: num(c.citations || 0) }))}</p>${split(c.share, 100 - c.share, { youWord: t("You"), themWord: t("Other sites") })}</div>`);
    } else {
      parts.push(`<div class="ow-vs-part"><h3>${t("Copilot's answers")}</h3><p class="cb-s">${t("No Copilot download yet.")}</p><button class="btn btn-small" data-lv-connect="clarity">${t("Upload a Clarity AI download")}</button></div>`);
    }
    if (o.with_overview) {
      parts.push(`<div class="ow-vs-part"><h3>${t("Google AI Overviews")}</h3><p class="cb-s">${esc(fill("You're cited in {m} of {o}", { m: num(o.cited_me), o: num(o.with_overview) }))}</p>${split(o.cited_me, o.with_overview - o.cited_me, { youWord: t("Cite you"), themWord: t("Only others") })}</div>`);
    } else {
      parts.push(`<div class="ow-vs-part"><h3>${t("Google AI Overviews")}</h3><p class="cb-s">${esc(t(!o.tracked ? "No keywords tracked, so no AI Overview checks yet." : "No AI Overview checks yet."))}</p></div>`);
    }
    return `<section class="card cb-card ow-vs"><div class="cb-ch"><h2>${t("You vs them")}</h2><span class="cb-meta">${t("in AI answers")}</span><button class="cb-more" data-ai-jump="brand">${t("What AI says about you")}${icon("chevron-right")}</button></div>
      <div class="cb-body ow-vs-body">${parts.join("")}</div></section>`;
  }

  function ai(d, P) {
    return `<div class="ow-ai">${P.answer(d)}${aiKpis(d, P)}
      <div class="cb-grid cb-row2 ow-row2">${aiHero(d, P)}${P.actionsCard(d)}</div>
      <div class="cb-grid ow-row-vs">${vsCard(d)}</div>
      ${P.tabsCard(d)}${P.aioCard(d)}</div>`;
  }

  /* ================= Tasks: four small cards above the board ================= */
  function tasksSummary(list, { today, weekEnd, recentStart }) {
    const open = list.filter((x) => x.status !== "done");
    const late = open.filter((x) => x.due && x.due < today);
    const week = open.filter((x) => x.due && x.due >= today && x.due <= weekEnd);
    const done = list.filter((x) => x.status === "done" && x.completed_on && x.completed_on >= recentStart);
    const doing = open.filter((x) => x.status === "doing").length, blocked = open.filter((x) => x.status === "blocked").length;
    const all = list.length, share = all ? Math.round((list.filter((x) => x.status === "done").length / all) * 100) : 0;
    const card = (id, label, value, sub, foot = "", tone = "") => `<section class="card cb-kpi ow-kpi ${tone}" id="${id}"><span class="cb-l">${esc(t(label))}</span><span class="cb-v"><b>${num(value)}</b>${foot}</span><span class="cb-s">${sub}</span></section>`;
    const lateTag = late.length ? "" : `<span class="cb-d cb-up">${icon("check")}${esc(t("On time"))}</span>`;
    return `<div class="cb-grid cb-kpis ow-tk-sum" id="ow-tk-sum">
      ${card("ow-tk-open", "Open", open.length, `${t("In progress")} <b>${num(doing)}</b> · ${t("Blocked")} <b>${num(blocked)}</b>`)}
      ${card("ow-tk-late", "Late", late.length, late.length ? `<span class="ow-late">${icon("triangle-alert")}${esc(t("Past their date, not done"))}</span>` : esc(t("Nothing past its date")), lateTag)}
      ${card("ow-tk-week", "Due this week", week.length, week.length ? esc(fill("Next: {d}", { d: day(week.map((x) => x.due).sort()[0]) })) : esc(t("Nothing due this week")))}
      ${card("ow-tk-done", "Done in 7 days", done.length, `${esc(fill("{p} of all tasks done", { p: pctWord(share) }))}`, "")}
    </div>`;
  }

  /* ================= After each draw: small touch-ups ================= */
  // Settings → Connections: the status as a pill with its word, Not connected when there is none.
  function settingsPills(root) {
    root.querySelectorAll(".conn-row").forEach((row) => {
      const box = row.querySelector(".conn-status");
      if (!box || box.dataset.ow) return;
      box.dataset.ow = "1";
      const mark = box.querySelector(".status");
      if (mark && !mark.textContent.trim()) {
        const word = mark.getAttribute("aria-label") || "";
        const good = mark.classList.contains("good");
        const p = UI().fragment(`<span class="ow-pill ${good ? "ow-ok" : mark.classList.contains("crit") ? "ow-bad" : "ow-warn"}"></span>`).firstElementChild;
        p.append(...mark.childNodes, document.createTextNode(word));
        mark.replaceWith(p);
      } else if (!box.textContent.trim()) {
        const act = row.querySelector(".acts [data-conn]");
        if (act && /connect|connecter/i.test(act.textContent)) box.append(UI().fragment(`<span class="ow-pill ow-off">${esc(t("Not connected"))}</span>`));
      }
    });
  }
  // Settings' Sites and Important domains: a logo beside each domain.
  const DOMAIN = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;
  function settingsLogos(root) {
    if (!UI().siteLogo) return;
    root.querySelectorAll(".content table.data tbody tr").forEach((tr) => {
      const cell = [...tr.cells].find((td) => !td.classList.contains("chk-cell"));
      if (!cell || cell.querySelector(".site-logo, img, .ow-res-logo")) return;
      const text = cell.textContent.trim();
      if (!DOMAIN.test(text)) return;
      const target = cell.querySelector("a, button, span") || cell;
      target.prepend(UI().fragment(`<span class="ow-res-logo">${UI().siteLogo(text, 16)}</span>`));
    });
  }
  // Settings' first number card: how many of the tools are connected, as a bar.
  function settingsShare(root) {
    const tile = root.querySelector("#set-tiles > .ncard:first-child");
    if (!tile || tile.querySelector(".cb-share")) return;
    const now = parseInt(tile.querySelector(".ncard-fig")?.textContent.replace(/\D/g, "") || "", 10);
    const all = parseInt(tile.querySelector(".ncard-rest")?.textContent.replace(/\D/g, "") || "", 10);
    if (!all || Number.isNaN(now)) return;
    tile.append(UI().fragment(`<span class="cb-share ow-set-share" aria-hidden="true"><i class="now" style="width:${Math.min(100, Math.round((now / all) * 100))}%"></i></span>`));
  }
  // Resources with nothing in it: the calm empty card gets its one next step.
  function resourcesEmpty(root) {
    const empty = root.querySelector(".content .empty");
    const main = root.querySelector(".topbar .btn-main, .head-actions .btn-main, .page-head .btn-main");
    if (!empty || !main || empty.querySelector(".ow-next")) return;
    const copy = main.cloneNode(true);
    copy.classList.add("ow-next");
    copy.removeAttribute("id");
    const wrap = document.createElement("div");
    wrap.className = "ow-next-wrap";
    wrap.append(copy);
    empty.append(wrap);
  }
  // Resources: each title gets the logo of the site its link goes to.
  function resourcesLogos(root) {
    if (!UI().siteLogo) return;
    root.querySelectorAll("tr").forEach((tr) => {
      const a = tr.querySelector("a.ext-link"), title = tr.querySelector("[data-lv-resource]");
      if (!a || !title || tr.querySelector(".ow-res-logo")) return;
      let host = "";
      try { host = new URL(a.href).hostname.replace(/^www\./, ""); } catch { return; }
      const box = UI().fragment(`<span class="ow-res-logo">${UI().siteLogo(host, 16)}</span>`);
      title.before(box);
    });
  }
  function notesEmpty(root) {
    const empty = root.querySelector("#nv-empty .empty");
    if (!empty || empty.querySelector(".ow-next")) return;
    empty.append(UI().fragment(`<div class="ow-next-wrap"><button class="btn btn-main ow-next" type="button" data-ow-write>${icon("plus")}${esc(t("Write a note"))}</button></div>`));
  }
  function touchUp() {
    if (!on() || !UI()) return;
    const root = document.getElementById("page");
    if (!root) return;
    const route = UI().state.route;
    const mine = ["ai", "tasks", "notes", "resources", "social", "settings"].includes(route);
    if (mine && root.dataset.ow !== route) root.dataset.ow = route; else if (!mine && root.dataset.ow) delete root.dataset.ow;
    if (route === "settings") { settingsPills(root); settingsShare(root); settingsLogos(root); }
    else if (route === "resources") { resourcesEmpty(root); resourcesLogos(root); }
    else if (route === "notes") notesEmpty(root);
  }
  let queued = false;
  const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; touchUp(); }); };
  function watch() {
    const root = document.getElementById("page");
    if (!root) { setTimeout(watch, 200); return; }
    new MutationObserver(() => { if (on()) later(); }).observe(root, { childList: true, subtree: true });
    later();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();

  document.addEventListener("click", (e) => {
    if (!on()) return;
    const b = e.target.closest?.("[data-ow-ai-chart]");
    if (b) { AI.chart = b.dataset.owAiChart; UI().render({ keepScroll: true }); return; }
    if (e.target.closest?.("[data-ow-write]")) document.getElementById("nv-write")?.click();
  });

  window.OceanAIWork = { on, ai, tasksSummary };

  const words = {
    "Week of {d}": "Semaine du {d}", "Week": "Semaine", "Show table": "Voir le tableau", "Which assistants": "Quels assistants", "Source": "Source", "You vs them": "Vous ou eux", "in AI answers": "dans les réponses des IA",
    "Copilot's answers": "Réponses de Copilot", "Cited {n} times": "Cité {n} fois", "You": "Vous", "Other sites": "Autres sites", "No Copilot download yet.": "Pas encore d'export Copilot.",
    "Google AI Overviews": "Aperçus IA de Google", "You're cited in {m} of {o}": "Vous êtes cité dans {m} sur {o}", "Cite you": "Vous citent", "Only others": "Seulement d'autres",
    "a week with a key event": "une semaine avec un événement clé", "AI": "IA", "All {n}": "Tout ({n})",
    "Key events per AI visit. It shows from 30 AI visits: below that, one more or less swings it too far.": "Événements clés par visite IA. Affiché à partir de 30 visites IA : en dessous, un de plus ou de moins le fait trop varier.",
    "Open": "Ouvertes", "Late": "En retard", "Due this week": "À faire cette semaine", "Done in 7 days": "Terminées en 7 jours", "On time": "À l'heure",
    "Past their date, not done": "Date passée, pas terminées", "Nothing past its date": "Rien en retard", "Next: {d}": "Prochaine : {d}", "Nothing due this week": "Rien cette semaine",
    "{p} of all tasks done": "{p} de toutes les tâches terminées", "Not connected": "Non connecté",
    "Step {n}": "Étape {n}", "{n} of {m} done": "{n} sur {m} faits",
  };
  window.FR = window.FR || {};
  Object.entries(words).forEach(([k, v]) => { if (window.FR[k] === undefined) window.FR[k] = v; });
})();
