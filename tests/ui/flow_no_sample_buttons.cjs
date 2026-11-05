// With a server, no button may load invented rows: they could be added to the real list by mistake.
// Needs the real app: DB_NAME_TEST=test_btn_test .venv/bin/python tests/ui/app_server.py --port 8220
// Usage: SCREENS_URL=http://127.0.0.1:8220/ node tests/ui/flow_no_sample_buttons.cjs
const { open } = require("./pw.cjs");

const ROOT = process.env.SCREENS_URL || "http://127.0.0.1:8220/";

(async () => {
  const { browser, page, problems } = await open({ height: 1000 });
  let missing = 0; // the harness has no login, so /api/auth/me answers 404 there and the browser logs that once
  page.on("response", (r) => { if (r.status() === 404 && r.url().includes("/api/auth/me")) missing++; });
  await page.goto(`${ROOT}#backlinks`);
  await page.waitForSelector("[data-go]");
  await page.waitForTimeout(800);
  await page.getByRole("tab", { name: /In consideration/ }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /Filter a backlink CSV/ }).first().click();
  await page.waitForSelector("#cleaner-drop");
  const cleaner = await page.locator("#cleaner-sample").count();
  console.log(`${cleaner === 0 ? "ok  " : "FAIL"} the CSV filter offers no sample file`);
  const real = problems.filter((p) => !p.includes("status of 404")).length + Math.max(0, problems.filter((p) => p.includes("status of 404")).length - missing);
  console.log(`${real === 0 ? "ok  " : "FAIL"} no browser errors`, real ? problems : "");
  await browser.close();
  process.exit(cleaner === 0 && real === 0 ? 0 : 1);
})().catch((e) => { console.error("FLOW FAILED", e.message); process.exit(1); });
