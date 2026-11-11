/* How well the app can read a competitor's site, under the profile's header. Shown only when there's something to say:
   no sitemap, a sitemap cut at the app's limit, a first read that still needs days, pages that need JavaScript, a site that
   blocks the app. How the site is followed (every page daily, WordPress, its sitemap, or in tiers) is on the profile's
   "Last read" line instead (COMP.reading.follow), so it takes no room. Firecrawl, when connected, is the backup: its button first shows what it costs and the credits left, and nothing is
   spent until the person confirms. Its weekly check runs by itself only after that yes, and stops with one click. */
(() => {
  "use strict";
  const COMP = (window.COMP = window.COMP || {});
  const polling = new Set();

  const U = () => window.UI;
  const t = (key) => U().t(key);
  const fill = (key, values = {}) => t(key).replace(/\{(\w+)\}/g, (all, name) => (name in values ? values[name] : all));
  const many = (n, one, other, values = {}) => fill((U().state.lang === "fr" ? n < 2 : n === 1) ? one : other, { n: U().num(n), ...values });
  const busy = (f) => f?.status === "queued" || f?.status === "running";
  /* The full sentence behind (i), right after a short line (2026-11-11). Plural like many(); fr-short.js holds the French. */
  const tip = (sentence, values) => U().tip(sentence, values);
  const manyTip = (n, one, other, values = {}) => tip((U().state.lang === "fr" ? n < 2 : n === 1) ? one : other, { n: U().num(n), ...values });

  /* How the app follows this site, in one line: the answer to "would I see their edits?" (2026-11-10). */
  function followLine(c) {
    const w = c.follow || {};
    if (w.mode === "all") return { kind: "good", short: t("all pages daily"), text: many(c.pages_known || 0, "Its {n} page is read daily; edits show next morning.", "All {n} pages read daily; edits show next morning.") };
    if (w.mode === "wordpress") return { kind: "good", short: t("WordPress lists its edits"), text: t("WordPress lists each edit, so edited pages are read the same night.") };
    if (w.mode === "sitemap") return { kind: "good", short: t("sitemap dates edits"), text: t("Its sitemap dates edits, so edited pages are read the same night.") };
    if (w.mode === "tiers") return { kind: "info", short: fill("ranking pages daily, the rest every {rest}", { rest: many(w.rest_every_days || 1, "{n} day", "{n} days") }), text: fill("Its sitemap doesn't date edits, so: your top {top} and main pages daily, other ranking or recently edited pages every {few} days, the rest every {rest}.", { top: U().num(w.top_rank || 20), few: U().num(w.every_few_days || 3), rest: many(w.rest_every_days || 1, "{n} day", "{n} days") }) };
    return null;
  }

  function lines(p) {
    const c = p.crawl || {}, f = c.firecrawl || {}, out = [];
    if (!c.status || c.status === "none" || p.tracking === "off") return out;
    const fcButton = (action, label, credits) => (f.connected
      ? `<button type="button" class="btn btn-small" data-rd-ask="${action}" ${busy(f) ? "disabled" : ""}>${U().logo("firecrawl", 14)}${esc(label)} · ${esc(many(credits, "~{n} credit", "~{n} credits"))}</button>`
      : "");
    const connectHint = `<span class="small sec">${t("Firecrawl can read it once connected in Settings.")} <button type="button" class="link-btn" data-go="settings">${t("Open Settings")}</button></span>`;

    // How the site is followed rides on the profile's "Last read" line (COMP.reading.follow), so this box only holds problems.
    if (c.status === "blocked") {
      // The header's Blocked chip and this one line say it all: the site refuses bots, rankings still work, Firecrawl is the only way in.
      // Two short sentences, each with its full sentence behind its own (i); the line is HTML, every piece escaped.
      out.push({ kind: "warn", html: `${esc(t("Blocks bots: edits can't be tracked. Rankings and AI Overviews still work."))}${tip("This site doesn't allow automated visitors, so its edits can't be tracked. Rankings, AI Overviews and shared keywords still work.")} ${esc(t("Title changes in results still show as “probably edited”."))}${tip("When its title changes in your ranking checks, the timeline shows the page as probably edited.")}${f.connected ? ` ${esc(t("Firecrawl can read it when you click."))}` : ""}`, act: f.connected ? fcButton("read", t("Read with Firecrawl"), Math.min(c.pages_known || 1, 50)) : connectHint });
    } else {
      const listedByFirecrawl = f.action === "map" && f.status === "ok" && f.finished_at;
      if ((c.list_source === "links" || c.list_source === "feed") && listedByFirecrawl) {
        const listed = { when: COMP.ago ? COMP.ago(f.finished_at) : "", n: U().num(c.pages_known || 0) };
        out.push({ kind: "info", text: fill("No sitemap: Firecrawl listed all {n} pages {when}. List again now and then.", listed), tip: tip("This site has no sitemap. Firecrawl listed its pages {when}, so the daily read watches all {n}. List them again now and then to find new pages.", listed), act: f.connected ? fcButton("map", t("List all pages"), 1) : "" });
      } else if (c.list_source === "links") {
        out.push({ kind: "warn", text: many(c.pages_known || 0, "No sitemap: only the {n} page linked from its home page is watched.", "No sitemap: only the {n} pages linked from its home page are watched."), tip: manyTip(c.pages_known || 0, "This site has no sitemap, so the app only finds the {n} page its home page links to. Pages deeper in the site aren't watched.", "This site has no sitemap, so the app only finds the {n} pages its home page links to. Pages deeper in the site aren't watched."), act: f.connected ? fcButton("map", t("List all pages"), 1) : connectHint });
      } else if (c.list_source === "feed") {
        out.push({ kind: "info", text: t("No sitemap: only its home page and recent posts are watched."), tip: tip("This site has no sitemap, only a news feed, so the app watches its home page and recent posts. Older pages aren't watched."), act: f.connected ? fcButton("map", t("List all pages"), 1) : connectHint });
      }
      if (c.list_capped) {
        const most = { most: U().num(c.list_most || 5000) };
        out.push({ kind: "info", text: fill("Big sitemap: {most} pages watched, ranking pages first.", most), tip: tip("Their sitemap lists more than {most} pages. The app watches {most}: the pages that rank for your keywords first, then the rest in the sitemap's order.", most) });
      }
      if (c.days_left) {
        out.push({ kind: "info", text: fill("First read: {tried} of ~{known} pages, {per} a day, ~{days} to go. Edits show after.", { tried: U().num(c.pages_tried || 0), known: U().num(c.pages_known || 0), per: U().num(c.per_day || 300), days: many(c.days_left, "{n} day", "{n} days") }) });
      }
      if (c.js_only) {
        out.push({ kind: "warn", text: many(c.js_only, "{n} page needs JavaScript, so its words and edits aren't seen.", "{n} pages need JavaScript, so their words and edits aren't seen."), tip: manyTip(c.js_only, "{n} page only shows its text with JavaScript, which the app can't run, so its words and edits aren't seen.", "{n} pages only show their text with JavaScript, which the app can't run, so their words and edits aren't seen."), act: f.connected ? fcButton("read", t("Read with Firecrawl"), Math.min(c.js_only, 50)) : connectHint });
      }
    }
    if (f.pages && f.weekly) {
      out.push({ kind: "info", text: many(f.pages, "{n} page read with Firecrawl; checked weekly if it ranks.", "{n} pages read with Firecrawl; ranking ones checked weekly."), act: f.connected ? `${fcButton("reread", t("Check for edits"), Math.min(f.pages, 50))}<button type="button" class="link-btn" data-rd-weekly-off>${esc(t("Stop weekly check"))}</button>` : "" });
    } else if (f.pages) {
      out.push({ kind: "info", text: many(f.pages, "{n} page read with Firecrawl; check it for edits now and then.", "{n} pages read with Firecrawl; check them for edits now and then."), tip: manyTip(f.pages, "{n} page was read with Firecrawl. The daily read leaves it alone, so check it for edits now and then.", "{n} pages were read with Firecrawl. The daily read leaves them alone, so check them for edits now and then."), act: f.connected ? `${fcButton("reread", t("Check for edits"), Math.min(f.pages, 50))}<button type="button" class="btn btn-small btn-ghost" data-rd-ask="weekly" ${busy(f) ? "disabled" : ""}>${esc(t("Check weekly"))}</button>` : "" });
    }
    if (busy(f)) {
      out.push({ kind: "info", spin: true, text: f.status === "queued" ? t("Firecrawl starting…") : f.action === "map" ? t("Firecrawl listing pages…") : fill("Firecrawl is reading: {done} of {asked} pages.", { done: U().num(f.done || 0), asked: U().num(f.asked || 0) }) });
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
    const line = (r) => `<li class="rd-line rd-${r.kind}">${icon(r.spin ? "refresh-cw" : ICONS[r.kind], r.spin ? "spin" : "")}<span class="rd-text">${r.html ?? esc(r.text)}${r.tip || ""}</span>${r.act ? `<span class="rd-act">${r.act}</span>` : ""}</li>`;
    const [first, ...rest] = rows;
    const more = rest.length ? `<details class="rd-fold"><summary>${icon("chevron-right")}${esc(many(rest.length, "{n} more note", "{n} more notes"))}</summary><ul class="rd-lines">${rest.map(line).join("")}</ul></details>` : "";
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
    // A click inside the folded notes repaints the box: the fold stays as the person left it, not snapped shut.
    if (fresh && node.querySelector(".rd-fold")?.open) { const fold = fresh.querySelector(".rd-fold"); if (fold) fold.open = true; }
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
    map: ["List all its pages with Firecrawl?", "1 credit. Found pages join the free daily read, up to 300 a day."],
    read: ["Read these pages with Firecrawl?", "1 credit a page; ranking pages first."],
    reread: ["Check them for edits with Firecrawl?", "1 credit a page; oldest copies first. Any change shows as an edit."],
    weekly: ["Check them weekly with Firecrawl?", "Ranking pages only, 1 credit each, weekly. Stop it here any time."],
  };

  async function ask(button) {
    const node = button.closest("[data-rd-box]"), id = Number(node.dataset.rdBox), siteId = Number(node.dataset.rdSite), action = button.dataset.rdAsk;
    const panel = node.querySelector(".rd-confirm"), { icon, num } = U();
    panel.hidden = false;
    U().setHTML(panel, `<p class="small sec">${icon("refresh-cw", "spin")}${t("Checking Firecrawl credits…")}</p>`);
    let offer;
    try {
      offer = await COMP.api("GET", `competitors/${id}/firecrawl?site_id=${siteId}`);
    } catch (err) {
      U().setHTML(panel, `<p class="error">${icon("octagon-alert")}${esc(t(err.message))}</p>`);
      return;
    }
    const what = offer[action];
    if (!what) { U().setHTML(panel, `<p class="small sec">${t("Nothing for Firecrawl to do now.")}</p>`); return; }
    const credits = offer.credits;
    const left = credits && credits.left !== null && credits.left !== undefined
      ? fill("{left} of {of} credits left, until {date}.", { left: num(credits.left), of: num(credits.of), date: U().fmtDateOnly(credits.resets) })
      : t(offer.error || "Firecrawl gave no credit count.");
    const most = Math.min(what.pages || 1, offer.most_per_run || 50);
    const tooFew = credits && typeof credits.left === "number" && credits.left < 1;
    const perWeek = action === "weekly" ? ` ${many(what.pages, "{n} page, ~{n} credit a week.", "{n} pages, ~{n} credits a week.")}` : ""; // a page costs a credit
    const count = action === "map" || action === "weekly" ? "" : `<label class="rd-count">${esc(many(what.pages, "Pages to read, of {n}:", "Pages to read, of {n}:"))} <input type="number" class="input" min="1" max="${most}" value="${Math.min(most, credits && typeof credits.left === "number" ? Math.max(1, credits.left) : most)}" data-rd-pages></label>`;
    U().setHTML(panel, `<p class="rd-q"><b>${esc(t(WORDS[action][0]))}</b> ${esc(t(WORDS[action][1]))}</p>
      <p class="small sec">${esc(left)}${esc(perWeek)}${action === "map" || action === "weekly" ? "" : ` ${esc(fill("At most {n} pages a click.", { n: num(offer.most_per_run || 50) }))}`}</p>
      <div class="rd-go">${count}<button type="button" class="btn btn-small btn-main" data-rd-go="${action}" ${tooFew ? "disabled" : ""}>${U().logo("firecrawl", 14)}${t(action === "map" ? "List pages" : action === "reread" ? "Check them" : action === "weekly" ? "Yes, every week" : "Read them")}</button><button type="button" class="btn btn-small btn-ghost" data-rd-cancel>${t("Cancel")}</button></div>
      <p class="error" role="alert" hidden></p>`);
  }

  async function go(button) {
    const node = button.closest("[data-rd-box]"), id = Number(node.dataset.rdBox), siteId = Number(node.dataset.rdSite), action = button.dataset.rdGo;
    const input = node.querySelector("[data-rd-pages]"), problem = node.querySelector(".rd-confirm .error");
    const body = { site_id: siteId, action };
    if (input) body.pages = Number(input.value);
    button.disabled = true;
    try {
      if (action === "weekly") await COMP.api("POST", `competitors/${id}/firecrawl/weekly`, { site_id: siteId, on: true });
      else await COMP.api("POST", `competitors/${id}/firecrawl`, body);
    } catch (err) {
      button.disabled = false;
      problem.textContent = t(err.message); problem.hidden = false;
      return;
    }
    U().toast(t(action === "map" ? "Firecrawl listing pages…" : action === "weekly" ? "Done. Firecrawl checks them weekly from tonight." : "Firecrawl is reading. Keeps going if you leave."), { kind: "info" });
    const p = { id, crawl: null };
    try { Object.assign(p, await COMP.api("GET", `competitors/${id}/reading?site_id=${siteId}`)); } catch { return; }
    repaint(p, siteId);
  }

  async function weeklyOff(button) {
    const node = button.closest("[data-rd-box]"), id = Number(node.dataset.rdBox), siteId = Number(node.dataset.rdSite);
    button.disabled = true;
    try {
      await COMP.api("POST", `competitors/${id}/firecrawl/weekly`, { site_id: siteId, on: false });
    } catch (err) {
      button.disabled = false;
      U().toast(t(err.message), { kind: "error" });
      return;
    }
    U().toast(t("Weekly check stopped. Nothing more is spent."), { kind: "info" });
    const p = { id, crawl: null };
    try { Object.assign(p, await COMP.api("GET", `competitors/${id}/reading?site_id=${siteId}`)); } catch { return; }
    repaint(p, siteId);
  }

  document.addEventListener("click", (event) => {
    const askBtn = event.target.closest?.("[data-rd-ask]");
    if (askBtn) { event.stopPropagation(); ask(askBtn); return; }
    const goBtn = event.target.closest?.("[data-rd-go]");
    if (goBtn) { event.stopPropagation(); go(goBtn); return; }
    const off = event.target.closest?.("[data-rd-weekly-off]");
    if (off) { event.stopPropagation(); weeklyOff(off); return; }
    const cancel = event.target.closest?.("[data-rd-cancel]");
    if (cancel) { const panel = cancel.closest(".rd-confirm"); panel.hidden = true; U().setHTML(panel, ""); }
  }, true);

  COMP.reading = { box, follow: (c) => (c && c.status !== "blocked" ? followLine(c) : null) };

  Object.assign(window.FR = window.FR || {}, {
    "How well the app reads this site": "Ce que l'appli arrive à lire sur ce site",
    "Firecrawl can read it once connected in Settings.": "Firecrawl peut le lire une fois connecté dans les réglages.",
    "Open Settings": "Ouvrir les réglages",
    "Blocks bots: edits can't be tracked. Rankings and AI Overviews still work.": "Bloque les robots : modifications non suivies. Positions et AI Overviews fonctionnent toujours.",
    "Title changes in results still show as “probably edited”.": "Un changement de titre dans les résultats s'affiche comme « sans doute modifiée ».",
    "Firecrawl can read it when you click.": "Firecrawl peut le lire quand vous cliquez.",
    "{n} more note": "{n} autre remarque",
    "{n} more notes": "{n} autres remarques",
    "Firecrawl can read it for you, though the site asked bots not to. Only a click does it.": "Firecrawl peut le lire pour vous, même si le site demande aux robots de ne pas le faire. Seul un clic le lance.",
    "Read with Firecrawl": "Lire avec Firecrawl",
    "List all pages": "Lister toutes les pages",
    "Check for edits": "Chercher les modifications",
    "~{n} credit": "~{n} crédit", "~{n} credits": "~{n} crédits",
    "No sitemap: only the {n} page linked from its home page is watched.": "Pas de sitemap : seule {n} page liée depuis sa page d'accueil est suivie.",
    "No sitemap: only the {n} pages linked from its home page are watched.": "Pas de sitemap : seules les {n} pages liées depuis sa page d'accueil sont suivies.",
    "No sitemap: only its home page and recent posts are watched.": "Pas de sitemap : seules sa page d'accueil et ses publications récentes sont suivies.",
    "Big sitemap: {most} pages watched, ranking pages first.": "Gros sitemap : {most} pages suivies, celles qui se positionnent d'abord.",
    "First read: {tried} of ~{known} pages, {per} a day, ~{days} to go. Edits show after.": "Première lecture : {tried} sur ~{known} pages, {per} par jour, encore ~{days}. Les modifications s'affichent ensuite.",
    "{n} day": "{n} jour", "{n} days": "{n} jours",
    "No sitemap: Firecrawl listed all {n} pages {when}. List again now and then.": "Pas de sitemap : Firecrawl a listé les {n} pages {when}. Relancez de temps en temps.",
    "{n} page needs JavaScript, so its words and edits aren't seen.": "{n} page a besoin de JavaScript : ses mots et modifications ne sont pas vus.",
    "{n} pages need JavaScript, so their words and edits aren't seen.": "{n} pages ont besoin de JavaScript : leurs mots et modifications ne sont pas vus.",
    "{n} page read with Firecrawl; check it for edits now and then.": "{n} page lue avec Firecrawl ; vérifiez-la de temps en temps.",
    "{n} pages read with Firecrawl; check them for edits now and then.": "{n} pages lues avec Firecrawl ; vérifiez-les de temps en temps.",
    "Firecrawl starting…": "Firecrawl démarre…",
    "Firecrawl listing pages…": "Firecrawl liste les pages…",
    "Firecrawl is reading: {done} of {asked} pages.": "Firecrawl lit : {done} pages sur {asked}.",
    "Checking Firecrawl credits…": "Vérification des crédits Firecrawl…",
    "Nothing for Firecrawl to do now.": "Rien à faire pour Firecrawl pour l'instant.",
    "{left} of {of} credits left, until {date}.": "{left} crédits sur {of} restants, jusqu'au {date}.",
    "Firecrawl gave no credit count.": "Firecrawl n'a pas indiqué ses crédits.",
    "List all its pages with Firecrawl?": "Lister toutes ses pages avec Firecrawl ?",
    "1 credit. Found pages join the free daily read, up to 300 a day.": "1 crédit. Les pages trouvées rejoignent la lecture quotidienne gratuite, jusqu'à 300 par jour.",
    "Read these pages with Firecrawl?": "Lire ces pages avec Firecrawl ?",
    "1 credit a page; ranking pages first.": "1 crédit par page ; les pages positionnées d'abord.",
    "Check them for edits with Firecrawl?": "Chercher leurs modifications avec Firecrawl ?",
    "1 credit a page; oldest copies first. Any change shows as an edit.": "1 crédit par page ; les copies les plus anciennes d'abord. Tout changement s'affiche comme une modification.",
    "Pages to read, of {n}:": "Pages à lire, sur {n} :",
    "At most {n} pages a click.": "Au plus {n} pages par clic.",
    "List pages": "Lister les pages", "Check them": "Les vérifier", "Read them": "Les lire", "Cancel": "Annuler",
    "Firecrawl is reading. Keeps going if you leave.": "Firecrawl lit les pages. Continue même si vous quittez la page.",
    "Reads competitor sites the app can't read": "Lit les sites concurrents que l'appli ne lit pas",
    "Free, then from $16/month": "Gratuit, puis dès 16 $/mois",
    "1 credit per page read or list": "1 crédit par page lue ou liste",
    "Off without a key. Runs only when you say so, at most 50 pages a click.": "Désactivé sans clé. Ne tourne que sur votre accord, 50 pages au plus par clic.",
    "Sends competitor page addresses to Firecrawl. Nothing about your sites or leads.": "Envoie à Firecrawl les adresses des pages concurrentes. Rien sur vos sites ni vos leads.",
    "Create a free account. Monthly credits, no card needed.": "Créez un compte gratuit. Crédits chaque mois, sans carte bancaire.",
    "Open Firecrawl": "Ouvrir Firecrawl",
    "In API Keys, copy your key (it starts with fc-).": "Dans API Keys, copiez votre clé (elle commence par fc-).",
    "API Keys": "API Keys",
    "Paste it, press Test (free, shows credits), then Save.": "Collez-la, cliquez sur Tester (gratuit, affiche vos crédits), puis Enregistrer.",
    "Firecrawl refused the key. Paste it again in Settings.": "Firecrawl a refusé la clé. Collez-la à nouveau dans les réglages.",
    "Firecrawl has no credits left this month.": "Firecrawl n'a plus de crédits ce mois-ci.",
    "Connect Firecrawl in Settings first.": "Connectez d'abord Firecrawl dans les réglages.",
    "Firecrawl is already working on this site.": "Firecrawl travaille déjà sur ce site.",
    "Firecrawl's run stopped before the end. Pages read before it are saved. Try again.": "Le passage de Firecrawl s'est arrêté avant la fin. Les pages lues avant sont enregistrées. Réessayez.",
    "The last read stopped before the end. Pages read before it are saved, and it carries on at the next daily read.": "La dernière lecture s'est arrêtée avant la fin. Les pages lues avant sont enregistrées, et elle reprend à la prochaine lecture quotidienne.",
    "There's no page here that needs Firecrawl.": "Aucune page ici n'a besoin de Firecrawl.",
    "Its {n} page is read daily; edits show next morning.": "{n} page lue chaque jour ; les modifications apparaissent le lendemain.",
    "All {n} pages read daily; edits show next morning.": "Ses {n} pages sont lues chaque jour ; les modifications apparaissent le lendemain.",
    "WordPress lists each edit, so edited pages are read the same night.": "WordPress liste chaque modification : les pages modifiées sont lues la nuit même.",
    "Its sitemap dates edits, so edited pages are read the same night.": "Son sitemap date les modifications : les pages modifiées sont lues la nuit même.",
    "Its sitemap doesn't date edits, so: your top {top} and main pages daily, other ranking or recently edited pages every {few} days, the rest every {rest}.": "Son sitemap ne date pas les modifications : votre top {top} et ses pages principales chaque jour, ses autres pages positionnées ou modifiées récemment tous les {few} jours, le reste tous les {rest}.",
    "Check weekly": "Vérifier chaque semaine",
    "all pages daily": "toutes les pages chaque jour", "WordPress lists its edits": "WordPress liste ses modifications",
    "sitemap dates edits": "le sitemap date les modifications", "ranking pages daily, the rest every {rest}": "pages positionnées chaque jour, le reste tous les {rest}",
    "Stop weekly check": "Arrêter la vérification hebdomadaire",
    "{n} page read with Firecrawl; checked weekly if it ranks.": "{n} page lue avec Firecrawl ; vérifiée chaque semaine si elle se positionne.",
    "{n} pages read with Firecrawl; ranking ones checked weekly.": "{n} pages lues avec Firecrawl ; celles positionnées sont vérifiées chaque semaine.",
    "Check them weekly with Firecrawl?": "Les vérifier chaque semaine avec Firecrawl ?",
    "Ranking pages only, 1 credit each, weekly. Stop it here any time.": "Seulement les pages positionnées, 1 crédit chacune, chaque semaine. Arrêtez ici quand vous voulez.",
    "{n} page, ~{n} credit a week.": "{n} page, ~{n} crédit par semaine.",
    "{n} pages, ~{n} credits a week.": "{n} pages, ~{n} crédits par semaine.",
    "Yes, every week": "Oui, chaque semaine",
    "Done. Firecrawl checks them weekly from tonight.": "C'est fait. Firecrawl les vérifie chaque semaine dès cette nuit.",
    "Weekly check stopped. Nothing more is spent.": "Vérification hebdomadaire arrêtée. Plus rien n'est dépensé.",
    "None of the pages Firecrawl read ranks for your keywords, so there's nothing to check each week.": "Aucune des pages lues par Firecrawl ne se positionne sur vos mots-clés : il n'y a rien à vérifier chaque semaine.",
  });
})();
