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
| 2 | Agreement | Verified 0157; one finding (deposit proposer) to owner review |
| 3 | Demo isolation | Dry-run inventory written (`CONZ_DEMO_DATA_INVENTORY.md`); no deletion; blocked on protected accounts |
| 4 | Pricing | Origin check done (no hidden origin; stale admin text fixed); competitor refresh + calibration report pending |
| 5 | Admin/KYC/RLS | Read-only live audit clean (baseline audit s.7) |
| 6 | Payments | Handover doc written |
| 7-10 | Copy fixes, UI pass, tests, release, final report | In progress |

## Already merged before this spec (carried forward, evidence in `docs/marketplace/CONZ-MARKETPLACE-UPGRADE-REPORT.md`)

0152-0161 live and recorded; offers/agreement card/truck facts; delivery-only pricing built and OFF; migration-hygiene CI guard (#103); MCP + zod security (#100, #101, #104).

## Log

- 09/11 Stage 0: PR #104 merged (CI: build-and-verify, database-tests, build-android-apk all success). ConZ staging paused. Live migration list compared with git: matches through 0161; 0134 (promo) not live.
- 09/11 Stage 1-2: onboarding and agreement verified against the spec by reading code/migration; first-job-free correction recorded (still true live).
