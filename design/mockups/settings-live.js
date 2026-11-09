/* Settings on real data: connections really save and test, plus the Sites and Team tabs. Only used when served by the app.
   Search tools (group "serp") are handled apart. Keys go in, and only their last 4 characters ever come back. */
(() => {
  "use strict";
  if (!window.BOOT) return;
  let UI, t, esc, num, icon, status;
  const L = { tab: "connections", data: null, failed: "", newGoogle: null, sc: [], ga: [], team: null };
  // A sample status must never show on a real server, even if the real ones are slow or don't arrive.
  window.CONNECTIONS.forEach((c) => { if (c.group !== "serp") Object.assign(c, { status: c.auth === "none" ? "nokey" : "off", last4: "", since: "", sites: "all" }); });
  const isAdmin = () => !window.BOOT.user || window.BOOT.user.role === "admin";
  const api = (...args) => window.COMP.api(...args);
  const conn = (id) => window.CONNECTIONS.find((c) => c.id === id);
  const SOURCE_OF = { bing: "bing", yandex: "yandex", pagespeed: "pagespeed" };
  const realId = (uiId) => window.SITES.find((s) => s.id === uiId)?.realId;
  const sinceWord = (iso) => { if (!iso) return ""; const h = Math.round((Date.now() - new Date(iso)) / 3600000); return h < 48 ? `${Math.max(h, 1)} h` : `${Math.round(h / 24)} ${t("d")}`; };

  // ---- what the server says, written onto the connection rows the page draws ------------------------
  function apply(data) {
    L.data = data;
    const rows = (source, siteId) => data.site_sources.find((r) => r.source === source && r.site_id === siteId);
    const google = conn("google");
    if (google) {
      const broken = data.google.find((g) => g.last_error);
      // A pull can fail on a site while the key itself still tests fine, such as GA4's Data API being off. Settings says so too,
      // or the data card says "stopped working" and Settings says it works.
      const pull = data.site_sources.find((r) => (r.source === "gsc" || r.source === "ga4") && !r.not_used && r.last_error);
      google.status = !data.google.length ? "off" : (broken && !data.google.some((g) => g.last_ok_at && !g.last_error)) || pull ? "failing" : "ok";
      google.error = broken?.last_error || pull?.last_error || "";
      google.robot = data.google.find((g) => g.robot_email)?.robot_email || "";
      google.since = sinceWord(data.google[0]?.last_ok_at);
      google.last4 = data.google[0]?.last4 || "";
      google.props = {};
      const using = [];
      window.SITES.forEach((s) => {
        const sc = rows("gsc", s.realId), ga = rows("ga4", s.realId);
        google.props[s.id] = { sc: sc?.not_used ? "" : sc?.property || "", ga4: ga?.not_used ? "" : ga?.property || "" };
        if (google.props[s.id].sc || google.props[s.id].ga4) using.push(s.id);
      });
      google.sites = using.length === window.SITES.length && using.length ? "all" : using;
    }
    const clarity = conn("clarity");
    if (clarity) {
      const held = window.SITES.map((s) => ({ s, row: rows("clarity", s.realId) }));
      const live = held.filter(({ row }) => row?.has_secret && !row.not_used);
      clarity.status = !live.length ? "off" : live.some(({ row }) => row.last_error) ? "failing" : "ok";
      clarity.error = live.find(({ row }) => row.last_error)?.row.last_error || "";
      clarity.since = sinceWord(live.find(({ row }) => row.last_ok_at)?.row.last_ok_at);
      clarity.last4 = Object.fromEntries(held.filter(({ row }) => row?.last4).map(({ s, row }) => [s.id, row.last4]));
      const off = held.filter(({ row }) => row?.not_used).map(({ s }) => s.id);
      clarity.sites = off.length ? window.SITES.map((s) => s.id).filter((id) => !off.includes(id)) : "all";
    }
    data.keys.forEach((key) => {
      const c = conn(key.id);
      if (!c) return;
      c.status = !key.connected ? (key.id === "pagespeed" ? "nokey" : "off") : key.last_error ? "failing" : "ok";
      c.error = key.last_error || "";
      c.last4 = key.last4 || "";
      c.since = sinceWord(key.last_ok_at);
      const source = SOURCE_OF[key.id];
      if (source) {
        const off = window.SITES.filter((s) => rows(source, s.realId)?.not_used).map((s) => s.id);
        c.sites = off.length ? window.SITES.map((s) => s.id).filter((id) => !off.includes(id)) : "all";
      } else c.sites = "all"; // one key for the whole app: it has no per-site choice to make
    });
    if (conn("pagespeed")) conn("pagespeed").note = "It works with no key, within a smaller limit. A free key gives it more room.";
    window.BOOT.summaries_on = Boolean(data.keys.find((k) => k.id === "openrouter")?.connected);
  }
  async function reload() {
    apply(await api("GET", "sources"));
    L.failed = "";
    if (UI.state.route === "settings" && !UI.$("#panel")) UI.render();
  }
  const firstLoad = () => reload().catch((err) => {
    L.failed = err.message;
    if (UI.state.route === "settings" && !UI.$("#panel")) UI.render();
  });

  // ---- pieces the connection panel asks for -----------------------------------------------------
  const LIVE = (window.LIVE = {
    // The old archive goes in here, once. Admin only, and only on the real app: a plain file has no server to send it to.
    oldClarityData: (c) => (c.id !== "clarity" || !window.BOOT?.served || !isAdmin() ? "" : `<details class="fold how" id="ca-fold"><summary>${icon("chevron-right")}${t("Old Clarity data")}</summary>
      <p class="help" style="margin:0 0 10px">${t("Upload the file made on your Mac by scripts/clarity_archive_export.py. It only adds days this app doesn't have yet, so uploading twice changes nothing.")}</p>
      <label class="field"><span>${t("File")}</span><input class="input" id="ca-file" type="file" accept=".json,application/json"></label>
      <div id="ca-result" aria-live="polite"></div>
    </details>
    <details class="fold how" id="cr-fold"><summary>${icon("chevron-right")}${t("Clarity dashboard downloads")}</summary>
      <p class="help" style="margin:0 0 10px">${t("In Clarity, open Dashboard and press Export, for each site. Upload the .csv files here, several at once. Each one is kept for its own period: they show on Content and AI search.")}</p>
      <label class="field"><span>${t("Site")}</span><select class="select" id="cr-site"><option value="">${t("Find it from the file")}</option>${window.SITES.filter((s) => s.realId).map((s) => `<option value="${s.realId}">${esc(s.host)}</option>`).join("")}</select></label>
      <label class="field"><span>${t("Files")}</span><input class="input" id="cr-file" type="file" accept=".csv,text/csv" multiple></label>
      <div id="cr-result" aria-live="polite"></div>
    </details>`),
    // These keys belong to the whole app, so asking "which sites?" would offer a choice that nothing keeps.
    appWide: (c) => c.group !== "serp" && c.auth === "key" && !SOURCE_OF[c.id],
    gaOptions: () => L.ga.map((p) => p.id),
    scOptions: () => L.sc,
    tabs() {
      const tab = (id, word) => `<button class="tab" role="tab" data-lv-tab="${id}" aria-selected="${L.tab === id}">${t(word)}</button>`;
      return tab("connections", "Connections") + tab("sites", "Sites") + tab("team", "Team") + tab("domains", "Important domains");
    },
    // The key box is emptied once a key is stored, so it says a key is there, or it looks as if nothing saved.
    savedGoogleNote: () => (L.data?.google?.length ? `${t("A robot key is saved")} (${L.data.google[0].last4}). ${t("Paste a new one only to replace it.")}` : ""),
    googleExtras() {
      const list = L.data?.google || [];
      if (!list.length) return "";
      // The property lists come from asking Google what this key can see. Ask as the panel opens, so they're never empty for no reason. It's free.
      if (!L.sc.length && !L.ga.length && Date.now() - (L.autoTestAt || 0) > 30000) {
        L.autoTestAt = Date.now();
        setTimeout(async () => { try { showGoogleResult(await api("POST", `google-connections/${list[0].id}/test`, {})); } catch { /* the Test button still shows why */ } }, 50);
      }
      return `<h3>${t("Google connections")}</h3><ul class="rows" style="margin:0 0 12px">${list.map((g) => `<li><div class="what"><div class="t" dir="auto">${esc(g.label)}</div><div class="d">${t(g.kind === "robot" ? "Robot key" : "OAuth keys")} · ${esc(g.last4)}${g.last_error ? ` · <span class="crit">${esc(g.last_error)}</span>` : ""}</div></div><div class="acts"><button type="button" class="btn btn-small" data-lv-google-test="${g.id}">${t("Test")}</button><button type="button" class="btn btn-small btn-ghost danger" data-lv-google-del="${g.id}" aria-label="${t("Remove")}: ${esc(g.label)}">${t("Remove")}</button></div></li>`).join("")}</ul><div id="lv-google-result" role="status"></div>`;
    },
    connectionSelect(site) {
      const list = L.data?.google || [];
      if (list.length < 2) return "";
      const held = L.data.site_sources.find((r) => r.site_id === site.realId && r.source === "gsc")?.connection_id
        || L.data.site_sources.find((r) => r.site_id === site.realId && r.source === "ga4")?.connection_id || list[0].id;
      return `<label class="prop-field"><span class="small sec">${t("Google connection")}</span><select class="select" data-lv-site-conn="${site.id}" aria-label="${esc(site.host)}: ${t("Google connection")}">${list.map((g) => `<option value="${g.id}" ${g.id === held ? "selected" : ""}>${esc(g.label)}</option>`).join("")}</select></label>`;
    },
  });

  // ---- the old Clarity archive ---------------------------------------------------------------------
  const longDay = (day) => new Intl.DateTimeFormat(UI.locale(), { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${day}T00:00:00`));
  const daysWord = (n) => `${num(n)} ${t(n === 1 ? "day" : "days")}`;
  function archiveRows(answer) {
    const span = (s) => (s.first_day ? ` · ${esc(longDay(s.first_day))} – ${esc(longDay(s.last_day))}` : "");
    const rows = answer.sites.map((s) => `<li><div class="what"><div class="t" dir="ltr">${esc(s.host)}</div><div class="s">${daysWord(s.added)} ${t(answer.preview ? "to add" : "added")}${s.kept ? `, ${daysWord(s.kept)} ${t("already here")}` : ""}${span(s)}</div></div></li>`).join("");
    const missing = answer.missing_sites.length ? `<p class="note warn" style="margin:10px 0 0">${icon("triangle-alert")}<span>${t("These sites aren't in the app, so their days are left out. Add them as your own sites, then upload the file again:")} ${answer.missing_sites.map((s) => `<span dir="ltr">${esc(s.host)}</span> (${daysWord(s.days)})`).join(", ")}</span></p>` : "";
    return `${rows ? `<ul class="rows" style="margin:0">${rows}</ul>` : ""}${missing}`;
  }
  async function sendArchive(preview) {
    const box = UI.$("#ca-result"), file = UI.$("#ca-file")?.files?.[0];
    if (!box || !file) return;
    const form = new FormData();
    form.append("file", file);
    if (preview) form.append("preview", "1");
    const failed = (err) => UI.setHTML(box, `<span class="error" style="margin:0" role="alert">${icon("octagon-alert")}${esc(t(err.message))}</span>`);
    UI.setHTML(box, `<p class="small sec" style="margin:0">${t(preview ? "Reading the file…" : "Adding the days…")}</p>`);
    let answer;
    try {
      answer = await window.COMP.api("POST", "clarity-archive", undefined, { form });
    } catch (err) { failed(err); return; }
    const toAdd = answer.sites.reduce((sum, s) => sum + s.added, 0);
    if (!preview) {
      window.LV?.cache.clear(); // the screens read these days next time they open
      UI.toast(`${daysWord(toAdd)} ${t("added")}`);
    }
    const next = !preview ? `<p class="small sec" style="margin:10px 0 0">${t("You'll find them on Content, when the period includes those dates.")}</p>`
      : toAdd ? `<div class="test-row" style="margin-top:10px"><button type="button" class="btn btn-main btn-small" id="ca-import">${t("Add")} ${daysWord(toAdd)}</button></div>`
        : `<p class="small sec" style="margin:10px 0 0">${t("Nothing new to add.")}</p>`;
    UI.setHTML(box, archiveRows(answer) + next);
    box.scrollIntoView({ block: "nearest" }); // the button to press is the last thing here, and the panel's footer would cover it
  }

  // ---- Clarity's dashboard downloads -----------------------------------------------------------------
  const KIND_WORD = { dashboard: "Dashboard", ai: "AI visibility" };
  function reportRows(answer) {
    return `<ul class="rows" style="margin:0">${answer.files.map((f) => f.error
      ? `<li><div class="what"><div class="t" dir="auto">${esc(f.file)}</div><div class="s crit">${esc(t(f.error))}</div></div></li>`
      : `<li><div class="what"><div class="t" dir="ltr">${esc(f.host)}</div><div class="s">${f.kinds.map((k) => `${t(KIND_WORD[k.kind] || k.kind)}${k.replaces ? ` (${t(answer.preview ? "replaces the one already here" : "replaced")})` : ""}`).join(", ")} · ${esc(longDay(f.period_start))} – ${esc(longDay(f.period_end))}</div></div></li>`).join("")}</ul>`;
  }
  async function sendReports(preview) {
    const box = UI.$("#cr-result"), files = [...(UI.$("#cr-file")?.files || [])];
    if (!box || !files.length) return;
    const form = new FormData();
    files.forEach((file) => form.append("file", file));
    const site = UI.$("#cr-site")?.value;
    if (site) form.append("site_id", site);
    if (preview) form.append("preview", "1");
    UI.setHTML(box, `<p class="small sec" style="margin:0">${t(preview ? "Reading the files…" : "Adding them…")}</p>`);
    let answer;
    try {
      answer = await window.COMP.api("POST", "clarity-reports", undefined, { form });
    } catch (err) { UI.setHTML(box, `<span class="error" style="margin:0" role="alert">${icon("octagon-alert")}${esc(t(err.message))}</span>`); return; }
    const good = answer.files.filter((f) => !f.error).length;
    if (!preview) {
      window.LV?.cache.clear();
      UI.toast(`${num(good)} ${t(good === 1 ? "file added" : "files added")}`);
    }
    const next = !preview ? `<p class="small sec" style="margin:10px 0 0">${t("You'll find them on Content and AI search.")}</p>`
      : good ? `<div class="test-row" style="margin-top:10px"><button type="button" class="btn btn-main btn-small" id="cr-import">${t("Add")} ${num(good)} ${t(good === 1 ? "file" : "files")}</button></div>`
        : "";
    UI.setHTML(box, reportRows(answer) + next);
    box.scrollIntoView({ block: "nearest" });
  }

  // ---- saving a connection ------------------------------------------------------------------------
  const resultBox = () => UI.$("#conn-test-result");
  const say = (html) => { const box = resultBox(); if (box) { UI.setHTML(box, html); box.scrollIntoView({ block: "nearest" }); } };
  // The "How to fix it" list under a failed Test. It replaces the one at the top of the panel, so the advice isn't shown twice.
  const fixFor = (message, c) => {
    if (!message || !window.FIX) return "";
    UI.$("#conn-fix")?.remove();
    return window.FIX.html(message, { tool: c?.name?.split(":")[0], id: c?.id, keyUrl: window.FIX.keyUrl(c), retry: "test", robot: c?.robot });
  };
  const sayError = (message) => say(`<span class="error" style="margin:0" role="alert">${icon("octagon-alert")}${esc(t(message))}</span>`);
  const typedGoogle = () => {
    const kind = UI.$('input[name="google-type"]:checked')?.value;
    if (kind === "robot") { const raw = UI.$("#conn-json")?.value.trim(); return raw ? { kind, key: raw } : null; }
    const key = { client_id: UI.$("#conn-client")?.value.trim(), client_secret: UI.$("#conn-secret")?.value.trim(), refresh_token: UI.$("#conn-refresh")?.value.trim() };
    return key.client_id || key.client_secret || key.refresh_token ? { kind, key } : null;
  };

  async function saveGoogle() {
    const typed = typedGoogle();
    if (typed) {
      L.newGoogle = await api("POST", "google-connections", typed);
      // It's stored now. If a site fails below, pressing Save again must not store it a second time.
      ["#conn-json", "#conn-client", "#conn-secret", "#conn-refresh"].forEach((box) => { const field = UI.$(box); if (field) field.value = ""; });
    }
    const newest = L.newGoogle;
    if (!newest && !L.data.google.length) throw new Error("Paste the key first.");
    const fallback = newest?.id || L.data.google[0]?.id;
    for (const s of window.SITES) {
      const pick = (kind) => {
        const sel = UI.$(`[data-prop="${kind}"][data-site="${s.id}"]`);
        if (!sel) return undefined;
        return sel.value === "__other" ? UI.$(`[data-prop-other="${kind}"][data-site="${s.id}"]`).value.trim() : sel.value;
      };
      const chosen = UI.$(`[data-lv-site-conn="${s.id}"]`);
      const connection_id = chosen ? +chosen.value : fallback;
      for (const [kind, source] of [["sc", "gsc"], ["ga4", "ga4"]]) {
        const value = pick(kind);
        if (value === undefined) continue;
        const was = L.data.site_sources.find((r) => r.site_id === s.realId && r.source === source);
        if (!value && !was) continue; // nothing chosen and nothing to undo: a blank row isn't a decision
        await api("PUT", `sites/${s.realId}/sources/${source}`, { property: value, connection_id, not_used: !value });
      }
    }
    L.newGoogle = null;
    return newest;
  }

  async function saveClarity() {
    for (const s of window.SITES) {
      const none = UI.$(`[data-site-none="${s.id}"]`)?.checked;
      const token = UI.$(`#conn-token-${s.id}`)?.value.trim();
      const was = L.data.site_sources.find((r) => r.site_id === s.realId && r.source === "clarity");
      if (token && !none) await api("PUT", `sites/${s.realId}/sources/clarity`, { token, not_used: false });
      else if (none || was) await api("PUT", `sites/${s.realId}/sources/clarity`, { not_used: Boolean(none) });
    }
  }

  async function saveKey(c) {
    const key = UI.$("#conn-key")?.value.trim();
    if (key) await api("PUT", `app-keys/${c.id}`, { key });
    else if (c.status === "off") throw new Error("Paste the key first.");
    const source = SOURCE_OF[c.id];
    if (!source) return;
    const some = UI.$('input[name="conn-scope"][value="some"]')?.checked;
    const kept = new Set(UI.$$("[data-conn-site]").filter((box) => box.checked).map((box) => box.dataset.connSite));
    for (const s of window.SITES) await api("PUT", `sites/${s.realId}/sources/${source}`, { not_used: Boolean(some && !kept.has(s.id)) });
  }

  async function onSave(button, c) {
    const untyped = UI.$$("[data-prop]").find((sel) => sel.value === "__other" && !UI.$(`[data-prop-other="${sel.dataset.prop}"][data-site="${sel.dataset.site}"]`).value.trim());
    if (untyped) { sayError("Type the property, or pick another option."); return; }
    button.disabled = true;
    try {
      if (c.id === "google") await saveGoogle();
      else if (c.id === "clarity") await saveClarity();
      else await saveKey(c);
      await reload();
      window.LV?.forget?.();
      UI.forgetPanelForm(); UI.closePanel(); UI.render();
      UI.toast(t("Connection saved"));
    } catch (err) { sayError(err.message); button.disabled = false; }
  }

  // A GA4 property has a name, not an address: "Acme Store" goes with acme-store.com. Only one clear match counts.
  const plain = (word) => String(word || "").normalize("NFD").replace(/[^a-z0-9]/gi, "").toLowerCase();
  function gaMatch(host) {
    const base = plain(host.replace(/^www\./, "").replace(/\.[^.]+$/, ""));
    const found = L.ga.filter((p) => plain(p.name) === base);
    return found.length === 1 ? found[0].id : "";
  }

  function showGoogleResult(answer) {
    if (answer.search_console.ok && answer.ga4.ok) UI.$("#conn-fix")?.remove();
    const line = (name, part) => (part.ok ? status("good", `${name}: ${t("works")} · ${num(part.properties.length)} ${t(part.properties.length === 1 ? "property" : "properties")}`) : `<div class="error" style="margin:0 0 4px">${icon("octagon-alert")}${esc(name)}: ${esc(t(part.error || "It didn't work."))}</div>${fixFor(part.error, conn("google"))}`);
    say(`<div style="display:grid;gap:6px;margin-top:6px">${line("Search Console", answer.search_console)}${line("GA4", answer.ga4)}${answer.search_console.ok && !answer.search_console.properties.length ? `<p class="small sec" style="margin:0">${t("It can't see any Search Console property yet. Add its email in Search Console, then test again.")}</p>` : ""}</div>`);
    L.sc = answer.search_console.properties || [];
    L.ga = answer.ga4.properties || [];
    // What Google says this key can see now fills the lists, and the obvious match is picked.
    UI.$$('[data-prop="sc"], [data-prop="ga4"]').forEach((sel) => {
      const kind = sel.dataset.prop, chosen = sel.value, site = window.SITES.find((s) => s.id === sel.dataset.site);
      const options = kind === "sc" ? L.sc : L.ga.map((p) => p.id);
      const labels = kind === "ga4" ? Object.fromEntries(L.ga.map((p) => [p.id, `${p.name} (${p.id})`])) : {};
      const match = chosen ? "" : kind === "sc" ? options.find((o) => o === `sc-domain:${site.host}` || o === `https://${site.host}/` || o === `https://www.${site.host}/`) : gaMatch(site.host);
      const held = [...sel.options].filter((o) => !o.value || o.value === "__other");
      const list = [...new Set([...options, ...(chosen && chosen !== "__other" ? [chosen] : [])])];
      sel.replaceChildren(...list.map((o) => new Option(labels[o] || o, o)), ...held);
      sel.value = match || chosen;
    });
  }

  async function onTest(button, c) {
    const was = button.textContent;
    button.disabled = true; button.textContent = t("Testing…");
    try {
      if (c.id === "google") {
        let id = L.data.google[0]?.id;
        const typed = typedGoogle();
        if (typed) { id = (await api("POST", "google-connections", typed)).id; UI.$("#conn-json") && (UI.$("#conn-json").value = ""); ["#conn-client", "#conn-secret", "#conn-refresh"].forEach((f) => { if (UI.$(f)) UI.$(f).value = ""; }); await reload(); }
        if (!id) { sayError("Paste the key first."); return; }
        showGoogleResult(await api("POST", `google-connections/${id}/test`, {}));
      } else if (c.id === "clarity") {
        say(`<span class="note inline-note">${icon("info")}<span>${t("Clarity allows 10 requests a day per project, so testing would use one up. The first pull shows whether the token works.")}</span></span>`);
      } else {
        const key = UI.$("#conn-key")?.value.trim();
        if (key) { await api("PUT", `app-keys/${c.id}`, { key }); UI.$("#conn-key").value = ""; }
        const answer = await api("POST", `app-keys/${c.id}/test`, {});
        if (answer.ok !== false) UI.$("#conn-fix")?.remove(); // it works now: the old advice would only confuse
        say(answer.ok === true ? status("good", `${t("Works.")}${answer.left === null || answer.left === undefined ? "" : ` ${num(answer.left)} ${t("of")} ${num(answer.of)} ${t("free requests left today")}`}`) : answer.ok === null ? `<span class="note inline-note">${icon("info")}<span>${esc(t(answer.note))}</span></span>` : `<span class="error" style="margin:0">${icon("octagon-alert")}${esc(t(answer.note))}</span>${fixFor(answer.note, c)}`);
        await reload();
      }
    } catch (err) { sayError(err.message); } finally { if (button.isConnected) { button.disabled = false; button.textContent = was; } }
  }

  // ---- Sites tab --------------------------------------------------------------------------------
  const SOURCES = [["gsc", "Search Console"], ["ga4", "GA4"], ["clarity", "Clarity"], ["bing", "Bing Webmaster"], ["yandex", "Yandex Webmaster"]];
  function sourceWord(site, source) {
    const r = L.data?.site_sources.find((x) => x.site_id === site.realId && x.source === source);
    if (r?.not_used) return `<span class="status sec">${t("Not used")}</span>`;
    if (r?.last_error) return status("crit", t("Failing"));
    if (r?.last_ok_at) return status("good", r.data_through ? `${t("Data through")} ${new Intl.DateTimeFormat(UI.locale(), { day: "numeric", month: "short" }).format(new Date(`${r.data_through}T00:00:00`))}` : t("Connected"));
    const set = source === "clarity" ? r?.has_secret : source === "gsc" || source === "ga4" ? r?.connection_id && r?.property : (L.data?.keys.find((k) => k.id === source)?.connected);
    return set ? `<span class="status sec">${t("Waiting for first data")}</span>` : `<span class="status sec">${t("Not set up")}</span>`;
  }
  const sitesTab = () => {
    if (!window.SITES.length) return `<section class="card"><div class="empty"><h3>${t("No site yet")}</h3><p>${t("Add a site to see its data.")}</p><div style="margin-top:12px"><button class="btn btn-main" data-lv-add-site>${t("Add a site")}</button></div></div></section>`;
    return `<section class="card"><div class="card-head"><h2>${t("Your sites")}</h2><span class="end"><button class="btn btn-small" data-lv-add-site>${icon("plus")}${t("Add a site")}</button></span></div>
      <div class="table-wrap" style="box-shadow:none"><table class="data"><thead><tr><th>${t("Site")}</th>${SOURCES.map(([, name]) => `<th>${esc(t(name))}</th>`).join("")}<th></th></tr></thead><tbody>
      ${window.SITES.map((s) => `<tr style="cursor:default"><td data-label="${t("Site")}"><span class="mono" dir="auto">${esc(s.host)}</span></td>${SOURCES.map(([id, name]) => `<td data-label="${esc(t(name))}">${sourceWord(s, id)}</td>`).join("")}<td data-label="" class="r" style="white-space:nowrap"><button class="btn btn-small" data-setup-panel="${esc(s.host)}">${t("Set up")}</button> <button class="btn btn-small" data-lv-site-collect="${s.realId}">${t("Refresh data")}</button></td></tr>`).join("")}
      </tbody></table></div></section>`;
  };

  // ---- Team tab ---------------------------------------------------------------------------------
  async function loadTeam() {
    try { L.team = await api("GET", "team"); } catch (err) { L.team = { error: err.message }; }
    if (UI.state.route === "settings" && L.tab === "team" && !UI.$("#panel")) UI.render();
  }
  function teamTab() {
    if (L.team === null) { loadTeam(); return `<section class="card"><div class="empty"><p>${t("Loading…")}</p></div></section>`; }
    if (L.team.error) return `<section class="card"><div class="empty"><h3>${t("That didn't load")}</h3><p>${esc(L.team.error)}</p></div></section>`;
    if (!L.team.users) return `<section class="card"><div class="card-head"><h2>${t("Team")}</h2></div><ul class="rows">${L.team.names.map((name) => `<li><div class="what"><div class="t" dir="auto">${esc(name)}</div></div></li>`).join("")}</ul><p class="help" style="padding:8px 18px">${t("Only an admin can add or change accounts.")}</p></section>`;
    const me = window.BOOT.user?.id;
    return `<section class="card"><div class="card-head"><h2>${t("Team")}</h2><span class="end"><button class="btn btn-small btn-main" data-lv-user-new>${icon("plus")}${t("Add a person")}</button></span></div>
      <div class="table-wrap" style="box-shadow:none"><table class="data"><thead><tr><th>${t("Name")}</th><th>${t("Username or email")}</th><th>${t("Role")}</th><th>${t("Status")}</th><th></th></tr></thead><tbody>
      ${L.team.users.map((u) => `<tr style="cursor:default"><td data-label="${t("Name")}" dir="auto">${esc(u.name)}${u.id === me ? ` <span class="tag">${t("You")}</span>` : ""}</td><td data-label="${t("Username or email")}" class="mono">${esc(u.email)}</td>
        <td data-label="${t("Role")}"><select class="select" data-lv-user-role="${u.id}" aria-label="${t("Role")}: ${esc(u.name)}"><option value="member" ${u.role === "member" ? "selected" : ""}>${t("Member")}</option><option value="admin" ${u.role === "admin" ? "selected" : ""}>${t("Admin")}</option></select></td>
        <td data-label="${t("Status")}">${u.disabled ? `<span class="status sec">${t("Disabled")}</span>` : u.locked ? status("warn", t("Locked for now")) : u.must_change_password ? `<span class="status sec">${t("Waiting for first login")}</span>` : status("good", t("Active"))}</td>
        <td data-label="" class="r" style="white-space:nowrap"><button class="btn btn-small" data-lv-user-reset="${u.id}">${t("Reset password")}</button> <button class="btn btn-small btn-ghost" data-lv-user-disable="${u.id}" data-now="${u.disabled ? 1 : 0}">${t(u.disabled ? "Enable" : "Disable")}</button></td></tr>`).join("")}
      </tbody></table></div></section>`;
  }
  function userPanel(opener) {
    UI.openPanel(`${UI.panelHead(t("Add a person"), t("They get a temporary password, and choose their own at first login."))}
      <form class="panel-body" id="lv-user-form" novalidate>
        <label class="field"><span>${t("Name")}</span><input class="input" name="f_name" dir="auto" autocomplete="off"></label>
        <label class="field"><span>${t("Username or email")}</span><input class="input" name="f_email" type="text" dir="ltr" autocapitalize="none" spellcheck="false" autocomplete="off"></label>
        <label class="field"><span>${t("Role")}</span><select class="select" name="f_role" style="width:100%"><option value="member">${t("Member")}</option><option value="admin">${t("Admin")}</option></select></label>
        <div class="error" data-lv-form-error role="alert" hidden></div>
      </form><div class="panel-foot"><button class="btn btn-main" data-lv-user-save>${t("Add")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener, { key: "user|new", reopen: () => userPanel(opener) });
  }
  function showPassword(name, password) {
    UI.openPanel(`${UI.panelHead(t("Temporary password"), esc(name))}
      <div class="panel-body"><p class="note warn">${icon("triangle-alert")}<span>${t("Shown once. Copy it now and give it to them in person or by a private message. They change it at first login.")}</span></p>
      <div class="lv-secret"><code class="mono" dir="ltr">${esc(password)}</code><button type="button" class="btn btn-small" data-copy="${esc(password)}">${t("Copy")}</button></div></div>
      <div class="panel-foot"><button class="btn btn-main" data-close-panel>${t("Done")}</button></div>`);
  }
  const showError = (err) => UI.toast(t(err.message), { kind: "crit" });

  // ---- Important domains: Moz and Cloudflare only ever run on these, from a button ------------------
  async function loadDomains() {
    try { L.domains = await api("GET", "important-domains"); } catch (err) { L.domains = { error: err.message }; }
    if (UI.state.route === "settings" && L.tab === "domains" && !UI.$("#panel")) UI.render();
  }
  function domainsTab() {
    if (!L.domains) { loadDomains(); return `<section class="card"><div class="empty"><p>${t("Loading…")}</p></div></section>`; }
    const d = L.domains;
    if (d.error) return `<section class="card"><div class="empty"><h3>${t("That didn't load")}</h3><p>${esc(d.error)}</p></div></section>`;
    const waiting = d.domains.filter((x) => !x.fetched_at).length;
    const blank = (v) => (v === null || v === undefined ? `<span class="muted">—</span>` : num(v));
    return `<section class="card"><div class="card-head"><h2>${t("Important domains")}</h2><span class="end small muted">${d.moz_connected ? `${num(d.rows_left)} ${t("of")} ${num(d.rows_free)} ${t("Moz rows left this month")}` : t("Moz isn't connected")}</span></div>
      <p class="help" style="padding:10px 18px 2px;margin:0">${t("Moz gives few free rows, so it only runs on domains you add here, and only when you press the button. Results are kept, so a row is never used twice in a month.")}</p>
      <form class="lv-rule-form" data-lv-domain-form style="border-top:0"><input class="input mono" name="f_domain" placeholder="example.com" aria-label="${t("Add a domain")}" autocomplete="off"><button class="btn btn-small" type="submit">${t("Add a domain")}</button>
        <button type="button" class="btn btn-small btn-main" data-lv-moz ${d.moz_connected && waiting && d.rows_left ? "" : "disabled"}>${t("Get Moz data")}${waiting ? ` (${num(waiting)})` : ""}</button>
        <button type="button" class="btn btn-small" data-lv-radar ${d.radar_connected && d.domains.length ? "" : "disabled"}>${t("Get popularity")}</button><span class="error" data-lv-rule-error hidden></span></form>
      ${d.domains.length ? `<div class="table-wrap" style="box-shadow:none"><table class="data"><thead><tr><th>${t("Domain")}</th><th class="c">${t("Authority")}</th><th class="c">${t("Moz Domain Authority")}</th><th class="c">${t("Linking domains")}</th><th class="c">${t("Links")}</th><th class="c">${t("Popularity")}</th><th></th></tr></thead><tbody>
        ${d.domains.map((x) => `<tr style="cursor:default"><td data-label="${t("Domain")}" class="mono" dir="auto">${esc(x.domain)}</td><td class="c" data-label="${t("Authority")}">${x.authority === null ? `<span class="muted">—</span>` : esc(String(x.authority))}</td><td class="c" data-label="${t("Moz Domain Authority")}">${blank(x.domain_authority)}</td><td class="c" data-label="${t("Linking domains")}">${blank(x.linking_domains)}</td><td class="c" data-label="${t("Links")}">${blank(x.external_links)}</td><td class="c" data-label="${t("Popularity")}" dir="auto">${x.popularity ? esc(t(x.popularity)) : `<span class="muted">—</span>`}</td><td class="r" data-label=""><button class="btn btn-small btn-ghost" data-lv-domain-off="${esc(x.domain)}" aria-label="${t("Remove")}: ${esc(x.domain)}">${t("Remove")}</button></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty" style="padding:28px"><p>${t("No domains yet. Add the ones worth a closer look.")}</p></div>`}</section>
      ${indexNowCard()}`;
  }
  const indexNowCard = () => {
    const on = L.data?.keys.find((k) => k.id === "indexnow")?.connected;
    return `<section class="card" style="margin-top:14px"><div class="card-head"><h2>${t("Tell Bing and Yandex about new pages")}</h2><span class="end small muted">${t("IndexNow. Google doesn't take part.")}</span></div>
      ${on && window.SITES.length ? `<form class="panel-body" data-lv-indexnow style="padding:12px 18px"><label class="field"><span>${t("Site")}</span><select class="select" name="f_site" style="width:100%">${window.SITES.map((s) => `<option value="${s.realId}">${esc(s.host)}</option>`).join("")}</select></label>
        <label class="field"><span>${t("Addresses, one per line")}</span><textarea class="input mono" name="f_urls" rows="4" dir="ltr" placeholder="https://"></textarea></label><div class="error" data-lv-rule-error role="alert" hidden></div><button class="btn btn-small" type="submit">${t("Send")}</button></form>`
        : `<div class="empty" style="padding:24px"><p>${t("Connect IndexNow first: paste its key, and put the key file on your site.")}</p><button class="btn btn-small" data-lv-open-conn="indexnow">${t("Connect")}</button></div>`}</section>`;
  };

  // ---- events: before the page's own handlers, because these connections save for real ---------------
  function bind() {
    document.addEventListener("click", async (e) => {
      const hit = (sel) => e.target.closest?.(sel);
      const take = () => { e.stopPropagation(); e.preventDefault(); };
      let el;
      if (hit("[data-lv-signout]")) { take(); window.signOut(); return; }
      if (hit("[data-lv-sources-retry]")) { take(); L.failed = ""; UI.render(); firstLoad(); return; }
      if (hit("#ca-import")) { take(); sendArchive(false); return; }
      if (hit("#cr-import")) { take(); sendReports(false); return; }
      if ((el = hit("[data-lv-tab]"))) { take(); L.tab = el.dataset.lvTab; UI.render(); return; }
      if ((el = hit("#conn-save"))) { const c = conn(el.dataset.id); if (c && c.group !== "serp") { take(); if (isAdmin()) onSave(el, c); else sayError("Only an admin can do that."); } return; }
      if ((el = hit("#conn-test"))) { const c = conn(UI.$("#conn-save")?.dataset.id); if (c && c.group !== "serp") { take(); onTest(el, c); } return; }
      if ((el = hit("#conn-disconnect"))) {
        const c = conn(el.dataset.id);
        if (!c || c.group === "serp") return;
        take();
        if (c.id === "clarity") { sayError("Clarity has a token per site. Tick This site doesn't use it next to the site, then press Save."); return; }
        if (c.id === "google") { sayError("Press Remove next to the Google connection above."); return; }
        if (!window.confirm(t("Remove this key? You'd have to paste it again."))) return;
        try { await api("DELETE", `app-keys/${c.id}`); await reload(); UI.forgetPanelForm(); UI.closePanel(); UI.render(); UI.toast(t("Disconnected"), { kind: "info" }); } catch (err) { sayError(err.message); }
        return;
      }
      if ((el = hit("[data-lv-google-test]"))) {
        take(); el.disabled = true;
        try { showGoogleResult(await api("POST", `google-connections/${el.dataset.lvGoogleTest}/test`, {})); await reload(); } catch (err) { sayError(err.message); }
        el.disabled = false;
        return;
      }
      if ((el = hit("[data-lv-google-del]"))) {
        take();
        if (!window.confirm(t("Remove this Google connection? Sites keep their data, and stop updating until they use another one."))) return;
        try { await api("DELETE", `google-connections/${el.dataset.lvGoogleDel}`); await reload(); UI.forgetPanelForm(); UI.closePanel(); UI.render(); UI.toast(t("Disconnected"), { kind: "info" }); } catch (err) { sayError(err.message); }
        return;
      }
      if ((el = hit("[data-lv-site-collect]"))) {
        take(); el.disabled = true;
        try { const a = await api("POST", `sites/${el.dataset.lvSiteCollect}/collect`, {}); UI.toast(t(a.started.length ? "Reading the latest data. It appears here when it arrives." : "Nothing to read yet: connect a data source first, or it's already running."), { kind: a.started.length ? "good" : "info" }); } catch (err) { showError(err); }
        el.disabled = false;
        return;
      }
      if ((el = hit("[data-lv-open-conn]"))) { take(); L.tab = "connections"; UI.openConnection(el.dataset.lvOpenConn); return; }
      if ((el = hit("[data-lv-moz], [data-lv-radar]"))) {
        take(); el.disabled = true;
        const moz = el.matches("[data-lv-moz]");
        try {
          const answer = await api("POST", `important-domains/${moz ? "moz" : "popularity"}`, {});
          L.domains = answer; UI.render();
          if (answer.error) UI.toast(answer.error, { kind: "crit" });
          else UI.toast(moz ? `${num(answer.fetched)} ${t("domains updated")}${answer.held_back ? ` · ${num(answer.held_back)} ${t("held back: no free rows left")}` : ""}` : t("Popularity updated"));
        } catch (err) { showError(err); UI.render(); }
        return;
      }
      if ((el = hit("[data-lv-domain-off]"))) {
        take();
        try { L.domains = await api("POST", "important-domains", { domain: el.dataset.lvDomainOff, important: false }); UI.render(); } catch (err) { showError(err); }
        return;
      }
      if ((el = hit("[data-lv-user-new]"))) { take(); userPanel(el); return; }
      if (hit("[data-lv-user-save]")) {
        take();
        const form = UI.$("#lv-user-form"), box = form.querySelector("[data-lv-form-error]");
        box.hidden = true;
        try {
          const made = await api("POST", "team", { name: form.elements.f_name.value, email: form.elements.f_email.value, role: form.elements.f_role.value });
          UI.forgetPanelForm(); UI.closePanel(); L.team = null; await loadTeam(); UI.render(); showPassword(made.user.name, made.temporary_password);
        } catch (err) { box.textContent = t(err.message); box.hidden = false; }
        return;
      }
      if ((el = hit("[data-lv-user-reset]"))) {
        take();
        const user = L.team.users.find((u) => String(u.id) === el.dataset.lvUserReset);
        if (!window.confirm(`${t("Reset this person's password? They'll be signed out.")} (${user.name})`)) return;
        try { showPassword(user.name, (await api("POST", `team/${user.id}/reset`, {})).temporary_password); L.team = null; loadTeam(); } catch (err) { showError(err); }
        return;
      }
      if ((el = hit("[data-lv-user-disable]"))) {
        take();
        try { await api("PATCH", `team/${el.dataset.lvUserDisable}`, { disabled: el.dataset.now !== "1" }); L.team = null; await loadTeam(); UI.render(); } catch (err) { showError(err); }
      }
    }, true);
    document.addEventListener("change", async (e) => {
      if (e.target.id === "ca-file") { sendArchive(true); return; }
      if (e.target.id === "cr-file" || (e.target.id === "cr-site" && UI.$("#cr-file")?.files?.length)) { sendReports(true); return; }
      const el = e.target.closest?.("[data-lv-user-role]");
      if (!el) return;
      try { await api("PATCH", `team/${el.dataset.lvUserRole}`, { role: el.value }); UI.toast(t("Saved")); } catch (err) { showError(err); }
      L.team = null; await loadTeam(); UI.render();
    });
    document.addEventListener("submit", async (e) => {
      const form = e.target;
      const box = form.querySelector?.("[data-lv-rule-error]");
      if (form.matches?.("[data-lv-domain-form]")) {
        e.preventDefault(); box.hidden = true;
        try { L.domains = await api("POST", "important-domains", { domain: form.elements.f_domain.value }); UI.render(); UI.$("[data-lv-domain-form] input")?.focus(); } catch (err) { box.textContent = t(err.message); box.hidden = false; }
      } else if (form.matches?.("[data-lv-indexnow]")) {
        e.preventDefault(); box.hidden = true;
        try {
          const answer = await api("POST", "indexnow", { site_id: +form.elements.f_site.value, urls: form.elements.f_urls.value });
          form.elements.f_urls.value = "";
          UI.toast(`${num(answer.sent)} ${t("addresses sent")}${answer.pending_key_check ? ` · ${t("The key is still being checked.")}` : ""}`);
        } catch (err) { box.textContent = t(err.message); box.hidden = false; }
      }
    });
    window.addEventListener("seocc:site-added", () => { reload().catch(() => {}); });
    window.addEventListener("seocc:sources-changed", () => { reload().catch(() => {}); }); // the setup checklist can say a site doesn't use one
  }

  window.SCREENS = window.SCREENS || {};
  window.SCREENS.settings = {
    init(helpers) {
      UI = helpers; ({ t, esc, num, icon, status } = helpers);
      bind();
      firstLoad();
    },
    page() {
      const tabs = `<div class="tabs" role="tablist" aria-label="${t("Settings")}">${LIVE.tabs()}</div>`;
      if (L.tab === "connections") {
        if (L.data) return UI.settingsPage();
        const waiting = L.failed
          ? `<h3>${t("That didn't load")}</h3><p>${esc(t(L.failed))}</p><div style="margin-top:12px"><button type="button" class="btn" data-lv-sources-retry>${t("Try again")}</button></div>`
          : `<p>${t("Loading…")}</p>`;
        return UI.topbar(t("Settings"), t("Connect your tools and choose which sites use them"), "", false) + `<div class="content page-enter">${tabs}<section class="card"><div class="empty">${waiting}</div></section></div>`;
      }
      const sub = { sites: "Your sites and where their data comes from", team: "Who can sign in", domains: "Domains worth a closer look" }[L.tab];
      return UI.topbar(t("Settings"), t(sub), "", false) + `<div class="content page-enter">${tabs}${L.tab === "sites" ? sitesTab() : L.tab === "domains" ? domainsTab() : teamTab()}</div>`;
    },
  };

  const fr = {
    "Try again": "Réessayer",
    "Old Clarity data": "Anciennes données Clarity",
    "Clarity dashboard downloads": "Exports du tableau de bord Clarity", "Find it from the file": "Le trouver dans le fichier", "Files": "Fichiers",
    "In Clarity, open Dashboard and press Export, for each site. Upload the .csv files here, several at once. Each one is kept for its own period: they show on Content and AI search.": "Dans Clarity, ouvrez Tableau de bord et appuyez sur Exporter, pour chaque site. Importez ici les fichiers .csv, plusieurs à la fois. Chacun est gardé pour sa propre période : ils s'affichent dans Contenu et Recherche IA.",
    "Dashboard": "Tableau de bord", "AI visibility": "Visibilité IA", "replaces the one already here": "remplace celui déjà présent", "replaced": "remplacé",
    "Reading the files…": "Lecture des fichiers…", "Adding them…": "Ajout en cours…", "file added": "fichier ajouté", "files added": "fichiers ajoutés", "file": "fichier", "files": "fichiers",
    "You'll find them on Content and AI search.": "Vous les retrouverez dans Contenu et Recherche IA.",
    "This isn't a Clarity dashboard download. In Clarity, open Dashboard and press Export.": "Ce n'est pas un export du tableau de bord Clarity. Dans Clarity, ouvrez Tableau de bord et appuyez sur Exporter.",
    "Upload the .csv files Clarity downloads.": "Importez les fichiers .csv téléchargés depuis Clarity.", "This file has no page addresses, so its site can't be found. Pick the site, then upload it again.": "Ce fichier n'a pas d'adresses de pages : son site est introuvable. Choisissez le site, puis importez-le à nouveau.",
    "Choose the Clarity files first.": "Choisissez d'abord les fichiers Clarity.", "This Clarity file has no date range that can be read.": "Ce fichier Clarity n'a pas de période lisible.",
    "Upload the file made on your Mac by scripts/clarity_archive_export.py. It only adds days this app doesn't have yet, so uploading twice changes nothing.": "Importez le fichier créé sur votre Mac par scripts/clarity_archive_export.py. Il n'ajoute que les jours absents de l'application : l'importer deux fois ne change rien.",
    "to add": "à ajouter", "added": "ajoutés", "already here": "déjà présents", "Nothing new to add.": "Rien de nouveau à ajouter.", "Reading the file…": "Lecture du fichier…", "Adding the days…": "Ajout des jours…",
    "These sites aren't in the app, so their days are left out. Add them as your own sites, then upload the file again:": "Ces sites ne sont pas dans l'application : leurs jours sont ignorés. Ajoutez-les comme vos propres sites, puis importez à nouveau le fichier :",
    "You'll find them on Content, when the period includes those dates.": "Vous les trouverez dans Contenu, si la période inclut ces dates.",
    "day here has Clarity sessions only: scroll depth and clicks weren't recorded for it.": "jour ici n'a que des sessions Clarity : le défilement et les clics n'ont pas été enregistrés.",
    "days here have Clarity sessions only: scroll depth and clicks weren't recorded for them.": "jours ici n'ont que des sessions Clarity : le défilement et les clics n'ont pas été enregistrés.",
    "This isn't a Clarity archive file. Make it with scripts/clarity_archive_export.py.": "Ce n'est pas un fichier d'archive Clarity. Créez-le avec scripts/clarity_archive_export.py.",
    "Upload the .json file made by scripts/clarity_archive_export.py.": "Importez le fichier .json créé par scripts/clarity_archive_export.py.",
    "Important domains": "Domaines importants", "Domains worth a closer look": "Les domaines qui méritent un examen", "Moz rows left this month": "lignes Moz restantes ce mois-ci", "Moz isn't connected": "Moz n'est pas connecté", "Moz gives few free rows, so it only runs on domains you add here, and only when you press the button. Results are kept, so a row is never used twice in a month.": "Moz offre peu de lignes gratuites : il ne s'exécute que sur les domaines ajoutés ici, et seulement quand vous appuyez sur le bouton. Les résultats sont conservés : une ligne n'est jamais utilisée deux fois dans le mois.",
    "Add a domain": "Ajouter un domaine", "Get Moz data": "Obtenir les données Moz", "Get popularity": "Obtenir la popularité", "Domain": "Domaine", "Authority": "Autorité", "Moz Domain Authority": "Domain Authority Moz", "Linking domains": "Domaines référents", "Links": "Liens", "Popularity": "Popularité", "No domains yet. Add the ones worth a closer look.": "Pas encore de domaines. Ajoutez ceux qui méritent un examen.", "domains updated": "domaines mis à jour", "held back: no free rows left": "en attente : plus de lignes gratuites", "Popularity updated": "Popularité mise à jour", "Not ranked": "Non classé",
    "Tell Bing and Yandex about new pages": "Signaler les nouvelles pages à Bing et Yandex", "IndexNow. Google doesn't take part.": "IndexNow. Google n'y participe pas.", "Addresses, one per line": "Adresses, une par ligne", "Send": "Envoyer", "Connect IndexNow first: paste its key, and put the key file on your site.": "Connectez d'abord IndexNow : collez sa clé et placez le fichier de clé sur votre site.", "addresses sent": "adresses envoyées", "The key is still being checked.": "La clé est encore en cours de vérification.", "Enter a domain, such as example.com.": "Saisissez un domaine, par exemple example.com.",
    "free requests left today": "requêtes gratuites restantes aujourd'hui",
    "Sign out": "Se déconnecter", "Google connections": "Connexions Google", "To add another, press Add another Google connection below. Each site then picks which one it uses.": "Pour en ajouter une autre, cliquez sur Ajouter une autre connexion Google ci-dessous. Chaque site choisit ensuite laquelle il utilise.", "Add another Google connection": "Ajouter une autre connexion Google",
    "Google connection": "Connexion Google", "works": "fonctionne", "property": "propriété", "properties": "propriétés", "It didn't work.": "Ça n'a pas fonctionné.", "Testing…": "Test…", "Works.": "Fonctionne.",
    "It can't see any Search Console property yet. Add its email in Search Console, then test again.": "Elle ne voit encore aucune propriété Search Console. Ajoutez son e-mail dans la Search Console, puis testez à nouveau.",
    "Clarity allows 10 requests a day per project, so testing would use one up. The first pull shows whether the token works.": "Clarity autorise 10 requêtes par jour et par projet : un test en consommerait une. La première lecture montrera si le jeton fonctionne.",
    "Remove this key? You'd have to paste it again.": "Retirer cette clé ? Il faudra la coller à nouveau.", "Remove this Google connection? Sites keep their data, and stop updating until they use another one.": "Retirer cette connexion Google ? Les sites gardent leurs données et ne se mettent plus à jour tant qu'ils n'en utilisent pas une autre.",
    "Clarity has a token per site. Tick This site doesn't use it next to the site, then press Save.": "Clarity a un jeton par site. Cochez Ce site ne l'utilise pas à côté du site, puis appuyez sur Enregistrer.", "Press Remove next to the Google connection above.": "Appuyez sur Retirer à côté de la connexion Google ci-dessus.",
    "It works with no key, within a smaller limit. A free key gives it more room.": "Il fonctionne sans clé, avec une limite plus basse. Une clé gratuite lui donne plus de marge.",
    "This key can't be checked until it's first used.": "Cette clé ne peut être vérifiée qu'à sa première utilisation.",
    "Your sites and where their data comes from": "Vos sites et l'origine de leurs données", "Who can sign in": "Qui peut se connecter", "Your sites": "Vos sites", "Not used": "Non utilisé", "Failing": "En échec", "Waiting for first data": "En attente de données", "Not set up": "Non configuré", "Set up": "Configurer",
    "Only an admin can add or change accounts.": "Seul un admin peut ajouter ou modifier des comptes.", "Add a person": "Ajouter une personne", "Name": "Nom", "Email": "E-mail", "Role": "Rôle", "You": "Vous", "Member": "Membre", "Admin": "Admin", "Disabled": "Désactivé", "Locked for now": "Verrouillé pour l'instant", "Waiting for first login": "Attend sa première connexion", "Active": "Actif",
    "Reset password": "Réinitialiser le mot de passe", "Enable": "Activer", "Disable": "Désactiver", "They get a temporary password, and choose their own at first login.": "La personne reçoit un mot de passe temporaire et choisit le sien à la première connexion.", "Add": "Ajouter", "Temporary password": "Mot de passe temporaire",
    "Shown once. Copy it now and give it to them in person or by a private message. They change it at first login.": "Affiché une seule fois. Copiez-le et transmettez-le en personne ou par message privé. La personne le change à sa première connexion.", "Done": "Terminé", "Reset this person's password? They'll be signed out.": "Réinitialiser le mot de passe de cette personne ? Elle sera déconnectée.", "Saved": "Enregistré",
    "Only an admin can do that.": "Seul un admin peut faire cela.", "Enter a username of at least 3 letters or numbers, or an email address.": "Saisissez un nom d'utilisateur d'au moins 3 lettres ou chiffres, ou une adresse e-mail.", "Username or email": "Nom d'utilisateur ou e-mail", "Enter a name.": "Saisissez un nom.", "There is already an account with that username or email.": "Il existe déjà un compte avec cet identifiant ou cet e-mail.", "This is the only admin. Make someone else admin first.": "C'est le seul admin. Nommez d'abord quelqu'un d'autre admin.",
    "A GA4 property is its number, such as 123456789. It isn't the G-XXXX measurement ID.": "Une propriété GA4 est son numéro, par exemple 123456789. Ce n'est pas l'ID de mesure G-XXXX.", "A Search Console property looks like sc-domain:example.com or https://example.com/.": "Une propriété Search Console ressemble à sc-domain:example.com ou https://example.com/.",
    "That isn't the whole key file. Paste everything in the file, from the first { to the last }.": "Ce n'est pas le fichier de clé complet. Collez tout le fichier, du premier { au dernier }.",
  };
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
