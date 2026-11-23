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
     UI.card(opts)                    one number card, the same on every screen (simpler screens). API below.
     UI.info(text, opts)              the (i) that holds caveats, sources and how it works (simpler screens). API below.

   The metric definitions are written once, here, in English and French (window.METRIC_DEFS).

   ---- The number card and the (i): the API the screens call (plan-seo-command-center-simplify-screens-like-mickaz.md, 3.2, 3.3)
   Both are for the simpler screens. Their CSS (screen-parts.css, look-clear.css) only applies under html[data-simple="1"], so a
   screen draws them only when UI.simple() is on, and keeps its old markup otherwise. Both return an HTML string for setHTML.
   Words are English and go through t(). Strings marked HTML are inserted as they are: esc() anything that came from data.

   UI.card({ id, label, value, format, change, sub, spark, def, info, href, button, toggle, tall, cls, attrs })
     id      "visits"            data-card="visits" on the card: the hook screens and flows use.
     label   "Visits"            HTML. One line, cut with "…" when long.
     value   7921                a number, shown with `format`; a whole number counts up when the page opens.
             null                unknown: "—" in grey, never 0 (MASTER). Say why in `sub`.
             "<span>…</span>"    or ready HTML, such as a word ("Not set up") or UI.cnt(n).
     format  "num"               numbers on the figure, in "before → now" and on the graph's days: "num" 1,706 / 1 706 (the
                                 default), "dec" one decimal (8.3), "pct" one decimal and a % (4.5%), or (n) => text.
     change  { now, before, unit, lowerIsBetter, value }
                                 the pill beside the figure ("↑ +2% better") and "before → now" as the sub line. unit: "%" for
                                 counts (the default), "pts" for rates, "places" for a position (lower is better by itself), ""
                                 for the plain difference (leads). value: the change already worked out (now against before, in
                                 that unit) when there's no `before`, as Today's server gives it. lowerIsBetter: down is better.
     sub     "of 10 · Google"    HTML for the sub line instead of "before → now": one short fact, the reason a number is
                                 unknown, or one .link-btn. A link, button or switch card holds no other control: text only there.
     spark   { now: [...], before: [...], days: ["2026-10-12", ...], invert, marks, marksBefore }   or just [...] (this period only)
             marks / marksBefore: [true, false, ...] per day: a dot on that day of the line (an unusual day)
                                 the card's own graph: this period in the card's colour, the period before dashed grey, on one
                                 scale. null in a list leaves a gap. invert: lower is better (position). Under 2 points: no
                                 graph. Hover, a tap or the arrow keys read one day in the sub line ("12 Oct · 325 · before
                                 310"); Escape, or leaving, puts the line back.
     def     "AI lead rate"      the metric whose definition the (i) after the label shows, when the label isn't its name.
                                 false: none. By default the label's own (UI.def), as UI.tile does.
     info    "Graph: running total."   a caveat (or a list) for the same (i), after the definition.
     href    "#channels"         the whole card is a link.
     button  true                the whole card is a button: the screen handles the click through `attrs`.
     toggle  { pressed, color }  the whole card switches a chart line: aria-pressed, a dot before the label, and when pressed
                                 a 3 px top line in `color`, the line's series colour ("var(--ch-1)"; default the card's own).
     tall    true                Today: a 64 px graph, with its first and last day under it.
     cls     "tile today-num"    more classes, so the old hooks keep working during the review.
     attrs   { "data-ov-line": "clicks", "aria-label": "…" }   more attributes, escaped; true writes the name alone.
     A row of cards goes in the existing .tiles grid. While a new period loads, .is-updating on a parent makes the figures pulse.
     Example: UI.card({ id: "visits", label: "Visits", value: 7921, change: { now: 7921, before: 7750 }, spark: { now, before, days } })

   UI.info(text, { vars })
     text    "Google Analytics hid some rows with few visits."   or a list, one caveat a line. "" or [] draws nothing, so a
             screen can always call it.
     vars    { n: 3 }            fills {n} after the translation, as UI.tip does.
     The same mark as UI.defIcon (.def-i, a 24 px target): focusable, its words on hover, keyboard focus or a tap; Escape
     closes them. It goes at the end of the date line and in card heads.
     Example: `<p class="head-line">…${UI.info(["Counts only: no personal data comes into this app."])}</p>` */
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
    "SerpApi first while it has free searches, then the order below.": "SerpApi d'abord tant qu'il a des recherches gratuites, puis l'ordre ci-dessous.", "Tools that read AI Overviews go first: Semscraper when its paid use is on, SerpApi while it has free searches. Then the order below.": "Les outils qui lisent les aperçus IA passent en premier : Semscraper quand son usage payant est activé, SerpApi tant qu'il a des recherches gratuites. Puis l'ordre ci-dessous.",
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
    "vs": "vs", "Dates": "Dates", "This month": "Ce mois-ci", "Last month": "Mois dernier", "Last 24 hours": "Dernières 24 heures", "Last {n} saved days": "{n} jours enregistrés", "Last 7 days": "7 derniers jours", "Last 28 days": "28 derniers jours",
    "Last 3 months": "3 derniers mois", "Last 6 months": "6 derniers mois", "Last 12 months": "12 derniers mois", "Last 16 months": "16 derniers mois", "vs last year": "vs l'an dernier",
    "No comparison: Search Console doesn't keep that far back.": "Sans comparaison : la Search Console ne remonte pas aussi loin.",
    // Keywords
    "28 days": "28 jours", "Impressions (28 days)": "Impressions (28 jours)", "Last check": "Dernier contrôle", "No check yet": "Aucun contrôle pour l'instant",
    "Lost track of this Refresh": "Le suivi de cette actualisation s'est arrêté", "Progress is saved. Reload to see it.": "La progression est enregistrée. Rechargez pour la voir.",
    "Search keywords": "Chercher un mot-clé", "No keyword matches.": "Aucun mot-clé ne correspond.", "Clear search": "Effacer la recherche",
    "Showing": "Affichés", "Rows per page": "Lignes par page", "Previous": "Précédent", "Next": "Suivant", "Page": "Page", "of": "sur",
    // the number card's graph, for screen readers (UI.card)
    "Graph of this period, with the period before dashed. The arrow keys read each day.": "Graphique de cette période, la période précédente en pointillés. Les flèches lisent chaque jour.",
    "Graph of this period. The arrow keys read each day.": "Graphique de cette période. Les flèches lisent chaque jour.",
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
      return `<span class="brand-mention logo-only" title="${esc(label)}" data-tip="${esc(label)}"><img class="logo brand-logo" src="logos/${file}" width="16" height="16" alt="${esc(label)}"></span>`;
    };
    // A How to connect step's link ({ url, link, logo }). With `logo`, the link only names that brand, so it shows the
    // brand's logo and name with its words ("Open [logo] Search Console"): a link's only label is never a bare logo.
    // When the step's own sentence already names the brand (it gets its logo there), the link is ↗ alone: one logo, not two.
    UI.stepLink = (s, fallback = "Open") => {
      if (!s?.url) return "";
      const words = t(s.link || fallback), attrs = `href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"`;
      if (s.logo && window.BRANDS?.FILES?.[s.logo]) {
        const named = s.text && t(s.text).includes(s.logo);
        // The link's own words name the brand ("Open Search Console"), so brands.js puts its logo beside the name.
        if (!named) return `<a class="ext-link" ${attrs}>${icon("external-link")}${esc(words)}</a>`;
        return `<a class="ext-link logo-link" ${attrs} aria-label="${esc(words)}" data-tip="${esc(words)}" style="min-width:24px;min-height:24px;justify-content:center"><span aria-hidden="true">↗</span></a>`;
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
      // Chosen access (access.js): never a fault, just not theirs.
      if (typeof err === "object" && err && (err.noAccess || err.data?.no_access)) return plain(/^View only/.test(message) ? "View only: you can't change this." : "You don't have access to this.");
      // Busy is our own server's 429. A sentence that names who asked to slow down ("Too many requests to Anthropic…") keeps its words.
      const named = /too many requests (?:to|from|at) \S|trop de requêtes (?:chez|de|à) \S/i.test(message);
      if (!named && (code === 429 || /too many requests|^error 429$/i.test(message))) return plain("Server busy. Try again in a minute.");
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

    /* ---- the (i) of the simpler screens: caveats, sources and how it works (API at the top of this file) ------------------ */
    const plain = (html) => String(html ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    const withVars = (text, vars) => {
      let out = t(text);
      if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
      return out;
    };
    const sentences = (text, vars = null) => (Array.isArray(text) ? text : [text]).filter((s) => s !== null && s !== undefined && String(s).trim()).map((s) => withVars(String(s).trim(), vars));
    UI.info = (text, { vars = null } = {}) => {
      const words = sentences(text, vars);
      if (!words.length) return "";
      return `<span class="def-i info-i" role="img" tabindex="0" data-tip="${esc(words.join("\n"))}" aria-label="${esc(words.join(" "))}">${icon("info")}</span>`;
    };

    /* ---- the number card of the simpler screens (API at the top of this file) --------------------------------------------- */
    // Its own words: another screen's French for "worse" ("pire") must not reach it. The plan says mieux and moins bien.
    const CARD_WORDS = { better: ["better", "mieux"], worse: ["worse", "moins bien"], same: ["No change", "Sans changement"], before: ["before", "avant"], place: ["place", "place"], places: ["places", "places"], pts: ["pts", "pts"] };
    const cardWord = (key) => CARD_WORDS[key][fr() ? 1 : 0];
    const isNum = (v) => v !== null && v !== undefined && v !== "" && typeof v !== "boolean" && Number.isFinite(Number(v));
    const oneDecimal = (n) => new Intl.NumberFormat(UI.locale(), { maximumFractionDigits: 1 }).format(n);
    const percentSign = () => (fr() ? " %" : "%"); // French puts a space before %, as Today and Overview do
    const CARD_FORMATS = { num: (n) => UI.num(n), dec: oneDecimal, pct: (n) => `${oneDecimal(n)}${percentSign()}` };
    const cardFormat = (format) => (typeof format === "function" ? format : CARD_FORMATS[format] || CARD_FORMATS.num);

    // The pill beside the figure, and "before → now" for the sub line. Counts change in %, rates in points, a position in places.
    function cardChange(change, show) {
      if (!change || typeof change !== "object") return { pill: "", sub: "" };
      const unit = change.unit ?? "%", lower = change.lowerIsBetter ?? unit === "places";
      const now = isNum(change.now) ? Number(change.now) : null, before = isNum(change.before) ? Number(change.before) : null;
      let diff = isNum(change.value) ? Number(change.value) : null;
      if (diff === null && now !== null && before !== null) {
        if (unit === "%") diff = before ? Math.round(((now - before) / Math.abs(before)) * 100) : null;
        else if (unit === "pts" || unit === "places") diff = Math.round((now - before) * 10) / 10;
        else diff = now - before;
      }
      const sub = now !== null && before !== null ? `${esc(show(before))} → ${esc(show(now))}` : "";
      if (diff === null) return { pill: "", sub };
      if (diff === 0) return { pill: `<span class="sec d-pill">${esc(cardWord("same"))}</span>`, sub };
      const better = lower ? diff < 0 : diff > 0, size = Math.abs(diff), sign = diff > 0 ? "+" : "−";
      const amount = unit === "places" ? `${oneDecimal(size)} ${cardWord(size === 1 ? "place" : "places")}`
        : unit === "%" ? `${sign}${UI.num(size)}${percentSign()}`
          : unit === "pts" ? `${sign}${oneDecimal(size)} ${cardWord("pts")}`
            : `${sign}${show(size)}`;
      // A position goes up the page when it gets better, so its arrow follows better and worse. Every other arrow follows the number.
      const up = unit === "places" ? better : diff > 0;
      return { pill: `<span class="${better ? "good" : "crit"} d-pill">${icon(up ? "arrow-up" : "arrow-down")}${esc(amount)} ${esc(cardWord(better ? "better" : "worse"))}</span>`, sub };
    }

    // A smooth line through the points, gentle enough not to overshoot them much (as mockup.js draws its sparklines).
    function smoothPath(pts) {
      const at = ([x, y]) => `${x.toFixed(2)},${y.toFixed(1)}`;
      if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"}${at(p)}`).join("");
      let d = `M${at(pts[0])}`;
      const k = 0.16;
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i - 1] || pts[i], [x1, y1] = pts[i], [x2, y2] = pts[i + 1], [x3, y3] = pts[i + 2] || pts[i + 1];
        d += `C${at([x1 + (x2 - x0) * k, y1 + (y2 - y0) * k])} ${at([x2 - (x3 - x1) * k, y2 - (y3 - y1) * k])} ${at([x2, y2])}`;
      }
      return d;
    }
    const dayWords = (day) => {
      const s = String(day ?? "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return UI.fmtDay(s, { day: "numeric", month: "short" });
      if (/^\d{4}-\d{2}-\d{2}[T ]\d/.test(s)) { // an hour, on a Last 24 hours period
        const when = new Date(s.replace(" ", "T"));
        return Number.isNaN(when.getTime()) ? s : new Intl.DateTimeFormat(UI.locale(), { hour: "2-digit", minute: "2-digit" }).format(when);
      }
      return s;
    };

    /* The card's own graph: this period and the period before, on one scale, no axes. Each day's words and the points' heights
       ride along in data- attributes, so reading a day needs nothing but the markup (it survives any redraw). */
    function cardGraph(spark, { name, show, tall, own }) {
      const s = Array.isArray(spark) ? { now: spark } : spark && typeof spark === "object" ? spark : null;
      if (!s) return "";
      const clean = (list) => (Array.isArray(list) ? list : []).map((v) => (isNum(v) ? Number(v) : null));
      const now = clean(s.now), was = clean(s.before), hasWas = was.some((v) => v !== null);
      if (now.filter((v) => v !== null).length < 2) return "";
      const n = Math.max(now.length, hasWas ? was.length : 0);
      const H = tall ? 64 : 36, PAD = 3;
      const all = [...now, ...was].filter((v) => v !== null);
      let lo = Math.min(...all), hi = Math.max(...all);
      if (hi === lo) { lo -= 1; hi += 1; } // a flat line sits in the middle
      const x = (i) => (i / (n - 1)) * 100;
      const y = (v) => { const f = (v - lo) / (hi - lo); return PAD + (s.invert ? f : 1 - f) * (H - PAD * 2); };
      const runs = (list) => { // a gap (null) breaks the line
        const out = [];
        let run = [];
        list.forEach((v, i) => { if (v === null) { if (run.length) out.push(run); run = []; } else run.push([x(i), y(v)]); });
        if (run.length) out.push(run);
        return out;
      };
      const lines = (list) => runs(list).map((r) => (r.length === 1 ? `M${r[0][0].toFixed(2)},${r[0][1].toFixed(1)}h.01` : smoothPath(r))).join("");
      const area = runs(now).filter((r) => r.length > 1).map((r) => `${smoothPath(r)}L${r[r.length - 1][0].toFixed(2)},${H}L${r[0][0].toFixed(2)},${H}Z`).join("");
      const days = Array.isArray(s.days) ? s.days : [];
      const said = (v) => (v === null || v === undefined ? "—" : show(v));
      const read = Array.from({ length: n }, (_, i) => [dayWords(days[i]), said(now[i]), hasWas ? `${cardWord("before")} ${said(was[i])}` : ""].filter(Boolean).join(" · "));
      const heights = (list) => Array.from({ length: n }, (_, i) => (list[i] === null || list[i] === undefined ? null : Math.round((y(list[i]) / H) * 1000) / 10));
      const words = `${plain(name)}: ${t(hasWas ? "Graph of this period, with the period before dashed. The arrow keys read each day." : "Graph of this period. The arrow keys read each day.")}`;
      const focus = own ? `tabindex="0" role="img" aria-label="${esc(words)}"` : 'aria-hidden="true"';
      // marks / marksBefore: true on the days to flag (an unusual day, W11), drawn as dots on the line they belong to.
      const dots = (flags, list, cls) => (Array.isArray(flags) ? flags : []).map((on, i) => (on && list[i] !== null && list[i] !== undefined ? `<i class="ncard-mark ${cls}" style="left:${x(i).toFixed(2)}%;top:${((y(list[i]) / H) * 100).toFixed(1)}%"></i>` : "")).join("");
      const marked = dots(s.marks, now, "now") + (hasWas ? dots(s.marksBefore, was, "was") : "");
      const ends = tall && days.length ? `<span class="ncard-days" aria-hidden="true"><span>${esc(dayWords(days[0]))}</span><span>${esc(dayWords(days[Math.min(n, days.length) - 1]))}</span></span>` : "";
      return `<span class="ncard-graph" ${focus} data-read="${esc(JSON.stringify(read))}" data-ny="${esc(JSON.stringify(heights(now)))}"${hasWas ? ` data-wy="${esc(JSON.stringify(heights(was)))}"` : ""}>`
        + `<span class="ncard-plot"><svg class="ncard-spark" viewBox="0 0 100 ${H}" preserveAspectRatio="none" aria-hidden="true">${area ? `<path class="area" d="${area}"/>` : ""}${hasWas ? `<path class="was" d="${lines(was)}"/>` : ""}<path class="now" d="${lines(now)}"/></svg>`
        + `${marked}<i class="ncard-cursor"></i><i class="ncard-pt was" hidden></i><i class="ncard-pt now" hidden></i></span>${ends}</span>`;
    }

    let cardSeq = 0;
    const NOT_ATTRS = new Set(["class", "style", "href", "type", "data-card", "aria-pressed", "aria-describedby"]);
    const SERIES_COLOUR = /^(var\(--[\w-]+\)|#[0-9a-f]{3,8}|[a-z]+)$/i;
    UI.card = (opts = {}) => {
      const { id = "", label = "", value = null, format = "num", change = null, sub = null, spark = null, def = null, info = "", href = "", button = false, toggle = null, tall = false, cls = "", attrs = null } = opts;
      const show = cardFormat(format), name = t(String(label ?? ""));
      const kind = href ? "link" : toggle ? "toggle" : button ? "button" : "";
      const { pill, sub: beforeNow } = cardChange(change, show);
      const unknown = value === null || value === undefined || value === "" || value === "—" || (typeof value === "number" && !Number.isFinite(value));
      const fig = unknown ? "—" : typeof value === "number" ? (format === "num" && Number.isInteger(value) ? `<span class="countup" data-n="${value}">${esc(show(value))}</span>` : esc(show(value))) : String(value);
      // The (i): the metric's definition, then the caveats. A link or a switch holds them itself (hover, keyboard focus), since
      // a second control inside it can't be reached.
      const key = def === false ? "" : keyOf(def || name);
      const tip = [key ? UI.def(key) : "", ...sentences(info)].filter(Boolean).join("\n");
      const described = tip && kind ? `ncard-d-${(cardSeq += 1)}` : "";
      const mark = !tip ? "" : kind ? `<span class="def-i" aria-hidden="true">${icon("info")}</span>`
        : `<span class="def-i" role="img" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(`${plain(name)}: ${tip.replace(/\n/g, " ")}`)}">${icon("info")}</span>`;
      const graph = cardGraph(spark, { name, show, tall, own: !kind });
      const rest = sub !== null && sub !== undefined && sub !== "" ? String(sub) : beforeNow;
      const inner = `<span class="ncard-lab lab">${toggle ? '<i class="ncard-key" aria-hidden="true"></i>' : ""}<span class="ncard-name">${name}</span>${mark}</span>`
        + `<span class="ncard-row"><span class="ncard-fig fig${unknown ? " is-unknown" : ""}">${fig}</span>${unknown ? "" : pill}</span>`
        + `<span class="ncard-sub"><span class="ncard-rest">${rest}</span><span class="ncard-read" aria-hidden="true"></span></span>`
        + `${graph}${described ? `<span hidden id="${described}">${esc(tip.replace(/\n/g, " "))}</span>` : ""}`;
      const classes = ["ncard", kind ? `is-${kind}` : "", graph ? (tall ? "is-tall" : "") : "no-graph", String(cls || "").trim()].filter(Boolean).join(" ");
      const more = Object.entries(attrs || {}).filter(([k, v]) => /^[a-z][\w:-]*$/i.test(k) && !/^on/i.test(k) && !NOT_ATTRS.has(k.toLowerCase()) && v !== false && v !== null && v !== undefined)
        .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join("");
      const colour = toggle && SERIES_COLOUR.test(String(toggle.color || "")) ? ` style="--ncard-line:${esc(toggle.color)}"` : "";
      const open = `class="${esc(classes)}"${id ? ` data-card="${esc(id)}"` : ""}${colour}${described ? ` data-tip="${esc(tip)}" aria-describedby="${described}"` : ""}${more}`;
      if (kind === "link") return `<a ${open} href="${esc(href)}">${inner}</a>`;
      if (kind) return `<button type="button" ${open}${toggle ? ` aria-pressed="${toggle.pressed ? "true" : "false"}"` : ""}>${inner}</button>`;
      return `<section ${open}>${inner}</section>`;
    };

    /* Reading a card's graph one day at a time: the pointer or a tap over it, or the arrow keys once the graph (on a link,
       button or switch card: the card) has keyboard focus. The sub line reads that day; Escape, or leaving, puts it back. */
    const graphDays = new WeakMap();
    const reading = { card: null, at: null, by: "" };
    const graphOf = (card) => card?.querySelector(".ncard-graph[data-read]") || null;
    const daysOf = (graph) => {
      let d = graphDays.get(graph);
      if (!d) {
        const list = (v) => { try { const out = JSON.parse(v || "[]"); return Array.isArray(out) ? out : []; } catch { return []; } };
        d = { read: list(graph.dataset.read), now: list(graph.dataset.ny), was: list(graph.dataset.wy) };
        graphDays.set(graph, d);
      }
      return d;
    };
    let liveLine = null; // one quiet line for screen readers, so arrowing through the days is heard
    const say = (words) => {
      if (!liveLine?.isConnected) { liveLine = document.createElement("div"); liveLine.className = "sr"; liveLine.setAttribute("aria-live", "polite"); document.body.append(liveLine); }
      liveLine.textContent = words;
    };
    function stopReading() {
      const card = reading.card;
      Object.assign(reading, { card: null, at: null, by: "" });
      if (!card) return;
      card.classList.remove("is-reading");
      const out = card.querySelector(".ncard-read");
      if (out) out.textContent = "";
    }
    function readDay(card, index, by) {
      const graph = graphOf(card);
      if (!graph) return;
      const d = daysOf(graph), n = d.read.length;
      if (!n) return;
      if (reading.card && reading.card !== card) stopReading();
      const at = Math.max(0, Math.min(n - 1, index)), left = `${n === 1 ? 50 : (at / (n - 1)) * 100}%`;
      Object.assign(reading, { card, at, by });
      const cursor = graph.querySelector(".ncard-cursor");
      if (cursor) cursor.style.left = left;
      [["now", d.now], ["was", d.was]].forEach(([part, heights]) => {
        const dot = graph.querySelector(`.ncard-pt.${part}`);
        if (!dot) return;
        dot.hidden = heights[at] === null || heights[at] === undefined;
        if (!dot.hidden) { dot.style.left = left; dot.style.top = `${heights[at]}%`; }
      });
      const out = card.querySelector(".ncard-read");
      if (out) out.textContent = d.read[at];
      card.classList.add("is-reading");
      if (by === "key") say(d.read[at]);
    }
    const follow = (e) => {
      const graph = e.target.closest?.(".ncard-graph[data-read]"), card = graph?.closest(".ncard");
      if (!card) { if (reading.by === "pointer") stopReading(); return; }
      const box = (graph.querySelector(".ncard-plot") || graph).getBoundingClientRect(), n = daysOf(graph).read.length;
      readDay(card, box.width > 0 && n > 1 ? Math.round(((e.clientX - box.left) / box.width) * (n - 1)) : n - 1, "pointer");
    };
    document.addEventListener("pointermove", follow, { passive: true });
    document.addEventListener("pointerdown", follow, { passive: true }); // a tap on a phone
    // The mouse left the window. A finger lifting fires this too, and its reading stays until the next tap elsewhere.
    document.addEventListener("pointerout", (e) => { if (!e.relatedTarget && e.pointerType === "mouse" && reading.by === "pointer") stopReading(); });
    const READ_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);
    document.addEventListener("keydown", (e) => {
      if (!READ_KEYS.has(e.key) && e.key !== "Escape") return;
      const el = e.target;
      const card = el.matches?.(".ncard-graph[data-read]") ? el.closest(".ncard") : el.matches?.(".ncard:is(.is-link, .is-toggle, .is-button)") ? el : null;
      const graph = graphOf(card);
      if (!graph) return;
      if (e.key === "Escape") { if (reading.card === card) { stopReading(); e.preventDefault(); } return; }
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const n = daysOf(graph).read.length, from = reading.card === card ? reading.at : null;
      readDay(card, e.key === "Home" ? 0 : e.key === "End" || from === null ? n - 1 : from + (e.key === "ArrowRight" ? 1 : -1), "key");
      e.preventDefault();
    });
    document.addEventListener("focusin", (e) => {
      const graph = e.target.matches?.(".ncard-graph[data-read]") ? e.target : null;
      if (graph && graph.matches(":focus-visible")) readDay(graph.closest(".ncard"), daysOf(graph).read.length - 1, "key");
    });
    document.addEventListener("focusout", (e) => {
      if (reading.by === "key" && reading.card?.contains(e.target) && !reading.card.contains(e.relatedTarget)) stopReading();
    });
    // A tap shows an (i)'s words too: a phone has no hover, and a tap isn't keyboard focus. The app's own tooltip draws them.
    document.addEventListener("click", (e) => {
      if (!UI.simple?.()) return;
      const mark = e.target.closest?.(".def-i[data-tip]");
      if (!mark || mark.closest("a, button") || document.querySelector("body > .tooltip")) return;
      mark.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    document.addEventListener("click", (e) => {
      const el = e.target.closest?.("[data-ui-retry]");
      if (!el) return;
      const fn = retries.get(el.dataset.uiRetry);
      if (fn) { el.disabled = true; try { fn(); } catch (err) { console.error(err); } }
    });
  }

  window.SHARED_UI = { install, DEFS };
})();
