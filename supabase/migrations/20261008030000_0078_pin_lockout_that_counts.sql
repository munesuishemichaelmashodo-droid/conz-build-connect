-- =============================================================================
-- 0078 — PIN lockouts that actually count (audit F7 + new HIGH finding)
-- =============================================================================
--
-- Problem (proven by supabase/tests/database/070_pin_lockout.test.sql before
-- this migration: two wrong PINs left pin_attempts.fail_count = 0):
--   request_withdrawal and driver_confirm_delivery_pin incremented their
--   failure counters and then RAISED. A raised exception rolls back the whole
--   request transaction — including the counter increment — so neither
--   lockout ever engaged:
--     * withdrawal PIN (4-8 digits): unlimited guesses via request_withdrawal;
--     * set_withdrawal_pin(new, current) checked the current PIN with no
--       counting at all (the originally reported F7 oracle);
--     * escrow delivery PIN (6 digits): the assigned driver could guess the
--       customer's code without limit and release escrow to themselves.
--
-- Fix: the PIN-checking RPCs RETURN a result instead of raising on a wrong
-- PIN or an active lockout, so the failure counter commits:
--     {"ok": false, "error": "wrong_pin" | "locked", "message": "...", ...}
--     {"ok": true, ...}
-- Other validation errors (bad amount, not your job, ...) still raise; they
-- do not touch any counter. While locked, the PIN is not evaluated at all.
-- Lockout: 5 failures -> 15 minutes; 10+ failures -> 24 hours (each further
-- failure re-arms it). Only a correct PIN resets the counter. The withdrawal
-- PIN counter is shared by request_withdrawal and set_withdrawal_pin.
--
-- Return types change (row/void -> jsonb), so the functions are dropped and
-- recreated with explicit grants. Deploy the app (which accepts both the old
-- and new shapes) BEFORE applying this migration.
-- =============================================================================

create or replace function public.pin_lock_duration(_fails integer)
returns interval language sql immutable set search_path to 'public' as $$
  select case when _fails >= 10 then interval '24 hours'
              when _fails >= 5  then interval '15 minutes'
              else null end
$$;

-- -----------------------------------------------------------------------------
-- Withdrawal PIN
-- -----------------------------------------------------------------------------
-- Returns 'ok' | 'wrong' | 'locked' | 'no_pin'. Counts failures; resets on success.
create or replace function public.check_withdrawal_pin(_uid uuid, _pin text)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare _hash text; _att public.pin_attempts; _fails integer;
begin
  select * into _att from public.pin_attempts where user_id = _uid for update;
  if _att.locked_until is not null and _att.locked_until > now() then
    return 'locked';
  end if;

  select withdrawal_pin_hash into _hash from public.driver_profiles where user_id = _uid;
  if _hash is null then return 'no_pin'; end if;

  if _pin is not null and crypt(_pin, _hash) = _hash then
    insert into public.pin_attempts (user_id, fail_count, locked_until, updated_at)
    values (_uid, 0, null, now())
    on conflict (user_id) do update set fail_count = 0, locked_until = null, updated_at = now();
    return 'ok';
  end if;

  insert into public.pin_attempts (user_id, fail_count, updated_at) values (_uid, 1, now())
  on conflict (user_id) do update set fail_count = public.pin_attempts.fail_count + 1, updated_at = now()
  returning fail_count into _fails;
  update public.pin_attempts set locked_until = now() + public.pin_lock_duration(_fails)
   where user_id = _uid and public.pin_lock_duration(_fails) is not null;
  insert into public.wallet_audit_log (user_id, actor_id, action, meta)
  values (_uid, _uid, 'pin_failed', jsonb_build_object('fail_count', _fails));
  return 'wrong';
end $$;
revoke all on function public.check_withdrawal_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.check_withdrawal_pin(uuid, text) to service_role;

create or replace function public.withdrawal_pin_failure_result(_uid uuid, _outcome text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case
    when _outcome = 'locked' or coalesce((select locked_until > now() from public.pin_attempts where user_id = _uid), false) then
      jsonb_build_object('ok', false, 'error', 'locked',
        'message', 'Too many wrong PINs. Try again after ' ||
                   to_char((select locked_until from public.pin_attempts where user_id = _uid) at time zone 'Africa/Harare', 'HH24:MI') || '.',
        'locked_until', (select locked_until from public.pin_attempts where user_id = _uid))
    when _outcome = 'no_pin' then
      jsonb_build_object('ok', false, 'error', 'no_pin', 'message', 'Set a withdrawal PIN in Profile first.')
    else
      jsonb_build_object('ok', false, 'error', 'wrong_pin', 'message', 'Wrong PIN.',
        'attempts_left', greatest(0, 5 - coalesce((select fail_count from public.pin_attempts where user_id = _uid), 0)))
  end
$$;
revoke all on function public.withdrawal_pin_failure_result(uuid, text) from public, anon, authenticated;
grant execute on function public.withdrawal_pin_failure_result(uuid, text) to service_role;

drop function if exists public.request_withdrawal(numeric, text, text, text);
create function public.request_withdrawal(_amount numeric, _method text, _destination text, _pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  _r public.wallet_withdrawal_requests;
  _bal numeric; _held numeric; _avail numeric; _limited boolean; _check text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if _amount is null or _amount <= 0 or _amount > 100000 then
    raise exception 'Invalid amount';
  end if;
  if _method not in ('ecocash','onemoney','zipit','bank') then
    raise exception 'Invalid method';
  end if;
  if _destination is null or length(trim(_destination)) < 4 then
    raise exception 'Destination required';
  end if;

  -- one pending request at a time
  if exists (select 1 from public.wallet_withdrawal_requests
              where user_id = auth.uid() and status = 'pending') then
    raise exception 'You already have a withdrawal awaiting approval';
  end if;

  -- F7: a wrong PIN / lockout is RETURNED (not raised) so the failure counts.
  _check := public.check_withdrawal_pin(auth.uid(), _pin);
  if _check <> 'ok' then
    return public.withdrawal_pin_failure_result(auth.uid(), _check);
  end if;

  select coalesce(balance,0), coalesce(held,0), coalesce(limited,false)
    into _bal, _held, _limited
    from public.wallets where user_id = auth.uid();

  if coalesce(_limited, false) then
    raise exception 'Your wallet is limited. Contact support.';
  end if;

  _avail := coalesce(_bal,0) - coalesce(_held,0);
  if _avail < _amount then
    raise exception 'Insufficient available balance. $% is reserved against active jobs.',
      coalesce(_held,0)::text;
  end if;

  insert into public.wallet_withdrawal_requests(user_id, amount, method, destination)
    values (auth.uid(), round(_amount,2), _method, trim(_destination))
    returning * into _r;

  insert into public.wallet_audit_log(user_id, actor_id, action, meta)
    values (auth.uid(), auth.uid(), 'withdrawal_requested',
            jsonb_build_object('id', _r.id, 'amount', _r.amount,
                               'method', _r.method, 'held', _held));
  return jsonb_build_object('ok', true, 'request', to_jsonb(_r));
end $$;
revoke all on function public.request_withdrawal(numeric, text, text, text) from public, anon;
grant execute on function public.request_withdrawal(numeric, text, text, text) to authenticated, service_role;

drop function if exists public.set_withdrawal_pin(text);
drop function if exists public.set_withdrawal_pin(text, text);
create function public.set_withdrawal_pin(_pin text, _current_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare _existing text; _check text;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if _pin is null or length(_pin) < 4 or length(_pin) > 8 or _pin !~ '^[0-9]+$' then
    raise exception 'PIN must be 4-8 digits';
  end if;
  select withdrawal_pin_hash into _existing from public.driver_profiles where user_id = auth.uid();
  if _existing is not null then
    -- F7: changing the PIN proves the current one through the SAME counted,
    -- lockout-enforcing check as withdrawals.
    _check := public.check_withdrawal_pin(auth.uid(), coalesce(_current_pin, ''));
    if _check <> 'ok' then
      return public.withdrawal_pin_failure_result(auth.uid(), _check);
    end if;
  end if;
  insert into public.driver_profiles (user_id, withdrawal_pin_hash)
    values (auth.uid(), crypt(_pin, gen_salt('bf')))
    on conflict (user_id) do update set withdrawal_pin_hash = excluded.withdrawal_pin_hash;
  insert into public.wallet_audit_log(user_id,actor_id,action,meta)
    values (auth.uid(),auth.uid(), case when _existing is null then 'pin_set' else 'pin_changed' end,'{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.set_withdrawal_pin(text, text) from public, anon;
grant execute on function public.set_withdrawal_pin(text, text) to authenticated, service_role;

create function public.set_withdrawal_pin(_pin text)
returns jsonb
language sql
security definer
set search_path to 'public', 'extensions'
as $$ select public.set_withdrawal_pin(_pin, null) $$;
revoke all on function public.set_withdrawal_pin(text) from public, anon;
grant execute on function public.set_withdrawal_pin(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Escrow delivery PIN
-- -----------------------------------------------------------------------------
drop function if exists public.driver_confirm_delivery_pin(uuid, text);
create function public.driver_confirm_delivery_pin(_job_id uuid, _pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare _job public.jobs; _rec public.job_delivery_pins; _attempts integer;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if _job.driver_id <> auth.uid() then raise exception 'Not your job'; end if;
  if _job.payment_method <> 'escrow' then raise exception 'This job does not use delivery PIN confirmation'; end if;
  if _job.status = 'completed' then return jsonb_build_object('ok', true, 'job_id', _job.id, 'already', true); end if;
  if _job.status not in ('accepted','in_progress') then raise exception 'Job not in progress'; end if;
  if _job.delivery_photo_url is null then raise exception 'Upload the delivery photo first'; end if;

  select * into _rec from public.job_delivery_pins where job_id = _job_id for update;
  if not found then raise exception 'No delivery code has been generated for this job yet'; end if;

  if _rec.locked_until is not null and _rec.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked',
      'message', 'Too many incorrect codes. Try again after ' || to_char(_rec.locked_until at time zone 'Africa/Harare', 'HH24:MI') || '.',
      'locked_until', _rec.locked_until);
  end if;

  if _pin is null or trim(_pin) <> _rec.pin then
    -- F7: RETURNED, not raised, so this increment is kept.
    update public.job_delivery_pins
       set attempts = attempts + 1,
           locked_until = now() + public.pin_lock_duration(attempts + 1)
     where job_id = _job_id
    returning attempts into _attempts;
    if _attempts >= 5 then
      insert into public.notifications (user_id, type, title, body, job_id)
      values (_job.customer_id, 'delivery_pin_failures', 'Several wrong delivery codes were entered',
              'The driver entered your delivery code incorrectly several times. Only share it once your load has arrived.', _job.id);
    end if;
    return jsonb_build_object('ok', false, 'error', 'wrong_pin',
      'message', 'Incorrect code — ask the customer for the code shown in their app.',
      'attempts_left', greatest(0, 5 - _attempts));
  end if;

  update public.job_delivery_pins set attempts = 0, locked_until = null where job_id = _job_id;
  perform public.release_escrow_and_complete(_job_id, auth.uid());
  return jsonb_build_object('ok', true, 'job_id', _job.id);
end $$;
revoke all on function public.driver_confirm_delivery_pin(uuid, text) from public, anon;
grant execute on function public.driver_confirm_delivery_pin(uuid, text) to authenticated, service_role;
