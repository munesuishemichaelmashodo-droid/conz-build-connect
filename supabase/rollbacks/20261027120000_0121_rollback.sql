-- Undo 0121_driver_auto_payouts. Contains DROP: run it in the Supabase SQL editor, not via the MCP.
-- Before running: make sure no payout is 'sending' or 'sent' (check the Payonify dashboard for those),
-- and keep a copy of public.driver_payouts if it has rows; wallet transactions and ledger entries it
-- wrote stay (they are the record of money that moved).
begin;
drop trigger if exists payments_queue_driver_payout on public.payments;
drop function if exists public.tg_queue_driver_payout();
drop function if exists public.admin_retry_payout(uuid, text);
drop function if exists public.payout_record_result(uuid, text, text, text, text, integer, numeric);
drop function if exists public.payout_record_sent(uuid, text, numeric);
drop function if exists public.payout_due_lookups(integer, boolean);
drop function if exists public.payout_claim_next(integer, boolean);
drop function if exists public.set_payout_ecocash_number(text, text);
drop function if exists public.payout_release_waiting(uuid);
drop function if exists public._payout_return(public.driver_payouts, text);
drop function if exists public._payout_debit(public.driver_payouts);
drop table if exists public.driver_payouts;
drop function if exists public.normalize_zw_mobile(text);
alter table public.driver_profiles drop constraint if exists driver_profiles_payout_number_format;
alter table public.driver_profiles drop column if exists payout_number_changed_at;
alter table public.driver_profiles drop column if exists payout_ecocash_number;
commit;
