-- -----------------------------------------------------------------------------
-- 0173: provider-paid jobs: a refund after the driver has ALREADY been paid out (depends on 0171).
--
-- 0171's admin_reverse_provider_settlement() refuses once a payout has started, on purpose: the money has left
-- ConZ, so reversing the books would hide a real loss. This adds the smallest audited way to record that case:
--   * admin_open_post_payout_refund(job, reason): only for a job whose driver payout is CONFIRMED paid. The customer's
--     whole payment becomes a refund owed (paid with the existing admin_mark_provider_refunded); ConZ's commission
--     on that job is reversed; what the driver received is recorded as owed back to ConZ (driver_recoverable).
--   * admin_close_driver_recovery(recovery, 'repaid' | 'written_off', reference, reason): the driver paid it back
--     (money arrived at the provider: provider reference required), or ConZ writes it off as a loss.
-- Whole amounts only. Netting against the driver's future earnings is NOT automated: hold them with
-- admin_set_payable_hold and close the recovery as repaid once settled. Super admin + require_aal2 + reason +
-- admin_audit_log on every action, as 0171. Nothing here moves money or calls a provider; provider collection and
-- payouts stay OFF. Commission rule unchanged (7% of the total agreed deal, final_price).
--
-- The ledger account CHECK is widened (two new accounts) with DROP + ADD in ONE ALTER statement, the same pattern
-- as 0171; allow-listed in tests/unit/migration-hygiene.test.ts. Apply in the SQL editor, AFTER 0171.
-- Undo: supabase/rollbacks/20261124130000_0173_rollback.sql. Tests: supabase/tests/database/1070_provider_post_payout_recovery.test.sql
-- -----------------------------------------------------------------------------

alter table public.platform_ledger
  drop constraint if exists platform_ledger_account_check,
  add constraint platform_ledger_account_check check (account = any (array[
    'paynow_clearing'::text, 'manual_topups_clearing'::text, 'payouts_clearing'::text, 'escrow_held'::text,
    'refunds_payable'::text, 'user_wallets'::text, 'platform_revenue'::text, 'admin_adjustments'::text,
    'referral_expense'::text, 'opening_balance'::text,
    'provider_clearing'::text, 'job_funds_unsettled'::text, 'driver_payable'::text,
    'provider_refunds_payable'::text, 'provider_fees'::text,
    -- 0173
    'driver_recoverable'::text,        -- paid-out earnings a driver owes back after a refund (asset)
    'platform_losses'::text            -- recoveries ConZ wrote off (expense)
  ]));

create table if not exists public.driver_recoveries (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null unique references public.jobs(id),
  payable_id        uuid not null unique references public.driver_payables(id),
  payment_id        uuid not null references public.payments(id),
  driver_id         uuid not null,
  amount            numeric(12,2) not null check (amount > 0),
  status            text not null default 'open' check (status in ('open', 'repaid', 'written_off')),
  reason            text not null,
  outcome_reference text,
  closed_reason     text,
  opened_by         uuid not null,
  closed_by         uuid,
  created_at        timestamptz not null default now(),
  closed_at         timestamptz
);
create index if not exists driver_recoveries_driver_idx on public.driver_recoveries (driver_id, status);
-- One provider repayment reference closes at most one recovery (no reuse of a single repayment for two cases).
create unique index if not exists driver_recoveries_repaid_reference_uidx
  on public.driver_recoveries (lower(outcome_reference)) where status = 'repaid';
alter table public.driver_recoveries enable row level security;
revoke all on public.driver_recoveries from public, anon, authenticated;
grant select on public.driver_recoveries to authenticated, service_role;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'driver_recoveries' and policyname = 'driver_recoveries_read') then
    create policy driver_recoveries_read on public.driver_recoveries for select to authenticated
      using (driver_id = auth.uid() or public.has_role(auth.uid(), 'admin'::public.app_role)
             or public.has_role(auth.uid(), 'super_admin'::public.app_role));
  end if;
end $$;

create or replace function public.driver_recoveries_guard()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'driver_recoveries rows are never deleted' using errcode = '42501';
  end if;
  if new.job_id is distinct from old.job_id or new.payable_id is distinct from old.payable_id
     or new.payment_id is distinct from old.payment_id or new.driver_id is distinct from old.driver_id
     or new.amount is distinct from old.amount or new.reason is distinct from old.reason
     or new.opened_by is distinct from old.opened_by or new.created_at is distinct from old.created_at then
    raise exception 'Recovery % amount and identity are immutable', old.id using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (old.status = 'open' and new.status in ('repaid', 'written_off')) then
    raise exception 'Illegal recovery status transition % -> %', old.status, new.status using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.driver_recoveries_guard() from public, anon, authenticated;
create or replace trigger trg_driver_recoveries_guard
  before update or delete on public.driver_recoveries for each row execute function public.driver_recoveries_guard();

create or replace function public.admin_open_post_payout_refund(_job_id uuid, _reason text)
returns public.driver_recoveries language plpgsql security definer set search_path to 'public' as $$
declare _job public.jobs; _r public.driver_payables; _o public.driver_payouts; _p public.payments;
        _rec public.driver_recoveries; _lines jsonb;
begin
  if not public.has_role(auth.uid(), 'super_admin'::public.app_role) then
    raise exception 'Only a super admin can refund a paid-out job' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _reason is null or length(btrim(_reason)) < 10 then raise exception 'A reason of at least 10 characters is required'; end if;

  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if _job.payment_method is distinct from 'provider' or _job.status <> 'completed' then
    raise exception 'Only a completed provider-paid job can be refunded this way';
  end if;
  if _job.customer_id = auth.uid() or _job.driver_id = auth.uid() then
    raise exception 'You cannot refund a job you are part of' using errcode = '42501';
  end if;

  select * into _rec from public.driver_recoveries where job_id = _job_id;
  if found then return _rec; end if;                    -- idempotent

  select * into _r from public.driver_payables where job_id = _job_id for update;
  if not found then raise exception 'This job has no settlement'; end if;
  if _r.status in ('payable', 'held') then
    raise exception 'The driver has not been paid yet: use admin_reverse_provider_settlement instead';
  end if;
  if _r.status = 'reversed' then raise exception 'This settlement was already reversed'; end if;
  select * into _o from public.driver_payouts where payable_id = _r.id for update;
  if _r.status <> 'paid_out' or not found or _o.status <> 'paid' then
    raise exception 'The driver payout is not confirmed paid yet; check its status with the provider first';
  end if;
  select * into _p from public.payments where id = _r.payment_id for update;
  if _p.status <> 'released' then raise exception 'Payment is % and cannot be refunded here', _p.status; end if;

  update public.payments set status = 'refund_due' where id = _p.id;
  insert into public.driver_recoveries (job_id, payable_id, payment_id, driver_id, amount, reason, opened_by)
  values (_job.id, _r.id, _p.id, _r.driver_id, _r.amount, btrim(_reason), auth.uid())
  returning * into _rec;

  -- refund owed = what the driver received (now owed back) + ConZ's commission (reversed)
  _lines := jsonb_build_array(
    jsonb_build_object('account', 'provider_refunds_payable', 'amount', -_r.gross_amount),
    jsonb_build_object('account', 'driver_recoverable', 'amount', _r.amount));
  if _r.commission > 0 then _lines := _lines || jsonb_build_object('account', 'platform_revenue', 'amount', _r.commission); end if;
  perform public.post_ledger('post_payout_refund_opened', _lines, _p.id, _job.id, _r.driver_id,
    'Refund after payout: ' || btrim(_reason));
  perform public.log_admin_action(_action => 'post_payout_refund_opened', _reason => _reason, _target_id => _job.id,
    _target_user => _r.driver_id, _meta => jsonb_build_object('refund', _r.gross_amount, 'commission_reversed', _r.commission,
    'owed_by_driver', _r.amount, 'recovery_id', _rec.id));
  insert into public.notifications (user_id, type, title, body, job_id)
  values (_r.driver_id, 'earnings_recovery', 'Payment to be returned',
          'After review of a problem on this delivery, the customer is being refunded. Con Z will contact you about returning what you were paid for it.', _job.id);
  return _rec;
end $$;
revoke all on function public.admin_open_post_payout_refund(uuid, text) from public, anon;
grant execute on function public.admin_open_post_payout_refund(uuid, text) to authenticated;

create or replace function public.admin_close_driver_recovery(_recovery_id uuid, _outcome text, _reference text, _reason text)
returns public.driver_recoveries language plpgsql security definer set search_path to 'public' as $$
declare _rec public.driver_recoveries;
begin
  if not public.has_role(auth.uid(), 'super_admin'::public.app_role) then
    raise exception 'Only a super admin can close a recovery' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _outcome is null or _outcome not in ('repaid', 'written_off') then
    raise exception 'Outcome must be repaid or written_off';
  end if;
  if _reason is null or length(btrim(_reason)) < 5 then raise exception 'A reason is required'; end if;
  select * into _rec from public.driver_recoveries where id = _recovery_id for update;
  if not found then raise exception 'Recovery not found'; end if;
  if _rec.driver_id = auth.uid() then raise exception 'You cannot close your own recovery' using errcode = '42501'; end if;
  if _rec.status = _outcome then return _rec; end if;   -- idempotent
  if _rec.status <> 'open' then raise exception 'This recovery is already %', _rec.status; end if;
  if _outcome = 'repaid' and (_reference is null or length(btrim(_reference)) < 3) then
    raise exception 'Enter the provider reference of the driver''s repayment';
  end if;
  if _outcome = 'repaid' and exists (select 1 from public.driver_recoveries
       where status = 'repaid' and lower(outcome_reference) = lower(btrim(_reference))) then
    raise exception 'This provider reference was already used to close another recovery';
  end if;

  update public.driver_recoveries
     set status = _outcome, outcome_reference = nullif(btrim(coalesce(_reference, '')), ''),
         closed_reason = btrim(_reason), closed_by = auth.uid(), closed_at = now()
   where id = _rec.id returning * into _rec;
  perform public.post_ledger(case when _outcome = 'repaid' then 'driver_recovery_repaid' else 'driver_recovery_written_off' end,
    jsonb_build_array(
      jsonb_build_object('account', case when _outcome = 'repaid' then 'provider_clearing' else 'platform_losses' end, 'amount', _rec.amount),
      jsonb_build_object('account', 'driver_recoverable', 'amount', -_rec.amount)),
    _rec.payment_id, _rec.job_id, _rec.driver_id,
    case when _outcome = 'repaid' then 'Driver repaid, provider ref ' || btrim(_reference) else 'Written off: ' || btrim(_reason) end);
  perform public.log_admin_action(_action => 'driver_recovery_' || _outcome, _reason => _reason, _target_id => _rec.job_id,
    _target_user => _rec.driver_id, _meta => jsonb_build_object('amount', _rec.amount, 'recovery_id', _rec.id, 'reference', _rec.outcome_reference));
  return _rec;
end $$;
revoke all on function public.admin_close_driver_recovery(uuid, text, text, text) from public, anon;
grant execute on function public.admin_close_driver_recovery(uuid, text, text, text) to authenticated;

-- Account deletion also waits while a driver owes a recovery (identical to 0171 + one case).
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
    ,
    -- (0173) money a driver still owes back after a refund on a job they were already paid for
    case when exists (select 1 from public.driver_recoveries where driver_id = _uid and status = 'open') then 'recovery_open' end
  ], null) end
$$;

