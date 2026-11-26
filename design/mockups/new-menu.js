/* The new side menu (owner, 2026-11-24: "Yes, build it"). Twenty items become nine areas, and a screen that moved lives
   as a tab of its area: nothing is deleted. Plan: ~/.claude/plans/plan-seo-command-center-full-ui-ux-redesign-2026-11-24.md.

   Switch: on by default since 2026-11-26 (owner: "i like it deploy all places"). ?new=0 or the account menu's "Use the old design"
   turns it off in this browser (localStorage seocc-newmenu = "0"), ?new=1 back on. Off, the app is exactly as before.
   On, html[data-newmenu] is set, the side menu lists the areas, and a row of area tabs sits under the screen's head.

   A tab is a route (a screen of window.SCREENS or the shell's own) or a Competitors tab (comp): Keyword check and AI Overview
   watch moved to Keywords, Link gaps to Links. The Competitors screen hides those three from its own tab row (competitors.js).
   Addresses don't change, so old links, bookmarks, bell notifications and task links still open the same screen. */
(() => {
  const KEY = "seocc-newmenu";
  try {
    const q = new URLSearchParams(location.search).get("new");
    if (q === "1") localStorage.setItem(KEY, "1");
    if (q === "0") localStorage.setItem(KEY, "0");
  } catch (err) { /* private mode: the switch only lasts for this page */ }
  // Looks: ?brand=ocean (look-ocean.css, the pick) or navy|midnight|graphite|ink (brand-looks.css, compared earlier), ?brand=0 back to Clear.
  try {
    const b = new URLSearchParams(location.search).get("brand");
    if (["navy", "midnight", "graphite", "ink", "ocean"].includes(b)) localStorage.setItem("seocc-brand", b);
    if (b === "0") localStorage.setItem("seocc-brand", "0");
    // Ocean (look-ocean.css, picked 2026-11-26) comes with the new menu unless ?brand=0 asked for Clear.
    const kept = localStorage.getItem("seocc-brand");
    const menuOn = localStorage.getItem(KEY) !== "0";
    const look = kept && kept !== "0" ? kept : (menuOn && kept !== "0" ? "ocean" : null);
    if (look) document.documentElement.dataset.brand = look;
  } catch (err) { /* private mode */ }
  const on = () => { try { return new URLSearchParams(location.search).get("new") === "1" || localStorage.getItem(KEY) !== "0"; } catch { return true; } };
  if (on()) document.documentElement.dataset.newmenu = "1";

  // label, route, Competitors tab id (only for the three tabs that moved out of Competitors)
  const AREAS = [
    { id: "today", label: "Today", icon: "layout-dashboard", tabs: [["Today", "today"]] },
    { group: "Results" },
    { id: "traffic", label: "Traffic", icon: "activity", tabs: [["Channels", "channels"], ["Leads", "conversions"]] },
    { id: "search", label: "Search", icon: "search", tabs: [["Overview", "overview"], ["Insights", "insights"]] },
    { id: "keywords", label: "Keywords", icon: "key-round", tabs: [["Positions", "keywords"], ["Check any keyword", "competitors", "check"], ["AI Overview watch", "competitors", "ai"]] },
    { id: "pages", label: "Pages", icon: "layers", tabs: [["Pages", "pages"], ["Content", "content"], ["Site map", "map"], ["Site health", "health"]] },
    { group: "Market" },
    { id: "competitors", label: "Competitors", icon: "crosshair", tabs: [["Competitors", "competitors"]] },
    { id: "links", label: "Links", icon: "link-2", tabs: [["Backlinks", "backlinks"], ["Link gaps", "competitors", "gaps"]] },
    { id: "ai", label: "AI search", icon: "sparkles", tabs: [["AI search", "ai"]] },
    { group: "Team" },
    { id: "work", label: "Work", icon: "square-check", tabs: [["Tasks", "tasks"], ["Notes", "notes"], ["Resources", "resources"], ["Social", "social"]] },
  ];
  const MOVED = new Set(["check", "ai", "gaps"]); // Competitors tabs that now live in another area

  // The side menu is drawn before Competitors takes the picked site, so a moved tab with a site picked counts at once.
  const compTab = () => {
    try {
      if (MOVED.has(window.COMP?.tab) && window.UI?.siteHostPicked?.()) return COMP.tab;
      return window.COMP?.currentTab?.()?.id || window.COMP?.tab || null;
    } catch { return null; }
  };
  const tabOf = (route, comp) => {
    for (const a of AREAS) {
      if (!a.tabs) continue;
      const i = a.tabs.findIndex(([, r, c]) => r === route && (c ? c === comp : !(route === "competitors" && MOVED.has(comp))));
      if (i >= 0) return { area: a, index: i };
    }
    return null;
  };
  const areaOf = (route) => tabOf(route, route === "competitors" ? compTab() : null)?.area || null;
  const mayRoute = (route, built) => built.has(route) && (!window.ACCESS || window.ACCESS.can(route));
  const tabsFor = (a, built) => a.tabs.filter(([, r]) => mayRoute(r, built));

  /* Open a tab: a Competitors tab is chosen first, then the screen opens as the side menu always did (go keeps the site). */
  /* A Competitors tab opens through its address (#competitors/gaps?site=…), exactly as the app's own links to it always did:
     on All sites that address takes a site, where setting the tab directly fell back to the All-my-sites summary. */
  function open(route, comp) {
    const UI = window.UI;
    let host = UI.siteHostPicked?.();
    // These tabs work on one site. On All sites, the site last used (or the oldest) is picked, and said out loud, as
    // Competitors already does when one of its tabs moves the app to one site.
    if (comp && !host) {
      const sites = window.SITES || [];
      const last = UI.store?.get?.("lastSite");
      host = (sites.find((s) => s.host === last) || sites[0])?.host || null;
      if (host) UI.toast(UI.t("Now showing {site} across the app").replace("{site}", host), { kind: "info" });
    }
    const site = host ? `?site=${encodeURIComponent(host)}` : "";
    if (comp) { location.hash = `#competitors/${comp}${site}`; return; }
    if (route === "competitors" && window.COMP && MOVED.has(COMP.tab)) { location.hash = `#competitors/summary${site}`; return; }
    UI.go(route);
  }

  /* The side menu's items, drawn by renderSidebar in mockup.js with its own button markup. */
  function sideItems(built) {
    const out = [];
    AREAS.forEach((a) => {
      if (a.group) { out.push({ group: a.group }); return; }
      const tabs = tabsFor(a, built);
      if (tabs.length) out.push({ id: a.id, label: a.label, icon: a.icon, route: tabs[0][1], comp: tabs[0][2] || "" });
    });
    for (let i = out.length - 1; i >= 0; i -= 1) if (out[i].group && (!out[i + 1] || out[i + 1].group)) out.splice(i, 1);
    return out;
  }

  /* The area's tabs, under the screen's head. One tab only: no row. */
  function decorate(page, route, built) {
    if (!on() || !page) return;
    const found = tabOf(route, route === "competitors" ? compTab() : null);
    if (!found) return;
    const tabs = tabsFor(found.area, built);
    if (tabs.length < 2) return;
    const { t } = window.UI;
    const current = found.area.tabs[found.index];
    const row = document.createElement("nav");
    row.className = "page-tabs area-tabs";
    row.setAttribute("aria-label", t(found.area.label));
    tabs.forEach(([label, r, c]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "page-tab";
      b.dataset.nmRoute = r;
      if (c) b.dataset.nmComp = c;
      if (current[1] === r && (current[2] || "") === (c || "")) b.setAttribute("aria-current", "page");
      b.textContent = t(label);
      row.append(b);
    });
    const head = page.querySelector("#topbar");
    if (head) head.after(row); else page.prepend(row);
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-nm-route]");
    if (!b || !on()) return;
    e.preventDefault();
    e.stopPropagation();
    open(b.dataset.nmRoute, b.dataset.nmComp || null);
  }, true);

  // Words for the areas and tabs that the app didn't have yet.
  window.FR = window.FR || {};
  Object.entries({ Results: "Résultats", Market: "Marché", Team: "Équipe", Traffic: "Trafic", Search: "Recherche", Links: "Liens", Work: "Travail", Leads: "Demandes", "Check any keyword": "Vérifier un mot-clé" })
    .forEach(([k, v]) => { if (!(k in window.FR)) window.FR[k] = v; });

  /* The way back (owner, 2026-11-26: "we will have option to return to the old design"): one item in the account menu
     switches the new menu and the new look together, kept in this browser, and the page draws again. */
  const designOn = () => on() && document.documentElement.dataset.brand === "ocean";
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-design]");
    if (!b) return;
    try {
      if (b.dataset.design === "old") { localStorage.setItem(KEY, "0"); localStorage.setItem("seocc-brand", "0"); }
      else { localStorage.setItem(KEY, "1"); localStorage.setItem("seocc-brand", "ocean"); }
    } catch { /* private mode: nothing to keep */ }
    const url = new URL(location.href);
    url.searchParams.delete("new"); url.searchParams.delete("brand");
    // Same address: only the hash would move, so the page wouldn't load again by itself.
    if (url.toString() === location.href) location.reload(); else location.replace(url.toString());
  });
  Object.entries({ "Use the old design": "Revenir à l'ancien design", "Use the new design": "Passer au nouveau design" }).forEach(([k, v]) => { if (!(k in window.FR)) window.FR[k] = v; });

  window.NEWMENU = { on, designOn, AREAS, MOVED, areaOf, sideItems, decorate, open, isMoved: (id) => MOVED.has(id) };
})();
