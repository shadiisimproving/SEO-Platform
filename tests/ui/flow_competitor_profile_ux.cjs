// The Competitors screens the owner found hard on 2026-11-09: open a competitor from Summary by its name or row,
// a chart that keeps its size, honest "You" values, questions with Show more and a Task, and links added from the profile.
// Run against the demo world: DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8263
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8263/";
const OUT = path.resolve("var/ui-competitor-profile-ux") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const { browser, page, problems } = await open({ width: 1600, height: 1000 });
  const missing = [];
  page.on("response", (r) => { if (r.status() === 404 && !r.url().endsWith("/api/auth/me")) missing.push(r.url()); }); // the demo world has no sign-in
  const settle = (ms = 1200) => page.waitForTimeout(ms);
  const tab = async (id) => { await page.click(`[data-pt-tab="${id}"]`); await settle(500); };
  const onProfile = () => page.evaluate(() => Boolean(document.querySelector("[data-pt-tab]")));
  const count = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);

  await page.goto(BASE + "#competitors/summary");
  await page.waitForSelector("#cs-rivals-table tbody tr", { timeout: 15000 });
  await settle();
  await page.locator("#cs-rivals-table").screenshot({ path: OUT + "1-summary-rivals.png" });
  const first = await page.evaluate(() => document.querySelector("#cs-rivals-table tbody tr .cs-rival-open")?.textContent.trim());
  check("the competitor's name is a button", Boolean(first), first);

  await page.click("#cs-rivals-table tbody tr .cs-rival-open");
  await settle(1800);
  check("clicking the name opens the competitor", await onProfile());

  await page.goto(BASE + "#competitors/summary");
  await page.waitForSelector("#cs-rivals-table tbody tr", { timeout: 15000 });
  await settle();
  await page.click("#cs-rivals-table tbody tr td:nth-child(3)");
  await settle(1800);
  check("clicking anywhere on the row opens it", await onProfile());

  // Activity: one key, a chart of fixed height, labels at their real size.
  await tab("activity");
  const chart = await page.evaluate(() => {
    const plot = document.querySelector(".pt-plot"), tick = document.querySelector(".pt-tick span");
    return plot && { h: plot.getBoundingClientRect().height, font: tick ? getComputedStyle(tick).fontSize : "", legends: document.querySelectorAll(".pt-legend").length, you: document.querySelectorAll(".pt-bar-you").length, note: Boolean(document.querySelector(".pt-panel .pt-note")) };
  });
  // Since 2026-11-10 the chart only draws with pages in 3 or more months (F14 of the Fable review); fewer months are said in one sentence.
  const fewMonths = await page.evaluate(() => document.querySelector(".pt-few-months")?.textContent || "");
  if (fewMonths) {
    check("too few months: the figures are said in a sentence, no empty 12-month axis", /Too few months|No new pages/.test(fewMonths) && !chart, fewMonths.slice(0, 80));
    // The chart's own rules still have to hold when it is drawn: made-up months on the real answer (the demo competitor has too few), then the same checks.
    const INSIGHTS = "**/api/competitors/*/insights**";
    await page.route(INSIGHTS, async (r) => { const a = await (await r.fetch()).json(); (a.rhythm?.months || []).forEach((m, i) => { m.theirs = (i % 4) + 1; }); await r.fulfill({ json: a }).catch(() => {}); });
    await page.goto(BASE + "#competitors/summary");
    await page.waitForSelector("#cs-rivals-table tbody tr", { timeout: 15000 });
    await settle();
    await page.click("#cs-rivals-table tbody tr .cs-rival-open");
    await settle(1800);
    await tab("activity");
    await page.mouse.move(2, 2);
    const made = await page.evaluate(() => {
      const plot = document.querySelector(".pt-plot"), tick = document.querySelector(".pt-tick span"), tip = document.querySelector("#pt-tip");
      return plot && { h: plot.getBoundingClientRect().height, font: tick ? getComputedStyle(tick).fontSize : "", legends: document.querySelectorAll(".pt-legend").length, you: document.querySelectorAll(".pt-bar-you").length, note: Boolean(document.querySelector(".pt-panel .pt-note")), months: document.querySelectorAll(".pt-month").length, tipShown: Boolean(tip) && getComputedStyle(tip).display !== "none" };
    });
    check("with months to draw, the chart is 200px tall at 1600px wide", made && Math.round(made.h) === 200, made?.h);
    check("axis numbers stay 11px", made?.font === "11px", made?.font);
    check("no second legend", made?.legends === 0, made?.legends);
    check("'You' bars only when my pages are read, else a note says why", (made?.you > 0) !== made?.note, `you bars ${made?.you}, note ${made?.note}`);
    check("the empty hover label stays hidden until a month is hovered (it showed as a hollow circle)", made && made.tipShown === false, JSON.stringify(made));
    await page.unroute(INSIGHTS);
  } else {
    check("the chart is 200px tall at 1600px wide", chart && Math.round(chart.h) === 200, chart?.h);
    check("axis numbers stay 11px", chart?.font === "11px", chart?.font);
    check("no second legend", chart?.legends === 0, chart?.legends);
    check("'You' bars only when my pages are read, else a note says why", (chart?.you > 0) !== chart?.note, `you bars ${chart?.you}, note ${chart?.note}`);
  }
  if ((await count(".pt-month")) > 5) {
    await page.locator(".pt-month").nth(5).hover();
    await settle(300);
    const tip = await page.evaluate(() => {
      const t = document.querySelector("#pt-tip"), m = document.querySelectorAll(".pt-month")[5];
      if (!t || t.hidden) return null;
      const a = t.getBoundingClientRect(), b = m.getBoundingClientRect();
      return { dx: Math.round(Math.abs((a.left + a.width / 2) - (b.left + b.width / 2))), text: t.textContent };
    });
    check("hovering a month shows its label above that month", tip && tip.dx < 3, JSON.stringify(tip));
  }
  await page.locator(".pt-panel section.card").first().screenshot({ path: OUT + "2-activity-chart.png" });

  // Pages: sections in words, questions with Show more and a Task each.
  await tab("pages");
  const pages = await page.evaluate(() => ({
    lead: document.querySelector(".pt-lead")?.textContent || "",
    oldDot: [...document.querySelectorAll(".pt-panel td")].some((td) => /\d+\s·\s\d+/.test(td.textContent)),
    qRows: document.querySelectorAll("#pt-questions tbody tr").length,
    qTasks: document.querySelectorAll("#pt-questions tbody tr button").length,
    more: Boolean(document.querySelector("[data-pt-q-more]")),
  }));
  check("sections start with a sentence", /Most of their pages are in/.test(pages.lead), pages.lead);
  check("no more '157 · 0' cells", !pages.oldDot);
  check("each question has a Task button", pages.qRows > 0 && pages.qTasks === pages.qRows, `${pages.qTasks}/${pages.qRows}`);
  if (pages.more) {
    await page.click("[data-pt-q-more]");
    await settle(300);
    const after = await count("#pt-questions tbody tr");
    check("Show more shows more questions", after > pages.qRows, `${pages.qRows} -> ${after}`);
  } else console.log("note  10 questions or fewer for this demo competitor, so no Show more");
  await page.screenshot({ path: OUT + "3-pages-tab.png", fullPage: true });

  // Their site: no wall of dashes; links can be added from here.
  await tab("site");
  const site = await page.evaluate(() => ({
    missing: document.querySelectorAll(".pt-missing li").length,
    upload: Boolean(document.querySelector("[data-pt-links-upload]")),
    add: Boolean(document.querySelector("[data-pt-links-add]")),
    allDashRows: [...document.querySelectorAll(".pt-vs tbody tr")].filter((tr) => [...tr.querySelectorAll("td")].every((td) => td.textContent.trim() === "—")).length,
  }));
  check("no row is only dashes", site.allDashRows === 0, site.allDashRows);
  check("links can be uploaded and added from the profile", site.upload && site.add, JSON.stringify(site));
  await page.screenshot({ path: OUT + "4-their-site.png", fullPage: true });
  if (site.add) {
    await page.click("[data-pt-links-add]");
    await settle(600);
    check("Add a linking site opens the add panel", await page.evaluate(() => Boolean(document.querySelector("#cg-edit-domain"))));
    await page.screenshot({ path: OUT + "5-add-linking-site.png" });
  }

  // The owner's live case: their own pages aren't read, 79 questions, no Moz yet. Same server answer, reshaped.
  await page.route("**/api/competitors/*/insights*", async (route) => {
    const reply = await route.fetch();
    const body = await reply.json();
    body.facts = { ...body.facts, my_pages: 0, my_reading: null, da: null, my_da: null, popularity: null, my_popularity: null, moz_links: null, my_moz_links: null };
    body.rhythm = { ...body.rhythm, months: (body.rhythm?.months || []).map((m, i) => ({ ...m, theirs: [1, 0, 0, 15, 45, 5, 33, 28, 20, 20, 20, 1][i] ?? 0, mine: 0 })) };
    body.sections = [["/new-article/", 157, 53], ["/fr/", 48, 0], ["/", 26, 0], ["/services/", 17, 0]].map(([path, pages, n]) => ({ path, pages, my_pages: 0, new_90d: n, last_change: null }));
    body.questions = Array.from({ length: 79 }, (_, i) => ({ text: `Question ${i + 1} about accounting in Dubai?`, source: "headings", url: `https://rival-one.example/new-article/q-${i + 1}` }));
    await route.fulfill({ response: reply, json: body });
  });
  await page.goto(BASE + "#competitors/summary");
  await page.waitForSelector("#cs-rivals-table tbody tr .cs-rival-open", { timeout: 15000 });
  await settle();
  await page.click("#cs-rivals-table tbody tr .cs-rival-open");
  await page.waitForSelector("[data-pt-tab]", { timeout: 15000 });
  await settle();
  await tab("activity");
  const lone = await page.evaluate(() => ({ you: document.querySelectorAll(".pt-bar-you").length, note: document.querySelector(".pt-panel .pt-note")?.textContent || "", youWord: /You\b/.test(document.querySelector(".pt-facts-row")?.textContent || "") }));
  check("not read: no 'You' bars or figures, and the note says why", lone.you === 0 && !lone.youWord && /Your own site's pages are read tonight for the first time/.test(lone.note), JSON.stringify(lone));
  await page.locator(".pt-panel section.card").first().screenshot({ path: OUT + "6-activity-not-read.png" });
  await tab("pages");
  const q = { rows: await count("#pt-questions tbody tr"), tasks: await count("#pt-questions tbody tr button") };
  check("79 questions: 10 first, each with a Task", q.rows === 10 && q.tasks === 10, JSON.stringify(q));
  await page.click("[data-pt-q-more]");
  await settle(300);
  check("Show more adds 20", (await count("#pt-questions tbody tr")) === 30);
  await page.click("[data-pt-q-all]");
  await settle(300);
  check("Show all shows all 79", (await count("#pt-questions tbody tr")) === 79);
  await page.click("[data-pt-q-less]");
  await settle(300);
  check("Show fewer goes back to 10", (await count("#pt-questions tbody tr")) === 10);
  const sec = await page.evaluate(() => ({ lead: document.querySelector(".pt-lead")?.textContent, heads: [...document.querySelectorAll(".pt-panel section:nth-of-type(2) thead th")].map((th) => th.textContent) }));
  check("sections: answer first, no 'Your pages' or empty 'Last change' column", /157 of 248/.test(sec.lead) && !sec.heads.includes("Your pages") && !sec.heads.includes("Last change"), JSON.stringify(sec));
  await page.locator(".pt-panel section.card").nth(1).screenshot({ path: OUT + "7-sections-not-read.png" });
  await page.locator(".pt-panel section.card").nth(2).screenshot({ path: OUT + "8-questions.png" });
  const firstTask = page.locator("#pt-questions tbody tr button").first();
  await firstTask.click();
  await settle(700);
  const taskTitle = await page.evaluate(() => document.querySelector("#panel input, .panel input")?.value || "");
  check("a question's Task opens a task already named", /Answer "Question 1/.test(taskTitle), taskTitle);
  await page.keyboard.press("Escape");
  await settle(400);
  await tab("site");
  await page.locator(".pt-panel section.card").first().screenshot({ path: OUT + "9-strength-nothing.png" });
  await page.unroute("**/api/competitors/*/insights*");

  const real = problems.filter((p) => !/Failed to load resource: .*404/.test(p));
  check("no browser errors", real.length === 0, real.slice(0, 3).join(" | "));
  check("no missing routes", missing.length === 0, missing.slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "all passed");
  process.exit(bad ? 1 : 0);
})();
