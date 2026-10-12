-- 0095_wallet_reservation_failed_payout_limits
--
-- Wallet / withdrawal completion (2026-10-12).
--
--  1. wallets.withdrawal_reserved: a pending withdrawal now RESERVES its amount. Previously nothing was
--     reserved while a request waited for approval, so the driver could spend the same money elsewhere
--     (accepting jobs, admin debits) and the approval then failed or went negative. Kept separate from
--     wallets.held (commission reserved on active jobs). Available = balance - held - withdrawal_reserved.
--     Released on approve (the debit takes over), reject and cancel. Reconciled by financial_reconciliation().
--  2. Failed payouts: status 'failed' + admin_mark_withdrawal_failed(): when the manual payout could not be
--     made, the debit taken at approval is reversed (wallet transaction + balancing ledger entry + audit +
--     notification). Impossible once a payout has been recorded as sent. Rows are never deleted.
--  3. wallets.limited now follows the balance: a trigger sets limited = (balance < 0) whenever the balance
--     changes. Previously every credit path set limited = false unconditionally, so a top-up of $1 on a
--     wallet that was $50 overdrawn silently lifted the restriction.
--  4. Top-up controls: a rate limit on top-up payment creation (max 5 / hour, 20 / day per user), and manual
--     top-up requests now need a payment reference (>= 4 chars) that is unique per method, so one transfer
--     cannot be claimed twice. Routine credit is Paynow; manual approval stays super_admin + second factor.
--
-- No existing balance, ledger entry or row is changed except the reserved backfill below.

alter table public.wallets
  add column if not exists withdrawal_reserved numeric(14,2) not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='wallets_withdrawal_reserved_valid') then
    alter table public.wallets add constraint wallets_withdrawal_reserved_valid
      check (withdrawal_reserved >= 0 and withdrawal_reserved <= 10000000);
  end if;
end $$;

-- Backfill: requests already pending reserve their amount.
update public.wallets w
   set withdrawal_reserved = s.total
  from (select user_id, sum(amount) as total from public.wallet_withdrawal_requests
         where status = 'pending' group by user_id) s
 where s.user_id = w.user_id and w.withdrawal_reserved is distinct from s.total;

create or replace function public.wallet_available(_user_id uuid)
 returns numeric language sql stable security definer set search_path to 'public'
as $$
  select coalesce(balance, 0) - coalesce(held, 0) - coalesce(withdrawal_reserved, 0)
  from public.wallets where user_id = _user_id;
$$;

-- limited follows the balance
create or replace function public.wallets_limited_follows_balance()
 returns trigger language plpgsql set search_path to 'public'
as $$
begin
  if new.balance is distinct from old.balance then
    new.limited := (new.balance < 0);
  end if;
  return new;
end $$;
drop trigger if exists trg_wallets_limited_follows_balance on public.wallets;
create trigger trg_wallets_limited_follows_balance
  before update of balance on public.wallets
  for each row execute function public.wallets_limited_follows_balance();

alter table public.wallet_withdrawal_requests
  add column if not exists failed_at timestamptz,
  add column if not exists failed_by uuid references auth.users(id);
alter table public.wallet_withdrawal_requests drop constraint if exists wallet_withdrawal_requests_status_check;
alter table public.wallet_withdrawal_requests add constraint wallet_withdrawal_requests_status_check
  check (status = any (array['pending','approved','rejected','cancelled','failed']));


CREATE OR REPLACE FUNCTION public.financial_request_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare _is_client boolean := current_user in ('authenticated', 'anon');
begin
  if new.id is distinct from old.id
     or new.user_id    is distinct from old.user_id
     or new.amount     is distinct from old.amount
     or new.method     is distinct from old.method
     or new.note       is distinct from old.note
     or new.created_at is distinct from old.created_at
  then
    raise exception 'A submitted request cannot be changed. Cancel it and submit a new one.' using errcode = '42501';
  end if;

  if tg_table_name = 'wallet_withdrawal_requests' then
    if new.destination is distinct from old.destination then
      raise exception 'A submitted withdrawal''s destination cannot be changed. Cancel it and submit a new one.' using errcode = '42501';
    end if;

    -- 0094: recording the manual payout is the only change allowed on an approved withdrawal.
    if old.status = 'approved' and new.status = 'approved' and old.paid_at is null
       and new.paid_at is not null and not _is_client
       and new.decided_by    is not distinct from old.decided_by
       and new.decided_at    is not distinct from old.decided_at
       and new.reject_reason is not distinct from old.reject_reason
    then
      return new;
    end if;
    if new.paid_at          is distinct from old.paid_at
       or new.paid_by          is distinct from old.paid_by
       or new.payout_reference is distinct from old.payout_reference
       or new.payout_note      is distinct from old.payout_note
    then
      raise exception 'Payout details can only be recorded once, by an admin, on an approved withdrawal.' using errcode = '42501';
    end if;
    -- 0095: an approved, not-yet-paid withdrawal can be marked failed (never by a client).
    if old.status = 'approved' and new.status = 'failed' and old.paid_at is null and not _is_client
       and new.decided_by is not distinct from old.decided_by
       and new.decided_at is not distinct from old.decided_at
       and new.paid_at is null and new.paid_by is null and new.payout_reference is null
    then
      return new;
    end if;
  elsif tg_table_name = 'wallet_topup_requests' then
    if new.reference is distinct from old.reference then
      raise exception 'A submitted top-up''s reference cannot be changed. Cancel it and submit a new one.' using errcode = '42501';
    end if;
  end if;

  if old.status <> 'pending' then
    raise exception 'This request has already been %.', old.status using errcode = '42501';
  end if;
  if new.status not in ('pending', 'cancelled', 'approved', 'rejected') then
    raise exception 'Invalid request status %', new.status using errcode = '42501';
  end if;

  if _is_client then
    -- The only change a client may make: the owner cancels their own request.
    if not (new.status = 'cancelled'
            and old.user_id = auth.uid()
            and new.decided_by is not distinct from old.decided_by
            and new.reject_reason is not distinct from old.reject_reason) then
      raise exception 'Only the owner can cancel a pending request; approvals go through the admin tools.' using errcode = '42501';
    end if;
  end if;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.request_withdrawal(_amount numeric, _method text, _destination text, _pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _r public.wallet_withdrawal_requests;
  _bal numeric; _held numeric; _reserved numeric := 0; _avail numeric; _limited boolean; _check text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if _amount is null or _amount <= 0 or _amount > 100000 then
    raise exception 'Invalid amount';
  end if;
  if _method not in ('ecocash','onemoney','zipit','bank') then
    raise exception 'Invalid method';
  end if;
  if _destination is null or length(trim(_destination)) < 4 then
    raise exception 'Destination required';
  end if;

  -- one pending request at a time
  if exists (select 1 from public.wallet_withdrawal_requests
              where user_id = auth.uid() and status = 'pending') then
    raise exception 'You already have a withdrawal awaiting approval';
  end if;

  -- F7: a wrong PIN / lockout is RETURNED (not raised) so the failure counts.
  _check := public.check_withdrawal_pin(auth.uid(), _pin);
  if _check <> 'ok' then
    return public.withdrawal_pin_failure_result(auth.uid(), _check);
  end if;

  select coalesce(balance,0), coalesce(held,0), coalesce(limited,false)
    into _bal, _held, _limited
    from public.wallets where user_id = auth.uid() for update;
  select coalesce(withdrawal_reserved,0) into _reserved from public.wallets where user_id = auth.uid();

  if coalesce(_limited, false) then
    raise exception 'Your wallet is limited. Contact support.';
  end if;

  _avail := coalesce(_bal,0) - coalesce(_held,0) - coalesce(_reserved,0);
  if _avail < _amount then
    raise exception 'Insufficient available balance. $% is reserved against active jobs.',
      coalesce(_held,0)::text;
  end if;

  begin
    insert into public.wallet_withdrawal_requests(user_id, amount, method, destination)
      values (auth.uid(), round(_amount,2), _method, trim(_destination))
      returning * into _r;
  exception when unique_violation then
    -- 0093: two concurrent requests both passed the check above; the partial
    -- unique index admits only one pending request per user.
    raise exception 'You already have a withdrawal awaiting approval';
  end;

  -- 0095: reserve the funds while the request waits, so they cannot be spent twice.
  update public.wallets set withdrawal_reserved = withdrawal_reserved + _r.amount, updated_at = now()
   where user_id = auth.uid();

  insert into public.wallet_audit_log(user_id, actor_id, action, meta)
    values (auth.uid(), auth.uid(), 'withdrawal_requested',
            jsonb_build_object('id', _r.id, 'amount', _r.amount,
                               'method', _r.method, 'held', _held));
  return jsonb_build_object('ok', true, 'request', to_jsonb(_r));
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
  update public.wallets set balance = balance - _r.amount, withdrawal_reserved = greatest(0, withdrawal_reserved - _r.amount), updated_at=now() where user_id=_r.user_id returning balance into _new_bal;
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
    values (_r.user_id,'wallet_withdrawal','Withdrawal approved — payout pending',
            format('Your $%s withdrawal was approved and taken from your wallet. ConZ now sends the payout to your %s account by hand; you will get another message when it is recorded as sent.',
                   _r.amount::text, _r.method));
  select * into _w from public.wallets where user_id=_r.user_id; return _w;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_reject_withdrawal(_id uuid, _reason text)
 RETURNS wallet_withdrawal_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.wallet_withdrawal_requests;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  -- 0093: a rejection must carry a meaningful reason (the driver sees it).
  IF _reason IS NULL OR length(btrim(_reason)) < 5 THEN
    RAISE EXCEPTION 'A reason of at least 5 characters is required to reject a withdrawal';
  END IF;
  UPDATE public.wallet_withdrawal_requests
    SET status='rejected', reject_reason=_reason, decided_by=auth.uid(), decided_at=now()
    WHERE id=_id AND status='pending'
    RETURNING * INTO _r;
  IF _r IS NULL THEN RAISE EXCEPTION 'Cannot reject'; END IF;

  UPDATE public.wallets SET withdrawal_reserved = greatest(0, withdrawal_reserved - _r.amount), updated_at = now() WHERE user_id = _r.user_id;

  PERFORM public.log_admin_action('withdrawal_rejected', jsonb_build_object('id', _id, 'amount', _r.amount), _reason, _id, _r.user_id);

  INSERT INTO public.notifications(user_id,type,title,body)
    VALUES (_r.user_id,'wallet_withdrawal','Withdrawal rejected',COALESCE(_reason,'Your withdrawal was rejected.'));
  RETURN _r;
END $function$;

CREATE OR REPLACE FUNCTION public.cancel_withdrawal(_id uuid)
 RETURNS wallet_withdrawal_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.wallet_withdrawal_requests;
BEGIN
  UPDATE public.wallet_withdrawal_requests
    SET status='cancelled', decided_at=now()
    WHERE id=_id AND user_id=auth.uid() AND status='pending'
    RETURNING * INTO _r;
  IF _r IS NULL THEN RAISE EXCEPTION 'Cannot cancel'; END IF;
  UPDATE public.wallets SET withdrawal_reserved = greatest(0, withdrawal_reserved - _r.amount), updated_at = now() WHERE user_id = _r.user_id;
  RETURN _r;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_apply_wallet_change(_user_id uuid, _amount numeric, _category wallet_adjustment_category, _reason text, _ip text DEFAULT NULL::text, _device jsonb DEFAULT '{}'::jsonb, _reversal_of uuid DEFAULT NULL::uuid)
 RETURNS wallet_transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _prev numeric; _new numeric; _held numeric; _tx public.wallet_transactions;
begin
  insert into public.wallets(user_id, balance) values (_user_id, 0) on conflict (user_id) do nothing;
  select balance, coalesce(held, 0) + coalesce(withdrawal_reserved, 0) into _prev, _held from public.wallets where user_id = _user_id for update;
  _new := _prev + _amount;
  if _new < 0 then
    raise exception 'This would take the wallet negative (balance %, change %)', _prev, _amount;
  end if;
  -- 0093: a debit may not eat into funds reserved for active jobs (held
  -- commission); that would push the wallet negative when those jobs complete.
  if _amount < 0 and _new < _held then
    raise exception 'This debit would take the wallet below its reserved funds (balance %, held %, change %)', _prev, _held, _amount;
  end if;
  update public.wallets set balance = _new, updated_at = now(), limited = false where user_id = _user_id;

  insert into public.wallet_transactions
    (user_id, type, amount, balance_after, previous_balance, category, note, created_by, ip_address, device_info, reversal_of_transaction_id)
  values (_user_id, 'adjustment', _amount, _new, _prev, _category, _reason, auth.uid(), _ip, _device, _reversal_of)
  returning * into _tx;

  -- Credits come out of admin_adjustments into the user's wallet; debits the reverse.
  perform public.post_ledger(
    case when _reversal_of is not null then 'admin_reversal' when _amount > 0 then 'admin_credit' else 'admin_debit' end,
    jsonb_build_array(
      jsonb_build_object('account', 'admin_adjustments', 'amount',  _amount),
      jsonb_build_object('account', 'user_wallets',      'amount', -_amount)),
    null, null, _user_id, _reason);

  perform public.log_admin_action(
    case when _reversal_of is not null then 'wallet_transaction_reversed'
         when _amount > 0 then 'wallet_credited_by_admin' else 'wallet_debited_by_admin' end,
    jsonb_build_object('amount', _amount, 'category', _category, 'previous_balance', _prev, 'new_balance', _new,
                       'ip', _ip, 'device', _device, 'reversal_of', _reversal_of),
    _reason, _tx.id, _user_id);

  insert into public.notifications(user_id, type, title, body)
  values (_user_id, case when _reversal_of is not null then 'wallet_adjustment_reversed' else 'wallet_adjustment' end,
    case when _reversal_of is not null then 'Wallet adjustment reversed'
         when _amount > 0 then 'Wallet credited' else 'Wallet debited' end,
    format('Your wallet was %s $%s. Reason: %s', case when _amount > 0 then 'credited with' else 'debited by' end,
           to_char(abs(_amount), 'FM999999990.00'), _reason));
  return _tx;
end $function$;

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

  select coalesce(balance,0), coalesce(held,0) + coalesce(withdrawal_reserved,0) into _bal, _held
    from public.wallets where user_id = auth.uid();
  _bal  := coalesce(_bal, 0);
  _held := coalesce(_held, 0);
  _avail := _bal - _held;

  if _free is not true then
    return jsonb_build_object('ok', true, 'required', 0, 'balance', _bal,
      'held', _held, 'available', _avail, 'shortfall', 0, 'free', true);
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;

  _req := public.commission_amount(coalesce(_job.final_price, _job.budget, 0), _rate);

  return jsonb_build_object(
    'ok', _avail >= _req, 'required', _req, 'balance', _bal,
    'held', _held, 'available', _avail,
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
  _bal numeric; _held numeric; _avail numeric;
  _free boolean; _has_profile boolean;
  _uid uuid := auth.uid();
begin
  select * into _job from public.jobs where id = _job_id;
  if not found then raise exception 'Job not found'; end if;

  -- The driver checking themself, an admin, or the job's customer accepting
  -- a bid from this driver (accept_bid / accept_counter). A NULL uid is
  -- only allowed for the server's own service_role key.
  -- coalesce: with a NULL uid every comparison is NULL, and IF NOT NULL
  -- does not raise — the check must treat "unknown" as "not allowed".
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

  select coalesce(balance,0), coalesce(held,0) + coalesce(withdrawal_reserved,0) into _bal, _held
    from public.wallets where user_id = _driver_id;
  _avail := coalesce(_bal,0) - coalesce(_held,0);

  if _free is not true then
    return jsonb_build_object('ok', true, 'required', 0,
      'available', _avail, 'free', true);
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;

  _req := public.commission_amount(coalesce(_job.final_price, _job.budget, 0), _rate);

  return jsonb_build_object('ok', _avail >= _req, 'required', _req,
    'available', _avail, 'shortfall', greatest(0, _req - _avail), 'free', false);
end $function$;

CREATE OR REPLACE FUNCTION public.driver_dashboard_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare _r jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select jsonb_build_object(
    'balance',        coalesce(w.balance, 0),
    'held',           coalesce(w.held, 0),
    'reserved',       coalesce(w.withdrawal_reserved, 0),
    'available',      coalesce(w.balance,0) - coalesce(w.held,0) - coalesce(w.withdrawal_reserved,0),
    'limited',        coalesce(w.limited, false),
    'jobs_completed', coalesce(dp.jobs_completed, 0),
    'rating_avg',     dp.rating_avg,
    'rating_count',   dp.rating_count,
    'level',          dp.level,
    'verification',   dp.verification_status,
    'active_jobs',    (select count(*) from public.jobs
                        where driver_id = auth.uid()
                          and status in ('accepted','in_progress')),
    'open_offers',    (select count(*) from public.job_dispatch_offers
                        where driver_id = auth.uid()
                          and status = 'pending' and expires_at > now()),
    'earned_total',   (select coalesce(sum(coalesce(final_price,0)
                                         - coalesce(commission,0)), 0)
                         from public.jobs
                        where driver_id = auth.uid() and status = 'completed')
  ) into _r
  from public.driver_profiles dp
  left join public.wallets w on w.user_id = dp.user_id
  where dp.user_id = auth.uid();

  return coalesce(_r, jsonb_build_object('error','no_driver_profile'));
end $function$;

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


-- Failed payout: reverse the debit taken at approval.
create or replace function public.admin_mark_withdrawal_failed(_id uuid, _reason text)
 returns public.wallet_withdrawal_requests
 language plpgsql security definer set search_path to 'public'
as $$
declare _r public.wallet_withdrawal_requests; _orig uuid; _new_bal numeric; _tx uuid;
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'super_admin')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if public.has_role(auth.uid(),'super_admin') then perform public.require_aal2(); end if;
  if _reason is null or length(btrim(_reason)) < 5 then
    raise exception 'A reason of at least 5 characters is required to mark a payout failed';
  end if;
  select * into _r from public.wallet_withdrawal_requests where id = _id for update;
  if _r is null then raise exception 'Withdrawal not found'; end if;
  if _r.status = 'failed' then return _r; end if;
  if _r.user_id = auth.uid() then raise exception 'You cannot process your own withdrawal.' using errcode = '42501'; end if;
  if _r.status <> 'approved' then raise exception 'Only an approved withdrawal can be marked failed'; end if;
  if _r.paid_at is not null then
    raise exception 'A payout has already been recorded as sent for this withdrawal; it cannot be marked failed';
  end if;

  select id into _orig from public.wallet_transactions t
   where t.user_id = _r.user_id and t.type = 'withdrawal' and t.amount = -_r.amount
     and not exists (select 1 from public.wallet_transactions x where x.reversal_of_transaction_id = t.id)
   order by t.created_at desc limit 1;

  update public.wallets set balance = balance + _r.amount, updated_at = now()
   where user_id = _r.user_id returning balance into _new_bal;
  if _new_bal is null then raise exception 'Wallet missing for user %', _r.user_id; end if;

  insert into public.wallet_transactions(user_id, type, amount, balance_after, note, created_by, reversal_of_transaction_id)
  values (_r.user_id, 'withdrawal', _r.amount, _new_bal,
          format('Payout failed — withdrawal %s returned to wallet. Reason: %s', _r.id, btrim(_reason)),
          auth.uid(), _orig)
  returning id into _tx;

  perform public.post_ledger('withdrawal_reversed',
    jsonb_build_array(
      jsonb_build_object('account', 'user_wallets',      'amount', -_r.amount),
      jsonb_build_object('account', 'payouts_clearing',  'amount',  _r.amount)),
    null, null, _r.user_id, format('Withdrawal %s payout failed; debit reversed', _r.id));

  update public.wallet_withdrawal_requests
     set status = 'failed', failed_at = now(), failed_by = auth.uid(), reject_reason = btrim(_reason)
   where id = _id returning * into _r;

  insert into public.wallet_audit_log(user_id, actor_id, action, meta)
  values (_r.user_id, auth.uid(), 'withdrawal_payout_failed',
          jsonb_build_object('id', _id, 'amount', _r.amount, 'new_balance', _new_bal, 'reversal_tx', _tx));
  perform public.log_admin_action('withdrawal_payout_failed',
    jsonb_build_object('id', _id, 'amount', _r.amount, 'new_balance', _new_bal), btrim(_reason), _id, _r.user_id);
  insert into public.notifications(user_id, type, title, body)
  values (_r.user_id, 'wallet_withdrawal', 'Withdrawal payout failed — money returned',
          format('We could not send your $%s payout. The amount is back in your wallet. Reason: %s', _r.amount::text, btrim(_reason)));
  return _r;
end $$;
revoke all on function public.admin_mark_withdrawal_failed(uuid, text) from public, anon;
grant execute on function public.admin_mark_withdrawal_failed(uuid, text) to authenticated;

-- Top-up rate limit (Paynow top-up payment rows are created server-side).
create or replace function public.payments_topup_rate_limit()
 returns trigger language plpgsql set search_path to 'public'
as $$
declare _hour int; _day int;
begin
  if new.type <> 'topup' then return new; end if;
  select count(*) filter (where created_at > now() - interval '1 hour'), count(*)
    into _hour, _day
    from public.payments
   where user_id = new.user_id and type = 'topup' and created_at > now() - interval '1 day';
  if _hour >= 5 then
    raise exception 'Too many top-up attempts. Please wait a while before trying again.' using errcode = '54000';
  end if;
  if _day >= 20 then
    raise exception 'Daily top-up attempt limit reached. Please try again tomorrow.' using errcode = '54000';
  end if;
  return new;
end $$;
drop trigger if exists trg_payments_topup_rate_limit on public.payments;
create trigger trg_payments_topup_rate_limit
  before insert on public.payments
  for each row execute function public.payments_topup_rate_limit();

-- Manual top-up requests: a reference is mandatory and a transfer reference can be used once per method.

CREATE OR REPLACE FUNCTION public.request_topup(_amount numeric, _method text, _reference text)
 RETURNS wallet_topup_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.wallet_topup_requests; _pending int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 100000 THEN
    RAISE EXCEPTION 'Amount must be between $1 and $100,000';
  END IF;
  IF _method NOT IN ('ecocash','onemoney','zipit','bank') THEN
    RAISE EXCEPTION 'Invalid payment method';
  END IF;
  IF _reference IS NULL OR length(btrim(_reference)) < 4 THEN
    RAISE EXCEPTION 'The payment reference from your transfer is required (at least 4 characters)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wallet_topup_requests
              WHERE method = _method AND lower(btrim(reference)) = lower(btrim(_reference))
                AND status IN ('pending','approved')) THEN
    RAISE EXCEPTION 'This payment reference has already been submitted';
  END IF;
  SELECT COUNT(*) INTO _pending FROM public.wallet_topup_requests
    WHERE user_id = auth.uid() AND status = 'pending';
  IF _pending >= 5 THEN RAISE EXCEPTION 'Too many pending top-ups. Cancel one first.'; END IF;

  INSERT INTO public.wallet_topup_requests(user_id, amount, method, reference)
    VALUES (auth.uid(), ROUND(_amount,2), _method, NULLIF(trim(_reference),''))
    RETURNING * INTO _r;

  INSERT INTO public.wallet_audit_log(user_id, actor_id, action, meta)
  VALUES (auth.uid(), auth.uid(), 'topup_requested',
          jsonb_build_object('id',_r.id,'amount',_r.amount,'method',_r.method));
  RETURN _r;
END $function$;


do $$ begin
  begin
    create unique index if not exists uq_topup_ref_per_method
      on public.wallet_topup_requests (method, lower(btrim(reference)))
      where reference is not null and status in ('pending','approved');
  exception when unique_violation then
    raise notice 'uq_topup_ref_per_method not created: duplicate live top-up references exist; resolve them and re-run';
  end;
end $$;
