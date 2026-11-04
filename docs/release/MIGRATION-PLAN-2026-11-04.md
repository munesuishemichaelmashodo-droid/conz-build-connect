# Migration plan, 04/11/2026 (read-only audit; nothing here has been applied)

Production state (read through the Supabase API on 04/11): history ends at `0138` (20261103200000). Not recorded and not
present: 0113, 0116, 0120, 0121, 0129-0137, 0139, 0140. Commission 7, escrow off, withdrawals off. Points, promo and deposit
objects do not exist live. 90 jobs, 0 open at the time of the check.

## Dependency-ordered plan for the launch-critical set

| Order | Migration | Why | Depends on | Data effect | Contains DROP? | Notes |
|---|---|---|---|---|---|---|
| 1 | 0133 (after PR #58 merges) | Unselected drivers can read every open job's exact address, coordinates, notes and tracking token today (policy "Jobs visibility" lets any verified driver read open rows) | none | none (policy, helper functions, renames of two functions, masked wrappers) | No | The old `driver_job_history` joined `public.pods`, which does not exist live, so it fails on every call; PR #58 removes that join. App is already deployed with a safe fallback. |
| 2 | 0140 | The new-job notification and push carry the full delivery address to every verified driver | 0133 (`coarse_place`) | none (function text only; 283 old notification rows are left as they are) | No | |
| 3 | 0136 | "Clear" in the notification bell fails today (no `archived_at` column) | none | none (adds a nullable column and a partial index) | No | |
| 4 | 0139 | Returning-customer notification says "bid first to lock it in" | none | none (function text only) | No | |
| 5 | 0137 | Public `/open-jobs` preview currently shows "No open requests" | 0133 (`coarse_place`, `redact_contacts`) | none | No | Owner decision pending: whether budgets are shown publicly. |

## Not required by PRs #54-#56, #57, #58; apply only on separate approval
- 0113 settle with held commission: required before 0134. Changes how commission is charged (reserved amount); needs its own review.
- 0134 promo credit (needs 0113), 0135 offer deposits, 0131 points, 0132 verification SLA, 0129 launch-switch setter, 0130 referral fix: independent of the launch-critical set. Switches default off.
- 0116 (PR #18) and 0120/0121 (PR #38): payment-provider work; out of scope.

## Application notes
- Supabase MCP `execute_sql` hangs when the SQL contains `DROP`. 0131, 0132, 0134 and 0135 contain `drop trigger/policy if exists` on objects they create themselves; use the SQL editor or a DROP-free edit. 0133, 0136, 0137, 0139, 0140 have none.
- Record each version after applying (the history table is hand-maintained). Never `supabase db push`; no history repair as part of this.
- After 0133: run the HTTP-level probe (an unselected driver gets `[]` from `/rest/v1/jobs`, masked rows from the RPCs, 403 from the renamed exact functions); the same 14 checks passed against the local stack on 04/11.
- Undo scripts exist for every file above in `supabase/rollbacks/`.
