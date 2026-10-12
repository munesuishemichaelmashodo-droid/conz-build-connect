# ConZ UI-to-RPC compatibility matrix (2026-10-12)

State: branch `feature/nationwide-sourcing`, HEAD `390cc8d`, working tree with uncommitted 0098-0100 (local only).
Method: 50 distinct RPC names extracted from the working-tree app (`src`, server functions). Compared by
argument names and execute grants against (a) the local stand-in database (full chain + 0098-0100) and
(b) production, read-only catalog queries (names, argument names, grants only; no row data).
Local database is a Postgres 16 stand-in, not the real Supabase stack. Production data fetched 2026-10-12.

## Result

| Comparison | Match | Missing | Different args |
|---|---|---|---|
| App vs local DB | 50 / 50 | 0 | 0 |
| App vs production | 42 / 50 | 7 | 1 |

## Production gaps (app would fail until the matching migration is live)

| RPC | Production | Fixed by | Release constraint |
|---|---|---|---|
| `create_price_quote_for` | missing (booking fails closed) | 0098 bridge, then 0080 strict version | Stage A, no app deploy needed |
| `create_material_sourcing_request` | exists, no `p_idempotency_key` | 0088+ | database first (old-app compatibility with the changed signature not verified) |
| `issue_sourcing_quote` | missing | 0088+ | database first |
| `decline_sourcing_request` | missing | 0088+ | database first |
| `my_sourcing_history` | missing | 0088+ | database first |
| `admin_mark_withdrawal_paid` | missing | 0077-0097 range | database first |
| `admin_mark_withdrawal_failed` | missing | 0077-0097 range | database first |
| `admin_decide_pin_recovery` | missing | 0077-0097 range | database first |

Also known from earlier cycles: production `complete_job` is one-argument; the working-tree app sends the delivery
code, so the database (Stage B) must be live before this app version.

## Grants check: functions production restricts to service_role

`claim_super_admin`, `expire_stale_dispatch_offers`, `expire_stale_open_jobs` are called from browser code with the
user session. They are service-role-only locally and in production (deliberate 07/10 lockdown), so those client calls
fail:

- `admin.settings.tsx` -> `claim_super_admin`: button shows the error toast for everyone. Intended (bootstrap closed).
- `JobOfferListener.tsx` -> `expire_stale_dispatch_offers`: fire-and-forget; no effect. Server cron
  `sweep-dispatch-offers` (every minute) does the job. No functional loss.
- `use-expire-stale-jobs.ts` -> `expire_stale_open_jobs`: errors ignored; cron `expire-stale-open-jobs` (every 30 min)
  covers it. Behavioural note: client-side 3 s sweeps no longer run, so stale open jobs expire up to 30 min later.
  This is a product-timing question, not a security defect. Do not re-grant to authenticated.

`apply_paynow_result`, `expire_stale_paynow_payment`, `paynow_pending_for_reconcile`, `anonymize_deleted_account` are
called only from `*.server.ts` / API routes with the service role. Correct.

Anonymous-executable in production: `compute_material_offer`, `get_public_tracking` (intended; matches lockdown list).

## Production cron jobs (read-only)

9 active jobs. Not present in production: `expire-sourcing-requests` (comes with 0088). All others expected.

## Verdict

Local app/database compatibility: complete. Production compatibility: 7 missing RPCs plus one signature difference,
all resolved by the documented release order (Stage A then Stage B); nothing applied.

## Addendum (evening): app now calls 51 RPC names
`decline_dispatch_offer` (new, 0102) is called by the driver Decline button; it is missing in production until 0102 is
applied. The call is best effort (errors ignored; the offer timeout still applies), so the old database does not break the
app. `supply_stock_status` (0101) is available for labelling but is not yet called by the app.

## Addendum (final tree): app now calls 52 distinct literal RPC names (simple grep; multi-line calls may add a few)
New since the table above, all missing in production until the migration is applied:
- `supply_stock_status` (0101): called after quoting for the advisory label; fail-safe to "unknown" if absent.
- `confirm_job_supply` (0104): supplier-confirmation button; absent = the action errors, nothing else depends on it.
- `decline_dispatch_offer` (0102): best effort, errors ignored.
- `admin_set_diesel_price` / `admin_set_demand_multiplier` keep their signatures; behaviour changes (0103: super admin + step-up).
Local compatibility remains complete; production gaps are resolved only by the order in the release-order document.
