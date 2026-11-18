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
      // A key saved, but a site with neither a Search Console nor a GA4 property and no "Not used" said: it reads nothing.
      // Counted in Needs a fix, never silent (ai-reports-workflow, 2026-11-17).
      const wired = (row) => row && (row.not_used || (row.connection_id && row.property));
      google.unwired = data.google.length ? window.SITES.filter((s) => s.realId && !wired(rows("gsc", s.realId)) && !wired(rows("ga4", s.realId))).map((s) => s.host) : [];
      // The sites really set up: a key and a property. A failing pull elsewhere doesn't undo a site's setup step.
      google.linked = data.google.length ? using : [];
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
      clarity.linked = live.map(({ s }) => s.id); // each site has its own Clarity token
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
    if (conn("pagespeed")) conn("pagespeed").note = "Works without a key, with a lower limit; a free key raises it.";
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
      <p class="help" style="margin:0 0 10px">${t("Upload the file scripts/clarity_archive_export.py made on your Mac. It only adds missing days, so uploading twice is safe.")}</p>
      <label class="field"><span>${t("File")}</span><input class="input" id="ca-file" type="file" accept=".json,application/json"></label>
      <div id="ca-result" aria-live="polite"></div>
    </details>
    <details class="fold how" id="cr-fold"><summary>${icon("chevron-right")}${t("Clarity dashboard downloads")}</summary>
      <p class="help" style="margin:0 0 10px">${t("In Clarity, Dashboard → Export, for each site. Upload the .csv files here, several at once; each keeps its own period. They show on Content and AI search.")}</p>
      <label class="field"><span>${t("Site")}</span><select class="select" id="cr-site"><option value="">${t("From the file")}</option>${window.SITES.filter((s) => s.realId).map((s) => `<option value="${s.realId}">${esc(s.host)}</option>`).join("")}</select></label>
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
    savedGoogleNote: () => (L.data?.google?.length ? `${t("Robot key saved")} (${L.data.google[0].last4}). ${t("Paste a new one to replace it.")}` : ""),
    googleExtras() {
      const list = L.data?.google || [];
      if (!list.length) return "";
      // The property lists come from asking Google what this key can see. Ask as the panel opens, so they're never empty for no reason. It's free.
      if (!L.sc.length && !L.ga.length && Date.now() - (L.autoTestAt || 0) > 30000) {
        L.autoTestAt = Date.now();
        // Every connection, not only the first: a passing Test also clears its sites' out-of-date "stopped working" and reads them again.
        setTimeout(async () => {
          const answers = await Promise.all(list.map((g) => api("POST", `google-connections/${g.id}/test`, {}).catch(() => null)));
          if (answers[0]) showGoogleResult(answers[0]);
          if (answers.some((a) => a?.reading)) reload().catch(() => {});
        }, 50);
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
    const missing = answer.missing_sites.length ? `<p class="note warn" style="margin:10px 0 0">${icon("triangle-alert")}<span>${t("These sites aren't in the app, so their days are skipped. Add them as your sites, then upload again:")} ${answer.missing_sites.map((s) => `<span dir="ltr">${esc(s.host)}</span> (${daysWord(s.days)})`).join(", ")}</span></p>` : "";
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
    const next = !preview ? `<p class="small sec" style="margin:10px 0 0">${t("Now on Content, for periods that include those dates.")}</p>`
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
      : `<li><div class="what"><div class="t" dir="ltr">${esc(f.host)}</div><div class="s">${f.kinds.map((k) => `${t(KIND_WORD[k.kind] || k.kind)}${k.replaces ? ` (${t(answer.preview ? "replaces the current one" : "replaced")})` : ""}`).join(", ")} · ${esc(longDay(f.period_start))} – ${esc(longDay(f.period_end))}</div></div></li>`).join("")}</ul>`;
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
    const next = !preview ? `<p class="small sec" style="margin:10px 0 0">${t("Now on Content and AI search.")}</p>`
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
      // A key just pasted (by Save or by Test) is for every site, unless someone picked another connection for this site by hand.
      const chosen = UI.$(`[data-lv-site-conn="${s.id}"]`);
      const connection_id = chosen && (chosen.dataset.touched || !newest) ? +chosen.value : fallback;
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
      window.LV?.forget?.(); window.OV?.forget?.();
      UI.forgetPanelForm(); UI.closePanel(); UI.render();
      if (c.id === "google") afterGoogleSaved();
      else UI.toast(t("Connection saved"));
    } catch (err) { sayError(err.message); button.disabled = false; }
  }

  /* After Save: the sites now wired but never read get "Fetch my first numbers" (Refresh data for them, followed to the end);
     a site left with nothing picked is named, so a green Test can't end in silence (COMPARISON lost place 4). */
  function afterGoogleSaved() {
    const google = conn("google") || {};
    const fresh = window.SITES.filter((s) => s.realId && ["gsc", "ga4"].some((source) => {
      const r = L.data.site_sources.find((x) => x.site_id === s.realId && x.source === source);
      return r && !r.not_used && r.connection_id && r.property && !r.data_through;
    }));
    if (google.unwired?.length) {
      const hosts = google.unwired.length === 1 ? google.unwired[0] : `${num(google.unwired.length)} ${t("sites")}`;
      UI.toast(t("Connection saved. {hosts}: no Search Console or GA4 property picked, so nothing is read there.").replace("{hosts}", hosts), { kind: "info", stay: true, undo: () => UI.openConnection("google"), undoLabel: t("Pick it") });
    }
    if (!fresh.length) { if (!google.unwired?.length) UI.toast(t("Connection saved")); return; }
    UI.toast(t("Connection saved. Fetch the first numbers now?"), { stay: true, undoLabel: t("Fetch my first numbers"), undo: async () => {
      try {
        const answers = await Promise.all(fresh.map((s) => api("POST", `sites/${s.realId}/collect`, {})));
        if (window.LV?.watchReads) await window.LV.watchReads(answers); else UI.toast(t("Reading the latest data…"));
      } catch (err) { UI.toast(err.message, { kind: "crit" }); }
    } });
  }

  // A GA4 property has a name, not an address: "Acme Store" goes with acme-store.com. Only one clear match counts.
  const plain = (word) => String(word || "").normalize("NFD").replace(/[^a-z0-9]/gi, "").toLowerCase();
  function gaMatch(host) {
    const base = plain(host.replace(/^www\./, "").replace(/\.[^.]+$/, ""));
    const found = L.ga.filter((p) => plain(p.name) === base);
    return found.length === 1 ? found[0].id : "";
  }

  /* The Search Console property that is this site: its domain property first, then its address with or without www and
     http(s), then the domain it sits under (blog.acme.fr → sc-domain:acme.fr). Pre-picked after Test (COMPARISON lost place 4). */
  function scMatch(host, options) {
    const bare = String(host || "").toLowerCase().replace(/^www\./, "");
    const labels = bare.split(".");
    const parents = labels.slice(1, -1).map((_, i) => labels.slice(i + 1).join(".")).filter((d) => d.includes("."));
    const wanted = [`sc-domain:${bare}`, ...[`https://${bare}/`, `https://www.${bare}/`, `http://${bare}/`, `http://www.${bare}/`], ...parents.map((d) => `sc-domain:${d}`)];
    const norm = (o) => String(o).toLowerCase().replace(/\/?$/, "/").replace(/^sc-domain:(.*)\/$/, "sc-domain:$1");
    const have = new Map(options.map((o) => [norm(o), o]));
    for (const w of wanted) if (have.has(norm(w))) return have.get(norm(w));
    return "";
  }
  /* Under a site whose property this key can't see: why, and the step that fixes it, in red. Never a silent "Not used". */
  function missingNote(sel, site) {
    const row = sel.closest(".prop-row");
    row?.querySelector(`[data-prop-missing="${sel.dataset.prop}"]`)?.remove();
    // Search Console only: a GA4 property is named, not an address, so a blank GA4 pick isn't a sign of a missing share.
    if (!row || sel.value || sel.dataset.prop !== "sc" || !L.sc.length) return;
    const robot = conn("google")?.robot || L.data?.google?.find((g) => g.robot_email)?.robot_email || "";
    const words = sel.dataset.prop === "sc"
      ? (robot ? t("{host} isn't shared with {robot} in Search Console yet. Add it as a user there, then press Test again.") : t("{host} isn't in this key's Search Console list yet. Share the property with it, then press Test again."))
      : t("{host}: pick its GA4 property, or Not used.");
    row.insertAdjacentHTML("beforeend", `<p class="error small prop-missing" data-prop-missing="${sel.dataset.prop}" role="alert">${icon("octagon-alert")}<span>${esc(words.replace("{host}", site.host).replace("{robot}", robot))}</span></p>`);
  }
  function showGoogleResult(answer) {
    if (answer.search_console.ok && answer.ga4.ok) UI.$("#conn-fix")?.remove();
    const line = (name, part) => (part.ok ? status("good", `${name}: ${t("works")} · ${num(part.properties.length)} ${t(part.properties.length === 1 ? "property" : "properties")}`) : `<div class="error" style="margin:0 0 4px">${icon("octagon-alert")}${esc(name)}: ${esc(t(part.error || "It didn't work."))}</div>${fixFor(part.error, conn("google"))}`);
    say(`<div style="display:grid;gap:6px;margin-top:6px">${line("Search Console", answer.search_console)}${line("GA4", answer.ga4)}${answer.search_console.ok && !answer.search_console.properties.length ? `<p class="small sec" style="margin:0">${t("It sees no Search Console property yet: add its email there, then test again.")}</p>` : ""}${answer.reading ? `<p class="small muted" style="margin:0">${esc(t(answer.reading === 1 ? "The stopped site is being read again; its numbers return in a few minutes." : "The stopped sites are being read again; their numbers return in a few minutes."))}</p>` : ""}</div>`);
    L.sc = answer.search_console.properties || [];
    L.ga = answer.ga4.properties || [];
    // What Google says this key can see now fills the lists, and the obvious match is picked.
    UI.$$('[data-prop="sc"], [data-prop="ga4"]').forEach((sel) => {
      const kind = sel.dataset.prop, chosen = sel.value, site = window.SITES.find((s) => s.id === sel.dataset.site);
      const options = kind === "sc" ? L.sc : L.ga.map((p) => p.id);
      const labels = kind === "ga4" ? Object.fromEntries(L.ga.map((p) => [p.id, `${p.name} (${p.id})`])) : {};
      // A guess the key can't see ("sc-domain:my-firm.example" before it is shared) isn't kept as if chosen: the match is.
      const guessed = chosen && kind === "sc" && !options.includes(chosen) && !L.data?.site_sources?.some((r) => r.site_id === site.realId && r.source === "gsc" && r.property === chosen);
      const match = chosen && !guessed ? "" : kind === "sc" ? scMatch(site.host, options) : gaMatch(site.host);
      const held = [...sel.options].filter((o) => !o.value || o.value === "__other");
      const list = [...new Set([...options, ...(chosen && chosen !== "__other" && !guessed ? [chosen] : [])])];
      sel.replaceChildren(...list.map((o) => new Option(labels[o] || o, o)), ...held);
      sel.value = match || (guessed ? "" : chosen);
      if (site) missingNote(sel, site);
    });
  }

  async function onTest(button, c) {
    const was = button.textContent;
    button.disabled = true; button.textContent = t("Testing…");
    try {
      if (c.id === "google") {
        let id = L.data.google[0]?.id;
        const typed = typedGoogle();
        // The connection Test makes is the one Save then uses: otherwise every site stays on the old key (F119).
        if (typed) { L.newGoogle = await api("POST", "google-connections", typed); id = L.newGoogle.id; UI.$("#conn-json") && (UI.$("#conn-json").value = ""); ["#conn-client", "#conn-secret", "#conn-refresh"].forEach((f) => { if (UI.$(f)) UI.$(f).value = ""; }); await reload(); }
        if (!id) { sayError("Paste the key first."); return; }
        showGoogleResult(await api("POST", `google-connections/${id}/test`, {}));
      } else if (c.id === "clarity") {
        say(`<span class="note inline-note">${icon("info")}<span>${t("No test: it would spend 1 of Clarity's 10 daily requests. The first pull shows if the token works.")}</span></span>`);
      } else {
        const key = UI.$("#conn-key")?.value.trim();
        if (key) { await api("PUT", `app-keys/${c.id}`, { key }); UI.$("#conn-key").value = ""; }
        const answer = await api("POST", `app-keys/${c.id}/test`, {});
        if (answer.ok !== false) UI.$("#conn-fix")?.remove(); // it works now: the old advice would only confuse
        say(answer.ok === true ? status("good", `${t("Works.")}${answer.left === null || answer.left === undefined ? "" : ` ${num(answer.left)} ${t("of")} ${num(answer.of)} ${t(c.id === "firecrawl" ? "credits left this month" : "free requests left today")}`}`) : answer.ok === null ? `<span class="note inline-note">${icon("info")}<span>${esc(t(answer.note))}</span></span>` : `<span class="error" style="margin:0">${icon("octagon-alert")}${esc(t(answer.note))}</span>${fixFor(answer.note, c)}`);
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
    // The column names the source, so the cell is just the day its data reaches; "Data through …" is the tooltip.
    if (r?.last_ok_at && r.data_through) {
      const day = new Intl.DateTimeFormat(UI.locale(), { day: "numeric", month: "short" }).format(new Date(`${r.data_through}T00:00:00`)), full = `${t("Data through")} ${day}`;
      return `<span data-tip="${esc(full)}" aria-label="${esc(full)}" role="img">${status("good", day)}</span>`;
    }
    if (r?.last_ok_at) return status("good", t("Connected"));
    const set = source === "clarity" ? r?.has_secret : source === "gsc" || source === "ga4" ? r?.connection_id && r?.property : (L.data?.keys.find((k) => k.id === source)?.connected);
    return set ? `<span class="status sec">${t("Waiting for data")}</span>` : `<span class="status sec">${t("Not set up")}</span>`;
  }
  const sitesTab = () => {
    if (!window.SITES.length) return `<section class="card"><div class="empty"><h3>${t("No site yet")}</h3><p>${t("Add a site to see its data.")}</p><div style="margin-top:12px"><button class="btn btn-main" data-lv-add-site>${t("Add a site")}</button></div></div></section>`;
    return `<section class="card"><div class="card-head"><h2>${t("Your sites")}</h2><span class="end"><button class="btn btn-small" data-lv-add-site>${icon("plus")}${t("Add a site")}</button></span></div>
      <div class="table-wrap" style="box-shadow:none"><table class="data"><thead><tr><th>${t("Site")}</th>${SOURCES.map(([, name]) => `<th>${esc(t(name))}</th>`).join("")}<th></th></tr></thead><tbody>
      ${window.SITES.map((s) => `<tr style="cursor:default"><td data-label="${t("Site")}"><span class="mono" dir="auto">${esc(s.host)}</span></td>${SOURCES.map(([id, name]) => `<td data-label="${esc(t(name))}">${sourceWord(s, id)}</td>`).join("")}<td data-label="" class="r" style="white-space:nowrap"><button class="btn btn-small" data-setup-panel="${esc(s.host)}">${t("Set up")}</button> <button class="btn btn-small" data-lv-site-collect="${s.realId}">${t("Refresh data")}</button></td></tr>`).join("")}
      </tbody></table></div></section>${keyEventsCard()}`;
  };

  // ---- Leads from Google Analytics: which key events are enquiries (SEO review 2026-11-17, W1, W2) -------------
  // GA4 counts every key event of every kind; a site's leads are only the ones ticked here (seo/metrics/leads.py).
  const gaSet = (s) => { const r = L.data?.site_sources.find((x) => x.site_id === s.realId && x.source === "ga4"); return Boolean(r && !r.not_used && r.connection_id && r.property); };
  async function loadKeyEvents() {
    L.keyEvents = L.keyEvents || {};
    const sites = window.SITES.filter((s) => s.realId && gaSet(s) && !L.keyEvents[s.realId]);
    if (!sites.length) return;
    sites.forEach((s) => { L.keyEvents[s.realId] = { loading: true }; });
    await Promise.all(sites.map(async (s) => {
      try { L.keyEvents[s.realId] = await api("GET", `ga4/key-events?site_id=${s.realId}`); } catch (err) { L.keyEvents[s.realId] = { error: err.message }; }
    }));
    if (UI.state.route === "settings" && L.tab === "sites" && !UI.$("#panel")) UI.render();
  }
  function keyEventsCard() {
    const sites = window.SITES.filter((s) => s.realId && gaSet(s));
    if (!sites.length || !L.data) return "";
    loadKeyEvents();
    const day = (iso) => new Intl.DateTimeFormat(UI.locale(), { day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00`));
    const block = (s) => {
      const k = L.keyEvents?.[s.realId];
      const head = `<h3 class="ke-host"><span class="mono" dir="auto">${esc(s.host)}</span>${k?.kind === "leads" ? ` <span class="status good">${t("Leads picked")}</span>` : k?.events ? ` <span class="status sec">${t("Counting every key event")}</span>` : ""}</h3>`;
      if (!k || k.loading) return `<div class="ke-site">${head}${UI.skeleton("rows", { rows: 2 })}</div>`;
      if (k.error) return `<div class="ke-site">${head}<p class="error">${esc(t(k.error))}</p></div>`;
      const hosts = k.other_hosts?.length ? `<p class="note warn lv-note">${icon("triangle-alert")}<span>${esc(t("This Google Analytics property also records {hosts}: check its data streams. Those visits are left out.").replace("{hosts}", k.other_hosts.map((h) => h.host).join(", ")))}</span></p>` : "";
      const reread = k.reread_days ? `<p class="small muted">${esc(t("Google Analytics history is being read again with key events by name: {n} days left.").replace("{n}", num(k.reread_days)))}</p>` : "";
      const list = k.events.length
        ? `<form class="ke-form" data-lv-key-events="${s.realId}"><fieldset class="ke-list"><legend class="sr">${esc(t("Counts as a lead"))}</legend>${k.events.map((e) => `<label class="ke-row"><input type="checkbox" name="f_event" value="${esc(e.name)}" ${e.lead ? "checked" : ""} ${isAdmin() ? "" : "disabled"}><span class="mono" dir="auto">${esc(e.name)}</span><span class="small muted">${e.last_day ? `${num(e.key_events)} ${t("in 12 months")} · ${t("last")} ${esc(day(e.last_day))}` : t("not sent any more")}</span></label>`).join("")}</fieldset>
          <div class="ke-act"><button class="btn btn-small btn-main" type="submit" ${isAdmin() ? "" : UI.adminOnly?.() || "disabled"}>${t("Save")}</button><span class="small muted">${t("Ticked: counts as a lead. Past days change too.")}</span><span class="error" data-lv-rule-error hidden></span></div></form>`
        : `<p class="small muted">${t("No key event read yet. They appear here once Google Analytics has been read again.")}</p>`;
      return `<div class="ke-site">${head}${hosts}${list}${reread}</div>`;
    };
    return `<section class="card" style="margin-top:14px" id="lead-events"><div class="card-head"><h2>${t("Leads from Google Analytics")}</h2><span class="end small muted">${t("Tick the key events that are real enquiries")}</span></div>
      <p class="help" style="padding:10px 18px 2px;margin:0">${t("Google Analytics counts every key event, such as a booking page view. Until you tick some, screens say Key events, not Leads.")}</p>
      ${sites.map(block).join("")}</section>`;
  }

  // ---- Team tab ---------------------------------------------------------------------------------
  // The menu's sections, in its order and groups (seo/accounts/access.py SECTIONS). Settings isn't one: it stays with admins.
  const SECTIONS = [
    ["today", "Today", ""],
    ["channels", "Channels", "Traffic"], ["conversions", "Conversions", "Traffic"], ["content", "Content", "Traffic"],
    ["overview", "Overview", "Search"], ["pages", "Pages", "Search"], ["insights", "Insights", "Search"], ["keywords", "Keywords", "Search"], ["competitors", "Competitors", "Search"], ["ai", "AI search", "Search"],
    ["ads", "Google Ads", "Ads"],
    ["tasks", "Tasks", "Work"], ["notes", "Notes", "Work"], ["backlinks", "Backlinks", "Work"], ["resources", "Resources", "Work"],
    ["health", "Site health", "Health"],
  ];
  const ownSites = () => window.BOOT.sites || [];
  // Admin, member with full access, or member with chosen access: the server only knows admin and member, plus access.
  const roleChoice = (u) => (u?.role === "admin" ? "admin" : u?.access ? "chosen" : "full");
  function accessSummary(u) {
    if (u.role === "admin") return t("Admin");
    if (!u.access) return t("Full access");
    // Only sites that still exist count: a site deleted since stays in the saved list until the next save drops it.
    const s = Object.keys(u.access.sections).length, n = limited() ? u.access.sites.length : u.access.sites.filter((id) => ownSites().some((x) => x.id === id)).length;
    const all = limited() ? Boolean(window.BOOT.every_site) : ownSites().length && ownSites().every((x) => u.access.sites.includes(x.id));
    return [`${num(s)} ${t(s === 1 ? "section" : "sections")}`, all ? t("all sites") : `${num(n)} ${t(n === 1 ? "site" : "sites")}`, t(u.access.spend ? "can spend credits" : "no credits")].join(" · ");
  }
  async function loadTeam() {
    try { L.team = await api("GET", "team"); } catch (err) { L.team = { error: err.message }; }
    if (UI.state.route === "settings" && L.tab === "team" && !UI.$("#panel")) UI.render();
  }
  function teamTab() {
    if (L.team === null) { loadTeam(); return UI.skeleton("table", { rows: 3 }); }
    if (L.team.error) return `<section class="card"><div class="empty"><h3>${t("That didn't load")}</h3><p>${esc(t(L.team.error))}</p><button class="btn btn-small" data-lv-team-retry>${t("Try again")}</button></div></section>`;
    if (!L.team.users) return `<section class="card"><div class="card-head"><h2>${t("Team")}</h2></div><ul class="rows">${L.team.names.map((name) => `<li><div class="what"><div class="t" dir="auto">${esc(name)}</div></div></li>`).join("")}</ul><p class="help" style="padding:8px 18px">${t("Only an admin can add or change accounts.")}</p></section>`;
    const me = window.BOOT.user?.id;
    return `<section class="card"><div class="card-head"><h2>${t("Team")}</h2><span class="end"><button class="btn btn-small btn-main" data-lv-user-new>${icon("plus")}${t("Add a person")}</button></span></div>
      <div class="table-wrap" style="box-shadow:none"><table class="data"><thead><tr><th>${t("Name")}</th><th>${t("Username or email")}</th><th>${t("Access")}</th><th>${t("Status")}</th><th></th></tr></thead><tbody>
      ${L.team.users.map((u) => `<tr style="cursor:default"><td data-label="${t("Name")}" dir="auto">${esc(u.name)}${u.id === me ? ` <span class="tag">${t("You")}</span>` : ""}</td><td data-label="${t("Username or email")}" class="mono">${esc(u.email)}</td>
        <td data-label="${t("Access")}"><span class="ax-sum"><span class="ax-sum-t ${u.access && u.role !== "admin" ? "chosen" : ""}" data-ax-summary="${u.id}">${esc(accessSummary(u))}</span><button class="btn btn-small" data-lv-user-access="${u.id}" aria-label="${t("Edit access")}: ${esc(u.name)}">${t("Edit access")}</button></span></td>
        <td data-label="${t("Status")}">${u.disabled ? `<span class="status sec">${t("Disabled")}</span>` : u.locked ? status("warn", t("Locked for now")) : u.must_change_password ? `<span class="status sec">${t("Waiting for first login")}</span>` : status("good", t("Active"))}</td>
        <td data-label="" class="r" style="white-space:nowrap"><button class="btn btn-small" data-lv-user-reset="${u.id}">${t("Reset password")}</button> <button class="btn btn-small btn-ghost" data-lv-user-disable="${u.id}" data-now="${u.disabled ? 1 : 0}">${t(u.disabled ? "Enable" : "Disable")}</button></td></tr>`).join("")}
      </tbody></table></div></section>`;
  }
  // The role and access choice, the same in Add a person and Edit access. Chosen access opens below its radio.
  function accessFields(u) {
    const choice = roleChoice(u), a = u?.access || null;
    const sites = ownSites(), picked = new Set(a ? a.sites : sites.length === 1 ? [sites[0].id] : []);
    const role = (value, word, hint) => `<label class="opt ax-role"><input type="radio" name="f_role" value="${value}" ${choice === value ? "checked" : ""}><span><span class="ax-role-t">${t(word)}</span><span class="help">${t(hint)}</span></span></label>`;
    let group = null;
    const rows = SECTIONS.map(([key, label, g]) => {
      const level = a?.sections[key] || "none";
      const head = g !== group ? ((group = g), g ? `<h3 class="ax-group">${t(g)}</h3>` : "") : "";
      const opt = (value, word) => `<label><input type="radio" name="ax_${key}" value="${value}" ${level === value ? "checked" : ""}><span>${t(word)}</span></label>`;
      return `${head}<div class="ax-row"><span class="ax-name" id="ax-l-${key}">${key === "ads" ? UI.logo("googleads", 16) : ""}${t(label)}</span><span class="ax-seg" role="radiogroup" aria-labelledby="ax-l-${key}">${opt("none", "No access")}${opt("view", "View")}${opt("edit", "Edit")}</span></div>`;
    }).join("");
    return `<fieldset class="scope"><legend>${t("Role")}</legend>
        ${role("admin", "Admin", "Everything, including Settings and the team.")}
        ${role("full", "Member: full access", "Every website and section.")}
        ${role("chosen", "Member: chosen access", "Only the websites and sections you pick.")}
      </fieldset>
      <div class="ax-chosen" id="ax-chosen" ${choice === "chosen" ? "" : "hidden"}>
        <fieldset class="scope"><legend>${t("Websites")}</legend>
          ${sites.length ? sites.map((s) => `<label class="opt ax-site"><input type="checkbox" class="chk" style="margin:0" name="ax_site" value="${s.id}" ${picked.has(s.id) ? "checked" : ""}>${UI.siteLogo(s.host, 18)}<span class="mono" dir="ltr" translate="no">${esc(s.host)}</span></label>`).join("") : `<p class="help">${t("Add one of your websites first, in the Sites tab.")}</p>`}
        </fieldset>
        <fieldset class="scope"><legend>${t("Sections")}</legend>
          <div class="ax-quick"><span class="help">${t("Set every section to")}</span><button type="button" class="link-btn" data-ax-all="view">${t("View")}</button><button type="button" class="link-btn" data-ax-all="edit">${t("Edit")}</button><button type="button" class="link-btn" data-ax-all="none">${t("No access")}</button></div>
          ${rows}
        </fieldset>
        <label class="opt ax-spend"><input type="checkbox" class="chk" style="margin:0" name="ax_spend" ${a?.spend ? "checked" : ""}><span><span class="ax-role-t">${t("Can spend credits")}</span><span class="help">${t("Paid searches, Firecrawl, AI answers and Moz.")}</span></span></label>
        <p class="note">${icon("info")}<span>${t("A person without every website can't change things all sites share (link gaps, mediators, competitor page reads).")}</span></p>
      </div>
      <div class="error" data-lv-form-error role="alert" hidden></div>`;
  }
  const accessFoot = (word, editing) => `<div class="panel-foot ax-foot"><button class="btn btn-main" data-lv-access-save>${t(word)}</button><button class="btn" data-discard-panel>${t("Cancel")}</button>
    <p class="ax-why" id="ax-why" aria-live="polite"></p>${editing ? `<p class="help ax-signout">${t("Taking access away signs them out everywhere.")}</p>` : ""}</div>`;
  function userPanel(opener) {
    UI.openPanel(`${UI.panelHead(t("Add a person"), t("They get a temporary password, and choose their own at first login."))}
      <form class="panel-body" id="lv-access-form" novalidate>
        <label class="field"><span>${t("Name")}</span><input class="input" name="f_name" dir="auto" autocomplete="off"></label>
        <label class="field"><span>${t("Username or email")}</span><input class="input" name="f_email" type="text" dir="ltr" autocapitalize="none" spellcheck="false" autocomplete="off"></label>
        ${accessFields({ role: "member", access: null })}
      </form>${accessFoot("Add", false)}`, opener, { key: "user|new", reopen: () => userPanel(opener), after: syncAccess });
  }
  function accessPanel(user, opener) {
    UI.openPanel(`${UI.panelHead(t("Access"), esc(user.name))}
      <form class="panel-body" id="lv-access-form" data-user="${user.id}" novalidate>${accessFields(user)}</form>${accessFoot("Save", true)}`,
    opener, { key: `access|${user.id}`, reopen: () => accessPanel(user, opener), after: syncAccess });
  }
  // What the form says now: the role for the server, and the access dict (null for full access).
  function readAccess(form) {
    const choice = form.querySelector('input[name="f_role"]:checked')?.value || "full";
    if (choice !== "chosen") return { choice, role: choice === "admin" ? "admin" : "member", access: null };
    const sections = {};
    SECTIONS.forEach(([key]) => { const v = form.querySelector(`input[name="ax_${key}"]:checked`)?.value; if (v === "view" || v === "edit") sections[key] = v; });
    const sites = [...form.querySelectorAll('input[name="ax_site"]:checked')].map((el) => +el.value);
    return { choice, role: "member", access: { sites, sections, spend: Boolean(form.elements.ax_spend?.checked) } };
  }
  // Shows chosen access only when it is picked, and holds Save back with the reason while a choice is empty.
  function syncAccess() {
    const form = UI.$("#lv-access-form");
    if (!form) return;
    const now = readAccess(form);
    UI.$("#ax-chosen").hidden = now.choice !== "chosen";
    const noSite = now.access && !now.access.sites.length, noSection = now.access && !Object.keys(now.access.sections).length;
    const why = noSite && noSection ? "Pick at least one website and one section." : noSite ? "Pick at least one website." : noSection ? "Pick at least one section." : "";
    const save = UI.$("[data-lv-access-save]"), box = UI.$("#ax-why");
    if (save) save.disabled = Boolean(why);
    if (box && box.textContent !== t(why)) box.textContent = why ? t(why) : "";
  }
  // A person with chosen access gets only their own account here: the server refuses everything else in Settings for them.
  const limited = () => Boolean(window.ACCESS?.limited);
  function accountPage() {
    const u = window.BOOT.user || {};
    return `<section class="card ax-account"><div class="card-head"><h2>${t("My account")}</h2></div>
      <dl class="ax-facts"><dt>${t("Name")}</dt><dd dir="auto">${esc(u.name || "")}</dd><dt>${t("Username or email")}</dt><dd class="mono" dir="ltr">${esc(u.email || "")}</dd>${u.access ? `<dt>${t("Access")}</dt><dd>${esc(accessSummary(u))}</dd>` : ""}</dl>
      <form class="ax-pw" id="ax-password" novalidate>
        <h3>${t("Change password")}</h3>
        <input class="sr" type="text" name="f_user" autocomplete="username" value="${esc(u.email || "")}" readonly tabindex="-1" aria-hidden="true">
        <label class="field"><span>${t("Current password")}</span><input class="input" name="f_current" type="password" autocomplete="current-password"></label>
        <label class="field"><span>${t("New password")}</span><input class="input" name="f_new" type="password" autocomplete="new-password" aria-describedby="ax-pw-help"><span class="help" id="ax-pw-help">${t("At least 10 characters. Your other sessions are signed out.")}</span></label>
        <div class="error" data-ax-pw-error role="alert" hidden></div>
        <button class="btn btn-main" type="submit">${t("Change password")}</button>
      </form>
      <div class="ax-account-foot"><button class="btn" data-lv-signout>${icon("log-out")}${t("Sign out")}</button></div></section>`;
  }
  function showPassword(name, password) {
    UI.openPanel(`${UI.panelHead(t("Temporary password"), esc(name))}
      <div class="panel-body"><p class="note warn">${icon("triangle-alert")}<span>${t("Shown once. Copy it and hand it over in person or privately. They change it at first login.")}</span></p>
      <div class="lv-secret"><code class="mono" dir="ltr">${esc(password)}</code><button type="button" class="btn btn-small" data-copy="${esc(password)}">${t("Copy")}</button></div></div>
      <div class="panel-foot"><button class="btn btn-main" data-close-panel>${t("Done")}</button></div>`);
  }
  const showError = (err) => UI.toast(t(err.message), { kind: "crit" });

  // ---- Important domains: Moz and Cloudflare only ever run on these, from a button ------------------
  async function loadDomains() {
    try { L.domains = await api("GET", "important-domains"); } catch (err) { L.domains = { error: err.message }; }
    if (UI.state.route === "settings" && L.tab === "domains" && !UI.$("#panel")) UI.render();
  }
  const DOMAIN_PAGES = "imp-domains";
  function domainsTab() {
    if (!L.domains) { loadDomains(); return UI.skeleton("table", { rows: 4 }); }
    const d = L.domains;
    if (d.error) return `<section class="card"><div class="empty"><h3>${t("That didn't load")}</h3><p>${esc(d.error)}</p></div></section>`;
    const waiting = d.domains.filter((x) => !x.fetched_at).length;
    // Nothing caps this list, so it pages and searches like every long table (table-pages.js); a short one shows no search box.
    const found = d.domains.filter((x) => TP.matches(DOMAIN_PAGES, x.domain)), view = TP.view(DOMAIN_PAGES, found);
    const finder = d.domains.length > 10 || TP.state(DOMAIN_PAGES).q ? `<div style="padding:10px 18px 0;display:flex">${TP.search(DOMAIN_PAGES, t("Search domains"))}</div>` : "";
    const blank = (v) => (v === null || v === undefined ? `<span class="muted">—</span>` : num(v));
    return `<section class="card"><div class="card-head"><h2>${t("Important domains")}</h2><span class="end small muted">${d.moz_connected ? `${num(d.rows_left)} ${t("of")} ${num(d.rows_free)} ${t("Moz rows left this month")}` : t("Moz isn't connected")}</span></div>
      <p class="help" style="padding:10px 18px 2px;margin:0">${t("Moz runs only on these domains, and only when you press the button.")}${UI.tip("Moz gives few free rows. Results are kept, so a row is never used twice in a month.")}</p>
      <form class="lv-rule-form" data-lv-domain-form style="border-top:0"><input class="input mono" spellcheck="false" autocapitalize="off" name="f_domain" placeholder="example.com" aria-label="${t("Add a domain")}" autocomplete="off"><button class="btn btn-small" type="submit">${t("Add a domain")}</button>
        <button type="button" class="btn btn-small btn-main" data-lv-moz ${d.moz_connected && waiting && d.rows_left ? "" : "disabled"}>${t("Get Moz data")}${waiting ? ` (${num(waiting)})` : ""}</button>
        <button type="button" class="btn btn-small" data-lv-radar ${d.radar_connected && d.domains.length ? "" : "disabled"}>${t("Get popularity")}</button><span class="error" data-lv-rule-error hidden></span></form>
      ${finder}${found.length ? `<div class="table-wrap" style="box-shadow:none"><table class="data"><thead><tr><th>${t("Domain")}</th><th class="c">${t("Authority")}</th><th class="c">${t("Moz Domain Authority")}</th><th class="c">${t("Linking domains")}</th><th class="c">${t("Links")}</th><th class="c">${t("Popularity")}</th><th></th></tr></thead><tbody>
        ${view.rows.map((x) => `<tr style="cursor:default"><td data-label="${t("Domain")}" class="mono" dir="auto">${esc(x.domain)}</td><td class="c" data-label="${t("Authority")}">${x.authority === null ? `<span class="muted">—</span>` : esc(String(x.authority))}</td><td class="c" data-label="${t("Moz Domain Authority")}">${blank(x.domain_authority)}</td><td class="c" data-label="${t("Linking domains")}">${blank(x.linking_domains)}</td><td class="c" data-label="${t("Links")}">${blank(x.external_links)}</td><td class="c" data-label="${t("Popularity")}" dir="auto">${x.popularity ? esc(t(x.popularity)) : `<span class="muted">—</span>`}</td><td class="r" data-label=""><button class="btn btn-small btn-ghost" data-lv-domain-off="${esc(x.domain)}" aria-label="${t("Remove")}: ${esc(x.domain)}">${t("Remove")}</button></td></tr>`).join("")}
      </tbody></table></div>${TP.footer(DOMAIN_PAGES, view, { noun: t("domains") })}` : `<div class="empty" style="padding:28px"><p>${t(d.domains.length ? "No domain matches." : "No domains yet. Add the ones worth a closer look.")}</p></div>`}</section>
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
      if ((el = hit("[data-settings-tab]"))) { L.tab = el.dataset.settingsTab; return; } // a screen's "Pick which are leads" link: the hash change opens Settings on that tab
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
        if (c.id === "clarity") { sayError("Clarity has one token per site: tick Not used beside the site, then press Save."); return; }
        if (c.id === "google") { sayError("Press Remove next to the Google connection above."); return; }
        if (!(await UI.confirmDanger({ title: t("Remove this key?"), body: t("You'd have to paste it again."), yes: t("Remove") }))) return;
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
        if (!(await UI.confirmDanger({ title: t("Remove this Google connection?"), body: t("Sites keep their data, and stop updating until they use another one."), yes: t("Remove") }))) return;
        try { await api("DELETE", `google-connections/${el.dataset.lvGoogleDel}`); await reload(); UI.forgetPanelForm(); UI.closePanel(); UI.render(); UI.toast(t("Disconnected"), { kind: "info" }); } catch (err) { sayError(err.message); }
        return;
      }
      if ((el = hit("[data-lv-site-collect]"))) {
        take(); el.disabled = true;
        try {
          const a = await api("POST", `sites/${el.dataset.lvSiteCollect}/collect`, {});
          if (window.LV?.watchReads) { await window.LV.watchReads([a], { redraw: false }); window.LV.forget?.(); await reload(); }
          else UI.toast(t(a.started.length ? "Reading the latest data…" : "Nothing to read: connect a data source, or it's already running."), { kind: a.started.length ? "good" : "info" });
        } catch (err) { showError(err); }
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
      if (hit("[data-lv-team-retry]")) { take(); L.team = null; UI.render(); return; }
      if ((el = hit("[data-lv-user-access]"))) {
        take();
        const user = L.team?.users?.find((u) => String(u.id) === el.dataset.lvUserAccess);
        if (user) accessPanel(user, el);
        return;
      }
      if ((el = hit("[data-ax-all]"))) {
        take();
        const level = el.dataset.axAll;
        document.querySelectorAll(`#lv-access-form .ax-seg input[value="${level}"]`).forEach((r) => { r.checked = true; });
        syncAccess();
        return;
      }
      if ((el = hit("[data-lv-access-save]"))) {
        take();
        const form = UI.$("#lv-access-form"), box = form?.querySelector("[data-lv-form-error]");
        if (!form || el.disabled) return;
        box.hidden = true;
        const now = readAccess(form), id = form.dataset.user;
        const body = now.role === "admin" ? { role: "admin" } : { role: "member", access: now.access };
        const was = el.textContent;
        el.disabled = true; el.textContent = t(id ? "Saving…" : "Adding…");
        try {
          if (id) {
            await api("PATCH", `team/${id}`, body);
            UI.forgetPanelForm(); UI.closePanel(); L.team = null; await loadTeam(); UI.render(); UI.toast(t("Access saved"));
          } else {
            const made = await api("POST", "team", { name: form.elements.f_name.value, email: form.elements.f_email.value, ...body });
            UI.forgetPanelForm(); UI.closePanel(); L.team = null; await loadTeam(); UI.render(); showPassword(made.user.name, made.temporary_password);
          }
        } catch (err) {
          box.textContent = t(err.message); box.hidden = false;
          el.textContent = was; el.disabled = false; syncAccess();
        }
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
      if (e.target.matches?.("[data-lv-site-conn]")) { e.target.dataset.touched = "1"; return; }
      if (e.target.id === "ca-file") { sendArchive(true); return; }
      if (e.target.id === "cr-file" || (e.target.id === "cr-site" && UI.$("#cr-file")?.files?.length)) { sendReports(true); return; }
      if (e.target.closest?.("#lv-access-form")) syncAccess();
    });
    document.addEventListener("submit", async (e) => {
      const form = e.target;
      const box = form.querySelector?.("[data-lv-rule-error]");
      if (form.id === "ax-password") {
        e.preventDefault();
        const err = form.querySelector("[data-ax-pw-error]"), button = form.querySelector('button[type="submit"]');
        err.hidden = true; button.disabled = true;
        try {
          await window.fetch("api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current: form.elements.f_current.value, new: form.elements.f_new.value }) })
            .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "That didn't work. Try again."); });
          await window.whoAmI?.again?.(); // a new session, so a new CSRF token
          form.reset(); UI.toast(t("Password changed"));
        } catch (x) { err.textContent = t(x.message); err.hidden = false; form.elements.f_new.focus(); }
        button.disabled = false;
        return;
      }
      if (form.matches?.("[data-lv-key-events]")) {
        e.preventDefault(); box.hidden = true;
        const siteId = Number(form.dataset.lvKeyEvents), names = [...form.querySelectorAll('input[name="f_event"]:checked')].map((x) => x.value);
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
          const answer = await api("PUT", "ga4/key-events", { site_id: siteId, names });
          L.keyEvents[siteId] = { ...L.keyEvents[siteId], ...answer };
          window.LV?.forget?.();
          UI.render(); UI.toast(t(names.length ? "Saved: these key events are your leads" : "Saved: every key event is counted, as Key events"));
        } catch (err) { box.textContent = t(err.message); box.hidden = false; button.disabled = false; }
        return;
      }
      if (form.matches?.("[data-lv-domain-form]")) {
        e.preventDefault(); box.hidden = true;
        try { L.domains = await api("POST", "important-domains", { domain: form.elements.f_domain.value }); UI.render(); UI.$("[data-lv-domain-form] input")?.focus(); } catch (err) { box.textContent = t(err.message); box.hidden = false; }
      } else if (form.matches?.("[data-lv-indexnow]")) {
        e.preventDefault(); box.hidden = true;
        try {
          const answer = await api("POST", "indexnow", { site_id: +form.elements.f_site.value, urls: form.elements.f_urls.value });
          form.elements.f_urls.value = "";
          UI.toast(`${num(answer.sent)} ${t("addresses sent")}${answer.pending_key_check ? ` · ${t("Key still being checked.")}` : ""}`);
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
      TP.on(DOMAIN_PAGES, () => UI.render());
      if (!limited()) firstLoad();
    },
    after() {
      const form = document.getElementById("ax-password"), kept = L.typed;
      if (!form || !kept) return;
      form.elements.f_current.value = kept.current; form.elements.f_new.value = kept.next;
      if (kept.focus) form.elements[kept.focus]?.focus({ preventScroll: true });
      L.typed = null;
    },
    page() {
      if (limited()) {
        // The app redraws the page now and then (alerts, the tray): what's typed in the password form comes back after it.
        const form = document.getElementById("ax-password");
        L.typed = form ? { current: form.elements.f_current.value, next: form.elements.f_new.value, focus: form.contains(document.activeElement) ? document.activeElement.name : "" } : null;
        return UI.topbar(t("Settings"), t("Your account"), "", false) + `<div class="content page-enter">${accountPage()}</div>`;
      }
      const tabs = `<div class="tabs" role="tablist" aria-label="${t("Settings")}">${LIVE.tabs()}</div>`;
      if (L.tab === "connections") {
        if (L.data) return UI.settingsPage();
        const waiting = L.failed ? UI.failCard(L.failed, { retry: "data-lv-sources-retry" }) : UI.skeleton("page", { chart: false, rows: 5 });
        return UI.topbar(t("Settings"), t("Connect tools and choose their sites"), "", false) + `<div class="content page-enter">${tabs}${waiting}</div>`;
      }
      const sub = { sites: "Where each site's data comes from", team: "Who can sign in", domains: "Domains worth a closer look" }[L.tab];
      return UI.topbar(t("Settings"), t(sub), "", false) + `<div class="content page-enter">${tabs}${L.tab === "sites" ? sitesTab() : L.tab === "domains" ? domainsTab() : teamTab()}</div>`;
    },
  };

  const fr = {
    "{host} isn't shared with {robot} in Search Console yet. Add it as a user there, then press Test again.": "{host} n'est pas encore partagé avec {robot} dans Search Console. Ajoutez-le comme utilisateur, puis cliquez de nouveau sur Tester.",
    "{host} isn't in this key's Search Console list yet. Share the property with it, then press Test again.": "{host} n'est pas encore dans la liste Search Console de cette clé. Partagez-lui la propriété, puis cliquez de nouveau sur Tester.",
    "{host}: pick its GA4 property, or Not used.": "{host} : choisissez sa propriété GA4, ou Non utilisé.",
    "Connection saved. {hosts}: no Search Console or GA4 property picked, so nothing is read there.": "Connexion enregistrée. {hosts} : aucune propriété Search Console ou GA4 choisie, donc rien n'y est lu.",
    "Leads from Google Analytics": "Leads depuis Google Analytics", "Tick the key events that are real enquiries": "Cochez les événements clés qui sont de vraies demandes",
    "Google Analytics counts every key event, such as a booking page view. Until you tick some, screens say Key events, not Leads.": "Google Analytics compte chaque événement clé, par exemple la vue d'une page de réservation. Tant que vous n'en cochez aucun, les écrans affichent Événements clés, pas Leads.",
    "Counts as a lead": "Compte comme lead", "Leads picked": "Leads choisis", "Counting every key event": "Tous les événements clés comptés",
    "in 12 months": "en 12 mois", "last": "dernier", "not sent any more": "plus envoyé", "Ticked: counts as a lead. Past days change too.": "Coché : compte comme lead. Les jours passés changent aussi.",
    "No key event read yet. They appear here once Google Analytics has been read again.": "Aucun événement clé lu pour l'instant. Ils apparaissent ici une fois Google Analytics relu.",
    "Saved: these key events are your leads": "Enregistré : ces événements clés sont vos leads", "Saved: every key event is counted, as Key events": "Enregistré : tous les événements clés sont comptés, comme Événements clés",
    "Pick key events from the list.": "Choisissez des événements clés dans la liste.",
    "Pick it": "La choisir", "Connection saved. Fetch the first numbers now?": "Connexion enregistrée. Récupérer les premiers chiffres maintenant ?", "Fetch my first numbers": "Récupérer mes premiers chiffres",
    "Site not linked": "Site non relié", "Reading the latest data…": "Lecture des dernières données…",
    "No domain matches.": "Aucun domaine ne correspond.", "Search domains": "Chercher un domaine", "domains": "domaines",
    "The stopped site is being read again; its numbers return in a few minutes.": "Le site arrêté est relu ; ses chiffres reviennent d'ici quelques minutes.",
    "The stopped sites are being read again; their numbers return in a few minutes.": "Les sites arrêtés sont relus ; leurs chiffres reviennent d'ici quelques minutes.",
    "Try again": "Réessayer",
    "Old Clarity data": "Anciennes données Clarity",
    "Clarity dashboard downloads": "Exports du tableau de bord Clarity", "From the file": "D'après le fichier", "Files": "Fichiers",
    "In Clarity, Dashboard → Export, for each site. Upload the .csv files here, several at once; each keeps its own period. They show on Content and AI search.": "Dans Clarity, Tableau de bord → Exporter, pour chaque site. Importez ici les fichiers .csv, plusieurs à la fois ; chacun garde sa période. Ils s'affichent dans Contenu et Recherche IA.",
    "Dashboard": "Tableau de bord", "AI visibility": "Visibilité IA", "replaces the current one": "remplace l'actuel", "replaced": "remplacé",
    "Reading the files…": "Lecture des fichiers…", "Adding them…": "Ajout en cours…", "file added": "fichier ajouté", "files added": "fichiers ajoutés", "file": "fichier", "files": "fichiers",
    "Now on Content and AI search.": "Désormais dans Contenu et Recherche IA.",
    "This isn't a Clarity dashboard download. In Clarity, open Dashboard and press Export.": "Ce n'est pas un export du tableau de bord Clarity. Dans Clarity, ouvrez Tableau de bord et appuyez sur Exporter.",
    "Upload the .csv files Clarity downloads.": "Importez les fichiers .csv téléchargés depuis Clarity.", "This file has no page addresses, so its site can't be found. Pick the site, then upload it again.": "Ce fichier n'a pas d'adresses de pages : son site est introuvable. Choisissez le site, puis importez-le à nouveau.",
    "Choose the Clarity files first.": "Choisissez d'abord les fichiers Clarity.", "This Clarity file has no date range that can be read.": "Ce fichier Clarity n'a pas de période lisible.",
    "Upload the file scripts/clarity_archive_export.py made on your Mac. It only adds missing days, so uploading twice is safe.": "Importez le fichier créé sur votre Mac par scripts/clarity_archive_export.py. Il n'ajoute que les jours manquants : l'importer deux fois est sans risque.",
    "to add": "à ajouter", "added": "ajoutés", "already here": "déjà présents", "Nothing new to add.": "Rien de nouveau à ajouter.", "Reading the file…": "Lecture du fichier…", "Adding the days…": "Ajout des jours…",
    "These sites aren't in the app, so their days are skipped. Add them as your sites, then upload again:": "Ces sites ne sont pas dans l'application : leurs jours sont ignorés. Ajoutez-les comme vos sites, puis importez à nouveau :",
    "Now on Content, for periods that include those dates.": "Désormais dans Contenu, pour les périodes qui incluent ces dates.",
    "day has Clarity sessions only: no scroll depth or clicks.": "jour n'a que des sessions Clarity : ni défilement ni clics.",
    "days have Clarity sessions only: no scroll depth or clicks.": "jours n'ont que des sessions Clarity : ni défilement ni clics.",
    "This isn't a Clarity archive file. Make it with scripts/clarity_archive_export.py.": "Ce n'est pas un fichier d'archive Clarity. Créez-le avec scripts/clarity_archive_export.py.",
    "Upload the .json file made by scripts/clarity_archive_export.py.": "Importez le fichier .json créé par scripts/clarity_archive_export.py.",
    "Important domains": "Domaines importants", "Domains worth a closer look": "Les domaines qui méritent un examen", "Moz rows left this month": "lignes Moz restantes ce mois-ci", "Moz isn't connected": "Moz n'est pas connecté", "Moz runs only on these domains, and only when you press the button.": "Moz ne tourne que sur ces domaines, et seulement quand vous appuyez sur le bouton.",
    "Add a domain": "Ajouter un domaine", "Get Moz data": "Obtenir les données Moz", "Get popularity": "Obtenir la popularité", "Domain": "Domaine", "Authority": "Autorité", "Moz Domain Authority": "Domain Authority Moz", "Linking domains": "Domaines référents", "Links": "Liens", "Popularity": "Popularité", "No domains yet. Add the ones worth a closer look.": "Pas encore de domaines. Ajoutez ceux qui méritent un examen.", "domains updated": "domaines mis à jour", "held back: no free rows left": "en attente : plus de lignes gratuites", "Popularity updated": "Popularité mise à jour", "Not ranked": "Non classé",
    "Tell Bing and Yandex about new pages": "Signaler les nouvelles pages à Bing et Yandex", "IndexNow. Google doesn't take part.": "IndexNow. Google n'y participe pas.", "Addresses, one per line": "Adresses, une par ligne", "Send": "Envoyer", "Connect IndexNow first: paste its key, and put the key file on your site.": "Connectez d'abord IndexNow : collez sa clé et placez le fichier de clé sur votre site.", "addresses sent": "adresses envoyées", "Key still being checked.": "Clé en cours de vérification.", "Enter a domain, such as example.com.": "Saisissez un domaine, par exemple example.com.",
    "free requests left today": "requêtes gratuites restantes aujourd'hui",
    "credits left this month": "crédits restants ce mois-ci",
    "Sign out": "Se déconnecter", "Google connections": "Connexions Google", "To add another, press Add another Google connection below. Each site then picks which one it uses.": "Pour en ajouter une autre, cliquez sur Ajouter une autre connexion Google ci-dessous. Chaque site choisit ensuite laquelle il utilise.", "Add another Google connection": "Ajouter une autre connexion Google",
    "Google connection": "Connexion Google", "works": "fonctionne", "property": "propriété", "properties": "propriétés", "It didn't work.": "Ça n'a pas fonctionné.", "Testing…": "Test…", "Works.": "Fonctionne.",
    "It sees no Search Console property yet: add its email there, then test again.": "Elle ne voit encore aucune propriété Search Console : ajoutez-y son e-mail, puis testez à nouveau.",
    "No test: it would spend 1 of Clarity's 10 daily requests. The first pull shows if the token works.": "Pas de test : il consommerait 1 des 10 requêtes quotidiennes de Clarity. La première lecture montre si le jeton fonctionne.",
    "Remove this key? You'd have to paste it again.": "Retirer cette clé ? Il faudra la coller à nouveau.",
    "Remove this key?": "Retirer cette clé ?", "You'd have to paste it again.": "Il faudra la coller à nouveau.", "Remove this Google connection?": "Retirer cette connexion Google ?",
    "Sites keep their data, and stop updating until they use another one.": "Les sites gardent leurs données et ne sont plus mis à jour jusqu'à ce qu'ils en utilisent une autre.", "Remove this Google connection? Sites keep their data, and stop updating until they use another one.": "Retirer cette connexion Google ? Les sites gardent leurs données et ne se mettent plus à jour tant qu'ils n'en utilisent pas une autre.",
    "Clarity has one token per site: tick Not used beside the site, then press Save.": "Clarity a un jeton par site : cochez Non utilisé à côté du site, puis cliquez sur Enregistrer.", "Press Remove next to the Google connection above.": "Appuyez sur Retirer à côté de la connexion Google ci-dessus.",
    "Works without a key, with a lower limit; a free key raises it.": "Marche sans clé, avec une limite plus basse ; une clé gratuite l'augmente.",
    "This key can't be checked until it's first used.": "Cette clé ne peut être vérifiée qu'à sa première utilisation.",
    "Where each site's data comes from": "D'où viennent les données de chaque site", "Who can sign in": "Qui peut se connecter", "Your sites": "Vos sites", "Not used": "Non utilisé", "Failing": "En échec", "Waiting for data": "En attente de données", "Not set up": "Non configuré", "Set up": "Configurer",
    "Only an admin can add or change accounts.": "Seul un admin peut ajouter ou modifier des comptes.", "Add a person": "Ajouter une personne", "Name": "Nom", "Email": "E-mail", "Role": "Rôle", "You": "Vous", "Member": "Membre", "Admin": "Admin", "Disabled": "Désactivé", "Locked for now": "Verrouillé pour l'instant", "Waiting for first login": "Attend sa première connexion", "Active": "Actif",
    "Reset password": "Réinitialiser le mot de passe", "Enable": "Activer", "Disable": "Désactiver", "They get a temporary password, and choose their own at first login.": "La personne reçoit un mot de passe temporaire et choisit le sien à la première connexion.", "Add": "Ajouter", "Temporary password": "Mot de passe temporaire",
    "Shown once. Copy it and hand it over in person or privately. They change it at first login.": "Affiché une seule fois. Copiez-le et transmettez-le en personne ou en privé. La personne le change à sa première connexion.", "Done": "Terminé", "Reset this person's password? They'll be signed out.": "Réinitialiser le mot de passe de cette personne ? Elle sera déconnectée.", "Saved": "Enregistré",
    "Only an admin can do that.": "Seul un admin peut faire cela.", "Enter a username of at least 3 letters or numbers, or an email address.": "Saisissez un nom d'utilisateur d'au moins 3 lettres ou chiffres, ou une adresse e-mail.", "Username or email": "Nom d'utilisateur ou e-mail", "Enter a name.": "Saisissez un nom.", "There is already an account with that username or email.": "Il existe déjà un compte avec cet identifiant ou cet e-mail.", "This is the only admin. Make someone else admin first.": "C'est le seul admin. Nommez d'abord quelqu'un d'autre admin.",
    "A GA4 property is its number, such as 123456789. It isn't the G-XXXX measurement ID.": "Une propriété GA4 est son numéro, par exemple 123456789. Ce n'est pas l'ID de mesure G-XXXX.", "A Search Console property looks like sc-domain:example.com or https://example.com/.": "Une propriété Search Console ressemble à sc-domain:example.com ou https://example.com/.",
    "My account": "Mon compte", "Your account": "Votre compte", "Change password": "Changer le mot de passe", "Current password": "Mot de passe actuel", "New password": "Nouveau mot de passe",
    "At least 10 characters. Your other sessions are signed out.": "Au moins 10 caractères. Vos autres sessions sont déconnectées.", "Password changed": "Mot de passe changé",
    "Wrong current password.": "Mot de passe actuel incorrect.", "Choose a different password.": "Choisissez un autre mot de passe.", "That didn't work. Try again.": "Cela n'a pas marché. Réessayez.",
    "Access": "Accès", "Full access": "Accès complet", "Edit access": "Modifier l'accès", "Access saved": "Accès enregistré", "Saving…": "Enregistrement…", "Adding…": "Ajout…",
    "section": "section", "sections": "sections", "site": "site", "sites": "sites", "all sites": "tous les sites", "can spend credits": "peut dépenser des crédits", "no credits": "pas de crédits",
    "Member: full access": "Membre : accès complet", "Member: chosen access": "Membre : accès choisi",
    "Everything, including Settings and the team.": "Tout, y compris les Réglages et l'équipe.", "Every website and section.": "Tous les sites et toutes les sections.", "Only the websites and sections you pick.": "Seulement les sites et les sections que vous choisissez.",
    "Websites": "Sites", "Sections": "Sections", "Set every section to": "Mettre toutes les sections sur", "No access": "Pas d'accès", "View": "Voir", "Edit": "Modifier",
    "Add one of your websites first, in the Sites tab.": "Ajoutez d'abord un de vos sites, dans l'onglet Sites.",
    "Can spend credits": "Peut dépenser des crédits", "Paid searches, Firecrawl, AI answers and Moz.": "Recherches payantes, Firecrawl, réponses IA et Moz.",
    "A person without every website can't change things all sites share (link gaps, mediators, competitor page reads).": "Une personne qui n'a pas tous les sites ne peut pas modifier ce que tous les sites partagent (écarts de liens, médiateurs, lectures des pages concurrentes).",
    "Taking access away signs them out everywhere.": "Retirer un accès la déconnecte partout.",
    "Pick at least one website and one section.": "Choisissez au moins un site et une section.", "Pick at least one website.": "Choisissez au moins un site.", "Pick at least one section.": "Choisissez au moins une section.",
    "One of those websites isn't one of yours.": "L'un de ces sites n'est pas à vous.", "That account doesn't exist.": "Ce compte n'existe pas.", "Nothing to change.": "Rien à modifier.",
    "That isn't the whole key file. Paste everything in the file, from the first { to the last }.": "Ce n'est pas le fichier de clé complet. Collez tout le fichier, du premier { au dernier }.",
  };
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
