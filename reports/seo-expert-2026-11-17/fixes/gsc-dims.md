# Fix: Search Console countries and devices history (accuracy/search-console.md 3.1)

Branch `fix-gsc-dims-2026-11-17` (from fix-all-2026-11-17). Not pushed, merged or deployed.

## Confirmed first (live copy, test_live_dims_test, old code)

| Site | gsc_country / gsc_device days | General read (`coverage` gsc) | Daily totals from | Old `rows_from.country` | Old `rows_compare.country` (28 d) |
|---|---|---|---|---|---|
| 1 | 2026-11-05 → 11-17 (13) | 2025-07-19 → | 2025-07-19 | 2025-07-19 | True |
| 2 | 2026-11-05 → 11-16 (12) | 2025-07-19 → | 2026-07-15 | 2025-07-19 | True |
| 3 | 2026-11-05 → 11-17 (13) | 2025-07-19 → | 2025-07-19 | 2025-07-19 | True |

28 days: countries add up to 141 on site 1 and 42 on site 3, and the comparison was approved, so every country was "New". Site 2's `rows_from` for pages and queries said 2025-07-19, though its data starts 2026-07-15.

## Items

| # | Item | Status | Commit |
|---|---|---|---|
| 1 | Backfill countries and devices for 16 months under their own coverage name `gsc_dims` | **Fixed** (code). It runs on the first hourly reads after deploy. It can't run locally: there are no Google keys here | cb8de72 |
| 2 | History check uses each table's own first day; site 2 `rows_from` | **Fixed** | cb8de72 + screen commit |
| 3 | Insights segment detector checks history per table | **Fixed** | cb8de72 |
| 4 | Shown on the live copy and with fake Google in the UI | **Done** | — |

### 1. Backfill (`seo/collectors/gsc.py`)
- `DIMS_SOURCE = "gsc_dims"`. It is a new coverage line. `gsc_country` stays the queries-per-country report's line.
- `_one_day` (the general read) now also marks each day it reads under `gsc_dims`.
- `_dims_backfill` runs at the end of each `collect`, after the main read and the queries-per-country read:
  - It reads only the country and device reports (2 calls a day), newest first.
  - It takes `DIMS_DAYS_PER_RUN = 60` days a run at most and stops at the run's deadline.
  - It never asks the lane to run again at once. The next hourly run carries on.
  - It asks `coverage` what is missing, so it can be stopped and restarted, and it reads nothing once done.
  - It never reads a day before the site's first `gsc_daily` day.
- `_prune` also removes `gsc_dims` lines older than 16 months.
- **Live time per site:** about 487 days ÷ 60 = 9 hourly runs, so **about 9 hours** for sites 1 and 3, and **about 3 hours** for site 2 (126 days).
  - Each run is 120 calls. Google allows 1,200 a minute per site, so the quota never limits it.
  - The run's 40-second share can. If Google answers slower than about 0.3 s a call, a run does fewer days, and it can take up to about 14 hours.
  - On the UI server the fake Google needed 8 runs (481 days, 13 already there).

### 2. History check (`seo/metrics/period.py` `_first_day`)
- Each day-by-day table counts its own rows plus **its own** coverage line: `gsc` for queries and pages, `gsc_dims` for countries and devices.
- A covered day before the site's first daily total doesn't count, because Google had nothing then. This fixes site 2: its `rows_from` is now 2026-07-15.
- Live copy, new code, 28 days on sites 1 and 3:
  - `rows_from.country = device = 2026-11-05`.
  - `rows_compare` is `{query: True, page: True, country: False, device: False}`.
  - The country breakdown answers `compare_unavailable: "rows_history"`.
- **Screen** (`design/mockups/overview-view.js`), EN and FR:
  - "Country data starts on 5 Nov 2026: days before aren't counted." when the period starts before the table (same for devices). This shows even with no comparison, so the 16-month total no longer passes for 16 months.
  - "…: too soon to compare countries/devices." when only the earlier period is missing.
  - Nothing is said where the site's own daily data also starts late.

### 3. Insights (`seo/insights/movement.py` `segments`)
- Each table (country, device) is skipped until its own `rows_from` reaches the earlier period.
- `needs.segment_country` and `needs.segment_device` give the day it starts.
- The detector still counts as "ran", so a finding made earlier from missing days closes.
- Insights > What changed says "Country and device data start on 5 Nov: too soon to compare them." (EN/FR). In simple mode, like the tab's other notes with no link, it is behind the (i).
- Live copy: France finding 203 was already "gone" in the 11-17 snapshot, and today's data raises no segment finding under either code. The guard is proven by the test with a France "+91 (0 before)" case.

### 4. Shown
- **Live copy** (`test_live_dims_test`):
  - The history check refuses country and device comparisons on all three sites (see 2).
  - Overview shows the note and no gains.
  - The live screenshots are kept out of the repo (real data): `/private/tmp/claude-501/-Users-alwaysimproving/2dc79d4d-aef7-4f01-b370-eabc9d54a4a7/scratchpad/dims/shots/live-*.png`.
  - The backfill itself can't run locally, because there are no Google keys.
- **Fake Google UI server** (`test_fix_ui_dims_test`, port 8298):
  - Steps: a site was read by the real collector, then put back into the live state (13 days), then the backfill was run batch by batch.
  - `tests/ui/fake_google.py` now splits each day's total across countries and devices, as Google does.
  - Sums (clicks), countries and devices against the site's total:

| Stage | 28 d | 3 m | 16 m |
|---|---|---|---|
| before | 1,192 / 3,152 | 1,192 / 10,329 | 1,192 / 54,014 |
| after 1 run | **3,152 / 3,152** (compares) | 7,983 / 10,329 (note: starts 6 Sept) | 7,983 / 54,014 |
| after 8 runs | **3,152 / 3,152** | **10,329 / 10,329** | **54,014 / 54,014** |

- `tests/ui/flow_gsc_dims.cjs` checks both stages: desktop 1440 and phone 390, EN and FR, Overview (countries 28 d and 16 m, devices 28 d) and Insights.
  - STAGE=before: all ok.
  - STAGE=after: all ok, and the rows add up to the site total on every screen.
- Screenshots: `reports/seo-expert-2026-11-17/fixes/gsc-dims-shots/` (`before-*`, `mid-*`, `after-*`).

## Tests
- `tests/test_gsc_dims.py` (8 tests, golden numbers). It failed on the old code (7 of 8; the 8th guards that a real one-country drop is still raised). It passes now.
  - The backfill: batch size, run count, and country and device sums equal the daily totals over 16 m, 3 m, 28 d and 7 d.
  - Resumable after a stopped run. Never reads before Google's first day.
  - The general read marks `gsc_dims`.
  - Country and device history uses its own start. Quiet covered days count. Site 2's coverage clamp.
  - Segments: no "France +N (0 before)", and a real one-country drop is still found (168 → 56).
- Full suite: `DB_NAME_TEST=test_fix_dims_test .venv/bin/pytest` green.
- `node --test tests/js`: 5/5.
- Impeccable detector on the two screen files: no findings.

## Files
- `seo/collectors/gsc.py`, `seo/metrics/period.py`, `seo/insights/movement.py`
- `design/mockups/overview-view.js`, `design/mockups/insights-view.js`
- `tests/test_gsc_dims.py`, `tests/ui/flow_gsc_dims.cjs`, `tests/ui/fake_google.py`

## For the owner
- Nothing to decide. After deploy, countries and devices say "data starts on 5 Nov" until the backfill passes the period on screen. The first run after deploy already covers 28 days and their comparison; 16 months take about 9 hourly runs.
