// Search Console screen numbers, second round (expert review 2026-11-17, search-console.md 3.3, 3.6, 3.9).
// Jump links said apart on Content, Pages, the page view and the page panel; Insights' "Why" leads with hidden searches when
// they are most of the change; 24 hours without Google says it shows the last saved days.
//   FAKE_GSC_FAIL_FILE=<file> DB_NAME_TEST=test_fix_ui_gsc2_test .venv/bin/python tests/ui/app_server.py --port 8303
//   (then add the made-up jump links and Insights change described in reports/seo-expert-2026-11-17/fixes/gsc2.md)
//   OUT=<folder> BASE=http://127.0.0.1:8303 FAIL_FILE=<file> SEOCC_REAL_DEFAULT=1 node tests/ui/flow_gsc_screen_numbers.cjs
const fs = require("fs");
const { open } = require("./pw.cjs");
const OUT = process.env.OUT || "var/ui-gsc2", BASE = (process.env.BASE || "http://127.0.0.1:8303").replace(/\/$/, "");
const FAIL = process.env.FAIL_FILE || "";
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, what, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${extra !== "" ? `  [${String(extra).slice(0, 200)}]` : ""}`); if (!ok) fails.push(what); };
const settle = (page, ms = 1500) => page.waitForTimeout(ms);
const textOf = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent || "", sel);

async function visit(page, hash, range, lang) {
  await page.evaluate(([r, l]) => { localStorage.setItem("seocc2-range", JSON.stringify(r)); localStorage.setItem("seocc2-lang", l); }, [range, lang]);
  await page.goto(`${BASE}/?lang=${lang}${hash}`);
  await page.reload();
  await page.waitForSelector("#topbar");
  await settle(page, 2500);
}

(async () => {
  for (const [width, height, tag] of [[1440, 1000, "desk"], [390, 900, "phone"]]) {
    for (const lang of ["en", "fr"]) {
      const { browser, page, problems } = await open({ width, height, url: `${BASE}/` });
      page.setDefaultTimeout(15000);
      const name = (n) => `${OUT}/${n}-${tag}-${lang}.png`;
      const fr = lang === "fr";
      const jumpRe = fr ? /Liens vers une section : 5[\s  ]600 impressions/ : /Jump links: 5,600 impressions/;
      const r28 = { preset: "28d", compare: "prev" };

      // Content: the page's own numbers, its jump links said under it.
      await visit(page, "#content?site=site-one.example", r28, lang);
      check(jumpRe.test(await textOf(page, ".content")), `${tag} ${lang}: Content says the jump links apart`);
      await page.screenshot({ path: name("01-content"), fullPage: false });
      // Its side panel: the page's own position, the jump links in the line under its name.
      await page.click('tr[data-rp-open="page"][data-rp-key$="/abonnement"]');
      await page.waitForSelector(".rp-sub");
      await settle(page, 1500);
      check(jumpRe.test(await textOf(page, ".rp-sub")), `${tag} ${lang}: the page panel says the jump links apart`, await textOf(page, ".rp-sub"));
      await page.screenshot({ path: name("01b-content-panel"), fullPage: false });
      await page.keyboard.press("Escape");

      // Pages list and the page's own view.
      await visit(page, "#pages?site=site-one.example", r28, lang);
      check(jumpRe.test(await textOf(page, ".content")), `${tag} ${lang}: Pages list says the jump links apart`);
      await page.screenshot({ path: name("02-pages-list"), fullPage: false });
      await page.click('[data-pg-open-btn$="/abonnement"]');
      await settle(page, 2500);
      const nums = await textOf(page, ".pg-nums");
      check(jumpRe.test(nums), `${tag} ${lang}: the page view's Position tile says the jump links`, nums);
      await page.screenshot({ path: name("03-page-view"), fullPage: false });

      // Insights: hidden searches are 80 of a 90-click fall: they lead the Why list, not greyed, and no main cause is named.
      await visit(page, "#insights?site=site-one.example", r28, lang);
      const first = await page.evaluate(() => {
        const lists = document.querySelectorAll(".in-lists > div");
        const li = lists[lists.length - 1]?.querySelector(".in-bars li");
        return li ? { text: li.textContent, quiet: li.classList.contains("quiet") } : null;
      });
      check(first && /−80/.test(first.text) && !first.quiet, `${tag} ${lang}: hidden searches lead the Why list, not greyed`, JSON.stringify(first));
      check(!/Mostly: lower click rate/.test(await textOf(page, ".in-top")), `${tag} ${lang}: no main cause named over a hidden-led fall`);
      await page.screenshot({ path: name("04-insights-why"), fullPage: false });

      // 24 hours while Google refuses: the last saved days, said as such.
      if (FAIL) fs.writeFileSync(FAIL, "1");
      await visit(page, "#overview?site=site-one.example", { preset: "24h", compare: "prev" }, lang);
      await settle(page, 2000);
      const head = await textOf(page, "#topbar"), body = await textOf(page, ".content");
      check(!/Last 24 hours|Dernières 24 heures/.test(head), `${tag} ${lang}: the head doesn't say 24 hours over saved days`, head);
      check(fr ? /(2 jours enregistrés|2 derniers jours enregistrés)/.test(head + body) : /last 2 saved days/i.test(head + body), `${tag} ${lang}: it says the last 2 saved days`, head);
      await page.screenshot({ path: name("05-overview-24h-saved"), fullPage: false });
      if (FAIL) fs.rmSync(FAIL, { force: true });

      // The harness has no sign-in, so /api/auth/me answers 404 on every load: that one isn't a script error.
      const errors = problems.filter((p) => !/Failed to load resource: .*404/.test(p));
      check(!errors.length, `${tag} ${lang}: no script errors`, errors.join(" | "));
      await browser.close();
    }
  }
  console.log(fails.length ? `\n${fails.length} FAILED` : "\nall ok");
  process.exit(fails.length ? 1 : 0);
})();
