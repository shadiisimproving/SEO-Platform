/* Backlinks → Bought links and Boost URL (plan-seo-command-center-mickaz-features-and-ai-brand.md, steps 3-4).

   Bought links: the links paid for, one card per keyword they were bought for, answer first: billed of the overall budget,
   what they really cost, how many. A card opens its links: day placed, site, status, anchor, billed / real cost, and the
   keyword's Search Console position 28 days before → 28 days after (seo/backlinks/bought.py). Edit opens the usual
   backlink form; Duplicate opens it filled in but for the source page; Delete asks first, like the Done list.

   Boost URL: traffic sent to one of my pages on purpose (seo/backlinks/boosts.py), each with its visits during against
   before, and its keywords' positions before → after. It shows as a band on the keyword charts.

   mockup.js draws the section tabs and calls BoughtLinks.body() / boostBody(); this file fetches and draws the rest. */
(function () {
  const fr = {
    "Bought links": "Liens achetés", "Boost URL": "Boost URL", "Billed": "Facturé", "Real cost": "Coût réel", "What you were billed": "Ce qu'on vous a facturé",
    "Pick a site to see its bought links.": "Choisissez un site pour voir ses liens achetés.", "Pick a site to see its boosts.": "Choisissez un site pour voir ses boosts.",
    "Couldn't load the bought links.": "Impossible de charger les liens achetés.", "Couldn't load the boosts.": "Impossible de charger les boosts.",
    "of {total}": "sur {total}", "links": "liens", "1 link": "1 lien", "{n} links": "{n} liens", "Set an overall budget": "Définir un budget global", "Overall budget": "Budget global", "Change": "Modifier",
    "No prices yet: Edit a link to add what you were billed and what it really cost.": "Pas encore de prix : modifiez un lien pour ajouter le montant facturé et le coût réel.",
    "Position: Search Console, 28 days before each link against 28 days after. Correlation, not proof.": "Position : Search Console, 28 jours avant chaque lien contre 28 jours après. Corrélation, pas preuve.",
    "No keyword": "Sans mot-clé", "Placed": "Posé", "Site": "Site", "Anchor": "Ancre", "Price": "Prix", "Before → after": "Avant → après", "Actions": "Actions",
    "Edit": "Modifier", "Duplicate": "Dupliquer", "Delete": "Supprimer", "See the chart": "Voir la courbe", "Ready on {d}": "Prêt le {d}", "Not enough data": "Pas assez de données",
    "No date": "Sans date", "first link → now": "premier lien → maintenant", "Pending": "En attente", "No bought links yet": "Pas encore de liens achetés",
    "Links you log in Done, with a keyword, show here with what they cost and what they did.": "Les liens notés dans Fait, avec un mot-clé, s'affichent ici avec leur coût et leur effet.",
    "Save": "Enregistrer", "Cancel": "Annuler", "Currency": "Devise", "Saved": "Enregistré", "Delete this backlink?": "Supprimer ce backlink ?",
    "Add a boost": "Ajouter un boost", "Edit boost": "Modifier le boost", "Traffic sent to one of your pages on purpose: ads, social, a newsletter, a traffic service. It shows as a band on the keyword charts.": "Du trafic envoyé exprès vers une de vos pages : pub, réseaux sociaux, newsletter, service de trafic. Il s'affiche en bande sur les courbes des mots-clés.",
    "No boosts yet": "Pas encore de boost", "Log each time you send traffic to a page, to see what it did.": "Notez chaque envoi de trafic vers une page pour voir ce qu'il a donné.",
    "Page": "Page", "Keywords": "Mots-clés", "One per line": "Un par ligne", "Start": "Début", "End": "Fin", "Leave empty while it runs": "Laisser vide tant qu'il tourne", "Source": "Source", "Note": "Note",
    "ads": "publicité", "social": "réseaux sociaux", "newsletter": "newsletter", "traffic service": "service de trafic", "other": "autre", "running": "en cours",
    "Visits": "Visites", "during": "pendant", "the same days before": "les mêmes jours avant", "No Google Analytics for this page yet.": "Pas encore de Google Analytics pour cette page.",
    "Delete this boost?": "Supprimer ce boost ?", "Boost deleted": "Boost supprimé", "Boost saved": "Boost enregistré", "Needs a start day and a page.": "Il faut un jour de début et une page.",
    "waiting": "en attente",
  };
  Object.keys(fr).forEach((k) => { if (window.FR && window.FR[k] === undefined) window.FR[k] = fr[k]; });

  const B = { data: {}, boosts: {}, open: new Set() };
  const UIx = () => window.UI;
  const t = (w) => UIx().t(w), esc = (s) => UIx().esc(s), icon = (n, c) => UIx().icon(n, c), num = (n) => UIx().num(n), dec = (n) => UIx().dec(n);
  const api = (...a) => window.COMP.api(...a);
  const SYMBOL = { EUR: "€", USD: "$", GBP: "£", AED: "AED" };
  const money = (value, currency) => {
    if (value === null || value === undefined) return "—";
    const n = num(Math.round(value));
    if (!currency) return n;
    return currency === "USD" || currency === "GBP" ? `${SYMBOL[currency]}${n}` : `${n} ${SYMBOL[currency] || currency}`;
  };
  const fmt = (d) => UIx().fmtDay(d, { day: "numeric", month: "short" });
  const redraw = () => { if (UIx().state.route === "backlinks") UIx().render({ keepScroll: true }); };
  // Edits, deletes and imports change window.BACKLINKS: the same links drawn again ask the server again.
  const linksStamp = () => (window.BACKLINKS || []).map((b) => `${b.serverId}|${b.status}|${b.placed}|${b.keyword}|${b.cost}|${b.billed}`).join(";");

  function load(kind, siteId) {
    const store = kind === "bought" ? B.data : B.boosts;
    const stamp = kind === "bought" ? linksStamp() : B.boostStamp || 0;
    const key = `${siteId}|${stamp}`;
    if (!store[key]) {
      store[key] = "loading";
      api("GET", `backlinks/${kind === "bought" ? "bought" : "boosts"}?site_id=${siteId}`)
        .then((answer) => { store[key] = answer; redraw(); })
        .catch((err) => { store[key] = { error: err.message || "error" }; redraw(); });
    }
    return store[key];
  }

  /* ---- Bought links -------------------------------------------------------------------------------------------------------- */
  function effectCell(e, short = false) {
    if (!e || e.state === "no_keyword" || e.state === "no_date" || e.state === "no_data") return `<span class="muted">—</span>`;
    if (e.state === "waiting") return `<span class="small muted">${esc(t("Ready on {d}").replace("{d}", fmt(e.ready_on)))}</span>`;
    if (e.state === "few") return `<span class="small muted" data-tip="${esc(t("Not enough data"))}">${short ? "?" : esc(t("Not enough data"))}</span>`;
    const r = (v) => Math.max(1, Math.round(v)), moved = r(e.before) - r(e.after);
    return `<span class="bgt-eff nowrap"><span class="tabular">${r(e.before)} → ${r(e.after)}</span>${moved ? `<span class="kwb-mv ${moved > 0 ? "up" : "down"}">${moved > 0 ? "+" : "−"}${Math.abs(moved)}</span>` : `<span class="kwb-mv same"><span aria-hidden="true">=</span><span class="sr">${esc(t("No change"))}</span></span>`}</span>`;
  }
  const statusWord = (s) => (s === "planned" ? UIx().status("planned", t("Pending")) : UIx().linkStatus(s));
  const linkOf = (row) => (window.BACKLINKS || []).find((b) => b.serverId === row.id);

  function body() {
    const siteId = UIx().siteIdPicked?.();
    if (!siteId) return `<div class="table-wrap"><div class="empty"><h3>${t("Bought links")}</h3><p>${t("Pick a site to see its bought links.")}</p></div></div>`;
    const d = load("bought", siteId);
    if (d === "loading") return UIx().skeleton ? UIx().skeleton("page", { tiles: 3, chart: false, rows: 4 }) : `<p class="muted">${t("Loading…")}</p>`;
    if (d.error) return UIx().failCard(d.error, { title: "Couldn't load the bought links.", onRetry: () => { B.data = {}; redraw(); } });
    if (!d.cards.length) return `<div class="table-wrap"><div class="empty"><h3>${t("No bought links yet")}</h3><p>${t("Links you log in Done, with a keyword, show here with what they cost and what they did.")}</p></div></div>`;
    const cur = d.currency, total = d.budget?.total ?? null;
    const share = total ? Math.min(100, (d.totals.billed / total) * 100) : 0;
    const priced = d.totals.billed || d.totals.cost;
    const top = `<section class="bgt-top card" aria-label="${esc(t("Bought links"))}">
      <div class="bgt-fig"><span class="bgt-label">${t("Billed")}</span><span class="bgt-num tabular">${money(d.totals.billed, cur)}</span>${total ? `<span class="bgt-of">${esc(t("of {total}").replace("{total}", money(total, cur)))}</span>` : ""}
        <button type="button" class="link-btn" data-bgt-budget>${total ? t("Change") : t("Set an overall budget")}</button></div>
      <div class="bgt-fig"><span class="bgt-label">${t("Real cost")}</span><span class="bgt-num tabular">${money(d.totals.cost, cur)}</span></div>
      <div class="bgt-fig"><span class="bgt-label">${t("Bought links")}</span><span class="bgt-num tabular">${num(d.totals.links)}</span></div>
      ${total ? `<div class="bgt-bar" role="img" aria-label="${esc(`${money(d.totals.billed, cur)} ${t("of {total}").replace("{total}", money(total, cur))}`)}"><span style="width:${share.toFixed(1)}%"></span></div>` : ""}
    </section>
    ${priced ? "" : `<p class="note">${icon("info")}<span>${t("No prices yet: Edit a link to add what you were billed and what it really cost.")}</span></p>`}
    <p class="small muted bgt-why">${t("Position: Search Console, 28 days before each link against 28 days after. Correlation, not proof.")}</p>`;
    const cards = d.cards.map((c, i) => {
      const id = `bgt-${i}`, open = B.open.has(c.keyword || "");
      const head = `<button type="button" class="bgt-head" data-bgt-open="${esc(c.keyword || "")}" aria-expanded="${open}" aria-controls="${id}">
        ${icon(open ? "chevron-down" : "chevron-right")}<span class="bgt-kw" dir="auto">${c.keyword ? esc(c.keyword) : `<span class="muted">${t("No keyword")}</span>`}</span>
        <span class="bgt-count">${esc(c.count === 1 ? t("1 link") : t("{n} links").replace("{n}", num(c.count)))}</span>
        <span class="bgt-money tabular">${c.billed || c.cost ? `${money(c.billed, cur)} <span class="muted">/ ${money(c.cost, cur)}</span>` : '<span class="muted">—</span>'}</span>
        <span class="bgt-card-eff" data-tip="${esc(t("first link → now"))}">${effectCell(c.effect, true)}</span></button>`;
      if (!open) return `<section class="bgt-card">${head}</section>`;
      const rows = c.links.map((x) => `<tr>
        <td data-label="${t("Placed")}" class="nowrap">${x.placed_day ? esc(fmt(x.placed_day)) : `<span class="muted" data-tip="${esc(x.placed || "")}">${t("No date")}</span>`}</td>
        <td data-label="${t("Site")}"><span class="with-logo">${UIx().siteLogo ? UIx().siteLogo(x.domain) : ""}<a href="${esc(x.source_url)}" target="_blank" rel="noopener" dir="auto">${esc(x.domain)}</a></span></td>
        <td data-label="${t("Status")}">${statusWord(x.status)}</td>
        <td data-label="${t("Anchor")}" dir="auto">${x.anchor ? esc(x.anchor) : '<span class="muted">—</span>'}</td>
        <td data-label="${t("Price")}" class="r tabular nowrap">${x.billed !== null || x.cost !== null ? `${money(x.billed, x.currency || cur)} <span class="muted">/ ${money(x.cost, x.currency || cur)}</span>` : '<span class="muted">—</span>'}</td>
        <td data-label="${t("Before → after")}" class="r">${effectCell(x.effect)}</td>
        <td class="r nowrap bgt-acts"><button type="button" class="btn btn-small" data-bgt-edit="${x.id}">${t("Edit")}</button><button type="button" class="btn btn-small" data-bgt-dup="${x.id}">${t("Duplicate")}</button><button type="button" class="icon-btn danger" data-bgt-del="${x.id}" aria-label="${esc(`${t("Delete")}: ${x.domain}`)}" data-tip="${esc(t("Delete"))}">${icon("trash-2")}</button></td>
      </tr>`).join("");
      return `<section class="bgt-card is-open">${head}<div id="${id}" class="bgt-body">
        ${c.keyword_id ? `<p class="bgt-chart"><a class="link-btn" href="#keywords?site=${encodeURIComponent(d.host)}&amp;kw=${encodeURIComponent(`${d.site_id}:${c.keyword_id}`)}">${icon("trending-up")}${t("See the chart")}</a></p>` : ""}
        <div class="table-wrap"><table class="data bgt-table"><thead><tr><th scope="col">${t("Placed")}</th><th scope="col">${t("Site")}</th><th scope="col">${t("Status")}</th><th scope="col">${t("Anchor")}</th><th scope="col" class="r">${t("Billed")} / ${t("Real cost")}</th><th scope="col" class="r">${t("Before → after")}</th><th scope="col"><span class="sr">${t("Actions")}</span></th></tr></thead><tbody>${rows}</tbody></table></div>
      </div></section>`;
    }).join("");
    return `${top}<div class="bgt-cards">${cards}</div>`;
  }

  function budgetDialog() {
    const siteId = UIx().siteIdPicked?.();
    const key = Object.keys(B.data).find((k) => k.startsWith(`${siteId}|`) && typeof B.data[k] === "object" && !B.data[k].error);
    const d = key ? B.data[key] : null;
    const cur = d?.budget?.currency || d?.currency || "EUR";
    const dlg = UIx().$("#dlg");
    dlg.classList.remove("wide");
    UIx().setHTML(dlg, `<div class="dlg-head"><h2 id="dlg-title">${t("Overall budget")}</h2><button class="icon-btn" data-close-dlg aria-label="${t("Close")}">${icon("x")}</button></div>
      <form class="dlg-body" id="bgt-budget-form" novalidate>
        <div class="field-row"><label class="field"><span>${t("Overall budget")}</span><input class="input" id="bgt-total" inputmode="decimal" value="${d?.budget?.total ?? ""}" data-autofocus></label>
        <label class="field"><span>${t("Currency")}</span><select class="select" id="bgt-cur">${["EUR", "USD", "AED", "GBP"].map((c) => `<option ${c === cur ? "selected" : ""}>${c}</option>`).join("")}</select></label></div>
        <div id="bgt-budget-err" role="alert"></div>
      </form>
      <div class="dlg-foot"><button class="btn btn-main" id="bgt-budget-save">${t("Save")}</button><button class="btn" data-close-dlg>${t("Cancel")}</button></div>`);
    dlg.showModal();
    UIx().$("#bgt-total")?.focus();
  }
  async function saveBudget(button) {
    const siteId = UIx().siteIdPicked?.();
    const raw = UIx().$("#bgt-total").value.replace(/\s/g, "").replace(",", ".");
    button.disabled = true;
    try {
      const old = await api("GET", `backlinks/budget?site_id=${siteId}`);
      // The monthly amount (Mediators) stays as it was; a site without one gets 0, which that bar reads as "no monthly budget".
      await api("PUT", "backlinks/budget", { site_id: siteId, amount: old.budget?.amount ?? 0, currency: UIx().$("#bgt-cur").value, total: raw === "" ? null : Number(raw) });
      UIx().$("#dlg").close();
      B.data = {};
      UIx().toast(t("Saved"));
      redraw();
    } catch (err) {
      button.disabled = false;
      UIx().setHTML(UIx().$("#bgt-budget-err"), `<p class="error">${icon("octagon-alert")}<span>${esc(t(err.message))}</span></p>`);
    }
  }

  /* ---- Boost URL ----------------------------------------------------------------------------------------------------------- */
  function boostResult(b) {
    const v = b.result.visits;
    const visits = v ? (() => { const pct = v.before ? Math.round(((v.during - v.before) / v.before) * 100) : null; return `<span class="bst-fact"><span class="bgt-label">${t("Visits")}</span><span class="tabular">${num(v.during)}</span> <span class="muted small">${t("during")} · ${num(v.before)} ${t("the same days before")}</span>${pct !== null ? ` <span class="kwb-mv ${pct >= 0 ? "up" : "down"}">${pct >= 0 ? "+" : "−"}${Math.abs(pct)}%</span>` : ""}</span>`; })()
      : `<span class="small muted">${t("No Google Analytics for this page yet.")}</span>`;
    const pos = b.result.positions.map((p) => `<li><span dir="auto">${window.KeywordLink ? window.KeywordLink.html(p.keyword) : esc(p.keyword)}</span> ${effectCell(p)}</li>`).join("");
    return `${visits}${pos ? `<ul class="bst-kws">${pos}</ul>` : ""}`;
  }
  function boostBody() {
    const siteId = UIx().siteIdPicked?.();
    const intro = `<div class="bst-intro"><p class="small muted">${t("Traffic sent to one of your pages on purpose: ads, social, a newsletter, a traffic service. It shows as a band on the keyword charts.")}</p>${siteId ? `<button type="button" class="btn btn-main" data-bst-add>${icon("plus")}${t("Add a boost")}</button>` : ""}</div>`;
    if (!siteId) return `${intro}<div class="table-wrap"><div class="empty"><h3>${t("Boost URL")}</h3><p>${t("Pick a site to see its boosts.")}</p></div></div>`;
    const d = load("boost", siteId);
    if (d === "loading") return intro + (UIx().skeleton ? UIx().skeleton("page", { tiles: 0, chart: false, rows: 3 }) : "");
    if (d.error) return intro + UIx().failCard(d.error, { title: "Couldn't load the boosts.", onRetry: () => { B.boosts = {}; redraw(); } });
    B.sources = d.sources;
    if (!d.boosts.length) return `${intro}<div class="table-wrap"><div class="empty"><h3>${t("No boosts yet")}</h3><p>${t("Log each time you send traffic to a page, to see what it did.")}</p><button type="button" class="btn btn-main" data-bst-add>${icon("plus")}${t("Add a boost")}</button></div></div>`;
    B.boostList = d.boosts;
    const rows = d.boosts.map((b) => `<li class="bst-row card">
      <div class="bst-main">
        <div class="bst-url">${window.PageLink ? window.PageLink.html(b.url) : esc(b.url)}</div>
        <div class="small muted">${esc(fmt(b.started))} – ${b.ended ? esc(fmt(b.ended)) : `<b>${t("running")}</b>`}${b.source ? ` · ${esc(t(b.source))}` : ""}${b.billed !== null || b.cost !== null ? ` · ${money(b.billed, b.currency)} <span class="muted">/ ${money(b.cost, b.currency)}</span>` : ""}</div>
        ${b.note ? `<p class="small bst-note" dir="auto">${esc(b.note)}</p>` : ""}
      </div>
      <div class="bst-res">${boostResult(b)}</div>
      <div class="bst-acts"><button type="button" class="btn btn-small" data-bst-edit="${b.id}">${t("Edit")}</button><button type="button" class="btn btn-small" data-bst-dup="${b.id}">${t("Duplicate")}</button><button type="button" class="icon-btn danger" data-bst-del="${b.id}" aria-label="${esc(`${t("Delete")}: ${b.url}`)}" data-tip="${esc(t("Delete"))}">${icon("trash-2")}</button></div>
    </li>`).join("");
    return `${intro}<ul class="bst-list">${rows}</ul>`;
  }
  function boostPanel(from, editing, opener) {
    const siteId = UIx().siteIdPicked?.(), host = UIx().siteHostPicked?.() || "";
    const v = (k) => esc(from?.[k] ?? "");
    const sources = B.sources || ["ads", "social", "newsletter", "traffic service", "other"];
    const today = new Date().toISOString().slice(0, 10);
    UIx().openPanel(`${UIx().panelHead(t(editing ? "Edit boost" : "Add a boost"), esc(host))}
      <form class="panel-body" id="bst-form" data-edit="${editing ? from.id : ""}" novalidate>
        <label class="field"><span>${t("Page")} <span class="req">*</span></span><input class="input mono" id="bst-url" type="url" inputmode="url" spellcheck="false" autocapitalize="off" placeholder="https://${esc(host)}/…" value="${v("url")}" data-autofocus></label>
        <label class="field"><span>${t("Keywords")}</span><textarea class="input" id="bst-kws" rows="3" dir="auto" aria-describedby="bst-kws-help">${esc((from?.keywords || []).join("\n"))}</textarea><span class="help" id="bst-kws-help">${t("One per line")}</span></label>
        <div class="field-row"><label class="field"><span>${t("Start")} <span class="req">*</span></span><input class="input" id="bst-start" type="date" value="${esc(from?.started || today)}"></label>
        <label class="field"><span>${t("End")}</span><input class="input" id="bst-end" type="date" value="${v("ended")}" aria-describedby="bst-end-help"><span class="help" id="bst-end-help">${t("Leave empty while it runs")}</span></label></div>
        <label class="field"><span>${t("Source")}</span><select class="select" id="bst-source" style="width:100%"><option value="">—</option>${sources.map((s) => `<option value="${esc(s)}" ${from?.source === s ? "selected" : ""}>${esc(t(s))}</option>`).join("")}</select></label>
        <div class="field-row"><label class="field"><span>${t("Billed")}</span><input class="input" id="bst-billed" placeholder="300 €" value="${v("billed_text")}"></label><label class="field"><span>${t("Real cost")}</span><input class="input" id="bst-cost" placeholder="200 €" value="${v("cost_text")}"></label></div>
        <label class="field"><span>${t("Note")}</span><textarea class="input" id="bst-note" rows="2" dir="auto">${v("note")}</textarea></label>
        <div id="bst-err" role="alert"></div>
        <input type="hidden" id="bst-site" value="${esc(siteId)}">
      </form>
      <div class="panel-foot"><button class="btn btn-main" id="bst-save">${t("Save")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener);
  }
  async function saveBoost(button) {
    const $ = UIx().$, form = $("#bst-form");
    const value = (id) => $(id).value.trim();
    const body = {
      site_id: Number(value("#bst-site")), url: value("#bst-url"), keywords: value("#bst-kws").split("\n").map((x) => x.trim()).filter(Boolean),
      started: value("#bst-start"), ended: value("#bst-end") || null, source: value("#bst-source") || null, billed_text: value("#bst-billed") || null, cost_text: value("#bst-cost") || null, note: value("#bst-note") || null,
    };
    const fail = (words) => { button.disabled = false; UIx().setHTML($("#bst-err"), `<p class="error">${icon("octagon-alert")}<span>${esc(t(words))}</span></p>`); };
    if (!body.url || !body.started) { fail("Needs a start day and a page."); return; }
    button.disabled = true;
    try {
      if (form.dataset.edit) await api("PUT", `backlinks/boosts/${form.dataset.edit}`, body);
      else await api("POST", "backlinks/boosts", body);
    } catch (err) { fail(err.message); return; }
    UIx().closePanel();
    B.boostStamp = Date.now(); // the list and the keyword charts ask again
    if (window.KW_TIMELINE_RESET) window.KW_TIMELINE_RESET();
    UIx().toast(t("Boost saved"));
    redraw();
  }

  /* ---- clicks ---------------------------------------------------------------------------------------------------------------- */
  document.addEventListener("click", async (e) => {
    if (UIx()?.state?.route !== "backlinks") return;
    const hit = (sel) => e.target.closest?.(sel);
    let el;
    if ((el = hit("[data-bgt-open]"))) { const k = el.dataset.bgtOpen; B.open.has(k) ? B.open.delete(k) : B.open.add(k); redraw(); UIx().$(`[data-bgt-open="${CSS.escape(k)}"]`)?.focus({ preventScroll: true }); return; }
    if (hit("[data-bgt-budget]")) { budgetDialog(); return; }
    if ((el = hit("#bgt-budget-save"))) { saveBudget(el); return; }
    if ((el = hit("[data-bgt-edit]"))) { const b = linkOf({ id: Number(el.dataset.bgtEdit) }); if (b) UIx().addBacklinkPanel({ edit: b, site: b.site, src: b.src, target: b.target }, el); return; }
    if ((el = hit("[data-bgt-dup]"))) { const b = linkOf({ id: Number(el.dataset.bgtDup) }); if (b) UIx().addBacklinkPanel({ copy: b, site: b.site }, el); return; }
    if ((el = hit("[data-bgt-del]"))) {
      const b = linkOf({ id: Number(el.dataset.bgtDel) });
      if (!b) return;
      // The Done list's own delete: its dialog, its words, and it updates window.BACKLINKS (mockup.js #bl-delete).
      const proxy = document.createElement("button");
      proxy.id = "bl-delete"; proxy.dataset.id = b.id; proxy.hidden = true;
      document.body.append(proxy); proxy.click(); proxy.remove();
      return;
    }
    if (hit("[data-bst-add]")) { boostPanel(null, false, hit("[data-bst-add]")); return; }
    if ((el = hit("[data-bst-edit]"))) { const b = (B.boostList || []).find((x) => x.id === Number(el.dataset.bstEdit)); if (b) boostPanel(b, true, el); return; }
    if ((el = hit("[data-bst-dup]"))) { const b = (B.boostList || []).find((x) => x.id === Number(el.dataset.bstDup)); if (b) boostPanel({ ...b, started: new Date().toISOString().slice(0, 10), ended: null }, false, el); return; }
    if ((el = hit("[data-bst-del]"))) {
      const b = (B.boostList || []).find((x) => x.id === Number(el.dataset.bstDel));
      if (!b || !(await UIx().confirmDanger({ title: t("Delete this boost?"), body: b.url, yes: "Delete" }))) return;
      try { await api("DELETE", `backlinks/boosts/${b.id}`); } catch (err) { UIx().toast(t(err.message), { kind: "crit" }); return; }
      B.boostStamp = Date.now();
      if (window.KW_TIMELINE_RESET) window.KW_TIMELINE_RESET();
      UIx().toast(t("Boost deleted"));
      redraw();
      return;
    }
    if ((el = hit("#bst-save"))) { saveBoost(el); }
  });

  window.BoughtLinks = { body, boostBody };
})();
