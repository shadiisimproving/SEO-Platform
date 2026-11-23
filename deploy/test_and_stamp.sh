#!/usr/bin/env bash
# Runs the full test suite on the last commit and, when every test passes, stamps that commit as tested, so
# deploy/deploy.sh --go doesn't run the same 25 minutes of tests again for it (owner, 2026-11-23).
#
#   bash deploy/test_and_stamp.sh          needs a clean folder: the stamp must describe exactly the commit
#   DB_NAME_TEST=test_x_test bash deploy/test_and_stamp.sh    on a private test database (other sessions share the default)
#
# The stamp is var/tests-passed/<commit> (var/ is never committed). A failed run writes nothing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
  echo "Commit or set aside your changes first: the stamp says this exact commit passed." >&2
  exit 1
fi
COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
STAMP="$ROOT/var/tests-passed/$COMMIT"
if [[ -f "$STAMP" ]]; then
  echo "Already passed for $COMMIT ($(cat "$STAMP"))."
  exit 0
fi
(cd "$ROOT" && .venv/bin/pytest -q)
mkdir -p "$ROOT/var/tests-passed"
date "+%Y-%m-%d %H:%M" > "$STAMP"
echo "Passed: $COMMIT stamped as tested. A deploy of it skips the tests."
