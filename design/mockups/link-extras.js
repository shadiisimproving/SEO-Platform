/* Backlinks: the real Check now on a link's panel, and the Mediators tab with its add and edit panel.
   Mediators are loaded through COMP.api, which answers from the sample when opened as a plain file. */
(() => {
  "use strict";
  const COMP = window.COMP;
  let UI = null;
  const POLL_MS = 1500, POLL_LIMIT_MS = 90000;
  const L = { list: [], busy: new Set(), histories: new Map(), helpers: {}, sort: null };
  const PAGES = "bl-mediators"; // the table's pages and search (table-pages.js), like every long table in the app
  const key = (name) => String(name || "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");

  // ---- mediators ----------------------------------------------------------------------------------
  async function load() {
    try { L.list = (await COMP.api("GET", "mediators")).mediators || []; } catch { /* the names on the links still show */ }
    return L.list;
  }

  /* Someone named on a link but not yet saved as a mediator (the plain-file sample) still shows, and saving makes them real. */
  function merged(links) {
    const known = new Map(L.list.map((m) => [key(m.name), m]));
    links.forEach((b) => { if (b.mediator && !known.has(key(b.mediator))) known.set(key(b.mediator), { id: null, name: b.mediator, contact: b.contact || null, platform: b.platform || null, price_text: null, notes: null }); });
    return [...known.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  const names = () => [...new Set([...L.list.map((m) => m.name), ...(window.BACKLINKS || []).map((b) => b.mediator).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  const find = (name) => L.list.find((m) => key(m.name) === key(name)) || null;

  function mediatorsBody(all, helpers) {
    const { t, esc, num, icon } = UI;
    L.helpers = helpers;
    const rows = merged(all);
    const add = `<button class="btn btn-small" id="md-add">${icon("plus")}${t("Add mediator")}</button>`;
    if (!rows.length) return `<div class="table-wrap"><div class="empty"><h3>${t("No mediators yet")}</h3><p>${t("Add the people and agencies who place your links. A name typed on a backlink is added here too.")}</p>${add}</div></div>`;
    const cell = (label, inner, cls = "") => `<td class="${cls}" data-label="${t(label)}">${inner}</td>`;
    const none = '<span class="muted">—</span>';
    // Each mediator's links and numbers, worked out once, so the headings can sort by them.
    const facts = rows.map((m) => {
      const list = all.filter((b) => key(b.mediator) === key(m.name));
      const sum = window.BacklinkSeo?.trafficTotals?.(list);
      const visits = sum ? (sum.known ? sum.visits : null) : list.some((b) => b.visits !== null && b.visits !== undefined) ? list.reduce((s, b) => s + (b.visits || 0), 0) : null; // a shared number counts once (F10)
      return { m, list, live: list.filter((b) => b.status !== "lost" && b.status !== "planned").length, lost: list.filter((b) => b.status === "lost").length, visits };
    });
    const sortRows = window.BacklinkSeo?.sortRows || ((x) => x), sortHead = window.BacklinkSeo?.sortHead;
    const found = facts.filter((f) => TP.matches(PAGES, f.m.name, f.m.contact, f.m.platform));
    const page = TP.view(PAGES, sortRows(found, L.sort, { name: (f) => f.m.name, links: (f) => f.list.length, live: (f) => f.live, lost: (f) => f.lost, visits: (f) => f.visits }));
    const head = (id, label, cls = "") => (sortHead ? sortHead("data-md-sort", L.sort, id, label, cls) : `<th scope="col" class="${cls}">${t(label)}</th>`);
    // A short list needs no search: it shows once there are more than ten mediators, or while it holds something.
    const search = rows.length > 10 || TP.state(PAGES).q ? TP.search(PAGES, t("Search mediators")) : "";
    return `<div class="md-bar">${search}<span class="small sec">${t("Spent is only added up within one currency.")}</span><span class="end bl-tools">${window.BacklinkSeo?.budgetBar?.(all) || ""}${add}</span></div>
      ${found.length ? `<div class="bl-list"><div class="table-wrap"><table class="data" id="md-table"><thead><tr>
        ${head("name", "Mediator")}<th scope="col">${t("Platform")}</th><th scope="col">${t("Price")}</th>${head("links", "Links", "r")}${head("live", "Live", "r")}${head("lost", "Lost", "r")}<th scope="col" class="r">${t("Spent")}</th>${head("visits", "Visits", "r")}<th scope="col" class="r">${t("Cost per visit")}</th><th scope="col" aria-label="${t("Edit")}"></th>
      </tr></thead><tbody>${page.rows.map(({ m, list, live, lost, visits: seen }) => {
        const visits = seen === null ? none : num(seen);
        return `<tr style="cursor:default">
          <td class="head-cell"><button class="kw" data-bl-mediator="${esc(m.name)}" dir="auto" style="text-align:start" aria-label="${t("See the links from")} ${esc(m.name)}">${esc(m.name)}</button>${m.contact ? `<span class="second" dir="auto" style="overflow-wrap:anywhere">${esc(m.contact)}</span>` : ""}</td>
          ${cell("Platform", m.platform ? `<span dir="auto">${esc(m.platform)}</span>` : none)}
          ${cell("Price", m.price_text ? `<span dir="auto">${esc(m.price_text)}</span>` : none)}
          ${cell("Links", num(list.length), "r")}${cell("Live", num(live), "r")}${cell("Lost", num(lost), "r")}
          ${cell("Spent", helpers.spentWords(list), "r")}${cell("Visits", visits, "r")}${cell("Cost per visit", helpers.mediatorCost(list), "r")}
          <td class="r"><button class="btn btn-small" data-md-edit="${esc(m.name)}" aria-label="${t("Edit")}: ${esc(m.name)}">${icon("pencil")}${t("Edit")}</button></td></tr>`;
      }).join("")}</tbody></table></div>
      ${TP.footer(PAGES, page, { noun: t("mediators") })}</div>` : COMP.empty(t("No mediator matches this search"), t("Change the search to see more mediators."))}`;
  }

  function openPanel(name, opener) {
    const { t, esc, panelHead } = UI;
    const m = name ? (merged(window.BACKLINKS || []).find((x) => key(x.name) === key(name)) || null) : null;
    const box = (id, label, value, extra = "") => `<label class="field"><span>${t(label)}</span><input class="input" id="${id}" dir="auto" value="${esc(value || "")}" ${extra}></label>`;
    UI.openPanel(`${panelHead(t(m ? "Edit mediator" : "Add mediator"), m ? "" : t("Only the name is required"))}
      <form class="panel-body" id="md-form" data-id="${m?.id || ""}" data-was="${esc(m?.name || "")}" novalidate>
        ${box("md-name", "Name", m?.name, 'data-autofocus aria-describedby="md-err" maxlength="180"')}<div id="md-err"></div>
        ${box("md-contact", "Contact", m?.contact, 'maxlength="250"')}
        <div class="field-row">${box("md-platform", "Platform", m?.platform, 'maxlength="180"')}${box("md-price", "Usual price", m?.price_text, 'placeholder="150 €, AED 500" maxlength="60"')}</div>
        <label class="field"><span>${t("Notes")}</span><textarea class="input" id="md-notes" rows="3" dir="auto" maxlength="5000">${esc(m?.notes || "")}</textarea></label>
      </form>
      <div class="panel-foot"><button class="btn btn-main" id="md-save">${t("Save")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`,
    opener, { key: `mediator|${name || ""}`, reopen: () => openPanel(name, opener) });
  }

  async function save(button) {
    const { t, esc, icon, $ } = UI;
    const form = $("#md-form"), value = (id) => $(id).value.trim();
    const refuse = (words) => { UI.setHTML($("#md-err"), `<div class="error" role="alert">${icon("octagon-alert")}<span>${esc(t(words))}</span></div>`); button.disabled = false; $("#md-name").focus(); };
    const body = { name: value("#md-name"), contact: value("#md-contact"), platform: value("#md-platform"), price_text: value("#md-price"), notes: value("#md-notes") };
    if (!body.name) { refuse("A mediator needs a name."); return; }
    button.disabled = true;
    const was = form.dataset.was, id = form.dataset.id;
    try {
      if (id) await COMP.api("PATCH", `mediators/${id}`, body); else await COMP.api("POST", "mediators", body);
    } catch (err) { refuse(err.message); return; }
    if (was && was !== body.name) (window.BACKLINKS || []).forEach((b) => { if (key(b.mediator) === key(was)) b.mediator = body.name; });
    if (UI.state.blMediator && was && key(UI.state.blMediator) === key(was)) UI.state.blMediator = body.name;
    await load();
    UI.closePanel({ keep: false });
    UI.toast(t("Mediator saved"), { kind: "info" });
    if (UI.state.route === "backlinks") UI.render();
  }

  /* Picking someone known fills in only what's still empty, so nothing typed is overwritten. A new name is added when the link is saved. */
  function mediatorTyped(input) {
    const { t, $ } = UI, help = $("#bl-med-help"), known = find(input.value), typed = input.value.trim();
    if (known) {
      const fill = (id, value) => { const box = $(id); if (box && value && !box.value.trim()) box.value = value; };
      fill("#bl-contact", known.contact); fill("#bl-platform", known.platform); fill("#bl-cost", known.price_text);
      if (help) help.textContent = t("Known mediator: their details are filled in where empty.");
    } else if (help) help.textContent = typed ? t("New mediator: {name}. Added when you save.").replace("{name}", typed) : t("Type a name, or create a new one");
  }

  // ---- checking a link ------------------------------------------------------------------------------
  const REASONS = {
    robots: "Its robots.txt doesn't allow the app to read that page.", turned_away: "The site turned the app away.", rate_limited: "The site asked the app to slow down.", network: "The site didn't answer.", server: "The server answered with an error.",
    refused: "That address isn't a public website.", not_html: "That address isn't a web page.", too_large: "That page is too large to read.", redirects: "That page redirects too many times.", http_error: "The page answered with an error.",
  };

  function sentence(b) {
    const { t, esc, fmtStamp } = UI, c = b.check;
    if (!c || !c.checked_at) return t(b.status === "planned" ? "Not checked yet. A planned link is only read when you ask, and that never changes its status." : "Not checked yet. It's read once a month on the live site, or when you press Run.");
    const when = esc(fmtStamp(c.checked_at));
    if (c.outcome === "found") return `${t("Checked on")} ${when}: ${t(c.is_nofollow ? "the link is there, marked nofollow." : "the link is there and passes value.")}`;
    if (c.outcome === "unknown") return `${t("Couldn't check on")} ${when}. ${t(REASONS[c.reason] || "That page couldn't be read.")} ${t("A page that can't be read never counts as a lost link.")}`;
    const what = t(c.outcome === "page_gone" ? "the page no longer exists." : "the link is no longer on the page.");
    if (b.status === "live" && c.misses > 0) return `${t("Checked on")} ${when}: ${what} ${t("It's read once more tomorrow before it counts as lost.")}`;
    return `${t("Checked on")} ${when}: ${what}`;
  }

  function differsFromTarget(b) {
    const c = b.check;
    if (!c?.href || !b.target) return false;
    const path = (value) => { try { return decodeURIComponent(new URL(value, "https://x/").pathname).replace(/\/+$/, "") || "/"; } catch { return value; } };
    return path(c.href) !== path(b.target);
  }

  function factsOf(b) {
    const { t, esc } = UI, c = b.check;
    if (!c || c.outcome !== "found") return "";
    const row = (label, value, cls = "") => (value ? `<tr><td class="sec">${t(label)}</td><td class="${cls}" dir="auto" style="overflow-wrap:anywhere">${esc(value)}</td></tr>` : "");
    const moved = (from, to) => to && from && to.replace(/\/$/, "") !== from.replace(/\/$/, "");
    return `<table class="mini"><tbody>
      ${row("Anchor on the page", c.anchor)}
      ${row("Link attributes", c.rel, "mono small")}
      ${row("It points to", c.href, "mono small")}
      ${moved(b.src, c.final_url) ? row("The page moved to", c.final_url, "mono small") : ""}
      ${moved(c.href, c.target_final_url) ? row("Your page ends up at", c.target_final_url, "mono small") : ""}
    </tbody></table>${differsFromTarget(b) ? `<p class="note warn" style="margin:8px 0 0">${UI.icon("triangle-alert")}<span>${t("It links to your site, but not to the target page you logged.")}</span></p>` : ""}`;
  }

  function changeWords(change) {
    const { t, esc } = UI;
    if (change.what === "nofollow") return t(change.after ? "It became nofollow." : "It's no longer nofollow.");
    return `${t("The anchor changed:")} <span dir="auto">${esc(change.before)}</span> → <span dir="auto">${esc(change.after)}</span>`;
  }

  function historyHtml(id) {
    const { t, esc, fmtStamp } = UI, list = L.histories.get(id);
    if (!list || !list.length) return "";
    const word = { found: "Link found", missing: "Link not found", page_gone: "Page gone", unknown: "Couldn't check" };
    return `<details class="fold"><summary>${UI.icon("chevron-right")}${t("Past checks")}<span class="hint">${list.length}</span></summary><ul class="lk-history">${list.slice(0, 10).map((c) => `<li>${esc(fmtStamp(c.checked_at))} · ${t(word[c.outcome] || c.outcome)}${c.trigger === "button" ? ` · ${t("by hand")}` : ""}${c.changes.length ? `<div>${c.changes.map(changeWords).join(" ")}</div>` : ""}</li>`).join("")}</ul></details>`;
  }

  function blockInner(b) {
    const { t, icon } = UI, busy = L.busy.has(b.serverId);
    const latest = L.histories.get(b.serverId)?.[0];
    return `<p class="lk-result" role="status">${busy ? t("Reading the page…") : sentence(b)}</p>
      ${latest?.changes?.length && latest.outcome === "found" ? `<ul class="lk-changes">${latest.changes.map((x) => `<li>${changeWords(x)}</li>`).join("")}</ul>` : ""}
      ${factsOf(b)}${historyHtml(b.serverId)}
      <button class="btn btn-small" id="link-check-now" style="margin-top:10px" data-id="${b.serverId}" ${busy ? "disabled" : ""}>${icon("refresh-cw", busy ? "spin" : "")}${t(busy ? "Checking…" : b.check?.checked_at ? "Run again" : "Run")}</button>`;
  }

  const paintBlock = (b) => { const box = UI.$(`#lk-block[data-id="${b.serverId}"]`); if (box) UI.setHTML(box, blockInner(b)); };

  async function loadHistory(b) {
    try { L.histories.set(b.serverId, (await COMP.api("GET", `backlinks/${b.serverId}/checks`)).checks); } catch { return; }
    paintBlock(b);
  }

  function checkBlock(b, helpers) {
    L.helpers = { ...L.helpers, ...helpers };
    setTimeout(() => loadHistory(b), 0);
    return `<div id="lk-block" data-id="${b.serverId}">${blockInner(b)}</div>`;
  }

  async function checkNow(id) {
    const b = (window.BACKLINKS || []).find((x) => x.serverId === id);
    if (!b || L.busy.has(id)) return;
    L.busy.add(id);
    paintBlock(b);
    const before = b.check?.checked_at || null;
    const stop = (message, kind = "info") => { L.busy.delete(id); paintBlock(b); if (message) UI.toast(message, { kind }); UI.$("#link-check-now")?.focus(); };
    try { await COMP.api("POST", `backlinks/${id}/check`, {}); } catch (err) { stop(UI.t(err.message), "crit"); return; }
    const started = Date.now();
    const poll = async () => {
      try {
        const row = await COMP.api("GET", `backlinks/${id}`);
        if (row.check?.checked_at !== before) {
          Object.assign(b, UI.toBacklink(row, b.site));
          window.BacklinkSeo?.repaint?.(b);
          await loadHistory(b);
          window.HealthTest?.reloadAlerts?.();
          stop(UI.t(b.status === "lost" ? "This link is lost" : "Link checked"), b.status === "lost" ? "crit" : "info");
          if (UI.state.route === "backlinks") UI.render();
          return;
        }
      } catch { /* the next try may work */ }
      if (Date.now() - started > POLL_LIMIT_MS) { stop(UI.t("The check is still waiting its turn. Come back in a moment.")); return; }
      setTimeout(poll, POLL_MS);
    };
    setTimeout(poll, POLL_MS);
  }

  /* Beside the status in the table: what a check found that the status alone doesn't say. */
  function rowNote(b) {
    const { t } = UI, c = b.check;
    if (!c) return "";
    if (b.status === "live" && c.misses > 0) return ` <span class="tag" data-tip="${UI.esc(t("It's read once more tomorrow before it counts as lost."))}" tabindex="0">${t("Not found once")}</span>`;
    if (b.status === "live" && c.is_nofollow && !c.verdict) return ` <span class="tag" data-tip="${UI.esc(t("The link is there, marked nofollow."))}" tabindex="0">${t("Nofollow")}</span>`;
    return "";
  }

  function bind() {
    document.addEventListener("click", (e) => {
      const target = e.target;
      let el;
      if ((el = target.closest?.("#link-check-now"))) { checkNow(Number(el.dataset.id)); return; }
      if ((el = target.closest?.("#md-add"))) { openPanel(null, el); return; }
      if ((el = target.closest?.("[data-md-sort]"))) { const id = el.dataset.mdSort; L.sort = window.BacklinkSeo.nextSort(L.sort, id, id === "name" ? "asc" : "desc"); TP.reset(PAGES); UI.render(); UI.$(`[data-md-sort="${id}"]`)?.focus(); return; }
      if ((el = target.closest?.("[data-md-edit]"))) { openPanel(el.dataset.mdEdit, el); return; }
      if ((el = target.closest?.("#md-save"))) { save(el); return; }
      if ((el = target.closest?.('[data-bl-tab="mediators"]'))) load().then(() => { if (UI.state.route === "backlinks" && UI.state.blTab === "mediators" && !UI.$("#panel")) UI.render(); });
    });
    document.addEventListener("input", (e) => { if (e.target.id === "bl-mediator") mediatorTyped(e.target); });
    document.addEventListener("focusin", (e) => {
      if (e.target.id !== "bl-mediator") return;
      load().then(() => { const list = UI.$("#mediators"); if (list) UI.setHTML(list, names().map((n) => `<option value="${UI.esc(n)}"></option>`).join("")); });
    });
    document.addEventListener("submit", (e) => { if (e.target.id === "md-form") { const button = UI.$("#md-save"); if (button && !button.disabled) save(button); } });
  }

  function sampleWrites() {
    const list = () => { const get = window.COMP_SAMPLE?.get; if (get && !get.mediators) get.mediators = { mediators: [] }; return get?.mediators?.mediators || []; };
    const taken = (name, except) => list().some((m) => key(m.name) === key(name) && m.id !== except);
    const refuse = () => Object.assign(new Error("There is already a mediator with that name."), { status: 409 });
    let next = 9000;
    COMP.sampleWrite("POST mediators", (match, body) => { if (taken(body.name)) throw refuse(); const made = { id: next++, links: 0, live: 0, lost: 0, planned: 0, ...body }; list().push(made); return { ...made }; });
    COMP.sampleWrite("PATCH mediators/(\\d+)", (match, body) => { const m = list().find((x) => x.id === Number(match[1])); if (!m) throw Object.assign(new Error("That mediator doesn't exist."), { status: 404 }); if (body.name && taken(body.name, m.id)) throw refuse(); Object.assign(m, body); return { ...m }; });
  }

  window.LinkExtras = {
    init(helpers) { UI = helpers; bind(); sampleWrites(); load(); TP.on(PAGES, () => UI.render()); },
    load, names, count: (links) => merged(links).length, mediatorsBody, checkBlock, rowNote,
  };

  const fr = {
    "Add mediator": "Ajouter un intermédiaire", "Edit mediator": "Modifier l'intermédiaire", "No mediators yet": "Pas encore d'intermédiaires", "Only the name is required": "Seul le nom est obligatoire", "Usual price": "Prix habituel", "Name": "Nom",
    "Add the people and agencies who place your links. A name typed on a backlink is added here too.": "Ajoutez les personnes et agences qui placent vos liens. Un nom saisi sur un backlink est aussi ajouté ici.",
    "Spent is only added up within one currency.": "Les dépenses ne s'additionnent que dans une même devise.",
    "Search mediators": "Rechercher un intermédiaire", "mediators": "intermédiaires", "No mediator matches this search": "Aucun intermédiaire ne correspond à cette recherche", "Change the search to see more mediators.": "Modifiez la recherche pour voir plus d'intermédiaires.", "Mediator saved": "Intermédiaire enregistré", "A mediator needs a name.": "Un intermédiaire a besoin d'un nom.",
    "There is already a mediator with that name.": "Il existe déjà un intermédiaire avec ce nom.", "That mediator doesn't exist.": "Cet intermédiaire n'existe pas.",
    "Known mediator: their details are filled in where empty.": "Intermédiaire connu : ses coordonnées sont remplies là où c'est vide.", "New mediator: {name}. Added when you save.": "Nouvel intermédiaire : {name}. Ajouté à l'enregistrement.", 
    "Run": "Lancer", "Run again": "Relancer", "Checking…": "Contrôle en cours…", "Reading the page…": "Lecture de la page…", "Checked on": "Contrôlé le", "Link checked": "Lien contrôlé", "Couldn't check on": "Contrôle impossible le", "This link is lost": "Ce lien est perdu",
    "Not checked yet. A planned link is only read when you ask, and that never changes its status.": "Pas encore contrôlé. Un lien prévu n'est lu que sur demande, et cela ne change jamais son statut.", "Not checked yet. It's read once a month on the live site, or when you press Run.": "Pas encore contrôlé. Il est lu une fois par mois sur le site en ligne, ou quand vous appuyez sur Lancer.",
    "the link is there, marked nofollow.": "le lien est là, marqué nofollow.", "the link is there and passes value.": "le lien est là et transmet de la valeur.", "the page no longer exists.": "la page n'existe plus.", "the link is no longer on the page.": "le lien n'est plus sur la page.",
    "A page that can't be read never counts as a lost link.": "Une page illisible ne compte jamais comme un lien perdu.", "That page couldn't be read.": "Cette page n'a pas pu être lue.", "It's read once more tomorrow before it counts as lost.": "Il est relu demain avant de compter comme perdu.",
    "Its robots.txt doesn't allow the app to read that page.": "Son robots.txt n'autorise pas l'application à lire cette page.", "The site turned the app away.": "Le site a refusé l'application.", "The site asked the app to slow down.": "Le site a demandé à l'application de ralentir.", "The site didn't answer.": "Le site n'a pas répondu.",
    "That address isn't a public website.": "Cette adresse n'est pas un site public.", "That address isn't a web page.": "Cette adresse n'est pas une page web.", "That page is too large to read.": "Cette page est trop volumineuse pour être lue.", "That page redirects too many times.": "Cette page redirige trop de fois.", "The page answered with an error.": "La page a répondu par une erreur.",
    "Anchor on the page": "Ancre sur la page", "Link attributes": "Attributs du lien", "It points to": "Il pointe vers", "The page moved to": "La page a déménagé vers", "Your page ends up at": "Votre page aboutit à",
    "It links to your site, but not to the target page you logged.": "Il pointe vers votre site, mais pas vers la page cible enregistrée.", "It became nofollow.": "Il est passé en nofollow.", "It's no longer nofollow.": "Il n'est plus en nofollow.", "The anchor changed:": "L'ancre a changé :",
    "Past checks": "Contrôles passés", "Link found": "Lien trouvé", "Link not found": "Lien introuvable", "Couldn't check": "Contrôle impossible", "by hand": "à la main", "Not found once": "Introuvable une fois", "The link is there, marked nofollow.": "Le lien est là, marqué nofollow.",
    "Log this link first, then it can be checked.": "Enregistrez d'abord ce lien, il pourra ensuite être contrôlé.", "That backlink doesn't exist.": "Ce backlink n'existe pas.", "The check is still waiting its turn. Come back in a moment.": "Le contrôle attend son tour. Revenez dans un instant.",
    "lost this week": "perdus cette semaine", "1 lost this week": "1 perdu cette semaine", "Choose your site first": "Choisissez d'abord votre site", "That target page isn't a web address": "Cette page cible n'est pas une adresse web", "The target page is on another website. A tagged link must point at your own site.": "La page cible est sur un autre site. Un lien balisé doit pointer vers votre propre site.",
    "UTM values are case sensitive, so give the mediator this exact link.": "Les valeurs UTM sont sensibles à la casse : donnez exactement ce lien à l'intermédiaire.",
  };
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
