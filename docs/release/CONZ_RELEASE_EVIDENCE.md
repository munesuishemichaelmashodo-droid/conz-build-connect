# ConZ release evidence (09/11/2026)

| What | Evidence |
| --- | --- |
| `main` after this session's merges | PR #104 `eb363a5` (zod 4 + seroval), PR #105 `435b0f6` (Stage 0 docs), PR #106 `6445f8e` (Stages 1-6 docs, two copy fixes, one stale admin label) |
| CI on PR #104 and #106 | `build-and-verify` success, `database-tests` success, `build-android-apk` success (PR #105 was docs-only: only the preview checks ran) |
| Local checks before PR #106 | `tsc --noEmit` exit 0; `npm test` 851 passed, 9 skipped (91 files, 1 skipped file); `npm run lint:security` exit 0; `npm run build` exit 0 |
| Production smoke test after merge (read-only HTTP GET) | `https://www.conz.co.zw/` 200, `/terms` 200, `/mcp` 401 (login required, as designed) |
| Database changes this session | **None.** Only read-only queries against production (migration list, settings, counts, `prosrc` scans, RLS/bucket/grant audit) |
| Staging | `conz-staging` paused at the owner's request, confirmed `INACTIVE` |
| Not verified | Vercel deployment id (no Vercel tool in this session; the live site served 200 after merge); real Android device; iOS (no project); push delivery; real Google sign-in; Paynow live payment |

Rollback for this session's code: revert PR #106 (two one-line copy changes and a label). No migrations to undo.
