// By hand: the Pages screen. Every page of my site with what's linked to it, and one page with everything we know.
// Made-up demo world only.
//   DB_NAME_TEST=test_pagesflow_test .venv/bin/python tests/ui/app_server.py --port 8284 --login
// Usage: node tests/ui/flow_pages_screen.cjs [base url] [folder for screenshots]
const fs = require("fs");
const { open, menu } = require("./pw.cjs");
const base = process.argv[2] || "http://127.0.0.1:8284/";
const shots = process.argv[3] || "var/ui-pages-screen";
fs.mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`); };

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  page.setDefaultTimeout(10000);
  const settle = (ms = 500) => page.waitForTimeout(ms);
  await page.goto(`${base}login`);
  await page.fill("#email", "admin@example.com"); await page.fill("#password", "demo-password-1"); await page.click("#go");
  await settle(2500);
  await page.goto(`${base}?p=1#today?site=site-one.example`);
  await settle(1500);
  await page.locator('#sidebar [data-go="pages"], #sidebar a[href*="pages"]').first().click();
  await page.waitForSelector("#pg-table tbody tr");
  check("Pages is in the side menu and opens the list", (await page.locator("h1").innerText()).includes("Pages"));
  const rows = await page.locator("#pg-table tbody tr").count();
  check("one row per page", rows >= 5, `${rows} rows`);
  check("most clicks first", (await page.locator("#pg-table tbody tr").first().locator(".second").innerText()).includes("/abonnement"));
  await page.screenshot({ path: `${shots}/list.png` });

  await page.locator('[data-pg-filter="clicks"]').click();
  await settle(300);
  const withClicks = await page.locator("#pg-table tbody tr").count();
  check("Get clicks keeps only pages with clicks", withClicks > 0 && withClicks < rows, `${withClicks}`);
  await page.locator('[data-pg-filter="noclicks"]').click();
  await settle(300);
  check("No clicks keeps the rest", (await page.locator("#pg-table tbody tr").count()) === rows - withClicks);
  await page.locator('[data-pg-filter="links"]').click();
  await settle(300);
  check("Have backlinks keeps pages with links", (await page.locator("#pg-table tbody tr").count()) >= 1);
  check("Export is in the top bar", (await page.locator("header button, .topbar button").filter({ hasText: "Export" }).count()) >= 1);
  await page.locator('[data-pg-filter=""]').click();
  await page.locator(".tp-search input, input[type=search]").first().fill("brew");
  await settle(400);
  check("search narrows the list", (await page.locator("#pg-table tbody tr").count()) === 1);
  await page.locator(".tp-search input, input[type=search]").first().fill("");
  await settle(400);

  await page.locator("#pg-table tbody tr").first().locator("td").nth(2).click();
  await page.waitForSelector("#pg-tab-search");
  check("a row opens its page", /abonnement/i.test(await page.locator("h1").innerText()));
  check("the address names the page", page.url().includes("page=https://site-one.example/abonnement"));
  await settle(1200);
  check("the numbers lead: clicks shown", (await page.locator(".pg-num").first().innerText()).includes("154"));
  const tabs = ["search", "visits", "rankings", "backlinks", "tasks", "notes", "technical", "content"];
  for (const tab of tabs) {
    await page.locator(`#pg-tab-${tab}`).click();
    await settle(500);
    const text = (await page.locator("#pg-panel").innerText()).trim();
    check(`${tab} tab says something`, text.length > 10 && !/didn't load/i.test(text), text.slice(0, 60).replace(/\n/g, " | "));
  }
  check("Content shows the outline", (await page.locator(".pg-outline li").count()) >= 1);
  await page.screenshot({ path: `${shots}/page-content.png` });

  await page.locator("#pg-task").click();
  await settle(600);
  check("New task about this page comes with the page", (await page.locator('[data-ta-chips="page"] .tk-chip').innerText()).includes("abonnement"));
  await page.locator("#task-title").fill(`Rewrite the subscription intro ${Date.now().toString(36)}`);
  await page.locator("#task-save").click();
  await settle(900);
  await page.locator("#pg-tab-tasks").click();
  await settle(400);
  check("the new task shows on the page's Tasks tab", (await page.locator("#pg-panel .tk-rel-list li").count()) >= 1);

  await page.goBack();
  await page.waitForSelector("#pg-table tbody tr");
  check("Back returns to the list", (await page.locator("h1").innerText()).includes("Pages"));

  // Opened from a pasted link, All pages still goes to the list.
  await page.goto(`${base}?p=2#pages?site=site-one.example&page=https://site-one.example/guide/brew/&tab=backlinks`);
  await page.waitForSelector("#pg-tab-backlinks[aria-selected=true]");
  check("a pasted link opens the page on its tab", (await page.locator("#pg-panel").innerText()).length > 5);
  await page.locator("#pg-back").click();
  await page.waitForSelector("#pg-table");
  check("All pages goes to the list", true);

  // A Content row opens its page here.
  await page.goto(`${base}?p=3#content?site=site-one.example`);
  await page.waitForSelector("[data-pg-goto]");
  await page.locator("[data-pg-goto]").first().locator("td").nth(2).click();
  await page.waitForSelector("#pg-tab-search");
  check("a Content row opens the page on Pages", page.url().includes("#pages") && page.url().includes("page=https://site-one.example/"));

  // Phone and dark.
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(400);
  check("no sideways scroll on a phone", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await page.screenshot({ path: `${shots}/list-phone.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await menu(page, "theme");
  await settle(500);
  await page.screenshot({ path: `${shots}/list-dark.png` });

  check("no page errors", !problems.filter((p) => !p.includes("auth/me")).length, problems.join(" | "));
  await browser.close();
  console.log(`${results.filter(Boolean).length} of ${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
