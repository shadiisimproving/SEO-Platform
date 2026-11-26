/* Today in the new look (owner, 2026-11-26: picked Cobalt on design/redesign-2026-11-24/today-v2.html, a mockup on the
   real numbers). Drawn instead of TodayView's own layout only while html[data-brand="ocean"] is on (new-menu.js; the name
   stayed from the first round), from the same view model, so the to-do rules and every link stay the ones Today has.

   Rows: four number cards (the fourth, keywords on page 1, from Search Console positions); the day-by-day chart with
   where the leads came from beside it, and Do these first; visits by channel, keyword positions, pages going up;
   competitors moved and my work; then Today's own Keywords by ranking card and, on All sites, the sites table.
   Positions and channels are two extra calls, asked once per site and period and filled in where they land. */
(() => {
  "use strict";
  const UI = () => window.UI;
  const t = (word) => UI().t(word);
  const esc = (text) => UI().esc(text);
  const num = (value) => UI().num(value);
  const icon = (name, cls) => UI().icon(name, cls);
  const on = () => document.documentElement.dataset.brand === "ocean";
  const fr = () => UI().state.lang === "fr";
  const day = (iso) => new Intl.DateTimeFormat(UI().locale(), { day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00`));
  const pct = (v) => `${num(Math.abs(v))}${fr() ? " %" : "%"}`;
  const shift = (iso, by) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + by); return d.toISOString().slice(0, 10); };

  /* ---- the two extra answers: kept per site and period, asked once ---- */
  const held = new Map();
  function ask(path) {
    if (held.has(path)) return held.get(path);
    const entry = { data: undefined, error: null };
    held.set(path, entry);
    window.COMP.api("GET", path).then((d) => { entry.data = d; fill(); }).catch((e) => { entry.error = e.message; fill(); });
    return entry;
  }
  const siteQ = () => { const id = UI().siteIdPicked?.(); return id ? `site_id=${id}&` : ""; };
  const positionsPath = (w) => `rankings/positions?${siteQ()}then=${shift(w.from, -1)}&to=${w.to}`;
  const channelsPath = (w) => `metrics/channels?${siteQ()}from=${(w.ga4 || w).from}&to=${(w.ga4 || w).to}`;
  let last = null; // the view model drawn last, for filling in and for picking another number

  /* ---- small parts ---- */
  function pill(value, unit) {
    if (value === null || value === undefined) return "";
    if (value === 0) return `<span class="cb-d cb-flat">±0</span>`;
    const up = value > 0;
    return `<span class="cb-d ${up ? "cb-up" : "cb-down"}">${icon(up ? "arrow-up" : "arrow-down")}${unit === "%" ? pct(value) : num(Math.abs(value))}</span>`;
  }
  // The card's small graph: the soft area of cb-chart.js, the period before dashed.
  const mini = (now, was) => `<span class="cb-mini-area">${window.CBChart.mini(now, was)}</span>`;
  const beforeOf = (data) => {
    const p = data.points || [];
    return p.length && p.every((x) => x.was !== null && x.was !== undefined) ? p.reduce((s, x) => s + x.was, 0) : null;
  };
  const changePct = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null);
  function stateWord(data, key) {
    if (data.state === "not_set_up") return t("Mark forms as GA4 key events");
    const name = key === "clicks" ? "Search Console" : "GA4";
    if (data.source === "waiting") return t("Connected. Waiting for data");
    if (data.source === "failing") return `${name}: ${t("stopped working")}`;
    if (data.source === "ok") return t("No data in this period");
    return `${name}: ${t("not connected")}`;
  }
  const labelOf = (key, data) => (key === "leads" ? window.GA4W?.word?.("Leads", data) || "Leads" : key === "visits" ? "Visits" : "Google clicks");
  const hasPoints = (data) => data?.points?.some((p) => p.now !== null && p.now !== undefined);

  /* ---- row 1: the number cards ---- */
  const HREF = { leads: "#conversions", visits: "#channels", clicks: "#overview" };
  function kpi(key, data) {
    const label = labelOf(key, data);
    const has = data.value !== null && data.state !== "not_set_up";
    const before = has ? beforeOf(data) : null;
    // Leads are few: a percentage of the period before says it better than a count (36 against 106: −66%).
    const change = !has ? null : key === "leads" && before !== null ? changePct(data.value, before) : data.change;
    const sub = !has ? esc(stateWord(data, key)) : before !== null ? `${t("was")} <b>${num(before)}</b>` : data.change === null ? esc(t("No earlier period")) : "";
    const points = (data.points || []).map((p) => p.now ?? null), befores = (data.points || []).map((p) => p.was ?? null);
    return `<a class="card cb-kpi" href="${window.TodayView.withSite(HREF[key])}">
      <span class="cb-l">${esc(t(label))}</span>
      <span class="cb-v"><b>${data.state === "not_set_up" ? `<span class="cb-word">${t("Not set up")}</span>` : data.value === null ? "—" : num(data.value)}</b>${has ? pill(change, "%") : ""}</span>
      <span class="cb-s">${sub}</span>${has && points.length ? mini(points, befores) : ""}</a>`;
  }
  const BUCKETS = [["Top 3", 0, 3.5], ["4 – 10", 3.5, 10.5], ["11 – 20", 10.5, 20.5], ["Lower", 20.5, Infinity]];
  const countIn = (rows, field, lo, hi) => rows.filter((r) => r[field] !== null && r[field] !== undefined && r[field] > lo && r[field] <= hi).length;
  // Keywords on page 1: Search Console average position at most 10.5, now against the day before the period.
  function pageOne(w) {
    const e = ask(positionsPath(w));
    const rows = e.data ? Object.values(e.data.rows || {}) : null;
    let body;
    if (e.error) body = `<span class="cb-s">${esc(e.error)}</span>`;
    else if (!rows) body = `<span class="cb-v"><b>—</b></span><span class="cb-s">${t("Loading…")}</span>`;
    else {
      const now = countIn(rows, "now", 0, 10.5), then = countIn(rows, "then", 0, 10.5);
      const share = rows.length ? Math.round((now / rows.length) * 100) : 0, was = rows.length ? Math.round((then / rows.length) * 100) : 0;
      body = `<span class="cb-v"><b>${num(now)}</b>${pill(now - then)}</span><span class="cb-s">${t("was")} <b>${num(then)}</b> · ${t("of")} ${num(rows.length)} ${t("tracked")}</span>
        <span class="cb-share" aria-hidden="true"><i class="now" style="width:${share}%"></i><i class="was" style="width:${was}%"></i></span>`;
    }
    return `<a class="card cb-kpi" id="cb-p1" href="#keywords"><span class="cb-l">${t("Keywords on page 1")}</span>${body}</a>`;
  }

  /* ---- row 2: the chart, where the leads came from, Do these first ---- */
  let picked = "leads";
  const niceStep = (max) => [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((s) => max / s <= 4.2) || 10000;
  const bestOf = (points) => { let b = 0; points.forEach((p, i) => { if ((p.now ?? 0) > (points[b].now ?? 0)) b = i; }); return b; };
  function chart(key, data) {
    const points = data.points || [];
    if (!points.length) return "";
    const n = points.length;
    return window.CBChart.plot({ points, label: `${t(labelOf(key, data))} ${t("each day")}, ${day(points[0].day)} – ${day(points[n - 1].day)}` });
  }
  function heroLeft(r) {
    const data = r[picked], label = labelOf(picked, data), before = beforeOf(data), pts = data.points || [];
    const best = pts.length ? bestOf(pts) : 0;
    const change = picked === "leads" && before !== null && data.value !== null ? data.value - before : data.change;
    const words = [before !== null ? `${t("vs")} ${num(before)}` : "", pts.length ? `${t("best day")} ${num(pts[best].now ?? 0)} ${t("on")} ${day(pts[best].day)}` : ""].filter(Boolean).join(" · ");
    const switcher = ["leads", "visits", "clicks"].filter((k) => hasPoints(r[k]))
      .map((k) => `<button type="button" data-cb-metric="${k}" aria-pressed="${k === picked}">${esc(t(labelOf(k, r[k])))}</button>`).join("");
    return `<div class="cb-hero-l"><div class="cb-ch"><h2>${esc(t(label))} ${t("each day")}</h2><div class="cb-seg" role="group" aria-label="${t("Chart")}">${switcher}</div></div>
      <div class="cb-big"><b>${data.value === null ? "—" : num(data.value)}</b>${pill(change, picked === "leads" ? "" : "%")}<span>${esc(words)}</span>
      <span class="cb-legend"><span><i></i>${t("This period")}</span><span><i class="was"></i>${t("Period before")}</span></span></div>
      ${chart(picked, data)}</div>`;
  }
  const CHANNEL = { "Organic Search": "Organic search", Direct: "Direct", "Organic Video": "Video", "Organic Social": "Social", Referral: "Other sites", "AI assistants": "AI assistants", "Paid Search": "Paid", "Paid Social": "Paid", "Paid Other": "Paid", Email: "Email" };
  function merged(list, field) {
    const out = new Map();
    list.forEach((c) => { const k = CHANNEL[c.channel] || "Other"; out.set(k, (out.get(k) || 0) + (c[field] || 0)); });
    return [...out.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  }
  function heroRight(w) {
    const e = ask(channelsPath(w)), head = `<h3>${t("Where they came from")}</h3>`;
    if (e.error) return `<div class="cb-hero-r">${head}<p class="cb-s">${esc(e.error)}</p></div>`;
    if (!e.data) return `<div class="cb-hero-r">${head}<p class="cb-s">${t("Loading…")}</p></div>`;
    const rows = merged(e.data.channels || [], "leads").slice(0, 6), max = Math.max(1, ...rows.map(([, v]) => v));
    if (!rows.length) return `<div class="cb-hero-r">${head}<p class="cb-s">${t("No data in this period")}</p></div>`;
    return `<div class="cb-hero-r">${head}${rows.map(([name, v]) => `<div class="cb-prog"><span>${esc(t(name))}</span><b>${num(Math.round(v))}</b><span class="cb-bar"><i style="width:${Math.round((v / max) * 100)}%"></i></span></div>`).join("")}</div>`;
  }

  const SEV = { crit: ["octagon-alert", "Urgent"], warn: ["triangle-alert", "Warning"], info: ["info", "Good to know"] };
  const REASON = { offline: "Site is offline", may_go_offline: "Site could go offline", losing_leads: "Losing leads", losing_clicks: "Losing clicks", losing_link: "Lost a backlink", data_lost: "Data being lost", data_stopped: "Data stopped", site_problem: "Site problem", chance: "Chance to win", info: "Good to know", check: "Worth a look" };
  function todoRow(item, first) {
    const [ic, word] = SEV[item.severity] || SEV.info;
    const why = [REASON[item.reason] && REASON[item.reason] !== word ? t(REASON[item.reason]) : "", item.detail || ""].filter(Boolean).join(" · ");
    const host = item.host && UI().state.site === "all" && !item.title.includes(item.host) ? ` · ${esc(item.host)}` : "";
    const main = first ? item.mainHtml.replace('class="btn btn-small"', 'class="btn btn-small cb-dark"') : item.mainHtml;
    return `<li class="cb-sev-${item.severity}" data-row="${esc(item.id)}"><span class="cb-sq" aria-hidden="true">${icon(ic)}</span>
      <span class="cb-t" dir="auto" title="${esc(item.title)}">${item.titleHtml || esc(item.title)}</span><span class="cb-go">${main}</span>
      <span class="cb-w" dir="auto"><b>${t(word)}</b>${why ? ` · ${esc(why)}` : ""}${host}</span></li>`;
  }
  function todoCard(todo) {
    const all = UI().state.attentionAll, shown = all ? todo : todo.slice(0, 5);
    const more = todo.length > 5 ? `<button class="cb-more" id="show-all">${all ? t("Show less") : `${t("All")} ${num(todo.length)}`}${icon("chevron-right")}</button>` : "";
    const body = todo.length ? `<ol class="cb-todo-list">${shown.map((x, i) => todoRow(x, i === 0)).join("")}</ol>` : `<p class="cb-empty">${t("Nothing needs you today.")}</p>`;
    return `<section class="card cb-todo" id="cb-todo"><div class="cb-ch"><h2>${t("Do these first")}</h2>${more}</div>${body}</section>`;
  }

  /* ---- row 3: visits by channel, keyword positions, pages going up ---- */
  const SWATCH = ["var(--cb-1)", "var(--cb-2)", "var(--cb-3)", "var(--cb-4)", "var(--cb-5)", "var(--cb-6)"];
  function channelsCard(w) {
    const e = ask(channelsPath(w));
    let body;
    if (e.error) body = `<p class="cb-s">${esc(e.error)}</p>`;
    else if (!e.data) body = `<p class="cb-s">${t("Loading…")}</p>`;
    else {
      const rows = merged(e.data.channels || [], "sessions"), total = rows.reduce((s, [, v]) => s + v, 0);
      const top = rows.slice(0, 5), rest = rows.slice(5).reduce((s, [, v]) => s + v, 0);
      const list = rest ? top.concat([["Other", rest]]) : top;
      body = total ? `<div class="cb-big cb-big-sm"><b>${num(total)}</b><span>${t("visits")}</span></div>
        <div class="cb-stack" aria-hidden="true">${list.map(([, v], i) => `<i style="flex:${v};background:${SWATCH[i]}"></i>`).join("")}</div>
        <ul class="cb-rows">${list.map(([name, v], i) => `<li><i style="background:${SWATCH[i]}"></i><span>${esc(t(name))}</span><b>${num(v)}</b><em>${Math.round((v / total) * 100)}%</em></li>`).join("")}</ul>`
        : `<p class="cb-s">${t("No data in this period")}</p>`;
    }
    return `<section class="card cb-card" id="cb-chan"><div class="cb-ch"><h2>${t("Visits by channel")}</h2><a class="cb-more" href="${window.TodayView.withSite("#channels")}">${t("Traffic")}${icon("chevron-right")}</a></div><div class="cb-body">${body}</div></section>`;
  }
  function positionsCard(w) {
    const e = ask(positionsPath(w));
    let body;
    if (e.error) body = `<p class="cb-s">${esc(e.error)}</p>`;
    else if (!e.data) body = `<p class="cb-s">${t("Loading…")}</p>`;
    else {
      const rows = Object.values(e.data.rows || {});
      const counts = BUCKETS.map(([label, lo, hi]) => [label, countIn(rows, "now", lo, hi), countIn(rows, "then", lo, hi)]);
      const max = Math.max(1, ...counts.flatMap(([, a, b]) => [a, b]));
      body = rows.length ? `<div class="cb-ladder">${counts.map(([label, now, then]) => `<div class="cb-rung"><span>${t(label)}</span><span class="cb-pair"><i class="now" style="width:${Math.round((now / max) * 100)}%"></i><i class="was" style="width:${Math.round((then / max) * 100)}%"></i></span><b>${num(now)}<small>${t("was")} ${num(then)}</small></b></div>`).join("")}</div>
        <div class="cb-legend cb-legend-under"><span><i></i>${t("Now")}</span><span><i class="was"></i>${esc(day(shift(w.from, -1)))}</span></div>`
        : `<p class="cb-s">${t("No keywords tracked yet.")}</p>`;
    }
    return `<section class="card cb-card" id="cb-pos"><div class="cb-ch"><h2>${t("Keyword positions")}</h2><a class="cb-more" href="#keywords">${t("Keywords")}${icon("chevron-right")}</a></div><div class="cb-body">${body}</div></section>`;
  }
  function pagesCard(up, down) {
    const row = (m) => {
      const size = m.new || m.change === null || m.change === undefined ? null : m.change;
      const page = window.PageLink ? window.PageLink.html(m.url || m.path, { text: m.path, host: m.host, cls: "cb-pg-t" }) : esc(m.path);
      return `<li><span class="cb-pg">${page}</span><span class="cb-pp">${num(m.was)} → <b>${num(m.clicks)}</b></span>${size === null ? `<span class="cb-d cb-up">${t("New")}</span>` : pill(m.clicks > m.was ? Math.abs(size) : -Math.abs(size), "%")}</li>`;
    };
    const pages = (m) => (m || []).filter((x) => x.type !== "keyword");
    const u = pages(up), d = pages(down);
    const list = (moves) => `<ul class="cb-pages">${moves.slice(0, 4).map(row).join("")}</ul>`;
    const body = `${u.length ? list(u) : `<p class="cb-s">${t("Nothing rose much this week.")}</p>`}${d.length ? `<h3 class="cb-sub">${t("Going down")}</h3>${list(d)}` : `<p class="cb-s cb-note">${t("Nothing fell this week. Longer drops are in Do these first.")}</p>`}`;
    return `<section class="card cb-card"><div class="cb-ch"><h2>${t("Pages going up")}</h2><span class="cb-meta">${t("this week")}</span><a class="cb-more" href="#pages">${t("Pages")}${icon("chevron-right")}</a></div><div class="cb-body">${body}</div></section>`;
  }

  /* ---- row 4: competitors moved ---- */
  const KIND = { new_page: "added a page", page_gone: "removed", title: "changed the title of", search_title: "changed the title of", meta: "changed the description of", h1: "changed headings on", headings: "changed headings on", content: "changed content on", canonical: "changed", schema: "changed structured data on", links: "changed links on", redirect: "changed", status: "changed", robots: "changed" };
  function rivalsCard(rivals, other) {
    const rows = rivals.slice(0, 5).map((r) => `<li>${UI().siteLogo ? UI().siteLogo(r.host, 16) : ""}<span class="cb-x" dir="auto"><b>${esc(r.host)}</b> ${esc(t(KIND[r.kind] || "changed"))} ${esc(r.path)}<em> · ${t("your page")} ${esc(r.my_path)}${r.when ? ` · ${esc(r.when)}` : ""}</em></span><button class="btn btn-small" data-today-pair="${esc(String(r.pair_id))}" data-today-site="${esc(String(r.site_id))}">${t("Compare")}</button></li>`).join("");
    const total = rivals.length + (other || 0);
    return `<section class="card cb-card cb-rivals"><div class="cb-ch"><h2>${t("Competitors moved")}</h2><span class="cb-meta">${t("last 7 days")}${total ? ` · ${num(total)} ${t("edits")}` : ""}</span><a class="cb-more" href="#competitors">${t("Competitors")}${icon("chevron-right")}</a></div>
      <div class="cb-body">${rows ? `<ul class="cb-feed">${rows}</ul>` : `<p class="cb-s">${t("No rival changes in the last 7 days.")}</p>`}${other ? `<a class="cb-more cb-more-under" href="#competitors">${num(other)} ${t("other edits")}${icon("chevron-right")}</a>` : ""}</div></section>`;
  }

  /* ---- the page ---- */
  function page(vm, parts) {
    last = { vm, parts };
    const r = vm.results, w = r.window;
    if (!hasPoints(r[picked])) picked = ["leads", "visits", "clicks"].find((k) => hasPoints(r[k])) || "leads";
    const kpis = `<div class="cb-grid cb-kpis">${kpi("leads", r.leads)}${kpi("visits", r.visits)}${kpi("clicks", r.clicks)}${w ? pageOne(w) : ""}</div>`;
    const hero = hasPoints(r[picked]) ? `<section class="card cb-hero" id="cb-hero">${heroLeft(r)}<div id="cb-hero-r">${w ? heroRight(w) : ""}</div></section>` : "";
    const row2 = `<div class="cb-grid cb-row2">${hero}${todoCard(vm.todo)}</div>`;
    const row3 = w ? `<div class="cb-grid cb-row3">${channelsCard(w)}${positionsCard(w)}${pagesCard(parts.goingUp, parts.goingDown)}</div>` : "";
    const row4 = `<div class="cb-grid cb-row4">${rivalsCard(vm.rivals, vm.otherEdits)}${parts.workHtml}</div>`;
    return `${parts.firstAct || ""}${vm.setupHtml || ""}${kpis}${parts.notes || ""}${row2}${row3}${row4}${parts.ranks}${parts.sitesHtml}`;
  }

  // An answer landed: redraw only the cards that were waiting for it.
  function fill() {
    if (!last || UI().state.route !== "today" || !on()) return;
    const w = last.vm.results.window;
    if (!w) return;
    const swap = (id, html) => { const el = document.getElementById(id); if (el) el.replaceWith(UI().fragment(html)); };
    swap("cb-p1", pageOne(w)); swap("cb-chan", channelsCard(w)); swap("cb-pos", positionsCard(w));
    const right = document.getElementById("cb-hero-r");
    if (right) right.replaceChildren(UI().fragment(heroRight(w)));
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-cb-metric]");
    if (!b || !last) return;
    picked = b.dataset.cbMetric;
    const left = document.querySelector("#cb-hero .cb-hero-l");
    if (left) left.replaceWith(UI().fragment(heroLeft(last.vm.results)));
  });
  // A source refreshed or a site added: ask again next time.
  ["seocc:sources-changed", "seocc:site-added"].forEach((name) => window.addEventListener(name, () => held.clear()));

  window.TodayOcean = { on, page };
  const words = {
    "each day": "par jour", "Keywords on page 1": "Mots-clés en page 1", "was": "avant", "tracked": "suivis", "best": "meilleur", "best day": "meilleur jour", "on": "le",
    "before": "avant", "Chart": "Graphique", "Where they came from": "D'où ils viennent", "Organic search": "Recherche naturelle", "Video": "Vidéo", "Social": "Réseaux sociaux",
    "Other sites": "Autres sites", "AI assistants": "Assistants IA", "Paid": "Payant", "Other": "Autre", "Visits by channel": "Visites par canal", "visits": "visites",
    "Keyword positions": "Positions des mots-clés", "Lower": "Plus bas", "Now": "Maintenant", "No keywords tracked yet.": "Aucun mot-clé suivi pour l'instant.",
    "Pages going up": "Pages en hausse", "this week": "cette semaine", "Competitors moved": "Mouvements des concurrents", "last 7 days": "7 derniers jours", "edits": "modifications",
    "other edits": "autres modifications", "your page": "votre page", "added a page": "a ajouté une page", "removed": "a retiré", "changed": "a modifié",
    "changed content on": "a modifié le contenu de", "changed structured data on": "a modifié les données structurées de", "changed the title of": "a modifié le titre de",
    "changed the description of": "a modifié la description de", "changed headings on": "a modifié les titres de", "changed links on": "a modifié les liens de",
    "Warning": "Attention", "All": "Tout", "Traffic": "Trafic", "Pages": "Pages", "Keywords": "Mots-clés", "Competitors": "Concurrents",
  };
  window.FR = window.FR || {};
  Object.entries(words).forEach(([k, v]) => { if (window.FR[k] === undefined) window.FR[k] = v; });
})();
