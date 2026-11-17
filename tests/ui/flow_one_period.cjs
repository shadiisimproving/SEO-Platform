// One period rule (expert review 2026-11-17): the head prints only the days really compared, says why there is no
// comparison, Today's cards say their own days, long charts end on a whole week, chart dates sit under their points.
//   DB_NAME_TEST=test_fix_ui_periods_test .venv/bin/python tests/ui/app_server.py --port 8291
//   OUT=<folder> BASE=http://127.0.0.1:8291 SEOCC_REAL_DEFAULT=1 node tests/ui/flow_one_period.cjs
const fs = require("fs");
const { open } = require("./pw.cjs");
const OUT = process.env.OUT || "var/ui-one-period", BASE = (process.env.BASE || "http://127.0.0.1:8291").replace(/\/$/, "");
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, what, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${extra !== "" ? `  [${extra}]` : ""}`); if (!ok) fails.push(what); };
const settle = (page, ms = 1200) => page.waitForTimeout(ms);
const json = (page, url) => page.evaluate(async (u) => (await fetch(u)).json(), url);

async function visit(page, hash, range, lang) {
  await page.evaluate(([r, l]) => { localStorage.setItem("seocc2-range", JSON.stringify(r)); localStorage.setItem("seocc2-lang", l); }, [range, lang]);
  await page.goto(`${BASE}/?lang=${lang}${hash}`);
  await page.reload();
  await page.waitForSelector("#topbar");
  await settle(page, 2200);
  return (await page.textContent("#topbar .head-line").catch(() => "")) || "";
}

(async () => {
  for (const [width, height, tag] of [[1440, 1000, "desk"], [390, 900, "phone"]]) {
    for (const lang of ["en", "fr"]) {
      const { browser, page, problems } = await open({ width, height, url: `${BASE}/` });
      page.setDefaultTimeout(15000);
      const name = (n) => `${OUT}/${n}-${tag}-${lang}.png`;
      const fr = lang === "fr";
      const short = (iso) => new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", { day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00`)).replace(/\.$/, "");

      // Overview, site one, 28 days: the head's "vs" dates are the server's own.
      let head = await visit(page, "#overview?site=site-one.example", { preset: "28d", compare: "prev" }, lang);
      const api = await json(page, "/api/search/overview?site_id=1&range=28d&compare=prev");
      check(head.includes(short(api.compare_from)), `${tag} ${lang}: Overview head prints the server's comparison start`, `${head} | ${api.compare_from}`);
      // The demo stores pages and searches only from 1 Nov: no gains are made up, and the table says why.
      const pagesTab = await page.$('[data-ov-tab="page"]');
      if (pagesTab) { await pagesTab.click(); await settle(page, 1500); }
      const note = (await page.textContent(".ov-tabs-card").catch(() => "")) || "";
      check(fr ? /trop tôt pour comparer/.test(note) : /too soon to compare/.test(note), `${tag} ${lang}: page table says it is too soon to compare`);
      await page.screenshot({ path: name("01-overview-28d"), fullPage: false });

      // 16 months: no comparison made, said in words in the head.
      head = await visit(page, "#overview", { preset: "16m", compare: "prev" }, lang);
      check(fr ? /sans comparaison : Google garde 16 mois/.test(head) : /no comparison: Google keeps 16 months/.test(head), `${tag} ${lang}: 16 months says Google keeps 16 months`, head);
      check(!/vs |par rapport au/.test(head), `${tag} ${lang}: 16 months prints no "vs" dates`, head);
      await page.screenshot({ path: name("02-overview-16m"), fullPage: false });

      // 6 months: weeks end on the last day, every drawn week is whole, the last date sits under the last point.
      await visit(page, "#overview?site=site-one.example", { preset: "6m", compare: "prev" }, lang);
      const weeks = await page.evaluate(() => (window.OV?.chart?.pts || []).map((p) => p.days));
      check(weeks.length > 5 && weeks.every((d) => d === 7), `${tag} ${lang}: 6-month chart draws whole weeks only`, `${weeks.length} weeks`);
      const ticks = await page.$$eval(".ov-chart .lv-tick", (els) => els.map((e) => [e.textContent, e.style.left]));
      check(ticks.length >= 3 && /^100(\.0+)?%$/.test(ticks[ticks.length - 1][1]), `${tag} ${lang}: last date under the last point`, JSON.stringify(ticks));
      await page.screenshot({ path: name("03-overview-6m"), fullPage: true });

      // vs last year: 52 weeks back, as the server compares.
      head = await visit(page, "#overview?site=site-one.example", { preset: "28d", compare: "yoy" }, lang);
      const yoy = await json(page, "/api/search/overview?site_id=1&range=28d&compare=yoy");
      check(yoy.compare_from ? head.includes(short(yoy.compare_from)) : !/vs |par rapport au/.test(head), `${tag} ${lang}: last year head matches the server`, `${head} | ${yoy.compare_from} ${yoy.compare_unavailable}`);
      await page.screenshot({ path: name("04-overview-yoy"), fullPage: false });

      // Today: head dates are the server's; each card says its own days when GA4 and Search Console end apart.
      head = await visit(page, "#today?site=site-one.example", { preset: "28d", compare: "prev" }, lang);
      const today = await json(page, "/api/today?site_id=1&range=28d&compare=prev");
      const w = today.results.window;
      check(head.includes(short(w.from)), `${tag} ${lang}: Today head starts on the server's day`, `${head} | ${w.from}`);
      const cards = (await page.textContent(".today-nums").catch(() => "")) || "";
      if (w.ga4 && w.ga4.to !== w.to) check(cards.includes(short(w.ga4.to)) && cards.includes(short(w.to)), `${tag} ${lang}: cards say GA4's and Search Console's own days`, cards.slice(0, 240));
      await page.screenshot({ path: name("05-today"), fullPage: true });

      // AI search: weekly chart, every date under its point.
      await visit(page, "#ai?site=site-one.example", { preset: "28d", compare: "prev" }, lang);
      const aiTicks = await page.$$eval(".lv-tick", (els) => els.map((e) => e.style.left));
      check(aiTicks.length > 0 && /^100(\.0+)?%$/.test(aiTicks[aiTicks.length - 1]), `${tag} ${lang}: AI chart's last date under the last point`, aiTicks.join(" "));
      await page.screenshot({ path: name("06-ai"), fullPage: true });

      // Pages and Content: Search Console clicks on the shared period.
      await visit(page, "#pages?site=site-one.example", { preset: "28d", compare: "prev" }, lang);
      const listed = await json(page, "/api/site-pages?site_id=1&range=28d&compare=prev&from=2026-10-20&to=2026-11-16");
      check(listed.gsc_window.to === w.to && listed.gsc_window.from === w.from, `${tag} ${lang}: Pages has Today's days`, `${listed.gsc_window.from}–${listed.gsc_window.to} vs ${w.from}–${w.to}`);
      await page.screenshot({ path: name("07-pages"), fullPage: false });
      await visit(page, "#content?site=site-one.example", { preset: "28d", compare: "prev" }, lang);
      await page.screenshot({ path: name("08-content"), fullPage: false });

      const real = problems.filter((p) => !/404/.test(p)); // the harness has no sign-in: /api/auth/me answers 404
      check(!real.length, `${tag} ${lang}: no page errors`, real.slice(0, 3).join(" | "));
      await browser.close();
    }
  }
  console.log(fails.length ? `\n${fails.length} failed` : "\nall ok");
  process.exit(fails.length ? 1 : 0);
})();
