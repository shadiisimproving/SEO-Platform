// Chosen access as the person sees it: only their sections and sites, View only screens, links into other sections, no console noise.
// Needs a server with login, and a person with chosen access the admin made:
//   DB_NAME_TEST=test_access_ui_test .venv/bin/python tests/ui/app_server.py --login --port 8237
//   then, as admin, POST /api/team: helper@example.com, sites [1, 2], sections today:view, keywords:edit, backlinks:view,
//   competitors:view, tasks:edit, no credits; then set its password to helper-password-1 (must_change_password = 0).
// Run: node tests/ui/flow_chosen_access.cjs <folder for screenshots> http://127.0.0.1:8237/
const { open } = require("./pw.cjs");
const out = process.argv[2] || "/tmp";
const BASE = process.argv[3] || "http://127.0.0.1:8237/";
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const settle = (page, ms = 900) => page.waitForTimeout(ms);
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });

(async () => {
  const { browser, page } = await open({ width: 1440, height: 900 });
  const refused = [], errors = [];
  page.on("response", (r) => { if (r.status() === 403 && r.url().includes("/api/")) refused.push(r.url()); });
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${BASE}login`); await page.fill("#email", "helper@example.com"); await page.fill("#password", "helper-password-1"); await page.click("#go");
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 });
  await page.waitForSelector("#sidebar .nav-item", { timeout: 15000 }); await settle(page, 1500);

  const menu = await page.$$eval("#sidebar [data-go]", (els) => els.map((e) => e.dataset.go));
  check(JSON.stringify(menu.filter((x) => x !== "settings")) === JSON.stringify(["today", "keywords", "competitors", "tasks", "backlinks"]), `menu shows only their sections: ${menu}`);
  const groups = await page.$$eval("#sidebar .nav-group", (els) => els.map((e) => e.textContent.trim()));
  check(!groups.includes("Traffic") && !groups.includes("Health") && !groups.includes("Ads"), `no empty group headings: ${groups}`);
  await shot(page, "access-today");

  await page.click("#site-switch"); await settle(page, 400);
  const sites = await page.$$eval(".popover [data-pick-site]", (els) => els.map((e) => e.textContent.trim()));
  check(sites.length === 3 && sites.some((s) => /All sites/.test(s)) && !sites.some((s) => /three/.test(s)), `site menu: All sites + their 2 sites: ${sites}`);
  check(!(await page.$(".popover [data-add-site]")), "no Add a site");
  await page.keyboard.press("Escape");

  for (const route of ["keywords", "competitors", "tasks", "backlinks", "today"]) {
    await page.goto(`${BASE}#${route}`); await settle(page, 2200);
    await shot(page, `access-${route}`);
  }

  await page.goto(`${BASE}#backlinks`); await settle(page, 1500);
  check(Boolean(await page.$("#page .view-only-tag")), "Backlinks says View only");
  const editShown = await page.$$eval("#add-backlink, #bulk-import", (els) => els.filter((e) => !e.hidden && e.offsetParent).length);
  check(editShown === 0, "Backlinks has no add or import button");

  await page.goto(`${BASE}#health`); await settle(page, 1200);
  check(Boolean(await page.$(".no-access")), "an old link to Site health shows the no-access card");
  await shot(page, "access-no-access");
  await page.goto(`${BASE}#notes`); await settle(page, 800);
  check(Boolean(await page.$(".no-access")), "Notes too");
  check(!(await page.$("#nb-fab")), "no Notes button anywhere without Notes");

  await page.goto(`${BASE}#settings`); await settle(page, 1500);
  await shot(page, "access-settings");

  const errorsWhileUsing = errors.length;
  // The server refuses a change on a View only section, whatever the screen shows.
  const forced = await page.evaluate(async () => {
    const me = await (await fetch("api/auth/me")).json();
    const r = await fetch("api/backlinks", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrf }, body: JSON.stringify({ site_id: 1, source_url: "https://x.example/" }) });
    return { status: r.status, body: await r.json() };
  });
  check(forced.status === 403 && forced.body.no_access === true, `a forced Backlinks change is refused: ${JSON.stringify(forced)}`);
  const at = refused.findIndex((u) => u.endsWith("/api/backlinks"));
  if (at >= 0) refused.splice(at, 1);

  check(refused.length === 0, `no refused calls while using the screens: ${refused.join(", ")}`);
  check(errorsWhileUsing === 0, `no console errors while using the screens: ${errors.slice(0, 5).join(" | ")}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})();
