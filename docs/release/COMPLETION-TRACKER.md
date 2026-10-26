# ConZ completion tracker (single source of truth)

Started 26/10/2026. Update this file, not a new one. Statuses: VERIFIED COMPLETE · IN PROGRESS · BLOCKED ·
AWAITING APPROVAL · DEFERRED WITH REASON · NOT REQUIRED, WITH EVIDENCE.

**Verdict on 26/10/2026: NOT READY — ACTIONS REMAIN.** The core product works end to end in testing (§2); what
remains is mostly approvals (merges, migrations, release) and owner settings (§8).

## 1. State at the start (evidence)

- Production app = `main` @ `c7b1f1c` (PR #23 release + homepage photo hotfix #25). Supabase `ovwrsocjmkpiygipmrdk`.
- Working branch `ccr-4fab7e0d-2b8j1o` @ `dc6d8fe`: 14 commits ahead of `main`, 0 behind. Since the last release it
  adds sign-up keeps the booking (#26), conversion copy (#28), dependency security (#33), migration plan docs (#34),
  0119 file (#35). Not deployed.
- Open PRs: #29, #30, #31, #32 (stacked on #31), #36 (new); paused for the payments phase: #11, #18, #27; superseded:
  #17 (by #33); stale: #3 (its 0071 is live). No GitHub issues exist.
- Production migration history records 0072–0076, 0098 (under other versions) and 0109–0112. 0077–0108 are live but
  unrecorded except 0103 (never applied) and one live-only edit in 0079 (`docs/release/RELEASE-READINESS-2026-10-26.md`
  in PR #32 has the per-migration evidence). 0113–0119 are not applied.

## 2. End-to-end verification (26/10/2026)

Integrated build = working branch + #29 + #30 + #32 (incl. #31), merged in a scratch worktree (one import-line conflict
in `jobs.$id.tsx`, kept both). Run against a **local Supabase in Docker** built from the 13/08 baseline + all 100 later
migrations (through 0119), real sign-ins (customer, verified driver with a 15 m³ truck and $50, admin), real road
routing (OSRM), Playwright at 390 px. Scripts: session scratchpad `e2e/*.cjs`.

| Journey | Result |
| --- | --- |
| Customer price check (stones, Avondale) → Pomona at 12 km by road → post job ($340, quote stored) | PASS |
| Driver sees job, fee line, sends offer (30-min expiry, ETA, 15 m³ truck stamped) | PASS |
| Customer sees 1 offer, chooses → `accepted`, first job free (commission held $0) | PASS |
| Driver arrives → loaded photo → trip `in_progress` → arrives → delivery photo | PASS |
| Wrong PIN refused ("That code doesn't match — double check with the customer.") | PASS |
| Correct PIN → `completed`; first-job-free flag used; wallet unchanged | PASS |
| Open request (top soil, no supplier) → guide range → driver adds proposed source → customer sees "Loads at … not checked by Con Z" | PASS |
| Paid job: 7% of $180 = $12.60 held at acceptance, charged once at completion, hold released (wallet $50 → $37.40) | PASS |
| "Where did you load?" asked for a driver-arranged pickup; answer stored; pickup check `no_expected_point` / `far` (8.2 km) flagged to admins, nothing blocked | PASS |
| Admin home shows "2 pickups need a look"; 10 admin screens load as `admin` with no errors | PASS |
| Public price page (signed out) loads without errors | PASS |

Not covered: real Android device, real Google sign-in/step-up (0111), Paynow (no transactions by rule), push
notifications, super-admin money actions, live map tiles (local tile key missing).

## 3. Register

### Security and data integrity
| ID | Item | Evidence | Status | Next action |
| --- | --- | --- | --- | --- |
| S1 | Any admin can change the price multiplier; diesel/multiplier setters have no step-up (0103 never applied) | live function bodies = pre-0103 | AWAITING APPROVAL | Apply 0103 (no DROP; app already handles step-up) |
| S2 | Any signed-in user can list every truck's registration/capacity; truck changes skip re-review; acceptance doesn't re-check approval (0114) | 0114 header, live policies | AWAITING APPROVAL | Apply 0114 in SQL editor (has DROP POLICY) |
| S3 | Sign-up email path to super admin (contained by 0111 owner lock — verified live), admins can edit driver approval directly, supplier contact columns public (no rows have contacts) (0115) | live `handle_new_user`, `tg_user_roles_owner_lock` | AWAITING APPROVAL | Apply 0115 in SQL editor |
| S4 | A two-role account could offer on and accept its own job (0117) | 0117 header; 0 cases live | AWAITING APPROVAL | Merge #29, apply 0117 |
| S5 | Dependency vulnerabilities 37 → 14 | `npm audit` before/after; #33 merged, CI + Android green | VERIFIED COMPLETE (non-breaking part) | Remaining 14 need major upgrades → D3 |
| S6 | Offer messages unlimited in DB | 0119 merged (#35), pgTAP 500 | AWAITING APPROVAL | Apply 0119 (no DROP) |
| S7 | Leaked-password protection off | CLAUDE.md 30/09 | AWAITING APPROVAL (owner setting) | Supabase → Auth settings |
| S8 | Migration history gap 0072–0108 (version mismatches) | `list_migrations` vs files | AWAITING APPROVAL | Repair commands in RELEASE-READINESS §5; never `db push` before |
| S9 | 0079 live-only edit in `find_next_loads_for_driver` (label only) | token diff | AWAITING APPROVAL (decision) | Re-apply git body or accept |
| S10 | `pin_lock_duration`, `driver_level_commission_multiplier` callable by anyone | grant diff | NOT REQUIRED, WITH EVIDENCE | Pure calculations, no data access |
| S11 | `pg_net` in public schema; two SECURITY DEFINER views | Supabase advisor (30/09) | DEFERRED WITH REASON | Intentional for public profiles; review later |

### Core product
| ID | Item | Evidence | Status | Next action |
| --- | --- | --- | --- | --- |
| F1 | Customer → driver → delivery → PIN → completion | §2 | VERIFIED COMPLETE (integrated build, local stack) | Smoke-test on production after release |
| F2 | Commission hold/charge/first-job-free | §2 | VERIFIED COMPLETE | — |
| F3 | Dead "Cancel job" during delivery; "may result in a fee" (no fee exists); drivers shown customer stock text | found in §2; `cancel_job` live body | IN PROGRESS → PR #36 | Merge #36 |
| F4 | Pickup check + "Where did you load?" (0112) | §2 | VERIFIED COMPLETE | — |
| F5 | Driver-proposed source on open requests | §2, PR #31 tests | AWAITING APPROVAL | Merge #31 |
| F6 | Offer expiry by server clock; self-offers | PR #29 | AWAITING APPROVAL | Merge #29 |
| F7 | Pricing engine v1.3, fuel estimate, freshness | PR #30, pgTAP 490 | AWAITING APPROVAL | Merge #30, apply 0118 (no live price change) |
| F8 | Optional quote requests (switched off) + release review | PR #32 | AWAITING APPROVAL | Merge #32; switch on only when someone answers |
| F9 | In-progress jobs never expire; 8 stale test trips hold $62.58 of one driver's credit | payments audit P-7 | AWAITING APPROVAL (decision + data) | Owner: cancel test trips (admin), choose a timeout rule |
| F10 | Admin super-admin money actions with Google step-up | not exercised | BLOCKED | Needs a real Google sign-in on production after release |

### Payments (Paynow stays unchanged in this phase)
| ID | Item | Status | Next action |
| --- | --- | --- | --- |
| P-1 | Stuck-payment reconcile never runs (secret unset) | AWAITING APPROVAL (owner setting) | Set `PAYNOW_RECONCILE_SECRET` in Vercel + `app_secrets` |
| P-2 | No successful Paynow top-up since 13/08; no callback recorded since 09/10 | BLOCKED | Owner-approved Paynow test-mode run, then $1 live test (runbook) |
| P-3/4/5 | No manual top-up form; `paid_at` never set; rejection reason not stored | DEFERRED WITH REASON | Payments phase (owner: don't change payments now) |
| P-6, P-11 | Settle with held commission (#11, 0113); credit only when Paynow settles (#18, 0116) | DEFERRED WITH REASON | Payments phase |
| P-10 | Paynow callback DB tests in CI | VERIFIED COMPLETE | — |
| PY-1 | Payonify Relay | DEFERRED WITH REASON | Plan merged (#34). Saved webhook `https://www.conz.co.zw/api/payonify/webhook` returns 404 until built. Waits for Relay activation (send Max the Project ID), stabilisation, legal/accounting view |

### Test infrastructure
| ID | Item | Status | Next action |
| --- | --- | --- | --- |
| T1 | Local/CI Supabase lacks the `on_auth_user_created` trigger and Supabase's default grants on some tables (`material_supply_locations`, `price_quotes`), so pgTAP can't catch sign-up or grant regressions | DEFERRED WITH REASON | Add both to `scripts/db-test.mjs` after the release (production verified correct today) |

### Deferred (optional, not in this release)
| ID | Item | Reason |
| --- | --- | --- |
| D1 | "How much do I need?" material calculator | Optional; no requirement |
| D2 | Supplier pilot data (last-confirmed dates, price sources) | Needs real supplier calls |
| D3 | zod 4, Capacitor CLI 8.4+, vitest 4 upgrades | Major versions; separate PRs |
| D4 | Close stale PR #3 and superseded #17 | Housekeeping; owner to close |

## 4. Tests run 26/10/2026

| Command / workflow | Code | Result |
| --- | --- | --- |
| `npx tsc --noEmit` | integrated build; #36 branch | exit 0; exit 0 |
| `npm test` | integrated; #36 | 419 passed / 9 skipped; 375 passed / 9 skipped |
| `npm run lint:security` | integrated; #36 | exit 0; exit 0 |
| `npm run build` | integrated; #36 | "Build verification passed" both |
| `node scripts/db-test.mjs test` | integrated (100 migrations, through 0119) | Files=49, Tests=1166, PASS |
| GitHub CI (build, pgTAP, Android APK) | #33, #34, #35 | all green before merge |
| End-to-end browser journeys | integrated, local stack | §2 |

## 5. Release checklist (each line needs the owner's explicit approval)

1. Merge #36, #29, #30, #31, #32 into the working branch (resolve the import line in `jobs.$id.tsx` each time).
2. Release the working branch to `main` (Vercel deploys). Smoke-test production: price check, post, offer, accept,
   pickup photo, Start trip, delivery photo, PIN; one admin money action after a Google sign-in.
3. Apply 0103 (security). Verify both setter bodies hash to the file.
4. Apply 0117, 0118, 0119 (no DROP, via `execute_sql`); record each; verify hashes.
5. Apply 0114, 0115 in the SQL editor (DROP POLICY); record; run the trucks/roles checks in their headers.
6. Repair the migration history (metadata only; save the table first).
7. Owner settings: leaked-password protection; `PAYNOW_RECONCILE_SECRET`.
8. Paynow: test mode, then the $1 live test (runbook), with written approval.

Rollback: every applied migration since 23/10 has an undo script in `supabase/rollbacks/` holding the exact
pre-change production definitions; app releases roll back by redeploying the previous `main` commit in Vercel.

## 6. Next actions (in order)

1. Owner: approve step 1 (merges) — evidence above.
2. Owner: approve step 2 (release) and 3 (0103).
3. After release: production smoke test (F1, F10).
4. Owner settings S7, P-1; Paynow test (P-2).
5. After the payments phase opens: P-3/4/5, #11, #18, then Payonify (PY-1).
