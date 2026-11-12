// AI search's part of flow_clarity_reports.cjs, on the simpler screens (?simple=1, track T7): Clarity downloads read on AI
// search for all sites and for one, in English and French, and on a phone. Run it after flow_clarity_reports.cjs on the same
// server, which uploads the made-up downloads (shop-one.test, shop-two.test, shop-three.test). No real site or number is here.
// Needs: DB_NAME_TEST=test_t7_p2_clar_test .venv/bin/python tests/ui/app_server.py --port 8462 --empty --login --slow 0
// Usage: SCREENS_URL=http://127.0.0.1:8462/ node tests/ui/flow_clarity_reports_ai_simple.cjs [folder for screenshots]
const path = require("path");
const { open, menu } = require("./pw.cjs");

const ROOT = (process.env.SCREENS_URL || "http://127.0.0.1:8462/").replace(/[?#].*$/, "");
const SHOTS = process.argv[2];
// The same made-up sites and citations as flow_clarity_reports.cjs.
const SITES = [{ host: "shop-one.test", citations: 420 }, { host: "shop-two.test", citations: 25 }, { host: "shop-three.test", citations: 6 }];
const HOSTS = SITES.map((x) => x.host);
const ONE = SITES[0];
const fmt = (n) => n.toLocaleString("en-US");
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `: ${JSON.stringify(detail).slice(0, 400)}`}`); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };
const settle = (page, ms = 700) => page.waitForTimeout(ms);

(async () => {
  const { browser, page, problems } = await open({ height: 1000 });
  const bad = [];
  page.on("response", (r) => { if (r.status() >= 500) bad.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${ROOT}?simple=1`);
  if (await page.locator("#email").count()) {
    await page.fill("#email", "admin@example.com");
    await page.fill("#password", "demo-password-1");
    await page.click("#go");
  }
  await page.waitForSelector("[data-go]");
  const oneId = await page.evaluate((h) => window.SITES.find((s) => s.host === h)?.id, ONE.host);

  const allCited = SITES.reduce((n, x) => n + x.citations, 0);
  await page.goto("about:blank"); await page.goto(`${ROOT}?simple=1#ai`); await settle(page, 1500);
  check("the switch is on", await page.evaluate(() => window.UI.simple()));
  let text = await page.locator(".content").innerText();
  await page.click('[data-ai-tab="cited"]'); await settle(page, 500);
  const cited = await page.locator(".ai-tabs-card").innerText();
  check("AI search counts the three sites even without Google Analytics", text.includes(`Copilot cited your sites ${fmt(allCited)} times`) && HOSTS.every((h) => cited.includes(h)), `${text.slice(0, 200)} | ${cited.slice(0, 300)}`);
  check("without Google Analytics, the Clarity live chart is one line", await page.locator(".ai-clarity-line").count() === 1);
  await page.click("#site-switch"); await page.click(`[data-pick-site="${oneId}"]`); await settle(page, 1500);
  text = await page.locator(".content").innerText();
  check("one site leads with how often Copilot cited it", text.includes(`Copilot cited you ${fmt(ONE.citations)} times`), text.slice(0, 500));
  check("its card says the citations", (await page.locator('[data-card="ai-citations"] .ncard-fig').innerText()).replace(/\D/g, "") === String(ONE.citations));
  await page.click('[data-ai-tab="questions"]'); await settle(page, 300);
  text = await page.locator(".content").innerText();
  check("the questions are there", text.includes("how to open a shop"), text.slice(0, 400));
  await shot(page, "simple-clarity-ai-one");

  // All sites, in French, and on a phone.
  await page.click("#site-switch"); await page.click('[data-pick-site="all"]'); await settle(page, 1200);
  await menu(page, "lang"); await settle(page, 800);
  await page.click('[data-ai-tab="cited"]'); await settle(page, 500);
  text = await page.locator(".content").innerText();
  check("French: AI search table", text.includes(`Copilot a cité vos sites ${allCited} fois`) && text.includes("Pages citées") && HOSTS.every((h) => text.includes(h)), text.slice(0, 400));
  await shot(page, "simple-clarity-ai-all-fr");
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("about:blank"); await page.goto(`${ROOT}#ai`); await settle(page, 1500);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("phone: no sideways scroll", sideways <= 1, sideways);
  await shot(page, "simple-clarity-ai-phone-fr");

  const real = problems.filter((p) => !p.includes("409") && !p.includes("404"));
  check("no page errors", !real.length, real);
  check("no server errors", !bad.length, bad);
  await browser.close();
  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `${failed} failed` : `all ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
