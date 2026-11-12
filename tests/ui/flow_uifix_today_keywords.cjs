// Today and Keywords after the UI critique of 2026-11-12 (track 1), used the way a person uses them:
//   Today: a domain or certificate ending soon is first and above the cut, each row says why (icon + word), Mark seen says
//   what it does, a verdict badge instead of a sentence repeating the cards, Connect Google names the site, Leads says what
//   the dashed line is.
//   Keywords: the cost of a check said once and on the button, new keywords say which tool is checking them, a Refresh ends
//   with what moved and a button that shows those keywords, Add keywords has one country and one language picker and its
//   error under the keyword box, no Tab stops on plain marks, even ticks on the position history, the page address keeps its
//   host whole, labelled main buttons on a phone, and with ?simple=1 one search and one Filter before the first row.
// Needs the real app on a port of your own (a fresh demo world):
//   DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8250 --slow 0
//   node tests/ui/flow_uifix_today_keywords.cjs http://127.0.0.1:8250/ [screenshots folder]
const { open } = require("./pw.cjs");
const fs = require("fs");
const BASE = process.argv[2] || "http://127.0.0.1:8250/";
const OUT = (process.argv[3] || "var/ui-uifix-t1").replace(/\/$/, "");
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const settle = (page, ms = 600) => page.waitForTimeout(ms);
const ready = (page) => page.waitForFunction(() => { const b = document.querySelector("#kwr-confirm"); return b && !b.disabled; }, null, { timeout: 10000 });
const one = (page, sel, fn) => page.locator(sel).first().evaluate(fn);
const many = (page, sel, fn) => page.locator(sel).evaluateAll(fn);

(async () => {
  // ---- Today ------------------------------------------------------------------------------------------
  {
    const { browser, page, problems } = await open({ width: 1440, height: 900 });
    await page.goto(`${BASE}#today`); await page.waitForSelector(".today-verdict", { timeout: 20000 }); await settle(page, 1500);
    const rows = await many(page, "[data-row]", (els) => els.map((li) => ({ t: li.querySelector(".t")?.textContent || "", why: li.querySelector(".today-why")?.textContent.trim() || "", crit: !!li.querySelector(":scope > span .crit, :scope > span.crit, :scope > span > svg.crit") })));
    check(/domain name expires|certificate expires/.test(rows[0]?.t || ""), `Today: a domain or certificate ending soon is first: ${rows[0]?.t}`);
    check(rows[0]?.why === "Site could go offline", `Today: its reason says so with a word: ${rows[0]?.why}`);
    check(rows.every((r) => r.why), "Today: every row says why it is there");
    const all = await page.evaluate(async () => (await window.COMP.api("GET", "today")).todo);
    const crit = all.filter((x) => x.severity === "crit").map((x) => x.title);
    const shownTitles = rows.map((r) => r.t);
    check(crit.every((title) => shownTitles.some((t) => t.startsWith(title.split(":")[0]) || t.includes(title))), `Today: every serious row is above Show all (${crit.length})`);
    const seen = await one(page, "[data-row] .ack", (b) => ({ text: b.textContent.trim(), label: b.getAttribute("aria-label") }));
    check(seen.text === "Mark seen" && seen.label.startsWith("Mark seen:"), `Today: the seen button says what it does: ${JSON.stringify(seen)}`);
    const head = await one(page, ".today-answer", (x) => x.textContent.replace(/\s+/g, " ").trim());
    check(/Urgent: \d|To do|All clear/.test(head) && !/ are (up|down) /.test(head), `Today: a verdict badge, not a sentence repeating the cards: ${head}`);
    const leads = await one(page, ".today-num", (x) => x.innerText.replace(/\n+/g, " | "));
    check(/in the period before/.test(leads) && /Dashed: the period before/.test(leads), `Today: Leads says what it is compared with: ${leads.slice(0, 140)}`);
    const connect = await page.$("[data-today-connect]");
    if (connect) {
      const name = await connect.getAttribute("aria-label");
      check(/\.example: connect Google|\d+ sites: connect Google/.test(name), `Today: Connect Google names the site: ${name}`);
    }
    await page.screenshot({ path: `${OUT}/today-1440.png`, fullPage: true });
    check(!problems.filter((p) => !/404/.test(p)).length, `Today: no page errors ${problems.join(" ")}`);
    await browser.close();
  }
  {
    const { browser, page } = await open({ width: 1440, height: 900 });
    await page.goto(`${BASE}?simple=1#today`); await page.waitForSelector(".today-verdict", { timeout: 20000 }); await settle(page, 1500);
    const chip = await one(page, "#topbar", (x) => x.textContent);
    check(/sources OK|connect Google/.test(chip), "Today (simple): the sources chip is there");
    await page.screenshot({ path: `${OUT}/today-1440-simple.png`, fullPage: true });
    await browser.close();
  }

  // ---- Keywords ---------------------------------------------------------------------------------------
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  await page.goto(`${BASE}#keywords`); await page.waitForSelector("#kw-table", { timeout: 20000 }); await settle(page, 1200);
  const tabbable = await page.locator("#kw-table tbody span[tabindex]").count();
  check(tabbable === 0, `Keywords: no plain mark takes a Tab stop (${tabbable})`);
  const heads = await many(page, "#kw-table thead th", (els) => els.map((x) => x.innerText.replace(/\s+/g, " ").trim()));
  check(heads.some((h) => /Change vs last check/.test(h)) && heads.some((h) => /^Our check/.test(h)) && heads.some((h) => /Search Console avg position/.test(h)), `Keywords: plain headers with their period and brand name: ${heads.join(" / ")}`);
  const ai = await many(page, ".kw-ai-miss", (els) => els.map((x) => x.textContent));
  check(ai.length > 0 && ai.every((x) => /Not cited/.test(x)), "Keywords: Not cited stands out with an icon and a word");

  // Check deeper: one cost line, the cost on the button
  const deeper = await page.$("[data-kwr-deeper]");
  if (deeper) {
    await deeper.click(); await ready(page); await settle(page, 300);
    const d = await page.evaluate(() => ({ button: document.querySelector("#kwr-confirm").innerText.replace(/\s+/g, " ").trim(), cost: document.querySelector("#kwr-cost")?.innerText.replace(/\s+/g, " ").trim(), foot: document.querySelector("#kwr-foot").textContent }));
    check(/^Check with SerpApi · \d+ search(es)?$/.test(d.button), `Check deeper: the button names the tool and the searches: ${d.button}`);
    check(/^Uses \d+ of your \d+ free SerpApi searches?\. No charge\.$/.test(d.cost || ""), `Check deeper: one plain cost line: ${d.cost}`);
    check(d.foot === "", `Check deeper: no "Free tools only" when a credit tool is used: "${d.foot}"`);
    await page.screenshot({ path: `${OUT}/check-deeper.png` });
    await page.keyboard.press("Escape"); await settle(page, 300);
  }
  // French says the same
  {
    const fr = await open({ width: 1440, height: 900 });
    await fr.page.goto(`${BASE}?lang=fr#keywords`); await fr.page.waitForSelector("#kw-table", { timeout: 20000 }); await settle(fr.page, 1000);
    const d2 = await fr.page.$("[data-kwr-deeper]");
    if (d2) {
      await d2.click(); await ready(fr.page); await settle(fr.page, 300);
      const t = await fr.page.evaluate(() => [document.querySelector("#kwr-confirm").innerText, document.querySelector("#kwr-cost")?.innerText].join(" | ").replace(/\s+/g, " "));
      check(/Contrôler avec SerpApi · \d+ recherches?/.test(t) && /Utilise \d+ de vos \d+ recherches SerpApi gratuites\. Aucun frais\./.test(t), `French says the same: ${t}`);
    }
    await fr.browser.close();
  }

  // A Refresh ends with what moved, and a button that shows only those keywords
  let armed = false;
  await page.route(/\/api\/rankings(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    if (armed) {
      const ok = json.rows.filter((r) => r.engines.google?.main?.status === "ok");
      const up = ok.find((r) => r.engines.google.main.p > 1), down = ok.find((r) => r !== up && r.engines.google.main.p);
      const out = ok.find((r) => r !== up && r !== down && !r.engines.google.main.p);
      if (up) up.engines.google.change = 2;
      if (down) down.engines.google.change = -1;
      if (out) out.engines.google.main.p = 4; // it was past the top 10 before this Refresh
    }
    await route.fulfill({ response, json });
  });
  await page.click("#kwr-refresh"); await page.waitForSelector("#kwr-recent", { timeout: 8000 }); await page.check("#kwr-recent"); await ready(page);
  const button = await one(page, "#kwr-confirm", (b) => b.innerText.replace(/\s+/g, " ").trim());
  check(/^Refresh · \d+ search(es)?$/.test(button), `Refresh: the button names the searches: ${button}`);
  armed = true;
  await page.click("#kwr-confirm"); await page.waitForSelector("#tray");
  await page.waitForFunction(() => /^Finished · \d+ up/.test(document.querySelector("#tray .tray-title")?.textContent || ""), null, { timeout: 90000 }).catch(() => {});
  const tray = await one(page, "#tray", (x) => x.innerText.replace(/\s+/g, " "));
  check(/Finished · 1 up · 1 down · 1 new in top 10/.test(tray), `Refresh: the tray says what moved: ${tray}`);
  await page.screenshot({ path: `${OUT}/refresh-moved.png` });
  await settle(page, 10000);
  check(Boolean(await page.$("#tray .kwr-tray-moved")), "Refresh: a result with something in it doesn't vanish after 9 s");
  await page.click("#tray .kwr-tray-moved"); await settle(page, 800);
  const shown = await page.locator("#kw-table tbody tr").count();
  check(shown === 3 && (await page.getAttribute('[data-filter="run"]', "aria-pressed")) === "true", `Refresh: Show them filters the table to those keywords (${shown})`);
  armed = false;
  await page.click('[data-filter="all"]'); await settle(page, 400);

  // New keywords say which tool is checking them
  await page.click("#kwr-add"); await page.waitForSelector("#kwr-add-text");
  check((await one(page, "#kwr-add-language", (x) => x.tagName)) === "SELECT", "Add keywords: Language is a list like Keyword ideas'");
  await page.click("#kwr-add-save"); await settle(page, 300);
  const err = await page.evaluate(() => ({ text: document.querySelector("#kwr-add-error").textContent, by: document.querySelector("#kwr-add-text").getAttribute("aria-describedby"), under: Boolean(document.querySelector("#kwr-add-text").compareDocumentPosition(document.querySelector("#kwr-add-error")) & Node.DOCUMENT_POSITION_FOLLOWING) }));
  check(/Add a keyword/.test(err.text) && err.by === "kwr-add-error" && err.under, `Add keywords: the error is under the keyword box and names it: ${JSON.stringify(err)}`);
  check(!(await one(page, "#kwr-add-file", (x) => x.offsetWidth > 2)) && Boolean(await page.$('label.btn[for="kwr-add-file"]')), "Add keywords: the file picker looks like the app's buttons");
  const stamp = Date.now() % 100000;
  await page.fill("#kwr-add-text", `moka pot ${stamp}\nfrench press ${stamp}`);
  await page.click("#kwr-add-save"); await page.waitForSelector(".kw-checking", { timeout: 8000 }).catch(() => {});
  const checking = await many(page, ".kw-checking", (els) => els.map((x) => x.textContent.trim()));
  check(checking.length >= 2 && checking.every((x) => /^Checking with .+…$|^Checking…$/.test(x)), `New keywords say who is checking them: ${checking.join(" / ")}`);
  await page.screenshot({ path: `${OUT}/checking.png` });

  // The side panel: even ticks, the host kept whole
  await page.click("#kw-table tbody [data-kwr-open]"); await page.waitForSelector("#tool-table", { timeout: 8000 }); await settle(page, 600);
  const ticks = await many(page, "#panel svg.chart text", (els) => els.map((x) => x.textContent).filter((x) => /^\d+$/.test(x)).map(Number));
  const steps = ticks.slice(1).map((v, i) => v - ticks[i]);
  check(ticks.length < 2 || new Set(steps).size === 1, `Panel: the position history's ticks are even: ${ticks.join(",")}`);
  const host = await one(page, ".kw-page-url", (x) => x.querySelector(".nowrap")?.textContent || "");
  check(/^https?:\/\/[^/]+$/.test(host), `Panel: the page's host stays on one line: ${host}`);
  await page.screenshot({ path: `${OUT}/panel.png` });
  check(!problems.filter((p) => !/404/.test(p)).length, `Keywords: no page errors ${problems.join(" ")}`);
  await browser.close();

  // ?simple=1: one search and one Filter before the first row; the chips and the rest are inside Filter
  {
    const { browser: b, page: p } = await open({ width: 1440, height: 900 });
    await p.goto(`${BASE}?simple=1#keywords`); await p.waitForSelector("#kw-table", { timeout: 20000 }); await settle(p, 1200);
    const before = await p.evaluate(() => {
      const table = document.querySelector("#kw-table"), content = document.querySelector(".content");
      return [...content.querySelectorAll("button, input, select, a")].filter((el) => el.offsetParent && (el.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING) && !el.closest(".kw-engines, .tiles, .kwr-phone-acts")).map((el) => el.id || (el.matches("[data-tp-search]") ? "search" : el.textContent.trim()));
    });
    check(before.length === 2 && before.includes("kw-filter"), `Simple: one search and one Filter before the first row: ${before.join(", ")}`);
    await p.click("#kw-filter"); await settle(p, 400);
    check((await p.locator("#kw-filter-panel [data-filter]").count()) >= 8 && Boolean(await p.$("#kw-filter-panel [data-view]")) && Boolean(await p.$("#kw-filter-panel #density")), "Simple: the chips, the view and compact rows are inside Filter");
    await p.click('#kw-filter-panel [data-filter="top10"]'); await settle(p, 500);
    check(await p.evaluate(() => document.activeElement?.dataset.filter === "top10") && (await p.textContent("#kw-filter-count")) === "1", "Simple: a chip keeps the keyboard and Filter counts it");
    await p.screenshot({ path: `${OUT}/simple-filter.png` });
    await b.close();
  }
  // A phone: labelled main buttons that fit
  for (const q of ["", "?simple=1"]) {
    const { browser: b, page: p } = await open({ width: 390, height: 844 });
    await p.goto(`${BASE}${q}#keywords`); await p.waitForSelector("#kw-table", { timeout: 20000 }); await settle(p, 1200);
    const acts = await many(p, ".kwr-phone-acts .btn", (els) => els.map((x) => { const r = x.getBoundingClientRect(); return { text: x.textContent.trim(), fits: r.left >= 0 && r.right <= innerWidth }; }));
    check(acts.length === 2 && acts.every((a) => a.text && a.fits) && acts.some((a) => a.text === "Refresh"), `Phone${q}: Add keywords and Refresh are labelled and fit: ${JSON.stringify(acts)}`);
    check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `Phone${q}: no sideways scroll`);
    await p.screenshot({ path: `${OUT}/phone${q ? "-simple" : ""}.png` });
    await b.close();
  }

  console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join("\n- ")}` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})();
