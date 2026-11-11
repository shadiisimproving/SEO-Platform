// Who is moving, for all competitors together and for each one (2026-11-10, "as much data as possible").
// Every row shows its page's facts, with the rest behind All the details; the list filters by competitor, kind, period and search.
//   DB_NAME_TEST=… .venv/bin/python tests/ui/app_server.py --port 8247 --login
//   BASE=http://127.0.0.1:8247 OUT=/some/dir node tests/ui/flow_who_is_moving.cjs
const { open } = require("./pw.cjs");
const OUT = process.env.OUT, BASE = process.env.BASE;
let failed = 0;
const check = (ok, word) => { console.log(`${ok ? "ok  " : "FAIL"} ${word}`); if (!ok) failed++; };
const all = (page, sel, fn) => page.$$eval(sel, fn);
const one = (page, sel, fn) => page.$eval(sel, fn);
(async () => {
  const { browser, page, problems } = await open({ url: `${BASE}/` });
  await page.fill("#email", "admin@example.com"); await page.fill("#password", "demo-password-1"); await page.click("#go");
  await page.waitForSelector(".nav-item"); await page.waitForTimeout(600);
  await page.click('button[data-go="competitors"]');
  await page.waitForSelector("#cs-moves-list", { timeout: 15000 }); await page.waitForTimeout(600);
  await one(page, "#cs-moves", (el) => el.scrollIntoView());
  await page.screenshot({ path: `${OUT}/w1-collective.png` });
  const rows = await all(page, "#cs-moves-list > li", (e) => e.length);
  check(rows > 5, `more than the old 5 rows show at once (${rows})`);
  check(Boolean(await page.$("#cs-moves [data-tp-key]")), "the list has pages, as every long table");
  const facts = await all(page, "#cs-moves-list .cl-facts", (e) => e.length);
  check(facts > 0, `rows show a line of facts (${facts})`);
  const titles = await all(page, "#cs-moves-list .cl-facts-title", (e) => e.map((x) => x.textContent.trim()).filter(Boolean));
  check(titles.length > 0, `rows show the page's title (${JSON.stringify(titles.slice(0, 2))})`);
  const fold = await page.$("#cs-moves-list details.cl-more-facts");
  check(Boolean(fold), "a row has All the details");
  if (fold) {
    await (await fold.$("summary")).click(); await page.waitForTimeout(300);
    const labels = await fold.$$eval("dt", (e) => e.map((x) => x.textContent.trim()));
    check(labels.length >= 6, `the details list many facts (${labels.join(", ")})`);
    await fold.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/w2-details.png` });
  }
  const pageFold = await page.$('#cs-moves-list li:has-text("New page found") details.cl-more-facts');
  check(Boolean(pageFold), "a new page has All the details");
  if (pageFold) {
    await (await pageFold.$("summary")).click(); await page.waitForTimeout(300);
    const labels = await pageFold.$$eval("dt", (e) => e.map((x) => x.textContent.trim()));
    check(["Title", "Words", "Headings", "Images"].every((w) => labels.includes(w)), `a page's details hold its title, words, headings and images (${labels.join(", ")})`);
    await pageFold.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/w2b-page-details.png` });
  }
  const kinds = await all(page, "[data-cs-mv-kind]", (e) => e.map((x) => [x.dataset.csMvKind, Number(x.querySelector("b")?.textContent.replace(/\D/g, "") || 0)]));
  check(kinds.length >= 2, `kind chips with counts (${JSON.stringify(kinds)})`);
  const other = kinds.find(([k, n]) => k !== "all" && n > 0);
  if (other) {
    await page.click(`[data-cs-mv-kind="${other[0]}"]`); await page.waitForTimeout(400);
    const shown = await all(page, "#cs-moves-list > li", (e) => e.length);
    check([25, 50, 100].some((per) => shown === Math.min(other[1], per)), `${other[0]} shows its ${other[1]} (${shown} on this page)`);
    check((await page.getAttribute(`[data-cs-mv-kind="${other[0]}"]`, "aria-pressed")) === "true", "the chip pressed says so");
    await page.click('[data-cs-mv-kind="all"]'); await page.waitForTimeout(300);
  }
  const choices = await all(page, "#cs-mv-rival option", (e) => e.map((o) => [o.value, o.textContent.trim()]));
  check(choices.length > 2, `each competitor can be picked (${choices.map((c) => c[1]).join(" | ")})`);
  if (choices.length > 1) {
    await page.selectOption("#cs-mv-rival", choices[1][0]); await page.waitForTimeout(400);
    const who = await all(page, "#cs-moves-list .cs-who .logo-text", (e) => [...new Set(e.map((x) => x.textContent.trim()))]);
    check(who.length === 1, `only that competitor is listed (${who.join(", ")})`);
    await page.screenshot({ path: `${OUT}/w3-one-competitor.png` });
    await page.selectOption("#cs-mv-rival", ""); await page.waitForTimeout(300);
  }
  const search = await page.$('#cs-moves input[type="search"]');
  check(Boolean(search), "a search box");
  if (search) {
    await search.fill("zzzz-nothing"); await page.waitForTimeout(600);
    check(/No change matches/.test(await page.textContent("#cs-moves")), "a search with nothing found says so");
    await page.fill('#cs-moves input[type="search"]', ""); await page.waitForTimeout(600);
  }
  await page.selectOption("#cs-mv-days", "365"); await page.waitForTimeout(1500);
  check(/last year/i.test(await page.textContent("#cs-moves .cs-head")), "a year can be asked for");
  check((await one(page, "#cs-mv-days", (s) => s.value)) === "365", "the period stays picked");
  await one(page, "#cs-rivals", (el) => el.scrollIntoView());
  await page.click("[data-cs-open]"); await page.waitForSelector('[data-pt-tab="activity"]', { timeout: 8000 });
  await page.click('[data-pt-tab="activity"]'); await page.waitForSelector("#cl-timeline", { timeout: 8000 }); await page.waitForTimeout(500);
  const own = await all(page, "#cl-timeline .cl-more-facts", (e) => e.length);
  check(own > 0, `a competitor's own timeline has All the details too (${own})`);
  await one(page, "#cl-timeline", (el) => el.scrollIntoView());
  await page.screenshot({ path: `${OUT}/w4-profile.png` });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!wide, "no sideways scroll on a phone");
  await page.screenshot({ path: `${OUT}/w5-phone.png` });
  check(problems.length === 0, `no page errors ${JSON.stringify(problems.slice(0, 3))}`);
  await browser.close();
  console.log(failed ? `${failed} FAILED` : "all ok");
  process.exit(failed ? 1 : 0);
})();
