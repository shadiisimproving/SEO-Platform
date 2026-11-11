// Questions they answer: tick rows, add one note holding both pages and their questions; my page beside theirs; the age card.
// Made-up sites only.
//   DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8297
//   node tests/ui/flow_question_notes.cjs http://127.0.0.1:8297/
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8297/";
const OUT = path.resolve("var/ui-question-notes") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };

function reshape(d, host) {
  const mine = (slug, how, questions) => ({ url: `https://site-one.example/${slug}`, title: `My guide to ${slug}`, how, read: true, questions });
  const groups = [
    { url: `https://${host}/visa`, title: "Getting a visa", questions: ["How long does a visa take?", "Who can apply?", "What does it cost?", "Can a family join?", "Is a medical needed?"], other: [], related: true, score: 3, mine: mine("visa", "paired", ["How much is a visa?", "Which documents do I need?"]) },
    { url: `https://${host}/licence`, title: "Choosing a licence", questions: ["Which licence fits?"], other: [], related: true, score: 2, mine: mine("licence", "topic", []) },
    { url: `https://${host}/banking`, title: "Opening a bank account", questions: ["Which bank is best?"], other: [], related: true, score: 2, mine: null },
  ];
  d.questions = { judged: true, dropped: 0, groups, related: 7, total: 7 };
  d.facts.first_capture = "2020-08-01"; d.facts.registered_on = "2017-06-16"; d.facts.expires_on = "2027-06-16"; d.facts.my_pages = 12;
  d.facts.history = { status: "ok", archived_pages: 181 };
  d.rhythm = d.rhythm || {}; d.rhythm.by_year = [[2020, 28], [2021, 56], [2022, 32], [2023, 23], [2024, 1], [2025, 28], [2026, 13]].map(([year, pages]) => ({ year, pages }));
  return d;
}

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const missing = [];
  page.on("response", (r) => { if (r.status() === 404 && !r.url().endsWith("/api/auth/me")) missing.push(r.url()); });
  const settle = (ms = 700) => page.waitForTimeout(ms);
  const call = (p) => page.evaluate((u) => fetch(u).then((r) => r.json()), BASE + "api/" + p);
  await page.goto(BASE + "#today"); await settle(1500);
  const site = (await call("links/sites")).sites[0];
  const rivals = (await call(`competitors?site_id=${site.id}`)).competitors;
  const one = rivals.find((c) => c.host === "rival-one.example") || rivals[0];
  await page.route(/\/api\/competitors\/\d+\/insights\?/, async (route) => { const res = await route.fetch(); await route.fulfill({ response: res, json: reshape(await res.json(), one.host) }); });
  const openProfile = async (tab) => {
    await page.goto("about:blank"); await page.goto(BASE + "#competitors/list"); await settle(1500);
    if (await page.$("#comp-site")) { await page.selectOption("#comp-site", String(site.id)); await settle(); }
    await page.click(`[data-cs-open="${one.id}"]`); await settle(1500);
    await page.click(`[data-pt-tab="${tab}"]`); await settle();
  };
  const card = (name) => page.locator("section.card", { hasText: name }).first();

  await openProfile("pages");
  const rows = page.locator("#pt-questions > li");
  check("every row has a tick box", (await page.locator("#pt-questions [data-pt-qpick]").count()) === 3);
  const first = await rows.nth(0).innerText();
  check("a row shows their questions and my page's", /Their questions/.test(first) && /How long does a visa take/.test(first) && /My guide to visa/.test(first) && /How much is a visa/.test(first), first.slice(0, 200));
  check("the row says how the pages were matched", /Paired/.test(first));
  check("a guess says it's a guess", /Closest topic/.test(await rows.nth(1).innerText()));
  check("my page with no questions says so", /No questions\./.test(await rows.nth(1).innerText()));
  check("no page of mine says so", /None yet\./.test(await rows.nth(2).innerText()));
  check("no bar before anything is ticked", (await page.locator("#pt-q-selbar .selbar").count()) === 0);
  await card("Questions they answer").screenshot({ path: OUT + "1-rows.png" });

  await rows.nth(0).locator("[data-pt-qpage]").click(); await settle(300);
  check("+n more opens both sides", (await rows.nth(0).locator(".pt-qlist li").count()) === 7);
  await page.locator('[data-pt-qpick$="/visa"]').check();
  await page.locator('[data-pt-qpick$="/banking"]').check(); await settle(300);
  check("the bar counts what's ticked", /2 selected/.test(await page.locator("#pt-q-selbar").innerText()));
  check("the tick keeps focus", await page.evaluate(() => document.activeElement?.hasAttribute("data-pt-qpick")));
  await page.screenshot({ path: OUT + "2-picked.png" });

  // A hurried person: types, presses Esc, comes back.
  await page.click("[data-pt-q-note]"); await settle(400);
  const preview = await page.locator(".pt-qn-context").innerText();
  check("the panel shows what's saved with the note", /Their page: Getting a visa/.test(preview) && /Your page: My guide to visa/.test(preview) && /Your page: none yet/.test(preview), preview.slice(0, 160));
  check("the note field has focus", await page.evaluate(() => document.activeElement?.id === "pt-qn-text"));
  await page.screenshot({ path: OUT + "3-panel.png" });
  await page.fill("#pt-qn-text", "Answer these on my page");
  await page.keyboard.press("Escape"); await settle(400);
  check("Esc keeps the selection", /2 selected/.test(await page.locator("#pt-q-selbar").innerText()));
  await page.click("[data-pt-q-note]"); await settle(400);
  check("the words come back", (await page.inputValue("#pt-qn-text")) === "Answer these on my page");

  const before = (await call("notes")).notes?.length ?? (await call("notes")).length;
  await page.click("#pt-qn-save"); await settle(1000);
  const raw = await call("notes"), notes = raw.notes || raw;
  check("one note per ticked page", notes.length === before + 2, `${before} -> ${notes.length}`);
  const visa = notes.find((n) => (n.page_url || "").endsWith("/visa"));
  check("the note holds my words, both pages and the questions", visa && /^Answer these on my page\n\nTheir page: Getting a visa/.test(visa.body) && /- Is a medical needed\?/.test(visa.body) && /site-one\.example\/visa/.test(visa.body) && /- Which documents do I need\?/.test(visa.body), visa?.body?.slice(0, 120));
  check("it belongs to this competitor", visa?.competitor_id === one.id && visa?.scope === "page");
  check("the panel closes and the ticks clear", !(await page.$("#panel")) && (await page.locator("#pt-q-selbar .selbar").count()) === 0);
  await settle(500);
  check("the row's note mark counts it", (await rows.nth(0).locator("[data-note-count]").innerText()) === "1");
  await card("Questions they answer").screenshot({ path: OUT + "4-saved.png" });
  await rows.nth(0).locator(".nb-badge").click(); await settle(700);
  check("the note mark opens the note", /Answer these on my page/.test(await page.locator("#panel").evaluate((p) => [...p.querySelectorAll("textarea")].map((x) => x.value).join(" ") + p.innerText)));
  await page.screenshot({ path: OUT + "5-note-open.png" });
  await page.keyboard.press("Escape"); await settle(300);

  await openProfile("activity");
  const age = card("How old their site is"), text = await age.innerText();
  check("the age card has four figures", (await age.locator(".pt-fig").count()) === 4, text.slice(0, 120));
  check("a column for each year", (await age.locator(".pt-years li").count()) === 7);
  check("the long sentences are gone", !/most of them first|misses pages|renews by|From the Wayback/.test(text), text);
  check("nothing folded", (await age.locator("details").count()) === 0);
  await age.screenshot({ path: OUT + "6-age.png" });

  await page.setViewportSize({ width: 390, height: 800 }); await settle(500);
  check("no sideways scroll on a phone", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await age.screenshot({ path: OUT + "7-age-phone.png" });
  await page.click('[data-pt-tab="pages"]'); await settle();
  await page.locator("#pt-questions > li").first().screenshot({ path: OUT + "8-row-phone.png" });
  check("no sideways scroll on the rows", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

  const real = problems.filter((x) => !/status of 404/.test(x)); // the test server has no login, so /api/auth/me answers 404; other 404s are caught below
  check("no script errors", real.length === 0, real.slice(0, 3).join(" | "));
  check("nothing else missing", missing.length === 0, missing.slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
