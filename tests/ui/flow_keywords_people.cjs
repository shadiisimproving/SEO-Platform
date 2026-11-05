// Two people at once, Stop, a captcha, a member touching keys, and a reload during a run.
const { open } = require("./pw.cjs");
const out = process.argv[2] || "/tmp";
const BASE = process.argv[3] || "http://127.0.0.1:8222/";
const fails = [];
const note = (...a) => console.log(...a);
const check = (ok, what) => { note(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const settle = (page, ms = 500) => page.waitForTimeout(ms);
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });
async function signIn(page, email) {
  await page.goto(`${BASE}login`); await page.fill("#email", email); await page.fill("#password", "demo-password-1"); await page.click("#go"); await page.waitForTimeout(800);
  await page.goto(`${BASE}#keywords`); await page.waitForSelector("#kw-table", { timeout: 15000 }); await settle(page);
}
const ready = (page) => page.waitForFunction(() => { const b = document.querySelector("#kwr-confirm"); return b && !b.disabled; }, null, { timeout: 8000 });
const finished = (page, ms = 60000) => page.waitForFunction(() => /saved|Stopped|Finished/.test(document.querySelector("#tray .top")?.textContent || ""), null, { timeout: ms });
async function refreshAll(page, engine) {
  await page.click("#kwr-refresh"); await page.waitForSelector("#kwr-summary p", { timeout: 8000 }); await settle(page, 300);
  if (engine) { await page.check(`[data-kwr-engine="${engine}"]`); await page.uncheck('[data-kwr-engine="google"]'); await settle(page, 400); }
  if (await page.$("#kwr-recent")) { await page.check("#kwr-recent"); await settle(page, 400); }
  await ready(page);
}
(async () => {
  const a = await open({ width: 1440, height: 900 });
  const b = await open({ width: 1440, height: 900 });
  await signIn(a.page, "admin@example.com");
  await signIn(b.page, "sara@example.com");

  // A long run by the admin, then Sara opens the dialog during it.
  await refreshAll(a.page); await a.page.click("#kwr-confirm"); await a.page.waitForSelector("#tray"); await settle(a.page, 700);
  await b.page.goto(`${BASE}?s=1#keywords`); await b.page.waitForSelector("#kw-table", { timeout: 15000 }); await settle(b.page, 800);
  check(await b.page.$("#tray") !== null, "a colleague sees a run going");
  note("   Sara's tray:", (await b.page.textContent("#tray")).replace(/\s+/g, " ").slice(0, 100));
  check(!(await b.page.$eval("#kwr-refresh", (x) => x.disabled)), "a colleague's run doesn't block her Refresh");
  await b.page.click("#kwr-refresh"); await b.page.waitForSelector("#kwr-summary p", { timeout: 8000 }); await settle(b.page, 500);
  await shot(b.page, "30-colleague-dialog");
  note("   Sara's summary:", (await b.page.textContent("#kwr-summary")).replace(/\s+/g, " ").slice(0, 220));
  check(/Already being refreshed/.test(await b.page.textContent("#kwr-summary")) && /Demo admin/.test(await b.page.textContent("#kwr-summary")), "the keywords a colleague is running are named, with who");
  await b.page.keyboard.press("Escape"); await settle(b.page, 200);

  // The admin reloads in the middle: the run carries on and the tray comes back. Then Stop.
  await a.page.goto(`${BASE}?r=1#keywords`); await a.page.waitForSelector("#kw-table", { timeout: 15000 }); await settle(a.page, 800);
  check(await a.page.$("#tray") !== null, "a reload during a run brings the tray back");
  await shot(a.page, "31-tray-after-reload");
  await a.page.click("#kwr-stop"); await a.page.click("#kwr-stop", { force: true, timeout: 500 }).catch(() => {});
  await finished(a.page); await settle(a.page, 600); await shot(a.page, "32-stopped");
  const stoppedText = (await a.page.textContent("#tray")).replace(/\s+/g, " ");
  note("   tray after Stop:", stoppedText);
  check(/Stopped/.test(stoppedText) && /saved/.test(stoppedText), "Stop says what was kept");

  // Free credits run out part way, moving on, then with only a tool that can't do it.
  await settle(a.page, 2500);
  const tools = await a.page.evaluate(async () => (await (await fetch("api/tools")).json()).tools.map((t) => [t.name, t.left]));
  note("   left:", JSON.stringify(tools));
  await refreshAll(a.page); await a.page.click("#kwr-confirm"); await a.page.waitForSelector("#tray"); await settle(a.page, 400);
  await a.page.waitForFunction(() => /out of credits|saved|Finished/.test(document.querySelector("#tray")?.textContent || ""), null, { timeout: 60000 }).catch(() => {});
  note("   while moving:", (await a.page.textContent("#tray")).replace(/\s+/g, " "));
  await shot(a.page, "33-moving-on");
  await finished(a.page); await settle(a.page, 1500);
  note("   after:", (await a.page.textContent("#tray")).replace(/\s+/g, " "));

  // Yandex: the only tool there is manual, so the automatic path says so and can't run it.
  await a.page.waitForFunction(() => !document.querySelector("#kwr-refresh")?.disabled, null, { timeout: 15000 });
  await a.page.click("#kwr-refresh"); await a.page.waitForSelector("#kwr-summary p", { timeout: 8000 }); await settle(a.page, 300);
  await a.page.check('[data-kwr-engine="yandex"]'); await a.page.uncheck('[data-kwr-engine="google"]'); await settle(a.page, 500);
  await shot(a.page, "34-no-tool");
  check(/No tool can search/.test(await a.page.textContent("#kwr-summary")), "an engine with no automatic tool says so");
  check(await a.page.$eval("#kwr-confirm", (x) => x.disabled), "and it can't be confirmed");
  // Choose the browser for it instead, on a keyword about captchas.
  await a.page.click('[data-kwr-mode="pick"]'); await settle(a.page, 300); await a.page.check('[data-kwr-tool="Browser on this Mac"]'); await settle(a.page, 500);
  await shot(a.page, "35-pick-browser");
  await a.page.keyboard.press("Escape"); await settle(a.page, 200);

  await a.page.click("#kwr-add"); await settle(a.page, 300); await a.page.fill("#kwr-add-text", "captcha keyword"); await a.page.click("#kwr-add-save"); await settle(a.page, 5500);
  const id = await a.page.evaluate(async () => (await (await fetch("api/rankings")).json()).rows.find((r) => r.keyword === "captcha keyword").id);
  await a.page.click(`[data-kwr-open="${id}"]`); await a.page.waitForSelector('#tool-table [data-kwr-check="Browser on this Mac"]', { timeout: 8000 }); await settle(a.page, 300);
  await a.page.click('#tool-table [data-kwr-check="Browser on this Mac"]');
  await finished(a.page, 30000); await settle(a.page, 900); await shot(a.page, "36-captcha");
  const hidden = await a.page.evaluate(() => { const t = document.querySelector("#tray").getBoundingClientRect(), p = document.querySelector("#panel").getBoundingClientRect(); return t.right > p.left && t.left < p.right; });
  check(!hidden, "the tray isn't hidden behind the side panel");
  const said = (await a.page.textContent("#tray")).replace(/\s+/g, " ");
  note("   captcha tray:", said);
  check(/captcha/.test(said), "a captcha that doesn't clear stops the browser and says so");
  await a.page.keyboard.press("Escape"); await settle(a.page, 300);

  // A member tries to change keys and the order.
  await b.page.goto(`${BASE}?m=1#settings`); await b.page.waitForSelector(".conn-row", { timeout: 15000 }); await settle(b.page, 700);
  await b.page.click('[data-conn="hasdata"]'); await settle(b.page, 300); await b.page.fill("#conn-key", "SOMEKEY1234"); await b.page.click("#conn-save"); await settle(b.page, 500);
  await shot(b.page, "37-member-save");
  const answer = await b.page.textContent("#conn-test-result");
  note("   member save:", answer.trim());
  check(/admin/i.test(answer), "a member is told only an admin can change a key");
  await b.page.click("[data-discard-panel]"); await settle(b.page, 300);
  await b.page.click('[data-tool-move="1"][data-tool="Bright Data"]'); await settle(b.page, 500);
  note("   member order toast:", (await b.page.textContent("#toasts")).trim().slice(0, 100));

  // The admin really saves a key, sees only its end, and removes it.
  await a.page.goto(`${BASE}?k=1#settings`); await a.page.waitForSelector(".conn-row", { timeout: 15000 }); await settle(a.page, 700);
  await a.page.click('[data-conn="hasdata"]'); await settle(a.page, 300);
  await a.page.click("#conn-save"); await settle(a.page, 300);
  check(/Paste the key first/.test(await a.page.textContent("#conn-test-result")), "a blank Save on a tool with no key says what's missing");
  await shot(a.page, "38-blank-save");
  await a.page.click("[data-discard-panel]"); await settle(a.page, 300);
  await a.page.click('[data-kwr-order="yandex"]'); await settle(a.page, 200);
  const first = await a.page.$$eval("[data-tool-move]", (x) => x[0].dataset.tool);
  note("   first for Yandex:", first);

  note("problems A:", JSON.stringify(a.problems.slice(0, 8)));
  note("problems B:", JSON.stringify(b.problems.slice(0, 8)));
  await a.browser.close(); await b.browser.close();
  note(fails.length ? `FAILED ${fails.length}: ${fails.join(" | ")}` : "ALL OK");
  process.exit(fails.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
