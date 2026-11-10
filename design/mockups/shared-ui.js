/* Shared pieces every screen can use, put on window.UI by mockup.js (window.SHARED_UI.install):

     UI.skeleton(kind, opts)          grey shapes of the page while it loads, instead of one "Loading…" card.
                                      kind: "page" (tiles, chart, table), "tiles", "chart", "table", "rows", "panel".
                                      opts: { tiles: 4, rows: 6, chart: true, label: "Loading…" }
     UI.failCard(err, opts)           a card that says what failed in plain words, with Try again where it shows.
                                      opts: { title, onRetry: () => …, retry: "data-attr-name", action: "<extra button html>" }
     UI.errorWords(errOrMessage)      a sentence for a person, never "Internal Server Error", "Failed to fetch" or "Error 429".
     UI.def(name)                     the definition of a metric (English name as the key), in the screen's language, or "".
     UI.defIcon(name)                 a small (i) after a label: hover or focus shows the definition, Esc closes it.
     UI.canAdmin()                    whether the signed-in account may change admin settings (true when there's no login).
     UI.adminOnly()                   attributes for a control a Member can't use: disabled, with the reason as its tip.

   The metric definitions are written once, here, in English and French (window.METRIC_DEFS). */
(() => {
  "use strict";

  /* ---- what each number means: one place, two languages -------------------------------------------------- */
  const DEFS = {
    Clicks: ["Times someone clicked from Google's results to your site. From Search Console.", "Nombre de fois où quelqu'un a cliqué depuis les résultats de Google vers votre site. Source : Search Console."],
    Impressions: ["Times one of your pages showed in Google's results, seen or not. From Search Console.", "Nombre de fois où l'une de vos pages est apparue dans les résultats de Google, vue ou non. Source : Search Console."],
    "Click rate": ["Clicks divided by impressions: of the people who saw you in Google, the share who clicked.", "Clics divisés par impressions : parmi les personnes qui vous ont vu dans Google, la part qui a cliqué."],
    "Average position": ["Your average place in Google's results, where 1 is the top. Lower is better. Search Console's average over every search and country.", "Votre place moyenne dans les résultats de Google, 1 étant la première. Plus c'est bas, mieux c'est. Moyenne de la Search Console sur toutes les recherches et tous les pays."],
    "Ranking queries": ["Different searches your site showed up for in this period.", "Nombre de recherches différentes pour lesquelles votre site est apparu sur la période."],
    Visits: ["Sessions counted by Google Analytics: one person's visit, however many pages they open.", "Sessions comptées par Google Analytics : une visite d'une personne, quel que soit le nombre de pages vues."],
    Leads: ["Visits that ended in an enquiry: the Google Analytics key events you marked as leads (a form sent, a call, a booking).", "Visites terminées par une demande : les événements clés Google Analytics marqués comme leads (formulaire envoyé, appel, réservation)."],
    "Lead rate": ["Leads divided by visits: the share of visits that became an enquiry.", "Leads divisés par visites : la part des visites devenues une demande."],
    Channels: ["Where visits came from, grouped the way Google Analytics groups them (Organic Search, Direct, Referral…).", "D'où viennent les visites, regroupées comme le fait Google Analytics (Recherche organique, Direct, Référent…)."],
    "Clarity sessions": ["Visits recorded by Microsoft Clarity. It counts a little differently from Google Analytics.", "Visites enregistrées par Microsoft Clarity. Il compte un peu différemment de Google Analytics."],
    "Scroll depth": ["How far down the page visitors scroll, on average.", "Jusqu'où les visiteurs descendent dans la page, en moyenne."],
    "Rage clicks": ["Visits where someone clicked the same spot again and again, usually out of frustration.", "Visites où quelqu'un a cliqué plusieurs fois au même endroit, souvent par frustration."],
    "Dead clicks": ["Clicks on something that did nothing, such as text that looks like a link.", "Clics sur un élément qui ne fait rien, comme un texte qui ressemble à un lien."],
    "Real visits": ["Visits Clarity believes came from people, with robots left out.", "Visites que Clarity attribue à des personnes, robots exclus."],
    "Speed score": ["Google PageSpeed's score from 0 to 100 for the home page. 90 and above is good.", "Score Google PageSpeed de 0 à 100 pour la page d'accueil. 90 et plus, c'est bien."],
    Citations: ["Times an AI assistant (Copilot, from Bing's report) named one of your pages as a source.", "Nombre de fois où un assistant IA (Copilot, d'après le rapport de Bing) a cité l'une de vos pages comme source."],
    "Share of authority": ["Of Copilot's answers on these topics, the share that cited you.", "Parmi les réponses de Copilot sur ces sujets, la part qui vous cite."],
    "AI visits": ["Visits that came from an AI assistant such as ChatGPT, Perplexity or Copilot.", "Visites venues d'un assistant IA comme ChatGPT, Perplexity ou Copilot."],
    "Share of all visits": ["AI visits divided by all visits.", "Visites IA divisées par toutes les visites."],
    Cost: ["What Google Ads charged in this period.", "Ce que Google Ads a facturé sur la période."],
    Tracked: ["Keywords you follow on this site. Rankings are checked only when you press Refresh.", "Mots-clés suivis sur ce site. Les positions ne sont vérifiées que lorsque vous appuyez sur Actualiser."],
    Ranked: ["Tracked keywords found in the results the last check read.", "Mots-clés suivis trouvés dans les résultats lus au dernier contrôle."],
    "Top 10": ["Tracked keywords on Google's first page (positions 1 to 10) in the last check, read from the results page itself.", "Mots-clés suivis en première page de Google (positions 1 à 10) au dernier contrôle, lus sur la page de résultats elle-même."],
    "Cited by AI": ["Tracked keywords where Google's AI Overview names your site.", "Mots-clés suivis pour lesquels l'aperçu IA de Google cite votre site."],
    "Scraped results": ["Your position read from the search results page by a search tool, from one country, at the time of the check.", "Votre position lue sur la page de résultats par un outil de recherche, depuis un pays, au moment du contrôle."],
    "avg position": ["The engine's own tool (Search Console, Bing or Yandex Webmaster): your average position over 28 days. For Google, in the keyword's own country when Search Console has it, with the all-countries average under it.", "L'outil du moteur (Search Console, Bing ou Yandex Webmaster) : votre position moyenne sur 28 jours. Pour Google, dans le pays du mot-clé quand la Search Console l'a, avec la moyenne tous pays en dessous."],
    Change: ["Places gained or lost since the check before, with the same tool. Up is better.", "Places gagnées ou perdues depuis le contrôle précédent, avec le même outil. Vers le haut, c'est mieux."],
    "Impressions (28 days)": ["Search Console impressions for this keyword over the last 28 days: how often it showed. It is not search volume.", "Impressions Search Console de ce mot-clé sur les 28 derniers jours : combien de fois il est apparu. Ce n'est pas le volume de recherche."],
    Trend: ["Positions over the last checks with the same tool.", "Positions sur les derniers contrôles avec le même outil."],
    Total: ["Every backlink logged for this site, live or not.", "Tous les backlinks enregistrés pour ce site, actifs ou non."],
    Live: ["Links found on the linking page at the last check.", "Liens trouvés sur la page qui fait le lien au dernier contrôle."],
    Lost: ["Links that were there and are gone from the linking page.", "Liens qui étaient là et ont disparu de la page qui fait le lien."],
    New: ["Links placed in the period chosen above.", "Liens placés pendant la période choisie en haut."],
    "Health score": ["0 to 100 from the last health test: 100 means no problem found. Each problem takes points off by how serious it is.", "De 0 à 100 d'après le dernier test de santé : 100 veut dire aucun problème trouvé. Chaque problème retire des points selon sa gravité."],
    Authority: ["A 0 to 100 estimate of how strong a site's backlinks are, from Open PageRank or Moz. An estimate, not a Google number.", "Estimation de 0 à 100 de la force des backlinks d'un site, d'après Open PageRank ou Moz. Une estimation, pas un chiffre de Google."],
    "Spam score": ["Moz's estimate of how likely a site is to be penalised, in %. Over 30 is a warning.", "Estimation Moz du risque de pénalité d'un site, en %. Au-delà de 30, c'est un signal d'alerte."],
    "Referring domains": ["Different websites that link to you, counted once each however many links they have.", "Sites différents qui font un lien vers vous, comptés une fois chacun quel que soit le nombre de liens."],
  };
  // The same thing under the short name some tables use.
  DEFS.Position = DEFS["Average position"];
  DEFS.Sessions = DEFS.Visits;
  DEFS["Search Console"] = DEFS["avg position"];
  window.METRIC_DEFS = DEFS;

  /* ---- words this file and the shared helpers use -------------------------------------------------------------- */
  const FR = {
    "Loading…": "Chargement…", "That didn't load": "Le chargement a échoué", "Try again": "Réessayer", "What it means": "Ce que ça veut dire",
    "The server can't be reached. Check the connection, then try again.": "Le serveur est injoignable. Vérifiez la connexion, puis réessayez.",
    "Something went wrong on the server. Try again in a moment.": "Un problème est survenu sur le serveur. Réessayez dans un instant.",
    "The server is busy. Wait a minute, then try again.": "Le serveur est occupé. Attendez une minute, puis réessayez.",
    "That isn't there any more. Reload the page.": "Ce n'est plus là. Rechargez la page.",
    "Your session ended. Sign in again.": "Votre session a pris fin. Reconnectez-vous.",
    "The server took too long to answer. Try again.": "Le serveur a mis trop de temps à répondre. Réessayez.",
    "Only an admin can do this.": "Seul un admin peut faire ceci.", "Only an admin can change connections.": "Seul un admin peut modifier les connexions.",
    "Welcome.": "Bienvenue.", "steps to your first data. Only the first is needed to start.": "étapes vers vos premières données. Seule la première est nécessaire pour commencer.",
    // signing in again in place, and what a Member can't change
    "Your session ended": "Votre session a pris fin", "Sign in again to carry on. What you were doing is still on the page.": "Reconnectez-vous pour continuer. Ce que vous faisiez est toujours sur la page.",
    "Username or email": "Nom d'utilisateur ou e-mail", "Password": "Mot de passe", "Go to the sign-in page": "Aller à la page de connexion", "Sign in": "Connexion",
    "Enter your username and password.": "Saisissez votre nom d'utilisateur et votre mot de passe.", "That didn't work. Try again.": "Cela n'a pas marché. Réessayez.",
    "Signed in again. Press Save to send what you were doing.": "Reconnecté. Appuyez sur Enregistrer pour envoyer ce que vous faisiez.",
    "Can't reach the app. Check it's running, then try again.": "L'application est injoignable. Vérifiez qu'elle tourne, puis réessayez.",
    "You can see everything here; ask an admin to make a change.": "Vous voyez tout ici ; demandez à un admin pour faire un changement.", "Detail": "Détail",
    // Refresh and free checks on Keywords
    "Retry these": "Relancer ceux-ci", "Only the searches that worked were charged.": "Seules les recherches qui ont marché ont été facturées.",
    "The keyword's own panel shows each failed check.": "Le panneau de chaque mot-clé montre ses contrôles en échec.", "No free checks left for": "Plus de contrôles gratuits pour",
    "keyword waits as Not checked yet.": "mot-clé attend comme Pas encore contrôlé.", "keywords wait as Not checked yet.": "mots-clés attendent comme Pas encore contrôlés.",
    "They don't refill: connect another tool in Settings.": "Ils ne se rechargent pas : connectez un autre outil dans les réglages.",
    "They refill each month, or connect another tool in Settings.": "Ils se rechargent chaque mois, ou connectez un autre outil dans les réglages.", "Open Settings": "Ouvrir les réglages",
    "Several links share these visits, so one link's cost per visit can't be told.": "Plusieurs liens partagent ces visites : le coût par visite d'un seul lien ne peut pas être calculé.",
    "SerpApi goes first for Google while it has free searches: it is the only tool that reads AI Overviews. Then the order below.": "SerpApi passe en premier pour Google tant qu'il a des recherches gratuites : c'est le seul outil qui lit les AI Overviews. Ensuite, l'ordre ci-dessous.",
    "Checked recently with this tool, so not checked again. Press again to spend a credit anyway.": "Contrôlé récemment avec cet outil, donc pas contrôlé à nouveau. Appuyez encore pour dépenser un crédit quand même.",
    "Check again? 1 credit": "Contrôler encore ? 1 crédit",
    // Settings → the Claude (Anthropic) row and its panel
    "Claude for Search insights: explanations, new titles, content briefs and FAQs": "Claude pour les analyses de recherche : explications, nouveaux titres, briefs et FAQ",
    "Pay as you go, a few cents an answer": "À l'usage, quelques centimes par réponse", "Your monthly cap in Settings → AI": "Votre plafond mensuel dans Réglages → IA",
    "Off until you paste a key, and used only by sites set to Claude under AI. Only a click asks, each answer is kept, and nothing is sent once the month's cap is reached.": "Désactivé tant que vous ne collez pas de clé, et utilisé seulement par les sites réglés sur Claude dans IA. Seul un clic l'interroge, chaque réponse est gardée, et rien n'est envoyé une fois le plafond du mois atteint.",
    "Create an account": "Créer un compte", "Create an account in the Claude Console and add a little credit.": "Créez un compte dans la Claude Console et ajoutez un peu de crédit.", "Open the Claude Console": "Ouvrir la Claude Console",
    "Create the key": "Créer la clé", "Open API keys and create a key. You can give its workspace a spending limit too.": "Ouvrez API keys et créez une clé. Vous pouvez aussi fixer une limite de dépense à son espace de travail.", "Open API keys": "Ouvrir API keys",
    "Paste it here": "Collez-la ici", "Paste it here, press Test, then Save. Test lists Claude's models, which costs nothing. Then pick Claude for a site under AI.": "Collez-la ici, appuyez sur Tester, puis Enregistrer. Le test liste les modèles de Claude, ce qui ne coûte rien. Choisissez ensuite Claude pour un site dans IA.",
    "Your own site, or a competitor to watch": "Votre propre site, ou un concurrent à surveiller",
    // the server's own sentences for a failed request (seo/web/__init__.py API_ERROR_WORDS)
    "The app couldn't read that request. Reload the page and try again.": "L'application n'a pas pu lire cette demande. Rechargez la page et réessayez.",
    "Please sign in.": "Veuillez vous connecter.", "You can't do that with this account.": "Ce compte ne permet pas de faire cela.", "That address isn't part of the app.": "Cette adresse ne fait pas partie de l'application.",
    "That address doesn't take this kind of request.": "Cette adresse n'accepte pas ce type de demande.", "Someone else changed this at the same time. Reload and try again.": "Quelqu'un d'autre a modifié ceci en même temps. Rechargez et réessayez.",
    "Too many requests at once. Wait a minute, then try again.": "Trop de demandes à la fois. Attendez une minute, puis réessayez.",
    "Something went wrong on the server. Try again; if it keeps happening, tell your admin.": "Un problème est survenu sur le serveur. Réessayez ; si cela continue, prévenez votre admin.",
    "The server didn't answer. Try again in a minute.": "Le serveur n'a pas répondu. Réessayez dans une minute.", "The server is busy. Try again in a minute.": "Le serveur est occupé. Réessayez dans une minute.",
    "All countries": "Tous pays", "It may have been charged, so a Retry spends again.": "Elle a peut-être été facturée : relancer dépense à nouveau.",
    // the shared date range
    "vs": "vs", "Dates": "Dates", "This month": "Ce mois-ci", "Last month": "Mois dernier", "Last 24 hours": "Dernières 24 heures", "Last 7 days": "7 derniers jours", "Last 28 days": "28 derniers jours",
    "Last 3 months": "3 derniers mois", "Last 6 months": "6 derniers mois", "Last 12 months": "12 derniers mois", "Last 16 months": "16 derniers mois", "vs same period last year": "vs même période l'an dernier",
    "No comparison: Search Console doesn't keep that far back.": "Sans comparaison : la Search Console ne remonte pas aussi loin.",
    // Keywords
    "28 days": "28 jours", "Impressions (28 days)": "Impressions (28 jours)", "Last check": "Dernier contrôle", "No check yet": "Aucun contrôle pour l'instant",
    "Lost track of this Refresh": "Le suivi de cette actualisation s'est arrêté", "Whatever was checked is saved. Reload the page to see it.": "Tout ce qui a été contrôlé est enregistré. Rechargez la page pour le voir.",
    "Search keywords": "Chercher un mot-clé", "No keyword matches this search.": "Aucun mot-clé ne correspond à cette recherche.", "Clear the search": "Effacer la recherche",
    "Showing": "Affichés", "Rows per page": "Lignes par page", "Previous": "Précédent", "Next": "Suivant", "Page": "Page", "of": "sur",
  };
  window.FR = window.FR || {};
  Object.keys(FR).forEach((w) => { if (window.FR[w] === undefined) window.FR[w] = FR[w]; });

  /* ---- helpers ---------------------------------------------------------------------------------------------- */
  const retries = new Map();
  let retryId = 0;

  function install(UI) {
    const { t, esc, icon } = UI;
    const fr = () => UI.state.lang === "fr";

    UI.def = (name) => { const d = DEFS[name]; return d ? d[fr() ? 1 : 0] : ""; };
    // The English key of a label already translated, so a label in either language finds its definition.
    const keyOf = (label) => {
      const plain = String(label || "").replace(/<[^>]*>/g, "").split("·")[0].trim();
      if (DEFS[plain]) return plain;
      return Object.keys(DEFS).find((k) => window.FR[k] === plain) || "";
    };
    UI.defKey = keyOf;
    UI.defIcon = (name) => {
      const key = DEFS[name] ? name : keyOf(name), text = key ? UI.def(key) : "";
      if (!text) return "";
      return `<span class="def-i" role="img" tabindex="0" data-tip="${esc(text)}" aria-label="${esc(`${t(key)}: ${text}`)}">${icon("info")}</span>`;
    };

    UI.errorWords = (err) => {
      const message = typeof err === "string" ? err : err?.message || "";
      const code = typeof err === "object" && err ? err.status : undefined;
      if (code === 0 || /failed to fetch|networkerror|load failed|network request failed/i.test(message)) return t("The server can't be reached. Check the connection, then try again.");
      if (code === 429 || /too many requests|^error 429$/i.test(message)) return t("The server is busy. Wait a minute, then try again.");
      if (/^(internal server error|error 50\d|bad gateway|service unavailable|gateway time-?out)$/i.test(message.trim()) || (code >= 500 && !message)) return t("Something went wrong on the server. Try again in a moment.");
      if (/^error 404$|^not found$/i.test(message.trim())) return t("That isn't there any more. Reload the page.");
      if (/^(timeout|timed out|request timed out|the read operation timed out)\.?$/i.test(message.trim())) return t("The server took too long to answer. Try again.");
      return t(message || "Something went wrong on the server. Try again in a moment.");
    };

    UI.failCard = (err, { title = "That didn't load", onRetry = null, retry = "", action = "" } = {}) => {
      let attr = retry;
      if (!attr && onRetry) { retryId += 1; retries.set(String(retryId), onRetry); attr = `data-ui-retry="${retryId}"`; }
      const button = attr ? `<button class="btn" ${attr}>${icon("refresh-cw")}${t("Try again")}</button>` : "";
      return `<section class="card fail-card" role="alert"><div class="empty"><h3>${esc(t(title))}</h3><p>${esc(UI.errorWords(err))}</p>${button || action ? `<div class="fail-acts">${button}${action}</div>` : ""}</div></section>`;
    };

    UI.skeleton = (kind = "page", { tiles = 4, rows = 6, chart = true, label = "Loading…" } = {}) => {
      const tileHtml = `<div class="sk-tiles">${'<div class="sk-tile"><i class="sk-bar w40"></i><i class="sk-bar sk-big w60"></i><i class="sk-bar w30"></i></div>'.repeat(tiles)}</div>`;
      const chartHtml = '<div class="sk-card sk-chart"><i class="sk-bar w30"></i><div class="sk-area"></div></div>';
      const rowHtml = (n) => `<div class="sk-rows">${Array.from({ length: n }, (_, i) => `<div class="sk-row"><i class="sk-bar w${[50, 40, 60, 45, 55, 35][i % 6]}"></i><i class="sk-bar w10"></i><i class="sk-bar w10"></i><i class="sk-bar w15"></i></div>`).join("")}</div>`;
      const body = kind === "tiles" ? tileHtml
        : kind === "chart" ? chartHtml
          : kind === "rows" ? rowHtml(rows)
            : kind === "table" ? `<div class="sk-card">${rowHtml(rows)}</div>`
              : kind === "panel" ? `<div class="sk-panel">${'<i class="sk-bar w60"></i><i class="sk-bar w90"></i><i class="sk-bar w80"></i>'.repeat(3)}</div>`
                : `${tileHtml}${chart ? chartHtml : ""}<div class="sk-card">${rowHtml(rows)}</div>`;
      return `<div class="sk sk-${kind}" aria-busy="true" role="status"><span class="sr">${esc(t(label))}</span>${body}</div>`;
    };

    const role = () => window.BOOT?.user?.role || window.ME?.role || null;
    UI.canAdmin = () => !window.BOOT?.user || role() === "admin";
    UI.adminOnly = (why = "Only an admin can do this.") => (UI.canAdmin() ? "" : `disabled aria-disabled="true" data-tip="${esc(t(why))}" title="${esc(t(why))}"`);

    document.addEventListener("click", (e) => {
      const el = e.target.closest?.("[data-ui-retry]");
      if (!el) return;
      const fn = retries.get(el.dataset.uiRetry);
      if (fn) { el.disabled = true; try { fn(); } catch (err) { console.error(err); } }
    });
  }

  window.SHARED_UI = { install, DEFS };
})();
