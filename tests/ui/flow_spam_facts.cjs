// Link gaps: a hard fact the app saw beats the file's spam score (owner, 2026-11-18), by hand at 1440 and 390, EN and FR.
// node tests/ui/flow_spam_facts.cjs <demo address> [shots folder]
// Needs the demo world (tests/ui/app_server.py) with, made up, in link_domains:
//   local-news.example (file score 2) leads_elsewhere -> link-shop.example, home-kitchen.example (file score 6) parked,
//   coffee-review.example (file score 3) site_down, all checked 2026-11-18 08:00.
// Checks: the redirect and the parked domain sit under Flagged with what the app saw and the score it overruled, in every
// view; site down stays in Good ones with its note; Not spam shows on the row with a tip that it overrides the app's check,
// and pressing it puts the domain back in Good ones (undone at the end, so the flow can run again).
const { open, menu } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = (process.argv[2] || "http://127.0.0.1:8318/").replace(/\/?$/, "/");
const OUT = path.resolve(process.argv[3] || "var/ui-spamfacts") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };

async function run(lang, width, height, simple, press) {
  const tag = `${lang}-${width}${simple ? "-simple" : ""}`;
  const fr = lang === "fr";
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  const settle = (ms = 900) => page.waitForTimeout(ms);
  const missing = [];
  page.on("response", (r) => { if (r.status() === 404) missing.push(r.url().replace(BASE, "")); });
  await page.goto(`${BASE}?simple=${simple ? 1 : 0}#competitors/gaps?site=site-one.example`);
  await page.waitForSelector("#cg-table", { timeout: 20000 });
  if (fr) { await menu(page, "lang"); await settle(1200); await page.waitForSelector("#cg-table", { timeout: 20000 }); }
  if (width !== 1440) { await page.setViewportSize({ width, height }); await settle(800); }
  await settle(1000);
  const row = (d) => page.evaluate((d) => {
    const r = document.querySelector(`[data-cg-row="${d}"]`);
    if (!r) return null;
    const b = r.querySelector("[data-cg-decide]"), box = b?.getBoundingClientRect();
    return { text: r.textContent.replace(/\s+/g, " ").trim(), flagged: r.classList.contains("cg-flagged"), button: b ? { word: b.textContent.trim(), tip: b.dataset.tip || "", w: box.width, h: box.height } : null };
  }, d);
  const quality = async (id) => { if (simple && !(await page.isVisible(`[data-cg-quality="${id}"]`))) { await page.evaluate(() => document.querySelector(".main")?.scrollTo({ top: 0, behavior: "instant" })); await settle(400); await page.click("#cg-filters"); await page.waitForSelector("#popover.cg-filter-pop", { timeout: 5000 }); await settle(300); }
    await page.click(`[data-cg-quality="${id}"]`); await settle(700); if (simple && (await page.isVisible(".cg-filter-pop"))) { await page.keyboard.press("Escape"); await settle(300); } };

  await quality("all");
  const moved = await row("local-news.example"), parked = await row("home-kitchen.example"), down = await row("coffee-review.example");
  check(`${tag}: the redirect is flagged and says where it leads and the score it overruled`, moved?.flagged && /link-shop\.example/.test(moved.text) && (fr ? /Redirige vers/.test(moved.text) && /score du fichier \(2\) écarté/.test(moved.text) : /Redirects to/.test(moved.text) && /file score 2 overruled/.test(moved.text)), moved?.text);
  // home-kitchen.example is in To do: the person's choice beats any rule, so it isn't flagged, but the row says what the app saw.
  check(`${tag}: a parked domain the person put in To do stays theirs, with the app's note and the score`, parked && !parked.flagged && (fr ? /Parqué ou à vendre/.test(parked.text) && /\(6\) écarté/.test(parked.text) : /Parked or for sale/.test(parked.text) && /file score 6 overruled/.test(parked.text)), parked?.text);
  check(`${tag}: site down alone stays in Good ones with its note`, down && !down.flagged && (fr ? /L'appli a vu/.test(down.text) : /The app saw/.test(down.text)), down?.text);
  check(`${tag}: Not spam is on the redirect row, visible, with a tip that it overrides the app's check`,
    moved?.button && moved.button.w > 20 && moved.button.h > 20 && (fr ? moved.button.word === "Pas du spam" && /Passe avant le contrôle de l'appli/.test(moved.button.tip) : moved.button.word === "Not spam" && /Overrides the app's check/.test(moved.button.tip)), JSON.stringify(moved?.button));
  const summary = await page.evaluate(() => document.querySelector(".cg-summary")?.textContent.replace(/\s+/g, " ").trim());
  console.log(`      header: ${summary}`);
  await page.evaluate(() => document.querySelector('[data-cg-row="local-news.example"]')?.scrollIntoView({ block: "center" }));
  await settle(300);
  await page.screenshot({ path: `${OUT}${tag}-1-all.png`, fullPage: width < 800 });

  await quality("spam");
  const inSpam = await row("local-news.example");
  check(`${tag}: under Flagged as spam the row still says where it leads`, inSpam?.flagged && /link-shop\.example/.test(inSpam.text), inSpam?.text);
  const reasons = await page.evaluate(() => document.querySelector(".cg-reasons")?.textContent.replace(/\s+/g, " ").trim());
  check(`${tag}: the reasons line counts the redirect and the parked domain`, fr ? /Redirige vers un autre site/.test(reasons) && /Parqué ou à vendre/.test(reasons) : /Redirects to another site/.test(reasons) && /Parked or for sale/.test(reasons), reasons);
  if (width === 1440) { await page.hover('[data-cg-row="local-news.example"] [data-cg-decide]'); await settle(700); }
  await page.screenshot({ path: `${OUT}${tag}-2-flagged.png`, fullPage: width < 800 });

  if (press) {
    await page.click('[data-cg-row="local-news.example"] [data-cg-decide]');
    await settle(1500);
    await quality("good");
    const back = await row("local-news.example");
    check(`${tag}: Not spam puts the redirect back in Good ones`, back && !back.flagged && (fr ? /Gardé par vous/.test(back.text) : /Kept by you/.test(back.text)), back?.text);
    await page.screenshot({ path: `${OUT}${tag}-3-kept.png`, fullPage: width < 800 });
    await page.evaluate(() => COMP.api("POST", "link-gaps/decide", { site_id: COMP.siteId, domain: "local-news.example", decision: "auto" }));
    await settle(500);
  }
  const scroll = await page.evaluate(() => ({ page: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  check(`${tag}: no sideways page scroll`, scroll.scroll <= scroll.page + 1, JSON.stringify(scroll));
  // A made-up site has no logo file (a 404 the page draws a letter for), and sign-in is off on the test server; anything else missing is a fault.
  const real = missing.filter((u) => !/logo/i.test(u) && u !== "api/auth/me"); // the test server runs with sign-in off
  console.log(`      404s: ${missing.join(", ") || "none"}`);
  check(`${tag}: no page errors and nothing missing but made-up logos`, problems.filter((p) => !/404/.test(p)).length === 0 && real.length === 0, [...problems, ...real].join(" | "));
  await browser.close();
}

(async () => {
  await run("en", 1440, 950, true, true);
  await run("en", 1440, 950, false, false);
  await run("en", 390, 844, true, true);
  await run("fr", 1440, 950, true, true);
  await run("fr", 390, 844, true, false);
  console.log(bad ? `${bad} FAILED` : "ALL PASS");
  process.exit(bad ? 1 : 0);
})();
