/* Social, in the side menu: the morning's LinkedIn and X drafts, and the Writing guide Claude follows.

   Today: posts of your own (Arabic) and comments on other people's posts (Arabic or English, as the post is). Nothing
   is ever posted by the app: X and LinkedIn refuse automated comments, so each one opens the post or the share box
   with the words ready, and you press Post. Mark posted when it went out: only what you posted teaches the guide.

   Writing guide: what you post about, the guide itself, rules taught in plain words, the weekly suggestions, the
   websites and newsletters read each morning, and the helpers' token.

   Other tabs can join with window.SocialView.addTab({ id, label, html(UI, siteId), after(UI, siteId) }).

   Server: seo/web/social_api.py and seo/social/service.py. */
(() => {
  "use strict";
  let UI = null;
  const S = { tab: "today", day: null, data: null, settings: null, loading: false, failed: "", siteId: null, opened: new Set(), skipping: null, angling: null, token: null, saving: new Map() };
  const EXTRA_TABS = [];
  const api = (...args) => window.COMP.api(...args);
  const PLATFORM = { x: { name: "X", logo: "x" }, linkedin: { name: "LinkedIn", logo: "linkedin" } };
  const X_LIMIT = 280;
  const LINKEDIN_LIMIT = 3000;

  // ---- helpers ------------------------------------------------------------------------------------------------
  const t = (w) => UI.t(w);
  const esc = (v) => UI.esc(v);
  const fill = (w, vals) => t(w).replace(/\{(\w+)\}/g, (_, k) => vals[k] ?? "");

  function site() {
    const picked = UI.siteIdPicked();
    if (picked) return { id: picked, host: UI.siteHostPicked() };
    const own = (window.SITES || []).filter((s) => s.realId);
    const first = UI.preferredSite(own);
    return first ? { id: first.realId, host: first.host, fallback: true } : null;
  }

  /* X counts most characters, Arabic included, as one, emoji and some others as two, and any link as 23. */
  function xLength(words) {
    const text = String(words || "").replace(/https?:\/\/\S+/g, "x".repeat(23));
    let n = 0;
    for (const ch of text) {
      const c = ch.codePointAt(0);
      n += c <= 4351 || (c >= 8192 && c <= 8205) || (c >= 8208 && c <= 8223) || (c >= 8242 && c <= 8247) ? 1 : 2;
    }
    return n;
  }

  function ago(iso) {
    if (!iso) return "";
    const hours = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3600000));
    if (hours < 1) return t("just now");
    if (hours < 24) return fill(hours === 1 ? "1 hour ago" : "{n} hours ago", { n: hours });
    const days = Math.round(hours / 24);
    return fill(days === 1 ? "1 day ago" : "{n} days ago", { n: days });
  }

  function platformTag(p) {
    const info = PLATFORM[p] || { name: p, logo: "" };
    return `<span class="so-platform">${UI.logo(info.logo, 16)}<span>${esc(info.name)}</span></span>`;
  }

  const langTag = (lang) => `<span class="tag so-lang">${esc(lang === "ar" ? t("Arabic") : t("English"))}</span>`;

  function statusPill(item) {
    const map = { approved: ["Opened, not marked posted", "warn", "clock"], posted: ["Posted", "good", "circle-check"], skipped: ["Skipped", "", "x"], rewrite: ["Rewriting next run", "", "rotate-ccw"] };
    const found = map[item.status];
    if (!found) return "";
    return `<span class="status ${found[1]} so-pill">${UI.icon(found[2])}${esc(t(found[0]))}</span>`;
  }

  // ---- loading ------------------------------------------------------------------------------------------------
  async function load({ quiet = false } = {}) {
    const where = site();
    if (!where) { S.data = null; S.failed = ""; paint(); return; }
    S.siteId = where.id;
    S.loading = !quiet;
    if (!quiet) paint();
    try {
      const day = S.day ? `&date=${encodeURIComponent(S.day)}` : "";
      const [data, settings] = await Promise.all([api("GET", `social/day?site_id=${where.id}${day}`, null, { fresh: true }), api("GET", `social/settings?site_id=${where.id}`, null, { fresh: true })]);
      S.data = data; S.settings = settings; S.failed = "";
    } catch (err) {
      S.failed = err.message || t("Social didn't load.");
    }
    S.loading = false;
    paint();
  }

  // ---- Today ---------------------------------------------------------------------------------------------------
  const STAGE_WORDS = { rss: "Websites", mail: "Newsletters", grok: "Grok (X trends)", writing: "Writing" };

  function stagesHtml(d) {
    const st = d.stages || {};
    const row = (key) => {
      const s = st[key];
      if (!s) return `<li class="so-stage"><span class="so-stage-mark muted">${UI.icon("circle")}</span><span class="so-stage-name">${esc(t(STAGE_WORDS[key]))}</span><span class="muted small">${esc(t(key === "writing" ? "Not yet today" : "Not read yet today"))}</span></li>`;
      const words = s.ok ? fill(key === "writing" ? "{n} drafts" : "{n} new", { n: UI.num(s.count || 0) }) : s.error || t("Failed");
      return `<li class="so-stage ${s.ok ? "" : "so-stage-bad"}"><span class="so-stage-mark ${s.ok ? "good" : "crit"}">${UI.icon(s.ok ? "circle-check" : "triangle-alert")}</span><span class="so-stage-name">${esc(t(STAGE_WORDS[key]))}</span><span class="small ${s.ok ? "muted" : "so-err"}" dir="auto">${esc(words)}</span></li>`;
    };
    const confirm = st.mail?.confirmations || [];
    const confirmHtml = confirm.length ? `<div class="note info so-confirm">${UI.icon("mail")}<div><p><b>${esc(t("A newsletter asks you to confirm your sign-up"))}</b></p>${confirm.map((c) => `<p class="small"><span dir="auto">${esc(c.subject)}</span> · ${esc(c.sender)} ${c.links[0] ? `<a href="${esc(c.links[0])}" target="_blank" rel="noopener noreferrer">${esc(t("Open the link"))}</a>` : ""}</p>`).join("")}</div></div>` : "";
    return `<ul class="so-stages" aria-label="${esc(t("This morning's steps"))}">${["rss", "mail", "grok", "writing"].map(row).join("")}</ul>${confirmHtml}`;
  }

  function verdict(d) {
    const open = (list) => list.filter((i) => i.status === "new" || i.status === "approved").length;
    const posts = open(d.posts), comments = open(d.comments);
    if (posts || comments) {
      const parts = [];
      if (posts) parts.push(fill(posts === 1 ? "1 post" : "{n} posts", { n: posts }));
      if (comments) parts.push(fill(comments === 1 ? "1 comment" : "{n} comments", { n: comments }));
      return `<h2 class="so-verdict">${esc(fill("{what} to check", { what: parts.join(t(" and ")) }))}</h2>`;
    }
    const done = d.posts.concat(d.comments).filter((i) => i.status === "posted").length;
    if (done) return `<h2 class="so-verdict">${esc(fill(done === 1 ? "All done: 1 posted" : "All done: {n} posted", { n: done }))}</h2>`;
    return `<h2 class="so-verdict">${esc(t(d.stages?.writing ? "Nothing left to check" : "Drafts arrive each morning"))}</h2>`;
  }

  function textBox(item) {
    const value = item.text || "";
    const dir = item.lang === "ar" ? "rtl" : "auto";
    const limit = item.platform === "x" ? X_LIMIT : LINKEDIN_LIMIT;
    const length = item.platform === "x" ? xLength(value) : [...value].length;
    const over = length > limit;
    const locked = item.status === "posted" || item.status === "skipped";
    // As tall as the words, so a short comment isn't a big empty box and a long post isn't a scroll inside a scroll.
    const perLine = item.lang === "ar" ? 80 : 95;
    const lines = value.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil([...line].length / perLine)), 0);
    const rows = Math.min(16, Math.max(item.kind === "post" ? 4 : 3, lines + 1));
    return `<div class="so-text-wrap">
      <label class="sr" for="so-text-${item.id}">${esc(t(item.kind === "post" ? "Post text" : "Comment text"))}</label>
      <textarea class="input so-text ${item.lang === "ar" ? "so-ar" : ""}" id="so-text-${item.id}" data-so-text="${item.id}" dir="${dir}" lang="${esc(item.lang)}" rows="${rows}" ${locked ? "readonly" : ""}>${esc(value)}</textarea>
      <p class="so-count small ${over ? "so-over" : "muted"}" id="so-count-${item.id}" aria-live="polite"><span>${esc(fill("{n} of {max}", { n: UI.num(length), max: UI.num(limit) }))}</span>${item.edited ? ` · ${esc(t("edited"))}` : ""}<span class="so-saving" data-so-saving="${item.id}"></span></p>
    </div>`;
  }

  function skipHtml(item) {
    if (S.skipping !== item.id) return "";
    const reasons = S.data?.skip_reasons || [];
    return `<div class="so-reasons" role="group" aria-label="${esc(t("Why skip it?"))}"><span class="small muted">${esc(t("Why skip it? One tap teaches the guide."))}</span>
      ${reasons.map((r) => `<button type="button" class="chip" data-so-skip-reason="${item.id}" data-reason="${esc(r)}">${esc(t(r))}</button>`).join("")}
      <button type="button" class="chip" data-so-skip-reason="${item.id}" data-reason="">${esc(t("No reason"))}</button></div>`;
  }

  function angleHtml(item) {
    if (S.angling !== item.id) return "";
    return `<div class="so-angle"><label class="small" for="so-angle-${item.id}">${esc(t("Your angle: what should it say instead?"))}</label>
      <textarea class="input" id="so-angle-${item.id}" rows="2" dir="auto" placeholder="${esc(t("For example: focus on the cost for a small business"))}">${esc(item.angle || "")}</textarea>
      <div class="so-row"><button type="button" class="btn" data-so-rewrite-go="${item.id}">${UI.icon("rotate-ccw")}${esc(t("Rewrite at the next run"))}</button><button type="button" class="btn btn-ghost" data-so-angle-cancel>${esc(t("Cancel"))}</button></div></div>`;
  }

  function actionsHtml(item) {
    const posted = item.status === "posted", skipped = item.status === "skipped";
    if (item.status === "rewrite") return `<div class="so-acts"><span class="small muted">${esc(t("Written again at the next run."))}</span><button type="button" class="btn btn-ghost" data-so-status="${item.id}" data-to="new">${UI.icon("x")}${esc(t("Keep this version"))}</button></div>`;
    if (posted || skipped) return `<div class="so-acts"><button type="button" class="btn btn-ghost" data-so-status="${item.id}" data-to="new">${UI.icon("rotate-ccw")}${esc(t(posted ? "Not posted after all" : "Bring it back"))}</button></div>`;
    const acts = [];
    if (item.kind === "post") {
      acts.push(item.platform === "x"
        ? `<button type="button" class="btn btn-main" data-so-send="${item.id}">${UI.logo("x", 14)}${esc(t("Post on X"))}</button>`
        : `<button type="button" class="btn btn-main" data-so-send="${item.id}">${UI.icon("copy")}${esc(t("Copy and open LinkedIn"))}</button>`);
    } else {
      const opened = S.opened.has(item.id) || item.status === "approved";
      acts.push(`<a class="btn ${opened ? "" : "btn-main"}" href="${esc(item.source_url)}" target="_blank" rel="noopener noreferrer" data-so-open="${item.id}">${UI.icon("external-link")}${esc(t("Open the post"))}</a>`);
      acts.push(item.platform === "x"
        ? `<button type="button" class="btn ${opened ? "btn-main" : ""}" data-so-send="${item.id}">${UI.logo("x", 14)}${esc(t("Reply on X"))}</button>`
        : `<button type="button" class="btn ${opened ? "btn-main" : ""}" data-so-send="${item.id}">${UI.icon("copy")}${esc(t("Copy comment"))}</button>`);
    }
    if (item.status === "approved") acts.push(`<button type="button" class="btn" data-so-status="${item.id}" data-to="posted">${UI.icon("check")}${esc(t("Mark posted"))}</button>`);
    acts.push(`<span class="end so-quiet"><button type="button" class="btn btn-ghost" data-so-angle="${item.id}">${UI.icon("pencil")}${esc(t("Rewrite"))}</button><button type="button" class="btn btn-ghost" data-so-skip="${item.id}">${UI.icon("x")}${esc(t("Skip"))}</button></span>`);
    return `<div class="so-acts">${acts.join("")}</div>`;
  }

  const ORIGIN_WORDS = { rss: "From a website:", mail: "From a newsletter:", grok: "From an X trend:" };

  function postHtml(item) {
    const topic = item.topic_title ? (item.topic_link ? `<a href="${esc(item.topic_link)}" target="_blank" rel="noopener noreferrer" dir="auto">${esc(item.topic_title)}</a>` : `<span dir="auto">${esc(item.topic_title)}</span>`) : "";
    return `<li class="so-item ${item.status === "posted" || item.status === "skipped" ? "so-done" : ""}" data-so-item="${item.id}">
      <div class="so-item-head">${platformTag(item.platform)}${statusPill(item)}</div>
      ${topic ? `<p class="so-topic small"><span class="muted">${esc(t(ORIGIN_WORDS[item.topic_origin] || "About:"))}</span> ${topic}</p>` : ""}
      ${textBox(item)}${actionsHtml(item)}${skipHtml(item)}${angleHtml(item)}
    </li>`;
  }

  function commentHtml(item) {
    const who = item.source_author ? `<b dir="auto">${esc(item.source_author)}</b>` : `<b>${esc(t("A post"))}</b>`;
    const facts = [item.source_at ? ago(item.source_at) : "", item.platform === "linkedin" ? t("LinkedIn links can't be checked") : item.link_checked ? t("Link checked") : ""].filter(Boolean);
    return `<li class="so-item ${item.status === "posted" || item.status === "skipped" ? "so-done" : ""}" data-so-item="${item.id}">
      <div class="so-item-head">${platformTag(item.platform)}${langTag(item.lang)}${statusPill(item)}</div>
      <div class="so-source"><p class="small">${who}${facts.length ? ` <span class="muted">· ${facts.map(esc).join(" · ")}</span>` : ""}</p>
        ${item.source_text ? `<blockquote class="so-quote" dir="auto">${esc(item.source_text)}</blockquote>` : ""}</div>
      ${textBox(item)}${actionsHtml(item)}${skipHtml(item)}${angleHtml(item)}
    </li>`;
  }

  function addTargetHtml() {
    return `<details class="so-add"><summary class="btn btn-ghost">${UI.icon("plus")}${esc(t("Add a post to comment on"))}</summary>
      <form class="so-add-form" id="so-add-form" novalidate>
        <label class="small" for="so-add-url">${esc(t("The post's address"))}</label>
        <input class="input" id="so-add-url" type="url" required placeholder="https://x.com/… or https://www.linkedin.com/posts/…">
        <label class="small" for="so-add-text">${esc(t("The post's text (needed for LinkedIn: Claude can't open it)"))}</label>
        <textarea class="input" id="so-add-text" rows="3" dir="auto"></textarea>
        <div class="so-row"><label class="small" for="so-add-lang">${esc(t("Comment in"))}</label>
          <select class="input so-select" id="so-add-lang"><option value="en">${esc(t("English"))}</option><option value="ar">${esc(t("Arabic"))}</option></select>
          <button type="submit" class="btn">${UI.icon("plus")}${esc(t("Add"))}</button></div>
        <p class="small so-err" id="so-add-error" role="alert"></p>
        <p class="small muted">${esc(t("Its comment is written at the next morning run."))}</p>
      </form></details>`;
  }

  function trendsHtml(d) {
    if (!d.trends?.length) return "";
    return `<details class="card so-trends"><summary><h2>${esc(fill("X trends today ({n})", { n: d.trends.length }))}</h2></summary><ul class="so-trend-list">
      ${d.trends.map((tr) => `<li><p><b dir="auto">${esc(tr.topic)}</b></p><p class="small muted" dir="auto">${esc(tr.why)}</p>${(tr.links || []).map((u, i) => `<a class="small" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(fill("Post {n}", { n: i + 1 }))}</a>`).join(" · ")}</li>`).join("")}
    </ul></details>`;
  }

  function setupHtml(d) {
    const steps = [
      [Boolean(S.settings?.niche), "Say what you post about", "Grok looks for trends and posts in your field."],
      [d.set_up.sources > 0, "Add websites and newsletters", "Their new articles become post ideas each morning."],
      [d.set_up.token, "Connect the writing helper", "Claude writes in Anthropic's cloud on your Claude Pro plan and sends the drafts here."],
    ];
    return `<section class="card so-setup"><h2>${esc(t("Set up Social"))}</h2><ol class="so-steps">
      ${steps.map(([done, title, why]) => `<li class="${done ? "done" : ""}"><span class="so-step-mark">${UI.icon(done ? "circle-check" : "circle")}</span><div><p><b>${esc(t(title))}</b></p><p class="small muted">${esc(t(why))}</p></div></li>`).join("")}
    </ol><button type="button" class="btn btn-main" data-so-tab="guide">${esc(t("Open the Writing guide"))}</button></section>`;
  }

  function todayHtml() {
    const d = S.data;
    const days = d.days?.length ? `<label class="so-day"><span class="sr">${esc(t("Day"))}</span><select class="input so-select" id="so-day">${[d.date, ...d.days.filter((x) => x !== d.date)].map((x) => `<option value="${esc(x)}" ${x === d.date ? "selected" : ""}>${esc(UI.fmtDateOnly ? UI.fmtDateOnly(x) : x)}</option>`).join("")}</select></label>` : "";
    const needsSetup = !d.set_up.token || !d.set_up.sources;
    const posts = d.posts, comments = d.comments;
    const waiting = d.waiting_comments ? `<p class="small muted so-waiting">${esc(fill(d.waiting_comments === 1 ? "1 post waits for its comment: it's written at the next run." : "{n} posts wait for their comment: they're written at the next run.", { n: d.waiting_comments }))}</p>` : "";
    return `
      <section class="card so-head-card">
        <div class="so-head-row">${verdict(d)}<span class="end so-row">${days}<button type="button" class="btn btn-ghost" id="so-gather">${UI.icon("refresh-cw")}${esc(t("Read my sources now"))}</button></span></div>
        ${stagesHtml(d)}
      </section>
      ${needsSetup ? setupHtml(d) : ""}
      <section class="card so-list-card"><div class="card-head"><h2>${esc(t("Your posts"))}</h2><span class="small muted">${esc(t("In Arabic, from today's topics"))}</span></div>
        ${posts.length ? `<ul class="so-items">${posts.map(postHtml).join("")}</ul>` : `<div class="empty"><p>${esc(t(d.topics_48h ? "No post drafts yet. They arrive with the morning run." : "No topics yet. Add websites or newsletters in the Writing guide."))}</p></div>`}
      </section>
      <section class="card so-list-card"><div class="card-head"><h2>${esc(t("Comments"))}</h2><span class="small muted">${esc(t("Read the post first, then send your comment"))}</span><span class="end">${addTargetHtml()}</span></div>
        ${comments.length ? `<ul class="so-items">${comments.map(commentHtml).join("")}</ul>` : `<div class="empty"><p>${esc(t("No comments to check today."))}</p></div>`}
        ${waiting}
      </section>
      ${trendsHtml(d)}`;
  }

  // ---- Writing guide ------------------------------------------------------------------------------------------
  function guideHtml() {
    const fromSkill = ((S.settings && S.settings.guide) || "").match(/^# Skill: (.+)$/m)?.[1] || "";
    const s = S.settings;
    const admin = window.BOOT?.user ? window.BOOT.user.role === "admin" : true;
    const rules = s.rules.length ? `<ul class="so-rules">${s.rules.map((r) => `<li><span dir="auto">${esc(r.text)}</span><button type="button" class="icon-btn" data-so-rule-remove="${esc(r.id)}" aria-label="${esc(t("Remove this rule"))}" title="${esc(t("Remove this rule"))}">${UI.icon("trash-2")}</button></li>`).join("")}</ul>` : `<p class="small muted">${esc(t("No rules yet. Write one the way you'd tell a person."))}</p>`;
    const proposals = s.proposals.length ? `<section class="card"><div class="card-head"><h2>${esc(t("Suggested by Claude this week"))}</h2><span class="small muted">${esc(t("From what you changed. Nothing is added without your yes."))}</span></div><ul class="so-rules">
      ${s.proposals.map((p) => `<li><div><p dir="auto">${esc(p.text)}</p>${p.why ? `<p class="small muted" dir="auto">${esc(p.why)}</p>` : ""}</div><span class="so-row"><button type="button" class="btn" data-so-proposal="${esc(p.id)}" data-accept="1">${UI.icon("check")}${esc(t("Add to the guide"))}</button><button type="button" class="btn btn-ghost" data-so-proposal="${esc(p.id)}" data-accept="0">${esc(t("No"))}</button></span></li>`).join("")}</ul></section>` : "";
    const source = (kind) => s.sources.filter((x) => x.kind === kind).map((x) => `<li><span class="so-src-mark ${x.last_error ? "crit" : x.last_ok_at ? "good" : "muted"}">${UI.icon(x.last_error ? "triangle-alert" : x.last_ok_at ? "circle-check" : "circle")}</span><div><p class="so-src-addr" dir="auto">${esc(x.label || x.address)}</p>${x.label ? `<p class="small muted">${esc(x.address)}</p>` : ""}${x.last_error ? `<p class="small so-err" dir="auto">${esc(x.last_error)}</p>` : ""}</div><button type="button" class="icon-btn end" data-so-source-remove="${x.id}" aria-label="${esc(t("Remove"))}" title="${esc(t("Remove"))}">${UI.icon("trash-2")}</button></li>`).join("") || `<li class="small muted">${esc(t("None yet."))}</li>`;
    const token = S.token ? `<div class="note warn so-token-once"><p><b>${esc(t("Copy it now: it's shown only once."))}</b></p><p class="so-token"><code>${esc(S.token)}</code> <button type="button" class="btn" data-so-copy-token>${UI.icon("copy")}${esc(t("Copy"))}</button></p></div>` : "";
    const tokenWords = s.token.set ? fill("The writing helper and Grok sign in with a token ending in {last4}.", { last4: s.token.last4 }) : t("No helper token yet. The writing helper needs one to read the brief and send drafts.");
    return `
      <section class="card"><div class="card-head"><h2>${esc(t("What you post about"))}</h2></div>
        <label class="sr" for="so-niche">${esc(t("What you post about"))}</label>
        <textarea class="input" id="so-niche" rows="2" dir="auto" placeholder="${esc(t("For example: company setup in Dubai, visas, tax for entrepreneurs"))}">${esc(s.niche)}</textarea>
        <div class="so-row"><button type="button" class="btn" id="so-niche-save">${esc(t("Save"))}</button><span class="small muted">${esc(t("Grok searches X for this each morning."))}</span></div>
      </section>
      <section class="card"><div class="card-head"><h2>${esc(t("Rules"))}</h2><span class="small muted">${esc(t("Followed from the next draft on"))}</span></div>
        ${rules}
        <form class="so-row so-teach" id="so-teach"><label class="sr" for="so-rule">${esc(t("Teach a rule"))}</label><input class="input" id="so-rule" dir="auto" maxlength="500" placeholder="${esc(t("Teach a rule, like: never start with a question"))}"><button type="submit" class="btn btn-main">${UI.icon("plus")}${esc(t("Teach"))}</button></form>
      </section>
      ${proposals}
      <section class="card"><div class="card-head"><h2>${esc(t("Writing guide"))}</h2><span class="small muted tabular">${esc(fill("Version {n}", { n: s.guide_version }))}</span></div>
        <p class="small muted">${esc(t("Your voice in full: tone, dialect, how posts open, length, emojis and hashtags, with examples you like and don't like. We write the first version together."))}</p>
        <label class="sr" for="so-guide">${esc(t("Writing guide"))}</label>
        <textarea class="input so-guide" id="so-guide" rows="14" dir="auto">${esc(s.guide)}</textarea>
        <div class="so-row"><button type="button" class="btn" id="so-guide-save">${esc(t("Save the guide"))}</button>
          <label class="btn" for="so-skill-file">${UI.icon("upload")}${esc(t(fromSkill ? "Upload a new version" : "Upload a skill"))}</label>
          <input class="sr" type="file" id="so-skill-file" accept=".md,.markdown,.txt,.zip,.skill">
          <span class="small muted">${esc(t(fromSkill ? fill("From your skill “{name}”.", { name: fromSkill }) : "SKILL.md, or a .zip or .skill file. It replaces the guide."))}</span></div>
      </section>
      <section class="card"><div class="card-head"><h2>${esc(t("Where ideas come from"))}</h2></div>
        <h3 class="so-h3">${UI.icon("rss")}${esc(t("Websites"))}</h3><ul class="so-sources">${source("rss")}</ul>
        <form class="so-row" data-so-add-source="rss" novalidate><label class="sr" for="so-src-rss">${esc(t("Website feed address"))}</label><input class="input" id="so-src-rss" type="url" placeholder="https://example.com/feed"><button type="submit" class="btn">${UI.icon("plus")}${esc(t("Add"))}</button></form>
        <h3 class="so-h3">${UI.icon("mail")}${esc(t("Newsletters"))}</h3><ul class="so-sources">${source("mail")}</ul>
        <form class="so-row" data-so-add-source="mail" novalidate><label class="sr" for="so-src-mail">${esc(t("Newsletter sender address"))}</label><input class="input" id="so-src-mail" type="email" placeholder="news@example.com"><button type="submit" class="btn">${UI.icon("plus")}${esc(t("Add"))}</button></form>
        <p class="small muted">${esc(t("Only mail from these senders is read. Everything else in the mailbox is left alone."))}</p>
        <p class="small so-err" id="so-src-error" role="alert"></p>
        ${admin ? `<details class="so-mailbox"><summary class="small">${esc(t(s.mail.set ? "Newsletter mailbox: connected" : "Newsletter mailbox: not connected"))}</summary>
          <form class="so-grid" id="so-mailbox"><label class="small" for="so-mail-host">${esc(t("Mail server (IMAP)"))}</label><input class="input" id="so-mail-host" value="${esc(s.mail.host || "")}" placeholder="mail.example.com">
            <label class="small" for="so-mail-user">${esc(t("Mailbox address"))}</label><input class="input" id="so-mail-user" value="${esc(s.mail.user || "")}" placeholder="newsletters@example.com" autocomplete="off">
            <label class="small" for="so-mail-pass">${esc(t("Password"))}</label><input class="input" id="so-mail-pass" type="password" autocomplete="new-password" placeholder="${esc(s.mail.set ? t("Kept. Type to change it.") : "")}">
            <span></span><button type="submit" class="btn">${esc(t("Save the mailbox"))}</button></form></details>` : ""}
      </section>
      ${admin ? `<section class="card"><div class="card-head"><h2>${esc(t("Helpers"))}</h2></div>
        <p class="small">${esc(tokenWords)}</p>
        ${token}
        <div class="so-row"><button type="button" class="btn" id="so-token-new">${UI.icon("key-round")}${esc(t(s.token.set ? "Make a new token" : "Make a token"))}</button>${s.token.set ? `<span class="small muted">${esc(t("A new token stops the old one at once."))}</span>` : ""}</div>
      </section>` : ""}`;
  }

  // ---- the page -------------------------------------------------------------------------------------------------
  function tabsList() { return [["today", "Today"], ["guide", "Writing guide"], ...EXTRA_TABS.map((x) => [x.id, x.label])]; }

  function page() {
    const where = site();
    const sub = where ? fill("LinkedIn and X for {host}", { host: where.host }) : t("LinkedIn and X");
    const head = UI.topbar(t("Social"), sub, "", false);
    const tabs = `<div class="page-tabs so-tabs" role="tablist" aria-label="${esc(t("Social"))}">${tabsList().map(([id, w]) => `<button class="page-tab tab" role="tab" id="so-tab-${id}" data-so-tab="${id}" aria-selected="${S.tab === id}" tabindex="${S.tab === id ? 0 : -1}">${esc(t(w))}</button>`).join("")}</div>`;
    return `${head}<div class="content page-enter so-page">${tabs}<div id="so-body" role="tabpanel" aria-labelledby="so-tab-${S.tab}">${bodyHtml()}</div></div>`;
  }

  function bodyHtml() {
    if (!site()) return `<div class="card empty"><h3>${esc(t("Add a website first"))}</h3><p>${esc(t("Social belongs to one of your websites."))}</p></div>`;
    const extra = EXTRA_TABS.find((x) => x.id === S.tab);
    if (extra) return extra.html(UI, site().id);
    if (S.failed && !S.data) return `<div class="card note warn" role="alert">${UI.icon("triangle-alert")}<span>${esc(S.failed)}</span> <button type="button" class="btn" id="so-retry">${esc(t("Try again"))}</button></div>`;
    if (!S.data || !S.settings) return UI.skeleton ? UI.skeleton("rows", { rows: 5 }) : "";
    return S.tab === "guide" ? guideHtml() : todayHtml();
  }

  function paint() {
    if (!UI || UI.state.route !== "social") return;
    const body = UI.$("#so-body");
    if (!body) return;
    const focused = document.activeElement?.id;
    UI.setHTML(body, bodyHtml());
    body.setAttribute("aria-labelledby", `so-tab-${S.tab}`);
    UI.$$(".so-tabs [data-so-tab]").forEach((b) => { const on = b.dataset.soTab === S.tab; b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; });
    if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
    EXTRA_TABS.find((x) => x.id === S.tab)?.after?.(UI, site()?.id);
  }

  function after() {
    if (S.siteId !== site()?.id) { S.data = null; S.settings = null; S.day = null; }
    load({ quiet: Boolean(S.data) });
  }

  // ---- actions --------------------------------------------------------------------------------------------------
  const findItem = (id) => (S.data ? S.data.posts.concat(S.data.comments) : []).find((i) => i.id === Number(id));

  function replaceItem(fresh) {
    if (!S.data) return;
    for (const list of [S.data.posts, S.data.comments]) {
      const at = list.findIndex((i) => i.id === fresh.id);
      if (at >= 0) list[at] = fresh;
    }
  }

  async function patch(id, body, { repaint = true } = {}) {
    try {
      const fresh = await api("PATCH", `social/items/${id}`, body);
      replaceItem(fresh);
      if (repaint) paint();
      return fresh;
    } catch (err) {
      UI.toast(err.message || t("That didn't save."), { kind: "warn" });
      return null;
    }
  }

  async function copy(words) {
    try { await navigator.clipboard.writeText(words); return true; } catch { return false; }
  }

  function tweetId(url) { const m = String(url || "").match(/\/status\/(\d+)/); return m ? m[1] : null; }

  async function send(id) {
    const item = findItem(id);
    if (!item) return;
    const box = document.getElementById(`so-text-${id}`);
    const words = (box ? box.value : item.text || "").trim();
    if (!words) { UI.toast(t("Write something first."), { kind: "warn" }); return; }
    if (item.platform === "x" && xLength(words) > X_LIMIT) { UI.toast(fill("It's over X's {n} characters. Shorten it first.", { n: X_LIMIT }), { kind: "warn" }); box?.focus(); return; }
    let url;
    if (item.platform === "x") {
      const reply = item.kind === "comment" ? tweetId(item.source_url) : null;
      url = `https://x.com/intent/post?text=${encodeURIComponent(words)}${reply ? `&in_reply_to=${reply}` : ""}`;
    } else {
      url = item.kind === "comment" ? item.source_url : "https://www.linkedin.com/feed/?shareActive=true";
    }
    // Opened first, while the click still counts as the person's: a browser blocks a tab opened after waiting.
    const tab = window.open(url, "_blank", "noopener");
    const copied = await copy(words);
    if (item.platform === "linkedin" || !tab) UI.toast(t(copied ? "Copied. Paste it in LinkedIn and press Post." : "Couldn't copy: select the text and copy it."), { kind: copied ? "good" : "warn" });
    await patch(id, { ...(words !== (item.text || "").trim() ? { text: words } : {}), status: "approved" });
  }

  function onText(box) {
    const id = Number(box.dataset.soText), item = findItem(id);
    if (!item) return;
    const limit = item.platform === "x" ? X_LIMIT : LINKEDIN_LIMIT;
    const n = item.platform === "x" ? xLength(box.value) : [...box.value].length;
    const count = document.getElementById(`so-count-${id}`);
    if (count) { count.firstElementChild.textContent = fill("{n} of {max}", { n: UI.num(n), max: UI.num(limit) }); count.classList.toggle("so-over", n > limit); count.classList.toggle("muted", n <= limit); }
    clearTimeout(S.saving.get(id));
    S.saving.set(id, setTimeout(() => saveText(id, box.value), 900));
  }

  async function saveText(id, value) {
    S.saving.delete(id);
    const item = findItem(id);
    if (!item || !value.trim() || value.trim() === (item.text || "").trim()) return;
    const mark = document.querySelector(`[data-so-saving="${id}"]`);
    if (mark) mark.textContent = ` · ${t("saving…")}`;
    const fresh = await patch(id, { text: value }, { repaint: false });
    const markAfter = document.querySelector(`[data-so-saving="${id}"]`);
    if (markAfter) markAfter.textContent = fresh ? ` · ${t("saved")}` : "";
  }

  async function settingsCall(method, path, body, done) {
    try {
      S.settings = await api(method, path, { site_id: S.siteId, ...body });
      paint();
      if (done) UI.toast(t(done));
      return true;
    } catch (err) {
      UI.toast(err.message, { kind: "warn" });
      return false;
    }
  }

  /* A writing skill replaces the guide. The rules taught here stay and still win over it. */
  async function uploadSkill(input) {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { UI.toast(t("The file is over 2 MB. A writing skill is text: remove images or other large files."), { kind: "warn" }); return; }
    if ((S.settings.guide || "").trim() && UI.confirmDanger && !(await UI.confirmDanger({ title: t("Replace the guide with this skill?"), body: t("The guide below is replaced. Your rules stay."), yes: t("Replace the guide") }))) return;
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("site_id", S.siteId);
    try {
      const view = await api("POST", "social/skill", null, { form });
      S.settings = view;
      paint();
      UI.toast(fill("Skill “{name}” loaded. The next drafts follow it.", { name: view.skill }), { kind: "good" });
    } catch (err) {
      UI.toast(err.message, { kind: "warn" });
    }
  }

  function bind() {
    document.addEventListener("click", async (e) => {
      if (UI.state.route !== "social") return;
      const hit = (sel) => e.target.closest?.(sel);
      let el;
      if ((el = hit("[data-so-tab]"))) { S.tab = el.dataset.soTab; paint(); document.getElementById(`so-tab-${S.tab}`)?.focus({ preventScroll: true }); return; }
      if (hit("#so-retry")) { load(); return; }
      if ((el = hit("[data-so-send]"))) { send(el.dataset.soSend); return; }
      if ((el = hit("[data-so-open]"))) { S.opened.add(Number(el.dataset.soOpen)); setTimeout(paint, 50); return; }
      if ((el = hit("[data-so-status]"))) { patch(el.dataset.soStatus, { status: el.dataset.to }).then((f) => { if (f && f.status === "posted") UI.toast(t("Marked posted. It now teaches the guide.")); }); return; }
      if ((el = hit("[data-so-skip]"))) { S.skipping = S.skipping === Number(el.dataset.soSkip) ? null : Number(el.dataset.soSkip); S.angling = null; paint(); return; }
      if ((el = hit("[data-so-skip-reason]"))) { S.skipping = null; patch(el.dataset.soSkipReason, { status: "skipped", reason: el.dataset.reason || null }); return; }
      if ((el = hit("[data-so-angle]"))) { S.angling = S.angling === Number(el.dataset.soAngle) ? null : Number(el.dataset.soAngle); S.skipping = null; paint(); document.getElementById(`so-angle-${S.angling}`)?.focus(); return; }
      if (hit("[data-so-angle-cancel]")) { S.angling = null; paint(); return; }
      if ((el = hit("[data-so-rewrite-go]"))) {
        const id = el.dataset.soRewriteGo, angle = document.getElementById(`so-angle-${id}`)?.value || "";
        S.angling = null;
        const fresh = await patch(id, { angle, status: "rewrite" });
        if (fresh) UI.toast(t("It will be written again at the next run, with your angle."));
        return;
      }
      if ((el = hit("#so-gather"))) {
        el.disabled = true;
        try {
          const done = await api("POST", "social/gather", { site_id: S.siteId });
          S.data = done.day; paint();
          UI.toast(fill("{n} new ideas from your sources", { n: (done.rss.added || 0) + (done.mail.added || 0) }));
        } catch (err) { UI.toast(err.message, { kind: "warn" }); }
        if (el.isConnected) el.disabled = false;
        return;
      }
      if (hit("#so-niche-save")) { settingsCall("PUT", "social/guide", { niche: UI.$("#so-niche").value }, "Saved"); return; }
      if (hit("#so-guide-save")) {
        const before = S.settings.guide_version;
        const ok = await settingsCall("PUT", "social/guide", { guide: UI.$("#so-guide").value });
        if (ok) UI.toast(t(S.settings.guide_version > before ? "Guide saved. The next drafts follow it." : "Nothing changed in the guide."), { kind: S.settings.guide_version > before ? "good" : "info" });
        return;
      }
      if ((el = hit("[data-so-rule-remove]"))) { settingsCall("POST", "social/rules/remove", { id: el.dataset.soRuleRemove }, "Rule removed"); return; }
      if ((el = hit("[data-so-proposal]"))) { settingsCall("POST", "social/proposals", { id: el.dataset.soProposal, accept: el.dataset.accept === "1" }, el.dataset.accept === "1" ? "Added to the guide" : ""); return; }
      if ((el = hit("[data-so-source-remove]"))) {
        const ok = !UI.confirmDanger || await UI.confirmDanger({ title: t("Remove this source?"), body: t("Its articles stop coming in. Ideas already read stay."), yes: t("Remove") });
        if (ok) settingsCall("POST", "social/sources/remove", { id: Number(el.dataset.soSourceRemove) }, "Removed");
        return;
      }
      if (hit("#so-token-new")) {
        if (S.settings.token.set && UI.confirmDanger && !(await UI.confirmDanger({ title: t("Make a new token?"), body: t("The old one stops at once: update the writing helper with the new one."), yes: t("Make a new token") }))) return;
        try { const made = await api("POST", "social/token", { site_id: S.siteId }); S.token = made.token; S.settings.token = { set: true, last4: made.last4 }; paint(); } catch (err) { UI.toast(err.message, { kind: "warn" }); }
        return;
      }
      if (hit("[data-so-copy-token]")) { UI.toast(t((await copy(S.token)) ? "Copied" : "Couldn't copy: select it and copy it.")); }
    });
    document.addEventListener("input", (e) => {
      if (UI.state.route !== "social") return;
      if (e.target.matches?.("[data-so-text]")) onText(e.target);
    });
    document.addEventListener("change", (e) => {
      if (UI.state.route !== "social") return;
      if (e.target.id === "so-skill-file") { uploadSkill(e.target); return; }
      if (e.target.id !== "so-day") return;
      S.day = e.target.value; load();
    });
    document.addEventListener("submit", async (e) => {
      if (UI.state.route !== "social") return;
      const form = e.target;
      if (form.id === "so-teach") {
        e.preventDefault();
        const input = UI.$("#so-rule");
        if (!input.value.trim()) { input.focus(); return; }
        if (await settingsCall("POST", "social/rules", { text: input.value }, "Rule added: followed from the next draft")) UI.$("#so-rule")?.focus();
        return;
      }
      if (form.dataset.soAddSource) {
        e.preventDefault();
        const kind = form.dataset.soAddSource, input = form.querySelector("input");
        const error = UI.$("#so-src-error");
        try { S.settings = await api("POST", "social/sources", { site_id: S.siteId, kind, address: input.value }); paint(); UI.toast(t(kind === "rss" ? "Website added: read each morning" : "Sender added: subscribe with your newsletter mailbox")); }
        catch (err) { if (error) error.textContent = err.message; input.focus(); }
        return;
      }
      if (form.id === "so-mailbox") {
        e.preventDefault();
        settingsCall("PUT", "social/mailbox", { host: UI.$("#so-mail-host").value, user: UI.$("#so-mail-user").value, password: UI.$("#so-mail-pass").value }, "Mailbox saved");
        return;
      }
      if (form.id === "so-add-form") {
        e.preventDefault();
        const error = UI.$("#so-add-error");
        try {
          S.data = await api("POST", "social/targets", { site_id: S.siteId, url: UI.$("#so-add-url").value, text: UI.$("#so-add-text").value, lang: UI.$("#so-add-lang").value });
          paint(); UI.toast(t("Added. Its comment is written at the next run."));
        } catch (err) { if (error) error.textContent = err.message; }
      }
    });
    document.addEventListener("keydown", (e) => {
      if (UI.state.route !== "social" || !e.target.matches?.(".so-tabs [data-so-tab]") || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      const ids = tabsList().map(([id]) => id), at = ids.indexOf(S.tab);
      S.tab = ids[(at + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length];
      paint(); document.getElementById(`so-tab-${S.tab}`)?.focus();
    });
  }

  window.SCREENS = window.SCREENS || {};
  window.SCREENS.social = { init(helpers) { UI = helpers; bind(); }, page, after };
  window.SocialView = {
    xLength,
    // Another file's tab inside Social (a teammate's Video transcripts, for one): drawn by its own html(), after() once it's on screen.
    addTab(tab) { if (tab?.id && !EXTRA_TABS.some((x) => x.id === tab.id)) EXTRA_TABS.push(tab); },
    repaint: () => paint(),
  };

  const words = {
    "Social": "Réseaux sociaux", "LinkedIn and X": "LinkedIn et X", "LinkedIn and X for {host}": "LinkedIn et X pour {host}", "Today": "Aujourd'hui", "Writing guide": "Guide d'écriture",
    "Arabic": "Arabe", "English": "Anglais", "just now": "à l'instant", "1 hour ago": "il y a 1 heure", "{n} hours ago": "il y a {n} heures", "1 day ago": "il y a 1 jour", "{n} days ago": "il y a {n} jours",
    "Opened, not marked posted": "Ouvert, pas encore publié", "Posted": "Publié", "Skipped": "Ignoré", "Rewriting next run": "Réécrit au prochain passage",
    "Social didn't load.": "Les réseaux sociaux ne se sont pas chargés.", "Websites": "Sites web", "Newsletters": "Newsletters", "Grok (X trends)": "Grok (tendances X)", "Writing": "Rédaction",
    "Not yet today": "Pas encore aujourd'hui", "Not read yet today": "Pas encore lu aujourd'hui", "{n} drafts": "{n} brouillons", "{n} new": "{n} nouveaux", "Failed": "Échec",
    "A newsletter asks you to confirm your sign-up": "Une newsletter vous demande de confirmer l'inscription", "Open the link": "Ouvrir le lien", "This morning's steps": "Les étapes de ce matin",
    "1 post": "1 publication", "{n} posts": "{n} publications", "1 comment": "1 commentaire", "{n} comments": "{n} commentaires", " and ": " et ", "{what} to check": "{what} à vérifier",
    "All done: 1 posted": "Terminé : 1 publié", "All done: {n} posted": "Terminé : {n} publiés", "Nothing left to check": "Plus rien à vérifier", "Drafts arrive each morning": "Les brouillons arrivent chaque matin",
    "Post text": "Texte de la publication", "Comment text": "Texte du commentaire", "{n} of {max}": "{n} sur {max}", "edited": "modifié",
    "Why skip it?": "Pourquoi l'ignorer ?", "Why skip it? One tap teaches the guide.": "Pourquoi l'ignorer ? Un clic enseigne le guide.", "No reason": "Sans raison",
    "Not my topic": "Pas mon sujet", "Too formal": "Trop formel", "Weak opening": "Début faible", "Too long": "Trop long", "Sounds like AI": "Ça sonne IA", "Wrong facts": "Faits faux", "Already covered": "Déjà traité",
    "Your angle: what should it say instead?": "Votre angle : que devrait-il dire ?", "For example: focus on the cost for a small business": "Par exemple : parler du coût pour une petite entreprise",
    "Rewrite at the next run": "Réécrire au prochain passage", "Cancel": "Annuler", "Not posted after all": "Pas publié finalement", "Bring it back": "Le remettre",
    "Post on X": "Publier sur X", "Copy and open LinkedIn": "Copier et ouvrir LinkedIn", "Open the post": "Ouvrir la publication", "Reply on X": "Répondre sur X", "Copy comment": "Copier le commentaire",
    "Mark posted": "Marquer publié", "Rewrite": "Réécrire", "Skip": "Ignorer", "From a website:": "D'un site web :", "From a newsletter:": "D'une newsletter :", "From an X trend:": "D'une tendance X :", "About:": "Sujet :",
    "A post": "Une publication", "LinkedIn links can't be checked": "Les liens LinkedIn ne peuvent pas être vérifiés", "Link checked": "Lien vérifié",
    "Add a post to comment on": "Ajouter une publication à commenter", "The post's address": "L'adresse de la publication", "The post's text (needed for LinkedIn: Claude can't open it)": "Le texte de la publication (nécessaire pour LinkedIn : Claude ne peut pas l'ouvrir)",
    "Comment in": "Commenter en", "Add": "Ajouter", "Its comment is written at the next morning run.": "Son commentaire est écrit au prochain passage du matin.",
    "X trends today ({n})": "Tendances X aujourd'hui ({n})", "Post {n}": "Publication {n}",
    "Say what you post about": "Dites sur quoi vous publiez", "Grok looks for trends and posts in your field.": "Grok cherche les tendances et publications de votre domaine.",
    "Add websites and newsletters": "Ajoutez des sites et des newsletters", "Their new articles become post ideas each morning.": "Leurs nouveaux articles deviennent des idées chaque matin.",
    "Connect the writing helper": "Connectez l'assistant de rédaction", "Claude writes in Anthropic's cloud on your Claude Pro plan and sends the drafts here.": "Claude écrit dans le cloud d'Anthropic avec votre abonnement Claude Pro et envoie les brouillons ici.",
    "Set up Social": "Configurer les réseaux sociaux", "Open the Writing guide": "Ouvrir le guide d'écriture", "Day": "Jour", "Read my sources now": "Lire mes sources maintenant",
    "1 post waits for its comment: it's written at the next run.": "1 publication attend son commentaire : il est écrit au prochain passage.",
    "{n} posts wait for their comment: they're written at the next run.": "{n} publications attendent leur commentaire : ils sont écrits au prochain passage.",
    "Your posts": "Vos publications", "In Arabic, from today's topics": "En arabe, d'après les sujets du jour",
    "No post drafts yet. They arrive with the morning run.": "Pas encore de brouillon. Ils arrivent avec le passage du matin.", "No topics yet. Add websites or newsletters in the Writing guide.": "Pas encore de sujets. Ajoutez des sites ou des newsletters dans le guide d'écriture.",
    "Comments": "Commentaires", "Read the post first, then send your comment": "Lisez d'abord la publication, puis envoyez votre commentaire", "No comments to check today.": "Aucun commentaire à vérifier aujourd'hui.",
    "Remove this rule": "Retirer cette règle", "No rules yet. Write one the way you'd tell a person.": "Pas encore de règle. Écrivez-en une comme vous le diriez à quelqu'un.",
    "Suggested by Claude this week": "Suggéré par Claude cette semaine", "From what you changed. Nothing is added without your yes.": "D'après vos modifications. Rien n'est ajouté sans votre accord.",
    "Add to the guide": "Ajouter au guide", "No": "Non", "Remove": "Retirer", "None yet.": "Aucun pour l'instant.", "Copy it now: it's shown only once.": "Copiez-le maintenant : il n'est montré qu'une fois.", "Copy": "Copier",
    "What you post about": "Sur quoi vous publiez", "For example: company setup in Dubai, visas, tax for entrepreneurs": "Par exemple : création de société à Dubaï, visas, fiscalité des entrepreneurs",
    "Save": "Enregistrer", "Grok searches X for this each morning.": "Grok cherche cela sur X chaque matin.", "Rules": "Règles", "Followed from the next draft on": "Suivies dès le prochain brouillon",
    "Teach a rule": "Enseigner une règle", "Teach a rule, like: never start with a question": "Enseignez une règle, par exemple : ne jamais commencer par une question", "Teach": "Enseigner",
    "Version {n}": "Version {n}", "Your voice in full: tone, dialect, how posts open, length, emojis and hashtags, with examples you like and don't like. We write the first version together.":
      "Votre voix en entier : ton, dialecte, début des publications, longueur, emojis et hashtags, avec des exemples que vous aimez ou non. Nous écrivons la première version ensemble.",
    "Save the guide": "Enregistrer le guide", "Upload a skill": "Importer un skill", "Upload a new version": "Importer une nouvelle version",
    "From your skill “{name}”.": "Depuis votre skill « {name} ».", "SKILL.md, or a .zip or .skill file. It replaces the guide.": "SKILL.md, ou un fichier .zip ou .skill. Il remplace le guide.",
    "Replace the guide with this skill?": "Remplacer le guide par ce skill ?", "The guide below is replaced. Your rules stay.": "Le guide ci-dessous est remplacé. Vos règles restent.", "Replace the guide": "Remplacer le guide",
    "Skill “{name}” loaded. The next drafts follow it.": "Skill « {name} » chargé. Les prochains brouillons le suivent.",
    "The file is over 2 MB. A writing skill is text: remove images or other large files.": "Le fichier dépasse 2 Mo. Un skill d'écriture est du texte : retirez les images ou gros fichiers.", "Where ideas come from": "D'où viennent les idées", "Website feed address": "Adresse du flux du site", "Newsletter sender address": "Adresse de l'expéditeur de la newsletter",
    "Only mail from these senders is read. Everything else in the mailbox is left alone.": "Seuls les mails de ces expéditeurs sont lus. Le reste de la boîte n'est pas touché.",
    "Newsletter mailbox: connected": "Boîte des newsletters : connectée", "Newsletter mailbox: not connected": "Boîte des newsletters : non connectée", "Mail server (IMAP)": "Serveur mail (IMAP)", "Mailbox address": "Adresse de la boîte",
    "Password": "Mot de passe", "Kept. Type to change it.": "Conservé. Tapez pour le changer.", "Save the mailbox": "Enregistrer la boîte", "Helpers": "Assistants",
    "The writing helper and Grok sign in with a token ending in {last4}.": "L'assistant de rédaction et Grok se connectent avec un jeton finissant par {last4}.",
    "No helper token yet. The writing helper needs one to read the brief and send drafts.": "Pas encore de jeton. L'assistant de rédaction en a besoin pour lire le brief et envoyer les brouillons.",
    "Make a new token": "Créer un nouveau jeton", "Make a token": "Créer un jeton", "A new token stops the old one at once.": "Un nouveau jeton arrête l'ancien immédiatement.",
    "Add a website first": "Ajoutez d'abord un site", "Social belongs to one of your websites.": "Les réseaux sociaux appartiennent à l'un de vos sites.", "Try again": "Réessayer",
    "That didn't save.": "Ce n'est pas enregistré.", "Write something first.": "Écrivez d'abord quelque chose.", "It's over X's {n} characters. Shorten it first.": "Ça dépasse les {n} caractères de X. Raccourcissez d'abord.",
    "Copied. Paste it in LinkedIn and press Post.": "Copié. Collez-le dans LinkedIn et cliquez sur Publier.", "Couldn't copy: select the text and copy it.": "Copie impossible : sélectionnez le texte et copiez-le.",
    "saving…": "enregistrement…", "saved": "enregistré", "Marked posted. It now teaches the guide.": "Marqué publié. Il enseigne maintenant le guide.",
    "It will be written again at the next run, with your angle.": "Il sera réécrit au prochain passage, avec votre angle.", "{n} new ideas from your sources": "{n} nouvelles idées de vos sources",
    "Saved": "Enregistré", "Guide saved. The next drafts follow it.": "Guide enregistré. Les prochains brouillons le suivent.", "Nothing changed in the guide.": "Rien n'a changé dans le guide.",
    "Rule removed": "Règle retirée", "Added to the guide": "Ajouté au guide", "Remove this source?": "Retirer cette source ?", "Its articles stop coming in. Ideas already read stay.": "Ses articles n'arrivent plus. Les idées déjà lues restent.",
    "Removed": "Retiré", "Make a new token?": "Créer un nouveau jeton ?", "The old one stops at once: update the writing helper with the new one.": "L'ancien s'arrête immédiatement : mettez à jour l'assistant avec le nouveau.",
    "Copied": "Copié", "Couldn't copy: select it and copy it.": "Copie impossible : sélectionnez-le et copiez-le.", "Rule added: followed from the next draft": "Règle ajoutée : suivie dès le prochain brouillon",
    "Website added: read each morning": "Site ajouté : lu chaque matin", "Sender added: subscribe with your newsletter mailbox": "Expéditeur ajouté : abonnez-vous avec votre boîte des newsletters",
    "Mailbox saved": "Boîte enregistrée", "Added. Its comment is written at the next run.": "Ajouté. Son commentaire est écrit au prochain passage.", "Drafts ready": "Brouillons prêts", "Written again at the next run.": "Réécrit au prochain passage.", "Keep this version": "Garder cette version",
  };
  Object.keys(words).forEach((w) => { if (window.FR && window.FR[w] === undefined) window.FR[w] = words[w]; });
})();
