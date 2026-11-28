-- -----------------------------------------------------------------------------
-- 0190: Paynow fails closed — OFF / TEST / LIVE mode, no credit while BuySafe holds the money (replaces the outdated
-- PR #18 / 0116 on the current state machine).
--
-- Kept from 0073 unchanged: hash-verified results only (app), reference == payment id, amount == stored amount
-- (checked first), one credit per payment (row lock + status), duplicates ignored, failed/cancelled closed,
-- refunded/disputed after credit flagged for a human, every result in payment_events.
--
-- Added:
--   * paynow_mode(): 'off' | 'test' | 'live' from system_settings 'paynow_mode'. Missing or invalid = 'off'.
--       off  - the app starts no Paynow payment; a success result is recorded and flagged, never credited.
--       test - the app runs simulated flows only and never calls Paynow; the database credits nothing.
--       live - real top-ups, as today. Set only by a super admin with a fresh step-up and a reason (audited),
--              after the company merchant account and settlement are confirmed and the owner approves.
--     A success result outside LIVE keeps the payment 'initiated' (reconcile credits it once LIVE), so no money is
--     lost and nothing is credited early.
--   * BuySafe: "Awaiting Delivery" no longer credits. It sets payments.awaiting_settlement_since and alerts admins
--     once; "Paid"/"Delivered" then credits exactly once. Such payments are never auto-expired.
--
-- !! Production effect when applied: this file does NOT write 'paynow_mode', so production reads 'off' and new
-- !! top-ups stop until the owner chooses a mode (admin_set_paynow_mode). See the PR for the apply steps.
-- No DROP, no DELETE, no balance changes. Recovery (forward-safe): supabase/rollbacks/20261127110000_0190_rollback.sql.
-- -----------------------------------------------------------------------------

alter table public.payments add column if not exists awaiting_settlement_since timestamptz;

create or replace function public.paynow_mode()
returns text language sql stable security definer set search_path to 'public' as $$
  select case when v in ('off', 'test', 'live') then v else 'off' end
    from (select coalesce((select lower(value #>> '{}') from public.system_settings where key = 'paynow_mode'), 'off') as v) s
$$;
revoke all on function public.paynow_mode() from public, anon;
grant execute on function public.paynow_mode() to authenticated, service_role;

create or replace function public.admin_set_paynow_mode(_mode text, _reason text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare _before text := public.paynow_mode(); _why text := nullif(btrim(coalesce(_reason, '')), '');
begin
  if not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Only a super admin can change the payment mode.' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _mode is null or _mode not in ('off', 'test', 'live') then raise exception 'Mode must be off, test or live.' using errcode = '22023'; end if;
  if _why is null or length(_why) < 10 then raise exception 'Give the reason (at least 10 characters).' using errcode = '22023'; end if;
  insert into public.system_settings (key, value) values ('paynow_mode', to_jsonb(_mode))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.log_admin_action('paynow_mode_set', jsonb_build_object('from', _before, 'to', _mode), _why, null, null);
  return _mode;
end $$;
revoke all on function public.admin_set_paynow_mode(text, text) from public, anon;
grant execute on function public.admin_set_paynow_mode(text, text) to authenticated;

CREATE OR REPLACE FUNCTION public.apply_paynow_result(
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
    elsif _p.status = 'initiated' and _s = 'awaiting delivery' then
      -- (0190) BuySafe: Paynow holds the money and the buyer can still dispute. Record it, credit nothing yet;
      -- the later "Paid"/"Delivered" result credits exactly once.
      update public.payments
         set awaiting_settlement_since = coalesce(awaiting_settlement_since, now()),
             paynow_reference = coalesce(nullif(_paynow_reference, ''), paynow_reference),
             reported_amount = _amt
       where id = _p.id;
      _outcome := 'awaiting_settlement_no_credit';
      if _p.awaiting_settlement_since is null then
        perform public.notify_payment_anomaly(_p.id, 'Paynow is holding a payment (BuySafe)',
          format('Paynow reports $%s as Awaiting Delivery. Nothing is credited until Paynow reports it Paid or Delivered.', _p.amount));
      end if;
    elsif _p.status = 'initiated' and public.paynow_mode() <> 'live' then
      -- (0190) fail closed: outside LIVE mode a success result is recorded and flagged, never credited.
      -- The payment stays 'initiated' so it can be credited once LIVE is approved (reconcile), never lost.
      update public.payments
         set paynow_reference = coalesce(nullif(_paynow_reference, ''), paynow_reference),
             reported_amount = _amt
       where id = _p.id;
      _outcome := 'held_mode_not_live';
      perform public.notify_payment_anomaly(_p.id, 'Paynow payment received while payments are not live',
        format('Paynow reports $%s paid while Con Z payment mode is %s. Nothing was credited; review it.', _p.amount, public.paynow_mode()));
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
  -- (0190) never expire a payment Paynow is holding under BuySafe
  if _p.awaiting_settlement_since is not null then return 'held_by_paynow'; end if;
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
