// To do, the whole way: In consideration, ticked, moved, an article, exported, sent, placed, in Done. On the real app, with reloads.
const { open } = require("./pw.cjs");
const path = require("path"), fs = require("fs");
const BASE = process.argv[2] || "http://127.0.0.1:8235/";
const OUT = path.resolve("var/ui-todo") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const csv = OUT + "links.csv";
  fs.writeFileSync(csv, ["Source url,Domain Authority,Page Authority,Spam Score",
    "https://alpha-blog.example/a,70,40,2", "https://beta-blog.example/b,40,25,10", "https://gamma-blog.example/c,30,15,5"].join("\n"));
  const { browser, context, page, problems } = await open({ width: 1440, height: 950, url: BASE + "#backlinks/consideration" });
  const settle = (ms = 700) => page.waitForTimeout(ms);
  const reloadTo = async (where) => { await page.goto("about:blank"); await page.goto(BASE + "#backlinks/" + where); await settle(1500); };
  const tabCount = async (id) => Number((await page.locator(`[data-bl-section="${id}"] .muted`).innerText()).trim());
  const row = (name) => page.locator("#td-table tbody tr", { hasText: name });
  await page.waitForSelector("#cleaner-open", { timeout: 20000 }); await settle(1000);
  const tilesBefore = await page.locator(".tile, .kpi").first().innerText().catch(() => "");
  const doneBefore = await tabCount("done");

  check("three sections in order", (await page.$$eval("[data-bl-section]", (t) => t.map((x) => x.dataset.blSection).join())) === "consideration,todo,done");
  await page.click('[data-bl-section="todo"]'); await settle(200);
  await page.screenshot({ path: OUT + "0-before.png" });
  const plannedAtStart = await tabCount("todo");
  console.log("planned links at start:", plannedAtStart);
  await page.click('[data-bl-section="consideration"]'); await settle(200);

  // import, with DA, PA and a rating
  await page.click("#cleaner-open"); await page.setInputFiles("#cleaner-file", csv);
  await page.waitForSelector("#cleaner-select-all"); await page.click("#cleaner-select-all");
  await page.selectOption("#cleaner-start-rating", "5");
  await page.click("#cleaner-add"); await page.waitForSelector("#pr-table"); await settle();

  // tick
  check("nothing ticked: no move bar", await page.locator("#pr-pick-bar").isHidden());
  const pick = (name) => page.locator("#pr-table tbody tr", { hasText: name }).locator("[data-prospect-pick]");
  await pick("alpha-blog").check(); await pick("beta-blog").check();
  check("bar counts the ticks", (await page.locator("#pr-pick-count").innerText()).startsWith("2"), await page.locator("#pr-pick-count").innerText());
  await page.screenshot({ path: OUT + "1-ticked.png" });
  check("every icon on In consideration exists", (await page.$$eval("#main svg.i", (all) => all.filter((svg) => !svg.children.length).length)) === 0);
  await page.fill('[data-pr-filter="da"]', "50");
  check("a filter takes away ticks it hides", (await page.locator("#pr-pick-count").innerText()).startsWith("1"), await page.locator("#pr-pick-count").innerText());
  await page.fill('[data-pr-filter="da"]', "");
  await pick("beta-blog").check();

  // move: a mediator is required
  await page.click("#pr-move"); await page.waitForSelector("#td-move-form");
  await page.click("#td-move-save"); await settle(200);
  check("no mediator is refused in the form", (await page.locator("#td-move-error").innerText()).includes("mediator"), await page.locator("#td-move-error").innerText());
  await page.fill("#td-move-mediator", "LinkAgency");
  await page.screenshot({ path: OUT + "2-move.png" });
  await page.dblclick("#td-move-save").catch(() => {}); await settle(1500);
  check("moved: on To do", await page.locator("#td-table").count() === 1);
  await page.screenshot({ path: OUT + "3-todo.png" });
  check("two links in To do", (await tabCount("todo")) === plannedAtStart + 2, await tabCount("todo"));
  check("Done count didn't change", (await tabCount("done")) === doneBefore, await tabCount("done"));
  check("one left in consideration", (await tabCount("consideration")) === 1, await tabCount("consideration"));
  check("DA, PA and rating came along", /DA 70 · PA 40 · Rating 5/.test(await row("alpha-blog").innerText()), (await row("alpha-blog").locator(".second").first().innerText()));
  check("guest post with no article says so", (await row("alpha-blog").innerText()).includes("Needs an article"));

  const emptyIcons = () => page.$$eval("#main svg.i, .sections svg.i", (all) => all.filter((svg) => !svg.children.length).length);
  check("every icon on To do exists", (await emptyIcons()) === 0, await emptyIcons());

  // undo a move
  await page.locator(".toast button", { hasText: "Undo" }).last().click(); await settle(1500);
  check("undo empties To do again", (await tabCount("todo")) === plannedAtStart, await tabCount("todo"));
  await reloadTo("consideration");
  check("undo survives reload: all three back", (await tabCount("consideration")) === 3, await tabCount("consideration"));
  const backRow = await page.locator("#pr-table tbody tr", { hasText: "alpha-blog" }).locator("td").allInnerTexts();
  check("undo kept DA, PA", backRow[2].trim() === "70" && backRow[3].trim() === "40", backRow.slice(2, 4).join("/"));
  check("undo kept the rating", (await page.locator("#pr-table tbody tr", { hasText: "alpha-blog" }).locator("[data-prospect-rating]").inputValue()) === "5");
  check("undo kept the file name", backRow[1].includes("links.csv"));

  // move for real, two mediators
  await pick("alpha-blog").check(); await pick("beta-blog").check();
  await page.click("#pr-move"); await page.waitForSelector("#td-move-form");
  await page.fill("#td-move-mediator", "LinkAgency"); await page.click("#td-move-save"); await settle(1500);
  await page.click('[data-bl-section="consideration"]'); await settle(300);
  await pick("gamma-blog").check();
  await page.click("#pr-move"); await page.waitForSelector("#td-move-form");
  await page.fill("#td-move-mediator", "PressLink"); await page.fill("#td-move-type", "Press"); await page.click("#td-move-save"); await settle(1500);

  // article, saved through a reload
  const article = (name) => row(name).locator("[data-td-article]");
  await article("alpha-blog").fill("https://docs.google.com/document/d/abc/edit"); await article("alpha-blog").blur(); await settle();
  check("article clears the warning", !(await row("alpha-blog").innerText()).includes("Needs an article"));
  check("article can be opened", await row("alpha-blog").locator(".td-open").isVisible());
  await article("beta-blog").fill("not a link"); await article("beta-blog").blur(); await settle();
  check("a bad article link is refused and goes back", (await article("beta-blog").inputValue()) === "", await article("beta-blog").inputValue());
  await reloadTo("todo");
  check("article survives reload", (await article("alpha-blog").inputValue()).includes("docs.google.com"));
  check("the address opens on To do", await page.locator("#td-table").count() === 1);

  // filter by mediator
  await page.selectOption("#td-filter", "PressLink"); await settle(200);
  check("filter by mediator", (await page.locator("#td-table tbody tr[id^=todo-]").count()) === 1 && (await row("gamma-blog").count()) === 1);
  await page.selectOption("#td-filter", "");

  // export
  await page.click("#td-export"); await settle(300);
  await page.screenshot({ path: OUT + "4-export.png" });
  const panel = await page.locator("#panel").innerText();
  check("reminder about sharing the doc", panel.includes("Anyone with the link can view"));
  check("warns about a guest post with no article", panel.includes("1 guest post has no article link"), panel.replace(/\n/g, " ").slice(0, 200));
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#panel .td-group", { hasText: "LinkAgency" }).locator("[data-td-export]").click()]);
  const file = await download.path(), text = fs.readFileSync(file, "utf8");
  console.log("file:", download.suggestedFilename());
  console.log(JSON.stringify(text));
  check("file is named for the mediator", /^links-for-linkagency-\d{4}-\d{2}-\d{2}\.csv$/.test(download.suggestedFilename()), download.suggestedFilename());
  const lines = text.replace(/^﻿/, "").split("\r\n");
  check("columns are Site, Link type, Article only", lines[0] === '"Site","Link type","Article"', lines[0]);
  check("has the mediator's two links only", lines.length === 3 && !text.includes("gamma"), lines.length);
  check("has the article link", text.includes("docs.google.com/document/d/abc/edit"));
  check("doesn't leak anchor, page, price or notes", !/anchor|price|notes|Your page/i.test(text));
  await settle(800);
  check("those two now say Sent", (await row("alpha-blog").locator("[data-td-sent]").inputValue()) === "sent" && (await row("beta-blog").locator("[data-td-sent]").inputValue()) === "sent");
  check("the other mediator's stays To send", (await row("gamma-blog").locator("[data-td-sent]").inputValue()) === "");
  await page.locator(".toast button", { hasText: "Undo" }).last().click(); await settle(800);
  check("undo of sent", (await row("alpha-blog").locator("[data-td-sent]").inputValue()) === "");
  await row("alpha-blog").locator("[data-td-sent]").selectOption("sent"); await settle();
  await reloadTo("todo");
  check("Sent survives reload", (await row("alpha-blog").locator("[data-td-sent]").inputValue()) === "sent");
  check("undo of sent survives reload", (await row("beta-blog").locator("[data-td-sent]").inputValue()) === "");

  // back to consideration
  await row("beta-blog").locator("[data-td-back]").click(); await settle(1500);
  check("back in consideration", (await tabCount("consideration")) === 1 && (await row("beta-blog").count()) === 0, await tabCount("consideration"));

  // placed: the address must be real, and it becomes Live in Done
  await row("alpha-blog").locator("[data-td-placed]").click(); await page.waitForSelector("#td-placed-form");
  await page.screenshot({ path: OUT + "5-placed.png" });
  await page.fill("#td-live-url", ""); await page.click("#td-placed-save"); await settle(200);
  check("an empty address is refused", (await page.locator("#td-live-error").innerText()).length > 3);
  await page.fill("#td-live-url", "nope"); await page.click("#td-placed-save"); await settle(400);
  check("a bad address is refused", (await page.locator("#td-live-error").innerText()).includes("web address"), await page.locator("#td-live-error").innerText());
  await page.fill("#td-live-url", "https://alpha-blog.example/our-guest-post/"); await page.click("#td-placed-save"); await settle(1500);
  check("gone from To do", (await row("alpha-blog").count()) === 0);
  check("Done went up by one", (await tabCount("done")) === doneBefore + 1, await tabCount("done"));
  await reloadTo("all");
  const done = page.locator("tr", { hasText: "our-guest-post" });
  check("it's in Done after reload, with the real address", (await done.count()) >= 1);
  check("it's Live", (await done.first().innerText()).includes("Live"));
  await page.screenshot({ path: OUT + "6-done.png" });

  // server failure when moving
  await page.goto("about:blank"); await page.goto(BASE + "#backlinks/consideration"); await settle(1500);
  await page.route("**/api/backlinks/todo/move", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"The server had a problem."}' }));
  await pick("beta-blog").check();
  await page.click("#pr-move"); await page.waitForSelector("#td-move-form");
  await page.fill("#td-move-mediator", "LinkAgency"); await page.click("#td-move-save"); await settle(800);
  check("a failure stays in the form and says so", (await page.locator("#td-move-error").innerText()).includes("problem"), await page.locator("#td-move-error").innerText());
  check("the button works again", await page.locator("#td-move-save").isEnabled());
  await page.unroute("**/api/backlinks/todo/move");

  // phone
  await page.goto("about:blank"); await page.goto(BASE + "#backlinks/todo"); await settle(1500);
  await page.setViewportSize({ width: 390, height: 844 }); await settle(500);
  await page.screenshot({ path: OUT + "7-phone.png" });
  check("no sideways page scroll on a phone", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  console.log("page errors:", problems.filter((p) => p.startsWith("pageerror")).length ? problems.filter((p) => p.startsWith("pageerror")) : "none");
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(String(e).slice(0, 700)); process.exit(2); });
