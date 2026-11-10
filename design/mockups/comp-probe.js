/* Competitors area: Keyword check. Type keywords, press Check, confirm the searches, and see which of your competitors rank
   for each and where. These keywords stay out of your own keyword list and Refresh: nothing here searches by itself.
   Each check first shows how many searches it takes and how many free checks each tool has left. */
(() => {
  "use strict";
  let UI = null;
  const COMP = window.COMP;
  const S = { site: null, data: null, error: null, confirm: null, adding: false, following: false };

  const t = (s) => UI.t(s);
  const esc = (v) => UI.esc(v);
  const fill = (key, values = {}) => t(key).replace(/\{(\w+)\}/g, (all, name) => (name in values ? values[name] : all));
  const many = (n, one, other, values = {}) => fill((UI.state.lang === "fr" ? n < 2 : n === 1) ? one : other, { n: UI.num(n), ...values });
  const busy = (run) => run && (run.status === "queued" || run.status === "running");
  const engineName = (name) => ({ google: "Google", bing: "Bing", duckduckgo: "DuckDuckGo", yandex: "Yandex" }[name] || name || "");
  const pageLink = (url, text) => (window.PageLink ? window.PageLink.html(url, { text, cls: "small" }) : COMP.link(url, text, "small"));

  function form(d) {
    return `<section class="card kc-add" aria-label="${esc(t("Add keywords"))}">
      <div class="card-head"><h2>${t("Add keywords")}</h2><span class="hint-text">${esc(t(d.keywords.length ? "One per line. They stay here, apart from your own keyword list." : "No keywords yet. Type some below to see which of your competitors rank for them, and where."))}</span></div>
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
    return total ? `<p class="small sec kc-last">${esc(fill("Last check {when}, with {tool}.", { when: COMP.ago(run.finished_at), tool: run.tool || "—" }))}</p>` : "";
  }

  function confirmBox() {
    const c = S.confirm;
    if (!c) return "";
    if (c.loading) return `<div class="kc-confirm"><p class="small sec">${UI.icon("refresh-cw", "spin")}${t("Counting the searches…")}</p></div>`;
    const e = c.estimate;
    const tools = e.tools.map((x) => `${esc(x.tool)} ${x.free_left === null || x.free_left === undefined ? esc(t("no limit")) : esc(fill("{n} free left", { n: UI.num(x.free_left) }))}`).join(" · ");
    const short = e.can_now < e.searches;
    // Checked within the hours Refresh uses (12 by default): left out, so a second press seconds later spends nothing.
    const recent = e.recent ? `<p class="small sec kc-recent">${esc(many(e.recent, "{n} keyword was checked in the last {hours} hours, so it's left out.", "{n} keywords were checked in the last {hours} hours, so they're left out.", { hours: UI.num(e.hours) }))}</p>` : "";
    if (!e.searches && e.recent) {
      return `<div class="kc-confirm" role="group" aria-label="${esc(t("Confirm the check"))}">
        <p><b>${esc(t("Nothing to check now."))}</b> ${esc(many(e.recent, "This keyword was checked in the last {hours} hours, so no search is spent on it again.", "These keywords were all checked in the last {hours} hours, so no search is spent on them again.", { hours: UI.num(e.hours) }))}</p>
        <div class="kc-go"><button type="button" class="btn btn-small btn-ghost" data-kc-cancel>${t("Close")}</button></div>
      </div>`;
    }
    return `<div class="kc-confirm" role="group" aria-label="${esc(t("Confirm the check"))}">
      <p><b>${esc(many(e.searches, "Check {n} keyword on {engine}?", "Check {n} keywords on {engine}?", { engine: engineName(e.engine) }))}</b> ${esc(many(e.searches, "That's {n} search, from free checks only.", "That's {n} searches, from free checks only."))}</p>
      <p class="small sec">${tools ? `${esc(t("Free checks:"))} ${tools}` : esc(t("No search tool is connected yet."))}</p>
      ${recent}
      ${short ? `<p class="small warn">${esc(fill("Only {n} can be checked now. The rest wait until a tool has free checks again.", { n: UI.num(e.can_now) }))}</p>` : ""}
      <div class="kc-go"><button type="button" class="btn btn-small btn-main" data-kc-go ${e.can_now ? "" : "disabled"}>${UI.icon("search")}${t("Check them")}</button><button type="button" class="btn btn-small btn-ghost" data-kc-cancel>${t("Cancel")}</button></div>
      <p class="error" role="alert" data-kc-go-error hidden></p>
    </div>`;
  }

  function cell(k) {
    if (!k.checked) return `<span class="muted small">${t("Not checked yet")}</span>`;
    if (!k.competitors.length) return `<span class="muted small">${esc(fill("None of your competitors in the top {n}.", { n: UI.num(S.data.depth || 10) }))}</span>`;
    return `<ul class="kc-ranks">${k.competitors.map((c) => `<li><button type="button" class="kc-rival" data-kc-rival="${Number(c.id)}" title="${esc(c.url)}">${UI.siteLogo(c.host, 16)}<span class="kc-host" dir="auto">${esc(c.display || c.host)}</span><span class="kc-pos tabular">#${UI.num(c.position)}</span></button></li>`).join("")}</ul>`;
  }

  function table(d) {
    if (!d.keywords.length) return ""; // the line above says there are none yet, and the form is right under it: no empty box between them
    const running = busy(d.run);
    return `<div class="table-wrap"><table class="data kc-table">
      <thead><tr><th>${t("Keyword")}</th><th class="c">${t("You")}</th><th>${t("Competitors that rank")}</th><th>${t("Checked")}</th><th><span class="sr-only">${t("Actions")}</span></th></tr></thead>
      <tbody>${d.keywords.map((k) => `<tr>
        <td class="head-cell" data-label="${esc(t("Keyword"))}"><span class="kw" dir="auto">${esc(k.keyword)}</span><span class="second">${esc([k.country, k.language].filter(Boolean).join(" · ") || t("Any country"))}</span></td>
        <td class="c" data-label="${esc(t("You"))}">${k.me ? `<span class="kc-pos tabular">#${UI.num(k.me.position)}</span>` : `<span class="muted">${k.checked ? "—" : ""}</span>`}</td>
        <td data-label="${esc(t("Competitors that rank"))}">${cell(k)}</td>
        <td class="nowrap" data-label="${esc(t("Checked"))}">${k.checked ? `<span class="small">${esc(COMP.ago(k.checked_at))}</span><span class="second">${esc(k.tool || "")}</span>` : ""}</td>
        <td class="acts nowrap">${k.tracked
          ? `<span class="kc-tracked small" title="${esc(t("It's in your tracked keywords, so Refresh checks it too."))}">${UI.icon("circle-check")}${t("Tracked")}</span>`
          : `<button type="button" class="btn btn-small btn-ghost" data-kc-track="${Number(k.id)}" title="${esc(t("Adds it to your tracked keywords. No search runs, and it stays here too."))}">${UI.icon("list-plus")}${t("Track")}</button>`}<button type="button" class="btn btn-small" data-kc-one="${Number(k.id)}" ${running ? "disabled" : ""}>${UI.icon("search")}${t("Refresh")}</button><button type="button" class="icon-btn" data-kc-remove="${Number(k.id)}" aria-label="${esc(fill("Remove {k}", { k: k.keyword }))}">${UI.icon("x")}</button></td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  function body() {
    if (S.error) return COMP.empty(t("This part didn't load"), t(S.error));
    const d = S.data;
    if (!d) return COMP.loading ? COMP.loading() : "";
    const n = d.keywords.length, running = busy(d.run);
    // With no keywords, the form's own line says what the tab does: no box above it, and the idea said once.
    // With some, the band holds Check all and says nothing is searched until it's confirmed.
    return `${n ? `<section class="tool-band kc-band" aria-label="${esc(t("Keyword check"))}">
        <p>${esc(t("Type keywords to see which of your competitors rank for them, and where. Nothing is searched until you press Check and confirm."))}</p>
        <button type="button" class="btn btn-main" data-kc-all ${running ? "disabled" : ""}>${UI.icon("search")}${esc(many(n, "Check {n} keyword", "Check all {n} keywords"))}</button>
      </section>` : ""}
      ${confirmBox()}
      ${runLine(d.run, n)}
      ${d.competitors_hidden ? `<p class="small sec kc-hidden">${esc(many(d.competitors_hidden, "{n} competitor set to Pages only or Off isn't shown.", "{n} competitors set to Pages only or Off aren't shown."))}</p>` : ""}
      ${table(d)}
      ${form(d)}`;
  }

  async function load({ quiet = false } = {}) {
    const siteId = COMP.siteId;
    if (S.site !== siteId) { S.site = siteId; S.confirm = null; }
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
    const fields = ["[data-kc-words]", "[data-kc-country]", "[data-kc-language]"].map((sel) => [sel, UI.$(sel)?.value]);
    const active = document.activeElement, focusSel = fields.find(([sel]) => active?.matches?.(sel))?.[0];
    const caret = focusSel ? [active.selectionStart, active.selectionEnd] : null;
    COMP.paint();
    fields.forEach(([sel, value]) => { const el = UI.$(sel); if (el && value !== undefined) el.value = value; });
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
      if (box) { box.textContent = t(err.message); box.hidden = false; }
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
    UI.toast(fill("“{k}” is now one of your tracked keywords. Refresh checks it from now on.", { k: k?.keyword || "" }));
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
    UI.toast(fill("“{k}” removed from Keyword check.", { k: k?.keyword || "" }), { kind: "info", undo: async () => {
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
      document.addEventListener("click", (e) => {
        const hit = (sel) => e.target.closest?.(sel);
        let el;
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
    "Add keywords": "Ajouter des mots-clés",
    "One per line. They stay here, apart from your own keyword list.": "Un par ligne. Ils restent ici, à part de votre propre liste de mots-clés.",
    "running shoes\ntrail running shoes": "chaussures de running\nchaussures de trail",
    "Keywords, one per line": "Mots-clés, un par ligne",
    "Country": "Pays", "Language": "Langue", "Add": "Ajouter",
    "Adding is free. Searches only run when you press Check and confirm.": "L'ajout est gratuit. Les recherches ne se lancent que lorsque vous appuyez sur Vérifier et confirmez.",
    "Checking: {done} of {total} keywords on {engine}.": "Vérification : {done} mots-clés sur {total} sur {engine}.",
    "Checked {done} of {total}.": "{done} vérifiés sur {total}.",
    "Last check {when}, with {tool}.": "Dernière vérification {when}, avec {tool}.",
    "Counting the searches…": "Calcul des recherches…",
    "no limit": "sans limite", "{n} free left": "{n} gratuites restantes",
    "Confirm the check": "Confirmer la vérification",
    "Check {n} keyword on {engine}?": "Vérifier {n} mot-clé sur {engine} ?",
    "Check {n} keywords on {engine}?": "Vérifier {n} mots-clés sur {engine} ?",
    "That's {n} search, from free checks only.": "Cela fait {n} recherche, uniquement sur les vérifications gratuites.",
    "That's {n} searches, from free checks only.": "Cela fait {n} recherches, uniquement sur les vérifications gratuites.",
    "Free checks:": "Vérifications gratuites :",
    "No search tool is connected yet.": "Aucun outil de recherche n'est encore connecté.",
    "Only {n} can be checked now. The rest wait until a tool has free checks again.": "Seuls {n} peuvent être vérifiés maintenant. Les autres attendent qu'un outil ait de nouveau des vérifications gratuites.",
    "Check them": "Les vérifier", "Cancel": "Annuler",
    "Not checked yet": "Pas encore vérifié",
    "None of your competitors in the top {n}.": "Aucun de vos concurrents dans le top {n}.",
    "No keywords yet": "Aucun mot-clé pour l'instant",
    "No keywords yet. Type some below to see which of your competitors rank for them, and where.": "Aucun mot-clé pour l'instant. Tapez-en ci-dessous pour voir lesquels de vos concurrents se positionnent dessus, et à quelle place.",
    "Add the keywords you want to know about. Then press Check to see which of your competitors rank for them.": "Ajoutez les mots-clés qui vous intéressent. Appuyez ensuite sur Vérifier pour voir lesquels de vos concurrents se positionnent dessus.",
    "Keyword": "Mot-clé", "You": "Vous", "Competitors that rank": "Concurrents positionnés", "Checked": "Vérifié", "Actions": "Actions",
    "Track": "Suivre", "Tracked": "Suivi", "Refresh": "Actualiser",
    "Adds it to your tracked keywords. No search runs, and it stays here too.": "L'ajoute à vos mots-clés suivis. Aucune recherche n'est lancée, et il reste ici aussi.",
    "It's in your tracked keywords, so Refresh checks it too.": "Il fait partie de vos mots-clés suivis : Actualiser le vérifie aussi.",
    "“{k}” is now one of your tracked keywords. Refresh checks it from now on.": "« {k} » fait maintenant partie de vos mots-clés suivis. Actualiser le vérifie désormais.",
    "Any country": "Tous pays", "Check": "Vérifier", "Remove {k}": "Retirer {k}",
    "This part didn't load": "Cette partie ne s'est pas chargée",
    "Keyword check needs the app running.": "La vérification de mots-clés a besoin que l'appli tourne.",
    "Type keywords to see which of your competitors rank for them, and where. Nothing is searched until you press Check and confirm.": "Tapez des mots-clés pour voir lesquels de vos concurrents se positionnent dessus, et à quelle place. Rien n'est recherché avant que vous appuyiez sur Vérifier et confirmiez.",
    "Check {n} keyword": "Vérifier {n} mot-clé", "Check all {n} keywords": "Vérifier les {n} mots-clés",
    "{n} competitor set to Pages only or Off isn't shown.": "{n} concurrent réglé sur Pages seulement ou Désactivé n'est pas affiché.",
    "{n} competitors set to Pages only or Off aren't shown.": "{n} concurrents réglés sur Pages seulement ou Désactivé ne sont pas affichés.",
    "{added} added, {already} already there.": "{added} ajoutés, {already} déjà présents.",
    "{n} keyword added.": "{n} mot-clé ajouté.", "{n} keywords added.": "{n} mots-clés ajoutés.",
    "Keyword check holds at most 500 keywords. Remove some first.": "La vérification de mots-clés contient au plus 500 mots-clés. Retirez-en d'abord.",
    "A keyword check is already running for this site.": "Une vérification de mots-clés est déjà en cours pour ce site.",
    "No keywords found. Put one keyword on each line.": "Aucun mot-clé trouvé. Mettez un mot-clé par ligne.",
    "Type at least one keyword, one on each line.": "Tapez au moins un mot-clé, un par ligne.",
    "“{k}” removed from Keyword check.": "« {k} » retiré de la vérification de mots-clés.",
    "{n} keyword was checked in the last {hours} hours, so it's left out.": "{n} mot-clé a été vérifié dans les {hours} dernières heures : il est laissé de côté.",
    "{n} keywords were checked in the last {hours} hours, so they're left out.": "{n} mots-clés ont été vérifiés dans les {hours} dernières heures : ils sont laissés de côté.",
    "Nothing to check now.": "Rien à vérifier pour l'instant.",
    "This keyword was checked in the last 12 hours, so it isn't checked again and no search is spent.": "Ce mot-clé a été vérifié dans les 12 dernières heures : il n'est pas vérifié à nouveau et aucune recherche n'est dépensée.",
    "This keyword was checked in the last {hours} hours, so no search is spent on it again.": "Ce mot-clé a été vérifié dans les {hours} dernières heures : aucune recherche n'est dépensée à nouveau.",
    "These keywords were all checked in the last {hours} hours, so no search is spent on them again.": "Ces mots-clés ont tous été vérifiés dans les {hours} dernières heures : aucune recherche n'est dépensée à nouveau.",
    "This check stopped before the end. Everything checked so far is saved. Press Check to carry on.": "Cette vérification s'est arrêtée avant la fin. Tout ce qui a été vérifié est enregistré. Appuyez sur Vérifier pour continuer.",
    "No search tool is connected yet. Add one in Settings, then check again.": "Aucun outil de recherche n'est encore connecté. Ajoutez-en un dans les réglages, puis vérifiez à nouveau.",
    "Everything checked so far is saved. Press Check again when a tool has free checks.": "Tout ce qui a été vérifié est enregistré. Appuyez à nouveau sur Vérifier quand un outil aura des vérifications gratuites.",
  });
})();
