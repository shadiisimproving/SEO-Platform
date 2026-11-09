// Resources take a list of tags: pick from the list, type a new one, remove one, filter the table by tag.
// Run: DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8277 ; node tests/ui/flow_resource_tags.cjs http://127.0.0.1:8277/
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8277/";
const OUT = path.resolve("var/ui-resource-tags") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const RUN = Date.now().toString(36);
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const call = (method, p, body) => page.evaluate(([m, u, b]) => fetch(u, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [method, BASE + "api/" + p, body]);
  const texts = async (sel) => (await page.locator(sel).allTextContents()).map((s) => s.trim());
  await page.goto(BASE + "#today");
  await call("POST", "resources", { title: `Old report ${RUN}`, tags: ["Report"] });
  await page.goto("about:blank"); await page.goto(BASE + "#resources"); await page.waitForTimeout(1500);

  await page.click("[data-lv-resource=new]");
  await page.waitForSelector("#lv-resource-form [data-rs-tag-input]");
  await page.screenshot({ path: OUT + "1-empty-form.png" });
  const listed = await texts("[data-rs-tag-list] [data-rs-tag-toggle]");
  check("the list offers tags already used first, then the starters", listed[0] === "Report" && listed.includes("Brief") && listed.includes("Guide"), listed.join());

  await page.fill("#lv-resource-form [name=f_title]", `Onboarding brief ${RUN}`);
  await page.click('[data-rs-tag-toggle="Brief"]');
  check("clicking a listed tag picks it", (await page.locator('[data-rs-tag-toggle="Brief"][aria-pressed=true]').count()) === 1 && (await page.locator("[data-rs-picked] .rs-chip").count()) === 1);
  await page.click("[data-rs-tag-input]");
  await page.keyboard.type("Client  facing");
  check("typing a new word offers to add it", (await page.locator(".rs-chip-new").count()) === 1);
  await page.keyboard.press("Enter");
  await page.keyboard.type("gui");
  const filtered = await texts("[data-rs-tag-list] [data-rs-tag-toggle]");
  check("typing narrows the list, and still offers the word as typed", filtered.join("|") === "Guide|Add “gui”", filtered.join("|"));
  await page.keyboard.type("de");
  check("a known tag typed in full isn't offered twice", (await page.locator(".rs-chip-new").count()) === 0);
  await page.keyboard.press(",");
  await page.screenshot({ path: OUT + "2-three-tags.png" });
  let chips = await texts("[data-rs-picked] .rs-chip");
  check("Enter and comma both add, spaces tidied, known spelling kept (guide → Guide)", chips.join("|") === "Brief|Client facing|Guide", chips.join("|"));
  await page.keyboard.press("Backspace");
  chips = await texts("[data-rs-picked] .rs-chip");
  check("Backspace in an empty box removes the last tag", chips.join("|") === "Brief|Client facing", chips.join("|"));
  await page.click('[data-rs-tag-remove="Brief"]');
  await page.click('[data-rs-tag-toggle="Brief"]');
  await page.click("[data-rs-tag-input]");
  await page.keyboard.type("Login");
  await page.click("[data-lv-resource-save]");
  await page.waitForTimeout(1200);
  const saved = (await call("GET", "resources")).resources.find((r) => r.title === `Onboarding brief ${RUN}`);
  check("saved with every tag, including one typed without Enter", saved && saved.tags.join("|") === "Client facing|Brief|Login", saved && saved.tags.join("|"));

  await page.screenshot({ path: OUT + "3-table.png" });
  check("the table shows tags", (await page.locator("table .rs-tags .tag").count()) >= 4);
  await page.click('[data-rs-filter="Report"]');
  await page.waitForTimeout(300);
  const titles = await texts("table [data-lv-resource]");
  check("filtering by a tag shows only those", titles.includes(`Old report ${RUN}`) && titles.every((x) => x.startsWith("Old report")), titles.join()); // earlier runs leave their own Old report
  await page.screenshot({ path: OUT + "4-filtered.png" });
  await page.click('[data-rs-filter=""]');

  await page.click(`table [data-lv-resource="${saved.id}"]`);
  await page.waitForSelector("[data-rs-picked] .rs-chip");
  chips = await texts("[data-rs-picked] .rs-chip");
  check("editing shows the saved tags", chips.join("|") === "Client facing|Brief|Login", chips.join("|"));
  await page.click('[data-rs-tag-remove="Login"]');
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  await page.click(`table [data-lv-resource="${saved.id}"]`);
  await page.waitForSelector("[data-rs-picked] .rs-chip");
  chips = await texts("[data-rs-picked] .rs-chip");
  check("a closed draft brings its tags back", chips.join("|") === "Client facing|Brief", chips.join("|"));
  await page.screenshot({ path: OUT + "5-draft.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + "6-phone.png" });
  const real = problems.filter((p) => !/status of 404/.test(p)); // /api/auth/me answers 404 when the harness runs without --login
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "all passed");
  process.exit(bad ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
