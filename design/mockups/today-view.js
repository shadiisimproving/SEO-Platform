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
  function answer(r) {
    const fr = UI().state.lang === "fr";
    const parts = [];
    const add = (figure, name, unit) => { if (parts.length < 2 && figure.value !== null && figure.change !== null) parts.push(clause(name, figure.change, unit, !parts.length)); };
    add(r.leads, fr ? ["Demandes", "demandes"] : ["Leads", "leads"], false);
    add(r.visits, fr ? ["Visites", "visites"] : ["Visits", "visits"], true);
    add(r.clicks, fr ? ["Clics Google", "clics Google"] : ["Google clicks", "Google clicks"], true);
    if (parts.length) return fr ? `${parts.join(" et ")} sur les ${r.days} derniers jours.` : `${parts.join(" and ")} over the last ${r.days} days.`;
    if (r.leads.value !== null || r.visits.value !== null || r.clicks.value !== null) return t("There isn't an earlier period to compare with yet.");
    return t("No results yet. Connect Google to see leads, visits and clicks.");
  }
  function needsYou(count) {
    const fr = UI().state.lang === "fr";
    if (!count) return fr ? "Rien à traiter aujourd'hui." : "Nothing needs you today.";
    if (fr) return `${num(count)} ${count === 1 ? "point" : "points"} à traiter aujourd'hui.`;
    return `${num(count)} ${count === 1 ? "thing needs" : "things need"} you today.`;
  }

  // ---- three numbers ------------------------------------------------------------------------------
  const pill = (value, unit, withWord = true) => {
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
  function figure(key, label, href, data, unit, emptyWord) {
    const covers = data.sites && data.sites < data.of ? `<span class="muted">${num(data.sites)} ${t("of")} ${num(data.of)} ${t("sites")}</span>` : "";
    let fig = esc(data.value === null ? "—" : num(data.value)), note;
    if (data.state === "not_set_up") { fig = `<span class="today-fig-word">${t("Not set up")}</span>`; note = `<span class="muted">${t("Mark your forms as key events in GA4")}</span>`; }
    else if (data.value === null) note = `<span class="muted">${t(emptyWord)}</span>`;
    else note = `${data.change === null ? `<span class="muted">${t("No earlier period to compare")}</span>` : pill(data.change, unit)}${covers}${key === "leads" ? `<span class="muted">${t("Graph: running total")}</span>` : ""}`;
    return `<section class="tile today-num"><a class="today-num-link" href="${href}"><div class="lab">${t(label)}</div><div class="fig">${fig}</div></a><div class="delta">${note}</div>${data.state === "not_set_up" ? "" : graph(key, label, data.points)}</section>`;
  }
  function numbers(r) {
    const caption = `${t("Last 28 days against the 28 before")}${r.through ? ` · ${t("Data through")} ${esc(day(r.through))}` : ""}`;
    const drawn = [r.leads, r.visits, r.clicks].some((x) => x.points?.some((p) => p.now !== null));
    const key = drawn ? `<span class="today-legend"><span><i class="today-key"></i>${t("This period")}</span><span><i class="today-key was"></i>${t("Period before")}</span></span>` : "";
    return `<div class="tiles today-nums">
        ${figure("leads", "Leads", "#conversions", r.leads, "", r.leads.state === "no_ga4" ? "GA4 not connected" : "No data yet")}
        ${figure("visits", "Visits", "#channels", r.visits, "%", "GA4 not connected")}
        ${figure("clicks", "Google clicks", "#overview", r.clicks, "%", "Search Console not connected")}
      </div><p class="small muted today-caption"><span>${caption}</span>${key}</p>`;
  }

  // ---- do these first -----------------------------------------------------------------------------
  const severityIcon = (severity) => (severity === "crit" ? icon("octagon-alert", "crit") : severity === "warn" ? icon("triangle-alert", "warn") : icon("info", "sec"));
  const hostTag = (host, title = "") => (host && allSites() && !title.includes(host) ? ` <span class="small muted mono" dir="auto">${esc(host)}</span>` : "");
  const todoRow = (item) => `<li data-row="${esc(item.id)}"><span>${severityIcon(item.severity)}</span>
      <div class="what"><div class="t" dir="auto">${esc(item.title)}${hostTag(item.host, item.title)}</div>${item.detail ? `<div class="d" dir="auto">${esc(item.detail)}</div>` : ""}</div>
      <div class="acts">${item.seenAttr ? `<button class="icon-btn ack" ${item.seenAttr} aria-label="${t("Mark as seen")}: ${esc(item.title)}" data-tip="${t("Mark as seen")}">${icon("check")}</button>` : ""}
        ${UI().taskButton(item.find, { label: "Task" })}${item.mainHtml}</div></li>`;
  function todoCard(todo) {
    const urgent = todo.filter((item) => item.severity !== "info");
    const shown = UI().state.attentionAll ? todo : urgent.slice(0, 3);
    const more = todo.length > urgent.slice(0, 3).length;
    const body = todo.length
      ? `${shown.length ? `<ul class="rows">${shown.map(todoRow).join("")}</ul>` : ""}${more ? `<div class="row-item" style="border-bottom:0"><button class="link-btn" id="show-all">${UI().state.attentionAll ? t("Show less") : `${t("Show all")} ${num(todo.length)}`}</button></div>` : ""}`
      : `<div class="empty today-empty"><p>${t("Nothing needs you today.")}</p></div>`;
    return `<section class="card"><div class="card-head"><h2>${t("Do these first")}</h2></div>${body}</section>`;
  }

  // ---- my work ------------------------------------------------------------------------------------
  function tasksHtml() {
    const list = UI().nextTasks?.(3) || [];
    const rows = list.map((task) => `<button class="stat-row" data-today-task="${esc(String(task.id))}"><span class="today-task-name" dir="auto">${esc(task.title)}</span>${task.late ? UI().status("crit", `${t("Late")} · ${esc(day(task.due))}`) : `<span class="small muted nowrap">${task.due ? esc(day(task.due)) : t("No date")}</span>`}</button>`).join("");
    return `${rows || `<div class="stat-row"><span class="muted">${t("No open tasks for you.")}</span></div>`}<div class="stat-row"><a class="link-btn" href="#tasks">${t("View all tasks")}</a></div>`;
  }
  function workCard(vm) {
    const count = (word, value) => (value ? `<a class="stat-row" href="#backlinks"><span>${t(word)}</span><span class="num">${num(value)}</span></a>` : "");
    const s = vm.sources;
    const line = s.total
      ? `<a class="stat-row today-sources" href="#settings"><span>${t("Data sources")}${s.note ? `<span class="small muted today-note">${esc(s.note)}</span>` : ""}</span>${UI().status(s.ok === s.total ? "good" : "warn", `${num(s.ok)} ${t("of")} ${num(s.total)} ${t("OK")}`)}</a>`
      : `<div class="stat-row"><span class="muted">${t("No data sources connected yet.")}</span><button class="btn btn-small" ${s.connectAttr}>${t("Connect Google")}</button></div>`;
    return `<section class="card"><div class="card-head"><h2>${t("My work")}</h2></div>
        <div id="today-tasks">${tasksHtml()}</div>${count("Backlinks to follow up", vm.followUp)}${count("Renewals in 30 days", vm.renewals)}${line}</section>`;
  }

  // ---- going down, going up -----------------------------------------------------------------------
  function moveFind(move) {
    if (move.type === "keyword") return { title: `${move.query}: #${move.was} → #${move.now}`, host: move.host, keywords: [move.query], source: { type: "keyword", label: move.query, host: move.host, facts: [`#${move.was} → #${move.now}`, "Search Console"], link: "#keywords", key: `move|keyword|${move.host}|${move.query}` } };
    return { title: `${move.path}: ${t("Google clicks")} ${move.was} → ${move.clicks}`, host: move.host, pages: [move.path], source: { type: "alert", label: move.path, host: move.host, facts: [`${t("Google clicks")} ${move.was} → ${move.clicks}`], link: "#content", key: `move|page|${move.host}|${move.path}` } };
  }
  function moveRow(move, down) {
    const task = down ? `<div class="acts">${UI().taskButton(moveFind(move), { label: "Task" })}</div>` : "";
    if (move.type === "keyword") {
      const up = move.places > 0;
      return `<li><div class="what"><div class="t"><a class="today-link" href="#keywords" dir="auto">${esc(move.query)}</a>${hostTag(move.host)}</div><div class="d">${t("Search Console average")}</div></div>
        <span class="chg ${up ? "good" : "crit"}">${icon(up ? "arrow-up" : "arrow-down")}#${num(move.was)} → #${num(move.now)}</span>${task}</li>`;
    }
    const up = move.change > 0;
    return `<li><div class="what"><div class="t"><a class="today-link mono" href="#content" dir="auto">${esc(move.path)}</a>${hostTag(move.host)}</div><div class="d">${t("Google clicks")} ${num(move.was)} → ${num(move.clicks)}</div></div>
      <span class="chg ${up ? "good" : "crit"}">${icon(up ? "arrow-up" : "arrow-down")}${up ? "+" : "−"}${num(Math.abs(move.change))}%</span>${task}</li>`;
  }
  const moveCard = (title, moves, down) => `<section class="card"><div class="card-head"><h2>${t(title)}</h2></div>
      ${moves.length ? `<ul class="rows">${moves.map((move) => moveRow(move, down)).join("")}</ul>` : `<div class="empty today-empty"><p>${t(down ? "Nothing fell much." : "Nothing rose much.")}</p></div>`}</section>`;

  // ---- rivals -------------------------------------------------------------------------------------
  function rivalRow(r) {
    const find = { title: `${r.host}: ${r.label} ${r.path}`, host: r.my_host, pages: [r.my_path], source: { type: "competitor", label: `${r.host}: ${r.label}`, host: r.my_host, facts: [r.path, `${t("Competes with your page")} ${r.my_path}`], link: `#competitors/pairs/${r.pair_id}`, key: `change|${r.id}` } };
    return `<li><div class="what"><div class="t"><span class="mono" dir="auto">${esc(r.host)}</span> · ${esc(r.label)} · <span class="mono" dir="auto">${esc(r.path)}</span></div>
        <div class="d">${t("Competes with your page")} <span class="mono" dir="auto">${esc(r.my_path)}</span>${hostTag(r.my_host)}${r.when ? ` · ${esc(r.when)}` : ""}</div>${window.ChangeSummary?.slot(r) || ""}</div>
      <div class="acts">${UI().taskButton(find, { label: "Task" })}<button class="btn btn-small" data-today-pair="${esc(String(r.pair_id))}" data-today-site="${esc(String(r.site_id))}">${t("Compare")}</button></div></li>`;
  }
  function rivalCard(rivals, other) {
    const word = UI().state.lang === "fr" ? `${num(other)} ${other === 1 ? "autre modification" : "autres modifications"}` : `${num(other)} other ${other === 1 ? "edit" : "edits"}`;
    const more = other ? `<div class="row-item" style="border-bottom:0"><a class="link-btn" href="#competitors">${word}</a></div>` : "";
    const none = rivals.length ? "" : `<div class="empty today-empty"><p>${t("No edits on pages that compete with yours in the last 7 days.")}</p></div>`;
    return `<section class="card"><div class="card-head"><h2>${t("Rivals, on pages that compete with yours")}</h2><span class="end small muted">${t("Last 7 days")}</span></div>
        ${rivals.length ? `<ul class="rows">${rivals.map(rivalRow).join("")}</ul>` : ""}${none}${more}</section>`;
  }

  // ---- sites --------------------------------------------------------------------------------------
  function sitesCard(sites) {
    const cell = (value, change, unit) => (value === null || value === undefined ? `<span class="muted" title="${t("No data yet")}">—</span>` : `<span class="today-cell">${num(value)}${change === null || change === undefined ? "" : pill(change, unit, false)}</span>`);
    const row = (s) => {
      const sub = [s.alerts ? `${num(s.alerts)} ${t(s.alerts === 1 ? "warning" : "warnings")}` : "", s.through ? `${t("Data through")} ${esc(day(s.through))}` : ""].filter(Boolean).join(" · ");
      return `<tr style="cursor:default"><td data-label="${t("Site")}">${s.pick ? `<button class="today-link mono" data-site="${esc(s.pick)}" dir="auto">${esc(s.host)}</button>` : `<span class="mono" dir="auto">${esc(s.host)}</span>`}${sub ? `<div class="small muted">${sub}</div>` : ""}</td>
        <td class="c" data-label="${t("Leads")}">${s.leads_state === "not_set_up" ? `<span class="muted">${t("Not set up")}</span>` : cell(s.leads, s.leads_change, "")}</td><td class="c" data-label="${t("Visits")}"><span class="today-cell">${cell(s.visits, s.visits_change, "%")}${s.trend?.length > 1 ? UI().spark(s.trend, { w: 64, h: 22 }) : ""}</span></td><td class="c" data-label="${t("Google clicks")}">${cell(s.clicks, s.clicks_change, "%")}</td></tr>`;
    };
    return `<section class="card"><div class="card-head"><h2>${t("Sites")}</h2><span class="end small muted">${t("Last 28 days against the 28 before")}</span></div>
      <div class="table-wrap" style="box-shadow:none"><table class="data"><thead><tr><th>${t("Site")}</th><th class="c">${t("Leads")}</th><th class="c">${t("Visits")}</th><th class="c">${t("Google clicks")}</th></tr></thead><tbody>${sites.map(row).join("")}</tbody></table></div></section>`;
  }

  // ---- the page -----------------------------------------------------------------------------------
  function page(vm) {
    const r = vm.results;
    const urgent = vm.todo.filter((item) => item.severity !== "info").length;
    const hasData = r.leads.value !== null || r.visits.value !== null || r.clicks.value !== null;
    const stopped = vm.googleStopped && r.through ? ` ${t("Google numbers stop at")} ${esc(day(r.through))}.` : "";
    const anyMove = vm.goingDown.length || vm.goingUp.length;
    return `<div class="today-answer"><p class="today-lead" dir="auto">${esc(answer(r))}</p><p class="today-second" dir="auto">${esc(needsYou(urgent))}${stopped}</p></div>
      ${numbers(r)}
      <div class="cols"><div>${todoCard(vm.todo)}</div><div>${workCard(vm)}</div></div>
      ${anyMove || hasData ? `<div class="today-moves-head"><span class="small muted">${t("Last 7 days against the 7 before")}</span></div><div class="today-moves">${moveCard("Going down", vm.goingDown, true)}${moveCard("Going up", vm.goingUp, false)}</div>` : ""}
      ${vm.rivals.length || vm.otherEdits || hasData ? rivalCard(vm.rivals, vm.otherEdits) : ""}
      ${allSites() && vm.sites.length > 1 ? sitesCard(vm.sites) : ""}`;
  }

  window.TodayView = { page, tasksHtml };

  /* Compare goes through the Competitors tab, so its list behind the pair belongs to the right site. */
  document.addEventListener("click", (e) => {
    const el = e.target.closest?.("[data-today-pair]");
    if (!el) return;
    const site = Number(el.dataset.todaySite);
    window.COMP.open("pairs", { openPairId: Number(el.dataset.todayPair) }, site);
  });

  const fr = {
    "Do these first": "À faire en premier", "Going down": "En baisse", "Going up": "En hausse", "Nothing fell much.": "Pas de forte baisse.", "Nothing rose much.": "Pas de forte hausse.",
    "Nothing needs you today.": "Rien à traiter aujourd'hui.", "Google numbers stop at": "Les chiffres Google s'arrêtent au", "There isn't an earlier period to compare with yet.": "Il n'y a pas encore de période antérieure à comparer.",
    "No results yet. Connect Google to see leads, visits and clicks.": "Pas encore de résultats. Connectez Google pour voir les demandes, les visites et les clics.",
    "Not set up": "Non configuré", "Mark your forms as key events in GA4": "Marquez vos formulaires comme événements clés dans GA4", "GA4 not connected": "GA4 non connecté", "Search Console not connected": "Search Console non connecté",
    "No earlier period to compare": "Pas de période antérieure à comparer", "sites": "sites", "Google clicks": "Clics Google", "Search Console average": "Moyenne Search Console", "Late": "En retard", "No date": "Sans date",
    "No open tasks for you.": "Aucune tâche ouverte pour vous.", "View all tasks": "Voir toutes les tâches", "Competes with your page": "Concurrence votre page", "Compare": "Comparer", "Rivals, on pages that compete with yours": "Concurrents, sur les pages face aux vôtres",
    "No edits on pages that compete with yours in the last 7 days.": "Aucune modification sur les pages face aux vôtres ces 7 derniers jours.", "Last 7 days": "7 derniers jours", "Last 7 days against the 7 before": "7 derniers jours contre les 7 précédents",
    "Last 28 days against the 28 before": "28 derniers jours contre les 28 précédents", "No data yet": "Pas encore de données",
    "Graph: running total": "Graphique : total cumulé", "This period": "Cette période", "Period before": "Période précédente", "See page": "Voir la page", "Title changed": "Titre modifié", "Content changed": "Contenu modifié", "Restored": "Restauré",
    "/loyer-a-dubai/ lost 32% of its Google clicks": "/loyer-a-dubai/ a perdu 32 % de ses clics Google", "Last 7 days against the 7 before: 85 → 58": "7 derniers jours contre les 7 précédents : 85 → 58",
  };
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
