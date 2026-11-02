#!/bin/bash
# Installs the app's npm dependencies at the start of a Claude Code cloud session, so
# typecheck, lint, unit tests and the build work straight away. Local sessions are skipped.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# npm install (not ci) so the cached container keeps node_modules between sessions.
npm install --no-audit --no-fund --loglevel=error
