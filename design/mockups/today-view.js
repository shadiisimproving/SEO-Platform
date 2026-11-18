/* Draws Today from plain data. The sample (mockup.js) and the real app (today-live.js) both come here, so they can't drift apart.
   Order: how results are going, what to do first, then what moved, then what rivals changed. */
(() => {
  "use strict";
  const UI = () => window.UI;
  const t = (word) => UI().t(word);
  const esc = (text) => UI().esc(text);
  const num = (value) => UI().num(value);
  const icon = (name, cls) => UI().icon(name, cls);
  const allSites = () => UI().state.site === "all";
  const day = (iso) => new Intl.DateTimeFormat(UI().locale(), { day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00`));

  // ---- the sentence on top ------------------------------------------------------------------------
  function clause(name, change, unit, first) {
    const fr = UI().state.lang === "fr";
    const word = first ? name[0] : name[1];
    const size = `${num(Math.abs(change))}${unit ? (fr ? " %" : "%") : ""}`;
    if (fr) return `${word} ${change === 0 ? "stables" : `en ${change > 0 ? "hausse" : "baisse"} de ${size}`}`;
    return `${word} ${change === 0 ? "are steady" : `are ${change > 0 ? "up" : "down"} ${size}`}`;
  }
  function answer(r, range) {
    const fr = UI().state.lang === "fr";
    const byDays = !r.window || ["7d", "28d"].includes(r.window.range);
    const parts = [];
    const add = (figure, name, unit) => { if (parts.length < 2 && figure.value !== null && figure.change !== null) parts.push(clause(name, figure.change, unit, !parts.length)); };
    const keyEvents = r.leads?.kind === "key_events";
    add(r.leads, keyEvents ? (fr ? ["Événements clés", "événements clés"] : ["Key events", "key events"]) : ["Leads", "leads"], false);
    add(r.visits, fr ? ["Visites", "visites"] : ["Visits", "visits"], true);
    add(r.clicks, fr ? ["Clics Google", "clics Google"] : ["Google clicks", "Google clicks"], true);
    if (parts.length && !byDays) return fr ? `${parts.join(" et ")} sur cette période (${range?.label || ""}).` : `${parts.join(" and ")} over this period (${range?.label || ""}).`;
    if (parts.length) return fr ? `${parts.join(" et ")} sur les ${r.days} derniers jours.` : `${parts.join(" and ")} over the last ${r.days} days.`;
    if (r.leads.value !== null || r.visits.value !== null || r.clicks.value !== null) return t("No earlier period to compare with yet.");
    const states = [r.clicks?.source, r.visits?.source].filter(Boolean);
    if (states.includes("waiting")) return t("Google connected. First numbers after the next run.");
    if (states.includes("failing")) return t("Google stopped answering. See Settings.");
    return t("Connect Google to see leads, visits and clicks.");
  }
  /* What a box says when it has no number: the source's real state, in Channels' words. */
  function stateWord(source, name) {
    if (source === "waiting") return t("Connected. Waiting for data");
    if (source === "failing") return `${name}: ${t("stopped working")}`;
    if (source === "not_used") return `${name}: ${t("not used")}`;
    if (source === "ok") return t("No data in this period");
    return `${name}: ${t("not connected")}`;
  }
  function needsYou(count) {
    const fr = UI().state.lang === "fr";
    if (!count) return fr ? "Rien à traiter aujourd'hui." : "Nothing needs you today.";
    if (fr) return `${num(count)} ${count === 1 ? "point" : "points"} à traiter aujourd'hui.`;
    return `${num(count)} ${count === 1 ? "thing needs" : "things need"} you today.`;
  }

  // ---- three numbers ------------------------------------------------------------------------------
  const pill = (value, unit, withWord = true) => {
    if (unit === "%" && UI().state.lang === "fr") unit = " %"; // French puts a space before %: +12 %
    if (value === 0) return `<span class="sec d-pill">±0${unit}</span>`;
    const better = value > 0;
    return `<span class="${better ? "good" : "crit"} d-pill">${icon(better ? "arrow-up" : "arrow-down")}${better ? "+" : "−"}${num(Math.abs(value))}${unit}${withWord ? ` ${t(better ? "better" : "worse")}` : ""}</span>`;
  };
  /* Each number has its own graph, so three different scales never share an axis. This period is solid, the one before is dashed and grey. */
  function graph(key, label, points) {
    if (!points?.length || !window.LV?.lineChart || !points.some((p) => p.now !== null)) return "";
    const days = points.map((p) => p.day);
    // Leads are too few per day to read as a line of 0s and 1s, so they build up: above the dashed line means ahead of the period before.
    const building = key === "leads";
    const values = (field) => {
      let running = 0;
      return Object.fromEntries(points.map((p) => { if (p[field] === null) return [p.day, null]; running += p[field]; return [p.day, building ? running : p[field]]; }));
    };
    const series = [{ name: "This period", color: "var(--ch-1)", values: values("now") }];
    if (points.some((p) => p.was !== null)) series.push({ name: "Period before", color: "var(--muted)", values: values("was"), dash: true });
    return window.LV.lineChart(`today-${key}`, days, series, { legend: false });
  }
  /* A link to another screen keeps the site picked here; the period goes along by itself (the app's one range). */
  const withSite = (href, host = allSites() ? null : UI().siteHostPicked?.()) => (host && !href.includes("?") ? `${href}?site=${encodeURIComponent(host)}` : href);
  /* "vs 28 before": the period before's own total, from the graph's days, only when it gives the server's change. */
  function beforeWords(data) {
    const points = data.points || [], was = points.filter((p) => p.was !== null && p.was !== undefined);
    if (data.change === null || typeof data.value !== "number" || !points.length || was.length !== points.length) return "";
    const before = was.reduce((sum, p) => sum + p.was, 0);
    return data.value - before === data.change ? `<span class="muted">${esc(t("{n} in the period before").replace("{n}", num(before)))}</span>` : "";
  }
  function figure(key, label, href, data, unit, emptyWord) {
    // The change can cover fewer sites than the sum (one has too little data before): said under it (final review N3).
    const fewer = data.change !== null && data.compared && data.compared < data.sites;
    const covers = fewer ? `<span class="muted">${esc(t("Change on {n} of {m} sites").replace("{n}", num(data.compared)).replace("{m}", num(data.sites)))}</span>`
      : data.sites && data.sites < data.of ? `<span class="muted">${num(data.sites)} ${t("of")} ${num(data.of)} ${t("sites")}</span>` : "";
    let fig = esc(data.value === null ? "—" : num(data.value)), note;
    if (data.state === "not_set_up") { fig = `<span class="today-fig-word">${t("Not set up")}</span>`; note = `<span class="muted">${t("Mark forms as GA4 key events")}</span>`; }
    else if (data.value === null) note = `<span class="muted">${data.source ? esc(stateWord(data.source, key === "clicks" ? "Search Console" : "GA4")) : t(emptyWord)}</span>`;
    else note = `${data.change === null ? `<span class="muted">${t("No earlier period")}</span>` : pill(data.change, unit, false)}${key === "leads" ? beforeWords(data) : ""}${covers}`;
    // Leads build up day by day, so the graph says so under it: a dashed line climbing faster is the period before, not a fall.
    const cap = key === "leads" && data.state !== "not_set_up" && data.points?.some((p) => p.now !== null) ? `<p class="small muted today-graph-cap">${t("Running total, day by day. Dashed: the period before.")}</p>` : "";
    return `<section class="tile today-num"><a class="today-num-link" href="${withSite(href)}"><div class="lab">${t(label)}</div><div class="fig">${fig}</div></a><div class="delta">${note}</div>${data.state === "not_set_up" ? "" : graph(key, label, data.points)}${cap}</section>`;
  }
  /* The simpler screens (UI.simple()): one number card each, through UI.card, with a tall graph of its own (owner, 2026-11-05)
     but no axis numbers and no "Show as a table": the screen each card opens has the full chart and its table. The dates
     and the comparison are in the head's date line, so the caption under the cards goes when the real app sends them. */
  const shiftDay = (iso, by) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + by); return d.toISOString().slice(0, 10); };
  function simpleCard(key, label, href, data, unit, emptyWord, dates = "", full = "") {
    const points = data.points || [];
    let spark = null;
    if (data.state !== "not_set_up" && points.some((p) => p.now !== null)) {
      const run = (field) => { let sum = 0; return points.map((p) => { if (p[field] === null || p[field] === undefined) return null; sum += p[field]; return key === "leads" ? sum : p[field]; }); };
      spark = { now: run("now"), days: points.map((p) => p.day) };
      if (points.some((p) => p.was !== null && p.was !== undefined)) spark.before = run("was");
      // Unusual days (a burst of visits) get a dot on their line: this period's by its day, the period before's by its place.
      const odd = data.unusual;
      if (odd?.days?.length) spark.marks = points.map((p) => odd.days.includes(p.day));
      if (odd?.days_before?.length && data.compareFrom) spark.marksBefore = points.map((_, i) => odd.days_before.includes(shiftDay(data.compareFrom, i)));
    }
    const fewer = data.change !== null && data.change !== undefined && data.compared && data.compared < data.sites;
    const covers = fewer ? t("Change on {n} of {m} sites").replace("{n}", num(data.compared)).replace("{m}", num(data.sites))
      : data.sites && data.sites < data.of ? `${num(data.sites)} ${t("of")} ${num(data.of)} ${t("sites")}` : "";
    let value = data.value, sub = null;
    if (data.state === "not_set_up") { value = `<span class="today-fig-word">${t("Not set up")}</span>`; sub = esc(t("Mark forms as GA4 key events")); }
    else if (data.value === null) sub = esc(data.source ? stateWord(data.source, key === "clicks" ? "Search Console" : "GA4") : t(emptyWord));
    else if (data.change === null) sub = esc(t(data.blank ? "Counting changed" : data.note === "little_before" ? "Too little data before" : "No earlier period"));
    else if (covers) sub = esc(covers);
    // Each card's own days when the sources end on different days (GA4 runs ahead of Search Console): said under it.
    if (dates && data.value !== null && data.state !== "not_set_up") sub = sub ? `${sub} · ${esc(dates)}` : esc(dates);
    let change = data.value === null || data.change === null || data.state === "not_set_up" ? null : { value: data.change, unit };
    // "before → now" under the figure: the period before's total from the graph's own days, only when it gives the server's change.
    const was = points.filter((p) => p.was !== null && p.was !== undefined);
    if (change && was.length === points.length && typeof data.value === "number") {
      const before = was.reduce((sum, p) => sum + p.was, 0);
      const same = unit ? before > 0 && Math.round(((data.value - before) / before) * 100) === data.change : data.value - before === data.change;
      if (same) change = { ...change, now: data.value, before };
    }
    return UI().card({ id: key, label, value, change, sub, spark, tall: true, href: withSite(href), cls: "tile today-num today-num-link", info: [full && full !== label ? `${full}.` : "", key === "leads" && spark ? "Graph: running total." : ""].filter(Boolean) });
  }
  function simpleNumbers(r) {
    const w = r.window;
    // The plain-file sample has no dates in its head, so it keeps its one line saying what the numbers cover.
    const caption = w ? "" : `<p class="small muted today-caption"><span>${t("Last 28 days vs the 28 before")}${r.through ? ` · ${t("Data through")} ${esc(day(r.through))}` : ""}</span></p>`;
    const split = w?.ga4 && w.from && w.ga4.to !== w.to;
    const ga4Dates = split ? `${day(w.ga4.from)} – ${day(w.ga4.to)}` : "", gscDates = split ? `${day(w.from)} – ${day(w.to)}` : "";
    const visits = { ...r.visits, compareFrom: w?.ga4?.compare_from || null };
    return `<div class="tiles today-nums">
        ${simpleCard("leads", window.GA4W.short("Leads", r.leads), "#conversions", r.leads, "", r.leads.state === "no_ga4" ? "GA4 not connected" : "No data yet", ga4Dates, window.GA4W.word("Leads", r.leads))}
        ${simpleCard("visits", "Visits", "#channels", visits, "%", "GA4 not connected", ga4Dates)}
        ${simpleCard("clicks", "Google clicks", "#overview", r.clicks, "%", "Search Console not connected", gscDates)}
      </div>${caption}${ga4Notes(r)}`;
  }
  /* What Today says about its Google Analytics numbers (ga4-words.js): lead events to pick, a change in how GA4 counts,
     too little data before, unusual days, and a property that also records another website. */
  function ga4Notes(r) {
    if (!window.GA4W || r.leads?.state === "no_ga4") return "";
    const leftOut = r.visits.change !== null && r.visits.change !== undefined ? (r.visits.left_out || []).map((x) => x.host) : [];
    const said = window.GA4W.notes({ kind: r.leads.state === "not_set_up" ? null : r.leads.kind, key_event_hosts: r.leads.key_event_hosts, changes: r.leads.changes, note: r.visits.note, unusual: r.visits.unusual, little_hosts: leftOut, compared_count: r.visits.compared });
    const hosts = window.GA4W.hostsNote(r.other_hosts);
    return said || hosts ? `<div class="ga4-notes">${hosts}${said.replace(/^<div class="ga4-notes">|<\/div>$/g, "")}</div>` : "";
  }
  function numbers(r, range) {
    if (UI().simple?.()) return simpleNumbers(r);
    const w = r.window, period = w?.from && w?.to ? `${day(w.from)} – ${day(w.to)}` : "";
    const against = !w ? "" : w.compare_unavailable === "google" ? t("No comparison: Google keeps 16 months of data.") : w.compare_unavailable ? (w.history_from ? t("No comparison: stored data starts on {day}.").replace("{day}", day(w.history_from)) : t("No earlier period stored")) : w.compare === "none" ? t("No comparison") : w.compare === "yoy" ? t("vs last year") : t("vs period before");
    const caption = w ? `${esc(range?.label || "")}${range?.label ? " · " : ""}${esc(period)} · ${esc(against)}` : `${t("Last 28 days vs the 28 before")}${r.through ? ` · ${t("Data through")} ${esc(day(r.through))}` : ""}`;
    const drawn = [r.leads, r.visits, r.clicks].some((x) => x.points?.some((p) => p.now !== null));
    const key = drawn ? `<span class="today-legend"><span><i class="today-key"></i>${t("This period")}</span><span><i class="today-key was"></i>${t("Period before")}</span></span>` : "";
    return `<div class="tiles today-nums">
        ${figure("leads", window.GA4W.word("Leads", r.leads), "#conversions", r.leads, "", r.leads.state === "no_ga4" ? "GA4 not connected" : "No data yet")}
        ${figure("visits", "Visits", "#channels", r.visits, "%", "GA4 not connected")}
        ${figure("clicks", "Google clicks", "#overview", r.clicks, "%", "Search Console not connected")}
      </div><p class="small muted today-caption"><span>${caption}</span>${key}</p>${w?.ga4 && w.ga4.to !== w.to ? `<p class="small muted today-caption">${esc(t("Visits and leads: {a} – {b}, where Google Analytics' data ends.").replace("{a}", day(w.ga4.from)).replace("{b}", day(w.ga4.to)))}</p>` : ""}${ga4Notes(r)}`;
  }

  // ---- do these first -----------------------------------------------------------------------------
  /* Why a row is where it is (seo/metrics/today.py _reason), so the order explains itself: an icon and a word, never colour alone. */
  const REASONS = {
    offline: ["globe", "Site is offline", "crit"], may_go_offline: ["clock", "Site could go offline", "crit"], losing_leads: ["arrow-down", "Losing leads", "crit"], losing_clicks: ["arrow-down", "Losing clicks", "warn"],
    losing_link: ["link-2-off", "Lost a backlink", "warn"], data_lost: ["clock", "Data being lost", "warn"], data_stopped: ["ban", "Data stopped", "warn"],
    site_problem: ["heart-pulse", "Site problem", "warn"], chance: ["target", "Chance to win", "info"], info: ["info", "Good to know", "info"], check: ["info", "Worth a look", "info"],
  };
  const reasonTag = (item) => {
    const r = REASONS[item.reason];
    return r ? `<span class="today-why today-why-${r[2]}">${icon(r[0])}${esc(t(r[1]))}</span>` : "";
  };
  /* What shows before Show all: every serious row, always, then warnings up to three rows in all, in the order given
     (the server ranks by what is being lost: a domain or certificate about to expire comes first). */
  function firstRows(todo) {
    let warnLeft = Math.max(0, 3 - todo.filter((item) => item.severity === "crit").length);
    return todo.filter((item) => item.severity === "crit" || (item.severity === "warn" && warnLeft-- > 0));
  }
  const severityIcon = (severity) => (severity === "crit" ? icon("octagon-alert", "crit") : severity === "warn" ? icon("triangle-alert", "warn") : icon("info", "sec"));
  // A row's Task button shows on hover or keyboard focus with the simpler screens switch on (.row-act, table-tools.css).
  const taskLook = () => (UI().simple?.() ? { label: "Task", cls: "btn btn-small row-act" } : { label: "Task" });
  const hostTag = (host, title = "") => (host && allSites() && !title.includes(host) ? ` <span class="small muted today-host" dir="auto">${esc(host)}</span>` : "");
  /* The rival change behind a drop, in one short line (seo/metrics/today.py _add_rival_changes): the rival's logo, then
     "Rival changed /abonnement/ 2 days before" with the path a button to that Page vs page (or the competitor when unpaired). */
  function rivalLine(rival, words) {
    if (!rival || !words) return "";
    const [key, values] = words;
    const said = t(key).split("{n}").join(num(values?.n ?? 0));
    const attrs = rival.pair_id ? `data-today-pair="${esc(String(rival.pair_id))}" data-today-site="${esc(String(rival.site_id))}"` : `data-today-rival="${esc(String(rival.competitor_id))}" data-today-site="${esc(String(rival.site_id))}"`;
    const tip = `${rival.host}${rival.path} · ${day(rival.day)}${rival.pair_id ? ` · ${t("Compare")}` : ""}`;
    const link = `<button type="button" class="link-btn mono today-rival-path" ${attrs} data-tip="${esc(tip)}" dir="ltr">${esc(rival.path)}</button>`;
    const [a, b = ""] = said.split("{path}");
    return `<div class="d today-cause today-rival">${UI().siteLogo ? UI().siteLogo(rival.host, 14) : ""}<span dir="auto">${esc(a)}${link}${esc(b)}</span></div>`;
  }
  const todoRow = (item) => `<li data-row="${esc(item.id)}"><span>${severityIcon(item.severity)}</span>
      <div class="what"><div class="t" dir="auto">${item.titleHtml || esc(item.title)}${hostTag(item.host, item.title)}</div>${item.reason || item.detail ? `<div class="d">${reasonTag(item)}${item.detail ? `<span dir="auto">${esc(item.detail)}</span>` : ""}</div>` : ""}${item.cause ? `<div class="d today-cause" dir="auto">${esc(item.cause)}</div>` : ""}${item.week ? `<div class="d today-cause" dir="auto">${esc(item.week)}</div>` : ""}${rivalLine(item.rival, item.rivalWords)}</div>
      <div class="acts">${item.seenAttr ? `<button class="btn btn-small btn-ghost ack" ${item.seenAttr} aria-label="${t("Mark seen")}: ${esc(item.title)}" data-tip="${t("Hide it until something changes. Undo in the message.")}">${icon("eye")}<span>${t("Mark seen")}</span></button>` : ""}
        ${UI().taskButton(item.find, taskLook())}${item.mainHtml}</div></li>`;
  function todoCard(todo) {
    const first = firstRows(todo);
    const shown = UI().state.attentionAll ? todo : first;
    const more = todo.length > first.length;
    const body = todo.length
      ? `${shown.length ? `<ul class="rows">${shown.map(todoRow).join("")}</ul>` : ""}${more ? `<div class="row-item" style="border-bottom:0"><button class="link-btn" id="show-all">${UI().state.attentionAll ? t("Show less") : `${t("Show all")} ${num(todo.length)}`}</button></div>` : ""}`
      : `<div class="empty today-empty"><p>${t("Nothing needs you today.")}</p></div>`;
    return `<section class="card"><div class="card-head"><h2>${t("Do these first")}</h2></div>${body}</section>`;
  }

  // ---- my work ------------------------------------------------------------------------------------
  // With All sites picked, each task says its site: two "Error pages" tasks from two sites would look the same (2026-11-11).
  function tasksHtml() {
    const list = UI().nextTasks?.(3) || [];
    const rows = list.map((task) => `<button class="stat-row" data-today-task="${esc(String(task.id))}"><span class="today-task-name" dir="auto">${esc(task.title)}${hostTag(task.site_host, task.title)}</span>${task.late ? UI().status("crit", `${t("Late")} · ${esc(day(task.due))}`) : `<span class="small muted nowrap">${task.due ? esc(day(task.due)) : t("No date")}</span>`}</button>`).join("");
    return `${rows || `<div class="stat-row"><span class="muted">${t("No open tasks for you.")}</span></div>`}<div class="stat-row"><a class="link-btn" href="#tasks">${t("View all tasks")}</a></div>`;
  }
  /* Which site has nothing connected, said by name: "site-three.example: connect Google", or how many when it's several. */
  const hostsWord = (hosts) => (hosts.length === 1 ? hosts[0] : `${num(hosts.length)} ${t("sites")}`);
  const connectWords = (s) => (s.hosts?.length ? `${hostsWord(s.hosts)}: ${t("connect Google")}` : t("Connect Google"));
  const noSourcesWords = (s) => (s.hosts?.length ? `${hostsWord(s.hosts)}: ${t("nothing connected now.")}` : t("No data sources connected."));
  function workCard(vm) {
    const count = (word, value) => (value ? `<a class="stat-row" href="#backlinks"><span>${t(word)}</span><span class="num">${num(value)}</span></a>` : "");
    const s = vm.sources;
    const waiting = s.waiting ? ` · ${num(s.waiting)} ${t("waiting for data")}` : "";
    const line = s.total
      ? `<a class="stat-row today-sources" href="#settings"><span>${t("Data sources")}${s.note ? `<span class="small muted today-note">${esc(s.note)}</span>` : ""}</span>${UI().status(s.ok === s.total ? "good" : s.ok + (s.waiting || 0) === s.total ? "info" : "warn", `${num(s.ok)} ${t("of")} ${num(s.total)} ${t("OK")}${waiting}`)}</a>`
      : `<div class="stat-row"><span class="muted" dir="auto">${esc(noSourcesWords(s))}</span><button class="btn btn-small" ${s.connectAttr} aria-label="${esc(connectWords(s))}">${t("Connect Google")}</button></div>`;
    return `<section class="card"><div class="card-head"><h2>${t("My work")}</h2></div>
        <div id="today-tasks">${tasksHtml()}</div>${count("Backlinks to follow up", vm.followUp)}${count("Renewals in 30 days", vm.renewals)}${vm.sourcesInHead ? "" : line}</section>`;
  }

  // ---- going down, going up -----------------------------------------------------------------------
  /* Search Console's average position over a week, never a rank: "avg pos 8.4 → 12.1" (daily-monitoring F8). */
  const dec1 = (v) => (UI().dec ? UI().dec(v) : num(v));
  const avgPos = (move) => `${t("avg pos")} ${dec1(move.was_pos ?? move.was)} → ${dec1(move.now_pos ?? move.now)}`;
  function moveFind(move) {
    if (move.type === "keyword") return { title: `${move.query}: ${avgPos(move)}`, host: move.host, keywords: [move.query], source: { type: "keyword", label: move.query, host: move.host, facts: [avgPos(move), "Search Console"], link: "#keywords", key: `move|keyword|${move.host}|${move.query}` } };
    return { title: `${move.path}: ${t("Google clicks")} ${move.was} → ${move.clicks}`, host: move.host, pages: [move.path], source: { type: "alert", label: move.path, host: move.host, facts: [`${t("Google clicks")} ${move.was} → ${move.clicks}`], link: "#content", key: `move|page|${move.host}|${move.path}` } };
  }
  function moveRow(move, down) {
    const task = down ? `<div class="acts">${UI().taskButton(moveFind(move), taskLook())}</div>` : "";
    if (move.type === "keyword") {
      const up = move.places > 0;
      const target = move.keyword_id ? "#keywords" : "#overview";
      return `<li><div class="what"><div class="t"><a class="today-link" href="${esc(window.KeywordLink ? window.KeywordLink.href(move.query, move.host) : target)}" data-today-keyword="${esc(move.query)}" data-today-host="${esc(move.host || "")}" data-today-keyword-id="${esc(move.keyword_id || "")}" data-today-range="7d" dir="auto">${esc(move.query)}</a>${hostTag(move.host)}</div>${down ? rivalLine(move.rival, move.words?.rival) : ""}</div>
        <span class="chg ${up ? "good" : "crit"}">${icon(up ? "arrow-up" : "arrow-down")}${esc(avgPos(move))}</span>${task}</li>`;
    }
    const up = move.clicks > move.was;
    const size = move.new || move.change === null || move.change === undefined ? t("New") : `${up ? "+" : "−"}${num(Math.abs(move.change))}%`;
    return `<li><div class="what"><div class="t">${PageLink.html(move.url || move.path, { text: move.path, host: move.host, cls: "today-link mono" })}${hostTag(move.host)}</div><div class="d">${UI().logoOnly("Google", t("Google clicks"))} ${num(move.was)} → ${num(move.clicks)} ${t("clicks")}</div>${down ? rivalLine(move.rival, move.words?.rival) : ""}</div>
      <span class="chg ${up ? "good" : "crit"}">${icon(up ? "arrow-up" : "arrow-down")}${size}</span>${task}</li>`;
  }
  // With the switch on, "7 days" sits in each card head instead of the "Week on week" line above the pair (plan, change 4).
  // Where the positions come from is said once in the head, not as a boxed logo on every row (owner, 2026-11-16: "this logo looks bad").
  const moveSource = (moves) => (moves.some((m) => m.type === "keyword") ? `<span class="today-moves-src" title="${esc(t("Search Console average position"))}">${t("Search Console")}</span>` : "");
  /* The two weeks compared, said on the card: "14–20 Oct vs 7–13 Oct" (daily-monitoring F8). */
  const span = (a, b) => `${day(a)} – ${day(b)}`;
  const weeksWords = (w) => (w ? `${span(w.from, w.to)} ${t("vs")} ${span(w.before_from, w.before_to)}` : "");
  /* Nothing moved this week, but Do these first holds longer drops: said, so "Nothing fell" never reads as all is well beside a −80%. */
  const emptyWords = (down, drops) => (down ? (drops ? "Nothing fell this week. Longer drops are in Do these first." : "Nothing fell much this week.") : "Nothing rose much this week.");
  const moveCard = (title, moves, down, w, drops) => `<section class="card"><div class="card-head"><h2>${t(title)}</h2>${UI().simple?.() ? `<span class="end small muted today-moves-meta">${moveSource(moves)}${moveSource(moves) ? `<span aria-hidden="true">·</span>` : ""}<span>${w ? esc(weeksWords(w)) : t("7 days")}</span></span>` : moveSource(moves) ? `<span class="end small muted today-moves-meta">${moveSource(moves)}</span>` : ""}</div>
      ${moves.length ? `<ul class="rows">${moves.map((move) => moveRow(move, down)).join("")}</ul>` : `<div class="empty today-empty"><p>${t(emptyWords(down, drops))}</p></div>`}</section>`;

  // ---- rivals -------------------------------------------------------------------------------------
  function rivalRow(r) {
    const find = { title: `${r.host}: ${r.label} ${r.path}`, host: r.my_host, pages: [r.my_path], source: { type: "competitor", label: `${r.host}: ${r.label}`, host: r.my_host, facts: [r.path, `${t("Your page")} ${r.my_path}`], link: `#competitors/pairs/${r.pair_id}`, key: `change|${r.id}` } };
    return `<li><div class="what"><div class="t"><span class="mono" dir="auto">${esc(r.host)}</span> · ${esc(r.label)} · ${PageLink.html(r.url || r.path, { text: r.path, host: r.host, cls: "mono" })}</div>
        <div class="d">${t("Your page")} ${PageLink.html(r.my_url || r.my_path, { text: r.my_path, host: r.my_host, cls: "mono" })}${hostTag(r.my_host)}${r.when ? ` · ${esc(r.when)}` : ""}</div>${window.ChangeSummary?.slot(r) || ""}</div>
      <div class="acts">${UI().taskButton(find, taskLook())}<button class="btn btn-small" data-today-pair="${esc(String(r.pair_id))}" data-today-site="${esc(String(r.site_id))}">${t("Compare")}</button></div></li>`;
  }
  function rivalCard(rivals, other) {
    const word = UI().state.lang === "fr" ? `${num(other)} ${other === 1 ? "autre modification" : "autres modifications"}` : `${num(other)} other ${other === 1 ? "edit" : "edits"}`;
    const more = other ? `<div class="row-item" style="border-bottom:0"><a class="link-btn" href="#competitors">${word}</a></div>` : "";
    const none = rivals.length ? "" : `<div class="empty today-empty"><p>${t("No rival changes in the last 7 days.")}</p></div>`;
    return `<section class="card"><div class="card-head"><h2>${t("Rival changes on competing pages")}</h2><span class="end small muted">${t("Last 7 days")}</span></div>
        ${rivals.length ? `<ul class="rows">${rivals.map(rivalRow).join("")}</ul>` : ""}${none}${more}</section>`;
  }

  // ---- sites --------------------------------------------------------------------------------------
  function sitesCard(sites) {
    const leadWord = sites.some((s) => s.lead_kind === "leads") ? "Leads" : "Key events";
    const cell = (value, change, unit) => (value === null || value === undefined ? `<span class="muted" title="${t("No data yet")}">—</span>` : `<span class="today-cell">${num(value)}${change === null || change === undefined ? "" : pill(change, unit, false)}</span>`);
    // The date most rows share is said once in the card head; only a row whose data stops on another day keeps its own.
    const tally = {};
    sites.forEach((s) => { if (s.through) tally[s.through] = (tally[s.through] || 0) + 1; });
    const through = Object.keys(tally).sort((a, b) => tally[b] - tally[a] || b.localeCompare(a))[0] || "";
    const row = (s) => {
      const sub = [s.alerts ? `${num(s.alerts)} ${t(s.alerts === 1 ? "warning" : "warnings")}` : "", s.through && s.through !== through ? `${t("Data through")} ${esc(day(s.through))}` : ""].filter(Boolean).join(" · ");
      return `<tr style="cursor:default"><td data-label="${t("Site")}">${s.pick ? `<button class="today-link mono" data-site="${esc(s.pick)}" dir="auto">${esc(s.host)}</button>` : `<span class="mono" dir="auto">${esc(s.host)}</span>`}${sub ? `<div class="small muted">${sub}</div>` : ""}</td>
        <td class="c" data-label="${t(leadWord)}">${s.leads_state === "not_set_up" ? `<span class="muted">${t("Not set up")}</span>` : cell(s.leads, s.leads_change, "")}</td><td class="c" data-label="${t("Visits")}"><span class="today-cell">${cell(s.visits, s.visits_change, "%")}${s.visits_note === "little_before" ? `<span class="small muted" title="${esc(t("Too little data before to compare visits."))}">${t("too little before")}</span>` : ""}${s.trend?.length > 1 ? UI().spark(s.trend, { w: 64, h: 22 }) : ""}</span></td><td class="c" data-label="${t("Google clicks")}">${cell(s.clicks, s.clicks_change, "%")}</td></tr>`;
    };
    return `<section class="card"><div class="card-head"><h2>${t("Sites")}</h2><span class="end small muted">${t("Last 28 days vs the 28 before")}${through ? ` · ${t("Data through")} ${esc(day(through))}` : ""}</span></div>
      <div class="table-wrap" style="box-shadow:none"><table class="data"><thead><tr><th>${t("Site")}</th><th class="c">${t(leadWord)}</th><th class="c">${t("Visits")}</th><th class="c">${t("Google clicks")}</th></tr></thead><tbody>${sites.map(row).join("")}</tbody></table></div></section>`;
  }

  // ---- the page -----------------------------------------------------------------------------------
  /* No number yet: why, and the one button that moves it on. Waiting: Refresh data (the button the waiting cards already
     use, screens-live.js); stopped: Fix; nothing connected: Connect Google (ai-reports-workflow, COMPARISON lost place 4). */
  function firstRun(r, vm) {
    const states = [r.clicks?.source, r.visits?.source].filter(Boolean);
    const refresh = window.LV?.refreshBtn ? window.LV.refreshBtn(true) : "";
    if (states.includes("waiting")) return { badge: "Waiting for first data", sev: "info", line: "Google is connected. Fetch the first numbers now, or they come with the next run.", act: refresh };
    if (states.includes("failing")) return { badge: "Data stopped", sev: "warn", line: "Google stopped answering. See Settings.", act: `<button class="btn btn-small" data-go="settings">${t("Open Settings")}</button>` };
    if (states.includes("ok")) return null; // connected and read: an empty period is answered under the numbers
    const s = vm.sources || {};
    return { badge: "Not set up yet", sev: "info", line: "Connect Google to see leads, visits and clicks.", act: s.connectAttr ? `<button class="btn btn-main btn-small" ${s.connectAttr}>${t("Connect Google")}</button>` : "" };
  }
  function page(vm) {
    const r = vm.results;
    const urgent = vm.todo.filter((item) => item.severity !== "info").length;
    const hasData = r.leads.value !== null || r.visits.value !== null || r.clicks.value !== null;
    const stopped = vm.googleStopped && r.through ? ` ${t("Google numbers stop at")} ${esc(day(r.through))}.` : "";
    const anyMove = vm.goingDown.length || vm.goingUp.length;
    // A verdict badge and the count; the numbers are in the cards below, so they aren't said again here (2026-11-12).
    const crit = vm.todo.filter((item) => item.severity === "crit").length;
    // Before any number exists, "All clear" would be a false all-clear: the verdict says what's missing and the way on.
    const before = hasData ? null : firstRun(r, vm);
    const verdict = before ? UI().status(before.sev, t(before.badge)) : crit ? UI().status("crit", `${t("Urgent")}: ${num(crit)}`) : urgent ? UI().status("warn", t("To do")) : UI().status("good", t("All clear"));
    const second = before ? (urgent ? needsYou(urgent) : t(before.line)) : `${needsYou(urgent)}${stopped}`;
    const state = hasData || before ? "" : `<p class="today-state" dir="auto">${esc(answer(r, vm.range))}</p>`;
    return `<div class="today-answer"><p class="today-verdict">${verdict} <span class="today-second" dir="auto">${esc(second)}</span></p>${state}${before?.act ? `<p class="today-first-act">${before.act}</p>` : ""}</div>
      ${vm.setupHtml || ""}
      ${numbers(r, vm.range)}
      <div class="cols"><div>${todoCard(vm.todo)}</div><div>${workCard(vm)}</div></div>
      ${anyMove || hasData ? `${UI().simple?.() ? "" : `<div class="today-moves-head"><span class="small muted">${t("Week on week")}${vm.movesWindow ? ` · ${esc(weeksWords(vm.movesWindow))}` : ""}</span></div>`}<div class="today-moves">${moveCard("Going down", vm.goingDown, true, vm.movesWindow, vm.todoDrops)}${moveCard("Going up", vm.goingUp, false, vm.movesWindow, 0)}</div>` : ""}
      ${vm.rivals.length || vm.otherEdits || hasData ? rivalCard(vm.rivals, vm.otherEdits) : ""}
      ${allSites() && vm.sites.length > 1 ? sitesCard(vm.sites) : ""}`;
  }

  /* The simpler head's parts for Today (today-live.js hands them to UI.head): the sources as one chip that opens Settings
     (Connect when none is connected, a warning when one stopped), and the caveats that leave the page for the (i). */
  function headParts(vm) {
    const s = vm.sources, w = vm.results?.window, info = [];
    let source;
    if (!s.total) source = { word: connectWords(s), sev: "warn", open: s.connectAttr };
    else {
      const fine = s.ok === s.total || s.ok + (s.waiting || 0) === s.total;
      source = { word: `${num(s.ok)} ${t("of")} ${num(s.total)} ${t("sources OK")}${s.waiting ? ` · ${num(s.waiting)} ${t("waiting for data")}` : ""}`, sev: fine ? "" : "warn", open: 'data-go="settings"' };
    }
    if (w?.ga4 && w.ga4.to !== w.to) info.push(t("Visits and leads: {a} – {b}, where Google Analytics' data ends.").replace("{a}", day(w.ga4.from)).replace("{b}", day(w.ga4.to)));
    if (s.note) info.push(s.note);
    return { source, info };
  }

  window.TodayView = { page, tasksHtml, withSite, headParts };

  /* Compare goes through the Competitors tab, so its list behind the pair belongs to the right site. */
  document.addEventListener("click", (e) => {
    const el = e.target.closest?.("[data-today-pair]");
    if (!el) return;
    const site = Number(el.dataset.todaySite);
    window.COMP.open("pairs", { openPairId: Number(el.dataset.todayPair) }, site);
  });
  // A rival change on a page with no pair: that competitor's profile, for the right site.
  document.addEventListener("click", (e) => {
    const el = e.target.closest?.("[data-today-rival]");
    if (!el) return;
    window.COMP.open("list", { competitorId: Number(el.dataset.todayRival) }, Number(el.dataset.todaySite));
  });

  const fr = {
    "Rival changed {path} {n} days before": "Un concurrent a changé {path} {n} jours avant", "Rival changed {path} 1 day before": "Un concurrent a changé {path} 1 jour avant",
    "Rival changed {path} during the drop": "Un concurrent a changé {path} pendant la baisse",
    "Google connected. First numbers after the next run.": "Google connecté. Premiers chiffres après le prochain passage.",
    "Google stopped answering. See Settings.": "Google ne répond plus. Voir les réglages.",
    "Connected. Waiting for data": "Connecté. En attente de données", "stopped working": "ne fonctionne plus", "not used": "non utilisé", "not connected": "non connecté",
    "No data in this period": "Pas de données sur cette période", "waiting for data": "en attente de données",
    "No earlier period stored": "Pas de période antérieure enregistrée", "No comparison": "Sans comparaison",
    "vs last year": "vs l'an dernier", "vs period before": "vs période précédente",
    "Counting changed": "Comptage changé", "too little before": "trop peu avant",
    "Visits and leads: {a} – {b}, where Google Analytics' data ends.": "Visites et leads : {a} – {b}, là où s'arrêtent les données de Google Analytics.",
    "Waiting for first data": "En attente des premières données", "Not set up yet": "Pas encore configuré", "Open Settings": "Ouvrir les réglages",
    "Google is connected. Fetch the first numbers now, or they come with the next run.": "Google est connecté. Récupérez les premiers chiffres maintenant, ou ils arrivent au prochain passage.",
    "Losing leads": "Perd des leads", "avg pos": "pos. moy.", "New": "Nouveau", "vs": "vs",
    "Nothing fell this week. Longer drops are in Do these first.": "Pas de baisse cette semaine. Les baisses plus longues sont dans À faire en premier.",
    "Nothing fell much this week.": "Pas de forte baisse cette semaine.", "Nothing rose much this week.": "Pas de forte hausse cette semaine.",
    "Do these first": "À faire en premier", "Going down": "En baisse", "Going up": "En hausse", "Nothing fell much.": "Pas de forte baisse.", "Nothing rose much.": "Pas de forte hausse.",
    "Nothing needs you today.": "Rien à traiter aujourd'hui.", "Google numbers stop at": "Les chiffres Google s'arrêtent au", "No earlier period to compare with yet.": "Pas encore de période antérieure à comparer.",
    "Connect Google to see leads, visits and clicks.": "Connectez Google pour voir les leads, les visites et les clics.",
    "Not set up": "Non configuré", "Mark forms as GA4 key events": "Marquez vos formulaires comme événements clés GA4", "GA4 not connected": "GA4 non connecté", "Search Console not connected": "Search Console non connecté",
    "No earlier period": "Pas de période antérieure", "Change on {n} of {m} sites": "Évolution sur {n} des {m} sites", "sites": "sites", "Google clicks": "Clics Google", "Search Console average": "Moyenne Search Console", "Search Console average position": "Position moyenne Search Console", "clicks": "clics", "Late": "En retard", "No date": "Sans date",
    "No open tasks for you.": "Aucune tâche ouverte pour vous.", "View all tasks": "Voir toutes les tâches", "Your page": "Votre page", "Compare": "Comparer", "Rival changes on competing pages": "Changements des concurrents sur les pages rivales",
    "No rival changes in the last 7 days.": "Aucun changement des concurrents ces 7 derniers jours.", "Last 7 days": "7 derniers jours", "Week on week": "Semaine sur semaine",
    "Last 28 days vs the 28 before": "28 derniers jours vs les 28 précédents", "No data yet": "Pas encore de données",
    "Running total": "Total cumulé", "This period": "Cette période", "Period before": "Période précédente", "See page": "Voir la page", "Title changed": "Titre modifié", "Content changed": "Contenu modifié", "Restored": "Restauré",
    "Graph: running total.": "Graphique : total cumulé.", "Connect Google": "Connecter Google", "sources OK": "sources OK", "7 days": "7 jours",
    "Urgent": "Urgent", "To do": "À traiter", "All clear": "Rien d'urgent", "Mark seen": "Marquer vu", "Hide it until something changes. Undo in the message.": "Masqué jusqu'au prochain changement. Annulable dans le message.",
    "Site is offline": "Site hors ligne", "Site could go offline": "Le site peut tomber", "Losing clicks": "Perd des clics", "Lost a backlink": "Backlink perdu", "Data being lost": "Données en train de se perdre",
    "Data stopped": "Données arrêtées", "Site problem": "Problème sur le site", "Chance to win": "Occasion à saisir", "Good to know": "Bon à savoir", "Worth a look": "À regarder",
    "connect Google": "connecter Google", "no data sources connected.": "aucune source de données connectée.", "nothing connected now.": "rien de connecté pour l’instant.", "{n} in the period before": "{n} sur la période précédente",
    "Running total, day by day. Dashed: the period before.": "Total cumulé, jour après jour. En pointillé : la période précédente.",
    "/loyer-a-seville/: −32% Google clicks": "/loyer-a-seville/ : −32 % de clics Google", "Week on week: 85 → 58": "Semaine sur semaine : 85 → 58",
  };
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
