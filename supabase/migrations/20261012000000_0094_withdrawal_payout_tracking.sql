-- 0094 — manual withdrawal payout tracking (overnight readiness work, 12/10/2026)
--
-- Gap closed: approving a withdrawal debits the wallet but nothing recorded whether the money was
-- ever actually sent. Payouts are MANUAL (no payout provider is integrated, and none is invented
-- here). This migration adds the missing record, mirroring admin_mark_escrow_refunded:
--
--   * wallet_withdrawal_requests gains paid_at / paid_by / payout_reference / payout_note.
--     `status` is untouched ('approved' still means "approved and debited"); a payout is
--     CONFIRMED only when paid_at is set by an admin who typed the transfer reference.
--   * admin_mark_withdrawal_paid(): admin or super_admin (super_admin needs aal2, like approval),
--     never for their own withdrawal, idempotent, audited, notifies the driver.
--   * financial_request_guard(): the single change allowed on an approved withdrawal is setting the
--     payout fields once, and never from a client session.
--   * admin_approve_withdrawal(): same logic as before; only the driver notification is reworded so
--     it no longer reads as "money withdrawn / sent" (it is "approved, payout pending").
--
-- No wallet balance, ledger entry or existing row is changed by this migration.

alter table public.wallet_withdrawal_requests
  add column if not exists paid_at          timestamptz,
  add column if not exists paid_by          uuid references auth.users(id),
  add column if not exists payout_reference text,
  add column if not exists payout_note      text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'wd_payout_requires_approved_and_reference') then
    alter table public.wallet_withdrawal_requests
      add constraint wd_payout_requires_approved_and_reference
      check (paid_at is null
             or (status = 'approved' and paid_by is not null
                 and payout_reference is not null and length(btrim(payout_reference)) >= 3));
  end if;
end $$;

create or replace function public.financial_request_guard()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare _is_client boolean := current_user in ('authenticated', 'anon');
begin
  if new.id is distinct from old.id
     or new.user_id    is distinct from old.user_id
     or new.amount     is distinct from old.amount
     or new.method     is distinct from old.method
     or new.note       is distinct from old.note
     or new.created_at is distinct from old.created_at
  then
    raise exception 'A submitted request cannot be changed. Cancel it and submit a new one.' using errcode = '42501';
  end if;

  if tg_table_name = 'wallet_withdrawal_requests' then
    if new.destination is distinct from old.destination then
      raise exception 'A submitted withdrawal''s destination cannot be changed. Cancel it and submit a new one.' using errcode = '42501';
    end if;

    -- 0094: recording the manual payout is the only change allowed on an approved withdrawal.
    if old.status = 'approved' and new.status = 'approved' and old.paid_at is null
       and new.paid_at is not null and not _is_client
       and new.decided_by    is not distinct from old.decided_by
       and new.decided_at    is not distinct from old.decided_at
       and new.reject_reason is not distinct from old.reject_reason
    then
      return new;
    end if;
    if new.paid_at          is distinct from old.paid_at
       or new.paid_by          is distinct from old.paid_by
       or new.payout_reference is distinct from old.payout_reference
       or new.payout_note      is distinct from old.payout_note
    then
      raise exception 'Payout details can only be recorded once, by an admin, on an approved withdrawal.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'wallet_topup_requests' then
    if new.reference is distinct from old.reference then
      raise exception 'A submitted top-up''s reference cannot be changed. Cancel it and submit a new one.' using errcode = '42501';
    end if;
  end if;

  if old.status <> 'pending' then
    raise exception 'This request has already been %.', old.status using errcode = '42501';
  end if;
  if new.status not in ('pending', 'cancelled', 'approved', 'rejected') then
    raise exception 'Invalid request status %', new.status using errcode = '42501';
  end if;

  if _is_client then
    -- The only change a client may make: the owner cancels their own request.
    if not (new.status = 'cancelled'
            and old.user_id = auth.uid()
            and new.decided_by is not distinct from old.decided_by
            and new.reject_reason is not distinct from old.reject_reason) then
      raise exception 'Only the owner can cancel a pending request; approvals go through the admin tools.' using errcode = '42501';
    end if;
  end if;

  return new;
end $function$;

-- Same logic as before; only the driver-facing notification text changes.
create or replace function public.admin_approve_withdrawal(_id uuid)
 returns wallets
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _r public.wallet_withdrawal_requests; _new_bal numeric; _w public.wallets;
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'super_admin')) then raise exception 'Forbidden'; end if;
  -- F5: super_admin money actions require MFA.
  if public.has_role(auth.uid(),'super_admin') then perform public.require_aal2(); end if;
  select * into _r from public.wallet_withdrawal_requests where id=_id for update;
  if _r is null or _r.status <> 'pending' then raise exception 'Not pending'; end if;
  if _r.user_id = auth.uid() then raise exception 'You cannot approve your own withdrawal.'; end if;
  select * into _w from public.wallets where user_id = _r.user_id for update;
  if coalesce(_w.limited, false) then raise exception 'This wallet is limited; resolve that before paying out.'; end if;
  if coalesce(_w.balance,0) - coalesce(_w.held,0) < _r.amount then raise exception 'Insufficient available balance (held funds are reserved).'; end if;
  update public.wallets set balance = balance - _r.amount, updated_at=now() where user_id=_r.user_id returning balance into _new_bal;
  if _new_bal < 0 then raise exception 'Insufficient balance'; end if;
  insert into public.wallet_transactions(user_id,type,amount,balance_after,note,created_by)
    values (_r.user_id,'withdrawal',-_r.amount,_new_bal, format('Withdrawal via %s',_r.method), auth.uid());
  -- Ledger (0082)
  perform public.post_ledger('withdrawal_paid',
    jsonb_build_array(
      jsonb_build_object('account', 'user_wallets', 'amount',  _r.amount),
      jsonb_build_object('account', 'payouts_clearing', 'amount', -(_r.amount))),
    null, null, _r.user_id, format('Withdrawal %s via %s', _r.id, _r.method));
  update public.wallet_withdrawal_requests set status='approved', decided_by=auth.uid(), decided_at=now() where id=_id;
  insert into public.wallet_audit_log(user_id,actor_id,action,meta)
    values (_r.user_id,auth.uid(),'withdrawal_approved', jsonb_build_object('id',_id,'amount',_r.amount,'new_balance',_new_bal));
  perform public.log_admin_action('withdrawal_approved', jsonb_build_object('id', _id, 'amount', _r.amount, 'method', _r.method), null, _id, _r.user_id);
  insert into public.notifications(user_id,type,title,body)
    values (_r.user_id,'wallet_withdrawal','Withdrawal approved — payout pending',
            format('Your $%s withdrawal was approved and taken from your wallet. ConZ now sends the payout to your %s account by hand; you will get another message when it is recorded as sent.',
                   _r.amount::text, _r.method));
  select * into _w from public.wallets where user_id=_r.user_id; return _w;
end $function$;

create or replace function public.admin_mark_withdrawal_paid(_id uuid, _reference text, _note text default null)
 returns wallet_withdrawal_requests
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare _r public.wallet_withdrawal_requests; _ref text := btrim(coalesce(_reference, ''));
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'super_admin')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if public.has_role(auth.uid(),'super_admin') then perform public.require_aal2(); end if;
  if length(_ref) < 3 or length(_ref) > 80 then
    raise exception 'Enter the transfer reference (3-80 characters) from the payout you made';
  end if;
  if _note is not null and length(_note) > 500 then raise exception 'Note is too long'; end if;

  select * into _r from public.wallet_withdrawal_requests where id = _id for update;
  if not found then raise exception 'Withdrawal not found'; end if;
  if _r.user_id = auth.uid() then
    raise exception 'You cannot confirm the payout of your own withdrawal.' using errcode = '42501';
  end if;
  if _r.status <> 'approved' then
    raise exception 'Only an approved withdrawal can be marked as paid (this one is %).', _r.status;
  end if;
  if _r.paid_at is not null then return _r; end if;   -- idempotent: first confirmation wins

  update public.wallet_withdrawal_requests
     set paid_at = now(), paid_by = auth.uid(), payout_reference = _ref, payout_note = _note
   where id = _id
  returning * into _r;

  insert into public.wallet_audit_log(user_id, actor_id, action, meta)
    values (_r.user_id, auth.uid(), 'withdrawal_payout_recorded',
            jsonb_build_object('id', _id, 'amount', _r.amount, 'reference', _ref));
  perform public.log_admin_action('withdrawal_payout_recorded',
    jsonb_build_object('id', _id, 'amount', _r.amount, 'method', _r.method, 'reference', _ref), _note, _id, _r.user_id);
  insert into public.notifications(user_id, type, title, body)
    values (_r.user_id, 'wallet_withdrawal', 'Payout recorded as sent',
            format('ConZ recorded your $%s payout to %s as sent (reference %s). If it has not arrived, contact support.',
                   _r.amount::text, _r.method, _ref));
  return _r;
end $function$;

revoke all on function public.admin_mark_withdrawal_paid(uuid, text, text) from public, anon;
grant execute on function public.admin_mark_withdrawal_paid(uuid, text, text) to authenticated;
