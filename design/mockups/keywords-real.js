/* Keywords, Refresh and the search tools in Settings, on real data. Only when the real server is there: opened as a plain file,
   the sample screen in mockup.js stays. Rankings come from /api/rankings, which holds every rule about what may be compared. This
   file only shows them, so a tool switch can't turn into a move here. All HTML goes through setHTML, and all values through esc. */
(() => {
  "use strict";
  const fr = {
    "Scraped results": "Résultats scrapés", "tool changed": "outil changé", "depth changed": "profondeur changée", "location changed": "lieu changé",
    "Different tools: can't compare.": "Outils différents : comparaison impossible.",
    "Different depth: can't compare.": "Profondeur différente : comparaison impossible.",
    "Different place: can't compare.": "Lieu différent : comparaison impossible.",
    "Not checked": "Pas encore contrôlé", "Unverified": "Non vérifié", "First check with this tool, and no engine data to compare.": "Premier contrôle avec cet outil, et aucune donnée du moteur pour comparer.", "Another location": "Autre lieu", "No free checks left.": "Plus de contrôles gratuits.", "Nothing changed": "Rien n'a changé",
    "No free tools left for Google.": "Plus d'outil gratuit pour Google.", "No free tools left for DuckDuckGo.": "Plus d'outil gratuit pour DuckDuckGo.", "No free tools left for Bing.": "Plus d'outil gratuit pour Bing.", "No free tools left for Yandex.": "Plus d'outil gratuit pour Yandex.",
    "Bright Data has no free checks left.": "Bright Data n'a plus de contrôles gratuits.", "SerpApi has no free checks left.": "SerpApi n'a plus de contrôles gratuits.", "HasData has no free checks left.": "HasData n'a plus de contrôles gratuits.", "Searlo has no free checks left.": "Searlo n'a plus de contrôles gratuits.",
    "A captcha didn't clear, so the browser backup stopped.": "Un captcha n'a pas disparu : la sauvegarde par navigateur s'est arrêtée.", "The app won't bypass captchas.": "L'application ne contourne pas les captchas.",
    "DuckDuckGo stopped at a bot check.": "DuckDuckGo a demandé une vérification anti-robot : cet outil s'est arrêté.", "The app won't bypass it.": "L'application ne cherche pas à la contourner.", "Not in top": "Hors du top", "just now": "à l'instant", "today": "aujourd'hui", "Search Console impressions, last 28 days. Exact volume isn't available for free.": "Impressions Search Console, 28 derniers jours. Le volume exact n'est pas disponible gratuitement.",
    "Not connected for this site, or no data for this keyword.": "Non connecté pour ce site, ou pas de donnée pour ce mot-clé.",
    "Needs 2 checks, same tool": "Il faut 2 contrôles avec le même outil", "Tools disagree": "Les outils ne sont pas d'accord", "Suspect result": "Résultat suspect", "Can't verify yet": "Vérification impossible pour l'instant",
    "No Refresh yet": "Aucune actualisation", "Add keywords": "Ajouter des mots-clés", "No keywords yet": "Pas encore de mots-clés", "Add the keywords to follow.": "Ajoutez les mots-clés à suivre.",
    "Add a site first": "Ajoutez d'abord un site", "Keywords belong to a site.": "Les mots-clés appartiennent à un site.", "Open Settings": "Ouvrir les réglages",
    "Keywords, one per line": "Mots-clés, un par ligne", "Or upload a file": "Ou importez un fichier", "Country": "Pays", "Language": "Langue", "Any country": "Tous les pays", "Optional, such as fr": "Facultatif, par exemple fr", "Most used by this site's keywords.": "Les plus utilisés par les mots-clés de ce site.",
    "This check couldn't read every result, so it can't say whether you're there": "Ce contrôle n'a pas pu lire tous les résultats : il ne peut pas dire si vous y êtes", "Hidden by Google": "Masqué par Google",
    "Google showed Bright Data a captcha, so this search failed.": "Google a montré un captcha à Bright Data : cette recherche a échoué.", "Nothing from that answer was saved.": "Rien de cette réponse n'a été enregistré.",
    "Each new keyword gets one check with a free tool, to see who really ranks. After that, DuckDuckGo is checked by itself every day, and the other engines when you press Refresh.": "Chaque nouveau mot-clé reçoit un contrôle avec un outil gratuit, pour voir qui se classe vraiment. Ensuite, DuckDuckGo est vérifié tout seul chaque jour, et les autres moteurs quand vous appuyez sur Actualiser.",
    "Add a keyword or choose a file.": "Ajoutez un mot-clé ou choisissez un fichier.", "Keywords added": "Mots-clés ajoutés",
    "Couldn't load the keywords.": "Impossible de charger les mots-clés.", "Try again": "Réessayer", "Loading…": "Chargement…",
    "Refresh keywords": "Actualiser les mots-clés", "keyword": "mot-clé", "keywords": "mots-clés", "Engines": "Moteurs", "Depth": "Profondeur", "Top": "Top", "Tools": "Outils", "Automatic: free first": "Automatique : gratuits d'abord", "Choose tools": "Choisir les outils",
    "Connect": "Connecter", "No credits needed": "Aucun crédit nécessaire", "left": "restants", "of": "sur", "monthly": "chaque mois", "one-time": "une seule fois", "no credits": "sans crédits", "Refills monthly": "Se recharge chaque mois", "Never refills": "Ne se recharge jamais",
    "Not for these engines": "Pas pour ces moteurs", "Only if picked": "Seulement si choisi", "check": "contrôle", "checks": "contrôles", "credit": "crédit", "credits": "crédits", "paid": "payants", "Will use": "Utilisera", "over": "pour",
    "Runs out after": "S'arrête après", "Nothing to check.": "Rien à contrôler.", "Pick an engine.": "Choisissez un moteur.", "Pick a tool.": "Choisissez un outil.", "Confirm": "Confirmer", "Cancel": "Annuler", "Close": "Fermer",
    "Already refreshing:": "Déjà en cours :", "by": "par", "Checked within": "Contrôlés depuis moins de", "h, left out:": "h, écartés :", "Check them again": "Les contrôler quand même", "Retry": "Actualiser",
    "No tool can search": "Aucun outil ne peut chercher sur", "Connect one in Settings.": "Connectez-en un dans les réglages.", "Paid use is off.": "L'usage payant est désactivé.", "Use paid credits after free ones": "Utiliser des crédits payants si les gratuits sont épuisés", "Limit to": "Limiter cette actualisation à", "Estimated cost": "Coût estimé",
    "Free tools only": "Outils gratuits uniquement", "Uses a real browser on this Mac; stops at the first captcha.": "Utilise un vrai navigateur sur ce Mac ; s'arrête au premier captcha.",
    "Set this Mac's country in Settings first.": "Indiquez d'abord le pays de ce Mac dans les réglages.",
    "Refreshing": "Actualisation", "Stop": "Arrêter", "Stopping…": "Arrêt…", "continuing with": "on continue avec", "ran out of free checks": "n'a plus de contrôles gratuits", "was blocked by a bot check": "a été bloqué par une vérification anti-robot", "was asked to slow down": "a dû ralentir", "refused the key": "a refusé la clé", "kept failing": "a échoué plusieurs fois de suite", "answered in a way the app can't read": "a répondu d'une façon que l'application ne sait pas lire", "stopped working": "a cessé de fonctionner",
    "Skipped: bot check": "Écarté : vérification anti-robot", "Automatic runs try it again in": "Les actualisations automatiques le réessaient dans", "hit a bot check": "a rencontré une vérification anti-robot", "so it will probably stop at once.": "il s'arrêtera donc sans doute tout de suite.", "Pick one of these instead:": "Choisissez plutôt :",
    "DuckDuckGo direct was skipped: it was blocked by a bot check in the last 24 hours.": "DuckDuckGo direct a été écarté : il a été bloqué par une vérification anti-robot ces dernières 24 heures.", "Finished": "Terminé", "Stopped": "Arrêté", "saved": "enregistrés", "failed": "échoués", "not run": "non lancés", "Stopped: no free tools left": "Arrêté : plus d'outil gratuit",
    "started by": "lancée par", "Refresh started": "Actualisation lancée", "This Refresh is already running.": "Cette actualisation est déjà en cours.",
    "Results": "Résultats", "Tool": "Outil", "Position": "Position", "Checked": "Vérifié", "Status": "Statut", "Action": "Action", "Recheck": "Recontrôler", "Check": "Contrôler", "never": "jamais", "OK": "OK", "Use": "Utiliser", "Rechecking": "Nouveau contrôle",
    "Other locations": "Autres lieux", "Not compared with": "Non comparé avec", "None yet": "Aucun pour l'instant", "Position history": "Historique des positions", "1 = top. One dot per check.": "1 en haut ; chaque point est un vrai contrôle", "Hollow dots: suspect, left out of Change.": "Points vides : suspects, exclus de l'évolution.",
    "Chart": "Graphique", "Table": "Tableau", "Date": "Date", "All results": "Tous les résultats", "Competitors on this page": "Concurrents sur cette page", "Website": "Site web", "Change": "Évolution", "AI Overview": "Aperçu IA", "Page": "Page", "average": "moyenne",
    "Cited": "Cité", "Not cited": "Pas cité", "No overview": "Pas d'aperçu", "Not captured": "Non capturé", "Failed": "Échec", "Not connected": "Non connecté", "Check deeper": "Chercher plus loin", "Stop following": "Ne plus suivre", "Stopped following": "Suivi arrêté", "Follow": "Suivre", "Stop tracking": "Ne plus suivre", "Stopped tracking": "Suivi arrêté", "Track": "Suivre", "Refresh": "Actualiser",
    "Stop tracking this keyword here? Past checks stay.": "Ne plus suivre ce mot-clé ici ? Les anciens contrôles restent.", "Site": "Site",
    "Stop following this keyword on this site? Its past checks stay.": "Ne plus suivre ce mot-clé sur ce site ? Ses anciens contrôles restent.",
    "No Search Console data yet": "Pas encore de données Search Console", "Connect it in Settings; queries appear within 3 days.": "Connectez-la dans les réglages : les requêtes apparaissent sous 3 jours.",
    "No Bing Webmaster data yet": "Pas encore de données Bing Webmaster", "No Yandex Webmaster data yet": "Pas encore de données Yandex Webmaster", "Connect it in Settings; queries appear here.": "Connectez-le dans les réglages : les requêtes apparaissent ici.",
    "DuckDuckGo has no tool for site owners, so the app checks its positions by itself every day, oldest first, on free searches only. Refresh and Refresh data check them now.": "DuckDuckGo n'a pas d'outil pour les propriétaires de sites : l'app vérifie ses positions toute seule chaque jour, les plus anciennes d'abord, avec des recherches gratuites uniquement. Actualiser et Actualiser les données les vérifient tout de suite.",
    "Automatic DuckDuckGo check": "Contrôle DuckDuckGo automatique", "automatic check": "contrôle automatique",
    "Clicks": "Clics", "Click rate": "Taux de clic", "selected": "sélectionnés", "Clear selection": "Effacer la sélection", "{n} selected on this page": "{n} sélectionnés sur cette page", "Select all {n} keywords": "Sélectionner les {n} mots-clés", "All {n} keywords selected": "Les {n} mots-clés sont sélectionnés", "Create task": "Créer une tâche", "Export CSV": "Exporter en CSV", "Export ready": "Export prêt",
    "Up": "En hausse", "Down": "En baisse", "Top 3": "Top 3", "Top 10": "Top 10", "All": "Tous", "Not ranked": "Non classés", "Cited by AI": "Cités par l'IA", "Two pages compete": "Deux pages en concurrence", "Also ranks": "Classées aussi", "Also": "Aussi", "impr.": "impr.", "Main tool": "Outil principal", "None: the order below": "Aucun : l'ordre ci-dessous", "{tool} is the main tool": "{tool} est l'outil principal", "No main tool": "Pas d'outil principal", "Every ranking in the app comes from this tool. If it hasn't checked a keyword yet, the next tool in the order is shown, with its name. The other tools' results are in each keyword's details.": "Toutes les positions de l'app viennent de cet outil. S'il n'a pas encore vérifié un mot-clé, l'outil suivant de l'ordre est affiché, avec son nom. Les résultats des autres outils sont dans le détail de chaque mot-clé.", "+{n} more": "+{n} de plus", "Show fewer": "Afficher moins", "Two of your pages rank for it.": "Deux de vos pages se classent dessus.",
    "Tracked": "Suivis", "Ranked": "Classés", "compared": "comparés", "Positions": "Positions", "By bucket": "Par tranche", "Queries": "Requêtes", "All engines": "Tous les moteurs", "Volume": "Volume", "Trend": "Tendance", "AI": "IA", "avg position": "position moy.",
    "No keyword matches": "Aucun mot-clé ne correspond", "Try another filter.": "Essayez un autre filtre.", "Show all": "Tout afficher", "Data through": "Données jusqu'au", "Refreshed": "Actualisé le", "Rankings from engines' own tools and scraped results": "Positions venant de l'outil de chaque moteur et de résultats scrapés",
    "in its country": "dans son pays", "No Search Console data in the keyword's country.": "Pas de données Search Console dans le pays du mot-clé.", "Search Console's average position in the keyword's own country.": "Position moyenne Search Console dans le pays du mot-clé.", "Search Console's average position across every country.": "Position moyenne Search Console dans tous les pays.", "Order for": "Ordre pour", "This tool doesn't search this engine.": "Cet outil ne couvre pas ce moteur.", "Order saved": "Ordre enregistré",
    "Allow paid use": "Autoriser l'usage payant", "Refresh still uses free credits first; each run asks its own limit.": "Actualiser utilise d'abord les crédits gratuits ; chaque actualisation demande sa limite.",
    "No pay-as-you-go price: paid use unavailable.": "Pas de prix à l'usage : usage payant indisponible.", "Connection saved": "Connexion enregistrée", "Disconnected": "Déconnecté", "Paste the key first.": "Collez d'abord la clé.", "Works.": "Fonctionne.",
    "Save the key first.": "Enregistrez d'abord la clé.", "Not checked, to save a credit. Save it; the first search shows if it works.": "Non vérifiée, pour économiser un crédit. Enregistrez-la : la première recherche montrera si elle fonctionne.",
    "The browser backup needs Playwright. Install it: .venv/bin/pip install playwright": "La sauvegarde par navigateur a besoin de Playwright. Installez-le : .venv/bin/pip install playwright",
    "Add the zone name too.": "Ajoutez aussi le nom de la zone.", "Paste the whole address, starting with https://.": "Collez l'adresse entière, en commençant par https://.", "Paste the address first.": "Collez d'abord l'adresse.",
    "Already refreshing.": "Actualisation déjà en cours.", "All checked just now. Tick Check them again to go ahead.": "Tous viennent d'être contrôlés. Cochez Les contrôler quand même pour continuer.",
    "No search tool can run these engines. Connect one in Settings.": "Aucun outil de recherche ne couvre ces moteurs. Connectez-en un dans les réglages.",
    "This run lost its background job. Everything checked so far is saved.": "Cette actualisation a perdu sa tâche de fond. Tout ce qui a été contrôlé est enregistré.",
    "Search queries": "Chercher une requête", "No query matches.": "Aucune requête ne correspond.", "queries": "requêtes", "query": "requête", "keyword": "mot-clé", "keywords": "mots-clés",
    // the Refresh tray's failed searches, said once per tool (finishTray), and the panel's Other locations heading
    "Dropped after {n} in a row": "Écarté après {n} échecs de suite", "dropped after {n} in a row": "écarté après {n} échecs de suite", "dropped": "écarté",
    "It failed {n} searches in a row, so this Refresh stopped using it.": "{n} recherches de suite ont échoué : cette actualisation a cessé de l'utiliser.",
    "No free checks left": "Plus de contrôles gratuits", "no free checks left": "plus de contrôles gratuits", "Blocked by a bot check": "Bloqué par une vérification anti-robot", "blocked by a bot check": "bloqué par une vérification anti-robot",
    "asked to slow down": "demande de ralentir", "Key refused": "Clé refusée", "key refused": "clé refusée", "Unreadable answer": "Réponse illisible", "unreadable answer": "réponse illisible",
    "The search failed.": "La recherche a échoué.", "The app stopped during this search.": "L'application s'est arrêtée pendant cette recherche.",
    "It wasn't tried again, because it may already have been charged.": "Elle n'a pas été relancée : elle a peut-être déjà été facturée.", "It isn't tried again, because it may already have been charged.": "Elle n'est pas relancée : elle a peut-être déjà été facturée.",
    "not compared with": "non comparés avec",
    // the simpler screens (?simple=1): the head's line, the ⋯ beside the chips, the line under the table, ideas in Add keywords
    "with {tool}": "avec {tool}", "More table options": "Plus d'options du tableau", "In the list": "Dans la liste", "Search Console": "Search Console",
    // UI critique fixes (2026-11-12): plain words, the cost of a check, what a Refresh moved, the first check of a new keyword
    "Our check": "Notre contrôle", "our checks": "nos contrôles", "Checked by": "Contrôlé par", "Rankings from engines' own tools and our own checks": "Positions venant de l'outil de chaque moteur et de nos propres contrôles",
    "Not confirmed yet": "Pas encore confirmé", "First check with this tool, and nothing to compare it with yet.": "Premier contrôle avec cet outil, et rien encore pour le comparer.",
    "A competitor is cited instead": "Un concurrent est cité à la place", "No AI Overview on this search": "Pas d'aperçu IA sur cette recherche", "The check couldn't read the AI Overview": "Le contrôle n'a pas pu lire l'aperçu IA",
    "vs last check": "vs dernier contrôle", "No change": "Pas de changement", "First check": "Premier contrôle", "Only one check so far: nothing to compare yet.": "Un seul contrôle pour l'instant : rien à comparer.",
    "Checking with {tool}…": "Contrôle avec {tool}…", "Checking…": "Contrôle en cours…", "Waiting for its first check": "En attente de son premier contrôle",
    "{n} up": "{n} en hausse", "{n} down": "{n} en baisse", "{n} new in top 10": "{n} nouveaux dans le top 10", "Nothing moved": "Rien n'a bougé", "Show them": "Les afficher", "This Refresh": "Cette actualisation",
    "Uses {n} of your {left} free {tool} searches": "Utilise {n} de vos {left} recherches {tool} gratuites", "Uses {n} of your {left} free {tool} search": "Utilise {n} de vos {left} recherches {tool} gratuites",
    "{n} {tool} searches, no credits needed": "{n} recherches {tool}, sans crédits", "{n} {tool} search, no credits needed": "{n} recherche {tool}, sans crédits",
    "{n} paid {tool} searches": "{n} recherches {tool} payantes", "{n} paid {tool} search": "{n} recherche {tool} payante", "No charge.": "Aucun frais.", "Up to {money}.": "Jusqu'à {money}.",
    "Check with {tool} · {n} searches": "Contrôler avec {tool} · {n} recherches", "Check with {tool} · {n} search": "Contrôler avec {tool} · {n} recherche",
    "Refresh · {n} searches": "Actualiser · {n} recherches", "Refresh · {n} search": "Actualiser · {n} recherche", "Check · {n} searches": "Contrôler · {n} recherches", "Check · {n} search": "Contrôler · {n} recherche", "{label} · up to {money}": "{label} · jusqu'à {money}",
    "Refresh them too": "Les actualiser aussi", "All checked just now. Tick Refresh them too to go ahead.": "Tous viennent d'être contrôlés. Cochez Les actualiser aussi pour continuer.", "Refresh anyway? 1 credit": "Actualiser quand même ? 1 crédit",
    "Any language": "Toutes les langues", "Choose a file": "Choisir un fichier", "No file chosen": "Aucun fichier choisi", "Filter": "Filtrer", "Show": "Afficher", "View": "Vue", "Rows": "Lignes", "Columns": "Colonnes", "Compact rows": "Lignes compactes",
    "By column": "Par colonne", "Close filters": "Fermer les filtres", "Impressions (28 days)": "Impressions (28 jours)", "Trend": "Tendance", "Page": "Page", "AI": "IA",
    "Search Console average position": "Position moyenne Search Console", "Phone actions": "Actions",
    // Expert review fixes (2026-11-17): drops out of the depth are moves, the page that ranked, each engine's own numbers, old checks
    "Dropped out": "Sorti", "Was #{was}, now not in the top {n}.": "Était #{was}, maintenant hors du top {n}.", "New": "Nouveau", "Wasn't in the top {n} last check.": "N'était pas dans le top {n} au dernier contrôle.",
    "Still out": "Toujours hors", "Not in the top {n} on the last two checks.": "Hors du top {n} aux deux derniers contrôles.",
    "{n} dropped out of top 10": "{n} sortis du top 10", "Ranking now": "Classée maintenant", "Most shown in Search Console": "La plus affichée dans Search Console",
    "The page our check found. Search Console's most-shown page over 28 days is another one.": "La page trouvée par notre contrôle. La page la plus affichée par Search Console sur 28 jours en est une autre.",
    "The ranking page changed since the last check.": "La page classée a changé depuis le dernier contrôle.", "URL changed": "URL changée", "URL": "URL",
    "Checked {age} ago.": "Contrôlé il y a {age}.", "{tool}'s check is {age} old, so this newer one is shown.": "Le contrôle de {tool} date de {age} : ce contrôle plus récent est affiché.",
    "Google only": "Google uniquement", "Bing Webmaster": "Bing Webmaster", "Yandex Webmaster": "Yandex Webmaster",
    "{engine} isn't checked: no tool can search it.": "{engine} n'est pas contrôlé : aucun outil ne peut y chercher.", "Connect one in Settings, then press Refresh.": "Connectez-en un dans les réglages, puis appuyez sur Actualiser.",
    "It will be skipped.": "Il sera ignoré.", "includes {n} spellings": "inclut {n} orthographes",
    "No tool can search Yandex, so it was skipped.": "Aucun outil ne peut chercher sur Yandex : il a été ignoré.", "No tool can search Bing, so it was skipped.": "Aucun outil ne peut chercher sur Bing : il a été ignoré.",
    "No tool can search DuckDuckGo, so it was skipped.": "Aucun outil ne peut chercher sur DuckDuckGo : il a été ignoré.", "No tool can search Google, so it was skipped.": "Aucun outil ne peut chercher sur Google : il a été ignoré.",
  };
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });

  if (!window.BOOT?.served) return; // a plain file: the sample stays, and nothing below runs

  window.KEYWORDS = []; // a sample row must never show or count on a real server
  const sampleConnections = window.CONNECTIONS;
  window.TOOLS = [];
  sampleConnections.forEach((c) => { if (c.group === "serp") { c.status = c.auth === "none" || c.auth === "browser" ? "nokey" : "off"; c.last4 = ""; c.sites = "all"; c.note = ""; } });

  const ENGINES = [["google", "Google"], ["duckduckgo", "DuckDuckGo"], ["bing", "Bing"], ["yandex", "Yandex"]];
  const OWN_TOOL = { google: "Search Console", bing: "Bing Webmaster", yandex: "Yandex Webmaster" };
  const CONN_ID = { "Bright Data": "brightdata", SerpApi: "serpapi", HasData: "hasdata", Searlo: "searlo", "DuckDuckGo direct": "ddg", SearXNG: "searxng", "Browser on this Mac": "browser" };
  let UI, t, esc, icon, num, dec, status, logo, $, $$, state;
  const K = {
    data: null, error: "", loading: false, stale: true, tools: null, order: {}, settings: {}, selected: new Set(), queries: {},
    runs: new Map(), orderEngine: "google", panel: null, refresh: null, browserMissing: false,
    wantOpen: null, qsort: null, // a keyword named in the address; the Queries table's sorted heading
    allPages: false, shownList: null, // picks kept on every page after "Select all N keywords"; the list the table last drew
  };
  const fill = (words, n) => t(words).replace("{n}", n);
  /* The keyword key, as the server's store.keyword_key: any case, any spacing, any Latin accent. "cafe" is "café". */
  const kwKey = (value) => TP.fold(String(value ?? "").normalize("NFKC")).replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/\s+/g, " ").trim();
  /* How a keyword moved between two like-for-like checks (rankings.movement): up, down, same, lost (fell out of the depth
     checked), new (came into it), out (out both times), or null when there's nothing to compare. */
  const GAINS = ["up", "new"], DROPS = ["down", "lost"];
  const goesUp = (view) => GAINS.includes(view?.move), goesDown = (view) => DROPS.includes(view?.move);
  // +1 entered the top 10, −1 left it: the server's rankings.top10_step, on the rows this screen shows.
  const top10Step = (view) => {
    if (!view?.move) return 0;
    const now = view.main?.p, was = view.was, inNow = Boolean(now) && now <= 10, inThen = was !== null && was !== undefined && was <= 10;
    return (inNow && !inThen ? 1 : 0) - (inThen && !inNow ? 1 : 0);
  };
  const OLD_DAYS = 14; // store.MAIN_MAX_AGE_DAYS
  /* The simpler screens (plan-seo-command-center-simplify-screens-like-mickaz.md, section 2, Keywords), only with ?simple=1:
     - the head: "Search Console, through 10 Nov · Last check 29 min with SerpApi", the screen's sentence behind its (i);
     - the engine tabs (page tabs) with Positions · By bucket · Queries at their end, above the four number cards (UI.card),
       because the cards follow the engine; DuckDuckGo's how-it-works is an (i) beside the tabs;
     - one row: Search keywords, the eight chips, then Filter (data-tt-slot) and a ⋯ that shows Compact rows and Columns;
     - the table: Trend off by default (Columns turns it on; the panel has the history), Scraped results as the badge only
       (the tool, when every row shares it, and the ages are said once under the table), no Check deeper in rows (the panel
       has it), the keyword as text: the whole row opens the panel (a click, Enter on the focused row), ↑ ↓ move while open;
     - Keyword ideas at the top of the Add keywords panel, its Add putting the words in the panel's list;
     - the rows and tools load through SCREEN_DATA (screen-data.js), so the warm-up can fetch them before Keywords opens.
     With the switch off, every line below draws what it drew before. */
  const simple = () => Boolean(UI?.simple?.());
  /* Both tables page and search the way every long table does (table-pages.js): TP keeps the search, the page and the size. */
  const KW_PAGES = "kw", Q_PAGES = "kwq";
  const kwPages = () => TP.state(KW_PAGES);
  const api = (...args) => window.COMP.api(...args);
  const mine = (run) => Boolean(run) && (!run.by || run.by === window.BOOT.user?.name);
  const AUTO_BY = "Automatic"; // seo/serp/auto_ddg.py: the daily DuckDuckGo check, and the one Refresh data starts
  const engineOf = () => (state.engine === "all" ? "google" : state.engine);
  const name = (id) => ENGINES.find(([e]) => e === id)?.[1] || id;
  // A tool or engine by its logo alone where its name would repeat on every row: the name is the tooltip and what a screen reader says.
  const logoMark = (id, label, size = 16) => `<span class="kw-logo" role="img" data-tip="${esc(label)}" aria-label="${esc(label)}">${logo(id, size)}</span>`;
  // The green OK on every normal row is a tick; Suspect result, Unverified and Failed keep their words, so they stand out.
  /* A brand that is the only label of a heading or a card line: its logo and its name, both shown (brand names decision,
     2026-11-12). brand-mention keeps brands.js from folding the name into the logo again. */
  const LOGO_ID = { Google: "google", DuckDuckGo: "duckduckgo", Bing: "bing", Yandex: "yandex", "Search Console": "searchconsole", "Bing Webmaster": "bing", "Yandex Webmaster": "yandex" };
  const brandLabel = (label) => `<span class="brand-mention kw-brand">${logo(LOGO_ID[label] || label, 14)}<span>${esc(t(label))}</span></span>`;
  /* A page address that breaks only after a slash: the scheme and host stay on one line (a hyphen in a host isn't a place to wrap). */
  const pageAddress = (url) => {
    const m = String(url).match(/^([a-z]+:\/\/[^/]+)(.*)$/i);
    const shown = m ? `<span class="nowrap">${esc(m[1])}</span>${esc(m[2]).replace(/\//g, "/<wbr>")}` : esc(url);
    return PageLink.html(url, { text: "\u0001", title: "" }).replace("\u0001", shown);
  };
  const okMark = () => `<span class="status good kw-ok" role="img" title="${esc(t("OK"))}" aria-label="${esc(t("OK"))}">${icon("check")}</span>`;
  const token = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}abc`).replace(/-/g, "");

  // "just now" is the first two minutes only; then minutes, hours, days.
  const age = (days) => {
    if (days === null || days === undefined) return t("never");
    const minutes = days * 1440;
    if (minutes < 2) return t("just now");
    if (minutes < 60) return `${Math.round(minutes)} min`;
    if (days < 1) return `${Math.max(1, Math.round(days * 24))} h`;
    return `${Math.round(days)} ${state.lang === "fr" ? "j" : "d"}`;
  };
  // Every page of yours that shows up for the keyword, under the main one: the warning alone doesn't say which.
  const ALSO_SHOWN = 3;
  const competingPages = (row) => {
    const others = (row.pages || []).filter((p) => !row.page || p.url.replace(/\/$/, "") !== row.page.replace(/\/$/, ""));
    if (!row.two_pages || !others.length) return "";
    const fact = (p) => [p.position ? `#${p.position}` : "", p.impressions != null ? `${num(p.impressions)} ${t("impr.")}` : ""].filter(Boolean).join(" · ");
    // Three at most in the row, so one keyword never fills the screen; the rest behind "+N more" (kept open across redraws).
    const open = K.alsoOpen?.has(row.id), shown = open ? others : others.slice(0, ALSO_SHOWN), rest = others.length - ALSO_SHOWN;
    const more = rest > 0 ? `<li><button type="button" class="link-btn small" data-kw-also="${esc(row.id)}" aria-expanded="${open}">${open ? t("Show fewer") : t("+{n} more").replace("{n}", num(rest))}</button></li>` : "";
    return `<ul class="kw-also" aria-label="${esc(t("Also ranks"))}">${shown.map((p) => `<li data-tip="${esc(p.url)}"><span class="warn small">${t("Also")}</span>${fact(p) ? ` <span class="muted">${esc(fact(p))}</span>` : ""} ${PageLink.html(p.url, { text: shortPath(p.url), title: "" })}</li>`).join("")}${more}</ul>`;
  };
  const shortPath = (url) => { try { const u = new URL(url); return decodeURI(u.pathname + u.search) || "/"; } catch { return url || ""; } };
  const allRows = () => { const host = UI.siteHostPicked(); return (K.data?.rows || []).filter((row) => !host || row.site === host); };
  /* What the Keyword ideas card needs from here: the words already tracked, and the country and language used most. */
  const mostUsed = () => {
    const counts = new Map();
    allRows().forEach((r) => { const key = `${r.country || ""}|${r.language || ""}`; counts.set(key, (counts.get(key) || 0) + 1); });
    const [country = "", language = ""] = ([...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || "|").split("|");
    return { country: country.toUpperCase(), language };
  };
  const ideasCard = () => {
    if (!window.LV?.ideasCard) return "";
    const keys = new Set(allRows().map((r) => kwKey(r.keyword)));
    return window.LV.ideasCard({ tracked: { has: (word) => keys.has(kwKey(word)) }, market: mostUsed() }); // any case, any accent
  };

  // ---- loading --------------------------------------------------------------------------------
  async function loadTools(given = null) {
    const answer = given || await api("GET", "tools");
    K.tools = answer.tools; K.order = answer.order; K.settings = answer.settings; K.browserMissing = answer.browser_missing;
    K.aiFirst = answer.first_for_ai || {}; K.aiFirstWhy = answer.first_for_ai_why || "";
    syncSettings();
    return answer;
  }

  /* The main tool (owner's ask, 2026-11-13): every ranking in the app is its result; it goes first in each engine's order.
     When it has none for a keyword yet, the next tool's shows, with its name; the others stay in the keyword's details. */
  const mainToolPicker = () => {
    const main = K.settings?.main_tool || "";
    const usable = (K.tools || []).filter((tool) => tool.connected || tool.auth === "none" || tool.auth === "browser" || tool.name === main);
    const opts = [`<option value="">${esc(t("None: the order below"))}</option>`, ...usable.map((tool) => `<option value="${esc(tool.name)}"${tool.name === main ? " selected" : ""}>${esc(tool.name)}</option>`)];
    const tip = UI.tip(t("Every ranking in the app comes from this tool. If it hasn't checked a keyword yet, the next tool in the order is shown, with its name. The other tools' results are in each keyword's details."));
    return `<label class="kwr-main-tool small" style="flex-basis:100%;display:flex;align-items:center;gap:8px;margin:8px 0 4px"><b>${t("Main tool")}</b><select id="kwr-main-tool" class="select" style="width:auto">${opts.join("")}</select>${tip}</label>`;
  };

  /* Settings draws the search tools from window.TOOLS and window.CONNECTIONS, so the real numbers go there. */
  function syncSettings() {
    const order = K.order[K.orderEngine] || [];
    const place = (tool) => { const at = order.indexOf(tool.name); return at < 0 ? order.length : at; };
    window.TOOLS = [...K.tools].sort((a, b) => place(a) - place(b)).map((tool) => ({
      name: tool.name, left: tool.left, of: tool.of, refills: tool.refills, engines: tool.engines, connected: tool.connected, paidPer: tool.paid_per, price: tool.price, manualOnly: tool.manual_only, paidOn: tool.paid_on,
    }));
    K.tools.forEach((tool) => {
      const c = sampleConnections.find((x) => x.tool === tool.name);
      if (!c) return;
      const keyless = tool.auth === "none" || tool.auth === "browser";
      c.status = keyless ? "nokey" : !tool.connected ? "off" : tool.last_error ? "failing" : "ok";
      c.since = ""; c.last4 = tool.last4 ? tool.last4.replace("…", "") : ""; c.zone = tool.zone || ""; c.sites = "all"; c.error = tool.last_error || "";
      if (tool.name === "HasData") c.desc = "Checks rankings on Google and Bing";
      if (tool.name === "Searlo") c.desc = "Checks rankings on Google";
      c.note = keyless && tool.auth === "browser" && K.browserMissing ? "The browser backup needs Playwright. Install it: .venv/bin/pip install playwright" : "";
      if (tool.auth === "browser") c.country = K.settings.mac_country || "";
    });
  }

  async function load() {
    if (K.loading) return;
    K.loading = true;
    try {
      // The simpler screens: through SCREEN_DATA, so an answer the warm-up fetched shows at once. Only the first load may use
      // a held answer; every later one follows a change (a Refresh, keywords added, Stop tracking), so it asks again.
      const held = window.SCREEN_DATA?.on?.() ? { fresh: Boolean(K.loadedOnce) } : null;
      const [data] = held
        ? await Promise.all([window.SCREEN_DATA.get("rankings", held), window.SCREEN_DATA.get("tools", held).then((answer) => loadTools(answer))])
        : await Promise.all([api("GET", "rankings"), loadTools()]);
      K.loadedOnce = true;
      K.data = data; K.error = ""; K.stale = false;
      // New keywords wait for their first free check: ask again every few seconds until each has a result.
      clearTimeout(K.checkingPoll);
      if (data.rows.some((row) => row.checking)) K.checkingPoll = setTimeout(() => { K.stale = true; if (state.route === "keywords" && !K.loading) load(); }, 4000);
      const live = new Set(data.rows.map((row) => row.id));
      [...K.selected].forEach((id) => { if (!live.has(id)) K.selected.delete(id); });
    } catch (err) { K.error = err.message; K.stale = false; }
    K.loading = false;
    if (state.route === "keywords" || state.route === "settings") UI.render({ keepScroll: true });
    openWanted();
    if ($("#cmdk")?.open) $("#cmd-input")?.dispatchEvent(new Event("input", { bubbles: true })); // ⌘K opened before the keywords came
  }

  // ---- table cells ----------------------------------------------------------------------------
  const UNSURE = "This check couldn't read every result, so it can't say whether you're there";
  /* "Not ranked" is a check that read every result and didn't find you: never a keyword not checked yet, or one whose only check is suspect. */
  const notRanked = (view) => view.main?.status === "ok" && !view.main.p;
  function posBadge(view) {
    if (view.p) return `<span class="pos ${view.p <= 3 ? "pos-top3" : view.p <= 10 ? "pos-top10" : ""}">#${view.p}</span>`;
    if (view.status === "suspect") { // it couldn't read every result, so it never says "not in the top 10"
      const unsure = t(UNSURE);
      return `<span class="pos pos-none" role="img" data-tip="${esc(unsure)}" aria-label="${esc(unsure)}">?</span>`;
    }
    const words = `${t("Not in top")} ${view.depth}`;
    return `<span class="pos pos-none" role="img" data-tip="${esc(words)}" aria-label="${esc(words)}">&gt;${view.depth}</span>`;
  }
  const flagged = (view) => (view.status === "suspect" ? `<span class="warn" role="img" data-tip="${t("Suspect result")}" aria-label="${t("Suspect result")}">${icon("shield-question")}</span>` : "");
  const line = (view, extra = "") => `<span class="res-line">${logoMark(view.tool, t(view.tool))}${posBadge(view)}${flagged(view)}${extra}<span class="res-meta">· ${age(view.age_days)}</span></span>`;

  function scrapedCell(row, e) {
    const view = row.engines[e];
    if (!view.main) {
      // A result from another place: the place only, "Not compared with <country>" in the line's tooltip.
      if (view.away.length) return `<span class="res"><span class="muted small">${t("Not checked")}</span>${view.away.slice(0, 1).map((a) => `<span class="res-line" data-tip="${esc(`${t("Not compared with")} ${UI.countryName(row.country) || row.country}`)}"><span class="sr">${esc(`${t("Not compared with")} ${UI.countryName(row.country) || row.country}`)}</span>${logo(a.tool, 16)}${posBadge(a)}<span class="res-meta">${esc(UI.countryName(a.location) || a.location || "?")}</span></span>`).join("")}</span>`;
      if (row.checking?.engine === e) return checkingCell(row);
      return `<span class="muted small kw-unchecked">${t("Not checked")}</span>`;
    }
    const differs = view.disagree ? `<span class="warn" role="img" data-tip="${esc(t("Tools disagree"))}: ${esc(view.disagree.tools.map((x) => t(x)).join(" / "))}, ${view.disagree.diff}" aria-label="${esc(t("Tools disagree"))}: ${esc(view.disagree.tools.map((x) => t(x)).join(" / "))}, ${view.disagree.diff}">${icon("triangle-alert")}</span>` : "";
    // The simpler screens: the badge only (and its warnings). The tool's logo stays when the rows don't all share one tool;
    // the age, the other tools and Check deeper are in the panel, and the ages are said once under the table.
    if (simple()) return `<span class="res"><span class="res-line">${K.oneTool ? "" : logoMark(view.main.tool, t(view.main.tool))}${posBadge(view.main)}${flagged(view.main)}${differs}${oldMark(view.main)}</span></span>`;
    const rest = [...view.suspects.slice(-1), ...view.others].slice(0, 2).map((x) => line(x)).join("");
    const deeper = view.main.p || view.main.status !== "ok" ? "" : `<button class="link-btn" data-kwr-deeper="${esc(row.id)}" data-engine-id="${e}">${t("Check deeper")}</button>`;
    return `<span class="res">${line(view.main, differs + oldMark(view.main))}${rest}${deeper}</span>`;
  }

  /* A keyword just added, before its first result: which tool is on it, so the row isn't a line of dashes (rankings.py _first_checks). */
  const checkingCell = (row) => `<span class="kw-checking">${icon("refresh-cw", "spin")}<span>${row.checking.tool ? esc(t("Checking with {tool}…").replace("{tool}", t(row.checking.tool))) : t("Checking…")}</span></span>`;
  const CHANGE_WHY = { "tool changed": "Different tools: can't compare.", "depth changed": "Different depth: can't compare.", "location changed": "Different place: can't compare." };
  function changeCell(view) {
    const c = view.change;
    if (c === null || c === undefined) {
      if (view.change_note) return `<span class="cellval"><span class="muted">—</span><span class="second" data-tip="${esc(t(CHANGE_WHY[view.change_note]))}">${esc(t(view.change_note))}<span class="sr">: ${esc(t(CHANGE_WHY[view.change_note]))}</span></span></span>`;
      if (!view.main) return `<span class="muted small kw-unchecked">${t("Not checked")}</span>`;
      const depth = view.main.depth;
      const said = (cls, word, tip, mark = "") => `<span class="${cls}" data-tip="${esc(tip)}" aria-label="${esc(`${word}: ${tip}`)}">${mark}<span class="small">${esc(word)}</span></span>`;
      if (view.move === "lost") return said("chg crit kw-move", t("Dropped out"), t("Was #{was}, now not in the top {n}.").replace("{was}", view.was).replace("{n}", depth), icon("arrow-down"));
      if (view.move === "new") return said("chg good kw-move", t("New"), t("Wasn't in the top {n} last check.").replace("{n}", depth), icon("arrow-up"));
      if (view.move === "out") return said("muted kw-move", t("Still out"), t("Not in the top {n} on the last two checks.").replace("{n}", depth));
      return `<span class="muted small" data-tip="${esc(t("Only one check so far: nothing to compare yet."))}">${t("First check")}</span>`;
    }
    if (c === 0) return `<span class="kw-same" aria-label="${esc(t("No change"))}"><span aria-hidden="true">=</span><span class="small">${t("No change")}</span></span>`;
    return `<span class="chg ${c > 0 ? "good" : "crit"}" aria-label="${t(c > 0 ? "Up" : "Down")} ${Math.abs(c)}">${icon(c > 0 ? "arrow-up" : "arrow-down")}${Math.abs(c)}</span>`;
  }
  const aiCell = (row) => ({
    cited: `<span class="nowrap">${icon("sparkles")} ${t("Cited")}</span>`,
    overview: `<span class="kw-ai-miss nowrap" data-tip="${esc(t("A competitor is cited instead"))}">${icon("triangle-alert")}${t("Not cited")}<span class="sr">: ${esc(t("A competitor is cited instead"))}</span></span>`,
    none: `<span class="muted small" data-tip="${esc(t("No AI Overview on this search"))}">${t("No overview")}</span>`,
    "not-captured": `<span class="muted small" data-tip="${esc(t("The check couldn't read the AI Overview"))}">${t("Not captured")}<span class="sr">: ${esc(t("The check couldn't read the AI Overview"))}</span></span>`,
  }[row.ai.state]);
  /* Google: the position in the keyword's own country when Search Console has it, on one line with the country's flag.
     The all-countries average then has its own column (K.worldCol, worldCell), so each row stays one line high (2026-11-13). */
  const localOf = (row, e) => { const local = e === "google" ? row?.own_country : null; return local && local.position !== null && local.position !== undefined ? local : null; };
  const ownCell = (view, row = null, e = "") => {
    const local = localOf(row, e);
    if (local) return `<span class="nowrap"><span class="tabular">${dec(local.position)}</span> ${UI.flag(local.country)}</span>`;
    if (K.worldCol) return `<span class="muted dash" role="img" data-tip="${esc(t("No Search Console data in the keyword's country."))}" aria-label="${esc(t("No Search Console data in the keyword's country."))}">—</span>`;
    return view.own === null || view.own === undefined
      ? `<span class="muted dash" data-tip="${esc(t("Not connected for this site, or no data for this keyword."))}" aria-label="${esc(t("Not connected for this site, or no data for this keyword."))}" role="img">—</span>`
      : `<span class="tabular">${dec(Math.round(view.own * 10) / 10)}</span>`;
  };
  const worldCell = (view) => (view.own === null || view.own === undefined ? `<span class="muted dash">—</span>` : `<span class="tabular">${dec(Math.round(view.own * 10) / 10)}</span>`);

  /* Each engine's own numbers only (2026-11-17): Google's impressions are Search Console's, Bing's and Yandex's their own
     webmaster tools', and DuckDuckGo has none. The AI column and Search Console's pages are Google's, so other tabs leave them out. */
  const impressionsOf = (row, e = "google") => (e === "google" ? row.impressions ?? row.volume ?? null : OWN_TOOL[e] ? row.engines[e]?.impressions ?? null : null);
  const hasImpressions = (e) => Boolean(OWN_TOOL[e]);
  const googleOnly = (e) => e === "google";
  const showCol = (key, e) => state.cols[key] && (key === "vol" ? hasImpressions(e) : key === "ai" ? googleOnly(e) : true);
  /* The page that ranked: this engine's newest check. On Google, Search Console's most-shown page is said apart when it differs. */
  function pageCell(row, e) {
    const view = row.engines[e], url = view.main?.url || null;
    const gsc = e === "google" && row.gsc_page && (!url || row.gsc_page.replace(/\/$/, "") !== url.replace(/\/$/, "")) ? row.gsc_page : null;
    const changed = view.url_changed ? `<span class="kw-url-changed" data-tip="${esc(t("The ranking page changed since the last check."))}">${esc(t("URL changed"))}</span>` : "";
    const main = url ? PageLink.html(url, { text: shortPath(url), title: "" }) : '<span class="muted dash">—</span>';
    const most = gsc ? `<span class="second kw-gsc-page" data-tip="${esc(`${t("Most shown in Search Console")}: ${gsc}`)}"><span class="sr">${esc(t("Most shown in Search Console"))}: </span>${brandLabel("Search Console")} ${PageLink.html(gsc, { text: shortPath(gsc), title: "" })}</span>` : "";
    const two = e === "google" && row.two_pages ? `<span class="warn" role="img" data-tip="${esc(t("Two of your pages rank for it."))}" aria-label="${esc(t("Two pages compete"))}">${icon("triangle-alert")}</span>${competingPages(row)}` : "";
    return `<td class="url-cell mono small" data-label="${t("Page")}" ${url ? `data-tip="${esc(url)}"` : ""}>${main}${changed}${two}${most}</td>`;
  }
  /* A row's check is old: amber, with its age, in simple mode too. When the main tool's check was too old and a newer one
     from another tool is shown, the badge says so (store.pick_main). */
  function oldMark(m) {
    if (!m) return "";
    if (m.passed_over) {
      const words = t("{tool}'s check is {age} old, so this newer one is shown.").replace("{tool}", t(m.passed_over.tool)).replace("{age}", age(m.passed_over.age_days));
      return `<span class="kw-age kw-age-old" role="img" data-tip="${esc(words)}" aria-label="${esc(words)}">${icon("clock")}${esc(age(m.passed_over.age_days))}</span>`;
    }
    if (!(m.old || m.age_days > OLD_DAYS)) return "";
    const words = t("Checked {age} ago.").replace("{age}", age(m.age_days));
    return `<span class="kw-age kw-age-old" role="img" data-tip="${esc(words)}" aria-label="${esc(words)}">${icon("clock")}${esc(age(m.age_days))}</span>`;
  }
  function passes(row, e) {
    const view = row.engines[e], p = view.main?.status === "ok" ? view.main.p : null;
    switch (state.filter) {
      case "top3": return p && p <= 3;
      case "top10": return p && p <= 10;
      case "up": return goesUp(view);
      case "down": return goesDown(view);
      case "none": return notRanked(view);
      case "cited": return row.ai.state === "cited";
      case "two": return row.two_pages;
      case "run": return Boolean(K.runFilter?.has(row.id));
      default: return true;
    }
  }
  /* The search box: words of the keyword, or of its site or page, ignoring case and accents. */
  const searched = (rows) => rows.filter((row) => TP.matches(KW_PAGES, row.keyword, row.page, state.site === "all" ? row.site : ""));
  function filtered() {
    const e = engineOf();
    K.worldCol = state.engine !== "all" && e === "google" && allRows().some((row) => localOf(row, e)); // read by ownCell, rowHtml and table
    const value = (row) => { const v = row.engines[e]; return { k: row.keyword, own: K.worldCol ? localOf(row, e)?.position ?? null : v.own, world: v.own, pos: v.main?.status === "ok" ? v.main.p : null, chg: v.move === "lost" ? -1000 : v.move === "new" ? 1000 : v.change, vol: impressionsOf(row, e) }[state.sort.key]; };
    const sign = state.sort.dir === "ascending" ? 1 : -1;
    return searched(allRows()).filter((row) => passes(row, e)).sort((a, b) => {
      const x = value(a), y = value(b);
      if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1; // unknowns go last, whichever way it's sorted
      if (y === null || y === undefined) return -1;
      return (typeof x === "string" ? x.localeCompare(y, UI.locale()) : x - y) * sign;
    });
  }

  /* A column heading sorts; its definition (shared-ui.js) shows on hover and on keyboard focus of the heading's button. */
  function sortHeader(key, label, align = "", sub = "", tip = "", brand = false) {
    const on = state.sort.key === key;
    const def = tip || UI.def?.(UI.defKey?.(key === "vol" ? "Impressions (28 days)" : key === "own" ? "avg position" : label)) || "";
    return `<th scope="col" class="${align}" ${on ? `aria-sort="${state.sort.dir}"` : ""}><button data-sort="${key}" ${def ? `data-tip="${esc(def)}"` : ""}><span>${brand ? brandLabel(label) : esc(label)}${sub ? `<span class="th-sub">${esc(sub)}</span>` : ""}</span>${icon(on && state.sort.dir === "ascending" ? "arrow-up" : "arrow-down")}</button></th>`;
  }

  function rowHtml(row) {
    const e = engineOf(), view = row.engines[e];
    const trend = view.trend.length >= 2 ? UI.spark(view.trend.map((x) => x.p), { invert: true }) : `<span class="muted dash" data-tip="${t("Needs 2 checks, same tool")}" aria-label="${t("Needs 2 checks, same tool")}" role="img">—</span>`;
    const cells = state.engine === "all"
      ? ENGINES.map(([id, label]) => `<td data-label="${label}">${scrapedCell(row, id)}</td>`).join("")
      : `${OWN_TOOL[e] ? `<td class="c" data-label="${OWN_TOOL[e]} · ${t(K.worldCol ? "in its country" : "avg position")}">${ownCell(view, row, e)}</td>` : ""}
         ${K.worldCol ? `<td class="c" data-label="${t("All countries")}">${worldCell(view)}</td>` : ""}
         <td data-label="${t("Our check")}">${scrapedCell(row, e)}</td>
         <td class="c" data-label="${t("Change")}">${changeCell(view)}</td>
         ${showCol("vol", e) ? `<td class="c" data-label="${t("Impressions (28 days)")}">${impressionsOf(row, e) === null ? '<span class="muted dash">—</span>' : e === "google" && row.spellings > 1 ? `<span class="tabular" data-tip="${esc(t("includes {n} spellings").replace("{n}", row.spellings))}">${num(impressionsOf(row, e))}<sup class="kw-spell" aria-hidden="true">${row.spellings}</sup><span class="sr"> (${esc(t("includes {n} spellings").replace("{n}", row.spellings))})</span></span>` : num(impressionsOf(row, e))}</td>` : ""}
         ${state.cols.trend ? `<td data-label="${t("Trend")}">${trend}</td>` : ""}
         ${state.cols.page ? pageCell(row, e) : ""}
         ${showCol("ai", e) ? `<td data-label="${t("AI")}">${aiCell(row)}</td>` : ""}`;
    // The simpler screens: the keyword is text and the whole row opens the panel (a click, or Enter once the row has focus).
    // data-kwr-open stays on the keyword, holding only its words, so a click on it and the flows that look for it still work.
    const kwName = simple()
      ? `<span class="kw" data-kwr-open="${esc(row.id)}" dir="auto">${esc(row.keyword)}</span>`
      : `<button class="kw" data-kwr-open="${esc(row.id)}" dir="auto" style="text-align:start">${esc(row.keyword)}</button>`;
    return `<tr data-kwr-row="${esc(row.id)}" class="${K.selected.has(row.id) ? "sel" : ""} ${K.panel?.id === row.id && $("#panel") ? "open" : ""}" ${simple() ? 'tabindex="0"' : ""}>
      <td class="chk-cell"><input type="checkbox" class="chk" data-kwr-select="${esc(row.id)}" ${K.selected.has(row.id) ? "checked" : ""} aria-label="${t("selected")}: ${esc(row.keyword)}"></td>
      <td class="head-cell">${kwName}${state.site === "all" ? `<span class="second mono" dir="auto">${esc(row.site)}</span>` : ""}</td>
      ${cells}</tr>`;
  }

  function table(all) {
    K.shownList = null;
    if (!all.length && kwPages().q.trim()) return `<div class="table-wrap"><div class="empty"><h3>${t("No keyword matches.")}</h3><p dir="auto">${esc(kwPages().q.trim())}</p><button class="btn" data-kwr-search-clear>${t("Clear search")}</button></div></div>`;
    if (!all.length) return `<div class="table-wrap"><div class="empty"><h3>${t("No keyword matches")}</h3><p>${t("Try another filter.")}</p><button class="btn" data-filter="all">${t("Show all")}</button></div></div>`;
    const view = TP.view(KW_PAGES, all), rows = view.rows;
    // A pick counts on the page it was made on, so the bar acts on what's in view. After "Select all N keywords" in the bar,
    // picks count on every page of this list (its chip, search and filters) until the selection is cleared.
    const here = new Set((K.allPages ? view.list : rows).map((row) => row.id));
    [...K.selected].forEach((id) => { if (!here.has(id)) K.selected.delete(id); });
    if (!K.selected.size) K.allPages = false;
    const e = engineOf();
    const head = state.engine === "all"
      ? ENGINES.map(([id, label]) => `<th scope="col"><span class="th-engine">${logo(id, 16)}${label}</span></th>`).join("")
      : `${OWN_TOOL[e] ? sortHeader("own", OWN_TOOL[e], "c", t(K.worldCol ? "in its country" : "avg position"), K.worldCol ? t("Search Console's average position in the keyword's own country.") : "", true) : ""}
         ${K.worldCol ? sortHeader("world", t("All countries"), "c", t("avg position"), t("Search Console's average position across every country.")) : ""}
         ${sortHeader("pos", t("Our check"), "", "", UI.def?.(UI.defKey?.("Scraped results")) || "")}${sortHeader("chg", t("Change"), "c", t("vs last check"))}
         ${showCol("vol", e) ? sortHeader("vol", t("Impressions"), "c", e === "google" ? t("28 days") : t(OWN_TOOL[e]), e === "google" ? t("Search Console impressions, last 28 days. Exact volume isn't available for free.") : "") : ""}
         ${state.cols.trend ? `<th scope="col">${t("Trend")}</th>` : ""}${state.cols.page ? `<th scope="col"><span data-tip="${esc(t("The page our check found. Search Console's most-shown page over 28 days is another one."))}">${t("Page")}</span></th>` : ""}${showCol("ai", e) ? `<th scope="col">${t("AI")}</th>` : ""}`;
    const every = rows.length > 0 && rows.every((row) => K.selected.has(row.id));
    K.shownList = { total: view.total, pageFull: every };
    const quiet = simple(), source = quiet ? sourceLine(rows) : "";
    return `<div class="ov-list"><div class="table-wrap ${state.dense ? "dense" : ""}"><table class="data" id="kw-table" aria-label="${t("Keywords")}" ${quiet ? "data-tt-own-count" : ""}>
      <thead><tr><th scope="col" class="chk-cell"><input type="checkbox" class="chk" id="kwr-select-all" ${every ? "checked" : ""} aria-label="${t("All")}"></th>${sortHeader("k", t("Keyword"))}${head}</tr></thead>
      <tbody>${rows.map(rowHtml).join("")}</tbody></table></div>${TP.footer(KW_PAGES, view, { noun: t(view.total === 1 ? "keyword" : "keywords") })}${source}</div>`;
  }
  /* The simpler screens: which tool read the rows on show, and how long ago, said once under the table ("Scraped results:
     SerpApi · 14 min – 2 d"). When they all share one tool, the rows leave its logo out (K.oneTool, read by scrapedCell). */
  function sourceLine(rows) {
    const e = engineOf(), mains = state.engine === "all" ? [] : rows.map((row) => row.engines[e]?.main).filter(Boolean);
    const tools = [...new Set(mains.map((m) => m.tool))];
    K.oneTool = tools.length === 1;
    if (!mains.length) return "";
    const ages = mains.map((m) => m.age_days).filter((a) => a !== null && a !== undefined).sort((a, b) => a - b);
    const newest = ages.length ? age(ages[0]) : "", oldest = ages.length ? age(ages[ages.length - 1]) : "";
    const when = newest === oldest ? newest : `${newest} – ${oldest}`;
    return `<p class="kw-src small muted" id="kw-src">${t("Checked by")}: ${tools.map((tool) => `<span class="kw-src-tool">${logo(tool, 14)}${esc(t(tool))}</span>`).join(", ")}${when ? ` · ${esc(when)}` : ""}</p>`;
  }

  /* The heading's box ticks the page on show; the bar offers the whole list, on every page, as Gmail does. */
  function selectionBar() {
    if (!K.selected.size) return "";
    const n = K.selected.size, list = K.shownList;
    // Offered from the first tick, since on a phone the rows are cards with no heading box to tick a whole page.
    const offer = Boolean(list) && list.total > n;
    const words = K.allPages && list && n === list.total ? fill("All {n} keywords selected", num(n)) : offer && !K.allPages && list.pageFull ? fill("{n} selected on this page", num(n)) : `${num(n)} ${t("selected")}`;
    return `<div class="selbar" id="kwr-selbar" role="region" aria-label="${t("selected")}"><b>${words}</b>${offer ? `<button class="link-btn kwr-sel-all" id="kwr-sel-all">${fill("Select all {n} keywords", num(list.total))}</button>` : ""}
      <button class="btn btn-main btn-small" id="kwr-sel-refresh">${icon("refresh-cw")}${t("Refresh")}</button>
      <button class="btn btn-small" id="kwr-sel-task">${t("Create task")}</button>
      <button class="icon-btn" id="kwr-sel-clear" aria-label="${t("Clear selection")}" data-tip="${t("Clear selection")}">${icon("x")}</button></div>`;
  }

  function bucketView(rows) {
    const e = engineOf();
    const pos = rows.map((row) => (row.engines[e].main?.status === "ok" ? row.engines[e].main.p : null));
    const buckets = [["1-3", pos.filter((p) => p && p <= 3).length], ["4-10", pos.filter((p) => p > 3 && p <= 10).length], ["11-20", pos.filter((p) => p > 10 && p <= 20).length], ["21+", pos.filter((p) => p > 20).length], [t("Not ranked"), rows.filter((row) => notRanked(row.engines[e])).length]];
    const max = Math.max(...buckets.map((b) => b[1]), 1);
    return `<section class="card" style="padding:16px">${buckets.map(([label, n]) => `
      <div style="display:grid;grid-template-columns:90px 1fr 30px;gap:10px;align-items:center;padding:6px 0;font-size:13px">
        <span class="sec">${label}</span><span class="bucket-bar"><span style="width:${(n / max) * 100}%"></span></span><span class="tabular" style="text-align:center;font-weight:600">${num(n)}</span></div>`).join("")}</section>`;
  }

  function queriesView() {
    const e = engineOf();
    if (e === "duckduckgo") return `<p class="note">${UI.tip("DuckDuckGo has no tool for site owners, so the app checks its positions by itself every day, oldest first, on free searches only. Refresh and Refresh data check them now.").trim()}<span>${t("Checked daily by itself, on free searches.")}</span></p>`;
    const key = `${e}`;
    if (!K.queries[key]) { K.queries[key] = "loading"; api("GET", `rankings/queries?engine=${e}`).then((answer) => { K.queries[key] = answer.rows; if (state.view === "queries") UI.render({ keepScroll: true }); }).catch(() => { K.queries[key] = []; if (state.view === "queries") UI.render({ keepScroll: true }); }); }
    if (K.queries[key] === "loading") return UI.skeleton("table", { rows: 8 });
    const host = UI.siteHostPicked();
    const rows = K.queries[key].filter((row) => !host || row.site === host);
    if (!rows.length) {
      const words = e === "google" ? ["No Search Console data yet", "Connect it in Settings; queries appear within 3 days."] : [e === "bing" ? "No Bing Webmaster data yet" : "No Yandex Webmaster data yet", "Connect it in Settings; queries appear here."];
      return `<div class="table-wrap"><div class="empty"><h3>${t(words[0])}</h3><p>${t(words[1])}</p><button class="btn" data-go="settings">${t("Open Settings")}</button></div></div>`;
    }
    const tracked = new Set(allRows().map((row) => `${row.site}|${kwKey(row.keyword)}`)); // "cafe" is tracked when "café" is
    const found = sortedQueries(rows.filter((row) => TP.matches(Q_PAGES, row.query, state.site === "all" ? row.site : "")));
    const tools = `<div class="kw-find">${TP.search(Q_PAGES, t("Search queries"))}</div>`;
    if (!found.length) return `${tools}<div class="table-wrap"><div class="empty"><h3>${t("No query matches.")}</h3><p dir="auto">${esc(TP.state(Q_PAGES).q.trim())}</p><button class="btn" data-kwq-search-clear>${t("Clear search")}</button></div></div>`;
    const view = TP.view(Q_PAGES, found);
    const head = (id, label) => {
      const on = K.qsort?.id === id;
      return `<th scope="col" class="c" aria-sort="${on ? (K.qsort.dir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" class="th-btn" data-kwq-sort="${id}">${label}${on ? icon(K.qsort.dir === "asc" ? "arrow-up" : "arrow-down") : ""}</button></th>`;
    };
    return `${tools}<div class="ov-list"><div class="table-wrap"><table class="data" id="kwq-table"><thead><tr><th scope="col">${t("Keyword")}</th>${head("clicks", t("Clicks"))}${head("impressions", "Impressions")}${head("ctr", t("Click rate"))}${head("position", t("Position"))}<th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead>
      <tbody>${view.rows.map((row) => `<tr style="cursor:default"><td class="head-cell kw">${KeywordLink.html(row.query, { host: row.site })}${state.site === "all" ? `<span class="second mono">${esc(row.site)}</span>` : ""}</td><td class="c" data-label="${t("Clicks")}">${num(row.clicks)}</td><td class="c" data-label="Impressions">${num(row.impressions)}</td><td class="c" data-label="${t("Click rate")}">${row.impressions ? `${dec(Math.round((row.clicks / row.impressions) * 1000) / 10)}%` : "—"}</td><td class="c" data-label="${t("Position")}">${row.position === null ? "—" : dec(Math.round(row.position * 10) / 10)}</td><td class="r">${tracked.has(`${row.site}|${kwKey(row.query)}`) ? "" : `<button class="btn btn-small" data-kwr-follow="${esc(row.query)}" data-site-host="${esc(row.site)}">${t("Track")}</button>`}</td></tr>`).join("")}</tbody></table></div>
      ${TP.footer(Q_PAGES, view, { noun: t(view.total === 1 ? "query" : "queries") })}</div>`;
  }
  /* The Queries table keeps the server's order (most clicks first) until a heading is pressed. Numbers go biggest first,
     the position best first; a third press goes back to the usual order. */
  const Q_SORTS = {
    clicks: { get: (row) => row.clicks, first: "desc" }, impressions: { get: (row) => row.impressions, first: "desc" },
    ctr: { get: (row) => (row.impressions ? row.clicks / row.impressions : null), first: "desc" }, position: { get: (row) => row.position, first: "asc" },
  };
  function sortedQueries(rows) {
    if (!K.qsort || !Q_SORTS[K.qsort.id]) return rows;
    const { get } = Q_SORTS[K.qsort.id], dir = K.qsort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1; // unknowns go last, whichever way
      if (y === null || y === undefined) return -1;
      return (x - y) * dir;
    });
  }

  /* An engine no connected tool can search, with nothing checked on it and no webmaster numbers: one card instead of a table
     of "Not checked" rows (2026-11-17). Its own webmaster tool's numbers, when there are some, keep the table. */
  function noToolCard(rows) {
    const e = state.engine;
    if (e === "all" || !K.tools) return "";
    if (K.tools.some((tool) => tool.connected && (tool.engines || []).includes(e))) return "";
    if (rows.some((row) => row.engines[e]?.main || row.engines[e]?.away?.length || (row.engines[e]?.own !== null && row.engines[e]?.own !== undefined))) return "";
    return `<div class="table-wrap kw-engine-empty"><div class="empty"><h3>${esc(t("{engine} isn't checked: no tool can search it.").replace("{engine}", name(e)))}</h3><p>${t("Connect one in Settings, then press Refresh.")}</p><button class="btn" data-go="settings">${t("Open Settings")}</button></div></div>`;
  }
  /* When every connected tool for this engine has no free checks left, Keywords says so where the unchecked rows are. */
  function outOfChecks(rows) {
    const e = engineOf();
    const tools = (K.tools || []).filter((tool) => tool.connected && (tool.engines || []).includes(e) && !tool.manual_only);
    if (!tools.length || tools.some((tool) => tool.left === null || tool.left === undefined || tool.left > 0)) return "";
    const waiting = rows.filter((row) => !row.engines[e]?.main).length;
    const refill = tools.every((tool) => tool.refills === "one-time") ? t("They don't refill; connect another tool in Settings.") : t("They refill monthly, or connect another tool in Settings.");
    return `<div class="note warn" role="status">${icon("triangle-alert")}<span><b>${t("No free checks left for")} ${esc(name(e))}.</b> ${waiting ? `${num(waiting)} ${t(waiting === 1 ? "keyword stays Not checked." : "keywords stay Not checked.")} ` : ""}${refill} <button class="link-btn" data-go="settings">${t("Open Settings")}</button></span></div>`;
  }

  /* The newest check on screen, whether a Refresh made it or the first check after adding: the header and the rows agree. */
  function lastCheckWords(rows) {
    let newest = null;
    const only = state.engine === "all" ? ENGINES : ENGINES.filter(([e]) => e === state.engine); // this tab's engine only
    rows.forEach((row) => only.forEach(([e]) => { const a = row.engines[e]?.main?.age_days; if (a !== null && a !== undefined && (newest === null || a < newest)) newest = a; }));
    const refreshAge = K.data.last_refresh ? (Date.now() - new Date(K.data.last_refresh).getTime()) / 864e5 : null;
    if (refreshAge !== null && (newest === null || refreshAge <= newest + 1 / 1440)) return `${t("Refreshed")} ${esc(UI.fmtStamp(K.data.last_refresh))}`;
    if (newest === null) return t("No check yet");
    return `${t("Last check")} ${esc(age(newest))}`;
  }

  function page() {
    const title = t("Keywords"), lead = t("Rankings from engines' own tools and our own checks");
    const addButton = `<button class="btn" id="kwr-add">${icon("plus")}${t("Add keywords")}</button>`;
    if (K.stale && !K.loading) load();
    if (!K.data) {
      const body = K.error ? UI.failCard(K.error, { title: "Couldn't load the keywords.", retry: 'id="kwr-retry"' }) : UI.skeleton("page", { chart: false, rows: 8 });
      return UI.topbar(title, lead, "", false) + `<div class="content page-enter">${body}</div>`;
    }
    if (!window.BOOT.sites.length && !window.SITES.length) {
      return UI.topbar(title, lead, "", false) + `<div class="content page-enter"><div class="table-wrap"><div class="empty"><h3>${t("Add a site first")}</h3><p>${t("Keywords belong to a site.")}</p><button class="btn btn-main" data-go="settings">${t("Open Settings")}</button></div></div></div>`;
    }
    const all = allRows();
    if (!all.length) {
      return UI.topbar(title, lead, "", false) + `<div class="content page-enter"><div class="table-wrap"><div class="empty"><h3>${t("No keywords yet")}</h3><p>${t("Add the keywords to follow.")}</p><button class="btn btn-main" id="kwr-add">${t("Add keywords")}</button></div></div>${ideasCard()}</div>`;
    }
    const e = engineOf();
    const local = K.data.tiles[e], view = (row) => row.engines[e], good = (row) => (view(row).main?.status === "ok" ? view(row).main.p : null);
    const found = searched(all);
    const counts = { all: found.length, top3: found.filter((r) => good(r) && good(r) <= 3).length, top10: found.filter((r) => good(r) && good(r) <= 10).length, up: found.filter((r) => goesUp(view(r))).length, down: found.filter((r) => goesDown(view(r))).length, none: found.filter((r) => notRanked(view(r))).length, cited: found.filter((r) => r.ai.state === "cited").length, two: found.filter((r) => r.two_pages).length };
    const moved = (() => { // the same rule as the server's tile, on the rows this site shows
      let change = 0, compared = 0;
      all.forEach((r) => { if (!view(r).move) return; compared += 1; change += top10Step(view(r)); });
      return { change, compared };
    })();
    const chips = [["all", "All"], ["top3", "Top 3"], ["top10", "Top 10"], ["up", "Up"], ["down", "Down"], ["none", "Not ranked"], ["cited", "Cited by AI"], ["two", "Two pages compete"], ...(K.runFilter?.size ? [["run", "This Refresh"]] : [])];
    counts.run = found.filter((r) => K.runFilter?.has(r.id)).length;
    const shown = filtered();
    if (simple()) return simplePage({ title, all, e, good, counts, chips, shown, moved, addButton });
    const body = state.view === "bucket" ? bucketView(all) : state.view === "queries" ? queriesView() : `
      <div class="kw-find">${TP.search(KW_PAGES, t("Search keywords"))}</div>
      <div class="chips" role="group" aria-label="${t("Keywords")}">
        ${chips.map(([id, label]) => `<button class="chip" data-filter="${id}" aria-pressed="${state.filter === id}">${t(label)}<b>${num(counts[id])}</b></button>`).join("")}
        <span style="margin-left:auto" class="table-tools">
          <button class="icon-btn" id="density" aria-label="${t(state.dense ? "Comfortable rows" : "Compact rows")}" data-tip="${t(state.dense ? "Comfortable rows" : "Compact rows")}">${icon("rows-3")}</button>
          <button class="icon-btn" id="columns" aria-label="${t("Columns")}" data-tip="${t("Columns")}">${icon("columns-3")}</button>
        </span>
      </div>
      ${state.engine === "duckduckgo" ? `<p class="note">${UI.tip("DuckDuckGo has no tool for site owners, so the app checks its positions by itself every day, oldest first, on free searches only. Refresh and Refresh data check them now.").trim()}<span>${t("Checked daily by itself, on free searches.")}</span></p>` : ""}
      ${outOfChecks(all)}
      ${noToolCard(all) || `${table(shown)}${selectionBar()}`}`;
    const sub = [K.data.data_through ? `${t("Data through")} ${UI.fmtDateOnly(K.data.data_through)}` : "", lastCheckWords(all)].filter(Boolean).join(" · ");
    const phone = phoneActions();
    const main = `${addButton}<button class="btn ${K.selected.size ? "" : "btn-main"}" id="kwr-refresh">${icon("refresh-cw")}${t("Refresh")}</button>`;
    return UI.topbar(title, sub, main, false) + `
      <div class="content page-enter">
        ${phone}
        <section class="tiles" id="kw-tiles">
          ${UI.tile(t("Tracked"), num(all.length), "", { ic: "key-round" })}
          ${UI.tile(t("Ranked"), num(all.filter((r) => good(r)).length), `<span class="ab">${t("of")} ${num(all.length)} · ${brandLabel(name(e))}</span>`, { ic: "list-ordered" })}
          ${UI.tile(`${t("Top 10")} <span class="muted">· ${t(state.engine === "all" ? "Google only" : "our checks")}</span>`, num(all.filter((r) => good(r) && good(r) <= 10).length), moved.compared ? `${moved.change ? UI.delta(moved.change, { noWord: false }) : ""}<span class="ab">${num(moved.compared)} ${t("compared")}</span>` : "", { ic: "target" })}
          ${googleOnly(state.engine) || state.engine === "all" ? UI.tile(`${t("Cited by AI")}${state.engine === "all" ? ` <span class="muted kw-google-only">· ${t("Google only")}</span>` : ""}`, num(all.filter((r) => r.ai.state === "cited").length), `<span class="ab">${t("of")} ${num(all.length)}</span>`, { ic: "sparkles" }) : ""}
        </section>
        <div class="tabs-row">
          <div class="tabs" role="tablist" aria-label="${t("Engines")}">
            ${[...ENGINES, ["all", t("All engines")]].map(([id, label]) => `<button class="tab" role="tab" data-engine="${id}" aria-selected="${state.engine === id}">${id === "all" ? "" : logo(id, 16)}${label}</button>`).join("")}
          </div>
          <span class="seg" role="group" aria-label="${t("Positions")}">${[["positions", "Positions"], ["bucket", "By bucket"], ["queries", "Queries"]].map(([id, label]) => `<button data-view="${id}" aria-pressed="${state.view === id}">${t(label)}</button>`).join("")}</span>
        </div>
        ${body}
        ${ideasCard()}
      </div>`;
  }

  /* On a phone the top bar's buttons shrink to icons in a corner, so the screen's two actions sit, labelled, above the cards. */
  const phoneActions = () => `<div class="kwr-phone-acts" role="group" aria-label="${t("Phone actions")}"><button class="btn" id="kwr-add-phone">${icon("plus")}${t("Add keywords")}</button><button class="btn ${K.selected.size ? "" : "btn-main"}" id="kwr-refresh-phone">${icon("refresh-cw")}${t("Refresh")}</button></div>`;

  /* ---- the simpler screens' Keywords (see simple() at the top) ------------------------------------------------------------ */
  const DDG_HOW = "DuckDuckGo has no tool for site owners, so the app checks its positions by itself every day, oldest first, on free searches only. Refresh and Refresh data check them now.";
  // The tool of the newest check on screen, for the head's "Last check 29 min with SerpApi".
  function newestTool(rows) {
    let best = null;
    const only = state.engine === "all" ? ENGINES : ENGINES.filter(([e]) => e === state.engine); // this tab's engine only
    rows.forEach((row) => only.forEach(([e]) => { const m = row.engines[e]?.main; if (m && m.age_days !== null && m.age_days !== undefined && (!best || m.age_days < best.age_days)) best = m; }));
    return best?.tool || "";
  }
  // The head's line: where the engines' own numbers come from and how fresh, then the last check and its tool.
  function headLine(all) {
    const day = String(K.data.data_through || "").slice(0, 10), e = state.engine;
    // Search Console's date is Google's: said on the Google and All engines tabs. Bing's and Yandex's tabs name their own tool.
    const own = e === "google" || e === "all"
      ? (/^\d{4}-\d{2}-\d{2}$/.test(day) ? `<span class="head-src">${brandLabel("Search Console")}, ${esc(t("through {day}").replace("{day}", UI.fmtDay(day, { day: "numeric", month: "short" })))}</span>` : "")
      : OWN_TOOL[e] && all.some((row) => row.engines[e]?.own !== null && row.engines[e]?.own !== undefined) ? `<span class="head-src">${brandLabel(OWN_TOOL[e])}</span>` : "";
    const tool = newestTool(all);
    const last = `<span class="head-src">${lastCheckWords(all)}${tool ? ` ${esc(t("with {tool}").split("{tool}")[0])}${brandLabel(tool)}${esc(t("with {tool}").split("{tool}")[1] || "")}` : ""}</span>`;
    return [own, last].filter(Boolean).join('<span class="head-sep"> · </span>');
  }
  function simplePage({ title, all, e, good, counts, chips, shown, moved, addButton }) {
    const ranked = all.filter((r) => good(r)).length, top10 = all.filter((r) => good(r) && good(r) <= 10).length, cited = all.filter((r) => r.ai.state === "cited").length;
    const views = [["positions", "Positions"], ["bucket", "By bucket"], ["queries", "Queries"]];
    const positions = state.view !== "bucket" && state.view !== "queries";
    // One search and one Filter (2026-11-12): the chips, the view, compact rows, columns and the per-column filter sit inside it.
    const active = (state.filter !== "all" ? 1 : 0) + (positions ? 0 : 1);
    const filterButton = `<button type="button" class="btn btn-small kw-filter-btn" id="kw-filter" aria-expanded="${K.filterOpen ? "true" : "false"}" aria-controls="kw-filter-panel">${icon("filter")}${t("Filter")}<b class="tt-count" id="kw-filter-count" data-base="${active}" ${active ? "" : "hidden"}>${num(active)}</b></button>`;
    const panel = !K.filterOpen ? (positions ? '<span class="kw-tt-slot" data-tt-slot="kw-table" hidden></span>' : "") : `<div class="kw-filter-panel" id="kw-filter-panel" role="group" aria-label="${t("Filter")}">
        ${positions ? `<div class="kw-fp-row"><span class="kw-fp-lab" id="kw-fp-show">${t("Show")}</span><div class="chips" role="group" aria-labelledby="kw-fp-show">${chips.map(([id, label]) => `<button class="chip" data-filter="${id}" aria-pressed="${state.filter === id}">${t(label)}<b>${num(counts[id])}</b></button>`).join("")}</div></div>` : ""}
        <div class="kw-fp-row"><span class="kw-fp-lab" id="kw-fp-view">${t("View")}</span><span class="seg kw-views" role="group" aria-labelledby="kw-fp-view">${views.map(([id, label]) => `<button data-view="${id}" aria-pressed="${state.view === id}">${t(label)}</button>`).join("")}</span></div>
        ${positions ? `<div class="kw-fp-row"><span class="kw-fp-lab">${t("Rows")}</span><button type="button" class="btn btn-small" id="density" aria-pressed="${state.dense ? "true" : "false"}">${icon("rows-3")}${t("Compact rows")}</button></div>
        <div class="kw-fp-row"><span class="kw-fp-lab" id="kw-fp-cols">${t("Columns")}</span><span class="kw-fp-cols" role="group" aria-labelledby="kw-fp-cols">${Object.entries({ vol: "Impressions (28 days)", trend: "Trend", page: "Page", ai: "AI" }).map(([k, label]) => `<label class="opt"><input type="checkbox" class="chk" style="margin:0" data-col="${k}" ${state.cols[k] ? "checked" : ""}>${t(label)}</label>`).join("")}</span></div>
        <div class="kw-fp-row"><span class="kw-fp-lab">${t("By column")}</span><span class="kw-tt-slot" data-tt-slot="kw-table"></span></div>` : ""}
        <div class="kw-fp-end"><button type="button" class="link-btn" id="kw-filter-close">${t("Close filters")}</button></div>
      </div>`;
    const bar = `<div class="kw-bar">${positions ? `<div class="kw-find">${TP.search(KW_PAGES, t("Search keywords"))}</div>` : ""}<span class="kw-bar-end">${filterButton}</span></div>${panel}`;
    const body = state.view === "bucket" ? bar + bucketView(all) : state.view === "queries" ? bar + queriesView() : `${bar}
      ${outOfChecks(all)}
      ${noToolCard(all) || `${table(shown)}${selectionBar()}`}`;
    const main = `${addButton}<button class="btn ${K.selected.size ? "" : "btn-main"}" id="kwr-refresh">${icon("refresh-cw")}${t("Refresh")}</button>`;
    const head = UI.head({ title, period: false, line: headLine(all), info: ["Rankings from engines' own tools and our own checks"], main });
    return head + `
      <div class="content page-enter kw-simple">
        ${phoneActions()}
        <div class="kw-tabs-row">
          <div class="page-tabs kw-engines" role="tablist" aria-label="${t("Engines")}">
            ${[...ENGINES, ["all", t("All engines")]].map(([id, label]) => `<button class="page-tab" role="tab" data-engine="${id}" aria-selected="${state.engine === id}">${id === "all" ? "" : logo(id, 16)}${label}</button>`).join("")}
          </div>
          ${state.engine === "duckduckgo" ? UI.info(DDG_HOW) : ""}
        </div>
        <section class="tiles" id="kw-tiles">
          ${UI.card({ id: "kw-tracked", label: t("Tracked"), value: all.length, cls: "tile" })}
          ${UI.card({ id: "kw-ranked", label: t("Ranked"), value: ranked, sub: `${t("of")} ${num(all.length)} · ${brandLabel(name(e))}`, cls: "tile" })}
          ${UI.card({ id: "kw-top10", label: `${t("Top 10")} <span class="muted">· ${t(state.engine === "all" ? "Google only" : "our checks")}</span>`, def: "Top 10", value: top10, change: moved.compared ? { value: moved.change, unit: "" } : null, sub: moved.compared ? `${num(moved.compared)} ${t("compared")}` : "", cls: "tile" })}
          ${googleOnly(state.engine) || state.engine === "all" ? UI.card({ id: "kw-cited", label: `${t("Cited by AI")}${state.engine === "all" ? ` <span class="muted kw-google-only">· ${t("Google only")}</span>` : ""}`, value: cited, sub: `${t("of")} ${num(all.length)}`, cls: "tile" }) : ""}
        </section>
        ${body}
      </div>`;
  }

  // ---- add keywords ---------------------------------------------------------------------------
  /* Keyword ideas inside the Add keywords panel (simpler screens). Its search redraws the screen (screens-live.js), so after()
     draws the ideas again here, only when they changed, keeping the keyboard on the same control. */
  const ideasHtml = () => { K.ideasDrawn = ideasCard(); return K.ideasDrawn; };
  function redrawIdeas() {
    const slot = $("#kwr-ideas-slot");
    if (!slot) return;
    const html = ideasCard();
    if (html === K.ideasDrawn) return;
    const focused = slot.contains(document.activeElement) ? document.activeElement : null;
    const again = focused?.name ? `[name="${CSS.escape(focused.name)}"]` : focused?.type === "submit" ? "button[type=submit]" : null;
    K.ideasDrawn = html;
    UI.setHTML(slot, html);
    shareMarket();
    if (again) $(again, slot)?.focus({ preventScroll: true });
  }
  /* Add keywords with Keyword ideas has one Country and one Language: the form's. The ideas' own two pickers are hidden (CSS)
     and follow the form's, so a search for ideas and the keywords saved use the same place. */
  function shareMarket() {
    const ideas = $("#kwr-ideas-slot [data-lv-ideas]");
    if (!ideas) return;
    const c = $("#kwr-add-country"), l = $("#kwr-add-language");
    if (c && ideas.f_country) ideas.f_country.value = c.value;
    if (l && ideas.f_language) ideas.f_language.value = l.value;
  }
  // An idea's Add, or Add all, inside the panel: the words join the list (once each), with the ideas' country and language.
  function addToList(words, market, opener) {
    const box = $("#kwr-add-text");
    if (!box) return;
    const have = new Set(box.value.split("\n").map((w) => w.trim().toLowerCase()).filter(Boolean));
    const fresh = words.filter((w) => !have.has(String(w).trim().toLowerCase()));
    box.value = [box.value.replace(/\s+$/, ""), ...fresh].filter(Boolean).join("\n");
    if (market.country !== undefined) { const c = $("#kwr-add-country"); if (c) c.value = String(market.country || "").toUpperCase(); }
    if (market.language !== undefined) { const l = $("#kwr-add-language"); if (l) l.value = market.language || ""; }
    const why = $("#kwr-add-why");
    if (why && market.why) { why.textContent = t(market.why); why.hidden = false; }
    // The pressed Add says the word is in the list; Add all is spent once every idea is.
    if (opener?.matches?.("[data-lv-idea]")) { opener.disabled = true; UI.setHTML(opener, `${icon("check")}${t("In the list")}`); }
    if (opener?.matches?.("[data-lv-idea-all]")) $$("#kwr-ideas-slot [data-lv-idea]").forEach((b) => { b.disabled = true; UI.setHTML(b, `${icon("check")}${t("In the list")}`); });
    UI.toast(`${num(fresh.length)} ${t(fresh.length === 1 ? "keyword" : "keywords")} · ${t("In the list")}`, { kind: "info" });
  }
  function addPanel(opener, prefill = "", hostWanted = null, market = {}) {
    const sites = window.BOOT.sites.length ? window.SITES.filter((s) => window.BOOT.sites.some((x) => x.host === s.host)) : window.SITES;
    const picked = hostWanted || UI.siteHostPicked() || sites[0]?.host;
    // The simpler screens: Keyword ideas sits at the top of this panel (on Keywords), and its Add puts the words in the list
    // below (KW.track). The form stays the panel's first form, so its draft is the one kept; CSS shows the ideas first.
    const withIdeas = simple() && state.route === "keywords" && Boolean(window.LV?.ideasCard);
    // With the ideas in the panel, its one Country and Language start on the ones this site's keywords use most.
    const given = market.country || market.language, start = given ? market : withIdeas ? { ...mostUsed(), why: "Most used by this site's keywords." } : {};
    const why = start.country || start.language ? t(start.why || "Most used by this site's keywords.") : "";
    // Language is a list like Keyword ideas', not free text; a code saved before that isn't in the list stays picked.
    const lang = String(start.language || "").toLowerCase(), langList = UI.languageOptions(lang);
    const market2 = `<label class="field"><span>${t("Country")}</span><select class="select" id="kwr-add-country" form="kwr-add-form" style="width:100%"><option value="">${t("Any country")}</option>${UI.countryOptions((start.country || "").toUpperCase())}</select></label>
        <label class="field"><span>${t("Language")}</span><select class="select" id="kwr-add-language" form="kwr-add-form" style="width:100%"><option value="">${t("Any language")}</option>${langList}${lang && !langList.includes(`value="${lang}"`) ? `<option value="${esc(lang)}" selected>${esc(lang)}</option>` : ""}</select></label>`;
    UI.openPanel(`${UI.panelHead(t("Add keywords"), t("One free check each; then DuckDuckGo daily, the rest on Refresh.") + UI.tip("Each new keyword gets one check with a free tool, to see who really ranks. After that, DuckDuckGo is checked by itself every day, and the other engines when you press Refresh."))}
      ${withIdeas ? `<div class="panel-body kwr-add-body"><div class="kwr-market">${market2}<p class="small muted" id="kwr-add-why" style="margin:0" ${why ? "" : "hidden"}>${why}</p></div>` : ""}
      <form ${withIdeas ? 'class="kwr-add-fields"' : 'class="panel-body"'} id="kwr-add-form" novalidate>
        <label class="field"><span>${t("Site")}</span><select class="select" id="kwr-add-site" style="width:100%">${sites.map((s) => `<option value="${esc(s.host)}" ${s.host === picked ? "selected" : ""}>${esc(s.host)}</option>`).join("")}</select></label>
        <label class="field"><span>${t("Keywords, one per line")}</span><textarea class="input" id="kwr-add-text" rows="8" dir="auto" spellcheck="false" autocomplete="off" aria-describedby="kwr-add-error">${esc(prefill)}</textarea><span id="kwr-add-error" role="alert"></span></label>
        <div class="field"><span id="kwr-add-file-label">${t("Or upload a file")}</span><span class="kwr-file"><input class="kwr-file-input" id="kwr-add-file" type="file" accept=".csv,.txt,.tsv" aria-labelledby="kwr-add-file-label kwr-add-file-name"><label class="btn btn-small" for="kwr-add-file" aria-hidden="true">${icon("paperclip")}${t("Choose a file")}</label><span class="small muted" id="kwr-add-file-name" dir="auto">${t("No file chosen")}</span></span></div>
        ${withIdeas ? "" : `${market2}${why ? `<p class="small muted" style="margin:0">${why}</p>` : ""}`}
      </form>
      ${withIdeas ? `<div class="kwr-ideas" id="kwr-ideas-slot">${ideasHtml()}</div></div>` : ""}
      <div class="panel-foot"><button class="btn btn-main" id="kwr-add-save">${t("Add keywords")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener, { key: `kwr-add|${prefill}`, reopen: () => addPanel(opener, prefill, hostWanted, market) });
    shareMarket();
  }

  async function saveKeywords(button) {
    const text = $("#kwr-add-text").value, file = $("#kwr-add-file").files[0], host = $("#kwr-add-site").value;
    // Said under the keyword box, which names it (aria-describedby), and the box is marked as the one to fix.
    const fail = (message, field) => { UI.setHTML($("#kwr-add-error"), `<span class="error" style="margin:6px 0 0">${icon("octagon-alert")}<span>${esc(t(message))}</span></span>`); $("#kwr-add-text")?.setAttribute("aria-invalid", field === $("#kwr-add-text") ? "true" : "false"); field?.focus(); };
    if (!text.trim() && !file) { fail("Add a keyword or choose a file.", $("#kwr-add-text")); return; }
    const site = window.BOOT.sites.find((s) => s.host === host) || (await api("GET", "links/sites")).sites.find((s) => s.host === host);
    if (!site) { fail("Add a site first"); return; }
    button.disabled = true;
    try {
      if (file) {
        const form = new FormData();
        form.append("file", file); form.append("site_id", site.id); form.append("country", $("#kwr-add-country").value); form.append("language", $("#kwr-add-language").value);
        await api("POST", "keywords/upload", undefined, { form });
      } else {
        await api("POST", "keywords/upload", { site_id: site.id, text, country: $("#kwr-add-country").value, language: $("#kwr-add-language").value });
      }
      UI.forgetPanelForm(); UI.closePanel();
      UI.toast(t("Keywords added"));
      window.dispatchEvent(new CustomEvent("seocc:keywords-added"));
      K.stale = true; load(); // each new row says which tool is checking it, and load() asks again until the results are in
    } catch (err) { fail(err.message); button.disabled = false; }
  }

  // ---- refresh dialog -------------------------------------------------------------------------
  const refreshBody = () => {
    const r = K.refresh;
    return { keyword_ids: r.ids, engines: [...r.engines], depth: r.depth, mode: r.mode, picked: [...r.picked], include_recent: r.includeRecent, allow_paid: r.paid, paid_cap: r.paid ? r.cap : undefined, site_id: undefined };
  };

  /* `deeper` is Check deeper's own view of the dialog: { keyword, tools } names the one keyword and the tools that missed it. */
  function openRefresh(ids, engines, depth = 10, mode = "auto", picked = [], deeper = null) {
    const unique = [...new Set(ids)];
    K.refresh = { ids: unique, engines: new Set(engines || [state.engine === "all" ? "google" : state.engine]), depth, mode, picked: new Set(picked), includeRecent: false, paid: false, cap: 5, token: token(), asked: 0, preview: null, deeper };
    $("#dlg").classList.remove("wide");
    renderRefresh();
    $("#dlg").showModal();
  }

  /* Check deeper: this keyword on this engine only, past the depth already searched, with the tools whose latest result
     didn't find the site. A tool that found it isn't asked again. */
  function checkDeeper(row, e) {
    if (!row) return;
    const view = row.engines[e];
    const missed = [view.main, ...view.others].filter((x) => x && x.status === "ok" && !x.p && K.tools.some((tool) => tool.name === x.tool));
    const now = Math.max(view.main?.depth || 10, ...missed.map((x) => x.depth || 10)), next = [20, 30, 50].find((d) => d > now) || 50;
    if (!missed.length) { openRefresh([row.keyword_id], [e], next); return; } // only a suspect result: the usual dialog
    const tools = missed.map((x) => x.tool), ready = tools.filter((n) => K.tools.find((tool) => tool.name === n)?.connected);
    openRefresh([row.keyword_id], [e], next, "pick", ready, { keyword: row.keyword, tools });
  }

  function renderRefresh() {
    const r = K.refresh;
    const credit = (tool) => (tool.left === null ? t("No credits needed") : `${num(tool.left)}/${num(tool.of)} ${t("left")} · ${t(tool.refills === "one-time" ? "Never refills" : "Refills monthly")}`);
    const anyPaid = K.tools.some((tool) => tool.paid_on && tool.connected);
    // Check deeper: one keyword on one engine, its tools picked; only the tools that missed it show until All tools.
    const deep = r.deeper, only = deep && !deep.all ? new Set(deep.tools) : null, engine = [...r.engines][0];
    UI.setHTML($("#dlg"), `
      <div class="dlg-head"><h2 id="dlg-title">${t(deep ? "Check deeper" : "Refresh keywords")}</h2><button class="icon-btn" data-close-dlg aria-label="${t("Close")}">${icon("x")}</button></div>
      <div class="dlg-body">
        ${deep ? `<p class="kwr-deeper-kw" style="margin-bottom:12px;display:flex;align-items:center;gap:8px" dir="auto">${logoMark(engine, name(engine))}<b>${esc(deep.keyword)}</b></p>`
          : `<p style="margin-bottom:12px"><b>${num(r.ids.length)}</b> ${t(r.ids.length === 1 ? "keyword" : "keywords")}</p>
        <fieldset style="border:0;padding:0;margin:0 0 8px"><legend class="small sec" style="padding:0;margin-bottom:6px;font-weight:500">${t("Engines")}</legend>
          ${ENGINES.map(([id, label]) => `<label class="opt engine-opt"><input type="checkbox" class="chk" style="margin:0" data-kwr-engine="${id}" ${r.engines.has(id) ? "checked" : ""}>${logo(id, 16)}${label}</label>`).join("")}
        </fieldset>`}
        <label class="field" style="margin-bottom:6px"><span>${t("Depth")}</span><select class="select" id="kwr-depth">${[10, 20, 30, 50].map((d) => `<option value="${d}" ${r.depth === d ? "selected" : ""}>${t("Top")} ${d}</option>`).join("")}</select></label>
        ${deep ? `<div class="ref-tools-head"><span>${t(only ? "Tools that missed it" : "Tools")}</span>${only ? `<button type="button" class="link-btn" id="kwr-deeper-all">${t("All tools")}</button>` : ""}</div>`
          : `<div class="ref-tools-head"><span>${t("Tools")}</span><span class="seg" role="group" aria-label="${t("Tools")}"><button type="button" data-kwr-mode="auto" aria-pressed="${r.mode === "auto"}">${t("Automatic: free first")}</button><button type="button" data-kwr-mode="pick" aria-pressed="${r.mode === "pick"}">${t("Choose tools")}</button></span></div>`}
        <div class="tool-list ${r.mode === "auto" ? "auto" : ""}" id="kwr-tool-list">
          ${orderedTools().filter((tool) => !only || only.has(tool.name)).map((tool) => `<label class="tool-row" data-kwr-tool-row="${esc(tool.name)}">
            <input type="checkbox" class="chk" style="margin:0" data-kwr-tool="${esc(tool.name)}" ${r.picked.has(tool.name) ? "checked" : ""}>
            ${logo(tool.name, 22)}
            <span class="tool-main"><span class="t">${esc(t(tool.name))}</span><span class="d">${esc(credit(tool))}${tool.price ? ` · ${t("then")} ${esc(t(tool.price))}` : ""}</span></span>
            <span class="tool-engines" role="img" aria-label="${esc(tool.engines.map(name).join(", "))}" data-tip="${esc(tool.engines.map(name).join(", "))}">${tool.engines.map((e) => logo(e, 14)).join("")}</span>
            <span class="tool-checks"></span></label>`).join("")}
        </div>
        ${anyPaid ? `<div class="paid-row"><label class="opt"><input type="checkbox" class="chk" style="margin:0" id="kwr-paid" ${r.paid ? "checked" : ""}>${t("Use paid credits after free ones")}</label>
          <label class="paid-cap" id="kwr-paid-cap" ${r.paid ? "" : "hidden"}>${t("Limit to")} $<input class="input" id="kwr-cap" type="number" autocomplete="off" min="1" step="1" value="${r.cap}"></label></div>` : ""}
        <div id="kwr-summary" aria-live="polite"></div>
      </div>
      <div class="dlg-foot"><span class="left" id="kwr-foot"></span><button class="btn" data-close-dlg>${t("Cancel")}</button><button class="btn btn-main" id="kwr-confirm" disabled>${t(deep ? "Check deeper" : "Refresh")}</button></div>`);
    updatePreview();
  }

  function orderedTools() {
    const r = K.refresh;
    const first = [...r.engines][0] || "google", order = K.order[first] || [];
    const place = (tool) => { const at = order.indexOf(tool.name); return at < 0 ? 99 : at; };
    return [...K.tools].sort((a, b) => place(a) - place(b));
  }

  async function updatePreview() {
    const r = K.refresh;
    if (!r) return;
    const asked = ++r.asked;
    const confirm = $("#kwr-confirm"), box = $("#kwr-summary");
    confirm.disabled = true;
    $("#kwr-tool-list").classList.toggle("auto", r.mode === "auto");
    if (!r.engines.size || (r.mode === "pick" && !r.picked.size)) {
      UI.setHTML(box, `<p class="note" style="margin:10px 0 0">${icon("info")}<span>${t(!r.engines.size ? "Pick an engine." : "Pick a tool.")}</span></p>`);
      paintToolRows(null);
      return;
    }
    let answer;
    try { answer = await api("POST", "refresh/preview", refreshBody()); } catch (err) {
      if (asked !== r.asked) return;
      UI.setHTML(box, `<p class="error">${icon("octagon-alert")}<span>${esc(t(err.message))}</span></p>`);
      return;
    }
    if (asked !== r.asked || K.refresh !== r) return;
    r.preview = answer;
    paintToolRows(answer);
    const plural = (n, one, many) => `${num(n)} ${t(n === 1 ? one : many)}`;
    const notes = [];
    if (answer.no_tools_for.length) notes.push(`<p class="note warn" style="margin:10px 0 0">${icon("triangle-alert")}<span>${t("No tool can search")} ${esc(answer.no_tools_for.map(name).join(", "))}. ${t("It will be skipped.")} ${t("Connect one in Settings.")}</span></p>`);
    if (r.mode === "pick") (answer.blocked || []).filter((b) => r.picked.has(b.name)).forEach((b) => {
      const tool = K.tools.find((x) => x.name === b.name), covers = [...r.engines].filter((e) => tool?.engines.includes(e));
      const others = K.tools.filter((x) => x.name !== b.name && x.connected && !x.manual_only && covers.some((e) => x.engines.includes(e)) && !answer.blocked.some((y) => y.name === x.name)).map((x) => t(x.name));
      notes.push(`<p class="note warn" style="margin:10px 0 0">${icon("triangle-alert")}<span>${esc(t(b.name))} ${t("hit a bot check")} ${esc(window.COMP.ago(b.at))}, ${t("so it will probably stop at once.")}${others.length ? ` ${t("Pick one of these instead:")} ${esc(others.join(", "))}.` : ""}</span></p>`);
    });
    if (answer.runs_out_after !== null) notes.push(`<p class="note warn" style="margin:10px 0 0">${icon("triangle-alert")}<span>${t("Runs out after")} ${plural(answer.runs_out_after, "check", "checks")}.</span></p>`);
    if (answer.running.length) notes.push(`<p class="note" style="margin:10px 0 0">${icon("info")}<span>${t("Already refreshing:")} ${esc(answer.running.slice(0, 5).map((x) => `${x.keyword}${x.by ? ` (${x.by === AUTO_BY ? t("automatic check") : `${t("by")} ${x.by}`})` : ""}`).join(", "))}${answer.running.length > 5 ? ` +${answer.running.length - 5}` : ""}</span></p>`);
    if (answer.recent.length || r.includeRecent) notes.push(`<div style="margin:10px 0 0">${answer.recent.length ? `<p class="small sec" style="margin:0 0 4px" dir="auto">${t("Checked within")} ${num(answer.just_checked_hours)} ${t("h, left out:")} ${esc(answer.recent.slice(0, 5).map((x) => x.keyword).join(", "))}${answer.recent.length > 5 ? ` +${answer.recent.length - 5}` : ""}</p>` : ""}<label class="opt small"><input type="checkbox" class="chk" style="margin:0" id="kwr-recent" ${r.includeRecent ? "checked" : ""}>${t("Refresh them too")}</label></div>`);
    if (r.mode === "pick" && r.picked.has("Browser on this Mac")) notes.push(`<p class="note" style="margin:10px 0 0">${icon("info")}<span>${t("Uses a real browser on this Mac; stops at the first captcha.")}</span></p>`);
    const sum = answer.checks ? `<p class="small kwr-cost" id="kwr-cost" style="margin:0">${costLine(answer)}</p>` : `<p class="small sec" style="margin:0">${t("Nothing to check.")}</p>`;
    const hadFocus = document.activeElement?.id === "kwr-recent";
    UI.setHTML(box, sum + notes.join(""));
    if (hadFocus) $("#kwr-recent")?.focus(); // the summary is redrawn, and the keyboard stays where it was
    confirm.disabled = !answer.checks;
    UI.setHTML(confirm, answer.checks ? confirmWords(answer) : esc(t(r.deeper ? "Check deeper" : "Refresh")));
    // "Free tools only" only when it's true: every planned search is on a tool that needs no credits.
    const used = answer.tools.filter((p) => p.checks);
    $("#kwr-foot").textContent = used.length && used.every((p) => p.left === null && !p.paid_credits) ? t("Free tools only") : "";
  }
  const money = (n) => new Intl.NumberFormat(UI.locale(), { style: "currency", currency: "USD" }).format(n);
  // The sentence escaped, then its values put in: numbers, and a tool as its logo and name (HTML).
  const plural2 = (n, one, many, values) => Object.entries({ n: esc(num(n)), ...values }).reduce((out, [k, v]) => out.split(`{${k}}`).join(v), esc(t(n === 1 ? one : many)));
  /* One plain line: what this spends from each tool's free searches, what is paid, and what it costs. */
  function costLine(answer) {
    const parts = [];
    answer.tools.filter((p) => p.checks).forEach((p) => {
      const tool = brandLabel(p.name);
      if (p.left === null) parts.push(plural2(p.checks, "{n} {tool} search, no credits needed", "{n} {tool} searches, no credits needed", { tool }));
      if (p.left !== null && p.credits) parts.push(plural2(p.credits, "Uses {n} of your {left} free {tool} search", "Uses {n} of your {left} free {tool} searches", { tool, left: esc(num(p.left)) }));
      if (p.paid_credits) parts.push(plural2(p.paid_credits, "{n} paid {tool} search", "{n} paid {tool} searches", { tool }));
    });
    const end = esc(answer.cost ? t("Up to {money}.").replace("{money}", money(answer.cost)) : t("No charge."));
    return `${parts.join(" · ")}${parts.length ? ". " : ""}${end}`;
  }
  /* The button names the cost: "Check with SerpApi · 2 searches", "Refresh · 14 searches", "… · up to $0.50". */
  function confirmWords(answer) {
    // Searches as the tools count them: a check past the first page is more than one search on a tool that counts credits.
    const used = answer.tools.filter((p) => p.checks), n = used.reduce((sum, p) => sum + (p.left === null ? p.checks : p.credits + p.paid_credits || p.checks), 0);
    const label = K.refresh?.deeper
      ? (used.length === 1 ? plural2(n, "Check with {tool} · {n} search", "Check with {tool} · {n} searches", { tool: brandLabel(used[0].name) }) : plural2(n, "Check · {n} search", "Check · {n} searches"))
      : plural2(n, "Refresh · {n} search", "Refresh · {n} searches");
    return answer.cost ? esc(t("{label} · up to {money}")).replace("{label}", label).replace("{money}", esc(money(answer.cost))) : label;
  }

  function paintToolRows(answer) {
    const r = K.refresh;
    orderedTools().forEach((tool) => {
      const row = $$("[data-kwr-tool-row]").find((x) => x.dataset.kwrToolRow === tool.name);
      if (!row) return;
      const planned = answer?.tools.find((x) => x.name === tool.name);
      const fits = [...r.engines].some((e) => tool.engines.includes(e));
      const usable = tool.connected && fits, pick = r.mode === "pick";
      row.classList.toggle("off", !usable || (!pick && tool.manual_only));
      const box = $("input", row);
      box.disabled = !pick || !usable;
      const checks = planned?.checks || 0;
      const rest = (answer?.blocked || []).find((b) => b.name === tool.name);
      const restTip = rest ? `${translateSentences(rest.why)} ${t("Automatic runs try it again in")} ${num(Math.max(1, Math.ceil((new Date(rest.until).getTime() - Date.now()) / 3600000)))} h.` : "";
      const words = !tool.connected ? (tool.manual_only ? "" : `<button type="button" class="link-btn" data-kwr-connect="${esc(tool.name)}">${t("Connect")}</button>`)
        : !fits ? `<span class="quiet">${t("Not for these engines")}</span>`
        : !pick && tool.manual_only ? `<span class="quiet">${t("Only if picked")}</span>`
        : rest && !pick ? `<span class="quiet" data-tip="${esc(restTip)}">${t("Skipped: bot check")}<span class="sr">. ${esc(restTip)}</span></span>`
        : checks ? `${rest ? `<span data-tip="${esc(restTip)}" role="img" aria-label="${esc(restTip)}">${icon("triangle-alert", "warn")}</span> ` : ""}${num(checks)} ${t(checks === 1 ? "check" : "checks")}${planned.paid_credits ? ` · ${num(planned.paid_credits)} ${t("paid")}` : ""}` : "";
      UI.setHTML($(".tool-checks", row), words);
    });
  }

  async function confirmRefresh(button) {
    const r = K.refresh;
    button.disabled = true; // the first click of a double click wins, and the token makes a second one harmless anyway
    let run;
    try { run = await api("POST", "refresh/runs", { ...refreshBody(), token: r.token }); } catch (err) {
      UI.setHTML($("#kwr-summary"), `<p class="error">${icon("octagon-alert")}<span>${esc(t(err.message))}</span></p>`);
      button.disabled = false;
      return;
    }
    $("#dlg").close();
    UI.ignoreClicks();
    remember(run, r.ids, [...r.engines]);
    K.refresh = null;
    K.selected.clear();
    if (run.excluded?.length) UI.toast(`${t("Already refreshing:")} ${run.excluded.slice(0, 3).map((x) => `${x.keyword}${x.by ? ` (${x.by === AUTO_BY ? t("automatic check") : x.by})` : ""}`).join(", ")}`, { kind: "info" });
    follow(run);
    if (state.route === "keywords") UI.render({ keepScroll: true });
  }

  // ---- tray -----------------------------------------------------------------------------------
  /* What a Refresh started here checks, and each one's position before it, so its end can say what moved. */
  K.runInfo = new Map();
  function remember(run, ids, engines) {
    if (!run?.id) return;
    const want = new Set(ids.map(Number)), before = new Map();
    (K.data?.rows || []).forEach((row) => { if (want.has(row.keyword_id)) engines.forEach((e) => { const m = row.engines[e]?.main; before.set(`${row.id}|${e}`, m?.status === "ok" ? m.p || null : null); }); });
    K.runInfo.set(run.id, { ids: want, engines, before, started: Date.now() });
  }
  /* Up, down (the app's own Change, same tool only) and new in the top 10, on the keywords this Refresh checked. */
  function movesOf(info) {
    const out = { up: [], down: [], top10: [], left10: [], rows: new Set() };
    (K.data?.rows || []).forEach((row) => {
      if (!info.ids.has(row.keyword_id)) return;
      info.engines.forEach((e) => {
        const view = row.engines[e], m = view?.main;
        if (!m || m.status !== "ok" || m.age_days === null || m.age_days * 864e5 > Date.now() - info.started + 120000) return; // not checked by this run
        // The same like-for-like rule as Change (view.move, view.was), never the last result of any tool.
        if (goesUp(view)) { out.up.push(row.id); out.rows.add(row.id); }
        if (goesDown(view)) { out.down.push(row.id); out.rows.add(row.id); }
        const step = top10Step(view);
        if (step > 0) { out.top10.push(row.id); out.rows.add(row.id); }
        if (step < 0) { out.left10.push(row.id); out.rows.add(row.id); }
      });
    });
    return out;
  }
  function movedWords(moves) {
    const bits = [];
    if (moves.up.length) bits.push(fill("{n} up", num(moves.up.length)));
    if (moves.down.length) bits.push(fill("{n} down", num(moves.down.length)));
    if (moves.top10.length) bits.push(state.lang === "fr" && moves.top10.length === 1 ? "1 nouveau dans le top 10" : fill("{n} new in top 10", num(moves.top10.length)));
    if (moves.left10.length) bits.push(state.lang === "fr" && moves.left10.length === 1 ? "1 sorti du top 10" : fill("{n} dropped out of top 10", num(moves.left10.length)));
    return bits.join(" · ");
  }
  /* One tray, one block per Refresh: a second Refresh (another keyword, Check deeper, a panel Refresh) can start while the
     first one runs; the server leaves out any keyword already being checked and names it. K.runs: run id → { run, poll }. */
  const runBlock = (id) => $(`#tray [data-run="${id}"]`);
  function dropBlock(block) {
    const tray = block?.closest("#tray");
    block?.remove();
    if (tray && !tray.querySelector(".kwr-run")) $("#tray-root").replaceChildren();
  }
  function follow(run) {
    if (!run || K.runs.has(run.id)) return;
    let tray = $("#tray");
    if (!tray) { UI.setHTML($("#tray-root"), `<div class="tray" id="tray" role="status"></div>`); tray = $("#tray"); }
    tray.classList.remove("pill");
    // A finished run's block (Stopped, failures to retry) gives way to the new one, as the old single tray did; running ones stay.
    tray.querySelectorAll(".kwr-run").forEach((old) => { if (!K.runs.has(Number(old.dataset.run))) old.remove(); });
    const block = document.createElement("div");
    block.className = "kwr-run"; block.dataset.run = run.id;
    UI.setHTML(block, `<div class="top">${icon("refresh-cw", "spin")}<span class="tray-title">${t("Refreshing")}</span><span class="end tabular tray-count"></span></div>
      <div class="bar"><i class="tray-bar"></i></div>
      <div class="msg tray-msg"></div>
      <div class="tray-actions" style="margin-top:8px"><button class="btn btn-small kwr-stop" data-stop="${run.id}">${t("Stop")}</button></div>`);
    tray.append(block);
    K.runs.set(run.id, { run, poll: null });
    paintTray(run);
    startPoll(run.id);
  }
  function paintTray(run) {
    const block = runBlock(run.id), done = run.done + run.failed + run.not_run;
    if (!block) return;
    $(".tray-count", block).textContent = `${num(done)} / ${num(run.total)}`;
    $(".tray-bar", block).style.setProperty("--p", run.total ? done / run.total : 0);
    const bits = [];
    if (run.keywords?.length === 1) bits.push(run.keywords[0]);
    if (run.moved) bits.push(`${t(run.moved.from)} ${t(run.moved.why || "stopped working")}, ${t("continuing with")} ${t(run.moved.to)}`);
    if (run.by && run.by !== window.ME?.name) bits.push(run.by === AUTO_BY ? t("Automatic DuckDuckGo check") : `${t("started by")} ${run.by}`);
    $(".tray-msg", block).textContent = bits.join(" · ");
  }
  /* Each run is followed with the app's one poller (COMP.poll in competitors.js): it pauses while the tab is hidden, waits longer
     after each failure, respects a 429 cool-down, and stops on 404 or 401 or after 6 failures in a row (F21). */
  function startPoll(id) {
    const entry = K.runs.get(id);
    if (!entry) return;
    entry.poll?.stop?.();
    entry.poll = window.COMP.poll(async () => {
      if (K.runs.get(id) !== entry) return false;
      const run = await api("GET", `refresh/runs/${id}`);
      entry.run = run;
      paintTray(run);
      if (run.status === "queued" || run.status === "running") return true;
      finishTray(run);
      return false;
    }, { every: 1000, grow: 1.15, slowest: 15000, errors: 6, onEnd: (why, err) => { if ((why === "gone" || why === "errors" || why === "ceiling") && K.runs.get(id) === entry) lostTray(id, why === "errors" ? err?.message || "" : ""); } });
  }
  function lostTray(id, message) {
    K.runs.get(id)?.poll?.stop?.(); K.runs.delete(id);
    const block = runBlock(id);
    if (!block) return;
    UI.setHTML($(".top", block), `${icon("triangle-alert", "warn")}<span>${esc(t("Lost track of this Refresh"))}</span>`);
    $(".tray-msg", block).textContent = message ? `${t(message)} ${t("Progress is saved. Reload to see it.")}` : t("Progress is saved. Reload to see it.");
    UI.setHTML($(".tray-actions", block), `<button class="btn btn-small kwr-tray-close">${t("Close")}</button>`);
  }
  function finishTray(run) {
    K.runs.delete(run.id);
    const saved = `${num(run.done)} ${t("saved")}${run.failed ? ` · ${num(run.failed)} ${t("failed")}` : ""}`;
    const title = run.status === "cancelled" ? `${t("Stopped")} · ${saved}` : run.status === "stopped" ? `${t(/No free tools left/.test(run.stop_reason || "") ? "Stopped: no free tools left" : "Stopped")} · ${saved}` : `${t("Finished")} · ${saved}`;
    const block = runBlock(run.id);
    if (block) {
      UI.setHTML($(".top", block), `${run.status === "done" && !run.failed ? icon("circle-check", "good") : icon("triangle-alert", "warn")}<span class="tray-title">${esc(title)}</span>`);
      UI.setHTML($(".tray-actions", block), run.status === "stopped" ? `<button class="btn btn-small kwr-tray-close">${t("Close")}</button>` : "");
      const why = run.stop_reason ? translateSentences(run.stop_reason) : "";
      // Which searches failed and why, with a Retry for those only. The run lists them in `failures` (keyword, engine, error).
      const fails = Array.isArray(run.failures) ? run.failures : [];
      if (why) UI.setHTML($(".tray-msg", block), trayFails([], run.stop_reason));
      if (run.failed && fails.length) {
        UI.setHTML($(".tray-msg", block), `${trayFails(fails, run.stop_reason)}${run.spent ? `<p class="small muted" style="margin:6px 0 0">${t("Only successful searches were charged.")}</p>` : ""}`);
        const ids = [...new Set(fails.map((f) => f.keyword_id).filter(Boolean))], engines = [...new Set(fails.map((f) => f.engine).filter(Boolean))];
        UI.setHTML($(".tray-actions", block), `${ids.length ? `<button class="btn btn-small btn-main kwr-tray-retry" data-ids="${ids.join(",")}" data-engines="${esc(engines.join(","))}">${icon("refresh-cw")}${t("Refresh")} (${num(ids.length)})</button> ` : ""}<button class="btn btn-small kwr-tray-close">${t("Close")}</button>`);
      } else if (run.failed) {
        // Older answers have no list: say so plainly, and keep the block until it's closed.
        $(".tray-msg", block).textContent = `${why ? `${why} ` : ""}${t("The keyword's own panel shows each failed check.")}`;
        UI.setHTML($(".tray-actions", block), `<button class="btn btn-small kwr-tray-close">${t("Close")}</button>`);
      }
    }
    const info = K.runInfo.get(run.id);
    K.runInfo.delete(run.id);
    K.stale = true; K.queries = {};
    load().then(() => {
      if (K.panel) loadPanel(K.panel);
      if (!block?.isConnected) return;
      // What moved, with a button that shows just those keywords. A result with something in it stays until it's closed.
      // Any run that saved checks says what moved, a stopped one too: its saved results are as real as a finished run's.
      const moves = info && run.done > 0 ? movesOf(info) : null;
      if (moves?.rows.size) {
        K.runFilter = moves.rows;
        UI.setHTML($(".top", block), `${run.failed ? icon("triangle-alert", "warn") : icon("circle-check", "good")}<span class="tray-title">${esc(`${t(run.status === "done" ? "Finished" : "Stopped")} · ${movedWords(moves)}${run.failed ? ` · ${num(run.failed)} ${t("failed")}` : ""}`)}</span>`);
        if (!run.failed && !run.stop_reason) $(".tray-msg", block).textContent = `${num(run.done)} ${t("saved")}`;
        const rest = $(".tray-actions", block).innerHTML; // a Refresh of the failed ones, when there are some, stays
        UI.setHTML($(".tray-actions", block), `<button class="btn btn-small btn-main kwr-tray-moved" data-engines="${esc(info.engines.join(","))}">${t("Show them")}</button> ${rest.includes("kwr-tray-close") ? rest.replace("btn-main ", "") : `${rest}<button class="btn btn-small kwr-tray-close">${t("Close")}</button>`}`);
        if (state.route === "keywords") UI.render({ keepScroll: true }); // the This Refresh chip
        return;
      }
      if (info && run.status === "done" && !run.failed && !run.stop_reason) $(".tray-msg", block).textContent = t("Nothing moved");
      if (run.status !== "stopped" && !run.failed) {
        // Alone in the tray, it shrinks to a pill first; beside other runs, it just goes.
        setTimeout(() => { const tray = block.closest("#tray"); if (tray && tray.querySelectorAll(".kwr-run").length === 1) tray.classList.add("pill"); }, 5000);
        setTimeout(() => dropBlock(block), 9000);
      }
    });
  }
  // A server sentence is English: each one is translated if it's known, and stays readable if it isn't.
  const translateSentences = (text) => text.split(/(?<=\.)\s+/).map((part) => t(part)).join(" ");

  /* The tray's failed searches: one line per tool and error with a count, then each keyword with its engine's logo. A tool's stop
     reason joins its line ("dropped after 3 in a row"); one with no failed rows gets a line of its own. The whole sentences are
     the tooltips. [pattern, its own line, joined to a line, the tooltip when the server's sentence isn't the best one] */
  const STOPS = [
    [/\bfailed (\d+) searches in a row\b/i, "Dropped after {n} in a row", "dropped after {n} in a row", "It failed {n} searches in a row, so this Refresh stopped using it."],
    [/no free (?:checks|searches) left|no credits left|checks for this hour/i, "No free checks left", "no free checks left"],
    [/bot check|captcha/i, "Blocked by a bot check", "blocked by a bot check"],
    [/slow down/i, "Asked to slow down", "asked to slow down"],
    [/refused the key/i, "Key refused", "key refused"],
    [/can't read/i, "Unreadable answer", "unreadable answer"],
  ];
  const sentencesOf = (text) => String(text || "").trim().split(/(?<=\.)\s+/).filter(Boolean);
  function toolNamed(sentence, names) {
    const hit = names.find((n) => sentence.startsWith(`${n} `) || sentence.startsWith(`${n}'s `));
    if (hit) return hit;
    if (/^DuckDuckGo\b/.test(sentence)) return "DuckDuckGo direct";
    return /browser backup|captcha/i.test(sentence) ? "Browser on this Mac" : "";
  }
  // One entry per tool: a sentence that names none ("The app won't bypass it.") belongs to the one before it.
  function stopsOf(text, names) {
    const out = [];
    sentencesOf(text).forEach((s) => {
      const tool = toolNamed(s, names), last = out[out.length - 1];
      if (!tool && last?.tool) last.text += ` ${s}`;
      else out.push({ tool, text: s });
    });
    return out.map((r) => {
      const hit = r.tool && STOPS.find(([re]) => re.test(r.text)), full = translateSentences(r.text);
      if (!hit) return { ...r, own: "", fold: t("dropped"), tip: full };
      const n = r.text.match(hit[0])[1] || "", fill = (words) => t(words).split("{n}").join(n ? num(Number(n)) : "");
      return { ...r, own: fill(hit[1]), fold: fill(hit[2]), tip: hit[3] ? fill(hit[3]) : full };
    });
  }
  // A failed search's error in a few words ("Empty answer (200)", from UI.errorParts), and its whole sentence for the tooltip.
  function failWords(error) {
    const [head = "", ...rest] = sentencesOf(error);
    const parts = UI.errorParts ? UI.errorParts(head.replace(/^(The request failed: \w+)\.$/, "$1")) : { words: UI.errorWords(head), full: "" };
    const after = rest.length ? translateSentences(rest.join(" ")) : "";
    return { words: parts.words || t("The search failed."), full: [parts.full || (after ? translateSentences(head) : ""), after].filter(Boolean).join(" ") };
  }
  function trayFails(fails, stopReason) {
    const names = [...new Set([...(K.tools || []).map((x) => x.name), ...Object.keys(CONN_ID), ...fails.map((f) => f.tool).filter(Boolean)])].sort((a, b) => b.length - a.length);
    const groups = new Map();
    fails.forEach((f) => {
      const key = `${f.tool || ""}|${f.error || ""}`;
      if (!groups.has(key)) groups.set(key, { tool: f.tool || "", error: f.error || "", rows: [] });
      groups.get(key).rows.push(f);
    });
    const stops = stopsOf(stopReason, names);
    stops.forEach((s) => { const g = s.tool && [...groups.values()].find((x) => x.tool === s.tool && !x.stop); if (g) { g.stop = s; s.used = true; } });
    const tipped = (tip, html) => `<span${tip ? ` data-tip="${esc(tip)}"` : ""}>${html}${tip ? `<span class="sr">. ${esc(tip)}</span>` : ""}</span>`;
    // The words may name the tool already, and that name gets its logo on screen (brands.js), so it isn't drawn twice.
    const lead = (tool, words) => (tool && !words.includes(tool) && !words.includes(t(tool)) ? logoMark(tool, t(tool)) : "");
    let rowsLeft = 20; // keyword rows shown, as before; each line's count still covers every one
    const lines = [...groups.values()].map((g) => {
      const { words, full } = failWords(g.error), shown = g.rows.slice(0, Math.max(0, rowsLeft));
      rowsLeft -= shown.length;
      const head = `${esc(words)}${g.rows.length > 1 ? ` ×${num(g.rows.length)}` : ""}${g.stop ? ` · ${esc(g.stop.fold)}` : ""}`;
      const charged = g.rows.some((f) => f.timed_out) ? `<li class="kwr-fk why">${esc(t("May have been charged: a Retry spends again."))}</li>` : "";
      const more = g.rows.length > shown.length ? `<li class="kwr-fk muted">+${num(g.rows.length - shown.length)}</li>` : "";
      return `<li class="kwr-fg">${lead(g.tool, words)}${tipped([full, g.stop?.tip].filter(Boolean).join(" "), head)}</li>${charged}${shown.map((f) => `<li class="kwr-fk"><span class="k">${KeywordLink.html(f.keyword || "", { id: f.keyword_id })}</span>${f.engine ? logoMark(f.engine, name(f.engine), 14) : ""}</li>`).join("")}${more}`;
    });
    stops.filter((s) => !s.used).forEach((s) => lines.push(s.own ? `<li class="kwr-fg">${logoMark(s.tool, t(s.tool))}${tipped(s.tip, esc(s.own))}</li>` : `<li class="kwr-fg kwr-plain"><span>${esc(s.tip)}</span></li>`));
    return lines.length ? `<ul class="tray-fails kwr-fails">${lines.join("")}</ul>` : "";
  }

  // ---- side panel -----------------------------------------------------------------------------
  const rowById = (id) => K.data?.rows.find((row) => row.id === id);
  async function openKeyword(id, opener) {
    const row = rowById(id);
    if (!row) return;
    const e = engineOf();
    K.panel = { id, siteId: row.site_id, keywordId: row.keyword_id, engine: e, table: false, line: null };
    $$("tr.open").forEach((tr) => tr.classList.remove("open"));
    $$("#kw-table tbody tr").find((tr) => tr.dataset.kwrRow === id)?.classList.add("open");
    UI.openPanel(`${UI.panelHead(row.keyword, `${esc(name(e))}`)}<div class="panel-body">${UI.skeleton ? UI.skeleton("panel") : `<p class="muted">${t("Loading…")}</p>`}</div>`, opener, simple() ? { wide: true } : null); // the simpler screens' 760 px row panel frame
    UI.syncUrl(); // the address names the open keyword, so a reload or a pasted link opens it again
    await loadPanel(K.panel);
  }
  async function loadPanel(info) {
    let detail;
    try { detail = await api("GET", `rankings/${info.keywordId}?site_id=${info.siteId}&engine=${info.engine}`); } catch (err) {
      if (K.panel === info && $("#panel")) UI.setHTML($("#panel"), `${UI.panelHead(t("Keywords"))}<div class="panel-body"><p class="error">${icon("octagon-alert")}<span>${esc(t(err.message))}</span></p></div>`);
      return;
    }
    if (K.panel !== info || !$("#panel")) return;
    info.detail = detail;
    paintPanel(info);
  }

  function chart(line) {
    const points = line.points;
    const known = points.map((p) => p.p).filter(Boolean);
    if (known.length < 2) return `<p class="note">${icon("info")}<span>${t("Needs 2 checks, same tool")}</span></p>`;
    const w = 440, h = 160, left = 26, right = 8, top = 10, bottom = 28;
    // Even steps from 1 (1, 2, 3 … or 1, 3, 5 … or 1, 6, 11 …), at most five lines, the last one at or past the worst position.
    const step = [1, 2, 5, 10, 20, 25, 50].find((n) => (Math.max(...known) - 1) / n <= 4) || 50;
    const hi = 1 + step * Math.max(1, Math.ceil((Math.max(...known) - 1) / step));
    const x = (i) => left + (points.length === 1 ? 0 : (i / (points.length - 1)) * (w - left - right));
    const y = (v) => top + ((v - 1) / Math.max(1, hi - 1)) * (h - top - bottom);
    const ticks = Array.from({ length: Math.round((hi - 1) / step) + 1 }, (_, i) => 1 + i * step);
    // A check beyond the depth leaves a gap, never a line down to a made-up number. A suspect result is a hollow dot on no line.
    let path = "", pen = false;
    points.forEach((p, i) => { if (!p.p || p.suspect) { pen = false; return; } path += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.p).toFixed(1)}`; pen = true; });
    const dateOf = (p) => UI.fmtDateOnly(p.at.slice(0, 10));
    const dots = points.map((p, i) => (p.p ? `<circle cx="${x(i).toFixed(1)}" cy="${y(p.p).toFixed(1)}" r="4" fill="${p.suspect ? "var(--panel-solid)" : "var(--series-1)"}" stroke="${p.suspect ? "var(--series-1)" : "var(--panel-solid)"}" stroke-width="2" data-tip="${esc(dateOf(p))}: #${p.p}${p.suspect ? ` · ${esc(t("Suspect result"))}` : ""}"/>` : "")).join("");
    const edges = [0, points.length - 1];
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${t("Position history")}: ${esc(points.map((p) => `${dateOf(p)} ${p.p ? `#${p.p}` : `>${line.depth}`}`).join(", "))}">
      ${ticks.map((v) => `<line x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("")}
      ${edges.map((i, n) => `<text x="${x(i)}" y="${h - 6}" text-anchor="${n ? "end" : "start"}">${esc(dateOf(points[i]))}</text>`).join("")}
      <path class="chart-line" d="${path}"/>${dots}</svg>`;
  }

  function paintPanel(info) {
    const { detail } = info, row = detail.row, e = detail.engine, view = row.engines[e];
    const lineKey = (x) => `${x.tool}|${x.location}|${x.depth}`;
    const place = row.country ? (UI.countryName(row.country) || row.country) : t("Any country");
    const latest = {};
    if (view.main) latest[view.main.tool] = view.main;
    view.others.forEach((x) => { latest[x.tool] = x; });
    const listed = (detail.order || []).map((tool) => detail.tools.find((x) => x.name === tool)).filter((tool) => tool && (tool.connected || latest[tool.name]));
    const statusOf = (x) => (x.verdict === "suspect" || x.status === "suspect" ? status("warn", t("Suspect result")) : x.verdict === "unverifiable" ? `<span class="small sec" data-tip="${esc(t("First check with this tool, and nothing to compare it with yet."))}">${t("Not confirmed yet")}<span class="sr">: ${esc(t("First check with this tool, and nothing to compare it with yet."))}</span></span>` : okMark());
    const toolRows = listed.map((tool) => {
      const x = latest[tool.name];
      const low = tool.left !== null && tool.left < 10;
      const canRun = tool.connected && tool.engines.includes(e);
      const empty = tool.left !== null && tool.left < Math.max(1, tool.credits_per_search) && !tool.paid_on;
      const elsewhere = !x && view.away.find((a) => a.tool === tool.name);
      const button = !canRun ? `<span class="small muted">${t("Not connected")}</span>` : `<button class="btn btn-small" data-kwr-check="${esc(tool.name)}" data-low="${low ? tool.left : ""}" ${empty ? "disabled" : ""} ${empty ? `data-tip="${esc(t("No free checks left."))}"` : ""}>${t("Refresh")}</button>${tool.left === null ? "" : `<span class="second">${num(tool.left)} ${t("left")}</span>`}`;
      return `<tr><td class="nowrap">${logo(tool.name, 16)} ${esc(t(tool.name))}</td><td>${x ? posBadge(x) : '<span class="muted">—</span>'}</td><td class="sec small nowrap">${x ? age(x.age_days) : elsewhere ? age(elsewhere.age_days) : t("never")}</td><td>${x ? statusOf(x) : elsewhere ? `<span class="small sec">${t("Another location")}</span>` : ""}</td><td class="r">${button}</td></tr>`;
    }).join("");
    const suspects = view.suspects.map((x) => `<tr><td class="nowrap">${logo(x.tool, 16)} ${esc(t(x.tool))}</td><td>${posBadge(x)}</td><td class="sec small nowrap">${age(x.age_days)}</td><td>${status("warn", t("Suspect result"))}</td><td></td></tr>`).join("");
    const away = view.away.length
      ? `<table class="mini"><tbody>${view.away.map((x) => `<tr><td>${logoMark(x.tool, t(x.tool))} ${esc(UI.countryName(x.location) || x.location || "?")}</td><td>${posBadge(x)}</td><td class="sec small nowrap">${age(x.age_days)}</td></tr>`).join("")}</tbody></table>`
      : `<p class="small muted">${t("None yet")}</p>`;
    const lines = detail.lines;
    const wanted = info.line || (view.main ? lineKey(view.main) : lines[0] ? lineKey(lines[0]) : null);
    const shownLine = lines.find((x) => lineKey(x) === wanted) || lines[0];
    const picker = lines.length > 1 ? `<select class="select" id="kwr-line" aria-label="${t("Tool")}" style="margin-bottom:6px;width:100%">${lines.map((x) => `<option value="${esc(lineKey(x))}" ${x === shownLine ? "selected" : ""}>${esc(t(x.tool))} · ${esc(UI.countryName(x.location) || x.location || "?")} · ${t("Top")} ${x.depth}</option>`).join("")}</select>` : "";
    const history = !shownLine ? `<p class="small muted">${t("None yet")}</p>` : info.table
      ? `<table class="mini"><thead><tr><th>${t("Date")}</th><th>${t("Position")}</th><th>${t("Status")}</th></tr></thead><tbody>${shownLine.points.map((p) => `<tr><td>${esc(UI.fmtDateOnly(p.at.slice(0, 10)))}</td><td>${p.p ? `#${p.p}` : p.suspect ? `<span data-tip="${esc(t(UNSURE))}" role="img" aria-label="${esc(t(UNSURE))}">?</span>` : `&gt;${shownLine.depth}`}</td><td>${p.suspect ? status("warn", t("Suspect result")) : okMark()}</td></tr>`).join("")}</tbody></table>`
      : chart(shownLine);
    const hasSuspect = shownLine?.points.some((p) => p.suspect);
    const competitors = detail.competitors.length
      ? `<table class="mini"><thead><tr><th scope="col">${t("Position")}</th><th scope="col">${t("Site")}</th><th scope="col" class="r">${t("Change")}</th></tr></thead><tbody>${detail.competitors.slice(0, 20).map((c) => `<tr><td class="pos" style="width:40px">#${c.position}</td><td class="mono small" dir="auto">${c.hidden ? `<span class="muted">${t("Hidden by Google")}</span>` : c.mine ? `<b>${esc(c.host)}</b> <span class="who who-you"><i class="pt-key pt-key-you" aria-hidden="true"></i><span>${t("You")}</span></span>` : esc(c.host)}${c.rival ? ` <span class="who who-them"><i class="pt-key pt-key-them" aria-hidden="true"></i><span>${t("Competitor")}</span></span>` : ""}</td><td class="r">${c.change ? `<span class="chg ${c.change > 0 ? "good" : "crit"}">${icon(c.change > 0 ? "arrow-up" : "arrow-down")}${Math.abs(c.change)}</span>` : '<span class="muted">—</span>'}</td></tr>`).join("")}</tbody></table>`
      : `<p class="small muted">${t("None yet")}</p>`;
    const checks = detail.checks.length
      ? `<table class="mini"><thead><tr><th>${t("Date")}</th><th>${t("Tool")}</th><th>${t("Position")}</th><th>${t("URL")}</th><th>${t("Status")}</th></tr></thead><tbody>${detail.checks.slice(0, 30).map((c) => `<tr><td class="nowrap small">${esc(UI.fmtDateOnly(c.checked_at.slice(0, 10)))}</td><td class="small">${brandLabel(c.tool)}<span class="second">${esc(c.location || "—")} · ${t("Top")} ${c.depth}</span></td><td>${c.status === "failed" ? "—" : c.p ? `#${c.p}` : c.status === "suspect" ? `<span data-tip="${esc(t(UNSURE))}" role="img" aria-label="${esc(t(UNSURE))}">?</span>` : `&gt;${c.depth}`}</td><td class="mono small kw-page-url" dir="auto">${c.url ? PageLink.html(c.url, { text: shortPath(c.url), title: "" }) : '<span class="muted">—</span>'}</td><td>${c.status === "failed" ? `<span class="crit small" data-tip="${esc(c.error || "")}">${icon("octagon-alert")}${t("Failed")}${c.error ? `<span class="sr">: ${esc(c.error)}</span>` : ""}</span>` : c.status === "suspect" ? status("warn", t("Suspect result")) : okMark()}</td></tr>`).join("")}</tbody></table>`
      : `<p class="small muted">${t("Not checked")}</p>`;
    const own = OWN_TOOL[e];
    const task = UI.taskButton ? UI.taskButton(findOf(row, e, view), { cls: "btn" }) : "";
    const scroll = $(".panel-body", $("#panel"))?.scrollTop || 0;
    UI.setHTML($("#panel"), `${UI.panelHead(row.keyword, `${esc(name(e))} · ${esc(place)} · Desktop`)}
      <div class="panel-body">
        <div class="kv">
          ${own ? `<div><div class="k">${brandLabel(own)}</div><div class="v">${view.own === null || view.own === undefined ? '<span class="muted">—</span>' : `${dec(Math.round(view.own * 10) / 10)} <span class="small muted" style="font-weight:400">${t("average")}</span>`}</div></div>` : ""}
          <div><div class="k">${t("Ranking now")}</div><div class="mono small kw-page-url" style="margin-top:6px" dir="auto">${view.main?.url ? pageAddress(view.main.url) : "—"}</div></div>
          ${e === "google" && row.gsc_page ? `<div><div class="k">${t("Most shown in Search Console")}</div><div class="mono small kw-page-url" style="margin-top:6px" dir="auto">${pageAddress(row.gsc_page)}</div></div>` : ""}
        </div>
        <h3>${t("Results")} · ${esc(place)}</h3>
        <table class="mini" id="tool-table"><thead><tr><th>${t("Tool")}</th><th>${t("Position")}</th><th>${t("Checked")}</th><th>${t("Status")}</th><th><span class="sr">${t("Action")}</span></th></tr></thead><tbody>${toolRows}${suspects}</tbody></table>
        ${notRanked(view) ? `<p style="margin-top:8px"><button class="link-btn" data-kwr-deeper="${esc(row.id)}" data-engine-id="${e}">${t("Check deeper")}</button></p>` : ""}
        <h3>${t("Other locations")}${view.away.length ? ` · ${t("not compared with")} ${esc(place)}` : ""}</h3>
        ${away}
        <h3>${t("Position history")} ${shownLine ? `<button class="link-btn end" id="kwr-chart-toggle">${t(info.table ? "Chart" : "Table")}</button>` : ""}</h3>
        <p class="small muted" style="margin-bottom:6px">${t("1 = top. One dot per check.")}${hasSuspect ? ` ${t("Hollow dots: suspect, left out of Change.")}` : ""}</p>
        ${picker}${history}
        <h3>${t("Competitors on this page")}</h3>
        ${competitors}
        ${e === "google" ? `<h3>${t("AI Overview")}</h3>${aiCell(row)}` : ""}
        <h3>${t("All results")}</h3>
        ${checks}
        ${UI.relatedTasks ? UI.relatedTasks({ host: row.site || "", keyword: row.keyword, page: row.page || "" }) : ""}
      </div>
      <div class="panel-foot">${task}<button class="btn btn-ghost danger" id="kwr-forget">${t("Stop tracking")}</button></div>`);
    const body = $(".panel-body", $("#panel"));
    if (body) body.scrollTop = scroll;
  }

  function findOf(row, e, view) {
    const p = view.main?.p, c = view.change, engine = name(e);
    const title = c && p ? `${row.keyword} ${t(c < 0 ? "fell" : "rose")} #${p + c} → #${p} ${t("on")} ${engine}` : p ? `${row.keyword} ${t("is at")} #${p} ${t("on")} ${engine}` : `${row.keyword}: ${t("not found on")} ${engine}`;
    const facts = [p ? `#${p} · ${view.main.tool} · ${age(view.main.age_days)}` : "", row.page || ""].filter(Boolean);
    // The task starts linked to this keyword and its page, and its link opens this keyword again (the address keeps it).
    return { title, host: row.site, keywords: [row.keyword], pages: row.page ? [row.page] : [], source: { type: "keyword", label: `${row.keyword} · ${engine}`, host: row.site, facts, link: `#keywords?site=${encodeURIComponent(row.site)}&kw=${encodeURIComponent(row.id)}`, key: `keyword|${row.site_id}|${row.keyword_id}|${e}` } };
  }

  async function recheck(button) {
    const info = K.panel, toolName = button.dataset.kwrCheck;
    if (button.dataset.low && !button.dataset.sure) { // a check costs a credit, and with few left the first click asks
      button.dataset.sure = "1";
      button.textContent = `${t("Use")} 1 ${t("of")} ${num(Number(button.dataset.low))}?`;
      return;
    }
    button.disabled = true;
    UI.setHTML(button, icon("refresh-cw", "spin"));
    const depth = info.detail.row.engines[info.engine].main?.depth || 10;
    // The first press respects the 12-hour guard; the server says when it was checked recently, and a second press spends anyway.
    const again = button.dataset.recent === "1";
    try {
      const run = await api("POST", "refresh/runs", { keyword_ids: [info.keywordId], engines: [info.engine], depth, mode: "pick", picked: [toolName], include_recent: again, token: token() });
      delete button.dataset.recent;
      remember(run, [info.keywordId], [info.engine]);
      follow(run);
    } catch (err) {
      button.disabled = false;
      if (!again && /Checked recently/.test(err.message || "")) {
        button.dataset.recent = "1";
        button.textContent = t("Refresh anyway? 1 credit");
        UI.toast(t(err.message), { kind: "info" });
        return;
      }
      UI.toast(t(err.message), { kind: "crit" });
      button.textContent = t("Refresh");
    }
  }

  async function forget() {
    const info = K.panel, row = rowById(info.id);
    if (!window.confirm(t("Stop tracking this keyword here? Past checks stay."))) return;
    try {
      await api("DELETE", `rankings/${info.keywordId}?site_id=${info.siteId}`);
    } catch (err) { UI.toast(t(err.message), { kind: "crit" }); return; }
    UI.closePanel();
    K.panel = null;
    K.stale = true; load();
    UI.toast(`${t("Stopped tracking")}: ${row?.keyword || ""}`, { undo: async () => { await api("POST", `rankings/${info.keywordId}/restore?site_id=${info.siteId}`); K.stale = true; load(); } });
  }

  // ---- Settings: the search tools -------------------------------------------------------------
  const toolOf = (c) => K.tools?.find((x) => x.name === c.tool);
  window.KW_REAL = {
    /* One line in Settings' panel: paid use for this tool. */
    connExtras(c) {
      const tool = c.group === "serp" ? toolOf(c) : null;
      if (!tool) return "";
      const error = tool.last_error && !window.FIX ? `<p class="note warn" style="margin:0 0 12px">${icon("triangle-alert")}<span dir="auto">${esc(translateSentences(tool.last_error))}</span></p>` : "";
      if (!tool.paid_per) return error + (tool.auth === "key" || tool.auth === "key+zone" ? `<p class="help" style="margin:0 0 12px">${t("No pay-as-you-go price: paid use unavailable.")}</p>` : "");
      return `${error}<label class="opt" style="margin:0 0 4px"><input type="checkbox" class="chk" style="margin:0" id="kwr-paid-on" data-tool="${esc(tool.name)}" ${tool.paid_on ? "checked" : ""}>${t("Allow paid use")}</label><p class="help" style="margin:0 0 12px">${t("Refresh still uses free credits first; each run asks its own limit.")}</p>`;
    },
    /* The order is per engine, so the list says which engine it's showing. */
    orderPicker: () => mainToolPicker() + `<span class="seg" role="group" aria-label="${t("Order for")}" style="margin-left:auto">${ENGINES.map(([id, label]) => `<button type="button" data-kwr-order="${id}" aria-pressed="${K.orderEngine === id}">${label}</button>`).join("")}</span>${K.aiFirst?.[K.orderEngine]?.length && K.aiFirstWhy ? `<p class="small sec kwr-ai-first" style="flex-basis:100%;margin:6px 0 0">${icon("sparkles")} ${esc(t(K.aiFirstWhy))}${UI.tip("SerpApi goes first for Google while it has free searches: it is the only tool that reads AI Overviews.")}</p>` : ""}`,
    openRefresh,
    wanted: () => { if (K.stale && !K.loading) load(); },
    commands: () => { if (!K.data && !K.loading) load(); return commandRows(); },
  };
  const commandRows = () => (K.data?.rows || []).map((row) => ({ label: row.keyword, kind: t("Keyword"), icon: "key-round", run: () => { const open = () => openKeyword(row.id); if (state.route === "keywords") open(); else { UI.go("keywords"); setTimeout(open, 300); } } }));
  Object.assign(window.KW_REAL, {
    filteredIds: () => filtered().map((row) => row.keyword_id),
  });

  async function saveTool(c, button) {
    const box = $("#conn-test-result");
    const fail = (message) => { if (box) UI.setHTML(box, `<span class="error" style="margin:0" role="alert">${icon("octagon-alert")}${esc(t(message))}</span>`); box?.scrollIntoView({ block: "nearest" }); };
    button.disabled = true;
    let changed = false;
    try {
      if (c.auth === "browser") {
        const country = $("#conn-country").value;
        changed = country !== (K.settings.mac_country || "");
        if (changed) await api("PATCH", "tools/settings", { mac_country: country });
      } else if (c.auth !== "none") {
        const key = ($("#conn-key")?.value || $("#conn-url")?.value || "").trim(), zone = $("#conn-zone")?.value.trim();
        changed = Boolean(key) || (c.auth === "key+zone" && c.status !== "off" && zone !== (c.zone || ""));
        if (changed) await api("PUT", `connections/${encodeURIComponent(c.tool)}`, { key, ...(c.auth === "key+zone" ? { zone } : {}) });
        else if (c.status === "off") { fail(c.auth === "url" ? "Paste the address first." : "Paste the key first."); button.disabled = false; $("[data-key-input]")?.focus(); return; }
      }
    } catch (err) { fail(err.message); button.disabled = false; return; }
    await loadTools();
    UI.forgetPanelForm(); UI.closePanel(); UI.render();
    if (!changed) { UI.toast(t("Nothing changed"), { kind: "info" }); return; }
    UI.toast(t("Connection saved"));
    $(`#conn-${c.id}`)?.classList.add("saved");
  }

  async function testTool(c, button) {
    const box = $("#conn-test-result");
    const typed = $$("[data-key-input]").some((input) => input.value.trim());
    if (typed) { UI.setHTML(box, `<span class="note inline-note">${icon("info")}<span>${t("Save the key first.")}</span></span>`); return; }
    button.disabled = true;
    try {
      const answer = await api("POST", `tools/${encodeURIComponent(c.tool)}/test`);
      if (answer.ok === true) $("#conn-fix")?.remove();
      UI.setHTML(box, answer.ok === true ? status("good", `${t(answer.message)}${answer.searches_left === null || answer.searches_left === undefined ? "" : ` ${num(answer.searches_left)} ${t("left")}`}`) : answer.ok === false ? `<span class="error" style="margin:0">${icon("octagon-alert")}${UI.errorHtml ? UI.errorHtml(answer.message) : esc(t(answer.message))}</span>${fixFor(c, answer.message)}` : `<span class="note inline-note">${icon("info")}<span>${esc(t(answer.message))}</span></span>`);
    } catch (err) { UI.setHTML(box, `<span class="error" style="margin:0">${icon("octagon-alert")}${UI.errorHtml ? UI.errorHtml(err) : esc(t(err.message))}</span>${fixFor(c, err.message)}`); }
    button.disabled = false;
  }
  // Under a failed Test, what to do about it. It takes the place of the advice at the top of the panel.
  function fixFor(c, message) {
    if (!window.FIX || !message) return "";
    $("#conn-fix")?.remove();
    return window.FIX.html(message, { tool: c.name, id: c.id, keyUrl: window.FIX.keyUrl(c), refills: c.refills || "", retry: "test" });
  }

  async function moveTool(button) {
    const toolName = button.dataset.tool, by = Number(button.dataset.toolMove), order = [...(K.order[K.orderEngine] || [])];
    const from = order.indexOf(toolName);
    if (from < 0) { UI.toast(t("This tool doesn't search this engine."), { kind: "info" }); return; }
    const to = from + by;
    if (to < 0 || to >= order.length) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    try { await api("PUT", "tools/order", { engine: K.orderEngine, order }); } catch (err) { UI.toast(t(err.message), { kind: "crit" }); return; }
    K.order[K.orderEngine] = order;
    syncSettings();
    K.stale = true; // which tool speaks for a row depends on this
    UI.render();
    const again = $$("[data-tool-move]").find((x) => x.dataset.tool === toolName && x.dataset.toolMove === button.dataset.toolMove);
    (again && !again.disabled ? again : $$("[data-tool-move]").find((x) => x.dataset.tool === toolName && !x.disabled))?.focus();
  }

  // ---- events ---------------------------------------------------------------------------------
  function bind() {
    // On the window, first: these replace what the sample screen does with the same Settings buttons.
    window.addEventListener("click", (e) => {
      const hit = (sel) => e.target.closest?.(sel);
      const serpConn = (id) => { const c = sampleConnections.find((x) => x.id === id); return c?.group === "serp" ? c : null; };
      let el, c;
      if ((el = hit("#conn-save")) && (c = serpConn(el.dataset.id))) { e.stopPropagation(); saveTool(c, el); return; }
      if ((el = hit("#conn-test")) && (c = serpConn($("#conn-save")?.dataset.id))) { e.stopPropagation(); testTool(c, el); return; }
      if ((el = hit("#conn-disconnect")) && (c = serpConn(el.dataset.id))) {
        e.stopPropagation();
        api("DELETE", `connections/${encodeURIComponent(c.tool)}`).then(async () => { await loadTools(); UI.forgetPanelForm(); UI.closePanel(); UI.render(); UI.toast(t("Disconnected")); }).catch((err) => UI.toast(t(err.message), { kind: "crit" }));
        return;
      }
      if ((el = hit("[data-tool-move]"))) { e.stopPropagation(); moveTool(el); return; }
      if ((el = hit("[data-kwr-order]"))) { e.stopPropagation(); K.orderEngine = el.dataset.kwrOrder; syncSettings(); UI.render(); $(`[data-kwr-order="${K.orderEngine}"]`)?.focus(); return; }
      if (hit("#tray-cancel")) return;
      // A chip, a heading, an engine or a view changes the list, so its table starts again on page 1 (before it's drawn).
      if (state.route === "keywords" && hit("[data-filter], [data-sort], [data-engine], [data-view]")) { TP.reset(KW_PAGES); if (hit("[data-engine]")) TP.reset(Q_PAGES); }
    }, true);

    document.addEventListener("click", (e) => {
      const hit = (sel) => e.target.closest?.(sel);
      let el;
      if (hit("#kwr-retry")) { K.stale = true; K.error = ""; load(); UI.render(); return; }
      // The simpler screens: the whole row opens its panel (not its tick box, page link or a button in it); ⋯ pins its tools.
      if (simple() && (el = hit("#kw-table tbody tr[data-kwr-row]")) && !hit("a, button, input, select, textarea, label, [data-kwr-open], .chk-cell")) { openKeyword(el.dataset.kwrRow, el); return; }
      if ((el = hit("[data-kw-also]"))) {
        const id = el.dataset.kwAlso; K.alsoOpen ||= new Set();
        K.alsoOpen.has(id) ? K.alsoOpen.delete(id) : K.alsoOpen.add(id);
        UI.render({ keepScroll: true }); $(`[data-kw-also="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
        return;
      }
      if (hit("#kw-filter")) { K.filterOpen = !K.filterOpen; UI.render({ keepScroll: true }); $(K.filterOpen ? "#kw-filter-panel button" : "#kw-filter")?.focus({ preventScroll: true }); return; }
      if (hit("#kw-filter-close")) { K.filterOpen = false; UI.render({ keepScroll: true }); $("#kw-filter")?.focus({ preventScroll: true }); return; }
      // Inside Filter, a chip or a view redraws the screen: the keyboard stays on what was pressed.
      if ((el = hit("#kw-filter-panel [data-filter], #kw-filter-panel [data-view]"))) { const sel = el.dataset.filter ? `[data-filter="${el.dataset.filter}"]` : `[data-view="${el.dataset.view}"]`; setTimeout(() => $(`#kw-filter-panel ${sel}`)?.focus({ preventScroll: true }), 0); }
      if (hit("[data-kwr-search-clear]")) { kwPages().q = ""; TP.reset(KW_PAGES); UI.render({ keepScroll: true }); $(`[data-tp-search][data-tp-key="${KW_PAGES}"]`)?.focus(); return; }
      if (hit("[data-kwq-search-clear]")) { TP.state(Q_PAGES).q = ""; TP.reset(Q_PAGES); UI.render({ keepScroll: true }); $(`[data-tp-search][data-tp-key="${Q_PAGES}"]`)?.focus(); return; }
      if ((el = hit("[data-kwq-sort]"))) {
        const id = el.dataset.kwqSort, first = Q_SORTS[id].first;
        K.qsort = K.qsort?.id !== id ? { id, dir: first } : K.qsort.dir === first ? { id, dir: first === "asc" ? "desc" : "asc" } : null;
        TP.reset(Q_PAGES); UI.render({ keepScroll: true }); $(`[data-kwq-sort="${id}"]`)?.focus({ preventScroll: true });
        return;
      }
      if (hit("#kwr-refresh, #kwr-refresh-phone")) { openRefresh(K.selected.size ? idsOfSelected() : filtered().map((row) => row.keyword_id)); return; }
      if (hit("#kwr-sel-refresh")) { openRefresh(idsOfSelected()); return; }
      if (hit("#kwr-sel-clear")) { K.selected.clear(); K.allPages = false; UI.render({ keepScroll: true }); return; }
      if (hit("#kwr-sel-all")) {
        K.allPages = true;
        TP.view(KW_PAGES, filtered()).list.forEach((row) => K.selected.add(row.id)); // every page of this list, with its column filters
        UI.render({ keepScroll: true });
        $("#kwr-sel-refresh")?.focus({ preventScroll: true });
        return;
      }
      if (hit("#kwr-sel-task")) {
        const picked = [...K.selected].map(rowById).filter(Boolean);
        const hosts = [...new Set(picked.map((r) => r.site))];
        UI.openTask({ title: `${t("Keywords")}: ${picked.slice(0, 3).map((r) => r.keyword).join(", ")}${picked.length > 3 ? ` +${picked.length - 3}` : ""}`, opener: hit("#kwr-sel-task"), keywords: [...new Set(picked.map((r) => r.keyword))].slice(0, 50), ...(hosts.length === 1 ? { host: hosts[0] } : {}), source: { type: "keyword", label: `${num(picked.length)} ${t("keywords")}`, facts: picked.slice(0, 10).map((r) => r.keyword), link: "#keywords" } });
        return;
      }
      if (hit("#kwr-add, #kwr-add-phone")) { addPanel(hit("#kwr-add, #kwr-add-phone")); return; }
      if ((el = hit("#kwr-add-save"))) { saveKeywords(el); return; }
      if ((el = hit("[data-kwr-follow]"))) { addPanel(el, el.dataset.kwrFollow, el.dataset.siteHost); return; }
      if ((el = hit("[data-kwr-open]"))) { openKeyword(el.dataset.kwrOpen, el); return; }
      if ((el = hit("[data-kwr-deeper]"))) { checkDeeper(rowById(el.dataset.kwrDeeper), el.dataset.engineId); return; }
      if (hit("#kwr-deeper-all") && K.refresh?.deeper) { K.refresh.deeper.all = true; renderRefresh(); ($("#kwr-tool-list .chk:checked") || $("#kwr-tool-list .chk"))?.focus(); return; }
      if ((el = hit("[data-kwr-check]"))) { recheck(el); return; }
      if (hit("#kwr-forget")) { forget(); return; }
      if (hit("#kwr-chart-toggle")) { K.panel.table = !K.panel.table; paintPanel(K.panel); $("#kwr-chart-toggle")?.focus(); return; }
      if ((el = hit(".kwr-stop"))) { el.disabled = true; el.textContent = t("Stopping…"); api("POST", `refresh/runs/${el.dataset.stop}/cancel`).catch(() => {}); return; }
      if ((el = hit(".kwr-tray-close"))) { dropBlock(el.closest(".kwr-run")); return; }
      if ((el = hit(".kwr-tray-moved"))) {
        const engines = el.dataset.engines.split(",").filter(Boolean);
        if (engines.length === 1 && state.engine !== "all") state.engine = engines[0];
        state.filter = "run"; state.view = "positions"; kwPages().q = ""; TP.reset(KW_PAGES);
        if (state.route !== "keywords") UI.go("keywords"); else UI.render({ keepScroll: true });
        return;
      }
      if ((el = hit(".kwr-tray-retry"))) { const ids = el.dataset.ids.split(",").map(Number).filter(Boolean), engines = el.dataset.engines.split(",").filter(Boolean); dropBlock(el.closest(".kwr-run")); openRefresh(ids, engines.length ? engines : undefined); return; }
      if ((el = hit("[data-kwr-mode]"))) { K.refresh.mode = el.dataset.kwrMode; $$("[data-kwr-mode]").forEach((b) => b.setAttribute("aria-pressed", b === el)); updatePreview(); return; }
      if ((el = hit("[data-kwr-connect]"))) { const id = CONN_ID[el.dataset.kwrConnect]; $("#dlg").close(); K.refresh = null; UI.openConnection(id); return; }
      if (hit("#kwr-confirm") && !hit("#kwr-confirm").disabled) { confirmRefresh(hit("#kwr-confirm")); return; }
    });

    document.addEventListener("change", (e) => {
      const el = e.target;
      if (el.id === "kwr-main-tool") {
        const value = el.value;
        api("PATCH", "tools/settings", { main_tool: value })
          .then(async () => { await loadTools(); K.stale = true; load(); UI.toast(value ? t("{tool} is the main tool").replace("{tool}", value) : t("No main tool")); $("#kwr-main-tool")?.focus({ preventScroll: true }); })
          .catch((err) => UI.toast(t(err.message), { kind: "crit" }));
        return;
      }
      if (el.matches?.("[data-kwr-select]")) { if (el.checked) K.selected.add(el.dataset.kwrSelect); else K.selected.delete(el.dataset.kwrSelect); const id = el.dataset.kwrSelect; UI.render({ keepScroll: true }); $$("[data-kwr-select]").find((x) => x.dataset.kwrSelect === id)?.focus(); return; }
      if (el.id === "kwr-select-all") { TP.view(KW_PAGES, filtered()).rows.forEach((row) => { /* the rows on this page only */ if (el.checked) K.selected.add(row.id); else K.selected.delete(row.id); }); UI.render({ keepScroll: true }); $("#kwr-select-all")?.focus(); return; }
      if (el.matches?.("[data-kwr-engine]")) { if (el.checked) K.refresh.engines.add(el.dataset.kwrEngine); else K.refresh.engines.delete(el.dataset.kwrEngine); updatePreview(); return; }
      if (el.id === "kwr-depth") { K.refresh.depth = Number(el.value); updatePreview(); return; }
      if (el.matches?.("[data-kwr-tool]")) { if (el.checked) K.refresh.picked.add(el.dataset.kwrTool); else K.refresh.picked.delete(el.dataset.kwrTool); updatePreview(); return; }
      if (el.id === "kwr-recent") { K.refresh.includeRecent = el.checked; updatePreview(); return; }
      if (el.id === "kwr-paid") { K.refresh.paid = el.checked; $("#kwr-paid-cap").hidden = !el.checked; updatePreview(); return; }
      if (el.id === "kwr-cap") { K.refresh.cap = Number(el.value) || 0; updatePreview(); return; }
      if (el.dataset?.col && el.closest("#kw-filter-panel")) { const k = el.dataset.col; setTimeout(() => $(`#kw-filter-panel [data-col="${k}"]`)?.focus({ preventScroll: true }), 0); }
      if (el.id === "kwr-add-file") { const f = el.files?.[0]; $("#kwr-add-file-name").textContent = f ? f.name : t("No file chosen"); return; }
      if (el.id === "kwr-add-country" || el.id === "kwr-add-language") { shareMarket(); return; }
      if (el.id === "kwr-line") { K.panel.line = el.value; paintPanel(K.panel); $("#kwr-line")?.focus(); return; }
      if (el.id === "kwr-paid-on") {
        const tool = el.dataset.tool;
        api("PUT", `tools/${encodeURIComponent(tool)}/paid`, { on: el.checked }).then(loadTools).catch((err) => { el.checked = !el.checked; UI.toast(t(err.message), { kind: "crit" }); });
      }
    });
    document.addEventListener("close", (e) => { if (e.target.id === "dlg") K.refresh = null; }, true);
    // The simpler screens: Enter or Space on a focused row opens its panel; while it's open, ↑ and ↓ open the row above or below
    // (from the row, the panel itself or nowhere in particular, never from a field or a list inside the panel).
    document.addEventListener("keydown", (e) => {
      if (!simple() || state.route !== "keywords" || e.altKey || e.metaKey || e.ctrlKey) return;
      const row = e.target.matches?.("#kw-table tbody tr[data-kwr-row]") ? e.target : null;
      if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openKeyword(row.dataset.kwrRow, row); return; }
      if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || !K.panel || !$("#panel") || $("#dlg")?.open) return;
      if (!(row || e.target === $("#panel") || e.target === document.body)) return;
      const rows = $$("#kw-table tbody tr[data-kwr-row]"), at = rows.findIndex((tr) => tr.dataset.kwrRow === K.panel.id);
      const next = at < 0 ? null : rows[at + (e.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      e.preventDefault();
      openKeyword(next.dataset.kwrRow, next);
    });
  }
  const idsOfSelected = () => [...new Set([...K.selected].map((id) => rowById(id)?.keyword_id).filter(Boolean))];

  window.KW_REAL.seen = () => filtered().map((row) => row.id); // export.js: the rows on screen, in their order
  window.SCREENS = window.SCREENS || {};
  window.SCREENS.keywords = {
    init(helpers) {
      UI = helpers;
      ({ t, esc, icon, num, dec, status, logo, $, $$, state } = helpers);
      bind();
      if (simple()) {
        state.cols.trend = false; // Trend leaves the default columns (Columns turns it on; the panel has the history)
        // The warm-up and the menu hover fetch what Keywords first shows (screen-data.js).
        window.SCREEN_DATA?.screen?.("keywords", () => ["rankings", "tools"]);
      }
      // Another page, another size or a search draws the screen again; the helper puts the focus back where it was.
      TP.on(KW_PAGES, () => UI.render({ keepScroll: true }));
      TP.on(Q_PAGES, () => UI.render({ keepScroll: true }));
      // Add a note in the bar (table-tools.js) writes one per picked keyword, on other pages too.
      window.TT?.ownSource?.("kwr-selbar", () => [KW_PAGES, [...K.selected].map(rowById).filter(Boolean)]);
      if (state.route === "keywords" || state.route === "settings") load(); // otherwise when Keywords, Settings or ⌘K first needs it (F17)
      // Every Refresh started before a reload, or by a colleague, still shows.
      api("GET", "refresh/runs").then((answer) => answer.runs.forEach(follow)).catch(() => {});
    },
    page,
    after() {
      if (K.stale && !K.loading) load();
      // Filter's count adds the per-column filters, which table-tools.js draws as chips in its slot.
      const count = $("#kw-filter-count");
      if (count) { const n = Number(count.dataset.base || 0) + $$('[data-tt-slot="kw-table"] .tt-chip').length; count.textContent = num(n); count.hidden = !n; }
      openWanted();
      if (simple()) redrawIdeas();
    },
    address() {
      const out = {};
      const p = kwPages();
      if (p.q.trim()) out.q = p.q.trim();
      if (p.page) out.page = p.page + 1;
      if (p.per !== TP.PER[0]) out.per = p.per;
      if (K.panel && $("#panel") && !$("#panel.closing")) out.kw = K.panel.id;
      return out;
    },
    fromAddress(q) {
      const p = kwPages();
      p.q = (q.get("q") || "").slice(0, 200);
      if (TP.PER.includes(Number(q.get("per")))) p.per = Number(q.get("per")); // otherwise the size this browser last chose
      p.page = Math.max(0, (Number(q.get("page")) || 1) - 1);
      K.wantOpen = q.get("kw") || null;
    },
  };
  /* A keyword named in the address opens once the rows are in. */
  function openWanted() {
    if (K.wantKeyword && K.data && state.route === "keywords") {
      const w = K.wantKeyword;
      const found = (w.keywordId && K.data.rows.find((r) => r.keyword_id === w.keywordId && (!w.host || r.site === w.host)))
        || (w.keywordId && K.data.rows.find((r) => r.keyword_id === w.keywordId))
        || K.data.rows.find((r) => sameWord(r.keyword, w.keyword) && (!w.host || r.site === w.host));
      K.wantKeyword = null;
      // Not tracked here: the search itself, in Overview → Queries, rather than a list with no panel (keyword-links.js).
      if (!found && w.text && window.OV?.openQuery) { window.OV.openQuery({ host: w.host, query: w.text }); return; }
      if (found) {
        K.wantOpen = found.id; kwPages().q = "";
        if (!filtered().some((r) => r.id === found.id)) state.filter = "all"; // a chip that hides it is lifted
        kwPages().page = Math.max(0, Math.floor(filtered().findIndex((r) => r.id === found.id) / kwPages().per));
      }
    }
    if (!K.wantOpen || !K.data || state.route !== "keywords") return;
    const id = K.wantOpen;
    K.wantOpen = null;
    if (rowById(id) && (!$("#panel") || K.panel?.id !== id)) setTimeout(() => openKeyword(id), 0); // another keyword's panel gives way
  }
  window.addEventListener("seocc:site-added", () => { K.stale = true; });
  // Keywords added elsewhere (Competitors → Keyword check → Add to my keywords) show here without a reload.
  document.addEventListener("keywords:changed", () => { K.stale = true; K.queries = {}; if (state.route === "keywords" && !K.loading) load(); });
  /* Other screens track a query through the same panel, so there's one way to add a keyword. queries: one or many. */
  /* window.KW, for other screens:
       KW.track(queries, host, opener, market)   the Add keywords panel, filled in (one query or many). On the simpler screens,
                                                 from Keyword ideas inside that panel, the words join its list instead.
       KW.open({ keywordId, keyword, host })     Keywords on that site, with that keyword's panel open once the rows are in.
       KW.recheck(keywordIds, { engine = "google", opener })
                                                 the Refresh dialog for those tracked keyword ids (the keyword_id of
                                                 /api/rankings rows), on one engine, from any screen and without leaving it:
                                                 the same preview, free-credit cost and Confirm, and the tray once it runs.
                                                 It loads the search tools first when Keywords hasn't been opened yet.
                                                 Focus goes back to `opener` when the dialog closes. Resolves to true once the
                                                 dialog is open, false when there was nothing to check or the tools couldn't load.
                                                 Switch on or off alike. */
  /* The same keyword whatever its spacing, width or case, as the server compares them (seo/serp/store.py clean_keyword). */
  const cleanWord = (v) => String(v || "").normalize("NFKC").replace(/[\u200b-\u200f\u2060\ufeff\u00ad]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const sameWord = (a, b) => cleanWord(a) === cleanWord(b);
  window.KW = {
    /* keyword_id of that keyword on that site (any site when host is null); null when the list is in and doesn't hold it;
       undefined when the list hasn't loaded yet, so nobody can say. */
    trackedId(keyword, host = null) {
      const rows = K.data?.rows || window.SCREEN_DATA?.peek?.("rankings")?.rows;
      if (!rows) return undefined;
      const hit = rows.find((r) => sameWord(r.keyword, keyword) && (!host || r.site === host));
      return hit ? hit.keyword_id : null;
    },
    track: (queries, host, opener, market) => {
      const words = [].concat(queries).filter(Boolean);
      if (simple() && opener?.closest?.("#kwr-ideas-slot") && $("#kwr-add-form")) { addToList(words, market || {}, opener); return; }
      addPanel(opener, words.join("\n"), host, market || {});
    },
    async recheck(keywordIds, { engine = "google", opener = null } = {}) {
      const ids = [...new Set([].concat(keywordIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
      if (!ids.length) return false;
      if (!K.tools) {
        try { await loadTools(); } catch (err) { UI.toast(t(err.message), { kind: "crit" }); return false; }
      }
      if ($("#dlg")?.open) $("#dlg").close();
      openRefresh(ids, [ENGINES.some(([id]) => id === engine) ? engine : "google"]);
      const back = opener || document.activeElement;
      $("#dlg").addEventListener("close", () => { if (back?.isConnected) back.focus({ preventScroll: true }); }, { once: true });
      return true;
    },
    /* Open one keyword's panel from anywhere: Keywords opens on its site, and the panel opens once the rows are in. */
    open({ keywordId = null, keyword = "", host = null } = {}) {
      if (host) UI.pickSite(host);
      K.wantKeyword = { keywordId, keyword: String(keyword || ""), text: String(keyword || "").trim(), host };
      if (state.route !== "keywords") UI.go("keywords"); else openWanted();
      if (K.stale && !K.loading) load(); else openWanted();
    },
  };
})();
