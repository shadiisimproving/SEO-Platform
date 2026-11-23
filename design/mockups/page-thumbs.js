/* A page of my sites shown as its picture and its title, with the address under them, like Search Console's "Your content"
   (the owner, 2026-11-20: "do it everywhere"). Every list of my pages uses this, so they all look the same.

     PageThumb.row(url, { host, inner, image, title, size })
         the picture, then the page's title over `inner` (the screen's own address link and anything under it).
     PageThumb.html(url, { host, image, size })   the picture alone
     PageThumb.title(url, { host })               the page's title, or ""
     PageThumb.mine(url, { host })                whether it's a page of my sites (false until the answer is in)

   The picture is the one the page shares (og:image), the title its <title>, both read by the page reader and sent by
   GET /api/site-pages/pictures for the sites this person may see. A page with no picture, or one that doesn't load,
   shows its site's icon in the same box, so titles line up. Pages of other sites (competitors) get nothing: lists of
   theirs stay as they are. The answer is asked once, when a screen first needs it, and the screen is drawn again then. */
(() => {
  "use strict";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const bare = (host) => String(host || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  const AGAIN_AFTER = 30 * 60 * 1000; // the reader works once a day: a long session asks again now and then
  let known = null, asked = 0, waiting = false;

  function where(url, host) {
    const value = String(url || "").trim();
    let site = bare(host || window.UI?.siteHostPicked?.()), path = value;
    if (/^https?:\/\//i.test(value)) {
      try { const u = new URL(value); site = bare(u.hostname); path = u.pathname; } catch { return null; }
    } else if (!value.startsWith("/")) {
      const m = value.match(/^((?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(\/.*)?$/i); // "example.com/page"
      if (!m) return null;
      site = bare(m[1]); path = m[2] || "/";
    }
    path = path.split("?")[0].split("#")[0];
    try { path = decodeURI(path); } catch { /* a stray % stays as written */ }
    path = path.replace(/\/+$/, "") + "/";
    return site ? { site, path } : null;
  }

  function load() {
    if (waiting || (known && Date.now() - asked < AGAIN_AFTER)) return;
    if (!window.BOOT || location.protocol === "file:") { known = known || {}; return; } // a plain file has no server
    waiting = true; asked = Date.now();
    fetch("api/site-pages/pictures", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const first = known === null;
        known = d && d.sites ? d.sites : known || {};
        if (first && document.querySelector(".pthumb[data-pthumb-wait]")) window.UI?.render?.();
      })
      .catch(() => { known = known || {}; })
      .finally(() => { waiting = false; });
  }

  function facts(url, host) {
    load();
    const at = where(url, host);
    if (!at || !known) return { at, fact: null };
    const site = known[at.site];
    return { at, fact: site ? site[at.path] || null : null, mine: Boolean(site) };
  }

  const icon = (site, size) => (window.UI?.siteLogo ? window.UI.siteLogo(site, Math.round(size / 2)) : "");
  const box = (site, size, inner, extra = "") => `<span class="pthumb${inner ? "" : " pthumb-none"}" style="width:${size}px;height:${size}px" data-pthumb-site="${esc(site)}"${extra} aria-hidden="true">${inner || icon(site, size)}</span>`;
  const isAddress = (src) => typeof src === "string" && /^https?:\/\//i.test(src);

  function html(url, { host = null, image = null, size = 40 } = {}) {
    const { at, fact } = facts(url, host);
    if (!at) return "";
    const src = isAddress(image) ? image : fact && isAddress(fact[1]) ? fact[1] : "";
    const wait = !known && !isAddress(image) ? " data-pthumb-wait" : "";
    return box(at.site, size, src ? `<img class="pthumb-img" src="${esc(src)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : "", wait);
  }

  const title = (url, { host = null } = {}) => { const { fact } = facts(url, host); return fact ? fact[0] || "" : ""; };

  /* inner: the screen's own markup for the address (already escaped). Pages of a site that isn't mine come back as inner. */
  function row(url, { host = null, inner = "", image = null, title: given = null, size = 40 } = {}) {
    const { at, mine } = facts(url, host);
    if (!at || (known && !mine && !isAddress(image))) return inner;
    const name = given ?? title(url, { host });
    return `<div class="pthumb-row">${html(url, { host, image, size })}<div class="pthumb-text">${name ? `<div class="pthumb-title" dir="auto">${esc(name)}</div>` : ""}${inner}</div></div>`;
  }

  // A picture that doesn't load (removed, or its server refuses other sites) gives way to the site's icon.
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains("pthumb-img")) return;
    const holder = img.closest(".pthumb");
    if (!holder) return;
    holder.classList.add("pthumb-none");
    const size = parseInt(holder.style.width, 10) || 40;
    const spare = document.createElement("span");
    if (window.UI?.setHTML) window.UI.setHTML(spare, icon(holder.dataset.pthumbSite || "", size)); else spare.textContent = "";
    holder.replaceChildren(...spare.childNodes);
  }, true);

  /* Whether the address is a page of one of my sites, so a picture belongs beside it. False until the answer is in. */
  const mine = (url, { host = null } = {}) => Boolean(facts(url, host).mine);

  window.PageThumb = { html, title, row, where, mine };
})();
