#!/usr/bin/env bash
# Upload the last commit to the hosting. Steps and first-time setup: deploy/DEPLOY.md.
#
#   bash deploy/deploy.sh --check              build what would go and list it, then ask the server, reading only,
#                                              whether its Python has Pillow (PDF exports). Nothing is uploaded or changed.
#   bash deploy/deploy.sh --go                 upload it. Only when the owner says so.
#   bash deploy/deploy.sh --rollback <commit>  put an older commit back live, without running any database change.
#
# Settings: SSH_USER, SSH_HOST, SSH_KEY and PUBLIC_URL are required, SSH_PORT, APP_NAME and VENV_BIN have defaults.
# Put them in deploy/deploy.local.env, which is never committed (deploy/deploy.local.env.example shows how).
# The server's SSH host keys go in deploy/known_hosts.local, also never committed.
# SKIP_TESTS=1 skips the test run before an upload. FIRST_TIME=1 is for the very first upload: it makes the encryption key.
set -euo pipefail

MODE="${1:-}"
if [[ "$MODE" != "--check" && "$MODE" != "--go" && "$MODE" != "--rollback" ]]; then
  echo "Nothing uploaded. Use --check to see what would go, --go to upload it, or --rollback <commit> to go back." >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF="HEAD"
if [[ "$MODE" == "--rollback" ]]; then
  REF="${2:-}"
  [[ -n "$REF" ]] || { echo "Say which commit to go back to: bash deploy/deploy.sh --rollback <commit>. 'git log --oneline' lists them." >&2; exit 2; }
  git -C "$ROOT" rev-parse -q --verify "$REF^{commit}" > /dev/null || { echo "No commit $REF here. 'git log --oneline' lists them." >&2; exit 2; }
fi
# Which server and account: kept on the deploying computer, so the repo names no one's hosting.
LOCAL_SETTINGS="${DEPLOY_SETTINGS:-$ROOT/deploy/deploy.local.env}"
# shellcheck source=/dev/null
[[ -f "$LOCAL_SETTINGS" ]] && source "$LOCAL_SETTINGS"
SSH_USER="${SSH_USER:-}"
SSH_HOST="${SSH_HOST:-}"
SSH_PORT="${SSH_PORT:-22}"
SSH_KEY="${SSH_KEY:-}"
APP_NAME="${APP_NAME:-seo-platform}"
PUBLIC_URL="${PUBLIC_URL:-}"
VENV_BIN="${VENV_BIN:-/home/$SSH_USER/virtualenv/$APP_NAME/3.12/bin}"
KNOWN_HOSTS_FILE="${KNOWN_HOSTS_FILE:-$ROOT/deploy/known_hosts.local}"

BUILD="$(mktemp -d "${TMPDIR:-/tmp}/seo-platform-build.XXXXXX")"
HOSTS="$BUILD.known_hosts" # in a path with no space: this project sits under "Claude & VS", which ssh's command line would split
trap 'rm -rf "$BUILD" "$HOSTS"' EXIT

# Only what's committed goes, so a stray file on the Mac can never reach the server.
paths=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] || paths+=("$line")
done < "$ROOT/deploy/bundle.txt"
git -C "$ROOT" archive --format=tar "$REF" -- "${paths[@]}" | tar -x -C "$BUILD"
git -C "$ROOT" rev-parse "$REF" > "$BUILD/REVISION"

SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$HOSTS -o ConnectTimeout=15 -p $SSH_PORT"
TARGET="$SSH_USER@$SSH_HOST"
[[ -s "$KNOWN_HOSTS_FILE" ]] && cat "$KNOWN_HOSTS_FILE" > "$HOSTS"

if [[ "$MODE" == "--check" ]]; then
  echo "Would upload commit $(cat "$BUILD/REVISION"): $(find "$BUILD" -type f | wc -l | tr -d ' ') files, $(du -sh "$BUILD" | cut -f1)"
  for path in "${paths[@]}"; do
    echo "  $path: $(find "$BUILD/$path" -type f | wc -l | tr -d ' ') files"
  done
  # PDF exports need Pillow (reportlab brings it). This only reads: -B stops Python writing even a cache file.
  if [[ -n "$SSH_USER" && -n "$SSH_HOST" && -f "$SSH_KEY" && -s "$KNOWN_HOSTS_FILE" ]]; then
    for module in PIL reportlab; do
      if version="$($SSH "$TARGET" "$VENV_BIN/python -B -c 'import $module; print($module.__version__)'" 2>/dev/null)"; then
        echo "Server: ${module/PIL/Pillow} $version can be imported."
      else
        echo "Server: ${module/PIL/Pillow} can't be imported (or the server didn't answer). PDF exports need it: the next --go installs it from requirements.txt. Still missing after that? See \"Pillow\" in deploy/DEPLOY.md."
      fi
    done
  else
    echo "Server not asked about Pillow: fill in $LOCAL_SETTINGS and deploy/known_hosts.local first."
  fi
  exit 0
fi

# ---- from here on, it's a real upload ------------------------------------------------------------------
if [[ "$MODE" == "--rollback" ]]; then
  # Older commits don't know how to go back without migrating: their release script would stop on Alembic, safely.
  if ! git -C "$ROOT" show "$REF:deploy/server_release.sh" | grep -q 'ROLLBACK'; then
    echo "Commit $REF is older than the going-back mode, so it can't be put back this way. Upload a fixed version instead, or restore a database copy (deploy/DEPLOY.md)." >&2
    exit 1
  fi
elif [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
  echo "Commit or set aside your changes first: only the last commit is uploaded." >&2
  exit 1
fi
git -C "$ROOT" fetch -q origin
if ! git -C "$ROOT" merge-base --is-ancestor "$REF" origin/main; then
  echo "Push this commit to origin/main first, so what's live is always on GitHub." >&2
  exit 1
fi
for needed in SSH_USER SSH_HOST SSH_KEY PUBLIC_URL; do
  [[ -n "${!needed}" ]] || { echo "Set $needed in $LOCAL_SETTINGS first. deploy/deploy.local.env.example shows how." >&2; exit 1; }
done
[[ -f "$SSH_KEY" ]] || { echo "SSH key not found: $SSH_KEY" >&2; exit 1; }
[[ -s "$KNOWN_HOSTS_FILE" ]] || { echo "The server's host keys aren't in $KNOWN_HOSTS_FILE. deploy/DEPLOY.md says how to get them." >&2; exit 1; }
# Going back skips the tests: they'd test the code on this Mac, not the older commit, which passed them when it went out.
if [[ "${SKIP_TESTS:-}" != "1" && "$MODE" == "--go" ]]; then
  (cd "$ROOT" && .venv/bin/pytest -q)
fi

STAGING=".deploy-staging/$APP_NAME"
WAS_LIVE="$($SSH "$TARGET" "cat \$HOME/$APP_NAME/REVISION 2>/dev/null" || true)"
[[ -n "$WAS_LIVE" ]] && echo "Live before this upload: commit $WAS_LIVE"

$SSH "$TARGET" "mkdir -p $STAGING && chmod 700 .deploy-staging"
rsync -az --delete --exclude /.env --exclude /var -e "$SSH" "$BUILD/" "$TARGET:$STAGING/"
ROLLBACK=""
[[ "$MODE" == "--rollback" ]] && ROLLBACK=1
$SSH "$TARGET" "FIRST_TIME=${FIRST_TIME:-} ROLLBACK=$ROLLBACK APP_DIR=\$HOME/$APP_NAME STAGING_DIR=\$HOME/$STAGING VENV_BIN=$VENV_BIN bash \$HOME/$STAGING/deploy/server_release.sh"

# ---- did it work, and is anything private showing? --------------------------------------------------
code=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/login" || true)"
  [[ "$code" == "200" ]] && break
  sleep 3
done
if [[ "$code" != "200" ]]; then
  echo "The new version doesn't answer: $PUBLIC_URL/login gave $code." >&2
  if [[ "$MODE" == "--rollback" ]]; then
    echo "The older version doesn't answer either. Try an older commit, or put back a database copy: deploy/DEPLOY.md, \"Backups\"." >&2
  else
    echo "Going back: bash deploy/deploy.sh --rollback ${WAS_LIVE:-<last good commit>}. Steps in deploy/DEPLOY.md, \"Going back\"." >&2
  fi
  exit 1
fi
for private in .env passenger_wsgi.py alembic.ini seo/config.py requirements.txt var/backups/ deploy/deploy.sh; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/$private" || true)"
  if [[ "$code" == "200" ]]; then
    echo "DANGER: $PUBLIC_URL/$private can be read from the web. Fix this before anything else." >&2
    exit 1
  fi
done
echo "Live: $PUBLIC_URL, commit $(cat "$BUILD/REVISION")"
