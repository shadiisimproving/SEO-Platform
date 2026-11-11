/* Search → Insights. What the code found in Search Console data after each new day: one sentence on why clicks moved,
   three numbers, then one card with tabs, each tab one question. Rows are ranked by clicks a month at stake.
   Everything here is worked out in plain code on the server (seo/insights/); nothing on this screen is written by AI. */
(() => {
  "use strict";
  let UI = null, t, esc, num, icon;
  const TABS = [["first", "To do first"], ["changed", "What changed"], ["decline", "Slow decline"], ["wins", "Quick wins"], ["leads", "Leads"], ["technical", "Technical"], ["impact", "Did it work"]];
  const STATUSES = [["open", "Still open"], ["dismissed", "Not useful"], ["gone", "Went away"], ["done", "Done"]];
  const KIND = {
    page_down: { name: "Page losing clicks", title: "{path} lost {percent}% of its clicks" },
    page_up: { name: "Page gaining clicks", title: "{path} gained {percent}% clicks", fresh: "{path} is new on Google" },
    dropped_out: { name: "Dropped out of Google", title: "{path} dropped out of Google" },
    odd_day: { name: "Odd day", title: "{day}: {clicks} clicks, usually {usual}" },
    decay: { name: "Slowly losing clicks", title: "{path} is slowly losing clicks" },
    almost: { name: "Almost on page 1", title: "{query}" },
    top3: { name: "Close to the top 3", title: "{query}" },
    low_ctr: { name: "Low click rate", title: "{query}" },
    no_click: { name: "Seen but never clicked", title: "{query}" },
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
  };
  const PARTS = {
    demand: ["More searches", "Fewer searches"], ranking: ["Ranking higher", "Ranking lower"], appeal: ["Clicked more at the same place", "Clicked less at the same place"],
    new: ["New queries", "New queries"], lost: ["Queries that went away", "Queries that went away"], hidden: ["Rare searches Google hides", "Rare searches Google hides"],
  };
  const PAGES = "in"; // the table's pages and search (table-pages.js), like every long table in the app
  const IN = { tab: "first", status: "open", cache: new Map(), sortDir: "desc", opened: null }; // sortDir: clicks a month, biggest first
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
        const why = { ranking: fill("Lost places: position {a} → {b}", { a: dec1(e.position_before), b: dec1(e.position) }), demand: fill("Fewer searches: {a} → {b} impressions", { a: num(e.impressions_before), b: num(e.impressions) }), appeal: t("Clicked less at the same position") }[e.why];
        const gained = { ranking: fill("Moved up: position {a} → {b}", { a: dec1(e.position_before), b: dec1(e.position) }), demand: fill("More searches: {a} → {b} impressions", { a: num(e.impressions_before), b: num(e.impressions) }), appeal: t("Clicked more at the same position") }[e.why];
        return `${num(e.clicks_before)} → ${num(e.clicks)} ${t("clicks")} · ${f.kind === "page_up" ? gained : why}`;
      }
      case "dropped_out": return `${fill("No impressions for {n} days; {c} clicks in the 4 weeks before", { n: num(e.days), c: num(e.clicks_before) })}${e.causes?.length ? ` · ${e.causes.map(cause).join(", ")}` : ""}`;
      case "odd_day": return e.low ? `${fill("Usually about {u} on a {d}", { u: num(Math.round(e.usual)), d: new Intl.DateTimeFormat(UI.locale(), { weekday: "long" }).format(new Date(`${e.day}T00:00:00`)) })}${e.in_a_row ? ` · ${t("two days in a row")}` : ""}` : t("A spike: far more than usual");
      case "decay": return fill("{p}% under its best 4 weeks: {a} → {b} clicks a week", { p: num(e.below_peak), a: dec1(e.peak), b: dec1(e.last) });
      case "almost": case "top3": return `${fill("Position {p} · {i} impressions · {c} clicks", { p: dec1(e.position), i: num(e.impressions), c: num(e.clicks) })}${marketWords(e) ? ` · ${marketWords(e)}` : ""}`;
      case "low_ctr": return fill("Clicked {r}% at position {p}; usual here is {u}%", { r: UI.dec(e.click_rate ?? 0), p: dec1(e.position), u: UI.dec(e.expected_rate ?? 0) });
      case "no_click": return fill("{i} impressions at position {p}, 0 clicks", { i: num(e.impressions), p: dec1(e.position) });
      case "compete": return (e.pages || []).slice(0, 2).map((p) => `${pathOf(p.page)} ${p.share}% (${t("pos.")} ${dec1(p.position)})`).join(" · ");
      case "query_down": return fill("Position {a} → {b} · {i} impressions", { a: dec1(e.position_before), b: dec1(e.position), i: num(e.impressions) });
      case "segment": return fill("{a} → {b} clicks; the rest of the site moved {c}", { a: num(e.clicks_before), b: num(e.clicks), c: signed(e.others_change) });
      case "unstable": return fill("Between position {a} and {b} from day to day, usually {p}", { a: dec1(e.better), b: dec1(e.worse), p: dec1(e.position) });
      case "brand_split": return fill("Non-brand {a} → {b} clicks; brand {c} → {d}", { a: num(e.other.clicks_before), b: num(e.other.clicks), c: num(e.brand.clicks_before), d: num(e.brand.clicks) });
      case "slide": return fill("Position {a} → {b} over 8 weeks, a little every week", { a: dec1(e.position_before), b: dec1(e.position) });
      case "page_near": return fill("{n} searches at positions 11 to 30 · {i} impressions", { n: num(e.queries_count), i: num(e.impressions) });
      case "no_page": return e.home ? fill("Only the home page ranks for it, at position {p} · {i} impressions", { p: dec1(e.position), i: num(e.impressions) }) : fill("Ranks through {page}, a page about something else, at position {p}", { page: pathOf(e.page), p: dec1(e.position) });
      case "questions": return fill("{n} questions people ask · {i} impressions", { n: num(e.queries_count), i: num(e.impressions) });
      case "topic": return fill("{n} searches · {i} impressions · average position {p}", { n: num(e.queries_count), i: num(e.impressions), p: dec1(e.position) });
      case "track": return fill("Position {p} · {i} impressions · {c} clicks", { p: dec1(e.position), i: num(e.impressions), c: num(e.clicks) });
      case "lead_page": return `${fill("{n} leads in {d} days", { n: UI.dec(e.leads), d: num(e.days) })}${e.percent !== undefined ? ` · ${fill("clicks {p}%", { p: signed(e.percent) })}` : ""}`;
      case "no_leads": return fill("{c} search clicks and {s} visits in {d} days, 0 leads", { c: num(e.clicks), s: num(e.sessions), d: num(e.days) });
      case "duplicate": return fill("{n} addresses for one page · {i} impressions", { n: num(e.count), i: num(e.impressions) });
      case "shown_broken": return `${fill("Shown {i} times this week", { i: num(e.impressions) })} · ${e.causes.map(cause).join(", ")}`;
      case "data_gaps": return [e.partial?.length ? fill("{n} days only partly read", { n: num(e.partial.length) }) : "", e.verify ? fill("{n} days differ from Search Console", { n: num(e.verify.days) }) : ""].filter(Boolean).join(" · ");
      case "task_result": case "note_result":
        if (!e.ready) return fill("Done {d}. The result is ready on {r}.", { d: dayLabel(e.done), r: dayLabel(e.ready_on) });
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
  const cause = (code) => t({ noindex: "hidden from search engines (noindex)", broken_pages: "answers with an error", server_errors: "server error", canonical_elsewhere: "points to another page", almost_no_text: "almost no text", link_broken: "a link to it is broken", link_redirect: "it redirects" }[code] || code);
  /* The number in the third column: what a reader checks first for that kind. */
  function keyNumber(f) {
    const e = f.evidence || {};
    if (["almost", "top3", "no_click", "low_ctr", "compete", "no_page", "track", "topic"].includes(f.kind)) return `${t("pos.")} ${dec1(e.position)}`;
    if (f.kind === "query_down" || f.kind === "slide") return `${dec1(e.position_before)} → ${dec1(e.position)}`;
    if (f.kind === "unstable") return `${dec1(e.better)}–${dec1(e.worse)}`;
    if (f.kind === "segment" || f.kind === "brand_split") return e.percent === null || e.percent === undefined ? "" : `${e.percent > 0 ? "+" : "−"}${num(Math.abs(e.percent))}%`;
    if (f.kind === "page_near" || f.kind === "questions") return `${num(e.queries_count)} ${t("searches")}`;
    if (f.kind === "lead_page") return leadsLine(e) || `${UI.dec(e.leads)} ${t("leads")}`;
    if (f.kind === "no_leads") return `0 ${t("leads")}`;
    if (f.kind === "duplicate") return `${num(e.count)} ${t("addresses")}`;
    if (f.kind === "task_result" || f.kind === "note_result") return e.ready ? verdictWord(e.verdict) : t("waiting");
    if (f.kind === "page_down" || f.kind === "page_up") return e.percent === null || e.percent === undefined ? t("new") : `${e.percent > 0 ? "+" : "−"}${num(Math.abs(e.percent))}%`;
    if (f.kind === "decay") return `−${num(e.below_peak)}%`;
    if (f.kind === "odd_day") return `${num(e.clicks)} / ${num(Math.round(e.usual))}`;
    if (f.kind === "dropped_out") return t("gone");
    return "";
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
    const main = e.main ? ` ${fill("Mostly: {what} ({n} clicks).", { what: t(PARTS[e.main][up ? 0 : 1]).toLowerCase(), n: signed(e.parts[e.main]) })}` : "";
    return `${host}${head}${demand}${main}`;
  }
  function partsRow(change) {
    const e = change.evidence, up = e.change > 0;
    const parts = Object.entries(e.parts).filter(([, v]) => Math.round(v)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    return `<div class="in-parts" role="list" aria-label="${t("What made up the change")}">${parts.map(([id, v]) => `<span class="in-part ${v < 0 ? "down" : "up"}" role="listitem"><span>${esc(t(PARTS[id][v > 0 ? 0 : 1]))}</span><b>${signed(v)}</b></span>`).join("")}
      <button class="link-btn" data-in-open="${change.id}">${t(up ? "See what gained" : "See what lost")}</button></div>`;
  }

  // ---- what to do: one fixed line per kind -----------------------------------------------------------
  const DO = {
    page_down: "Check the page still works and hasn't changed, then see which of its searches lost places.",
    dropped_out: "Check the page loads and isn't set to noindex, then ask Google to index it again in Search Console.",
    decay: "Bring the page up to date: new facts, this year's numbers, a fuller answer to its main search.",
    odd_day: "Check the site was up that day and nothing was changed on it. A one-off day needs nothing.",
    almost: "Make this page the best answer to the search: put it in the title and H1, and cover what the pages above it cover.",
    top3: "Rewrite the title and description so more people click, and cover what the top 3 pages cover.",
    low_ctr: "Rewrite the title and description so they answer this search plainly.",
    no_click: "Rewrite the title and description so they match what people searching this want.",
    compete: "Pick one page for this search, make it the best, and link the other one to it, or merge them.",
    query_down: "Compare your page with the ones that passed it, and add what they cover.",
    segment: "Open that country or device in Overview to see which pages fell.",
    unstable: "Make one page clearly the answer: the search in its title and H1, and links to it from related pages.",
    brand_split: "Look at non-brand searches in Overview: something lost places behind the brand traffic.",
    slide: "Refresh the page and link to it from your other pages.",
    page_near: "Improve this one page: it lifts all these searches at once.",
    no_page: "Write a page for this search, or give it a clear section on the page that ranks.",
    questions: "Answer these questions on the page, in a short FAQ or in its headings.",
    topic: "Write one strong page on this topic and link to it from the others.",
    track: "Add it to Keywords to follow its rank.",
    lead_page: "Fix this page first, it brings leads: see what changed on it and which searches it lost.",
    no_leads: "Make the next step clear on this page: a form, a phone number, one plain call to action.",
    duplicate: "Point the other addresses to one with a redirect or a canonical tag.",
    shown_broken: "Fix the page: Google keeps showing it, so visitors land on an error.",
    data_gaps: "Read those days again from Overview, with Matches Search Console.",
  };
  /* What the page itself says, when the reader has read it: only ever said when it's true. */
  function onPageLine(f) {
    const o = f.evidence?.on_page;
    if (!o) return "";
    if (!o.title && !o.h1) return t("The search isn't in the page's title or H1: put it there first.");
    if (!o.title) return t("The search isn't in the page's title.");
    if (!o.h1) return t("The search isn't in the page's H1.");
    return t("The search is already in the page's title and H1.");
  }
  const doLine = (f) => (DO[f.kind] ? t(DO[f.kind]) : "");
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
    const names = d.countries.length ? d.countries.map((c) => countryName(c.key)).join(", ") : t("not set yet");
    return `<span class="ov-dot" aria-hidden="true">·</span><span>${t(d.chosen ? "Countries" : "Countries, picked by clicks")}: ${esc(names)} <button class="link-btn" data-in-countries>${t("Change")}</button></span>`;
  }
  function countriesPanel(opener) {
    const d = C.data;
    if (!d) return;
    const picked = new Set(d.countries.map((c) => c.key));
    const options = [...new Map([...d.countries.map((c) => [c.key, { key: c.key, clicks: null }]), ...d.top.map((c) => [c.key, c])]).values()];
    const rows = options.map((c) => `<label class="check-row"><input type="checkbox" name="f_country" value="${esc(c.key)}" ${picked.has(c.key) ? "checked" : ""}> <span>${esc(countryName(c.key))}</span>${c.clicks !== null && c.clicks !== undefined ? `<span class="muted small">${num(c.clicks)} ${t("clicks")}</span>` : ""}</label>`).join("");
    UI.openPanel(`${UI.panelHead(t("Target countries"), t("Quick wins and Keywords read Search Console in these countries"))}<div class="panel-body">
      <form id="in-countries-form"><p class="small muted">${fill("Up to {n}. None ticked: the top country by clicks, and the second when it brings a quarter as many.", { n: num(d.most) })}</p>
        <div class="in-countries">${rows || `<p class="muted">${t("No country data yet.")}</p>`}</div>
        <p class="error" data-in-countries-error hidden></p>
        <div class="panel-actions"><button class="btn btn-main" type="submit">${t("Save")}</button></div></form></div>`, opener);
  }

  // ---- the page -----------------------------------------------------------------------------------
  function page() {
    const entry = load();
    const run = `<button class="btn" data-in-run>${icon("refresh-cw")}${t("Run again")}</button>`;
    const head = UI.topbar(t("Insights"), t("What the code found in your Search Console data, worked out after each new day"), entry.data?.summary?.ran_at ? run : "", false);
    const wrap = (body) => `${head}<div class="content page-enter in">${body}</div>`;
    if (entry.loading) return wrap(UI.skeleton ? UI.skeleton("page", { tiles: 3, chart: false }) : `<section class="card" aria-busy="true"><div class="empty"><p>${t("Loading…")}</p></div></section>`);
    if (entry.noServer) return wrap(`<section class="card"><div class="empty"><h3>${t("Needs the running app")}</h3><p>${t("Opened as a plain file there's no real data to show here.")}</p></div></section>`);
    if (entry.error) return wrap(UI.failCard ? UI.failCard(entry.error, { retry: "data-in-retry" }) : `<section class="card"><div class="empty"><h3>${t("That didn't load")}</h3><p>${esc(t(entry.error))}</p><div class="ov-empty-act"><button class="btn" data-in-retry>${t("Try again")}</button></div></div></section>`);
    const d = entry.data, s = d.summary;
    // No site yet: the server has nothing to sum up (F199).
    if (!s) return wrap(`<section class="card"><div class="empty"><h3>${t("No site yet")}</h3><p>${t("Add a site and connect Search Console: insights are worked out from its data.")}</p><div class="ov-empty-act"><button class="btn btn-main" data-lv-add-site>${t("Add a site")}</button></div></div></section>`);
    if (!s.ran_at) return wrap(`<section class="card"><div class="empty"><h3>${t("Nothing worked out yet")}</h3><p>${t("Insights run by themselves after each new day of Search Console data. Run them now to see the first ones.")}</p><div class="ov-empty-act"><button class="btn btn-main" data-in-run>${icon("refresh-cw")}${t("Run")}</button></div></div></section>`);
    const changes = s.changes || [];
    aiSettings();
    const top = changes.length ? `<div class="in-answer">${changes.slice(0, 3).map((c) => `<p class="ov-answer" dir="auto">${esc(answer(c, changes.length > 1))}</p>`).join("")}${changes.length === 1 && !changes[0].evidence.steady ? partsRow(changes[0]) : ""}${changes.length === 1 ? weeklyBlock(changes[0]) : ""}</div>` : "";
    const figs = `<div class="in-figs">
      <div class="in-fig"><div class="lab">${t("Still open")}</div><div class="fig">${num(s.open)}</div></div>
      <div class="in-fig"><div class="lab">${t("Clicks a month at stake")}</div><div class="fig">${num(s.at_stake)}</div></div>
      <div class="in-fig"><div class="lab">${t("Fixed or gone in 30 days")}</div><div class="fig">${num(s.fixed)}</div></div>
    </div>`;
    const trust = `<p class="ov-trust small" role="status"><span>${icon("clock")}${t("Worked out")} ${esc(since(s.ran_at))}</span><span class="ov-dot" aria-hidden="true">·</span><span>${t("Final days only, last 28 days against the 28 before")}</span>${countriesLine()}</p>`;
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
    if (IN.tab === "wins" && needs.low_ctr === "brand_words") notes.push(`${t("Low click rates need your brand words: brand searches are clicked far more and would make every other query look weak.")} <a href="#overview">${t("Add them on Overview")}</a>`);
    if ((IN.tab === "decline" && needs.decay) || (IN.tab === "changed" && needs.page_down)) notes.push(t("Needs more saved history: slow decline looks at 16 weeks, changes at 8."));
    if (IN.tab === "leads" && needs.lead_page === "key_events") notes.push(t("GA4 has no key events for this site yet. Mark your form or call event as a key event in GA4, and leads show here."));
    if (IN.tab === "changed" && needs.brand_split === "brand_words") notes.push(`${t("Add your brand words to see when brand searches hide a loss.")} <a href="#overview">${t("Add them on Overview")}</a>`);
    const hint = {
      first: "The biggest of everything, one row per query or page.", changed: "Last 28 days against the 28 before, plus odd days this week.",
      decline: "Pages and searches sliding a little every week.", wins: "Searches a small push would pay for, using this site's own click rates.",
      leads: "Search clicks joined with GA4's key events over 90 days.", technical: "What the Search Console data says about addresses, broken pages and missing days.",
      impact: "Done tasks and dated notes: 28 days before against 28 days from a week after.",
    }[IN.tab];
    return `<section class="card ov-tabs-card"><div class="card-head ov-tabs-head">${tabs}</div>${controls}
      <p class="small muted ov-hint">${t(hint)}</p>${notes.map((n) => `<p class="small ov-hint in-need">${n}</p>`).join("")}${table(d.rows)}</section>`;
  }

  function table(all) {
    if (!all.length) return `<div class="empty"><p>${t(IN.status === "open" ? "Nothing here right now. That's good news." : "Nothing here.")}</p></div>`;
    const many = !UI.siteIdPicked();
    // The server ranks by clicks a month at stake, biggest first; the heading turns it round.
    const found = all.filter((f) => TP.matches(PAGES, titleOf(f), reasonOf(f), kindName(f), many ? f.host : ""));
    if (!found.length) return `<div class="empty"><p>${t("No finding matches this search.")}</p><button class="btn" data-in-search-clear>${t("Clear the search")}</button></div>`;
    const rows = IN.sortDir === "asc" ? [...found].sort((a, b) => (a.at_stake || 0) - (b.at_stake || 0)) : found;
    const view = TP.view(PAGES, rows);
    const body = view.rows.map((f) => `<tr class="ov-row" data-in-open="${f.id}" tabindex="0">
      <td class="head-cell" data-label="${t("What")}"><div class="in-what"><span class="in-kind ${f.group}">${esc(kindName(f))}</span>${f.evidence?.seasonal ? `<span class="in-season">${t("Seasonal")}</span>` : ""}${f.task ? `<span class="in-task">${icon("square-check")}${t(f.task === "done" ? "Task done" : "Task open")}</span>` : ""}${many ? `<span class="muted small">${esc(f.host)}</span>` : ""}</div>
        <div class="t" dir="auto">${esc(titleOf(f))}</div><div class="s muted small" dir="auto">${esc(reasonOf(f))}</div></td>
      <td class="c" data-label="${t("Clicks a month")}">${f.at_stake >= 1 ? num(Math.round(f.at_stake)) : "—"}</td>
      <td class="c" data-label="${t("Key number")}">${esc(keyNumber(f))}</td>
      <td class="c in-act-col"><button class="btn btn-small btn-ghost" data-in-open="${f.id}">${t("Open")}</button></td></tr>`).join("");
    const sortHead = `<th class="c" scope="col" aria-sort="${IN.sortDir === "asc" ? "ascending" : "descending"}"><button type="button" class="th-btn" data-in-sort>${t("Clicks a month")}${icon(IN.sortDir === "asc" ? "arrow-up" : "arrow-down")}</button></th>`;
    return `<div class="table-wrap ov-table in-table"><table class="data"><thead><tr><th scope="col">${t("What")}</th>${sortHead}<th class="c" scope="col">${t("Key number")}</th><th class="c" scope="col"><span class="sr">${t("Open")}</span></th></tr></thead><tbody>${body}</tbody></table></div>
      ${TP.footer(PAGES, view, { noun: t(view.total === 1 ? "finding" : "findings") })}`;
  }

  // ---- AI, on a click only ------------------------------------------------------------------------
  const AI_ASK = { explain: "Explain this", titles: "Suggest titles", brief: "Write a brief", faq: "Write an FAQ", compete: "Which page to keep", weekly: "Summary by AI" };
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
    if (info.provider === "none") return `<h3 class="ov-h3">${t("With AI")}</h3><p class="small muted">${t("No AI is chosen for this site yet. Pick one in Settings → AI. Nothing about the site is sent until you do.")} <a href="#settings">${t("Open Settings")}</a></p>`;
    const ready = aiReady(info.provider);
    const head = `<h3 class="ov-h3">${t("With AI")} <span class="muted small">${t(info.provider === "claude" ? "Claude, from your Anthropic key" : "OpenRouter's free models")}</span></h3>`;
    if (!ready && !Object.keys(kept).length) return `${head}<p class="small muted">${t(info.provider === "claude" ? "Paste an Anthropic key in Settings to use Claude here." : "Connect OpenRouter in Settings, or pick Claude for this site, to use AI here.")} <a href="#settings">${t("Open Settings")}</a></p>`;
    const buttons = info.purposes.filter((p) => !kept[p]).map((p) => `<button class="btn btn-small" data-in-ai="${p}" ${ready ? "" : "disabled"}>${icon("sparkles")}${t(AI_ASK[p])}</button>`).join("");
    return `${head}<div class="in-ai">${info.purposes.filter((p) => kept[p]).map((p) => aiAnswer(p, kept[p])).join("")}${buttons ? `<div class="in-ai-buttons">${buttons}</div>` : ""}
      <p class="small muted">${t("Only the numbers above and the page's title and headings are sent. AI never changes what's found or how it's ranked.")}</p></div>`;
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
    return `<button class="link-btn in-weekly-btn" data-in-weekly="${change.id}">${icon("sparkles")}${t("Summary by AI")}</button>`;
  }

  // ---- one finding, in the side panel ---------------------------------------------------------------
  function evidenceList(f) {
    const e = f.evidence || {};
    const li = (label, value) => `<li><div class="what"><div class="t">${esc(t(label))}</div></div><span>${value}</span></li>`;
    const rows = [];
    if (f.kind === "change") {
      Object.entries(e.parts).filter(([, v]) => Math.round(v)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).forEach(([id, v]) => rows.push(li(PARTS[id][v > 0 ? 0 : 1], signed(v))));
      const brand = e.brand ? `<h3 class="ov-h3">${t("Brand and non-brand searches")}</h3><ul class="rows ov-split">${[["brand", "Brand"], ["other", "Non-brand"]].map(([k, name]) => li(name, `${num(e.brand[k].clicks_before)} → ${num(e.brand[k].clicks)}`)).join("")}</ul>` : "";
      const season = e.last_year ? `<p class="small ${e.seasonal ? "" : "muted"}">${e.seasonal ? `<b>${t("Seasonal")}</b>: ` : ""}${fill("The same weeks last year: {a} → {b} clicks ({p}%).", { a: num(e.last_year.clicks_before), b: num(e.last_year.clicks), p: signed(e.last_year.percent) })}</p>` : "";
      return `<ul class="rows ov-split">${rows.join("")}</ul>${season}${brand}${moversList(e)}`;
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
    const queryRow = (q) => q.clicks_before !== undefined
      ? `<li><div class="what"><div class="t" dir="auto">${esc(q.query)}</div><div class="s muted">${t("pos.")} ${dec1(q.position_before)} → ${dec1(q.position)}</div></div><span>${num(q.clicks_before)} → ${num(q.clicks)}</span></li>`
      : `<li><div class="what"><div class="t" dir="auto">${esc(q.query)}</div><div class="s muted">${t("pos.")} ${dec1(q.position)} · ${num(q.impressions)} ${t("impressions")}</div></div><span>${num(q.clicks)} ${t("clicks")}</span></li>`;
    const queriesTitle = { questions: "Questions people ask", topic: "Its biggest searches", page_near: "Searches just past page 1" }[f.kind] || "Queries behind it";
    const queries = e.queries?.length ? `<h3 class="ov-h3">${t(queriesTitle)}</h3><ul class="rows ov-split">${e.queries.map(queryRow).join("")}</ul>` : "";
    const variants = e.variants?.length ? `<h3 class="ov-h3">${t("Its addresses on Google")}</h3><ul class="rows ov-split">${e.variants.map((v) => `<li><div class="what"><div class="t" dir="auto">${pageLink(v.page, { text: v.page })}</div><div class="s muted">${t("pos.")} ${dec1(v.position)} · ${num(v.clicks)} ${t("clicks")}</div></div><span>${num(v.impressions)}</span></li>`).join("")}</ul>
      <p class="small muted">${t("Point the others to one address with a redirect or a canonical tag, so Google adds them up.")}${e.kinds?.length ? ` ${t("They differ by")}: ${e.kinds.map((k) => t({ query: "a query string", scheme: "http or https", www: "www", slash: "the last slash", case: "capital letters" }[k] || k)).join(", ")}.` : ""}</p>` : "";
    const results = e.before && e.after ? `<h3 class="ov-h3">${fill("28 days before {d}, against 28 days from a week after", { d: dayLabel(e.done) })}</h3><ul class="rows ov-split">
      <li><div class="what"><div class="t">${t("Clicks")}</div></div><span>${num(e.before.clicks)} → ${num(e.after.clicks)}</span></li>
      <li><div class="what"><div class="t">${t("Impressions")}</div></div><span>${num(e.before.impressions)} → ${num(e.after.impressions)}</span></li>
      <li><div class="what"><div class="t">${t("Position")}</div></div><span>${dec1(e.before.position)} → ${dec1(e.after.position)}</span></li>
      <li><div class="what"><div class="t">${t("Click rate")}</div></div><span>${e.before.click_rate ?? "—"}% → ${e.after.click_rate ?? "—"}%</span></li></ul>
      <p class="small muted">${t(e.on === "site" ? "The whole site, around the day of the note." : e.on === "keywords" ? "The task's keywords." : "The task's pages.")}</p>` : "";
    const season = e.last_year ? `<p class="small ${e.seasonal ? "" : "muted"}">${e.seasonal ? `<b>${t("Seasonal")}</b>: ` : ""}${fill("The same weeks last year: {a} → {b} clicks ({p}%).", { a: num(e.last_year.clicks_before), b: num(e.last_year.clicks), p: signed(e.last_year.percent) })}${e.seasonal ? ` ${t("So it counts half.")}` : ""}</p>` : "";
    const leads = leadsLine(e) ? `<p class="small">${esc(leadsLine(e))} ${t("at stake")} <span class="muted">(${fill(e.lead_rate?.basis === "page" ? "this page turns {r}% of visits into leads" : "the site turns {r}% of visits into leads", { r: UI.dec(e.lead_rate?.rate ?? 0) })})</span></p>` : "";
    const gaps = f.kind === "data_gaps" ? `<p class="small">${e.partial?.length ? `${t("Days Search Console gave only part of")}: ${e.partial.map((d) => esc(dayLabel(d))).join(", ")}. ` : ""}${e.verify ? fill("The last “Matches Search Console” check found {n} days that differ. Read them again from Overview.", { n: num(e.verify.days) }) : ""}</p>` : "";
    const pages = e.pages?.length ? `<h3 class="ov-h3">${t("Pages that share it")}</h3><ul class="rows ov-split">${e.pages.map((p) => `<li><div class="what"><div class="t" dir="auto">${pageLink(p.page, { text: pathOf(p.page) })}</div><div class="s muted">${t("pos.")} ${dec1(p.position)} · ${num(p.clicks)} ${t("clicks")}</div></div><span>${p.share}%</span></li>`).join("")}</ul>` : "";
    const causes = e.causes?.length ? `<p class="small">${t("The last health test or Links Checker saw")}: ${e.causes.map((c) => esc(cause(c))).join(", ")}.</p>` : f.kind === "dropped_out" ? `<p class="small muted">${t("The last health test saw nothing wrong with it. Check it in Search Console's page indexing report.")}</p>` : "";
    const page = f.page && !PAGE_IS_SUBJECT.includes(f.kind) ? `<p class="small muted">${t("Page that ranks")}: ${pageLink(f.page, { text: pathOf(f.page) })}</p>` : "";
    return `${list}${season}${leads}${page}${queries}${variants}${pages}${results}${gaps}${causes}`;
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
      query_down: "Its impressions now × (the click rate this site usually gets at its old position − at its new one), as a month.",
      segment: "The clicks it lost against the 28 days before, as a month.",
      unstable: "What it would bring if it stayed at its better days' position, as a month.",
      brand_split: "The non-brand clicks lost against the 28 days before, as a month.",
      slide: "Its weekly impressions × (the click rate this site usually gets at its position 8 weeks ago − now), as a month.",
      page_near: "For each of these searches: its impressions × the click rate this site usually gets at position {p}, less the clicks it has, as a month.",
      no_page: "Its impressions × the click rate this site usually gets at position {p}, less the clicks it has, as a month.",
      topic: "The topic's impressions × the click rate this site usually gets at position {p}, less the clicks it has, as a month.",
      lead_page: "The clicks at stake of the page's drop. Leads: those clicks × the page's own lead rate.",
      shown_broken: "The clicks it had in the last 28 days, as a month.",
    }[f.kind];
    const aio = e.ai_overview ? `<p class="small muted in-how">${icon("sparkles")}${esc(fill("Counted at {p}%: Google shows an AI Overview on this search ({d}), which takes some of the clicks.", { p: num(Math.round((e.ai_overview.share || 0) * 100)), d: dayLabel(e.ai_overview.checked) }))}</p>` : "";
    return `${words ? `<p class="small muted in-how">${icon("info")}${esc(fill(words, { p: e.target ?? "" }))}</p>` : ""}${aio}`;
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
    const where = f.page ? `<p class="small">${pageLink(f.page, { text: pathOf(f.page), host: f.host })}</p>` : "";
    UI.openPanel(`${UI.panelHead(title, sub)}<div class="panel-body">${stake}${where}${f.kind !== "change" ? `<p class="small" dir="auto">${esc(reasonOf(f))}</p>` : ""}${doBlock(f)}${chart}${evidenceList(f)}${stakeWords(f)}${aiBlock(f)}
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
      description: [e.path ? f.page : "", onPageLine(f), doLine(f)].filter(Boolean).join("\n"),
    });
  }
  function bind() {
    document.addEventListener("click", async (e) => {
      if (UI.state.route !== "insights" && !UI.$("#panel")) return;
      const hit = (sel) => e.target.closest?.(sel);
      let el;
      if ((el = hit("[data-in-tab]"))) { IN.tab = el.dataset.inTab; TP.reset(PAGES); UI.render({ keepScroll: true }); UI.$(`[data-in-tab="${IN.tab}"]`)?.focus({ preventScroll: true }); return; }
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
    document.addEventListener("submit", async (e) => {
      if (e.target.id !== "in-countries-form") return;
      e.preventDefault();
      const countries = [...e.target.querySelectorAll('input[name="f_country"]:checked')].map((x) => x.value);
      const error = e.target.querySelector("[data-in-countries-error]");
      try {
        C.data = await window.COMP.api("PUT", "search/countries", { site_id: UI.siteIdPicked(), countries });
        UI.closePanel(); forget(); UI.render({ keepScroll: true });
        UI.toast(t("Saved. The next Search Console pull reads those countries."));
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
    "No site yet": "Pas encore de site", "Add a site and connect Search Console: insights are worked out from its data.": "Ajoutez un site et connectez la Search Console : les analyses sont calculées à partir de ses données.",
    "No AI is chosen for this site yet. Pick one in Settings → AI. Nothing about the site is sent until you do.": "Aucune IA n'est encore choisie pour ce site. Choisissez-en une dans Réglages → IA. Rien sur le site n'est envoyé avant.",
    "Add a site": "Ajouter un site", "Run": "Lancer", "What to do": "Que faire",
    "The search isn't in the page's title or H1: put it there first.": "La recherche n'est ni dans le titre ni dans le H1 de la page : mettez-la d'abord là.",
    "The search isn't in the page's title.": "La recherche n'est pas dans le titre de la page.", "The search isn't in the page's H1.": "La recherche n'est pas dans le H1 de la page.",
    "The search is already in the page's title and H1.": "La recherche est déjà dans le titre et le H1 de la page.",
    "Check the page still works and hasn't changed, then see which of its searches lost places.": "Vérifiez que la page fonctionne et n'a pas changé, puis voyez lesquelles de ses recherches ont perdu des places.",
    "Check the page loads and isn't set to noindex, then ask Google to index it again in Search Console.": "Vérifiez que la page se charge et n'est pas en noindex, puis demandez à Google de la réindexer dans la Search Console.",
    "Bring the page up to date: new facts, this year's numbers, a fuller answer to its main search.": "Mettez la page à jour : faits récents, chiffres de cette année, réponse plus complète à sa recherche principale.",
    "Check the site was up that day and nothing was changed on it. A one-off day needs nothing.": "Vérifiez que le site était en ligne ce jour-là et que rien n'a changé. Un jour isolé ne demande rien.",
    "Make this page the best answer to the search: put it in the title and H1, and cover what the pages above it cover.": "Faites de cette page la meilleure réponse à la recherche : mettez-la dans le titre et le H1, et traitez ce que traitent les pages au-dessus.",
    "Rewrite the title and description so more people click, and cover what the top 3 pages cover.": "Réécrivez le titre et la description pour que plus de gens cliquent, et traitez ce que traitent les 3 premières pages.",
    "Rewrite the title and description so they answer this search plainly.": "Réécrivez le titre et la description pour qu'ils répondent clairement à cette recherche.",
    "Rewrite the title and description so they match what people searching this want.": "Réécrivez le titre et la description pour qu'ils correspondent à ce que veulent les gens qui cherchent cela.",
    "Pick one page for this search, make it the best, and link the other one to it, or merge them.": "Choisissez une page pour cette recherche, rendez-la la meilleure, et faites un lien de l'autre vers elle, ou fusionnez-les.",
    "Compare your page with the ones that passed it, and add what they cover.": "Comparez votre page à celles qui l'ont dépassée, et ajoutez ce qu'elles traitent.",
    "Open that country or device in Overview to see which pages fell.": "Ouvrez ce pays ou cet appareil dans Vue d'ensemble pour voir quelles pages ont baissé.",
    "Make one page clearly the answer: the search in its title and H1, and links to it from related pages.": "Faites d'une page la réponse claire : la recherche dans son titre et son H1, et des liens vers elle depuis les pages proches.",
    "Look at non-brand searches in Overview: something lost places behind the brand traffic.": "Regardez les recherches hors marque dans Vue d'ensemble : quelque chose a perdu des places derrière le trafic de marque.",
    "Refresh the page and link to it from your other pages.": "Rafraîchissez la page et faites des liens vers elle depuis vos autres pages.",
    "Improve this one page: it lifts all these searches at once.": "Améliorez cette seule page : elle fait monter toutes ces recherches à la fois.",
    "Write a page for this search, or give it a clear section on the page that ranks.": "Écrivez une page pour cette recherche, ou donnez-lui une section claire sur la page qui se classe.",
    "Answer these questions on the page, in a short FAQ or in its headings.": "Répondez à ces questions sur la page, dans une courte FAQ ou dans ses intertitres.",
    "Write one strong page on this topic and link to it from the others.": "Écrivez une page forte sur ce sujet et faites des liens vers elle depuis les autres.",
    "Add it to Keywords to follow its rank.": "Ajoutez-la aux mots-clés pour suivre son classement.",
    "Fix this page first, it brings leads: see what changed on it and which searches it lost.": "Corrigez d'abord cette page, elle apporte des leads : voyez ce qui a changé et quelles recherches elle a perdues.",
    "Make the next step clear on this page: a form, a phone number, one plain call to action.": "Rendez l'étape suivante claire sur cette page : un formulaire, un numéro, un appel à l'action simple.",
    "Point the other addresses to one with a redirect or a canonical tag.": "Faites pointer les autres adresses vers une seule, par une redirection ou une balise canonique.",
    "Fix the page: Google keeps showing it, so visitors land on an error.": "Corrigez la page : Google continue de l'afficher, et les visiteurs tombent sur une erreur.",
    "Read those days again from Overview, with Matches Search Console.": "Relisez ces jours depuis Vue d'ensemble, avec « Conforme à la Search Console ».",
    "in {c}; worldwide {p}": "en {c} ; monde {p}", "Countries": "Pays", "Countries, picked by clicks": "Pays, choisis d'après les clics", "not set yet": "pas encore définis", "Change": "Modifier",
    "Target countries": "Pays visés", "Quick wins and Keywords read Search Console in these countries": "Les gains rapides et les mots-clés lisent la Search Console dans ces pays",
    "Up to {n}. None ticked: the top country by clicks, and the second when it brings a quarter as many.": "Jusqu'à {n}. Aucun coché : le premier pays en clics, et le deuxième s'il en apporte au moins le quart.",
    "No country data yet.": "Pas encore de données par pays.", "Save": "Enregistrer", "clicks": "clics", "Saved. The next Search Console pull reads those countries.": "Enregistré. La prochaine lecture de la Search Console lit ces pays.",
    "Counted at {p}%: Google shows an AI Overview on this search ({d}), which takes some of the clicks.": "Compté à {p} % : Google affiche un AI Overview sur cette recherche ({d}), qui prend une partie des clics.",
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
    "Explain this": "Expliquer", "Suggest titles": "Proposer des titres", "Write a brief": "Écrire un brief", "Write an FAQ": "Écrire une FAQ", "Which page to keep": "Quelle page garder",
    "Summary by AI": "Résumé par l'IA", "Written by AI": "Écrit par l'IA", "a free model": "un modèle gratuit", "Ask again": "Redemander", "Writing…": "Rédaction…", "Copied": "Copié",
    "Select the text to copy it.": "Sélectionnez le texte pour le copier.", "With AI": "Avec l'IA", "Claude, from your Anthropic key": "Claude, avec votre clé Anthropic", "OpenRouter's free models": "Les modèles gratuits d'OpenRouter",
    "Paste an Anthropic key in Settings to use Claude here.": "Collez une clé Anthropic dans les réglages pour utiliser Claude ici.",
    "Connect OpenRouter in Settings, or pick Claude for this site, to use AI here.": "Connectez OpenRouter dans les réglages, ou choisissez Claude pour ce site, pour utiliser l'IA ici.", "Open Settings": "Ouvrir les réglages",
    "Only the numbers above and the page's title and headings are sent. AI never changes what's found or how it's ranked.": "Seuls les chiffres ci-dessus et le titre et les intertitres de la page sont envoyés. L'IA ne change jamais ce qui est trouvé ni son classement.",
    "Paste an Anthropic key in Settings first, or pick OpenRouter's free models for this site.": "Collez d'abord une clé Anthropic dans les réglages, ou choisissez les modèles gratuits d'OpenRouter pour ce site.",
    "Connect OpenRouter in Settings first, or pick Claude for this site.": "Connectez d'abord OpenRouter dans les réglages, ou choisissez Claude pour ce site.",
    "Anthropic refused this key. Paste it again in Settings.": "Anthropic a refusé cette clé. Collez-la à nouveau dans les réglages.", "Claude declined to answer this one.": "Claude a refusé de répondre à celle-ci.",
    "Claude gave no answer. Try again.": "Claude n'a pas répondu. Réessayez.", "Claude is busy or down right now. Try again in a moment.": "Claude est occupé ou indisponible. Réessayez dans un instant.",
    "The Anthropic account is out of credit. Add some in the Claude Console.": "Le compte Anthropic n'a plus de crédit. Ajoutez-en dans la Claude Console.",
    "Anthropic says too many requests right now. Try again in a minute.": "Anthropic signale trop de requêtes. Réessayez dans une minute.", "Anthropic couldn't be reached. Try again in a moment.": "Anthropic est injoignable. Réessayez dans un instant.",
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
    "{a} → {b} clicks; the rest of the site moved {c}": "{a} → {b} clics ; le reste du site a bougé de {c}",
    "Between position {a} and {b} from day to day, usually {p}": "Entre la position {a} et {b} d'un jour à l'autre, d'habitude {p}",
    "Non-brand {a} → {b} clicks; brand {c} → {d}": "Hors marque {a} → {b} clics ; marque {c} → {d}",
    "Position {a} → {b} over 8 weeks, a little every week": "Position {a} → {b} en 8 semaines, un peu chaque semaine",
    "{n} searches at positions 11 to 30 · {i} impressions": "{n} recherches en positions 11 à 30 · {i} impressions",
    "Only the home page ranks for it, at position {p} · {i} impressions": "Seule la page d'accueil se classe dessus, en position {p} · {i} impressions",
    "Ranks through {page}, a page about something else, at position {p}": "Se classe via {page}, une page sur un autre sujet, en position {p}",
    "{n} questions people ask · {i} impressions": "{n} questions que les gens posent · {i} impressions", "{n} searches · {i} impressions · average position {p}": "{n} recherches · {i} impressions · position moyenne {p}",
    "{n} leads in {d} days": "{n} leads en {d} jours", "clicks {p}%": "clics {p} %", "{c} search clicks and {s} visits in {d} days, 0 leads": "{c} clics de recherche et {s} visites en {d} jours, 0 lead",
    "{n} addresses for one page · {i} impressions": "{n} adresses pour une page · {i} impressions", "Shown {i} times this week": "Affichée {i} fois cette semaine",
    "{n} days only partly read": "{n} jours lus en partie seulement", "{n} days differ from Search Console": "{n} jours diffèrent de la Search Console",
    "Done {d}. The result is ready on {r}.": "Fait le {d}. Le résultat sera prêt le {r}.", "{a} → {b} clicks in 28 days": "{a} → {b} clics en 28 jours",
    "{path} is new on Google": "{path} est nouvelle sur Google", "new": "nouvelle", "searches": "recherches", "leads": "leads", "addresses": "adresses", "waiting": "en attente",
    "Its impressions now × (the click rate this site usually gets at its old position − at its new one), as a month.": "Ses impressions actuelles × (le taux de clic habituel du site à son ancienne position − à la nouvelle), ramenées au mois.",
    "What it would bring if it stayed at its better days' position, as a month.": "Ce qu'elle apporterait si elle restait à la position de ses meilleurs jours, ramené au mois.",
    "The non-brand clicks lost against the 28 days before, as a month.": "Les clics hors marque perdus par rapport aux 28 jours d'avant, ramenés au mois.",
    "Its weekly impressions × (the click rate this site usually gets at its position 8 weeks ago − now), as a month.": "Ses impressions par semaine × (le taux de clic habituel du site à sa position d'il y a 8 semaines − maintenant), ramenées au mois.",
    "For each of these searches: its impressions × the click rate this site usually gets at position {p}, less the clicks it has, as a month.": "Pour chacune de ces recherches : ses impressions × le taux de clic habituel du site en position {p}, moins ses clics, ramené au mois.",
    "Its impressions × the click rate this site usually gets at position {p}, less the clicks it has, as a month.": "Ses impressions × le taux de clic habituel du site en position {p}, moins ses clics, ramené au mois.",
    "The topic's impressions × the click rate this site usually gets at position {p}, less the clicks it has, as a month.": "Les impressions du sujet × le taux de clic habituel du site en position {p}, moins ses clics, ramené au mois.",
    "The clicks at stake of the page's drop. Leads: those clicks × the page's own lead rate.": "Les clics en jeu de la baisse de la page. Leads : ces clics × le taux de leads de la page.",
    "The clicks it had in the last 28 days, as a month.": "Les clics qu'elle a eus les 28 derniers jours, ramenés au mois.",
    "Questions people ask": "Questions que les gens posent", "Its biggest searches": "Ses plus grosses recherches", "Searches just past page 1": "Recherches juste après la page 1",
    "Its addresses on Google": "Ses adresses sur Google", "Point the others to one address with a redirect or a canonical tag, so Google adds them up.": "Faites pointer les autres vers une seule adresse, par une redirection ou une balise canonique, pour que Google les additionne.",
    "They differ by": "Elles diffèrent par", "a query string": "des paramètres après ?", "http or https": "http ou https", "the last slash": "la barre finale", "capital letters": "les majuscules",
    "28 days before {d}, against 28 days from a week after": "28 jours avant le {d}, contre 28 jours à partir d'une semaine après",
    "The whole site, around the day of the note.": "Tout le site, autour du jour de la note.", "The task's keywords.": "Les mots-clés de la tâche.", "The task's pages.": "Les pages de la tâche.",
    "Seasonal": "Saisonnier", "The same weeks last year: {a} → {b} clicks ({p}%).": "Les mêmes semaines l'an dernier : {a} → {b} clics ({p} %).", "So it counts half.": "Elle compte donc pour moitié.",
    "at stake": "en jeu", "this page turns {r}% of visits into leads": "cette page transforme {r} % des visites en leads", "the site turns {r}% of visits into leads": "le site transforme {r} % des visites en leads",
    "Days Search Console gave only part of": "Jours que la Search Console n'a donnés qu'en partie",
    "The last “Matches Search Console” check found {n} days that differ. Read them again from Overview.": "La dernière vérification « Conforme à la Search Console » a trouvé {n} jours différents. Relisez-les depuis la Vue d'ensemble.",
    "Brand and non-brand searches": "Recherches de marque et hors marque", "Brand": "Marque", "Non-brand": "Hors marque",
    "GA4 has no key events for this site yet. Mark your form or call event as a key event in GA4, and leads show here.": "GA4 n'a pas encore d'événement clé pour ce site. Marquez votre formulaire ou votre appel comme événement clé dans GA4, et les leads apparaîtront ici.",
    "Add your brand words to see when brand searches hide a loss.": "Ajoutez vos mots de marque pour voir quand les recherches de marque cachent une perte.",
    "Pages and searches sliding a little every week.": "Pages et recherches qui reculent un peu chaque semaine.", "Searches a small push would pay for, using this site's own click rates.": "Recherches pour lesquelles un petit effort paierait, d'après les taux de clic du site.",
    "Search clicks joined with GA4's key events over 90 days.": "Les clics de recherche joints aux événements clés de GA4 sur 90 jours.",
    "What the Search Console data says about addresses, broken pages and missing days.": "Ce que disent les données de la Search Console sur les adresses, les pages cassées et les jours manquants.",
    "Done tasks and dated notes: 28 days before against 28 days from a week after.": "Tâches faites et notes datées : 28 jours avant contre 28 jours à partir d'une semaine après.",
    "Search findings": "Chercher un constat", "No finding matches this search.": "Aucun constat ne correspond à cette recherche.", "finding": "constat", "findings": "constats",
  };
  Object.keys(words).forEach((w) => { if (window.FR[w] === undefined) window.FR[w] = words[w]; });
})();
