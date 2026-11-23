// Channels, Conversions and Content on the simpler screens (?simple=1, track T2, 2026-11-12), driven the way a person uses
// them, with screenshots to look at; and the Content fixes the owner asked for that also hold with the switch off.
// Made-up sites only. Needs the real app on the fake internet, Google connected for site-one.example, and these made-up
// extras on site-one.example: GA4's (not set) page, social sources written many ways (m.facebook.com, meta, Linkedin…),
// Clarity live days, and a Clarity dashboard download for 9 Aug – 6 Nov 2026 with a speed score of 73:
//   DB_NAME_TEST=test_t2_p2_a_test .venv/bin/python tests/ui/app_server.py --port 8411 --slow 0
//   DB_NAME_TEST=test_t2_p2_a_test .venv/bin/python tests/ui/seed_simple_traffic.py
// Run: node tests/ui/flow_simple_traffic.cjs http://127.0.0.1:8411/ reports/simplify-p2/t2
const fs = require("fs");
const { open } = require("./pw.cjs");
const BASE = (process.argv[2] || "http://127.0.0.1:8411/").replace(/\/?$/, "/");
const OUT = process.argv[3] || "reports/simplify-p2/t2";
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, what, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${extra !== "" ? `  [${extra}]` : ""}`); if (!ok) fails.push(what); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(false, `${name}: ${e.message.split("\n")[0]}`); } };

async function start(simple, { width = 1440, height = 900 } = {}) {
  const s = await open({ width, height, url: `${BASE}?simple=${simple}&flow=${Date.now()}#tasks` });
  s.page.setDefaultTimeout(10000);
  await s.page.waitForSelector(".nav-item", { timeout: 15000 });
  await s.page.waitForTimeout(1200);
  await s.page.evaluate(() => { const x = window.SITES.find((v) => v.host === "site-one.example"); window.UI.state.site = x.id; window.UI.render(); });
  return s;
}
const go = async (page, route) => { if (await page.$("#panel")) { await page.keyboard.press("Escape"); await page.waitForTimeout(350); } await page.click(`#sidebar button[data-go="${route}"]`); await page.waitForTimeout(1800); await page.mouse.move(5, 5); };
const text = (page, sel) => page.locator(sel).first().innerText({ timeout: 2000 }).then((s) => s.replace(/\s+/g, " ").trim()).catch(() => "");
const count = (page, sel) => page.locator(sel).count();
const tab = async (page, id) => { await page.click(`[data-lv-ptab="${id}"]`); await page.waitForTimeout(500); };
const metricAsks = (page, t0) => page.evaluate((since) => window.SCREEN_DATA.log().filter((x) => x.start >= since && !x.quiet && x.path.startsWith("metrics/")).map((x) => x.path), t0);

(async () => {
  // ---- the switch on ------------------------------------------------------------------------------------------
  const { browser, page, problems } = await start(1);
  const failed = [];
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/auth/me")) failed.push(`${r.status()} ${r.url().replace(BASE, "/")}`); });
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
  check(await page.evaluate(() => window.UI.simple() === true), "the simpler screens switch is on");
  check(await page.evaluate(() => ["channels", "conversions", "content"].every((r) => window.SCREEN_DATA.screens().includes(r))), "Channels, Conversions and Content give SCREEN_DATA their first-view answers");

  await step("Channels", async () => {
    const since = await page.evaluate(() => performance.now());
    await go(page, "channels");
    const asked = await metricAsks(page, since);
    check(asked.length <= 1 && asked.every((p) => p.includes("include=logos")), "Channels: one call at most, with the known logos folded in", asked.join(", "));
    check(await count(page, "#topbar.head .head-period [data-preset]") === 4, "Channels: the head has the four periods");
    check(/Visit and lead sources/.test(await page.getAttribute("#topbar .head-i-all", "data-tip") || ""), "Channels: the old subtitle sits behind the (i)");
    check(await count(page, "#page .ncard[data-card]") === 4, "Channels: four number cards", await count(page, "#page .ncard[data-card]"));
    check(await count(page, "#page .ncard .ncard-graph") >= 3, "Channels: Visits, Leads and Lead rate have their own graph");
    check(!(await page.$("#page [data-lv-rule-form]")), "Channels: the rules form left the first view");
    // Google Analytics' own notes (key events counted, other website...) stay under the cards since the review of 2026-11-17 (W1).
    check(!(await page.$("#page .lv-note:not(.ga4-note)")), "Channels: no small print under the head");
    const rows = await count(page, '#page tr[data-rp-open="channel"]');
    check(rows >= 3, "Channels: every channel row opens its panel", rows);
    const firstRow = await page.evaluate(() => Math.round(document.querySelector("#page tbody tr").getBoundingClientRect().top + document.querySelector("#main").scrollTop));
    check(firstRow < 500, "Channels: the channel table starts in the first view", `${firstRow} px`);
    check(await page.evaluate(() => { const a = document.querySelector('[data-lv-chart="channels"]')?.closest(".card"), b = document.querySelector('#page tr[data-rp-open="referrer"]')?.closest(".card"); return Boolean(a && b) && Math.abs(a.getBoundingClientRect().top - b.getBoundingClientRect().top) < 4; }), "Channels: the chart and Referring sites sit side by side");
    await shot("channels-1440-light-en");
    await page.locator('#page tr[data-rp-open="channel"] td[data-label="Visits"]').first().click();
    await page.waitForSelector("#panel.rp .rp-nums", { timeout: 10000 }); await page.waitForTimeout(400);
    check(/Organic Search|Direct|Referral/.test(await text(page, "#panel h2")), "Channels: a channel row opens the channel panel");
    await shot("channels-row-panel");
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    await page.locator('#page tr[data-rp-open="referrer"] td[data-label="Visits"]').first().click();
    await page.waitForSelector("#panel.rp .rp-nums", { timeout: 10000 });
    check(/\./.test(await text(page, "#panel h2")), "Channels: a referring site opens its panel");
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    // Channel rules: in a panel from the table's head, with its hint; adding and removing a rule redraw the list in place.
    await page.click("#page [data-lv-rules]"); await page.waitForSelector("#panel [data-lv-rule-form]");
    check(/Rename channels/.test(await text(page, "#panel .lv-rules-help")), "Channels: Channel rules opens a panel with its hint");
    await page.fill('#panel [name="f_pattern"]', "flow-rule.example/*"); await page.fill('#panel [name="f_value"]', "Flow channel");
    await page.click('#panel [data-lv-rule-form] button[type="submit"]');
    await page.waitForFunction(() => /flow-rule\.example/.test(document.querySelector("#panel [data-lv-rules-body]")?.textContent || ""), null, { timeout: 8000 });
    check(true, "Channels: a rule added shows in the panel at once");
    await shot("channels-rules-panel");
    await page.click('#panel [data-lv-rule-del][aria-label*="flow-rule.example"]');
    await page.waitForFunction(() => !/flow-rule\.example/.test(document.querySelector("#panel [data-lv-rules-body]")?.textContent || "x"), null, { timeout: 8000 });
    check(true, "Channels: a rule removed leaves the panel's list");
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  });

  await step("Conversions", async () => {
    await go(page, "conversions");
    const tip = await page.getAttribute("#topbar .head-i-all", "data-tip") || "";
    check(/no personal data/.test(tip), "Conversions: \"counts only, no personal data\" sits behind the (i)");
    check(await count(page, "#page .ncard[data-card]") === 3 && (await count(page, "#page .ncard .d-pill")) >= 2, "Conversions: three cards with their change");
    const lines = await count(page, "#page .lv-fline");
    check(lines >= 3 && /didn't become a lead|had no key event/.test(await page.getAttribute("#page .lv-fline .track", "data-tip") || ""), "Conversions: one line per channel, the lost visits on the bar's tip", lines);
    check(await page.getAttribute('[data-lv-ptab="conversions:pages"]', "aria-selected") === "true", "Conversions: Pages that bring leads is the first tab");
    check(await count(page, '#page tr[data-rp-open="page"]') >= 2, "Conversions: page rows open the page panel");
    check(await count(page, "#page .lv-tab-tools button") >= 1, "Conversions: Filter sits beside the tabs");
    await shot("conversions-1440-light-en");
    await page.locator('#page tr[data-rp-open="page"] td[data-label="Visits"]').first().click();
    await page.waitForSelector("#panel.rp .rp-nums", { timeout: 10000 }); await page.waitForTimeout(400);
    check(true, "Conversions: a page row opens the page panel");
    await shot("conversions-row-panel");
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    await tab(page, "conversions:types");
    check(await count(page, '#page [data-lv-sort="types"]') >= 4, "Conversions: Page types is one tab away");
    await shot("conversions-page-types");
    await tab(page, "conversions:pages");
  });

  await step("Content", async () => {
    const since = await page.evaluate(() => performance.now());
    await go(page, "content");
    const asked = await metricAsks(page, since);
    check(asked.length <= 1, "Content: one call at most for its first view (Clarity and speed folded in)", asked.join(", "));
    const tabs = await page.$$eval("#page .lv-page > .page-tabs [role=tab]", (b) => b.map((x) => x.textContent.trim()));
    // Content tracker joined the tabs on 2026-11-20 (the Mickaz features).
    check(tabs.length === 5 && /All pages/.test(tabs[0]) && ["Content tracker", "Social networks", "Page speed", "Clarity"].every((x) => tabs.includes(x)), "Content: page tabs All pages, Content tracker, Social networks, Page speed and Clarity", tabs.join(" | "));
    const head = await text(page, "#page .card .card-head");
    check(/–/.test(head), "Content: All pages says its source and days in its head", head);
    const last = await page.evaluate(() => { const rows = [...document.querySelectorAll("#page tbody tr")]; const r = rows[rows.length - 1]; return { text: r?.innerText || "", link: Boolean(r?.querySelector("a")), opens: r?.dataset.rpOpen || "" }; });
    check(/Unknown page \(not set\)/.test(last.text) && !last.link && !last.opens, "Content: (not set) is last, as \"Unknown page (not set)\", not a link", last.text.slice(0, 40));
    check(await count(page, '#page tr[data-rp-open="page"]') >= 3, "Content: page rows open the page panel");
    await shot("content-1440-light-en");
    await tab(page, "content:social");
    const social = await page.$$eval("#page .lv-bar .lab", (l) => l.map((x) => x.textContent.trim()));
    check(social.filter((s) => s === "Facebook").length === 1 && social.includes("LinkedIn") && !social.some((s) => /facebook\.com|^meta$|^Linkedin$/.test(s)), "Content: social networks grouped by network", social.join(", "));
    check(await count(page, "#page .lv-bar .lab img.site-logo") >= 2, "Content: networks have their logos");
    await shot("content-social");
    await tab(page, "content:speed");
    const speed = await text(page, "#page");
    check(/Speed score/.test(speed) && /73/.test(speed), "Content: Clarity's speed score sits on Page speed");
    await shot("content-speed");
    await tab(page, "content:clarity");
    check(await count(page, "#page .lv-clarity") === 1, "Content: one Clarity block");
    check(await page.getAttribute('[data-lv-ptab="clarity:live"]', "aria-selected") === "true" && await count(page, '#page .lv-clarity .ncard[data-card="clarity-sessions"]') === 1, "Content: Clarity's live counts first");
    await shot("content-clarity-live");
    await tab(page, "clarity:download");
    const clarity = await text(page, "#page .lv-clarity");
    check(!/Speed score/.test(clarity), "Content: no speed score inside the Clarity download");
    check(/Clarity download · 9 Aug – 6 Nov/.test(clarity), "Content: the download says its own days", clarity.slice(0, 80));
    const tight = await page.evaluate(() => { const tbl = document.querySelector("#page .lv-compact table"); const card = tbl?.closest(".card"); return tbl && card ? tbl.getBoundingClientRect().width / card.getBoundingClientRect().width : 1; });
    check(tight < 0.75, "Content: the Clarity download's Top pages is a compact table", tight.toFixed(2));
    await shot("content-clarity-download");
    await tab(page, "clarity:live");
    await tab(page, "content:pages");
  });

  // ---- looks: 1440 and 390, light and dark, English and French ------------------------------------------------------
  await step("looks", async () => {
    for (const [lang, theme] of [["en", "dark"], ["fr", "light"], ["fr", "dark"]]) {
      await page.evaluate(([l, th]) => { window.UI.state.lang = l; window.UI.state.theme = th; window.UI.render(); }, [lang, theme]);
      for (const r of ["channels", "conversions", "content"]) { await go(page, r); await shot(`${r}-1440-${theme}-${lang}`); }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [lang, theme] of [["en", "light"], ["en", "dark"], ["fr", "light"], ["fr", "dark"]]) {
      await page.evaluate(([l, th]) => { window.UI.state.lang = l; window.UI.state.theme = th; window.UI.render(); }, [lang, theme]);
      for (const r of ["channels", "conversions", "content"]) {
        await page.evaluate((x) => { location.hash = `#${x}`; }, r); await page.waitForTimeout(900);
        check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `phone ${r} ${lang} ${theme}: no sideways scroll`);
        await shot(`${r}-390-${theme}-${lang}`);
      }
    }
    await page.evaluate(() => { window.UI.state.lang = "en"; window.UI.state.theme = "light"; window.UI.render(); });
  });
  check(!problems.some((p) => p.startsWith("pageerror")), "switch on: no script error", problems.filter((p) => p.startsWith("pageerror")).join(" | "));
  check(!failed.length, "switch on: no failed request", failed.slice(0, 4).join(", "));
  await browser.close();

  // ---- the switch off: the old screens, with the Content fixes ---------------------------------------------------
  const off = await start(0);
  await step("switch off", async () => {
    const p = off.page;
    await go(p, "channels");
    check(!(await p.$("#topbar.head")) && (await count(p, "#page [data-lv-rule-form]")) === 1 && !(await p.$("#page [data-rp-open]")), "switch off: Channels as before (old head, rules on the page, rows open nothing)");
    await go(p, "content");
    check(!(await p.$("#page .page-tabs")), "switch off: Content has no page tabs");
    const head = await p.evaluate(() => [...document.querySelectorAll("#page .card")].find((c) => /All pages/.test(c.querySelector("h2")?.textContent || ""))?.querySelector(".card-head")?.innerText || "");
    check(/–/.test(head), "switch off: All pages says its source and days", head.replace(/\s+/g, " "));
    const last = await p.evaluate(() => { const card = [...document.querySelectorAll("#page .card")].find((c) => /All pages/.test(c.querySelector("h2")?.textContent || "")); const rows = card ? [...card.querySelectorAll("tbody tr")] : []; return rows[rows.length - 1]?.innerText || ""; });
    check(/Unknown page \(not set\)/.test(last), "switch off: (not set) is last, as \"Unknown page (not set)\"", last.slice(0, 40));
    const social = await p.$$eval("#page .lv-bar .lab", (l) => l.map((x) => x.textContent.trim()));
    check(social.filter((s) => s === "Facebook").length === 1 && social.includes("LinkedIn"), "switch off: social networks grouped by network", social.join(", "));
    await p.screenshot({ path: `${OUT}/off-content-1440-light-en.png`, fullPage: true });
  });
  check(!off.problems.some((x) => x.startsWith("pageerror")), "switch off: no script error");
  await off.browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error("FLOW FAILED:", e.message); process.exit(1); });
