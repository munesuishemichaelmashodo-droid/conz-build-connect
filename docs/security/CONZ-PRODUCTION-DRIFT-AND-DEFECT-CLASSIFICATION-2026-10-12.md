# ConZ production RPC/schema drift reconciliation — code defects vs deployment blockers (12/10/2026)

Evidence: read-only, aggregate, PII-free production catalog queries (names, signatures, grants, md5 of definitions);
local stand-in database; nothing written to production.

## A. Code defects (fixed locally, uncommitted, each with a test)

| Defect | Where | Fix / test |
|---|---|---|
| Parallel `accept_dispatch_offer` deadlock (loser got an opaque 40P01; never a double claim) | `accept_dispatch_offer` lock order offer→job | 0105 + concurrency S10/S11 |
| `admin_set_diesel_price` always failed (wrong audit-call argument order) | production function | 0100 + test 300 |
| Delivery-photo clock could be backdated → instant escrow release | `jobs` guard / sweep | 0099 + test 290 |
| Production quoting broken: `create_price_quote_for` absent | bridge | 0098 + test 280 |
| Stock record used as a gate (policy) | resolve/quote/verified supply/accept_bid/cancel_job | 0101 + test 310 |
| Driver decline was client-side only | JobOfferListener | 0102 + test 320 |
| Demand multiplier changeable by any admin without step-up | setter | 0103 + test 340 |
| No supplier-confirmation record | new | 0104 + test 350 |

Not defects: client calls to service-role-only functions (`expire_stale_*`, `claim_super_admin`) fail by design; cron covers expiry
(up to 30 min latency for stale open jobs).

## B. Production deployment blockers (not code defects)

1. No verified backup and no isolated restore (Free plan, no PITR). Release is blocked on this.
2. Missing in production (app would fail): 7 RPCs + 1 signature difference (matrix doc); `complete_job` is one-argument.
3. Unrecorded 0077-0087 objects in production and 18 unmatched objects whose origin is unexplained (reconciliation doc).
4. App-first constraints: 0078, 0080, 0096 (delivery code).
5. Production `require_aal2` has no freshness window until 0096; 0103 depends on it for fresh step-up.
6. `expire-sourcing-requests` cron absent until 0088.
7. Super admins must have an enrolled aal2 factor before 0103.
8. Production `accept_bid` / `cancel_job` are byte-identical to local base (md5 checked), so 0101's patch applies cleanly; `resolve_material_source_candidates` in production is the older version (0080/0101 replace it).

## C. Not verified
Real Supabase stack, CI, restored-production rehearsal, browser/Android E2E, live or sandbox Paynow.
