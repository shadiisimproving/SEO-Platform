# AI search chart: "last date under the last point" (2026-11-18)

**Not a chart bug: the test was wrong.** Branch `fix-aichart-2026-11-18`.

## Cause
`tests/ui/flow_one_period.cjs` never seeded AI search data. The harness's own seed (`tests/ui/app_server.py`) has no
Google Analytics on site one, so AI search shows "Connect Google Analytics" and draws no weekly chart. The check then
found zero `.lv-tick` elements and failed on `aiTicks.length > 0`, at desktop and phone, EN and FR. The printed detail
was empty, which matches no ticks at all. This happened before and after the periods fix, because the chart code was
never the cause.

Proof: on a freshly reset server, the unchanged flow gives 4 FAILs and the AI screenshot shows the Connect card. After
`seed_ai_search.py normal`, the same unchanged flow passes.

## Fix (test only)
- The flow seeds `seed_ai_search.py normal` once at the start. `DB_NAME_TEST` is now required, must end in `_test`, and
  must name the server's database.
- The check is stricter and runs per chart (`ai-weeks` and `ai-weeks-clarity`, both must be drawn). Every date must sit
  at index / (weeks − 1) of the width, and the last week must be dated at 100%, or at 50% when there is a single week.
  The old regex wanted 100% even for one week, but a one-week chart draws its point halfway across, so it would have
  failed on a correct chart.

## Edge cases pinned in `tests/js/chart_axis.test.cjs`
- One week: the point is drawn at 50% and its date sits at 50%.
- For 2, 3, 8, 14, 27 and 53 weeks, every date sits at the x of the point it names (taken from lineChart's own path),
  and the last week is dated.
- When the last week has no number, its date stays at the right edge, in the slot where its point would be.

## Checked by hand (no overlap, last date under last point)
Today (3 charts), Overview, AI search (both charts) and Channels, at 1440 and 390, EN and FR, for 28 days and 6 months
(AI search also at 7 days, 3 months and 12 months). In every case the axis box equals the SVG box, the last tick is at
100% and no labels overlap. On phone, 12 months is the tightest case ("26 May" and "30 Jun" are 6 px apart).

Side note (not changed): on the phone Overview "Week by week" chart, the top y label such as "2 810" is clipped at the
left edge.
