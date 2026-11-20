# SEO Command Center

Internal app for tracking websites in SEO: per-site data, tasks, backlinks, competitor edits and rankings. Any website can be added inside the app. It has no connection to the CRM.

- **Plan:** `~/.claude/plans/plan-seo-command-center-free-apis.md`
- **Measured results:** `reports/phase-0-results.md`

## Where it runs

Built on the Mac, runs on o2switch: setup and uploads are in `deploy/DEPLOY.md`. **Nothing is uploaded until the owner says so.** Scheduled jobs only run on hosting, through cron. On the Mac, everything is run by hand. Do not add launchd: macOS hangs launch agents that touch `~/Documents`.

## Set up on a new machine

```bash
/opt/homebrew/bin/python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
scripts/setup_db.sh                 # creates the 2 databases and user, writes .env
.venv/bin/python -m seo.core.crypto init   # creates the key outside the project
.venv/bin/alembic upgrade head
.venv/bin/python -m seo.accounts create-admin --username you --name "Your name"   # prints a temporary password once
```

`setup_db.sh` only touches `seo_command_center` and `seo_command_center_test`. The encryption key is at `~/.config/seo-command-center/key`. It never goes in `.env`, git or a dump. Keep a copy in a password manager; losing it means re-pasting every API key.

## Everyday commands

```bash
.venv/bin/pytest                                  # tests use the real MariaDB test database
.venv/bin/python -m seo.worker tick --lane crawl  # one short pass of one lane (also: refresh)
.venv/bin/python -m seo.worker links-due          # queue weekly link checks
.venv/bin/python -m seo.worker health-due         # queue monthly health tests
.venv/bin/python -m seo.worker competitors-due    # queue competitor reads, resume waiting keyword lists
.venv/bin/python -m seo.worker uptime-due         # queue an uptime check of each of my sites, every 15 minutes on hosting
.venv/bin/python -m seo.worker backlinks-due      # queue live checks of backlinks, daily on hosting: each link is read monthly, or by Check now
.venv/bin/python -m seo.worker collect-due        # queue each site's data sources that are due
.venv/bin/python -m seo.worker tick --lane collectors   # read Search Console, GA4, Bing, Yandex, Clarity, PageSpeed
.venv/bin/python scripts/backup_db.py             # a compressed copy of the database, keeps the newest 14
.venv/bin/alembic revision --autogenerate -m "what changed"
.venv/bin/alembic upgrade head
```

## Trying the app by hand

```bash
# The real app and worker on a fake internet: sample sites, a fake search tool, no network.
# It empties the test database it's given, and refuses any name not ending in _test.
DB_NAME_TEST=seo_cc_b_test .venv/bin/python tests/ui/app_server.py --port 8210   # add --empty for a first-run world, --keep to keep what's there
```

To run it for real on the Mac, with real tools and websites, use `.venv/bin/python scripts/run_local.py` (port 8200). Common Crawl for Link gaps runs by hand on the Mac, about 9 GB to download: `.venv/bin/python scripts/common_crawl_links.py`.

Then open `http://127.0.0.1:8210/`. The harness has no login unless you add `--login` (admin@example.com / demo-password-1). It answers as a fake Google, Bing, Yandex, Clarity and PageSpeed (`tests/ui/fake_google.py`), so a robot key of any content connects and data flows through the real collectors. `tests/ui/flow_live_screens.cjs` walks through it. Opened as a plain file, `design/mockups/index.html` runs on sample data. After changing an API answer, rebuild that data with `DB_NAME_TEST=seo_cc_snap_test .venv/bin/python design/build_comp_sample.py`.

## Rules the code depends on

- **Login:** `create_app` guards everything by default (`seo/web/auth.py`): a new blueprint is protected without anyone remembering to. Only tests and the harness pass `auth=False`. Every change needs the `X-CSRF-Token` header, which `design/mockups/auth.js` adds to every `fetch`. A session ends at once when its password changes or its account is disabled. Keys, Team and connections are admin only.
- **Served or plain file:** the server answers `/boot.js` with the real sites, before any screen runs. `design/mockups/boot.js` is the empty copy a plain file gets. `window.BOOT` decides, and `live.js` then removes every sample row. No sample row may ever show when served.
- **Screens on real data:** `screens-live.js` (Overview, Channels, Conversions, Content, AI search, Resources), `settings-live.js`. Form field names start with `f_`: DOMPurify strips names that clash with form properties, such as `name` and `title`.
- **Collectors:** `seo/collectors/`, one job per site and source in the `collectors` lane. `common.pending_days` asks the database what's missing, so a killed job carries on, and a day is replaced whole. A key refused raises one alert and stops; a limit reached stops for today; an outage tries again in 15 minutes. `seo/sources/credentials.py` is the only code that knows a Google connection's kind. **None has run on a real key.**
- **GROUP BY text:** collations treat `BL-1` and `bl-1`, or `é` and `e`, as equal. GA4 values are case sensitive, so group by the stored `row_hash`, never by the text.
- **MariaDB HAVING:** an alias of `SUM(IF(...))` can't be used in `HAVING` or `ORDER BY` (error 1247). Repeat the expression.
- **Tables in a card:** `.data th` is sticky to the page, which pushes it over the first row inside a card. `.card .table-wrap .data th` turns that off.
- **AI summaries:** `seo/extras/summaries.py` is the only code that calls a language model. It asks only for `openrouter/free`, only on a click, and keeps each answer per language in `change_events.summaries`. Page text is wrapped as data in the prompt, and the answer is always escaped and labelled as AI. `design/mockups/change-summary.js` adds the button: a row needs `id` and `summaries` from the API.
- **Google Ads is Soon:** `screens-live.js` doesn't register `adsPage`, so the menu shows the tag. GA4 keeps storing its numbers.
- **Chart colours:** `--ch-1` to `--ch-5` in `screens-live.css` passed the colour-blindness validator in both modes, in the order blue, orange, violet, teal, magenta. A channel keeps its colour by name.

- **Times:** every session is forced to UTC; the queue takes its times from the database.
- **Connections:** at most 5 per process, because o2switch allows 35 per DB user.
- **Jobs:** handlers must be safe to run twice. A killed process's job is taken back when its lease ends. That isn't counted as a failed attempt.
- **Long scans:** the links checker and the health test always read the whole website. A job works for about 40 s, saves its state in `crawl_states` and raises `RunAgain`, so the same job goes back in the queue. Out of daily budget it waits for the next UTC day, still running.
- **Crawler:** says it is a bot (`PageChangeBot`), follows robots.txt, stays 3 s apart per domain, and refuses private addresses on every redirect. A site that blocks it is reported as blocked. It never evades.
- **Scraped rankings:** only a click starts them, with one exception: uploading a keyword list checks each never-checked keyword once, free tools only. No schedule may ever spend search credits.
- **My sites and competitors:** `sites.kind` is the only thing that says a site is mine. The Links Checker and the health test refuse anything else, in the API and again in the worker.
- **Uptime:** a check older than 45 minutes reads as Unknown, never Up, and a day with no checks stays Not watched. A site is only Down if it fails twice; a site that turns the app away is Unknown. Domain dates come from RDAP, or by hand for endings with no server such as `.ae`, and a date entered by hand is never replaced. `seo/uptime/service.py`.
- **Backlink sections:** In consideration (`prospects`), To do (`seo/backlinks/todo.py`, `design/mockups/links-todo.js`) and Done. A To do link is a backlink with status `planned`: it never counts in the cards and is never read until it's placed, when its real article address replaces the old one. DA is the `authority` column, PA is `page_authority`, and `rating` is 1 to 5, set by hand. Browser flows: `tests/ui/flow_consideration_filters.cjs`, `flow_backlink_todo.cjs`, `flow_csv_prospects_saved.cjs`.
- **Live link checks:** `seo/backlinks/live.py`. Nothing is deleted. One clean miss on the monthly check waits a day and needs a second before a link is flagged lost; Check now counts at once. A page that couldn't be read never counts. A lost link that reappears goes back to live. `traffic_targets()` and `backlinks.service.traffic_provider` are where visits and leads plug in.
- **Mediators:** a name typed on a link or in a spreadsheet makes the mediator, and only fills in what's blank. Links keep the name as typed, and a rename carries over to them.
- **Backlinks:** bulk upload uses one template, `templates/backlinks-template.csv`, explained for the owner in `templates/README.md`. The Download the template button gives the same bytes, and a test checks that. Every column is kept in the `backlinks` table and shown on the link's panel: our site, source page, target page, anchor text, link type, status, date placed, due date, renewal date, price as typed plus the number read from it, mediator, contact, platform, the 3 UTM values, owner and notes. Only the source page is required. The column matching and row checks are in `design/mockups/bulk-links.js`, and `seo/backlinks/service.py` has the server's copy of the status words, limits and price reading.
- **Tasks:** one board the team shares (`seo/tasks/service.py`, `design/mockups/tasks.js`). `tasks.open_source_key` keeps one open task per finding, with the same trick as `jobs.active_key`. Screens add a button with `UI.taskButton({ title, host, source })`. A `source.key` must stay the same when the finding is seen again, so it's built from the site and the check, never the test or scan.
- **Task findings:** `_finding_now()` in `seo/tasks/service.py` only suggests. A task says "Looks fixed" or "Found again" when a full check newer than the task says so, and it never closes itself. A check that didn't read every page, or skipped other websites for a link to one, proves nothing.
- **Addresses:** `urlNow()` and `applyUrl()` in `mockup.js` hold the screen, tab, pair and site, so Back works and a view can be shared. Anything that opens a new view without a full redraw calls `UI.syncUrl()`.
- **Test databases:** pytest and `tests/ui/app_server.py` both default to `seo_command_center_test`, and each wipes it. Give one of them `DB_NAME_TEST=seo_cc_snap_test`.
- **Clarity:** at most one pass per site per UTC day (`scripts/clarity_daily.py`). A second pass would exceed the 10 requests a day allowed per project.
- **Old Clarity data:** `scripts/clarity_archive_export.py` runs on the Mac and writes daily counts to `var/clarity-archive.json`. An admin uploads that in Settings → Microsoft Clarity → Old Clarity data (`seo/imports/clarity_archive.py`). The old `clarity.db` never goes to the server: it also holds visitor session ids, recording links and encrypted tokens. Pages, devices and countries stay behind too, because `clarity_daily` has no place for them. An upload only adds missing days, for sites already in the app, and leaves `site_sources` alone, so Clarity doesn't look connected. Days from the recordings export have sessions and referrers only: their clicks and scroll depth are NULL, and `metrics.clarity` answers None for them, never 0. Browser flow: `tests/ui/flow_clarity_archive.cjs`.
- **What AI says** (AI search, fifth tab): `seo/ai_brand/` asks ChatGPT, Perplexity, Gemini and Google AI Mode through Bright Data's AI scrapers, and Google AI Overviews through Semscraper. Only the button starts a run, after the count and price are shown; never a schedule. At most 10 questions a run, one run at a time per site. A question is sent once (its snapshot or task id is saved; one cut off mid-send is failed, never re-sent), and each answer is counted once in `credit_ledger`. The providers' documented endpoints and prices, and what's unknown, are in `seo/ai_brand/README.md`. Browser flow: `tests/ui/flow_ai_brand.cjs` (harness with `--fake-claude`; fake providers in `tests/ui/fake_ai_brand.py`).
