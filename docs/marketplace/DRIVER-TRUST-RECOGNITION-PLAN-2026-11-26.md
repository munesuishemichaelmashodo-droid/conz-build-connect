# Driver trust, recognition, public profiles and the first-job discount: plan (26/11/2026)

This is a plan only; nothing in it is built. Each phase is its own PR and needs the owner's go.

Evidence: `main` at `10d4b14`, plus read-only production queries on 26/11:
- 3 verified drivers, 0 completed jobs, 0 ratings, 0 referrals;
- the promo switch is ON, with one $20 grant outstanding.

## What exists (reuse, don't duplicate)

| Area | Exists today | Notes |
| --- | --- | --- |
| Verification | `driver_profiles.verification_status`, `verified_at`, `reverify_due_at` (90-day re-check enforced); ID, selfie, licence and truck photos; optional operator licence, fitness certificate, insurance and ZINARA documents; admin queue `admin.verifications.tsx` | Identity and vehicle are checked in one review today; there is no separate "vehicle verified" flag |
| Trucks | `trucks` (registration, capacity, body type, make, model, colour, photo) | Truck changes send the driver back to review (0114) |
| Public profile data | `driver_public_profiles` view (0170, live): rating average and count, level, jobs completed, verification status. Verified drivers only; signed-in users only | No public page or URL; no display name or photo in the view |
| Levels | `tg_driver_level`: bronze < 21 jobs, silver 21+, gold 101+, platinum 500+ | Counter-based; no rolling window; no commission effect |
| Ratings | `ratings` (4 criteria + comment, per job) → `rating_avg` / `rating_count` (trigger) | No minimum sample before display |
| Feedback | `delivery_feedback` (0149) | Not yet shown on profiles |
| Rebooking | "Invite this driver to bid again" (`jobs.preferred_driver_id`, `tg_notify_preferred_driver`): notifies, never assigns | No saved favourites list, no saved addresses |
| Referrals | 0181 (this PR): non-cash recognition, milestones 1/5/10/25/50 | Recognition is shown on `/refer` only |
| Sharing | `/refer` uses native share (Capacitor / Web Share), copy and WhatsApp | Reusable for profile sharing |
| Admin | Audit log, `require_aal2` step-up, notification fan-out to admins | — |

## Phase B: public driver profile and sharing (PR B1 + B2)

**B1. Database (one migration, no DROP):**
- `driver_profiles.public_profile_enabled` (default **false**; the driver opts in).
- `public_slug` (random, unguessable; regenerable by the driver).
- `public_display_name` (driver-chosen; defaults to first name + surname initial).
- `get_public_driver_profile(_slug)`: SECURITY DEFINER, callable by anon, returns an **explicit allowlist** only:
  - display name and optional photo;
  - "Identity verified" (verified and re-check not overdue);
  - "Truck checked" (current truck photo approved in the same review);
  - truck body type and capacity (no registration);
  - completed ConZ jobs;
  - rating average and count, **only when count ≥ 5** (otherwise "New on Con Z");
  - earned badges (Phase C);
  - member since (month and year).
- Never returned: ID numbers or images, licence, phone, email, addresses, payment details, messages, customers, admin notes, exact location, registration.
- Suspended, unverified or opted-out drivers return "profile not available". The response never distinguishes "doesn't exist" from "hidden".
- Rate-limited through the existing public-guard pattern.

**B2. App:**
- Route `/d/$slug` works signed out, with server-rendered social preview tags (title, description, generic image; no photo of the person unless they opt in).
- Profile settings: toggle visibility, edit display name, regenerate link.
- "Share my profile": native share, then Web Share, then copy link; WhatsApp button reuses `/refer`'s.
- Footer: "Con Z checks drivers' documents. Con Z does not guarantee a driver's conduct, safety or a job's outcome."

**Tests:**
- signed-out and unrelated-user access return only allowlisted keys (a JSON key-set assertion);
- hidden, suspended and unknown slugs are indistinguishable;
- rating hidden below 5;
- no registration or phone in the response or the HTML;
- rate limit;
- the driver controls.

## Phase C: non-cash recognition (PR C)

One `driver_badges` table (driver, badge, awarded_at, evidence jsonb, revoked_at, revoked_reason, revoked_by), written only by SECURITY DEFINER functions. A nightly idempotent job (upsert on driver + badge) recomputes them, and badges are revocable with a reason. Proposed badges, **all subject to the owner's approval:**

| Badge | Eligibility (exact) | Evidence | Expiry / revocation |
| --- | --- | --- | --- |
| Identity verified | `verification_status = verified` and `reverify_due_at > now()` | verification row | Removed automatically when lapsed or suspended |
| Truck checked | Truck approved in the latest review | truck id + review date | Removed when the truck changes (0114 sends back to review) |
| First delivery | ≥ 1 completed job (delivery photo + PIN, 0096) | job id | Removed if that job's dispute is upheld against the driver |
| 10 / 25 / 50 deliveries | ≥ N completed jobs, excluding jobs with an upheld dispute against the driver | count + date | Recomputed nightly |
| Well rated | ≥ 10 ratings in the last 180 days, average ≥ 4.5 | count, average, window | Recomputed nightly |
| On-time | Shown only once trustworthy timestamps exist (agreed delivery window vs delivery photo time) for ≥ 10 jobs, ≥ 90% within the window | Not proposed until the agreement delivery-window data is reliable | — |
| Referral milestones | Recognised referrals (0181) at 1 / 5 / 10 / 25 / 50 | `referral_milestones_achieved` | Revoked if a referral is later rejected |
| Profile complete | Display name, truck photo and visibility on | profile fields | Recomputed |

**Safeguards:**
- Only completed, verified deliveries count (photo + PIN), not jobs between the same two accounts beyond the first three in 30 days (anti self-dealing).
- Ratings only from the job's real customer.
- No rankings, no "top driver", no hidden allocation advantage; job visibility and dispatch rules are unchanged.
- Badges are explained in plain words on the profile and in a help article.
- Admin revoke / restore with a reason, audited.

**Customers (non-cash):**
- "First delivery" and "5 / 10 / 25 deliveries" badges shown only to the customer themselves.
- Saved delivery addresses and a "favourite drivers" list (private to the customer).
- Faster repeat booking (prefill, already exists) and invite-to-bid (already exists).
- No discounts, vouchers or credits.

**Tests:** boundary counts (9/10, 24/25); 179 vs 181 days; upheld vs dismissed disputes; nightly job idempotent and safe when run concurrently; revocation; customers see only their own badges and favourites.

## Phase D: first-job commission discount (PR D)

The existing $20 grant (0134 bucket) is **left exactly as it is** and keeps working under its original terms.

**Schema:**
- `promo_campaigns`: one row; enabled **false**; amount 20; budget (null = cannot award); max awards; start and end dates; created and updated by.
- `first_job_discounts`: one row per driver, unique on driver. Fields:
  - status: `awarded` → `reserved` (job id) → `consumed` | `expired` | `frozen` | `reversed` | `review`;
  - amount, job id, full commission, discount applied, net payable, marketing expense, timestamps.
- `first_job_discount_events`: append-only.

**Flow:**
- **Award.** On verification, only while the campaign is active and within its dates.
  - The campaign row is locked so committed (awarded + reserved + consumed) + amount ≤ budget, and awards stay ≤ the maximum.
  - A possible duplicate identity (same ID number, licence or phone as another driver) is set to `review` for a person to decide, never auto-blocked.
  - Drivers who already hold the 0134 grant are not awarded again.
- **Accept (`hold_job_commission`).**
  - Lock the job and the driver's discount row.
  - If `awarded`: discount = least(amount, commission), status `reserved`, and only the net is held from real credit.
  - `driver_can_accept_for` checks the net.
  - A second concurrent acceptance finds it `reserved` and pays full.
- **Complete (`settle_direct_pay_job`).**
  - Charge the net only; mark `consumed`; record full / discount / net and `marketing expense = discount`.
  - Any unused remainder is recorded as expired.
  - Ledger: commission revenue at net plus a memo marketing line (no wallet movement for the discount).
- **Cancel (`release_job_commission`).** Back to `awarded`, so it can be used on the driver's next first completed job. A dispute or failed delivery never completes, so nothing is consumed.
- **Admin.**
  - Campaign card: budget, committed, used, remaining, eligible drivers awarded, net commission impact.
  - Freeze, reverse or resolve a review, with a reason (super admin + `require_aal2`), audited.

**Tests:**
- commission below, equal to and above $20;
- insufficient credit for the net;
- cancel, then reuse;
- disputed or failed job;
- repeated completion;
- two jobs accepted at once;
- budget and maximum boundaries, including concurrent awards;
- campaign off or outside dates;
- duplicate review;
- freeze or reverse;
- the existing $20 holder unaffected;
- reconciliation all OK.

## Priority and order

| # | PR | Why first | Depends on |
| --- | --- | --- | --- |
| 1 | **0181 non-cash referrals** (this PR) | A live cron path could create unapproved cash-like rewards | — |
| 2 | B1 + B2 public profile + sharing | Highest trust value; reuses the 0170 view | — |
| 3 | C recognition (badges, customer favourites and addresses) | Needs the B profile to display | 2 |
| 4 | D first-job discount (campaign OFF) | Needs an owner budget before it matters; independent code | — |

**Owner decisions needed:**
- **Turn the live $20 switch off** until a budget is set.
- The badge thresholds above.
- Whether truck checks should become a separate review step.
- The profile disclaimer wording (lawyer).
