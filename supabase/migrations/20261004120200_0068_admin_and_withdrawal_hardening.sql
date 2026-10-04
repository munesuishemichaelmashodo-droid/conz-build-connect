-- 0068 — Admin money controls + withdrawal hardening (audit H4, H3).
--
-- Security reasons:
--  H4  admin_credit_wallet was gated only by admin-or-super, with any amount,
--      optional reason, and no self-target block — a single admin password
--      could mint money to the admin's own wallet. Admin approvals
--      (topup/withdrawal) and driver verification had no self-target block.
--      admin_approve_withdrawal ignored held funds and the 'limited' flag.
--  H3  set_withdrawal_pin let anyone with a session overwrite the PIN with no
--      knowledge of the current one, and reset the failed-attempt lockout.
--
-- All functions keep their signatures (set_withdrawal_pin gains an optional
-- _current_pin, so existing first-time-set calls keep working). Safe to replay.

-- admin_credit_wallet: super-admin only, no self-credit, reason required,
-- non-negative result, full audit + ledger row (unchanged behaviour for a
-- legitimate super-admin credit).
create or replace function public.admin_credit_wallet(_user_id uuid, _amount numeric, _note text)
returns public.wallets language plpgsql security definer set search_path to 'public' as $fn$
declare _prev numeric; _new numeric; _w public.wallets;
begin
  if not public.has_role(auth.uid(),'super_admin') then
    raise exception 'Only super admins can credit wallets directly';
  end if;
  if _user_id = auth.uid() then raise exception 'Admins cannot adjust their own wallet.'; end if;
  if _amount = 0 then raise exception 'Amount cannot be zero'; end if;
  if _note is null or btrim(_note) = '' then raise exception 'A written reason is required'; end if;

  insert into public.wallets(user_id, balance) values (_user_id, 0) on conflict (user_id) do nothing;
  select balance into _prev from public.wallets where user_id = _user_id for update;
  _new := _prev + _amount;
  if _new < 0 then raise exception 'This would take the wallet negative (balance %, change %)', _prev, _amount; end if;
  update public.wallets set balance = _new, updated_at = now(), limited = (_new < 0) where user_id = _user_id;

  insert into public.wallet_transactions(user_id, type, amount, balance_after, previous_balance, note, created_by)
  values (_user_id,
          case when _amount > 0 then 'topup'::public.tx_type else 'adjustment'::public.tx_type end,
          _amount, _new, _prev, _note, auth.uid());

  perform public.log_admin_action(
    case when _amount > 0 then 'wallet_credited_by_admin' else 'wallet_debited_by_admin' end,
    jsonb_build_object('amount', _amount, 'previous_balance', _prev, 'new_balance', _new),
    _note, null, _user_id);

  select * into _w from public.wallets where user_id = _user_id;
  return _w;
end $fn$;

-- admin_approve_withdrawal: block self-approval; respect held funds and the
-- limited flag before paying out.
create or replace function public.admin_approve_withdrawal(_id uuid)
returns public.wallets language plpgsql security definer set search_path to 'public' as $fn$
declare _r public.wallet_withdrawal_requests; _new_bal numeric; _w public.wallets;
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'super_admin')) then
    raise exception 'Forbidden';
  end if;
  perform public.require_admin_mfa();
  select * into _r from public.wallet_withdrawal_requests where id=_id for update;
  if _r is null or _r.status <> 'pending' then raise exception 'Not pending'; end if;
  if _r.user_id = auth.uid() then raise exception 'You cannot approve your own withdrawal.'; end if;

  select * into _w from public.wallets where user_id = _r.user_id for update;
  if coalesce(_w.limited, false) then raise exception 'This wallet is limited; resolve that before paying out.'; end if;
  if coalesce(_w.balance,0) - coalesce(_w.held,0) < _r.amount then
    raise exception 'Insufficient available balance (held funds are reserved).';
  end if;

  update public.wallets set balance = balance - _r.amount, updated_at=now()
    where user_id=_r.user_id returning balance into _new_bal;
  if _new_bal < 0 then raise exception 'Insufficient balance'; end if;

  insert into public.wallet_transactions(user_id,type,amount,balance_after,note,created_by)
    values (_r.user_id,'withdrawal',-_r.amount,_new_bal, format('Withdrawal via %s',_r.method), auth.uid());

  update public.wallet_withdrawal_requests set status='approved', decided_by=auth.uid(), decided_at=now() where id=_id;

  insert into public.wallet_audit_log(user_id,actor_id,action,meta)
    values (_r.user_id,auth.uid(),'withdrawal_approved',
            jsonb_build_object('id',_id,'amount',_r.amount,'new_balance',_new_bal));
  perform public.log_admin_action('withdrawal_approved', jsonb_build_object('id', _id, 'amount', _r.amount, 'method', _r.method), null, _id, _r.user_id);

  insert into public.notifications(user_id,type,title,body)
    values (_r.user_id,'wallet_withdrawal','Withdrawal approved', format('$%s withdrawn from your wallet.',_r.amount::text));

  select * into _w from public.wallets where user_id=_r.user_id;
  return _w;
end $fn$;

-- admin_approve_topup: block self-approval (rest unchanged).
create or replace function public.admin_approve_topup(_id uuid)
returns public.wallets language plpgsql security definer set search_path to 'public' as $fn$
declare _r public.wallet_topup_requests; _new_bal numeric; _w public.wallets;
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'super_admin')) then
    raise exception 'Forbidden';
  end if;
  perform public.require_admin_mfa();
  select * into _r from public.wallet_topup_requests where id=_id for update;
  if _r is null then raise exception 'Request not found'; end if;
  if _r.user_id = auth.uid() then raise exception 'You cannot approve your own top-up.'; end if;
  if _r.status = 'approved' then select * into _w from public.wallets where user_id=_r.user_id; return _w; end if;
  if _r.status <> 'pending' then raise exception 'Request not pending'; end if;

  insert into public.wallets(user_id, balance) values (_r.user_id, 0) on conflict (user_id) do nothing;
  update public.wallets set balance = balance + _r.amount, updated_at=now(), limited=false
    where user_id=_r.user_id returning balance into _new_bal;

  insert into public.wallet_transactions(user_id,type,amount,balance_after,note,created_by)
    values (_r.user_id,'topup',_r.amount,_new_bal, format('Top-up via %s (ref %s)',_r.method,coalesce(_r.reference,'-')), auth.uid());

  update public.wallet_topup_requests set status='approved', decided_by=auth.uid(), decided_at=now() where id=_id;

  insert into public.wallet_audit_log(user_id,actor_id,action,meta)
    values (_r.user_id,auth.uid(),'topup_approved', jsonb_build_object('id',_id,'amount',_r.amount,'new_balance',_new_bal));
  perform public.log_admin_action('topup_approved', jsonb_build_object('id', _id, 'amount', _r.amount, 'method', _r.method), null, _id, _r.user_id);

  insert into public.notifications(user_id,type,title,body)
    values (_r.user_id,'wallet_topup','Top-up approved', format('$%s added to your wallet.',_r.amount::text));

  select * into _w from public.wallets where user_id=_r.user_id;
  return _w;
end $fn$;

-- admin_set_driver_verification: block an admin verifying their own driver
-- profile (self-dealing / KYC self-approval). Body otherwise unchanged.
create or replace function public.admin_set_driver_verification(_user_id uuid, _status text, _notes text default null)
returns public.driver_profiles language plpgsql security definer set search_path to 'public' as $fn$
declare _d public.driver_profiles; _old text;
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'super_admin')) then
    raise exception 'Forbidden';
  end if;
  if _user_id = auth.uid() then raise exception 'Admins cannot set their own driver verification.'; end if;
  if _status not in ('pending','verified','rejected') then raise exception 'Invalid status'; end if;

  select verification_status::text into _old from public.driver_profiles where user_id = _user_id;

  update public.driver_profiles
     set verification_status = _status::verification_status,
         verification_notes = _notes,
         verified_at = case when _status = 'verified' then now() else verified_at end,
         reverify_due_at = case when _status = 'verified' then now() + interval '90 days' else reverify_due_at end
   where user_id = _user_id
  returning * into _d;
  if not found then raise exception 'Driver profile not found'; end if;

  if _status = 'verified' then
    insert into public.user_roles(user_id, role) values (_user_id, 'driver'::app_role) on conflict do nothing;
  end if;

  perform public.log_admin_action('driver_verification_changed', jsonb_build_object('old_status', _old, 'new_status', _status), _notes, null, _user_id);

  insert into public.notifications(user_id, type, title, body)
  values (_user_id, 'driver_verification',
          case when _status = 'verified' then 'You''re verified!' when _status = 'rejected' then 'Verification rejected' else 'Verification pending' end,
          coalesce(_notes, case when _status = 'verified' then 'You can now accept jobs. You''ll be asked to re-verify again in 90 days.' when _status = 'rejected' then 'Please review and resubmit your documents.' else 'Your documents are under review.' end));

  return _d;
end $fn$;

-- set_withdrawal_pin: changing an existing PIN requires the current one and
-- does not reset the lockout. The legacy 1-arg entrypoint is redefined as a
-- safe delegator (passes _current_pin = null), so it can only SET a PIN when
-- none exists yet. DROP FUNCTION is avoided deliberately (the managed SQL
-- runner declines destructive statements); two overloads coexist, both safe.
create or replace function public.set_withdrawal_pin(_pin text, _current_pin text)
returns void language plpgsql security definer set search_path to 'public','extensions' as $fn$
declare _existing text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if _pin is null or length(_pin) < 4 or length(_pin) > 8 or _pin !~ '^[0-9]+$' then
    raise exception 'PIN must be 4-8 digits';
  end if;
  select withdrawal_pin_hash into _existing from public.driver_profiles where user_id = auth.uid();
  if _existing is not null then
    if _current_pin is null or crypt(coalesce(_current_pin,''), _existing) <> _existing then
      raise exception 'Enter your current PIN to change it';
    end if;
  end if;
  insert into public.driver_profiles (user_id, withdrawal_pin_hash)
    values (auth.uid(), crypt(_pin, gen_salt('bf')))
    on conflict (user_id) do update set withdrawal_pin_hash = excluded.withdrawal_pin_hash;
  if _existing is null then
    insert into public.pin_attempts(user_id, fail_count) values (auth.uid(),0)
      on conflict (user_id) do update set fail_count=0, locked_until=null, updated_at=now();
  end if;
  insert into public.wallet_audit_log(user_id,actor_id,action,meta)
    values (auth.uid(),auth.uid(),'pin_set','{}'::jsonb);
end $fn$;
revoke execute on function public.set_withdrawal_pin(text, text) from public, anon;
grant execute on function public.set_withdrawal_pin(text, text) to authenticated;

create or replace function public.set_withdrawal_pin(_pin text)
returns void language plpgsql security definer set search_path to 'public','extensions' as $fn$
begin
  perform public.set_withdrawal_pin(_pin, null);
end $fn$;
