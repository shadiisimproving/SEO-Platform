// Competitors → Page vs page: every position in the pairs table carries the logo of the tool that measured it (2026-11-12).
// The tooltip names the tool, the engine and the check date, and says whether You and Them came from the same check.
// One row is changed here (page.route) so its two sides come from different tools: the tooltip must say so.
//   DB_NAME_TEST=test_pairlogo_ui_test DB_POOL_SIZE=2 DB_MAX_OVERFLOW=6 .venv/bin/python tests/ui/app_server.py --port 8471
//   node tests/ui/flow_pair_tool_logos.cjs http://127.0.0.1:8471/
//   node tests/ui/with_simple.cjs flow_pair_tool_logos.cjs http://127.0.0.1:8471/     (the same with ?simple=1)
const { open, menu } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8471/";
const OUT = path.resolve("var/ui-pair-tool-logos") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const settle = (ms = 700) => page.waitForTimeout(ms);

  // The second pair's lead keyword: You from SerpApi, Them from Bright Data two days before. Other rows stay as sent.
  await page.route(/\/api\/page-pairs\?site_id=\d+$/, async (route) => {
    const res = await route.fetch();
    const d = await res.json();
    const k = d.pairs?.[1]?.ranking?.keywords?.[0];
    if (k) Object.assign(k, { my_tool: "SerpApi", their_tool: "Bright Data", my_checked_at: "2026-11-10T08:00:00Z", their_checked_at: "2026-11-08T08:00:00Z", my_check_id: 1, their_check_id: 2 });
    await route.fulfill({ response: res, json: d });
  });

  await page.goto(BASE + "#competitors/pairs");
  await page.waitForSelector("#cp-table tbody tr", { timeout: 30000 }); await settle(1500);
  const simple = await page.evaluate(() => { try { return localStorage.getItem("seocc2-simple") === "1"; } catch { return false; } });
  const tag = simple ? "simple-" : "";
  console.log(`simple switch: ${simple ? "on" : "off"}`);

  const cells = () => page.$$eval("#cp-table > tbody > tr", (trs) => trs.map((tr) => [...tr.querySelectorAll("td.cp-simple-pos")].map((td) => {
    const mark = td.querySelector(".cp-src");
    return { text: td.textContent.replace(/\s+/g, " ").trim(), tool: mark?.dataset.cpSrc || "", tip: (mark?.dataset.tip || "").replace(/\u2060/g, ""), logo: Boolean(mark?.querySelector("img.brand-logo")), loaded: Boolean(mark?.querySelector("img")?.naturalWidth), apart: Boolean(mark?.classList.contains("cp-src-apart")) };
  })));
  const rows = await cells();
  const flat = rows.flat().filter((c) => /#\d+|>\d+/.test(c.text));
  check("1. the pairs table has rows, each with a You and a Them position", rows.length > 1 && rows.every((r) => r.length === 2), `${rows.length} rows`);
  check("2. every position has a tool logo, loaded", flat.length === rows.length * 2 && flat.every((c) => c.logo && c.loaded), flat.filter((c) => !c.logo || !c.loaded).map((c) => c.text).join(", ") || `${flat.length} positions`);
  check("3. the tooltip names the tool and the check date", flat.every((c) => c.tip.includes(`measured by ${c.tool}`) && /checked \d{1,2} \w{3} \d{4}/.test(c.tip)), flat[0]?.tip);
  const same = rows.filter((_, i) => i !== 1).flat();
  check("4. sides from one check say so", same.every((c) => /You and Them come from this same check\./.test(c.tip) && !c.apart), same[0]?.tip);
  const apart = rows[1] || [];
  check("5. sides from different tools say so, on both, and are marked", apart.length === 2 && apart[0].tool === "SerpApi" && apart[1].tool === "Bright Data"
    && /Them came from Bright Data, 8 Nov 2026: a different check/.test(apart[0].tip) && /You came from SerpApi, 10 Nov 2026: a different check/.test(apart[1].tip) && apart.every((c) => c.apart), apart.map((c) => c.tip).join(" | "));

  await page.hover("#cp-table > tbody > tr:first-child td.cp-simple-pos .cp-src"); await settle(700);
  const shown = await page.evaluate(() => [...document.querySelectorAll("[role=tooltip]")].filter((x) => x.getBoundingClientRect().width > 0).map((x) => `${x.textContent.replace(/\u2060/g, "")} hidden:${[...x.querySelectorAll(".brand-name-hidden")].map((h) => h.textContent).join("/")}`).join(" "));
  // brands.js may turn "Google" into its logo, but the tool's own name stays in words: that's what the tooltip is for.
  check("6. hovering a logo shows its tooltip, the tool named in words", /measured by SerpApi/.test(shown) && !/hidden:.*SerpApi/.test(shown), shown.slice(0, 160));
  await page.screenshot({ path: OUT + `${tag}1440-light.png` });

  await page.setViewportSize({ width: 390, height: 844 }); await settle(1000);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const phoneLogos = await page.$$eval("#cp-table > tbody > tr td.cp-simple-pos .cp-src img", (imgs) => imgs.filter((i) => i.getBoundingClientRect().width > 0).length);
  check("7. phone: a logo beside each position, no sideways scroll", phoneLogos === flat.length && !sideways, `${phoneLogos} logos`);
  await page.evaluate(() => document.querySelector("#cp-table")?.scrollIntoView({ block: "start" })); await settle(300);
  await page.screenshot({ path: OUT + `${tag}390-light.png` });

  // The account menu sits in the side menu, which a phone folds away: switch the theme at desktop width.
  await page.setViewportSize({ width: 1440, height: 950 }); await settle(900);
  await menu(page, "theme"); await settle(900);
  await page.keyboard.press("Escape"); await settle(300);
  await page.evaluate(() => window.scrollTo(0, 0)); await settle(300);
  await page.screenshot({ path: OUT + `${tag}1440-dark.png` });
  await page.setViewportSize({ width: 390, height: 844 }); await settle(1000);
  await page.evaluate(() => document.querySelector("#cp-table")?.scrollIntoView({ block: "start" })); await settle(300);
  await page.screenshot({ path: OUT + `${tag}390-dark.png` });
  await page.setViewportSize({ width: 1440, height: 950 }); await settle(900);
  await menu(page, "theme"); await settle(500); // back to light

  await page.evaluate(() => { window.UI.state.lang = "fr"; window.UI.render(); }); await settle(1800);
  const fr = await page.$eval("#cp-table > tbody > tr:first-child td.cp-simple-pos .cp-src", (m) => m.dataset.tip).catch(() => "");
  check("8. French tooltip", /mesuré par .+ vérifié le/.test(fr), fr);
  await page.evaluate(() => { window.UI.state.lang = "en"; window.UI.render(); }); await settle(800);

  const real = problems.filter((p) => !/404/.test(p)); // /api/auth/me answers 404 when the test server runs without --login
  check("9. no page errors", real.length === 0, real.slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
