async (page) => {
  const dir = '/private/tmp/claude-501/-Users-alwaysimproving/3e6321c4-6c42-4bba-b652-6ddce3b4d385/scratchpad/shots/';
  const csv = '/Users/alwaysimproving/Documents/Claude & VS/seo-command-center/var/ui-test-csv/';
  const root = 'http://127.0.0.1:8201/';
  const NOTE = 'Prospect list only. This filters a CSV and adds the links you keep to In consideration. It does not check rankings or track these links.';
  const log = [];
  const check = (name, ok, extra) => log.push((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' -- ' + String(extra).slice(0, 170) : ''));
  const errs = [];
  const onC = m => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text().slice(0, 200)); };
  const onE = e => errs.push('pageerror: ' + e.message.slice(0, 250));
  page.on('console', onC); page.on('pageerror', onE);
  page.setDefaultTimeout(8000);
  const wait = ms => page.waitForTimeout(ms);
  const open = async (hash = 'backlinks', w = 1440, q = '?look=blue&theme=light&lang=en') => { await page.setViewportSize({ width: w, height: 900 }); await page.goto('about:blank'); await page.goto(root + q + '#' + hash); await wait(1200); };
  const tiles = () => page.evaluate(() => [...document.querySelectorAll('#bl-tiles .tile')].map(t => t.querySelector('.lab').innerText.trim() + '=' + t.querySelector('.fig').innerText.trim()).join(' '));
  const lastToast = async () => { const n = await page.locator('.toast').count(); return n ? (await page.locator('.toast').nth(n - 1).innerText()).replace(/\s+/g, ' ').trim() : ''; };
  const clearToasts = async () => { for (let i = 0; i < 4; i++) { const b = page.locator('.toast [data-dismiss]').first(); if (await b.count()) { await b.click(); await wait(170); } } };
  const upload = async (name) => { await page.locator('#cleaner-file').setInputFiles(csv + name); await wait(350); };
  const openTool = async () => { await page.locator('#cleaner-open').click(); await wait(350); };
  const stats = () => page.evaluate(() => [...document.querySelectorAll('.clean-stat')].map(s => s.querySelector('.lab').innerText + '=' + s.querySelector('.n').innerText).join(' '));
  const rowsCount = () => page.locator('#pr-table tbody tr').count();

  try {
    await page.goto(root); await page.evaluate(() => localStorage.clear());
    await open();
    const before = await tiles();
    log.push('INFO tiles: ' + before);
    check('Done is the default section', (await page.locator('[data-bl-section="done"]').getAttribute('aria-selected')) === 'true');
    const subTabs = await page.locator('.content .tabs:not(.sections) .tab').allInnerTexts();
    check('Done keeps all three tabs', subTabs.length === 3 && subTabs[0].includes('All backlinks') && subTabs[1].includes('Mediators') && subTabs[2].includes('Found but never logged'), subTabs.join(' | ').replace(/\s+/g, ' '));
    check('Done has Import CSV', (await page.locator('#bulk-open').innerText()).includes('Import CSV'));
    check('Done has no filter tool', (await page.locator('#cleaner-open').count()) === 0);
    await page.locator('.tab', { hasText: 'Mediators' }).click(); await wait(120);
    await page.locator('.tab', { hasText: 'Found but never logged' }).click(); await wait(120);
    check('Found tab still works', (await page.locator('[data-log-found]').count()) === 3);
    await page.locator('.tab', { hasText: 'All backlinks' }).click(); await wait(120);

    // In consideration, empty.
    await page.locator('[data-bl-section="consideration"]').click(); await wait(350);
    check('note shows next to the button', (await page.locator('.tool-band p').innerText()).trim() === NOTE);
    check('button is named correctly', (await page.locator('#cleaner-open').innerText()).trim() === 'Filter a backlink CSV');
    check('Import CSV is not in this section', (await page.locator('#bulk-open').count()) === 0);
    check('empty state explains what to do', (await page.locator('.empty h3').innerText()).includes('Nothing in consideration'));
    check('top cards still show', (await tiles()) === before);
    await page.screenshot({ path: dir + 'p-empty.png' });

    // Upload: see the result, nothing added.
    await openTool();
    check('note shows in the dialog', (await page.locator('#dlg .prospect-note').innerText()).trim() === NOTE);
    await page.screenshot({ path: dir + 'p-dialog.png' });
    await upload('semrush_export.csv');
    check('summary numbers', (await stats()) === 'Total=10 Kept=7 Removed=3 Duplicates=3', await stats());
    const tableText = await page.locator('.clean-table').innerText();
    check('blank and unreadable spam show unknown', (tableText.match(/unknown/g) || []).length === 2, tableText.replace(/\s+/g, ' ').slice(0, 170));
    const spamCells = await page.locator('.clean-table tbody tr td:nth-child(5)').allInnerTexts();
    check('no spam cell shows 0 for a blank', !spamCells.includes('0'), spamCells.join(','));
    check('.co.uk reduced to its root domain', tableText.includes('uae-guide.example.co.uk'));
    check('flags say where', tableText.includes('Already in Done') && tableText.includes('In Found but never logged') && tableText.includes('Twice in this file'));
    check('authority column names its source', tableText.includes('Authority Score (SEMrush)'));
    check('no ranking, tracking or Live/Lost marks', (await page.locator('#dlg .status, #dlg .pos, #dlg .chg').count()) === 0 && !/\b(Live|Lost|Nofollow)\b/.test(tableText));
    check('Add is off until something is chosen', await page.locator('#cleaner-add').isDisabled());
    await page.screenshot({ path: dir + 'p-result.png' });

    // Cancel: nothing added. Same file again: not all duplicates.
    await page.locator('.dlg-foot [data-close-dlg]').click(); await wait(250);
    check('cancel adds nothing', (await rowsCount()) === 0 && (await page.locator('[data-bl-section="consideration"]').innerText()).includes('0'));
    await openTool(); await upload('semrush_export.csv');
    check('same file twice: duplicates do not grow', (await stats()) === 'Total=10 Kept=7 Removed=3 Duplicates=3', await stats());

    // Choose two by hand.
    await page.locator('[data-cleaner-row="0"]').check();
    await page.locator('[data-cleaner-row="2"]').check(); await wait(80);
    check('button counts the choice', (await page.locator('#cleaner-add').innerText()) === 'Add 2 to In consideration', await page.locator('#cleaner-add').innerText());
    check('header box shows a partial choice', await page.locator('#cleaner-all').evaluate(b => b.indeterminate));
    await page.locator('#cleaner-add').click(); await wait(450);
    check('two added', (await rowsCount()) === 2, await rowsCount());
    check('toast confirms, with Undo', (await lastToast()).includes('2 links added to In consideration') && (await lastToast()).includes('Undo'), await lastToast());
    check('TOP CARDS UNCHANGED after adding prospects', (await tiles()) === before, await tiles());
    await page.screenshot({ path: dir + 'p-added.png' });
    await page.locator('.toast [data-undo]').click(); await wait(300);
    check('Undo removes them', (await rowsCount()) === 0);
    await clearToasts();

    // Add again, then upload the same file: those are now flagged.
    await openTool(); await upload('semrush_export.csv');
    await page.locator('[data-cleaner-row="0"]').check(); await page.locator('[data-cleaner-row="2"]').check();
    await page.locator('#cleaner-add').click(); await wait(400); await clearToasts();
    await openTool(); await upload('semrush_export.csv');
    check('after confirming, those domains are flagged', (await stats()) === 'Total=10 Kept=7 Removed=3 Duplicates=5', await stats());
    check('flag names In consideration', (await page.locator('.clean-table').innerText()).includes('Already in consideration'));

    // All at once, and new only.
    await page.locator('#cleaner-new-only').click(); await wait(60);
    check('new only picks non-duplicates', (await page.locator('#cleaner-add').innerText()) === 'Add 2 to In consideration', await page.locator('#cleaner-add').innerText());
    await page.locator('#cleaner-clear').click(); await wait(40);
    check('clear empties the choice', await page.locator('#cleaner-add').isDisabled());
    await page.locator('#cleaner-all').check(); await wait(60);
    check('select all takes all 7', (await page.locator('#cleaner-add').innerText()) === 'Add 7 to In consideration', await page.locator('#cleaner-add').innerText());
    await page.locator('#cleaner-add').click(); await wait(450); await clearToasts();
    check('9 prospects now', (await rowsCount()) === 9, await rowsCount());
    check('TOP CARDS UNCHANGED after adding all', (await tiles()) === before, await tiles());
    await page.screenshot({ path: dir + 'p-list.png', fullPage: false });

    // What each prospect shows.
    const prText = await page.locator('#pr-table').innerText();
    check('shows domain, authority source, file, flag, unknown', prText.includes('uae-guide.example.co.uk') && prText.includes('Authority Score (SEMrush)') && prText.includes('semrush_export.csv') && prText.includes('Already in consideration') && prText.includes('Already in Done') && prText.includes('unknown'));
    check('no status, visits, leads or cost columns', !/\b(Status|Visits|Leads|Cost per visit|Mediator)\b/.test(await page.locator('#pr-table thead').innerText()), (await page.locator('#pr-table thead').innerText()).replace(/\s+/g, ' '));
    check('no ranking or Live/Lost marks on prospects', (await page.locator('#pr-table .status, #pr-table .pos, #pr-table .chg').count()) === 0 && !/\b(Live|Lost|Nofollow)\b/.test(prText));

    // Remove and undo.
    await page.locator('[data-prospect-remove]').first().click(); await wait(250);
    check('remove works', (await rowsCount()) === 8);
    check('TOP CARDS UNCHANGED after removing', (await tiles()) === before);
    await page.locator('.toast [data-undo]').click(); await wait(250);
    check('undo restores it', (await rowsCount()) === 9);
    await clearToasts();

    // Mark as done, cancel.
    const row = page.locator('#pr-table tbody tr', { hasText: 'invest-gulf.example' }).first();
    await row.locator('[data-prospect-done]').click(); await wait(500);
    check('form prefilled with the source URL', (await page.locator('#bl-src').inputValue()) === 'https://invest-gulf.example/fr/guide', await page.locator('#bl-src').inputValue());
    check('site comes from the prospect', (await page.locator('#bl-site').inputValue()) === 'site-one.example');
    check('cursor goes to Target page', await page.evaluate(() => document.activeElement.id === 'bl-target'));
    check('no Import CSV switch here', (await page.locator('[data-add-mode]').count()) === 0);
    await page.screenshot({ path: dir + 'p-mark-done.png' });
    await page.locator('[data-discard-panel]').click(); await wait(350);
    check('Cancel leaves the prospect', (await rowsCount()) === 9 && (await page.locator('#pr-table').innerText()).includes('invest-gulf.example'));
    check('Cancel creates no backlink', (await tiles()) === before);
    await clearToasts();
    // Esc with typing: draft kept, prospect stays.
    await row.locator('[data-prospect-done]').click(); await wait(400);
    await page.locator('#bl-target').fill('/guide/');
    await page.keyboard.press('Escape'); await wait(350);
    check('Esc keeps a draft, prospect stays', (await lastToast()).includes('Draft kept') && (await rowsCount()) === 9, await lastToast());
    await row.locator('[data-prospect-done]').click(); await wait(400);
    check('draft comes back', (await page.locator('#bl-target').inputValue()) === '/guide/');
    // Save: only now it moves.
    await page.locator('#bl-anchor').fill('guide investir');
    await page.locator('#bl-save').click(); await wait(500);
    check('saving lands on Done', (await page.locator('[data-bl-section="done"]').getAttribute('aria-selected')) === 'true');
    check('tracked backlink exists', (await page.locator('#bl-table').innerText()).includes('invest-gulf.example/fr/guide'));
    const nb = page.locator('#bl-table tbody tr', { hasText: 'invest-gulf.example' });
    check('CSV score not copied into the Authority column', (await nb.locator('td').nth(3).innerText()).trim() === '—', await nb.locator('td').nth(3).innerText());
    check('real backlink counts in the cards', (await tiles()).startsWith('Total=8 Live=6'), await tiles());
    await page.locator('[data-bl-section="consideration"]').click(); await wait(300);
    check('prospect has left In consideration', (await rowsCount()) === 8 && !(await page.locator('#pr-table').innerText()).includes('invest-gulf.example/fr/guide'));
    await clearToasts();

    // Errors, all in plain words, listing headers.
    await openTool();
    await upload('no_spam_column.csv');
    const e1 = await page.locator('#cleaner-error').innerText();
    check('missing spam column names the headers', e1.includes('spam score') && e1.includes('Source URL, Authority Score, Title'), e1);
    await upload('no_url_column.csv');
    const e2 = await page.locator('#cleaner-error').innerText();
    check('missing URL column names the headers', e2.includes('URL') && e2.includes('Title, Spam Score'), e2);
    await upload('empty.csv');
    check('empty file', (await page.locator('#cleaner-error').innerText()).includes('empty'));
    await upload('picture.png');
    check('not a csv', (await page.locator('#cleaner-error').innerText()).includes('.csv'));
    await upload('over_10mb.csv');
    check('over 10 MB refused', (await page.locator('#cleaner-error').innerText()).includes('10 MB'), await page.locator('#cleaner-error').innerText());
    await page.screenshot({ path: dir + 'p-error.png' });
    await upload('all_removed.csv');
    check('all removed: says so, no add', (await page.locator('.note').innerText()).includes('nothing to add') && await page.locator('#cleaner-add').isDisabled());
    await page.locator('#cleaner-again').click(); await wait(150);
    await upload('ubersuggest_bom_semicolon.csv');
    const ub = await page.locator('.clean-table').innerText();
    check('BOM + semicolon read; decimal comma; .com.ae', (await stats()) === 'Total=3 Kept=2 Removed=1 Duplicates=0' && ub.includes('12.5') && ub.includes('guide-emirats.example.com.ae') && ub.includes('Domain Authority (Ubersuggest)'), (await stats()) + ' ' + ub.replace(/\s+/g, ' ').slice(0, 120));
    // Another site: not a duplicate there.
    await page.locator('#cleaner-again').click(); await wait(150);
    await page.locator('#cleaner-site').selectOption('site-two.example');
    await upload('semrush_export.csv');
    const other = await stats();
    log.push('INFO same file for site-two: ' + other);
    await page.locator('.dlg-foot [data-close-dlg]').click(); await wait(200);

    // Big files.
    const t0 = Date.now();
    await openTool(); await upload('large_5000_rows.csv');
    await page.locator('.clean-stat').first().waitFor();
    const t1 = Date.now();
    await page.locator('#cleaner-all').check(); await wait(50);
    const shownRows = await page.locator('.clean-table tbody tr').count();
    check('5,000 rows: all selectable, 200 shown', shownRows === 200 && (await page.locator('#cleaner-add').innerText()).includes('5,000'), await page.locator('#cleaner-add').innerText());
    await page.locator('#cleaner-add').click(); await page.locator('#prospect-more').waitFor();
    const t2 = Date.now();
    log.push('INFO 5,000 rows: filter ' + (t1 - t0) + ' ms, add and redraw ' + (t2 - t1) + ' ms');
    check('long list shows 100 and Show more', (await rowsCount()) === 100);
    check('TOP CARDS UNCHANGED after 5,000 prospects', (await tiles()).startsWith('Total=8 Live=6'), await tiles());
    await clearToasts();
    const t3 = Date.now();
    await openTool(); await upload('almost_10mb.csv'); await page.locator('.clean-stat').first().waitFor({ timeout: 20000 });
    log.push('INFO 3.8 MB file: ' + (Date.now() - t3) + ' ms, ' + (await stats()));
    await page.locator('.dlg-foot [data-close-dlg]').click(); await wait(150);

    // Today's Review link lands on Done.
    await page.locator('.nav-item[data-go="today"]').click(); await wait(400);
    await page.locator('[data-act="backlinks"]').click(); await wait(400);
    check('Today Review opens Done with the lost filter', (await page.locator('[data-bl-section="done"]').getAttribute('aria-selected')) === 'true' && (await page.locator('[data-bl-filter="lost"]').getAttribute('aria-pressed')) === 'true');

    // Phone.
    await open('backlinks', 375);
    await page.locator('[data-bl-section="consideration"]').click(); await wait(300);
    await openTool(); await page.locator('#cleaner-sample').click(); await wait(300);
    await page.locator('#cleaner-select-all').click(); await wait(60);
    await page.screenshot({ path: dir + 'p-phone-dialog.png' });
    await page.locator('#cleaner-add').click(); await wait(500);
    await page.screenshot({ path: dir + 'p-phone-list.png' });
    check('phone: no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    // French and first run.
    await open('backlinks', 1440, '?look=blue&theme=light&lang=fr');
    await page.locator('[data-bl-section="consideration"]').click(); await wait(300);
    check('French note', (await page.locator('.tool-band p').innerText()).startsWith('Liste de prospects uniquement'));
    await open('backlinks', 1440, '?look=blue&theme=light&lang=en&data=first');
    check('first run: sections present', (await page.locator('[data-bl-section]').count()) === 2 && (await page.locator('#bulk-open').count()) === 1);
    await page.locator('[data-bl-section="consideration"]').click(); await wait(250);
    check('first run: filter tool present', (await page.locator('#cleaner-open').count()) === 1);
  } catch (e) { log.push('ABORT ' + e.message.split('\n').slice(0, 3).join(' | ').slice(0, 320)); }
  page.off('console', onC); page.off('pageerror', onE);
  return { fails: log.filter(l => l.startsWith('FAIL') || l.startsWith('ABORT')), passed: log.filter(l => l.startsWith('PASS')).length, info: log.filter(l => l.startsWith('INFO')), console: errs.slice(0, 8) };
}
