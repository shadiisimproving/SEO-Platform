// Code review round 2 (2026-11-18): Settings warns while GA4 history is read again, a competitor's cut sitemap says so,
// Overview's week-by-week left axis fits on a phone. EN/FR, 1440 and 390.
//   DB_NAME_TEST=test_fix_ui_rv2_test .venv/bin/python tests/ui/app_server.py --port 8306   (then tests/ui/seed_ga4.py)
//   OUT=<folder> BASE=http://127.0.0.1:8306 SEOCC_REAL_DEFAULT=1 node tests/ui/flow_review2_fixes.cjs
const fs = require("fs");
const { open } = require("./pw.cjs");
const OUT = process.env.OUT || "var/ui-review2", BASE = (process.env.BASE || "http://127.0.0.1:8306").replace(/\/$/, "");
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, what, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${extra !== "" ? `  [${extra}]` : ""}`); if (!ok) fails.push(what); };

async function visit(page, hash, lang, range = { preset: "12m", compare: "prev" }) {
  await page.goto(`${BASE}/?lang=${lang}`);
  await page.evaluate(([r, l]) => { localStorage.setItem("seocc2-range", JSON.stringify(r)); localStorage.setItem("seocc2-lang", l); }, [range, lang]);
  await page.goto(`${BASE}/?lang=${lang}${hash}`);
  await page.reload();
  await page.waitForSelector("#topbar");
  await page.waitForTimeout(3500);
}

(async () => {
  for (const [width, height, tag] of [[1440, 1000, "desk"], [390, 900, "phone"]]) {
    for (const lang of ["en", "fr"]) {
      const fr = lang === "fr";
      const { browser, page, problems } = await open({ width, height });
      page.setDefaultTimeout(20000);

      await visit(page, "#settings", lang);
      await page.click('[data-lv-tab="sites"]');
      await page.waitForSelector("[data-lv-key-events]", { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(800);
      const card = page.locator("#lead-events");
      const said = (await card.textContent()).replace(/\s+/g, " ");
      check(fr ? /Historique encore en lecture : 12 jours restants/.test(said) : /History still being read: 12 days left/.test(said), `${tag} ${lang}: Settings warns while the history is read again`);
      await card.screenshot({ path: `${OUT}/settings-reread-${tag}-${lang}.png` });

      await visit(page, "#overview", lang);
      await page.waitForSelector(".ov-chart", { timeout: 30000 }).catch(() => {});
      const fit = await page.$$eval(".ov-strip", (strips) => strips.map((s) => {
        const box = s.getBoundingClientRect();
        return [...s.querySelectorAll(".ov-ylab")].map((l) => { const r = l.getBoundingClientRect(); return { text: l.textContent.trim(), inside: r.left >= box.left - 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1, oneLine: r.height < 24 }; });
      }).flat());
      check(fit.length > 0 && fit.every((l) => l.inside && l.oneLine), `${tag} ${lang}: the chart's axis numbers fit`, fit.map((l) => l.text).join(" / "));
      const chart = page.locator(".ov-chart").first();
      if (await chart.count()) await chart.screenshot({ path: `${OUT}/overview-chart-${tag}-${lang}.png` });

      await visit(page, "#competitors/list", lang);
      if (await page.$("#comp-site")) { await page.selectOption("#comp-site", "1"); await page.waitForTimeout(1200); }
      const opener = page.locator('[data-cs-open="4"]').first();
      if (await opener.count()) {
        await opener.click(); await page.waitForTimeout(2000);
        await page.$$eval(".rd-fold", (folds) => folds.forEach((d) => { d.open = true; }));
        const box = page.locator('[data-rd-box="4"]');
        const text = (await box.count()) ? (await box.textContent()).replace(/\s+/g, " ") : "";
        check(text.includes(fr ? "Sitemap incomplet : de nouvelles pages peuvent passer inaperçues." : "Sitemap incomplete: new pages may be missed."), `${tag} ${lang}: the competitor says its sitemap is incomplete`, text.slice(0, 120));
        if (await box.count()) await box.screenshot({ path: `${OUT}/competitor-cut-${tag}-${lang}.png` });
      } else check(false, `${tag} ${lang}: rival-one card found`);
      const errors = problems.filter((p) => !p.includes("Failed to load resource")); // a made-up site's missing logo is a 404, not a script error
      check(errors.length === 0, `${tag} ${lang}: no script errors`, errors.slice(0, 3).join(" | "));
      await browser.close();
    }
  }
  console.log(fails.length ? `${fails.length} failed` : "all passed");
  process.exit(fails.length ? 1 : 0);
})();
