# Owner decisions reserved overnight (08/11/2026)

Built and tested, no production change: see the PR from `improve/honest-waiting-and-repost`
(repost button on cancelled/expired requests, honest waiting facts, prefilled repeat on the delivered screen,
customer-home wording that stays true under dispatch assignment, unused `NewJobListener` removed).

Reserved because they need you (nothing below was changed):

1. **Dispatch honesty.** `accept_dispatch_offer` can assign a driver without the customer choosing. Option B: customer
   confirms a dispatch acceptance. Option C: rewrite the promise ("a driver may be assigned automatically").
   Copy that claims the customer always chooses remains in `auth.tsx:496`, `RoleDashboard.tsx:229/252`,
   `jobs.index.tsx:168`, the driver walkthrough, and the public tracking step "Driver chosen" (`status-stamp`).
2. **Driver quick offer has no pickup time** (`useQuickAccept.ts`): adding one needs a UI choice (time chips) and a
   decision on whether a default may be shown. Not invented.
3. **What ConZ promises on no response**: needs an operational commitment first.
4. **Reminder channel before pickup** (push, SMS, WhatsApp; cost).
5. **Driver verification bar** (six photos, ~24 h manual review) and manual dispatch effort.
6. **Payment-adjacent, deliberately untouched**: commission explanation, direct-pay leverage, payment config.
7. **Operational**: diagnose the ~73 cancelled jobs with the new reason codes once real jobs flow; driver installs/interviews.

## Found by read-only checks on production, 08/11/2026 (not changed)

8. **Seven jobs are stuck in "accepted" / "in progress" for 19 to 88 days** (six `in_progress`, one `accepted`, all direct-pay,
   all with a pickup photo and none with a delivery photo; ids start `e12f5117`, `b69b742c`, `eca034d4`, `12e9ef14`, `00cc47cf`,
   `35f63f53`, `b2cf9b70`). Effects: each customer's home says "Your delivery is on the way", each driver is blocked from new jobs by the
   one-active-job rule (0144), and the marketplace metrics count them as neither completed nor cancelled. Admins already see them under
   "no update for 2+ days". Closing them means cancelling or completing, which releases or settles held commission, so it is left to you
   (and possibly a call to the customer or driver). If they are test jobs, say so and they can be closed the same way.
9. **No driver had a fresh availability row in the last 15 minutes** when checked overnight (5 verified drivers, 6 push subscriptions),
   so dispatch could not have reached anyone at that moment. This is supply, not code.
10. Screens checked in a browser against the sample-data stand-in at 390 px (customer, driver, applicant, admin: 39 screens): no page
    errors, broken text or horizontal overflow. Repost and the corrected notice confirmed visually. Not checked: real production data,
    a real phone, push delivery.
