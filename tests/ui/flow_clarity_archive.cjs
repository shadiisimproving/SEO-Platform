// The old Clarity archive, driven by hand like a normal user, on the real file made by scripts/clarity_archive_export.py.
// Needs: .venv/bin/python scripts/clarity_archive_export.py, then
//        DB_NAME_TEST=test_clarchive_test .venv/bin/python tests/ui/app_server.py --port 8218 --empty --login
// Usage: SCREENS_URL=http://127.0.0.1:8218/ node tests/ui/flow_clarity_archive.cjs [folder for screenshots]
const path = require("path");
const fs = require("fs");
const os = require("os");
const { open } = require("./pw.cjs");

const ROOT = process.env.SCREENS_URL || "http://127.0.0.1:8218/";
const SHOTS = process.argv[2];
const FILE = path.join(__dirname, "..", "..", "var", "clarity-archive.json");
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `: ${JSON.stringify(detail).slice(0, 400)}`}`); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };

(async () => {
  const { browser, page, problems } = await open({ height: 1000 });
  const bad = [];
  page.on("response", (r) => { if (r.status() >= 500) bad.push(`${r.status()} ${r.url()}`); });

  await page.goto(ROOT);
  await page.fill("#email", "admin@example.com");
  await page.fill("#password", "demo-password-1");
  await page.click("#go");
  await page.waitForSelector("[data-go]");

  // Only one of the three old sites is in the app so far.
  await page.locator('[data-go="today"]').first().click();
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await page.locator('input[placeholder="https://"]').first().fill("https://www.creer-societe-dubai.fr/");
  await page.getByRole("button", { name: "Add", exact: true }).last().click();
  await page.waitForTimeout(1500);

  const openPanel = async () => {
    await page.goto(`${ROOT}#settings`);
    await page.reload();
    await page.waitForSelector('[data-conn="clarity"]');
    await page.locator('[data-conn="clarity"]').click();
    await page.waitForSelector("#ca-fold");
    await page.locator("#ca-fold summary").click();
  };
  await openPanel();
  check("the panel offers the old data", await page.locator("#ca-file").isVisible());
  await shot(page, "1-panel");

  // A hurried person picks the wrong file first.
  const wrong = path.join(os.tmpdir(), "wrong-clarity.csv");
  fs.writeFileSync(wrong, "a,b\n1,2\n");
  await page.setInputFiles("#ca-file", wrong);
  await page.waitForSelector("#ca-result .error");
  check("the wrong file gets a plain answer", (await page.locator("#ca-result").innerText()).includes(".json"));
  await shot(page, "2-wrong-file");

  await page.setInputFiles("#ca-file", FILE);
  await page.waitForSelector("#ca-import");
  let said = await page.locator("#ca-result").innerText();
  check("the preview counts the site's days", said.includes("creer-societe-dubai.fr") && said.includes("34 days to add"), said);
  check("the preview names the sites not in the app", said.includes("comptabilite-dubai.com") && said.includes("business-setup-dubai.com"), said);
  await shot(page, "3-preview");

  await page.locator("#ca-import").click();
  await page.waitForFunction(() => document.querySelector("#ca-result")?.innerText.includes("Content"));
  said = await page.locator("#ca-result").innerText();
  check("the import says what it added", said.includes("34 days added"), said);
  await shot(page, "4-added");

  // Uploading again changes nothing.
  await page.setInputFiles("#ca-file", []);
  await page.setInputFiles("#ca-file", FILE);
  await page.waitForFunction(() => document.querySelector("#ca-result")?.innerText.includes("Nothing new"));
  said = await page.locator("#ca-result").innerText();
  check("a second upload adds nothing", said.includes("0 days to add") && said.includes("34 days already here") && !(await page.locator("#ca-import").count()), said);

  // Clarity must still say it isn't connected: an upload is not a pull.
  await page.goto(`${ROOT}#settings`);
  await page.reload();
  await page.waitForSelector("#conn-clarity");
  check("Clarity still says not connected", (await page.locator("#conn-clarity").innerText()).includes("Not connected"));

  // The days show on Content for a period that holds them, with no Google data beside them.
  await page.locator('[data-go="content"]').first().click();
  await page.waitForTimeout(800);
  const pickPeriod = async (from, to) => {
    await page.locator("button:has-text('Last 30 days'), button:has-text(' – ')").first().click();
    await page.locator("#dp-from").fill(from);
    await page.locator("#dp-to").fill(to);
    await page.locator("#dp-apply").click();
    await page.waitForFunction(() => document.querySelector("main")?.innerText.includes("Clarity sessions"), null, { timeout: 8000 });
  };
  await pickPeriod("2026-07-01", "2026-07-31");
  let screen = (await page.locator("main").first().innerText()).replace(/\s+/g, " ");
  await shot(page, "5-content-july");
  check("July shows its sessions with no Google data", screen.includes("Clarity sessions") && screen.includes("Connect"), screen.slice(0, 300));
  check("July's clicks are unknown, not zero", /Rage clicks\s*—/.test(screen) && /Dead clicks\s*—/.test(screen) && /Scroll depth\s*—/.test(screen), screen.slice(0, 400));
  check("the screen says why they're unknown", screen.includes("31 days here have Clarity sessions only"), screen.slice(0, 400));

  await page.goto("about:blank");
  await page.goto(`${ROOT}#content`);
  await page.waitForSelector("[data-go]");
  await pickPeriod("2026-08-09", "2026-08-09");
  screen = (await page.locator("main").first().innerText()).replace(/\s+/g, " ");
  await shot(page, "6-content-aug9");
  check("the day from the API has its scroll depth", /Scroll depth\s*68/.test(screen), screen.slice(0, 400));
  check("a real zero stays a zero", /Rage clicks\s*0/.test(screen), screen.slice(0, 400));

  // The wrong file above answers 400 on purpose, and the browser logs that. Anything else is a real problem.
  const real = problems.filter((p) => !p.includes("status of 400"));
  check("no browser errors", real.length === 0, real);
  check("no server errors", bad.length === 0, bad);
  await browser.close();
  console.log(`${results.filter(Boolean).length} of ${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error("FLOW FAILED", e.message); process.exit(1); });
