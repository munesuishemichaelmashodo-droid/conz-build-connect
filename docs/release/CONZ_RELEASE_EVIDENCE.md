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

## Addendum: 0162 (09/11/2026, later)
| What | Evidence |
| --- | --- |
| Code | PR #108 merged as `9da59f0`; CI build-and-verify, database-tests (full pgTAP: 90 files / 1827 tests) and build-android-apk all success |
| Deployed | Production job-page chunk `jobs._id-qylzq-bK.js` contains "Only the driver can propose a deposit" (fetched from www.conz.co.zw after the merge) |
| Database (the only production write this session) | `propose_job_agreement` replaced. Pre-check: live body md5 `32cef48ff10fd6da5f14a8cebfc43167` = the undo file; 0 rows in `job_agreements`. Post-check: `2a21534304acbac17fe1835d0a80c9b1` = committed text; security definer; anon cannot execute, authenticated can. Recorded in `schema_migrations` as `20261109170000` |
| Rollback | `supabase/rollbacks/20261109170000_0162_rollback.sql` (applied then re-applied cleanly on the local stack) |
| Not exercised | A real customer/driver agreement on production (0 agreements exist); only the local pgTAP covers the customer-refused and carried-deposit paths |
| CI note | The push run on `main` after PR #106 had `build-android-apk` red: Gradle wrapper download failed (network error in the job log); other jobs green; the next main run was green |

## Addendum: 0163 (09/11/2026, later)
| What | Evidence |
| --- | --- |
| Code | PR #111 merged as `427c549`; CI build-and-verify, database-tests (full pgTAP 90 files / 1830 tests) and build-android-apk all success |
| Deployed | Production job-page chunk `jobs._id-BoMkvQ-u.js` contains "The driver changed the deposit" |
| Database | `propose_job_agreement` replaced. Pre-check md5 `2a21534304acbac17fe1835d0a80c9b1`, 0 agreements; post-check `11b918d150ecc0bbee7e8c8e8b9b59f6` = committed text; security definer; anon cannot execute, authenticated can. Recorded `20261109180000` |
| Rollback | `supabase/rollbacks/20261109180000_0163_rollback.sql` (restores the 0162 body) |
| Not exercised | A real agreement on production (0 exist); local pgTAP covers the customer-refused, carried-deposit and superseded-deposit paths |
