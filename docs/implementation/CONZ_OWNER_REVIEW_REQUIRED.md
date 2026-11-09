# ConZ: decisions and actions that need the owner

Nothing here was done. Each item says what is blocked and the safest default.

| # | Item | Why it needs you | Safe default meanwhile |
| --- | --- | --- | --- |
| 1 | ~~Legal company name~~ **Decided 09/11 (owner): "Navysky Innovations (Private) Limited" is the entity.** "Sky Innovations Limited" is not used | None | Code and legal pages already use the Navysky name; no change needed |
| 2 | ~~Protected demo accounts~~ **Decided 09/11 (owner):** keep `munesuishemichaelmashodo@gmail.com` and `ngaatendwew@gmail.com` (both super admins, both in `super_admin_owners`); clear the rest, **except `web***@gmail.com` (kept on the owner's answer)**. Method chosen: anonymise + lock (the app's own deletion path; job, payment and audit history stay, with no name attached). **9 accounts cleared 09/11** (verified). **3 still locked but not yet scrubbed: `con***`, `taw***`, `mas***`** | **Your 3 steps to finish it:** (a) Admin > Jobs: cancel the 2 stuck test jobs that are `in_progress` since 13/08 and 16/08 (they block `con***` and `taw***`; one has a super admin as driver); (b) Supabase Dashboard > Storage > `driver-docs`: delete the folders of `con***` (7 files) and `mas***` (3 files): I cannot do it without a service key; (c) tell me, and I scrub the remaining 3 | The 3 logins are banned (reversible) |
| 3 | **$20 promo commission credit: APPROVED 09/11 by the owner, as demo (non-cash) money**: one-time $20 promo commission credit, not cash, not withdrawable, not transferable, replaces first-job-free | Build in progress: corrected migration (old 0134 has open finding M4), tests, copy change in the 6 places | First-job-free stays until the new migration is live |
| 4 | **Turn on delivery-only (transport) pricing** (`system_settings.transport_pricing_enabled`) and re-check the $500 cap | Money rule | Off (your 09/11 decision) |
| 5 | **Licensed truck-profile road router** instead of the free car-profile router | Cost/provider choice | Free router with a stated caveat |
| 6 | **Payment providers**: Paynow settings, Payonify (PR #38, not merged), Linkwa (treated as unapproved) | Provider credentials/legal | No change; handover doc will list questions |
| 7 | **Apple/Google store actions, iOS project, signing, bundle IDs** | Store and signing | Android build-only; iOS "not ready" |
| 8 | **Vercel Production**: set `VITE_SUPABASE_PROJECT_ID=ovwrsocjmkpiygipmrdk` (it currently carries the staging id; code now derives the MCP issuer from the URL, so this is hygiene) | Dashboard setting | Code already safe |
| 9 | ~~Staging paused~~ **Done 09/11:** `conz-staging` stays paused. The Payonify sandbox (#82), passkey staging (#91) and payments-left (#85) tasks stay blocked until you restore it | Plan limit | Left paused |
| 10 | ~~`venmax-admin` restore~~ **Done 09/11:** `venmax-admin` is `ACTIVE_HEALTHY` | None | None |
| 11 | Lawyer/regulatory questions in `CONZ-COMMISSION-CREDIT-RISK-NOTE.md` (commission credit, directors, ZIMRA TIN for the company) | Legal conclusions | None made |
| 12 | Real-device tests (Android phone, push delivery) | Needs hardware. **Script ready: `CONZ_PLATFORM_TEST_PLAN.md` (about 20 minutes, 12 steps)**. Evidence today: 0 native push tokens ever registered; 6 web-push subscriptions | Reported as unverified |
| 13 | Repair `schema_migrations` for 0077-0108 before any `supabase db push` | Touches migration history | Never run `db push` |
| 14 | ~~Deposit rule (F-AGR-1)~~ **Built 09/11** to the spec's rule (Driver proposes, Customer accepts): migration 0162 + card change, pgTAP 930 (22 tests), undo script tested. Live since 09/11 (production had 0 agreements) | None needed unless you want the old behaviour back | Undo: `supabase/rollbacks/20261109170000_0162_rollback.sql` |
