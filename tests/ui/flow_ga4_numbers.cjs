// Google Analytics numbers made true (SEO review 2026-11-17, fixes/ga4.md): Key events until lead events are picked, a
// change in how GA4 counts blanks the leads change, too little data before, unusual days, Copilot and Bing apart, and
// Settings' lead events with the other-website warning.
//   DB_NAME_TEST=test_fix_ui_ga4_test .venv/bin/python tests/ui/app_server.py --port 8301
//   OUT=<folder> BASE=http://127.0.0.1:8301 [LIVE=http://127.0.0.1:8302] SEOCC_REAL_DEFAULT=1 node tests/ui/flow_ga4_numbers.cjs
// LIVE: the screens served on a copy of real data, read only (optional).
const fs = require("fs");
const { open } = require("./pw.cjs");
const OUT = process.env.OUT || "var/ui-ga4", BASE = (process.env.BASE || "http://127.0.0.1:8301").replace(/\/$/, ""), LIVE = (process.env.LIVE || "").replace(/\/$/, "");
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, what, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${extra !== "" ? `  [${extra}]` : ""}`); if (!ok) fails.push(what); };

async function visit(page, base, hash, range, lang) {
  await page.goto(`${base}/?lang=${lang}`);
  await page.evaluate(([r, l]) => { localStorage.setItem("seocc2-range", JSON.stringify(r)); localStorage.setItem("seocc2-lang", l); }, [range, lang]);
  await page.goto(`${base}/?lang=${lang}${hash}`);
  await page.reload();
  await page.waitForSelector("#topbar");
  if (hash.startsWith("#today")) await page.waitForSelector(".today-nums", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3500);
}
const text = async (page, sel) => (await page.locator(sel).allTextContents()).map((s) => s.replace(/\s+/g, " ").trim()).join(" | ");

(async () => {
  for (const [width, height, tag] of [[1440, 1000, "desk"], [390, 900, "phone"]]) {
    for (const lang of ["en", "fr"]) {
      const fr = lang === "fr";
      const { browser, page, problems } = await open({ width, height });
      page.setDefaultTimeout(20000);
      const shot = (n) => page.screenshot({ path: `${OUT}/${n}-${tag}-${lang}.png`, fullPage: true });

      // Settings → Sites: each site's key events with "Counts as a lead", and the other-website warning.
      await visit(page, BASE, "#settings", { preset: "28d", compare: "prev" }, lang);
      await page.click('[data-lv-tab="sites"]');
      await page.waitForSelector("[data-lv-key-events]", { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(800);
      const card = await text(page, "#lead-events");
      check(card.includes("generate_lead") && card.includes("page_view_booking"), `${tag} ${lang}: Settings lists each key event by name`);
      check(card.includes("other-site.example") && card.includes(fr ? "flux de données" : "data streams"), `${tag} ${lang}: Settings warns about the other website`);
      await shot("settings-lead-events");
      await page.locator("#lead-events").screenshot({ path: `${OUT}/settings-lead-events-card-${tag}-${lang}.png` }).catch(() => {});

      // Today before ticking: Key events, with the prompt.
      if (!(tag === "desk" && lang === "en") || true) {
        await visit(page, BASE, "#today", { preset: "28d", compare: "prev" }, lang);
        const cards = await text(page, ".today-nums [data-card='leads']");
        const notes = await text(page, ".ga4-notes");
        check(cards.includes(fr ? "Événements clés" : "Key events") || cards.includes("Leads"), `${tag} ${lang}: Today's first card is Key events, or Leads once picked`, cards.slice(0, 60));
        check(notes.includes(fr ? "flux de données" : "data streams"), `${tag} ${lang}: Today warns about the other website`, notes.slice(0, 120));
        await shot("today");
      }

      // Tick generate_lead on every site: Leads, everywhere.
      if (tag === "desk" && lang === "en") {
        await visit(page, BASE, "#settings", { preset: "28d", compare: "prev" }, lang);
        await page.click('[data-lv-tab="sites"]');
        await page.waitForSelector("[data-lv-key-events]", { timeout: 30000 });
        for (let n = 0; n < (await page.locator("[data-lv-key-events]").count()); n++) {
          const form = page.locator("[data-lv-key-events]").nth(n);
          await form.locator('input[value="generate_lead"]').check();
          await form.locator('button[type="submit"]').click();
          await page.waitForTimeout(1500);
        }
        check((await text(page, "#lead-events")).includes("Leads picked"), "ticking a key event makes it the site's leads");
        await shot("settings-leads-picked");
        await visit(page, BASE, "#today", { preset: "28d", compare: "prev" }, lang);
        check((await text(page, ".today-nums [data-card='leads']")).includes("Leads"), "Today says Leads once they're picked");
        await shot("today-leads-picked");
      }
      await visit(page, BASE, "#conversions", { preset: "28d", compare: "prev" }, lang);
      const rates = await text(page, "[data-card='rate']");
      check(!/\b([2-9]\d\d|1\d\d\d)([.,]\d)?\s?%/.test(rates), `${tag} ${lang}: no lead rate over 100%`, rates.slice(0, 80));
      await shot("conversions");
      await visit(page, BASE, "#channels", { preset: "28d", compare: "prev" }, lang);
      await shot("channels");

      if (LIVE) {
        // Real data: 3 months crosses 19 Jun 2026, when GA4 stopped counting a key event on most visits.
        await visit(page, LIVE, "#today?site=creer-societe-dubai.fr", { preset: "3m", compare: "prev" }, lang);
        const live = await text(page, ".ga4-notes");
        check(live.includes(fr ? "juin 2026" : "Jun 2026"), `${tag} ${lang}: live Today says GA4 changed how it counts (19 Jun)`, live.slice(0, 160));
        check(live.includes(fr ? "inhabituels" : "Unusual days"), `${tag} ${lang}: live Today marks the August burst`);
        await shot("live-today-3m");
        await visit(page, LIVE, "#today", { preset: "28d", compare: "prev" }, lang);
        const sites = await text(page, ".data tbody");
        check(sites.length > 0 && !sites.includes("24,100") && !sites.includes("24 100"), `${tag} ${lang}: live Today no longer shows +24,100%`);
        await shot("live-today-all");
        await visit(page, LIVE, "#conversions?site=creer-societe-dubai.fr", { preset: "28d", compare: "prev" }, lang);
        await shot("live-conversions");
        await visit(page, LIVE, "#channels?site=creer-societe-dubai.fr", { preset: "3m", compare: "prev" }, lang);
        await shot("live-channels-3m");
        await visit(page, LIVE, "#ai?site=creer-societe-dubai.fr", { preset: "28d", compare: "prev" }, lang);
        await shot("live-ai-search");
      }
      const real = problems.filter((p) => !/favicon|logo|401|404|Failed to load resource/.test(p));
      check(!real.length, `${tag} ${lang}: no script errors`, real.slice(0, 3).join(" ; "));
      await browser.close();
    }
  }
  console.log(fails.length ? `${fails.length} FAILED` : "all passed");
  process.exit(fails.length ? 1 : 0);
})();
