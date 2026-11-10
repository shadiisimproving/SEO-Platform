/* Settings → AI: which AI writes the words on Search insights, per site, and the monthly cap on what Claude may cost.
   OpenRouter's free models are the default and cost nothing. Claude needs an Anthropic key (under Extras) and spends money,
   so what it has cost this month shows here beside the cap. The server keeps all of it (GET/PUT /api/insights/ai). */
(() => {
  "use strict";
  const A = { data: null, loading: false, error: "", at: 0 };
  const FRESH_MS = 15000; // a key saved under Extras shows here without a reload: older settings are read again
  window.AI_SETTINGS = A;
  const U = () => window.UI;

  function load() {
    if ((A.data && Date.now() - A.at < FRESH_MS) || A.loading || !window.COMP?.server) return;
    A.loading = true;
    window.COMP.api("GET", "insights/ai")
      .then((d) => { A.data = d; A.error = ""; A.at = Date.now(); })
      .catch((err) => { A.error = err.message; })
      .finally(() => { A.loading = false; if (U()?.state.route === "settings" && !U().$("#panel")) U().render({ keepScroll: true }); });
  }
  const money = (v) => `$${Number(v || 0).toFixed(v && v < 1 ? 4 : 2)}`;

  A.card = function card() {
    const { t, esc, icon } = U();
    if (!window.COMP?.server) return "";
    load();
    const head = `<div class="card-head"><h2>${t("AI on Search insights")}</h2><div class="hint-text">${t("Only a click asks AI, and each answer is kept. AI never changes what's found or how it's ranked.")}</div></div>`;
    if (!A.data) return `<section class="card" id="ai-settings">${head}<div class="empty"><p class="muted">${esc(A.error ? t(A.error) : t("Loading…"))}</p></div></section>`;
    const d = A.data;
    const rows = d.sites.map((s) => `<li><div class="what"><div class="t" dir="auto">${esc(s.host)}</div></div>
      <label class="ai-pick"><span class="sr">${t("AI for")} ${esc(s.host)}</span><select class="select" data-ai-site="${s.id}">
        <option value="openrouter" ${s.provider === "openrouter" ? "selected" : ""}>${t("Free models (OpenRouter)")}</option>
        <option value="claude" ${s.provider === "claude" ? "selected" : ""}>${t("Claude (Anthropic key)")}</option></select></label></li>`).join("");
    const usesClaude = d.sites.some((s) => s.provider === "claude");
    const keyNote = (id, name) => (d.keys[id] ? "" : `<p class="small ai-need">${icon("info")}${t(`${name} isn't connected yet.`)} <button class="link-btn" data-ai-key="${id === "claude" ? "anthropic" : id}">${t("Connect it")}</button></p>`);
    const spend = `<div class="ai-spend"><div><div class="lab">${t("Claude this month")}</div><div class="fig">${money(d.spent)} <span class="muted small">${t("of")} ${money(d.cap)}</span></div><div class="muted small">${d.requests} ${t(d.requests === 1 ? "answer" : "answers")}</div></div>
      <label class="field ai-cap"><span>${t("Monthly cap, in dollars")}</span><input class="input" type="number" min="0" max="1000" step="0.5" value="${esc(String(d.cap))}" data-ai-cap></label>
      <button class="btn" data-ai-save-cap>${t("Save the cap")}</button></div>`;
    const models = `<p class="small muted">${t("Claude Haiku 5.5 explains, suggests titles and writes the weekly summary. Claude Sonnet 5.5 writes content briefs and FAQs. A request that could pass the cap isn't sent.")}</p>`;
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
    if (e.target.closest?.("[data-ai-save-cap]")) { save({ cap: U().$("[data-ai-cap]")?.value }, "Cap saved"); return; }
    const key = e.target.closest?.("[data-ai-key]");
    if (key) U().openConnection?.(key.dataset.aiKey, key);
  });

  const words = {
    "AI on Search insights": "IA sur les analyses de recherche", "Only a click asks AI, and each answer is kept. AI never changes what's found or how it's ranked.": "L'IA n'est sollicitée que sur un clic, et chaque réponse est conservée. L'IA ne change jamais ce qui est trouvé ni son classement.",
    "AI for": "IA pour", "Free models (OpenRouter)": "Modèles gratuits (OpenRouter)", "Claude (Anthropic key)": "Claude (clé Anthropic)",
    "OpenRouter isn't connected yet.": "OpenRouter n'est pas encore connecté.", "Anthropic isn't connected yet.": "Anthropic n'est pas encore connecté.", "Connect it": "Le connecter",
    "Claude this month": "Claude ce mois-ci", "answer": "réponse", "answers": "réponses", "Monthly cap, in dollars": "Plafond mensuel, en dollars", "Save the cap": "Enregistrer le plafond",
    "Claude Haiku 5.5 explains, suggests titles and writes the weekly summary. Claude Sonnet 5.5 writes content briefs and FAQs. A request that could pass the cap isn't sent.": "Claude Haiku 5.5 explique, propose des titres et écrit le résumé de la semaine. Claude Sonnet 5.5 écrit les briefs et les FAQ. Une requête qui pourrait dépasser le plafond n'est pas envoyée.",
    "AI choice saved": "Choix de l'IA enregistré", "Cap saved": "Plafond enregistré", "The monthly cap must be a number of dollars.": "Le plafond mensuel doit être un nombre de dollars.",
    "The monthly cap must be between 0 and 1,000 dollars.": "Le plafond mensuel doit être entre 0 et 1 000 dollars.", "Pick OpenRouter's free models or Claude.": "Choisissez les modèles gratuits d'OpenRouter ou Claude.",
  };
  window.FR = window.FR || {};
  Object.keys(words).forEach((w) => { if (window.FR[w] === undefined) window.FR[w] = words[w]; });
})();
