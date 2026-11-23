#!/usr/bin/env bash
# Runs on the server, from the staged copy. deploy.sh starts it.
#
# The order is what makes a failure safe: until the last step the live folder hasn't changed, so a failed install,
# import check, backup or migration leaves the old version running. Migrations run while the old code still serves,
# so they must only add things. Settings (.env) and everything in var/ (note files, backups, locks, logs) are never touched.
# ROLLBACK=1 (deploy.sh --rollback) puts older code back without running migrations or the data steps.
set -euo pipefail

: "${APP_DIR:?APP_DIR is not set}"
: "${VENV_BIN:?VENV_BIN is not set}"
STAGING_DIR="${STAGING_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
KEY="$HOME/.config/seo-command-center/key"

die() { echo "$1" >&2; exit 1; }
[[ -f "$APP_DIR/.env" ]] || die "No $APP_DIR/.env yet. See First-time setup in deploy/DEPLOY.md."
# Only the first release may make the key. Later on, a missing key means something went wrong: a new one would make
# every saved API key unreadable without saying so.
[[ -f "$KEY" || "${FIRST_TIME:-}" == "1" ]] || die "No encryption key at $KEY. Put your copy back from the password manager. Only on the very first upload: FIRST_TIME=1."
[[ -x "$VENV_BIN/python" ]] || die "No Python app at $VENV_BIN. See First-time setup in deploy/DEPLOY.md."

chmod 600 "$APP_DIR/.env"
mkdir -p "$APP_DIR/var/logs"
# The staged code reads the live settings and writes its backup to the live folder.
ln -sfn "$APP_DIR/.env" "$STAGING_DIR/.env"
ln -sfn "$APP_DIR/var" "$STAGING_DIR/var"

cd "$STAGING_DIR"
"$VENV_BIN/pip" install -q -r requirements.txt
[[ -f "$KEY" ]] || "$VENV_BIN/python" -m seo.core.crypto init
"$VENV_BIN/python" -c "import passenger_wsgi"
"$VENV_BIN/python" "$STAGING_DIR/scripts/backup_db.py"
if [[ "${ROLLBACK:-}" == "1" ]]; then
  # Going back to older code. Its folder has no file for the newest migration, so Alembic would stop here and the
  # broken version would stay live. Skip it, and ask the older code whether it can run on the database as it is:
  # it can, unless a migration it doesn't know was marked breaking (seo/core/schema.py). Then nothing is switched.
  "$VENV_BIN/python" -m seo.core.schema || die "Not switched: this older version can't run on the database as it is. Upload a fixed version instead, or restore the database copy from before the bad release (deploy/DEPLOY.md)."
else
  "$VENV_BIN/alembic" upgrade head
  # Stored data the new rules must look at again, after every migration, on every release: each one only changes what is
  # still to change, so a second run does nothing (their tests: test_competitor_noise, test_serp_accuracy). Counts go to
  # the screen and to var/logs/release-data-steps.log. A failure stops here, with the old code still live; what a step
  # already kept is safe, and the next release runs it again.
  DATA_LOG="$APP_DIR/var/logs/release-data-steps.log"
  echo "---- $(date -u '+%Y-%m-%d %H:%M:%S') UTC, release $(cat "$STAGING_DIR/REVISION" 2>/dev/null || echo unknown)" >> "$DATA_LOG"
  echo "Hiding stored competitor events nobody made (scripts/reclassify_competitor_events.py --apply)"
  "$VENV_BIN/python" -m scripts.reclassify_competitor_events --apply 2>&1 | tee -a "$DATA_LOG" || die "Not switched: hiding old competitor events failed (see $DATA_LOG). The old version is still live."
  echo "Marking rank checks every other tool contradicts (scripts/mark_contradicted_checks.py --apply)"
  "$VENV_BIN/python" scripts/mark_contradicted_checks.py --apply 2>&1 | tee -a "$DATA_LOG" || die "Not switched: marking contradicted rank checks failed (see $DATA_LOG). The old version is still live."
fi

rsync -a --delete --exclude /.env --exclude /var --exclude /tmp --exclude /.htaccess "$STAGING_DIR/" "$APP_DIR/"
# rsync copies the staged folder's private mode onto this one, and Passenger can't enter it then: every page answers 500.
# This folder is outside the web folder, so opening it serves nothing. var/ holds backups and note files, and stays closed.
chmod 755 "$APP_DIR"
chmod 700 "$APP_DIR/var"
mkdir -p "$APP_DIR/tmp"
touch "$APP_DIR/tmp/restart.txt"
echo "Released $(cat "$APP_DIR/REVISION" 2>/dev/null || echo unknown)$([[ "${ROLLBACK:-}" == "1" ]] && echo ", going back: no database changes ran")"
