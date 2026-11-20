# Social: LinkedIn and X drafts every morning

**Social** in the side menu (group *Work*) prepares your LinkedIn and X posts and comments each day. You read
them, change what you want, and send them yourself.

- **Posts** are written in Arabic.
- **Comments** are written in the language of the post they answer, Arabic or English.

The app never posts anything by itself.

It costs nothing beyond two subscriptions you already have: **SuperGrok**, which is optional, and **Claude Pro**. No API
key is used, and your computer doesn't have to be on.

## How a day works

| When (server time) | What happens | Where it runs |
|---|---|---|
| 06:00 | The app reads your website feeds and newsletters. Grok then looks on X for trends and 3–5 posts worth commenting on. | The server (cron job `social-due`) |
| 06:30 | Claude reads the brief: your writing guide, your rules, today's topics and what you changed before. It writes 2 posts for X, 2 for LinkedIn, and the comments. | A Claude Code scheduled task in Anthropic's cloud |
| Whenever you like | The bell says drafts are ready. You open **Social → Today**. | The app |

If a step fails, for example Grok being signed out, **Today** shows it in red with the fix. The day goes on with
the other sources.

## The three tabs

### Today

Each draft is a card that you can edit; changes save as you type.

- **X post:** **Post on X** opens X with the text already filled in. Check it and press Post there.
- **LinkedIn post:** **Copy and open LinkedIn** copies the text and opens LinkedIn. Paste it and post.
- **Comment:** first click **Open the post** and read it. Then use **Reply on X**, which opens the reply box filled
  in, or **Copy comment** for LinkedIn.
- **Mark posted:** click it once it's out. Only posted drafts teach the writer, together with your edits.
- **Skip:** pick a reason ("Too formal", "Weak opening", "Sounds like AI"…). The reason teaches the writer too.
- **Rewrite:** write the angle you want ("talk about the cost of an office"). The next run rewrites the draft.
- **Add a post to comment on:** paste an X or LinkedIn link you found yourself, and a comment is written for it.

There's no "approve all" on purpose. Too many AI-looking comments get accounts down-ranked or flagged, so keep it to
a few real ones a day.

### Writing guide

This is how the writer learns your style.

- **What you post about:** your topics. Grok searches X for them.
- **Rules:** use **Teach a rule** to type a rule in plain words, like "never start with a question" or "say نحن, not
  أنا". It's followed from the next draft on, and it wins over everything else.
- **Suggestions:** once a week the writer suggests rules based on how you edited. Click **Add to the guide** or
  **No**.
- **The guide:** your full style (tone, dialect, openings, length, emojis, examples you like and don't like).
  There are two ways to set it:
  - type it in the box and click **Save the guide**, or
  - click **Upload a skill** and choose your Claude writing skill: a `SKILL.md`, or a `.zip` / `.skill` folder with
    its references and examples. It replaces the guide. Your rules stay. To update it later, use
    **Upload a new version**.
- **Where ideas come from:** add website feed addresses (RSS) and newsletter sender addresses.
- **Newsletter mailbox** (admin only): a mailbox used just for newsletters. Only mail from the senders you listed is
  read. Sign-up confirmation emails show on Today so you can click them once.
- **Helpers** (admin only): **Make a token**. This is the key the morning Claude task uses. It's shown once, and
  making a new one stops the old one.

### Video transcripts

This tab turns Instagram and TikTok videos into text.

1. Connect Groq once: make a free key at console.groq.com/keys and paste it. Groq writes out videos that have no
   captions, and a free account covers a few hours of audio a day.
2. Add videos, up to 200 at a time, in one of three ways:
   - paste the links
   - upload a file (.txt, .csv, Excel or Word)
   - give a TikTok account address to list its videos
3. Give the batch a name and click **Write out the videos**. Each batch keeps its transcripts together, with
   **Copy all** and **Download all**.

If Instagram refuses a video, use **Instagram sign-in (only if Instagram refuses)** to add your Instagram cookies,
then click **Try again**.

## Setting it up (once)

The full steps are in [deploy/social/SETUP.md](../deploy/social/SETUP.md). In short:

1. **In the app:** fill in *What you post about*, add feeds and newsletters, upload your skill, and make a token.
2. **Grok on the server** (optional, needs SuperGrok): install the Grok CLI over SSH and run
   `grok login --device-auth`. Without Grok, ideas come only from feeds, newsletters and links you paste.
3. **The morning Claude task:** in Claude Code, run `/schedule` and create a daily 06:30 task on this repository with
   the prompt `Follow deploy/social/writer-task.md exactly.`, the secret `SOCIAL_TOKEN` and the variable
   `SOCIAL_APP=https://seo.my-emails.pro`. Never set `ANTHROPIC_API_KEY` there.

## Who can use it

*Social* is its own section under user access (Settings → Users). It can be given as View or Edit per site. The
newsletter mailbox and the helper token can only be changed by an admin.

## For developers

| Part | Files |
|---|---|
| Gathering, Grok, drafts and guide | `seo/social/gather.py`, `seo/social/grok.py`, `seo/social/service.py`, `seo/social/skill.py` |
| Video transcripts | `seo/social/transcripts.py`, `seo/web/social_transcripts_api.py` |
| Routes | `seo/web/social_api.py`: `/api/social/*`. The token-only helper routes are under `/api/social/bot/*`. |
| Screens | `design/mockups/social-view.js` and `.css`, `design/mockups/social-transcripts.js` and `.css` |
| Morning job | `python -m seo.worker social-due` (cron line in `deploy/install_cron.sh`) |
| Claude's instructions | `deploy/social/writer-task.md` |
| Tests | `tests/test_social.py`, `tests/test_social_transcripts.py`, `tests/ui/flow_social.cjs`, `tests/ui/flow_video_transcripts.cjs` |
