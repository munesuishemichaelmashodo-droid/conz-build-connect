-- Undo 0173 (supabase/migrations/20261124130000_0173_provider_post_payout_recovery.sql). Run in the SQL editor (has DROP).
-- Refuses to run once any recovery exists or any ledger line uses the two 0173 accounts: then the money records
-- must be kept and handled by hand. Restores account_deletion_blockers() to the 0171 body and the 0171 account list.
begin;

-- Lock first, so no recovery or ledger line can be written between the checks below and the DROP.
lock table public.platform_ledger in share mode;
do $$
begin
  if to_regclass('public.driver_recoveries') is not null then
    execute 'lock table public.driver_recoveries in access exclusive mode';
  end if;
  if to_regclass('public.driver_recoveries') is not null and exists (select 1 from public.driver_recoveries) then
    raise exception 'driver_recoveries has rows: keep 0173, do not roll back';
  end if;
  if exists (select 1 from public.platform_ledger where account in ('driver_recoverable', 'platform_losses')) then
    raise exception 'ledger lines use the 0173 accounts: keep 0173, do not roll back';
  end if;
end $$;

create or replace function public.account_deletion_blockers(_uid uuid)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when auth.uid() is not null and auth.uid() is distinct from _uid then null else
  array_remove(array[
    case when exists (select 1 from public.wallets where user_id = _uid and balance > 0) then 'wallet_balance_positive' end,
    case when exists (select 1 from public.wallets where user_id = _uid and balance < 0) then 'wallet_balance_owed' end,
    case when exists (select 1 from public.wallets where user_id = _uid and held > 0) then 'commission_held' end,
    case when exists (select 1 from public.wallet_withdrawal_requests where user_id = _uid and status = 'pending') then 'withdrawal_pending' end,
    case when exists (select 1 from public.wallet_topup_requests where user_id = _uid and status = 'pending') then 'topup_pending' end,
    case when exists (select 1 from public.jobs where (customer_id = _uid or driver_id = _uid)
                        and status in ('open', 'accepted', 'in_progress')) then 'active_jobs' end,
    case when exists (select 1 from public.payments where user_id = _uid
                        and (status in ('paid', 'refund_due')
                             or (status = 'initiated' and created_at > now() - interval '72 hours'))) then 'payment_in_progress' end,
    case when exists (select 1 from public.disputes where (raised_by = _uid or against = _uid)
                        and status in ('open', 'investigating')) then 'open_disputes' end
    ,
    -- (0171) earnings still owed to a driver on provider-paid jobs
    case when exists (select 1 from public.driver_payables where driver_id = _uid
                       and status in ('payable', 'held', 'payout_pending')) then 'earnings_owed' end
  ], null) end
$$;


drop function if exists public.admin_close_driver_recovery(uuid, text, text, text);
drop function if exists public.admin_open_post_payout_refund(uuid, text);
drop trigger if exists trg_driver_recoveries_guard on public.driver_recoveries;
drop function if exists public.driver_recoveries_guard();
drop table if exists public.driver_recoveries;

alter table public.platform_ledger
  drop constraint if exists platform_ledger_account_check,
  add constraint platform_ledger_account_check check (account = any (array[
    'paynow_clearing'::text, 'manual_topups_clearing'::text, 'payouts_clearing'::text, 'escrow_held'::text,
    'refunds_payable'::text, 'user_wallets'::text, 'platform_revenue'::text, 'admin_adjustments'::text,
    'referral_expense'::text, 'opening_balance'::text,
    'provider_clearing'::text, 'job_funds_unsettled'::text, 'driver_payable'::text,
    'provider_refunds_payable'::text, 'provider_fees'::text
  ]));

delete from supabase_migrations.schema_migrations where version = '20261124130000';
commit;
