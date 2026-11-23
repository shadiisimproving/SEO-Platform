// Competitors → Changes read like a person reads (2026-11-20): one row per competitor page, under the page of mine it
// competes with (named once, with what it brings), quiet groups folded, Details as a full-width row.
// node tests/ui/flow_reading_competitors.cjs <demo address> [folder for screenshots]
// Needs the demo world: DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8452 --slow 0
// The demo world, worked out by hand: 8 changes in 30 days. rival-one.example/subscription has a text edit (+300 words)
// and a new meta description: one row, beside my /abonnement (154 clicks). rival-one is cited by AI on two keywords (one
// row) and has a new title, both beside my /guide/brew; rival-two is cited beside my /subscription. That is 4 rows under
// 3 pages of mine. A new page and a removed page have no page of mine beside them: 2 rows, folded.
process.env.SEOCC_REAL_DEFAULT = "1";
const { open, menu } = require("./pw.cjs");
const BASE = process.argv[2] || "http://localhost:8452";
const OUT = (process.argv[3] || ".") + "/reading-competitors-";
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };

const read = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll("#cs-moves-list tbody tr")];
  return {
    groups: rows.filter((tr) => tr.matches(".rd-group")).map((tr) => ({ name: tr.querySelector(".rd-group-name")?.textContent, extra: tr.querySelector(".rd-group-extra")?.innerText.replace(/\s+/g, " ").trim() || "", href: tr.querySelector(".rd-group-extra a")?.getAttribute("href") || "", bar: tr.querySelector(".rd-group-extra .rd-bar i")?.style.width || "", n: tr.querySelector(".rd-group-n")?.textContent, open: tr.querySelector("[data-rd-fold]")?.getAttribute("aria-expanded") })),
    rows: rows.filter((tr) => tr.matches(".cs-line")).map((tr) => ({
      where: tr.querySelector(".cs-line-page")?.innerText.replace(/\s+/g, " ").trim(), what: tr.querySelector(".cs-what")?.innerText.replace(/\s+/g, " ").trim() || "",
      vs: tr.querySelector(".cs-line-vs")?.innerText.replace(/\s+/g, " ").trim() || "", cells: tr.querySelectorAll("td:not(.tt-pick)").length, tall: Math.round(tr.getBoundingClientRect().height),
    })),
    foot: document.querySelector('[data-tp-foot="cs-moves"]')?.innerText.replace(/\s+/g, " ").trim() || "",
  };
});

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/?simple=1#competitors`);
  await page.waitForSelector("#cs-moves-list tbody tr");
  await page.waitForTimeout(500);
  let v = await read(page);
  await page.screenshot({ path: OUT + "1-default.png", fullPage: true });
  const names = v.groups.map((g) => `${g.name}:${g.n}:${g.open}`);
  check("my pages lead, the one with the most clicks first, each naming its rows", names[0] === "Beside your /abonnement:1:true" && names[1] === "Beside your /guide/brew:2:true" && names[2] === "Beside your /subscription:1:true", names.join(" | "));
  check("my page's clicks are said once, on its line, with a full bar", /154 clicks/.test(v.groups[0].extra) && v.groups[0].bar === "100%", `${v.groups[0].extra} / ${v.groups[0].bar}`);
  check("my page opens in the app's Pages screen, not the live site", /^#pages\?page=https%3A%2F%2Fsite-one\.example%2Fabonnement/.test(v.groups[0].href), v.groups[0].href);
  check("their other pages are folded, with their count", names[3] === "On their other pages:2:false", names[3]);
  check("8 changes are 4 rows on show", v.rows.length === 4, v.rows.length);
  const sub = v.rows[0];
  check("a page edited twice is one line, said in two words", /\/subscription/.test(sub?.where) && sub.what === "Text rewritten", JSON.stringify(sub));
  const ai = v.rows.find((r) => /2 keywords/.test(r.where));
  check("one competitor cited by AI on two keywords is one line", ai && ai.what === "Cited by AI", JSON.stringify(ai));
  check("a row is three things and a way in: their page, what happened, where they beat me", v.rows.every((r) => r.cells === 4 && r.tall <= 64), v.rows.map((r) => `${r.cells}:${r.tall}`).join(","));
  check("with no ranking beside mine in the demo, the last column is a quiet dash", v.rows.every((r) => r.vs === "–"), v.rows.map((r) => r.vs).join("|"));
  check("the footer counts pages", /1–4 of 4 pages/.test(v.foot), v.foot);

  await page.click('[data-rd-fold][data-rd-id="other"]');
  await page.waitForTimeout(300);
  v = await read(page);
  check("opening the folded group shows its rows under its name", v.rows.length === 6 && v.groups[3]?.open === "true", `${v.rows.length} / ${JSON.stringify(v.groups[3])}`);
  check("the focus stays on the group's line", await page.evaluate(() => document.activeElement?.dataset.rdId === "other"));
  await page.screenshot({ path: OUT + "2-open.png", fullPage: true });
  await page.click('[data-rd-fold][data-rd-id="other"]');
  await page.waitForTimeout(200);

  // Nothing to learn over the table: a search box and the kinds of change. No Filter box, no sort arrows, no switches.
  const tools = await page.evaluate(() => ({ heads: [...document.querySelectorAll("#cs-moves-list thead th")].map((th) => th.textContent.trim()).filter(Boolean).join("|"), arrows: document.querySelectorAll("#cs-moves-list thead button:not(.icon-btn):not(.info-btn)").length, filter: document.querySelectorAll("#cs-moves [data-tt-filter], #cs-mv-sort, [data-cs-mv-behind]").length, ticks: document.querySelectorAll("#cs-moves-list tbody .tt-pick input").length }));
  check("three headings, no Filter box or sort control, tick boxes stay", /^Their page\|What happened\|Keywords where they beat you/.test(tools.heads) && tools.filter === 0 && tools.ticks === 4, JSON.stringify(tools));

  await page.click("#cs-moves-list [data-cs-detail]");
  await page.waitForTimeout(300);
  const below = await page.evaluate(() => {
    const row = document.querySelector("#cs-moves-list tr.cs-detail-row");
    return { parts: [...(row?.querySelectorAll(".cl-tl-part") || [])].map((p) => p.innerText.replace(/\s+/g, " ").trim()), wide: row ? row.querySelector("td").colSpan : 0, under: row?.previousElementSibling?.matches("tr.open") || false, pressed: document.activeElement?.getAttribute("aria-expanded") };
  });
  check("Details opens as its own row under the page, across the table, each change with its date", below.parts.length === 2 && below.wide >= 4 && below.under && below.parts.some((p) => /Meta description changed/.test(p)) && below.parts.some((p) => /Content changed/.test(p)), JSON.stringify(below).slice(0, 260));
  check("the Details button says it is open and keeps the focus", below.pressed === "true", below.pressed);
  await page.screenshot({ path: OUT + "3-details.png", fullPage: true });
  await page.click("#cs-moves-list [data-cs-detail]");
  await page.waitForTimeout(200);
  check("pressing it again closes the row", !(await page.$("#cs-moves-list tr.cs-detail-row")));
  await page.click("#cs-moves-list tr.cs-line .cs-what");
  await page.waitForTimeout(300);
  const byRow = await page.evaluate(() => ({ open: Boolean(document.querySelector("#cs-moves-list tr.cs-detail-row")), task: Boolean(document.querySelector("#cs-moves-list tr.cs-detail-row .cs-detail-foot button")), link: document.querySelector("#cs-moves-list tr.cs-detail-row .cs-detail-open")?.textContent.trim() }));
  check("pressing anywhere on a line opens it too, with Task and Open their page inside", byRow.open && byRow.task && byRow.link === "Open their page", JSON.stringify(byRow));
  await page.click("#cs-moves-list tr.cs-line .cs-what");
  await page.waitForTimeout(200);

  // The cards side: folded to a rail of logos on a window under 1600 px, so the changes get the width; one button opens it.
  const side = () => page.evaluate(() => ({ slim: document.querySelector(".cs-bench").classList.contains("cs-bench-slim"), side: Math.round(document.querySelector("#cs-rivals").getBoundingClientRect().width), table: Math.round(document.querySelector("#cs-moves-list").getBoundingClientRect().width), card: Math.round(document.querySelector(".cs-card[data-cs-card]").getBoundingClientRect().width), pressed: document.querySelector("[data-cs-slim]").getAttribute("aria-pressed") }));
  let s = await side();
  check("at 1440 px the cards start folded to logos and the table takes the width", s.slim && s.side < 80 && s.card <= 48 && s.table > 1000 && s.pressed === "true", JSON.stringify(s));
  await page.click(".cs-bench-slim .cs-card[data-cs-card] [data-cs-pick]");
  await page.waitForTimeout(400);
  const picked = await page.evaluate(() => ({ chip: document.querySelector(".cs-mv-who")?.innerText.trim() || "", tip: document.querySelector(".cs-card.on [data-cs-pick]")?.dataset.tip || "" }));
  check("a logo still picks its competitor, and names it on hover", picked.chip !== "" && picked.tip !== "", JSON.stringify(picked));
  await page.click(".cs-mv-who");
  await page.waitForTimeout(300);
  await page.click("[data-cs-slim]");
  await page.waitForTimeout(300);
  s = await side();
  check("the button opens the cards, and keeps the focus", !s.slim && s.side > 240 && s.pressed === "false" && (await page.evaluate(() => document.activeElement?.hasAttribute("data-cs-slim"))), JSON.stringify(s));
  await page.reload();
  await page.waitForSelector("#cs-moves-list tbody tr");
  s = await side();
  check("the choice is kept after a reload", !s.slim, JSON.stringify(s));
  await page.screenshot({ path: OUT + "3b-cards-open.png", fullPage: true });
  await page.click("[data-cs-slim]");
  await page.waitForTimeout(300);

  await menu(page, "lang");
  await page.waitForSelector("#cs-moves-list tbody tr");
  await page.waitForTimeout(500);
  v = await read(page);
  check("in French the groups and the column are in French", v.groups[0]?.name === "Face à votre /abonnement" && /154 clics/.test(v.groups[0].extra), `${v.groups[0]?.name} / ${v.groups[0]?.extra}`);
  await page.screenshot({ path: OUT + "4-fr.png", fullPage: true });
  await menu(page, "lang");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.click("#cs-moves-list [data-cs-detail]");
  await page.waitForTimeout(300);
  const phone = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth > window.innerWidth + 1, box: Math.round(document.querySelector(".cs-detail-box")?.getBoundingClientRect().width || 0) }));
  check("on a phone nothing scrolls sideways and Details takes the screen's width", !phone.wide && phone.box > 280, JSON.stringify(phone));
  await page.screenshot({ path: OUT + "5-phone.png", fullPage: true });

  const real = problems.filter((p) => !/status of 404/.test(p)); // /api/auth/me answers 404 without --login
  check("no page errors", real.length === 0, real.slice(0, 3).join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASSED");
  process.exit(bad ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
