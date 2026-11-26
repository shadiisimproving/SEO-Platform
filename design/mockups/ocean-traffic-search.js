/* The new design (Cobalt) for the Traffic and Search screens: Channels, Leads, Overview and Insights (2026-11-26).
   Only acts when document.documentElement.dataset.brand === "ocean" (new-menu.js); with it off every screen draws as before.
   The screens hand over the parts they already draw (cards, tables, panels, tabs) and this file lays them out the way the new
   Today does: number cards, then one bar chart of this period (cobalt) over the period before (pale grey) with the key
   breakdown beside it, then the full tables. The bars come from the same answer the screen already asked for: no new calls. */
(() => {
  "use strict";
  const UI = () => window.UI;
  const t = (word) => UI().t(word);
  const esc = (text) => UI().esc(text);
  const num = (value) => UI().num(value);
  const icon = (name) => UI().icon(name);
  const on = () => document.documentElement.dataset.brand === "ocean";
  const fr = () => UI().state.lang === "fr";
  const day = (iso) => new Intl.DateTimeFormat(UI().locale(), { day: "numeric", month: "short" }).format(new Date(`${String(iso).slice(0, 10)}T00:00:00`));
  const pctText = (v, digits = 0) => `${new Intl.NumberFormat(UI().locale(), { maximumFractionDigits: digits }).format(v)}${fr() ? " %" : "%"}`;
  const known = (v) => v !== null && v !== undefined && !Number.isNaN(v);

  /* ---- small parts ---- */
  // A change as a small pill with an arrow: green up, red down (lowerIsBetter turns the colour, never the arrow).
  function pill(now, before, { unit = "%", lowerIsBetter = false } = {}) {
    if (!known(now) || !known(before)) return "";
    const diff = unit === "%" ? (before ? ((now - before) / before) * 100 : null) : now - before;
    if (diff === null) return "";
    const shown = unit === "%" ? Math.round(diff) : Math.round(diff * 10) / 10;
    if (!shown) return `<span class="cb-d cb-flat">±0</span>`;
    const good = lowerIsBetter ? shown < 0 : shown > 0;
    const text = unit === "%" ? pctText(Math.abs(shown)) : unit === "pts" ? `${num(Math.abs(shown))} ${t("pts")}` : num(Math.abs(shown));
    return `<span class="cb-d ${good ? "cb-up" : "cb-down"}">${icon(shown > 0 ? "arrow-up" : "arrow-down")}${text}</span>`;
  }

  const niceStep = (max) => [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000].find((s) => max / s <= 4.2) || 100000;
  const bestOf = (points) => { let b = 0; points.forEach((p, i) => { if ((p.now ?? -1) > (points[b].now ?? -1)) b = i; }); return b; };
  const openTables = new Set();

  /* The new design's one chart look (CBChart.plot, cb-chart.js: a smooth cobalt line, a soft fade under it, the period
     before as a thin dashed grey line, the best day marked). points: [{ day, now, was }]. A "Show table" under it lists
     every day, as the old line charts did. */
  function chart(id, points, { label = "", fmt = num } = {}) {
    const n = points.length;
    if (!n) return `<p class="cb-empty">${t("No data in this period.")}</p>`;
    const plot = window.CBChart?.plot({ points, fmt, best: true, height: 230, label: `${t(label)} ${t("each day")}, ${day(points[0].day)} – ${day(points[n - 1].day)}` }) || "";
    const open = openTables.has(id), hasWas = points.some((p) => known(p.was));
    const table = `<div class="table-wrap cbx-table"${open ? "" : " hidden"}><table class="data" data-tt-off><thead><tr><th>${t("Date")}</th><th class="c">${esc(t(label || "This period"))}</th>${hasWas ? `<th class="c">${t("Period before")}</th>` : ""}</tr></thead><tbody>${points.map((p) => `<tr><td data-label="${t("Date")}">${esc(day(p.day))}</td><td class="c" data-label="${esc(t(label || "This period"))}">${known(p.now) ? fmt(p.now) : "—"}</td>${hasWas ? `<td class="c" data-label="${t("Period before")}">${known(p.was) ? fmt(p.was) : "—"}</td>` : ""}</tr>`).join("")}</tbody></table></div>`;
    return `${plot}
      <div class="cbx-foot"><span class="cb-legend"><span><i></i>${t("This period")}</span>${hasWas ? `<span><i class="was"></i>${t("Period before")}</span>` : ""}</span>
        <button type="button" class="link-btn" data-cbx-table="${esc(id)}" aria-expanded="${open}">${t(open ? "Hide table" : "Show table")}</button></div>${table}`;
  }
  // The words beside the big number: what it was, and the best day.
  function bigWords(points, before, fmt = num) {
    const best = points.length ? bestOf(points) : 0;
    return [known(before) ? `${t("vs")} ${fmt(before)}` : "", points.length && (points[best].now ?? 0) > 0 ? `${t("best day")} ${fmt(points[best].now)} ${t("on")} ${day(points[best].day)}` : ""].filter(Boolean).join(" · ");
  }
  const seg = (group, list, picked) => (list.length > 1 ? `<div class="cb-seg" role="group" aria-label="${t("Chart")}">${list.map(([id, word]) => `<button type="button" data-cbx-metric="${group}:${id}" aria-pressed="${id === picked}">${esc(t(word))}</button>`).join("")}</div>` : "");

  /* ---- Traffic: Channels and Leads ---- */
  const picked = { channels: "sessions", conversions: "leads", insights: "clicks" };
  const last = {}; // what each screen handed over last, to redraw the chart alone when its switch is pressed
  // Each channel keeps the colour the table and the line chart give it (screens-live.js colourOf); the Cobalt shades of
  // those colours are set in look-ocean-traffic-search.css, inside .cbx-channels only.
  const SLOTS = { "Organic Search": 1, Direct: 2, Referral: 3, "Organic Social": 4, "Paid Search": 5 };
  const colourOf = (name) => {
    if (name === "Other") return "var(--ch-other)";
    if (SLOTS[name]) return `var(--ch-${SLOTS[name]})`;
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `var(--ch-${(h % 5) + 1})`;
  };
  const dayPoints = (d, field) => (d.days || []).map((r, i) => ({ day: r.day, now: r[field] ?? null, was: d.days_before?.[i]?.[field] ?? null }));
  const sumOf = (list, field) => (list?.length ? list.reduce((s, r) => s + (r[field] || 0), 0) : null);

  function trafficLeft(route) {
    const p = last[route];
    if (!p) return "";
    if (picked[route] === "leads" && !p.leadsOk) picked[route] = "sessions";
    const d = p.d, field = picked[route], word = field === "leads" ? p.leadWord : "Visits";
    const points = dayPoints(d, field);
    const total = field === "leads" ? (route === "channels" ? d.total?.leads : d.leads) : route === "channels" ? d.total?.sessions : d.sessions;
    const shownNow = known(total) ? total : sumOf(d.days, field);
    const before = d.before?.[field];
    const wasSum = known(before) ? before : d.days_before?.length ? sumOf(d.days_before, field) : null;
    /* When only some sites had a fair period before, the cards compare those sites alone (d.compared): the pill does too,
       and says so, so it never disagrees with the card above it. */
    const cmpNow = known(d.compared?.[field]) ? d.compared[field] : shownNow;
    const words = known(d.compared?.[field]) && known(wasSum) ? `${t("Sites with a period before")}: ${num(wasSum)} → ${num(cmpNow)}` : bigWords(points, wasSum);
    const switcher = seg(route, [["sessions", "Visits"], ["leads", p.leadWord]].filter(([id]) => id === "sessions" || p.leadsOk), field);
    return `<div class="cb-hero-l cbx-hero-l" data-cbx-left="${route}"><div class="cb-ch"><h2>${esc(t(word))} ${t("each day")}</h2>${switcher}</div>
      <div class="cb-big"><b>${known(shownNow) ? num(shownNow) : "—"}</b>${pill(cmpNow, wasSum)}<span>${esc(words)}</span></div>
      ${chart(`${route}-${field}`, points, { label: word })}</div>`;
  }

  // Channels: the split bar of visits by channel beside the chart; each row opens the channel's side panel, as the table does.
  function channelsRight(d) {
    const list = (d.channels || []).filter((c) => c.sessions > 0), total = list.reduce((s, c) => s + c.sessions, 0);
    if (!total) return `<div class="cb-hero-r"><h3>${t("Where visits came from")}</h3><p class="cb-s">${t("No data in this period.")}</p></div>`;
    const top = list.slice(0, 5), rest = list.slice(5).reduce((s, c) => s + c.sessions, 0);
    const rows = top.map((c) => [c.channel, c.sessions, c.change]).concat(rest ? [["Other", rest, null]] : []);
    return `<div class="cb-hero-r"><h3>${t("Where visits came from")}</h3>
      <div class="cb-stack" aria-hidden="true">${rows.map(([name, v]) => `<i style="flex:${v};background:${colourOf(name)}"></i>`).join("")}</div>
      <ul class="cb-rows cbx-rows">${rows.map(([name, v, ch]) => `<li${name === "Other" && rest ? "" : ` data-rp-open="channel" data-rp-key="${esc(name)}" tabindex="0"`}><i style="background:${colourOf(name)}"></i><span dir="auto">${esc(t(name))}</span><b>${num(v)}</b><em>${Math.round((v / total) * 100)}%</em>${known(ch) ? `<span class="cb-d ${ch >= 0 ? "cb-up" : "cb-down"} cbx-mini-d">${icon(ch >= 0 ? "arrow-up" : "arrow-down")}${pctText(Math.abs(Math.round(ch)))}</span>` : `<span class="cbx-mini-d"></span>`}</li>`).join("")}</ul></div>`;
  }
  // Leads: from visit to lead, one progress row per channel; the visits that didn't become a lead are the bar's tip.
  function conversionsRight(p) {
    const d = p.d, list = d.funnel || [], max = Math.max(1, ...list.map((r) => r.sessions));
    const head = `<h3>${esc(t(p.funnelTitle))}</h3>`;
    if (!list.length) return `<div class="cb-hero-r">${head}<p class="cb-s">${t("No data in this period.")}</p></div>`;
    const row = (r) => `<div class="cb-prog"><span dir="auto">${esc(t(r.channel))}</span><b>${num(r.leads)} <small>${t("of")} ${num(r.sessions)} · ${known(r.rate) ? pctText(r.rate * 100, 1) : "—"}</small></b>
      <span class="cb-bar" data-tip="${esc(p.lostWord(r))}"><i style="width:${Math.max(r.sessions ? 2 : 0, Math.round((r.sessions / max) * 100))}%"></i><i class="cbx-lead" style="width:${Math.max(r.leads ? 2 : 0, Math.round((r.leads / max) * 100))}%"></i></span><span class="sr">${esc(p.lostWord(r))}</span></div>`;
    const more = list.length > 6 ? `<details class="cbx-more"><summary>${t("All")} ${num(list.length)}</summary>${list.slice(6).map(row).join("")}</details>` : "";
    return `<div class="cb-hero-r cbx-funnel">${head}${list.slice(0, 6).map(row).join("")}${more}
      <p class="cb-legend cbx-legend-under"><span><i></i>${t("visits")}</span><span><i class="cbx-lead-key"></i>${esc(t(p.leadsWord))}</span></p></div>`;
  }

  function channels(p) {
    last.channels = p;
    const hero = `<section class="card cb-hero cbx-hero" id="cbx-hero">${trafficLeft("channels")}${channelsRight(p.d)}</section>`;
    return `<div class="cbx cbx-channels">${p.cards}${hero}${p.tableCard}<div class="cb-grid cbx-pair">${p.chartCard}${p.refCard}</div></div>`;
  }
  function conversions(p) {
    last.conversions = p;
    const hero = `<section class="card cb-hero cbx-hero" id="cbx-hero">${trafficLeft("conversions")}${conversionsRight(p)}</section>`;
    return `<div class="cbx cbx-conversions">${p.setUp || ""}${p.cards}${hero}${p.tabsCard}</div>`;
  }

  /* ---- Search: Overview ---- */
  /* Overview's chart strips in the same look (overview-view.js asks): the line smooth and cobalt with a soft area under it,
     the period before a thin dashed grey line, days not final yet dotted. x(i) and y(v) are the strip's own, so its
     crosshair, read-out, notes and update bands stay where they were. */
  function stripArea({ values, was, x, y, base, freshAt, solidEnd }) {
    const P = window.CBChart?.path;
    if (!P) return "";
    const runsOf = (list, from, to) => {
      const out = []; let run = null;
      for (let i = from; i <= to && i < list.length; i++) {
        if (!known(list[i])) { run = null; continue; }
        if (!run) { run = [i, i]; out.push(run); } else run[1] = i;
      }
      return out;
    };
    const smooth = (list, from, to) => runsOf(list, from, to).map(([a, b]) => P(list.slice(a, b + 1), (k) => x(a + k), y)).join("");
    const area = runsOf(values, 0, values.length - 1).filter(([a, b]) => b > a)
      .map(([a, b]) => `${P(values.slice(a, b + 1), (k) => x(a + k), y)}L${x(b).toFixed(1)} ${base.toFixed(1)}L${x(a).toFixed(1)} ${base.toFixed(1)}Z`).join("");
    const before = was?.some(known) ? `<path class="cbx-was" d="${smooth(was, 0, was.length - 1)}"/>` : "";
    const solid = solidEnd >= 0 ? `<path class="cbx-now" d="${smooth(values, 0, solidEnd)}"/>` : "";
    const fresh = freshAt >= 0 ? `<path class="cbx-now cbx-fresh" d="${smooth(values, Math.max(0, freshAt - 1), values.length - 1)}"/>` : "";
    return `${area ? `<path class="cbx-area" d="${area}"/>` : ""}${before}${solid}${fresh}`;
  }
  // Overview: the answer (biggest gains or losses) beside the chart, Google updates beside Keywords by ranking.
  function overview(p) {
    const side = p.answer ? `<aside class="cbx-side"><h3>${t("What moved")}</h3>${p.answer}</aside>` : "";
    const hero = `<section class="card ov-chart-card cbx-ov-hero${side ? " cbx-has-side" : ""}"><div class="cbx-ov-main">${p.chartHead}${p.chart}</div>${side}</section>`;
    // On All sites each update lists every site, too wide to share a row: the two cards then stack.
    const pair = p.updates && p.ranks && UI().siteHostPicked?.() ? `<div class="cb-grid cbx-ov-pair">${p.updates}${p.ranks}</div>` : `${p.updates}${p.ranks}`;
    return `<div class="cbx cbx-overview">${p.notes}${p.cards}${hero}${pair}${p.hint}${p.tabs}</div>`;
  }

  /* ---- Search: Insights ---- */
  // The last 28 days over the 28 before, day against day, as bars; the pages and the why beside it.
  function insightsLeft() {
    const p = last.insights;
    if (!p) return "";
    const { days, change } = p, e = change.evidence;
    const shift = (iso) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 28); return d.toISOString().slice(0, 10); };
    const field = picked.insights, byDay = Object.fromEntries((days || []).map((r) => [r.day, r]));
    const points = (days || []).filter((r) => r.day >= e.from).map((r) => ({ day: r.day, now: r[field] ?? null, was: byDay[shift(r.day)]?.[field] ?? null }));
    const now = e.now?.[field], before = e.before?.[field];
    const hasImp = (days || []).some((r) => known(r.impressions));
    const other = field === "clicks" ? "impressions" : "clicks";
    const otherPill = known(e.now?.[other]) ? `<span class="cbx-also">${pill(e.now[other], e.before?.[other])}<span>${t(other === "clicks" ? "Clicks" : "Impressions")}</span></span>` : "";
    return `<div class="cb-hero-l cbx-hero-l" data-cbx-left="insights"><div class="cb-ch"><h2>${t(field === "clicks" ? "Clicks" : "Impressions")} ${t("each day")}</h2><span class="cb-meta">${t("Last 28 days vs the 28 before")}</span>${hasImp ? seg("insights", [["clicks", "Clicks"], ["impressions", "Impressions"]], field) : ""}</div>
      <div class="cb-big"><b>${known(now) ? num(now) : "—"}</b>${pill(now, before)}<span>${known(before) ? `${t("vs")} ${num(before)}` : ""}</span>${otherPill}</div>
      ${points.length ? chart(`insights-${field}`, points, { label: field === "clicks" ? "Clicks" : "Impressions" }) : ""}${p.weekly || ""}</div>`;
  }
  function insightsTop(p) {
    last.insights = p;
    return `<section class="card cb-hero cbx-hero cbx-in-hero${p.lists ? "" : " cbx-solo"}" id="cbx-hero">${insightsLeft()}${p.lists ? `<div class="cb-hero-r cbx-in-lists">${p.lists}</div>` : ""}</section>`;
  }

  // All sites: one row per site, clicks now against the 28 days before as two bars, and the pages that moved most under it.
  function insightsSites(changes) {
    const max = Math.max(1, ...changes.flatMap((c) => [c.evidence.now?.clicks || 0, c.evidence.before?.clicks || 0]));
    const w = (v) => `${Math.max(v ? 1 : 0, Math.round(((v || 0) / max) * 100))}%`;
    const rows = changes.map((c) => {
      const e = c.evidence, now = e.now?.clicks, before = e.before?.clicks;
      const imp = e.now?.impressions, impWas = e.before?.impressions;
      const logo = UI().siteLogo ? UI().siteLogo(c.host, 16) : "";
      const moved = (e.explains || []).slice(0, 3).map((p) => `<li><span class="cbx-pg">${window.PageLink ? window.PageLink.html(p.page, { text: p.path, host: c.host }) : esc(p.path)}</span><b class="${p.change < 0 ? "cbx-neg" : "cbx-pos"}">${p.change > 0 ? "+" : "−"}${num(Math.abs(p.change))}</b></li>`).join("");
      return `<li class="cbx-site"><span class="cbx-host">${logo}<b dir="auto">${esc(c.host)}</b></span>
        <span class="cb-pair" aria-hidden="true"><i class="now" style="width:${w(now)}"></i><i class="was" style="width:${w(before)}"></i></span>
        <span class="cbx-nums"><b>${known(now) ? num(now) : "—"}</b> <small>${t("was")} ${known(before) ? num(before) : "—"}</small></span>
        <span class="cbx-pills">${e.steady ? `<span class="cb-d cb-flat">${t("Steady")}</span>` : pill(now, before)}${known(imp) && known(impWas) && !e.steady ? `<span class="cbx-also">${pill(imp, impWas)}<span>${t("Impressions")}</span></span>` : ""}</span>
        ${moved ? `<ul class="cbx-moved">${moved}</ul>` : ""}</li>`;
    }).join("");
    return `<section class="card cbx-in-sites cbx-in-hero"><div class="cb-ch"><h2>${t("Clicks by site")}</h2><span class="cb-meta">${t("Last 28 days vs the 28 before")}</span><span class="cb-legend"><span><i></i>${t("Last 28 days")}</span><span><i class="was"></i>${t("28 days before")}</span></span></div>
      <div class="cb-body"><ul class="cbx-sites">${rows}</ul></div></section>`;
  }

  /* ---- clicks ---- */
  document.addEventListener("click", (e) => {
    if (!on()) return;
    const sw = e.target.closest?.("[data-cbx-metric]");
    if (sw) {
      const [route, field] = sw.dataset.cbxMetric.split(":");
      picked[route] = field;
      const left = document.querySelector(`[data-cbx-left="${route}"]`);
      if (left) left.replaceWith(UI().fragment(route === "insights" ? insightsLeft() : trafficLeft(route)));
      document.querySelector(`[data-cbx-metric="${route}:${field}"]`)?.focus({ preventScroll: true });
      return;
    }
    // A channel row beside the chart opens the same side panel as its row in the table (row-panel.js opens only table rows).
    const li = e.target.closest?.("li[data-rp-open]");
    if (li && li.closest(".cbx") && UI().rowPanel?.open) { UI().rowPanel.open(li.dataset.rpOpen, li.dataset.rpKey, li, { host: li.dataset.rpHost || null }); return; }
    const tb = e.target.closest?.("[data-cbx-table]");
    if (tb) {
      const id = tb.dataset.cbxTable, open = !openTables.has(id);
      if (open) openTables.add(id); else openTables.delete(id);
      tb.setAttribute("aria-expanded", String(open));
      tb.textContent = t(open ? "Hide table" : "Show table");
      const table = tb.closest(".cbx-foot")?.nextElementSibling;
      if (table?.classList.contains("cbx-table")) table.hidden = !open;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (!on() || e.key !== "Enter" || !(e.target instanceof Element) || !e.target.matches(".cbx li[data-rp-open]")) return;
    e.preventDefault(); e.target.click();
  });

  window.OceanTS = { on, channels, conversions, overview, stripArea, insightsTop, insightsSites };
  const words = {
    "each day": "par jour", "best": "meilleur", "best day": "meilleur jour", "on": "le", "before": "avant", "vs": "vs", "pts": "pts",
    "This period": "Cette période", "Period before": "Période précédente", "Where visits came from": "D'où viennent les visites",
    "visits": "visites", "Other": "Autre", "What moved": "Ce qui a bougé", "Last 28 days vs the 28 before": "28 derniers jours vs les 28 d'avant",
    "Visits": "Visites", "Sites with a period before": "Sites avec une période d'avant", "Clicks by site": "Clics par site", "Steady": "Stable", "was": "avant", "Last 28 days": "28 derniers jours", "28 days before": "28 jours d'avant", "of": "sur", "All": "Tout", "Clicks": "Clics", "Impressions": "Impressions", "Show table": "Afficher le tableau", "Hide table": "Masquer le tableau", "Date": "Date", "Chart": "Graphique",
  };
  window.FR = window.FR || {};
  Object.entries(words).forEach(([k, v]) => { if (window.FR[k] === undefined) window.FR[k] = v; });
})();
