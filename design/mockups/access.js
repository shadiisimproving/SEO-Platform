/* Chosen access on the screens: which sections, sites and buttons a person sees (seo/accounts/access.py is the guard).

   BOOT.user.access is null for full access (admins, and members made before this existed), or
   { sites: [ids], sections: { key: "view" | "edit" }, spend: bool }. BOOT.sites already holds only their sites.

   ACCESS.can(section)        they may open it
   ACCESS.canEdit(section)    they may change things there (else the screen is View only)
   ACCESS.canSpend()          paid searches, Firecrawl, AI answers, Moz
   ACCESS.everySite()         changes every site shares (link-gap domain edits, mediators, page reads, adding a site)
   ACCESS.limited             true for chosen access
   ACCESS.first()             the first section they have, for the landing page
   ACCESS.noAccess(err)       true when an API answer was a no-access refusal, so callers stop asking again

   Hiding a button only keeps the screen honest: the server refuses anything not theirs whatever the screen shows. */
(function () {
  const ORDER = ["today", "channels", "conversions", "content", "overview", "pages", "map", "insights", "keywords", "competitors", "ai", "ads", "tasks", "notes", "social", "backlinks", "resources", "health"];
  const user = window.BOOT?.user || null;
  const chosen = user && user.role !== "admin" ? user.access || null : null;
  const level = (section) => (chosen ? chosen.sections?.[section] || null : "edit");
  const ownCount = (window.BOOT?.sites || []).length;

  const ACCESS = {
    limited: Boolean(chosen),
    sections: ORDER,
    can(section) {
      if (!chosen) return true;
      if (section === "settings") return true; // their own account only: settings-live.js shows nothing else
      return Boolean(level(section));
    },
    canEdit(section) { return !chosen || level(section) === "edit"; },
    canSpend() { return !chosen || chosen.spend === true; },
    // BOOT.sites is already cut to their sites, so this compares with the server's own answer at load.
    everySite() { return !chosen || Boolean(window.BOOT?.every_site); },
    canAdmin() { return !user || user.role === "admin"; },
    first() { return ORDER.find((s) => ACCESS.can(s)) || "settings"; },
    noAccess(err) { return Boolean(err && (err.noAccess || err.data?.no_access || err.status === 403 && /access/i.test(err.message || ""))); },
    siteCount: ownCount,
    allows(method, path) { return allows(method, path); },
  };

  /* Which sections an API address serves, for the screens only (seo/accounts/endpoints.py is the real list). A call the
     person can't make is refused here without asking the server, so background loaders on every page (alerts, tasks,
     the bell, prospects...) stay quiet instead of filling the console with refusals. An address not listed here goes to
     the server, which decides. Longest prefix first. */
  const TRAFFIC = ["channels", "conversions", "content", "today"];
  const PATHS = [
    ["today", ["today"]], ["alerts", ["health", "today"]], ["tasks", ["tasks", "today"]],
    ["prospects", ["competitors", "backlinks"]], ["mediators", ["backlinks"]], ["refresh/", ["keywords", "competitors", "ai"]],
    ["uptime/", ["health"]], ["health/", ["health"]], ["links/scan", ["health"]], ["notifications", ["overview", "keywords", "social"]], ["social/", ["social"]],
    ["notes", ["notes"]], ["note-files", ["notes"]], ["rankings", ["keywords", "competitors", "tasks", "ai", "today"]], ["rank-trends", ["keywords", "overview"]],
    ["collective/", ["competitors"]], ["link-gaps", ["competitors"]], ["page-pairs", ["competitors"]], ["site-pages", ["pages"]], ["tasks/options", ["tasks"]], ["keyword-check", ["competitors"]],
    ["keywords/", ["competitors"]], ["ai-watch", ["competitors", "ai"]], ["resources", ["resources"]], ["insights", ["insights", "today"]],
    ["backlinks/summary", ["backlinks", "today"]], ["backlinks", ["backlinks", "competitors"]], ["metrics/ads", ["ads", "today"]],
    ["metrics/ai", ["ai", "today"]], ["metrics/channels", TRAFFIC], ["metrics/conversions", TRAFFIC], ["metrics/content", TRAFFIC],
  ];
  const ADMIN_ONLY = ["sources", "app-keys", "google-connections", "clarity-archive", "clarity-reports", "team/", "tools/order", "tools/settings"];
  function allows(method, path) {
    if (!chosen) return true;
    const bare = String(path || "").replace(/^\/?(api\/)?/, "").split("?")[0];
    if (method !== "GET" && (ADMIN_ONLY.some((p) => bare.startsWith(p)) || bare === "team")) return false;
    const found = PATHS.filter(([prefix]) => bare.startsWith(prefix)).sort((a, b) => b[0].length - a[0].length)[0];
    if (!found) return true;
    // Marking a notification read is this person's own; marking an alert or a Today row seen is for the whole team: a change.
    const edit = method !== "GET" && !/^notifications\/.*(read|read-all)$|^refresh\/preview|^keyword-check\/estimate/.test(bare);
    return found[1].some((section) => (edit ? ACCESS.canEdit(section) : ACCESS.can(section)));
  }
  window.ACCESS = ACCESS;
})();
