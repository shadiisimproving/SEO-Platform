/* Competitors area: notes on all competitors, on one competitor, on any page or keyword.

   "Always saved" is the point of this file. There's no Save button. Every keystroke goes to UI.store first, under
   one drafts key. A pause of 800 ms saves to the server, and so does leaving the field. A draft goes away only once
   the server has confirmed that exact text. A failed save tries again every 5 seconds and on the online event.
   Leaving the page sends what's left with fetch keepalive, and a draft found on the next load is checked against
   the server, then saved.

   Other tabs: COMP.notes.block({ scope, competitorId, pageUrl, title }) in body(), COMP.notes.mount() in after().
   All state lives here, not in the page, so a repaint can't lose typing. A note's words reach its field through
   .value, never through markup, so they can hold anything: "<title>", a leading line break, Arabic.

   A note can also hold images and files: pasted, dropped, or chosen with the button. A file can't wait in a draft on
   this computer, so it goes straight to the server, and if it can't get there the person is told at once. */
(() => {
  "use strict";
  const COMP = window.COMP;
  let UI = null;
  let serverMode = null; // known soon after start. Until then, writes wait for it.

  const PAUSE_MS = 800, RETRY_MS = 5000, RECONCILE_MS = 700, MAX_BYTES = 4000000, KEEPALIVE_CHARS = 20000, MAX_FILE_BYTES = 25 * 1024 * 1024;
  const DRAFTS_KEY = "note-drafts", SAMPLE_KEY = "notes-sample", TAB = "tab", ALL_NOTES = "*";
  // The same list as notes.SCREENS on the server: the side menu's screens.
  const SCREEN_NAMES = {
    today: "Today", channels: "Channels", conversions: "Conversions", content: "Content", overview: "Overview", keywords: "Keywords", competitors: "Competitors",
    ai: "AI search", ads: "Google Ads", tasks: "Tasks", backlinks: "Backlinks", resources: "Resources", health: "Site health", settings: "Settings",
  };

  // ---- the notes -------------------------------------------------------------------------------
  /* Every note this page knows about, and every note still being written, by uid. One entry per note, wherever it shows. */
  const entries = new Map();
  const composers = new Map(); // which entry is the "new note" field of each target
  let uidCounter = 0;

  const blank = (text) => !String(text ?? "").trim();
  const holdsFiles = (e) => e.uploading > 0 || e.files.some((f) => !f.removed);
  const dirty = (e) => e.text !== e.saved;
  const stamp = (iso) => (iso ? new Date(iso).getTime() : 0);
  const byId = (id) => [...entries.values()].find((e) => e.id === id) || null;
  const whereOf = (e) => ({ scope: e.scope, competitorId: e.competitorId, competitor: e.competitor, pageUrl: e.pageUrl, siteId: e.siteId, screen: e.screen, keyword: e.keyword, day: e.day, domain: e.domain, taskId: e.taskId, task: e.task });
  const siteOf = (siteId) => (typeof siteId === "number" ? siteId : null);
  const withScheme = (url) => { const text = String(url || "").trim(); return text && !text.includes("://") ? `https://${text}` : text; };
  /* A keyword as the server compares it: case and spacing don't make another keyword. */
  const keywordKey = (word) => String(word || "").normalize("NFKC").replace(/[\u200b\u200e\u200f\ufeff]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  /* A screen, keyword or website note belongs to one site, or to all of them when no site is picked ("*"). */
  const targetKey = (scope, competitorId, pageUrl, screen = null, siteId = null, keyword = null, extra = {}) => {
    if (scope === "competitor") return `competitor|${competitorId}`;
    if (scope === "section") return `section|${pageUrl}`;
    if (scope === "task") return `task|${extra.taskId}`;
    if (scope === "date") return `date|${extra.day}|${siteOf(siteId) ?? "*"}`;
    if (scope === "domain") return `domain|${String(extra.domain || "").toLowerCase().replace(/^www\./, "")}`; // one contact for every site
    if (scope === "keyword") return `keyword|${keywordKey(keyword)}|${siteOf(siteId) ?? "*"}`;
    if (scope === "page") return `page|${pageUrl}`;
    if (scope === "site") return `site|${siteOf(siteId) ?? "*"}`;
    if (scope === "screen") return `screen|${screen}|${siteOf(siteId) ?? "*"}`;
    return "all";
  };
  const keyOf = (w) => targetKey(w.scope, w.competitorId, w.pageUrl, w.screen, w.siteId, w.keyword, w);
  const pathFor = (w) => {
    const site = siteOf(w.siteId) === null ? "" : `&site_id=${w.siteId}`;
    if (w.scope === "competitor") return `notes?competitor_id=${w.competitorId}`;
    if (w.scope === "page") return `notes?page_url=${encodeURIComponent(withScheme(w.pageUrl))}`;
    if (w.scope === "site") return `notes?scope=site${site}`;
    if (w.scope === "keyword") return `notes?scope=keyword&keyword=${encodeURIComponent(w.keyword || "")}${site}`;
    if (w.scope === "section") return `notes?scope=section&page_url=${encodeURIComponent(w.pageUrl || "")}`;
    if (w.scope === "task") return `notes?task_id=${w.taskId}`;
    if (w.scope === "date") return `notes?scope=date&day=${encodeURIComponent(w.day || "")}${site}`;
    if (w.scope === "domain") return `notes?scope=domain&domain=${encodeURIComponent(w.domain || "")}`;
    if (w.scope === "screen") return `notes?scope=screen&screen=${encodeURIComponent(w.screen || "")}${site}`;
    return "notes?scope=all";
  };

  function newEntry(fields) {
    const e = {
      uid: `n${++uidCounter}`, id: null, scope: "all", competitorId: null, competitor: null, pageUrl: null, siteId: null, screen: null, keyword: null, day: null, domain: null, taskId: null, task: null,
      text: "", saved: "", updatedAt: null, createdAt: null, sortAt: Date.now(), at: 0, base: null,
      status: "idle", message: "", savedAt: null, timer: null, busy: false, again: false, sending: null, sent: null,
      composer: null, targets: new Set(), removed: false, leftover: false, needsRestore: false, inflight: null, files: [], uploading: 0, uploadingNames: [],
      ...fields,
    };
    entries.set(e.uid, e);
    return e;
  }

  function composerFor(key, where) {
    let e = composers.get(key);
    if (!e || e.composer !== key) {
      e = newEntry({ ...where, composer: key });
      composers.set(key, e);
    } else if (!e.id) Object.assign(e, where);
    return e;
  }

  /* What the server said. An entry with unsaved words keeps them: the server's copy only replaces clean text. */
  function ingest(notes, key) {
    const seen = new Set();
    notes.forEach((n) => {
      let e = byId(n.id);
      if (!e) {
        // A draft whose first save reached the server, though the answer never came back.
        e = [...entries.values()].find((x) => !x.id && x.leftover && x.scope === n.scope && (x.competitorId ?? null) === (n.competitor_id ?? null) && (n.body === x.text || (x.sent && n.body === x.sent))) || null;
        if (e) { e.id = n.id; e.leftover = false; e.saved = n.body; e.status = dirty(e) ? "saving" : "idle"; e.savedAt = dirty(e) ? null : new Date(stamp(n.updated_at)); }
      }
      let take = true; // the server's text and version replace what's here
      if (!e) e = newEntry({ id: n.id, text: n.body, saved: n.body, sortAt: stamp(n.updated_at) });
      else {
        // An answer that left before this person's own save (F122), a field someone is in, or unsaved words: the copy here stays,
        // and so does its version, so a teammate's newer text is caught as a clash on the next save instead of being overwritten.
        const older = e.updatedAt && stamp(n.updated_at) < stamp(e.updatedAt);
        take = !older && !dirty(e) && !e.leftover && !isFocused(e) && e.status !== "clash";
        if (take) { e.text = n.body; e.saved = n.body; fieldsFor(e).forEach((el) => fill(el, e)); }
      }
      Object.assign(e, { scope: n.scope, competitorId: n.competitor_id, competitor: n.competitor, pageUrl: n.page_url, siteId: n.site_id, screen: n.screen ?? null, keyword: n.keyword ?? null, day: n.day ?? null, domain: n.domain ?? null, taskId: n.task_id ?? null, task: n.task ?? null, createdAt: n.created_at, createdBy: n.created_by ?? null });
      if (take) Object.assign(e, { updatedAt: n.updated_at, updatedBy: n.updated_by ?? null });
      if (n.files) { e.files = n.files; paintFiles(e); }
      if (!isFocused(e) && !e.composer) e.sortAt = stamp(n.updated_at);
      if (key) e.targets.add(key);
      seen.add(e);
    });
    // Gone from the server, and nothing unsaved in it, so it goes from here too.
    entries.forEach((e) => { if (e.id && !seen.has(e) && (key === ALL_NOTES || e.targets.has(key)) && !dirty(e) && !e.removed && !e.busy && !e.composer) entries.delete(e.uid); });
    writeDrafts();
  }

  // ---- drafts on this computer ----------------------------------------------------------------
  function writeDrafts() {
    const list = [...entries.values()].filter((e) => !e.removed && dirty(e) && !blank(e.text)).map((e) => ({
      id: e.id, scope: e.scope, competitorId: e.competitorId, competitor: e.competitor, pageUrl: e.pageUrl, siteId: e.siteId, screen: e.screen, keyword: e.keyword, day: e.day, domain: e.domain, taskId: e.taskId, task: e.task, text: e.text, at: e.at, base: e.base, sent: e.sent,
    }));
    UI.store.set(DRAFTS_KEY, list.length ? JSON.stringify(list) : "");
  }

  /* A draft left over from last time comes back as a note in its list, and is checked against the server before it's saved. */
  function restoreDrafts() {
    let list = [];
    try { list = JSON.parse(UI.store.get(DRAFTS_KEY) || "[]"); } catch { list = []; }
    list.forEach((d) => {
      if (!d || blank(d.text)) return;
      const where = { scope: d.scope, competitorId: d.competitorId, competitor: d.competitor, pageUrl: d.pageUrl, siteId: d.siteId, screen: d.screen ?? null, keyword: d.keyword ?? null, day: d.day ?? null, domain: d.domain ?? null, taskId: d.taskId ?? null, task: d.task ?? null };
      if (!d.id && needs(where)) { // it has nowhere to go yet: back to the tab's field, waiting for its address
        Object.assign(tabState, { way: d.scope === "page" ? "page" : "competitor", pageUrl: d.pageUrl || "", pageTyped: d.pageUrl || "" });
        const waiting = composerFor(TAB, where);
        Object.assign(waiting, { text: d.text, at: d.at, status: "waiting", message: needs(where) });
        return;
      }
      const e = newEntry({ ...where, id: d.id, text: d.text, saved: "", at: d.at, base: d.base, sent: d.sent, sortAt: d.at || Date.now(), status: "saving", leftover: true });
      e.targets.add(keyOf(where));
    });
    writeDrafts();
    if ([...entries.values()].some((e) => e.leftover)) setTimeout(() => entries.forEach((e) => { if (e.leftover) save(e); }), RECONCILE_MS);
  }

  /* Did the save that may have been cut off land? Decide with the server's list, so a note isn't written twice. */
  async function reconcile(e) {
    e.busy = true;
    let list;
    try {
      list = await fetchNotes(pathFor(e));
    } catch {
      e.busy = false;
      e.status = "failed";
      paintStatus(e);
      startRetry();
      return;
    }
    e.busy = false;
    if (!e.leftover) { if (dirty(e) && !e.removed) save(e); return; } // the list that just loaded settled it
    e.leftover = false;
    const knew = Boolean(e.id);
    const note = knew ? list.find((n) => n.id === e.id) : list.find((n) => n.body === e.text) || (e.sent ? list.find((n) => n.body === e.sent) : null);
    if (note) {
      const twin = byId(note.id);
      if (twin && twin !== e) { entries.delete(twin.uid); }
      Object.assign(e, { id: note.id, saved: note.body, updatedAt: note.updated_at, createdAt: note.created_at, createdBy: note.created_by ?? null, updatedBy: note.updated_by ?? null, competitor: note.competitor, pageUrl: note.page_url, sent: null });
      const newer = !knew || e.base === note.updated_at || e.at > stamp(note.updated_at);
      if (!newer) e.text = note.body;
      if (!dirty(e)) { e.status = "saved"; e.savedAt = new Date(); }
    } else if (knew) { e.id = null; e.saved = ""; } // deleted elsewhere since: the words still get a home
    writeDrafts();
    paintAll();
    if (dirty(e)) save(e);
  }

  // ---- saving ----------------------------------------------------------------------------------
  function needs(w) {
    if (w.scope === "page" && blank(w.pageUrl)) return "Enter the page address to save. Kept on this computer.";
    if (w.scope === "competitor" && w.competitorId === null) return "Choose a competitor to save. Kept on this computer.";
    if (w.scope === "keyword" && blank(w.keyword)) return "Enter the keyword to save. Kept on this computer.";
    if ((w.scope === "date" && blank(w.day)) || (w.scope === "domain" && blank(w.domain)) || (w.scope === "section" && blank(w.pageUrl)) || (w.scope === "task" && w.taskId == null)) return "Choose a subject to save. Kept on this computer.";
    if (w.scope === "screen" && !w.screen) return "Choose a subject to save. Kept on this computer.";
    return "";
  }

  /* Through COMP.api, the app's one way to the server (competitors.js): it waits out a 429, asks for a fresh sign-in token
     once on "out of date", and its errors carry .status and .data. keepalive lets a save still reach the server after the
     page has gone. Browsers cap keepalive at about 64 KB, so a longer note relies on its draft instead. */
  async function send(method, path, body) {
    if (serverMode === null) serverMode = await COMP.isServer();
    if (!serverMode) return COMP.api(method, path, body);
    const keepalive = body === undefined || JSON.stringify(body).length <= KEEPALIVE_CHARS;
    return COMP.api(method, path, body, { keepalive });
  }
  /* Answers that mean "not now", not "no": the words wait on this computer and go again (F194). 0 is no connection. */
  const tryAgainLater = (status) => status === undefined || status === 0 || status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;

  async function fetchNotes(path) {
    if (serverMode === null) serverMode = await COMP.isServer();
    if (!serverMode) sampleDb.publish(path);
    return (await COMP.api("GET", path)).notes;
  }

  function save(e, { parallel = false } = {}) {
    if (e.status === "clash" && !e.resolved) return; // waits for Keep mine or Use theirs
    clearTimeout(e.timer);
    e.timer = null;
    if (e.removed) return;
    if (e.needsRestore) { e.inflight = restore(e); return; }
    if (!dirty(e)) {
      if (e.status === "saving" || e.status === "failed") { e.status = e.savedAt ? "saved" : "idle"; paintStatus(e); }
      return;
    }
    if (blank(e.text) && !holdsFiles(e)) { e.status = e.id ? "emptied" : "idle"; paintStatus(e); return; }
    if (!e.id && needs(e)) { e.status = "waiting"; e.message = needs(e); paintStatus(e); return; }
    if (e.busy && !(parallel && e.id)) { e.again = true; return; }
    e.inflight = e.leftover ? reconcile(e) : write(e, { blind: parallel });
  }

  /* blind: the page is closing, so no version check; a clash then can't be shown to anyone. */
  async function write(e, { blind = false } = {}) {
    e.busy = true;
    e.again = false;
    e.resolved = false;
    const sending = e.text, isNew = !e.id;
    // The version this person was editing: a teammate's save since then answers 409, and nothing is overwritten.
    const expected = blind || e.forceMine ? null : e.base || e.updatedAt || null;
    e.sending = sending;
    e.status = "saving";
    paintStatus(e);
    if (isNew) { e.sent = sending; writeDrafts(); }
    try {
      const note = isNew
        ? await send("POST", "notes", { scope: e.scope, body: sending, site_id: siteOf(e.siteId), competitor_id: e.competitorId, page_url: e.scope === "page" ? withScheme(e.pageUrl) : null, screen: e.scope === "screen" ? e.screen : null, ...(e.scope === "keyword" ? { keyword: e.keyword } : {}), ...(e.scope === "section" ? { page_url: e.pageUrl } : {}), ...(e.scope === "date" ? { day: e.day } : {}), ...(e.scope === "domain" ? { domain: e.domain } : {}), ...(e.scope === "task" ? { task_id: e.taskId } : {}) })
        : await send("PATCH", `notes/${e.id}`, { body: sending, ...(expected ? { expected_updated_at: expected } : {}) });
      Object.assign(e, { id: note.id, saved: sending, sent: null, updatedAt: note.updated_at, createdAt: note.created_at, createdBy: note.created_by ?? null, updatedBy: note.updated_by ?? null, competitor: note.competitor, pageUrl: note.page_url, siteId: note.site_id, savedAt: new Date(), base: null, leftover: false, forceMine: false, clash: null });
      if (!dirty(e)) e.status = "saved";
      writeDrafts();
      paintWhere(e);
    } catch (err) {
      if (err.status === 404 && !isNew) { // deleted by someone else while this person typed (F121): say so, and keep the words as a new note
        e.id = null; e.saved = ""; e.again = true; e.base = null; e.updatedAt = null;
        UI.toast(UI.t("Someone deleted this note. Your text is saved as a new note."), { kind: "info" });
      } else if (err.status === 409 && err.data?.note) { // a teammate saved this note since this person started: they choose
        e.clash = err.data.note;
        e.status = "clash";
      } else if (!tryAgainLater(err.status)) { e.status = "refused"; e.message = err.message; }
      else {
        e.status = "failed";
        if (isNew) e.leftover = true; // it may have arrived: check before sending it again
        startRetry();
      }
    }
    e.busy = false;
    paintStatus(e);
    if (e.removed || e.status === "refused" || e.status === "failed" || e.status === "clash") return;
    if (dirty(e) && (e.again || !e.timer)) save(e);
    else if (e.composer && !dirty(e) && !isFocused(e)) whenReleased(() => settle(e)); // saved after they'd left the field
  }

  async function restore(e) {
    e.busy = true;
    try {
      await send("POST", `notes/${e.id}/restore`);
      e.needsRestore = false;
    } catch {
      e.status = "failed";
      startRetry();
    }
    e.busy = false;
    paintStatus(e);
    if (!e.needsRestore && !e.removed) { if (dirty(e)) save(e); else if (e.status === "failed") { e.status = "saved"; e.savedAt = new Date(); paintStatus(e); } }
  }

  let retryTimer = null;
  function startRetry() {
    if (retryTimer) return;
    retryTimer = setInterval(() => {
      const waiting = [...entries.values()].filter((e) => e.status === "failed" && !e.removed && !e.busy);
      if (!waiting.length) { clearInterval(retryTimer); retryTimer = null; return; }
      waiting.forEach((e) => save(e));
    }, RETRY_MS);
  }

  /* The page may be going away. Whatever isn't on the server yet leaves now, in this tick. */
  function flush() {
    writeDrafts();
    if (!serverMode) return;
    entries.forEach((e) => {
      if (e.removed || !dirty(e) || (blank(e.text) && !holdsFiles(e)) || e.leftover || e.status === "refused" || e.status === "waiting" || e.status === "clash") return;
      if (e.busy && e.sending === e.text) return; // already on its way, and keepalive carries it
      save(e, { parallel: true });
    });
  }

  /* Clearing the box, or typing over the whole note, means starting another one. The saved note stays, and moves into the list. */
  const startsAgain = (e, value) => {
    if (!e.composer || !e.id || blank(e.saved) || holdsFiles(e)) return false;
    if (blank(value)) return true;
    const before = e.saved.trim(), now = value.trim();
    return now.length <= 2 && before.length > 2 && before[0] !== now[0] && before.at(-1) !== now.at(-1);
  };
  function typed(e, value) {
    if (startsAgain(e, value)) {
      clearTimeout(e.timer);
      e.text = e.saved;
      e.status = "saved";
      const field = fieldsFor(e).find((el) => el.dataset.noteComposer);
      commit(e);
      const fresh = field ? entries.get(field.dataset.noteField) : null;
      if (fresh && !blank(value)) { field.value = value; typed(fresh, value); }
      writeDrafts();
      return;
    }
    e.text = value;
    e.at = Date.now();
    if (e.base === null && e.updatedAt) e.base = e.updatedAt;
    writeDrafts();
    clearTimeout(e.timer);
    e.status = !dirty(e) ? (e.savedAt ? "saved" : "idle") : blank(value) && !holdsFiles(e) ? (e.id ? "emptied" : "idle") : "saving";
    paintStatus(e);
    if (dirty(e)) e.timer = setTimeout(() => save(e), PAUSE_MS);
  }

  // ---- images and files ------------------------------------------------------------------------
  const fileUrl = (f) => (serverMode ? `api/note-files/${Number(f.id)}` : f.url || "#");
  function fileSize(bytes) {
    if (bytes < 1024) return `${UI.num(bytes)} B`;
    if (bytes < 1024 * 1024) return `${UI.num(Math.round(bytes / 1024))} KB`;
    return `${UI.num(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB`;
  }
  async function uploadOne(e, file) {
    if (!serverMode) return sampleDb.addFile(e.id, file);
    const form = new FormData();
    form.append("file", file, file.name || "image.png");
    return COMP.api("POST", `notes/${e.id}/files`, null, { form });
  }
  /* A file needs a note to belong to, so a note that has only just been started is saved first. */
  async function addFiles(e, list) {
    const files = [...list];
    if (!files.length || !e || e.removed) return;
    if (serverMode === null) serverMode = await COMP.isServer();
    if (!e.id && needs(e)) { e.status = "waiting"; e.message = needs(e); paintStatus(e); return; }
    const fits = files.filter((file) => {
      if (file.size <= MAX_FILE_BYTES) return true;
      UI.toast(UI.t("{name} is over 25 MB.").replace("{name}", file.name), { kind: "crit" });
      return false;
    });
    if (!fits.length) return;
    e.uploading += fits.length;
    e.uploadingNames.push(...fits.map((file) => file.name || "image.png"));
    paintFiles(e);
    clearTimeout(e.timer);
    e.timer = null;
    if (e.inflight) await e.inflight.catch(() => {});
    if (!e.id) { e.inflight = write(e); await e.inflight; }
    for (const file of fits) {
      try {
        if (!e.id) throw new Error(UI.t("Note not saved."));
        const note = await uploadOne(e, file);
        if (note.files) e.files = note.files;
        if (note.updated_at) e.updatedAt = note.updated_at;
        e.status = dirty(e) ? e.status : "saved";
        e.savedAt = new Date();
      } catch (err) {
        UI.toast(UI.t("Couldn't add {name}: {why}").replace("{name}", file.name || "image.png").replace("{why}", UI.t(err.message)), { kind: "crit" });
      }
      e.uploading -= 1;
      e.uploadingNames.splice(e.uploadingNames.indexOf(file.name || "image.png"), 1);
      paintFiles(e);
      paintStatus(e);
    }
    if (dirty(e)) save(e);
    if (e.composer && !isFocused(e)) whenReleased(() => settle(e));
    paintLists();
  }
  /* A note that's nothing but this one file goes as a whole, with the same Undo as any other note. */
  async function removeFile(e, file) {
    if (blank(e.text) && e.files.filter((f) => !f.removed).length === 1 && !e.uploading) { removeNote(e); return; }
    file.removed = true;
    paintFiles(e);
    try {
      await send("DELETE", `note-files/${file.id}`);
    } catch (err) {
      file.removed = false;
      paintFiles(e);
      if (err.status !== 404) UI.toast(UI.t("Couldn't delete this file. Try again."), { kind: "crit" });
      return;
    }
    UI.toast(UI.t("File deleted"), { kind: "info", undo: async () => {
      try {
        const note = await send("POST", `note-files/${file.id}/restore`);
        if (note.files) e.files = note.files;
        paintFiles(e);
      } catch { UI.toast(UI.t("Couldn't restore the file."), { kind: "crit" }); }
    } });
  }
  /* Built as elements, not markup: a file's name can hold anything, and it's only ever text here. */
  function fileEl(e, f) {
    const item = document.createElement("div");
    item.className = `nb-file ${f.is_image ? "nb-file-img" : "nb-file-doc"}`;
    const link = document.createElement("a");
    link.href = fileUrl(f);
    if (f.is_image && serverMode) { link.target = "_blank"; link.rel = "noopener"; } else link.download = f.name;
    if (f.is_image) {
      const img = document.createElement("img");
      img.src = fileUrl(f);
      img.alt = f.name;
      img.loading = "lazy";
      link.append(img);
      link.title = f.name;
    } else {
      UI.setHTML(link, UI.icon("file-text"));
      const name = document.createElement("span");
      name.className = "nb-file-name";
      name.dir = "auto";
      name.textContent = f.name;
      const size = document.createElement("span");
      size.className = "nb-file-size";
      size.textContent = fileSize(f.size);
      link.append(name, size);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "nb-file-x";
    remove.dataset.noteFileRemove = `${e.uid}|${f.id}`;
    remove.setAttribute("aria-label", UI.t("Remove {name}").replace("{name}", f.name));
    UI.setHTML(remove, UI.icon("x"));
    item.append(link, remove);
    return item;
  }
  function fillFiles(box, e) {
    const items = e.files.filter((f) => !f.removed).map((f) => fileEl(e, f));
    e.uploadingNames.forEach((name) => {
      const item = document.createElement("div");
      item.className = "nb-file nb-file-doc nb-file-busy";
      item.setAttribute("role", "status");
      UI.setHTML(item, UI.icon("refresh-cw", "spin"));
      const label = document.createElement("span");
      label.className = "nb-file-name";
      label.textContent = UI.t("Adding {name}…").replace("{name}", name);
      item.append(label);
      items.push(item);
    });
    box.replaceChildren(...items);
    box.hidden = !items.length;
  }
  function paintFiles(e) {
    if (!UI) return;
    UI.$$(`[data-note-files="${e.uid}"]`).forEach((box) => fillFiles(box, e));
  }
  const attachButton = (e) => `<button type="button" class="btn btn-ghost btn-small nb-attach" data-note-attach="${e.uid}">${UI.icon("paperclip")}${UI.t("Add file")}</button>`;
  let picker = null;
  function choosePicker() {
    if (picker) return picker;
    picker = document.createElement("input");
    picker.type = "file";
    picker.multiple = true;
    picker.hidden = true;
    picker.id = "nb-picker";
    document.body.append(picker);
    picker.addEventListener("change", () => {
      const e = entries.get(picker.dataset.uid);
      const files = [...picker.files];
      picker.value = "";
      addFiles(e, files);
    });
    return picker;
  }
  const dropTarget = (el) => {
    const zone = el?.closest?.("[data-note-compose], [data-note-row]");
    const field = zone?.querySelector("[data-note-field]");
    return field ? { zone, e: entries.get(field.dataset.noteField) } : null;
  };
  const carriesFiles = (ev) => [...(ev.dataTransfer?.types || [])].includes("Files");

  // ---- deleting, with Undo ---------------------------------------------------------------------
  function removeNote(e, { emptied = false } = {}) {
    clearTimeout(e.timer);
    e.timer = null;
    if (emptied) { e.text = e.saved; e.status = "saved"; }
    if (e.composer) { composers.delete(e.composer); e.composer = null; repointComposers(); }
    e.removed = true;
    writeDrafts();
    paintLists();
    let done = Promise.resolve();
    if (e.id || e.busy) {
      done = (e.inflight || Promise.resolve()).catch(() => {}).then(() => {
        if (!e.id) return null;
        return send("DELETE", `notes/${e.id}`).catch((err) => {
          if (err.status === 404) return;
          e.removed = false;
          writeDrafts();
          paintLists();
          UI.toast(UI.t("Couldn't delete this note. Try again."), { kind: "crit" });
        });
      });
    }
    UI.toast(UI.t(emptied ? "Empty note removed" : "Note deleted"), { kind: "info", undo: () => {
      e.removed = false;
      e.sortAt = Math.max(e.sortAt, stamp(e.updatedAt));
      writeDrafts();
      paintLists();
      done.then(() => {
        if (e.id) { e.needsRestore = true; save(e); } else if (dirty(e)) save(e);
      });
      UI.toast(UI.t("Restored"), { kind: "info" });
    } });
  }

  // ---- on screen -------------------------------------------------------------------------------
  const fieldsFor = (e) => UI.$$(`textarea[data-note-field="${e.uid}"]`);
  const isFocused = (e) => { const a = document.activeElement; return Boolean(a?.dataset && a.dataset.noteField === e.uid); };
  const autoGrows = () => window.CSS?.supports?.("field-sizing", "content");
  function autosize(el) {
    if (autoGrows() || el.value.length > 200000) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }
  function fill(el, e) {
    if (el.value !== e.text) {
      el.value = e.text;
      // Chrome only works out dir="auto" again when the attribute itself changes, not when a script sets the value.
      el.setAttribute("dir", "ltr");
      el.setAttribute("dir", "auto");
    }
    autosize(el);
  }

  const clock = (date) => new Intl.DateTimeFormat(UI.locale(), { hour: "2-digit", minute: "2-digit" }).format(date);
  const fullDate = (iso) => new Intl.DateTimeFormat(UI.locale(), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  function statusHtml(e) {
    const { t, icon, esc } = UI;
    if (e.status === "saving") return `${icon("refresh-cw", "spin")}<span>${t("Saving…")}</span>`;
    if (e.status === "saved" && e.savedAt) {
      // While it's still in the writing box, it isn't in the list yet, so say so, and offer the way to the next one.
      return `${icon("check")}<span>${t("Saved {time}").replace("{time}", esc(clock(e.savedAt)))}${e.composer ? `. ${t("Joins the list when you leave.")}` : ""}</span>${e.composer ? ` <button type="button" class="link-btn" data-note-next="${e.uid}">${t("New note")}</button>` : ""}`;
    }
    if (e.status === "failed") return `${icon("triangle-alert")}<span>${t("Couldn't save. Kept on this computer; trying again.")}</span>`;
    if (e.status === "refused") return `${icon("octagon-alert")}<span>${esc(t(e.message))}</span>`;
    if (e.status === "waiting") return `${icon("info")}<span>${esc(t(e.message))}</span>`;
    if (e.status === "emptied") return `${icon("info")}<span>${t("An empty note isn't kept.")}</span>`;
    if (e.status === "clash" && e.clash) {
      // As Tasks do: nothing is overwritten until this person has seen the other text and chosen.
      const by = e.clash.updated_by ? ` ${t("by {name}").replace("{name}", esc(e.clash.updated_by))}` : "";
      const theirs = String(e.clash.body || "").trim();
      return `${icon("octagon-alert")}<span>${t("Someone else changed this note. Yours isn't saved yet.")}${by ? ` (${t("changed")}${by})` : ""} ${t("It now says")}: <q dir="auto">${esc(theirs.length > 140 ? `${theirs.slice(0, 140)}…` : theirs || "—")}</q></span>
        <span class="nb-clash-acts"><button type="button" class="btn btn-small" data-note-keep-mine="${e.uid}">${t("Keep mine")}</button><button type="button" class="btn btn-small" data-note-use-theirs="${e.uid}">${t("Use theirs")}</button></span>`;
    }
    if (e.updatedAt && !e.composer) {
      const by = e.updatedBy ? ` ${t("by {name}").replace("{name}", esc(e.updatedBy))}` : "";
      const made = e.createdBy ? ` · ${t("Written by {name}").replace("{name}", e.createdBy)}` : "";
      return `<span title="${esc(fullDate(e.updatedAt) + made)}">${t("Last changed")} ${esc(COMP.ago(e.updatedAt))}${by}</span>`;
    }
    return "";
  }
  const statusClass = (e) => `nb-status small${e.status === "failed" || e.status === "waiting" ? " warn" : e.status === "refused" || e.status === "clash" ? " crit" : ""}`;
  function paintStatus(e) {
    if (!UI) return;
    UI.$$(`[data-note-status="${e.uid}"]`).forEach((el) => { el.className = statusClass(e); UI.setHTML(el, statusHtml(e)); });
  }
  const statusLine = (e) => `<p class="${statusClass(e)}" data-note-status="${e.uid}" role="status">${statusHtml(e)}</p>`;

  /* Where a note belongs: a plain label, a link to the competitor's profile, or an outside link to the page. */
  /* everySite: the Notes screen lists every site's notes, so each one says which site it's for. */
  const hostOf = (siteId) => COMP.sites.find((s) => s.id === siteId)?.host || (window.SITES || []).find((s) => s.realId === siteId)?.host || null;
  function whereHtml(e, everySite = false) {
    const { t, esc, icon } = UI;
    const site = e.siteId !== null && e.siteId !== undefined && (everySite || e.siteId !== COMP.siteId) ? hostOf(e.siteId) : null;
    // Which website, by its logo: the address is its tooltip and what a screen reader says.
    const forSite = site ? `<span class="nb-site" role="img" title="${esc(site)}" data-tip="${esc(site)}" aria-label="${esc(`${t("for")} ${site}`)}">${UI.siteLogo(site, 16)}</span>` : "";
    if (e.scope === "competitor") return `${icon("crosshair")}<button class="link-btn nb-link" data-note-competitor="${esc(e.competitorId)}" dir="auto">${esc(e.competitor || t("A competitor"))}</button>${forSite}`;
    if (e.scope === "page") return `${icon("file-text")}${e.pageUrl ? COMP.link(e.pageUrl) : `<span>${t("A page")}</span>`}${forSite}`;
    if (e.scope === "site") return `${icon("globe")}<span>${t(siteOf(e.siteId) === null ? "All my sites" : "Whole site")}</span>${forSite}`;
    if (e.scope === "screen") return `${icon("layout-dashboard")}<span>${esc(screenName(e.screen))}</span>${forSite}`;
    if (e.scope === "keyword") return `${icon("key-round")}${e.keyword ? KeywordLink.html(e.keyword, { host: hostOf(e.siteId) }) : `<span>${t("A keyword")}</span>`}${forSite}`;
    if (e.scope === "section") return `${icon("folder-open")}<span class="mono" dir="ltr">${esc(e.pageUrl ? `${COMP.shortUrl(e.pageUrl)}/…` : t("A folder"))}</span>${forSite}`;
    if (e.scope === "date") return `${icon("calendar-days")}<span>${esc(e.day ? dayName(e.day) : t("A date"))}</span>${forSite}`;
    if (e.scope === "domain") return `${icon("link-2")}<span class="mono" dir="ltr">${esc(e.domain || t("A linking website"))}</span>${forSite}`;
    if (e.scope === "task") return `${icon("square-check")}<span dir="auto">${esc(e.task || t("A task"))}</span>${forSite}`;
    return `${icon("users")}<span>${t("All competitors")}</span>${forSite}`;
  }
  /* A day in the language on screen, such as 12 Nov 2026. */
  const dayName = (iso) => { try { return new Date(`${iso}T12:00:00`).toLocaleDateString(UI.state.lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return iso; } };
  /* The screen's name as the side menu shows it. */
  const screenName = (id) => UI.t(SCREEN_NAMES[id] || id || "A screen");
  const whereText = (e) => (e.scope === "competitor" ? e.competitor || "" : e.scope === "page" ? e.pageUrl || "" : e.scope === "keyword" ? e.keyword || "" : e.scope === "section" ? e.pageUrl || "" : e.scope === "date" ? (e.day ? `${dayName(e.day)} ${e.day}` : "") : e.scope === "domain" ? e.domain || "" : e.scope === "task" ? e.task || "" : e.scope === "screen" ? screenName(e.screen) : e.scope === "site" ? UI.t("Whole site") : UI.t("All competitors"));
  function paintWhere(e) {
    UI.$$(`[data-note-where="${e.uid}"]`).forEach((el) => UI.setHTML(el, whereHtml(e, Boolean(el.closest("[data-note-every-site]")))));
  }
  const fieldLabel = (e) => `${UI.t("Note")}: ${e.scope === "competitor" ? e.competitor || UI.t("A competitor") : e.scope === "page" ? e.pageUrl || UI.t("A page") : e.scope === "keyword" ? e.keyword || UI.t("A keyword") : whereText(e) || UI.t("Note")}`;

  function rowHtml(e, listKey, everySite = false) {
    const { t, esc, icon } = UI;
    const showWhere = listKey === ALL_NOTES || !listKey.startsWith(`${e.scope === "all" ? "all" : e.scope}`);
    return `<li class="nb-row" data-note-row="${e.uid}">
      ${showWhere ? `<div class="nb-where small" data-note-where="${e.uid}">${whereHtml(e, everySite)}</div>` : ""}
      <textarea class="input nb-text" dir="auto" rows="1" data-note-field="${e.uid}" placeholder="${t("Add text")}" aria-label="${esc(fieldLabel(e))}"></textarea>
      <div class="nb-files" data-note-files="${e.uid}" hidden></div>
      <div class="nb-foot">${statusLine(e)}${attachButton(e)}<button class="icon-btn nb-delete" data-note-delete="${e.uid}" aria-label="${t("Delete this note")}" data-tip="${t("Delete")}">${icon("trash-2")}</button></div>
    </li>`;
  }

  /* The Notes screen's filter: what a note is about, in fewer, wider kinds than the scopes. */
  const KINDS = [
    ["page", "Pages", "file-text"], ["keyword", "Keywords", "key-round"], ["competitor", "Competitors", "crosshair"], ["domain", "Linking websites", "link-2"],
    ["task", "Tasks", "square-check"], ["date", "Days", "calendar-days"], ["screen", "Screens", "layout-dashboard"], ["site", "Websites", "globe"],
  ];
  const kindOf = (e) => (e.scope === "section" ? "page" : e.scope === "all" ? "competitor" : e.scope);
  const listed = () => [...entries.values()].filter((e) => !e.removed && !e.composer && !(blank(e.text) && !e.id));
  function kindCounts() {
    const counts = new Map();
    listed().forEach((e) => counts.set(kindOf(e), (counts.get(kindOf(e)) || 0) + 1));
    return counts;
  }

  function wantedFor(key, kind = "") {
    const list = [...entries.values()].filter((e) => !e.removed && !e.composer && (key === ALL_NOTES || e.targets.has(key)) && !(blank(e.text) && !e.id) && (!kind || kindOf(e) === kind));
    const needle = key === ALL_NOTES ? tabState.search.trim().toLowerCase() : "";
    const shown = needle ? list.filter((e) => `${e.text} ${whereText(e)} ${e.files.map((f) => f.name).join(" ")}`.toLowerCase().includes(needle)) : list;
    return shown.sort((a, b) => b.sortAt - a.sortAt || (b.id || 0) - (a.id || 0));
  }

  /* Rows that are already there stay there, so a click or typing under way isn't disturbed. */
  function paintList(listEl) {
    const key = listEl.dataset.noteList;
    const everySite = listEl.hasAttribute("data-note-every-site");
    const wanted = wantedFor(key, listEl.dataset.noteKind || "");
    const have = new Map([...listEl.children].map((li) => [li.dataset.noteRow, li]));
    const focused = document.activeElement?.dataset?.noteField ? { el: document.activeElement, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
    wanted.forEach((e, i) => {
      let li = have.get(e.uid);
      if (!li) {
        li = UI.fragment(rowHtml(e, key, everySite)).firstElementChild;
        listEl.insertBefore(li, listEl.children[i] || null);
        fill(li.querySelector("textarea"), e);
        fillFiles(li.querySelector("[data-note-files]"), e);
      } else if (listEl.children[i] !== li) listEl.insertBefore(li, listEl.children[i] || null);
      have.delete(e.uid);
    });
    have.forEach((li) => li.remove());
    if (focused?.el.isConnected && document.activeElement !== focused.el) { focused.el.focus({ preventScroll: true }); focused.el.setSelectionRange(focused.start, focused.end); }
  }

  function paintLists() {
    if (!UI) return;
    UI.$$("[data-note-list]").forEach(paintList);
    paintTabSummary();
    paintCounts();
    paintPanelEmpty();
    document.dispatchEvent(new CustomEvent("seocc:notes-painted")); // the Notes screen recounts its filters
  }
  function paintAll() {
    if (!UI) return;
    paintLists();
    entries.forEach((e) => { paintStatus(e); paintWhere(e); paintFiles(e); fieldsFor(e).forEach((el) => { if (document.activeElement !== el) fill(el, e); }); });
  }

  /* After a note leaves the "new note" field, that field carries on as a fresh note's field. */
  function repointComposers() {
    UI.$$("textarea[data-note-composer]").forEach((el) => {
      const key = el.dataset.noteComposer;
      const current = entries.get(el.dataset.noteField);
      if (current && current.composer === key) return;
      const line = el.closest("[data-note-compose]")?.querySelector("[data-note-status]");
      const where = current ? whereOf(current) : {};
      const fresh = composerFor(key, key === TAB ? tabWhere() : { ...where, text: "" });
      el.dataset.noteField = fresh.uid;
      fill(el, fresh);
      if (line) { line.dataset.noteStatus = fresh.uid; line.className = statusClass(fresh); UI.setHTML(line, statusHtml(fresh)); }
      const compose = el.closest("[data-note-compose]");
      const box = compose?.querySelector("[data-note-files]");
      if (box) { box.dataset.noteFiles = fresh.uid; fillFiles(box, fresh); }
      const attach = compose?.querySelector("[data-note-attach]");
      if (attach) attach.dataset.noteAttach = fresh.uid;
    });
  }

  function commit(e) {
    const key = e.composer;
    e.composer = null;
    composers.delete(key);
    e.sortAt = Date.now();
    if (key !== TAB) e.targets.add(key);
    repointComposers();
    paintLists();
  }

  /* The person has really left the field. An empty note isn't kept. A written one moves into the list below. */
  function settle(e) {
    if (e.removed || isFocused(e)) return;
    if (blank(e.text) && !holdsFiles(e)) {
      if (e.id) removeNote(e, { emptied: true });
      else if (!e.composer) { e.removed = true; writeDrafts(); paintLists(); } else { e.text = ""; e.saved = ""; e.status = "idle"; writeDrafts(); paintStatus(e); }
      return;
    }
    if (e.composer && e.status !== "refused" && e.status !== "waiting") commit(e);
  }

  // A row added between pressing and releasing the mouse would move what's being clicked, so it waits.
  let pressed = false;
  const afterPress = [];
  const whenReleased = (fn) => { if (pressed) afterPress.push(fn); else fn(); };

  // A repaint takes the focused field away. Its replacement gets the focus and the caret back.
  let caret = null;
  function rememberCaret(el = document.activeElement) {
    if (el?.dataset?.noteField) caret = { uid: el.dataset.noteField, start: el.selectionStart, end: el.selectionEnd, top: el.scrollTop, at: Date.now() };
  }
  function restoreCaret() {
    if (!caret) return;
    const memo = caret;
    caret = null;
    if (Date.now() - memo.at > 3000 || (document.activeElement && document.activeElement !== document.body && document.activeElement.id !== "main")) return;
    const el = UI.$(`textarea[data-note-field="${memo.uid}"]`);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(memo.start, memo.end);
    el.scrollTop = memo.top;
  }

  // ---- the reusable block ----------------------------------------------------------------------
  const composeField = (e, key, label) => `<div class="nb-compose" data-note-compose>
      <textarea class="input nb-text" dir="auto" rows="2" data-note-field="${e.uid}" data-note-composer="${UI.esc(key)}" placeholder="${UI.t("Write, paste or drop a file")}" aria-label="${UI.esc(label)}"></textarea>
      <div class="nb-files" data-note-files="${e.uid}" hidden></div>
      <div class="nb-foot">${statusLine(e)}${attachButton(e)}</div>
    </div>`;

  function block({ scope = "all", competitorId = null, pageUrl = null, screen = null, keyword = null, day = null, domain = null, taskId = null, task = null, siteId, title = "", bare = false } = {}) {
    const { t, esc } = UI;
    rememberCaret();
    const site = siteId === undefined ? COMP.siteId : siteId;
    const extra = { day, domain, taskId, task };
    const key = targetKey(scope, competitorId, pageUrl, screen, site, keyword, extra);
    const e = composerFor(key, { scope, competitorId, pageUrl, screen, keyword, ...extra, siteId: site });
    const heading = title || t(scope === "competitor" ? "Notes on this competitor" : scope === "page" ? "Notes on this page" : scope === "keyword" ? "Notes on this keyword" : scope === "section" ? "Notes on this folder" : scope === "date" ? "Notes on this day" : scope === "domain" ? "Notes on this linking website" : scope === "task" ? "Notes on this task" : scope === "screen" ? "Notes on this screen" : scope === "site" ? "Notes on this website" : "Notes on all competitors");
    return `<section class="${bare ? "nb-bare" : "card"} nb-block" data-note-block="${esc(key)}" data-note-scope="${esc(scope)}" data-note-competitor="${esc(competitorId ?? "")}" data-note-page="${esc(pageUrl ?? "")}" data-note-screen="${esc(screen ?? "")}" data-note-keyword="${esc(keyword ?? "")}" data-note-day="${esc(day ?? "")}" data-note-domain="${esc(domain ?? "")}" data-note-task="${esc(taskId ?? "")}" data-note-task-title="${esc(task ?? "")}" data-note-site="${esc(siteOf(site) ?? "")}">
      ${bare ? "" : `<div class="card-head"><h2 dir="auto">${esc(heading)}</h2><span class="end small muted">${t("Saves by itself")}</span></div>`}
      ${composeField(e, key, heading)}
      <p class="note warn nb-load-error" data-note-error hidden>${UI.icon("triangle-alert")}<span>${t("Notes didn't load. What you write is still kept.")}</span></p>
      <ul class="nb-list" data-note-list="${esc(key)}"></ul>
    </section>`;
  }

  const loading = new Set();
  async function loadTarget(section) {
    const scope = section.dataset.noteScope, key = section.dataset.noteBlock;
    if (loading.has(key)) return;
    loading.add(key);
    const where = {
      scope, competitorId: scope === "competitor" ? Number(section.dataset.noteCompetitor) : null, pageUrl: scope === "page" || scope === "section" ? section.dataset.notePage : null,
      day: scope === "date" ? section.dataset.noteDay : null, domain: scope === "domain" ? section.dataset.noteDomain : null, taskId: scope === "task" ? Number(section.dataset.noteTask) : null, task: section.dataset.noteTaskTitle || null,
      screen: scope === "screen" ? section.dataset.noteScreen : null, keyword: scope === "keyword" ? section.dataset.noteKeyword : null, siteId: section.dataset.noteSite === "" ? null : Number(section.dataset.noteSite),
    };
    let failed = false;
    try {
      ingest(await fetchNotes(pathFor(where)), key);
    } catch { failed = true; }
    loading.delete(key);
    UI.$$("[data-note-block]").filter((s) => s.dataset.noteBlock === key).forEach((s) => { const line = s.querySelector("[data-note-error]"); if (line) line.hidden = !failed; });
    paintAll();
  }

  function mount() {
    if (!UI) return;
    UI.$$("[data-note-block]").forEach((section) => {
      if (section.dataset.noteMounted) return;
      section.dataset.noteMounted = "1";
      UI.$$("textarea[data-note-field]", section).forEach((el) => { const e = entries.get(el.dataset.noteField); if (e) { fill(el, e); paintFiles(e); } });
      paintList(section.querySelector("[data-note-list]"));
      loadTarget(section);
    });
    restoreCaret();
  }

  // ---- the Notes panel: opens from any screen, beside what you're looking at --------------------
  /* choices: [{ id, label, icon, where }], the first being what's on screen. "All notes" is always last. */
  const panelState = { choices: [], pick: 0, failed: false };
  const PANEL_ALL = "all-notes";

  function panelBody() {
    const { t, esc, icon } = UI;
    const choice = panelState.choices[panelState.pick];
    if (!choice || choice.id === PANEL_ALL) {
      return `<label class="nb-search nb-panel-search"><span class="sr">${t("Search notes")}</span>${icon("search")}<input class="input" id="nb-panel-search" type="search" placeholder="${t("Search notes")}" value="${esc(tabState.search)}"></label>
        ${panelState.failed ? `<p class="note warn nb-load-error">${icon("triangle-alert")}<span>${t("Notes didn't load. What you write is still kept.")}</span></p>` : ""}
        <ul class="nb-list" data-note-list="${ALL_NOTES}"></ul><p class="small muted nb-panel-empty" id="nb-panel-empty" hidden></p>`;
    }
    if (choice.pick) return pickerHtml(choice);
    return block({ ...choice.where, bare: true });
  }

  /* "Or about": a page, a group of pages, a keyword, a day, a linking website, a task or a competitor. Pick one of the site's,
     or type one. The note field shows once something is picked, so a note can never be written about half an address. */
  const pickerState = { options: new Map(), loading: new Map() };
  const PICKS = {
    page: { field: "pageUrl", ltr: true, mono: true, label: "Page address", hint: "Search or type an address", empty: "Choose a page, then write.",
      list: (f) => f.pages.map((p) => [p.url, p.title]) },
    section: { field: "pageUrl", ltr: true, mono: true, label: "Address starts with", hint: "/blog/ or example.com/services/", empty: "Choose a folder, then write.", tip: "Or type how the addresses start. The note shows on every page in that folder.",
      list: (f) => f.sections.map((x) => [x.url, `${UI.num(x.pages)} ${UI.t(x.pages === 1 ? "page" : "pages")}`]) },
    keyword: { field: "keyword", label: "Keyword", hint: "Search or type a keyword", empty: "Choose a keyword, then write.",
      list: (f) => f.keywords.map((k) => [k, ""]) },
    date: { field: "day", type: "date", label: "Day", hint: "", empty: "Choose a day, then write what happened.", tip: "The note shows on the Overview chart." },
    domain: { field: "domain", ltr: true, mono: true, label: "Linking website", hint: "Search or type a website", empty: "Choose a site, then write: price, contact, answer.",
      list: (f) => f.domains.map((d) => [d, ""]) },
    task: { field: "task", label: "Task", hint: "Search tasks", empty: "Choose a task, then write.",
      list: (f) => f.tasks.map((x) => [taskValue(x, f.tasks), x.status === "done" ? UI.t("Done") : ""]) },
    competitor: { field: "competitor", ltr: true, label: "Competitor", hint: "Search competitors", empty: "Choose a competitor, then write.",
      list: (f) => f.competitors.map((c) => [c.host, c.display !== c.host ? c.display : ""]) },
  };
  /* A health task is named by its check alone ("Error pages"), so two sites can each have a task with that title.
     Those are told apart by their site, in the list and in what's typed: "Error pages · site-two.example". */
  const sameTitle = (a, b) => a.title.trim().toLowerCase() === b.title.trim().toLowerCase();
  const taskValue = (x, all) => (all.some((y) => y !== x && sameTitle(x, y) && (y.site_host || "") !== (x.site_host || "")) ? `${x.title} · ${x.site_host || UI.t("All sites")}` : x.title);
  const pickedValue = (choice) => choice.where[PICKS[choice.pick].field] || "";
  function pickerTarget(choice) {
    const { t } = UI;
    if (choice.unknown) return `<p class="note warn nb-pick-hint">${UI.icon("triangle-alert")}<span>${t(choice.unknown)}</span></p>`;
    if (!pickedValue(choice)) return `<p class="small muted nb-pick-hint">${t(PICKS[choice.pick].empty)}${UI.tip(PICKS[choice.pick].tip)}</p>`;
    return block({ ...choice.where, bare: true });
  }
  function pickerHtml(choice) {
    const { t, esc } = UI;
    const pick = PICKS[choice.pick];
    const typed = choice.typed ?? pickedValue(choice);
    const kind = pick.type === "date" ? `type="date" min="2000-01-01"` : `type="text" list="nb-pick-list" placeholder="${esc(t(pick.hint))}"`;
    return `<div class="nb-pick">
        <label class="field nb-field"><span>${t(pick.label)}</span>
          <input class="input${pick.mono ? " mono" : ""}" id="nb-pick" ${kind} dir="${pick.ltr ? "ltr" : "auto"}" value="${esc(typed)}" autocomplete="off" spellcheck="false"></label>
        ${pick.list ? `<datalist id="nb-pick-list"></datalist>` : ""}
        <div id="nb-pick-target">${pickerTarget(choice)}</div>
      </div>`;
  }
  /* The folders pages sit in, from their addresses, for the sample. The server works them out the same way. */
  function sectionsOf(pageList) {
    const counts = new Map();
    pageList.forEach((p) => {
      const m = /^(https?:\/\/[^/]+)\/(.*)$/.exec(p.url || "");
      if (!m) return;
      const parts = m[2].split("?")[0].split("/").slice(0, -1);
      for (let depth = 1; depth <= Math.min(parts.length, 3); depth += 1) { const url = `${m[1]}/${parts.slice(0, depth).join("/")}/`; counts.set(url, (counts.get(url) || 0) + 1); }
    });
    return [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([url, pages]) => ({ url, pages }));
  }
  async function pickerOptions(siteId) {
    const key = siteOf(siteId) ?? "*";
    if (pickerState.options.has(key)) return pickerState.options.get(key);
    if (!pickerState.loading.has(key)) {
      pickerState.loading.set(key, (async () => {
        if (serverMode === null) serverMode = await COMP.isServer();
        let found = { pages: [], sections: [], keywords: [], domains: [], tasks: [] };
        if (serverMode) found = { ...found, ...(await COMP.api("GET", `notes/options${key === "*" ? "" : `?site_id=${key}`}`)) };
        else { // the sample knows pages and tasks: anything else is typed
          const get = window.COMP_SAMPLE?.get || {};
          found.pages = Object.entries(get).filter(([path]) => /^sites\/\d+\/pages$/.test(path) && (key === "*" || path === `sites/${key}/pages`)).flatMap(([, a]) => a.pages || []);
          found.sections = sectionsOf(found.pages);
        }
        // Competitors: the site's own list, or every site's when no site is picked.
        const ids = key === "*" ? COMP.sites.map((x) => x.id) : [key];
        const lists = await Promise.all(ids.map((id) => COMP.api("GET", `competitors?site_id=${id}`).then((a) => a.competitors || []).catch(() => [])));
        const rivals = new Map();
        lists.flat().forEach((c) => { if (!rivals.has(c.id)) rivals.set(c.id, { id: c.id, host: c.host, display: c.display || c.host }); });
        found.competitors = [...rivals.values()].sort((a, b) => a.host.localeCompare(b.host));
        pickerState.options.set(key, found);
        return found;
      })().finally(() => pickerState.loading.delete(key)));
    }
    return pickerState.loading.get(key);
  }
  async function fillPickerList(choice) {
    const pick = PICKS[choice.pick];
    if (!pick.list) return;
    let found;
    try { found = await pickerOptions(choice.where.siteId); } catch { return; } // typing still works
    const list = UI.$("#nb-pick-list");
    if (!list || panelState.choices[panelState.pick] !== choice) return;
    list.replaceChildren(...pick.list(found).map(([value, label]) => { const o = document.createElement("option"); o.value = value; if (label) o.label = label; return o; }));
  }
  /* The panel is about to show something else. A note written in it has been left, so it saves and joins its list now:
     the focusout handler takes a field that disappears for a repaint and would wait for it to come back. */
  function leaveComposers(box) {
    if (!box) return;
    caret = null;
    UI.$$("textarea[data-note-composer]", box).forEach((el) => {
      const e = entries.get(el.dataset.noteField);
      if (!e || !e.composer) return;
      if (dirty(e) && (!blank(e.text) || holdsFiles(e)) && e.status !== "refused") save(e);
      if ((!blank(e.text) || holdsFiles(e)) && e.status !== "refused" && e.status !== "waiting") commit(e);
    });
  }

  /* A linking website as the server keeps it: no scheme, path or www. */
  const cleanDomain = (text) => String(text || "").trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#]/)[0].split(":")[0].replace(/^www\./, "").replace(/\.$/, "");

  /* What was typed or picked, made into what the note is about. Returns [shown value, fields, or a reason it can't be]. */
  async function resolvePick(choice, value) {
    const host = UI.siteHostPicked?.();
    const fullAddress = (text) => withScheme(text.startsWith("/") && host ? `https://${host}${text}` : text);
    if (!value) return [value, {}];
    switch (choice.pick) {
      case "page": { const url = fullAddress(value); return [url, { pageUrl: url }]; }
      case "section": {
        let url = fullAddress(value).split(/[?#]/)[0];
        if (!url.endsWith("/")) url += "/";
        if (!/^https?:\/\/[^/]+\/.+\/$/.test(url)) return [url, null, "That's the whole site: add a folder like /blog/, or write on the website."];
        return [url, { pageUrl: url }];
      }
      case "keyword": return [value, { keyword: value }];
      case "date": return /^\d{4}-\d{2}-\d{2}$/.test(value) ? [value, { day: value }] : [value, null, "Pick a day."];
      case "domain": { const d = cleanDomain(value); return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? [d, { domain: d }] : [value, null, "Enter the linking website, such as example.com."]; }
      case "task": {
        const found = await pickerOptions(choice.where.siteId).catch(() => ({ tasks: [] }));
        const all = found.tasks || [], typed = value.trim().toLowerCase();
        const task = all.find((x) => taskValue(x, all).trim().toLowerCase() === typed) || all.find((x) => x.title.trim().toLowerCase() === typed);
        return task ? [taskValue(task, all), { taskId: task.id, task: task.title }] : [value, null, "No such task. Pick one from the list."];
      }
      case "competitor": {
        const wanted = cleanDomain(value);
        const found = await pickerOptions(choice.where.siteId).catch(() => ({ competitors: [] }));
        const rival = (found.competitors || []).find((c) => c.host.toLowerCase().replace(/^www\./, "") === wanted);
        return rival ? [rival.host, { competitorId: rival.id, competitor: rival.host }] : [value, null, "No such competitor. Pick one, or add it under Competitors."];
      }
      default: return [value, null, ""];
    }
  }
  const CLEARED = { page: { pageUrl: null }, section: { pageUrl: null }, keyword: { keyword: null }, date: { day: null }, domain: { domain: null }, task: { taskId: null, task: null }, competitor: { competitorId: null, competitor: null } };

  /* The person has settled on what the note is about: show its notes and the field to write one. */
  async function pickTarget(raw, { focus = false } = {}) {
    const choice = panelState.choices[panelState.pick];
    if (!choice?.pick) return;
    const [value, fields, why] = await resolvePick(choice, String(raw || "").replace(/\s+/g, " ").trim());
    if (panelState.choices[panelState.pick] !== choice) return; // another chip was picked meanwhile
    choice.unknown = fields ? "" : why;
    const changes = { ...CLEARED[choice.pick], ...(fields || {}) };
    choice.typed = value;
    const input = UI.$("#nb-pick");
    if (input && input.value !== value && fields) input.value = value; // the address in full, as it's saved
    if (fields && value && value === pickedValue(choice)) { if (focus) UI.$("#nb-pick-target textarea[data-note-composer]")?.focus(); return; }
    choice.where = { ...choice.where, ...changes };
    const box = UI.$("#nb-pick-target");
    if (!box) return;
    leaveComposers(box);
    UI.setHTML(box, pickerTarget(choice));
    mount();
    if (focus) UI.$("#nb-pick-target textarea[data-note-composer]")?.focus({ preventScroll: true });
  }

  function panelHtml() {
    const { t, esc, icon } = UI;
    const chip = (c, i) => `<button class="chip nb-way" data-note-panel-pick="${i}" aria-pressed="${i === panelState.pick}">${icon(c.icon)}<span dir="auto">${esc(c.label)}</span></button>`;
    // First row: what's on screen. Second row: anything else, then All notes, which is a list and not a place to write.
    const here = panelState.choices.map((c, i) => (c.pick || c.id === PANEL_ALL ? "" : chip(c, i))).join("");
    const picks = panelState.choices.map((c, i) => (c.pick ? chip(c, i) : "")).join("") + panelState.choices.map((c, i) => (c.id === PANEL_ALL ? chip(c, i) : "")).join("");
    return `${UI.panelHead(t("Notes"), t("Saves by itself"))}
      <div class="panel-body nb-panel">
        <div class="nb-ways" role="group" aria-label="${t("What the note is about")}">${here}</div>
        ${picks ? `<div class="nb-ways nb-ways-pick" role="group" aria-label="${t("Or about something else")}"><span class="small muted">${t("Or about")}</span>${picks}</div>` : ""}
        <div id="nb-panel-body">${panelBody()}</div>
      </div>`;
  }

  async function afterPanelBody() {
    const choice = panelState.choices[panelState.pick];
    if (choice?.pick) {
      mount();
      fillPickerList(choice);
      const field = pickedValue(choice) ? UI.$("#nb-panel-body textarea[data-note-composer]") : UI.$("#nb-pick");
      field?.focus({ preventScroll: true });
      return;
    }
    if (choice?.id !== PANEL_ALL) {
      mount();
      UI.$("#nb-panel-body textarea[data-note-composer]")?.focus({ preventScroll: true });
      return;
    }
    UI.$$('#nb-panel-body [data-note-list="*"]').forEach(paintList);
    paintPanelEmpty();
    try {
      ingest(await fetchNotes("notes"), ALL_NOTES);
      panelState.failed = false;
    } catch { panelState.failed = true; }
    if (UI.$("#nb-panel-body") && panelState.choices[panelState.pick]?.id === PANEL_ALL) { paintAll(); paintPanelEmpty(); }
  }

  function paintPanelEmpty() {
    const box = UI.$("#nb-panel-empty");
    if (!box) return;
    const shown = wantedFor(ALL_NOTES).length;
    box.hidden = shown > 0;
    box.textContent = UI.t(tabState.search.trim() ? "No notes match this search." : "No notes yet");
  }

  function pickPanel(i) {
    if (!panelState.choices[i] || i === panelState.pick) return;
    panelState.pick = i;
    UI.$$("[data-note-panel-pick]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.notePanelPick) === i)));
    const box = UI.$("#nb-panel-body");
    if (!box) return;
    leaveComposers(box);
    UI.setHTML(box, panelBody());
    afterPanelBody();
  }

  function panel(choices, opener, pick = 0) {
    panelState.choices = [...choices, { id: PANEL_ALL, label: UI.t("All notes"), icon: "list-ordered" }];
    panelState.pick = Math.min(pick, panelState.choices.length - 1);
    UI.openPanel(panelHtml(), opener);
    UI.$("#panel")?.classList.add("nb-panel-wrap");
    afterPanelBody();
  }

  /* How many notes a target holds, for the "Notes · 2" buttons. Asks the server once per target. */
  const preloaded = new Set();
  function preload(where) {
    const key = keyOf(where);
    if (preloaded.has(key)) { paintCounts(); return; }
    preloaded.add(key);
    fetchNotes(pathFor(where)).then((list) => { ingest(list, key); paintCounts(); }).catch(() => preloaded.delete(key));
  }
  /* Notes on a target: those loaded for it, and those loaded with All notes that belong to it. */
  const countFor = (key) => [...entries.values()].filter((e) => !e.removed && !e.composer && !(blank(e.text) && !e.id) && (e.targets.has(key) || keyOf(whereOf(e)) === key)).length;
  function paintCounts() {
    if (!UI) return;
    UI.$$("[data-note-count]").forEach((el) => {
      const n = el.dataset.noteCount.split(" ").reduce((sum, key) => sum + countFor(key), 0);
      el.textContent = n ? UI.num(n) : "";
      el.hidden = !n;
    });
  }

  /* A "Notes · 2" button for a page's header. choices: [{ label, icon, where }], shown first in the panel. */
  function button(choices) {
    const { t, esc, icon } = UI;
    const keys = choices.map((c) => keyOf(c.where)).join(" ");
    return `<button class="btn nb-open" data-notes-open="${esc(JSON.stringify(choices))}">${icon("pencil")}${t("Notes")}<span class="nb-count tabular" data-note-count="${esc(keys)}" hidden></span></button>`;
  }

  /* A small note icon beside one row of a long table, such as a linking website in Backlinks. Every badge counts from one
     load of all notes, never one request per row. */
  const SCOPE_ICONS = { domain: "link-2", task: "square-check", date: "calendar-days", section: "folder-open", keyword: "key-round", page: "file-text", competitor: "crosshair" };
  function badge(where, label) {
    const { t, esc, icon } = UI;
    const name = `${t("Notes")}: ${label}`;
    const choice = [{ label, icon: SCOPE_ICONS[where.scope] || "pencil", where }];
    return `<button type="button" class="nb-badge" data-notes-light="1" data-notes-open="${esc(JSON.stringify(choice))}" aria-label="${esc(name)}" data-tip="${esc(name)}">${icon("sticky-note")}<span class="nb-count tabular" data-note-count="${esc(keyOf(where))}" hidden></span></button>`;
  }
  let allOnce = null;
  function loadAllOnce() {
    if (!allOnce) allOnce = fetchNotes("notes").then((list) => { ingest(list, ALL_NOTES); paintCounts(); }).catch(() => { allOnce = null; });
    else paintCounts();
    return allOnce;
  }

  /* The Notes screen in the side menu (notes-view.js): every note of every site, in one list.
     loadEvery() asks the server each time the screen opens, so a note written on another computer shows. */
  async function loadEvery() {
    if (serverMode === null) serverMode = await COMP.isServer();
    ingest(await fetchNotes("notes"), ALL_NOTES);
    allOnce = Promise.resolve();
  }
  const every = {
    KINDS, kindCounts, loadEvery,
    total: () => listed().length,
    shown: (kind) => wantedFor(ALL_NOTES, kind).length,
    search: () => tabState.search,
    setSearch(text) { tabState.search = text; },
    paint() { if (UI) { UI.$$("[data-note-list]").forEach(paintList); paintCounts(); } },
  };

  /* Save a finished note without a field on screen. A refusal throws; a lost connection is retried like any other note. */
  async function add(where, text) {
    const e = newEntry({ ...where, text, sortAt: Date.now() });
    await write(e);
    if (!e.id && e.status === "refused") { entries.delete(e.uid); throw new Error(e.message); }
    paintAll();
    return e;
  }

  COMP.notes = { block, mount, panel, preload, keyOf, screenName, button, badge, loadAllOnce, every, add };

  // ---- the Notes tab ---------------------------------------------------------------------------
  const tabState = { way: "all", competitorId: null, pageUrl: "", pageTyped: "", search: "", competitors: [], listFailed: false };

  function tabWhere() {
    const siteId = COMP.siteId;
    if (tabState.way === "competitor") {
      const rival = tabState.competitors.find((c) => c.id === tabState.competitorId);
      return { scope: "competitor", competitorId: rival ? rival.id : null, competitor: rival ? rival.host : null, pageUrl: null, siteId };
    }
    if (tabState.way === "page") return { scope: "page", competitorId: null, competitor: null, pageUrl: tabState.pageUrl.trim() || null, siteId };
    return { scope: "all", competitorId: null, competitor: null, pageUrl: null, siteId };
  }

  /* What the "new note" field is about changed. A note that already exists stays as it is, and the field starts a new one. */
  function retarget() {
    const e = composers.get(TAB);
    if (!e) return;
    if (e.id) { commit(e); return; }
    Object.assign(e, tabWhere());
    if (dirty(e)) save(e);
    else if (e.status === "waiting") { e.status = "idle"; paintStatus(e); }
  }

  function wayExtra() {
    const { t, esc } = UI;
    if (tabState.way === "competitor") {
      return tabState.competitors.length
        ? `<label class="field nb-field"><span>${t("Competitor")}</span><select class="select" id="nb-competitor"><option value="" ${tabState.competitorId === null ? "selected" : ""}>${t("Choose a competitor")}</option>${tabState.competitors.map((c) => `<option value="${c.id}" ${c.id === tabState.competitorId ? "selected" : ""}>${esc(c.display || c.host)}</option>`).join("")}</select></label>`
        : `<p class="note nb-field">${UI.icon("info")}<span>${t("No competitors yet. Add one under My competitors, or write on All competitors.")}</span></p>`;
    }
    if (tabState.way === "page") {
      return `<label class="field nb-field"><span>${t("Page address")}</span><input class="input mono" id="nb-page" dir="ltr" placeholder="https://example.com/page" value="${esc(tabState.pageTyped)}" autocomplete="off" spellcheck="false"></label><p class="help nb-help">${t("Any page, yours or theirs.")}</p>`;
    }
    return "";
  }

  const WAYS = [["all", "All competitors", "users"], ["competitor", "One competitor", "crosshair"], ["page", "A page", "file-text"]];
  const waysHtml = () => WAYS.map(([id, label, name]) => `<button class="chip nb-way" data-note-way="${id}" aria-pressed="${tabState.way === id}">${UI.icon(name)}${UI.t(label)}</button>`).join("");

  function pickWay(way) {
    if (tabState.way === way) return;
    tabState.way = way;
    // No default: a note about one competitor shouldn't land on whichever name is first.
    if (way === "competitor" && !tabState.competitors.some((c) => c.id === tabState.competitorId)) tabState.competitorId = null;
    UI.$$("[data-note-way]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.noteWay === way)));
    const box = UI.$("#nb-way-extra");
    if (box) UI.setHTML(box, wayExtra());
    retarget();
  }

  function paintTabSummary() {
    const count = UI.$("#nb-count"), box = UI.$("#nb-all-empty");
    if (!count && !box) return;
    const total = [...entries.values()].filter((e) => !e.removed && !e.composer && !(blank(e.text) && !e.id)).length;
    const shown = wantedFor(ALL_NOTES).length;
    if (count) count.textContent = tabState.search.trim() ? `${UI.num(shown)} ${UI.t("of")} ${UI.num(total)}` : UI.num(total);
    if (!box) return;
    const { t } = UI;
    if (total === 0 && !tabState.listFailed) {
      UI.setHTML(box, `<div class="empty"><h3>${t("No notes yet")}</h3><p>${t("Write one above.")}</p>
        <ul class="nb-kinds small sec"><li>${UI.icon("users")}<span><b>${t("All competitors")}.</b> ${t("A rule for all of them.")}</span></li><li>${UI.icon("crosshair")}<span><b>${t("One competitor")}.</b> ${t("What you've noticed about them.")}</span></li><li>${UI.icon("file-text")}<span><b>${t("A page")}.</b> ${t("Any page, yours or theirs.")}</span></li></ul></div>`);
    } else if (total > 0 && shown === 0) UI.setHTML(box, `<p class="lc-none small muted">${t("No notes match this search.")}</p>`);
    else UI.setHTML(box, "");
  }

  COMP.addTab({
    id: "notes",
    order: 60,
    label: "Notes",
    icon: "pencil",
    init(helpers) {
      UI = helpers;
      bindEvents();
      COMP.isServer().then((server) => {
        serverMode = server;
        if (!server) sampleDb.load();
        restoreDrafts();
        paintAll();
      });
    },
    async load() {
      const siteId = COMP.siteId;
      const listed = (await COMP.api("GET", `competitors?site_id=${siteId}`).catch(() => ({ competitors: [] }))).competitors || [];
      if (siteId !== COMP.siteId) return; // another site was picked while this was on its way
      tabState.competitors = listed;
      if (!tabState.competitors.some((c) => c.id === tabState.competitorId)) tabState.competitorId = null; // no default: see pickWay
      try {
        ingest(await fetchNotes("notes"), ALL_NOTES);
        tabState.listFailed = false;
      } catch { tabState.listFailed = true; }
    },
    body() {
      const { t, esc, icon } = UI;
      rememberCaret();
      const e = composerFor(TAB, tabWhere());
      return `<section class="card nb-new">
          <div class="card-head"><h2>${t("Write a note")}</h2><span class="end small muted">${t("Saves by itself")}</span></div>
          <div class="nb-new-body">
            <div class="nb-ways" role="group" aria-label="${t("What the note is about")}">${waysHtml()}</div>
            <div id="nb-way-extra">${wayExtra()}</div>
            ${composeField(e, TAB, t("Write a note"))}
          </div>
        </section>
        <section class="card nb-all">
          <div class="card-head"><h2>${t("All notes")}</h2><span class="small muted tabular" id="nb-count"></span>
            <label class="nb-search end"><span class="sr">${t("Search notes")}</span>${icon("search")}<input class="input" id="nb-search" type="search" placeholder="${t("Search notes")}" value="${esc(tabState.search)}"></label></div>
          ${tabState.listFailed ? `<p class="note warn nb-load-error">${icon("triangle-alert")}<span>${t("Notes didn't load. What you write is still kept.")}</span></p>` : ""}
          <ul class="nb-list" data-note-list="${ALL_NOTES}"></ul>
          <div id="nb-all-empty"></div>
        </section>`;
    },
    after() {
      UI.$$("#comp-body textarea[data-note-field]").forEach((el) => { const e = entries.get(el.dataset.noteField); if (e) { fill(el, e); paintFiles(e); } });
      UI.$$('[data-note-list="*"]').forEach(paintList);
      paintTabSummary();
      mount();
      restoreCaret();
    },
  });

  // ---- events: one set, for every block and for the tab ----------------------------------------
  function bindEvents() {
    document.addEventListener("input", (ev) => {
      const el = ev.target;
      if (el.dataset?.noteField) {
        const e = entries.get(el.dataset.noteField);
        if (!e) return;
        typed(e, el.value);
        autosize(el);
        fieldsFor(e).forEach((other) => { if (other !== el) fill(other, e); });
        return;
      }
      if (el.id === "nb-search" || el.id === "nb-panel-search") { tabState.search = el.value; UI.$$('[data-note-list="*"]').forEach(paintList); paintTabSummary(); paintPanelEmpty(); return; }
      if (el.id === "nb-page") tabState.pageTyped = el.value; // half an address must never become a note's page: it counts on leaving the field
    });
    document.addEventListener("change", (ev) => {
      const el = ev.target;
      if (el.id === "nb-competitor") { tabState.competitorId = el.value === "" ? null : Number(el.value); retarget(); }
      if (el.id === "nb-page") { tabState.pageUrl = el.value; retarget(); }
      if (el.id === "nb-pick") pickTarget(el.value);
    });
    // Picking from the list counts at once; typing counts on Enter or on leaving the field.
    document.addEventListener("input", (ev) => {
      const el = ev.target;
      if (el.id !== "nb-pick") return;
      const choice = panelState.choices[panelState.pick];
      if (choice) choice.typed = el.value;
      const listed = [...(UI.$("#nb-pick-list")?.options || [])].some((o) => o.value === el.value);
      if (listed && (ev.inputType === "insertReplacementText" || ev.inputType === undefined)) pickTarget(el.value, { focus: true });
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.target.id === "nb-pick" && ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); pickTarget(ev.target.value, { focus: true }); }
    });
    // Leaving the field saves at once, and only then does the note settle into the list.
    document.addEventListener("focusout", (ev) => {
      const el = ev.target;
      if (!el.dataset?.noteField) return;
      const e = entries.get(el.dataset.noteField);
      if (!e) return;
      if (dirty(e) && (!blank(e.text) || holdsFiles(e)) && e.status !== "refused") save(e); // a refused note waits for a change: sending it again gets the same answer
      const start = el.selectionStart, end = el.selectionEnd, top = el.scrollTop;
      setTimeout(() => {
        if (!el.isConnected) { caret = { uid: e.uid, start, end, top, at: Date.now() }; restoreCaret(); return; } // a repaint took it
        if (document.activeElement === el) return; // the window lost focus, not the field
        whenReleased(() => settle(e));
      }, 0);
    });
    // Pressing the button leaves the caret in the note, so the file joins the note being written and not the next one.
    document.addEventListener("mousedown", (ev) => { if (ev.target.closest?.("[data-note-attach]")) ev.preventDefault(); });
    // A screenshot pastes as a file. Something copied with text too, such as a spreadsheet cell, stays text.
    document.addEventListener("paste", (ev) => {
      const el = ev.target;
      if (!el.dataset?.noteField) return;
      const files = [...(ev.clipboardData?.files || [])];
      if (!files.length || ev.clipboardData.getData("text/plain")) return;
      ev.preventDefault();
      addFiles(entries.get(el.dataset.noteField), files);
    });
    document.addEventListener("dragover", (ev) => {
      const hit = carriesFiles(ev) ? dropTarget(ev.target) : null;
      UI.$$(".nb-drop").forEach((z) => { if (z !== hit?.zone) z.classList.remove("nb-drop"); });
      if (!hit) return;
      ev.preventDefault();
      hit.zone.classList.add("nb-drop");
    });
    document.addEventListener("dragleave", (ev) => { if (!ev.relatedTarget) UI.$$(".nb-drop").forEach((z) => z.classList.remove("nb-drop")); });
    document.addEventListener("drop", (ev) => {
      UI.$$(".nb-drop").forEach((z) => z.classList.remove("nb-drop"));
      const hit = carriesFiles(ev) ? dropTarget(ev.target) : null;
      if (!hit) return;
      ev.preventDefault();
      addFiles(hit.e, ev.dataTransfer.files);
    });
    document.addEventListener("pointerdown", () => { pressed = true; }, true);
    const released = () => {
      pressed = false;
      if (afterPress.length) setTimeout(() => { afterPress.splice(0).forEach((fn) => fn()); }, 0);
    };
    document.addEventListener("pointerup", released, true);
    document.addEventListener("pointercancel", released, true);
    document.addEventListener("click", (ev) => {
      const target = ev.target;
      let el;
      if ((el = target.closest?.("[data-note-attach]"))) {
        const input = choosePicker();
        input.dataset.uid = el.dataset.noteAttach;
        input.click();
        return;
      }
      if ((el = target.closest?.("[data-note-file-remove]"))) {
        const [uid, id] = el.dataset.noteFileRemove.split("|");
        const e = entries.get(uid);
        const file = e?.files.find((f) => String(f.id) === id);
        if (file) removeFile(e, file);
        return;
      }
      if ((el = target.closest?.("[data-note-delete]"))) {
        const e = entries.get(el.dataset.noteDelete);
        if (!e) return;
        const row = el.closest("[data-note-row]");
        const next = row?.nextElementSibling?.querySelector("[data-note-delete]") || row?.previousElementSibling?.querySelector("[data-note-delete]");
        const composer = el.closest(".card")?.querySelector("textarea[data-note-composer]") || UI.$("textarea[data-note-composer]");
        removeNote(e);
        (next?.isConnected ? next : composer)?.focus({ preventScroll: true });
        return;
      }
      if ((el = target.closest?.("[data-note-keep-mine]"))) { // a clash: this person's words go over the teammate's
        const e = entries.get(el.dataset.noteKeepMine);
        if (e?.clash) { Object.assign(e, { updatedAt: e.clash.updated_at, base: null, clash: null, forceMine: true, resolved: true, status: "saving" }); save(e); fieldsFor(e)[0]?.focus({ preventScroll: true }); }
        return;
      }
      if ((el = target.closest?.("[data-note-use-theirs]"))) { // a clash: the teammate's words replace these
        const e = entries.get(el.dataset.noteUseTheirs);
        if (e?.clash) {
          const n = e.clash;
          Object.assign(e, { text: n.body, saved: n.body, updatedAt: n.updated_at, updatedBy: n.updated_by ?? null, base: null, clash: null, resolved: true, status: "saved", savedAt: new Date() });
          clearTimeout(e.timer); e.timer = null;
          fieldsFor(e).forEach((field) => fill(field, e));
          writeDrafts();
          paintStatus(e);
          fieldsFor(e)[0]?.focus({ preventScroll: true });
        }
        return;
      }
      if ((el = target.closest?.("[data-note-next]"))) {
        const e = entries.get(el.dataset.noteNext);
        const key = e?.composer;
        if (e?.composer) commit(e);
        (key ? UI.$(`textarea[data-note-composer="${CSS.escape(key)}"]`) : UI.$("textarea[data-note-composer]"))?.focus({ preventScroll: true });
        return;
      }
      if ((el = target.closest?.("[data-note-way]"))) { pickWay(el.dataset.noteWay); return; }
      if ((el = target.closest?.("[data-note-panel-pick]"))) { pickPanel(Number(el.dataset.notePanelPick)); return; }
      if ((el = target.closest?.("[data-note-competitor]")) && el.tagName === "BUTTON") COMP.open("list", { competitorId: Number(el.dataset.noteCompetitor) });
    });
    window.addEventListener("online", () => entries.forEach((e) => { if (e.status === "failed" && !e.removed && !e.busy) save(e); }));
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
    window.addEventListener("pagehide", flush);
  }

  // ---- opened as a plain file: notes live in the sample, and in this browser ----------------------
  /* The same rule the server has for one spelling of an address. */
  function normalize(url) {
    try {
      const u = new URL(withScheme(url));
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      const keep = [...u.searchParams.entries()].filter(([k]) => !/^utm_/i.test(k) && !["gclid", "gbraid", "wbraid", "dclid", "fbclid", "msclkid", "yclid", "igshid", "mc_cid", "mc_eid", "_ga", "_gl", "ref_src"].includes(k.toLowerCase())).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const query = new URLSearchParams(keep).toString();
      return `${u.protocol}//${u.host}${u.pathname}${query ? `?${query}` : ""}`;
    } catch { return ""; }
  }
  const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const refusal = (message, status = 400) => Object.assign(new Error(message), { status });

  const sampleDb = {
    notes: [], next: 1, nextFile: 1, loaded: false,
    load() {
      if (this.loaded) return;
      this.loaded = true;
      let kept = null;
      try { kept = JSON.parse(UI.store.get(SAMPLE_KEY) || "null"); } catch { kept = null; }
      this.notes = kept?.notes || JSON.parse(JSON.stringify(window.COMP_SAMPLE.get.notes?.notes || []));
      this.next = kept?.next || this.notes.reduce((top, n) => Math.max(top, n.id), 0) + 1;
      this.nextFile = kept?.nextFile || 1;
      this.publish();
    },
    matches(query, n) {
      if (n.deleted || (n.body === "" && !(n.files || []).some((f) => !f.deleted))) return false;
      const q = new URLSearchParams(query);
      if (q.get("scope") && n.scope !== q.get("scope")) return false;
      if (q.get("competitor_id") && n.competitor_id !== Number(q.get("competitor_id"))) return false;
      const askedUrl = q.get("page_url") ? normalize(q.get("page_url")) || q.get("page_url") : "";
      if (askedUrl && n.page_url !== askedUrl && !(q.get("scope") !== "section" && n.scope === "section" && askedUrl.startsWith(n.page_url))) return false;
      if (q.get("day") && n.day !== q.get("day")) return false;
      if (q.get("domain") && n.domain !== q.get("domain").toLowerCase()) return false;
      if (q.get("task_id") && n.task_id !== Number(q.get("task_id"))) return false;
      if (q.get("screen") && n.screen !== q.get("screen")) return false;
      if (q.get("keyword") && keywordKey(n.keyword) !== keywordKey(q.get("keyword"))) return false;
      if (q.get("site_id") && n.site_id !== null && n.site_id !== Number(q.get("site_id"))) return false;
      return true;
    },
    answer(query) {
      const notes = this.notes.filter((n) => this.matches(query, n)).sort((a, b) => stamp(b.updated_at) - stamp(a.updated_at) || b.id - a.id).map((n) => this.shown(n));
      return { notes };
    },
    shown({ deleted, ...n }) { return { ...n, files: (n.files || []).filter((f) => !f.deleted) }; },
    /* Every notes answer in the sample stays true, and a question it has never been asked gets an answer ready. */
    publish(extra = null) {
      const get = window.COMP_SAMPLE.get;
      Object.keys(get).filter((path) => path === "notes" || path.startsWith("notes?")).concat(extra || []).forEach((path) => { get[path] = this.answer(path.split("?")[1] || ""); });
    },
    persist() {
      // This browser's storage is small, so a large file in the sample lasts until the page is reloaded. The real app keeps every file.
      const light = this.notes.map((n) => ({ ...n, files: (n.files || []).filter((f) => (f.url || "").length < 1000000) }));
      UI.store.set(SAMPLE_KEY, JSON.stringify({ notes: light, next: this.next, nextFile: this.nextFile }));
      this.publish();
    },
    find(id) {
      const n = this.notes.find((x) => x.id === id);
      if (!n) throw refusal("That note doesn't exist.", 404);
      return n;
    },
    checkBody(body) {
      if (typeof body !== "string") throw refusal("A note needs some text.");
      if (new Blob([body]).size > MAX_BYTES) throw refusal("Note too long. Your text is still here: split it in two.");
    },
    create(b) {
      this.checkBody(b.body);
      if (!["all", "competitor", "page", "site", "screen", "keyword", "date", "domain", "section", "task"].includes(b.scope)) throw refusal("That isn't something a note can go on.");
      if (b.scope === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(b.day || "")) throw refusal("Pick a day.");
      if (b.scope === "domain" && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(b.domain || "")) throw refusal("Enter the linking website, such as example.com.");
      if (b.scope === "task" && typeof b.task_id !== "number") throw refusal("Say which task this note is about.");
      if (b.scope === "keyword" && !keywordKey(b.keyword)) throw refusal("Enter the keyword.");
      if (b.scope === "screen" && !SCREEN_NAMES[b.screen]) throw refusal("Say which screen this note is about.");
      if (b.scope === "competitor" && typeof b.competitor_id !== "number") throw refusal("Say which competitor this note is about.");
      const pageUrl = b.scope === "page" ? normalize(b.page_url) : b.scope === "section" ? (normalize(b.page_url).replace(/\/?$/, "/") || null) : null;
      if (b.scope === "page" && !pageUrl) throw refusal("Enter the page's address.");
      const known = Object.entries(window.COMP_SAMPLE.get).filter(([path]) => /^competitors\?site_id=/.test(path)).flatMap(([, a]) => a.competitors || []);
      if (b.competitor_id !== null && b.competitor_id !== undefined && !known.some((c) => c.id === b.competitor_id)) throw refusal("That competitor doesn't exist.", 404);
      const at = nowIso();
      const n = { id: this.next++, scope: b.scope, site_id: b.site_id ?? null, competitor_id: ["all", "competitor", "page"].includes(b.scope) && b.scope !== "all" ? b.competitor_id ?? null : null, screen: b.scope === "screen" ? b.screen : null, keyword: b.scope === "keyword" ? String(b.keyword).replace(/\s+/g, " ").trim() : null,
        day: b.scope === "date" ? b.day : null, domain: b.scope === "domain" ? b.domain.toLowerCase().replace(/^www\./, "") : null, task_id: b.scope === "task" ? b.task_id : null,
        task: b.scope === "task" ? (window.TASKS?.list?.() || []).find((x) => x.id === b.task_id)?.title ?? null : null, competitor: known.find((c) => c.id === b.competitor_id)?.host ?? null, page_url: pageUrl, body: b.body, created_at: at, updated_at: at };
      this.notes.push(n);
      this.persist();
      return this.shown(n);
    },
    update(id, body) {
      this.checkBody(body);
      const n = this.find(id);
      n.body = body;
      n.updated_at = nowIso();
      this.persist();
      return this.shown(n);
    },
    remove(id) { this.find(id).deleted = true; this.persist(); return { ok: true }; },
    bringBack(id) { const n = this.find(id); delete n.deleted; this.persist(); return this.shown(n); },
    addFile(id, file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(refusal("That file couldn't be read."));
        reader.onload = () => {
          const n = this.find(id);
          n.files = [...(n.files || []), { id: this.nextFile++, name: file.name || "image.png", size: file.size, is_image: /^image\/(png|jpeg|gif|webp)$/.test(file.type), url: reader.result }];
          n.updated_at = nowIso();
          this.persist();
          resolve(this.shown(n));
        };
        reader.readAsDataURL(file);
      });
    },
    fileOwner(id) { return this.notes.find((n) => (n.files || []).some((f) => f.id === id)); },
    markFile(id, deleted) {
      const n = this.fileOwner(id);
      if (!n) throw refusal("That file doesn't exist.", 404);
      n.files.find((f) => f.id === id).deleted = deleted;
      this.persist();
      return this.shown(n);
    },
  };
  COMP.sampleWrite("POST notes", (match, body) => sampleDb.create(body));
  COMP.sampleWrite("PATCH notes/(\\d+)", (match, body) => sampleDb.update(Number(match[1]), body.body));
  COMP.sampleWrite("DELETE notes/(\\d+)", (match) => sampleDb.remove(Number(match[1])));
  COMP.sampleWrite("POST notes/(\\d+)/restore", (match) => sampleDb.bringBack(Number(match[1])));
  COMP.sampleWrite("DELETE note-files/(\\d+)", (match) => sampleDb.markFile(Number(match[1]), true));
  COMP.sampleWrite("POST note-files/(\\d+)/restore", (match) => sampleDb.markFile(Number(match[1]), false));

  Object.assign(window.FR, {
    "Notes": "Notes",
    "Note": "Note",
    "Write a note": "Écrire une note",
    "Write, paste or drop a file": "Écrivez, collez ou déposez un fichier",
    "Add text": "Ajouter du texte", "Add file": "Ajouter un fichier", "Adding {name}…": "Ajout de {name}…", "Remove {name}": "Retirer {name}", "File deleted": "Fichier supprimé",
    "{name} is over 25 MB.": "{name} dépasse 25 Mo.", "Couldn't add {name}: {why}": "Impossible d'ajouter {name} : {why}", "Note not saved.": "Note non enregistrée.",
    "Couldn't delete this file. Try again.": "Impossible de supprimer ce fichier. Réessayez.", "Couldn't restore the file.": "Impossible de restaurer le fichier.",
    "This file is over 25 MB.": "Ce fichier dépasse 25 Mo.", "That file is empty.": "Ce fichier est vide.", "Choose a file to add.": "Choisissez un fichier à ajouter.", "That file doesn't exist.": "Ce fichier n'existe pas.", "That file couldn't be read.": "Ce fichier n'a pas pu être lu.",
    "Saves by itself": "S'enregistre tout seul",
    "Saving…": "Enregistrement…",
    "Saved {time}": "Enregistré à {time}", "Joins the list when you leave.": "Rejoint la liste quand vous quittez le champ.", "New note": "Nouvelle note", "Choose a competitor": "Choisissez un concurrent",
    "Last changed": "Modifié",
    "Couldn't save. Kept on this computer; trying again.": "Enregistrement impossible. Gardée sur cet ordinateur, nouvel essai en cours.",
    "An empty note isn't kept.": "Une note vide n'est pas gardée.",
    "Empty note removed": "Note vide retirée",
    "Note deleted": "Note supprimée",
    "Someone deleted this note. Your text is saved as a new note.": "Quelqu'un a supprimé cette note. Votre texte est enregistré dans une nouvelle note.",
    "Someone else changed this note. Yours isn't saved yet.": "Quelqu'un d'autre a modifié cette note. La vôtre n'est pas encore enregistrée.",
    "It now says": "Elle indique maintenant", "changed": "modifiée",
    "Keep mine": "Garder la mienne", "Use theirs": "Reprendre la leur",
    "by {name}": "par {name}", "Written by {name}": "Écrite par {name}",
    "Couldn't delete this note. Try again.": "Impossible de supprimer cette note. Réessayez.",
    "Delete this note": "Supprimer cette note",
    "Enter the page address to save. Kept on this computer.": "Saisissez l'adresse de la page pour enregistrer. Gardée sur cet ordinateur.",
    "Choose a competitor to save. Kept on this computer.": "Choisissez un concurrent pour enregistrer. Gardée sur cet ordinateur.",
    "Notes on this competitor": "Notes sur ce concurrent",
    "Notes on this page": "Notes sur cette page",
    "Notes on all competitors": "Notes sur tous les concurrents",
    "A folder": "Un dossier", "A date": "Une date", "A linking website": "Un site qui fait un lien", "A task": "Une tâche", "Day": "Jour", "Task": "Tâche",
    "Notes on this folder": "Notes sur ce dossier", "Notes on this day": "Notes sur ce jour", "Notes on this linking website": "Notes sur ce site", "Notes on this task": "Notes sur cette tâche",
    "Linking website": "Site qui fait un lien", "Address starts with": "L'adresse commence par", "/blog/ or example.com/services/": "/blog/ ou example.com/services/",
    "Search or type a website": "Chercher ou saisir un site", "Search tasks": "Chercher une tâche",
    "Choose a folder, then write.": "Choisissez un dossier, puis écrivez.",
    "Choose a day, then write what happened.": "Choisissez un jour, puis écrivez ce qui s'est passé.",
    "Choose a site, then write: price, contact, answer.": "Choisissez un site, puis écrivez : prix, contact, réponse.",
    "Choose a task, then write.": "Choisissez une tâche, puis écrivez.",
    "That's the whole site: add a folder like /blog/, or write on the website.": "C'est le site entier : ajoutez un dossier comme /blog/, ou écrivez sur le site.",
    "Pick a day.": "Choisissez un jour.", "Enter the linking website, such as example.com.": "Saisissez le site qui fait le lien, par exemple example.com.",
    "No such task. Pick one from the list.": "Tâche inconnue. Choisissez-en une dans la liste.", "Say which task this note is about.": "Indiquez la tâche concernée par cette note.", "That task doesn't exist.": "Cette tâche n'existe pas.",
    "Choose a day between 2000 and next year.": "Choisissez un jour entre 2000 et l'an prochain.", "Enter the folder address, such as example.com/blog/.": "Saisissez l'adresse du dossier, par exemple example.com/blog/.",
    "That isn't something a note can go on.": "Une note ne peut pas porter là-dessus.",
    "Notes on this keyword": "Notes sur ce mot-clé", "Or about": "Ou sur", "Or about something else": "Ou sur autre chose", "A keyword": "Un mot-clé", "Keyword": "Mot-clé",
    "Enter the keyword to save. Kept on this computer.": "Saisissez le mot-clé pour enregistrer. Gardée sur cet ordinateur.",
    "Enter the keyword.": "Saisissez le mot-clé.", "This keyword is over 400 characters.": "Ce mot-clé dépasse 400 caractères.",
    "Choose a page, then write.": "Choisissez une page, puis écrivez.",
    "Choose a keyword, then write.": "Choisissez un mot-clé, puis écrivez.",
    "Choose a competitor, then write.": "Choisissez un concurrent, puis écrivez.", "Search competitors": "Chercher un concurrent",
    "No such competitor. Pick one, or add it under Competitors.": "Concurrent inconnu. Choisissez-en un, ou ajoutez-le dans Concurrents.",
    "Search or type an address": "Chercher ou saisir une adresse", "Search or type a keyword": "Chercher ou saisir un mot-clé",
    "A note goes on all competitors, one competitor, a page, a keyword, a screen or a website.": "Une note porte sur tous les concurrents, un concurrent, une page, un mot-clé, un écran ou un site.",
    "Notes on this screen": "Notes sur cet écran", "Notes on this website": "Notes sur ce site", "Whole site": "Tout le site", "All my sites": "Tous mes sites", "A screen": "Un écran",
    "This competitor": "Ce concurrent", "This page": "Cette page", "Their page": "Leur page", "My page": "Ma page", "{name} screen": "Écran {name}",
    "Choose a subject to save. Kept on this computer.": "Choisissez un sujet pour enregistrer. Gardée sur cet ordinateur.",
    "A note goes on all competitors, one competitor, a page, a screen or a website.": "Une note porte sur tous les concurrents, un concurrent, une page, un écran ou un site.",
    "Say which screen this note is about.": "Indiquez l'écran concerné par cette note.",
    "Close the open panel first.": "Fermez d'abord le panneau ouvert.", "Note saved": "Note enregistrée", "Notes (N key)": "Notes (touche N)",
    "Notes didn't load. What you write is still kept.": "Les notes n'ont pas chargé. Ce que vous écrivez reste gardé.",
    "All competitors": "Tous les concurrents",
    "One competitor": "Un concurrent",
    "A competitor": "Un concurrent",
    "A page": "Une page",
    "for": "pour",
    "Competitor": "Concurrent",
    "Page address": "Adresse de la page",
    "Any page, yours or theirs.": "N'importe quelle page, la vôtre ou la leur.",
    "No competitors yet. Add one under My competitors, or write on All competitors.": "Pas encore de concurrent. Ajoutez-en un dans Mes concurrents, ou écrivez sur Tous les concurrents.",
    "What the note is about": "Sur quoi porte la note",
    "All notes": "Toutes les notes",
    "Search notes": "Rechercher dans les notes",
    "No notes yet": "Pas encore de note",
    "Write one above.": "Écrivez-en une ci-dessus.",
    "A rule for all of them.": "Une règle pour tous.",
    "What you've noticed about them.": "Ce que vous avez remarqué chez lui.",
    "No notes match this search.": "Aucune note ne correspond à cette recherche.",
    "A note needs some text.": "Une note a besoin de texte.",
    "Note too long. Your text is still here: split it in two.": "Note trop longue. Votre texte est toujours là : coupez-la en deux.",
    "A note goes on all competitors, one competitor, or a page.": "Une note porte sur tous les concurrents, un concurrent ou une page.",
    "Say which competitor this note is about.": "Indiquez le concurrent concerné par cette note.",
    "Enter the page's address.": "Saisissez l'adresse de la page.",
    "That competitor doesn't exist.": "Ce concurrent n'existe pas.",
    "That note doesn't exist.": "Cette note n'existe pas.",
  });
})();
