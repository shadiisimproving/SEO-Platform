// Keyword ideas on Keywords: country and language, Add and Add all, ideas already tracked, French, phone, a site with no keywords.
// Google's suggestions are answered by the browser here, so nothing leaves the Mac.
// Needs: DB_NAME_TEST=seo_cc_b_test .venv/bin/python tests/ui/app_server.py --port 8210
const { open, menu } = require("./pw.cjs");
const out = process.argv[2] || "/tmp";
const BASE = process.argv[3] || "http://127.0.0.1:8210/";
const note = (...a) => console.log(...a);
const fails = [];
const check = (ok, what) => { note(ok ? "ok  " : "FAIL", what); if (!ok) fails.push(what); };
const settle = (page, ms = 500) => page.waitForTimeout(ms);
const CARD = "section.card:has([data-lv-ideas])";
(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  const asked = [], failed = [];
  // The harness has no login (auth/me 404s), and the empty search is meant to be refused (400): any other failure counts.
  page.on("response", (r) => { const u = r.url(); if (r.status() >= 400 && !u.endsWith("/api/auth/me") && !(r.status() === 400 && u.includes("/api/keyword-ideas"))) failed.push(`${r.status()} ${u}`); });
  await page.route("**/api/keyword-ideas*", (route) => {
    asked.push(Object.fromEntries(new URL(route.request().url()).searchParams));
    route.fulfill({ json: { ideas: ["abonnement", "Abonnement Café", "abonnement netflix", "abonnement free", "abonnement canal+"] } });
  });
  const search = async (words) => {
    await page.fill("[data-lv-ideas] [name=f_q]", words);
    await page.click("[data-lv-ideas] button[type=submit]");
    await page.waitForSelector(".lv-ideas-bar"); await settle(page, 300);
  };
  const rowText = (word) => page.locator(`${CARD} .rows li`, { has: page.locator(".t", { hasText: new RegExp(`^${word}$`) }) }).first().innerText();

  await page.goto(`${BASE}#keywords?site=site-one.example`);
  await page.waitForSelector("[data-lv-ideas]", { timeout: 15000 }); await settle(page);
  check(await page.inputValue("[data-lv-ideas] [name=f_country]") === "FR", "country starts on the one the site's keywords use most");
  check(/use most/.test(await page.innerText(CARD)), "the card says where that country comes from");

  await page.selectOption("[data-lv-ideas] [name=f_language]", "fr");
  await search("abonnement");
  check(asked.at(-1)?.country === "FR" && asked.at(-1)?.language === "fr" && asked.at(-1)?.q === "abonnement", "the search sends the country and language");
  check(/5 ideas · France · French/.test(await page.innerText(".lv-ideas-bar")), "the results say which country and language they're for");
  check(/Already tracked/.test(await rowText("Abonnement Café")), "an idea already tracked says so, whatever its capitals");
  check(/Add all \(4\)/.test(await page.innerText(".lv-ideas-bar")), "Add all counts only the ideas not tracked yet");
  await page.locator(CARD).screenshot({ path: `${out}/ideas-01-results.png` });

  // Add one idea: the usual Add keywords panel, filled in
  await page.locator(`${CARD} .rows li`, { hasText: "abonnement netflix" }).getByRole("button").click();
  await page.waitForSelector("#kwr-add-form"); await settle(page);
  check(await page.inputValue("#kwr-add-text") === "abonnement netflix", "Add puts the idea in the panel");
  check(await page.inputValue("#kwr-add-site") === "site-one.example", "on the site picked");
  check(await page.inputValue("#kwr-add-country") === "FR" && await page.inputValue("#kwr-add-language") === "fr", "with the ideas' country and language");
  check(/these ideas/.test(await page.innerText("#kwr-add-form")), "the panel says where the country and language come from");
  await page.click("#kwr-add-save");
  await page.waitForFunction(() => [...document.querySelectorAll(".rows li")].some((li) => /abonnement netflix/.test(li.textContent) && /Already tracked/.test(li.textContent)), null, { timeout: 10000 }).catch(() => {});
  check(/Already tracked/.test(await rowText("abonnement netflix")), "once added, the idea shows as tracked");
  check(/Add all \(3\)/.test(await page.innerText(".lv-ideas-bar")), "and Add all counts one fewer");

  // Add all: every idea not tracked yet, one per line
  await page.click("[data-lv-idea-all]");
  await page.waitForSelector("#kwr-add-form"); await settle(page);
  check(await page.inputValue("#kwr-add-text") === "abonnement\nabonnement free\nabonnement canal+", "Add all puts in each idea not tracked yet");
  await page.click("[data-discard-panel]"); await settle(page, 400);

  // Each site keeps its own choice
  await page.selectOption("[data-lv-ideas] [name=f_country]", "ES");
  await search("abonnement");
  await page.goto(`${BASE}#keywords?site=site-three.example`); await page.reload();
  await page.waitForSelector("[data-lv-ideas]", { timeout: 15000 }); await settle(page);
  check(/No keywords yet/.test(await page.innerText("#page")) && await page.locator("[data-lv-ideas]").count() === 1, "a site with no keywords yet still shows Keyword ideas");
  check(await page.inputValue("[data-lv-ideas] [name=f_country]") === "", "and doesn't take another site's country");

  // An empty search is refused by the server, in words
  await page.unroute("**/api/keyword-ideas*");
  await page.fill("[data-lv-ideas] [name=f_q]", "   ");
  await page.click("[data-lv-ideas] button[type=submit]");
  await page.waitForSelector(`${CARD} p.error`, { timeout: 5000 }).catch(() => {});
  check(/Type a word or two first/.test(await page.innerText(CARD)), "an empty search says what to do");

  // French and phone width
  await page.route("**/api/keyword-ideas*", (route) => route.fulfill({ json: { ideas: ["abonnement", "abonnement free"] } }));
  await page.goto(`${BASE}#keywords?site=site-one.example`); await page.reload();
  await page.waitForSelector("[data-lv-ideas]", { timeout: 15000 }); await settle(page);
  await menu(page, "lang"); await settle(page);
  await page.setViewportSize({ width: 390, height: 844 }); await settle(page, 400);
  await page.selectOption("[data-lv-ideas] [name=f_language]", "fr");
  await search("abonnement");
  const fr = await page.innerText(CARD);
  check(/Idées de mots-clés/.test(fr) && /Trouver des idées/.test(fr) && /Tout ajouter/.test(fr) && /France · Français/.test(fr), "the card reads in French");
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(sideways <= 1, `no sideways scroll at 390 px (${sideways})`);
  await page.evaluate(() => document.querySelector(".lv-ideas-bar").scrollIntoView({ block: "center" })); await settle(page, 300);
  await page.locator(CARD).screenshot({ path: `${out}/ideas-02-phone-fr.png` });
  await page.setViewportSize({ width: 1440, height: 900 }); await settle(page, 400);
  await menu(page, "lang"); await settle(page); // back to English for the next run: the menu is in the side bar, hidden at phone width

  const real = [...problems.filter((p) => !/Failed to load resource/.test(p)), ...failed];
  note("problems:", JSON.stringify(real.slice(0, 12)));
  check(!real.length, "no console errors");
  await browser.close();
  note(fails.length ? `FAILED ${fails.length}` : "ALL OK");
  process.exit(fails.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
