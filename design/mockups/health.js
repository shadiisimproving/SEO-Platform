/* Site health: the monthly health test, its alert banners, and the same alerts on Today.

   Plugged in through window.HealthTest (see healthPage and render in mockup.js). body() returns straight away and
   after() fills it in. While a test runs, only the numbers change, so focus isn't lost. It talks through COMP.api,
   which answers from comp-sample-data.js when the page is opened as a plain file.
   The test only ever looks at my own websites, from a site ID. No AI anywhere here. */
(() => {
  "use strict";
  const COMP = window.COMP;
  let UI = null;
  const POLL_MS = 1500;

  // The same plain words as seo/health/audit.py, so an alert can say them without loading its whole test.
  const CHECK_WORDS = {
    broken_pages: "Error pages", broken_links: "Broken links", server_errors: "Server errors",
    noindex: "Hidden from search engines", canonical_elsewhere: "Canonical points elsewhere", no_title: "No title",
    duplicate_title: "Duplicate titles", no_h1: "No main heading (H1)", many_h1: "Several main headings",
    no_meta: "No meta description", duplicate_meta: "Duplicate meta descriptions", images_no_alt: "Images missing alt text",
    almost_no_text: "Almost no text", redirect_chains: "More than 2 redirects", slow_pages: "Slower than 5 seconds", robots_blocked: "Blocked by robots.txt",
    // The sitemap checks (seo/health/audit.py SITEMAP_CHECKS), shown in their own card
    sitemap_missing: "No sitemap found", sitemap_unreachable: "Sitemap can't be reached", sitemap_invalid: "Sitemap isn't valid XML",
    sitemap_too_big: "Sitemap over 50,000 pages or 50 MB", sitemap_not_in_robots: "Sitemap not named in robots.txt",
    listed_broken: "Listed pages that give an error", listed_redirect: "Listed pages that redirect", listed_noindex: "Listed pages hidden from search engines",
    listed_blocked: "Listed pages blocked by robots.txt", listed_canonical: "Listed pages whose canonical points elsewhere",
    sitemap_missing_pages: "Important pages missing from the sitemap", lastmod_future: "Dates in the future", lastmod_same: "Every page has the same date",
  };
  const SITE_WORDS = {
    start_page_down: "Start page didn't load", start_page_noindex: "Start page hidden from search engines", ssl_expired: "Certificate expired",
    ssl_expiring: "Certificate expires within 14 days", ssl_error: "Certificate couldn't be verified",
  };
  const SEVERITY = { crit: "Critical", warn: "Warning", info: "Info" };
  const UPTIME_KINDS = ["uptime_down", "ssl_expiry", "domain_expiry"];
  const isTestAlert = (a) => a.kind.startsWith("health_");

  const ht = {
    started: false, ready: false, failed: "", server: null, firstRun: null, sites: [], siteId: null, added: [], alerts: [], audits: [], open: null, activeId: null, active: null,
    timer: null, stopping: false, openChecks: new Set(), lastPicked: null, sorts: {},
  };
  /* The tables' pages and search (table-pages.js), like every long table in the app (2026-11-10). */
  const PAGES = { index: "ht-not-indexed", few: "ht-few-links", linksIn: "ht-links-in", history: "ht-history" };
  const SM_CODES = ["sitemap_missing", "sitemap_unreachable", "sitemap_invalid", "sitemap_too_big", "sitemap_not_in_robots", "listed_broken", "listed_redirect",
    "listed_noindex", "listed_blocked", "listed_canonical", "sitemap_missing_pages", "lastmod_future", "lastmod_same"];
  const smKey = (code) => `ht-sm-${code}`; // each problem's list has its own pages and search (table-pages.js)
  const isActive = (a) => a.status === "queued" || a.status === "running";
  const isPartial = (a) => a.status === "stopped";
  const site = () => ht.sites.find((s) => String(s.id) === String(ht.siteId)) || null;
  const sameId = (a, b) => String(a) === String(b);
  const hidingSample = () => ht.server === false && UI.state.firstRun; // the mockup's "First run" view, as a plain file

  const fmtDayMonth = (iso) => new Intl.DateTimeFormat(UI.locale(), { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso)).replace(/\.$/, ""); // French months end in a full stop, and so does the sentence

  // ---- alerts: on this screen, in the menu, and on Today ----------------------------------------
  const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  const openAlerts = () => (UI && hidingSample() ? [] : ht.alerts.filter((a) => !a.seen));

  /* The server writes titles in English. French comes from what the alert says, so it can be switched to at any time. */
  function frenchTitle(a) {
    const d = a.detail || {}, fr = window.FR;
    if (a.kind === "health_drop") return `${a.host} : la santé est passée de ${d.before} à ${d.after}`;
    if (a.kind === "health_low") return `${a.host} : la santé est basse, à ${d.after}`;
    if (a.kind === "health_site" && d.site?.[0]) return `${a.host} : ${lowerFirst(fr[SITE_WORDS[d.site[0]]] || SITE_WORDS[d.site[0]])}`;
    if (a.kind === "health_failed") return `${a.host} : le test de santé n'a pas pu se terminer`;
    if (a.kind === "uptime_down") return d.state === "back" ? `${a.host} a été hors ligne ${d.minutes} min et répond de nouveau` : `${a.host} est hors ligne`;
    if (a.kind === "ssl_expiry") return d.state === "expired" ? `${a.host} : le certificat de sécurité a expiré` : `${a.host} : le certificat de sécurité expire le ${d.expires}`;
    if (a.kind === "domain_expiry") return d.state === "expired" ? `${a.host} : le nom de domaine a expiré` : `${a.host} : le nom de domaine expire le ${d.expires}`;
    if (a.kind === "backlink_lost") return d.count === 1 ? `${a.host} : un backlink a été perdu` : `${a.host} : ${d.count} backlinks ont été perdus`;
    if (a.kind === "backlink_changed") return d.count === 1 ? `${a.host} : un backlink a changé` : `${a.host} : ${d.count} backlinks ont changé`;
    return a.title;
  }

  /* A short plain sentence for Today, in both languages. */
  function shortDetail(a) {
    const d = a.detail || {}, fr = window.FR, name = "Health test.", nameFr = fr[name];
    if (a.kind === "uptime_down") return d.state === "back" ? ["Uptime. It's back up, but check what happened.", "Disponibilité. Il répond de nouveau, mais vérifiez ce qui s'est passé."] : ["Uptime. Visitors can't reach this site right now.", "Disponibilité. Les visiteurs ne peuvent pas accéder à ce site pour l'instant."];
    if (a.kind === "ssl_expiry") return ["Uptime. Browsers warn visitors once a certificate runs out. Renew it.", "Disponibilité. Les navigateurs avertissent les visiteurs quand un certificat expire. Renouvelez-le."];
    if (a.kind === "domain_expiry") return ["Uptime. The site stops working if the domain name runs out. Renew it.", "Disponibilité. Le site cesse de fonctionner si le nom de domaine expire. Renouvelez-le."];
    if (a.kind === "backlink_lost") return ["Backlinks. The monthly check no longer finds the link on the page.", "Backlinks. Le contrôle mensuel ne trouve plus le lien sur la page."];
    if (a.kind === "backlink_changed") return ["Backlinks. The anchor text or nofollow changed on a live link.", "Backlinks. L'ancre ou le nofollow a changé sur un lien actif."];
    const worse = d.worse || [];
    if (worse.length) {
      const w = worse[0], words = CHECK_WORDS[w.code] || w.code, more = worse.length - 1;
      const en = `${name} ${words} ${w.before} → ${w.after}.${more ? ` ${more} more got worse.` : ""}`;
      return [en, `${nameFr} ${fr[words] || words} ${w.before} → ${w.after}.${more ? ` ${more} autres se sont aggravés.` : ""}`];
    }
    // The title already says what's wrong, so this says why it matters.
    if (d.site?.length) {
      const why = d.site[0].startsWith("ssl") ? ["Browsers warn visitors once a certificate runs out. Renew it.", "Les navigateurs avertissent les visiteurs quand un certificat expire. Renouvelez-le."] : ["Visitors or search engines can't reach the start page properly.", "Les visiteurs ou les moteurs de recherche n'accèdent pas correctement à la page d'accueil."];
      return [`${name} ${why[0]}`, `${nameFr} ${why[1]}`];
    }
    if (d.after !== undefined) return [`${name} Score ${d.after} out of 100.`, `${nameFr} Score de ${d.after} sur 100.`];
    return [`${name} It couldn't finish. Try it again.`, `${nameFr} Il n'a pas pu se terminer. Relancez-le.`];
  }

  /* Today's list stays in severity order, with the real alerts first within each severity. */
  /* Sample Today only. On the real app the server ranks the list (seo/metrics/today.py), with the same order. */
  const rankOf = (a) => {
    const d = a.detail || {};
    if (a.kind === "uptime_down") return d.state === "back" ? 5 : 1;
    if (a.kind === "ssl_expiry" || a.kind === "domain_expiry") return a.severity === "crit" ? 1 : 3;
    if (a.kind === "health_site") return (d.site || []).some((code) => code !== "ssl_expiring") ? 1 : 3;
    if (a.kind === "backlink_lost") return 2;
    return 5;
  };
  function syncAttention() {
    if (window.BOOT) return; // today-live.js fills this from the server's list, so the menu count matches the rows
    const mine = openAlerts().map((a) => {
      const [detail, detailFr] = shortDetail(a);
      window.FR[a.title] = frenchTitle(a);
      window.FR[detail] = detailFr;
      return { id: `alert-${a.id}`, rank: rankOf(a), sev: a.severity === "crit" ? "crit" : "warn", title: a.title, detail, act: "Review", key: a.kind.startsWith("backlink_") ? "backlinks" : UPTIME_KINDS.includes(a.kind) ? "uptime" : "health", host: ht.sites.find((s) => sameId(s.id, a.site_id))?.host || a.host || a.site_host || (String(a.title).split(":")[0].includes(".") ? String(a.title).split(":")[0] : undefined) };
    });
    const rest = window.ATTENTION.filter((x) => !String(x.id).startsWith("alert-"));
    const pick = (list, sev) => list.filter((x) => x.sev === sev);
    window.ATTENTION.splice(0, window.ATTENTION.length, ...pick(mine, "crit"), ...pick(rest, "crit"), ...pick(mine, "warn"), ...pick(rest, "warn"), ...rest.filter((x) => x.sev !== "crit" && x.sev !== "warn"));
  }

  /* The counts in the menu, without redrawing a page someone may be typing in. */
  function paintBadges() {
    const put = (route, count, label) => {
      const item = UI.$(`.nav-item[data-go="${route}"]`);
      if (!item) return;
      item.querySelector(".count")?.remove();
      if (count) item.append(UI.fragment(`<span class="count" aria-label="${count} ${UI.esc(label)}">${count}</span>`));
    };
    const label = UI.t("Needs attention");
    put("health", openAlerts().filter((a) => !a.kind.startsWith("backlink_")).length, label);
    put("today", UI.state.firstRun ? 0 : window.ATTENTION.filter((a) => !UI.state.seen.has(a.id) && (a.sev === "crit" || a.sev === "warn")).length, label);
  }

  function refreshAlertViews() {
    syncAttention();
    window.dispatchEvent(new Event("seocc:alerts-changed"));
    if (UI.state.route === "today") UI.render();
    else if (UI.state.route === "health" && UI.state.healthTab === "test") { paint(); paintBadges(); } else { if (UI.state.route === "health" && UI.state.healthTab === "uptime") window.UptimeWatch?.paint?.(); paintBadges(); }
  }

  async function loadAlerts({ quiet = false } = {}) {
    ht.alertsAt = Date.now();
    try {
      const answer = await COMP.api("GET", "alerts");
      const fresh = answer.alerts || [];
      if (quiet && JSON.stringify(fresh) === JSON.stringify(ht.alerts)) return; // nothing new: no redraw anywhere
      ht.alerts = fresh;
    } catch { return; } // the page still works, and the next test tries again
    refreshAlertViews();
  }

  /* The banners were read once per page load (F120). Read again when they're over 2 minutes old: on coming back to the
     browser tab, and every minute while the tab is open on screen. Only a change redraws anything. */
  function keepAlertsFresh() {
    const due = () => ht.server && Date.now() - (ht.alertsAt || 0) > 120000;
    // COMP.poll pauses while the browser tab is hidden and looks again as soon as it shows. Kept going for the whole day.
    const watch = () => COMP.poll(async () => { if (due()) await loadAlerts({ quiet: true }); return true; }, { every: 60000, slowest: 300000, most: 24 * 3600000, onEnd: (why) => { if (why === "ceiling") watch(); } });
    watch();
  }

  function setSeen(id, seen) {
    const alert = ht.alerts.find((a) => a.id === id);
    if (alert) alert.seen = seen;
    syncAttention();
    return COMP.api("POST", `alerts/${id}/seen`, { seen }).catch((err) => {
      if (alert) alert.seen = !seen;
      if (seen) UI.state.seen.delete(`alert-${id}`); else UI.state.seen.add(`alert-${id}`);
      refreshAlertViews();
      COMP.fail(err);
    });
  }

  function markSeen(id) {
    UI.state.seen.add(`alert-${id}`);
    setSeen(id, true);
    UI.render();
    UI.toast(UI.t("Marked as seen"), { undo: () => {
      UI.state.seen.delete(`alert-${id}`);
      setSeen(id, false);
      UI.render();
      UI.toast(UI.t("Restored"), { kind: "info" });
    } });
  }

  // ---- loading ---------------------------------------------------------------------------------
  async function loadSites() {
    const answer = await COMP.api("GET", "health/sites");
    const all = answer.sites || [];
    ht.sites = hidingSample() ? all.filter((s) => ht.added.some((id) => sameId(id, s.id))) : all;
    const picked = UI.siteHostPicked();
    if (ht.siteId === null && picked) ht.siteId = ht.sites.find((s) => s.host === picked)?.id ?? null;
    if (!ht.sites.some((s) => sameId(s.id, ht.siteId))) ht.siteId = UI.preferredSite(ht.sites)?.id ?? null;
  }

  async function loadTests({ openId = null } = {}) {
    const id = ht.siteId;
    ht.follow?.stop(); ht.follow = null;
    if (id === null) { ht.audits = []; ht.open = null; ht.activeId = null; ht.active = null; return; }
    const { audits } = await COMP.api("GET", `health/sites/${id}/audits`);
    if (!sameId(ht.siteId, id)) return;
    ht.audits = audits;
    const running = audits.find(isActive);
    ht.activeId = running ? running.id : null;
    ht.active = running || null;
    ht.stopping = Boolean(running?.stop_requested);
    const wanted = openId ?? audits.find((a) => !isActive(a))?.id ?? null;
    const opened = wanted === null ? null : await COMP.api("GET", `health/audits/${wanted}`);
    if (!sameId(ht.siteId, id)) return; // another site was picked while this was on its way
    ht.open = opened;
    if (running) poll();
  }

  async function loadAll(options) {
    try {
      await loadSites();
      await loadTests(options);
      ht.failed = "";
    } catch (err) { ht.failed = err.message; }
    ht.ready = true;
    paint();
    loadIndexing();
  }

  /* Is every page on Google (build next 9): read beside the tests, and never in the way of them. */
  async function loadIndexing() {
    const id = ht.siteId;
    if (!ht.server || id === null) { ht.indexing = null; return; }
    try {
      const answer = await COMP.api("GET", `health/sites/${id}/indexing`);
      if (!sameId(ht.siteId, id)) return;
      ht.indexing = answer;
    } catch { ht.indexing = { failed: true }; }
    const box = UI?.$("#ht-indexing");
    if (box) UI.setHTML(box, indexingInner());
    const line = UI?.$("#ht-score-index");
    if (line) UI.setHTML(line, scoreIndexLine());
    const top = UI?.$("#okp-ht-kpis"); // the new design's number cards say the same count
    if (top) top.replaceWith(UI.fragment(oceanTop().kpis));
  }

  /* Follows the running test with the shared poll (F187): it backs off, pauses while the tab is hidden, and gives up after a
     few failures in a row instead of asking every 1.5 s for ever. A whole-site test can take hours, so it watches up to 6. */
  function poll() {
    ht.follow?.stop();
    const id = ht.activeId;
    if (!id) return;
    ht.follow = COMP.poll(async () => {
      if (ht.activeId !== id) return false;
      const data = await COMP.api("GET", `health/audits/${id}`);
      if (ht.activeId !== id) return false;
      ht.active = data.audit;
      if (isActive(data.audit)) { paintProgress(); return true; }
      ht.activeId = null;
      ht.active = null;
      ht.stopping = false;
      await Promise.all([loadAll({ openId: id }), loadAlerts()]);
      const status = data.audit.status;
      UI.toast(UI.t(status === "complete" ? "Health test finished" : status === "stopped" ? "Health test stopped" : "Health test failed"), { kind: status === "failed" ? "crit" : status === "stopped" ? "info" : "good" });
      return false;
    }, {
      every: POLL_MS, grow: 1.15, slowest: 30000, most: 6 * 3600000,
      onEnd: (why) => { if (why === "errors" || why === "gone") UI.toast(UI.t("Lost track of the health test. Reload the page."), { kind: "warn" }); },
    });
  }

  // ---- the screen ------------------------------------------------------------------------------
  function bannerHtml(a) {
    const { t, esc, icon, num, status } = UI;
    const sev = a.severity === "crit" ? "crit" : "warn";
    const d = a.detail || {};
    const worse = (d.worse || []).map((w) => `<li><span class="ht-worse-what">${esc(t(CHECK_WORDS[w.code] || w.code))}</span><span class="tabular ht-worse-num">${num(w.before)} → ${num(w.after)}</span></li>`).join("");
    const whole = (d.site || []).map((code) => `<li><span class="ht-worse-what">${esc(t(SITE_WORDS[code] || code))}</span></li>`).join("");
    return `<section class="card ht-alert ht-alert-${sev}" data-ht-alert="${a.id}">
      <div class="ht-alert-head">${status(sev, t(SEVERITY[sev]))}
        <h2 dir="auto">${esc(t(a.title))}</h2>
        <button class="btn btn-small" data-ht-seen="${a.id}">${icon("check")}${t("Mark as seen")}</button></div>
      ${worse ? `<h3 class="ht-sub">${t("What got worse")}</h3><ul class="ht-worse">${worse}</ul>` : ""}
      ${whole ? `<h3 class="ht-sub">${t("What's wrong")}</h3><ul class="ht-worse">${whole}</ul>` : ""}
      ${a.kind === "health_failed" ? `<p class="small sec ht-alert-text">${t("The test couldn't finish. Press Refresh.")}</p>` : ""}
    </section>`;
  }

  function comparison(d) {
    const a = d.audit;
    if (isPartial(a) || a.status !== "complete") return { kind: "partial" };
    // The server picks the test to compare with, the same one its alerts use, so the card and the alert never disagree.
    if (d.previous_score === null || d.previous_score === undefined) {
      const earlier = ht.audits.some((x) => x.id < a.id && x.status === "complete" && x.score !== null);
      return earlier ? { kind: "different", why: "Not compared" } : { kind: "first" };
    }
    return { kind: "change", change: a.score - d.previous_score, prev: d.previous_audit };
  }

  /* The score only counts the checks of the pages read. A site can score 91 with 30 pages Google hasn't taken (live,
     2026-11-24), so that number sits right under the score, with a way down to the list. */
  function scoreIndexLine() {
    const { t, num, icon } = UI, ix = ht.indexing, n = ix && !ix.failed ? ix.not_indexed_count || 0 : 0;
    if (!n) return "";
    return `${icon("triangle-alert")}<b class="tabular">${num(n)}</b> ${t(n === 1 ? "page isn't on Google" : "pages aren't on Google")} · <button type="button" class="link-btn" id="ht-score-index-go">${t("See them")}</button>`;
  }
  function scoreCard() {
    const { t, num, esc, status } = UI;
    const d = ht.open, a = d?.audit;
    const graded = ht.audits.filter((x) => x.status === "complete" && x.score !== null).map((x) => x.score).reverse();
    const trend = graded.length >= 2
      ? `<div class="ht-trend">${UI.spark(graded, { w: 320, h: 56, area: true })}<span class="sr">${t("Score over the last tests")}: ${graded.join(", ")}</span><p class="small muted">${num(graded.length)} ${t("tests, dates below")}</p></div>`
      : `<p class="small muted ht-trend">${t("Trend shows after 2 full tests.")}</p>`;
    if (!a || a.score === null || a.score === undefined) {
      const words = ht.activeId && !a ? "First test running." : a?.status === "failed" ? "No score: this test failed." : "No score yet. Press Refresh.";
      return `<section class="card ht-score"><div class="ht-score-head"><h2 class="ht-sub">${t("Health score")}</h2></div><p class="sec ht-none-yet">${t(words)}</p></section>`;
    }
    const cmp = comparison(d);
    let change = "";
    if (cmp.kind === "change") {
      const word = cmp.change === 0 ? `<span class="sec d-pill">${t("No change")}</span>` : UI.delta(cmp.change);
      change = `${word}<span class="small muted">${t("since last test")}${cmp.prev ? `, ${esc(UI.fmtDateOnly(cmp.prev.created_at))}` : ""}</span>`;
    } else if (cmp.kind === "first") change = `<span class="small muted">${t("First test: nothing to compare yet.")}</span>`;
    else if (cmp.kind === "different") change = `<span class="small muted">${t(cmp.why)}${UI.tip("The last test read far fewer or far more pages, so the two can't be compared.")}</span>`;
    else change = `${status("warn", t("Partial test"))}<span class="small muted">${t("Not compared")}${UI.tip("It only covers what it read, so it isn't compared.")}</span>`;
    return `<section class="card ht-score" aria-label="${t("Health score")}">
      <div class="ht-score-head"><h2 class="ht-sub">${t("Health score")}</h2><span class="small muted">${esc(UI.fmtDateOnly(a.finished_at || a.created_at))}</span></div>
      <div class="ht-fig"><span class="ht-num tabular" id="ht-score">${num(a.score)}</span><span class="sec">${t("/100")}</span></div>
      <p class="small muted">${t("Better is higher.")} ${t("Technical checks of the pages read.")}</p>
      <p class="small ht-score-index" id="ht-score-index">${scoreIndexLine()}</p>
      <div class="ht-change">${change}</div>
      ${trend}
    </section>`;
  }

  /* The new design (Cobalt, ocean-keywords-pages.js): the score, pages read, problems and pages not on Google as four number
     cards, then one bar per problem type beside the plan. The cards below (whole site, checks, sitemap…) stay as they are. */
  const ocean = () => document.documentElement.dataset.brand === "ocean" && window.OceanKP;
  function oceanTop() {
    const { t, esc } = UI;
    const d = ht.open, a = d?.audit;
    const graded = ht.audits.filter((x) => x.status === "complete" && x.score !== null).map((x) => x.score).reverse();
    let change = null, sub = "";
    if (a && a.score !== null && a.score !== undefined) {
      const cmp = comparison(d);
      if (cmp.kind === "change") { change = cmp.change; sub = `${t("since last test")}${cmp.prev ? `, ${esc(UI.fmtDateOnly(cmp.prev.created_at))}` : ""}`; }
      else if (cmp.kind === "first") sub = t("First test: nothing to compare yet.");
      else if (cmp.kind === "different") sub = t(cmp.why);
      else sub = t("Partial test");
    } else sub = t(ht.activeId && !a ? "First test running." : a?.status === "failed" ? "No score: this test failed." : "No score yet. Press Refresh.");
    const ix = ht.indexing;
    const top = window.OceanKP.healthTop({ audit: a, score: a?.score ?? null, change, sub, graded, checks: d?.checks || [], siteProblems: (d?.site_problems || []).length, notOnGoogle: ix && !ix.failed ? ix.not_indexed_count || 0 : null });
    return { kpis: top.kpis.replace('class="cb-grid cb-kpis okp-kpis"', 'class="cb-grid cb-kpis okp-kpis" id="okp-ht-kpis"'), problems: top.problems };
  }

  function planCard(s) {
    const { t, esc, icon } = UI;
    const busy = Boolean(ht.activeId);
    const last = s.last_tested_at ? `${t("Last test")} ${esc(COMP.ago(s.last_tested_at))}.` : t("No test yet.");
    const next = !s.monthly ? "" : s.next_test_at ? `${t("Next test")} ${esc(fmtDayMonth(s.next_test_at))}.` : t("First test: next weekly run.");
    return `<section class="card ht-plan">
      <p id="ht-line">${t(s.monthly ? "Runs every week." : "Runs only by hand.")} ${last} ${next}</p>
      ${/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || location.protocol === "file:" ? `<p class="note ht-mac">${icon("info")}<span>${t("On this Mac, press Refresh.")}${UI.tip("The weekly test only runs on the hosted version.")}</span></p>` : ""}
      <label class="opt ht-monthly"><input type="checkbox" class="chk" style="margin:0" id="ht-monthly" ${s.monthly ? "checked" : ""}>${t("Test weekly")}</label>
      <div class="lc-form ht-run-row">
        <button class="btn btn-main" id="ht-run" ${busy ? "disabled" : ""}>${icon("refresh-cw")}${t("Refresh")}</button>
      </div>
      <p class="help" id="ht-whole-site">${t(UI.WHOLE_SITE_WORDS)}</p>
    </section>`;
  }

  function progressHtml() {
    if (!ht.activeId) return "";
    const { t, icon } = UI;
    return `<section class="card lc-progress ht-progress" role="status"><div class="top"><span class="spin-wrap" id="ht-spin">${icon("refresh-cw", "spin")}</span>
      <div class="lc-progress-words"><b id="ht-progress-text"></b><span class="small sec" id="ht-progress-sub"></span></div>
      <button class="btn" id="ht-stop" ${ht.stopping ? "disabled" : ""}>${t(ht.stopping ? "Stopping…" : "Stop")}</button></div>
      <div class="tray-bar"><i id="ht-bar"></i></div></section>`;
  }

  /* Only the numbers change while a test runs, so focus stays on the Stop button. */
  function paintProgress() {
    const a = ht.active, text = UI?.$("#ht-progress-text");
    if (!a || !text) return;
    const { t, num, readingWords } = UI;
    const paused = Boolean(a.paused_until), read = a.pages_read || 0, left = a.pages_not_read || 0;
    text.textContent = ht.stopping ? t("Stopping after this request…") : paused ? t(UI.BUDGET_PAUSE_WORDS) : a.status === "queued" ? t("Waiting to start…") : readingWords(read, left);
    UI.$("#ht-progress-sub").textContent = paused ? readingWords(read, left) : t("Keeps going if you leave.");
    UI.$("#ht-bar").style.setProperty("--p", read / Math.max(1, read + left));
    UI.$("#ht-spin svg")?.classList.toggle("spin", !paused);
    const historyPages = UI.$("[data-ht-live-pages]"), historyWord = UI.$("[data-ht-live-word]");
    if (historyPages) historyPages.textContent = num(read);
    if (historyWord) historyWord.textContent = t(a.status === "queued" ? "Waiting" : "Running");
  }

  function notices(a) {
    const { t, num } = UI;
    const out = [];
    if (a.status === "failed") out.push(["crit", `${t("This test failed.")}${a.error ? ` ${a.error}` : ""}`]);
    if (a.stop_reason === "user") out.push(["warn", `${t("Stopped by you after")} ${num(a.pages_read)} ${t(a.pages_read === 1 ? "page" : "pages")}. ${t("Test incomplete.")}`]);
    if (a.skipped_robots) out.push(["info", `${t("skipped by robots.txt")}: ${num(a.skipped_robots)}`]);
    return out;
  }
  const noticeHtml = ([kind, text]) => `<p class="note ${kind === "info" ? "" : kind}">${UI.icon(kind === "crit" ? "octagon-alert" : kind === "warn" ? "triangle-alert" : "info")}<span>${UI.esc(text)}</span></p>`;

  function wholeSiteCard(d) {
    const { t, esc, status, num } = UI;
    const list = d.site_problems || [];
    return `<section class="card ht-whole">
      <div class="card-head"><h2>${t("Whole-site problems")}</h2><span class="end">${list.length ? status("crit", `${num(list.length)} ${critWord(list.length)}`) : status("good", t("None found"))}</span></div>
      ${list.length ? `<ul class="rows">${list.map((p) => `<li><div class="what"><div class="t">${esc(t(p.meaning))}</div>${FIX_WORDS[p.code] ? `<div class="d">${t(FIX_WORDS[p.code])}${UI.tip(FIX_TIPS[p.code])}</div>` : ""}</div><div class="acts">${UI.taskButton(healthFind(p.code, p.meaning, [d.audit?.created_at ? `${t("Test of")} ${UI.fmtDateOnly(d.audit.created_at)}` : ""]))}</div></li>`).join("")}</ul>` : ""}
      <p class="help ht-foot">${d.audit.status === "stopped"
        ? `${t("Start page checked. Stopped before the certificate.")}${UI.tip("A stopped test doesn't get as far as the security certificate. Uptime and domain expiry aren't part of this test.")}`
        : `${t("Start page and certificate checked.")}${UI.tip("Uptime and domain expiry aren't part of this test. See the Uptime tab.")}`}</p>
    </section>`;
  }

  /* Since last test, as a signed number: red and + are worse, green and − are better. No arrow, because ↑ and ↓ mean
     moves in Google in this app; "worse" or "better" stays for the tooltip and screen readers. */
  function changeCell(c, compared) {
    const { t, num, esc } = UI;
    if (!compared || c.previous === null || c.previous === undefined) return `<span class="muted small">${t("Not compared")}</span>`;
    const moved = c.count - c.previous;
    if (moved === 0) return `<span class="sec small">${t("No change")}</span>`;
    const shown = moved > 0 ? `+${num(moved)}` : `−${num(-moved)}`, word = t(moved > 0 ? "worse" : "better");
    return `<span class="${moved > 0 ? "crit" : "good"} d-pill" role="img" title="${esc(word)}" data-tip="${esc(word)}" aria-label="${esc(`${shown} ${word}`)}">${shown}</span>`;
  }

  // What to do about each finding, in a line. Whoever gets the task starts from here.
  const FIX_WORDS = {
    broken_pages: "Restore them, or redirect to the closest page.",
    broken_links: "Fix or remove each link.",
    server_errors: "Have the server error log checked.",
    noindex: "Remove noindex if they should be found.",
    canonical_elsewhere: "Unless intended, point each page to itself.",
    no_title: "Write a title for each page.",
    duplicate_title: "Give each page its own title.",
    no_h1: "Add one main heading to each page.",
    many_h1: "Keep one main heading; make the rest subheadings.",
    no_meta: "Write a meta description for each page.",
    duplicate_meta: "Give each page its own meta description.",
    images_no_alt: "Describe each image in its alt text.",
    almost_no_text: "Add useful text, or noindex these pages.",
    redirect_chains: "Link straight to the final address.",
    slow_pages: "Check images and scripts, then hosting.",
    robots_blocked: "Search engines can't read these. If one should be found, remove its Disallow line in robots.txt. Not scored.",
    start_page_down: "Check the hosting first.",
    start_page_noindex: "Remove its noindex, unless the site should stay hidden.",
    robots_down: "Have robots.txt fixed.",
    ssl_expired: "Renew the certificate now.",
    ssl_expiring: "Renew it, or check auto-renewal is on.",
    ssl_error: "Have the host check the certificate.",
    sitemap_missing: "Create a sitemap, then name it in robots.txt.",
    sitemap_unreachable: "Make the sitemap address answer, or fix it in robots.txt.",
    sitemap_invalid: "Have the sitemap rebuilt by the site or its SEO plugin.",
    sitemap_too_big: "Split it into smaller sitemaps under one index file.",
    sitemap_not_in_robots: "Add a Sitemap: line to robots.txt. Not scored.",
    listed_broken: "Take them out of the sitemap, or bring the pages back.",
    listed_redirect: "List the address each one goes to instead.",
    listed_noindex: "Take them out of the sitemap, or remove noindex.",
    listed_blocked: "Take them out of the sitemap, or allow them in robots.txt.",
    listed_canonical: "List the canonical address instead.",
    sitemap_missing_pages: "Add these pages to the sitemap.",
    lastmod_future: "Each date should be when its page last changed. Not scored.",
    lastmod_same: "Give each page the date it last changed. Not scored.",
  };
  // The who and the why behind a fix, one hover away (UI.tip).
  const FIX_TIPS = {
    server_errors: "Ask whoever runs the server. These pages can vanish from search while the errors last.",
    start_page_down: "Nothing else on the site can be read while the start page is down.",
    robots_down: "Ask whoever runs the server. Search engines stay away until robots.txt answers.",
    ssl_expired: "Browsers are warning visitors away.",
  };
  // Every whole-site problem is critical, so the card head says it once with the count: "2 critical", "2 critiques".
  const critWord = (n) => (UI.state.lang === "fr" ? (n === 1 ? "critique" : "critiques") : "critical");
  const hostShown = () => ht.sites.find((s) => sameId(s.id, ht.siteId))?.host;
  function healthFind(code, meaning, facts) {
    const { t } = UI, host = hostShown();
    // By site and check, not by test: next month's test finding the same thing is still the same job.
    // The title is the check alone: the task's site tag and Site column already name the host. Tasks saved before keep "…: host".
    return { title: t(meaning), host, description: FIX_WORDS[code] ? t(FIX_WORDS[code]) : "", about: { main: "technical", items: [{ kind: "technical", ref: `health:${code}`, label: t(CHECK_WORDS[code] || meaning) }] }, source: { type: "health", label: t(meaning), host, facts: facts.filter(Boolean), link: `#health/test/${code}`, key: `health|${ht.siteId}|${code}` } };
  }

  function checkRow(c, compared) {
    const { t, esc, icon, num, status } = UI;
    const sev = c.severity === "crit" ? "crit" : c.severity === "warn" ? "warn" : "info";
    const pages = (c.pages || []).map((p) => `<li>${COMP.link(p, pathOnly(p))}</li>`).join("");
    const more = c.count - (c.pages || []).length;
    return `<details class="ht-check" data-ht-check="${esc(c.code)}" ${ht.openChecks.has(c.code) ? "open" : ""}>
      <summary><span class="ht-check-what">${icon("chevron-right", "ht-chev")}<span>${esc(t(c.meaning))}</span></span>
        <span class="ht-check-sev">${status(sev, t(SEVERITY[sev]))}</span>
        <span class="ht-check-count tabular" aria-label="${num(c.count)} ${t(c.count === 1 ? "page" : "pages")}">${num(c.count)}<span class="ht-count-word" aria-hidden="true"> ${t(c.count === 1 ? "page" : "pages")}</span></span>
        <span class="ht-check-change">${changeCell(c, compared)}</span></summary>
      <ul class="ht-pages">${pages}${more > 0 ? `<li class="small muted">${t("and")} ${num(more)} ${t("more")}</li>` : ""}</ul>
      <div class="ht-check-act">
        ${FIX_WORDS[c.code] ? `<p class="small sec">${t(FIX_WORDS[c.code])}${UI.tip(FIX_TIPS[c.code])}</p>` : ""}
        ${UI.taskButton(healthFind(c.code, c.meaning, [`${num(c.count)} ${t(c.count === 1 ? "page" : "pages")}`, ...(c.pages || []).slice(0, 10), more > 0 ? `${t("and")} ${num(more)} ${t("more")}` : "", ht.open?.audit?.created_at ? `${t("Test of")} ${UI.fmtDateOnly(ht.open.audit.created_at)}` : ""]))}
      </div>
    </details>`;
  }

  function checksCard(d) {
    const { t, icon, num, status, esc } = UI;
    const compared = comparison(d).kind === "change";
    const found = d.checks.filter((c) => c.count > 0), clean = d.checks.filter((c) => c.count === 0);
    const cleanRow = (c) => { const sev = c.severity === "crit" ? "crit" : c.severity === "warn" ? "warn" : "info"; return `<li><span class="ht-clean-what">${esc(t(c.meaning))}</span><span class="ht-check-sev">${status(sev, t(SEVERITY[sev]))}</span>${compared && c.previous ? `<span class="ht-check-change">${changeCell(c, compared)}</span>` : ""}</li>`; };
    return `<section class="card ht-checks">
      <div class="card-head"><h2>${t("Checks")}</h2><span class="end small muted">${num(found.length)} ${t("with problems")}</span></div>
      ${found.length ? `<div class="ht-check-heads small muted" aria-hidden="true"><span>${t("Problem")}</span><span>${t("Severity")}</span><span>${t("Pages")}</span><span>${t("Since last test")}</span></div>${found.map((c) => checkRow(c, compared)).join("")}` : `<p class="lc-none small sec">${t("No problems found.")}</p>`}
      ${clean.length ? `<details class="ht-clean" data-ht-check="clean" ${ht.openChecks.has("clean") ? "open" : ""}><summary>${icon("chevron-right", "ht-chev")}${num(clean.length)} ${t(clean.length === 1 ? "check passed" : "checks passed")}</summary><ul class="ht-clean-list">${clean.map(cleanRow).join("")}</ul></details>` : ""}
    </section>`;
  }

  // ---- on Google, and internal links: one answer, a short table, the rest behind one button ------------------
  const pathOnly = (url) => { try { const u = new URL(url); return decodeURI(u.pathname + u.search) || "/"; } catch { return url || ""; } };
  const MANY = 10; // a search box shows once a table holds more rows than this, or while it holds something
  const wantsSearch = (key, n) => n > MANY || Boolean(TP.state(key).q);

  /* A heading that sorts, as on Competitors → Link gaps: numbers biggest first, then smallest, then the usual order again. */
  function sortHead(table, id, label) {
    const sort = ht.sorts[table], on = sort?.id === id;
    return `<th scope="col" class="r" aria-sort="${on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" class="th-btn" data-ht-sort="${table}" data-ht-sort-by="${id}">${UI.t(label)}${on ? UI.icon(sort.dir === "asc" ? "arrow-up" : "arrow-down") : ""}</button></th>`;
  }
  function sorted(table, list) {
    const sort = ht.sorts[table];
    if (!sort) return list;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => ((a[sort.id] ?? -1) - (b[sort.id] ?? -1)) * dir);
  }
  /* Another site, or another test, starts every table again at page 1, in the usual order, with no search. */
  function resetPages(keys = Object.values(PAGES)) {
    keys.forEach((key) => { TP.state(key).q = ""; TP.reset(key); });
    if (keys.includes(PAGES.few)) delete ht.sorts.few;
    if (keys.includes(PAGES.linksIn)) delete ht.sorts.linksIn;
  }

  function indexingInner() {
    const { t, num, esc } = UI, ix = ht.indexing;
    if (!ix) return UI.skeleton ? UI.skeleton("rows", { rows: 3 }) : `<p class="lc-none small muted">${t("Loading…")}</p>`;
    if (ix.failed) return `<p class="lc-none small sec">${t("That didn't load")}</p>`;
    if (!ix.on) return `<p class="lc-none small sec">${t("Connect Search Console to see this.")}${UI.tip("Google is then asked, page by page, whether each page of this site is indexed.")} <a href="#settings">${t("Data sources")}</a></p>`;
    if (!ix.pages) return `<p class="lc-none small sec">${t("No pages read yet.")}${UI.tip("The daily read fills this in.")}</p>`;
    const parts = [ix.checked ? `${num(ix.indexed)} ${t("of")} ${num(ix.checked)} ${t(ix.checked === 1 ? "page checked is on Google." : "pages checked are on Google.")}` : t("No page checked yet.")];
    if (ix.not_indexed_count) parts.push(`${num(ix.not_indexed_count)} ${t(ix.not_indexed_count === 1 ? "isn't (why below)." : "aren't (why below).")}`);
    if (ix.unchecked) parts.push(`${num(ix.unchecked)} ${t("still to check")} (${t("about")} ${num(ix.days_left)} ${t(ix.days_left === 1 ? "day" : "days")}, ${num(ix.per_day)} ${t("a day")}).`);
    const rows = ix.not_indexed || [], found = rows.filter((a) => TP.matches(PAGES.index, pathOnly(a.url), a.coverage, a.google_canonical));
    /* Google's same reason on many pages is said once, as a heading with its count, biggest group first. Its words stay as
       Google wrote them. The rows keep only what differs: the page, the page Google prefers, the day it was asked. */
    const why = (a) => a.coverage || t(a.state === "unknown" ? "Unknown to Google" : "Not indexed");
    const counts = new Map();
    found.forEach((a) => counts.set(why(a), (counts.get(why(a)) || 0) + 1));
    const rank = [...counts.keys()].sort((x, y) => counts.get(y) - counts.get(x));
    const page = TP.view(PAGES.index, [...found].sort((x, y) => rank.indexOf(why(x)) - rank.indexOf(why(y))));
    const search = wantsSearch(PAGES.index, rows.length) ? `<div class="chips ht-find">${TP.search(PAGES.index, t("Search pages or what Google says"))}</div>` : "";
    const drawn = page.rows.map((a) => `<tr style="cursor:default"><td class="head-cell">${COMP.link(a.url, pathOnly(a.url))}${a.google_canonical ? `<span class="second">${t("Google prefers")} ${COMP.link(a.google_canonical, pathOnly(a.google_canonical))}</span>` : ""}</td><td data-label="${t("Asked on")}" class="nowrap small muted">${esc(a.checked || "—")}</td></tr>`);
    // A heading wherever the reason changes: once per group here, or on each row while a column sort mixes the groups.
    let body = "", last = null;
    page.rows.forEach((a, i) => {
      const w = why(a), n = counts.get(w) || 0;
      if (w !== last) body += `<tr class="ht-group" style="cursor:default"><th scope="colgroup" colspan="2" dir="auto">${esc(w)}${n > 1 ? ` <span class="muted tabular">×${num(n)}</span>` : ""}</th></tr>`;
      last = w;
      body += drawn[i];
    });
    const table = !rows.length ? "" : !found.length ? `${search}<p class="lc-none small sec">${t("No page matches.")}</p>` : `${search}<div class="ht-list"><div class="table-wrap"><table class="data lc-table" id="ht-not-indexed"><thead><tr><th scope="col">${t("Page")}</th><th scope="col">${t("Asked on")}</th></tr></thead><tbody>
      ${body}</tbody></table></div>
      ${TP.footer(PAGES.index, page, { noun: t("pages") })}</div>`;
    return `<p class="ht-answer lc-none">${parts.join(" ")}</p>${table}`;
  }

  function indexingCard() {
    return `<section class="card ht-indexing"><div class="card-head"><h2>${UI.t("On Google")}</h2><span class="end small muted">${UI.t("Search Console, page by page")}</span></div><div id="ht-indexing">${indexingInner()}</div></section>`;
  }

  function linksCard(d) {
    const { t, num } = UI, r = d.internal_links;
    if (!r) return "";
    const parts = [];
    if (r.sitemap_read && r.sitemap_pages) parts.push(r.orphan_count ? `${num(r.orphan_count)} ${t(r.orphan_count === 1 ? "sitemap page has no link from another page." : "sitemap pages have no link from another page.")}` : t("Every sitemap page is linked from another page."));
    else parts.push(`${t("No sitemap found.")}${UI.tip("So pages linked from nowhere can't be listed.")}`);
    if (r.has_search_data) parts.push(r.few_links_count ? `${num(r.few_links_count)} ${t(r.few_links_count === 1 ? "page with Google visits has" : "pages with Google visits have")} ${num(r.few_links_line)} ${t("links in or fewer: link to them from related pages.")}` : t("Pages with Google visits all have links in."));
    const few = r.few_links || [], fewFound = few.filter((p) => TP.matches(PAGES.few, pathOnly(p.url))), fewPage = TP.view(PAGES.few, sorted("few", fewFound));
    const fewSearch = wantsSearch(PAGES.few, few.length) ? `<div class="chips ht-find">${TP.search(PAGES.few, t("Search pages"))}</div>` : "";
    const fewCut = r.few_links_count > few.length ? `${t("{sent} of {total}, most clicks first").replace("{sent}", num(few.length)).replace("{total}", num(r.few_links_count))}` : null;
    const table = !few.length ? "" : !fewFound.length ? `${fewSearch}<p class="lc-none small sec">${t("No page matches.")}</p>` : `${fewSearch}<div class="ht-list"><div class="table-wrap"><table class="data lc-table" id="ht-few-links"><thead><tr><th scope="col">${t("Page")}</th>${sortHead("few", "links_in", "Links in")}${sortHead("few", "clicks", "Clicks")}</tr></thead><tbody>
      ${fewPage.rows.map((p) => `<tr style="cursor:default"><td class="head-cell">${COMP.link(p.url, pathOnly(p.url))}</td><td class="r tabular" data-label="${t("Links in")}">${num(p.links_in)}</td><td class="r tabular" data-label="${t("Clicks")}">${num(p.clicks)}</td></tr>`).join("")}</tbody></table></div>
      ${TP.footer(PAGES.few, fewPage, { noun: t("pages"), capped: fewCut })}</div>`;
    const every = r.pages || [], everyFound = every.filter((p) => TP.matches(PAGES.linksIn, pathOnly(p.url))), everyPage = TP.view(PAGES.linksIn, sorted("linksIn", everyFound));
    const all = ht.linksAll ? `<div class="ht-links-all" style="padding:0 18px 14px">
        ${r.orphans?.length ? `<h3>${t("Linked from nowhere")}</h3><ul class="ht-pages">${r.orphans.map((u) => `<li>${COMP.link(u, pathOnly(u))}</li>`).join("")}${r.orphan_count > r.orphans.length ? `<li class="small muted">${t("and")} ${num(r.orphan_count - r.orphans.length)} ${t("more")}</li>` : ""}</ul>` : ""}
        <h3>${t("Links in per page")}</h3>
        ${wantsSearch(PAGES.linksIn, every.length) ? `<div class="chips ht-find">${TP.search(PAGES.linksIn, t("Search pages"))}</div>` : ""}
        ${everyFound.length ? `<div class="ht-list"><div class="table-wrap"><table class="data lc-table" id="ht-links-in"><thead><tr><th scope="col">${t("Page")}</th>${sortHead("linksIn", "links_in", "Links in")}</tr></thead><tbody>
        ${everyPage.rows.map((p) => `<tr style="cursor:default"><td class="head-cell">${COMP.link(p.url, pathOnly(p.url))}</td><td class="r tabular" data-label="${t("Links in")}">${num(p.links_in)}</td></tr>`).join("")}</tbody></table></div>
        ${TP.footer(PAGES.linksIn, everyPage, { noun: t("pages"), capped: r.pages_read > every.length ? t("{sent} of {total}, fewest links in first").replace("{sent}", num(every.length)).replace("{total}", num(r.pages_read)) : null })}</div>` : every.length ? `<p class="small sec">${t("No page matches.")}</p>` : ""}
        ${r.sitemap_cut ? `<p class="small muted">${t("Sitemap only partly read: list may be incomplete.")}</p>` : ""}</div>` : "";
    return `<section class="card ht-links"><div class="card-head"><h2>${t("Internal links")}</h2><span class="end small muted">${num(r.pages_read)} ${t(r.pages_read === 1 ? "page read" : "pages read")}</span></div>
      <p class="ht-answer lc-none">${parts.join(" ")}</p>${table}
      <div style="padding:10px 18px 14px"><button type="button" class="btn btn-small" data-ht-links-all aria-expanded="${Boolean(ht.linksAll)}">${t(ht.linksAll ? "Show less" : "Show all pages")}</button></div>${all}</section>`;
  }

  /* The sitemap (2026-11-18): the answer first, the problems with their counts, each opening its list. The files read stay
     behind one button. A test from before these checks says so instead of claiming a clean sitemap. */
  const SM_FILE_CODES = new Set(["sitemap_missing", "sitemap_unreachable", "sitemap_invalid", "sitemap_too_big", "sitemap_not_in_robots"]);
  const SM_WHY = { gone: "Not found", server_error: "Server error", network_error: "No answer", robots: "Blocked by robots.txt", blocked: "Refused us",
    http_error: "Error answer", too_many_redirects: "Too many redirects", left_scope: "Goes to another site", refused: "Not allowed", redirect: "Redirects", not_modified: "No content" };
  // The one column that differs per problem: [heading, cell]. Pages alone need none.
  function smColumn(code) {
    const { t, num, esc } = UI;
    if (code === "listed_broken") return ["Answer", (r) => `<td class="r tabular" data-label="${t("Answer")}">${esc(r.code ?? "—")}</td>`];
    if (code === "listed_redirect" || code === "listed_canonical") return ["Goes to", (r) => `<td data-label="${t("Goes to")}">${r.to ? COMP.link(r.to, pathOnly(r.to)) : "—"}</td>`];
    if (code === "sitemap_missing_pages") return ["Clicks", (r) => `<td class="r tabular" data-label="${t("Clicks")}" data-sort="${r.clicks || 0}">${r.clicks ? num(r.clicks) : '<span class="muted">—</span>'}</td>`];
    if (code === "lastmod_future") return ["Date", (r) => `<td class="r tabular" data-label="${t("Date")}">${esc(r.lastmod || "—")}</td>`];
    if (code === "sitemap_unreachable") return ["Answer", (r) => `<td data-label="${t("Answer")}">${esc(t(SM_WHY[r.why] || r.why || "—"))}</td>`];
    if (code === "sitemap_too_big") return ["Pages", (r) => `<td class="r tabular" data-label="${t("Pages")}">${r.urls ? num(r.urls) : "—"}</td>`];
    return null;
  }
  function smCountWords(p) {
    const { t, num } = UI;
    if (p.code === "sitemap_missing") return "";
    const files = SM_FILE_CODES.has(p.code);
    return `${num(p.count)}<span class="ht-count-word" aria-hidden="true"> ${t(files ? (p.count === 1 ? "file" : "files") : (p.count === 1 ? "page" : "pages"))}</span>`;
  }
  function smRow(p, d) {
    const { t, esc, icon, num, status } = UI;
    const sev = p.severity === "crit" ? "crit" : p.severity === "warn" ? "warn" : "info";
    const key = smKey(p.code), rows = p.rows || [], col = smColumn(p.code);
    const found = rows.filter((r) => TP.matches(key, pathOnly(r.url), r.to ? pathOnly(r.to) : ""));
    const page = TP.view(key, found);
    const files = SM_FILE_CODES.has(p.code);
    const search = wantsSearch(key, rows.length) ? `<div class="chips ht-find">${TP.search(key, t("Search pages"))}</div>` : "";
    const cut = p.count > rows.length ? t("{sent} of {total}").replace("{sent}", num(rows.length)).replace("{total}", num(p.count)) : null;
    const list = p.code === "lastmod_same" ? `<p class="small sec ht-sm-line">${t("Every listed page says")} <span class="tabular">${esc(p.date || "")}</span>.</p>`
      : !rows.length ? "" : !found.length ? `${search}<p class="lc-none small sec">${t("No page matches.")}</p>`
      : `${search}<div class="ht-list"><div class="table-wrap"><table class="data lc-table" id="${key}"><thead><tr><th scope="col">${t(files ? "File" : "Page")}</th>${col ? `<th scope="col"${col[0] === "Goes to" || col[0] === "Answer" && files ? "" : ' class="r"'}>${t(col[0])}</th>` : ""}</tr></thead><tbody>
        ${page.rows.map((r) => `<tr style="cursor:default"><td class="head-cell">${COMP.link(r.url, files ? r.url : pathOnly(r.url))}</td>${col ? col[1](r) : ""}</tr>`).join("")}</tbody></table></div>
        ${TP.footer(key, page, { noun: t(files ? "files" : "pages"), capped: cut })}</div>`;
    const facts = [p.code === "sitemap_missing" ? "" : `${num(p.count)} ${t(files ? (p.count === 1 ? "file" : "files") : (p.count === 1 ? "page" : "pages"))}`,
      ...rows.slice(0, 10).map((r) => r.url), p.count > 10 ? `${t("and")} ${num(p.count - Math.min(10, rows.length))} ${t("more")}` : "",
      d.audit?.created_at ? `${t("Test of")} ${UI.fmtDateOnly(d.audit.created_at)}` : ""];
    return `<details class="ht-check ht-sm-check" data-ht-check="sm-${esc(p.code)}" ${ht.openChecks.has(`sm-${p.code}`) ? "open" : ""}>
      <summary><span class="ht-check-what">${icon("chevron-right", "ht-chev")}<span>${esc(t(p.meaning))}</span></span>
        <span class="ht-check-sev">${status(sev, t(SEVERITY[sev]))}</span>
        <span class="ht-check-count tabular">${smCountWords(p)}</span></summary>
      <div class="ht-check-act">
        ${FIX_WORDS[p.code] ? `<p class="small sec">${t(FIX_WORDS[p.code])}</p>` : ""}
        ${UI.taskButton(healthFind(p.code, p.meaning, facts))}
      </div>
      ${list}
    </details>`;
  }

  function sitemapCard(d) {
    const { t, num, status, esc, icon } = UI;
    const r = d.sitemap, a = d.audit;
    if (a.status !== "complete") return ""; // a stopped or failed test never got to the sitemap
    const head = (end) => `<div class="card-head"><h2>${t("Sitemap")}</h2><span class="end">${end}</span></div>`;
    if (!r) return `<section class="card ht-sitemap">${head("")}<p class="ht-answer lc-none">${t("Not checked in this test.")}</p><p class="small sec ht-sm-line">${t("Press Refresh to check the sitemap.")}</p></section>`;
    const problems = r.problems || [];
    const real = problems.filter((p) => p.severity !== "info");
    const worst = real.some((p) => p.severity === "crit") ? "crit" : "warn";
    const badge = real.length ? status(worst, `${num(real.length)} ${t(real.length === 1 ? "problem" : "problems")}`) : status("good", t("OK"));
    // The head says the verdict ("Sitemap · 3 problems", "Sitemap · OK"); the first line says how big it is, or that there is none.
    const answer = !r.found ? t(problems.some((p) => p.code === "sitemap_missing") ? "No sitemap found." : "The sitemap couldn't be read.")
      : `${num(r.listed)} ${t(r.listed === 1 ? "page listed" : "pages listed")} · ${num((r.files || []).length)} ${t((r.files || []).length === 1 ? "file" : "files")}`;
    const facts = "";
    const notes = [];
    if (r.held_back?.length) notes.push(["info", `${t("The site asked us to slow down, so part of the sitemap wasn't read.")} ${t("The next test tries again.")}`]);
    else if (r.missing_not_judged) notes.push(["info", t("Part of the sitemap couldn't be read, so missing pages aren't listed.")]);
    if (r.unchecked) notes.push(["info", `${num(r.unchecked)} ${t(r.unchecked === 1 ? "listed page wasn't checked this time." : "listed pages weren't checked this time.")}`]);
    const filesList = ht.smFiles ? `<ul class="ht-pages ht-sm-files">${(r.files || []).map((f) => `<li>${COMP.link(f.url, f.url)} <span class="small muted tabular">${f.kind === "index" ? t("index") : f.kind === "urlset" ? `${num(f.urls)} ${t(f.urls === 1 ? "page" : "pages")}` : esc(t(SM_WHY[f.kind] || f.kind))}</span></li>`).join("")}</ul>` : "";
    return `<section class="card ht-sitemap" aria-label="${t("Sitemap")}">${head(badge)}
      <p class="ht-answer lc-none">${answer}</p>${facts}
      ${notes.map(noticeHtml).join("")}
      ${problems.length ? `<div class="ht-check-heads ht-sm-heads small muted" aria-hidden="true"><span>${t("Problem")}</span><span>${t("Severity")}</span><span>${t("Count")}</span></div>${problems.map((p) => smRow(p, d)).join("")}` : ""}
      ${(r.files || []).length ? `<div class="ht-sm-more"><button type="button" class="btn btn-small" data-ht-sm-files aria-expanded="${Boolean(ht.smFiles)}">${icon(ht.smFiles ? "chevron-up" : "chevron-down")}${t(ht.smFiles ? "Hide the files" : "Show the files read")}</button></div>${filesList}` : ""}
    </section>`;
  }

  function resultWord(a) {
    const { t } = UI;
    if (a.status === "complete") return t("Complete");
    if (a.status === "stopped") return t("Stopped by you");
    return t({ queued: "Waiting", running: "Running", failed: "Failed" }[a.status] || a.status);
  }

  function historyCard() {
    const { t, esc, num } = UI;
    const page = TP.view(PAGES.history, ht.audits);
    return `<section class="card ht-history" aria-label="${t("History")}">
      <div class="card-head"><h2>${t("History")}</h2><span class="end small muted">${esc(site()?.host || "")}</span></div>
      ${ht.audits.length ? `<table class="data lc-table" id="ht-history"><thead><tr><th scope="col">${t("Date")}</th><th scope="col">${t("How")}</th><th scope="col" class="r">${t("Score")}</th><th scope="col" class="r">${t("Pages")}</th><th scope="col">${t("Result")}</th><th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead><tbody>
        ${page.rows.map((a) => `<tr ${isActive(a) ? 'style="cursor:default"' : `data-ht-row="${a.id}"`} class="${ht.open?.audit.id === a.id ? "open" : ""}">
          <td class="head-cell" data-label="${t("Date")}">${esc(UI.fmtStamp(a.created_at))}</td>
          <td data-label="${t("How")}">${t(a.trigger === "monthly" ? "Automatic" : "By hand")}</td>
          <td class="r" data-label="${t("Score")}">${a.score === null || a.score === undefined ? '<span class="muted">—</span>' : `${num(a.score)}${isPartial(a) ? ` <span class="tag">${t("partial")}</span>` : ""}`}</td>
          <td class="r" data-label="${t("Pages")}" ${isActive(a) ? "data-ht-live-pages" : ""}>${num(a.pages_read)}</td>
          <td data-label="${t("Result")}"><span class="small sec" ${isActive(a) ? "data-ht-live-word" : ""}>${esc(resultWord(a))}</span></td>
          <td class="r nowrap" data-label=""><button class="btn btn-small" data-ht-open="${a.id}" aria-label="${t("Open")}: ${esc(UI.fmtStamp(a.created_at))}" ${isActive(a) ? "disabled" : ""}>${t("Open")}</button></td>
        </tr>`).join("")}</tbody></table>
        ${TP.footer(PAGES.history, page, { noun: t("tests") })}` : `<p class="lc-none small muted">${t("No tests yet.")}</p>`}
    </section>`;
  }

  function view() {
    const { t, esc, icon } = UI;
    if (!ht.ready) return UI.skeleton ? UI.skeleton("page", { tiles: 2, rows: 6, chart: false }) : `<div class="card"><div class="empty"><p>${t("Loading…")}</p></div></div>`;
    if (ht.failed) return UI.failCard ? UI.failCard(ht.failed, { onRetry: () => { ht.failed = ""; ht.ready = false; paint(); loadAll(); } }) : `<div class="table-wrap"><div class="empty"><h3>${t("That didn't load")}</h3><p>${esc(t(ht.failed))}</p></div></div>`;
    if (!ht.sites.length) {
      return `<div class="table-wrap"><div class="empty" id="ht-empty"><h3>${t("No sites added yet")}</h3><p>${t("Add your own site first.")}</p><button class="btn btn-main" id="site-add">${icon("plus")}${t("Add a site")}</button></div></div>`;
    }
    const s = site();
    const a = ht.open?.audit;
    if (ht.pagedSite !== ht.siteId) { ht.pagedSite = ht.siteId; ht.pagedTest = a?.id; resetPages([...Object.values(PAGES), ...SM_CODES.map(smKey)]); } // another site: every table at page 1
    else if (a && ht.pagedTest !== a.id) { ht.pagedTest = a.id; resetPages([PAGES.few, PAGES.linksIn, ...SM_CODES.map(smKey)]); } // another test: its tables at page 1
    const latest = ht.audits.find((x) => !isActive(x));
    const past = a && latest && a.id !== latest.id;
    const alerts = openAlerts().filter((x) => isTestAlert(x) && sameId(x.site_id, s.id) && !UI.state.seen.has(`alert-${x.id}`));
    return `<div class="comp-bar ht-bar"><label class="field comp-site"><span>${t("Site")}</span><select class="select" id="ht-site">${ht.sites.map((x) => `<option value="${esc(x.id)}" ${sameId(x.id, ht.siteId) ? "selected" : ""}>${esc(x.host)}</option>`).join("")}</select></label>${UI.showingNote(hostShown())}</div>
      ${alerts.map(bannerHtml).join("")}
      ${past ? `<p class="note ht-past">${icon("info")}<span>${t("Viewing an older test.")} <button class="link-btn" data-ht-latest>${t("Latest test")}</button></span></p>` : ""}
      ${ocean() ? `${oceanTop().kpis}<div class="cb-grid okp-ht-row">${oceanTop().problems}${planCard(s)}</div>` : `<div class="ht-top">${scoreCard()}${planCard(s)}</div>`}
      ${progressHtml()}
      ${a ? notices(a).map(noticeHtml).join("") : ""}
      ${ht.open ? wholeSiteCard(ht.open) : ""}
      ${ht.open?.checks ? checksCard(ht.open) : ""}
      ${ht.open?.audit ? sitemapCard(ht.open) : ""}
      ${ht.server ? indexingCard() : ""}
      ${ht.open?.internal_links ? linksCard(ht.open) : ""}
      ${historyCard()}`;
  }

  function paint() {
    const box = UI?.$("#ht-root");
    if (!box) return;
    UI.setHTML(box, view());
    paintProgress();
  }

  // ---- doing things ----------------------------------------------------------------------------
  async function runTest() {
    const s = site();
    if (!s || ht.starting) return; // a double click starts one test
    ht.starting = true;
    try {
      const { audit_id: id } = await COMP.api("POST", "health/audit", { site_id: s.id });
      ht.activeId = id;
      ht.active = { id, status: "queued", pages_read: 0, pages_not_read: 0 };
      ht.stopping = false;
      ht.audits = (await COMP.api("GET", `health/sites/${s.id}/audits`)).audits;
      paint();
      UI.$("#ht-stop")?.focus();
      poll();
    } catch (err) {
      COMP.fail(err);
      loadAll();
    } finally {
      ht.starting = false;
    }
  }

  function stopTest(button) {
    ht.stopping = true;
    button.disabled = true;
    button.textContent = UI.t("Stopping…");
    paintProgress();
    COMP.api("POST", `health/audits/${ht.activeId}/stop`).catch((err) => {
      ht.stopping = false; // it's still running, so the screen says so
      paint();
      COMP.fail(err);
    });
  }

  async function openTest(id) {
    try {
      ht.open = await COMP.api("GET", `health/audits/${id}`);
      paint();
      UI.$(".ht-top")?.scrollIntoView({ block: "start", behavior: UI.reduceMotion() ? "auto" : "smooth" });
      UI.$(`[data-ht-open="${id}"]`)?.focus({ preventScroll: true });
    } catch (err) { COMP.fail(err); }
  }

  function bindEvents() {
    document.addEventListener("click", (e) => {
      if (!e.target.closest?.("[data-ht-retry]")) return;
      ht.failed = ""; ht.ready = false;
      paint();
      loadAll();
    });
    // Before the app's own click handler: Review on Today opens the right website.
    document.addEventListener("click", (e) => {
      const row = e.target.closest?.('[data-act="health"]')?.closest('[data-row^="alert-"]');
      if (!row) return;
      const alert = ht.alerts.find((a) => `alert-${a.id}` === row.dataset.row);
      if (alert && !sameId(alert.site_id, ht.siteId)) {
        ht.siteId = alert.site_id; ht.open = null;
        UI.pickSite(ht.sites.find((s) => sameId(s.id, alert.site_id))?.host); // Review moves the side menu too, so the two agree
        ht.lastPicked = UI.siteHostPicked(); ht.started = false; ht.ready = false;
      }
    }, true);
    document.addEventListener("click", (e) => {
      const target = e.target;
      let el;
      if ((el = target.closest?.("[data-ht-seen]"))) { markSeen(Number(el.dataset.htSeen)); return; }
      if ((el = target.closest?.("[data-ht-sort]"))) {
        const table = el.dataset.htSort, id = el.dataset.htSortBy, sort = ht.sorts[table];
        ht.sorts[table] = sort?.id !== id ? { id, dir: "desc" } : sort.dir === "desc" ? { id, dir: "asc" } : null; // a third click goes back to the usual order
        TP.reset(table === "few" ? PAGES.few : PAGES.linksIn);
        paint(); UI.$(`[data-ht-sort="${table}"][data-ht-sort-by="${id}"]`)?.focus();
        return;
      }
      if (target.closest?.("[data-ht-sm-files]")) { ht.smFiles = !ht.smFiles; paint(); UI.$("[data-ht-sm-files]")?.focus(); return; }
      if (target.closest?.("[data-ht-links-all]")) { ht.linksAll = !ht.linksAll; paint(); UI.$("[data-ht-links-all]")?.focus(); return; }
      if (target.closest?.("#ht-run")) { runTest(); return; }
      if (target.closest?.("#ht-score-index-go")) { const card = UI.$(".ht-indexing"); if (card) { card.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); card.setAttribute("tabindex", "-1"); card.focus({ preventScroll: true }); } return; }
      if ((el = target.closest?.("#ht-stop"))) { stopTest(el); return; }
      if ((el = target.closest?.("[data-ht-open]"))) { openTest(Number(el.dataset.htOpen)); return; }
      // The whole row opens it, like the other tables. A control inside the row keeps its own job.
      if ((el = target.closest?.("[data-ht-row]")) && !target.closest?.("input, button, a, select, label")) { openTest(Number(el.dataset.htRow)); return; }
      if (target.closest?.("[data-ht-latest]")) { const latest = ht.audits.find((x) => !isActive(x)); if (latest) openTest(latest.id); }
    });
    document.addEventListener("change", (e) => {
      const el = e.target;
      if (el.id === "ht-site") {
        ht.siteId = /^\d+$/.test(el.value) ? Number(el.value) : el.value;
        ht.open = null;
        UI.pickSite(hostShown());
        ht.lastPicked = UI.siteHostPicked();
        loadTests().then(paint).catch((err) => COMP.fail(err)).then(() => UI.$("#ht-site")?.focus());
        return;
      }
      if (el.id === "ht-monthly") {
        const s = site();
        COMP.api("PATCH", `health/sites/${s.id}`, { monthly: el.checked }).then((answer) => {
          Object.assign(s, answer);
          paint();
          UI.$("#ht-monthly")?.focus();
          UI.toast(UI.t(answer.monthly ? "Weekly test on" : "Weekly test off"), { kind: "info" });
        }).catch((err) => { el.checked = !el.checked; COMP.fail(err); });
      }
    });
    // A check that's open stays open when the screen is redrawn.
    document.addEventListener("toggle", (e) => {
      const code = e.target.dataset?.htCheck;
      if (!code) return;
      if (e.target.open) ht.openChecks.add(code); else ht.openChecks.delete(code);
    }, true);
    window.addEventListener("seocc:attention-seen", (e) => {
      const match = String(e.detail?.id).match(/^alert-(\d+)$/);
      if (match) setSeen(Number(match[1]), Boolean(e.detail.seen));
    });
    window.addEventListener("seocc:site-added", (e) => {
      if (e.detail?.kind !== "own") return;
      if (ht.server === false) sample.addSite(e.detail);
      ht.added.push(e.detail.id);
      ht.siteId = e.detail.id;
      ht.open = null;
      if (ht.started) loadAll();
    });
  }

  window.HealthTest = {
    showCheck(code) { ht.openChecks.add(code); },
    checkWord: (code) => CHECK_WORDS[code] || code, // a check's name, for the task panel's Technical list

    shownAudit: () => ht.open?.audit?.id ?? null, // export.js: the test on screen
    init(helpers) {
      UI = helpers;
      bindEvents();
      TP.on(PAGES.index, () => { const box = UI.$("#ht-indexing"); if (box) UI.setHTML(box, indexingInner()); }); // only its card, as it loads on its own
      [PAGES.few, PAGES.linksIn, PAGES.history, ...SM_CODES.map(smKey)].forEach((key) => TP.on(key, paint));
      COMP.isServer().then((server) => {
        ht.server = server;
        ht.firstRun = UI.state.firstRun;
        loadAlerts();
        keepAlertsFresh();
      });
    },
    body() {
      // The mockup's First run switch, as a plain file: start again with what's now true.
      if (ht.server === false && ht.firstRun !== UI.state.firstRun) { ht.firstRun = UI.state.firstRun; ht.started = false; ht.ready = false; ht.siteId = null; ht.open = null; }
      // The site picked in the side menu leads, as it does on the Competitors screen.
      const picked = UI.siteHostPicked();
      if (ht.ready && picked !== ht.lastPicked) {
        ht.lastPicked = picked;
        const match = picked && ht.sites.find((s) => s.host === picked);
        if (match && !sameId(match.id, ht.siteId)) { ht.siteId = match.id; ht.open = null; ht.started = false; ht.ready = false; }
      }
      return `<div id="ht-root">${view()}</div>`;
    },
    after() {
      if (!ht.started) {
        ht.started = true;
        ht.lastPicked = UI.siteHostPicked();
        COMP.isServer().then((server) => {
          ht.server = server;
          ht.firstRun = UI.state.firstRun;
          return loadAll();
        });
        return;
      }
      paintProgress();
    },
    openAlerts: () => openAlerts().filter((a) => !a.kind.startsWith("backlink_")).length,
    reloadAlerts: () => loadAlerts(),
    // The same banner, for the alerts that belong on the Uptime tab.
    bannersFor: (siteId, kinds) => openAlerts().filter((a) => kinds.includes(a.kind) && sameId(a.site_id, siteId) && !UI.state.seen.has(`alert-${a.id}`)).map(bannerHtml).join(""),
  };

  // ---- opened as a plain file: the sample answers, and a test that plays out on screen -----------
  const sample = (() => {
    let nextId = 9000;
    const get = () => window.COMP_SAMPLE.get;
    const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const refusal = (message, status = 400) => Object.assign(new Error(message), { status });
    const sites = () => get()["health/sites"].sites;
    const find = (id) => { const s = sites().find((x) => sameId(x.id, id)); if (!s) throw refusal("That website doesn't exist.", 404); return s; };
    const list = (id) => { const key = `health/sites/${id}/audits`; if (!get()[key]) get()[key] = { audits: [] }; return get()[key].audits; };
    const nextMonth = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 7)).toISOString().replace(/\.\d+Z$/, "Z"); }; // weekly since 2026-11-24
    // The alerts the sample starts with, seen or not. The answer for GET alerts only holds the open ones.
    let allAlerts = null;
    const alerts = () => { if (!allAlerts) allAlerts = get().alerts.alerts.slice(); return allAlerts; };

    function start(id) {
      const s = find(id), audits = list(id);
      if (audits.some(isActive)) throw refusal("A health test of this website is already running.", 409);
      const last = audits.find((a) => a.status === "complete");
      const lastDetail = last ? get()[`health/audits/${last.id}`] : null;
      const known = last ? last.pages_read : 12; // how many pages this sample website has
      const audit = { id: nextId++, site_id: s.id, status: "queued", trigger: "button", max_pages: null, score: null, stop_reason: null, stop_requested: false, pages_read: 0, pages_seen: 0, skipped_robots: 0, pages_not_read: 0, stopped_at_limit: false, requests_used: 0, paused_until: null, counts: last ? { ...last.counts } : {}, site_problems: last ? [...last.site_problems] : [], error: null, created_at: now(), finished_at: null };
      const checks = lastDetail ? lastDetail.checks.map((c) => ({ ...c, previous: c.count })) : Object.entries(CHECK_WORDS).map(([code, meaning]) => ({ code, meaning, severity: "info", weight: 1, count: 0, pages: [], previous: null }));
      const detail = { audit: { ...audit, host: s.host }, previous_score: last ? last.score : null, checks, site_problems: lastDetail ? lastDetail.site_problems.slice() : [] };
      get()[`health/audits/${audit.id}`] = detail;
      audits.unshift(audit);
      const finish = (status, reason) => {
        const score = last ? last.score : 92;
        Object.assign(audit, { status, stop_reason: reason, score, pages_not_read: known - audit.pages_read, skipped_robots: 1, finished_at: now() });
        Object.assign(detail.audit, audit);
        if (status === "complete") Object.assign(s, { last_score: score, last_tested_at: audit.finished_at, next_test_at: s.monthly ? nextMonth() : null });
      };
      const step = () => {
        if (audit.stop_requested) { finish("stopped", "user"); return; }
        audit.status = "running";
        if (audit.pages_read >= known) { finish("complete", null); return; }
        audit.pages_read += 1;
        audit.pages_seen = audit.pages_read;
        audit.pages_not_read = Math.min(known - audit.pages_read, audit.pages_read * 3 + 2); // more pages come to light as it reads
        audit.requests_used += 1;
        Object.assign(detail.audit, audit);
        setTimeout(step, UI.reduceMotion() ? 40 : 450);
      };
      setTimeout(step, 500);
      return { audit_id: audit.id };
    }

    COMP.sampleWrite("POST health/audit", (match, body) => start(body.site_id));
    COMP.sampleWrite("POST health/audits/(\\d+)/stop", (match) => {
      const detail = get()[`health/audits/${match[1]}`];
      if (!detail) throw refusal("That test doesn't exist.", 404);
      const audit = list(detail.audit.site_id).find((a) => a.id === detail.audit.id);
      if (!isActive(audit)) throw refusal("That test has already finished.", 409);
      audit.stop_requested = true;
      detail.audit.stop_requested = true;
      return { ok: true };
    });
    COMP.sampleWrite("PATCH health/sites/([^/]+)", (match, body) => {
      const s = find(match[1]);
      if (body.monthly !== undefined) {
        s.monthly = body.monthly;
        s.next_test_at = s.monthly && s.last_tested_at ? nextMonth() : null;
      }
      return { ...s };
    });
    COMP.sampleWrite("POST alerts/(\\d+)/seen", (match, body) => {
      const alert = alerts().find((a) => a.id === Number(match[1]));
      if (!alert) throw refusal("That alert doesn't exist.", 404);
      alert.seen = body?.seen !== false;
      get().alerts.alerts = alerts().filter((a) => !a.seen);
      const s = sites().find((x) => sameId(x.id, alert.site_id));
      if (s) s.open_alerts = alerts().filter((a) => !a.seen && a.site_id === alert.site_id).length;
      return { ok: true };
    });
    return {
      addSite(added) {
        if (sites().some((x) => sameId(x.id, added.id))) return;
        sites().push({ id: added.id, host: added.host, monthly: true, max_pages: null, last_score: null, last_tested_at: null, next_test_at: null, open_alerts: 0 });
        sites().sort((a, b) => a.host.localeCompare(b.host));
      },
    };
  })();

  Object.assign(window.FR, {
    "Search pages or what Google says": "Rechercher une page ou ce que dit Google", "Search pages": "Rechercher une page", "No page matches.": "Aucune page ne correspond.",
    "{sent} of {total}, most clicks first": "{sent} sur {total}, les plus cliquées d'abord", "{sent} of {total}, fewest links in first": "{sent} sur {total}, les moins liées d'abord",
    "tests": "tests",
    "Restore them, or redirect to the closest page.": "Rétablissez-les, ou redirigez vers la page la plus proche.",
    "Fix or remove each link.": "Corrigez ou retirez chaque lien.",
    "Have the server error log checked.": "Faites vérifier le journal d'erreurs du serveur.",
    "Remove noindex if they should be found.": "Retirez noindex si elles doivent être trouvées.",
    "Unless intended, point each page to itself.": "Sauf si c'est voulu, faites pointer chaque page vers elle-même.",
    "Write a title for each page.": "Rédigez un titre pour chaque page.", "Give each page its own title.": "Donnez à chaque page son propre titre.",
    "Add one main heading to each page.": "Ajoutez un titre principal à chaque page.", "Keep one main heading; make the rest subheadings.": "Gardez un seul titre principal ; passez les autres en sous-titres.",
    "Write a meta description for each page.": "Rédigez une meta description pour chaque page.", "Give each page its own meta description.": "Donnez à chaque page sa propre méta-description.",
    "Describe each image in its alt text.": "Décrivez chaque image dans son texte alternatif.", "Add useful text, or noindex these pages.": "Ajoutez du texte utile, ou passez ces pages en noindex.",
    "Link straight to the final address.": "Faites pointer le lien directement vers l'adresse finale.", "Check images and scripts, then hosting.": "Vérifiez images et scripts, puis l'hébergement.",
    "Check the hosting first.": "Vérifiez d'abord l'hébergement.",
    "Remove its noindex, unless the site should stay hidden.": "Retirez sa balise noindex, sauf si le site doit rester caché.",
    "Have robots.txt fixed.": "Faites réparer robots.txt.",
    "Renew the certificate now.": "Renouvelez le certificat maintenant.", "Renew it, or check auto-renewal is on.": "Renouvelez-le, ou vérifiez que le renouvellement automatique est actif.",
    "Have the host check the certificate.": "Faites vérifier le certificat par l'hébergeur.", "Test of": "Test du",
    "Health test": "Test de santé",
    "Health test.": "Test de santé.",
    "Critical": "Critique",
    "Warning": "Avertissement",
    "Info": "Info",
    "Error pages": "Pages en erreur",
    "Broken links": "Liens cassés",
    "Server errors": "Erreurs serveur",
    "Hidden from search engines": "Cachées aux moteurs de recherche",
    "Canonical points elsewhere": "Canonique vers une autre page",
    "No title": "Pas de titre",
    "Duplicate titles": "Titres en double",
    "No main heading (H1)": "Pas de titre principal (H1)",
    "Several main headings": "Plusieurs titres principaux",
    "No meta description": "Pas de méta-description",
    "Duplicate meta descriptions": "Méta-descriptions en double",
    "Images missing alt text": "Images sans texte alternatif",
    "Almost no text": "Presque pas de texte",
    "More than 2 redirects": "Plus de 2 redirections",
    "Slower than 5 seconds": "Plus de 5 secondes",
    "Blocked by robots.txt": "Bloquées par robots.txt",
    "Search engines can't read these. If one should be found, remove its Disallow line in robots.txt. Not scored.": "Les moteurs ne peuvent pas les lire. Si une doit être trouvée, retirez sa ligne Disallow dans robots.txt. Sans effet sur le score.",
    "Start page didn't load": "La page de départ n'a pas chargé",
    "Start page hidden from search engines": "Page de départ cachée aux moteurs de recherche",
    "Certificate expired": "Certificat expiré",
    "Certificate expires within 14 days": "Le certificat expire sous 14 jours",
    "Certificate couldn't be verified": "Certificat non vérifiable",
    "What got worse": "Ce qui s'est dégradé",
    "What's wrong": "Ce qui ne va pas",
    "The test couldn't finish. Press Refresh.": "Le test n'a pas pu se terminer. Appuyez sur Actualiser.",
    "Health score": "Score de santé",
    "/100": "/100",
    "Better is higher.": "Plus c'est haut, mieux c'est.",
    "No change": "Pas de changement",
    "since last test": "depuis le dernier test",
    "First test: nothing to compare yet.": "Premier test : rien à comparer.",
    
    "Partial test": "Test partiel",
    
    "Score over the last tests": "Score des derniers tests",
    "tests, dates below": "tests, dates ci-dessous",
    "Trend shows after 2 full tests.": "La courbe apparaît après 2 tests complets.",
    "First test running.": "Premier test en cours.",
    "No score: this test failed.": "Pas de score : ce test a échoué.",
    "No score yet. Press Refresh.": "Pas encore de score. Appuyez sur Actualiser.",
    "Runs every week.": "Se lance chaque semaine.",
    "Runs only by hand.": "Se lance seulement à la main.",
    "Last test": "Dernier test",
    "No test yet.": "Pas encore de test.",
    "Next test": "Prochain test le",
    "First test: next weekly run.": "Premier test : prochain passage hebdomadaire.",
    "On this Mac, press Refresh.": "Sur ce Mac, appuyez sur Actualiser.",
    "Test weekly": "Tester chaque semaine",
    "Keeps going if you leave.": "Continue même si vous quittez la page.",
    "This test failed.": "Ce test a échoué.",
    "Test incomplete.": "Test incomplet.",
    "Whole-site problems": "Problèmes sur tout le site",
    "found": "trouvés",
    "None found": "Aucun trouvé",
    "Start page and certificate checked.": "Page de départ et certificat vérifiés.",
    "Start page checked. Stopped before the certificate.": "Page de départ vérifiée. Arrêté avant le certificat.",
    "Not compared": "Non comparé",
    "worse": "pire",
    "better": "mieux",
    "more": "de plus",
    "Checks": "Vérifications",
    "with problems": "avec des problèmes",
    "Problem": "Problème",
    "Severity": "Gravité",
    "Pages": "Pages",
    "Since last test": "Depuis le dernier test",
    "No problems found.": "Aucun problème trouvé.",
    "check passed": "vérification réussie",
    "checks passed": "vérifications réussies",
    "Stopped by you": "Arrêté par vous",
    "How": "Comment",
    "Score": "Score",
    "Monthly": "Mensuel",
    "By hand": "À la main",
    "partial": "partiel",
    "No tests yet.": "Pas encore de test.",
    "Add your own site first.": "Ajoutez d'abord votre propre site.",
    "Viewing an older test.": "Vous consultez un test plus ancien.",
    "Latest test": "Dernier test",
    "Weekly test on": "Test hebdomadaire activé",
    "Weekly test off": "Test hebdomadaire désactivé", "Automatic": "Automatique", "The weekly test only runs on the hosted version.": "Le test hebdomadaire ne tourne que sur la version hébergée.",
    "Technical checks of the pages read.": "Contrôles techniques des pages lues.", "page isn't on Google": "page n'est pas sur Google", "pages aren't on Google": "pages ne sont pas sur Google", "See them": "Les voir",
    "Health test finished": "Test de santé terminé",
    "Health test stopped": "Test de santé arrêté",
    "Health test failed": "Test de santé échoué",
    "On Google": "Sur Google", "Search Console, page by page": "Search Console, page par page",
    "Connect Search Console to see this.": "Connectez Search Console pour voir ceci.",
    "No pages read yet.": "Aucune page lue pour l'instant.",
    "No page checked yet.": "Aucune page vérifiée pour l'instant.",
    "page checked is on Google.": "page vérifiée est sur Google.", "pages checked are on Google.": "pages vérifiées sont sur Google.",
    "isn't (why below).": "n'y est pas (raison ci-dessous).", "aren't (why below).": "n'y sont pas (raisons ci-dessous).",
    "still to check": "encore à vérifier", "Google says": "Google dit", "Asked on": "Demandé le", "Google prefers": "Google préfère",
    "Internal links": "Liens internes", "page read": "page lue", "pages read": "pages lues", "Links in": "Liens entrants",
    "sitemap page has no link from another page.": "page du sitemap n'a aucun lien depuis une autre page.",
    "sitemap pages have no link from another page.": "pages du sitemap n'ont aucun lien depuis une autre page.",
    "Every sitemap page is linked from another page.": "Chaque page du sitemap reçoit un lien d'une autre page.",
    "No sitemap found.": "Aucun sitemap trouvé.",
    "page with Google visits has": "page avec des visites Google a", "pages with Google visits have": "pages avec des visites Google ont",
    "links in or fewer: link to them from related pages.": "liens entrants ou moins : ajoutez des liens depuis des pages proches.",
    "Pages with Google visits all have links in.": "Les pages qui reçoivent des visites Google ont toutes des liens entrants.",
    "Show all pages": "Afficher toutes les pages", "Linked from nowhere": "Liées de nulle part",
    "Links in per page": "Liens entrants par page", "Sitemap only partly read: list may be incomplete.": "Sitemap lu en partie : liste peut-être incomplète.",
    "Lost track of the health test. Reload the page.": "Suivi du test de santé perdu. Rechargez la page.",
    "A health test of this website is already running.": "Un test de santé de ce site est déjà en cours.",
    "That test has already finished.": "Ce test est déjà terminé.",
    "That test doesn't exist.": "Ce test n'existe pas.",
    "That alert doesn't exist.": "Cette alerte n'existe pas.",
    "The health test only runs on your own websites.": "Le test de santé ne s'exécute que sur vos propres sites.",
    // The Sitemap card
    "Sitemap": "Sitemap", "The sitemap couldn't be read.": "Le sitemap n'a pas pu être lu.", "problem": "problème", "problems": "problèmes", "OK": "OK",
    "page listed": "page listée", "pages listed": "pages listées", "file": "fichier", "files": "fichiers", "Count": "Nombre", "File": "Fichier",
    "Not checked in this test.": "Pas vérifié dans ce test.", "Press Refresh to check the sitemap.": "Appuyez sur Actualiser pour vérifier le sitemap.",
    "The site asked us to slow down, so part of the sitemap wasn't read.": "Le site nous a demandé de ralentir : une partie du sitemap n'a pas été lue.",
    "The next test tries again.": "Le prochain test réessaiera.",
    "Part of the sitemap couldn't be read, so missing pages aren't listed.": "Une partie du sitemap n'a pas pu être lue : les pages absentes ne sont donc pas listées.",
    "listed page wasn't checked this time.": "page listée n'a pas été vérifiée cette fois.", "listed pages weren't checked this time.": "pages listées n'ont pas été vérifiées cette fois.",
    "Show the files read": "Afficher les fichiers lus", "Hide the files": "Masquer les fichiers", "index": "index",
    "Every listed page says": "Chaque page listée indique", "Answer": "Réponse", "Goes to": "Va vers", "Date": "Date", "Clicks": "Clics",
    "{sent} of {total}": "{sent} sur {total}",
    "Not found": "Introuvable", "No answer": "Pas de réponse", "Refused us": "Nous a refusés", "Error answer": "Réponse en erreur",
    "Too many redirects": "Trop de redirections", "Goes to another site": "Va vers un autre site", "Redirects": "Redirige", "No content": "Pas de contenu",
    "No sitemap found": "Aucun sitemap trouvé", "Sitemap can't be reached": "Sitemap inaccessible", "Sitemap isn't valid XML": "Le sitemap n'est pas un XML valide",
    "Sitemap over 50,000 pages or 50 MB": "Sitemap de plus de 50 000 pages ou 50 Mo", "Sitemap not named in robots.txt": "Sitemap absent du robots.txt",
    "Listed pages that give an error": "Pages listées en erreur", "Listed pages that redirect": "Pages listées qui redirigent",
    "Listed pages hidden from search engines": "Pages listées cachées aux moteurs de recherche", "Listed pages blocked by robots.txt": "Pages listées bloquées par robots.txt",
    "Listed pages whose canonical points elsewhere": "Pages listées dont la canonique pointe ailleurs", "Important pages missing from the sitemap": "Pages importantes absentes du sitemap",
    "Dates in the future": "Dates dans le futur", "Every page has the same date": "Toutes les pages ont la même date",
    "Create a sitemap, then name it in robots.txt.": "Créez un sitemap, puis indiquez-le dans robots.txt.",
    "Make the sitemap address answer, or fix it in robots.txt.": "Faites répondre l'adresse du sitemap, ou corrigez-la dans robots.txt.",
    "Have the sitemap rebuilt by the site or its SEO plugin.": "Faites régénérer le sitemap par le site ou son extension SEO.",
    "Split it into smaller sitemaps under one index file.": "Découpez-le en sitemaps plus petits, réunis par un fichier index.",
    "Add a Sitemap: line to robots.txt. Not scored.": "Ajoutez une ligne Sitemap: dans robots.txt. Sans effet sur le score.",
    "Take them out of the sitemap, or bring the pages back.": "Retirez-les du sitemap, ou remettez les pages en ligne.",
    "List the address each one goes to instead.": "Listez plutôt l'adresse vers laquelle chacune redirige.",
    "Take them out of the sitemap, or remove noindex.": "Retirez-les du sitemap, ou enlevez le noindex.",
    "Take them out of the sitemap, or allow them in robots.txt.": "Retirez-les du sitemap, ou autorisez-les dans robots.txt.",
    "List the canonical address instead.": "Listez plutôt l'adresse canonique.",
    "Add these pages to the sitemap.": "Ajoutez ces pages au sitemap.",
    "Each date should be when its page last changed. Not scored.": "Chaque date doit être celle de la dernière modification de sa page. Sans effet sur le score.",
    "Give each page the date it last changed. Not scored.": "Donnez à chaque page la date de sa dernière modification. Sans effet sur le score.",
  });
})();
