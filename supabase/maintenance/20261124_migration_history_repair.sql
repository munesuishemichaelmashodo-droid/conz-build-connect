-- 24/11/2026: repair supabase_migrations.schema_migrations so the CLI history matches what is live.
-- METADATA ONLY: touches supabase_migrations.schema_migrations and creates one backup table beside it.
-- No table, function, policy or row in public is changed. NEVER run by an agent or CI: the owner runs it
-- by hand in the Supabase SQL editor after reading supabase/maintenance/20261124_MIGRATION_STATUS.md.
--
-- WHY: 36 git migrations (0072-0102, 0104-0108) are live, but production recorded them under six other
-- version numbers (0072-0076 applied 07-08/10, 0098 applied 13/10) or not at all, so `supabase db push`
-- would try to run them again. This records the 36 git versions and retires the six stand-in rows.
--
-- MODES (edit the one line `c_mode constant text := ...` below; nothing else needs editing):
--   'check'   READ-ONLY. Runs every precondition and reports. The transaction is switched to read-only, so
--             even a bug in this file cannot write. Run this first, as often as you like.
--   'dry_run' Does the whole repair (backup, verify, insert, delete, post-checks) and then deliberately
--             fails with "DRY RUN OK", which rolls everything back. Nothing is kept, not even the backup.
--   'apply'   Does the repair and commits. Run only after 'check' and 'dry_run' both pass.
-- The file ships in 'check' mode.
--
-- FAILS SAFE: every check raises an exception, which aborts the transaction; the final COMMIT then has
-- nothing to commit. The script refuses to run if:
--   * the backup table name below already exists (it never reuses or overwrites an old backup);
--   * any of the 36 git versions is already recorded (someone already repaired or pushed: stop and look);
--   * any of the six stand-in versions is missing (history is not in the state this was written for);
--   * any of the 136 functions those 36 files define is missing from public (the files would not be
--     "already applied" after all);
--   * a column other than version/name is NOT NULL without a default (the CLI changed its table);
--   * the backup's row count or content checksum differs from the source after copying;
--   * the insert or delete touches a different number of rows than expected (36 / 6);
--   * the final row count is not (rows before + 30).
-- The table is locked against concurrent writers (e.g. a CLI push) for the duration in dry_run/apply.
--
-- BACKUP: supabase_migrations.schema_migrations_backup_20261124_repair, a full copy of the table taken
-- inside the same transaction, checked by row count and an md5 over every row (ordered by version). The
-- count and checksum are written into the table's COMMENT so they can be re-verified later. Keep it until
-- `supabase migration list` has been checked and at least one later migration applied cleanly.
--
-- RECOVERY: supabase/maintenance/20261124_migration_history_repair_undo.sql (same three modes). It removes
-- only the 36 rows this script added and restores only the six rows it removed, from the backup above, so
-- any version recorded after the repair (0170, 0171, ...) is kept. If the repair failed part-way there is
-- nothing to recover: the transaction rolled back.

begin;

do $repair$
declare
  c_mode   constant text := 'check';                 -- 'check' | 'dry_run' | 'apply'
  c_backup constant text := 'schema_migrations_backup_20261124_repair';
  v_git    constant text[] :=
    array['20261007210000','20261007220000','20261007230000','20261008000000','20261008010000','20261008020000','20261008030000','20261008040000','20261008050000','20261008060000','20261008070000','20261008080000','20261008090000','20261008100000','20261008110000','20261010100000','20261010110000','20261010120000','20261010130000','20261010140000','20261011200000','20261011210000','20261012000000','20261012010000','20261012100000','20261012200000','20261012300000','20261012310000','20261012320000','20261012330000','20261012340000','20261012360000','20261012370000','20261013160000','20261013170000','20261019230000'];
  v_names  constant text[] :=
    array['0072_financial_numeric_integrity','0073_payment_state_machine','0074_escrow_refund_lifecycle','0075_financial_request_immutability','0076_admin_money_controls','0077_kyc_protection','0078_pin_lockout_that_counts','0079_roles_and_job_visibility','0080_pricing_input_integrity','0081_account_deletion','0082_ledger_and_reconciliation','0083_security_invariants','0084_reconcile_live_only_objects','0085_second_audit_fixes','0086_commission_change_mfa','0087_material_sourcing_requests','0088_sourcing_workflow_integrity','0089_geographic_dispatch','0090_sourcing_quote_booking_radius','0091_flat_commission','0092_neutralise_level_commission_multiplier','0093_payment_audit_fixes','0094_withdrawal_payout_tracking','0095_wallet_reservation_failed_payout_limits','0096_delivery_proof_both_modes','0097_withdrawal_pin_recovery','0098_bridge_create_price_quote_for','0099_guard_photo_timestamps_and_sweep_proof','0100_fix_admin_set_diesel_price_audit_call','0101_stock_is_advisory','0102_decline_dispatch_offer','0104_job_supply_confirmation','0105_accept_dispatch_offer_lock_order','0106_long_haul_rate_round_trip','0107_mvp_launch_switches','0108_fix_budget_trigger_unassigned_loc'];
  v_stand_ins constant text[] :=
    array['20261007231311','20261008045004','20261008045240','20261008045317','20261008045551','20261013093236'];
  v_functions constant text[] := array[
      '_launch_setting_bool','_launch_setting_num','accept_bid','accept_counter','accept_dispatch_offer',
      'account_deletion_blockers','admin_apply_wallet_change','admin_approve_topup',
      'admin_approve_withdrawal','admin_credit_wallet','admin_decide_pin_recovery',
      'admin_decide_wallet_credit','admin_grant_role','admin_list_sourcing_requests',
      'admin_mark_escrow_refunded','admin_mark_withdrawal_failed','admin_mark_withdrawal_paid',
      'admin_money_guard','admin_money_setting','admin_reconciliation_report','admin_referral_action',
      'admin_reject_withdrawal','admin_request_wallet_credit','admin_set_commission','admin_set_diesel_price',
      'admin_set_money_controls','admin_sourcing_history','admin_start_sourcing','admin_wallet_adjust',
      'admin_wallet_reverse','anonymize_deleted_account','append_only_guard','apply_paynow_result',
      'auto_release_escrow_payments','cancel_job','cancel_pin_recovery','cancel_withdrawal',
      'check_withdrawal_pin','commission_amount','complete_job','complete_pin_recovery',
      'compute_material_offer','confirm_job_supply','consume_price_quote','count_available_verified_drivers',
      'counter_bid','create_dispatch_wave','create_material_sourcing_request','create_price_quote_for',
      'credit_wallet_from_payment','decline_dispatch_offer','decline_sourcing_request','delivery_proof_check',
      'dispatch_stage_for','dispatch_stage_minutes','dispatch_stage_radii','driver_available_jobs',
      'driver_can_accept','driver_can_accept_for','driver_confirm_delivery_pin','driver_dashboard_summary',
      'driver_level_commission_multiplier','driver_profiles_guard_direct_write','eligible_dispatch_drivers',
      'escrow_mark_refund_due','escrow_refund_due_for_job','expire_sourcing_requests',
      'expire_stale_accepted_jobs','expire_stale_paynow_payment','expire_unsent_paynow_payments',
      'financial_reconciliation','financial_request_guard','find_next_loads_for_driver',
      'get_my_delivery_pin_expiry','get_public_tracking','harare_day_start','hold_job_commission',
      'is_valid_money','is_verified_driver','issue_sourcing_quote','job_has_delivery_evidence',
      'jobs_guard_insert','jobs_guard_photo_times','jobs_rotate_tracking_token','launch_switches',
      'ledger_post_referral_reward','mark_escrow_payment_paid','my_sourcing_history','new_delivery_pin',
      'notify_kyc_reverification','notify_payment_anomaly','payment_events_immutable',
      'payments_guard_transition','payments_prevent_delete','payments_topup_rate_limit',
      'paynow_pending_for_reconcile','pin_lock_duration','platform_ledger_immutable','post_ledger',
      'price_quote_for_job','raise_dispute','raise_job_budget','record_payment_event',
      'regenerate_delivery_pin','release_escrow_and_complete','request_paynow_reconcile',
      'request_pin_recovery','request_topup','request_withdrawal','require_aal2','resolve_dispute',
      'resolve_material_source_candidates','run_financial_reconciliation','set_withdrawal_pin',
      'settle_direct_pay_job','sourcing_notify','sourcing_quote_authorizes_booking','sourcing_require_admin',
      'sourcing_transition_allowed','supply_stock_status','tg_enforce_launch_bid_limit',
      'tg_enforce_launch_job_limits','tg_enforce_topup_limits','tg_enforce_withdrawals_paused',
      'tg_generate_delivery_pin','tg_sourcing_guard','tg_sourcing_history_immutable',
      'tg_sourcing_history_write','tg_sourcing_mark_converted','tg_validate_job_budget',
      'tg_withdrawal_after_pin_reset','tg_withdrawal_payout_stepup','verified_quote_supply_for_job',
      'wallet_available','wallets_limited_follows_balance','withdrawal_pin_failure_result'
  ];
  v_rows_before bigint;
  v_src_count bigint; v_src_md5 text;
  v_bak_count bigint; v_bak_md5 text;
  v_list text[];
  n bigint;
begin
  if c_mode not in ('check', 'dry_run', 'apply') then
    raise exception 'STOP: c_mode must be check, dry_run or apply (got %)', c_mode;
  end if;
  if array_length(v_git, 1) <> 36 or array_length(v_names, 1) <> 36 or array_length(v_functions, 1) <> 136 then
    raise exception 'STOP: the lists in this file were edited (expected 36 versions, 36 names, 136 functions)';
  end if;

  if c_mode = 'check' then
    perform set_config('transaction_read_only', 'on', true);
  else
    lock table supabase_migrations.schema_migrations in share row exclusive mode;
  end if;

  -- P1. The table has the shape this file expects.
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'STOP: supabase_migrations.schema_migrations does not exist';
  end if;
  select array_agg(column_name::text order by column_name) into v_list
    from information_schema.columns
   where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'
     and column_name not in ('version', 'name') and is_nullable = 'NO' and column_default is null;
  if v_list is not null then
    raise exception 'STOP: schema_migrations has required columns this file does not fill: %', v_list;
  end if;

  -- P2. Never reuse an existing backup.
  if to_regclass('supabase_migrations.' || c_backup) is not null then
    raise exception 'STOP: backup table supabase_migrations.% already exists. A previous run left it. Do not delete it blindly: check whether that run was applied (see the undo file), then rename it before trying again.', c_backup;
  end if;

  -- P3. None of the 36 git versions is recorded yet.
  select array_agg(version::text order by version) into v_list
    from supabase_migrations.schema_migrations where version = any (v_git);
  if v_list is not null then
    raise exception 'STOP: % of the 36 git versions are already recorded (%). Repair already applied or history changed; stop and investigate.', array_length(v_list, 1), v_list;
  end if;

  -- P4. All six stand-in versions are recorded, once each.
  select count(*) into n from supabase_migrations.schema_migrations where version = any (v_stand_ins);
  if n <> 6 then
    raise exception 'STOP: expected the 6 stand-in versions to be recorded, found %', n;
  end if;

  -- P5. Everything those 36 files define is live (by function name, in public).
  select array_agg(f order by f) into v_list
    from unnest(v_functions) f
   where not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                      where s.nspname = 'public' and p.proname = f);
  if v_list is not null then
    raise exception 'STOP: % functions defined by the 36 files are missing live: %', array_length(v_list, 1), v_list;
  end if;

  select count(*), md5(coalesce(string_agg(t::text, E'\n' order by t.version), ''))
    into v_rows_before, v_src_md5 from supabase_migrations.schema_migrations t;
  raise notice 'PREFLIGHT OK (mode %): % rows recorded; 0 of 36 git versions present; 6 of 6 stand-ins present; 136 of 136 functions live; source md5 %',
    c_mode, v_rows_before, v_src_md5;

  if c_mode = 'check' then
    return;
  end if;

  -- B1. Backup, then B2. prove it is complete.
  execute format('create table supabase_migrations.%I as select * from supabase_migrations.schema_migrations', c_backup);
  execute format('select count(*), md5(coalesce(string_agg(t::text, E''\n'' order by t.version), '''')) from supabase_migrations.%I t', c_backup)
    into v_bak_count, v_bak_md5;
  if v_bak_count <> v_rows_before or v_bak_md5 <> v_src_md5 then
    raise exception 'STOP: backup incomplete (rows % vs %, md5 % vs %)', v_bak_count, v_rows_before, v_bak_md5, v_src_md5;
  end if;
  execute format('comment on table supabase_migrations.%I is %L', c_backup,
    format('Pre-repair copy of schema_migrations, taken %s by 20261124_migration_history_repair.sql. rows=%s md5=%s',
           now(), v_bak_count, v_bak_md5));
  execute format('revoke all on supabase_migrations.%I from public', c_backup);

  -- R1. Record the 36 git versions (no ON CONFLICT: P3 proved none exist; a conflict now is an error).
  insert into supabase_migrations.schema_migrations (version, name)
  select g, nm from unnest(v_git, v_names) as u(g, nm);
  get diagnostics n = row_count;
  if n <> 36 then raise exception 'STOP: inserted % rows, expected 36', n; end if;

  -- R2. Retire the six stand-ins (they stay in the backup).
  delete from supabase_migrations.schema_migrations where version = any (v_stand_ins);
  get diagnostics n = row_count;
  if n <> 6 then raise exception 'STOP: deleted % rows, expected 6', n; end if;

  -- R3. Post-checks.
  select count(*) into n from supabase_migrations.schema_migrations;
  if n <> v_rows_before + 30 then
    raise exception 'STOP: % rows after repair, expected % (before + 36 - 6)', n, v_rows_before + 30;
  end if;
  select count(*) into n from supabase_migrations.schema_migrations where version = any (v_git);
  if n <> 36 then raise exception 'STOP: % git versions recorded after repair, expected 36', n; end if;
  execute format('select count(*) from supabase_migrations.%I where version = any ($1)', c_backup) into n using v_stand_ins;
  if n <> 6 then raise exception 'STOP: backup holds % stand-in rows, expected 6', n; end if;

  if c_mode = 'dry_run' then
    raise exception 'DRY RUN OK: every check passed; rows would go % -> %. Nothing was kept (this error rolls the transaction back, including the backup). Set c_mode to apply to run it for real.',
      v_rows_before, v_rows_before + 30;
  end if;

  raise notice 'APPLIED: rows % -> %; backup supabase_migrations.% (rows %, md5 %). Next: supabase migration list.',
    v_rows_before, v_rows_before + 30, c_backup, v_bak_count, v_bak_md5;
end
$repair$;

commit;
