# Social: setting up the morning routine

The app does nothing on X or LinkedIn by itself. Each morning:

| When (server time) | What | Where | Paid with |
|---|---|---|---|
| 06:00 | Website feeds and newsletters are read, then Grok looks for X trends and posts to comment on | o2switch cron, `social-due` | SuperGrok (Grok CLI) |
| 06:30 | Claude reads the brief and writes the drafts | Claude Code scheduled task, Anthropic's cloud | Claude Pro |
| Any time | The owner edits, opens and sends each draft | the Social screen | — |

No xAI, Anthropic or X API key is used anywhere.

## 1. In the app

1. Social → Writing guide: fill in **What you post about**. Add website feeds and newsletter senders.
2. Newsletters: make a mailbox just for them (cPanel → Email accounts). Subscribe to the newsletters with it, and
   enter its IMAP details under **Newsletter mailbox**. Only mail from the listed senders is read. Sign-up
   confirmation mails show at the top of Today, to click once.
3. Helpers → **Make a token**. Copy it. It's shown once.

## 2. Grok on the server (once)

Over SSH on o2switch:

```sh
curl -fsSL https://x.ai/cli/install.sh | bash      # installs ~/.local/bin/grok, no root needed
~/.local/bin/grok login --device-auth              # shows a code: open the link, sign in with SuperGrok, enter it
~/.local/bin/grok -p "Say ok."                     # must answer without asking for an API key
```

Then a real test from the app folder: `.venv/bin/python -m seo.worker social-due`, and look at Social → Today → Grok.

- If the cron's PATH doesn't find `grok`, set `GROK_BIN=/home/<user>/.local/bin/grok` in `.env`.
- `GROK_FLAGS` changes the CLI flags. The default is `--no-subagents --max-turns 6 --reasoning-effort low`.
- If Grok signs out, Today says so with the command to run. The day still goes on with feeds and newsletters.

## 3. The writing task in Anthropic's cloud (once)

In Claude Code, run `/schedule` (or open claude.ai/code → Scheduled), and create a task:

- **Repository:** this one (SEO-Platform). The task reads `deploy/social/writer-task.md`.
- **Schedule:** every day at 06:30, server time (05:30 UTC in winter).
- **Prompt:** `Follow deploy/social/writer-task.md exactly.`
- **Environment:**
  - Network: allow only the app's domain (`seo.my-emails.pro`).
  - Secrets: `SOCIAL_TOKEN` = the token from step 1.3.
  - Variables: `SOCIAL_APP` = `https://seo.my-emails.pro`.
- Run it once by hand. Drafts appear in Social → Today, and the bell rings.

Never set `ANTHROPIC_API_KEY` in the task: it would bill the API instead of the Pro plan.
