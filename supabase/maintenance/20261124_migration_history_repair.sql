-- 24/11/2026: repair supabase_migrations.schema_migrations so the CLI history matches what is live.
-- METADATA ONLY. Changes no table, function, policy or data in public. Owner runs it in the SQL editor.
--
-- Why: migrations 0072-0102 and 0104-0108 (36 files) are live but were applied by hand under other
-- version numbers or not recorded at all, so `supabase db push` would try to re-run them on production.
-- Evidence (read-only, 24/11): all 136 functions those 36 files define exist live; CLAUDE.md 23-24/10
-- records body-hash matches. Six live-only versions (0072-0076 as applied 07-08/10, and 0098 as applied
-- 13/10) duplicate git files under other numbers.
--
-- Same plan as docs/release/RELEASE-READINESS-2026-10-26.md step 7, written as SQL so no CLI login is needed.
-- Undo: supabase/maintenance/20261124_migration_history_repair_undo.sql

begin;

-- 1. Keep a copy of the table as it was.
create table if not exists supabase_migrations.schema_migrations_backup_20261124 as
  select * from supabase_migrations.schema_migrations;

-- 2. Record the git versions as applied (no-op for any already present).
insert into supabase_migrations.schema_migrations (version, name) values
  ('20261007210000', '0072_financial_numeric_integrity'),
  ('20261007220000', '0073_payment_state_machine'),
  ('20261007230000', '0074_escrow_refund_lifecycle'),
  ('20261008000000', '0075_financial_request_immutability'),
  ('20261008010000', '0076_admin_money_controls'),
  ('20261008020000', '0077_kyc_protection'),
  ('20261008030000', '0078_pin_lockout_that_counts'),
  ('20261008040000', '0079_roles_and_job_visibility'),
  ('20261008050000', '0080_pricing_input_integrity'),
  ('20261008060000', '0081_account_deletion'),
  ('20261008070000', '0082_ledger_and_reconciliation'),
  ('20261008080000', '0083_security_invariants'),
  ('20261008090000', '0084_reconcile_live_only_objects'),
  ('20261008100000', '0085_second_audit_fixes'),
  ('20261008110000', '0086_commission_change_mfa'),
  ('20261010100000', '0087_material_sourcing_requests'),
  ('20261010110000', '0088_sourcing_workflow_integrity'),
  ('20261010120000', '0089_geographic_dispatch'),
  ('20261010130000', '0090_sourcing_quote_booking_radius'),
  ('20261010140000', '0091_flat_commission'),
  ('20261011200000', '0092_neutralise_level_commission_multiplier'),
  ('20261011210000', '0093_payment_audit_fixes'),
  ('20261012000000', '0094_withdrawal_payout_tracking'),
  ('20261012010000', '0095_wallet_reservation_failed_payout_limits'),
  ('20261012100000', '0096_delivery_proof_both_modes'),
  ('20261012200000', '0097_withdrawal_pin_recovery'),
  ('20261012300000', '0098_bridge_create_price_quote_for'),
  ('20261012310000', '0099_guard_photo_timestamps_and_sweep_proof'),
  ('20261012320000', '0100_fix_admin_set_diesel_price_audit_call'),
  ('20261012330000', '0101_stock_is_advisory'),
  ('20261012340000', '0102_decline_dispatch_offer'),
  ('20261012360000', '0104_job_supply_confirmation'),
  ('20261012370000', '0105_accept_dispatch_offer_lock_order'),
  ('20261013160000', '0106_long_haul_rate_round_trip'),
  ('20261013170000', '0107_mvp_launch_switches'),
  ('20261019230000', '0108_fix_budget_trigger_unassigned_loc')
on conflict (version) do nothing;

-- 3. Retire the six live-only duplicate versions (their objects are covered by the git versions above).
--    The rows stay in the backup table from step 1.
delete from supabase_migrations.schema_migrations
 where version in ('20261007231311','20261008045004','20261008045240','20261008045317','20261008045551','20261013093236');

-- 4. Check: expect 36 git versions present and 0 duplicates left.
select (select count(*) from supabase_migrations.schema_migrations
         where version in ('20261007210000','20261007220000','20261007230000','20261008000000','20261008010000','20261008020000','20261008030000','20261008040000','20261008050000','20261008060000','20261008070000','20261008080000','20261008090000','20261008100000','20261008110000','20261010100000','20261010110000','20261010120000','20261010130000','20261010140000','20261011200000','20261011210000','20261012000000','20261012010000','20261012100000','20261012200000','20261012300000','20261012310000','20261012320000','20261012330000','20261012340000','20261012360000','20261012370000','20261013160000','20261013170000','20261019230000')) as git_versions_recorded,
       (select count(*) from supabase_migrations.schema_migrations
         where version in ('20261007231311','20261008045004','20261008045240','20261008045317','20261008045551','20261013093236')) as duplicates_left;

commit;
