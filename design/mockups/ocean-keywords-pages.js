/* The new design (Cobalt, owner 2026-11-26) for the Keywords and Pages areas: Keywords (Positions), Pages, Content, Site map,
   Site health (Health test, Links checker, Uptime). Only acts when document.documentElement.dataset.brand === "ocean";
   with the old design every function here returns "" and every wrapper hands back the screen's own drawing untouched.

   What it draws is the answer first, in the spirit of Today (today-ocean.js, look-ocean.css's cb-* parts): a row of
   number cards, then one or two visual cards (a now-vs-before ladder, biggest moves, a split bar, bars per problem), then
   the screen's own table, restyled compact in look-ocean-keywords-pages.css. Every button, filter, link and table of
   the screens stays where it was; nothing here changes data. It reuses answers the screens already ask for, and asks
   one more only for the Keywords ladder (Search Console's positions now and four weeks before, the same call as Today).

   Called from the screens' own files (keywords-real.js, pages-view.js, site-map.js, health.js, uptime.js), each call
   gated there too; Content (screens-live.js) and the Links checker (mockup.js) are decorated from here. */
(() => {
  "use strict";
  const on = () => document.documentElement.dataset.brand === "ocean";
  const UI = () => window.UI;
  const t = (w) => UI().t(w);
  const esc = (s) => UI().esc(s);
  const num = (n) => UI().num(n);
  const dec = (n) => (UI().dec ? UI().dec(n) : String(n));
  const icon = (name, cls) => UI().icon(name, cls);
  const fr = () => UI().state.lang === "fr";
  const pctOf = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
  const pct = (v) => `${num(Math.abs(v))}${fr() ? " %" : "%"}`;
  const day = (iso) => new Intl.DateTimeFormat(UI().locale(), { day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00`));
  const shift = (iso, by) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + by); return d.toISOString().slice(0, 10); };
  const known = (v) => v !== null && v !== undefined;

  /* ---- small shared parts ---- */
  // A change pill: green up, red down, always with its arrow. unit "%" prints a percentage, "pos" a position (one decimal).
  function pill(value, unit = "") {
    if (!known(value)) return "";
    if (value === 0) return `<span class="cb-d cb-flat">±0</span>`;
    const up = value > 0, size = Math.abs(value);
    const shown = unit === "%" ? pct(value) : unit === "pos" ? dec(Math.round(size * 10) / 10) : num(size);
    return `<span class="cb-d ${up ? "cb-up" : "cb-down"}"><span class="sr">${t(up ? "Up" : "Down")} </span>${icon(up ? "arrow-up" : "arrow-down")}${shown}</span>`;
  }
  const share = (now, was = null) => `<span class="cb-share" aria-hidden="true"><i class="now" style="width:${Math.min(100, now)}%"></i>${was === null ? "" : `<i class="was" style="width:${Math.min(100, was)}%"></i>`}</span>`;
  // A number card. tag "button" with attrs turns it into one click (Pages' filters); value "—" for a blank, never 0.
  function kpi({ label, value, change = "", sub = "", extra = "", id = "", tag = "div", attrs = "", cls = "" }) {
    const type = tag === "button" ? ' type="button"' : "";
    return `<${tag}${type} class="card cb-kpi okp-kpi ${cls}"${id ? ` id="${id}"` : ""} ${attrs}><span class="cb-l">${label}</span><span class="cb-v"><b>${value}</b>${change}</span>${sub ? `<span class="cb-s">${sub}</span>` : ""}${extra}</${tag}>`;
  }
  const card = (id, title, body, more = "", meta = "") => `<section class="card cb-card okp-card"${id ? ` id="${id}"` : ""}><div class="cb-ch"><h2>${title}</h2>${meta ? `<span class="cb-meta">${meta}</span>` : ""}${more}</div><div class="cb-body">${body}</div></section>`;
  const SWATCH = ["var(--cb-1)", "var(--cb-2)", "var(--cb-3)", "var(--cb-4)", "var(--cb-5)", "var(--cb-6)"];
  // A split bar with its rows: [[label html, value]], the biggest first, the rest folded into "Other".
  function split(list, total, { unit = "", max = 5 } = {}) {
    const top = list.slice(0, max), rest = list.slice(max).reduce((s, [, v]) => s + v, 0);
    const rows = rest ? top.concat([[esc(t("Other")), rest]]) : top;
    return `<div class="cb-stack" aria-hidden="true">${rows.map(([, v], i) => `<i style="flex:${v};background:${SWATCH[i % SWATCH.length]}"></i>`).join("")}</div>
      <ul class="cb-rows">${rows.map(([name, v], i) => `<li><i style="background:${SWATCH[i % SWATCH.length]}"></i><span>${name}</span><b>${num(v)}${unit}</b><em>${pctOf(v, total)}%</em></li>`).join("")}</ul>`;
  }
  // Bars with the value at the end: [[label html, value, before|null, cls]]. Before draws as the pale hatched bar under it.
  function bars(list, { tip = null } = {}) {
    const max = Math.max(1, ...list.flatMap(([, v, b]) => [v || 0, b || 0]));
    return list.map(([name, v, before, cls = ""]) => `<div class="cb-prog okp-prog ${cls}"${tip ? ` title="${esc(tip(v, before))}"` : ""}><span>${name}</span><b>${known(v) ? num(v) : "—"}</b><span class="cb-bar"><i style="width:${pctOf(v || 0, max)}%"></i></span>${known(before) ? `<span class="cb-bar okp-was"><i style="width:${pctOf(before, max)}%"></i></span>` : ""}</div>`).join("");
  }
  const legend = (nowWord, wasWord) => `<div class="cb-legend cb-legend-under"><span><i></i>${esc(nowWord)}</span><span><i class="was"></i>${esc(wasWord)}</span></div>`;

  /* ================= Keywords ================= */
  const held = new Map(); // Search Console positions, per address, asked once
  function ask(path, redraw) {
    if (held.has(path)) return held.get(path);
    const entry = { data: undefined, error: null };
    held.set(path, entry);
    window.COMP.api("GET", path).then((d) => { entry.data = d; redraw(); }).catch((e) => { entry.error = e.message; redraw(); });
    return entry;
  }
  ["seocc:sources-changed", "seocc:site-added", "keywords:changed"].forEach((name) => window.addEventListener(name, () => held.clear()));
  document.addEventListener("keywords:changed", () => held.clear());

  const RUNGS_GSC = [["Top 3", 0, 3.5], ["4 – 10", 3.5, 10.5], ["11 – 20", 10.5, 20.5], ["Lower", 20.5, Infinity]];
  const RUNGS_OURS = [["Top 3", 0, 3], ["4 – 10", 3, 10], ["11 – 20", 10, 20], ["Lower or not found", 20, Infinity]];
  let kwLast = null;

  /* Where the positions come from: Search Console on the Google tab when the ranking chosen is Search Console (the same
     rule as the Up / Down chips), our own checks otherwise. Each answer: [{ row, now, was }] with now/was a position,
     Infinity for "checked, not found", null for no reading. */
  function readings(c) {
    if (c.gsc) {
      const through = String(c.through || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) return { state: "none" };
      const site = UI().siteIdPicked?.();
      const path = `rankings/positions?${site ? `site_id=${site}&` : ""}then=${shift(through, -28)}&to=${through}`;
      const e = ask(path, () => kwFill());
      if (e.error) return { state: "error", error: e.error };
      if (!e.data) return { state: "loading" };
      const rows = e.data.rows || {};
      const list = c.all.map((row) => { const r = rows[`${row.site_id}:${row.keyword_id}`]; return { row, now: r ? r.now ?? null : null, was: r ? r.then ?? null : null }; });
      const span = Object.values(e.data.through || {})[0];
      return { state: "ok", list, nowWord: t("Week to {day}").replace("{day}", day(span?.now || through)), wasWord: t("Week to {day}").replace("{day}", day(span?.then || shift(through, -28))), source: "Search Console" };
    }
    const list = c.all.map((row) => {
      const v = row.engines[c.e] || {}, m = v.main;
      const now = m?.status === "ok" ? (m.p || Infinity) : null;
      const was = known(v.was) ? v.was : v.move === "new" || v.move === "out" ? Infinity : null;
      return { row, now, was: v.move ? was : null };
    });
    return { state: "ok", list, nowWord: t("Last check"), wasWord: t("Check before"), source: "ours" };
  }

  function ladderCard(c, r) {
    const more = `<span class="cb-meta okp-src">${r.source === "Search Console" ? c.brand("Search Console") : esc(t("Our checks"))}</span>`;
    let body;
    if (r.state === "loading") body = `<p class="cb-s">${t("Loading…")}</p>`;
    else if (r.state === "error") body = `<p class="cb-s">${esc(r.error)}</p>`;
    else if (r.state === "none") body = `<p class="cb-s">${t("No Search Console data yet.")}</p>`;
    else {
      const rungs = r.source === "ours" ? RUNGS_OURS : RUNGS_GSC;
      const count = (field, lo, hi) => r.list.filter((x) => known(x[field]) && x[field] > lo && x[field] <= hi).length;
      const counts = rungs.map(([label, lo, hi]) => [label, count("now", lo, hi), count("was", lo, hi)]);
      const max = Math.max(1, ...counts.flatMap(([, a, b]) => [a, b]));
      const compared = r.list.filter((x) => known(x.was)).length;
      body = !counts.some(([, a, b]) => a || b) ? `<p class="cb-s">${t("No positions yet. Press Refresh to check them.")}</p>`
        : `<div class="cb-ladder">${counts.map(([label, now, then]) => `<div class="cb-rung" role="img" aria-label="${esc(`${t(label)}: ${num(now)}, ${t("was")} ${compared ? num(then) : "—"}`)}"><span>${t(label)}</span><span class="cb-pair"><i class="now" style="width:${pctOf(now, max)}%"></i>${compared ? `<i class="was" style="width:${pctOf(then, max)}%"></i>` : ""}</span><b>${num(now)}<small>${compared ? `${t("was")} ${num(then)}` : "—"}</small></b></div>`).join("")}</div>
        ${legend(r.nowWord, r.wasWord)}`;
    }
    return card("okp-ladder", t("Keyword positions"), body, more);
  }

  function movesCard(c, r) {
    let body;
    if (r.state === "loading") body = `<p class="cb-s">${t("Loading…")}</p>`;
    else if (r.state !== "ok") body = `<p class="cb-s">${r.error ? esc(r.error) : t("No Search Console data yet.")}</p>`;
    else {
      const place = (p) => (p === Infinity ? `&gt;${num(10)}` : r.source === "ours" ? num(p) : dec(Math.round(p * 10) / 10));
      const moved = r.list.filter((x) => known(x.now) && known(x.was) && !(x.now === Infinity && x.was === Infinity))
        .map((x) => ({ ...x, by: (x.was === Infinity ? 101 : x.was) - (x.now === Infinity ? 101 : x.now) }))
        .filter((x) => Math.abs(x.by) >= (r.source === "ours" ? 1 : 0.5));
      const ups = moved.filter((x) => x.by > 0).sort((a, b) => b.by - a.by).slice(0, 4);
      const downs = moved.filter((x) => x.by < 0).sort((a, b) => a.by - b.by).slice(0, 3);
      const row = (x) => {
        const p = x.now === Infinity || x.was === Infinity ? `<span class="cb-d ${x.by > 0 ? "cb-up" : "cb-down"}">${icon(x.by > 0 ? "arrow-up" : "arrow-down")}${t(x.by > 0 ? "New" : "Lost")}</span>` : pill(x.by, r.source === "ours" ? "" : "pos");
        const host = UI().state.site === "all" ? `<span class="okp-host" dir="auto">${esc(x.row.site)}</span>` : "";
        return `<li><span class="cb-pg"><button type="button" class="kw okp-kw" data-kwr-open="${esc(x.row.id)}" dir="auto">${esc(x.row.keyword)}</button>${host}</span><span class="cb-pp">${place(x.was)} → <b>${place(x.now)}</b></span>${p}</li>`;
      };
      const list = (xs) => `<ul class="cb-pages okp-moves">${xs.map(row).join("")}</ul>`;
      body = !ups.length && !downs.length ? `<p class="cb-s">${t("No keyword moved since the period before.")}</p>`
        : `${ups.length ? list(ups) : `<p class="cb-s">${t("Nothing went up.")}</p>`}${downs.length ? `<h3 class="cb-sub">${t("Going down")}</h3>${list(downs)}` : ""}`;
    }
    return card("okp-moves", t("Biggest moves"), body);
  }

  /* The Keywords screen's top, in place of its four tiles: four number cards, then the ladder and the biggest moves.
     c = { all, e, engine, good, moved, gsc, through, engineName, brand } from keywords-real.js. */
  function keywords(c) {
    if (!on()) return "";
    kwLast = c;
    const n = c.all.length, ranked = c.all.filter((r) => c.good(r)).length, top10 = c.all.filter((r) => c.good(r) && c.good(r) <= 10).length, cited = c.all.filter((r) => r.ai?.state === "cited").length;
    const google = c.engine === "google" || c.engine === "all";
    const kpis = `<section class="cb-grid cb-kpis okp-kpis" id="kw-tiles">
      ${kpi({ id: "kw-tracked", label: t("Tracked"), value: num(n), sub: UI().siteHostPicked?.() ? `${t("keywords on")} ${esc(UI().siteHostPicked())}` : `${t("keywords on")} ${num(new Set(c.all.map((r) => r.site)).size)} ${t("sites")}` })}
      ${kpi({ id: "kw-ranked", label: t("Ranked"), value: num(ranked), sub: `${t("of")} ${num(n)} · ${c.brand(c.engineName)}`, extra: share(pctOf(ranked, n)) })}
      ${kpi({ id: "kw-top10", label: `${t("Top 10")} <span class="okp-l-sub">· ${t(c.engine === "all" ? "Google only" : "our checks")}</span>`, value: num(top10), change: c.moved.compared && c.moved.change ? pill(c.moved.change) : "", sub: c.moved.compared ? `${num(c.moved.compared)} ${t("compared")}` : `${t("of")} ${num(n)}`, extra: share(pctOf(top10, n)) })}
      ${google ? kpi({ id: "kw-cited", label: `${t("Cited by AI")}${c.engine === "all" ? ` <span class="okp-l-sub">· ${t("Google only")}</span>` : ""}`, value: num(cited), sub: `${t("of")} ${num(n)}`, extra: share(pctOf(cited, n)) }) : ""}
    </section>`;
    const r = readings(c);
    return `${kpis}<div class="cb-grid okp-row2" id="okp-kw-row">${ladderCard(c, r)}${movesCard(c, r)}</div>`;
  }
  function kwFill() {
    if (!kwLast || !on() || UI().state.route !== "keywords") return;
    const box = document.getElementById("okp-kw-row");
    if (!box) return;
    const r = readings(kwLast);
    box.replaceChildren(UI().fragment(`${ladderCard(kwLast, r)}${movesCard(kwLast, r)}`));
  }

  /* ================= Pages ================= */
  const thumb = (url, image) => (window.PageThumb ? window.PageThumb.html(url, { image: image || null, size: 32 }) : "");
  const pageLine = (r) => `<span class="cb-pg okp-pg">${thumb(r.url, r.image)}<span class="okp-pg-t">${window.PageLink ? window.PageLink.html(r.url, { text: r.title || r.path, cls: "okp-pg-link" }) : esc(r.title || r.path)}<span class="okp-path" dir="auto">${esc(UI().siteIdPicked?.() ? r.path : `${r.host}${r.path}`)}</span></span></span>`;
  /* d = the /api/site-pages answer, counts = the filters' counts, filter = the one on. */
  function pages(d, counts, filter) {
    if (!on() || !d?.pages?.length) return "";
    const rows = d.pages, compare = Boolean(d.compared);
    const clicks = rows.reduce((s, r) => s + (r.clicks || 0), 0);
    const before = compare ? rows.reduce((s, r) => s + (known(r.clicks_before) ? r.clicks_before : 0), 0) : null;
    const change = compare && before ? Math.round(((clicks - before) / before) * 100) : null;
    const go = (id) => `data-pg-filter="${id}" aria-pressed="${filter === id}"`;
    const kpis = `<div class="cb-grid cb-kpis okp-kpis okp-pg-kpis">
      ${kpi({ tag: "button", attrs: go(""), label: t("Pages"), value: num(counts[""]), sub: `<b>${num(counts.clicks)}</b> ${t("get clicks")}`, extra: share(pctOf(counts.clicks, counts[""])) })}
      ${kpi({ label: t("Google clicks"), value: num(clicks), change: pill(change, "%"), sub: compare && before !== null ? `${t("was")} <b>${num(before)}</b>` : t("No earlier period") })}
      ${compare ? kpi({ tag: "button", attrs: go("losing"), cls: counts.losing ? "okp-warn" : "", label: t("Losing clicks"), value: num(counts.losing), sub: `${t("of")} ${num(counts.clicks)} ${t("with clicks")}` }) : kpi({ tag: "button", attrs: go("noclicks"), label: t("No clicks"), value: num(counts.noclicks), sub: `${t("of")} ${num(counts[""])}` })}
      ${kpi({ tag: "button", attrs: go("noindex"), cls: counts.noindex ? "okp-warn" : "", label: t("Not indexed"), value: num(counts.noindex), sub: `${num(counts.tasks)} ${t(counts.tasks === 1 ? "open task" : "open tasks")} · ${num(counts.links)} ${t("with backlinks")}` })}
    </div>`;
    const top = [...rows].filter((r) => r.clicks).sort((a, b) => b.clicks - a.clicks).slice(0, 6);
    const topCard = card("", t("Where the clicks go"), top.length ? `${bars(top.map((r) => [pageLine(r), r.clicks, compare ? r.clicks_before ?? null : null]), { tip: (v, b) => (known(b) ? `${num(b)} → ${num(v)}` : num(v)) })}${compare ? legend(t("This period"), t("Period before")) : ""}` : `<p class="cb-s">${t("No clicks in this period.")}</p>`, "", t("Google clicks"));
    const moving = rows.filter((r) => known(r.change) && r.change !== 0);
    const row = (r) => `<li>${pageLine(r)}<span class="cb-pp">${num(r.clicks_before)} → <b>${num(r.clicks || 0)}</b></span>${pill(r.change)}</li>`;
    const ups = moving.filter((r) => r.change > 0).sort((a, b) => b.change - a.change).slice(0, 5);
    const downs = moving.filter((r) => r.change < 0).sort((a, b) => a.change - b.change).slice(0, 5);
    const upCard = card("", t("Gaining clicks"), ups.length ? `<ul class="cb-pages">${ups.map(row).join("")}</ul>` : `<p class="cb-s">${t(compare ? "No page gained clicks." : "No comparison period")}</p>`);
    const downCard = card("", t("Losing clicks"), downs.length ? `<ul class="cb-pages">${downs.map(row).join("")}</ul>` : `<p class="cb-s">${t(compare ? "No page lost clicks." : "No comparison period")}</p>`, compare && counts.losing > 5 ? `<button type="button" class="cb-more" data-pg-filter="losing">${t("All")} ${num(counts.losing)}${icon("chevron-right")}</button>` : "");
    return `${kpis}<div class="cb-grid cb-row3 okp-row3">${topCard}${upCard}${downCard}</div>`;
  }

  /* ================= Content (drawn by screens-live.js: decorated here) ================= */
  function contentTop(d) {
    const rows = (d.pages || []).filter((r) => !r.unknown);
    if (!rows.length) return "";
    const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
    const has = (k) => rows.some((r) => known(r[k]));
    const leadsWord = window.GA4W?.word?.("Leads", d) || "Leads";
    const v = (k) => (has(k) ? num(Math.round(sum(k))) : "—");
    const visits = sum("sessions");
    const kpis = `<div class="cb-grid cb-kpis okp-kpis">
      ${kpi({ label: t("Pages"), value: num(d.total_pages || rows.length), sub: `<b>${num(rows.filter((r) => r.sessions).length)}</b> ${t("with visits")}`, extra: share(pctOf(rows.filter((r) => r.sessions).length, d.total_pages || rows.length)) })}
      ${kpi({ label: t("Visits"), value: v("sessions"), sub: esc(t("Google Analytics")) })}
      ${kpi({ label: esc(t(leadsWord)), value: v("leads"), sub: has("leads") && visits ? `${dec(Math.round((sum("leads") / visits) * 1000) / 10)}${fr() ? " %" : "%"} ${t("of visits")}` : "" })}
      ${kpi({ label: t("Google clicks"), value: v("clicks"), sub: esc(t("Search Console")) })}
    </div>`;
    const types = new Map();
    rows.forEach((r) => { const k = t(r.category || "Other"); types.set(k, (types.get(k) || 0) + (r.sessions || 0)); });
    const typeList = [...types.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => [esc(k), n]);
    const typeCard = card("", t("Visits by page type"), typeList.length ? `<div class="cb-big cb-big-sm"><b>${num(visits)}</b><span>${t("visits")}</span></div>${split(typeList, visits)}` : `<p class="cb-s">${t("No visits in this period.")}</p>`);
    const host = (r) => r.host || UI().siteHostPicked?.() || "";
    const line = (r) => `<span class="cb-pg okp-pg">${thumb(`https://${host(r)}${r.path}`)}<span class="okp-pg-t">${window.PageLink ? window.PageLink.html(r.path, { host: host(r), cls: "okp-pg-link" }) : esc(r.path)}</span></span>`;
    const topVisits = [...rows].filter((r) => r.sessions).sort((a, b) => b.sessions - a.sessions).slice(0, 6);
    const topCard = card("", t("Most visited pages"), topVisits.length ? bars(topVisits.map((r) => [line(r), r.sessions])) : `<p class="cb-s">${t("No visits in this period.")}</p>`, "", t("visits"));
    const topLeads = [...rows].filter((r) => r.leads).sort((a, b) => b.leads - a.leads).slice(0, 6);
    const leadCard = card("", t("Pages that bring {leads}").replace("{leads}", t(leadsWord).toLowerCase()), topLeads.length ? bars(topLeads.map((r) => [line(r), Math.round(r.leads)])) : `<p class="cb-s">${t("None in this period.")}</p>`);
    return `<div class="okp-content-top">${kpis}<div class="cb-grid cb-row3 okp-row3">${typeCard}${topCard}${leadCard}</div></div>`;
  }
  function wrapContent() {
    const screen = window.SCREENS?.content;
    if (!screen || screen.okpWrapped) return;
    const draw = screen.page;
    screen.okpWrapped = true;
    screen.page = function page() {
      const html = draw.apply(this, arguments);
      if (!on()) return html;
      try {
        const simple = Boolean(UI().simple?.());
        const entry = window.LV?.load?.("metrics/content", simple ? "&include=clarity,speed,clarity_reports" : "");
        if (!entry?.data?.pages?.length) return html;
        const box = document.createElement("div");
        box.append(UI().fragment(html));
        const content = box.querySelector(".content");
        if (!content) return html;
        const tabs = content.querySelector(":scope > .page-tabs");
        if (tabs && !tabs.querySelector('[data-lv-ptab="content:pages"][aria-selected="true"]')) return html; // only on All pages
        const top = UI().fragment(contentTop(entry.data));
        if (tabs) tabs.after(top); else content.prepend(top);
        content.classList.add("okp-content");
        return box.innerHTML;
      } catch (err) { console.error(err); return html; }
    };
  }

  /* ================= Site map ================= */
  // d = the folders answer of the map on show. Pages, where they sit (a split bar by top folder), comments, links read.
  function siteMap(d) {
    if (!on() || !d?.boxes?.length) return "";
    const kids = d.boxes.filter((b) => b.parent === 0 && b.kind !== "page");
    const loose = d.boxes.filter((b) => b.parent === 0 && b.kind === "page").length;
    const list = kids.map((b) => [esc(t(b.kind === "group" ? "Pages with no folder" : b.label)), b.pages || 0]).concat(loose ? [[esc(t("Pages with no folder")), loose]] : []).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    const notes = d.boxes.reduce((s, b) => s + (b.notes || 0), 0);
    const total = list.reduce((s, [, n]) => s + n, 0);
    const read = d.links || { read: 0, of: 0 };
    const kpis = `<div class="cb-grid okp-sm-row">
      ${kpi({ label: t("Pages"), value: num(d.pages), sub: `${num(kids.filter((b) => b.kind === "folder").length)} ${t("folders")}` })}
      ${kpi({ label: t("Links read"), value: `${num(read.read)}<small class="okp-of"> / ${num(read.of)}</small>`, sub: t(read.read >= read.of ? "Every page read" : "The rest fill in as the reader passes"), extra: share(pctOf(read.read, read.of)) })}
      ${kpi({ label: t("Comments"), value: notes ? num(notes) : "—", sub: t("on pages and folders") })}
      <section class="card cb-card okp-card okp-sm-split"><div class="cb-ch"><h2>${t("Where the pages sit")}</h2></div><div class="cb-body">${total ? split(list, total, { max: 4 }) : `<p class="cb-s">—</p>`}</div></section>
    </div>`;
    return kpis;
  }

  /* ================= Site health: Health test ================= */
  const SEV_ORDER = { crit: 0, warn: 1, info: 2 };
  const SEV_WORD = { crit: "Critical", warn: "Warning", info: "Info" };
  /* x = { audit, score, change, graded, checks, problems, notOnGoogle, indexHtml } from health.js. */
  function healthTop(x) {
    if (!on()) return "";
    const a = x.audit;
    // The score over the last tests, in the one chart look (cb-chart.js): a smooth line, no bars.
    const mini = x.graded.length >= 2 && window.CBChart ? `<span class="cb-mini-area">${window.CBChart.mini(x.graded, [], { fit: true })}</span>` : "";
    const score = kpi({ label: t("Health score"), value: known(x.score) ? `<span id="ht-score">${num(x.score)}</span><small class="okp-of"> /100</small>` : "—", change: known(x.change) ? pill(x.change) : "", sub: x.sub || "", extra: mini, cls: "okp-score" });
    const found = (x.checks || []).filter((c) => c.count > 0);
    const crit = found.filter((c) => c.severity === "crit").length, warn = found.filter((c) => c.severity === "warn").length;
    const kpis = `<div class="cb-grid cb-kpis okp-kpis">
      ${score}
      ${kpi({ label: t("Pages read"), value: a ? num(a.pages_read || 0) : "—", sub: a ? esc(UI().fmtDateOnly(a.finished_at || a.created_at)) : "" })}
      ${kpi({ label: t("Problems"), value: num(found.length + (x.siteProblems || 0)), sub: found.length || x.siteProblems ? [x.siteProblems ? `<b class="okp-crit">${num(x.siteProblems)} ${t("whole-site")}</b>` : "", crit ? `<b class="okp-crit">${num(crit)} ${fr() && crit > 1 ? "critiques" : t("critical")}</b>` : "", warn ? `<b class="okp-warn-t">${num(warn)} ${t(warn === 1 ? "warning" : "warnings")}</b>` : ""].filter(Boolean).join(" · ") || `${num(found.length)} ${t("to look at")}` : t("None found") })}
      ${kpi({ label: t("Not on Google"), value: known(x.notOnGoogle) ? num(x.notOnGoogle) : "—", sub: x.notOnGoogle ? `<button type="button" class="link-btn" id="ht-score-index-go">${t("See them")}</button>` : known(x.notOnGoogle) ? t("Every page checked is on Google") : t("Not checked"), cls: x.notOnGoogle ? "okp-warn" : "" })}
    </div>`;
    const sorted = [...found].sort((p, q) => SEV_ORDER[p.severity === "crit" ? "crit" : p.severity === "warn" ? "warn" : "info"] - SEV_ORDER[q.severity === "crit" ? "crit" : q.severity === "warn" ? "warn" : "info"] || q.count - p.count);
    const max = Math.max(1, ...sorted.map((c) => c.count));
    const rows = sorted.map((c) => {
      const sev = c.severity === "crit" ? "crit" : c.severity === "warn" ? "warn" : "info";
      return `<button type="button" class="okp-pb okp-sev-${sev}" data-okp-check="${esc(c.code)}"><span class="okp-pb-t">${esc(t(c.meaning))}</span><span class="okp-pb-sev">${icon(sev === "crit" ? "octagon-alert" : sev === "warn" ? "triangle-alert" : "info")}${t(SEV_WORD[sev])}</span><b>${num(c.count)}</b><span class="cb-bar"><i style="width:${pctOf(c.count, max)}%"></i></span></button>`;
    }).join("");
    const problems = card("okp-ht-bars", t("Problems by type"), rows || `<p class="cb-s">${t("No problems found.")}</p>`, "", found.length ? `${t("pages with each problem")}` : "");
    return { kpis, problems };
  }

  /* ================= Site health: Uptime ================= */
  function uptimeTop(sites) {
    if (!on() || !sites?.length) return "";
    const upN = sites.filter((s) => s.state === "up").length, downN = sites.filter((s) => s.state === "down").length;
    const outages = sites.reduce((s, x) => s + (x.incidents?.length || 0), 0);
    const pcts = sites.map((s) => s.uptime_percent).filter(known);
    const avg = pcts.length ? Math.round((pcts.reduce((s, v) => s + v, 0) / pcts.length) * 10) / 10 : null;
    const soonest = (key) => sites.map((s) => s[key]).filter((e) => e?.expires).sort((a, b) => a.expires.localeCompare(b.expires))[0];
    const cert = soonest("certificate"), dom = soonest("domain");
    const daysTo = (iso) => Math.round((new Date(`${iso.slice(0, 10)}T00:00:00Z`) - Date.now()) / 86400000);
    const expiry = (e) => (e ? `${t("in")} ${num(daysTo(e.expires))} ${t("days")}` : t("Unknown"));
    const sevCls = (e) => (e?.state === "expired" ? "okp-crit-card" : e?.state === "expiring" ? "okp-warn" : "");
    const days = sites.length === 1 ? sites[0].days || [] : [];
    const strip = days.length ? `<span class="okp-up-mini" aria-hidden="true">${days.map((d) => `<i class="${d.state === "up" ? "up" : d.state === "down" ? "down" : ""}"></i>`).join("")}</span>` : "";
    return `<div class="cb-grid cb-kpis okp-kpis okp-up-kpis">
      ${kpi({ label: t(sites.length === 1 ? "Status" : "Sites online"), value: sites.length === 1 ? `<span class="okp-word">${t(upN ? "Online" : downN ? "Offline" : "Unknown")}</span>` : `${num(upN)}<small class="okp-of"> / ${num(sites.length)}</small>`, sub: sites.length === 1 ? (sites[0].last_checked_at ? `${t("Last check")} ${esc(UI().fmtStamp(sites[0].last_checked_at))}` : t("Not checked")) : downN ? `<b class="okp-crit">${num(downN)} ${t("offline")}</b>` : sites.length - upN ? `${num(sites.length - upN)} ${t("unknown")}` : t("All answering"), cls: downN ? "okp-crit-card" : "" })}
      ${kpi({ label: t("Online, last 30 days"), value: known(avg) ? `${dec(avg)}${fr() ? " %" : "%"}` : "—", sub: `${num(outages)} ${t(outages === 1 ? "outage" : "outages")}`, extra: strip })}
      ${kpi({ label: t("Security certificate"), value: cert ? `<span class="okp-word">${esc(UI().fmtDateOnly(cert.expires))}</span>` : "—", sub: expiry(cert), cls: sevCls(cert) })}
      ${kpi({ label: t("Domain name"), value: dom ? `<span class="okp-word">${esc(UI().fmtDateOnly(dom.expires))}</span>` : "—", sub: expiry(dom), cls: sevCls(dom) })}
    </div>`;
  }

  /* ================= Site health: Links checker (drawn by mockup.js: decorated here) ================= */
  // Its four counts become number cards; one split bar under them says how the problems divide.
  function decorateLinks() {
    if (!on() || UI()?.state?.route !== "health") return;
    const tiles = document.querySelector("#page .lc-tiles");
    if (!tiles || tiles.dataset.okp) return;
    tiles.dataset.okp = "1";
    const items = [...tiles.querySelectorAll(".lc-jump")].map((a) => [a.querySelector(".lab")?.textContent || "", Number((a.querySelector(".fig")?.textContent || "0").replace(/[^\d]/g, "")) || 0, a.dataset.lcJump]);
    const total = items.reduce((s, [, n]) => s + n, 0);
    const COLORS = { broken: "var(--cb-down)", unverified: "var(--cb-4)", redirect: "var(--cb-3)", slow: "var(--cb-warn)" };
    const bar = total ? `<div class="okp-lc-split" aria-hidden="true"><div class="cb-stack">${items.filter(([, n]) => n).map(([, n, id]) => `<i style="flex:${n};background:${COLORS[id] || "var(--cb-5)"}"></i>`).join("")}</div></div>` : "";
    tiles.querySelectorAll(".lc-jump").forEach((a) => { const sw = document.createElement("i"); sw.className = "okp-lc-sw"; sw.style.background = COLORS[a.dataset.lcJump] || "var(--cb-5)"; a.querySelector(".lab")?.prepend(sw); });
    if (bar) tiles.after(UI().fragment(bar));
  }

  /* ---- clicks ---- */
  document.addEventListener("click", (e) => {
    if (!on() || !(e.target instanceof Element)) return;
    const check = e.target.closest("[data-okp-check]");
    if (check) {
      const box = document.querySelector(`details.ht-check[data-ht-check="${CSS.escape(check.dataset.okpCheck)}"]`);
      if (!box) return;
      box.open = true;
      box.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      box.querySelector("summary")?.focus({ preventScroll: true });
    }
  });

  /* ---- start ---- */
  function start() {
    wrapContent();
    let waiting = false;
    new MutationObserver(() => { if (waiting) return; waiting = true; requestAnimationFrame(() => { waiting = false; decorateLinks(); }); })
      .observe(document.getElementById("page") || document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  wrapContent();

  window.OceanKP = { on, keywords, pages, siteMap, healthTop, uptimeTop };

  const words = {
    "Keyword positions": "Positions des mots-clés", "Biggest moves": "Plus gros mouvements", "Going down": "En baisse", "Lower": "Plus bas", "Lower or not found": "Plus bas ou absent",
    "Week to {day}": "Semaine au {day}", "Last check": "Dernier contrôle", "Check before": "Contrôle précédent", "Our checks": "Nos contrôles", "was": "avant",
    "No Search Console data yet.": "Pas encore de données Search Console.", "No positions yet. Press Refresh to check them.": "Pas encore de positions. Appuyez sur Actualiser pour les contrôler.",
    "No keyword moved since the period before.": "Aucun mot-clé n'a bougé depuis la période précédente.", "Nothing went up.": "Rien n'est monté.", "New": "Nouveau", "Lost": "Perdu",
    "keywords on": "mots-clés sur", "sites": "sites", "All sites": "Tous les sites", "Up": "Hausse", "Down": "Baisse",
    "get clicks": "reçoivent des clics", "with clicks": "avec des clics", "with backlinks": "avec backlinks", "No earlier period": "Pas de période précédente",
    "Where the clicks go": "Où vont les clics", "This period": "Cette période", "Period before": "Période précédente", "No clicks in this period.": "Aucun clic sur cette période.",
    "Gaining clicks": "Gagnent des clics", "No page gained clicks.": "Aucune page n'a gagné de clics.", "No page lost clicks.": "Aucune page n'a perdu de clics.", "All": "Tout",
    "with visits": "avec des visites", "of visits": "des visites", "Visits by page type": "Visites par type de page", "visits": "visites", "No visits in this period.": "Aucune visite sur cette période.",
    "Most visited pages": "Pages les plus visitées", "Pages that bring {leads}": "Pages qui apportent des {leads}", "None in this period.": "Aucun sur cette période.", "Other": "Autre",
    "folders": "dossiers", "Links read": "Liens lus", "Every page read": "Toutes les pages lues", "The rest fill in as the reader passes": "Le reste se remplit au passage du lecteur",
    "Comments": "Commentaires", "on pages and folders": "sur pages et dossiers", "Where the pages sit": "Où sont les pages", "Pages with no folder": "Pages sans dossier",
    "Pages read": "Pages lues", "Problems": "Problèmes", "whole-site": "site entier", "critical": "critique", "warning": "avertissement", "warnings": "avertissements",
    "to look at": "à regarder", "None found": "Aucun trouvé", "Not on Google": "Absentes de Google", "See them": "Les voir", "Every page checked is on Google": "Chaque page vérifiée est sur Google",
    "Problems by type": "Problèmes par type", "pages with each problem": "pages par problème", "No problems found.": "Aucun problème trouvé.", "Critical": "Critique", "Warning": "Attention", "Info": "Info",
    "Status": "État", "Sites online": "Sites en ligne", "offline": "hors ligne", "unknown": "inconnus", "All answering": "Tous répondent", "Online": "En ligne", "Offline": "Hors ligne", "Unknown": "Inconnu",
    "Online, last 30 days": "En ligne, 30 derniers jours", "outage": "panne", "outages": "pannes", "Security certificate": "Certificat de sécurité", "Domain name": "Nom de domaine", "in": "dans", "days": "jours",
  };
  window.FR = window.FR || {};
  Object.entries(words).forEach(([k, v]) => { if (window.FR[k] === undefined) window.FR[k] = v; });
})();
