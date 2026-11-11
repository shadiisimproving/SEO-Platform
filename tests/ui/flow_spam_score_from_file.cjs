// The uploaded file's spam score decides (2026-11-10): betmatecasino.com had 3 in an Ubersuggest file and was flagged by
// its name. Now a low score is good whatever the name, a high one is spam "in the uploaded file", and only a domain the
// file has no score for is judged by the app, which the row says ("Flagged by the system: ...").
//   DB_NAME_TEST=test_rivals_test .venv/bin/python tests/ui/app_server.py --port 8251
//   node tests/ui/flow_spam_score_from_file.cjs http://127.0.0.1:8251/
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const BASE = process.argv[2] || "http://127.0.0.1:8251/";
const OUT = path.resolve("var/ui-spam-score-from-file") + "/";
fs.mkdirSync(OUT, { recursive: true });
let bad = 0;
const check = (name, ok, extra = "") => { if (!ok) bad += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? `  [${extra}]` : ""}`); };

const FILE = path.join(OUT, "ubersuggest.csv");
const line = (n, from, to, da, spam) => `${n},"A page","${from}","${to}",${da},20,${spam},"an anchor","2025-05-13","2026-11-04"`;
fs.writeFileSync(FILE, "﻿" + [
  "No,Source Page Title,Source URL,Target URL,Domain Authority,Page Authority,Spam Score,Anchor Text,First Seen,Last Seen",
  line(1, "https://betmate-casino.example/review", "https://rival-one.example/", 60, 3),
  line(2, "https://free-directory-site.example/list", "https://rival-one.example/", 36, 52),
  line(3, "https://lucky-casino.example/page", "https://rival-one.example/", 20, ""),
].join("\n"));

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 950 });
  await page.goto(BASE + "#competitors/gaps"); await page.waitForSelector("#cg-table", { timeout: 20000 }); await page.waitForTimeout(600);
  await page.click("#cg-upload");
  await page.waitForSelector("#cg-up-file");
  const who = await page.locator("#cg-up-who option").evaluateAll((opts) => opts.find((o) => o.textContent.trim().startsWith("rival-one.example "))?.value);
  await page.selectOption("#cg-up-who", who);
  await page.setInputFiles("#cg-up-file", FILE);
  await page.click("#cg-up-send");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: OUT + "1-uploaded.png" });
  await page.keyboard.press("Escape");
  await page.goto(BASE + "#competitors/gaps"); await page.waitForSelector("#cg-table"); await page.waitForTimeout(1200);
  const search = page.locator("#cg-table").locator("xpath=ancestor::*[1]").locator("input[type=search]").first();

  const row = async (domain) => {
    if (await search.count()) { await search.fill(domain); await page.waitForTimeout(500); }
    const r = page.locator(`[data-cg-row="${domain}"]`);
    if (!(await r.count())) return null;
    // Since 2026-11-11 "Flagged by the system" is a cog whose words are its tip (data-tip), before the reason.
    const tips = (await r.locator("[data-tip]").evaluateAll((els) => els.map((e) => e.getAttribute("data-tip")))).join(" | ");
    return { text: (await r.innerText()).replace(/\s+/g, " "), tips, disabled: await r.locator("[data-cg-pick]").isDisabled() };
  };
  // The quality chips start on "All", so flagged rows show too.
  const low = await row("betmate-casino.example");
  check("a casino name with score 3 in the file is good, and can be ticked", low && !low.disabled && !/Spam words/.test(low.text), low?.text);
  await page.screenshot({ path: OUT + "2-low-score.png" });
  const high = await row("free-directory-site.example");
  check("score 52 in the file is spam, and says the file flagged it", high && high.disabled && /File spam score above 30/.test(high.text), high?.text);
  await page.screenshot({ path: OUT + "3-high-score.png" });
  const none = await row("lucky-casino.example");
  check("no score in the file: the system flags it and says so", none && none.disabled && none.tips.includes("Flagged by the system") && /Spam words in name/.test(none.text), none && `${none.text} | tips: ${none.tips}`);
  await page.screenshot({ path: OUT + "4-system.png" });
  check("no errors in the page", problems.length === 0, problems.join(" | "));
  await browser.close();
  console.log(bad ? `${bad} FAILED` : "ALL PASS");
  process.exit(bad ? 1 : 0);
})();
