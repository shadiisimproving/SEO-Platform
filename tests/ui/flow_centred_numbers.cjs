// Every number column in every table should be centred, with its heading. Lists any that aren't.
// Needs the screens served. Usage: SCREENS_URL=http://127.0.0.1:8201/ node tests/ui/flow_centred_numbers.cjs [folder for screenshots]
const { open } = require("./pw.cjs");

const ROOT = process.env.SCREENS_URL || "http://127.0.0.1:8201/";
const SHOTS = process.argv[2];
const SCREENS = ["today", "keywords", "competitors", "tasks", "backlinks", "health", "settings"];

const scan = (page) => page.evaluate(() => {
  const off = [], right = [];
  let cells = 0;
  const textBox = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect();
  };
  for (const cell of document.querySelectorAll("table td.r, table td.c, table th.r, table th.c")) {
    if (!cell.getClientRects().length || !cell.textContent.trim()) continue;
    const name = `${cell.tagName.toLowerCase()} "${cell.textContent.trim().replace(/\s+/g, " ").slice(0, 40)}" in ${cell.closest("table").className}`;
    if (cell.tagName === "TD" && (cell.dataset.label === "" || cell.querySelector(":scope > button"))) { right.push(name); continue; }
    cells += 1;
    // A heading table-tools.js made sortable holds its words, (i) and logo in one button (its arrow sits outside the flow), so
    // the button is the label; a screen's own sort button keeps its words in a span.
    const box = cell.getBoundingClientRect(), label = cell.tagName === "TH" && (cell.querySelector("button.tt-th") || cell.querySelector("button > span"));
    const inner = label ? label.getBoundingClientRect() : textBox(cell);
    const gap = Math.abs((box.left + box.right) / 2 - (inner.left + inner.right) / 2);
    if (gap > 2) off.push(`${name}: ${gap.toFixed(1)}px off`);
  }
  return { off, right, cells, rows: document.querySelectorAll("table tbody tr").length };
});

(async () => {
  const { browser, page, problems } = await open({ width: 1440, height: 1000 });
  const off = new Set(), right = new Set();
  let cells = 0;
  const take = async (where) => {
    await page.waitForTimeout(300);
    const r = await scan(page);
    cells += r.cells;
    r.off.forEach((x) => off.add(`${where} | ${x}`));
    r.right.forEach((x) => right.add(x.replace(/"[^"]*"/, (m) => m.slice(0, 20))));
  };
  for (const screen of SCREENS) {
    await page.goto("about:blank");
    await page.goto(`${ROOT}?theme=light&lang=en#${screen}`);
    await page.waitForTimeout(600);
    await take(screen);
    const tabs = await page.locator('#page [role="tab"]').count();
    for (let i = 0; i < tabs; i++) {
      const tab = page.locator('#page [role="tab"]').nth(i);
      if (!(await tab.isVisible().catch(() => false))) continue;
      await tab.click({ timeout: 2000 }).catch(() => {});
      await take(`${screen}/tab${i}`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/centre-${screen}-${i}.png` });
    }
    if (SHOTS && !tabs) await page.screenshot({ path: `${SHOTS}/centre-${screen}.png` });
  }
  console.log(`number cells checked: ${cells}`);
  console.log(`\n== off centre (${off.size})`); [...off].slice(0, 60).forEach((x) => console.log(x));
  console.log(`\n== action cells left on the right (${right.size})`); [...right].slice(0, 14).forEach((x) => console.log(x));
  const other = problems.filter((p) => !p.includes("status of 404") && !p.includes("ERR_CONNECTION_RESET"));
  console.log(`\npage errors: ${other.length}`); other.slice(0, 8).forEach((p) => console.log(p));
  await browser.close();
  process.exit(off.size ? 1 : 0);
})();
