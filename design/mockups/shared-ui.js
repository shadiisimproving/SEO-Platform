/* Shared pieces every screen can use, put on window.UI by mockup.js (window.SHARED_UI.install):

     UI.skeleton(kind, opts)          grey shapes of the page while it loads, instead of one "Loading…" card.
                                      kind: "page" (tiles, chart, table), "tiles", "chart", "table", "rows", "panel".
                                      opts: { tiles: 4, rows: 6, chart: true, label: "Loading…" }
     UI.failCard(err, opts)           a card that says what failed in plain words, with Try again where it shows.
                                      opts: { title, onRetry: () => …, retry: "data-attr-name", action: "<extra button html>" }
     UI.errorWords(errOrMessage)      a sentence for a person, never "Internal Server Error", "Failed to fetch" or "Error 429".
                                      A search tool's own error becomes a few words ("Key refused"); UI.errorParts(err) also
                                      gives the whole sentence, and UI.errorHtml(err) puts it behind (i).
     UI.stepLink(step)                a How to connect step's link; with step.logo, the brand's logo and ↗, words as tooltip.
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
    Tracked: ["Keywords you follow on this site. DuckDuckGo positions are checked by themselves every day, and the other engines when you press Refresh.", "Mots-clés suivis sur ce site. Les positions DuckDuckGo sont vérifiées toutes seules chaque jour, et les autres moteurs quand vous appuyez sur Actualiser."],
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
    "Server unreachable. Check the connection, then try again.": "Serveur injoignable. Vérifiez la connexion, puis réessayez.",
    "Something went wrong on the server. Try again.": "Un problème est survenu sur le serveur. Réessayez.",
    "Server busy. Try again in a minute.": "Serveur occupé. Réessayez dans une minute.",
    "No longer there. Reload the page.": "N'existe plus. Rechargez la page.",
    "Session ended. Sign in again.": "Session terminée. Reconnectez-vous.",
    "The server took too long. Try again.": "Le serveur a mis trop de temps. Réessayez.",
    "Only an admin can do this.": "Seul un admin peut faire ceci.", "Only an admin can change connections.": "Seul un admin peut modifier les connexions.",
    "Welcome.": "Bienvenue.", "steps to your first data. Only step 1 is required.": "étapes vers vos premières données. Seule la 1re est requise.",
    // signing in again in place, and what a Member can't change
    "Session ended": "Votre session a pris fin", "Sign in again to carry on. Your work is still here.": "Reconnectez-vous pour continuer. Votre travail est toujours là.",
    "Username or email": "Nom d'utilisateur ou e-mail", "Password": "Mot de passe", "Go to the sign-in page": "Aller à la page de connexion", "Sign in": "Connexion",
    "Enter your username and password.": "Saisissez votre nom d'utilisateur et votre mot de passe.", "That didn't work. Try again.": "Cela n'a pas marché. Réessayez.",
    "Signed in again. Press Save to send your change.": "Reconnecté. Appuyez sur Enregistrer pour envoyer votre modification.",
    "Can't reach the app. Check it's running, then try again.": "L'application est injoignable. Vérifiez qu'elle tourne, puis réessayez.",
    "View only: ask an admin for changes.": "Lecture seule : demandez les changements à un admin.", "Detail": "Détail",
    // Refresh and free checks on Keywords
    "Retry": "Relancer ceux-ci", "Only successful searches were charged.": "Seules les recherches réussies ont été facturées.",
    "The keyword's own panel shows each failed check.": "Le panneau de chaque mot-clé montre ses contrôles en échec.", "No free checks left for": "Plus de contrôles gratuits pour",
    "keyword stays Not checked.": "mot-clé reste Non contrôlé.", "keywords stay Not checked.": "mots-clés restent Non contrôlés.",
    "They don't refill; connect another tool in Settings.": "Ils ne se rechargent pas ; connectez un autre outil dans les réglages.",
    "They refill monthly, or connect another tool in Settings.": "Ils se rechargent chaque mois, ou connectez un autre outil dans les réglages.", "Open Settings": "Ouvrir les réglages",
    "Several links share these visits, so no single cost per visit.": "Plusieurs liens partagent ces visites : pas de coût par visite pour un seul lien.",
    "SerpApi first while it has free searches, then the order below.": "SerpApi d'abord tant qu'il a des recherches gratuites, puis l'ordre ci-dessous.",
    "Checked recently with this tool. Press again to spend a credit anyway.": "Contrôlé récemment avec cet outil. Appuyez encore pour dépenser un crédit quand même.",
    "Check again? 1 credit": "Contrôler encore ? 1 crédit",
    // Settings → the Claude (Anthropic) row and its panel
    "Claude for Search insights: explanations, new titles, content briefs and FAQs": "Claude pour les analyses de recherche : explications, nouveaux titres, briefs et FAQ",
    "A few cents per answer": "Quelques centimes par réponse", "Monthly cap: Settings → AI": "Plafond mensuel : Réglages → IA",
    "Off without a key. Only sites set to Claude under AI use it.": "Désactivé sans clé. Seuls les sites réglés sur Claude dans IA l'utilisent.",
    "Create an account": "Créer un compte", "Create an account and add a little credit.": "Créez un compte et ajoutez un peu de crédit.", "Open the Claude Console": "Ouvrir la Claude Console",
    "Create the key": "Créer la clé", "In API keys, create a key. Optional: a spending limit on its workspace.": "Dans API keys, créez une clé. En option : une limite de dépense pour son espace de travail.", "API keys": "Clés API",
    "Paste it here": "Collez-la ici", "Paste it, press Test (free), then Save. Then pick Claude for a site under AI.": "Collez-la, cliquez sur Tester (gratuit), puis Enregistrer. Choisissez ensuite Claude pour un site dans IA.",
    "Yours, or a competitor to watch": "Le vôtre, ou un concurrent à surveiller",
    // the server's own sentences for a failed request (seo/web/__init__.py API_ERROR_WORDS)
    "Couldn't read that request. Reload and try again.": "L'application n'a pas pu lire cette demande. Rechargez la page et réessayez.",
    "Please sign in.": "Veuillez vous connecter.", "You can't do that with this account.": "Ce compte ne permet pas de faire cela.", "That address isn't part of the app.": "Cette adresse ne fait pas partie de l'application.",
    "That address doesn't take this kind of request.": "Cette adresse n'accepte pas ce type de demande.", "Someone else changed this meanwhile. Reload and try again.": "Quelqu'un d'autre l'a modifié entre-temps. Rechargez et réessayez.",
    "Too many requests. Try again in a minute.": "Trop de demandes. Réessayez dans une minute.",
    "Something went wrong on the server. Try again, or tell your admin.": "Un problème est survenu sur le serveur. Réessayez, ou prévenez votre admin.",
    "The server didn't answer. Try again in a minute.": "Le serveur n'a pas répondu. Réessayez dans une minute.", 
    "All countries": "Tous pays", "May have been charged: a Retry spends again.": "Peut-être facturée : relancer dépense à nouveau.",
    // a search tool's error in a few words (UI.errorParts)
    "Empty answer ({code})": "Réponse vide ({code})", "Server error ({code})": "Erreur serveur ({code})", "Refused ({code})": "Refusé ({code})",
    "Timed out": "Délai dépassé", "Request failed": "Requête échouée", "Key refused": "Clé refusée", "Out of credits": "Plus de crédits",
    "Stopped: asked to slow down": "Arrêté : demande de ralentir",
    // the shared date range
    "vs": "vs", "Dates": "Dates", "This month": "Ce mois-ci", "Last month": "Mois dernier", "Last 24 hours": "Dernières 24 heures", "Last 7 days": "7 derniers jours", "Last 28 days": "28 derniers jours",
    "Last 3 months": "3 derniers mois", "Last 6 months": "6 derniers mois", "Last 12 months": "12 derniers mois", "Last 16 months": "16 derniers mois", "vs last year": "vs l'an dernier",
    "No comparison: Search Console doesn't keep that far back.": "Sans comparaison : la Search Console ne remonte pas aussi loin.",
    // Keywords
    "28 days": "28 jours", "Impressions (28 days)": "Impressions (28 jours)", "Last check": "Dernier contrôle", "No check yet": "Aucun contrôle pour l'instant",
    "Lost track of this Refresh": "Le suivi de cette actualisation s'est arrêté", "Progress is saved. Reload to see it.": "La progression est enregistrée. Rechargez pour la voir.",
    "Search keywords": "Chercher un mot-clé", "No keyword matches.": "Aucun mot-clé ne correspond.", "Clear search": "Effacer la recherche",
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
    // A short line on screen, the full sentence one hover or tap away: `${t("Short.")}${UI.tip("The long sentence.")}`.
    // The sentence goes through t(), so its French comes from the dictionaries (fr-short.js holds the tip sentences).
    UI.tip = (sentence, vars = null) => {
      if (!sentence) return "";
      let text = t(sentence);
      if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
      return ` <span class="def-i" role="img" tabindex="0" data-tip="${esc(text)}" aria-label="${esc(text)}">${icon("info")}</span>`;
    };
    // A brand shown by its logo alone, where its name would repeat on every row: the name stays in the tooltip and for
    // screen readers. Falls back to the plain name when the brand has no logo (brands.js FILES).
    UI.logoOnly = (brand, tip = "") => {
      const file = window.BRANDS?.FILES?.[brand];
      const label = tip || brand;
      if (!file) return `<span>${esc(brand)}</span>`;
      return `<span class="brand-mention logo-only" title="${esc(label)}" data-tip="${esc(label)}"><img class="logo brand-logo" src="logos/${file}" alt="${esc(label)}"></span>`;
    };
    // A How to connect step's link ({ url, link, logo }). With `logo`, the link only names that brand, so it shows the
    // brand's logo and ↗, and its words ("Open Search Console") are the tooltip and what a screen reader says.
    // When the step's own sentence already names the brand (it gets its logo there), the link is ↗ alone: one logo, not two.
    UI.stepLink = (s, fallback = "Open") => {
      if (!s?.url) return "";
      const words = t(s.link || fallback), attrs = `href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"`;
      if (s.logo && window.BRANDS?.FILES?.[s.logo]) {
        const named = s.text && t(s.text).includes(s.logo);
        return `<a class="ext-link logo-link" ${attrs} aria-label="${esc(words)}" data-tip="${esc(words)}"${named ? ' style="min-width:24px;min-height:24px;justify-content:center"' : ""}>${named ? "" : UI.logoOnly(s.logo, words)}<span aria-hidden="true">↗</span></a>`;
      }
      return `<a class="ext-link" ${attrs}>${icon("external-link")}${esc(words)}</a>`;
    };

    /* A search tool's own error in a few words: "Bright Data answered 200 without data." → "Empty answer (200)". The row
       already says which tool, so the name goes; the whole sentence stays for a tooltip (UI.errorParts, UI.errorHtml).
       [pattern, short words, the whole sentence in French built from the pattern's parts] */
    const TOOL_ERRORS = [
      [/^(.*?) ?\banswered (\d{3}) without data\.?$/, (m) => fill("Empty answer ({code})", m[2]), (m) => `${m[1]} a répondu ${m[2]} sans données.`],
      [/^(.*?) ?\banswered (5\d\d)(?: \(([^)]*)\))?\.?$/, (m) => fill("Server error ({code})", m[2]), (m) => `${m[1]} a répondu ${m[2]}${m[3] ? ` (${m[3]})` : ""}.`],
      [/^(.*?) ?\banswered (4\d\d)(?: \(([^)]*)\))?\.?$/, (m) => fill("Refused ({code})", m[2]), (m) => `${m[1]} a répondu ${m[2]}${m[3] ? ` (${m[3]})` : ""}.`],
      [/^The request failed: (\w*Timeout\w*)$/, () => t("Timed out"), (m) => `La requête a échoué : ${m[1]}`],
      [/^The request failed: (\w+)$/, () => t("Request failed"), (m) => `La requête a échoué : ${m[1]}`],
      [/^(.*?) ?\brefused the key( or the zone name)?\.$/, () => t("Key refused"), (m) => `${m[1]} a refusé la clé${m[2] ? " ou le nom de la zone" : ""}.`],
      [/^(.*?) ?\bhas no (free searches|credits) left(?: for now)?\.$/, () => t("Out of credits"), (m) => (m[2] === "credits" ? `${m[1]} n'a plus de crédits.` : `${m[1]} n'a plus de recherches gratuites pour l'instant.`)],
      [/^(.*?) ?\basked us to slow down, so this tool stopped\.$/, () => t("Stopped: asked to slow down"), (m) => `${m[1]} a demandé de ralentir : cet outil s'est arrêté.`],
    ];
    const fill = (words, code) => t(words).split("{code}").join(code);
    // A caller may hand over the sentence already in French: its English is what the patterns read.
    const englishOf = (text) => (fr() && !TOOL_ERRORS.some(([re]) => re.test(text)) ? Object.keys(window.FR).find((k) => window.FR[k] === text) || text : text);
    const toolError = (message) => {
      const english = englishOf(message.trim());
      for (const [re, words, frFull] of TOOL_ERRORS) {
        const m = english.match(re);
        if (!m) continue;
        const full = !fr() ? english : window.FR[english] !== undefined ? window.FR[english] : frFull(m).trim();
        return { words: words(m), full };
      }
      return null;
    };

    // { words, full }: the plain words to show, and the tool's whole sentence when the words shortened it ("" otherwise).
    UI.errorParts = (err) => {
      const message = typeof err === "string" ? err : err?.message || "";
      const code = typeof err === "object" && err ? err.status : undefined;
      const plain = (key) => ({ words: t(key), full: "" });
      if (code === 0 || /failed to fetch|networkerror|load failed|network request failed/i.test(message)) return plain("Server unreachable. Check the connection, then try again.");
      if (code === 429 || /too many requests|^error 429$/i.test(message)) return plain("Server busy. Try again in a minute.");
      if (/^(internal server error|error 50\d|bad gateway|service unavailable|gateway time-?out)$/i.test(message.trim()) || (code >= 500 && !message)) return plain("Something went wrong on the server. Try again.");
      if (/^error 404$|^not found$/i.test(message.trim())) return plain("No longer there. Reload the page.");
      if (/^(timeout|timed out|request timed out|the read operation timed out)\.?$/i.test(message.trim())) return plain("The server took too long. Try again.");
      return (message && toolError(message)) || plain(message || "Something went wrong on the server. Try again.");
    };
    UI.errorWords = (err) => UI.errorParts(err).words;
    // The same as HTML: the words, and the whole sentence behind (i) when they shortened it.
    UI.errorHtml = (err) => { const { words, full } = UI.errorParts(err); return `${esc(words)}${full ? UI.tip(full) : ""}`; };

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
