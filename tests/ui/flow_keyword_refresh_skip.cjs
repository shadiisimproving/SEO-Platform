// A Refresh with Yandex ticked and no tool for it (expert review keywords F12, 2026-11-17): the dialog says Yandex will be
// skipped, the run finishes, and the tray says what moved and why Yandex was left out. English then French.
//   node tests/ui/flow_keyword_refresh_skip.cjs <folder for screenshots> http://127.0.0.1:8293/
const { open } = require("./pw.cjs");
const out = process.argv[2] || "/tmp";
const BASE = process.argv[3] || "http://127.0.0.1:8293/";
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
(async () => {
  for (const lang of ["en", "fr"]) {
    const r = await open({ width: 1440, height: 900 });
    const { page } = r;
    await page.goto(`${BASE}?flow=${Date.now()}&simple=1#keywords?site=site-one.example`);
    await page.waitForSelector("#kw-table tbody tr", { timeout: 20000 });
    if (lang === "fr") { await page.evaluate(() => { window.UI.state.lang = "fr"; window.UI.render(); }); await page.waitForTimeout(600); }
    await page.click("#kwr-refresh");
    await page.waitForSelector("#kwr-confirm");
    const yandex = page.locator('[data-kwr-engine="yandex"]');
    if (!(await yandex.isChecked())) await yandex.check();
    const recent = page.locator("#kwr-recent");
    await page.waitForTimeout(1500);
    if (await recent.count() && !(await recent.isChecked())) { await recent.check(); await page.waitForTimeout(1500); }
    const summary = await page.locator("#kwr-summary").innerText();
    check(summary.includes(lang === "fr" ? "Il sera ignoré" : "It will be skipped"), `${lang}: the dialog says Yandex will be skipped`);
    check(!/Runs out after|S'arrête après/.test(summary), `${lang}: no false "runs out" warning`);
    await page.screenshot({ path: `${out}/refresh-${lang}-dialog.png` });
    await page.click("#kwr-confirm");
    await page.waitForFunction(() => /Finished|Terminé|Stopped|Arrêté/.test(document.querySelector("#tray .tray-title")?.textContent || ""), null, { timeout: 120000 });
    await page.waitForTimeout(2500);
    const tray = await page.locator("#tray").innerText();
    console.log("   tray:", tray.replace(/\s+/g, " "));
    check(/Finished|Terminé/.test(tray), `${lang}: the run finishes, not Stopped`);
    check(/Yandex/.test(tray), `${lang}: and says Yandex was skipped`);
    await page.screenshot({ path: `${out}/refresh-${lang}-tray.png` });
    await r.browser.close();
  }
  console.log(fails.length ? `${fails.length} FAILED` : "all ok");
  process.exit(fails.length ? 1 : 0);
})();
