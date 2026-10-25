-- -----------------------------------------------------------------------------
-- 0116: credit a Paynow top-up when Paynow says the money is settled, not while
-- BuySafe still holds it.
--
-- PREPARED, NOT APPLIED. Owner decision needed (docs/payments/ARCHITECTURE-DECISION.md,
-- decision 6). No DROP: safe for the MCP tool, but apply only after approval.
-- Undo: supabase/rollbacks/20261026120000_0116_rollback.sql (exact production
-- definitions of 25/10/2026; the new column is left in place, harmless).
--
-- Why (production, 25/10/2026): apply_paynow_result credits the driver's wallet on
-- "Paid", "Awaiting Delivery" or "Delivered". Paynow's own documentation: BuySafe
-- escrow is on by default and only Verified merchants may disable it; "Awaiting
-- Delivery" means Paynow holds the buyer's money until delivery is confirmed, and the
-- buyer can still dispute. So a driver could spend credit (on commission) that ConZ
-- may never receive. ConZ's merchant account is not Verified yet (3-month minimum).
--
-- What changes:
--   * payments.awaiting_settlement_since: set the first time Paynow reports
--     "Awaiting Delivery" for a top-up. No credit; payment stays 'initiated'; admins
--     get one notification asking them to confirm delivery in the Paynow portal.
--     When Paynow then reports "Delivered" (or "Paid"), the existing first-success path
--     credits exactly once.
--   * expire_stale_paynow_payment skips payments Paynow is holding, so the 72-hour
--     expiry can't cancel them before delivery is confirmed.
--   * Owner switch: system_settings 'paynow_credit_on_awaiting_delivery' = true
--     restores the old behaviour (credit on Awaiting Delivery). Absent = false.
--   * Unchanged: hash/reference/amount checks (amount still checked first), Paid,
--     duplicates, failures, refunds/disputes, escrow payments (escrow is switched off).
-- -----------------------------------------------------------------------------

begin;

alter table public.payments add column if not exists awaiting_settlement_since timestamptz;
comment on column public.payments.awaiting_settlement_since is
  'First time Paynow reported "Awaiting Delivery" (BuySafe holding the money). Top-ups are not credited until Paid/Delivered (0116).';

CREATE OR REPLACE FUNCTION public.apply_paynow_result(_payment_id uuid, _source text, _status text, _reported_amount text, _reported_reference text, _paynow_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    elsif _p.status = 'initiated'
          and _s = 'awaiting delivery'
          and _p.type = 'topup'
          and not coalesce((select value = 'true'::jsonb from public.system_settings
                             where key = 'paynow_credit_on_awaiting_delivery'), false) then
      -- 0116: BuySafe holds the money; credit when Paynow reports Paid/Delivered.
      update public.payments
         set paynow_reference = coalesce(nullif(_paynow_reference, ''), paynow_reference),
             reported_amount = _amt,
             awaiting_settlement_since = coalesce(awaiting_settlement_since, now())
       where id = _p.id;
      _outcome := 'awaiting_settlement';
      if _p.awaiting_settlement_since is null then
        perform public.notify_payment_anomaly(_p.id, 'Top-up held by Paynow BuySafe',
          format('A $%s top-up is paid but Paynow is holding it (Awaiting Delivery). Confirm delivery in the Paynow portal; Con Z credits the driver when Paynow reports it delivered.',
                 _p.amount));
      end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.expire_stale_paynow_payment(_payment_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _p public.payments;
begin
  select * into _p from public.payments where id = _payment_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if _p.status <> 'initiated' then return 'not_initiated'; end if;
  -- 0116: Paynow is holding the money (Awaiting Delivery); wait for Delivered.
  if _p.awaiting_settlement_since is not null then return 'awaiting_settlement'; end if;
  if not (   (_p.paynow_poll_url is not null and _p.created_at < now() - interval '72 hours')
          or (_p.paynow_poll_url is null     and _p.created_at < now() - interval '1 hour')) then
    return 'too_recent';
  end if;
  update public.payments set status = 'cancelled' where id = _p.id;
  insert into public.payment_events (payment_id, source, status_before, status_after, outcome, detail)
  values (_p.id, 'expiry', 'initiated', 'cancelled', 'expired_unpaid',
          case when _p.paynow_poll_url is null then 'never reached Paynow' else 'unpaid after 72h' end);
  return 'expired';
end $function$;

commit;
