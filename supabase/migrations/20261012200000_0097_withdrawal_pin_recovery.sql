-- 0097 — Forgotten withdrawal-PIN recovery.
--
-- There was no way to recover a forgotten withdrawal PIN ("contact support"). A weak
-- self-service reset (email link, SMS code, or anything an attacker with a stolen session
-- could complete alone) would let that attacker drain the wallet, so recovery needs a
-- second, out-of-band check by a person:
--
--   1. The signed-in driver asks for a reset (rate limited, one open request, audited).
--   2. An admin verifies the driver's identity outside the app (call / ID check) and
--      records HOW in a mandatory note, then approves. Approval needs a fresh second
--      factor (require_aal2) and an admin cannot approve their own request.
--   3. The same driver, signed in, sets a new PIN within 24 h. One use only.
--   4. Withdrawals are paused for 24 h after a reset (time to notice a hijack) and the
--      driver is notified. The old PIN stops working; lockout counters are cleared.
--
-- Every step writes the audit logs. Nothing here weakens set_withdrawal_pin (changing a
-- known PIN still requires the current one).

create table if not exists public.pin_recovery_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','approved','completed','rejected','cancelled','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  verification_note text,
  completed_at timestamptz
);

-- One open request per user.
create unique index if not exists pin_recovery_one_open
  on public.pin_recovery_requests (user_id) where status in ('pending','approved');
create index if not exists pin_recovery_user_created
  on public.pin_recovery_requests (user_id, created_at desc);

alter table public.pin_recovery_requests enable row level security;
revoke all on public.pin_recovery_requests from anon, authenticated;
grant select on public.pin_recovery_requests to authenticated;
drop policy if exists pin_recovery_read on public.pin_recovery_requests;
create policy pin_recovery_read on public.pin_recovery_requests for select to authenticated
  using (user_id = auth.uid()
         or public.has_role(auth.uid(), 'admin'::app_role)
         or public.has_role(auth.uid(), 'super_admin'::app_role));

-- ---------------------------------------------------------------------------
-- 1. Driver asks for a reset
-- ---------------------------------------------------------------------------
create or replace function public.request_pin_recovery()
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $fn$
declare _uid uuid := auth.uid(); _open public.pin_recovery_requests; _id uuid; _recent integer;
begin
  if _uid is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.driver_profiles
                  where user_id = _uid and withdrawal_pin_hash is not null) then
    raise exception 'You have not set a withdrawal PIN yet. Set one instead.';
  end if;

  -- Open requests that ran out of time stop blocking a new one.
  update public.pin_recovery_requests set status = 'expired'
   where user_id = _uid and status in ('pending','approved') and expires_at <= now();

  select * into _open from public.pin_recovery_requests
   where user_id = _uid and status in ('pending','approved') limit 1;
  if found then
    return jsonb_build_object('ok', true, 'already', true, 'id', _open.id, 'status', _open.status);
  end if;

  select count(*) into _recent from public.pin_recovery_requests
   where user_id = _uid and created_at > now() - interval '24 hours';
  if _recent >= 3 then
    return jsonb_build_object('ok', false, 'error', 'too_many_requests',
      'message', 'Too many reset requests today. Try again tomorrow or contact support.');
  end if;

  insert into public.pin_recovery_requests (user_id) values (_uid) returning id into _id;
  insert into public.wallet_audit_log (user_id, actor_id, action, meta)
    values (_uid, _uid, 'pin_recovery_requested', jsonb_build_object('request_id', _id));
  insert into public.notifications (user_id, type, title, body)
    select distinct ur.user_id, 'pin_recovery_request', 'Withdrawal PIN reset requested',
           'A driver asked to reset their withdrawal PIN. Verify who they are outside the app before approving.'
      from public.user_roles ur where ur.role in ('admin','super_admin');
  insert into public.notifications (user_id, type, title, body)
    values (_uid, 'pin_recovery', 'PIN reset requested',
            'We received your request. A ConZ admin will verify your identity before approving. If you did not ask for this, tell support immediately.');
  return jsonb_build_object('ok', true, 'id', _id, 'status', 'pending');
end $fn$;
revoke execute on function public.request_pin_recovery() from public, anon;
grant execute on function public.request_pin_recovery() to authenticated;

create or replace function public.cancel_pin_recovery()
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $fn$
declare _uid uuid := auth.uid(); _n integer;
begin
  if _uid is null then raise exception 'Sign in required'; end if;
  update public.pin_recovery_requests set status = 'cancelled'
   where user_id = _uid and status in ('pending','approved');
  get diagnostics _n = row_count;
  if _n > 0 then
    insert into public.wallet_audit_log (user_id, actor_id, action, meta)
      values (_uid, _uid, 'pin_recovery_cancelled', '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'cancelled', _n);
end $fn$;
revoke execute on function public.cancel_pin_recovery() from public, anon;
grant execute on function public.cancel_pin_recovery() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. An admin verifies the person, then approves or rejects
-- ---------------------------------------------------------------------------
create or replace function public.admin_decide_pin_recovery(_id uuid, _approve boolean, _note text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $fn$
declare _r public.pin_recovery_requests;
begin
  if auth.uid() is null
     or not (public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'super_admin'::app_role)) then
    raise exception 'Forbidden';
  end if;
  -- Releasing a way into someone's wallet is a sensitive action: fresh second factor.
  perform public.require_aal2();
  if _note is null or length(btrim(_note)) < 10 then
    raise exception 'Record how you verified the driver (at least 10 characters)';
  end if;

  select * into _r from public.pin_recovery_requests where id = _id for update;
  if not found then raise exception 'Request not found'; end if;
  if _r.status <> 'pending' or _r.expires_at <= now() then raise exception 'Not pending'; end if;
  if _r.user_id = auth.uid() then raise exception 'You cannot decide your own request'; end if;

  if _approve then
    update public.pin_recovery_requests
       set status = 'approved', decided_by = auth.uid(), decided_at = now(),
           verification_note = btrim(_note), expires_at = now() + interval '24 hours'
     where id = _id returning * into _r;
    insert into public.notifications (user_id, type, title, body)
      values (_r.user_id, 'pin_recovery', 'PIN reset approved',
              'Open Profile and choose a new withdrawal PIN within 24 hours. If you did not ask for this, contact support immediately.');
  else
    update public.pin_recovery_requests
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(), verification_note = btrim(_note)
     where id = _id returning * into _r;
    insert into public.notifications (user_id, type, title, body)
      values (_r.user_id, 'pin_recovery', 'PIN reset not approved',
              'We could not verify your identity for a PIN reset. Contact support if you still need help.');
  end if;
  perform public.log_admin_action(case when _approve then 'pin_recovery_approved' else 'pin_recovery_rejected' end,
    jsonb_build_object('request_id', _id), btrim(_note), _id, _r.user_id);
  insert into public.wallet_audit_log (user_id, actor_id, action, meta)
    values (_r.user_id, auth.uid(), case when _approve then 'pin_recovery_approved' else 'pin_recovery_rejected' end,
            jsonb_build_object('request_id', _id));
  return to_jsonb(_r);
end $fn$;
revoke execute on function public.admin_decide_pin_recovery(uuid, boolean, text) from public, anon;
grant execute on function public.admin_decide_pin_recovery(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The same driver sets the new PIN (once, within 24 h of approval)
-- ---------------------------------------------------------------------------
create or replace function public.complete_pin_recovery(_new_pin text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $fn$
declare _uid uuid := auth.uid(); _r public.pin_recovery_requests; _resume timestamptz;
begin
  if _uid is null then raise exception 'Sign in required'; end if;
  if _new_pin is null or length(_new_pin) < 4 or length(_new_pin) > 8 or _new_pin !~ '^[0-9]+$' then
    raise exception 'PIN must be 4-8 digits';
  end if;

  select * into _r from public.pin_recovery_requests
   where user_id = _uid and status = 'approved' for update;
  if not found then raise exception 'No approved PIN reset found. Request a reset first.'; end if;
  if _r.expires_at <= now() then
    update public.pin_recovery_requests set status = 'expired' where id = _r.id;
    return jsonb_build_object('ok', false, 'error', 'recovery_expired',
      'message', 'This PIN reset expired. Request a new one.');
  end if;

  update public.driver_profiles set withdrawal_pin_hash = crypt(_new_pin, gen_salt('bf')) where user_id = _uid;
  if not found then raise exception 'No driver profile'; end if;
  insert into public.pin_attempts (user_id, fail_count, locked_until, updated_at)
    values (_uid, 0, null, now())
    on conflict (user_id) do update set fail_count = 0, locked_until = null, updated_at = now();
  update public.pin_recovery_requests set status = 'completed', completed_at = now() where id = _r.id;
  _resume := now() + interval '24 hours';
  insert into public.wallet_audit_log (user_id, actor_id, action, meta)
    values (_uid, _uid, 'pin_recovery_completed', jsonb_build_object('request_id', _r.id, 'approved_by', _r.decided_by));
  insert into public.notifications (user_id, type, title, body)
    values (_uid, 'pin_recovery', 'Withdrawal PIN was reset',
            'Your withdrawal PIN was changed. As a safety measure withdrawals are paused for 24 hours. If this was not you, contact support immediately.');
  return jsonb_build_object('ok', true, 'withdrawals_resume_at', _resume);
end $fn$;
revoke execute on function public.complete_pin_recovery(text) from public, anon;
grant execute on function public.complete_pin_recovery(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Cooling-off: no new withdrawal request for 24 h after a PIN reset
-- ---------------------------------------------------------------------------
create or replace function public.tg_withdrawal_after_pin_reset()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  if exists (select 1 from public.pin_recovery_requests
              where user_id = new.user_id and status = 'completed'
                and completed_at > now() - interval '24 hours') then
    raise exception 'WITHDRAWALS_PAUSED: withdrawals are paused for 24 hours after a PIN reset.'
      using errcode = '42501';
  end if;
  return new;
end $fn$;
revoke execute on function public.tg_withdrawal_after_pin_reset() from public, anon, authenticated;
drop trigger if exists trg_withdrawal_after_pin_reset on public.wallet_withdrawal_requests;
create trigger trg_withdrawal_after_pin_reset before insert on public.wallet_withdrawal_requests
  for each row execute function public.tg_withdrawal_after_pin_reset();
