// CSV rows added to In consideration must still be there after a reload, with their status and owner, on the real app.
// On a fresh demo world each run (its made-up rows stay behind and are skipped as duplicates the second time):
//   DB_NAME_TEST=<your>_test .venv/bin/python tests/ui/app_server.py --port 8231
//   node tests/ui/flow_csv_prospects_saved.cjs http://127.0.0.1:8231/
const { open } = require("./pw.cjs");
const path = require("path"), fs = require("fs");
const BASE = process.argv[2] || "http://127.0.0.1:8231/";
const OUT = path.resolve("var/ui-csv-prospects") + "/";
fs.mkdirSync(OUT, { recursive: true }); // var/ isn't in the repo: a fresh copy has no folder to write the test file in
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const csv = OUT + "links.csv";
  fs.writeFileSync(csv, "Source url,Domain Authority,Spam Score\nhttps://blog.csv-one.example/post,40,3\nhttps://csv-two.example/page,20,10\nhttps://csv-two.example/again,20,10\nhttps://spam-csv.example/x,5,80\n");
  const { browser, page, problems } = await open({ width: 1440, height: 950, url: BASE + "#backlinks/consideration" });
  const missing = new Set(); page.on("response", (r) => { if (r.status() === 404) missing.add(new URL(r.url()).pathname); });
  const rows = () => page.locator("#pr-table tbody tr").count();
  const settle = () => page.waitForTimeout(700);
  await page.waitForSelector("#cleaner-open", { timeout: 20000 }); await settle();
  const start = await page.locator("#pr-table tbody tr").count();
  console.log("rows at start", start);

  // Import
  await page.click("#cleaner-open");
  await page.setInputFiles("#cleaner-file", csv);
  await page.waitForSelector("#cleaner-select-all");
  await page.click("#cleaner-select-all");
  await page.screenshot({ path: OUT + "1-import-window.png" });
  await page.click("#cleaner-add");
  await page.waitForSelector("#pr-table"); await settle();
  await page.screenshot({ path: OUT + "2-after-add.png" });
  const toastText = await page.locator(".toast").last().innerText().catch(() => "");
  console.log("toast:", JSON.stringify(toastText));
  check("two new rows, one per domain", (await rows()) === start + 2, await rows());
  check("toast says one was skipped", /1 skipped/.test(toastText), toastText);

  // Change status and owner on a saved row, then reload
  const row = page.locator("#pr-table tbody tr", { hasText: "csv-two.example" });
  await row.locator("[data-prospect-stage]").selectOption("agreed");
  await row.locator("[data-prospect-owner]").fill("Sara");
  await row.locator("[data-prospect-owner]").blur();
  await settle();
  await page.goto("about:blank"); await page.goto(BASE + "#backlinks/consideration");
  await page.waitForSelector("#pr-table", { timeout: 20000 }); await settle();
  await page.screenshot({ path: OUT + "3-after-reload.png" });
  check("rows still there after reload", (await rows()) === start + 2, await rows());
  const again = page.locator("#pr-table tbody tr", { hasText: "csv-two.example" });
  check("status survived reload", (await again.locator("[data-prospect-stage]").inputValue()) === "agreed");
  check("owner survived reload", (await again.locator("[data-prospect-owner]").inputValue()) === "Sara");
  check("file name still shown", (await again.innerText()).includes("links.csv"));
  check("authority kept", (await page.locator("#pr-table tbody tr", { hasText: "csv-one.example" }).innerText()).includes("40"));

  // Remove, undo, reload: it comes back with what was set
  await again.locator("[data-prospect-remove]").click(); await settle();
  check("removed from the screen", (await rows()) === start + 1, await rows());
  await page.locator(".toast button", { hasText: "Undo" }).last().click(); await settle(); await page.waitForTimeout(800);
  await page.goto("about:blank"); await page.goto(BASE + "#backlinks/consideration");
  await page.waitForSelector("#pr-table", { timeout: 20000 }); await settle();
  const restored = page.locator("#pr-table tbody tr", { hasText: "csv-two.example" });
  check("undo of a remove survives reload", (await restored.count()) === 1);
  check("undo kept status and owner", (await restored.locator("[data-prospect-stage]").inputValue()) === "agreed" && (await restored.locator("[data-prospect-owner]").inputValue()) === "Sara");

  // Remove for good, reload
  await restored.locator("[data-prospect-remove]").click(); await settle(); await page.waitForTimeout(500);
  await page.goto("about:blank"); await page.goto(BASE + "#backlinks/consideration");
  await page.waitForSelector("#cleaner-open", { timeout: 20000 }); await settle();
  check("a removed row stays removed after reload", (await page.locator("#pr-table tbody tr", { hasText: "csv-two.example" }).count()) === 0);

  // Import again, undo the whole add, reload
  const before = await rows();
  fs.writeFileSync(csv, "Source url,Domain Authority,Spam Score\nhttps://undo-one.example/a,10,1\nhttps://undo-two.example/b,12,1\n");
  await page.click("#cleaner-open");
  await page.setInputFiles("#cleaner-file", csv);
  await page.waitForSelector("#cleaner-select-all");
  await page.click("#cleaner-select-all");
  await page.click("#cleaner-add");
  await page.waitForSelector(".toast button"); await settle();
  await page.locator(".toast button", { hasText: "Undo" }).last().click(); await settle();
  await page.goto("about:blank"); await page.goto(BASE + "#backlinks/consideration");
  await page.waitForSelector("#cleaner-open", { timeout: 20000 }); await settle();
  check("undo of a whole import survives reload", (await rows()) === before, await rows());

  // Mistake a hurried person makes: double click on Add
  fs.writeFileSync(csv, "Source url,Domain Authority,Spam Score\nhttps://double-click.example/a,10,1\n");
  await page.click("#cleaner-open");
  await page.setInputFiles("#cleaner-file", csv);
  await page.waitForSelector("#cleaner-select-all");
  await page.click("#cleaner-select-all");
  await page.dblclick("#cleaner-add").catch(() => {});
  await settle();
  await page.goto("about:blank"); await page.goto(BASE + "#backlinks/consideration");
  await page.waitForSelector("#pr-table", { timeout: 20000 }); await settle();
  check("double click adds it once", (await page.locator("#pr-table tbody tr", { hasText: "double-click.example" }).count()) === 1);

  // Server failure: choices stay, nothing is lost
  await page.route("**/api/prospects", (r) => (r.request().method() === "POST" ? r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"The server had a problem."}' }) : r.continue()));
  fs.writeFileSync(csv, "Source url,Domain Authority,Spam Score\nhttps://fails.example/a,10,1\n");
  await page.click("#cleaner-open");
  await page.setInputFiles("#cleaner-file", csv);
  await page.waitForSelector("#cleaner-select-all");
  await page.click("#cleaner-select-all");
  await page.click("#cleaner-add"); await settle();
  await page.screenshot({ path: OUT + "4-server-failed.png" });
  check("window stays open on a failure", await page.locator("#dlg[open]").count() === 1);
  check("the error is readable inside the window", (await page.locator("#dlg #cleaner-save-error").innerText()).includes("Nothing was saved"));
  check("button usable again to retry", await page.locator("#cleaner-add").isEnabled());
  await page.unroute("**/api/prospects");
  await page.click("#cleaner-add"); await settle();
  check("retry saves it", (await page.locator("#pr-table tbody tr", { hasText: "fails.example" }).count()) === 1);

  console.log("404s:", [...missing]);
  console.log("browser problems:", problems.filter((p) => !/500/.test(p)).length ? problems : "none");
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
