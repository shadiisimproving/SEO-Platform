/* Backlinks: does each link count for Google, what Search Console lists, links to reclaim, spam and the disavow file, and a monthly budget.
   mockup.js calls these from the Backlinks screen. On the plain-file sample a few sample links get made-up verdicts so the screen shows them. */
(() => {
  "use strict";
  const COMP = window.COMP;
  let UI = null, H = {};
  const S = { reclaim: new Map(), budgets: new Map(), effects: new Map(), sites: new Map(), gscBusy: false, view: "page", domain: "" };
  const MANY_OUTBOUND = 100, SPAM_SCORE = 30, CURRENCIES = ["USD", "EUR", "AED", "GBP"];

  const VERDICT = { counts: ["vd-counts", "Counts"], weak: ["vd-weak", "Weak"], none: ["vd-none", "Doesn't count"] };
  const REASONS = {
    noindex: "The page is set to noindex, so Google drops the page and the link with it.",
    robots_blocked: "The site's robots.txt stops Google from reading the page.",
    page_nofollow: "The page tells Google not to follow any of its links.",
    nofollow: "Marked nofollow: Google takes it as a hint and usually passes no ranking value.",
    sponsored: "Marked sponsored: right for a paid link, but it passes little or no ranking value.",
    ugc: "Marked ugc (user content): it passes little or no ranking value.",
    canonical_elsewhere: "The page names another page as its main version, so Google may count that one instead.",
    many_outbound: "The page links to more than 100 other websites, which looks like a link list.",
    source_not_indexed: "Google doesn't have the linking page: two site: searches in a row didn't find it. A page Google doesn't have passes nothing.",
  };
  const ANCHORS = {
    brand: ["Brand", "Your brand or domain name. The safest kind of anchor."],
    url: ["Bare URL", "The address itself, such as www.example.com. Safe and natural."],
    exact: ["Exact keyword", "Exactly one of your tracked keywords. Helps the most, but too many look bought."],
    partial: ["Partial keyword", "Holds one of your tracked keywords among other words."],
    generic: ["Generic", "Words like click here or read more. Natural, but tell Google little."],
  };
  const t = (w) => UI.t(w), esc = (v) => UI.esc(v);
  const siteIdOf = (host) => (H.sites?.() || []).find((s) => s.host === host)?.id ?? null;
  const pickedHost = () => UI.siteHostPicked?.() || null;

  // ---- in the table ---------------------------------------------------------------------------------
  function reasonsText(list) {
    return (list || []).map((r) => t(REASONS[r] || r)).join(" ");
  }

  /* Beside the status: the verdict, then what Google's own list says. Only for a link that was read or that Search Console listed. */
  function badge(b) {
    const parts = [];
    const c = b.check;
    if (c?.verdict && b.status === "live") {
      const [cls, word] = VERDICT[c.verdict];
      const tip = c.verdict === "counts" ? t("Google can see this page and the link passes value.") : reasonsText(c.reasons);
      parts.push(`<span class="tag vd-tag ${cls}" data-tip="${esc(tip)}" tabindex="0">${t(word)}</span>`);
    }
    if (b.status === "live" && b.sourceIndex?.state === "not_indexed") parts.push(`<span class="tag vd-tag vd-none" data-tip="${esc(t(REASONS.source_not_indexed))}" tabindex="0">${t("Linking page not indexed")}</span>`);
    const ix = b.status === "live" ? b.targetIndex : null;
    if (ix && (ix.state === "not_indexed" || ix.state === "unknown")) parts.push(`<span class="tag vd-tag vd-weak" data-tip="${esc(indexWhy(ix))}" tabindex="0">${t("Your page isn't indexed")}</span>`);
    const g = b.gsc || {};
    if (g.seen === "page") parts.push(`<span class="tag vd-tag vd-google" data-tip="${esc(t("Search Console lists this page among your links"))}${g.crawled ? ` · ${esc(t("last crawled"))} ${esc(g.crawled)}` : ""}" tabindex="0">${t("Google sees it")}</span>`);
    else if (g.seen === "site") parts.push(`<span class="tag vd-tag vd-google" data-tip="${esc(t("Search Console lists this website among your links, but not this exact page."))}" tabindex="0">${t("Google sees the site")}</span>`);
    else if (g.not_listed) parts.push(`<span class="tag vd-tag" data-tip="${esc(t("Placed more than 60 days before your last Search Console upload, and not in it. Its list is a sample, so this is only a hint."))}" tabindex="0">${t("Not listed by Google yet")}</span>`);
    if (b.disavow) parts.push(`<span class="tag vd-tag vd-none" data-tip="${esc(t("Marked as spam: it's in the disavow file."))}" tabindex="0">${t("Spam")}</span>`);
    return parts.length ? `<span class="vd-row">${parts.join("")}</span>` : "";
  }

  /* The Live card's second line: how many live links pass value, once any has been read. */
  function liveNote(links) {
    const read = links.filter((b) => b.status === "live" && b.check?.verdict);
    if (!read.length) return "";
    const counts = read.filter((b) => b.check.verdict === "counts").length;
    return `<span class="ab" data-tip="${esc(t("Read on the last check: followed, on a page Google can index."))}">${UI.num(counts)} ${t(counts === 1 ? "counts for Google" : "count for Google")}</span>`;
  }

  /* Authority: the file's DA, or else Open PageRank with its name, because two tools' scores don't compare. */
  function authorityCell(b) {
    if (b.auth) return UI.dec(b.auth);
    if (b.opr !== null && b.opr !== undefined) return `<span data-tip="${esc(t("Open PageRank, 0 to 10. Not the same scale as DA."))}" tabindex="0">${UI.dec(b.opr)} <span class="tag">OPR</span></span>`;
    return "—";
  }

  const looksSpammy = (b) => (b.check?.outbound_links || 0) > MANY_OUTBOUND || (b.spam !== null && b.spam !== undefined && b.spam >= SPAM_SCORE);

  // ---- on a link's panel -----------------------------------------------------------------------------
  function panelBlocks(b, { server }) {
    const c = b.check || {};
    let html = "";
    if (c.verdict) {
      const [cls, word] = VERDICT[c.verdict];
      const reasons = (c.reasons || []).map((r) => `<li>${esc(t(REASONS[r] || r))}</li>`).join("");
      html += `<h3>${t("Does Google count it?")}</h3>
        <p class="lk-result"><span class="tag vd-tag ${cls}">${t(word)}</span> ${c.verdict === "counts" ? t("Google can see this page and the link passes value.") : ""}</p>
        ${reasons ? `<ul class="vd-reasons">${reasons}</ul>` : ""}`;
      const lang = (v) => (v || "").slice(0, 2);
      if (lang(c.page_lang) && lang(c.target_lang) && lang(c.page_lang) !== lang(c.target_lang)) {
        html += `<p class="note">${UI.icon("info")}<span>${t("The linking page is in {a} and your page is in {b}. Links from pages in the same language and on the same topic usually help more.").replace("{a}", esc(lang(c.page_lang).toUpperCase())).replace("{b}", esc(lang(c.target_lang).toUpperCase()))}</span></p>`;
      }
    }
    html += sourceLine(b, server);
    if (c.target_http === 404 || c.target_http === 410) {
      html += `<p class="note warn">${UI.icon("triangle-alert")}<span>${t("Your target page answers {n}, so this link is wasted until the page redirects to a live one.").replace("{n}", c.target_http)}</span></p>`;
    }
    html += indexBlock(b, server);
    const g = b.gsc || {};
    if (g.seen || g.not_listed) html += `<p class="small sec">${UI.icon("search")} ${g.seen === "page" ? t("Search Console lists this page among your links") : g.seen === "site" ? t("Search Console lists this website among your links, but not this exact page.") : t("Not in your last Search Console upload.")}${g.crawled ? ` · ${t("last crawled")} ${esc(g.crawled)}` : ""}</p>`;
    if (server && b.serverId) {
      html += `<div id="vd-effect" data-id="${b.serverId}">${effectInner(b.serverId)}</div>`;
      if (!S.effects.has(b.serverId)) loadEffect(b.serverId);
    }
    return html;
  }

  // ---- is the linking page on Google: free signals, then a site: search ----------------------------------------
  function sourceLine(b, server) {
    if (b.status !== "live") return "";
    const si = b.sourceIndex, facts = S.sites.get(b.site) || {};
    const via = si?.via === "Search Console" ? t("Search Console lists the link") : si?.via ? t("a site: search on {tool}").replace("{tool}", esc(si.via)) : "";
    const when = si?.at ? ` · ${esc(si.at)}` : "";
    if (!si) {
      if (!server) return "";
      return `<p class="small sec">${UI.icon("search")} ${facts.site_search ? t("Whether Google has the linking page is searched on the next check.") : t("Connect a rankings search tool, such as SerpApi, to check whether Google has the linking page. Only free searches are used.")}</p>`;
    }
    if (si.state === "indexed") return `<p class="small sec">${UI.icon("circle-check")} ${t("The linking page is on Google")}: ${via}${when}</p>`;
    if (si.state === "not_found") return `<p class="small sec">${UI.icon("search")} ${t("Not found on Google yet: a site: search didn't show the linking page. Search results are incomplete, so it's searched again in a few days, and only a second miss marks it not indexed.")}${when}</p>`;
    if (si.state === "not_indexed") return `<p class="note warn">${UI.icon("triangle-alert")}<span>${t("Google doesn't have the linking page: two site: searches in a row didn't find it. Ask the website to get it indexed, or the link passes nothing.")}${when}</span></p>`;
    return ""; // not_indexable: the reasons above already say why
  }

  // ---- filters, By website, anchor types and site traffic, in the Done table ------------------------------------
  const domainOf = (b) => b.domain || window.BacklinkCleaner?.rootDomain?.(b.src) || "";
  const isUseful = (b) => b.status === "live" && b.check?.verdict === "counts";
  const isUseless = (b) => b.status === "live" && (b.check?.verdict === "weak" || b.check?.verdict === "none");
  const notIndexed = (b) => b.status === "live" && ["not_indexed", "not_indexable"].includes(b.sourceIndex?.state);
  const sendsVisits = (b) => (b.visits || 0) > 0;
  const FILTERS = { useful: isUseful, visits: sendsVisits, noindex: notIndexed, useless: isUseless, lost: (b) => b.status === "lost" };

  function filterRows(list, filter) {
    const mine = S.domain ? list.filter((b) => domainOf(b) === S.domain) : list;
    return FILTERS[filter] ? mine.filter(FILTERS[filter]) : mine;
  }

  /* The four answers a person asks of their links. A chip shows once it has something, or while it's picked. */
  function filterChips(list, picked) {
    const chip = (key, word, tip) => {
      const n = list.filter(FILTERS[key]).length;
      return n || picked === key ? `<button class="chip" data-bl-filter="${key}" aria-pressed="${picked === key}" data-tip="${esc(t(tip))}">${t(word)}<b>${UI.num(n)}</b></button>` : "";
    };
    const site = S.domain ? `<button class="chip" data-vd-domain="" aria-pressed="true">${t("Website")}: <span class="mono" dir="auto">${esc(S.domain)}</span> ${UI.icon("x")}</button>` : "";
    return site + chip("useful", "Useful", "Live, followed, on a page Google can index") + chip("visits", "Sends visits", "Brought at least one visit")
      + chip("noindex", "Linking page not indexed", "Google doesn't have the page the link is on, or can't index it") + chip("useless", "Not useful", "Nofollow, sponsored, or on a page that passes nothing");
  }

  const byWebsite = () => S.view === "website";
  function viewSwitch() {
    const one = (key, word) => `<button class="tab" role="tab" data-vd-view="${key}" aria-selected="${S.view === key}">${t(word)}</button>`;
    return `<span class="tabs vd-view" role="tablist" aria-label="${esc(t("Show"))}">${one("page", "By page")}${one("website", "By website")}</span>`;
  }

  const ahrefsOn = () => [...S.sites.values()].some((f) => f.ahrefs);
  const trafficHead = () => (ahrefsOn() ? `<th scope="col" class="r" data-tip="${esc(t("Ahrefs' estimate of the linking website's monthly visits from Google"))}">${t("Site traffic")}</th>` : "");
  const trafficValue = (v) => (v === null || v === undefined ? '<span class="muted">—</span>' : UI.num(v));
  const trafficCell = (b) => (ahrefsOn() ? `<td class="r tabular" data-label="${t("Site traffic")}">${trafficValue(b.siteTraffic)}</td>` : "");

  function anchorTag(b) {
    const a = ANCHORS[b.anchorType];
    return a ? ` <span class="tag vd-anchor" data-tip="${esc(t(a[1]))}" tabindex="0">${t(a[0])}</span>` : "";
  }

  /* One row per linking website: how many links, the best of them, and what the website is worth. */
  function websiteTable(rows) {
    const groups = new Map();
    rows.forEach((b) => { const d = domainOf(b); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(b); });
    const rank = { counts: 3, weak: 2, none: 1 };
    const list = [...groups].map(([domain, links]) => {
      const best = links.filter((b) => b.status === "live" && b.check?.verdict).sort((x, y) => rank[y.check.verdict] - rank[x.check.verdict])[0];
      const auth = Math.max(...links.map((b) => b.auth || 0)), opr = Math.max(...links.map((b) => b.opr ?? -1));
      const visits = links.some((b) => b.visits !== null && b.visits !== undefined) ? links.reduce((s, b) => s + (b.visits || 0), 0) : null;
      return { domain, links, best, auth, opr, visits, traffic: links.find((b) => b.siteTraffic !== null && b.siteTraffic !== undefined)?.siteTraffic ?? null, live: links.filter((b) => b.status === "live").length };
    }).sort((x, y) => (y.auth - x.auth) || (y.opr - x.opr) || (y.links.length - x.links.length) || x.domain.localeCompare(y.domain));
    if (!list.length) return COMP.empty(t("No links match"), t("Pick another filter."));
    return `<div class="table-wrap"><table class="data" id="bl-sites"><thead><tr><th scope="col">${t("Website")}</th><th scope="col" class="r">${t("Links")}</th><th scope="col" data-tip="${esc(t("The best of this website's links, as the last check read it"))}">${t("Best link")}</th><th scope="col" class="r">${t("Authority")}</th>${trafficHead()}<th scope="col" class="r">${t("Visits")}</th></tr></thead><tbody>
      ${list.map((g) => {
        const tag = g.best ? `<span class="tag vd-tag ${VERDICT[g.best.check.verdict][0]}">${t(VERDICT[g.best.check.verdict][1])}</span>` : '<span class="muted">—</span>';
        const authority = g.auth ? UI.dec(g.auth) : g.opr >= 0 ? `${UI.dec(g.opr)} <span class="tag">OPR</span>` : '<span class="muted">—</span>';
        return `<tr><td class="head-cell"><span class="with-logo">${UI.siteLogo ? UI.siteLogo(g.domain) : ""}<span class="logo-text"><button class="kw mono small" data-vd-domain="${esc(g.domain)}" style="text-align:start" data-tip="${esc(t("Show this website's links"))}"><span dir="auto">${esc(g.domain)}</span></button><span class="second">${g.live} ${t("live")}</span></span></span></td>
          <td class="r tabular" data-label="${t("Links")}">${UI.num(g.links.length)}</td><td data-label="${t("Best link")}">${tag}</td><td class="r" data-label="${t("Authority")}">${authority}</td>
          ${ahrefsOn() ? `<td class="r tabular" data-label="${t("Site traffic")}">${trafficValue(g.traffic)}</td>` : ""}<td class="r tabular" data-label="${t("Visits")}">${g.visits === null ? '<span class="muted">—</span>' : UI.num(g.visits)}</td></tr>`;
      }).join("")}</tbody></table></div>`;
  }

  // ---- is my page indexed: Search Console's URL Inspection, about my own target page ------------------------
  const pathOf = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url || ""; } };

  function indexWhy(ix) {
    if (ix.state === "unknown") return t("Google doesn't know this page yet, so the link can't help it rank. Add it to your sitemap or ask for indexing in Search Console.");
    return `${t("Google hasn't indexed this page, so the link can't help it rank yet.")}${ix.coverage ? ` ${t("Google says:")} “${ix.coverage}”` : ""}`;
  }

  function indexBlock(b, server) {
    if (b.status !== "live") return "";
    const ix = b.targetIndex, facts = S.sites.get(b.site) || {};
    const head = `<h3>${t("Is your page in Google?")}</h3>`;
    if (!ix) {
      if (!server) return "";
      if (!facts.index_check) return `${head}<p class="small sec">${t("Connect Search Console for this site and Google is asked whether your target page is indexed.")} <a href="#settings">${t("Data sources")}</a></p>`;
      return `${head}<p class="small sec">${t("Google is asked on the next check. Press Check now to ask today.")}</p>`;
    }
    const page = pathOf(ix.url);
    const from = `<p class="small muted vd-from">${t("From Search Console's URL Inspection")}${ix.checked ? `, ${esc(ix.checked)}` : ""}.</p>`;
    if (ix.state === "error") return `${head}<p class="small sec">${UI.icon("triangle-alert")} ${esc(t(ix.error))}</p>${from}`;
    if (ix.state === "indexed") {
      return `${head}<p class="lk-result"><span class="tag vd-tag vd-counts">${t("Indexed")}</span> <span class="mono small" dir="auto">${esc(page)}</span>${ix.crawled ? ` · ${t("last crawled")} ${esc(ix.crawled)}` : ""}</p>${from}`;
    }
    const canonical = ix.google_canonical ? `<p class="small sec">${t("Google treats another page as the main version:")} <span class="mono" dir="auto">${esc(pathOf(ix.google_canonical))}</span></p>` : "";
    const task = UI.taskButton ? UI.taskButton({ title: `${t("Get indexed:")} ${page}`, host: b.site, source: { type: "backlink", label: page, host: b.site, facts: [ix.coverage || t("Not indexed")], link: "#backlinks", key: `index|${b.site}|${page}` } }, { label: "Task" }) : "";
    return `${head}<p class="lk-result"><span class="tag vd-tag vd-none">${t(ix.state === "unknown" ? "Unknown to Google" : "Not indexed")}</span> <span class="mono small" dir="auto">${esc(page)}</span></p>
      <p class="note warn">${UI.icon("triangle-alert")}<span>${esc(indexWhy(ix))}</span></p>${canonical}<div style="margin:6px 0">${task}</div>${from}`;
  }

  /* Below the link check: the one thing a person decides about a bad link. */
  function spamBlock(b, { server }) {
    if (!server || !b.serverId) return "";
    return `<h3>${t("Spam")}</h3><p class="small sec">${looksSpammy(b) ? `${t("This page looks like spam: it has many outbound links or a high spam score.")} ` : ""}${t("Mark a link you can't get removed and that could look paid or spammy. It goes in the disavow file.")}</p>
      <button class="btn btn-small" data-vd-disavow="${b.serverId}" data-on="${b.disavow ? "1" : ""}">${UI.icon(b.disavow ? "check" : "ban")}${t(b.disavow ? "Not spam" : "Mark as spam")}</button>`;
  }

  async function loadEffect(id) {
    S.effects.set(id, { loading: true });
    try { S.effects.set(id, await COMP.api("GET", `backlinks/${id}/before-after`)); } catch { S.effects.set(id, { state: "error" }); }
    const box = UI.$(`#vd-effect[data-id="${id}"]`);
    if (box) UI.setHTML(box, effectInner(id));
  }

  function effectInner(id) {
    const e = S.effects.get(id);
    if (!e || e.loading) return "";
    if (e.state !== "ok") return e.state === "no_date" ? `<h3>${t("Before and after")}</h3><p class="small sec">${t(e.note)}</p>` : "";
    const pct = (v) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${UI.num(v)}%`);
    const unit = UI.state.lang === "fr" ? "j" : "d";
    return `<h3>${t("Before and after")} <span class="tag">${t("Correlation, not proof")}</span></h3>
      <div class="kv"><div><div class="k">${t("Clicks to the target page")} · ${e.days} ${unit} ${t("before")}</div><div class="v">${UI.num(e.before.clicks)}</div></div><div><div class="k">${e.days} ${unit} ${t("after")}</div><div class="v">${UI.num(e.after.clicks)}</div></div></div>
      <p class="small sec" style="margin-top:6px">${t("This page")} ${pct(e.page_change)} · ${t("the whole site")} ${pct(e.site_change)}${e.after.position ? ` · ${t("position")} ${UI.dec(e.before.position ?? "—")} → ${UI.dec(e.after.position)}` : ""}</p>
      <p class="small muted">${t("From Search Console. Timing only: this does not prove the link caused the change.")}</p>`;
  }

  async function toggleDisavow(button) {
    const id = Number(button.dataset.vdDisavow), on = !button.dataset.on;
    button.disabled = true;
    try { await COMP.api("POST", `backlinks/${id}/disavow`, { disavow: on }); } catch (err) { UI.toast(t(err.message), { kind: "crit" }); button.disabled = false; return; }
    [...(window.BACKLINKS || []), ...(window.FOUND_LINKS || [])].forEach((b) => { if (b.serverId === id) b.disavow = on; });
    UI.toast(t(on ? "Marked as spam" : "No longer marked as spam"), { kind: "info" });
    UI.closePanel?.({ keep: false });
    UI.render();
  }

  // ---- Found but never logged ------------------------------------------------------------------------
  function foundTools(siteHost) {
    const server = H.server?.();
    const marked = [...(window.BACKLINKS || []), ...(window.FOUND_LINKS || [])].filter((b) => b.disavow && (!siteHost || b.site === siteHost)).length;
    const id = siteIdOf(siteHost);
    const disavow = server && marked
      ? (id ? `<a class="btn btn-small" href="api/backlinks/disavow.txt?site_id=${id}" download data-tip="${esc(t("Google says most sites never need one. Upload it in Search Console only for spam links you can't get removed."))}">${UI.icon("download")}${t("Download disavow file")} <span class="muted">${UI.num(marked)}</span></a>` : `<span class="small sec">${t("Pick a site to download its disavow file.")}</span>`)
      : "";
    return `<button class="btn btn-small" id="gsc-open">${UI.icon("search")}${t("Import from Search Console")}</button>${disavow}`;
  }

  function foundButton(f) {
    if (!H.server?.() || !f.serverId) return "";
    return ` <button class="icon-btn" style="width:28px;height:28px;vertical-align:middle" data-vd-disavow="${f.serverId}" data-on="${f.disavow ? "1" : ""}" aria-label="${esc(t(f.disavow ? "Not spam" : "Mark as spam"))}" data-tip="${esc(t(f.disavow ? "Not spam" : "Mark as spam"))}">${UI.icon(f.disavow ? "check" : "ban")}</button>`;
  }

  function foundSeen(f) {
    return `${esc(f.seen)}${f.crawled ? ` <span class="second">${t("last crawled")} ${esc(f.crawled)}</span>` : ` <span class="second">${t("first seen")} ${esc(f.first)}</span>`}`;
  }

  // ---- Search Console upload ---------------------------------------------------------------------------
  function openGsc(opener) {
    const sites = H.server?.() ? H.sites() : (window.SITES || []).map((s) => ({ id: s.id, host: s.host }));
    const host = pickedHost();
    const dlg = UI.$("#dlg");
    dlg.classList.remove("wide");
    UI.setHTML(dlg, `<div class="dlg-head"><h2 id="dlg-title">${t("Import from Search Console")}</h2><button class="icon-btn" data-close-dlg aria-label="${t("Close")}">${UI.icon("x")}</button></div>
      <div class="dlg-body">
        <p class="note">${UI.icon("info")}<span>${t("Search Console doesn't share its links with other apps, so download them once and upload the file here. About a minute per site.")}</span></p>
        <ol class="gsc-steps">
          <li>${t("In Search Console, open Links in the menu on the left.")}</li>
          <li>${t("Click Export external links at the top right, choose Latest links, then Download CSV.")}</li>
          <li>${t("Upload that file here. Top linking sites and Top linked pages exports work too.")}</li>
        </ol>
        <label class="field"><span>${t("Our site")}</span><select class="select" id="gsc-site" style="width:100%">${sites.map((s) => `<option value="${esc(s.id)}" ${s.host === host ? "selected" : ""}>${esc(s.host)}</option>`).join("")}</select></label>
        <label class="field"><span>${t("File")}</span><input class="input" type="file" id="gsc-file" accept=".csv,.zip,text/csv,application/zip"></label>
        <div id="gsc-result" role="status"></div>
      </div>
      <div class="dlg-foot"><button class="btn btn-main" id="gsc-send">${UI.icon("list-plus")}${t("Upload")}</button><button class="btn" data-close-dlg>${t("Cancel")}</button></div>`);
    if (!dlg.open) dlg.showModal();
    UI.$("#gsc-file")?.focus();
    S.opener = opener;
  }

  async function sendGsc(button) {
    const file = UI.$("#gsc-file")?.files?.[0], box = UI.$("#gsc-result");
    if (!file) { UI.setHTML(box, `<div class="error" role="alert">${UI.icon("octagon-alert")}<span>${t("Choose the file Search Console downloaded.")}</span></div>`); return; }
    if (!H.server?.()) { UI.setHTML(box, `<p class="note">${UI.icon("info")}<span>${t("Needs the running app")}</span></p>`); return; }
    const form = new FormData();
    form.append("file", file);
    form.append("site_id", UI.$("#gsc-site").value);
    button.disabled = true;
    UI.setHTML(button, `${UI.icon("refresh-cw", "spin")}${t("Uploading…")}`);
    try {
      const a = await COMP.api("POST", "backlinks/gsc-import", undefined, { form });
      const lines = [];
      if (a.kinds.includes("latest")) lines.push(`${UI.num(a.added)} ${t("new links in Found but never logged")}`, `${UI.num(a.seen)} ${t("logged links Google sees")}`);
      if (a.kinds.includes("sites")) lines.push(`${UI.num(a.domains)} ${t("linking websites")}`);
      if (a.kinds.includes("pages")) lines.push(`${UI.num(a.pages)} ${t("of your pages with links. Each is read once a month for Reclaim.")}`);
      if (a.skipped) lines.push(`${UI.num(a.skipped)} ${t("rows skipped: your own pages or the same page twice")}`);
      UI.setHTML(box, `<div class="note good">${UI.icon("circle-check")}<span>${lines.map(esc).join("<br>")}</span></div>`);
      S.reclaim.clear();
      await H.reload?.();
    } catch (err) {
      UI.setHTML(box, `<div class="error" role="alert">${UI.icon("octagon-alert")}<span>${esc(t(err.message))}</span></div>`);
    }
    button.disabled = false;
    UI.setHTML(button, `${UI.icon("list-plus")}${t("Upload another file")}`);
  }

  // ---- Reclaim -------------------------------------------------------------------------------------------
  function reclaimFor(host) {
    const id = siteIdOf(host);
    if (!id) return [];
    const got = S.reclaim.get(id);
    if (got === undefined) {
      S.reclaim.set(id, null);
      COMP.api("GET", `backlinks/reclaim?site_id=${id}`).then((r) => { S.reclaim.set(id, r.pages.map((p) => ({ ...p, site: host }))); if (UI.state.route === "backlinks") UI.render(); }).catch(() => S.reclaim.set(id, []));
      return [];
    }
    return got || [];
  }

  function reclaimPages() {
    if (!H.server?.()) return [];
    const host = pickedHost();
    return host ? reclaimFor(host) : (H.sites() || []).flatMap((s) => reclaimFor(s.host));
  }
  const reclaimCount = () => reclaimPages().length;

  function reclaimBody() {
    const list = reclaimPages();
    if (!list.length) return COMP.empty(t("Nothing to reclaim"), t("Pages of yours that are gone but still have links show here."));
    return `<p class="note">${UI.icon("info")}<span>${t("Other websites link to these pages of yours, but the pages are gone. Redirect each one to the closest live page and the links count again.")}</span></p>
      <div class="table-wrap"><table class="data" id="rc-table"><thead><tr><th scope="col">${t("Your page")}</th><th scope="col">${t("Answers")}</th><th scope="col" class="r">${t("Websites linking")}</th><th scope="col"><span class="sr">${t("Action")}</span></th></tr></thead><tbody>
      ${list.map((p) => `<tr style="cursor:default"><td class="head-cell mono small url-cell" data-tip="${esc(p.page)}"><span dir="auto">${esc(p.path)}</span>${UI.state.site === "all" ? `<span class="second">${t("For")} ${esc(p.site)}</span>` : ""}${p.domains.length ? `<span class="second">${esc(p.domains.slice(0, 3).join(", "))}${p.domains.length > 3 ? "…" : ""}</span>` : ""}</td>
        <td data-label="${t("Answers")}">${UI.status("serious", String(p.http))}</td>
        <td class="r" data-label="${t("Websites linking")}">${UI.num(p.sites || p.logged_links)}${p.gsc_links ? `<span class="second">${UI.num(p.gsc_links)} ${t("links")}</span>` : ""}</td>
        <td class="r nowrap">${window.UI.taskButton({ title: `${t("Redirect")} ${p.path} ${t("to a live page")}`, host: p.site, source: { type: "backlink", label: p.path, host: p.site, facts: [`${p.http}`, `${p.sites || p.logged_links} ${t("websites linking")}`], link: "#backlinks", key: `reclaim|${p.site}|${p.path}` } }, { label: "Task" })}${p.gsc_id ? ` <button class="btn btn-small" data-rc-dismiss="${p.gsc_id}">${t("Dismiss")}</button>` : ""}</td></tr>`).join("")}
      </tbody></table></div>`;
  }

  async function dismissReclaim(button) {
    button.disabled = true;
    try { await COMP.api("POST", `backlinks/reclaim/${button.dataset.rcDismiss}/dismiss`, {}); } catch (err) { UI.toast(t(err.message), { kind: "crit" }); button.disabled = false; return; }
    S.reclaim.clear();
    UI.render();
  }

  // ---- budget, in the Mediators tab ------------------------------------------------------------------------
  function budgetBar(all) {
    if (!H.server?.()) return "";
    const host = pickedHost(), id = siteIdOf(host);
    if (!id) return `<span class="small sec">${t("Pick a site to set its monthly budget.")}</span>`;
    const got = S.budgets.get(id);
    if (got === undefined) {
      S.budgets.set(id, null);
      COMP.api("GET", `backlinks/budget?site_id=${id}`).then((r) => { S.budgets.set(id, r.budget || false); if (UI.state.route === "backlinks") UI.render(); }).catch(() => S.budgets.set(id, false));
      return "";
    }
    const edit = `<button class="btn btn-small" data-vd-budget="${id}">${UI.icon("pencil")}${t(got ? "Budget" : "Set a monthly budget")}</button>`;
    if (!got) return edit;
    const month = new Date().toISOString().slice(0, 7);
    const mine = all.filter((b) => b.site === host && b.status !== "planned" && b.cost && H.currencyOf(b) === got.currency);
    const spent = mine.filter((b) => (/^\d{4}-\d{2}/.test(b.placed || "") ? b.placed.slice(0, 7) : (b.createdAt || "").slice(0, 7)) === month).reduce((s, b) => s + b.cost, 0);
    const counting = new Set(all.filter((b) => b.site === host && b.check?.verdict === "counts").map((b) => b.domain)).size;
    const total = mine.reduce((s, b) => s + b.cost, 0);
    const over = spent > got.amount;
    return `<span class="small ${over ? "serious" : "sec"}">${t("This month")}: <b class="tabular">${H.money(got.currency, UI.num(Math.round(spent)))}</b> ${t("of")} ${H.money(got.currency, UI.num(got.amount))}${counting && total ? ` · ${t("per website that counts")}: ${H.money(got.currency, UI.num(Math.round(total / counting)))}` : ""}</span>${edit}`;
  }

  function openBudget(button) {
    const id = Number(button.dataset.vdBudget), got = S.budgets.get(id) || {};
    UI.openPanel(`${UI.panelHead(t("Monthly budget"), t("For buying links on this site, in one currency"))}
      <form class="panel-body" id="vd-budget-form" data-id="${id}" novalidate>
        <div class="field-row"><label class="field"><span>${t("Amount")}</span><input class="input tabular" id="vd-amount" type="number" min="0" step="1" value="${esc(got.amount ?? "")}" data-autofocus></label>
        <label class="field"><span>${t("Currency")}</span><select class="select" id="vd-currency" style="width:100%">${CURRENCIES.map((c) => `<option ${c === (got.currency || "USD") ? "selected" : ""}>${c}</option>`).join("")}</select></label></div>
        <p class="help">${t("Leave the amount empty to remove the budget. Only prices in this currency are added up.")}</p><div id="vd-budget-err"></div>
      </form>
      <div class="panel-foot"><button class="btn btn-main" id="vd-budget-save">${t("Save")}</button><button class="btn" data-discard-panel>${t("Cancel")}</button></div>`, button, { key: `budget|${id}` });
  }

  async function saveBudget(button) {
    const form = UI.$("#vd-budget-form"), id = Number(form.dataset.id);
    button.disabled = true;
    try {
      const r = await COMP.api("PUT", "backlinks/budget", { site_id: id, amount: UI.$("#vd-amount").value.trim(), currency: UI.$("#vd-currency").value });
      S.budgets.set(id, r.budget || false);
    } catch (err) {
      UI.setHTML(UI.$("#vd-budget-err"), `<div class="error" role="alert">${UI.icon("octagon-alert")}<span>${esc(t(err.message))}</span></div>`);
      button.disabled = false;
      return;
    }
    UI.closePanel({ keep: false });
    UI.render();
  }

  // ---- Add backlink: the same website twice ------------------------------------------------------------------
  function duplicateNote() {
    const input = UI.$("#bl-src"), site = UI.$("#bl-site")?.value;
    if (!input || !site) return;
    let box = UI.$("#bl-dup");
    if (!box) { box = document.createElement("div"); box.id = "bl-dup"; box.setAttribute("role", "status"); input.closest(".field")?.after(box); }
    const domain = window.BacklinkCleaner.rootDomain(input.value.trim());
    const editing = UI.$("#bl-form")?.dataset.edit || "";
    const same = domain ? (window.BACKLINKS || []).filter((b) => b.site === site && b.domain === domain && String(b.id) !== editing && b.status !== "planned").length : 0;
    languageNote(input.value.trim(), domain, site);
    UI.setHTML(box, same ? `<p class="note warn">${UI.icon("copy")}<span>${t("This website already links to {site}: {n}. Another link from the same website usually adds much less than a link from a new one.").replace("{site}", esc(site)).replace("{n}", same === 1 ? t("1 link") : `${UI.num(same)} ${t("links")}`)}</span></p>` : "");
  }

  // ---- Add backlink: a page in another language ------------------------------------------------------------
  const LANGS = new Set("en fr de es it nl pt pl ru ja zh ar sv da no nb fi cs el tr ro hu ko he uk id th vi".split(" "));
  // Country endings that mostly mean one language. Endings used by everyone (.co, .io, .me, .tv) or by several languages (.be, .ch, .ca, .ma, .ae) aren't guessed from.
  const TLD_LANG = { fr: "fr", de: "de", at: "de", es: "es", mx: "es", cl: "es", it: "it", nl: "nl", pt: "pt", br: "pt", pl: "pl", ru: "ru", jp: "ja", cn: "zh", se: "sv", dk: "da", no: "no", fi: "fi", cz: "cs", gr: "el", tr: "tr", ro: "ro", hu: "hu", kr: "ko", il: "he", ua: "uk", uk: "en", au: "en", nz: "en", ie: "en", sa: "ar", eg: "ar" };
  const sameLang = (a, b) => a === b || (["no", "nb"].includes(a) && ["no", "nb"].includes(b));

  function siteLang(host) {
    const known = S.sites.get(host)?.lang;
    if (known) return known;
    const counts = {};
    (window.BACKLINKS || []).forEach((b) => { const l = (b.site === host && b.check?.target_lang || "").slice(0, 2); if (l) counts[l] = (counts[l] || 0) + 1; });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;
  }

  /* The linking page's language, before anything is read: an earlier check of that website, else what the address says. */
  function guessLang(address, domain) {
    const earlier = (window.BACKLINKS || []).find((b) => b.domain === domain && b.check?.page_lang);
    if (earlier) return { lang: earlier.check.page_lang.slice(0, 2), why: t("read on an earlier check of this website") };
    let u;
    try { u = new URL(address); } catch { return null; }
    const first = u.pathname.split("/").filter(Boolean)[0] || "";
    const m = first.match(/^([a-z]{2})(?:[-_][a-z]{2})?$/i);
    if (m && LANGS.has(m[1].toLowerCase())) return { lang: m[1].toLowerCase(), why: t("from {x} in the address").replace("{x}", `/${first}/`) };
    const labels = u.hostname.toLowerCase().split(".");
    if (labels.length > 2 && LANGS.has(labels[0])) return { lang: labels[0], why: t("from {x} in the address").replace("{x}", `${labels[0]}.`) };
    const tld = labels[labels.length - 1];
    if (TLD_LANG[tld]) return { lang: TLD_LANG[tld], why: t("from {x} in the address").replace("{x}", `.${tld}`) };
    return null;
  }

  function languageNote(address, domain, site) {
    const input = UI.$("#bl-src");
    let box = UI.$("#bl-lang");
    if (!box) { box = document.createElement("div"); box.id = "bl-lang"; box.setAttribute("role", "status"); (UI.$("#bl-dup") || input?.closest(".field"))?.after(box); }
    const mine = siteLang(site), theirs = domain ? guessLang(address, domain) : null;
    const differs = mine && theirs && !sameLang(theirs.lang, mine);
    UI.setHTML(box, differs ? `<p class="note">${UI.icon("info")}<span>${t("This page looks to be in {a} ({why}), and {site} is in {b}. A link from another language still counts, but one from a page in the same language usually helps more. The first check reads the page and says for sure.").replace("{a}", esc(theirs.lang.toUpperCase())).replace("{why}", esc(theirs.why)).replace("{site}", esc(site)).replace("{b}", esc(mine.toUpperCase()))}</span></p>` : "");
  }

  // ---- the plain-file sample -------------------------------------------------------------------------------
  function sample() {
    const set = (id, check, extra = {}) => { const b = (window.BACKLINKS || []).find((x) => x.id === id); if (b && !b.check) Object.assign(b, { check, ...extra }); };
    const b1 = (window.BACKLINKS || []).find((x) => x.id === "b1"), b2 = (window.BACKLINKS || []).find((x) => x.id === "b2");
    const page = (b, path) => `https://${b?.site || "example.com"}${b?.target || path}`;
    set("b1", { verdict: "counts", reasons: [], page_lang: "fr", target_lang: "fr" }, { gsc: { seen: "page", crawled: "2026-10-28" }, targetIndex: { state: "indexed", url: page(b1, "/"), crawled: "2026-10-27", checked: "2026-11-02" } });
    const extra = (id, fields) => { const b = (window.BACKLINKS || []).find((x) => x.id === id); if (b && !b.anchorType) Object.assign(b, fields); };
    extra("b1", { anchorType: "exact", sourceIndex: { state: "indexed", via: "Search Console", at: "2026-10-28" } });
    extra("b2", { anchorType: "brand", sourceIndex: { state: "indexed", via: "SerpApi", at: "2026-11-01" } });
    extra("b5", { anchorType: "partial", sourceIndex: { state: "not_indexed", via: "SerpApi", at: "2026-11-03" }, check: { verdict: "none", reasons: ["source_not_indexed"] } });
    extra("b6", { anchorType: "partial", sourceIndex: { state: "not_found", via: "HasData", at: "2026-11-04" } });
    set("b2", { verdict: "weak", reasons: ["nofollow"], is_nofollow: true }, { gsc: { seen: "site" }, targetIndex: { state: "not_indexed", url: page(b2, "/"), coverage: "Crawled - currently not indexed", crawled: "2026-10-12", checked: "2026-11-02" } });
  }

  function bind() {
    document.addEventListener("click", (e) => {
      const hit = (sel) => e.target.closest?.(sel);
      let el;
      if ((el = hit("#gsc-open"))) { openGsc(el); return; }
      if ((el = hit("#gsc-send"))) { sendGsc(el); return; }
      if ((el = hit("[data-vd-disavow]"))) { e.stopPropagation(); toggleDisavow(el); return; }
      if ((el = hit("[data-rc-dismiss]"))) { dismissReclaim(el); return; }
      if ((el = hit("[data-vd-budget]"))) { openBudget(el); return; }
      if ((el = hit("#vd-budget-save"))) { saveBudget(el); return; }
      if ((el = hit("[data-vd-view]"))) { S.view = el.dataset.vdView; UI.render(); UI.$(`[data-vd-view="${S.view}"]`)?.focus(); return; }
      if ((el = hit("[data-vd-domain]"))) { e.stopPropagation(); S.domain = el.dataset.vdDomain; S.view = "page"; UI.render(); return; }
    }, true);
    document.addEventListener("input", (e) => { if (e.target.id === "bl-src") duplicateNote(); });
    document.addEventListener("change", (e) => { if (e.target.id === "bl-site") duplicateNote(); });
    document.addEventListener("submit", (e) => { if (e.target.id === "vd-budget-form") { e.preventDefault(); const b = UI.$("#vd-budget-save"); if (b && !b.disabled) saveBudget(b); } });
    window.addEventListener("seocc:backlinks-changed", () => S.reclaim.clear());
  }

  window.BacklinkSeo = {
    init(ui, helpers) { UI = ui; H = helpers; bind(); sample(); },
    noteSite: (host, facts) => { if (host && facts) S.sites.set(host, facts); },
    filterRows, filterChips, viewSwitch, byWebsite, websiteTable, trafficHead, trafficCell, anchorTag,
    badge, liveNote, authorityCell, panelBlocks, spamBlock, foundTools, foundButton, foundSeen, reclaimBody, reclaimCount, budgetBar, duplicateNote,
    forget: () => { S.reclaim.clear(); S.budgets.clear(); S.effects.clear(); },
  };

  const fr = {
    "Counts": "Compte", "Weak": "Faible", "Doesn't count": "Ne compte pas", "Spam": "Spam", "Google sees it": "Vu par Google", "Google sees the site": "Site vu par Google", "Not listed by Google yet": "Pas encore listé par Google",
    "Google can see this page and the link passes value.": "Google peut voir cette page et le lien transmet de la valeur.",
    "Search Console lists this page among your links": "Search Console liste cette page parmi vos liens", "last crawled": "dernière exploration",
    "Search Console lists this website among your links, but not this exact page.": "Search Console liste ce site parmi vos liens, mais pas cette page précise.",
    "Placed more than 60 days before your last Search Console upload, and not in it. Its list is a sample, so this is only a hint.": "Placé plus de 60 jours avant votre dernier import Search Console, et absent de celui-ci. Sa liste n'est qu'un échantillon : ce n'est qu'un indice.",
    "Marked as spam: it's in the disavow file.": "Marqué comme spam : il est dans le fichier de désaveu.",
    "Read on the last check: followed, on a page Google can index.": "Lu au dernier contrôle : suivi, sur une page que Google peut indexer.", "counts for Google": "compte pour Google", "count for Google": "comptent pour Google",
    "Open PageRank, 0 to 10. Not the same scale as DA.": "Open PageRank, de 0 à 10. Pas la même échelle que le DA.",
    "The page is set to noindex, so Google drops the page and the link with it.": "La page est en noindex : Google l'écarte, et le lien avec.",
    "The site's robots.txt stops Google from reading the page.": "Le robots.txt du site empêche Google de lire la page.",
    "The page tells Google not to follow any of its links.": "La page demande à Google de ne suivre aucun de ses liens.",
    "Marked nofollow: Google takes it as a hint and usually passes no ranking value.": "Marqué nofollow : Google le prend comme une indication et ne transmet en général aucune valeur de classement.",
    "Marked sponsored: right for a paid link, but it passes little or no ranking value.": "Marqué sponsored : normal pour un lien payé, mais il transmet peu ou pas de valeur de classement.",
    "Marked ugc (user content): it passes little or no ranking value.": "Marqué ugc (contenu d'utilisateurs) : il transmet peu ou pas de valeur de classement.",
    "The page names another page as its main version, so Google may count that one instead.": "La page désigne une autre page comme version principale : Google peut compter celle-là à la place.",
    "The page links to more than 100 other websites, which looks like a link list.": "La page pointe vers plus de 100 autres sites, ce qui ressemble à une liste de liens.",
    "Does Google count it?": "Google le compte-t-il ?",
    "The linking page is in {a} and your page is in {b}. Links from pages in the same language and on the same topic usually help more.": "La page qui fait le lien est en {a} et votre page en {b}. Les liens venant de pages de même langue et de même sujet aident en général davantage.",
    "Your target page answers {n}, so this link is wasted until the page redirects to a live one.": "Votre page cible répond {n} : ce lien est perdu tant qu'elle ne redirige pas vers une page en ligne.",
    "Not in your last Search Console upload.": "Absent de votre dernier import Search Console.",
    "This page looks like spam: it has many outbound links or a high spam score.": "Cette page ressemble à du spam : beaucoup de liens sortants ou un score de spam élevé.",
    "Mark a link you can't get removed and that could look paid or spammy. It goes in the disavow file.": "Marquez un lien que vous ne pouvez pas faire retirer et qui pourrait passer pour payé ou spam. Il ira dans le fichier de désaveu.",
    "Mark as spam": "Marquer comme spam", "Not spam": "Pas du spam", "Marked as spam": "Marqué comme spam", "No longer marked as spam": "N'est plus marqué comme spam",
    "Before and after": "Avant et après", "Correlation, not proof": "Corrélation, pas preuve", "Clicks to the target page": "Clics vers la page cible", "before": "avant", "after": "après", "This page": "Cette page", "the whole site": "tout le site", "position": "position",
    "From Search Console. Timing only: this does not prove the link caused the change.": "Depuis Search Console. Simple coïncidence de dates : cela ne prouve pas que le lien a causé le changement.",
    "It needs a target page and a date placed.": "Il faut une page cible et une date de mise en ligne.", "The date placed isn't written as YYYY-MM-DD, so it can't be compared.": "La date de mise en ligne n'est pas au format AAAA-MM-JJ : la comparaison est impossible.",
    "Google says most sites never need one. Upload it in Search Console only for spam links you can't get removed.": "Google indique que la plupart des sites n'en ont jamais besoin. Importez-le dans Search Console seulement pour des liens spam impossibles à faire retirer.",
    "Download disavow file": "Télécharger le fichier de désaveu", "Pick a site to download its disavow file.": "Choisissez un site pour télécharger son fichier de désaveu.",
    "Import from Search Console": "Importer depuis Search Console",
    "Search Console doesn't share its links with other apps, so download them once and upload the file here. About a minute per site.": "Search Console ne partage pas ses liens avec d'autres applications : téléchargez-les une fois et importez le fichier ici. Environ une minute par site.",
    "In Search Console, open Links in the menu on the left.": "Dans Search Console, ouvrez Liens dans le menu de gauche.",
    "Click Export external links at the top right, choose Latest links, then Download CSV.": "Cliquez sur Exporter les liens externes en haut à droite, choisissez Derniers liens, puis Télécharger au format CSV.",
    "Upload that file here. Top linking sites and Top linked pages exports work too.": "Importez ce fichier ici. Les exports Principaux sites de liens et Pages les plus liées fonctionnent aussi.",
    "Choose the file Search Console downloaded.": "Choisissez le fichier téléchargé depuis Search Console.", "Needs the running app": "Nécessite l'application en marche", "Uploading…": "Import en cours…", "Upload": "Importer", "Upload another file": "Importer un autre fichier",
    "new links in Found but never logged": "nouveaux liens dans Trouvés mais jamais saisis", "logged links Google sees": "liens saisis vus par Google", "linking websites": "sites qui font des liens",
    "of your pages with links. Each is read once a month for Reclaim.": "de vos pages ont des liens. Chacune est lue une fois par mois pour À récupérer.", "rows skipped: your own pages or the same page twice": "lignes ignorées : vos propres pages, ou la même page deux fois",
    "That doesn't look like a Search Console Links export. In Search Console open Links, then Export external links, and choose Latest links.": "Ce n'est pas un export Liens de Search Console. Dans Search Console, ouvrez Liens, puis Exporter les liens externes, et choisissez Derniers liens.",
    "Download it from Search Console as CSV, not Excel.": "Téléchargez-le depuis Search Console au format CSV, pas Excel.", "That .zip file has no .csv inside.": "Ce fichier .zip ne contient aucun .csv.", "That .zip file can't be opened.": "Ce fichier .zip ne peut pas être ouvert.",
    "That file is too large. A Search Console export is well under 10 MB.": "Ce fichier est trop volumineux. Un export Search Console fait bien moins de 10 Mo.",
    "Reclaim": "À récupérer", "Nothing to reclaim": "Rien à récupérer", "Pages of yours that are gone but still have links show here.": "Vos pages disparues qui ont encore des liens apparaissent ici.",
    "Other websites link to these pages of yours, but the pages are gone. Redirect each one to the closest live page and the links count again.": "D'autres sites pointent vers ces pages, mais elles n'existent plus. Redirigez chacune vers la page en ligne la plus proche et les liens comptent à nouveau.",
    "Your page": "Votre page", "Answers": "Répond", "Websites linking": "Sites qui font un lien", "websites linking": "sites qui font un lien", "links": "liens", "1 link": "1 lien", "Redirect": "Rediriger", "to a live page": "vers une page en ligne", "Dismiss": "Écarter", "That page isn't in the list.": "Cette page n'est pas dans la liste.",
    "Pick a site to set its monthly budget.": "Choisissez un site pour fixer son budget mensuel.", "Budget": "Budget", "Set a monthly budget": "Fixer un budget mensuel", "This month": "Ce mois-ci", "of": "sur", "per website that counts": "par site qui compte",
    "Monthly budget": "Budget mensuel", "For buying links on this site, in one currency": "Pour l'achat de liens sur ce site, dans une seule devise", "Amount": "Montant", "Currency": "Devise",
    "Leave the amount empty to remove the budget. Only prices in this currency are added up.": "Laissez le montant vide pour supprimer le budget. Seuls les prix dans cette devise sont additionnés.",
    "The budget must be a number.": "Le budget doit être un nombre.", "Choose one of USD, EUR, AED, GBP.": "Choisissez USD, EUR, AED ou GBP.",
    "This website already links to {site}: {n}. Another link from the same website usually adds much less than a link from a new one.": "Ce site pointe déjà vers {site} : {n}. Un lien de plus depuis le même site apporte en général bien moins qu'un lien d'un nouveau site.",
    "Say whether to mark this link as spam.": "Indiquez si ce lien doit être marqué comme spam.",
    "Is your page in Google?": "Votre page est-elle dans Google ?", "Indexed": "Indexée", "Not indexed": "Non indexée", "Unknown to Google": "Inconnue de Google", "Your page isn't indexed": "Votre page n'est pas indexée",
    "Google hasn't indexed this page, so the link can't help it rank yet.": "Google n'a pas indexé cette page : le lien ne peut pas encore l'aider à se classer.", "Google says:": "Google indique :",
    "Google doesn't know this page yet, so the link can't help it rank. Add it to your sitemap or ask for indexing in Search Console.": "Google ne connaît pas encore cette page : le lien ne peut pas l'aider à se classer. Ajoutez-la à votre sitemap ou demandez son indexation dans Search Console.",
    "Google treats another page as the main version:": "Google considère une autre page comme version principale :", "Get indexed:": "Faire indexer :",
    "From Search Console's URL Inspection": "Depuis l'inspection d'URL de Search Console",
    "Connect Search Console for this site and Google is asked whether your target page is indexed.": "Connectez Search Console pour ce site, et Google sera interrogé pour savoir si votre page cible est indexée.", "Data sources": "Sources de données",
    "Google is asked on the next check. Press Check now to ask today.": "Google sera interrogé au prochain contrôle. Cliquez sur Vérifier pour le faire aujourd'hui.",
    "This page isn't in the site's Search Console property, so Google won't inspect it.": "Cette page n'est pas dans la propriété Search Console du site : Google ne l'inspectera pas.",
    "This page looks to be in {a} ({why}), and {site} is in {b}. A link from another language still counts, but one from a page in the same language usually helps more. The first check reads the page and says for sure.": "Cette page semble être en {a} ({why}), et {site} est en {b}. Un lien depuis une autre langue compte quand même, mais un lien depuis une page de même langue aide en général davantage. Le premier contrôle lit la page et le confirme.",
    "Google doesn't have the linking page: two site: searches in a row didn't find it. A page Google doesn't have passes nothing.": "Google n'a pas la page qui fait le lien : deux recherches site: de suite ne l'ont pas trouvée. Une page absente de Google ne transmet rien.",
    "Linking page not indexed": "Page source non indexée", "Search Console lists the link": "Search Console liste le lien", "a site: search on {tool}": "une recherche site: sur {tool}",
    "Whether Google has the linking page is searched on the next check.": "Le prochain contrôle cherchera si Google a la page qui fait le lien.",
    "Connect a rankings search tool, such as SerpApi, to check whether Google has the linking page. Only free searches are used.": "Connectez un outil de recherche des positions, comme SerpApi, pour vérifier si Google a la page qui fait le lien. Seules les recherches gratuites sont utilisées.",
    "The linking page is on Google": "La page qui fait le lien est dans Google",
    "Not found on Google yet: a site: search didn't show the linking page. Search results are incomplete, so it's searched again in a few days, and only a second miss marks it not indexed.": "Pas encore trouvée dans Google : une recherche site: n'a pas montré la page qui fait le lien. Les résultats sont incomplets : elle est recherchée à nouveau dans quelques jours, et seul un second échec la marque comme non indexée.",
    "Google doesn't have the linking page: two site: searches in a row didn't find it. Ask the website to get it indexed, or the link passes nothing.": "Google n'a pas la page qui fait le lien : deux recherches site: de suite ne l'ont pas trouvée. Demandez au site de la faire indexer, sinon le lien ne transmet rien.",
    "Useful": "Liens utiles", "Sends visits": "Envoient des visites", "Not useful": "Liens non utiles", "Website": "Site", "Show": "Afficher", "By page": "Par page", "By website": "Par site",
    "Live, followed, on a page Google can index": "En ligne, suivi, sur une page que Google peut indexer", "Brought at least one visit": "A apporté au moins une visite",
    "Google doesn't have the page the link is on, or can't index it": "Google n'a pas la page qui porte le lien, ou ne peut pas l'indexer", "Nofollow, sponsored, or on a page that passes nothing": "Nofollow, sponsored, ou sur une page qui ne transmet rien",
    "Site traffic": "Trafic du site", "Ahrefs' estimate of the linking website's monthly visits from Google": "Estimation Ahrefs des visites mensuelles venant de Google sur le site qui fait le lien",
    "Brand": "Marque", "Bare URL": "URL nue", "Exact keyword": "Mot-clé exact", "Partial keyword": "Mot-clé partiel", "Generic": "Générique",
    "Your brand or domain name. The safest kind of anchor.": "Votre marque ou votre nom de domaine. Le type d'ancre le plus sûr.",
    "The address itself, such as www.example.com. Safe and natural.": "L'adresse elle-même, comme www.example.com. Sûr et naturel.",
    "Exactly one of your tracked keywords. Helps the most, but too many look bought.": "Exactement un de vos mots-clés suivis. Aide le plus, mais en excès cela paraît acheté.",
    "Holds one of your tracked keywords among other words.": "Contient un de vos mots-clés suivis parmi d'autres mots.",
    "Words like click here or read more. Natural, but tell Google little.": "Des mots comme cliquez ici ou en savoir plus. Naturel, mais cela dit peu de choses à Google.",
    "No links match": "Aucun lien ne correspond", "Pick another filter.": "Choisissez un autre filtre.", "Links": "Liens", "live": "en ligne", "Best link": "Meilleur lien", "The best of this website's links, as the last check read it": "Le meilleur des liens de ce site, d'après le dernier contrôle", "Show this website's links": "Voir les liens de ce site",
    "Monthly Google traffic of each website that links to you": "Trafic Google mensuel de chaque site qui pointe vers vous", "Paid": "Payant", "About 50 API units per website a month": "Environ 50 unités d'API par site et par mois",
    "Off until you paste a key. The Site traffic column on Backlinks only shows while it's connected. At most 200 websites a month, about 10,000 units.": "Désactivé tant que vous ne collez pas de clé. La colonne Trafic du site des Backlinks n'apparaît que lorsqu'il est connecté. Au plus 200 sites par mois, environ 10 000 unités.",
    "Check your plan": "Vérifiez votre forfait", "The Ahrefs API needs a plan with API units. Your plan page says how many you have.": "L'API Ahrefs nécessite un forfait avec des unités d'API. La page de votre forfait indique combien vous en avez.", "Open your limits": "Ouvrir vos limites",
    "Create a key": "Créer une clé", "Open API keys in your Ahrefs account, press Create API key, and copy it.": "Ouvrez Clés API dans votre compte Ahrefs, cliquez sur Créer une clé API, puis copiez-la.", "Open API keys": "Ouvrir les clés API",
    "Paste it in the API key box above and press Save. Test uses ahrefs.com, which Ahrefs never charges units for.": "Collez-la dans le champ Clé API ci-dessus et cliquez sur Enregistrer. Le test utilise ahrefs.com, pour lequel Ahrefs ne facture jamais d'unités.",
    "Your Ahrefs plan's units, every month": "Les unités de votre forfait Ahrefs, chaque mois",
    "read on an earlier check of this website": "lu lors d'un contrôle précédent de ce site", "from {x} in the address": "d'après {x} dans l'adresse",
  };
  Object.keys(fr).forEach((word) => { if (window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
