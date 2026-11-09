// Headless browser for driving the screens by hand from a script. Each script gets its own browser,
// so several can run at once without sharing a page. Usage: const { open } = require("./pw.cjs");
// Playwright as installed normally, or else the copy npx keeps, wherever that is on this computer. PLAYWRIGHT_MODULE overrides both.
function findPlaywright() {
  if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE);
  try { return require("playwright"); } catch { /* not installed in this project: look in npx's cache */ }
  const fs = require("fs"), os = require("os"), path = require("path");
  const cache = path.join(os.homedir(), ".npm", "_npx");
  for (const entry of fs.existsSync(cache) ? fs.readdirSync(cache) : []) {
    const found = path.join(cache, entry, "node_modules", "playwright");
    if (fs.existsSync(found)) return require(found);
  }
  throw new Error("Playwright isn't installed. Run: npx playwright install chrome, or set PLAYWRIGHT_MODULE.");
}
const { chromium } = findPlaywright();
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
