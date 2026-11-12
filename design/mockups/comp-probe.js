/* Competitors area: Keyword check. Type keywords, press Check, confirm the searches, and see which of your competitors rank
   for each and where. These keywords stay out of your own keyword list and Refresh: nothing here searches by itself.
   Each check first shows how many searches it takes and how many free checks each tool has left. */
(() => {
  "use strict";
  let UI = null;
  const COMP = window.COMP;
  const S = { site: null, data: null, error: null, confirm: null, adding: false, following: false, sort: null };
  const PAGES = "kc"; // the table has pages and a search (table-pages.js), like every long table in the app
  const FIND_FROM = 11; // more than 10 rows, as on every table: the search box shows from this many keywords, or while a search is on

  const t = (s) => UI.t(s);
  const esc = (v) => UI.esc(v);
  const fill = (key, values = {}) => t(key).replace(/\{(\w+)\}/g, (all, name) => (name in values ? values[name] : all));
  const many = (n, one, other, values = {}) => fill((UI.state.lang === "fr" ? n < 2 : n === 1) ? one : other, { n: UI.num(n), ...values });
  const busy = (run) => run && (run.status === "queued" || run.status === "running");
  /* The server's refusal when every keyword was just checked (probe.recent_words) carries the hours Refresh uses: said
     through the same keys as the confirm box, so its French doesn't depend on the number. */
  const said = (message) => {
    const m = String(message ?? "").match(/^(All c|C)hecked in the last (\d+) hours: no search spent\.$/);
    if (!m) return t(message);
    return fill(m[1] === "C" ? "Checked in the last {hours} hours: no search spent." : "All checked in the last {hours} hours: no search spent.", { hours: UI.num(Number(m[2])) });
  };
  const engineName = (name) => ({ google: "Google", bing: "Bing", duckduckgo: "DuckDuckGo", yandex: "Yandex" }[name] || name || "");
  const pageLink = (url, text) => (window.PageLink ? window.PageLink.html(url, { text, cls: "small" }) : COMP.link(url, text, "small"));

  function form(d) {
    return `<section class="card kc-add" aria-label="${esc(t("Add keywords"))}">
      <div class="card-head"><h2>${t("Add keywords")}</h2><span class="hint-text">${esc(t(d.keywords.length ? "One per line. Kept apart from your keyword list." : "No keywords yet: type some to see which competitors rank where."))}</span></div>
      <textarea class="input kc-words" rows="4" placeholder="${esc(t("running shoes\ntrail running shoes"))}" data-kc-words aria-label="${esc(t("Keywords, one per line"))}"></textarea>
      <div class="kc-add-row">
        <label class="kc-field">${t("Country")} <input class="input kc-code" maxlength="2" value="${esc(d.country || "")}" data-kc-country placeholder="AE"></label>
        <label class="kc-field">${t("Language")} <input class="input kc-code" maxlength="10" value="${esc(d.language || "")}" data-kc-language placeholder="fr"></label>
        <button type="button" class="btn btn-main" data-kc-add ${S.adding ? "disabled" : ""}>${UI.icon("plus")}${t("Add")}</button>
      </div>
      <p class="error" role="alert" data-kc-add-error hidden></p>
    </section>`;
  }

  function runLine(run, total) {
    if (!run) return "";
    if (busy(run)) return `<p class="note kc-run">${UI.icon("refresh-cw", "spin")}<span>${esc(fill("Checking: {done} of {total} keywords on {engine}.", { done: UI.num(run.checked + run.failed), total: UI.num(run.total), engine: engineName(run.engine) }))}</span></p>`;
    if (run.status === "waiting") return `<p class="note warn kc-run">${UI.icon("triangle-alert")}<span>${esc(fill("Checked {done} of {total}.", { done: UI.num(run.checked), total: UI.num(run.total) }))} ${esc(t(run.reason || ""))}</span></p>`;
    if (run.reason) return `<p class="note kc-run">${UI.icon("info")}<span>${esc(t(run.reason))}</span></p>`;
    return total ? `<p class="small sec kc-last">${esc(fill("Checked {when}, with {tool}.", { when: COMP.ago(run.finished_at), tool: run.tool || "—" }))}</p>` : "";
  }

  function confirmBox() {
    const c = S.confirm;
    if (!c) return "";
    if (c.loading) return `<div class="kc-confirm"><p class="small sec">${UI.icon("refresh-cw", "spin")}${t("Counting the searches…")}</p></div>`;
    const e = c.estimate;
    const tools = e.tools.map((x) => `${esc(x.tool)} ${x.free_left === null || x.free_left === undefined ? esc(t("no limit")) : esc(fill("{n} left", { n: UI.num(x.free_left) }))}`).join(" · ");
    const short = e.can_now < e.searches;
    // Checked within the hours Refresh uses (12 by default): left out, so a second press seconds later spends nothing.
    const recent = e.recent ? `<p class="small sec kc-recent">${esc(many(e.recent, "{n} keyword skipped: checked in the last {hours} hours.", "{n} keywords skipped: checked in the last {hours} hours.", { hours: UI.num(e.hours) }))}</p>` : "";
    if (!e.searches && e.recent) {
      return `<div class="kc-confirm" role="group" aria-label="${esc(t("Confirm the check"))}">
        <p><b>${esc(t("Nothing to check now."))}</b> ${esc(many(e.recent, "Checked in the last {hours} hours: no search spent.", "All checked in the last {hours} hours: no search spent.", { hours: UI.num(e.hours) }))}</p>
        <div class="kc-go"><button type="button" class="btn btn-small btn-ghost" data-kc-cancel>${t("Close")}</button></div>
      </div>`;
    }
    return `<div class="kc-confirm" role="group" aria-label="${esc(t("Confirm the check"))}">
      <p><b>${esc(many(e.searches, "Check {n} keyword on {engine}?", "Check {n} keywords on {engine}?", { engine: engineName(e.engine) }))}</b> ${esc(many(e.searches, "{n} search, free checks only.", "{n} searches, free checks only."))}</p>
      <p class="small sec">${tools ? `${esc(t("Free checks:"))} ${tools}` : esc(t("No search tool connected."))}</p>
      ${recent}
      ${short ? `<p class="small warn">${esc(fill("Only {n} can be checked now; the rest wait for free checks.", { n: UI.num(e.can_now) }))}</p>` : ""}
      <div class="kc-go"><button type="button" class="btn btn-small btn-main" data-kc-go ${e.can_now ? "" : "disabled"}>${UI.icon("search")}${t("Check them")}</button><button type="button" class="btn btn-small btn-ghost" data-kc-cancel>${t("Cancel")}</button></div>
      <p class="error" role="alert" data-kc-go-error hidden></p>
    </div>`;
  }

  function cell(k) {
    if (!k.checked) return `<span class="muted small">${t("Not checked")}</span>`;
    if (!k.competitors.length) return `<span class="muted small">${esc(fill("None in the top {n}.", { n: UI.num(S.data.depth || 10) }))}</span>`;
    return `<ul class="kc-ranks">${k.competitors.map((c) => `<li><button type="button" class="kc-rival" data-kc-rival="${Number(c.id)}" title="${esc(c.url)}">${UI.siteLogo(c.host, 16)}<span class="kc-host" dir="auto">${esc(c.display || c.host)}</span><span class="kc-pos tabular">#${UI.num(c.position)}</span></button></li>`).join("")}</ul>`;
  }

  /* Keyword: A to Z. You: the best position first. Competitors: the most that rank first. Not checked, or not found, always goes last. */
  const SORTS = { keyword: (k) => k.keyword, me: (k) => k.me?.position ?? null, rivals: (k) => (k.checked ? k.competitors.length : null) };
  const FIRST = { keyword: "asc", me: "asc", rivals: "desc" };
  function sorted(list) {
    if (!S.sort || !SORTS[S.sort.key]) return list; // the order they were added in
    const value = SORTS[S.sort.key], dir = S.sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = value(a), y = value(b);
      if (x === null || y === null) return (x === null) - (y === null);
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), UI.state.lang)) * dir;
    });
  }

  function table(d) {
    if (!d.keywords.length) return ""; // the line above says there are none yet, and the form is right under it: no empty box between them
    const running = busy(d.run), q = TP.state(PAGES).q;
    const search = d.keywords.length >= FIND_FROM || q ? `<div class="cp-tools kc-tools">${TP.search(PAGES, t("Search keywords"))}</div>` : "";
    const found = sorted(d.keywords.filter((k) => TP.matches(PAGES, k.keyword)));
    if (!found.length) return `${search}<div class="table-wrap"><div class="empty"><p>${esc(t("No keyword matches."))}</p><button type="button" class="btn btn-small" data-tp-clear data-tp-key="${PAGES}">${t("Clear search")}</button></div></div>`;
    const page = TP.view(PAGES, found);
    /* What every row on the page shares is said once under the table (2026-11-11): the country and language, and the tool
       when every checked row used the same one. Rows keep what differs: keyword, positions, competitors, age. */
    const placeOf = (k) => [k.country, k.language].filter(Boolean).join(" · ");
    // As drawn: the country as its flag (its name on hover), then the language (2026-11-12).
    const placeHtml = (k) => [k.country ? UI.flag(k.country) : "", k.language ? esc(k.language) : ""].filter(Boolean).join(" · ") || esc(t("Any country"));
    const checkedRows = page.rows.filter((k) => k.checked);
    const samePlace = page.rows.length > 1 && new Set(page.rows.map(placeOf)).size === 1;
    const sameTool = samePlace && checkedRows.length > 0 && new Set(checkedRows.map((k) => k.tool || "")).size === 1 && Boolean(checkedRows[0].tool);
    const allRows = samePlace ? `<p class="small sec kc-all-rows">${esc(t("All rows:"))} ${placeHtml(page.rows[0])}${sameTool ? ` · ${UI.logoOnly(checkedRows[0].tool)}` : ""}</p>` : "";
    const head = (key, label, cls = "", who = "") => {
      const on = S.sort?.key === key;
      return `<th scope="col" class="${cls}" aria-sort="${on ? (S.sort.dir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" class="th-btn" data-kc-sort="${key}">${who ? COMP.who(who, null, t(label)) : t(label)}${on ? UI.icon(S.sort.dir === "asc" ? "arrow-up" : "arrow-down") : ""}</button></th>`;
    };
    return `${search}<div class="kc-pages"><div class="table-wrap"><table class="data kc-table" id="kc-table">
      <thead><tr>${head("keyword", "Keyword")}${head("me", "You", "c pt-col-you", "you")}${head("rivals", "Competitors ranking", "pt-col-them", "them")}<th scope="col">${t("Checked")}</th><th scope="col"><span class="sr-only">${t("Actions")}</span></th></tr></thead>
      <tbody>${page.rows.map((k) => `<tr>
        <td class="head-cell" data-label="${esc(t("Keyword"))}"><span class="kw">${KeywordLink.html(k.keyword, { id: k.tracked ? k.id : null, host: COMP.site()?.host })}</span>${samePlace ? "" : `<span class="second">${placeHtml(k)}</span>`}</td>
        <td class="c" data-label="${esc(t("You"))}">${k.me ? `<span class="kc-pos tabular">#${UI.num(k.me.position)}</span>` : `<span class="muted">${k.checked ? "—" : ""}</span>`}</td>
        <td data-label="${esc(t("Competitors ranking"))}">${cell(k)}</td>
        <td class="nowrap" data-label="${esc(t("Checked"))}">${k.checked ? `<span class="kc-checked small">${COMP.ageCell(k.checked_at)}${sameTool || !k.tool ? "" : ` ${UI.logoOnly(k.tool)}`}</span>` : ""}</td>
        <td class="acts nowrap">${k.tracked
          ? `<span class="kc-tracked small" title="${esc(t("Tracked: Refresh checks it too."))}">${UI.icon("circle-check")}${t("Tracked")}</span>`
          : `<button type="button" class="btn btn-small btn-ghost" data-kc-track="${Number(k.id)}" title="${esc(t("Adds it to your tracked keywords. No search; it stays here too."))}">${UI.icon("list-plus")}${t("Track")}</button>`}<button type="button" class="btn btn-small" data-kc-one="${Number(k.id)}" ${running ? "disabled" : ""}>${UI.icon("search")}${t("Refresh")}</button><button type="button" class="icon-btn" data-kc-remove="${Number(k.id)}" aria-label="${esc(fill("Remove {k}", { k: k.keyword }))}">${UI.icon("x")}</button></td>
      </tr>`).join("")}</tbody></table></div>${TP.footer(PAGES, page, { noun: t("keywords") })}</div>${allRows}`;
  }

  function body() {
    if (S.error) return COMP.empty(t("This part didn't load"), t(S.error));
    const d = S.data;
    if (!d) return COMP.loading ? COMP.loading() : "";
    const n = d.keywords.length, running = busy(d.run);
    // With no keywords, the form's own line says what the tab does: no box above it, and the idea said once.
    // With some, the band holds Check all and says nothing is searched until it's confirmed.
    return `${n ? `<section class="tool-band kc-band" aria-label="${esc(t("Keyword check"))}">
        <p>${esc(t("See where your competitors rank for these. Nothing is searched until you confirm."))}</p>
        <button type="button" class="btn btn-main" data-kc-all ${running ? "disabled" : ""}>${UI.icon("search")}${esc(many(n, "Check {n} keyword", "Check all {n} keywords"))}</button>
      </section>` : ""}
      ${confirmBox()}
      ${runLine(d.run, n)}
      ${d.competitors_hidden ? `<p class="small sec kc-hidden">${esc(many(d.competitors_hidden, "{n} competitor hidden: Pages only or Off.", "{n} competitors hidden: Pages only or Off."))}</p>` : ""}
      ${table(d)}
      ${form(d)}`;
  }

  async function load({ quiet = false } = {}) {
    const siteId = COMP.siteId;
    if (S.site !== siteId) { S.site = siteId; S.confirm = null; S.sort = null; TP.state(PAGES).q = ""; TP.reset(PAGES); }
    try {
      const answer = await COMP.api("GET", `keyword-check?site_id=${siteId}`);
      if (siteId !== COMP.siteId) return;
      S.data = answer && Array.isArray(answer.keywords) ? answer : null;
      S.error = S.data ? null : "Keyword check needs the app running.";
      S.status = null;
    } catch (err) {
      if (quiet && S.data) { S.status = err.status; S.error = null; throw err; } // a follow that misses once keeps the table
      S.error = err.message;
      S.status = err.status;
    }
    if (!quiet && busy(S.data?.run)) follow();
  }

  /* While a check runs, the page follows it, and stops once it ends or the tab changes (COMP.poll: paused while the
     browser tab is hidden, slower over time, never for ever). A half-typed keyword box is never redrawn away. */
  function follow() {
    if (S.following) return;
    S.following = true;
    COMP.poll(async () => {
      if (COMP.tab !== "check" || !document.querySelector(".kc-table, .kc-band, .kc-add")) return false;
      await load({ quiet: true }); // a miss keeps the table on screen; COMP.poll waits longer, and stops on 401/404
      if (COMP.tab === "check") paintKeeping();
      return busy(S.data?.run);
    }, { every: 2000, grow: 1.1, slowest: 10000, most: 30 * 60000, onEnd: () => { S.following = false; } });
  }

  /* Redraw the tab, keeping what's half-typed in the form and where the caret was. */
  function paintKeeping() {
    const fields = ["[data-kc-words]", "[data-kc-country]", "[data-kc-language]", `[data-tp-search][data-tp-key="${PAGES}"]`].map((sel) => [sel, UI.$(sel)?.value]); // the search too: a check's progress can redraw while someone types
    const active = document.activeElement, focusSel = fields.find(([sel]) => active?.matches?.(sel))?.[0];
    const caret = focusSel ? [active.selectionStart, active.selectionEnd] : null;
    COMP.paint();
    fields.forEach(([sel, value]) => { const el = UI.$(sel); if (el && value !== undefined && (!sel.includes("data-tp-search") || sel === focusSel)) el.value = value; }); // the search box only while it's being typed in: Clear the search must clear it
    if (focusSel) { const el = UI.$(focusSel); el?.focus({ preventScroll: true }); try { el?.setSelectionRange(...caret); } catch { /* not a text field */ } }
  }

  async function askToCheck(only) {
    S.confirm = { loading: true, only };
    COMP.paint();
    try {
      const estimate = await COMP.api("POST", "keyword-check/estimate", { site_id: COMP.siteId, ...(only ? { only } : {}) });
      S.confirm = { estimate, only };
    } catch (err) {
      S.confirm = null;
      UI.toast(t(err.message), { kind: "crit" });
    }
    COMP.paint();
    UI.$("[data-kc-go]")?.focus();
  }

  async function go(button) {
    const only = S.confirm?.only;
    button.disabled = true;
    try {
      await COMP.api("POST", "keyword-check/run", { site_id: COMP.siteId, ...(only ? { only } : {}) });
    } catch (err) {
      button.disabled = false;
      const box = UI.$("[data-kc-go-error]");
      if (box) { box.textContent = said(err.message); box.hidden = false; }
      return;
    }
    S.confirm = null;
    await load();
    COMP.paint();
    follow();
  }

  async function add(button) {
    const words = UI.$("[data-kc-words]")?.value || "";
    const problem = UI.$("[data-kc-add-error]");
    if (!words.trim()) { // said here, in words, before asking the server
      if (problem) { problem.textContent = t("Type at least one keyword, one on each line."); problem.hidden = false; }
      UI.$("[data-kc-words]")?.focus();
      return;
    }
    S.adding = true; button.disabled = true;
    try {
      const answer = await COMP.api("POST", "keyword-check/keywords", { site_id: COMP.siteId, keywords: words, country: UI.$("[data-kc-country]")?.value || "", language: UI.$("[data-kc-language]")?.value || "" });
      S.adding = false;
      await load();
      COMP.paint();
      UI.toast(answer.already ? fill("{added} added, {already} already there.", { added: UI.num(answer.added), already: UI.num(answer.already) }) : many(answer.added, "{n} keyword added.", "{n} keywords added."));
    } catch (err) {
      S.adding = false; button.disabled = false;
      if (problem) { problem.textContent = t(err.message); problem.hidden = false; }
    }
  }

  async function track(button) {
    const id = Number(button.dataset.kcTrack);
    button.disabled = true;
    try {
      await COMP.api("POST", `keyword-check/keywords/${id}/track`, { site_id: COMP.siteId });
    } catch (err) {
      button.disabled = false;
      UI.toast(t(err.message), { kind: "crit" });
      return;
    }
    const k = S.data.keywords.find((x) => x.id === id);
    if (k) k.tracked = true;
    document.dispatchEvent(new CustomEvent("keywords:changed")); // Keywords shows it without a reload (keywords-real.js listens)
    COMP.paint();
    UI.toast(fill("“{k}” is now tracked. Refresh checks it from now on.", { k: k?.keyword || "" }));
  }

  /* Remove at once, say so, and offer Undo, which puts it back in its place. Its checks are kept either way. */
  async function remove(id) {
    const site = COMP.siteId, k = S.data.keywords.find((x) => x.id === id);
    let answer;
    try {
      answer = await COMP.api("DELETE", `keyword-check/keywords/${id}?site_id=${site}`);
    } catch (err) {
      UI.toast(t(err.message), { kind: "crit" });
      return;
    }
    S.data.keywords = S.data.keywords.filter((x) => x.id !== id);
    COMP.paint();
    UI.$("[data-kc-words]")?.focus({ preventScroll: true }); // the button pressed is gone: the keyboard lands on the form
    UI.toast(fill("“{k}” removed.", { k: k?.keyword || "" }), { kind: "info", undo: async () => {
      try {
        await COMP.api("POST", `keyword-check/keywords/${id}/restore`, { site_id: site, place: answer?.undo?.place ?? null });
      } catch (err) { UI.toast(t(err.message), { kind: "crit" }); return; }
      if (COMP.siteId !== site || COMP.tab !== "check") return;
      await load();
      paintKeeping();
    } });
  }

  COMP.addTab({
    id: "check", order: 25, label: "Keyword check", icon: "list-ordered",
    init(helpers) {
      UI = helpers;
      TP.on(PAGES, paintKeeping); // another page, another size or a search: what's half-typed in the form stays
      document.addEventListener("click", (e) => {
        const hit = (sel) => e.target.closest?.(sel);
        let el;
        if ((el = hit("[data-kc-sort]"))) {
          const key = el.dataset.kcSort, first = FIRST[key];
          S.sort = S.sort?.key !== key ? { key, dir: first } : S.sort.dir === first ? { key, dir: first === "asc" ? "desc" : "asc" } : null; // a third press goes back to the order they were added in
          TP.reset(PAGES);
          paintKeeping();
          UI.$(`[data-kc-sort="${key}"]`)?.focus({ preventScroll: true });
          return;
        }
        if (hit("[data-kc-all]")) { askToCheck(null); return; }
        if ((el = hit("[data-kc-one]"))) { askToCheck([Number(el.dataset.kcOne)]); return; }
        if ((el = hit("[data-kc-go]"))) { go(el); return; }
        if (hit("[data-kc-cancel]")) { S.confirm = null; COMP.paint(); return; }
        if ((el = hit("[data-kc-add]"))) { add(el); return; }
        if ((el = hit("[data-kc-remove]"))) { remove(Number(el.dataset.kcRemove)); return; }
        if ((el = hit("[data-kc-track]"))) { track(el); return; }
        if ((el = hit("[data-kc-rival]"))) { COMP.open("list", { competitorId: Number(el.dataset.kcRival) }); }
      });
    },
    load,
    body,
  });

  Object.assign(window.FR = window.FR || {}, {
    "Keyword check": "Vérifier des mots-clés",
    "Search keywords": "Chercher un mot-clé", "keywords": "mots-clés", "No keyword matches.": "Aucun mot-clé ne correspond.", "Clear search": "Effacer la recherche",
    "Add keywords": "Ajouter des mots-clés",
    "One per line. Kept apart from your keyword list.": "Un par ligne. Gardés à part de votre liste de mots-clés.",
    "running shoes\ntrail running shoes": "chaussures de running\nchaussures de trail",
    "Keywords, one per line": "Mots-clés, un par ligne",
    "Country": "Pays", "Language": "Langue", "Add": "Ajouter",
    "Adding is free. Searches only run when you press Check and confirm.": "L'ajout est gratuit. Les recherches ne se lancent que lorsque vous appuyez sur Vérifier et confirmez.",
    "Checking: {done} of {total} keywords on {engine}.": "Vérification : {done} mots-clés sur {total} sur {engine}.",
    "Checked {done} of {total}.": "{done} vérifiés sur {total}.",
    "Checked {when}, with {tool}.": "Vérifié {when}, avec {tool}.",
    "Counting the searches…": "Calcul des recherches…",
    "no limit": "sans limite", "{n} left": "{n} restantes",
    "Confirm the check": "Confirmer la vérification",
    "Check {n} keyword on {engine}?": "Vérifier {n} mot-clé sur {engine} ?",
    "Check {n} keywords on {engine}?": "Vérifier {n} mots-clés sur {engine} ?",
    "{n} search, free checks only.": "{n} recherche, vérifications gratuites uniquement.",
    "{n} searches, free checks only.": "{n} recherches, vérifications gratuites uniquement.",
    "Free checks:": "Vérifications gratuites :",
    "No search tool connected.": "Aucun outil de recherche connecté.",
    "Only {n} can be checked now; the rest wait for free checks.": "Seuls {n} peuvent être vérifiés maintenant ; les autres attendent des vérifications gratuites.",
    "Check them": "Les vérifier", "Cancel": "Annuler",
    "Not checked": "Non contrôlé",
    "None in the top {n}.": "Aucun dans le top {n}.",
    "No keywords yet": "Aucun mot-clé pour l'instant",
    "No keywords yet: type some to see which competitors rank where.": "Aucun mot-clé : tapez-en pour voir quels concurrents se classent, et où.",
    "Add the keywords you want to know about. Then press Check to see which of your competitors rank for them.": "Ajoutez les mots-clés qui vous intéressent. Appuyez ensuite sur Vérifier pour voir lesquels de vos concurrents se positionnent dessus.",
    "Keyword": "Mot-clé", "You": "Vous", "Competitors ranking": "Concurrents classés", "Checked": "Vérifié", "Actions": "Actions",
    "Track": "Suivre", "Tracked": "Suivi", "Refresh": "Actualiser",
    "Adds it to your tracked keywords. No search; it stays here too.": "L'ajoute à vos mots-clés suivis. Aucune recherche ; il reste ici aussi.",
    "Tracked: Refresh checks it too.": "Suivi : Actualiser le vérifie aussi.",
    "“{k}” is now tracked. Refresh checks it from now on.": "« {k} » est maintenant suivi. Actualiser le vérifie désormais.",
    "Any country": "Tous pays", "Check": "Vérifier", "Remove {k}": "Retirer {k}",
    "All rows:": "Toutes les lignes :",
    "This part didn't load": "Cette partie ne s'est pas chargée",
    "Keyword check needs the app running.": "La vérification de mots-clés a besoin que l'appli tourne.",
    "See where your competitors rank for these. Nothing is searched until you confirm.": "Voyez où vos concurrents se classent sur ces mots-clés. Rien n'est recherché sans votre confirmation.",
    "Check {n} keyword": "Vérifier {n} mot-clé", "Check all {n} keywords": "Vérifier les {n} mots-clés",
    "{n} competitor hidden: Pages only or Off.": "{n} concurrent masqué : Pages seulement ou Désactivé.",
    "{n} competitors hidden: Pages only or Off.": "{n} concurrents masqués : Pages seulement ou Désactivé.",
    "{added} added, {already} already there.": "{added} ajoutés, {already} déjà présents.",
    "{n} keyword added.": "{n} mot-clé ajouté.", "{n} keywords added.": "{n} mots-clés ajoutés.",
    "Keyword check holds at most 500 keywords. Remove some first.": "La vérification de mots-clés contient au plus 500 mots-clés. Retirez-en d'abord.",
    "A check is already running.": "Une vérification est déjà en cours.",
    "No keywords found. Put one keyword on each line.": "Aucun mot-clé trouvé. Mettez un mot-clé par ligne.",
    "Type at least one keyword, one on each line.": "Tapez au moins un mot-clé, un par ligne.",
    "“{k}” removed.": "« {k} » retiré.",
    "{n} keyword skipped: checked in the last {hours} hours.": "{n} mot-clé ignoré : vérifié dans les {hours} dernières heures.",
    "{n} keywords skipped: checked in the last {hours} hours.": "{n} mots-clés ignorés : vérifiés dans les {hours} dernières heures.",
    "Nothing to check now.": "Rien à vérifier pour l'instant.",
    "Checked in the last 12 hours: no search spent.": "Vérifié dans les 12 dernières heures : aucune recherche dépensée.",
    "Checked in the last {hours} hours: no search spent.": "Vérifié dans les {hours} dernières heures : aucune recherche dépensée.",
    "All checked in the last {hours} hours: no search spent.": "Tous vérifiés dans les {hours} dernières heures : aucune recherche dépensée.",
    "Stopped early. Progress is saved; press Check to carry on.": "Arrêtée avant la fin. La progression est enregistrée ; appuyez sur Vérifier pour continuer.",
    "No search tool connected. Add one in Settings, then check again.": "Aucun outil de recherche connecté. Ajoutez-en un dans les réglages, puis vérifiez à nouveau.",
    "Progress is saved. Press Check again when a tool has free checks.": "La progression est enregistrée. Appuyez à nouveau sur Vérifier quand un outil aura des vérifications gratuites.",
  });
})();
