# ConZ: decisions and actions that need the owner

Nothing here was done. Each item says what is blocked and the safest default.

| # | Item | Why it needs you | Safe default meanwhile |
| --- | --- | --- | --- |
| 1 | **Legal company name**: code says "Navysky Innovations (Private) Limited" (no. 145174A02102026); the spec also mentions "Sky Innovations Limited" | Legal identity; not guessed or equated | Keep current wording; no legal text edits |
| 2 | **Protected demo accounts**: the two emails to keep are not named in the spec or repo docs | Needed before any demo cleanup | Dry-run inventory only; no delete or modify; backup first |
| 3 | **$20 promo commission credit** replacing first-job-free: live migration (0134 is old, has open finding M4) | Live financial behaviour | Stay as is. First-job-free is still live and true, so its 6 copy places stay until you approve; they change together with the migration |
| 4 | **Turn on delivery-only (transport) pricing** (`system_settings.transport_pricing_enabled`) and re-check the $500 cap | Money rule | Off (your 09/11 decision) |
| 5 | **Licensed truck-profile road router** instead of the free car-profile router | Cost/provider choice | Free router with a stated caveat |
| 6 | **Payment providers**: Paynow settings, Payonify (PR #38, not merged), Linkwa (treated as unapproved) | Provider credentials/legal | No change; handover doc will list questions |
| 7 | **Apple/Google store actions, iOS project, signing, bundle IDs** | Store and signing | Android build-only; iOS "not ready" |
| 8 | **Vercel Production**: set `VITE_SUPABASE_PROJECT_ID=ovwrsocjmkpiygipmrdk` (it currently carries the staging id; code now derives the MCP issuer from the URL, so this is hygiene) | Dashboard setting | Code already safe |
| 9 | **Staging paused** (09/11, your request): Payonify sandbox (#82), passkey staging (#91) and payments-left (#85) tasks are blocked until you restore `conz-staging`. Restoring may need `venmax-admin` paused first if the plan allows two active projects | Plan limit | Left paused |
| 10 | `venmax-admin` is INACTIVE: restore it from the Supabase dashboard (or ask me) | Not part of ConZ | Not touched |
| 11 | Lawyer/regulatory questions in `CONZ-COMMISSION-CREDIT-RISK-NOTE.md` (commission credit, directors, ZIMRA TIN for the company) | Legal conclusions | None made |
| 12 | Real-device tests (Android phone, push delivery) | Needs hardware | Reported as unverified |
| 13 | Repair `schema_migrations` for 0077-0108 before any `supabase db push` | Touches migration history | Never run `db push` |
| 14 | ~~Deposit rule (F-AGR-1)~~ **Built 09/11** to the spec's rule (Driver proposes, Customer accepts): migration 0162 + card change, pgTAP 930 (22 tests), undo script tested. Live apply is recorded in the execution status | None needed unless you want the old behaviour back | Undo: `supabase/rollbacks/20261109170000_0162_rollback.sql` |
