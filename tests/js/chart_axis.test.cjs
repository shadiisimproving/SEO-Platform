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

function lv() {
  const page = { window: {}, console };
  page.window.window = page.window;
  page.window.addEventListener = () => {};
  page.document = { addEventListener: () => {}, querySelectorAll: () => [] };
  page.window.document = page.document;
  vm.createContext(page);
  for (const name of ["data.js", "shared-ui.js", "screens-live.js"]) {
    try { vm.runInContext(`with (window) {${fs.readFileSync(path.join(DIR, name), "utf8")}}`, page); } catch (err) { if (name === "screens-live.js") throw err; }
  }
  return page.window.LV;
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
