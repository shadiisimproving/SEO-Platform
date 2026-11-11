// Clarity's dashboard downloads, driven by hand like a normal user: upload several CSVs in Settings, then read them on
// Content and AI search, for all sites and for one, in English and French.
// Needs: DB_NAME_TEST=seo_cc_h_test .venv/bin/python tests/ui/app_server.py --port 8231 --empty --login
// Usage: SCREENS_URL=http://127.0.0.1:8231/ node tests/ui/flow_clarity_reports.cjs [folder for screenshots]
// It writes its own Clarity files for made-up sites, in the layout of Clarity's real exports. No real site or number is in here.
const path = require("path");
const fs = require("fs");
const os = require("os");
const { open, menu } = require("./pw.cjs");

const ROOT = process.env.SCREENS_URL || "http://127.0.0.1:8231/";
const SHOTS = process.argv[2];
// Made-up sites and numbers. Only their layout copies Clarity's exports (Dashboard, then Export).
const SITES = [
  { host: "shop-one.test", project: "Shop One", from: "08/09/2026", sessions: 2400, bots: 900, citations: 420, lcp: "5.2s" },
  { host: "shop-two.test", project: "Shop Two", from: "07/31/2026", sessions: 300, bots: 40, citations: 25, lcp: "1.4s" },
  { host: "shop-three.test", project: "Shop Three", from: "07/31/2026", sessions: 150, bots: 10, citations: 6, lcp: "1.1s" },
];
const HOSTS = SITES.map((x) => x.host);
const ONE = SITES[0];
const fmt = (n) => n.toLocaleString("en-US");
const head = (x, from) => `\ufeff"Project name","${x.project}"\n"Date range","${from} 12:00 AM - 11/06/2026 11:59 PM"\n\n\n`;
const dashboardCsv = (x) => `${head(x, x.from)}"Metric","Sessions"
"","Total sessions","${x.sessions}"
"","Bot sessions","${x.bots}"

"Metric","Pages per session"
"","Average","1.4"

"Metric","Scroll depth"
"","Average","41.5"

"Metric","Active time spent"
"","Active time","120"
"","Total time","200"

"Metric","Users overview"
"","Unique users","${x.sessions - 50}"
"","Sessions with new users","${x.sessions - 30}"
"","Sessions with returning users","30"

"Metric","Insights","No. of sessions","% of sessions"
"","Rage clicks","5","0.50%"
"","Dead click","60","5.00%"
"","Excessive scrolling","1","0.10%"
"","Quick back click","30","2.50%"

"Metric","Browsers","No. of sessions","% of sessions"
"","Chrome","${Math.round(x.sessions * 0.6)}","60.00%"
"","MobileSafari","${Math.round(x.sessions * 0.4)}","40.00%"

"Metric","Top pages","No. of sessions"
"","https://www.${x.host}/","${Math.round(x.sessions / 4)}"
"","https://www.${x.host}/guide-to-shops/","${Math.round(x.sessions / 8)}"

"Metric","Smart events","No. of sessions","% of sessions"
"","Contact us","12","1.00%"

"Metric","Referrer","No. of sessions"
"","www.${x.host}","${Math.round(x.sessions / 5)}"
"","www.google.com","${Math.round(x.sessions / 6)}"
"","news.example","9"

"Metric","JavaScript errors"
"","Sessions with JavaScript errors"
""," total JavaScript errors","2"
"","","No. of sessions","% of sessions"
"","script error.","2","100%"

"Metric","Performance overview"
"","Score","75"
"","LCP (Largest Contentful Paint)","${x.lcp}"
"","INP (Interaction to Next Paint)","180ms"
"","CLS (Cumulative Layout Shift)","0.05s"

"Metric","Bot traffic"
"suspiciousDeviceBotSessions","${Math.round(x.bots / 2)}"
"suspiciousInteractionBotSessions","${x.bots}"
"__typename","BotTypes"
`;
const QUESTIONS = '"Query","Citations","SoA"\n"how to open a shop","40","30.00%"\n"best shop guide","12","20.00%"\n\n';
const aiCsv = (x, questions) => `${head(x, "07/31/2026")}"Metric","Share of authority (SoA)","22.5"

${questions ? QUESTIONS : ""}"Page URL","Citations"
"https://www.${x.host}/guide-to-shops/","${Math.round(x.citations * 0.6)}"
"https://www.${x.host}/","${Math.round(x.citations * 0.4)}"

"Metric","Page citations","${x.citations}"

"Metric","AI referral traffic","3"
`;
function writeFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clarity-flow-"));
  const out = [];
  SITES.forEach((x, i) => {
    const one = path.join(dir, `Clarity_${x.project.replace(/ /g, "_")}_Dashboard_${i}a.csv`);
    fs.writeFileSync(one, dashboardCsv(x)); out.push(one);
    const two = path.join(dir, `Clarity_${x.project.replace(/ /g, "_")}_Dashboard_${i}b.csv`);
    fs.writeFileSync(two, aiCsv(x, i === 0)); out.push(two);
  });
  // The same AI period again without its questions: the questions from the first file must stay.
  const again = path.join(dir, "Clarity_Shop_One_Dashboard_0c.csv");
  fs.writeFileSync(again, aiCsv(ONE, false)); out.push(again);
  return out;
}
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `: ${JSON.stringify(detail).slice(0, 400)}`}`); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };
const settle = (page, ms = 700) => page.waitForTimeout(ms);

(async () => {
  const files = writeFiles();
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
  // A busy Mac can take longer than the settle to draw Content the first time: wait for it, up to 15 s, before reading it.
  await page.waitForFunction(() => (document.querySelector(".content")?.innerText || "").includes("Clarity dashboard downloads"), null, { timeout: 15000 }).catch(() => {});
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
  check("a second upload says it replaces", said.includes("replaces the current one"), said);
  await page.keyboard.press("Escape"); await settle(page, 300);

  // Content, all sites: one row per site.
  await page.goto("about:blank"); await page.goto(`${ROOT}#content`); await settle(page, 1500);
  let text = await page.locator(".content").innerText();
  check("Content lists the three sites", HOSTS.every((h) => text.includes(h)), text.slice(0, 600));
  check(`real visits leave the bots out (${fmt(ONE.sessions)} − ${fmt(ONE.bots)})`, text.includes(fmt(ONE.sessions - ONE.bots)), text.slice(0, 600));
  await shot(page, "3-content-all");

  // One site: the answer first, then tabs.
  const oneId = await page.evaluate((h) => window.SITES.find((s) => s.host === h)?.id, ONE.host);
  await page.click(`.content [data-pick-site="${oneId}"]`); await settle(page, 1500);
  check("pressing a site in the table picks it", (await page.locator("#site-switch").innerText()).includes(ONE.host));
  text = await page.locator(".content").innerText();
  check("one site leads with a sentence", text.includes(`${fmt(ONE.sessions - ONE.bots)} real visits: Clarity counted ${fmt(ONE.sessions)} and marked ${fmt(ONE.bots)} as bots`), text.slice(0, 500));
  await shot(page, "4-content-one");
  for (const [tab, word] of [["referrers", "www.google.com"], ["problems", "slow"], ["visitors", "Unique visitors"], ["pages", "/guide-to-shops/"]]) {
    await page.click(`[data-cr-tab="dashboard:${tab}"]`); await settle(page, 300);
    text = await page.locator(".content").innerText();
    check(`the ${tab} tab shows ${word}`, text.includes(word), text.slice(0, 300));
    await shot(page, `5-content-${tab}`);
  }
  await page.click('[data-cr-tab="dashboard:referrers"]'); await settle(page, 300);
  text = await page.locator(".content").innerText();
  check("the site itself isn't listed as a referrer", !text.includes(`\nwww.${ONE.host}\t`) && text.includes("left out"));
  check("the tab keeps focus for the keyboard", await page.evaluate(() => document.activeElement?.dataset?.crTab === "dashboard:referrers"));

  // AI search, redesigned on 2026-11-10: an answer first, then tabs, and a site is picked in the side menu as everywhere.
  // All sites: every site's downloads count, then one site: questions kept from the file that had them.
  const allCited = SITES.reduce((n, x) => n + x.citations, 0);
  await page.goto("about:blank"); await page.goto(`${ROOT}#ai`); await settle(page, 1500);
  text = await page.locator(".content").innerText();
  await page.click('[data-ai-tab="cited"]'); await settle(page, 500);
  const cited = await page.locator(".ai-tabs-card").innerText();
  check("AI search counts the three sites even without Google Analytics", text.includes(`Copilot cited your sites ${fmt(allCited)} times`) && HOSTS.every((h) => cited.includes(h)), `${text.slice(0, 200)} | ${cited.slice(0, 300)}`);
  await page.click("#site-switch"); await page.click(`[data-pick-site="${oneId}"]`); await settle(page, 1500);
  text = await page.locator(".content").innerText();
  check("one site leads with how often Copilot cited it", text.includes(`Copilot cited you ${fmt(ONE.citations)} times`), text.slice(0, 500));
  await page.click('[data-ai-tab="questions"]'); await settle(page, 300);
  text = await page.locator(".content").innerText();
  check("the questions are there", text.includes("how to open a shop"), text.slice(0, 400));
  await shot(page, "6-ai-one");

  // All sites, in French, and on a phone.
  await page.click("#site-switch"); await page.click('[data-pick-site="all"]'); await settle(page, 1200);
  await menu(page, "lang"); await settle(page, 800);
  await page.click('[data-ai-tab="cited"]'); await settle(page, 500);
  text = await page.locator(".content").innerText();
  check("French: AI search table", text.includes(`Copilot a cité vos sites ${allCited} fois`) && text.includes("Pages citées") && HOSTS.every((h) => text.includes(h)), text.slice(0, 400));
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
