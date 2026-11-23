// A keyword's history chart in its side panel, the way a person uses it, with screenshots to look at: our line, rivals
// switched on and off, the marks for edits, backlinks and boosts, adding and deleting a boost, French, a phone, dark mode.
// Needs the real app on the fake internet, on a database of your own, with the chart's demo data:
//   DB_NAME_TEST=test_kwhistory_ui_test DB_POOL_SIZE=2 .venv/bin/python tests/ui/app_server.py --port 8298 --slow 0
//   DB_NAME_TEST=test_kwhistory_ui_test .venv/bin/python tests/ui/seed_keyword_history.py
// Run: SEOCC_REAL_DEFAULT=1 node tests/ui/flow_keyword_history.cjs <screenshots folder> http://127.0.0.1:8298/
const { open, menu } = require("./pw.cjs");
const out = process.argv[2] || "reports/keyword-history-2026-11-20";
const BASE = process.argv[3] || "http://127.0.0.1:8298/";
require("fs").mkdirSync(out, { recursive: true });
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const KEYWORD = "how to brew coffee", BOX = "#panel [data-kwh]";
const settle = (page, ms = 350) => page.waitForTimeout(ms);
const facts = (page) => page.evaluate((sel) => {
  const box = document.querySelector(sel);
  if (!box) return null;
  const marks = [...box.querySelectorAll(".kwh-mark")];
  const plot = box.querySelector(".kwh-plot")?.getBoundingClientRect();
  return {
    ours: box.querySelectorAll("svg.chart > circle").length,
    ticks: [...box.querySelectorAll("svg.chart text")].map((x) => x.textContent).filter((x) => /^\d+$/.test(x)).map(Number),
    lines: [...box.querySelectorAll("svg .kwh-them")].map((g) => g.dataset.kwhLine),
    dashes: [...box.querySelectorAll("svg .kwh-them > path:first-child")].map((p) => p.getAttribute("stroke-dasharray") || "solid"),
    chips: [...box.querySelectorAll(".kwh-chip")].map((c) => `${c.querySelector("span[dir]").textContent.trim()}:${c.getAttribute("aria-pressed")}`),
    logos: box.querySelectorAll(".kwh-chip .site-logo").length,
    you: box.querySelector(".kwh-you")?.textContent.trim() || "",
    more: !!box.querySelector("[data-kwh-more]"),
    marks: marks.map((m) => ({ type: [...m.parentElement.classList].find((c) => c !== "kwh-lane").replace("kwh-", ""), label: m.getAttribute("aria-label"), tip: m.dataset.tip, n: Number(m.querySelector("b")?.textContent || 1), range: m.classList.contains("kwh-range"), pressed: m.getAttribute("aria-pressed") })),
    inside: marks.every((m) => { const r = m.getBoundingClientRect(); return plot && r.left >= plot.left - 14 && r.right <= plot.right + 14; }),
    legend: [...box.querySelectorAll(".kwh-keys li")].map((li) => li.textContent.trim()),
    detail: box.querySelector(".kwh-detail")?.innerText || "",
    status: box.querySelector(".kwh-status")?.textContent || "",
    add: !!box.querySelector("[data-kwh-add]"),
    form: !!box.querySelector("[data-kwh-form]"),
    error: box.querySelector(".kwh-error")?.textContent.trim() || "",
    words: box.innerText,
    wide: document.documentElement.scrollWidth > innerWidth + 1,
    spills: [...box.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).length,
  };
}, BOX);
// Keywords → click the keyword's row, the way a person opens its panel. The language and theme switches close the panel.
async function openKeyword(page, word) {
  if (await page.$("#panel [data-kwh]")) return;
  await page.waitForSelector("#kw-table tbody tr[data-kwr-row]", { timeout: 20000 });
  await page.locator("#kw-table tbody tr[data-kwr-row]", { hasText: word }).locator("td").nth(4).click();
  await page.waitForSelector(`${BOX} .kwh-lanes`, { timeout: 15000 });
  await page.waitForTimeout(600);
}
const boostMarks = (f) => f.marks.filter((m) => m.type === "boost");

(async () => {
  const { browser, page, problems } = await open({ url: `${BASE}#keywords` });
  page.on("dialog", (d) => d.accept());

  // ---- Keywords → click the keyword --------------------------------------------------------------------
  await openKeyword(page, KEYWORD);
  let f = await facts(page);
  check(f.ours === 11 && f.ticks[0] === 1, `our line: 11 checks as dots, 1 at the top (${f.ours}, ticks ${f.ticks.join(" ")})`);
  check(f.you === "You" && f.lines.join() === "cafe-monde.example,rival-one.example,rival-two.example", `the followed rivals are drawn at first (${f.lines.join(", ")})`);
  check(new Set(f.dashes).size === 3, `each rival line has its own dash (${f.dashes.join(" | ")})`);
  check(f.chips.length === 3 && f.chips.every((c) => c.endsWith(":true")) && f.logos === 3 && f.more, "a chip per followed rival with its logo, all on, and More sites for the rest");
  check(f.legend.join() === "Edit,Backlink,Boost,Note", `the legend names the marks (${f.legend.join(", ")})`);
  const by = (type) => f.marks.filter((m) => m.type === type);
  check(by("edit").length === 3 && by("edit").every((m) => /^Edit, \d/.test(m.label) && m.tip === m.label), `3 edit marks, each with a date and what changed (${by("edit").map((m) => m.label).join(" / ")})`);
  check(by("backlink").reduce((n, m) => n + m.n, 0) === 3 && by("backlink").some((m) => m.n === 2 && /^2 backlinks/.test(m.label)), `3 backlinks, the two a day apart share a mark (${by("backlink").map((m) => m.label).join(" / ")})`);
  check(by("boost").length === 2 && by("boost").filter((m) => m.range).length === 1 && by("boost").some((m) => m.label.includes("Google Ads push") && m.label.includes("–")), `2 boosts, the week-long one drawn as a span (${by("boost").map((m) => m.label).join(" / ")})`);
  check(by("note").length === 1 && f.inside, "the dated note is marked, and every mark sits within the chart's width");
  check(f.status.includes("2 from before the first check are in Table") && f.status.includes("1 backlink to this page has no date"), `what isn't marked is said once (${f.status})`);
  check(!f.wide, "desktop: nothing wider than the screen");
  await page.locator("#panel").screenshot({ path: `${out}/01-panel.png` });
  await page.locator(BOX).screenshot({ path: `${out}/02-chart.png` });

  // ---- a mark says what it is ---------------------------------------------------------------------------
  await page.hover(`${BOX} .kwh-lane.kwh-edit .kwh-mark`);
  await settle(page, 400);
  check(await page.evaluate(() => /^Edit, /.test(document.querySelector(".tooltip")?.textContent || "")), "hovering a mark shows its tooltip");
  await page.click(`${BOX} .kwh-lane.kwh-edit .kwh-mark`);
  f = await facts(page);
  check(f.detail.includes("Title") && f.detail.includes("5 methods") && f.detail.includes("about 240 words changed"), `clicking an edit spells it out (${f.detail.replace(/\n/g, " | ")})`);
  await page.click(`${BOX} .kwh-lane.kwh-backlink .kwh-mark:has(b)`);
  f = await facts(page);
  check(f.detail.includes("brew-mag.example/links") && f.detail.includes("old-forum.example") && f.detail.includes("Lost") && f.detail.includes("brewing guide"), "the shared backlink mark lists both links, their anchors, and the lost one");
  check(await page.locator(`${BOX} .kwh-detail a.page-link`).count() === 2, "each backlink's page is a link");
  await page.locator(BOX).screenshot({ path: `${out}/03-backlinks-picked.png` });

  // ---- rivals on and off ----------------------------------------------------------------------------------
  await page.click(`${BOX} [data-kwh-rival="rival-two.example"]`);
  f = await facts(page);
  check(f.lines.join() === "cafe-monde.example,rival-one.example" && f.chips.includes("rival-two.example:false"), "a chip switches its line off");
  check(await page.evaluate(() => document.activeElement?.dataset.kwhRival === "rival-two.example"), "the keyboard stays on the chip");
  await page.keyboard.press("Enter");
  f = await facts(page);
  check(f.lines.length === 3, "Enter switches it back on");
  await page.click(`${BOX} [data-kwh-more]`);
  f = await facts(page);
  check(f.chips.length === 7 && f.chips.includes("youtube.com:false") && f.lines.length === 3 && !f.more, `More sites offers the others, off (${f.chips.join(" ")} / ${f.lines.join(" ")} / ${f.more})`);
  await page.click(`${BOX} [data-kwh-rival="youtube.com"]`);
  f = await facts(page);
  check(f.lines.includes("youtube.com") && f.lines.length === 4, "another site's line can be added");
  await page.locator(BOX).screenshot({ path: `${out}/04-more-sites.png` });
  await page.click(`${BOX} [data-kwh-rival="youtube.com"]`);

  // ---- add a boost, then delete it ---------------------------------------------------------------------------
  const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
  await page.click(`${BOX} [data-kwh-add]`);
  f = await facts(page);
  check(f.form && !f.add && await page.evaluate(() => document.activeElement?.name === "start"), "Add a boost opens its form, on the start date");
  check(await page.locator(`${BOX} .kwh-form a.page-link`).innerText() === "https://site-one.example/guide/brew", "the form names the keyword's page, as a link");
  await page.fill(`${BOX} [name="start"]`, iso(7));
  await page.fill(`${BOX} [name="end"]`, iso(9));
  await page.fill(`${BOX} [name="note"]`, "Influencer story");
  await page.click(`${BOX} .kwh-form [type="submit"]`);
  f = await facts(page);
  check(f.form && f.error === "The end date is before the start date." && await page.inputValue(`${BOX} [name="note"]`) === "Influencer story", `an end before the start is refused, and what was typed stays (${f.error})`);
  await page.locator(BOX).screenshot({ path: `${out}/05-boost-form.png` });
  await page.fill(`${BOX} [name="end"]`, "");
  await page.keyboard.press("Enter");
  await page.waitForSelector(`${BOX} [data-kwh-add]`, { timeout: 8000 });
  await settle(page, 500);
  f = await facts(page);
  check(!f.form && boostMarks(f).length === 3 && f.detail.includes("Influencer story") && boostMarks(f).some((m) => m.pressed === "true"), `the boost is saved, marked and picked (${boostMarks(f).length} boosts)`);
  check(await page.evaluate(() => [...document.querySelectorAll("#toasts > *")].some((x) => x.textContent.includes("Boost added"))), "a toast says Boost added");
  await page.locator(BOX).screenshot({ path: `${out}/06-boost-added.png` });
  await page.reload();
  await page.waitForSelector(`${BOX} .kwh-lanes`, { timeout: 20000 });
  f = await facts(page);
  check(boostMarks(f).length === 3, "after a reload the keyword is open again and the boost is still there");
  await page.locator(`${BOX} .kwh-lane.kwh-boost .kwh-mark[aria-label*="Influencer"]`).focus();
  await page.keyboard.press("Enter");
  await page.locator(`${BOX} [data-kwh-del]`).click();
  await page.waitForFunction((sel) => document.querySelectorAll(`${sel} .kwh-lane.kwh-boost .kwh-mark`).length === 2, BOX, { timeout: 8000 });
  f = await facts(page);
  check(boostMarks(f).length === 2 && !f.detail, "Delete removes the boost and its mark");

  // ---- the table keeps every check, with the page's history between them ------------------------------------
  await page.click("#kwr-chart-toggle");
  await settle(page);
  const rows = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} .kwh-table tbody tr`)].map((tr) => tr.innerText.replace(/\s+/g, " ").trim()), BOX);
  check(rows.length === 11 + 4 + 4 + 2 + 1 && rows[0].includes("Edit") && rows[0].includes("Brewing coffee"), `Table: 11 checks and every edit, backlink, boost and note in date order (${rows.length} rows)`);
  check(await page.locator(`${BOX} .kwh-table [data-kwh-del]`).count() === 2, "Table: each boost can be deleted there too");
  await page.locator(BOX).screenshot({ path: `${out}/07-table.png` });
  await page.click("#kwr-chart-toggle");
  await settle(page);

  // ---- French, dark, a phone -----------------------------------------------------------------------------------
  await menu(page, "lang"); await settle(page, 900);
  await openKeyword(page, KEYWORD);
  f = await facts(page);
  check(f.legend.join() === "Modification,Backlink,Boost,Note" && f.words.includes("Ajouter un boost") && f.words.includes("Plus de sites") && f.you === "Vous", `French: the chart's words are in French (${f.legend.join(", ")})`);
  check(f.marks[0].label.startsWith("Modification, ") && /Titre|Description|Contenu/.test(f.marks[0].label), `French: a mark's label too (${f.marks[0].label})`);
  await page.locator(BOX).screenshot({ path: `${out}/08-french.png` });
  await menu(page, "lang"); await settle(page, 700);

  // A phone: the panel takes the screen. (The menu sits behind the phone's menu button, so the theme is switched at desktop width.)
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page, 700);
  await openKeyword(page, KEYWORD);
  f = await facts(page);
  check(!f.wide && f.spills === 0 && f.inside, `phone: nothing wider than the screen (${f.spills} spilling)`);
  check(f.marks.reduce((n, m) => n + m.n, 0) === 9, `phone: every mark is still there, closer ones sharing (${f.marks.length} marks for 9)`);
  await page.locator(`${BOX} .kwh-chips`).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/09-phone.png` });
  await page.click(`${BOX} [data-kwh-add]`); await settle(page);
  f = await facts(page);
  check(f.form && !f.wide && f.spills === 0, "phone: the boost form fits");
  await page.locator(`${BOX} .kwh-form`).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/10-phone-form.png` });
  await page.click(`${BOX} [data-kwh-cancel]`);
  check(await page.evaluate(() => document.activeElement?.hasAttribute("data-kwh-add")), "Cancel closes the form and the keyboard is back on Add a boost");

  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page, 500);
  await menu(page, "theme"); await settle(page, 600);
  await openKeyword(page, KEYWORD);
  check(await page.evaluate(() => document.documentElement.dataset.theme === "dark"), "dark mode is on");
  await page.click(`${BOX} .kwh-lane.kwh-boost .kwh-range`);
  await settle(page);
  f = await facts(page);
  check(f.detail.includes("Google Ads push") && f.detail.includes("Demo admin"), "dark: the picked boost says its note and who added it");
  await page.locator("#panel").screenshot({ path: `${out}/11-dark.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page, 700);
  await openKeyword(page, KEYWORD);
  await page.locator(`${BOX} .kwh-chips`).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/12-phone-dark.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page, 400);
  await menu(page, "theme"); await settle(page, 400);

  const real = problems.filter((p) => !p.includes("api/auth/me") && !p.includes("404"));
  check(!real.length, `no console errors ${JSON.stringify(real)}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL OK");
  process.exit(fails.length ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(2); });
