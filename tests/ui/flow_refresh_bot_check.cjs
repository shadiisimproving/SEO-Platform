// A tool blocked by a bot check, from the Keywords screen: the tray gives the real reason (not "out of credits"),
// the next automatic Refresh skips the tool and says so, ticking it by hand warns first, and the tray never sits under Notes.
// Needs a server where DuckDuckGo direct always gets a bot check and another tool covers DuckDuckGo. Made-up sites only.
//   DB_NAME_TEST=test_botcheck_test .venv/bin/python tests/ui/botcheck_server.py --port 8247
//   node tests/ui/flow_refresh_bot_check.cjs http://127.0.0.1:8247/
const { open, menu } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8247/";
const OUT = path.resolve("var/ui-refresh-bot-check") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
const overlap = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  const settle = () => page.waitForTimeout(900);
  const dialogFor = async (engine) => {
    await page.click("#kwr-refresh"); await settle();
    for (const box of await page.$$("[data-kwr-engine]")) {
      const id = await box.getAttribute("data-kwr-engine");
      if ((await box.isChecked()) !== (id === engine)) await box.click();
    }
    await settle();
    const again = await page.$("#kwr-recent"); // a rerun finds them just checked: check them again
    if (again && !(await again.isChecked())) { await again.click(); await settle(); }
  };

  await page.goto(BASE + "#keywords"); await settle();
  await dialogFor("duckduckgo");
  const fresh = !/Skipped/.test(await page.textContent("#kwr-tool-list"));
  if (fresh) check("before any bot check, nothing says Skipped", true);
  else console.log("SKIP  before any bot check: an earlier run left the block (restart the server for a clean start)");
  await page.screenshot({ path: OUT + "1-dialog-before.png" });
  await page.click("#kwr-confirm");

  await page.waitForFunction(() => /continuing with/.test(document.querySelector(".tray-msg")?.textContent || ""), null, { timeout: fresh ? 15000 : 3000 }).catch(() => {});
  const running = (await page.textContent(".tray-msg").catch(() => "")) || "";
  if (fresh) check("the tray gives the real reason a tool handed over", /DuckDuckGo direct was blocked by a bot check, continuing with Bright Data/.test(running), running);
  check("the tray no longer says out of credits", !/out of credits/i.test(running));
  const tray = await page.locator("#tray").boundingBox(), notes = await page.locator("#nb-fab").boundingBox();
  check("the tray doesn't sit on the Notes button", notes && tray && !overlap(tray, notes), JSON.stringify({ tray, notes }));
  await page.screenshot({ path: OUT + "2-tray-running.png" });
  await page.waitForFunction(() => /Finished|Stopped/.test(document.querySelector(".tray-title")?.textContent || document.querySelector("#tray .top")?.textContent || ""), null, { timeout: 60000 }).catch(() => {});
  await page.screenshot({ path: OUT + "3-tray-finished.png" });
  await page.waitForTimeout(9500); // the finished tray goes away by itself

  await dialogFor("duckduckgo");
  const ddgRow = page.locator('[data-kwr-tool-row="DuckDuckGo direct"]');
  check("the next automatic Refresh says DuckDuckGo direct is skipped", /Skipped: bot check/.test(await ddgRow.textContent()), await ddgRow.textContent());
  check("its checks go to the next tool", /\d+ checks?/.test(await page.locator('[data-kwr-tool-row="Bright Data"]').textContent()));
  check("Confirm still works", !(await page.isDisabled("#kwr-confirm")));
  await page.screenshot({ path: OUT + "4-dialog-skipped.png" });

  await page.click('[data-kwr-mode="pick"]'); await settle();
  for (const box of await page.$$("[data-kwr-tool]")) if (await box.isChecked()) await box.click();
  await page.click('[data-kwr-tool="DuckDuckGo direct"]'); await settle();
  const warn = (await page.textContent("#kwr-summary")) || "";
  check("ticked by hand, it warns before Confirm and names the tool to use", /DuckDuckGo direct hit a bot check .* so it will probably stop at once\. Pick one of these instead: Bright Data\./.test(warn), warn);
  check("Confirm stays possible: it's the person's choice", !(await page.isDisabled("#kwr-confirm")));
  await page.screenshot({ path: OUT + "5-dialog-picked-warning.png" });
  await page.click("[data-close-dlg]");

  await menu(page, "lang"); await settle();
  await dialogFor("duckduckgo");
  const fr = await page.locator('[data-kwr-tool-row="DuckDuckGo direct"]').textContent();
  check("in French too", /Écarté : vérification anti-robot/.test(fr), fr);
  await page.screenshot({ path: OUT + "6-dialog-fr.png" });
  await page.click("[data-close-dlg]");
  await menu(page, "lang");

  await page.setViewportSize({ width: 390, height: 800 }); await page.goto("about:blank"); await page.goto(BASE + "#keywords"); await settle();
  await dialogFor("duckduckgo"); await page.click("#kwr-confirm");
  await page.waitForSelector("#tray", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const phoneTray = await page.locator("#tray").boundingBox(), phoneNotes = await page.locator("#nb-fab").boundingBox().catch(() => null);
  check("on a phone the tray doesn't sit on Notes either", !phoneNotes || !overlap(phoneTray, phoneNotes), JSON.stringify({ phoneTray, phoneNotes }));
  check("and stays inside the screen", phoneTray && phoneTray.x >= 0 && phoneTray.x + phoneTray.width <= 390);
  await page.screenshot({ path: OUT + "7-phone-tray.png" });

  const real = problems.filter((p) => !/status of 404/.test(p)); // the test server has no sign-in, so /api/auth/me answers 404
  check("no page errors", real.length === 0, real.slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "all passed", "· screenshots in", OUT);
  process.exit(bad ? 1 : 0);
})();
