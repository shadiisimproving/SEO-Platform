// By hand: a task card says what the task is linked to in plain words under the title ("Page  /freezones/"), main kind first.
//   DB_NAME_TEST=test_pagesflow_test .venv/bin/python tests/ui/app_server.py --port 8291 --login
// Usage: node tests/ui/flow_task_card_linked.cjs [base url] [folder for screenshots]
const fs = require("fs");
const { open } = require("./pw.cjs");
const base = process.argv[2] || "http://127.0.0.1:8291/";
const shots = process.argv[3] || "var/ui-task-card-linked";
fs.mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`); };
const stamp = Date.now().toString(36);

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 900 });
  page.setDefaultTimeout(8000);
  const settle = (ms = 400) => page.waitForTimeout(ms);
  await page.goto(`${base}login`);
  await page.fill("#email", "admin@example.com"); await page.fill("#password", "demo-password-1"); await page.click("#go");
  await settle(2500);
  // Tasks opens By month since 2026-11-20 (the bucket board); the cards this flow reads are on the Board view.
  await page.goto(`${base}?a=1#tasks?site=site-one.example&view=kanban`);
  await page.waitForSelector(".topbar [data-task-new]");
  const made = await page.evaluate(async (stamp) => {
    const sites = await COMP.api("GET", "links/sites");
    const site = (sites.sites || sites).find((s) => JSON.stringify(s).includes("site-one"));
    // Earlier runs of this flow leave nothing behind.
    const before = await COMP.api("GET", "tasks");
    for (const task of (before.tasks || before).filter((task) => /^(Linking: anchor from freezones|Many links|General|Five kinds|Long names) [a-z0-9]{6,10}$/.test(task.title))) await COMP.api("DELETE", `tasks/${task.id}`);
    const mk = (body) => COMP.api("POST", "tasks", { site_id: site.id, ...body }).then((task) => task.id);
    const one = await mk({ title: `Linking: anchor from freezones ${stamp}`, kind: "Content", due: "2026-11-28",
      pages: ["https://site-one.example/freezones/"], keywords: ["coffee beans"],
      about: { main: "note", items: [{ kind: "note", ref: "1", label: "Quick answer on top of the page" }] } });
    const many = await mk({ title: `Many links ${stamp}`,
      pages: ["/a/", "/b/", "/c/"], keywords: ["one", "two"], about: { main: "keyword", items: [] } });
    const none = await mk({ title: `General ${stamp}`, about: { main: "general", items: [] } });
    // A competitor and a backlink must be real ones of the demo site; a site without one gets a link to get instead.
    const opts = await COMP.api("GET", `tasks/options?site_id=${site.id}`);
    const rival = opts.competitors?.[0], link = opts.backlinks?.[0];
    const kinds = await mk({ title: `Five kinds ${stamp}`, kind: "Links", priority: "high", pages: ["/pricing/"], keywords: ["espresso machine"],
      about: { main: rival ? "competitor" : "domain", items: [...(rival ? [{ kind: "competitor", ref: String(rival.id), label: rival.host }] : []), ...(link ? [{ kind: "backlink", ref: String(link.id), label: link.domain }] : []), { kind: "domain", ref: "news.example", label: "news.example" }, { kind: "technical", ref: "speed:/pricing/", label: "Slow page: /pricing/" }] } });
    const long = await mk({ title: `Long names ${stamp}`, kind: "Technical", pages: ["/guides/how-to-choose-a-coffee-grinder-for-espresso-at-home/"],
      keywords: ["best budget coffee grinder for espresso at home 2026"], about: { main: "page", items: [{ kind: "technical", ref: "speed:/guides/how-to-choose-a-coffee-grinder-for-espresso-at-home/", label: "Page takes more than 4 seconds to load on phones" }] } });
    return { one, many, none, kinds, long, rival: rival?.host || "" };
  }, stamp);
  await page.reload(); await page.waitForSelector(`[data-task-card="${made.one}"]`); await settle(800);
  const card = (id) => page.locator(`[data-task-card="${id}"]`);
  const flat = (text) => text.replace(/\s*\n\s*/g, " | ");
  const rows = (id) => card(id).locator(".ta-pill").evaluateAll((els) => els.map((el) => el.classList.contains("ta-pill-more") ? el.innerText.trim() : `${el.querySelector(".ta-pill-k").innerText.trim()}: ${el.querySelector(".ta-name").innerText.trim()}`));
  // "+N" sits on the last pill's line, and every pill's words pass AA (4.5:1) on the pill's own fill.
  const moreBeside = () => page.evaluate(() => [...document.querySelectorAll(".ta-pill-more")].every((more) => Math.abs(more.getBoundingClientRect().top - more.previousElementSibling.getBoundingClientRect().top) < 2));
  const worstContrast = () => page.evaluate(() => {
    const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
    const paint = (colors) => { ctx.clearRect(0, 0, 1, 1); for (const c of colors) { ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); } return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const lum = (rgb) => rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    let worst = 99;
    for (const el of document.querySelectorAll(".ta-pill-k, .ta-pill .ta-name, .ta-pill-more")) {
      const fills = []; for (let up = el; up; up = up.parentElement) fills.unshift(getComputedStyle(up).backgroundColor);
      const back = lum(paint(["#fff", ...fills])), ink = lum(paint(["#fff", ...fills, getComputedStyle(el).color]));
      worst = Math.min(worst, (Math.max(back, ink) + 0.05) / (Math.min(back, ink) + 0.05));
    }
    return Math.round(worst * 100) / 100;
  });
  const oneRows = await rows(made.one);
  check("Card shows 2 pills with the kind in words, main first, then +N", JSON.stringify(oneRows) === JSON.stringify(["Note: Quick answer on top of the page", "Page: /freezones/", "+1"]), oneRows.join(" | "));
  const bg = (id, kind) => card(id).locator(`.ta-pill[data-ta-linked="${kind}"]`).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  check("Each kind has its own colour, no icons", !(await card(made.one).locator(".ta-pills svg").count()) && (await bg(made.one, "page")) !== (await bg(made.one, "note")) && (await bg(made.many, "keyword")) !== (await bg(made.one, "page")));
  const line = await card(made.one).locator(".ta-pills").innerText();
  check("Page shows as its path, as a link", (await card(made.long).locator(".ta-pills a.page-link").count()) === 1 && !/site-one\.example/.test(await card(made.long).locator(".ta-pills").innerText()));
  check("Keywords are links", (await card(made.many).locator(".ta-pills a.kw-link").count()) === 2);
  check("No Note +2 tag once names show", !(await card(made.one).locator(".tk-tags .ta-tag").count()));
  const manyRows = await rows(made.many);
  check("Several: 2 pills, the rest counted", JSON.stringify(manyRows) === JSON.stringify(["Keyword: one", "Keyword: two", "+3"]), manyRows.join(" | "));
  const kindRows = await rows(made.kinds);
  check("Many kinds: 2 pills then +N", kindRows.length === 3 && kindRows[0] === (made.rival ? `Competitor: ${made.rival}` : "Link to get: news.example") && /^\+\d$/.test(kindRows[2]), kindRows.join(" | "));
  check("General task keeps its tag, no line", !(await card(made.none).locator(".ta-pills").count()) && (await card(made.none).locator(".ta-tag").count()) === 1);
  const fits = (id) => card(id).evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && [...el.querySelectorAll(".ta-pill")].every((dd) => dd.getBoundingClientRect().right <= el.getBoundingClientRect().right));
  check("Long names are cut with …, the card doesn't grow sideways", await fits(made.long));
  check("+N stays beside the last pill", await moreBeside());
  const light = await worstContrast();
  check("Light: pill words pass AA", light >= 4.5, `worst ${light}:1`);
  await card(made.one).scrollIntoViewIfNeeded();
  await card(made.one).screenshot({ path: `${shots}/card.png` });
  await card(made.many).screenshot({ path: `${shots}/card-many.png` });
  await card(made.kinds).screenshot({ path: `${shots}/card-kinds.png` });
  await card(made.long).screenshot({ path: `${shots}/card-long.png` });
  await page.evaluate(() => { document.querySelectorAll("*").forEach((el) => el.scrollTo?.({ top: 0, behavior: "instant" })); window.scrollTo({ top: 0, behavior: "instant" }); }); await settle(500);
  await page.screenshot({ path: `${shots}/board.png` });

  // The table says the same thing on one quiet line under the title.
  await page.locator('[data-task-view="table"], .tk-views button:has-text("Table")').first().click(); await settle(600);
  const trow = page.locator(`[data-task-row="${made.one}"]`);
  check("Table row: the same pills under the title", /Note\s+Quick answer.*Page\s+\/freezones\/.*Keyword\s+coffee beans/s.test(await trow.locator(".ta-pills-inline").innerText()) && !(await trow.locator(".ta-tag").count()), flat(await trow.locator(".ta-pills-inline").innerText()));
  check("Table: pills take two lines at most and don't widen the table", (await moreBeside()) && (await page.locator("#tk-table .ta-pills-inline").evaluateAll((els) => els.every((el) => el.getBoundingClientRect().height <= 56))) && (await page.locator(".tk-list .table-wrap").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)));
  await page.screenshot({ path: `${shots}/table.png` });
  await page.locator('[data-task-view="board"], .tk-views button:has-text("Board")').first().click(); await settle(600);

  // Dark mode, then French.
  await page.goto(`${base}?a=1&theme=dark#tasks?site=site-one.example&view=kanban`); await page.reload(); await page.waitForSelector(`[data-task-card="${made.one}"]`); await settle(800);
  const dark = await worstContrast();
  check("Dark: pill words pass AA", dark >= 4.5, `worst ${dark}:1`);
  await page.screenshot({ path: `${shots}/board-dark.png` });
  await card(made.one).screenshot({ path: `${shots}/card-dark.png` });
  await page.goto(`${base}?a=1&theme=light&lang=fr#tasks?site=site-one.example&view=kanban`); await page.reload(); await page.waitForSelector(`[data-task-card="${made.one}"]`); await settle(800);
  const frRows = [...(await rows(made.many)), ...(await rows(made.kinds))];
  check("French words", frRows[0] === "Mot-clé: one" && /^(Concurrent|Lien à obtenir):/.test(frRows[3]), frRows.join(" | "));
  await page.screenshot({ path: `${shots}/board-fr.png` });
  await page.goto(`${base}?a=1&lang=en#tasks?site=site-one.example&view=kanban`); await page.reload(); await page.waitForSelector(`[data-task-card="${made.one}"]`); await settle(800);

  // Links open the page or the keyword, never the task.
  await card(made.many).locator(".ta-pills a.kw-link").first().click(); await settle(800);
  check("Clicking the keyword opens it, not the task", !(await page.locator("#task-title").count()));
  await page.goto(`${base}?a=1#tasks?site=site-one.example&view=kanban`); await page.reload(); await page.waitForSelector(`[data-task-card="${made.one}"]`); await settle(800);
  const popup = page.waitForEvent("popup", { timeout: 4000 }).catch(() => null);
  await card(made.long).locator(".ta-pills a.page-link").click(); const tab = await popup; await settle(500);
  check("Clicking the page opens the page, not the task", !!tab && !(await page.locator("#task-title").count()));
  await tab?.close();
  await card(made.one).locator(".ta-pill-k").first().click(); await settle(700);
  check("Clicking the grey words opens the task, like the rest of the card", (await page.locator("#task-title").count()) === 1);
  check("The task panel's own chips keep their look", await page.locator("[data-ta-chips] .tk-chip").first().evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) < 20 && !el.classList.contains("ta-pill")));
  await page.keyboard.press("Escape"); await settle(400);

  // Phone, light and dark.
  await page.setViewportSize({ width: 390, height: 844 }); await settle(600);
  check("Phone: no sideways scroll, long names still cut", (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)) && (await fits(made.long)));
  await card(made.long).scrollIntoViewIfNeeded().catch(() => {});
  check("Phone: +N stays beside the last pill", await moreBeside());
  await page.screenshot({ path: `${shots}/phone.png` });
  await page.goto(`${base}?a=1&theme=dark#tasks?site=site-one.example&view=kanban`); await page.reload(); await page.waitForSelector(`[data-task-card="${made.one}"]`); await settle(800);
  await card(made.kinds).scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `${shots}/phone-dark.png` });
  await page.goto(`${base}?a=1&theme=light#tasks?site=site-one.example&view=kanban`); await settle(500);
  await page.evaluate(async (ids) => { for (const id of ids) await COMP.api("DELETE", `tasks/${id}`); }, [made.one, made.many, made.none, made.kinds, made.long]);
  check("No page errors", !problems.length, problems.join(" / "));
  await browser.close();
  const bad = results.filter((ok) => !ok).length;
  console.log(bad ? `${bad} FAILED` : "all passed");
  process.exit(bad ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
