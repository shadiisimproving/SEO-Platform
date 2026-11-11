// Every brand name on every screen should sit beside its logo. Lists the ones that don't, and any logo that fails to load.
// Needs the screens served with their data, by the real app on the demo world. design/serve.py no longer does: since
// 2026-11-09 the plain files served over http show "The server didn't answer" instead of sample rows, so nothing was checked.
//   DB_NAME_TEST=<your>_test .venv/bin/python tests/ui/app_server.py --port 8201
//   SCREENS_URL=http://127.0.0.1:8201/ node tests/ui/flow_brand_logos.cjs [folder for screenshots]
const { open } = require("./pw.cjs");

const ROOT = process.env.SCREENS_URL || "http://127.0.0.1:8201/";
const SHOTS = process.argv[2];
const SCREENS = ["today", "channels", "conversions", "content", "overview", "keywords", "competitors", "ai", "ads", "tasks", "backlinks", "resources", "health", "settings"];

const scan = (page) => page.evaluate(() => {
  const B = window.BRANDS;
  const missing = new Set(), left = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) {
    const n = walk.currentNode, el = n.parentElement;
    if (!el || !B.hasName(n.data) || !el.getClientRects().length) continue;
    const line = `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}: ${n.data.trim().slice(0, 90)}`;
    if (el.closest(".brand-mention")) continue;
    if (el.closest(B.LEAVE)) left.add(line);
    else {
      // Fine only when the row already leads with this logo.
      let row = el, led = false;
      for (let i = 0; row && i < 3; i++, row = row.parentElement) if ([...row.children].some((c) => c.matches("img.logo"))) led = true;
      if (!led) missing.add(line);
    }
  }
  const broken = [...document.images].filter((i) => i.complete && !i.naturalWidth && !i.src.includes("api/logos")).map((i) => i.getAttribute("src"));
  // No app shell means the screen never loaded (the error page of a server with no data): nothing on it was checked.
  return { missing: [...missing], left: [...left], broken: [...new Set(broken)], logos: document.querySelectorAll(".brand-logo").length, shown: Boolean(document.querySelector("#page")) };
});

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 1000 });
  const notFound = new Set();
  page.on("response", (r) => { if (r.status() >= 400) notFound.add(new URL(r.url()).pathname); });
  const seen = { missing: new Set(), left: new Set(), broken: new Set(), "not loaded": new Set() };
  let logos = 0;
  const take = async (where) => {
    await page.waitForTimeout(250);
    const r = await scan(page);
    logos += r.logos;
    if (!r.shown) seen["not loaded"].add(where);
    // Left alone on purpose: printed once each, so a person can read the list and judge it.
    r.left.forEach((x) => seen.left.add(x));
    for (const k of ["missing", "broken"]) r[k].forEach((x) => seen[k].add(`${where} | ${x}`));
  };
  for (const lang of ["en", "fr"]) {
    for (const screen of SCREENS) {
      await page.goto("about:blank");
      await page.goto(`${ROOT}?look=blue&theme=light&lang=${lang}#${screen}`);
      await page.waitForTimeout(500);
      await take(`${lang}/${screen}`);
      if (SHOTS && lang === "en") await page.screenshot({ path: `${SHOTS}/brand-${screen}.png` });
      // Each tab on the screen.
      const tabs = await page.locator('#page [role="tab"]').count();
      for (let i = 0; i < tabs; i++) {
        const tab = page.locator('#page [role="tab"]').nth(i);
        if (!(await tab.isVisible().catch(() => false))) continue;
        await tab.click({ timeout: 2000 }).catch(() => {});
        await take(`${lang}/${screen}/tab${i}`);
      }
    }
    // Every connection panel in Settings.
    await page.goto("about:blank");
    await page.goto(`${ROOT}?look=blue&theme=light&lang=${lang}#settings`);
    await page.waitForTimeout(500);
    const conn = page.locator(".conn-logo");
    const n = await conn.count();
    for (let i = 0; i < n; i++) {
      const row = conn.nth(i).locator("xpath=..");
      await row.locator("button").last().click({ timeout: 2000 }).catch(() => {});
      await take(`${lang}/settings/panel${i}`);
      if (SHOTS && lang === "en" && i === 0) await page.screenshot({ path: `${SHOTS}/brand-panel-google.png` });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
    }
  }
  for (const k of ["missing", "broken", "not loaded", "left"]) {
    console.log(`\n== ${k} (${seen[k].size})`);
    [...seen[k]].slice(0, 120).forEach((x) => console.log(x));
  }
  console.log(`\nlogos added, summed over views: ${logos}`);
  console.log(`failed addresses: ${[...notFound].join(", ") || "none"}`);
  const other = problems.filter((p) => !p.includes("status of 404"));
  console.log(`page errors other than 404: ${other.length}`); other.slice(0, 10).forEach((p) => console.log(p));
  await browser.close();
  // A run where no screen loaded, or not one logo was drawn, checked nothing: it fails rather than passing empty.
  const empty = seen["not loaded"].size > 0 || logos === 0;
  if (empty) console.log("\nFAIL  the screens didn't load with data, so no brand name was checked");
  process.exit(seen.missing.size || seen.broken.size || empty ? 1 : 0);
})();
