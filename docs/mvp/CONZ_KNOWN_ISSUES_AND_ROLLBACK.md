# ConZ known issues and rollback, draft 05/11/2026

## Known issues (open, with owner)
| Issue | Impact | State |
|---|---|---|
| 0113 not applied | A rate or price change mid-job charges a different commission from the reservation | Written, tested, awaiting owner approval |
| Paynow credits at "Awaiting Delivery" (0116/PR #18 not applied) | A driver could spend credit ConZ has not yet received | Owner decision |
| `PAYNOW_RECONCILE_SECRET` not verified in Vercel | Stuck top-ups are not repaired automatically (endpoint returns 503 without it) | Owner to confirm |
| 0135 not applied | Optional offer deposits unavailable (control hidden) | Owner decision |
| `schema_migrations` lacks 0077-0108 | `supabase db push` would misbehave | Never run it; repair needs owner approval |
| Leaked-password protection off | Weak passwords not screened | Needs a paid Supabase plan; accepted on Free |
| `pg_net` in the public schema; two unused demo edge functions (`quick-responder`, `smooth-handler`) | Advisor warning; ORS key spend by anyone with the public key | Owner to delete the functions in the dashboard |
| 3 of 5 drivers have no push subscription | They miss offers | Ask drivers to enable notifications |
| Real-device checks not done (photos, tracking, Capacitor app) | Unknown device-specific faults | Pilot test plan |
| Barlow Condensed font | Not checked on a real phone after the homepage redesign | Owner to look |

## Rollback
- **App:** revert the merge commit on `main` (a normal revert PR); Vercel redeploys. Or promote the previous deployment in Vercel.
- **Database:** every migration applied since 23/10 has an undo script in `supabase/rollbacks/` holding the exact earlier definitions. Run it in the SQL editor if it contains DROP, otherwise via `execute_sql` with comment-only lines removed. Verify function hashes after.
- **Settings:** commission rate and prices are changed only through the admin screens (audited); put the previous value back the same way.
- **Never:** run `supabase db push`, edit ledger rows, or delete the production test job.
