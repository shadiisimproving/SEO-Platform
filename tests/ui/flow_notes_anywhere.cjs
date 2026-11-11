// Notes from anywhere: the Notes button and the N key on any screen, the header button on a competitor and on
// Page vs page, All notes, and the guard that keeps an open form panel from being replaced.
// Run against the demo world: DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8241
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8241/";
const OUT = path.resolve("var/ui-notes-anywhere") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const RUN = Date.now().toString(36);
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };
(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const settle = (ms = 900) => page.waitForTimeout(ms);
  const goto = async (hash) => { await page.goto("about:blank"); await page.goto(BASE + hash); await settle(1800); };
  // At All sites, Competitors opens on Summary: pick the first website, as a person would.
  const oneSite = async () => {
    const values = await page.locator("#comp-site option").evaluateAll((os) => os.map((o) => o.value).filter((v) => v !== "all"));
    if (values.length) { await page.selectOption("#comp-site", values[0]); await settle(1500); }
    const mine = page.locator('[data-comp-tab="list"]');
    if (await mine.count()) { await mine.click(); await settle(1200); }
  };
  const picks = page.locator("#panel [data-note-panel-pick]");
  const choices = async () => {
    const out = [];
    for (let i = 0; i < (await picks.count()); i += 1) out.push(`${(await picks.nth(i).textContent()).trim()}|${await picks.nth(i).getAttribute("aria-pressed")}`);
    return out;
  };
  const rows = () => page.locator("#nb-panel-body .nb-row textarea").evaluateAll((els) => els.map((e) => e.value));
  const writeNote = async (words) => {
    const box = page.locator("#nb-panel-body textarea[data-note-composer]");
    await box.click();
    await box.fill(words);
    await settle(1600); // the pause that saves
    await page.locator("#panel .panel-head h2").click(); // leaving the field settles it into the list
    await settle(900);
  };

  // 1. A screen with no notes of its own: the button is there, and opens on this screen.
  await goto("#backlinks");
  check("the Notes button is on Backlinks", await page.isVisible("#nb-fab"));
  await page.screenshot({ path: OUT + "1-button.png" });
  await page.click("#nb-fab");
  await page.waitForSelector("#panel.nb-panel-wrap");
  const onBacklinks = await choices();
  check("the panel offers this screen first, then the website, then All notes", /Backlinks screen\|true/.test(onBacklinks[0]) && /All notes/.test(onBacklinks.at(-1)), onBacklinks.join(" / "));
  await writeNote(`Ask the mediator about prices ${RUN}`);
  await page.screenshot({ path: OUT + "2-backlinks-note.png" });
  check("the note is saved on this screen", (await rows()).some((v) => v.includes(RUN)));
  await page.click("#panel [data-close-panel]");
  await settle(400);
  check("the close button closes the panel", !(await page.$("#panel.nb-panel-wrap")));

  // 2. The N key, but never while typing.
  await goto("#keywords");
  const field = page.locator("#main input[type=search], #main input[type=text], #main input:not([type])").first();
  if (await field.count()) {
    await field.click();
    await page.keyboard.type("n");
    await settle(300);
    check("N typed in a field doesn't open notes", !(await page.$("#panel.nb-panel-wrap")));
    await field.fill("");
    await page.locator("body").click({ position: { x: 700, y: 20 } }).catch(() => {});
  }
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("n");
  await page.waitForSelector("#panel.nb-panel-wrap", { timeout: 4000 }).catch(() => {});
  check("N opens notes on Keywords", Boolean(await page.$("#panel.nb-panel-wrap")));
  if ((await picks.count()) > 2) { await picks.nth(1).click(); await settle(500); await writeNote(`The whole site moves to the new menu ${RUN}`); }
  await page.keyboard.press("Escape"); await settle(300);

  // 3. A competitor: Notes in the header, no block at the end of the page.
  await goto("#competitors");
  await oneSite();
  const rival = page.locator("#comp-body [data-cs-open]").first();
  check("a competitor to open", (await rival.count()) === 1);
  if (await rival.count()) {
    await rival.click();
    await page.waitForSelector("#cl-profile-title", { timeout: 8000 });
    await settle();
    check("no notes block at the end of the profile", (await page.locator("#main .nb-block").count()) === 0);
    check("a Notes button in the profile header", (await page.locator("#main .cl-head .nb-open").count()) === 1);
    const counted = async () => Number(((await page.locator("#main .cl-head .nb-open .nb-count").textContent().catch(() => "")) || "0").trim() || 0);
    const before = await counted();
    await page.click("#main .cl-head .nb-open");
    await page.waitForSelector("#panel.nb-panel-wrap");
    const here = await choices();
    check("it opens on this competitor", /\|true$/.test(here[0]) && here.length >= 8 && here.slice(-1)[0].startsWith("All notes"), here.join(" / "));
    await writeNote(`They change prices every month ${RUN}`);
    await page.screenshot({ path: OUT + "3-competitor-note.png" });
    await page.keyboard.press("Escape"); await settle(400);
    await page.reload(); await settle(2200);
    if (!(await page.$("#cl-profile-title"))) {
      const again = page.locator("#comp-body [data-cs-open]").first();
      if (await again.count()) { await again.click(); await page.waitForSelector("#cl-profile-title"); }
    }
    await settle(1500);
    const after = await counted();
    check("after a reload the header button counts the new note", after === before + 1, `${before} then ${after}`);
    await page.screenshot({ path: OUT + "4-header-count.png" });
  }

  // 4. All notes holds the three, and search narrows it.
  await page.click("#nb-fab");
  await page.waitForSelector("#panel.nb-panel-wrap");
  await picks.last().click();
  await settle(1500);
  const listed = await rows();
  check("All notes holds the notes from three places", listed.filter((v) => v.includes(RUN)).length === 3, listed.length);
  await page.screenshot({ path: OUT + "5-all-notes.png" });
  await page.fill("#nb-panel-search", "mediator");
  await settle(300);
  const found = await rows();
  check("search narrows All notes", found.length >= 1 && found.every((v) => /mediator/i.test(v)), found.length);
  await page.fill("#nb-panel-search", "");
  await page.keyboard.press("Escape"); await settle(300);

  // 5. An open form panel isn't replaced.
  await goto("#competitors");
  await oneSite();
  const add = page.locator("#cl-add-open");
  if (await add.count()) {
    await add.first().click();
    await page.waitForSelector("#cl-add-address");
    await page.fill("#cl-add-address", "half-typed.example");
    await page.click("#nb-fab");
    await settle(500);
    check("an open form panel stays open", (await page.locator("#cl-add-address").count()) === 1 && (await page.inputValue("#cl-add-address")) === "half-typed.example");
    await page.screenshot({ path: OUT + "6-form-guard.png" });
  } else check("the Add button is on My competitors", false);

  const real = problems.filter((p) => !/status of 404/.test(p)); // the harness runs without sign-in, so api/auth/me answers 404
  check("no page errors", real.length === 0, real.slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})();
