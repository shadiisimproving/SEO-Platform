#!/usr/bin/env bash
# Adds this app's scheduled jobs to the account's crontab. Runs on the server. Safe to run again.
#
# The same crontab runs the CRM, the booking app and scheduled publishing. Piping into crontab wiped it on 2026-10-15,
# so this always: takes a backup, builds a file, installs from that file, reads it back, and puts the backup back if
# the result isn't exactly what it built. Only the lines between its own markers are ever replaced.
#
#   APP_DIR=$HOME/seo-platform VENV_BIN=/home/your-cpanel-user/virtualenv/seo-platform/3.12/bin bash deploy/install_cron.sh
set -euo pipefail

: "${APP_DIR:?APP_DIR is not set}"
: "${VENV_BIN:?VENV_BIN is not set}"
BEGIN="# BEGIN seo-platform (deploy/install_cron.sh)"
END="# END seo-platform"

die() { echo "$1" >&2; exit 1; }

backups="$HOME/crontab-backups"
mkdir -p "$backups"
chmod 700 "$backups"
backup="$backups/crontab-$(date -u +%Y%m%d-%H%M%S).txt"
crontab -l > "$backup" || die "Couldn't read the crontab, so nothing was changed."

# An unreadable table can look like an empty one. This account always has jobs, so empty means stop and look.
if [[ ! -s "$backup" && "${ALLOW_EMPTY_CRONTAB:-}" != "1" ]]; then
  die "The crontab came back empty, and this account should have jobs. Nothing was changed. If it really is empty, run again with ALLOW_EMPTY_CRONTAB=1."
fi

new="$(mktemp)"
after="$(mktemp)"
trap 'rm -f "$new" "$after"' EXIT

awk -v begin="$BEGIN" -v end="$END" '$0 == begin { skip = 1; next } $0 == end { skip = 0; next } !skip' "$backup" > "$new"

job() { # when, log name, command
  printf '%s cd %s && %s >> var/logs/cron-%s.log 2>&1\n' "$1" "$APP_DIR" "$3" "$2" >> "$new"
}
worker="$VENV_BIN/python -m seo.worker"
printf '%s\n' "$BEGIN" >> "$new"
job "* * * * *" crawl "$worker tick --lane crawl"
job "* * * * *" refresh "$worker tick --lane refresh"
job "* * * * *" collectors "$worker tick --lane collectors"
job "*/15 * * * *" uptime "$worker uptime-due"
job "7 * * * *" links "$worker links-due"
job "12 * * * *" collect "$worker collect-due"
job "0 6 * * *" social "$worker social-due"
job "20 2 * * *" backup "$VENV_BIN/python scripts/backup_db.py"
job "40 2 * * *" health "$worker health-due"
job "50 2 * * *" competitors "$worker competitors-due"
job "55 2 * * *" backlinks "$worker backlinks-due"
printf '5 3 * * * find %s/var/logs -name "cron-*.log" -size +5M -delete\n' "$APP_DIR" >> "$new"
printf '%s\n' "$END" >> "$new"

crontab "$new" || die "Installing failed. The old crontab should still be in place; its copy is $backup"

crontab -l > "$after" || true
if ! cmp -s "$new" "$after"; then
  crontab "$backup" || die "The crontab came out wrong AND putting it back failed. Install this by hand now: crontab $backup"
  die "The crontab came out wrong ($(wc -l < "$after" | tr -d ' ') lines, expected $(wc -l < "$new" | tr -d ' ')). The old one is back. Copy: $backup"
fi
echo "Crontab now has $(wc -l < "$after" | tr -d ' ') lines. Copy of the old one: $backup"
