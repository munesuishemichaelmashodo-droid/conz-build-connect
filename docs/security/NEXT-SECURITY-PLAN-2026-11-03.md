# Next security workstream: plan (03/11/2026)

Status: **read-only preparation. Nothing here has been applied.** Production was only queried.
Plan: Supabase **Free** (owner, 03/11). Branch `chore/security-next`.

## A. Database privileges

### What production has now (queried 03/11)

- Every table in `public` has row-level security on. That is the control doing the work today.
- On top of it, `anon` and `authenticated` hold table-wide **TRUNCATE, REFERENCES, TRIGGER** on almost every table, and
  `anon` holds **INSERT / UPDATE / DELETE** on about 40 tables (jobs, bids, profiles, trucks, messages and more).
  Row-level security blocks the writes and PostgREST does not expose TRUNCATE, so nothing is exploitable today.
  It is one mistaken policy away from being so (a policy written as `to public` is all it takes).
- `authenticated` also holds INSERT / UPDATE / DELETE on 60+ table/command pairs that have **no matching policy**
  (examples: `wallet_audit_log` all three, `job_evidence` all three, `jobs` DELETE, `profiles` DELETE,
  `price_quotes` all three). Those grants do nothing today.
- The default privileges for new tables in `public` (owners `postgres` and `supabase_admin`) grant everything to
  `anon`, `authenticated` and `service_role`, so every new table starts open and relies on RLS alone.
- Functions: `anon` can execute only the four intended `SECURITY DEFINER` functions (`compute_material_offer`,
  `get_public_tracking`, `has_role`, `public_material_pickups`) plus trigger functions, which Postgres refuses to run
  outside a trigger. No change proposed.
- Sequences: `anon` and `authenticated` hold SELECT/UPDATE/USAGE on 9 sequences. Low risk; see tier 3.

### Smallest safe change (proposed, three tiers)

| Tier | Change | Why it cannot break a workflow |
| --- | --- | --- |
| 1 | Revoke TRUNCATE, REFERENCES, TRIGGER from `anon` and `authenticated` on all `public` tables; revoke INSERT, UPDATE, DELETE from `anon` on all `public` tables | The app never truncates or alters triggers through the API. Signed-out visitors only use the four anon functions and server functions that use the service role. Sign-in/sign-up go through the `auth` schema, not these tables. |
| 2 | Revoke `authenticated` INSERT / UPDATE / DELETE only where **no RLS policy exists for that command** (generated from `pg_policy`, 63 pairs on 03/11) | With no policy RLS already denies the command, so the effective access is identical before and after. Writes done by `SECURITY DEFINER` functions (owned by `postgres`) are unaffected. |
| 3 (separate, later) | `ALTER DEFAULT PRIVILEGES … REVOKE ALL … FROM anon, authenticated` for tables in `public`; revoke `anon` on the 9 sequences | Changes how future migrations must be written (explicit GRANT per table), so it needs its own decision and a test-harness update. |

Writes the app really performs (checked in `src/`): profiles, driver_profiles, bids, trucks, reports, ratings, disputes,
notifications (update), push_subscriptions and device_tokens (delete), tour_events, driver_availability, user_hints_seen.
All have matching policies, so none is touched by tiers 1–2. Server-side code that writes `user_roles`, `payments`
and wallets uses the service role, which keeps its grants.

### Draft SQL (tiers 1–2, not applied; no DROP)

```sql
begin;
do $$
declare r record;
begin
  -- Tier 1
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p') loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', r.relname);
    execute format('revoke insert, update, delete on public.%I from anon', r.relname);
  end loop;
  -- Tier 2: authenticated grants with no policy for that command
  for r in
    select c.oid, c.relname, p.priv
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public' and c.relkind in ('r','p')
      cross join (values ('INSERT','a'), ('UPDATE','w'), ('DELETE','d')) as p(priv, cmd)
     where has_table_privilege('authenticated', c.oid, p.priv)
       and not exists (select 1 from pg_policy pl
                        where pl.polrelid = c.oid
                          and (pl.polcmd in ('*', p.cmd))
                          and (pl.polroles = '{0}' or 'authenticated'::regrole = any (pl.polroles::regrole[])))
  loop
    execute format('revoke %s on public.%I from authenticated', r.priv, r.relname);
  end loop;
end $$;
commit;
```

The loop is a draft: it is tested in the local stack before it becomes a migration file.

### Before applying

1. Write as a migration file plus an undo script (`GRANT` of exactly what was removed, produced from a before/after
   `aclexplode` snapshot). Take the snapshot of live grants first and keep it in `supabase/rollbacks/`.
2. New pgTAP test: no TRUNCATE/REFERENCES/TRIGGER for the two roles; no anon writes; and every existing write test
   still passes (the suite is 55 files / 1259 tests).
3. Apply with `execute_sql` (no DROP, so no approval pop-up), verify counts live, record in `schema_migrations`.
4. Smoke test after: sign up, post a job, place a bid, send a chat message, upload a truck, driver goes online.

## B. Demo edge functions

| | `quick-responder` | `smooth-handler` |
| --- | --- | --- |
| Status | ACTIVE, version 13 | ACTIVE, version 11 |
| What it does | Proxies OpenRouteService directions using the project's `ORS_API_KEY` secret | Returns "Hello <name>" |
| Who can call it | Anyone holding the **publishable** key (it is in the app bundle) | Same |
| Callers in the repo | None. `src/` and `supabase/functions/` (only `send-push`, `send-sms`) have no reference; only audit docs mention them | None |
| Dependencies | `ORS_API_KEY` function secret; nothing in the app reads that key | None |
| Production use | Edge-function logs could not be read through the available tool (table not exposed). Check **Dashboard → Edge Functions → each function → Logs / Invocations** for the last 24 h | Same |

Risk: `quick-responder` lets a stranger spend the owner's OpenRouteService quota. No data exposure.

Removal plan (owner does steps 2–4; I have no delete tool for functions):

1. Check Invocations for both functions. Expect zero from the app; anything else means someone is using them.
2. Dashboard → Edge Functions → delete `quick-responder`, then `smooth-handler`.
3. Rotate or delete the `ORS_API_KEY` secret at openrouteservice.org (it has only ever been used by that function).
4. Re-run `list_edge_functions`: only `send-push` and `send-sms` should remain. I will update CLAUDE.md.

## C. Leaked-password protection

- **Not available on the Free plan.** Supabase docs: "Leaked password protection is available on the Pro Plan and
  above" (checks passwords against the HaveIBeenPwned database). Pro is about 25 USD/month per organisation.
- **Free alternatives that exist today:**
  1. Dashboard → Authentication → Providers → Email: raise the minimum length (12 is a good target) and require
     lower case, upper case, digits and symbols. These are available on the Free plan.
  2. A check in the app: before sign-up and password change, send the first 5 characters of the password's SHA-1 to
     the free HaveIBeenPwned range API (the password never leaves the browser) and refuse a match. About one small
     function plus the two forms. I can build and test this on a branch if you want it.
- Not changing any setting or plan without your approval. Note that raising the minimum length affects only new and
  changed passwords; existing users can still sign in.
- The security advisor will keep showing this one warning on the Free plan; that is expected.

## D. Migration history (0072–0108)

Evidence: live `list_migrations` on 03/11, git file list on `main`, and the function-hash comparison of 24/10 and 26/10
(`docs/release/RELEASE-READINESS-2026-10-26.md` §2b: 97 of 106 functions identical; the 9 exceptions explained).
Re-hash before any repair (the repair is metadata only, but it should rest on fresh evidence).

| Range | Recorded in production | Schema state | Verdict |
| --- | --- | --- | --- |
| 0072–0076 | Yes, under different versions (20261007231311, 20261008045004/45240/45317/45551); git files are 20261007210000 … 20261008010000 | Live | A `db push` would try to run the git versions again. Needs repair. |
| 0077–0097 | No | Live (hash-verified 24/10) | Repair: mark applied. |
| 0098 | Yes, as 20261013093236; git 20261012300000 | Live | Needs repair (as 0072–0076). |
| 0099–0102 | No | Live | Repair: mark applied. |
| 0103 | Yes, 20261012350000 (applied 28/10) | Live | Fine. |
| 0104–0108 | No | Live | Repair: mark applied. |
| 0079 | n/a | `find_next_loads_for_driver` differs by one token (live-only edit); rest match | Owner decision: re-apply that one function or document the drift. |
| 0109–0112, 0114, 0115, 0117–0119, 0122–0127 | Yes, versions match git | Live | Fine. |
| 0113, 0116 | No | Not live; not on `main` (PRs #11, #18) | Do not mark. |
| 0120, 0121 | No | Not live (Payonify, PR #38, test stack only) | Do not mark. |

Why a repair and not a re-run: replaying 0072–0108 would redo money, trigger and policy changes that are already
live and later changed (for example 0077's `driver_profiles_guard_direct_write` was redefined by 0115). The repair
only edits the history table.

Proposed steps (owner approval needed, none run):

1. Save `select * from supabase_migrations.schema_migrations order by version;`.
2. Re-run the hash comparison for 0077–0108 against a fresh local build.
3. Repair with the Supabase CLI (needs the owner's login; works on the Free plan):
   `supabase migration repair --status applied <git versions of 0072–0076, 0077–0097, 0098, 0099–0102, 0104–0108>`
   and `--status reverted` for the six live-only versions (the full command list is in the 26/10 release doc §5).
   Alternative with no CLI: one `execute_sql` that inserts the missing git versions into `schema_migrations` and
   deletes the six live-only rows, after a before/after export.
4. `supabase migration list` should then show local = remote through 0127, except 0113, 0116, 0120, 0121.
5. Only then is `supabase db push` safe.

## Suggested order

1. A tiers 1–2 (one migration, tested, applied through `execute_sql`). Needs your go-ahead.
2. B: you check logs and delete the two functions; I verify.
3. D: repair, after a fresh hash check.
4. C: stronger password rules in the dashboard now; app-side leaked-password check if you want it.
5. A tier 3 later, as its own decision.
