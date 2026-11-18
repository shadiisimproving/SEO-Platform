// Last competitor fixes (2026-11-18): the cards and the profile say "Added in 30 days" with the same number, and the
// profile's tile uses the same words. Desktop 1440 and phone 390, English and French. Made-up sites only.
// node tests/ui/flow_final_competitors.cjs <demo address>   (demo world: tests/ui/app_server.py)
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = (process.argv[2] || "http://127.0.0.1:8313/").replace(/\/?$/, "/");
const OUT = path.resolve("var/ui-final-competitors") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };

(async () => {
  for (const lang of ["en", "fr"]) {
    for (const width of [1440, 390]) {
      const { browser, page, problems } = await open({ width, height: width > 500 ? 950 : 844 });
      const settle = (ms = 1200) => page.waitForTimeout(ms);
      await page.goto(`${BASE}?simple=1#today`); await settle(1500);
      await page.evaluate((l) => localStorage.setItem("seocc2-lang", l), lang);
      await page.reload(); await settle();
      check(`${lang}-${width}: language`, (await page.evaluate(() => document.documentElement.lang)) === lang);
      await page.goto("about:blank"); await page.goto(`${BASE}?simple=1#competitors/summary?site=site-one.example`);
      await page.waitForSelector(".cs-cards .cs-card[data-cs-card]", { timeout: 20000 }); await settle();
      const tag = `${lang}-${width}`;
      await page.screenshot({ path: OUT + `1-cards-${tag}.png` });
      const card = await page.evaluate(() => [...document.querySelectorAll(".cs-card[data-cs-card]")].map((c) => c.querySelector(".cs-card-counts")?.textContent.replace(/\s+/g, " ").trim()).find((t) => /rival|\d/.test(t || "")));
      const words = lang === "fr" ? /ajoutées en 30 j/ : /added in 30 days/;
      check(`${tag}: a card says how many pages were added in 30 days`, words.test(card || ""), card);
      const cardAdded = Number((card || "").match(/(\d+)\s*(added|ajout)/)?.[1]);
      await page.goto("about:blank"); await page.goto(BASE + "#competitors/list"); await settle();
      await page.click(`[data-cs-open="4"]`); await settle();
      await page.click(`[data-pt-tab="activity"]`); await settle(800);
      const head = await page.evaluate(() => [...document.querySelectorAll(".pt-side-table th")].map((th) => th.textContent.trim()));
      const added = lang === "fr" ? "Ajoutées en 30 j" : "Added in 30 days";
      check(`${tag}: the Activity table's column has the card's words`, head.includes(added), head.join(" | "));
      const them = await page.evaluate((label) => {
        const table = [...document.querySelectorAll(".pt-side-table")].find((t) => [...t.querySelectorAll("th")].some((th) => th.textContent.trim() === label));
        const cells = table ? [...table.querySelectorAll("tr.pt-row-them td")].map((td) => td.textContent.trim()) : [];
        return cells[0];
      }, added);
      check(`${tag}: rival-one's card and its profile give the same number`, Number.isFinite(cardAdded) ? Number(them) === cardAdded || them === "—" && cardAdded === 0 : true, `${cardAdded} / ${them}`);
      await page.screenshot({ path: OUT + `2-activity-${tag}.png`, fullPage: width > 500 });
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check(`${tag}: no sideways scroll`, !wide);
      const real = problems.filter((p) => !/status of 404/.test(p));  // /api/auth/me answers 404 when sign-in is off (demo)
      check(`${tag}: no page errors`, real.length === 0, real.join(" | "));
      await browser.close();
    }
  }
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})();
