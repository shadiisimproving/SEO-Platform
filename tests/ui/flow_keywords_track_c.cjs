// Keywords, Track C (plan-seo-command-center-mickaz-missing-features-geo-keywords-2026-11-20.md), driven like a normal user:
// the chips always on show with counts, with the search and the pager; the row's trend line; Volume with its source and the
// Volumes panel (file upload); the "Also …" lines gone from the rows and listed in the panel; the panel's chart with one line
// per page and the links as labelled lines; Check AI Overviews (asks first, says what it uses) and the AI column's AIO / cited.
// Needs a fresh demo world plus its seed (made-up .example sites, fake search tools: nothing is spent):
//   DB_NAME_TEST=test_mzkeywordsui_test .venv/bin/python tests/ui/app_server.py --port 8303 &
//   DB_NAME_TEST=test_mzkeywordsui_test .venv/bin/python tests/ui/seed_keywords_track_c.py
//   node tests/ui/flow_keywords_track_c.cjs <folder for screenshots> http://127.0.0.1:8303/
const fs = require("fs");
const path = require("path");
const { open } = require("./pw.cjs");
const out = process.argv[2] || "/tmp";
const BASE = process.argv[3] || "http://127.0.0.1:8303/";
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const settle = (page, ms = 500) => page.waitForTimeout(ms);
const chip = (page, id) => page.locator(`.kw-chips [data-filter="${id}"]`);
const chipCount = async (page, id) => Number((await chip(page, id).locator("b").innerText()).replace(/\D/g, ""));
const rows = (page) => page.locator("#kw-table tbody tr[data-kwr-row]");

async function start({ width = 1440, height = 900, lang = "" } = {}) {
  const run = await open({ width, height });
  run.failed = [];
  run.page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/api/auth/me")) run.failed.push(`${r.status()} ${r.url()}`); });
  await run.page.goto(`${BASE}?flow=${Date.now()}&simple=1${lang ? `&lang=${lang}` : ""}#keywords?site=site-one.example`);
  await run.page.waitForSelector("#kw-table", { timeout: 20000 }); await settle(run.page, 1500);
  return run;
}
const errorsOf = (run) => [...run.problems.filter((p) => !/Failed to load resource/.test(p)), ...run.failed];

(async () => {
  const a = await start();
  const { page } = a;
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${out}/c01-keywords.png` });

  // ---- 1. chips, always on show, with the search and the pager ----------------------------------------------------------
  check(await page.locator(".kw-chips [data-filter]").count() === 8 && !(await page.locator("#kw-filter-panel").count()), "eight chips on show without opening Filter");
  const labels = await page.locator(".kw-chips [data-filter]").allInnerTexts();
  check(/All/.test(labels[0]) && labels.some((l) => /Two pages/.test(l)) && labels.some((l) => /Cited by AI/.test(l)) && labels.some((l) => /Not ranked/.test(l)), `chips named like Mickaz's (${labels.map((l) => l.replace(/\s+/g, " ")).join(" | ")})`);
  const all = await chipCount(page, "all");
  check(all === 30 && await rows(page).count() === 25 && /1–25 of 30/.test(await page.locator(".tp-foot").innerText()), `All counts every keyword (${all}) and the pager shows 25 of them`);
  await page.click('.tp-foot .tp-num[data-tp-page="1"]'); await settle(page, 500);
  check(await rows(page).count() === 5, "page 2 holds the other 5");
  await chip(page, "two").click(); await settle(page, 500);
  const two = await chipCount(page, "two");
  check(two === 2 && await rows(page).count() === 2 && await chip(page, "two").getAttribute("aria-pressed") === "true", `Two pages finds the ${two} keywords with a second page, from page 1 again`);
  check(!(await page.locator("#kw-table .kw-also").count()) && await page.locator("#kw-table .kw-two").count() === 2, "the rows keep only a small +1, no more Also lines");
  await page.screenshot({ path: `${out}/c02-two-pages-chip.png` });
  await page.fill('[data-tp-search][data-tp-key="kw"]', "subscription"); await settle(page, 700);
  check(await rows(page).count() === 1 && await chipCount(page, "all") === 1 && await chipCount(page, "two") === 1, "the chips count what the search leaves, and work together with it");
  await page.fill('[data-tp-search][data-tp-key="kw"]', ""); await settle(page, 600);
  await chip(page, "all").click(); await settle(page, 400);

  // ---- 2. the trend line ------------------------------------------------------------------------------------------------
  const spark = page.locator('#kw-table tr:has-text("coffee subscription") .kw-spark');
  const sparkWords = await spark.getAttribute("aria-label");
  check(await spark.locator("svg path.kw-spark-line").count() === 1 && /Search Console, 28 days/.test(sparkWords) && /Higher on the line is better/.test(sparkWords), `a trend line per row, read out with its direction (${sparkWords})`);
  const endY = await spark.locator("circle.kw-spark-end").getAttribute("cy"), startY = await spark.locator("line.kw-spark-start").getAttribute("y1");
  check(Number(endY) < Number(startY), "coffee subscription moved up, so its line ends above where it started");

  // ---- 3. Volume with its source -----------------------------------------------------------------------------------------
  const heads = (await page.locator("#kw-table thead th").allInnerTexts()).join("|");
  check(/Volume/.test(heads) && !/Impressions/.test(heads) && !/All countries/.test(heads) && /Trend/.test(heads), `Volume and Trend are columns, Impressions and All countries folded into Columns (${heads.replace(/\s+/g, " ")})`);
  const scTip = await page.locator('#kw-table tr:has-text("coffee subscription") td:nth-child(3) [data-tip]').first().getAttribute("data-tip");
  check(/All countries: 5\.7/.test(scTip || ""), `the all-countries average is the Search Console cell's tooltip (${scTip})`);
  const vol = page.locator('#kw-table tr:has-text("coffee subscription") .kw-vol');
  check(/2,400/.test(await vol.innerText()) && /File/.test(await vol.innerText()) && /From file: keyword-planner-fr\.csv/.test(await vol.getAttribute("data-tip")), "a volume says where it came from (File, named in full in its tooltip)");
  const blank = page.locator('#kw-table tr:has-text("moulin à café") td[data-label="Volume"] .dash');
  check(/No search volume yet/.test(await blank.getAttribute("aria-label")), "a keyword with no volume says so (a range in the file was skipped, never guessed)");

  // ---- 4. the Volumes panel: add a file ----------------------------------------------------------------------------------
  await page.click("#kw-volumes"); await page.waitForSelector("#panel .kw-vol-panel", { timeout: 8000 }); await settle(page, 400);
  check(/keyword-planner-fr\.csv/.test(await page.locator("#panel .kw-vol-files").innerText()), "the panel lists the file already added");
  check(/Add the Bing Webmaster key/.test(await page.locator("#panel").innerText()), "no Bing key: the panel says where to add it");
  await page.screenshot({ path: `${out}/c03-volumes-panel.png` });
  const file = path.join(out, "volumes-test.csv");
  fs.writeFileSync(file, "Mot-clé;Volume;Pays\nmoulin à café;590;FR\nbest coffee beans;3 600;FR\n");
  await page.setInputFiles("#kw-vol-file", file); await settle(page, 1800);
  check(/volumes-test\.csv/.test(await page.locator("#panel .kw-vol-files").innerText()), "a French CSV is added and listed");
  await page.keyboard.press("Escape"); await settle(page, 1200);
  check(/590/.test(await page.locator('#kw-table tr:has-text("moulin à café") td[data-label="Volume"]').innerText()), "its volume shows in the table at once");

  // ---- 5. the panel: other pages, one line per page, links on their dates ---------------------------------------------
  await page.click('#kw-table [data-kwr-open]:text-is("coffee subscription")'); await page.waitForSelector("#panel .kwt-chart", { timeout: 10000 }); await settle(page, 800);
  check(await page.locator("#panel .kw-other-pages li").count() === 1 && await page.locator("#panel .kw-other-pages a").count() === 1 && /impr\./.test(await page.locator("#panel .kw-other-pages").innerText()), "the panel lists the other page, as a link, with its impressions");
  check(await page.locator("#panel .kwt-chart .kwt-pline").count() === 2 && await page.locator("#panel .kwt-legend li").count() === 2 && await page.locator("#panel .kwt-legend a").count() === 2, "the chart draws one line per page, with a legend of links");
  const dashes = await page.locator("#panel .kwt-chart .kwt-pline").evaluateAll((els) => els.map((e) => e.style.strokeDasharray || "none"));
  check(new Set(dashes).size === 2, `each page's line has its own dash as well as its colour (${dashes.join(", ")})`);
  const labelsOnChart = await page.locator("#panel .kwt-chart .kwt-vlabel").allTextContents();
  check(labelsOnChart.some((l) => /coffee-blog\.example/.test(l)) && labelsOnChart.some((l) => /forum-cafe\.example/.test(l)), `bought and found links are labelled lines on their days (${labelsOnChart.join(", ")})`);
  check(/Volume/.test(await page.locator("#panel .kv").innerText()) && /From file/.test(await page.locator("#panel .kv").innerText()), "the panel says the volume's source in full");
  await page.screenshot({ path: `${out}/c04-panel-pages-and-links.png` });
  await page.click('#panel [data-kwt-src="checks"]'); await settle(page, 600);
  check(await page.locator("#panel .kwt-chart, #panel .kwt-lead, #panel .note").count() > 0, "the chart switches to our checks without breaking");
  await page.screenshot({ path: `${out}/c05-panel-our-checks.png` });
  await page.click('#panel [data-kwt-src="gsc"]'); await settle(page, 400);
  await page.keyboard.press("Escape"); await settle(page, 600);

  // ---- 6. Check AI Overviews: asks first, says what it uses, then fills the column ------------------------------------------
  const aio = page.locator("#kw-aio-all");
  const unchecked = Number((await aio.locator(".tt-count").innerText()).replace(/\D/g, ""));
  check(unchecked > 0 && await page.locator('#kw-table td[data-label="AI"]:has-text("Not checked")').count() > 0, `Check AI Overviews shows how many keywords have none (${unchecked})`);
  await aio.click(); await page.waitForSelector("#dlg[open] #kwr-cost", { timeout: 10000 }); await settle(page, 500);
  const dlg = await page.locator("#dlg").innerText();
  check(new RegExp(`${unchecked} keywords have no AI Overview check yet`).test(dlg) && /SerpApi/.test(dlg) && /free SerpApi searches|No charge/.test(dlg), "the dialog says how many and what it uses before anything runs");
  check(!(await page.locator("#dlg #kwr-paid").count()), "paid use isn't offered here");
  await page.screenshot({ path: `${out}/c06-aio-confirm.png` });
  await page.click("#kwr-confirm"); await settle(page, 1000);
  await page.waitForFunction(() => !document.querySelector("#kw-aio-all") || Number(document.querySelector("#kw-aio-all .tt-count")?.textContent.replace(/\D/g, "")) < 5, null, { timeout: 90000 }).catch(() => {});
  await settle(page, 2500);
  const aiCells = await page.locator('#kw-table td[data-label="AI"]').allInnerTexts();
  check(aiCells.filter((c) => /AIO/.test(c)).length >= 4 && aiCells.some((c) => /cited/.test(c)), `the AI column reads AIO / cited where a check read it (${aiCells.filter((c) => /AIO/.test(c)).length} rows with AIO)`);
  await page.screenshot({ path: `${out}/c07-after-aio-check.png` });
  check(errorsOf(a).length === 0, `no errors on the page (${errorsOf(a).join(" | ")})`);
  await a.browser.close();

  // ---- 7. a phone, and French ---------------------------------------------------------------------------------------------
  const phone = await start({ width: 390, height: 844 });
  await phone.page.screenshot({ path: `${out}/c08-phone.png`, fullPage: false });
  const wide = await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!wide, "no sideways scroll on a phone");
  await phone.browser.close();
  const fr = await start({ lang: "fr" });
  const frChips = (await fr.page.locator(".kw-chips [data-filter]").allInnerTexts()).join("|");
  check(/Deux pages/.test(frChips) && /Cités par l'IA/.test(frChips), `French chips (${frChips.replace(/\s+/g, " ")})`);
  check(/Volume/.test(await fr.page.locator("#kw-table thead").innerText()) && /Fichier/.test(await fr.page.locator("#kw-table").innerText()), "French Volume column and source tag");
  await fr.page.screenshot({ path: `${out}/c09-french.png` });
  await fr.browser.close();

  console.log(fails.length ? `\n${fails.length} FAILED` : "\nall ok");
  process.exit(fails.length ? 1 : 0);
})();
