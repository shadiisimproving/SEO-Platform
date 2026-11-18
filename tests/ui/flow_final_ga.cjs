// Final Google Analytics fixes (final review 2026-11-18): All sites' lead rate leaves out sites with no key events and
// names them, a change covers only the sites with a fair period before and says so, Today and Channels agree, and a key
// event rate reads "at most". Run on a copy of real data (it needs sites without key events and a tag that started late):
//   DB_NAME_TEST=<copy>_test .venv/bin/python tests/ui/app_server.py --port 8312 --keep
//   OUT=<folder> BASE=http://127.0.0.1:8312 SEOCC_REAL_DEFAULT=1 node tests/ui/flow_final_ga.cjs
const fs = require("fs");
const { open } = require("./pw.cjs");
const OUT = process.env.OUT || "var/ui-final-ga", BASE = (process.env.BASE || "http://127.0.0.1:8312").replace(/\/$/, "");
const LATE = process.env.LATE || "business-setup-dubai.com"; // a site whose Google Analytics started late
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, what, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${extra !== "" ? `  [${extra}]` : ""}`); if (!ok) fails.push(what); };

async function visit(page, hash, range, lang) {
  await page.goto(`${BASE}/?lang=${lang}`);
  await page.evaluate(([r, l]) => { localStorage.setItem("seocc2-range", JSON.stringify(r)); localStorage.setItem("seocc2-lang", l); }, [range, lang]);
  await page.goto(`${BASE}/?lang=${lang}${hash}`);
  await page.reload();
  await page.waitForSelector("#topbar");
  await page.waitForTimeout(5000);
}
const text = async (page, sel) => (await page.locator(sel).allTextContents()).map((s) => s.replace(/\s+/g, " ").trim()).join(" | ");

(async () => {
  for (const [width, height, tag] of [[1440, 1000, "desk"], [390, 900, "phone"]]) {
    for (const lang of ["en", "fr"]) {
      const fr = lang === "fr";
      const { browser, page, problems } = await open({ width, height });
      page.setDefaultTimeout(30000);
      const shot = (n) => page.screenshot({ path: `${OUT}/${n}-${tag}-${lang}.png`, fullPage: true });

      await visit(page, "#today", { preset: "28d", compare: "prev" }, lang);
      const visits = await text(page, ".today-nums [data-card='visits'], .today-nums section:nth-child(2)");
      const notes = await text(page, ".ga4-notes");
      check(visits.includes(fr ? "Évolution sur 2 des 3 sites" : "Change on 2 of 3 sites"), `${tag} ${lang}: Today's visits card says the change covers 2 of 3 sites`, visits.slice(0, 120));
      check(notes.includes(LATE) && notes.includes(fr ? "trop peu de données avant" : "too little data before"), `${tag} ${lang}: Today names the site left out`, notes.slice(0, 200));
      await shot("today-28d");

      await visit(page, "#channels", { preset: "28d", compare: "prev" }, lang);
      const rate = await text(page, "[data-card='rate']");
      const chNotes = await text(page, ".ga4-notes");
      check(/11[.,]3/.test(rate), `${tag} ${lang}: Channels' All sites rate is 11.3%, not 4.4%`, rate.slice(0, 90));
      check(rate.includes(fr ? "(max)" : "at most"), `${tag} ${lang}: the key event rate reads "at most"`, rate.slice(0, 60));
      check(chNotes.includes(fr ? "Exclus du taux" : "Left out of the rate") && chNotes.includes("comptabilite-dubai.com"), `${tag} ${lang}: Channels names the sites left out of the rate`, chNotes.slice(0, 220));
      check(chNotes.includes(fr ? "sur 2 des 3 sites" : "on 2 of 3 sites"), `${tag} ${lang}: Channels says its change covers 2 of 3 sites`);
      const vis = await text(page, "[data-card='visits']");
      check(/19\s?%/.test(vis) && !/0[.,]6\s?%/.test(vis), `${tag} ${lang}: Channels' visits change is about −19%, as Today`, vis.slice(0, 90));
      await shot("channels-28d");

      await visit(page, "#conversions", { preset: "28d", compare: "prev" }, lang);
      const cRate = await text(page, "[data-card='rate']");
      check(/11[.,]3/.test(cRate), `${tag} ${lang}: Conversions' All sites rate is 11.3%`, cRate.slice(0, 90));
      await shot("conversions-28d");

      await visit(page, `#channels?site=${LATE}`, { preset: "3m", compare: "prev" }, lang);
      const late = await text(page, "[data-card='visits']");
      check(!/838/.test(late) && !/\+\s?\d{3}/.test(late), `${tag} ${lang}: ${LATE} 3 months shows no +838.5%`, late.slice(0, 90));
      check((await text(page, ".ga4-notes")).includes(fr ? "Trop peu de données avant" : "Too little data before"), `${tag} ${lang}: and says too little data before`);
      await shot("channels-late-3m");

      await visit(page, "#overview", { preset: "28d", compare: "prev" }, lang);
      await shot("overview-28d");

      // The harness has no login, so /api/auth/me answers 404 on every page: that one isn't a problem of these screens.
      const real = problems.filter((p) => !p.includes("404 (NOT FOUND)"));
      check(!real.length, `${tag} ${lang}: no page errors`, real.slice(0, 3).join(" ; "));
      await browser.close();
    }
  }
  console.log(fails.length ? `\n${fails.length} FAILED` : "\nall ok");
  process.exit(fails.length ? 1 : 0);
})();
