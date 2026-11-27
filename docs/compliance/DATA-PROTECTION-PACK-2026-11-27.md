# Data protection pack (POTRAZ preparation) — 27 November 2026

**Status:** preparation only. No POTRAZ licence or registration has been obtained, and no Data Protection Officer (DPO) has been appointed. Nothing in this document is an approval. Items marked **CONFIRM** need written confirmation from POTRAZ or a lawyer.

Controller: Navysky Innovations (Private) Limited, company no. 145174A02102026, trading as Con Z. Contact: navyskyinnovations@gmail.com.

## 1. Data inventory (from the database schema in `supabase/migrations`)

| Area | Main tables / storage | Data categories | Purpose |
| --- | --- | --- | --- |
| Accounts | `auth.users`, `profiles`, `user_roles` | name, phone, e-mail, sign-in identities (Google), roles, terms acceptance | sign-in, contact between parties |
| Driver checks | `driver_profiles`, `driver_compliance_documents` (0191), bucket `driver-docs` | ID, selfie, licence (class, last 4 of number), vehicle papers, fitness, operator licence, insurance; review history | verifying drivers and vehicles |
| Trucks | `trucks` | registration, capacity, photos | matching jobs to vehicles |
| Jobs | `jobs`, `bids`, `job_agreements` (+0186 snapshot), `job_agreement_events` | addresses, coordinates, materials, prices, agreed terms | running the marketplace |
| Evidence | `job_evidence`, `job_stage_reports` (0187), bucket `job-proof-photos` | photos with GPS, quantities, condition, delays, problems | proof of collection and delivery, disputes |
| Location | `driver_locations` (24 h), `job_route_points` (90 days, admin-only) | live position, route trail | tracking, disputes |
| Payments | `payments`, `wallets`, `wallet_transactions`, `promo_credit_ledger`, `direct_payment_stages` (+0188 evidence, reviews) | Commission Credit, top-ups, references, payment statements and proof | commission, reconciliation |
| Chat | `messages`, bucket `chat-media` | messages, photos, voice notes | communication between the parties |
| Disputes and cases | `disputes`, `reports`, `case_events` (0192) | complaints, statements, decisions, appeals | dispute and incident handling |
| Ratings, referrals | `ratings`, `customer_ratings`, `referrals` | scores, comments, invitation progress | reputation, recognition |
| Security | `admin_audit_log`, `login_events`/sign-in alerts, push tokens, device fingerprints on referrals | admin actions, evidence access, device data | security, audit, fraud review |

## 2. Retention (what the code does today)
- Live driver location: deleted after 24 hours. Route trail: 90 days (cron `prune-job-route-points`).
- Notifications: read/archived after 14 days, all after 180 days (0165).
- Account deletion (`delete_my_account`, 0141/0173): removes name, phone, e-mail, photo, identity and vehicle documents, devices, location history, own chat media; keeps financial, audit and shared job records without personal details.
- Agreements, evidence, payment records, cases: kept and append-only (no fixed end date). **CONFIRM** retention periods with a lawyer (financial records vs. evidence), then add scheduled anonymisation.
- **Open defect (owner decision):** deletion is blocked while a driver has unused Commission Credit (`wallet_balance_positive`). Credit cannot be withdrawn, so the policy for unused credit at closure (forfeit vs. refund) must be decided before this can be fixed. The Privacy Policy now says so.

## 3. Hosting and transfers outside Zimbabwe
| Processor | Role | Location | Data |
| --- | --- | --- | --- |
| Supabase | database, storage, auth | Zurich, Switzerland (eu-central-2) | all of the above |
| Vercel | website and server functions | United States (iad1) | requests in transit |
| Paynow | top-up payments | Zimbabwe | payer e-mail, amount, reference |
| Google | Google sign-in, push (FCM) | global | name, e-mail, device token |
| Africa's Talking | SMS | **CONFIRM** region | phone, message text |
| CARTO, OpenStreetMap/OSRM, Nominatim, LocationIQ | map tiles, routing, address search | various | coordinates, address text |

**CONFIRM** with a lawyer: the legal basis for transfers outside Zimbabwe under the Cyber and Data Protection Act, and whether processor agreements (DPAs) are needed with each provider. Supabase and Vercel publish standard DPAs; signed copies are not on file.

## 4. Access control evidence (in the repository)
- Row-level security on every public table (migration-hygiene unit test fails a migration that creates a table without it).
- Clients cannot write money tables directly (0125, 0138, 0155); admin money/role actions need a super admin and a fresh step-up (`require_aal2`).
- Evidence: private buckets; admins cannot overwrite or delete stored evidence photos (0187); every admin opening of a job's evidence view is logged (0193).
- Admin actions are written to `admin_audit_log`; owners are notified of admin sign-ins and actions (0111/0122).
- Tests: pgTAP suite (108 files, ~2,200+ assertions) covers access for strangers, other customers, other drivers and signed-out visitors.

## 5. Breach response (procedure to adopt)
1. Contain: revoke the affected keys (Supabase dashboard → API; Vercel env), switch Paynow mode to `off` (`admin_set_paynow_mode`), disable the affected function (`revoke execute`).
2. Record a `data_exposure` case (0192) with what, when, who and how many people.
3. Assess risk to people; notify affected users through the app and e-mail.
4. **CONFIRM** the legal notification duty and deadline to POTRAZ under the Act, and record the notification.
5. Fix forward with a migration; never delete evidence of the incident.

## 6. DPO and licensing
- **CONFIRM** whether Navysky Innovations must apply for a data controller licence with POTRAZ and which tier applies (based on the number of data subjects), the fee, and the documents required.
- **Decision needed:** who acts as DPO (an owner, or an external DPO) and their contact for the Privacy Policy.
- Do not state in the app or anywhere that ConZ is licensed until POTRAZ confirms it in writing.
