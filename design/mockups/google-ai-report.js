/* AI search: Google's own generative AI report (AI Overviews and AI Mode), uploaded from Search Console's Export.
   Google's API doesn't give it, so a person downloads it (Performance → Generative AI → Export → Download CSV) and drops
   the zip here. The server reads it (seo/imports/gsc_ai_report.py). The AI search screen puts this card in with
   window.GoogleAIReport.card(); everything it says is in English and French below. */
(() => {
  "use strict";
  const G = { site: undefined, data: null, loading: false, error: "", busy: false, note: "" };
  window.GoogleAIReport = G;
  const UI = () => window.UI;
  const t = (w) => UI().t(w);
  const esc = (v) => UI().esc(v);
  const num = (v) => UI().num(v);
  const fill = (s, values) => Object.entries(values).reduce((out, [k, v]) => out.split(`{${k}}`).join(v), t(s));
  const day = (iso) => (iso ? new Intl.DateTimeFormat(UI().locale(), { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${iso}T00:00:00`)) : "");
  const pathOf = (url) => { try { return new URL(url).pathname || "/"; } catch { return url || "/"; } };
  const HOW = "In Search Console: Performance → Generative AI → Export → Download CSV. Then upload the zip here.";

  function load() {
    const site = UI().siteIdPicked() || null;
    if (G.site === site && (G.data || G.loading || G.error)) return;
    if (!window.COMP?.server) return;
    G.site = site; G.loading = true; G.error = "";
    window.COMP.api("GET", `search/ai-report${site ? `?site_id=${site}` : ""}`)
      .then((d) => { G.data = d; }).catch((err) => { G.error = err.message; G.data = null; })
      .finally(() => { G.loading = false; if (UI().state.route === "ai" && !UI().$("#panel")) UI().render({ keepScroll: true }); });
  }

  const uploadForm = (again) => UI().siteIdPicked()
    ? `<form class="gai-upload" data-gai-form><label class="btn ${again ? "" : "btn-main"}">${UI().icon("arrow-up")}<span>${t(again ? "Upload a newer one" : "Upload the export")}</span><input type="file" name="file" accept=".zip,.csv" multiple hidden data-gai-file></label>${G.busy ? `<span class="muted small">${t("Reading…")}</span>` : ""}${G.note ? `<span class="small" role="status">${esc(G.note)}</span>` : ""}</form>`
    : `<p class="small muted">${t("Pick a site to upload its report.")}</p>`;

  function card() {
    if (!window.UI || !window.COMP?.server) return "";
    load();
    const head = (end) => `<div class="card-head"><h2>${t("Google AI Overviews and AI Mode")}</h2>${end ? `<span class="end small muted">${end}</span>` : ""}</div>`;
    if (G.loading && !G.data) return "";
    if (G.error) return `<section class="card" style="margin-bottom:14px">${head("")}<p style="padding:12px 18px;margin:0" class="error">${esc(G.error)}</p></section>`;
    const sites = G.data?.sites || [];
    if (!sites.length) {
      return `<section class="card" style="margin-bottom:14px">${head(t("from Search Console, uploaded"))}<div style="padding:12px 18px 16px">
        <p style="margin:0 0 8px">${t("How often Google shows your pages inside its AI answers. Google's API doesn't give this, so it comes from Search Console's own export.")}</p>
        <p class="small muted" style="margin:0 0 10px">${t(HOW)}</p>${uploadForm(false)}</div></section>`;
    }
    if (sites.length > 1 || !UI().siteIdPicked()) {
      const rows = sites.map((s) => `<tr><td data-label="${t("Site")}"><span class="mono" dir="ltr">${esc(s.host)}</span><div class="small muted">${esc(day(s.period_start))} – ${esc(day(s.period_end))}</div></td><td class="c" data-label="${t("Impressions")}">${num(s.impressions)}</td><td class="c" data-label="${t("Pages")}">${num(s.pages_count)}</td></tr>`).join("");
      return `<section class="card" style="margin-bottom:14px">${head(t("from Search Console, uploaded"))}<div class="table-wrap" style="box-shadow:none"><table class="data"><thead><tr><th>${t("Site")}</th><th class="c">${t("Impressions")}</th><th class="c">${t("Pages")}</th></tr></thead><tbody>${rows}</tbody></table></div><p class="small muted" style="margin:0;padding:10px 18px 14px">${t("Pick a site to see its pages, or to upload its report.")}</p></section>`;
    }
    const r = sites[0];
    const period = `${day(r.period_start)} – ${day(r.period_end)}${r.period_known ? "" : ` (${t("about: the file had no dates")})`}`;
    const change = r.before && r.before.impressions ? Math.round(((r.impressions - r.before.impressions) / r.before.impressions) * 100) : null;
    const answer = fill("Google showed this site's pages {n} times in AI Overviews and AI Mode, {p}.", { n: num(r.impressions), p: period });
    const pages = (r.pages || []).slice(0, 10).map((p) => `<tr><td data-label="${t("Page")}">${window.PageLink ? PageLink.html(p.key, { text: pathOf(p.key), cls: "mono lv-url", dir: "ltr" }) : esc(pathOf(p.key))}</td><td class="c" data-label="${t("Impressions")}">${num(p.impressions)}</td></tr>`).join("");
    const countries = (r.countries || []).slice(0, 3).map((c) => `${c.key} ${num(c.impressions)}`).join(" · ");
    return `<section class="card" style="margin-bottom:14px">${head(`${t("from Search Console, uploaded")} ${esc(day(r.uploaded_at?.slice(0, 10)))}`)}
      <p style="margin:0;padding:12px 18px 0">${esc(answer)}${change !== null ? ` ${esc(fill(change >= 0 ? "Up {p}% on the upload before." : "Down {p}% on the upload before.", { p: num(Math.abs(change)) }))}` : ""}</p>
      ${countries ? `<p class="small muted" style="margin:4px 0 0;padding:0 18px">${esc(fill("Most from: {list}", { list: countries }))}</p>` : ""}
      ${pages ? `<div class="table-wrap" style="box-shadow:none;margin-top:10px"><table class="data"><thead><tr><th>${t("Page")}</th><th class="c">${t("Impressions")}</th></tr></thead><tbody>${pages}</tbody></table></div>` : ""}
      <div style="padding:10px 18px 14px">${uploadForm(true)}<p class="small muted" style="margin:6px 0 0">${t(HOW)}</p></div></section>`;
  }
  G.card = card;

  document.addEventListener("change", async (e) => {
    const input = e.target.closest?.("[data-gai-file]");
    if (!input || !input.files.length) return;
    const form = new FormData();
    [...input.files].forEach((f) => form.append("file", f));
    form.append("site_id", UI().siteIdPicked());
    G.busy = true; G.note = ""; UI().render({ keepScroll: true });
    try {
      const done = await window.COMP.api("POST", "search/ai-report", undefined, { form });
      G.note = fill(done.replaced ? "Replaced the upload for {p}." : "Saved: {p}.", { p: `${day(done.period_start)} – ${day(done.period_end)}` });
      G.site = undefined; G.data = null;
      UI().toast(t("Google's AI report is in."));
    } catch (err) { G.note = t(err.message); UI().toast(t(err.message), { kind: "crit" }); }
    G.busy = false;
    UI().render({ keepScroll: true });
  });
  addEventListener("seocc:site-picked", () => { G.site = undefined; });

  const fr = {
    "Google AI Overviews and AI Mode": "AI Overviews et AI Mode de Google", "from Search Console, uploaded": "de la Search Console, importé",
    "How often Google shows your pages inside its AI answers. Google's API doesn't give this, so it comes from Search Console's own export.": "Combien de fois Google montre vos pages dans ses réponses IA. L'API de Google ne le donne pas : cela vient de l'export de la Search Console.",
    "In Search Console: Performance → Generative AI → Export → Download CSV. Then upload the zip here.": "Dans la Search Console : Performances → IA générative → Exporter → Télécharger CSV. Puis importez le zip ici.",
    "Upload the export": "Importer l'export", "Upload a newer one": "En importer un plus récent", "Reading…": "Lecture…", "Pick a site to upload its report.": "Choisissez un site pour importer son rapport.",
    "Pick a site to see its pages, or to upload its report.": "Choisissez un site pour voir ses pages ou importer son rapport.", "Site": "Site", "Impressions": "Impressions", "Pages": "Pages", "Page": "Page",
    "about: the file had no dates": "environ : le fichier n'avait pas de dates",
    "Google showed this site's pages {n} times in AI Overviews and AI Mode, {p}.": "Google a montré les pages de ce site {n} fois dans les AI Overviews et l'AI Mode, {p}.",
    "Up {p}% on the upload before.": "En hausse de {p} % par rapport à l'import précédent.", "Down {p}% on the upload before.": "En baisse de {p} % par rapport à l'import précédent.",
    "Most from: {list}": "Surtout de : {list}", "Replaced the upload for {p}.": "Import remplacé pour {p}.", "Saved: {p}.": "Enregistré : {p}.", "Google's AI report is in.": "Le rapport IA de Google est importé.",
    "This isn't Search Console's generative AI report. In Search Console, open Performance → Generative AI, press Export and download the CSV.": "Ce n'est pas le rapport IA générative de la Search Console. Dans la Search Console, ouvrez Performances → IA générative, cliquez sur Exporter et téléchargez le CSV.",
    "Download the report as CSV (Export → Download CSV), not as a spreadsheet.": "Téléchargez le rapport en CSV (Exporter → Télécharger CSV), pas en tableur.",
    "Pick the site this report is about.": "Choisissez le site concerné par ce rapport.", "Choose the export file first.": "Choisissez d'abord le fichier exporté.",
  };
  Object.keys(fr).forEach((w) => { if (window.FR && window.FR[w] === undefined) window.FR[w] = fr[w]; });
})();
