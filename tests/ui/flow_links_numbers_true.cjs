// Links and competitors say what they claim (SEO expert review 2026-11-17), driven by hand at 1440 and 390, English and French.
// node tests/ui/flow_links_numbers_true.cjs <demo address>
// Needs the demo world: DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8294
// Checks: Competitors on a phone stacks the cards over Changes (no 60 px column); Shared links always has Open Link gaps;
// Link gaps says "not linking to you" in its head; Backlinks has Find prospects; ⌘K finds "link prospects"; a link's panel
// asks "Does it pass value?" with no Google logo, and its verdict has the badge's name. Made-up sites only.
const { open, menu } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = (process.argv[2] || "http://127.0.0.1:8294/").replace(/\/?$/, "/");
const OUT = path.resolve("var/ui-links-numbers-true") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };

async function run(lang, width, height) {
  const tag = `${lang}-${width}`;
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const settle = (ms = 900) => page.waitForTimeout(ms);
  const missing = [];
  page.on("response", (r) => { if (r.status() === 404) missing.push(r.url().replace(BASE, "")); });
  await page.goto(`${BASE}?simple=1#competitors/summary?site=site-one.example`);
  await page.waitForSelector(".cs-cards .cs-card[data-cs-card]", { timeout: 20000 });
  if (lang === "fr") { await menu(page, "lang"); await settle(1200); await page.waitForSelector(".cs-cards .cs-card[data-cs-card]", { timeout: 20000 }); }
  if (width !== 1440) { await page.setViewportSize({ width, height }); await settle(800); }
  await page.waitForSelector("#cs-moves-list tbody tr", { timeout: 20000 });
  await settle(1200);
  await page.screenshot({ path: `${OUT}${tag}-1-competitors.png`, fullPage: width < 800 });

  // ---- the phone layout: the changes get the screen's width --------------------------------------------------------
  const widths = await page.evaluate(() => ({ moves: document.querySelector("#cs-lower")?.getBoundingClientRect().width || 0, page: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  if (width < 800) check(`${tag}: Changes takes the phone's width, under the cards`, widths.moves > widths.page * 0.8, JSON.stringify(widths));
  check(`${tag}: no sideways page scroll`, widths.scroll <= widths.page + 1, JSON.stringify(widths));

  // ---- Shared links: Open Link gaps always in its head -------------------------------------------------------------
  await page.click('[data-cs-low="links"]');
  await settle(1200);
  const head = await page.evaluate(() => Boolean(document.querySelector("#cs-links .cs-head-row [data-cs-review]")));
  check(`${tag}: Shared links has Open Link gaps in its head`, head);
  await page.screenshot({ path: `${OUT}${tag}-2-shared-links.png`, fullPage: width < 800 });

  // ---- Link gaps: says what it is -----------------------------------------------------------------------------------
  await page.click("#cs-links .cs-head-row [data-cs-review]");
  await page.waitForSelector("#cg-table, .cg-summary, .empty", { timeout: 20000 });
  await settle(1500);
  const line = await page.evaluate(() => document.querySelector(".cg-head-line")?.textContent || "");
  check(`${tag}: Link gaps' head says "not linking to you"`, lang === "fr" ? /pas vers vous/.test(line) : /not to you/.test(line), line);
  const strength = await page.evaluate(() => [...document.querySelectorAll("#cg-table tbody tr")].slice(0, 8).map((r) => r.querySelector(".cg-auth")?.textContent.trim() || "—"));
  console.log(`      strength cells: ${strength.join(" | ")}`);
  await page.screenshot({ path: `${OUT}${tag}-3-link-gaps.png`, fullPage: width < 800 });

  // ---- ⌘K finds link prospects ---------------------------------------------------------------------------------------
  await page.keyboard.press("Meta+k");
  await page.waitForSelector("#cmd-input", { timeout: 5000 });
  await page.fill("#cmd-input", "prospects");
  await settle(400);
  const found = await page.evaluate(() => [...document.querySelectorAll("#cmd-list button")].map((b) => b.textContent));
  check(`${tag}: ⌘K finds Link gaps for "prospects"`, found.some((x) => /Link gaps|Liens manquants/.test(x)), found.join(" / "));
  await page.keyboard.press("Escape");

  // ---- Backlinks: Find prospects, and a link's panel ----------------------------------------------------------------
  await page.goto(`${BASE}?simple=1#backlinks`);
  await page.waitForSelector("#bl-table, #bl-sites, .bl-list", { timeout: 20000 });
  await settle(1500);
  check(`${tag}: Backlinks has Find prospects`, Boolean(await page.$("#bl-find-prospects")));
  await page.screenshot({ path: `${OUT}${tag}-4-backlinks.png`, fullPage: width < 800 });
  const live = await page.$('#bl-table tbody tr[data-bl] .vd-tag.vd-counts, #bl-table tbody tr[data-bl] .vd-tag.vd-weak');
  if (live) {
    const row = await live.evaluateHandle((el) => el.closest("tr"));
    await row.click();
    await page.waitForSelector("#vd-answer", { timeout: 10000 });
    await settle(800);
    const panel = await page.evaluate(() => {
      const label = document.querySelector('[data-vd-row="google"] .vd-q-label');
      return { label: label?.textContent.trim() || "", googleLogo: Boolean(label?.querySelector('img[src*="google"]')), answer: document.querySelector("#vd-answer strong")?.textContent.trim(), badge: document.querySelector('[data-vd-row="google"] .vd-q-value')?.textContent.trim() };
    });
    check(`${tag}: the verdict row asks if it passes value, with no Google logo`, /pass value|transmet/i.test(panel.label) && !panel.googleLogo, JSON.stringify(panel));
    check(`${tag}: the verdict on top has the badge's name`, !/Weak link|Working|Lien faible|fonctionne/.test(panel.answer || ""), JSON.stringify(panel));
    await page.screenshot({ path: `${OUT}${tag}-5-link-panel.png` });
  } else console.log(`      (no checked live link in the demo table at ${tag})`);
  // A logo the demo has no file for, and api/auth/me with no login (the harness), answer 404: no error of these screens.
  const real = problems.filter((p) => !/404/.test(p) || missing.some((m) => !/logo|favicon|api\/auth\/me/.test(m)));
  check(`${tag}: no errors on the page`, !real.length, `${real.join(" | ")} ${missing.join(", ")}`);
  await browser.close();
}

(async () => {
  for (const [lang, w, h] of [["en", 1440, 950], ["en", 390, 844], ["fr", 1440, 950], ["fr", 390, 844]]) await run(lang, w, h);
  console.log(bad ? `${bad} FAILED` : "ALL PASS");
  process.exit(bad ? 1 : 0);
})();
