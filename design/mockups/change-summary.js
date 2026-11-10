/* The optional AI summary of a competitor's change: a button on the row, shown only once OpenRouter is connected.
   Only a click asks. An answer already kept shows at once. What the model wrote is always escaped, and always says AI wrote it. */
(() => {
  "use strict";
  const on = () => Boolean(window.BOOT?.summaries_on);
  const lang = () => (window.UI?.state.lang === "fr" ? "fr" : "en");
  const box = (held) => {
    const { t, esc, icon } = window.UI;
    return `<div class="cs-summary"><div class="cs-summary-text" dir="auto">${esc(held.text)}</div><div class="cs-summary-by">${icon("sparkles")}${t("Written by AI from the page's text. It can be wrong.")}</div></div>`;
  };
  window.ChangeSummary = {
    /* e: { id, summaries }. A kept answer shows even if the key was removed later. */
    slot(e) {
      if (!e?.id) return "";
      const { t, icon } = window.UI;
      const held = e.summaries?.[lang()];
      if (held) return box(held);
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
    "Summarise with AI": "Résumer avec l'IA", "Summarising…": "Résumé en cours…", "Written by AI from the page's text. It can be wrong.": "Écrit par une IA à partir du texte de la page. Cela peut être faux.",
    "Connect OpenRouter in Settings first.": "Connectez d'abord OpenRouter dans les réglages.", "No text was saved for this change, so there's nothing to summarise.": "Aucun texte n'a été conservé pour ce changement : il n'y a rien à résumer.",
    "OpenRouter's free limit is reached. It refills at midnight UTC.": "La limite gratuite d'OpenRouter est atteinte. Elle se renouvelle à minuit UTC.", "OpenRouter refused this key. Paste it again in Settings.": "OpenRouter a refusé cette clé. Collez-la à nouveau dans les réglages.",
    "OpenRouter didn't answer. Try again in a moment.": "OpenRouter n'a pas répondu. Réessayez dans un instant.", "OpenRouter's answer couldn't be read. Try again in a moment.": "La réponse d'OpenRouter est illisible. Réessayez dans un instant.", "The free model gave no answer. Try again: it may pick another one.": "Le modèle gratuit n'a pas répondu. Réessayez : un autre sera peut-être choisi.",
    "Plain-language summaries of competitors' changes": "Résumés en langage simple des changements des concurrents", "Off until you paste a key. Only a click uses a request, and each answer is kept.": "Désactivé tant qu'aucune clé n'est collée. Seul un clic consomme une requête, et chaque réponse est conservée.",
    "Create a free OpenRouter account. No card is needed.": "Créez un compte OpenRouter gratuit. Aucune carte n'est nécessaire.", "Open Keys and create a key. Give it a credit limit of 0 if you want to be sure it can't spend.": "Ouvrez Keys et créez une clé. Donnez-lui une limite de crédit de 0 pour être sûr qu'elle ne dépense rien.", "Paste it here, press Test, then Save. A Summarise with AI button appears on competitors' changes.": "Collez-la ici, appuyez sur Test puis sur Enregistrer. Un bouton Résumer avec l'IA apparaît sur les changements des concurrents.",
    "Competitor summaries send the competitor's public page text. AI on Search insights sends your site's queries, page addresses and clicks, but only for a site you set to OpenRouter under Settings → AI (no site is, until you choose). Free models may keep what they're sent. Nothing about your leads is sent.": "Les résumés de concurrents envoient le texte public de leur page. L'IA des analyses de recherche envoie les requêtes, les adresses de pages et les clics de votre site, mais seulement pour un site réglé sur OpenRouter dans Réglages → IA (aucun ne l'est tant que vous n'avez pas choisi). Les modèles gratuits peuvent garder ce qu'ils reçoivent. Rien sur vos leads n'est envoyé.",
    "Only for a site you set to Claude under Settings → AI: it sends the numbers Search Console gave for that insight (queries, page addresses, clicks), and the page's title and headings, to Anthropic. Nothing about your leads is sent.": "Seulement pour un site réglé sur Claude dans Réglages → IA : les chiffres de la Search Console pour cette analyse (requêtes, adresses de pages, clics), ainsi que le titre et les intertitres de la page, sont envoyés à Anthropic. Rien sur vos leads n'est envoyé.",
    "It sends the competitor's public page text to OpenRouter, and free models may keep what they're sent. Nothing about your own sites or leads is sent.": "Le texte public de la page du concurrent est envoyé à OpenRouter, et les modèles gratuits peuvent conserver ce qu'ils reçoivent. Rien sur vos sites ou vos leads n'est envoyé.", "50 requests a day, 20 a minute": "50 requêtes par jour, 20 par minute",
  });
})();
