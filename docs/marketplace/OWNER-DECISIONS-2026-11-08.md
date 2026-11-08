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
