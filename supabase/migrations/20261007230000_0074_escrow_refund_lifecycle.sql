-- =============================================================================
-- 0074 — Escrow refund lifecycle + platform ledger (audit F2, F9)
-- =============================================================================
--
-- Problem (verified live 07/10/2026): a PAID escrow payment could be stranded.
--   * cancel_job and expire_stale_accepted_jobs cancelled escrow jobs without
--     touching the payment; auto_release_escrow_payments then skipped them
--     (it only scans accepted / in_progress), so the money sat in 'paid'.
--   * resolve_dispute('refund') only credited the job's COMMISSION to the
--     customer's wallet; the escrow itself was never refunded.
--   * A Paynow success arriving after the job was closed, or a second
--     payment for the same job, only produced a notification.
--   * There was no ledger of escrow money at all.
--
-- Owner decisions (07/10/2026, docs/security/CONZ-HARDENING-PLAN.md §6):
--   * Refunds go back through Paynow, never into a withdrawable wallet:
--       paid -> refund_due -> (super_admin refunds in the Paynow portal) -> refunded
--   * Disputes: release in full or refund in full; no partial splits.
--   * Super_admin money actions require MFA (aal2).
--
-- This migration:
--   1. require_aal2(): raises unless the caller's session is multi-factor.
--   2. platform_ledger: append-only double-entry ledger (each entry group
--      sums to zero). Accounts used here: paynow_clearing, escrow_held,
--      refunds_payable, user_wallets, platform_revenue. Phase 15 extends the
--      postings to top-ups, withdrawals, commissions and adjustments.
--   3. escrow_refunds: the refund work queue (one row per refunded payment).
--   4. escrow_mark_refund_due(): paid -> refund_due + queue + ledger + alerts.
--   5. Every path that can strand escrow now routes through (4):
--      cancel_job, expire_stale_accepted_jobs, resolve_dispute('refund'),
--      and mark_escrow_payment_paid (late / duplicate payments).
--   6. admin_mark_escrow_refunded(): super_admin + MFA, not own payment,
--      idempotent, full amount only.
--   7. release_escrow_and_complete posts the release to the ledger.
--   Release after refund and refund after release are impossible: the 0073
--   state machine only allows paid -> released | refund_due.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. MFA helper
-- -----------------------------------------------------------------------------
create or replace function public.require_aal2()
returns void
language plpgsql
stable
set search_path to 'public'
as $$
begin
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Multi-factor authentication is required for this action. Sign in with your authenticator app and try again.'
      using errcode = '42501';
  end if;
end $$;
grant execute on function public.require_aal2() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Platform ledger (double entry; amounts are debit-positive / credit-negative)
-- -----------------------------------------------------------------------------
create table if not exists public.platform_ledger (
  id          uuid primary key default gen_random_uuid(),
  entry_group uuid not null,
  account     text not null check (account in (
                'paynow_clearing',   -- money collected through Paynow (asset)
                'payouts_clearing',  -- money paid out to users (asset decrease)
                'escrow_held',       -- customer money held for a job (liability)
                'refunds_payable',   -- escrow owed back to a customer (liability)
                'user_wallets',      -- money owed to users in their wallets (liability)
                'platform_revenue',  -- commission earned (income)
                'admin_adjustments', -- manual credits/debits (expense / equity)
                'opening_balance'    -- balances that pre-date this ledger
              )),
  amount      numeric(14,2) not null check (amount <> 0 and amount >= -10000000 and amount <= 10000000),
  kind        text not null,
  payment_id  uuid references public.payments(id),
  job_id      uuid references public.jobs(id) on delete set null,
  user_id     uuid,
  note        text,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists platform_ledger_group_idx   on public.platform_ledger(entry_group);
create index if not exists platform_ledger_account_idx on public.platform_ledger(account, created_at);
create index if not exists platform_ledger_payment_idx on public.platform_ledger(payment_id);

alter table public.platform_ledger enable row level security;
revoke all on public.platform_ledger from anon, authenticated;
grant select on public.platform_ledger to authenticated;
drop policy if exists platform_ledger_super_admin_read on public.platform_ledger;
create policy platform_ledger_super_admin_read on public.platform_ledger
  for select to authenticated using (public.has_role(auth.uid(), 'super_admin'::app_role));

create or replace function public.platform_ledger_immutable()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'platform_ledger is append-only' using errcode = '42501';
end $$;
drop trigger if exists trg_platform_ledger_immutable on public.platform_ledger;
create trigger trg_platform_ledger_immutable
  before update or delete on public.platform_ledger
  for each row execute function public.platform_ledger_immutable();

-- Post one balanced entry group. _lines: [{"account": "...", "amount": n}, ...]
create or replace function public.post_ledger(
  _kind text, _lines jsonb, _payment_id uuid default null, _job_id uuid default null,
  _user_id uuid default null, _note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare _group uuid := gen_random_uuid(); _sum numeric := 0; _l jsonb;
begin
  for _l in select * from jsonb_array_elements(_lines) loop
    if not public.is_valid_money(abs((_l->>'amount')::numeric), 10000000) then
      raise exception 'Invalid ledger amount %', _l->>'amount';
    end if;
    _sum := _sum + (_l->>'amount')::numeric;
  end loop;
  if _sum <> 0 then
    raise exception 'Unbalanced ledger entry % (sum %)', _kind, _sum;
  end if;
  insert into public.platform_ledger (entry_group, account, amount, kind, payment_id, job_id, user_id, note, created_by)
  select _group, l->>'account', (l->>'amount')::numeric, _kind, _payment_id, _job_id, _user_id, _note, auth.uid()
    from jsonb_array_elements(_lines) l;
  return _group;
end $$;
revoke all on function public.post_ledger(text, jsonb, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.post_ledger(text, jsonb, uuid, uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 3. Refund work queue
-- -----------------------------------------------------------------------------
create table if not exists public.escrow_refunds (
  id                       uuid primary key default gen_random_uuid(),
  payment_id               uuid not null unique references public.payments(id),
  job_id                   uuid references public.jobs(id) on delete set null,
  user_id                  uuid not null,
  amount                   numeric(12,2) not null check (amount > 0 and amount <= 100000),
  reason                   text not null check (reason in ('job_cancelled','job_expired','dispute_refund','duplicate_payment','job_closed_before_payment')),
  status                   text not null default 'due' check (status in ('due','refunded')),
  created_at               timestamptz not null default now(),
  refunded_at              timestamptz,
  refunded_by              uuid,
  paynow_refund_reference  text,
  note                     text
);
create index if not exists escrow_refunds_status_idx on public.escrow_refunds(status, created_at);

alter table public.escrow_refunds enable row level security;
revoke all on public.escrow_refunds from anon, authenticated;
grant select on public.escrow_refunds to authenticated;
drop policy if exists escrow_refunds_read on public.escrow_refunds;
create policy escrow_refunds_read on public.escrow_refunds
  for select to authenticated
  using (user_id = auth.uid()
         or public.has_role(auth.uid(), 'admin'::app_role)
         or public.has_role(auth.uid(), 'super_admin'::app_role));

-- -----------------------------------------------------------------------------
-- 4. paid -> refund_due (internal; idempotent)
-- -----------------------------------------------------------------------------
create or replace function public.escrow_mark_refund_due(_payment_id uuid, _reason text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare _p public.payments;
begin
  select * into _p from public.payments where id = _payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if _p.type <> 'escrow' then raise exception 'Payment % is not an escrow payment', _payment_id; end if;
  if _p.status in ('refund_due', 'refunded') then return 'already'; end if;
  if _p.status <> 'paid' then
    raise exception 'Escrow payment % is % and cannot be refunded', _payment_id, _p.status;
  end if;

  update public.payments set status = 'refund_due' where id = _p.id;

  insert into public.escrow_refunds (payment_id, job_id, user_id, amount, reason)
  values (_p.id, _p.job_id, _p.user_id, _p.amount, _reason);

  perform public.post_ledger('escrow_refund_due',
    jsonb_build_array(
      jsonb_build_object('account', 'escrow_held',     'amount',  _p.amount),
      jsonb_build_object('account', 'refunds_payable', 'amount', -_p.amount)),
    _p.id, _p.job_id, _p.user_id, _reason);

  insert into public.notifications (user_id, type, title, body, job_id)
  values (_p.user_id, 'escrow_refund_due', 'Your Con Z Pay refund is being processed',
          format('$%s will be refunded to you through Paynow. You''ll be notified when it''s done.', _p.amount),
          _p.job_id);

  insert into public.notifications (user_id, type, title, body, job_id)
  select distinct ur.user_id, 'escrow_refund_due', 'Escrow refund needed',
         format('Refund $%s to the customer through the Paynow portal (payment %s, reason: %s), then mark it refunded in Con Z.',
                _p.amount, _p.id, replace(_reason, '_', ' ')),
         _p.job_id
    from public.user_roles ur where ur.role = 'super_admin';

  return 'refund_due';
end $$;
revoke all on function public.escrow_mark_refund_due(uuid, text) from public, anon, authenticated;
grant execute on function public.escrow_mark_refund_due(uuid, text) to service_role;

create or replace function public.escrow_refund_due_for_job(_job_id uuid, _reason text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare _id uuid; _n integer := 0;
begin
  for _id in
    select id from public.payments
     where job_id = _job_id and type = 'escrow' and status = 'paid'
     order by created_at
     for update
  loop
    if public.escrow_mark_refund_due(_id, _reason) = 'refund_due' then _n := _n + 1; end if;
  end loop;
  return _n;
end $$;
revoke all on function public.escrow_refund_due_for_job(uuid, text) from public, anon, authenticated;
grant execute on function public.escrow_refund_due_for_job(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 5a. Escrow paid: post to ledger; late / duplicate payments go straight to refund
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_escrow_payment_paid(_payment_id uuid)
 RETURNS payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p public.payments; _job public.jobs;
BEGIN
  SELECT * INTO _p FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF _p.type <> 'escrow' THEN RAISE EXCEPTION 'Payment % is not an escrow hold', _payment_id; END IF;

  -- idempotent: already paid, or paid and moved on (released / refund)
  IF _p.status IN ('paid', 'released', 'refund_due', 'refunded') THEN RETURN _p; END IF;

  -- F3: failed / cancelled payments are never revived here.
  IF _p.status <> 'initiated' THEN
    RAISE EXCEPTION 'Payment % is % and cannot be marked paid', _payment_id, _p.status;
  END IF;

  UPDATE public.payments SET status = 'paid', updated_at = now() WHERE id = _payment_id RETURNING * INTO _p;

  -- F2/F9: the money is now held for the customer.
  PERFORM public.post_ledger('escrow_paid',
    jsonb_build_array(
      jsonb_build_object('account', 'paynow_clearing', 'amount',  _p.amount),
      jsonb_build_object('account', 'escrow_held',     'amount', -_p.amount)),
    _p.id, _p.job_id, _p.user_id, 'Con Z Pay payment received');

  IF _p.job_id IS NOT NULL THEN
    SELECT * INTO _job FROM public.jobs WHERE id = _p.job_id;

    IF EXISTS (
      SELECT 1 FROM public.payments o
       WHERE o.job_id = _p.job_id AND o.type = 'escrow' AND o.id <> _p.id
         AND o.status IN ('paid', 'released')
    ) THEN
      -- Customer paid twice for the same job: refund this one in full.
      PERFORM public.escrow_mark_refund_due(_p.id, 'duplicate_payment');
    ELSIF _job.id IS NULL OR _job.status NOT IN ('accepted', 'in_progress') THEN
      -- Paid after the job was cancelled / completed: refund in full.
      PERFORM public.escrow_mark_refund_due(_p.id, 'job_closed_before_payment');
    ELSE
      INSERT INTO public.notifications(user_id, type, title, body, job_id)
      SELECT j.driver_id, 'escrow_funded', 'Payment received — you''re clear to deliver',
             'The customer paid through Con Z Pay. Funds are held safely and will be released to you once delivery is confirmed.',
             j.id
      FROM public.jobs j WHERE j.id = _p.job_id AND j.driver_id IS NOT NULL;
    END IF;
  END IF;

  SELECT * INTO _p FROM public.payments WHERE id = _payment_id;
  RETURN _p;
END $function$;

-- -----------------------------------------------------------------------------
-- 5b. Release posts to the ledger (body = 0072 version + ledger posting)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_escrow_and_complete(_job_id uuid, _actor uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _job public.jobs; _payment public.payments; _rate numeric; _commission numeric;
  _payout numeric; _new_bal numeric; _free_used boolean; _has_profile boolean; _level driver_level;
  _lines jsonb;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;

  IF auth.uid() IS NOT NULL
     AND auth.uid() <> _job.customer_id
     AND auth.uid() <> _job.driver_id
  THEN
    RAISE EXCEPTION 'Not authorised to release this job''s escrow.' USING ERRCODE = '42501';
  END IF;

  IF _job.payment_method <> 'escrow' THEN RAISE EXCEPTION 'Job % is not an escrow job', _job_id; END IF;
  IF _job.status NOT IN ('accepted', 'in_progress') THEN RAISE EXCEPTION 'Job not in progress'; END IF;

  -- Only a 'paid' payment can be released (refund_due / refunded cannot).
  SELECT * INTO _payment FROM public.payments
    WHERE job_id = _job_id AND type = 'escrow' AND status = 'paid'
    ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No confirmed escrow payment for this job yet'; END IF;

  IF NOT public.is_valid_money(_payment.amount) THEN
    RAISE EXCEPTION 'Escrow payment % has an invalid amount; contact support', _payment.id;
  END IF;

  SELECT (value::text)::numeric INTO _rate FROM public.system_settings WHERE key = 'commission_rate';
  IF _rate IS NULL THEN RAISE EXCEPTION 'commission_rate not configured'; END IF;
  IF NOT (_rate >= 0 AND _rate <= 100) THEN RAISE EXCEPTION 'commission_rate is invalid'; END IF;

  SELECT first_job_free_used, true, level INTO _free_used, _has_profile, _level
    FROM public.driver_profiles WHERE user_id = _job.driver_id;
  IF NOT COALESCE(_has_profile, false) THEN
    RAISE EXCEPTION 'Driver profile missing for driver %', _job.driver_id;
  END IF;

  IF _free_used IS NOT TRUE THEN
    _commission := 0;
    UPDATE public.driver_profiles SET first_job_free_used = true WHERE user_id = _job.driver_id;
  ELSE
    _commission := round(_payment.amount * _rate / 100.0
                          * public.driver_level_commission_multiplier(_level), 2);
  END IF;
  _payout := _payment.amount - _commission;

  IF NOT (_commission >= 0 AND _commission <= _payment.amount AND _payout >= 0 AND _payout <= _payment.amount) THEN
    RAISE EXCEPTION 'Computed escrow split is invalid for job %', _job_id;
  END IF;

  INSERT INTO public.wallets(user_id, balance) VALUES (_job.driver_id, 0) ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.wallets SET balance = balance + _payout, updated_at = now(), limited = false
   WHERE user_id = _job.driver_id RETURNING balance INTO _new_bal;

  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, job_id, note, created_by)
  VALUES (_job.driver_id, 'topup', _payout, _new_bal, _job.id,
          format('Con Z Pay escrow release — %s%% commission already deducted (%s tier)', _rate, _level), _actor);

  UPDATE public.payments SET status = 'released', updated_at = now() WHERE id = _payment.id;

  -- F2/F9: escrow leaves the held account; driver payout + platform commission.
  _lines := jsonb_build_array(jsonb_build_object('account', 'escrow_held', 'amount', _payment.amount));
  IF _payout > 0 THEN
    _lines := _lines || jsonb_build_object('account', 'user_wallets', 'amount', -_payout);
  END IF;
  IF _commission > 0 THEN
    _lines := _lines || jsonb_build_object('account', 'platform_revenue', 'amount', -_commission);
  END IF;
  PERFORM public.post_ledger('escrow_released', _lines, _payment.id, _job.id, _job.driver_id, 'Escrow released to driver');

  UPDATE public.driver_profiles SET jobs_completed = jobs_completed + 1 WHERE user_id = _job.driver_id;

  PERFORM public.release_job_commission(_job_id);

  UPDATE public.jobs
     SET status = 'completed', commission = _commission, completed_at = now()
   WHERE id = _job_id
  RETURNING * INTO _job;

  IF to_regprocedure('public.issue_pod(uuid)') IS NOT NULL THEN
    PERFORM public.issue_pod(_job_id);
  END IF;

  INSERT INTO public.notifications(user_id, type, title, body, job_id)
  VALUES (_job.driver_id, 'escrow_released', 'Payment released to you!',
          format('$%s has been added to your wallet for this delivery.', _payout::text), _job.id);

  RETURN _job;
END $function$;

-- -----------------------------------------------------------------------------
-- 5c. cancel_job: paid escrow -> refund_due (live body + F2 block)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_job(_job_id uuid, _reason text DEFAULT NULL::text)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job public.jobs; _stage text; _is_admin boolean; _loc public.material_supply_locations;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  _is_admin := public.has_role(auth.uid(), 'admin'::public.app_role)
            or public.has_role(auth.uid(), 'super_admin'::public.app_role);

  if not (_is_admin or auth.uid() = _job.customer_id or auth.uid() = _job.driver_id) then
    raise exception 'Not authorised to cancel this job';
  end if;
  if _job.status in ('completed','cancelled') then
    raise exception 'Job already % and cannot be cancelled', _job.status;
  end if;
  if _job.status = 'in_progress' and not _is_admin then
    raise exception 'Job is in progress — raise a dispute instead of cancelling';
  end if;

  _stage := case _job.status
              when 'open' then 'pre_acceptance'
              when 'accepted' then 'post_acceptance'
              when 'in_progress' then 'in_transit'
              else _job.status::text end;

  if _stage <> 'pre_acceptance' and _job.supply_location_id is not null then
    select * into _loc from public.material_supply_locations
      where id = _job.supply_location_id for update;
    if found and _loc.available_quantity_m3 is not null then
      update public.material_supply_locations
         set available_quantity_m3 = available_quantity_m3 + _job.quantity_m3,
             updated_at = now()
       where id = _loc.id;
    end if;
  end if;

  perform public.release_job_commission(_job_id);

  -- F2: any escrow the customer already paid is owed back in full.
  perform public.escrow_refund_due_for_job(_job_id, 'job_cancelled');

  update public.jobs
     set status = 'cancelled', cancellation_reason = _reason,
         cancellation_stage = _stage, cancelled_at = now(),
         cancelled_by = auth.uid()
   where id = _job_id
  returning * into _job;

  update public.job_dispatch_offers
     set status = 'superseded', responded_at = now()
   where job_id = _job_id and status = 'pending';

  if _stage <> 'pre_acceptance' and auth.uid() = _job.customer_id then
    perform public.enforce_customer_strikes(_job.customer_id, _job_id, _stage, _reason);
  end if;

  if _stage <> 'pre_acceptance' and auth.uid() = _job.driver_id then
    insert into public.cancellation_events(user_id, job_id, role, stage, reason)
    values (_job.driver_id, _job_id, 'driver', _stage, _reason);
  end if;

  if _job.driver_id is not null and auth.uid() <> _job.driver_id then
    insert into public.notifications (user_id, type, title, body)
    values (_job.driver_id, 'job_cancelled', 'Job cancelled',
            coalesce(_reason, 'The customer cancelled this job.'));
  end if;
  if auth.uid() <> _job.customer_id then
    insert into public.notifications (user_id, type, title, body)
    values (_job.customer_id, 'job_cancelled', 'Job cancelled',
            coalesce(_reason, 'This job was cancelled.'));
  end if;

  return _job;
end $function$;

-- -----------------------------------------------------------------------------
-- 5d. 24h no-show expiry: paid escrow -> refund_due (live body + F2 block)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_stale_accepted_jobs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _cnt integer := 0; _row public.jobs;
BEGIN
  FOR _row IN
    SELECT * FROM public.jobs
    WHERE status = 'accepted'
      AND pickup_photo_taken_at IS NULL
      AND updated_at < now() - interval '24 hours'
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.release_job_commission(_row.id);

    -- F2: escrow already paid for a job the driver never started is refunded.
    PERFORM public.escrow_refund_due_for_job(_row.id, 'job_expired');

    UPDATE public.jobs
       SET status = 'cancelled',
           cancellation_reason = 'Driver did not start pickup within 24 hours of accepting',
           cancellation_stage = 'post_acceptance',
           cancelled_at = now()
     WHERE id = _row.id;

    IF _row.driver_id IS NOT NULL THEN
      INSERT INTO public.cancellation_events(user_id, job_id, role, stage, reason)
      VALUES (_row.driver_id, _row.id, 'driver', 'post_acceptance', 'auto-expired: no pickup within 24h');

      INSERT INTO public.notifications(user_id, type, title, body, job_id)
      VALUES (_row.driver_id, 'job_cancelled', 'Job auto-cancelled',
              'You accepted this job but did not start pickup within 24 hours, so it was automatically cancelled.',
              _row.id);
    END IF;

    INSERT INTO public.notifications(user_id, type, title, body, job_id)
    VALUES (_row.customer_id, 'job_expired', 'Driver did not show up',
            'Your driver did not start pickup within 24 hours. This job was cancelled — you can post it again to reach other drivers.',
            _row.id);

    _cnt := _cnt + 1;
  END LOOP;
  RETURN _cnt;
END $function$;

-- -----------------------------------------------------------------------------
-- 5e. Disputes: 'refund' on a paid escrow job = full escrow refund
-- -----------------------------------------------------------------------------
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
-- 6. refund_due -> refunded (super_admin + MFA, after refunding in Paynow)
-- -----------------------------------------------------------------------------
create or replace function public.admin_mark_escrow_refunded(
  _payment_id uuid, _paynow_refund_reference text, _note text default null
)
returns public.escrow_refunds
language plpgsql
security definer
set search_path to 'public'
as $$
declare _p public.payments; _r public.escrow_refunds;
begin
  if not public.has_role(auth.uid(), 'super_admin'::app_role) then
    raise exception 'Only a super admin can confirm refunds' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _paynow_refund_reference is null or length(btrim(_paynow_refund_reference)) < 3 then
    raise exception 'Enter the Paynow refund reference';
  end if;

  select * into _p from public.payments where id = _payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if _p.user_id = auth.uid() then
    raise exception 'You cannot confirm a refund of your own payment.' using errcode = '42501';
  end if;

  select * into _r from public.escrow_refunds where payment_id = _payment_id for update;
  if not found then raise exception 'No refund is due for this payment'; end if;
  if _p.status = 'refunded' and _r.status = 'refunded' then return _r; end if;   -- idempotent
  if _p.status <> 'refund_due' or _r.status <> 'due' then
    raise exception 'Payment % is % and cannot be marked refunded', _payment_id, _p.status;
  end if;

  update public.payments set status = 'refunded' where id = _p.id;
  update public.escrow_refunds
     set status = 'refunded', refunded_at = now(), refunded_by = auth.uid(),
         paynow_refund_reference = btrim(_paynow_refund_reference), note = _note
   where id = _r.id
  returning * into _r;

  perform public.post_ledger('escrow_refunded',
    jsonb_build_array(
      jsonb_build_object('account', 'refunds_payable', 'amount',  _p.amount),
      jsonb_build_object('account', 'paynow_clearing', 'amount', -_p.amount)),
    _p.id, _p.job_id, _p.user_id, 'Refunded via Paynow ' || btrim(_paynow_refund_reference));

  perform public.log_admin_action('escrow_refunded',
    jsonb_build_object('payment_id', _p.id, 'amount', _p.amount, 'paynow_refund_reference', btrim(_paynow_refund_reference)),
    _note, _p.id, _p.user_id);

  insert into public.notifications (user_id, type, title, body, job_id)
  values (_p.user_id, 'escrow_refunded', 'Refund sent',
          format('Your $%s Con Z Pay payment has been refunded through Paynow (ref %s).', _p.amount, btrim(_paynow_refund_reference)),
          _p.job_id);

  return _r;
end $$;
revoke all on function public.admin_mark_escrow_refunded(uuid, text, text) from public, anon;
grant execute on function public.admin_mark_escrow_refunded(uuid, text, text) to authenticated;
