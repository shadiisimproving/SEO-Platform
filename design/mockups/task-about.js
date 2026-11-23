/* What a task is about: pages, keywords, rankings, backlinks, linking websites, technical issues, competitors, notes,
   or nothing in particular (General). Several kinds at once; the first one picked is the task's main kind, shown on cards.
   Each kind's box lists what the app already knows for the task's site (GET tasks/options), shown as soon as it's clicked.
   Pages and keywords stay in their own lists (tasks.pages, tasks.keywords), so Related tasks keeps finding them; the
   rest go in tasks.about. Three hidden inputs hold it all, so panel drafts keep it like any other field. */
(() => {
  let UI, t, esc, icon, num;

  const KINDS = [
    // Five on the first line, then the link kinds side by side with Competitor and General.
    { id: "page", label: "Page", many: "Pages", icon: "file-text", hint: "Pick or type a page", typed: true },
    { id: "keyword", label: "Keyword", many: "Keywords", icon: "key-round", hint: "Pick or type a keyword", typed: true },
    { id: "ranking", label: "Ranking", many: "Rankings", icon: "trending-up", hint: "Pick a tracked keyword's position" },
    { id: "technical", label: "Technical", many: "Technical issues", icon: "heart-pulse", hint: "Pick an issue the checks found" },
    { id: "note", label: "Note", many: "Notes", icon: "sticky-note", hint: "Pick a note" },
    { id: "backlink", label: "Backlink", many: "Backlinks", icon: "link-2", hint: "Pick one of your backlinks" },
    { id: "domain", label: "Link to get", many: "Links to get", icon: "globe", hint: "Pick or type a website to get a link from", typed: true },
    { id: "competitor", label: "Competitor", many: "Competitors", icon: "crosshair", hint: "Pick a competitor" },
  ];
  const GENERAL = { id: "general", label: "General", icon: "circle-dot" };
  const kindOf = (id) => KINDS.find((k) => k.id === id) || (id === "general" ? GENERAL : null);
  const ENGINES = { google: "Google", bing: "Bing", yandex: "Yandex", duckduckgo: "DuckDuckGo" };

  let opened = new Set(); // kinds whose box is open in the panel on screen

  // ---- the values, kept in hidden inputs ---------------------------------------------------------
  const read = (id, empty) => { try { return JSON.parse(UI.$(`#${id}`)?.value || "") ?? empty; } catch { return empty; } };
  const pagesNow = () => read("task-pages", []);
  const keywordsNow = () => read("task-keywords", []);
  const aboutNow = () => { const a = read("task-about", null); return a && typeof a === "object" ? { main: a.main || "", items: Array.isArray(a.items) ? a.items : [] } : { main: "", items: [] }; };
  const write = (id, value) => { const el = UI.$(`#${id}`); if (el) el.value = JSON.stringify(value); };

  function valuesOf(kind) {
    if (kind === "page") return pagesNow();
    if (kind === "keyword") return keywordsNow();
    return aboutNow().items.filter((item) => item.kind === kind);
  }
  const hasAny = () => KINDS.some((k) => valuesOf(k.id).length);

  /* The main kind stays while it still holds something; otherwise the first kind that does. */
  function settleMain(justAdded) {
    const about = aboutNow();
    let main = about.main;
    if (justAdded && (!main || main === "general" || !valuesOf(main).length)) main = justAdded;
    if (main && main !== "general" && !valuesOf(main).length) main = KINDS.find((k) => valuesOf(k.id).length)?.id || "";
    write("task-about", { main, items: about.items });
  }

  const plain = (word) => String(word).trim().toLowerCase();
  function add(kind, value) {
    if (kind === "page" || kind === "keyword") {
      const id = kind === "page" ? "task-pages" : "task-keywords";
      const now = read(id, []);
      const words = kind === "keyword" ? String(value).split(/[,\n]+/) : [value];
      words.map((w) => w.trim()).filter(Boolean).forEach((w) => { if (!now.some((have) => plain(have) === plain(w))) now.push(w); });
      write(id, now);
    } else {
      const about = aboutNow();
      if (!about.items.some((item) => item.kind === kind && plain(item.ref) === plain(value.ref))) about.items.push({ kind, ref: String(value.ref), label: value.label });
      write("task-about", about);
    }
    settleMain(kind);
    drawChips(kind);
    drawKinds();
  }
  function remove(kind, index) {
    if (kind === "page" || kind === "keyword") {
      const id = kind === "page" ? "task-pages" : "task-keywords";
      const now = read(id, []);
      now.splice(index, 1);
      write(id, now);
    } else {
      const about = aboutNow();
      const mine = about.items.filter((item) => item.kind === kind);
      const gone = mine[index];
      write("task-about", { ...about, items: about.items.filter((item) => item !== gone) });
    }
    settleMain();
    drawChips(kind);
    drawKinds();
  }

  // ---- the lists to pick from --------------------------------------------------------------------
  const cache = new Map(); // site id: promise of tasks/options
  const siteNow = () => UI.$("#task-site")?.value || "";
  const sitesNow = () => {
    const sites = window.TASK_SITES?.() || [];
    return siteNow() ? sites.filter((s) => String(s.id) === siteNow()) : sites;
  };
  const optionsFor = (site) => {
    if (!cache.has(site.id)) cache.set(site.id, COMP.api("GET", `tasks/options?site_id=${site.id}`).catch(() => null));
    return cache.get(site.id);
  };
  const pathOf = (url) => { try { const u = new URL(url); return decodeURI(u.pathname) + u.search; } catch { return String(url || ""); } };
  const factNum = (n, word) => `<span class="tabular">${num(n)}</span> ${t(word)}`;

  function technicalLabel(item) {
    if (item.part === "health") return t(window.HealthTest?.checkWord?.(item.code) || item.code);
    if (item.part === "link") return `${t("Broken link")}: ${item.url}`;
    if (item.part === "index") return `${t("Not indexed")}: ${pathOf(item.url)}`;
    return `${t("Slow page")} (${t(item.code === "desktop" ? "computer" : "phone")}): ${pathOf(item.url)}`;
  }
  const VERDICTS = { counts: "Counts", weak: "Weak", none: "Doesn't count" };

  /* One site's options as picker rows for one kind. `many` adds the site's name when the task is for all sites. */
  function rowsOf(kind, data, host, many) {
    const where = (text) => (many ? [text, host].filter(Boolean).join(" · ") : text);
    if (kind === "page") return data.pages.map((p) => ({ key: p.url, value: p.url, label: pathOf(p.url), sub: where(p.title), fact: p.clicks ? factNum(p.clicks, p.clicks === 1 ? "click" : "clicks") : "" }));
    if (kind === "keyword") return data.keywords.map((k) => ({ key: k.keyword, value: k.keyword, label: k.keyword, sub: where(""), fact: k.impressions ? factNum(k.impressions, "impr.") : "" }));
    if (kind === "ranking") return data.rankings.map((r) => ({ key: r.ref, value: { ref: r.ref, label: `${r.keyword} · ${ENGINES[r.engine] || r.engine} #${r.position}` }, label: r.keyword, sub: where(ENGINES[r.engine] || r.engine), fact: `<span class="pl-pos tabular">#${esc(String(r.position))}</span>` }));
    if (kind === "backlink") return data.backlinks.map((b) => ({ key: String(b.id), value: { ref: b.id, label: b.target ? `${b.domain} → ${pathOf(b.target)}` : b.domain }, label: b.domain, sub: where(b.target ? `→ ${pathOf(b.target)}` : ""), fact: b.status === "lost" ? `<span class="pl-bad">${t("Lost")}</span>` : b.status === "planned" ? esc(t("To do")) : b.verdict ? esc(t(VERDICTS[b.verdict] || b.verdict)) : "" }));
    if (kind === "domain") return data.domains.map((d) => ({ key: d.domain, value: { ref: d.domain, label: d.domain }, label: d.domain, sub: where(d.where === "gap" ? `${t("Links to")} ${num(d.rivals || 1)} ${t(d.rivals === 1 ? "competitor" : "competitors")}` : t("In consideration")), fact: d.spam ? `<span class="pl-bad">${t("Spam")}</span>` : "" }));
    if (kind === "technical") return data.technical.map((x) => ({ key: x.ref, value: { ref: x.ref, label: technicalLabel(x) }, label: technicalLabel(x), sub: where(t({ health: "Health test", link: "Links check", index: "Google index", speed: "Page speed" }[x.part])), fact: x.part === "speed" ? `<span class="tabular">${num(x.count)}</span>/100` : x.count > 1 ? factNum(x.count, "pages") : "" }));
    if (kind === "competitor") return data.competitors.map((c) => ({ key: String(c.id), value: { ref: c.id, label: c.host }, label: c.host, sub: where(""), icon: UI.siteLogo ? UI.siteLogo(c.host, 16) : "" }));
    if (kind === "note") return data.notes.map((n) => ({ key: String(n.id), value: { ref: n.id, label: n.text || t("Note") }, label: n.text || t("(empty note)"), sub: where(t(n.scope === "page" ? "About a page" : n.scope === "keyword" ? "About a keyword" : "Note")) }));
    return [];
  }

  async function itemsFor(kind) {
    if (!UI.state.served) {
      // Opened as a plain file: the sample's keywords and pages only.
      const hosts = new Set(sitesNow().map((s) => s.host));
      const rows = (window.KEYWORDS || []).filter((row) => hosts.has(row.site));
      if (kind === "page") return [...new Set(rows.map((r) => r.page).filter(Boolean))].map((p) => ({ key: p, value: p, label: pathOf(p) }));
      if (kind === "keyword") return rows.map((r) => ({ key: r.k, value: r.k, label: r.k }));
      return [];
    }
    const sites = sitesNow();
    const answers = await Promise.all(sites.map(optionsFor));
    const taken = new Set(valuesOf(kind).map((v) => plain(typeof v === "string" ? v : v.ref)));
    const seen = new Set();
    return answers.flatMap((data, i) => (data ? rowsOf(kind, data, sites[i].host, sites.length > 1) : []))
      .filter((row) => { const k = plain(row.key); if (taken.has(k) || seen.has(k)) return false; seen.add(k); return true; });
  }

  const EMPTY = {
    page: "No pages known yet. Type an address, or connect Search Console.",
    keyword: "No tracked keywords yet. Type one.",
    ranking: "No rankings yet. Track keywords and press Refresh data.",
    backlink: "No backlinks on this site yet.",
    domain: "No link gaps or websites in consideration yet. Type a website.",
    technical: "No open issues: run the health test or the links check.",
    competitor: "No competitors for this site yet.",
    note: "No notes for this site yet.",
  };

  // ---- drawing -----------------------------------------------------------------------------------
  const hostNow = () => sitesNow().length === 1 ? sitesNow()[0].host : null;
  function chipHtml(kind, value, i) {
    const k = kindOf(kind);
    let inner;
    if (kind === "page") inner = PageLink.html(value, { host: hostNow(), text: hostNow() ? pathOf(value) : value });
    else if (kind === "keyword") inner = `<span>${KeywordLink.html(value, { host: hostNow() })}</span>`;
    else inner = `<span dir="auto">${esc(value.label || value.ref)}</span>`;
    const name = typeof value === "string" ? value : value.label || value.ref;
    return `<span class="tk-chip ta-chip">${icon(k.icon)}${inner}<button type="button" class="tk-chip-x" data-ta-remove="${kind}|${i}" aria-label="${t("Remove")}: ${esc(name)}">${icon("x")}</button></span>`;
  }
  function drawChips(kind) {
    const box = UI.$(`[data-ta-chips="${kind}"]`);
    if (box) UI.setHTML(box, valuesOf(kind).map((v, i) => chipHtml(kind, v, i)).join(""));
  }

  function kindButton(k) {
    const n = valuesOf(k.id).length, main = aboutNow().main === k.id;
    const pressed = k.id === "general" ? aboutNow().main === "general" && !hasAny() : opened.has(k.id) || n > 0;
    return `<button type="button" class="ta-kind${main ? " is-main" : ""}" data-ta-kind="${k.id}" aria-pressed="${pressed}"${k.id === "general" ? "" : ` aria-controls="ta-field-${k.id}"`}>${icon(k.icon)}<span>${t(k.label)}</span>${n ? `<span class="ta-n tabular">${num(n)}</span>` : ""}</button>`;
  }
  function drawKinds() {
    const box = UI.$("#ta-kinds");
    if (box) UI.setHTML(box, [...KINDS, GENERAL].map(kindButton).join(""));
    const help = UI.$("#ta-help");
    if (help) {
      const main = aboutNow().main;
      help.textContent = main === "general" && !hasAny() ? t("General: not linked to anything in the app.")
        : hasAny() ? `${t("Main")}: ${t(kindOf(main)?.label || "")}. ${t("Add more from any kind.")}` : t("Pick what this task is about. You can add several.");
    }
  }

  function fieldHtml(k) {
    return `<div class="ta-field" id="ta-field-${k.id}" data-ta-field="${k.id}">
      <div class="ta-field-head"><span class="lab">${icon(k.icon)}${t(k.many)}</span><button type="button" class="link-btn small" data-ta-close="${k.id}">${t("Close")}</button></div>
      <div class="ta-chips" data-ta-chips="${k.id}"></div>
      ${PickList.html({ id: `ta-pick-${k.id}`, placeholder: t(k.hint), label: t(k.many) })}
    </div>`;
  }
  function drawFields() {
    const box = UI.$("#ta-fields");
    if (!box) return;
    const show = KINDS.filter((k) => opened.has(k.id) || valuesOf(k.id).length);
    // Boxes already on screen stay, so a box being typed in never loses its focus.
    box.querySelectorAll("[data-ta-field]").forEach((el) => { if (!show.some((k) => k.id === el.dataset.taField)) el.remove(); });
    show.forEach((k, i) => {
      if (!UI.$(`#ta-field-${k.id}`)) {
        const holder = document.createElement("div");
        UI.setHTML(holder, fieldHtml(k));
        const next = show.slice(i + 1).map((n) => UI.$(`#ta-field-${n.id}`)).find(Boolean);
        const field = holder.firstElementChild;
        box.insertBefore(field, next || null);
        PickList.detach(field);
        PickList.set(`ta-pick-${k.id}`, {
          items: () => itemsFor(k.id),
          onPick: (row) => add(k.id, row.value),
          onTyped: k.typed ? (text) => add(k.id, k.id === "domain" ? { ref: text.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""), label: text } : text) : null,
          empty: t(EMPTY[k.id]),
        });
      }
      drawChips(k.id);
    });
  }

  /* The section, for the task panel. values: { pages, keywords, about }. */
  function html({ pages = [], keywords = [], about = null } = {}) {
    opened = new Set();
    const a = about && typeof about === "object" ? { main: about.main || "", items: about.items || [] } : { main: "", items: [] };
    return `<fieldset class="ta" id="task-about-box">
      <legend class="lab">${t("About")}</legend>
      <p class="help ta-help" id="ta-help"></p>
      <div class="ta-kinds" id="ta-kinds" role="group" aria-label="${t("What this task is about")}"></div>
      <div class="ta-fields" id="ta-fields"></div>
      <input type="hidden" id="task-pages" value="${esc(JSON.stringify(pages || []))}">
      <input type="hidden" id="task-keywords" value="${esc(JSON.stringify(keywords || []))}">
      <input type="hidden" id="task-about" value="${esc(JSON.stringify(a))}">
    </fieldset>`;
  }
  /* After the panel is drawn, or a draft put back. */
  function mount() { drawKinds(); drawFields(); }

  function siteChanged() {
    KINDS.forEach((k) => PickList.forget(`ta-pick-${k.id}`));
    KINDS.forEach((k) => drawChips(k.id));
  }

  /* What's saved. Words still typed in a page, keyword or website box are kept. */
  function values() {
    KINDS.filter((k) => k.typed).forEach((k) => {
      const input = UI.$(`#ta-pick-${k.id}`);
      const text = input?.value.trim();
      if (text) { input.value = ""; add(k.id, k.id === "domain" ? { ref: text.toLowerCase(), label: text } : text); }
    });
    const about = aboutNow();
    return { pages: pagesNow(), keywords: keywordsNow(), about: { main: about.main, items: about.items } };
  }

  /* The main kind, small, for cards and table rows. Empty for a task that predates it. */
  function tag(task) {
    const main = task.about?.main;
    const k = main && kindOf(main);
    if (!k) return "";
    const n = (task.pages || []).length + (task.keywords || []).length + (task.about?.items || []).length;
    const tip = n > 1 ? `${t("About")}: ${t(k.label)} ${t("and")} ${num(n - 1)} ${t("more")}` : `${t("About")}: ${t(k.label)}`;
    return `<span class="tag ta-tag" title="${esc(tip)}">${icon(k.icon)}${esc(t(k.label))}${n > 1 ? ` <span class="muted">+${num(n - 1)}</span>` : ""}</span>`;
  }
  /* What the task is linked to, for cards and table rows: one coloured pill per link with its kind in words inside
     ("Page /freezones/"), the main kind first, up to `max`, then "+N". Pages and keywords stay links.
     One colour per kind, from the Clear look: your pages blue, search words teal, competitors purple (the colour for
     "them" everywhere), links slate, notes and technical issues grey. The word says the kind, so colour only helps.
     `inline` is the table's layout: one line under the title. */
  const PILL_TONES = { page: "blue", keyword: "teal", ranking: "teal", competitor: "purple", backlink: "indigo", domain: "indigo", note: "grey", technical: "grey" };
  function linkLine(task, { max = 3, inline = false } = {}) {
    const main = task.about?.main;
    const host = task.site_host || null;
    const all = [
      ...(task.pages || []).map((ref) => ({ kind: "page", ref })),
      ...(task.keywords || []).map((ref) => ({ kind: "keyword", ref })),
      ...(task.about?.items || []).filter((item) => kindOf(item.kind)),
    ];
    if (!all.length) return "";
    const flat = KINDS.map((k) => all.filter((item) => item.kind === k.id))
      .sort((x, y) => (x[0]?.kind === main ? 0 : 1) - (y[0]?.kind === main ? 0 : 1)).flat();
    const nameOf = (item) => (item.kind === "page" ? pagePath(item.ref) : item.label || item.ref);
    const shown = flat.slice(0, max), others = flat.slice(max);
    const pill = (item) => {
      const k = kindOf(item.kind);
      const name = item.kind === "page" ? window.PageLink.html(item.ref, { host, text: pagePath(item.ref), cls: "ta-name" })
        : item.kind === "keyword" ? window.KeywordLink.html(item.ref, { host, cls: "ta-name" })
        : `<span class="ta-name" dir="auto">${esc(nameOf(item))}</span>`;
      return `<span class="ta-pill ta-tone-${PILL_TONES[item.kind] || "grey"}" data-ta-linked="${k.id}" title="${esc(`${t(k.label)}: ${nameOf(item)}`)}"><span class="ta-pill-k">${esc(t(k.label))}</span>${name}</span>`;
    };
    const pills = shown.map(pill);
    // "+N" travels with the last pill, so it never sits alone on a line of its own.
    if (others.length) pills.push(`<span class="ta-pill-end">${pills.pop()}<span class="ta-pill ta-pill-more tabular" title="${esc(others.map((item) => `${t(kindOf(item.kind).label)}: ${nameOf(item)}`).join("\n"))}">+${num(others.length)}</span></span>`);
    return `<div class="ta-pills${inline ? " ta-pills-inline" : ""}">${pills.join("")}</div>`;
  }
  /* A page as its path, so a card reads /freezones/ rather than the whole address. */
  const pagePath = (ref) => {
    const text = String(ref || "").replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./, "");
    const slash = text.indexOf("/");
    return text.includes(".") && slash > 0 ? text.slice(slash) || "/" : text.includes(".") && slash < 0 ? "/" : text;
  };
  /* Words a task can be searched by. */
  const words = (task) => (task.about?.items || []).map((item) => item.label).join(" ");

  function bind() {
    document.addEventListener("click", (e) => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el) return;
      let hit;
      if ((hit = el.closest("[data-ta-kind]"))) {
        const id = hit.dataset.taKind;
        if (id === "general") {
          const about = aboutNow();
          if (hasAny()) { UI.toast?.(t("Remove the links first to make this task general.")); return; }
          write("task-about", { ...about, main: about.main === "general" ? "" : "general" });
          drawKinds();
          return;
        }
        if (opened.has(id) && !valuesOf(id).length) { opened.delete(id); drawFields(); drawKinds(); return; }
        opened.add(id);
        drawFields();
        drawKinds();
        UI.$(`#ta-pick-${id}`)?.focus();
        return;
      }
      if ((hit = el.closest("[data-ta-close]"))) {
        const id = hit.dataset.taClose;
        opened.delete(id);
        if (!valuesOf(id).length) { drawFields(); drawKinds(); UI.$(`[data-ta-kind="${id}"]`)?.focus(); }
        else UI.$(`#ta-field-${id}`)?.querySelector(".pl-input")?.blur();
        return;
      }
      if ((hit = el.closest("[data-ta-remove]"))) {
        const [kind, index] = hit.dataset.taRemove.split("|");
        remove(kind, Number(index));
        if (valuesOf(kind).length || opened.has(kind)) UI.$(`#ta-pick-${kind}`)?.focus();
        else { opened.add(kind); drawFields(); UI.$(`#ta-pick-${kind}`)?.focus(); }
      }
    });
    document.addEventListener("keydown", (e) => {
      // Backspace in an empty box takes the last one back out.
      if (e.key !== "Backspace" || !(e.target instanceof Element) || !e.target.matches(".ta .pl-input") || e.target.value) return;
      const kind = e.target.id.replace("ta-pick-", "");
      const n = valuesOf(kind).length;
      if (n) remove(kind, n - 1);
    });
  }

  window.TaskAbout = {
    KINDS, html, mount, values, siteChanged, tag, linkLine, words,
    init(helpers) {
      UI = helpers; ({ t, esc, icon, num } = helpers);
      bind();
    },
  };

  const fr = {
    "About": "À propos de", "What this task is about": "Ce que concerne cette tâche", "Page": "Page", "Keyword": "Mot-clé", "Ranking": "Position", "Rankings": "Positions",
    "Backlink": "Backlink", "Backlinks": "Backlinks", "Link to get": "Lien à obtenir", "Links to get": "Liens à obtenir", "Pick or type a website to get a link from": "Choisissez ou saisissez un site dont obtenir un lien", "Technical": "Technique", "Technical issues": "Problèmes techniques",
    "Competitor": "Concurrent", "Competitors": "Concurrents", "Note": "Note", "Notes": "Notes", "General": "Général",
    "Pick or type a page": "Choisir ou saisir une page", "Pick or type a keyword": "Choisir ou saisir un mot-clé", "Pick a tracked keyword's position": "Choisir la position d'un mot-clé suivi",
    "Pick one of your backlinks": "Choisir un de vos backlinks", "Pick or type a website": "Choisir ou saisir un site", "Pick an issue the checks found": "Choisir un problème trouvé par les contrôles",
    "Pick a competitor": "Choisir un concurrent", "Pick a note": "Choisir une note", "Close": "Fermer",
    "General: not linked to anything in the app.": "Général : liée à rien de précis dans l'app.", "Main": "Principal", "Add more from any kind.": "Ajoutez-en d'autres, de tout type.",
    "Pick what this task is about. You can add several.": "Choisissez ce que concerne cette tâche. Vous pouvez en ajouter plusieurs.",
    "Remove the links first to make this task general.": "Retirez d'abord les liens pour rendre cette tâche générale.",
    "Broken link": "Lien cassé", "Not indexed": "Non indexée", "Slow page": "Page lente", "computer": "ordinateur", "phone": "mobile",
    "Health test": "Test de santé", "Links check": "Contrôle des liens", "Google index": "Index Google", "Page speed": "Vitesse des pages",
    "click": "clic", "clicks": "clics", "impr.": "impr.", "pages": "pages", "Lost": "Perdu", "Counts": "Compte", "Weak": "Faible", "Doesn't count": "Ne compte pas",
    "Links to": "Fait un lien vers", "competitor": "concurrent", "competitors": "concurrents", "In consideration": "En considération", "Spam": "Spam",
    "About a page": "Sur une page", "About a keyword": "Sur un mot-clé", "(empty note)": "(note vide)", "and": "et", "more": "autres",
    "No pages known yet. Type an address, or connect Search Console.": "Aucune page connue. Saisissez une adresse, ou connectez Search Console.",
    "No tracked keywords yet. Type one.": "Aucun mot-clé suivi. Saisissez-en un.", "No rankings yet. Track keywords and press Refresh data.": "Pas encore de positions. Suivez des mots-clés et appuyez sur Actualiser les données.",
    "No backlinks on this site yet.": "Pas encore de backlinks sur ce site.", "No link gaps or websites in consideration yet. Type a website.": "Aucun site en considération ni lien manquant. Saisissez un site.",
    "No open issues: run the health test or the links check.": "Aucun problème ouvert : lancez le test de santé ou le contrôle des liens.",
    "No competitors for this site yet.": "Pas encore de concurrents pour ce site.", "No notes for this site yet.": "Pas encore de notes pour ce site.",
    "Loading…": "Chargement…", "Nothing matches.": "Aucun résultat.", "Nothing to pick yet.": "Rien à choisir pour l'instant.",
    "Not in the list. Press Enter to add it as written.": "Pas dans la liste. Appuyez sur Entrée pour l'ajouter tel quel.", "in the list. Type to narrow it.": "dans la liste. Tapez pour la réduire.",
  };
  Object.keys(fr).forEach((word) => { if (window.FR && window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
