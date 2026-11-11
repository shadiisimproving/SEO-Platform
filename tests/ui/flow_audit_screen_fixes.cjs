// The screen bugs from the 2026-11-05 audit, driven the way a person would hit them.
// Needs: DB_NAME_TEST=<idle test database> .venv/bin/python tests/ui/app_server.py --port 8240 --slow 0
const { open } = require("./pw.cjs");
const ROOT = process.argv[2] || "http://127.0.0.1:8240/";
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `: ${JSON.stringify(detail)}`}`); };
const wait = (page, ms) => page.waitForTimeout(ms);
const fresh = async (page, hash) => { await page.goto("about:blank"); await page.goto(`${ROOT}#${hash}`); await wait(page, 900); };
const realSites = (page) => page.evaluate(() => window.SITES.map((s) => ({ ui: s.id, real: s.realId, host: s.host })));
const pickInMenu = async (page, uiId) => { await page.click("#site-switch"); await page.click(`[data-pick-site="${uiId}"]`); };
const tableRows = (page) => page.evaluate(() => [...document.querySelectorAll("#main table tbody tr")].map((tr) => tr.textContent));
const MARK = "from-site-a";

/** A slow answer for one site, changed so it can be recognised if it reaches the screen. */
const slowAnswer = async (page, pattern, change, ms = 1200) => {
  let seen = 0;
  await page.route(pattern, async (route) => {
    const reply = await route.fetch();
    const body = await reply.json();
    change(body);
    seen += 1;
    await new Promise((done) => setTimeout(done, ms));
    await route.fulfill({ response: reply, json: body });
  });
  return () => seen;
};

(async () => {
  const { browser, page } = await open({ width: 1440, height: 1000 });

  await fresh(page, "today");
  const sites = await realSites(page);
  check("the test world has two sites", sites.length >= 2, sites);
  const [A, B] = sites;

  // ---- Today ---------------------------------------------------------------------------------------
  const today = await slowAnswer(page, new RegExp(`/api/today\\?(.*&)?site_id=${A.real}(&|$)`), (d) => { d.todo = [{ id: "x", severity: "crit", title: MARK, detail: "", host: A.host, kind: "x" }]; });
  await pickInMenu(page, A.ui);
  await wait(page, 100);
  await pickInMenu(page, B.ui);
  await wait(page, 1800);
  await page.evaluate(() => window.UI.render());
  check("Today: a slow answer for site A never shows under site B", today() > 0 && !(await page.textContent("#main")).includes(MARK), { asked: today() });
  await page.unrouteAll();

  // ---- Link gaps and Page vs page ----------------------------------------------------------------
  const race = async (tabId, pattern, change, name) => {
    await fresh(page, "competitors");
    const seen = await slowAnswer(page, pattern, change);
    await page.evaluate(([id, a]) => window.COMP.open(id, {}, window.COMP.sites.find((s) => s.host === a)?.id), [tabId, A.host]);
    await wait(page, 100);
    await page.evaluate(([id, b]) => window.COMP.open(id, {}, window.COMP.sites.find((s) => s.host === b)?.id), [tabId, B.host]);
    await wait(page, 1800);
    await page.evaluate(() => window.COMP.paint()); // any redraw that doesn't load again, such as a filter or a new logo
    await wait(page, 150);
    const text = await page.textContent("#comp-body");
    check(`${name}: a slow answer for site A never shows under site B`, seen() > 0 && !text.includes(MARK), { asked: seen() });
    await page.unrouteAll();
  };
  await race("gaps", new RegExp(`/api/link-gaps\\?site_id=${A.real}$`), (d) => {
    d.competitors = [{ id: 999, host: `${MARK}.example`, has_data: true }];
    (d.gaps || []).forEach((g) => { g.domain = `${MARK}.example`; });
  }, "Link gaps");
  await race("pairs", new RegExp(`/api/competitors\\?site_id=${A.real}$`), (d) => { d.competitors = [{ id: 999, host: `${MARK}.example` }]; }, "Page vs page");

  // ---- Health ---------------------------------------------------------------------------------------
  await fresh(page, "health");
  const hasSelect = await page.$("#ht-site");
  if (hasSelect) {
    const audits = await page.evaluate(async (a) => (await window.COMP.api("GET", `health/sites/${a}/audits`)).audits, A.real);
    if (audits.length) {
      const seen = await slowAnswer(page, /\/api\/health\/audits\/\d+$/, (d) => { if (d.checks[0]) d.checks[0].meaning = MARK; d.audit.host = MARK; });
      await page.selectOption("#ht-site", String(A.real));
      await wait(page, 100);
      await page.selectOption("#ht-site", String(B.real));
      await wait(page, 2800);
      check("Health: a slow answer for site A never shows under site B", seen() > 0 && !(await page.textContent("#main")).includes(MARK), { asked: seen() });
      await page.unrouteAll();
    } else check("Health: the test world has a health test to race", false);

    // Tests of 100, 30 and 100 pages: the server compares the newest with the first, and the screen must agree.
    const base = audits[0];
    if (base) {
      const make = (id, pages, score) => ({ ...base, id, status: "complete", score, pages_read: pages, pages_seen: pages, stopped_at_limit: false, created_at: `2026-10-0${id}T08:00:00Z` });
      const list = [make(3, 100, 70), make(2, 30, 90), make(1, 100, 80)];
      await page.route(new RegExp(`/api/health/sites/${A.real}/audits$`), (route) => route.fulfill({ json: { audits: list } }));
      await page.route(/\/api\/health\/audits\/\d+$/, (route) => route.fulfill({ json: { checks: [], site_problems: [], audit: { ...list[0], host: A.host }, previous_score: 80, previous_audit: list[2] } }));
      await fresh(page, "health");
      await page.selectOption("#ht-site", String(B.real));
      await wait(page, 300);
      await page.selectOption("#ht-site", String(A.real));
      await wait(page, 700);
      const text = await page.textContent("#main");
      const changeTip = async () => (await page.$$eval("#main .ht-change [data-tip]", (els) => els.map((e) => e.getAttribute("data-tip")).join(" "))) || "";
      check("Health: the card compares with the same test the alert used", text.includes("since last test") && !(await changeTip()).includes("can't be compared"), text.slice(0, 200));

      // The same list, but the server found nothing similar to compare with.
      await page.unroute(/\/api\/health\/audits\/\d+$/);
      await page.route(/\/api\/health\/audits\/\d+$/, (route) => route.fulfill({ json: { checks: [], site_problems: [], audit: { ...list[0], host: A.host }, previous_score: null, previous_audit: null } }));
      await page.selectOption("#ht-site", String(B.real));
      await wait(page, 300);
      await page.selectOption("#ht-site", String(A.real));
      await wait(page, 700);
      check("Health: no similar test says so, rather than calling it the first", (await page.textContent("#main")).includes("Not compared") && (await changeTip()).includes("can't be compared"));
      await page.unrouteAll();
    }
  } else check("Health: the site picker is on screen", false);

  // ---- Settings -------------------------------------------------------------------------------------
  await page.route(/\/api\/sources$/, (route) => route.fulfill({ status: 500, json: { error: "Boom" } }));
  await fresh(page, "settings");
  let text = await page.textContent("#main");
  check("Settings: a failed load shows no sample status", !/c41d|e07a|site-one|site-two|41 h/.test(text), text.slice(0, 300));
  check("Settings: a failed load says so", text.includes("That didn't load"), text.slice(0, 200));
  await page.unrouteAll();
  await fresh(page, "settings");
  // The AI card lists the real sites by name (site-one.example is a real site here), so it is left out of the sample check.
  text = await page.evaluate(() => { const m = document.querySelector("#main").cloneNode(true); m.querySelector("#ai-settings")?.remove(); return m.textContent; });
  check("Settings: a good load still lists the connections", text.includes("Google") && text.includes("Bing Webmaster") && !/c41d|e07a|site-one/.test(text), text.slice(0, 200));

  // A site failing partway through a save must not store the same Google key twice.
  let posts = 0, failed = 0;
  await page.route(/\/api\/google-connections$/, async (route) => { if (route.request().method() === "POST") { posts += 1; await route.fulfill({ json: { id: 77, label: "Robot", kind: "robot", last4: "abcd" } }); } else await route.continue(); });
  await page.route(/\/api\/sites\/\d+\/sources\/(gsc|ga4)$/, async (route) => { failed += 1; if (failed === 1) await route.fulfill({ status: 500, json: { error: "Boom" } }); else await route.fulfill({ json: { ok: true } }); });
  await page.click('[data-conn="google"]');
  await wait(page, 300);
  await page.check('input[name="google-type"][value="robot"]').catch(() => {});
  await wait(page, 100);
  if (await page.$("#conn-json")) {
    await page.fill("#conn-json", JSON.stringify({ type: "service_account", client_email: "robot@x.iam.gserviceaccount.com", private_key: "k", token_uri: "https://oauth2.googleapis.com/token" }));
    await page.evaluate(() => { document.querySelectorAll('[data-prop="sc"]').forEach((s) => { const o = document.createElement("option"); o.value = "sc-domain:test.example"; o.textContent = "x"; s.append(o); s.value = o.value; }); });
    await page.click("#conn-save");
    await wait(page, 500);
    await page.click("#conn-save");
    await wait(page, 500);
    check("Google: saving again after a partial failure doesn't store the key twice", posts === 1 && failed >= 1, { posts, failed });
  } else check("Google: the key box is on screen", false);
  await page.unrouteAll();

  // ---- Page vs page: one failed look doesn't end the watching ---------------------------------------
  const pairs = await page.evaluate(async (a) => (await window.COMP.api("GET", `page-pairs?site_id=${a}`)).pairs, A.real);
  if (pairs.length) {
    const waiting = pairs.map((p) => ({ ...p, my_state: "not_read" }));
    let looks = 0;
    await page.route(new RegExp(`/api/page-pairs\\?site_id=${A.real}$`), async (route) => {
      looks += 1;
      if (looks === 2) await route.fulfill({ status: 502, json: { error: "Restarting" } });
      else await route.fulfill({ json: { pairs: waiting } });
    });
    await fresh(page, "competitors");
    await page.evaluate((a) => window.COMP.open("pairs", {}, window.COMP.sites.find((s) => s.host === a)?.id), A.host);
    await wait(page, 7000);
    check("Page vs page: it keeps watching after one failed look", looks >= 4, { looks });
    await page.unrouteAll();
  } else check("Page vs page: the test world has a pair to watch", false);

  // ---- All sites: which site a page belongs to --------------------------------------------------------
  const row = (host, leads) => ({ host, path: "/contact/", category: "Other pages", sessions: 30, leads, clicks: 2, impressions: 9, position: 3, ai: null, rate: 0.1 });
  const contentAnswer = { ga4: { state: "ok" }, gsc: { state: "ok" }, state: "ok", pages: [row(A.host, 1), row(B.host, 2)], total_pages: 2, social: [], hid_rows: false };
  await page.route(/\/api\/metrics\/content/, (route) => route.fulfill({ json: contentAnswer }));
  await fresh(page, "content");
  await pickInMenu(page, "all");
  await wait(page, 600);
  const rows = await tableRows(page);
  check("Content on All sites: each row names its site", rows.some((r) => r.includes(A.host)) && rows.some((r) => r.includes(B.host)), rows.slice(0, 4));
  await pickInMenu(page, A.ui);
  await wait(page, 600);
  const one = await tableRows(page);
  check("Content on one site: no site name in the rows", one.length > 0 && !one.some((r) => r.includes(A.host) || r.includes(B.host)), one.slice(0, 4));
  await page.unrouteAll();

  // ---- Tasks ------------------------------------------------------------------------------------------
  await fresh(page, "tasks");
  await page.evaluate(async () => {
    const made = await window.COMP.api("POST", "tasks", { title: "Audit test one" });
    await window.COMP.api("POST", "tasks", { title: "Audit test two" });
    await window.COMP.api("PATCH", `tasks/${(made.task || made).id}`, { status: "done" });
  });
  await fresh(page, "tasks");
  await page.route(/\/api\/tasks$/, (route) => (route.request().method() === "GET" ? route.fulfill({ status: 502, json: { error: "Waking up" } }) : route.continue()));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await wait(page, 500);
  await page.evaluate(() => window.UI.render());
  await wait(page, 200);
  check("Tasks: a failed background refresh keeps the board", !(await page.textContent("#main")).includes("That didn't load"));
  await page.unrouteAll();

  await fresh(page, "tasks");
  await page.click('[data-task-view="table"]');
  await wait(page, 200);
  const statuses = await page.evaluate(() => [...document.querySelectorAll("#tk-status option")].map((o) => o.value).filter(Boolean));
  let totalsAgree = statuses.length > 0;
  for (const value of statuses) {
    await page.selectOption("#tk-status", value);
    await wait(page, 150);
    const shown = await tableRows(page);
    const total = Number((await page.textContent("#tk-total")).match(/\d+/)?.[0] ?? -1);
    const rowsNow = shown.length === 1 && !(await page.$("#main table tbody tr [data-task-open], #main table tbody tr[data-task-open]")) ? 0 : shown.length;
    if (total !== rowsNow) { totalsAgree = false; console.log("   ", value, { total, rowsNow }); }
  }
  check("Tasks: the table's total matches its rows under a status filter", totalsAgree, statuses);

  // ---- Uptime: a failed check says so -------------------------------------------------------------------
  await fresh(page, "health");
  await page.click('[data-health-tab="uptime"]');
  await wait(page, 700);
  await page.route(/\/api\/uptime\/sites\/\d+\/check$/, (route) => route.fulfill({ status: 500, json: { error: "Boom" } }));
  const checkButton = await page.$("[data-up-check]");
  if (checkButton) {
    await checkButton.click();
    await wait(page, 300);
    const icon = await page.evaluate(() => document.querySelector("#toasts .toast")?.innerHTML || "");
    check("Uptime: a failed check shows the error icon", /crit/.test(icon), icon.slice(0, 160));
  } else check("Uptime: the Check now button is on screen", false);
  await page.unrouteAll();

  // ---- Adding a site: a double click sends one request ------------------------------------------------
  await fresh(page, "today");
  let adds = 0;
  await page.route(/\/api\/sites$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    adds += 1;
    await new Promise((done) => setTimeout(done, 300));
    await route.fulfill({ status: 409, json: { error: "already added" } });
  });
  await page.evaluate(() => { const open = document.createElement("button"); open.id = "site-add"; open.hidden = true; document.body.append(open); open.click(); open.remove(); });
  await wait(page, 300);
  await page.fill("#site-address", "double-click.example");
  await page.evaluate(() => { const b = document.querySelector("#site-save"); b.click(); b.click(); });
  await wait(page, 900);
  check("Add a site: a double click sends one request", adds === 1, { adds });
  await page.unrouteAll();

  await browser.close();
  console.log(`\n${results.filter(Boolean).length} of ${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(2); });
