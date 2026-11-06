// By hand: type a tool's score into "Links many competitors share", make the mistakes a hurried person makes, go back.
// Usage: node tests/ui/flow_link_edits.cjs [base url] [folder for screenshots]
const { open, menu } = require("./pw.cjs");
const base = process.argv[2] || "http://127.0.0.1:8201/index.html";
const shots = process.argv[3] || ".";
const results = [];
const check = (name, ok, extra = "") => { results.push(Boolean(ok)); console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`); };

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  page.setDefaultTimeout(8000);
  const settle = (ms = 450) => page.waitForTimeout(ms);
  const panel = async () => (await page.locator("#cg-edit-form").count()) > 0;
  const D = "coffee-review.example";
  const row = () => page.locator("#cs-links-table tbody tr").filter({ hasText: D }).first();
  if (process.env.LOGIN) {
    await page.goto(new URL("login", base).href);
    await page.locator("input[type=email], input[name=email], #email").first().fill("admin@example.com");
    await page.locator("input[type=password]").first().fill(process.env.LOGIN);
    await page.keyboard.press("Enter");
    await settle(1500);
  }
  await page.goto(`${base}#competitors`);
  await page.waitForSelector("#cs-links-table", { timeout: 15000 });
  await settle();
  await row().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/links-table.png` });
  check("every row has an Edit button", (await page.locator("#cs-links-table tbody tr").count()) === (await page.locator("#cs-links-table [data-cs-edit]").count()));
  const startCount = Number((await row().locator("td").nth(2).innerText()).trim());

  await row().locator("[data-cs-edit]").click();
  await settle();
  check("Edit opens the panel", await panel());
  await page.locator("#panel").screenshot({ path: `${shots}/edit-panel.png` });
  const ticked = await page.locator("[data-cg-edit-rival]:checked").count();
  check("the ticks match the row", ticked === startCount, `${ticked} ticked`);

  // Hurried mistakes.
  await page.locator("#cg-edit-score").fill("81");
  await page.locator("#cg-edit-save").click();
  await settle();
  check("a score with no tool is refused beside the form", (await page.locator("#cg-edit-error .error").innerText()).includes("which tool") && await panel());
  await page.locator("#cg-edit-score").fill("810");
  await page.locator("#cg-edit-tool").fill("Ahrefs");
  await page.locator("#cg-edit-save").click();
  await settle();
  check("810 is refused", (await page.locator("#cg-edit-error .error").innerText()).includes("0 to 100") && await panel());
  await page.locator("#cg-edit-score").fill("81");
  await page.locator("#cg-edit-url").fill("https://not-this-domain.example/x");
  await page.locator("#cg-edit-save").click();
  await settle();
  check("a link on another domain is refused", (await page.locator("#cg-edit-error .error").innerText()).includes("isn't on") && await panel());
  await page.locator("#cg-edit-url").fill("");
  const boxes = page.locator("[data-cg-edit-rival]");
  const n = await boxes.count();
  for (let i = 0; i < n; i += 1) await boxes.nth(i).uncheck();
  await page.locator("#cg-edit-save").click();
  await settle();
  check("no competitor ticked is refused", (await page.locator("#cg-edit-error .error").innerText()).includes("at least one"));
  await page.screenshot({ path: `${shots}/edit-error.png` });

  // Esc mid-form keeps a draft.
  await page.keyboard.press("Escape");
  await settle();
  await row().locator("[data-cs-edit]").click();
  await settle();
  check("Esc mid-form: the draft comes back", (await page.locator("#cg-edit-score").inputValue()) === "81" && (await page.locator("#cg-edit-tool").inputValue()) === "Ahrefs");

  // A real edit: one competitor fewer.
  await page.locator("#draft-clear").click();
  await settle();
  await page.locator("#cg-edit-score").fill("81");
  await page.locator("#cg-edit-tool").fill("Ahrefs");
  await page.locator("[data-cg-edit-rival]:checked").last().uncheck();
  await page.locator("#cg-edit-save").click();
  await settle(800);
  check("saving closes the panel", !(await panel()));
  const text = await row().innerText();
  check("the table shows the new score and tool", text.includes("81") && text.includes("Ahrefs"), text.replace(/\s+/g, " ").slice(0, 110));
  check("How many follows the ticks", Number((await row().locator("td").nth(2).innerText()).trim()) === startCount - 1);
  check("it says it was typed by hand", (await row().locator(".cg-by-hand").count()) === 1);
  await row().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/links-edited.png` });

  // The other screen shows the same.
  if (process.env.GAPS_SITE !== "skip") {
    // With All sites chosen there are no tabs, so go to the first site's Link gaps.
    await page.evaluate(() => COMP.open("gaps", {}, COMP.sites[0].id));
    await settle(1200);
    const gap = page.locator(`[data-cg-row="${D}"]`);
    if (await gap.count()) {
      const line = await gap.innerText();
      check("Link gaps shows the same score", line.includes("81") && line.includes("Ahrefs"));
      await gap.locator("[data-cg-edit]").click();
      await settle();
      check("Link gaps can open the same panel, filled in", (await page.locator("#cg-edit-score").inputValue()) === "81");
      await page.locator("[data-discard-panel]").click();
      await settle();
      await page.screenshot({ path: `${shots}/gaps-edited.png` });
    } else console.log("     (this site's Link gaps doesn't list it)");
    await page.evaluate(() => COMP.open("summary", {}, COMP.ALL));
    await settle(1200);
  }

  // Back to automatic, then undo.
  await row().locator("[data-cs-edit]").click();
  await settle();
  check("the panel says who and when", (await page.locator("#panel").innerText()).includes("Last edited"));
  await page.locator("#panel").screenshot({ path: `${shots}/edit-panel-edited.png` });
  await page.locator("#cg-edit-reset").click();
  await settle(800);
  check("back to automatic restores the row", !(await row().innerText()).includes("Ahrefs") && (await row().locator(".cg-by-hand").count()) === 0 && Number((await row().locator("td").nth(2).innerText()).trim()) === startCount);
  await page.locator('.toast button:has-text("Undo")').last().click();
  await settle(800);
  check("Undo brings the edit back", (await row().innerText()).includes("Ahrefs") && Number((await row().locator("td").nth(2).innerText()).trim()) === startCount - 1);

  // A domain the list doesn't have, read in a tool.
  const NEW = "fresh-from-a-tool.example";
  const newRow = () => page.locator("#cs-links-table tbody tr").filter({ hasText: NEW });
  await page.locator("[data-cs-add-domain]").click();
  await settle();
  await page.locator("#panel").screenshot({ path: `${shots}/add-domain-panel.png` });
  await page.locator("#cg-edit-save").click();
  await settle();
  check("adding with no domain is refused", (await page.locator("#cg-edit-error .error").innerText()).includes("which domain"));
  await page.locator("#cg-edit-domain").fill("not an address");
  await page.locator("[data-cg-edit-rival]").first().check();
  await page.locator("#cg-edit-save").click();
  await settle();
  check("a bad address is refused", (await page.locator("#cg-edit-error .error").innerText()).includes("web address"));
  await page.locator("#cg-edit-domain").fill(process.env.OWN_SITE || "site-one.example");
  await page.locator("#cg-edit-save").click();
  await settle();
  check("my own site is refused", (await page.locator("#cg-edit-error .error").innerText()).includes("your own"));
  await page.locator("#cg-edit-domain").fill(`https://blog.${NEW}/a-post`);
  await page.locator("[data-cg-edit-rival]").first().uncheck();
  await page.locator("#cg-edit-save").click();
  await settle();
  check("no competitor ticked is refused", (await page.locator("#cg-edit-error .error").innerText()).includes("at least one competitor"));
  await page.locator("[data-cg-edit-rival]").first().check();
  await page.locator("#cg-edit-score").fill("99");
  await page.locator("#cg-edit-tool").fill("Ahrefs");
  await page.locator("#cg-edit-save").click();
  await settle(900);
  check("the panel closes", !(await panel()));
  check("the new domain shows at once with its score", (await newRow().count()) === 1 && (await newRow().innerText()).includes("99") && (await newRow().innerText()).includes("Ahrefs"));
  await newRow().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/add-domain-row.png` });
  await newRow().locator("[data-cs-edit]").click();
  await settle();
  check("its panel offers to remove it", (await page.locator("#cg-edit-reset").innerText()).includes("Remove this domain"));
  await page.locator("#panel").screenshot({ path: `${shots}/add-domain-edit.png` });
  await page.locator("#cg-edit-reset").click();
  await settle(900);
  check("removing takes it off the list", (await newRow().count()) === 0);
  await page.locator('.toast button:has-text("Undo")').last().click();
  await settle(900);
  check("Undo brings it back", (await newRow().count()) === 1 && (await newRow().innerText()).includes("99"));
  // A name that looks like spam is flagged and says so.
  await page.locator("[data-cs-add-domain]").click();
  await settle();
  await page.locator("#cg-edit-domain").fill("best-casino-poker.example");
  await page.locator("[data-cg-edit-rival]").first().check();
  await page.locator("#cg-edit-save").click();
  await settle(900);
  const said = await page.locator(".toast").last().innerText();
  check("a spammy name is flagged and the message says so", said.includes("looks like spam"), said.replace(/\s+/g, " ").slice(0, 90));
  check("it isn't with the good ones", (await page.locator("#cs-links-table tbody tr").filter({ hasText: "best-casino-poker.example" }).count()) === 0);

  // French and a phone.
  await menu(page, "lang");
  await settle();
  await row().locator("[data-cs-edit]").click();
  await settle();
  const fr = await page.locator("#panel").innerText();
  check("French panel", fr.includes("Modifier ce domaine") && fr.includes("Score d'autorité"));
  await page.locator("#panel").screenshot({ path: `${shots}/edit-panel-fr.png` });
  await page.locator("[data-discard-panel]").click();
  await settle();
  await menu(page, "lang");
  await settle();
  await page.setViewportSize({ width: 390, height: 800 });
  await settle();
  check("no sideways scroll on a phone", !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await row().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/links-phone.png` });
  await row().locator("[data-cs-edit]").click();
  await settle();
  check("phone: the panel opens", await panel());

  const real = problems.filter((p) => !p.includes("Failed to load resource"));
  check("no page errors", real.length === 0, real.slice(0, 4).join(" || "));
  await browser.close();
  console.log(`${results.filter(Boolean).length} of ${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(String(e).slice(0, 900)); process.exit(2); });
