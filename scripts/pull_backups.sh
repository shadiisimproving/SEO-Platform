#!/usr/bin/env bash
# Copies the server's backups to this Mac, so one copy lives off the hosting account. Runs on the Mac; it only reads
# from the server and never deletes anything there. Steps, and how to run it every day: deploy/DEPLOY.md, "Backups".
#
#   bash scripts/pull_backups.sh
#
# Same settings as deploy/deploy.sh (deploy/deploy.local.env and deploy/known_hosts.local, never committed).
# BACKUP_COPY_DIR says where the copies go on the Mac; default ~/Backups/seo-command-center. Each new file is read back
# after it arrives, and copies here are kept longer than on the server: all from 2 days, then the newest of each of
# 30 days, 12 weeks and 24 months.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_SETTINGS="${DEPLOY_SETTINGS:-$ROOT/deploy/deploy.local.env}"
# shellcheck source=/dev/null
[[ -f "$LOCAL_SETTINGS" ]] && source "$LOCAL_SETTINGS"
SSH_USER="${SSH_USER:-}"
SSH_HOST="${SSH_HOST:-}"
SSH_PORT="${SSH_PORT:-22}"
SSH_KEY="${SSH_KEY:-}"
APP_NAME="${APP_NAME:-seo-platform}"
KNOWN_HOSTS_FILE="${KNOWN_HOSTS_FILE:-$ROOT/deploy/known_hosts.local}"
DEST="${BACKUP_COPY_DIR:-$HOME/Backups/seo-command-center}"
PYTHON="${PYTHON:-$ROOT/.venv/bin/python}"

for needed in SSH_USER SSH_HOST SSH_KEY; do
  [[ -n "${!needed}" ]] || { echo "Set $needed in $LOCAL_SETTINGS first. deploy/deploy.local.env.example shows how." >&2; exit 1; }
done
[[ -f "$SSH_KEY" ]] || { echo "SSH key not found: $SSH_KEY" >&2; exit 1; }
[[ -s "$KNOWN_HOSTS_FILE" ]] || { echo "The server's host keys aren't in $KNOWN_HOSTS_FILE. deploy/DEPLOY.md says how to get them." >&2; exit 1; }

HOSTS="$(mktemp "${TMPDIR:-/tmp}/seo-pull-hosts.XXXXXX")" # a path with no space: ssh's -e command line would split one
trap 'rm -f "$HOSTS"' EXIT
cat "$KNOWN_HOSTS_FILE" > "$HOSTS"
SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$HOSTS -o ConnectTimeout=15 -p $SSH_PORT"

mkdir -p "$DEST"
chmod 700 "$DEST"
# No --delete: a copy the server has dropped stays here. (macOS's rsync ignores --chmod, hence the chmod after.)
rsync -a --itemize-changes -e "$SSH" "$SSH_USER@$SSH_HOST:$APP_NAME/var/backups/" "$DEST/" | tee "$DEST/.last-pull.txt"
chmod -R go= "$DEST"

bad=0
while IFS= read -r line; do
  [[ "$line" == ">f"* ]] || continue
  file="$DEST/${line#* }"
  case "$file" in
    *.sql.gz) "$PYTHON" -c 'import sys; sys.path.insert(0, sys.argv[1]); from scripts.backup_db import verify_dump; from pathlib import Path; verify_dump(Path(sys.argv[2]))' "$ROOT" "$file" || { echo "Doesn't read back: $file" >&2; bad=1; } ;;
    *.tar.gz) tar -tzf "$file" > /dev/null || { echo "Doesn't read back: $file" >&2; bad=1; } ;;
  esac
done < "$DEST/.last-pull.txt"

for kind in database note-files; do
  [[ -d "$DEST/$kind" ]] || continue
  "$PYTHON" -c 'import sys; sys.path.insert(0, sys.argv[1]); from pathlib import Path; from scripts.backup_db import prune; prune(Path(sys.argv[2]), "*.tar.gz" if sys.argv[2].endswith("note-files") else "*.sql.gz", {"daily": 30, "weekly": 12, "monthly": 24, "all_hours": 48})' "$ROOT" "$DEST/$kind"
done

newest="$(ls -t "$DEST"/database/*.sql.gz 2>/dev/null | head -1 || true)"
echo "Backups on this Mac: $DEST. Newest database copy: ${newest:-none yet}"
exit "$bad"
