#!/usr/bin/env bash
# Upload the last commit to o2switch. Steps and first-time setup: deploy/DEPLOY.md.
#
#   bash deploy/deploy.sh --check   build what would go and list it. No network.
#   bash deploy/deploy.sh --go      upload it. Only when the owner says so.
#
# Settings, each with a default: SSH_USER, SSH_HOST, SSH_PORT, SSH_KEY, APP_NAME, PUBLIC_URL, VENV_BIN.
# SKIP_TESTS=1 skips the test run before an upload. FIRST_TIME=1 is for the very first upload: it makes the encryption key.
set -euo pipefail

MODE="${1:-}"
if [[ "$MODE" != "--check" && "$MODE" != "--go" ]]; then
  echo "Nothing uploaded. Use --check to see what would go, or --go to upload it." >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_USER="${SSH_USER:-khma1817}"
SSH_HOST="${SSH_HOST:-khma1817.odns.fr}"
SSH_PORT="${SSH_PORT:-22}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/github_deploy_creertesting}"
APP_NAME="${APP_NAME:-seo-platform}"
PUBLIC_URL="${PUBLIC_URL:-https://seo.my-emails.pro}"
VENV_BIN="${VENV_BIN:-/home3/$SSH_USER/virtualenv/$APP_NAME/3.12/bin}"

BUILD="$(mktemp -d "${TMPDIR:-/tmp}/seo-platform-build.XXXXXX")"
HOSTS="$BUILD.known_hosts" # in a path with no space: this project sits under "Claude & VS", which ssh's command line would split
trap 'rm -rf "$BUILD" "$HOSTS"' EXIT

# Only what's committed goes, so a stray file on the Mac can never reach the server.
paths=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] || paths+=("$line")
done < "$ROOT/deploy/bundle.txt"
git -C "$ROOT" archive --format=tar HEAD -- "${paths[@]}" | tar -x -C "$BUILD"
git -C "$ROOT" rev-parse HEAD > "$BUILD/REVISION"

if [[ "$MODE" == "--check" ]]; then
  echo "Would upload commit $(cat "$BUILD/REVISION"): $(find "$BUILD" -type f | wc -l | tr -d ' ') files, $(du -sh "$BUILD" | cut -f1)"
  for path in "${paths[@]}"; do
    echo "  $path: $(find "$BUILD/$path" -type f | wc -l | tr -d ' ') files"
  done
  exit 0
fi

# ---- from here on, it's a real upload ------------------------------------------------------------------
if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
  echo "Commit or set aside your changes first: only the last commit is uploaded." >&2
  exit 1
fi
git -C "$ROOT" fetch -q origin
if ! git -C "$ROOT" merge-base --is-ancestor HEAD origin/main; then
  echo "Push this commit to origin/main first, so what's live is always on GitHub." >&2
  exit 1
fi
[[ -f "$SSH_KEY" ]] || { echo "SSH key not found: $SSH_KEY" >&2; exit 1; }
if [[ "${SKIP_TESTS:-}" != "1" ]]; then
  (cd "$ROOT" && .venv/bin/pytest -q)
fi

cat "$ROOT/deploy/known_hosts" > "$HOSTS"
SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$HOSTS -p $SSH_PORT"
TARGET="$SSH_USER@$SSH_HOST"
STAGING=".deploy-staging/$APP_NAME"

$SSH "$TARGET" "mkdir -p $STAGING && chmod 700 .deploy-staging"
rsync -az --delete --exclude /.env --exclude /var -e "$SSH" "$BUILD/" "$TARGET:$STAGING/"
$SSH "$TARGET" "FIRST_TIME=${FIRST_TIME:-} APP_DIR=\$HOME/$APP_NAME STAGING_DIR=\$HOME/$STAGING VENV_BIN=$VENV_BIN bash \$HOME/$STAGING/deploy/server_release.sh"

# ---- did it work, and is anything private showing? --------------------------------------------------
code=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/login" || true)"
  [[ "$code" == "200" ]] && break
  sleep 3
done
if [[ "$code" != "200" ]]; then
  echo "The new version doesn't answer: $PUBLIC_URL/login gave $code." >&2
  echo "Going back: check out the last good commit and run this again. Database copies are in ~/$APP_NAME/var/backups/database." >&2
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
