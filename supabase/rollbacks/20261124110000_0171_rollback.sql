-- Undo 0171 (provider-collected jobs). Run in the Supabase SQL editor (it contains DROP).
-- Restores the exact previous live definitions (hashes checked 24/11/2026):
--   driver_can_accept e221918f, driver_can_accept_for 11d4972e, hold_job_commission b8665cdc,
--   complete_job 8c8be3e3, driver_confirm_delivery_pin 88a16018, financial_reconciliation fdc30867,
--   account_deletion_blockers 2da2f549, payments_guard_transition 13eff04c
-- REFUSES to run if any provider-paid job, job payment, payable, payout or fee exists: real money records are never dropped.
begin;

do $$ begin
  if exists (select 1 from public.jobs where payment_method = 'provider')
     or exists (select 1 from public.payments where type = 'job_payment')
     or exists (select 1 from public.driver_payables)
     or exists (select 1 from public.driver_payouts)
     or exists (select 1 from public.provider_fees)
     or exists (select 1 from public.platform_ledger where account in ('provider_clearing','job_funds_unsettled','driver_payable','provider_refunds_payable','provider_fees')) then
    raise exception 'Provider money records exist; 0171 cannot be undone by script. Turn payment_provider back to "none" instead.';
  end if;
end $$;

-- 1. Previous function bodies
CREATE OR REPLACE FUNCTION public.hold_job_commission(_job_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _job  public.jobs;
  _rate numeric;
  _amt  numeric;
  _promo numeric;
  _bal numeric;
begin
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  if auth.uid() is not null
     and auth.uid() <> _job.customer_id
     and auth.uid() <> _job.driver_id
  then
    raise exception 'Not authorised to hold commission on this job.' using errcode = '42501';
  end if;

  if _job.held_commission is not null then
    return _job.held_commission;             -- already reserved
  end if;

  if not coalesce(
       (select first_job_free_used from public.driver_profiles
         where user_id = _job.driver_id), false) then
    update public.jobs set held_commission = 0 where id = _job_id;
    return 0;
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;
  if not (_rate >= 0 and _rate <= 100) then raise exception 'commission_rate is invalid'; end if;

  if not public.is_valid_money(coalesce(_job.final_price, _job.budget)) then
    raise exception 'Job % has an invalid price; commission cannot be reserved', _job_id;
  end if;

  _amt := public.commission_amount(coalesce(_job.final_price, _job.budget, 0), _rate);

  select least(_amt, coalesce(promo_balance, 0)) into _promo
    from public.wallets where user_id = _job.driver_id for update;
  if not found then
    raise exception 'Driver % has no wallet', _job.driver_id;
  end if;
  _promo := coalesce(_promo, 0);

  if _promo > 0 then
    update public.wallets
       set promo_balance = promo_balance - _promo, balance = balance + _promo, updated_at = now()
     where user_id = _job.driver_id returning balance into _bal;
    insert into public.wallet_transactions (user_id, type, amount, balance_after, job_id, note)
    values (_job.driver_id, 'adjustment', _promo, _bal, _job_id, 'Promotional credit reserved for commission (not cash)');
    insert into public.promo_credit_ledger (user_id, amount, kind, job_id, note)
    values (_job.driver_id, -_promo, 'reserve', _job_id, 'Reserved for the commission on this job');
    perform public.post_ledger('promo_credit_reserve',
      jsonb_build_array(
        jsonb_build_object('account', 'admin_adjustments', 'amount', _promo),
        jsonb_build_object('account', 'user_wallets', 'amount', -(_promo))),
      null, _job_id, _job.driver_id, 'Promotional credit reserved for commission (not cash)');
  end if;

  update public.wallets
     set held = coalesce(held, 0) + _amt, updated_at = now()
   where user_id = _job.driver_id;

  update public.jobs set held_commission = _amt, held_commission_promo = _promo where id = _job_id;
  return _amt;
end 
$function$;

CREATE OR REPLACE FUNCTION public.driver_can_accept(_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job  public.jobs;
  _rate numeric;
  _req  numeric;
  _bal  numeric;
  _held numeric;
  _promo numeric;
  _avail numeric;
  _free boolean;
  _has_profile boolean;
begin
  select * into _job from public.jobs where id = _job_id;
  if not found then raise exception 'Job not found'; end if;

  select first_job_free_used, true into _free, _has_profile
    from public.driver_profiles where user_id = auth.uid();

  if not coalesce(_has_profile, false) then
    return jsonb_build_object('ok', false, 'required', 0, 'balance', 0,
      'held', 0, 'available', 0, 'shortfall', 0,
      'free', false, 'reason', 'no_driver_profile');
  end if;

  select coalesce(balance,0), coalesce(held,0) + coalesce(withdrawal_reserved,0), coalesce(promo_balance,0)
    into _bal, _held, _promo
    from public.wallets where user_id = auth.uid();
  _bal  := coalesce(_bal, 0);
  _held := coalesce(_held, 0);
  _promo := coalesce(_promo, 0);
  _avail := _bal - _held + _promo;

  if _free is not true then
    return jsonb_build_object('ok', true, 'required', 0, 'balance', _bal,
      'held', _held, 'available', _avail, 'promo', _promo, 'shortfall', 0, 'free', true);
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;

  _req := public.commission_amount(coalesce(_job.final_price, _job.budget, 0), _rate);

  return jsonb_build_object(
    'ok', _avail >= _req, 'required', _req, 'balance', _bal,
    'held', _held, 'available', _avail, 'promo', _promo,
    'shortfall', greatest(0, _req - _avail), 'free', false);
end $function$;

CREATE OR REPLACE FUNCTION public.driver_can_accept_for(_job_id uuid, _driver_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job public.jobs; _rate numeric; _req numeric;
  _bal numeric; _held numeric; _avail numeric; _promo numeric;
  _free boolean; _has_profile boolean;
  _uid uuid := auth.uid();
begin
  select * into _job from public.jobs where id = _job_id;
  if not found then raise exception 'Job not found'; end if;

  if not coalesce((
       _uid = _driver_id
    or public.has_role(_uid, 'admin'::public.app_role)
    or public.has_role(_uid, 'super_admin'::public.app_role)
    or (_uid = _job.customer_id
        and exists (select 1 from public.bids b where b.job_id = _job_id and b.driver_id = _driver_id))
    or (_uid is null and auth.role() = 'service_role')
  ), false) then
    raise exception 'Not authorised to check this driver''s balance.' using errcode = '42501';
  end if;

  select first_job_free_used, true into _free, _has_profile
    from public.driver_profiles where user_id = _driver_id;
  if not coalesce(_has_profile, false) then
    return jsonb_build_object('ok', false, 'required', 0, 'available', 0,
      'reason', 'no_driver_profile');
  end if;

  select coalesce(balance,0), coalesce(held,0) + coalesce(withdrawal_reserved,0), coalesce(promo_balance,0)
    into _bal, _held, _promo
    from public.wallets where user_id = _driver_id;
  _avail := coalesce(_bal,0) - coalesce(_held,0) + coalesce(_promo,0);

  if _free is not true then
    return jsonb_build_object('ok', true, 'required', 0,
      'available', _avail, 'promo', coalesce(_promo,0), 'free', true);
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;

  _req := public.commission_amount(coalesce(_job.final_price, _job.budget, 0), _rate);

  return jsonb_build_object('ok', _avail >= _req, 'required', _req,
    'available', _avail, 'promo', coalesce(_promo,0), 'shortfall', greatest(0, _req - _avail), 'free', false);
end $function$;

create or replace function public.complete_job(_job_id uuid, _pin text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $fn$
declare _job public.jobs; _chk jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  if _job.customer_id <> auth.uid() then
    raise exception 'Only the customer can confirm completion';
  end if;
  -- Idempotent: a retry after the first success settles nothing a second time.
  if _job.status = 'completed' then
    return jsonb_build_object('ok', true, 'job_id', _job.id, 'already', true);
  end if;
  if _job.status not in ('accepted', 'in_progress') then
    raise exception 'Job not in progress';
  end if;
  if _pin is null or btrim(_pin) = '' then
    raise exception 'The delivery code is required to confirm delivery.';
  end if;

  _chk := public.delivery_proof_check(_job, _pin);
  if (_chk ->> 'ok')::boolean is not true then return _chk; end if;

  if _job.payment_method = 'escrow' then
    perform public.release_escrow_and_complete(_job_id, auth.uid());
  else
    perform public.settle_direct_pay_job(_job_id, auth.uid());
  end if;

  update public.job_delivery_pins set consumed_at = now() where job_id = _job_id;
  return jsonb_build_object('ok', true, 'job_id', _job_id);
end $fn$;

create or replace function public.driver_confirm_delivery_pin(_job_id uuid, _pin text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $fn$
declare _job public.jobs; _chk jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if _job.driver_id is distinct from auth.uid() then raise exception 'Not your job'; end if;
  if _job.status = 'completed' then
    return jsonb_build_object('ok', true, 'job_id', _job.id, 'already', true);
  end if;
  if _job.status not in ('accepted', 'in_progress') then raise exception 'Job not in progress'; end if;
  if _job.delivery_photo_url is null then raise exception 'Upload the delivery photo first'; end if;

  _chk := public.delivery_proof_check(_job, _pin);
  if (_chk ->> 'ok')::boolean is not true then return _chk; end if;

  if _job.payment_method = 'escrow' then
    perform public.release_escrow_and_complete(_job_id, auth.uid());
  else
    perform public.settle_direct_pay_job(_job_id, auth.uid());
  end if;

  update public.job_delivery_pins set consumed_at = now() where job_id = _job_id;
  return jsonb_build_object('ok', true, 'job_id', _job_id);
end $fn$;

CREATE OR REPLACE FUNCTION public.financial_reconciliation()
 RETURNS TABLE(check_name text, ok boolean, expected numeric, actual numeric, details jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- 1. Every ledger entry group balances.
  select 'ledger_groups_balanced', count(*) = 0, 0::numeric, count(*)::numeric,
         coalesce(jsonb_agg(g), '[]'::jsonb)
    from (select entry_group as g from public.platform_ledger group by entry_group having sum(amount) <> 0) x
  union all
  -- 2. Each wallet equals the sum of its own transactions.
  select 'wallets_match_transactions', count(*) = 0, 0, count(*)::numeric, coalesce(jsonb_agg(u), '[]'::jsonb)
    from (select w.user_id as u
            from public.wallets w
            left join public.wallet_transactions t on t.user_id = w.user_id
           group by w.user_id, w.balance
          having round(coalesce(sum(t.amount), 0), 2) <> round(w.balance, 2)) x
  union all
  -- 3. Platform ledger's view of user money equals the sum of wallet balances.
  select 'user_wallets_match_balances',
         (select coalesce(-sum(amount), 0) from public.platform_ledger where account = 'user_wallets')
           = (select coalesce(sum(balance), 0) from public.wallets),
         (select coalesce(sum(balance), 0) from public.wallets),
         (select coalesce(-sum(amount), 0) from public.platform_ledger where account = 'user_wallets'),
         '{}'::jsonb
  union all
  -- 4. Escrow liability equals paid (held) escrow payments.
  select 'escrow_held_matches_payments',
         (select coalesce(-sum(amount), 0) from public.platform_ledger where account = 'escrow_held')
           = (select coalesce(sum(amount), 0) from public.payments where type = 'escrow' and status = 'paid'),
         (select coalesce(sum(amount), 0) from public.payments where type = 'escrow' and status = 'paid'),
         (select coalesce(-sum(amount), 0) from public.platform_ledger where account = 'escrow_held'),
         '{}'::jsonb
  union all
  -- 5. Refunds owed equal refund_due payments.
  select 'refunds_payable_matches_payments',
         (select coalesce(-sum(amount), 0) from public.platform_ledger where account = 'refunds_payable')
           = (select coalesce(sum(amount), 0) from public.payments where type = 'escrow' and status = 'refund_due'),
         (select coalesce(sum(amount), 0) from public.payments where type = 'escrow' and status = 'refund_due'),
         (select coalesce(-sum(amount), 0) from public.platform_ledger where account = 'refunds_payable'),
         '{}'::jsonb
  union all
  -- 6. No top-up credited twice (legacy audit log or ledger).
  select 'topups_credited_once', count(*) = 0, 0, count(*)::numeric, coalesce(jsonb_agg(p), '[]'::jsonb)
    from (select (meta->>'payment_id') as p from public.wallet_audit_log
           where action = 'paynow_topup_credited' group by 1 having count(*) > 1
          union
          select payment_id::text from public.platform_ledger
           where kind = 'paynow_topup' and account = 'user_wallets' group by payment_id having count(*) > 1) x
  union all
  -- 7. No paid escrow stranded on a closed job.
  select 'no_stranded_escrow', count(*) = 0, 0, count(*)::numeric, coalesce(jsonb_agg(p.id), '[]'::jsonb)
    from public.payments p join public.jobs j on j.id = p.job_id
   where p.type = 'escrow' and p.status = 'paid' and j.status in ('cancelled', 'completed')
  union all
  -- 8. Each released escrow posted to the ledger exactly once (since 0074).
  select 'released_escrow_posted_once', count(*) = 0, 0, count(*)::numeric, coalesce(jsonb_agg(id), '[]'::jsonb)
    from (select p.id from public.payments p
           where p.type = 'escrow' and p.status = 'released' and p.updated_at > '2026-10-08'
             and (select count(distinct entry_group) from public.platform_ledger l
                   where l.payment_id = p.id and l.kind = 'escrow_released') <> 1) x
  union all
  -- 9. Held commission equals the commission reserved on the driver's active jobs.
  select 'held_commission_matches_jobs', count(*) = 0, 0, count(*)::numeric, coalesce(jsonb_agg(u), '[]'::jsonb)
    from (select w.user_id as u
            from public.wallets w
           where round(w.held, 2) <> round(coalesce((select sum(held_commission) from public.jobs j
                                                      where j.driver_id = w.user_id
                                                        and j.status in ('accepted', 'in_progress')), 0), 2)) x
  union all
  -- 10. Reserved withdrawal funds equal the sum of the user's pending withdrawal requests (0095).
  select 'withdrawal_reserved_matches_pending', count(*) = 0, 0, count(*)::numeric, coalesce(jsonb_agg(u), '[]'::jsonb)
    from (select w.user_id as u
            from public.wallets w
           where round(w.withdrawal_reserved, 2) <> round(coalesce((select sum(r.amount)
                    from public.wallet_withdrawal_requests r
                   where r.user_id = w.user_id and r.status = 'pending'), 0), 2)) x
  union all
  -- 11. Every failed payout was reversed exactly once.
  select 'failed_payouts_reversed_once', count(*) = 0, 0, count(*)::numeric, coalesce(jsonb_agg(id), '[]'::jsonb)
    from (select r.id from public.wallet_withdrawal_requests r
           where r.status = 'failed'
             and (select count(*) from public.wallet_transactions t
                   where t.user_id = r.user_id and t.type = 'withdrawal' and t.amount > 0
                     and t.note like '%' || r.id::text || '%') <> 1) x
$function$;


-- account_deletion_blockers as live before 0171 (hash 2da2f549, = 0083)
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
  ], null) end
$$;

-- payments_guard_transition as live before 0171 (hash 13eff04c, = 0073)
create or replace function public.payments_guard_transition()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.user_id   is distinct from old.user_id
     or new.job_id    is distinct from old.job_id
     or new.type      is distinct from old.type
     or new.amount    is distinct from old.amount
     or new.currency  is distinct from old.currency
     or new.method    is distinct from old.method
     or new.created_at is distinct from old.created_at
     or new.id        is distinct from old.id
  then
    raise exception 'Payment % identity fields are immutable', old.id using errcode = '42501';
  end if;

  if old.paynow_poll_url is not null and new.paynow_poll_url is distinct from old.paynow_poll_url then
    raise exception 'Payment % poll URL is already set', old.id using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if not (
         (old.status = 'initiated'  and new.status in ('paid','failed','cancelled'))
      or (old.status = 'paid'       and new.status in ('released','refund_due'))
      or (old.status = 'refund_due' and new.status = 'refunded')
    ) then
      raise exception 'Illegal payment status transition % -> % for payment %', old.status, new.status, old.id
        using errcode = '42501';
    end if;
    if new.status = 'paid' then new.paid_at := coalesce(new.paid_at, now()); end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

-- 2. Remove the 0171 objects
drop trigger if exists trg_jobs_provider_rules on public.jobs;
drop trigger if exists trg_jobs_provider_paid_before_trip on public.jobs;
drop trigger if exists trg_jobs_provider_cancelled on public.jobs;
drop trigger if exists trg_payments_provider_fields_guard on public.payments;
drop function if exists public.tg_jobs_provider_rules();
drop function if exists public.tg_jobs_provider_paid_before_trip();
drop function if exists public.tg_jobs_provider_cancelled();
drop function if exists public.payments_provider_fields_guard();
drop function if exists public.create_provider_job_payment(uuid, text, text);
drop function if exists public.apply_provider_payment(text, text, uuid, text, numeric, text, text, text);
drop function if exists public.settle_provider_job(uuid, uuid);
drop function if exists public.admin_mark_provider_refunded(uuid, text, text);
drop function if exists public.admin_set_payable_hold(uuid, boolean, text);
drop function if exists public.admin_reverse_provider_settlement(uuid, text);
drop function if exists public.payout_prepare(uuid, text, text);
drop function if exists public.payout_record_sent(uuid, text);
drop function if exists public.payout_record_result(uuid, text, text, text);
drop function if exists public.payout_retry(uuid);
drop function if exists public.record_provider_fee(text, text, text, numeric, text, uuid, uuid);
drop function if exists public.notify_finance_admins(text, text);
drop table if exists public.provider_fees;
drop table if exists public.driver_payouts;
drop table if exists public.driver_payables;
drop table if exists public.provider_payment_events;
drop function if exists public.provider_records_append_only();
drop function if exists public.driver_payables_guard();
drop function if exists public.driver_payouts_guard();
drop index if exists public.payments_provider_reference_key;
drop index if exists public.payments_one_open_job_payment;
alter table public.payments drop column if exists provider_reference;
alter table public.payments drop column if exists provider;
drop function if exists public.provider_collection_enabled();
drop function if exists public.provider_payouts_enabled();
delete from public.system_settings where key in ('payment_provider', 'payouts_enabled');

-- 3. Previous constraints
alter table public.jobs drop constraint if exists jobs_provider_no_credit_reserve;
alter table public.jobs
  drop constraint if exists jobs_payment_method_check,
  add constraint jobs_payment_method_check check (payment_method = any (array['direct'::text, 'escrow'::text]));
alter table public.platform_ledger
  drop constraint if exists platform_ledger_account_check,
  add constraint platform_ledger_account_check check (account = any (array['paynow_clearing'::text, 'manual_topups_clearing'::text,
    'payouts_clearing'::text, 'escrow_held'::text, 'refunds_payable'::text, 'user_wallets'::text, 'platform_revenue'::text,
    'admin_adjustments'::text, 'referral_expense'::text, 'opening_balance'::text]));

delete from supabase_migrations.schema_migrations where version = '20261124110000';
commit;
