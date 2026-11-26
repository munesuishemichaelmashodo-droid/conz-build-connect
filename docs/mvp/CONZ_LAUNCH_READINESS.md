# ConZ launch readiness checklist (Option A), draft 05/11/2026

Verdict today: **not ready for open launch; fit for a controlled pilot** once the pilot test plan passes on real phones. Evidence: `CONZ_MVP_FEATURE_STATUS.md`.

## Must be done before real customers
| # | Item | Owner | State |
|---|---|---|---|
| 1 | Approve and apply 0113, verify live hash | Owner | Pending |
| 2 | Decide 0116 (credit on settlement or instant) | Owner | Pending |
| 3 | Confirm Paynow reconcile secret and the 10-minute job | Owner | Pending |
| 4 | Run the pilot test plan on one customer and one driver phone | Owner + Claude | Not started |
| 5 | Ask unsubscribed drivers to enable push | Owner | Pending |
| 6 | Delete the two demo edge functions | Owner | Pending |

## Already in place
Privacy and notification release live (exact addresses hidden from unselected drivers); no-login endpoints rate-limited; table grants narrowed; admin step-up and owner lock; honest price check; new homepage live; Terms and Privacy name Navysky Innovations (Private) Limited with its TIN; CI green on every merged change.

## Not part of the Option A launch
Withdrawals, escrow/ConZ Pay, promotional credit, points/referrals, Payonify. Keep switched off.

## Go / no-go rule
Go for a pilot when items 1-4 are done and the pilot plan has no open money or privacy failure. Open launch needs a week of pilot jobs reconciled with zero ledger mismatches.

## Still to write (after the payment milestone)
Financial operations manual and the top-up procedure: they depend on the Paynow/Payonify decisions.
