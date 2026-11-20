// Social, driven by hand like a normal user: today's drafts, editing an Arabic post, Post on X (the prefilled X page),
// a comment opened then replied to, Skip with a reason, Rewrite with my angle, Mark posted, the Writing guide (teach a
// rule, a suggestion), 390 px and dark mode. Made-up sites only.
// Needs: DB_NAME_TEST=test_social_test .venv/bin/python tests/ui/app_server.py --port 8231 --slow 0, then the seed in the PR notes.
// Usage: SCREENS_URL=http://127.0.0.1:8231/ node tests/ui/flow_social.cjs [folder for screenshots]
const path = require("path");
const { open, menu } = require("./pw.cjs");

const ROOT = process.env.SCREENS_URL || "http://127.0.0.1:8231/";
const SHOTS = process.argv[2];
const fails = [];
// /api/auth/me answers 404 in the harness, which has no login, and the bad feed address is refused with a 400 on purpose.
const real = (problems) => problems.filter((p) => !/Failed to load resource: .*(404|400)/.test(p));
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };
const settle = (page, ms = 900) => page.waitForTimeout(ms);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };

async function start(width = 1440, height = 1000) {
  const run = await open({ width, height });
  await run.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(ROOT).origin });
  await run.page.addInitScript(() => { window.__opened = []; window.open = (url) => { window.__opened.push(url); return {}; }; });
  await run.page.goto(`${ROOT}#social`);
  await run.page.waitForSelector(".so-item", { timeout: 15000 });
  await settle(run.page);
  return run;
}

(async () => {
  const run = await start();
  const { page } = run;
  await shot(page, "1-today");
  check(/to check/.test(await page.textContent(".so-verdict")), "the verdict says what's left to check");
  check(await page.isVisible(".so-stage-bad"), "Grok's failed step is shown");
  check((await page.textContent(".so-stage-bad")).includes("grok login"), "…with the command that fixes it");
  const arabic = page.locator("textarea.so-ar").first();
  check((await arabic.getAttribute("dir")) === "rtl" && (await arabic.getAttribute("lang")) === "ar", "Arabic posts are written right to left");
  const english = page.locator('.so-item:has(.so-lang) textarea[lang="en"]').first();
  check((await english.count()) === 1 && (await english.getAttribute("dir")) === "auto", "an English comment stays left to right");
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "no sideways scroll on desktop");

  // Edit the X post and send it: the X page opens with the words, and it waits as "opened".
  const xPost = page.locator(".so-item", { has: page.locator(".so-platform", { hasText: /^X$/ }) }).filter({ has: page.locator('[data-so-send]', { hasText: "Post on X" }) }).first();
  const box = xPost.locator("textarea");
  await box.fill("منشور قصير معدل عن الإعفاء الضريبي");
  await settle(page, 1300);
  check((await xPost.textContent()).includes("saved"), "an edit saves by itself");
  await xPost.locator('[data-so-send]').click();
  await settle(page);
  const opened = await page.evaluate(() => window.__opened.slice());
  check(opened[0]?.startsWith("https://x.com/intent/post?text=") && decodeURIComponent(opened[0]).includes("منشور قصير معدل"), "Post on X opens X with the edited words");
  check((await page.locator(".so-item .status.warn").count()) >= 1, "it now waits as opened, not posted");
  await page.locator('[data-so-status][data-to="posted"]').first().click();
  await settle(page);
  check((await page.locator(".so-item .status.good").count()) === 1, "Mark posted marks it posted");

  // The comment on X: Open the post comes first, then Reply on X with in_reply_to.
  const xComment = page.locator(".so-item", { has: page.locator(".so-lang") }).filter({ has: page.locator('[data-so-send]', { hasText: "Reply on X" }) });
  check((await xComment.locator("a.btn-main", { hasText: "Open the post" }).count()) === 1, "a comment's first button opens the post");
  await xComment.locator("a[data-so-open]").evaluate((a) => a.addEventListener("click", (e) => e.preventDefault(), { once: true }));
  await xComment.locator("a[data-so-open]").click();
  await settle(page, 400);
  check((await xComment.locator("button.btn-main", { hasText: "Reply on X" }).count()) === 1, "once opened, Reply on X is the main button");
  await xComment.locator("[data-so-send]").click();
  await settle(page);
  const reply = (await page.evaluate(() => window.__opened.slice())).pop();
  check(/in_reply_to=1858000000000000001/.test(reply || ""), "Reply on X answers that post");

  // LinkedIn comment: Skip with a reason.
  const liComment = page.locator(".so-item", { has: page.locator(".so-lang") }).filter({ has: page.locator('[data-so-send]', { hasText: "Copy comment" }) });
  await liComment.locator("[data-so-skip]").click();
  await shot(page, "2-skip-reasons");
  await liComment.locator('[data-reason="Too formal"]').click();
  await settle(page);
  check((await page.locator(".so-item .status", { hasText: "Skipped" }).count()) === 1, "Skip with a reason skips it");

  // LinkedIn post: Rewrite with my angle.
  const liPost = page.locator(".so-item").filter({ has: page.locator('[data-so-send]', { hasText: "Copy and open LinkedIn" }) });
  await liPost.locator("[data-so-angle]").click();
  await page.locator('[id^="so-angle-"]').fill("Talk about the cost of an office");
  await page.locator("[data-so-rewrite-go]").click();
  await settle(page);
  check((await page.locator(".so-item .status", { hasText: "Rewriting next run" }).count()) === 1, "Rewrite sends it back with my angle");

  // Writing guide.
  await page.click('[data-so-tab="guide"]');
  await settle(page);
  await page.fill("#so-rule", "Say نحن, not أنا");
  await page.click('#so-teach button[type="submit"]');
  await settle(page);
  check((await page.locator(".so-rules li", { hasText: "Say نحن" }).count()) === 1, "a taught rule joins the guide");
  await page.locator('[data-so-proposal][data-accept="1"]').click();
  await settle(page);
  check((await page.locator(".so-rules li", { hasText: "900 characters" }).count()) === 1, "an accepted suggestion becomes a rule");
  await page.fill("#so-src-rss", "not a link");
  await page.locator('[data-so-add-source="rss"] button').click();
  await settle(page);
  check((await page.textContent("#so-src-error")).length > 5, "a bad feed address says what's wrong beside the field");
  await shot(page, "3-guide");
  check(!real(run.problems).length, `no errors in the page ${real(run.problems).join(" | ")}`);
  await run.browser.close();

  // Phone and dark mode.
  const phone = await start(1300, 900);
  await phone.page.setViewportSize({ width: 390, height: 860 });
  await settle(phone.page);
  await shot(phone.page, "4-phone");
  check(!(await phone.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "no sideways scroll at 390 px");
  await phone.page.setViewportSize({ width: 1300, height: 900 });
  await menu(phone.page, "theme");
  await settle(phone.page);
  await shot(phone.page, "5-dark");
  check(!real(phone.problems).length, `no errors on phone or dark ${real(phone.problems).join(" | ")}`);
  await phone.browser.close();

  console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
