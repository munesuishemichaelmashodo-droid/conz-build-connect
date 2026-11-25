#!/bin/bash
# SessionStart (cloud sessions only): install the dev/security toolkit and the app's npm packages,
# so tests, linters and scanners work in every session without changing environment settings.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}"

# Global tools: each step installs only what is missing and never fails the session.
bash scripts/dev/install-toolkit.sh >/dev/null 2>&1 || true

# npm packages: only when package.json / package-lock.json changed since the last good install.
hashes=node_modules/.session-start.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  rm -f "$hashes"
  npm install --no-audit --no-fund
  sha256sum .claude/hooks/session-start.sh package.json package-lock.json > "$hashes" || rm -f "$hashes"
fi
