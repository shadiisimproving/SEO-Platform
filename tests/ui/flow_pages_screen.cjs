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
  // The demo site has no real pictures: one page's picture is answered here, a tiny blue square.
  const BLUE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==", "base64");
  await page.route("**/img/abonnement.jpg", (route) => route.fulfill({ status: 200, contentType: "image/png", body: BLUE }));
  // The demo pages have no picture (a made-up address would fail on every other screen): one is added to the answers here.
  const PIC = "https://site-one.example/img/abonnement.jpg";
  await page.route("**/api/site-pages?*", async (route) => {
    const reply = await route.fetch(), body = await reply.json();
    for (const row of body.pages || []) if (row.path === "/abonnement/") row.image = PIC;
    await route.fulfill({ response: reply, json: body });
  });
  await page.route("**/api/site-pages/pictures", async (route) => {
    const reply = await route.fetch(), body = await reply.json();
    const site = (body.sites || {})["site-one.example"];
    if (site && site["/abonnement/"]) site["/abonnement/"][1] = PIC;
    await route.fulfill({ response: reply, json: body });
  });
  // The demo world has no links check: one broken link, two the checker couldn't verify and a redirect are added to the answer.
  await page.route("**/api/site-pages/profile?*", async (route) => {
    const reply = await route.fetch(), body = await reply.json();
    body.technical.links_at = body.technical.links_at || "2026-11-13T08:00:00";
    body.technical.links = [
      { category: "broken", target: "https://site-one.example/old-offer", status: 404, reason: "" },
      { category: "unverified", target: "https://www.facebook.com/siteone", status: 999, reason: "Refuses automated checks" },
      { category: "unverified", target: "https://wa.me/33600000000", status: null, reason: "The request failed" },
      { category: "redirect", target: "http://site-one.example/moulins", status: 301, reason: "" },
    ];
    await route.fulfill({ response: reply, json: body });
  });
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
  const firstRow = page.locator("#pg-table tbody tr").first();
  check("the page's title leads its row, its address under it", (await firstRow.locator(".pg-title").innerText()).includes("Abonnement café"));
  await page.waitForFunction(() => { const img = document.querySelector("#pg-table tbody tr .pthumb-img"); return img && img.complete && img.naturalWidth > 0; });
  check("the page's own picture sits beside its title", (await firstRow.locator(".pthumb-img").getAttribute("src")) === "https://site-one.example/img/abonnement.jpg");
  check("the picture is asked for without saying where from", (await firstRow.locator(".pthumb-img").getAttribute("referrerpolicy")) === "no-referrer");
  check("a page without a picture shows the site's icon in its place", (await page.locator("#pg-table tbody tr .pthumb-none").count()) === rows - 1);
  check("every row has a picture box, so titles line up", (await page.locator("#pg-table tbody tr .pthumb").count()) === rows);
  await page.screenshot({ path: `${shots}/list.png` });
  // A picture that no longer loads gives way to the site's icon.
  await firstRow.locator(".pthumb-img").evaluate((img) => { img.src = "https://site-one.example/img/gone.jpg"; });
  await page.waitForFunction((n) => document.querySelectorAll("#pg-table tbody tr .pthumb-none").length === n, rows);
  check("a broken picture gives way to the site's icon", true);

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
  const titleLink = page.locator("#topbar h1 a.head-link");
  check("the title itself opens the page in a new tab", (await titleLink.getAttribute("href")) === "https://site-one.example/abonnement/" && (await titleLink.getAttribute("target")) === "_blank");
  check("the page's address shows on hover, not as a line under the title", (await titleLink.getAttribute("data-tip")).endsWith("site-one.example/abonnement/") && !(await page.locator("#topbar").innerText()).includes("site-one.example/abonnement"));
  const tabs = ["search", "visits", "rankings", "backlinks", "tasks", "notes", "technical", "content"];
  for (const tab of tabs) {
    await page.locator(`#pg-tab-${tab}`).click();
    await settle(500);
    const text = (await page.locator("#pg-panel").innerText()).trim();
    check(`${tab} tab says something`, text.length > 10 && !/didn't load/i.test(text), text.slice(0, 60).replace(/\n/g, " | "));
  }
  await page.locator("#pg-tab-technical").click();
  await settle(400);
  const brokenRow = page.locator(".pg-fact", { hasText: "Broken links on it" });
  check("only the broken link is listed as broken", (await brokenRow.locator(":scope > dd > .pg-list li").count()) === 1 && (await brokenRow.locator(":scope > dd > .pg-list").innerText()).includes("old-offer"));
  check("links that couldn't be checked are one folded line, not broken", /2 links couldn't be checked/.test(await brokenRow.locator(".pg-unsure summary").innerText()) && !(await brokenRow.locator(".pg-unsure .pg-list").isVisible()));
  check("redirects have their own row", (await page.locator(".pg-fact", { hasText: "Links that redirect" }).count()) === 1);
  check("the Technical tab counts the health issue and the broken link, not the unverified ones", /Technical\s*2\b/.test((await page.locator("#pg-tab-technical").innerText()).replace(/\n/g, " ")));
  await page.screenshot({ path: `${shots}/page-technical.png` });
  await page.locator("#pg-tab-content").click();
  await settle(300);
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

  check("no page errors", !problems.filter((p) => !p.includes("auth/me") && !/ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(p)).length, problems.join(" | "));
  await browser.close();
  console.log(`${results.filter(Boolean).length} of ${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
