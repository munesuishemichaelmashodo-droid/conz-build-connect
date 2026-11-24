-- -----------------------------------------------------------------------------
-- 0171: provider-collected jobs — commission from the fare (never from commission credit),
--       driver earnings payable, payouts, provider fees, refunds, reconciliation.
--
-- MVP rule (owner directive 24/11/2026): Customer -> approved payment provider -> ConZ records -> driver payout.
-- ConZ earns 7% of the TRANSPORT fare only. A provider-collected job must never also reserve or charge
-- commission from the driver's prepaid commission credit (no double commission).
--
-- Everything here is OFF until two settings change (both written as OFF below):
--   system_settings.payment_provider = "none"   -> no job can be created with payment_method 'provider'
--   system_settings.payouts_enabled  = false    -> no payout can be prepared
-- No provider is integrated here. A provider adapter (server code) calls the service-role functions below
-- after it has verified the provider's signature and re-checked the status with the provider.
--
-- What changes for existing jobs: nothing. 'direct' and 'escrow' jobs keep their exact code paths; the five
-- replaced functions only gain an early branch for payment_method = 'provider'.
--
-- Two CHECK constraints must be WIDENED (jobs_payment_method_check, platform_ledger_account_check). Postgres cannot widen a
-- CHECK in place, so each is DROP CONSTRAINT + ADD CONSTRAINT in ONE ALTER statement (atomic: never a moment without it).
-- These two are the only DROPs; they are allow-listed by name in tests/unit/migration-hygiene.test.ts for owner review.
-- Because of them, apply this file in the Supabase SQL editor, not through the MCP execute_sql tool.
-- Undo: supabase/rollbacks/20261124110000_0171_rollback.sql (restores the exact previous live bodies).
-- Tests: supabase/tests/database/1020_provider_commission_accounting.test.sql
-- -----------------------------------------------------------------------------

-- 1. Switches (OFF) ------------------------------------------------------------
insert into public.system_settings (key, value, updated_at) values
  ('payment_provider', '"none"'::jsonb, now()),
  ('payouts_enabled',  'false'::jsonb,  now())
on conflict (key) do nothing;

create or replace function public.provider_collection_enabled()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select value #>> '{}' from public.system_settings where key = 'payment_provider'), 'none') <> 'none'
$$;

create or replace function public.provider_payouts_enabled()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select value #>> '{}' from public.system_settings where key = 'payouts_enabled'), 'false') = 'true'
$$;

-- 2. Constraints ---------------------------------------------------------------
alter table public.jobs
  drop constraint if exists jobs_payment_method_check,
  add constraint jobs_payment_method_check check (payment_method = any (array['direct'::text, 'escrow'::text, 'provider'::text]));

-- A provider-paid job never holds commission credit.
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.jobs'::regclass and conname = 'jobs_provider_no_credit_reserve') then
    alter table public.jobs add constraint jobs_provider_no_credit_reserve
      check (payment_method <> 'provider' or (coalesce(held_commission, 0) = 0 and coalesce(held_commission_promo, 0) = 0));
  end if;
end $$;

alter table public.platform_ledger
  drop constraint if exists platform_ledger_account_check,
  add constraint platform_ledger_account_check check (account = any (array[
    'paynow_clearing'::text, 'manual_topups_clearing'::text, 'payouts_clearing'::text, 'escrow_held'::text,
    'refunds_payable'::text, 'user_wallets'::text, 'platform_revenue'::text, 'admin_adjustments'::text,
    'referral_expense'::text, 'opening_balance'::text,
    -- 0171: provider-collected jobs (kept apart from user_wallets, i.e. commission credit)
    'provider_clearing'::text,         -- money at the payment provider (asset)
    'job_funds_unsettled'::text,       -- customer payments for jobs not yet delivered (liability)
    'driver_payable'::text,            -- driver earnings owed, not yet paid out (liability)
    'provider_refunds_payable'::text,  -- customer refunds owed on provider-paid jobs (liability)
    'provider_fees'::text              -- provider charges borne by ConZ (expense)
  ]));

-- 3. Payments: provider identity ----------------------------------------------
alter table public.payments add column if not exists provider text;
alter table public.payments add column if not exists provider_reference text;
create unique index if not exists payments_provider_reference_key
  on public.payments (provider, provider_reference) where provider_reference is not null;
create unique index if not exists payments_one_open_job_payment
  on public.payments (job_id) where type = 'job_payment' and status in ('initiated', 'paid');

create or replace function public.payments_provider_fields_guard()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.provider is distinct from old.provider then
    raise exception 'Payment % provider is immutable', old.id using errcode = '42501';
  end if;
  if old.provider_reference is not null and new.provider_reference is distinct from old.provider_reference then
    raise exception 'Payment % provider reference is already set', old.id using errcode = '42501';
  end if;
  return new;
end $$;
create or replace trigger trg_payments_provider_fields_guard
  before update on public.payments for each row execute function public.payments_provider_fields_guard();

-- 4. New records ---------------------------------------------------------------
create table if not exists public.provider_payment_events (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null,
  event_id           text not null,
  payment_id         uuid references public.payments(id),
  source             text not null check (source in ('webhook', 'status_check', 'admin')),
  reported_status    text,
  reported_amount    numeric,
  reported_currency  text,
  reported_reference text,
  outcome            text not null,
  detail             text,
  created_at         timestamptz not null default now(),
  unique (provider, event_id)
);

create table if not exists public.driver_payables (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null unique references public.jobs(id),
  driver_id     uuid not null,
  payment_id    uuid not null unique references public.payments(id),
  currency      text not null default 'USD',
  gross_amount  numeric not null check (gross_amount > 0 and gross_amount <= 100000),
  commission    numeric not null check (commission >= 0),
  amount        numeric not null check (amount >= 0),
  status        text not null default 'payable' check (status in ('payable', 'held', 'payout_pending', 'paid_out', 'reversed')),
  hold_reason   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (amount = gross_amount - commission)
);
create index if not exists driver_payables_driver on public.driver_payables (driver_id, created_at desc);

create table if not exists public.driver_payouts (
  id                 uuid primary key default gen_random_uuid(),
  payable_id         uuid not null unique references public.driver_payables(id),
  driver_id          uuid not null,
  amount             numeric not null check (amount > 0 and amount <= 100000),
  currency           text not null default 'USD',
  provider           text not null,
  destination_masked text,
  idempotency_key    text not null unique,
  provider_reference text,
  status             text not null default 'pending' check (status in ('pending', 'sent', 'unknown', 'paid', 'failed')),
  attempts           integer not null default 1 check (attempts between 1 and 5),
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  paid_at            timestamptz
);
create index if not exists driver_payouts_driver on public.driver_payouts (driver_id, created_at desc);

create table if not exists public.provider_fees (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null,
  reference   text not null,
  kind        text not null check (kind in ('collection', 'payout', 'refund', 'other')),
  amount      numeric not null check (amount > 0 and amount <= 100000),
  currency    text not null default 'USD',
  payment_id  uuid references public.payments(id),
  payout_id   uuid references public.driver_payouts(id),
  created_at  timestamptz not null default now(),
  unique (provider, reference, kind)
);

-- Append-only event and fee records; amounts on payables/payouts never change.
create or replace function public.provider_records_append_only()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
create or replace trigger trg_provider_payment_events_append_only
  before update or delete on public.provider_payment_events for each row execute function public.provider_records_append_only();
create or replace trigger trg_provider_fees_append_only
  before update or delete on public.provider_fees for each row execute function public.provider_records_append_only();

create or replace function public.driver_payables_guard()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'driver_payables rows are never deleted' using errcode = '42501';
  end if;
  if new.job_id is distinct from old.job_id or new.driver_id is distinct from old.driver_id
     or new.payment_id is distinct from old.payment_id or new.currency is distinct from old.currency
     or new.gross_amount is distinct from old.gross_amount or new.commission is distinct from old.commission
     or new.amount is distinct from old.amount or new.created_at is distinct from old.created_at then
    raise exception 'Payable % amounts and identity are immutable', old.id using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'payable'        and new.status in ('held', 'payout_pending', 'reversed'))
    or (old.status = 'held'           and new.status in ('payable', 'reversed'))
    or (old.status = 'payout_pending' and new.status in ('payable', 'paid_out'))
  ) then
    raise exception 'Illegal payable status transition % -> %', old.status, new.status using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create or replace trigger trg_driver_payables_guard
  before update or delete on public.driver_payables for each row execute function public.driver_payables_guard();

create or replace function public.driver_payouts_guard()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'driver_payouts rows are never deleted' using errcode = '42501';
  end if;
  if new.payable_id is distinct from old.payable_id or new.driver_id is distinct from old.driver_id
     or new.amount is distinct from old.amount or new.currency is distinct from old.currency
     or new.provider is distinct from old.provider or new.created_at is distinct from old.created_at then
    raise exception 'Payout % amount and identity are immutable', old.id using errcode = '42501';
  end if;
  if old.provider_reference is not null and new.provider_reference is distinct from old.provider_reference then
    raise exception 'Payout % provider reference is already set', old.id using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'pending' and new.status in ('sent', 'paid', 'failed', 'unknown'))
    or (old.status = 'sent'    and new.status in ('paid', 'failed', 'unknown'))
    or (old.status = 'unknown' and new.status in ('paid', 'failed'))   -- only after a status check, never a resend
    or (old.status = 'failed'  and new.status = 'pending')             -- explicit retry (payout_retry)
  ) then
    raise exception 'Illegal payout status transition % -> %', old.status, new.status using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create or replace trigger trg_driver_payouts_guard
  before update or delete on public.driver_payouts for each row execute function public.driver_payouts_guard();

alter table public.provider_payment_events enable row level security;
alter table public.driver_payables enable row level security;
alter table public.driver_payouts enable row level security;
alter table public.provider_fees enable row level security;

revoke all on public.provider_payment_events, public.driver_payables, public.driver_payouts, public.provider_fees from anon, authenticated;
grant select on public.provider_payment_events, public.driver_payables, public.driver_payouts, public.provider_fees to authenticated;
-- The provider adapter (server, service role) reads these; it writes only through the functions below.
grant select on public.provider_payment_events, public.driver_payables, public.driver_payouts, public.provider_fees to service_role;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'driver_payables' and policyname = 'driver_payables_read') then
    create policy driver_payables_read on public.driver_payables for select to authenticated
      using (driver_id = auth.uid() or public.has_role(auth.uid(), 'admin'::public.app_role)
             or public.has_role(auth.uid(), 'super_admin'::public.app_role));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'driver_payouts' and policyname = 'driver_payouts_read') then
    create policy driver_payouts_read on public.driver_payouts for select to authenticated
      using (driver_id = auth.uid() or public.has_role(auth.uid(), 'admin'::public.app_role)
             or public.has_role(auth.uid(), 'super_admin'::public.app_role));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'provider_payment_events' and policyname = 'provider_payment_events_admin_read') then
    create policy provider_payment_events_admin_read on public.provider_payment_events for select to authenticated
      using (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'provider_fees' and policyname = 'provider_fees_admin_read') then
    create policy provider_fees_admin_read on public.provider_fees for select to authenticated
      using (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role));
  end if;
end $$;

-- 5. Job rules for provider-paid jobs -----------------------------------------
-- Created only while a provider is switched on, and only as a transport-only job, so the agreed fare
-- (final_price) is the transport fare and 7% of it is the commission.
create or replace function public.tg_jobs_provider_rules()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.payment_method is distinct from 'provider' then return new; end if;
  if not public.provider_collection_enabled() then
    raise exception 'Paying through ConZ is not available yet. Please pay the driver directly.' using errcode = 'P0001';
  end if;
  if new.pricing_basis is distinct from 'transport_only' then
    raise exception 'Paying through ConZ is only for transport-only bookings.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create or replace trigger trg_jobs_provider_rules
  before insert on public.jobs for each row execute function public.tg_jobs_provider_rules();

-- The driver may not start the trip on a provider-paid job until the payment is confirmed.
create or replace function public.tg_jobs_provider_paid_before_trip()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.payment_method = 'provider' and new.status = 'in_progress' and old.status is distinct from 'in_progress'
     and not exists (select 1 from public.payments p
                      where p.job_id = new.id and p.type = 'job_payment' and p.status = 'paid'
                        and p.amount = new.final_price) then
    raise exception 'The customer''s payment has not been confirmed yet. Wait for it before loading.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create or replace trigger trg_jobs_provider_paid_before_trip
  before update of status on public.jobs for each row execute function public.tg_jobs_provider_paid_before_trip();

-- A cancelled provider-paid job: an unpaid attempt is cancelled; a confirmed payment becomes a refund owed.
create or replace function public.tg_jobs_provider_cancelled()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _p public.payments;
begin
  if new.payment_method is distinct from 'provider' or new.status <> 'cancelled' or old.status = 'cancelled' then
    return new;
  end if;
  update public.payments set status = 'cancelled'
   where job_id = new.id and type = 'job_payment' and status = 'initiated';
  for _p in select * from public.payments
             where job_id = new.id and type = 'job_payment' and status = 'paid' for update loop
    update public.payments set status = 'refund_due' where id = _p.id;
    perform public.post_ledger('provider_refund_due',
      jsonb_build_array(
        jsonb_build_object('account', 'job_funds_unsettled', 'amount', _p.amount),
        jsonb_build_object('account', 'provider_refunds_payable', 'amount', -_p.amount)),
      _p.id, new.id, _p.user_id, 'Job cancelled after payment: refund owed to the customer');
    perform public.notify_payment_anomaly(_p.id, 'Refund owed on a cancelled job',
      format('Job %s was cancelled after the customer paid $%s. Refund it through the provider, then mark it refunded.', new.id, _p.amount));
  end loop;
  return new;
end $$;
create or replace trigger trg_jobs_provider_cancelled
  after update of status on public.jobs for each row execute function public.tg_jobs_provider_cancelled();

-- Admin alert without a payment id (payout events). notify_payment_anomaly needs a payment id.
create or replace function public.notify_finance_admins(_title text, _body text)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.notifications (user_id, type, title, body)
  select distinct ur.user_id, 'payment_anomaly', _title, coalesce(_body, '')
    from public.user_roles ur
   where ur.role in ('admin', 'super_admin');
$$;

-- 6. Payment on a provider-paid job (service role only: called by the provider adapter) -------------
-- One open payment per job; amount = the agreed fare; currency USD.
create or replace function public.create_provider_job_payment(_job_id uuid, _provider text, _provider_reference text default null)
returns public.payments language plpgsql security definer set search_path to 'public' as $$
declare _job public.jobs; _p public.payments;
begin
  if not public.provider_collection_enabled() then
    raise exception 'Paying through ConZ is not available yet.' using errcode = 'P0001';
  end if;
  if _provider is null or _provider !~ '^[a-z][a-z0-9_]{1,30}$' then
    raise exception 'Invalid provider name';
  end if;
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if _job.payment_method is distinct from 'provider' then raise exception 'This job is not paid through ConZ'; end if;
  if _job.status <> 'accepted' then raise exception 'The fare can be paid once a driver is selected and before loading'; end if;
  if not public.is_valid_money(_job.final_price) then raise exception 'The agreed fare is invalid'; end if;

  select * into _p from public.payments
   where job_id = _job_id and type = 'job_payment' and status in ('initiated', 'paid');
  if found then return _p; end if;   -- idempotent: the open payment is reused, never a second charge

  insert into public.payments (user_id, job_id, type, amount, currency, method, status, provider, provider_reference)
  values (_job.customer_id, _job_id, 'job_payment', _job.final_price, 'USD', _provider, 'initiated', _provider, _provider_reference)
  returning * into _p;
  return _p;
end $$;

-- Apply one provider event. Call ONLY after the adapter verified the provider's signature AND re-checked
-- the status with the provider (server to server). A browser redirect is never an event.
-- Returns the outcome; every call is recorded once in provider_payment_events (dedupe on provider + event_id).
create or replace function public.apply_provider_payment(
  _provider text, _event_id text, _payment_id uuid, _status text,
  _amount numeric, _currency text, _reference text, _source text default 'webhook')
returns text language plpgsql security definer set search_path to 'public' as $$
declare _p public.payments; _st text; _outcome text; _detail text;
begin
  if _event_id is null or length(btrim(_event_id)) = 0 then raise exception 'event_id is required'; end if;

  select * into _p from public.payments where id = _payment_id for update;
  if not found or _p.type <> 'job_payment' or _p.provider is distinct from _provider then
    insert into public.provider_payment_events (provider, event_id, payment_id, source, reported_status, reported_amount,
                                                reported_currency, reported_reference, outcome, detail)
    values (_provider, _event_id, null, _source, _status, _amount, _currency, _reference, 'rejected_unknown_payment', _payment_id::text)
    on conflict (provider, event_id) do nothing;
    return 'rejected_unknown_payment';
  end if;

  if exists (select 1 from public.provider_payment_events e where e.provider = _provider and e.event_id = _event_id) then
    return 'duplicate';
  end if;

  _st := case
    when lower(_status) in ('paid', 'success', 'successful', 'completed', 'settled') then 'paid'
    when lower(_status) in ('failed', 'declined', 'error') then 'failed'
    when lower(_status) in ('cancelled', 'canceled', 'expired') then 'cancelled'
    when lower(_status) in ('pending', 'processing', 'initiated', 'created', 'sent') then 'pending'
    when lower(_status) in ('refunded', 'reversed', 'chargeback', 'disputed') then 'reversal'
    else 'unknown' end;

  if _p.provider_reference is not null and _reference is distinct from _p.provider_reference then
    _outcome := 'rejected_reference';
  elsif _st = 'paid' and (_amount is null or round(_amount, 2) <> _p.amount) then
    _outcome := 'rejected_amount';
  elsif _st = 'paid' and upper(coalesce(_currency, '')) <> _p.currency then
    _outcome := 'rejected_currency';
  elsif _st = 'paid' and _p.status = 'initiated' then
    update public.payments set status = 'paid', provider_reference = coalesce(provider_reference, _reference)
     where id = _p.id;
    perform public.post_ledger('provider_payment_received',
      jsonb_build_array(
        jsonb_build_object('account', 'provider_clearing', 'amount', _p.amount),
        jsonb_build_object('account', 'job_funds_unsettled', 'amount', -_p.amount)),
      _p.id, _p.job_id, _p.user_id, 'Customer paid the agreed fare through the provider');
    _outcome := 'applied_paid';
  elsif _st = 'paid' and _p.status in ('paid', 'released') then
    _outcome := 'already_paid';
  elsif _st = 'paid' then
    _outcome := 'late_success_flagged';             -- money arrived for a closed or refunded payment
  elsif _st in ('failed', 'cancelled') and _p.status = 'initiated' then
    update public.payments set status = _st where id = _p.id;
    _outcome := 'applied_' || _st;
  elsif _st in ('failed', 'cancelled') then
    _outcome := 'regression_flagged';               -- out-of-order or reversal: never downgrade a confirmed payment
  elsif _st = 'pending' then
    _outcome := 'pending_no_change';
  elsif _st = 'reversal' and _p.status in ('paid', 'released', 'refund_due') then
    _outcome := 'reversal_flagged';
  else
    _outcome := 'unknown_status_flagged';
  end if;

  insert into public.provider_payment_events (provider, event_id, payment_id, source, reported_status, reported_amount,
                                              reported_currency, reported_reference, outcome, detail)
  values (_provider, _event_id, _p.id, _source, _status, _amount, _currency, _reference, _outcome, _detail);

  if _outcome like 'rejected_%' or _outcome like '%_flagged' then
    perform public.notify_payment_anomaly(_p.id, 'Payment provider event needs review',
      format('Payment %s: provider reported "%s" (%s %s, ref %s); outcome %s.', _p.id, _status, _amount, _currency, _reference, _outcome));
  end if;
  return _outcome;
end $$;

-- 7. Settlement at verified delivery (called from complete_job / driver_confirm_delivery_pin) --------
-- Commission = 7% of the agreed transport fare, taken from the collected payment exactly once.
-- The driver's commission credit is not touched.
create or replace function public.settle_provider_job(_job_id uuid, _actor uuid)
returns public.jobs language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare _job public.jobs; _p public.payments; _rate numeric; _commission numeric; _payable numeric; _lines jsonb;
begin
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if _job.payment_method is distinct from 'provider' then raise exception 'Job % is not a provider-paid job', _job_id; end if;
  if _job.status not in ('accepted', 'in_progress') then raise exception 'Job not in progress'; end if;
  if _job.pricing_basis is distinct from 'transport_only' then
    raise exception 'A provider-paid job must be priced as transport only';
  end if;
  if not public.is_valid_money(_job.final_price) then raise exception 'Job % has an invalid fare', _job_id; end if;

  select * into _p from public.payments
   where job_id = _job_id and type = 'job_payment' and status = 'paid' for update;
  if not found then
    raise exception 'The customer''s payment has not been confirmed yet.' using errcode = 'P0001';
  end if;
  if _p.amount <> _job.final_price then
    raise exception 'The payment ($%) does not match the agreed fare ($%). Contact support.', _p.amount, _job.final_price;
  end if;

  select (value::text)::numeric into _rate from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;
  if not (_rate >= 0 and _rate <= 100) then raise exception 'commission_rate is invalid'; end if;

  _commission := public.commission_amount(_job.final_price, _rate);
  _payable := _p.amount - _commission;
  if not (_commission >= 0 and _payable >= 0 and _commission + _payable = _p.amount) then
    raise exception 'Computed split is invalid for job %', _job_id;
  end if;

  insert into public.driver_payables (job_id, driver_id, payment_id, currency, gross_amount, commission, amount)
  values (_job.id, _job.driver_id, _p.id, _p.currency, _p.amount, _commission, _payable);

  update public.payments set status = 'released' where id = _p.id;

  _lines := jsonb_build_array(jsonb_build_object('account', 'job_funds_unsettled', 'amount', _p.amount));
  if _payable > 0 then
    _lines := _lines || jsonb_build_object('account', 'driver_payable', 'amount', -_payable);
  end if;
  if _commission > 0 then
    _lines := _lines || jsonb_build_object('account', 'platform_revenue', 'amount', -_commission);
  end if;
  perform public.post_ledger('provider_job_settled', _lines, _p.id, _job.id, _job.driver_id,
    format('Provider-paid job settled: fare %s, ConZ %s%% = %s, driver %s', _p.amount, _rate, _commission, _payable));

  update public.driver_profiles set jobs_completed = jobs_completed + 1 where user_id = _job.driver_id;

  update public.jobs
     set status = 'completed', commission = _commission, completed_at = now(), held_commission = null, held_commission_promo = 0
   where id = _job_id
  returning * into _job;

  if to_regprocedure('public.issue_pod(uuid)') is not null then
    perform public.issue_pod(_job_id);
  end if;

  insert into public.notifications (user_id, type, title, body, job_id)
  values (_job.driver_id, 'earnings_recorded', 'Earnings recorded',
          format('$%s for this delivery is recorded as owed to you (fare $%s less ConZ''s %s%%).', _payable, _p.amount, _rate),
          _job.id);
  return _job;
end $$;

-- 8. Refunds -------------------------------------------------------------------
-- After the provider has refunded the customer (cancelled job), a super admin records it.
create or replace function public.admin_mark_provider_refunded(_payment_id uuid, _provider_refund_reference text, _reason text)
returns public.payments language plpgsql security definer set search_path to 'public' as $$
declare _p public.payments;
begin
  if not public.has_role(auth.uid(), 'super_admin'::public.app_role) then
    raise exception 'Only a super admin can confirm refunds' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _provider_refund_reference is null or length(btrim(_provider_refund_reference)) < 3 then
    raise exception 'Enter the provider''s refund reference';
  end if;
  if _reason is null or length(btrim(_reason)) < 5 then raise exception 'A reason is required'; end if;
  select * into _p from public.payments where id = _payment_id for update;
  if not found or _p.type <> 'job_payment' then raise exception 'Payment not found'; end if;
  if _p.user_id = auth.uid() then raise exception 'You cannot confirm a refund of your own payment' using errcode = '42501'; end if;
  if _p.status = 'refunded' then return _p; end if;
  if _p.status <> 'refund_due' then raise exception 'This payment is not waiting for a refund'; end if;

  update public.payments set status = 'refunded' where id = _p.id returning * into _p;
  perform public.post_ledger('provider_refund_paid',
    jsonb_build_array(
      jsonb_build_object('account', 'provider_refunds_payable', 'amount', _p.amount),
      jsonb_build_object('account', 'provider_clearing', 'amount', -_p.amount)),
    _p.id, _p.job_id, _p.user_id, 'Refund paid to the customer, provider ref ' || btrim(_provider_refund_reference));
  perform public.log_admin_action(_action => 'provider_refund_confirmed', _reason => _reason, _target_id => _p.id,
    _target_user => _p.user_id, _meta => jsonb_build_object('amount', _p.amount, 'reference', btrim(_provider_refund_reference)));
  return _p;
end $$;

-- 9. Holding a payable (dispute) -----------------------------------------------------------------
create or replace function public.admin_set_payable_hold(_payable_id uuid, _hold boolean, _reason text)
returns public.driver_payables language plpgsql security definer set search_path to 'public' as $$
declare _r public.driver_payables;
begin
  if not public.has_role(auth.uid(), 'super_admin'::public.app_role) then
    raise exception 'Only a super admin can hold or release driver earnings' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _reason is null or length(btrim(_reason)) < 5 then raise exception 'A reason is required'; end if;
  select * into _r from public.driver_payables where id = _payable_id for update;
  if not found then raise exception 'Payable not found'; end if;
  if _hold and _r.status = 'payable' then
    update public.driver_payables set status = 'held', hold_reason = btrim(_reason) where id = _r.id returning * into _r;
  elsif not _hold and _r.status = 'held' then
    update public.driver_payables set status = 'payable', hold_reason = null where id = _r.id returning * into _r;
  elsif _r.status not in ('payable', 'held') then
    raise exception 'This payable is % and cannot be held or released now', _r.status;
  end if;
  perform public.log_admin_action(_action => case when _hold then 'payable_held' else 'payable_released' end,
    _reason => _reason, _target_id => _r.id, _target_user => _r.driver_id, _meta => jsonb_build_object('amount', _r.amount));
  return _r;
end $$;

-- 10. Payouts (service role only: the provider adapter). OFF while payouts_enabled = false. -------
create or replace function public.payout_prepare(_payable_id uuid, _provider text, _destination_masked text default null)
returns public.driver_payouts language plpgsql security definer set search_path to 'public' as $$
declare _r public.driver_payables; _o public.driver_payouts;
begin
  if not public.provider_payouts_enabled() then
    raise exception 'Driver payouts are switched off.' using errcode = 'P0001';
  end if;
  select * into _r from public.driver_payables where id = _payable_id for update;
  if not found then raise exception 'Payable not found'; end if;
  select * into _o from public.driver_payouts where payable_id = _payable_id for update;
  if found then return _o; end if;   -- idempotent: one payout record per payable
  if _r.status <> 'payable' then raise exception 'This payable is % and cannot be paid out', _r.status; end if;
  if _r.amount <= 0 then raise exception 'Nothing to pay out'; end if;
  if exists (select 1 from public.profiles pr where pr.id = _r.driver_id and pr.status in ('suspended', 'banned')) then
    raise exception 'The driver''s account is not active; payout held' using errcode = 'P0001';
  end if;

  update public.driver_payables set status = 'payout_pending' where id = _r.id;
  insert into public.driver_payouts (payable_id, driver_id, amount, currency, provider, destination_masked, idempotency_key)
  values (_r.id, _r.driver_id, _r.amount, _r.currency, _provider, _destination_masked,
          'conz-payout-' || _r.id::text || '-1')
  returning * into _o;
  return _o;
end $$;

create or replace function public.payout_record_sent(_payout_id uuid, _provider_reference text)
returns public.driver_payouts language plpgsql security definer set search_path to 'public' as $$
declare _o public.driver_payouts;
begin
  select * into _o from public.driver_payouts where id = _payout_id for update;
  if not found then raise exception 'Payout not found'; end if;
  if _o.status <> 'pending' then return _o; end if;
  update public.driver_payouts set status = 'sent', provider_reference = coalesce(provider_reference, _provider_reference)
   where id = _o.id returning * into _o;
  return _o;
end $$;

-- Result of a VERIFIED status check. 'unknown' (timeout, unclear answer) parks the payout: it is never
-- resent until a later status check says paid or failed.
create or replace function public.payout_record_result(_payout_id uuid, _status text, _provider_reference text default null, _error text default null)
returns public.driver_payouts language plpgsql security definer set search_path to 'public' as $$
declare _o public.driver_payouts;
begin
  if _status not in ('paid', 'failed', 'unknown') then raise exception 'Invalid payout status %', _status; end if;
  select * into _o from public.driver_payouts where id = _payout_id for update;
  if not found then raise exception 'Payout not found'; end if;

  if _o.status = 'paid' then
    if _status <> 'paid' then
      perform public.notify_finance_admins('Payout status contradiction',
        format('Payout %s is recorded as paid but the provider now reports %s.', _o.id, _status));
    end if;
    return _o;
  end if;
  if _o.status = 'failed' and _status = 'failed' then return _o; end if;
  if _status = 'unknown' and _o.status = 'unknown' then return _o; end if;

  if _status = 'paid' then
    update public.driver_payouts set status = 'paid', paid_at = now(),
           provider_reference = coalesce(provider_reference, _provider_reference), last_error = null
     where id = _o.id returning * into _o;
    update public.driver_payables set status = 'paid_out' where id = _o.payable_id;
    perform public.post_ledger('driver_payout_paid',
      jsonb_build_array(
        jsonb_build_object('account', 'driver_payable', 'amount', _o.amount),
        jsonb_build_object('account', 'provider_clearing', 'amount', -_o.amount)),
      null, (select job_id from public.driver_payables where id = _o.payable_id), _o.driver_id,
      'Driver payout confirmed, provider ref ' || coalesce(_o.provider_reference, '-'));
  elsif _status = 'failed' then
    update public.driver_payouts set status = 'failed', last_error = left(_error, 500),
           provider_reference = coalesce(provider_reference, _provider_reference)
     where id = _o.id returning * into _o;
    update public.driver_payables set status = 'payable' where id = _o.payable_id;
  else
    update public.driver_payouts set status = 'unknown', last_error = left(_error, 500),
           provider_reference = coalesce(provider_reference, _provider_reference)
     where id = _o.id returning * into _o;
    perform public.notify_finance_admins('Payout outcome unknown',
      format('Payout %s ($%s) has no clear result. Check its status with the provider before any retry.', _o.id, _o.amount));
  end if;
  return _o;
end $$;

-- Retry only a payout the provider confirmed as FAILED (never one that is sent or unknown). Max 5 attempts.
create or replace function public.payout_retry(_payout_id uuid)
returns public.driver_payouts language plpgsql security definer set search_path to 'public' as $$
declare _o public.driver_payouts; _r public.driver_payables;
begin
  if not public.provider_payouts_enabled() then
    raise exception 'Driver payouts are switched off.' using errcode = 'P0001';
  end if;
  select * into _o from public.driver_payouts where id = _payout_id for update;
  if not found then raise exception 'Payout not found'; end if;
  if _o.status <> 'failed' then
    raise exception 'Only a failed payout can be retried (this one is %). Check its status first.', _o.status;
  end if;
  if _o.attempts >= 5 then raise exception 'Retry limit reached; resolve this payout by hand'; end if;
  select * into _r from public.driver_payables where id = _o.payable_id for update;
  if _r.status <> 'payable' then raise exception 'This payable is % and cannot be paid out', _r.status; end if;
  update public.driver_payables set status = 'payout_pending' where id = _r.id;
  update public.driver_payouts
     set status = 'pending', attempts = attempts + 1, last_error = null, provider_reference = null,
         idempotency_key = 'conz-payout-' || _r.id::text || '-' || (attempts + 1)::text
   where id = _o.id returning * into _o;
  return _o;
end $$;

-- 11. Provider fees (service role): recorded once per provider reference; expense to ConZ. -----------
create or replace function public.record_provider_fee(_provider text, _reference text, _kind text, _amount numeric,
                                                      _currency text default 'USD', _payment_id uuid default null,
                                                      _payout_id uuid default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare _id uuid;
begin
  if not public.is_valid_money(_amount) then raise exception 'Invalid fee amount'; end if;
  insert into public.provider_fees (provider, reference, kind, amount, currency, payment_id, payout_id)
  values (_provider, _reference, _kind, _amount, upper(_currency), _payment_id, _payout_id)
  on conflict (provider, reference, kind) do nothing
  returning id into _id;
  if _id is null then return null; end if;   -- already recorded
  perform public.post_ledger('provider_fee',
    jsonb_build_array(
      jsonb_build_object('account', 'provider_fees', 'amount', _amount),
      jsonb_build_object('account', 'provider_clearing', 'amount', -_amount)),
    _payment_id, null, null, format('%s %s fee, ref %s', _provider, _kind, _reference));
  return _id;
end $$;

-- 12. Replaced functions: identical to the live definitions except the marked (0171) provider branches.
--     Grants are kept by CREATE OR REPLACE.
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

  -- (0171) A provider-paid job takes ConZ's 7% from the collected fare at settlement,
  -- never from commission credit, so no credit is needed to accept it.
  if _job.payment_method = 'provider' then
    return jsonb_build_object('ok', true, 'required', 0, 'balance', _bal, 'held', _held, 'available', _avail,
      'promo', _promo, 'shortfall', 0, 'free', false, 'source', 'provider_deduction');
  end if;

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

  -- (0171) Provider-paid job: commission comes out of the collected fare, not commission credit.
  if _job.payment_method = 'provider' then
    return jsonb_build_object('ok', true, 'required', 0, 'available', _avail, 'promo', coalesce(_promo,0),
      'shortfall', 0, 'free', false, 'source', 'provider_deduction');
  end if;

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

  -- (0171) Never reserve commission credit on a provider-paid job: its 7% is taken from the
  -- collected fare once, at settlement (settle_provider_job). Records 0 so the job reads as reserved.
  if _job.payment_method = 'provider' then
    if _job.held_commission is null then
      update public.jobs set held_commission = 0, held_commission_promo = 0 where id = _job_id;
    end if;
    return 0;
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
  elsif _job.payment_method = 'provider' then
    perform public.settle_provider_job(_job_id, auth.uid());   -- (0171)
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
  elsif _job.payment_method = 'provider' then
    perform public.settle_provider_job(_job_id, auth.uid());   -- (0171)
  else
    perform public.settle_direct_pay_job(_job_id, auth.uid());
  end if;

  update public.job_delivery_pins set consumed_at = now() where job_id = _job_id;
  return jsonb_build_object('ok', true, 'job_id', _job_id);
end $fn$;


-- 12b. Account deletion also waits while a driver is still owed earnings (identical to 0083 + one case).
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


-- 13. Reconciliation: the 11 existing checks unchanged, plus 12-17 for provider-collected jobs.
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
  union all
  -- 12. (0171) Driver earnings owed in the ledger equal the open payables.
  select 'driver_payable_matches_payables',
         (select coalesce(-sum(amount), 0) from public.platform_ledger where account = 'driver_payable')
           = (select coalesce(sum(amount), 0) from public.driver_payables where status in ('payable', 'held', 'payout_pending')),
         (select coalesce(sum(amount), 0) from public.driver_payables where status in ('payable', 'held', 'payout_pending')),
         (select coalesce(-sum(amount), 0) from public.platform_ledger where account = 'driver_payable'),
         '{}'::jsonb
  union all
  -- 13. (0171) Customer money for undelivered provider-paid jobs equals the confirmed, unsettled payments.
  select 'job_funds_match_paid_job_payments',
         (select coalesce(-sum(amount), 0) from public.platform_ledger where account = 'job_funds_unsettled')
           = (select coalesce(sum(amount), 0) from public.payments where type = 'job_payment' and status = 'paid'),
         (select coalesce(sum(amount), 0) from public.payments where type = 'job_payment' and status = 'paid'),
         (select coalesce(-sum(amount), 0) from public.platform_ledger where account = 'job_funds_unsettled'),
         '{}'::jsonb
  union all
  -- 14. (0171) Refunds owed on provider-paid jobs equal refund_due job payments.
  select 'provider_refunds_match_payments',
         (select coalesce(-sum(amount), 0) from public.platform_ledger where account = 'provider_refunds_payable')
           = (select coalesce(sum(amount), 0) from public.payments where type = 'job_payment' and status = 'refund_due'),
         (select coalesce(sum(amount), 0) from public.payments where type = 'job_payment' and status = 'refund_due'),
         (select coalesce(-sum(amount), 0) from public.platform_ledger where account = 'provider_refunds_payable'),
         '{}'::jsonb
  union all
  -- 15. (0171) No double commission: a provider-paid job never touches commission credit.
  select 'provider_jobs_never_use_commission_credit', count(*) = 0, 0, count(*)::numeric, coalesce(jsonb_agg(j), '[]'::jsonb)
    from (select j.id as j from public.jobs j
           where j.payment_method = 'provider'
             and (coalesce(j.held_commission, 0) <> 0
                  or exists (select 1 from public.wallet_transactions t where t.job_id = j.id and t.type = 'commission'))) x
  union all
  -- 16. (0171) Each completed provider-paid job was settled exactly once, with commission = 7% of the fare as charged.
  select 'provider_jobs_settled_once', count(*) = 0, 0, count(*)::numeric, coalesce(jsonb_agg(j), '[]'::jsonb)
    from (select j.id as j from public.jobs j
           where j.payment_method = 'provider' and j.status = 'completed'
             and ((select count(distinct l.entry_group) from public.platform_ledger l
                    where l.job_id = j.id and l.kind = 'provider_job_settled') <> 1
                  or (select count(*) from public.driver_payables p where p.job_id = j.id and p.commission = j.commission) <> 1)) x
  union all
  -- 17. (0171) A payable is paid out if and only if its payout is paid.
  select 'payouts_match_payables', count(*) = 0, 0, count(*)::numeric, coalesce(jsonb_agg(p), '[]'::jsonb)
    from (select p.id as p from public.driver_payables p
            left join public.driver_payouts o on o.payable_id = p.id
           where (p.status = 'paid_out') <> coalesce(o.status = 'paid', false)) x
$function$;


-- 14. Grants: internal money functions are service-role only; admin actions check roles themselves.
revoke all on function public.provider_collection_enabled() from public, anon;
revoke all on function public.provider_payouts_enabled() from public, anon;
grant execute on function public.provider_collection_enabled() to authenticated, service_role;
grant execute on function public.provider_payouts_enabled() to authenticated, service_role;

revoke all on function public.notify_finance_admins(text, text) from public, anon, authenticated;
revoke all on function public.create_provider_job_payment(uuid, text, text) from public, anon, authenticated;
revoke all on function public.apply_provider_payment(text, text, uuid, text, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.settle_provider_job(uuid, uuid) from public, anon, authenticated;
revoke all on function public.payout_prepare(uuid, text, text) from public, anon, authenticated;
revoke all on function public.payout_record_sent(uuid, text) from public, anon, authenticated;
revoke all on function public.payout_record_result(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.payout_retry(uuid) from public, anon, authenticated;
revoke all on function public.record_provider_fee(text, text, text, numeric, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.notify_finance_admins(text, text) to service_role;
grant execute on function public.create_provider_job_payment(uuid, text, text) to service_role;
grant execute on function public.apply_provider_payment(text, text, uuid, text, numeric, text, text, text) to service_role;
grant execute on function public.settle_provider_job(uuid, uuid) to service_role;
grant execute on function public.payout_prepare(uuid, text, text) to service_role;
grant execute on function public.payout_record_sent(uuid, text) to service_role;
grant execute on function public.payout_record_result(uuid, text, text, text) to service_role;
grant execute on function public.payout_retry(uuid) to service_role;
grant execute on function public.record_provider_fee(text, text, text, numeric, text, uuid, uuid) to service_role;

revoke all on function public.admin_mark_provider_refunded(uuid, text, text) from public, anon;
revoke all on function public.admin_set_payable_hold(uuid, boolean, text) from public, anon;
grant execute on function public.admin_mark_provider_refunded(uuid, text, text) to authenticated;
grant execute on function public.admin_set_payable_hold(uuid, boolean, text) to authenticated;

revoke all on function public.tg_jobs_provider_rules() from public, anon, authenticated;
revoke all on function public.tg_jobs_provider_paid_before_trip() from public, anon, authenticated;
revoke all on function public.tg_jobs_provider_cancelled() from public, anon, authenticated;
revoke all on function public.payments_provider_fields_guard() from public, anon, authenticated;
revoke all on function public.provider_records_append_only() from public, anon, authenticated;
revoke all on function public.driver_payables_guard() from public, anon, authenticated;
revoke all on function public.driver_payouts_guard() from public, anon, authenticated;
