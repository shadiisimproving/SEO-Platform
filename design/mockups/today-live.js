/* Today on real data. Only used when served by the app: as a plain file, the sample Today stays. */
(() => {
  "use strict";
  if (!window.BOOT) return;
  let UI, t, esc;
  const T = { key: null, data: null, error: "", summary: {}, at: 0 };
  const KINDS = { new_page: "New page", page_gone: "Page removed", title: "Title changed", meta: "Meta description changed", h1: "Main heading changed", headings: "Headings changed", content: "Content changed", canonical: "Canonical changed", schema: "Structured data changed", links: "Links changed", redirect: "Redirect changed", status: "Page status changed", robots: "Indexing changed" };

  const words = (title) => {
    if (UI.state.lang !== "fr") return title;
    let m;
    if ((m = title.match(/^Clarity data lost in (\d+) h$/))) return `Données Clarity perdues dans ${m[1]} h`;
    if ((m = title.match(/^(.+): the security certificate expires on (.+)$/))) return `${m[1]} : le certificat de sécurité expire le ${m[2]}`;
    if ((m = title.match(/^(.+): the security certificate has expired$/))) return `${m[1]} : le certificat de sécurité a expiré`;
    if ((m = title.match(/^(.+): the domain name expires on (.+)$/))) return `${m[1]} : le nom de domaine expire le ${m[2]}`;
    if ((m = title.match(/^(.+): the domain name has expired$/))) return `${m[1]} : le nom de domaine a expiré`;
    if ((m = title.match(/^(.+): health fell from (\d+) to (\d+)$/))) return `${m[1]} : la santé est passée de ${m[2]} à ${m[3]}`;
    if ((m = title.match(/^(.+) stopped working on (\d+) sites$/))) return `${m[1]} ne fonctionne plus sur ${m[2]} sites`;
    if ((m = title.match(/^(.+) stopped working$/))) return `${m[1]} ne fonctionne plus`;
    if ((m = title.match(/^(.+) lost (\d+)% of its Google clicks$/))) return `${m[1]} a perdu ${m[2]} % de ses clics Google`;
    if ((m = title.match(/^Last 7 days against the 7 before: (.+)$/))) return `7 derniers jours contre les 7 précédents : ${m[1]}`;
    if ((m = title.match(/^A background job stopped: (.+)$/))) return `Une tâche de fond s'est arrêtée : ${m[1]}`;
    return t(title);
  };
  const ago = (minutes) => {
    if (minutes === null || minutes === undefined) return "";
    if (minutes < 1) return t("just now");
    const word = minutes < 60 ? `${minutes} min` : minutes < 2880 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} ${t("d")}`;
    return UI.state.lang === "fr" ? `il y a ${word}` : `${word} ago`;
  };
  const when = (iso) => { if (!iso) return ""; const m = Math.round((Date.now() - new Date(iso)) / 60000); return ago(Math.max(m, 0)); };

  async function load() {
    const site = UI.siteIdPicked(), query = site ? `?site_id=${site}` : "";
    T.key = query; T.at = Date.now();
    try {
      const [data, summary] = await Promise.all([
        window.COMP.api("GET", `today${query}`),
        window.COMP.api("GET", `backlinks/summary${site ? `?site_id=${site}` : ""}`).catch(() => null),
      ]);
      if (T.key !== query) return; // another site was picked while this was on its way
      T.data = data; T.summary = summary || {}; T.error = "";
      window.ATTENTION = data.todo.map((a) => ({ id: a.id, sev: a.severity, title: a.title, detail: a.detail, host: a.host, act: "Open", key: a.kind }));
    } catch (err) {
      if (T.key !== query) return;
      T.error = err.message;
    }
    if (UI.state.route === "today" && !UI.$("#panel")) UI.render();
  }

  const MAIN_WORD = { source_failing: "Fix", backlink_lost: "Review", backlink_changed: "Review", page_drop: "See page" };
  const todoItem = (a) => {
    const title = words(a.title), detail = a.detail ? words(a.detail) : "";
    return {
      id: a.id, severity: a.severity, kind: a.kind, title, detail, host: a.host,
      seenAttr: a.alert_ids ? `data-lv-seen="${esc(a.alert_ids.join(","))}"` : a.seen_key ? `data-lv-drop="${esc(a.seen_key)}"` : "",
      mainHtml: `<a class="btn btn-small" href="${esc(a.link || "#today")}">${t(MAIN_WORD[a.kind] || "Open")}</a>`,
      find: { title, host: a.host || null, priority: a.severity === "crit" ? "high" : "medium", ...(a.page ? { pages: [a.page] } : {}), source: { type: "alert", label: title, host: a.host || undefined, facts: detail ? [detail] : [], link: a.link, key: a.seen_key ? `drop|${a.seen_key}` : `alert|${a.kind}|${a.host || ""}|${a.title}` } },
    };
  };
  const pathOf = (url) => { try { return new URL(url).pathname || "/"; } catch { return url; } };
  const siteToPick = (host) => window.SITES.find((s) => s.host === host)?.id;

  function view(d) {
    const stale = d.lanes.filter((l) => l.stale);
    return window.TodayView.page({
      results: d.results, googleStopped: d.google_stopped, todo: d.todo.map(todoItem), goingDown: d.going_down, goingUp: d.going_up, otherEdits: d.other_edits,
      rivals: d.rival_changes.map((c) => ({ ...c, label: t(KINDS[c.kind] || c.kind), path: pathOf(c.url), my_path: pathOf(c.my_url), when: when(c.when) })),
      followUp: T.summary.follow_up, renewals: T.summary.renewals_30d,
      sources: { ok: d.sources.filter((s) => s.ok).length, total: d.sources.length, connectAttr: 'data-lv-connect="google"', note: stale.length ? `${t("Background work")}: ${t("Last ran")} ${ago(stale[0].minutes) || t("never")}` : "" },
      sites: d.sites.map((s) => ({ ...s, pick: siteToPick(s.host) })),
    });
  }

  function page() {
    const site = UI.siteIdPicked(), query = site ? `?site_id=${site}` : "";
    if (T.key !== query || Date.now() - T.at > 10000) load(); // coming back to Today shows what's true now
    const head = UI.topbar(t("Today"), esc(new Intl.DateTimeFormat(UI.locale(), { weekday: "long", day: "numeric", month: "long" }).format(new Date())), "", false);
    const setup = UI.setupCard();
    if (!window.SITES.length) return `${head}<div class="content page-enter">${setup}</div>`;
    if (T.error && !T.data) return `${head}<div class="content page-enter">${setup}<section class="card"><div class="empty"><h3>${t("That didn't load")}</h3><p>${esc(T.error)}</p></div></section></div>`;
    if (!T.data) return `${head}<div class="content page-enter">${setup}<section class="card" aria-busy="true"><div class="empty"><p>${t("Loading…")}</p></div></section></div>`;
    return `${head}<div class="content page-enter">${setup}${view(T.data)}</div>`;
  }

  window.SCREENS = window.SCREENS || {};
  window.SCREENS.today = {
    init(helpers) {
      UI = helpers; ({ t, esc } = helpers);
      document.addEventListener("click", async (e) => {
        const el = e.target.closest?.("[data-lv-seen], [data-lv-drop]");
        if (!el) return;
        const { lvSeen, lvDrop } = el.dataset;
        // A source failing on several sites is one row, so its mark covers them all.
        const send = (seen) => (lvDrop ? window.COMP.api("POST", "today/seen", { key: lvDrop, seen }) : Promise.all(lvSeen.split(",").map((id) => window.COMP.api("POST", `alerts/${id}/seen`, { seen }))));
        el.disabled = true;
        try {
          await send(true);
          await load();
          UI.toast(t("Marked as seen"), { undo: async () => { await send(false); await load(); UI.toast(t("Restored"), { kind: "info" }); } });
        } catch (err) { el.disabled = false; UI.toast(err.message, { kind: "crit" }); }
      });
      window.addEventListener("seocc:site-added", () => { T.key = null; });
      window.addEventListener("seocc:sources-changed", () => { T.key = null; });
      window.addEventListener("seocc:alerts-changed", () => { T.key = null; });
      load();
    },
    page,
  };
  const fr = {
    "just now": "à l'instant", "See page": "Voir la page",
    "Background work": "Tâches de fond", "Last ran": "Dernier passage", "never": "jamais", "Marked as seen": "Marqué comme vu",
    "New page": "Nouvelle page", "Page removed": "Page retirée", "Title changed": "Titre modifié", "Meta description changed": "Méta description modifiée", "Main heading changed": "Titre principal modifié", "Headings changed": "Titres modifiés", "Content changed": "Contenu modifié", "Canonical changed": "Canonique modifiée", "Structured data changed": "Données structurées modifiées", "Links changed": "Liens modifiés", "Redirect changed": "Redirection modifiée", "Page status changed": "Statut de la page modifié", "Indexing changed": "Indexation modifiée",
  };
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
