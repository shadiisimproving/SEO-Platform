/* Filter a SEMrush or Ubersuggest backlinks CSV into a list of prospects.
   Browser copy of seo/backlinks/cleaner.py: tests/test_backlink_cleaner.py checks both give the same result.
   It only reads a file: no API calls, no scraping, no ranking checks, no link tracking. Nothing is stored here. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BacklinkCleaner = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
  const SPAM_THRESHOLD = 30;
  /* One spam line everywhere (SEO review 2026-11-17, B5): a score ABOVE 30 is spam, 30 itself is not, as on the server (cleaner.is_spam_score). */
  const isSpamScore = (score) => score !== null && score !== undefined && score !== "" && Number(score) > SPAM_THRESHOLD;
  const ALLOWED_EXTENSIONS = /\.(csv|tsv|txt)$/i;

  const COLUMN_ALIASES = {
    backlink_url: ["source url", "source page url", "url from", "referring page url", "referring url", "page url", "url", "source"],
    domain: ["source domain", "domain from", "referring domain", "root domain", "domain"],
    authority: ["domain authority", "domain rating", "authority score", "da", "dr", "as", "domain score"],
    page_authority: ["page authority", "page ascore", "pa", "page score", "url rating", "ur"],
    spam_score: ["spam score", "toxic score", "spam", "ts"],
  };
  const REQUIRED = ["backlink_url", "spam_score"];
  const REQUIRED_WORDS = { backlink_url: "URL", spam_score: "spam score" };
  const FORMAT_HINTS = {
    semrush: ["toxic score", "authority score", "source url", "source title"],
    ubersuggest: ["domain authority", "spam score", "page authority"],
  };
  const SOURCE_LABELS = { semrush: "SEMrush", ubersuggest: "Ubersuggest", unknown: "CSV" };

  const MULTI_SUFFIXES = [
    "co.uk", "org.uk", "ac.uk", "gov.uk", "net.uk", "me.uk", "ltd.uk", "plc.uk",
    "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au",
    "co.nz", "net.nz", "org.nz", "ac.nz", "govt.nz",
    "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp", "ad.jp", "ed.jp",
    "co.kr", "or.kr", "go.kr", "ne.kr",
    "co.in", "net.in", "org.in", "gov.in", "ac.in",
    "co.za", "net.za", "org.za", "ac.za", "gov.za",
    "co.il", "net.il", "org.il", "ac.il", "gov.il",
    "com.br", "net.br", "org.br", "gov.br",
    "com.mx", "net.mx", "org.mx", "gob.mx",
    "com.ar", "net.ar", "org.ar", "gob.ar",
    "com.tr", "net.tr", "org.tr", "gov.tr",
    "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
    "com.hk", "net.hk", "org.hk",
    "com.sg", "net.sg", "org.sg",
    "com.my", "net.my", "org.my",
    "com.ph", "net.ph", "org.ph",
    "com.pk", "net.pk", "org.pk",
    "com.eg", "net.eg", "org.eg",
    "com.sa", "net.sa", "org.sa",
    "com.tw", "net.tw", "org.tw",
    "com.ae", "co.ae", "net.ae", "org.ae", "gov.ae", "ac.ae", "sch.ae",
    "com.qa", "net.qa", "org.qa", "gov.qa", "com.kw", "org.kw", "com.om", "co.om", "com.bh", "org.bh",
    "co.ma", "net.ma", "org.ma", "gov.ma", "com.tn", "org.tn", "com.dz", "org.dz",
    "gouv.fr", "asso.fr", "nom.fr", "com.fr", "tm.fr",
  ];
  const SUFFIX_SET = new Set(MULTI_SUFFIXES);

  const HOST_CHARS = /^[^\s/?#@:\\<>"'`,;()[\]{}|]+$/;
  const OTHER_SCHEME = /^(mailto|javascript|data|tel|ftp|file):/i;
  const NUMBER = /^\d+(\.\d+)?$/;
  const DECIMAL_COMMA = /^\d+,\d+$/;
  const SEP_LINE = /^sep=(.)$/i;
  const SEP_CELL = /^"?sep=.?"?[,;\t]*$/i; // the same line kept in a first cell: Google Sheets exports sep=;,,,,

  class CleanerError extends Error {
    constructor(code, message, missing = [], headers = []) {
      super(message);
      this.code = code;
      this.missing = missing;
      this.headers = headers;
    }
  }

  function checkUpload(filename, size) {
    if (!ALLOWED_EXTENSIONS.test(filename)) throw new CleanerError("not_csv", "The file must be a .csv.");
    if (size > UPLOAD_MAX_BYTES) throw new CleanerError("too_large", `The file is too large. The limit is ${UPLOAD_MAX_BYTES / (1024 * 1024)} MB.`);
  }

  function decodeCsv(bytes) {
    if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
      return new TextDecoder(bytes[0] === 0xff ? "utf-16le" : "utf-16be").decode(bytes);
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes); // also strips the BOM Excel adds
    } catch {
      return new TextDecoder("windows-1252").decode(bytes);
    }
  }

  function delimiterOf(line) {
    const counts = { ",": 0, ";": 0, "\t": 0 };
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch in counts) counts[ch] += 1;
    }
    let best = ",";
    for (const d of [",", ";", "\t"]) if (counts[d] > counts[best]) best = d; // a tie goes to the comma
    return best;
  }

  function parseTable(input) {
    let text = input;
    const lineEnd = text.match(/\r\n|\r|\n/);
    const firstLine = lineEnd ? text.slice(0, lineEnd.index) : text;
    const sepLine = firstLine.trim().match(SEP_LINE);
    let delimiter;
    if (sepLine || SEP_CELL.test(firstLine.trim())) {
      text = lineEnd ? text.slice(lineEnd.index + lineEnd[0].length) : "";
      const nextLine = text.split(/\r\n|\r|\n/).find((line) => line.trim()) || "";
      // What the line says only counts if the file really uses it. A spreadsheet may have saved it with another separator.
      delimiter = sepLine && nextLine.includes(sepLine[1]) ? sepLine[1] : delimiterOf(nextLine);
    } else delimiter = delimiterOf(firstLine);

    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
        } else cell += ch;
      } else if (ch === '"' && !cell) quoted = true;
      else if (ch === delimiter) { row.push(cell); cell = ""; } else if (ch === "\r" || ch === "\n") {
        if (ch === "\r" && text[i + 1] === "\n") i += 1;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  }

  const normalizeHeader = (header) => header.trim().toLowerCase().replace(/\s+/g, " ");

  function detectColumns(headers, required = REQUIRED) {
    const positions = new Map();
    headers.forEach((h, i) => { const key = normalizeHeader(h); if (!positions.has(key)) positions.set(key, i); });
    const mapping = {};
    for (const [logical, aliases] of Object.entries(COLUMN_ALIASES)) {
      const hit = aliases.find((alias) => positions.has(alias));
      if (hit !== undefined) mapping[logical] = positions.get(hit);
    }
    const missing = required.filter((name) => !(name in mapping));
    if (missing.length) {
      const words = missing.map((name) => REQUIRED_WORDS[name]).join(" and ");
      throw new CleanerError("missing_columns", `This CSV has no ${words} ${missing.length > 1 ? "columns" : "column"}. Headers found: ${headers.join(", ")}.`, missing, headers);
    }
    return mapping;
  }

  function detectFormat(headers) {
    const lowered = new Set(headers.map(normalizeHeader));
    let bestScore = 0, best = "unknown";
    for (const [name, hints] of Object.entries(FORMAT_HINTS)) {
      const score = hints.filter((hint) => lowered.has(hint)).length;
      if (score > bestScore) { bestScore = score; best = name; }
    }
    return best;
  }

  function parseNumber(raw) {
    let text = raw.trim().replace(/%/g, "").trim();
    if (DECIMAL_COMMA.test(text)) text = text.replace(",", ".");
    if (!NUMBER.test(text)) return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  }
  // A blank or unreadable score is unknown. It must never read as 0.
  const parseSpam = parseNumber;
  const parseAuthority = (raw) => { const value = parseNumber(raw); return value === null ? null : Math.floor(value + 0.5); };

  function hostname(value) {
    const raw = (value || "").trim();
    if (!raw) return "";
    let rest;
    if (raw.includes("://")) {
      const at = raw.indexOf("://");
      if (!["http", "https"].includes(raw.slice(0, at).toLowerCase())) return "";
      rest = raw.slice(at + 3);
    } else if (raw.startsWith("//")) rest = raw.slice(2);
    else if (OTHER_SCHEME.test(raw)) return "";
    else rest = raw;
    let host = rest.split(/[/?#]/, 1)[0];
    host = host.slice(host.lastIndexOf("@") + 1);
    host = host.replace(/:\d*$/, "");
    host = host.toLowerCase().replace(/\.+$/, "");
    return host.startsWith("www.") ? host.slice(4) : host;
  }

  function usableHost(host) {
    if (!host || !host.includes(".") || !HOST_CHARS.test(host)) return false;
    const labels = host.split(".");
    if (labels.some((label) => !label || label.startsWith("-") || label.endsWith("-"))) return false;
    const last = labels[labels.length - 1];
    return last.length >= 2 && !/^\d+$/.test(last);
  }

  // The same pattern holds in most countries, so an ending nobody listed still works.
  const GENERIC_SECOND_LEVEL = new Set(["com", "co", "net", "org", "edu", "gov", "ac", "gob", "gouv", "mil"]);
  function isSuffix(name) {
    if (SUFFIX_SET.has(name)) return true;
    const labels = name.split(".");
    return labels.length === 2 && labels[1].length === 2 && /^[a-z0-9-]+$/.test(labels[1]) && GENERIC_SECOND_LEVEL.has(labels[0]);
  }

  // Shared hosting platforms: each subdomain is someone else's site (F105). Keep in step with PLATFORM_SUFFIXES in seo/backlinks/cleaner.py.
  const PLATFORM_SUFFIXES = [
    "blogspot.com", "blogspot.fr", "blogspot.co.uk", "blogspot.be", "blogspot.ca", "blogspot.ch", "blogspot.de", "blogspot.es", "blogspot.it",
    "blogspot.com.au", "wordpress.com", "wpcomstaging.com", "tumblr.com", "medium.com", "substack.com", "ghost.io", "livejournal.com", "typepad.com",
    "wixsite.com", "weebly.com", "weeblysite.com", "squarespace.com", "webflow.io", "jimdofree.com", "jimdosite.com", "jimdo.com", "strikingly.com",
    "mystrikingly.com", "carrd.co", "godaddysites.com", "site123.me", "simplesite.com", "webnode.fr", "webnode.com", "github.io", "gitlab.io",
    "netlify.app", "vercel.app", "pages.dev", "workers.dev", "herokuapp.com", "onrender.com", "fly.dev", "firebaseapp.com", "web.app", "appspot.com",
    "azurewebsites.net", "cloudfront.net", "glitch.me", "neocities.org", "myshopify.com", "square.site", "over-blog.com", "overblog.com",
    "canalblog.com", "hautetfort.com", "e-monsite.com", "unblog.fr", "eklablog.com", "skyrock.com", "wifeo.com", "centerblog.net", "blog4ever.com",
    "free.fr", "pagesperso-orange.fr", "forumactif.com", "forumactif.org", "forumgratuit.org", "xooit.fr"
  ];
  // Endings that are also a real website when nothing comes before them: www.gov.uk is a site, co.uk is not.
  const SITE_SUFFIXES = new Set(["gov.uk", "gouv.fr", "govt.nz"]);

  function rootDomain(value) {
    const host = hostname(value);
    if (!usableHost(host)) return "";
    const labels = host.split(".");
    const platform = PLATFORM_SUFFIXES.find((p) => host.endsWith(`.${p}`));
    if (platform) return labels.slice(-(platform.split(".").length + 1)).join(".");
    if (SITE_SUFFIXES.has(host)) return host;
    if (isSuffix(host)) return "";
    if (labels.length >= 3 && isSuffix(labels.slice(-2).join("."))) return labels.slice(-3).join(".");
    return labels.slice(-2).join(".");
  }

  function fullUrl(value) {
    const raw = value.trim();
    if (raw.includes("://")) return raw;
    if (raw.startsWith("//")) return `https:${raw}`;
    return `https://${raw}`;
  }

  // Filter one file. `known` maps root domains already in use to where they are. It is only read.
  // With needSpam false a file of links to a competitor is accepted without a spam score, and a domain column can stand in for the URL, as on the server.
  function cleanCsv(bytes, known = new Map(), { needSpam = true, keepSpam = false, urlColumn = null } = {}) {
    const rows = parseTable(decodeCsv(bytes));
    if (!rows.length) throw new CleanerError("empty", "Empty file.");
    const headers = rows[0].map((h) => h.trim());
    const mapping = detectColumns(headers, needSpam ? REQUIRED : []);
    if (urlColumn !== null) mapping.backlink_url = urlColumn; // the person said which one it is
    if (!needSpam && mapping.backlink_url === undefined) {
      if (mapping.domain === undefined) throw new CleanerError("missing_columns", `This CSV has no URL or domain column. Headers found: ${headers.join(", ")}.`, ["backlink_url"], headers);
      mapping.backlink_url = mapping.domain;
    }
    const sourceFormat = detectFormat(headers);
    const sourceLabel = SOURCE_LABELS[sourceFormat];
    const authorityAt = mapping.authority;
    const pageAuthorityAt = mapping.page_authority;
    const authorityLabel = authorityAt === undefined ? null : `${headers[authorityAt]} (${sourceLabel})`;
    const cell = (r, i) => (i < r.length ? r[i] : "");

    const dataRows = rows.slice(1);
    if (!dataRows.length) throw new CleanerError("no_rows", "Only headers, no data rows.");

    const seenInFile = new Set();
    const kept = [];
    let removedSpam = 0, removedNoUrl = 0, duplicates = 0, unknownSpam = 0;
    for (const r of dataRows) {
      const spam = parseSpam(cell(r, mapping.spam_score));
      if (isSpamScore(spam)) { removedSpam += 1; if (!keepSpam) continue; }
      const url = cell(r, mapping.backlink_url).trim();
      const domain = rootDomain(url);
      if (!domain) { removedNoUrl += 1; continue; }
      const duplicateOf = known.get(domain) || (seenInFile.has(domain) ? "file" : null);
      if (duplicateOf) duplicates += 1;
      seenInFile.add(domain);
      if (spam === null) unknownSpam += 1;
      kept.push({
        url: fullUrl(url),
        domain,
        authority: authorityAt === undefined ? null : parseAuthority(cell(r, authorityAt)),
        spam_score: spam,
        page_authority: pageAuthorityAt === undefined ? null : parseAuthority(cell(r, pageAuthorityAt)),
        duplicate_of: duplicateOf,
      });
    }

    return {
      source_format: sourceFormat,
      source_label: sourceLabel,
      authority_label: authorityLabel,
      headers,
      total: dataRows.length,
      kept: kept.length,
      removed: removedSpam + removedNoUrl,
      removed_spam: removedSpam,
      removed_no_url: removedNoUrl,
      duplicates,
      unknown_spam: unknownSpam,
      rows: kept,
    };
  }

  /* Whose scale a score is on, as one key: "Authority Score (SEMrush)" and a typed "SEMrush" are both "semrush". A plain CSV
     says nothing about its tool, so its column name is the scale. Copy of cleaner.scale_of. Scores of two scales never sort
     as one (SEO review 2026-11-17, #7). */
  function scaleOf(label) {
    const raw = String(label || "").trim();
    const m = raw.match(/\(([^)]+)\)/);
    const tool = m && m[1].trim().toLowerCase() !== "csv" ? m[1].trim() : raw;
    return tool.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  }
  /* Each scale's place in a sort: the one most rows use first (0), ties A to Z. Copy of cleaner.scale_ranks. */
  function scaleRanks(labels) {
    const counts = new Map();
    labels.forEach((label) => { const key = scaleOf(label); counts.set(key, (counts.get(key) || 0) + 1); });
    return new Map([...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || (a < b ? -1 : a > b ? 1 : 0)).map((key, i) => [key, i]));
  }
  /* A sort value that is a [group, value] pair: the group always ascending (the leading tool first, whichever way the column
     is sorted), the value in the column's direction. Returns null when x and y aren't both pairs. */
  function compareScored(x, y, dir) {
    if (!Array.isArray(x) || !Array.isArray(y)) return null;
    return x[0] !== y[0] ? x[0] - y[0] : (x[1] - y[1]) * dir;
  }

  return { UPLOAD_MAX_BYTES, SPAM_THRESHOLD, isSpamScore, MULTI_SUFFIXES, CleanerError, checkUpload, cleanCsv, rootDomain, decodeCsv, parseTable, scaleOf, scaleRanks, compareScored };
});
