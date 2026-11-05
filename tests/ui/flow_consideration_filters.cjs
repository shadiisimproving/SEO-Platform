// In consideration: DA, PA, a rating and filters, in the table and the import window, on the real app.
const { open } = require("./pw.cjs");
const path = require("path"), fs = require("fs");
const BASE = process.argv[2] || "http://127.0.0.1:8234/";
const OUT = path.resolve("var/ui-consideration") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const csv = OUT + "links.csv";
  fs.writeFileSync(csv, ["Source url,Domain Authority,Page Authority,Spam Score",
    "https://high.example/a,70,40,2", "https://mid.example/b,40,25,10", "https://low.example/c,10,5,20",
    "https://no-scores.example/d,,,", "https://spammy.example/e,50,30,80"].join("\n"));
  const { browser, page, problems } = await open({ width: 1440, height: 950, url: BASE + "#backlinks/consideration" });
  const settle = (ms = 500) => page.waitForTimeout(ms);
  const rows = () => page.locator("#pr-table tbody tr[id^=prospect-]").count();
  const domains = () => page.$$eval("#pr-table tbody tr[id^=prospect-] a.kw", (a) => a.map((x) => x.textContent.split(".")[0]).sort().join());
  await page.waitForSelector("#cleaner-open", { timeout: 20000 }); await settle(1000);

  // ---- import window
  await page.click("#cleaner-open");
  await page.setInputFiles("#cleaner-file", csv);
  await page.waitForSelector("#cleaner-select-all"); await settle(200);
  await page.screenshot({ path: OUT + "1-import.png" });
  const cleanerRows = () => page.locator("[data-cleaner-row]").count();
  check("import shows every row", (await cleanerRows()) === 5, await cleanerRows());
  check("import count starts full", (await page.locator("#cleaner-count").innerText()).startsWith("5 of 5"), await page.locator("#cleaner-count").innerText());
  await page.fill('[data-cleaner-filter="da"]', "40");
  check("DA filter narrows the rows", (await cleanerRows()) === 3, await cleanerRows());
  check("typing keeps focus", await page.$eval('[data-cleaner-filter="da"]', (e) => e === document.activeElement));
  await page.click("#cleaner-select-all");
  check("select all takes only good rows on show", (await page.locator("#cleaner-add").innerText()).includes("Add 2"), await page.locator("#cleaner-add").innerText());
  await page.fill('[data-cleaner-filter="pa"]', "30");
  check("a filter drops ticks from rows it hides", (await page.locator("#cleaner-add").innerText()).includes("Add 1"), await page.locator("#cleaner-add").innerText());
  await page.fill('[data-cleaner-filter="da"]', ""); await page.fill('[data-cleaner-filter="pa"]', "");
  check("clearing shows all again", (await cleanerRows()) === 5);
  await page.click("#cleaner-select-all");
  await page.selectOption("#cleaner-start-stage", "contacted");
  await page.selectOption("#cleaner-start-rating", "4");
  await page.fill("#cleaner-start-owner", "Sara");
  await page.screenshot({ path: OUT + "2-import-filled.png" });
  await page.click("#cleaner-add");
  await page.waitForSelector("#pr-table"); await settle(800);
  check("four rows added, spam left out", (await rows()) === 4, await rows());
  await page.screenshot({ path: OUT + "3-table.png" });

  // ---- after a reload
  await page.goto("about:blank"); await page.goto(BASE + "#backlinks/consideration");
  await page.waitForSelector("#pr-table", { timeout: 20000 }); await settle(1000);
  const row = (name) => page.locator("#pr-table tbody tr", { hasText: name });
  const cells = await row("high.example").locator("td").allInnerTexts();
  check("DA and PA kept apart after reload", cells[2].trim() === "70" && cells[3].trim() === "40", cells.slice(2, 4).join("/"));
  check("starting status kept", (await row("high.example").locator("[data-prospect-stage]").inputValue()) === "contacted");
  check("starting rating kept", (await row("high.example").locator("[data-prospect-rating]").inputValue()) === "4");
  check("starting owner kept", (await row("high.example").locator("[data-prospect-owner]").inputValue()) === "Sara");
  const blank = await row("no-scores.example").locator("td").allInnerTexts();
  check("no score shows a dash, not 0", blank[2].trim() === "—" && blank[3].trim() === "—", blank.slice(2, 4).join("/"));

  // ---- rating and status on rows
  await row("low.example").locator("[data-prospect-rating]").selectOption("1"); await settle();
  await row("mid.example").locator("[data-prospect-rating]").selectOption(""); await settle();
  await row("mid.example").locator("[data-prospect-stage]").selectOption("agreed"); await settle();
  await row("mid.example").locator("[data-prospect-owner]").fill("Nour"); await row("mid.example").locator("[data-prospect-owner]").blur(); await settle();
  await page.goto("about:blank"); await page.goto(BASE + "#backlinks/consideration");
  await page.waitForSelector("#pr-table", { timeout: 20000 }); await settle(1000);
  check("changed rating survives reload", (await row("low.example").locator("[data-prospect-rating]").inputValue()) === "1");
  check("cleared rating survives reload", (await row("mid.example").locator("[data-prospect-rating]").inputValue()) === "");

  // ---- table filters
  const filter = (key) => `[data-pr-filter="${key}"]`;
  await page.fill(filter("da"), "40");
  check("DA at least", (await domains()) === "high,mid", await domains());
  check("focus stays while typing", await page.$eval(filter("da"), (e) => e === document.activeElement));
  check("count says how many", (await page.locator("#pr-count").innerText()) === "2 of 4", await page.locator("#pr-count").innerText());
  await page.fill(filter("da"), "");
  await page.fill(filter("spam"), "10");
  check("Spam at most leaves unknown out", (await domains()) === "high,mid", await domains());
  await page.fill(filter("spam"), "");
  await page.selectOption(filter("stage"), "agreed");
  check("Status", (await domains()) === "mid", await domains());
  await page.selectOption(filter("stage"), "");
  await page.selectOption(filter("rating"), "1");
  check("Rating", (await domains()) === "low", await domains());
  await page.selectOption(filter("rating"), "none");
  check("Not rated", (await domains()) === "mid", await domains());
  await page.selectOption(filter("rating"), "");
  check("extra filters hidden at first", await page.locator("#pr-more").isHidden());
  await page.click("#pr-more-toggle");
  await page.screenshot({ path: OUT + "4-more-filters.png" });
  await page.fill(filter("pa"), "25");
  check("PA at least", (await domains()) === "high,mid", await domains());
  await page.fill(filter("pa"), "");
  await page.selectOption(filter("owner"), "Nour");
  check("Owner", (await domains()) === "mid", await domains());
  await page.click("#pr-more-toggle");
  check("a hidden filter still shows it's on", (await page.locator("#pr-more-toggle").innerText()).includes("(1)"), await page.locator("#pr-more-toggle").innerText());
  await page.click("#pr-more-toggle");
  await page.selectOption(filter("owner"), "");
  await page.selectOption(filter("file"), "links.csv");
  check("File", (await rows()) === 4, await rows());
  await page.fill(filter("da"), "999");
  await settle(200);
  await page.screenshot({ path: OUT + "5-nothing-matches.png" });
  check("nothing matches says so", (await page.locator("#pr-table tbody").innerText()).includes("No links match"));
  await page.click("#pr-clear");
  check("Clear brings everything back", (await rows()) === 4 && (await page.locator("#pr-clear").isHidden()), await rows());

  // ---- narrow screen
  await page.setViewportSize({ width: 390, height: 844 }); await settle(500);
  await page.screenshot({ path: OUT + "6-phone.png", fullPage: false });
  check("no sideways page scroll on a phone", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  console.log("page errors:", problems.filter((p) => p.startsWith("pageerror")).length ? problems : "none");
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 600)); process.exit(2); });
