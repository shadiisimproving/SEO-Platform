// A person's first hour: sign in, add a site, connect Google, pick properties, fetch data, read every screen that used to say Soon.
// Needs an empty app with sign-in, made-up data only (updated 2026-11-10: an app with no site now says "No site yet · Add a site"):
//   DB_NAME_TEST=test_fixc_test .venv/bin/python tests/ui/app_server.py --port 8283 --login --empty
// Run: OUT=<folder> BASE=http://127.0.0.1:8283 node tests/ui/flow_live_screens.cjs
const fs = require("fs");
const { open, menu } = require("./pw.cjs");
const OUT = process.env.OUT || "var/ui-live-screens", BASE = (process.env.BASE || "http://127.0.0.1:8283").replace(/\/$/, "");
fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
const fails = [];
const check = (ok, what, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${extra !== "" ? `  [${extra}]` : ""}`); if (!ok) fails.push(what); };
(async () => {
  const { browser, page, problems } = await open({ url: `${BASE}/` });
  page.setDefaultTimeout(10000);
  const say = (...a) => console.log("    ", ...a);
  check(page.url().includes("/login"), "signed out, the app sends you to sign in", page.url());
  await page.click("#go");
  check(/username and password/i.test(await page.textContent("#err")), "an empty sign-in says what's missing");
  await page.fill("#email", "admin@example.com"); await page.fill("#password", "wrong"); await page.click("#go");
  await page.waitForFunction(() => document.getElementById("err").textContent.includes("Wrong"));
  check(/Wrong username or password/.test(await page.textContent("#err")) && (await page.inputValue("#email")) === "admin@example.com", "a wrong password says so and keeps the email");
  await shot(page, "01-login-error");
  await page.fill("#password", "demo-password-1"); await page.click("#go");
  await page.waitForSelector(".nav-item");
  await page.waitForTimeout(800);
  await shot(page, "02-today-first");
  const nav = await page.$$eval(".nav-soon", (e) => e.map((x) => x.textContent.trim()));
  check(nav.length <= 1 && nav.every((n) => /Google Ads/.test(n)), "only Google Ads still says Soon", nav.join(", "));
  check((await page.evaluate(() => window.SITES.length)) === 0, "an empty app has no site, not sample ones");
  check(!(await page.evaluate(() => /Competitor A|Clarity data lost in 31/.test(document.body.innerText))), "no sample text on Today");
  await page.click('button[data-go="overview"]'); await page.waitForTimeout(800);
  await shot(page, "03-overview-no-site");
  check(/No site yet/.test(await page.textContent("#page")), "Overview with no site says so and offers to add one");
  // Add a site from there, as a person would: the button opens the site menu, then Add a site.
  await page.click("[data-lv-add-site]"); await page.waitForTimeout(300);
  await page.click("#popover [data-add-site]"); await page.waitForSelector("#site-form");
  await page.fill("#site-address", "https://site-one.example/");
  await page.click("#site-save"); await page.waitForTimeout(2500);
  check((await page.evaluate(() => window.SITES.map((s) => s.host))).includes("site-one.example"), "the site is added");
  await page.keyboard.press("Escape"); await page.waitForTimeout(300); // the setup panel that follows
  await page.click('button[data-go="overview"]'); await page.waitForTimeout(1200);
  await shot(page, "03b-overview-not-connected");
  check(Boolean(await page.$("[data-lv-connect]")), "with a site, Overview says Search Console isn't connected, with Connect");
  await page.click("[data-lv-connect]"); await page.waitForSelector("#conn-form");
  await page.check('input[name="google-type"][value="robot"]');
  await page.click("#conn-test"); await page.waitForTimeout(300);
  check(/Paste the key first/.test(await page.textContent("#conn-test-result")), "Test with nothing pasted says paste the key");
  await page.fill("#conn-json", '{"client_email": "half'); await page.click("#conn-save"); await page.waitForTimeout(400);
  check(/whole key file/.test(await page.textContent("#conn-test-result")), "half a key says to paste all of it");
  await page.fill("#conn-json", JSON.stringify({ client_email: "robot@team.iam.gserviceaccount.com", private_key: "-----BEGIN KEY-----x", private_key_id: "abcd9999" }));
  await page.click("#conn-test"); await page.waitForFunction(() => /works/.test(document.getElementById("conn-test-result")?.textContent || ""));
  await page.waitForTimeout(300);
  await shot(page, "04-google-tested");
  check(/works/.test(await page.textContent("#conn-test-result")), "Test says the key works");
  const first = await page.$eval('[data-prop="sc"]', (e) => e.dataset.site);
  check((await page.$$eval(`[data-prop="sc"][data-site="${first}"] option`, (o) => o.map((x) => x.value))).includes("sc-domain:mine-one.test"), "Search Console's properties are listed");
  say("ga options:", await page.$$eval(`[data-prop="ga4"][data-site="${first}"] option`, (o) => o.map((x) => x.textContent)));
  await page.selectOption(`[data-prop="sc"][data-site="${first}"]`, "sc-domain:mine-one.test");
  await page.selectOption(`[data-prop="ga4"][data-site="${first}"]`, "111222333");
  await page.click("#conn-save"); await page.waitForTimeout(1200);
  await shot(page, "05-settings-saved");
  check((await page.$$eval(".toast", (t) => t.map((x) => x.textContent.trim()))).some((x) => /saved/i.test(x)), "Save says the connection is saved");
  await page.click('[data-lv-tab="sites"]'); await page.waitForTimeout(300);
  await page.click("[data-lv-site-collect]"); await page.waitForTimeout(500);
  await shot(page, "06-sites-tab");
  await page.waitForTimeout(14000);
  await page.click('[data-lv-tab="team"]'); await page.waitForTimeout(600);
  await shot(page, "07-team");
  await page.click("[data-lv-user-new]"); await page.waitForSelector("#lv-access-form");
  await page.click("[data-lv-access-save]"); await page.waitForTimeout(300);
  check((await page.textContent("#lv-access-form [data-lv-form-error]")).trim().length > 5, "a blank person says what's missing");
  await page.fill('#lv-access-form [name="f_name"]', "Sara"); await page.fill('#lv-access-form [name="f_email"]', "Sara@Example.com");
  await page.click("[data-lv-access-save]"); await page.waitForSelector(".lv-secret");
  await shot(page, "08-temp-password");
  const temp = await page.textContent(".lv-secret code");
  await page.click("[data-close-panel]"); await page.waitForTimeout(300);
  for (const [route, name] of [["overview", "10-overview"], ["channels", "11-channels"], ["conversions", "12-conversions"], ["content", "13-content"], ["ai", "14-ai"], ["resources", "16-resources"], ["today", "17-today"]]) {
    await page.click(`button[data-go="${route}"]`); await page.waitForTimeout(900);
    await shot(page, name);
    const box = await page.$("#page .empty h3");
    say(route, "→", box ? `EMPTY: ${(await box.textContent()).trim()}` : "has data");
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `${route}: no sideways scroll`);
    check(!/That didn't load/.test(await page.textContent("#page")), `${route}: it loads`);
  }
  await page.click('button[data-go="overview"]'); await page.waitForTimeout(700);
  const chart = await page.$(".lv-chart svg");
  if (chart) { const b = await chart.boundingBox(); await page.mouse.move(b.x + b.width * .7, b.y + 60); await page.waitForTimeout(200); await shot(page, "18-overview-hover"); say("tooltip:", (await page.textContent(".lv-tip")).replace(/\s+/g, " ")); }
  check(Boolean(chart), "after the first pull, Overview has a chart");
  await page.click('[data-ov-line="position"]'); await page.waitForTimeout(300); await shot(page, "19-overview-position"); // the numbers on top switch the chart's lines since 2026-11-09
  await page.click("[data-ov-table]"); await page.waitForTimeout(300); await shot(page, "20-overview-table");
  await page.click('button[data-go="resources"]'); await page.waitForTimeout(300);
  await page.click('[data-lv-resource="new"]'); await page.waitForSelector("#lv-resource-form");
  await page.click("[data-lv-resource-save]"); await page.waitForTimeout(300);
  check((await page.textContent("#lv-resource-form [data-lv-form-error]")).trim().length > 5, "a blank resource says what's missing");
  await page.fill('#lv-resource-form [name="f_title"]', "Brief"); await page.fill('#lv-resource-form [name="f_url"]', "javascript:alert(1)");
  await page.click("[data-lv-resource-save]"); await page.waitForTimeout(300);
  check(/https/.test(await page.textContent("#lv-resource-form [data-lv-form-error]")), "a javascript: link is refused");
  await page.fill('#lv-resource-form [name="f_url"]', "https://docs.example/brief");
  await page.click("[data-lv-resource-save]"); await page.waitForTimeout(600);
  await shot(page, "21-resource-added");
  await menu(page, "lang"); await page.waitForTimeout(300);
  await menu(page, "theme"); await page.waitForTimeout(300);
  for (const [route, name] of [["overview", "30-fr-dark-overview"], ["channels", "31-fr-dark-channels"], ["content", "32-fr-dark-content"], ["today", "33-fr-dark-today"], ["settings", "34-fr-dark-settings"]]) {
    if (route === "settings") await menu(page, "settings"); else await page.click(`button[data-go="${route}"]`); // Settings is in the account menu
    await page.waitForTimeout(800); await shot(page, name);
  }
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(300);
  for (const [route, name] of [["overview", "40-phone-overview"], ["channels", "41-phone-channels"], ["today", "42-phone-today"], ["settings", "43-phone-settings"]]) {
    await page.evaluate((r) => { location.hash = `#${r}`; }, route); await page.waitForTimeout(800); await shot(page, name);
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `phone ${route}: no sideways scroll`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  // Sara's first login: the temporary password can't reach anything else.
  const second = await open({ url: `${BASE}/` });
  await second.page.fill("#email", "sara@example.com"); await second.page.fill("#password", temp); await second.page.click("#go");
  await second.page.waitForSelector("#change:not([hidden])");
  await shot(second.page, "50-first-login");
  await second.page.fill("#next", "short"); await second.page.click('#change button'); await second.page.waitForTimeout(300);
  check(/10/.test(await second.page.textContent("#err")), "a short new password says how long it must be");
  await second.page.fill("#next", "a much longer password"); await second.page.click('#change button');
  await second.page.waitForSelector(".nav-item"); await second.page.waitForTimeout(600);
  await menu(second.page, "settings"); await second.page.waitForTimeout(500);
  await second.page.click('[data-lv-tab="team"]'); await second.page.waitForTimeout(500);
  await shot(second.page, "51-member-team");
  check(!(await second.page.$("[data-lv-user-new]")), "a member can't add a person");
  await menu(second.page, "signout"); await second.page.waitForTimeout(600);
  check(second.page.url().includes("/login"), "signing out goes to the sign-in page");
  const real = [...new Set([...problems, ...second.problems])].filter((p) => !/status of 40[0134]/.test(p)); // 400: the blank and bad forms this flow sends on purpose
  check(!real.length, "no script errors", real.slice(0, 3).join(" | "));
  await second.browser.close();
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error("FLOW FAILED:", e.message); process.exit(1); });
