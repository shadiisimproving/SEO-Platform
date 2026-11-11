/* Notes, in the side menu: every note of every website in one list, newest first.

   A search, and chips for what the notes are about (pages, keywords, competitors…), each with its count. Only kinds
   that hold a note get a chip. The rows are the same ones as everywhere else: the words can be changed in place and
   save by themselves, and the line above each says what it's about and for which website, as a link where it can be.
   The notes, their saving, drafts and files live in comp-notes.js. This file only draws the screen around them. */
(() => {
  "use strict";
  const COMP = window.COMP;
  let UI = null;
  const V = { kind: "", loadedAt: 0, loading: false, failed: false };
  const FRESH_MS = 20000; // opening the screen again within this asks the server nothing

  const every = () => COMP.notes?.every;

  function chipsHtml() {
    const { t, esc, icon, num } = UI;
    const counts = every().kindCounts();
    const chip = (id, label, name, n) => `<button class="chip nb-way" data-nv-kind="${esc(id)}" aria-pressed="${V.kind === id}">${name ? icon(name) : ""}${esc(t(label))}<b>${num(n)}</b></button>`;
    const kinds = every().KINDS.filter(([id]) => counts.get(id) || V.kind === id).map(([id, label, name]) => chip(id, label, name, counts.get(id) || 0));
    return kinds.length > 1 || V.kind ? chip("", "All", "", every().total()) + kinds.join("") : "";
  }

  /* Everything around the list. The list itself is painted by comp-notes.js, which keeps rows that are already there. */
  function paintChrome() {
    if (!UI || UI.state.route !== "notes" || !UI.$("#nv-list")) return;
    const { t, num } = UI;
    const total = every().total(), shown = every().shown(V.kind);
    const filtered = Boolean(V.kind || every().search().trim());
    const count = UI.$("#nv-count");
    if (count) count.textContent = filtered ? `${num(shown)} ${t("of")} ${num(total)}` : num(total);
    const chips = UI.$("#nv-kinds");
    if (chips) { const html = chipsHtml(); UI.setHTML(chips, html); chips.hidden = !html; }
    const empty = UI.$("#nv-empty");
    if (!empty) return;
    if (V.loading && !total) UI.setHTML(empty, UI.skeleton("rows", { rows: 4 }));
    else if (!total && !V.failed) {
      UI.setHTML(empty, `<div class="empty"><h3>${t("No notes yet")}</h3><p>${t("Press N on any screen, or Write a note.")}${UI.tip("Notes on a page, a keyword, a competitor or a day all show here.")}</p></div>`);
    } else if (total && !shown) UI.setHTML(empty, `<p class="lc-none small muted nv-none">${t("No notes match this search.")}</p>`);
    else UI.setHTML(empty, "");
  }

  async function load() {
    if (V.loading) return;
    V.loading = true;
    paintChrome();
    try { await every().loadEvery(); V.failed = false; V.loadedAt = Date.now(); } catch { V.failed = true; }
    V.loading = false;
    if (UI.state.route !== "notes") return;
    const warn = UI.$("#nv-error");
    if (warn) warn.hidden = !V.failed;
    every().paint();
    paintChrome();
  }

  function page() {
    const { t, esc, icon, topbar } = UI;
    const head = topbar(t("Notes"), t("Every note, on every site"), `<button class="btn btn-main" id="nv-write" aria-label="${t("Write a note")}">${icon("plus")}${t("Write a note")}</button>`, false);
    if (!every()) return `${head}<div class="content page-enter">${UI.skeleton("table", { rows: 4 })}</div>`;
    return `${head}<div class="content page-enter">
      <section class="card nb-all nv-card">
        <div class="card-head"><h2>${t("All notes")}</h2><span class="small muted tabular" id="nv-count"></span>
          <label class="nb-search end"><span class="sr">${t("Search notes")}</span>${icon("search")}<input class="input" id="nv-search" type="search" placeholder="${t("Search notes")}" value="${esc(every().search())}"></label></div>
        <div class="nb-ways nv-kinds" id="nv-kinds" role="group" aria-label="${t("What the notes are about")}" hidden></div>
        <p class="note warn nb-load-error" id="nv-error" ${V.failed ? "" : "hidden"}>${icon("triangle-alert")}<span>${t("Notes didn't load. What you write is still kept.")}</span></p>
        <ul class="nb-list" id="nv-list" data-note-list="*" data-note-kind="${esc(V.kind)}" data-note-every-site></ul>
        <div id="nv-empty"></div>
      </section>
    </div>`;
  }

  function after() {
    if (!every()) return;
    every().paint();
    paintChrome();
    if (Date.now() - V.loadedAt > FRESH_MS) load();
  }

  function bind() {
    document.addEventListener("click", (e) => {
      if (UI.state.route !== "notes") return;
      const chip = e.target.closest?.("[data-nv-kind]");
      if (chip) {
        V.kind = chip.dataset.nvKind;
        const list = UI.$("#nv-list");
        if (list) list.dataset.noteKind = V.kind;
        every().paint();
        paintChrome();
        UI.$(`[data-nv-kind="${V.kind}"]`)?.focus({ preventScroll: true }); // the chips were drawn again
        return;
      }
      const write = e.target.closest?.("#nv-write");
      if (write) COMP.notesAnywhere?.open(write);
    });
    document.addEventListener("input", (e) => {
      if (e.target.id !== "nv-search") return;
      every().setSearch(e.target.value);
      every().paint();
      paintChrome();
    });
    // A note written in the panel, deleted, or saved: the counts follow.
    document.addEventListener("seocc:notes-painted", () => paintChrome());
  }

  window.SCREENS = window.SCREENS || {};
  window.SCREENS.notes = { init(helpers) { UI = helpers; bind(); }, page, after };

  const words = {
    "Notes": "Notes", "Every note, on every site": "Toutes les notes, sur tous les sites", "Write a note": "Écrire une note",
    "All": "Toutes", "Pages": "Pages", "Keywords": "Mots-clés", "Competitors": "Concurrents", "Linking websites": "Sites qui font des liens",
    "Tasks": "Tâches", "Days": "Jours", "Screens": "Écrans", "Websites": "Sites", "Sites": "Sites", "What the notes are about": "Sur quoi portent les notes",
    "Press N on any screen, or Write a note.":
      "Appuyez sur N sur n'importe quel écran, ou sur Écrire une note.",
  };
  Object.keys(words).forEach((w) => { if (window.FR[w] === undefined) window.FR[w] = words[w]; });
})();
