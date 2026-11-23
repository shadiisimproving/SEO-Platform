# What AI says about us (AI search → What AI says)

Asks ChatGPT, Perplexity, Gemini and Google AI Mode (Bright Data's AI scrapers) and Google AI Overviews (Semscraper) the
owner's questions about the company. Only the button starts it, after the price is shown and confirmed. Nothing here is
ever scheduled. Code: `engines.py` (the two providers), `service.py` (questions, estimate, runs, the job).

What the providers' documentation said on 2026-11-20. Nothing was called with a real key while building this.
Where the docs don't say, it's written as **unknown**, and the code accepts either answer.

## Bright Data AI scrapers

Sources: https://docs.brightdata.com/scrapers.json (scraper index and dataset ids),
https://docs.brightdata.com/api-reference/rest-api/scraper/asynchronous-requests.md,
https://docs.brightdata.com/api-reference/scrapers/management-apis/monitor-progress.md,
https://docs.brightdata.com/api-reference/scrapers/ai-search-apis/chatgpt-search-by-prompt.md,
https://docs.brightdata.com/api-reference/scrapers/search-engines-apis/google-ai-mode-search-collect-by-url.md,
https://docs.brightdata.com/products/scrapers/error-codes.md, https://brightdata.com/pricing/web-scraper,
https://github.com/brightdata/answer-engines-country-codes

- **Key:** `Authorization: Bearer <API key>`, the account's API key. It's not the SERP API's zone. The app uses the key pasted
  under Settings → Bright Data AI scrapers, or else the key saved for Bright Data search (its zone isn't needed here).
- **Send:** `POST https://api.brightdata.com/datasets/v3/trigger?dataset_id=<id>&include_errors=true&format=json`,
  body `{"input": [{...}, ...]}`, answer `{"snapshot_id": "sd_..."}`. All of a run's questions for one AI go in one snapshot.
- **Wait:** `GET /datasets/v3/progress/<snapshot_id>` → `status`: `starting`, `running`, `ready`, `failed` (with
  `error_message`), `canceled`. The job looks every 30 s.
- **Collect:** `GET /datasets/v3/snapshot/<snapshot_id>?format=json`. While not ready it answers HTTP 202 (body **unknown**:
  the code just waits). Snapshots stay 30 days.
- **Dataset ids:**

  | AI | dataset_id | input | confirmed |
  |---|---|---|---|
  | ChatGPT | `gd_m7aof0k82r803d5bjm` | `url` = `https://chatgpt.com/`, `prompt`, `country`, `web_search` | yes |
  | Gemini | `gd_mbz66arm2mf9cu856y` | `url` = `https://gemini.google.com/`, `prompt`, `country` | yes |
  | Google AI Mode | `gd_mcswdt6z2elth3zqr2` | `url` = `https://www.google.com/search?udm=50&q=...`, `prompt`, `country` (upper case), `hl` | yes |
  | Perplexity | `gd_m7dhdot1vw9a7gc1n` | `url` = `https://www.perplexity.ai/`, `prompt`, `country` | **no**: the docs list Perplexity as "currently unavailable"; the id is from the product page's example |

  If Perplexity's id is refused, only Perplexity's answers fail (nothing charged) and the other AIs carry on.
- **What comes back:** `prompt` (echo), `answer_text` (also `answer_text_markdown`), `model`, `citations[]`
  (`url`, `title`, `domain`, `cited`), `links_attached[]` (`url`, `text`), ChatGPT also `search_sources[]`.
  An error record has `error` and `error_code` (`dead_page`, `bucket_rate_limit`, ...). Records are matched back to
  questions by their `prompt`, then by order.
- **Language:** only AI Mode has one (`hl`). The others answer in the question's language, so questions are written in the
  site's language.
- **Countries:** a two-letter code. Each AI has its own list (the GitHub CSVs above); Gemini's has no European countries,
  so a country it refuses fails only Gemini's answers.
- **Price:** pay as you go, $1.50 per 1,000 records, so **$0.0015 per answer** (`BRIGHT_PER_ANSWER`). There's a free tier
  of 5,000 records a month. Failed records: the pricing page says they're not charged, the FAQ says records failing on a
  bad input still are. The app counts nothing for a failed record. Check this on the first real run.
- **Signed out:** **unknown.** The docs never say whether Bright Data's browsers are signed in to an account. The app
  sends no account or cookie of the owner's, so every answer is recorded `signed_out = true`, meaning "not the owner's
  account, no personalisation from us".

## Semscraper (Google AI Overviews)

Sources: https://www.semscraper.com/en/documentation, https://www.semscraper.com/en/pricing

- **Key:** `Authorization: Bearer <key>`, pasted under Settings → Semscraper. Test reads `GET /v1/billing/credit` (free,
  `data[0].balance`).
- **Send:** `POST https://api.semscraper.com/v1/serp` with an array of tasks
  `{"search_engine": "google_search", "keyword", "device": "desktop", "depth": 1, "location": "fr", "language": "fr"}`.
  The answer has `data[]` with each task's `id`, `status` (`pending`) and `cost`, and `currency` `EUR`.
- **Collect:** `GET /v1/serp?ids=a,b&output=json` (up to 100) → each `status` `pending`, `processing` or `done`.
- **What comes back:** `serp_info.ai_overview` = `{type: sync|async|none, text, complete}`; `results[]` blocks
  `{type, items[]}` where `ai_overview_panel` items are the sites in the source panel (`url`, `domain`, `title`) and
  `ai_overview_citation` items are brands named in the text (`brand`, often no `url`). No AI Overview → `type` `none`,
  shown as "Google showed no AI Overview".
- **Price:** depth 1 (one page) **€0.30 per 1,000 = €0.0003 per question**; charged when sent, for pages returned. AI
  Overviews come at no extra cost. Prepaid balance, no subscription, 1,000 free searches at sign-up. Costs are kept in
  euros (`currency = EUR`) and never added to dollars.
- **Signed out:** a public Google results page, no account: `signed_out = true`.
- **Also a rank tool (2026-11-23):** `seo/serp/tools.py: Semscraper` reads organic results (`rank_type`, `page`, `url`,
  `url_approx` + `goto_url` when Google hid the link) and the AI Overview for Refresh and Check AI Overviews, with the same
  key (`connections` tool name `Semscraper`, auth `app`) and the same `credit_ledger` name, so both count against the one
  account. Every search is paid use, behind its switch in Settings.
- Not documented: error codes for a bad key or a limit (**unknown**: any 4xx refuses, 429 and 5xx try again later).

## Rules

- One run at a time per site (`FOR UPDATE` on the site row), at most 10 questions, button only.
- Every answer row exists before anything is sent. A question is sent once: once a snapshot or task id is saved it's
  never sent again; one marked `sending` with no id (a crash mid-send) is failed, not re-sent, so it can't be paid twice.
- Each answer that arrives is counted once with `connections.count_use(paid=True, cost=...)` under the tool names
  `Bright Data AI` and `Semscraper`, with the run id.
- One AI failing fails only its own answers.
- Reading the answers (brand named, summary, tone, pros, cons, competitors) uses the site's AI from Settings → AI
  (`seo/extras/ai.py: read_brand_answer`), within the monthly cap. Without one, the raw answers and sources still show.
  The reading asks for pros and cons as short, general claims (12 words at most, without the company's name), so the
  same point reads the same way in every AI's answer and can be grouped.

## The combined picture (`run.picture`, 2026-11-20)

`run_dict()` adds `picture`, worked out in `service.picture()`; the screen only filters it by AI.

- `named_by` / `answered_by`: AIs that named the company in at least one answer, of the AIs that answered at all.
  `answers`, `named_answers`, `cited_mine` (answers citing the site's own host).
- `tone_score`: each answer that names the company counts positive = 1, neutral = 0.5, negative = 0; the score is their
  average as a whole percent ("80% positive"). Not named or not read: not counted; none left: `null`. `tone_word`:
  positive from 67, negative up to 33, neutral at exactly 50, mixed between. `tone_before` / `tone_change`: against the run
  before (the same one "Since the last run" uses, complete or partial), set by `state()`; `null` when either has no score.
- `engines`: one row per AI asked: `answered`, `named`, `tone_score`, `tone_word`, `tone_change`, `cited_mine`, `sources`
  (distinct sites cited), `failed`, `no_answer`.
- `pros` / `cons`: the same point once (`point_key`: folded case and accents, punctuation dropped), with `engines`, `ais`
  and `answers` (`id`, `engine`, `question`), ranked by how many AIs said it, then how many answers.
- `competitors`: other companies named (the company itself left out), with `ais`, `answers`, `by_engine`, ranked by `ais`.
- `source_groups`: `mine`, `competitor` (a tracked competitor's host, `site_competitors`), `social` (`SOCIAL_HOSTS`),
  `other`, each `{sites, citations}`. Each ranked source also carries its `group` and `by_engine` answer counts.

## "On your site?" and head-to-head (2026-11-20, GEO round)

- **On your site?** (`onsite.py`): every point the AIs make (strengths, weak points, each side's points in a head-to-head
  answer) is marked **said** / **hinted** / **missing** against the site's own pages as the app last read them (`pages` +
  the latest `page_versions` text; nothing is fetched). Word match first: common words and the company's (and followed
  competitors') names dropped, words cut to 5 letters; a page's score is the share of the point's words on it. Said: the whole
  point word for word, or ≥ 0.75 with 2 words or more; hinted: ≥ 0.4; else missing. With an AI picked in Settings → AI, one
  request per 30 points (purpose `onsite`, Haiku on Claude) sends each point with its 3 best pages (title + best passage) and
  its mark replaces the word match. Refused (no key, cap reached): the word match stays, with the reason in `onsite.note`.
  Kept in `brand_runs.onsite` = `{pages, by, note, at, points: {point_key: {mark, url, score, by}}}`: checked once when the run
  finishes; a run from before this is checked once by word match only when first shown (a page view never pays an AI);
  `POST /api/ai-brand/runs/<id>/check-site` checks every point again (after `POST /api/ai-brand/read-pages`, which queues a
  free read of the site's own pages).
- **Head-to-head** ("Choisir plutôt {brand} ou {competitor} ?" / "Should I choose {brand} or {competitor}?"): suggested once
  per followed competitor (`site_competitors.tracking <> 'off'`), stored with `brand_questions.rival_id`, asked by the same Ask
  the AIs flow (the estimate says how many are head-to-head). The competitor's name is the part of its home page title that
  matches its address, else its address's first word. Each answer gets `brand_answers.versus = {winner: us|them|tie|none, us,
  them, by}`: from its words when it arrives (a sentence with a recommending cue naming one side is a vote; equal votes is a
  tie), then from the site's AI (purpose `versus`) when there is one. Per competitor (`run.versus`): the verdict overall and
  per AI (more "us" than "them" is us, and so on), each side's points grouped like strengths with their marks, `ours_on_site`
  and `theirs_covered` = said + hinted of the points checked, the sources, and the trend against the latest earlier run that
  asked about it (`first`, `up`, `down`, `same`).
- Head-to-head answers stay out of the combined picture (verdict, tone, strengths, competitors named, sources): a question that
  names the company on purpose would count as the AIs naming it.
- `state()` adds `brand_from` (`brand_words` or `address`) while the name isn't saved, and `rivals` (the followed competitors).
- **Also known as** (`serp_settings brand_aliases:<site_id>`, a JSON list, up to 5, saved with the name by `PUT
  /api/ai-brand/brand {brand, aliases}`): other names the company goes by (the company behind the site, its web address).
  Questions and answers keep using the main name. The company counts as named when the main name or any alias is in the
  answer, case and accents ignored (`_brand_named`); a head-to-head sentence naming an alias is a vote for us
  (`versus_by_words`); aliases and the site's own addresses never show as competitors named; an alias that is a web address
  is "You" in the sources (`own_hosts`); the site's AI gets them in `<also_known_as>`; the on-site check drops their words.
