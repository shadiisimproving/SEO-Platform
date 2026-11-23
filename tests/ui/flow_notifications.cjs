// The bell: a count in every topbar, the list, mark one read and back, Track opens Add keywords filled in, Mark all read,
// Escape, and the list staying open while a screen redraws after loading.
// DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8237, then
// DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/seed_new_queries.py, then node tests/ui/flow_notifications.cjs http://127.0.0.1:8237/
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8237/";
const OUT = path.resolve("var/ui-notifications") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  const failed = [];
  page.on("response", (r) => { if (r.status() >= 400 && !/api\/auth\/me/.test(r.url())) failed.push(`${r.status()} ${r.url()}`); }); // auth/me is 404 when login is off
  const call = (method, p, body) => page.evaluate(([m, u, b]) => fetch(u, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()), [method, BASE + "api/" + p, body]);
  await page.goto(BASE + "#today");
  await call("POST", "notifications/read-all", {});
  const group = (await call("GET", "notifications")).items.find((i) => i.kind === "new_queries");
  const searches = group ? group.detail.queries.map((q) => q.query) : [];
  check("the seed made one notification for the day's new searches", Boolean(group) && searches.length >= 2, searches.join(" | "));
  check("the search under 10 impressions isn't in it", !searches.some((q) => /48 hours/.test(q)));
  await call("POST", `notifications/${group.id}/read`, { read: false });

  for (const route of ["today", "overview", "keywords", "backlinks"]) {
    await page.goto("about:blank"); await page.goto(BASE + "#" + route); await page.waitForTimeout(1200);
    check(`the bell shows 1 on ${route}`, (await page.textContent("#bell-open .bell-count").catch(() => "")) === "1");
  }

  await page.goto("about:blank"); await page.goto(BASE + "#overview");
  await page.click("#bell-open"); await page.waitForTimeout(1500);
  check("the list stays open while Overview redraws", Boolean(await page.$("#bell-pop")));
  await page.screenshot({ path: OUT + "1-open.png" });
  check("the day's searches are one unread row with a dot", (await page.locator("#bell-pop .bell-row.unread").count()) === 1);
  const head = await page.textContent("#bell-pop .bell-site-head");
  check("the site is named once, with how many", /2 new/.test(head), head.replace(/\s+/g, " ").trim());
  const firstSearch = await page.textContent("#bell-pop .bell-group li");
  check("the best-placed search comes first, its place and impressions as numbers", /trade licence cost\s*5\.4\s*23/s.test(firstSearch), firstSearch.replace(/\s+/g, " ").trim());
  check("no sentences in the rows", !/Position|impressions/.test(await page.textContent("#bell-pop .bell-list")));

  await page.locator("#bell-pop [data-bell-read]").first().click(); await page.waitForTimeout(300);
  check("✓ marks it read", !(await page.$("#bell-open .bell-count")));
  await page.locator("#bell-pop [data-bell-read]").first().click(); await page.waitForTimeout(300);
  check("and the circle makes it unread again", (await page.textContent("#bell-open .bell-count")) === "1");

  await page.locator("#bell-pop [data-bell-track]").first().click(); await page.waitForTimeout(800);
  const box = await page.inputValue("#panel-root textarea").catch(() => "");
  check("+ on a search opens Add keywords with it in", /trade licence/.test(box), box);
  check("and closes the list", !(await page.$("#bell-pop")));
  await page.screenshot({ path: OUT + "2-track.png" });
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);

  await call("POST", `notifications/${group.id}/read`, { read: false });
  await page.goto("about:blank"); await page.goto(BASE + "#today"); await page.waitForTimeout(1200);
  await page.click("#bell-open"); await page.waitForTimeout(400);
  await page.locator("#bell-pop .bell-group [data-bell-go]").nth(1).click(); await page.waitForTimeout(2000);
  const landed = await page.evaluate(() => ({ route: window.UI.state.route, q: window.OV?.filters?.query?.q, mode: window.OV?.filters?.query?.q_mode }));
  check("a search opens Overview → Queries filtered to exactly it", landed.route === "overview" && landed.q === searches[1] && landed.mode === "exact", JSON.stringify(landed));
  await page.screenshot({ path: OUT + "2b-landed.png" });

  await call("POST", `notifications/${group.id}/read`, { read: false });
  await page.goto("about:blank"); await page.goto(BASE + "#overview"); await page.waitForTimeout(1200);
  await page.click("#bell-open"); await page.waitForSelector("#bell-read-all");
  await page.click("#bell-read-all"); await page.waitForTimeout(500);
  check("Mark all read clears the count", !(await page.$("#bell-open .bell-count")));
  check("on the server too", (await call("GET", "notifications")).unread === 0);
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  check("Escape closes it and gives focus back to the bell", !(await page.$("#bell-pop")) && (await page.evaluate(() => document.activeElement?.id)) === "bell-open");

  await page.setViewportSize({ width: 390, height: 800 });
  await page.click("#bell-open"); await page.waitForTimeout(300);
  const fits = await page.evaluate(() => { const r = document.getElementById("bell-pop").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; });
  check("it fits a phone, no sideways scroll", fits);
  await page.screenshot({ path: OUT + "3-phone.png" });

  const real = problems.filter((p) => !/Failed to load resource/.test(p));
  check("no page errors", real.length === 0, real.join(" | "));
  check("no failed requests", failed.length === 0, failed.join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})();
