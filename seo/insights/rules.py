"""Every threshold the insights use, in one place. Days are final Search Console days only; periods are whole weeks, so a
period never has one Sunday more than the one it's compared with."""

PERIOD_DAYS = 28  # the period looked at, against the 28 days before
MONTH = 30 / PERIOD_DAYS  # clicks in a period → clicks a month

# A1, change breakdown. Below both floors the site is "steady".
STEADY_PERCENT, STEADY_CLICKS = 10, 20
BIG_CHANGE_PERCENT, BIG_CHANGE_CLICKS = 30, 50
CHANGE_MOVERS = 5

# A2, odd day: against the same weekday of the last 8 weeks.
ODD_LOOK_DAYS = 7
ODD_WEEKS, ODD_MIN_WEEKS = 8, 5
ODD_MIN_USUAL = 10  # clicks a day; below that a quiet day is normal
ODD_LOW_SHARE, ODD_HIGH_SHARE = 0.6, 1.6
ODD_Z = 2.5  # with only 8 weeks to compare against, the spread is wide; the 60% rule above keeps it honest

# A3, a page losing or gaining clicks.
PAGE_MIN_CLICKS, PAGE_MIN_CHANGE, PAGE_MIN_PERCENT = 20, 10, 20
PAGE_BIG_PERCENT, PAGE_BIG_CLICKS = 50, 50
PAGE_QUERIES = 5
PLACES_LOST = 1.5  # a page that lost this many places lost them by ranking
FEWER_SEARCHES = 0.75  # impressions now ÷ before, below which demand fell

# A5, dropped out of Google.
GONE_DAYS = 7
GONE_BEFORE_DAYS = 28
GONE_MIN_IMPRESSIONS, GONE_MIN_CLICKS = 50, 5
GONE_SITE_DAYS = 5  # the site itself must have had impressions on this many of the last 7 days
GONE_BIG_CLICKS = 30  # a month

# B1, content decay: weekly clicks over 16 weeks.
DECAY_WEEKS = 16
DECAY_MIN_CLICKS = 80  # over the 16 weeks
DECAY_MIN_PEAK = 5  # clicks a week, as a 4-week average
DECAY_BELOW_PEAK = 0.75  # the last 4 weeks at or under this share of the peak
DECAY_SLOPE = -0.25  # the trend over the 16 weeks, as a share of the average
DECAY_FIT = 0.3  # how well a straight line fits (r²), so a single bad week isn't a decline
DECAY_STEP = 0.9  # each third of the 16 weeks at or under this share of the one before: a slide, not one cliff

# C, quick wins.
ALMOST_BAND, ALMOST_MIN_IMPRESSIONS, ALMOST_TARGET = (11, 20), 20, 8
TOP3_BAND, TOP3_MIN_IMPRESSIONS, TOP3_TARGET = (4, 10), 100, 3
LOW_CTR_MIN_IMPRESSIONS, LOW_CTR_SHARE = 100, 0.5
NO_CLICK_MIN_IMPRESSIONS, NO_CLICK_TOP = 200, 20
COMPETE_MIN_IMPRESSIONS, COMPETE_SHARE, COMPETE_TOP = 50, 0.2, 20
WINS_KEPT = 100  # per kind, the biggest first
WINS_RECENT_DAYS = 7  # a query with no impressions in the last week isn't a win to chase: it's gone

# The site's own click-rate curve, from non-brand queries over 90 days.
CURVE_DAYS, CURVE_MIN_IMPRESSIONS, CURVE_MIN_QUERIES = 90, 100, 10
CURVE_BANDS = ((1, 1), (2, 2), (3, 3), (4, 5), (6, 10), (11, 20))
CURVE_RATIO_LIMITS = (0.3, 3.0)

INFO_BELOW = 3  # clicks a month at stake: below this a finding is only information
GONE_KEPT_DAYS = 90  # findings that went away are kept this long, then deleted
DISMISS_COMES_BACK = 2.0  # "Not useful" comes back when the clicks at stake reach this many times what they were
TODAY_SHOWN, TODAY_MIN_STAKE = 5, 5
