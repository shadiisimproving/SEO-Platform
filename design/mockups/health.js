/* Site health: the monthly health test, its alert banners, and the same alerts on Today.

   Plugged in through window.HealthTest (see healthPage and render in mockup.js). body() returns straight away and
   after() fills it in. While a test runs, only the numbers change, so focus isn't lost. It talks through COMP.api,
   which answers from comp-sample-data.js when the page is opened as a plain file.
   The test only ever looks at my own websites, from a site ID. No AI anywhere here. */
(() => {
  "use strict";
  const COMP = window.COMP;
  let UI = null;
  const POLL_MS = 1500, SIMILAR_SIZE = 0.5;

  // The same plain words as seo/health/audit.py, so an alert can say them without loading its whole test.
  const CHECK_WORDS = {
    broken_pages: "Pages that answer with an error", broken_links: "Links to pages that don't exist", server_errors: "Pages the server failed to answer",
    noindex: "Pages hidden from search engines", canonical_elsewhere: "Pages that point search engines to another page", no_title: "Pages with no title",
    duplicate_title: "Pages sharing the same title", no_h1: "Pages with no main heading (H1)", many_h1: "Pages with more than one main heading",
    no_meta: "Pages with no meta description", duplicate_meta: "Pages sharing the same meta description", images_no_alt: "Pages with images missing alt text",
    almost_no_text: "Pages with almost no readable text", redirect_chains: "Links that go through more than 2 redirects", slow_pages: "Pages slower than 5 seconds",
  };
  const SITE_WORDS = {
    start_page_down: "The start page didn't load", start_page_noindex: "The start page is hidden from search engines", ssl_expired: "The security certificate has expired",
    ssl_expiring: "The security certificate expires within 14 days", ssl_error: "The security certificate couldn't be verified",
  };
  const SEVERITY = { crit: "Critical", warn: "Warning", info: "Info" };
  const UPTIME_KINDS = ["uptime_down", "ssl_expiry", "domain_expiry"];
  const isTestAlert = (a) => a.kind.startsWith("health_");

  const ht = {
    started: false, ready: false, failed: "", server: null, firstRun: null, sites: [], siteId: null, added: [], alerts: [], audits: [], open: null, activeId: null, active: null,
    timer: null, stopping: false, openChecks: new Set(), lastPicked: null,
  };
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
    const d = a.detail || {}, fr = window.FR, name = "Monthly health test.", nameFr = fr[name];
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

  async function loadAlerts() {
    try {
      const answer = await COMP.api("GET", "alerts");
      ht.alerts = answer.alerts || [];
    } catch { return; } // the page still works, and the next test tries again
    refreshAlertViews();
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
    clearTimeout(ht.timer);
    if (id === null) { ht.audits = []; ht.open = null; ht.activeId = null; ht.active = null; return; }
    const { audits } = await COMP.api("GET", `health/sites/${id}/audits`);
    if (!sameId(ht.siteId, id)) return;
    ht.audits = audits;
    const running = audits.find(isActive);
    ht.activeId = running ? running.id : null;
    ht.active = running || null;
    ht.stopping = Boolean(running?.stop_requested);
    const wanted = openId ?? audits.find((a) => !isActive(a))?.id ?? null;
    ht.open = wanted === null ? null : await COMP.api("GET", `health/audits/${wanted}`);
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
  }

  function poll() {
    clearTimeout(ht.timer);
    ht.timer = setTimeout(async () => {
      const id = ht.activeId;
      if (!id) return;
      let data;
      try { data = await COMP.api("GET", `health/audits/${id}`); } catch { poll(); return; }
      if (ht.activeId !== id) return;
      ht.active = data.audit;
      if (isActive(data.audit)) { paintProgress(); poll(); return; }
      ht.activeId = null;
      ht.active = null;
      ht.stopping = false;
      await Promise.all([loadAll({ openId: id }), loadAlerts()]);
      const status = data.audit.status;
      UI.toast(UI.t(status === "complete" ? "Health test finished" : status === "stopped" ? "Health test stopped" : "Health test failed"), { kind: status === "failed" ? "crit" : status === "stopped" ? "info" : "good" });
    }, POLL_MS);
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
      ${a.kind === "health_failed" ? `<p class="small sec ht-alert-text">${t("The test couldn't finish. Try it again with Run now.")}</p>` : ""}
    </section>`;
  }

  function comparison(d) {
    const a = d.audit;
    if (isPartial(a) || a.status !== "complete") return { kind: "partial" };
    if (d.previous_score === null || d.previous_score === undefined) return { kind: "first" };
    const prev = ht.audits.find((x) => x.id < a.id && x.status === "complete" && x.score !== null);
    if (prev?.pages_read) {
      const ratio = (a.pages_read || 0) / prev.pages_read;
      if (ratio < SIMILAR_SIZE || ratio > 1 / SIMILAR_SIZE) return { kind: "different", why: "The last test read far fewer or far more pages, so the two can't be compared." };
    }
    return { kind: "change", change: a.score - d.previous_score, prev };
  }

  function scoreCard() {
    const { t, num, esc, status } = UI;
    const d = ht.open, a = d?.audit;
    const graded = ht.audits.filter((x) => x.status === "complete" && x.score !== null).map((x) => x.score).reverse();
    const trend = graded.length >= 2
      ? `<div class="ht-trend">${UI.spark(graded, { w: 320, h: 56, area: true })}<span class="sr">${t("Score over the last tests")}: ${graded.join(", ")}</span><p class="small muted">${num(graded.length)} ${t("tests, dates in the table below")}</p></div>`
      : `<p class="small muted ht-trend">${t("The trend line starts after 2 full tests.")}</p>`;
    if (!a || a.score === null || a.score === undefined) {
      const words = ht.activeId && !a ? "The first test is running." : a?.status === "failed" ? "No score: this test failed." : "No score yet. Press Run now for the first test.";
      return `<section class="card ht-score"><div class="ht-score-head"><h2 class="ht-sub">${t("Health score")}</h2></div><p class="sec ht-none-yet">${t(words)}</p></section>`;
    }
    const cmp = comparison(d);
    let change = "";
    if (cmp.kind === "change") {
      const word = cmp.change === 0 ? `<span class="sec d-pill">${t("No change")}</span>` : UI.delta(cmp.change);
      change = `${word}<span class="small muted">${t("since the last test")}${cmp.prev ? `, ${esc(UI.fmtDateOnly(cmp.prev.created_at))}` : ""}</span>`;
    } else if (cmp.kind === "first") change = `<span class="small muted">${t("First test, so nothing to compare with yet.")}</span>`;
    else if (cmp.kind === "different") change = `<span class="small muted">${t(cmp.why)}</span>`;
    else change = `${status("warn", t("Partial test"))}<span class="small muted">${t("It only covers what it read, so it isn't compared.")}</span>`;
    return `<section class="card ht-score" aria-label="${t("Health score")}">
      <div class="ht-score-head"><h2 class="ht-sub">${t("Health score")}</h2><span class="small muted">${esc(UI.fmtDateOnly(a.finished_at || a.created_at))}</span></div>
      <div class="ht-fig"><span class="ht-num tabular" id="ht-score">${num(a.score)}</span><span class="sec">${t("out of 100")}</span></div>
      <p class="small muted">${t("Better is higher.")}</p>
      <div class="ht-change">${change}</div>
      ${trend}
    </section>`;
  }

  function planCard(s) {
    const { t, esc, icon } = UI;
    const busy = Boolean(ht.activeId);
    const last = s.last_tested_at ? `${t("Last test")} ${esc(COMP.ago(s.last_tested_at))}.` : t("No test yet.");
    const next = !s.monthly ? "" : s.next_test_at ? `${t("Next test")} ${esc(fmtDayMonth(s.next_test_at))}.` : t("First test at the next monthly run.");
    return `<section class="card ht-plan">
      <p id="ht-line">${t(s.monthly ? "Runs by itself once a month." : "Runs only when you press Run now.")} ${last} ${next}</p>
      <p class="note ht-mac">${icon("info")}<span>${t("The monthly test runs on the hosted version. Here, press Run now.")}</span></p>
      <label class="opt ht-monthly"><input type="checkbox" class="chk" style="margin:0" id="ht-monthly" ${s.monthly ? "checked" : ""}>${t("Test this website once a month")}</label>
      <div class="lc-form ht-run-row">
        <button class="btn btn-main" id="ht-run" ${busy ? "disabled" : ""}>${icon("refresh-cw")}${t("Run now")}</button>
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
    text.textContent = ht.stopping ? t("Stopping after this request…") : paused ? t(UI.BUDGET_PAUSE_WORDS) : a.status === "queued" ? t("Waiting for the worker to start…") : readingWords(read, left);
    UI.$("#ht-progress-sub").textContent = paused ? readingWords(read, left) : t("You can leave this page: it keeps going.");
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
    if (a.stop_reason === "user") out.push(["warn", `${t("Stopped by you after")} ${num(a.pages_read)} ${t(a.pages_read === 1 ? "page" : "pages")}. ${t("This test is not complete.")}`]);
    if (a.skipped_robots) out.push(["info", `${t("skipped by robots.txt")}: ${num(a.skipped_robots)}`]);
    return out;
  }
  const noticeHtml = ([kind, text]) => `<p class="note ${kind === "info" ? "" : kind}">${UI.icon(kind === "crit" ? "octagon-alert" : kind === "warn" ? "triangle-alert" : "info")}<span>${UI.esc(text)}</span></p>`;

  function wholeSiteCard(d) {
    const { t, esc, status, num } = UI;
    const list = d.site_problems || [];
    return `<section class="card ht-whole">
      <div class="card-head"><h2>${t("Whole-site problems")}</h2><span class="end">${list.length ? status("crit", `${num(list.length)} ${t("found")}`) : status("good", t("None found"))}</span></div>
      ${list.length ? `<ul class="rows">${list.map((p) => `<li>${status("crit", t("Critical"))}<div class="what"><div class="t">${esc(t(p.meaning))}</div>${FIX_WORDS[p.code] ? `<div class="d">${t(FIX_WORDS[p.code])}</div>` : ""}</div><div class="acts">${UI.taskButton(healthFind(p.code, p.meaning, [d.audit?.created_at ? `${t("Test of")} ${UI.fmtDateOnly(d.audit.created_at)}` : ""]))}</div></li>`).join("")}</ul>` : ""}
      <p class="help ht-foot">${t(d.audit.status === "stopped" ? "The start page is checked. A test that was stopped doesn't get as far as the security certificate. Uptime and domain expiry aren't part of this test." : "The start page and the security certificate are checked. Uptime and domain expiry aren't part of this test.")}</p>
    </section>`;
  }

  function changeCell(c, compared) {
    const { t, num, icon } = UI;
    if (!compared || c.previous === null || c.previous === undefined) return `<span class="muted small">${t("Not compared")}</span>`;
    const moved = c.count - c.previous;
    if (moved === 0) return `<span class="sec small">${t("No change")}</span>`;
    return moved > 0
      ? `<span class="crit d-pill">${icon("arrow-up")}+${num(moved)} ${t("worse")}</span>`
      : `<span class="good d-pill">${icon("arrow-down")}−${num(-moved)} ${t("better")}</span>`;
  }

  // What to do about each finding, in a line. Whoever gets the task starts from here.
  const FIX_WORDS = {
    broken_pages: "Restore these pages, or redirect them to the closest page that exists.",
    broken_links: "Change each link to a page that exists, or remove it.",
    server_errors: "Ask whoever runs the server to check its error log. These pages can vanish from search while it lasts.",
    noindex: "If these pages should be found, remove the noindex tag.",
    canonical_elsewhere: "Check that each page should point to the other one. If not, point it to itself.",
    no_title: "Write a title for each page.",
    duplicate_title: "Give each page a title of its own.",
    no_h1: "Add one main heading to each page.",
    many_h1: "Keep one main heading on each page, and turn the others into subheadings.",
    no_meta: "Write a meta description for each page.",
    duplicate_meta: "Give each page a meta description of its own.",
    images_no_alt: "Describe each image in its alt text.",
    almost_no_text: "Add useful text, or stop these pages being indexed.",
    redirect_chains: "Link straight to the final address.",
    slow_pages: "Check image sizes and scripts first, then the hosting.",
    start_page_down: "Check the hosting first: nothing else on the site can be read while this lasts.",
    start_page_noindex: "Remove the noindex tag from the start page, unless the whole site should stay hidden.",
    robots_down: "Ask whoever runs the server to fix robots.txt. Search engines stay away until it answers.",
    ssl_expired: "Renew the certificate now: browsers are warning visitors away.",
    ssl_expiring: "Renew the certificate, or check that automatic renewal is on.",
    ssl_error: "Ask whoever runs the hosting to check the certificate.",
  };
  const hostShown = () => ht.sites.find((s) => sameId(s.id, ht.siteId))?.host;
  function healthFind(code, meaning, facts) {
    const { t } = UI, host = hostShown();
    // By site and check, not by test: next month's test finding the same thing is still the same job.
    return { title: `${t(meaning)}: ${host || ""}`, host, description: FIX_WORDS[code] ? t(FIX_WORDS[code]) : "", source: { type: "health", label: t(meaning), host, facts: facts.filter(Boolean), link: `#health/test/${code}`, key: `health|${ht.siteId}|${code}` } };
  }

  function checkRow(c, compared) {
    const { t, esc, icon, num, status } = UI;
    const sev = c.severity === "crit" ? "crit" : c.severity === "warn" ? "warn" : "info";
    const pages = (c.pages || []).map((p) => `<li>${COMP.link(p)}</li>`).join("");
    const more = c.count - (c.pages || []).length;
    return `<details class="ht-check" data-ht-check="${esc(c.code)}" ${ht.openChecks.has(c.code) ? "open" : ""}>
      <summary><span class="ht-check-what">${icon("chevron-right", "ht-chev")}<span>${esc(t(c.meaning))}</span></span>
        <span class="ht-check-sev">${status(sev, t(SEVERITY[sev]))}</span>
        <span class="ht-check-count tabular">${num(c.count)} ${t(c.count === 1 ? "page" : "pages")}</span>
        <span class="ht-check-change">${changeCell(c, compared)}</span></summary>
      <ul class="ht-pages">${pages}${more > 0 ? `<li class="small muted">${t("and")} ${num(more)} ${t("more")}</li>` : ""}</ul>
      <div class="ht-check-act">
        ${FIX_WORDS[c.code] ? `<p class="small sec">${t(FIX_WORDS[c.code])}</p>` : ""}
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
      ${found.length ? `<div class="ht-check-heads small muted" aria-hidden="true"><span>${t("What it looks at")}</span><span>${t("Severity")}</span><span>${t("Pages affected")}</span><span>${t("Since last test")}</span></div>${found.map((c) => checkRow(c, compared)).join("")}` : `<p class="lc-none small sec">${t("This test found no problems on these pages.")}</p>`}
      ${clean.length ? `<details class="ht-clean" data-ht-check="clean" ${ht.openChecks.has("clean") ? "open" : ""}><summary>${icon("chevron-right", "ht-chev")}${num(clean.length)} ${t(clean.length === 1 ? "check with nothing found" : "checks with nothing found")}</summary><ul class="ht-clean-list">${clean.map(cleanRow).join("")}</ul></details>` : ""}
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
    return `<section class="card ht-history" aria-label="${t("History")}">
      <div class="card-head"><h2>${t("History")}</h2><span class="end small muted">${esc(site()?.host || "")}</span></div>
      ${ht.audits.length ? `<table class="data lc-table" id="ht-history"><thead><tr><th scope="col">${t("Date")}</th><th scope="col">${t("How it ran")}</th><th scope="col" class="r">${t("Score")}</th><th scope="col" class="r">${t("Pages")}</th><th scope="col">${t("Result")}</th><th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead><tbody>
        ${ht.audits.map((a) => `<tr ${isActive(a) ? 'style="cursor:default"' : `data-ht-row="${a.id}"`} class="${ht.open?.audit.id === a.id ? "open" : ""}">
          <td class="head-cell" data-label="${t("Date")}">${esc(UI.fmtStamp(a.created_at))}</td>
          <td data-label="${t("How it ran")}">${t(a.trigger === "monthly" ? "Monthly" : "By hand")}</td>
          <td class="r" data-label="${t("Score")}">${a.score === null || a.score === undefined ? '<span class="muted">—</span>' : `${num(a.score)}${isPartial(a) ? ` <span class="tag">${t("partial")}</span>` : ""}`}</td>
          <td class="r" data-label="${t("Pages")}" ${isActive(a) ? "data-ht-live-pages" : ""}>${num(a.pages_read)}</td>
          <td data-label="${t("Result")}"><span class="small sec" ${isActive(a) ? "data-ht-live-word" : ""}>${esc(resultWord(a))}</span></td>
          <td class="r nowrap" data-label=""><button class="btn btn-small" data-ht-open="${a.id}" aria-label="${t("Open")}: ${esc(UI.fmtStamp(a.created_at))}" ${isActive(a) ? "disabled" : ""}>${t("Open")}</button></td>
        </tr>`).join("")}</tbody></table>` : `<p class="lc-none small muted">${t("No tests yet for this website.")}</p>`}
    </section>`;
  }

  function view() {
    const { t, esc, icon } = UI;
    if (!ht.ready) return `<div class="card"><div class="empty"><p>${t("Loading…")}</p></div></div>`;
    if (ht.failed) return `<div class="table-wrap"><div class="empty"><h3>${t("That didn't load")}</h3><p>${esc(t(ht.failed))}</p></div></div>`;
    if (!ht.sites.length) {
      return `<div class="table-wrap"><div class="empty" id="ht-empty"><h3>${t("No websites added yet")}</h3><p>${t("Add your own website, then test its health.")}</p><button class="btn btn-main" id="site-add">${icon("plus")}${t("Add a website")}</button></div></div>`;
    }
    const s = site();
    const a = ht.open?.audit;
    const latest = ht.audits.find((x) => !isActive(x));
    const past = a && latest && a.id !== latest.id;
    const alerts = openAlerts().filter((x) => isTestAlert(x) && sameId(x.site_id, s.id) && !UI.state.seen.has(`alert-${x.id}`));
    return `<div class="comp-bar ht-bar"><label class="field comp-site"><span>${t("Website")}</span><select class="select" id="ht-site">${ht.sites.map((x) => `<option value="${esc(x.id)}" ${sameId(x.id, ht.siteId) ? "selected" : ""}>${esc(x.host)}</option>`).join("")}</select></label>${UI.showingNote(hostShown())}</div>
      ${alerts.map(bannerHtml).join("")}
      ${past ? `<p class="note ht-past">${icon("info")}<span>${t("You're looking at an older test.")} <button class="link-btn" data-ht-latest>${t("Back to the latest test")}</button></span></p>` : ""}
      <div class="ht-top">${scoreCard()}${planCard(s)}</div>
      ${progressHtml()}
      ${a ? notices(a).map(noticeHtml).join("") : ""}
      ${ht.open ? wholeSiteCard(ht.open) : ""}
      ${ht.open?.checks ? checksCard(ht.open) : ""}
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
    COMP.api("POST", `health/audits/${ht.activeId}/stop`).catch(() => {});
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
      if (target.closest?.("#ht-run")) { runTest(); return; }
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
          UI.toast(UI.t(answer.monthly ? "This website will be tested once a month" : "Monthly test turned off"), { kind: "info" });
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
    init(helpers) {
      UI = helpers;
      bindEvents();
      COMP.isServer().then((server) => {
        ht.server = server;
        ht.firstRun = UI.state.firstRun;
        loadAlerts();
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
    const nextMonth = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().replace(/\.\d+Z$/, "Z"); };
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
    "Restore these pages, or redirect them to the closest page that exists.": "Rétablissez ces pages, ou redirigez-les vers la page existante la plus proche.",
    "Change each link to a page that exists, or remove it.": "Faites pointer chaque lien vers une page existante, ou retirez-le.",
    "Ask whoever runs the server to check its error log. These pages can vanish from search while it lasts.": "Demandez à la personne qui gère le serveur de vérifier son journal d'erreurs. Ces pages peuvent disparaître des recherches tant que ça dure.",
    "If these pages should be found, remove the noindex tag.": "Si ces pages doivent être trouvées, retirez la balise noindex.",
    "Check that each page should point to the other one. If not, point it to itself.": "Vérifiez que chaque page doit bien pointer vers l'autre. Sinon, faites-la pointer vers elle-même.",
    "Write a title for each page.": "Rédigez un titre pour chaque page.", "Give each page a title of its own.": "Donnez à chaque page son propre titre.",
    "Add one main heading to each page.": "Ajoutez un titre principal à chaque page.", "Keep one main heading on each page, and turn the others into subheadings.": "Gardez un seul titre principal par page, et transformez les autres en sous-titres.",
    "Write a meta description for each page.": "Rédigez une meta description pour chaque page.", "Give each page a meta description of its own.": "Donnez à chaque page sa propre meta description.",
    "Describe each image in its alt text.": "Décrivez chaque image dans son texte alternatif.", "Add useful text, or stop these pages being indexed.": "Ajoutez du texte utile, ou empêchez l'indexation de ces pages.",
    "Link straight to the final address.": "Faites pointer le lien directement vers l'adresse finale.", "Check image sizes and scripts first, then the hosting.": "Vérifiez d'abord le poids des images et les scripts, puis l'hébergement.",
    "Check the hosting first: nothing else on the site can be read while this lasts.": "Vérifiez d'abord l'hébergement : rien d'autre sur le site ne peut être lu tant que ça dure.",
    "Remove the noindex tag from the start page, unless the whole site should stay hidden.": "Retirez la balise noindex de la page d'accueil, sauf si tout le site doit rester caché.",
    "Ask whoever runs the server to fix robots.txt. Search engines stay away until it answers.": "Demandez à la personne qui gère le serveur de réparer robots.txt. Les moteurs de recherche restent à l'écart tant qu'il ne répond pas.",
    "Renew the certificate now: browsers are warning visitors away.": "Renouvelez le certificat maintenant : les navigateurs découragent les visiteurs.", "Renew the certificate, or check that automatic renewal is on.": "Renouvelez le certificat, ou vérifiez que le renouvellement automatique est actif.",
    "Ask whoever runs the hosting to check the certificate.": "Demandez à la personne qui gère l'hébergement de vérifier le certificat.", "Test of": "Test du",
    "Monthly health test": "Test de santé mensuel",
    "Monthly health test.": "Test de santé mensuel.",
    "Critical": "Critique",
    "Warning": "Avertissement",
    "Info": "Info",
    "Pages that answer with an error": "Pages qui répondent par une erreur",
    "Links to pages that don't exist": "Liens vers des pages qui n'existent pas",
    "Pages the server failed to answer": "Pages auxquelles le serveur n'a pas su répondre",
    "Pages hidden from search engines": "Pages cachées aux moteurs de recherche",
    "Pages that point search engines to another page": "Pages qui renvoient les moteurs vers une autre page",
    "Pages with no title": "Pages sans titre",
    "Pages sharing the same title": "Pages avec le même titre",
    "Pages with no main heading (H1)": "Pages sans titre principal (H1)",
    "Pages with more than one main heading": "Pages avec plus d'un titre principal",
    "Pages with no meta description": "Pages sans méta-description",
    "Pages sharing the same meta description": "Pages avec la même méta-description",
    "Pages with images missing alt text": "Pages avec des images sans texte alternatif",
    "Pages with almost no readable text": "Pages presque sans texte lisible",
    "Links that go through more than 2 redirects": "Liens qui passent par plus de 2 redirections",
    "Pages slower than 5 seconds": "Pages de plus de 5 secondes",
    "The start page didn't load": "La page de départ n'a pas chargé",
    "The start page is hidden from search engines": "La page de départ est cachée aux moteurs de recherche",
    "The security certificate has expired": "Le certificat de sécurité a expiré",
    "The security certificate expires within 14 days": "Le certificat de sécurité expire dans moins de 14 jours",
    "The security certificate couldn't be verified": "Le certificat de sécurité n'a pas pu être vérifié",
    "What got worse": "Ce qui s'est dégradé",
    "What's wrong": "Ce qui ne va pas",
    "The test couldn't finish. Try it again with Run now.": "Le test n'a pas pu se terminer. Relancez-le avec Lancer.",
    "Health score": "Score de santé",
    "out of 100": "sur 100",
    "Better is higher.": "Plus c'est haut, mieux c'est.",
    "No change": "Pas de changement",
    "since the last test": "depuis le dernier test",
    "First test, so nothing to compare with yet.": "Premier test : rien à comparer pour l'instant.",
    "The last test read far fewer or far more pages, so the two can't be compared.": "Le dernier test a lu bien moins ou bien plus de pages : les deux ne se comparent pas.",
    "Partial test": "Test partiel",
    "It only covers what it read, so it isn't compared.": "Il ne couvre que ce qu'il a lu : il n'est donc pas comparé.",
    "Score over the last tests": "Score des derniers tests",
    "tests, dates in the table below": "tests, dates dans le tableau ci-dessous",
    "The trend line starts after 2 full tests.": "La courbe commence après 2 tests complets.",
    "The first test is running.": "Le premier test est en cours.",
    "No score: this test failed.": "Pas de score : ce test a échoué.",
    "No score yet. Press Run now for the first test.": "Pas encore de score. Appuyez sur Lancer pour le premier test.",
    "Runs by itself once a month.": "Se lance tout seul une fois par mois.",
    "Runs only when you press Run now.": "Se lance seulement quand vous appuyez sur Lancer.",
    "Last test": "Dernier test",
    "No test yet.": "Pas encore de test.",
    "Next test": "Prochain test le",
    "First test at the next monthly run.": "Premier test au prochain passage mensuel.",
    "The monthly test runs on the hosted version. Here, press Run now.": "Le test mensuel tourne sur la version hébergée. Ici, appuyez sur Lancer.",
    "Test this website once a month": "Tester ce site une fois par mois",
    "You can leave this page: it keeps going.": "Vous pouvez quitter cette page : le test continue.",
    "This test failed.": "Ce test a échoué.",
    "This test is not complete.": "Ce test n'est pas complet.",
    "Whole-site problems": "Problèmes sur tout le site",
    "found": "trouvés",
    "None found": "Aucun trouvé",
    "The start page and the security certificate are checked. Uptime and domain expiry aren't part of this test.": "La page de départ et le certificat de sécurité sont vérifiés. La disponibilité et l'expiration du domaine ne font pas partie de ce test.",
    "The start page is checked. A test that was stopped doesn't get as far as the security certificate. Uptime and domain expiry aren't part of this test.": "La page de départ est vérifiée. Un test arrêté ne va pas jusqu'au certificat de sécurité. La disponibilité et l'expiration du domaine ne font pas partie de ce test.",
    "Not compared": "Non comparé",
    "worse": "pire",
    "better": "mieux",
    "more": "de plus",
    "Checks": "Vérifications",
    "with problems": "avec des problèmes",
    "What it looks at": "Ce qu'il regarde",
    "Severity": "Gravité",
    "Pages affected": "Pages touchées",
    "Since last test": "Depuis le dernier test",
    "This test found no problems on these pages.": "Ce test n'a trouvé aucun problème sur ces pages.",
    "check with nothing found": "vérification sans problème",
    "checks with nothing found": "vérifications sans problème",
    "Stopped by you": "Arrêté par vous",
    "How it ran": "Comment il a tourné",
    "Score": "Score",
    "Monthly": "Mensuel",
    "By hand": "À la main",
    "partial": "partiel",
    "No tests yet for this website.": "Pas encore de test pour ce site.",
    "Add your own website, then test its health.": "Ajoutez votre site, puis testez sa santé.",
    "You're looking at an older test.": "Vous regardez un test plus ancien.",
    "Back to the latest test": "Revenir au dernier test",
    "This website will be tested once a month": "Ce site sera testé une fois par mois",
    "Monthly test turned off": "Test mensuel désactivé",
    "Health test finished": "Test de santé terminé",
    "Health test stopped": "Test de santé arrêté",
    "Health test failed": "Test de santé échoué",
    "A health test of this website is already running.": "Un test de santé de ce site est déjà en cours.",
    "That test has already finished.": "Ce test est déjà terminé.",
    "That test doesn't exist.": "Ce test n'existe pas.",
    "That alert doesn't exist.": "Cette alerte n'existe pas.",
    "The health test only runs on your own websites.": "Le test de santé ne s'exécute que sur vos propres sites.",
  });
})();
