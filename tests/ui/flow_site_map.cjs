// By hand: the Site map. A website's pages as a mind map, by folders and by links, with comments on a page and a folder,
// for my site (side menu) and for a competitor (its profile's Site map tab). Made-up demo world only.
//   DB_NAME_TEST=test_sitemapui_test .venv/bin/python tests/ui/app_server.py --port 8277 --login
// Usage: node tests/ui/flow_site_map.cjs [base url] [folder for screenshots]
const fs = require("fs");
const { open, menu } = require("./pw.cjs");
const base = process.argv[2] || "http://127.0.0.1:8277/";
const shots = process.argv[3] || "var/ui-site-map";
fs.mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`); };

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  page.setDefaultTimeout(10000);
  const settle = (ms = 500) => page.waitForTimeout(ms);
  const boxes = () => page.locator(".sm-node:not(.sm-more)").count();
  const inFrame = async (sel) => page.evaluate((s) => {
    const el = document.querySelector(s), frame = document.querySelector("[data-sm-viewport]");
    if (!el || !frame) return false;
    const a = el.getBoundingClientRect(), b = frame.getBoundingClientRect();
    return a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
  }, sel);

  await page.goto(`${base}login`);
  await page.fill("#email", "admin@example.com"); await page.fill("#password", "demo-password-1"); await page.click("#go");
  await settle(2500);
  await page.goto(`${base}?simple=1#today?site=site-one.example`);
  await settle(1500);
  await page.locator('#sidebar [data-go="map"]').first().click();
  await page.waitForSelector(".sm-home");
  await settle(600);
  check("Site map is in the side menu and draws the home page", (await page.locator("h1").innerText()).includes("Site map"));
  const first = await boxes();
  check("the first levels are open", first >= 5, `${first} boxes`);
  check("every box is inside the frame at the start", await page.evaluate(() => {
    const frame = document.querySelector("[data-sm-viewport]").getBoundingClientRect();
    return [...document.querySelectorAll(".sm-node")].every((el) => { const r = el.getBoundingClientRect(); return r.left >= frame.left && r.right <= frame.right && r.top >= frame.top && r.bottom <= frame.bottom; });
  }));
  check("no box overlaps another", await page.evaluate(() => {
    const all = [...document.querySelectorAll(".sm-node, .sm-tog")].map((el) => el.getBoundingClientRect());
    return all.every((a, i) => all.every((b, j) => i >= j || a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5));
  }));
  check("branches go both left and right of the home page", await page.evaluate(() => {
    const home = document.querySelector(".sm-home").getBoundingClientRect();
    const xs = [...document.querySelectorAll(".sm-node:not(.sm-home)")].map((el) => el.getBoundingClientRect().left);
    return xs.some((x) => x > home.right) && xs.some((x) => x < home.left);
  }));
  await page.screenshot({ path: `${shots}/folders.png` });

  // Close and open a branch with its round button.
  const tog = page.locator(".sm-tog.is-open").first();
  await tog.click();
  await settle(500);
  const closed = await boxes();
  check("the round button closes a branch", closed < first, `${first} → ${closed}`);
  check("a closed branch shows how many pages it holds", /\d/.test(await page.locator(".sm-tog:not(.is-open)").first().innerText()));
  await page.locator(".sm-tog:not(.is-open)").first().click();
  await settle(500);
  check("and opens it again", (await boxes()) === first);

  await page.click('[data-sm-all="close"]');
  await settle(400);
  check("Close all leaves the home page and its first branches", (await boxes()) < first && (await page.locator(".sm-tog.is-open").count()) === 0);
  await page.click('[data-sm-all="open"]');
  await settle(500);
  const all = await boxes();
  check("Open all shows every page", all >= first, `${all} boxes`);

  // Search.
  await page.fill("[data-sm-q]", "guide");
  await settle(700);
  const found = await page.locator(".sm-node.is-hit").count();
  check("search marks what it finds and dims the rest", found >= 1 && (await page.locator(".sm-node.is-dim").count()) >= 1, `${found} found`);
  check("and says how many", /\d/.test(await page.locator("[data-sm-found]").innerText()));
  check("typing keeps the cursor in the search box", await page.evaluate(() => document.activeElement?.matches("[data-sm-q]")));
  await page.screenshot({ path: `${shots}/search.png` });
  await page.fill("[data-sm-q]", "");
  await settle(600);

  // Zoom and drag.
  const before = await page.evaluate(() => document.querySelector("[data-sm-stage]").style.transform);
  await page.click('[data-sm-zoom="1"]');
  await settle(200);
  const zoomed = await page.evaluate(() => document.querySelector("[data-sm-stage]").style.transform);
  check("Zoom in makes it bigger", zoomed !== before);
  const frame = await page.locator("[data-sm-viewport]").boundingBox();
  await page.mouse.move(frame.x + 60, frame.y + 60); await page.mouse.down(); await page.mouse.move(frame.x + 180, frame.y + 140, { steps: 6 }); await page.mouse.up();
  await settle(200);
  check("dragging moves the map", (await page.evaluate(() => document.querySelector("[data-sm-stage]").style.transform)) !== zoomed);
  check("a drag opens no panel", !(await page.$("#panel")));
  await page.click('[data-sm-zoom="0"]');
  await settle(300);

  // A page's panel, and a comment on it.
  const target = page.locator(".sm-node.sm-page").first();
  const label = await target.innerText();
  await target.click();
  await page.waitForSelector("#panel .sm-facts");
  check("a click opens the page's panel with what the reader saw", (await page.locator("#panel-title").innerText()).trim() === label.trim().replace(/\s*\d+$/, ""));
  check("with its links both ways and its outline", (await page.locator("#panel .sm-fold").count()) === 3);
  check("and Open in Pages for my own site", (await page.locator("#panel [data-sm-pages]").count()) === 1);
  await page.locator("#panel .sm-fold").first().locator("summary").click();
  await settle(200);
  await page.screenshot({ path: `${shots}/panel.png` });
  const note = page.locator("#panel textarea[data-note-field]").first();
  await note.fill("Rewrite the intro of this page");
  await note.blur();
  await settle(1500);
  check("a comment written in the panel marks the box", (await page.locator(".sm-node.is-picked .sm-notes").count()) === 1);
  await page.keyboard.press("Escape");
  await settle(400);
  await page.reload();
  await page.waitForSelector(".sm-home");
  await settle(700);
  check("and the mark is still there after a reload", (await page.locator(".sm-node .sm-notes").count()) >= 1);

  // A folder's comment.
  const folder = page.locator(".sm-node.sm-folder").first();
  if (await folder.count()) {
    await folder.click();
    await page.waitForSelector("#panel [data-note-scope='section']");
    check("a folder's panel takes a comment for every page under it", (await page.locator("#panel .help").innerText()).length > 10);
    const fnote = page.locator("#panel textarea[data-note-field]").first();
    await fnote.fill("Group: merge thin pages");
    await fnote.blur();
    await settle(1500);
    check("the folder comment marks the folder", (await page.locator(".sm-node.sm-folder.is-picked .sm-notes").count()) === 1);
    await page.keyboard.press("Escape");
    await settle(300);
  } else check("the demo site has a folder box", false);

  // By links.
  await page.click('[data-sm-view="links"]');
  await page.waitForSelector(".sm-home");
  await settle(700);
  check("By links draws the map from the home page's links", (await boxes()) >= 3 && page.url().includes("view=links"), page.url());
  check("comments show on this view too", (await page.locator(".sm-node .sm-notes").count()) >= 1);
  await page.screenshot({ path: `${shots}/links.png` });
  await page.locator(".sm-node.sm-page").first().click();
  await page.waitForSelector("#panel .sm-facts");
  await page.locator("#panel .sm-fold").nth(1).locator("summary").click();
  await settle(200);
  const from = page.locator("#panel .sm-fold").nth(1).locator("[data-sm-goto]").first();
  if (await from.count()) {
    await from.click();
    await settle(900);
    check("a page in the panel's link list is shown on the map", (await page.locator(".sm-node.is-picked").count()) === 1 && (await inFrame(".sm-node.is-picked")));
  } else check("the page lists who links to it", false);
  await page.keyboard.press("Escape");
  await settle(300);

  // Keyboard.
  await page.locator(".sm-home").focus();
  await page.keyboard.press("ArrowRight");
  await settle(150);
  check("arrow keys move from box to box", await page.evaluate(() => document.activeElement?.classList.contains("sm-node") && !document.activeElement.classList.contains("sm-home")));
  await page.keyboard.press("Enter");
  await settle(600);
  check("Enter opens the focused box", Boolean(await page.$("#panel")));
  await page.keyboard.press("Escape");
  await settle(300);

  // Dark, French, phone.
  await menu(page, "theme"); await settle(500);
  await page.screenshot({ path: `${shots}/links-dark.png` });
  await menu(page, "theme"); await settle(300);
  await menu(page, "lang"); await settle(700);
  check("French", (await page.locator("h1").innerText()).includes("Plan du site") && (await page.locator('[data-sm-view="links"]').innerText()).includes("Par liens"));
  await page.screenshot({ path: `${shots}/links-fr.png` });
  await menu(page, "lang"); await settle(500);
  await page.setViewportSize({ width: 390, height: 800 });
  await settle(900);
  check("no sideways scroll on a phone", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: `${shots}/phone.png` });
  await page.setViewportSize({ width: 1440, height: 900 });

  // All sites: pick one.
  await page.evaluate(() => { window.UI.pickSite("all"); window.UI.render(); });
  await settle(900);
  check("with all sites picked, it asks for one", (await page.locator("[data-sm-pick]").count()) >= 2);
  await page.screenshot({ path: `${shots}/pick.png` });
  await page.locator("[data-sm-pick]").first().click();
  await settle(1200);
  check("and picking one draws its map", (await page.locator("[data-sm-root]").count()) === 1);

  // A competitor's map, in its profile.
  await page.goto(`${base}?simple=1#competitors/summary?site=site-one.example`);
  await settle(2000);
  await page.evaluate(() => { const row = document.querySelector("[data-cl-open], [data-cs-open], .cc-card, tr[data-comp-open]"); row?.click(); });
  await settle(400);
  if (!(await page.$('[data-pt-tab="map"]'))) { await page.goto(`${base}?simple=1#competitors/list?site=site-one.example`); await settle(1500); await page.locator(".cc-card, [data-cl-open]").first().click(); }
  await page.waitForSelector('[data-pt-tab="map"]');
  await page.click('[data-pt-tab="map"]');
  await page.waitForSelector(".sm[data-sm-competitor] .sm-home");
  await settle(700);
  check("a competitor's profile has a Site map tab that draws its pages", (await boxes()) >= 3);
  await page.locator(".sm-node.sm-page").first().click();
  await page.waitForSelector("#panel .sm-facts");
  check("a competitor's page has no Open in Pages", (await page.locator("#panel [data-sm-pages]").count()) === 0);
  check("but takes comments", (await page.locator("#panel textarea[data-note-field]").count()) >= 1);
  await page.screenshot({ path: `${shots}/competitor.png` });

  // Them / You: my own site in the same frame, one click away.
  await page.keyboard.press("Escape");
  await settle(300);
  const theirHome = await page.locator(".sm-home").innerText();
  await page.click('[data-sm-side="you"]');
  await settle(1200);
  check("You shows my own site's map in the competitor's tab", (await page.locator(".sm-home").innerText()) !== theirHome && (await page.locator('[data-sm-side="you"]').getAttribute("aria-pressed")) === "true");
  await page.screenshot({ path: `${shots}/competitor-you.png` });
  await page.click('[data-sm-side="them"]');
  await settle(1200);
  check("and Them brings the competitor's back", (await page.locator(".sm-home").innerText()) === theirHome);

  check("no errors in the browser", problems.length === 0, problems.slice(0, 3).join(" | "));
  await browser.close();
  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
