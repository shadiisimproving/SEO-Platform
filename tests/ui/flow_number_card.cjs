// The simpler screens' number card (UI.card) and (i) (UI.info), driven by hand like a normal user (track B, 2026-11-11).
// Every variant on one test page inside the app, with the switch on: plain cards, link cards (Today), switch cards (Overview),
// button cards (Competitors), an unknown number, a card without a graph, the period before dashed, a day read by pointer, keys
// and tap, the (i) by hover, keyboard and tap, the page tabs; then 1440 and 390 px, light and dark, English and French. With
// the switch off the same markup gets none of the new look. Made-up numbers only.
// Needs: DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/app_server.py --port 8281 --slow 0
// Usage: node tests/ui/flow_number_card.cjs http://127.0.0.1:8281/ [folder for screenshots]
const fs = require("fs");
const { open, menu } = require("./pw.cjs");

const BASE = process.argv[2] || "http://127.0.0.1:8281/";
const SHOTS = process.argv[3] || "reports/simplify-2026-11-11/track-b";
fs.mkdirSync(SHOTS, { recursive: true });
const fails = [];
const check = (ok, what, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${!ok && extra !== "" ? `  [${extra}]` : ""}`); if (!ok) fails.push(what); };
const settle = (page, ms = 600) => page.waitForTimeout(ms);
// Run a function on the first element a selector finds, or on all of them.
const on = (page, sel, fn, arg) => page.locator(sel).first().evaluate(fn, arg, { timeout: 3000 });
const onAll = (page, sel, fn, arg) => page.locator(sel).evaluateAll(fn, arg);
const css = (page, sel, prop) => on(page, sel, (el, p) => getComputedStyle(el).getPropertyValue(p).trim(), prop);
const text = (page, sel) => on(page, sel, (el) => el.textContent.replace(/\s+/g, " ").trim());
// What a person sees: innerText leaves out what is hidden (the sub line while a day is read, and the other way round).
const seen = (page, sel) => on(page, sel, (el) => el.innerText.replace(/\s+/g, " ").trim());

/* The test page, built in the browser with the app's own UI.card and UI.info. */
function build() {
  const UI = window.UI;
  const days = Array.from({ length: 28 }, (_, i) => { const d = new Date(2026, 9, 14 + i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  const wave = (base, amp, seed, step = 0) => days.map((_, i) => Math.round(base + amp * Math.sin((i + seed) / 3) + step * i));
  const visitsNow = wave(280, 40, 1, 1), visitsWas = wave(270, 35, 4, 0.5);
  const run = (list) => { let s = 0; return list.map((v) => (s += v)); };
  const leadsNow = run(days.map((_, i) => (i % 3 === 0 ? 2 : 1))), leadsWas = run(days.map((_, i) => (i % 4 === 0 ? 1 : i % 2)));
  const sum = (list) => list.reduce((a, b) => a + b, 0);
  const clicksNow = wave(41, 9, 2, 0.2), clicksWas = wave(44, 8, 6, 0);
  const posNow = days.map((_, i) => Math.round((9.4 - i * 0.05 + Math.sin(i / 2) * 0.4) * 10) / 10), posWas = days.map((_, i) => Math.round((10.6 + Math.sin(i / 3) * 0.5) * 10) / 10);
  const gap = clicksNow.map((v, i) => (i >= 12 && i <= 14 ? null : v)); // three days without data
  const today = [
    UI.card({ id: "leads", label: "Leads", value: leadsNow[27], change: { value: leadsNow[27] - leadsWas[27], unit: "" }, href: "#conversions", tall: true, info: "Graph: running total.", spark: { now: leadsNow, before: leadsWas, days }, cls: "today-num" }),
    UI.card({ id: "visits", label: "Visits", value: sum(visitsNow), change: { now: sum(visitsNow), before: sum(visitsWas) }, href: "#channels", tall: true, spark: { now: visitsNow, before: visitsWas, days }, cls: "today-num" }),
    UI.card({ id: "clicks", label: "Google clicks", value: sum(clicksNow), change: { now: sum(clicksNow), before: sum(clicksWas) }, href: "#overview", tall: true, def: "Clicks", spark: { now: gap, before: clicksWas, days }, cls: "today-num" }),
  ].join("");
  const report = [
    UI.card({ id: "visits", label: "Visits", value: 7921, change: { now: 7921, before: 7750 }, spark: { now: visitsNow, before: visitsWas, days } }),
    UI.card({ id: "leads", label: "Leads", value: 37, change: { now: 37, before: 41, unit: "" }, spark: { now: days.map((_, i) => (i % 5 === 0 ? 3 : 1)), days } }),
    UI.card({ id: "lead-rate", label: "Lead rate", value: 4.9, format: "pct", change: { now: 4.9, before: 4.5, unit: "pts" }, spark: { now: days.map((_, i) => 4.2 + (i % 7) / 10), before: days.map((_, i) => 4.4 + (i % 5) / 10), days }, sub: "organic search 7.3%" }),
    UI.card({ id: "channels", label: "Channels", value: 6, sub: "Organic Search first", spark: [6] }),
  ].join("");
  const overview = [
    UI.card({ id: "clicks", label: "Clicks", value: 1182, change: { now: 1182, before: 1154 }, toggle: { pressed: true, color: "var(--ch-1)" }, attrs: { "data-demo-line": "clicks" }, spark: { now: clicksNow, before: clicksWas, days } }),
    UI.card({ id: "impressions", label: "Impressions", value: 40310, change: { now: 40310, before: 43020 }, toggle: { pressed: true, color: "var(--ch-2)" }, attrs: { "data-demo-line": "impressions" }, spark: { now: wave(1440, 160, 3), before: wave(1530, 150, 5), days } }),
    UI.card({ id: "click-rate", label: "Click rate", value: 2.9, format: "pct", change: { now: 2.9, before: 2.7, unit: "pts" }, toggle: { pressed: false, color: "var(--ch-3)" }, attrs: { "data-demo-line": "click_rate" }, spark: { now: days.map((_, i) => 2.6 + (i % 6) / 10), before: days.map((_, i) => 2.5 + (i % 4) / 10), days } }),
    UI.card({ id: "position", label: "Average position", value: 8.2, format: "dec", change: { now: 8.2, before: 10.3, unit: "places" }, toggle: { pressed: false, color: "var(--ch-5)" }, attrs: { "data-demo-line": "position" }, spark: { now: posNow, before: posWas, days, invert: true } }),
  ].join("");
  const comp = [
    UI.card({ id: "rivals", label: "Competitors", value: 3, sub: "across 2 sites", button: true, cls: "cs-jump", attrs: { "data-demo-jump": "rivals", "aria-label": "Competitors: 3" } }),
    UI.card({ id: "keywords", label: "Keywords they beat you on", value: 8, sub: "of 10 · Google", button: true, cls: "cs-jump", attrs: { "data-demo-jump": "keywords" } }),
    UI.card({ id: "moves", label: "Changes in 30 days", value: 14, button: true, cls: "cs-jump", attrs: { "data-demo-jump": "moves" }, spark: [1, 0, 2, 1, 3, 0, 1, 2, 4] }),
    UI.card({ id: "links", label: "Domains linking to 2+", value: null, sub: "No pages read yet", button: true, cls: "cs-jump", attrs: { "data-demo-jump": "links" } }),
  ].join("");
  const ai = [
    UI.card({ id: "ai-visits", label: "AI visits", value: 212, change: { now: 212, before: 168 }, spark: { now: [31, 44, 52, 41, 44], days: ["2026-10-13", "2026-10-20", "2026-10-27", "2026-11-03", "2026-11-10"] } }),
    UI.card({ id: "ai-leads", label: "Leads", value: 9, change: { now: 9, before: 6, unit: "" } }),
    UI.card({ id: "ai-rate", label: "Lead rate", value: 4.2, format: "pct", def: "Lead rate", info: "Leads from AI visits, divided by those visits.", sub: "organic search 7.3%" }),
    UI.card({ id: "cites", label: "Copilot citations", value: null, sub: `<button class="link-btn" data-demo-upload>${UI.esc(UI.t("Upload a Clarity AI download"))}</button>` }),
  ].join("");
  const plainRow = [
    UI.card({ id: "unknown", label: "AI visits", value: null, sub: "Google Analytics not connected" }),
    UI.card({ id: "words", label: "Leads", value: '<span class="today-fig-word">Not set up</span>', sub: "Mark forms as GA4 key events" }),
    UI.card({ id: "speed", label: "Speed score", value: 92, sub: "/ 100" }),
  ].join("");
  const line = `<p class="small muted demo-line">14 Oct – 10 Nov 2026 · vs 16 Sept – 13 Oct · Google Analytics, through 10 Nov${UI.info(["Google Analytics hid rows with few visits.", "From visit to lead. Counts only, no personal data."])}</p>`;
  const tabs = `<div class="page-tabs" role="tablist" aria-label="Demo"><button class="page-tab" role="tab" aria-selected="true">All pages</button><button class="page-tab" role="tab" aria-selected="false">Social networks</button><button class="page-tab" role="tab" aria-selected="false">Page speed</button><button class="page-tab" role="tab" aria-selected="false">Clarity report</button></div>`;
  const head = (words) => `<h2 class="demo-h">${UI.esc(words)}</h2>`;
  return `${line}${tabs}${head("Today: tall link cards")}<div class="tiles demo-today" id="demo-today">${today}</div>${head("A report screen")}<div class="tiles" id="demo-report">${report}</div>`
    + `${head("Overview: switch cards")}<div class="tiles" id="demo-overview">${overview}</div>${head("Competitors: button cards")}<div class="tiles" id="demo-comp">${comp}</div>`
    + `${head("AI search")}<div class="tiles" id="demo-ai">${ai}</div>${head("Unknown, words, no graph")}<div class="tiles" id="demo-plain">${plainRow}</div>`;
}
/* It goes in through UI.setHTML (DOMPurify and brand logos, as every screen does), beside #page, so a screen redrawing itself
   doesn't wipe it. */
async function inject(page) {
  const html = await page.evaluate(build);
  await page.evaluate((markup) => {
    document.getElementById("ncard-demo")?.remove();
    const box = document.createElement("div");
    box.id = "ncard-demo"; box.className = "content page-enter";
    window.UI.setHTML(box, markup);
    document.getElementById("page").style.display = "none";
    document.getElementById("page").after(box);
    if (!document.getElementById("ncard-demo-style")) {
      const s = document.createElement("style"); s.id = "ncard-demo-style";
      s.textContent = "#ncard-demo .demo-h{font-size:13px;font-weight:600;margin:18px 2px 8px;color:var(--text-2)} #ncard-demo .demo-line{margin:0 2px 10px} #demo-today{grid-template-columns:repeat(3,minmax(0,1fr))} #demo-report,#demo-overview,#demo-comp{grid-template-columns:repeat(4,minmax(0,1fr))} #demo-ai{grid-template-columns:repeat(4,minmax(0,1fr))} #demo-plain{grid-template-columns:repeat(3,minmax(0,1fr))} @media (max-width:640px){#demo-today,#demo-report,#demo-overview,#demo-comp,#demo-ai,#demo-plain{grid-template-columns:repeat(2,minmax(0,1fr))}}";
      document.head.append(s);
    }
    document.getElementById("main").scrollTop = 0;
  }, html);
  await settle(page, 900);
}
async function start({ width = 1440, height = 900, simple = "1" } = {}) {
  const run = await open({ width, height });
  await run.page.goto(`${BASE}?flow=${Date.now()}&simple=${simple}#tasks`);
  await run.page.waitForSelector(".nav-item"); await settle(run.page, 1500);
  return run;
}
const box = (page, sel) => on(page, sel, (p) => { const r = p.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
// The whole test page in one picture: #main scrolls inside the window, so the window grows to hold it, then goes back.
async function whole(page, path) {
  const size = page.viewportSize();
  const tall = await page.evaluate(() => document.getElementById("ncard-demo").getBoundingClientRect().height + 60);
  await page.setViewportSize({ width: size.width, height: Math.max(size.height, Math.ceil(tall)) }); await settle(page, 300);
  await page.screenshot({ path });
  await page.setViewportSize(size); await settle(page, 200);
}

(async () => {
  // ---- 1440, light, English: every variant, and how it behaves ----
  const { browser, page, problems } = await start();
  const failed = [];
  // The harness runs without sign-in (/api/auth/me answers 404) and some made-up sites have no logo: not the card's doing.
  page.on("response", (r) => { if (r.status() >= 400 && !/api\/auth\/me|api\/logos/.test(r.url())) failed.push(`${r.status()} ${r.url()}`); });
  check(await page.evaluate(() => typeof window.UI.card === "function" && typeof window.UI.info === "function"), "UI.card and UI.info are on window.UI");
  check(await page.evaluate(() => document.documentElement.dataset.simple === "1" && window.UI.simple() === true), "the switch is on (?simple=1)");
  await inject(page);
  await page.screenshot({ path: `${SHOTS}/card-1440-light-en.png` });
  await whole(page, `${SHOTS}/card-1440-light-en-all.png`);

  check((await page.$$("#ncard-demo .ncard")).length === 22, "22 cards drawn");
  check((await page.$$("#ncard-demo .ncard .ico")).length === 0, "no card has an icon square");
  check(await onAll(page, "#ncard-demo .ncard", (cards) => cards.every((c) => c.dataset.card)), "every card carries data-card");
  check(await on(page, '#demo-report [data-card="visits"]', (c) => c.tagName === "SECTION"), "a plain card is a section");
  check(await on(page, '#demo-today [data-card="visits"]', (c) => c.tagName === "A" && c.getAttribute("href") === "#channels" && c.classList.contains("today-num")), "a link card is one link, keeping its old class");
  check(await on(page, '#demo-overview [data-card="clicks"]', (c) => c.tagName === "BUTTON" && c.getAttribute("aria-pressed") === "true" && c.dataset.demoLine === "clicks"), "a switch card is a pressed button with its own data- hook");
  check(await on(page, '#demo-comp [data-card="rivals"]', (c) => c.tagName === "BUTTON" && !c.hasAttribute("aria-pressed") && c.getAttribute("aria-label") === "Competitors: 3"), "a button card is a plain button with its aria-label");
  check(await onAll(page, "#ncard-demo .ncard:is(a, button)", (cards) => cards.length === 11 && cards.every((c) => !c.querySelector('[tabindex="0"], a, button'))), "nothing focusable inside a link, button or switch card");

  // Numbers, pills and sub lines
  const pill = (sel) => text(page, `${sel} .d-pill`);
  check((await text(page, '#demo-report [data-card="visits"] .ncard-fig')) === "7,921", "the figure is formatted (7,921)");
  check((await pill('#demo-report [data-card="visits"]')) === "+2% better", "counts change in %: +2% better", await pill('#demo-report [data-card="visits"]'));
  check(await on(page, '#demo-report [data-card="visits"] .d-pill', (p) => p.classList.contains("good") && Boolean(p.querySelector("svg.i"))), "the pill is green with an arrow");
  check((await text(page, '#demo-report [data-card="visits"] .ncard-sub')) === "7,750 → 7,921", "the sub line says before → now");
  check((await pill('#demo-report [data-card="leads"]')) === "−4 worse", "a plain difference for leads: −4 worse", await pill('#demo-report [data-card="leads"]'));
  check((await pill('#demo-report [data-card="lead-rate"]')) === "+0.4 pts better", "rates change in points", await pill('#demo-report [data-card="lead-rate"]'));
  check((await text(page, '#demo-report [data-card="lead-rate"] .ncard-sub')) === "organic search 7.3%", "a sub line can be one short fact");
  check((await pill('#demo-overview [data-card="position"]')) === "2.1 places better" && await on(page, '#demo-overview [data-card="position"] .d-pill', (p) => p.classList.contains("good")), "position: fewer is better, in places", await pill('#demo-overview [data-card="position"]'));
  check((await text(page, '#demo-overview [data-card="position"] .ncard-fig')) === "8.2" && (await text(page, '#demo-overview [data-card="click-rate"] .ncard-fig')) === "2.9%", "one decimal and % formats");
  check((await pill('#demo-today [data-card="leads"]')).endsWith("better"), "a change worked out by the server is shown as given");
  const grey = await page.evaluate(() => {
    const fig = document.querySelector('#demo-plain [data-card="unknown"] .ncard-fig'), probe = document.createElement("span");
    probe.style.color = "var(--muted)"; document.body.append(probe);
    const same = getComputedStyle(probe).color === getComputedStyle(fig).color; probe.remove();
    return same && fig.textContent === "—";
  });
  check(grey, "unknown shows — in grey, never 0");
  check((await text(page, '#demo-plain [data-card="unknown"] .ncard-sub')) === "Google Analytics not connected" && !(await page.$('#demo-plain [data-card="unknown"] .d-pill')), "unknown says why, with no pill");
  check(Boolean(await page.$('#demo-ai [data-card="cites"] .ncard-sub button.link-btn')), "a plain card's sub line can hold one link button");

  // The (i) after the label: the definition, and on a link or switch the card itself holds it
  const visitsTip = await on(page, '#demo-report [data-card="visits"] .ncard-lab .def-i', (i) => [i.getAttribute("tabindex"), i.getAttribute("role"), i.dataset.tip]);
  check(visitsTip[0] === "0" && visitsTip[1] === "img" && /Google Analytics/.test(visitsTip[2]), "a plain card's (i) is focusable and holds the definition", visitsTip.join(" | "));
  const leadsTip = await on(page, '#demo-today [data-card="leads"]', (c) => [c.dataset.tip, c.getAttribute("aria-describedby"), document.getElementById(c.getAttribute("aria-describedby"))?.textContent, c.querySelector(".def-i")?.getAttribute("tabindex"), c.querySelector(".def-i")?.getAttribute("aria-hidden")]);
  check(/enquiry/.test(leadsTip[0]) && /running total/.test(leadsTip[0]) && /running total/.test(leadsTip[2] || "") && leadsTip[3] === null && leadsTip[4] === "true", "a link card holds definition and caveat itself, described for screen readers", JSON.stringify(leadsTip));
  check(await on(page, '#demo-today [data-card="clicks"]', (c) => /clicked/.test(c.dataset.tip || "")), "def names the metric when the label isn't its name");

  // Graphs
  check((await onAll(page, "#demo-report .ncard", (c) => c.map((x) => Boolean(x.querySelector(".ncard-graph"))).join())) === "true,true,true,false", "a graph from 2 points; under 2 points none");
  const noGraph = Math.round((await box(page, '#demo-plain [data-card="unknown"]')).h);
  check(noGraph === 96, "a row without graphs or links is 96 px high", noGraph);
  const aiHeights = await onAll(page, "#demo-ai .ncard", (c) => c.map((x) => Math.round(x.getBoundingClientRect().height)));
  check(new Set(aiHeights).size === 1, "a row with a link in one sub line keeps one height", aiHeights.join());
  const rateTip = await on(page, '#demo-ai [data-card="ai-rate"] .def-i', (i) => i.dataset.tip);
  check(/^Leads divided by visits/.test(rateTip) && rateTip.split("\n").length === 2, "def picks the definition, info adds a caveat on its own line", rateTip);
  const heights = await onAll(page, "#demo-report .ncard", (c) => c.map((x) => Math.round(x.getBoundingClientRect().height)));
  check(new Set(heights).size === 1, "cards in a row are the same height", heights.join());
  check(Math.round((await box(page, '#demo-report [data-card="visits"] .ncard-plot')).h) === 36 && Math.round((await box(page, '#demo-today [data-card="visits"] .ncard-plot')).h) === 64, "graph 36 px, tall graph 64 px");
  const graphBox = await on(page, '#demo-report [data-card="visits"]', (c) => { const a = c.getBoundingClientRect(), g = c.querySelector(".ncard-plot").getBoundingClientRect(); return [Math.round(g.width - (a.width - 32)), Math.round(g.top - c.querySelector(".ncard-sub").getBoundingClientRect().bottom)]; });
  check(graphBox[0] === 0 && graphBox[1] >= 8, "the graph is full card width, 8 px or more under the sub line", graphBox.join());
  check(await on(page, '#demo-report [data-card="visits"] .was', (p) => getComputedStyle(p).strokeDasharray !== "none" && Boolean(p.getAttribute("d"))), "the period before is dashed");
  check((await on(page, '#demo-today [data-card="clicks"] path.now', (p) => (p.getAttribute("d").match(/M/g) || []).length)) === 2, "a gap in the data breaks the line");
  const ends = await on(page, '#demo-today [data-card="visits"] .ncard-days', (d) => [...d.children].map((x) => x.textContent).join(" | "));
  check(ends === "14 Oct | 10 Nov", "a tall card names its first and last day", ends);
  const colours = await onAll(page, "#demo-report .ncard", (c) => c.map((x) => getComputedStyle(x).getPropertyValue("--c").trim()));
  const tokens = await page.evaluate(() => ["--c-blue", "--c-purple", "--c-teal", "--c-indigo"].map((k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim()));
  check(colours.join() === tokens.join(), "one colour per card, from look-clear's rule: blue, purple, teal, indigo", colours.join());
  const lineColour = await page.evaluate(() => {
    const card = document.querySelector('#demo-report [data-card="leads"]'), probe = document.createElement("span");
    probe.style.color = getComputedStyle(card).getPropertyValue("--c"); document.body.append(probe);
    const same = getComputedStyle(card.querySelector("path.now")).stroke === getComputedStyle(probe).color; probe.remove();
    return same;
  });
  check(lineColour, "the graph line takes the card's colour");

  // Reading a day: the pointer
  const visits = '#demo-report [data-card="visits"]';
  const plot = await box(page, `${visits} .ncard-plot`);
  await page.mouse.move(plot.x + plot.w * (13 / 27), plot.y + plot.h / 2); await settle(page, 200);
  const read = await seen(page, `${visits} .ncard-sub`);
  check(/^27 Oct · [\d,]+ · before [\d,]+$/.test(read), "hovering the graph reads that day in the sub line", read);
  check(await on(page, visits, (c) => c.classList.contains("is-reading") && !c.querySelector(".ncard-pt.now").hidden), "a dot marks the day on the line");
  await page.locator(visits).screenshot({ path: `${SHOTS}/card-reading-1440-light-en.png` });
  await page.mouse.move(5, 5); await settle(page, 200);
  check((await text(page, `${visits} .ncard-sub`)) === "7,750 → 7,921", "leaving the graph puts the sub line back");

  // Reading a day: the keys
  await page.focus(`${visits} .ncard-graph`);
  await page.keyboard.press("End"); await settle(page, 100);
  check(/^10 Nov · /.test(await seen(page, `${visits} .ncard-sub`)), "End reads the last day", await seen(page, `${visits} .ncard-sub`));
  await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft"); await settle(page, 100);
  check(/^8 Nov · /.test(await seen(page, `${visits} .ncard-sub`)), "the arrow keys move a day at a time", await seen(page, `${visits} .ncard-sub`));
  check(/8 Nov/.test(await page.evaluate(() => [...document.querySelectorAll('body > .sr[aria-live="polite"]')].map((x) => x.textContent).join())), "a screen reader hears the day");
  await page.keyboard.press("Escape"); await settle(page, 100);
  check((await text(page, `${visits} .ncard-sub`)) === "7,750 → 7,921", "Escape puts the sub line back");
  await page.keyboard.press("ArrowRight"); await settle(page, 100);
  await page.keyboard.press("Tab"); await settle(page, 100);
  check((await text(page, `${visits} .ncard-sub`)) === "7,750 → 7,921", "moving focus away puts the sub line back");
  const sw = '#demo-overview [data-card="position"]';
  await page.focus(sw); await page.keyboard.press("ArrowLeft"); await settle(page, 100);
  check(/ · before /.test(await seen(page, `${sw} .ncard-sub`)), "on a switch card the arrow keys read its graph", await seen(page, `${sw} .ncard-sub`));
  await page.keyboard.press("Escape");

  // Link and switch cards
  const shadowRest = await css(page, '#demo-today [data-card="visits"]', "box-shadow");
  const topRest = (await box(page, '#demo-today [data-card="visits"]')).y;
  await page.hover('#demo-today [data-card="visits"] .ncard-fig'); await settle(page, 250);
  const shadowHover = await css(page, '#demo-today [data-card="visits"]', "box-shadow");
  const lift = topRest - (await box(page, '#demo-today [data-card="visits"]')).y;
  check(shadowRest !== shadowHover && Math.abs(lift) < 0.5, "a link card answers the pointer with its shadow, without lifting", `${shadowRest} → ${shadowHover} · lift ${lift}`);
  await page.mouse.move(5, 5);
  check(/inset/.test(await css(page, '#demo-report [data-card="visits"]', "box-shadow")), "a plain card has the Clear shadow and line");
  check(/inset/.test(await css(page, '#demo-overview [data-card="clicks"]', "box-shadow")) && /3px/.test(await css(page, '#demo-overview [data-card="clicks"]', "box-shadow")), "a pressed switch shows its 3 px top line");
  check((await onAll(page, "#demo-overview .ncard-key", (k) => k.map((x) => getComputedStyle(x).backgroundColor !== "rgba(0, 0, 0, 0)").join())) === "true,true,false,false", "pressed switches have a filled dot, the others a hollow one");
  await page.focus('#demo-today [data-card="leads"]');
  check(await page.evaluate(() => document.activeElement?.dataset.card === "leads"), "a link card takes keyboard focus as one control");
  await page.click('#demo-today [data-card="visits"]'); await settle(page, 1200);
  check(await page.evaluate(() => location.hash.startsWith("#channels")), "clicking a link card opens its screen");
  await page.goto(`${BASE}?flow=${Date.now()}&simple=1#tasks`); await page.waitForSelector(".nav-item"); await settle(page, 1200); await inject(page);

  // The (i) of a date line: hover, keyboard, Escape
  const info = await on(page, ".demo-line .info-i", (i) => [i.getAttribute("tabindex"), i.getAttribute("role"), i.dataset.tip, i.getAttribute("aria-label")]);
  check(info[0] === "0" && info[1] === "img" && info[2] === "Google Analytics hid rows with few visits.\nFrom visit to lead. Counts only, no personal data." && info[3].includes("with few visits. From visit"), "UI.info: a focusable (i), one caveat a line", JSON.stringify(info));
  check(await page.evaluate(() => window.UI.info("") === "" && window.UI.info([]) === "" && window.UI.info([null, " "]) === ""), "UI.info draws nothing without words");
  check(await page.evaluate(() => /3 rows/.test(window.UI.info("{n} rows hidden.", { vars: { n: 3 } }))), "UI.info fills its {vars}");
  await page.hover(".demo-line .info-i"); await settle(page, 600);
  const tip = await on(page, "body > .tooltip", (el) => [el.textContent, getComputedStyle(el).whiteSpace]).catch(() => null);
  check(tip && tip[0].includes("hid rows") && tip[1] === "pre-line", "hovering the (i) shows its caveats, one a line", JSON.stringify(tip));
  await page.screenshot({ path: `${SHOTS}/info-1440-light-en.png`, clip: { x: 248, y: 0, width: 900, height: 220 } });
  await page.keyboard.press("Escape"); await settle(page, 200);
  check(!(await page.$("body > .tooltip")), "Escape closes the (i)'s words");
  await page.mouse.move(5, 5);
  await page.focus(".demo-line .info-i"); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab"); await settle(page, 600);
  check(Boolean(await page.$("body > .tooltip")), "keyboard focus on the (i) shows its words");
  await page.keyboard.press("Escape");
  // Page tabs
  const sel = await on(page, '.page-tab[aria-selected="true"]', (b) => { const s = getComputedStyle(b); return [s.borderBottomWidth, s.fontWeight, Math.round(b.getBoundingClientRect().height), s.fontSize]; });
  check(sel[0] === "2px" && Number(sel[1]) >= 600 && sel[2] === 40 && sel[3] === "14px", "page tabs: 40 px, 14 px words, the chosen one underlined", sel.join());
  check((await css(page, '.page-tab[aria-selected="false"]', "color")) !== (await css(page, '.page-tab[aria-selected="true"]', "color")), "the chosen tab is in the accent colour");
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.getElementById("main").scrollWidth > document.getElementById("main").clientWidth)), "no sideways scroll at 1440");

  // ---- dark ----
  await menu(page, "theme"); await settle(page, 300); await page.keyboard.press("Escape"); await settle(page, 400);
  check(await page.evaluate(() => document.documentElement.dataset.theme === "dark"), "dark mode on");
  check((await css(page, '#demo-report [data-card="visits"]', "background-color")) === "rgb(30, 36, 43)", "dark: the card is the charcoal glass", await css(page, '#demo-report [data-card="visits"]', "background-color"));
  await page.screenshot({ path: `${SHOTS}/card-1440-dark-en.png` });
  await whole(page, `${SHOTS}/card-1440-dark-en-all.png`);
  await page.hover(".demo-line .info-i"); await settle(page, 600);
  await page.screenshot({ path: `${SHOTS}/info-1440-dark-en.png`, clip: { x: 248, y: 0, width: 900, height: 220 } });
  await page.mouse.move(5, 5);
  await menu(page, "theme"); await settle(page, 300); await page.keyboard.press("Escape");

  // ---- French ----
  await menu(page, "lang"); await settle(page, 300); await page.keyboard.press("Escape"); await settle(page, 300);
  await inject(page);
  check((await text(page, '#demo-report [data-card="visits"] .ncard-fig')) === "7 921", "French: 7 921", await text(page, '#demo-report [data-card="visits"] .ncard-fig'));
  check((await pill('#demo-report [data-card="visits"]')) === "+2 % mieux", "French: +2 % mieux", await pill('#demo-report [data-card="visits"]'));
  check((await pill('#demo-report [data-card="leads"]')) === "−4 moins bien", "French: moins bien", await pill('#demo-report [data-card="leads"]'));
  check((await pill('#demo-overview [data-card="position"]')) === "2,1 places mieux", "French: 2,1 places mieux", await pill('#demo-overview [data-card="position"]'));
  check((await text(page, '#demo-report [data-card="visits"] .ncard-name')) === "Visites", "French: the label is translated", await text(page, '#demo-report [data-card="visits"] .ncard-name'));
  check(/^Sessions comptées/.test(await on(page, '#demo-report [data-card="visits"] .def-i', (i) => i.dataset.tip)), "French: the definition");
  check(/^Google Analytics a masqué des lignes à faibles visites\.\nDe la visite au lead\./.test(await on(page, ".demo-line .info-i", (i) => i.dataset.tip)), "French: UI.info's caveats");
  check(/Graphique de cette période/.test(await on(page, '#demo-report [data-card="visits"] .ncard-graph', (g) => g.getAttribute("aria-label"))), "French: the graph's words for screen readers");
  const plotFr = await box(page, `${visits} .ncard-plot`);
  await page.mouse.move(plotFr.x + plotFr.w * (13 / 27), plotFr.y + plotFr.h / 2); await settle(page, 200);
  check(/^27 oct\.? · [\d\s ]+ · avant [\d\s ]+$/.test(await seen(page, `${visits} .ncard-sub`)), "French: the day read off the graph", await seen(page, `${visits} .ncard-sub`));
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${SHOTS}/card-1440-light-fr.png` });
  await whole(page, `${SHOTS}/card-1440-light-fr-all.png`);
  await page.hover(".demo-line .info-i"); await settle(page, 600);
  await page.screenshot({ path: `${SHOTS}/info-1440-light-fr.png`, clip: { x: 248, y: 0, width: 900, height: 220 } });
  await page.mouse.move(5, 5);
  await menu(page, "theme"); await settle(page, 300); await page.keyboard.press("Escape"); await settle(page, 300);
  await page.screenshot({ path: `${SHOTS}/card-1440-dark-fr.png` });
  await page.hover(".demo-line .info-i"); await settle(page, 600);
  await page.screenshot({ path: `${SHOTS}/info-1440-dark-fr.png`, clip: { x: 248, y: 0, width: 900, height: 220 } });
  await page.mouse.move(5, 5);
  await menu(page, "theme"); await settle(page, 300); await page.keyboard.press("Escape");
  await menu(page, "lang"); await settle(page, 300); await page.keyboard.press("Escape");
  const errors1440 = [...problems.filter((p) => !/Failed to load resource/.test(p)), ...failed];
  check(errors1440.length === 0, "no page errors or failed requests at 1440", errors1440.join(" | "));
  await browser.close();

  // ---- 390, a phone with touch: two a row, smaller figure and graph, a tap reads a day and opens the (i) ----
  for (const [theme, lang] of [["light", "en"], ["dark", "en"], ["light", "fr"], ["dark", "fr"]]) {
    const run = await open({ width: 1440, height: 900 });
    const ctx = await run.browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const phone = await ctx.newPage();
    const errors = [];
    phone.on("pageerror", (e) => errors.push(e.message));
    await phone.goto(`${BASE}?flow=${Date.now()}&simple=1&theme=${theme}&lang=${lang}#tasks`); await phone.waitForSelector(".nav-item", { state: "attached" }); await settle(phone, 1500);
    await inject(phone);
    const tag = `390-${theme}-${lang}`;
    await phone.screenshot({ path: `${SHOTS}/card-${tag}.png` });
    await whole(phone, `${SHOTS}/card-${tag}-all.png`);
    if (theme === "light" && lang === "en") {
      const cols = await on(phone, "#demo-report", (g) => getComputedStyle(g).gridTemplateColumns.split(" ").length);
      check(cols === 2, "390: two cards a row", cols);
      check((await css(phone, '#demo-report [data-card="visits"] .ncard-fig', "font-size")) === "22px", "390: the figure is 22 px");
      check(Math.round((await box(phone, '#demo-report [data-card="visits"] .ncard-plot')).h) === 28, "390: the graph is 28 px");
      const odd = await on(phone, '#demo-plain [data-card="speed"]', (c) => [Math.round(c.getBoundingClientRect().width), Math.round(c.parentElement.getBoundingClientRect().width)]);
      check(odd[0] === odd[1], "390: an odd last card takes the whole row, so none sits alone", odd.join());
      check(!(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "390: no sideways scroll");
      const link = await on(phone, '#demo-ai [data-card="cites"] .link-btn', (b) => { const r = b.getBoundingClientRect(), c = b.closest(".ncard").getBoundingClientRect(); return [b.scrollWidth <= b.clientWidth + 1 && r.right <= c.right - 8, Math.round(r.height)]; });
      check(link[0] && link[1] >= 24, "390: a link in a sub line wraps whole, with its 24 px target", link.join());
      const g = await box(phone, '#demo-report [data-card="visits"] .ncard-plot');
      await phone.touchscreen.tap(g.x + g.w / 2, g.y + g.h / 2); await settle(phone, 300);
      check(/ · before /.test(await seen(phone, '#demo-report [data-card="visits"] .ncard-sub')), "390: a tap on the graph reads that day", await seen(phone, '#demo-report [data-card="visits"] .ncard-sub'));
      await phone.locator('#demo-report [data-card="visits"]').screenshot({ path: `${SHOTS}/card-reading-390-light-en.png` });
      await phone.touchscreen.tap(195, 20); await settle(phone, 300);
      check((await seen(phone, '#demo-report [data-card="visits"] .ncard-sub')) === "7,750 → 7,921", "390: a tap elsewhere puts the sub line back");
    }
    await phone.tap(".demo-line .info-i"); await settle(phone, 700);
    if (theme === "light" && lang === "en") check(Boolean(await phone.$("body > .tooltip")), "390: a tap on the (i) shows its words");
    await phone.screenshot({ path: `${SHOTS}/info-${tag}.png`, clip: { x: 0, y: 0, width: 390, height: 300 } });
    if (theme === "light" && lang === "en") {
      await phone.touchscreen.tap(195, 20); await settle(phone, 300);
      await phone.tap('#demo-report [data-card="visits"] .ncard-lab .def-i'); await settle(phone, 700);
      check(/Google Analytics/.test(await on(phone, "body > .tooltip", (el) => el.textContent).catch(() => "")), "390: a tap on a card's (i) shows the definition");
    }
    check(errors.length === 0, `390 ${theme} ${lang}: no page errors`, errors.join(" | "));
    await run.browser.close();
  }

  // ---- the switch off: the same markup gets none of the new look ----
  const off = await start({ simple: "0" });
  await inject(off.page);
  check(await off.page.evaluate(() => document.documentElement.dataset.simple === "0" && window.UI.simple() === false), "the switch is off (?simple=0)");
  check((await css(off.page, '#demo-report [data-card="visits"]', "display")) === "block" && (await css(off.page, '#demo-report [data-card="visits"]', "border-radius")) === "0px", "switch off: .ncard has no look of its own");
  check((await css(off.page, '#demo-report [data-card="visits"]', "--c")) === "", "switch off: look-clear gives .ncard no colour");
  check((await css(off.page, ".page-tab", "min-height")) !== "40px", "switch off: page tabs have no look of their own");
  await off.browser.close();

  console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL PASSED");
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
