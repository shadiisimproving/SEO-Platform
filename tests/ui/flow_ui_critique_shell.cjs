// The UI critique fixes of 2026-11-12 that live in the shared shell (track 4): colours, sizes, the menu's count, the side panel,
// tabs, the period's real dates, Settings' one main Connect, the danger button, brand names, Overview's strips and task defaults.
// Needs the sample app (made-up data only):
//   DB_NAME_TEST=<your>_test .venv/bin/python tests/ui/app_server.py --port 8280
// Run: node tests/ui/flow_ui_critique_shell.cjs [http://127.0.0.1:8280/] [folder for screenshots]
const fs = require("fs");
const { open } = require("./pw.cjs");
const BASE = process.argv[2] || "http://127.0.0.1:8280/";
const OUT = process.argv[3] || "var/ui-critique-shell";
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, what, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${what}${extra !== "" ? `  [${extra}]` : ""}`); if (!ok) fails.push(what); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(false, `${name}: ${e.message.split("\n")[0]}`); } };

/* Contrast of an element's text on what is behind it (walking up to the first solid background). */
const contrastOf = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  // "rgb(1, 2, 3)" or, for a color-mix(), "color(srgb 0.1 0.2 0.3 / 0.5)" in 0–1.
  const rgb = (s) => { const m = s.match(/[\d.]+/g).map(Number); const k = s.startsWith("color(") ? 255 : 1; return { r: m[0] * k, g: m[1] * k, b: m[2] * k, a: m[3] ?? 1 }; };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const layers = [];
  for (let n = el; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.a > 0) layers.push(c); if (c.a === 1) break; }
  let bg = { r: 255, g: 255, b: 255, a: 1 };
  layers.reverse().forEach((c) => { bg = over(c, bg); });
  const fg = over(rgb(getComputedStyle(el).color), bg);
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
}, selector);

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  await page.goto(`${BASE}#overview`);
  await page.waitForTimeout(3000);

  await step("purple only means them", async () => {
    const cards = await page.evaluate(() => [...document.querySelectorAll(".ov-cards .tile .ico")].map((i) => getComputedStyle(i).color));
    const purple = await page.evaluate(() => { const p = document.createElement("i"); p.style.color = "var(--c-purple)"; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
    check(cards.length === 4 && !cards.includes(purple), "no number card is purple", cards.join(" "));
    const tabs = await page.evaluate(() => [...document.querySelectorAll(".tabs .tab svg.i")].map((i) => getComputedStyle(i).color));
    check(!tabs.includes(purple), "no tab icon is purple");
  });

  await step("Overview: one strip per number, nothing repeats the Clicks card", async () => {
    check((await page.locator(".ov-chart .ov-strip").count()) === 2, "clicks and impressions each get their own strip");
    const answer = await page.locator(".ov-answer").innerText().catch(() => "");
    check(!/→/.test(answer.split("\n")[0] || "") && !/^Clicks/m.test(answer), "the line on top doesn't repeat the Clicks card", answer.replace(/\n/g, " / ").slice(0, 80));
    await page.screenshot({ path: `${OUT}/overview.png` });
  });

  await step("the period says its real dates and why they differ", async () => {
    const pick = await page.locator("#period").innerText();
    check(/\d+ \w+ – \d+ \w+/.test(pick), "the period button shows its dates", pick.replace(/\n/g, " "));
    const behind = await page.locator(".range-behind").getAttribute("aria-label").catch(() => "");
    check(/Search Console data runs \d+ days? behind/.test(behind || ""), "a mark says Search Console runs behind", behind);
  });

  await step("text is never below 12 px", async () => {
    const small = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim()) && el.getClientRects().length && parseFloat(getComputedStyle(el).fontSize) < 12).map((el) => `${el.tagName.toLowerCase()}.${el.className}`).slice(0, 8));
    check(!small.length, "nothing under 12 px on Overview", small.join(", "));
  });

  await step("the menu's count", async () => {
    const today = page.locator('.nav-item[data-go="today"]');
    const name = await today.getAttribute("aria-label");
    check(/^Today, \d+ to do$/.test(name || ""), "Today's name says the count in words", name);
    const size = await page.locator(".nav-item .count").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    check(size >= 12, "the count is at least 12 px", size);
    const ratio = await contrastOf(page, ".nav-item .count");
    check(ratio >= 4.5, "its number keeps 4.5:1", ratio);
    const anim = await page.locator(".nav-item .count").first().evaluate((el) => getComputedStyle(el, "::after").animationName);
    check(anim === "attention", "its pulse is the ::after ring (transform and opacity)", anim);
  });

  await step("side panel: a dialog, Tab stays sensible", async () => {
    await page.locator(".ov-row td.ov-n").first().click(); await page.waitForTimeout(1500);
    const panel = page.locator("#panel");
    check((await panel.getAttribute("role")) === "dialog" && (await panel.getAttribute("aria-modal")) === "false", "the panel is a non-modal dialog");
    check(Boolean(await panel.getAttribute("aria-labelledby")) || Boolean(await panel.getAttribute("aria-label")), "it has a name");
    for (let i = 0; i < 60; i++) await page.keyboard.press("Tab");
    const where = await page.evaluate(() => (document.querySelector("#panel")?.contains(document.activeElement) ? "panel" : document.activeElement?.closest?.("tr") ? "row" : document.activeElement?.tagName));
    check(where === "panel" || where === "row", "Tab never wanders off into the browser", where);
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  });

  await step("tabs: one Tab stop per list", async () => {
    const stops = await page.evaluate(() => [...document.querySelectorAll('[role="tablist"]')].map((list) => [...list.querySelectorAll('[role="tab"]')].filter((tab) => tab.tabIndex === 0).length));
    check(stops.length > 0 && stops.every((n) => n === 1), "each tab list has exactly one tab in the Tab order", stops.join(","));
  });

  await step("a status pill keeps 4.5:1", async () => {
    await page.goto(`${BASE}#health`); await page.waitForTimeout(2500);
    const sel = ".status.crit, .status.warn, .status.good, .status.serious";
    const n = await page.locator(sel).count();
    const ratios = [];
    for (let i = 0; i < Math.min(n, 6); i++) { await page.locator(sel).nth(i).evaluate((el) => el.setAttribute("data-probe", "1")); ratios.push(await contrastOf(page, '[data-probe="1"]')); await page.locator('[data-probe="1"]').evaluate((el) => el.removeAttribute("data-probe")); }
    check(ratios.length > 0 && ratios.every((r) => r >= 4.5), "every pill checked is at least 4.5:1", ratios.join(" "));
  });

  await step("Settings: one main Connect, a neutral zero, brand names", async () => {
    await page.goto(`${BASE}#settings`); await page.waitForTimeout(2500);
    const main = await page.locator('[data-conn].btn-main').count();
    const all = await page.locator("[data-conn]").filter({ hasText: "Connect" }).count();
    check(main === 1 && all > 1, "only the next source's Connect is blue", `${main} of ${all}`);
    check((await page.locator("#set-tiles .ico.neutral").count()) === 1, "Needs a fix at 0 is neutral");
    const serp = await page.locator("#set-tiles").innerText();
    check(/SerpApi/.test(serp), "Running out first names the tool beside its logo");
    await page.screenshot({ path: `${OUT}/settings.png` });
  });

  await step("a remove asks with a danger button, Cancel first", async () => {
    const asked = page.evaluate(() => window.UI.confirmDanger({ title: "Remove this key?", body: "You'd have to paste it again.", yes: "Remove" }));
    await page.waitForTimeout(400);
    check((await page.locator("#dlg [data-dlg-yes].btn-danger svg").count()) === 1, "the remove button is the danger one, with its icon and word");
    check((await page.evaluate(() => document.activeElement.textContent.trim())) === "Cancel", "Cancel has the focus");
    await page.keyboard.press("Escape");
    check((await asked) === false, "Escape answers no");
  });

  await step("brand names: logo and name in a sentence, never logo alone there", async () => {
    await page.goto(`${BASE}#overview`); await page.waitForTimeout(2500);
    const sub = await page.locator("#topbar .sub").innerText();
    check(/Search Console/.test(sub) && (await page.locator("#topbar .sub .brand-mention.logo-only").count()) === 0, "the subtitle shows the name beside the logo", sub);
    const sized = await page.evaluate(() => [...document.querySelectorAll("img.brand-logo")].every((img) => img.getAttribute("width") && img.getAttribute("height")));
    check(sized, "every brand logo has a width and height");
  });

  await step("a new task from a finding: owner, type and keyword filled in", async () => {
    await page.goto(`${BASE}#insights`); await page.waitForTimeout(2500);
    const rows = await page.locator("tr[data-in-open]").count();
    for (let i = 0; i < rows; i++) {
      await page.locator("tr[data-in-open]").nth(i).click(); await page.waitForTimeout(1200);
      if (await page.locator("#panel [data-in-task]").count()) break;
      await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    }
    await page.locator("#panel [data-in-task]").first().click(); await page.waitForTimeout(1200);
    const kind = await page.inputValue("#task-kind");
    const keywords = JSON.parse((await page.inputValue("#task-keywords")) || "[]");
    check(kind.length > 0, "the type is filled in", kind);
    check(keywords.length > 0, "the finding's keyword is on the task", keywords.join(", "));
    await page.screenshot({ path: `${OUT}/task.png` });
    await page.keyboard.press("Escape"); await page.waitForTimeout(600);
    if (await page.locator("#panel").count()) { await page.keyboard.press("Escape"); await page.waitForTimeout(600); }
  });

  await step("phone: the Notes button is small and steps aside while scrolling down", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}#today`); await page.waitForTimeout(2500);
    const box = await page.locator("#nb-fab").boundingBox();
    check(box && box.width <= 48, "a round icon on a phone", box && box.width);
    await page.locator("#main").evaluate((m) => { m.style.scrollBehavior = "auto"; m.scrollTop = 0; });
    await page.mouse.move(200, 400);
    await page.mouse.wheel(0, 600); await page.waitForTimeout(300);
    check(await page.evaluate(() => document.body.classList.contains("nb-away")), "it steps aside while the page scrolls down");
    await page.screenshot({ path: `${OUT}/phone-today.png` });
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "no sideways scroll on a phone");
  });

  check(!problems.filter((p) => !/404/.test(p)).length, "no script errors", problems.filter((p) => !/404/.test(p)).join(" | "));
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : "\nALL PASSED");
  process.exit(fails.length ? 1 : 0);
})();
