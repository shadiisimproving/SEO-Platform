// The Sitemap card on Site health (2026-11-18), driven the way a person would use it, in English and French, at 1440 and 390.
// Needs: DB_NAME_TEST=<db> .venv/bin/python tests/ui/app_server.py --port 8314, its health tests finished, then
//        DB_NAME_TEST=<db> .venv/bin/python tests/ui/seed_sitemap.py
// Usage: node tests/ui/flow_sitemap_card.cjs http://127.0.0.1:8314/ <screenshot folder>
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const ROOT = process.argv[2] || "http://127.0.0.1:8314/";
const SHOTS = process.argv[3] || path.join(__dirname, "..", "..", "reports", "seo-expert-2026-11-17", "fixes", "sitemap-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `: ${JSON.stringify(detail)}`}`); };
const wait = (page, ms) => page.waitForTimeout(ms);

async function pickSite(page, host) {
  await page.selectOption("#ht-site", { label: host });
  await page.waitForFunction((h) => document.querySelector(".ht-sitemap") && document.querySelector("#ht-site option:checked")?.textContent === h, host, { timeout: 15000 });
  await wait(page, 400);
}

async function run(width, lang) {
  const { browser, page, problems } = await open({ width, height: 1000 });
  const bad = [];
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/api/auth/me")) bad.push(`${r.status()} ${r.url()}`); }); // no sign-in on the harness: auth/me is 404 there
  const tag = `${width}-${lang}`;
  await page.goto(`${ROOT}#health`);
  await page.evaluate((l) => localStorage.setItem("seocc2-lang", l), lang); // the language as the account menu keeps it
  await page.reload();
  await page.waitForSelector(".ht-sitemap", { timeout: 20000 });
  const fr = lang === "fr";

  // site-one: one of each problem. The answer comes first, with the count of real problems (Info ones aren't counted).
  await pickSite(page, "site-one.example");
  const card = page.locator(".ht-sitemap");
  const answer = (await card.locator(".ht-answer").textContent()).trim();
  check(`${tag}: answer first: how big it is`, answer === (fr ? "38 pages listées · 3 fichiers" : "38 pages listed · 3 files"), answer);
  const rows = await card.locator(".ht-sm-check summary .ht-check-what").allTextContents();
  check(`${tag}: errors first, then warnings, then info`, rows.length === 8 && /error|erreur/i.test(rows[0]) && /date/i.test(rows[rows.length - 1]), rows);
  const pill = (await card.locator(".card-head .end").textContent()).trim();
  check(`${tag}: the verdict in the head, counting real problems only`, pill === (fr ? "6 problèmes" : "6 problems"), pill);
  await card.scrollIntoViewIfNeeded();
  await wait(page, 700);
  await page.screenshot({ path: path.join(SHOTS, `card-${tag}.png`), fullPage: true });

  // Open "Listed pages that give an error": its pages, with the answer each gave, and Create a task.
  await card.locator('[data-ht-check="sm-listed_broken"] > summary').click();
  await wait(page, 300);
  const broken = card.locator("#ht-sm-listed_broken tbody tr");
  check(`${tag}: the error list names both pages`, (await broken.count()) === 2, await broken.allTextContents());
  const codes = await card.locator("#ht-sm-listed_broken tbody td:last-child").allTextContents();
  check(`${tag}: with their answers`, codes.map((c) => c.trim()).sort().join(",") === "404,500", codes);
  check(`${tag}: each address is a link to the page`, (await card.locator("#ht-sm-listed_broken tbody a").count()) >= 2);
  check(`${tag}: a task can be made from it`, (await card.locator('[data-ht-check="sm-listed_broken"] [data-task-new], [data-ht-check="sm-listed_broken"] .task-btn, [data-ht-check="sm-listed_broken"] button').count()) >= 1);
  // Sorting a column (table-tools), on the important pages: most clicks first
  await card.locator('[data-ht-check="sm-sitemap_missing_pages"] > summary').click();
  await wait(page, 300);
  const missing = await card.locator("#ht-sm-sitemap_missing_pages tbody td.head-cell").allTextContents();
  check(`${tag}: important pages, most clicks first`, missing[0]?.includes("/cafe-grains") && missing[1]?.includes("/moulins"), missing);
  await card.locator('[data-ht-check="sm-listed_redirect"] > summary').click();
  await wait(page, 300);
  const goes = await card.locator("#ht-sm-listed_redirect tbody td:last-child").allTextContents();
  check(`${tag}: a redirect says where it goes`, goes[0]?.includes("/subscription"), goes);
  await wait(page, 700);
  await page.screenshot({ path: path.join(SHOTS, `card-open-${tag}.png`), fullPage: true });

  // The files read stay behind one button
  check(`${tag}: files hidden at first`, (await card.locator(".ht-sm-files").count()) === 0);
  await card.locator("[data-ht-sm-files]").click();
  await wait(page, 300);
  const files = await page.locator(".ht-sitemap .ht-sm-files li").count();
  check(`${tag}: Show the files read lists the 3 files`, files === 3, files);
  check(`${tag}: the button keeps focus`, await page.evaluate(() => document.activeElement?.matches("[data-ht-sm-files]")));

  // site-two: no sitemap at all
  await pickSite(page, "site-two.example");
  const none = (await page.locator(".ht-sitemap .ht-answer").textContent()).trim();
  check(`${tag}: a site with no sitemap says so`, none === (fr ? "Aucun sitemap trouvé." : "No sitemap found."), none);
  await page.locator(".ht-sitemap").scrollIntoViewIfNeeded();
  await wait(page, 500);
  await page.screenshot({ path: path.join(SHOTS, `card-none-${tag}.png`) });

  // Page width: no sideways scroll
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${tag}: no sideways scroll`, wide <= 0, wide);

  // The bell: the sitemap problem, opening Site health
  await page.click("#bell-open");
  await wait(page, 600);
  const bell = await page.locator('#bell-pop [data-bell-health]').allTextContents();
  check(`${tag}: the bell says more listed pages give an error`, bell.some((b) => (fr ? /pages listées en erreur, contre 0 avant/ : /listed pages give an error, up from 0/).test(b)), bell);
  await page.locator("#bell-pop").screenshot({ path: path.join(SHOTS, `bell-${tag}.png`) });
  await page.locator("#bell-pop [data-bell-health]").first().click();
  await wait(page, 800);
  check(`${tag}: the bell opens Site health`, /#health/.test(page.url()) && (await page.locator(".ht-sitemap").count()) === 1, page.url());

  check(`${tag}: no page errors`, !problems.filter((p) => !/status of 404/.test(p)).length && !bad.length, [...problems, ...bad]);
  await browser.close();
}

(async () => {
  for (const width of [1440, 390]) for (const lang of ["en", "fr"]) await run(width, lang);
  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
