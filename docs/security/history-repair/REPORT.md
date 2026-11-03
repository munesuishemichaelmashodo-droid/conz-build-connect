# Migration history repair: verification and plan (03/11/2026)

Status: **prepared and tested locally; not applied.** Production was only read.

## 1. Fresh check: production functions vs git (done 03/11, just before preparing this)

Method: for all 249 functions in `public`, MD5 of the full definition with whitespace removed, production vs a local
database built from `main` (comments ignored in the second pass, because the live copies of 0114, 0115 and 0127 were applied
with their comment-only lines stripped).

| Result | Count | Detail |
| --- | --- | --- |
| Identical | 246 | includes everything from 0072–0127, `handle_new_user`, `driver_profiles_guard_direct_write`, the 0114 triggers |
| Different | 3 | below |

| Function | Difference | Action |
| --- | --- | --- |
| `find_next_loads_for_driver` | the known 0079 live-only edit (`cos(radians(c.delivery_lat))` instead of `_anchor_lat`) | **Preserved.** Not re-applied. Only affects the "good / possible" label on next-load suggestions. |
| `generate_mfa_recovery_codes`, `redeem_mfa_recovery_code` | live `search_path = public, extensions`; git `public`. Live is the one that works (`crypt` / `gen_salt` live in `extensions`). Client EXECUTE has been revoked since 0061 and the app doesn't call them | New finding, harmless. Leave as is; if the files are ever regenerated, take the live text. |

## 2. Finding: the gap is wider than 0072–0108

| | Count |
| --- | --- |
| Rows recorded in production | 149 |
| Git versions on `main` (files 149, two share `20260801202844`) | 148 |
| In both | 40 |
| Git versions not recorded | 108 (43 files before the 13/08 baseline, the baseline itself, 0035–0057 era, 0072–0108 range, and so on) |
| Recorded rows with no git file | 109 (67 from 01–13/08 that the baseline replaced, 42 recorded under other versions: 0035–0057 era, 0072–0076 and 0098) |

So repairing only 0072–0108 would not make `supabase db push` safe. Either repair everything (below), or keep the current
rule: **never run `supabase db push`; apply with `execute_sql` and record the version by hand** (this is how every
migration since 24/10 went live). Nothing is lost by doing nothing.

## 3. The repair (optional)

`repair.sql`, one transaction, metadata only:

1. Aborts unless production still has exactly 149 rows.
2. Copies the table to `supabase_migrations.schema_migrations_backup_20261103`.
3. Deletes the 109 rows with no git file; inserts the 108 missing git versions (name from the file name).
4. Aborts (changes nothing) unless deleted = 109, inserted = 108 and the final count is 148.

Not marked as applied: 0113, 0116, 0120, 0121 (not on `main`, not live) and 0128 (until applied). 0079 is untouched.
No migration is re-run and no schema object changes.

| | Before | After |
| --- | --- | --- |
| Rows | 149 | 148 |
| Versions equal to git | 40 | 148 |
| `supabase migration list` | 108 local-only, 109 remote-only | in sync (0128 shows as pending until applied) |

### Tested recovery

Tested on a scratch local database shaped like production (same columns, 149 rows: 40 shared, 42 live-only post-baseline, 67 pre-baseline):

- `repair.sql`: 149 to 148 rows; the version list equals the git list exactly.
- Running it a second time is refused ("History changed since the 03/11 report").
- `restore.sql`: back to 149 rows, and the MD5 of version+name equals the original.

To undo on production: run `restore.sql` (needs the backup table; it refuses to run without it).

### Before applying

1. Re-run the row count (must still be 149) and re-run the function check in section 1.
2. Owner approval.
3. Apply `repair.sql` with `execute_sql`; verify the count is 148 and `restore.sql` is ready.
