/* AI search (redesigned 2026-11-10). It answers two questions: do AI assistants send me leads, and do AI answers cite me?
   Today's order: the answer, four numbers, the weekly chart beside at most three next actions, one card with tabs, then
   Google's AI Overviews. Every card names its source and period in its header (a chip), and a source that fails only
   greys its own card: the rest still shows. The numbers come from /api/metrics/ai (seo/metrics/ai_search.py).

   The simpler screens (UI.simple(), ?simple=1; plan-seo-command-center-simplify-screens-like-mickaz.md, section 2, track T7).
   With the switch off, nothing below changes. With it on:
   - The head (UI.head) says the dates, the comparison and one sources chip ("4 sources up to date ›", amber or red when one
     needs the owner) that opens the Sources panel. Its (i) holds the screen's sentence and "Google Analytics hid rows".
     Refresh data is one button: refreshing one source, uploading a Clarity download and checking AI Overviews are in Sources.
   - The answer keeps its two lines; the sources line under it goes (it is the head's chip).
   - Four number cards (UI.card): AI visits with its weekly graph, Leads, Lead rate ("organic search 7.3%" under it) and
     Copilot citations ("Upload a Clarity AI download" under it while there is none).
   - AI visits per week: Clarity live beside Google Analytics once connected, one line with Connect until then. Its small
     print ("Weeks count only the days read", the second opinion) goes behind (i)s.
   - Next actions: one row each, Compare visible, Task on hover (.row-act), no grey second line.
   - One card, tabs in the underline look: Assistants · Landing pages · Cited pages · Questions to win, and Google AI report
     as a fifth once one is uploaded. "Edit the AI list" and Filter sit in its head, each tab's small print in its (i).
     A row opens its panel (UI.rowPanel): an assistant's, or a page's.
   - One line for Google's AI Overviews with Open the watch. Check now is in Sources and asks here before spending.
   - Google's AI report upload and its how-to are in the Sources panel. The closing note is the tabs card's (i).
   - One request on first open (metrics/ai, through SCREEN_DATA). The AI report loads quietly after the first draw, and the
     AI Overview check's price only when Check now is asked. The logo timer goes through SCREEN_DATA.logos(). */
(() => {
  "use strict";
  let UI = null, t, esc, num, icon;
  const A = { tab: "assistants", fold: new Set(), menu: false, aio: { key: "", preview: null, asking: false, confirm: false, run: null }, listBusy: false };
  window.AISearch = A;
  const fill = (text, values) => String(text).replace(/\{(\w+)\}/g, (_, k) => String(values?.[k] ?? ""));
  const tf = (text, values) => fill(t(text), values);
  const LVx = () => window.LV;
  const day = (iso) => (iso ? LVx().shortDay(iso.slice(0, 10)) : "—");
  const stamp = (iso) => (iso ? `${day(iso)} ${iso.slice(11, 16)} UTC` : "—");
  const unit = () => (UI.state.lang === "fr" ? " %" : "%"); // English writes 38.5%, French 38,5 %
  const share = (v) => (v === null || v === undefined ? "—" : `${UI.dec(Math.round(v * 10) / 10)}${unit()}`);
  const pct = (v) => { const out = LVx().pct(v); return out === "—" ? out : out.replace(/ %$/, unit()); };
  const plural = (n, one, many) => tf(n === 1 ? one : many, { n: num(n) });
  const simple = () => Boolean(UI?.simple?.()); // the simpler screens switch (mockup.js)
  const SD = () => (simple() && window.SCREEN_DATA?.on?.() ? window.SCREEN_DATA : null); // the shared 5-minute cache, when it acts

  /* Rows of 1 (a page cited once, a page with one visit) say little each. Five or more of them fold into one line, and when
     every row is 1 the table becomes a sentence. Pure, so it's tested on its own (tests/js/ai_search.cjs). */
  function foldRows(rows, test, min = 5) {
    const ones = rows.filter(test).length;
    if (ones < min) return { kept: rows.length, folded: 0, all: false };
    return { kept: rows.length - ones, folded: ones, all: ones === rows.length };
  }
  A.foldRows = foldRows;

  // ---- sources and freshness ---------------------------------------------------------------------
  const SRC = { ga4: "Google Analytics", clarity_live: "Clarity live", clarity_download: "Clarity download" };
  const CONNECT = { ga4: "google", clarity_live: "clarity", clarity_download: "clarity", serp: "serpapi" };
  const TONE = { ok: "ok", old: "warn", failing: "crit", retrying: "busy", reading: "busy", waiting: "busy", not_connected: "off", not_set_up: "off", not_used: "off", no_sites: "off" };
  const ICON = { ok: "", warn: "triangle-alert", crit: "octagon-alert", busy: "refresh-cw", off: "" };
  const stateOf = (d, id) => d.source_states.find((s) => s.id === id) || { id, state: "no_sites", sites: [] };
  /* Connected, but nothing read yet: its zeros aren't real zeros and it isn't "up to date" (ai-reports-workflow, 2026-11-17).
     Reading or retrying counts as not ready only while no site has any data. */
  const notReady = (src) => src.state === "waiting" || (["reading", "retrying"].includes(src.state) && !(src.sites || []).some((x) => x.through || x.last_ok_at));
  const waitWords = () => `${t("Connected. Waiting for data")}. ${t("Arrives after the next run. Refresh data starts one now.")}`;
  const waitCard = (button = true) => `<div class="empty"><p>${esc(waitWords())}</p>${button && LVx()?.refreshBtn ? `<div style="margin-top:10px">${LVx().refreshBtn(true)}</div>` : ""}</div>`;
  /* The site a chip speaks for: the worst one, so All sites never hides a failing site behind a good one. */
  const worstSite = (src) => src.sites.find((s) => s.state === src.state) || src.sites[0] || {};
  const nameOf = (src) => (src.id === "serp" ? src.name : t(SRC[src.id]));

  function chipWords(src, short = false) {
    const s = worstSite(src), name = nameOf(src), many = src.sites.length > 1 && src.sites.some((x) => x.state !== src.state);
    const of = many ? ` · ${tf("{n} of {m} sites", { n: num(src.sites.filter((x) => x.state === src.state).length), m: num(src.sites.length) })}` : "";
    const st = src.state;
    if (st === "not_connected") return `${name} · ${t("not connected")}`;
    if (st === "not_used") return `${name} · ${t("not used")}`;
    if (st === "not_set_up") return src.id === "serp" ? `${name} · ${t("no keywords checked")}` : `${name} · ${t("nothing uploaded")}`;
    if (st === "waiting") return `${name} · ${t("waiting for data")}`;
    if (st === "retrying") return `${name} · ${t("retrying")}`;
    if (st === "reading") return `${name} · ${t("reading…")}`;
    if (st === "failing" && short) return `${name} · ${t("not updating")} · ${t("last good")} ${day(s.last_ok_at)}`; // the full story is in the sources line
    if (st === "failing") return `${name} ${t("stopped working")}${of} · ${t("last good")} ${day(s.last_ok_at)} · ${t("tried")} ${stamp(s.last_attempt_at)}`;
    if (src.id === "ga4") return st === "old" ? `${name} · ${tf("{n} days behind", { n: num(s.behind_days) })}${of}` : `${name} · ${t("through")} ${day(s.through)}`;
    if (src.id === "clarity_live") return st === "old" ? `${name} · ${t("read")} ${stamp(s.last_ok_at)} · ${tf("data lost in {n} h", { n: num(s.lost_in_hours) })}${of}` : `${name} · ${t("read")} ${stamp(s.last_ok_at)}`;
    if (src.id === "clarity_download") return `${name} · ${day(s.period_start)} – ${day(s.period_end)} · ${st === "old" ? t("old") : `${t("uploaded")} ${day(s.uploaded_at)}`}${of}`;
    if (src.id === "serp") return `${name} · ${t("checked")} ${day(src.checked_at)}${st === "old" ? ` · ${t("old")}` : ""}`;
    return name;
  }
  /* One source's label in a card header. Grey when fine, amber when old, red when failing, with what to do. */
  function chip(src, { fix = true, short = false, bare = false } = {}) {
    const tone = TONE[src.state] || "off";
    const action = fix && tone === "crit" ? ` <button class="link-btn" data-lv-connect="${CONNECT[src.id]}">${t("Fix")}</button>` : fix && tone === "warn" && src.id === "clarity_download" ? ` <button class="link-btn" data-lv-connect="clarity">${t("Upload")}</button>` : "";
    return `<span class="ai-chip ${tone}" data-ai-chip="${src.id}">${ICON[tone] ? icon(ICON[tone]) : ""}<span>${esc(bare ? chipWords(src, short).replace(new RegExp(`^${nameOf(src).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( · | )`), "") : chipWords(src, short))}</span><span class="ai-chip-run" data-ai-chip-run="${src.id}"></span>${action}</span>`;
  }
  /* One line under the answer instead of a big error card: what needs you, then "Sources ›". */
  function sourcesLine(d) {
    const all = d.source_states, bad = all.filter((s) => ["failing", "old"].includes(s.state)), waiting = all.filter(notReady);
    // Only sources that were read count as up to date; one still waiting for its first read gets its own chip.
    const fine = () => { const n = all.filter((s) => s.state === "ok").length; return n === 1 ? t("Source up to date") : tf("All {n} sources up to date", { n: num(n) }); };
    const wide = bad.length || waiting.length ? [...bad, ...waiting].map((s) => chip(s)).join("") : `<span class="ai-chip ok">${icon("circle-check")}<span>${fine()}</span></span>`;
    const narrow = `<button class="ai-chip ${bad.length ? "warn" : "ok"} ai-only-narrow" data-ai-sources>${tf(bad.length ? "{n} sources · {m} need you ›" : "{n} sources ›", { n: num(all.length), m: num(bad.length) })}</button>`;
    return `<div class="ai-sources-line"><span class="ai-only-wide">${wide}</span>${narrow}<button class="link-btn ai-only-wide" data-ai-sources>${t("Sources")} ›</button></div>`;
  }
  /* The simpler screens on a phone: the head's date line is cut to one line, so its sources chip comes back under the answer. */
  function narrowSources(d) {
    const h = headSources(d);
    return `<div class="ai-sources-line ai-only-narrow"><button class="ai-chip ${h.sev === "crit" ? "crit" : h.sev ? "warn" : "ok"}" data-ai-sources>${h.sev ? icon(h.sev === "crit" ? "octagon-alert" : "triangle-alert") : ""}<span>${esc(h.word)} ›</span></button></div>`;
  }
  /* The simpler head's sources chip, in the date line: all well in one phrase, or what needs the owner, amber or red. It opens
     the Sources panel (data-ai-sources, handled below). */
  function headSources(d) {
    const all = d.source_states, bad = all.filter((s) => ["failing", "old"].includes(s.state));
    const used = all.filter((s) => s.state === "ok").length, waiting = all.filter(notReady);
    if (!bad.length && waiting.length) return { word: waiting.length === 1 ? chipWords(waiting[0], true) : tf("{n} sources waiting for data", { n: num(waiting.length) }), open: "data-ai-sources" };
    if (!bad.length) return { word: used === 1 ? t("Source up to date") : tf("{n} sources up to date", { n: num(used) }), open: "data-ai-sources" };
    const one = bad.length === 1 ? bad[0] : null;
    const word = !one ? tf("{n} sources need you", { n: num(bad.length) }) : one.state === "failing" ? `${nameOf(one)} ${t("stopped working")}` : chipWords(one, true);
    return { word, sev: bad.some((s) => s.state === "failing") ? "crit" : "warn", open: "data-ai-sources" };
  }

  // ---- the answer --------------------------------------------------------------------------------
  const mark = (domain) => `<span class="ai-who">${UI.siteLogo(domain, 16)}<span dir="ltr">${esc(domain)}</span></span>`;
  function answer(d) {
    const ga4 = stateOf(d, "ga4"), lines = [];
    if (["not_connected", "not_used", "no_sites"].includes(ga4.state)) lines.push(esc(t("Connect Google Analytics to see AI visits and leads.")));
    else if (notReady(ga4)) lines.push(`${esc(t("Connected. Waiting for data"))}.`); // the chart card under it says the rest, with Refresh data
    else if (!d.sessions) lines.push(esc(t("No AI visits in this period.")));
    else {
      const top = d.sources[0]?.source;
      const change = d.change === null || d.change === undefined ? "" : ` (${d.change > 0 ? "+" : d.change < 0 ? "−" : "±"}${UI.dec(Math.abs(Math.round(d.change)))}${unit()})`;
      const said = d.key_events_set_up ? tf("AI assistants sent {v} and {l}{c}, most from", { v: plural(d.sessions, "{n} visit", "{n} visits"), l: window.GA4W?.keyEvents(d) ? plural(d.leads, "{n} key event", "{n} key events") : plural(d.leads, "{n} lead", "{n} leads"), c: change }) : tf("AI assistants sent {v}{c}, most from", { v: plural(d.sessions, "{n} visit", "{n} visits"), c: change });
      lines.push(`${esc(said)} ${top ? mark(top) : ""}.`);
    }
    const c = d.copilot;
    if (c.citations !== null && c.citations !== undefined) {
      lines.push(esc(c.share !== null && c.share !== undefined
        ? tf(c.share < 50 ? "Copilot cited you {n}, but others win most of its answers ({s} share)." : "Copilot cited you {n}, with a {s} share of its answers.", { n: plural(c.citations, "{n} time", "{n} times"), s: share(c.share) })
        : tf("Copilot cited your sites {n}.", { n: plural(c.citations, "{n} time", "{n} times") })));
    } else if (d.ai_overviews.with_overview) {
      lines.push(esc(aioSaid(d.ai_overviews)));
    }
    return `<div class="ai-answer"><p class="today-lead">${lines[0]}</p>${lines[1] ? `<p class="today-second">${lines[1]}</p>` : ""}${simple() ? narrowSources(d) : sourcesLine(d)}</div>`;
  }

  // ---- four numbers ------------------------------------------------------------------------------
  /* The simpler screens' four cards (UI.card): each says one fact under its figure, and AI visits carries its weekly graph. */
  function cards(d) {
    const ga4 = stateOf(d, "ga4"), wait = notReady(ga4), off = ["not_connected", "not_used", "no_sites"].includes(ga4.state) || wait;
    const has = (v) => v !== null && v !== undefined;
    const weeks = d.weekly.map((w) => w.sessions).filter((v) => v !== null);
    const visits = UI.card({ id: "ai-visits", label: "AI visits", value: off ? null : d.sessions, change: off ? null : { now: d.sessions, before: d.before },
      sub: wait ? esc(t("Waiting for data")) : off ? esc(t("Google Analytics not connected")) : null, spark: !off && weeks.length > 1 ? weeks : null, cls: "tile" });
    const leads = UI.card({ id: "ai-leads", label: window.GA4W.word("Leads", d), value: off ? null : d.key_events_set_up ? d.leads : `<span class="today-fig-word">${esc(t("Not set up"))}</span>`,
      change: !off && d.key_events_set_up && has(d.before_leads) ? { now: d.leads, before: d.before_leads, unit: "" } : null,
      sub: off ? "" : !d.key_events_set_up ? esc(t("Mark forms as GA4 key events")) : !d.leads && !d.before_leads ? esc(t(window.GA4W.word("No leads in this period", d))) : null, cls: "tile" });
    const r = d.rate, o = d.organic, rateOff = off || !d.key_events_set_up;
    const rate = UI.card({ id: "ai-rate", label: window.GA4W.word("Lead rate", d), def: "AI lead rate", value: rateOff || r.value === null ? null : pct(r.value),
      sub: rateOff ? "" : r.value === null ? esc(tf("needs {need} AI visits, {n} so far", { need: num(r.needs), n: num(r.visits) })) : o.value === null ? "" : `<span class="nowrap">${esc(t("organic search"))} ${pct(o.value)}</span>`, cls: "tile" });
    const c = d.copilot, one = c.sites.length === 1 ? c.sites[0] : null, cited = has(c.citations);
    const cite = UI.card({ id: "ai-citations", label: "Copilot citations", value: cited ? c.citations : null,
      change: cited && one?.before && has(one.before.citations) ? { now: c.citations, before: one.before.citations, unit: "" } : null,
      sub: !cited ? `<button class="link-btn" data-lv-connect="clarity">${t("Upload a Clarity AI download")}</button>` : [has(c.share) ? `<span class="nowrap">${esc(t("share"))} ${share(c.share)}</span>` : "", copilotSpan(one)].filter(Boolean).join("<br>") || null, cls: "tile" });
    return `<section class="tiles ai-tiles">${visits}${leads}${rate}${cite}</section>`;
  }
  /* Copilot counts cover a download's own days, not the screen's period: the card says which days, and when there is no
     earlier file of the same length that doesn't overlap, that it wasn't compared, and why (expert review 2026-11-17, #21). */
  const NO_BEFORE = { overlap: "The earlier download overlaps this one, so the counts can't be compared.", length: "The earlier download covers a different number of days, so the counts can't be compared." };
  function copilotSpan(one) {
    if (!one) return "";
    const days = `<span class="small muted nowrap">${esc(UI.fmtRange ? UI.fmtRange(one.period_start, one.period_end) : `${one.period_start} – ${one.period_end}`)}</span>`;
    return one.no_before && NO_BEFORE[one.no_before] ? `${days}<br><span class="small muted">${t("Not compared")}${UI.tip(NO_BEFORE[one.no_before])}</span>` : days;
  }
  function tiles(d) {
    if (simple() && UI.card) return cards(d);
    const ga4 = stateOf(d, "ga4"), wait = notReady(ga4), off = ["not_connected", "not_used", "no_sites"].includes(ga4.state) || wait;
    const weeks = d.weekly.map((w) => w.sessions).filter((v) => v !== null);
    const visits = UI.tile(t("AI visits"), off ? "—" : UI.cnt(d.sessions), off ? `<span class="ab">${t(wait ? "Waiting for data" : "Google Analytics not connected")}</span>` : LVx().change(d.sessions, d.before), { ic: "sparkles", line: !off && weeks.length > 1 ? weeks : null });
    const leadsFig = off ? "—" : d.key_events_set_up ? num(d.leads) : `<span class="today-fig-word">${t("Not set up")}</span>`;
    const leadsNote = off ? "" : !d.key_events_set_up ? `<span class="ab">${t("Mark forms as GA4 key events")}</span>` : !d.leads && !d.before_leads ? `<span class="ab">${esc(t(window.GA4W.word("No leads in this period", d)))}</span>` : d.before_leads !== null && d.before_leads !== undefined ? `<span class="ab">${num(d.before_leads)} → ${num(d.leads)}</span>` : "";
    const leads = UI.tile(t("Leads"), leadsFig, leadsNote, { ic: "filter" });
    const r = d.rate, o = d.organic;
    const rateFig = off || !d.key_events_set_up ? "—" : r.value === null ? "—" : pct(r.value);
    const rateNote = off || !d.key_events_set_up ? "" : r.value === null
      ? `<span class="ab">${tf("needs {need} AI visits, {n} so far", { need: num(r.needs), n: num(r.visits) })}</span>`
      : `<span class="ab">${o.value === null ? "" : `<span class="nowrap">${t("organic search")} ${pct(o.value)}</span> · `}<span class="nowrap">${esc(tf("{l} of {v}", { l: plural(r.leads, "{n} lead", "{n} leads"), v: plural(r.visits, "{n} visit", "{n} visits") }))}</span></span>`;
    const rate = UI.tile(t("Lead rate"), rateFig, rateNote, { ic: "percent", def: "AI lead rate" });
    const c = d.copilot, one = c.sites.length === 1 ? c.sites[0] : null;
    let citeFig = "—", citeNote = `<button class="link-btn" data-lv-connect="clarity">${t("Upload a Clarity AI download")}</button>`;
    if (c.citations !== null && c.citations !== undefined) {
      citeFig = UI.cnt(c.citations);
      const bits = [];
      if (one?.before && one.before.citations !== null && one.before.citations !== undefined) {
        const diff = c.citations - one.before.citations;
        bits.push(`<span class="${diff > 0 ? "good" : diff < 0 ? "crit" : "sec"} d-pill">${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${num(Math.abs(diff))}</span> ${t("since the last upload")}`);
      }
      if (one) bits.push(copilotSpan(one));
      if (c.share !== null && c.share !== undefined) {
        const was = one?.before?.share, pts = was === null || was === undefined ? null : Math.round((c.share - was) * 10) / 10;
        bits.push(`<span class="nowrap">${t("share")} ${share(c.share)}${pts === null ? "" : ` (${pts > 0 ? "+" : pts < 0 ? "−" : "±"}${UI.dec(Math.abs(pts))} ${t("pts")})`}</span>`);
      }
      const dl = stateOf(d, "clarity_download");
      if (one) bits.push(`<span class="nowrap ${dl.state === "old" ? "warn" : ""}">${dl.state === "old" ? icon("triangle-alert") : ""}${day(one.period_start)} – ${day(one.period_end)}</span>`);
      citeNote = `<span class="ab">${bits.join(" · ")}</span>`;
    }
    const cite = UI.tile(t("Copilot citations"), citeFig, citeNote, { ic: "file-text", def: "Copilot citations" });
    return `<section class="tiles ai-tiles">${visits}${leads}${rate}${cite}</section>`;
  }

  // ---- the weekly charts: Google Analytics and Clarity live, each showing only its own numbers ------
  const NOT_ON = ["not_connected", "not_used", "no_sites"];
  const half = (id, name, src, body, foot = "") => `<div class="ai-half" data-ai-half="${id}"><div class="ai-half-head"><h3>${esc(name)}</h3>${chip(src, { short: true, bare: true })}</div>${body}${foot}</div>`;
  const weekWords = (w) => tf("Week {a} – {b}", { a: day(w.start), b: day(w.end) });
  function ga4Half(d) {
    const ga4 = stateOf(d, "ga4");
    const weeks = d.weekly, days = weeks.map((w) => w.end);
    const values = Object.fromEntries(weeks.map((w) => [w.end, w.sessions]));
    const marks = d.key_events_set_up ? Object.fromEntries(weeks.filter((w) => w.leads > 0).map((w) => [w.end, w.leads])) : null;
    const weekOf = Object.fromEntries(weeks.map((w) => [w.end, w]));
    const off = NOT_ON.includes(ga4.state), any = weeks.some((w) => w.sessions);
    const body = off ? `<div class="empty"><p>${t("Connect Google Analytics to see AI visits.")}</p><div style="margin-top:10px"><button class="btn btn-main" data-lv-connect="google">${t("Connect")}</button></div></div>`
      : notReady(ga4) ? waitCard()
      : !any ? `<div class="empty"><p>${t("No AI visits in these weeks.")}</p></div>`
      : LVx().lineChart("ai-weeks", days, [{ name: "AI visits", color: "var(--ch-1)", values }], { marks, markName: "Leads", dayLabel: (end) => weekWords(weekOf[end]) });
    const legend = !off && any && marks && Object.keys(marks).length ? `<div class="ai-half-foot"><span class="ai-legend"><i class="ai-dot"></i>${t("a week with a lead")}</span></div>` : "";
    return half("ga4", t("Google Analytics"), ga4, body, legend);
  }
  function clarityHalf(d) {
    const live = stateOf(d, "clarity_live");
    const weeks = d.clarity_weekly, days = weeks.map((w) => w.end);
    const values = Object.fromEntries(weeks.map((w) => [w.end, w.sessions]));
    const weekOf = Object.fromEntries(weeks.map((w) => [w.end, w]));
    const read = weeks.reduce((n, w) => n + w.days, 0), any = weeks.some((w) => w.sessions);
    const label = (end) => (weekOf[end].days ? `${weekWords(weekOf[end])} · ${plural(weekOf[end].days, "{n} day read", "{n} days read")}` : weekWords(weekOf[end]));
    const empty = (words, button = "") => `<div class="empty"><p>${esc(words)}</p>${button ? `<div style="margin-top:10px">${button}</div>` : ""}</div>`;
    const body = live.state === "not_connected" ? empty(t("Connect Clarity for its own AI visit count."), `<button class="btn btn-main" data-lv-connect="clarity">${t("Connect")}</button>`)
      : NOT_ON.includes(live.state) ? empty(t("Clarity isn't used here."))
      : !read ? empty(t("Clarity not read these weeks yet."))
      : !any ? empty(tf("Clarity read {n}: no AI visits.", { n: plural(read, "{n} day", "{n} days") }))
      : LVx().lineChart("ai-weeks-clarity", days, [{ name: "AI visits", color: "var(--ch-2)", values }], { dayLabel: label });
    if (simple()) { // its small print goes behind an (i) beside its name
      const info = read && !NOT_ON.includes(live.state) ? UI.info([tf("Weeks count only the days read: {n} so far.", { n: num(read) }), "Clarity only gives its last 3 days."]) : "";
      return half("clarity", t("Clarity live"), live, body).replace("</h3>", `</h3>${info}`);
    }
    const note = read && !NOT_ON.includes(live.state) ? `<div class="ai-half-foot"><p class="small muted ai-second"><span>${esc(tf("Weeks count only the days read: {n} so far.", { n: num(read) }))}${UI.tip("Clarity only gives its last 3 days.")}</span></p></div>` : "";
    return half("clarity", t("Clarity live"), live, body, note);
  }
  /* One sentence for the AI Overview watch, naming the tool that looked: only a tool that sees AI Overviews counts (SerpApi). */
  const aioSaid = (o) => (o.tools && o.tools.length
    ? tf("AI Overviews on {o} of {c} keywords checked with {tool}; you're cited in {m}.", { o: num(o.with_overview), c: num(o.captured), m: num(o.cited_me), tool: o.tools.join(", ") })
    : tf("AI Overviews on {o} of {c} keywords checked; you're cited in {m}.", { o: num(o.with_overview), c: num(o.captured), m: num(o.cited_me) }));

  /* The simpler screens: Clarity live beside Google Analytics once it's connected, one line with Connect until then. The
     second opinion is the card head's (i). */
  function chartCardSimple(d) {
    const live = stateOf(d, "clarity_live"), s = d.second_opinion;
    const liveOn = !NOT_ON.includes(live.state);
    const second = !s || !liveOn ? "" : !s.days ? UI.info("No Clarity live reads on these days yet to compare.")
      : UI.info([tf("Second opinion: Clarity live saw {c} on the {n} read; Google Analytics saw {g}.", { c: plural(s.clarity, "{n} AI visit", "{n} AI visits"), n: plural(s.days, "day", "{n} days"), g: num(s.ga4) }), "Same days for both. They count differently, so they're never added."]);
    const line = liveOn ? "" : `<p class="ai-clarity-line" data-ai-half="clarity">${esc(`${t("Clarity live")}: ${t(live.state === "not_used" ? "not used" : "not connected")}`)}${live.state === "not_connected" ? `<span class="head-sep"> · </span><button class="link-btn" data-lv-connect="clarity">${t("Connect")}</button>` : ""}</p>`;
    return `<section class="card ai-chart"><div class="card-head"><h2>${t("AI visits per week")}</h2>${second}</div>
      <div class="ai-halves">${ga4Half(d)}${liveOn ? clarityHalf(d) : ""}</div>${line}</section>`;
  }
  function chartCard(d) {
    if (simple()) return chartCardSimple(d);
    const second = secondOpinion(d);
    return `<section class="card ai-chart"><div class="card-head"><h2>${t("AI visits per week")}</h2></div>
      <div class="ai-halves">${ga4Half(d)}${clarityHalf(d)}</div>${second ? `<div class="ai-chart-foot">${second}</div>` : ""}</section>`;
  }
  function secondOpinion(d) {
    const s = d.second_opinion, live = stateOf(d, "clarity_live");
    if (!s || ["not_connected", "not_used"].includes(live.state)) return "";
    if (!s.days) return `<p class="small muted ai-second">${t("No Clarity live reads on these days yet to compare.")}</p>`;
    return `<p class="small muted ai-second">${icon("info")}<span>${esc(tf("Second opinion: Clarity live saw {c} on the {n} read; Google Analytics saw {g}.", { c: plural(s.clarity, "{n} AI visit", "{n} AI visits"), n: plural(s.days, "day", "{n} days"), g: num(s.ga4) }))}${UI.tip("Same days for both. They count differently, so they're never added.")}</span></p>`;
  }

  // ---- next actions ------------------------------------------------------------------------------
  const pageLink = (path, host, url) => PageLink.html(url || path, { text: path, host: host || UI.siteHostPicked() || "", cls: "mono" });
  function actionText(a) {
    if (a.kind === "cta") return { title: tf("{p}: {n} AI visits, no lead", { p: a.path, n: num(a.visits) }), html: tf("{p}: {n} AI visits, no lead", { p: pageLink(a.path, a.host), n: num(a.visits) }), detail: t("Add a call to action high on the page."), ic: "triangle-alert", tone: "warn" };
    if (a.kind === "faq") {
      const q = UI.state.lang === "fr" ? `« ${a.query} »` : `“${a.query}”`;
      return { title: tf("{q}: {s} share of Copilot's answers", { q, s: share(a.share) }), html: tf("{q}: {s} share of Copilot's answers", { q: KeywordLink.html(a.query, { host: a.host, text: q }), s: share(a.share) }),
        detail: a.page ? tf("Add an FAQ that answers it to {p}.", { p: a.page.path }) : t("No page of yours ranks for it yet. Write one."),
        detailHtml: a.page ? tf("Add an FAQ that answers it to {p}.", { p: pageLink(a.page.path, a.host, a.page.url) }) : null, ic: "info", tone: "sec" };
    }
    if (a.kind === "compare") {
      const rival = a.rivals[0];
      return { title: tf("{r} is cited in AI Overview for “{k}”, you aren't.", { r: rival, k: a.keyword }), html: tf("{r} is cited in AI Overview for “{k}”, you aren't.", { r: mark(rival), k: KeywordLink.html(a.keyword, { id: a.keyword_id, host: a.host }) }), detail: t("See what their page says that yours doesn't."), ic: "info", tone: "sec" };
    }
    return { title: tf("Copilot cites {p} {n} but sends no visit", { p: a.path, n: plural(a.citations, "{n} time", "{n} times") }), html: tf("Copilot cites {p} {n} but sends no visit", { p: pageLink(a.path, a.host, a.url), n: plural(a.citations, "{n} time", "{n} times") }), detail: t("Give a reason to click: figures, a tool or a checklist."), ic: "info", tone: "sec" };
  }
  function taskFind(a, words) {
    const facts = a.kind === "cta" ? [`${num(a.visits)} ${t("AI visits")}`, "Google Analytics"] : a.kind === "faq" ? [`${t("Share of authority")} ${share(a.share)}`, "Clarity"] : a.kind === "compare" ? [a.rivals.join(", "), "AI Overview"] : [`${num(a.citations)} ${t("citations")}`, "Clarity"];
    return {
      title: words.title, host: a.host, description: words.detail,
      ...(a.path || a.page ? { pages: [a.path || a.page.path] } : {}), ...(a.keyword ? { keywords: [a.keyword] } : {}),
      source: { type: "search", label: words.title, host: a.host, facts, link: "#ai", key: a.key },
    };
  }
  /* The simpler screens: one row per action, its fact only. Compare stays in view; Task shows on hover or focus (.row-act). */
  function actionsCardSimple(d) {
    const list = d.next_actions.slice(0, 3);
    const rows = list.map((a) => {
      const w = actionText(a);
      return `<li><span>${icon(w.ic, w.tone)}</span><div class="what"><div class="t">${w.html}</div></div>
        <div class="acts"><span class="row-act">${UI.taskButton(taskFind(a, w), { label: "Task" })}</span>${a.kind === "compare" ? `<button class="btn btn-small" data-ai-watch="${esc(String(a.site_id))}">${t("Compare")}</button>` : ""}</div></li>`;
    }).join("");
    const count = d.next_action_count > list.length ? `<span class="end small muted">${tf("{n} of {m}", { n: num(list.length), m: num(d.next_action_count) })}</span>` : "";
    return `<section class="card ai-actions ai-actions-simple"><div class="card-head"><h2>${t("Next actions")}</h2>${count}</div>
      ${rows ? `<ul class="rows">${rows}</ul>` : `<div class="empty today-empty"><p>${t("Nothing to do right now.")}${UI.info("Ideas come from AI visits, Copilot's questions and AI Overviews.")}</p></div>`}</section>`;
  }
  function actionsCard(d) {
    if (simple()) return actionsCardSimple(d);
    const list = d.next_actions;
    const acts = (a, w) => `<div class="acts">${UI.taskButton(taskFind(a, w), { label: "Task" })}${a.kind === "compare" ? `<button class="btn btn-small" data-ai-watch="${esc(String(a.site_id))}">${t("Compare")}</button>` : ""}</div>`;
    // Kinds whose advice is the same on every row (all but the FAQ, whose page differs) are grouped, in the order they come.
    const groups = [];
    list.forEach((a) => {
      const w = actionText(a), same = a.kind !== "faq" && groups.find((g) => g.kind === a.kind);
      if (same) same.items.push({ a, w }); else groups.push({ kind: a.kind, items: [{ a, w }] });
    });
    const rows = groups.map(({ items }) => {
      const { w } = items[0];
      if (items.length === 1) {
        const { a } = items[0];
        return `<li><span>${icon(w.ic, w.tone)}</span><div class="what"><div class="t">${w.html}</div><div class="d">${w.detailHtml || esc(w.detail)}</div></div>
        ${acts(a, w)}</li>`;
      }
      return `<li class="ai-act-group"><span>${icon(w.ic, w.tone)}</span><div class="what"><div class="t">${esc(w.detail.replace(/\s*\.$/, ""))} <span class="ai-times">×${num(items.length)}</span></div>
        <ul class="ai-act-sub">${items.map(({ a, w: x }) => `<li><div class="d">${x.html}</div>${acts(a, x)}</li>`).join("")}</ul></div></li>`;
    }).join("");
    const count = d.next_action_count > list.length ? `<span class="end small muted">${tf("{n} of {m}", { n: num(list.length), m: num(d.next_action_count) })}</span>` : "";
    return `<section class="card ai-actions"><div class="card-head"><h2>${t("Next actions")}</h2>${count}</div>
      ${rows ? `<ul class="rows">${rows}</ul>` : `<div class="empty today-empty"><p>${t("Nothing to do right now.")}${UI.tip("Ideas come from AI visits, Copilot's questions and AI Overviews.")}</p></div>`}</section>`;
  }

  // ---- one card, four tabs -----------------------------------------------------------------------
  const TABS = [["assistants", "Assistants"], ["pages", "Landing pages"], ["cited", "Cited pages"], ["questions", "Questions to win"], ["brand", "What AI says"]];
  /* What AI says (ai-brand.js): what ChatGPT, Perplexity, Gemini and Google's AIs answer about the company. Drawn by AIBrand. */
  const brandTab = () => (window.AIBrand ? window.AIBrand.tab() : "");
  /* The simpler screens: each tab's small print goes to the (i) in the card's head instead of a line above the table
     (keep: true for a line that asks for something). Its words, with any hover tip's, as plain sentences. */
  let tabInfo = [];
  const plainOf = (html) => {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    const tips = [...doc.querySelectorAll("[data-tip]")].map((x) => x.getAttribute("data-tip"));
    doc.querySelectorAll("[data-tip]").forEach((x) => x.remove());
    return [doc.body.textContent.replace(/\s+/g, " ").trim(), ...tips].filter(Boolean);
  };
  const lead = (html, { keep = false } = {}) => { if (simple() && !keep) { tabInfo.push(...plainOf(html)); return ""; } return `<p class="ai-tab-lead">${html}</p>`; };
  /* The simpler screens: a row opens its panel (row-panel.js). The first cell carries a mark, moved onto the row here, since
     LV.dataTable draws the rows. A Task in a row shows on hover or focus. */
  const rowMark = (kind, key, host = "") => (simple() && key ? `<i hidden data-ai-rp="${esc(kind)}" data-ai-rp-key="${esc(key)}" data-ai-rp-host="${esc(host || "")}"></i>` : "");
  const rowsOpen = (html) => (!simple() ? html : html.replace(/<tr style="cursor:default">(<td[^>]*>)<i hidden data-ai-rp="([^"]*)" data-ai-rp-key="([^"]*)" data-ai-rp-host="([^"]*)"><\/i>/g,
    (_, td, kind, key, host) => `<tr data-rp-open="${kind}" data-rp-key="${key}"${host ? ` data-rp-host="${host}"` : ""} tabindex="0">${td}`));
  const rowAct = (html) => (simple() && html ? `<span class="row-act">${html}</span>` : html);
  function folded(id, columns, rows, { test, word, allWord, empty }) {
    const f = foldRows(rows, test), open = A.fold.has(id);
    if (f.all && !open) return `<div class="ai-fold-all"><p>${esc(tf(allWord, { n: num(f.folded) }))}</p><button class="link-btn" data-ai-fold="${id}">${t("Show")}</button></div>`;
    const shown = open || !f.folded ? rows : rows.filter((r) => !test(r));
    const line = f.folded && !open ? `<div class="ai-fold"><span>${esc(tf(word, { n: num(f.folded) }))}</span><button class="link-btn" data-ai-fold="${id}">${t("Show")}</button></div>`
      : f.folded && open ? `<div class="ai-fold"><button class="link-btn" data-ai-fold="${id}">${t("Hide")}</button></div>` : "";
    return rowsOpen(LVx().dataTable(id, columns, shown, { pageSize: 10, empty })) + line;
  }
  const notSet = (text, button = "") => `<div class="empty"><p>${text}</p>${button ? `<div style="margin-top:10px">${button}</div>` : ""}</div>`;
  const pageCell = (r) => `${rowMark("page", r.path, r.host)}${PageLink.html(r.url || r.path, { text: r.path, host: r.host, cls: "mono lv-url" })}${LVx().siteOfPage(r)}`;

  function assistantsTab(d) {
    const ga4 = stateOf(d, "ga4");
    if (["not_connected", "not_used", "no_sites"].includes(ga4.state)) return notSet(t("Connect Google Analytics to see which assistants send visits."), `<button class="btn btn-main" data-lv-connect="google">${t("Connect")}</button>`);
    if (notReady(ga4)) return waitCard(false);
    if (!d.sources.length) return notSet(`${t("No AI visits in this period: a real zero.")}${UI.tip("Google Analytics has data, and none of it came from the assistants on the AI list.")}`);
    const rateCell = (r) => (r.rate !== null ? pct(r.rate) : `<span class="muted" data-tip="${esc(tf("needs {need} AI visits, {n} so far", { need: num(d.limits.lead_rate_min_visits), n: num(r.sessions) }))}">—</span>`);
    const columns = [
      { key: "source", label: "Assistant", html: (r) => `${rowMark("assistant", r.source)}${mark(r.source)}` },
      { key: "sessions", label: "Visits", num: true },
      ...(d.key_events_set_up ? [{ key: "leads", label: window.GA4W.word("Leads", d), num: true }, { key: "rate", label: window.GA4W.word("Lead rate", d), num: true, html: rateCell }] : []),
    ];
    const small = d.sources.filter((r) => r.rate === null).length;
    // The same visits are the "AI assistants" row on Channels (expert review 2026-11-17, #22): the way there.
    const channels = `<p class="small muted ai-on-channels"><a href="#channels">${t("Compare with your other channels")} →</a></p>`;
    return `${small && d.key_events_set_up ? lead(`${esc(tf("Lead rate shows from {n} AI visits.", { n: num(d.limits.lead_rate_min_visits) }))}${UI.tip("Below that, one lead more or less swings it too far.")}`) : ""}${rowsOpen(LVx().dataTable("ai-assistants", columns, d.sources, { pageSize: 10 }))}${channels}`;
  }
  function pagesTab(d) {
    const ga4 = stateOf(d, "ga4");
    if (["not_connected", "not_used", "no_sites"].includes(ga4.state)) return notSet(t("Connect Google Analytics to see AI landing pages."), `<button class="btn btn-main" data-lv-connect="google">${t("Connect")}</button>`);
    if (notReady(ga4)) return waitCard(false);
    const min = d.limits.cta_min_visits;
    const none = d.pages.filter((p) => !p.leads).length;
    const action = (r) => rowAct(d.key_events_set_up && !r.leads && r.sessions >= min ? UI.taskButton(taskFind({ kind: "cta", host: r.host, path: r.path, visits: r.sessions, key: `ai|cta|${r.host}|${r.path}` }, actionText({ kind: "cta", host: r.host, path: r.path, visits: r.sessions })), { label: "Task" }) : "");
    const columns = [
      { key: "path", label: "Page", get: LVx().pageName, html: pageCell },
      { key: "sessions", label: "Visits", num: true },
      ...(d.key_events_set_up ? [{ key: "leads", label: window.GA4W.word("Leads", d), num: true }, { key: "action", label: "Action", get: () => null, html: action }] : []),
    ];
    const said = !d.pages.length ? "" : d.key_events_set_up ? lead(esc(tf("{n} of {m} pages: AI visits, no lead. Task button from {min} visits.", { n: num(none), m: num(d.pages.length), min: num(min) }))) : lead(esc(t("Leads aren't tracked: mark your forms as key events in GA4.")), { keep: true });
    return said + folded("ai-pages", columns, d.pages, { test: (r) => r.sessions === 1, word: "{n} pages with one AI visit each", allWord: "{n} pages got one AI visit each; none stands out yet.", empty: "No AI landing pages in this period." });
  }
  const uploadAi = () => `<button class="btn btn-main" data-lv-connect="clarity">${t("Upload a Clarity AI download")}</button>`;
  function citedTab(d) {
    const c = d.copilot;
    if (!c.sites.length) return notSet(t("See which pages Copilot cites: in Clarity, AI visibility → Export, then upload it."), uploadAi());
    const rows = c.sites.flatMap((s) => s.pages.map((p) => ({ ...p, host: s.host })));
    const min = d.limits.click_min_citations;
    const noVisit = (r) => r.visits === 0 && !r.bing_visits && r.citations >= min;
    const flag = `<span class="ai-cnv" role="img" title="${esc(t("Cited, no visit"))}" aria-label="${esc(t("Cited, no visit"))}">${icon("triangle-alert", "warn")}</span>`;
    const columns = [
      { key: "path", label: "Page", get: LVx().pageName, html: pageCell },
      { key: "citations", label: "Citations", num: true },
      // Copilot and Bing search apart (SEO review 2026-11-17, W5): GA4 writes Bing "bing", and most of it is plain search.
      { key: "visits", label: "Copilot visits", num: true, html: (r) => (r.visits === null ? `<span class="muted" data-tip="${esc(t("Google Analytics has none of the download's days."))}">—</span>` : `${num(r.visits)}${noVisit(r) ? ` ${flag}` : ""}`) },
      { key: "bing_visits", label: "Bing search visits", num: true, html: (r) => (r.bing_visits === null || r.bing_visits === undefined ? `<span class="muted">—</span>` : num(r.bing_visits)) },
    ];
    const flagged = rows.filter(noVisit).length;
    const flagLine = flagged ? `<p class="ai-tab-lead ai-cnv-line">${icon("triangle-alert", "warn")}<span>${esc(flagged === 1 ? t("1 page cited, no visit") : tf("{n} pages cited, no visit", { n: num(flagged) }))}</span></p>` : "";
    const one = c.sites.length === 1 ? c.sites[0] : null;
    const allOnes = foldRows(rows, (r) => r.citations === 1).all && !A.fold.has("ai-cited"); // then the table is one sentence, with nothing to explain
    const said = one && !allOnes ? lead(esc(tf("Visits: Google Analytics, from Copilot, and from Bing search apart, {a} – {b}.", { a: day(one.period_start), b: day(one.period_end) }))) : "";
    return said + flagLine + folded("ai-cited", columns, rows, { test: (r) => r.citations === 1, word: "{n} pages cited once each", allWord: "Copilot cited {n} pages once each; none stands out yet.", empty: "No cited pages in this download." });
  }
  function questionsTab(d) {
    const c = d.copilot;
    if (!c.sites.length) return notSet(t("See the Copilot questions others win: upload Clarity's AI download."), uploadAi());
    const withQ = c.sites.filter((s) => s.queries);
    if (!withQ.length) return notSet(t("No questions in this download. Include them in Clarity's export, then upload again."), uploadAi());
    const below = d.limits.faq_share_below;
    const rows = withQ.flatMap((s) => s.queries.map((q) => ({ ...q, host: s.host }))).sort((a, b) => (a.share ?? 100) - (b.share ?? 100) || (b.citations || 0) - (a.citations || 0));
    const best = (r) => (r.page ? `${PageLink.html(r.page.url, { text: r.page.path, host: r.host, cls: "mono lv-url" })}${r.page.match === "close" ? `<div class="lv-cat">${tf("via “{q}”", { q: KeywordLink.html(r.page.query, { host: r.host }) })}</div>` : ""}` : `<span class="muted">${t("No page yet")}</span>`);
    const action = (r) => (r.share !== null && r.share < below ? (() => { const a = { kind: "faq", host: r.host, query: r.query, share: r.share, citations: r.citations, page: r.page, key: `ai|faq|${r.host}|${r.query.toLowerCase()}` }; return rowAct(UI.taskButton(taskFind(a, actionText(a)), { label: "Task" })); })() : "");
    const columns = [
      { key: "query", label: "Question", html: (r) => KeywordLink.html(r.query, { host: r.host }) },
      { key: "share", label: "Share", num: true, html: (r) => `<span class="${r.share !== null && r.share < below ? "warn" : ""}">${share(r.share)}</span>` },
      { key: "best", label: "Best page", get: (r) => r.page?.path || null, html: best },
      { key: "action", label: "Action", get: () => null, html: action },
    ];
    const low = rows.filter((r) => r.share !== null && r.share < below).length;
    return lead(`${esc(tf("{n} of {m} questions give you under {s} of Copilot's answers.", { n: num(low), m: num(rows.length), s: share(below) }))}${UI.tip("Best page: the page Google already shows for that search.")}`) + LVx().dataTable("ai-questions", columns, rows, { pageSize: 10 });
  }
  /* The simpler screens: the underline tabs, Google's AI report as a fifth once uploaded, and in the head the (i) (the AI list's
     caveat and the tab's small print), Edit the AI list and the table's Filter (data-tt-slot, table-tools.js). */
  function tabsCardSimple(d) {
    const report = window.GoogleAIReport?.has?.();
    const tabs = report ? [...TABS, ["report", "Google AI report"]] : TABS;
    if (!tabs.some(([id]) => id === A.tab)) A.tab = "assistants";
    tabInfo = [];
    const body = A.tab === "report" ? window.GoogleAIReport.tab() : { assistants: assistantsTab, pages: pagesTab, cited: citedTab, questions: questionsTab, brand: brandTab }[A.tab](d);
    // Each tab's count is its badge (the table then needs no "1–5 of 5" under it: data-tt-own-count).
    const ga4On = !NOT_ON.includes(stateOf(d, "ga4").state) && !notReady(stateOf(d, "ga4")), c = d.copilot;
    const counts = { brand: window.AIBrand?.count?.() ?? null, assistants: ga4On ? d.sources.length : null, pages: ga4On ? d.pages.length : null, cited: c.sites.length ? c.sites.reduce((n, x) => n + x.pages.length, 0) : null, questions: c.sites.some((x) => x.queries) ? c.sites.reduce((n, x) => n + (x.queries?.length || 0), 0) : null };
    const badge = (id) => (counts[id] ? ` <span class="n-badge">${num(counts[id])}</span>` : "");
    const info = A.tab === "report" ? tabInfo : A.tab === "brand" ? window.AIBrand?.info?.() || [] : ["Some AI visits show as Direct or Organic Search.", "AI apps often send no referrer, so their visits show as Direct. Clicks from Google's AI Overviews count as Organic Search.", ...tabInfo];
    return `<section class="card ai-tabs-card ai-tabs-simple"><div class="card-head ai-tabs-head"><div class="page-tabs in-card" role="tablist" aria-label="${t("AI search")}">${tabs.map(([id, word]) => `<button class="page-tab tab" role="tab" id="ai-tab-${id}" data-ai-tab="${id}" aria-selected="${A.tab === id}" tabindex="${A.tab === id ? 0 : -1}">${t(word)}${badge(id)}</button>`).join("")}</div>
      <span class="end ai-tabs-tools">${UI.info(info)}${A.tab === "brand" ? "" : `<button class="link-btn" data-ai-list>${t("Edit the AI list")}</button><span data-tt-slot=""></span>`}</span></div>
      <div role="tabpanel" aria-labelledby="ai-tab-${A.tab}" class="${A.tab === "brand" ? "ab-tab" : ""}" ${A.tab === "report" ? "" : "data-tt-own-count"}>${body}</div></section>`;
  }
  function tabsCard(d) {
    if (simple()) return tabsCardSimple(d);
    const chipFor = { assistants: stateOf(d, "ga4"), pages: stateOf(d, "ga4"), cited: stateOf(d, "clarity_download"), questions: stateOf(d, "clarity_download") }[A.tab];
    const body = { assistants: assistantsTab, pages: pagesTab, cited: citedTab, questions: questionsTab, brand: brandTab }[A.tab](d);
    return `<section class="card ai-tabs-card"><div class="ai-tabs-head"><div class="tabs" role="tablist" aria-label="${t("AI search")}">${TABS.map(([id, word]) => `<button class="tab" role="tab" id="ai-tab-${id}" data-ai-tab="${id}" aria-selected="${A.tab === id}" tabindex="${A.tab === id ? 0 : -1}">${t(word)}</button>`).join("")}</div><span class="end">${chipFor ? chip(chipFor, { short: true }) : ""}</span></div>
      <div role="tabpanel" aria-labelledby="ai-tab-${A.tab}" class="${A.tab === "brand" ? "ab-tab" : ""}">${body}</div></section>`;
  }

  // ---- Google AI Overviews: one line, its own button, never spent by Refresh data -------------------
  function aioPreview(d) {
    const o = d.ai_overviews, key = `${UI.siteIdPicked() || "all"}|${o.keyword_ids.join(",")}`;
    if (!o.keyword_ids.length || A.aio.key === key || !window.COMP?.server) return;
    A.aio = { ...A.aio, key, preview: null, asking: true, confirm: false };
    return window.COMP.api("POST", "refresh/preview", { keyword_ids: o.keyword_ids, engines: ["google"], depth: 10, mode: "auto", picked: [], include_recent: false })
      .then((p) => { A.aio.preview = p; }).catch(() => { A.aio.preview = { failed: true }; })
      .finally(() => { A.aio.asking = false; if (UI.state.route === "ai" && !UI.$("#panel")) UI.render({ keepScroll: true }); });
  }
  function aioCheckButton(o) {
    const p = A.aio.preview;
    if (A.aio.run) return `<span class="ai-chip busy">${icon("refresh-cw")}<span>${t("Checking…")}</span></span>`;
    if (!o.keyword_ids.length) return `<button class="btn btn-small" data-go="keywords">${t("Add keywords")}</button>`;
    if (!p || p.failed) return `<button class="btn btn-small" data-ai-aio-check ${p ? "" : "disabled"}>${t("Check now")}</button>`;
    if (!p.checks) return `<button class="btn btn-small" disabled>${esc(tf("All checked in the last {h} hours", { h: num(p.just_checked_hours) }))}</button>`;
    const tool = p.tools.find((x) => x.credits) || p.tools[0];
    const words = tool && tool.left !== null && tool.left !== undefined ? tf("Check now · uses {c} of {l} left", { c: num(p.credits), l: num(tool.left) }) : tf("Check now · {n}", { n: plural(p.checks, "{n} check", "{n} checks") });
    return `<button class="btn btn-small" data-ai-aio-check>${esc(words)}</button>`;
  }
  /* The simpler screens: one line and Open the watch. Check now (Sources, or the head's chip) asks the price only then, and its
     button and confirm show here once asked (A.aio.asked). */
  function aioLine(d) {
    const o = d.ai_overviews;
    const said = !o.tracked ? t("No keywords tracked, so no AI Overview checks yet.")
      : !o.captured ? t("No AI Overview checks yet.")
      : aioSaid(o);
    const p = A.aio.preview, tool = p?.tools?.find((x) => x.credits) || p?.tools?.[0];
    const check = A.aio.run || (A.aio.asked && o.keyword_ids.length) ? aioCheckButton(o) : !o.keyword_ids.length ? `<button class="btn btn-small" data-go="keywords">${t("Add keywords")}</button>` : "";
    const confirm = A.aio.confirm && p?.checks ? `<div class="ai-confirm" role="group" aria-label="${t("Check now")}"><span>${esc(tf("This checks {k} on Google with {tool} and uses {c}.", { k: plural(p.checks, "{n} keyword", "{n} keywords"), tool: tool?.name || "", c: plural(p.credits, "{n} credit", "{n} credits") }))}</span><button class="btn btn-small btn-main" data-ai-aio-go>${t("Check now")}</button><button class="btn btn-small btn-ghost" data-ai-aio-cancel>${t("Cancel")}</button></div>` : "";
    return `<section class="card ai-aio ai-aio-line"><div class="ai-aio-row"><p class="ai-aio-said">${icon("sparkles", "sec")}<span>${esc(said)}</span></p>
      <span class="ai-aio-acts">${check}<button class="link-btn" data-ai-watch="${esc(String(UI.siteIdPicked() || ""))}">${t("Open the watch")} ›</button></span></div>${confirm}</section>`;
  }
  function aioCard(d) {
    if (simple()) return aioLine(d);
    const o = d.ai_overviews, serp = stateOf(d, "serp");
    aioPreview(d);
    const said = !o.tracked ? t("No keywords tracked, so no AI Overview checks yet.")
      : !o.captured ? t("No AI Overview checks yet.")
      : aioSaid(o);
    const p = A.aio.preview, tool = p?.tools?.find((x) => x.credits) || p?.tools?.[0];
    const confirm = A.aio.confirm && p?.checks ? `<div class="ai-confirm" role="group" aria-label="${t("Check now")}"><span>${esc(tf("This checks {k} on Google with {tool} and uses {c}.", { k: plural(p.checks, "{n} keyword", "{n} keywords"), tool: tool?.name || "", c: plural(p.credits, "{n} credit", "{n} credits") }))}</span><button class="btn btn-small btn-main" data-ai-aio-go>${t("Check now")}</button><button class="btn btn-small btn-ghost" data-ai-aio-cancel>${t("Cancel")}</button></div>` : "";
    return `<section class="card ai-aio"><div class="ai-aio-row"><p class="ai-aio-said">${icon("sparkles", "sec")}<span>${esc(said)}</span></p><span class="ai-aio-chip">${chip(serp, { fix: false })}</span>
      <span class="ai-aio-acts">${aioCheckButton(o)}<button class="link-btn" data-ai-watch="${esc(String(UI.siteIdPicked() || ""))}">${t("Open the watch")} ›</button></span></div>${confirm}</section>`;
  }
  async function aioRun() {
    const d = current(); if (!d) return;
    A.aio.confirm = false;
    let run;
    try { run = await window.COMP.api("POST", "refresh/runs", { keyword_ids: d.ai_overviews.keyword_ids, engines: ["google"], depth: 10, mode: "auto", picked: [], include_recent: false, token: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }); }
    catch (err) { UI.toast(t(err.message), { kind: "crit" }); UI.render({ keepScroll: true }); return; }
    A.aio.run = run;
    UI.toast(tf("Checking {k} for AI Overviews. Updates when done.", { k: plural(run.total || 0, "{n} keyword", "{n} keywords") }), { kind: "good" });
    UI.render({ keepScroll: true });
    const started = Date.now();
    while (Date.now() - started < 600000) {
      await new Promise((done) => setTimeout(done, 3000));
      try { run = await window.COMP.api("GET", `refresh/runs/${run.id}`); } catch { continue; }
      if (run.status !== "queued" && run.status !== "running") break;
    }
    A.aio = { key: "", preview: null, asking: false, confirm: false, run: null };
    LVx().forget?.();
    SD()?.forget("metrics/ai");
    if (UI.state.route === "ai" && !UI.$("#panel")) UI.render({ keepScroll: true });
    UI.toast(t("AI Overviews checked."), { kind: "good" });
  }

  // ---- the sources panel -------------------------------------------------------------------------
  function sourcesPanel(opener) {
    const d = current(); if (!d) return;
    const row = (src) => {
      const sites = src.sites.length > 1 ? `<ul class="ai-src-sites">${src.sites.map((s) => `<li><span class="mono" dir="ltr">${esc(s.host)}</span> ${chip({ ...src, state: s.state, sites: [s] }, { fix: false, bare: true })}</li>`).join("")}</ul>` : "";
      const bad = src.sites.find((s) => s.state === "failing");
      const fix = bad?.error ? `<div class="ai-src-fix">${window.FIX?.html(bad.error, { tool: nameOf(src), retry: "refresh" }, { summary: true, said: true }) || esc(bad.error)}</div>` : "";
      const s = worstSite(src);
      // What the chip beside the name doesn't already say.
      const facts = src.id === "serp" ? [src.tracked ? plural(src.tracked, "{n} keyword tracked", "{n} keywords tracked") : "", t("Only on Check now: it uses search credits.")]
        : src.id === "clarity_download" ? [t("Totals for the file's period, until a newer upload.")]
        : src.id === "clarity_live" ? [s.last_attempt_at && s.last_attempt_at !== s.last_ok_at ? `${t("Last try")} ${stamp(s.last_attempt_at)}` : "", t("Read once a UTC day; Clarity keeps 3 days.")]
        : [s.last_ok_at ? `${t("Last good read")} ${stamp(s.last_ok_at)}` : "", s.last_attempt_at ? `${t("Last try")} ${stamp(s.last_attempt_at)}` : ""];
      const readToday = src.id === "clarity_live" && src.sites.length && src.sites.every((x) => x.read_today);
      const buttons = [
        src.id === "ga4" ? `<button class="btn btn-small" data-lv-collect data-lv-collect-sources="ga4,gsc" ${LVx().reading ? "disabled" : ""}>${t("Refresh")}</button>` : "",
        src.id === "clarity_live" && !["not_connected", "not_used"].includes(src.state) ? `<button class="btn btn-small" data-lv-collect data-lv-collect-sources="clarity" ${readToday || LVx().reading ? "disabled" : ""}>${t(readToday ? "Read today: next after 00:00 UTC" : "Refresh")}</button>` : "",
        src.id === "clarity_download" ? `<button class="btn btn-small" data-lv-connect="clarity">${t("Upload")}</button>` : "",
        src.id === "serp" ? `<button class="btn btn-small" data-ai-aio-focus>${t("Check now")}</button>` : "",
        `<button class="btn btn-small btn-ghost" data-lv-connect="${CONNECT[src.id]}">${t(["not_connected", "not_set_up"].includes(src.state) && src.id !== "serp" && src.id !== "clarity_download" ? "Connect" : src.state === "failing" ? "Fix" : "Settings")}</button>`,
      ].filter(Boolean).join("");
      return `<section class="ai-src"><div class="ai-src-head"><h3>${esc(nameOf(src))}</h3>${chip(src, { fix: false, bare: true })}</div>
        <p class="small muted">${facts.filter(Boolean).map(esc).join(" · ")}</p>${sites}${fix}<div class="ai-src-acts">${buttons}</div></section>`;
    };
    UI.openPanel(`${UI.panelHead(t("Sources"), t("Each card names its source; a failing one greys only its card."))}
      <div class="panel-body" id="ai-sources-panel">${d.source_states.map(row).join("")}${simple() ? window.GoogleAIReport?.panel?.() || "" : ""}</div>`, opener);
  }

  // ---- the AI list, behind "Edit the AI list ›" ---------------------------------------------------
  function listHtml(d) {
    const added = new Map(d.ai_rules.filter((r) => r.kind === "ai_domain" || !r.kind).map((r) => [r.pattern.toLowerCase(), r]));
    const off = d.ai_rules.filter((r) => r.kind === "ai_domain_off");
    const tag = (name) => {
      const rule = added.get(name);
      return `<span class="tag mono ai-list-tag" dir="ltr">${esc(name)}<button type="button" class="rs-chip-x" ${rule ? `data-ai-rule-del="${rule.id}"` : `data-ai-rule-off="${esc(name)}"`} aria-label="${esc(tf("Take {d} off the list", { d: name }))}" ${A.listBusy ? "disabled" : ""}>${icon("x")}</button></span>`;
    };
    return `<p class="help" style="margin:0 0 10px">${t("Visits from these count as AI, whatever their Google Analytics channel. Changes apply to past days too.")}</p>
      <div class="ai-list">${d.domains.map(tag).join("")}</div>
      ${off.length ? `<p class="small muted" style="margin:12px 0 4px">${t("Removed")}:</p><div class="ai-list">${off.map((r) => `<span class="tag mono" dir="ltr">${esc(r.pattern)} <button type="button" class="link-btn" data-ai-rule-del="${r.id}">${t("Put back")}</button></span>`).join("")}</div>` : ""}
      <form class="lv-rule-form ai-list-form" data-ai-rule-form style="border-top:0;padding:14px 0 0"><input class="input mono" spellcheck="false" autocapitalize="off" name="f_pattern" placeholder="assistant.example" aria-label="${t("Add a site to this list")}" autocomplete="off"><button class="btn btn-small" type="submit" ${A.listBusy ? "disabled" : ""}>${t("Add")}</button></form>
      <p class="error" data-ai-rule-error role="alert" hidden></p>`;
  }
  function listPanel(opener) {
    const d = current(); if (!d) return;
    UI.openPanel(`${UI.panelHead(t("The AI list"), tf("{n} on the list", { n: num(d.domains.length) }))}<div class="panel-body" id="ai-list-body">${listHtml(d)}</div>`, opener);
  }
  async function changeList(call) {
    A.listBusy = true;
    const box = UI.$("[data-ai-rule-error]");
    try {
      await call();
      LVx().forget();
      const key = `metrics/ai?${currentKey()}`;
      const data = await window.COMP.api("GET", key);
      if (SD()) { SD().forget("metrics/ai"); SD().put(key, data); } else LVx().cache.set(key, { loading: false, data, route: "ai" });
      A.listBusy = false;
      const body = UI.$("#ai-list-body");
      if (body) { UI.setHTML(body, listHtml(data)); body.querySelector("input")?.focus(); }
      const sub = UI.$("#panel .panel-head .sub");
      if (sub) sub.textContent = tf("{n} on the list", { n: num(data.domains.length) });
      UI.toast(t("AI list saved. Numbers recounted."), { kind: "good" });
    } catch (err) {
      A.listBusy = false;
      if (box) { box.textContent = t(err.message); box.hidden = false; }
    }
  }

  // ---- the page ----------------------------------------------------------------------------------
  let lastKey = "";
  const currentKey = () => lastKey;
  const current = () => (SD() ? SD().peek(`metrics/ai?${lastKey}`) : LVx().cache.get(`metrics/ai?${lastKey}`)?.data || null);
  const askKey = () => { const parts = [UI.range.days()]; const site = UI.siteIdPicked(); if (site) parts.push(`site_id=${site}`); return parts.join("&"); };
  function refreshSplit(d) {
    const live = stateOf(d, "clarity_live"), readToday = live.sites.length && live.sites.every((s) => s.read_today);
    const liveOff = ["not_connected", "not_used"].includes(live.state);
    const menu = A.menu ? `<div class="ai-menu" role="menu" id="ai-refresh-menu">
        <button role="menuitem" data-lv-collect data-lv-collect-sources="ga4,gsc"><span>${t("Google Analytics and Search Console")}</span></button>
        <button role="menuitem" data-lv-collect data-lv-collect-sources="clarity" ${readToday || liveOff ? "disabled" : ""}><span>${t("Clarity live")}</span><span class="small muted">${t(liveOff ? "not connected" : readToday ? "read today: next after 00:00 UTC" : "once a UTC day")}</span></button>
        <button role="menuitem" data-lv-connect="clarity"><span>${t("Upload a Clarity download…")}</span></button>
        <button role="menuitem" data-ai-aio-focus><span>${t("Check AI Overviews")}</span><span class="small muted">${t("uses credits, asks first")}</span></button></div>` : "";
    const reading = LVx().reading;
    return `<span class="ai-split"><button class="btn" data-lv-collect ${reading ? "disabled" : ""}>${icon("refresh-cw")}<span data-lv-collect-word>${reading ? esc(LVx().readingWord()) : t("Refresh data")}</span></button><button class="btn ai-caret" data-ai-menu aria-haspopup="menu" aria-expanded="${A.menu}" aria-label="${t("Refresh one source")}">${icon("chevron-down")}</button>${menu}</span>`;
  }
  // The simpler screens: Refresh data alone. Refreshing one source is in the Sources panel. .ai-split stays as the hook.
  function refreshOne() {
    const reading = LVx().reading;
    return `<span class="ai-split"><button class="btn" data-lv-collect ${reading ? "disabled" : ""}>${icon("refresh-cw")}<span data-lv-collect-word>${reading ? esc(LVx().readingWord()) : t("Refresh data")}</span></button></span>`;
  }
  function aiPage() {
    lastKey = askKey();
    // The simpler screens ask through the shared 5-minute cache (screen-data.js); the same address as LV.load's.
    const entry = SD() ? SD().entry(`metrics/ai?${lastKey}`, { route: "ai" }) : LVx().load("metrics/ai");
    const sub = t("Do AI assistants send you leads, and do AI answers cite you?");
    const wrap = (main, body, d = null) => (simple() && UI.head
      ? `${UI.head({ title: t("AI search"), source: d ? headSources(d) : null, info: ["Do AI assistants send you leads, and do AI answers cite you?", ...(d?.hid_rows ? ["Google Analytics hid some rows with few visits, so small numbers may be missing. A longer period may show them."] : [])], main })}<div class="content page-enter ai-page">${body}</div>`
      : `${UI.topbar(t("AI search"), sub, main)}<div class="content page-enter ai-page">${body}</div>`);
    if (entry.loading || entry.error || entry.noServer) return wrap("", LVx().stateCard(entry, "ga4"));
    const d = entry.data;
    if (d.state === "no_sites") return wrap("", LVx().stateCard(entry, "ga4"));
    if (d.through) UI.range.end("ai", d.through, "Google Analytics");
    if (simple()) {
      window.GoogleAIReport?.later?.(); // its fifth tab, quietly after this first draw
      return wrap(refreshOne(), `${answer(d)}${tiles(d)}
      <div class="ai-mid">${chartCard(d)}${actionsCard(d)}</div>
      ${tabsCard(d)}${aioCard(d)}`, d);
    }
    const fold = `<p class="note lv-note ai-limits">${icon("info")}<span>${t("Some AI visits show as Direct or Organic Search.")}${UI.tip("AI apps often send no referrer, so their visits show as Direct. Clicks from Google's AI Overviews count as Organic Search.")}</span><button class="link-btn" data-ai-list>${t("Edit the AI list")} ›</button></p>`;
    return wrap(refreshSplit(d), `${answer(d)}${LVx().hiddenNote(d.hid_rows)}${tiles(d)}
      <div class="ai-mid">${chartCard(d)}${actionsCard(d)}</div>
      ${tabsCard(d)}${aioCard(d)}${window.GoogleAIReport?.card() || ""}${fold}`);
  }

  // ---- events -------------------------------------------------------------------------------------
  function paintRuns() {
    const jobs = LVx().readingJobs;
    document.querySelectorAll("[data-ai-chip-run]").forEach((el) => {
      const source = { ga4: "ga4", clarity_live: "clarity" }[el.dataset.aiChipRun];
      const mine = (jobs || []).filter((j) => j.source === source || (source === "ga4" && j.source === "gsc"));
      if (!mine.length) { el.textContent = ""; return; }
      const done = mine.every((j) => ["done", "dead", "waiting"].includes(j.status)), running = mine.some((j) => j.status === "running");
      el.textContent = ` · ${done ? "✓" : running ? t("reading…") : t("queued")}`;
    });
  }
  function bind() {
    document.addEventListener("seocc:reading", paintRuns);
    document.addEventListener("seocc:collect-start", () => { if (A.menu) { A.menu = false; UI.$("#ai-refresh-menu")?.remove(); UI.$("[data-ai-menu]")?.setAttribute("aria-expanded", "false"); } });
    document.addEventListener("click", (e) => {
      const hit = (sel) => e.target.closest?.(sel);
      let el;
      if (A.menu && !hit("#ai-refresh-menu") && !hit("[data-ai-menu]")) { A.menu = false; UI.$("#ai-refresh-menu")?.remove(); UI.$("[data-ai-menu]")?.setAttribute("aria-expanded", "false"); }
      if (UI.state.route !== "ai" && !hit("#panel")) return;
      if ((el = hit("[data-ai-menu]"))) { A.menu = !A.menu; UI.render({ keepScroll: true }); if (A.menu) UI.$("#ai-refresh-menu button:not([disabled])")?.focus(); return; }
      if ((el = hit("[data-ai-tab]"))) { A.tab = el.dataset.aiTab; UI.render({ keepScroll: true }); UI.$(`[data-ai-tab="${A.tab}"]`)?.focus({ preventScroll: true }); return; }
      if ((el = hit("[data-ai-fold]"))) { const id = el.dataset.aiFold; if (A.fold.has(id)) A.fold.delete(id); else A.fold.add(id); UI.render({ keepScroll: true }); return; }
      if ((el = hit("[data-ai-sources]"))) { sourcesPanel(el); return; }
      if (SD() && hit("[data-lv-retry]")) { SD().forget("metrics/ai"); UI.render(); return; } // the shared cache keeps a failure until Try again
      if ((el = hit("[data-ai-list]"))) { listPanel(el); return; }
      if ((el = hit("[data-ai-watch]"))) { const site = Number(el.dataset.aiWatch) || undefined; window.COMP.open("ai", {}, site); return; }
      if (hit("[data-ai-aio-focus]")) {
        A.menu = false;
        if (UI.$("#panel")) UI.closePanel();
        if (simple()) { // the price is asked only now; the line then shows Check now and its confirm
          A.aio.asked = true;
          const d = current(), asking = d && !A.aio.preview && !A.aio.asking ? aioPreview(d) : null;
          if (asking) asking.then(() => { A.aio.confirm = Boolean(A.aio.preview?.checks); if (UI.state.route === "ai" && !UI.$("#panel:not(.closing)")) { UI.render({ keepScroll: true }); (UI.$("[data-ai-aio-go]") || UI.$("[data-ai-aio-check]"))?.focus({ preventScroll: true }); } });
        }
        A.aio.confirm = Boolean(A.aio.preview?.checks);
        UI.render({ keepScroll: true });
        setTimeout(() => { const box = UI.$(".ai-aio"); box?.scrollIntoView({ block: "center", behavior: UI.reduceMotion() ? "auto" : "smooth" }); (UI.$("[data-ai-aio-go]") || UI.$("[data-ai-aio-check]"))?.focus({ preventScroll: true }); }, 150);
        return;
      }
      if (hit("[data-ai-aio-check]")) { A.aio.confirm = true; UI.render({ keepScroll: true }); UI.$("[data-ai-aio-go]")?.focus({ preventScroll: true }); return; }
      if (hit("[data-ai-aio-cancel]")) { A.aio.confirm = false; UI.render({ keepScroll: true }); UI.$("[data-ai-aio-check]")?.focus({ preventScroll: true }); return; }
      if (hit("[data-ai-aio-go]")) { aioRun(); return; }
      if ((el = hit("[data-ai-rule-del]"))) { const id = el.dataset.aiRuleDel; changeList(() => window.COMP.api("DELETE", `rules/${id}`)); return; }
      if ((el = hit("[data-ai-rule-off]"))) { const name = el.dataset.aiRuleOff; changeList(() => window.COMP.api("POST", "rules", { kind: "ai_domain_off", pattern: name, site_id: UI.siteIdPicked() || null })); }
    });
    document.addEventListener("keydown", (e) => {
      if (UI.state.route !== "ai") return;
      if (e.key === "Escape" && A.menu) { A.menu = false; UI.render({ keepScroll: true }); UI.$("[data-ai-menu]")?.focus(); return; }
      // Arrow keys between the tabs: mockup.js does that for every role="tab".
    });
    document.addEventListener("submit", (e) => {
      const form = e.target.closest?.("[data-ai-rule-form]");
      if (!form) return;
      e.preventDefault();
      const box = UI.$("[data-ai-rule-error]");
      if (box) box.hidden = true;
      changeList(() => window.COMP.api("POST", "rules", { kind: "ai_domain", pattern: form.elements.f_pattern.value, site_id: UI.siteIdPicked() || null }));
    });
    // The assistants' own icons arrive a little after the page asks for them.
    let looked = "";
    setInterval(() => {
      if (UI.state.route !== "ai" || !window.COMP?.refreshLogos) return;
      const d = current(); if (!d) return;
      const wanted = d.sources.map((s) => s.source).filter((s) => s.includes(".") && !window.LOGOS_KNOWN?.has(s));
      const key = wanted.join(",");
      if (!wanted.length || key === looked) return;
      looked = key;
      (simple() && window.SCREEN_DATA?.logos ? window.SCREEN_DATA.logos() : window.COMP.refreshLogos()).then(() => { if (wanted.some((s) => window.LOGOS_KNOWN?.has(s)) && UI.state.route === "ai" && !UI.$("#panel") && !document.activeElement?.matches?.("input")) UI.render({ keepScroll: true }); });
    }, 4000);
  }

  window.SCREENS = window.SCREENS || {};
  window.SCREENS.ai = {
    init(helpers) {
      UI = helpers; ({ t, esc, num, icon } = helpers); bind();
      // The simpler screens: the first-view answer, for the warm-up and the menu hover (screen-data.js). One request.
      window.SCREEN_DATA?.screen?.("ai", () => [`metrics/ai?${askKey()}`]);
    },
    page: aiPage,
  };

  const fr = {
    "Compare with your other channels": "Comparer avec vos autres canaux",
    "Not compared": "Pas comparé",
    "The earlier download overlaps this one, so the counts can't be compared.": "Le téléchargement précédent chevauche celui-ci : les nombres ne se comparent pas.",
    "The earlier download covers a different number of days, so the counts can't be compared.": "Le téléchargement précédent couvre un autre nombre de jours : les nombres ne se comparent pas.",
    "Google Analytics": "Google Analytics", "Clarity live": "Clarity en direct", "Clarity download": "Export Clarity", "{n} of {m} sites": "{n} sites sur {m}",
    "not connected": "non connecté", "not used": "non utilisé", "no keywords checked": "aucun mot-clé relevé", "nothing uploaded": "rien d'importé",
    "waiting for data": "en attente de données", "Waiting for data": "En attente de données", "{n} sources waiting for data": "{n} sources en attente de données",
    "Connected. Waiting for data": "Connecté. En attente de données", "Arrives after the next run. Refresh data starts one now.": "Arrive après le prochain passage. Actualiser les données en lance un tout de suite.", "retrying": "nouvel essai", "reading…": "lecture…", "queued": "en file", "stopped working": "ne fonctionne plus",
    "last good": "dernière réussite", "not updating": "ne se met plus à jour", "tried": "essai", "{n} days behind": "{n} jours de retard", "through": "jusqu'au", "read": "lu", "data lost in {n} h": "données perdues dans {n} h",
    "uploaded": "importé", "checked": "relevé", "old": "ancien", "Fix": "Corriger", "Upload": "Importer",
    "All {n} sources up to date": "Les {n} sources sont à jour", "Source up to date": "Source à jour", "{n} sources · {m} need you ›": "{n} sources · {m} à traiter ›", "{n} sources ›": "{n} sources ›", "Sources": "Sources",
    "Copilot visits": "Visites Copilot", "Bing search visits": "Visites recherche Bing",
    "Visits: Google Analytics, from Copilot, and from Bing search apart, {a} – {b}.": "Visites : Google Analytics, depuis Copilot, et à part depuis la recherche Bing, {a} – {b}.",
    "Connect Google Analytics to see AI visits and leads.": "Connectez Google Analytics pour voir les visites et leads IA.",
    "No AI visits in this period.": "Aucune visite IA sur cette période.",
    "AI assistants sent {v} and {l}{c}, most from": "Les assistants IA ont envoyé {v} et {l}{c}, surtout depuis",
    "AI assistants sent {v}{c}, most from": "Les assistants IA ont envoyé {v}{c}, surtout depuis",
    "{n} visit": "{n} visite", "{n} visits": "{n} visites", "{n} lead": "{n} lead", "{n} leads": "{n} leads", "{n} key event": "{n} événement clé", "{n} key events": "{n} événements clés", "{n} time": "{n} fois", "{n} times": "{n} fois",
    "Copilot cited you {n}, but others win most of its answers ({s} share).": "Copilot vous a cité {n}, mais d'autres remportent la plupart de ses réponses ({s} de part).",
    "Copilot cited you {n}, with a {s} share of its answers.": "Copilot vous a cité {n}, avec {s} de ses réponses.", "Copilot cited your sites {n}.": "Copilot a cité vos sites {n}.",
    "AI Overviews on {o} of {c} keywords checked; you're cited in {m}.": "AI Overviews sur {o} des {c} mots-clés relevés ; vous êtes cité dans {m}.",
    "AI Overviews on {o} of {c} keywords checked with {tool}; you're cited in {m}.": "AI Overviews sur {o} des {c} mots-clés relevés avec {tool} ; vous êtes cité dans {m}.",
    "AI visits": "Visites IA", "Google Analytics not connected": "Google Analytics non connecté", "Leads": "Leads", "Not set up": "Non configuré", "Mark forms as GA4 key events": "Marquez vos formulaires comme événements clés GA4",
    "needs {need} AI visits, {n} so far": "il faut {need} visites IA, {n} pour l'instant", "organic search": "recherche organique", "{l} of {v}": "{l} sur {v}", "Lead rate": "Taux de lead",
    "Upload a Clarity AI download": "Importer un export IA de Clarity", "since the last upload": "depuis l'import précédent", "share": "part", "pts": "pts", "Copilot citations": "Citations Copilot",
    "Week {a} – {b}": "Semaine du {a} au {b}", "Connect Google Analytics to see AI visits.": "Connectez Google Analytics pour voir les visites IA.", "Connect": "Connecter",
    "Connect Clarity for its own AI visit count.": "Connectez Clarity pour son propre décompte de visites IA.", "Clarity isn't used here.": "Clarity n'est pas utilisé ici.", "Clarity not read these weeks yet.": "Clarity pas encore relevé sur ces semaines.",
    "Clarity read {n}: no AI visits.": "Clarity relevé sur {n} : aucune visite IA.", "Weeks count only the days read: {n} so far.": "Les semaines ne comptent que les jours relevés : {n} pour l'instant.",
    "{n} day read": "{n} jour relevé", "{n} days read": "{n} jours relevés", "{n} day": "{n} jour",
    "No AI visits in these weeks.": "Aucune visite IA sur ces semaines.", "a week with a lead": "une semaine avec un lead", "AI visits per week": "Visites IA par semaine",
    "No Clarity live reads on these days yet to compare.": "Pas encore de relevé Clarity en direct sur ces jours pour comparer.",
    "Second opinion: Clarity live saw {c} on the {n} read; Google Analytics saw {g}.": "Deuxième avis : Clarity en direct a vu {c} sur les {n} relevés ; Google Analytics en a vu {g}.",
    "{n} AI visit": "{n} visite IA", "{n} AI visits": "{n} visites IA", "day": "jour", "{n} days": "{n} jours",
    "{p}: {n} AI visits, no lead": "{p} : {n} visites IA, aucun lead", "Add a call to action high on the page.": "Ajoutez un appel à l'action en haut de la page.",
    "{q}: {s} share of Copilot's answers": "{q} : {s} des réponses de Copilot", "Add an FAQ that answers it to {p}.": "Ajoutez une FAQ qui y répond sur {p}.",
    "No page of yours ranks for it yet. Write one.": "Aucune de vos pages ne se classe dessus. Écrivez-en une.",
    "{r} is cited in AI Overview for “{k}”, you aren't.": "{r} est cité dans l'AI Overview pour « {k} », pas vous.", "See what their page says that yours doesn't.": "Regardez ce que leur page dit et pas la vôtre.",
    "Copilot cites {p} {n} but sends no visit": "Copilot cite {p} {n} mais n'envoie aucune visite", "Give a reason to click: figures, a tool or a checklist.": "Donnez une raison de cliquer : chiffres, outil ou liste.",
    "Share of authority": "Part d'autorité", "citations": "citations", "Compare": "Comparer", "Task": "Tâche", "{n} of {m}": "{n} sur {m}", "Next actions": "Prochaines actions",
    "Nothing to do right now.": "Rien à faire pour l'instant.",
    "Assistants": "Assistants", "Landing pages": "Pages d'arrivée", "Cited pages": "Pages citées", "Questions to win": "Questions à gagner", "Show": "Afficher", "Hide": "Masquer",
    "Connect Google Analytics to see which assistants send visits.": "Connectez Google Analytics pour voir quels assistants envoient des visites.",
    "No AI visits in this period: a real zero.": "Aucune visite IA sur cette période : un vrai zéro.",
    "Assistant": "Assistant", "Visits": "Visites", "Lead rate shows from {n} AI visits.": "Le taux de lead s'affiche dès {n} visites IA.",
    "Connect Google Analytics to see AI landing pages.": "Connectez Google Analytics pour voir les pages d'arrivée IA.", "Page": "Page", "Action": "Action",
    "{n} of {m} pages: AI visits, no lead. Task button from {min} visits.": "{n} pages sur {m} : visites IA, aucun lead. Bouton de tâche dès {min} visites.",
    "Leads aren't tracked: mark your forms as key events in GA4.": "Les leads ne sont pas suivis : marquez vos formulaires comme événements clés dans GA4.",
    "{n} pages with one AI visit each": "{n} pages avec une seule visite IA chacune", "{n} pages got one AI visit each; none stands out yet.": "{n} pages ont eu une seule visite IA chacune ; aucune ne se détache encore.", "No AI landing pages in this period.": "Aucune page d'arrivée IA sur cette période.",
    "See which pages Copilot cites: in Clarity, AI visibility → Export, then upload it.": "Voyez quelles pages Copilot cite : dans Clarity, Visibilité IA → Exporter, puis importez-le.",
    "Cited, no visit": "Cité, aucune visite", "{n} pages cited, no visit": "{n} pages citées, aucune visite", "1 page cited, no visit": "1 page citée, aucune visite", "Citations": "Citations", "Copilot and Bing visits": "Visites Copilot et Bing", "Google Analytics has none of the download's days.": "Google Analytics n'a aucun des jours de l'export.", "Note": "Note",
    "Visits: Google Analytics, from Copilot and Bing, {a} – {b}.": "Visites : Google Analytics, depuis Copilot et Bing, {a} – {b}.",
    "{n} pages cited once each": "{n} pages citées une seule fois", "Copilot cited {n} pages once each; none stands out yet.": "Copilot a cité {n} pages une seule fois chacune ; aucune ne se détache encore.", "No cited pages in this download.": "Aucune page citée dans cet export.",
    "See the Copilot questions others win: upload Clarity's AI download.": "Voyez les questions Copilot que d'autres remportent : importez l'export IA de Clarity.",
    "No questions in this download. Include them in Clarity's export, then upload again.": "Pas de questions dans cet export. Incluez-les dans l'export Clarity, puis importez-le à nouveau.",
    "via “{q}”": "via « {q} »", "No page yet": "Pas encore de page", "Question": "Question", "Share": "Part", "Best page": "Meilleure page",
    "{n} of {m} questions give you under {s} of Copilot's answers.": "{n} questions sur {m} vous donnent moins de {s} des réponses de Copilot.",
    "AI search": "Recherche IA", "Checking…": "Relevé en cours…", "Add keywords": "Ajouter des mots-clés", "Check now": "Relever maintenant", "All checked in the last {h} hours": "Tous relevés ces {h} dernières heures",
    "Check now · uses {c} of {l} left": "Relever · utilise {c} des {l} restants", "Check now · {n}": "Relever · {n}", "{n} check": "{n} relevé", "{n} checks": "{n} relevés",
    "No keywords tracked, so no AI Overview checks yet.": "Aucun mot-clé suivi : pas encore de relevé d'AI Overview.",
    "No AI Overview checks yet.": "Aucun relevé d'AI Overview pour l'instant.",
    
    "This checks {k} on Google with {tool} and uses {c}.": "Cela relève {k} sur Google avec {tool} et utilise {c}.", "{n} keyword": "{n} mot-clé", "{n} keywords": "{n} mots-clés", "{n} credit": "{n} crédit", "{n} credits": "{n} crédits", "Cancel": "Annuler",
    "Open the watch": "Ouvrir le suivi", "Checking {k} for AI Overviews. Updates when done.": "Relevé de {k} pour les AI Overviews. Mise à jour à la fin.", "AI Overviews checked.": "AI Overviews relevés.",
    "Only on Check now: it uses search credits.": "Seulement sur Relever : cela utilise des crédits de recherche.", "{n} keyword tracked": "{n} mot-clé suivi", "{n} keywords tracked": "{n} mots-clés suivis", "Totals for the file's period, until a newer upload.": "Totaux sur la période du fichier, jusqu'à un import plus récent.",
    "Last good read": "Dernière lecture réussie", "Last try": "Dernier essai", "Read once a UTC day; Clarity keeps 3 days.": "Lu une fois par jour UTC ; Clarity garde 3 jours.",
    "Read again now": "Relire maintenant", "Read today: next after 00:00 UTC": "Lu aujourd'hui : prochain après 00:00 UTC", "Settings": "Réglages",
    "Each card names its source; a failing one greys only its card.": "Chaque carte nomme sa source ; une source en échec ne grise que sa carte.",
    "Take {d} off the list": "Retirer {d} de la liste", "Visits from these count as AI, whatever their Google Analytics channel. Changes apply to past days too.": "Les visites venues de ces sites comptent comme IA, quel que soit leur canal dans Google Analytics. Les changements s'appliquent aussi aux jours passés.",
    "Removed": "Retirés", "Put back": "Remettre", "Add a site to this list": "Ajouter un site à cette liste", "Add": "Ajouter",
    "The AI list": "La liste IA", "{n} on the list": "{n} dans la liste", "AI list saved. Numbers recounted.": "Liste IA enregistrée. Chiffres recomptés.",
    "Google Analytics and Search Console": "Google Analytics et Search Console", "read today: next after 00:00 UTC": "lu aujourd'hui : prochain après 00:00 UTC", "once a UTC day": "une fois par jour UTC",
    "Upload a Clarity download…": "Importer un export Clarity…", "Check AI Overviews": "Relever les AI Overviews", "uses credits, asks first": "utilise des crédits, demande d'abord",
    "Refresh data": "Actualiser les données", "Refresh one source": "Actualiser une seule source", "Do AI assistants send you leads, and do AI answers cite you?": "Les assistants IA vous envoient-ils des leads, et les réponses IA vous citent-elles ?",
    "Some AI visits show as Direct or Organic Search.": "Certaines visites IA apparaissent en Direct ou en Recherche organique.",
    "Edit the AI list": "Modifier la liste IA", "What AI says": "Ce que dit l'IA",
    // the simpler screens
    "{n} sources up to date": "{n} sources à jour", "{n} sources need you": "{n} sources à traiter", "Google AI report": "Rapport IA de Google",
  };
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });
  // Definitions behind the (i) on two of the numbers. shared-ui.js holds the rest, in the same object.
  Object.assign(window.METRIC_DEFS || {}, {
    "AI lead rate": ["AI leads divided by AI visits. Shown from 30 AI visits, beside the organic search rate, always with the counts.", "Leads IA divisés par visites IA. Affiché à partir de 30 visites IA, à côté du taux de la recherche organique, toujours avec les nombres."],
    "Copilot citations": ["Times Copilot named one of your pages as a source, in the last Clarity AI download, for that file's own period.", "Nombre de fois où Copilot a cité l'une de vos pages comme source, dans le dernier export IA de Clarity, sur la période de ce fichier."],
  });
  if (window.FR) Object.assign(window.FR, { "AI lead rate": window.FR["AI lead rate"] || "Taux de lead IA", "Copilot citations": window.FR["Copilot citations"] || "Citations Copilot" });
})();
