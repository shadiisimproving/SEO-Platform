// The side panel behind a table row (UI.rowPanel, row-panel.js) the way a person uses it, with screenshots to look at
// (simpler screens, track D, 2026-11-11). Made-up sites only.
// Needs the real app on the fake internet, with Google connected for site-one.example:
//   DB_NAME_TEST=test_simplify_d2_test .venv/bin/python tests/ui/app_server.py --port 8283 --slow 0
//   then connect Google once (Settings → Google: a robot key, Search Console and Analytics for site-one.example) and press Refresh data.
// Run: node tests/ui/flow_row_panels.cjs reports/simplify-2026-11-11/track-d http://127.0.0.1:8283/
// The screens mark their rows themselves in phase 2 (data-rp-open, data-rp-key); until then this marks them the same way.
const fs = require("fs");
const { open } = require("./pw.cjs");
const out = process.argv[2] || "reports/row-panels";
const BASE = process.argv[3] || "http://127.0.0.1:8283/";
fs.mkdirSync(out, { recursive: true });
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(false, `${name}: ${e.message.split("\n")[0]}`); } };

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900, url: `${BASE}?simple=1&flow=${Date.now()}#channels` });
  const failed = [];
  // The harness runs without sign-in, so /api/auth/me answers 404 on every screen: not this flow's doing.
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/auth/me")) failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "/")}`); });
  const text = (sel) => page.locator(sel).first().innerText({ timeout: 2000 }).then((s) => s.trim()).catch(() => "");
  const count = (sel) => page.locator(sel).count();
  const all = (sel, fn) => page.locator(sel).evaluateAll(fn);
  const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
  const loaded = () => page.waitForSelector("#panel.rp .rp-nums", { timeout: 10000 });
  const closed = async () => { if (await count("#panel")) { await page.keyboard.press("Escape"); await page.waitForTimeout(350); } };
  const go = async (route) => { await closed(); await page.click(`button[data-go="${route}"]`); await page.waitForTimeout(2200); };
  // What phase 2 draws on each row: which panel it opens and its key, read from the row's own cell.
  const markRows = (kind, label, host = null) => page.evaluate(({ kind, label, host }) => {
    const rows = [...document.querySelectorAll("#page table.data tbody tr")].filter((tr) => tr.querySelector(`td[data-label="${label}"]`));
    rows.forEach((tr) => {
      const cell = tr.querySelector(`td[data-label="${label}"]`);
      const key = (cell.querySelector("a.page-link, .logo-text, .mono")?.textContent || cell.textContent).trim();
      Object.assign(tr.dataset, { rpOpen: kind, rpKey: key, ...(host ? { rpHost: host } : {}) });
      tr.tabIndex = 0;
    });
    return rows.length;
  }, { kind, label, host });
  const openRow = async (kind, nth = 0, key = null) => {
    const row = key ? page.locator(`#page tr[data-rp-open="${kind}"][data-rp-key="${key}"]`).first() : page.locator(`#page tr[data-rp-open="${kind}"]`).nth(nth);
    const name = await row.getAttribute("data-rp-key");
    const cell = row.locator('td[data-label="Visits"], td[data-label="AI visits"]').first();
    const visits = (await cell.innerText().catch(() => "")).trim();
    await cell.click();
    await loaded();
    await page.waitForTimeout(450);
    return { name, visits };
  };

  await page.waitForSelector(".nav-item", { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const s = window.SITES.find((x) => x.host === "site-one.example"); window.UI.state.site = s.id; window.UI.render(); });
  await page.waitForTimeout(2500);
  check(await page.evaluate(() => document.documentElement.dataset.simple === "1" && window.UI.simple() === true), "the simpler screens switch is on");
  check(await page.evaluate(() => typeof window.UI.rowPanel === "function" && window.UI.rowPanel.kinds.join() === "channel,referrer,page,assistant"), "UI.rowPanel and its four ready-made panels are there");

  let channels = [];
  await step("a channel opens its panel", async () => {
    check((await markRows("channel", "Channel")) >= 3, "the channel rows are marked");
    channels = await all('#page tr[data-rp-open="channel"]', (rows) => rows.map((r) => r.dataset.rpKey));
    const { name, visits } = await openRow("channel");
    const box = await page.locator("#panel").boundingBox();
    check(Math.abs(box.width - 760) <= 2, `the panel is 760 px wide (${Math.round(box.width)})`);
    const line = await text("#panel .rp-kind");
    check(line.startsWith("Channel") && /\d/.test(line) && line.includes(" vs "), `the small line says what it is, its days and the days before ("${line}")`);
    check((await text("#panel-title")) === name, `the name is the row's (${name})`);
    const nums = await count("#panel .rp-num");
    check(nums >= 3 && nums <= 6, `three to six numbers (${nums})`);
    check((await text('#panel [data-rp-num="visits"] .rp-num-val')) === visits, `Visits is the row's own number (${visits})`);
    check((await count("#panel .rp-num .d-pill")) >= 1 && /better|worse|No change/.test(await text("#panel .rp-num .d-pill")), "a change says better or worse in words");
    check((await count("#panel .rp-chart .lv-chart path.lv-line")) >= 2, "one chart over time, this period and the one before");
    check((await count("#panel .rp-chart path.lv-line[stroke-dasharray]")) === 1, "the period before is dashed");
    check((await page.evaluate(() => document.querySelector("#panel .rp-chart svg").clientHeight)) === 160, "the chart is 160 px high");
    check((await count("#panel .rp-sec")) === 2 && (await text("#panel .rp-sec h3")) === "Sources", "two lists: sources and mediums");
    check((await count("#panel .rp-sec table.data tbody tr")) >= 2, "the lists have rows");
    check((await count("#panel .panel-foot [data-task-find]")) === 1 && (await count("#panel .panel-foot [data-notes-open]")) === 1, "Task and Add a note in the foot");
    check((await count("#page tr.open")) === 1 && (await page.evaluate((n) => document.querySelector("#page tr.open")?.dataset.rpKey === n, name)), "the row stays highlighted");
    await shot("01-channel-1440-light-en");
  });

  await step("the chart's switch and its table stay inside the panel", async () => {
    await page.click('#panel [data-rp-chart="1"]'); await page.waitForTimeout(300);
    check((await page.getAttribute('#panel [data-rp-chart="1"]', "aria-pressed")) === "true", "the switch shows Leads");
    check(await page.evaluate(() => document.activeElement?.dataset?.rpChart === "1"), "focus stays on the switch");
    await page.click("#panel [data-lv-table]"); await page.waitForTimeout(300);
    check((await count("#panel .lv-chart-table table tbody tr")) >= 25, "Show table lists the days inside the panel");
    check((await count("#page tr.open")) === 1, "the screen behind wasn't drawn again");
    if (await count('#panel [data-tp-step="next"]:not([disabled])')) {
      await page.click('#panel [data-tp-step="next"]'); await page.waitForTimeout(300);
      check((await text("#panel .tp-range")).startsWith("26"), "the days' next page opens in the panel");
    }
    await page.click("#panel [data-lv-table]"); await page.waitForTimeout(200);
    await page.click('#panel [data-rp-chart="0"]'); await page.waitForTimeout(200);
  });

  await step("↓ and ↑ move to the next and the previous row", async () => {
    await page.focus("#panel");
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction((k) => document.querySelector("#panel-title")?.textContent.trim() === k && document.querySelector("#panel .rp-nums"), channels[1], { timeout: 8000 });
    check(true, `↓ opens the next row (${channels[1]})`);
    check(await page.evaluate(() => document.querySelector("#panel").classList.contains("rp-swap")), "the panel stays put instead of sliding in again");
    check(await page.evaluate((k) => document.querySelector("#page tr.open")?.dataset.rpKey === k, channels[1]), "the highlight moves with it");
    await page.keyboard.press("ArrowUp");
    await page.waitForFunction((k) => document.querySelector("#panel-title")?.textContent.trim() === k && document.querySelector("#panel .rp-nums"), channels[0], { timeout: 8000 });
    check(true, "↑ goes back");
  });

  await step("Escape closes it and focus goes back to the row", async () => {
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    check((await count("#panel")) === 0, "Escape closes the panel");
    check(await page.evaluate((k) => document.activeElement?.matches?.("tr[data-rp-open]") && document.activeElement.dataset.rpKey === k, channels[0]), "focus is back on the row");
    check((await count("#page tr.open")) === 0, "no row stays highlighted");
    await page.locator('#page tr[data-rp-open="channel"]').nth(1).focus();
    await page.keyboard.press("Enter");
    await loaded();
    check((await text("#panel-title")) === channels[1], "Enter on a row opens it too");
    await closed();
  });

  await step("a referring site", async () => {
    check((await markRows("referrer", "Site")) >= 1, "the referring sites are marked");
    const { name, visits } = await openRow("referrer");
    check((await text("#panel .rp-kind")).startsWith("Referring site"), "it says it's a referring site");
    check((await text("#panel-title")) === name && (await count("#panel-title .site-logo")) === 1, `its logo beside its name (${name})`);
    check((await text('#panel [data-rp-num="visits"] .rp-num-val')) === visits, "Visits is the row's");
    check((await text("#panel .rp-sec h3")) === "Landing pages" && (await count("#panel .rp-sec a.page-link")) >= 1, "the pages it sent visits to, each a link");
    check((await count(`#panel .panel-foot a[href="https://${name}"][target="_blank"]`)) === 1, "Open site ↗ in the foot");
    await shot("02-referrer-1440-light-en");
    await closed();
  });

  await step("a page, from Conversions", async () => {
    await go("conversions");
    check((await markRows("page", "Page", "site-one.example")) >= 1, "the pages that bring leads are marked");
    const { name, visits } = await openRow("page");
    check((await text("#panel .rp-kind")).startsWith("Page"), "it says it's a page");
    check((await page.getAttribute("#panel-title a.rp-title-link", "href")) === `https://site-one.example${name}`, "its address is a link to the page");
    check((await count("#panel .rp-num")) === 6, "six numbers: visits, leads, lead rate, Google clicks, position, AI visits");
    check((await text('#panel [data-rp-num="visits"] .rp-num-val')) === visits, `Visits is the row's own number (${visits})`);
    check((await count("#panel [data-rp-chart]")) === 2, "a switch between visits and Google clicks");
    check((await text('#panel [data-rp-sec="0"] h3')) === "Searches that bring it" && (await text('#panel [data-rp-sec="1"] h3')) === "Where AI visits come from", "the searches that bring it, and where AI visits come from");
    check((await count('#panel .panel-foot a.rp-open-page[target="_blank"]')) === 1, "Open page ↗ in the foot");
    const order = await all("#panel .panel-foot > *", (els) => els.map((e) => (e.matches("[data-task-find]") ? "task" : e.matches("[data-notes-open]") ? "note" : e.matches(".rp-open-page") ? "open" : "other")));
    check(order.join() === "task,note,open", `the foot reads Task, Add a note, Open page (${order.join()})`);
    await shot("03-page-1440-light-en");
    await closed();
  });

  await step("a page with AI visits, from Content", async () => {
    await go("content");
    check((await markRows("page", "Page", "site-one.example")) >= 3, "every page is marked");
    const target = await page.evaluate(() => [...document.querySelectorAll('#page tr[data-rp-open="page"]')].find((tr) => /\d/.test(tr.querySelector('td[data-label="AI visits"]')?.textContent || ""))?.dataset.rpKey || null);
    check(Boolean(target), `a page with AI visits (${target})`);
    if (!target) return;
    const ai = (await page.locator(`#page tr[data-rp-key="${target}"] td[data-label="AI visits"]`).first().innerText()).trim();
    await openRow("page", 0, target);
    check((await text('#panel [data-rp-num="ai"] .rp-num-val')) === ai, `AI visits is the row's (${ai})`);
    check((await count('#panel [data-rp-sec="1"] tbody tr')) >= 1 && (await count('#panel [data-rp-sec="1"] .site-logo')) >= 1, "the assistants it came from, with their logos");
    await page.click('#panel [data-rp-chart="1"]'); await page.waitForTimeout(300);
    check((await count("#panel .rp-chart path.lv-line")) >= 1, "the Google clicks chart draws");
    await closed();
  });

  await step("an assistant, from AI search", async () => {
    await go("ai");
    check((await markRows("assistant", "Assistant")) >= 1, "the assistants are marked");
    const { name, visits } = await openRow("assistant");
    check((await text("#panel .rp-kind")).startsWith("Assistant") && (await text("#panel-title")) === name, `it says which assistant (${name})`);
    check((await text('#panel [data-rp-num="visits"] .rp-num-val')) === visits, `AI visits is the row's (${visits})`);
    check((await count("#panel .rp-chart path.lv-line")) >= 1 && (await text("#panel .rp-chart-head h3")) === "AI visits per week", "its weeks");
    check((await text("#panel .rp-sec h3")) === "Landing pages" && (await count("#panel .rp-sec a.page-link")) >= 1, "the pages it lands on");
    await shot("04-assistant-1440-light-en");
    await closed();
  });

  await step("the frame on its own: unknown numbers, pills, a long list, the main action first", async () => {
    await page.evaluate(() => {
      window.__rp = { acted: 0, more: 0 };
      const rows = Array.from({ length: 20 }, (_, i) => ({ name: `made-up row ${i + 1}`, n: 100 - i }));
      window.UI.rowPanel({
        id: "demo", kind: "Keyword", period: false, title: "made-up keyword",
        numbers: [
          { id: "a", label: "Clicks", value: 120, before: 100 },
          { id: "b", label: "Position", fmt: "pos", value: 3.2, before: 5 },
          { id: "c", label: "Click rate", fmt: "pct", value: 0.031, before: 0.04 },
          { id: "d", label: "Impressions", value: null, sub: "Search Console not connected" },
        ],
        sections: [{ title: "Pages", rows, columns: [{ label: "Page", key: "name" }, { label: "Clicks", key: "n", num: true }], more: { label: "See all", onClick: () => { window.__rp.more += 1; } } }],
        actions: [{ label: "Track" }, { label: "Check deeper", main: true, onClick: () => { window.__rp.acted += 1; } }],
      });
    });
    await page.waitForSelector('#panel[data-rp="demo"]');
    check((await text("#panel .rp-kind")) === "Keyword", "no period when there is none");
    check(/\+20%.*better/.test(await text('#panel [data-rp-num="a"] .d-pill.good')), "a count moves in %, with better");
    check(/1\.8 places.*better/.test(await text('#panel [data-rp-num="b"] .d-pill.good')), "a position moves in places, up is better");
    check(/0\.9 pts.*worse/.test(await text('#panel [data-rp-num="c"] .d-pill.crit')), "a rate moves in points, with worse");
    check((await text('#panel [data-rp-num="d"] .rp-num-val.unknown')) === "—" && (await text('#panel [data-rp-num="d"] .rp-num-sub')) === "Search Console not connected", "unknown is —, never 0, and says why");
    check((await count("#panel .rp-sec tbody tr")) === 15 && (await text("#panel .rp-more")).startsWith("15 of 20"), "a long list shows 15 and says how many");
    await page.click("#panel [data-rp-more]");
    check(await page.evaluate(() => window.__rp.more === 1), "See all does what the screen asked");
    const foot = await all("#panel .panel-foot .btn", (els) => els.map((e) => `${e.classList.contains("btn-main") ? "main:" : ""}${e.textContent.trim()}`));
    check(foot[0] === "main:Check deeper" && foot[1] === "Track", `the main action comes first (${foot.join(" | ")})`);
    await page.click("#panel .panel-foot .btn-main");
    check(await page.evaluate(() => window.__rp.acted === 1), "an action runs its own code");
    check((await count("#panel .rp-chart")) === 0, "no chart when there is none to draw");
    await shot("05-frame-1440-light-en");
    await closed();
  });

  await step("grey shapes while it loads, a failure in words, and Try again", async () => {
    await page.evaluate(() => {
      let tries = 0;
      window.UI.rowPanel({ id: "retry", kind: "Page", title: "/made-up/", period: false, load: () => new Promise((ok, no) => setTimeout(() => (++tries === 1 ? no(new Error("Too many requests. Try again in a minute.")) : ok({ numbers: [{ id: "v", label: "Visits", value: 5 }] })), 400)) });
    });
    check((await count('#panel .panel-body[aria-busy="true"] .sk')) === 1, "grey shapes while it loads");
    await page.waitForSelector("#panel .fail-card [data-rp-retry]", { timeout: 5000 });
    check((await text("#panel .fail-card p")).length > 5, "the failure is said in words, with Try again");
    await page.click("#panel [data-rp-retry]");
    await page.waitForSelector('#panel [data-rp-num="v"]', { timeout: 5000 });
    check((await text('#panel [data-rp-num="v"] .rp-num-val')) === "5", "Try again loads it");
    await closed();
  });

  // One panel at every width, theme and language the owner uses, to look at by eye.
  await step("the page panel at 1440 and 390, light and dark, English and French", async () => {
    await go("content");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      for (const theme of ["light", "dark"]) {
        for (const lang of ["en", "fr"]) {
          await closed();
          await page.evaluate(({ theme, lang }) => { Object.assign(window.UI.state, { theme, lang }); window.UI.render(); }, { theme, lang });
          await page.waitForTimeout(500);
          await markRows("page", "Page", "site-one.example");
          const target = await page.evaluate(() => [...document.querySelectorAll('#page tr[data-rp-open="page"]')].find((tr) => /\d/.test(tr.querySelector('td[data-label="AI visits"], td[data-label="Visites IA"]')?.textContent || ""))?.dataset.rpKey || document.querySelector('#page tr[data-rp-open="page"]')?.dataset.rpKey);
          await page.locator(`#page tr[data-rp-key="${target}"]`).first().evaluate((tr) => tr.click());
          await loaded();
          await page.waitForTimeout(600);
          const box = await page.locator("#panel").boundingBox();
          if (width === 390) check(box.width >= 388, `${theme} ${lang}: full width on a phone (${Math.round(box.width)})`);
          if (lang === "fr") check((await text('#panel [data-rp-sec="0"] h3')) === "Les recherches qui y mènent" && (await text('#panel [data-rp-num="visits"] .rp-num-name')) === "Visites", `${width} ${theme}: in French`);
          const sideways = await page.evaluate(() => document.querySelector("#panel .panel-body").scrollWidth - document.querySelector("#panel .panel-body").clientWidth);
          check(sideways <= 1, `${width} ${theme} ${lang}: nothing scrolls sideways`);
          await shot(`06-page-${width}-${theme}-${lang}`);
        }
      }
    }
    await closed();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { Object.assign(window.UI.state, { theme: "light", lang: "en" }); window.UI.render(); });
  });

  await step("with the switch off, a marked row opens nothing", async () => {
    await page.goto(`${BASE}?simple=0&flow=${Date.now()}#channels`);
    await page.waitForSelector(".nav-item"); await page.waitForTimeout(1500);
    await page.evaluate(() => { const s = window.SITES.find((x) => x.host === "site-one.example"); window.UI.state.site = s.id; window.UI.render(); });
    await page.waitForTimeout(2500);
    check(await page.evaluate(() => document.documentElement.dataset.simple === "0"), "the switch is off");
    await markRows("channel", "Channel");
    await page.locator('#page tr[data-rp-open="channel"] td[data-label="Visits"]').first().click();
    await page.waitForTimeout(800);
    check((await count("#panel")) === 0, "no panel opens");
  });

  // A 404 is /api/auth/me (no sign-in here): every other failed request is in `failed`, by address.
  const real = problems.filter((p) => !p.includes("404 (NOT FOUND)"));
  check(!real.length, `no page errors${real.length ? `: ${real.slice(0, 3).join(" | ")}` : ""}`);
  check(!failed.length, `no failed requests${failed.length ? `: ${failed.slice(0, 5).join(" | ")}` : ""}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : "\nall ok");
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
