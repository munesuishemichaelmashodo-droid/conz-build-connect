#!/usr/bin/env bash
# PreToolUse guard: blocks or asks before actions that reach production, rewrite history or expose secrets.
# deny = never allowed from an agent; ask = the owner must approve in the UI each time.
set -u
in=$(cat)
tool=$(jq -r '.tool_name // ""' <<<"$in")
decide() { jq -n --arg d "$1" --arg r "$2" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'; exit 0; }

case "$tool" in
  Bash)
    cmd=$(jq -r '.tool_input.command // ""' <<<"$in")
    grep -qiE '(^|[;&|[:space:]])supabase[[:space:]]+db[[:space:]]+(push|reset)' <<<"$cmd" && decide deny "ConZ rule: never run supabase db push/reset (schema_migrations repair first; owner applies migrations)."
    grep -qE 'git[[:space:]]+push.*([[:space:]]-f([[:space:]]|$)|--force([^-]|$)|--mirror|--delete|[[:space:]]:[A-Za-z])' <<<"$cmd" && decide deny "Force-push / branch deletion is not allowed from an agent."
    grep -qE 'git[[:space:]]+push.*([[:space:]]|:)(main|master)([[:space:]]|$)' <<<"$cmd" && decide deny "Pushing to main deploys production. Open a PR for the owner instead."
    grep -qiE '(^|[;&|[:space:]])(npx[[:space:]]+)?vercel([[:space:]].*)?[[:space:]](--prod|deploy|promote|rollback|alias)' <<<"$cmd" && decide ask "Vercel deploy/promote/alias changes production. Owner approval required."
    grep -qE '(^|[;&|[:space:]])npm[[:space:]]+publish' <<<"$cmd" && decide deny "Publishing packages is not allowed from an agent."
    grep -qiE '(^|[;&|[:space:]])(npx[[:space:]]+)?wrangler[[:space:]]+(deploy|publish|versions[[:space:]]+deploy|secret|d1[[:space:]]+execute.*--remote)' <<<"$cmd" && decide ask "Cloudflare deploy / secret / remote database change. Owner approval required."
    grep -qE '(cat|less|head|tail|cp|curl[^|]*-d[[:space:]]*@)[^|;&]*\.env(\.[a-z]+)?([[:space:]]|$)' <<<"$cmd" && decide ask "This reads or sends a .env file that may hold secrets."
    ;;
  Edit|Write|MultiEdit)
    f=$(jq -r '.tool_input.file_path // ""' <<<"$in")
    case "$f" in */.env|*/.env.*) [[ "$f" == *.example ]] || decide ask "Editing $f (may hold secrets; never commit it)." ;; esac
    ;;
  mcp__Supabase__execute_sql)
    q=$(jq -r '.tool_input.query // ""' <<<"$in" | tr '[:upper:]' '[:lower:]')
    if grep -qE '^[[:space:]]*(select|with|explain|show)\b' <<<"$q" && ! grep -qE '\b(insert|update|delete|alter|create|drop|grant|revoke|truncate|comment|copy|call|do|set[[:space:]]+role|vacuum|refresh)\b' <<<"$q"; then exit 0; fi
    decide ask "SQL that may write to a Supabase database. If this is production, it needs the owner's explicit go."
    ;;
  mcp__Supabase__apply_migration|mcp__Supabase__deploy_edge_function|mcp__Supabase__create_edge_function_secret|mcp__Supabase__*branch|mcp__Supabase__pause_project|mcp__Supabase__restore_project|mcp__Supabase__create_project)
    decide ask "Changes a Supabase project. Owner approval required (ConZ: never apply migrations automatically)." ;;
  mcp__github__merge_pull_request|mcp__github__enable_pr_auto_merge|mcp__github__delete_file|mcp__github__create_repository)
    decide ask "Merging to main deploys production / changes a repository. Owner approval required." ;;
  mcp__Vercel__create_deployment|mcp__Vercel__request_promote|mcp__Vercel__request_rollback|mcp__Vercel__assign_alias|mcp__Vercel__*project_env|mcp__Vercel__update_project|mcp__Vercel__pause_project|mcp__Vercel__buy_domain|mcp__Vercel__*firewall*|mcp__Vercel__*domain*record*|mcp__Vercel__create_record|mcp__Vercel__update_record)
    decide ask "Changes Vercel production, settings or billing. Owner approval required." ;;
esac
exit 0
