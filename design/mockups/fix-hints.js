/* What to do about an error. Each tool's own sentence stays as it is; this reads it and adds a short "How to fix it"
   list under it: the page to open, the button to press, and how to see that it worked. Used by the Connections panel,
   its Test button, and the data cards that say a source stopped working. */
(function () {
  // Google names its APIs in its errors. These are the pages that turn each one on.
  const GOOGLE_APIS = [
    [/analytics ?data api/i, "Google Analytics Data API", "analyticsdata.googleapis.com"],
    [/analytics ?admin api/i, "Google Analytics Admin API", "analyticsadmin.googleapis.com"],
    [/search console api|webmasters/i, "Google Search Console API", "searchconsole.googleapis.com"],
    [/pagespeed/i, "PageSpeed Insights API", "pagespeedonline.googleapis.com"],
  ];
  // Things only one tool does. Keyed by the connection id.
  const EXTRA = {
    openpagerank: "Old DomCop Open PageRank keys no longer work. Make a new one on the Open Page Rank tab of your Keywords Everywhere account.",
    cloudflare: "The token needs Account → Radar → Read. Zone or DNS tokens are refused.",
    yandex: "A Yandex token lasts about 6 months; then redo step 4 of How to connect.",
  };

  const has = (re, text) => re.test(text || "");

  function googleApi(message) {
    const named = GOOGLE_APIS.find(([re]) => re.test(message));
    const project = (message.match(/project (\d+)/) || [])[1] || "";
    if (named) return { name: named[1], url: `https://console.cloud.google.com/apis/library/${named[2]}${project ? `?project=${project}` : ""}`, project };
    // A name we don't know: Google's own link, but only to Google's console.
    const link = (message.match(/https:\/\/console\.(?:developers|cloud)\.google\.com\/[^\s"'<>]+/) || [])[0];
    return { name: "API", url: link ? link.replace(/[.,;)]+$/, "") : "https://console.cloud.google.com/apis/library", project };
  }

  /* ctx: { tool, id, keyUrl, refills, retry: "test" | "refresh", robot } → { summary, steps: [{ text, url, link }] } */
  function explain(message, ctx = {}) {
    const m = String(message || "");
    const tool = ctx.tool || "This tool";
    const retry = ctx.retry === "refresh" ? "Then press Refresh data here; numbers return with the next pull." : "Then press Test. It should say Works.";
    const keyStep = { text: `Open ${tool}'s key page and check the key is still there and active.`, url: ctx.keyUrl, link: "Key page" };

    if (has(/has not been used in project|is disabled|Turn on the .+ in your Google Cloud project/i, m)) {
      const api = googleApi(m);
      return {
        summary: `The ${api.name} is turned off in your Google Cloud project${api.project ? ` ${api.project}` : ""}.`,
        steps: [
          { text: "Open its page, signed in as the account that made this key.", url: api.url, link: "API page" },
          { text: "Press Enable (Manage means it's already on)." },
          { text: "Wait about 5 minutes for it to switch on." },
          { text: retry },
        ],
      };
    }
    if (has(/permission_denied|does not have (?:sufficient )?permission|insufficient permission|User does not have/i, m)) {
      const ga = has(/analytics/i, m);
      return {
        summary: "This key can't read that property.",
        steps: [
          ga ? { text: "In Google Analytics: Admin → Property access management.", url: "https://analytics.google.com/analytics/web/", link: "Open Google Analytics", logo: "Google Analytics" }
            : { text: "In Search Console: Settings → Users and permissions.", url: "https://search.google.com/search-console/users", link: "Open Search Console", logo: "Search Console" },
          { text: ctx.robot ? `Add ${ctx.robot} as ${ga ? "a Viewer" : "a Restricted user"}.` : `Add the robot key's email, or the Google account of these keys, as ${ga ? "a Viewer" : "a Restricted user"}.` },
          { text: retry },
        ],
      };
    }
    if (has(/doesn't know this property|not found|404/i, m)) {
      return {
        summary: `${tool} can't find the property this site uses.`,
        steps: [
          { text: "In Settings, check this site's property. Test fills the list with what the key can see." },
          { text: "Not in the list? The key can't see it: give it access first." },
          { text: retry },
        ],
      };
    }
    if (has(/Google refused these keys|invalid_grant|stopped this token|scopes|Make a new one/i, m)) {
      return {
        summary: "Google no longer accepts these keys.",
        steps: [
          { text: "In Settings → Google, follow How to get these keys to make new ones." },
          { text: "Paste them over the old ones." },
          { text: retry },
        ],
      };
    }
    if (has(/No encryption key at|can be read by other users|encrypted with a different key|saved key can't be read/i, m)) {
      return {
        summary: "The app can't unlock the key it saved.",
        steps: [
          has(/No encryption key at|can be read by other users/i, m) ? { text: "Whoever runs the server must run the command in the message first." } : null,
          { text: "Paste the key again in Settings and press Save." },
          { text: retry },
        ].filter(Boolean),
      };
    }
    if (has(/limit is reached|quota|rate.?limit|too many requests|429/i, m)) {
      return {
        summary: "Free limit used up for now. Nothing is broken.",
        steps: [
          { text: ctx.refills ? `It refills: ${ctx.refills}. The app tries again after that by itself.` : "It refills on its own, and the app retries by itself." },
          { text: `Need it sooner? Check your usage on ${tool}'s dashboard, or move another tool above it in the list.`, url: ctx.keyUrl, link: `Open ${tool}` },
        ],
      };
    }
    if (has(/answered with an error \(5\d\d\)|Couldn't reach|timed? ?out|temporar/i, m)) {
      return {
        summary: `${tool} had a problem on its side, or couldn't be reached. Your key is probably fine.`,
        steps: [
          { text: `Wait an hour. ${retry}` },
          { text: `If it still fails tomorrow, check ${tool}'s website for an outage notice.` },
        ],
      };
    }
    if (has(/address_error|IP address|unregistered/i, m)) {
      return {
        summary: `${tool} refuses requests from this server's address.`,
        steps: [
          { ...keyStep, text: `Open your ${tool} account and add this server's IP address to the allowed list.` },
          { text: retry },
        ],
      };
    }
    if (has(/refused access|refused this key|refused the key|refused the request|invalid|unauthori[sz]ed|authentication|forbidden|40[13]/i, m)) {
      return {
        summary: `${tool} doesn't accept this key.`,
        steps: [
          keyStep,
          { text: "Copy it again in full: a missing character or trailing space is the usual cause." },
          { text: `Paste it in the API key box above. ${retry}` },
          { text: "Still refused? Make a new key there and paste it. Also check the account: email confirmed, plan not expired." },
          EXTRA[ctx.id] ? { text: EXTRA[ctx.id] } : null,
        ].filter(Boolean),
      };
    }
    return {
      summary: "",
      steps: [
        { text: "Settings → this connection → Test shows the exact problem." },
        ctx.keyUrl ? keyStep : null,
        EXTRA[ctx.id] ? { text: EXTRA[ctx.id] } : null,
      ].filter(Boolean),
    };
  }

  // The tool's key page: a How to connect step that links to a key, token or credentials page, or else its main page.
  function keyUrl(c) {
    const steps = (c?.steps || []).filter((s) => s && typeof s === "object" && s.url);
    // On the link's words only: "keywordseverywhere.com" in an address isn't a key page.
    const key = steps.find((s) => /\b(?:keys?|tokens?|credentials)\b/i.test(s.link || "")) || steps.find((s) => /\b(?:keys?|tokens?|credentials)\b/i.test(s.title || s.text || "")) || steps[0];
    return key?.url || c?.url || "";
  }

  /* The box itself. opts.summary shows the plain sentence on top; opts.said shows the tool's own words in a fold. */
  function html(message, ctx = {}, opts = {}) {
    const { t, esc, icon } = window.UI;
    const fix = explain(message, ctx);
    if (!fix.steps.length) return "";
    const said = opts.said && message ? `<details class="fix-said"><summary>${icon("chevron-right")}${esc(t(`What ${ctx.tool || "it"} said`))}</summary><p dir="auto">${esc(t(message))}</p></details>` : "";
    return `<div class="fix-box" ${opts.id ? `id="${opts.id}"` : ""}>
      ${opts.summary && fix.summary ? `<p class="fix-summary">${icon("octagon-alert")}<span>${esc(t(fix.summary))}</span></p>` : ""}
      <b class="fix-title">${t("How to fix it")}</b>
      <ol class="fix-steps">${fix.steps.map((s) => `<li>${esc(t(s.text))}${s.url ? ` ${window.UI.stepLink(s)}` : ""}</li>`).join("")}</ol>
      ${said}
    </div>`;
  }

  window.FIX = { explain, html, keyUrl };

  // French, added the same way as the other screens' words. Sentences built from a tool name are matched on their pattern.
  const fr = {
    "How to fix it": "Comment corriger", "Key page": "Page des clés", "Open": "Ouvrir",
    "Press Enable (Manage means it's already on).": "Cliquez sur Activer (Gérer signifie qu'elle est déjà activée).",
    "Wait about 5 minutes for it to switch on.": "Patientez environ 5 minutes, le temps de l'activation.",
    "Open its page, signed in as the account that made this key.": "Ouvrez sa page, connecté avec le compte qui a créé cette clé.",
    "API page": "Page de l'API",
    "Then press Refresh data here; numbers return with the next pull.": "Cliquez ensuite sur Actualiser les données ici ; les chiffres reviennent au prochain relevé.",
    "Then press Test. It should say Works.": "Cliquez ensuite sur Tester. Il doit indiquer Fonctionne.",
    "This key can't read that property.": "Cette clé ne peut pas lire cette propriété.",
    "In Google Analytics: Admin → Property access management.": "Dans Google Analytics : Administration → Gestion des accès à la propriété.",
    "In Search Console: Settings → Users and permissions.": "Dans Search Console : Paramètres → Utilisateurs et autorisations.",
    "Open Google Analytics": "Ouvrir Google Analytics", "Open Search Console": "Ouvrir Search Console",
    "In Settings, check this site's property. Test fills the list with what the key can see.": "Dans Réglages, vérifiez la propriété de ce site. Tester remplit la liste avec ce que la clé voit.",
    "Not in the list? The key can't see it: give it access first.": "Absente de la liste ? La clé ne la voit pas : donnez-lui d'abord accès.",
    "Google no longer accepts these keys.": "Google n'accepte plus ces clés.",
    "In Settings → Google, follow How to get these keys to make new ones.": "Dans Réglages → Google, suivez Comment obtenir ces clés pour en créer de nouvelles.",
    "Paste them over the old ones.": "Collez-les à la place des anciennes.",
    "The app can't unlock the key it saved.": "L'application ne peut pas déverrouiller la clé enregistrée.",
    "Whoever runs the server must run the command in the message first.": "La personne qui gère le serveur doit d'abord lancer la commande indiquée dans le message.",
    "Paste the key again in Settings and press Save.": "Collez à nouveau la clé dans les réglages et cliquez sur Enregistrer.",
    "Free limit used up for now. Nothing is broken.": "Limite gratuite épuisée pour l'instant. Rien n'est cassé.",
    "It refills on its own, and the app retries by itself.": "Elle se recharge seule, et l'application réessaie toute seule.",
    "Copy it again in full: a missing character or trailing space is the usual cause.": "Copiez-la à nouveau en entier : un caractère manquant ou une espace finale en est la cause habituelle.",
    "Still refused? Make a new key there and paste it. Also check the account: email confirmed, plan not expired.": "Toujours refusée ? Créez-y une nouvelle clé et collez-la. Vérifiez aussi le compte : e-mail confirmé, offre non expirée.",
    "Settings → this connection → Test shows the exact problem.": "Réglages → cette connexion → Tester montre le problème exact.",
    "Old DomCop Open PageRank keys no longer work. Make a new one on the Open Page Rank tab of your Keywords Everywhere account.": "Les anciennes clés Open PageRank de DomCop ne marchent plus. Créez-en une dans l'onglet Open Page Rank de votre compte Keywords Everywhere.",
    "The token needs Account → Radar → Read. Zone or DNS tokens are refused.": "Le jeton doit avoir Compte → Radar → Lecture. Les jetons de zone ou DNS sont refusés.",
    "A Yandex token lasts about 6 months; then redo step 4 of How to connect.": "Un jeton Yandex dure environ 6 mois ; refaites ensuite l'étape 4 de Comment connecter.",
  };
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });

  // Sentences with a tool or API name in them.
  const patterns = [
    [/^The (.+) is turned off in your Google Cloud project( \d+)?\.$/, (m) => `L'API ${m[1].replace(/ API$/, "")} est désactivée dans votre projet Google Cloud${m[2] || ""}.`],
    [/^Open (.+)'s key page and check the key is still there and active\.$/, (m) => `Ouvrez la page des clés de ${m[1]} et vérifiez que la clé existe toujours et qu'elle est active.`],
    [/^Paste it in the API key box above\. (.+)$/, (m) => `Collez-la dans le champ Clé API ci-dessus. ${window.FR[m[1]] || m[1]}`],
    [/^(.+) doesn't accept this key\.$/, (m) => `${m[1]} n'accepte pas cette clé.`],
    [/^(.+) can't find the property this site uses\.$/, (m) => `${m[1]} ne trouve pas la propriété utilisée par ce site.`],
    [/^(.+) had a problem on its side, or couldn't be reached\. Your key is probably fine\.$/, (m) => `${m[1]} a eu un problème de son côté, ou n'a pas pu être joint. Votre clé est sans doute correcte.`],
    [/^Wait an hour\. (.+)$/, (m) => `Patientez une heure. ${window.FR[m[1]] || m[1]}`],
    [/^If it still fails tomorrow, check (.+)'s website for an outage notice\.$/, (m) => `Si ça échoue encore demain, regardez sur le site de ${m[1]} s'il y a une panne.`],
    [/^It refills: (.+)\. The app tries again after that by itself\.$/, (m) => `Elle se recharge : ${(window.FR[m[1]] || m[1]).toLowerCase()}. L'application réessaie ensuite toute seule.`],
    [/^Need it sooner\? Check your usage on (.+)'s dashboard, or move another tool above it in the list\.$/, (m) => `Besoin plus tôt ? Vérifiez votre consommation sur le tableau de bord de ${m[1]}, ou placez un autre outil au-dessus dans la liste.`],
    [/^Open your (.+) account and add this server's IP address to the allowed list\.$/, (m) => `Ouvrez votre compte ${m[1]} et ajoutez l'adresse IP de ce serveur à la liste autorisée.`],
    [/^(.+) refuses requests from this server's address\.$/, (m) => `${m[1]} refuse les requêtes venant de l'adresse de ce serveur.`],
    [/^Add (.+) as a Viewer\.$/, (m) => `Ajoutez ${m[1]} comme Lecteur.`],
    [/^Add (.+) as a Restricted user\.$/, (m) => `Ajoutez ${m[1]} comme utilisateur restreint.`],
    [/^What (.+) said$/, (m) => `Ce que ${m[1]} a répondu`],
    [/^Open (.+)$/, (m) => `Ouvrir ${m[1]}`],
  ];
  // The app's t() only looks words up, so these are taught to it the moment a box is drawn.
  const teach = (text) => { if (window.FR[text] !== undefined) return; const hit = patterns.find(([re]) => re.test(text)); if (hit) window.FR[text] = hit[1](text.match(hit[0])); };
  const plainHtml = html;
  window.FIX.html = (message, ctx = {}, opts = {}) => {
    const fix = explain(message, ctx);
    [fix.summary, ...fix.steps.flatMap((s) => [s.text, s.link]), `What ${ctx.tool || "it"} said`].filter(Boolean).forEach(teach);
    return plainHtml(message, ctx, opts);
  };
})();
