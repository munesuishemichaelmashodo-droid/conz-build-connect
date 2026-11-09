-- Undo 0160: restore the 0093 resolve_dispute (refund credited to the customer's wallet).

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
