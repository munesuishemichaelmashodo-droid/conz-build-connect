# Customer retention, trust and learning loop (07/11/2026)

Branch `retention/trust-differentiation`, from `main` at `09d83bf` (PR #71 and #72 merged). One consolidated PR. Nothing here is
applied to a hosted database, deployed or merged. Migrations 0148–0151 exist only as files and on the local test stack.

## What already existed and was preserved
Repeat booking ("Need the same again?" with fresh pricing and the previous-driver invitation), the returning-customer indicator and its
explanation, Best match (display only, never auto-picks the cheapest), evidence upload, delivery PIN, cancellation and no-show recovery
(0145, 0147), dispatch windows and viewed tracking (0146), the driver-side reachability states.

## What was added or fixed
| Area | Change |
|---|---|
| Cancellation learning (0148) | One optional category per cancellation, role-appropriate, chosen by the person who cancelled. The server derives the actor, refuses client writes, classifies the 24 h no-show sweep, and a manual cancel with the sweep's wording is not a no-show. Old rows stay unknown. **Defect found by its own test:** guard triggers written as SECURITY DEFINER could not see the caller's role; now SECURITY INVOKER. |
| Post-delivery feedback (0149) | "What mattered most about this delivery?", optional and dismissible, one response per completed job, owner-only, RLS read-own, writes via RPCs. |
| Admin metrics (0150) | `admin_marketplace_metrics(days)` and a "Marketplace health" card: raw counts, numerator/denominator, small-sample marking, jobs and offers kept apart, no identifiers. A no-show reopening is tracked (`jobs.no_show_reopened_at`, guarded) and is never a new request. |
| Dispatch notification (0151) | Load, material, area, straight-line distance to pickup and the customer's budget; never the street address, coordinates, contact details or the free-text material description. A notification row means "queued", not "delivered". |
| Repeat booking | The booking screen now names the reused details, says the price is quoted fresh, and says an invited previous driver is not assigned and gets no priority. Pickup details are never reused. |
| Honest signals | The customer's offer card no longer says "Online" (it means the app was open); a driver's average rating is shown only from three ratings. |
| Copy | Customer and driver promises on the homepage. |

## Metric definitions (numerator / denominator)
See the header of `supabase/migrations/20261107170000_0150_admin_marketplace_metrics.sql` and `src/lib/marketplace-metrics.ts`.
Key rules: jobs are the cohort created in the period; offers are dispatch offers sent in the period (system exclusion rows are not
offers); repeat requests include retries after a failure, so repeat COMPLETED deliveries are reported separately.

## Tests
pgTAP 830 (cancellation reasons, 17), 840 (feedback, 18), 850 (metrics, 19), 860 (dispatch text, 9), 870 (authorisation + money
invariance, 14); unit tests for the reason options, feedback helpers, metric formatting, repeat-notice text, ratings and copy.

## Not changed (by instruction)
Commission rate and calculation, reserve/release rules, wallet and credit behaviour, Paynow/Payonify, escrow/BuySafe, settlement.
Test 870 proves the new paths move no money.

## Deployment order
App from this branch first, then 0148, 0149, 0150, 0151 (each is safe alone; the app tolerates a missing function and shows no card).
