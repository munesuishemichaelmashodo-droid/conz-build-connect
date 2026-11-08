# ConZ marketplace upgrade: baseline audit, decisions and plan (8 November 2026)

Branch `marketplace/upgrade-audit` (from `origin/main` `1736eb0`). Working tree was clean; nothing uncommitted existed.
Evidence classes: **LIVE** = read-only query against production (`ovwrsocjmkpiygipmrdk`, matches `supabase/config.toml`), **GIT** = read in the repo / built into the local test database, **TESTED** = run on the local database or in a browser today, **UNVERIFIED**.
No secrets were read or printed. No production data or settings were changed.

## 0. Baselines established today

| Check | Result | Class |
| --- | --- | --- |
| Local pgTAP suite on current `main` | 82 files, 1,710 tests, PASS | TESTED |
| Live migration history | recorded through `0151` (`20261107180000`) | LIVE |
| Live vs git function bodies (whitespace-stripped md5) | identical for `accept_bid`, `accept_dispatch_offer`, `cancel_job`, `commission_amount`, `complete_job`, `credit_wallet_from_payment`, `driver_confirm_delivery_pin`, `expire_stale_accepted_jobs`, `release_escrow_and_complete`. **Different:** `hold_job_commission`, `release_job_commission`, `settle_direct_pay_job`, `driver_can_accept_for` (git has the promo-credit changes of `0134`, which is not applied live and whose settings do not exist live), and `compute_material_offer` (comments only, known) | LIVE + TESTED |
| Live switches | `escrow_enabled=false`, `withdrawals_enabled=false`, `commission_rate=7`, `max_job_budget=500`; no `promo_credit_*` settings | LIVE |

## 1. Business model gaps found (the brief vs the repository)

1. **The agreed price includes materials, and the 7% commission is charged on it.** `compute_material_offer` returns `offer = materialCost + transportCost` (GIT, `0127`); `jobs.budget`, `bids.price` and `jobs.final_price` are all-in; `hold_job_commission` charges `commission_amount(coalesce(final_price, budget), rate)` = `round(price x rate / 100, 2)` (GIT; same live except promo). Terms (`terms.tsx` section 7), the wallet screen, the walkthrough, the driver offer form and the home page all say "7% of the full job price, materials and transport included", and `tests/unit/value-copy.test.ts` asserts that wording. The brief requires transport fare only.
2. **Pricing requires a ConZ-listed supplier as the pickup.** The client sends only a delivery pin; the pickup is the resolved supplier location (`resolve_material_source_candidates`, `create_price_quote_for`), and the budget trigger overwrites the job's pickup with that location. A client cannot give the real loading point. Jobs with no listed supplier become "open requests" priced at fixed 10/40/120 km hauls with material 'custom', which skips budget validation entirely.
3. **Silent defaults remain:** 15 km when the trigger has no distance, a 40 km/h ETA in `booking.functions.ts` and `routing.functions.ts`, and a Harare default map centre.
4. **Dispatch assigns a driver without the customer.** `accept_dispatch_offer` sets `driver_id`, status `accepted`, reserves the commission and rejects pending offers in one step (GIT = LIVE hash). More than a dozen screens promise the customer chooses.
5. **No structured agreement** (fare, payment method, timing, deposit, inclusions, versions, both-party acceptance). Only `final_price`, `payment_method` (direct/escrow) and the optional deposit stored on the bid (`0135`) exist. Chat opens only after a driver is assigned.
6. **Thin driver and truck facts:** the `trucks` table (LIVE) has only `registration`, `capacity_m3`, `photo_url`; the offer card shows capacity and trips but no body type, make, model, colour or plate; `trucks.photo_url` is never written by the app.
7. **Privacy leak (verified).** See finding F1.
8. **Supplier-as-service copy and legacy:** about a dozen strings in the active journey imply ConZ finds or sells from a supplier (class 3 below). No supplier account, role, wallet, payout or commission split exists anywhere (class 1: none found).

### F1. A customer can read a bidding driver's phone and email, and the full truck row, before choosing (verified, LIVE policy + TESTED)

- LIVE policy "Customers view bidders on own jobs" on `profiles`: any customer whose job has a bid from that driver can `select` the whole profile row. `phone` and `email` have column-level `SELECT` for `authenticated`.
- LIVE policy "Customers read trucks offered on their jobs" on `trucks`: the whole row, including `registration` and `photo_url`, for any truck that bid.
- TESTED on the local database as a customer with only a pending offer: the bidder's phone number, email and truck registration were all returned.
- The app only asks for name, avatar and last-active time, so nothing shows this today. The exposure is to anyone using the API with a customer session. It also lets a customer collect drivers' numbers and deal off the platform, bypassing the commission.
- Fix (planned, slice 2): a purpose-built function returning only safe fields with a masked plate before selection, and tighter policies (the assigned driver only; the accepted truck only).

## 2. Baseline matrix

Classes: KEEP, FIX, ADD, SIMPLIFY, DO NOT BUILD. "Tests" lists what must exist when the change ships.

| # | Journey step / feature | What exists (reference) | Preserve | Defect, gap or friction | Minimum change | Security / data / performance | Tests | Class |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Public price check | `QuickPrice.tsx`, `computePublicOffer`, `quick-price.ts`; one engine `compute_material_offer` (v1.4); road distance via OSRM, straight-line refused (`assertRoadDistance`) | One engine; refusal of straight-line fallback; map loads on first use | Shows "Material"/"Transport" rows and a listed supplier's name to anonymous visitors; pickup is never the client's point | Client chooses pickup and delivery; estimate is transport only, behind a switch (default off) | Public endpoint is rate-limited and Zimbabwe-bounded (keep) | quick-price unit tests updated; pgTAP for the new function | FIX |
| 2 | Booking form | `customer.book.tsx` (delivery pin only; pickup label from supplier) | Single wizard; load picker | No pickup input; "You don't choose a supplier" copy | Add a pickup picker using the existing address picker (switch-gated); drop supplier-as-service wording | Existing validation ranges (Zimbabwe box) | unit + browser at 360/390 | FIX |
| 3 | Supplier resolution | `resolve_material_source_candidates`, `material_supply_locations`, `create_price_quote_for` | Historical location data and admin screens (`admin.sourcing`, `admin.supply-coverage`) | Treats a listed location as the origin even when the client has a real one | When the switch is on, the client's pickup wins; locations remain only as optional suggestions | No schema deletion | pgTAP | SIMPLIFY (do not delete) |
| 4 | Open request (driver arranges pickup) | `buildOpenRequestOffer` fixed 10/40/120 km, material 'custom'; trigger skips pricing | Existing flow stays for old jobs | No guidance and no budget validation for these jobs | Covered by item 1 (real pickup removes the need) | | | FIX (with 1) |
| 5 | Pricing engine | `compute_material_offer` v1.4 (flat bands to 50 km, then fuel-based), live hash `0bf44570...` | Bands, diesel/fuel settings, admin setters, calibration report (`admin_price_accuracy_completed`) | Includes material; reference truck 20 m3 only; $500 cap blocks long hauls (a 445 km guide is $502.57) | New `compute_transport_offer` (see CONZ-NATIONWIDE-PRICING.md), not a replacement; old engine untouched | Pure function, no data access beyond settings | pgTAP golden values | ADD |
| 6 | Budget validation and launch cap | `tg_validate_job_budget`, `max_job_budget` 500 (bids on INSERT only) | Trigger as single source of truth | Cap in all-in terms; not surfaced in the UI | Branch on `jobs.pricing_basis`; owner decision on the cap | | pgTAP | FIX (gated) |
| 7 | Driver offer | `BidForm` in `jobs.$id.tsx`; counter-offer; raise-price; deposit fields (0135) | Offer expiry, withdraw, deposit acknowledgement | Price hints and commission wording include material | Relabel as transport fare when switch on | | unit | FIX (gated) |
| 8 | Offer comparison | `OfferCard`, `offer-compare.ts`, best-match | Compact card, honest rating rule (3+ ratings), "Active just now" | No body type/make/model/colour, no plate (masked), no "fits your load" line | Add a truck line and a fit line from verified data; "Not provided" when absent | Only privacy-safe fields; no new image loading | unit + browser | ADD |
| 9 | Driver profile and trucks | `AddTruckForm` (registration + m3 only); `driver_public_profiles`; documents in a private bucket | Private document area; re-review trigger | No body type/make/model/colour fields | Minimal nullable columns + form fields; re-review when a set body type changes | Self-declared fields labelled as such | pgTAP + unit | ADD |
| 10 | Bidder privacy (F1) | Policies above | Name/photo/rating via `driver_public_profiles` | Phone, email and full truck row readable pre-selection | `offer_bidder_cards` function + tightened policies | Security fix | pgTAP leak tests | FIX (priority) |
| 11 | Accept an offer | `accept_bid` (row locks, expiry, balance check, reserve) | All of it | none found | None | | existing tests | KEEP |
| 12 | Dispatch assignment | `accept_dispatch_offer` assigns immediately | Eligibility checks, 60 s windows, notification content | Customer never confirms; copy contradicts | Dispatch acceptance becomes an offer at the customer's budget through the existing `accept_bid` path | Reserve moves to the tested accept path | pgTAP | FIX |
| 13 | Agreement | None structured | Existing chat and deposit acknowledgement | No fare/method/timing/inclusions record, no versions | `job_agreements` with versions, both-party accept, history, via RPCs | RLS: participants and admins only | pgTAP + unit + browser | ADD |
| 14 | Delivery, evidence, PIN, tracking, offline | Existing | All of it | none in scope | None | | existing | KEEP |
| 15 | Commission reserve, release, settle, top-up | `hold/release_job_commission`, `settle_direct_pay_job`, Paynow callback | All of it (see section 4) | Base includes material; wording says so | Gated change of what the agreed price represents (not the functions); wording after the switch | Financial invariants audited in section 4 | pgTAP regression | KEEP code, FIX meaning |
| 16 | Admin calibration report | `admin_price_accuracy_completed` (10 jobs / 3 drivers rule) | Whole report | Not split by vehicle class or distance band | Document thresholds; extend after the switch has data | No private data | pgTAP | KEEP |
| 17 | Supplier legacy | Tables, admin screens, sourcing requests (switch `sourcing_requests_enabled` off) | All data | Copy implies ConZ is a seller/sourcer | Reword active-journey strings | No deletion | unit copy tests | SIMPLIFY |
| 18 | Offer/assignment copy | About 20 strings promise choice | n/a | True only once item 12 ships | Fix item 12 first, then keep copy | | copy tests | FIX (via 12) |
| 19 | Routing profile | Public OSRM demo (car profile, non-commercial terms) | Server-side call, refusal of fallback | Not a heavy-vehicle profile; demo server is not for commercial use | Estimates marked provisional; driver confirms suitability; owner decision on a licensed router | | | FIX (flag) |
| 20 | Truck photos | `trucks.photo_url` unused | n/a | No upload, no verification flow | **Do not build now**: no authentic photos exist | | | DO NOT BUILD |

## 3. Decisions made (and why)

1. **Transport fare = the agreed price; materials sit outside ConZ.** Under the new basis the number drivers and clients agree on in ConZ is the transport fare only. A driver who also supplies material agrees and records that separately in the agreement card ("material paid to the driver separately: $X, no ConZ commission"). Commission stays `round(agreed fare x 7%, 2)` on `final_price`, so no money function changes and nothing can be gamed by declaring part of the price as material. Existing jobs are unaffected (they keep the old basis). Alternative rejected: letting the driver declare a material share inside the price (it would let drivers shrink the commission base).
2. **Everything pricing-related ships behind one switch, default off** (`system_settings.transport_pricing_enabled`, `jobs.pricing_basis`). Deploying code and applying additive migrations changes nothing customers or drivers see until the owner flips it. Flipping it changes the commission base for new jobs and the wording in the Terms, so it needs the owner's explicit go.
3. **Dispatch acceptance becomes an offer**, not an assignment, so the customer always chooses.
4. **No supplier or escrow work**; no schema deletion; no customer wallet; no payout.
5. **Privacy first**: the leak in F1 is fixed before any new feature exposes more data.

## 4. Commission and money-flow invariants

Source: independent read-only audit of the checked-in code and tests (no database calls). Live grants, live bodies of some functions and real Paynow delivery are UNVERIFIED by that audit; where my own live checks cover a point it is noted in section 0.

| # | Invariant | Verdict | Key evidence |
| --- | --- | --- | --- |
| 1 | Commission is 7% of the agreed transport fare, computed on the server, one rounding rule | **FAIL against the new brief** (calculation itself is server-side and single-sourced) | `commission_amount` is the one SQL rule. The base is `coalesce(final_price, budget)`, the whole price including material. Rounding is repeated in the driver feed (`_driver_available_jobs_exact`) and in `src/lib/driver-economics.ts` (identical at 7%, would diverge at a fractional rate) |
| 2 | First job free, once, not gameable | PASS (multi-account gaming UNVERIFIED) | Flag set under a profile row lock at settlement, guarded against client writes; no unique constraint on national ID or phone, so KYC is the only control |
| 3 | Only verified drivers with enough credit can accept | PASS | `tg_jobs_driver_must_be_verified` covers all accept paths; credit check in `driver_can_accept_for`; truck rule is checked at dispatch and stamped at bid time, not re-checked at accept |
| 4 | Reserve on accept is atomic and exclusive | PASS (two Low defects) | One transaction, advisory lock per driver; lock order differs between `accept_bid` and `accept_dispatch_offer` (possible deadlock, no double assignment) |
| 5 | Clients cannot write money columns | **FAIL in git only** (not live) | `jobs.held_commission_promo` (migration 0134, not applied) is missing from the write guard |
| 6 | Completion needs proof and settles once | PASS | PIN plus delivery evidence by the job's driver; settlement idempotent. The old note "complete_job has no PIN/evidence" is stale |
| 7 | Release happens at most once | PASS (Medium note: wallet `held` is clamped, which would hide drift) | Release returns 0 once `held_commission` is null; callers hold the job lock |
| 8 | Reopen/cancel releases and the next accept reserves fresh | PASS | Covered by tests 790 and 820 |
| 9 | Top-ups are authentic, bound, idempotent | PASS (live keys UNVERIFIED) | Constant-time SHA-512 check, amount/reference binding, state machine, idempotent credit, parallel-IPN concurrency test |
| 10 | Append-only audit trail for money movement | **FAIL (partial)** | Wallet transactions, platform ledger and payment events are append-only, but reserve and release write no ledger row (the reserve exists only as `wallets.held` and `jobs.held_commission`) |
| 11 | Driver sees a clear shortfall and top-up path | PARTIAL | Message exists on the offer form and quick accept, but the top-up link does not prefill the shortfall; nothing shown during the free job |
| 12 | Escrow and fare collection unreachable for direct jobs | PASS | Escrow refused on insert while the switch is off; payment initiation fails closed; escrow release raises for non-escrow jobs |

### Findings to fix (severity, status)

| ID | Finding | Live? | Planned action |
| --- | --- | --- | --- |
| H1 | `jobs.held_commission_promo` writable by the job's driver or customer (would mint commission credit if `0134` were applied) | No (0134 not live) | **Block applying `0134` until fixed.** Add the column to the write guard plus a check constraint, and a pgTAP assertion. Recorded in the release notes |
| H2 | Commission base includes materials | Yes | Slice 5 (gated pricing basis; commission functions unchanged) |
| M1 | Any admin can write money columns on `jobs` directly (no step-up, no audit, no settlement) | Yes | Close the admin write path (policy `USING (false)` or guard) after confirming the app never writes them (the audit found it does not). Own slice, own pgTAP |
| M2 | Live settlement recomputes commission at completion, so a rate or price change after the reserve can drive the credit negative (fixed by `0113`, not live) | Yes | Owner decision to apply `0113` (pgTAP 440 covers it). Not changed here |
| M3 | A dispute refund on a direct-pay job credits the customer's wallet (contradicts "no customer wallet"; refunds the commission to the wrong party) | Yes | Documented for the owner; fix with the money-function owner decision, not silently |
| M4 | Promo reserve skips the ledger so the reconciliation check would diverge (0134, not live) | No | Fix before ever applying `0134` |
| M5 | Referral rewards credit withdrawable balance without a provider payment; multi-account abuse gated only by a fraud flag | Unverified | Documented; verify `tx_type` and live behaviour read-only |
| L1-L5 | Lock order, `accept_counter` missing expiry/own-offer checks, write grants on `payments`, JS rounding to basis points, stale note | Yes | Low; L1/L3 batched with a later hardening migration, L5 corrected in CLAUDE.md |

Decision on money functions: the owner's earlier boundary on payment work still stands for **behaviour changes to reserve, release and settlement**. This programme therefore only (a) adds the new pricing basis without altering the commission functions, (b) fixes guard gaps that are additive and tested (H1 before `0134` can ever be applied, M1), and (c) lists M2, M3 and M5 for an explicit owner decision.

## 5. Implementation plan (smallest complete set, in order)

| Slice | Content | Migration | Production effect |
| --- | --- | --- | --- |
| 1 | This audit, competitor research, legal risk note, nationwide pricing design | none | none |
| 2 | Bidder privacy and truck facts: `offer_bidder_cards`, truck columns, form fields, offer-card truck line; then tighten the two policies after the app is deployed | `0152` (additive), `0153` (policies) | closes F1 |
| 3 | Dispatch acceptance becomes an offer | `0154` | customer choice is honest |
| 4 | Agreement card with versions | `0155` | new feature, no effect until used |
| 5 | Transport-only nationwide pricing and client pickup, behind the switch | `0156` | none until the switch is flipped |
| 6 | Copy and Terms after the switch; final security review; verification report | none | on the owner's go |

Each slice: failing test first, local pgTAP run, unit tests, browser check at 360/390 px light and dark, review branch and pull request. Production application of database changes follows `CLAUDE.md` (file committed first, hash-verified, recorded). Nothing in slices 2 to 5 changes a money function.
