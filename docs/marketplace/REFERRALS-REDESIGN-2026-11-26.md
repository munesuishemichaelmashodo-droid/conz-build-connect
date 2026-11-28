# Referral redesign — 26/11/2026 (branch `referrals/redesign`)

Referrals give **recognition only**: no cash, wallet or commission credit, discounts, partner benefits, or priority for jobs.

## In this branch
| Part | What |
| --- | --- |
| `0181_referrals_non_cash` | Same file as in PR #154 (moved here; remove it from #154). Removes both legacy cash paths (`process_referral_lifecycle` and `admin_referral_action('release')` credited `wallets.balance`); a trigger refuses any new `referral_bonus` wallet entry; stricter qualification; reasons for reject/freeze/clearing a flag; no direct writes on `referrals`. |
| `0185_referral_dashboard` | Milestones withdrawn (never deleted) when a counted referral is rejected, and reinstated if reached again; codes claimable only by new accounts (≤14 days, no completed job); `my_referral_progress()` (progress only, no names/ids, month joined); `referral_share_events` + `record_referral_share()` (30/day counted); `admin_referral_metrics()` (admins only). No DROP, no money, no settings. |
| App | `/refer` is now "Invite": role-specific reasons, what the invitee gets, link + WhatsApp + share + copy, progress, milestones (only visible to the user), rules. Admin referrals: no amounts, "Count now", "Withdraw (fraud found)", reason for clearing a flag, results card (shares, sign-ups, first deliveries, driver verification/5 jobs, repeat bookings, 30/60/90-day activity, review counts, demand by area with small areas grouped). Google sign-up keeps the `?ref=` code (`pending-referral.ts`). |

Not changed: legacy referral rows, amounts and notes; `system_settings.referral_rewards` (amounts there are now ignored); the cron job.

## Tested (local)
pgTAP full suite on a fresh local stack (13/08 baseline + migrations on `main` + 0181 + 0185): 109 files, 2,272 assertions, 0 failures
(`1190_referral_dashboard` 42, `1150` 20, `620` 22). Unit: 1,038 passed. Typecheck, `lint:security`, build: pass. Browser on the
local stand-in at phone width: driver, customer and admin screens, no money wording, no horizontal scroll, no page errors.

## Not verified
Production data (none exists: 0 referrals live), a real phone (WhatsApp hand-off inside the Android shell), Google sign-up with a link end to end.

## Production steps (owner approval needed for each; nothing has been applied)
1. Merge this PR (Vercel deploys). The page handles 0185 being missing (shows "could not be loaded"/"not available yet").
2. Apply `0181`, then `0185`, in the SQL editor or `execute_sql` (no DROP), and record them as `20261126130000` / `20261126170000`.
3. Check: `process_referral_lifecycle` body has no `wallets`; `trg_wallet_tx_no_referral_money` exists; anon cannot execute the three new functions.
4. Undo: `supabase/rollbacks/20261126170000_0185_rollback.sql`, then `..._0181_rollback.sql` (both contain DROP: SQL editor).
