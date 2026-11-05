# Putting SEO Command Center on o2switch

First uploaded 2026-11-05. Scheduled jobs (step 8) were not installed then, and no real API key had been tried.

**Tiger Protect, o2switch's rate limit, answers HTTP 429 "Slow down".** It stopped an automated browser on the first day, after a burst of checks from one address. A page load is many requests, because every screen file is sent one by one with caching off, and some API calls repeat once per site. It can be managed in cPanel, per o2switch's own page; that's the owner's decision, and nothing here changes it. Don't test the live site in bursts.

| | |
|---|---|
| Address | `https://seo.my-emails.pro` |
| Account | `khma1817` on `khma1817.odns.fr`, SSH key `~/.ssh/github_deploy_creertesting` |
| Code and settings | `~/seo-platform`, **outside the web folder** |
| Web folder | `~/seo.my-emails.pro`: only cPanel's `.htaccess`, nothing else |
| Python | `/home3/khma1817/virtualenv/seo-platform/3.12` |
| Database | MariaDB, database `khma1817_seo`, user `khma1817_seo_u` |
| Encryption key | `~/.config/seo-command-center/key`, never in `.env` or a backup |

Code stays outside the web folder because on o2switch anything in the web folder is served as it is. The CRM's audit downloaded `config.py` and a database dump that way.

## First-time setup

Your Mac's address must be on the SSH allow-list in cPanel, or `ssh` and `rsync` just hang. Each step below is on the server, unless it says Mac.

1. **Address.** Add the subdomain, with its web folder separate from the code:
   ```bash
   uapi SubDomain addsubdomain domain=seo rootdomain=my-emails.pro dir=%2Fseo.my-emails.pro
   ```
2. **Certificate, before anyone logs in.** Login cookies are Secure, so the app can't be signed into over plain http. Use `~/.acme.sh` or cPanel → Security → Let's Encrypt SSL, as for the other subdomains.
3. **Python app.**
   ```bash
   cloudlinux-selector create --json --interpreter python --app-root seo-platform --app-uri / --version 3.12 \
     --domain seo.my-emails.pro --startup-file passenger_wsgi.py --entry-point application
   ```
4. **Database.** The user's name can't be the database's name.
   ```bash
   uapi Mysql create_database name=khma1817_seo
   uapi Mysql create_user name=khma1817_seo_u password='...'
   uapi Mysql set_privileges_on_database user=khma1817_seo_u database=khma1817_seo privileges=ALL%20PRIVILEGES
   ```
5. **Settings.** Copy `deploy/env.production.example` to `~/seo-platform/.env`, put the password in, `chmod 600`.
6. **First upload. Mac:** `FIRST_TIME=1 bash deploy/deploy.sh --go`. It stops with a plain message if a step above is missing, with the live site unchanged. `FIRST_TIME=1` also makes the server's encryption key: copy `~/.config/seo-command-center/key` to a password manager, because losing it means pasting every API key again. Later uploads never make a key.
7. **First admin.** It prints a temporary password once.
   ```bash
   cd ~/seo-platform && $VENV/bin/python -m seo.accounts create-admin --email you@example.com --name "Your name"
   ```
8. **Scheduled jobs.** Only when the app works in the browser, because they start reading websites straight away:
   ```bash
   cd ~/seo-platform && APP_DIR=$HOME/seo-platform VENV_BIN=$VENV/bin bash deploy/install_cron.sh
   ```
9. **Old Clarity data.** Add the sites first. Then **Mac:** `.venv/bin/python scripts/clarity_archive_export.py`, and upload `var/clarity-archive.json` in Settings → Microsoft Clarity → Old Clarity data.

`$VENV` is `/home3/khma1817/virtualenv/seo-platform/3.12`.

## Every later upload

```bash
bash deploy/deploy.sh --check   # what would go. No network.
bash deploy/deploy.sh --go      # tests, upload, install, database copy, migrate, switch, then checks the site
```

It uploads the last commit only, and that commit must be on GitHub. Going back: check out the last good commit and run it again. A migration that already ran stays, which is why migrations only add things. Database copies are in `~/seo-platform/var/backups/database`.

## What doesn't run on the live site

- **Browser on this Mac:** hidden there, by design.
- **Common Crawl's download:** run `scripts/common_crawl_links.py` on the Mac and upload the small CSV it makes.
- **The old Clarity harvester (`harvest.py`, `scripts/clarity_daily.py`):** not moved. The app's own collector replaces it, at 2 of Clarity's 10 daily requests. It keeps totals and referrers only, not pages or devices. Don't schedule both: together they'd run out the daily requests.

## Checks to make on the first upload

These can't be known from the Mac:

- Whether long jobs get cut off. A CPU cap per process was reported (420 s) but never confirmed. Scans stop at about 40 s and resume, so they should fit.
- Whether crawling, DuckDuckGo direct and SearXNG work from o2switch's address.
- Whether `mysqldump` or `mariadb-dump` runs from cron's PATH: look for today's file in `var/backups/database`.
- Every real key: none has ever been tried, only fakes.
