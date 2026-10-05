# Con Z — Production Readiness, Security & Play Store Audit

**Date:** 04/10/2026 · **Scope:** repo `main` @ `f622744`, live Supabase project `ovwrsocjmkpiygipmrdk` (read-only inspection), deployed Edge Functions, Android/Capacitor config, CI, dependencies, git history.

> **Confidential.** This describes unfixed weaknesses in a live system. Keep the repo private. Remove or redact this file once the P0 items are fixed, if the repo's audience ever widens.

**Evidence tags:** **[LIVE]** read from the live DB/Edge Functions on 04/10/2026 via read-only queries · **[CODE]** repository path:line · **[RUN]** command executed during this audit · «NOT VERIFIED — insufficient evidence.» where it could not be confirmed.
No exploit was executed against production. Findings are proven from the exact live policy/trigger/function definitions cited; §12 lists tests to confirm each fix on a **staging copy**.

---

## 1. Executive summary

### Verdict: **NOT READY**

Strengths found (with evidence): RLS is enabled on all 51 public tables [LIVE]. `wallet_transactions` and `job_evidence` are immutable via triggers [LIVE]. Money RPCs lock rows (`FOR UPDATE`) and re-check the caller [LIVE]. Paynow IPNs are hash-verified [CODE `paynow-ipn.ts:15`]. The service-role key is server-only and absent from git history [RUN]. Storage buckets are private [LIVE]. Email confirmation is enforced: 3 unconfirmed users, none ever signed in [LIVE]. The 30/09 audit fixes `0063–0065` are live [LIVE].

The core weakness is systemic: **guard triggers protect `UPDATE`, but RLS also lets clients `INSERT`/`DELETE` the same rows directly**, and several protected columns are missing from the guards. That pattern produces the four blockers:

| ID | Blocker (summary) |
|---|---|
| C1 | Escrow delivery PIN is readable by the assigned driver, so escrow release does not actually require the customer |
| C2 | Driver verification (KYC), level, stats and "first job free" can be self-set through INSERT/DELETE on `driver_profiles` |
| C3 | Bid counter-offer fields can be set by the driver at INSERT, so a driver can be assigned a job at a price the customer never agreed |
| C4 | The `send-push` Edge Function accepts unauthenticated requests, so anyone can push arbitrary notifications to users |

Current exposure [LIVE]: 14 users, 12 paid Paynow top-ups, **0** escrow payments ever paid. No escrow loss can have occurred yet, but C2, C4 and H2–H4 are exposed today.

---

## 2. Architecture map

```
Clients: browser (conz.co.zw / www / *.vercel.app) · Android = Capacitor WebView loading https://www.conz.co.zw
   │  supabase-js direct (publishable key + user JWT)        │ TanStack Start server functions + server routes
   ▼                                                         ▼
Supabase PostgREST / Realtime / Storage / Auth        Vercel (Nitro) — requireSupabaseAuth (getClaims)
   (email+pw, Google OAuth, phone OTP via SMS hook)       supabaseAdmin = SERVICE ROLE (bypasses RLS)
   │                                                      paynow.functions, account(.deletion), booking,
   │                                                      PUBLIC: getRoute, geocode, computePublicOffer, getPublicPod
   │                                                      /api/public/paynow-ipn · /mcp (Lovable MCP)
   ▼                                                         ▼
Postgres 17 — the real enforcement layer: RLS, ~95 SECURITY DEFINER RPCs (most EXECUTE-able by anon),
guard triggers (UPDATE only), pricing (compute_material_offer, tg_validate_job_budget), wallets/payments/escrow,
pg_cron (escrow auto-release, expiries, referral payouts, GPS prune), pg_net → Edge Function send-push
   ▼
External: Paynow (live) · OSRM public demo · LocationIQ/Nominatim · Lovable AI gateway · Web Push/FCM ·
Africa's Talking (SMS) · CARTO/OSM tiles · Google OAuth
```

**Roles:** `customer`, `driver` (both self-grantable via `self_add_base_role` [LIVE]), `admin`, `super_admin` (granted by super_admin, or by the hard-coded e-mail in `activateAccount` [CODE `src/lib/account.functions.ts:52`]).

**Flows traced end-to-end:** quote → job post → dispatch/bid → accept → evidence/trip → GPS → complete (direct / escrow / PIN / 72h cron) → commission; Paynow top-up (IPN + poll reconcile); withdrawal request → admin approval; referral lifecycle; account deletion.

---

## 3. Critical issues (blockers)

Each blocker gives the mechanism and evidence at a level sufficient to verify and fix it; working exploit payloads are deliberately omitted. A staging reproduction test is referenced for each (§12).

### 🔴 C1 — Escrow delivery PIN readable by the driver
- **Where:** `public.jobs.delivery_pin`; policy `Jobs visibility`; RPC `driver_confirm_delivery_pin`; trigger `tg_generate_delivery_pin`; [CODE `src/routes/_authenticated/jobs.$id.tsx:205`] `.select("*")`.
- **Problem:** The PIN that is meant to prove the customer received the load lives in plaintext on the `jobs` row. The assigned driver can `SELECT` that row under `Jobs visibility` (`driver_id = auth.uid()`), and `authenticated` has table-level SELECT covering `delivery_pin` [LIVE: `has_column_privilege('authenticated','jobs','delivery_pin','SELECT') = true`]. `driver_confirm_delivery_pin` only checks the PIN matches and a delivery photo exists, then calls `release_escrow_and_complete` [LIVE]. There is no attempt counter or lockout, and the PIN is generated with `floor(random()*1000000)` (not a CSPRNG) [LIVE].
- **Impact:** The driver can release the customer's escrowed funds to their own wallet without the customer confirming delivery; even without reading it, a 6-digit PIN with no rate limit is brute-forceable within the 72h window. Escrow's entire purpose is defeated.
- **Fix (DB):** Store only a hash of the PIN (`crypt`/`gen_random_bytes`), off the `jobs` row (customer-readable via an RPC, never driver-readable); add ≤5 attempts per job with lockout + admin alert. Interim: `REVOKE SELECT` on `jobs` and re-grant all columns except `delivery_pin`; change `.select("*")` to explicit columns.
- **Verify:** T-SEC-01.

### 🔴 C2 — Driver KYC / stats / commission state self-settable
- **Where:** policy `Drivers manage own profile` (`FOR ALL`, `user_id = auth.uid()`); trigger `trg_driver_profiles_guard_direct_write` (**BEFORE UPDATE only**); RPC `self_add_base_role`.
- **Problem:** The guard blocks *updates* to `verification_status`, `level`, `jobs_completed`, `rating_*`, `first_job_free_used`, etc. But the same policy also allows `INSERT` and `DELETE` (`has_table_privilege('authenticated','driver_profiles','DELETE') = true` [LIVE]), with no INSERT guard and no FK preventing deletion. A user can delete their row and re-insert it with any values, then self-grant the `driver` role. The bids INSERT policy only requires `verification_status='verified'` + `driver` role + a non-limited wallet [LIVE].
- **Impact:** Any signed-up user becomes a "verified" driver with no ID/licence/truck on file (core safety-vetting bypass); can reset `first_job_free_used` to avoid commission on every job; can set `level='platinum'` to lower the commission multiplier; feeds referral-cash farming (H7).
- **Fix (DB):** Change the policy to `SELECT` + `UPDATE` only; remove client `INSERT`/`DELETE`; add a `BEFORE INSERT` guard forcing safe defaults; ideally move verification/level/stats/`first_job_free_used` into an admin-owned table. (Attempted staging proof inside a rolled-back transaction was declined by the operator; the policy/trigger/grant definitions above establish the gap.)
- **Verify:** T-SEC-02.

### 🔴 C3 — Forged counter-offer bid → self-assign a job at an arbitrary price
- **Where:** policy `Drivers create bids` (INSERT); triggers `bids_guard_direct_write` (**UPDATE only**), `tg_guard_bid_insert` (checks job-open only); RPC `accept_counter`.
- **Problem:** On INSERT the driver controls every bid column, including `status`, `counter_status`, `customer_counter_price`. `accept_counter` treats `counter_status='countered'` as proof the *customer* made that offer and then assigns the job at `customer_counter_price` and rejects all other bids [LIVE]. No server-side record ties a counter to the customer.
- **Impact:** A driver can insert a bid that already looks "customer-countered at $X", accept it, and be assigned any open job at a price the customer never set (high to overcharge, or low). If the customer later pays escrow, the forged `final_price` is the amount held.
- **Fix (DB):** `BEFORE INSERT` guard on `bids` forcing `status='pending'`, `counter_status='none'`, `customer_counter_price=NULL`, `created_at=now()` for client roles; record `countered_by/at` server-side in `counter_bid` and require them in `accept_counter`.
- **Verify:** T-SEC-03.

### 🔴 C4 — Unauthenticated push-notification spoofing (`send-push`)
- **Where:** Edge Function `send-push` (`verify_jwt: false` [LIVE]); trigger `tg_send_push_on_notification`.
- **Problem:** The function accepts `{user_id, title, body, job_id}` from any caller and fans out Web Push + FCM to that user's devices, with no secret/signature/JWT check [LIVE source]. The DB trigger calls it with only a `Content-Type` header [LIVE]. Target user IDs are enumerable — the anon-readable view `driver_public_profiles` lists every driver `user_id` (M2).
- **Impact:** Anyone on the internet can send branded phishing pushes ("Con Z: wallet locked — verify your EcoCash PIN …") to any/every user.
- **Fix:** Add a shared secret (Supabase Vault + Edge secret), send it from the trigger header, reject mismatches (constant-time); or set `verify_jwt: true` and call with the service-role JWT. Also verify `notification_id` exists with the same `user_id`.
- **Verify:** T-SEC-04.

---

## 4. Security findings — complete table

| Sev | ID | Finding | Layer |
|---|---|---|---|
| 🔴 | C1 | Driver reads escrow `delivery_pin` → self-release; no rate limit; `random()` PIN | DB |
| 🔴 | C2 | KYC/stats/commission forgery via `driver_profiles` INSERT+DELETE | DB |
| 🔴 | C3 | Forged counter-offer bid → hijack open job at any price | DB |
| 🔴 | C4 | `send-push` unauthenticated → push spoofing to any user | Infra |
| 🟠 | H1 | `jobs` INSERT accepts `status/driver_id/final_price/completed_at…` → fake completed jobs; `ratings.driver_id` not tied to job → rating manipulation | DB |
| 🟠 | H2 | Suspension/ban/restriction self-liftable: clients can `UPDATE profiles.status/restricted_until/strikes/rating`; auth user not banned; bids ignore status | DB |
| 🟠 | H3 | Withdrawal PIN/balance checks bypassable via direct INSERT into `wallet_withdrawal_requests`; PIN reset needs no old PIN & clears lockout; approval ignores `held`/`limited` | DB |
| 🟠 | H4 | `admin_credit_wallet` (any admin, unlimited, no reason, self-target) bypasses the $500 threshold; admins can approve their own top-ups/withdrawals/verification; admin MFA removed | DB |
| 🟠 | H5 | Customer can flip `payment_method` after escrow funded → escrow stranded, PIN/auto-release disabled; escrow amount not reconciled with `final_price`; `cancel_job` ignores paid escrow | DB/backend |
| 🟠 | H6 | Paynow: `paid`→`failed` regression on a later failure IPN (no status guard); signed poll payload replay re-credits; refunds/chargebacks never debited | Backend/DB |
| 🟠 | H7 | Referral rewards auto-paid on forgeable data (C2) with client-supplied fraud signals; `record_referral` callable anytime | DB |
| 🟠 | H8 | Native Google OAuth returns tokens via custom scheme `com.conz.app://oauth-callback` → interceptable by any app registering the scheme | Mobile/Auth |
| 🟠 | H9 | `send-sms` auth hook fail-open: signature verified only if `SEND_SMS_HOOK_SECRET` is set → SMS pumping / phishing «NOT VERIFIED whether the secret is set» | Infra |
| 🟠 | H10 | Direct `INSERT` into `disputes` bypasses `raise_dispute` → open disputes on any job against anyone; freezes escrow auto-release; admin spam | DB |
| 🟠 | H11 | Hard-coded super-admin bootstrap by e-mail in `activateAccount` on `main` (no `email_verified` check on `main`) | Backend |
| 🟡 | M1 | Pricing trusts client `pickup_lat/lng` on INSERT; `quantity_m3`/`delivery_*` edits never re-validated; `create_price_quote` callable with any distance; no coordinate range checks | DB/backend |
| 🟡 | M2 | `SECURITY DEFINER` views anon-readable: `driver_public_profiles` (all driver IDs + KYC status), `market_rate_history` (completed-job prices) | DB |
| 🟡 | M3 | Any self-declared (unverified) "driver" can read every open job's delivery address & coordinates | DB |
| 🟡 | M4 | KYC docs mutable/deletable by the driver after verification; `driver-docs`/`chat-media` buckets have no size/MIME limits | Storage |
| 🟡 | M5 | `conversation_members` INSERT lets any user join any conversation (latent IDOR; feature unused today) | DB |
| 🟡 | M6 | `log_admin_action` executable by anon/any user → forged audit entries | DB |
| 🟡 | M7 | No rate limiting on public server fns (`getRoute`, geocode, `computePublicOffer`, `getPublicPod`); OSRM public demo used in prod; leaked-password protection disabled | Backend/Auth |
| 🟡 | M8 | Prod-tree dependency advisories (`hono`, `@hono/node-server`, `ip-address`, `fast-uri`, `qs`, `dompurify`, `postcss`, `nanoid`, `js-yaml`, `browserslist`) | Supply chain |
| 🟡 | M9 | Paynow integration ID + key prefix/suffix logged every call (`paynow.server.ts:10`) — fixed only on unmerged branch | Backend |
| 🟡 | M10 | Account deletion incomplete (sessions not revoked, errors ignored, address/chat/roles/devices kept, nested KYC files missed); privacy page contradicts in-app deletion | Backend/Legal |
| 🟡 | M11 | Post-login open redirect: `next=/\evil.com` passes the `startsWith("/") && !startsWith("//")` check | Frontend |
| 🟡 | M12 | Migration drift again: `0063–0065` live but only on unmerged branch `ccr-2ceacd4e-qmuqsb`, not `main` | Process |
| 🟡 | M13 | Truck capacity/registration self-declared, unverified; all trucks (plates) readable by every user | DB |
| 🟡 | M14 | GPS fully client-supplied, no plausibility/range checks; customer reads location after job ends (until pruned); `driver_availability` locations never pruned (policy says 24h) | DB/Privacy |
| 🟡 | M15 | `allowBackup="true"` — WebView localStorage (Supabase refresh token) included in Android backups | Mobile |
| 🔵 | L1 | Paynow hash compare not constant-time; IPN parser accepts duplicate/unknown keys; IPN amount not compared to stored amount | Backend |
| 🔵 | L2 | DB/PostgREST error text returned to clients (`booking.functions.ts:308,347`; raw RPC errors in UI) | Backend |
| 🔵 | L3 | `anon` holds column INSERT/UPDATE grants on `wallets`/`wallet_transactions` and full grants on most tables (RLS currently blocks) | DB |
| 🔵 | L4 | `wallets` has no `CHECK (held >= 0)`; `hold_job_commission` ignores the level multiplier used at completion | DB |
| 🔵 | L5 | Leftover demo Edge Functions `smooth-handler`, `quick-responder` (latter proxies the ORS API key to any publishable-key holder) | Infra |
| 🔵 | L6 | `expire_stale_open_jobs` anon-executable (harmless today); `count_available_verified_drivers` callable by any user | DB |
| 🔵 | L7 | No Content-Security-Policy; `vercel.json` headers may not apply under Nitro's Build Output API «NOT VERIFIED» | Infra |
| 🔵 | L8 | FileProvider `external-path path="."` exposes all external-storage paths (provider not exported) | Mobile |
| 🔵 | L9 | `tsc` fails on `main` (3 errors); lint 3,982 errors; dual lockfiles (`bun.lock` + `package-lock.json`) | Code quality |
| ⚪ | I1 | Public publishable + Google Maps browser keys were in `.env` git history (`849d947`,`8ee7f6f`,`db6d12e`) — public by design; confirm the Maps key is referrer-restricted «NOT VERIFIED» | Secrets |
| ⚪ | I2 | `google-services.json` committed (Firebase `con-z-87e24`) — normal; restrict the key to the app SHA-1 | Secrets |
| ⚪ | I3 | Lovable MCP `/mcp` is extra surface; tools use the caller JWT + RLS (acceptable) | Backend |
| ⚪ | I4 | Paynow `resultUrl` = `https://conz.co.zw` which redirects to `www.` per `capacitor.config.ts`; POST across a redirect is often dropped «NOT VERIFIED — outbound to the site was blocked from the audit sandbox» | Payments |

---

## 5. HIGH findings — detail

**H1 — Fake jobs & rating manipulation via `jobs` INSERT.** No INSERT guard on `status/driver_id/final_price/commission/completed_at/accepted_bid_id/delivery_pin/held_commission` [LIVE: `jobs_guard_direct_write` is BEFORE UPDATE; only CHECK is `payment_method`]. The `ratings` policy verifies the job is completed and owned by the rater but never that `ratings.driver_id = jobs.driver_id` [LIVE]. A customer can insert already-`completed` jobs assigned to any driver and leave 1★ ratings, or inflate their own. *Fix:* BEFORE INSERT guard forcing safe defaults; add `ratings.driver_id = j.driver_id` (and the `customer_ratings` equivalent) to the policies. *Verify:* T-SEC-05/06.

**H2 — Self-lifted sanctions.** No guard trigger on `profiles` [LIVE]; `admin_set_user_status` only sets `profiles.status`, it does not ban the auth user [LIVE]; the bids INSERT policy does not check profile status. A suspended/restricted user can set `status='active'`, clear `restricted_until`/`cancellation_strikes`, and edit `customer_rating_avg`, `deleted_at`, `referral_code`, `phone`. *Fix:* `profiles` guard trigger allowing clients only `full_name, phone, avatar_url, onboarding_completed_at, spotlights_seen, terms_accepted_at, last_active_at`; ban via the Auth admin API from a server fn; add `status='active'` to the accept paths. *Verify:* T-SEC-07.

**H3 — Withdrawal controls bypassable.** `request_withdrawal` enforces PIN, lockout, `limited`, available balance (`balance - held`) and one-pending-at-a-time [LIVE], but policy `wd_owner_insert` lets a client INSERT a request directly, skipping all of it. `set_withdrawal_pin` overwrites the hash with no old PIN and resets `pin_attempts` [LIVE]. `admin_approve_withdrawal` checks only `balance - amount >= 0` (ignores `held`/`limited`) and has no self-target check [LIVE]. *Fix:* drop `wd_owner_insert` (and `topup_owner_insert`; `request_topup` exists); require current PIN/OTP to change an existing PIN and do not reset lockout there; in approval check `balance - held >= amount`, `NOT limited`, `user_id <> auth.uid()`. *Verify:* T-SEC-08/09.

**H4 — Admin money creation / self-dealing.** `admin_credit_wallet` is gated only by `admin OR super_admin`, takes any amount, optional reason, allows self-target, and bypasses the $500 non-super threshold that `admin_wallet_adjust` enforces [LIVE]. `admin_approve_topup/withdrawal` and `admin_set_driver_verification` have no self-target check; `require_admin_mfa()` is a no-op [LIVE]. A single compromised admin password can mint and withdraw funds. *Fix:* route `admin_credit_wallet` through `admin_wallet_adjust` (or revoke it); add `user_id <> auth.uid()` to admin money/verification RPCs; require super_admin / second approver above a threshold; re-enable MFA for super_admin; add a daily per-admin credit cap. *Verify:* T-ADM-01..03.

**H5 — Escrow integrity.** `jobs_guard_direct_write` omits `payment_method` (also `pricing_breakdown/quote_id/supply_location_id/preferred_driver_id/expires_at` for customers) [LIVE], so a customer can flip `payment_method` to `direct` after paying escrow — disabling the PIN path and the 72h auto-release (both require `escrow`) and setting up a refund dispute on funds already held. Escrow can also be initiated while the job is still `open` at the low `budget` [CODE `paynow.functions.ts:113`], and `release_escrow_and_complete` pays `payment.amount − commission` rather than reconciling against `final_price` [LIVE]; `cancel_job` never touches a paid escrow [LIVE]. *Fix:* protect `payment_method` once `status<>'open'`/any escrow payment exists; only allow escrow when `status IN ('accepted','in_progress')` and amount = `final_price`; reconcile at release; mark paid escrow `refund_due` on cancel.

**H6 — Paynow regression & replay.** [CODE `paynow-ipn.ts:64`] the failure branch updates status with no `.eq("status","initiated")` guard, so a later `Cancelled/Failed` IPN can flip an already-`paid` payment to `failed`. `credit_wallet_from_payment` is idempotent only on `status='paid'` [LIVE]; users can read their own `paynow_poll_url` [LIVE policy `payments_owner_select`], and a captured signed `Paid` poll body could re-credit after a reset. Refunds/chargebacks are never debited. *Fix:* guard every status transition on the prior status; treat `released` as terminal; reconcile refunds; compare IPN amount to the stored amount (L1).

**H7 — Referral farming.** `process_referral_lifecycle` auto-moves rewards to `hold`/`released` based on `driver_profiles.verification_status`/`jobs_completed` — both forgeable via C2 — and `record_referral` trusts client-supplied `device_fingerprint` as a fraud signal [LIVE]. With C2, one person can self-verify sock-puppet "drivers" and collect `driver_referrer_amount` ($15) each. *Fix:* depends on C2; also bind fraud checks to server-side signals (IP, auth metadata) and hold driver rewards behind admin review.

**H8 — Native OAuth token interception.** Native Google sign-in uses `redirectTo: "com.conz.app://oauth-callback"` with `skipBrowserRedirect` [CODE `auth.tsx:258`], and the bridge forwards whatever follows the scheme into the web callback [CODE `capacitor-oauth-bridge.ts:51`]. Custom-scheme redirects are claimable by any installed app, so tokens/authorization codes in the redirect can be intercepted. *Fix:* use Android App Links (verified `https://` deep link via `assetlinks.json` — the unmerged `web-app-routing-audit` branch adds this) or the system `CustomTabs` + PKCE, not a custom scheme carrying tokens.

**H9 — SMS hook fail-open.** `send-sms` verifies the Supabase webhook signature only when `SEND_SMS_HOOK_SECRET` is set [CODE]; `verify_jwt:false` [LIVE]. If the secret is unset, anyone can drive Africa's Talking SMS (cost / phishing). «NOT VERIFIED whether the secret is configured.» *Fix:* require the secret (fail closed); confirm it is set in Edge secrets.

**H10 — Dispute spoofing.** `raise_dispute` enforces "party to the job", category, and one-open-per-job [LIVE], but `disputes` INSERT policy `Users raise disputes` only checks `raised_by = auth.uid()` [LIVE], so a client can insert disputes on arbitrary jobs against arbitrary users. An open/investigating dispute blocks escrow auto-release (`auto_release_escrow_payments` excludes disputed jobs [LIVE]) and notifies all admins. *Fix:* remove client INSERT on `disputes`; require `raise_dispute`.

**H11 — Hard-coded super-admin bootstrap.** `activateAccount` grants `super_admin`/`admin` to a hard-coded e-mail [CODE `account.functions.ts:52`]; on `main` there is no `email_verified` check (added only on the unmerged branch). Lower risk than it looks (the address must own a confirmed account), but it is privileged logic keyed off a mutable claim. *Fix:* require `email_verified`; prefer a one-time `claim_super_admin` bootstrap over an e-mail constant.

---

## 6. Database security report

- **RLS:** enabled on all 51 tables [LIVE]. `anon`/`authenticated` hold broad table grants, so **policies are the only barrier** — any policy gap is directly exploitable (C1–C3, H1–H3, H10).
- **Guard-trigger pattern:** `jobs`, `bids`, `driver_profiles` have BEFORE **UPDATE** guards but allow client INSERT/DELETE and omit some columns → C2, C3, H1, H5. Recommend: for every table a client can write, pair each guard with a BEFORE INSERT guard (and remove DELETE where not needed).
- **SECURITY DEFINER functions:** ~95; most are `EXECUTE`-able by `anon` [LIVE]. The money/admin ones re-check `auth.uid()`/`has_role` internally (good), but the blanket anon grant is the reason C4-style and L6 issues exist — prefer `REVOKE … FROM PUBLIC, anon` and grant explicitly. `search_path` is pinned on essentially all of them (good).
- **Views:** `driver_public_profiles`, `market_rate_history` lack `security_invoker` and are anon-readable (M2) — Supabase advisor flags `security_definer_view` as ERROR. Add `WITH (security_invoker=true)` and restrict grants.
- **Immutability:** `wallet_transactions`, `job_evidence`, `mfa_recovery_log`, referrals-core are protected by triggers (good).
- **Advisors [LIVE]:** 1 ERROR (security-definer view), WARN: extension in public, leaked-password protection disabled, definer-function-executable (anon/auth).

## 7. API security report

| Endpoint / fn | Auth | AuthZ | Validation | Rate limit | Risk |
|---|---|---|---|---|---|
| `/api/public/paynow-ipn` | hash-verified | n/a | partial (amount not checked) | none | H6, L1 |
| `initiatePaynowTopup` / `initiateEscrowPayment` | JWT | owns job (escrow) | zod amount | none | H5 |
| `reconcilePendingPaynowPayments` | JWT | own rows | — | none | ok |
| `computeOffer` / `computePublicOffer` | JWT / **none** | — | zod | none | M1, M7 |
| `getRoute`, `searchAddressServer`, `reverseGeocodeServer`, `getPublicPod` | **none** | token (POD) | zod | none | M7 |
| `activateAccount` | JWT | self | — | none | H11 |
| `deleteMyAccount` | JWT | self | — | none | M10 |
| `/mcp`, `/.mcp/*` | OAuth (Supabase issuer) | RLS via caller JWT | per tool | none | I3 |
| `send-push` (Edge) | **none** | **none** | minimal | none | **C4** |
| `send-sms` (Edge) | webhook sig (optional) | n/a | basic | none | H9 |
| ~95 RPCs via PostgREST | anon/JWT | per-fn `has_role`/uid | per-fn | none | varies |

Not found: SQL/command injection (parameterised throughout, `search_path` pinned), SSRF in app code beyond fixed OSRM/geocode hosts, path traversal, server-side `dangerouslySetInnerHTML` with user data (the one use is a static theme script [CODE `__root.tsx:139`]).

## 8. Payment / wallet report

Strengths: ledger immutable; `FOR UPDATE` locking; IPN hash-verified and idempotent on the happy path; escrow auto-release excludes disputes; one-pending withdrawal rule; PIN lockout in the RPC path. Gaps: C1 (PIN), H3 (withdrawal bypass), H4 (admin minting), H5 (escrow method flip / amount), H6 (regression/replay/refunds), L1 (amount/const-time), L4 (`held` checks). No evidence of a reconciliation/export process against Paynow settlement. Treat escrow as **not production-safe** until C1 + H5 are fixed.

## 9. Frontend report

TanStack Start SSR; auth via Supabase JS with the publishable key + user JWT; server functions attach the bearer token via middleware [CODE `start.ts`, `auth-attacher.ts`]. No service-role key or secret in the client bundle [RUN]. Admin routes gate in `beforeLoad` by role (defence-in-depth only — real enforcement is RLS/RPC). Issues: M11 open redirect; L2 raw error text; M15 backups; `localStorage` session storage (standard for Supabase web). UX/readiness is otherwise solid; the gaps are server-side.

## 10. Admin report

Password + role only (MFA removed, `require_admin_mfa` no-op) [LIVE]. Two-tier admin/super_admin is used for revenue, role grants, commission, wallet reversal, material prices. Audit logging via `log_admin_action` is wired into admin RPCs, but the function is anon-executable (M6, forgeable entries) and `admin_credit_wallet` self-dealing (H4) is the main abuse path. Recommend: re-enable MFA for super_admin, self-target bans, second-approver for large money ops, lock down `log_admin_action`.

## 11. GPS / location report

Driver location is client-supplied (`driver_locations` upsert) and read by the job's customer via policy; the public tracking page uses an unguessable token RPC (good). Issues: no coordinate plausibility/range checks (M14, M1 — pricing also trusts client pickup coords); `driver_availability` positions are not pruned though the privacy page claims 24h retention (M14); customer can read live location until the 24h prune even after the job ends. Permissions requested are appropriate (fine/coarse location, camera, notifications); no background-location permission (good for Play review).

## 12. Test plan (run on a STAGING copy, not production)

Each test = seed → action as a specific role → expected (post-fix) result. Run as the table owner using `SET LOCAL ROLE authenticated` + `request.jwt.claims` to simulate a user, inside a transaction you `ROLLBACK`.

| Test | Setup | Action (as attacker role) | Expected after fix | Status now |
|---|---|---|---|---|
| T-SEC-01 | escrow job, driver = A | A selects `jobs.delivery_pin`; A calls `driver_confirm_delivery_pin` without customer | PIN not selectable; confirm needs customer-held code; ≤5 attempts | **FAIL** (readable) |
| T-SEC-02 | user B (no KYC) | B deletes + re-inserts `driver_profiles` as verified/platinum | INSERT/DELETE denied; stays pending | **FAIL** |
| T-SEC-03 | open job J, driver A | A inserts bid with `counter_status='countered'`; A calls `accept_counter` | INSERT forces `none`; accept rejected | **FAIL** |
| T-SEC-04 | any user id U | POST `send-push` `{user_id:U,…}` with no auth | 401/403 | **FAIL** |
| T-SEC-05 | customer C | C inserts a `completed` job assigned to driver D | INSERT forces `open`, null driver | **FAIL** |
| T-SEC-06 | completed job for driver D | customer C inserts rating with `driver_id = X≠D` | denied | **FAIL** |
| T-SEC-07 | suspended user S | S updates `profiles.status='active'` | denied | **FAIL** |
| T-SEC-08 | user with PIN | insert `wallet_withdrawal_requests` directly (no PIN) | denied (no client INSERT) | **FAIL** |
| T-SEC-09 | user with PIN set | call `set_withdrawal_pin` without old PIN | requires current PIN/OTP | **FAIL** |
| T-ADM-01 | admin A1 | `admin_credit_wallet(A1, 10000)` | denied / capped / reason+second approver | **FAIL** |
| T-ADM-02 | admin A1 | A1 approves own top-up/withdrawal | denied (self-target) | **FAIL** |
| T-SEC-10 | job J not involving U | U inserts a `disputes` row for J | denied (use `raise_dispute`) | **FAIL** |
| T-PAY-01 | paid top-up P | POST failure IPN for P | status stays `paid` | **FAIL** |
| T-FN-01 | — | `tsc --noEmit`, `npm run build` | both pass | build **PASS**, tsc **FAIL** (3) [RUN] |

Happy-path regression after fixes: signup→verify→post job→bid→accept→evidence→start→complete (direct & escrow)→commission; top-up via IPN; withdrawal request→approve. Failure paths: expired session, insufficient balance, OSRM down (haversine fallback), bad coordinates, duplicate IPN.

## 13. Priority fix plan

**P0 — before any further real use (blockers):** C1, C2, C3, C4. Plus the two that are live-exploitable and money/safety-critical: H3, H4. (~2–4 eng days; all small SQL migrations + one Edge secret.)

**P1 — before production launch:** H1, H2, H5, H6, H7, H8, H10, H11, H9 (confirm secret), M1, M2, M9, M10, M12. Re-enable super_admin MFA.

**P2 — before/just after launch:** M3, M4, M5, M6, M7, M11, M13, M14, M15, L1, L2, L5, L7. Rate limiting; dedicated OSRM/routing; CSP; dependency updates (M8).

**P3 — hardening/future:** L3, L4, L6, L8, L9, I1–I4; single lockfile; fix `tsc`/lint; reconciliation/export job; observability (below).

Process: re-commit the migration drift (M12) and adopt the CLAUDE.md "no live migration without its `.sql` committed in the same sitting" rule — drift has now recurred three times.

## 14. Launch checklist

- [ ] **Code:** `tsc` clean; lint clean; single package manager/lockfile
- [ ] **DB:** INSERT/DELETE guards on `jobs`/`bids`/`driver_profiles`/`profiles`/`disputes`; definer views → `security_invoker`; narrow anon EXECUTE; `held>=0` check
- [ ] **AuthZ:** C1–C3, H1–H3, H10 closed; admin self-target blocked (H4)
- [ ] **Payments/Wallet:** escrow method/amount locked (H5); IPN status-guarded + amount-checked (H6/L1); withdrawal path server-only (H3); refund path; reconciliation job
- [ ] **Admin:** super_admin MFA; `admin_credit_wallet` locked; `log_admin_action` locked; audit coverage
- [ ] **GPS:** coordinate validation; `driver_availability` pruning matches policy
- [ ] **Push/SMS:** `send-push` authenticated (C4); `send-sms` secret enforced (H9)
- [ ] **Infra:** CSP; confirm security headers apply under Nitro (L7); remove demo Edge fns (L5)
- [ ] **Secrets:** confirm Maps/FCM keys restricted; Paynow key logging removed (M9)
- [ ] **Privacy/Legal:** account deletion complete + consistent with privacy page (M10); Data Safety form honest (location/camera/financial/ID)
- [ ] **Mobile/Play:** App Links instead of custom-scheme OAuth (H8); `allowBackup=false` (M15); `versionCode` strategy; release signing/keystore backed up
- [ ] **Marketing:** see §16

## 15. Play Store report

- **IDs/signing:** `applicationId com.conz.app`, `versionCode 1`, `versionName 1.0`; `minSdk 24`, `target/compileSdk 36` (meets current Play target-API rules) [CODE `android/app/build.gradle`]. Release build is **unsigned in-repo** and built via Android Studio (BUILD_ANDROID.md) — keystore must be created and backed up.
- **Debug/logging:** `minifyEnabled false`; no R8/Proguard shrinking; app logic is remote (WebView), so native logging is minimal.
- **Permissions:** INTERNET, CAMERA, FINE/COARSE_LOCATION, POST_NOTIFICATIONS — all justified; **no background location** (good — avoids the hardest Play review). Data Safety must declare location, photos/camera, financial info (Paynow) and ID documents (driver KYC).
- **Policy must-haves:** account deletion exists in-app but is incomplete/inconsistent (M10) — Play requires a working deletion path and (for store listing) a web deletion URL; privacy policy at `/privacy` and terms at `/terms` exist.
- **Architecture risk:** the app is a thin WebView over `https://www.conz.co.zw`. Google sometimes rejects "webview-only" wrappers with little native value; the camera/location/push native integration helps but is a review risk. Custom-scheme OAuth (H8) should move to App Links before submission.
- **Verdict:** **not ready to submit** — resolve H8, M10, M15, Data Safety accuracy, signing, and the P0 security items first (a Play rejection or, worse, a live incident post-launch).
- «NOT VERIFIED: live HTTPS/redirect/header behaviour — outbound requests to conz.co.zw / vercel.app were blocked (403) from the audit sandbox.»

## 16. Marketing-readiness

Honest position: the product is feature-rich and the UX is close, but it is **pre-security-fix**. Do not run paid acquisition or press until P0+P1 are closed and escrow has been exercised end-to-end on staging — a payment or KYC incident at launch is far costlier than a short delay. Pre-launch assets that are safe to prepare now: store listing copy, screenshots, the `/privacy` + `/terms` links, a deletion-request web page, and a small closed beta (trusted drivers/customers) to validate the happy paths under the fixes.

## 17. Observability (minimum for launch)

Currently: `console.*` to Vercel logs, Lovable error reporting hook, DB audit log. Add before launch: error tracking (Sentry or similar) on client + server; Paynow payment/webhook monitoring + daily reconciliation vs settlement; alerts on failed escrow releases and on `wallet_audit_log`/`admin_audit_log` anomalies (large or self-directed admin credits); uptime monitoring on the site and the IPN endpoint; DB slow-query/advisor review on a schedule.

---

## RELEASE GATE

**CAN WE SAFELY LAUNCH CON Z RIGHT NOW? — NO.**

Blockers: **C1** (driver self-releases escrow), **C2** (KYC bypass), **C3** (job/price hijack), **C4** (unauthenticated push spoofing), plus live-exploitable **H3** (withdrawal bypass) and **H4** (admin self-minting). These are money- and safety-critical and exploitable from outside the UI. They are fixable in roughly 2–4 engineering days of mostly small SQL migrations plus one Edge-function secret. Re-run the §12 tests on staging; when C1–C4, H1–H5, H10 pass and escrow has been exercised end-to-end, Con Z is ready for **staging / closed beta**, and for production once the P1 set and Play items (§13–15) are also closed.
