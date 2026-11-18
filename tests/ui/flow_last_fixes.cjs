// The last fixes before the deploy (2026-11-18): the AI Overview watch says Check them (not Connect SerpApi) when SerpApi is
// connected, a Today drop names the rival change behind it, Overview's page-only view stays in the address, and Today's
// lead card label fits a phone. EN/FR, 1440 and 390. Made-up sites only.
//   DB_NAME_TEST=test_fix_ui_last_test .venv/bin/python tests/ui/app_server.py --port 8307 --slow 0   (then tests/ui/seed_ga4.py)
//   OUT=<folder> BASE=http://127.0.0.1:8307 SEOCC_REAL_DEFAULT=1 node tests/ui/flow_last_fixes.cjs
const fs = require("fs");
const { open } = require("./pw.cjs");
const OUT = process.env.OUT || "var/ui-last-fixes", BASE = (process.env.BASE || "http://127.0.0.1:8307").replace(/\/$/, "");
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, what, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${extra !== "" ? `  [${extra}]` : ""}`); if (!ok) fails.push(what); };

async function visit(page, hash, lang) {
  await page.goto(`${BASE}/?lang=${lang}`);
  await page.evaluate((l) => { localStorage.setItem("seocc2-range", JSON.stringify({ preset: "28d", compare: "prev" })); localStorage.setItem("seocc2-lang", l); }, lang);
  await page.goto(`${BASE}/?lang=${lang}${hash}`);
  await page.reload();
  await page.waitForSelector("#topbar");
  await page.waitForTimeout(3000);
}
const hashNow = (page) => page.evaluate(() => decodeURIComponent(location.hash));
const all = (page, sel, fn) => page.locator(sel).evaluateAll(fn);

(async () => {
  for (const [width, height, tag] of [[1440, 1000, "desk"], [390, 900, "phone"]]) {
    for (const lang of ["en", "fr"]) {
      const fr = lang === "fr", name = `${tag} ${lang}`;
      const { browser, page, problems } = await open({ width, height });
      page.setDefaultTimeout(20000);
      // The harness runs without sign-in: /api/auth/me answers 404 on every screen, which isn't these screens' doing.
      const failed = [];
      page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/auth/me")) failed.push(`${r.status()} ${r.url().replace(BASE, "")}`); });

      // ---- 1: AI Overview watch, SerpApi connected: how many are not checked yet, and Check them ----
      await visit(page, "#competitors/ai?site=site-one.example", lang);
      await page.waitForSelector(".ca-note-line", { timeout: 30000 }).catch(() => {});
      const note = ((await page.textContent(".ca-note-line").catch(() => "")) || "").replace(/\s+/g, " ").trim();
      check(!(await page.$("[data-ca-connect]")), `${name}: no Connect SerpApi while SerpApi is connected`);
      check(fr ? /Pas encore contrôlés : \d+ mots-clés/.test(note) : /Not checked yet: \d+ keywords/.test(note), `${name}: says how many keywords aren't checked yet`, note);
      check(Boolean(await page.$("[data-ca-check]")), `${name}: offers Check them`);
      await page.locator(".ca-note-line").screenshot({ path: `${OUT}/ai-watch-note-${tag}-${lang}.png` }).catch(() => {});
      await page.screenshot({ path: `${OUT}/ai-watch-${tag}-${lang}.png` });
      const unchecked = Number((note.match(/(\d+)/) || [])[1] || 0);
      if (await page.$("[data-ca-check]")) {
        await page.click("[data-ca-check]");
        await page.waitForSelector("#dlg[open] #kwr-cost, #dlg[open] #kwr-recent", { timeout: 15000 }).catch(() => {});
        // The harness's SerpApi looked at these keywords within the last 12 hours without reading an overview: the dialog
        // leaves them out and offers "Refresh them too", as it does for any keyword just checked.
        if (!(await page.$("#dlg #kwr-cost")) && (await page.$("#dlg #kwr-recent"))) {
          await page.screenshot({ path: `${OUT}/ai-watch-check-dialog-recent-${tag}-${lang}.png` });
          await page.check("#dlg #kwr-recent");
          await page.waitForSelector("#dlg[open] #kwr-cost", { timeout: 15000 }).catch(() => {});
        }
        const dlg = ((await page.textContent("#dlg").catch(() => "")) || "").replace(/\s+/g, " ");
        const picked = await all(page, "#dlg [data-kwr-tool]:checked", (boxes) => boxes.map((b) => b.dataset.kwrTool)).catch(() => []);
        check(dlg.includes(String(unchecked)) && picked.join() === "SerpApi", `${name}: Check them opens the Refresh dialog for those ${unchecked} keywords with SerpApi`, picked.join());
        check(Boolean(await page.$("#dlg #kwr-cost")), `${name}: the dialog shows the cost before anything runs`);
        await page.locator("#dlg").screenshot({ path: `${OUT}/ai-watch-check-dialog-${tag}-${lang}.png` });
        if (tag === "desk" && lang === "en") {
          await page.click("#kwr-confirm");
          await page.waitForSelector("#tray .kwr-run", { timeout: 10000 }).catch(() => {});
          check(Boolean(await page.$("#tray .kwr-run")), `${name}: Confirm starts the check and the tray follows it`);
          await page.waitForFunction(() => !document.querySelector("#tray .kwr-run .spin"), null, { timeout: 90000 }).catch(() => {});
          await page.waitForTimeout(2000);
          check(Boolean(await page.$(".ca-note-line")), `${name}: the watch is drawn again when the check ends`);
          await page.screenshot({ path: `${OUT}/ai-watch-after-check-${tag}-${lang}.png` });
        } else {
          await page.keyboard.press("Escape");
        }
      }
      // With no tool that sees AI Overviews connected, it still asks to connect one (the server's answer, changed here).
      await page.route(/\/api\/ai-watch/, async (route) => {
        const res = await route.fetch(); const body = await res.json();
        body.summary.ai_tools = [];
        await route.fulfill({ response: res, json: body });
      });
      await visit(page, "#competitors/ai?site=site-one.example", lang);
      await page.waitForSelector(".ca-note-line", { timeout: 30000 }).catch(() => {});
      check(Boolean(await page.$("[data-ca-connect]")) && !(await page.$("[data-ca-check]")), `${name}: with no such tool, Connect SerpApi`);
      await page.unroute(/\/api\/ai-watch/);

      // ---- 2: a Today drop names the rival change behind it ----
      await visit(page, "#today?site=site-one.example", lang);
      await page.waitForSelector(".today-num", { timeout: 30000 }).catch(() => {});
      const lines = await all(page, ".today-rival", (els) => els.map((el) => el.textContent.replace(/\s+/g, " ").trim()));
      const want = fr ? /^Un concurrent a changé \/subscription (pendant la baisse|\d+ jours? avant)$/ : /^Rival changed \/subscription (during the drop|\d+ days? before)$/;
      check(lines.length >= 1 && lines.every((l) => want.test(l)), `${name}: drop rows say which rival page changed`, lines.join(" | "));
      const perRow = await all(page, ".rows > li", (els) => els.map((li) => li.querySelectorAll(".today-rival").length));
      check(perRow.every((n) => n <= 1), `${name}: at most one rival line per row`);
      check(lines.length > 0 && (await all(page, ".today-rival", (els) => els.every((el) => el.querySelector("img, svg, .site-logo, .logo-text")))), `${name}: each says it with the rival's logo`);
      check(await all(page, ".today-rival", (els) => els.every((el) => el.scrollWidth <= el.clientWidth + 1)), `${name}: the line fits its row`);
      const firstDrop = page.locator("li:has(.today-rival)").first();
      if (await firstDrop.count()) await firstDrop.screenshot({ path: `${OUT}/today-rival-row-${tag}-${lang}.png` });
      await page.screenshot({ path: `${OUT}/today-${tag}-${lang}.png`, fullPage: true });

      // ---- 4: the number cards' labels fit, the lead one too ----
      const labels = await all(page, ".today-num .lab, .today-num .card-label, .today-num .num-card-label", (els) => els.map((el) => ({ text: el.textContent.trim(), cut: el.scrollWidth > el.clientWidth + 1 })));
      check(labels.length >= 3 && labels.every((l) => !l.cut), `${name}: no number card label is cut`, labels.map((l) => `${l.text}${l.cut ? " (cut)" : ""}`).join(" | "));
      // Sites that picked their lead events beside sites that didn't: the first card is the mixed total, with the long name.
      // The harness's sites are all one kind, so the answer is changed here to say "mixed".
      await page.route(/\/api\/today/, async (route) => {
        const res = await route.fetch(); const body = await res.json();
        if (body.results?.leads) body.results.leads.kind = "mixed";
        await route.fulfill({ response: res, json: body });
      });
      await visit(page, "#today?site=site-one.example", lang);
      await page.waitForSelector(".today-num", { timeout: 30000 }).catch(() => {});
      const mixed = await all(page, ".today-num .ncard-name", (els) => els.map((el) => ({ text: el.textContent.trim(), cut: el.scrollWidth > el.clientWidth + 1, tip: el.closest(".ncard")?.dataset.tip || "" })));
      check(mixed[0] && (fr ? mixed[0].text === "Leads + évts clés" && /Leads et événements clés\./.test(mixed[0].tip) : mixed[0].text === "Leads + key events" && /Leads and key events\./.test(mixed[0].tip)), `${name}: the mixed lead card has a short name, the full one in its tip`, mixed[0] ? `${mixed[0].text} / ${mixed[0].tip.split("\n")[0]}` : "none");
      check(mixed.length >= 3 && mixed.every((l) => !l.cut), `${name}: with the mixed total no card label is cut`, mixed.map((l) => `${l.text}${l.cut ? " (cut)" : ""}`).join(" | "));
      const cards = page.locator(".today-nums").first();
      if (await cards.count()) await cards.screenshot({ path: `${OUT}/today-cards-${tag}-${lang}.png` });
      await page.unroute(/\/api\/today/);
      await visit(page, "#today?site=site-one.example", lang);

      if (lines.length && tag === "desk") {
        await page.click(".today-rival-path");
        await page.waitForTimeout(3000);
        const at = await page.evaluate(() => ({ route: window.UI.state.route, tab: window.COMP?.currentTab?.()?.id }));
        check(at.route === "competitors" && at.tab === "pairs", `${name}: its path opens Page vs page`, JSON.stringify(at));
        await page.screenshot({ path: `${OUT}/today-rival-opens-pair-${tag}-${lang}.png` });
      }

      // ---- 3: See page stays in the address: reload, a shared link, back and forward, Show the whole site ----
      await visit(page, "#today?site=site-one.example", lang);
      await page.waitForSelector("[data-today-page]", { timeout: 30000 }).catch(() => {});
      const seePage = await page.$("[data-today-page]");
      check(Boolean(seePage), `${name}: a drop has See page`);
      if (seePage) {
        await seePage.click();
        await page.waitForSelector(".ov-only-page", { timeout: 20000 }).catch(() => {});
        let hash = await hashNow(page);
        check(/[?&]only=1/.test(hash) && /tab=page/.test(hash), `${name}: the page-only view is in the address`, hash);
        await page.reload(); await page.waitForSelector("#topbar"); await page.waitForTimeout(3500);
        check(Boolean(await page.$(".ov-only-page")), `${name}: a reload keeps it`);
        await page.screenshot({ path: `${OUT}/overview-only-page-reloaded-${tag}-${lang}.png` });
        const shared = await page.evaluate(() => location.href);
        const other = await browser.newContext({ viewport: { width, height } });
        const p2 = await other.newPage();
        await p2.goto(shared); await p2.waitForSelector("#topbar"); await p2.waitForTimeout(3500);
        check(Boolean(await p2.$(".ov-only-page")), `${name}: the same link in another browser opens it`);
        await other.close();
        // Back and forward: See page was a step from Today, so Back goes to Today and Forward reopens the page alone.
        await page.goBack(); await page.waitForTimeout(3000);
        check(/^#today/.test(await hashNow(page)), `${name}: Back goes to Today`, await hashNow(page));
        await page.goForward(); await page.waitForTimeout(3500);
        check(Boolean(await page.$(".ov-only-page")) && /[?&]only=1/.test(await hashNow(page)), `${name}: Forward reopens the page alone`);
        // Show the whole site: a change inside Overview, so it replaces the address like its other filters.
        await page.click("[data-ov-only-clear]");
        await page.waitForTimeout(2500);
        hash = await hashNow(page);
        check(!/[?&]only=1/.test(hash) && !(await page.$(".ov-only-page")), `${name}: Show the whole site clears it from the address`, hash);
        await page.reload(); await page.waitForSelector("#topbar"); await page.waitForTimeout(3500);
        check(!(await page.$(".ov-only-page")), `${name}: and a reload stays on the whole site`);
      }

      const errors = problems.filter((p) => !p.includes("Failed to load resource")); // a 404 is in failed requests below, by address
      check(!errors.length, `${name}: no script errors`, errors.slice(0, 3).join(" | "));
      check(!failed.length, `${name}: no failed requests`, failed.slice(0, 3).join(" | "));
      await browser.close();
    }
  }
  console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASSED");
  process.exit(fails.length ? 1 : 0);
})();
