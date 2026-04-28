#!/usr/bin/env sh
# Run Python chapter scan regression tests with the same interpreter the app uses when available.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [ -x "$HOME/.audioBookConverter/bin/python3" ]; then
  PY="$HOME/.audioBookConverter/bin/python3"
else
  PY=python3
fi
exec "$PY" -m unittest tests.test_chapter_scan_models -v
