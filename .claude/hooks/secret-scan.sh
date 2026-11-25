#!/usr/bin/env bash
# PostToolUse: scan the file just written for secrets with gitleaks (if installed). Feedback only.
in=$(cat); f=$(jq -r '.tool_input.file_path // ""' <<<"$in")
[ -f "$f" ] && command -v gitleaks >/dev/null || exit 0
out=$(gitleaks dir "$f" --no-banner --no-color --redact -v --exit-code 7 2>&1); rc=$?
[ $rc -eq 7 ] || exit 0
jq -n --arg r "gitleaks found a possible secret in $f. Remove it and use environment settings instead. $(grep -E '^(RuleID|Line):' <<<"$out" | head -6 | tr '\n' ' ')" '{decision:"block",reason:$r}'
