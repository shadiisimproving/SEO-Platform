# The backlinks template

`backlinks-template.csv` is the file to fill in when you add many backlinks at once. The **Download the template** button gives you the same file: Backlinks, Done, Add backlink, Import CSV.

## How to use it

1. Open it in Excel or Google Sheets. It should open in columns on a computer set to English. A computer set to French may put everything in one column, because Excel there expects semicolons: if so, open it in Google Sheets instead.
2. **Delete the 2 example rows.** If you leave them in, the app marks them "Example row: delete it" and won't import them.
3. Add one row per backlink. **Only Source page is required.** Leave any other cell empty if you don't know it.
4. Save it as CSV, then drop it on the Import CSV panel.
5. Check the preview. Each row says if it's ready or what's wrong with it. Nothing is saved until you press Import.

If you keep your own column names or put the columns in another order, the app still matches them, and you can correct any match in the preview.

## What each column means

| Column | What to put in it | Example |
|---|---|---|
| Our site | Which of your websites the link points to. It must be one you've added to the app. With or without `https://`, `www` or a slash at the end is fine. Empty uses the "Default site" you pick in the panel. | `your-site.example` |
| Source page | **Required.** The page that has the link on it, the full address. | `https://example-blog.example/article` |
| Target page | The page of your website that the link points to. | `/your-page/` |
| Anchor text | The words people click on. Any language is fine. | `your anchor text` |
| Anchor type | What kind of anchor it is: Brand, Bare URL, Exact keyword, Partial keyword, Generic or Other. French works too: Branding, Optimisée, Semi-optimisée, Générique, Autre. Empty lets the app work it out from the anchor text and your keywords. | `Partial keyword` |
| Keyword | The keyword this link is meant to help. | `your keyword` |
| Link type | What kind of link it is. See the suggestions below. | `Guest post` |
| Status | Where the link stands. See the words below. Empty means Live. | `Live` |
| Date placed | The day the link went up. | `2026-01-15` |
| Due date | The day you expect it to go up, or have to deal with it. | `2026-12-01` |
| Renewal date | The day it has to be paid for or renewed again. | `2027-01-15` |
| Price | What it cost, as you'd normally write it, with the currency. | `$150`, `150 €`, `AED 500`, `1 500` |
| Mediator | The agency or person who got you the link. | `Example Agency` |
| Contact | How to reach them: email, phone, anything. | `sales@example-agency.example` |
| Platform | The marketplace or website you bought it through. | `Example Marketplace` |
| UTM source | The `utm_source` in the link, if it has one. | `example-blog` |
| UTM medium | The `utm_medium` in the link, if it has one. | `backlink` |
| UTM campaign | The `utm_campaign` in the link, if it has one. | `bl-101` |
| Owner | Who on your team looks after this link. | `Alex` |
| Notes | Anything else you want to remember. | |

## Status words

The app understands these, in capitals or not, with or without accents:

| It means | English | French |
|---|---|---|
| **Live**: the link is up | Live, Active | en ligne, actif, active |
| **Lost**: the link was removed | Lost | perdu, perdue |
| **Planned**: not up yet | Planned, Pending | prévu, prévue, en attente |

Any other word stops that row, and the preview tells you. The app never guesses.

A Planned link doesn't count in the top cards, and the website still shows as a gap in Link gaps, because it doesn't link to you yet.

## Link type words

You can write anything here. These are the suggestions: Guest post, Directory, Press, Sponsored, Forum, Other.

## Dates

Write them as **YYYY-MM-DD** if you can, like `2026-11-04`. Anything else, like `3 March`, is kept exactly as you typed it, but the app can't work with it as a date.

## Prices

The app keeps what you typed, so you always see the currency, and it also reads the number from it. Costs in different currencies are never added together.

If it can't find a number, like with `free`, your words are still kept, but the link doesn't count in what you've spent.

## Good to know

- A source page already saved for that website is skipped, and the app tells you which ones.
- One upload can hold up to 5,000 rows. For more, split the file.
- A cell that a spreadsheet could run as a formula, like `=1+1`, is saved as plain text with `'` in front. Phone numbers like `+971 50 123 4567` are left as they are.
- Very long text is refused rather than cut: Notes can hold 5,000 characters and most other cells 60 to 250.
