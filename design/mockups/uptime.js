/* Site health's Uptime tab: is each of my sites up, and when do its certificate and domain name run out.
   Plugged in through window.UptimeWatch (see healthPage and render in mockup.js). Talks through COMP.api, which answers from
   comp-sample-data.js when the page is opened as a plain file. Unknown is shown as unknown: never as up. */
(() => {
  "use strict";
  const COMP = window.COMP;
  let UI = null;
  const POLL_MS = 1500, POLL_LIMIT_MS = 90000;
  const up = { started: false, ready: false, failed: "", sites: [], every: 15, staleAfter: 45, alertDays: 14, checking: new Set(), timers: new Map() };

  const WHY = {
    never_checked: "Not checked yet. On the live site this runs by itself. On this Mac, only when you press Run.",
    too_old: "The last check is too old to say. Nothing has checked this site lately.",
    not_watching: "You turned off watching for this site, so nobody knows.",
    turned_away: "The site turned the app away, so this check can't tell whether it's up.",
    robots: "Its robots.txt doesn't let the app read the start page, so this check can't tell whether it's up.",
    rate_limited: "The site asked the app to slow down, so this check can't tell whether it's up.",
    our_connection: "This computer couldn't reach the internet, so this says nothing about the site.",
    refused: "That address isn't a public website, so it wasn't read.",
    server_error: "The server answered with an error.",
    page_error: "The start page answered with an error.",
    no_answer: "The site didn't answer, twice.",
    redirect_loop: "The start page redirects too many times.",
  };
  const OUTAGE_WORDS = { server_error: "Server error", page_error: "Page error", no_answer: "No answer", redirect_loop: "Too many redirects" };

  const stateChip = (s) => {
    const { t, status, icon } = UI;
    if (s.state === "up") return status("good", t("Online"));
    if (s.state === "down") return status("crit", t("Offline"));
    return `<span class="status sec">${icon("shield-question")}${t("Unknown")}</span>`;
  };
  const expiryChip = (e) => {
    const { t, status } = UI;
    if (e.state === "expired") return status("crit", t("Expired"));
    if (e.state === "expiring") return status("warn", `${e.days_left} ${t(e.days_left === 1 ? "day left" : "days left")}`);
    if (e.state === "ok") return status("good", t("OK"));
    return "";
  };
  const ago = (iso) => (iso ? UI.fmtStamp(iso) : "—");

  function certificateFact(s) {
    const { t, esc, fmtDateOnly } = UI, c = s.certificate;
    if (!c.https) return fact(t("Security certificate"), `<span class="muted">—</span>`, t("This site doesn't use HTTPS."));
    if (c.problem === "untrusted") return fact(t("Security certificate"), UI.status("crit", t("Can't be verified")), t("Browsers will warn visitors about this site."));
    if (!c.expires) return fact(t("Security certificate"), `<span class="muted">${t("Unknown")}</span>`, t(c.checked_at ? "It couldn't be read." : "Not read yet."));
    return fact(t("Security certificate"), `<span class="small-v">${esc(fmtDateOnly(c.expires))}</span>`, `${expiryChip(c)} ${c.checked_at ? `<span>${t("Read on")} ${esc(ago(c.checked_at))}</span>` : ""}`);
  }

  function domainFact(s) {
    const { t, esc, fmtDateOnly, icon } = UI, d = s.domain;
    const form = `<form class="up-date" data-up-date="${s.id}" novalidate>
        <input class="input" type="date" aria-label="${t("Domain expiry date")}: ${esc(s.host)}" value="${d.source === "manual" && d.expires ? esc(d.expires) : ""}">
        <button class="btn btn-small" type="submit">${t(d.source === "manual" ? "Change date" : "Save date")}</button>
        ${d.source === "manual" ? `<button class="btn btn-small btn-ghost" type="button" data-up-date-clear="${s.id}">${icon("x")}${t("Clear")}</button>` : ""}
        <div class="error" role="alert" data-up-date-err hidden></div></form>`;
    const showForm = d.problem === "no_rdap" || d.source === "manual";
    const where = d.source === "manual" ? t("Entered by hand. Change it after each renewal.") : d.problem === "no_rdap" ? t("This domain's ending has no public date. Enter it by hand to get a warning before it runs out.") : d.problem === "rdap_failed" ? t("The registry didn't answer this time, so this is the last date known.") : d.source === "rdap" ? t("From the domain registry") : t("Not read yet.");
    const value = d.expires ? `<span class="small-v">${esc(fmtDateOnly(d.expires))}</span>` : `<span class="muted">${t("Unknown")}</span>`;
    return fact(`${t("Domain name")} <span class="mono">${esc(d.name)}</span>`, value, `${expiryChip(d)} <span>${where}</span>${showForm ? form : ""}`);
  }

  const fact = (label, value, sub = "") => `<div class="up-fact"><div class="k">${label}</div><div class="v">${value}</div><div class="s">${sub}</div></div>`;

  function strip(s) {
    const { t, esc, num, fmtDateOnly } = UI;
    const dayTip = (d) => `${fmtDateOnly(d.day)}: ${d.state === "up" ? t("Online") : d.state === "down" ? `${t("Offline")} (${num(d.down)} ${t("of")} ${num(d.up + d.down)} ${t("checks")})` : t("Not watched")}`;
    return `<div class="up-strip-wrap"><div class="up-strip" role="img" aria-label="${t("Last 30 days")}: ${num(s.days.filter((d) => d.state === "up").length)} ${t("online")}, ${num(s.days.filter((d) => d.state === "down").length)} ${t("with an outage")}, ${num(s.days_not_watched)} ${t("not watched")}">
      ${s.days.map((d) => `<span class="up-day ${d.state === "unknown" ? "" : esc(d.state)}" data-tip="${esc(dayTip(d))}"></span>`).join("")}</div>
      <div class="up-legend"><span>${esc(fmtDateOnly(s.days[0].day))}</span><span class="keys"><span><i class="up-day up"></i>${t("Online")}</span><span><i class="up-day down"></i>${t("Outage")}</span><span><i class="up-day"></i>${t("Not watched")}</span></span><span>${esc(fmtDateOnly(s.days[s.days.length - 1].day))}</span></div></div>`;
  }

  function outages(s) {
    const { t, esc, num } = UI;
    if (!s.incidents.length) return "";
    return `<div class="up-outages"><h3>${t("Outages seen")}</h3><ul>${s.incidents.map((i) => `<li>
      ${i.ended_at ? UI.status("info", t("Ended")) : UI.status("crit", t("Still down"))}
      <span class="tabular">${esc(ago(i.started_at))}</span>
      <span class="tabular">${num(i.minutes)} min</span>
      <span>${esc(t(OUTAGE_WORDS[i.reason] || "Outage"))}${i.http_status ? ` <span class="mono">(${esc(i.http_status)})</span>` : ""}</span></li>`).join("")}</ul></div>`;
  }

  function card(s) {
    const { t, esc, num, icon, siteLogo } = UI;
    const busy = up.checking.has(s.id);
    const why = s.reason && WHY[s.reason] ? `<p class="up-why">${t(WHY[s.reason])}${s.http_status && s.state === "down" ? ` <span class="mono">(${esc(s.http_status)})</span>` : ""}</p>` : "";
    const percent = s.uptime_percent === null ? `<span class="muted">—</span>` : `${UI.dec(s.uptime_percent)}%`;
    const percentSub = s.uptime_percent === null ? t("No checks yet in the last 30 days") : `${t("Only counts the days it was watched.")} ${s.days_not_watched ? `${num(s.days_not_watched)} ${t("of")} 30 ${t(s.days_not_watched === 1 ? "day not watched" : "days not watched")}.` : ""}`;
    return `<section class="card up-card" data-up-site="${s.id}">
      <div class="up-head">
        <span class="up-host">${siteLogo(s.host)}<span class="mono">${esc(s.host)}</span></span>
        ${stateChip(s)}
        <span class="small sec">${s.last_checked_at ? `${t("Last check")} ${esc(ago(s.last_checked_at))}` : t("Never checked")}</span>
        <span class="end">
          <label class="opt small"><input type="checkbox" class="chk" style="margin:0" data-up-watch="${s.id}" ${s.watching ? "checked" : ""}>${t("Watch this site")}</label>
          <button class="btn btn-small" data-up-check="${s.id}" ${busy ? "disabled" : ""}>${icon("refresh-cw", busy ? "spin" : "")}${t(busy ? "Checking…" : s.last_checked_at ? "Run again" : "Run")}</button>
        </span>
      </div>
      ${why}
      <div class="up-grid">
        ${fact(t("Online, last 30 days"), percent, percentSub)}
        ${certificateFact(s)}
        ${domainFact(s)}
      </div>
      ${strip(s)}
      ${outages(s)}
    </section>`;
  }

  function view() {
    const { t, esc, icon } = UI;
    if (up.failed) return UI.failCard ? UI.failCard(up.failed, { onRetry: () => { up.failed = ""; up.ready = false; paint(); load(); } }) : `<div class="table-wrap"><div class="empty"><h3>${t("That didn't load")}</h3><p>${esc(t(up.failed))}</p></div></div>`;
    if (!up.ready) return UI.skeleton ? UI.skeleton("rows", { rows: 3 }) : `<div class="card"><div class="empty"><p>${t("Loading…")}</p></div></div>`;
    if (!up.sites.length) return `<div class="table-wrap"><div class="empty"><h3>${t("No sites added yet")}</h3><p>${t("Add your own site, then watch whether it's up.")}</p><button class="btn btn-main" id="site-add">${icon("plus")}${t("Add a site")}</button></div></div>`;
    const picked = UI.siteHostPicked();
    const shown = picked ? up.sites.filter((s) => s.host === picked) : up.sites;
    const rule = `<p class="note up-rule">${icon("info")}<span>${t("On the live site each site is read every {every} minutes. After {stale} minutes with no check it shows as Unknown, never as Online.").replace("{every}", up.every).replace("{stale}", up.staleAfter)} ${t("Certificates and domain names warn you {days} days before they run out.").replace("{days}", up.alertDays)}</span></p>`;
    const order = { down: 0, unknown: 1, up: 2 };
    const sorted = [...shown].sort((a, b) => order[a.state] - order[b.state] || a.host.localeCompare(b.host));
    const banners = sorted.map((s) => window.HealthTest?.bannersFor?.(s.id, ["uptime_down", "ssl_expiry", "domain_expiry"]) || "").join("");
    return rule + banners + (shown.length ? sorted.map(card).join("") : `<div class="table-wrap"><div class="empty"><p>${t("This site isn't one of your own sites.")}</p></div></div>`);
  }

  /* A check finishing or an alert arriving redraws this tab, and that must never wipe a date being typed or lose someone's place. */
  const paint = ({ keepTyped = true } = {}) => {
    const box = UI.$("#up-body");
    if (!box) return;
    const typed = new Map(UI.$$("[data-up-date]", box).map((form) => [form.dataset.upDate, form.querySelector("input").value]));
    const active = document.activeElement;
    const place = box.contains(active) ? ["data-up-watch", "data-up-check", "data-up-date-clear"].find((name) => active.hasAttribute(name)) : null;
    const inForm = box.contains(active) ? active.closest("[data-up-date]") : null;
    const spot = place ? `[${place}="${active.getAttribute(place)}"]` : inForm ? `[data-up-date="${inForm.dataset.upDate}"] ${active.tagName === "INPUT" ? "input" : "button[type=submit]"}` : null;
    UI.setHTML(box, view());
    if (keepTyped) UI.$$("[data-up-date]", box).forEach((form) => { const value = typed.get(form.dataset.upDate); if (value) form.querySelector("input").value = value; });
    if (spot) box.querySelector(spot)?.focus();
  };

  /* Read again when what's shown is over 2 minutes old: on coming back to the tab, and every minute while it's on screen (F120).
     A tab opened at 9:00 must not still say "Online" at 15:00 for a site that went down at 11:00. */
  const FRESH_MS = 120000;
  const stale = () => up.started && !up.loading && Date.now() - (up.loadedAt || 0) > FRESH_MS;
  const onScreen = () => document.visibilityState !== "hidden" && !!UI?.$("#up-body");
  function keepFresh() {
    // The shared poll pauses while the browser tab is hidden and looks again as soon as it shows.
    const watch = () => COMP.poll(async () => { if (onScreen() && stale()) await load(); return true; }, { every: 60000, slowest: 300000, most: 24 * 3600000, onEnd: (why) => { if (why === "ceiling") watch(); } });
    watch();
  }

  async function load() {
    up.loading = true;
    try {
      const answer = await COMP.api("GET", "uptime/sites");
      up.sites = answer.sites; up.every = answer.every_minutes; up.staleAfter = answer.unknown_after_minutes; up.alertDays = answer.alert_days;
      up.failed = "";
    } catch (err) { up.failed = err.message; }
    up.loading = false; up.loadedAt = Date.now(); // a failure waits as long as an answer, so a slow server isn't asked without end
    up.ready = true;
    paint();
  }

  const replace = (answer, opts) => { up.sites = up.sites.map((s) => (s.id === answer.id ? answer : s)); paint(opts); };

  async function checkNow(id) {
    if (up.checking.has(id)) return;
    const before = up.sites.find((s) => s.id === id)?.last_checked_at;
    up.checking.add(id);
    paint();
    const stop = (message, kind = "info") => {
      clearTimeout(up.timers.get(id));
      up.timers.delete(id);
      up.checking.delete(id);
      paint();
      if (message) UI.toast(message, { kind });
      UI.$(`[data-up-check="${id}"]`)?.focus();
    };
    try { await COMP.api("POST", `uptime/sites/${id}/check`, {}); } catch (err) { stop(UI.t(err.message), "crit"); return; }
    const started = Date.now();
    const poll = async () => {
      try {
        const answer = await COMP.api("GET", "uptime/sites");
        up.sites = answer.sites;
      } catch { /* the next try may work */ }
      const now = up.sites.find((s) => s.id === id);
      if (now && now.last_checked_at !== before) {
        window.HealthTest?.reloadAlerts?.();
        stop(`${now.host}: ${UI.t(now.state === "up" ? "Online" : now.state === "down" ? "Offline" : "Unknown")}`, now.state === "down" ? "crit" : "info");
        return;
      }
      if (Date.now() - started > POLL_LIMIT_MS) { stop(UI.t("The check is still waiting its turn. Come back in a moment.")); return; }
      up.timers.set(id, setTimeout(poll, POLL_MS));
    };
    up.timers.set(id, setTimeout(poll, POLL_MS));

  }

  function bind() {
    document.addEventListener("click", (e) => {
      const target = e.target;
      let el;
      if (target.closest?.("[data-up-retry]")) { up.failed = ""; up.ready = false; paint(); load(); return; }
      if ((el = target.closest?.("[data-up-check]"))) { checkNow(Number(el.dataset.upCheck) || el.dataset.upCheck); return; }
      if ((el = target.closest?.("[data-up-date-clear]"))) {
        const id = Number(el.dataset.upDateClear);
        COMP.api("PATCH", `uptime/sites/${id}`, { domain_expires_on: null }).then((answer) => { replace(answer, { keepTyped: false }); window.HealthTest?.reloadAlerts?.(); UI.toast(UI.t("Date cleared"), { kind: "info" }); }).catch(COMP.fail);
      }
    });
    document.addEventListener("change", (e) => {
      const el = e.target;
      if (!el.dataset?.upWatch) return;
      const id = Number(el.dataset.upWatch), on = el.checked;
      COMP.api("PATCH", `uptime/sites/${id}`, { watching: on }).then((answer) => { replace(answer); UI.toast(UI.t(on ? "This site is being watched" : "No longer watching this site"), { kind: "info" }); }).catch((err) => { el.checked = !on; COMP.fail(err); });
    });
    document.addEventListener("submit", (e) => {
      const form = e.target.closest?.("[data-up-date]");
      if (!form) return;
      const id = Number(form.dataset.upDate), box = form.querySelector("input"), err = form.querySelector("[data-up-date-err]");
      const fail = (words) => { UI.setHTML(err, `${UI.icon("octagon-alert")}<span>${UI.esc(UI.t(words))}</span>`); err.hidden = false; box.focus(); };
      if (!box.value) { fail("Choose the date first."); return; }
      COMP.api("PATCH", `uptime/sites/${id}`, { domain_expires_on: box.value }).then((answer) => { replace(answer, { keepTyped: false }); window.HealthTest?.reloadAlerts?.(); UI.toast(UI.t("Date saved"), { kind: "info" }); }).catch((failure) => fail(failure.message));
    });
    window.addEventListener("seocc:site-added", (e) => { if (e.detail?.kind === "own" && up.started) load(); });
  }

  /* Opened as a plain file: nothing is read, and the sample's answers change on screen. */
  function sampleWrites() {
    const sites = () => window.COMP_SAMPLE?.get?.["uptime/sites"]?.sites || [];
    const find = (id) => { const s = sites().find((x) => String(x.id) === String(id)); if (!s) throw Object.assign(new Error("That website doesn't exist."), { status: 404 }); return s; };
    COMP.sampleWrite("POST uptime/sites/([^/]+)/check", (match) => { const s = find(match[1]); s.last_checked_at = new Date().toISOString().replace(/\.\d+Z$/, "Z"); if (s.watching && s.state === "unknown") { s.state = "up"; s.reason = null; } return { queued: true }; });
    COMP.sampleWrite("PATCH uptime/sites/([^/]+)", (match, body) => {
      const s = find(match[1]);
      if (body.watching !== undefined) { s.watching = body.watching; if (!s.watching) { s.state = "unknown"; s.reason = "not_watching"; } else if (s.reason === "not_watching") { s.state = "up"; s.reason = null; } }
      if ("domain_expires_on" in body) {
        const value = body.domain_expires_on;
        if (value) {
          const left = Math.round((new Date(value) - new Date()) / 86400000);
          Object.assign(s.domain, { expires: value, source: "manual", problem: null, days_left: left, state: left < 0 ? "expired" : left <= 14 ? "expiring" : "ok" });
        } else Object.assign(s.domain, { expires: null, source: null, problem: "no_rdap", days_left: null, state: "unknown" });
      }
      return { ...s };
    });
  }

  window.UptimeWatch = {
    init(helpers) { UI = helpers; bind(); sampleWrites(); keepFresh(); },
    body: () => `<div id="up-body">${view()}</div>`,
    after() { if (!up.started) { up.started = true; load(); } else if (stale()) load(); },
    paint,
    openProblems: () => up.sites.filter((s) => s.state === "down").length,
  };

  const fr = {
    "Uptime": "Disponibilité", "Online": "En ligne", "Offline": "Hors ligne", "Unknown": "Inconnu", "Expired": "Expiré", "OK": "OK", "day left": "jour restant", "days left": "jours restants",
    "Security certificate": "Certificat de sécurité", "This site doesn't use HTTPS.": "Ce site n'utilise pas HTTPS.", "Can't be verified": "Impossible à vérifier", "Browsers will warn visitors about this site.": "Les navigateurs avertiront les visiteurs de ce site.",
    "It couldn't be read.": "Il n'a pas pu être lu.", "Not read yet.": "Pas encore lu.", "Read on": "Lu le", "Domain name": "Nom de domaine", "Domain expiry date": "Date d'expiration du domaine",
    "Change date": "Modifier la date", "Save date": "Enregistrer la date", "Clear": "Effacer", "Entered by hand. Change it after each renewal.": "Saisie à la main. Modifiez-la après chaque renouvellement.",
    "This domain's ending has no public date. Enter it by hand to get a warning before it runs out.": "Cette extension de domaine n'a pas de date publique. Saisissez-la à la main pour être prévenu avant l'expiration.",
    "The registry didn't answer this time, so this is the last date known.": "Le registre n'a pas répondu cette fois : c'est la dernière date connue.", "From the domain registry": "Depuis le registre du domaine",
    "Last 30 days": "30 derniers jours", "online": "en ligne", "with an outage": "avec une panne", "not watched": "non surveillés", "Not watched": "Non surveillé", "Outage": "Panne",
    "Outages seen": "Pannes constatées", "Ended": "Terminée", "Still down": "Toujours hors ligne", "Server error": "Erreur du serveur", "Page error": "Erreur de page", "No answer": "Pas de réponse", "Too many redirects": "Trop de redirections",
    "No checks yet in the last 30 days": "Aucun contrôle sur les 30 derniers jours", "Only counts the days it was watched.": "Ne compte que les jours surveillés.", "day not watched": "jour non surveillé", "days not watched": "jours non surveillés",
    "Last check": "Dernier contrôle", "Never checked": "Jamais contrôlé", "Watch this site": "Surveiller ce site", "Checking…": "Contrôle en cours…", "Run": "Lancer", "Run again": "Relancer", "Online, last 30 days": "En ligne, 30 derniers jours",
    "Add your own site, then watch whether it's up.": "Ajoutez votre site, puis surveillez sa disponibilité.", "This site isn't one of your own sites.": "Ce site ne fait pas partie de vos sites.",
    "On the live site each site is read every {every} minutes. After {stale} minutes with no check it shows as Unknown, never as Online.": "Sur le site en ligne, chaque site est lu toutes les {every} minutes. Après {stale} minutes sans contrôle, il s'affiche comme Inconnu, jamais comme En ligne.",
    "Certificates and domain names warn you {days} days before they run out.": "Les certificats et noms de domaine vous préviennent {days} jours avant l'expiration.",
    "Not checked yet. On the live site this runs by itself. On this Mac, only when you press Run.": "Pas encore contrôlé. Sur le site en ligne, cela tourne tout seul. Sur ce Mac, seulement quand vous appuyez sur Lancer.",
    "The last check is too old to say. Nothing has checked this site lately.": "Le dernier contrôle est trop ancien pour le dire. Rien n'a contrôlé ce site récemment.", "You turned off watching for this site, so nobody knows.": "Vous avez désactivé la surveillance de ce site : personne ne le sait.",
    "The site turned the app away, so this check can't tell whether it's up.": "Le site a refusé l'application : ce contrôle ne peut pas dire s'il est en ligne.", "Its robots.txt doesn't let the app read the start page, so this check can't tell whether it's up.": "Son robots.txt ne laisse pas l'application lire la page d'accueil : ce contrôle ne peut pas dire s'il est en ligne.",
    "The site asked the app to slow down, so this check can't tell whether it's up.": "Le site a demandé à l'application de ralentir : ce contrôle ne peut pas dire s'il est en ligne.", "This computer couldn't reach the internet, so this says nothing about the site.": "Cet ordinateur n'a pas pu accéder à internet : cela ne dit rien sur le site.",
    "That address isn't a public website, so it wasn't read.": "Cette adresse n'est pas un site public : elle n'a pas été lue.", "The server answered with an error.": "Le serveur a répondu par une erreur.", "The start page answered with an error.": "La page d'accueil a répondu par une erreur.",
    "The site didn't answer, twice.": "Le site n'a pas répondu, deux fois.", "The start page redirects too many times.": "La page d'accueil redirige trop de fois.", "The check is still waiting its turn. Come back in a moment.": "Le contrôle attend son tour. Revenez dans un instant.",
    "Date cleared": "Date effacée", "Date saved": "Date enregistrée", "Choose the date first.": "Choisissez d'abord la date.", "Enter the date as YYYY-MM-DD.": "Saisissez la date au format AAAA-MM-JJ.",
    "This site is being watched": "Ce site est surveillé", "No longer watching this site": "Ce site n'est plus surveillé", "Uptime is only watched on your own websites.": "La disponibilité n'est surveillée que sur vos propres sites.",
  };
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
