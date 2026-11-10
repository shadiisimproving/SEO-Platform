/* Competitors area: AI Overview watch. For my keywords: does a Google AI Overview appear, am I cited, who else is, and what changed.
   It only reads what checks found. A tool that can't see AI Overviews gives "Not captured", which is never "No". */
(() => {
  "use strict";
  let UI = null;
  const S = { site: null, data: null, filter: "all", allChanges: false };
  const CHANGES_SHOWN = 40;

  const t = (s) => UI.t(s);
  const esc = (v) => UI.esc(v);
  const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, key) => values[key]);

  // ---- tiles ------------------------------------------------------------------------------------
  function tiles(s) {
    const top = s.rivals[0];
    return `<section class="tiles ca-tiles">
      ${UI.tile(t("Keywords with an AI Overview"), UI.cnt(s.with_overview), `<span class="ab">${t("of")} ${UI.num(s.captured)} ${t("captured")}</span>`, { ic: "sparkles" })}
      ${UI.tile(t("Where you're cited"), UI.cnt(s.cited_me), `<span class="ab">${t("of")} ${UI.num(s.with_overview)} ${t(s.with_overview === 1 ? "overview" : "overviews")}</span>`, { ic: "circle-check" })}
      ${UI.tile(t("Not captured"), UI.cnt(s.not_captured), `<span class="ab">${t("of")} ${UI.num(s.tracked)} ${t(s.tracked === 1 ? "keyword" : "keywords")}</span>`, { ic: "shield-question" })}
      ${UI.tile(t("Competitor cited most"), top ? `<span class="ca-host" dir="auto">${esc(top.host)}</span>` : `<span class="muted">—</span>`, top ? `<span class="ab">${UI.num(top.keywords)} ${t(top.keywords === 1 ? "keyword" : "keywords")}</span>` : `<span class="ab">${t("No competitor cited yet")}</span>`, { ic: "crosshair" })}
    </section>`;
  }

  /* The caveats sit behind an (i) beside the filters. Only the one action stays in view, and only while something isn't captured. */
  function plainNote(s) {
    const words = `${t("Updates when a check runs. It never spends credits by itself. Google only.")} ${t("Not captured means the tool used can't see AI Overviews. It doesn't mean there isn't one.")}`;
    return `<div class="ca-note-line">${COMP.info(words)}${s.not_captured ? `<button class="btn btn-small" data-ca-connect>${t("Connect a tool that sees AI Overviews")}</button>` : ""}</div>`;
  }

  // ---- the table --------------------------------------------------------------------------------
  const FILTERS = [
    ["all", "All", () => true],
    ["overview", "Has an AI Overview", (r) => r.state === "present"],
    ["cited", "You're cited", (r) => r.cited_me === true],
    ["notcited", "You're not cited", (r) => r.state === "present" && r.cited_me === false],
    ["notcaptured", "Not captured", (r) => r.state === "not_captured"],
  ];
  const statusWord = (iconName, word, cls = "sec") => `<span class="status ${cls}">${UI.icon(iconName)}${esc(t(word))}</span>`;
  const overviewCell = (state) => (state === "present" ? statusWord("sparkles", "Yes") : state === "not_captured" ? statusWord("shield-question", "Not captured", "muted") : statusWord("minus", "No", "muted"));

  function citedCell(row) {
    if (row.state === "not_captured" || row.cited_me === null || row.cited_me === undefined) return `<span class="muted">—</span>`;
    if (!row.cited_me) return statusWord("minus", "No", "muted");
    return `${UI.status("good", t("Yes"))}${row.my_cited_urls.map((url) => `<span class="second">${COMP.link(url)}</span>`).join("")}`;
  }
  const rivalChips = (list) => (list.length ? `<span class="ca-chips">${list.map((c) => `<button class="chip" data-ca-rival="${c.id}" dir="auto" aria-label="${t("Open competitor")}: ${esc(c.host)}">${window.UI.siteLogo(c.host, 16)}${esc(c.host)}</button>`).join("")}</span>` : `<span class="muted">—</span>`);
  const otherSites = (list) => (list.length ? `<span class="ca-others">${list.map((d) => `<span class="mono small" dir="auto">${esc(d)}</span>`).join("")}</span>` : `<span class="muted">—</span>`);

  function keywordTable(rows) {
    const [, , test] = FILTERS.find(([id]) => id === S.filter) || FILTERS[0];
    const shown = rows.filter(test);
    const chips = `<div class="chips" role="group" aria-label="${t("Filter keywords")}">${FILTERS.map(([id, label, match]) => `<button class="chip" data-ca-filter="${id}" aria-pressed="${S.filter === id}">${t(label)}<b>${UI.num(rows.filter(match).length)}</b></button>`).join("")}</div>`;
    if (!shown.length) return `${chips}${COMP.empty(t("No keywords here"), t("No keyword matches this filter right now."))}`;
    // On phones each row is a card, so a tool shared by every row is said once, above them.
    const tools = new Set(shown.map((r) => r.tool));
    // Every row checked with the same tool at the same age: said once under the table, and the column goes (as on a competitor's Keywords tab).
    const once = shown.length > 1 && tools.size === 1 && new Set(shown.map((r) => COMP.ago(r.checked_at))).size === 1;
    const onceLine = once ? `<p class="small sec ca-once">${esc(t("All checked with {tool}, {when}.").replace("{tool}", shown[0].tool).replace("{when}", COMP.ago(shown[0].checked_at)))}</p>` : "";
    const oneTool = !once && tools.size === 1 ? shown[0].tool : "";
    return `${chips}${oneTool ? `<p class="help ca-tool-line">${t("Tool")}: ${esc(oneTool)}</p>` : ""}<div class="table-wrap ${oneTool ? "ca-one-tool" : ""}"><table class="data ca-table" id="ca-table">
      <thead><tr><th scope="col">${t("Keyword")}</th><th scope="col">${t("AI Overview")}</th><th scope="col">${t("You cited")}</th><th scope="col">${t("Competitors cited")}</th><th scope="col">${t("Other sites cited")}</th>${once ? "" : `<th scope="col">${t("Tool and age")}</th>`}</tr></thead>
      <tbody>${shown.map((r) => `<tr>
        <td class="head-cell"><span class="kw" dir="auto">${esc(r.keyword)}</span></td>
        <td data-label="${t("AI Overview")}">${overviewCell(r.state)}</td>
        <td data-label="${t("You cited")}"><div class="cp-val">${citedCell(r)}</div></td>
        <td data-label="${t("Competitors cited")}"><div class="cp-val">${rivalChips(r.competitors_cited)}</div></td>
        <td data-label="${t("Other sites cited")}"><div class="cp-val">${otherSites(r.others_cited)}</div></td>
        ${once ? "" : `<td data-label="${t("Tool and age")}"><div class="cp-val"><span class="ca-tool-name">${esc(r.tool)}</span><span class="second">${esc(COMP.ago(r.checked_at))}</span></div></td>`}
      </tr>`).join("")}</tbody></table></div>${onceLine}`;
  }

  // ---- what changed -----------------------------------------------------------------------------
  const CHANGE_WORDS = {
    overview_appeared: ["sparkles", "An AI Overview appeared for {keyword}"],
    overview_gone: ["minus", "The AI Overview went away for {keyword}"],
    me_cited: ["circle-check", "You're now cited for {keyword}"],
    me_dropped: ["link-2-off", "You're no longer cited for {keyword}"],
    rival_cited: ["crosshair", "{competitor} is now cited for {keyword}"],
    rival_dropped: ["minus", "{competitor} is no longer cited for {keyword}"],
  };
  function aiFind(c, words) {
    const host = COMP.site()?.host;
    const text = UI.t(words).replace("{keyword}", c.keyword || "").replace("{competitor}", c.competitor || "");
    return { title: text, host, source: { type: "competitor", label: text, host, facts: [c.keyword, c.competitor].filter(Boolean), link: "#competitors/ai", key: `ai|${COMP.siteId}|${c.kind}|${c.keyword}|${c.competitor || ""}` } };
  }

  function changeLine(c) {
    const [iconName, words] = CHANGE_WORDS[c.kind] || ["info", "Something changed for {keyword}"];
    const competitor = c.competitor_id ? `<button class="link-btn ca-rival-link" data-ca-rival="${c.competitor_id}" dir="auto">${esc(c.competitor)}</button>` : `<span dir="auto">${esc(c.competitor || "")}</span>`;
    return `<li><span class="ca-change-ico" aria-hidden="true">${UI.icon(iconName)}</span><div class="what"><div class="t">${fill(esc(t(words)), { keyword: `<b dir="auto">${esc(c.keyword)}</b>`, competitor })}</div></div><span class="small muted">${esc(c.tool)}</span><div class="acts">${UI.taskButton(aiFind(c, words), { label: "Task" })}</div></li>`;
  }
  function changesBlock(changes) {
    if (!changes.length) {
      return `<p class="small muted ca-pad">${t("Nothing yet. Changes appear once the same tool has checked a keyword twice.")}</p>`;
    }
    const shown = S.allChanges ? changes : changes.slice(0, CHANGES_SHOWN);
    const days = new Map();
    shown.forEach((c) => { const day = c.at.slice(0, 10); if (!days.has(day)) days.set(day, []); days.get(day).push(c); });
    return `${[...days].map(([day, list]) => `<h3 class="ca-day">${esc(UI.fmtDateOnly(`${day}T00:00:00Z`))}</h3><ul class="rows ca-changes">${list.map(changeLine).join("")}</ul>`).join("")}
      ${changes.length > shown.length ? `<p class="ca-pad"><button class="btn btn-small" data-ca-all-changes>${t("Show all")} (${UI.num(changes.length)})</button></p>` : ""}`;
  }

  // ---- over time --------------------------------------------------------------------------------
  const share = (part, whole) => (whole ? part / whole : 0);
  const percent = (part, whole) => `${Math.round(share(part, whole) * 100)}%`;
  const dayTime = (day) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  const dayLabel = (day, withYear) => new Intl.DateTimeFormat(UI.locale(), { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(dayTime(day)));

  function chartWords(p) {
    return `${dayLabel(p.day, true)}: ${fill(t("{a} of {b} keywords had an AI Overview"), { a: UI.num(p.overviews), b: UI.num(p.checked) })} (${percent(p.overviews, p.checked)}). ${fill(t("{a} cited you"), { a: UI.num(p.cited_me) })} (${percent(p.cited_me, p.checked)}).`;
  }

  /* Drawn at the width it really has, so its text stays readable on a phone. Checks are irregular, so the
     horizontal axis is real time and the lines stay straight: nothing is implied between two checks. */
  function chartSvg(points, width) {
    const h = 196, left = 38, right = 40, top = 12, bottom = 26;
    const first = dayTime(points[0].day), last = dayTime(points[points.length - 1].day), span = last - first || 1;
    const x = (p) => left + ((dayTime(p.day) - first) / span) * (width - left - right);
    const y = (value) => top + (1 - value) * (h - top - bottom);
    const line = (key) => points.map((p, i) => `${i ? "L" : "M"}${x(p).toFixed(1)},${y(share(p[key], p.checked)).toFixed(1)}`).join("");
    const ticks = [0, 0.5, 1].map((v) => `<line class="ca-grid" x1="${left}" x2="${width - right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${left - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${Math.round(v * 100)}%</text>`).join("");
    // Dates that fit: always the last, then going back, each far enough from the one after it.
    const labels = [];
    let room = Infinity;
    [...points].reverse().forEach((p, i) => {
      const at = x(p);
      if (i === 0 || (room - at >= 70 && at - x(points[0]) >= (p === points[0] ? 0 : 58))) { labels.push(p); room = at; }
    });
    const dates = labels.map((p) => `<text x="${x(p).toFixed(1)}" y="${h - 6}" text-anchor="${p === points[0] ? "start" : p === points[points.length - 1] ? "end" : "middle"}">${esc(dayLabel(p.day, false))}</text>`).join("");
    const dots = (key, cls) => points.map((p) => `<circle class="ca-dot ${cls}" cx="${x(p).toFixed(1)}" cy="${y(share(p[key], p.checked)).toFixed(1)}" r="4"/>`).join("");
    // Each date gets a tall hover band, so nobody has to aim at a 2 px line.
    const bands = points.map((p, i) => {
      const from = i ? (x(points[i - 1]) + x(p)) / 2 : left - 6, to = i < points.length - 1 ? (x(p) + x(points[i + 1])) / 2 : width - right + 6;
      return `<rect class="ca-band" x="${from.toFixed(1)}" y="${top}" width="${Math.max(1, to - from).toFixed(1)}" height="${h - top - bottom}" data-tip="${esc(chartWords(p))}"/>`;
    }).join("");
    const end = points[points.length - 1], endOver = y(share(end.overviews, end.checked)), endMine = y(share(end.cited_me, end.checked));
    const endLabels = `<text class="ca-end" x="${(x(end) + 8).toFixed(1)}" y="${(endOver + 4).toFixed(1)}">${percent(end.overviews, end.checked)}</text>${Math.abs(endOver - endMine) >= 14 ? `<text class="ca-end" x="${(x(end) + 8).toFixed(1)}" y="${(endMine + 4).toFixed(1)}">${percent(end.cited_me, end.checked)}</text>` : ""}`;
    const summary = `${t("Share of the keywords checked each day.")} ${points.map(chartWords).join(" ")}`;
    return `<svg class="chart ca-svg" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="${esc(summary)}">
      ${ticks}${dates}
      <path class="ca-line ca-one" d="${line("overviews")}"/><path class="ca-line ca-two" d="${line("cited_me")}"/>
      ${dots("overviews", "ca-one")}${dots("cited_me", "ca-two")}${endLabels}${bands}
    </svg>`;
  }

  function drawChart() {
    const box = UI.$("#ca-chart");
    if (!box || !S.data) return;
    UI.setHTML(box, chartSvg(S.data.trend, Math.max(260, Math.floor(box.clientWidth))));
  }

  function trendBlock(trend) {
    if (trend.length < 2) {
      return `<p class="small muted ca-pad">${t("Needs checks on at least 2 different days to show a trend.")}</p>`;
    }
    return `<div class="ca-chart-wrap">
        <div class="legend"><span><i style="border-color:var(--series-1)"></i>${t("Keywords with an AI Overview")}</span><span><i class="dash" style="border-color:var(--series-1)"></i>${t("Keywords where you're cited")}</span></div>
        <div id="ca-chart" class="ca-chart"></div>
        <details class="fold ca-numbers"><summary>${UI.icon("chevron-right")}${t("See the numbers")}</summary>
          <table class="mini"><thead><tr><th scope="col">${t("Day")}</th><th scope="col" class="r">${t("Checked")}</th><th scope="col" class="r">${t("With an AI Overview")}</th><th scope="col" class="r">${t("Citing you")}</th></tr></thead>
          <tbody>${trend.map((p) => `<tr><td>${esc(dayLabel(p.day, true))}</td><td class="r tabular">${UI.num(p.checked)}</td><td class="r tabular">${UI.num(p.overviews)} (${percent(p.overviews, p.checked)})</td><td class="r tabular">${UI.num(p.cited_me)} (${percent(p.cited_me, p.checked)})</td></tr>`).join("")}</tbody></table>
        </details>
      </div>`;
  }

  // ---- the tab ----------------------------------------------------------------------------------
  function body() {
    const d = S.data;
    if (!d) return COMP.loading();
    if (!d.summary.tracked) {
      return COMP.empty(t("No keyword checked yet"), t("This fills in once your keywords have been checked. Start by adding your keyword list."), `<button class="btn btn-main" data-ca-find>${UI.icon("search")}${t("Find competitors")}</button>`);
    }
    return `${tiles(d.summary)}
      ${plainNote(d.summary)}
      ${keywordTable(d.keywords)}
      <div class="ca-lower">
        <section class="card"><div class="card-head"><h2>${t("Over time")}</h2><div class="hint-text">${t("Share of the keywords checked each day, because the number checked can change.")}</div></div>${trendBlock(d.trend)}</section>
        <section class="card"><div class="card-head"><h2>${t("What changed")}</h2><div class="hint-text">${t("Changes only compare checks by the same tool.")}</div></div>${changesBlock(d.changes)}</section>
      </div>`;
  }

  let resizeFrame = 0;
  const tab = {
    id: "ai", order: 50, label: "AI Overview watch", icon: "sparkles",
    init(helpers) {
      UI = helpers;
      document.addEventListener("click", (e) => {
        const hit = (sel) => e.target.closest?.(sel);
        let el;
        if ((el = hit("[data-ca-filter]"))) {
          S.filter = el.dataset.caFilter;
          COMP.paint();
          UI.$(`[data-ca-filter="${S.filter}"]`)?.focus();
          return;
        }
        if ((el = hit("[data-ca-rival]"))) { COMP.open("list", { competitorId: Number(el.dataset.caRival) }); return; }
        if (hit("[data-ca-connect]")) { UI.openConnection("serpapi"); return; }
        if (hit("[data-ca-find]")) { COMP.open("find"); return; }
        if (hit("[data-ca-all-changes]")) { S.allChanges = true; COMP.paint(); }
      });
      window.addEventListener("resize", () => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(drawChart);
      });
    },
    async load() {
      const siteId = COMP.siteId;
      if (S.site !== siteId) { S.site = siteId; S.filter = "all"; S.allChanges = false; }
      const answer = await COMP.api("GET", `ai-watch?site_id=${siteId}`);
      if (siteId !== COMP.siteId) return; // another site was picked while this was on its way
      S.data = answer;
    },
    body,
    after: () => drawChart(),
  };
  COMP.addTab(tab);

  Object.assign(window.FR, {
    "AI Overview watch": "Suivi des AI Overviews",
    "Keywords with an AI Overview": "Mots-clés avec un AI Overview",
    "of": "sur",
    "captured": "captés",
    "Where you're cited": "Où vous êtes cité",
    "overview": "AI Overview",
    "overviews": "AI Overviews",
    "keyword": "mot-clé",
    "keywords": "mots-clés",
    "Competitor cited most": "Concurrent le plus cité",
    "No competitor cited yet": "Aucun concurrent cité pour l'instant",
    "Updates when a check runs. It never spends credits by itself. Google only.": "Se met à jour quand un relevé a lieu. Ne dépense jamais de crédits tout seul. Google uniquement.",
    "Not captured means the tool used can't see AI Overviews. It doesn't mean there isn't one.": "Non capté veut dire que l'outil utilisé ne voit pas les AI Overviews. Cela ne veut pas dire qu'il n'y en a pas.",
    "Connect a tool that can": "Connecter un outil qui les voit", "Connect a tool that sees AI Overviews": "Connecter un outil qui voit les AI Overviews",
    "Has an AI Overview": "Avec un AI Overview",
    "You're cited": "Vous êtes cité",
    "You're not cited": "Vous n'êtes pas cité",
    "Yes": "Oui",
    "No": "Non",
    "Open competitor": "Ouvrir le concurrent",
    "Filter keywords": "Filtrer les mots-clés",
    "No keywords here": "Aucun mot-clé ici",
    "No keyword matches this filter right now.": "Aucun mot-clé ne correspond à ce filtre pour l'instant.",
    "You cited": "Vous cité",
    "Competitors cited": "Concurrents cités",
    "Other sites cited": "Autres sites cités",
    "An AI Overview appeared for {keyword}": "Un AI Overview est apparu pour {keyword}",
    "The AI Overview went away for {keyword}": "L'AI Overview a disparu pour {keyword}",
    "You're now cited for {keyword}": "Vous êtes désormais cité pour {keyword}",
    "You're no longer cited for {keyword}": "Vous n'êtes plus cité pour {keyword}",
    "{competitor} is now cited for {keyword}": "{competitor} est désormais cité pour {keyword}",
    "{competitor} is no longer cited for {keyword}": "{competitor} n'est plus cité pour {keyword}",
    "Something changed for {keyword}": "Quelque chose a changé pour {keyword}",
    "Nothing yet. Changes appear once the same tool has checked a keyword twice.": "Rien pour l'instant. Les changements apparaissent dès qu'un même outil a relevé un mot-clé deux fois.",
    "Show all": "Tout afficher",
    "{a} of {b} keywords had an AI Overview": "{a} mots-clés sur {b} avaient un AI Overview",
    "{a} cited you": "{a} vous citaient",
    "Share of the keywords checked each day.": "Part des mots-clés relevés chaque jour.",
    "Needs checks on at least 2 different days to show a trend.": "Il faut des relevés sur au moins 2 jours différents pour montrer une tendance.",
    "Keywords where you're cited": "Mots-clés où vous êtes cité",
    "See the numbers": "Voir les chiffres",
    "Day": "Jour",
    "Checked": "Relevés",
    "With an AI Overview": "Avec un AI Overview",
    "Citing you": "Vous citant",
    "No keyword checked yet": "Aucun mot-clé relevé pour l'instant",
    "This fills in once your keywords have been checked. Start by adding your keyword list.": "Cette page se remplit quand vos mots-clés ont été relevés. Commencez par ajouter votre liste de mots-clés.",
    "Over time": "Dans le temps",
    "Share of the keywords checked each day, because the number checked can change.": "Part des mots-clés relevés chaque jour, car le nombre de mots-clés relevés peut changer.",
    "What changed": "Ce qui a changé",
    "Changes only compare checks by the same tool.": "Les changements ne comparent que les relevés d'un même outil.",
  });
})();
