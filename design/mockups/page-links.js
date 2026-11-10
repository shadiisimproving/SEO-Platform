/* A page address on screen is a link that opens that page in a new tab.
   PageLink.html(url, { text, host }) takes a full address or a bare path like /services/. A path needs the site's host:
   pass it, or it uses the site picked in the menu. With no host to go on, it stays plain text rather than a broken link.
   Many rows open a panel when clicked: a click on the address opens the page only, never the row's panel too. */
(() => {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const bareHost = (host) => String(host || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");

  function href(url, host) {
    const value = String(url || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("/")) {
      const site = bareHost(host || window.UI?.siteHostPicked?.());
      return site ? `https://${site}${value}` : "";
    }
    if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/|$)/i.test(value)) return `https://${value}`; // "example.com/page", as shortUrl writes it
    return "";
  }

  function html(url, { text = null, host = null, cls = "", dir = "auto", title = null } = {}) {
    const label = text ?? url ?? "";
    const to = href(url, host);
    if (!to) return `<span class="${esc(cls)}" dir="${dir}">${esc(label)}</span>`;
    const tip = title ?? to;
    return `<a class="page-link ${esc(cls)}" href="${esc(to)}" target="_blank" rel="noopener noreferrer" dir="${dir}"${tip ? ` title="${esc(tip)}"` : ""}>${esc(label)}</a>`;
  }

  // Capture runs before any row's own handler, so the row stays shut; the browser still follows the link.
  const keepToLink = (e) => { if (e.target instanceof Element && e.target.closest("a.page-link")) e.stopPropagation(); };
  document.addEventListener("click", keepToLink, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Enter") keepToLink(e); }, true);

  window.PageLink = { href, html };
})();
