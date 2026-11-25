#!/bin/bash
# On-demand developer/security toolkit for a fresh cloud session (~25 s; trivy adds a few minutes).
# Usage: bash scripts/dev/install-toolkit.sh [--with-trivy]
# Each step is optional; pinned versions. GitHub release downloads are blocked in the cloud
# environment, so Go binaries are built through the Go module proxy.
export DEBIAN_FRONTEND=noninteractive
command -v fdfind >/dev/null || { apt-get update -qq && apt-get install -y -qq fd-find; } || true
command -v fdfind >/dev/null && ln -sf "$(command -v fdfind)" /usr/local/bin/fd
command -v semgrep >/dev/null || uv tool install semgrep==1.187.0 || true
command -v pip-audit >/dev/null || uv tool install pip-audit==2.10.1 || true
command -v lhci >/dev/null || npm i -g --no-fund --no-audit @lhci/cli@0.16.1 || true
command -v gitleaks >/dev/null || GOBIN=/usr/local/bin go install github.com/zricethezav/gitleaks/v8@v8.30.1 || true
# semgrep.dev (rule registry) is blocked here: use the official open rules from GitHub instead.
[ -d /opt/semgrep-rules ] || git clone -q --depth 1 https://github.com/semgrep/semgrep-rules /opt/semgrep-rules || true
if [ "${1:-}" = "--with-trivy" ]; then
  command -v trivy >/dev/null || GOBIN=/usr/local/bin go install github.com/aquasecurity/trivy/cmd/trivy@v0.76.2 || true
fi
for t in fd semgrep pip-audit lhci gitleaks trivy; do printf '%-10s %s\n' "$t" "$(command -v $t || echo 'not installed')"; done
# Scans:  gitleaks git --redact .   |   npm audit --omit=dev   |   trivy fs --scanners vuln,misconfig .
#         semgrep scan --metrics=off --config /opt/semgrep-rules/typescript --config /opt/semgrep-rules/javascript src
exit 0
