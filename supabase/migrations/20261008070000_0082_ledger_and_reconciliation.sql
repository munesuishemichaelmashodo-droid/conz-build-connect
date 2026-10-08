-- =============================================================================
-- 0082 — Complete platform ledger + financial reconciliation (audit F9 / ledger)
-- =============================================================================
--
-- Goal: answer "where did every dollar come from, where is it now, why did
-- every balance change", and detect (never auto-fix) discrepancies.
--
-- Before: platform_ledger (0074) covered escrow and admin adjustments only.
-- Paynow top-ups, manual top-up approvals, withdrawals, direct-pay commission,
-- dispute commission refunds and referral rewards moved wallet money with no
-- platform-level record, and there was no reconciliation at all.
--
-- This migration:
--   1. Adds ledger accounts manual_topups_clearing and referral_expense.
--   2. Posts every remaining wallet movement (bodies = current definitions +
--      a marked "Ledger (0082)" posting):
--        paynow_topup               paynow_clearing        / user_wallets
--        manual_topup               manual_topups_clearing / user_wallets
--        withdrawal_paid            user_wallets           / payouts_clearing
--        direct_commission          user_wallets           / platform_revenue
--        dispute_commission_refund  platform_revenue       / user_wallets
--        referral_reward (trigger)  referral_expense       / user_wallets
--   3. Opening balances: one opening_balance / user_wallets entry per existing
--      non-zero wallet, so that -Σ(user_wallets) = Σ(wallets.balance) holds
--      from day one.
--   4. financial_reconciliation(): read-only checks; run_financial_reconciliation()
--      stores the result in reconciliation_runs and alerts super admins on any
--      discrepancy; pg_cron runs it daily at 02:00 Harare.
-- =============================================================================

alter table public.platform_ledger drop constraint if exists platform_ledger_account_check;
alter table public.platform_ledger add constraint platform_ledger_account_check check (account in (
  'paynow_clearing', 'manual_topups_clearing', 'payouts_clearing', 'escrow_held', 'refunds_payable',
  'user_wallets', 'platform_revenue', 'admin_adjustments', 'referral_expense', 'opening_balance'));

-- Referral rewards are inserted by process_referral_lifecycle / admin_referral_action
-- as type 'referral_bonus' (always a credit). Post them centrally.
create or replace function public.ledger_post_referral_reward()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.amount > 0 then
    perform public.post_ledger('referral_reward',
      jsonb_build_array(
        jsonb_build_object('account', 'referral_expense', 'amount',  new.amount),
        jsonb_build_object('account', 'user_wallets',     'amount', -new.amount)),
      null, new.job_id, new.user_id, coalesce(new.note, 'Referral reward'));
  end if;
  return new;
end $$;
drop trigger if exists trg_ledger_referral_reward on public.wallet_transactions;
create trigger trg_ledger_referral_reward
  after insert on public.wallet_transactions
  for each row when (new.type = 'referral_bonus')
  execute function public.ledger_post_referral_reward();

-- Opening balances (live: 5 wallets, all reconcile with their transactions).
do $$
declare _w record;
begin
  for _w in select user_id, balance from public.wallets where balance <> 0 loop
    perform public.post_ledger('opening_balance',
      jsonb_build_array(
        jsonb_build_object('account', 'opening_balance', 'amount',  _w.balance),
        jsonb_build_object('account', 'user_wallets',    'amount', -_w.balance)),
      null, null, _w.user_id, 'Wallet balance when the platform ledger started');
  end loop;
end $$;


CREATE OR REPLACE FUNCTION public.credit_wallet_from_payment(_payment_id uuid)
 RETURNS wallets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _p public.payments;
  _new_bal numeric;
  _w public.wallets;
begin
  select * into _p from public.payments where id = _payment_id for update;
  if not found then raise exception 'Payment not found'; end if;

  -- idempotent: safe to call more than once for the same payment
  if _p.status = 'paid' then
    select * into _w from public.wallets where user_id = _p.user_id;
    return _w;
  end if;

  -- F3: only a payment still awaiting its result can be credited. A failed /
  -- cancelled one is never credited here (late successes are flagged for an
  -- admin by apply_paynow_result instead).
  if _p.status <> 'initiated' then
    raise exception 'Payment % is % and cannot be credited', _payment_id, _p.status;
  end if;

  if _p.type <> 'topup' then
    raise exception 'Payment % is not a topup', _payment_id;
  end if;

  -- wallets.balance has no currency. Until it does, a ZWG payment
  -- would silently inflate a USD balance. Fail loudly instead.
  if coalesce(_p.currency, 'USD') <> 'USD' then
    raise exception 'Only USD top-ups are supported (payment % is %)',
      _payment_id, _p.currency;
  end if;

  if not public.is_valid_money(_p.amount) then
    raise exception 'Payment % has an invalid amount', _payment_id;
  end if;

  insert into public.wallets(user_id, balance) values (_p.user_id, 0)
    on conflict (user_id) do nothing;

  update public.wallets
     set balance = balance + _p.amount, updated_at = now(), limited = false
   where user_id = _p.user_id
  returning balance into _new_bal;

  insert into public.wallet_transactions(user_id, type, amount, balance_after, note, created_by)
  values (_p.user_id, 'topup', _p.amount, _new_bal,
          format('Paynow top-up (ref %s)', coalesce(_p.paynow_reference, '-')),
          _p.user_id);
  -- Ledger (0082)
  perform public.post_ledger('paynow_topup',
    jsonb_build_array(
      jsonb_build_object('account', 'paynow_clearing', 'amount',  _p.amount),
      jsonb_build_object('account', 'user_wallets', 'amount', -(_p.amount))),
    _p.id, null, _p.user_id, 'Paynow top-up');

  update public.payments set status = 'paid', updated_at = now() where id = _payment_id;

  insert into public.wallet_audit_log(user_id, actor_id, action, meta)
  values (_p.user_id, _p.user_id, 'paynow_topup_credited',
          jsonb_build_object('payment_id', _payment_id, 'amount', _p.amount,
                             'currency', _p.currency));

  insert into public.notifications(user_id, type, title, body)
  values (_p.user_id, 'wallet_topup', 'Top-up successful',
          format('$%s added to your wallet via Paynow.', _p.amount::text));

  select * into _w from public.wallets where user_id = _p.user_id;
  return _w;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_approve_topup(_id uuid)
 RETURNS wallets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _r public.wallet_topup_requests; _new_bal numeric; _w public.wallets;
begin
  -- F5: approving a top-up credits a wallet, so it is a super_admin + MFA action.
  if not public.has_role(auth.uid(),'super_admin') then raise exception 'Only a super admin can approve top-ups' using errcode = '42501'; end if;
  perform public.require_aal2();
  select * into _r from public.wallet_topup_requests where id=_id for update;
  if _r is null then raise exception 'Request not found'; end if;
  if _r.user_id = auth.uid() then raise exception 'You cannot approve your own top-up.'; end if;
  if _r.status = 'approved' then select * into _w from public.wallets where user_id=_r.user_id; return _w; end if;
  if _r.status <> 'pending' then raise exception 'Request not pending'; end if;
  insert into public.wallets(user_id, balance) values (_r.user_id, 0) on conflict (user_id) do nothing;
  update public.wallets set balance = balance + _r.amount, updated_at=now(), limited=false where user_id=_r.user_id returning balance into _new_bal;
  insert into public.wallet_transactions(user_id,type,amount,balance_after,note,created_by)
    values (_r.user_id,'topup',_r.amount,_new_bal, format('Top-up via %s (ref %s)',_r.method,coalesce(_r.reference,'-')), auth.uid());
  -- Ledger (0082)
  perform public.post_ledger('manual_topup',
    jsonb_build_array(
      jsonb_build_object('account', 'manual_topups_clearing', 'amount',  _r.amount),
      jsonb_build_object('account', 'user_wallets', 'amount', -(_r.amount))),
    null, null, _r.user_id, format('Manual top-up %s via %s', _r.id, _r.method));
  update public.wallet_topup_requests set status='approved', decided_by=auth.uid(), decided_at=now() where id=_id;
  insert into public.wallet_audit_log(user_id,actor_id,action,meta)
    values (_r.user_id,auth.uid(),'topup_approved', jsonb_build_object('id',_id,'amount',_r.amount,'new_balance',_new_bal));
  perform public.log_admin_action('topup_approved', jsonb_build_object('id', _id, 'amount', _r.amount, 'method', _r.method), null, _id, _r.user_id);
  insert into public.notifications(user_id,type,title,body)
    values (_r.user_id,'wallet_topup','Top-up approved', format('$%s added to your wallet.',_r.amount::text));
  select * into _w from public.wallets where user_id=_r.user_id; return _w;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_approve_withdrawal(_id uuid)
 RETURNS wallets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _r public.wallet_withdrawal_requests; _new_bal numeric; _w public.wallets;
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'super_admin')) then raise exception 'Forbidden'; end if;
  -- F5: super_admin money actions require MFA.
  if public.has_role(auth.uid(),'super_admin') then perform public.require_aal2(); end if;
  select * into _r from public.wallet_withdrawal_requests where id=_id for update;
  if _r is null or _r.status <> 'pending' then raise exception 'Not pending'; end if;
  if _r.user_id = auth.uid() then raise exception 'You cannot approve your own withdrawal.'; end if;
  select * into _w from public.wallets where user_id = _r.user_id for update;
  if coalesce(_w.limited, false) then raise exception 'This wallet is limited; resolve that before paying out.'; end if;
  if coalesce(_w.balance,0) - coalesce(_w.held,0) < _r.amount then raise exception 'Insufficient available balance (held funds are reserved).'; end if;
  update public.wallets set balance = balance - _r.amount, updated_at=now() where user_id=_r.user_id returning balance into _new_bal;
  if _new_bal < 0 then raise exception 'Insufficient balance'; end if;
  insert into public.wallet_transactions(user_id,type,amount,balance_after,note,created_by)
    values (_r.user_id,'withdrawal',-_r.amount,_new_bal, format('Withdrawal via %s',_r.method), auth.uid());
  -- Ledger (0082)
  perform public.post_ledger('withdrawal_paid',
    jsonb_build_array(
      jsonb_build_object('account', 'user_wallets', 'amount',  _r.amount),
      jsonb_build_object('account', 'payouts_clearing', 'amount', -(_r.amount))),
    null, null, _r.user_id, format('Withdrawal %s via %s', _r.id, _r.method));
  update public.wallet_withdrawal_requests set status='approved', decided_by=auth.uid(), decided_at=now() where id=_id;
  insert into public.wallet_audit_log(user_id,actor_id,action,meta)
    values (_r.user_id,auth.uid(),'withdrawal_approved', jsonb_build_object('id',_id,'amount',_r.amount,'new_balance',_new_bal));
  perform public.log_admin_action('withdrawal_approved', jsonb_build_object('id', _id, 'amount', _r.amount, 'method', _r.method), null, _id, _r.user_id);
  insert into public.notifications(user_id,type,title,body)
    values (_r.user_id,'wallet_withdrawal','Withdrawal approved', format('$%s withdrawn from your wallet.',_r.amount::text));
  select * into _w from public.wallets where user_id=_r.user_id; return _w;
end $function$;

CREATE OR REPLACE FUNCTION public.complete_job(_job_id uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job public.jobs; _rate numeric; _commission numeric;
  _new_bal numeric; _free_used boolean; _has_profile boolean; _level driver_level;
begin
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  if _job.customer_id <> auth.uid() then
    raise exception 'Only the customer can confirm completion';
  end if;
  if _job.status not in ('accepted','in_progress') then
    raise exception 'Job not in progress';
  end if;

  if _job.payment_method = 'escrow' then
    return public.release_escrow_and_complete(_job_id, auth.uid());
  end if;

  -- F1: commission is computed from this price; it must be a valid positive amount.
  if not public.is_valid_money(coalesce(_job.final_price, _job.budget)) then
    raise exception 'Job % has an invalid price and cannot be completed; contact support', _job_id;
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;
  if not (_rate >= 0 and _rate <= 100) then raise exception 'commission_rate is invalid'; end if;

  select first_job_free_used, true, level into _free_used, _has_profile, _level
    from public.driver_profiles where user_id = _job.driver_id;

  if not coalesce(_has_profile, false) then
    raise exception 'Driver profile missing for driver %', _job.driver_id;
  end if;

  perform public.release_job_commission(_job_id);

  if _free_used is not true then
    _commission := 0;
    update public.driver_profiles
       set first_job_free_used = true where user_id = _job.driver_id;

    insert into public.wallet_transactions
      (user_id, type, amount, balance_after, job_id, note, created_by)
    values (_job.driver_id, 'commission', 0,
      coalesce((select balance from public.wallets
                 where user_id = _job.driver_id), 0),
      _job.id, 'First job free — no commission', auth.uid());
  else
    if _job.final_price is null and _job.budget is null then
      raise exception 'Cannot compute commission: job % has no final_price or budget', _job_id;
    end if;

    _commission := round(coalesce(_job.final_price, _job.budget) * _rate / 100.0
                          * public.driver_level_commission_multiplier(_level), 2);

    -- F1: a commission is a debit. It can never be negative (which would
    -- credit the driver) or exceed the job price.
    if not (_commission >= 0 and _commission <= coalesce(_job.final_price, _job.budget)) then
      raise exception 'Computed commission % is invalid for job %', _commission, _job_id;
    end if;

    update public.wallets
       set balance = balance - _commission, updated_at = now()
     where user_id = _job.driver_id
    returning balance into _new_bal;

    if _new_bal is null then
      raise exception 'Driver % has no wallet', _job.driver_id;
    end if;

    update public.wallets
       set limited = (_new_bal < 0) where user_id = _job.driver_id;

    insert into public.wallet_transactions
      (user_id, type, amount, balance_after, job_id, note, created_by)
    values (_job.driver_id, 'commission', -_commission, _new_bal, _job.id,
            format('Commission %s%% on job (%s tier)', _rate, _level), auth.uid());
    if _commission > 0 then
      -- Ledger (0082)
      perform public.post_ledger('direct_commission',
        jsonb_build_array(
          jsonb_build_object('account', 'user_wallets', 'amount',  _commission),
          jsonb_build_object('account', 'platform_revenue', 'amount', -(_commission))),
        null, _job.id, _job.driver_id, 'Direct-pay commission');
    end if;
  end if;

  update public.driver_profiles
     set jobs_completed = jobs_completed + 1 where user_id = _job.driver_id;

  update public.jobs
     set status = 'completed', commission = _commission
   where id = _job_id
  returning * into _job;

  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='jobs'
                and column_name='completed_at') then
    execute 'update public.jobs set completed_at = now() where id = $1' using _job_id;
  end if;

  if to_regprocedure('public.issue_pod(uuid)') is not null then
    perform public.issue_pod(_job_id);
  end if;

  return _job;
end $function$;

CREATE OR REPLACE FUNCTION public.resolve_dispute(_dispute_id uuid, _outcome text, _resolution text)
 RETURNS disputes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _d       public.disputes;
  _job     public.jobs;
  _out     public.dispute_outcome;
  _amount  numeric;
  _new_bal numeric;
  _escrow_refunds integer := 0;
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role)
       or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Forbidden';
  end if;

  begin
    _out := _outcome::public.dispute_outcome;
  exception when others then
    raise exception 'Unknown outcome: %', _outcome;
  end;

  select * into _d from public.disputes where id = _dispute_id for update;
  if not found then raise exception 'Dispute not found'; end if;
  if _d.status = 'resolved' then raise exception 'Already resolved'; end if;

  select * into _job from public.jobs where id = _d.job_id for update;

  -- F5-style self-dealing guard: an admin cannot resolve a dispute on a job
  -- they are a party to.
  if auth.uid() in (_job.customer_id, _job.driver_id) then
    raise exception 'You cannot resolve a dispute on your own job.' using errcode = '42501';
  end if;

  -- ---- apply the outcome ------------------------------------
  if _out = 'refund' then
    if _job.payment_method = 'escrow' then
      -- F2: escrow is refunded IN FULL through Paynow (owner decision); the
      -- job does not complete and no commission is taken.
      _escrow_refunds := public.escrow_refund_due_for_job(_job.id, 'dispute_refund');
      if _escrow_refunds = 0 and exists (select 1 from public.payments
                                          where job_id = _job.id and type = 'escrow' and status = 'released') then
        -- Already released to the driver: a refund now needs a deliberate
        -- clawback decision, never an automatic wallet credit.
        insert into public.notifications (user_id, type, title, body, job_id)
        select distinct ur.user_id, 'payment_anomaly', 'Refund requested on released escrow',
               format('Dispute %s was resolved as a refund, but the escrow for this job was already released. Handle manually.', _d.id),
               _job.id
          from public.user_roles ur where ur.role = 'super_admin';
      end if;
      if _job.status in ('accepted', 'in_progress') then
        perform public.release_job_commission(_job.id);
        update public.jobs
           set status = 'cancelled', cancellation_reason = 'Dispute resolved: refund',
               cancellation_stage = 'dispute', cancelled_at = now(), cancelled_by = auth.uid()
         where id = _job.id;
      end if;
    else
      -- Direct-pay job (unchanged behaviour): refund the customer the
      -- commission Con Z took, credited to their wallet.
      _amount := coalesce(_job.commission, 0);
      if _amount > 0 then
        insert into public.wallets(user_id, balance)
        values (_job.customer_id, 0)
        on conflict (user_id) do nothing;

        update public.wallets
           set balance = balance + _amount, updated_at = now()
         where user_id = _job.customer_id
        returning balance into _new_bal;

        insert into public.wallet_transactions
          (user_id, type, amount, balance_after, job_id, note, created_by)
        values (_job.customer_id, 'refund', _amount, _new_bal, _job.id,
                format('Dispute refund (%s)', _d.category), auth.uid());
        -- Ledger (0082)
        perform public.post_ledger('dispute_commission_refund',
          jsonb_build_array(
            jsonb_build_object('account', 'platform_revenue', 'amount',  _amount),
            jsonb_build_object('account', 'user_wallets', 'amount', -(_amount))),
          null, _job.id, _job.customer_id, 'Commission refunded after dispute');
      end if;
    end if;

  elsif _out = 'strike_issued' then
    insert into public.cancellation_events(user_id, job_id, role, stage, reason)
    values (_d.against, _d.job_id,
            case when _d.against = _job.driver_id then 'driver' else 'customer' end,
            'dispute', format('Dispute upheld: %s', _d.category));

    update public.profiles
       set cancellation_strikes = public.recent_cancellation_strikes(_d.against)
     where id = _d.against;

  elsif _out = 'account_suspended' then
    update public.profiles set status = 'suspended' where id = _d.against;

  elsif _out = 'fee_waived' then
    -- release any commission still held against this job
    perform public.release_job_commission(_d.job_id);
  end if;
  -- Any outcome other than 'refund' leaves paid escrow held; with the dispute
  -- closed, the normal release (customer confirm / delivery PIN / 72h auto
  -- release) proceeds — i.e. "release in full".

  update public.disputes
     set status      = 'resolved',
         outcome     = _out,
         resolution  = _resolution,
         resolved_at = now(),
         resolved_by = auth.uid()
   where id = _dispute_id
  returning * into _d;

  perform public.log_admin_action(
    'dispute_resolved',
    jsonb_build_object('dispute_id', _dispute_id, 'outcome', _out,
                       'job_id', _d.job_id, 'escrow_refunds', _escrow_refunds),
    _resolution, _dispute_id, _d.against);

  insert into public.notifications(user_id, type, title, body)
  select u, 'dispute_resolved', 'Dispute resolved', _resolution
  from unnest(array[_d.raised_by, _d.against]) as u
  where u is not null;

  return _d;
end $function$;

-- -----------------------------------------------------------------------------
-- Reconciliation (read-only checks; flags, never fixes)
-- -----------------------------------------------------------------------------
create or replace function public.financial_reconciliation()
returns table (check_name text, ok boolean, expected numeric, actual numeric, details jsonb)
language sql
stable
security definer
set search_path to 'public'
as $$
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
$$;
revoke all on function public.financial_reconciliation() from public, anon;
grant execute on function public.financial_reconciliation() to authenticated, service_role;

create table if not exists public.reconciliation_runs (
  id          uuid primary key default gen_random_uuid(),
  ran_at      timestamptz not null default now(),
  ok          boolean not null,
  failed      text[] not null default '{}',
  results     jsonb not null
);
alter table public.reconciliation_runs enable row level security;
revoke all on public.reconciliation_runs from anon, authenticated;
grant select on public.reconciliation_runs to authenticated;
drop policy if exists reconciliation_runs_super_read on public.reconciliation_runs;
create policy reconciliation_runs_super_read on public.reconciliation_runs
  for select to authenticated using (public.has_role(auth.uid(), 'super_admin'::app_role));
drop trigger if exists trg_reconciliation_runs_immutable on public.reconciliation_runs;
create trigger trg_reconciliation_runs_immutable
  before update or delete on public.reconciliation_runs
  for each row execute function public.append_only_guard();

create or replace function public.run_financial_reconciliation()
returns public.reconciliation_runs
language plpgsql
security definer
set search_path to 'public'
as $$
declare _r public.reconciliation_runs; _results jsonb; _failed text[];
begin
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb), coalesce(array_agg(c.check_name) filter (where not c.ok), '{}')
    into _results, _failed
    from public.financial_reconciliation() c;
  insert into public.reconciliation_runs (ok, failed, results)
  values (coalesce(array_length(_failed, 1), 0) = 0, _failed, _results)
  returning * into _r;
  if not _r.ok then
    insert into public.notifications (user_id, type, title, body)
    select distinct ur.user_id, 'payment_anomaly', 'Financial reconciliation found discrepancies',
           'Checks failing: ' || array_to_string(_failed, ', ') || '. Review Admin → Ledger before paying out.'
      from public.user_roles ur where ur.role = 'super_admin';
  end if;
  return _r;
end $$;
revoke all on function public.run_financial_reconciliation() from public, anon, authenticated;
grant execute on function public.run_financial_reconciliation() to service_role;

do $$
begin
  perform cron.unschedule('financial-reconciliation') where exists (select 1 from cron.job where jobname = 'financial-reconciliation');
  perform cron.schedule('financial-reconciliation', '0 0 * * *', 'select public.run_financial_reconciliation();');
end $$;
