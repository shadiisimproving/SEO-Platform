// Arabic, French and emoji on the screens (owner, 2026-11-17), and a competitor page that moved: Keywords, Overview's
// queries, the Competitors changes and a competitor's profile, desktop 1440 and phone 390, English and French.
// node tests/ui/flow_all_scripts.cjs <demo address>   after tests/ui/seed_all_scripts.py. Made-up sites only.
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = (process.argv[2] || "http://127.0.0.1:8297/").replace(/\/?$/, "/");
const OUT = path.resolve("var/ui-all-scripts") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
const ARABIC = "تأسيس شركة في دبي";

// Each element whose own text holds Arabic: its direction, whether its line box spills out of its cell, and the page width.
const arabicFacts = (word) => {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent.includes(word)) continue;
    const el = node.parentElement;
    if (!el || !el.offsetParent || el.closest("details:not([open]) > :not(summary)")) continue;  // hidden behind Details
    const range = document.createRange(); range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    const cell = el.closest("td, th, li, .cs-card, .tile, a") || el.parentElement;
    const c = cell.getBoundingClientRect();
    const dir = getComputedStyle(el).direction, bidi = getComputedStyle(el).unicodeBidi;
    // Read right to left: the first Arabic letter sits to the right of the last one.
    const first = document.createRange(); first.setStart(node, node.textContent.indexOf(word)); first.setEnd(node, node.textContent.indexOf(word) + 1);
    const last = document.createRange(); last.setStart(node, node.textContent.indexOf(word) + word.length - 1); last.setEnd(node, node.textContent.indexOf(word) + word.length);
    out.push({ tag: el.tagName, dir, bidi, rtl: first.getBoundingClientRect().left > last.getBoundingClientRect().left, spills: r.right > c.right + 2 || r.left < c.left - 2, text: node.textContent.trim().slice(0, 40) });
  }
  return { cells: out, wide: document.documentElement.scrollWidth > window.innerWidth + 1 };
};

async function shoot(page, name, label) {
  await page.waitForTimeout(1200);
  const facts = await page.evaluate(arabicFacts, ARABIC);
  await page.screenshot({ path: OUT + name + ".png", fullPage: false });
  check(`${label}: Arabic shown (${facts.cells.length})`, facts.cells.length > 0);
  check(`${label}: Arabic reads right to left`, facts.cells.length > 0 && facts.cells.every((c) => c.rtl), JSON.stringify(facts.cells.slice(0, 3)));
  check(`${label}: no Arabic text spills out of its cell, no sideways scroll`, facts.cells.every((c) => !c.spills) && !facts.wide, JSON.stringify(facts.cells.filter((c) => c.spills).slice(0, 2)));
  return facts;
}

(async () => {
  for (const [width, height, tag] of [[1440, 950, "desktop"], [390, 844, "phone"]]) {
    for (const lang of ["en", "fr"]) {
      const { browser, page, problems } = await open({ width, height });
      await page.goto(`${BASE}?simple=1#today`);
      await page.waitForTimeout(1500);
      await page.evaluate((l) => localStorage.setItem("seocc2-lang", l), lang);
      await page.reload(); await page.waitForTimeout(1200);
      const isFr = await page.evaluate(() => document.documentElement.lang === "fr");
      check(`${tag} ${lang}: language`, (lang === "fr") === isFr);
      const name = (s) => `${tag}-${lang}-${s}`;

      await page.goto(`${BASE}?simple=1#keywords?site=site-one.example`);
      await page.waitForSelector("table tbody tr", { timeout: 20000 }).catch(() => {});
      const search = await page.$('input[type="search"], input[placeholder*="earch"], input[placeholder*="echerch"]');
      if (search) { await search.fill("دبي"); await page.waitForTimeout(800); }
      await shoot(page, name("keywords"), `${tag} ${lang} Keywords`);

      await page.goto(`${BASE}?simple=1#overview?site=site-one.example`);
      await page.waitForTimeout(2500);
      const queriesTab = await page.$('[data-tab="queries"], [data-ov-tab="queries"], button:has-text("Queries"), button:has-text("Requêtes"), [role="tab"]:has-text("Queries"), [role="tab"]:has-text("Requêtes")');
      if (queriesTab) { await queriesTab.click(); await page.waitForTimeout(1500); }
      const qsearch = await page.$('input[type="search"]:visible, input[placeholder*="earch"]:visible, input[placeholder*="echerch"]:visible');
      if (qsearch) { await qsearch.fill("دبي"); await page.waitForTimeout(900); }
      await shoot(page, name("overview-queries"), `${tag} ${lang} Overview queries`);

      await page.goto(`${BASE}?simple=1#competitors/summary?site=site-one.example`);
      await page.waitForSelector("#cs-moves-list tbody tr", { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
      // Since 2026-11-20 Changes groups its rows beside my pages; a rival page beside none of mine sits in the folded
      // "On their other pages" group, so open it as a person would.
      const fold = await page.$('#cs-moves-list [data-rd-id="other"][aria-expanded="false"]');
      if (fold) { await fold.click(); await page.waitForTimeout(600); }
      await shoot(page, name("competitors-changes"), `${tag} ${lang} Competitors changes`);
      const moved = await page.evaluate(() => [...document.querySelectorAll("#cs-moves-list tbody tr")].map((r) => r.textContent.replace(/\s+/g, " ")).find((t) => /Moved to another address|Déplacée vers une autre adresse/.test(t)) || "");
      check(`${tag} ${lang}: a redirect reads as moved, in the screen's language`, lang === "fr" ? /Déplacée vers une autre adresse/.test(moved) : /Moved to another address/.test(moved), moved.slice(0, 160));
      check(`${tag} ${lang}: and says where it went`, /gift-subscriptions-2026/.test(moved), moved.slice(0, 160));

      // The rival's profile: its changes, with the Arabic title and the redirect.
      // Below 1600 px the cards start folded to a rail of logos (2026-11-20), which hides Open: show the cards first.
      const slim = await page.$('[data-cs-slim][aria-pressed="true"]');
      if (slim && await slim.isVisible()) { await slim.click(); await page.waitForTimeout(600); }
      const card = await page.$('[data-cs-card="4"] [data-cs-open]');
      if (card) { await card.scrollIntoViewIfNeeded(); await card.click(); }
      await page.waitForTimeout(2500);
      // A competitor's page opens on its Changes tab since 2026-11-20 (the timeline moved there out of Activity): stay on it.
      await page.evaluate(() => [...document.querySelectorAll("tr")].find((r) => r.textContent.includes("/gift-subscriptions-2026/"))?.scrollIntoView({ block: "center" }));
      await shoot(page, name("competitor-profile"), `${tag} ${lang} competitor profile`);
      const profileMoved = await page.evaluate(() => document.body.innerText.includes("/gift-subscriptions-2026/"));
      check(`${tag} ${lang}: the profile's changes show where the page moved`, profileMoved);
      const movedWord = await page.evaluate(() => [...document.querySelectorAll("tr")].find((r) => r.textContent.includes("/gift-subscriptions-2026/"))?.textContent.replace(/\s+/g, " ") || "");
      check(`${tag} ${lang}: the moved row says Moved, not Changed`, lang === "fr" ? /Déplacée/.test(movedWord) && !/Modifiée/.test(movedWord) : /Moved/.test(movedWord) && !/Changed/.test(movedWord), movedWord.slice(0, 120));
      const real = problems.filter((p) => !/status of 404/.test(p));  // a missing site logo answers 404 by design
      check(`${tag} ${lang}: no script errors`, real.length === 0, real.slice(0, 3).join(" | "));
      await browser.close();
    }
  }
  console.log(bad ? `${bad} FAILED` : "ALL PASS");
  process.exit(bad ? 1 : 0);
})();
