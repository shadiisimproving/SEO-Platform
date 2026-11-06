// Headless browser for driving the screens by hand from a script. Each script gets its own browser,
// so several can run at once without sharing a page. Usage: const { open } = require("./pw.cjs");
const { chromium } = require("/Users/alwaysimproving/.npm/_npx/9833c18b2d85bc59/node_modules/playwright");
async function open({ width = 1440, height = 900, url } = {}) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  if (url) await page.goto(url);
  return { browser, context, page, problems };
}
/* Dark mode, language, Settings and sign out sit in the account menu at the foot of the side menu (since 2026-11-06).
   menu(page, "lang" | "theme" | "settings" | "signout") opens it and presses that item. */
async function menu(page, item) {
  if (!(await page.$("#popover.acct-menu"))) await page.click("#acct-btn");
  const target = { lang: '#popover [data-mock="lang"]', theme: '#popover [data-mock="theme"]', settings: '#popover [data-go="settings"]', signout: "#popover [data-lv-signout]" }[item];
  await page.click(target);
}
module.exports = { open, menu };
