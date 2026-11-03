-- Undo 0120_payonify_charges. Contains DROP: run it in the Supabase SQL editor, not via the MCP tool.
-- Only safe while no Payonify payment exists (dropping the columns loses which provider took a payment).
-- Check first: select count(*) from public.payments where provider = 'payonify';  -- must be 0

begin;

drop function if exists public.apply_payonify_charge(uuid, text, text, text, text, bigint, text, boolean, text);
drop function if exists public.record_payonify_event(text, text, text, uuid, boolean, text);
drop table if exists public.payonify_webhook_events;
drop trigger if exists trg_payments_provider_fields_immutable on public.payments;
drop function if exists public.payments_provider_fields_immutable();

-- Paynow expiry exactly as in 0073.
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


-- Payment switch: back to 0107 / 0082 bodies (must run before the provider column is dropped).
drop function if exists public.admin_set_payment_provider(text, text);
create or replace function public.launch_switches()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'escrowEnabled',      public._launch_setting_bool('escrow_enabled', false),
    'withdrawalsEnabled', public._launch_setting_bool('withdrawals_enabled', false),
    'maxJobBudget',       public._launch_setting_num('max_job_budget', 500),
    'maxWalletBalance',   public._launch_setting_num('max_wallet_balance', 150),
    'minTopup',           public._launch_setting_num('min_topup', 1)
  );
$$;
drop function if exists public.payment_provider();
delete from public.system_settings where key = 'payment_provider';
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

drop index if exists public.payment_events_provider_event_key;
alter table public.payment_events drop column if exists provider_event_id, drop column if exists provider;

drop index if exists public.payments_provider_reference_key;
drop index if exists public.payments_one_open_payonify_per_job;
drop index if exists public.payments_one_open_payonify_topup_per_user;
alter table public.payments
  drop constraint if exists payments_payonify_types,
  drop constraint if exists payments_payonify_fields_check,
  drop constraint if exists payments_provider_check,
  drop column if exists provider_livemode,
  drop column if exists provider_reference,
  drop column if exists provider;

commit;
