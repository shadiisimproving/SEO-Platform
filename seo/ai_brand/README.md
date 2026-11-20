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
