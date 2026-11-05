#!/usr/bin/env bash
# Runs on the server, from the staged copy. deploy.sh starts it.
#
# The order is what makes a failure safe: until the last step the live folder hasn't changed, so a failed install,
# import check, backup or migration leaves the old version running. Migrations run while the old code still serves,
# so they must only add things. Settings (.env) and everything in var/ (note files, backups, locks, logs) are never touched.
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
"$VENV_BIN/alembic" upgrade head

rsync -a --delete --exclude /.env --exclude /var --exclude /tmp --exclude /.htaccess "$STAGING_DIR/" "$APP_DIR/"
mkdir -p "$APP_DIR/tmp"
touch "$APP_DIR/tmp/restart.txt"
echo "Released $(cat "$APP_DIR/REVISION" 2>/dev/null || echo unknown)"
