/* Site map (2026-11-20, the owner's request): one website's pages drawn as a mind map, for my sites (the Site map screen
   in the side menu) and for a competitor (the Site map tab of its profile).

   The home page sits in the middle and its branches go left and right. A switch picks how pages are grouped:
     By folders   the folders of the address, then the pages inside. Ready for any site the page reader has read.
     By category  each page under the category it says it belongs to (breadcrumb, then category links), so flat
                  WordPress addresses (/post-name/) still land under their category. Marks articles their category
                  page doesn't link to.
     By links     the pages the home page links to, then the pages those link to. Needs each page's links, which the
                  reader saves as it passes: until then the map says how many pages are still to read.
   A click on a box opens the side panel: what the reader saw, the pages it links to and from, and its comments, which
   are the app's own notes (a page note, or a group note for a folder), so they show in Pages and Notes too.
   The round button at a box's edge opens and closes its branch. Drag to move, pinch or Ctrl + wheel to zoom.

   Server: GET /api/site-map?site_id= | competitor_id= &view=folders|category|links|inlinks, GET /api/site-map/page (seo/pages/sitemap_tree.py).
   Anything put on the page with [data-sm-root] is drawn by itself (an observer below), so a screen only returns
   SiteMap.block({ siteId | competitorId, host }). The read-only map: nothing here changes the website's data. */
(() => {
  "use strict";
  const ICONS = window.ICONS || {};
  const add = (name, path) => { if (!ICONS[name]) ICONS[name] = path; };
  add("network", '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>');
  add("house", '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>');
  add("maximize", '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>');
  add("folder", '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>');

  const UI = () => window.UI;
  const t = (s) => UI().t(s);
  const esc = (s) => UI().esc(s);
  const icon = (name, cls) => UI().icon(name, cls);
  const num = (n) => UI().num(n);
  const fill = (text, values = {}) => t(text).replace(/\{(\w+)\}/g, (_, key) => (values[key] ?? ""));
  const api = (path) => window.COMP.api("GET", path);

  const ROW = 40, BOX_H = 30, GAP_X = 58, PAD = 48, MAX_W = 230, FIRST = 12, STEP = 24;
  const ZOOM_MIN = 0.3, ZOOM_MAX = 1.6;
  const HUES = 8; // branch colours in site-map.css (.sm-b0 … .sm-b7)
  const VIEWS = [["folders", "By folders"], ["category", "By category"], ["links", "By links"], ["inlinks", "Internal links"]];
  // One line each, on hover: what the grouping answers (owner, 2026-11-24: "I don't understand the view with links").
  const VIEW_TIPS = {
    folders: "Grouped by the folders in each page's address",
    category: "Each page under the category it says it belongs to",
    links: "How many clicks each page is from the home page",
    inlinks: "How many of your pages link to each page",
  };
  const pendingView = new Map(); // key -> the view an address asked for (#map?view=links), for a map not drawn yet
  const maps = new Map(); // key ("site:3", "competitor:7") -> its state, kept while the app is open so a redraw changes nothing

  function stateFor(root) {
    const who = root.dataset.smCompetitor ? "competitor" : "site";
    const id = Number(root.dataset.smCompetitor || root.dataset.smSite);
    const key = `${who}:${id}`;
    if (!maps.has(key)) {
      maps.set(key, { key, who, id, host: root.dataset.smHost || "", view: "folders", data: {}, failed: {}, loading: {}, trees: {}, open: { folders: null, category: null, links: null, inlinks: null }, more: new Map(), z: 1, tx: 0, ty: 0, placed: false, q: "", hit: 0, cur: 0, spots: new Map() });
    }
    const S = maps.get(key);
    if (pendingView.has(key)) { S.view = pendingView.get(key); pendingView.delete(key); }
    S.root = root;
    return S;
  }
  const ask = (S) => `${S.who === "competitor" ? "competitor_id" : "site_id"}=${S.id}`;

  // ---- loading -----------------------------------------------------------------------------------
  async function load(S, view, { quiet = false } = {}) {
    if (S.loading[view]) return;
    S.loading[view] = true;
    if (!quiet) S.failed[view] = "";
    try {
      const data = await api(`site-map?${ask(S)}&view=${view}`);
      S.data[view] = data;
      S.trees[view] = treeOf(data.boxes);
      if (!S.open[view]) S.open[view] = firstOpen(S.trees[view]);
      // The screen's head says how many pages the site has, which only this answer knows.
      if (S.who === "site" && !S.counted && UI().state.route === "map" && S.root?.isConnected) { S.counted = true; S.loading[view] = false; UI().render(); return; }
    } catch (err) { if (!quiet) S.failed[view] = err.message || t("That didn't load"); }
    S.loading[view] = false;
    if (S.root?.isConnected && S.view === view) draw(S);
  }

  /* The server's flat list as a tree: each box gets its children, its depth and its parent. */
  function treeOf(boxes) {
    const nodes = boxes.map((b) => ({ ...b, kids: [], up: null, depth: 0, fold: `${b.label} ${b.path}`.toLowerCase() }));
    nodes.forEach((n) => { if (n.parent !== null && nodes[n.parent]) { n.up = nodes[n.parent]; n.depth = n.up.depth + 1; n.up.kids.push(n); } });
    // Each main branch has its own colour, carried by every page under it, so a branch reads as one thing at a glance.
    const root = nodes[0] || null;
    const paint = (n, hue) => { n.hue = hue; n.kids.forEach((kid) => paint(kid, hue)); };
    // A group of loose pages is grey itself (HUES is the grey one), but each page in it takes the next colour in turn
    // (owner, 2026-11-20: "if it doesn't have a folder … keep colours"), carrying on from the branches' colours.
    // A branch that holds most of the site (a language folder like /ar/, or one /blog/) would paint nearly everything
    // one colour (owner, 2026-11-24: "the colors are like each other"). Such a branch stays grey and its own branches
    // take the colours instead, going down while one branch still holds most of the pages.
    const MOST = 0.6;
    const size = (n) => (n.pages || 0) + (n.kind === "page" ? 1 : 0);
    let turn = 0;
    const head = (n, hue) => { paint(n, hue); n.hub = true; };
    const share = (parent) => {
      const total = parent.kids.reduce((sum, kid) => sum + size(kid), 0);
      parent.kids.forEach((kid) => {
        if (kid.kind === "group" && kid.open) { head(kid, kid.hue); return; } // Internal links: the server says each group's colour
        if (kid.kind === "group") { kid.hue = HUES; kid.kids.forEach((page) => paint(page, turn++ % HUES)); return; }
        const big = parent.kids.length > 0 && kid.kids.length >= 2 && total >= 10 && size(kid) >= MOST * total;
        if (big) { kid.hue = HUES; share(kid); return; }
        if (parent !== root && !kid.kids.length) { paint(kid, turn++ % HUES); return; } // a loose page inside a big branch: pale, like the grey group's
        head(kid, turn++ % HUES);
      });
    };
    if (root) share(root);
    // Pages side by side whose titles start the same ("Help to set up a company in …") would all be cut to the same
    // words. Those show what differs instead: "… Dubai Marina". The whole title stays in the panel and the search.
    nodes.forEach((n) => {
      const groups = new Map();
      n.kids.forEach((kid) => { if (kid.kind !== "page" || kid.label.length < 30) return; const lead = kid.label.slice(0, 18).toLowerCase(); groups.set(lead, [...(groups.get(lead) || []), kid]); });
      // Pages with the very same title show their address instead, which is the only thing that tells them apart.
      const titled = new Map();
      n.kids.forEach((kid) => { if (kid.kind === "page") titled.set(kid.label.toLowerCase(), [...(titled.get(kid.label.toLowerCase()) || []), kid]); });
      titled.forEach((twins) => { if (twins.length > 1) twins.forEach((kid) => { if (kid.path) kid.show = kid.path; }); });
      groups.forEach((same) => {
        if (same.length < 2) return;
        let cut = same[0].label.length;
        same.forEach((kid) => { let i = 0; while (i < cut && kid.label[i]?.toLowerCase() === same[0].label[i].toLowerCase()) i++; cut = i; });
        cut = same[0].label.lastIndexOf(" ", cut) + 1; // back to the start of a word
        if (cut < 12) return;
        const rests = same.map((kid) => kid.label.slice(cut).trim());
        if (new Set(rests).size < rests.length) return; // some titles are the very same: handled below, by their address
        same.forEach((kid, i) => { if (rests[i].length >= 3) kid.show = `… ${rests[i]}`; });
      });
    });
    return { nodes, root };
  }
  /* Open at the start: the home page, and its branches while the map stays small enough to read at a glance. */
  function firstOpen(tree) {
    const open = new Set();
    if (!tree.root) return open;
    open.add(tree.root.id);
    // Rows the map takes: one per branch, and an opened branch takes one per page in it. About 28 fit a screen at a size that reads.
    const top = tree.root.kids.slice(0, FIRST);
    let rows = Math.min(tree.root.kids.length, FIRST + 1);
    top.forEach((kid) => {
      const extra = Math.min(kid.kids.length, FIRST + 1) - 1;
      if (kid.kids.length && (kid.kind !== "group" || kid.open) && rows + extra <= 28) { open.add(kid.id); rows += extra; }
    });
    return open;
  }

  // ---- layout ------------------------------------------------------------------------------------
  let pen = null;
  function textWidth(text, bold) {
    if (!pen) pen = document.createElement("canvas").getContext("2d");
    pen.font = `${bold ? 600 : 500} 13px ${getComputedStyle(document.body).fontFamily}`;
    return pen.measureText(text).width;
  }
  const hasKids = (n) => n.kids.length > 0;
  const togWidth = (S, n) => (!hasKids(n) ? 0 : S.open[S.view].has(n.id) ? 20 : Math.max(22, Math.ceil(textWidth(num(n.pages || n.kids.length), true)) + 14));
  function boxWidth(n) {
    if (n.kind === "more") return Math.ceil(textWidth(n.label, false)) + 26;
    const lead = n.kind === "page" ? 0 : 20; // an icon before a home page, a folder and a group
    const notes = (n.notes ? 24 + (n.notes > 1 ? Math.ceil(textWidth(num(n.notes), true)) + 2 : 0) : 0) + (n.inlinks == null ? 0 : Math.ceil(textWidth(num(n.inlinks), true)) + 22) + (n.unlisted ? 22 : 0);
    const label = n.kind === "group" ? t(n.label) : n.show || n.label;
    const bold = n.kind === "home" || n.kind === "group";
    return Math.min(n.kind === "group" ? 420 : MAX_W + (n.kind === "home" ? 40 : 0), Math.max(54, Math.ceil(textWidth(label, bold)) + 27 + (n.kind === "home" ? 4 : 0) + lead + notes));
  }

  /* The children on show under a node: the first few, the ones a search found (and the ways to them), then a "+N" box. */
  function shownKids(S, n, must) {
    if (!S.open[S.view].has(n.id)) return [];
    const limit = S.more.get(`${S.view}:${n.id}`) || FIRST;
    if (n.kids.length <= limit + 1) return n.kids;
    const kept = n.kids.filter((kid, i) => i < limit || must?.has(kid.id));
    const rest = n.kids.length - kept.length;
    return rest > 0 ? [...kept, { id: `more-${n.id}`, kind: "more", of: n.id, label: fill("+{n} more", { n: num(rest) }), kids: [], up: n, depth: n.depth + 1 }] : kept;
  }

  function layout(S) {
    const tree = S.trees[S.view], root = tree.root;
    const must = searchMust(S);
    const narrow = S.root.clientWidth < 640;
    const items = [], edges = [];
    const place = (n, side) => {
      const kids = shownKids(S, n, must);
      const it = { n, side, w: boxWidth(n), tog: togWidth(S, n), kids: kids.map((kid) => place(kid, side)), rows: 0, y: 0, x: 0 };
      it.rows = it.kids.length ? it.kids.reduce((sum, kid) => sum + kid.rows, 0) : 1;
      return it;
    };
    const top = shownKids(S, root, must);
    // Two sides like a hand-drawn mind map: the first branches go right until that side holds half the rows.
    const sized = top.map((kid) => place(kid, 1));
    const total = sized.reduce((sum, it) => sum + it.rows, 0);
    let right = [], left = [], acc = 0;
    sized.forEach((it) => { if (narrow || sized.length < 2 || acc < total / 2) { right.push(it); acc += it.rows; } else left.push(it); });
    const flip = (it) => { it.side = -1; it.kids.forEach(flip); };
    left.forEach(flip);
    const rootIt = { n: root, side: 0, w: boxWidth(root), tog: 0, kids: [...right, ...left], rows: 1, x: 0, y: 0 };

    const setSide = (list, side) => {
      if (!list.length) return;
      const widths = [];
      const widen = (it, d) => { widths[d] = Math.max(widths[d] || 0, it.w + it.tog); it.kids.forEach((kid) => widen(kid, d + 1)); };
      list.forEach((it) => widen(it, 0));
      const starts = []; let x = rootIt.w / 2 + GAP_X;
      widths.forEach((w, d) => { starts[d] = x; x += w + GAP_X; });
      const height = list.reduce((sum, it) => sum + it.rows, 0) * ROW + (list.length - 1) * 10;
      let y = -height / 2 + ROW / 2;
      const put = (it, d) => {
        it.x = side > 0 ? starts[d] : -starts[d] - it.w;
        if (!it.kids.length) { it.y = y; y += ROW; } else { it.kids.forEach((kid) => put(kid, d + 1)); it.y = (it.kids[0].y + it.kids[it.kids.length - 1].y) / 2; }
      };
      list.forEach((it) => { put(it, 0); y += 10; });
    };
    setSide(right, 1); setSide(left, -1);
    rootIt.x = -rootIt.w / 2;

    const walk = (it, parent) => {
      items.push(it);
      if (parent) {
        const out = it.side > 0 ? (parent === rootIt ? parent.x + parent.w : parent.x + parent.w + parent.tog) : (parent === rootIt ? parent.x : parent.x - parent.tog);
        edges.push({ x1: out, y1: parent.y, x2: it.side > 0 ? it.x : it.x + it.w, y2: it.y, depth: it.n.depth, hue: it.n.kind === "more" ? undefined : it.n.hue, more: it.n.kind === "more" });
      }
      it.kids.forEach((kid) => walk(kid, it));
    };
    walk(rootIt, null);
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    items.forEach((it) => { minX = Math.min(minX, it.x - (it.side < 0 ? it.tog : 0)); maxX = Math.max(maxX, it.x + it.w + (it.side > 0 ? it.tog : 0)); minY = Math.min(minY, it.y - BOX_H / 2); maxY = Math.max(maxY, it.y + BOX_H / 2); });
    const dx = PAD - minX, dy = PAD - minY;
    items.forEach((it) => { it.x += dx; it.y += dy; });
    edges.forEach((e) => { e.x1 += dx; e.x2 += dx; e.y1 += dy; e.y2 += dy; });
    return { items, edges, w: maxX - minX + PAD * 2, h: maxY - minY + PAD * 2 };
  }

  // ---- search ------------------------------------------------------------------------------------
  function hits(S) {
    const q = S.q.trim().toLowerCase();
    const tree = S.trees[S.view];
    if (!q || !tree) return [];
    return tree.nodes.filter((n) => n.kind !== "group" && n.fold.includes(q));
  }
  /* The boxes a search must keep on show whatever the "+N more" limit: what it found, and the way to each. */
  function searchMust(S) {
    const found = hits(S);
    if (!found.length) return null;
    const must = new Set();
    found.slice(0, 60).forEach((n) => { for (let at = n; at; at = at.up) must.add(at.id); });
    return must;
  }
  function openWaysTo(S, nodes) {
    nodes.forEach((n) => { for (let at = n.up; at; at = at.up) S.open[S.view].add(at.id); });
  }

  // ---- drawing -----------------------------------------------------------------------------------
  const levelOf = (n) => (n.kind === "home" ? 0 : ((n.depth - 1) % 3) + 1);
  const KIND_ICON = { home: "house", folder: "folder", group: "link-2" };
  const pagesWord = (n) => fill(n === 1 ? "{n} page" : "{n} pages", { n: num(n) });

  function nodeHtml(S, it) {
    const n = it.n, open = S.open[S.view].has(n.id);
    const at = `data-x="${Math.round(it.x)}" data-y="${Math.round(it.y - BOX_H / 2)}" data-w="${it.w}"`;
    if (n.kind === "more") return `<button type="button" class="sm-node sm-more" data-sm-more="${n.of}" data-sm-id="${n.id}" ${at} tabindex="-1" role="treeitem" aria-level="${n.depth + 1}">${esc(n.label)}</button>`;
    const label = n.kind === "group" ? t(n.label) : n.show || n.label;
    const lead = KIND_ICON[n.kind] ? icon(KIND_ICON[n.kind]) : "";
    const notes = n.notes ? `<span class="sm-notes" aria-hidden="true">${icon("sticky-note")}${n.notes > 1 ? `<b class="tabular">${num(n.notes)}</b>` : ""}</span>` : "";
    const inl = n.inlinks == null ? "" : `<span class="sm-in tabular" aria-hidden="true">${num(n.inlinks)}</span>`;
    // By category: an article its category page doesn't link to (weak internal linking), and other categories it is in.
    const unl = n.unlisted ? `<span class="sm-unlisted" aria-hidden="true">${icon("link-2-off")}</span>` : "";
    const also = n.also_in?.length ? fill("Also in: {names}", { names: n.also_in.join(", ") }) : "";
    const unlSaid = n.unlisted ? t("Its category page doesn't link to it") : "";
    const said = [label, n.inlinks == null ? "" : fill(n.inlinks === 1 ? "{n} page links to it" : "{n} pages link to it", { n: num(n.inlinks) }), n.kind === "folder" ? t("folder") : "", hasKids(n) ? pagesWord(n.pages) : "", n.notes ? fill(n.notes === 1 ? "{n} comment" : "{n} comments", { n: num(n.notes) }) : "", unlSaid, also].filter(Boolean).join(", ");
    const hit = S.q.trim() ? (n.fold.includes(S.q.trim().toLowerCase()) && n.kind !== "group" ? " is-hit" : " is-dim") : "";
    const box = `<button type="button" class="sm-node sm-l${levelOf(n)}${n.hub ? " sm-hub" : ""}${n.hue === undefined ? "" : ` sm-b${n.hue}`} sm-${n.kind}${hit}${n.read === false && n.kind === "page" ? " is-unread" : ""}" data-sm-id="${n.id}" ${at} role="treeitem" aria-level="${n.depth + 1}" ${hasKids(n) ? `aria-expanded="${open}"` : ""} aria-label="${esc(said)}" tabindex="${S.cur === n.id ? 0 : -1}" data-tip="${esc(n.path && n.kind !== "folder" ? [n.path, unlSaid, also].filter(Boolean).join(" · ") : said)}">${lead}<span class="sm-label" dir="auto">${esc(label)}</span>${inl}${unl}${notes}</button>`;
    if (!hasKids(n) || !it.tog) return box;
    const tx = it.side > 0 ? it.x + it.w : it.x - it.tog;
    const words = fill(open ? "Close {name}" : "Open {name}: {pages}", { name: label, pages: pagesWord(n.pages) });
    return `${box}<button type="button" class="sm-tog sm-l${levelOf(n)}${n.hue === undefined ? "" : ` sm-b${n.hue}`}${open ? " is-open" : ""}" data-sm-toggle="${n.id}" data-x="${Math.round(tx)}" data-y="${Math.round(it.y - 10)}" data-w="${it.tog}" tabindex="-1" aria-label="${esc(words)}" data-tip="${esc(words)}">${open ? icon("minus") : `<span class="tabular">${num(n.pages || n.kids.length)}</span>`}</button>`;
  }
  const edgePath = (e) => { const mx = (e.x1 + e.x2) / 2; return `<path class="sm-edge sm-e${((e.depth - 1) % 3) + 1}${e.hue === undefined ? "" : ` sm-b${e.hue}`}${e.more ? " is-more" : ""}" d="M${e.x1.toFixed(1)} ${e.y1.toFixed(1)}C${mx.toFixed(1)} ${e.y1.toFixed(1)} ${mx.toFixed(1)} ${e.y2.toFixed(1)} ${e.x2.toFixed(1)} ${e.y2.toFixed(1)}"/>`; };

  function toolbar(S) {
    const d = S.data[S.view];
    const found = S.q.trim() ? hits(S).length : null;
    const seg = `<div class="seg sm-seg" role="group" aria-label="${esc(t("Group pages"))}">${VIEWS.map(([id, word]) => `<button type="button" data-sm-view="${id}" aria-pressed="${S.view === id}" data-tip="${esc(t(VIEW_TIPS[id]))}">${t(word)}</button>`).join("")}</div>`;
    // In a competitor's profile the same frame also shows my own site: one click, to compare how each is built.
    const pair = S.root?.dataset.smPairMine ? S.root.dataset : null;
    const side = pair ? `<div class="seg sm-seg sm-side" role="group" aria-label="${esc(t("Whose site"))}">${[["them", pair.smPairThemHost], ["you", pair.smPairMineHost]].map(([who, host]) => `<button type="button" data-sm-side="${who}" aria-pressed="${(S.who === "site") === (who === "you")}" data-tip="${esc(host)}">${window.COMP?.who ? window.COMP.who(who, host) : esc(t(who === "you" ? "You" : "Them"))}</button>`).join("")}</div>` : "";
    const search = `<label class="sm-search"><span class="sr">${t("Search the map")}</span>${icon("search")}<input class="input" type="search" data-sm-q placeholder="${esc(t("Search the map"))}" value="${esc(S.q)}" autocomplete="off" spellcheck="false"></label>
      <span class="sm-found small" data-sm-found role="status">${found === null ? "" : esc(found ? fill(found === 1 ? "{n} match" : "{n} matches", { n: num(found) }) : t("No page matches."))}</span>`;
    const tools = `<span class="end sm-tools">${readButton(S)}<button type="button" class="btn btn-small" data-sm-all="open">${t("Open all")}</button><button type="button" class="btn btn-small" data-sm-all="close">${t("Close all")}</button>
      <span class="sm-zoom" role="group" aria-label="${esc(t("Zoom"))}"><button type="button" class="icon-btn" data-sm-zoom="-1" aria-label="${esc(t("Zoom out"))}" data-tip="${esc(t("Zoom out"))}">${icon("minus")}</button><button type="button" class="icon-btn" data-sm-zoom="1" aria-label="${esc(t("Zoom in"))}" data-tip="${esc(t("Zoom in"))}">${icon("plus")}</button><button type="button" class="icon-btn" data-sm-zoom="0" aria-label="${esc(t("Fit the map"))}" data-tip="${esc(t("Fit the map"))}">${icon("maximize")}</button></span></span>`;
    return `<div class="card-head sm-head">${side}${seg}${d && d.boxes.length ? search : ""}${d && d.boxes.length ? tools : ""}</div>`;
  }

  /* What stands in for the map: still loading, failed, no page read yet, or links not read yet. */
  function standIn(S) {
    const view = S.view, d = S.data[view];
    if (S.failed[view]) return UI().failCard ? UI().failCard(S.failed[view], { retry: "data-sm-retry" }) : `<p class="sm-msg">${esc(S.failed[view])} <button type="button" class="btn btn-small" data-sm-retry>${t("Try again")}</button></p>`;
    if (!d) return `<div class="sm-wait" aria-busy="true"><span class="sr">${t("Loading")}</span>${UI().skeleton ? UI().skeleton("rows", { rows: 5 }) : ""}</div>`;
    if (!d.boxes.length) {
      return `<div class="empty sm-empty"><h3>${t("No pages read yet")}</h3><p>${t(d.site.kind === "own" ? "The page reader reads your site every day, and with Refresh data. The map draws itself from what it finds." : "The map draws itself once the page reader has read this competitor's pages.")}</p></div>`;
    }
    if (view === "category" && !d.places?.read && !d.links.read) {
      return `<div class="empty sm-empty"><h3>${t("Categories not read yet")}</h3><p>${t("The page reader saves where each page says it belongs (its breadcrumb and category) the next time it reads the site. This view fills in by itself.")}</p>
        <p><button type="button" class="btn" data-sm-view="folders">${t("See it by folders")}</button></p></div>`;
    }
    if (view !== "folders" && view !== "category" && !d.links.read) {
      return `<div class="empty sm-empty"><h3>${t("Links not read yet")}</h3><p>${t("The page reader saves each page's links the next time it reads the site. This view fills in by itself.")}</p>
        <p><button type="button" class="btn" data-sm-view="folders">${t("See it by folders")}</button></p></div>`;
    }
    return "";
  }
  function progress(S) {
    const d = S.data[S.view];
    if (S.view === "category" && d && d.places && d.places.read < d.places.of) {
      const part = Math.round((d.places.read / Math.max(1, d.places.of)) * 100);
      return `<div class="sm-progress" role="status"><span>${esc(fill("Categories read on {a} of {b} pages. The rest fill in as the reader passes.", { a: num(d.places.read), b: num(d.places.of) }))}</span><span class="sm-bar" aria-hidden="true"><i data-w="${part}"></i></span></div>`;
    }
    if (S.view === "folders" || S.view === "category" || !d || !d.links.read || d.links.read >= d.links.of) return "";
    const share = Math.round((d.links.read / d.links.of) * 100);
    return `<div class="sm-progress" role="status"><span>${esc(fill("Links read on {a} of {b} pages. The rest fill in as the reader passes.", { a: num(d.links.read), b: num(d.links.of) }))}</span><span class="sm-bar" aria-hidden="true"><i data-w="${share}"></i></span></div>`;
  }

  /* The sliding highlight of the switch, as mockup.js's placeInks draws it for the page (it only runs on a whole redraw). */
  function placeInk(root) {
    root.querySelectorAll(".sm-seg").forEach((box) => {
      const active = box.querySelector('button[aria-pressed="true"]');
      if (!active) return;
      box.querySelector(":scope > .ink")?.remove();
      const ink = document.createElement("span");
      ink.className = "ink"; ink.setAttribute("aria-hidden", "true");
      ink.style.transform = `translate(${active.offsetLeft}px,${active.offsetTop}px)`; ink.style.width = `${active.offsetWidth}px`; ink.style.height = `${active.offsetHeight}px`;
      box.prepend(ink);
    });
  }

  /* Read again: asks the page reader to read this website now. While it reads, the button says so; when it ends, the map
     is loaded afresh. The reader keeps its own limits (pages a day), and says so in its message. */
  async function askReading(S) {
    try { S.reading = await api(`site-map/reading?${ask(S)}`); } catch { S.reading = { busy: false }; }
    paintRead(S);
    if (S.reading.busy) watchReading(S);
  }
  function watchReading(S) {
    clearTimeout(S.readTimer);
    S.readTimer = setTimeout(async () => {
      let now;
      try { now = await api(`site-map/reading?${ask(S)}`); } catch { now = S.reading; }
      const ended = S.reading?.busy && !now.busy;
      S.reading = now;
      if (now.busy) { paintRead(S); watchReading(S); return; }
      if (ended) {
        S.data = {}; S.trees = {}; S.failed = {}; S.open = { folders: null, category: null, links: null, inlinks: null }; S.more = new Map(); S.placed = false; S.spots = new Map(); S.counted = false;
        UI().toast?.(now.status === "ok" || now.status === "done" ? t("Read again: the map is up to date.") : now.message || t("The reading stopped."));
        draw(S);
      } else paintRead(S);
    }, 5000);
  }
  async function readAgain(S) {
    if (S.reading?.busy) return;
    S.reading = { ...(S.reading || {}), busy: true };
    paintRead(S);
    try { S.reading = await window.COMP.api("POST", `site-map/read?${ask(S)}`); UI().toast?.(t("Reading the website again. The map updates when it's done.")); } catch (err) { S.reading = { busy: false }; UI().toast?.(err.message || t("That didn't start")); }
    paintRead(S);
    if (S.reading.busy) watchReading(S);
  }
  const readButton = (S) => {
    const busy = Boolean(S.reading?.busy);
    const when = S.reading?.finished_at && UI().ago ? fill("Last read {when}", { when: UI().ago(S.reading.finished_at) }) : t("Read this website's pages again now");
    return `<button type="button" class="btn btn-small sm-read${busy ? " is-busy" : ""}" data-sm-read ${busy ? 'aria-disabled="true"' : ""} data-tip="${esc(busy ? t("The page reader is on it.") : when)}">${icon("refresh-cw")}<span>${t(busy ? "Reading…" : "Read again")}</span></button>`;
  };
  function paintRead(S) {
    const old = S.root?.isConnected ? S.root.querySelector("[data-sm-read]") : null;
    if (!old) return;
    const had = document.activeElement === old;
    const box = document.createElement("span");
    UI().setHTML(box, readButton(S));
    old.replaceWith(box.firstElementChild);
    if (had) S.root.querySelector("[data-sm-read]")?.focus({ preventScroll: true });
  }

  function draw(S, { keep = null } = {}) {
    const root = S.root;
    if (!root?.isConnected) return;
    if (S.reading === undefined) { S.reading = null; askReading(S); }
    const typing = root.contains(document.activeElement) && document.activeElement.matches("[data-sm-q]");
    const caret = typing ? document.activeElement.selectionStart : null;
    const focusId = root.contains(document.activeElement) ? document.activeElement.dataset.smId ?? document.activeElement.dataset.smToggle : null;
    const focusTog = root.contains(document.activeElement) && document.activeElement.matches("[data-sm-toggle]");
    if (!S.data[S.view] && !S.failed[S.view]) load(S, S.view);
    const stand = standIn(S);
    if (stand) {
      UI().setHTML(root, `${toolbar(S)}<div class="sm-stand">${stand}</div>`);
      placeInk(root);
      return;
    }
    const before = keep ? spotOf(S, keep) : null;
    const old = S.spots;
    const L = layout(S);
    S.size = { w: L.w, h: L.h };
    if (!L.items.some((it) => it.n.id === S.cur)) S.cur = L.items[0].n.id;
    UI().setHTML(root, `${toolbar(S)}${progress(S)}
      <div class="sm-view" data-sm-viewport tabindex="-1">
        <div class="sm-stage" data-sm-stage role="tree" aria-label="${esc(fill("Site map of {host}", { host: S.host }))}">
          <svg class="sm-edges" width="${Math.ceil(L.w)}" height="${Math.ceil(L.h)}" viewBox="0 0 ${Math.ceil(L.w)} ${Math.ceil(L.h)}" aria-hidden="true" focusable="false">${L.edges.map(edgePath).join("")}</svg>
          ${L.items.map((it) => nodeHtml(S, it)).join("")}
        </div>
        <p class="sm-hint small" aria-hidden="true">${t("Drag to move · pinch or Ctrl + wheel to zoom")}</p>
      </div>`);
    const stage = root.querySelector("[data-sm-stage]");
    stage.style.width = `${L.w}px`; stage.style.height = `${L.h}px`;
    root.querySelectorAll(".sm-bar i").forEach((el) => { el.style.width = `${el.dataset.w}%`; });
    const spots = new Map();
    const still = UI().reduceMotion?.();
    stage.querySelectorAll("[data-x]").forEach((el) => {
      const x = Number(el.dataset.x), y = Number(el.dataset.y);
      el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.width = `${el.dataset.w}px`;
      const id = el.dataset.smId ?? `t${el.dataset.smToggle}`;
      spots.set(id, { x, y });
      const was = old.get(id);
      if (still) return;
      if (!was) el.classList.add("is-new");
      else if (was.x !== x || was.y !== y) {
        // Boxes that were there slide from their old place, so the eye follows the branch that moved.
        el.style.transform = `translate(${was.x - x}px, ${was.y - y}px)`;
        requestAnimationFrame(() => { el.classList.add("is-moving"); el.style.transform = ""; });
        el.addEventListener("transitionend", () => el.classList.remove("is-moving"), { once: true });
      }
    });
    if (!still && old.size) stage.querySelector(".sm-edges").classList.add("is-new");
    S.spots = spots;
    if (!S.placed) { fit(S); S.placed = true; } else {
      if (before) { const now = spotOf(S, keep); if (now) { S.tx += (before.x - now.x) * S.z; S.ty += (before.y - now.y) * S.z; } }
      apply(S);
    }
    if (typing) { const q = root.querySelector("[data-sm-q]"); q?.focus({ preventScroll: true }); try { q?.setSelectionRange(caret, caret); } catch { /* a search field in some browsers */ } }
    else if (focusId !== null && focusId !== undefined) root.querySelector(focusTog ? `[data-sm-toggle="${focusId}"]` : `[data-sm-id="${focusId}"]`)?.focus({ preventScroll: true });
    placeInk(root);
  }
  const spotOf = (S, id) => S.spots.get(String(id)) || null;

  // ---- moving and zooming ------------------------------------------------------------------------
  const viewport = (S) => S.root.querySelector("[data-sm-viewport]");
  function apply(S) {
    const stage = S.root.querySelector("[data-sm-stage]"), box = viewport(S);
    if (!stage || !box) return;
    // The map can't be dragged out of sight: a part of it always stays in the frame.
    const w = S.size.w * S.z, h = S.size.h * S.z, keepIn = 80;
    S.tx = Math.min(box.clientWidth - keepIn, Math.max(keepIn - w, S.tx));
    S.ty = Math.min(box.clientHeight - keepIn, Math.max(keepIn - h, S.ty));
    stage.style.transform = `translate(${S.tx}px, ${S.ty}px) scale(${S.z})`;
  }
  function fit(S) {
    const box = viewport(S);
    if (!box) return;
    const narrow = box.clientWidth < 640;
    S.z = Math.max(narrow ? 0.72 : 0.78, Math.min(1, box.clientWidth / S.size.w, box.clientHeight / S.size.h));
    S.tx = (box.clientWidth - S.size.w * S.z) / 2;
    S.ty = (box.clientHeight - S.size.h * S.z) / 2;
    if (S.size.w * S.z > box.clientWidth || S.size.h * S.z > box.clientHeight) {
      // Too big for the frame at a size that can be read: start on the home page, and the rest is a drag away.
      centre(S, S.trees[S.view].root.id, false);
      if (narrow) S.tx = 14 - (spotOf(S, S.trees[S.view].root.id)?.x ?? 0) * S.z;
    }
    apply(S);
  }
  function zoomAt(S, factor, px, py) {
    const box = viewport(S);
    if (!box) return;
    const cx = px ?? box.clientWidth / 2, cy = py ?? box.clientHeight / 2;
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, S.z * factor));
    S.tx = cx - ((cx - S.tx) / S.z) * z; S.ty = cy - ((cy - S.ty) / S.z) * z; S.z = z;
    apply(S);
  }
  function centre(S, id, smooth = true) {
    const box = viewport(S), spot = spotOf(S, id), el = S.root.querySelector(`[data-sm-id="${id}"]`);
    if (!box || !spot) return;
    const w = el ? Number(el.dataset.w) : 0;
    S.tx = box.clientWidth / 2 - (spot.x + w / 2) * S.z; S.ty = box.clientHeight / 2 - (spot.y + BOX_H / 2) * S.z;
    const stage = S.root.querySelector("[data-sm-stage]");
    if (smooth && !UI().reduceMotion?.()) { stage.classList.add("is-gliding"); setTimeout(() => stage.classList.remove("is-gliding"), 320); }
    apply(S);
  }
  /* A box reached with the keyboard is brought into the frame if it sits outside it. */
  function reveal(S, id) {
    const box = viewport(S), spot = spotOf(S, id), el = S.root.querySelector(`[data-sm-id="${id}"]`);
    if (!box || !spot || !el) return;
    const x = spot.x * S.z + S.tx, y = spot.y * S.z + S.ty, w = Number(el.dataset.w) * S.z;
    if (x < 12 || y < 12 || x + w > box.clientWidth - 12 || y + BOX_H * S.z > box.clientHeight - 12) centre(S, id);
  }

  // ---- what a click does -------------------------------------------------------------------------
  const nodeOf = (S, id) => S.trees[S.view]?.nodes[Number(id)] || null;
  function toggle(S, id) {
    const open = S.open[S.view], key = Number(id);
    if (open.has(key)) open.delete(key); else open.add(key);
    draw(S, { keep: key });
  }
  function setAll(S, how) {
    const tree = S.trees[S.view], open = S.open[S.view];
    if (how === "close") { open.clear(); open.add(tree.root.id); S.more.clear(); S.placed = false; draw(S); return; }
    // Level by level, stopping before the map gets too big to draw and to read.
    let shown = 1, level = [tree.root], stopped = false;
    while (level.length) {
      const next = [];
      let adds = 0;
      level.forEach((n) => { if (n.kids.length) adds += Math.min(n.kids.length, FIRST + 1); });
      if (shown + adds > 700 && shown > 1) { stopped = true; break; }
      level.forEach((n) => { if (n.kids.length) { open.add(n.id); next.push(...n.kids.slice(0, FIRST)); } });
      shown += adds; level = next;
    }
    S.placed = false;
    draw(S);
    if (stopped) UI().toast?.(t("Big site: only the first levels were opened. Open a branch to go deeper."));
  }
  function setView(S, view) {
    if (S.view === view) return;
    S.view = view; S.placed = false; S.spots = new Map(); S.hit = 0; S.cur = 0;
    draw(S);
    S.root.querySelector(`[data-sm-view="${view}"]`)?.focus({ preventScroll: true });
    syncAddress();
  }
  function search(S, q) {
    S.q = q; S.hit = 0;
    const found = hits(S);
    if (found.length) openWaysTo(S, found.slice(0, 60));
    draw(S);
    if (found.length) { const first = found.find((n) => spotOf(S, n.id)); if (first) centre(S, first.id); }
  }
  function nextHit(S, step) {
    const found = hits(S).filter((n) => spotOf(S, n.id));
    if (!found.length) return;
    S.hit = (S.hit + step + found.length) % found.length;
    centre(S, found[S.hit].id);
    S.root.querySelectorAll(".is-at").forEach((el) => el.classList.remove("is-at"));
    S.root.querySelector(`[data-sm-id="${found[S.hit].id}"]`)?.classList.add("is-at");
  }
  /* Opens every branch on the way to a page, then shows and focuses it: used by the panel's link lists. */
  function goTo(S, url) {
    const tree = S.trees[S.view];
    const n = tree?.nodes.find((x) => x.url === url && x.kind !== "folder");
    if (!n) { UI().toast?.(t("That page isn't on this map.")); return; }
    openWaysTo(S, [n]);
    for (let at = n; at.up; at = at.up) { const i = at.up.kids.indexOf(at); const key = `${S.view}:${at.up.id}`; if (i >= (S.more.get(key) || FIRST)) S.more.set(key, i + 1); }
    S.cur = n.id;
    draw(S);
    centre(S, n.id);
    const el = S.root.querySelector(`[data-sm-id="${n.id}"]`);
    openPanel(S, n, el);
  }

  // ---- the side panel ----------------------------------------------------------------------------
  let shown = null; // { S, n } of the box whose panel is open
  const when = (iso) => (iso ? (UI().fmtDateOnly ? UI().fmtDateOnly(iso) : iso.slice(0, 10)) : "");
  const fact = (label, value) => `<div class="pg-fact"><dt>${t(label)}</dt><dd>${value}</dd></div>`;
  const dash = `<span class="muted">—</span>`;
  const ownSite = (S) => S.who === "site";
  function notesBlock(S, n, scope, title) {
    if (!window.COMP?.notes) return "";
    const where = { scope, pageUrl: scope === "section" ? folderOf(n.url) : n.url, title, siteId: ownSite(S) ? S.id : (window.COMP.siteId && window.COMP.siteId !== window.COMP.ALL ? window.COMP.siteId : null) };
    return window.COMP.notes.block(where);
  }
  const folderOf = (url) => { const base = url.split("?")[0]; return base.endsWith("/") ? base : `${base}/`; };
  const linkList = (list) => `<ul class="sm-links">${list.slice(0, 200).map((l) => `<li><button type="button" class="link-btn sm-go" data-sm-goto="${esc(l.url)}" dir="auto">${esc(l.label || l.path)}</button><span class="small muted mono" dir="auto">${esc(l.path)}</span></li>`).join("")}</ul>`;

  function panelBody(S, n, card, extra) {
    const kidsLine = hasKids(n) ? `<p class="sm-under small">${esc(fill(S.view === "links" ? "{pages} reached through it on this map." : "{pages} under it.", { pages: pagesWord(n.pages) }))}</p>` : "";
    if (n.kind === "folder") {
      const whole = n.depth === 0; // a site with no home page read: its folder is the whole website, which a group note can't be
      return `<p class="sm-lede">${t("A folder of the address, not a page itself.")}</p>${kidsLine}
        ${whole ? "" : notesBlock(S, n, "section", t("Comments on this folder"))}
        ${whole ? "" : `<p class="help">${t("A comment here applies to every page under this folder.")}</p>`}`;
    }
    const loading = !card;
    const failed = card?.failed;
    const facts = loading ? (UI().skeleton ? UI().skeleton("rows", { rows: 3 }) : "") : failed ? `<p class="muted">${t("This page's details didn't load.")}</p>` : `<dl class="pg-facts sm-facts">
        ${fact("Title", card.title ? `<span dir="auto">${esc(card.title)}</span>` : dash)}
        ${fact("Words", card.read ? `<span class="tabular">${num(card.word_count || 0)}</span>` : `<span class="muted">${t("Not read yet")}</span>`)}
        ${extra ? `${fact("Google clicks, 28 days", extra.clicks === null ? dash : `<span class="tabular">${num(extra.clicks)}</span>`)}${fact("Position", extra.position === null ? dash : `<span class="tabular">${UI().dec ? UI().dec(extra.position) : extra.position}</span>`)}${fact("Backlinks", `<span class="tabular">${num(extra.backlinks)}</span>`)}` : ""}
        ${fact("Last change seen", card.last_changed_at ? esc(when(card.last_changed_at)) : dash)}
        ${fact("Read on", card.last_checked_at ? esc(when(card.last_checked_at)) : dash)}
      </dl>`;
    let links = "";
    if (card && !failed) {
      const out = card.links_out, into = card.links_in;
      links = `<details class="sm-fold"><summary>${t("Links to")} <span class="n-badge tabular">${out === null ? "—" : num(out.length)}</span></summary>
          ${out === null ? `<p class="muted small">${t("This page's links haven't been read yet.")}</p>` : out.length ? linkList(out) : `<p class="muted small">${t("It links to no other page of the site.")}</p>`}</details>
        <details class="sm-fold"><summary>${t("Linked from")} <span class="n-badge tabular">${card.links_known ? num(into.length) : "—"}</span></summary>
          ${!card.links_known ? `<p class="muted small">${t("Links aren't read yet for this site.")}</p>` : into.length ? linkList(into) : `<p class="muted small">${t("No page read so far links to it.")}</p>`}</details>`;
      const levelOfH = (h) => Number(String(h).replace(/\D/g, "")) || 2;
      const outline = [...(card.h1 || []).map((h) => [1, h]), ...(card.headings || []).filter((h) => Array.isArray(h)).map((h) => [levelOfH(h[0]), h[1]])];
      links += `<details class="sm-fold"><summary>${t("Outline")} <span class="n-badge tabular">${num(outline.length)}</span></summary>
          ${outline.length ? `<ol class="pg-outline">${outline.map(([level, text]) => `<li class="pg-h-${Math.min(level, 6)}"><span class="pg-hl">H${level}</span><span dir="auto">${esc(text)}</span></li>`).join("")}</ol>` : `<p class="muted small">${t("No headings on this page.")}</p>`}</details>`;
    }
    const folderNotes = n.kind === "page" && hasKids(n) && S.view === "folders" && n.url.split("?")[0].endsWith("/")
      ? `${notesBlock(S, n, "section", t("Comments on everything under it"))}` : "";
    return `${kidsLine}${facts}${links}${notesBlock(S, n, "page", t("Comments on this page"))}${folderNotes}`;
  }
  function panelHtml(S, n, card, extra) {
    const label = n.kind === "group" ? t(n.label) : n.label;
    const sub = n.url ? window.PageLink.html(n.url, { text: `${n.url.replace(/^https?:\/\//, "")} ↗`, cls: "sm-url" }) : "";
    const pagesBtn = ownSite(S) && n.kind !== "folder" && window.SCREENS?.pages && (!window.ACCESS?.can || window.ACCESS.can("pages")) ? `<button type="button" class="btn" data-sm-pages="${esc(n.url)}">${icon("layers")}${t("Open in Pages")}</button>` : "";
    return `${UI().panelHead(label, sub)}<div class="panel-body sm-panel" data-sm-panel="${n.id}">${panelBody(S, n, card, extra)}</div>${pagesBtn ? `<div class="panel-foot">${pagesBtn}</div>` : ""}`;
  }
  async function openPanel(S, n, opener) {
    if (n.kind === "group") { toggle(S, n.id); return; }
    shown = { S, n };
    S.root.querySelectorAll(".is-picked").forEach((el) => el.classList.remove("is-picked"));
    opener?.classList.add("is-picked");
    const paint = (card, extra) => {
      if (shown?.n !== n) return;
      const body = document.querySelector(`#panel [data-sm-panel="${n.id}"]`);
      if (body) { UI().setHTML(body, panelBody(S, n, card, extra)); window.COMP?.notes?.mount(); }
    };
    UI().openPanel(panelHtml(S, n, null, null), opener, { wide: false });
    window.COMP?.notes?.mount();
    if (n.kind === "folder") return;
    let card = null, extra = null;
    const jobs = [api(`site-map/page?${ask(S)}&url=${encodeURIComponent(n.url)}`).then((d) => { card = d; }).catch(() => { card = { failed: true }; })];
    if (ownSite(S)) {
      jobs.push(api(`site-pages/profile?site_id=${S.id}&url=${encodeURIComponent(n.url)}`).then((p) => { extra = { clicks: p.google_28d?.clicks ?? null, position: p.google_28d?.position ?? null, backlinks: (p.backlinks || []).length }; }).catch(() => {}));
    }
    await Promise.all(jobs);
    paint(card, extra);
  }
  /* A comment written or removed in the panel changes the mark on its box, without asking the server for the whole map. */
  function recount() {
    if (!shown || !document.querySelector(`#panel [data-sm-panel="${shown.n.id}"]`)) return;
    const { S, n } = shown;
    const lists = [...document.querySelectorAll("#panel [data-note-block]")];
    if (!lists.length || lists.some((el) => !el.dataset.noteMounted)) return;
    const ids = new Set();
    lists.forEach((el) => el.querySelectorAll("[data-note-list] > li").forEach((li, i) => ids.add(li.dataset.noteId || li.id || `${el.dataset.noteBlock}:${i}`)));
    if (ids.size === n.notes) return;
    n.notes = ids.size;
    VIEWS.forEach(([other]) => { if (other !== S.view) S.trees[other]?.nodes.forEach((x) => { if (x.url === n.url && x.kind === n.kind) x.notes = ids.size; }); });
    draw(S);
    S.root.querySelector(`[data-sm-id="${n.id}"]`)?.classList.add("is-picked");
  }

  // ---- events ------------------------------------------------------------------------------------
  const rootOf = (el) => (el instanceof Element ? el.closest("[data-sm-root]") : null);
  let drag = null, pinch = null, dragged = false, typed = null;
  const pointers = new Map();

  document.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    let hit;
    if ((hit = e.target.closest("[data-sm-goto]")) && shown) { goTo(shown.S, hit.dataset.smGoto); return; }
    if ((hit = e.target.closest("[data-sm-pages]"))) { UI().closePanel(); window.SCREENS.pages.open(hit.dataset.smPages); return; }
    if ((hit = e.target.closest("[data-sm-rivals]"))) { openRivals(hit); return; }
    if ((hit = e.target.closest("[data-sm-rival]"))) {
      UI().closePopover?.();
      const site = UI().siteIdPicked(), rivalId = Number(hit.dataset.smRival);
      rivalShown.set(site, rivalId ? (rivals.get(site) || []).find((r) => r.id === rivalId) || null : null);
      UI().closePanel?.();
      UI().render({ keepScroll: true });
      document.querySelector(rivalId ? "[data-sm-rivals]" : '.sm-who [data-sm-rival=""]')?.focus({ preventScroll: true });
      return;
    }
    if ((hit = e.target.closest("[data-sm-pick]"))) { UI().pickSite(hit.dataset.smPick); UI().render({ keepScroll: false }); return; }
    const root = rootOf(e.target);
    if (!root) return;
    const S = stateFor(root);
    if (dragged) { dragged = false; return; } // the end of a drag isn't a click on the box under it
    if ((hit = e.target.closest("[data-sm-side]"))) { setSide(S, hit.dataset.smSide); return; }
    if ((hit = e.target.closest("[data-sm-view]"))) { setView(S, hit.dataset.smView); return; }
    if ((hit = e.target.closest("[data-sm-read]"))) { readAgain(S); return; }
    if ((hit = e.target.closest("[data-sm-all]"))) { setAll(S, hit.dataset.smAll); return; }
    if ((hit = e.target.closest("[data-sm-zoom]"))) { const step = Number(hit.dataset.smZoom); if (step) zoomAt(S, step > 0 ? 1.25 : 0.8); else { S.placed = false; fit(S); S.placed = true; } return; }
    if (e.target.closest("[data-sm-retry]")) { S.failed[S.view] = ""; draw(S); return; }
    if ((hit = e.target.closest("[data-sm-toggle]"))) { toggle(S, hit.dataset.smToggle); return; }
    if ((hit = e.target.closest("[data-sm-more]"))) {
      const key = `${S.view}:${hit.dataset.smMore}`;
      S.more.set(key, (S.more.get(key) || FIRST) + STEP);
      draw(S, { keep: hit.dataset.smMore });
      return;
    }
    if ((hit = e.target.closest("[data-sm-id]"))) { const n = nodeOf(S, hit.dataset.smId); if (n) { S.cur = n.id; openPanel(S, n, hit); } }
  });

  document.addEventListener("input", (e) => {
    const root = rootOf(e.target);
    if (!root || !e.target.matches("[data-sm-q]")) return;
    const S = stateFor(root), q = e.target.value;
    clearTimeout(typed);
    typed = setTimeout(() => search(S, q), 160);
  });

  document.addEventListener("keydown", (e) => {
    const root = rootOf(e.target);
    if (!root) return;
    const S = stateFor(root);
    if (e.target.matches("[data-sm-q]")) {
      if (e.key === "Enter") { e.preventDefault(); clearTimeout(typed); if (S.q !== e.target.value) search(S, e.target.value); else nextHit(S, e.shiftKey ? -1 : 1); }
      if (e.key === "Escape" && e.target.value) { e.preventDefault(); e.target.value = ""; search(S, ""); }
      return;
    }
    const el = e.target.closest("[data-sm-id]");
    if (!el || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "+", "-"].includes(e.key)) return;
    const more = el.dataset.smMore !== undefined;
    const n = more ? null : nodeOf(S, el.dataset.smId);
    const x = Number(el.dataset.x), y = Number(el.dataset.y);
    const all = [...root.querySelectorAll("[data-sm-id]")];
    const move = (to) => { if (!to) return; S.cur = to.dataset.smMore !== undefined ? S.cur : Number(to.dataset.smId); all.forEach((b) => { b.tabIndex = b === to ? 0 : -1; }); to.focus({ preventScroll: true }); reveal(S, to.dataset.smId); };
    e.preventDefault();
    if (e.key === "Home") { move(all[0]); return; }
    if (e.key === "+" || e.key === "-") { if (n && hasKids(n) && S.open[S.view].has(n.id) !== (e.key === "+")) toggle(S, n.id); return; }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // The nearest box above or below in the same column, as the eye would pick it.
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const column = all.filter((b) => b !== el && Math.abs(Number(b.dataset.x) + (Number(b.dataset.x) < x ? Number(b.dataset.w) : 0) - (x + (Number(b.dataset.x) < x ? Number(el.dataset.w) : 0))) < 2 && (Number(b.dataset.y) - y) * dir > 0);
      const pool = column.length ? column : all.filter((b) => b !== el && (Number(b.dataset.y) - y) * dir > 0 && b.getAttribute("aria-level") === el.getAttribute("aria-level"));
      move(pool.sort((a, b) => Math.abs(Number(a.dataset.y) - y) - Math.abs(Number(b.dataset.y) - y))[0]);
      return;
    }
    const tree = S.trees[S.view], home = tree.root;
    const node = n || nodeOf(S, el.dataset.smMore);
    const onLeft = x + Number(el.dataset.w) / 2 < (spotOf(S, home.id)?.x ?? 0);
    const outward = (e.key === "ArrowRight") !== onLeft; // away from the home page
    if (n && n === home) {
      const side = all.filter((b) => b.getAttribute("aria-level") === "2" && (Number(b.dataset.x) > x) === (e.key === "ArrowRight"));
      move(side.sort((a, b) => Math.abs(Number(a.dataset.y) - y) - Math.abs(Number(b.dataset.y) - y))[0]);
      return;
    }
    if (!outward) { const up = more ? node : node.up; move(root.querySelector(`[data-sm-id="${up.id}"]`)); return; }
    if (!n || !hasKids(n)) return;
    if (!S.open[S.view].has(n.id)) { toggle(S, n.id); return; }
    move(root.querySelector(`[data-sm-id="${n.kids[0].id}"]`));
  });

  document.addEventListener("wheel", (e) => {
    const box = e.target instanceof Element ? e.target.closest("[data-sm-viewport]") : null;
    if (!box) return;
    const S = stateFor(rootOf(box));
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); const r = box.getBoundingClientRect(); zoomAt(S, Math.exp(-e.deltaY * 0.0045), e.clientX - r.left, e.clientY - r.top); return; }
    const was = [S.tx, S.ty];
    S.tx -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX; S.ty -= e.shiftKey && !e.deltaX ? 0 : e.deltaY;
    apply(S);
    // At the map's edge the wheel goes back to the page, so the map never traps the scroll.
    if (Math.abs(S.tx - was[0]) > 0.5 || Math.abs(S.ty - was[1]) > 0.5) e.preventDefault();
  }, { passive: false });

  document.addEventListener("pointerdown", (e) => {
    const box = e.target instanceof Element ? e.target.closest("[data-sm-viewport]") : null;
    if (!box || (e.pointerType === "mouse" && e.button !== 0)) return;
    const S = stateFor(rootOf(box));
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragged = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { S, box, gap: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      drag = null;
      return;
    }
    drag = { S, box, x: e.clientX, y: e.clientY, tx: S.tx, ty: S.ty, id: e.pointerId, moved: false };
  });
  document.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()], gap = Math.hypot(a.x - b.x, a.y - b.y) || 1, r = pinch.box.getBoundingClientRect();
      zoomAt(pinch.S, gap / pinch.gap, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      pinch.gap = gap; dragged = true;
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return; // a small slip of the hand is still a click
    if (!drag.moved) { drag.moved = true; drag.box.classList.add("is-dragging"); try { drag.box.setPointerCapture(e.pointerId); } catch { /* the pointer already left */ } }
    drag.S.tx = drag.tx + dx; drag.S.ty = drag.ty + dy;
    apply(drag.S);
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && drag.id === e.pointerId) {
      if (drag.moved) { dragged = true; drag.box.classList.remove("is-dragging"); setTimeout(() => { dragged = false; }, 0); }
      drag = null;
    }
  };
  document.addEventListener("pointerup", endPointer);
  document.addEventListener("pointercancel", endPointer);

  document.addEventListener("seocc:notes-painted", () => setTimeout(recount, 0));
  let resized = null;
  addEventListener("resize", () => { clearTimeout(resized); resized = setTimeout(() => document.querySelectorAll("[data-sm-root]").forEach((root) => { const S = stateFor(root); if (S.trees[S.view]) { S.placed = false; draw(S); } }), 180); });

  // ---- putting a map on the page -----------------------------------------------------------------
  /* mine: { id, host } of my own site, for a competitor's map that can switch to mine (Them / You). */
  function block({ siteId = null, competitorId = null, host = "", mine = null } = {}) {
    const pair = competitorId && mine?.id ? ` data-sm-pair data-sm-pair-them="${Number(competitorId)}" data-sm-pair-them-host="${esc(host)}" data-sm-pair-mine="${Number(mine.id)}" data-sm-pair-mine-host="${esc(mine.host || "")}"` : "";
    return `<section class="card sm" data-sm-root ${competitorId ? `data-sm-competitor="${Number(competitorId)}"` : `data-sm-site="${Number(siteId)}"`} data-sm-host="${esc(host)}"${pair}></section>`;
  }
  /* Them / You: the frame stays, the website in it changes. Each keeps its own open branches and place. */
  function setSide(S, side) {
    const root = S.root, d = root.dataset;
    if ((S.who === "site") === (side === "you")) return;
    UI().closePanel?.();
    if (side === "you") { delete d.smCompetitor; d.smSite = d.smPairMine; d.smHost = d.smPairMineHost; } else { delete d.smSite; d.smCompetitor = d.smPairThem; d.smHost = d.smPairThemHost; }
    const next = stateFor(root);
    next.view = S.view; next.placed = false; next.spots = new Map();
    draw(next);
    root.querySelector(`[data-sm-side="${side}"]`)?.focus({ preventScroll: true });
  }
  function mountAll() {
    if (!window.UI) return;
    document.querySelectorAll("[data-sm-root]:not([data-sm-ready])").forEach((root) => {
      root.dataset.smReady = "1";
      const S = stateFor(root);
      S.placed = false; S.spots = new Map();
      draw(S);
    });
  }
  let waiting = false;
  new MutationObserver(() => { if (waiting) return; waiting = true; requestAnimationFrame(() => { waiting = false; mountAll(); }); }).observe(document.documentElement, { childList: true, subtree: true });

  // ---- the Site map screen -----------------------------------------------------------------------
  let wantedView = null;
  /* The screen shows my website, or one of its competitors picked in the row above the map (owner, 2026-11-20:
     "see the website in the portfolio and the competitors of this portfolio" in one place). */
  const rivals = new Map(); // my site's id -> its competitors [{ id, host }], once asked
  const rivalShown = new Map(); // my site's id -> the competitor picked on this screen, or nothing for my own site
  const shownRival = (id) => { const r = rivalShown.get(id); return r && (rivals.get(id) || []).some((x) => x.id === r.id) ? r : null; };
  const pickedState = () => { const id = UI().siteIdPicked(); if (!id) return null; const r = shownRival(id); return maps.get(r ? `competitor:${r.id}` : `site:${id}`) || null; };
  /* My website as one button, the competitors as one list (owner, 2026-11-20: a dropdown, not a row of every name).
     A native list can't show logos, so it is a button and a menu, as on Link gaps. */
  function whoRow(id, host) {
    const list = rivals.get(id);
    if (!list || !list.length) return `<div class="sm-who" data-sm-who="${id}" ${list ? "hidden" : ""}></div>`;
    const now = shownRival(id), logo = (h) => (UI().siteLogo ? UI().siteLogo(h, 16) : "");
    return `<div class="sm-who" data-sm-who="${id}" role="group" aria-label="${esc(t("Whose site"))}">
      <button type="button" class="sm-who-chip sm-who-you" data-sm-rival="" aria-pressed="${!now}"><span class="who who-you">${t("You")}</span>${logo(host)}<span dir="auto">${esc(host)}</span></button>
      <button type="button" class="select sm-who-pick${now ? " is-on" : ""}" data-sm-rivals data-pop-toggle aria-haspopup="true" aria-expanded="false"><span class="who who-them">${t(now ? "Them" : "Competitors")}</span>${now ? `${logo(now.host)}<span class="sm-who-word" dir="auto">${esc(now.host)}</span>` : `<span class="sm-who-word muted">${esc(fill(list.length === 1 ? "{n} competitor" : "{n} competitors", { n: num(list.length) }))}</span>`}</button></div>`;
  }
  function openRivals(anchor) {
    if (anchor.getAttribute("aria-expanded") === "true") { UI().closePopover({ focus: true }); return; }
    const id = UI().siteIdPicked(), now = shownRival(id);
    const menu = UI().popover(anchor, (rivals.get(id) || []).map((r) => `<button type="button" data-sm-rival="${r.id}" aria-pressed="${now?.id === r.id}" ${now?.id === r.id ? "data-autofocus" : ""}>${UI().siteLogo ? UI().siteLogo(r.host, 16) : ""}<span class="sm-who-word" dir="auto">${esc(r.host)}</span>${now?.id === r.id ? `<span class="tick">${icon("check")}</span>` : ""}</button>`).join(""), "sm-who-menu");
    if (menu) menu.style.minWidth = `${Math.max(240, anchor.offsetWidth)}px`;
  }
  function askRivals(id) {
    if (rivals.has(id) || !window.COMP?.api) return;
    rivals.set(id, null);
    window.COMP.api("GET", `competitors?site_id=${id}`).then((a) => (a.competitors || []).map((c) => ({ id: c.id, host: c.host })).sort((a, b) => a.host.localeCompare(b.host))).catch(() => []).then((list) => {
      rivals.set(id, list);
      // The map keeps its place through a redraw (its state lives in `maps`), so the row is simply drawn with the screen.
      if (list.length && UI().state.route === "map" && UI().siteIdPicked() === id) UI().render({ keepScroll: true });
    });
  }
  function syncAddress() { if (UI().state.route === "map") UI().syncUrl?.(); }
  function page() {
    const id = UI().siteIdPicked(), host = UI().siteHostPicked();
    if (!id) {
      const sites = (window.SITES || []).filter((s) => s.realId);
      const head = UI().topbar(t("Site map"), t("A website's pages as a mind map"), "", false);
      return `${head}<div class="content page-enter"><div class="table-wrap"><div class="empty sm-pick"><h3>${t("Pick a website")}</h3><p>${t("A map shows one website at a time.")}</p>
        <div class="sm-pick-list">${sites.map((s) => `<button type="button" class="btn" data-sm-pick="${esc(s.host)}">${UI().siteLogo ? UI().siteLogo(s.host, 16) : ""}<span dir="auto">${esc(s.host)}</span></button>`).join("")}</div></div></div></div>`;
    }
    const rival = shownRival(id);
    if (wantedView) { const key = rival ? `competitor:${rival.id}` : `site:${id}`; if (maps.has(key)) maps.get(key).view = wantedView; else pendingView.set(key, wantedView); wantedView = null; }
    const d = pickedState()?.data.folders, shown = rival ? rival.host : host;
    const head = UI().topbar(t("Site map"), d ? `${esc(shown)} · ${pagesWord(d.pages)}` : esc(shown), "", false);
    askRivals(id);
    // The new design (Cobalt): the map's numbers and where the pages sit, above the map (ocean-keywords-pages.js).
    const top = document.documentElement.dataset.brand === "ocean" && window.OceanKP ? window.OceanKP.siteMap(d) : "";
    return `${head}<div class="content page-enter sm-screen">${whoRow(id, host)}${top}${rival ? block({ competitorId: rival.id, host: rival.host }) : block({ siteId: id, host })}</div>`;
  }
  window.SiteMap = { block, mount: mountAll };
  window.SCREENS = window.SCREENS || {};
  window.SCREENS.map = {
    init() {},
    page,
    after: mountAll,
    address() { const S = pickedState(); return S && S.view !== "folders" ? { view: S.view } : {}; },
    fromAddress(q) { const view = q.get("view"); wantedView = VIEWS.some(([id]) => id === view) ? view : "folders"; },
  };

  const fr = {
    "Site map": "Plan du site", "A website's pages as a mind map": "Les pages d'un site sous forme de carte mentale", "By folders": "Par dossiers", "By links": "Par liens", "Whose site": "Quel site", "Competitors": "Concurrents", "{n} competitor": "{n} concurrent", "{n} competitors": "{n} concurrents",
    "Read again": "Relire", "Reading…": "Lecture…", "Read this website's pages again now": "Relire les pages de ce site maintenant", "Last read {when}": "Dernière lecture {when}", "The page reader is on it.": "Le lecteur de pages s'en occupe.",
    "Reading the website again. The map updates when it's done.": "Nouvelle lecture du site. La carte se met à jour à la fin.", "Read again: the map is up to date.": "Relu : la carte est à jour.", "The reading stopped.": "La lecture s'est arrêtée.", "That didn't start": "Le démarrage a échoué", "Internal links": "Liens internes",
    "No page links to it": "Aucune page ne pointe vers elle", "1 page links to it": "1 page pointe vers elle", "2 to 4 pages link to it": "2 à 4 pages pointent vers elle", "5 to 19 pages link to it": "5 à 19 pages pointent vers elle", "20 pages or more link to it": "20 pages ou plus pointent vers elle",
    "{n} page links to it": "{n} page pointe vers elle", "{n} pages link to it": "{n} pages pointent vers elle",
    "Group pages": "Regrouper les pages", "Search the map": "Chercher sur la carte", "{n} match": "{n} résultat", "{n} matches": "{n} résultats", "Open all": "Tout ouvrir", "Close all": "Tout fermer",
    "Zoom": "Zoom", "Zoom out": "Dézoomer", "Zoom in": "Zoomer", "Fit the map": "Ajuster la carte", "Drag to move · pinch or Ctrl + wheel to zoom": "Glissez pour déplacer · pincez ou Ctrl + molette pour zoomer",
    "+{n} more": "+{n} autres", "{n} page": "{n} page", "{n} pages": "{n} pages", "{n} comment": "{n} commentaire", "{n} comments": "{n} commentaires", "folder": "dossier",
    "Close {name}": "Fermer {name}", "Open {name}: {pages}": "Ouvrir {name} : {pages}", "Site map of {host}": "Plan du site {host}",
    "No pages read yet": "Aucune page lue pour l'instant", "The page reader reads your site every day, and with Refresh data. The map draws itself from what it finds.": "Le lecteur de pages lit votre site chaque jour, et avec Actualiser les données. La carte se dessine à partir de ce qu'il trouve.",
    "The map draws itself once the page reader has read this competitor's pages.": "La carte se dessine dès que le lecteur de pages a lu les pages de ce concurrent.",
    "Links not read yet": "Liens pas encore lus", "The page reader saves each page's links the next time it reads the site. This view fills in by itself.": "Le lecteur de pages enregistre les liens de chaque page à sa prochaine lecture du site. Cette vue se remplit toute seule.",
    "See it by folders": "Voir par dossiers", "Grouped by the folders in each page's address": "Groupées par les dossiers de l'adresse de chaque page",
    "Each page under the category it says it belongs to": "Chaque page sous la catégorie à laquelle elle dit appartenir",
    "How many clicks each page is from the home page": "À combien de clics de l'accueil est chaque page", "How many of your pages link to each page": "Combien de vos pages renvoient vers chaque page", "By category": "Par catégorie", "Also in: {names}": "Aussi dans : {names}",
    "Its category page doesn't link to it": "Sa page catégorie ne renvoie pas vers elle", "Categories not read yet": "Catégories pas encore lues",
    "The page reader saves where each page says it belongs (its breadcrumb and category) the next time it reads the site. This view fills in by itself.": "Le lecteur de pages enregistre où chaque page dit appartenir (fil d'Ariane, catégorie) à sa prochaine lecture du site. Cette vue se remplit toute seule.",
    "Categories read on {a} of {b} pages. The rest fill in as the reader passes.": "Catégories lues sur {a} pages sur {b}. Le reste se remplit au passage du lecteur.",
    "Pages with no category": "Pages sans catégorie", "Articles with no category": "Articles sans catégorie", "Links read on {a} of {b} pages. The rest fill in as the reader passes.": "Liens lus sur {a} pages sur {b}. Le reste se remplit au passage du lecteur.",
    "Big site: only the first levels were opened. Open a branch to go deeper.": "Grand site : seuls les premiers niveaux sont ouverts. Ouvrez une branche pour aller plus loin.",
    "That page isn't on this map.": "Cette page n'est pas sur cette carte.", "Not reached from the home page": "Pas atteintes depuis l'accueil", "Pages with no folder": "Pages sans dossier", "Linked from the home page, leading to no other page": "Liées depuis l'accueil, sans mener à une autre page",
    "{pages} reached through it on this map.": "{pages} atteintes par elle sur cette carte.", "{pages} under it.": "{pages} en dessous.",
    "A folder of the address, not a page itself.": "Un dossier de l'adresse, pas une page.", "Comments on this folder": "Commentaires sur ce dossier", "A comment here applies to every page under this folder.": "Un commentaire ici vaut pour toutes les pages de ce dossier.",
    "This page's details didn't load.": "Les détails de cette page n'ont pas chargé.", "Not read yet": "Pas encore lue", "Google clicks, 28 days": "Clics Google, 28 jours", "Last change seen": "Dernier changement vu",
    "Links to": "Liens vers", "Linked from": "Liens depuis", "This page's links haven't been read yet.": "Les liens de cette page ne sont pas encore lus.", "It links to no other page of the site.": "Elle ne renvoie vers aucune autre page du site.",
    "Links aren't read yet for this site.": "Les liens de ce site ne sont pas encore lus.", "No page read so far links to it.": "Aucune page lue jusqu'ici n'y renvoie.",
    "Comments on everything under it": "Commentaires sur tout ce qui est en dessous", "Comments on this page": "Commentaires sur cette page", "Open in Pages": "Ouvrir dans Pages",
    "Pick a website": "Choisissez un site", "A map shows one website at a time.": "Une carte montre un site à la fois.", "Loading": "Chargement", "Try again": "Réessayer", "That didn't load": "Le chargement a échoué",
  };
  Object.keys(fr).forEach((word) => { if (window.FR && window.FR[word] === undefined) window.FR[word] = fr[word]; });
})();
