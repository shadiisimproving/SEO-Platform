// Clarity's dashboard downloads, driven by hand like a normal user: upload several CSVs in Settings, then read them on
// Content and AI search, for all sites and for one, in English and French.
// Needs: DB_NAME_TEST=seo_cc_h_test .venv/bin/python tests/ui/app_server.py --port 8231 --empty --login
// Usage: CLARITY_DIR=<folder with Clarity_*.csv> SCREENS_URL=http://127.0.0.1:8231/ node tests/ui/flow_clarity_reports.cjs [folder for screenshots]
// The CSVs aren't in the repo: they are a real site's numbers. Use Clarity's own downloads for the three sites below.
const path = require("path");
const fs = require("fs");
const os = require("os");
const { open, menu } = require("./pw.cjs");

const ROOT = process.env.SCREENS_URL || "http://127.0.0.1:8231/";
const DIR = process.env.CLARITY_DIR;
const SHOTS = process.argv[2];
const HOSTS = ["creer-societe-dubai.fr", "comptabilite-dubai.com", "business-setup-dubai.com"];
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `: ${JSON.stringify(detail).slice(0, 400)}`}`); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };
const settle = (page, ms = 700) => page.waitForTimeout(ms);

(async () => {
  if (!DIR) { console.log("Set CLARITY_DIR to the folder holding the Clarity_*.csv downloads."); process.exit(2); }
  const files = fs.readdirSync(DIR).filter((f) => /^Clarity_.*\.csv$/.test(f)).map((f) => path.join(DIR, f));
  const { browser, page, problems } = await open({ height: 1000 });
  const bad = [];
  page.on("response", (r) => { if (r.status() >= 500) bad.push(`${r.status()} ${r.url()}`); });

  await page.goto(ROOT);
  await page.fill("#email", "admin@example.com");
  await page.fill("#password", "demo-password-1");
  await page.click("#go");
  await page.waitForSelector("[data-go]");
  for (const host of HOSTS) await page.evaluate((h) => window.COMP.api("POST", "sites", { address: `https://${h}/`, kind: "own" }).catch(() => {}), host);

  // Before any upload, Content points to where the files go.
  await page.goto("about:blank"); await page.goto(`${ROOT}#content`); await settle(page, 1500);
  check("Content says where Clarity downloads go", (await page.locator(".content").innerText()).includes("Clarity dashboard downloads"));

  const openFold = async () => {
    await page.goto("about:blank"); await page.goto(`${ROOT}#settings`);
    await page.waitForSelector('[data-conn="clarity"]');
    await page.locator('[data-conn="clarity"]').click();
    await page.waitForSelector("#cr-fold");
    await page.locator("#cr-fold summary").click();
  };
  await openFold();
  check("the panel offers the downloads", await page.locator("#cr-file").isVisible());

  // A hurried person picks the wrong file first.
  const wrong = path.join(os.tmpdir(), "wrong-clarity.csv");
  fs.writeFileSync(wrong, "a,b\n1,2\n");
  await page.setInputFiles("#cr-file", wrong);
  await page.waitForSelector("#cr-result .crit");
  check("the wrong file gets a plain answer", (await page.locator("#cr-result").innerText()).includes("press Export"));
  check("and nothing to add", !(await page.locator("#cr-import").count()));

  await page.setInputFiles("#cr-file", files);
  await page.waitForSelector("#cr-import");
  let said = await page.locator("#cr-result").innerText();
  check("the preview names each site", HOSTS.every((h) => said.includes(h)), said);
  check("and says which kind each is", said.includes("Dashboard") && said.includes("AI visibility"), said);
  check(`the button counts the files (${files.length})`, (await page.locator("#cr-import").innerText()).includes(String(files.length)));
  await shot(page, "1-preview");

  await page.locator("#cr-import").click();
  await page.waitForFunction(() => document.querySelector("#cr-result")?.innerText.includes("Content and AI search"));
  await shot(page, "2-added");

  // Uploading again replaces, never doubles.
  await page.setInputFiles("#cr-file", []);
  await page.setInputFiles("#cr-file", files);
  await page.waitForSelector("#cr-import");
  said = await page.locator("#cr-result").innerText();
  check("a second upload says it replaces", said.includes("replaces the one already here"), said);
  await page.keyboard.press("Escape"); await settle(page, 300);

  // Content, all sites: one row per site.
  await page.goto("about:blank"); await page.goto(`${ROOT}#content`); await settle(page, 1500);
  let text = await page.locator(".content").innerText();
  check("Content lists the three sites", HOSTS.every((h) => text.includes(h)), text.slice(0, 600));
  check("real visits leave the bots out (9,682 − 5,417 = 4,265)", text.includes("4,265"), text.slice(0, 600));
  await shot(page, "3-content-all");

  // One site: the answer first, then tabs.
  const creer = await page.evaluate(() => window.SITES.find((s) => s.host === "creer-societe-dubai.fr")?.id);
  await page.click(`.content [data-pick-site="${creer}"]`); await settle(page, 1500);
  check("pressing a site in the table picks it", (await page.locator("#site-switch").innerText()).includes("creer-societe-dubai.fr"));
  text = await page.locator(".content").innerText();
  check("one site leads with a sentence", text.includes("4,265 real visits: Clarity counted 9,682 and marked 5,417 as bots"), text.slice(0, 500));
  await shot(page, "4-content-one");
  for (const [tab, word] of [["referrers", "www.google.com"], ["problems", "slow"], ["visitors", "Unique visitors"], ["pages", "/creation-societe-freezone-dubai/"]]) {
    await page.click(`[data-cr-tab="dashboard:${tab}"]`); await settle(page, 300);
    text = await page.locator(".content").innerText();
    check(`the ${tab} tab shows ${word}`, text.includes(word), text.slice(0, 300));
    await shot(page, `5-content-${tab}`);
  }
  await page.click('[data-cr-tab="dashboard:referrers"]'); await settle(page, 300);
  text = await page.locator(".content").innerText();
  check("the site itself isn't listed as a referrer", !/\nwww\.creer-societe-dubai\.fr\t/.test(text) && text.includes("left out"));
  check("the tab keeps focus for the keyboard", await page.evaluate(() => document.activeElement?.dataset?.crTab === "dashboard:referrers"));

  // AI search, one site: questions kept from the file that had them.
  await page.goto("about:blank"); await page.goto(`${ROOT}#ai`); await settle(page, 1500);
  text = await page.locator(".content").innerText();
  check("AI search lists the three sites even without Google Analytics", HOSTS.every((h) => text.includes(h)) && text.includes("1,266"), text.slice(0, 400));
  await page.click(`.content [data-pick-site="${creer}"]`); await settle(page, 1500);
  text = await page.locator(".content").innerText();
  check("one site leads with how often Copilot cited it", text.includes("Copilot cited this site 1,266 times"), text.slice(0, 500));
  await page.click('[data-cr-tab="ai:questions"]'); await settle(page, 300);
  text = await page.locator(".content").innerText();
  check("the questions are there", text.includes("ouvrir une societe a dubai"), text.slice(0, 400));
  await shot(page, "6-ai-one");

  // All sites, in French, and on a phone.
  await page.click("#site-switch"); await page.click('[data-pick-site="all"]'); await settle(page, 1200);
  await menu(page, "lang"); await settle(page, 800);
  text = await page.locator(".content").innerText();
  check("French: AI search table", text.includes("Cité par Microsoft Copilot") && text.includes("Part d'autorité"), text.slice(0, 400));
  await shot(page, "7-ai-all-fr");
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("about:blank"); await page.goto(`${ROOT}#content`); await settle(page, 1500);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("phone: no sideways scroll", sideways <= 1, sideways);
  await shot(page, "8-content-phone-fr");

  const real = problems.filter((p) => !p.includes("409")); // a rerun adds the same sites again, and the app says they are already there
  check("no page errors", !real.length, real);
  check("no server errors", !bad.length, bad);
  await browser.close();
  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `${failed} failed` : `all ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
