/* Bulk upload of backlinks: the template, matching a file's columns, and checking its rows. There's no screen in here.
   The page loads it before mockup.js, and tests/js/bulk_links.cjs runs the same code from the Python tests.
   seo/backlinks/service.py has the server's copy of the status words, limits and price reading. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./cleaner.js"));
  else root.BulkLinks = factory(root.BacklinkCleaner);
})(typeof self !== "undefined" ? self : this, function (cleaner) {
  "use strict";

  // [field, the template's column, other names for it, what to look for when no name matches]. In the template's order.
  const FIELDS = [
    ["site", "Our site", ["notre site", "site", "my site", "mon site", "website", "site web", "client site", "site client"], /\b(our|my|notre|mon)\b.*\bsite\b/],
    ["src", "Source page", ["source", "source url", "source link", "page source", "url source", "url", "page", "page url", "link", "lien", "backlink", "backlink url", "referring page", "referring url", "referring page url", "from", "url from"], /source|backlink|referr|\bfrom\b|^url\b|\burl$|^link$|^lien$/],
    ["target", "Target page", ["target", "target url", "page cible", "cible", "url cible", "landing page", "destination", "destination url", "to", "url to", "our page", "page de destination"], /target|cible|destination|landing/],
    ["anchor", "Anchor text", ["anchor", "ancre", "texte d ancre", "texte de l ancre", "texte ancre"], /anchor|ancre/],
    ["anchor_kind", "Anchor type", ["type d ancre", "type de l ancre", "type ancre", "anchor kind", "type of anchor", "anchor category"], /(anchor|ancre).*(type|kind)|(type|kind).*(anchor|ancre)/],
    ["keyword", "Keyword", ["mot cle", "mots cles", "mot cle cible", "target keyword", "focus keyword", "keywords", "requete", "requete cible"], /keyword|mots? cles?/],
    ["link_type", "Link type", ["type", "type de lien", "kind"], /\btype\b/],
    ["status", "Status", ["statut", "etat", "state"], /status|statut|\betat\b/],
    ["placed", "Date placed", ["date", "placed", "placed on", "date de pose", "date de placement", "date de mise en ligne", "publication date", "date de publication", "live date"], /\bdate\b|\bplaced?\b|publi/],
    ["due", "Due date", ["due", "echeance", "date d echeance", "date limite", "deadline"], /\bdue\b|echeance|deadline|limite/],
    ["renewal", "Renewal date", ["renewal", "renew", "renouvellement", "date de renouvellement", "expiry", "expires", "expiration", "date d expiration"], /renew|renouv|expir/],
    ["cost", "Price", ["prix", "cost", "cout", "tarif", "amount", "montant", "budget", "fee"], /price|prix|cost|\bcout\b|tarif|montant|amount/],
    ["mediator", "Mediator", ["mediateur", "intermediaire", "agency", "agence", "vendor", "fournisseur", "seller", "broker"], /mediat|intermedi|agenc|vendor|fournisseur|seller|broker/],
    ["contact", "Contact", ["email", "e mail", "mail", "phone", "telephone", "whatsapp"], /contact|e ?mail|telephone|phone|whatsapp/],
    ["platform", "Platform", ["plateforme", "marketplace", "market place"], /platform|plateforme|marketplace/],
    ["utm_source", "UTM source", ["source utm", "utmsource"], /utm\s?source|source utm/],
    ["utm_medium", "UTM medium", ["medium", "support utm", "medium utm", "utmmedium"], /utm\s?medium|support utm|medium utm/],
    ["utm_campaign", "UTM campaign", ["campaign", "campagne", "campagne utm", "campaign utm", "utmcampaign"], /utm\s?campaign|campagne utm|campaign utm/],
    ["owner", "Owner", ["responsable", "proprietaire", "assigned to", "assigne a"], /owner|responsable|propriet/],
    ["notes", "Notes", ["note", "comment", "comments", "commentaire", "commentaires", "remarque", "remarques"], /note|comment|remarque/],
  ];
  // Most specific first: "UTM source" before "source", "Renewal date" before "date", "Mediator contact" before "mediator".
  const MOST_SPECIFIC = ["utm_source", "utm_medium", "utm_campaign", "renewal", "due", "anchor_kind", "keyword", "link_type", "status", "placed", "anchor", "cost", "contact", "platform", "mediator", "owner", "notes", "site", "target", "src"].map((key) => FIELDS.find(([field]) => field === key));
  const SCREEN_WORDS = {};
  const labelOf = (key) => SCREEN_WORDS[key] || FIELDS.find(([field]) => field === key)[1];

  // ---- the template ---------------------------------------------------------------------------
  const TEMPLATE_COLUMNS = FIELDS.map(([, label]) => label);
  // Left in by mistake, these two must never count as real links. The server knows them too.
  const EXAMPLE_ROWS = [
    ["your-site.example", "https://example-blog.example/article", "/your-page/", "your anchor text", "Partial keyword", "your keyword", "Guest post", "Live", "2026-01-15", "", "2027-01-15", "$150", "Example Agency", "sales@example-agency.example", "Example Marketplace", "example-blog", "backlink", "bl-101", "Alex", "Example row: delete it before you upload"],
    ["your-site.example", "https://example-directory.example/listing/123", "/", "Your Company", "Brand", "", "Directory", "Planned", "", "2026-12-01", "", "AED 500", "", "+971 50 000 0000", "", "", "", "", "Sam", "Example row: delete it before you upload"],
  ];
  const EXAMPLE_SOURCES = EXAMPLE_ROWS.map((row) => row[1]);
  // Commas, as Excel expects on the owner's Mac (English, UAE). A "sep=" first line would make Excel ignore the UTF-8 mark and garble accents.
  const templateCell = (cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  const TEMPLATE_TEXT = `${[TEMPLATE_COLUMNS, ...EXAMPLE_ROWS].map((row) => row.map(templateCell).join(",")).join("\r\n")}\r\n`;

  // ---- reading a file ---------------------------------------------------------------------------
  const decode = (bytes) => cleaner.decodeCsv(bytes);
  /* Commas, semicolons (French Excel), tabs (cells copied from a sheet), quoted text, and the sep line wherever a spreadsheet left it. */
  const readTable = (text) => cleaner.parseTable(String(text).replace(/^﻿/, "")).map((row) => row.map((cell) => cell.trim()));

  const plain = (text) => String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

  /* The exact name first, then another known name, then what it looks like. A column that looks like a field already taken stays unmatched, so the order of the columns never changes the result. */
  function matchColumns(headers) {
    const names = headers.map(plain);
    const map = headers.map(() => "");
    const taken = new Set();
    const give = (at, key) => { map[at] = key; taken.add(key); };
    FIELDS.forEach(([key, label]) => {
      const at = names.indexOf(plain(label));
      if (at >= 0) give(at, key);
    });
    FIELDS.forEach(([key, , aliases]) => {
      if (taken.has(key)) return;
      const at = names.findIndex((name, i) => !map[i] && aliases.includes(name));
      if (at >= 0) give(at, key);
    });
    names.forEach((name, i) => {
      if (map[i] || !name) return;
      const hit = MOST_SPECIFIC.find(([, , , look]) => look.test(name));
      if (hit && !taken.has(hit[0])) give(i, hit[0]);
    });
    return map;
  }

  const looksLikeHeader = (row) => !/^[^\s/]+\.[a-z]{2,}(\/|$)/i.test(row[0] || "") && !row.some((cell) => /^(https?:\/\/|www\.)/i.test(cell)) && matchColumns(row).some(Boolean);

  // ---- status, site and page ---------------------------------------------------------------------
  const STATUS_WORDS = new Map([
    ["", "live"], ["live", "live"], ["active", "live"], ["actif", "live"], ["en ligne", "live"],
    ["lost", "lost"], ["perdu", "lost"], ["perdue", "lost"],
    ["planned", "planned"], ["pending", "planned"], ["prevu", "planned"], ["prevue", "planned"], ["en attente", "planned"],
  ]);
  const statusOf = (word) => STATUS_WORDS.get(String(word ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ")) ?? null;

  // An anchor type in the words people use. seo/backlinks/service.py has the server's copy. Empty or "automatic" lets the app work it out.
  const ANCHOR_WORDS = new Map([
    ["", null], ["auto", null], ["automatic", null], ["automatique", null],
    ["brand", "brand"], ["branding", "brand"], ["brand name", "brand"], ["marque", "brand"], ["nom de marque", "brand"],
    ["url", "url"], ["bare url", "url"], ["naked url", "url"], ["url nue", "url"], ["adresse", "url"],
    ["exact", "exact"], ["exact keyword", "exact"], ["exact match", "exact"], ["optimisee", "exact"], ["optimise", "exact"], ["mot cle exact", "exact"],
    ["partial", "partial"], ["partial keyword", "partial"], ["partial match", "partial"], ["semi optimisee", "partial"], ["semi optimise", "partial"], ["partielle", "partial"],
    ["generic", "generic"], ["generique", "generic"], ["other", "other"], ["autre", "other"],
    ["brand kw", "brand_kw"], ["brand keyword", "brand_kw"], ["exact match domain", "brand_kw"], ["marque mot cle", "brand_kw"],
  ]);
  /* "brand", "exact"... null to work it out, undefined when the word isn't known. */
  const anchorKindOf = (word) => ANCHOR_WORDS.get(plain(word));

  /* A site's address, whichever way it's written: with or without https, www or a trailing slash. */
  function siteKey(value) {
    const host = String(value ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/^www\./, "");
    if (!host || host.includes("/")) return host;
    try { return new URL(`https://${host}`).hostname; } catch { return host; }
  }

  const TRACKING = new Set(["gclid", "gbraid", "wbraid", "dclid", "fbclid", "msclkid", "yclid", "igshid", "mc_cid", "mc_eid", "_ga", "_gl", "ref_src"]);
  /* One page, however it's spelled: http or https, www or not, a trailing slash, tracking parameters. */
  function sourceKey(address) {
    const raw = String(address ?? "").trim();
    let url;
    try { url = new URL(raw); } catch { return raw.replace(/\/+$/, ""); }
    const kept = [...url.searchParams].filter(([name]) => !name.toLowerCase().startsWith("utm_") && !TRACKING.has(name.toLowerCase())).sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1));
    let path = url.pathname;
    try { path = decodeURI(path); } catch { /* it stays as it is */ }
    return `${url.host.replace(/^www\./, "")}${path}${kept.length ? `?${new URLSearchParams(kept)}` : ""}`.replace(/\/+$/, "");
  }
  const EXAMPLE_KEYS = new Set(EXAMPLE_SOURCES.map(sourceKey));

  // ---- prices -------------------------------------------------------------------------------------
  const MONEY_MARK = "(?:us\\$|usd|\\$|dollars?|aed|dirhams?|dhs?|د\\.إ\\.?|euros?|eur|€|gbp|£)";
  const MARK_FIRST = new RegExp(`^${MONEY_MARK}\\s*`), MARK_LAST = new RegExp(`\\s*${MONEY_MARK}$`);
  const THOUSANDS = { ",": /^\d{1,3}(?:,\d{3})*$/, ".": /^\d{1,3}(?:\.\d{3})*$/ };
  const MAX_COST = 9999999999.99;

  function plainNumber(value) {
    const commas = value.split(",").length - 1, dots = value.split(".").length - 1;
    if (commas && dots) { // the last one is the decimal mark, the other groups thousands: 1.500,50 or 1,500.50
      const mark = value.lastIndexOf(",") > value.lastIndexOf(".") ? "," : ".";
      const other = mark === "," ? "." : ",";
      const at = value.lastIndexOf(mark);
      const whole = value.slice(0, at), part = value.slice(at + 1);
      return part && THOUSANDS[other].test(whole) ? `${whole.split(other).join("")}.${part}` : null;
    }
    if (!commas && !dots) return value;
    const mark = commas ? "," : ".";
    if (commas + dots > 1) return THOUSANDS[mark].test(value) ? value.split(mark).join("") : null; // 1,500,000
    const [whole, part] = value.split(mark);
    if (part.length === 3 && whole.length <= 3 && !whole.startsWith("0")) return whole + part; // 1,500 and 1.500 are thousands: nobody prices in tenths of a cent
    return part ? `${whole}.${part}` : null;
  }

  /* The number in a price however it's typed: 1 500, 1,500, 1.500,50, $150, 150 €, AED 500. Null if there isn't one. */
  function parsePrice(raw) {
    let value = String(raw ?? "").trim().toLowerCase().replace(MARK_FIRST, "").replace(MARK_LAST, "").trim();
    if (/^\d{1,3}(?:[\s']\d{3})+(?:[.,]\d+)?$/.test(value)) value = value.replace(/[\s']/g, "");
    if (!/^\d[\d.,]*$/.test(value)) return null;
    const number = plainNumber(value);
    if (number === null) return null;
    const amount = Math.round(Number(number) * 100) / 100;
    return amount <= MAX_COST ? amount : null;
  }

  /* Which currency a price is in, when it says. Costs can be in AED, EUR or USD, so they're never added up together. */
  function currencyOf(text) {
    const value = String(text ?? "").toLowerCase();
    if (parsePrice(value) === null) return "";
    if (/aed|dirham|dh|د\.إ/.test(value)) return "AED";
    if (/usd|\$|dollar/.test(value)) return "USD";
    if (/eur|€/.test(value)) return "EUR";
    if (/gbp|£/.test(value)) return "GBP";
    return "";
  }

  // ---- checking the rows of a file --------------------------------------------------------------------
  const MAX_ROWS = 5000;
  const MAX_ADDRESS = 2048;
  const LIMITS = { target: 2048, anchor: 1000, link_type: 100, placed: 60, due: 60, renewal: 60, cost: 60, mediator: 180, contact: 250, platform: 180, utm_source: 180, utm_medium: 180, utm_campaign: 180, owner: 100, notes: 5000, keyword: 250 };

  /* 31/02/2026 can't be a day whichever way round it's read. Anything not written as numbers ("le 3 mars") is left alone. */
  const MONTHS = { jan: 1, january: 1, janvier: 1, janv: 1, feb: 2, february: 2, fev: 2, fevrier: 2, mar: 3, march: 3, mars: 3, apr: 4, april: 4, avr: 4, avril: 4, may: 5, mai: 5, jun: 6, june: 6, juin: 6, jul: 7, july: 7, juil: 7, juillet: 7, aug: 8, august: 8, aou: 8, aout: 8, sep: 9, sept: 9, september: 9, septembre: 9, oct: 10, october: 10, octobre: 10, nov: 11, november: 11, novembre: 11, dec: 12, december: 12, decembre: 12 };
  const realDay = (y, m, d) => { const day = new Date(y, m - 1, d); return day.getFullYear() === y && day.getMonth() === m - 1 && day.getDate() === d; };
  const isoOf = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  /* What a date cell says. { iso } when it's a real day, { ambiguous } when the file has to say which comes first,
     { odd } when it can't be read as a date at all, and { noYear } when it's a date with no year, which stays as typed. */
  function readDate(value, dayFirst = true) {
    const text = String(value || "").trim();
    if (!text) return {};
    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) return realDay(+iso[1], +iso[2], +iso[3]) ? { iso: isoOf(+iso[1], +iso[2], +iso[3]) } : { odd: true };
    const num = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
    if (num) {
      const a = +num[1], b = +num[2], y = num[3].length === 2 ? 2000 + +num[3] : +num[3];
      const ambiguous = a <= 12 && b <= 12 && a !== b;
      const [d, m] = a > 12 ? [a, b] : b > 12 ? [b, a] : dayFirst ? [a, b] : [b, a];
      return realDay(y, m, d) ? { iso: isoOf(y, m, d), ambiguous } : { odd: true };
    }
    const plain = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\./g, "").replace(/^le\s+/, "");
    const dayName = plain.match(/^(\d{1,2})(?:er|st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?$/), nameDay = plain.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?$/);
    const [d, name, year] = dayName ? [+dayName[1], dayName[2], dayName[3]] : nameDay ? [+nameDay[2], nameDay[1], nameDay[3]] : [0, "", ""];
    const m = MONTHS[name];
    if (!m) return { odd: true };
    if (!year) return { noYear: true };
    return realDay(+year, m, d) ? { iso: isoOf(+year, m, d) } : { odd: true };
  }

  function impossibleDate(value) {
    const real = (y, m, d) => { const day = new Date(Number(y), Number(m) - 1, Number(d)); return day.getMonth() === Number(m) - 1 && day.getDate() === Number(d); };
    const iso = String(value || "").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) return !real(iso[1], iso[2], iso[3]);
    const other = String(value || "").trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    return Boolean(other) && !real(other[3], other[2], other[1]) && !real(other[3], other[1], other[2]);
  }

  /* Each row says ok, dup or bad, and why: `why` and `hint` are English sentences for the screen to translate, `detail` is what the row or file said. */
  function checkRows({ rows, map, sites, defaultSite, known, dayFirst = true }) {
    const own = new Map(sites.map((host) => [siteKey(host), host]));
    const logged = new Set(known.map(([host, src]) => `${siteKey(host)}|${sourceKey(src)}`));
    const seen = new Set();
    return rows.map((cells) => {
      const record = {};
      map.forEach((field, i) => { if (field) record[field] = (cells[i] || "").trim(); });
      let src = record.src || "", fixed = false;
      if (src && !/^https?:\/\//i.test(src) && /^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(src)) { src = `https://${src}`; fixed = true; }
      record.src = src;
      const site = record.site ? own.get(siteKey(record.site)) : defaultSite;
      const status = statusOf(record.status);
      const answer = (state, why, detail = "", hint = "") => ({ cells, record, state, why, detail, hint, site, status });
      if (EXAMPLE_KEYS.has(sourceKey(src))) return answer("bad", "Example row: delete it");
      if (!/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(src) || !cleaner.rootDomain(src)) return answer("bad", "Not a full address");
      if (record.site && !site) return answer("bad", "Not one of your sites", record.site);
      if (!site) return answer("bad", "Add your own website first");
      if (!status) return answer("bad", "Unknown status", record.status, "Use Live, Lost or Planned.");
      const anchorKind = anchorKindOf(record.anchor_kind);
      if (anchorKind === undefined) return answer("bad", "Unknown anchor type", record.anchor_kind, "Use Brand, Brand + keyword, Bare URL, Exact keyword, Partial keyword, Generic or Other.");
      record.anchor_kind = anchorKind || "";
      if (src.length > MAX_ADDRESS) return answer("bad", "Too long", "Source page");
      const tooLong = Object.keys(LIMITS).find((field) => (record[field] || "").length > LIMITS[field]);
      if (tooLong) return answer("bad", "Too long", labelOf(tooLong));
      const key = `${siteKey(site)}|${sourceKey(src)}`;
      if (logged.has(key)) return answer("dup", "Already logged");
      if (seen.has(key)) return answer("dup", "Twice in this file");
      seen.add(key); // only here: a row with a problem isn't imported, so it can't make a good one a duplicate
      // A readable date is kept as year-month-day, so nobody has to guess which month it means. One that can't be read
      // is still imported as typed, but it's pointed out, here and in the result.
      let oddDate = "", ambiguousDate = false;
      ["placed", "due", "renewal"].forEach((field) => {
        const read = readDate(record[field], dayFirst);
        if (read.iso) record[field] = read.iso;
        if (read.odd && !oddDate) oddDate = record[field];
        if (read.ambiguous) ambiguousDate = true;
      });
      return { ...answer("ok", fixed ? "https:// added" : "Ready"), oddDate, ambiguousDate };
    });
  }

  /* The address to give a mediator. Any UTM already in it is replaced, so one link never carries two sets. Values are case sensitive, so they stay exactly as given. */
  function taggedLink({ site, target, source, medium, campaign }) {
    const host = String(site || "").trim();
    if (!host) return { error: "Choose your site first" };
    const typed = String(target || "").trim() || "/";
    let url;
    try {
      if (/^https?:\/\//i.test(typed)) url = new URL(typed);
      else if (typed.startsWith("//")) url = new URL(`https:${typed}`);
      else if (/^[a-z][a-z0-9+.-]*:/i.test(typed)) return { error: "That target page isn't a web address" };
      else if (siteKey(typed.split("/")[0]) === siteKey(host)) url = new URL(`https://${typed}`);
      else url = new URL(typed.startsWith("/") ? typed : `/${typed}`, `https://${host}`);
    } catch { return { error: "That target page isn't a web address" }; }
    if (siteKey(url.hostname) !== siteKey(host)) return { error: "A tagged link must point at your own site." };
    [...url.searchParams.keys()].filter((name) => name.toLowerCase().startsWith("utm_")).forEach((name) => url.searchParams.delete(name));
    url.searchParams.set("utm_source", source);
    url.searchParams.set("utm_medium", medium);
    url.searchParams.set("utm_campaign", campaign);
    return { url: url.href };
  }

  if (typeof window !== "undefined" && window.FR) {
    Object.assign(window.FR, {
      "Link type": "Type de lien", "Planned": "Prévu", "planned": "prévus", "lost": "perdus", "Row check": "Vérification", "Status and type": "Statut et type",
      "1 planned": "1 prévu", "1 lost": "1 perdu", "1 ready": "1 prêt", "1 backlink added": "1 backlink ajouté", "Import 1 backlink": "Importer 1 backlink",
      "Guest post": "Article invité", "Directory": "Annuaire", "Press": "Presse", "Sponsored": "Sponsorisé", "Forum": "Forum", "Other": "Autre",
      "Site for rows without one": "Site des lignes qui n'en ont pas",
      "Example row: delete it": "Ligne d'exemple : supprimez-la", "Not one of your sites": "Pas un de vos sites", "Add your own website first": "Ajoutez d'abord votre site",
      "Unknown status": "Statut inconnu", "Unknown anchor type": "Type d'ancre inconnu",
      "Use Brand, Brand + keyword, Bare URL, Exact keyword, Partial keyword, Generic or Other.": "Utilisez Marque, Marque + mot-clé, URL nue, Mot-clé exact, Mot-clé partiel, Générique ou Autre.",
      "Keyword": "Mot-clé", "Anchor type": "Type d'ancre", "Use Live, Lost or Planned.": "Utilisez Actif, Perdu ou Prévu.", "Too long": "Trop long",
      "Skipped, already there": "Ignorés, déjà présents", "and": "et", "more": "de plus", "Nothing new": "Rien de nouveau", "Already logged. Removed from In consideration.": "Déjà enregistré. Retiré de « À l'étude ».",
      "Nothing found yet": "Rien de trouvé pour l'instant", "Links found by other tools show here until logged.": "Les liens trouvés par d'autres outils s'affichent ici jusqu'à leur saisie.",
      "Excel files aren't read. In Excel, Save as CSV UTF-8.": "Les fichiers Excel ne sont pas lus. Dans Excel, Enregistrer sous, CSV UTF-8.",
      "At most 5,000 rows per upload. Split the file and try again.": "5 000 lignes au maximum par import. Découpez le fichier et réessayez.",
      "This works from your own websites, not a competitor.": "Cela fonctionne depuis vos propres sites, pas depuis un concurrent.", "That website doesn't exist.": "Ce site n'existe pas.",
      "Not a web address.": "Ce n'est pas une adresse web.", "That web address is too long.": "Cette adresse web est trop longue.",
      "Send at least one row.": "Envoyez au moins une ligne.", "Every row needs a source page.": "Chaque ligne doit avoir une page source.", "That backlink doesn't exist.": "Ce backlink n'existe pas.",
      "Some links could not be removed": "Certains liens n'ont pas pu être retirés",
    });
  }

  return { taggedLink, FIELDS, TEMPLATE_COLUMNS, TEMPLATE_TEXT, EXAMPLE_SOURCES, MAX_ROWS, LIMITS, decode, readTable, matchColumns, readDate, looksLikeHeader, statusOf, anchorKindOf, siteKey, sourceKey, parsePrice, currencyOf, checkRows };
});
