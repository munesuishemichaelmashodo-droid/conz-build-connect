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

drop index if exists public.payment_events_provider_event_key;
alter table public.payment_events drop column if exists provider_event_id, drop column if exists provider;

drop index if exists public.payments_provider_reference_key;
drop index if exists public.payments_one_open_payonify_per_job;
alter table public.payments
  drop constraint if exists payments_payonify_escrow_only,
  drop constraint if exists payments_payonify_fields_check,
  drop constraint if exists payments_provider_check,
  drop column if exists provider_livemode,
  drop column if exists provider_reference,
  drop column if exists provider;

commit;
