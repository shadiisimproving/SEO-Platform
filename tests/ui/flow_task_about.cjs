// By hand: a task says what it's about. Each kind's box lists what the app already knows as soon as it's clicked,
// several kinds go on one task, and it all comes back after saving. Made-up demo world only.
//   DB_NAME_TEST=test_pagesflow_test .venv/bin/python tests/ui/app_server.py --port 8284 --login
// Usage: node tests/ui/flow_task_about.cjs [base url] [folder for screenshots]
const fs = require("fs");
const { open } = require("./pw.cjs");
const base = process.argv[2] || "http://127.0.0.1:8284/";
const shots = process.argv[3] || "var/ui-task-about";
fs.mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`); };
const TITLE = `Fix the coffee pages ${Date.now().toString(36)}`;

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  page.setDefaultTimeout(8000);
  const settle = (ms = 400) => page.waitForTimeout(ms);
  const chips = (kind) => page.locator(`[data-ta-chips="${kind}"] .tk-chip`).count();
  const listed = (kind) => page.locator(`#ta-pick-${kind}-list .pl-opt`).count();
  await page.goto(`${base}login`);
  await page.fill("#email", "admin@example.com"); await page.fill("#password", "demo-password-1"); await page.click("#go");
  await settle(2500);
  await page.goto(`${base}?a=1#tasks?site=site-one.example&view=kanban`);
  await page.waitForSelector(".topbar [data-task-new]");
  await page.locator(".topbar [data-task-new]").click();
  await settle();
  await page.locator("#task-title").fill(TITLE);
  check("About shows every kind, General included", (await page.locator("[data-ta-kind]").count()) === 9);

  await page.locator('[data-ta-kind="page"]').click();
  // The list asks the server once; on a busy machine the first answer can take over a second, so wait for it, not a fixed time.
  await page.waitForSelector("#ta-pick-page-list .pl-opt", { timeout: 15000 }).catch(() => {});
  await settle(300);
  const pages = await listed("page");
  check("Page: the site's pages show before typing", pages > 0, `${pages} pages`);
  check("each page shows its clicks", (await page.locator("#ta-pick-page-list .pl-opt .pl-fact").first().innerText()).includes("click"));
  await page.locator("#ta-pick-page-list .pl-opt").first().click();
  await page.locator("#ta-pick-page-list .pl-opt").first().click();
  check("two pages picked in a row", (await chips("page")) === 2);
  check("a picked page leaves the list", (await listed("page")) === pages - 2);

  for (const kind of ["keyword", "ranking", "backlink", "technical", "competitor", "domain", "note"]) {
    await page.locator(`[data-ta-kind="${kind}"]`).click();
    await settle(700);
    const n = await listed(kind);
    if (n) await page.locator(`#ta-pick-${kind}-list .pl-opt`).first().click();
    await settle(150);
    check(`${kind}: listed and picked`, n > 0 && (await chips(kind)) === 1, `${n} in the list`);
  }
  await page.locator("#ta-pick-technical").focus();
  await page.locator("#ta-pick-technical").fill("zzz nothing like this");
  await settle(200);
  check("Technical can't be typed: it says nothing matches", (await page.locator("#ta-pick-technical-list .pl-note").innerText()).length > 0);
  await page.keyboard.press("Enter");
  check("…and Enter adds nothing", (await chips("technical")) === 1);
  await page.locator("#ta-pick-technical").fill("");
  await page.keyboard.press("Escape");
  check("Esc closes the list, not the panel", (await page.locator("#task-form").count()) === 1);
  check("the first kind picked is the main one", (await page.locator('[data-ta-kind="page"].is-main').count()) === 1);
  await page.locator("#task-form").screenshot({ path: `${shots}/about-filled.png` });

  await page.locator("#task-save").click();
  await settle(1000);
  const card = page.locator("[data-task-card]").filter({ hasText: TITLE });
  check("the card names what it's linked to, main kind first", /^Pages?$/.test((await card.locator(".ta-pill-k").first().innerText()).trim()) && (await card.locator(".ta-pill").count()) >= 1);
  await card.locator(".tk-title").click();
  await settle(700);
  const back = { page: await chips("page"), keyword: await chips("keyword"), ranking: await chips("ranking"), backlink: await chips("backlink"), technical: await chips("technical"), competitor: await chips("competitor"), domain: await chips("domain"), note: await chips("note") };
  check("everything comes back when reopened", Object.values(back).every((n) => (n === 2 && back.page === 2) || n === 1), JSON.stringify(back));

  // General: only when nothing is linked.
  await page.locator('[data-ta-chips="ranking"] .tk-chip-x').click();
  await settle(200);
  check("x takes one out", (await chips("ranking")) === 0);
  await page.locator("[data-discard-panel]").click();
  await settle();
  await page.locator(".topbar [data-task-new]").click();
  await settle();
  await page.locator('[data-ta-kind="general"]').click();
  check("General can be chosen on a task linked to nothing", (await page.locator('[data-ta-kind="general"][aria-pressed="true"]').count()) === 1);
  await page.locator("[data-discard-panel]").click();

  await settle();
  const tech = await page.locator("[data-task-card]").filter({ hasText: TITLE }).count();
  check("the saved task is on the board", tech === 1);

  // Phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await card.locator(".tk-title").click();
  await settle(600);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("no sideways scroll on a phone", !wide);
  await page.screenshot({ path: `${shots}/about-phone.png` });

  check("no page errors", !problems.filter((p) => !p.includes("auth/me")).length, problems.join(" | "));
  await browser.close();
  console.log(`${results.filter(Boolean).length} of ${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
