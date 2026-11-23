// Social → Video transcripts, driven by hand: connect Groq, paste links, watch a batch finish, open it, copy, download,
// upload a file, list a TikTok account, and a phone-width look. Needs a server whose yt-dlp and Groq are faked, so no
// real video site is reached:
//   DB_NAME_TEST=test_x_test .venv/bin/python tests/ui/transcripts_server.py --port 8233 --slow 0
// Usage: node tests/ui/flow_video_transcripts.cjs http://127.0.0.1:8233/ <shots dir>
const { open } = require("./pw.cjs");
const fs = require("fs");
const path = require("path");
const ROOT = process.argv[2] || "http://127.0.0.1:8233/";
const SHOTS = process.argv[3] || ".";
const wait = (page, ms) => page.waitForTimeout(ms);
const ok = (cond, what) => { if (!cond) throw new Error(`FAILED: ${what}`); console.log(`ok - ${what}`); };

(async () => {
  const { browser, page, problems } = await open({ url: `${ROOT}#social` });
  const failed = [];
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/api/auth/me")) failed.push(`${r.status()} ${r.url()}`); }); // auth/me is 404 on a server run without logins
  try {
    await wait(page, 1500);
    await page.click('[data-so-tab="transcripts"]');
    await page.waitForSelector(".vt .vt-add");
    ok(await page.isVisible(".vt-groq"), "without a Groq key the tab says how to connect it first");
    await page.screenshot({ path: path.join(SHOTS, "1-first-visit.png"), fullPage: true });

    await page.fill("#vt-key", "gsk_fake_key_for_the_trial");
    await page.click('[data-vt-form="key"] button[type="submit"]');
    await page.waitForSelector(".vt-groq", { state: "detached" });
    ok(true, "saving the key hides the Groq card");

    const links = ["https://www.tiktok.com/@maker.test/video/7700000000000000001?is_from_webapp=1", "check this https://www.tiktok.com/@maker.test/video/7700000000000000002",
      "https://www.instagram.com/reel/AbC123xyz/", "https://www.tiktok.com/@maker.test/video/7700000000000000001", "https://www.tiktok.com/@maker.test", "https://example.com/x"].join("\n");
    await page.fill("#vt-paste", links);
    await page.waitForFunction(() => /3 videos found/.test(document.querySelector(".vt-found")?.textContent || ""));
    ok(await page.isVisible("[data-vt-use-account]"), "an account link among the pasted ones offers to list that account");
    ok(/Write out 3 videos/.test(await page.textContent('[data-vt="start"]')), "the button says how many videos will be written out");
    ok(await page.evaluate(() => document.activeElement?.id === "vt-paste"), "the paste box keeps the focus while the count updates");
    await page.fill("#vt-name", "Rival – November");
    await page.screenshot({ path: path.join(SHOTS, "2-pasted.png"), fullPage: true });
    await page.click('[data-vt="start"]');
    await page.waitForSelector(".vt-batch.open .vt-item");
    ok((await page.$$(".vt-batch.open .vt-item")).length === 3, "the new batch opens with its three videos");
    await page.screenshot({ path: path.join(SHOTS, "3-working.png"), fullPage: true });

    await page.waitForFunction(() => /transcripts?/.test(document.querySelector(".vt-batch.open .vt-progress")?.textContent || "") && !/ of /.test(document.querySelector(".vt-batch.open .vt-progress")?.textContent || ""), null, { timeout: 90000 });
    await wait(page, 800);
    const text = await page.textContent(".vt-batch.open");
    ok(/From the video's captions/.test(text) && /Written out by Groq/.test(text), "each transcript says whether captions or Groq wrote it");
    ok(/Instagram cookies/.test(text), "the Instagram video that was refused says to add cookies");
    await page.screenshot({ path: path.join(SHOTS, "4-done.png"), fullPage: true });
    await page.locator(".vt-batch.open").screenshot({ path: path.join(SHOTS, "4b-batch.png") });

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.click(".vt-batch.open [data-vt-copy]");
    await wait(page, 300);
    ok((await page.evaluate(() => navigator.clipboard.readText())).length > 20, "Copy puts the transcript on the clipboard");

    await page.click(".vt-dl > summary");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click('.vt-dl-menu a[href$="format=docx"]')]);
    ok(/Rival-November\.docx$/.test(download.suggestedFilename()), `Download all gives a Word file named after the batch (${download.suggestedFilename()})`);

    await page.click('[data-vt-mode="file"]');
    const list = path.join(SHOTS, "links.csv");
    fs.writeFileSync(list, "name,link\nA,https://www.tiktok.com/@maker.test/video/7700000000000000003\nB,https://www.instagram.com/p/Zz9k/\n");
    await page.setInputFiles("#vt-file", list);
    await page.waitForFunction(() => /2 videos found/.test(document.querySelector(".vt-found")?.textContent || ""));
    ok(true, "a CSV file's links are found");

    await page.click('[data-vt-mode="account"]');
    await page.fill("#vt-account", "https://www.tiktok.com/@maker.test");
    await page.selectOption("#vt-count", "10");
    await page.click('[data-vt-form="account"] button[type="submit"]');
    await page.waitForSelector(".vt-pick-list li");
    ok((await page.$$(".vt-pick-list input:checked")).length === 10, "an account's latest 10 videos come back, all ticked");
    await page.click(".vt-pick-list li:nth-child(2) input");
    ok(/Write out 9 videos/.test(await page.textContent('[data-vt="start"]')), "unticking one leaves 9 to write out");
    await page.locator(".vt-add").screenshot({ path: path.join(SHOTS, "5-account.png") });

    await page.setViewportSize({ width: 390, height: 844 });
    await wait(page, 400);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(!wide, "no sideways scroll at phone width");
    await page.locator(".vt").screenshot({ path: path.join(SHOTS, "6-phone.png") });
    const real = problems.filter((p) => !/Failed to load resource/.test(p));
    ok(real.length === 0 && failed.length === 0, `no page errors or failed requests (${[...real, ...failed].join(" | ")})`);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
