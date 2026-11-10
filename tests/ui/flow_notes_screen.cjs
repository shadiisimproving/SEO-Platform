// The Notes screen in the side menu: every note of every website in one list, with a search and kind chips.
// Run against the demo world: DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8251
const { open, menu } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8251/";
const OUT = path.resolve("var/ui-notes-screen") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const RUN = Date.now().toString(36);
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const settle = (ms = 900) => page.waitForTimeout(ms);
  const goto = async (hash) => { await page.goto("about:blank"); await page.goto(BASE + hash); await settle(1800); };
  const rows = () => page.locator("#nv-list .nb-row textarea").evaluateAll((els) => els.map((e) => e.value));
  const writeInPanel = async (pickIndex, words) => {
    await page.click("#nb-fab");
    await page.waitForSelector("#panel.nb-panel-wrap");
    if (pickIndex !== null) { await page.locator("#panel [data-note-panel-pick]").nth(pickIndex).click(); await settle(500); }
    const box = page.locator("#nb-panel-body textarea[data-note-composer]");
    await box.click();
    await box.fill(words);
    await settle(1600);
    await page.locator("#panel .panel-head h2").click();
    await settle(900);
    await page.click("#panel [data-close-panel]");
    await settle(400);
  };

  // 1. Two notes written elsewhere: one on the Backlinks screen, one on a keyword typed in the panel.
  await goto("#backlinks");
  await writeInPanel(null, `Mediator prices ${RUN}`);
  await page.click("#nb-fab");
  await page.waitForSelector("#panel.nb-panel-wrap");
  const kw = page.locator("#panel [data-note-panel-pick]", { hasText: "A keyword" });
  await kw.click();
  await settle(500);
  await page.fill("#nb-pick", `company setup ${RUN}`);
  await page.press("#nb-pick", "Enter");
  await settle(700);
  const kwBox = page.locator("#nb-panel-body textarea[data-note-composer]");
  await kwBox.click();
  await kwBox.fill(`Keyword idea ${RUN}`);
  await settle(1600);
  await page.locator("#panel .panel-head h2").click();
  await settle(900);
  await page.click("#panel [data-close-panel]");
  await settle(400);

  // 2. Notes is in the side menu, under Work, and opens the list.
  const item = page.locator('#sidebar [data-go="notes"]');
  check("Notes is in the side menu", (await item.count()) === 1);
  const order = await page.locator("#sidebar .nav > *").evaluateAll((els) => els.map((e) => e.dataset.go || e.textContent.trim()));
  check("Notes sits under Work, after Tasks", order.indexOf("notes") === order.indexOf("tasks") + 1, order.join(","));
  await item.click();
  await settle(2000);
  check("the address is #notes", (await page.evaluate(() => location.hash)).startsWith("#notes"));
  check("the title is Notes", (await page.textContent("#topbar h1")).trim() === "Notes");
  const all = await rows();
  check("both notes show in the one list", all.some((v) => v.includes(`Mediator prices ${RUN}`)) && all.some((v) => v.includes(`Keyword idea ${RUN}`)), all.length);
  const where = await page.locator("#nv-list .nb-where").allTextContents();
  check("each row says what it's about", where.some((w) => /Backlinks/.test(w)) && where.some((w) => w.includes(`company setup ${RUN}`)), where.slice(0, 4).join(" | "));
  check("the newest note is first", all[0].includes(`Keyword idea ${RUN}`), all[0]);
  await page.screenshot({ path: OUT + "1-all.png" });

  // 3. Kind chips: only kinds with notes, each with its count, and they filter.
  const chips = await page.locator("#nv-kinds [data-nv-kind]").allTextContents();
  check("the chips are All plus the kinds that hold notes", /^All/.test(chips[0]) && chips.some((c) => /Keywords/.test(c)) && chips.some((c) => /Screens/.test(c)), chips.join(" / "));
  await page.click('#nv-kinds [data-nv-kind="keyword"]');
  await settle(500);
  const kwOnly = await rows();
  check("Keywords shows only keyword notes", kwOnly.length > 0 && kwOnly.every((v) => !v.includes("Mediator prices")) && kwOnly.some((v) => v.includes(`Keyword idea ${RUN}`)), kwOnly.length);
  check("the count says how many of how many", /\d+ of \d+/.test(await page.textContent("#nv-count")), await page.textContent("#nv-count"));
  await page.screenshot({ path: OUT + "2-keywords.png" });
  await page.click('#nv-kinds [data-nv-kind=""]');
  await settle(500);

  // 4. Search.
  await page.fill("#nv-search", `Mediator prices ${RUN}`);
  await settle(500);
  const found = await rows();
  check("search narrows the list", found.length === 1 && found[0].includes("Mediator prices"), found.length);
  await page.fill("#nv-search", `nothing like this ${RUN}`);
  await settle(500);
  check("a search with no match says so", /No notes match/.test(await page.textContent("#nv-empty")));
  await page.fill("#nv-search", "");
  await settle(500);

  // 5. A note changed here is saved: it shows changed after a reload.
  const target = page.locator("#nv-list .nb-row textarea").nth((await rows()).findIndex((v) => v.includes(`Mediator prices ${RUN}`)));
  await target.click();
  await target.press("End");
  await page.keyboard.type(" and contacts");
  await settle(1600);
  await page.click("#topbar h1");
  await settle(800);
  await goto("#notes");
  check("a change made here is kept", (await rows()).some((v) => v === `Mediator prices ${RUN} and contacts`));

  // 6. Write a note from this screen: the panel opens, and the note joins the list.
  await page.click("#nv-write");
  await page.waitForSelector("#panel.nb-panel-wrap");
  const box = page.locator("#nb-panel-body textarea[data-note-composer]");
  await box.click();
  await box.fill(`Written from Notes ${RUN}`);
  await settle(1600);
  await page.locator("#panel .panel-head h2").click();
  await settle(900);
  await page.click("#panel [data-close-panel]");
  await settle(600);
  check("a note written from here shows in the list at once", (await rows()).some((v) => v.includes(`Written from Notes ${RUN}`)));

  // 7. Delete one: it goes, and the count follows.
  const before = Number((await page.textContent("#nv-count")).replace(/\D/g, ""));
  const idx = (await rows()).findIndex((v) => v.includes(`Written from Notes ${RUN}`));
  await page.locator("#nv-list .nb-row").nth(idx).locator("[data-note-delete]").click();
  await settle(1500);
  const after = Number((await page.textContent("#nv-count")).replace(/\D/g, ""));
  check("a deleted note leaves the list and the count", !(await rows()).some((v) => v.includes(`Written from Notes ${RUN}`)) && after === before - 1, `${before} → ${after}`);

  // 8. French, dark, and a phone.
  await menu(page, "lang");
  await settle(800);
  check("in French the screen is Notes and the search is French", /Notes/.test(await page.textContent("#topbar h1")) && /Rechercher/.test(await page.getAttribute("#nv-search", "placeholder")));
  await page.screenshot({ path: OUT + "3-french.png" });
  await menu(page, "lang");
  await settle(500);
  await menu(page, "theme");
  await settle(600);
  await page.screenshot({ path: OUT + "4-dark.png" });
  await menu(page, "theme");
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(800);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  check("no sideways scroll on a phone", !wide);
  await page.screenshot({ path: OUT + "5-phone.png", fullPage: true });

  const real = problems.filter((p) => !/status of 404/.test(p));
  check("no errors in the page", real.length === 0, real.slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASS");
  process.exit(bad ? 1 : 0);
})();
