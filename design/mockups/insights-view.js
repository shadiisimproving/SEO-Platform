/* Search → Insights. What the code found in Search Console data after each new day: one sentence on why clicks moved,
   three numbers, then one card with tabs, each tab one question. Rows are ranked by clicks a month at stake.
   Everything here is worked out in plain code on the server (seo/insights/); nothing on this screen is written by AI. */
(() => {
  "use strict";
  let UI = null, t, esc, num, icon;
  const TABS = [["first", "To do first"], ["changed", "What changed"], ["decline", "Slow decline"], ["wins", "Quick wins"]];
  const STATUSES = [["open", "Still open"], ["dismissed", "Not useful"], ["gone", "Went away"], ["done", "Done"]];
  const KIND = {
    page_down: { name: "Page losing clicks", title: "{path} lost {percent}% of its clicks" },
    page_up: { name: "Page gaining clicks", title: "{path} gained {percent}% clicks" },
    dropped_out: { name: "Dropped out of Google", title: "{path} dropped out of Google" },
    odd_day: { name: "Odd day", title: "{day}: {clicks} clicks, usually {usual}" },
    decay: { name: "Slowly losing clicks", title: "{path} is slowly losing clicks" },
    almost: { name: "Almost on page 1", title: "{query}" },
    top3: { name: "Close to the top 3", title: "{query}" },
    low_ctr: { name: "Low click rate", title: "{query}" },
    no_click: { name: "Seen but never clicked", title: "{query}" },
    compete: { name: "Two pages compete", title: "{query}" },
  };
  const PARTS = {
    demand: ["More searches", "Fewer searches"], ranking: ["Ranking higher", "Ranking lower"], appeal: ["Clicked more at the same place", "Clicked less at the same place"],
    new: ["New queries", "New queries"], lost: ["Queries that went away", "Queries that went away"], hidden: ["Rare searches Google hides", "Rare searches Google hides"],
  };
  const PAGE = 15;
  const IN = { tab: "first", status: "open", cache: new Map(), limit: PAGE, opened: null };
  window.INSIGHTS = IN;

  const fr = () => UI.state.lang === "fr";
  const fill = (s, values) => Object.entries(values).reduce((out, [k, v]) => out.split(`{${k}}`).join(v), t(s));
  const pathOf = (url) => { try { return new URL(url).pathname || "/"; } catch { return url || "/"; } };
  const dec1 = (v) => (v === null || v === undefined ? "—" : UI.dec(Math.round(v * 10) / 10));
  const dayLabel = (iso, long) => (iso ? new Intl.DateTimeFormat(UI.locale(), { weekday: long ? "long" : undefined, day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00`)) : "");
  const signed = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(Math.round(v)))}`;
  const since = (iso) => { if (!iso) return ""; const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000)); return m < 2 ? t("just now") : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} ${t("d")}`; };

  // ---- asking the server ------------------------------------------------------------------------
  function query(extra = {}) {
    const parts = { group: IN.tab, status: IN.status, ...extra }, site = UI.siteIdPicked();
    if (site) parts.site_id = site;
    return Object.entries(parts).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  }
  /* What was on screen stays there while a newer answer loads, so a change never flashes "Loading…". */
  function load() {
    const key = `insights?${query()}`;
    const old = IN.cache.get(key);
    if (old && !old.stale) return old;
    const entry = { loading: !old?.data, data: old?.data };
    IN.cache.set(key, entry);
    if (!window.COMP?.server) { entry.loading = false; entry.noServer = true; return entry; }
    window.COMP.api("GET", key)
      .then((data) => { entry.loading = false; entry.data = data; entry.error = ""; })
      .catch((err) => { entry.loading = false; if (!entry.data) entry.error = err.message; else UI.toast(err.message, { kind: "crit" }); })
      .finally(redraw);
    return entry;
  }
  // Never under an open panel: it would be drawn over. A panel that is closing is waited for.
  function redraw() {
    if (UI.state.route !== "insights") return;
    if (UI.$("#panel")) { setTimeout(redraw, 400); return; }
    UI.render({ keepScroll: true });
  }
  const forget = () => IN.cache.forEach((entry) => { entry.stale = true; });

  // ---- words --------------------------------------------------------------------------------------
  function titleOf(f) {
    const e = f.evidence || {};
    const kind = KIND[f.kind] || { title: "{path}" };
    return fill(kind.title, { path: e.path || pathOf(f.page), percent: num(Math.abs(e.percent || 0)), query: f.query || "", day: dayLabel(e.day, true), clicks: num(e.clicks ?? 0), usual: num(Math.round(e.usual ?? 0)) });
  }
  /* One line under the title: the numbers that make it a finding. */
  function reasonOf(f) {
    const e = f.evidence || {};
    switch (f.kind) {
      case "page_down": case "page_up": {
        const why = { ranking: fill("Lost places: position {a} → {b}", { a: dec1(e.position_before), b: dec1(e.position) }), demand: fill("Fewer searches: {a} → {b} impressions", { a: num(e.impressions_before), b: num(e.impressions) }), appeal: t("Clicked less at the same position") }[e.why];
        const gained = { ranking: fill("Moved up: position {a} → {b}", { a: dec1(e.position_before), b: dec1(e.position) }), demand: fill("More searches: {a} → {b} impressions", { a: num(e.impressions_before), b: num(e.impressions) }), appeal: t("Clicked more at the same position") }[e.why];
        return `${num(e.clicks_before)} → ${num(e.clicks)} ${t("clicks")} · ${f.kind === "page_up" ? gained : why}`;
      }
      case "dropped_out": return `${fill("No impressions for {n} days; {c} clicks in the 4 weeks before", { n: num(e.days), c: num(e.clicks_before) })}${e.causes?.length ? ` · ${e.causes.map(cause).join(", ")}` : ""}`;
      case "odd_day": return e.low ? `${fill("Usually about {u} on a {d}", { u: num(Math.round(e.usual)), d: new Intl.DateTimeFormat(UI.locale(), { weekday: "long" }).format(new Date(`${e.day}T00:00:00`)) })}${e.in_a_row ? ` · ${t("two days in a row")}` : ""}` : t("A spike: far more than usual");
      case "decay": return fill("{p}% under its best 4 weeks: {a} → {b} clicks a week", { p: num(e.below_peak), a: dec1(e.peak), b: dec1(e.last) });
      case "almost": case "top3": return fill("Position {p} · {i} impressions · {c} clicks", { p: dec1(e.position), i: num(e.impressions), c: num(e.clicks) });
      case "low_ctr": return fill("Clicked {r}% at position {p}; usual here is {u}%", { r: UI.dec(e.click_rate ?? 0), p: dec1(e.position), u: UI.dec(e.expected_rate ?? 0) });
      case "no_click": return fill("{i} impressions at position {p}, 0 clicks", { i: num(e.impressions), p: dec1(e.position) });
      case "compete": return (e.pages || []).slice(0, 2).map((p) => `${pathOf(p.page)} ${p.share}% (${t("pos.")} ${dec1(p.position)})`).join(" · ");
      default: return "";
    }
  }
  const cause = (code) => t({ noindex: "hidden from search engines (noindex)", broken_pages: "answers with an error", server_errors: "server error", canonical_elsewhere: "points to another page", almost_no_text: "almost no text", link_broken: "a link to it is broken", link_redirect: "it redirects" }[code] || code);
  /* The number in the third column: what a reader checks first for that kind. */
  function keyNumber(f) {
    const e = f.evidence || {};
    if (["almost", "top3", "no_click", "low_ctr", "compete"].includes(f.kind)) return `${t("pos.")} ${dec1(e.position)}`;
    if (f.kind === "page_down" || f.kind === "page_up") return `${e.percent > 0 ? "+" : "−"}${num(Math.abs(e.percent || 0))}%`;
    if (f.kind === "decay") return `−${num(e.below_peak)}%`;
    if (f.kind === "odd_day") return `${num(e.clicks)} / ${num(Math.round(e.usual))}`;
    if (f.kind === "dropped_out") return t("gone");
    return "";
  }
  const kindName = (f) => t(KIND[f.kind]?.name || f.kind);

  /* The sentence on top: why clicks moved, from the change breakdown. */
  function answer(change, many) {
    const e = change.evidence, host = many ? `${change.host}: ` : "";
    if (e.steady) return `${host}${fill("Clicks are steady: {a} in the last 28 days, {b} before.", { a: num(e.now.clicks), b: num(e.before.clicks) })}`;
    const up = e.change > 0;
    const head = fill(up ? "Clicks rose {p}% ({b} → {a})." : "Clicks fell {p}% ({b} → {a}).", { p: num(Math.abs(e.percent ?? 0)), a: num(e.now.clicks), b: num(e.before.clicks) });
    const impressions = e.before.impressions ? Math.round((e.now.impressions - e.before.impressions) / e.before.impressions * 100) : null;
    const demand = impressions === null ? "" : ` ${fill(impressions >= 0 ? "Impressions rose {p}%." : "Impressions fell {p}%.", { p: num(Math.abs(impressions)) })}`;
    const main = e.main ? ` ${fill("Mostly: {what} ({n} clicks).", { what: t(PARTS[e.main][up ? 0 : 1]).toLowerCase(), n: signed(e.parts[e.main]) })}` : "";
    return `${host}${head}${demand}${main}`;
  }
  function partsRow(change) {
    const e = change.evidence, up = e.change > 0;
    const parts = Object.entries(e.parts).filter(([, v]) => Math.round(v)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    return `<div class="in-parts" role="list" aria-label="${t("What made up the change")}">${parts.map(([id, v]) => `<span class="in-part ${v < 0 ? "down" : "up"}" role="listitem"><span>${esc(t(PARTS[id][v > 0 ? 0 : 1]))}</span><b>${signed(v)}</b></span>`).join("")}
      <button class="link-btn" data-in-open="${change.id}">${t(up ? "See what gained" : "See what lost")}</button></div>`;
  }

  // ---- the page -----------------------------------------------------------------------------------
  function page() {
    const entry = load();
    const run = `<button class="btn" data-in-run>${icon("refresh-cw")}${t("Run again")}</button>`;
    const head = UI.topbar(t("Insights"), t("What the code found in your Search Console data, worked out after each new day"), entry.data ? run : "", false);
    const wrap = (body) => `${head}<div class="content page-enter in">${body}</div>`;
    if (entry.loading) return wrap(`<section class="card" aria-busy="true"><div class="empty"><p>${t("Loading…")}</p></div></section>`);
    if (entry.noServer) return wrap(`<section class="card"><div class="empty"><h3>${t("Needs the running app")}</h3><p>${t("Opened as a plain file there's no real data to show here.")}</p></div></section>`);
    if (entry.error) return wrap(`<section class="card"><div class="empty"><h3>${t("That didn't load")}</h3><p>${esc(t(entry.error))}</p><div class="ov-empty-act"><button class="btn" data-in-retry>${t("Try again")}</button></div></div></section>`);
    const d = entry.data, s = d.summary;
    if (!s.ran_at) return wrap(`<section class="card"><div class="empty"><h3>${t("Nothing worked out yet")}</h3><p>${t("Insights run by themselves after each new day of Search Console data. Run them now to see the first ones.")}</p><div class="ov-empty-act">${run}</div></div></section>`);
    const changes = s.changes || [];
    const top = changes.length ? `<div class="in-answer">${changes.slice(0, 3).map((c) => `<p class="ov-answer" dir="auto">${esc(answer(c, changes.length > 1))}</p>`).join("")}${changes.length === 1 && !changes[0].evidence.steady ? partsRow(changes[0]) : ""}</div>` : "";
    const figs = `<div class="in-figs">
      <div class="in-fig"><div class="lab">${t("Still open")}</div><div class="fig">${num(s.open)}</div></div>
      <div class="in-fig"><div class="lab">${t("Clicks a month at stake")}</div><div class="fig">${num(s.at_stake)}</div></div>
      <div class="in-fig"><div class="lab">${t("Fixed or gone in 30 days")}</div><div class="fig">${num(s.fixed)}</div></div>
    </div>`;
    const trust = `<p class="ov-trust small" role="status"><span>${icon("clock")}${t("Worked out")} ${esc(since(s.ran_at))}</span><span class="ov-dot" aria-hidden="true">·</span><span>${t("Final days only, last 28 days against the 28 before")}</span></p>`;
    return wrap(`${trust}${top}${figs}${tabsCard(d)}`);
  }

  function tabsCard(d) {
    const counts = d.counts || {};
    const tabs = `<div class="tabs" role="tablist" aria-label="${t("Insights")}">${TABS.map(([id, name]) => {
      const n = id === "first" ? null : counts[id]?.open;
      return `<button class="tab" role="tab" data-in-tab="${id}" aria-selected="${IN.tab === id}">${t(name)}${n ? ` <span class="in-count">${num(n)}</span>` : ""}</button>`;
    }).join("")}</div>`;
    const controls = `<div class="ov-controls"><label class="ov-show"><span>${t("Show")}</span><select class="select" data-in-status>${STATUSES.map(([id, name]) => `<option value="${id}" ${IN.status === id ? "selected" : ""}>${t(name)}</option>`).join("")}</select></label></div>`;
    const needs = d.summary.needs || {};
    const notes = [];
    if (IN.tab === "wins" && needs.low_ctr === "brand_words") notes.push(`${t("Low click rates need your brand words: brand searches are clicked far more and would make every other query look weak.")} <a href="#overview">${t("Add them on Overview")}</a>`);
    if ((IN.tab === "decline" && needs.decay) || (IN.tab === "changed" && needs.page_down)) notes.push(t("Needs more saved history: slow decline looks at 16 weeks, changes at 8."));
    const hint = { first: "The biggest of everything, one row per query or page.", changed: "Last 28 days against the 28 before, plus odd days this week.", decline: "Pages sliding a little every week for 16 weeks.", wins: "Queries a small push would pay for, using this site's own click rates." }[IN.tab];
    return `<section class="card ov-tabs-card"><div class="card-head ov-tabs-head">${tabs}</div>${controls}
      <p class="small muted ov-hint">${t(hint)}</p>${notes.map((n) => `<p class="small ov-hint in-need">${n}</p>`).join("")}${table(d.rows)}</section>`;
  }

  function table(rows) {
    if (!rows.length) return `<div class="empty"><p>${t(IN.status === "open" ? "Nothing here right now. That's good news." : "Nothing here.")}</p></div>`;
    const many = !UI.siteIdPicked();
    const body = rows.slice(0, IN.limit).map((f) => `<tr class="ov-row" data-in-open="${f.id}" tabindex="0">
      <td class="head-cell" data-label="${t("What")}"><div class="in-what"><span class="in-kind ${f.group}">${esc(kindName(f))}</span>${f.task ? `<span class="in-task">${icon("square-check")}${t(f.task === "done" ? "Task done" : "Task open")}</span>` : ""}${many ? `<span class="muted small">${esc(f.host)}</span>` : ""}</div>
        <div class="t" dir="auto">${esc(titleOf(f))}</div><div class="s muted small" dir="auto">${esc(reasonOf(f))}</div></td>
      <td class="c" data-label="${t("Clicks a month")}">${f.at_stake >= 1 ? num(Math.round(f.at_stake)) : "—"}</td>
      <td class="c" data-label="${t("Key number")}">${esc(keyNumber(f))}</td>
      <td class="c in-act-col"><button class="btn btn-small btn-ghost" data-in-open="${f.id}">${t("Open")}</button></td></tr>`).join("");
    return `<div class="table-wrap ov-table in-table"><table class="data"><thead><tr><th scope="col">${t("What")}</th><th class="c" scope="col">${t("Clicks a month")}</th><th class="c" scope="col">${t("Key number")}</th><th class="c" scope="col"><span class="sr">${t("Open")}</span></th></tr></thead><tbody>${body}</tbody></table></div>
      <div class="lv-foot"><span>${num(Math.min(IN.limit, rows.length))} ${t("of")} ${num(rows.length)}</span>${IN.limit < rows.length ? `<button class="link-btn" data-in-more>${t("Show more")}</button>` : ""}</div>`;
  }

  // ---- one finding, in the side panel ---------------------------------------------------------------
  function evidenceList(f) {
    const e = f.evidence || {};
    const li = (label, value) => `<li><div class="what"><div class="t">${esc(t(label))}</div></div><span>${value}</span></li>`;
    const rows = [];
    if (f.kind === "change") {
      Object.entries(e.parts).filter(([, v]) => Math.round(v)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).forEach(([id, v]) => rows.push(li(PARTS[id][v > 0 ? 0 : 1], signed(v))));
      return `<ul class="rows ov-split">${rows.join("")}</ul>${moversList(e)}`;
    }
    if (e.clicks_before !== undefined && e.clicks !== undefined) rows.push(li("Clicks", `${num(e.clicks_before)} → ${num(e.clicks)}`));
    else if (e.clicks !== undefined) rows.push(li("Clicks", num(e.clicks)));
    if (e.impressions_before !== undefined && e.impressions !== undefined) rows.push(li("Impressions", `${num(e.impressions_before)} → ${num(e.impressions)}`));
    else if (e.impressions !== undefined) rows.push(li("Impressions", num(e.impressions)));
    if (e.position_before !== undefined && e.position !== undefined) rows.push(li("Position", `${dec1(e.position_before)} → ${dec1(e.position)}`));
    else if (e.position !== undefined) rows.push(li("Position", dec1(e.position)));
    if (e.click_rate !== undefined && e.click_rate !== null) rows.push(li("Click rate", `${UI.dec(e.click_rate)}%`));
    if (e.expected_rate !== undefined) rows.push(li("Usual at this position", `${UI.dec(e.expected_rate)}%`));
    if (e.target_rate !== undefined) rows.push(li(fill("Usual at position {p}", { p: e.target }), `${UI.dec(e.target_rate)}%`));
    if (e.peak !== undefined) rows.push(li("Best 4 weeks, a week", dec1(e.peak)), li("Last 4 weeks, a week", dec1(e.last)));
    if (e.usual !== undefined) rows.push(li("Usual that weekday", num(Math.round(e.usual))));
    if (e.last_seen) rows.push(li("Last seen on Google", esc(dayLabel(e.last_seen))));
    const list = `<ul class="rows ov-split">${rows.join("")}</ul>`;
    const queries = e.queries?.length ? `<h3 class="ov-h3">${t("Queries behind it")}</h3><ul class="rows ov-split">${e.queries.map((q) => `<li><div class="what"><div class="t" dir="auto">${esc(q.query)}</div><div class="s muted">${t("pos.")} ${dec1(q.position_before)} → ${dec1(q.position)}</div></div><span>${num(q.clicks_before)} → ${num(q.clicks)}</span></li>`).join("")}</ul>` : "";
    const pages = e.pages?.length ? `<h3 class="ov-h3">${t("Pages that share it")}</h3><ul class="rows ov-split">${e.pages.map((p) => `<li><div class="what"><div class="t" dir="auto">${esc(pathOf(p.page))}</div><div class="s muted">${t("pos.")} ${dec1(p.position)} · ${num(p.clicks)} ${t("clicks")}</div></div><span>${p.share}%</span></li>`).join("")}</ul>` : "";
    const causes = e.causes?.length ? `<p class="small">${t("The last health test or Links Checker saw")}: ${e.causes.map((c) => esc(cause(c))).join(", ")}.</p>` : f.kind === "dropped_out" ? `<p class="small muted">${t("The last health test saw nothing wrong with it. Check it in Search Console's page indexing report.")}</p>` : "";
    const page = f.page && f.kind !== "dropped_out" && !["page_down", "page_up", "decay"].includes(f.kind) ? `<p class="small muted">${t("Page that ranks")}: <span dir="auto">${esc(pathOf(f.page))}</span></p>` : "";
    return `${list}${page}${queries}${pages}${causes}`;
  }
  function moversList(e) {
    const groups = Object.entries(e.movers || {}).filter(([, list]) => list.length).sort((a, b) => Math.abs(e.parts[b[0]]) - Math.abs(e.parts[a[0]]));
    return groups.slice(0, 3).map(([id, list]) => `<h3 class="ov-h3">${esc(t(PARTS[id][e.parts[id] > 0 ? 0 : 1]))}</h3><ul class="rows ov-split">${list.map((m) => `<li><div class="what"><div class="t" dir="auto">${esc(m.query)}</div><div class="s muted">${m.position_before !== null && m.position_before !== undefined ? `${t("pos.")} ${dec1(m.position_before)} → ${dec1(m.position)} · ` : ""}${num(m.impressions_before)} → ${num(m.impressions)} ${t("impressions")}</div></div><span>${signed(m.effect)}</span></li>`).join("")}</ul>`).join("");
  }
  /* How "clicks a month at stake" was worked out, in words, so it can be checked. */
  function stakeWords(f) {
    const e = f.evidence || {};
    const words = {
      page_down: "The clicks it lost against the 28 days before, as a month.",
      dropped_out: "The clicks it had in the 4 weeks before it went, as a month.",
      odd_day: "The clicks missing that day against a usual day.",
      decay: "Its best 4 weeks against its last 4, as a month.",
      almost: "Its impressions × (the click rate this site usually gets at position {p} − its click rate now), as a month.",
      top3: "Its impressions × (the click rate this site usually gets at position {p} − its click rate now), as a month.",
      low_ctr: "Its impressions × (the usual click rate at its position − its own), as a month.",
      no_click: "Its impressions × the click rate this site usually gets at its position, as a month.",
      compete: "What it would bring if the best of these pages took all its impressions, as a month.",
      change: "The clicks the site lost against the 28 days before, as a month.",
    }[f.kind];
    return words ? `<p class="small muted in-how">${icon("info")}${esc(fill(words, { p: e.target ?? "" }))}</p>` : "";
  }
  async function openFinding(id, opener) {
    IN.opened = id;
    UI.openPanel(`${UI.panelHead(t("Insight"), "")}<div class="panel-body"><p class="muted">${t("Loading…")}</p></div>`, opener);
    let f;
    try { f = await window.COMP.api("GET", `insights/${id}`); }
    catch (err) { if (UI.$("#panel")) UI.setHTML(UI.$("#panel .panel-body"), `<p class="error">${esc(err.message)}</p>`); return; }
    if (!UI.$("#panel") || IN.opened !== id) return;
    const title = f.kind === "change" ? t("What made up the change") : titleOf(f);
    const sub = f.kind === "change" ? esc(answer(f, false)) : `${esc(kindName(f))}${!UI.siteIdPicked() ? ` · ${esc(f.host)}` : ""}`;
    const clicks = f.series.map((p) => p.clicks), positions = f.series.map((p) => p.position).filter((x) => x !== null);
    const chart = clicks.length > 1 ? `<h3 class="ov-h3">${t("Clicks, day by day")} <span class="muted small">${t("last 16 weeks")}</span></h3><div class="in-spark">${UI.spark(clicks, { w: 300, h: 56, area: true })}</div>
      ${positions.length > 1 && f.kind !== "odd_day" && f.kind !== "change" ? `<h3 class="ov-h3">${t("Position, day by day (higher is better)")}</h3><div class="in-spark">${UI.spark(positions, { w: 300, h: 44, invert: true })}</div>` : ""}` : "";
    const stake = f.at_stake >= 1 ? `<p class="in-stake"><b>${num(Math.round(f.at_stake))}</b> ${t("clicks a month at stake")}</p>` : "";
    const canTrack = f.query && !f.evidence?.tracked;
    const actions = f.kind === "change" ? "" : `<div class="panel-actions in-actions">
      ${f.task ? `<span class="in-task">${icon("square-check")}${t(f.task === "done" ? "Task done" : "Task open")}</span>` : `<button class="btn btn-main" data-in-task="${f.id}">${icon("square-check")}${t("Create a task")}</button>`}
      ${canTrack ? `<button class="btn" data-in-track="${esc(f.query)}">${icon("plus")}${t("Track as a keyword")}</button>` : ""}
      ${f.status === "dismissed" ? `<button class="btn btn-ghost" data-in-undismiss="${f.id}">${t("Bring it back")}</button>` : f.status === "open" ? `<button class="btn btn-ghost" data-in-dismiss="${f.id}">${t("Not useful")}</button>` : ""}
    </div>`;
    const where = f.page ? `<p class="small"><a href="${esc(f.page)}" target="_blank" rel="noopener" dir="auto">${esc(pathOf(f.page))}</a></p>` : "";
    UI.openPanel(`${UI.panelHead(title, sub)}<div class="panel-body">${stake}${where}${f.kind !== "change" ? `<p class="small" dir="auto">${esc(reasonOf(f))}</p>` : ""}${chart}${evidenceList(f)}${stakeWords(f)}
      ${f.status === "dismissed" ? `<p class="small muted">${t("Hidden as not useful. It comes back by itself if it gets twice as big.")}</p>` : ""}${actions}</div>`, opener);
    IN.current = f;
  }

  // ---- events ---------------------------------------------------------------------------------------
  function taskFor(f, opener) {
    const e = f.evidence || {};
    UI.openTask?.({
      title: titleOf(f), host: f.host, opener, priority: f.severity === "big" ? "high" : "medium",
      keywords: f.query ? [f.query] : [], pages: f.page ? [f.page] : [],
      source: { type: "search", key: f.key, label: `${t("Search insights")}: ${kindName(f)}`, facts: [reasonOf(f), f.at_stake >= 1 ? `${num(Math.round(f.at_stake))} ${t("clicks a month at stake")}` : ""].filter(Boolean), link: `#insights/${f.id}`, host: f.host },
      description: e.path ? `${f.page}` : "",
    });
  }
  function bind() {
    document.addEventListener("click", async (e) => {
      if (UI.state.route !== "insights" && !UI.$("#panel")) return;
      const hit = (sel) => e.target.closest?.(sel);
      let el;
      if ((el = hit("[data-in-tab]"))) { IN.tab = el.dataset.inTab; IN.limit = PAGE; UI.render({ keepScroll: true }); UI.$(`[data-in-tab="${IN.tab}"]`)?.focus({ preventScroll: true }); return; }
      if (hit("[data-in-more]")) { IN.limit += 25; UI.render({ keepScroll: true }); return; }
      if (hit("[data-in-retry]")) { forget(); UI.render(); return; }
      if ((el = hit("[data-in-run]"))) {
        el.disabled = true;
        try { await window.COMP.api("POST", "insights/run", { site_id: UI.siteIdPicked() || null }); forget(); UI.render({ keepScroll: true }); UI.toast(t("Insights worked out again.")); }
        catch (err) { UI.toast(err.message, { kind: "crit" }); el.disabled = false; }
        return;
      }
      if ((el = hit("[data-in-task]"))) { if (IN.current) taskFor(IN.current, el); return; }
      if ((el = hit("[data-in-track]"))) {
        if (!window.KW) { UI.toast(t("Open Keywords to add it."), { kind: "info" }); return; }
        window.KW.track([el.dataset.inTrack], IN.current?.host || UI.siteHostPicked(), el, {});
        return;
      }
      if ((el = hit("[data-in-dismiss], [data-in-undismiss]"))) {
        const undo = el.matches("[data-in-undismiss]"), id = Number(el.dataset.inDismiss || el.dataset.inUndismiss);
        try {
          await window.COMP.api("POST", `insights/${id}/dismiss`, { undo });
          forget();
          IN.cache.forEach((entry) => { if (entry.data?.rows) entry.data.rows = entry.data.rows.filter((r) => r.id !== id); }); // gone at once; the server's list follows
          UI.closePanel(); UI.render({ keepScroll: true });
          UI.toast(t(undo ? "Brought back" : "Hidden. It comes back if it gets twice as big."), undo ? {} : { undo: async () => { await window.COMP.api("POST", `insights/${id}/dismiss`, { undo: true }); forget(); UI.render({ keepScroll: true }); } });
        } catch (err) { UI.toast(err.message, { kind: "crit" }); }
        return;
      }
      if ((el = hit("[data-in-open]"))) { if (el.tagName !== "BUTTON" && hit("button, a, input")) return; openFinding(Number(el.dataset.inOpen), el); }
    });
    document.addEventListener("keydown", (e) => {
      if (UI.state.route !== "insights" || (e.key !== "Enter" && e.key !== " ")) return;
      const row = e.target.closest?.("tr[data-in-open]");
      if (row && e.target === row) { e.preventDefault(); openFinding(Number(row.dataset.inOpen), row); }
    });
    document.addEventListener("change", (e) => {
      if (e.target.matches?.("[data-in-status]")) { IN.status = e.target.value; IN.limit = PAGE; UI.render({ keepScroll: true }); UI.$("[data-in-status]")?.focus({ preventScroll: true }); }
    });
    // A task made here, or a finding opened from Today (#insights/12), lands on the finding.
    const fromAddress = () => { const m = location.hash.match(/^#insights\/(\d+)/); if (m && UI.state.route === "insights") setTimeout(() => openFinding(Number(m[1]), null), 50); };
    addEventListener("hashchange", fromAddress);
    setTimeout(fromAddress, 300);
    addEventListener("seocc:task-saved", () => forget());
  }

  window.SCREENS = window.SCREENS || {};
  window.SCREENS.insights = { init(helpers) { UI = helpers; ({ t, esc, num, icon } = helpers); bind(); }, page };

  const words = {
    "Insights": "Analyses", "What the code found in your Search Console data, worked out after each new day": "Ce que le code a trouvé dans vos données de la Search Console, recalculé après chaque nouveau jour",
    "To do first": "À faire d'abord", "What changed": "Ce qui a changé", "Slow decline": "Lent déclin", "Quick wins": "Gains rapides",
    "Still open": "En cours", "Went away": "Disparues", "Done": "Fait",
    "Page losing clicks": "Page qui perd des clics", "Page gaining clicks": "Page qui gagne des clics", "Dropped out of Google": "Sortie de Google", "Odd day": "Jour inhabituel",
    "Slowly losing clicks": "Perd lentement des clics", "Close to the top 3": "Proche du top 3", "Seen but never clicked": "Vue mais jamais cliquée",
    "{path} lost {percent}% of its clicks": "{path} a perdu {percent} % de ses clics", "{path} gained {percent}% clicks": "{path} a gagné {percent} % de clics", "{path} dropped out of Google": "{path} est sortie de Google",
    "{day}: {clicks} clicks, usually {usual}": "{day} : {clicks} clics, d'habitude {usual}", "{path} is slowly losing clicks": "{path} perd lentement des clics",
    "More searches": "Plus de recherches", "Fewer searches": "Moins de recherches", "Ranking higher": "Mieux classé", "Ranking lower": "Moins bien classé",
    "Clicked more at the same place": "Plus cliqué à la même place", "Clicked less at the same place": "Moins cliqué à la même place", "New queries": "Nouvelles requêtes",
    "Queries that went away": "Requêtes disparues", "Rare searches Google hides": "Recherches rares que Google masque",
    "Lost places: position {a} → {b}": "Places perdues : position {a} → {b}", "Fewer searches: {a} → {b} impressions": "Moins de recherches : {a} → {b} impressions",
    "Clicked less at the same position": "Moins cliqué à la même position", "Moved up: position {a} → {b}": "Monte : position {a} → {b}", "More searches: {a} → {b} impressions": "Plus de recherches : {a} → {b} impressions",
    "Clicked more at the same position": "Plus cliqué à la même position",
    "No impressions for {n} days; {c} clicks in the 4 weeks before": "Aucune impression depuis {n} jours ; {c} clics les 4 semaines d'avant",
    "Usually about {u} on a {d}": "D'habitude environ {u} un {d}", "two days in a row": "deux jours de suite", "A spike: far more than usual": "Un pic : bien plus que d'habitude",
    "{p}% under its best 4 weeks: {a} → {b} clicks a week": "{p} % sous ses 4 meilleures semaines : {a} → {b} clics par semaine",
    "Position {p} · {i} impressions · {c} clicks": "Position {p} · {i} impressions · {c} clics", "Clicked {r}% at position {p}; usual here is {u}%": "Cliquée à {r} % en position {p} ; l'habitude ici est {u} %",
    "{i} impressions at position {p}, 0 clicks": "{i} impressions en position {p}, 0 clic",
    "hidden from search engines (noindex)": "masquée aux moteurs (noindex)", "answers with an error": "répond par une erreur", "server error": "erreur du serveur", "points to another page": "renvoie vers une autre page",
    "almost no text": "presque pas de texte", "a link to it is broken": "un lien vers elle est cassé", "it redirects": "elle redirige", "gone": "disparue",
    "Clicks are steady: {a} in the last 28 days, {b} before.": "Les clics sont stables : {a} sur les 28 derniers jours, {b} avant.",
    "Clicks rose {p}% ({b} → {a}).": "Les clics sont en hausse de {p} % ({b} → {a}).", "Clicks fell {p}% ({b} → {a}).": "Les clics sont en baisse de {p} % ({b} → {a}).",
    "Impressions rose {p}%.": "Les impressions sont en hausse de {p} %.", "Impressions fell {p}%.": "Les impressions sont en baisse de {p} %.", "Mostly: {what} ({n} clicks).": "Surtout : {what} ({n} clics).",
    "What made up the change": "Ce qui compose le changement", "See what gained": "Voir ce qui a gagné", "See what lost": "Voir ce qui a perdu",
    "Run again": "Relancer", "Nothing worked out yet": "Rien de calculé pour l'instant",
    "Insights run by themselves after each new day of Search Console data. Run them now to see the first ones.": "Les analyses se lancent seules après chaque nouveau jour de données de la Search Console. Lancez-les maintenant pour voir les premières.",
    "Clicks a month at stake": "Clics par mois en jeu", "Fixed or gone in 30 days": "Réglés ou disparus en 30 jours", "Worked out": "Calculé", "Final days only, last 28 days against the 28 before": "Jours définitifs seulement, 28 derniers jours contre les 28 d'avant",
    "Low click rates need your brand words: brand searches are clicked far more and would make every other query look weak.": "Les taux de clic faibles demandent vos mots de marque : les recherches de marque sont bien plus cliquées et feraient paraître faibles toutes les autres requêtes.",
    "Add them on Overview": "Ajoutez-les dans Vue d'ensemble", "Needs more saved history: slow decline looks at 16 weeks, changes at 8.": "Il faut plus d'historique : le lent déclin regarde 16 semaines, les changements 8.",
    "The biggest of everything, one row per query or page.": "Le plus important de tout, une ligne par requête ou page.", "Last 28 days against the 28 before, plus odd days this week.": "28 derniers jours contre les 28 d'avant, plus les jours inhabituels de la semaine.",
    "Pages sliding a little every week for 16 weeks.": "Pages qui reculent un peu chaque semaine depuis 16 semaines.", "Queries a small push would pay for, using this site's own click rates.": "Requêtes pour lesquelles un petit effort paierait, d'après les taux de clic du site.",
    "Nothing here right now. That's good news.": "Rien ici pour l'instant. C'est une bonne nouvelle.", "Nothing here.": "Rien ici.",
    "What": "Quoi", "Clicks a month": "Clics par mois", "Key number": "Chiffre clé", "Task done": "Tâche faite", "Task open": "Tâche ouverte",
    "Insight": "Analyse", "Queries behind it": "Requêtes derrière", "Usual at position {p}": "Habituel en position {p}", "Best 4 weeks, a week": "4 meilleures semaines, par semaine", "Last 4 weeks, a week": "4 dernières semaines, par semaine",
    "Usual that weekday": "Habituel ce jour de la semaine", "Last seen on Google": "Vue pour la dernière fois sur Google", "The last health test or Links Checker saw": "Le dernier test de santé ou le Links Checker a vu",
    "The last health test saw nothing wrong with it. Check it in Search Console's page indexing report.": "Le dernier test de santé n'y a rien vu d'anormal. Vérifiez-la dans le rapport d'indexation des pages de la Search Console.",
    "Page that ranks": "Page qui se classe", "last 16 weeks": "16 dernières semaines", "clicks a month at stake": "clics par mois en jeu", "Not useful": "Pas utile", "Bring it back": "La remettre",
    "Hidden as not useful. It comes back by itself if it gets twice as big.": "Masquée comme pas utile. Elle revient seule si elle double.",
    "The clicks it lost against the 28 days before, as a month.": "Les clics perdus par rapport aux 28 jours d'avant, ramenés au mois.",
    "The clicks it had in the 4 weeks before it went, as a month.": "Les clics qu'elle avait les 4 semaines avant de disparaître, ramenés au mois.",
    "The clicks missing that day against a usual day.": "Les clics manquants ce jour-là par rapport à un jour habituel.", "Its best 4 weeks against its last 4, as a month.": "Ses 4 meilleures semaines contre ses 4 dernières, ramenées au mois.",
    "Its impressions × (the click rate this site usually gets at position {p} − its click rate now), as a month.": "Ses impressions × (le taux de clic habituel du site en position {p} − son taux actuel), ramenées au mois.",
    "Its impressions × (the usual click rate at its position − its own), as a month.": "Ses impressions × (le taux de clic habituel à sa position − le sien), ramenées au mois.",
    "Its impressions × the click rate this site usually gets at its position, as a month.": "Ses impressions × le taux de clic habituel du site à sa position, ramenées au mois.",
    "What it would bring if the best of these pages took all its impressions, as a month.": "Ce qu'elle apporterait si la meilleure de ces pages prenait toutes ses impressions, ramené au mois.",
    "The clicks the site lost against the 28 days before, as a month.": "Les clics perdus par le site par rapport aux 28 jours d'avant, ramenés au mois.",
    "Search insights": "Analyses de recherche", "Insights worked out again.": "Analyses recalculées.", "Brought back": "Remise", "Hidden. It comes back if it gets twice as big.": "Masquée. Elle revient si elle double.",
    "Click rate": "Taux de clic", "Position": "Position", "d": "j",
  };
  Object.keys(words).forEach((w) => { if (window.FR[w] === undefined) window.FR[w] = words[w]; });
})();
