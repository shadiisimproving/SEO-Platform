// Insights parts 2 and 3 (2026-11-17): a rival_passed finding's "Who passed you" cards (read by the crawl worker on the fake
// internet: rival-guide.test with its Wayback copy, other-rival.test with none, biz-portal.test not followed), "+N more",
// Explain with AI on a faked Claude answer, Make it a task, Follow, in English and French, desktop and phone width.
//   DB_NAME_TEST=test_x_test DB_POOL_SIZE=2 .venv/bin/python tests/ui/who_passed_server.py --port 8293
// Run: node tests/ui/flow_insights_who_passed.cjs reports/who-passed http://127.0.0.1:8293/
const fs = require("fs");
const { open } = require("./pw.cjs");
const out = process.argv[2] || "reports/who-passed";
const BASE = process.argv[3] || "http://127.0.0.1:8293/";
fs.mkdirSync(out, { recursive: true });
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(false, `${name}: ${e.message.split("\n")[0]}`); } };

async function run(width, height, tag, lang, { follow = false, first = false } = {}) {
  const { browser, page, problems } = await open({ width, height, url: `${BASE}?simple=1&flow=${Date.now()}#insights` });
  const text = (sel) => page.locator(sel).first().innerText({ timeout: 3000 }).then((x) => x.replace(/\s+/g, " ")).catch(() => "");
  const count = (sel) => page.locator(sel).count();
  const shot = (name, full = false) => page.screenshot({ path: `${out}/${tag}-${name}.png`, fullPage: full });
  const failed = [];
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/auth/me")) failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "/")}`); });
  const call = (method, path, body) => page.evaluate(async ([m, p, b]) => { const r = await fetch(`/api/${p}`, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [method, path, body]);
  await page.waitForTimeout(1500);
  if (first) { // Claude on, with a key: the answer comes from tests/ui/fake_claude.py
    await call("PUT", "app-keys/anthropic", { key: "sk-ant-test-0000-1234" });
    const sites = (await call("GET", "insights/ai")).body.sites;
    await call("PUT", "insights/ai", { sites: sites.map((s) => ({ id: s.id, provider: "claude" })), cap: 5 });
  }
  if (lang === "fr") {
    await page.evaluate(() => document.querySelector("#acct-btn")?.click()); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#popover [data-mock="lang"]')?.click()); await page.waitForTimeout(600);
  }
  await page.evaluate(() => { const s = window.SITES.find((x) => x.host === "shop-one.test"); if (s) { window.UI.state.site = s.id; window.UI.render(); } });
  await page.waitForTimeout(1200);
  const fid = await page.evaluate(async () => (await window.COMP.api("GET", `insights?group=mix&status=open&site_id=${window.UI.siteIdPicked()}`)).rows.find((r) => r.kind === "rival_passed")?.id);
  check(Boolean(fid), `${tag}: a rival_passed finding is there (${fid})`);
  const openIt = async () => {
    await page.evaluate((id) => { const b = document.createElement("button"); b.dataset.inOpen = id; document.querySelector("main, body").append(b); b.click(); b.remove(); }, fid);
    await page.waitForSelector("#panel [data-in-rivals]", { timeout: 6000 });
  };

  await step(`${tag}: who passed you`, async () => {
    await openIt();
    await page.waitForSelector("#panel .in-rv", { timeout: 60000 }); // the crawl worker may still be reading: the block polls
    await page.waitForFunction(() => !document.querySelector("#panel .in-rv-state"), null, { timeout: 60000 }).catch(() => {});
    await page.locator("#panel [data-in-rivals]").scrollIntoViewIfNeeded();
    await shot("01-who-passed");
    const cards = await page.locator("#panel .in-rv").allInnerTexts();
    const rival = cards.find((c) => c.includes("rival-guide.test")) || "";
    check(/Passed you|Vous a dépassé/.test(rival) && /5\s*→\s*2/.test(rival), "rival-guide.test: passed you, 5 → 2");
    check(/Wayback/.test(rival) && /(Changed since|Changée depuis)/.test(rival), "its earlier copy is the Wayback Machine's, and it changed");
    check(/(Title|Titre)/.test(rival) && /2025/.test(rival) && /2026/.test(rival), "the title row shows 2025 → 2026");
    const card = page.locator("#panel .in-rv", { hasText: "rival-guide.test" });
    const rows = await card.locator(":scope > .in-rv-rows > li:not(.in-rv-extra)").count();
    check(rows >= 1 && rows <= 6, `up to 6 change rows on the card (${rows})`);
    check((await card.locator(".in-rv-me").count()) >= 1 && /(You|Vous)/.test(rival), "each change has my value beside it");
    check((await card.locator("a.page-link").first().getAttribute("href")) === "https://rival-guide.test/guide/", "their page address is a link");
    const other = cards.find((c) => c.includes("other-rival.test")) || "";
    check(/No earlier copy|Pas de copie plus ancienne/.test(other), "other-rival.test: no earlier copy, what they have now");
    const nf = await text("#panel .in-rv-nf");
    check(nf.includes("biz-portal.test") && (await count("#panel [data-in-rv-follow]")) >= 1, "biz-portal.test is listed as not followed, with Follow");
    check((await count("#panel .in-rivals a.kw, #panel .in-rivals .kw-link, #panel .in-rivals [data-kw-open], #panel .in-rivals a")) >= 2, "keyword and pages are links");
  });

  await step(`${tag}: +more`, async () => {
    const more = page.locator("#panel .in-rv", { hasText: "rival-guide.test" }).locator("[data-in-rv-more]");
    check(/\+6/.test(await more.innerText()), "the card says +6 more");
    await more.click();
    await page.waitForTimeout(300);
    check((await page.locator("#panel .in-rv", { hasText: "rival-guide.test" }).locator("[data-in-rv-more]").getAttribute("aria-expanded")) === "true", "+more opens, and says so");
    check(await page.locator("#panel .in-rv-extra").first().isVisible(), "the rest of the changes show");
    await page.locator("#panel .in-rv-extra").first().scrollIntoViewIfNeeded();
    await shot("02-more");
  });

  await step(`${tag}: explain with AI`, async () => {
    check((await count('#panel [data-in-ai="explain"]')) === 0, "no second, shorter Explain beside it");
    if (await count("#panel .in-why")) check(true, "the answer asked before is kept, nothing sent again");
    else {
      const ask = page.locator('#panel [data-in-ai="why_dropped"]:not([data-in-ai-again])').first();
      check(/Explain with AI|Expliquer avec l'IA/.test(await ask.innerText()), "the panel has Explain with AI");
      await ask.click();
    }
    await page.waitForSelector("#panel .in-why", { timeout: 8000 });
    await page.locator("#panel .in-why").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot("03-explained");
    const box = await text("#panel .in-why");
    check(box.includes("Claude Sonnet 5.5"), "written by Claude Sonnet, and labelled AI");
    check(lang === "fr" ? box.includes("Un concurrent a réécrit") : box.includes("A rival rewrote its guide"), "the cause is the headline");
    check(/(Likely|Probable)/.test(await text("#panel .in-sure")), "How sure as a badge");
    check((await count("#panel .in-why-proof li")) >= 2 && (await count("#panel [data-in-why-task]")) === 3, "proof rows and three steps, each with Make it a task");
  });

  await step(`${tag}: make it a task`, async () => {
    const step1 = await text("#panel .in-why-do li .in-why-step");
    await page.locator("#panel [data-in-why-task]").first().click();
    await page.waitForSelector("#task-form", { timeout: 5000 });
    await page.waitForTimeout(400);
    check((await page.locator("#task-title").inputValue()) === step1, "the task's title is the step");
    check((await page.locator("#task-description").inputValue()).includes(step1), "its description says the step and the cause");
    await shot("04-task");
    await page.locator("#panel .panel-foot .btn-main, #task-save").first().click();
    await page.waitForTimeout(1200);
    const tasks = (await call("GET", "tasks")).body;
    const list = Array.isArray(tasks) ? tasks : tasks?.tasks || tasks?.rows || [];
    const made = list.find((x) => x.title === step1);
    const source = made && (typeof made.source === "string" ? JSON.parse(made.source) : made.source);
    check(Boolean(made) && source?.type === "search" && /#step1$/.test(source?.key || "") && source?.link === `#insights/${fid}`, `the task is saved, linked to the insight (${source ? source.key : "none"})`);
    if (made) await call("DELETE", `tasks/${made.id}`); // the next run makes it again
  });

  if (follow) {
    await step(`${tag}: follow a site above`, async () => {
      await page.keyboard.press("Escape"); await page.waitForTimeout(400);
      await openIt();
      await page.waitForSelector("#panel [data-in-rv-follow]", { timeout: 8000 });
      await page.locator('#panel [data-in-rv-follow="biz-portal.test"]').click();
      await page.waitForFunction(() => [...document.querySelectorAll("#panel .in-rv-host")].some((x) => x.textContent.includes("biz-portal.test")), null, { timeout: 60000 });
      await page.waitForTimeout(500);
      await page.locator("#panel [data-in-rivals]").scrollIntoViewIfNeeded();
      await shot("05-followed");
      check((await count('#panel [data-in-rv-follow="biz-portal.test"]')) === 0, "followed: it has its own card now, not a Follow button");
    });
  }

  if (follow) {
    await step(`${tag}: no AI chosen`, async () => {
      const sites = (await call("GET", "insights/ai")).body.sites;
      await call("PUT", "insights/ai", { sites: sites.map((x) => ({ id: x.id, provider: "none" })) });
      await page.keyboard.press("Escape"); await page.waitForTimeout(400);
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("seocc:ai-settings", { detail: null })));
      await openIt();
      await page.waitForTimeout(800);
      check((await count('#panel [data-in-ai="why_dropped"]')) === 0, "No AI: no Explain with AI button");
      check(/No AI chosen yet|Aucune IA choisie/.test(await text("#panel [data-in-ai-wrap]")), "No AI: the panel says how to pick one");
      await page.locator("#panel [data-in-ai-wrap]").scrollIntoViewIfNeeded();
      await shot("06-no-ai");
      await call("PUT", "insights/ai", { sites: sites.map((x) => ({ id: x.id, provider: "claude" })) });
    });
  }

  await step(`${tag}: page fits`, async () => {
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(wide <= 1, `nothing sticks out sideways (${wide}px)`);
    const panelWide = await page.evaluate(() => { const p = document.querySelector("#panel"); return p ? p.scrollWidth - p.clientWidth : 0; });
    check(panelWide <= 1, `nothing sticks out of the panel (${panelWide}px)`);
  });
  check(!failed.filter((f) => !f.includes("/ai")).length, `${tag}: no failed requests ${failed.join(", ")}`);
  // The sign-in check answers 404 when the app runs without logins, before this script listens: a console line, not an error.
  const real = problems.filter((p) => !/status of 404/.test(p));
  check(!real.length, `${tag}: no page errors ${real.join(" | ")}`);
  await browser.close();
}

(async () => {
  await run(1440, 900, "en-desktop", "en", { first: true });
  await run(390, 844, "en-phone", "en");
  await run(1440, 900, "fr-desktop", "fr");
  await run(390, 844, "fr-phone", "fr", { follow: true });
  console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})();
