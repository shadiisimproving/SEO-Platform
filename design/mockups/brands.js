/* A brand's logo beside its name, everywhere the name appears on screen.
   It works on the text as rendered, so a new sentence, a translation, a toast or a tooltip gets its logo with nothing to remember.
   Add a brand here and its logo to logos/. Longest names win, so "Google Ads" never gets the plain Google logo. */
(() => {
  const FILES = {
    "Google Search Console": "searchconsole.png", "Search Console": "searchconsole.png",
    "Google Analytics": "analytics.svg", GA4: "analytics.svg",
    "Google Ads": "googleads.svg",
    "Google Sheets": "googlesheets.png", "Google Sheet": "googlesheets.png",
    "Google Cloud Console": "googlecloud.svg", "Google Cloud": "googlecloud.svg",
    "PageSpeed Insights": "pagespeed.png", PageSpeed: "pagespeed.png",
    "OAuth 2.0 Playground": "google.svg", Google: "google.svg",
    Lighthouse: "lighthouse.svg",
    Bing: "bing.svg", Yandex: "yandex.png", DuckDuckGo: "duckduckgo.png",
    "Microsoft Clarity": "clarity.png", Clarity: "clarity.png",
    "Bright Data": "brightdata.png", SerpApi: "serpapi.png", HasData: "hasdata.png", Searlo: "searlo.png", SearXNG: "searxng.svg", "Open PageRank": "openpagerank.png", "Keywords Everywhere": "openpagerank.png",
    OpenRouter: "openrouter.png", Moz: "moz.png", Ahrefs: "ahrefs.png", Cloudflare: "cloudflare.png", "Common Crawl": "commoncrawl.jpg", IndexNow: "indexnow.png",
    SEMrush: "semrush.png", Ubersuggest: "ubersuggest.svg", Excel: "excel.svg", Mac: "apple.svg",
  };
  const quoted = Object.keys(FILES).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Whole names only, and not part of an address: "Bing," yes, "Excellent" and "Bing.com" no. Capitals matter: "clarity" is a word.
  const NAME = new RegExp(`(?<![\\p{L}\\p{N}_.@/-])(?:${quoted.join("|")})(?![\\p{L}\\p{N}_-]|\\.[a-z])`, "gu");

  // Keywords, addresses and anything typed or read from another site (those carry dir="auto") are the user's words, not our mention of a brand.
  const LEAVE = 'input, textarea, select, option, script, style, code, pre, svg, .mono, [dir="auto"], .brand-mention';

  const hasName = (text) => { NAME.lastIndex = 0; return NAME.test(text); };

  // A row that already leads with this logo, such as a tool's name in Settings, doesn't need it twice.
  function alreadyBeside(node, file) {
    let el = node.parentElement;
    for (let up = 0; el && up < 3; up += 1, el = el.parentElement) {
      for (const child of el.children) if (child.matches("img.logo") && child.getAttribute("src")?.endsWith(`/${file}`)) return true;
    }
    return false;
  }

  function markText(node) {
    const text = node.data;
    const out = document.createDocumentFragment();
    let from = 0, changed = false;
    NAME.lastIndex = 0;
    for (const hit of text.matchAll(NAME)) {
      const file = FILES[hit[0]];
      if (alreadyBeside(node, file)) continue;
      out.append(text.slice(from, hit.index));
      const brand = document.createElement("span");
      brand.className = "brand-mention";
      const img = document.createElement("img");
      img.className = "logo brand-logo";
      img.src = `logos/${file}`;
      img.alt = ""; // the name is right beside it
      brand.append(img, hit[0]);
      out.append(brand);
      from = hit.index + hit[0].length;
      changed = true;
    }
    if (!changed) return;
    out.append(text.slice(from));
    node.replaceWith(out);
  }

  function mark(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      if (root.parentElement && hasName(root.data) && !root.parentElement.closest(LEAVE)) markText(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.closest?.(LEAVE)) return;
    const found = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const node = walk.currentNode;
      if (node.parentElement && hasName(node.data) && !node.parentElement.closest(LEAVE)) found.push(node);
    }
    found.forEach(markText);
  }

  window.BRANDS = { mark, hasName, LEAVE };

  // Most screens get here earlier, through fragment() in mockup.js. This catches text set any other way.
  new MutationObserver((changes) => {
    for (const change of changes) for (const added of change.addedNodes) if (added.isConnected) mark(added);
  }).observe(document.body, { childList: true, subtree: true });
})();
