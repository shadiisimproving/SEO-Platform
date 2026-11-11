/* Settings → AI: which AI writes the words on Search insights, per site, and the monthly cap on what Claude may cost.
   No AI until someone picks one for a site, because an insight carries that site's own Search Console numbers (F107).
   OpenRouter's free models cost nothing. Claude needs an Anthropic key (under Extras) and spends money,
   so what it has cost this month shows here beside the cap. The server keeps all of it (GET/PUT /api/insights/ai). */
(() => {
  "use strict";
  const A = { data: null, loading: false, error: "", at: 0 };
  const FRESH_MS = 15000; // a key saved under Extras shows here without a reload: older settings are read again
  window.AI_SETTINGS = A;
  const U = () => window.UI;

  /* A failed ask is stamped too, so the redraw that shows the error doesn't ask again at once: Try again does (F4). */
  function load({ force = false } = {}) {
    if (A.loading || !window.COMP?.server) return;
    if (!force && A.at && Date.now() - A.at < FRESH_MS && (A.data || A.error)) return;
    if (!force && A.error && !A.data) return; // after a failure only the Try again button asks
    A.loading = true;
    window.COMP.api("GET", "insights/ai")
      .then((d) => { A.data = d; A.error = ""; A.at = Date.now(); })
      .catch((err) => { A.error = err.message; A.at = Date.now(); })
      .finally(() => { A.loading = false; if (U()?.state.route === "settings" && !U().$("#panel")) U().render({ keepScroll: true }); });
  }
  const money = (v) => `$${Number(v || 0).toFixed(v && v < 1 ? 4 : 2)}`;

  A.card = function card() {
    const { t, esc, icon } = U();
    if (!window.COMP?.server) return "";
    load();
    const head = `<div class="card-head"><h2>${t("AI on Search insights")}</h2><div class="hint-text">${t("AI runs only on a click.")}${U().tip ? U().tip("Each answer is kept. AI never changes what's found or how it's ranked.") : ""}</div></div>
      <p class="small ai-sends">${icon("info")}<span>${t("Sent: the clicked insight's queries, page addresses and clicks, plus the page's title and headings. Never leads. OpenRouter's free models may keep it.")}${U().tip ? U().tip("With No AI, nothing leaves the app.") : ""}</span></p>`;
    if (!A.data) return `<section class="card" id="ai-settings">${head}${A.error ? (U().failCard ? U().failCard(A.error, { retry: "data-ai-retry" }) : `<div class="empty"><p class="muted">${esc(t(A.error))}</p><button class="btn" data-ai-retry>${t("Try again")}</button></div>`) : (U().skeleton ? U().skeleton("rows", { rows: 3 }) : `<div class="empty"><p class="muted">${t("Loading…")}</p></div>`)}</section>`;
    const d = A.data;
    const rows = d.sites.map((s) => `<li><div class="what"><div class="t" dir="auto">${esc(s.host)}</div></div>
      <label class="ai-pick"><span class="sr">${t("AI for")} ${esc(s.host)}</span><select class="select" data-ai-site="${s.id}" ${U().canAdmin && !U().canAdmin() ? `disabled title="${esc(t("Only an admin can change this."))}"` : ""}>
        <option value="none" ${s.provider === "none" ? "selected" : ""}>${t("No AI (nothing is sent)")}</option>
        <option value="openrouter" ${s.provider === "openrouter" ? "selected" : ""}>${t("Free models (OpenRouter)")}</option>
        <option value="claude" ${s.provider === "claude" ? "selected" : ""}>${t("Claude (Anthropic key)")}</option></select></label></li>`).join("");
    const usesClaude = d.sites.some((s) => s.provider === "claude");
    const keyNote = (id, name) => (d.keys[id] ? "" : `<p class="small ai-need">${icon("info")}${t(`${name} isn't connected yet.`)} <button class="link-btn" data-ai-key="${id === "claude" ? "anthropic" : id}">${t("Connect it")}</button></p>`);
    const spend = `<div class="ai-spend"><div><div class="lab">${t("Claude this month")}</div><div class="fig">${money(d.spent)} <span class="muted small">${t("of")} ${money(d.cap)}</span></div><div class="muted small">${d.requests} ${t(d.requests === 1 ? "answer" : "answers")}</div></div>
      <label class="field ai-cap"><span>${t("Monthly cap ($)")}</span><input class="input" type="number" min="0" max="1000" step="0.5" value="${esc(String(d.cap))}" data-ai-cap></label>
      <button class="btn" data-ai-save-cap>${t("Save")}</button></div>`;
    const models = `<p class="small muted">${t("Claude Haiku 5.5: explanations, titles, weekly summary. Claude Sonnet 5.5: briefs and FAQs. Nothing that could pass the cap is sent.")}</p>`;
    return `<section class="card" id="ai-settings">${head}<ul class="rows">${rows}</ul>
      <div class="ai-foot">${d.sites.some((s) => s.provider === "openrouter") ? keyNote("openrouter", "OpenRouter") : ""}${usesClaude ? keyNote("claude", "Anthropic") : ""}${spend}${models}</div></section>`;
  };

  async function save(body, what) {
    const { t } = U();
    try {
      A.data = await window.COMP.api("PUT", "insights/ai", body);
      A.at = Date.now();
      dispatchEvent(new CustomEvent("seocc:ai-settings", { detail: A.data }));
      U().toast(t(what));
      U().render({ keepScroll: true });
    } catch (err) { U().toast(t(err.message), { kind: "crit" }); }
  }
  document.addEventListener("change", (e) => {
    const el = e.target.closest?.("[data-ai-site]");
    if (el) save({ sites: [{ id: Number(el.dataset.aiSite), provider: el.value }] }, "AI choice saved");
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-ai-retry]")) { A.error = ""; load({ force: true }); U().render({ keepScroll: true }); return; }
    if (e.target.closest?.("[data-ai-save-cap]")) { save({ cap: U().$("[data-ai-cap]")?.value }, "Cap saved"); return; }
    const key = e.target.closest?.("[data-ai-key]");
    if (key) U().openConnection?.(key.dataset.aiKey, key);
  });

  const words = {
    "AI on Search insights": "IA sur les analyses de recherche", "AI runs only on a click.": "L'IA ne tourne que sur un clic.",
    "AI for": "IA pour", "Free models (OpenRouter)": "Modèles gratuits (OpenRouter)", "Claude (Anthropic key)": "Claude (clé Anthropic)",
    "OpenRouter isn't connected.": "OpenRouter n'est pas connecté.", "Anthropic isn't connected.": "Anthropic n'est pas connecté.", "Connect it": "Le connecter",
    "Claude this month": "Claude ce mois-ci", "answer": "réponse", "answers": "réponses", "Monthly cap ($)": "Plafond mensuel ($)", "Save": "Enregistrer",
    "Claude Haiku 5.5: explanations, titles, weekly summary. Claude Sonnet 5.5: briefs and FAQs. Nothing that could pass the cap is sent.": "Claude Haiku 5.5 : explications, titres, résumé de la semaine. Claude Sonnet 5.5 : briefs et FAQ. Rien qui pourrait dépasser le plafond n'est envoyé.",
    "AI choice saved": "Choix de l'IA enregistré", "No AI (nothing is sent)": "Pas d'IA (rien n'est envoyé)", "Only an admin can change this.": "Seul un admin peut modifier ceci.",
    "Sent: the clicked insight's queries, page addresses and clicks, plus the page's title and headings. Never leads. OpenRouter's free models may keep it.": "Envoyé : les requêtes, adresses de pages et clics de l'analyse cliquée, plus le titre et les intertitres de la page. Jamais les leads. Les modèles gratuits d'OpenRouter peuvent le garder.",
    "No AI chosen yet, so nothing is sent. Pick one in Settings → AI.": "Aucune IA choisie : rien n'est envoyé. Choisissez-en une dans Réglages → IA.",
    "Pick No AI, OpenRouter's free models or Claude.": "Choisissez Pas d'IA, les modèles gratuits d'OpenRouter ou Claude.", "Cap saved": "Plafond enregistré", "The cap must be a dollar amount.": "Le plafond doit être un montant en dollars.",
    "The cap must be $0 to $1,000.": "Le plafond doit être entre 0 et 1 000 $.", "Pick OpenRouter's free models or Claude.": "Choisissez les modèles gratuits d'OpenRouter ou Claude.",
  };
  window.FR = window.FR || {};
  Object.keys(words).forEach((w) => { if (window.FR[w] === undefined) window.FR[w] = words[w]; });
})();
