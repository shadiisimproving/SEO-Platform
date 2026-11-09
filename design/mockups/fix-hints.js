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
    openpagerank: "Keys from the old DomCop Open PageRank site no longer work. Make a new key on the Open Page Rank tab of your Keywords Everywhere account.",
    cloudflare: "The token needs Account, then Radar, then Read. A token for a zone or for DNS is refused.",
    yandex: "A Yandex token lasts about 6 months. When it runs out, get a new one with step 4 of How to connect.",
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
    const retry = ctx.retry === "refresh" ? "Then press Refresh data on this page. The numbers come back with the next pull." : "Then press Test. It should say Works.";
    const keyStep = { text: `Open ${tool}'s key page and check the key is still there and active.`, url: ctx.keyUrl, link: "Open the key page" };

    if (has(/has not been used in project|is disabled|Turn on the .+ in your Google Cloud project/i, m)) {
      const api = googleApi(m);
      return {
        summary: `The ${api.name} is turned off in your Google Cloud project${api.project ? ` ${api.project}` : ""}.`,
        steps: [
          { text: "Open its page in Google Cloud, signed in with the account that made this key.", url: api.url, link: "Open the API page" },
          { text: "Press Enable. If the button says Manage, it's already on." },
          { text: "Wait about 5 minutes. It takes a moment to switch on." },
          { text: retry },
        ],
      };
    }
    if (has(/permission_denied|does not have (?:sufficient )?permission|insufficient permission|User does not have/i, m)) {
      const ga = has(/analytics/i, m);
      return {
        summary: "This key can't read that property.",
        steps: [
          ga ? { text: "In Google Analytics, open Admin, then Property access management.", url: "https://analytics.google.com/analytics/web/", link: "Open Google Analytics" }
            : { text: "In Search Console, open Settings, then Users and permissions.", url: "https://search.google.com/search-console/users", link: "Open Search Console" },
          { text: ctx.robot ? `Add ${ctx.robot} as ${ga ? "a Viewer" : "a Restricted user"}.` : `Add the robot key's email, or the Google account of these keys, as ${ga ? "a Viewer" : "a Restricted user"}.` },
          { text: retry },
        ],
      };
    }
    if (has(/doesn't know this property|not found|404/i, m)) {
      return {
        summary: `${tool} can't find the property this site uses.`,
        steps: [
          { text: "In Settings, check the property picked for this site. Press Test there to fill the list with what the key can see." },
          { text: "If it's missing from the list, the key can't see it: give the key access to it first." },
          { text: retry },
        ],
      };
    }
    if (has(/Google refused these keys|invalid_grant|stopped this token|scopes|Make a new one/i, m)) {
      return {
        summary: "Google no longer accepts these keys.",
        steps: [
          { text: "In Settings, open Google and follow How to get these keys to make new ones." },
          { text: "Paste them in place of the old ones." },
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
        summary: "The free limit is used up for now. Nothing is broken.",
        steps: [
          { text: ctx.refills ? `It refills: ${ctx.refills}. The app tries again after that by itself.` : "It refills on its own. The app tries again after that by itself." },
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
          { text: "Copy it again in full. A missing character, or a space at the end, is the usual cause." },
          { text: `Paste it in the API key box above. ${retry}` },
          { text: "Still refused? Make a new key there and paste that one. Also check the account itself: email confirmed, plan not expired." },
          EXTRA[ctx.id] ? { text: EXTRA[ctx.id] } : null,
        ].filter(Boolean),
      };
    }
    return {
      summary: "",
      steps: [
        { text: "Open Settings, then this connection, and press Test to see the exact problem." },
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
      <ol class="fix-steps">${fix.steps.map((s) => `<li>${esc(t(s.text))}${s.url ? ` <a class="ext-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${icon("external-link")}${esc(t(s.link || "Open"))}</a>` : ""}</li>`).join("")}</ol>
      ${said}
    </div>`;
  }

  window.FIX = { explain, html, keyUrl };

  // French, added the same way as the other screens' words. Sentences built from a tool name are matched on their pattern.
  const fr = {
    "How to fix it": "Comment corriger", "Open the key page": "Ouvrir la page des clés", "Open": "Ouvrir",
    "Press Enable. If the button says Manage, it's already on.": "Cliquez sur Activer. Si le bouton indique Gérer, elle est déjà activée.",
    "Wait about 5 minutes. It takes a moment to switch on.": "Patientez environ 5 minutes : l'activation prend un moment.",
    "Open its page in Google Cloud, signed in with the account that made this key.": "Ouvrez sa page dans Google Cloud, connecté avec le compte qui a créé cette clé.",
    "Open the API page": "Ouvrir la page de l'API",
    "Then press Refresh data on this page. The numbers come back with the next pull.": "Cliquez ensuite sur Actualiser les données sur cette page. Les chiffres reviennent au prochain relevé.",
    "Then press Test. It should say Works.": "Cliquez ensuite sur Tester. Il doit indiquer Fonctionne.",
    "This key can't read that property.": "Cette clé ne peut pas lire cette propriété.",
    "In Google Analytics, open Admin, then Property access management.": "Dans Google Analytics, ouvrez Administration, puis Gestion des accès à la propriété.",
    "In Search Console, open Settings, then Users and permissions.": "Dans Search Console, ouvrez Paramètres, puis Utilisateurs et autorisations.",
    "Open Google Analytics": "Ouvrir Google Analytics", "Open Search Console": "Ouvrir Search Console",
    "In Settings, check the property picked for this site. Press Test there to fill the list with what the key can see.": "Dans les réglages, vérifiez la propriété choisie pour ce site. Cliquez sur Tester pour remplir la liste avec ce que la clé voit.",
    "If it's missing from the list, the key can't see it: give the key access to it first.": "Si elle n'est pas dans la liste, la clé ne la voit pas : donnez-lui d'abord accès.",
    "Google no longer accepts these keys.": "Google n'accepte plus ces clés.",
    "In Settings, open Google and follow How to get these keys to make new ones.": "Dans les réglages, ouvrez Google et suivez Comment obtenir ces clés pour en créer de nouvelles.",
    "Paste them in place of the old ones.": "Collez-les à la place des anciennes.",
    "The app can't unlock the key it saved.": "L'application ne peut pas déverrouiller la clé enregistrée.",
    "Whoever runs the server must run the command in the message first.": "La personne qui gère le serveur doit d'abord lancer la commande indiquée dans le message.",
    "Paste the key again in Settings and press Save.": "Collez à nouveau la clé dans les réglages et cliquez sur Enregistrer.",
    "The free limit is used up for now. Nothing is broken.": "La limite gratuite est épuisée pour l'instant. Rien n'est cassé.",
    "It refills on its own. The app tries again after that by itself.": "Elle se recharge d'elle-même. L'application réessaie ensuite toute seule.",
    "Copy it again in full. A missing character, or a space at the end, is the usual cause.": "Copiez-la à nouveau en entier. Un caractère manquant ou une espace à la fin en est la cause habituelle.",
    "Still refused? Make a new key there and paste that one. Also check the account itself: email confirmed, plan not expired.": "Toujours refusée ? Créez-y une nouvelle clé et collez-la. Vérifiez aussi le compte : e-mail confirmé, offre non expirée.",
    "Open Settings, then this connection, and press Test to see the exact problem.": "Ouvrez les réglages, puis cette connexion, et cliquez sur Tester pour voir le problème exact.",
    "Keys from the old DomCop Open PageRank site no longer work. Make a new key on the Open Page Rank tab of your Keywords Everywhere account.": "Les clés de l'ancien site Open PageRank de DomCop ne fonctionnent plus. Créez une nouvelle clé dans l'onglet Open Page Rank de votre compte Keywords Everywhere.",
    "The token needs Account, then Radar, then Read. A token for a zone or for DNS is refused.": "Le jeton doit avoir Compte, puis Radar, puis Lecture. Un jeton de zone ou de DNS est refusé.",
    "A Yandex token lasts about 6 months. When it runs out, get a new one with step 4 of How to connect.": "Un jeton Yandex dure environ 6 mois. Quand il expire, obtenez-en un nouveau avec l'étape 4 de Comment se connecter.",
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
