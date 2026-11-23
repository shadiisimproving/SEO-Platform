// Countries and devices (expert review 2026-11-17, search-console 3.1): until their own data reaches back, the Overview
// tables make no comparison and say where they start; once the backfill is done they add up to the site's total.
//   DB_NAME_TEST=test_fix_ui_dims_test .venv/bin/python tests/ui/app_server.py --port 8298 --empty
//   DB_NAME_TEST=test_fix_ui_dims_test .venv/bin/python tests/ui/seed_gsc_dims.py before   (then STAGE=before below)
//   DB_NAME_TEST=test_fix_ui_dims_test .venv/bin/python tests/ui/seed_gsc_dims.py after    (then STAGE=after below)
//   STAGE=before|after OUT=<folder> BASE=http://127.0.0.1:8298 SEOCC_REAL_DEFAULT=1 node tests/ui/flow_gsc_dims.cjs
const fs = require("fs");
const { open } = require("./pw.cjs");
const OUT = process.env.OUT || "var/ui-gsc-dims", BASE = (process.env.BASE || "http://127.0.0.1:8298").replace(/\/$/, "");
const STAGE = process.env.STAGE || "before";
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
}

(async () => {
  for (const [width, height, tag] of [[1440, 1000, "desk"], [390, 900, "phone"]]) {
    for (const lang of ["en", "fr"]) {
      const { browser, page, problems } = await open({ width, height, url: `${BASE}/` });
      page.setDefaultTimeout(15000);
      const name = (n) => `${OUT}/${STAGE}-${n}-${tag}-${lang}.png`;
      const fr = lang === "fr";
      for (const [range, dim] of [["28d", "country"], ["16m", "country"], ["28d", "device"]]) {
        await visit(page, "#overview", { preset: range, compare: "prev" }, lang);
        await page.click(`[data-ov-tab="${dim}"]`); await settle(page, 1800);
        const card = page.locator(".ov-tabs-card");
        await card.scrollIntoViewIfNeeded();
        const words = (await card.textContent()) || "";
        const api = await json(page, `/api/search/overview?site_id=1&range=${range}&compare=prev`);
        const rows = await json(page, `/api/search/breakdown?site_id=1&range=${range}&compare=prev&dim=${dim}&show=all`);
        const sum = (rows.rows || []).reduce((n, r) => n + r.clicks, 0);
        const total = api.now?.clicks ?? api.totals?.clicks ?? api.clicks;
        const starts = api.rows_from?.[dim];
        const reaches = starts && starts <= (api.history_from && api.history_from > api.from ? api.history_from : api.from);
        if (STAGE === "before") {
          check(!api.rows_compare?.[dim], `${tag} ${lang} ${range} ${dim}: no comparison`);
          // The period starts before the table: "days before aren't counted" (no comparison either way).
          const want = fr ? /commencent le .* les jours d'avant ne sont pas comptés/ : /starts on .*days before aren't counted/;
          check(want.test(words), `${tag} ${lang} ${range} ${dim}: says where its data starts`, words.slice(0, 160));
          check(!/\+\d/.test((await page.locator(".ov-tabs-card table").first().textContent().catch(() => "")) || ""), `${tag} ${lang} ${range} ${dim}: no gains shown`);
        } else {
          check(reaches, `${tag} ${lang} ${range} ${dim}: data reaches back to the period`, `${starts} vs ${api.from}`);
          if (total !== undefined) check(sum === total, `${tag} ${lang} ${range} ${dim}: rows add up to the site's total`, `${sum} vs ${total}`);
          check(!/too soon to compare|trop tôt pour comparer|aren't counted|ne sont pas comptés/.test(words), `${tag} ${lang} ${range} ${dim}: no "starts on" note`);
        }
        console.log(`     ${range} ${dim}: rows ${sum}, site ${total}, rows_from ${starts}`);
        await page.screenshot({ path: name(`overview-${range}-${dim}`), fullPage: false });
      }
      await visit(page, "#insights", { preset: "28d", compare: "prev" }, lang);
      const changed = await page.$('[data-in-tab="changed"]');
      if (changed) { await changed.click(); await settle(page, 1500); }
      // Simpler screens: a note with nothing to press sits behind the (i) beside the tabs.
      const info = await page.$(".in-tabs-i [data-tip]");
      if (info) { await info.hover(); await settle(page, 600); }
      const text = `${(await page.textContent("main").catch(() => "")) || ""} ${info ? await info.getAttribute("data-tip") : ""}`;
      if (STAGE === "before") check(fr ? /par pays et par appareil commencent le/.test(text) : /Country and device data start on/.test(text), `${tag} ${lang}: Insights says country and device data start late`);
      check(!/0 → \d+ clicks|0 → \d+ clics/.test(text), `${tag} ${lang}: no "0 before" country finding`);
      await page.screenshot({ path: name("insights-changed"), fullPage: false });
      const real = problems.filter((p) => !/status of 404/.test(p)); // the harness has no sign-in: /api/auth/me answers 404
      check(!real.length, `${tag} ${lang}: no page errors`, real.join(" | "));
      await browser.close();
    }
  }
  console.log(fails.length ? `${fails.length} FAILED` : "all ok");
  process.exit(fails.length ? 1 : 0);
})();
