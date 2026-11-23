/* A keyword's history in its side panel: one chart on one time line (owner, 2026-11-20).
   Our position is the blue line. Each rival is a purple line with its own dash and dot shape, switched on or off by its chip.
   Under the chart, on the same time line, sit what we did to the keyword's page: edits the daily reading saw, backlinks
   placed pointing at it, and boosts (traffic sent to the page, which a person records here with "Add a boost").

     KeywordHistory.load(info)                    asks GET /api/rankings/<id>/history and redraws itself when it answers
     KeywordHistory.html(info, line, { checkRow }) the chart, or the table when info.table is on

   `info` is the panel's own object (siteId, keywordId, engine, detail, table); `line` is the tool/location/depth line
   picked there. Rival lines come from that same line's checks, so they can share its chart. It draws itself: a chip, a mark
   or the form never asks the panel around it to redraw. */
(() => {
  "use strict";
  const fr = {
    "Edit": "Modification", "Backlink": "Backlink", "Boost": "Boost", "Note": "Note", "{n} edits": "{n} modifications", "{n} backlinks": "{n} backlinks", "{n} boosts": "{n} boosts", "{n} notes": "{n} notes",
    "Title": "Titre", "Description": "Description", "H1": "H1", "Headings": "Intertitres", "Canonical": "Canonique", "Robots": "Robots", "Schema": "Schema", "Content": "Contenu",
    "changed": "modifié", "words": "mots", "about {n} words changed": "environ {n} mots modifiés", "Anchor": "Ancre", "Lost": "Perdu", "Planned": "Prévu", "Added by {name}": "Ajouté par {name}",
    "Delete this boost": "Supprimer ce boost", "More sites": "Plus de sites", "Lines on the chart": "Courbes du graphique", "Marks under the chart": "Repères sous le graphique", "Picked mark": "Repère choisi",
    "Add a boost": "Ajouter un boost", "Traffic you sent to this page.": "Du trafic envoyé vers cette page.", "Start": "Début", "End": "Fin", "optional": "facultatif",
    "Google Ads, newsletter…": "Google Ads, newsletter…", "Save": "Enregistrer", "Cancel": "Annuler", "Boost added": "Boost ajouté", "Boost deleted": "Boost supprimé",
    "Couldn't load edits, backlinks and boosts.": "Impossible de charger les modifications, backlinks et boosts.", "Try again": "Réessayer", "Couldn't save the boost.": "Impossible d'enregistrer le boost.",
    "No page known for this keyword yet, so no edits or backlinks to show.": "Aucune page connue pour ce mot-clé : pas de modifications ni de backlinks à afficher.",
    "No edit, backlink or boost seen for this page yet.": "Aucune modification, aucun backlink ni boost pour cette page pour l'instant.",
    "1 from before the first check is in Table.": "1 élément d'avant la première vérification est dans Tableau.", "{n} from before the first check are in Table.": "{n} éléments d'avant la première vérification sont dans Tableau.",
    "1 backlink to this page has no date, so it isn't marked.": "1 backlink vers cette page n'a pas de date : il n'est pas repéré.", "{n} backlinks to this page have no date, so they aren't marked.": "{n} backlinks vers cette page n'ont pas de date : ils ne sont pas repérés.",
    "Give the page's full address, starting with https://.": "Donnez l'adresse complète de la page, commençant par https://.", "Give the start date.": "Indiquez la date de début.",
    "The end date is before the start date.": "La date de fin est avant la date de début.", "The start date isn't a date.": "La date de début n'est pas une date.", "The end date isn't a date.": "La date de fin n'est pas une date.",
    "That page isn't on this website.": "Cette page n'est pas sur ce site.", "Keep the note under 300 characters.": "Gardez la note sous 300 caractères.", "That boost doesn't exist.": "Ce boost n'existe pas.",
  };
  const UI = () => window.UI;
  // This chart's own French comes first: "Edit" here is a thing done to a page (Modification), not the app's Edit button (Modifier).
  const t = (word) => (UI().locale() === "fr-FR" && fr[word] !== undefined ? fr[word] : UI().t(word));
  const esc = (text) => UI().esc(text);
  const icon = (name, cls) => UI().icon(name, cls);
  const fill = (word, values) => t(word).replace(/\{(\w+)\}/g, (_, key) => values[key]);
  const day = (iso) => UI().fmtDateOnly(String(iso).slice(0, 10));
  const canEdit = () => !window.ACCESS || window.ACCESS.canEdit("keywords");

  const W = 440, H = 168, LEFT = 26, RIGHT = 10, TOP = 10, BOTTOM = 26;
  const DAY = 86400000, MARK_PX = 24, SHOWN_FIRST = 4, WIDE_MAX = 520;
  const TYPES = [["edit", "Edit", "pencil"], ["backlink", "Backlink", "link-2"], ["boost", "Boost", "megaphone"], ["note", "Note", "sticky-note"]];
  const TYPE = Object.fromEntries(TYPES.map(([id, word, glyph]) => [id, { word, glyph }]));
  const MANY = { edit: "{n} edits", backlink: "{n} backlinks", boost: "{n} boosts", note: "{n} notes" };
  const KINDS = { title: "Title", meta: "Description", h1: "H1", headings: "Headings", canonical: "Canonical", robots: "Robots", schema: "Schema", content: "Content" };
  const SHORT_KINDS = ["title", "meta", "h1", "canonical", "robots"]; // the ones whose before and after fit on a line
  // Every rival is purple ("them"); the dash and the dot's shape tell one from the next, and the fifth onwards is a paler purple.
  const DASHES = ["", "6 4", "2 3", "9 3 2 3"], SHAPES = ["circle", "square", "triangle", "diamond"];

  let current = null; // what is drawn in the panel now: { info, line, opts }

  const stateOf = (info) => (info.kwh ||= { on: null, more: false, picked: null, form: false, draft: null, error: "", saving: false, loading: false, failed: false });
  const lineKey = (x) => `${x.tool}|${x.location}|${x.depth}`;
  const noon = (date) => Date.parse(`${date}T12:00:00Z`);

  // ---- the answer ---------------------------------------------------------------------------------
  function load(info) {
    const st = stateOf(info);
    st.loading = true; st.failed = false;
    return window.COMP.api("GET", `rankings/${info.keywordId}/history?site_id=${info.siteId}&engine=${info.engine}`)
      .then((data) => { info.history = data; })
      .catch(() => { st.failed = !info.history; }) // an older answer stays on screen
      .finally(() => { st.loading = false; repaint(info); });
  }

  /* Everything done to the page, each with the moment it sits at on the time line. */
  function eventsOf(info) {
    const h = info.history;
    if (!h) return [];
    return [
      ...h.edits.map((e) => ({ type: "edit", key: `edit|${e.at}`, date: e.at, at: noon(e.at), item: e })),
      ...h.backlinks.map((b) => ({ type: "backlink", key: `backlink|${b.id}`, date: b.at, at: noon(b.at), item: b })),
      ...h.boosts.map((b) => ({ type: "boost", key: `boost|${b.id}`, date: b.start, at: noon(b.start), until: b.end && b.end !== b.start ? noon(b.end) : null, item: b })),
      ...h.notes.map((n) => ({ type: "note", key: `note|${n.id}`, date: n.at, at: noon(n.at), item: n })),
    ].sort((a, b) => a.at - b.at);
  }

  const rivalsOf = (info, line) => info.history?.lines.find((x) => lineKey(x) === lineKey(line))?.rivals || [];
  function shownSet(info, rivals) {
    const st = stateOf(info);
    if (!st.on && !info.history) return new Set(); // not answered yet: nothing is chosen before the rivals are known
    if (!st.on) st.on = new Set(rivals.filter((r) => r.tracked).slice(0, SHOWN_FIRST).map((r) => r.host));
    return st.on;
  }
  const styleOf = (i) => ({ dash: DASHES[i % DASHES.length], shape: SHAPES[i % SHAPES.length], pale: i >= DASHES.length });

  // ---- words for one event ------------------------------------------------------------------------
  const boostDays = (b) => (b.end && b.end !== b.start ? `${day(b.start)} – ${day(b.end)}` : day(b.start));
  const kindWords = (e) => e.changes.map((c) => t(KINDS[c.kind] || c.kind)).join(", ");
  function plain(ev) {
    const word = t(TYPE[ev.type].word), it = ev.item;
    if (ev.type === "edit") return `${word}, ${day(it.at)}: ${kindWords(it)}`;
    if (ev.type === "backlink") return `${word}, ${day(it.at)}: ${it.domain}${it.status === "lost" ? ` (${t("Lost")})` : it.status === "planned" ? ` (${t("Planned")})` : ""}`;
    if (ev.type === "boost") return `${word}, ${boostDays(it)}${it.note ? `: ${it.note}` : ""}`;
    return `${word}, ${day(it.at)}: ${it.body}`;
  }
  function groupWords(group) {
    if (group.length === 1) return plain(group[0]);
    const first = group[0].date, last = group[group.length - 1].date;
    return `${fill(MANY[group[0].type], { n: group.length })}, ${first === last ? day(first) : `${day(first)} – ${day(last)}`}`;
  }

  function changeRow(c) {
    const name = `<span class="kwh-k">${t(KINDS[c.kind] || c.kind)}</span>`;
    if (c.kind === "content") {
      const words = (v) => esc(String(v || "").replace(/ words$/, ` ${t("words")}`));
      return `<div>${name}<span>${c.words ? esc(fill("about {n} words changed", { n: c.words })) : `${words(c.before)} → ${words(c.after)}`}</span></div>`;
    }
    if (!SHORT_KINDS.includes(c.kind) || (!c.before && !c.after)) return `<div>${name}<span>${t("changed")}</span></div>`;
    return `<div>${name}<span dir="auto"><s>${esc(c.before || "—")}</s> → ${esc(c.after || "—")}</span></div>`;
  }
  function detailOf(ev) {
    const it = ev.item;
    if (ev.type === "edit") return it.changes.map(changeRow).join("");
    if (ev.type === "backlink") {
      const state = it.status === "lost" ? `<span class="kwh-tag crit">${t("Lost")}</span>` : it.status === "planned" ? `<span class="kwh-tag">${t("Planned")}</span>` : "";
      const from = window.PageLink ? window.PageLink.html(it.source_url, { text: String(it.source_url).replace(/^https?:\/\/(www\.)?/, ""), cls: "mono small" }) : esc(it.source_url);
      return `<div class="kwh-from">${UI().siteLogo ? UI().siteLogo(it.domain, 16) : ""}${from}${state}</div>${it.anchor ? `<div><span class="kwh-k">${t("Anchor")}</span><span dir="auto">${esc(it.anchor)}</span></div>` : ""}`;
    }
    if (ev.type === "boost") return `${it.note ? `<div dir="auto">${esc(it.note)}</div>` : ""}${it.created_by ? `<div class="muted" dir="auto">${esc(fill("Added by {name}", { name: it.created_by }))}</div>` : ""}`;
    return `<div dir="auto">${esc(it.body)}</div>`;
  }
  function eventItem(ev, dated = true) {
    const del = ev.type === "boost" && canEdit()
      ? `<button class="btn btn-small btn-ghost kwh-del" data-kwh-del="${ev.item.id}" data-kwh-f="del-${ev.item.id}" aria-label="${esc(t("Delete this boost"))}" data-tip="${esc(t("Delete this boost"))}">${icon("trash-2")}</button>` : "";
    return `<li class="kwh-ev kwh-${ev.type}"><span class="kwh-glyph" aria-hidden="true">${icon(TYPE[ev.type].glyph)}</span><div class="kwh-ev-main"><div class="kwh-ev-head"><b>${t(TYPE[ev.type].word)}</b>${dated || (ev.type === "boost" && ev.until) ? `<span class="tabular">${esc(ev.type === "boost" ? boostDays(ev.item) : day(ev.date))}</span>` : ""}</div><div class="kwh-ev-body small">${detailOf(ev)}</div></div>${del}</li>`;
  }

  // ---- the chart ----------------------------------------------------------------------------------
  function dot(shape, x, y, r, attrs) {
    const X = x.toFixed(1), Y = y.toFixed(1);
    if (shape === "square") return `<rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" ${attrs}/>`;
    if (shape === "triangle") return `<path d="M${X},${(y - r * 1.2).toFixed(1)}L${(x + r * 1.15).toFixed(1)},${(y + r * 0.9).toFixed(1)}L${(x - r * 1.15).toFixed(1)},${(y + r * 0.9).toFixed(1)}Z" ${attrs}/>`;
    if (shape === "diamond") return `<path d="M${X},${(y - r * 1.3).toFixed(1)}L${(x + r * 1.3).toFixed(1)},${Y}L${X},${(y + r * 1.3).toFixed(1)}L${(x - r * 1.3).toFixed(1)},${Y}Z" ${attrs}/>`;
    return `<circle cx="${X}" cy="${Y}" r="${r}" ${attrs}/>`;
  }
  const swatch = (style, cls) => `<svg class="kwh-swatch ${cls}" viewBox="0 0 26 10" width="26" height="10" aria-hidden="true"><line x1="1" x2="25" y1="5" y2="5" ${style?.dash ? `stroke-dasharray="${style.dash}"` : ""}/>${style ? dot(style.shape, 13, 5, 2.6, 'class="d"') : '<circle cx="13" cy="5" r="3" class="d"/>'}</svg>`;

  function widthNow() {
    const box = document.querySelector("#panel .kwh-plot") || document.querySelector("#panel [data-kwh]") || document.querySelector("#panel .panel-body");
    const cap = document.querySelector("#panel.wide") ? WIDE_MAX : Infinity; // the wide panel keeps its chart at this width (keyword-history.css)
    return Math.max(240, Math.min(cap, box?.clientWidth || W));
  }

  function chart(info, line, rivals, events) {
    const st = stateOf(info), points = line.points.map((p) => ({ ...p, t: Date.parse(p.at) }));
    const known = points.filter((p) => p.p);
    if (known.length < 2) return { html: `<p class="note">${icon("info")}<span>${t("Needs 2 checks, same tool")}</span></p>`, before: 0, drawn: false };
    const on = shownSet(info, rivals);
    const shown = rivals.map((r, i) => ({ ...r, style: styleOf(i) })).filter((r) => on.has(r.host));
    const t0 = points[0].t, lastCheck = points[points.length - 1].t, now = Date.now();
    // The line ends at the last check, or at the latest thing done to the page since, so a boost from this week still shows.
    const t1 = Math.max(lastCheck, ...events.filter((e) => e.at <= now).map((e) => e.at), t0 + DAY);
    const x = (ms) => LEFT + ((Math.min(Math.max(ms, t0), t1) - t0) / (t1 - t0)) * (W - LEFT - RIGHT);
    const all = [...known.map((p) => p.p), ...shown.flatMap((r) => r.points.map((p) => p.p).filter(Boolean))];
    // Even steps from 1 (1, 2, 3 … or 1, 3, 5 … or 1, 6, 11 …), at most five lines, the last one at or past the worst position.
    const step = [1, 2, 5, 10, 20, 25, 50].find((n) => (Math.max(...all) - 1) / n <= 4) || 50;
    const hi = 1 + step * Math.max(1, Math.ceil((Math.max(...all) - 1) / step));
    const y = (v) => TOP + ((v - 1) / Math.max(1, hi - 1)) * (H - TOP - BOTTOM);
    const ticks = Array.from({ length: Math.round((hi - 1) / step) + 1 }, (_, i) => 1 + i * step);
    const date = (p) => day(p.at);
    // A check beyond the depth leaves a gap, never a line down to a made-up number. A suspect result is a hollow dot on no line.
    const pathOf = (pts) => { let d = "", pen = false; pts.forEach((p) => { if (!p.p || p.suspect) { pen = false; return; } d += `${pen ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`; pen = true; }); return d; };
    const r = points.length > 40 ? 2.5 : 4;
    const mine = points.map((p) => (p.p ? `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.p).toFixed(1)}" r="${r}" fill="${p.suspect ? "var(--panel-solid)" : "var(--series-1)"}" stroke="${p.suspect ? "var(--series-1)" : "var(--panel-solid)"}" stroke-width="2" data-tip="${esc(date(p))}: #${p.p}${p.suspect ? ` · ${esc(t("Suspect result"))}` : ""}"/>` : "")).join("");
    const theirs = shown.map((rival) => {
      const pts = rival.points.map((p) => ({ ...p, t: Date.parse(p.at) }));
      const dots = pts.map((p) => (p.p ? dot(rival.style.shape, x(p.t), y(p.p), points.length > 40 ? 1.8 : 2.6, `class="d" data-tip="${esc(rival.host)} · ${esc(date(p))}: #${p.p}"`) : "")).join("");
      return `<g class="kwh-them${rival.style.pale ? " pale" : ""}" data-kwh-line="${esc(rival.host)}"><path d="${pathOf(pts)}" ${rival.style.dash ? `stroke-dasharray="${rival.style.dash}"` : ""}/>${dots}</g>`;
    }).join("");

    // What was done to the page, on the same time line. Anything before the first check has no place on it: the table lists it.
    const visible = events.filter((e) => (e.until || e.at) + DAY / 2 >= t0 && e.at <= t1 + DAY / 2);
    const gap = (MARK_PX * W) / widthNow(); // marks closer than their own width share one mark
    const lanes = TYPES.map(([type]) => {
      const groups = [];
      visible.filter((e) => e.type === type).forEach((e) => {
        const at = x(e.at), last = groups[groups.length - 1];
        if (last && !e.until && !last.until && at - last.x < gap) { last.events.push(e); return; }
        groups.push({ x: at, until: e.until ? x(e.until) : null, events: [e] });
      });
      return { type, groups };
    }).filter((lane) => lane.groups.length);
    const guides = lanes.flatMap((lane) => lane.groups.map((g) => (g.until
      ? `<rect class="kwh-band" x="${g.x.toFixed(1)}" y="${TOP}" width="${Math.max(1, g.until - g.x).toFixed(1)}" height="${H - TOP - BOTTOM}"/>`
      : `<line class="kwh-guide kwh-${lane.type}" x1="${g.x.toFixed(1)}" x2="${g.x.toFixed(1)}" y1="${TOP}" y2="${H - BOTTOM}"/>`))).join("");
    const pct = (v) => `${((v / W) * 100).toFixed(2)}%`;
    const marks = lanes.map((lane) => `<div class="kwh-lane kwh-${lane.type}"><span class="kwh-lane-key" aria-hidden="true">${icon(TYPE[lane.type].glyph)}</span>${lane.groups.map((g) => {
      const keys = g.events.map((e) => e.key).join(" "), words = groupWords(g.events);
      const pressed = st.picked === keys;
      const place = g.until ? `left:${pct(g.x)};width:${pct(g.until - g.x)}` : `left:${pct(g.x)}`;
      return `<button type="button" class="kwh-mark${g.until ? " kwh-range" : ""}" style="${place}" data-kwh-mark="${esc(keys)}" data-kwh-f="mark-${esc(keys)}" aria-pressed="${pressed}" aria-label="${esc(words)}" data-tip="${esc(words)}">${icon(TYPE[lane.type].glyph)}${g.events.length > 1 ? `<b>${g.events.length}</b>` : ""}</button>`;
    }).join("")}</div>`).join("");

    const label = `${t("Position history")}: ${points.map((p) => `${date(p)} ${p.p ? `#${p.p}` : `>${line.depth}`}`).join(", ")}${shown.map((rival) => { const last = [...rival.points].reverse().find((p) => p.p); return `. ${rival.host}: ${last ? `#${last.p}` : `>${line.depth}`}`; }).join("")}`;
    const svg = `<svg class="chart kwh-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
      ${ticks.map((v) => `<line x1="${LEFT}" x2="${W - RIGHT}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${LEFT - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("")}
      <text x="${LEFT}" y="${H - 7}" text-anchor="start">${esc(day(new Date(t0).toISOString()))}</text><text x="${W - RIGHT}" y="${H - 7}" text-anchor="end">${esc(day(new Date(t1).toISOString()))}</text>
      ${guides}${theirs}<path class="chart-line" d="${pathOf(points)}"/>${mine}</svg>`;
    return { html: `<div class="kwh-plot">${svg}${marks ? `<div class="kwh-lanes">${marks}</div>` : ""}</div>`, before: events.filter((e) => !visible.includes(e) && e.at < t0).length, visible, drawn: true };
  }

  function chips(info, rivals) {
    if (!rivals.length) return "";
    const st = stateOf(info), on = shownSet(info, rivals);
    const followed = rivals.some((r) => r.tracked);
    const chip = (r, i) => {
      const style = styleOf(i);
      return `<button type="button" class="kwh-chip${style.pale ? " pale" : ""}" data-kwh-rival="${esc(r.host)}" data-kwh-f="rival-${esc(r.host)}" aria-pressed="${on.has(r.host)}">${swatch(style, "them")}${UI().siteLogo ? UI().siteLogo(r.host, 16) : ""}<span dir="auto">${esc(r.host)}</span></button>`;
    };
    // Followed rivals first. The other sites seen in these checks wait behind one button, unless nobody is followed here.
    const first = rivals.map((r, i) => (r.tracked || !followed || st.more || on.has(r.host) ? chip(r, i) : "")).join("");
    const hidden = rivals.filter((r) => !r.tracked && !on.has(r.host)).length;
    const more = followed && hidden && !st.more ? `<button type="button" class="link-btn" data-kwh-more data-kwh-f="more">${t("More sites")}</button>` : "";
    return `<div class="kwh-chips" role="group" aria-label="${esc(t("Lines on the chart"))}"><span class="kwh-you">${swatch(null, "you")}<span>${t("You")}</span></span>${first}${more}</div>`;
  }

  function form(info) {
    const st = stateOf(info), page = info.detail.row.page, d = st.draft || {};
    const today = new Date().toISOString().slice(0, 10);
    const where = page
      ? `<p class="kwh-form-page small"><span class="kwh-k">${t("Page")}</span>${window.PageLink ? window.PageLink.html(page, { cls: "mono" }) : esc(page)}</p>`
      : `<label class="field"><span>${t("Page")}</span><input class="input" type="url" name="page" required placeholder="https://" value="${esc(d.page || "")}" data-kwh-f="f-page"></label>`;
    return `<form class="kwh-form" data-kwh-form novalidate>
      <p class="kwh-form-title"><b>${t("Add a boost")}</b><span class="small muted">${t("Traffic you sent to this page.")}</span></p>
      ${where}
      <div class="field-row"><label class="field"><span>${t("Start")}</span><input class="input" type="date" name="start" required min="2000-01-01" value="${esc(d.start ?? today)}" data-kwh-f="f-start"></label>
      <label class="field"><span>${t("End")} <span class="muted">· ${t("optional")}</span></span><input class="input" type="date" name="end" min="2000-01-01" value="${esc(d.end || "")}" data-kwh-f="f-end"></label></div>
      <label class="field"><span>${t("Note")} <span class="muted">· ${t("optional")}</span></span><input class="input" type="text" name="note" maxlength="300" value="${esc(d.note || "")}" placeholder="${esc(t("Google Ads, newsletter…"))}" data-kwh-f="f-note"></label>
      <p class="error kwh-error" role="alert">${st.error ? `${icon("octagon-alert")}<span>${esc(t(st.error))}</span>` : ""}</p>
      <div class="kwh-form-acts"><button type="submit" class="btn btn-main btn-small" data-kwh-f="save" ${st.saving ? "disabled" : ""}>${t("Save")}</button><button type="button" class="btn btn-small" data-kwh-cancel data-kwh-f="cancel">${t("Cancel")}</button></div>
    </form>`;
  }

  function legend(info, events) {
    const st = stateOf(info);
    const types = TYPES.filter(([id]) => id !== "note" || events.some((e) => e.type === "note"));
    const add = canEdit() && !st.form ? `<button type="button" class="btn btn-small kwh-add" data-kwh-add data-kwh-f="add">${icon("plus")}${t("Add a boost")}</button>` : "";
    return `<div class="kwh-legend"><ul class="kwh-keys" aria-label="${esc(t("Marks under the chart"))}">${types.map(([id, word, glyph]) => `<li class="kwh-${id}">${icon(glyph)}<span>${t(word)}</span></li>`).join("")}</ul>${add}</div>`;
  }

  function status(info, events, before) {
    const st = stateOf(info), h = info.history;
    if (st.failed) return `<p class="small kwh-status">${t("Couldn't load edits, backlinks and boosts.")} <button type="button" class="link-btn" data-kwh-retry data-kwh-f="retry">${t("Try again")}</button></p>`;
    if (!h) return `<p class="small muted kwh-status">${t("Loading…")}</p>`;
    const lines = [];
    if (!info.detail.row.page) lines.push(t("No page known for this keyword yet, so no edits or backlinks to show."));
    else if (!events.some((e) => e.type !== "note")) lines.push(t("No edit, backlink or boost seen for this page yet."));
    if (before) lines.push(`${fill(before === 1 ? "1 from before the first check is in Table." : "{n} from before the first check are in Table.", { n: before })}`);
    if (h.backlinks_undated) lines.push(fill(h.backlinks_undated === 1 ? "1 backlink to this page has no date, so it isn't marked." : "{n} backlinks to this page have no date, so they aren't marked.", { n: h.backlinks_undated }));
    return lines.length ? `<p class="small muted kwh-status">${lines.map(esc).join(" ")}</p>` : "";
  }

  /* Every check and everything done to the page, in date order. Each row has the same three cells, so the app's table
     tools (tick boxes, Filter, sorting) work on it as on any table. */
  function table(info, line, events, opts) {
    const rows = [
      ...line.points.map((p) => ({ at: Date.parse(p.at), html: opts.checkRow ? opts.checkRow(p) : `<tr><td>${esc(day(p.at))}</td><td>${p.p ? `#${p.p}` : `&gt;${line.depth}`}</td><td></td></tr>` })),
      ...events.map((ev) => ({ at: ev.at, html: `<tr class="kwh-row"><td>${esc(day(ev.date))}</td><td><span class="muted">—</span></td><td><ul class="kwh-detail">${eventItem(ev, false)}</ul></td></tr>` })),
    ].sort((a, b) => a.at - b.at);
    return `<table class="mini kwh-table"><thead><tr><th>${t("Date")}</th><th>${t("Position")}</th><th>${t("Status")}</th></tr></thead><tbody>${rows.map((row) => row.html).join("")}</tbody></table>`;
  }

  function body(info, line, opts) {
    const st = stateOf(info), events = eventsOf(info);
    if (!line) return `<p class="small muted">${t("None yet")}</p>`;
    if (info.table) return `${table(info, line, events, opts)}${legend(info, events)}${st.form ? form(info) : ""}${status(info, events, 0)}`;
    const rivals = rivalsOf(info, line);
    const drawn = chart(info, line, rivals, events);
    const picked = st.picked ? events.filter((e) => st.picked.split(" ").includes(e.key)) : [];
    const detail = picked.length ? `<ul class="kwh-detail" aria-label="${esc(t("Picked mark"))}">${picked.map(eventItem).join("")}</ul>` : "";
    return `${drawn.drawn ? chips(info, rivals) : ""}${drawn.html}${legend(info, events)}<div aria-live="polite">${detail}</div>${st.form ? form(info) : ""}${status(info, events, drawn.before)}`;
  }

  function html(info, line, opts = {}) {
    current = { info, line, opts };
    return `<div class="kwh" data-kwh>${body(info, line, opts)}</div>`;
  }

  /* Redraw in place, keeping the keyboard where it was. */
  function repaint(info, focus) {
    const box = document.querySelector("#panel [data-kwh]");
    if (!box || !current || (info && current.info !== info)) return;
    const held = focus || (box.contains(document.activeElement) ? document.activeElement.closest("[data-kwh-f]")?.dataset.kwhF : null);
    UI().setHTML(box, body(current.info, current.line, current.opts));
    if (held) [...box.querySelectorAll("[data-kwh-f]")].find((el) => el.dataset.kwhF === held)?.focus();
  }

  // ---- what a person does ---------------------------------------------------------------------------
  const here = (e) => (current && e.target instanceof Element && e.target.closest("#panel [data-kwh]") ? current.info : null);

  document.addEventListener("click", (e) => {
    const info = here(e);
    if (!info) return;
    const st = stateOf(info), hit = (sel) => e.target.closest(sel);
    let el;
    if ((el = hit("[data-kwh-rival]"))) {
      const on = shownSet(info, rivalsOf(info, current.line)), host = el.dataset.kwhRival;
      if (on.has(host)) on.delete(host); else on.add(host);
      repaint(info);
    } else if (hit("[data-kwh-more]")) {
      st.more = true;
      repaint(info);
      document.querySelector("#panel .kwh-chip[aria-pressed='false']")?.focus();
    } else if ((el = hit("[data-kwh-mark]"))) {
      st.picked = st.picked === el.dataset.kwhMark ? null : el.dataset.kwhMark;
      repaint(info);
    } else if (hit("[data-kwh-add]")) {
      st.form = true; st.error = ""; st.draft = null;
      repaint(info, "f-start");
    } else if (hit("[data-kwh-cancel]")) {
      st.form = false; st.error = ""; st.draft = null;
      repaint(info, "add");
    } else if ((el = hit("[data-kwh-del]"))) {
      removeBoost(info, Number(el.dataset.kwhDel));
    } else if (hit("[data-kwh-retry]")) {
      load(info);
    }
  });

  document.addEventListener("input", (e) => {
    const info = here(e), box = info && e.target.closest("[data-kwh-form]");
    if (box) stateOf(info).draft = Object.fromEntries(new FormData(box));
  });

  document.addEventListener("submit", (e) => {
    const info = here(e), box = info && e.target.closest("[data-kwh-form]");
    if (!box) return;
    e.preventDefault();
    const st = stateOf(info), sent = Object.fromEntries(new FormData(box));
    st.draft = sent;
    const page = info.detail.row.page || String(sent.page || "").trim();
    const wrong = !page ? ["Give the page's full address, starting with https://.", "f-page"]
      : !sent.start ? ["Give the start date.", "f-start"]
        : sent.end && sent.end < sent.start ? ["The end date is before the start date.", "f-end"] : null;
    if (wrong) { st.error = wrong[0]; repaint(info, wrong[1]); return; }
    st.saving = true; st.error = "";
    repaint(info);
    saveBoost(info, { site_id: info.siteId, page, start: sent.start, end: sent.end || null, note: sent.note || "" })
      .then((boost) => { st.form = false; st.draft = null; st.picked = `boost|${boost.id}`; UI().toast(t("Boost added")); })
      .catch((error) => { st.error = error.message || "Couldn't save the boost."; })
      .finally(() => { st.saving = false; repaint(info, st.form ? "save" : "add"); });
  });

  const saveBoost = (info, sent) => window.COMP.api("POST", "boosts", sent).then((boost) => load(info).then(() => boost));

  function removeBoost(info, id) {
    const st = stateOf(info), old = info.history?.boosts.find((b) => b.id === id);
    window.COMP.api("DELETE", `boosts/${id}`)
      .then(() => {
        st.picked = null;
        const back = old && (() => saveBoost(info, { site_id: info.siteId, page: old.page, start: old.start, end: old.end, note: old.note || "" }));
        UI().toast(t("Boost deleted"), back ? { undo: back } : {});
        return load(info);
      })
      .then(() => document.querySelector("#panel [data-kwh-add]")?.focus())
      .catch((error) => UI().toast(t(error.message), { kind: "crit" }));
  }

  /* Marks too close to tell apart share one, and how close that is depends on the panel's width. */
  let lastWidth = 0, waiting = 0;
  window.addEventListener("resize", () => {
    if (!current || !document.querySelector("#panel [data-kwh]") || window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(waiting);
    waiting = setTimeout(() => repaint(), 150);
  });

  window.KeywordHistory = { load, html };

  Object.keys(fr).forEach((word) => { if (window.FR && window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
