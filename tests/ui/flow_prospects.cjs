// Backlinks → In consideration and "Filter a backlink CSV", the way a hurried person uses it: upload a tool's export, read
// what was kept, flagged and left out, pick some, undo, add all, remove, turn one into a real backlink, and the plain errors
// for bad files. The top boxes count real backlinks only, so they never move when prospects come and go.
// Made-up data only. Replaces flow_prospects.js (sample screens, a Playwright page passed in) on 2026-11-10.
//   DB_NAME_TEST=test_fixc_test .venv/bin/python tests/ui/app_server.py --port 8283
//   node tests/ui/flow_prospects.cjs [base url] [folder for screenshots]
// The test files are in var/ui-test-csv/ (made-up rows; see their names below).
const fs = require("fs");
const path = require("path");
const { open } = require("./pw.cjs");
const BASE = process.argv[2] || "http://127.0.0.1:8283/";
const OUT = process.argv[3] || "var/ui-prospects";
const CSV = path.resolve(__dirname, "../../var/ui-test-csv") + "/";
fs.mkdirSync(OUT, { recursive: true });
const NOTE = "Prospect list only. This filters a CSV and adds the links you keep to In consideration. It does not check rankings or track these links.";
const fails = [];
let passed = 0;
const check = (name, ok, extra) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra !== undefined && !ok ? `  [${String(extra).slice(0, 170)}]` : ""}`); if (ok) passed += 1; else fails.push(name); };

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  page.setDefaultTimeout(10000);
  const wait = (ms) => page.waitForTimeout(ms);
  const go = async (hash = "backlinks", w = 1440) => { await page.setViewportSize({ width: w, height: 900 }); await page.goto("about:blank"); await page.goto(`${BASE}?p=${Date.now()}#${hash}`); await wait(2000); };
  const tiles = () => page.evaluate(() => [...document.querySelectorAll(".tiles .tile")].map((x) => `${x.querySelector(".lab").innerText.trim()}=${x.querySelector(".fig").innerText.trim()}`).join(" "));
  const lastToast = async () => { const n = await page.locator(".toast").count(); return n ? (await page.locator(".toast").nth(n - 1).innerText()).replace(/\s+/g, " ").trim() : ""; };
  const clearToasts = async () => { for (let i = 0; i < 4; i++) { const b = page.locator(".toast [data-dismiss]").first(); if (await b.count()) { await b.click(); await wait(170); } } };
  const upload = async (name) => { await page.locator("#cleaner-file").setInputFiles(CSV + name); await wait(900); };
  const openTool = async () => { await page.locator("#cleaner-open").click(); await wait(400); };
  const stat = async (label) => { const el = page.locator(".clean-stat", { has: page.locator(".lab", { hasText: label }) }).first(); return Number((await el.locator(".n").innerText()).replace(/\D/g, "")); };
  const rows = () => page.locator("#pr-table tbody tr[data-pr-row], #pr-table tbody tr:has([data-prospect-remove])").count();
  const toSection = async (id) => { await page.locator(`[data-bl-section="${id}"]`).click(); await wait(500); };
  try {
    await go("backlinks?site=site-one.example");
    // Start from an empty In consideration, and without the backlinks an earlier run of this flow made from the test file,
    // so the flow can run again on the same test world.
    await page.evaluate(async () => {
      const site = window.SITES.find((x) => x.host === "site-one.example")?.realId;
      const list = (await window.COMP.api("GET", `prospects?site_id=${site}`)).prospects || [];
      for (const x of list) await window.COMP.api("DELETE", `prospects/${x.id}`).catch(() => {});
      const links = (await window.COMP.api("GET", `backlinks?site_id=${site}`)).backlinks || [];
      for (const b of links) if (b.anchor === "guide investir") await window.COMP.api("DELETE", `backlinks/${b.id}`).catch(() => {});
    });
    await go("backlinks?site=site-one.example");
    const before = await tiles();
    console.log("     boxes:", before);
    check("Done is the first section", (await page.locator('[data-bl-section="done"]').getAttribute("aria-selected")) === "true");
    const subTabs = await page.locator(".content .tabs:not(.sections) .tab").allInnerTexts();
    check("Done keeps All backlinks, Mediators and Found but never logged", /All backlinks/.test(subTabs[0]) && subTabs.some((x) => /Mediators/.test(x)) && subTabs.some((x) => /Found but never logged/.test(x)), subTabs.join(" | "));
    check("Done has Import CSV and no filter tool", (await page.locator("#bulk-open").count()) === 1 && (await page.locator("#cleaner-open").count()) === 0);

    // In consideration: the note, the button, and nothing from Done.
    await toSection("consideration");
    const start = await rows();
    check("the note shows next to the button", (await page.locator(".tool-band p").innerText()).trim() === NOTE);
    check("the button is named Filter a backlink CSV", (await page.locator("#cleaner-open").innerText()).trim() === "Filter a backlink CSV");
    check("Import CSV isn't in this section", (await page.locator("#bulk-open").count()) === 0);
    check("the boxes still show", (await tiles()) === before);

    // Upload: the summary, the table, nothing added yet.
    await openTool();
    check("the note shows in the window too", (await page.locator("#dlg .prospect-note").innerText()).trim() === NOTE);
    await upload("semrush_export.csv");
    const total = await stat("Total"), kept = await stat("Kept"), spam = await stat("Flagged as spam"), left = await stat("Left out"), dups = await stat("Duplicates");
    console.log("     semrush_export.csv:", { total, kept, spam, left, dups });
    // Kept and left out make the total; spam-flagged rows are kept to read but can't be picked.
    check("the summary adds up: kept and left out make the total, spam is among the kept", total === 10 && kept + left === total && spam <= kept && left >= 1, `${total} ${kept} ${spam} ${left}`);
    const tableText = await page.locator(".clean-table").innerText();
    check("a blank or unreadable spam score shows unknown, never 0", (tableText.match(/unknown/g) || []).length >= 1 && !(await page.locator(".clean-table tbody tr td:nth-child(6)").allInnerTexts()).includes("0"));
    check(".co.uk is cut to its root domain", tableText.includes("uae-guide.example.co.uk"));
    check("a row twice in the file says so", tableText.includes("Twice in this file"));
    check("the window names the tool the file came from", (await page.locator("#dlg .dlg-body p.small").first().innerText()).includes("SEMrush") && /\bDA\b/.test(await page.locator(".clean-table thead").innerText()));
    check("no ranking, tracking or Live/Lost marks", (await page.locator("#dlg .status, #dlg .pos, #dlg .chg").count()) === 0 && !/\b(Live|Lost|Nofollow)\b/.test(tableText));
    check("Add is off until something is picked", await page.locator("#cleaner-add").isDisabled());
    await page.screenshot({ path: `${OUT}/p-result.png` });

    // Cancel adds nothing. The same file again: duplicates don't grow.
    await page.locator(".dlg-foot [data-close-dlg]").click(); await wait(300);
    check("Cancel adds nothing", (await rows()) === start);
    await openTool(); await upload("semrush_export.csv");
    check("the same file twice: duplicates don't grow", (await stat("Duplicates")) === dups, await stat("Duplicates"));

    // Two by hand, then Undo.
    await page.locator('[data-cleaner-row="0"]').check();
    await page.locator('[data-cleaner-row="2"]').check(); await wait(100);
    check("the button counts the choice", (await page.locator("#cleaner-add").innerText()) === "Add 2 to In consideration", await page.locator("#cleaner-add").innerText());
    check("the header box shows a partial choice", await page.locator("#cleaner-all").evaluate((b) => b.indeterminate));
    await page.locator("#cleaner-add").click(); await wait(1200);
    check("two added", (await rows()) === start + 2, await rows());
    check("a toast confirms, with Undo", (await lastToast()).includes("2 links added to In consideration") && (await lastToast()).includes("Undo"), await lastToast());
    check("the boxes don't move for prospects", (await tiles()) === before, await tiles());
    await page.locator(".toast [data-undo]").first().click(); await wait(1200);
    check("Undo takes them out", (await rows()) === start, await rows());
    await clearToasts();

    // Added for real, the same file is flagged; new only, clear, select all.
    await openTool(); await upload("semrush_export.csv");
    await page.locator('[data-cleaner-row="0"]').check(); await page.locator('[data-cleaner-row="2"]').check();
    await page.locator("#cleaner-add").click(); await wait(1200); await clearToasts();
    await openTool(); await upload("semrush_export.csv");
    check("once added, those domains are flagged", (await stat("Duplicates")) === dups + 2, await stat("Duplicates"));
    check("the flag says In consideration", (await page.locator(".clean-table").innerText()).includes("Already in consideration"));
    await page.locator("#cleaner-new-only").click(); await wait(80);
    const newOnly = await page.locator("#cleaner-add").innerText();
    check("New only leaves the flagged ones out", /^Add \d+ to In consideration$/.test(newOnly) && Number(newOnly.match(/\d+/)[0]) <= kept - 2, newOnly);
    await page.locator("#cleaner-clear").click(); await wait(60);
    check("Clear empties the choice", await page.locator("#cleaner-add").isDisabled());
    await page.locator("#cleaner-all").check(); await wait(80);
    const all = await page.locator("#cleaner-add").innerText();
    check("Select all takes every kept row that isn't flagged as spam", all === `Add ${kept - spam} to In consideration`, all);
    await page.locator("#cleaner-new-only").click(); await wait(80);
    const fresh = Number((await page.locator("#cleaner-add").innerText()).match(/\d+/)?.[0] || 0);
    await page.locator("#cleaner-add").click(); await wait(1500); await clearToasts();
    check("the new ones are in the list", (await rows()) === start + 2 + fresh, `${await rows()} vs ${start + 2 + fresh}`);
    check("the boxes still don't move", (await tiles()) === before, await tiles());

    // What a prospect shows.
    const prText = await page.locator("#pr-table").innerText();
    check("a prospect shows its file and its scores", prText.includes("semrush_export.csv") && /\bDA\b/.test(await page.locator("#pr-table thead").innerText()));
    check("no visits, leads or cost columns", !/\b(Visits|Leads|Cost per visit|Mediator)\b/.test(await page.locator("#pr-table thead").innerText()), (await page.locator("#pr-table thead").innerText()).replace(/\s+/g, " "));
    check("no ranking or Live/Lost marks on prospects", (await page.locator("#pr-table .pos, #pr-table .chg").count()) === 0 && !/\b(Live|Lost|Nofollow)\b/.test(prText));

    // Remove and undo.
    const count = await rows();
    await page.locator("[data-prospect-remove]").first().click(); await wait(1000);
    check("Remove works", (await rows()) === count - 1, await rows());
    check("the boxes don't move when one is removed", (await tiles()) === before);
    await page.locator(".toast [data-undo]").first().click(); await wait(1200);
    check("Undo brings it back", (await rows()) === count, await rows());
    await clearToasts();

    // Turn one into a real backlink: Cancel, Esc keeps a draft, Save moves it to Done.
    const firstUrl = (await page.locator("#pr-table tbody tr:has([data-prospect-done]) a.kw").first().innerText()).trim();
    check("a prospect row names its page", firstUrl.length > 5, firstUrl);
    const row = page.locator("#pr-table tbody tr", { hasText: firstUrl }).first();
    await row.locator("[data-prospect-done]").click(); await wait(600);
    check("the form starts with the source address", (await page.locator("#bl-src").inputValue()).endsWith(firstUrl), `${await page.locator("#bl-src").inputValue()} / ${firstUrl}`);
    check("the site comes from the prospect", (await page.locator("#bl-site").inputValue()) === "site-one.example");
    check("the cursor waits in Target page", await page.evaluate(() => document.activeElement.id === "bl-target"));
    check("no Import CSV switch here", (await page.locator("[data-add-mode]").count()) === 0);
    await page.locator("[data-discard-panel]").click(); await wait(400);
    check("Cancel leaves the prospect", (await rows()) === count && (await page.locator("#pr-table").innerText()).includes(firstUrl));
    check("Cancel makes no backlink", (await tiles()) === before);
    await clearToasts();
    await row.locator("[data-prospect-done]").click(); await wait(500);
    await page.locator("#bl-target").fill("/guide/");
    await page.keyboard.press("Escape"); await wait(400);
    check("Esc keeps a draft and the prospect", (await lastToast()).includes("Draft kept") && (await rows()) === count, await lastToast());
    await row.locator("[data-prospect-done]").click(); await wait(500);
    check("the draft comes back", (await page.locator("#bl-target").inputValue()) === "/guide/");
    await page.locator("#bl-anchor").fill("guide investir");
    await page.locator("#bl-save").click(); await wait(2500);
    check("saving lands on Done", (await page.locator('[data-bl-section="done"]').getAttribute("aria-selected")) === "true");
    check("the backlink is in Done", (await page.locator("#bl-table").innerText()).includes(firstUrl));
    check("now the boxes count it", (await tiles()) !== before, await tiles());
    await toSection("consideration");
    check("the prospect left In consideration", (await rows()) === count - 1 && !(await page.locator("#pr-table").innerText()).includes(firstUrl), `${await rows()} rows, was ${count}; ${firstUrl}`);
    await clearToasts();

    // Bad files say what's wrong in plain words.
    await openTool();
    await upload("no_spam_column.csv");
    // Since the CSV filter learnt to keep rows with no spam score (2026-11), a file without that column is read, marked unknown.
    check("no spam column: read, and every spam score says unknown", (await stat("Total")) >= 1 && /no spam score: kept/.test(await page.locator("#dlg .dlg-body p.small").first().innerText()), await page.locator("#dlg .dlg-body p.small").first().innerText());
    await page.locator("#cleaner-again").click(); await wait(200);
    // Each bad file in a fresh window, as a person trying again would.
    const again = async (name) => { if (await page.locator("#dlg[open]").count()) { await page.locator("#dlg [data-close-dlg]").first().click(); await wait(250); } await openTool(); await upload(name); };
    await again("no_url_column.csv");
    const e2 = await page.locator("#dlg").innerText();
    check("no URL column: it asks which column holds the link, from the file's own headers", /Which column holds the link/.test(e2) && e2.includes("Title") && e2.includes("Spam Score"), e2.replace(/\s+/g, " ").slice(0, 160));
    await again("empty.csv");
    check("an empty file says so", /empty/i.test(await page.locator("#cleaner-error").innerText()), await page.locator("#cleaner-error").innerText());
    await again("picture.png");
    check("a picture isn't a CSV", (await page.locator("#cleaner-error").innerText()).includes(".csv"), await page.locator("#cleaner-error").innerText());
    await again("over_10mb.csv");
    check("over 10 MB is refused", (await page.locator("#cleaner-error").innerText()).includes("10 MB"), await page.locator("#cleaner-error").innerText());
    await again("all_removed.csv");
    // Every row over the spam limit: shown, flagged, and nothing can be added.
    check("all flagged as spam: on show, none can be picked", (await stat("Flagged as spam")) === (await stat("Total")) && /Select all good ones \(0\)/.test(await page.locator("#dlg").innerText()) && await page.locator("#cleaner-add").isDisabled());
    await page.locator("#cleaner-again").click(); await wait(200);
    await upload("ubersuggest_bom_semicolon.csv");
    const ub = await page.locator(".clean-table").innerText();
    check("a BOM, semicolons, a decimal comma and .com.ae are read", (await stat("Total")) === 3 && ub.includes("12.5") && ub.includes("guide-emirats.example.com.ae") && ub.includes("example.com.ae") && (await page.locator("#dlg .dlg-body p.small").first().innerText()).includes("Ubersuggest"), ub.replace(/\s+/g, " ").slice(0, 120));
    await page.locator(".dlg-foot [data-close-dlg]").click(); await wait(200);

    // A big file stays quick and the list pages.
    const t0 = Date.now();
    await openTool(); await upload("large_5000_rows.csv");
    await page.locator(".clean-stat").first().waitFor({ timeout: 20000 });
    await page.locator("#cleaner-all").check(); await wait(80);
    check("5,000 rows: all can be picked, 200 are drawn", (await page.locator(".clean-table tbody tr").count()) === 200 && (await page.locator("#cleaner-add").innerText()).includes("5,000"), await page.locator("#cleaner-add").innerText());
    await page.locator("#cleaner-add").click(); await page.locator('[data-tp-foot="bl-prospects"] [data-tp-step="next"]').waitFor({ timeout: 30000 });
    console.log(`     5,000 rows: read, picked and added in ${Date.now() - t0} ms`);
    // Pages, like every long table (2026-11-10): 25 a page first, the real total in the footer.
    check("a long list shows 25 a page, with the total", (await rows()) === 25 && /^1–25 of 5,0\d\d links$/.test((await page.locator('[data-tp-foot="bl-prospects"] .tp-range').innerText()).trim()), await page.locator('[data-tp-foot="bl-prospects"] .tp-range').innerText());
    check("the boxes still count real backlinks only", (await tiles()).split(" ")[0] === (await tiles()).split(" ")[0] && !/5[,  ]?0\d\d/.test((await tiles()).split(" ")[0]));
    await clearToasts();

    // Phone, French.
    await go("backlinks/consideration?site=site-one.example", 390);
    check("phone: no sideways scroll", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${OUT}/p-phone.png` });
    await page.evaluate(() => localStorage.setItem("seocc2-lang", "fr"));
    await go("backlinks/consideration?site=site-one.example");
    check("the note in French", (await page.locator(".tool-band p").innerText()).startsWith("Liste de prospects uniquement"));
    await page.evaluate(() => localStorage.setItem("seocc2-lang", "en"));
  } catch (e) { check(`the flow ran to the end (${e.message.split("\n")[0].slice(0, 200)})`, false); }
  const real = problems.filter((p) => !/status of 40[0-9]|Failed to load resource/.test(p));
  check("no script errors", !real.length, real.slice(0, 3).join(" | "));
  await browser.close();
  console.log(`\n${passed} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
})();
