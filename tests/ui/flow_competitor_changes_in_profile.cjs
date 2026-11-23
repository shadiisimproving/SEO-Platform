// Competitors, 2026-11-20 (the owner: "if I open the competitor page I cannot go back", and Changes "too much data, make it
// inside the competitor page"). Driven by hand:
// node tests/ui/flow_competitor_changes_in_profile.cjs <demo address>
// Needs the demo world: DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8463
// Checks: the Competitors screen has no Changes list and never asks for it, a card pressed anywhere opens the competitor's
// page, that page starts on its Changes tab, Back to competitors returns to the cards (also from another tab, by keyboard,
// and with the browser's Back), and Activity no longer repeats the list. Made-up sites only.
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = (process.argv[2] || "http://127.0.0.1:8463/").replace(/\/?$/, "/");
const OUT = path.resolve("var/ui-competitor-changes-in-profile") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const settle = (ms = 900) => page.waitForTimeout(ms);
  // Under 1600 px the cards start folded to a rail of logos (2026-11-20, flow_reading_competitors.cjs), which hides Open:
  // this flow is about the open cards.
  await page.addInitScript(() => { try { localStorage.setItem("seocc-cs-slim", "0"); } catch { /* a page without storage */ } });
  const asked = [];
  page.on("request", (r) => { if (r.url().includes("/api/collective/moves")) asked.push(r.url()); });
  const missing = []; // the demo harness has no sign-in, so /api/auth/me answers 404 on every screen: not counted
  page.on("response", (r) => { if (r.status() === 404 && !r.url().includes("/api/auth/me")) missing.push(r.url()); });
  await page.goto(`${BASE}?simple=1#competitors/summary?site=site-one.example`);
  await page.waitForSelector(".cs-cards .cs-card[data-cs-card]", { timeout: 20000 });
  await settle(1500);
  await page.screenshot({ path: OUT + "1-competitors.png" });

  // The cards screen keeps its own Changes list (read-like-a-person, 2026-11-20) until the owner picks one place for it
  // (integration 2026-11-23): this flow checks the competitor's page side only.

  // ---- a card opens the competitor's page, on Changes ----------------------------------------------------------------
  const first = await page.evaluate(() => document.querySelector(".cs-cards .cs-card[data-cs-card]").dataset.csCard);
  await page.click(`.cs-card[data-cs-card="${first}"] .cs-card-open`); // a card's press is the Changes filter here; Open opens the page
  await page.waitForSelector("#cl-profile-title", { timeout: 20000 });
  await settle();
  await page.screenshot({ path: OUT + "2-competitor-page.png" });
  check("Open on the card opens the competitor's page", Boolean(await page.$("#cl-profile-title")));
  const back = page.locator("[data-cl-back]");
  check("Back to competitors is on the page", (await back.count()) === 1 && (await back.isVisible()), await back.textContent().catch(() => ""));
  const order = await page.evaluate(() => [...document.querySelectorAll("[data-pt-tab]")].map((b) => `${b.dataset.ptTab}${b.getAttribute("aria-selected") === "true" ? "*" : ""}`));
  check("Changes is the first tab and the one open", order[0] === "changes*", order.join(" "));
  check("the changes list is on the page", Boolean(await page.$("#cl-timeline")));
  const rows = await page.locator("#cl-timeline tbody tr").count();
  check("it lists this competitor's changes", rows > 0, rows);

  // ---- Activity no longer repeats it --------------------------------------------------------------------------------
  await page.click('[data-pt-tab="activity"]');
  await settle(400);
  check("Activity has no changes list", !(await page.$("#cl-timeline")));
  check("Activity still shows how fast they publish", (await page.locator("#pt-panel .card").count()) > 0);
  await page.screenshot({ path: OUT + "3-activity.png" });

  // ---- back ----------------------------------------------------------------------------------------------------------
  await back.click();
  await page.waitForSelector(".cs-cards .cs-card[data-cs-card]", { timeout: 20000 });
  await settle();
  check("Back returns to the cards", !(await page.$("#cl-profile-title")) && (await page.locator(".cs-cards .cs-card[data-cs-card]").count()) > 0);
  await page.screenshot({ path: OUT + "4-back.png" });

  // The card's Open link, then the keyboard on Back.
  await page.click(`.cs-card[data-cs-card="${first}"] .cs-card-open`);
  await page.waitForSelector("#cl-profile-title", { timeout: 20000 });
  await settle();
  check("Open on the card opens the page again", Boolean(await page.$("#cl-profile-title")));
  check("opened again, it starts on Changes", await page.evaluate(() => document.querySelector('[data-pt-tab="changes"]')?.getAttribute("aria-selected") === "true"));
  await back.focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector(".cs-cards .cs-card[data-cs-card]", { timeout: 20000 });
  check("Back works from the keyboard", !(await page.$("#cl-profile-title")));

  // The browser's own Back button.
  await settle();
  await page.click(`.cs-card[data-cs-card="${first}"] .cs-card-open`); // the card's press filters the cards screen's Changes
  await page.waitForSelector("#cl-profile-title", { timeout: 20000 });
  await settle();
  await page.goBack();
  await settle(1500);
  check("the browser's Back returns to the cards", !(await page.$("#cl-profile-title")) && (await page.locator(".cs-cards .cs-card[data-cs-card]").count()) > 0, page.url().split("#")[1] || "");

  // ---- a phone -------------------------------------------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click(`.cs-card[data-cs-card="${first}"] .cs-card-open`);
  await page.waitForSelector("#cl-profile-title", { timeout: 20000 });
  await settle();
  const phone = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth > window.innerWidth + 1, back: document.querySelector("[data-cl-back]")?.getBoundingClientRect().height || 0 }));
  check("phone: no sideways scroll on the competitor's page", !phone.wide);
  check("phone: Back is big enough to press", phone.back >= 32, phone.back);
  await page.screenshot({ path: OUT + "5-phone.png" });

  const real = problems.filter((p) => !/status of 404/.test(p));
  check("no errors in the browser", real.length === 0 && missing.length === 0, [...real, ...missing].slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
  process.exit(bad ? 1 : 0);
})();
