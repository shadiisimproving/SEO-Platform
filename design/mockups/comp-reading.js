/* How well the app can read a competitor's site, under the profile's header. Shown only when there's something to say:
   no sitemap, a sitemap cut at the app's limit, a first read that still needs days, pages that need JavaScript, a site that
   blocks the app. Firecrawl, when connected, is the backup: its button first shows what it costs and the credits left,
   and nothing is spent until the person confirms. */
(() => {
  "use strict";
  const COMP = (window.COMP = window.COMP || {});
  const polling = new Set();

  const U = () => window.UI;
  const t = (key) => U().t(key);
  const fill = (key, values = {}) => t(key).replace(/\{(\w+)\}/g, (all, name) => (name in values ? values[name] : all));
  const many = (n, one, other, values = {}) => fill((U().state.lang === "fr" ? n < 2 : n === 1) ? one : other, { n: U().num(n), ...values });
  const busy = (f) => f?.status === "queued" || f?.status === "running";

  function lines(p) {
    const c = p.crawl || {}, f = c.firecrawl || {}, out = [];
    if (!c.status || c.status === "none" || p.tracking === "off") return out;
    const fcButton = (action, label, credits) => (f.connected
      ? `<button type="button" class="btn btn-small" data-rd-ask="${action}" ${busy(f) ? "disabled" : ""}>${U().logo("firecrawl", 14)}${esc(label)} · ${esc(many(credits, "about {n} credit", "about {n} credits"))}</button>`
      : "");
    const connectHint = `<span class="small sec">${t("Firecrawl can do it, once it's connected in Settings.")} <button type="button" class="link-btn" data-go="settings">${t("Go to Settings")}</button></span>`;

    if (c.status === "blocked") {
      // The header's Blocked chip and this one line say it all: the site refuses bots, rankings still work, Firecrawl is the only way in.
      out.push({ kind: "warn", text: `${t("This site doesn't allow automated visitors, so its edits can't be tracked. Rankings, AI Overviews and shared keywords still work.")}${f.connected ? ` ${t("Firecrawl can read it for you. Only a click does it.")}` : ""}`, act: f.connected ? fcButton("read", t("Read with Firecrawl"), Math.min(c.pages_known || 1, 50)) : connectHint });
    } else {
      const listedByFirecrawl = f.action === "map" && f.status === "ok" && f.finished_at;
      if ((c.list_source === "links" || c.list_source === "feed") && listedByFirecrawl) {
        out.push({ kind: "info", text: fill("This site has no sitemap. Firecrawl listed its pages {when}, so the daily read watches all {n}. List them again now and then to find new pages.", { when: COMP.ago ? COMP.ago(f.finished_at) : "", n: U().num(c.pages_known || 0) }), act: f.connected ? fcButton("map", t("List all its pages"), 1) : "" });
      } else if (c.list_source === "links") {
        out.push({ kind: "warn", text: many(c.pages_known || 0, "This site has no sitemap, so the app only finds the {n} page its home page links to. Pages deeper in the site aren't watched.", "This site has no sitemap, so the app only finds the {n} pages its home page links to. Pages deeper in the site aren't watched."), act: f.connected ? fcButton("map", t("List all its pages"), 1) : connectHint });
      } else if (c.list_source === "feed") {
        out.push({ kind: "info", text: t("This site has no sitemap, only a news feed, so the app watches its home page and recent posts. Older pages aren't watched."), act: f.connected ? fcButton("map", t("List all its pages"), 1) : connectHint });
      }
      if (c.list_capped) {
        out.push({ kind: "info", text: fill("Their sitemap lists more than {most} pages. The app watches {most}: the pages that rank for your keywords first, then the rest in the sitemap's order.", { most: U().num(c.list_most || 5000) }) });
      }
      if (c.days_left) {
        out.push({ kind: "info", text: fill("First read: {tried} of about {known} pages so far. It reads up to {per} pages a day, so about {days} more. Edits show once it's done.", { tried: U().num(c.pages_tried || 0), known: U().num(c.pages_known || 0), per: U().num(c.per_day || 300), days: many(c.days_left, "{n} day", "{n} days") }) });
      }
      if (c.js_only) {
        out.push({ kind: "warn", text: many(c.js_only, "{n} page only shows its text with JavaScript, which the app can't run, so its words and edits aren't seen.", "{n} pages only show their text with JavaScript, which the app can't run, so their words and edits aren't seen."), act: f.connected ? fcButton("read", t("Read with Firecrawl"), Math.min(c.js_only, 50)) : connectHint });
      }
    }
    if (f.pages) {
      out.push({ kind: "info", text: many(f.pages, "{n} page was read with Firecrawl. The daily read leaves it alone, so check it for edits now and then.", "{n} pages were read with Firecrawl. The daily read leaves them alone, so check them for edits now and then."), act: f.connected ? fcButton("reread", t("Check for edits"), Math.min(f.pages, 50)) : "" });
    }
    if (busy(f)) {
      out.push({ kind: "info", spin: true, text: f.status === "queued" ? t("Firecrawl is about to start.") : f.action === "map" ? t("Firecrawl is listing the pages.") : fill("Firecrawl is reading: {done} of {asked} pages.", { done: U().num(f.done || 0), asked: U().num(f.asked || 0) }) });
    } else if (f.message && f.finished_at && !(f.action === "map" && f.status === "ok")) {
      out.push({ kind: f.status === "failed" ? "crit" : "good", text: `${t(f.message)} ${fill("({when})", { when: COMP.ago ? COMP.ago(f.finished_at) : "" })}` });
    }
    return out;
  }

  const esc = (value) => U().esc(value);
  const ICONS = { warn: "triangle-alert", info: "info", crit: "octagon-alert", good: "circle-check" };

  function box(p, siteId, { follow: following = true } = {}) {
    const rows = lines(p);
    if (!rows.length) return "";
    if (following && busy(p.crawl?.firecrawl)) setTimeout(() => follow(p, siteId), 0); // after the box is on the page
    const { icon } = U();
    // One fact is one line under the name. Several fold behind a line that counts them; the first stays in view.
    const line = (r) => `<li class="rd-line rd-${r.kind}">${icon(r.spin ? "refresh-cw" : ICONS[r.kind], r.spin ? "spin" : "")}<span class="rd-text">${esc(r.text)}</span>${r.act ? `<span class="rd-act">${r.act}</span>` : ""}</li>`;
    const [first, ...rest] = rows;
    const more = rest.length ? `<details class="rd-fold"><summary>${icon("chevron-right")}${esc(many(rest.length, "{n} more note on how the app reads this site", "{n} more notes on how the app reads this site"))}</summary><ul class="rd-lines">${rest.map(line).join("")}</ul></details>` : "";
    return `<section class="rd-box" aria-label="${esc(t("How well the app reads this site"))}" data-rd-box="${Number(p.id)}" data-rd-site="${Number(siteId)}">
      <ul class="rd-lines">${line(first)}</ul>${more}
      <div class="rd-confirm" hidden></div>
    </section>`;
  }

  function repaint(p, siteId, opts = {}) {
    const node = U().$(`[data-rd-box="${Number(p.id)}"]`);
    if (!node) return;
    const html = box(p, siteId, opts);
    if (!html) { node.remove(); return; }
    // Through the sanitiser like every other write (F82): a new box from the same markup, swapped in.
    const holder = document.createElement("div");
    U().setHTML(holder, html);
    const fresh = holder.firstElementChild;
    if (fresh) node.replaceWith(fresh); else node.remove();
  }

  /* While Firecrawl works, the box follows it, and its count moves as pages are read (F181). It asks only for the read's
     state (F60), through COMP.poll: paused while the browser tab is hidden, slower over time, and it stops when the run
     ends, the profile closes, the competitor is gone, or after 20 minutes in view. */
  function follow(p, siteId) {
    if (polling.has(p.id)) return;
    polling.add(p.id);
    const shown = () => U().$(`[data-rd-box="${Number(p.id)}"]`);
    COMP.poll(async () => {
      if (!shown()) return false;
      const fresh = await COMP.api("GET", `competitors/${p.id}/reading?site_id=${siteId}`);
      const was = JSON.stringify(p.crawl?.firecrawl || {});
      p.crawl = fresh.crawl;
      if (!shown()) return false;
      if (!busy(p.crawl?.firecrawl)) return false;
      if (JSON.stringify(p.crawl.firecrawl) !== was && !shown().querySelector(".rd-confirm:not([hidden])")) repaint(p, siteId, { follow: false });
      return true;
    }, { every: 2500, grow: 1.15, slowest: 15000, most: 20 * 60000, onEnd: () => { polling.delete(p.id); if (shown() && !busy(p.crawl?.firecrawl)) repaint(p, siteId); } });
  }

  const WORDS = {
    map: ["List all its pages with Firecrawl?", "This uses 1 credit. The pages it finds are added, and the daily read reads them for free, up to 300 a day."],
    read: ["Read these pages with Firecrawl?", "Each page uses 1 credit. Pages that rank for your keywords go first."],
    reread: ["Check these pages for edits with Firecrawl?", "Each page uses 1 credit. The oldest copies go first, and any change shows as an edit."],
  };

  async function ask(button) {
    const node = button.closest("[data-rd-box]"), id = Number(node.dataset.rdBox), siteId = Number(node.dataset.rdSite), action = button.dataset.rdAsk;
    const panel = node.querySelector(".rd-confirm"), { icon, num } = U();
    panel.hidden = false;
    U().setHTML(panel, `<p class="small sec">${icon("refresh-cw", "spin")}${t("Asking Firecrawl how many credits are left…")}</p>`);
    let offer;
    try {
      offer = await COMP.api("GET", `competitors/${id}/firecrawl?site_id=${siteId}`);
    } catch (err) {
      U().setHTML(panel, `<p class="error">${icon("octagon-alert")}${esc(t(err.message))}</p>`);
      return;
    }
    const what = offer[action];
    if (!what) { U().setHTML(panel, `<p class="small sec">${t("There's nothing for Firecrawl to do here now.")}</p>`); return; }
    const credits = offer.credits;
    const left = credits && credits.left !== null && credits.left !== undefined
      ? fill("You have {left} of {of} credits left, until {date}.", { left: num(credits.left), of: num(credits.of), date: U().fmtDateOnly(credits.resets) })
      : t(offer.error || "Firecrawl didn't say how many credits are left.");
    const most = Math.min(what.pages || 1, offer.most_per_run || 50);
    const tooFew = credits && typeof credits.left === "number" && credits.left < 1;
    const count = action === "map" ? "" : `<label class="rd-count">${esc(many(what.pages, "Pages to read, of {n}:", "Pages to read, of {n}:"))} <input type="number" class="input" min="1" max="${most}" value="${Math.min(most, credits && typeof credits.left === "number" ? Math.max(1, credits.left) : most)}" data-rd-pages></label>`;
    U().setHTML(panel, `<p class="rd-q"><b>${esc(t(WORDS[action][0]))}</b> ${esc(t(WORDS[action][1]))}</p>
      <p class="small sec">${esc(left)}${action === "map" ? "" : ` ${esc(fill("At most {n} pages a click.", { n: num(offer.most_per_run || 50) }))}`}</p>
      <div class="rd-go">${count}<button type="button" class="btn btn-small btn-main" data-rd-go="${action}" ${tooFew ? "disabled" : ""}>${U().logo("firecrawl", 14)}${t(action === "map" ? "List the pages" : action === "reread" ? "Check them" : "Read them")}</button><button type="button" class="btn btn-small btn-ghost" data-rd-cancel>${t("Cancel")}</button></div>
      <p class="error" role="alert" hidden></p>`);
  }

  async function go(button) {
    const node = button.closest("[data-rd-box]"), id = Number(node.dataset.rdBox), siteId = Number(node.dataset.rdSite), action = button.dataset.rdGo;
    const input = node.querySelector("[data-rd-pages]"), problem = node.querySelector(".rd-confirm .error");
    const body = { site_id: siteId, action };
    if (input) body.pages = Number(input.value);
    button.disabled = true;
    try {
      await COMP.api("POST", `competitors/${id}/firecrawl`, body);
    } catch (err) {
      button.disabled = false;
      problem.textContent = t(err.message); problem.hidden = false;
      return;
    }
    U().toast(t(action === "map" ? "Firecrawl is listing the pages." : "Firecrawl is reading the pages. You can leave this screen."), { kind: "info" });
    const p = { id, crawl: null };
    try { Object.assign(p, await COMP.api("GET", `competitors/${id}/reading?site_id=${siteId}`)); } catch { return; }
    repaint(p, siteId);
  }

  document.addEventListener("click", (event) => {
    const askBtn = event.target.closest?.("[data-rd-ask]");
    if (askBtn) { event.stopPropagation(); ask(askBtn); return; }
    const goBtn = event.target.closest?.("[data-rd-go]");
    if (goBtn) { event.stopPropagation(); go(goBtn); return; }
    const cancel = event.target.closest?.("[data-rd-cancel]");
    if (cancel) { const panel = cancel.closest(".rd-confirm"); panel.hidden = true; U().setHTML(panel, ""); }
  }, true);

  COMP.reading = { box };

  Object.assign(window.FR = window.FR || {}, {
    "How well the app reads this site": "Ce que l'appli arrive à lire sur ce site",
    "Firecrawl can do it, once it's connected in Settings.": "Firecrawl peut le faire, une fois connecté dans les réglages.",
    "Go to Settings": "Aller aux réglages",
    "This site doesn't allow automated visitors, so its edits can't be tracked. Rankings, AI Overviews and shared keywords still work.": "Ce site n'autorise pas les visiteurs automatisés : ses modifications ne peuvent donc pas être suivies. Les positions, les AI Overviews et les mots-clés partagés fonctionnent toujours.",
    "Firecrawl can read it for you. Only a click does it.": "Firecrawl peut le lire pour vous. Seul un clic le lance.",
    "{n} more note on how the app reads this site": "{n} autre remarque sur la lecture de ce site par l'appli",
    "{n} more notes on how the app reads this site": "{n} autres remarques sur la lecture de ce site par l'appli",
    "Firecrawl can read it for you, though the site asked bots not to. Only a click does it.": "Firecrawl peut le lire pour vous, même si le site demande aux robots de ne pas le faire. Seul un clic le lance.",
    "Read with Firecrawl": "Lire avec Firecrawl",
    "List all its pages": "Lister toutes ses pages",
    "Check for edits": "Chercher les modifications",
    "about {n} credit": "environ {n} crédit", "about {n} credits": "environ {n} crédits",
    "This site has no sitemap, so the app only finds the {n} page its home page links to. Pages deeper in the site aren't watched.": "Ce site n'a pas de sitemap : l'appli ne trouve que {n} page, celle vers laquelle pointe sa page d'accueil. Les pages plus profondes ne sont pas suivies.",
    "This site has no sitemap, so the app only finds the {n} pages its home page links to. Pages deeper in the site aren't watched.": "Ce site n'a pas de sitemap : l'appli ne trouve que les {n} pages vers lesquelles pointe sa page d'accueil. Les pages plus profondes ne sont pas suivies.",
    "This site has no sitemap, only a news feed, so the app watches its home page and recent posts. Older pages aren't watched.": "Ce site n'a pas de sitemap, seulement un flux d'actualités : l'appli suit sa page d'accueil et ses articles récents. Les pages plus anciennes ne sont pas suivies.",
    "Their sitemap lists more than {most} pages. The app watches {most}: the pages that rank for your keywords first, then the rest in the sitemap's order.": "Leur sitemap liste plus de {most} pages. L'appli en suit {most} : d'abord celles qui se positionnent sur vos mots-clés, puis les autres dans l'ordre du sitemap.",
    "First read: {tried} of about {known} pages so far. It reads up to {per} pages a day, so about {days} more. Edits show once it's done.": "Première lecture : {tried} pages sur environ {known} pour l'instant. Elle lit jusqu'à {per} pages par jour, donc encore environ {days}. Les modifications s'affichent une fois terminée.",
    "{n} day": "{n} jour", "{n} days": "{n} jours",
    "This site has no sitemap. Firecrawl listed its pages {when}, so the daily read watches all {n}. List them again now and then to find new pages.": "Ce site n'a pas de sitemap. Firecrawl a listé ses pages {when} : la lecture quotidienne suit donc les {n}. Relancez la liste de temps en temps pour trouver les nouvelles pages.",
    "{n} page only shows its text with JavaScript, which the app can't run, so its words and edits aren't seen.": "{n} page n'affiche son texte qu'avec JavaScript, que l'appli ne peut pas exécuter : ses mots et ses modifications ne sont pas vus.",
    "{n} pages only show their text with JavaScript, which the app can't run, so their words and edits aren't seen.": "{n} pages n'affichent leur texte qu'avec JavaScript, que l'appli ne peut pas exécuter : leurs mots et leurs modifications ne sont pas vus.",
    "{n} page was read with Firecrawl. The daily read leaves it alone, so check it for edits now and then.": "{n} page a été lue avec Firecrawl. La lecture quotidienne n'y touche pas : vérifiez-la de temps en temps.",
    "{n} pages were read with Firecrawl. The daily read leaves them alone, so check them for edits now and then.": "{n} pages ont été lues avec Firecrawl. La lecture quotidienne n'y touche pas : vérifiez-les de temps en temps.",
    "Firecrawl is about to start.": "Firecrawl va commencer.",
    "Firecrawl is listing the pages.": "Firecrawl liste les pages.",
    "Firecrawl is reading: {done} of {asked} pages.": "Firecrawl lit : {done} pages sur {asked}.",
    "Asking Firecrawl how many credits are left…": "Demande à Firecrawl combien de crédits il reste…",
    "There's nothing for Firecrawl to do here now.": "Firecrawl n'a rien à faire ici pour l'instant.",
    "You have {left} of {of} credits left, until {date}.": "Il vous reste {left} crédits sur {of}, jusqu'au {date}.",
    "Firecrawl didn't say how many credits are left.": "Firecrawl n'a pas dit combien de crédits il reste.",
    "List all its pages with Firecrawl?": "Lister toutes ses pages avec Firecrawl ?",
    "This uses 1 credit. The pages it finds are added, and the daily read reads them for free, up to 300 a day.": "Cela utilise 1 crédit. Les pages trouvées sont ajoutées, et la lecture quotidienne les lit gratuitement, jusqu'à 300 par jour.",
    "Read these pages with Firecrawl?": "Lire ces pages avec Firecrawl ?",
    "Each page uses 1 credit. Pages that rank for your keywords go first.": "Chaque page utilise 1 crédit. Les pages qui se positionnent sur vos mots-clés passent en premier.",
    "Check these pages for edits with Firecrawl?": "Chercher les modifications de ces pages avec Firecrawl ?",
    "Each page uses 1 credit. The oldest copies go first, and any change shows as an edit.": "Chaque page utilise 1 crédit. Les copies les plus anciennes passent en premier, et tout changement s'affiche comme une modification.",
    "Pages to read, of {n}:": "Pages à lire, sur {n} :",
    "At most {n} pages a click.": "Au plus {n} pages par clic.",
    "List the pages": "Lister les pages", "Check them": "Les vérifier", "Read them": "Les lire", "Cancel": "Annuler",
    "Firecrawl is reading the pages. You can leave this screen.": "Firecrawl lit les pages. Vous pouvez quitter cet écran.",
    "Backup reader for competitor sites the app can't read itself": "Lecteur de secours pour les sites concurrents que l'appli ne peut pas lire elle-même",
    "Free plan, then from $16 a month": "Offre gratuite, puis à partir de 16 $ par mois",
    "1 credit a page read, 1 credit a page list": "1 crédit par page lue, 1 crédit par liste de pages",
    "Off until you paste a key. It never runs by itself: a competitor's page shows what it would cost, and it only runs when you press the button. At most 50 pages a click.": "Désactivé tant qu'aucune clé n'est collée. Il ne tourne jamais seul : la page d'un concurrent indique le coût, et il ne se lance que lorsque vous appuyez sur le bouton. Au plus 50 pages par clic.",
    "It sends the competitor's page addresses to Firecrawl, which reads them for you. Nothing about your own sites or leads is sent.": "Les adresses des pages du concurrent sont envoyées à Firecrawl, qui les lit pour vous. Rien sur vos propres sites ou vos prospects n'est envoyé.",
    "Create a Firecrawl account. The free plan has credits each month, and no card is needed.": "Créez un compte Firecrawl. L'offre gratuite donne des crédits chaque mois, sans carte bancaire.",
    "Open Firecrawl": "Ouvrir Firecrawl",
    "Open API Keys and copy your key. It starts with fc-.": "Ouvrez API Keys et copiez votre clé. Elle commence par fc-.",
    "Open API Keys": "Ouvrir API Keys",
    "Paste it here, press Test, then Save. Test shows your credits and costs nothing.": "Collez-la ici, appuyez sur Tester, puis Enregistrer. Le test affiche vos crédits et ne coûte rien.",
    "Firecrawl refused the key. Paste it again in Settings.": "Firecrawl a refusé la clé. Collez-la à nouveau dans les réglages.",
    "Firecrawl has no credits left this month.": "Firecrawl n'a plus de crédits ce mois-ci.",
    "Connect Firecrawl in Settings first.": "Connectez d'abord Firecrawl dans les réglages.",
    "Firecrawl is already working on this site.": "Firecrawl travaille déjà sur ce site.",
    "Firecrawl's run stopped before the end. Pages read before it are saved. Try again.": "Le passage de Firecrawl s'est arrêté avant la fin. Les pages lues avant sont enregistrées. Réessayez.",
    "The last read stopped before the end. Pages read before it are saved, and it carries on at the next daily read.": "La dernière lecture s'est arrêtée avant la fin. Les pages lues avant sont enregistrées, et elle reprend à la prochaine lecture quotidienne.",
    "There's no page here that needs Firecrawl.": "Aucune page ici n'a besoin de Firecrawl.",
  });
})();
