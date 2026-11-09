# ConZ marketplace upgrade: verification report and owner summary (9 November 2026)

## Owner summary (the 8 questions in the brief)

1. **What was already good and kept?** Offer acceptance (`accept_bid`: row locks, expiry, balance check, one reserve), the commission reserve/release/settle functions and first-job-free rule, PIN plus delivery-photo completion, Paynow top-up authenticity and idempotency, escrow/withdrawal switches off, the road-distance-only quote (no straight-line fallback), the offline card, and the supplier tables and admin screens (not deleted). The independent audit found these PASS (audit doc, section 4).
2. **What was risky or wrong, and is it fixed?**
   - Customers could read a bidding driver's phone, email and full truck row before choosing: **fixed and live** (0152 safe cards, 0153 policy lockdown, 0156 narrower truck policy).
   - A dispatch "yes" assigned a driver the customer never chose: **fixed and live** (0154, 0156). Trade-off: dispatch is slower; undo file exists.
   - Admins (and, in git, drivers/customers via `held_commission_promo`) could write money columns of `jobs` directly: **fixed and live** (0155).
   - Not fixed, owner decision needed: commission still includes materials; live settlement recomputes commission at completion (apply 0113); a dispute refund on a direct job credits the customer's wallet; referral credit is withdrawable; do not apply 0134 before its own findings are fixed.
3. **What was added for clients and drivers?** Safe driver cards (name, photo, last active, truck type/make/model/colour marked "declared by driver", capacity, masked plate until chosen); optional truck fields on the driver form; an agreement card (fare from the job, payment method and timing, deposit paid to the driver, times, inclusions, versions, both sides confirm) (0157, live); a transport-only pricing engine, off (0158, live).
4. **How does pricing work nationwide now?** Live pricing is unchanged (material plus transport from a listed supplier). The nationwide transport-only formula is designed (`CONZ-NATIONWIDE-PRICING.md`) and now built end to end behind a switch that is off: the server measures road distance from the customer's own pickup and delivery point, the database validates the quote and budget, and every value is uncalibrated. Switching it on needs your go plus decisions on the $500 launch cap and a licensed truck-profile router.
5. **How is ConZ paid?** Unchanged: 7% of the accepted price, reserved from the driver's prepaid commission credit when the customer accepts, released once on a legitimate cancel, charged once on verified completion, first job free. The brief wants the base to be the transport fare only; that is designed but NOT live.
6. **What did research say about competitors?** None of the verified competitors (MoveZW, ZimboHaul, eTruckConnect) shows truck make, model, payload, plate or photo publicly; Truck on the Move gates job acceptance behind a prepaid wallet. Movu and Takurirwa could not be verified. Competitor prices are context only.
7. **What are the legal and regulatory questions?** `CONZ-COMMISSION-CREDIT-RISK-NOTE.md`: whether a restricted prepaid commission credit counts as stored value or payment intermediation (NPS Act s18), Paynow's licensed scope, POTRAZ data-controller licence, consumer-protection terms, tax. Primary texts could not be read; this is a question list for a Zimbabwean lawyer, not advice. Wording rules: say "commission credit", never "wallet", "escrow", "we hold".
8. **What do you need to decide?** (a) Turn on transport-only pricing and commission base (changes what drivers pay); (b) the launch cap (`max_job_budget` $500 blocks long hauls); (c) a licensed router with a truck profile instead of the public demo server; (d) the dispute-refund path (a refund on a direct job credits the customer's wallet; 0113 itself is now applied); (e) the lawyer and Paynow questions; (f) plate masking (first 3 characters shown before choosing).

## What was done (branches, commits, migrations)

| Item | PR | Migration | Production |
| --- | --- | --- | --- |
| Audit, pricing design, competitor research, legal note | #85 (merged) | none | n/a |
| Safe bidder cards + truck facts | #82 (merged) | 0152 | live, recorded 20261108100000 |
| Close bidder exposure | #84 (merged) | 0153 | live, 20261108110000 |
| Dispatch answer is an offer | #83 (merged) | 0154 | live, 20261108120000 |
| Jobs money-column guard + review fixes | #86 (merged) | 0155, 0156 | live, 20261109100000 and 20261109110000 |
| Agreement card | #87 (merged) | 0157 | live, recorded 20261109120000 |
| Transport pricing engine (off) | #88 (merged) | 0158 | live, recorded 20261109130000; switch off |
| Transport job pricing path (off): server-made quotes, validating trigger | #94 (merged) | 0159 | live, recorded 20261109140000 (budget trigger prosrc md5 `e1909ee1…` equals the committed text minus comments); switch off |
| Booking form: pickup picker and delivery-only quote behind the switch | this PR | none | with the app deploy; invisible while the switch is off |

Live hash checks (whitespace-stripped md5): `offer_bidder_cards` `a75845e6…` equals the local build; `accept_dispatch_offer` after 0154 `eb2edb77…`, after 0156 `5b04701b…`. The local database could not be compared for 0154/0156 (it was not running after an environment restart); the applied text equals the committed file with comment-only lines removed, which is the established practice. `tg_truck_change_needs_review` differs from the committed file only by one stripped trailing comment.

## Verification evidence

- pgTAP (local Supabase in Docker): baseline on main 82 files / 1,710 tests. New files: 880 (15), 890 (9), 900 (11), 910 (16), 920 (7), 930 (17), 940 (14). Last full runs: 1,771 (with 0152-0156), 1,788 (with 0157), 1,785 (0158 branch alone); every run PASS. Older assertions in 150, 320, 460 and 470 were changed because they encoded the old behaviour (documented in each PR).
- Unit: `npm test` 789 pass (9 skipped); `npm run typecheck`, `npm run lint:security` and `npm run build` clean on the last app branch.
- CI on each PR: build-and-verify and database-tests success.
- Independent reviews: a read-only commission audit (12 invariants) and a security review of 0152-0155; its P2 findings were fixed in 0155/0156.
- Browser check (Playwright, headless Chromium, local sample-data stand-in, not production): the customer offers screen at 360, 390, 768 and 1280 px in light and dark, 8 screenshots in `docs/marketplace/screenshots/`. They show the declared truck line and the masked plate; a plate-wrapping flaw found at 390 px was fixed. Server-rendered unit tests cover the same card (`offer-card-render`). The agreement card was also run end to end in the browser: the driver proposes (fare $110.00 read from the job, EcoCash, $20 deposit to the driver), sees "waiting"; the customer sees the proposal at 360 px in dark mode and confirms; both then see "Both of you confirmed this". The truck form saved type, make, model and colour (`agreement-*`, `truck-form-360`, `topup-390` screenshots). The stand-in mirrors the real 0157 functions; it is not the database. Not verified: real Google sign-in, Paynow, push delivery, Android devices. `scripts/db-concurrency-check.sh` S10/S11 pass; S8 already failed since 0144.

## Rollback

Each migration has an undo file in `supabase/rollbacks/` (0152, 0153, 0154, 0155, 0156, 0157, 0158). Those with DROP must be run in the Supabase SQL editor. Undoing 0154 returns to instant assignment.

## Deployment steps still open

1. Nothing else is pending for 0152-0158: all are merged, applied and recorded.
2. Owner decisions above, including which diesel price is intended (live setting is $2.04; earlier notes said $1.87; the fuel-use and allowance rows are unset, so defaults apply).
3. Do not run `supabase db push` before `schema_migrations` is repaired for 0077-0108.

## Known gaps

Agreement card and truck form not exercised in a real browser; plate shows first 3 characters; a revived dispatch offer sends no new-offer notification; truck photos not built (no authentic photo source); the client pickup input and delivery-only quote are built and browser-tested (against the real road router, switch on in the local stand-in) but invisible until you turn the switch on; the terms and commission wording have not been changed (gated on your go); the supplier-flavoured copy in the booking and quote screens stays until the pricing switch ships; admin calibration report is unchanged.

## Update 9 November 2026 (owner decisions)

- Delivery-only pricing stays **off**. Built so that turning it on is one setting: the terms, home page, wallet note, help and driver walkthrough say "7% of the agreed delivery fare (materials are not part of it)" only while the switch is on, and keep today's wording while it is off (browser-checked both ways). `0161` lets visitors read the on/off boolean (live, recorded 20261109160000).
- Launch cap stays $500. Diesel stays $2.04/L.
- Dispute refunds on direct-pay jobs now return the commission to the **driver** (`0160`, live, recorded 20261109150000; hash equals the committed text). pgTAP 130 and 190 updated; full suite 90 files / 1,820 pass.
- Still yours: the licensed truck-profile router, the lawyer and Paynow questions, and the decision to turn the switch on. Before turning it on, also update the driver offer form and public price check wording, which still describe supplier pricing.
