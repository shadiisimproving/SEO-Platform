// Today, sample and real app, the way a person uses it, with screenshots to look at.
// Needs the real app on a port of your own; the sample is the screens opened as a plain file (served over http without
// the app, they show "The server didn't answer" on purpose, since 10 Nov 2026):
//   DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8230 --slow 0
// Run: node tests/ui/flow_today.cjs <screenshots folder> http://127.0.0.1:8230/ [sample address, default the file]
const { open, menu } = require("./pw.cjs");
const out = process.argv[2] || "reports/today-redesign-2026-11-05";
const SAMPLE = process.argv[4] || `file://${require("path").resolve(__dirname, "../../design/mockups/index.html")}`, REAL = process.argv[3] || "http://127.0.0.1:8230/";
require("fs").mkdirSync(out, { recursive: true });
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const settle = (page, ms = 700) => page.waitForTimeout(ms);
const shot = (page, name, full = true) => page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
const rowsText = (page) => page.$$eval("[data-row] .t", (els) => els.map((x) => x.textContent.trim()));
const facts = (page) => page.evaluate(() => ({
  lead: document.querySelector(".today-lead")?.textContent, second: document.querySelector(".today-second")?.textContent,
  badge: Number(document.querySelector('.nav-item[data-go="today"] .count')?.textContent || 0),
  nums: [...document.querySelectorAll(".today-num")].map((x) => x.innerText.replace(/\n+/g, " | ")),
}));
const count = (s) => { const m = /^(\d+)/.exec(s || ""); return m ? Number(m[1]) : 0; };

async function shared(page, label) {
  let f = await facts(page);
  check(!!f.lead, `${label}: the answer sentence is there: "${f.lead}"`);
  check(count(f.second) === f.badge, `${label}: headline count ${count(f.second)} matches the menu badge ${f.badge}`);
  check(f.nums.length === 3, `${label}: three numbers: ${f.nums.join(" // ")}`);
  check(!(await page.$(".hero, #hero-plot, [data-hero-metric]")), `${label}: the old chart is gone`);
  check((await page.$$(".today-num [data-lv-chart]")).length === 3, `${label}: each number has its own graph`);
  const chart = await page.$('[data-lv-chart="today-visits"]');
  const box = await chart.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 50); await settle(page, 150);
  const tip = await page.$eval('[data-lv-chart="today-visits"] .lv-tip', (x) => (x.hidden ? "" : x.innerText));
  check(/This period|Cette/.test(tip), `${label}: hovering a graph reads the day: ${tip.replace(/\n+/g, " | ")}`);
  await page.mouse.move(5, 5);
  check(!(await overflow(page)), `${label}: no sideways scroll at 1440`);
  const order = await page.evaluate(() => {
    const y = (s) => document.querySelector(s)?.getBoundingClientRect().top ?? -1;
    const head = (word) => [...document.querySelectorAll(".card-head h2")].find((h) => h.textContent === word)?.getBoundingClientRect().top ?? -1;
    return { nums: y(".today-nums"), todo: head("Do these first"), down: head("Going down"), rivals: head("Rival changes on competing pages") };
  });
  check(order.nums < order.todo && order.todo < order.down && order.down < order.rivals, `${label}: order is numbers, to-do, moves, rivals`);
}

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 1000 });
  // A server without login answers 404 to who's signed in. That one is expected; any other 404 from the app isn't.
  const missing = [];
  page.on("response", (r) => { if (r.status() === 404 && r.url().startsWith(REAL) && !r.url().includes("/api/auth/me")) missing.push(r.url()); });

  // ---- sample
  await page.goto(`${SAMPLE}#today`); await page.waitForSelector(".today-lead"); await settle(page);
  await shared(page, "sample");
  await shot(page, "after-sample-1440");
  let rows = await rowsText(page);
  check(rows[0].startsWith("/loyer-a-seville/"), `sample: the page losing traffic is first: ${rows[0]}`);
  const before = await facts(page);
  await page.click("[data-row] [data-ack]"); await settle(page, 400);
  const afterSeen = await facts(page);
  check(afterSeen.badge === before.badge - 1 && count(afterSeen.second) === afterSeen.badge, "sample: Mark as seen lowers the headline and the badge together");
  await page.click(".toast button"); await settle(page, 400);
  check((await facts(page)).badge === before.badge, "sample: Undo brings it back");
  await page.click("#show-all"); await settle(page, 300);
  rows = await rowsText(page);
  check(rows.some((x) => x.includes("blocks our crawler")), "sample: information rows only appear under Show all");
  await page.click("#show-all"); await settle(page, 200);
  await page.click('[data-today-pair="1"]'); await page.waitForSelector("#cp-back", { timeout: 8000 }); check(true, "sample: Compare opens that pair in Page vs page");
  await page.goto("about:blank"); await page.goto(`${SAMPLE}#today`); await page.waitForSelector(".today-lead");
  for (const [word, route] of [["Leads", "conversions"], ["Visits", "channels"], ["Google clicks", "overview"]]) {
    await page.click(`a.today-num-link[href="#${route}"]`); await settle(page, 300);
    check(page.url().includes(`#${route}`), `sample: ${word} opens ${route}`);
    await page.goBack(); await page.waitForSelector(".today-lead"); await settle(page, 200);
  }
  await page.click('[data-site="site-two"]'); await settle(page, 300);
  const one = await facts(page);
  check(!(await page.$("table.data")), "sample: one site hides the Sites table");
  check(!(await page.$$eval("[data-row] .t", (els) => els.some((x) => x.textContent.includes("site-one.example")))), `sample: one site shows only its rows (${one.second})`);
  await shot(page, "after-sample-one-site");
  await page.goto("about:blank"); await page.goto(`${SAMPLE}?data=first#today`); await page.waitForSelector(".today-lead"); await settle(page);
  check((await facts(page)).lead.startsWith("Connect Google to see leads, visits and clicks"), "sample: first run says so and shows no false zero");
  await shot(page, "after-sample-first-run");

  // ---- both looks, widths and French
  for (const [w, h] of [[1024, 800], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("about:blank"); await page.goto(`${SAMPLE}#today`); await page.waitForSelector(".today-lead"); await settle(page);
    check(!(await overflow(page)), `sample: no sideways scroll at ${w}`);
    await shot(page, `after-sample-${w}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  // ---- real app. As a plain file the screens ask for an API that isn't there, so only errors from here on count.
  problems.length = 0;
  await page.goto("about:blank"); await page.goto(`${REAL}#today`); await page.waitForSelector(".today-lead", { timeout: 20000 }); await settle(page, 1200);
  await shared(page, "real");
  await shot(page, "after-real-1440");
  rows = await rowsText(page);
  console.log("     real to-do:", rows);
  const drop = await page.$("[data-lv-drop]");
  check(!!drop, "real: a big page drop is in the to-do list with Mark as seen");
  if (drop) {
    const was = (await facts(page)).badge;
    const dropKey = await drop.getAttribute("data-lv-drop");
    await drop.click(); await settle(page, 900);
    check((await facts(page)).badge === was - 1, "real: Mark as seen removes the drop");
    await page.reload(); await page.waitForSelector(".today-lead"); await settle(page, 1200);
    check((await facts(page)).badge === was - 1, "real: it stays gone after a reload");
    const down = await page.$$eval(".today-moves .card:first-child .today-link", (els) => els.map((x) => x.textContent));
    console.log("     going down:", down);
    // Leave it as it was, so this script can run again on the same data.
    await page.evaluate((key) => window.COMP.api("POST", "today/seen", { key, seen: false }), dropKey);
  }
  const compare = await page.$("[data-today-pair]");
  if (compare) { await compare.click(); await page.waitForSelector("#cp-back", { timeout: 8000 }); check(true, "real: Compare opens the pair"); }
  else console.log("     no rival edit on a paired page in the demo data");
  await page.goto("about:blank"); await page.goto(`${REAL}#today`); await page.waitForSelector(".today-lead"); await settle(page, 800);
  for (const route of ["channels", "overview"]) {
    await page.click(`a.today-num-link[href="#${route}"]`); await settle(page, 1500);
    const opened = await page.evaluate(() => ({ graphs: document.querySelectorAll("[data-lv-chart]").length, text: document.querySelector("#page").innerText.replace(/\s+/g, " ").slice(0, 170) }));
    console.log(`     ${route}:`, opened.graphs, "graph(s) ·", opened.text);
    check(page.url().includes(`#${route}`), `real: the number opens ${route}`);
    await page.goBack(); await page.waitForSelector(".today-lead"); await settle(page, 400);
  }
  await page.click('button[data-lv-table="today-visits"]'); await settle(page, 400);
  check(!!(await page.$(".today-num table.data")), "real: a graph can be read as a table");
  await page.click('button[data-lv-table="today-visits"]'); await settle(page, 300);
  await menu(page, "lang"); await settle(page, 700);
  await shot(page, "after-real-french");
  const frLead = (await facts(page)).lead;
  check(/^Leads .*derniers jours/.test(frLead), `real: French sentence: ${frLead}`);  // the glossary's word since 10 Nov 2026
  const frRows = await rowsText(page);
  check(!frRows.some((x) => /expires on|health fell/.test(x)), `real: French to-do rows: ${frRows.join(" / ")}`);
  await menu(page, "lang"); await settle(page, 500);
  await menu(page, "theme"); await settle(page, 700);
  await shot(page, "after-real-dark");
  await menu(page, "theme"); await settle(page, 400);
  await page.setViewportSize({ width: 390, height: 844 }); await settle(page, 500);
  check(!(await overflow(page)), "real: no sideways scroll at 390");
  await shot(page, "after-real-390");
  await page.setViewportSize({ width: 1440, height: 1000 });

  // ---- keyboard, reduced motion
  await page.goto("about:blank"); await page.goto(`${REAL}#today`); await page.waitForSelector(".today-lead"); await settle(page, 900);
  await page.focus('[data-lv-chart="today-clicks"]'); await page.keyboard.press("End"); await settle(page, 150);
  const keyed = await page.evaluate(() => { const tip = document.querySelector('[data-lv-chart="today-clicks"] .lv-tip'); return tip.hidden ? "" : tip.innerText; });
  check(/This period/.test(keyed), `real: arrow keys read a graph: ${keyed.replace(/\n+/g, " | ")}`);
  const tabbed = [];
  await page.focus(".today-num-link");
  for (let i = 0; i < 12; i++) { tabbed.push(await page.evaluate(() => { const el = document.activeElement; return el.getAttribute("href") || el.dataset.lvChart || el.dataset.lvTable || el.textContent.trim().slice(0, 16); })); await page.keyboard.press("Tab"); }
  console.log("     tab order:", tabbed.join(" > "));
  const focused = await page.evaluate(() => document.activeElement !== document.body);
  check(focused, "real: Tab keeps moving through the page");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload(); await page.waitForSelector(".today-lead"); await settle(page, 600);
  check((await page.$$(".today-num [data-lv-chart]")).length === 3, "real: graphs still draw with reduced motion");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // ---- accessibility, once the page has settled. AXE_PATH points at axe.min.js when it's available.
  if (process.env.AXE_PATH) {
    const scan = async (label, url, dark) => {
      await page.goto("about:blank"); await page.goto(url); await page.waitForSelector(".today-lead"); await settle(page, 1500);
      if (dark) { await menu(page, "theme"); await settle(page, 800); }
      await page.addScriptTag({ path: process.env.AXE_PATH });
      const found = await page.evaluate(async () => (await window.axe.run("#page", { resultTypes: ["violations"] })).violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" ; ")}`));
      check(!found.length, `${label}: accessibility scan ${found.length ? found.join(" || ") : "clean"}`);
      if (dark) await menu(page, "theme");
    };
    await scan("sample light", `${SAMPLE}#today`, false);
    await scan("sample dark", `${SAMPLE}#today`, true);
    await scan("real light", `${REAL}#today`, false);
    await scan("real dark", `${REAL}#today`, true);
  }

  check(!missing.length, `no missing requests: ${missing.slice(0, 5).join(", ")}`);
  const seen = problems.filter((x) => !/favicon|status of 404/.test(String(x)));
  check(!seen.length, `no page errors: ${JSON.stringify(seen).slice(0, 500)}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join("\n- ")}` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
