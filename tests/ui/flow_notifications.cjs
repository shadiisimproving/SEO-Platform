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
  const ids = (await call("GET", "notifications")).items.filter((i) => i.kind === "new_query").slice(0, 3).map((i) => i.id);
  check("the seed made new-search notifications", ids.length >= 2, ids.length);
  for (const id of ids) await call("POST", `notifications/${id}/read`, { read: false });

  for (const route of ["today", "overview", "keywords", "backlinks"]) {
    await page.goto("about:blank"); await page.goto(BASE + "#" + route); await page.waitForTimeout(1200);
    check(`the bell shows ${ids.length} on ${route}`, (await page.textContent("#bell-open .bell-count").catch(() => "")) === String(ids.length));
  }

  await page.goto("about:blank"); await page.goto(BASE + "#overview");
  await page.click("#bell-open"); await page.waitForTimeout(1500);
  check("the list stays open while Overview redraws", Boolean(await page.$("#bell-pop")));
  await page.screenshot({ path: OUT + "1-open.png" });
  const rows = await page.locator("#bell-pop .bell-row.unread").count();
  check("each unread one has a dot", rows === ids.length, rows);
  const first = await page.textContent("#bell-pop .bell-row .bell-title");
  check("the most shown search comes first", /trade licence/.test(first), first.trim());
  check("a row names its page, place and impressions", /\/prices\/.*Position 5\.4.*23 impressions/s.test(await page.textContent("#bell-pop .bell-row")));

  await page.locator("#bell-pop [data-bell-read]").first().click(); await page.waitForTimeout(300);
  check("✓ marks it read", (await page.textContent("#bell-open .bell-count")) === String(ids.length - 1));
  await page.locator("#bell-pop [data-bell-read]").first().click(); await page.waitForTimeout(300);
  check("and the circle makes it unread again", (await page.textContent("#bell-open .bell-count")) === String(ids.length));

  await page.locator("#bell-pop [data-bell-track]").first().click(); await page.waitForTimeout(800);
  const box = await page.inputValue("#panel-root textarea").catch(() => "");
  check("Track opens Add keywords with the search in it", /trade licence/.test(box), box);
  check("and closes the list", !(await page.$("#bell-pop")));
  await page.screenshot({ path: OUT + "2-track.png" });
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);

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
