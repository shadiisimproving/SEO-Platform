/* The optional AI summary of a competitor's change: a button on the row, shown only once OpenRouter is connected.
   Only a click asks. An answer already kept shows at once. What the model wrote is always escaped, and always says AI wrote it. */
(() => {
  "use strict";
  const on = () => Boolean(window.BOOT?.summaries_on);
  const lang = () => (window.UI?.state.lang === "fr" ? "fr" : "en");
  const box = (held) => {
    const { t, esc, icon } = window.UI;
    return `<div class="cs-summary"><div class="cs-summary-text" dir="auto">${esc(held.text)}</div><div class="cs-summary-by">${icon("sparkles")}${t("Written by AI, may be wrong.")}</div></div>`;
  };
  /* As seo/extras/summaries.py usable(): at least a short sentence. */
  const usable = (words) => { const w = String(words || "").trim().split(/\s+/).filter(Boolean); return w.join(" ").length >= 8 && w.length >= 2; };
  window.ChangeSummary = {
    /* e: { id, summaries }. A kept answer shows even if the key was removed later. */
    slot(e) {
      if (!e?.id) return "";
      const { t, icon } = window.UI;
      const held = e.summaries?.[lang()];
      if (held && usable(held.text)) return box(held); // a one-letter answer kept by an older version ("A") is asked for again
      if (!on()) return "";
      return `<div class="cs-summary-slot"><button type="button" class="link-btn cs-summary-btn" data-change-summary="${Number(e.id)}">${icon("sparkles")}${t("Summarise with AI")}</button><span class="error" role="alert" hidden></span></div>`;
    },
  };
  document.addEventListener("click", async (event) => {
    const button = event.target.closest?.("[data-change-summary]");
    if (!button) return;
    event.stopPropagation();
    const { t, setHTML } = window.UI, slot = button.parentElement, problem = slot.querySelector(".error"), word = button.innerHTML;
    button.disabled = true; button.textContent = t("Summarising…"); problem.hidden = true;
    try {
      const answer = await window.COMP.api("POST", `changes/${button.dataset.changeSummary}/summary`, { language: lang() });
      setHTML(slot, box(answer));
    } catch (err) {
      problem.textContent = t(err.message); problem.hidden = false;
      button.disabled = false; setHTML(button, word);
    }
  }, true);
  Object.assign(window.FR, {
    "Summarise with AI": "Résumer avec l'IA", "Summarising…": "Résumé en cours…", "Written by AI, may be wrong.": "Écrit par une IA, peut être faux.",
    "Connect OpenRouter in Settings first.": "Connectez d'abord OpenRouter dans les réglages.", "No saved text to summarise.": "Aucun texte conservé à résumer.",
    "OpenRouter free limit reached. Refills at midnight UTC.": "Limite gratuite d'OpenRouter atteinte. Elle revient à minuit UTC.", "OpenRouter refused this key. Paste it again in Settings.": "OpenRouter a refusé cette clé. Collez-la à nouveau dans les réglages.",
    "OpenRouter didn't answer. Try again.": "OpenRouter n'a pas répondu. Réessayez.", "OpenRouter's answer was unreadable. Try again.": "Réponse d'OpenRouter illisible. Réessayez.", "The free model didn't answer. Try again for another.": "Le modèle gratuit n'a pas répondu. Réessayez pour en avoir un autre.",
    "Summarises competitors' changes": "Résume les changements des concurrents", "Off without a key. Only a click spends a request; answers are kept.": "Désactivé sans clé. Seul un clic consomme une requête ; les réponses sont gardées.",
    "Create a free account. No card needed.": "Créez un compte gratuit, sans carte bancaire.", "Open Keys and create a key. To be safe, set its credit limit to 0.": "Ouvrez Keys et créez une clé. Par sécurité, fixez sa limite de crédit à 0.", "Paste it, press Test, then Save. Competitors' changes then show Summarise with AI.": "Collez-la, cliquez sur Tester, puis Enregistrer. Les changements des concurrents affichent alors Résumer avec l'IA.",
    "Free models may keep what they're sent. Leads are never sent.": "Les modèles gratuits peuvent garder ce qu'ils reçoivent. Les leads ne sont jamais envoyés.",
    "Sends the insight's numbers, title and headings to Anthropic. Leads are never sent.": "Envoie les chiffres de l'analyse, le titre et les intertitres à Anthropic. Les leads ne sont jamais envoyés.",
    "It sends the competitor's public page text to OpenRouter, and free models may keep what they're sent. Nothing about your own sites or leads is sent.": "Le texte public de la page du concurrent est envoyé à OpenRouter, et les modèles gratuits peuvent conserver ce qu'ils reçoivent. Rien sur vos sites ou vos leads n'est envoyé.", "50 requests a day, 20 a minute": "50 requêtes par jour, 20 par minute",
  });
})();
