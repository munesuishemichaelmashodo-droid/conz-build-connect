# ConZ MVP feature status (Option A), audited 05/11/2026

Source of truth: `main` at `f441806` plus read-only queries against production (project `ovwrsocjmkpiygipmrdk`) on 04-05/11. Documentation that disagreed with the database was overruled by the database.

Option A: customers pay drivers directly outside ConZ; drivers keep a commission-credit wallet; 7% of the full job value is reserved when the customer accepts a driver and captured after verified delivery; valid cancellations release it; customer payments never enter ConZ; no commission-wallet withdrawals; first-job-free kept; escrow, ConZ Pay, withdrawals and Payonify off.

Statuses: **V** complete and verified (production evidence named) · **I** implemented, not production-verified · **P** partial · **M** missing · **U** unsafe or defective · **B** blocked by owner decision or external dependency.

| Area | Status | Evidence and exact objects | Gap |
|---|---|---|---|
| Customer registration and profiles | I | Live trigger `on_auth_user_created` → `handle_new_user()` (0115 body; production catalog read 04/11). Local sign-up creates profile, role (pgTAP 740, journey 42/42). | No real-device sign-up; trigger not in the rebuild baseline (PR #60, 0141, merged, intentionally not applied) |
| Driver registration and verification | I | `admin_set_driver_verification` (live), `driver_profiles_guard_direct_write` (0115 live), 5 verified drivers in production. Local: verification gates the feed (journey). | Admin verification screen not exercised on a device |
| Trucks and vehicles | I | 0114 live: a truck change sends the driver back to review; `trucks` readable only by owner/admin/customers with an offer from that truck | `b08af632` has no truck (owner data) |
| Job creation and pricing | V | Pricing engine v1.4 (0127 live, owner-verified 02/11); `tg_validate_job_budget` → `compute_material_offer` | Booking screen not run on a device (needs the road-distance service) |
| Driver feed and offers | V (DB level) | 0133 live: masked `driver_open_jobs`, `driver_available_jobs`; production probe 04/11 and test job `0acf3a1d-…` (5 area-only notifications, 2 offers) | UI not exercised; the optional-deposit control was visible without 0135 (fixed in PR "hide deposit", see plan) |
| Customer compares and accepts a driver | V (DB level) | `accept_bid` (live, body differs from 0109 hash because later live migrations changed it); production test: accepted, rejected bid marked, no wallet change | UI not exercised |
| Commission calculation | U (edge case) | `commission_amount()` and rate 7 (live). Live `settle_direct_pay_job` hash `c9f46993…` recomputes 7% at completion instead of charging the reserved amount | Fixed by 0113 (not applied): a rate change or price edit mid-job charges a different amount from the reservation |
| Commission reservation | V (in use) | `hold_job_commission` live; production wallet `d1f71643` holds $48.09 reserved | Not exercised with a non-free driver in the 04/11 test |
| Commission capture and settlement | I | `settle_direct_pay_job` + `complete_job` live; local: first job $0, second job exactly 7%, wallet and ledger match | Production completion deliberately not run (would use a driver's free first job); 0113 pending |
| First-job-free | V (state) / I (behaviour) | `driver_profiles.first_job_free_used` flags in production (3 unused, 2 used); local behaviour correct | Not triggered in production |
| Driver wallet and top-ups | I | `request_topup`, `cancel_topup`, `admin_approve_topup`, `admin_reject_topup`, `credit_wallet_from_payment`, `apply_paynow_result` (live); wallet screen; Paynow live since 13/08 | See top-up findings below |
| Wallet integrity | I | `wallet_transactions_immutable` (0084), `platform_ledger_immutable`, `post_ledger`, `wallet_available`; pgTAP suites for reserve/charge/cap/limit | Immutability not re-proved against production in this audit |
| Withdrawals | V (off) | `withdrawals_enabled=false` (production setting); UI shows a paused state; admin approve/reject functions exist but the switch is off | Option A keeps this off |
| Promotional credit | B | 0134 not applied; `promo_credit_enabled` setting absent live | Excluded by the owner; do not apply |
| Optional offer deposits | P | UI deployed; 0135 not applied, so the columns are missing | Control now hidden until 0135 (PR), applying 0135 needs owner approval |
| Payment callbacks and reconciliation | I | `/api/public/paynow-ipn` verifies SHA-512 hash, UUID reference; `apply_paynow_result` checks reference, amount and state (live hash `2a497214…`); `/api/internal/paynow-reconcile` and `admin_reconciliation_report` exist | `PAYNOW_RECONCILE_SECRET` configuration not verified; BuySafe crediting issue (0116, PR #18) is an open owner decision |
| Cancellation and disputes | I | `cancel_job` (live), admin cancel (PR #44), dispute screens; `release_job_commission` | Cancellation and a disputed delivery not run in production |
| Tracking and location | V (DB level) | 0126 live; production test: location row written, customer reads it, a pure unselected driver cannot, signed-out link works | Real-device live tracking untested |
| Pickup and delivery evidence | B | 0110/0112 live; local: upload, evidence rows, start trip | Production photo upload needs a signed-in driver on a device |
| Customer completion code | I | `complete_job`, `get_my_delivery_pin` (live); local wrong code refused, correct code completes | Production wrong-code check needs an in-progress job |
| Notifications and push | V | Production DB checks 04/11; push delivered to a real device (owner confirmed); 0136, 0139, 0140 live | Only 2 of 5 drivers have a push subscription |
| Admin operations | P | `admin.revenue.tsx` (top-up and withdrawal queues, CSV), `admin.ledger.tsx`, `admin_reconciliation_report`, `admin_wallet_adjust/reverse`, `admin_request_wallet_credit` + `admin_decide_wallet_credit` (dual control), audit log | No single report for commission earned / reserved / available / disputed (see plan P3); 0129-0132 not applied |
| Security, RLS, storage | V (DB level) | 0133, 0138, 0140 live; storage policies for job-proof and chat media restricted to participants/admin | No HTTP-level production probe with real tokens; leaked-password protection off (Free plan) |
| Points and referrals | B | Code merged (PR #44); 0130/0131 not applied; tables absent live | Not part of Option A launch; do not change |
| Migration consistency | P | `schema_migrations` has no record of 0077-0108 (objects live); 0141 merged not applied | Owner-approved history repair; never `db push` |
| Android and mobile | I | Capacitor shell loads the site; CI builds the APK | Nothing exercised on a device in this audit |
| CI and tests | V | CI green on every merged PR; unit 573, pgTAP 69 files / 1495 | No end-to-end tests against production |

## Top-up findings (read from code and live objects)
- **Driver can start a top-up:** yes (`request_topup` and the Paynow flow in `wallet.tsx`).
- **Reference unique and callback authenticated:** yes: UUID reference; SHA-512 hash verified before anything is applied; the database re-checks reference and amount and refuses status regression.
- **Duplicate and late callbacks:** handled in `apply_paynow_result` (single credit, no regression); proven by Paynow pgTAP and callback tests in CI.
- **Credited only after verified payment:** Paynow `Awaiting Delivery` currently credits the wallet (BuySafe holds the money). 0116 (PR #18, not applied) would wait for settlement. Owner decision.
- **Reconciliation:** the 10-minute job needs `PAYNOW_RECONCILE_SECRET` set in Vercel (the endpoint returns 503 without it). Not verified.
- **Manual top-up:** driver request → admin approves or rejects (`admin_approve_topup` / `admin_reject_topup`), shown in the admin queue and CSV; the driver sees the status in the wallet.
