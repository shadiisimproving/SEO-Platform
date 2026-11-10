// Signing in the way a hurried person does (2026-11-10, agent C): a link opened while signed out lands where it pointed after
// sign-in; a session that ends mid-task keeps the half-typed task and signs in again in place; a Member sees admin controls
// greyed with the reason instead of failing on Save; the sign-in page follows dark mode and French.
// Needs the app with sign-in on (admin@example.com / demo-password-1), made-up data only:
//   DB_NAME_TEST=test_fixc_test .venv/bin/python tests/ui/app_server.py --port 8283 --keep --login
// Run: node tests/ui/flow_sign_in_return.cjs reports/sign-in http://127.0.0.1:8283/
const fs = require("fs");
const { open } = require("./pw.cjs");
const out = process.argv[2] || "reports/sign-in";
const BASE = process.argv[3] || "http://127.0.0.1:8283/";
fs.mkdirSync(out, { recursive: true });
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(false, `${name}: ${e.message.split("\n")[0]}`); } };
const signIn = async (page, email = "admin@example.com", password = "demo-password-1") => {
  await page.fill("#email", email); await page.fill("#password", password); await page.click("#go");
  await page.waitForTimeout(2500);
};

(async () => {
  const { browser, context, page, problems } = await open({ width: 1280, height: 860 });
  page.setDefaultTimeout(6000);
  page.on("crash", () => console.log("     (the page crashed)"));
  const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });

  await step("a link opened while signed out", async () => {
    await page.goto(`${BASE}#keywords?q=lyon`); await page.waitForTimeout(1200);
    check(page.url().includes("/login"), "signed out, the app sends you to the sign-in page");
    check((await page.textContent("#forgot")).includes("admin"), "the page says what to do about a forgotten password");
    await signIn(page);
    check(page.url().includes("#keywords") && page.url().includes("q=lyon"), `after sign-in you land where the link pointed (${page.url().replace(BASE, "/")})`);
  });

  await step("the session ends in the middle of a task", async () => {
    await page.click('[data-go="tasks"]'); await page.waitForTimeout(1500);
    await page.locator("#tk-new, [data-task-new], button:has-text('New task')").first().click(); await page.waitForTimeout(700);
    const title = page.locator("#panel input[name], #panel input").first();
    await title.fill("Rewrite the made-up pricing page");
    // The session ends (it expired, or was signed out elsewhere): the cookie is gone, this page doesn't know yet.
    await context.clearCookies();
    await page.click("#task-save"); await page.waitForTimeout(1500);
    check(!page.url().includes("/login"), "the page stays (no jump to the sign-in page)");
    check(Boolean(await page.$("dialog#resign[open]")), "a sign-in box opens on top");
    await shot("01-resign");
    check((await page.locator("#panel input").first().inputValue()) === "Rewrite the made-up pricing page", "the half-typed task is still there");
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    check(Boolean(await page.$("dialog#resign[open]")), "Esc doesn't throw the sign-in box away");
    await page.fill("#resign-password", "wrong-password-1"); await page.click("#resign-go"); await page.waitForTimeout(1000);
    check(!(await page.locator("#resign-err").isHidden()), "a wrong password says so in the box");
    await page.fill("#resign-password", "demo-password-1"); await page.click("#resign-go"); await page.waitForTimeout(1500);
    check(!(await page.$("dialog#resign")), "signing in closes the box");
    await shot("01b-after-resign");
    await page.click("#task-save"); await page.waitForTimeout(1500);
    const saved = await page.evaluate(async () => (await (await fetch("api/tasks")).json()).tasks.some((t) => t.title === "Rewrite the made-up pricing page"));
    check(saved, "pressing Save again saves the task");
  });

  await step("a Member in Settings", async () => {
    // create through the real route, as the admin, with the CSRF token the page holds
    const member = await page.evaluate(async () => {
      const me = await (await fetch("api/auth/me")).json();
      const r = await fetch("api/team", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrf }, body: JSON.stringify({ email: `member${Date.now() % 100000}@example.com`, name: "Made-up member", role: "member" }) });
      return { status: r.status, body: await r.json() };
    });
    check(member.status === 200 || member.status === 201, `an admin can add a Member (${member.status})`);
    const email = member.body?.user?.email || member.body?.email;
    const m = await open({ width: 1280, height: 860 });
    await m.page.goto(`${BASE}login`); await signIn(m.page, email, member.body?.temporary_password);
    if (await m.page.isVisible("#change")) { await m.page.fill("#next", "member-password-2"); await m.page.click("#l-save"); await m.page.waitForTimeout(2500); }
    m.page.setDefaultTimeout(6000);
    await m.page.goto(`${BASE}#settings`); await m.page.waitForTimeout(2500);
    await m.page.locator("[data-conn]").first().click(); await m.page.waitForTimeout(1200);
    await m.page.screenshot({ path: `${out}/02-member-panel.png` });
    const save = m.page.locator("#conn-save");
    check((await save.count()) === 0 || (await save.isDisabled()), "Save is greyed for a Member");
    check((await m.page.locator("#panel .member-note").count()) === 1, "one line says only an admin can change it");
    await m.browser.close();
  });

  await step("the sign-in page in dark mode and French", async () => {
    const d = await open({ width: 390, height: 800 });
    await d.context.clearCookies();
    await d.page.emulateMedia({ colorScheme: "dark" });
    await d.page.goto(`${BASE}login`); await d.page.waitForTimeout(600);
    check((await d.page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "a dark computer gets a dark sign-in page");
    await d.page.evaluate(() => localStorage.setItem("seocc2-lang", "fr")); await d.page.reload(); await d.page.waitForTimeout(500);
    check((await d.page.textContent("#go")).includes("Connexion"), "French when the app was used in French");
    await d.page.screenshot({ path: `${out}/03-dark-fr-phone.png` });
    await d.browser.close();
  });

  const real = problems.filter((p) => !/status of 40[13]/.test(p));
  check(!real.length, `no script errors (${real.slice(0, 3).join(" | ")})`);
  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
