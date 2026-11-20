// Chart dates sit under their own points (expert review 2026-11-17, item 20): `node --test tests/js`.
// Before: up to 6 dates picked by index, then spread evenly, so on 8 weekly points "2 Nov" and "9 Nov" vanished and
// "26 Oct" sat under the 2 Nov point.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const same = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b);
const DIR = path.join(__dirname, "..", "..", "design", "mockups");

function lv() { return lvPage().LV; }
function lvPage() {
  const page = { window: {}, console };
  page.window.window = page.window;
  page.window.addEventListener = () => {};
  page.document = { addEventListener: () => {}, querySelectorAll: () => [] };
  page.window.document = page.document;
  vm.createContext(page);
  for (const name of ["data.js", "shared-ui.js", "screens-live.js"]) {
    try { vm.runInContext(`with (window) {${fs.readFileSync(path.join(DIR, name), "utf8")}}`, page); } catch (err) { if (name === "screens-live.js") throw err; }
  }
  return page.window;
}

test("eight weekly points: evenly spaced dates, counted back from the last one, which always has its date", () => {
  const LV = lv();
  same(LV.axisTicks(8), [1, 3, 5, 7]);
  same(LV.axisTicks(28), [0, 6, 12, 18, 24].map((i) => i + 3));
  same(LV.axisTicks(1), [0]);
  same(LV.axisTicks(5), [0, 1, 2, 3, 4]);
  for (const n of [2, 7, 8, 9, 28, 31, 90, 365]) {
    const ticks = LV.axisTicks(n);
    assert.equal(ticks[ticks.length - 1], n - 1, `last point dated (${n})`);
    assert.ok(ticks.length <= 6, `at most 6 dates (${n})`);
    const gaps = ticks.slice(1).map((v, i) => v - ticks[i]);
    assert.ok(gaps.every((g) => g === gaps[0]), `even gaps (${n})`);
  }
});

test("each date is placed at its point's share of the width", () => {
  const LV = lv();
  const html = LV.axisHtml([[1, "2 Nov"], [3, "16 Nov"], [7, "14 Dec"]], 8);
  const lefts = [...html.matchAll(/left:([\d.]+)%">([^<]+)</g)].map((m) => [m[2], Number(m[1])]);
  assert.deepEqual(lefts, [["2 Nov", Number((100 / 7).toFixed(2))], ["16 Nov", Number((300 / 7).toFixed(2))], ["14 Dec", 100]]);
  assert.match(html, /lv-tick last" style="left:100.00%/);
});

/* The edge cases the UI flow met (2026-11-18): a chart of one week draws its point half way across, so its date belongs
   at 50%, not at the right edge; and a last week with no number still keeps the last slot's date. Each date must sit at
   the x of the point it names, as lineChart draws it, for any number of weeks. */
function drawn(LV, days, values) {
  const html = LV.lineChart("t", days, [{ name: "AI visits", color: "red", values }]);
  const xs = [...html.matchAll(/[ML]([\d.]+),/g)].map((m) => Number(m[1]) / 10);
  const dot = html.match(/<circle cx="([\d.]+)"/);
  const ticks = [...html.matchAll(/class="lv-tick[^"]*" style="left:([\d.]+)%">([^<]+)</g)].map((m) => [m[2], Number(m[1])]);
  return { xs, dot: dot ? Number(dot[1]) / 10 : null, ticks };
}
function lvDrawing() {
  const win = lvPage(), LV = win.LV;
  win.SCREENS.overview.init({ t: (s) => s, esc: (s) => String(s), num: (n) => String(n), icon: () => "", locale: () => "en-GB" });
  return LV;
}
const weeksTo = (n, last = "2026-11-17") => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${last}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 7 * (n - 1 - i)); return d.toISOString().slice(0, 10);
});

test("one week: its date sits half way, under the point drawn half way", () => {
  const LV = lvDrawing();
  const { dot, ticks } = drawn(LV, ["2026-11-17"], { "2026-11-17": 12 });
  assert.equal(dot, 50);
  assert.deepEqual(ticks, [["17 Nov", 50]]);
});

test("every date sits at the x of the point it names, the last week included", () => {
  const LV = lvDrawing();
  for (const n of [2, 3, 8, 14, 27, 53]) {
    const days = weeksTo(n);
    const { xs, ticks } = drawn(LV, days, Object.fromEntries(days.map((d, i) => [d, 10 + (i % 3)])));
    assert.equal(xs.length, n, `${n} points drawn`);
    assert.equal(ticks[ticks.length - 1][0], "17 Nov", `last week dated (${n})`);
    for (const [words, at] of ticks) {
      const i = days.findIndex((d) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)) === words);
      assert.ok(i >= 0, `${words} is one of the weeks (${n})`);
      assert.ok(Math.abs(at - xs[i]) < 0.01, `${words} at ${at}% sits under its point at ${xs[i]}% (${n})`);
    }
  }
});

test("a last week with no number keeps its date at the right edge, where its point would be", () => {
  const LV = lvDrawing();
  const days = weeksTo(8);
  const values = Object.fromEntries(days.map((d, i) => [d, i === 7 ? null : 5 + i]));
  const { xs, ticks } = drawn(LV, days, values);
  assert.ok(Math.abs(Math.max(...xs) - 85.71) < 0.01); // the line stops at week 7 (6 / 7 of the width)
  assert.deepEqual(ticks[ticks.length - 1], ["17 Nov", 100]);
});
