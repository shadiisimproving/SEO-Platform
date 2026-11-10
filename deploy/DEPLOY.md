# Putting SEO Command Center on o2switch

First uploaded 2026-11-05. Scheduled jobs (step 8) were not installed then, and no real API key had been tried.

**Tiger Protect, o2switch's rate limit, answers HTTP 429 "Slow down".** It stopped an automated browser on the first day, after a burst of checks from one address. A page load is many requests, because every screen file is sent one by one with caching off, and some API calls repeat once per site. It can be managed in cPanel, per o2switch's own page; that's the owner's decision, and nothing here changes it. Don't test the live site in bursts.

| | |
|---|---|
| Address | `https://seo.example.com` |
| Account | `<cpanel-user>` on `<server>`, SSH key in `SSH_KEY` |
| Code and settings | `~/seo-platform`, **outside the web folder** |
| Web folder | `~/seo.example.com`: only cPanel's `.htaccess`, nothing else |
| Python | `/home/<cpanel-user>/virtualenv/seo-platform/3.12` |
| Database | MariaDB, database `<cpanel-user>_seo`, user `<cpanel-user>_seo_u` |
| Encryption key | `~/.config/seo-command-center/key`, never in `.env` or a backup |

Code stays outside the web folder because on o2switch anything in the web folder is served as it is. The CRM's audit downloaded `config.py` and a database dump that way.

**Which server is yours lives on your own computer, never in the repo.** Copy `deploy/deploy.local.env.example` to `deploy/deploy.local.env` and fill it in, and put the server's SSH host keys in `deploy/known_hosts.local`. Get those from a computer that already trusts the server (`ssh-keygen -F <server>`), or with `ssh-keyscan <server>` checked against your host's control panel. Both files are in `.gitignore`. `deploy.sh` stops with a plain message if either is missing.

## First-time setup

Your Mac's address must be on the SSH allow-list in cPanel, or `ssh` and `rsync` just hang. Each step below is on the server, unless it says Mac.

1. **Address.** Add the subdomain, with its web folder separate from the code:
   ```bash
   uapi SubDomain addsubdomain domain=seo rootdomain=example.com dir=%2Fseo.example.com
   ```
2. **Certificate, before anyone logs in.** Login cookies are Secure, so the app can't be signed into over plain http. Use `~/.acme.sh` or cPanel → Security → Let's Encrypt SSL, as for the other subdomains.
3. **Python app.**
   ```bash
   cloudlinux-selector create --json --interpreter python --app-root seo-platform --app-uri / --version 3.12 \
     --domain seo.example.com --startup-file passenger_wsgi.py --entry-point application
   ```
4. **Database.** The user's name can't be the database's name.
   ```bash
   uapi Mysql create_database name=<cpanel-user>_seo
   uapi Mysql create_user name=<cpanel-user>_seo_u password='...'
   uapi Mysql set_privileges_on_database user=<cpanel-user>_seo_u database=<cpanel-user>_seo privileges=ALL%20PRIVILEGES
   ```
5. **Settings.** Copy `deploy/env.production.example` to `~/seo-platform/.env`, put the password in, `chmod 600`.
6. **First upload. Mac:** `FIRST_TIME=1 bash deploy/deploy.sh --go`. It stops with a plain message if a step above is missing, with the live site unchanged. `FIRST_TIME=1` also makes the server's encryption key: copy `~/.config/seo-command-center/key` to a password manager, because losing it means pasting every API key again. Later uploads never make a key.
7. **First admin.** It prints a temporary password once.
   ```bash
   cd ~/seo-platform && $VENV/bin/python -m seo.accounts create-admin --username you --name "Your name"
   ```
8. **Scheduled jobs.** Only when the app works in the browser, because they start reading websites straight away:
   ```bash
   cd ~/seo-platform && APP_DIR=$HOME/seo-platform VENV_BIN=$VENV/bin bash deploy/install_cron.sh
   ```
9. **Old Clarity data.** Add the sites first. Then **Mac:** `.venv/bin/python scripts/clarity_archive_export.py`, and upload `var/clarity-archive.json` in Settings → Microsoft Clarity → Old Clarity data.

`$VENV` is `/home/<cpanel-user>/virtualenv/seo-platform/3.12`.

## Every later upload

```bash
bash deploy/deploy.sh --check   # what would go, then asks the server (reading only) whether Pillow is there. Uploads nothing
bash deploy/deploy.sh --go      # tests, upload, install, database copy, migrate, switch, then checks the site
```

It uploads the last commit only, and that commit must be on GitHub. Database copies are in `~/seo-platform/var/backups/database`.

**Pillow must be installed on the server.** PDF exports use reportlab (in `requirements.txt`), and reportlab needs Pillow. `--go` installs both from `requirements.txt`, as a ready-made package, with nothing to build. `--check` says whether the server's Python can load them: it only asks, it changes nothing. If it says "can't be imported" after a `--go`, run this once on the server and send its last lines to whoever looks after the app: `$VENV/bin/pip install -r ~/seo-platform/requirements.txt`. Everything except PDF exports works without it.

**If a migration fails halfway,** the old version stays live, but every later upload stops on the same step, because MariaDB can't undo the table changes already made ("table already exists"). To recover, look at what that migration created, then either remove those tables so it can run again, or, if everything in it is already there, run `alembic stamp <its revision>` in the staging folder. Restore a database copy if in doubt.

## Going back to an older version

When a new version is broken, put the last good one back. **Mac:**

```bash
bash deploy/deploy.sh --rollback <last good commit>
```

The commit is the one `--go` printed as "Live before this upload", or pick it from `git log --oneline`. It must be on GitHub. It skips the tests (that commit passed them when it went out) and doesn't need a clean folder.

What it does on the server: installs, checks the import, takes a database copy, then, **instead of the database changes**, asks the older code whether it can run on the database as it is. If yes, it switches; if not, nothing changes and the broken version stays as it was.

Why this is needed: the database keeps the changes the broken version made. The older code has no record of them, so a normal upload of it stops on the database step. The app's database changes only ever add things, so older code runs fine on a newer database. The background jobs then write one line to their logs every minute, "Database is at …, newer than this code", to remind you that a fixed version is due. That's expected.

**If it says "Not switched":** the broken version made a database change marked as one older code can't live with (see below). Then, in this order:

1. Put back the database copy taken just before the broken upload (section "Backups", step "Putting the database back"). Its file name has the date and time of that upload.
2. Run `bash deploy/deploy.sh --rollback <last good commit>` again.

**Going forward again** after a rollback is a normal `--go` of a fixed commit. Never delete a migration file that has already run on the server: the next upload needs it.

**Limits:** `--rollback` only works to commits that already include it, so from the first upload after 2026-11-10's fixes on. For anything older it stops with a plain message; then upload a fixed version instead, or put back a database copy and upload the commit that matches it.

**For whoever writes migrations:** a migration must only add things. If one can't (it drops or renames something, or adds a required column with no default), call `mark_breaking(op.get_bind(), revision)` from `seo.core.schema` in its `upgrade()`. Going back to code from before it is then refused, instead of failing later in odd ways.

## Backups

**What is backed up**, every night at 02:20 server time (once the scheduled jobs of step 8 are installed) and before every upload, into `~/seo-platform/var/backups/`:

- `database/`: the whole database, compressed (`.sql.gz`).
- `note-files/`: the files attached to notes, from `~/seo-platform/var/note-files`, compressed (`.tar.gz`). The database only points at these files, so a restore needs both.

Each file is read back right after it's written; a copy that doesn't read back in full is removed and the run ends with an error in `var/logs/cron-backup.log`, so a broken file never passes for a good one.

**How long they're kept**, by age, not by count, so a day of many uploads can't push out last week's copy:

| | Database | Note files |
|---|---|---|
| Every copy from the last | 2 days | — |
| Newest copy of each of the last | 14 days, 8 weeks, 6 months | 7 days, 4 weeks, 3 months |

**Not in the backups, on purpose: keep these yourself.** The settings file `~/seo-platform/.env` (it holds the database password), and the encryption key `~/.config/seo-command-center/key` (in your password manager, see First-time setup). Without the key, the saved API keys in a restored database can't be read and must be pasted again in Settings.

### A copy off the server

Every copy above sits on the same hosting account as the database: if that account is lost, so are they. To keep one on your Mac, **Mac:**

```bash
bash scripts/pull_backups.sh
```

It uses the same settings and SSH key as `deploy.sh` and only reads from the server; it never deletes anything there. Copies go to `~/Backups/seo-command-center` (set `BACKUP_COPY_DIR` to choose another folder, an external disk for example), each new file is read back, and the Mac keeps them longer: the newest of each of 30 days, 12 weeks and 24 months. Your Mac's address must be on the SSH allow-list in cPanel, as for uploads. No new service and nothing to pay.

Run it by hand, say once a week, or have the Mac run it every day: `crontab -e` on the Mac and add one line (it runs only while the Mac is awake):

```
30 9 * * * cd "/path/to/seo-command-center" && bash scripts/pull_backups.sh >> "$HOME/Backups/seo-command-center-pull.log" 2>&1
```

If Time Machine covers your home folder, it also keeps those copies.

### Putting the database back

On the server. Pick the copy by its date and time in `~/seo-platform/var/backups/database` (or upload one from the Mac's copies with `scp`).

1. Put the copy back. `--replace` empties the database first, so everything written after the copy was taken is lost:
   ```bash
   cd ~/seo-platform && $VENV/bin/python scripts/restore_db.py var/backups/database/<file>.sql.gz --replace
   ```
   It reads the whole file first and stops if it's damaged, then lists every table with its number of rows. The site may show errors for the minute this takes.
2. Make code and database match again:
   - **Undoing a bad upload:** go back to the older version, **Mac:** `bash deploy/deploy.sh --rollback <last good commit>`.
   - **Only wanted the data back:** bring the copy up to the live code: `cd ~/seo-platform && $VENV/bin/alembic upgrade head`.
3. Open the site and check a few screens. The background jobs pick up again on their own.

To look inside a copy without touching the live database, put it into another, empty database instead: create one in cPanel → MySQL Databases, give the app's user rights on it, then `scripts/restore_db.py <file> --database <its name>`.

### Putting the note files back

```bash
cd ~/seo-platform/var && tar -xzf backups/note-files/<file>.tar.gz
```

This writes the files back into `var/note-files`, next to any that are there now; a file with the same name is replaced.

**Tried on 2026-11-10, on the Mac:** a made-up database with every table of the app (93 tables, 151 rows, with accents, Japanese and an emoji) was backed up with `scripts/backup_db.py`, put back into a second empty database with `scripts/restore_db.py`, and every table's row count and checksum matched. Putting it back over a database that had tables was refused without `--replace` and worked with it. It has not been tried on the server yet.

## What doesn't run on the live site

- **Browser on this Mac:** hidden there, by design.
- **Common Crawl's download:** run `scripts/common_crawl_links.py` on the Mac and upload the small CSV it makes.
- **The old Clarity harvester (`harvest.py`, `scripts/clarity_daily.py`):** not moved. The app's own collector replaces it, at 2 of Clarity's 10 daily requests. It keeps totals and referrers only, not pages or devices. Don't schedule both: together they'd run out the daily requests.

## Checks to make on the first upload

These can't be known from the Mac:

- Whether long jobs get cut off. A CPU cap per process was reported (420 s) but never confirmed. Scans stop at about 40 s and resume, so they should fit.
- Whether crawling, DuckDuckGo direct and SearXNG work from o2switch's address.
- Whether `mysqldump` or `mariadb-dump` runs from cron's PATH: look for today's file in `var/backups/database`.
- Whether Pillow loads on the server, for PDF exports: `bash deploy/deploy.sh --check` says.
- Whether a backup puts back: once, into a second empty database (section "Backups", end of "Putting the database back").
- Every real key: none has ever been tried, only fakes.
