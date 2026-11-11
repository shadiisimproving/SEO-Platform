/* Keywords, Refresh and the search tools in Settings, on real data. Only when the real server is there: opened as a plain file,
   the sample screen in mockup.js stays. Rankings come from /api/rankings, which holds every rule about what may be compared. This
   file only shows them, so a tool switch can't turn into a move here. All HTML goes through setHTML, and all values through esc. */
(() => {
  "use strict";
  const fr = {
    "Scraped results": "Résultats scrapés", "tool changed": "outil changé", "depth changed": "profondeur changée", "location changed": "lieu changé",
    "The last checks used different tools, so the change can't be compared.": "Les derniers contrôles viennent d'outils différents : l'évolution ne peut pas être comparée.",
    "The last checks read a different depth, so the change can't be compared.": "Les derniers contrôles n'ont pas lu la même profondeur : l'évolution ne peut pas être comparée.",
    "The last checks searched from a different place, so the change can't be compared.": "Les derniers contrôles ne cherchaient pas depuis le même endroit : l'évolution ne peut pas être comparée.",
    "Not checked yet": "Pas encore contrôlé", "Unverified": "Non vérifié", "No earlier check with this tool, and nothing from the engine's own tool to compare with.": "Aucun contrôle précédent avec cet outil, et rien de l'outil du moteur pour comparer.", "Another location": "Autre lieu", "No free checks left on this tool.": "Plus de contrôles gratuits sur cet outil.", "Nothing changed": "Rien n'a changé",
    "No free tools left for Google.": "Plus d'outil gratuit pour Google.", "No free tools left for DuckDuckGo.": "Plus d'outil gratuit pour DuckDuckGo.", "No free tools left for Bing.": "Plus d'outil gratuit pour Bing.", "No free tools left for Yandex.": "Plus d'outil gratuit pour Yandex.",
    "Bright Data has no free checks left.": "Bright Data n'a plus de contrôles gratuits.", "SerpApi has no free checks left.": "SerpApi n'a plus de contrôles gratuits.", "HasData has no free checks left.": "HasData n'a plus de contrôles gratuits.", "Searlo has no free checks left.": "Searlo n'a plus de contrôles gratuits.",
    "A captcha appeared and didn't clear, so the browser backup stopped.": "Un captcha est apparu et n'a pas disparu : la sauvegarde par navigateur s'est arrêtée.", "The app doesn't try to get past it.": "L'application ne cherche pas à le contourner.",
    "DuckDuckGo asked for a bot check, so this tool stopped.": "DuckDuckGo a demandé une vérification anti-robot : cet outil s'est arrêté.", "The app does not try to get past it.": "L'application ne cherche pas à la contourner.", "Not in top": "Hors du top", "just now": "à l'instant", "today": "aujourd'hui", "Search Console impressions, last 28 days. Exact volume isn't available for free.": "Impressions Search Console, 28 derniers jours. Le volume exact n'est pas disponible gratuitement.",
    "No number from this engine's own tool. It isn't connected for this site, or it hasn't reported this keyword.": "Aucun chiffre de l'outil de ce moteur. Il n'est pas connecté pour ce site, ou n'a pas signalé ce mot-clé.",
    "Needs 2 checks with the same tool": "Il faut 2 contrôles avec le même outil", "Tools disagree": "Les outils ne sont pas d'accord", "Suspect result": "Résultat suspect", "Can't verify yet": "Vérification impossible pour l'instant",
    "No Refresh yet": "Aucune actualisation", "Add keywords": "Ajouter des mots-clés", "No keywords yet": "Pas encore de mots-clés", "Add the keywords you want to follow for this site.": "Ajoutez les mots-clés à suivre pour ce site.",
    "Add a site first": "Ajoutez d'abord un site", "Keywords belong to a site. Add yours, then come back.": "Les mots-clés appartiennent à un site. Ajoutez le vôtre, puis revenez.", "Go to Settings": "Aller aux réglages",
    "Keywords, one per line": "Mots-clés, un par ligne", "Or upload a file": "Ou importez un fichier", "For which site?": "Pour quel site ?", "Country": "Pays", "Language": "Langue", "Any country": "Tous les pays", "Optional, such as fr": "Facultatif, par exemple fr", "Country and language are the ones this site's keywords use most.": "Le pays et la langue sont ceux que les mots-clés de ce site utilisent le plus.",
    "Each new keyword gets one check with a free tool, to see who really ranks. After that, DuckDuckGo is checked by itself every day, and the other engines when you press Refresh.": "Chaque nouveau mot-clé reçoit un contrôle avec un outil gratuit, pour voir qui se classe vraiment. Ensuite, DuckDuckGo est vérifié tout seul chaque jour, et les autres moteurs quand vous appuyez sur Actualiser.",
    "Put at least one keyword, or choose a file.": "Indiquez au moins un mot-clé, ou choisissez un fichier.", "Keywords added": "Mots-clés ajoutés",
    "Couldn't load the keywords.": "Impossible de charger les mots-clés.", "Try again": "Réessayer", "Loading…": "Chargement…",
    "Refresh keywords": "Actualiser les mots-clés", "keyword": "mot-clé", "keywords": "mots-clés", "Engines": "Moteurs", "Depth": "Profondeur", "Top": "Top", "Tools": "Outils", "Automatic: free first": "Automatique : gratuits d'abord", "Choose tools": "Choisir les outils",
    "Connect": "Connecter", "No credits needed": "Aucun crédit nécessaire", "left": "restants", "of": "sur", "monthly": "chaque mois", "one-time": "une seule fois", "no credits": "sans crédits", "Refills monthly": "Se recharge chaque mois", "Never refills": "Ne se recharge jamais",
    "Not for these engines": "Pas pour ces moteurs", "Only when you pick it": "Seulement si vous le choisissez", "check": "contrôle", "checks": "contrôles", "credit": "crédit", "credits": "crédits", "paid": "payants", "This will use": "Cela utilisera", "over": "pour",
    "Runs out after": "S'arrête après", "Nothing to check.": "Rien à contrôler.", "Choose at least one engine.": "Choisissez au moins un moteur.", "Pick at least one tool.": "Choisissez au moins un outil.", "Confirm": "Confirmer", "Cancel": "Annuler", "Close": "Fermer",
    "Already being refreshed:": "Déjà en cours d'actualisation :", "by": "par", "Checked in the last": "Contrôlés dans les dernières", "hours, so left out:": "heures, donc écartés :", "Check them again": "Les contrôler quand même",
    "No tool can search": "Aucun outil ne peut chercher sur", "Connect one in Settings.": "Connectez-en un dans les réglages.", "Paid use is off.": "L'usage payant est désactivé.", "Use paid credits if free ones run out": "Utiliser des crédits payants si les gratuits sont épuisés", "Limit this run to": "Limiter cette actualisation à", "Estimated cost": "Coût estimé",
    "Free tools first. Paid use is off.": "Outils gratuits d'abord. Usage payant désactivé.", "A real browser on this Mac reads the results. It stops at the first captcha that doesn't clear.": "Un vrai navigateur sur ce Mac lit les résultats. Il s'arrête au premier captcha qui ne disparaît pas.",
    "Set the country this Mac is in first, in Settings.": "Indiquez d'abord le pays de ce Mac, dans les réglages.",
    "Refreshing": "Actualisation", "Stop": "Arrêter", "Stopping…": "Arrêt…", "out of credits, continuing with": "n'a plus de crédits, on continue avec", "Finished": "Terminé", "Stopped": "Arrêté", "saved": "enregistrés", "failed": "échoués", "not run": "non lancés", "Stopped: no free tools left": "Arrêté : plus d'outil gratuit",
    "started by": "lancée par", "Refresh started": "Actualisation lancée", "This Refresh is already running.": "Cette actualisation est déjà en cours.",
    "Results": "Résultats", "Tool": "Outil", "Position": "Position", "Checked": "Contrôlé", "Status": "Statut", "Action": "Action", "Recheck": "Recontrôler", "Check": "Contrôler", "never": "jamais", "OK": "OK", "Use": "Utiliser", "Rechecking": "Nouveau contrôle",
    "Other locations": "Autres lieux", "Not compared with": "Non comparé avec", "None yet": "Aucun pour l'instant", "Position over time": "Position dans le temps", "1 at the top; each dot is one real check": "1 en haut ; chaque point est un vrai contrôle", "Hollow dots are suspect results, left out of Change.": "Les points vides sont des résultats suspects, exclus de l'évolution.",
    "Chart view": "Vue graphique", "Table view": "Vue tableau", "Date": "Date", "All results": "Tous les résultats", "Competitors on this page": "Concurrents sur cette page", "Website": "Site web", "Change": "Évolution", "AI Overview": "Aperçu IA", "Page": "Page", "average": "moyenne",
    "Cited": "Cité", "Overview, not cited": "Aperçu, pas cité", "No overview": "Pas d'aperçu", "Not captured": "Non capturé", "Failed": "Échec", "Not connected": "Non connecté", "Check deeper": "Chercher plus loin", "Stop following": "Ne plus suivre", "Stopped following": "Suivi arrêté", "Follow": "Suivre", "Stop tracking": "Ne plus suivre", "Stopped tracking": "Suivi arrêté", "Track": "Suivre", "Refresh": "Actualiser",
    "Stop tracking this keyword on this site? Its past checks stay.": "Ne plus suivre ce mot-clé sur ce site ? Ses anciens contrôles restent.", "Site": "Site",
    "Stop following this keyword on this site? Its past checks stay.": "Ne plus suivre ce mot-clé sur ce site ? Ses anciens contrôles restent.",
    "No Search Console data yet": "Pas encore de données Search Console", "Connect Search Console for this site in Settings, and its queries appear here within 3 days.": "Connectez Search Console pour ce site dans les réglages : ses requêtes apparaîtront ici sous 3 jours.",
    "No Bing Webmaster data yet": "Pas encore de données Bing Webmaster", "No Yandex Webmaster data yet": "Pas encore de données Yandex Webmaster", "Connect it for this site in Settings, and its queries appear here.": "Connectez-le pour ce site dans les réglages : ses requêtes apparaîtront ici.",
    "DuckDuckGo has no tool for site owners, so the app checks its positions by itself every day, oldest first, on free searches only. Refresh and Refresh data check them now.": "DuckDuckGo n'a pas d'outil pour les propriétaires de sites : l'app vérifie ses positions toute seule chaque jour, les plus anciennes d'abord, avec des recherches gratuites uniquement. Actualiser et Actualiser les données les vérifient tout de suite.",
    "Automatic DuckDuckGo check": "Contrôle DuckDuckGo automatique", "automatic check": "contrôle automatique",
    "Clicks": "Clics", "Click rate": "Taux de clic", "selected": "sélectionnés", "Clear selection": "Effacer la sélection", "Create task": "Créer une tâche", "Export CSV": "Exporter en CSV", "Export ready": "Export prêt",
    "Up": "En hausse", "Down": "En baisse", "Top 3": "Top 3", "Top 10": "Top 10", "All": "Tous", "Not ranked": "Non classés", "Cited by AI": "Cités par l'IA", "Same keyword on 2 pages": "Même mot-clé sur 2 pages", "Two of your pages show up for this keyword.": "Deux de vos pages ressortent pour ce mot-clé.",
    "Tracked": "Suivis", "Ranked": "Classés", "compared": "comparés", "Positions": "Positions", "By bucket": "Par tranche", "Queries": "Requêtes", "All engines": "Tous les moteurs", "Volume": "Volume", "Trend": "Tendance", "AI": "IA", "avg position": "position moy.",
    "No keywords match this filter": "Aucun mot-clé ne correspond à ce filtre", "Try another filter, or show all keywords.": "Essayez un autre filtre, ou affichez tous les mots-clés.", "Show all keywords": "Afficher tous les mots-clés", "Data through": "Données jusqu'au", "Last Refresh": "Dernière actualisation", "Rankings from each engine's own tool and from scraped results": "Positions venant de l'outil de chaque moteur et de résultats scrapés",
    "Order for": "Ordre pour", "This tool doesn't search this engine.": "Cet outil ne couvre pas ce moteur.", "Order saved": "Ordre enregistré",
    "Allow paid use": "Autoriser l'usage payant", "Off until you switch it on. Refresh still uses free credits first, and each run asks for its own limit.": "Désactivé tant que vous ne l'activez pas. Actualiser utilise d'abord les crédits gratuits, et chaque actualisation demande sa limite.",
    "No pay-as-you-go price, so paid use can't be switched on.": "Pas de prix à l'usage : l'usage payant ne peut pas être activé.", "Connection saved": "Connexion enregistrée", "Disconnected": "Déconnecté", "Paste the key first.": "Collez d'abord la clé.", "Works.": "Fonctionne.",
    "Save the key first.": "Enregistrez d'abord la clé.", "This key wasn't checked, because a check would use a credit. Save it, and the first search shows whether it works.": "Cette clé n'a pas été vérifiée, car cela utiliserait un crédit. Enregistrez-la : la première recherche montrera si elle fonctionne.",
    "The browser backup needs Playwright, which isn't installed. Install it with: .venv/bin/pip install playwright": "La sauvegarde par navigateur a besoin de Playwright, qui n'est pas installé. Installez-le avec : .venv/bin/pip install playwright",
    "Add the zone name too. Bright Data needs both.": "Ajoutez aussi le nom de la zone. Bright Data a besoin des deux.", "Paste the whole address, starting with https://.": "Collez l'adresse entière, en commençant par https://.", "Paste the address first.": "Collez d'abord l'adresse.",
    "These keywords are already being refreshed.": "Ces mots-clés sont déjà en cours d'actualisation.", "These keywords were all checked just now. Tick Check them again to go ahead.": "Ces mots-clés viennent tous d'être contrôlés. Cochez Les contrôler quand même pour continuer.",
    "No search tool can run these engines. Connect one in Settings.": "Aucun outil de recherche ne couvre ces moteurs. Connectez-en un dans les réglages.",
    "This run lost its background job. Everything checked so far is saved.": "Cette actualisation a perdu sa tâche de fond. Tout ce qui a été contrôlé est enregistré.",
    "Search queries": "Chercher une requête", "No query matches this search.": "Aucune requête ne correspond à cette recherche.", "queries": "requêtes", "query": "requête", "keyword": "mot-clé", "keywords": "mots-clés",
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
    run: null, poll: null, orderEngine: "google", panel: null, refresh: null, browserMissing: false,
    wantOpen: null, qsort: null, // a keyword named in the address; the Queries table's sorted heading
  };
  /* Both tables page and search the way every long table does (table-pages.js): TP keeps the search, the page and the size. */
  const KW_PAGES = "kw", Q_PAGES = "kwq";
  const kwPages = () => TP.state(KW_PAGES);
  const api = (...args) => window.COMP.api(...args);
  const mine = (run) => Boolean(run) && (!run.by || run.by === window.BOOT.user?.name);
  const AUTO_BY = "Automatic"; // seo/serp/auto_ddg.py: the daily DuckDuckGo check, and the one Refresh data starts
  const engineOf = () => (state.engine === "all" ? "google" : state.engine);
  const name = (id) => ENGINES.find(([e]) => e === id)?.[1] || id;
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
  const shortPath = (url) => { try { const u = new URL(url); return decodeURI(u.pathname + u.search) || "/"; } catch { return url || ""; } };
  const allRows = () => { const host = UI.siteHostPicked(); return (K.data?.rows || []).filter((row) => !host || row.site === host); };

  // ---- loading --------------------------------------------------------------------------------
  async function loadTools() {
    const answer = await api("GET", "tools");
    K.tools = answer.tools; K.order = answer.order; K.settings = answer.settings; K.browserMissing = answer.browser_missing;
    K.aiFirst = answer.first_for_ai || {}; K.aiFirstWhy = answer.first_for_ai_why || "";
    syncSettings();
    return answer;
  }

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
      c.note = keyless && tool.auth === "browser" && K.browserMissing ? "The browser backup needs Playwright, which isn't installed. Install it with: .venv/bin/pip install playwright" : "";
      if (tool.auth === "browser") c.country = K.settings.mac_country || "";
    });
  }

  async function load() {
    if (K.loading) return;
    K.loading = true;
    try {
      const [data] = await Promise.all([api("GET", "rankings"), loadTools()]);
      K.data = data; K.error = ""; K.stale = false;
      const live = new Set(data.rows.map((row) => row.id));
      [...K.selected].forEach((id) => { if (!live.has(id)) K.selected.delete(id); });
    } catch (err) { K.error = err.message; K.stale = false; }
    K.loading = false;
    if (state.route === "keywords" || state.route === "settings") UI.render({ keepScroll: true });
    openWanted();
    if ($("#cmdk")?.open) $("#cmd-input")?.dispatchEvent(new Event("input", { bubbles: true })); // ⌘K opened before the keywords came
  }

  // ---- table cells ----------------------------------------------------------------------------
  function posBadge(view) {
    if (view.p) return `<span class="pos ${view.p <= 3 ? "pos-top3" : view.p <= 10 ? "pos-top10" : ""}">#${view.p}</span>`;
    const words = `${t("Not in top")} ${view.depth}`;
    return `<span class="pos pos-none" role="img" tabindex="0" data-tip="${esc(words)}" aria-label="${esc(words)}">&gt;${view.depth}</span>`;
  }
  const flagged = (view) => (view.status === "suspect" ? `<span class="warn" role="img" data-tip="${t("Suspect result")}" tabindex="0" aria-label="${t("Suspect result")}">${icon("shield-question")}</span>` : "");
  const line = (view, extra = "") => `<span class="res-line">${logo(view.tool, 16)}${posBadge(view)}${flagged(view)}${extra}<span class="res-meta">${esc(t(view.tool))} · ${age(view.age_days)}</span></span>`;

  function scrapedCell(row, e) {
    const view = row.engines[e];
    if (!view.main) {
      if (view.away.length) return `<span class="res"><span class="muted small">${t("Not checked yet")}</span>${view.away.slice(0, 1).map((a) => `<span class="res-line">${logo(a.tool, 16)}${posBadge(a)}<span class="res-meta">${esc(a.location || "?")} · ${t("Not compared with")} ${esc(UI.countryName(row.country) || row.country)}</span></span>`).join("")}</span>`;
      return `<span class="muted small">${t("Not checked yet")}</span>`;
    }
    const differs = view.disagree ? `<span class="warn" role="img" data-tip="${esc(t("Tools disagree"))}: ${esc(view.disagree.tools.map((x) => t(x)).join(" / "))}, ${view.disagree.diff}" tabindex="0" aria-label="${t("Tools disagree")}">${icon("triangle-alert")}</span>` : "";
    const rest = [...view.suspects.slice(-1), ...view.others].slice(0, 2).map((x) => line(x)).join("");
    const deeper = view.main.p || view.main.status !== "ok" ? "" : `<button class="link-btn" data-kwr-deeper="${esc(row.id)}" data-engine-id="${e}">${t("Check deeper")}</button>`;
    return `<span class="res">${line(view.main, differs)}${rest}${deeper}</span>`;
  }

  const CHANGE_WHY = { "tool changed": "The last checks used different tools, so the change can't be compared.", "depth changed": "The last checks read a different depth, so the change can't be compared.", "location changed": "The last checks searched from a different place, so the change can't be compared." };
  function changeCell(view) {
    const c = view.change;
    if (c === null || c === undefined) {
      if (view.change_note) return `<span class="cellval"><span class="muted">—</span><span class="second" data-tip="${esc(t(CHANGE_WHY[view.change_note]))}" tabindex="0">${esc(t(view.change_note))}</span></span>`;
      return `<span class="muted dash">—</span>`;
    }
    if (c === 0) return `<span class="muted">0</span>`;
    return `<span class="chg ${c > 0 ? "good" : "crit"}" aria-label="${t(c > 0 ? "Up" : "Down")} ${Math.abs(c)}">${icon(c > 0 ? "arrow-up" : "arrow-down")}${Math.abs(c)}</span>`;
  }
  const aiCell = (row) => ({
    cited: `<span class="nowrap">${icon("sparkles")} ${t("Cited")}</span>`,
    overview: `<span class="sec small">${t("Overview, not cited")}</span>`,
    none: `<span class="muted small">${t("No overview")}</span>`,
    "not-captured": `<span class="muted small" tabindex="0" data-tip="${t("Not captured")}">${t("Not captured")}</span>`,
  }[row.ai.state]);
  /* Google: the position in the keyword's own country when Search Console has it, with the all-countries average under it. */
  const ownCell = (view, row = null, e = "") => {
    const local = e === "google" ? row?.own_country : null;
    if (local && local.position !== null && local.position !== undefined) {
      const world = view.own === null || view.own === undefined ? "" : `<span class="second">${t("All countries")} ${dec(Math.round(view.own * 10) / 10)}</span>`;
      return `<span class="cellval"><span class="tabular">${dec(local.position)}</span><span class="second">${esc(UI.countryName(local.country) || local.country)}</span>${world}</span>`;
    }
    return view.own === null || view.own === undefined
      ? `<span class="muted dash" tabindex="0" data-tip="${esc(t("No number from this engine's own tool. It isn't connected for this site, or it hasn't reported this keyword."))}">—</span>`
      : `<span class="tabular">${dec(Math.round(view.own * 10) / 10)}</span>`;
  };

  const impressionsOf = (row) => row.impressions ?? row.volume ?? null;
  function passes(row, e) {
    const view = row.engines[e], p = view.main?.status === "ok" ? view.main.p : null;
    switch (state.filter) {
      case "top3": return p && p <= 3;
      case "top10": return p && p <= 10;
      case "up": return view.change > 0;
      case "down": return view.change < 0;
      case "none": return !p;
      case "cited": return row.ai.state === "cited";
      case "two": return row.two_pages;
      default: return true;
    }
  }
  /* The search box: words of the keyword, or of its site or page, ignoring case and accents. */
  const searched = (rows) => rows.filter((row) => TP.matches(KW_PAGES, row.keyword, row.page, state.site === "all" ? row.site : ""));
  function filtered() {
    const e = engineOf();
    const value = (row) => { const v = row.engines[e]; return { k: row.keyword, own: v.own, pos: v.main?.status === "ok" ? v.main.p : null, chg: v.change, vol: impressionsOf(row) }[state.sort.key]; };
    const sign = state.sort.dir === "ascending" ? 1 : -1;
    return searched(allRows()).filter((row) => passes(row, e)).sort((a, b) => {
      const x = value(a), y = value(b);
      if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1; // unknowns go last, whichever way it's sorted
      if (y === null || y === undefined) return -1;
      return (typeof x === "string" ? x.localeCompare(y, UI.locale()) : x - y) * sign;
    });
  }

  /* A column heading sorts; its definition (shared-ui.js) shows on hover and on keyboard focus of the heading's button. */
  function sortHeader(key, label, align = "", sub = "", tip = "") {
    const on = state.sort.key === key;
    const def = tip || UI.def?.(UI.defKey?.(key === "vol" ? "Impressions (28 days)" : key === "own" ? "avg position" : label)) || "";
    return `<th scope="col" class="${align}" ${on ? `aria-sort="${state.sort.dir}"` : ""}><button data-sort="${key}" ${def ? `data-tip="${esc(def)}"` : ""}><span>${esc(label)}${sub ? `<span class="th-sub">${esc(sub)}</span>` : ""}</span>${icon(on && state.sort.dir === "ascending" ? "arrow-up" : "arrow-down")}</button></th>`;
  }

  function rowHtml(row) {
    const e = engineOf(), view = row.engines[e];
    const trend = view.trend.length >= 2 ? UI.spark(view.trend.map((x) => x.p), { invert: true }) : `<span class="muted dash" data-tip="${t("Needs 2 checks with the same tool")}" tabindex="0">—</span>`;
    const cells = state.engine === "all"
      ? ENGINES.map(([id, label]) => `<td data-label="${label}">${scrapedCell(row, id)}</td>`).join("")
      : `${OWN_TOOL[e] ? `<td class="c" data-label="${OWN_TOOL[e]} · ${t("avg position")}">${ownCell(view, row, e)}</td>` : ""}
         <td data-label="${t("Scraped results")}">${scrapedCell(row, e)}</td>
         <td class="c" data-label="${t("Change")}">${changeCell(view)}</td>
         ${state.cols.vol ? `<td class="c" data-label="${t("Impressions (28 days)")}">${impressionsOf(row) === null ? '<span class="muted dash">—</span>' : num(impressionsOf(row))}</td>` : ""}
         ${state.cols.trend ? `<td data-label="${t("Trend")}">${trend}</td>` : ""}
         ${state.cols.page ? `<td class="url-cell mono small" data-label="${t("Page")}" ${row.page ? `data-tip="${esc(row.page)}"` : ""}>${row.page ? PageLink.html(row.page, { text: shortPath(row.page), title: "" }) : '<span class="muted dash">—</span>'}${row.two_pages ? `<span class="warn" role="img" tabindex="0" data-tip="${esc(t("Two of your pages show up for this keyword."))}" aria-label="${esc(t("Same keyword on 2 pages"))}">${icon("triangle-alert")}</span>` : ""}</td>` : ""}
         ${state.cols.ai ? `<td data-label="${t("AI")}">${aiCell(row)}</td>` : ""}`;
    return `<tr data-kwr-row="${esc(row.id)}" class="${K.selected.has(row.id) ? "sel" : ""} ${K.panel?.id === row.id && $("#panel") ? "open" : ""}">
      <td class="chk-cell"><input type="checkbox" class="chk" data-kwr-select="${esc(row.id)}" ${K.selected.has(row.id) ? "checked" : ""} aria-label="${t("selected")}: ${esc(row.keyword)}"></td>
      <td class="head-cell"><button class="kw" data-kwr-open="${esc(row.id)}" dir="auto" style="text-align:start">${esc(row.keyword)}</button>${state.site === "all" ? `<span class="second mono" dir="auto">${esc(row.site)}</span>` : ""}</td>
      ${cells}</tr>`;
  }

  function table(all) {
    if (!all.length && kwPages().q.trim()) return `<div class="table-wrap"><div class="empty"><h3>${t("No keyword matches this search.")}</h3><p dir="auto">${esc(kwPages().q.trim())}</p><button class="btn" data-kwr-search-clear>${t("Clear the search")}</button></div></div>`;
    if (!all.length) return `<div class="table-wrap"><div class="empty"><h3>${t("No keywords match this filter")}</h3><p>${t("Try another filter, or show all keywords.")}</p><button class="btn" data-filter="all">${t("Show all keywords")}</button></div></div>`;
    const view = TP.view(KW_PAGES, all), rows = view.rows;
    // A pick only counts on the page it was made on: the bar under the table acts on what's in view.
    const here = new Set(rows.map((row) => row.id));
    [...K.selected].forEach((id) => { if (!here.has(id)) K.selected.delete(id); });
    const e = engineOf();
    const head = state.engine === "all"
      ? ENGINES.map(([id, label]) => `<th scope="col"><span class="th-engine">${logo(id, 16)}${label}</span></th>`).join("")
      : `${OWN_TOOL[e] ? sortHeader("own", OWN_TOOL[e], "c", t("avg position")) : ""}
         ${sortHeader("pos", t("Scraped results"))}${sortHeader("chg", t("Change"), "c")}
         ${state.cols.vol ? sortHeader("vol", t("Impressions"), "c", t("28 days"), t("Search Console impressions, last 28 days. Exact volume isn't available for free.")) : ""}
         ${state.cols.trend ? `<th scope="col">${t("Trend")}</th>` : ""}${state.cols.page ? `<th scope="col">${t("Page")}</th>` : ""}${state.cols.ai ? `<th scope="col">${t("AI")}</th>` : ""}`;
    const every = rows.length > 0 && rows.every((row) => K.selected.has(row.id));
    return `<div class="ov-list"><div class="table-wrap ${state.dense ? "dense" : ""}"><table class="data" id="kw-table" aria-label="${t("Keywords")}">
      <thead><tr><th scope="col" class="chk-cell"><input type="checkbox" class="chk" id="kwr-select-all" ${every ? "checked" : ""} aria-label="${t("All")}"></th>${sortHeader("k", t("Keyword"))}${head}</tr></thead>
      <tbody>${rows.map(rowHtml).join("")}</tbody></table></div>${TP.footer(KW_PAGES, view, { noun: t(view.total === 1 ? "keyword" : "keywords") })}</div>`;
  }

  function selectionBar() {
    if (!K.selected.size) return "";
    return `<div class="selbar" role="region" aria-label="${t("selected")}"><b>${num(K.selected.size)} ${t("selected")}</b>
      <button class="btn btn-main btn-small" id="kwr-sel-refresh">${icon("refresh-cw")}${t("Refresh")}</button>
      <button class="btn btn-small" id="kwr-sel-task">${t("Create task")}</button>
      <button class="icon-btn" id="kwr-sel-clear" aria-label="${t("Clear selection")}" data-tip="${t("Clear selection")}">${icon("x")}</button></div>`;
  }

  function bucketView(rows) {
    const e = engineOf();
    const pos = rows.map((row) => (row.engines[e].main?.status === "ok" ? row.engines[e].main.p : null));
    const buckets = [["1-3", pos.filter((p) => p && p <= 3).length], ["4-10", pos.filter((p) => p > 3 && p <= 10).length], ["11-20", pos.filter((p) => p > 10 && p <= 20).length], ["21+", pos.filter((p) => p > 20).length], [t("Not ranked"), pos.filter((p) => !p).length]];
    const max = Math.max(...buckets.map((b) => b[1]), 1);
    return `<section class="card" style="padding:16px">${buckets.map(([label, n]) => `
      <div style="display:grid;grid-template-columns:90px 1fr 30px;gap:10px;align-items:center;padding:6px 0;font-size:13px">
        <span class="sec">${label}</span><span class="bucket-bar"><span style="width:${(n / max) * 100}%"></span></span><span class="tabular" style="text-align:center;font-weight:600">${num(n)}</span></div>`).join("")}</section>`;
  }

  function queriesView() {
    const e = engineOf();
    if (e === "duckduckgo") return `<p class="note">${icon("info")}<span>${t("DuckDuckGo has no tool for site owners, so the app checks its positions by itself every day, oldest first, on free searches only. Refresh and Refresh data check them now.")}</span></p>`;
    const key = `${e}`;
    if (!K.queries[key]) { K.queries[key] = "loading"; api("GET", `rankings/queries?engine=${e}`).then((answer) => { K.queries[key] = answer.rows; if (state.view === "queries") UI.render({ keepScroll: true }); }).catch(() => { K.queries[key] = []; if (state.view === "queries") UI.render({ keepScroll: true }); }); }
    if (K.queries[key] === "loading") return UI.skeleton("table", { rows: 8 });
    const host = UI.siteHostPicked();
    const rows = K.queries[key].filter((row) => !host || row.site === host);
    if (!rows.length) {
      const words = e === "google" ? ["No Search Console data yet", "Connect Search Console for this site in Settings, and its queries appear here within 3 days."] : [e === "bing" ? "No Bing Webmaster data yet" : "No Yandex Webmaster data yet", "Connect it for this site in Settings, and its queries appear here."];
      return `<div class="table-wrap"><div class="empty"><h3>${t(words[0])}</h3><p>${t(words[1])}</p><button class="btn" data-go="settings">${t("Go to Settings")}</button></div></div>`;
    }
    const tracked = new Set(allRows().map((row) => `${row.site}|${row.keyword.toLowerCase()}`));
    const found = sortedQueries(rows.filter((row) => TP.matches(Q_PAGES, row.query, state.site === "all" ? row.site : "")));
    const tools = `<div class="kw-find">${TP.search(Q_PAGES, t("Search queries"))}</div>`;
    if (!found.length) return `${tools}<div class="table-wrap"><div class="empty"><h3>${t("No query matches this search.")}</h3><p dir="auto">${esc(TP.state(Q_PAGES).q.trim())}</p><button class="btn" data-kwq-search-clear>${t("Clear the search")}</button></div></div>`;
    const view = TP.view(Q_PAGES, found);
    const head = (id, label) => {
      const on = K.qsort?.id === id;
      return `<th scope="col" class="c" aria-sort="${on ? (K.qsort.dir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" class="th-btn" data-kwq-sort="${id}">${label}${on ? icon(K.qsort.dir === "asc" ? "arrow-up" : "arrow-down") : ""}</button></th>`;
    };
    return `${tools}<div class="ov-list"><div class="table-wrap"><table class="data" id="kwq-table"><thead><tr><th scope="col">${t("Keyword")}</th>${head("clicks", t("Clicks"))}${head("impressions", "Impressions")}${head("ctr", t("Click rate"))}${head("position", t("Position"))}<th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead>
      <tbody>${view.rows.map((row) => `<tr style="cursor:default"><td class="head-cell kw" dir="auto">${esc(row.query)}${state.site === "all" ? `<span class="second mono">${esc(row.site)}</span>` : ""}</td><td class="c" data-label="${t("Clicks")}">${num(row.clicks)}</td><td class="c" data-label="Impressions">${num(row.impressions)}</td><td class="c" data-label="${t("Click rate")}">${row.impressions ? `${dec(Math.round((row.clicks / row.impressions) * 1000) / 10)}%` : "—"}</td><td class="c" data-label="${t("Position")}">${row.position === null ? "—" : dec(Math.round(row.position * 10) / 10)}</td><td class="r">${tracked.has(`${row.site}|${row.query.toLowerCase()}`) ? "" : `<button class="btn btn-small" data-kwr-follow="${esc(row.query)}" data-site-host="${esc(row.site)}">${t("Track")}</button>`}</td></tr>`).join("")}</tbody></table></div>
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

  /* When every connected tool for this engine has no free checks left, Keywords says so where the unchecked rows are. */
  function outOfChecks(rows) {
    const e = engineOf();
    const tools = (K.tools || []).filter((tool) => tool.connected && (tool.engines || []).includes(e) && !tool.manual_only);
    if (!tools.length || tools.some((tool) => tool.left === null || tool.left === undefined || tool.left > 0)) return "";
    const waiting = rows.filter((row) => !row.engines[e]?.main).length;
    const refill = tools.every((tool) => tool.refills === "one-time") ? t("They don't refill: connect another tool in Settings.") : t("They refill each month, or connect another tool in Settings.");
    return `<div class="note warn" role="status">${icon("triangle-alert")}<span><b>${t("No free checks left for")} ${esc(name(e))}.</b> ${waiting ? `${num(waiting)} ${t(waiting === 1 ? "keyword waits as Not checked yet." : "keywords wait as Not checked yet.")} ` : ""}${refill} <button class="link-btn" data-go="settings">${t("Open Settings")}</button></span></div>`;
  }

  /* The newest check on screen, whether a Refresh made it or the first check after adding: the header and the rows agree. */
  function lastCheckWords(rows) {
    let newest = null;
    rows.forEach((row) => ENGINES.forEach(([e]) => { const a = row.engines[e]?.main?.age_days; if (a !== null && a !== undefined && (newest === null || a < newest)) newest = a; }));
    const refreshAge = K.data.last_refresh ? (Date.now() - new Date(K.data.last_refresh).getTime()) / 864e5 : null;
    if (refreshAge !== null && (newest === null || refreshAge <= newest + 1 / 1440)) return `${t("Last Refresh")} ${esc(UI.fmtStamp(K.data.last_refresh))}`;
    if (newest === null) return t("No check yet");
    return `${t("Last check")} ${esc(age(newest))}`;
  }

  function page() {
    const title = t("Keywords"), lead = t("Rankings from each engine's own tool and from scraped results");
    const addButton = `<button class="btn" id="kwr-add">${icon("plus")}${t("Add keywords")}</button>`;
    if (K.stale && !K.loading) load();
    if (!K.data) {
      const body = K.error ? UI.failCard(K.error, { title: "Couldn't load the keywords.", retry: 'id="kwr-retry"' }) : UI.skeleton("page", { chart: false, rows: 8 });
      return UI.topbar(title, lead, "", false) + `<div class="content page-enter">${body}</div>`;
    }
    if (!window.BOOT.sites.length && !window.SITES.length) {
      return UI.topbar(title, lead, "", false) + `<div class="content page-enter"><div class="table-wrap"><div class="empty"><h3>${t("Add a site first")}</h3><p>${t("Keywords belong to a site. Add yours, then come back.")}</p><button class="btn btn-main" data-go="settings">${t("Go to Settings")}</button></div></div></div>`;
    }
    const all = allRows();
    if (!all.length) {
      return UI.topbar(title, lead, "", false) + `<div class="content page-enter"><div class="table-wrap"><div class="empty"><h3>${t("No keywords yet")}</h3><p>${t("Add the keywords you want to follow for this site.")}</p><button class="btn btn-main" id="kwr-add">${t("Add keywords")}</button></div></div></div>`;
    }
    const e = engineOf();
    const local = K.data.tiles[e], view = (row) => row.engines[e], good = (row) => (view(row).main?.status === "ok" ? view(row).main.p : null);
    const found = searched(all);
    const counts = { all: found.length, top3: found.filter((r) => good(r) && good(r) <= 3).length, top10: found.filter((r) => good(r) && good(r) <= 10).length, up: found.filter((r) => view(r).change > 0).length, down: found.filter((r) => view(r).change < 0).length, none: found.filter((r) => !good(r)).length, cited: found.filter((r) => r.ai.state === "cited").length, two: found.filter((r) => r.two_pages).length };
    const moved = (() => { // the same rule as the server's tile, on the rows this site shows
      let change = 0, compared = 0;
      all.forEach((r) => { const c = view(r).change, p = good(r); if (c === null || c === undefined || !p) return; compared += 1; const was = p + c; change += (p <= 10 && was > 10 ? 1 : 0) - (was <= 10 && p > 10 ? 1 : 0); });
      return { change, compared };
    })();
    const chips = [["all", "All"], ["top3", "Top 3"], ["top10", "Top 10"], ["up", "Up"], ["down", "Down"], ["none", "Not ranked"], ["cited", "Cited by AI"], ["two", "Same keyword on 2 pages"]];
    const shown = filtered();
    const body = state.view === "bucket" ? bucketView(all) : state.view === "queries" ? queriesView() : `
      <div class="kw-find">${TP.search(KW_PAGES, t("Search keywords"))}</div>
      <div class="chips" role="group" aria-label="${t("Keywords")}">
        ${chips.map(([id, label]) => `<button class="chip" data-filter="${id}" aria-pressed="${state.filter === id}">${t(label)}<b>${num(counts[id])}</b></button>`).join("")}
        <span style="margin-left:auto" class="table-tools">
          <button class="icon-btn" id="density" aria-label="${t(state.dense ? "Comfortable rows" : "Compact rows")}" data-tip="${t(state.dense ? "Comfortable rows" : "Compact rows")}">${icon("rows-3")}</button>
          <button class="icon-btn" id="columns" aria-label="${t("Columns")}" data-tip="${t("Columns")}">${icon("columns-3")}</button>
          <button class="icon-btn kwr-add-small" id="kwr-add-small" aria-label="${t("Add keywords")}" data-tip="${t("Add keywords")}">${icon("plus")}</button>
        </span>
      </div>
      ${state.engine === "duckduckgo" ? `<p class="note">${icon("info")}<span>${t("DuckDuckGo has no tool for site owners, so the app checks its positions by itself every day, oldest first, on free searches only. Refresh and Refresh data check them now.")}</span></p>` : ""}
      ${outOfChecks(all)}
      ${table(shown)}${selectionBar()}`;
    const sub = [K.data.data_through ? `${t("Data through")} ${UI.fmtDateOnly(K.data.data_through)}` : "", lastCheckWords(all)].filter(Boolean).join(" · ");
    const main = `${addButton}<button class="btn ${K.selected.size ? "" : "btn-main"}" id="kwr-refresh" ${mine(K.run) ? "disabled" : ""}>${icon("refresh-cw")}${t("Refresh")}</button>`;
    return UI.topbar(title, sub, main, false) + `
      <div class="content page-enter">
        <section class="tiles" id="kw-tiles">
          ${UI.tile(t("Tracked"), num(all.length), "", { ic: "key-round" })}
          ${UI.tile(t("Ranked"), num(all.filter((r) => good(r)).length), `<span class="ab">${t("of")} ${num(all.length)} · ${esc(name(e))}</span>`, { ic: "list-ordered" })}
          ${UI.tile(`${t("Top 10")} <span class="muted">· ${t("Scraped results")}</span>`, num(all.filter((r) => good(r) && good(r) <= 10).length), moved.compared ? `${moved.change ? UI.delta(moved.change, { noWord: false }) : ""}<span class="ab">${num(moved.compared)} ${t("compared")}</span>` : "", { ic: "target" })}
          ${UI.tile(t("Cited by AI"), num(all.filter((r) => r.ai.state === "cited").length), `<span class="ab">${t("of")} ${num(all.length)}</span>`, { ic: "sparkles" })}
        </section>
        <div class="tabs-row">
          <div class="tabs" role="tablist" aria-label="${t("Engines")}">
            ${[...ENGINES, ["all", t("All engines")]].map(([id, label]) => `<button class="tab" role="tab" data-engine="${id}" aria-selected="${state.engine === id}">${id === "all" ? "" : logo(id, 16)}${label}</button>`).join("")}
          </div>
          <span class="seg" role="group" aria-label="${t("Positions")}">${[["positions", "Positions"], ["bucket", "By bucket"], ["queries", "Queries"]].map(([id, label]) => `<button data-view="${id}" aria-pressed="${state.view === id}">${t(label)}</button>`).join("")}</span>
        </div>
        ${body}
        ${window.LV?.ideasCard ? window.LV.ideasCard() : ""}
      </div>`;
  }

  // ---- add keywords ---------------------------------------------------------------------------
  function addPanel(opener, prefill = "", hostWanted = null, market = {}) {
    const sites = window.BOOT.sites.length ? window.SITES.filter((s) => window.BOOT.sites.some((x) => x.host === s.host)) : window.SITES;
    const picked = hostWanted || UI.siteHostPicked() || sites[0]?.host;
    UI.openPanel(`${UI.panelHead(t("Add keywords"), t("Each new keyword gets one check with a free tool, to see who really ranks. After that, DuckDuckGo is checked by itself every day, and the other engines when you press Refresh."))}
      <form class="panel-body" id="kwr-add-form" novalidate>
        <div id="kwr-add-error" role="alert"></div>
        <label class="field"><span>${t("For which site?")}</span><select class="select" id="kwr-add-site" style="width:100%">${sites.map((s) => `<option value="${esc(s.host)}" ${s.host === picked ? "selected" : ""}>${esc(s.host)}</option>`).join("")}</select></label>
        <label class="field"><span>${t("Keywords, one per line")}</span><textarea class="input" id="kwr-add-text" rows="8" dir="auto" spellcheck="false">${esc(prefill)}</textarea></label>
        <label class="field"><span>${t("Or upload a file")}</span><input class="input" id="kwr-add-file" type="file" accept=".csv,.txt,.tsv"></label>
        <label class="field"><span>${t("Country")}</span><select class="select" id="kwr-add-country" style="width:100%"><option value="">${t("Any country")}</option>${UI.countryOptions((market.country || "").toUpperCase())}</select></label>
        <label class="field"><span>${t("Language")}</span><input class="input" id="kwr-add-language" placeholder="${esc(t("Optional, such as fr"))}" value="${esc(market.language || "")}" autocomplete="off"></label>
        ${market.country || market.language ? `<p class="small muted" style="margin:0">${t("Country and language are the ones this site's keywords use most.")}</p>` : ""}
      </form>
      <div class="panel-foot"><button class="btn btn-main" id="kwr-add-save">${t("Add keywords")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, opener, { key: `kwr-add|${prefill}`, reopen: () => addPanel(opener, prefill, hostWanted, market) });
  }

  async function saveKeywords(button) {
    const text = $("#kwr-add-text").value, file = $("#kwr-add-file").files[0], host = $("#kwr-add-site").value;
    const fail = (message, field) => { UI.setHTML($("#kwr-add-error"), `<p class="error" style="margin:0 0 10px">${icon("octagon-alert")}<span>${esc(t(message))}</span></p>`); field?.focus(); };
    if (!text.trim() && !file) { fail("Put at least one keyword, or choose a file.", $("#kwr-add-text")); return; }
    const site = window.BOOT.sites.find((s) => s.host === host) || (await api("GET", "links/sites")).sites.find((s) => s.host === host);
    if (!site) { fail("Add a site first"); return; }
    button.disabled = true;
    try {
      if (file) {
        const form = new FormData();
        form.append("file", file); form.append("site_id", site.id); form.append("country", $("#kwr-add-country").value); form.append("language", $("#kwr-add-language").value.trim());
        await api("POST", "keywords/upload", undefined, { form });
      } else {
        await api("POST", "keywords/upload", { site_id: site.id, text, country: $("#kwr-add-country").value, language: $("#kwr-add-language").value.trim() });
      }
      UI.forgetPanelForm(); UI.closePanel();
      UI.toast(t("Keywords added"));
      window.dispatchEvent(new CustomEvent("seocc:keywords-added"));
      K.stale = true; load();
      setTimeout(() => { K.stale = true; load(); }, 4000); // the first free checks are running in the background
    } catch (err) { fail(err.message); button.disabled = false; }
  }

  // ---- refresh dialog -------------------------------------------------------------------------
  const refreshBody = () => {
    const r = K.refresh;
    return { keyword_ids: r.ids, engines: [...r.engines], depth: r.depth, mode: r.mode, picked: [...r.picked], include_recent: r.includeRecent, allow_paid: r.paid, paid_cap: r.paid ? r.cap : undefined, site_id: undefined };
  };

  function openRefresh(ids, engines, depth = 10, mode = "auto", picked = []) {
    if (mine(K.run)) { UI.toast(t("A refresh is already running."), { kind: "info" }); return; }
    const unique = [...new Set(ids)];
    K.refresh = { ids: unique, engines: new Set(engines || [state.engine === "all" ? "google" : state.engine]), depth, mode, picked: new Set(picked), includeRecent: false, paid: false, cap: 5, token: token(), asked: 0, preview: null };
    $("#dlg").classList.remove("wide");
    renderRefresh();
    $("#dlg").showModal();
  }

  function renderRefresh() {
    const r = K.refresh;
    const credit = (tool) => (tool.left === null ? t("No credits needed") : `${num(tool.left)} ${t("of")} ${num(tool.of)} ${t("left")} · ${t(tool.refills === "one-time" ? "Never refills" : "Refills monthly")}`);
    const anyPaid = K.tools.some((tool) => tool.paid_on && tool.connected);
    UI.setHTML($("#dlg"), `
      <div class="dlg-head"><h2 id="dlg-title">${t("Refresh keywords")}</h2><button class="icon-btn" data-close-dlg aria-label="${t("Close")}">${icon("x")}</button></div>
      <div class="dlg-body">
        <p style="margin-bottom:12px"><b>${num(r.ids.length)}</b> ${t(r.ids.length === 1 ? "keyword" : "keywords")}</p>
        <fieldset style="border:0;padding:0;margin:0 0 8px"><legend class="small sec" style="padding:0;margin-bottom:6px;font-weight:500">${t("Engines")}</legend>
          ${ENGINES.map(([id, label]) => `<label class="opt engine-opt"><input type="checkbox" class="chk" style="margin:0" data-kwr-engine="${id}" ${r.engines.has(id) ? "checked" : ""}>${logo(id, 16)}${label}</label>`).join("")}
        </fieldset>
        <label class="field" style="margin-bottom:6px"><span>${t("Depth")}</span><select class="select" id="kwr-depth">${[10, 20, 30, 50].map((d) => `<option value="${d}" ${r.depth === d ? "selected" : ""}>${t("Top")} ${d}</option>`).join("")}</select></label>
        <div class="ref-tools-head"><span>${t("Tools")}</span><span class="seg" role="group" aria-label="${t("Tools")}"><button type="button" data-kwr-mode="auto" aria-pressed="${r.mode === "auto"}">${t("Automatic: free first")}</button><button type="button" data-kwr-mode="pick" aria-pressed="${r.mode === "pick"}">${t("Choose tools")}</button></span></div>
        <div class="tool-list ${r.mode === "auto" ? "auto" : ""}" id="kwr-tool-list">
          ${orderedTools().map((tool) => `<label class="tool-row" data-kwr-tool-row="${esc(tool.name)}">
            <input type="checkbox" class="chk" style="margin:0" data-kwr-tool="${esc(tool.name)}" ${r.picked.has(tool.name) ? "checked" : ""}>
            ${logo(tool.name, 22)}
            <span class="tool-main"><span class="t">${esc(t(tool.name))}</span><span class="d">${esc(credit(tool))}${tool.price ? ` · ${t("then")} ${esc(t(tool.price))}` : ""}</span></span>
            <span class="tool-engines" role="img" aria-label="${esc(tool.engines.map(name).join(", "))}" data-tip="${esc(tool.engines.map(name).join(", "))}">${tool.engines.map((e) => logo(e, 14)).join("")}</span>
            <span class="tool-checks"></span></label>`).join("")}
        </div>
        ${anyPaid ? `<div class="paid-row"><label class="opt"><input type="checkbox" class="chk" style="margin:0" id="kwr-paid" ${r.paid ? "checked" : ""}>${t("Use paid credits if free ones run out")}</label>
          <label class="paid-cap" id="kwr-paid-cap" ${r.paid ? "" : "hidden"}>${t("Limit this run to")} $<input class="input" id="kwr-cap" type="number" min="1" step="1" value="${r.cap}"></label></div>` : ""}
        <div id="kwr-summary" aria-live="polite"></div>
      </div>
      <div class="dlg-foot"><span class="left" id="kwr-foot">${t(anyPaid && r.paid ? "Estimated cost" : "Free tools first. Paid use is off.")}</span><button class="btn" data-close-dlg>${t("Cancel")}</button><button class="btn btn-main" id="kwr-confirm" disabled>${t("Confirm")}</button></div>`);
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
      UI.setHTML(box, `<p class="note" style="margin:10px 0 0">${icon("info")}<span>${t(!r.engines.size ? "Choose at least one engine." : "Pick at least one tool.")}</span></p>`);
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
    if (answer.no_tools_for.length) notes.push(`<p class="note warn" style="margin:10px 0 0">${icon("triangle-alert")}<span>${t("No tool can search")} ${esc(answer.no_tools_for.map(name).join(", "))}. ${t("Connect one in Settings.")}</span></p>`);
    if (answer.runs_out_after !== null) notes.push(`<p class="note warn" style="margin:10px 0 0">${icon("triangle-alert")}<span>${t("Runs out after")} ${plural(answer.runs_out_after, "check", "checks")}.</span></p>`);
    if (answer.running.length) notes.push(`<p class="note" style="margin:10px 0 0">${icon("info")}<span>${t("Already being refreshed:")} ${esc(answer.running.slice(0, 5).map((x) => `${x.keyword}${x.by ? ` (${x.by === AUTO_BY ? t("automatic check") : `${t("by")} ${x.by}`})` : ""}`).join(", "))}${answer.running.length > 5 ? ` +${answer.running.length - 5}` : ""}</span></p>`);
    if (answer.recent.length || r.includeRecent) notes.push(`<div style="margin:10px 0 0">${answer.recent.length ? `<p class="small sec" style="margin:0 0 4px" dir="auto">${t("Checked in the last")} ${num(answer.just_checked_hours)} ${t("hours, so left out:")} ${esc(answer.recent.slice(0, 5).map((x) => x.keyword).join(", "))}${answer.recent.length > 5 ? ` +${answer.recent.length - 5}` : ""}</p>` : ""}<label class="opt small"><input type="checkbox" class="chk" style="margin:0" id="kwr-recent" ${r.includeRecent ? "checked" : ""}>${t("Check them again")}</label></div>`);
    if (r.mode === "pick" && r.picked.has("Browser on this Mac")) notes.push(`<p class="note" style="margin:10px 0 0">${icon("info")}<span>${t("A real browser on this Mac reads the results. It stops at the first captcha that doesn't clear.")}</span></p>`);
    const sum = answer.checks ? `<p class="small sec" style="margin:0">${t("This will use")} <b>${plural(answer.credits, "credit", "credits")}</b> ${t("over")} ${plural(answer.checks, "check", "checks")}.${answer.cost ? ` <b>${t("Estimated cost")}: $${dec(Number(answer.cost.toFixed(2)))}</b>` : ""}</p>` : `<p class="small sec" style="margin:0">${t("Nothing to check.")}</p>`;
    const hadFocus = document.activeElement?.id === "kwr-recent";
    UI.setHTML(box, sum + notes.join(""));
    if (hadFocus) $("#kwr-recent")?.focus(); // the summary is redrawn, and the keyboard stays where it was
    confirm.disabled = !answer.checks;
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
      const words = !tool.connected ? (tool.manual_only ? "" : `<button type="button" class="link-btn" data-kwr-connect="${esc(tool.name)}">${t("Connect")}</button>`)
        : !fits ? `<span class="quiet">${t("Not for these engines")}</span>`
        : !pick && tool.manual_only ? `<span class="quiet">${t("Only when you pick it")}</span>`
        : checks ? `${num(checks)} ${t(checks === 1 ? "check" : "checks")}${planned.paid_credits ? ` · ${num(planned.paid_credits)} ${t("paid")}` : ""}` : "";
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
    K.refresh = null;
    K.selected.clear();
    if (run.excluded?.length) UI.toast(`${t("Already being refreshed:")} ${run.excluded.slice(0, 3).map((x) => `${x.keyword}${x.by ? ` (${x.by === AUTO_BY ? t("automatic check") : x.by})` : ""}`).join(", ")}`, { kind: "info" });
    follow(run);
    if (state.route === "keywords") UI.render({ keepScroll: true });
  }

  // ---- tray -----------------------------------------------------------------------------------
  function follow(run) {
    K.run = run;
    UI.setHTML($("#tray-root"), `<div class="tray" id="tray" role="status">
      <div class="top">${icon("refresh-cw", "spin")}<span id="tray-title">${t("Refreshing")}</span><span class="end tabular" id="tray-count"></span></div>
      <div class="bar"><i id="tray-bar"></i></div>
      <div class="msg" id="tray-msg"></div>
      <div id="tray-actions" style="margin-top:8px"><button class="btn btn-small" id="kwr-stop">${t("Stop")}</button></div></div>`);
    paintTray(run);
    startPoll();
  }
  function paintTray(run) {
    const count = $("#tray-count"), done = run.done + run.failed + run.not_run;
    if (!count) return;
    count.textContent = `${num(done)} / ${num(run.total)}`;
    $("#tray-bar").style.setProperty("--p", run.total ? done / run.total : 0);
    const bits = [];
    if (run.moved) bits.push(`${t(run.moved.from)} ${t("out of credits, continuing with")} ${t(run.moved.to)}`);
    if (run.by && run.by !== window.ME?.name) bits.push(run.by === AUTO_BY ? t("Automatic DuckDuckGo check") : `${t("started by")} ${run.by}`);
    $("#tray-msg").textContent = bits.join(" · ");
  }
  /* Followed with the app's one poller (COMP.poll in competitors.js): it pauses while the tab is hidden, waits longer after
     each failure, respects a 429 cool-down, and stops on 404 or 401 or after 6 failures in a row (F21). */
  function startPoll() {
    K.poll?.stop?.();
    if (!K.run) return;
    const id = K.run.id;
    K.poll = window.COMP.poll(async () => {
      if (!K.run || K.run.id !== id) return false;
      const run = await api("GET", `refresh/runs/${id}`);
      K.run = run;
      paintTray(run);
      if (run.status === "queued" || run.status === "running") return true;
      finishTray(run);
      return false;
    }, { every: 1000, grow: 1.15, slowest: 15000, errors: 6, onEnd: (why, err) => { if ((why === "gone" || why === "errors" || why === "ceiling") && K.run?.id === id) lostTray(why === "errors" ? err?.message || "" : ""); } });
  }
  function lostTray(message) {
    K.run = null; K.poll?.stop?.();
    const tray = $("#tray");
    if (!tray) return;
    UI.setHTML(tray.querySelector(".top"), `${icon("triangle-alert", "warn")}<span>${esc(t("Lost track of this Refresh"))}</span>`);
    $("#tray-msg").textContent = message ? `${t(message)} ${t("Whatever was checked is saved. Reload the page to see it.")}` : t("Whatever was checked is saved. Reload the page to see it.");
    UI.setHTML(tray.querySelector("#tray-actions"), `<button class="btn btn-small" id="kwr-tray-close">${t("Close")}</button>`);
  }
  function finishTray(run) {
    K.run = null;
    const saved = `${num(run.done)} ${t("saved")}${run.failed ? ` · ${num(run.failed)} ${t("failed")}` : ""}`;
    const title = run.status === "cancelled" ? `${t("Stopped")} · ${saved}` : run.status === "stopped" ? `${t(/No free tools left/.test(run.stop_reason || "") ? "Stopped: no free tools left" : "Stopped")} · ${saved}` : `${t("Finished")} · ${saved}`;
    const tray = $("#tray");
    if (tray) {
      UI.setHTML(tray.querySelector(".top"), `${run.status === "done" && !run.failed ? icon("circle-check", "good") : icon("triangle-alert", "warn")}<span>${esc(title)}</span>`);
      UI.setHTML(tray.querySelector("#tray-actions"), run.status === "stopped" ? `<button class="btn btn-small" id="kwr-tray-close">${t("Close")}</button>` : "");
      const why = run.stop_reason ? translateSentences(run.stop_reason) : "";
      if (why) $("#tray-msg").textContent = why;
      // Which searches failed and why, with a Retry for those only. The run lists them in `failures` (keyword, engine, error).
      const fails = Array.isArray(run.failures) ? run.failures : [];
      if (run.failed && fails.length) {
        UI.setHTML($("#tray-msg"), `${why ? `<p style="margin:0 0 4px">${esc(why)}</p>` : ""}<ul class="tray-fails">${fails.slice(0, 20).map((f) => `<li><b dir="auto">${esc(f.keyword || "")}</b> <span class="muted">· ${esc(name(f.engine))}${f.tool ? ` · ${esc(t(f.tool))}` : ""}</span><span class="why">${esc(UI.errorWords(translateSentences(f.error || "")))}${f.timed_out ? ` ${esc(t("It may have been charged, so a Retry spends again."))}` : ""}</span></li>`).join("")}</ul>${run.spent ? `<p class="small muted" style="margin:6px 0 0">${t("Only the searches that worked were charged.")}</p>` : ""}`);
        const ids = [...new Set(fails.map((f) => f.keyword_id).filter(Boolean))], engines = [...new Set(fails.map((f) => f.engine).filter(Boolean))];
        UI.setHTML(tray.querySelector("#tray-actions"), `${ids.length ? `<button class="btn btn-small btn-main" id="kwr-tray-retry" data-ids="${ids.join(",")}" data-engines="${esc(engines.join(","))}">${t("Retry these")} (${num(ids.length)})</button> ` : ""}<button class="btn btn-small" id="kwr-tray-close">${t("Close")}</button>`);
      } else if (run.failed) {
        // Older answers have no list: say so plainly, and keep the tray until it's closed.
        $("#tray-msg").textContent = `${why ? `${why} ` : ""}${t("The keyword's own panel shows each failed check.")}`;
        UI.setHTML(tray.querySelector("#tray-actions"), `<button class="btn btn-small" id="kwr-tray-close">${t("Close")}</button>`);
      }
      if (run.status !== "stopped" && !run.failed) {
        setTimeout(() => tray.classList.add("pill"), 5000);
        setTimeout(() => { if ($("#tray") === tray) $("#tray-root").replaceChildren(); }, 9000);
      }
    }
    K.stale = true; K.queries = {};
    load().then(() => { if (K.panel) loadPanel(K.panel); });
  }
  // A server sentence is English: each one is translated if it's known, and stays readable if it isn't.
  const translateSentences = (text) => text.split(/(?<=\.)\s+/).map((part) => t(part)).join(" ");

  // ---- side panel -----------------------------------------------------------------------------
  const rowById = (id) => K.data?.rows.find((row) => row.id === id);
  async function openKeyword(id, opener) {
    const row = rowById(id);
    if (!row) return;
    const e = engineOf();
    K.panel = { id, siteId: row.site_id, keywordId: row.keyword_id, engine: e, table: false, line: null };
    $$("tr.open").forEach((tr) => tr.classList.remove("open"));
    $$("#kw-table tbody tr").find((tr) => tr.dataset.kwrRow === id)?.classList.add("open");
    UI.openPanel(`${UI.panelHead(row.keyword, `${esc(name(e))}`)}<div class="panel-body">${UI.skeleton ? UI.skeleton("panel") : `<p class="muted">${t("Loading…")}</p>`}</div>`, opener);
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
    if (known.length < 2) return `<p class="note">${icon("info")}<span>${t("Needs 2 checks with the same tool")}</span></p>`;
    const w = 440, h = 160, left = 26, right = 8, top = 10, bottom = 28;
    const hi = Math.max(...known) + 1;
    const x = (i) => left + (points.length === 1 ? 0 : (i / (points.length - 1)) * (w - left - right));
    const y = (v) => top + ((v - 1) / Math.max(1, hi - 1)) * (h - top - bottom);
    const ticks = [...new Set([1, Math.round((hi + 1) / 2), hi])];
    // A check beyond the depth leaves a gap, never a line down to a made-up number. A suspect result is a hollow dot on no line.
    let path = "", pen = false;
    points.forEach((p, i) => { if (!p.p || p.suspect) { pen = false; return; } path += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.p).toFixed(1)}`; pen = true; });
    const dateOf = (p) => UI.fmtDateOnly(p.at.slice(0, 10));
    const dots = points.map((p, i) => (p.p ? `<circle cx="${x(i).toFixed(1)}" cy="${y(p.p).toFixed(1)}" r="4" fill="${p.suspect ? "var(--panel-solid)" : "var(--series-1)"}" stroke="${p.suspect ? "var(--series-1)" : "var(--panel-solid)"}" stroke-width="2" data-tip="${esc(dateOf(p))}: #${p.p}${p.suspect ? ` · ${esc(t("Suspect result"))}` : ""}" tabindex="0"/>` : "")).join("");
    const edges = [0, points.length - 1];
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${t("Position over time")}: ${esc(points.map((p) => `${dateOf(p)} ${p.p ? `#${p.p}` : `>${line.depth}`}`).join(", "))}">
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
    const statusOf = (x) => (x.verdict === "suspect" || x.status === "suspect" ? status("warn", t("Suspect result")) : x.verdict === "unverifiable" ? `<span class="small sec" data-tip="${esc(t("No earlier check with this tool, and nothing from the engine's own tool to compare with."))}" tabindex="0">${t("Unverified")}</span>` : status("good", t("OK")));
    const toolRows = listed.map((tool) => {
      const x = latest[tool.name];
      const low = tool.left !== null && tool.left < 10;
      const canRun = tool.connected && tool.engines.includes(e);
      const empty = tool.left !== null && tool.left < Math.max(1, tool.credits_per_search) && !tool.paid_on;
      const elsewhere = !x && view.away.find((a) => a.tool === tool.name);
      const button = !canRun ? `<span class="small muted">${t("Not connected")}</span>` : `<button class="btn btn-small" data-kwr-check="${esc(tool.name)}" data-low="${low ? tool.left : ""}" ${mine(K.run) || empty ? "disabled" : ""} ${empty ? `data-tip="${esc(t("No free checks left on this tool."))}"` : ""}>${t("Refresh")}</button>${tool.left === null ? "" : `<span class="second">${num(tool.left)} ${t("left")}</span>`}`;
      return `<tr><td class="nowrap">${logo(tool.name, 16)} ${esc(t(tool.name))}</td><td>${x ? posBadge(x) : '<span class="muted">—</span>'}</td><td class="sec small nowrap">${x ? age(x.age_days) : elsewhere ? age(elsewhere.age_days) : t("never")}</td><td>${x ? statusOf(x) : elsewhere ? `<span class="small sec">${t("Another location")}</span>` : ""}</td><td class="r">${button}</td></tr>`;
    }).join("");
    const suspects = view.suspects.map((x) => `<tr><td class="nowrap">${logo(x.tool, 16)} ${esc(t(x.tool))}</td><td>${posBadge(x)}</td><td class="sec small nowrap">${age(x.age_days)}</td><td>${status("warn", t("Suspect result"))}</td><td></td></tr>`).join("");
    const away = view.away.length
      ? `<table class="mini"><tbody>${view.away.map((x) => `<tr><td>${esc(t(x.tool))} · ${esc(UI.countryName(x.location) || x.location || "?")}</td><td>${posBadge(x)}</td><td class="sec small nowrap">${age(x.age_days)}</td><td class="sec small">${t("Not compared with")} ${esc(place)}</td></tr>`).join("")}</tbody></table>`
      : `<p class="small muted">${t("None yet")}</p>`;
    const lines = detail.lines;
    const wanted = info.line || (view.main ? lineKey(view.main) : lines[0] ? lineKey(lines[0]) : null);
    const shownLine = lines.find((x) => lineKey(x) === wanted) || lines[0];
    const picker = lines.length > 1 ? `<select class="select" id="kwr-line" aria-label="${t("Tool")}" style="margin-bottom:6px;width:100%">${lines.map((x) => `<option value="${esc(lineKey(x))}" ${x === shownLine ? "selected" : ""}>${esc(t(x.tool))} · ${esc(UI.countryName(x.location) || x.location || "?")} · ${t("Top")} ${x.depth}</option>`).join("")}</select>` : "";
    const history = !shownLine ? `<p class="small muted">${t("None yet")}</p>` : info.table
      ? `<table class="mini"><thead><tr><th>${t("Date")}</th><th>${t("Position")}</th><th>${t("Status")}</th></tr></thead><tbody>${shownLine.points.map((p) => `<tr><td>${esc(UI.fmtDateOnly(p.at.slice(0, 10)))}</td><td>${p.p ? `#${p.p}` : `&gt;${shownLine.depth}`}</td><td>${p.suspect ? status("warn", t("Suspect result")) : status("good", t("OK"))}</td></tr>`).join("")}</tbody></table>`
      : chart(shownLine);
    const hasSuspect = shownLine?.points.some((p) => p.suspect);
    const competitors = detail.competitors.length
      ? `<table class="mini"><thead><tr><th scope="col">${t("Position")}</th><th scope="col">${t("Site")}</th><th scope="col" class="r">${t("Change")}</th></tr></thead><tbody>${detail.competitors.slice(0, 20).map((c) => `<tr><td class="pos" style="width:40px">#${c.position}</td><td class="mono small" dir="auto">${c.mine ? `<b>${esc(c.host)}</b> <span class="who who-you"><i class="pt-key pt-key-you" aria-hidden="true"></i><span>${t("You")}</span></span>` : esc(c.host)}${c.rival ? ` <span class="who who-them"><i class="pt-key pt-key-them" aria-hidden="true"></i><span>${t("Competitor")}</span></span>` : ""}</td><td class="r">${c.change ? `<span class="chg ${c.change > 0 ? "good" : "crit"}">${icon(c.change > 0 ? "arrow-up" : "arrow-down")}${Math.abs(c.change)}</span>` : '<span class="muted">—</span>'}</td></tr>`).join("")}</tbody></table>`
      : `<p class="small muted">${t("None yet")}</p>`;
    const checks = detail.checks.length
      ? `<table class="mini"><thead><tr><th>${t("Date")}</th><th>${t("Tool")}</th><th>${t("Position")}</th><th>${t("Status")}</th></tr></thead><tbody>${detail.checks.slice(0, 30).map((c) => `<tr><td class="nowrap small">${esc(UI.fmtDateOnly(c.checked_at.slice(0, 10)))}</td><td class="small">${esc(t(c.tool))}<span class="second">${esc(c.location || "—")} · ${t("Top")} ${c.depth}</span></td><td>${c.status === "failed" ? "—" : c.p ? `#${c.p}` : `&gt;${c.depth}`}</td><td>${c.status === "failed" ? `<span class="crit small" data-tip="${esc(c.error || "")}" tabindex="0">${t("Failed")}</span>` : c.status === "suspect" ? status("warn", t("Suspect result")) : status("good", t("OK"))}</td></tr>`).join("")}</tbody></table>`
      : `<p class="small muted">${t("Not checked yet")}</p>`;
    const own = OWN_TOOL[e];
    const task = UI.taskButton ? UI.taskButton(findOf(row, e, view), { cls: "btn" }) : "";
    const scroll = $(".panel-body", $("#panel"))?.scrollTop || 0;
    UI.setHTML($("#panel"), `${UI.panelHead(row.keyword, `${esc(name(e))} · ${esc(place)} · Desktop`)}
      <div class="panel-body">
        <div class="kv">
          ${own ? `<div><div class="k">${esc(own)}</div><div class="v">${view.own === null || view.own === undefined ? '<span class="muted">—</span>' : `${dec(Math.round(view.own * 10) / 10)} <span class="small muted" style="font-weight:400">${t("average")}</span>`}</div></div>` : ""}
          <div><div class="k">${t("Page")}</div><div class="mono small" style="margin-top:6px;overflow-wrap:anywhere" dir="auto">${esc(row.page || "—")}</div></div>
        </div>
        <h3>${t("Results")} · ${esc(place)}</h3>
        <table class="mini" id="tool-table"><thead><tr><th>${t("Tool")}</th><th>${t("Position")}</th><th>${t("Checked")}</th><th>${t("Status")}</th><th><span class="sr">${t("Action")}</span></th></tr></thead><tbody>${toolRows}${suspects}</tbody></table>
        ${view.main && !view.main.p ? `<p style="margin-top:8px"><button class="link-btn" data-kwr-deeper="${esc(row.id)}" data-engine-id="${e}">${t("Check deeper")}</button></p>` : ""}
        <h3>${t("Other locations")}</h3>
        ${away}
        <h3>${t("Position over time")} ${shownLine ? `<button class="link-btn end" id="kwr-chart-toggle">${t(info.table ? "Chart view" : "Table view")}</button>` : ""}</h3>
        <p class="small muted" style="margin-bottom:6px">${t("1 at the top; each dot is one real check")}${hasSuspect ? ` ${t("Hollow dots are suspect results, left out of Change.")}` : ""}</p>
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
    const title = c && p ? `${row.keyword} ${t(c < 0 ? "fell" : "rose")} #${p + c} → #${p} ${t("on")} ${engine}` : p ? `${row.keyword} ${t("is at")} #${p} ${t("on")} ${engine}` : `${row.keyword}: ${t("not in the results checked on")} ${engine}`;
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
      follow(run);
    } catch (err) {
      button.disabled = false;
      if (!again && /Checked recently/.test(err.message || "")) {
        button.dataset.recent = "1";
        button.textContent = t("Check again? 1 credit");
        UI.toast(t(err.message), { kind: "info" });
        return;
      }
      UI.toast(t(err.message), { kind: "crit" });
      button.textContent = t("Refresh");
    }
  }

  async function forget() {
    const info = K.panel, row = rowById(info.id);
    if (!window.confirm(t("Stop tracking this keyword on this site? Its past checks stay."))) return;
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
      if (!tool.paid_per) return error + (tool.auth === "key" || tool.auth === "key+zone" ? `<p class="help" style="margin:0 0 12px">${t("No pay-as-you-go price, so paid use can't be switched on.")}</p>` : "");
      return `${error}<label class="opt" style="margin:0 0 4px"><input type="checkbox" class="chk" style="margin:0" id="kwr-paid-on" data-tool="${esc(tool.name)}" ${tool.paid_on ? "checked" : ""}>${t("Allow paid use")}</label><p class="help" style="margin:0 0 12px">${t("Off until you switch it on. Refresh still uses free credits first, and each run asks for its own limit.")}</p>`;
    },
    /* The order is per engine, so the list says which engine it's showing. */
    orderPicker: () => `<span class="seg" role="group" aria-label="${t("Order for")}" style="margin-left:auto">${ENGINES.map(([id, label]) => `<button type="button" data-kwr-order="${id}" aria-pressed="${K.orderEngine === id}">${label}</button>`).join("")}</span>${K.aiFirst?.[K.orderEngine]?.length && K.aiFirstWhy ? `<p class="small sec kwr-ai-first" style="flex-basis:100%;margin:6px 0 0">${icon("sparkles")} ${esc(t(K.aiFirstWhy))}</p>` : ""}`,
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
      UI.setHTML(box, answer.ok === true ? status("good", `${t(answer.message)}${answer.searches_left === null || answer.searches_left === undefined ? "" : ` ${num(answer.searches_left)} ${t("left")}`}`) : answer.ok === false ? `<span class="error" style="margin:0">${icon("octagon-alert")}${esc(t(answer.message))}</span>${fixFor(c, answer.message)}` : `<span class="note inline-note">${icon("info")}<span>${esc(t(answer.message))}</span></span>`);
    } catch (err) { UI.setHTML(box, `<span class="error" style="margin:0">${icon("octagon-alert")}${esc(t(err.message))}</span>${fixFor(c, err.message)}`); }
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
      if (hit("[data-kwr-search-clear]")) { kwPages().q = ""; TP.reset(KW_PAGES); UI.render({ keepScroll: true }); $(`[data-tp-search][data-tp-key="${KW_PAGES}"]`)?.focus(); return; }
      if (hit("[data-kwq-search-clear]")) { TP.state(Q_PAGES).q = ""; TP.reset(Q_PAGES); UI.render({ keepScroll: true }); $(`[data-tp-search][data-tp-key="${Q_PAGES}"]`)?.focus(); return; }
      if ((el = hit("[data-kwq-sort]"))) {
        const id = el.dataset.kwqSort, first = Q_SORTS[id].first;
        K.qsort = K.qsort?.id !== id ? { id, dir: first } : K.qsort.dir === first ? { id, dir: first === "asc" ? "desc" : "asc" } : null;
        TP.reset(Q_PAGES); UI.render({ keepScroll: true }); $(`[data-kwq-sort="${id}"]`)?.focus({ preventScroll: true });
        return;
      }
      if (hit("#kwr-refresh")) { openRefresh(K.selected.size ? idsOfSelected() : filtered().map((row) => row.keyword_id)); return; }
      if (hit("#kwr-sel-refresh")) { openRefresh(idsOfSelected()); return; }
      if (hit("#kwr-sel-clear")) { K.selected.clear(); UI.render({ keepScroll: true }); return; }
      if (hit("#kwr-sel-task")) {
        const picked = [...K.selected].map(rowById).filter(Boolean);
        UI.openTask({ title: `${t("Keywords")}: ${picked.slice(0, 3).map((r) => r.keyword).join(", ")}${picked.length > 3 ? ` +${picked.length - 3}` : ""}`, opener: hit("#kwr-sel-task"), source: { type: "keyword", label: `${num(picked.length)} ${t("keywords")}`, facts: picked.slice(0, 10).map((r) => r.keyword), link: "#keywords" } });
        return;
      }
      if (hit("#kwr-add, #kwr-add-small")) { addPanel(hit("#kwr-add, #kwr-add-small")); return; }
      if ((el = hit("#kwr-add-save"))) { saveKeywords(el); return; }
      if ((el = hit("[data-kwr-follow]"))) { addPanel(el, el.dataset.kwrFollow, el.dataset.siteHost); return; }
      if ((el = hit("[data-kwr-open]"))) { openKeyword(el.dataset.kwrOpen, el); return; }
      if ((el = hit("[data-kwr-deeper]"))) {
        const row = rowById(el.dataset.kwrDeeper), now = row.engines[el.dataset.engineId].main?.depth || 10, next = [20, 30, 50].find((d) => d > now) || 50;
        openRefresh([row.keyword_id], [el.dataset.engineId], next);
        return;
      }
      if ((el = hit("[data-kwr-check]"))) { recheck(el); return; }
      if (hit("#kwr-forget")) { forget(); return; }
      if (hit("#kwr-chart-toggle")) { K.panel.table = !K.panel.table; paintPanel(K.panel); $("#kwr-chart-toggle")?.focus(); return; }
      if (hit("#kwr-stop")) { const b = hit("#kwr-stop"); b.disabled = true; b.textContent = t("Stopping…"); if (K.run) api("POST", `refresh/runs/${K.run.id}/cancel`).catch(() => {}); return; }
      if (hit("#kwr-tray-close")) { $("#tray-root").replaceChildren(); return; }
      if ((el = hit("#kwr-tray-retry"))) { const ids = el.dataset.ids.split(",").map(Number).filter(Boolean), engines = el.dataset.engines.split(",").filter(Boolean); $("#tray-root").replaceChildren(); openRefresh(ids, engines.length ? engines : undefined); return; }
      if ((el = hit("[data-kwr-mode]"))) { K.refresh.mode = el.dataset.kwrMode; $$("[data-kwr-mode]").forEach((b) => b.setAttribute("aria-pressed", b === el)); updatePreview(); return; }
      if ((el = hit("[data-kwr-connect]"))) { const id = CONN_ID[el.dataset.kwrConnect]; $("#dlg").close(); K.refresh = null; UI.openConnection(id); return; }
      if (hit("#kwr-confirm") && !hit("#kwr-confirm").disabled) { confirmRefresh(hit("#kwr-confirm")); return; }
    });

    document.addEventListener("change", (e) => {
      const el = e.target;
      if (el.matches?.("[data-kwr-select]")) { if (el.checked) K.selected.add(el.dataset.kwrSelect); else K.selected.delete(el.dataset.kwrSelect); const id = el.dataset.kwrSelect; UI.render({ keepScroll: true }); $$("[data-kwr-select]").find((x) => x.dataset.kwrSelect === id)?.focus(); return; }
      if (el.id === "kwr-select-all") { TP.view(KW_PAGES, filtered()).rows.forEach((row) => { /* the rows on this page only */ if (el.checked) K.selected.add(row.id); else K.selected.delete(row.id); }); UI.render({ keepScroll: true }); $("#kwr-select-all")?.focus(); return; }
      if (el.matches?.("[data-kwr-engine]")) { if (el.checked) K.refresh.engines.add(el.dataset.kwrEngine); else K.refresh.engines.delete(el.dataset.kwrEngine); updatePreview(); return; }
      if (el.id === "kwr-depth") { K.refresh.depth = Number(el.value); updatePreview(); return; }
      if (el.matches?.("[data-kwr-tool]")) { if (el.checked) K.refresh.picked.add(el.dataset.kwrTool); else K.refresh.picked.delete(el.dataset.kwrTool); updatePreview(); return; }
      if (el.id === "kwr-recent") { K.refresh.includeRecent = el.checked; updatePreview(); return; }
      if (el.id === "kwr-paid") { K.refresh.paid = el.checked; $("#kwr-paid-cap").hidden = !el.checked; updatePreview(); return; }
      if (el.id === "kwr-cap") { K.refresh.cap = Number(el.value) || 0; updatePreview(); return; }
      if (el.id === "kwr-line") { K.panel.line = el.value; paintPanel(K.panel); $("#kwr-line")?.focus(); return; }
      if (el.id === "kwr-paid-on") {
        const tool = el.dataset.tool;
        api("PUT", `tools/${encodeURIComponent(tool)}/paid`, { on: el.checked }).then(loadTools).catch((err) => { el.checked = !el.checked; UI.toast(t(err.message), { kind: "crit" }); });
      }
    });
    document.addEventListener("close", (e) => { if (e.target.id === "dlg") K.refresh = null; }, true);
  }
  const idsOfSelected = () => [...new Set([...K.selected].map((id) => rowById(id)?.keyword_id).filter(Boolean))];

  window.KW_REAL.seen = () => filtered().map((row) => row.id); // export.js: the rows on screen, in their order
  window.SCREENS = window.SCREENS || {};
  window.SCREENS.keywords = {
    init(helpers) {
      UI = helpers;
      ({ t, esc, icon, num, dec, status, logo, $, $$, state } = helpers);
      bind();
      // Another page, another size or a search draws the screen again; the helper puts the focus back where it was.
      TP.on(KW_PAGES, () => UI.render({ keepScroll: true }));
      TP.on(Q_PAGES, () => UI.render({ keepScroll: true }));
      if (state.route === "keywords" || state.route === "settings") load(); // otherwise when Keywords, Settings or ⌘K first needs it (F17)
      // A Refresh started before a reload, or by a colleague, still shows.
      api("GET", "refresh/runs").then((answer) => { if (answer.runs[0] && !K.run) follow(answer.runs[0]); }).catch(() => {});
    },
    page,
    after() {
      if (K.stale && !K.loading) load();
      openWanted();
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
      const found = K.data.rows.find((r) => (w.keywordId ? r.keyword_id === w.keywordId : r.keyword.toLowerCase() === w.keyword) && (!w.host || r.site === w.host));
      K.wantKeyword = null;
      if (found) {
        K.wantOpen = found.id; kwPages().q = "";
        if (!filtered().some((r) => r.id === found.id)) state.filter = "all"; // a chip that hides it is lifted
        kwPages().page = Math.max(0, Math.floor(filtered().findIndex((r) => r.id === found.id) / kwPages().per));
      }
    }
    if (!K.wantOpen || !K.data || state.route !== "keywords") return;
    const id = K.wantOpen;
    K.wantOpen = null;
    if (rowById(id) && !$("#panel")) setTimeout(() => openKeyword(id), 0);
  }
  window.addEventListener("seocc:site-added", () => { K.stale = true; });
  // Keywords added elsewhere (Competitors → Keyword check → Add to my keywords) show here without a reload.
  document.addEventListener("keywords:changed", () => { K.stale = true; K.queries = {}; if (state.route === "keywords" && !K.loading) load(); });
  /* Other screens track a query through the same panel, so there's one way to add a keyword. queries: one or many. */
  window.KW = {
    track: (queries, host, opener, market) => addPanel(opener, [].concat(queries).join("\n"), host, market || {}),
    /* Open one keyword's panel from anywhere: Keywords opens on its site, and the panel opens once the rows are in. */
    open({ keywordId = null, keyword = "", host = null } = {}) {
      if (host) UI.pickSite(host);
      K.wantKeyword = { keywordId, keyword: String(keyword || "").toLowerCase(), host };
      if (state.route !== "keywords") UI.go("keywords"); else openWanted();
      if (K.stale && !K.loading) load(); else openWanted();
    },
  };
})();
