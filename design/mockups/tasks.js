/* Tasks: one board the whole team shares, per website. Findings across the app turn into tasks through UI.taskButton(),
   and a task keeps what it came from, so whoever picks it up doesn't have to redo the investigation.
   On the real API when served; opened as a plain file, it runs on a small sample kept in memory. */
(function () {
  let UI, t, esc, icon, num, status;

  // Blocked (2026-11-20, like the agency board's four buttons): work that waits on something else. Still open everywhere.
  const STATUSES = [["todo", "To start"], ["doing", "In progress"], ["blocked", "Blocked"], ["done", "Done"]];
  const PRIORITIES = [["low", "Low"], ["medium", "Normal"], ["high", "High"]];
  const KINDS = ["SEO", "Content", "Links", "Technical", "UX", "Ads", "Social", "Lead magnet"];
  const SHOWS = [["open", "To do"], ["done", "Done"], ["all", "All tasks"]]; // the month list's own switch, as the agency board has it
  const PERIODS = [["all", "All dates"], ["week", "This week"], ["month", "Month"], ["dates", "Dates"]];
  // "Done" already means something else in French on the Backlinks screen.
  const columnWord = (word) => (word === "Done" && UI.state.lang === "fr" ? "Terminé" : t(word));
  const priorityWord = (key) => t(PRIORITIES.find(([id]) => id === key)?.[1] || key);

  const T = {
    ready: false, loading: null, failed: "", tasks: [], sites: [],
    view: "months", show: "open", query: "", status: "", kind: "", goal: "", owner: "", period: "all", month: "", from: "", to: "",
    saving: false, dragId: null, sort: null, // sort: a heading pressed in the table, or null for status then due date
  };
  const PAGES = "tk"; // the table's pages (table-pages.js), like every long table in the app; its search is the Filter box
  const UNASSIGNED = "__unassigned";
  const finds = new Map(); // what each Create task button on the page would make, by the finding's key

  // ---- dates, in the Mac's or the browser's own day -------------------------------------------------
  const pad = (n) => String(n).padStart(2, "0");
  const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => dayOf(new Date());
  const monthOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  function weekRange() {
    const now = new Date(), monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return [dayOf(monday), dayOf(sunday)];
  }
  function monthRange(month) {
    const [y, m] = month.split("-").map(Number);
    return [`${month}-01`, dayOf(new Date(y, m, 0))];
  }
  function moveMonth(step) {
    const [y, m] = T.month.split("-").map(Number);
    T.month = monthOf(new Date(y, m - 1 + step, 1));
  }
  const monthWord = (month) => {
    const [y, m] = month.split("-").map(Number);
    return new Intl.DateTimeFormat(UI.locale(), { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
  };
  const shortDay = (day) => {
    const [y, m, d] = day.split("-").map(Number);
    return new Intl.DateTimeFormat(UI.locale(), { day: "numeric", month: "short" }).format(new Date(y, m - 1, d));
  };
  function range() {
    if (T.period === "week") return weekRange();
    if (T.period === "month") return monthRange(T.month);
    if (T.period === "dates" && T.from && T.to) return T.from <= T.to ? [T.from, T.to] : [T.to, T.from];
    return null;
  }

  // ---- what's on screen -------------------------------------------------------------------------
  const isOpen = (task) => task.status !== "done";
  const isLate = (task) => isOpen(task) && task.due && task.due < today();
  const hostHere = () => UI.siteHostPicked();
  // A task for all sites belongs to every site's board.
  const onThisSite = (task) => { const host = hostHere(); return !host || !task.site_host || task.site_host === host; };

  /* Work from an earlier period comes up until it's done. Once done, it also stays in the period it was finished in. */
  function carriedFrom(task, r = range()) {
    if (!r || !task.due || task.due >= r[0]) return "";
    const doneHere = !isOpen(task) && task.completed_on && task.completed_on >= r[0] && task.completed_on <= r[1];
    return isOpen(task) || doneHere ? task.due.slice(0, 7) : "";
  }
  function matches(task) {
    if (!onThisSite(task)) return false;
    if (T.kind && task.kind !== T.kind) return false;
    if (T.goal && plain(task.goal || "") !== plain(T.goal)) return false;
    if (T.owner === UNASSIGNED ? task.owner_label : T.owner && task.owner_label !== T.owner) return false;
    if (T.query) {
      const hay = [task.title, task.description, task.owner_label, task.kind, task.goal, task.source?.label, ...(task.pages || []), ...(task.keywords || []), window.TaskAbout.words(task)].join(" ").toLowerCase();
      if (!hay.includes(T.query.toLowerCase())) return false;
    }
    return true;
  }
  const inPeriod = (task, r = range()) => !r || (task.due && task.due >= r[0] && task.due <= r[1]) || !!carriedFrom(task, r);
  const visible = () => T.tasks.filter((task) => matches(task) && inPeriod(task));
  const shownByMonth = (task) => T.show === "all" || (T.show === "done" ? !isOpen(task) : isOpen(task));
  const counted = () => visible().filter((task) => (T.view === "months" ? shownByMonth(task) : !(T.view === "table" && T.status) || task.status === T.status)); // the table also filters by status, the month list by To do / Done
  /* Goals already used, most used first: a new task picks one, or a new one is typed. */
  const goals = () => {
    const seen = new Map();
    T.tasks.forEach((task) => { const g = (task.goal || "").trim(); if (g) { const k = plain(g); const was = seen.get(k); seen.set(k, { word: was?.word || g, n: (was?.n || 0) + 1 }); } });
    return [...seen.values()].sort((a, b) => b.n - a.n || a.word.localeCompare(b.word)).map((x) => x.word);
  };
  const sameGoal = (typed) => goals().find((g) => plain(g) === plain(typed)) || String(typed || "").trim();
  const undatedHidden = () => (range() ? T.tasks.filter((task) => matches(task) && !task.due).length : 0);
  // Soonest first, with no date last.
  const byDue = (a, b) => (a.due || "9999").localeCompare(b.due || "9999") || b.id - a.id;

  /* Open tasks due by the end of this week, late ones included. Today's "My work" shows this. */
  function dueThisWeek() {
    const end = weekRange()[1];
    return T.tasks.filter((task) => onThisSite(task) && isOpen(task) && task.due && task.due <= end).length;
  }
  /* The next open tasks for whoever is signed in, late ones first. Nobody signed in means everyone's. */
  function nextTasks(count) {
    const me = window.BOOT?.user?.name?.trim().toLowerCase();
    const mine = T.tasks.filter((task) => onThisSite(task) && isOpen(task) && (!me || (task.owner_label || "").trim().toLowerCase() === me));
    return [...mine].sort(byDue).slice(0, count).map((task) => ({ id: task.id, title: task.title, due: task.due, late: isLate(task), site_host: task.site_host || "" }));
  }
  const openForKey = (key) => (key ? T.tasks.find((task) => isOpen(task) && task.source?.key === key) : null);

  // ---- loading ----------------------------------------------------------------------------------
  function seedSample() {
    const data = window.COMP_SAMPLE;
    if (!data || data.get.tasks) return;
    const now = new Date(), offset = (days) => { const d = new Date(now); d.setDate(d.getDate() + days); return dayOf(d); };
    const base = { pages: [], keywords: [], description: "", priority: "medium", site_id: "site-one", site_host: "site-one.example", kind: "", hypothesis: "", impact: null, hours_estimate: null, hours_spent: null, note: "", owner_label: "", comments: [], source: null, completed_on: "", created_at: now.toISOString(), updated_at: now.toISOString(), status: "todo", due: "" };
    const list = [
      { title: "Rewrite the visa page title", keywords: ["visa séville prix"], pages: ["/vivre-seville-prix/"], owner_label: "Sara", due: offset(2), kind: "Content", priority: "high", impact: 4, status: "doing", comments: [{ name: "Sara", text: "New title sent to the writer.", at: now.toISOString() }] },
      { title: "Replace 2 lost backlinks", owner_label: "Nadia", due: offset(3), kind: "Links" },
      { title: "Add FAQ to the tax page", owner_label: "Nour", due: offset(4), kind: "Content" },
      { title: "Error pages", site_id: "site-two", site_host: "site-two.example", owner_label: "Nour", due: offset(-40), kind: "Technical", priority: "high", source: { type: "health", label: "Error pages", host: "site-two.example", facts: ["site-two.example/old-offer"], link: "#health/test/broken_pages", key: "sample|broken" }, finding: { state: "gone", by: "health", at: now.toISOString() } },
      { title: "Check why /loyer-a-seville/ lost traffic", pages: ["/loyer-a-seville/"], keywords: ["loyer à séville"], site_id: "", site_host: "", due: "", kind: "" },
      { title: "Publish the new pricing page", owner_label: "Mickaël", due: offset(-5), kind: "Content", status: "done", completed_on: offset(-1) },
    ];
    let id = list.length;
    data.get.tasks = { tasks: list.map((task) => ({ ...base, ...task, id: id-- })) };
    const rows = () => data.get.tasks.tasks;
    const find = (taskId) => {
      const task = rows().find((x) => x.id === Number(taskId));
      if (!task) throw new Error("That task doesn't exist.");
      return task;
    };
    const clash = (key, self) => key && rows().some((x) => x.id !== self && x.status !== "done" && x.source?.key === key);
    const trash = [];
    const stamp = (task, body) => {
      if (body.status && body.status !== task.status) task.completed_on = body.status === "done" ? today() : "";
    };
    COMP.sampleWrite("POST tasks", (m, body) => {
      if (!body.title?.trim()) throw new Error("A task needs a title.");
      if (clash(body.source?.key)) throw new Error("This finding already has an open task.");
      const host = T.sites.find((s) => String(s.id) === String(body.site_id))?.host || "";
      const task = { ...base, ...body, id: Math.max(0, ...rows().map((x) => x.id), ...trash.map((x) => x.id)) + 1, site_host: host, comments: [], source: body.source || null, completed_on: body.status === "done" ? today() : "" };
      rows().unshift(task);
      return JSON.parse(JSON.stringify(task));
    });
    COMP.sampleWrite("PATCH tasks/(\\d+)", (m, body) => {
      const task = find(m[1]);
      if ("title" in body && !body.title?.trim()) throw new Error("A task needs a title.");
      if (body.status && body.status !== "done" && task.status === "done" && clash(task.source?.key, task.id)) throw new Error("This finding already has an open task.");
      if (body.expected_version && task.version && body.expected_version !== task.version) throw new Error("Someone else changed this task while you had it open.");
      const { expected_version: unused, ...sent } = body;
      stamp(task, sent);
      Object.assign(task, sent, { version: new Date().toISOString() });
      if ("site_id" in body) task.site_host = T.sites.find((s) => String(s.id) === String(body.site_id))?.host || "";
      return JSON.parse(JSON.stringify(task));
    });
    COMP.sampleWrite("DELETE tasks/(\\d+)", (m) => {
      const task = find(m[1]);
      rows().splice(rows().indexOf(task), 1);
      trash.push(task);
      return { ok: true };
    });
    COMP.sampleWrite("POST tasks/(\\d+)/restore", (m) => {
      const task = trash.find((x) => x.id === Number(m[1]));
      if (!task) throw new Error("That task doesn't exist.");
      if (task.status !== "done" && clash(task.source?.key, task.id)) throw new Error("Can't restore: a newer task covers this finding.");
      trash.splice(trash.indexOf(task), 1);
      rows().unshift(task);
      return JSON.parse(JSON.stringify(task));
    });
    COMP.sampleWrite("POST tasks/(\\d+)/comments", (m, body) => {
      const task = find(m[1]);
      if (!body.text?.trim()) throw new Error("A comment needs some text.");
      task.comments = [...task.comments, { name: (body.name || "").trim(), text: body.text.trim(), at: new Date().toISOString() }];
      return JSON.parse(JSON.stringify(task));
    });
  }

  function load() {
    if (T.loading) return T.loading;
    T.loading = (async () => {
      const served = await COMP.isServer();
      if (!served) seedSample();
      const answer = await COMP.api("GET", "tasks");
      // Only the server's own ids can be saved, and the sample's site list has none on the real API.
      // The server's own ids: boot.js already has them, so no second ask for the site list (F17). A site added since is in links/sites.
      const known = served ? (window.BOOT?.sites || []).map((s) => ({ id: s.id, host: s.host })) : null;
      T.sites = served ? (known.length && known.length === window.SITES.filter((s) => s.realId).length ? known : (await COMP.api("GET", "links/sites")).sites.map((s) => ({ id: s.id, host: s.host }))) : window.SITES.map((s) => ({ id: s.id, host: s.host }));
      T.tasks = !served && UI.state.firstRun ? [] : answer.tasks;
      T.sampleFirstRun = UI.state.firstRun;
      T.failed = "";
      T.ready = true;
    })().catch((err) => {
      if (!T.tasks.length) T.failed = err.message; // with tasks on screen, the next look catches up: a laptop waking before its Wi-Fi mustn't blank the board
      T.ready = true;
    }).finally(() => { T.loading = null; });
    return T.loading;
  }
  /* Everything that shows a count or a Create task button catches up after a change. */
  function changed() {
    refreshButtons();
    refreshRelated();
    const next = UI.$("#today-tasks");
    if (next && !UI.state.firstRun) UI.setHTML(next, window.TodayView.tasksHtml());
    if (UI.state.route === "tasks") paint();
  }
  function keep(task) {
    const at = T.tasks.findIndex((x) => x.id === task.id);
    // A save doesn't re-read the checks. What was known stays, unless the status just changed what it means.
    if (at >= 0 && task.finding === undefined) task.finding = T.tasks[at].status === task.status ? T.tasks[at].finding : null;
    if (at >= 0) T.tasks[at] = task; else T.tasks.unshift(task);
    changed();
  }

  // ---- buttons on findings across the app --------------------------------------------------------
  /* find: { title, host, description, source: { type, label, facts, link, key } }. One finding, one open task:
     the button opens the task once there is one. */
  function taskButton(find, { label = "Create task", cls = "btn btn-small" } = {}) {
    // Chosen access: no Tasks section, no task button. View only: an existing task still opens, nothing new is made.
    if (window.ACCESS && !window.ACCESS.can("tasks")) return "";
    if (window.ACCESS && !window.ACCESS.canEdit("tasks") && !openForKey(find.source?.key)) return "";
    const key = find.source?.key || `once|${find.title}`;
    finds.set(key, find);
    const open = openForKey(find.source?.key);
    return `<button type="button" class="${cls}" data-task-find="${esc(key)}" data-task-label="${esc(label)}" aria-label="${esc(open ? t("Open task") : t("Create task"))}: ${esc(find.title)}">${esc(open ? t("Open task") : t(label))}</button>`;
  }
  function refreshButtons() {
    UI.$$("[data-task-find]").forEach((button) => {
      const find = finds.get(button.dataset.taskFind);
      if (!find) return;
      const open = openForKey(find.source?.key);
      button.textContent = open ? t("Open task") : t(button.dataset.taskLabel || "Create task");
      button.setAttribute("aria-label", `${open ? t("Open task") : t("Create task")}: ${find.title}`);
    });
  }

  /* Back to where a task came from. The address says the screen, then what to open on it. */
  function goToFinding(link, taskId = null) {
    const [route, ...rest] = (link || "").replace(/^#/, "").split("/");
    const parts = rest.map(decodeURIComponent);
    if (!route) return;
    // The way back. Getting to the finding is only half of the job.
    const task = taskId ? T.tasks.find((x) => x.id === taskId) : null;
    if (task) setTimeout(() => UI.toast(t("Here's the finding"), { kind: "info", undo: () => openTask({ task: T.tasks.find((x) => x.id === taskId) || task }), undoLabel: t("Back to task") }), 500);
    if (route === "settings") { UI.go("settings"); if (parts[0]) UI.openConnection(parts[0]); return; }
    if (route === "competitors" && parts[0]) {
      COMP.open(parts[0], parts[0] === "pairs" && parts[1] ? { openPairId: Number(parts[1]) } : parts[0] === "list" && parts[1] ? { competitorId: Number(parts[1]) } : {});
      return;
    }
    if (route === "backlinks" && parts[0]) {
      UI.state.blSection = "done"; UI.state.blFilter = "all"; UI.state.blTab = "all";
      UI.go("backlinks");
      if (!UI.$(`[data-open-bl="${CSS.escape(parts[0])}"]`) && UI.state.site !== "all") { UI.state.site = "all"; UI.render(); }
      UI.$(`[data-open-bl="${CSS.escape(parts[0])}"]`)?.click();
      return;
    }
    if (route === "health") {
      UI.state.healthTab = parts[0] === "links" || parts[0] === "uptime" ? parts[0] : "test";
      if (parts[0] === "test" && parts[1]) window.HealthTest?.showCheck?.(parts[1]);
    }
    if (route === "backlinks") UI.state.blSection = "done";
    UI.go(route);
    if (route === "keywords" && parts[0]) {
      const findRow = () => UI.$$("[data-open-kw]").find((el) => el.dataset.openKw === parts[0]);
      // The keyword may belong to a site the side menu isn't on.
      if (!findRow() && UI.state.site !== "all") { UI.state.site = "all"; UI.render(); }
      findRow()?.click();
    }
    if (route === "health" && parts[0] === "test" && parts[1]) {
      setTimeout(() => UI.$(`[data-ht-check="${CSS.escape(parts[1])}"]`)?.scrollIntoView({ block: "center" }), 400);
    }
  }

  // ---- tasks on the pages and keywords they're about ---------------------------------------------
  /* A page can be written as a full address or a path, with or without www or the last slash. */
  function pageParts(value) {
    let text = String(value || "").trim().toLowerCase();
    try { text = decodeURI(text); } catch { /* a stray % stays as written */ }
    text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "");
    const first = text.split("/")[0];
    const host = first.includes(".") ? first : "";
    const path = host ? text.slice(first.length) : text.startsWith("/") ? text : `/${text}`;
    return { host, path: path.replace(/\/+$/, "") };
  }
  function samePage(a, b) {
    const x = pageParts(a), y = pageParts(b);
    return x.path === y.path && (!x.host || !y.host || x.host === y.host);
  }
  const sameWord = (a, b) => plain(a).normalize("NFC") === plain(b).normalize("NFC");
  /* A task for one site never shows on another site's page of the same name. Open ones first. */
  function relatedTo({ host = "", page = "", keyword = "", item = null }) { // label: how an item reads in the panel head
    const here = T.tasks.filter((task) => (!host || !task.site_host || task.site_host === host)
      && ((keyword && (task.keywords || []).some((word) => sameWord(word, keyword))) || (page && (task.pages || []).some((link) => samePage(link, page)))
        || (item && (task.about?.items || []).some((x) => x.kind === item.kind && String(x.ref) === String(item.ref)))
        || (keyword && (task.about?.items || []).some((x) => x.kind === "ranking" && sameWord(String(x.label).split(" · ")[0], keyword)))));
    return here.sort((a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || byDue(a, b));
  }
  /* The status as a small coloured tag, in the board's column colours: grey To do, blue In progress, green Done. */
  const statusTag = (key) => `<span class="tk-st tk-st-${esc(key)}">${columnWord(STATUSES.find(([k]) => k === key)?.[1] || "")}</span>`;
  const relatedRow = (task) => `<li class="${isOpen(task) ? "" : "tk-rel-done"}"><button type="button" class="tk-rel-title" data-task-open="${task.id}" dir="auto">${esc(task.title)}</button>
      <span class="tk-rel-meta small sec">${statusTag(task.status)}${task.owner_label ? ` · <span dir="auto">${esc(task.owner_label)}</span>` : ""}${isLate(task) ? ` ${status("warn", `${t("Late")} · ${shortDay(task.due)}`)}` : task.due ? ` · ${esc(shortDay(task.due))}` : ""}</span></li>`;
  const relatedInner = (about) => {
    const list = relatedTo(about);
    return list.length ? `<h3>${t("Related tasks")} <span class="muted">${num(list.length)}</span></h3><ul class="tk-rel-list">${list.map(relatedRow).join("")}</ul>` : "";
  };
  const relatedTagInner = (about) => {
    const n = relatedTo(about).filter(isOpen).length;
    return n ? `<button type="button" class="tk-rel-tag" data-task-related-open>${icon("square-check")}${num(n)} ${t(n === 1 ? "task" : "tasks")}</button>` : "";
  };
  /* about: { host, page, keyword, item: { kind, ref } }. Empty until a task is linked, and fills in by itself when one is. */
  const relatedTasks = (about) => `<div class="tk-related" data-task-related="${esc(JSON.stringify(about))}">${T.ready ? relatedInner(about) : ""}</div>`;
  const relatedTag = (about) => `<span data-task-related-tag="${esc(JSON.stringify(about))}">${T.ready ? relatedTagInner(about) : ""}</span>`;
  function refreshRelated() {
    UI.$$("[data-task-related]").forEach((box) => UI.setHTML(box, relatedInner(JSON.parse(box.dataset.taskRelated))));
    UI.$$("[data-task-related-tag]").forEach((box) => UI.setHTML(box, relatedTagInner(JSON.parse(box.dataset.taskRelatedTag))));
  }
  function openRelated(about, opener) {
    const list = relatedTo(about).filter(isOpen);
    if (list.length === 1) { openTask({ task: list[0], opener }); return; }
    UI.openPanel(`${UI.panelHead(t("Related tasks"), `<span class="mono">${about.page ? `<span dir="auto">${esc(about.page)}</span>` : about.item ? `<span dir="auto">${esc(about.label || about.item.ref)}</span>` : KeywordLink.html(about.keyword || "", { host: about.host || null })}</span>`)}
      <div class="panel-body">${relatedTasks(about)}</div>`, opener);
  }

  // ---- the panel --------------------------------------------------------------------------------
  /* What a later check says about the finding. A suggestion only: a task never closes itself, because a person decides. */
  const findingWords = (f) => `${t(f.by === "health" ? "Health test of" : "Links check of")} ${UI.fmtDateOnly(f.at)}`;
  const findingNote = (task) => {
    const f = task?.finding;
    if (!f) return "";
    if (f.state === "gone") return `<div class="note tk-finding" role="status">${icon("circle-check", "good")}<span>${findingWords(f)} ${t("no longer finds this: looks fixed.")}</span>${task.status === "done" ? "" : `<button type="button" class="btn btn-small" data-task-finish>${t("Mark as done")}</button>`}</div>`;
    return `<div class="note warn tk-finding" role="status">${icon("triangle-alert")}<span>${findingWords(f)} ${t("found this again after it was finished.")}</span><button type="button" class="btn btn-small" data-task-reopen>${t("Reopen")}</button></div>`;
  };
  const findingTag = (task) => (task.finding?.state === "gone" ? status("good", t("Looks fixed")) : task.finding?.state === "back" ? status("warn", t("Found again")) : "");
  const sourceBlock = (source) => {
    if (!source) return "";
    const facts = (source.facts || []).filter(Boolean);
    return `<section class="tk-source" aria-label="${t("Source")}">
      <div class="small muted">${t("Source")}</div>
      <div class="tk-source-label" dir="auto">${esc(source.label || "")}</div>
      ${facts.length ? `<ul class="tk-facts">${facts.map((fact) => `<li dir="auto">${esc(fact)}</li>`).join("")}</ul>` : ""}
      ${source.link ? `<button type="button" class="link-btn" data-task-go="${esc(source.link)}">${t("Open finding")}</button>` : ""}
    </section>`;
  };
  const whenWord = (iso) => (iso ? new Intl.DateTimeFormat(UI.locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "");
  /* The signed-in account. The sample has none, so it speaks as the first of its team. Only a test server with login off asks. */
  const myName = () => window.ME?.name || (UI.state.served ? "" : window.TEAM?.[0] || "");
  const commentsBlock = (task) => `<section class="tk-comments" aria-label="${t("Comments")}">
      <h3>${t("Comments")}${task.comments.length ? ` <span class="muted">${num(task.comments.length)}</span>` : ""}</h3>
      ${task.comments.length ? `<ul class="tk-thread">${task.comments.map((c) => `<li><div class="small muted">${c.name ? `<b dir="auto">${esc(c.name)}</b> · ` : ""}${esc(whenWord(c.at))}</div><div class="tk-comment-text" dir="auto">${esc(c.text)}</div></li>`).join("")}</ul>` : ""}
      ${myName() ? "" : `<div class="field-row tk-comment-form">
        <label class="field"><span>${t("Your name")}</span><input class="input" id="tk-comment-name" value="${esc(UI.store.get("taskName") || "")}" maxlength="100"></label>
      </div>`}
      <label class="field"><span>${myName() ? `${t("Comment as")} <b dir="auto">${esc(myName())}</b>` : t("Comment")}</span><textarea class="input" id="tk-comment" rows="2" maxlength="2000" dir="auto"></textarea></label>
      <div id="tk-comment-error"></div>
      <button type="button" class="btn btn-small" id="tk-comment-send" data-id="${task.id}">${t("Add comment")}</button>
    </section>`;

  /* A new task from a finding gets a type from what the finding is about, so it lands under a type, not blank free text. */
  const KIND_OF_SOURCE = { keyword: "Content", search: "Content", page: "Content", competitor: "Content", health: "Technical", link: "Technical", alert: "Technical", backlink: "Links" };
  /* Who is signed in: a new task is theirs unless they change it, so it shows in their "My work" on Today. */
  const signedIn = () => window.BOOT?.user?.name?.trim() || myName();

  /* task: an existing one. Otherwise prefill: { title, host, description, source, kind, owner, keywords, pages, about }. */
  function openTask({ task = null, title = "", host = null, description = "", source = null, priority = "medium", pages = [], keywords = [], about = null, kind = "", goal = "", owner = null, query = "", opener = null } = {}) {
    // The keyword a finding carries, wherever it keeps it.
    if (!task && !keywords.length) { const k = query || source?.query || source?.keyword; if (k) keywords = [k]; }
    T.base = task ? JSON.parse(JSON.stringify(task)) : null;
    T.openId = task ? task.id : null;
    const given = task || { owner_label: owner ?? signedIn(), kind: kind || KIND_OF_SOURCE[source?.type] || "", goal };
    const siteId = task ? task.site_id : (T.sites.find((s) => s.host === (host ?? hostHere()))?.id ?? "");
    // Chosen access without every site: a task is for one of their sites ("All sites" belongs to the owner).
    const siteOptions = `${window.ACCESS?.limited && !window.ACCESS.everySite() ? "" : `<option value="">${t("All sites")}</option>`}${T.sites.map((s) => `<option value="${esc(String(s.id))}" ${String(s.id) === String(siteId ?? "") ? "selected" : ""}>${esc(s.host)}</option>`).join("")}`;
    const removedSite = task && !task.site_id && task.site_host ? `<p class="help" style="margin-top:-6px">${t("Site removed:")} <span class="mono" dir="auto">${esc(task.site_host)}</span></p>` : "";
    const select = (id, options, chosen) => `<select class="select" id="${id}" style="width:100%">${options.map(([value, word]) => `<option value="${value}" ${value === chosen ? "selected" : ""}>${columnWord(word)}</option>`).join("")}</select>`;
    // Anyone with an account; a name from before accounts stays listed so it isn't lost on save.
    const people = [...new Set([...(window.TEAM_NAMES || (UI.state.served ? [] : window.TEAM || [])), given.owner_label].filter(Boolean))];
    const made = task?.created_at ? `${t("Created")} ${esc(whenWord(task.created_at))}${task.created_by ? ` ${t("by")} <span dir="auto">${esc(task.created_by)}</span>` : ""}` : "";
    const theSource = task ? task.source : source;
    const draftKey = `task|${task ? task.id : theSource?.key || "new"}`;
    UI.openPanel(`${UI.panelHead(t(task ? "Task" : "New task"), made)}
      <div class="panel-body"><form id="task-form" novalidate>
        ${findingNote(task)}${sourceBlock(theSource)}
        <label class="field"><span>${t("Title")} <span class="req">*</span></span><input class="input" id="task-title" value="${esc(task ? task.title : title)}" required maxlength="300" dir="auto" data-autofocus></label>
        <div id="task-error"></div>
        <div class="field-row">
          <label class="field"><span>${t("Site")}</span><select class="select" id="task-site" style="width:100%">${siteOptions}</select></label>
          <label class="field"><span>${t("Assigned to")}</span><select class="select" id="task-owner" style="width:100%"><option value="">${t("Nobody")}</option>${people.map((name) => `<option value="${esc(name)}"${name === given.owner_label ? " selected" : ""}>${esc(name)}</option>`).join("")}</select></label>
        </div>
        <div class="field-row">
          <label class="field"><span>${t("Due date")}</span><input class="input" type="date" id="task-due" value="${esc(given.due || "")}"></label>
          <label class="field"><span>${t("Type")}</span><input class="input" id="task-kind" value="${esc(given.kind ? t(given.kind) : "")}" list="task-kinds" maxlength="40" autocomplete="off"><datalist id="task-kinds">${KINDS.map((kind) => `<option value="${esc(t(kind))}"></option>`).join("")}</datalist></label>
        </div>
        <label class="field"><span>${t("Goal")}</span><input class="input" id="task-goal" value="${esc(given.goal || "")}" list="task-goals" maxlength="200" autocomplete="off" dir="auto" placeholder="${esc(t("e.g. Strengthen site credibility"))}"><datalist id="task-goals">${goals().map((g) => `<option value="${esc(g)}"></option>`).join("")}</datalist></label>
        <div class="field-row">
          <label class="field"><span>${t("Status")}</span>${select("task-status", STATUSES, given.status || "todo")}</label>
          <label class="field"><span>${t("Priority")}</span>${select("task-priority", PRIORITIES, given.priority || priority)}</label>
        </div>
        ${removedSite}
        <label class="field"><span>${t("Description")}</span><textarea class="input" id="task-description" rows="3" maxlength="20000" dir="auto">${esc(task ? given.description || "" : description)}</textarea></label>
        ${window.TaskAbout.html(task ? { pages: given.pages, keywords: given.keywords, about: given.about } : { pages, keywords, about })}
      </form>
      ${task ? commentsBlock(task) : ""}${task && window.COMP?.notes ? `<div class="task-notes">${window.COMP.notes.block({ scope: "task", taskId: task.id, task: task.title, siteId: task.site_id ?? null, title: t("Notes on this task") })}</div>` : ""}</div>
      <div class="panel-foot"><button class="btn btn-main" id="task-save" ${task ? `data-id="${task.id}"` : ""}>${t("Save")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button>${task ? `<button class="btn btn-ghost danger" id="task-delete" data-id="${task.id}">${t("Delete")}</button>` : ""}</div>`,
    opener, { key: draftKey, reopen: () => openTask({ task, title, host, description, source, priority, pages, keywords, about, kind, goal, owner, opener }), after: () => { window.TaskAbout.mount(); window.COMP?.notes?.mount(); } });
    pendingSource = task ? null : source;
  }
  let pendingSource = null; // what the panel on screen would be created from

  /* "technical", "Technical" and the French "Technique" are one type, and "nour" is Nour: the filters would otherwise split them. Anything new stays as typed. */
  const plain = (word) => String(word).trim().toLowerCase();
  const sameKind = (typed) => KINDS.find((kind) => plain(kind) === plain(typed) || plain(t(kind)) === plain(typed)) || T.tasks.map((x) => x.kind).find((kind) => kind && plain(kind) === plain(typed)) || typed;
  const sameOwner = (typed) => T.tasks.map((x) => x.owner_label).find((name) => name && plain(name) === plain(typed)) || typed;

  async function saveTask(button) {
    if (T.saving) return; // a double click must not make two
    const title = UI.$("#task-title"), errorBox = UI.$("#task-error");
    UI.setHTML(errorBox, "");
    title.classList.remove("invalid");
    if (!title.value.trim()) { title.classList.add("invalid"); title.focus(); UI.setHTML(errorBox, `<div class="error" role="alert">${icon("octagon-alert")}<span>${t("A task needs a title.")}</span></div>`); return; }
    const linked = window.TaskAbout.values();
    const rawSite = UI.$("#task-site").value;
    const body = {
      title: title.value, status: UI.$("#task-status").value, priority: UI.$("#task-priority").value, due: UI.$("#task-due").value,
      owner_label: sameOwner(UI.$("#task-owner").value), kind: sameKind(UI.$("#task-kind").value), goal: sameGoal(UI.$("#task-goal").value), description: UI.$("#task-description").value,
      pages: linked.pages, keywords: linked.keywords, about: linked.about,
      site_id: T.sites.find((s) => String(s.id) === rawSite)?.id ?? null,
    };
    const id = button.dataset.id ? Number(button.dataset.id) : null;
    const source = pendingSource;
    T.saving = true;
    button.disabled = true;
    try {
      if (id) {
        await saveChanges(id, body);
      } else {
        const saved = await COMP.api("POST", "tasks", source ? { ...body, source } : body);
        finishSave(saved, () => UI.toast(t("Task created"), { undo: () => openTask({ task: T.tasks.find((x) => x.id === saved.id) }), undoLabel: t("Open") }));
      }
    } catch (err) {
      UI.setHTML(errorBox, `<div class="error" role="alert">${icon("octagon-alert")}<span>${esc(t(err.message))}</span></div>`);
      // Someone else made it first: bring it in, so the buttons can open it.
      if (err.status === 409 || err.message.includes("already has an open task")) await load().then(changed);
    } finally {
      T.saving = false;
      if (button.isConnected) button.disabled = false;
    }
  }

  /* The panel closes, the board redraws, and the keyboard stays on the card it came from. */
  function finishSave(saved, say) {
    UI.forgetPanelForm();
    UI.closePanel();
    keep(saved);
    if (say) say();
    setTimeout(() => { if (UI.state.route === "tasks") UI.$(`[data-task-open="${saved.id}"]`)?.focus({ preventScroll: true }); }, UI.reduceMotion() ? 10 : 160);
  }

  const EDITABLE = ["title", "status", "priority", "due", "owner_label", "kind", "goal", "description", "pages", "keywords", "about", "site_id"];
  const sameValue = (a, b) => {
    const empty = (v) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !v.main && !(v.items || []).length);
    if (typeof a === "object" || typeof b === "object") return (empty(a) && empty(b)) || JSON.stringify(a) === JSON.stringify(b);
    return String(a ?? "").trim() === String(b ?? "").trim();
  };
  const FIELD_WORDS = { title: "Title", status: "Status", priority: "Priority", due: "Due date", owner_label: "Assigned to", kind: "Type", goal: "Goal", description: "Description", pages: "Pages", keywords: "Keywords", about: "About", site_id: "Site" };

  /* Only what this person changed is sent, so two people can edit different things. If someone else changed the same
     thing while the panel was open, nothing is overwritten until this person has seen it and chosen. */
  async function saveChanges(id, body) {
    const base = T.base;
    const mine = {};
    EDITABLE.forEach((name) => { if (!sameValue(body[name], base[name])) mine[name] = body[name]; });
    if (!Object.keys(mine).length) { UI.forgetPanelForm(); UI.closePanel(); return; }
    try {
      const saved = await COMP.api("PATCH", `tasks/${id}`, { ...mine, expected_version: base.version });
      finishSave(saved, () => UI.toast(t("Task saved")));
    } catch (err) {
      if (!err.message.includes("while you had it open")) throw err;
      await load();
      changed();
      const fresh = T.tasks.find((x) => x.id === id);
      if (!fresh) throw new Error("That task doesn't exist.", { cause: err });
      const clashes = Object.keys(mine).filter((name) => !sameValue(fresh[name], base[name]) && !sameValue(fresh[name], mine[name]));
      if (!clashes.length) {
        const saved = await COMP.api("PATCH", `tasks/${id}`, { ...mine, expected_version: fresh.version });
        finishSave(saved, () => UI.toast(t("Task saved, with someone else's changes too.")));
        return;
      }
      T.clash = { id, mine, fresh };
      const shown = (name) => esc(String(name === "status" ? columnWord(STATUSES.find(([k]) => k === fresh.status)?.[1] || "") : name === "site_id" ? fresh.site_host || t("All sites") : fresh[name] ?? "") || "—");
      UI.setHTML(UI.$("#task-error"), `<div class="error tk-clash" role="alert">${icon("octagon-alert")}<div><p>${t("Someone else changed this task. Nothing is saved yet.")}</p>
        <ul>${clashes.map((name) => `<li><b>${t(FIELD_WORDS[name])}</b>: ${t("now")} <span dir="auto">${shown(name)}</span></li>`).join("")}</ul>
        <div class="tk-clash-acts"><button type="button" class="btn btn-small" data-task-keep-mine>${t("Keep mine")}</button><button type="button" class="btn btn-small" data-task-use-theirs>${t("Use theirs")}</button></div></div></div>`);
      UI.$("#task-error").scrollIntoView({ block: "nearest" });
    }
  }

  async function moveTask(id, to, focusAfter = null) {
    const task = T.tasks.find((x) => x.id === id);
    if (!task || task.status === to) return;
    try {
      keep(await COMP.api("PATCH", `tasks/${id}`, { status: to }));
      if (focusAfter) UI.$(focusAfter)?.focus({ preventScroll: true });
    } catch (err) {
      UI.toast(t(err.message), { kind: "crit" });
      paint(); // puts the card back where the server says it is
    }
  }

  async function deleteTask(id) {
    const task = T.tasks.find((x) => x.id === id);
    if (!task || T.deleting === id) return; // a double click deletes once
    T.deleting = id;
    try {
      await COMP.api("DELETE", `tasks/${id}`);
    } catch (err) { UI.toast(t(err.message), { kind: "crit" }); return; } finally { T.deleting = null; }
    T.tasks = T.tasks.filter((x) => x.id !== id);
    UI.forgetPanelForm();
    UI.closePanel();
    changed();
    UI.toast(t("Task deleted"), { undo: async () => {
      try { keep(await COMP.api("POST", `tasks/${id}/restore`)); } catch (err) { UI.toast(t(err.message), { kind: "crit" }); }
    } });
  }

  async function sendComment(button) {
    const box = UI.$("#tk-comment"), errorBox = UI.$("#tk-comment-error"), name = myName() || UI.$("#tk-comment-name").value;
    UI.setHTML(errorBox, "");
    if (!box.value.trim()) { box.focus(); UI.setHTML(errorBox, `<div class="error" role="alert">${icon("octagon-alert")}<span>${t("A comment needs some text.")}</span></div>`); return; }
    button.disabled = true;
    try {
      const saved = await COMP.api("POST", `tasks/${button.dataset.id}/comments`, { text: box.value, name });
      if (!myName()) UI.store.set("taskName", name.trim());
      keep(saved);
      if (T.base && T.base.id === saved.id) T.base.version = saved.version; // a comment isn't a clash with the form
      UI.setHTML(UI.$(".tk-comments"), innerOf(commentsBlock(saved)));
      UI.$("#tk-comment")?.focus();
    } catch (err) {
      UI.setHTML(errorBox, `<div class="error" role="alert">${icon("octagon-alert")}<span>${esc(t(err.message))}</span></div>`);
      button.disabled = false;
    }
  }
  const innerOf = (html) => html.replace(/^\s*<section[^>]*>/, "").replace(/<\/section>\s*$/, "");

  // ---- the board and the table ------------------------------------------------------------------
  const dueBit = (task, carried) => {
    if (!task.due) return "";
    // The date always shows. Finished work isn't a warning, wherever it's shown.
    const from = carried && isOpen(task) ? `<span class="small muted">${t("Carried over from")} ${monthWord(carried)}</span>` : "";
    if (isLate(task)) return `${status("warn", `${t("Late")} · ${shortDay(task.due)}`)}${from}`;
    return `<span class="small sec tabular">${esc(shortDay(task.due))}</span>${from}`;
  };
  const siteBit = (task) => (hostHere() || !task.site_host ? "" : `<span class="tk-site small sec">${UI.siteLogo(task.site_host, 14)}<span class="mono" dir="auto">${esc(task.site_host)}</span></span>`);
  // A colour per type, so they read apart at a glance. A type someone made up stays plain.
  const KIND_TONES = { SEO: "teal", Content: "blue", Technical: "grey", Links: "teal", UX: "indigo", "Lead magnet": "teal", Ads: "indigo", Social: "indigo" };
  const kindTag = (kind) => (kind ? `<span class="tag ${KIND_TONES[kind] ? `tk-kind-${KIND_TONES[kind]}` : ""}" dir="auto">${esc(t(kind))}</span>` : "");
  const moveSelect = (task, id = `tk-move-${task.id}`) => `<select class="select tk-move" id="${id}" data-task-move="${task.id}" aria-label="${t("Status")}: ${esc(task.title)}">${STATUSES.map(([key, word]) => `<option value="${key}" ${key === task.status ? "selected" : ""}>${columnWord(word)}</option>`).join("")}</select>`;

  function card(task) {
    const carried = carriedFrom(task);
    const ownerBit = task.owner_label ? `<span class="tk-owner small sec"><span class="tk-avatar" aria-hidden="true">${esc([...task.owner_label][0].toUpperCase())}</span><span dir="auto">${esc(task.owner_label)}</span></span>` : "";
    const countBit = task.comments.length ? `<span class="small muted tk-count">${num(task.comments.length)} ${t(task.comments.length === 1 ? "comment" : "comments")}</span>` : "";
    return `<article class="tk-card" draggable="true" data-task-card="${task.id}">
      <button type="button" class="tk-title" data-task-open="${task.id}" dir="auto">${esc(task.title)}</button>
      <div class="tk-tags">${task.priority === "high" ? status("serious", t("High")) : ""}${window.TaskAbout.tag(task)}${kindTag(task.kind)}${siteBit(task)}</div>
      <div class="tk-foot"><div class="tk-foot-start">${findingTag(task)}${dueBit(task, carried)}</div><div class="tk-foot-end">${countBit}${ownerBit}</div></div>
      ${moveSelect(task)}
    </article>`;
  }

  function board(list) {
    return `<div class="tk-board tk-board-4">${STATUSES.map(([key, word]) => {
      const here = list.filter((task) => task.status === key).sort(byDue);
      return `<section class="card tk-col" data-task-col="${key}" aria-label="${columnWord(word)}">
        <div class="tk-col-head"><h2>${columnWord(word)}</h2><span class="lc-count sec tabular">${num(here.length)}</span></div>
        <div class="tk-col-body">${here.length ? here.map(card).join("") : `<p class="tk-none small muted">${t("No task")}</p>`}</div>
      </section>`;
    }).join("")}</div>`;
  }

  /* A heading sorts the table: titles A to Z, the most urgent first, the soonest first. A third press goes back to the usual order. */
  const SORTS = {
    title: { get: (task) => task.title || "", first: "asc" },
    priority: { get: (task) => PRIORITIES.findIndex(([k]) => k === task.priority), first: "desc" },
    due: { get: (task) => task.due || null, first: "asc" },
  };
  const byStatus = (a, b) => STATUSES.findIndex(([k]) => k === a.status) - STATUSES.findIndex(([k]) => k === b.status) || byDue(a, b);
  function sortedRows(rows) {
    if (!T.sort || !SORTS[T.sort.id]) return [...rows].sort(byStatus);
    const { get } = SORTS[T.sort.id], dir = T.sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x === null || x === undefined) return y === null || y === undefined ? byStatus(a, b) : 1; // no date goes last, whichever way
      if (y === null || y === undefined) return -1;
      return ((typeof x === "number" ? x - y : String(x).localeCompare(String(y), UI.locale())) * dir) || byStatus(a, b);
    });
  }
  const sortHead = (id, label) => {
    const on = T.sort?.id === id;
    return `<th scope="col" aria-sort="${on ? (T.sort.dir === "asc" ? "ascending" : "descending") : "none"}"><button type="button" class="th-btn" data-tk-sort="${id}">${t(label)}${on ? icon(T.sort.dir === "asc" ? "arrow-up" : "arrow-down") : ""}</button></th>`;
  };

  /* Where a task came from, under its title. Most titles are made from the finding, so the grey line would say the same
     words again: then a small target icon carries them as its tooltip. A title someone rewrote keeps the line. */
  const plainWords = (text) => String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  function sourceBit(task) {
    const label = task.source?.label;
    if (!label) return "";
    if (!plainWords(task.title).includes(plainWords(label))) return `<span class="second" dir="auto">${esc(label)}</span>`;
    const words = t("From a finding: {label}").split("{label}").join(label);
    return ` <span class="comp-ic tk-from" role="img" title="${esc(words)}" data-tip="${esc(words)}" aria-label="${esc(words)}">${icon("target")}</span>`;
  }

  function table(list) {
    const rows = sortedRows(list.filter((task) => !T.status || task.status === T.status));
    if (!rows.length) return COMP.empty(t("Nothing matches these filters"), t("Change the filters above."));
    const showSite = !hostHere();
    const view = TP.view(PAGES, rows);
    return `<div class="tk-list"><div class="table-wrap"><table class="data tk-table" id="tk-table">
      <thead><tr>${sortHead("title", "Title")}<th scope="col">${t("Status")}</th>${sortHead("priority", "Priority")}${showSite ? `<th scope="col">${t("Site")}</th>` : ""}<th scope="col">${t("Assigned to")}</th>${sortHead("due", "Due date")}<th scope="col">${t("Type")}</th></tr></thead>
      <tbody>${view.rows.map((task) => `<tr data-task-row="${task.id}">
        <td class="head-cell"><button type="button" class="kw tk-row-title" data-task-open="${task.id}" dir="auto" style="text-align:start">${esc(task.title)}</button>${sourceBit(task)}${findingTag(task)}</td>
        <td data-label="${t("Status")}">${moveSelect(task)}</td>
        <td data-label="${t("Priority")}">${task.priority === "high" ? status("serious", t("High")) : `<span class="small sec">${priorityWord(task.priority)}</span>`}</td>
        ${showSite ? `<td class="mono small" data-label="${t("Site")}" dir="auto">${task.site_host ? esc(task.site_host) : `<span class="muted" style="font-family:var(--font)">${t("All sites")}</span>`}</td>` : ""}
        <td data-label="${t("Assigned to")}" dir="auto">${task.owner_label ? esc(task.owner_label) : `<span class="muted">—</span>`}</td>
        <td data-label="${t("Due date")}">${dueBit(task, carriedFrom(task)) || `<span class="muted">—</span>`}</td>
        <td data-label="${t("Type")}" dir="auto">${task.kind ? esc(t(task.kind)) : `<span class="muted">—</span>`}${window.TaskAbout.tag(task) ? `<div class="tk-about-cell">${window.TaskAbout.tag(task)}</div>` : ""}</td>
      </tr>`).join("")}</tbody></table></div>
      ${TP.footer(PAGES, view, { noun: t(view.total === 1 ? "task" : "tasks") })}</div>`;
  }

  // ---- by month, like the agency board: month headings, a goal and a type on each task, four status buttons -------------
  const monthKey = (task) => (task.due || task.created_at || "").slice(0, 7) || monthOf(new Date());
  const canEdit = () => !window.ACCESS || window.ACCESS.canEdit("tasks");
  const STATUS_ICONS = { todo: "circle", doing: "circle-dot", blocked: "octagon-pause", done: "circle-check" };
  /* The four statuses as one group of buttons: the task's own is pressed. One press saves, and the focus stays on it. */
  const quickStatus = (task) => `<div class="tk-quick" role="group" aria-label="${esc(t("Status"))}: ${esc(task.title)}">${STATUSES.map(([key, word]) => {
    const on = task.status === key;
    return `<button type="button" class="tk-q tk-q-${key}" data-task-set="${task.id}:${key}" id="tk-q-${task.id}-${key}" aria-pressed="${on}"${canEdit() ? "" : " disabled"}>${icon(STATUS_ICONS[key])}<span>${columnWord(word)}</span></button>`;
  }).join("")}</div>`;
  /* What the task is about, in links: its keywords (each opens its details) and pages (each opens the page), 2 of each and "+N". */
  function aboutLinks(task) {
    const host = task.site_host || hostHere() || null;
    const kws = (task.keywords || []).filter(Boolean), pages = (task.pages || []).filter(Boolean);
    const more = Math.max(0, kws.length - 2) + Math.max(0, pages.length - 2) + (task.about?.items || []).length;
    const kw = kws.slice(0, 2).map((k) => `<span class="tk-m-bit tk-m-kw">${icon("search")}${window.KeywordLink ? KeywordLink.html(k, { host }) : esc(k)}</span>`).join("");
    const pg = pages.slice(0, 2).map((p) => `<span class="tk-m-bit tk-m-page mono">${window.PageLink && (host || /^https?:/i.test(p)) ? PageLink.html(p, { host }) : esc(p)}</span>`).join("");
    return `${kw}${pg}${more ? `<span class="tk-m-bit muted">+${num(more)}</span>` : ""}`;
  }
  function monthRow(task) {
    const goal = task.goal ? `<span class="tk-m-bit tk-m-goal" dir="auto">${icon("target")}<span>${esc(task.goal)}</span></span>` : "";
    const kind = task.kind ? `<span class="tk-m-bit tk-m-kind tk-dot-${KIND_TONES[task.kind] || "plain"}" dir="auto">${esc(t(task.kind))}</span>` : "";
    const owner = task.owner_label ? `<span class="tk-m-bit tk-owner small sec"><span class="tk-avatar" aria-hidden="true">${esc([...task.owner_label][0].toUpperCase())}</span><span dir="auto">${esc(task.owner_label)}</span></span>` : "";
    return `<li class="tk-mrow${isOpen(task) ? "" : " tk-mrow-done"}" data-task-row="${task.id}">
      <div class="tk-m-main">
        <button type="button" class="tk-title tk-m-title" data-task-open="${task.id}" dir="auto">${esc(task.title)}</button>${findingTag(task)}
        <div class="tk-m-meta">${goal}${kind}${aboutLinks(task)}${siteBit(task)}${owner}${dueBit(task, "")}</div>
      </div>
      ${quickStatus(task)}
    </li>`;
  }
  function quickAdd() {
    if (!canEdit()) return "";
    const kinds = KINDS.map((k) => `<option value="${esc(k)}"${T.addKind === k ? " selected" : ""}>${esc(t(k))}</option>`).join("");
    return `<form class="tk-add" id="tk-add" novalidate>
      <label class="field tk-add-title"><span class="sr-only">${t("New task")}</span><input class="input" id="tk-add-title" maxlength="300" autocomplete="off" dir="auto" placeholder="${esc(t("New task: what needs doing?"))}"></label>
      <label class="field tk-add-goal"><span class="sr-only">${t("Goal")}</span><input class="input" id="tk-add-goal" maxlength="200" list="tk-add-goals" autocomplete="off" dir="auto" value="${esc(T.addGoal || "")}" placeholder="${esc(t("Goal (optional)"))}"><datalist id="tk-add-goals">${goals().map((g) => `<option value="${esc(g)}"></option>`).join("")}</datalist></label>
      <label class="field"><span class="sr-only">${t("Type")}</span><select class="select" id="tk-add-kind"><option value="">${t("No type")}</option>${kinds}</select></label>
      <label class="field"><span class="sr-only">${t("Month")}</span><input class="input" type="month" id="tk-add-month" value="${esc(T.addMonth || monthOf(new Date()))}"></label>
      <button class="btn btn-main" type="submit" id="tk-add-go">${icon("plus")}${t("Add")}</button>
      <div class="tk-add-error" id="tk-add-error" role="alert"></div>
    </form>`;
  }
  function months(list) {
    const rows = list.filter(shownByMonth);
    const groups = new Map();
    rows.forEach((task) => { const k = monthKey(task); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(task); });
    const keys = [...groups.keys()].sort();
    const none = T.show === "open" ? ["Nothing left to do here.", "Every task in these filters is done."] : T.show === "done" ? ["No task is done yet.", "Done tasks show here, under their month."] : ["Nothing matches these filters", "Change the filters above."];
    const body = keys.length ? keys.map((k) => `<section class="tk-mgroup" aria-labelledby="tk-m-${k}">
        <div class="tk-mhead"><h2 id="tk-m-${k}">${esc(monthWord(k))}</h2><span class="n-badge tabular">${num(groups.get(k).length)}</span>${k === monthOf(new Date()) ? `<span class="tk-now small">${t("This month")}</span>` : ""}</div>
        <ul class="tk-mrows">${groups.get(k).sort(byDue).map(monthRow).join("")}</ul>
      </section>`).join("") : `<div class="empty tk-mempty"><h3>${t(none[0])}</h3><p>${t(none[1])}</p></div>`;
    return `<section class="card tk-months">
      <div class="card-head tk-mtop"><h2>${t("Tasks")}</h2><span class="n-badge tabular">${num(rows.length)}</span>
        <span class="seg end" role="group" aria-label="${t("Show")}">${SHOWS.map(([id, word]) => `<button type="button" data-task-show="${id}" aria-pressed="${T.show === id}">${columnWord(word)}</button>`).join("")}</span></div>
      ${quickAdd()}
      ${body}
    </section>`;
  }

  async function setStatus(id, to, button) {
    const task = T.tasks.find((x) => x.id === id);
    if (!task || task.status === to || !canEdit()) return;
    const was = task.status;
    task.status = to; // shown at once; put back if the server says no
    paint();
    UI.$(`#tk-q-${id}-${to}`)?.focus({ preventScroll: true });
    try {
      keep(await COMP.api("PATCH", `tasks/${id}`, { status: to }));
      UI.$(`#tk-q-${id}-${to}`)?.focus({ preventScroll: true });
      if (to === "done" && T.show === "open") UI.toast(t("Task done"), { undo: () => setStatus(id, was), undoLabel: t("Undo") });
    } catch (err) {
      task.status = was;
      paint();
      UI.toast(t(err.message), { kind: "crit" });
    }
    void button;
  }
  async function quickCreate(form) {
    if (T.saving) return;
    const title = UI.$("#tk-add-title"), box = UI.$("#tk-add-error");
    UI.setHTML(box, "");
    title.classList.remove("invalid");
    if (!title.value.trim()) { title.classList.add("invalid"); title.focus(); UI.setHTML(box, `<span class="error">${icon("octagon-alert")}<span>${t("A task needs a title.")}</span></span>`); return; }
    const month = UI.$("#tk-add-month").value || monthOf(new Date());
    T.addGoal = UI.$("#tk-add-goal").value; T.addKind = UI.$("#tk-add-kind").value; T.addMonth = month;
    const siteId = T.sites.find((x) => x.host === hostHere())?.id ?? null;
    const body = { title: title.value, goal: sameGoal(T.addGoal), kind: T.addKind ? sameKind(T.addKind) : "", due: monthRange(month)[1], owner_label: signedIn() || "", site_id: siteId };
    T.saving = true;
    const go = UI.$("#tk-add-go");
    if (go) go.disabled = true;
    try {
      const saved = await COMP.api("POST", "tasks", body);
      if (T.show === "done") T.show = "open";
      keep(saved);
      UI.toast(t("Task added"), { undo: () => openTask({ task: T.tasks.find((x) => x.id === saved.id) }), undoLabel: t("Open") });
      UI.$("#tk-add-title")?.focus();
    } catch (err) {
      UI.setHTML(UI.$("#tk-add-error"), `<span class="error">${icon("octagon-alert")}<span>${esc(t(err.message))}</span></span>`);
    } finally {
      T.saving = false;
      const again = UI.$("#tk-add-go");
      if (again) again.disabled = false;
    }
    void form;
  }

  function bodyHtml() {
    if (!T.ready) return UI.skeleton ? UI.skeleton("table", { rows: 6 }) : COMP.loading();
    if (T.failed) return UI.failCard ? UI.failCard(T.failed, { retry: 'id="tk-retry"' }) : COMP.empty(t("That didn't load"), t(T.failed), `<button class="btn" id="tk-retry">${t("Try again")}</button>`);
    if (!T.tasks.length) return COMP.empty(t("No tasks yet"), t("Create one, or press Create task on a finding."), `<button class="btn btn-main" data-task-new>${icon("plus")}${t("New task")}</button>`, UI.tip("A finding is a ranking drop, a broken link, a failed health check…"));
    const list = visible();
    const hidden = undatedHidden();
    const note = hidden ? `<p class="help tk-hidden">${num(hidden)} ${t(hidden === 1 ? "undated task hidden." : "undated tasks hidden.")} <button class="link-btn" data-task-period="all">${t("Show all")}</button></p>` : "";
    const content = T.view === "months" ? months(list) : !list.length ? COMP.empty(t("Nothing matches these filters"), t("Change the filters above.")) : T.view === "table" ? table(list) : board(list);
    return `${note}${content}`;
  }

  function periodBar() {
    const nav = T.period === "month" ? `<span class="tk-month"><button class="icon-btn" data-task-month="-1" aria-label="${t("Previous month")}">${icon("chevron-left")}</button><b class="tk-month-name">${esc(monthWord(T.month))}</b><button class="icon-btn" data-task-month="1" aria-label="${t("Next month")}">${icon("chevron-right")}</button></span>` : "";
    const dates = T.period === "dates" ? `<span class="tk-dates"><label class="field"><span>${t("From")}</span><input class="input" type="date" id="tk-from" value="${esc(T.from)}"></label><label class="field"><span>${t("To")}</span><input class="input" type="date" id="tk-to" value="${esc(T.to)}"></label></span>` : "";
    return `<div class="tk-bar">
      <span class="seg" role="group" aria-label="${t("Period")}">${PERIODS.map(([id, word]) => `<button data-task-period="${id}" aria-pressed="${T.period === id}">${t(word)}</button>`).join("")}</span>
      ${nav}${dates}
      ${filterBar()}
      <span class="seg tk-views" role="group" aria-label="${t("View")}"><button data-task-view="months" aria-pressed="${T.view === "months"}">${t("By month")}</button><button data-task-view="kanban" aria-pressed="${T.view === "kanban"}">${t("Board")}</button><button data-task-view="table" aria-pressed="${T.view === "table"}">${t("Table")}</button></span>
    </div>`;
  }
  function filterBar() {
    const here = T.tasks.filter(onThisSite);
    const kinds = [...new Set(here.map((x) => x.kind).filter(Boolean))].sort();
    const goalList = [...new Set(here.map((x) => (x.goal || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const people = [...new Set(here.map((x) => x.owner_label).filter(Boolean))].sort();
    const pick = (id, label, all, options, chosen, extra = "") => `<label class="field"><span class="sr-only">${t(label)}</span><select class="select" id="${id}" ${extra}><option value="">${t(all)}</option>${options.map(([value, word]) => `<option value="${esc(value)}" ${value === chosen ? "selected" : ""}>${esc(word)}</option>`).join("")}</select></label>`;
    const active = [T.query, T.kind, T.goal, T.owner, T.view === "table" ? T.status : ""].filter(Boolean).length;
    return `<button type="button" class="btn btn-small tk-filter-toggle" data-task-filters aria-expanded="${Boolean(T.filtersOpen)}">${icon("filter")}${t("Filter")}${active ? ` <span class="tag">${num(active)}</span>` : ""}</button>
    <div class="tk-filters ${T.filtersOpen ? "open" : ""}">
      <label class="field tk-search"><span class="sr-only">${t("Search")}</span>${icon("search")}<input class="input" type="search" id="tk-query" value="${esc(T.query)}" placeholder="${t("Search tasks")}" autocomplete="off"></label>
      ${T.view === "table" ? pick("tk-status", "Status", "All statuses", STATUSES.map(([k, w]) => [k, columnWord(w)]), T.status) : ""}
      ${pick("tk-kind", "Type", "All types", kinds.map((k) => [k, t(k)]), T.kind)}
      ${goalList.length || T.goal ? pick("tk-goal", "Goal", "All goals", goalList.map((g) => [g, g]), T.goal) : ""}
      ${pick("tk-owner", "Assigned to", "Everyone", [[UNASSIGNED, t("Unassigned")], ...people.map((p) => [p, p])], T.owner)}
    </div>`;
  }
  /* Drawn apart from the page, so typing in Search never loses the box. */
  function paint() {
    const box = UI.$("#tk-body");
    if (!box) return;
    UI.setHTML(box, bodyHtml());
    const total = UI.$("#tk-total");
    if (total && T.ready) { const n = counted().length; total.textContent = `${num(n)} ${t(n === 1 ? "task" : "tasks")}`; }
    UI.syncUrl(); // the filters are in the address, so a reload or a pasted link shows the same tasks
  }

  function page() {
    // The mockup's First run switch, as a plain file: start again with what's now true.
    if (T.ready && UI.state.served === false && T.sampleFirstRun !== UI.state.firstRun) {
      T.sampleFirstRun = UI.state.firstRun;
      T.tasks = UI.state.firstRun ? [] : JSON.parse(JSON.stringify(window.COMP_SAMPLE.get.tasks.tasks));
    }
    const main = `<button class="btn btn-main" data-task-new>${icon("plus")}${t("New task")}</button>`;
    return `${UI.topbar(t("Tasks"), `${t("Who does what, where, by when")} · <span id="tk-total"></span>`, main, false)}
      <div class="content page-enter">
        ${T.ready && !T.tasks.length ? "" : periodBar()}
        <div id="tk-body">${bodyHtml()}</div>
      </div>`;
  }

  // ---- events -----------------------------------------------------------------------------------
  function bind() {
    document.addEventListener("click", (e) => {
      const hit = (sel) => e.target.closest?.(sel);
      let el;
      if ((el = hit("[data-task-filters]"))) {
        T.filtersOpen = !T.filtersOpen;
        el.setAttribute("aria-expanded", String(T.filtersOpen));
        UI.$(".tk-filters")?.classList.toggle("open", T.filtersOpen);
        return;
      }
      if ((el = hit("[data-task-find]"))) {
        const find = finds.get(el.dataset.taskFind);
        if (!find) return;
        const existing = openForKey(find.source?.key);
        if (existing) openTask({ task: existing, opener: el }); else openTask({ ...find, opener: el });
        return;
      }
      if ((el = hit("[data-task-new]"))) { openTask({ opener: el }); return; }
      if ((el = hit("[data-task-open]"))) {
        const task = T.tasks.find((x) => x.id === Number(el.dataset.taskOpen));
        if (task) openTask({ task, opener: el });
        return;
      }
      // The whole card or row opens the task, except its own controls such as the status list.
      if ((el = hit("[data-task-card], [data-task-row]")) && !hit("select, button, a, input, textarea, label")) {
        const task = T.tasks.find((x) => x.id === Number(el.dataset.taskCard || el.dataset.taskRow));
        if (task) openTask({ task, opener: el.querySelector("[data-task-open]") });
        return;
      }
      if ((el = hit("[data-task-related-open]"))) { openRelated(JSON.parse(el.closest("[data-task-related-tag]").dataset.taskRelatedTag), el); return; }
      if ((el = hit("#task-save"))) { saveTask(el); return; }
      if ((el = hit("#task-delete"))) { deleteTask(Number(el.dataset.id)); return; }
      if ((el = hit("#tk-comment-send"))) { sendComment(el); return; }
      if ((el = hit("[data-task-go]"))) { goToFinding(el.dataset.taskGo, T.openId); return; }
      if (hit("[data-task-finish]") || hit("[data-task-reopen]")) {
        UI.$("#task-status").value = hit("[data-task-finish]") ? "done" : "todo";
        UI.$("#task-save")?.click();
        return;
      }
      if ((el = hit("[data-task-week]"))) { T.period = "week"; UI.go("tasks"); return; }
      if ((el = hit("[data-today-task]"))) { const task = T.tasks.find((x) => String(x.id) === el.dataset.todayTask); if (task) openTask({ task, opener: el }); return; }
      if ((el = hit("[data-task-keep-mine]")) && T.clash) {
        const { id, mine, fresh } = T.clash;
        el.disabled = true;
        COMP.api("PATCH", `tasks/${id}`, { ...mine, expected_version: fresh.version }).then((saved) => { T.clash = null; finishSave(saved, () => UI.toast(t("Task saved"))); }).catch((err) => { el.disabled = false; UI.toast(t(err.message), { kind: "crit" }); });
        return;
      }
      if ((el = hit("[data-task-use-theirs]")) && T.clash) {
        const { fresh } = T.clash;
        T.clash = null;
        UI.forgetPanelForm();
        openTask({ task: fresh });
        return;
      }
      if ((el = hit("[data-task-set]"))) { const [id, to] = el.dataset.taskSet.split(":"); setStatus(Number(id), to, el); return; }
      if ((el = hit("[data-task-show]"))) { T.show = el.dataset.taskShow; paint(); UI.$(`[data-task-show="${T.show}"]`)?.focus({ preventScroll: true }); return; }
      if ((el = hit("#tk-retry"))) { T.ready = false; paint(); load().then(() => UI.render()); return; }
      if ((el = hit("[data-tk-sort]"))) {
        const id = el.dataset.tkSort, first = SORTS[id].first;
        T.sort = T.sort?.id !== id ? { id, dir: first } : T.sort.dir === first ? { id, dir: first === "asc" ? "desc" : "asc" } : null;
        TP.reset(PAGES); paint(); UI.$(`[data-tk-sort="${id}"]`)?.focus({ preventScroll: true });
        return;
      }
      if ((el = hit("[data-task-period]"))) {
        T.period = el.dataset.taskPeriod; TP.reset(PAGES);
        if (T.period === "month" && !T.month) T.month = monthOf(new Date());
        UI.render();
        UI.$(`[data-task-period="${T.period}"]`)?.focus({ preventScroll: true });
        return;
      }
      if ((el = hit("[data-task-month]"))) { moveMonth(Number(el.dataset.taskMonth)); TP.reset(PAGES); const again = el.dataset.taskMonth; UI.render(); UI.$(`[data-task-month="${again}"]`)?.focus({ preventScroll: true }); return; }
      if ((el = hit("[data-task-view]"))) {
        T.view = el.dataset.taskView; TP.reset(PAGES);
        UI.store.set("taskView2", T.view);
        if (T.view === "kanban") T.status = "";
        UI.render();
        UI.$(`[data-task-view="${T.view}"]`)?.focus({ preventScroll: true });
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches?.("#task-form input:not([type='date']):not(.pl-input)")) { e.preventDefault(); UI.$("#task-save")?.click(); }
    });
    document.addEventListener("submit", (e) => {
      if (e.target.id === "task-form") e.preventDefault();
      if (e.target.id === "tk-add") { e.preventDefault(); quickCreate(e.target); }
    });
    document.addEventListener("input", (e) => {
      if (e.target.id === "tk-query") { T.query = e.target.value; TP.reset(PAGES); paint(); }
    });
    document.addEventListener("change", (e) => {
      const id = e.target.id;
      if (id === "task-site") { window.TaskAbout.siteChanged(); return; } // the links point at the site picked
      if (e.target.matches?.("[data-task-move]")) { moveTask(Number(e.target.dataset.taskMove), e.target.value, `#${id}`); return; }
      if (id === "tk-status") { T.status = e.target.value; TP.reset(PAGES); paint(); return; }
      if (id === "tk-kind") { T.kind = e.target.value; TP.reset(PAGES); paint(); return; }
      if (id === "tk-goal") { T.goal = e.target.value; TP.reset(PAGES); paint(); return; }
      if (id === "tk-owner") { T.owner = e.target.value; TP.reset(PAGES); paint(); return; }
      if (id === "tk-from") { T.from = e.target.value; TP.reset(PAGES); paint(); return; }
      if (id === "tk-to") { T.to = e.target.value; TP.reset(PAGES); paint(); }
    });
    // Dragging is the quick way. Each card's status list does the same from a keyboard or a phone.
    document.addEventListener("dragstart", (e) => {
      const card = e.target.closest?.("[data-task-card]");
      if (!card) return;
      T.dragId = Number(card.dataset.taskCard);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(T.dragId));
      card.classList.add("tk-dragging");
    });
    document.addEventListener("dragend", () => {
      T.dragId = null;
      UI.$$(".tk-dragging, .tk-over").forEach((el) => el.classList.remove("tk-dragging", "tk-over"));
    });
    document.addEventListener("dragover", (e) => {
      if (T.dragId === null) return;
      const col = e.target.closest?.("[data-task-col]");
      if (!col) return;
      e.preventDefault();
      UI.$$(".tk-over").forEach((el) => { if (el !== col) el.classList.remove("tk-over"); });
      col.classList.add("tk-over");
    });
    document.addEventListener("drop", (e) => {
      if (T.dragId === null) return;
      const col = e.target.closest?.("[data-task-col]");
      if (!col) return;
      e.preventDefault();
      const id = T.dragId;
      T.dragId = null;
      moveTask(id, col.dataset.taskCol);
    });
    window.addEventListener("seocc:site-added", () => { T.sites = []; load().then(changed); });
    TP.on(PAGES, paint); // another page, another size: only the list is drawn again, so the Filter box keeps its focus
    // A board left open catches up when someone comes back to it. An open panel keeps what's being typed.
    const catchUp = async () => {
      if (document.visibilityState !== "visible" || !T.ready || T.dragId !== null || UI.state.route !== "tasks") return;
      const before = JSON.stringify(T.tasks);
      await load();
      // Only a real change redraws, and never under someone in the middle of choosing from a card's list.
      if (JSON.stringify(T.tasks) === before || T.dragId !== null) return;
      const active = document.activeElement, again = active?.dataset?.taskOpen ? `[data-task-open="${active.dataset.taskOpen}"]` : active?.id && active.closest?.("#tk-body") ? `#${CSS.escape(active.id)}` : "";
      if (active?.matches?.("[data-task-move]")) return;
      changed();
      if (again) UI.$(again)?.focus({ preventScroll: true });
    };
    window.addEventListener("focus", catchUp);
    document.addEventListener("visibilitychange", catchUp);
    setInterval(catchUp, 30000); // a board left open shows what the team has done
  }

  window.SCREENS = window.SCREENS || {};
  window.SCREENS.tasks = {
    init(helpers) {
      UI = helpers;
      ({ t, esc, icon, num, status } = helpers);
      const view = UI.store.get("taskView2");
      if (view === "table" || view === "kanban" || view === "months") T.view = view; // taskView2: the month list (2026-11-20) shows first once
      T.month = monthOf(new Date());
      helpers.openTask = openTask;
      helpers.goToFinding = goToFinding;
      helpers.taskButton = taskButton;
      helpers.relatedTasks = relatedTasks;
      helpers.relatedTag = relatedTag;
      helpers.tasksDueThisWeek = dueThisWeek;
      helpers.nextTasks = nextTasks;
      window.TASK_SITES = () => T.sites;
      window.TaskAbout.init(helpers);
      bind();
      load().then(() => { changed(); if (UI.state.route === "tasks") UI.render(); else if (UI.state.route === "today") UI.render(); });
    },
    page,
    /* The view in the address: board or table, the search, status, type, owner and dates. */
    address() {
      const out = {};
      if (T.view !== "months") out.view = T.view;
      if (T.view === "months" && T.show !== "open") out.show = T.show;
      if (T.query.trim()) out.q = T.query.trim();
      if (T.view === "table" && T.status) out.status = T.status;
      if (T.kind) out.type = T.kind;
      if (T.goal) out.goal = T.goal;
      if (T.owner) out.owner = T.owner === UNASSIGNED ? "none" : T.owner;
      if (T.period !== "all") out.when = T.period;
      if (T.period === "month" && T.month) out.month = T.month;
      if (T.period === "dates") { if (T.from) out.from = T.from; if (T.to) out.to = T.to; }
      return out;
    },
    fromAddress(q) {
      const view = q.get("view");
      if (view === "table" || view === "kanban" || view === "months") T.view = view;
      T.show = SHOWS.some(([k]) => k === q.get("show")) ? q.get("show") : "open";
      T.goal = (q.get("goal") || "").slice(0, 200);
      T.query = (q.get("q") || "").slice(0, 200);
      T.status = STATUSES.some(([k]) => k === q.get("status")) ? q.get("status") : "";
      T.kind = (q.get("type") || "").slice(0, 60);
      T.owner = q.get("owner") === "none" ? UNASSIGNED : (q.get("owner") || "").slice(0, 120);
      const when = q.get("when");
      T.period = ["all", "week", "month", "dates"].includes(when) ? when : "all";
      if (/^\d{4}-\d{2}$/.test(q.get("month") || "")) T.month = q.get("month");
      const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "");
      T.from = day(q.get("from")); T.to = day(q.get("to"));
      if (T.query || T.kind || T.goal || T.owner || T.status) T.filtersOpen = true;
    },
    after() {
      if (T.ready) { const total = UI.$("#tk-total"); if (total) { const n = counted().length; total.textContent = `${num(n)} ${t(n === 1 ? "task" : "tasks")}`; } }
    },
  };

  // Words shared with other screens keep the translation they already have.
  const fr = {
    "Related tasks": "Tâches liées", "Pages": "Pages", "Keywords": "Mots-clés", "Add a page": "Ajouter une page", "Add a keyword": "Ajouter un mot-clé",
    "Search tasks": "Chercher une tâche", "Comment as": "Commenter en tant que",
    "A task can list 50 pages at most.": "Une tâche peut lister 50 pages au maximum.", "A task can list 50 keywords at most.": "Une tâche peut lister 50 mots-clés au maximum.",
    "Who does what, where, by when": "Qui fait quoi, où, et pour quand",
    "To start": "À lancer", "Blocked": "Bloqué", "Goal": "Objectif", "All goals": "Tous les objectifs", "e.g. Strengthen site credibility": "ex. Renforcer la crédibilité du site",
    "By month": "Par mois", "All tasks": "Toutes", "This month": "Ce mois-ci", "Add": "Ajouter", "No type": "Sans type", "Goal (optional)": "Objectif (facultatif)",
    "New task: what needs doing?": "Nouvelle tâche : que faut-il faire ?", "Task added": "Tâche ajoutée", "Task done": "Tâche terminée", "Undo": "Annuler",
    "Nothing left to do here.": "Plus rien à faire ici.", "Every task in these filters is done.": "Toutes les tâches de ces filtres sont faites.",
    "No task is done yet.": "Aucune tâche n'est encore faite.", "Done tasks show here, under their month.": "Les tâches faites s'affichent ici, sous leur mois.",
    "SEO": "SEO", "Social": "Réseaux sociaux",
    "To do": "À faire", "In progress": "En cours", "Low": "Basse", "Normal": "Normale", "High": "Haute",
    "Task": "Tâche", "New task": "Nouvelle tâche", "Create task": "Créer une tâche", "Open task": "Ouvrir la tâche", "Task created": "Tâche créée", "Task saved": "Tâche enregistrée", "Task deleted": "Tâche supprimée",
    "Priority": "Priorité", "Status": "Statut", "Owner": "Responsable", "Assigned to": "Attribuée à", "Nobody": "Personne", "by": "par", "Type": "Type", "Description": "Description", "More details": "Plus de détails", "Hypothesis": "Hypothèse",
    "Business impact, 1 to 5": "Impact business, de 1 à 5", "Hours estimated": "Heures estimées", "Hours spent": "Heures passées", "Note": "Note", "Impact": "Impact",
    "Source": "Source", "Open finding": "Ouvrir le constat", "Created": "Créée", "Open": "Ouvrir", "Delete": "Supprimer",
    "Site removed:": "Site retiré :", "A task needs a title.": "Une tâche a besoin d'un titre.", "This finding already has an open task.": "Ce constat a déjà une tâche ouverte.",
    "Can't restore: a newer task covers this finding.": "Restauration impossible : une tâche plus récente couvre ce constat.", "That task doesn't exist.": "Cette tâche n'existe pas.",
    "From a finding: {label}": "Depuis un constat : {label}",
    "Comments": "Commentaires", "Comment": "Commentaire", "Add comment": "Ajouter", "Your name": "Votre nom", "A comment needs some text.": "Un commentaire a besoin de texte.",
    "This week": "Cette semaine", "Month": "Mois", "Dates": "Dates", "Period": "Période", "Previous month": "Mois précédent", "Next month": "Mois suivant", "From": "Du", "To": "Au",
    "Filter": "Filtrer", "View": "Vue", "Board": "Kanban", "Table": "Tableau", "Search": "Rechercher", "All statuses": "Tous les statuts", "All types": "Tous les types", "Everyone": "Tout le monde",
    "task": "tâche", "tasks": "tâches", "No task": "Aucune tâche", "No tasks yet": "Pas encore de tâches",
    "Create one, or press Create task on a finding.": "Créez-en une, ou appuyez sur Créer une tâche depuis un constat.",
    "Change the filters above.": "Changez les filtres ci-dessus.", "Try again": "Réessayer",
    "Carried over from": "Reportée de", "Late": "En retard", "Show all": "Tout afficher",
    "undated task hidden.": "tâche sans échéance masquée.", "undated tasks hidden.": "tâches sans échéance masquées.",
    "Content": "Contenu", "Technical": "Technique", "Links": "Liens", "UX": "UX", "Lead magnet": "Lead magnet", "Ads": "Publicité",
    "All dates": "Toutes les dates", "Health test of": "Le test de santé du", "Links check of": "Le contrôle des liens du", "no longer finds this: looks fixed.": "ne trouve plus ce problème : semble réglé.", "found this again after it was finished.": "a retrouvé ce problème après la fin de la tâche.", "Mark as done": "Marquer comme terminée", "Reopen": "Rouvrir", "Looks fixed": "Semble réglé", "Found again": "Retrouvé", "Unassigned": "Non attribuées", "Here's the finding": "Voici le constat", "Back to task": "Retour à la tâche", "Task saved, with someone else's changes too.": "Tâche enregistrée, avec aussi les changements d'une autre personne.", "Someone else changed this task. Nothing is saved yet.": "Quelqu'un d'autre a modifié cette tâche. Rien n'est encore enregistré.", "Someone else changed this task while you had it open.": "Quelqu'un d'autre a modifié cette tâche pendant que vous l'aviez ouverte.", "now": "maintenant", "Keep mine": "Garder la mienne", "Use theirs": "Reprendre la leur", "comment": "commentaire", "comments": "commentaires",
    "fell": "a chuté", "rose": "a gagné", "on": "sur", "is at": "est à", "not found on": "introuvable sur", "d": "j", "Found on": "Trouvé sur", "Backlink": "Backlink", "keyword": "mot-clé", "keywords": "mots-clés",
  };
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
