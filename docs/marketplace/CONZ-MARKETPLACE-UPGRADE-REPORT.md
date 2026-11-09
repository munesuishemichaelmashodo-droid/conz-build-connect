# ConZ marketplace upgrade: verification report and owner summary (9 November 2026)

## Owner summary (the 8 questions in the brief)

1. **What was already good and kept?** Offer acceptance (`accept_bid`: row locks, expiry, balance check, one reserve), the commission reserve/release/settle functions and first-job-free rule, PIN plus delivery-photo completion, Paynow top-up authenticity and idempotency, escrow/withdrawal switches off, the road-distance-only quote (no straight-line fallback), the offline card, and the supplier tables and admin screens (not deleted). The independent audit found these PASS (audit doc, section 4).
2. **What was risky or wrong, and is it fixed?**
   - Customers could read a bidding driver's phone, email and full truck row before choosing: **fixed and live** (0152 safe cards, 0153 policy lockdown, 0156 narrower truck policy).
   - A dispatch "yes" assigned a driver the customer never chose: **fixed and live** (0154, 0156). Trade-off: dispatch is slower; undo file exists.
   - Admins (and, in git, drivers/customers via `held_commission_promo`) could write money columns of `jobs` directly: **fixed and live** (0155).
   - Not fixed, owner decision needed: commission still includes materials; live settlement recomputes commission at completion (apply 0113); a dispute refund on a direct job credits the customer's wallet; referral credit is withdrawable; do not apply 0134 before its own findings are fixed.
3. **What was added for clients and drivers?** Safe driver cards (name, photo, last active, truck type/make/model/colour marked "declared by driver", capacity, masked plate until chosen); optional truck fields on the driver form; an agreement card (fare from the job, payment method and timing, deposit paid to the driver, times, inclusions, versions, both sides confirm) (0157, in review); a transport-only pricing engine, off (0158, in review).
4. **How does pricing work nationwide now?** Live pricing is unchanged (material plus transport from a listed supplier). The nationwide transport-only formula is designed (`CONZ-NATIONWIDE-PRICING.md`), built as a function that nothing calls yet, and every value is uncalibrated. Switching it on needs your go plus decisions on the $500 launch cap and a licensed truck-profile router.
5. **How is ConZ paid?** Unchanged: 7% of the accepted price, reserved from the driver's prepaid commission credit when the customer accepts, released once on a legitimate cancel, charged once on verified completion, first job free. The brief wants the base to be the transport fare only; that is designed but NOT live.
6. **What did research say about competitors?** None of the verified competitors (MoveZW, ZimboHaul, eTruckConnect) shows truck make, model, payload, plate or photo publicly; Truck on the Move gates job acceptance behind a prepaid wallet. Movu and Takurirwa could not be verified. Competitor prices are context only.
7. **What are the legal and regulatory questions?** `CONZ-COMMISSION-CREDIT-RISK-NOTE.md`: whether a restricted prepaid commission credit counts as stored value or payment intermediation (NPS Act s18), Paynow's licensed scope, POTRAZ data-controller licence, consumer-protection terms, tax. Primary texts could not be read; this is a question list for a Zimbabwean lawyer, not advice. Wording rules: say "commission credit", never "wallet", "escrow", "we hold".
8. **What do you need to decide?** (a) Turn on transport-only pricing and commission base (changes what drivers pay); (b) the launch cap (`max_job_budget` $500 blocks long hauls); (c) a licensed router with a truck profile instead of the public demo server; (d) apply 0113 and fix the dispute-refund path; (e) the lawyer and Paynow questions; (f) plate masking (first 3 characters shown before choosing).

## What was done (branches, commits, migrations)

| Item | PR | Migration | Production |
| --- | --- | --- | --- |
| Audit, pricing design, competitor research, legal note | #85 (merged) | none | n/a |
| Safe bidder cards + truck facts | #82 (merged) | 0152 | live, recorded 20261108100000 |
| Close bidder exposure | #84 (merged) | 0153 | live, 20261108110000 |
| Dispatch answer is an offer | #83 (merged) | 0154 | live, 20261108120000 |
| Jobs money-column guard + review fixes | #86 (merged) | 0155, 0156 | live, 20261109100000 and 20261109110000 |
| Agreement card | #87 | 0157 | not applied until merge and deploy |
| Transport pricing engine (off) | #88 | 0158 | not applied |

Live hash checks (whitespace-stripped md5): `offer_bidder_cards` `a75845e6…` equals the local build; `accept_dispatch_offer` after 0154 `eb2edb77…`, after 0156 `5b04701b…`. The local database could not be compared for 0154/0156 (it was not running after an environment restart); the applied text equals the committed file with comment-only lines removed, which is the established practice. `tg_truck_change_needs_review` differs from the committed file only by one stripped trailing comment.

## Verification evidence

- pgTAP (local Supabase in Docker): baseline on main 82 files / 1,710 tests. New files: 880 (15), 890 (9), 900 (11), 910 (16), 920 (7), 930 (17), 940 (14). Last full runs: 1,771 (with 0152-0156), 1,788 (with 0157), 1,785 (0158 branch alone); every run PASS. Older assertions in 150, 320, 460 and 470 were changed because they encoded the old behaviour (documented in each PR).
- Unit: `npm test` 789 pass (9 skipped); `npm run typecheck`, `npm run lint:security` and `npm run build` clean on the last app branch.
- CI on each PR: build-and-verify and database-tests success.
- Independent reviews: a read-only commission audit (12 invariants) and a security review of 0152-0155; its P2 findings were fixed in 0155/0156.
- Not verified: browser or device checks of the new screens at 360/390/768/1280 (the in-browser tool was unavailable in this session), real Google sign-in, Paynow, push delivery, Android. Screenshots were therefore not produced. `scripts/db-concurrency-check.sh` S10/S11 pass; S8 already failed since 0144.

## Rollback

Each migration has an undo file in `supabase/rollbacks/` (0152, 0153, 0154, 0155, 0156, 0157, 0158). Those with DROP must be run in the Supabase SQL editor. Undoing 0154 returns to instant assignment.

## Deployment steps still open

1. Merge #87 after CI; deploy; apply 0157 (additive); verify; record `20261109120000`.
2. Merge #88; apply 0158 any time (additive, off); record `20261109130000`.
3. Owner decisions above. Do not run `supabase db push` before `schema_migrations` is repaired for 0077-0108.

## Known gaps

Agreement card and truck form not exercised in a real browser; plate shows first 3 characters; a revived dispatch offer sends no new-offer notification; truck photos not built (no authentic photo source); client pickup input, nationwide pricing wiring, terms and copy changes are not built (gated on the owner's go); the supplier-flavoured copy in the booking and quote screens stays until the pricing switch ships; admin calibration report is unchanged.
