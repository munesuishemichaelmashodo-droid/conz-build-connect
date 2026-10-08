-- =============================================================================
-- 0073 — Payment state machine + Paynow result handling (audit F3, F9)
-- =============================================================================
--
-- Problems (verified live 07/10/2026):
--   * src/routes/api/public/paynow-ipn.ts wrote status='failed' with no
--     prior-status guard: a later Cancelled/Refunded notification regressed a
--     PAID payment, after which a replayed signed "Paid" body (users could
--     read their own paynow_poll_url and fetch one) credited the wallet again.
--   * Neither the IPN nor the poll path compared the reported amount or
--     reference with the stored payment.
--   * credit_wallet_from_payment / mark_escrow_payment_paid were idempotent
--     only on status='paid' — a 'failed' row could be credited.
--   * No audit trail of what Paynow reported or what was decided.
--
-- Fix:
--   1. payments state machine, enforced by trigger for EVERY role (including
--      service_role and SECURITY DEFINER functions):
--          initiated  -> paid | failed | cancelled
--          paid       -> released | refund_due
--          refund_due -> refunded
--      released / refunded / failed / cancelled are terminal.
--      Identity columns (user_id, job_id, type, amount, currency, method,
--      created_at) are immutable after insert; paynow_poll_url can be set
--      once.
--   2. payment_events: append-only log of every Paynow observation and the
--      decision taken (admin-readable, immutable).
--   3. apply_paynow_result(): the ONLY place a Paynow status changes a
--      payment. Verifies reference == payment id, amount == stored amount,
--      and the current state; credits/marks paid at most once; never
--      regresses; flags anomalies (late success, post-payment reversal,
--      mismatches) to admins instead of moving money. service_role only.
--   4. 'refund_due' added to payments_status_check (used by 0074).
--   5. Clients can no longer read paynow_poll_url (column-level grant).
--   6. Server-side reconciliation: paynow_pending_for_reconcile() for the
--      reconcile route, expire_stale_paynow_payment(), and a pg_cron job that
--      pings the app's reconcile endpoint. The cron job is INERT until both
--      app_secrets 'paynow_reconcile_url' and 'paynow_reconcile_secret' are
--      set (an owner deployment step), so no environment calls out by
--      accident.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Status set and bookkeeping columns
-- -----------------------------------------------------------------------------
alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check
  check (status = any (array['initiated','paid','released','refund_due','refunded','cancelled','failed']));

alter table public.payments
  add column if not exists paid_at timestamptz,
  add column if not exists last_checked_at timestamptz,
  add column if not exists check_count integer not null default 0,
  add column if not exists reported_amount numeric(12,2);

-- -----------------------------------------------------------------------------
-- 2. Transition / immutability guard (all roles)
-- -----------------------------------------------------------------------------
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

drop trigger if exists trg_payments_guard_transition on public.payments;
create trigger trg_payments_guard_transition
  before update on public.payments
  for each row execute function public.payments_guard_transition();

-- Payments are financial records: never deleted by anyone but the owner role.
create or replace function public.payments_prevent_delete()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Payments cannot be deleted' using errcode = '42501';
end $$;
drop trigger if exists trg_payments_prevent_delete on public.payments;
create trigger trg_payments_prevent_delete
  before delete on public.payments
  for each row execute function public.payments_prevent_delete();

-- -----------------------------------------------------------------------------
-- 3. Audit log of Paynow observations and decisions
-- -----------------------------------------------------------------------------
create table if not exists public.payment_events (
  id                 uuid primary key default gen_random_uuid(),
  payment_id         uuid not null references public.payments(id),
  source             text not null check (source in ('ipn','poll','reconcile','initiate','expiry','admin')),
  reported_status    text,
  reported_amount    text,
  reported_reference text,
  paynow_reference   text,
  status_before      text,
  status_after       text,
  outcome            text not null,
  detail             text,
  created_at         timestamptz not null default now()
);
create index if not exists payment_events_payment_id_idx on public.payment_events(payment_id, created_at);
create index if not exists payment_events_outcome_idx on public.payment_events(outcome, created_at);

alter table public.payment_events enable row level security;
revoke all on public.payment_events from anon, authenticated;
grant select on public.payment_events to authenticated;
drop policy if exists payment_events_admin_read on public.payment_events;
create policy payment_events_admin_read on public.payment_events
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'super_admin'::app_role));

create or replace function public.payment_events_immutable()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'payment_events is append-only' using errcode = '42501';
end $$;
drop trigger if exists trg_payment_events_immutable on public.payment_events;
create trigger trg_payment_events_immutable
  before update or delete on public.payment_events
  for each row execute function public.payment_events_immutable();

-- -----------------------------------------------------------------------------
-- 4. Clients may read their payments, but never the poll URL
-- -----------------------------------------------------------------------------
revoke select on public.payments from anon, authenticated;
grant select (id, user_id, job_id, type, amount, currency, method, paynow_reference,
              status, created_at, updated_at, paid_at)
  on public.payments to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Credit / mark-paid: only from 'initiated'; idempotent once paid
-- -----------------------------------------------------------------------------
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

CREATE OR REPLACE FUNCTION public.mark_escrow_payment_paid(_payment_id uuid)
 RETURNS payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p public.payments;
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

  IF _p.job_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.payments o
       WHERE o.job_id = _p.job_id AND o.type = 'escrow' AND o.id <> _p.id
         AND o.status IN ('paid', 'released')
    ) THEN
      -- Customer paid twice for the same job. Only one payment is ever
      -- released to the driver; flag the other for a manual refund.
      INSERT INTO public.notifications(user_id, type, title, body, job_id)
      SELECT ur.user_id, 'escrow_duplicate_payment', 'Duplicate Con Z Pay payment — refund needed',
             format('A customer paid $%s twice for the same job (payment %s). Refund the duplicate through Paynow.',
                    _p.amount::text, _p.id::text),
             _p.job_id
        FROM public.user_roles ur
       WHERE ur.role IN ('admin', 'super_admin');
    ELSE
      INSERT INTO public.notifications(user_id, type, title, body, job_id)
      SELECT j.driver_id, 'escrow_funded', 'Payment received — you''re clear to deliver',
             'The customer paid through Con Z Pay. Funds are held safely and will be released to you once delivery is confirmed.',
             j.id
      FROM public.jobs j WHERE j.id = _p.job_id AND j.driver_id IS NOT NULL;
    END IF;
  END IF;

  RETURN _p;
END $function$;

-- -----------------------------------------------------------------------------
-- 6. Admin alert helper (anomalies are surfaced, never auto-"fixed")
-- -----------------------------------------------------------------------------
create or replace function public.notify_payment_anomaly(_payment_id uuid, _title text, _body text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.notifications (user_id, type, title, body)
  select distinct ur.user_id, 'payment_anomaly', _title, _body || ' (payment ' || _payment_id::text || ')'
    from public.user_roles ur
   where ur.role in ('admin', 'super_admin');
$$;
revoke all on function public.notify_payment_anomaly(uuid, text, text) from public, anon, authenticated;
grant execute on function public.notify_payment_anomaly(uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 7. The single entry point for a (hash-verified) Paynow result
-- -----------------------------------------------------------------------------
create or replace function public.apply_paynow_result(
  _payment_id         uuid,
  _source             text,
  _status             text,
  _reported_amount    text,
  _reported_reference text,
  _paynow_reference   text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _p       public.payments;
  _s       text := lower(btrim(coalesce(_status, '')));
  _amt     numeric;
  _outcome text;
  _detail  text;
  _before  text;
begin
  if _source not in ('ipn', 'poll', 'reconcile') then
    raise exception 'Unknown result source %', _source;
  end if;

  select * into _p from public.payments where id = _payment_id for update;
  if not found then raise exception 'payment_not_found' using errcode = 'P0002'; end if;
  _before := _p.status;

  begin
    _amt := round(nullif(btrim(_reported_amount), '')::numeric, 2);
  exception when others then
    _amt := null;
  end;

  if _reported_reference is distinct from _p.id::text then
    _outcome := 'rejected_reference_mismatch';
    _detail := format('reported reference %s', coalesce(_reported_reference, '<none>'));
    perform public.notify_payment_anomaly(_p.id, 'Paynow reference mismatch',
      'A Paynow result did not match the payment it was applied to. Nothing was credited.');

  elsif _s in ('paid', 'awaiting delivery', 'delivered') then
    if _amt is null or not public.is_valid_money(_amt) or _amt <> _p.amount then
      _outcome := 'rejected_amount_mismatch';
      _detail := format('reported %s, expected %s', coalesce(_reported_amount, '<none>'), _p.amount);
      update public.payments set reported_amount = case when public.is_valid_money(_amt) then _amt end
       where id = _p.id;
      perform public.notify_payment_anomaly(_p.id, 'Paynow amount mismatch',
        format('Paynow reported $%s for a $%s payment. Nothing was credited; investigate in the Paynow portal.',
               coalesce(_reported_amount, '?'), _p.amount));
    elsif _p.status = 'initiated' then
      update public.payments
         set paynow_reference = coalesce(nullif(_paynow_reference, ''), paynow_reference),
             reported_amount = _amt
       where id = _p.id;
      if _p.type = 'topup' then
        perform public.credit_wallet_from_payment(_p.id);
        _outcome := 'credited';
      elsif _p.type = 'escrow' then
        perform public.mark_escrow_payment_paid(_p.id);
        _outcome := 'escrow_marked_paid';
      else
        raise exception 'Payment % has unsupported type %', _p.id, _p.type;
      end if;
    elsif _p.status in ('paid', 'released', 'refund_due', 'refunded') then
      _outcome := 'duplicate_ignored';
    else
      -- failed / cancelled locally but Paynow says paid: money may have
      -- moved. Never auto-credit a closed payment; a human must look.
      _outcome := 'late_success_flagged';
      perform public.notify_payment_anomaly(_p.id, 'Paynow payment succeeded after it was closed',
        format('Paynow reports payment of $%s as paid, but Con Z had it as %s. Verify in the Paynow portal and refund or credit manually.',
               _p.amount, _p.status));
    end if;

  elsif _s in ('cancelled', 'failed') then
    if _p.status = 'initiated' then
      update public.payments set status = case when _s = 'cancelled' then 'cancelled' else 'failed' end
       where id = _p.id;
      _outcome := 'closed_unpaid';
    elsif _p.status in ('failed', 'cancelled') then
      _outcome := 'duplicate_ignored';
    else
      _outcome := 'regression_blocked';
      perform public.notify_payment_anomaly(_p.id, 'Paynow reported a completed payment as ' || _s,
        format('Status stays %s. Check the Paynow portal.', _p.status));
    end if;

  elsif _s in ('refunded', 'disputed') then
    if _p.status = 'initiated' then
      update public.payments set status = 'failed' where id = _p.id;
      _outcome := 'closed_unpaid';
    else
      -- Money already credited / held: a refund or chargeback at Paynow must
      -- be handled deliberately (clawback decision), never silently.
      _outcome := 'reversal_flagged';
      perform public.notify_payment_anomaly(_p.id, 'Paynow reports a ' || _s || ' payment',
        format('Payment of $%s (Con Z status %s) was %s at Paynow. Review and reverse the credit if appropriate.',
               _p.amount, _p.status, _s));
    end if;

  else
    _outcome := 'pending_no_change';   -- created / sent / awaiting redirect / unknown
  end if;

  update public.payments
     set last_checked_at = now(), check_count = check_count + 1
   where id = _p.id;

  select * into _p from public.payments where id = _payment_id;

  insert into public.payment_events
    (payment_id, source, reported_status, reported_amount, reported_reference, paynow_reference,
     status_before, status_after, outcome, detail)
  values
    (_p.id, _source, _status, _reported_amount, _reported_reference, _paynow_reference,
     _before, _p.status, _outcome, _detail);

  return jsonb_build_object('outcome', _outcome, 'status', _p.status);
end $$;
revoke all on function public.apply_paynow_result(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_paynow_result(uuid, text, text, text, text, text) to service_role;

-- Record a non-result event (initiation outcome). service_role only.
create or replace function public.record_payment_event(_payment_id uuid, _source text, _outcome text, _detail text default null)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.payment_events (payment_id, source, status_before, status_after, outcome, detail)
  select id, _source, status, status, _outcome, _detail from public.payments where id = _payment_id;
$$;
revoke all on function public.record_payment_event(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_payment_event(uuid, text, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 8. Server-side reconciliation support
-- -----------------------------------------------------------------------------
-- Payments the reconcile job should poll: still initiated, have a poll URL,
-- not polled in the last 5 minutes, at most 14 days old.
create or replace function public.paynow_pending_for_reconcile(_limit integer default 50)
returns table (id uuid, type text, paynow_poll_url text, created_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, p.type, p.paynow_poll_url, p.created_at
    from public.payments p
   where p.status = 'initiated'
     and p.method = 'paynow'
     and p.paynow_poll_url is not null
     and p.created_at > now() - interval '14 days'
     and (p.last_checked_at is null or p.last_checked_at < now() - interval '5 minutes')
   order by p.last_checked_at nulls first, p.created_at
   limit least(greatest(coalesce(_limit, 50), 1), 200);
$$;
revoke all on function public.paynow_pending_for_reconcile(integer) from public, anon, authenticated;
grant execute on function public.paynow_pending_for_reconcile(integer) to service_role;

-- An initiated payment that Paynow still reports as unpaid after 72 hours is
-- abandoned: close it as 'cancelled' (a later success would then be flagged,
-- never silently credited). Initiated payments with no poll URL (initiation
-- never reached Paynow) are closed after 1 hour.
create or replace function public.expire_stale_paynow_payment(_payment_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare _p public.payments;
begin
  select * into _p from public.payments where id = _payment_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if _p.status <> 'initiated' then return 'not_initiated'; end if;
  if not (   (_p.paynow_poll_url is not null and _p.created_at < now() - interval '72 hours')
          or (_p.paynow_poll_url is null     and _p.created_at < now() - interval '1 hour')) then
    return 'too_recent';
  end if;
  update public.payments set status = 'cancelled' where id = _p.id;
  insert into public.payment_events (payment_id, source, status_before, status_after, outcome, detail)
  values (_p.id, 'expiry', 'initiated', 'cancelled', 'expired_unpaid',
          case when _p.paynow_poll_url is null then 'never reached Paynow' else 'unpaid after 72h' end);
  return 'expired';
end $$;
revoke all on function public.expire_stale_paynow_payment(uuid) from public, anon, authenticated;
grant execute on function public.expire_stale_paynow_payment(uuid) to service_role;

-- Initiated payments without a poll URL never reached Paynow; close them.
create or replace function public.expire_unsent_paynow_payments()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare _id uuid; _n integer := 0;
begin
  for _id in
    select id from public.payments
     where status = 'initiated' and paynow_poll_url is null and created_at < now() - interval '1 hour'
  loop
    if public.expire_stale_paynow_payment(_id) = 'expired' then _n := _n + 1; end if;
  end loop;
  return _n;
end $$;
revoke all on function public.expire_unsent_paynow_payments() from public, anon, authenticated;
grant execute on function public.expire_unsent_paynow_payments() to service_role;

-- pg_cron -> pg_net -> app reconcile endpoint. Inert until the owner sets
-- BOTH app_secrets rows (production deployment step):
--   paynow_reconcile_url    e.g. https://www.conz.co.zw/api/internal/paynow-reconcile
--   paynow_reconcile_secret same value as the PAYNOW_RECONCILE_SECRET env var
create or replace function public.request_paynow_reconcile()
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare _url text; _secret text;
begin
  perform public.expire_unsent_paynow_payments();
  select value into _url    from public.app_secrets where key = 'paynow_reconcile_url';
  select value into _secret from public.app_secrets where key = 'paynow_reconcile_secret';
  if coalesce(_url, '') = '' or coalesce(_secret, '') = '' then
    return 'not_configured';
  end if;
  if not exists (select 1 from public.payments where status = 'initiated' and paynow_poll_url is not null) then
    return 'nothing_pending';
  end if;
  perform net.http_post(
    url := _url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-conz-reconcile-secret', _secret),
    body := '{}'::jsonb
  );
  return 'requested';
end $$;
revoke all on function public.request_paynow_reconcile() from public, anon, authenticated;
grant execute on function public.request_paynow_reconcile() to service_role;

do $$
begin
  perform cron.unschedule('paynow-reconcile') where exists (select 1 from cron.job where jobname = 'paynow-reconcile');
  perform cron.schedule('paynow-reconcile', '*/10 * * * *', 'select public.request_paynow_reconcile();');
end $$;
