// Settings → Team: the admin gives someone chosen access (sites, sections View/Edit, credits), sees it in the row,
// reopens it after a reload, and the person then sees only their own account in Settings.
// Needs a fresh server with a login and several own sites:
//   DB_POOL_SIZE=2 DB_MAX_OVERFLOW=6 DB_NAME_TEST=test_team_ui_test .venv/bin/python tests/ui/app_server.py --login --port 8231
// Run: node tests/ui/flow_team_access.cjs <folder for screenshots> http://127.0.0.1:8231/
const { open, menu } = require("./pw.cjs");
const out = process.argv[2] || "/tmp";
const BASE = process.argv[3] || "http://127.0.0.1:8231/";
const fails = [];
const note = (...a) => console.log(...a);
const check = (ok, what) => { note(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const settle = (page, ms = 400) => page.waitForTimeout(ms);
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });
const EMAIL = `lina${Date.now() % 100000}@example.com`;

async function signIn(page, email, password) {
  await page.goto(`${BASE}login`); await page.fill("#email", email); await page.fill("#password", password); await page.click("#go");
  await page.waitForFunction(() => !location.pathname.endsWith("/login") || !document.querySelector("#change")?.hidden, null, { timeout: 20000 });
}
async function openTeam(page) {
  await page.goto(`${BASE}#settings`); await page.waitForSelector('[data-lv-tab="team"]', { timeout: 20000 });
  await page.click('[data-lv-tab="team"]'); await page.waitForSelector("[data-lv-user-new]", { timeout: 15000 }); await settle(page);
}
const saveState = (page) => page.evaluate(() => ({ disabled: document.querySelector("[data-lv-access-save]")?.disabled, why: document.querySelector("#ax-why")?.textContent.trim() }));
const level = (page, key) => page.$eval(`#lv-access-form input[name="ax_${key}"]:checked`, (el) => el.value);

(async () => {
  const a = await open({ width: 1440, height: 900 });
  const { page } = a;
  await signIn(page, "admin@example.com", "demo-password-1");
  await openTeam(page);
  const sites = await page.evaluate(() => window.BOOT.sites);
  check(sites.length >= 2, `the demo world has several own sites (${sites.length})`);
  await shot(page, "01-team-list");

  // Add a person with chosen access. Save waits, with its reason, until a site and a section are picked.
  await page.click("[data-lv-user-new]"); await page.waitForSelector("#lv-access-form");
  check(await page.isHidden("#ax-chosen"), "full access is the default, with the choice folded away");
  await page.fill('#lv-access-form [name="f_name"]', "Lina Test"); await page.fill('#lv-access-form [name="f_email"]', EMAIL);
  await page.check('#lv-access-form input[name="f_role"][value="chosen"]'); await settle(page, 200);
  check(await page.isVisible("#ax-chosen"), "chosen access shows websites and sections");
  let s = await saveState(page);
  check(s.disabled && /website and one section/.test(s.why), `nothing ticked holds Add back with a reason ("${s.why}")`);
  await shot(page, "02-add-nothing-ticked");
  await page.check(`#lv-access-form input[name="ax_site"][value="${sites[0].id}"]`);
  s = await saveState(page);
  check(s.disabled && s.why === "Pick at least one section.", "a site but no section still says why");
  // Keyboard: the section switch is a real radio group, so arrows move within it.
  await page.focus('#lv-access-form input[name="ax_overview"][value="none"]'); await page.keyboard.press("ArrowRight");
  check(await level(page, "overview") === "view", "arrow keys move a section from No access to View");
  await page.click('#lv-access-form input[name="ax_keywords"][value="edit"]', { force: true });
  s = await saveState(page);
  check(!s.disabled && !s.why, "a site and a section let Add go");
  await page.$eval("#lv-access-form", (f) => f.scrollTop = 0);
  await shot(page, "03-add-chosen");
  await page.click("[data-lv-access-save]"); await page.waitForSelector(".lv-secret", { timeout: 10000 });
  const temp = (await page.textContent(".lv-secret code")).trim();
  await page.click("#panel [data-close-panel]"); await settle(page, 500);

  // The row answers first: a short summary and one button.
  const summary = async () => page.evaluate((email) => [...document.querySelectorAll(".data tbody tr")].find((r) => r.textContent.includes(email))?.querySelector("[data-ax-summary]")?.textContent.trim(), EMAIL);
  check(await summary() === "2 sections · 1 site · no credits", `the row says what they reach ("${await summary()}")`);
  await shot(page, "04-row-summary");

  // After a reload, Edit access shows what was saved.
  await page.reload(); await openTeam(page);
  const editButton = async () => page.evaluateHandle((email) => [...document.querySelectorAll(".data tbody tr")].find((r) => r.textContent.includes(email)).querySelector("[data-lv-user-access]"), EMAIL);
  await (await editButton()).click(); await page.waitForSelector("#lv-access-form");
  check(await page.isChecked('#lv-access-form input[name="f_role"][value="chosen"]'), "the editor reopens on chosen access");
  check(await page.isChecked(`#lv-access-form input[name="ax_site"][value="${sites[0].id}"]`) && !(await page.isChecked(`#lv-access-form input[name="ax_site"][value="${sites[1].id}"]`)), "only the saved site is ticked");
  check(await level(page, "overview") === "view" && await level(page, "keywords") === "edit" && await level(page, "tasks") === "none", "each section shows its saved level");
  check(!(await page.isChecked('#lv-access-form input[name="ax_spend"]')), "credits stay off");
  await shot(page, "05-edit-reopened");

  // Clearing every section holds Save back; All View, a second site and credits save.
  await page.click('[data-ax-all="none"]');
  s = await saveState(page);
  check(s.disabled && s.why === "Pick at least one section.", "No access on every section holds Save back");
  await page.click('[data-ax-all="view"]');
  check(await level(page, "health") === "view" && await level(page, "keywords") === "view", "All View sets every section");
  await page.check(`#lv-access-form input[name="ax_site"][value="${sites[1].id}"]`);
  await page.check('#lv-access-form input[name="ax_spend"]');
  await page.click("[data-lv-access-save]"); await page.waitForSelector("#panel", { state: "detached", timeout: 8000 }); await settle(page, 600);
  const all = sites.length === 2 ? "all sites" : "2 sites";
  // 18 since Social (2026-11-20) and Site map (2026-11-20) became sections of their own (seo/accounts/access.py SECTIONS).
  check(await summary() === `18 sections · ${all} · can spend credits`, `the row follows the change ("${await summary()}")`);

  // Back to the first choice for the sign-in below, then phone width and dark mode on the open editor.
  await (await editButton()).click(); await page.waitForSelector("#lv-access-form");
  await page.click('[data-ax-all="none"]');
  await page.click('#lv-access-form input[name="ax_overview"][value="view"]', { force: true });
  await page.click('#lv-access-form input[name="ax_keywords"][value="edit"]', { force: true });
  await page.uncheck(`#lv-access-form input[name="ax_site"][value="${sites[1].id}"]`);
  await page.uncheck('#lv-access-form input[name="ax_spend"]');
  await page.click("[data-lv-access-save]"); await page.waitForSelector("#panel", { state: "detached", timeout: 8000 }); await settle(page, 600);
  check(await summary() === "2 sections · 1 site · no credits", "narrowed again");

  await page.setViewportSize({ width: 390, height: 844 }); await settle(page, 400);
  await shot(page, "06-phone-team");
  await (await editButton()).click(); await page.waitForSelector("#lv-access-form"); await settle(page, 500);
  await shot(page, "07-phone-editor");
  await page.$eval("#lv-access-form", (f) => f.scrollTop = f.scrollHeight / 2); await settle(page, 200);
  await shot(page, "08-phone-editor-sections");
  const overflow = await page.evaluate(() => document.querySelector("#panel").scrollWidth > document.querySelector("#panel").clientWidth + 1);
  check(!overflow, "no sideways scroll in the editor at 390 px");
  await page.click("#panel [data-discard-panel]"); await settle(page, 300);
  await page.setViewportSize({ width: 1440, height: 900 }); await settle(page, 300);
  await menu(page, "theme"); await settle(page, 400);
  await (await editButton()).click(); await page.waitForSelector("#lv-access-form"); await settle(page, 500);
  await page.$eval("#lv-access-form", (f) => f.scrollTop = 320); await settle(page, 200);
  await shot(page, "09-dark-editor");
  await page.click("#panel [data-discard-panel]"); await settle(page, 300);
  await menu(page, "theme"); await settle(page, 300);
  check(a.problems.length === 0, `no errors on the admin's page${a.problems.length ? `: ${a.problems.slice(0, 3).join(" | ")}` : ""}`);
  await a.browser.close();

  // The person signs in: Settings is their own account and nothing else.
  const b = await open({ width: 1440, height: 900 });
  await signIn(b.page, EMAIL, temp);
  if (await b.page.isVisible("#change")) {
    await b.page.fill("#next", "lina-password-123"); await b.page.click("#l-save");
    await b.page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 });
  }
  await b.page.goto(`${BASE}#settings`); await b.page.waitForSelector(".ax-account", { timeout: 20000 }); await settle(b.page, 600);
  check(!(await b.page.$("[data-lv-tab]")), "no Settings tabs for chosen access");
  check(!(await b.page.$("[data-lv-user-new], .conn-row, [data-lv-open-conn]")), "no Team or connections for chosen access");
  check(/2 sections · 1 site · no credits/.test(await b.page.textContent(".ax-facts")), "their account says what they reach");
  await shot(b.page, "10-member-settings");
  // Change password from the account page, then sign in again with it.
  await b.page.fill('#ax-password [name="f_current"]', "wrong-password-1"); await b.page.fill('#ax-password [name="f_new"]', "lina-password-456");
  await b.page.click('#ax-password button[type="submit"]'); await settle(b.page, 800);
  check(!(await b.page.isHidden("[data-ax-pw-error]")), "a wrong current password says so");
  await b.page.fill('#ax-password [name="f_current"]', "lina-password-123");
  await b.page.click('#ax-password button[type="submit"]');
  const changed = await b.page.waitForFunction(() => document.querySelector('#ax-password [name="f_new"]')?.value === "", null, { timeout: 10000 }).then(() => true, () => false);
  check(changed && await b.page.isHidden("[data-ax-pw-error]"), "the password changes from My account");
  await b.page.setViewportSize({ width: 390, height: 844 }); await settle(b.page, 400);
  await shot(b.page, "11-member-settings-phone");
  const extra = b.problems.filter((p) => !/\b(400|403)\b|BAD REQUEST|FORBIDDEN/.test(p)); // 400: the wrong password tried on purpose
  check(extra.length === 0, `no errors on the person's page${extra.length ? `: ${extra.slice(0, 3).join(" | ")}` : ""}`);
  if (b.problems.length) note("   refusals seen:", b.problems.length, b.problems.slice(0, 3).join(" | "));
  await b.browser.close();

  note(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
