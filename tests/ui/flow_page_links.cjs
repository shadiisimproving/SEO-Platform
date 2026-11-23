// Page addresses open the page: every screen that shows /services/ or a full address makes it a link to that page,
// in a new tab, and a click on it never opens the row's own panel too (asked for 2026-11-09).
// Needs the real app on the fake internet:
//   DB_NAME_TEST=test_pagelinks_test .venv/bin/python tests/ui/app_server.py --port 8247
// Run: node tests/ui/flow_page_links.cjs reports/page-links-2026-11-09 http://127.0.0.1:8247/
const fs = require("fs");
const { open } = require("./pw.cjs");
const out = process.argv[2] || "reports/page-links";
const BASE = process.argv[3] || "http://127.0.0.1:8247/";
fs.mkdirSync(out, { recursive: true });
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };

const SCREENS = ["today", "overview", "insights", "content", "conversions", "ai", "keywords", "backlinks", "competitors", "tasks"];

// What the screen shows: its page links, and any lone /path/ still left as plain text.
const survey = () => {
  const links = [...document.querySelectorAll("a.page-link")].map((a) => ({ href: a.getAttribute("href"), text: a.textContent.trim(), target: a.target }));
  const plain = [...document.querySelectorAll("#main td, #main .t, #main .second, #main .lv-url, #panel-root td, #panel-root .t")]
    .filter((el) => !el.closest("a, button, input, textarea, code, select, svg") && !el.querySelector("a, button"))
    .map((el) => el.textContent.trim()).filter((s) => /^\/[\w\-./%À-ÿ]*$/.test(s));
  return { links, plain };
};

(async () => {
  const { browser, context, page, problems } = await open({ width: 1440, height: 900, url: `${BASE}?flow=${Date.now()}#today` });
  await page.waitForTimeout(2500);
  for (const pick of ["all", "site-one.example"]) {
    if (pick !== "all") await page.evaluate((host) => { const s = window.SITES.find((x) => x.host === host); if (s) { window.UI.state.site = s.id; window.UI.render(); } }, pick);
    for (const screen of SCREENS) {
      await page.evaluate((s) => { location.hash = `#${s}`; }, screen);
      await page.waitForTimeout(1800);
      const { links, plain } = await page.evaluate(survey);
      const bad = links.filter((l) => !/^https?:\/\/[^/]+/.test(l.href || "") || l.target !== "_blank");
      console.log(`     ${pick} #${screen}: ${links.length} page links${links[0] ? ` (e.g. ${links[0].text} → ${links[0].href})` : ""}${plain.length ? `, plain paths: ${plain.slice(0, 5).join(" ")}` : ""}`);
      check(bad.length === 0, `${pick} #${screen}: every page link is a full address in a new tab${bad.length ? ` ${JSON.stringify(bad.slice(0, 2))}` : ""}`);
      if (pick !== "all") check(plain.length === 0, `${pick} #${screen}: no page path left as plain text`);
      await page.screenshot({ path: `${out}/${pick === "all" ? "all" : "one"}-${screen}.png` });
    }
  }

  // A row that opens a panel: clicking its address opens the page in a new tab, and no panel.
  for (const screen of ["content", "overview", "keywords", "backlinks"]) {
    await page.evaluate((s) => { location.hash = `#${s}`; }, screen);
    await page.waitForTimeout(1800);
    const first = page.locator("#main tr a.page-link").first();
    if (!(await first.count())) { console.log(`     #${screen}: no page link in a row to click`); continue; }
    const href = await first.getAttribute("href");
    await first.hover(); await page.screenshot({ path: `${out}/hover-${screen}.png` });
    const [tab] = await Promise.all([context.waitForEvent("page", { timeout: 4000 }).catch(() => null), first.click()]);
    check(Boolean(tab), `#${screen}: clicking ${href} opens a new tab`);
    if (tab) await tab.close();
    await page.waitForTimeout(600);
    check(!(await page.$("#panel")), `#${screen}: no panel opened behind it`);
    await page.keyboard.press("Escape");
  }

  // Overview: the sentence on top, the Pages tab, and a page's own panel.
  await page.evaluate(() => { location.hash = "#overview"; });
  // Since the one-period rule (2026-11-17) a comparison names no page that gained when the page table doesn't reach back to
  // the earlier period, and the demo world keeps only 14 days of pages. With no comparison, the answer names the Top page.
  await page.evaluate(() => UI.range.set({ compare: "none" }));
  await page.waitForTimeout(2000);
  check((await page.locator(".ov-answer a.page-link").count()) > 0, "Overview: the pages named in the answer on top are links");
  await page.evaluate(() => UI.range.set({ compare: "prev" }));
  await page.waitForTimeout(1500);
  await page.getByRole("tab", { name: "Pages" }).first().click().catch(() => page.locator("button", { hasText: /^Pages$/ }).first().click());
  await page.waitForTimeout(1500);
  const ovRow = page.locator("#main tr a.page-link").first();
  check((await ovRow.count()) > 0, "Overview: the Pages tab lists pages as links");
  if (await ovRow.count()) {
    const [tab] = await Promise.all([context.waitForEvent("page", { timeout: 4000 }).catch(() => null), ovRow.click()]);
    check(Boolean(tab), "Overview: clicking a page opens it in a new tab"); if (tab) await tab.close();
    await page.waitForTimeout(500);
    check(!(await page.$("#panel")), "Overview: and doesn't open the row's panel");
    await page.locator("#main tr.ov-row td:nth-child(2)").first().click().catch(() => page.locator("#main tr.ov-row").first().click());
    await page.waitForTimeout(1800);
    check((await page.locator("#panel .panel-head a.page-link").count()) === 1, "Overview: a page's panel has Open page in its head");
    await page.screenshot({ path: `${out}/overview-page-panel.png` });
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${out}/overview-pages.png` });

  // Insights: run them, then open a finding about a page.
  await page.evaluate(() => { location.hash = "#insights"; });
  await page.waitForTimeout(1500);
  await page.locator("#main button", { hasText: "Run again" }).first().click().catch(() => {});
  await page.waitForTimeout(5000);
  await page.evaluate(() => { location.hash = "#today"; }); await page.waitForTimeout(800);
  await page.evaluate(() => { location.hash = "#insights"; }); await page.waitForTimeout(2500);
  const { links: inLinks } = await page.evaluate(survey);
  console.log(`     #insights after a run: ${inLinks.length} page links`);
  await page.screenshot({ path: `${out}/insights-run.png` });
  const finding = page.locator("#main tbody tr").first();
  if (await finding.count()) {
    await finding.click(); await page.waitForTimeout(1500);
    const { links: panelLinks, plain } = await page.evaluate(survey);
    console.log(`     insight panel: ${panelLinks.filter((l) => l.href).length} links, plain: ${plain.join(" ")}`);
    await page.screenshot({ path: `${out}/insight-panel.png` });
    await page.keyboard.press("Escape");
  }

  const real = problems.filter((p) => !p.includes("404")); // /api/auth/me answers 404 when the test server runs without --login
  check(real.length === 0, `no page errors${real.length ? `: ${real.slice(0, 3).join(" | ")}` : ""}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})();
