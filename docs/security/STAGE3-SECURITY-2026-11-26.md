# Stage 3: security, fraud prevention and trust (26/11/2026)

Branch `stage3/security`, from `main` at `10d4b14`.
- Nothing is applied to production; no settings were changed.
- Rating privacy is **not** repeated here: it is PR #152 (0182).
- The booking journeys' privacy is in PR #153 (0183).

## 1. Vulnerabilities confirmed (production, read-only, 26/11)

| # | Severity | Finding | Exploitable? | Fixed by |
| --- | --- | --- | --- | --- |
| V1 | High | Referral processing credits **real commission credit**; admin "release" too; no locking (possible double credit) | When a referred driver completes 5 jobs (0 referrals live) | 0181, moved to PR #156 (one copy only) |
| V2 | Medium | Any admin can close a dispute by editing the row: no audit entry, no `resolved_by`, no notice to either party (the admin screen's "Reject" did exactly this) | Any admin account | 0184: `admin_reject_dispute` / `admin_mark_dispute_investigating`; direct UPDATE/DELETE revoked |
| V3 | Low | `disputes` / `chat_flags`: anon SELECT, authenticated write grants left over | No: RLS has no matching policy (defence in depth) | 0184 |
| V4 | Medium | No place to review weak fraud signals: shared phones, self-dealing pairs, reused payment references, flagged referrals | — | 0184 `admin_trust_signals()` + admin "Trust" screen |
| V5 | Low | Clearing a referral fraud flag needed no reason | Any admin | 0181 in PR #156 (reason required) |

## 2. Existing protections preserved (inspected, not rebuilt)

- **Rating privacy:** PR #152.
- **Job privacy before selection:** 0133/0153. **Collection-point privacy:** 0183.
- **Payment statements:** write-once, parties only (0179/0180).
- **Delivery evidence:** completion needs the photo and the PIN (0096), with PIN attempts limited.
- **Money columns guarded** (0155). Commission engine and ledger unchanged.
- **Private storage buckets:**
  - `job-proof-photos` and `chat-media`: the job's parties and admins;
  - `driver-docs`: the owner and admins.
- **Duplicate driver identity:** national ID unique (`uq_driver_profiles_national_id`).
- **Paynow callbacks:** hash, reference and amount checks, idempotent; the reconcile endpoint fails closed without its secret.
- **Admin accountability:**
  - append-only audit log; owners are alerted on every entry;
  - money and role actions need step-up (`require_aal2`);
  - super admin only for the listed owners.
- **Supabase advisor (26/11):** only the known, accepted items:
  - the definer view `driver_public_profiles`;
  - `pg_net` in public;
  - leaked-password protection (Free plan);
  - reviewed anon functions;
  - three deny-all tables.

## 3. Admin authenticator: exact state and safe procedure (owner action; nothing changed here)

| Item | State (prod, 26/11) |
| --- | --- |
| `system_settings.admin_authenticator_required` | `false` |
| Owners in `super_admin_owners` | 2 |
| Owners with a verified authenticator (TOTP) | **0 of 2** |
| Effect today | A Google sign-in from the last 12 h satisfies step-up for money and role actions |

Procedure (switching it on before both owners have enrolled would lock out money and role actions):
1. Each owner signs in, opens the admin strip → **Set up authenticator** (`/mfa`), scans the code with an authenticator app, and enters a code.
2. Check that both owners have a verified factor (I can run this read-only on request).
3. One owner, with a fresh authenticator code, opens **Settings → Admin authenticator** and switches it on (`admin_set_authenticator_required`, owner-only, audited).
4. Optional later: apply 0174 so only an authenticator code (never Google alone) counts as step-up.

## 4. Remaining risks

- **Phone numbers are not verified by SMS** and not unique (none are shared live today). They are shown as signals only, by design, because families and businesses share phones.
- **A colluding customer and driver can still complete a job** (the PIN is entered by the colluding customer). The repeated-pair and same-phone signals surface it for review; nothing blocks it automatically.
- **Admin views of driver documents are not logged individually:** signed URLs are made in the browser. Opening the Trust screen is logged.
- **Rate limits** on no-login endpoints are per server instance.
- **Leaked-password protection** stays off on the Free plan.
