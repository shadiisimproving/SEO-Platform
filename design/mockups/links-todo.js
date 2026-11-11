/* Backlinks: To do. Links chosen from In consideration, on their way to a mediator, until they're placed.
   A To do link is a backlink with status planned. Opened as a plain file, the same steps change the sample in memory. */
(() => {
  "use strict";
  const COMP = window.COMP;
  let UI = null, H = {};
  const T = { mediator: "", sent: "", localSeq: 0 };
  const PAGES = "bl-todo"; // the table's pages and search (table-pages.js), like every long table in the app
  const SENT = { tosend: (b) => !b.sentAt, sent: (b) => Boolean(b.sentAt) };
  const GUEST = /guest|invit/i;

  const planned = () => H.siteLinks().filter((b) => b.status === "planned");
  const needsArticle = (b) => GUEST.test(b.linkType || "") && !b.articleUrl;
  const mediatorNames = () => [...new Set([...window.LinkExtras.names(), ...planned().map((b) => b.mediator).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  const findLink = (id) => window.BACKLINKS.find((b) => b.id === id);
  const isServer = () => H.server();

  function fail(err) { UI.toast(UI.t(err.message), { kind: "crit" }); }

  // ---- the section --------------------------------------------------------------------------------
  function rowHtml(b) {
    const { t, esc, icon } = UI;
    const scores = [b.auth !== null && b.auth !== undefined ? `DA ${b.auth}` : "", b.pageAuthority !== null && b.pageAuthority !== undefined ? `PA ${b.pageAuthority}` : "", b.rating ? `${t("Rating")} ${b.rating}` : ""].filter(Boolean).join(" · ");
    const forSite = UI.state.site === "all" ? `<span class="second">${t("for")} ${esc(b.site)}</span>` : "";
    return `<tr id="todo-${esc(b.id)}" style="cursor:default">
      <td class="head-cell url-cell"><span class="with-logo">${UI.siteLogo(b.domain)}<span class="logo-text"><a class="kw mono small" href="${esc(b.src)}" target="_blank" rel="noopener noreferrer nofollow" data-tip="${esc(b.src)}">${esc(b.src.replace(/^https?:\/\//, ""))}</a>${scores ? `<span class="second tabular">${esc(scores)}</span>` : ""}${forSite}</span></span></td>
      <td data-label="${t("Link type")}"><input class="input td-input" list="td-types" data-td-type="${esc(b.id)}" value="${esc(b.linkType || "")}" aria-label="${t("Link type")}: ${esc(b.domain)}" dir="auto"></td>
      <td data-label="${t("Article")}"><span class="td-article"><input class="input td-input" type="url" inputmode="url" data-td-article="${esc(b.id)}" value="${esc(b.articleUrl || "")}" placeholder="https://docs.google.com/…" aria-label="${t("Article")}: ${esc(b.domain)}" aria-describedby="td-note-${esc(b.id)}"><a class="icon-btn td-open" id="td-open-${esc(b.id)}" href="${esc(b.articleUrl || "#")}" target="_blank" rel="noopener noreferrer" aria-label="${t("Open the article")}" data-tip="${t("Open the article")}" ${b.articleUrl ? "" : "hidden"}>${icon("external-link")}</a></span><span class="second td-note" id="td-note-${esc(b.id)}">${needsArticle(b) ? t("Needs an article") : ""}</span></td>
      <td data-label="${t("Mediator")}"><input class="input td-input" list="td-mediators" data-td-mediator="${esc(b.id)}" value="${esc(b.mediator || "")}" aria-label="${t("Mediator")}: ${esc(b.domain)}" dir="auto"></td>
      <td data-label="${t("Status")}"><select class="select td-input" data-td-sent="${esc(b.id)}" aria-label="${t("Status")}: ${esc(b.domain)}"><option value="" ${b.sentAt ? "" : "selected"}>${t("To send")}</option><option value="sent" ${b.sentAt ? "selected" : ""}>${t("Sent")}</option></select></td>
      <td class="r nowrap" data-label=""><button class="btn btn-small" data-td-placed="${esc(b.id)}">${t("Mark placed")}</button> <button class="icon-btn" style="width:28px;height:28px;vertical-align:middle" data-td-back="${esc(b.id)}" aria-label="${t("Back to In consideration")}: ${esc(b.domain)}" data-tip="${t("Back to In consideration")}">${icon("corner-down-left")}</button></td>
    </tr>`;
  }

  /* The mediator picked, then To send or Sent, then the search: what the table pages through, and what Export takes. */
  const byMediator = () => (T.mediator ? planned().filter((b) => b.mediator === T.mediator) : planned());
  const shownLinks = () => byMediator().filter((b) => (!SENT[T.sent] || SENT[T.sent](b)) && TP.matches(PAGES, b.src, b.domain, b.mediator, b.linkType, b.articleUrl, b.site));

  function body() {
    const { t, esc, num, icon } = UI;
    const all = planned();
    const names = mediatorNames();
    if (T.mediator && !names.includes(T.mediator)) T.mediator = "";
    if (!all.length) return `<div class="table-wrap"><div class="empty"><h3>${t("Nothing to do yet")}</h3><p>${t("Move links here from In consideration, add articles, then send them to your mediator.")}</p></div></div>`;
    const mine = byMediator(), list = shownLinks(), page = TP.view(PAGES, list);
    const toSend = mine.filter((b) => !b.sentAt).length;
    // To send or Sent, with how many each holds for the mediator picked: the counts the line used to give.
    const chips = [["", "All", mine.length], ["tosend", "To send", toSend], ["sent", "Sent", mine.length - toSend]]
      .map(([id, word, n]) => `<button type="button" class="chip" data-td-sent-filter="${id}" aria-pressed="${T.sent === id}">${t(word)}<b>${num(n)}</b></button>`).join("");
    return `<section class="tool-band pr-filters" aria-label="${t("To do")}">
        <button class="btn btn-main" id="td-export">${icon("download")}${t("Export for a mediator")}</button>
        ${TP.search(PAGES, t("Search sites or mediators"))}
        <label class="field td-mediator-filter"><span>${t("Mediator")}</span><select class="select" id="td-filter"><option value="">${t("All mediators")}</option>${names.map((name) => `<option ${T.mediator === name ? "selected" : ""}>${esc(name)}</option>`).join("")}</select></label>
        <span class="pr-end chips td-sent-chips" role="group" aria-label="${t("Status")}">${chips}</span>
      </section>
      <datalist id="td-types">${H.LINK_TYPES.map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist>
      <datalist id="td-mediators">${names.map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist>
      <div class="bl-list"><div class="table-wrap"><table class="data" id="td-table">
        <thead><tr><th scope="col">${t("Site")}</th><th scope="col">${t("Link type")}</th><th scope="col">${t("Article")}</th><th scope="col">${t("Mediator")}</th><th scope="col">${t("Status")}</th><th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead>
        <tbody>${page.rows.map(rowHtml).join("") || `<tr style="cursor:default"><td colspan="6"><div class="empty"><p>${t(mine.length ? "Nothing here with this search or status." : "Nothing here for this mediator.")}</p></div></td></tr>`}</tbody>
      </table></div>
      ${TP.footer(PAGES, page, { noun: t("links") })}</div>
      <p class="help" style="margin-top:10px">${t("Not counted in the cards above or checked until placed.")}</p>`;
  }

  // ---- changing a row -----------------------------------------------------------------------------
  async function saveField(b, input, field, payload, apply) {
    const before = input.dataset.was ?? "";
    try {
      if (isServer()) await COMP.api("PATCH", `backlinks/${b.serverId}/todo`, payload);
      apply();
      input.dataset.was = input.value;
      input.classList.remove("invalid");
    } catch (err) {
      input.value = before; // it wasn't saved, so it mustn't look as though it was
      fail(err);
    }
    paintRowNote(b);
  }

  function paintRowNote(b) {
    const note = document.getElementById(`td-note-${b.id}`);
    if (note) note.textContent = needsArticle(b) ? UI.t("Needs an article") : "";
    const open = document.getElementById(`td-open-${b.id}`);
    if (open) { open.hidden = !b.articleUrl; open.href = b.articleUrl || "#"; }
  }

  async function setSent(links, sent) {
    if (isServer()) await COMP.api("POST", "backlinks/todo/sent", { ids: links.map((b) => b.serverId), sent });
    const stamp = sent ? new Date().toISOString() : null;
    links.forEach((b) => { b.sentAt = stamp; });
  }

  // ---- In consideration to To do ------------------------------------------------------------------
  function openMove(prospects, opener) {
    const { t, esc, num } = UI;
    T.moving = prospects;
    UI.openPanel(`${UI.panelHead(t("Move to To do"), `${num(prospects.length)} ${t(prospects.length === 1 ? "link" : "links")}`)}
      <form class="panel-body" id="td-move-form" novalidate>
        <label class="field"><span>${t("Mediator")} <span class="req">*</span></span><input class="input" id="td-move-mediator" list="td-move-mediators" dir="auto" data-autofocus aria-describedby="td-move-error" maxlength="180"><datalist id="td-move-mediators">${mediatorNames().map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist><div id="td-move-error"></div></label>
        <label class="field"><span>${t("Link type")}</span><input class="input" id="td-move-type" list="td-move-types" dir="auto" value="Guest post" maxlength="100"><datalist id="td-move-types">${H.LINK_TYPES.map((name) => `<option value="${esc(name)}"></option>`).join("")}</datalist></label>
        <p class="help">${t("You add each article's Google Docs link in To do.")}</p>
      </form>
      <div class="panel-foot"><button class="btn btn-main" id="td-move-save">${t("Move")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener);
  }

  function moveLocally(prospects, mediator, linkType) {
    const links = prospects.map((p) => {
      T.localSeq += 1;
      const link = H.localLink(`todo${T.localSeq}`, { src: p.url, mediator, link_type: linkType, owner: p.owner }, p.site, "planned");
      return { ...link, auth: p.authority ?? null, spam: p.spam ?? null, pageAuthority: p.pageAuthority ?? null, rating: p.rating ?? null, articleUrl: null, sentAt: null };
    });
    window.BACKLINKS = links.concat(window.BACKLINKS);
    const gone = new Set(prospects);
    window.PROSPECTS = window.PROSPECTS.filter((p) => !gone.has(p));
    return { count: links.length, skipped: 0, undo: async () => {
      const made = new Set(links);
      window.BACKLINKS = window.BACKLINKS.filter((b) => !made.has(b));
      window.PROSPECTS = prospects.concat(window.PROSPECTS);
    } };
  }

  async function moveOnServer(prospects, mediator, linkType) {
    const answer = await COMP.api("POST", "backlinks/todo/move", { prospect_ids: prospects.map((p) => p.serverId), mediator, link_type: linkType });
    H.takeProspects(answer.prospects_removed);
    await H.reload();
    return { count: answer.saved.length, skipped: answer.skipped.length, undo: async () => {
      const back = await COMP.api("POST", "backlinks/todo/move-back", { ids: answer.saved.map((row) => row.id), details: answer.details });
      absorbBack(back.prospects);
      await H.reload();
    } };
  }

  function absorbBack(rows) {
    const bySite = new Map();
    rows.forEach((row) => { if (!bySite.has(row.site_id)) bySite.set(row.site_id, []); bySite.get(row.site_id).push(row); });
    bySite.forEach((list, siteId) => COMP.absorbProspects(list, H.hostOfSite(siteId)));
  }

  async function saveMove(button) {
    const { t, num } = UI;
    const mediator = UI.$("#td-move-mediator").value.trim(), linkType = UI.$("#td-move-type").value.trim();
    const say = (message) => { UI.$("#td-move-mediator").classList.add("invalid"); UI.setHTML(UI.$("#td-move-error"), `<div class="error" role="alert">${UI.icon("octagon-alert")}<span>${UI.esc(t(message))}</span></div>`); UI.$("#td-move-mediator").focus(); };
    if (!mediator) { say("Choose a mediator."); return; }
    button.disabled = true;
    try {
      const done = isServer() ? await moveOnServer(T.moving, mediator, linkType) : moveLocally(T.moving, mediator, linkType);
      H.clearPicks();
      UI.forgetPanelForm();
      UI.closePanel();
      UI.ignoreClicks();
      T.mediator = "";
      UI.state.blSection = "todo";
      UI.render();
      const words = `${num(done.count)} ${t(done.count === 1 ? "link moved to To do" : "links moved to To do")}${done.skipped ? `. ${num(done.skipped)} ${t("already logged, left in place")}` : ""}`;
      UI.toast(words, done.count ? { undo: async () => { try { await done.undo(); } catch (err) { fail(err); } UI.render(); } } : { kind: "info" });
    } catch (err) {
      button.disabled = false;
      say(err.message);
    }
  }

  async function moveBack(b, button) {
    button.disabled = true;
    try {
      if (isServer()) {
        const back = await COMP.api("POST", "backlinks/todo/move-back", { ids: [b.serverId] });
        absorbBack(back.prospects);
        await H.reload();
      } else {
        T.localSeq += 1;
        window.BACKLINKS = window.BACKLINKS.filter((x) => x !== b);
        window.PROSPECTS.unshift({ id: `back${T.localSeq}`, url: b.src, domain: b.domain, authority: b.auth ?? null, pageAuthority: b.pageAuthority ?? null, spam: b.spam ?? null, site: b.site, rating: b.rating ?? null, owner: b.owner || "", stage: "new", file: "" });
      }
      UI.render();
      UI.toast(`${b.domain}: ${UI.t("back in In consideration")}`, { kind: "info" });
    } catch (err) { button.disabled = false; fail(err); }
  }

  // ---- export -------------------------------------------------------------------------------------
  function groups() {
    const by = new Map();
    planned().forEach((b) => {
      const name = b.mediator || "";
      if (!by.has(name)) by.set(name, []);
      by.get(name).push(b);
    });
    return [...by.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  }

  function openExport(opener) {
    const { t, esc, num, icon } = UI;
    const rows = groups().map(([name, links], at) => {
      if (!name) return `<div class="td-group"><div><b>${t("No mediator")}</b><div class="small sec">${num(links.length)} ${t(links.length === 1 ? "link" : "links")}. ${t("Give them a mediator first.")}</div></div></div>`;
      const toSend = links.filter((b) => !b.sentAt), missing = toSend.filter(needsArticle).length, sent = links.length - toSend.length;
      return `<div class="td-group"><div><b dir="auto">${esc(name)}</b><div class="small sec">${num(toSend.length)} ${t("to send")}${sent ? ` · ${num(sent)} ${t("sent")}` : ""}</div>${missing ? `<div class="small warn td-missing">${icon("triangle-alert")}${num(missing)} ${t(missing === 1 ? "guest post has no article link" : "guest posts have no article link")}</div>` : ""}</div>
        <span class="td-group-acts">${toSend.length ? `<button class="btn btn-main btn-small" data-td-export="${at}">${icon("download")}${t("Export")} ${num(toSend.length)}</button>` : ""}${sent ? `<button class="link-btn" data-td-export-again="${at}">${t(toSend.length ? "Include sent" : "Download again")}</button>` : ""}</span></div>`;
    }).join("");
    UI.openPanel(`${UI.panelHead(t("Export for a mediator"), t("One file each: site, link type, article."))}
      <div class="panel-body">
        <p class="note">${icon("info")}<span>${t("Set each Google Doc to \"Anyone with the link can view\" first, or the mediator can't open it.")}</span></p>
        ${rows}
      </div>
      <div class="panel-foot"><button class="btn" data-discard-panel>${t("Close")}</button></div>`, opener);
  }

  const csvCell = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`; // a cell can't turn into a formula in Excel
  };

  function downloadCsv(name, links) {
    const lines = [["Site", "Link type", "Article"], ...links.map((b) => [b.domain, b.linkType || "", b.articleUrl || ""])];
    const url = URL.createObjectURL(new Blob(["﻿", lines.map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    const safe = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "mediator";
    a.href = url;
    a.download = `links-for-${safe}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function runExport(at, includeSent, button) {
    const { t, num } = UI;
    const [name, links] = groups()[at] || [];
    if (!name) return;
    const toSend = links.filter((b) => !b.sentAt);
    const file = includeSent ? links : toSend;
    button.disabled = true;
    downloadCsv(name, file);
    try {
      if (toSend.length) await setSent(toSend, true);
      UI.forgetPanelForm();
      UI.closePanel();
      UI.ignoreClicks();
      UI.render();
      if (toSend.length) {
        UI.toast(`${num(toSend.length)} ${t(toSend.length === 1 ? "link marked Sent" : "links marked Sent")}`, { undo: async () => {
          try { await setSent(toSend, false); } catch (err) { fail(err); }
          UI.render();
        } });
      } else UI.toast(t("File downloaded"), { kind: "info" });
    } catch (err) {
      button.disabled = false;
      UI.toast(`${t("Downloaded, but not marked as Sent.")} ${t(err.message)}`, { kind: "crit" });
    }
  }

  // ---- placed -------------------------------------------------------------------------------------
  function openPlaced(b, opener) {
    const { t, esc } = UI;
    T.placing = b;
    UI.openPanel(`${UI.panelHead(t("Mark placed"), b.domain)}
      <form class="panel-body" id="td-placed-form" novalidate>
        <label class="field"><span>${t("Published address")} <span class="req">*</span></span><input class="input mono" id="td-live-url" type="url" inputmode="url" placeholder="https://" data-autofocus aria-describedby="td-live-error" value="${esc(b.src)}"><div id="td-live-error"></div></label>
        <p class="help">${t("The exact page it's published on; the monthly check reads it.")}${UI.tip("The page where the article was published. The monthly check reads this page to see that your link is still there, so it must be the exact address.")}</p>
      </form>
      <div class="panel-foot"><button class="btn btn-main" id="td-placed-save">${t("Move to Done")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener);
    const input = UI.$("#td-live-url");
    input?.select();
  }

  async function savePlaced(button) {
    const { t } = UI;
    const b = T.placing, address = UI.$("#td-live-url").value.trim();
    const say = (message) => { UI.$("#td-live-url").classList.add("invalid"); UI.setHTML(UI.$("#td-live-error"), `<div class="error" role="alert">${UI.icon("octagon-alert")}<span>${UI.esc(t(message))}</span></div>`); UI.$("#td-live-url").focus(); };
    if (!address) { say("Paste the article's address."); return; }
    button.disabled = true;
    try {
      if (isServer()) {
        await COMP.api("POST", `backlinks/${b.serverId}/placed`, { live_url: address });
        await H.reload();
      } else {
        if (!/^https?:\/\/\S+\.\S+/i.test(address)) throw new Error("The article's address must start with https://.");
        Object.assign(b, { src: address, status: "live", placed: new Date().toISOString().slice(0, 10) });
      }
      UI.forgetPanelForm();
      UI.closePanel();
      UI.ignoreClicks();
      UI.render();
      UI.toast(`${b.domain}: ${t("Live in Done")}`);
    } catch (err) {
      button.disabled = false;
      say(err.message);
    }
  }

  // ---- events -------------------------------------------------------------------------------------
  function bind() {
    document.addEventListener("click", (e) => {
      const target = e.target;
      let el;
      if ((el = target.closest?.("#td-export"))) { openExport(el); return; }
      if ((el = target.closest?.("[data-td-sent-filter]"))) { T.sent = el.dataset.tdSentFilter; TP.reset(PAGES); UI.render(); UI.$(`[data-td-sent-filter="${T.sent}"]`)?.focus(); return; }
      if ((el = target.closest?.("[data-td-export]"))) { runExport(Number(el.dataset.tdExport), false, el); return; }
      if ((el = target.closest?.("[data-td-export-again]"))) { runExport(Number(el.dataset.tdExportAgain), true, el); return; }
      if ((el = target.closest?.("[data-td-placed]"))) { const b = findLink(el.dataset.tdPlaced); if (b) openPlaced(b, el); return; }
      if ((el = target.closest?.("[data-td-back]"))) { const b = findLink(el.dataset.tdBack); if (b) moveBack(b, el); return; }
      if ((el = target.closest?.("#td-move-save"))) { if (!el.disabled) saveMove(el); return; }
      if ((el = target.closest?.("#td-placed-save"))) { if (!el.disabled) savePlaced(el); }
    });
    document.addEventListener("submit", (e) => {
      if (e.target.id === "td-move-form") { e.preventDefault(); UI.$("#td-move-save")?.click(); }
      if (e.target.id === "td-placed-form") { e.preventDefault(); UI.$("#td-placed-save")?.click(); }
    });
    // What a field held when someone started typing, to go back to if the server refuses it.
    document.addEventListener("focusin", (e) => {
      const el = e.target;
      if (el.dataset?.tdArticle || el.dataset?.tdType || el.dataset?.tdMediator) el.dataset.was = el.value;
    });
    document.addEventListener("change", (e) => {
      const el = e.target;
      if (el.id === "td-filter") { T.mediator = el.value; TP.reset(PAGES); UI.render(); UI.$("#td-filter")?.focus(); return; }
      const id = el.dataset?.tdArticle || el.dataset?.tdType || el.dataset?.tdMediator || el.dataset?.tdSent;
      if (!id) return;
      const b = findLink(id);
      if (!b) return;
      const value = el.value.trim();
      if (el.dataset.tdArticle) { saveField(b, el, "article", { article_url: value || null }, () => { b.articleUrl = value || null; }); return; }
      if (el.dataset.tdType) { saveField(b, el, "type", { link_type: value || null }, () => { b.linkType = value || null; }); return; }
      if (el.dataset.tdMediator) {
        if (!value) { el.value = el.dataset.was || ""; fail(new Error("Choose a mediator.")); return; }
        saveField(b, el, "mediator", { mediator: value }, () => { b.mediator = value; window.LinkExtras.load(); });
        return;
      }
      setSent([b], el.value === "sent").catch((err) => { el.value = b.sentAt ? "sent" : ""; fail(err); });
    });
  }

  window.LinkTodo = {
    init(helpers, extras) { UI = helpers; H = extras; bind(); TP.on(PAGES, () => UI.render()); },
    body, openMove, count: () => planned().length,
    seen: () => ({ ids: shownLinks().map((b) => b.id), mediator: T.mediator || "" }), // export.js: the rows as filtered and searched, every page
  };

  const fr = {
    "To do": "À faire", "Article": "Article", "Open the article": "Ouvrir l'article", "Needs an article": "Article manquant", "To send": "À envoyer", "Sent": "Envoyé", "to send": "à envoyer", "sent": "envoyés",
    "Mark placed": "Marquer placé", "Back to In consideration": "Remettre à l'étude", "back in In consideration": "de nouveau à l'étude",
    "Nothing to do yet": "Rien à faire pour l'instant", "Move links here from In consideration, add articles, then send them to your mediator.": "Déplacez ici des liens à l'étude, ajoutez les articles, puis envoyez-les à votre intermédiaire.",
    "Export for a mediator": "Exporter pour un intermédiaire", "All mediators": "Tous les intermédiaires", "Nothing here for this mediator.": "Rien pour cet intermédiaire.", "Not counted in the cards above or checked until placed.": "Ni comptés dans les cartes ci-dessus, ni contrôlés avant d'être placés.",
    "Move to To do": "Déplacer vers À faire", "Move": "Déplacer", "link": "lien", "links": "liens", "You add each article's Google Docs link in To do.": "Vous ajoutez le lien Google Docs de chaque article dans À faire.", "Choose a mediator.": "Choisissez un intermédiaire.",
    "link moved to To do": "lien déplacé vers À faire", "links moved to To do": "liens déplacés vers À faire", "already logged, left in place": "déjà enregistrés, laissés en place",
    "No mediator": "Sans intermédiaire", "Give them a mediator first.": "Attribuez-leur d'abord un intermédiaire.", "guest post has no article link": "article invité sans lien", "guest posts have no article link": "articles invités sans lien", "Export": "Exporter", "Include sent": "Inclure les envoyés", "Download again": "Télécharger de nouveau",
    "One file each: site, link type, article.": "Un fichier chacun : site, type de lien, article.", "Set each Google Doc to \"Anyone with the link can view\" first, or the mediator can't open it.": "Réglez d'abord chaque Google Doc sur « Tous les utilisateurs disposant du lien peuvent consulter », sinon l'intermédiaire ne pourra pas l'ouvrir.",
    "link marked Sent": "lien marqué envoyé", "links marked Sent": "liens marqués envoyés", "File downloaded": "Fichier téléchargé", "Downloaded, but not marked as Sent.": "Téléchargé, mais pas marqué comme envoyé.",
    "Published address": "Adresse publiée", "The exact page it's published on; the monthly check reads it.": "La page exacte où il est publié ; le contrôle mensuel la lit.", "Move to Done": "Déplacer vers Réalisés", "Paste the article's address.": "Collez l'adresse de l'article.", "Live in Done": "actif dans Réalisés", "The article's address must start with https://.": "L'adresse de l'article doit commencer par https://.", "The article link must start with https://.": "Le lien de l'article doit commencer par https://.",
    "selected": "sélectionnés", "Select": "Sélectionner", "Already in To do": "Déjà dans À faire",
    "Search sites or mediators": "Rechercher un site ou un intermédiaire", "Nothing here with this search or status.": "Rien ici avec cette recherche ou ce statut.",
  };
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
