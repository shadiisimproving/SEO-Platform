// A second Refresh while the first still runs: Refresh on one keyword, Check deeper or a panel Recheck must not be blocked by "Already refreshing".
// Server: DB_NAME_TEST=seo_cc_refresh_test .venv/bin/python tests/ui/keywords_server.py --port 8222 --login
// Run: node tests/ui/flow_two_refreshes.cjs <folder for screenshots> http://127.0.0.1:8222/
const { open } = require("./pw.cjs");
const out = process.argv[2] || "/tmp";
const BASE = process.argv[3] || "http://127.0.0.1:8222/";
const fails = [];
const check = (ok, what, extra = "") => { console.log(ok ? "ok  " : "FAIL", what, extra); if (!ok) fails.push(what); };
const settle = (page, ms = 500) => page.waitForTimeout(ms);
(async () => {
  const { page, browser } = await open({ width: 1440, height: 900 });
  await page.goto(`${BASE}login`); await page.fill("#email", "admin@example.com"); await page.fill("#password", "demo-password-1"); await page.click("#go");
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 });
  await page.goto(`${BASE}#keywords`); await page.waitForSelector("#kw-table", { timeout: 15000 }); await settle(page);
  const rows = page.locator("[data-kwr-select]");
  const count = await rows.count();
  check(count >= 2, "at least two keywords", count);
  const startOne = async (i) => {
    for (let j = 0; j < (await rows.count()); j++) if (await rows.nth(j).isChecked()) { await rows.nth(j).click(); await settle(page, 200); }
    await rows.nth(i).click(); await settle(page, 300);
    await page.click("#kwr-refresh"); await page.waitForSelector("#kwr-summary p", { timeout: 8000 }); await settle(page, 300);
    if (await page.$("#kwr-recent")) { await page.check("#kwr-recent"); await settle(page, 400); }
    await page.waitForFunction(() => { const b = document.querySelector("#kwr-confirm"); return b && !b.disabled; }, null, { timeout: 8000 });
    await page.click("#kwr-confirm"); await settle(page, 700);
  };
  await startOne(0);
  check((await page.locator("#tray .kwr-run").count()) === 1, "first Refresh shows in the tray");
  check(!(await page.isDisabled("#kwr-refresh")), "Refresh stays usable while it runs");
  const firstId = Number(await page.getAttribute("#tray .kwr-run", "data-run"));
  await startOne(1);
  const toast = (await page.$(".toast")) ? await page.textContent(".toast") : "";
  check(!/Already refreshing\./.test(toast), "no 'Already refreshing.' block", toast);
  // The second run gets a block of its own; the first one's stays beside it while it's still going.
  const ids = (await page.locator("#tray .kwr-run").evaluateAll((els) => els.map((el) => Number(el.dataset.run))));
  check(ids.some((id) => id > firstId), "second Refresh gets its own block", JSON.stringify({ firstId, ids }));
  await page.screenshot({ path: `${out}/two-refreshes.png` });
  console.log("   tray:", (await page.textContent("#tray")).replace(/\s+/g, " "));
  const done = await page.waitForFunction(() => !document.querySelector("#tray") || [...document.querySelectorAll("#tray .kwr-run .top")].every((x) => /saved/.test(x.textContent)), null, { timeout: 120000 }).then(() => true, () => false);
  await page.screenshot({ path: `${out}/two-refreshes-done.png` });
  check(done, "both finish");
  await browser.close();
  if (fails.length) { console.log(`${fails.length} failed`); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
