# ConZ pilot test plan (Option A), draft 05/11/2026

Purpose: prove the core journey on real phones before real customers use it. Status: DRAFT. Steps that depend on an unapproved change are marked **[after 0113]** or **[after 0135]** and are skipped until that change is live.

Rules for every run
- Use test accounts and a small, clearly named test job. Never use a real customer's job.
- Do not complete a job with a driver whose free first job you want to keep; note `first_job_free_used` before and after.
- Record for each step: pass/fail, screenshot, time, device. Do not run payment or wallet-credit steps against Paynow (payments milestone is separate).
- Stop and report on the first money discrepancy (wallet, reserve, ledger).

## Devices
One customer Android phone, one driver Android phone (Chrome and the Capacitor app), one desktop browser for admin.

## Journey checks
| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Open conz.co.zw signed out on each phone | New homepage loads, no horizontal scroll, "Check delivery price" works | |
| 2 | Price check without an account | Guide range shown, no sign-in demanded | |
| 3 | Register a customer (email), confirm email | Lands in customer home; profile and role created | |
| 4 | Register a driver, add truck and documents | Driver sees "awaiting verification" | |
| 5 | Admin verifies the driver | Driver can see the feed; truck change later sends them back to review | |
| 6 | Customer posts a job | Booking accepted at the quoted price (no budget error) | |
| 7 | Driver feed | Driver sees area only, no exact address or phone before selection | |
| 8 | Driver sends an offer | Customer sees price, truck, verified badge; offer expires after 30 min | |
| 9 | Customer accepts | Other offers rejected; commission reserved on the driver wallet (not charged) | |
| 10 | Chat both ways | Messages arrive; push notification reaches the phone | |
| 11 | Driver shares location | Customer sees the truck only while sharing; shared tracking link works signed out | |
| 12 | Driver: pickup photo, Start trip | Evidence saved; pickup check flags only if over 2 km | |
| 13 | Driver: delivery photo | Evidence saved | |
| 14 | Customer gives wrong code | Refused, job stays in progress | |
| 15 | Customer gives correct code | Job completes; first job: commission $0 and flag set; later job: exactly the reserved 7% | |
| 16 | Wallet and ledger | Wallet movement equals ledger entries; reserved amount released/captured, not both | |
| 17 | Cancel a second test job before pickup | Reservation released in full | |
| 18 | Dispute a delivery | Customer and admin see it; admin panel shows photos, GPS and chat | |
| 19 | Repeat order after completion | "Order again" prefills; previous driver is only invited | |
| 20 | Rate change mid-job **[after 0113]** | Driver is charged the reserved amount, not a recomputed one | |

## Admin checks
Top-up queue approve and reject; ledger view; audit log entry for each admin money action; a money action needing the Google step-up asks for it; admin sign-in alert goes to owners only.

## Exit criteria
All numbered steps pass on both phones, no wallet/ledger mismatch, no exact address visible to an unselected driver, and every failure has an owner and a fix date.
