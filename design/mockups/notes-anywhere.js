/* Notes from anywhere: a Notes button on every screen, and the N key, open the Notes panel beside what you're looking at.

   The panel offers what the note can be about, what's on screen first:
     - this competitor or this page, when the screen shows one (a [data-notes-open] button in the page says so);
     - this screen (Backlinks, Keywords…);
     - the whole website picked in the side menu, and all my sites;
     - any page, group of pages, keyword, day, linking website, task or competitor, picked from a list or typed ("pick" choices, on their own row);
     - and All notes, with a search.
   The notes themselves, their saving, drafts and files, all live in comp-notes.js. This file only opens the panel. */
(() => {
  "use strict";
  const COMP = window.COMP;
  const UI = () => window.UI;
  let typedInPanel = false;

  /* A page's own Notes button carries its choices: [{ label, icon, where }]. */
  const readChoices = (el) => { try { const list = JSON.parse(el.dataset.notesOpen); return Array.isArray(list) ? list : []; } catch { return []; } };

  /* What the note can be about here, the things on screen first. */
  function choices(opener) {
    const ui = UI(), { t } = ui;
    // A row's note icon is about that row, not about the screen: only the page's own Notes button says what's on screen.
    const here = opener?.dataset?.notesOpen ? opener : ui.$("#main [data-notes-open]:not([data-notes-light])");
    const list = here ? readChoices(here).map((c) => ({ ...c, icon: c.icon || (c.where.scope === "page" ? "file-text" : "crosshair") })) : [];
    const site = ui.siteIdPicked();
    const route = ui.state.route;
    const name = COMP.notes.screenName(route);
    if (name && name !== route) list.push({ id: "screen", label: t("{name} screen").replace("{name}", name), icon: "layout-dashboard", where: { scope: "screen", screen: route, siteId: site } });
    const host = ui.siteHostPicked();
    // Chosen access without every site: a note is always for one of their sites (one for every site is the owner's).
    const partial = window.ACCESS?.limited && !window.ACCESS.everySite();
    if (partial && !host) {
      for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].where && list[i].where.siteId == null) list.splice(i, 1);
      window.SITES.filter((s) => s.realId).forEach((s) => list.push({ id: `site-${s.realId}`, label: s.host, icon: "globe", where: { scope: "site", siteId: s.realId } }));
    } else {
      list.push({ id: "site", label: host || t("All my sites"), icon: "globe", where: { scope: "site", siteId: site } });
      if (host && !partial) list.push({ id: "everywhere", label: t("All my sites"), icon: "layers", where: { scope: "site", siteId: null } });
    }
    // Anything else: picked from a list. The page's own buttons already offer what's on screen, so these come after.
    list.push(
      { id: "pick-page", pick: "page", label: t("A page"), icon: "file-text", where: { scope: "page", pageUrl: null, siteId: site } },
      { id: "pick-section", pick: "section", label: t("A folder"), icon: "folder-open", where: { scope: "section", pageUrl: null, siteId: site } },
      { id: "pick-keyword", pick: "keyword", label: t("A keyword"), icon: "key-round", where: { scope: "keyword", keyword: null, siteId: site } },
      { id: "pick-date", pick: "date", label: t("A date"), icon: "calendar-days", where: { scope: "date", day: null, siteId: site } },
      { id: "pick-domain", pick: "domain", label: t("A linking website"), icon: "link-2", where: { scope: "domain", domain: null, siteId: site } },
      { id: "pick-task", pick: "task", label: t("A task"), icon: "square-check", where: { scope: "task", taskId: null, task: null, siteId: site } },
      { id: "pick-competitor", pick: "competitor", label: t("A competitor"), icon: "crosshair", where: { scope: "competitor", competitorId: null, competitor: null, siteId: site } },
    );
    return list;
  }

  function open(opener, pick = 0) {
    const ui = UI();
    if (!ui || !COMP.notes?.panel) return;
    const current = ui.$("#panel");
    if (current?.classList.contains("nb-panel-wrap")) { ui.closePanel(); return; } // the button and N also close it
    if (current?.querySelector("form")) { ui.toast(ui.t("Close the open panel first."), { kind: "info" }); return; }
    typedInPanel = false;
    COMP.notes.panel(choices(opener), opener || button(), pick);
  }

  function button() {
    let el = document.getElementById("nb-fab");
    if (el) return el;
    const ui = UI();
    el = document.createElement("button");
    el.id = "nb-fab";
    el.type = "button";
    el.className = "btn nb-fab";
    el.setAttribute("aria-label", ui.t("Notes (N key)"));
    el.dataset.tip = ui.t("Notes (N key)");
    ui.setHTML(el, `${ui.icon("pencil")}<span>${ui.t("Notes")}</span>`);
    document.body.append(el);
    return el;
  }

  const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const dialogOpen = () => Boolean(document.querySelector("dialog[open]"));

  function start() {
    const ui = UI();
    if (!ui || !COMP?.notes) return;
    if (window.ACCESS && !window.ACCESS.can("notes")) return; // no Notes section: no Notes button, no N key
    if (!document.querySelector("#main")) { setTimeout(start, 200); return; } // the sign-in screen has no app yet
    button();
    document.addEventListener("click", (e) => {
      const fab = e.target.closest?.("#nb-fab");
      if (fab) { open(fab); return; }
      const opener = e.target.closest?.("[data-notes-open]");
      if (opener) open(opener, 0);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "n" && e.key !== "N") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || typing(e.target) || dialogOpen()) return;
      e.preventDefault();
      open(null);
    });
    document.addEventListener("input", (e) => { if (e.target.closest?.(".nb-panel")) typedInPanel = true; });
    // Another panel took the Notes panel's place: say the words are safe. They are, through the drafts and the save on leaving.
    const root = document.getElementById("panel-root");
    if (root) {
      let wasNotes = false;
      new MutationObserver(() => {
        const now = root.querySelector("#panel");
        const isNotes = Boolean(now?.classList.contains("nb-panel-wrap"));
        document.body.classList.toggle("nb-beside-panel", Boolean(now)); // the button moves beside an open panel, so it stays in reach
        if (wasNotes && now && !isNotes && typedInPanel) ui.toast(ui.t("Note saved"), { kind: "info" });
        if (now) wasNotes = isNotes || (wasNotes && !now);
        if (!now) wasNotes = false;
        if (!isNotes && now) typedInPanel = false;
      }).observe(root, { childList: true, subtree: false });
    }
    refreshCounts();
  }

  /* "Notes · 2" buttons in a page fill in their count once the notes for that target are known. */
  function refreshCounts() {
    const ui = UI();
    ui.$$("[data-notes-open]").forEach((el) => {
      if (el.dataset.notesCounted) return;
      el.dataset.notesCounted = "1";
      if (el.dataset.notesLight) COMP.notes.loadAllOnce(); // a row's badge: one load for the whole table
      else readChoices(el).forEach((c) => COMP.notes.preload(c.where));
    });
  }
  let countsQueued = false;
  new MutationObserver(() => {
    if (countsQueued || !window.UI || !COMP?.notes) return;
    countsQueued = true;
    requestAnimationFrame(() => { countsQueued = false; refreshCounts(); });
  }).observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  COMP.notesAnywhere = { open };
})();
