/* Social → Video transcripts: Instagram and TikTok videos turned into text, like saveto.ai.

   Add videos three ways, each ending as one named batch: paste links, upload a file (txt, csv, Excel, Word), or pick
   from a TikTok account's latest videos. Each video tries its captions first (free, nothing downloaded), then Groq's
   free Whisper writes out what is said. Batches download whole as text, Excel or Word.

   Joins the Social screen through window.SocialView.addTab (social-view.js). Server: seo/web/social_transcripts_api.py. */
(() => {
  "use strict";
  let UI = null;
  const S = {
    siteId: null, list: null, loading: false, failed: "",
    mode: "paste", name: "", paste: "", found: null, file: null, fileName: "", account: { url: "", count: 10, videos: null, picked: new Set() },
    busy: "", addError: "", open: new Set(), detail: new Map(), full: new Set(), key: "", keyError: "", cookies: "", cookiesNote: "",
  };
  const api = (...args) => window.COMP.api(...args);
  const t = (w) => UI.t(w);
  const esc = (v) => UI.esc(v);
  const fill = (w, vals) => t(w).replace(/\{(\w+)\}/g, (_, k) => vals[k] ?? "");
  const plural = (n, one, many) => fill(n === 1 ? one : many, { n: UI.num ? UI.num(n) : n });
  const RTL = new Set(["ar", "fa", "ur", "he"]);
  const LANG_NAMES = { ar: "Arabic", fr: "French", en: "English", es: "Spanish", de: "German", it: "Italian", pt: "Portuguese", tr: "Turkish", ru: "Russian", hi: "Hindi", ur: "Urdu", fa: "Persian" };
  const PLATFORM = { tiktok: { name: "TikTok", logo: "logos/tiktok.svg" }, instagram: { name: "Instagram", logo: "logos/instagram.svg" } };
  const MODES = [["paste", "Paste links", "list-plus"], ["file", "Upload a file", "paperclip"], ["account", "A TikTok account", "user"]];
  const mark = (p, size = 16) => `<img class="logo vt-logo" src="${PLATFORM[p].logo}" alt="" width="${size}" height="${size}">`;
  const working = (c) => c.queued + c.working > 0;
  const body = () => UI.$("#so-body .vt");

  // ---- loading ------------------------------------------------------------------------------------------------

  async function load(siteId, { quiet = false } = {}) {
    if (S.siteId !== siteId) { S.siteId = siteId; S.list = null; S.open.clear(); S.detail.clear(); }
    if (!quiet) { S.loading = true; repaint(); }
    try {
      S.list = await api("GET", `social/transcripts?site_id=${siteId}`, null, { fresh: true });
      S.failed = "";
      for (const id of S.open) await loadBatch(id);
    } catch (err) {
      S.failed = err.message || t("Couldn't load your batches.");
    }
    S.loading = false;
    repaint();
    follow();
  }

  async function loadBatch(id) {
    try { S.detail.set(id, await api("GET", `social/transcripts/batches/${id}`, null, { fresh: true })); }
    catch (err) { if (err.status === 404) { S.open.delete(id); S.detail.delete(id); } }
  }

  // While a batch is still being written out, its numbers and rows come back by themselves.
  let watcher = null;
  function follow() {
    if (watcher || !S.list?.batches.some((b) => working(b.counts))) return;
    watcher = window.COMP.poll(async () => {
      if (UI.state.route !== "social" || !body()) return false;
      const list = await api("GET", `social/transcripts?site_id=${S.siteId}`, null, { fresh: true });
      S.list = list;
      for (const id of S.open) await loadBatch(id);
      repaint({ keepTyping: true });
      return list.batches.some((b) => working(b.counts));
    }, { every: 4000, grow: 1.1, slowest: 20000, most: 60 * 60000, onEnd: () => { watcher = null; } });
  }

  // ---- the page -----------------------------------------------------------------------------------------------

  function html() {
    if (S.failed && !S.list) return `<div class="vt"><div class="card note warn" role="alert">${UI.icon("triangle-alert")}<span>${esc(S.failed)}</span> <button type="button" class="btn" data-vt="reload">${esc(t("Try again"))}</button></div></div>`;
    if (!S.list) return `<div class="vt">${UI.skeleton ? UI.skeleton("rows", { rows: 4 }) : ""}</div>`;
    return `<div class="vt">${S.list.groq ? "" : groqCard()}${addCard()}${batchesCard()}${cookiesCard()}</div>`;
  }

  function groqCard() {
    return `<section class="card vt-groq"><div class="card-head"><h2>${esc(t("Connect Groq to write out videos without captions"))}</h2></div>
      <p class="small muted">${esc(t("Most videos have no captions the app can read, so their words come from Groq's free speech-to-text. It costs nothing: a free account has a few hours of audio a day."))}</p>
      <ol class="vt-steps small">
        <li>${fill("Make a free account and a key at {link}.", { link: `<a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">console.groq.com/keys${UI.icon("external-link")}</a>` })}</li>
        <li>${esc(t("Paste the key here. It is kept sealed, like every other key."))}</li>
      </ol>
      <form class="so-row" data-vt-form="key"><label class="sr-only" for="vt-key">${esc(t("Groq key"))}</label>
        <input class="input" id="vt-key" type="password" autocomplete="off" spellcheck="false" placeholder="gsk_…" value="${esc(S.key)}">
        <button type="submit" class="btn btn-main" ${S.busy === "key" ? "disabled" : ""}>${UI.icon("key-round")}${esc(t(S.busy === "key" ? "Checking…" : "Save and check"))}</button></form>
      ${S.keyError ? `<p class="error" role="alert">${UI.icon("octagon-alert")}${esc(S.keyError)}</p>` : ""}</section>`;
  }

  function addCard() {
    const tabs = `<div class="vt-modes" role="radiogroup" aria-label="${esc(t("How to add videos"))}">${MODES.map(([id, w, ic]) => `<button type="button" role="radio" class="vt-mode" data-vt-mode="${id}" aria-checked="${S.mode === id}" tabindex="${S.mode === id ? 0 : -1}">${UI.icon(ic)}${esc(t(w))}</button>`).join("")}</div>`;
    const count = videosToAdd().length;
    const go = `<button type="button" class="btn btn-main" data-vt="start" ${count && !S.busy ? "" : "disabled"}>${UI.icon("file-text")}${esc(S.busy === "start" ? t("Starting…") : count ? plural(count, "Write out {n} video", "Write out {n} videos") : t("Write out the videos"))}</button>`;
    return `<section class="card vt-add"><div class="card-head"><h2>${esc(t("Add videos"))}</h2><span class="small muted">${esc(t("Instagram and TikTok, up to 200 at a time"))}</span></div>
      ${tabs}<div class="vt-mode-body">${modeBody()}</div>
      <div class="so-row vt-start"><label class="vt-name"><span class="small muted">${esc(t("Batch name"))}</span>
        <input class="input" id="vt-name" maxlength="120" value="${esc(S.name)}" placeholder="${esc(defaultName())}"></label>${go}</div>
      ${S.addError ? `<p class="error" role="alert">${UI.icon("octagon-alert")}${esc(S.addError)}</p>` : ""}</section>`;
  }

  function foundLine(found) {
    if (!found) return "";
    const parts = [found.videos.length ? plural(found.videos.length, "{n} video found", "{n} videos found") : t("No Instagram or TikTok video links yet")];
    if (found.too_many) parts.push(t("over 200: split them into two batches"));
    const tt = found.videos.filter((v) => v.platform === "tiktok").length, ig = found.videos.length - tt;
    const split = found.videos.length ? ` <span class="muted">(${[tt ? `${mark("tiktok", 14)} ${tt}` : "", ig ? `${mark("instagram", 14)} ${ig}` : ""].filter(Boolean).join(" · ")})</span>` : "";
    const acct = found.accounts?.length ? `<p class="small vt-hint">${UI.icon("info")}${esc(plural(found.accounts.length, "{n} account link is not a video.", "{n} account links are not videos."))} <button type="button" class="link-btn" data-vt-use-account="${esc(found.accounts[0].url)}">${esc(t("List that account's videos"))}</button></p>` : "";
    return `<p class="vt-found" aria-live="polite"><b>${esc(parts.join(", "))}</b>${split}</p>${acct}`;
  }

  function modeBody() {
    if (S.mode === "paste") {
      return `<label class="sr-only" for="vt-paste">${esc(t("Video links"))}</label>
        <textarea class="input vt-paste" id="vt-paste" rows="6" spellcheck="false" placeholder="${esc(t("Paste links here, one per line or mixed with any other text"))}">${esc(S.paste)}</textarea>
        <div id="vt-found">${foundLine(S.found)}</div>`;
    }
    if (S.mode === "file") {
      return `<label class="vt-drop" for="vt-file" data-vt-drop>${UI.icon("paperclip")}<span><b>${esc(S.fileName || t("Choose a file"))}</b><span class="small muted">${esc(t("or drop it here · .txt, .csv, Excel or Word, up to 5 MB. Links are found in any column."))}</span></span>
        <input type="file" id="vt-file" class="sr-only" accept=".txt,.csv,.xlsx,.xlsm,.docx,text/plain,text/csv"></label>
        ${S.busy === "file" ? `<p class="small muted">${esc(t("Reading the file…"))}</p>` : foundLine(S.file)}`;
    }
    const a = S.account;
    const list = a.videos ? `<div class="vt-pick"><div class="so-row vt-pick-head"><b>${esc(fill("{n} of {all} ticked", { n: a.picked.size, all: a.videos.length }))}</b>
        <button type="button" class="link-btn" data-vt="pick-all">${esc(t(a.picked.size === a.videos.length ? "Untick all" : "Tick all"))}</button></div>
        <ul class="vt-pick-list">${a.videos.map((v) => `<li><label><input type="checkbox" data-vt-pick="${esc(v.url)}" ${a.picked.has(v.url) ? "checked" : ""}>
          <span class="vt-pick-title" dir="auto">${esc(v.title || v.url)}</span>${v.duration ? `<span class="small muted num">${esc(clock(v.duration))}</span>` : ""}</label></li>`).join("")}</ul></div>` : "";
    return `<form class="so-row vt-account" data-vt-form="account"><label class="sr-only" for="vt-account">${esc(t("TikTok account address"))}</label>
        <input class="input" id="vt-account" inputmode="url" spellcheck="false" placeholder="https://www.tiktok.com/@name" value="${esc(a.url)}">
        <label class="sr-only" for="vt-count">${esc(t("How many videos"))}</label>
        <select class="input so-select" id="vt-count">${[10, 25, 50].map((n) => `<option value="${n}" ${a.count === n ? "selected" : ""}>${esc(fill("Latest {n}", { n }))}</option>`).join("")}</select>
        <button type="submit" class="btn" ${S.busy === "account" ? "disabled" : ""}>${UI.icon("search")}${esc(t(S.busy === "account" ? "Listing…" : "List videos"))}</button></form>
      <p class="small muted">${esc(t("Instagram doesn't let the app list an account: paste its video links instead."))}</p>${list}`;
  }

  function batchesCard() {
    const all = S.list.batches;
    if (!all.length) return `<section class="card vt-batches"><div class="empty"><p>${esc(t("No batches yet. Add videos above: each batch keeps its transcripts together."))}</p></div></section>`;
    return `<section class="card vt-batches"><div class="card-head"><h2>${esc(t("Batches"))}</h2></div><ul class="vt-batch-list">${all.map(batchRow).join("")}</ul></section>`;
  }

  function progress(c) {
    if (!c.total) return "";
    const done = c.done + c.failed;
    const words = working(c) ? fill("{done} of {all} done", { done: c.done, all: c.total }) : plural(c.done, "{n} transcript", "{n} transcripts");
    const fail = c.failed ? ` · <span class="so-err">${esc(plural(c.failed, "{n} failed", "{n} failed"))}</span>` : "";
    const bar = working(c) ? `<span class="vt-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${c.total}" aria-valuenow="${done}" aria-label="${esc(t("Progress"))}"><span style="width:${Math.round((done / c.total) * 100)}%"></span></span>` : "";
    return `<span class="vt-progress">${working(c) ? UI.icon("clock") : UI.icon("circle-check")}<span>${esc(words)}${fail}</span>${bar}</span>`;
  }

  function batchRow(b) {
    const open = S.open.has(b.id);
    const when = UI.fmtStamp ? UI.fmtStamp(b.created_at) : b.created_at;
    const origin = { paste: "Pasted", file: "From a file", account: "From an account" }[b.origin];
    return `<li class="vt-batch ${open ? "open" : ""}">
      <button type="button" class="vt-batch-head" data-vt-open="${b.id}" aria-expanded="${open}">${UI.icon(open ? "chevron-down" : "chevron-right")}
        <span class="vt-batch-name" dir="auto">${esc(b.name)}</span><span class="small muted">${esc(t(origin))} · ${esc(when)}${b.by ? ` · ${esc(b.by)}` : ""}</span>${progress(b.counts)}</button>
      ${open ? batchBody(b) : ""}</li>`;
  }

  function batchBody(b) {
    const d = S.detail.get(b.id);
    if (!d) return `<div class="vt-batch-body"><p class="small muted">${esc(t("Loading…"))}</p></div>`;
    const dl = d.counts.done ? `<details class="so-add vt-dl"><summary class="btn">${UI.icon("download")}${esc(t("Download all"))}${UI.icon("chevron-down")}</summary><div class="so-add-form vt-dl-menu">
        ${[["docx", "Word"], ["xlsx", "Excel"], ["txt", "Text"]].map(([f, w]) => `<a class="btn btn-ghost" href="api/social/transcripts/batches/${b.id}/download?format=${f}" download>${UI.icon("file-text")}${esc(t(w))}</a>`).join("")}</div></details>` : "";
    const acts = `<div class="so-row vt-batch-acts">${dl}
      ${d.counts.done ? `<button type="button" class="btn btn-ghost" data-vt-copy-all="${b.id}">${UI.icon("copy")}${esc(t("Copy all"))}</button>` : ""}
      ${d.counts.failed ? `<button type="button" class="btn btn-ghost" data-vt-retry-all="${b.id}">${UI.icon("rotate-ccw")}${esc(plural(d.counts.failed, "Try the failed one again", "Try the {n} failed again"))}</button>` : ""}
      <span class="end"><button type="button" class="btn btn-ghost" data-vt-rename="${b.id}">${UI.icon("pencil")}${esc(t("Rename"))}</button><button type="button" class="btn btn-ghost" data-vt-delete="${b.id}">${UI.icon("trash-2")}${esc(t("Delete"))}</button></span></div>`;
    return `<div class="vt-batch-body">${acts}<ul class="so-items vt-items">${d.items.map(itemRow).join("")}</ul></div>`;
  }

  function clock(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

  function itemRow(item) {
    const p = PLATFORM[item.platform];
    const who = [item.author, item.duration ? clock(item.duration) : ""].filter(Boolean).map(esc).join(" · ");
    const head = `<div class="so-item-head">${mark(item.platform)}<a class="vt-title" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" dir="auto">${esc(item.title || fill("{p} video", { p: p.name }))}</a>${who ? `<span class="small muted">${who}</span>` : ""}${pill(item)}</div>`;
    if (item.status === "queued" || item.status === "working") return `<li class="so-item vt-item">${head}${item.error ? `<p class="small muted">${esc(t(item.error))}</p>` : ""}</li>`;
    if (item.status === "failed" || !item.transcript) {
      return `<li class="so-item vt-item">${head}<p class="vt-why ${item.status === "failed" ? "so-err" : "muted"}">${UI.icon(item.status === "failed" ? "octagon-alert" : "info")}<span>${esc(t(item.error || "Not written out."))}</span></p>
        ${item.status === "failed" ? `<div class="so-acts"><button type="button" class="btn" data-vt-retry="${item.id}">${UI.icon("rotate-ccw")}${esc(t("Try again"))}</button></div>` : ""}${captionBlock(item)}</li>`;
    }
    const rtl = RTL.has(item.lang);
    const long = item.transcript.length > 420 && !S.full.has(item.id);
    return `<li class="so-item vt-item">${head}
      <p class="vt-text ${rtl ? "so-ar" : ""} ${long ? "vt-clamped" : ""}" dir="auto" lang="${esc(item.lang || "")}">${esc(item.transcript)}</p>
      <div class="so-acts"><button type="button" class="btn" data-vt-copy="${item.id}">${UI.icon("copy")}${esc(t("Copy"))}</button>
        ${item.transcript.length > 420 ? `<button type="button" class="btn btn-ghost" data-vt-full="${item.id}" aria-expanded="${!long}">${esc(t(long ? "Show all" : "Show less"))}</button>` : ""}
        <span class="end small muted">${esc(meta(item))}</span></div>${captionBlock(item)}</li>`;
  }

  function meta(item) {
    const how = item.method === "captions" ? t("From the video's captions") : item.method === "groq" ? t("Written out by Groq") : "";
    const lang = item.lang ? t(LANG_NAMES[item.lang] || item.lang.toUpperCase()) : "";
    return [how, lang, plural(item.transcript.trim().split(/\s+/).length, "{n} word", "{n} words")].filter(Boolean).join(" · ");
  }

  function captionBlock(item) {
    if (!item.caption) return "";
    return `<details class="vt-caption"><summary class="small muted">${esc(t("Caption under the video"))}</summary><p class="so-quote" dir="auto">${esc(item.caption)}</p></details>`;
  }

  function pill(item) {
    const map = { queued: ["Waiting", "", "clock"], working: ["Writing out…", "sec", "refresh-cw"], failed: ["Failed", "crit", "octagon-alert"] };
    const found = map[item.status];
    return found ? `<span class="status ${found[1]} so-pill">${UI.icon(found[2])}${esc(t(found[0]))}</span>` : "";
  }

  function cookiesCard() {
    return `<details class="card vt-cookies"><summary><h2>${esc(t("Instagram sign-in (only if Instagram refuses)"))}</h2></summary>
      <p class="small muted">${esc(t("Instagram often asks the server to sign in. Export your Instagram cookies as a cookies.txt file with a browser add-on such as \"Get cookies.txt LOCALLY\", and paste its contents here. They are kept sealed and only sent to Instagram. They stop working after a few weeks: paste them again then."))}</p>
      <form data-vt-form="cookies"><label class="sr-only" for="vt-cookies">${esc(t("Instagram cookies"))}</label>
        <textarea class="input vt-cookies-box" id="vt-cookies" rows="4" spellcheck="false" placeholder="# Netscape HTTP Cookie File">${esc(S.cookies)}</textarea>
        <div class="so-row"><button type="submit" class="btn" ${S.busy === "cookies" ? "disabled" : ""}>${UI.icon("key-round")}${esc(t("Save the cookies"))}</button>${S.cookiesNote ? `<span class="small" role="status">${esc(S.cookiesNote)}</span>` : ""}</div></form></details>`;
  }

  // ---- helpers ------------------------------------------------------------------------------------------------

  function defaultName() {
    const d = new Date();
    return fill("Videos {date}", { date: d.toLocaleDateString(UI.locale ? UI.locale() : undefined, { day: "numeric", month: "short" }) });
  }

  function videosToAdd() {
    if (S.mode === "paste") return S.found && !S.found.too_many ? S.found.videos.map((v) => v.url) : [];
    if (S.mode === "file") return S.file && !S.file.too_many ? S.file.videos.map((v) => v.url) : [];
    return S.account.videos ? S.account.videos.filter((v) => S.account.picked.has(v.url)).map((v) => v.url) : [];
  }

  function repaint({ keepTyping = false } = {}) {
    const root = body();
    if (!root) return;
    const focused = document.activeElement;
    const keep = focused && root.contains(focused) && focused.id ? { id: focused.id, start: focused.selectionStart, end: focused.selectionEnd } : null;
    if (keepTyping && keep && /^(vt-paste|vt-name|vt-key|vt-account|vt-cookies)$/.test(keep.id)) { paintBatchesOnly(); return; }
    const scroll = window.scrollY;
    const fresh = UI.fragment(html()).firstElementChild;
    if (fresh) root.replaceWith(fresh);
    if (keep) {
      const el = document.getElementById(keep.id);
      if (el) { el.focus({ preventScroll: true }); try { if (keep.start !== null && keep.start !== undefined) el.setSelectionRange(keep.start, keep.end); } catch { /* not a text box */ } }
    }
    window.scrollTo({ top: scroll });
  }

  // A redraw from the watcher while someone types: only the batches change, so the box being typed in stays put.
  function paintBatchesOnly() {
    const old = body()?.querySelector(".vt-batches");
    const fresh = UI.fragment(batchesCard()).firstElementChild;
    if (old && fresh) old.replaceWith(fresh);
  }

  async function copy(words, done) {
    try { await navigator.clipboard.writeText(words); UI.toast(t(done)); }
    catch { UI.toast(t("Couldn't copy. Select the text and copy it yourself.")); }
  }

  let findTimer = null, findSeq = 0;
  function findLater() {
    clearTimeout(findTimer);
    findTimer = setTimeout(async () => {
      const seq = ++findSeq, words = S.paste;
      if (!words.trim()) { S.found = null; updateFound(); return; }
      try { const found = await api("POST", "social/transcripts/find", { text: words }); if (seq === findSeq) { S.found = found; updateFound(); } }
      catch (err) { if (seq === findSeq) { S.addError = err.message; repaint(); } }
    }, 350);
  }
  // Typing keeps its box: only the line under it and the button change.
  function updateFound() {
    const line = UI.$("#vt-found");
    if (line) UI.setHTML(line, foundLine(S.found));
    const start = body()?.querySelector('[data-vt="start"]');
    if (start) { const fresh = UI.fragment(addCard()).querySelector('[data-vt="start"]'); if (fresh) start.replaceWith(fresh); }
  }

  async function readFile(file) {
    if (!file) return;
    S.fileName = file.name; S.file = null; S.addError = ""; S.busy = "file"; repaint();
    const form = new FormData();
    form.append("file", file);
    try { S.file = await api("POST", "social/transcripts/file", null, { form }); }
    catch (err) { S.addError = err.message; }
    S.busy = ""; repaint();
  }

  // ---- actions ------------------------------------------------------------------------------------------------

  async function start() {
    const urls = videosToAdd();
    if (!urls.length || S.busy) return;
    S.busy = "start"; S.addError = ""; repaint();
    try {
      const made = await api("POST", "social/transcripts/batches", { site_id: S.siteId, name: S.name.trim() || defaultName(), origin: S.mode, urls });
      S.name = ""; S.paste = ""; S.found = null; S.file = null; S.fileName = ""; S.account = { url: "", count: 10, videos: null, picked: new Set() };
      S.open.add(made.id); S.detail.set(made.id, made);
      UI.toast(plural(made.counts.total, "{n} video is being written out", "{n} videos are being written out"));
      S.busy = "";
      await load(S.siteId, { quiet: true });
      UI.$(`[data-vt-open="${made.id}"]`)?.focus({ preventScroll: false });
    } catch (err) { S.addError = err.message; S.busy = ""; repaint(); }
  }

  async function listAccount() {
    const a = S.account;
    a.url = UI.$("#vt-account")?.value.trim() || "";
    a.count = Number(UI.$("#vt-count")?.value) || 10;
    if (!a.url) { S.addError = t("Paste an account's address, like https://www.tiktok.com/@name."); repaint(); return; }
    S.busy = "account"; S.addError = ""; a.videos = null; repaint();
    try {
      const got = await api("POST", "social/transcripts/account", { site_id: S.siteId, url: a.url, count: a.count });
      a.videos = got.videos; a.picked = new Set(got.videos.map((v) => v.url));
      if (!S.name) S.name = (a.url.match(/@([\w.\-]+)/) || [])[1] ? `@${a.url.match(/@([\w.\-]+)/)[1]} · ${defaultName()}` : "";
    } catch (err) { S.addError = err.message; }
    S.busy = ""; repaint();
  }

  async function saveKey() {
    const key = UI.$("#vt-key")?.value.trim() || "";
    if (!key) { S.keyError = t("Paste the key first."); repaint(); return; }
    S.busy = "key"; S.keyError = ""; S.key = key; repaint();
    try {
      await api("PUT", "app-keys/groq", { key });
      const tested = await api("POST", "app-keys/groq/test", {});
      if (tested.ok === false) S.keyError = tested.note;
      else { S.key = ""; UI.toast(t("Groq is connected.")); }
    } catch (err) { S.keyError = err.status === 403 ? t("Only an admin can add keys. Ask an admin to paste it.") : err.message; }
    S.busy = "";
    await load(S.siteId, { quiet: true });
  }

  async function saveCookies() {
    const words = UI.$("#vt-cookies")?.value.trim() || "";
    if (!/instagram\.com/.test(words)) { S.cookiesNote = t("These don't look like Instagram cookies: the file should have lines with instagram.com."); repaint(); return; }
    S.busy = "cookies"; S.cookiesNote = ""; repaint();
    try { await api("PUT", "app-keys/instagram", { key: words }); S.cookies = ""; S.cookiesNote = t("Saved. Failed Instagram videos can be tried again now."); }
    catch (err) { S.cookiesNote = err.status === 403 ? t("Only an admin can save them.") : err.message; }
    S.busy = ""; repaint();
  }

  async function act(fn) {
    try { await fn(); } catch (err) { UI.toast(err.message); }
    await load(S.siteId, { quiet: true });
  }

  function install() {
    document.addEventListener("click", async (e) => {
      const root = e.target.closest?.(".vt");
      if (!root) return;
      const el = e.target.closest("button, a, [data-vt-drop]");
      if (!el) return;
      const d = el.dataset;
      if (d.vtMode) { S.mode = d.vtMode; S.addError = ""; repaint(); UI.$(`[data-vt-mode="${S.mode}"]`)?.focus(); return; }
      if (d.vt === "reload") return load(S.siteId);
      if (d.vt === "start") return start();
      if (d.vt === "pick-all") { const a = S.account; a.picked = a.picked.size === a.videos.length ? new Set() : new Set(a.videos.map((v) => v.url)); return repaint(); }
      if (d.vtUseAccount) { S.mode = "account"; S.account.url = d.vtUseAccount; return repaint(); }
      if (d.vtOpen) {
        const id = Number(d.vtOpen);
        if (S.open.has(id)) S.open.delete(id); else { S.open.add(id); repaint(); await loadBatch(id); }
        return repaint();
      }
      if (d.vtFull) { const id = Number(d.vtFull); S.full.has(id) ? S.full.delete(id) : S.full.add(id); return repaint(); }
      if (d.vtCopy) { const item = [...S.detail.values()].flatMap((b) => b.items).find((i) => i.id === Number(d.vtCopy)); return item && copy(item.transcript, "Copied"); }
      if (d.vtCopyAll) {
        const b = S.detail.get(Number(d.vtCopyAll));
        const words = b.items.filter((i) => i.status === "done" && i.transcript).map((i) => `${i.title || i.url}\n${i.url}\n\n${i.transcript}`).join("\n\n———\n\n");
        return copy(words, "All transcripts copied");
      }
      if (d.vtRetry) return act(() => api("POST", `social/transcripts/items/${d.vtRetry}/retry`, {}));
      if (d.vtRetryAll) return act(() => api("POST", `social/transcripts/batches/${d.vtRetryAll}/retry`, {}));
      if (d.vtRename) {
        const b = S.list.batches.find((x) => x.id === Number(d.vtRename));
        const name = window.prompt(t("New name for this batch"), b?.name || "");
        if (name && name.trim()) return act(() => api("PATCH", `social/transcripts/batches/${d.vtRename}`, { name: name.trim() }));
        return;
      }
      if (d.vtDelete) {
        const b = S.list.batches.find((x) => x.id === Number(d.vtDelete));
        const yes = await (UI.confirmDanger ? UI.confirmDanger({ title: fill("Delete \"{name}\"?", { name: b?.name || "" }), body: t("Its transcripts are deleted too. This can't be undone."), yes: t("Delete") }) : Promise.resolve(window.confirm(t("Delete this batch?"))));
        if (yes) { S.open.delete(Number(d.vtDelete)); S.detail.delete(Number(d.vtDelete)); return act(() => api("DELETE", `social/transcripts/batches/${d.vtDelete}`)); }
      }
      if (el.matches(".vt-dl-menu a")) el.closest("details")?.removeAttribute("open");
    });
    document.addEventListener("submit", (e) => {
      const form = e.target.closest?.(".vt [data-vt-form]");
      if (!form) return;
      e.preventDefault();
      ({ key: saveKey, account: listAccount, cookies: saveCookies })[form.dataset.vtForm]?.();
    });
    document.addEventListener("input", (e) => {
      if (!e.target.closest?.(".vt")) return;
      const id = e.target.id;
      if (id === "vt-paste") { S.paste = e.target.value; S.addError = ""; findLater(); }
      else if (id === "vt-name") S.name = e.target.value;
      else if (id === "vt-key") S.key = e.target.value;
      else if (id === "vt-account") S.account.url = e.target.value;
      else if (id === "vt-cookies") S.cookies = e.target.value;
    });
    document.addEventListener("change", (e) => {
      if (!e.target.closest?.(".vt")) return;
      if (e.target.id === "vt-file") readFile(e.target.files?.[0]);
      else if (e.target.id === "vt-count") S.account.count = Number(e.target.value);
      else if (e.target.dataset.vtPick) {
        const url = e.target.dataset.vtPick;
        e.target.checked ? S.account.picked.add(url) : S.account.picked.delete(url);
        repaint();
      }
    });
    // Arrows move between the three ways in, as in any radio group.
    document.addEventListener("keydown", (e) => {
      if (!e.target.matches?.(".vt [data-vt-mode]") || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
      e.preventDefault();
      const ids = MODES.map(([id]) => id), at = ids.indexOf(S.mode), step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
      S.mode = ids[(at + step + ids.length) % ids.length];
      repaint();
      UI.$(`[data-vt-mode="${S.mode}"]`)?.focus();
    });
    ["dragover", "dragleave", "drop"].forEach((kind) => document.addEventListener(kind, (e) => {
      const drop = e.target.closest?.(".vt [data-vt-drop]");
      if (!drop) return;
      e.preventDefault();
      drop.classList.toggle("over", kind === "dragover");
      if (kind === "drop") readFile(e.dataTransfer?.files?.[0]);
    }));
  }

  // ---- French ---------------------------------------------------------------------------------------------------

  const FR = {
    "Video transcripts": "Transcriptions vidéo", "Add videos": "Ajouter des vidéos", "Instagram and TikTok, up to 200 at a time": "Instagram et TikTok, jusqu'à 200 à la fois",
    "Paste links": "Coller des liens", "Upload a file": "Importer un fichier", "A TikTok account": "Un compte TikTok", "How to add videos": "Comment ajouter des vidéos",
    "Batch name": "Nom du lot", "Videos {date}": "Vidéos {date}", "Write out {n} video": "Transcrire {n} vidéo", "Write out {n} videos": "Transcrire {n} vidéos", "Write out the videos": "Transcrire les vidéos", "Starting…": "Lancement…",
    "Video links": "Liens des vidéos", "Paste links here, one per line or mixed with any other text": "Collez les liens ici, un par ligne ou mêlés à d'autre texte",
    "{n} video found": "{n} vidéo trouvée", "{n} videos found": "{n} vidéos trouvées", "No Instagram or TikTok video links yet": "Pas encore de lien vidéo Instagram ou TikTok", "over 200: split them into two batches": "plus de 200 : coupez en deux lots",
    "{n} account link is not a video.": "{n} lien de compte n'est pas une vidéo.", "{n} account links are not videos.": "{n} liens de compte ne sont pas des vidéos.", "List that account's videos": "Lister les vidéos de ce compte",
    "Choose a file": "Choisir un fichier", "or drop it here · .txt, .csv, Excel or Word, up to 5 MB. Links are found in any column.": "ou déposez-le ici · .txt, .csv, Excel ou Word, 5 Mo max. Les liens sont trouvés dans toutes les colonnes.", "Reading the file…": "Lecture du fichier…",
    "TikTok account address": "Adresse du compte TikTok", "How many videos": "Combien de vidéos", "Latest {n}": "Les {n} dernières", "List videos": "Lister les vidéos", "Listing…": "Recherche…",
    "Instagram doesn't let the app list an account: paste its video links instead.": "Instagram ne laisse pas l'app lister un compte : collez plutôt les liens de ses vidéos.",
    "{n} of {all} ticked": "{n} sur {all} cochées", "Tick all": "Tout cocher", "Untick all": "Tout décocher",
    "Batches": "Lots", "No batches yet. Add videos above: each batch keeps its transcripts together.": "Aucun lot pour l'instant. Ajoutez des vidéos ci-dessus : chaque lot garde ses transcriptions ensemble.",
    "{done} of {all} done": "{done} sur {all} faites", "{n} transcript": "{n} transcription", "{n} transcripts": "{n} transcriptions", "{n} failed": "{n} en échec", "Progress": "Avancement",
    "Pasted": "Collés", "From a file": "Depuis un fichier", "From an account": "Depuis un compte", "Loading…": "Chargement…",
    "Download all": "Tout télécharger", "Word": "Word", "Excel": "Excel", "Text": "Texte", "Copy all": "Tout copier", "Try the failed one again": "Réessayer celle en échec", "Try the {n} failed again": "Réessayer les {n} en échec",
    "Rename": "Renommer", "Delete": "Supprimer", "New name for this batch": "Nouveau nom pour ce lot", "Delete \"{name}\"?": "Supprimer « {name} » ?", "Its transcripts are deleted too. This can't be undone.": "Ses transcriptions sont supprimées aussi. C'est définitif.", "Delete this batch?": "Supprimer ce lot ?",
    "{p} video": "Vidéo {p}", "Waiting": "En attente", "Writing out…": "Transcription…", "Failed": "Échec", "Not written out.": "Pas transcrite.", "Copy": "Copier", "Show all": "Tout afficher", "Show less": "Afficher moins",
    "From the video's captions": "Depuis les sous-titres de la vidéo", "Written out by Groq": "Transcrite par Groq", "{n} word": "{n} mot", "{n} words": "{n} mots", "Caption under the video": "Légende sous la vidéo",
    "Copied": "Copié", "All transcripts copied": "Toutes les transcriptions copiées", "Couldn't copy. Select the text and copy it yourself.": "Copie impossible. Sélectionnez le texte et copiez-le vous-même.",
    "{n} video is being written out": "{n} vidéo en cours de transcription", "{n} videos are being written out": "{n} vidéos en cours de transcription",
    "Connect Groq to write out videos without captions": "Connectez Groq pour transcrire les vidéos sans sous-titres",
    "Most videos have no captions the app can read, so their words come from Groq's free speech-to-text. It costs nothing: a free account has a few hours of audio a day.": "La plupart des vidéos n'ont pas de sous-titres lisibles par l'app : leurs mots viennent de la transcription gratuite de Groq. Rien à payer : un compte gratuit donne quelques heures d'audio par jour.",
    "Make a free account and a key at {link}.": "Créez un compte gratuit et une clé sur {link}.", "Paste the key here. It is kept sealed, like every other key.": "Collez la clé ici. Elle est gardée chiffrée, comme toutes les clés.",
    "Groq key": "Clé Groq", "Save and check": "Enregistrer et vérifier", "Checking…": "Vérification…", "Groq is connected.": "Groq est connecté.", "Only an admin can add keys. Ask an admin to paste it.": "Seul un admin peut ajouter des clés. Demandez à un admin de la coller.",
    "Instagram sign-in (only if Instagram refuses)": "Connexion Instagram (seulement si Instagram refuse)", "Instagram cookies": "Cookies Instagram", "Save the cookies": "Enregistrer les cookies",
    "Instagram often asks the server to sign in. Export your Instagram cookies as a cookies.txt file with a browser add-on such as \"Get cookies.txt LOCALLY\", and paste its contents here. They are kept sealed and only sent to Instagram. They stop working after a few weeks: paste them again then.": "Instagram demande souvent au serveur de se connecter. Exportez vos cookies Instagram en fichier cookies.txt avec une extension comme « Get cookies.txt LOCALLY », puis collez son contenu ici. Ils sont gardés chiffrés et envoyés seulement à Instagram. Ils expirent après quelques semaines : collez-les à nouveau.",
    "These don't look like Instagram cookies: the file should have lines with instagram.com.": "Ce ne sont pas des cookies Instagram : le fichier doit contenir des lignes avec instagram.com.", "Saved. Failed Instagram videos can be tried again now.": "Enregistrés. Les vidéos Instagram en échec peuvent être réessayées.", "Only an admin can save them.": "Seul un admin peut les enregistrer.",
    "Couldn't load your batches.": "Impossible de charger vos lots.", "Paste an account's address, like https://www.tiktok.com/@name.": "Collez l'adresse d'un compte, comme https://www.tiktok.com/@nom.",
    "Arabic": "Arabe", "French": "Français", "English": "Anglais", "Spanish": "Espagnol", "German": "Allemand", "Italian": "Italien", "Portuguese": "Portugais", "Turkish": "Turc", "Russian": "Russe", "Hindi": "Hindi", "Urdu": "Ourdou", "Persian": "Persan",
    "No words are spoken in this video.": "Aucun mot n'est prononcé dans cette vidéo.",
  };
  window.FR = window.FR || {};
  Object.keys(FR).forEach((w) => { if (window.FR[w] === undefined) window.FR[w] = FR[w]; });

  // ---- joining Social -----------------------------------------------------------------------------------------

  let installed = false;
  window.SocialView?.addTab({
    id: "transcripts",
    label: "Video transcripts",
    html(ui) { UI = ui; return html(); },
    after(ui, siteId) {
      UI = ui;
      if (!installed) { install(); installed = true; }
      if (!siteId) return;
      if (S.siteId !== siteId || !S.list) load(siteId);
      else follow();
    },
  });
})();
