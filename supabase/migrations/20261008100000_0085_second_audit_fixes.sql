-- =============================================================================
-- 0085 — Fixes from the second security audit (Phase 19)
-- =============================================================================
--
-- 1. financial_reconciliation() (0082) was EXECUTE-able by every signed-in
--    user; its output contains platform-wide money totals and lists of user /
--    payment ids. Now server-only; super admins use admin_reconciliation_report()
--    or read reconciliation_runs (super_admin RLS).
-- 2. resolve_dispute('refund') on a DIRECT-pay job credited the customer's
--    wallet with the job commission for any ordinary admin, with no MFA, cap
--    or self-target check — contrary to "ordinary admins may not credit
--    wallets". It now passes admin_money_guard (super_admin + MFA + daily
--    credit cap + no self-target) under a new kind 'dispute_refund'.
-- 3. admin_referral_action('release') let ANY admin credit a referrer's wallet
--    — including their own (no self check) — and even release rewards that
--    were rejected or frozen for fraud. Now: no action on referrals you are
--    part of; release only from approved/hold and unflagged; release passes
--    admin_money_guard (super_admin + MFA + daily cap), kind 'referral_release'.
-- =============================================================================

revoke execute on function public.financial_reconciliation() from public, anon, authenticated;
grant execute on function public.financial_reconciliation() to service_role;

create or replace function public.admin_reconciliation_report()
returns table (check_name text, ok boolean, expected numeric, actual numeric, details jsonb)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.has_role(auth.uid(), 'super_admin'::app_role) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return query select * from public.financial_reconciliation();
end $$;
revoke all on function public.admin_reconciliation_report() from public, anon;
grant execute on function public.admin_reconciliation_report() to authenticated, service_role;

alter table public.admin_money_actions drop constraint if exists admin_money_actions_kind_check;
alter table public.admin_money_actions add constraint admin_money_actions_kind_check
  check (kind in ('adjustment', 'reversal', 'approved_credit_request', 'dispute_refund', 'referral_release'));

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

CREATE OR REPLACE FUNCTION public.admin_referral_action(_referral_id uuid, _action text, _notes text DEFAULT NULL::text)
 RETURNS referrals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r public.referrals; _new_bal numeric; _tx public.wallet_transactions;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  PERFORM public.require_admin_mfa();
  IF _action NOT IN ('approve','reject','freeze','release','unfreeze') THEN RAISE EXCEPTION 'Invalid action'; END IF;

  SELECT * INTO _r FROM public.referrals WHERE id = _referral_id FOR UPDATE;
  IF _r IS NULL THEN RAISE EXCEPTION 'Referral not found'; END IF;
  -- Second audit (0085): no self-dealing on referrals.
  IF auth.uid() IN (_r.referrer_id, _r.referred_id) THEN
    RAISE EXCEPTION 'You cannot act on a referral you are part of.' USING ERRCODE = '42501';
  END IF;

  IF _action = 'approve' THEN
    UPDATE public.referrals SET reward_status = 'approved', fraud_flag = false, admin_notes = COALESCE(_notes, admin_notes), decided_by = auth.uid(), decided_at = now() WHERE id = _referral_id RETURNING * INTO _r;
  ELSIF _action = 'reject' THEN
    IF _r.reward_status = 'released' THEN RAISE EXCEPTION 'Cannot reject an already-released reward — use a wallet reversal instead'; END IF;
    UPDATE public.referrals SET reward_status = 'rejected', admin_notes = COALESCE(_notes, admin_notes), decided_by = auth.uid(), decided_at = now() WHERE id = _referral_id RETURNING * INTO _r;
    INSERT INTO public.notifications(user_id, type, title, body) VALUES (_r.referrer_id, 'referral_reward_rejected', 'Referral reward rejected', COALESCE('Reason: ' || _notes, 'Your referral reward was rejected after review.'));
  ELSIF _action = 'freeze' THEN
    IF _r.reward_status = 'released' THEN RAISE EXCEPTION 'Cannot freeze an already-released reward'; END IF;
    UPDATE public.referrals SET reward_status = 'frozen', fraud_flag = true, fraud_reason = COALESCE(_notes, fraud_reason, 'Frozen by admin for review'), admin_notes = COALESCE(_notes, admin_notes), decided_by = auth.uid(), decided_at = now() WHERE id = _referral_id RETURNING * INTO _r;
  ELSIF _action = 'unfreeze' THEN
    UPDATE public.referrals SET reward_status = 'hold', fraud_flag = false, admin_notes = COALESCE(_notes, admin_notes), decided_by = auth.uid(), decided_at = now() WHERE id = _referral_id RETURNING * INTO _r;
  ELSIF _action = 'release' THEN
    IF _r.reward_status = 'released' THEN RAISE EXCEPTION 'Already released'; END IF;
    IF _r.reward_amount IS NULL THEN RAISE EXCEPTION 'No reward amount set on this referral yet'; END IF;
    -- Second audit (0085): only an approved / held, un-flagged reward can be
    -- released, and releasing credits a wallet -> super_admin + MFA + cap.
    IF _r.reward_status NOT IN ('approved', 'hold') OR coalesce(_r.fraud_flag, false) THEN
      RAISE EXCEPTION 'Only an approved, unflagged reward can be released (status %).', _r.reward_status;
    END IF;
    PERFORM public.admin_money_guard(_r.referrer_id, _r.reward_amount, 'credit', 'referral_release', _r.id);
    INSERT INTO public.wallets(user_id, balance) VALUES (_r.referrer_id, 0) ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.wallets SET balance = balance + _r.reward_amount, updated_at = now() WHERE user_id = _r.referrer_id RETURNING balance INTO _new_bal;
    INSERT INTO public.wallet_transactions (user_id, type, amount, balance_after, note) VALUES (_r.referrer_id, 'referral_bonus', _r.reward_amount, _new_bal, 'Referral reward — released by admin') RETURNING * INTO _tx;
    UPDATE public.referrals SET reward_status = 'released', reward_transaction_id = _tx.id, admin_notes = COALESCE(_notes, admin_notes), decided_by = auth.uid(), decided_at = now() WHERE id = _referral_id RETURNING * INTO _r;
    INSERT INTO public.notifications(user_id, type, title, body) VALUES (_r.referrer_id, 'referral_reward_released', 'Referral reward released', format('Your referral reward of $%s has been added to your wallet.', _r.reward_amount));
  END IF;

  PERFORM public.log_admin_action('referral_' || _action, jsonb_build_object('referral_id', _referral_id, 'notes', _notes), _notes, _referral_id, _r.referrer_id);
  RETURN _r;
END $function$;
