// Controls a person sees at rest, page height, first table row and server calls, per screen. Read-only: it clicks menu items only.
// From plan-seo-command-center-simplify-screens-like-mickaz.md, appendix A. Run against a private demo world, never live:
//   node tests/ui/measure_screens.cjs http://127.0.0.1:8279/ [simple]
const { open } = require("./pw.cjs");
const BASE = process.argv[2] || "http://127.0.0.1:8277/";
const SIMPLE = process.argv[3] === "simple" ? "1" : "0";
const seen = () => {
  const main = document.querySelector("#main");
  const shown = (el) => { const r = el.getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) return false;
    let o = 1; for (let n = el; n && n !== document.body; n = n.parentElement) { const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden") return false; o *= Number(s.opacity); } return o > 0.05; };
  const controls = [...main.querySelectorAll("button,select,input,textarea,a[href],summary,[role=button],[role=tab]")].filter(shown);
  const row = [...main.querySelectorAll("tbody tr")].find(shown);
  return { controls: controls.length, height: main.scrollHeight,
           firstRow: row ? Math.round(row.getBoundingClientRect().top + main.scrollTop) : null };
};
(async () => {
  const { browser, page } = await open({ width: 1440, height: 900, url: `${BASE}?flow=${Date.now()}&simple=${SIMPLE}#settings` });
  await page.waitForSelector(".nav-item"); await page.waitForTimeout(2000);
  await page.evaluate(() => { const s = window.SITES.find((x) => x.host === "site-one.example"); window.UI.state.site = s.id; window.UI.render(); });
  for (const id of ["today", "channels", "conversions", "content", "overview", "insights", "keywords", "competitors", "ai"]) {
    for (const visit of ["first", "again"]) {
      let calls = 0; const count = (r) => { if (r.url().includes("/api/")) calls += 1; };
      page.on("request", count);
      await page.click(`button[data-go="${id}"]`); await page.waitForTimeout(1800);
      page.off("request", count); await page.mouse.move(5, 5);
      if (visit === "again") console.log(id.padEnd(12), JSON.stringify({ ...(await page.evaluate(seen)), callsAgain: calls }));
      else console.log(id.padEnd(12), "first-open calls", calls);
      await page.click(`button[data-go="${id === "today" ? "tasks" : "today"}"]`); await page.waitForTimeout(800);
    }
  }
  await browser.close();
})();
