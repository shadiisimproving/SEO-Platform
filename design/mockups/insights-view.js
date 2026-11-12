/* Search → Insights. What the code found in Search Console data after each new day: one sentence on why clicks moved,
   three numbers, then one card with tabs, each tab one question. Rows are ranked by clicks a month at stake.
   Everything here is worked out in plain code on the server (seo/insights/); nothing on this screen is written by AI. */
(() => {
  "use strict";
  let UI = null, t, esc, num, icon;
  const TABS = [["first", "To do first"], ["mix", "Rank and clicks"], ["changed", "What changed"], ["decline", "Slow decline"], ["wins", "Quick wins"], ["leads", "Leads"], ["technical", "Technical"], ["impact", "Did it work"]];
  const STATUSES = [["open", "Still open"], ["dismissed", "Not useful"], ["gone", "Went away"], ["done", "Done"]];
  const KIND = {
    page_down: { name: "Losing clicks", title: "{path} lost {percent}% of its clicks" },
    page_up: { name: "Gaining clicks", title: "{path} gained {percent}% clicks", fresh: "{path} is new on Google" },
    dropped_out: { name: "Dropped out of Google", title: "{path} dropped out of Google" },
    odd_day: { name: "Odd day", title: "{day}: {clicks} clicks, usually {usual}" },
    decay: { name: "Slowly losing clicks", title: "{path} is slowly losing clicks" },
    almost: { name: "Almost on page 1", title: "{query}" },
    top3: { name: "Close to the top 3", title: "{query}" },
    low_ctr: { name: "Low click rate", title: "{query}" },
    no_click: { name: "Seen, never clicked", title: "{query}" },
    compete: { name: "Two pages compete", title: "{query}" },
    query_down: { name: "Query losing places", title: "{query}" },
    segment: { name: "One device or country", title: "{segment}: {sign}{percent}% clicks" },
    unstable: { name: "Unstable ranking", title: "{query}" },
    brand_split: { name: "Brand hides a loss", title: "Non-brand clicks fell {percent}%" },
    slide: { name: "Slowly losing places", title: "{query}" },
    page_near: { name: "Near page 1 on many searches", title: "{path}" },
    no_page: { name: "No page of its own", title: "{query}" },
    questions: { name: "Question searches", title: "{path}" },
    topic: { name: "Topic without a strong page", title: "Searches with “{word}”" },
    track: { name: "Worth tracking", title: "{query}" },
    lead_page: { name: "Page that brings leads", title: "{path} brings leads and is losing clicks" },
    no_leads: { name: "Clicks but no leads", title: "{path}" },
    duplicate: { name: "One page, several addresses", title: "{path}" },
    shown_broken: { name: "Shown but broken", title: "{path}" },
    data_gaps: { name: "Data gaps", title: "Search Console data has gaps" },
    task_result: { name: "Task result", title: "{title}" },
    note_result: { name: "Note result", title: "{title}" },
    rank_drop: { name: "Just dropped", title: "{query}" },
    rank_rise: { name: "Just climbed", title: "{query}" },
    rival_passed: { name: "Rival passed you", title: "{query}" },
    rival_gap: { name: "Rivals lead, people search it", title: "{query}" },
    striking: { name: "Almost there, both agree", title: "{query}" },
    rank_no_click: { name: "Ranked, not clicked", title: "{query}" },
    page_switch: { name: "Another page shown", title: "{query}" },
    no_demand: { name: "Tracked, no searches", title: "{query}" },
  };
  // Rank and clicks: each chip one question. The last column changes with the chip, because each question needs its own fact.
  const MIX_KINDS = new Set(["rank_drop", "rank_rise", "rival_passed", "rival_gap", "striking", "rank_no_click", "page_switch", "no_demand"]);
  const MIX_CHIPS = [["all", "All", null, "above"], ["moved", "Just moved", ["rank_drop", "rank_rise"], "moved"], ["rivals", "Rivals ahead", ["rival_passed", "rival_gap"], "above"], ["almost", "Almost there", ["striking"], "above"], ["clicks", "Ranked, not clicked", ["rank_no_click"], "ai"], ["page", "Wrong page", ["page_switch"], "page"], ["tracking", "Tracking", ["no_demand", "track"], ""]];
  const PARTS = {
    demand: ["More searches", "Fewer searches"], ranking: ["Ranking higher", "Ranking lower"], appeal: ["Higher click rate", "Lower click rate"],
    new: ["New queries", "New queries"], lost: ["Lost queries", "Lost queries"], hidden: ["Hidden searches", "Hidden searches"],
  };
  const HIDDEN_TIP = "Searches Google counts but doesn't name.";
  const USUAL_TIP = "Usual click rate at this position"; // beside the short "Usual rate"
  const PAGES = "in"; // the table's pages and search (table-pages.js), like every long table in the app
  const IN = { tab: "first", status: "open", cache: new Map(), sortDir: "desc", opened: null, mixChip: "all" }; // sortDir: clicks a month, biggest first
  window.INSIGHTS = IN;

  const fr = () => UI.state.lang === "fr";
  const fill = (s, values) => Object.entries(values).reduce((out, [k, v]) => out.split(`{${k}}`).join(v), t(s));
  const pathOf = (url) => { try { return new URL(url).pathname || "/"; } catch { return url || "/"; } };
  const dec1 = (v) => (v === null || v === undefined ? "—" : UI.dec(Math.round(v * 10) / 10));
  const dayLabel = (iso, long) => (iso ? new Intl.DateTimeFormat(UI.locale(), { weekday: long ? "long" : undefined, day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00`)) : "");
  const signed = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(Math.round(v)))}`;
  const updated = (iso) => {
    if (!iso) return "";
    const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000)), d = Math.round(m / 1440);
    if (m < 2) return t("Updated just now");
    if (m < 60) return fill("Updated {n} min ago", { n: num(m) });
    if (m < 1440) return fill("Updated {n} h ago", { n: num(Math.round(m / 60)) });
    return d === 1 ? t("Updated yesterday") : fill("Updated {n} d ago", { n: num(d) });
  };

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
  /* Which AI each site uses and whether its key is there. Asked once; Settings → AI tells this screen when it changes. */
  function aiSettings() {
    if ((IN.ai && Date.now() - (IN.aiAt || 0) < 15000) || IN.aiLoading || !window.COMP?.server) return IN.ai;
    IN.aiLoading = true;
    const had = JSON.stringify(IN.ai);
    window.COMP.api("GET", "insights/ai").then((d) => { IN.ai = d; }).catch(() => { IN.ai = IN.ai || { sites: [], keys: {} }; })
      .finally(() => { IN.aiLoading = false; IN.aiAt = Date.now(); if (JSON.stringify(IN.ai) !== had) redraw(); });
    return IN.ai;
  }
  addEventListener("seocc:ai-settings", (e) => { IN.ai = e.detail || null; IN.aiAt = Date.now(); });

  // ---- words --------------------------------------------------------------------------------------
  function titleOf(f) {
    const e = f.evidence || {};
    const kind = KIND[f.kind] || { title: "{path}" };
    return fill(kind.fresh && (e.percent === null || e.percent === undefined) ? kind.fresh : kind.title, {
      path: e.path || pathOf(f.page), percent: num(Math.abs(e.percent || 0)), query: f.query || "", day: dayLabel(e.day, true), clicks: num(e.clicks ?? 0), usual: num(Math.round(e.usual ?? 0)),
      segment: segmentName(e), sign: e.down ? "−" : "+", word: e.label || e.word || "", title: e.title || "",
    });
  }
  /* One line under the title: the numbers that make it a finding. */
  function reasonOf(f) {
    const e = f.evidence || {};
    switch (f.kind) {
      case "page_down": case "page_up": {
        const why = { ranking: fill("Lost places: {a} → {b}", { a: dec1(e.position_before), b: dec1(e.position) }), demand: fill("Fewer searches: {a} → {b} impressions", { a: num(e.impressions_before), b: num(e.impressions) }), appeal: t("Lower click rate") }[e.why];
        const gained = { ranking: fill("Moved up: {a} → {b}", { a: dec1(e.position_before), b: dec1(e.position) }), demand: fill("More searches: {a} → {b} impressions", { a: num(e.impressions_before), b: num(e.impressions) }), appeal: t("Higher click rate") }[e.why];
        return `${num(e.clicks_before)} → ${num(e.clicks)} ${t("clicks")} · ${f.kind === "page_up" ? gained : why}`;
      }
      case "dropped_out": return `${fill("No impressions for {n} days, after {c} clicks in 4 weeks", { n: num(e.days), c: num(e.clicks_before) })}${e.causes?.length ? ` · ${e.causes.map(cause).join(", ")}` : ""}`;
      case "odd_day": return e.low ? `${fill("Usually about {u} on a {d}", { u: num(Math.round(e.usual)), d: new Intl.DateTimeFormat(UI.locale(), { weekday: "long" }).format(new Date(`${e.day}T00:00:00`)) })}${e.in_a_row ? ` · ${t("two days in a row")}` : ""}` : t("A spike");
      case "decay": return fill("{p}% under its best 4 weeks: {a} → {b} clicks a week", { p: num(e.below_peak), a: dec1(e.peak), b: dec1(e.last) });
      case "almost": case "top3": return `${fill("Position {p} · {i} impressions · {c} clicks", { p: dec1(e.position), i: num(e.impressions), c: num(e.clicks) })}${marketWords(e) ? ` · ${marketWords(e)}` : ""}`;
      case "low_ctr": return fill("{r}% click rate at position {p}; usual {u}%", { r: UI.dec(e.click_rate ?? 0), p: dec1(e.position), u: UI.dec(e.expected_rate ?? 0) });
      case "no_click": return fill("{i} impressions at position {p}, 0 clicks", { i: num(e.impressions), p: dec1(e.position) });
      case "compete": return (e.pages || []).slice(0, 2).map((p) => `${pathOf(p.page)} ${p.share}% (${t("pos.")} ${dec1(p.position)})`).join(" · ");
      case "query_down": return fill("Position {a} → {b} · {i} impressions", { a: dec1(e.position_before), b: dec1(e.position), i: num(e.impressions) });
      case "segment": return fill("{a} → {b} clicks; rest of site {c}", { a: num(e.clicks_before), b: num(e.clicks), c: signed(e.others_change) });
      case "unstable": return fill("Swings between position {a} and {b}, usually {p}", { a: dec1(e.better), b: dec1(e.worse), p: dec1(e.position) });
      case "brand_split": return fill("Non-brand {a} → {b} clicks; brand {c} → {d}", { a: num(e.other.clicks_before), b: num(e.other.clicks), c: num(e.brand.clicks_before), d: num(e.brand.clicks) });
      case "slide": return fill("Position {a} → {b}, slipping weekly for 8 weeks", { a: dec1(e.position_before), b: dec1(e.position) });
      case "page_near": return fill("{n} searches at positions 11–30 · {i} impressions", { n: num(e.queries_count), i: num(e.impressions) });
      case "no_page": return e.home ? fill("Only the home page ranks, at position {p} · {i} impressions", { p: dec1(e.position), i: num(e.impressions) }) : fill("Ranks via {page}, an off-topic page, at position {p}", { page: pathOf(e.page), p: dec1(e.position) });
      case "questions": return fill("{n} questions · {i} impressions", { n: num(e.queries_count), i: num(e.impressions) });
      case "topic": return fill("{n} searches · {i} impressions · average position {p}", { n: num(e.queries_count), i: num(e.impressions), p: dec1(e.position) });
      case "track": return fill("Position {p} · {i} impressions · {c} clicks", { p: dec1(e.position), i: num(e.impressions), c: num(e.clicks) });
      case "lead_page": return `${fill("{n} leads in {d} days", { n: UI.dec(e.leads), d: num(e.days) })}${e.percent !== undefined ? ` · ${fill("clicks {p}%", { p: signed(e.percent) })}` : ""}`;
      case "no_leads": return fill("{c} clicks, {s} visits, 0 leads in {d} days", { c: num(e.clicks), s: num(e.sessions), d: num(e.days) });
      case "duplicate": return fill("{n} addresses · {i} impressions", { n: num(e.count), i: num(e.impressions) });
      case "shown_broken": return `${fill("Shown {i} times this week", { i: num(e.impressions) })} · ${e.causes.map(cause).join(", ")}`;
      case "data_gaps": return [e.partial?.length ? fill("{n} days partly read", { n: num(e.partial.length) }) : "", e.verify ? fill("{n} days differ from Search Console", { n: num(e.verify.days) }) : ""].filter(Boolean).join(" · ");
      case "rank_drop": case "rank_rise": return fill("Search Console average {a}, last check {b}", { a: dec1(e.position), b: scrapedWord(e) });
      case "rival_passed": return (e.passed || []).map((r) => fill("{host} is now at position {p}, above you", { host: r.host, p: num(r.position) })).join(" · ");
      case "rival_gap": return fill("{host} at position {p}; you: {me}", { host: e.rivals?.[0]?.host || "", p: num(e.rivals?.[0]?.position ?? 0), me: scrapedWord(e) });
      case "striking": return fill("Search Console average {a}, last check {b}", { a: dec1(e.position), b: scrapedWord(e) });
      case "rank_no_click": return `${fill("{r}% click rate at position {p}; usual {u}%", { r: UI.dec(e.click_rate ?? 0), p: dec1(e.position), u: UI.dec(e.expected_rate ?? 0) })} · ${t(AI_WORDS[e.ai] || AI_WORDS["not-captured"])}`;
      case "page_switch": return fill("{s}% of clicks go to {a}; last check shows {b}", { s: num(e.share), a: pathOf(e.clicked_page), b: pathOf(e.ranking_page) });
      case "no_demand": return t("No impressions in 28 days.");
      case "task_result": case "note_result":
        if (!e.ready) return fill("Done {d}. Result on {r}.", { d: dayLabel(e.done), r: dayLabel(e.ready_on) });
        return `${verdictWord(e.verdict)} · ${fill("{a} → {b} clicks in 28 days", { a: num(e.before.clicks), b: num(e.after.clicks) })}${e.before.position !== null && e.after.position !== null ? ` · ${t("pos.")} ${dec1(e.before.position)} → ${dec1(e.after.position)}` : ""}`;
      default: return "";
    }
  }
  // Clickable page addresses come from page-links.js when it's loaded; plain text otherwise.
  const pageLink = (url, opts = {}) => (window.PageLink ? window.PageLink.html(url, opts) : `<span dir="auto">${esc(opts.text || url)}</span>`);
  const DEVICES = { MOBILE: "Mobile", DESKTOP: "Desktop", TABLET: "Tablet" };
  function segmentName(e) {
    if (!e.segment) return "";
    if (e.dim === "device") return t(DEVICES[e.segment] || e.segment);
    try { return new Intl.DisplayNames([UI.locale()], { type: "region" }).of(COUNTRIES[e.segment] || e.segment.toUpperCase()) || e.segment.toUpperCase(); } catch { return e.segment.toUpperCase(); }
  }
  // Google writes countries in three letters; the browser names them from two.
  const COUNTRIES = { fra: "FR", bel: "BE", che: "CH", can: "CA", are: "AE", gbr: "GB", usa: "US", esp: "ES", deu: "DE", ita: "IT", mar: "MA", dza: "DZ", tun: "TN", lux: "LU", nld: "NL", prt: "PT", sau: "SA", ind: "IN", pak: "PK", irl: "IE", aus: "AU", egy: "EG", qat: "QA", kwt: "KW", omn: "OM", bhr: "BH", sen: "SN", civ: "CI", cmr: "CM", rus: "RU", tur: "TR", pol: "PL", swe: "SE", nor: "NO", dnk: "DK", aut: "AT", grc: "GR", rou: "RO", bra: "BR", mex: "MX", chn: "CN", jpn: "JP", kor: "KR", sgp: "SG", phl: "PH", nga: "NG", zaf: "ZA", ken: "KE", lbn: "LB", jor: "JO", isr: "IL" };
  const verdictWord = (v) => t({ better: "Better", worse: "Worse", same: "About the same" }[v] || v);
  const leadsLine = (e) => (e.leads_at_stake >= 0.1 ? fill("≈ {n} leads a month", { n: UI.dec(Math.round(e.leads_at_stake * 10) / 10) }) : "");
  const cause = (code) => t({ noindex: "set to noindex", broken_pages: "answers with an error", server_errors: "server error", canonical_elsewhere: "points to another page", almost_no_text: "almost no text", link_broken: "broken link to it", link_redirect: "redirects" }[code] || code);
  const AI_WORDS = { overview: "AI Overview doesn't cite you", cited: "AI Overview cites you", none: "No AI Overview", "not-captured": "AI Overview not read" };
  // Under the "AI Overview" column, which names it once. French here, not in the dictionary: other screens already give these
  // short words a feminine French ("Citée", "Non lue") for other things, and an AI Overview is masculine.
  const AI_STATE = { overview: ["Not cited", "Non cité"], cited: ["Cited", "Cité"], none: ["None", "Aucun"], "not-captured": ["Not read", "Non lu"] };
  const scrapedWord = (e) => (e.scraped !== null && e.scraped !== undefined ? num(e.scraped) : e.depth ? `>${e.depth}` : "—");
  const pct = (v) => (v === null || v === undefined ? "" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(v))}%`);
  /* The numbers each kind has, for the table's columns. Whatever a kind doesn't know stays blank and shows "—", never 0. */
  function figures(f) {
    const e = f.evidence || {};
    const out = { impressions: e.impressions, clicks: e.clicks, position: e.position, before: e.position_before, change: "" };
    if (f.kind === "page_down" || f.kind === "page_up") out.change = e.percent === null || e.percent === undefined ? t("new") : pct(e.percent);
    else if (f.kind === "segment" || f.kind === "lead_page") out.change = pct(e.percent);
    else if (f.kind === "brand_split") { out.clicks = e.other?.clicks; out.change = pct(e.percent); }
    else if (f.kind === "decay") { out.clicks = e.last === undefined ? undefined : Math.round(e.last * 4); out.change = `−${num(e.below_peak)}%`; }
    else if (f.kind === "odd_day") out.change = e.usual ? pct(Math.round((e.clicks - e.usual) / e.usual * 100)) : "";
    else if (f.kind === "dropped_out") { out.clicks = undefined; out.change = t("gone"); }
    else if ((f.kind === "task_result" || f.kind === "note_result") && e.ready) { out.clicks = e.after?.clicks; out.impressions = e.after?.impressions; out.position = e.after?.position; out.before = e.before?.position; out.change = verdictWord(e.verdict); }
    return out;
  }
  /* The row's name: only what it's about. How much it moved is in the columns. */
  function subjectOf(f) {
    const e = f.evidence || {};
    if (f.kind === "odd_day") return esc(dayLabel(e.day, true));
    if (f.kind === "segment") return esc(segmentName(e));
    if (f.kind === "brand_split") return esc(t("Non-brand searches"));
    if (["topic", "data_gaps", "task_result", "note_result"].includes(f.kind)) return esc(titleOf(f));
    if (f.query) return esc(f.query);
    return f.page ? pageLink(f.page, { text: e.path || pathOf(f.page), host: f.host }) : esc(titleOf(f));
  }
  /* The line under the name holds only what no column can. */
  function factOf(f) {
    const e = f.evidence || {};
    switch (f.kind) {
      case "page_down": return t({ ranking: "Lost places", demand: "Fewer searches", appeal: "Lower click rate" }[e.why] || "");
      case "page_up": return t({ ranking: "Moved up", demand: "More searches", appeal: "Higher click rate" }[e.why] || "");
      case "almost": case "top3": return marketWords(e);
      case "no_click": case "query_down": case "decay": case "track": return "";
      case "no_page": return e.home ? t("Only the home page ranks") : fill("Ranks via {page}, an off-topic page", { page: pathOf(e.page) });
      case "page_near": return fill("{n} searches at positions 11–30", { n: num(e.queries_count) });
      case "questions": return fill("{n} questions", { n: num(e.queries_count) });
      case "topic": return fill("{n} searches", { n: num(e.queries_count) });
      case "duplicate": return fill("{n} addresses", { n: num(e.count) });
      case "shown_broken": return `${t("This week")} · ${e.causes.map(cause).join(", ")}`;
      case "segment": return fill("Rest of site: {c}", { c: signed(e.others_change) });
      case "slide": return t("Over 8 weeks");
      case "task_result": case "note_result": return e.ready ? "" : reasonOf(f);
      default: return reasonOf(f);
    }
  }
  const kindName = (f) => t(KIND[f.kind]?.name || f.kind);
  // Kinds about a page: the page is named on top already, so "Page that ranks" would say it twice.
  const PAGE_IS_SUBJECT = ["dropped_out", "page_down", "page_up", "decay", "lead_page", "no_leads", "duplicate", "shown_broken", "questions", "page_near", "task_result"];

  /* The sentence on top: why clicks moved, from the change breakdown. */
  function answer(change, many) {
    const e = change.evidence, host = many ? `${change.host}: ` : "";
    if (e.steady) return `${host}${fill("Clicks are steady: {a} in the last 28 days, {b} before.", { a: num(e.now.clicks), b: num(e.before.clicks) })}`;
    const up = e.change > 0;
    const head = fill(up ? "Clicks rose {p}% ({b} → {a})." : "Clicks fell {p}% ({b} → {a}).", { p: num(Math.abs(e.percent ?? 0)), a: num(e.now.clicks), b: num(e.before.clicks) });
    const impressions = e.before.impressions ? Math.round((e.now.impressions - e.before.impressions) / e.before.impressions * 100) : null;
    const demand = impressions === null ? "" : ` ${fill(impressions >= 0 ? "Impressions rose {p}%." : "Impressions fell {p}%.", { p: num(Math.abs(impressions)) })}`;
    const ex = e.explains || [];
    const named = ex.length === 1 ? fill("Mostly one page: {page}, {n} clicks.", { page: ex[0].path, n: signed(ex[0].change) })
      : ex.length ? fill("Most of it: {list}.", { list: ex.map((p) => `${p.path} ${signed(p.change)}`).join(", ") })
      : e.main && e.main !== "hidden" ? fill("Mostly: {what} ({n} clicks).", { what: t(PARTS[e.main][up ? 0 : 1]).toLowerCase(), n: signed(e.parts[e.main]) }) : "";
    return `${host}${head}${demand}${named ? ` ${named}` : ""}`;
  }
  /* The same answer on screen: badges and one row per page, never one packed sentence (owner, 2026-11-12).
     answer() stays as plain text for places that need one line. Rows only when no page lists follow below. */
  function answerHtml(change, many) {
    const e = change.evidence, host = many ? `<span class="in-ans-host">${esc(change.host)}</span>` : "";
    const badge = (good, text, neutral) => `<span class="${neutral ? "sec" : good ? "good" : "crit"} d-pill">${neutral ? "" : icon(good ? "arrow-up" : "arrow-down")}${text}</span>`;
    if (e.steady) return `<div class="ov-answer" dir="auto"><span class="ov-ans-head">${host}${badge(true, t("Steady"), true)}<span>${t("Clicks")} <b>${num(e.before.clicks)} → ${num(e.now.clicks)}</b></span></span></div>`;
    const up = e.change > 0;
    const imp = e.before.impressions ? Math.round((e.now.impressions - e.before.impressions) / e.before.impressions * 100) : null;
    const head = `<span class="ov-ans-head">${host}${badge(up, `${num(Math.abs(e.percent ?? 0))}%`)}<span>${t("Clicks")} <b>${num(e.before.clicks)} → ${num(e.now.clicks)}</b></span>${imp === null ? "" : `<span class="in-ans-imp">${badge(imp >= 0, `${num(Math.abs(imp))}%`, imp === 0)}<span>${t("Impressions")}</span></span>`}</span>`;
    const ex = many ? e.explains || [] : [];
    const top = Math.max(1, ...ex.map((p) => Math.abs(p.change)));
    const rows = ex.length ? `<span class="ov-ans-label">${t(up ? "Biggest gains" : "Biggest losses")}</span><ul class="ov-ans-list">${ex.map((p) => `<li><span class="ov-ans-name">${pageLink(p.page, { text: p.path })}</span><span class="ov-ans-bar" aria-hidden="true"><i class="${p.change < 0 ? "down" : "up"}" style="width:${Math.max(4, Math.round(Math.abs(p.change) / top * 100))}%"></i></span><b class="${p.change < 0 ? "down" : "up"}">${signed(p.change)}</b></li>`).join("")}</ul>` : "";
    const cause = many && !ex.length && e.main && e.main !== "hidden" ? `<span class="in-ans-cause"><span class="ov-ans-label">${t("Main cause")}</span>${esc(t(PARTS[e.main][up ? 0 : 1]))} <b class="${e.parts[e.main] < 0 ? "down" : "up"}">${signed(e.parts[e.main])}</b></span>` : "";
    return `<div class="ov-answer" dir="auto">${head}${rows}${cause}</div>`;
  }
  /* Two ranked lists with bars from a centre line: lost to the left, gained to the right, so size reads at a glance. */
  function barList(rows) {
    const top = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
    return `<ul class="in-bars">${rows.map((r) => `<li class="in-bar-row${r.quiet ? " quiet" : ""}"><span class="in-bar-label"${r.tip ? ` title="${esc(r.tip)}"` : ""}>${r.label}</span><span class="in-bar" aria-hidden="true"><i class="${r.value < 0 ? "down" : "up"}" style="width:${Math.max(2, Math.round(Math.abs(r.value) / top * 50))}%"></i></span><b class="${r.value < 0 ? "down" : "up"}">${signed(r.value)}</b></li>`).join("")}</ul>`;
  }
  function moveLists(change) {
    const e = change.evidence, up = e.change > 0;
    const parts = Object.entries(e.parts).filter(([, v]) => Math.round(v));
    const named = parts.filter(([id]) => id !== "hidden").sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const why = [...named, ...parts.filter(([id]) => id === "hidden")].map(([id, v]) => ({ label: `${esc(t(PARTS[id][v > 0 ? 0 : 1]))}${id === "hidden" ? UI.tip(HIDDEN_TIP) : ""}`, tip: id === "hidden" ? "" : t(PARTS[id][v > 0 ? 0 : 1]), value: v, quiet: id === "hidden" }));
    const pages = (e.pages || []).map((p) => ({ label: pageLink(p.page, { text: p.path, host: change.host }), value: p.change }));
    return `<div class="in-lists">${pages.length ? `<div><h3 class="ov-h3">${t("Which pages moved")}</h3>${barList(pages)}</div>` : ""}
      <div><h3 class="ov-h3">${t("Why")}</h3>${barList(why)}<button class="link-btn in-see" data-in-open="${change.id}">${t(up ? "See what gained" : "See what lost")}</button></div></div>`;
  }
  /* The last 28 days over the 28 before, day against day, so the gap between the lines is the change. */
  function graph(days, change) {
    if (!days?.length || !window.LV?.lineChart) return "";
    const from = change.evidence.from, shift = (iso) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 28); return d.toISOString().slice(0, 10); };
    const clicks = Object.fromEntries(days.map((p) => [p.day, p.clicks]));
    const now = days.map((p) => p.day).filter((d) => d >= from);
    return `<div class="in-graph">${window.LV.lineChart("insights-clicks", now, [{ name: "Last 28 days", color: "var(--ch-1)", values: Object.fromEntries(now.map((d) => [d, clicks[d] ?? null])) }, { name: "28 days before", color: "var(--muted)", values: Object.fromEntries(now.map((d) => [d, clicks[shift(d)] ?? null])), dash: true }])}</div>`;
  }
  function topBlock(s) {
    const changes = s.changes || [];
    if (!changes.length) return "";
    if (changes.length > 1) return `<div class="in-answer">${changes.slice(0, 3).map((c) => answerHtml(c, true)).join("")}</div>`;
    const c = changes[0], steady = c.evidence.steady;
    return `<section class="card in-top${steady ? " steady" : ""}"><div class="in-top-lead"><div class="in-answer">${answerHtml(c, false)}${weeklyBlock(c)}</div>${graph(s.days, c)}</div>${steady ? "" : moveLists(c)}</section>`;
  }

  // ---- what to do: one fixed line per kind -----------------------------------------------------------
  const DO = {
    page_down: "Check the page works and hasn't changed, then see which searches lost places.",
    dropped_out: "Check it loads and isn't noindex, then request indexing in Search Console.",
    decay: "Update the page: new facts, this year's numbers, a fuller answer to its main search.",
    odd_day: "Check the site was up and unchanged that day. A one-off needs nothing.",
    almost: "Put the search in the title and H1, and cover what the pages above cover.",
    top3: "Rewrite the title and description to win clicks, and cover what the top 3 cover.",
    low_ctr: "Rewrite the title and description to answer this search plainly.",
    no_click: "Rewrite the title and description to match what searchers want.",
    compete: "Pick one page for this search, improve it, and link the other to it, or merge them.",
    query_down: "Compare with the pages that passed yours, and add what they cover.",
    segment: "Open that country or device in Overview to see which pages fell.",
    unstable: "Make one page the clear answer: search in its title and H1, links from related pages.",
    brand_split: "Check non-brand searches in Overview: brand traffic hides a loss.",
    slide: "Refresh the page and link to it from your other pages.",
    page_near: "Improve this one page: it lifts all these searches at once.",
    no_page: "Write a page for it, or a clear section on the page that ranks.",
    questions: "Answer these questions on the page, in a short FAQ or headings.",
    topic: "Write one strong page on this topic and link to it from the others.",
    track: "Add it to Keywords to follow its rank.",
    lead_page: "Fix this page first, it brings leads: see what changed and which searches it lost.",
    no_leads: "Make the next step clear: a form, a phone number, one plain call to action.",
    duplicate: "Point the other addresses to one with a redirect or a canonical tag.",
    shown_broken: "Fix the page: Google keeps showing it, so visitors land on an error.",
    data_gaps: "Read those days again from Overview, with Matches Search Console.",
    rank_drop: "Check the page works and what changed, then see who is above it now.",
    rank_rise: "See what changed here, and repeat it on similar pages.",
    rival_passed: "Compare that rival's page: what it covers that yours doesn't, and when it changed.",
    rival_gap: "Build or strengthen a page for it, with theirs as the bar.",
    striking: "Improve this page and link to it from your strongest pages.",
    page_switch: "Pick the page that should win. Link to it from the other, and match its title.",
    no_demand: "If it doesn't matter, stop checking it to save search credits.",
  };
  // Ranked but not clicked: the cause depends on what the page of results held, and is only said when it was read.
  const NO_CLICK_DO = {
    overview: "The AI Overview takes these clicks. Answer plainly on the page so it cites you.",
    cited: "The AI Overview cites you but takes most clicks. Give the title a reason to click.",
    none: "No AI Overview, so the title is the likely problem. Rewrite it and the description.",
    "not-captured": "Cause unknown: this check can't read AI Overviews. Look by hand, or check with SerpApi.",
  };
  /* What the page itself says, when the reader has read it: only ever said when it's true. */
  function onPageLine(f) {
    const o = f.evidence?.on_page;
    if (!o) return "";
    if (!o.title && !o.h1) return t("The search isn't in the title or H1: put it there first.");
    if (!o.title) return t("The search isn't in the title.");
    if (!o.h1) return t("The search isn't in the H1.");
    return t("The search is already in the title and H1.");
  }
  const doLine = (f) => (f.kind === "rank_no_click" ? t(NO_CLICK_DO[f.evidence?.ai] || NO_CLICK_DO["not-captured"]) : DO[f.kind] ? t(DO[f.kind]) : "");
  function doBlock(f) {
    const line = doLine(f), page = onPageLine(f);
    if (!line && !page) return "";
    return `<div class="in-do"><h3 class="ov-h3">${t("What to do")}</h3>${page ? `<p class="small in-do-page">${icon("file-text")}${esc(page)}</p>` : ""}${line ? `<p class="small">${esc(line)}</p>` : ""}</div>`;
  }
  // A position in the site's target countries comes with the world's beside it.
  const countryName = (code3) => { const two = COUNTRIES[code3] || (code3 || "").slice(0, 2).toUpperCase(); try { return new Intl.DisplayNames([UI.locale()], { type: "region" }).of(two) || two; } catch { return two; } };
  const marketWords = (e) => (e.countries?.length && e.world_position !== undefined ? fill("in {c}; worldwide {p}", { c: e.countries.map(countryName).join(", "), p: dec1(e.world_position) }) : "");

  // ---- target countries: whose searches the quick wins read --------------------------------------
  const C = { site: null, data: null, busy: false };
  function countriesLine() {
    const site = UI.siteIdPicked();
    if (!site || !window.COMP?.server) return "";
    if (C.site !== site && !C.busy) {
      C.busy = true; C.site = site;
      window.COMP.api("GET", `search/countries?site_id=${site}`).then((d) => { C.data = d; }).catch(() => { C.data = null; }).finally(() => { C.busy = false; redraw(); });
    }
    const d = C.site === site ? C.data : null;
    if (!d) return "";
    const names = d.countries.length ? d.countries.map((c) => countryName(c.key)).join(", ") : t("not set");
    return `<span class="ov-dot" aria-hidden="true">·</span><span>${t(d.chosen ? "Countries" : "Countries (by clicks)")}: ${esc(names)} <button class="link-btn" data-in-countries>${fr() ? "Modifier" : "Change"}</button></span>`;
  }
  function countriesPanel(opener) {
    const d = C.data;
    if (!d) return;
    const picked = new Set(d.countries.map((c) => c.key));
    const options = [...new Map([...d.countries.map((c) => [c.key, { key: c.key, clicks: null }]), ...d.top.map((c) => [c.key, c])]).values()];
    const rows = options.map((c) => `<label class="check-row"><input type="checkbox" name="f_country" value="${esc(c.key)}" ${picked.has(c.key) ? "checked" : ""}> <span>${esc(countryName(c.key))}</span>${c.clicks !== null && c.clicks !== undefined ? `<span class="muted small">${num(c.clicks)} ${t("clicks")}</span>` : ""}</label>`).join("");
    UI.openPanel(`${UI.panelHead(t("Target countries"), t("Quick wins and Keywords read only these countries"))}<div class="panel-body">
      <form id="in-countries-form"><p class="small muted">${fill("Up to {n}.", { n: num(d.most) })}${UI.tip("None ticked: the top country by clicks, plus the second when it brings a quarter as many.")}</p>
        <div class="in-countries">${rows || `<p class="muted">${t("No country data yet.")}</p>`}</div>
        <p class="error" data-in-countries-error hidden></p>
        <div class="panel-actions"><button class="btn btn-main" type="submit">${t("Save")}</button></div></form></div>`, opener);
  }

  // ---- the page -----------------------------------------------------------------------------------
  function page() {
    const entry = load();
    const run = `<button class="btn" data-in-run>${icon("refresh-cw")}${t("Run again")}</button>`;
    const head = UI.topbar(t("Insights"), t("Worked out daily from your Search Console data"), entry.data?.summary?.ran_at ? run : "", false);
    const wrap = (body) => `${head}<div class="content page-enter in">${body}</div>`;
    if (entry.loading) return wrap(UI.skeleton ? UI.skeleton("page", { tiles: 3, chart: false }) : `<section class="card" aria-busy="true"><div class="empty"><p>${t("Loading…")}</p></div></section>`);
    if (entry.noServer) return wrap(`<section class="card"><div class="empty"><h3>${t("Needs the running app")}</h3><p>${t("Opened as a file: no real data.")}</p></div></section>`);
    if (entry.error) return wrap(UI.failCard ? UI.failCard(entry.error, { retry: "data-in-retry" }) : `<section class="card"><div class="empty"><h3>${t("That didn't load")}</h3><p>${esc(t(entry.error))}</p><div class="ov-empty-act"><button class="btn" data-in-retry>${t("Try again")}</button></div></div></section>`);
    const d = entry.data, s = d.summary;
    // No site yet: the server has nothing to sum up (F199).
    if (!s) return wrap(`<section class="card"><div class="empty"><h3>${t("No site yet")}</h3><p>${t("Add a site and connect Search Console to get insights.")}</p><div class="ov-empty-act"><button class="btn btn-main" data-lv-add-site>${t("Add a site")}</button></div></div></section>`);
    if (!s.ran_at) return wrap(`<section class="card"><div class="empty"><h3>${t("Nothing worked out yet")}</h3><p>${t("They run daily on their own. Run them now to see the first ones.")}</p><div class="ov-empty-act"><button class="btn btn-main" data-in-run>${icon("refresh-cw")}${t("Run")}</button></div></div></section>`);
    const changes = s.changes || [];
    aiSettings();
    const top = topBlock(s);
    const figs = `<div class="in-figs">
      <div class="in-fig"><div class="lab">${t("To recover")}</div><div class="fig">${num(s.to_recover ?? 0)}</div><div class="sub">${t("clicks a month")}</div></div>
      <div class="in-fig"><div class="lab">${t("To win")}</div><div class="fig">${num(s.to_win ?? 0)}</div><div class="sub">${t("clicks a month")}</div></div>
      <div class="in-fig"><div class="lab">${t("Fixed in 30 days")}</div><div class="fig">${num(s.fixed)}</div><div class="sub">${t("findings")}</div></div>
    </div>`;
    const trust = `<p class="ov-trust small" role="status"><span>${icon("clock")}${esc(updated(s.ran_at))}</span><span class="ov-dot" aria-hidden="true">·</span><span>${t("Final days only, last 28 days vs the 28 before")}</span>${countriesLine()}</p>`;
    return wrap(`${trust}${top}${figs}${tabsCard(d)}`);
  }

  function tabsCard(d) {
    const counts = d.counts || {};
    const needs = d.summary.needs || {};
    const shownTabs = TABS.filter(([id]) => id !== "leads" || counts.leads?.open || (needs.lead_page && needs.lead_page !== "ga4") || (!needs.lead_page && d.summary.ran_at));
    if (!shownTabs.some(([id]) => id === IN.tab)) IN.tab = "first";
    const tabs = `<div class="tabs" role="tablist" aria-label="${t("Insights")}">${shownTabs.map(([id, name]) => {
      const n = id === "first" ? null : counts[id]?.open;
      return `<button class="tab" role="tab" data-in-tab="${id}" aria-selected="${IN.tab === id}">${t(name)}${n ? ` <span class="in-count">${num(n)}</span>` : ""}</button>`;
    }).join("")}</div>`;
    const controls = `<div class="ov-controls">${d.rows.length ? TP.search(PAGES, t("Search findings")) : ""}<label class="ov-show"><span>${t("Show")}</span><select class="select" data-in-status>${STATUSES.map(([id, name]) => `<option value="${id}" ${IN.status === id ? "selected" : ""}>${t(name)}</option>`).join("")}</select></label></div>`;
    const notes = [];
    if (IN.tab === "wins" && needs.low_ctr === "brand_words") notes.push(`${t("Low click rates need your brand words.")}${UI.tip("Brand searches are clicked far more and would make every other query look weak.")} <a href="#overview">${t("Add them on Overview")}</a>`);
    if ((IN.tab === "decline" && needs.decay) || (IN.tab === "changed" && needs.page_down)) notes.push(t("Needs more history: 16 weeks for slow decline, 8 for changes."));
    if (IN.tab === "leads" && needs.lead_page === "key_events") notes.push(t("No GA4 key events yet: mark your form or call event as one."));
    if (IN.tab === "changed" && needs.brand_split === "brand_words") notes.push(`${t("Add brand words to see when brand hides a loss.")} <a href="#overview">${t("Add them on Overview")}</a>`);
    const hint = {
      first: "Biggest findings, one row per query or page.", mix: "Rank checks beside Search Console: what neither shows alone.", changed: "Last 28 days vs the 28 before, plus odd days this week.",
      decline: "Pages and searches sliding a little every week.", wins: "Searches worth a small push, by your own click rates.",
      leads: "Search clicks joined with GA4's key events over 90 days.", technical: "Addresses, broken pages and missing days, from Search Console.",
      impact: "Done tasks and dated notes, before vs after.",
    }[IN.tab];
    const HINT_TIPS = { impact: "28 days before against 28 days starting a week after." };
    return `<section class="card ov-tabs-card"><div class="card-head ov-tabs-head">${tabs}</div>${controls}
      <p class="small muted ov-hint">${t(hint)}${UI.tip(HINT_TIPS[IN.tab] || "")}</p>${notes.map((n) => `<p class="small ov-hint in-need">${n}</p>`).join("")}${IN.tab === "mix" ? mixTab(d) : table(d.rows)}</section>`;
  }

  function table(all) {
    if (!all.length) return `<div class="empty"><p>${t(IN.status === "open" ? "Nothing here. Good news." : "Nothing here.")}</p></div>`;
    const many = !UI.siteIdPicked();
    // The server ranks by clicks a month at stake, biggest first; the heading turns it round.
    const found = all.filter((f) => TP.matches(PAGES, titleOf(f), reasonOf(f), kindName(f), many ? f.host : ""));
    if (!found.length) return `<div class="empty"><p>${t("No finding matches this search.")}</p><button class="btn" data-in-search-clear>${t("Clear search")}</button></div>`;
    const rows = IN.sortDir === "asc" ? [...found].sort((a, b) => (a.at_stake || 0) - (b.at_stake || 0)) : found;
    const view = TP.view(PAGES, rows);
    const body = view.rows.map((f) => {
      const n = figures(f);
      return `<tr class="ov-row" data-in-open="${f.id}" tabindex="0">
      <td class="head-cell" data-label="${t("What")}">${tagLine(f, many)}<div class="t" dir="auto">${subjectOf(f)}</div>${factLine(f)}</td>
      ${countCell("Impressions", n.impressions)}${countCell("Clicks", n.clicks)}
      <td class="ov-n in-pos" data-label="${t("Position")}">${numCell(posBadge(n.position), cellChange(n.position, n.before, true))}</td>
      <td class="ov-n" data-label="${changeWord()}">${n.change ? esc(n.change) : "—"}</td>
      ${stakeCell(f)}${arrowCell()}</tr>`;
    }).join("");
    return `<div class="table-wrap ov-table in-table"><table class="data"><thead><tr><th scope="col">${t("What")}</th><th class="ov-n in-opt" scope="col">${t("Impressions")}</th><th class="ov-n" scope="col">${t("Clicks")}</th><th class="ov-n in-pos" scope="col">${t("Position")}</th><th class="ov-n" scope="col">${changeWord()}</th>${sortHead()}<th class="in-act-col" scope="col"><span class="sr">${t("Open")}</span></th></tr></thead><tbody>${body}</tbody></table></div>
      ${TP.footer(PAGES, view, { noun: t(IN.tab === "first" ? "biggest findings" : view.total === 1 ? "finding" : "findings") })}`;
  }
  // Shared with the Search table: a value and its change in a fixed slot, so changes line up down the column.
  const numCell = (...a) => window.OV_CELLS.numCell(...a), cellChange = (...a) => window.OV_CELLS.cellChange(...a), posBadge = (...a) => window.OV_CELLS.posBadge(...a);
  const known = (v) => v !== null && v !== undefined;
  const changeWord = () => (fr() ? "Variation" : "Change"); // "Change" as a word to translate is the link beside the countries: "Modifier"
  const countCell = (label, v) => `<td class="ov-n${label === "Impressions" ? " in-opt" : ""}" data-label="${t(label)}">${known(v) ? num(v) : "—"}</td>`;
  const stakeCell = (f) => `<td class="ov-n ov-sorted in-stake-col" data-label="${t("Clicks a month")}"><span class="ov-v">${f.at_stake >= 1 ? num(Math.round(f.at_stake)) : "—"}</span></td>`;
  const arrowCell = () => `<td class="in-act-col" aria-hidden="true">${icon("chevron-right")}</td>`;
  const sortHead = () => `<th class="ov-n ov-sorted" scope="col" aria-sort="${IN.sortDir === "asc" ? "ascending" : "descending"}"><button type="button" class="th-btn" data-in-sort>${t("Clicks a month")}${icon(IN.sortDir === "asc" ? "arrow-up" : "arrow-down")}</button></th>`;
  // A rank-and-clicks row whose Search Console position is the all-countries one (not the keyword's own country).
  const worldWide = (f) => MIX_KINDS.has(f.kind) && f.evidence?.same_country === false && f.kind !== "no_demand";
  function tagLine(f, many) {
    const e = f.evidence || {};
    const tags = [`<span class="in-kind">${esc(kindName(f))}</span>`];
    if (e.confirmed === false) tags.push(`<span class="in-season" data-tip="${t("One rank check only. Check again before acting.")}" tabindex="0">${t("Check it")}</span>`);
    if (e.seasonal) tags.push(`<span class="in-season">${t("Seasonal")}</span>`);
    if (worldWide(f)) tags.push(`<span class="in-world" role="img" title="${esc(t("Search Console position, all countries"))}" aria-label="${esc(t("Search Console position, all countries"))}">${icon("globe")}</span>`);
    if (f.task) tags.push(`<span class="in-task">${icon("square-check")}${t(f.task === "done" ? "Task done" : "Task open")}</span>`);
    if (many) tags.push(`<span class="muted small">${esc(f.host)}</span>`);
    return `<div class="in-what">${tags.join("")}</div>`;
  }
  const factLine = (f) => { const fact = MIX_KINDS.has(f.kind) ? "" : factOf(f); return fact ? `<div class="s muted small" dir="auto">${esc(fact)}</div>` : ""; };

  // ---- Rank and clicks: rank checks beside Search Console ---------------------------------------------
  function mixIntro(d) {
    const c = d.coverage || {};
    const count = (...kinds) => d.rows.filter((f) => kinds.includes(f.kind)).length;
    const drops = count("rank_drop"), rivals = count("rival_passed", "rival_gap");
    const dropWords = drops === 1 ? "One looks like a fresh drop" : fill("{a} look like fresh drops", { a: num(drops) });
    const clause = drops && rivals ? ` ${t(dropWords)}${fill(", and rivals lead on {b} that people really search.", { b: num(rivals) })}`
      : drops ? ` ${t(dropWords)}.` : rivals ? fill(" Rivals lead on {b} that people really search.", { b: num(rivals) }) : "";
    const oldest = c.oldest_days === null || c.oldest_days === undefined ? "" : ` ${c.oldest_days <= 1 ? t("Oldest: a day or less.") : fill("Oldest {n} days.", { n: num(c.oldest_days) })}`;
    const world = d.rows.filter(worldWide).length;
    const worldLine = world ? `<p class="small muted in-world-line">${icon("globe")}<span>${esc(world === 1 ? t("1 uses all-country positions") : fill("{n} use all-country positions", { n: num(world) }))}</span></p>` : "";
    const thin = c.recent * 2 < c.tracked ? `<p class="small ov-hint in-need">${t("Short list: most rank checks are old or missing.")}${UI.tip("It's short because of the data, not because all is well.")}</p>` : "";
    return `<div class="in-mix-head"><p class="in-mix-answer" dir="auto">${esc(fill("Of {a} tracked keywords, {b} have Search Console data.", { a: num(c.tracked), b: num(c.with_search) }))}${esc(clause)}</p>${worldLine}
      <p class="small muted">${esc(fill("Rankings checked: {a} of {b} in the last {d} days.", { a: num(c.recent), b: num(c.tracked), d: num(c.fresh_days) }))}${esc(oldest)} <a href="#keywords">${t("Refresh in Keywords")}</a></p></div>${thin}`;
  }
  const scrapedCell = (e) => {
    if (known(e.scraped)) return posBadge(e.scraped);
    return e.depth ? `<span class="pos pos-none" data-tip="${t("Not found in the results checked")}" tabindex="0">&gt;${num(e.depth)}</span>` : "—";
  };
  function mixExtra(col, f) {
    const e = f.evidence || {};
    if (col === "moved") return known(e.scraped) && known(e.was) ? numCell(posBadge(e.was), cellChange(e.scraped, e.was, true)) : `<span class="muted">${t(e.confirmed === false ? "One check only" : "—")}</span>`;
    if (col === "ai") { const k = AI_WORDS[e.ai] ? e.ai : "not-captured"; return `<span title="${esc(t(AI_WORDS[k]))}">${esc(AI_STATE[k][fr() ? 1 : 0])}</span>`; }
    if (col === "page") return e.ranking_page ? `<div class="in-pages"><div><span class="muted small">${t("Shown")}</span> ${pageLink(e.ranking_page, { text: pathOf(e.ranking_page), host: f.host })}</div><div><span class="muted small">${t("Clicked")}</span> ${pageLink(e.clicked_page, { text: pathOf(e.clicked_page), host: f.host })}</div></div>` : "—";
    const list = e.passed?.length ? e.passed : e.rivals || [];
    return list.length ? `<div class="in-above">${list.slice(0, 2).map((r) => `<span>${UI.siteLogo ? UI.siteLogo(r.host, 16) : ""}<span dir="auto">${esc(r.host)}</span> <b>${num(r.position)}</b></span>`).join("")}</div>` : "—";
  }
  function mixTab(d) {
    const c = d.coverage || {};
    if (!c.tracked) return `<div class="empty"><h3>${t("No tracked keywords yet")}</h3><p>${t("Add keywords and check them.")}${UI.tip("This tab reads those checks beside Search Console.")}</p><div class="ov-empty-act"><a class="btn btn-main" href="#keywords">${t("Open Keywords")}</a></div></div>`;
    if (!c.checked) return `<div class="empty"><h3>${t("No rank checks yet")}</h3><p>${t("Press Refresh in Keywords.")}${UI.tip("This tab spends no credits of its own: it only reads what is saved.")}</p><div class="ov-empty-act"><a class="btn btn-main" href="#keywords">${t("Open Keywords")}</a></div></div>`;
    const inChip = (chip, f) => !chip[2] || chip[2].includes(f.kind);
    let chip = MIX_CHIPS.find(([id]) => id === IN.mixChip) || MIX_CHIPS[0];
    const chips = `<div class="chips in-mix-chips" role="group" aria-label="${t("Filter findings")}">${MIX_CHIPS.map((x) => { const n = d.rows.filter((f) => inChip(x, f)).length; return n || x[0] === chip[0] ? `<button class="chip" data-in-mix="${x[0]}" aria-pressed="${x[0] === chip[0]}">${t(x[1])}<b>${num(n)}</b></button>` : ""; }).join("")}</div>`;
    const many = !UI.siteIdPicked(), col = chip[3];
    const found = d.rows.filter((f) => inChip(chip, f) && TP.matches(PAGES, f.query || "", kindName(f), reasonOf(f), many ? f.host : ""));
    const head = `${mixIntro(d)}${chips}`;
    if (!found.length) return `${head}<div class="empty"><p>${t(d.rows.length ? "No finding matches this search." : IN.status === "open" ? "Nothing here. Good news." : "Nothing here.")}</p></div>`;
    const rows = IN.sortDir === "asc" ? [...found].sort((a, b) => (a.at_stake || 0) - (b.at_stake || 0)) : found;
    const view = TP.view(PAGES, rows);
    const colName = { above: "Who's above", moved: "Before", ai: "AI Overview", page: "Pages" }[col];
    const body = view.rows.map((f) => {
      const e = f.evidence || {};
      return `<tr class="ov-row" data-in-open="${f.id}" tabindex="0">
      <td class="head-cell" data-label="${t("Keyword")}">${tagLine(f, many)}<div class="t" dir="auto">${esc(f.query || "")}</div></td>
      ${countCell("Impressions", e.impressions)}${countCell("Clicks", e.clicks)}
      <td class="ov-n" data-label="${t("Search Console")}">${posBadge(e.position)}</td>
      <td class="ov-n" data-label="${t("Last check")}">${scrapedCell(e)}</td>
      ${col ? `<td class="in-extra" data-label="${t(colName)}">${mixExtra(col, f)}</td>` : ""}
      ${stakeCell(f)}${arrowCell()}</tr>`;
    }).join("");
    return `${head}<div class="table-wrap ov-table in-table in-mix-table"><table class="data"><thead><tr><th scope="col">${t("Keyword")}</th><th class="ov-n in-opt" scope="col">${t("Impressions")}</th><th class="ov-n" scope="col">${t("Clicks")}</th><th class="ov-n" scope="col">${t("Search Console")}</th><th class="ov-n" scope="col">${t("Last check")}</th>${col ? `<th class="in-extra" scope="col">${t(colName)}</th>` : ""}${sortHead()}<th class="in-act-col" scope="col"><span class="sr">${t("Open")}</span></th></tr></thead><tbody>${body}</tbody></table></div>
      ${TP.footer(PAGES, view, { noun: t(view.total === 1 ? "finding" : "findings") })}`;
  }
  function mixEvidence(f) {
    const e = f.evidence || {};
    const li = (label, value, tip = "") => `<li><div class="what"><div class="t">${esc(t(label))}${UI.tip(tip)}</div></div><span>${value}</span></li>`;
    const rows = [
      li(e.same_country ? "Search Console position, same country" : "Search Console position, all countries", known(e.position) ? dec1(e.position) : "—"), li("Last check", esc(scrapedWord(e))),
      known(e.was) ? li("Previous check", num(e.was)) : "", li("Impressions", known(e.impressions) ? num(e.impressions) : "—"), li("Clicks", known(e.clicks) ? num(e.clicks) : "—"),
      known(e.click_rate) ? li("Click rate", `${UI.dec(e.click_rate)}%`) : "", known(e.expected_rate) ? li("Usual rate", `${UI.dec(e.expected_rate)}%`, USUAL_TIP) : "",
    ].join("");
    const how = `<p class="small muted">${esc(fill("Checked {d} with {tool} from {place}, top {n}.", { d: dayLabel((e.checked || "").slice(0, 10)), tool: e.tool || "", place: e.location || "—", n: num(e.depth ?? 0) }))}</p>`;
    const pages = e.clicked_page ? `<h3 class="ov-h3">${t("Pages")}</h3><ul class="rows ov-split">${li("Shown", pageLink(e.ranking_page, { text: pathOf(e.ranking_page), host: f.host }))}${li("Clicked", pageLink(e.clicked_page, { text: pathOf(e.clicked_page), host: f.host }))}</ul>` : "";
    const results = e.results?.length ? `<h3 class="ov-h3">${t("Who ranks for it")}</h3><ul class="rows ov-split in-serp">${e.results.map((r) => `<li class="${r.mine ? "mine" : ""}"><div class="what"><div class="t" dir="auto">${UI.siteLogo ? UI.siteLogo(r.host, 16) : ""} ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.host)}</a>` : esc(r.host) /* Google gave the site, not the page */}${r.mine ? ` <span class="in-tag">${t("You")}</span>` : r.rival ? ` <span class="in-tag">${t("Followed rival")}</span>` : ""}</div></div><span>${num(r.position)}</span></li>`).join("")}</ul>` : "";
    const also = e.also?.length ? `<p class="small muted">${t("Also")}: ${e.also.map((k) => esc(t(KIND[k]?.name || k))).join(", ")}</p>` : "";
    return `<ul class="rows ov-split">${rows}</ul>${how}${pages}${results}${also}`;
  }

  // ---- AI, on a click only ------------------------------------------------------------------------
  const AI_ASK = { explain: "Explain", titles: "Suggest titles", brief: "Write a brief", faq: "Write an FAQ", compete: "Which page to keep", weekly: "AI summary" };
  const MODEL_NAMES = { "claude-haiku-5-5": "Claude Haiku 5.5", "claude-sonnet-5-5": "Claude Sonnet 5.5" };
  const aiReady = (provider) => Boolean(IN.ai?.keys?.[provider]);
  // Headings a brief marks with ## or ### show bold, without the marks; every line is escaped like everything else.
  const aiText = (words) => words.split("\n").map((line) => {
    const m = line.match(/^\s*(#{2,3})\s+(.*)$/);
    return m ? `<b class="in-ai-h${m[1].length}">${esc(m[2])}</b>` : esc(line);
  }).join("\n");
  function aiAnswer(purpose, answer) {
    const by = answer.provider === "claude" ? MODEL_NAMES[answer.model] || answer.model : t("a free model");
    const cost = answer.cost ? ` · $${answer.cost < 0.01 ? answer.cost.toFixed(4) : answer.cost.toFixed(2)}` : "";
    return `<div class="in-ai-answer" data-in-ai-box="${purpose}"><p class="in-ai-label">${icon("sparkles")}${t("Written by AI")} · ${esc(by)}${cost}</p>
      <div class="in-ai-text" dir="auto">${aiText(answer.text)}</div>
      <div class="in-ai-acts"><button class="link-btn" data-in-ai-copy="${purpose}">${t("Copy")}</button><button class="link-btn" data-in-ai="${purpose}" data-in-ai-again="1">${t("Ask again")}</button></div></div>`;
  }
  const aiBlock = (f) => (f.ai?.purposes?.length ? `<section class="in-ai-wrap" data-in-ai-wrap>${aiInner(f)}</section>` : "");
  function aiInner(f) {
    const info = f.ai;
    const lang = UI.state.lang === "fr" ? "fr" : "en";
    const kept = info.kept?.[lang] || {};
    if (info.provider === "none") return `<h3 class="ov-h3">${t("With AI")}</h3><p class="small muted">${t("No AI chosen yet, so nothing is sent. Pick one in Settings → AI.")} <a href="#settings">${t("Open Settings")}</a></p>`;
    const ready = aiReady(info.provider);
    const head = `<h3 class="ov-h3">${t("With AI")} <span class="muted small">${t(info.provider === "claude" ? "Claude (Anthropic key)" : "Free models (OpenRouter)")}</span></h3>`;
    if (!ready && !Object.keys(kept).length) return `${head}<p class="small muted">${t(info.provider === "claude" ? "Paste an Anthropic key in Settings to use Claude here." : "Connect OpenRouter in Settings, or pick Claude for this site.")} <a href="#settings">${t("Open Settings")}</a></p>`;
    const buttons = info.purposes.filter((p) => !kept[p]).map((p) => `<button class="btn btn-small" data-in-ai="${p}" ${ready ? "" : "disabled"}>${icon("sparkles")}${t(AI_ASK[p])}</button>`).join("");
    return `${head}<div class="in-ai">${info.purposes.filter((p) => kept[p]).map((p) => aiAnswer(p, kept[p])).join("")}${buttons ? `<div class="in-ai-buttons">${buttons}</div>` : ""}
      <p class="small muted">${t("Sends only the numbers above and the page's title and headings.")}${UI.tip("AI never changes what's found or how it's ranked.")}</p></div>`;
  }
  async function askAI(button) {
    const purpose = button.dataset.inAi, again = Boolean(button.dataset.inAiAgain), f = IN.current;
    if (!f) return;
    const was = button.innerHTML;
    button.disabled = true;
    button.textContent = t("Writing…");
    try {
      const answer = await window.COMP.api("POST", `insights/${f.id}/ai`, { purpose, lang: UI.state.lang === "fr" ? "fr" : "en", again });
      const lang = answer.language;
      f.ai.kept = { ...(f.ai.kept || {}), [lang]: { ...(f.ai.kept?.[lang] || {}), [purpose]: answer } };
      const wrap = UI.$("#panel [data-in-ai-wrap]");
      if (wrap && IN.current === f) UI.setHTML(wrap, aiInner(f));

    } catch (err) {
      UI.toast(t(err.message), { kind: "crit" });
      if (button.isConnected) { button.disabled = false; button.innerHTML = was; }
    }
  }
  async function askWeekly(button) {
    const id = Number(button.dataset.inWeekly);
    button.disabled = true;
    const was = button.innerHTML;
    button.textContent = t("Writing…");
    try {
      const answer = await window.COMP.api("POST", `insights/${id}/ai`, { purpose: "weekly", lang: UI.state.lang === "fr" ? "fr" : "en", again: Boolean(button.dataset.inAiAgain) });
      IN.weekly = { id, lang: answer.language, answer };
      UI.render({ keepScroll: true });
    } catch (err) { UI.toast(t(err.message), { kind: "crit" }); if (button.isConnected) { button.disabled = false; button.innerHTML = was; } }
  }
  function weeklyBlock(change) {
    if (!change) return "";
    const site = (IN.ai?.sites || []).find((x) => x.id === change.site_id);
    if (!site || !aiReady(site.provider)) return "";
    const held = IN.weekly && IN.weekly.id === change.id && IN.weekly.lang === (UI.state.lang === "fr" ? "fr" : "en") ? IN.weekly.answer : null;
    if (held) return `<div class="in-weekly">${aiAnswer("weekly", held).replace('data-in-ai="weekly"', `data-in-weekly="${change.id}"`)}</div>`;
    return `<button class="link-btn in-weekly-btn" data-in-weekly="${change.id}">${icon("sparkles")}${t("AI summary")}</button>`;
  }

  // ---- one finding, in the side panel ---------------------------------------------------------------
  function evidenceList(f) {
    const e = f.evidence || {};
    const li = (label, value, tip = "") => `<li><div class="what"><div class="t">${esc(t(label))}${UI.tip(tip)}</div></div><span>${value}</span></li>`;
    const rows = [];
    if (MIX_KINDS.has(f.kind)) return mixEvidence(f);
    if (f.kind === "change") {
      Object.entries(e.parts).filter(([, v]) => Math.round(v)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).forEach(([id, v]) => rows.push(li(PARTS[id][v > 0 ? 0 : 1], signed(v), id === "hidden" ? HIDDEN_TIP : "")));
      const brand = e.brand ? `<h3 class="ov-h3">${t("Brand and non-brand searches")}</h3><ul class="rows ov-split">${[["brand", "Brand"], ["other", "Non-brand"]].map(([k, name]) => li(name, `${num(e.brand[k].clicks_before)} → ${num(e.brand[k].clicks)}`)).join("")}</ul>` : "";
      const season = e.last_year ? `<p class="small ${e.seasonal ? "" : "muted"}">${e.seasonal ? `<b>${t("Seasonal")}</b>: ` : ""}${fill("Same weeks last year: {a} → {b} clicks ({p}%).", { a: num(e.last_year.clicks_before), b: num(e.last_year.clicks), p: signed(e.last_year.percent) })}</p>` : "";
      return `<ul class="rows ov-split">${rows.join("")}</ul>${season}${brand}${moversList(e)}`;
    }
    if (e.clicks_before !== undefined && e.clicks !== undefined) rows.push(li("Clicks", `${num(e.clicks_before)} → ${num(e.clicks)}`));
    else if (e.clicks !== undefined) rows.push(li("Clicks", num(e.clicks)));
    if (e.impressions_before !== undefined && e.impressions !== undefined) rows.push(li("Impressions", `${num(e.impressions_before)} → ${num(e.impressions)}`));
    else if (e.impressions !== undefined) rows.push(li("Impressions", num(e.impressions)));
    if (e.position_before !== undefined && e.position !== undefined) rows.push(li("Position", `${dec1(e.position_before)} → ${dec1(e.position)}`));
    else if (e.position !== undefined) rows.push(li("Position", dec1(e.position)));
    if (e.click_rate !== undefined && e.click_rate !== null) rows.push(li("Click rate", `${UI.dec(e.click_rate)}%`));
    if (e.expected_rate !== undefined) rows.push(li("Usual rate", `${UI.dec(e.expected_rate)}%`, USUAL_TIP));
    if (e.target_rate !== undefined) rows.push(li(fill("Usual at position {p}", { p: e.target }), `${UI.dec(e.target_rate)}%`));
    if (e.peak !== undefined) rows.push(li("Best 4 weeks, a week", dec1(e.peak)), li("Last 4 weeks, a week", dec1(e.last)));
    if (e.usual !== undefined) rows.push(li("Usual that weekday", num(Math.round(e.usual))));
    if (e.last_seen) rows.push(li("Last seen on Google", esc(dayLabel(e.last_seen))));
    const list = `<ul class="rows ov-split">${rows.join("")}</ul>`;
    const queryRow = (q) => q.clicks_before !== undefined
      ? `<li><div class="what"><div class="t" dir="auto">${esc(q.query)}</div><div class="s muted">${t("pos.")} ${dec1(q.position_before)} → ${dec1(q.position)}</div></div><span>${num(q.clicks_before)} → ${num(q.clicks)}</span></li>`
      : `<li><div class="what"><div class="t" dir="auto">${esc(q.query)}</div><div class="s muted">${t("pos.")} ${dec1(q.position)} · ${num(q.impressions)} ${t("impressions")}</div></div><span>${num(q.clicks)} ${t("clicks")}</span></li>`;
    const queriesTitle = { questions: "Questions", topic: "Its biggest searches", page_near: "Searches just past page 1" }[f.kind] || "Queries behind it";
    const queries = e.queries?.length ? `<h3 class="ov-h3">${t(queriesTitle)}</h3><ul class="rows ov-split">${e.queries.map(queryRow).join("")}</ul>` : "";
    const variants = e.variants?.length ? `<h3 class="ov-h3">${t("Its addresses on Google")}</h3><ul class="rows ov-split">${e.variants.map((v) => `<li><div class="what"><div class="t" dir="auto">${pageLink(v.page, { text: v.page })}</div><div class="s muted">${t("pos.")} ${dec1(v.position)} · ${num(v.clicks)} ${t("clicks")}</div></div><span>${num(v.impressions)}</span></li>`).join("")}</ul>
      <p class="small muted">${t("Google adds them up once they point to one.")}${e.kinds?.length ? ` ${t("They differ by")}: ${e.kinds.map((k) => t({ query: "a query string", scheme: "http or https", www: "www", slash: "trailing slash", case: "capital letters" }[k] || k)).join(", ")}.` : ""}</p>` : "";
    const results = e.before && e.after ? `<h3 class="ov-h3">${fill("28 days before {d} vs 28 days from a week after", { d: dayLabel(e.done) })}</h3><ul class="rows ov-split">
      <li><div class="what"><div class="t">${t("Clicks")}</div></div><span>${num(e.before.clicks)} → ${num(e.after.clicks)}</span></li>
      <li><div class="what"><div class="t">${t("Impressions")}</div></div><span>${num(e.before.impressions)} → ${num(e.after.impressions)}</span></li>
      <li><div class="what"><div class="t">${t("Position")}</div></div><span>${dec1(e.before.position)} → ${dec1(e.after.position)}</span></li>
      <li><div class="what"><div class="t">${t("Click rate")}</div></div><span>${e.before.click_rate ?? "—"}% → ${e.after.click_rate ?? "—"}%</span></li></ul>
      <p class="small muted">${t(e.on === "site" ? "Whole site, around the note's day." : e.on === "keywords" ? "The task's keywords." : "The task's pages.")}</p>` : "";
    const season = e.last_year ? `<p class="small ${e.seasonal ? "" : "muted"}">${e.seasonal ? `<b>${t("Seasonal")}</b>: ` : ""}${fill("Same weeks last year: {a} → {b} clicks ({p}%).", { a: num(e.last_year.clicks_before), b: num(e.last_year.clicks), p: signed(e.last_year.percent) })}${e.seasonal ? ` ${t("So it counts half.")}` : ""}</p>` : "";
    const leads = leadsLine(e) ? `<p class="small">${esc(leadsLine(e))} ${t("at stake")} <span class="muted">(${fill(e.lead_rate?.basis === "page" ? "this page converts {r}% of visits" : "the site converts {r}% of visits", { r: UI.dec(e.lead_rate?.rate ?? 0) })})</span></p>` : "";
    const gaps = f.kind === "data_gaps" ? `<p class="small">${e.partial?.length ? `${t("Days partly read")}: ${e.partial.map((d) => esc(dayLabel(d))).join(", ")}. ` : ""}${e.verify ? fill("The last “Matches Search Console” check found {n} days that differ.", { n: num(e.verify.days) }) : ""}</p>` : "";
    const pages = e.pages?.length ? `<h3 class="ov-h3">${t("Pages sharing it")}</h3><ul class="rows ov-split">${e.pages.map((p) => `<li><div class="what"><div class="t" dir="auto">${pageLink(p.page, { text: pathOf(p.page) })}</div><div class="s muted">${t("pos.")} ${dec1(p.position)} · ${num(p.clicks)} ${t("clicks")}</div></div><span>${p.share}%</span></li>`).join("")}</ul>` : "";
    const causes = e.causes?.length ? `<p class="small">${t("The last health test or Links Checker saw")}: ${e.causes.map((c) => esc(cause(c))).join(", ")}.</p>` : f.kind === "dropped_out" ? `<p class="small muted">${t("The last health test found nothing wrong. Check Search Console's page indexing report.")}</p>` : "";
    const page = f.page && !PAGE_IS_SUBJECT.includes(f.kind) ? `<p class="small muted">${t("Page that ranks")}: ${pageLink(f.page, { text: pathOf(f.page) })}</p>` : "";
    return `${list}${season}${leads}${page}${queries}${variants}${pages}${results}${gaps}${causes}`;
  }
  function moversList(e) {
    const groups = Object.entries(e.movers || {}).filter(([, list]) => list.length).sort((a, b) => Math.abs(e.parts[b[0]]) - Math.abs(e.parts[a[0]]));
    return groups.slice(0, 3).map(([id, list]) => `<h3 class="ov-h3">${esc(t(PARTS[id][e.parts[id] > 0 ? 0 : 1]))}</h3><ul class="rows ov-split">${list.map((m) => `<li><div class="what"><div class="t" dir="auto">${esc(m.query)}</div><div class="s muted">${m.position_before !== null && m.position_before !== undefined ? `${t("pos.")} ${dec1(m.position_before)} → ${dec1(m.position)} · ` : ""}${num(m.impressions_before)} → ${num(m.impressions)} ${t("impressions")}</div></div><span>${signed(m.effect)}</span></li>`).join("")}</ul>`).join("");
  }
  /* How "clicks a month at stake" was worked out, in words, so it can be checked: the (i) beside the figure. */
  function stakeWords(f) {
    return {
      page_down: "Clicks lost vs the 28 days before, per month.",
      dropped_out: "Its clicks in the 4 weeks before it went, per month.",
      odd_day: "Clicks missing that day vs a usual day.",
      decay: "Best 4 weeks minus last 4, per month.",
      almost: "Impressions × (your usual click rate at position {p} − its own), per month.",
      top3: "Impressions × (your usual click rate at position {p} − its own), per month.",
      low_ctr: "Impressions × (usual click rate at its position − its own), per month.",
      no_click: "Impressions × your usual click rate at its position, per month.",
      compete: "Clicks if the best of these pages took all its impressions, per month.",
      change: "Site clicks lost vs the 28 days before, per month.",
      query_down: "Impressions now × (your usual click rate at the old position − at the new), per month.",
      segment: "Clicks lost vs the 28 days before, per month.",
      unstable: "Clicks if it held its better days' position, per month.",
      brand_split: "Non-brand clicks lost vs the 28 days before, per month.",
      slide: "Weekly impressions × (your usual click rate at its position 8 weeks ago − now), per month.",
      page_near: "Per search: impressions × your usual click rate at position {p}, minus its clicks, per month.",
      no_page: "Impressions × your usual click rate at position {p}, minus its clicks, per month.",
      topic: "Topic impressions × your usual click rate at position {p}, minus its clicks, per month.",
      lead_page: "Clicks at stake from the page's drop; leads = those clicks × its lead rate.",
      shown_broken: "Its clicks in the last 28 days, per month.",
      rank_drop: "Impressions × (your usual click rate at its average position − at its last-check place), per month.",
      rival_passed: "Impressions × (your usual click rate at its old place − at its place now), per month.",
      rival_gap: "Impressions × your usual click rate at position {p}, minus its clicks, per month.",
      striking: "Impressions × your usual click rate at position {p}, minus its clicks, per month.",
      rank_no_click: "Impressions × usual click rate at its position, minus its clicks, per month.",
      page_switch: "Last 28 days' clicks to the clicked page, per month.",
    }[f.kind] || "";
  }
  /* The figure, its formula behind (i), and right under it what lowered it: an AI Overview on the search. */
  function stakeBlock(f) {
    const e = f.evidence || {}, words = stakeWords(f);
    const stake = f.at_stake >= 1 ? `<p class="in-stake"><b>${num(Math.round(f.at_stake))}</b> ${t("clicks a month at stake")}${words ? UI.tip(words, { p: e.target ?? "" }) : ""}</p>` : "";
    const aio = e.ai_overview ? `<p class="small muted in-how">${icon("sparkles")}${esc(fill("Counted at {p}%: an AI Overview shows on this search ({d}) and takes some clicks.", { p: num(Math.round((e.ai_overview.share || 0) * 100)), d: dayLabel(e.ai_overview.checked) }))}</p>` : "";
    return `${stake}${aio}`;
  }
  async function openFinding(id, opener) {
    IN.opened = id;
    UI.openPanel(`${UI.panelHead(t("Insight"), "")}<div class="panel-body"><p class="muted">${t("Loading…")}</p></div>`, opener);
    let f;
    try { f = await window.COMP.api("GET", `insights/${id}`); }
    catch (err) { if (UI.$("#panel")) UI.setHTML(UI.$("#panel .panel-body"), `<p class="error">${esc(err.message)}</p>`); return; }
    if (!UI.$("#panel") || IN.opened !== id) return;
    const title = f.kind === "change" ? t("Change breakdown") : titleOf(f);
    const sub = f.kind === "change" ? esc(answer(f, false)) : `${esc(kindName(f))}${!UI.siteIdPicked() ? ` · ${esc(f.host)}` : ""}`;
    const clicks = f.series.map((p) => p.clicks), positions = f.series.map((p) => p.position).filter((x) => x !== null);
    const chart = clicks.length > 1 ? `<h3 class="ov-h3">${t("Clicks, day by day")} <span class="muted small">${t("last 16 weeks")}</span></h3><div class="in-spark">${UI.spark(clicks, { w: 300, h: 56, area: true })}</div>
      ${positions.length > 1 && f.kind !== "odd_day" && f.kind !== "change" ? `<h3 class="ov-h3">${t("Position, day by day (higher is better)")}</h3><div class="in-spark">${UI.spark(positions, { w: 300, h: 44, invert: true })}</div>` : ""}` : "";
    const canTrack = f.query && !f.evidence?.tracked && !MIX_KINDS.has(f.kind);
    const actions = f.kind === "change" ? "" : `<div class="panel-actions in-actions">
      ${f.task ? `<span class="in-task">${icon("square-check")}${t(f.task === "done" ? "Task done" : "Task open")}</span>` : `<button class="btn btn-main" data-in-task="${f.id}">${icon("square-check")}${t("Create task")}</button>`}
      ${canTrack ? `<button class="btn" data-in-track="${esc(f.query)}">${icon("plus")}${t("Track")}</button>` : ""}
      ${f.status === "dismissed" ? `<button class="btn btn-ghost" data-in-undismiss="${f.id}">${t("Bring it back")}</button>` : f.status === "open" ? `<button class="btn btn-ghost" data-in-dismiss="${f.id}">${t("Not useful")}</button>` : ""}
    </div>`;
    const where = f.page ? `<p class="small">${pageLink(f.page, { text: pathOf(f.page), host: f.host })}</p>` : "";
    UI.openPanel(`${UI.panelHead(title, sub)}<div class="panel-body">${stakeBlock(f)}${where}${f.kind !== "change" ? `<p class="small" dir="auto">${esc(reasonOf(f))}${f.kind === "no_demand" ? UI.tip("It may be too rare for Google to report.") : ""}</p>` : ""}${doBlock(f)}${chart}${evidenceList(f)}${aiBlock(f)}
      ${f.status === "dismissed" ? `<p class="small muted">${t("Hidden as not useful. Comes back if it doubles.")}</p>` : ""}${actions}</div>`, opener);
    IN.current = f;
  }

  // ---- events ---------------------------------------------------------------------------------------
  function taskFor(f, opener) {
    const e = f.evidence || {};
    UI.openTask?.({
      title: titleOf(f), host: f.host, opener, priority: f.severity === "big" ? "high" : "medium",
      keywords: f.query ? [f.query] : [], pages: f.page ? [f.page] : [],
      source: { type: "search", key: f.key, label: `${t("Search insights")}: ${kindName(f)}`, facts: [reasonOf(f), f.at_stake >= 1 ? `${num(Math.round(f.at_stake))} ${t("clicks a month at stake")}` : ""].filter(Boolean), link: `#insights/${f.id}`, host: f.host },
      description: [e.path ? f.page : "", onPageLine(f), doLine(f)].filter(Boolean).join("\n"),
    });
  }
  function bind() {
    document.addEventListener("click", async (e) => {
      if (UI.state.route !== "insights" && !UI.$("#panel")) return;
      const hit = (sel) => e.target.closest?.(sel);
      let el;
      if ((el = hit("[data-in-tab]"))) { IN.tab = el.dataset.inTab; TP.reset(PAGES); UI.render({ keepScroll: true }); UI.$(`[data-in-tab="${IN.tab}"]`)?.focus({ preventScroll: true }); return; }
      if ((el = hit("[data-in-mix]"))) { IN.mixChip = el.dataset.inMix; TP.reset(PAGES); UI.render({ keepScroll: true }); UI.$(`[data-in-mix="${IN.mixChip}"]`)?.focus({ preventScroll: true }); return; }
      if (hit("[data-in-sort]")) { IN.sortDir = IN.sortDir === "asc" ? "desc" : "asc"; TP.reset(PAGES); UI.render({ keepScroll: true }); UI.$("[data-in-sort]")?.focus({ preventScroll: true }); return; }
      if (hit("[data-in-search-clear]")) { TP.state(PAGES).q = ""; TP.reset(PAGES); UI.render({ keepScroll: true }); UI.$(`[data-tp-search][data-tp-key="${PAGES}"]`)?.focus({ preventScroll: true }); return; }
      if (hit("[data-in-retry]")) { forget(); UI.render(); return; }
      if ((el = hit("[data-in-run]"))) {
        el.disabled = true;
        try { await window.COMP.api("POST", "insights/run", { site_id: UI.siteIdPicked() || null }); forget(); UI.render({ keepScroll: true }); UI.toast(t("Insights worked out again.")); }
        catch (err) { UI.toast(err.message, { kind: "crit" }); el.disabled = false; }
        return;
      }
      if ((el = hit("[data-in-countries]"))) { countriesPanel(el); return; }
      if ((el = hit("[data-in-weekly]"))) { askWeekly(el); return; }
      if ((el = hit("[data-in-ai]"))) { askAI(el); return; }
      if ((el = hit("[data-in-ai-copy]"))) {
        const box = el.closest(".in-ai-answer")?.querySelector(".in-ai-text");
        try { await navigator.clipboard.writeText(box?.textContent || ""); UI.toast(t("Copied")); } catch { UI.toast(t("Select the text to copy it."), { kind: "info" }); }
        return;
      }
      if ((el = hit("[data-in-task]"))) { if (IN.current) taskFor(IN.current, el); return; }
      if ((el = hit("[data-in-track]"))) {
        if (!window.KW) { UI.toast(t("Add it in Keywords."), { kind: "info" }); return; }
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
          UI.toast(t(undo ? "Brought back" : "Hidden. Comes back if it doubles."), undo ? {} : { undo: async () => { await window.COMP.api("POST", `insights/${id}/dismiss`, { undo: true }); forget(); UI.render({ keepScroll: true }); } });
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
    document.addEventListener("submit", async (e) => {
      if (e.target.id !== "in-countries-form") return;
      e.preventDefault();
      const countries = [...e.target.querySelectorAll('input[name="f_country"]:checked')].map((x) => x.value);
      const error = e.target.querySelector("[data-in-countries-error]");
      try {
        C.data = await window.COMP.api("PUT", "search/countries", { site_id: UI.siteIdPicked(), countries });
        UI.closePanel(); forget(); UI.render({ keepScroll: true });
        UI.toast(t("Saved. Applies from the next Search Console read."));
      } catch (err) { error.hidden = false; error.textContent = t(err.message); }
    });
    document.addEventListener("change", (e) => {
      if (e.target.matches?.("[data-in-status]")) { IN.status = e.target.value; TP.reset(PAGES); UI.render({ keepScroll: true }); UI.$("[data-in-status]")?.focus({ preventScroll: true }); }
    });
    // A task made here, or a finding opened from Today (#insights/12), lands on the finding.
    const fromAddress = () => { const m = location.hash.match(/^#insights\/(\d+)/); if (m && UI.state.route === "insights") setTimeout(() => openFinding(Number(m[1]), null), 50); };
    addEventListener("hashchange", fromAddress);
    setTimeout(fromAddress, 300);
    addEventListener("seocc:task-saved", () => forget());
  }

  window.SCREENS = window.SCREENS || {};
  window.SCREENS.insights = { init(helpers) { UI = helpers; ({ t, esc, num, icon } = helpers); bind(); TP.on(PAGES, redraw); }, page };

  const words = {
    "No site yet": "Pas encore de site", "Add a site and connect Search Console to get insights.": "Ajoutez un site et connectez la Search Console pour obtenir des analyses.",
    "No AI chosen yet, so nothing is sent. Pick one in Settings → AI.": "Aucune IA choisie : rien n'est envoyé. Choisissez-en une dans Réglages → IA.",
    "Add a site": "Ajouter un site", "Run": "Lancer", "What to do": "Que faire",
    "The search isn't in the title or H1: put it there first.": "La recherche n'est ni dans le titre ni dans le H1 : mettez-la là d'abord.",
    "The search isn't in the title.": "La recherche n'est pas dans le titre.", "The search isn't in the H1.": "La recherche n'est pas dans le H1.",
    "The search is already in the title and H1.": "La recherche est déjà dans le titre et le H1.",
    "Check the page works and hasn't changed, then see which searches lost places.": "Vérifiez que la page fonctionne et n'a pas changé, puis voyez quelles recherches ont perdu des places.",
    "Check it loads and isn't noindex, then request indexing in Search Console.": "Vérifiez qu'elle se charge et n'est pas en noindex, puis demandez l'indexation dans la Search Console.",
    "Update the page: new facts, this year's numbers, a fuller answer to its main search.": "Mettez la page à jour : faits récents, chiffres de l'année, réponse plus complète à sa recherche principale.",
    "Check the site was up and unchanged that day. A one-off needs nothing.": "Vérifiez que le site était en ligne et inchangé ce jour-là. Un jour isolé ne demande rien.",
    "Put the search in the title and H1, and cover what the pages above cover.": "Mettez la recherche dans le titre et le H1, et traitez ce que traitent les pages au-dessus.",
    "Rewrite the title and description to win clicks, and cover what the top 3 cover.": "Réécrivez le titre et la description pour gagner des clics, et traitez ce que traite le top 3.",
    "Rewrite the title and description to answer this search plainly.": "Réécrivez le titre et la description pour répondre clairement à cette recherche.",
    "Rewrite the title and description to match what searchers want.": "Réécrivez le titre et la description pour coller à ce que veulent les internautes.",
    "Pick one page for this search, improve it, and link the other to it, or merge them.": "Choisissez une page pour cette recherche, améliorez-la, et faites un lien de l'autre vers elle, ou fusionnez-les.",
    "Compare with the pages that passed yours, and add what they cover.": "Comparez avec les pages qui ont dépassé la vôtre, et ajoutez ce qu'elles traitent.",
    "Open that country or device in Overview to see which pages fell.": "Ouvrez ce pays ou cet appareil dans Vue d'ensemble pour voir quelles pages ont baissé.",
    "Make one page the clear answer: search in its title and H1, links from related pages.": "Faites d'une page la réponse claire : la recherche dans son titre et son H1, des liens depuis les pages proches.",
    "Check non-brand searches in Overview: brand traffic hides a loss.": "Regardez les recherches hors marque dans Vue d'ensemble : le trafic de marque cache une perte.",
    "Refresh the page and link to it from your other pages.": "Rafraîchissez la page et faites des liens vers elle depuis vos autres pages.",
    "Improve this one page: it lifts all these searches at once.": "Améliorez cette seule page : elle fait monter toutes ces recherches à la fois.",
    "Write a page for it, or a clear section on the page that ranks.": "Écrivez une page pour elle, ou une section claire sur la page qui se classe.",
    "Answer these questions on the page, in a short FAQ or headings.": "Répondez à ces questions sur la page, dans une courte FAQ ou les intertitres.",
    "Write one strong page on this topic and link to it from the others.": "Écrivez une page forte sur ce sujet et faites des liens vers elle depuis les autres.",
    "Add it to Keywords to follow its rank.": "Ajoutez-la aux mots-clés pour suivre son classement.",
    "Fix this page first, it brings leads: see what changed and which searches it lost.": "Corrigez d'abord cette page, elle apporte des leads : voyez ce qui a changé et quelles recherches elle a perdues.",
    "Make the next step clear: a form, a phone number, one plain call to action.": "Rendez l'étape suivante claire : un formulaire, un numéro, un appel à l'action simple.",
    "Point the other addresses to one with a redirect or a canonical tag.": "Faites pointer les autres adresses vers une seule, par une redirection ou une balise canonique.",
    "Fix the page: Google keeps showing it, so visitors land on an error.": "Corrigez la page : Google continue de l'afficher, et les visiteurs tombent sur une erreur.",
    "Read those days again from Overview, with Matches Search Console.": "Relisez ces jours depuis Vue d'ensemble, avec « Conforme à la Search Console ».",
    "in {c}; worldwide {p}": "en {c} ; monde {p}", "Countries": "Pays", "Countries (by clicks)": "Pays (d'après les clics)", "not set": "non définis", "Change": "Modifier",
    "Target countries": "Pays visés", "Quick wins and Keywords read only these countries": "Les gains rapides et les mots-clés ne lisent que ces pays",
    "Up to {n}.": "Jusqu'à {n}.",
    "No country data yet.": "Pas encore de données par pays.", "Save": "Enregistrer", "clicks": "clics", "Saved. Applies from the next Search Console read.": "Enregistré. S'applique dès la prochaine lecture de la Search Console.",
    "Counted at {p}%: an AI Overview shows on this search ({d}) and takes some clicks.": "Compté à {p} % : un AI Overview s'affiche sur cette recherche ({d}) et prend une partie des clics.",
    "Insights": "Analyses", "Worked out daily from your Search Console data": "Calculé chaque jour à partir de vos données Search Console",
    "To do first": "À faire d'abord", "What changed": "Ce qui a changé", "Slow decline": "Lent déclin", "Quick wins": "Gains rapides",
    "Still open": "En cours", "Went away": "Disparues", "Done": "Fait",
    "Losing clicks": "Clics en baisse", "Gaining clicks": "Clics en hausse", "Dropped out of Google": "Sortie de Google", "Odd day": "Jour inhabituel",
    "Slowly losing clicks": "Perd lentement des clics", "Close to the top 3": "Proche du top 3", "Seen, never clicked": "Vue, jamais cliquée",
    "{path} lost {percent}% of its clicks": "{path} a perdu {percent} % de ses clics", "{path} gained {percent}% clicks": "{path} a gagné {percent} % de clics", "{path} dropped out of Google": "{path} est sortie de Google",
    "{day}: {clicks} clicks, usually {usual}": "{day} : {clicks} clics, d'habitude {usual}", "{path} is slowly losing clicks": "{path} perd lentement des clics",
    "More searches": "Plus de recherches", "Fewer searches": "Moins de recherches", "Ranking higher": "Mieux classé", "Ranking lower": "Moins bien classé",
    "New queries": "Nouvelles requêtes",
    "Lost queries": "Requêtes perdues", "Rare searches Google hides": "Recherches rares que Google masque",
    "Lost places: {a} → {b}": "Places perdues : {a} → {b}", "Fewer searches: {a} → {b} impressions": "Moins de recherches : {a} → {b} impressions",
    "Lower click rate": "Taux de clic en baisse", "Moved up: {a} → {b}": "Monte : {a} → {b}", "More searches: {a} → {b} impressions": "Plus de recherches : {a} → {b} impressions",
    "Higher click rate": "Taux de clic en hausse",
    "No impressions for {n} days, after {c} clicks in 4 weeks": "Aucune impression depuis {n} jours, après {c} clics en 4 semaines",
    "Usually about {u} on a {d}": "D'habitude environ {u} un {d}", "two days in a row": "deux jours de suite", "A spike": "Un pic",
    "{p}% under its best 4 weeks: {a} → {b} clicks a week": "{p} % sous ses 4 meilleures semaines : {a} → {b} clics par semaine",
    "Position {p} · {i} impressions · {c} clicks": "Position {p} · {i} impressions · {c} clics", "{r}% click rate at position {p}; usual {u}%": "Taux de clic {r} % en position {p} ; habituel {u} %",
    "{i} impressions at position {p}, 0 clicks": "{i} impressions en position {p}, 0 clic",
    "set to noindex": "en noindex", "answers with an error": "répond par une erreur", "server error": "erreur du serveur", "points to another page": "renvoie vers une autre page",
    "almost no text": "presque pas de texte", "broken link to it": "lien cassé vers elle", "redirects": "redirige", "gone": "disparue",
    "Clicks are steady: {a} in the last 28 days, {b} before.": "Les clics sont stables : {a} sur les 28 derniers jours, {b} avant.",
    "Clicks rose {p}% ({b} → {a}).": "Les clics sont en hausse de {p} % ({b} → {a}).", "Clicks fell {p}% ({b} → {a}).": "Les clics sont en baisse de {p} % ({b} → {a}).",
    "Impressions rose {p}%.": "Les impressions sont en hausse de {p} %.", "Impressions fell {p}%.": "Les impressions sont en baisse de {p} %.", "Mostly: {what} ({n} clicks).": "Surtout : {what} ({n} clics).",
    "Change breakdown": "Détail du changement", "See what gained": "Voir ce qui a gagné", "See what lost": "Voir ce qui a perdu",
    "Run again": "Relancer", "Nothing worked out yet": "Rien de calculé pour l'instant",
    "They run daily on their own. Run them now to see the first ones.": "Elles tournent seules chaque jour. Lancez-les pour voir les premières.",
    "Clicks a month at stake": "Clics par mois en jeu", "Fixed or gone in 30 days": "Réglés ou disparus en 30 jours", "Worked out": "Calculé", "Final days only, last 28 days vs the 28 before": "Jours définitifs seulement, 28 derniers jours vs les 28 précédents",
    "Low click rates need your brand words.": "Les taux de clic faibles demandent vos mots de marque.",
    "Add them on Overview": "Ajoutez-les dans Vue d'ensemble", "Needs more history: 16 weeks for slow decline, 8 for changes.": "Il faut plus d'historique : 16 semaines pour le lent déclin, 8 pour les changements.",
    "Biggest findings, one row per query or page.": "Les plus gros constats, une ligne par requête ou page.", "Last 28 days vs the 28 before, plus odd days this week.": "28 derniers jours vs les 28 précédents, plus les jours inhabituels de la semaine.",
    "Pages sliding a little every week for 16 weeks.": "Pages qui reculent un peu chaque semaine depuis 16 semaines.", "Queries a small push would pay for, using this site's own click rates.": "Requêtes pour lesquelles un petit effort paierait, d'après les taux de clic du site.",
    "Nothing here. Good news.": "Rien ici. Bonne nouvelle.", "Nothing here.": "Rien ici.",
    "What": "Quoi", "Clicks a month": "Clics par mois", "Key number": "Chiffre clé", "Task done": "Tâche faite", "Task open": "Tâche ouverte",
    "Insight": "Analyse", "Queries behind it": "Requêtes derrière", "Usual at position {p}": "Habituel en position {p}", "Best 4 weeks, a week": "4 meilleures semaines, par semaine", "Last 4 weeks, a week": "4 dernières semaines, par semaine",
    "Usual that weekday": "Habituel ce jour de la semaine", "Last seen on Google": "Vue pour la dernière fois sur Google", "The last health test or Links Checker saw": "Le dernier test de santé ou le Links Checker a vu",
    "The last health test found nothing wrong. Check Search Console's page indexing report.": "Le dernier test de santé n'a rien trouvé d'anormal. Vérifiez le rapport d'indexation des pages de la Search Console.",
    "Page that ranks": "Page qui se classe", "last 16 weeks": "16 dernières semaines", "clicks a month at stake": "clics par mois en jeu", "Not useful": "Pas utile", "Bring it back": "La remettre",
    "Hidden as not useful. Comes back if it doubles.": "Masquée comme pas utile. Revient si elle double.",
    "Clicks lost vs the 28 days before, per month.": "Clics perdus par rapport aux 28 jours d'avant, ramenés au mois.",
    "Its clicks in the 4 weeks before it went, per month.": "Ses clics des 4 semaines avant sa disparition, ramenés au mois.",
    "Clicks missing that day vs a usual day.": "Clics manquants ce jour-là par rapport à un jour habituel.", "Best 4 weeks minus last 4, per month.": "4 meilleures semaines moins les 4 dernières, ramené au mois.",
    "Impressions × (your usual click rate at position {p} − its own), per month.": "Impressions × (votre taux de clic habituel en position {p} − le sien), ramené au mois.",
    "Impressions × (usual click rate at its position − its own), per month.": "Impressions × (taux de clic habituel à sa position − le sien), ramené au mois.",
    "Impressions × your usual click rate at its position, per month.": "Impressions × votre taux de clic habituel à sa position, ramené au mois.",
    "Clicks if the best of these pages took all its impressions, per month.": "Clics si la meilleure de ces pages prenait toutes ses impressions, ramené au mois.",
    "Site clicks lost vs the 28 days before, per month.": "Clics du site perdus par rapport aux 28 jours d'avant, ramenés au mois.",
    "Search insights": "Analyses de recherche", "Insights worked out again.": "Analyses recalculées.", "Brought back": "Remise", "Hidden. Comes back if it doubles.": "Masquée. Revient si elle double.",
    "Click rate": "Taux de clic", "Position": "Position", "d": "j",
    "Explain": "Expliquer", "Suggest titles": "Proposer des titres", "Write a brief": "Écrire un brief", "Write an FAQ": "Écrire une FAQ", "Which page to keep": "Quelle page garder",
    "AI summary": "Résumé IA", "Written by AI": "Écrit par l'IA", "a free model": "un modèle gratuit", "Ask again": "Redemander", "Writing…": "Rédaction…", "Copied": "Copié",
    "Select the text to copy it.": "Sélectionnez le texte pour le copier.", "With AI": "Avec l'IA", "Claude (Anthropic key)": "Claude (clé Anthropic)", "Free models (OpenRouter)": "Modèles gratuits (OpenRouter)",
    "Paste an Anthropic key in Settings to use Claude here.": "Collez une clé Anthropic dans les réglages pour utiliser Claude ici.",
    "Connect OpenRouter in Settings, or pick Claude for this site.": "Connectez OpenRouter dans les réglages, ou choisissez Claude pour ce site.", "Open Settings": "Ouvrir les réglages",
    "Sends only the numbers above and the page's title and headings.": "Envoie seulement les chiffres ci-dessus, le titre et les intertitres de la page.",
    "Paste an Anthropic key in Settings first, or pick OpenRouter's free models for this site.": "Collez d'abord une clé Anthropic dans les réglages, ou choisissez les modèles gratuits d'OpenRouter pour ce site.",
    "Connect OpenRouter in Settings first, or pick Claude for this site.": "Connectez d'abord OpenRouter dans les réglages, ou choisissez Claude pour ce site.",
    "Anthropic refused this key. Paste it again in Settings.": "Anthropic a refusé cette clé. Collez-la à nouveau dans les réglages.", "Claude declined to answer.": "Claude a refusé de répondre.",
    "Claude gave no answer. Try again.": "Claude n'a pas répondu. Réessayez.", "Claude is busy or down. Try again in a moment.": "Claude est occupé ou indisponible. Réessayez dans un instant.",
    "The Anthropic account is out of credit. Add some in the Claude Console.": "Le compte Anthropic n'a plus de crédit. Ajoutez-en dans la Claude Console.",
    "Too many requests to Anthropic. Try again in a minute.": "Trop de requêtes chez Anthropic. Réessayez dans une minute.", "Anthropic couldn't be reached. Try again in a moment.": "Anthropic est injoignable. Réessayez dans un instant.",
    "AI can't write that for this kind of insight.": "L'IA ne peut pas écrire cela pour ce type d'analyse.",
    "Leads": "Leads", "Technical": "Technique", "Did it work": "Ça a marché ?",
    "Query losing places": "Requête qui perd des places", "One device or country": "Un appareil ou un pays", "Unstable ranking": "Classement instable", "Brand hides a loss": "La marque cache une perte",
    "Slowly losing places": "Perd lentement des places", "Near page 1 on many searches": "Proche de la page 1 sur beaucoup de recherches", "No page of its own": "Pas de page à elle",
    "Question searches": "Recherches en questions", "Topic without a strong page": "Sujet sans page forte", "Worth tracking": "À suivre", "Page that brings leads": "Page qui apporte des leads",
    "Clicks but no leads": "Des clics mais pas de leads", "One page, several addresses": "Une page, plusieurs adresses", "Shown but broken": "Affichée mais cassée", "Data gaps": "Trous dans les données",
    "Task result": "Résultat d'une tâche", "Note result": "Résultat d'une note",
    "{segment}: {sign}{percent}% clicks": "{segment} : {sign}{percent} % de clics", "Non-brand clicks fell {percent}%": "Les clics hors marque ont baissé de {percent} %",
    "Searches with “{word}”": "Recherches avec « {word} »", "{path} brings leads and is losing clicks": "{path} apporte des leads et perd des clics", "Search Console data has gaps": "Les données de la Search Console ont des trous",
    "Mobile": "Mobile", "Desktop": "Ordinateur", "Tablet": "Tablette", "Better": "Mieux", "Worse": "Moins bien", "About the same": "À peu près pareil",
    "≈ {n} leads a month": "≈ {n} leads par mois", "Position {a} → {b} · {i} impressions": "Position {a} → {b} · {i} impressions",
    "{a} → {b} clicks; rest of site {c}": "{a} → {b} clics ; reste du site {c}",
    "Swings between position {a} and {b}, usually {p}": "Oscille entre la position {a} et {b}, d'habitude {p}",
    "Non-brand {a} → {b} clicks; brand {c} → {d}": "Hors marque {a} → {b} clics ; marque {c} → {d}",
    "Position {a} → {b}, slipping weekly for 8 weeks": "Position {a} → {b}, en recul chaque semaine depuis 8 semaines",
    "{n} searches at positions 11–30 · {i} impressions": "{n} recherches en positions 11–30 · {i} impressions",
    "Only the home page ranks, at position {p} · {i} impressions": "Seule la page d'accueil se classe, en position {p} · {i} impressions",
    "Ranks via {page}, an off-topic page, at position {p}": "Se classe via {page}, une page hors sujet, en position {p}",
    "{n} questions · {i} impressions": "{n} questions · {i} impressions", "{n} searches · {i} impressions · average position {p}": "{n} recherches · {i} impressions · position moyenne {p}",
    "{n} leads in {d} days": "{n} leads en {d} jours", "clicks {p}%": "clics {p} %", "{c} clicks, {s} visits, 0 leads in {d} days": "{c} clics, {s} visites, 0 lead en {d} jours",
    "{n} addresses · {i} impressions": "{n} adresses · {i} impressions", "Shown {i} times this week": "Affichée {i} fois cette semaine",
    "{n} days partly read": "{n} jours lus en partie", "{n} days differ from Search Console": "{n} jours diffèrent de la Search Console",
    "Done {d}. Result on {r}.": "Fait le {d}. Résultat le {r}.", "{a} → {b} clicks in 28 days": "{a} → {b} clics en 28 jours",
    "{path} is new on Google": "{path} est nouvelle sur Google", "new": "nouvelle", "searches": "recherches", "leads": "leads", "addresses": "adresses", "waiting": "en attente",
    "Impressions now × (your usual click rate at the old position − at the new), per month.": "Impressions actuelles × (votre taux de clic habituel à l'ancienne position − à la nouvelle), ramené au mois.",
    "Clicks if it held its better days' position, per month.": "Clics si elle gardait la position de ses meilleurs jours, ramené au mois.",
    "Non-brand clicks lost vs the 28 days before, per month.": "Clics hors marque perdus par rapport aux 28 jours d'avant, ramenés au mois.",
    "Weekly impressions × (your usual click rate at its position 8 weeks ago − now), per month.": "Impressions par semaine × (votre taux de clic habituel à sa position d'il y a 8 semaines − maintenant), ramené au mois.",
    "Per search: impressions × your usual click rate at position {p}, minus its clicks, per month.": "Par recherche : impressions × votre taux de clic habituel en position {p}, moins ses clics, ramené au mois.",
    "Impressions × your usual click rate at position {p}, minus its clicks, per month.": "Impressions × votre taux de clic habituel en position {p}, moins ses clics, ramené au mois.",
    "Topic impressions × your usual click rate at position {p}, minus its clicks, per month.": "Impressions du sujet × votre taux de clic habituel en position {p}, moins ses clics, ramené au mois.",
    "Clicks at stake from the page's drop; leads = those clicks × its lead rate.": "Clics en jeu de la baisse de la page ; leads = ces clics × son taux de leads.",
    "Its clicks in the last 28 days, per month.": "Ses clics des 28 derniers jours, ramenés au mois.",
    "Questions": "Questions", "Its biggest searches": "Ses plus grosses recherches", "Searches just past page 1": "Recherches juste après la page 1",
    "Its addresses on Google": "Ses adresses sur Google", "Google adds them up once they point to one.": "Google les additionne dès qu'elles pointent vers une seule.",
    "They differ by": "Elles diffèrent par", "a query string": "des paramètres après ?", "http or https": "http ou https", "trailing slash": "la barre finale", "capital letters": "les majuscules",
    "28 days before {d} vs 28 days from a week after": "28 jours avant le {d} contre 28 jours dès une semaine après",
    "Whole site, around the note's day.": "Tout le site, autour du jour de la note.", "The task's keywords.": "Les mots-clés de la tâche.", "The task's pages.": "Les pages de la tâche.",
    "Seasonal": "Saisonnier", "Same weeks last year: {a} → {b} clicks ({p}%).": "Mêmes semaines l'an dernier : {a} → {b} clics ({p} %).", "So it counts half.": "Elle compte donc pour moitié.",
    "at stake": "en jeu", "this page converts {r}% of visits": "cette page convertit {r} % des visites", "the site converts {r}% of visits": "le site convertit {r} % des visites",
    "Days partly read": "Jours lus en partie",
    "The last “Matches Search Console” check found {n} days that differ.": "La dernière vérification « Conforme à la Search Console » a trouvé {n} jours différents.",
    "Brand and non-brand searches": "Recherches de marque et hors marque", "Brand": "Marque", "Non-brand": "Hors marque",
    "No GA4 key events yet: mark your form or call event as one.": "Aucun événement clé dans GA4 : marquez comme tel votre formulaire ou votre appel.",
    "Add brand words to see when brand hides a loss.": "Ajoutez vos mots de marque pour voir quand la marque cache une perte.",
    "Pages and searches sliding a little every week.": "Pages et recherches qui reculent un peu chaque semaine.", "Searches worth a small push, by your own click rates.": "Recherches qui valent un petit effort, d'après vos propres taux de clic.",
    "Search clicks joined with GA4's key events over 90 days.": "Les clics de recherche joints aux événements clés de GA4 sur 90 jours.",
    "Addresses, broken pages and missing days, from Search Console.": "Adresses, pages cassées et jours manquants, d'après la Search Console.",
    "Done tasks and dated notes, before vs after.": "Tâches faites et notes datées, avant contre après.",
    "Rank and clicks": "Positions et clics", "Rank checks beside Search Console: what neither shows alone.": "Vos relevés de position à côté de la Search Console : ce qu'aucun ne montre seul.",
    "Just dropped": "Vient de chuter", "Just climbed": "Vient de monter", "Rival passed you": "Dépassé par un concurrent", "Rivals lead, people search it": "Concurrents devant, recherche réelle", "Almost there, both agree": "Presque là, les deux sources d'accord",
    "Another page shown": "Une autre page montrée", "Tracked, no searches": "Suivi, aucune recherche",
    "All": "Tous", "Just moved": "Vient de bouger", "Rivals ahead": "Concurrents devant", "Almost there": "Presque là", "Ranked, not clicked": "Classé, pas cliqué", "Wrong page": "Mauvaise page", "Tracking": "Suivi", "Filter findings": "Filtrer les constats",
    "Hidden searches": "Recherches masquées", "Updated just now": "Mis à jour à l'instant", "Updated {n} min ago": "Mis à jour il y a {n} min", "Updated {n} h ago": "Mis à jour il y a {n} h", "Updated yesterday": "Mis à jour hier", "Updated {n} d ago": "Mis à jour il y a {n} j",
    "Mostly one page: {page}, {n} clicks.": "Surtout une page : {page}, {n} clics.", "Steady": "Stable", "Biggest gains": "Plus forts gains", "Biggest losses": "Plus fortes pertes", "Main cause": "Cause principale", "Most of it: {list}.": "L'essentiel : {list}.", "Which pages moved": "Quelles pages ont bougé", "Why": "Pourquoi", "Last 28 days": "28 derniers jours", "28 days before": "28 jours d'avant",
    "To recover": "À récupérer", "To win": "À gagner", "clicks a month": "clics par mois", "Fixed in 30 days": "Réglés en 30 jours", "Impressions": "Impressions", "Clicks": "Clics", "biggest findings": "plus gros constats",
    "Lost places": "Places perdues", "Moved up": "A monté", "Non-brand searches": "Recherches hors marque", "Only the home page ranks": "Seule la page d'accueil se classe", "Ranks via {page}, an off-topic page": "Se classe via {page}, une page hors sujet",
    "{n} searches at positions 11–30": "{n} recherches en positions 11–30", "{n} questions": "{n} questions", "{n} searches": "{n} recherches", "{n} addresses": "{n} adresses", "This week": "Cette semaine", "Rest of site: {c}": "Reste du site : {c}", "Over 8 weeks": "Sur 8 semaines",
    "Search Console average {a}, last check {b}": "Moyenne Search Console {a}, dernière vérification {b}", "{host} is now at position {p}, above you": "{host} est maintenant en position {p}, devant vous", "{host} at position {p}; you: {me}": "{host} en position {p} ; vous : {me}",
    "{s}% of clicks go to {a}; last check shows {b}": "{s} % des clics vont vers {a} ; le dernier relevé montre {b}", "No impressions in 28 days.": "Aucune impression en 28 jours.",
    "AI Overview doesn't cite you": "L'AI Overview ne vous cite pas", "AI Overview cites you": "L'AI Overview vous cite", "No AI Overview": "Pas d'AI Overview", "AI Overview not read": "AI Overview non lu", "AI Overview": "AI Overview",
    "Check the page works and what changed, then see who is above it now.": "Vérifiez que la page fonctionne et ce qui a changé, puis voyez qui est devant maintenant.", "See what changed here, and repeat it on similar pages.": "Voyez ce qui a changé ici, et refaites-le sur les pages proches.",
    "Compare that rival's page: what it covers that yours doesn't, and when it changed.": "Comparez la page de ce concurrent : ce qu'elle traite et pas la vôtre, et quand elle a changé.", "Build or strengthen a page for it, with theirs as the bar.": "Créez ou renforcez une page, en prenant la leur comme référence.",
    "Improve this page and link to it from your strongest pages.": "Améliorez cette page et faites des liens vers elle depuis vos meilleures pages.", "Pick the page that should win. Link to it from the other, and match its title.": "Choisissez la page qui doit gagner. Faites un lien vers elle depuis l'autre, et adaptez son titre.", "If it doesn't matter, stop checking it to save search credits.": "Si elle ne compte pas, arrêtez de la vérifier pour économiser des crédits.",
    "The AI Overview takes these clicks. Answer plainly on the page so it cites you.": "L'AI Overview prend ces clics. Répondez clairement sur la page pour qu'il vous cite.", "The AI Overview cites you but takes most clicks. Give the title a reason to click.": "L'AI Overview vous cite mais prend la plupart des clics. Donnez dans le titre une raison de cliquer.",
    "No AI Overview, so the title is the likely problem. Rewrite it and the description.": "Pas d'AI Overview : le titre est sans doute le problème. Réécrivez-le, ainsi que la description.", "Cause unknown: this check can't read AI Overviews. Look by hand, or check with SerpApi.": "Cause inconnue : cette vérification ne lit pas les AI Overviews. Regardez à la main, ou vérifiez avec SerpApi.",
    "Check it": "À vérifier", "One rank check only. Check again before acting.": "Une seule vérification. Revérifiez avant d'agir.", "All countries": "Tous pays", "Not found in the results checked": "Absente des résultats vérifiés", "One check only": "Une seule vérification",
    "One looks like a fresh drop": "Un ressemble à une chute récente", "{a} look like fresh drops": "{a} ressemblent à des chutes récentes", ", and rivals lead on {b} that people really search.": ", et les concurrents dominent sur {b} vraiment recherchés.", " Rivals lead on {b} that people really search.": " Les concurrents dominent sur {b} vraiment recherchés.",
    "Of {a} tracked keywords, {b} have Search Console data.": "Sur {a} mots-clés suivis, {b} ont des données Search Console.", "Rankings checked: {a} of {b} in the last {d} days.": "Positions vérifiées : {a} sur {b} ces {d} derniers jours.", "Oldest {n} days.": "La plus ancienne : {n} jours.", "Oldest: a day or less.": "La plus ancienne : un jour ou moins.", "Refresh in Keywords": "Actualiser dans Mots-clés", "Open Keywords": "Ouvrir Mots-clés",
    "Short list: most rank checks are old or missing.": "Liste courte : la plupart des vérifications sont anciennes ou manquantes.", "No tracked keywords yet": "Pas encore de mots-clés suivis", "Add keywords and check them.": "Ajoutez des mots-clés et vérifiez-les.", "No rank checks yet": "Pas encore de vérification de position", "Press Refresh in Keywords.": "Lancez Actualiser dans Mots-clés.",
    "Keyword": "Mot-clé", "Search Console": "Search Console", "Last check": "Dernière vérif.", "Who's above": "Qui est devant", "Before": "Avant", "Pages": "Pages", "Shown": "Montrée", "Clicked": "Cliquée", "Search Console position, same country": "Position Search Console, même pays", "Search Console position, all countries": "Position Search Console, tous pays", "Previous check": "Vérification précédente",
    "Checked {d} with {tool} from {place}, top {n}.": "Vérifié le {d} avec {tool} depuis {place}, top {n}.", "Who ranks for it": "Qui se classe dessus", "You": "Vous", "Followed rival": "Concurrent suivi", "Also": "Aussi",
    "Impressions × (your usual click rate at its average position − at its last-check place), per month.": "Impressions × (votre taux de clic habituel à sa position moyenne − à sa place au dernier relevé), ramené au mois.", "Impressions × (your usual click rate at its old place − at its place now), per month.": "Impressions × (votre taux de clic habituel à son ancienne place − à sa place actuelle), ramené au mois.", "Impressions × usual click rate at its position, minus its clicks, per month.": "Impressions × taux de clic habituel à sa position, moins ses clics, ramené au mois.", "Last 28 days' clicks to the clicked page, per month.": "Clics de la page cliquée sur les 28 derniers jours, ramenés au mois.",
    "{n} use all-country positions": "{n} utilisent des positions tous pays", "1 uses all-country positions": "1 utilise des positions tous pays",
    "Search findings": "Chercher un constat", "No finding matches this search.": "Aucun constat ne correspond à cette recherche.", "finding": "constat", "findings": "constats",
  };
  Object.keys(words).forEach((w) => { if (window.FR[w] === undefined) window.FR[w] = words[w]; });
})();
