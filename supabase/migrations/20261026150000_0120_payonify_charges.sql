-- -----------------------------------------------------------------------------
-- 0120: record Payonify (Relay) charges next to Paynow, with one guarded state change.
--
-- PREPARED, NOT APPLIED. Needs the owner's approval before production. No DROP
-- (safe for the Supabase MCP tool). Undo: supabase/rollbacks/20261026150000_0120_rollback.sql.
--
-- Paynow is untouched: apply_paynow_result, its callback, columns and history stay as they
-- are, and every existing row keeps provider = 'paynow' (the column default).
--
-- What this adds:
--   1. payments.provider ('paynow' | 'payonify'), provider_reference (the Payonify charge id,
--      e.g. ch_...), provider_livemode (test or live charge). Set once, never changed, and
--      unique per provider so one charge can never pay two ConZ payments. Customers can read
--      provider (which service took their payment); the charge id and mode stay server-side.
--   2. payment_events.provider and provider_event_id (the webhook event id, evt_...), unique
--      per provider, so a re-delivered webhook is recorded once and applied once.
--   3. apply_payonify_charge(): service_role only. Mirrors apply_paynow_result: locks the
--      payment, checks it is a Payonify payment, that the charge belongs to it (charge id and
--      metadata), that test/live mode, currency and amount match; succeeded marks an escrow
--      payment paid / credits a top-up exactly once; failed/cancelled close an unpaid one;
--      nothing ever moves a paid payment backwards; anomalies notify admins. Every call is
--      logged in payment_events. The caller passes the charge as re-fetched from Payonify's
--      API, never the webhook body alone.
--   4. The payment switch: system_settings 'payment_provider' ('paynow' default | 'payonify'),
--      read through launch_switches().paymentProvider, changed only by a super admin with a
--      recent step-up via admin_set_payment_provider() (audit-logged). The app starts new
--      payments only through the selected provider; payments already in flight finish where
--      they started. Applying this migration does NOT switch anything: the default is Paynow.
--   5. credit_wallet_from_payment(): same as 0082, but the wallet note and notification name
--      the provider that took the money (Paynow or EcoCash) instead of always "Paynow".
-- Statuses are Payonify's documented charge statuses (docs.payonify.com/api/charges, 26/10/2026):
-- requires_payment_method, requires_authorization, pending, succeeded, failed, cancelled.
-- -----------------------------------------------------------------------------

begin;

alter table public.payments
  add column if not exists provider text not null default 'paynow',
  add column if not exists provider_reference text,
  add column if not exists provider_livemode boolean;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_provider_check') then
    alter table public.payments
      add constraint payments_provider_check check (provider in ('paynow', 'payonify'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payments_payonify_fields_check') then
    -- A Payonify payment always knows whether it is a test or a live charge.
    alter table public.payments
      add constraint payments_payonify_fields_check
      check (provider <> 'payonify' or provider_livemode is not null);
  end if;
end $$;

create unique index if not exists payments_provider_reference_key
  on public.payments (provider, provider_reference) where provider_reference is not null;

-- At most one open Payonify attempt per job, even if the customer taps Pay on two devices at
-- once (the app also checks; this makes it impossible). Paynow rows are not affected.
create unique index if not exists payments_one_open_payonify_per_job
  on public.payments (job_id) where provider = 'payonify' and status = 'initiated';

-- Payonify takes Con Z Pay (escrow) payments and driver wallet top-ups only.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_payonify_types') then
    alter table public.payments
      add constraint payments_payonify_types check (provider <> 'payonify' or type in ('escrow', 'topup'));
  end if;
end $$;

-- At most one open Payonify top-up per user (same reason as the per-job index above).
create unique index if not exists payments_one_open_payonify_topup_per_user
  on public.payments (user_id) where provider = 'payonify' and status = 'initiated' and type = 'topup';

grant select (provider) on public.payments to authenticated;

alter table public.payment_events
  add column if not exists provider text not null default 'paynow',
  add column if not exists provider_event_id text;

create unique index if not exists payment_events_provider_event_key
  on public.payment_events (provider, provider_event_id) where provider_event_id is not null;

-- The provider fields are set once: the provider and test/live mode at creation, the charge
-- id when Payonify returns it. payments_guard_transition (0073) still guards everything else.
create or replace function public.payments_provider_fields_immutable()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.provider is distinct from old.provider
     or new.provider_livemode is distinct from old.provider_livemode
     or (old.provider_reference is not null
         and new.provider_reference is distinct from old.provider_reference) then
    raise exception 'Payment % provider fields are set once', old.id using errcode = '42501';
  end if;
  return new;
end $$;

create or replace trigger trg_payments_provider_fields_immutable
  before update on public.payments
  for each row execute function public.payments_provider_fields_immutable();

-- Paynow's expiry (0073) closes any initiated payment without a Paynow poll URL after 1 hour.
-- A Payonify payment never has a Paynow poll URL, so without this guard a customer still
-- approving an EcoCash prompt could have their payment cancelled under them. Same bodies as
-- 0073 plus "Paynow rows only"; nothing else changes for Paynow.
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
  if _p.provider <> 'paynow' then return 'not_paynow'; end if;
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
     where status = 'initiated' and provider = 'paynow'
       and paynow_poll_url is null and created_at < now() - interval '1 hour'
  loop
    if public.expire_stale_paynow_payment(_id) = 'expired' then _n := _n + 1; end if;
  end loop;
  return _n;
end $$;
revoke all on function public.expire_unsent_paynow_payments() from public, anon, authenticated;
grant execute on function public.expire_unsent_paynow_payments() to service_role;

create or replace function public.apply_payonify_charge(
  _payment_id          uuid,
  _source              text,      -- 'initiate' | 'ipn' (webhook) | 'poll' (status check) | 'reconcile'
  _event_id            text,      -- webhook event id (evt_...), null for API checks
  _charge_id           text,
  _charge_status       text,
  _amount_minor        bigint,    -- charge amount.value (smallest unit)
  _currency            text,      -- charge amount.currency
  _livemode            boolean,
  _metadata_payment_id text       -- charge metadata.conz_payment_id
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _p       public.payments;
  _s       text := lower(btrim(coalesce(_charge_status, '')));
  _amt     numeric;
  _outcome text;
  _detail  text;
  _before  text;
begin
  if _source not in ('initiate', 'ipn', 'poll', 'reconcile') then
    raise exception 'Unknown result source %', _source;
  end if;

  -- A re-delivered webhook event is recorded once and applied once.
  if _event_id is not null and exists (
       select 1 from public.payment_events
        where provider = 'payonify' and provider_event_id = _event_id) then
    return jsonb_build_object('outcome', 'duplicate_event');
  end if;

  select * into _p from public.payments where id = _payment_id for update;
  if not found then raise exception 'payment_not_found' using errcode = 'P0002'; end if;
  _before := _p.status;
  _amt := round(_amount_minor::numeric / 100, 2);

  if _p.provider <> 'payonify' or _p.type not in ('escrow', 'topup') then
    _outcome := 'rejected_wrong_provider';
    _detail := format('payment provider %s, type %s', _p.provider, _p.type);
  elsif _charge_id is null or btrim(_charge_id) = ''
        or (_p.provider_reference is not null and _p.provider_reference <> _charge_id)
        or _metadata_payment_id is distinct from _p.id::text then
    _outcome := 'rejected_reference_mismatch';
    _detail := format('charge %s, metadata %s', coalesce(_charge_id, '<none>'), coalesce(_metadata_payment_id, '<none>'));
    perform public.notify_payment_anomaly(_p.id, 'Payonify charge did not match the payment',
      'A Payonify charge result did not match the payment it was applied to. Nothing was changed.');
  elsif _livemode is distinct from _p.provider_livemode then
    _outcome := 'rejected_mode_mismatch';
    _detail := format('charge livemode %s, payment livemode %s', _livemode, _p.provider_livemode);
    perform public.notify_payment_anomaly(_p.id, 'Payonify test/live mismatch',
      'A Payonify charge in the other mode (test vs live) was reported for this payment. Nothing was changed.');
  elsif lower(coalesce(_currency, '')) <> lower(_p.currency) then
    _outcome := 'rejected_currency_mismatch';
    _detail := format('reported %s, expected %s', coalesce(_currency, '<none>'), _p.currency);
    perform public.notify_payment_anomaly(_p.id, 'Payonify currency mismatch',
      format('Payonify reported %s for a %s payment. Nothing was changed.', coalesce(_currency, '?'), _p.currency));
  elsif _s = 'succeeded' then
    if _amount_minor is null or _amt <> _p.amount then
      _outcome := 'rejected_amount_mismatch';
      _detail := format('reported %s, expected %s', coalesce(_amt::text, '<none>'), _p.amount);
      perform public.notify_payment_anomaly(_p.id, 'Payonify amount mismatch',
        format('Payonify reported $%s for a $%s payment. Nothing was changed; check the Payonify dashboard.',
               coalesce(_amt::text, '?'), _p.amount));
    elsif _p.status = 'initiated' then
      update public.payments
         set provider_reference = coalesce(provider_reference, _charge_id),
             reported_amount = _amt
       where id = _p.id;
      if _p.type = 'escrow' then
        perform public.mark_escrow_payment_paid(_p.id);
        _outcome := 'escrow_marked_paid';
      else
        perform public.credit_wallet_from_payment(_p.id);
        _outcome := 'credited';
      end if;
    elsif _p.status in ('paid', 'released', 'refund_due', 'refunded') then
      _outcome := 'duplicate_ignored';
    else
      -- Closed locally but Payonify says it succeeded: money may have moved. A human decides.
      _outcome := 'late_success_flagged';
      perform public.notify_payment_anomaly(_p.id, 'Payonify payment succeeded after it was closed',
        format('Payonify reports $%s as succeeded, but ConZ had it as %s. Check the Payonify dashboard and refund or apply manually.',
               _p.amount, _p.status));
    end if;
  elsif _s in ('failed', 'cancelled') then
    if _p.status = 'initiated' then
      update public.payments
         set status = case when _s = 'cancelled' then 'cancelled' else 'failed' end,
             provider_reference = coalesce(provider_reference, _charge_id)
       where id = _p.id;
      _outcome := 'closed_unpaid';
    elsif _p.status in ('failed', 'cancelled') then
      _outcome := 'duplicate_ignored';
    else
      _outcome := 'regression_blocked';
      perform public.notify_payment_anomaly(_p.id, 'Payonify reported a completed payment as ' || _s,
        format('Status stays %s. Check the Payonify dashboard.', _p.status));
    end if;
  elsif _s in ('requires_payment_method', 'requires_authorization', 'pending') then
    if _p.status = 'initiated' and _p.provider_reference is null then
      update public.payments set provider_reference = _charge_id where id = _p.id;
    end if;
    _outcome := 'pending_no_change';
  else
    _outcome := 'unknown_status_ignored';
    _detail := format('status %s', coalesce(_charge_status, '<none>'));
  end if;

  update public.payments
     set last_checked_at = now(), check_count = check_count + 1
   where id = _p.id;

  select * into _p from public.payments where id = _payment_id;

  insert into public.payment_events
    (payment_id, source, reported_status, reported_amount, reported_reference,
     status_before, status_after, outcome, detail, provider, provider_event_id)
  values
    (_p.id, _source, _charge_status, _amt::text, _charge_id,
     _before, _p.status, _outcome, _detail, 'payonify', _event_id);

  return jsonb_build_object('outcome', _outcome, 'status', _p.status);
end $$;

revoke all on function public.apply_payonify_charge(uuid, text, text, text, text, bigint, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.apply_payonify_charge(uuid, text, text, text, text, bigint, text, boolean, text)
  to service_role;

-- A verified webhook event that ConZ does not act on yet (transfers, refunds, reversals,
-- payouts, checkout, or a charge that names no ConZ payment) is still recorded once, so admins
-- can see it and nothing is lost. payment_events needs a payment, so these get their own table.
create table if not exists public.payonify_webhook_events (
  id          uuid primary key default gen_random_uuid(),
  event_id    text not null unique,
  event_type  text not null,
  object_id   text,
  payment_id  uuid references public.payments(id),
  livemode    boolean,
  outcome     text not null,
  received_at timestamptz not null default now()
);
alter table public.payonify_webhook_events enable row level security;
revoke all on public.payonify_webhook_events from anon, authenticated;
grant select on public.payonify_webhook_events to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                   and tablename = 'payonify_webhook_events' and policyname = 'Admins read Payonify events') then
    create policy "Admins read Payonify events" on public.payonify_webhook_events
      for select to authenticated
      using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));
  end if;
end $$;

create or replace function public.record_payonify_event(
  _event_id text, _event_type text, _object_id text, _payment_id uuid, _livemode boolean, _outcome text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if _event_id is null or btrim(_event_id) = '' or _event_type is null then
    raise exception 'event id and type required';
  end if;
  insert into public.payonify_webhook_events (event_id, event_type, object_id, payment_id, livemode, outcome)
  values (_event_id, _event_type, _object_id, _payment_id, _livemode, coalesce(_outcome, 'recorded_unhandled'))
  on conflict (event_id) do nothing;
  return jsonb_build_object('outcome', case when found then coalesce(_outcome, 'recorded_unhandled') else 'duplicate_event' end);
end $$;

revoke all on function public.record_payonify_event(text, text, text, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.record_payonify_event(text, text, text, uuid, boolean, text) to service_role;

-- -----------------------------------------------------------------------------
-- The payment switch (4)
-- -----------------------------------------------------------------------------
insert into public.system_settings (key, value) values ('payment_provider', '"paynow"'::jsonb)
on conflict (key) do nothing;

-- Which provider takes NEW payments. Anything unreadable or unknown means Paynow.
create or replace function public.payment_provider()
returns text
language plpgsql stable security definer set search_path = public
as $$
declare _v text;
begin
  select value #>> '{}' into _v from public.system_settings where key = 'payment_provider';
  return case when _v = 'payonify' then 'payonify' else 'paynow' end;
exception when others then
  return 'paynow';
end $$;
revoke all on function public.payment_provider() from public, anon, authenticated;
grant execute on function public.payment_provider() to service_role;

-- Same as 0107 plus paymentProvider.
create or replace function public.launch_switches()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'escrowEnabled',      public._launch_setting_bool('escrow_enabled', false),
    'withdrawalsEnabled', public._launch_setting_bool('withdrawals_enabled', false),
    'maxJobBudget',       public._launch_setting_num('max_job_budget', 500),
    'maxWalletBalance',   public._launch_setting_num('max_wallet_balance', 150),
    'minTopup',           public._launch_setting_num('min_topup', 1),
    'paymentProvider',    public.payment_provider()
  );
$$;
revoke all on function public.launch_switches() from public, anon;
grant execute on function public.launch_switches() to authenticated, service_role;

create or replace function public.admin_set_payment_provider(_provider text, _reason text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare _before text := public.payment_provider();
begin
  if not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Only super admins can change the payment provider';
  end if;
  perform public.require_aal2();
  if _provider is null or _provider not in ('paynow', 'payonify') then
    raise exception 'Provider must be paynow or payonify';
  end if;
  if _reason is null or length(btrim(_reason)) < 5 then
    raise exception 'Give a reason (at least 5 characters)';
  end if;
  insert into public.system_settings(key, value, updated_by, updated_at)
  values ('payment_provider', to_jsonb(_provider), auth.uid(), now())
  on conflict (key) do update
     set value = excluded.value, updated_by = auth.uid(), updated_at = now();
  perform public.log_admin_action(
    _action => 'payment_provider_changed',
    _meta   => jsonb_build_object('from', _before, 'to', _provider, 'reason', btrim(_reason)));
  return _provider;
end $$;
revoke all on function public.admin_set_payment_provider(text, text) from public, anon;
grant execute on function public.admin_set_payment_provider(text, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- (5) credit_wallet_from_payment: body of 0082, provider-aware wording only.
-- Ledger accounts are unchanged (paynow_clearing): see PAYONIFY-INTEGRATION.md.
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
  _via text;
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

  _via := case when _p.provider = 'payonify' then 'EcoCash' else 'Paynow' end;

  insert into public.wallets(user_id, balance) values (_p.user_id, 0)
    on conflict (user_id) do nothing;

  update public.wallets
     set balance = balance + _p.amount, updated_at = now(), limited = false
   where user_id = _p.user_id
  returning balance into _new_bal;

  insert into public.wallet_transactions(user_id, type, amount, balance_after, note, created_by)
  values (_p.user_id, 'topup', _p.amount, _new_bal,
          format('%s top-up (ref %s)', _via, coalesce(_p.paynow_reference, _p.provider_reference, '-')),
          _p.user_id);
  -- Ledger (0082)
  perform public.post_ledger('paynow_topup',
    jsonb_build_array(
      jsonb_build_object('account', 'paynow_clearing', 'amount',  _p.amount),
      jsonb_build_object('account', 'user_wallets', 'amount', -(_p.amount))),
    _p.id, null, _p.user_id, _via || ' top-up');

  update public.payments set status = 'paid', updated_at = now() where id = _payment_id;

  insert into public.wallet_audit_log(user_id, actor_id, action, meta)
  values (_p.user_id, _p.user_id, 'paynow_topup_credited',
          jsonb_build_object('payment_id', _payment_id, 'amount', _p.amount,
                             'currency', _p.currency, 'provider', _p.provider));

  insert into public.notifications(user_id, type, title, body)
  values (_p.user_id, 'wallet_topup', 'Top-up successful',
          format('$%s added to your wallet via %s.', _p.amount::text, _via));

  select * into _w from public.wallets where user_id = _p.user_id;
  return _w;
end $function$;

commit;
