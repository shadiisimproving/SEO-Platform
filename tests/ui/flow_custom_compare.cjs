// Overview's comparison menu has "Custom dates…": pick the first day, the comparison runs as many days as the period,
// the head says those dates, the server compares with them, and a reload keeps the choice. Both head styles.
// Run: DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8291 ; node tests/ui/flow_custom_compare.cjs http://127.0.0.1:8291/
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8291/";
const OUT = path.resolve("var/ui-custom-compare") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  for (const simple of ["1", "0"]) {
    const { browser, context, page, problems } = await open({ width: 1440, height: 950 });
    await context.addInitScript((s) => { localStorage.setItem("seocc2-simple", s); if (!sessionStorage.getItem("cc-once")) { sessionStorage.setItem("cc-once", "1"); localStorage.removeItem("seocc2-range"); } }, simple);
    const asked = [];
    page.on("request", (r) => { if (/\/api\/search\//.test(r.url())) asked.push(r.url()); });
    await page.goto(BASE + "#overview");
    await page.waitForSelector("#compare");
    await page.waitForTimeout(1500);
    await page.click("#compare");
    const option = page.locator('#popover [data-compare="custom"]');
    check(`[simple=${simple}] menu offers Custom dates`, await option.count() === 1, await option.textContent().catch(() => ""));
    await page.screenshot({ path: `${OUT}menu-simple${simple}.png` });
    await option.click();
    const field = page.locator("#cmp-from");
    check(`[simple=${simple}] form opens with a first-day field`, await field.isVisible());
    const max = await field.getAttribute("max");
    const pick = await page.evaluate((m) => { const d = new Date(`${m}T00:00:00`); d.setDate(d.getDate() - 3); return d.toISOString().slice(0, 10); }, max);
    await field.fill(pick);
    await field.dispatchEvent("change");
    const sum = (await page.locator("#cmp-sum").textContent()).trim();
    check(`[simple=${simple}] summary shows the whole span`, /days|jours/.test(sum), sum);
    await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}form-simple${simple}.png`, clip: { x: 260, y: 0, width: 700, height: 320 } });
    // A day too late is refused in words, and Apply does nothing.
    const late = await page.evaluate((m) => { const d = new Date(`${m}T00:00:00`); d.setDate(d.getDate() + 5); return d.toISOString().slice(0, 10); }, max);
    await field.fill(late); await field.dispatchEvent("change");
    check(`[simple=${simple}] a day overlapping the period is refused`, /before|avant/.test(await page.locator("#cmp-sum").textContent()));
    await page.click("#cmp-apply");
    check(`[simple=${simple}] Apply with a bad day keeps the form`, await page.locator("#cmp-from").isVisible());
    await field.fill(pick); await field.dispatchEvent("change");
    asked.length = 0;
    await page.click("#cmp-apply");
    await page.waitForTimeout(2500);
    check(`[simple=${simple}] server asked with cfrom`, asked.some((u) => u.includes("compare=custom") && u.includes(`cfrom=${pick}`)), asked[0] || "none");
    const head = (await page.locator("#compare").textContent()).trim();
    check(`[simple=${simple}] head names the picked dates`, head.length > 0 && !/no comparison/i.test(head), head);
    await page.screenshot({ path: `${OUT}applied-simple${simple}.png` });
    await page.reload(); await page.waitForSelector("#compare"); await page.waitForTimeout(1500);
    check(`[simple=${simple}] reload keeps the custom comparison`, (await page.locator("#compare").textContent()).trim() === head, (await page.locator("#compare").textContent()).trim());
    check(`[simple=${simple}] no page errors`, problems.filter((p) => !/favicon|404/.test(p)).length === 0, problems.join(" | "));
    await browser.close();
  }
  console.log(bad ? `${bad} FAILED` : "ALL PASS");
  process.exit(bad ? 1 : 0);
})();
