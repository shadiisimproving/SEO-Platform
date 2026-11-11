// Link gaps lists each domain's links inside its row (2026-11-10): anchor text, Page Authority, the linking page → the
// competitor page. A Ubersuggest file is uploaded the way the owner does it, then the column is sorted, filtered and searched.
//   DB_NAME_TEST=test_reflinks_test .venv/bin/python tests/ui/app_server.py --port 8247
//   node tests/ui/flow_link_gap_links.cjs http://127.0.0.1:8247/
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8247/";
const OUT = path.resolve("var/ui-link-gap-links") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };

// Domains that are gaps in the demo, with the same Domain Authority, so only the link details are new. barista-mag and foodblog
// already link to site-one, so they are rightly not gaps.
const FILE = path.join(OUT, "backlink-report.csv");
const line = (n, title, from, to, da, pa, spam, anchor) => `${n},"${title}","${from}","${to}",${da},${pa},${spam},"${anchor}","2025-05-13","2026-11-04"`;
fs.writeFileSync(FILE, "﻿" + [
  "No,Source Page Title,Source URL,Target URL,Domain Authority,Page Authority,Spam Score,Anchor Text,First Seen,Last Seen",
  line(1, "Best subscriptions", "https://coffee-review.example/best-subscriptions", "https://rival-one.example/subscribe", 62, 44, 3, "best coffee subscription"),
  line(2, "Beans of the month", "https://coffee-review.example/beans-of-the-month", "https://rival-one.example/", 62, 31, 3, "rival-one.example"),
  line(3, "Roasters list", "https://coffee-review.example/roasters", "https://rival-one.example/about", 62, 25, 3, "a roaster in Dubai"),
  line(4, "Gift ideas", "https://coffee-review.example/gifts", "https://rival-one.example/gifts", 62, 19, 3, "coffee gift box"),
  line(5, "Kitchen gear", "https://home-kitchen.example/gear", "https://rival-one.example/beans", 47, 15, 6, "single origin beans"),
  line(7, "Story", "https://local-news.example/story", "https://rival-one.example/", 54, 36, 2, "local roastery"),
].join("\n"));

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  await page.goto(BASE + "#competitors/gaps"); await page.waitForSelector("#cg-table", { timeout: 20000 }); await page.waitForTimeout(600);

  // Upload, as the owner does: Sources → Upload links for this competitor.
  if (!(await page.locator("#cg-sources-fold").evaluate((el) => el.open))) await page.click("#cg-sources-fold > summary");
  await page.locator("[data-cg-upload]").first().click();
  await page.waitForSelector("#cg-up-file");
  const who = await page.locator("#cg-up-who option").evaluateAll((opts) => opts.find((o) => o.textContent.trim() === "rival-one.example")?.value);
  await page.selectOption("#cg-up-who", who);
  await page.setInputFiles("#cg-up-file", FILE);
  await page.click("#cg-up-send");
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape").catch(() => {});
  await page.goto(BASE + "#competitors"); await page.goto(BASE + "#competitors/gaps");
  await page.waitForSelector("#cg-table", { timeout: 20000 }); await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + "1-after-upload.png", fullPage: false });

  const heads = await page.locator("#cg-table thead th").allTextContents();
  check("the table has a Links: anchor text and Page Authority column", heads.some((h) => /Links: anchor text and Page Authority/.test(h)), heads.join(" | "));
  const row = (domain) => page.locator(`#cg-table tr[data-cg-row="${domain}"]`);
  const cr = row("coffee-review.example");
  check("coffee-review's row lists its strongest link first, with PA", /best coffee subscription/.test(await cr.locator(".cg-links li").first().textContent()) && /PA\s*44/.test(await cr.locator(".cg-links li").first().textContent()));
  check("three links show at first", (await cr.locator(".cg-links li").count()) === 3, await cr.locator(".cg-links li").count());
  check("each link names the page it's on and the competitor page", /coffee-review\.example\/best-subscriptions/.test(await cr.locator(".cg-link-from").first().textContent()) && /rival-one\.example\/subscribe/.test(await cr.locator(".cg-link-to").first().textContent()));
  check("the linking page opens in a new tab", (await cr.locator(".cg-link-from").first().getAttribute("target")) === "_blank");

  await cr.locator("[data-cg-links]").click(); await page.waitForTimeout(300);
  // 4 links from this file, 1 from each of the demo's files (no anchor text there).
  const openCount = await cr.locator(".cg-links li").count(), focused = await page.evaluate(() => document.activeElement?.dataset?.cgLinks);
  check("Show all opens the rest in the same row, focus stays on the button", openCount === 6 && focused === "coffee-review.example", `${openCount} ${focused}`);
  check("the route didn't change: no other page opened", (await page.evaluate(() => location.hash)) === "#competitors/gaps");
  await page.screenshot({ path: OUT + "2-row-open.png" });
  await cr.locator("[data-cg-links]").click(); await page.waitForTimeout(300);
  check("Show fewer folds it back", (await cr.locator(".cg-links li").count()) === 3);

  // Sorting by Page Authority: the best link's PA, biggest first, then smallest first.
  const order = async () => (await page.locator("#cg-table tbody tr").evaluateAll((rows) => rows.map((r) => r.dataset.cgRow)));
  await page.click('[data-cg-sort="pa"]'); await page.waitForTimeout(400);
  const down = await order();
  check("sorting by Page Authority puts the strongest page first", down.slice(0, 3).join() === "coffee-review.example,local-news.example,home-kitchen.example", down.slice(0, 5).join(", "));
  check("the heading says it's sorted", (await page.locator('th:has([data-cg-sort="pa"])').getAttribute("aria-sort")) === "descending");
  await page.click('[data-cg-sort="pa"]'); await page.waitForTimeout(400);
  const up = await order();
  check("a second click sorts smallest first, domains with no Page Authority last", up.slice(0, 3).join() === "home-kitchen.example,local-news.example,coffee-review.example", up.join(", "));
  await page.click('[data-cg-sort="pa"]'); await page.waitForTimeout(300);

  // Filtering by Page Authority.
  await page.selectOption("#cg-pa", "40"); await page.waitForTimeout(400);
  const strong = await order();
  check("Page Authority 40 or more keeps only domains with such a link", strong.join() === "coffee-review.example", strong.join(", "));
  await page.selectOption("#cg-pa", "30"); await page.waitForTimeout(400);
  check("30 or more adds local-news (PA 36)", (await order()).sort().join() === "coffee-review.example,local-news.example", (await order()).join(", "));
  check("focus stays on the filter", (await page.evaluate(() => document.activeElement?.id)) === "cg-pa");
  await page.screenshot({ path: OUT + "3-pa-40.png" });
  await page.selectOption("#cg-pa", ""); await page.waitForTimeout(300);

  // Search finds anchor text, and the matching link comes first in its row.
  await page.fill("[data-tp-search]", "gift box"); await page.waitForTimeout(700);
  const found = await order();
  check("searching anchor text finds the domain", found.length === 1 && found[0] === "coffee-review.example", found.join(", "));
  check("the matching link comes first in the row", /coffee gift box/.test(await cr.locator(".cg-links li").first().textContent()));
  await page.screenshot({ path: OUT + "4-search-anchor.png" });
  await page.click("[data-tp-clear]"); await page.waitForTimeout(400);

  // One competitor chosen: only its links show.
  await page.click("#cg-filter"); await page.waitForTimeout(300);
  await page.locator(".cg-pick-menu [data-cg-choose]", { hasText: "rival-two.example" }).click(); await page.waitForTimeout(400);
  // The demo's rival-two file gives coffee-review one link, with no anchor text in that file.
  const onlyTwo = await cr.locator(".cg-links-cell").textContent();
  check("with rival-two chosen, coffee-review shows only rival-two's link", (await cr.locator(".cg-links li").count()) === 1 && /No anchor text/.test(onlyTwo) && /rival-two/.test(onlyTwo) === false && !/best coffee subscription/.test(onlyTwo), onlyTwo.replace(/\s+/g, " ").trim());
  await page.click("#cg-filter"); await page.click('[data-cg-choose=""]'); await page.waitForTimeout(300);

  // French.
  await page.evaluate(() => { UI.state.lang = "fr"; UI.render(); }); await page.waitForTimeout(500);
  const frHeads = await page.locator("#cg-table thead th").allTextContents();
  check("the heading is in French", frHeads.some((h) => /Liens : ancre et Page Authority/.test(h)), frHeads.join(" | "));
  check("Show all is in French", /Afficher les 6 liens/.test(await cr.locator("[data-cg-links]").textContent()));
  await page.evaluate(() => { UI.state.lang = "en"; UI.render(); }); await page.waitForTimeout(400);

  // Phone width: no sideways scroll on the page.
  await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(600);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("no sideways scroll on a phone", wide <= 1, wide);
  await page.locator('tr[data-cg-row="coffee-review.example"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: OUT + "5-phone.png" });

  const real = problems.filter((p) => !/Failed to load resource/.test(p)); // the sign-in probe answers 404 with accounts off, as in every flow
  check("no console errors", real.length === 0, real.slice(0, 3).join(" / "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
