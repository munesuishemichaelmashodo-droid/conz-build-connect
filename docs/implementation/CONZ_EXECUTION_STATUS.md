# ConZ implementation: execution status (living document)

Spec: `ConZ_Complete_Autonomous_Implementation_Prompt.md` (owner upload, 09/11/2026). Updated at the end of every stage.
Rule: nothing below is called "done", "live" or "tested" without the evidence named next to it.

## Environment (Stage 0, 09/11/2026)

| Item | Value | Evidence |
| --- | --- | --- |
| Repo / base | `munesuishemichaelmashodo-droid/conz-build-connect`, `main` at `eb363a5` (PR #104 merged) | `git log` |
| Working branch | `impl/stage0-baseline` (from `origin/main`) | `git status` |
| Production Supabase | `ovwrsocjmkpiygipmrdk` (`conz-build-connect`), ACTIVE_HEALTHY | `list_projects` 09/11 |
| Staging Supabase | `conz-staging` (`fpckydgssuefzzxivvig`): **paused by owner request 09/11** (confirmed `INACTIVE` 09/11) so `venmax-admin` can run | `pause_project` -> success |
| Hosting | Vercel, https://www.conz.co.zw, auto-deploy from `main` | CLAUDE.md |
| Android | Capacitor shell `com.conz.app` loading the live site; CI `build-android-apk` green on PR #104 | check run 09/11 |
| iOS | **No `ios/` project exists in the repo** | `ls ios` -> not found |

## Skills and tools available (spec asked to record which exist)

Installed and used: superpowers (brainstorming, TDD, systematic-debugging, executing-plans, verification-before-completion, requesting-code-review),
`code-review`, `simplify`, `security-review`, design-superpowers (`design`, `design-review`, `creative`), `frontend-design`, `anthropic-skills:ui-design`,
`anthropic-skills:conz-safe-db-change`, `conz-e2e-release-verification`, `conz-money-flow-audit`, repo skills `conz-payment-audit`, `payment-security-review`,
`payment-integration-testing`, `payment-economics`, `zimbabwe-payments-research`, agents under `.claude/agents` (payment reviewers/researchers).

Spec names with no command of that exact name: `/go`, `/super-intelligence`, `/advisor`, `/ui-design`, `/debug`, `/verify`.
Equivalents used: `/goal` -> the Stop-hook goal loop; `/advisor` and `/super-intelligence` -> subagent review (Plan/Explore/code-review agents) and
`code-review`; `/ui-design` -> `anthropic-skills:ui-design`; `/debug` -> `superpowers:systematic-debugging`; `/verify` -> `superpowers:verification-before-completion`.
Playwright MCP failed to connect this session (timeout); browser checks use the Playwright library from node directly.

## Stages

| Stage | Scope | Status |
| --- | --- | --- |
| 0 | Verify repo and production, status + baseline docs | In progress: this document, `CONZ_BASELINE_AUDIT.md`, `CONZ_OWNER_REVIEW_REQUIRED.md` written; PR pending |
| 1 | Onboarding | Verified existing flow meets spec; no change needed (baseline audit s.7) |
| 2 | Agreement | Verified 0157; deposit rule fixed by 0162 + card change (see log) |
| 3 | Demo isolation | Dry-run inventory written (`CONZ_DEMO_DATA_INVENTORY.md`); no deletion; blocked on protected accounts |
| 4 | Pricing | Origin check done (no hidden origin; stale admin text fixed); competitor refresh + calibration report pending |
| 5 | Admin/KYC/RLS | Read-only live audit clean (baseline audit s.7) |
| 6 | Payments | Handover doc written |
| 7 | Copy and UI | Copy fixes done; width/scheme/accessibility sweep done (baseline audit s.7); contrast, screen reader, keyboard-only and admin screens not covered |
| 8-10 | QA review, release, final report | Report and release evidence written; independent review pending |

## Already merged before this spec (carried forward, evidence in `docs/marketplace/CONZ-MARKETPLACE-UPGRADE-REPORT.md`)

0152-0161 live and recorded; offers/agreement card/truck facts; delivery-only pricing built and OFF; migration-hygiene CI guard (#103); MCP + zod security (#100, #101, #104).

## Log

- 09/11 Stage 0: PR #104 merged (CI: build-and-verify, database-tests, build-android-apk all success). ConZ staging paused. Live migration list compared with git: matches through 0161; 0134 (promo) not live.
- 09/11 Stage 1-2: onboarding and agreement verified against the spec by reading code/migration; first-job-free correction recorded (still true live).
- 09/11 Stage 7 (copy, first slice): wallet note no longer promises that support returns unused credit; account-deletion blocker no longer says to withdraw while withdrawals are paused. Checks: tsc 0, 851 tests, lint:security exit 0, build exit 0. First-job-free copy deliberately kept (true live).
- 09/11 Stage 2 fix: 0162 (Driver-proposed deposit) written with undo, pgTAP 930 updated (22 tests), full suite PASS (90 files, 1827 tests), unit 857, lint:security 0, build 0. Not yet applied live (app deploys first).
- 09/11 0162 LIVE: PR #108 merged (`9da59f0`; CI build-and-verify, database-tests, build-android-apk all success). Production serves the new card (live job-page chunk contains the new text). Migration applied via `execute_sql` after proving the target (project `ovwrsocjmkpiygipmrdk`), the live function equalled the 0157 body (md5 `32cef48f...`) and production had 0 agreements; live body md5 after = `2a21534304acbac17fe1835d0a80c9b1` (= committed text minus comments); grants unchanged (anon no, authenticated yes); recorded as `20261109170000`. Undo: `supabase/rollbacks/20261109170000_0162_rollback.sql`.
- 09/11 Stage 4 competitor refresh: `docs/marketplace/CONZ-COMPETITOR-REFRESH-2026-11-09.md` (none of the six names in the spec were found; sourced leads listed; calibration report not produced: 11 completed jobs in total).
- 09/11 CI note: the push run on `main` after PR #106 showed `build-android-apk` red; cause = Gradle wrapper could not download its distribution (network error in the log), every other job green, and the next run on the same code was green. Infrastructure flake, no code change.
- 09/11 Stage 7: sweep of 136 loads (4 widths x 2 schemes x 3 roles): no overflow, no console errors; headings fixed (driver home h1, Help one h1). Checks: tsc 0, 857 tests, lint:security 0, build 0.
- 09/11 Stage 8 independent review (fresh reviewer agent, read-only, over 0162 / copy edits / headings): no customer bypass of the deposit rule found; one real edge case confirmed by a failing pgTAP test first (a superseded driver deposit could be forced on the customer after v1 $20 accepted, v2 $30 superseded, v3 $40 declined). Fixed by 0163 (carry from versions still proposed or accepted), client rule and unit tests aligned, stale-form message added, wallet text keeps a neutral "contact support" line, deletion blocker no longer assumes withdrawals are paused. Local: pgTAP 90 files / 1830 tests PASS, 862 unit tests, lint:security 0, build 0, eslint 0. Not applied live yet.
- 09/11 0163 LIVE: PR #111 merged (`427c549`; CI all green); production serves the new card code (live job-page chunk contains the new stale-form message). Pre-check: live body md5 `2a21534304acbac17fe1835d0a80c9b1` (= 0162), 0 agreements; applied via `execute_sql`; post-check md5 `11b918d150ecc0bbee7e8c8e8b9b59f6` (= committed text minus comments), security definer, anon cannot execute, authenticated can; recorded as `20261109180000`. Undo: `supabase/rollbacks/20261109180000_0163_rollback.sql`.
- 09/11 Stage 7 extra checks (local stand-in, headless Chromium): **axe-core 4.10 over 88 page loads (WCAG 2.0/2.1/2.2 A and AA tags, including colour contrast) at 390 and 1280 px in light and dark: 0 violations.** The audit was validated first (it flagged an injected low-contrast text and an image without alt). Keyboard-only Tab walk, 40 presses per page, on 8 pages (public home, auth, quote; customer home and a job page; driver home): every tab stop shows a visible focus ring; the "Want a quick tour?" modal correctly holds focus until dismissed. Not covered: the admin data panels (the stand-in has no admin data calls, so only the admin shell and navigation were exercised), the customer wallet page (empty on the stand-in), a real screen reader, real devices, production data.
- 09/11 Stage 6 (platforms): `CONZ_PLATFORM_TEST_PLAN.md` written: Android real-phone script (A1-A12), web push check, iOS prerequisites. New read-only production evidence: `device_tokens` = 0 rows (no phone has ever registered for native push), `push_subscriptions` = 6 (newest 26/10). Android push and iOS remain unverified / not ready; this is the only way to move them forward and it needs a person with a phone.
- 09/11 Security re-check (read-only): Supabase security advisors on production = 7 finding types: the known/accepted ones (driver_public_profiles definer view, pg_net in public, leaked-password protection off on Free plan, 5 anon-executable definer functions = the reviewed list, 3 deny-all tables app_secrets / material_sourcing_status_history / super_admin_owners) plus one NEW: two helper functions from 0148 with a mutable search_path. Fixed by 0164 (ALTER only), test-first (pgTAP 960: RED then GREEN; full suite 91 files / 1835 tests PASS; undo applied and re-applied locally). `npm audit --omit=dev`: unchanged, 1 low (esbuild dev server on Windows).
