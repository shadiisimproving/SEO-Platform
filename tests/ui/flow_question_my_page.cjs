// Competitors → Questions: "Change page" picks which page of mine sits beside a page of theirs (2026-11-13).
// The owner saw "Closest topic" guess the wrong page and asked to choose it. Made-up sites only.
//   DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8264
//   node tests/ui/flow_question_my_page.cjs http://127.0.0.1:8264/ [folder for screenshots]
const { open } = require("./pw.cjs");
const fs = require("fs"), path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8264/";
const OUT = path.resolve(process.argv[3] || "var/ui-question-my-page") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };

// The insights answer with three rows: one paired, one guessed by topic, one with no page of mine.
function reshape(d, host) {
  const mine = (slug, how) => ({ url: `https://site-one.example/${slug}`, title: `My guide to ${slug}`, how, read: true, questions: ["What does it cost?"] });
  d.questions = { judged: true, dropped: 0, related: 3, total: 3, groups: [
    { url: `https://${host}/visa`, title: "Getting a visa", questions: ["How long does a visa take?"], other: [], related: true, score: 3, mine: mine("visa", "paired") },
    { url: `https://${host}/bank`, title: "Opening a bank account", questions: ["Which bank is best?"], other: [], related: true, score: 2, mine: mine("licence", "topic") },
    { url: `https://${host}/office`, title: "Renting an office", questions: ["Do I need an office?"], other: [], related: true, score: 1, mine: null },
  ] };
  d.facts.my_pages = 12;
  return d;
}

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  // Under 1600 px the competitor cards start folded to logos (2026-11-20), which hides Open: this flow opens them.
  await page.addInitScript(() => { try { localStorage.setItem("seocc-cs-slim", "0"); } catch { /* no storage */ } });
  const settle = (ms = 700) => page.waitForTimeout(ms);
  const call = (p) => page.evaluate((u) => fetch(u).then((r) => r.json()), BASE + "api/" + p);
  await page.goto(BASE + "?simple=1#today"); await settle(1500);
  const site = (await call("links/sites")).sites[0];
  const rivals = (await call(`competitors?site_id=${site.id}`)).competitors;
  const one = rivals.find((c) => c.host === "rival-one.example") || rivals[0];
  await page.route(/\/api\/competitors\/\d+\/insights\?/, async (route) => { const res = await route.fetch(); await route.fulfill({ response: res, json: reshape(await res.json(), one.host) }); });
  const posts = [];
  page.on("request", (r) => { if (r.url().includes("/api/page-pairs/pick")) posts.push(JSON.parse(r.postData() || "{}")); });

  await page.goto(BASE + "?simple=1#competitors/list"); await settle(1500);
  if (await page.$("#comp-site")) { await page.selectOption("#comp-site", String(site.id)); await settle(); }
  await page.click(`[data-cs-open="${one.id}"]`); await settle(1500);
  await page.click('[data-pt-tab="questions"]'); await settle();
  const rows = page.locator("#pt-questions > li");
  check("every row offers a way to choose my page", (await page.locator("[data-pt-mine-pick]").count()) === 3);
  check("a row with no page of mine says Pick a page", /Pick a page/.test(await rows.nth(2).innerText()));
  await rows.nth(1).screenshot({ path: OUT + "1-row.png" });

  // Open on the guessed row: the box holds the guess, ready to be replaced.
  await rows.nth(1).locator("[data-pt-mine-pick]").click(); await settle(500);
  check("the panel opens with the box focused", await page.evaluate(() => document.activeElement?.id === "pt-mp-url"));
  check("the box starts on the page compared now", (await page.inputValue("#pt-mp-url")) === "https://site-one.example/licence");
  console.log("      pages offered:", await page.locator("#pt-mp-pages option").count());
  await page.screenshot({ path: OUT + "2-panel.png" });

  // Empty box: a plain sentence, nothing sent.
  await page.fill("#pt-mp-url", ""); await page.click("[data-pt-mp-save]"); await settle(300);
  check("an empty box says what to do", /Pick one of your pages/.test(await page.locator("#pt-mp-error").innerText()) && posts.length === 0);

  // A page of another site: the server refuses and the panel says why.
  await page.fill("#pt-mp-url", "https://elsewhere.example/x"); await page.keyboard.press("Enter"); await settle(800);
  check("a page of another site is refused in words", (await page.locator("#pt-mp-error .error").count()) === 1, await page.locator("#pt-mp-error").innerText());
  check("Enter didn't reload the page", page.url().includes("#competitors"));

  // The right page, saved with Enter.
  await page.fill("#pt-mp-url", "https://site-one.example/bank-account"); await page.keyboard.press("Enter"); await settle(1200);
  const sent = posts[posts.length - 1] || {};
  check("it saves my page against their page", sent.my_url === "https://site-one.example/bank-account" && sent.their_url === `https://${one.host}/bank` && sent.competitor_id === one.id, JSON.stringify(sent));
  check("the panel closes", (await page.locator("#pt-mp-form").count()) === 0);
  check("focus returns to the row's button", await page.evaluate(() => document.activeElement?.dataset?.ptMinePick?.endsWith("/bank") === true));
  const pairs = (await call(`page-pairs?site_id=${site.id}&competitor_id=${one.id}`)).pairs;
  check("the pair is saved", pairs.some((p) => p.my_url.endsWith("/bank-account") && p.their_url.endsWith("/bank")), pairs.map((p) => `${p.my_url} ↔ ${p.their_url}`).join(" | "));

  // Changing it again leaves only the newest choice on that page of theirs.
  await rows.nth(1).locator("[data-pt-mine-pick]").click(); await settle(500);
  await page.fill("#pt-mp-url", "https://site-one.example/banking-guide"); await page.click("[data-pt-mp-save]"); await settle(1200);
  const after = (await call(`page-pairs?site_id=${site.id}&competitor_id=${one.id}`)).pairs.filter((p) => p.their_url.endsWith("/bank"));
  check("only the newest choice is kept", after.length === 1 && after[0].my_url.endsWith("/banking-guide"), after.map((p) => p.my_url).join(" | "));

  check("no page errors", problems.filter((p) => !/404|400 \(BAD REQUEST\)/.test(p)).length === 0, problems.join(" ; "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASS");
  process.exit(bad ? 1 : 0);
})();
