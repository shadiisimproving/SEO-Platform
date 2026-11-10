// Google Ads is Soon. OpenRouter is off until a key is pasted, then a click summarises a competitor's change, and the answer is kept.
const { open, menu } = require("./pw.cjs");
const OUT = process.env.OUT, BASE = process.env.BASE;
let failed = 0;
// Competitors opens on all sites together. A site chip on a competitor's row opens its profile; since the 2026-11-09 redesign
// the timeline is on the profile's Activity tab, and a profile always opens on Keywords.
let opened = null;
async function activity(page) {
  await page.waitForSelector('[data-pt-tab="activity"]', { timeout: 8000 });
  await page.click('[data-pt-tab="activity"]');
  await page.waitForSelector("#cl-timeline", { timeout: 8000 }); await page.waitForTimeout(500);
}
async function toTimeline(page) {
  await page.waitForTimeout(900);
  const chip = await page.$("[data-cs-open]");
  if (chip) { opened = await chip.getAttribute("data-cs-open"); await chip.click(); await activity(page); }
}
const check = (ok, word) => { console.log(`${ok ? "ok  " : "FAIL"} ${word}`); if (!ok) failed++; };
(async () => {
  const { browser, page, problems } = await open({ url: `${BASE}/` });
  await page.fill("#email", "admin@example.com"); await page.fill("#password", "demo-password-1"); await page.click("#go");
  await page.waitForSelector(".nav-item"); await page.waitForTimeout(800);
  const soon = await page.$$eval(".nav-soon", (e) => e.map((x) => x.textContent.trim()));
  check(soon.length === 1 && soon[0].includes("Google Ads"), `only Google Ads says Soon (${JSON.stringify(soon)})`);
  check(!(await page.$('button[data-go="ads"]')), "Google Ads can't be clicked");
  await page.goto(`${BASE}/#ads`); await page.waitForTimeout(600);
  check((await page.textContent("h1")) !== "Google Ads", "typing its address doesn't open it");
  await menu(page, "settings"); await page.waitForTimeout(700);
  check(!(await page.$("#conn-googleads")), "Google Ads has left Settings");
  check(Boolean(await page.$("#conn-openrouter")), "OpenRouter is in Settings");
  check((await page.$eval("#conn-openrouter .conn-status", (e) => e.textContent.trim())) === "Not connected", "OpenRouter starts off");
  await page.click('button[data-go="competitors"]'); await toTimeline(page);
  check(Boolean(await page.$("#cl-timeline")), "a competitor's timeline is open");
  check(!(await page.$("[data-change-summary]")), "off means no button anywhere");
  await page.screenshot({ path: `${OUT}/s1-off.png` });
  await menu(page, "settings"); await page.waitForTimeout(500);
  await page.click('[data-conn="openrouter"]'); await page.waitForSelector("#conn-form");
  await page.screenshot({ path: `${OUT}/s2-panel.png` });
  await page.click("#conn-save"); await page.waitForTimeout(300);
  check(/Paste the key first/.test(await page.textContent("#conn-test-result")), "a blank Save says what's missing");
  await page.fill("#conn-key", "sk-or-fake-key-1234"); await page.click("#conn-test");
  await page.waitForFunction(() => /free requests/.test(document.getElementById("conn-test-result")?.textContent || ""));
  check(true, `Test says: ${(await page.textContent("#conn-test-result")).trim()}`);
  await page.click("#conn-save"); await page.waitForTimeout(900);
  await page.click('button[data-go="competitors"]'); await toTimeline(page);
  const button = await page.waitForSelector("[data-change-summary]", { timeout: 8000 }).catch(() => null);
  check(Boolean(button), "the button appears without a reload");
  if (button) {
    await button.scrollIntoViewIfNeeded(); await button.dblclick(); // a hurried double click still asks once
    await page.waitForSelector(".cs-summary", { timeout: 8000 });
    await page.waitForTimeout(300);
    await (await page.$(".cs-summary")).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/s3-summary.png` });
    check(/can be wrong/.test(await page.textContent(".cs-summary")), "it says AI wrote it and that it can be wrong");
    await page.reload(); await page.waitForTimeout(1500);
    await page.waitForTimeout(800); // a reload goes back to the list of competitors, so open the same one again
    const back = await page.$(`[data-cs-open="${opened}"]`);
    if (back) { await back.click(); await activity(page); }
    check(Boolean(await page.$(".cs-summary")), "after a reload the answer is still there");
    await menu(page, "lang"); await page.waitForTimeout(500);
    check((await page.$$eval("[data-change-summary]", (e) => e.length)) > 0, "in French it offers its own summary, not the English one");
    await menu(page, "theme"); await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/s4-fr-dark.png` });
    await menu(page, "lang"); await menu(page, "theme"); await page.waitForTimeout(300);
  }
  await page.click('button[data-go="today"]'); await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/s5-today.png` });
  await page.setViewportSize({ width: 375, height: 800 }); await page.waitForTimeout(300);
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "no sideways scroll on a phone");
  await page.setViewportSize({ width: 1440, height: 900 });
  const left = [...new Set(problems)].filter((x) => !/status of 40[01]/.test(x));
  check(!left.length, `no page errors ${JSON.stringify(left).slice(0, 300)}`);
  await browser.close();
  console.log(failed ? `FAILED ${failed}` : "ALL OK");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FLOW FAILED:", e.message); process.exit(1); });
