"""Every threshold the insights use, in one place. Days are final Search Console days only; periods are whole weeks, so a
period never has one Sunday more than the one it's compared with."""

PERIOD_DAYS = 28  # the period looked at, against the 28 days before
MONTH = 30 / PERIOD_DAYS  # clicks in a period → clicks a month

# A1, change breakdown. Below both floors the site is "steady".
STEADY_PERCENT, STEADY_CLICKS = 10, 20
BIG_CHANGE_PERCENT, BIG_CHANGE_CLICKS = 30, 50
CHANGE_MOVERS = 5
CHANGE_PAGES = 5  # pages listed under the change
PAGE_EXPLAINS = 0.5  # one page is named as the cause when it carries this share of the net change

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

# A4, a query losing places: on the page that ranks for it.
QUERY_PLACES_LOST = 3
QUERY_MIN_IMPRESSIONS = 50  # in each period: a place 'lost' from 2 impressions says nothing
QUERY_WORST_BEFORE = 30  # it ranked at least this well before; further down, places mean little
QUERY_KEPT = 100

# A6, one country or device carries the change.
SEGMENT_SHARE = 0.7  # of the site's change, pulling the same way
SEGMENT_MIN_CLICKS = 20
SEGMENT_OTHERS_STEADY = 0.15  # the rest of the site moved less than this share of its clicks

# A7, unstable ranking: Google keeps moving it.
UNSTABLE_MIN_DAYS = 14  # of the 28, with impressions
UNSTABLE_MIN_IMPRESSIONS = 100
UNSTABLE_SPREAD = 3.0  # places, the spread between its better and worse days (interquartile)
UNSTABLE_TOP = 20  # its usual position at or above this
UNSTABLE_KEPT = 50

# B2, a slow position slide.
SLIDE_WEEKS = 8
SLIDE_MIN_IMPRESSIONS = 200  # over the 8 weeks
SLIDE_MIN_WEEKS = 6  # weeks with impressions
SLIDE_SLOPE = 0.25  # places lost a week, at least
SLIDE_TOTAL = 2.0  # places lost over the 8 weeks, on the fitted line
SLIDE_FIT = 0.5
SLIDE_TOP = 30
SLIDE_KEPT = 100

# B3, seasonal or real: the same weeks a year earlier.
SEASON_DAYS = 364  # 52 weeks, so weekdays line up
SEASON_SHARE = 0.5  # last year fell at least half as much, in percent, over the same weeks
SEASON_STAKE = 0.5  # a seasonal drop counts half

# C6, a page close to page 1 on many queries.
NEAR_BAND, NEAR_MIN_QUERIES, NEAR_MIN_IMPRESSIONS = (11, 30), 10, 5  # impressions per query
NEAR_KEPT = 50

# C7, no page of its own.
NO_PAGE_MIN_IMPRESSIONS = 100
NO_PAGE_TARGET = 5  # where a page made for it could rank: what "at stake" is worked out against
NO_PAGE_KEPT = 50
NO_PAGE_HOME_TOP = 10  # the home page on page 1 for it is fine

# C8, question searches, by the page that ranks.
QUESTION_MIN_QUERIES, QUESTION_MIN_IMPRESSIONS = 3, 10
QUESTION_KEPT = 50

# C9, topics: queries that share a word.
TOPIC_MIN_QUERIES, TOPIC_MIN_IMPRESSIONS = 5, 200
TOPIC_COMMON = 0.3  # a word in more than this share of the site's queries says nothing (its city, its trade)
TOPIC_WEAK_POSITION = 10  # demand, but no page in the top 10 for it
TOPIC_TARGET = 8  # like almost on page 1: a topic page is a bigger job, so a modest target
TOPIC_KEPT = 30
TOPIC_OVERLAP = 0.5  # two words over this share of the same searches are one topic

# C10, worth tracking.
TRACK_MIN_IMPRESSIONS, TRACK_TOP, TRACK_KEPT = 100, 30, 20

# C11, brand against non-brand.
BRAND_HIDES_PERCENT, BRAND_HIDES_CLICKS = 15, 20  # non-brand fell this much while brand held the total up

# D, leads (GA4 key events).
LEAD_DAYS = 90
LEAD_MIN_SESSIONS = 30  # a page's own lead rate needs this many sessions; below, the site's rate is used
NO_LEADS_MIN_CLICKS = 100  # search clicks in 90 days, with 0 leads
NO_LEADS_KEPT = 30
LEAD_BIG = 1.0  # leads a month at stake that make a lead page's loss big

# E, technical.
DUPLICATE_MIN_IMPRESSIONS = 10  # each address
BROKEN_DAYS = 7  # shown on Google in the last week
DATA_GAP_DAYS = 28

# F1, did it work.
RESULT_GAP_DAYS = 7  # skipped just after the change, while Google takes it in
RESULT_DAYS = 28
RESULT_LOOK_BACK = 365  # tasks done longer ago aren't worked out any more

# Clicks at stake where Google shows an AI Overview on the search: the share of the curve's clicks kept. Published studies
# of 2025 (Ahrefs, Seer Interactive, Pew) measured 35% to 60% fewer clicks on the plain results below an AI Overview; 0.6
# keeps to the cautious end. Only when a rank check really read the results page (never on "not captured").
AI_OVERVIEW_SHARE = 0.6

# Rank and clicks (mix.py): saved rank checks joined with Search Console.
MIX_FRESH_DAYS = 14  # a check older than this can't say something just moved
MIX_USABLE_DAYS = 45  # nor, past this, say where a keyword stands
MIX_GAP = 5  # places between a check and Search Console's average: checks are desktop from one place, so small gaps are normal
MIX_WORST = 20  # further down than this on average, a drop means little
MIX_CONFIRM_PLACES = 3  # moved at least this much since the previous like-for-like check
MIX_DEPTH_MARGIN = 3  # "beyond the depth checked" only counts when the average sat this far inside it
MIX_MIN_IMPRESSIONS = 50
MIX_PASS_PLACES = 2  # "a rival passed you" needs it to climb, or me to fall, at least this far: a one-place swap is noise
MIX_RIVAL_TOP, MIX_RIVAL_ME_PAST, MIX_RIVAL_TARGET = 5, 10, 5
MIX_STRIKING, MIX_STRIKING_GAP, MIX_STRIKING_MIN, MIX_STRIKING_TARGET = (8, 20), 5, 20, 5
MIX_NO_CLICK_TOP, MIX_NO_CLICK_MIN, MIX_NO_CLICK_SHARE = 7, 100, 0.6
MIX_PAGE_SHARE, MIX_PAGE_MIN_CLICKS = 0.6, 5
MIX_KEPT = 200

INFO_BELOW = 3  # clicks a month at stake: below this a finding is only information
GONE_KEPT_DAYS = 90  # findings that went away are kept this long, then deleted
DISMISS_COMES_BACK = 2.0  # "Not useful" comes back when the clicks at stake reach this many times what they were
TODAY_SHOWN, TODAY_MIN_STAKE = 5, 5
