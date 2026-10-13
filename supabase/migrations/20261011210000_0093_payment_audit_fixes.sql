-- 0093: payment-audit fixes (11/10/2026 audit; each reproduced locally first).
--
-- 1. request_withdrawal: "one pending withdrawal at a time" was only an
--    unlocked EXISTS check. Eight parallel calls produced two pending rows.
--    A partial unique index now enforces it; the function maps the violation
--    to the usual message. (Approval still re-checks the available balance
--    under the wallet lock, so no overdraft was possible -- this restores the
--    invariant and stops queue spam.)
-- 2. resolve_dispute: a direct-pay 'refund' outcome credited the job's
--    commission to the customer with no once-per-job guard. Customer and driver
--    can each raise a dispute on a job, so resolving both paid the commission
--    twice (reproduced: $28 commission -> $56 credited). Now refunded once.
-- 3. raise_dispute: `_against` was caller-supplied and unchecked, so a party
--    could name an uninvolved user as the respondent. It must be the job's
--    customer or driver.
-- 4. admin_apply_wallet_change: a debit could take the balance below the funds
--    held for active jobs; completing those jobs then drove the wallet
--    negative (reproduced: balance 10, held 28 -> -18). Debits must now leave
--    at least the held amount.
-- 5. admin_reject_withdrawal: the UI asked for a reason but the database accepted
--    NULL or one character. A reason of 5+ characters is now required.
--
-- Forward-only. Each function body is the latest live definition with only the
-- lines marked "0093" added; grants are kept by CREATE OR REPLACE. Not applied
-- to any hosted project.

-- Fail loudly (never rewrite financial requests) if duplicates already exist.
do $$
begin
  if exists (select 1 from public.wallet_withdrawal_requests
              where status = 'pending' group by user_id having count(*) > 1) then
    raise exception 'Users with more than one pending withdrawal exist; resolve them (approve/reject one) before applying 0093';
  end if;
end $$;

create unique index if not exists uq_wd_one_pending_per_user
  on public.wallet_withdrawal_requests (user_id) where status = 'pending';

CREATE OR REPLACE FUNCTION public.request_withdrawal(_amount numeric, _method text, _destination text, _pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _r public.wallet_withdrawal_requests;
  _bal numeric; _held numeric; _avail numeric; _limited boolean; _check text;
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
    from public.wallets where user_id = auth.uid();

  if coalesce(_limited, false) then
    raise exception 'Your wallet is limited. Contact support.';
  end if;

  _avail := coalesce(_bal,0) - coalesce(_held,0);
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

  insert into public.wallet_audit_log(user_id, actor_id, action, meta)
    values (auth.uid(), auth.uid(), 'withdrawal_requested',
            jsonb_build_object('id', _r.id, 'amount', _r.amount,
                               'method', _r.method, 'held', _held));
  return jsonb_build_object('ok', true, 'request', to_jsonb(_r));
end $function$;

CREATE OR REPLACE FUNCTION public.raise_dispute(_job_id uuid, _against uuid, _category text, _reason text)
 RETURNS disputes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job public.jobs;
  _d   public.disputes;
  _cat public.dispute_category;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  if _reason is null or length(trim(_reason)) < 10 then
    raise exception 'Please describe the problem in at least 10 characters';
  end if;

  begin
    _cat := _category::public.dispute_category;
  exception when others then
    raise exception 'Unknown dispute category: %', _category;
  end;

  select * into _job from public.jobs where id = _job_id;
  if not found then raise exception 'Job not found'; end if;

  -- only a party to the job
  if auth.uid() <> _job.customer_id and auth.uid() <> _job.driver_id then
    raise exception 'You are not part of this job';
  end if;

  -- the other party, if not supplied
  if _against is null then
    _against := case when auth.uid() = _job.customer_id
                     then _job.driver_id else _job.customer_id end;
  end if;

  if _against = auth.uid() then
    raise exception 'You cannot raise a dispute against yourself';
  end if;

  -- 0093: the other party must really be the customer or driver of this job;
  -- otherwise a dispute (and any strike/suspension outcome) could target an
  -- uninvolved third user.
  if _against is not null and _against is distinct from _job.customer_id
     and _against is distinct from _job.driver_id then
    raise exception 'The other party must be the customer or the driver on this job';
  end if;

  -- can't dispute a job that never started
  if _job.status = 'open' then
    raise exception 'This job has not been accepted yet';
  end if;

  -- one open dispute per job per person
  if exists (select 1 from public.disputes
              where job_id = _job_id and raised_by = auth.uid()
                and status in ('open','investigating')) then
    raise exception 'You already have an open dispute on this job';
  end if;

  insert into public.disputes
    (job_id, raised_by, against, category, reason, status, review_due_at)
  values
    (_job_id, auth.uid(), _against, _cat, trim(_reason), 'open',
     now() + interval '48 hours')
  returning * into _d;

  -- notify the other party
  insert into public.notifications(user_id, type, title, body)
  values (_against, 'dispute_raised', 'A dispute was raised',
          format('A dispute (%s) was raised on one of your jobs. Con Z will review it.',
                 replace(_cat::text, '_', ' ')));

  -- notify admins
  insert into public.notifications(user_id, type, title, body)
  select ur.user_id, 'dispute_raised', 'New dispute needs review',
         format('Category: %s. Due within 48h.', replace(_cat::text, '_', ' '))
  from public.user_roles ur
  where ur.role in ('admin','super_admin');

  return _d;
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
      -- 0093: the commission is refunded at most once per job, however many
      -- disputes are raised on it (customer and driver can each raise one).
      if _amount > 0 and exists (
           select 1 from public.wallet_transactions
            where job_id = _job.id and type = 'refund' and user_id = _job.customer_id) then
        raise exception 'The commission on this job has already been refunded.';
      end if;
      if _amount > 0 then
        -- Second audit (0085): this credits a wallet, so it goes through the
        -- admin money gate: super_admin + MFA + daily cap + no self-target.
        -- (No second-approval threshold: bounded by the commission taken.)
        perform public.admin_money_guard(_job.customer_id, _amount, 'credit', 'dispute_refund', _d.id);
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

CREATE OR REPLACE FUNCTION public.admin_apply_wallet_change(_user_id uuid, _amount numeric, _category wallet_adjustment_category, _reason text, _ip text DEFAULT NULL::text, _device jsonb DEFAULT '{}'::jsonb, _reversal_of uuid DEFAULT NULL::uuid)
 RETURNS wallet_transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _prev numeric; _new numeric; _held numeric; _tx public.wallet_transactions;
begin
  insert into public.wallets(user_id, balance) values (_user_id, 0) on conflict (user_id) do nothing;
  select balance, coalesce(held, 0) into _prev, _held from public.wallets where user_id = _user_id for update;
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

  PERFORM public.log_admin_action('withdrawal_rejected', jsonb_build_object('id', _id, 'amount', _r.amount), _reason, _id, _r.user_id);

  INSERT INTO public.notifications(user_id,type,title,body)
    VALUES (_r.user_id,'wallet_withdrawal','Withdrawal rejected',COALESCE(_reason,'Your withdrawal was rejected.'));
  RETURN _r;
END $function$;
