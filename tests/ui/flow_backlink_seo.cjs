// Backlinks: does it count for Google, the Search Console upload, Reclaim, spam and disavow, the budget, the same-website and
// other-language warnings, and whether my target page is indexed (URL Inspection, on the fake Google).
// On the real app with its worker: DB_NAME_TEST=<your>_test .venv/bin/python tests/ui/app_server.py --port 8291, then node tests/ui/flow_backlink_seo.cjs http://127.0.0.1:8291/
// Made-up sites only. The upload files are written here, never read from Downloads.
const { open, menu } = require("./pw.cjs");
const path = require("path"), fs = require("fs");
const BASE = process.argv[2] || "http://127.0.0.1:8291/";
const OUT = path.resolve("var/ui-backlink-seo") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const RUN = Date.now().toString(36); // a new page each run, so running twice on one database still adds one
  const latest = OUT + "latest-links.csv", pages = OUT + "top-linked-pages.csv";
  fs.writeFileSync(latest, ["Linking page,Last crawled", "https://foodblog.example/coffee,2026-10-20", `https://roaster-news.example/best-of-${RUN},"Oct 22, 2026"`, "https://site-one.example/inside,2026-10-21"].join("\n"));
  fs.writeFileSync(pages, ["Target page,Incoming links,Linking sites", "https://site-one.example/old-offer/,37,6", "https://site-one.example/subscription,12,4"].join("\n"));
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const failed = [];
  // The test server runs with no login, so /api/auth/me answers 404 on every screen. Anything else that fails counts.
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/auth/me")) failed.push(`${r.status()} ${r.url()}`); });
  await page.goto(BASE + "#backlinks?site=site-one.example");
  const settle = (ms = 700) => page.waitForTimeout(ms);
  // The link panel shows one row per question; the proof sits folded under each row.
  const openRows = async () => { await page.evaluate(() => document.querySelectorAll("#panel details.vd-q").forEach((d) => { d.open = true; })); await settle(150); };
  await page.waitForSelector("#bl-tiles", { timeout: 30000 }); await settle(1200);
  if (await page.$('[data-bl-section="done"][aria-selected="false"]')) { await page.click('[data-bl-section="done"]'); await settle(); }

  // the verdict beside the status, and the Live card's line
  const barista = page.locator("#bl-table tbody tr", { hasText: "barista-mag.example" });
  check("a sponsored link shows Weak", (await barista.locator(".vd-weak", { hasText: /^Weak$/ }).count()) === 1);
  check("a plain link shows Counts", (await page.locator("#bl-table tbody tr", { hasText: "foodblog.example" }).locator(".vd-counts").count()) === 1);
  check("no separate Nofollow tag once there's a verdict", (await barista.locator(".tag", { hasText: /^Nofollow$/ }).count()) === 0);
  const liveTile = await page.locator("#bl-tiles .tile").nth(1).innerText();
  check("Live card says how many count for Google", /count for Google|counts for Google/.test(liveTile), liveTile.replace(/\s+/g, " "));
  await page.screenshot({ path: OUT + "1-done.png" });

  // the panel: why, before and after, mark as spam
  await barista.locator("[data-open-bl]").dispatchEvent("click"); await settle(1200);
  check("panel leads with one verdict", (await page.locator("#panel .vd-answer strong").innerText()).length > 0);
  check("panel keeps the proof folded", (await page.locator("#panel details.vd-q[data-vd-row='google'][open]").count()) === 0);
  await openRows();
  const panel = await page.locator("#panel").innerText();
  check("panel asks: does Google count it", /Counted by\s+Google\s*\?/.test(panel));
  check("panel gives the sponsored reason", panel.includes("Marked sponsored"));
  check("panel shows Before and after from Search Console", panel.includes("Before and after"));
  const siteId = await page.evaluate(async () => (await (await fetch("api/links/sites")).json()).sites.find((s) => s.host === "site-one.example").id);
  const indexOn = await page.evaluate(async (id) => (await (await fetch(`api/backlinks?site_id=${id}`)).json()).site.index_check, siteId);
  check("panel asks: is your page in Google", /Your page in\s+Google\s*\?/.test(panel));
  if (!indexOn) check("and says how to turn the index check on", panel.includes("Connect Search Console to check if your page is indexed"));
  await page.screenshot({ path: OUT + "2-panel.png" });
  if (!(await page.getAttribute("#panel [data-vd-disavow]", "data-on"))) { await page.click("#panel [data-vd-disavow]"); await settle(1000); } else { await page.click("#panel [data-close-panel], #panel .icon-btn[aria-label]").catch(() => {}); await settle(300); }
  check("marked as spam shows in the row", (await page.locator("#bl-table tbody tr", { hasText: "barista-mag.example" }).locator(".tag", { hasText: "Spam" }).count()) === 1);

  // Search Console upload, from the Found tab
  await page.click('[data-bl-tab="found"]'); await settle();
  check("Found has the disavow download for the picked site", (await page.locator('a[href*="disavow.txt?site_id="]').count()) === 1);
  await page.click("#gsc-open"); await settle(300);
  check("upload shows the three steps", (await page.locator(".gsc-steps li").count()) === 3);
  await page.screenshot({ path: OUT + "3-gsc-dialog.png" });
  await page.setInputFiles("#gsc-file", latest);
  await page.click("#gsc-send"); await page.waitForSelector("#gsc-result .note, #gsc-result .error", { timeout: 15000 });
  const result = await page.locator("#gsc-result").innerText();
  check("upload says what it did", /1 new links in Found but never logged/.test(result) && /1 logged links Google sees/.test(result), result.replace(/\s+/g, " "));
  await page.setInputFiles("#gsc-file", pages);
  await page.click("#gsc-send"); await page.waitForFunction(() => /of your pages have links/.test(document.querySelector("#gsc-result")?.innerText || ""), null, { timeout: 15000 });
  await page.click("#dlg [data-close-dlg]"); await settle();
  const found = page.locator("tbody tr", { hasText: `best-of-${RUN}` });
  // Since 2026-11-11 Search Console shows as its logo (its name in data-tip and alt) and the date reads "crawled 22 Oct".
  const seenBy = async () => `${await found.innerText()} ${(await found.locator("[data-tip], img[alt]").evaluateAll((els) => els.map((e) => e.getAttribute("data-tip") || e.getAttribute("alt")))).join(" ")}`;
  check("the new link is in Found, seen by Search Console", (await found.count()) === 1 && (await seenBy()).includes("Search Console"));
  check("and Google's crawl date", /crawled 22 Oct\b/.test(await found.innerText()));

  // Reclaim: the worker reads /old-offer/, which is gone on the fake internet
  let reclaimShown = false;
  for (let i = 0; i < 30 && !reclaimShown; i += 1) {
    await page.goto("about:blank"); await page.goto(BASE + "#backlinks?site=site-one.example"); await settle(1500);
    reclaimShown = (await page.locator('[data-bl-tab="reclaim"]').count()) === 1;
  }
  check("a Reclaim tab appears", reclaimShown);
  if (reclaimShown) {
    await page.click('[data-bl-tab="reclaim"]'); await settle();
    const rows = await page.locator("#rc-table tbody").innerText();
    check("it lists the gone page with its links", rows.includes("/old-offer") && rows.includes("404") && rows.includes("37"), rows.replace(/\s+/g, " "));
    check("the live page isn't listed", !rows.includes("/subscription"));
    await page.screenshot({ path: OUT + "4-reclaim.png" });
  }
  await page.click('[data-bl-tab="all"]'); await settle();
  check("Google sees it on the logged link", (await page.locator("#bl-table tbody tr", { hasText: "foodblog.example" }).locator(".vd-google").count()) === 1);

  // budget
  await page.click('[data-bl-tab="mediators"]'); await settle(1200);
  await page.click("[data-vd-budget]"); await settle(300);
  await page.fill("#vd-amount", "400"); await page.selectOption("#vd-currency", "EUR");
  await page.click("#vd-budget-save"); await settle(1000);
  const bar = await page.locator(".md-bar").innerText();
  check("budget shows this month against it", /This month/.test(bar) && /400/.test(bar), bar.replace(/\s+/g, " "));
  await page.screenshot({ path: OUT + "5-budget.png" });

  // is my page indexed: connect Search Console (fake Google), press Check now, and the answer shows
  if (!indexOn) {
    const ok = await page.evaluate(async (id) => {
      const send = (method, path, body) => fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const made = await (await send("POST", "api/google-connections", { label: "Team", kind: "robot", key: { client_email: "robot@team.iam.gserviceaccount.com", private_key: "k", private_key_id: "abcd1234" } })).json();
      return (await send("PUT", `api/sites/${id}/sources/gsc`, { connection_id: made.id, property: "sc-domain:site-one.example" })).ok;
    }, siteId);
    check("Search Console connected on the fake Google", ok);
  }
  await page.click('[data-bl-tab="all"]'); await settle();
  await page.locator("#bl-table tbody tr", { hasText: "barista-mag.example" }).locator("[data-open-bl]").dispatchEvent("click"); await settle(800);
  await openRows();
  await page.click("#link-check-now"); await settle(800);
  let notIndexed = false;
  for (let i = 0; i < 40 && !notIndexed; i += 1) {
    await page.goto("about:blank"); await page.goto(BASE + "#backlinks?site=site-one.example"); await settle(1500);
    notIndexed = (await page.locator("#bl-table tbody tr", { hasText: "barista-mag.example" }).locator(".vd-tag", { hasText: "Your page isn't indexed" }).count()) === 1;
  }
  check("the table says the target page isn't indexed", notIndexed);
  await page.locator("#bl-table tbody tr", { hasText: "barista-mag.example" }).locator("[data-open-bl]").dispatchEvent("click"); await settle(1000);
  check("panel: the index row opens by itself when the page isn't indexed", (await page.locator("#panel details.vd-q[data-vd-row='index'][open]").count()) === 1);
  await openRows();
  const ixPanel = await page.locator("#panel").innerText();
  check("panel: Not indexed, with Google's words", ixPanel.includes("Not indexed") && ixPanel.includes("Crawled - currently not indexed"), ixPanel.slice(0, 0));
  check("panel: a task to get it indexed", (await page.locator("#panel button", { hasText: /^Task$/ }).count()) >= 1);
  await page.locator("#panel [data-vd-row='index']").scrollIntoViewIfNeeded();
  await page.screenshot({ path: OUT + "10-not-indexed.png" });
  await page.keyboard.press("Escape"); await settle(400);
  check("an indexed page has no warning in the table", (await page.locator("#bl-table tbody tr", { hasText: "foodblog.example" }).locator(".vd-tag", { hasText: "Your page isn't indexed" }).count()) === 0);
  await page.locator("#bl-table tbody tr", { hasText: "foodblog.example" }).locator("[data-open-bl]").dispatchEvent("click"); await settle(1000);
  check("panel: Indexed", /\bIndexed\b/.test(await page.locator("#panel").innerText()));
  await page.keyboard.press("Escape"); await settle(400);

  // is the linking page on Google: the Check now above also queued a site: search (the fake has foodblog's page, not barista's)
  const linkOf = (host) => page.evaluate(async ([id, h]) => (await (await fetch(`api/backlinks?site_id=${id}`)).json()).backlinks.find((b) => b.domain === h), [siteId, host]);
  let searched = null;
  for (let i = 0; i < 30 && !searched; i += 1) { searched = (await linkOf("barista-mag.example"))?.source_index; if (!searched) await settle(1000); }
  check("the site: search ran on a free credit", searched?.state === "not_found" && searched?.via === "SerpApi", JSON.stringify(searched));
  await page.goto("about:blank"); await page.goto(BASE + "#backlinks?site=site-one.example"); await settle(1500);
  await page.locator("#bl-table tbody tr", { hasText: "barista-mag.example" }).locator("[data-open-bl]").dispatchEvent("click"); await settle(1000);
  await openRows();
  check("panel: not found on Google yet, searched again before saying not indexed", (await page.locator("#panel").innerText()).includes("Not found on Google yet"));
  await page.keyboard.press("Escape"); await settle(400);
  await page.locator("#bl-table tbody tr", { hasText: "foodblog.example" }).locator("[data-open-bl]").dispatchEvent("click"); await settle(1000);
  await openRows();
  check("panel: the linking page is on Google", (await page.locator("#panel").innerText()).includes("Linking page on Google"));
  await page.keyboard.press("Escape"); await settle(400);

  // the four filters, anchor types, By website
  check("a Useful chip", (await page.locator('[data-bl-filter="useful"]').count()) === 1);
  check("a Not useful chip", (await page.locator('[data-bl-filter="useless"]').count()) === 1);
  await page.click('[data-bl-filter="useful"]'); await settle();
  const usefulRows = await page.locator("#bl-table tbody tr").allInnerTexts();
  check("Useful lists only links that count", usefulRows.length >= 1 && usefulRows.every((r) => r.includes("Counts")), usefulRows.length);
  await page.click('[data-bl-filter="useless"]'); await settle();
  check("Not useful lists the sponsored link", (await page.locator("#bl-table tbody tr", { hasText: "barista-mag.example" }).count()) === 1);
  await page.click('[data-bl-filter="all"]'); await settle();
  const anchorTags = await page.locator("#bl-table .vd-anchor").allInnerTexts();
  check("anchor types show under the anchors", anchorTags.length >= 1, anchorTags.join(", "));
  await page.screenshot({ path: OUT + "11-chips.png" });
  await page.click('[data-vd-view="website"]'); await settle();
  const sites = await page.locator("#bl-sites tbody tr").count();
  check("By website: one row per website", sites >= 3, sites);
  await page.screenshot({ path: OUT + "12-by-website.png" });
  await page.click('#bl-sites [data-vd-domain="barista-mag.example"]'); await settle();
  const onlyBarista = await page.locator("#bl-table tbody tr").allInnerTexts();
  check("a website opens its own links", onlyBarista.length >= 1 && onlyBarista.every((r) => r.includes("barista-mag.example")), onlyBarista.length);
  await page.click('.chips [data-vd-domain=""]'); await settle();

  // Ahrefs: no Site traffic column until its key is connected
  const ahrefsOn = await page.evaluate(async (id) => (await (await fetch(`api/backlinks?site_id=${id}`)).json()).site.ahrefs, siteId);
  if (!ahrefsOn) {
    check("no Site traffic column without Ahrefs", (await page.locator("#bl-table th", { hasText: "Site traffic" }).count()) === 0);
    await page.evaluate(() => fetch("api/app-keys/ahrefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "made-up-ahrefs-key" }) }));
  }
  let traffic = null;
  for (let i = 0; i < 30 && !traffic; i += 1) { traffic = (await linkOf("barista-mag.example"))?.site_traffic; if (!traffic) await settle(1000); }
  await page.goto("about:blank"); await page.goto(BASE + "#backlinks?site=site-one.example"); await settle(1500);
  check("with Ahrefs connected, a Site traffic column", (await page.locator("#bl-table th", { hasText: "Site traffic" }).count()) === 1);
  const cell = await page.locator("#bl-table tbody tr", { hasText: "barista-mag.example" }).locator('td[data-label="Site traffic"]').innerText();
  check("and each website's traffic from Ahrefs", traffic > 0 && cell.replace(/\D/g, "") === String(traffic), `${cell} / ${traffic}`);
  await page.screenshot({ path: OUT + "13-site-traffic.png" });

  // the same website twice
  await page.click('[data-bl-tab="all"]'); await settle();
  await page.click("#add-backlink"); await settle(400);
  await page.fill("#bl-src", "https://foodblog.example/another-post");
  await settle(200);
  const dup = await page.locator("#bl-dup").innerText();
  check("Add backlink warns about the same website", dup.includes("Already links to site-one.example"), dup);
  await page.fill("#bl-src", "https://brand-new.example/post"); await settle(200);
  check("and not for a new website", (await page.locator("#bl-dup").innerText()).trim() === "");
  check("no language note for an address that says nothing", (await page.locator("#bl-lang").innerText()).trim() === "");
  // the demo site-one.example is crawled as French
  await page.fill("#bl-src", "https://cafe-blog.example/en/an-article"); await settle(200);
  const langNote = await page.locator("#bl-lang").innerText();
  check("Add backlink notes a page in another language", langNote.includes("EN") && langNote.includes("site-one.example is in FR") && langNote.includes("/en/"), langNote);
  await page.screenshot({ path: OUT + "6b-lang.png" });
  await page.fill("#bl-src", "https://cafe-blog.example/fr/un-article"); await settle(200);
  check("and none in the same language", (await page.locator("#bl-lang").innerText()).trim() === "");
  await page.screenshot({ path: OUT + "6-dup.png" });
  await page.click("[data-discard-panel]"); await settle(300);

  // dark and French
  await menu(page, "theme"); await settle(400);
  await page.screenshot({ path: OUT + "7-dark.png" });
  await menu(page, "lang"); await settle(600);
  check("French words", (await page.locator("#bl-table").innerText()).includes("Faible"));
  await page.screenshot({ path: OUT + "8-fr.png" });
  await menu(page, "lang"); await menu(page, "theme");

  // phone width
  await page.setViewportSize({ width: 390, height: 844 }); await settle(600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("no sideways scroll at phone width", overflow <= 1, overflow);
  await page.screenshot({ path: OUT + "9-phone.png", fullPage: false });

  check("no failed requests", failed.length === 0, failed.join(" | "));
  const real = problems.filter((p) => !/Failed to load resource: the server responded with a status of 404/.test(p) || failed.length);
  check("no page errors", real.length === 0, real.join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASS");
  process.exit(bad ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
