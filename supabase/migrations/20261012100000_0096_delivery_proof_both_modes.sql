-- =============================================================================
-- 0096 — Delivery proof for BOTH payment modes, step-up freshness, first-job race
-- =============================================================================
--
-- Owner decisions 12/10/2026:
--   1. Direct-pay and escrow completion must both require, ON THE SERVER:
--        * delivery photo evidence that really belongs to this job and its driver,
--        * the delivery code (PIN), valid, unexpired, never used before,
--        * the right caller (the job's customer, or its driver) and job state,
--        * one single settlement however many times / however concurrently it is tried.
--      The disabled button in the app is NOT a control.
--   2. Admin login stays free of mandatory MFA; sensitive money actions keep a
--      step-up (aal2) that is enforced in the database and now also EXPIRES.
--   3. First-job-free promotion stays; flat 7% afterwards; the promotion must not be
--      claimable twice by two jobs completing at the same moment.
--
-- What changes
--   * job_delivery_pins gains expires_at / consumed_at / rotated_at. A code is now
--     generated for every accepted job (it used to be escrow-only), lives 7 days,
--     is burnt when the job completes, and the customer can rotate it
--     (regenerate_delivery_pin) so an expired code is never a dead end.
--   * job_has_delivery_evidence(): the delivery photo must match a job_evidence row
--     of kind 'delivery' for this job uploaded by the job's driver (an admin-written
--     jobs.delivery_photo_url alone is not proof).
--   * delivery_proof_check(): the one shared checker (evidence, lock-out, expiry,
--     replay, wrong code). Wrong codes are RETURNED, not raised, so the attempt
--     counter commits (same reason as 0078).
--   * complete_job(job, pin) replaces complete_job(job): customer only, needs the
--     code, idempotent for an already-completed job (returns ok/already), settles
--     escrow or direct-pay through the same checker.
--   * driver_confirm_delivery_pin now works for direct-pay jobs too (it was
--     escrow-only) and uses the same checker.
--   * settle_direct_pay_job(): the direct-pay settlement that used to live inside
--     complete_job, unchanged in effect (first job free, then commission_amount())
--     except that the driver's profile row is locked so the promotion is granted once.
--   * release_escrow_and_complete(): same lock on the driver's profile row. Nothing
--     else changes (auto-release after 72h and dispute resolution still call it
--     directly; they are system paths, not a person confirming a delivery).
--   * require_aal2(): besides aal2, the TOTP verification in the token's amr claim
--     must be recent (default 15 minutes; system_settings 'admin_stepup').
--   * wallet_withdrawal_requests: approving, failing or recording a payout now needs
--     a fresh aal2 session for ANY admin role (it used to be super_admin only).
--     Rejecting, cancelling and reading stay MFA-free.
--
-- Deploy order: ship the app that sends the code to complete_job BEFORE applying
-- this migration (an old client calling complete_job(job) alone is refused).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Delivery code lifecycle
-- -----------------------------------------------------------------------------
alter table public.job_delivery_pins
  add column if not exists expires_at timestamptz,
  add column if not exists consumed_at timestamptz,
  add column if not exists rotated_at timestamptz;

update public.job_delivery_pins
   set expires_at = greatest(created_at, now()) + interval '7 days'
 where expires_at is null;

alter table public.job_delivery_pins
  alter column expires_at set default (now() + interval '7 days'),
  alter column expires_at set not null;

create or replace function public.new_delivery_pin()
returns text language sql volatile security definer set search_path to 'public', 'extensions' as $$
  select lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0')
$$;
revoke all on function public.new_delivery_pin() from public, anon, authenticated;
grant execute on function public.new_delivery_pin() to service_role;

-- Jobs that are already running (direct-pay jobs never had a code): give them one,
-- and mark the codes of finished jobs as used.
insert into public.job_delivery_pins (job_id, pin)
select j.id, public.new_delivery_pin()
  from public.jobs j
 where j.status in ('accepted', 'in_progress')
   and not exists (select 1 from public.job_delivery_pins p where p.job_id = j.id)
on conflict (job_id) do nothing;

update public.job_delivery_pins p
   set consumed_at = coalesce(p.consumed_at, now())
  from public.jobs j
 where j.id = p.job_id and j.status = 'completed' and p.consumed_at is null;

-- A code is created for EVERY job when it becomes 'accepted' (was: escrow only).
create or replace function public.tg_generate_delivery_pin()
returns trigger language plpgsql security definer set search_path to 'public', 'extensions' as $fn$
begin
  if new.status = 'accepted' and (old.status is distinct from 'accepted') then
    new.delivery_pin := null;
    insert into public.job_delivery_pins (job_id, pin)
    values (new.id, public.new_delivery_pin())
    on conflict (job_id) do nothing;
  end if;
  return new;
end $fn$;

-- Customer-only: when the code expired, was lost, or the driver was locked out.
create or replace function public.regenerate_delivery_pin(_job_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $fn$
declare _job public.jobs;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if _job.customer_id <> auth.uid() then raise exception 'Only the customer can generate a new delivery code'; end if;
  if _job.status not in ('accepted', 'in_progress') then raise exception 'Job not in progress'; end if;

  insert into public.job_delivery_pins (job_id, pin)
  values (_job_id, public.new_delivery_pin())
  on conflict (job_id) do update
     set pin = excluded.pin, attempts = 0, locked_until = null, consumed_at = null,
         created_at = now(), rotated_at = now(), expires_at = now() + interval '7 days';
  return jsonb_build_object('ok', true, 'job_id', _job_id);
end $fn$;
revoke execute on function public.regenerate_delivery_pin(uuid) from public, anon;
grant execute on function public.regenerate_delivery_pin(uuid) to authenticated;

-- Customer-only: when the code stops being valid (the app shows it next to the code).
create or replace function public.get_my_delivery_pin_expiry(_job_id uuid)
returns timestamptz language sql stable security definer set search_path to 'public' as $fn$
  select p.expires_at
    from public.job_delivery_pins p
    join public.jobs j on j.id = p.job_id
   where p.job_id = _job_id and j.customer_id = auth.uid();
$fn$;
revoke execute on function public.get_my_delivery_pin_expiry(uuid) from public, anon;
grant execute on function public.get_my_delivery_pin_expiry(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Evidence + code verification (shared by both completion paths)
-- -----------------------------------------------------------------------------
create or replace function public.job_has_delivery_evidence(_job_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $fn$
  select exists (
    select 1
      from public.jobs j
      join public.job_evidence e
        on e.job_id = j.id
       and e.kind = 'delivery'
       and e.storage_path = j.delivery_photo_url
       and e.uploaded_by = j.driver_id
     where j.id = _job_id
       and j.delivery_photo_url is not null
       and j.driver_id is not null
  );
$fn$;
revoke all on function public.job_has_delivery_evidence(uuid) from public, anon, authenticated;
grant execute on function public.job_has_delivery_evidence(uuid) to service_role;

-- The caller must already hold the job row lock (FOR UPDATE).
-- Returns {"ok": true} or a {"ok": false, "error": ...} result (so the attempt
-- counter commits). Missing evidence or code is a hard error (no counter involved).
create or replace function public.delivery_proof_check(_job public.jobs, _pin text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $fn$
declare _rec public.job_delivery_pins; _attempts integer;
begin
  if not public.job_has_delivery_evidence(_job.id) then
    raise exception 'Delivery photo evidence is required before this job can be completed.';
  end if;

  select * into _rec from public.job_delivery_pins where job_id = _job.id for update;
  if not found then raise exception 'No delivery code has been generated for this job yet'; end if;

  if _rec.consumed_at is not null then
    return jsonb_build_object('ok', false, 'error', 'pin_used',
      'message', 'This delivery code has already been used.');
  end if;

  if _rec.locked_until is not null and _rec.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked',
      'message', 'Too many incorrect codes. Try again after ' ||
                 to_char(_rec.locked_until at time zone 'Africa/Harare', 'HH24:MI') || '.',
      'locked_until', _rec.locked_until);
  end if;

  if _rec.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'pin_expired',
      'message', 'This delivery code has expired. The customer can generate a new one in their app.');
  end if;

  if _pin is null or btrim(_pin) <> _rec.pin then
    update public.job_delivery_pins
       set attempts = attempts + 1,
           locked_until = now() + public.pin_lock_duration(attempts + 1)
     where job_id = _job.id
    returning attempts into _attempts;
    if _attempts >= 5 then
      insert into public.notifications (user_id, type, title, body, job_id)
      values (_job.customer_id, 'delivery_pin_failures', 'Several wrong delivery codes were entered',
              'Someone entered your delivery code incorrectly several times. Only share it once your load has arrived.', _job.id);
    end if;
    return jsonb_build_object('ok', false, 'error', 'wrong_pin',
      'message', 'Incorrect code — ask the customer for the code shown in their app.',
      'attempts_left', greatest(0, 5 - _attempts));
  end if;

  update public.job_delivery_pins set attempts = 0, locked_until = null where job_id = _job.id;
  return jsonb_build_object('ok', true);
end $fn$;
revoke all on function public.delivery_proof_check(public.jobs, text) from public, anon, authenticated;
grant execute on function public.delivery_proof_check(public.jobs, text) to service_role;

-- -----------------------------------------------------------------------------
-- 3. Settlement
-- -----------------------------------------------------------------------------
-- Direct-pay settlement (moved out of complete_job). First completed job of a newly
-- verified driver is commission-free; every later one pays commission_amount()
-- (flat rate, all tiers). The driver's profile row is locked so two jobs finishing
-- together cannot both claim the promotion.
create or replace function public.settle_direct_pay_job(_job_id uuid, _actor uuid)
returns public.jobs language plpgsql security definer set search_path to 'public', 'extensions' as $fn$
declare
  _job public.jobs; _rate numeric; _commission numeric;
  _new_bal numeric; _free_used boolean; _has_profile boolean; _level driver_level;
begin
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if _job.payment_method <> 'direct' then raise exception 'Job % is not a direct-pay job', _job_id; end if;
  if _job.status not in ('accepted', 'in_progress') then raise exception 'Job not in progress'; end if;

  if not public.is_valid_money(coalesce(_job.final_price, _job.budget)) then
    raise exception 'Job % has an invalid price and cannot be completed; contact support', _job_id;
  end if;

  select (value::text)::numeric into _rate from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;
  if not (_rate >= 0 and _rate <= 100) then raise exception 'commission_rate is invalid'; end if;

  select first_job_free_used, true, level into _free_used, _has_profile, _level
    from public.driver_profiles where user_id = _job.driver_id
     for update;
  if not coalesce(_has_profile, false) then
    raise exception 'Driver profile missing for driver %', _job.driver_id;
  end if;

  perform public.release_job_commission(_job_id);

  if _free_used is not true then
    _commission := 0;
    update public.driver_profiles set first_job_free_used = true where user_id = _job.driver_id;
    insert into public.wallet_transactions (user_id, type, amount, balance_after, job_id, note, created_by)
    values (_job.driver_id, 'commission', 0,
            coalesce((select balance from public.wallets where user_id = _job.driver_id), 0),
            _job.id, 'First job free — no commission', _actor);
  else
    _commission := public.commission_amount(coalesce(_job.final_price, _job.budget), _rate);
    if not (_commission >= 0 and _commission <= coalesce(_job.final_price, _job.budget)) then
      raise exception 'Computed commission % is invalid for job %', _commission, _job_id;
    end if;

    update public.wallets set balance = balance - _commission, updated_at = now()
     where user_id = _job.driver_id returning balance into _new_bal;
    if _new_bal is null then raise exception 'Driver % has no wallet', _job.driver_id; end if;

    update public.wallets set limited = (_new_bal < 0) where user_id = _job.driver_id;

    insert into public.wallet_transactions (user_id, type, amount, balance_after, job_id, note, created_by)
    values (_job.driver_id, 'commission', -_commission, _new_bal, _job.id,
            format('Commission %s%% on job (%s tier)', _rate, _level), _actor);
    if _commission > 0 then
      perform public.post_ledger('direct_commission',
        jsonb_build_array(
          jsonb_build_object('account', 'user_wallets', 'amount', _commission),
          jsonb_build_object('account', 'platform_revenue', 'amount', -(_commission))),
        null, _job.id, _job.driver_id, 'Direct-pay commission');
    end if;
  end if;

  update public.driver_profiles set jobs_completed = jobs_completed + 1 where user_id = _job.driver_id;

  update public.jobs
     set status = 'completed', commission = _commission, completed_at = now()
   where id = _job_id
  returning * into _job;

  if to_regprocedure('public.issue_pod(uuid)') is not null then
    perform public.issue_pod(_job_id);
  end if;
  return _job;
end $fn$;
revoke all on function public.settle_direct_pay_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.settle_direct_pay_job(uuid, uuid) to service_role;

-- Escrow release: identical to 0091 except the driver's profile row is locked when
-- the first-job promotion is read (see settle_direct_pay_job).
create or replace function public.release_escrow_and_complete(_job_id uuid, _actor uuid)
returns public.jobs language plpgsql security definer set search_path to 'public' as $function$
declare
  _job public.jobs; _payment public.payments; _rate numeric; _commission numeric;
  _payout numeric; _new_bal numeric; _free_used boolean; _has_profile boolean; _level driver_level;
  _lines jsonb;
begin
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  if auth.uid() is not null
     and auth.uid() <> _job.customer_id
     and auth.uid() <> _job.driver_id
  then
    raise exception 'Not authorised to release this job''s escrow.' using errcode = '42501';
  end if;

  if _job.payment_method <> 'escrow' then raise exception 'Job % is not an escrow job', _job_id; end if;
  if _job.status not in ('accepted', 'in_progress') then raise exception 'Job not in progress'; end if;

  select * into _payment from public.payments
    where job_id = _job_id and type = 'escrow' and status = 'paid'
    order by created_at asc limit 1 for update;
  if not found then raise exception 'No confirmed escrow payment for this job yet'; end if;

  if not public.is_valid_money(_payment.amount) then
    raise exception 'Escrow payment % has an invalid amount; contact support', _payment.id;
  end if;

  select (value::text)::numeric into _rate from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;
  if not (_rate >= 0 and _rate <= 100) then raise exception 'commission_rate is invalid'; end if;

  select first_job_free_used, true, level into _free_used, _has_profile, _level
    from public.driver_profiles where user_id = _job.driver_id
     for update;
  if not coalesce(_has_profile, false) then
    raise exception 'Driver profile missing for driver %', _job.driver_id;
  end if;

  if _free_used is not true then
    _commission := 0;
    update public.driver_profiles set first_job_free_used = true where user_id = _job.driver_id;
  else
    _commission := public.commission_amount(_payment.amount, _rate);
  end if;
  _payout := _payment.amount - _commission;

  if not (_commission >= 0 and _commission <= _payment.amount and _payout >= 0 and _payout <= _payment.amount) then
    raise exception 'Computed escrow split is invalid for job %', _job_id;
  end if;

  insert into public.wallets (user_id, balance) values (_job.driver_id, 0) on conflict (user_id) do nothing;

  update public.wallets set balance = balance + _payout, updated_at = now(), limited = false
   where user_id = _job.driver_id returning balance into _new_bal;

  insert into public.wallet_transactions (user_id, type, amount, balance_after, job_id, note, created_by)
  values (_job.driver_id, 'topup', _payout, _new_bal, _job.id,
          format('Con Z Pay escrow release — %s%% commission already deducted (%s tier)', _rate, _level), _actor);

  update public.payments set status = 'released', updated_at = now() where id = _payment.id;

  _lines := jsonb_build_array(jsonb_build_object('account', 'escrow_held', 'amount', _payment.amount));
  if _payout > 0 then
    _lines := _lines || jsonb_build_object('account', 'user_wallets', 'amount', -_payout);
  end if;
  if _commission > 0 then
    _lines := _lines || jsonb_build_object('account', 'platform_revenue', 'amount', -_commission);
  end if;
  perform public.post_ledger('escrow_released', _lines, _payment.id, _job.id, _job.driver_id, 'Escrow released to driver');

  update public.driver_profiles set jobs_completed = jobs_completed + 1 where user_id = _job.driver_id;

  perform public.release_job_commission(_job_id);

  update public.jobs
     set status = 'completed', commission = _commission, completed_at = now()
   where id = _job_id
  returning * into _job;

  if to_regprocedure('public.issue_pod(uuid)') is not null then
    perform public.issue_pod(_job_id);
  end if;

  insert into public.notifications (user_id, type, title, body, job_id)
  values (_job.driver_id, 'escrow_released', 'Payment released to you!',
          format('$%s has been added to your wallet for this delivery.', _payout::text), _job.id);

  return _job;
end $function$;

-- -----------------------------------------------------------------------------
-- 4. The two ways a delivery is confirmed
-- -----------------------------------------------------------------------------
drop function if exists public.complete_job(uuid);

-- Customer confirms the delivery, with the delivery code. Both payment modes.
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
  else
    perform public.settle_direct_pay_job(_job_id, auth.uid());
  end if;

  update public.job_delivery_pins set consumed_at = now() where job_id = _job_id;
  return jsonb_build_object('ok', true, 'job_id', _job_id);
end $fn$;
revoke execute on function public.complete_job(uuid, text) from public, anon;
grant execute on function public.complete_job(uuid, text) to authenticated;

-- Driver confirms with the customer's code. Was escrow-only; now both modes.
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
  else
    perform public.settle_direct_pay_job(_job_id, auth.uid());
  end if;

  update public.job_delivery_pins set consumed_at = now() where job_id = _job_id;
  return jsonb_build_object('ok', true, 'job_id', _job_id);
end $fn$;
revoke execute on function public.driver_confirm_delivery_pin(uuid, text) from public, anon;
grant execute on function public.driver_confirm_delivery_pin(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Admin step-up: aal2 AND a recent verification
-- -----------------------------------------------------------------------------
insert into public.system_settings (key, value)
values ('admin_stepup', '{"max_age_minutes": 15}'::jsonb)
on conflict (key) do nothing;

create or replace function public.require_aal2()
returns void language plpgsql stable set search_path to 'public' as $$
declare _amr jsonb; _latest bigint; _max integer;
begin
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'MFA_REQUIRED: verify with your authenticator app to perform this action.'
      using errcode = '42501';
  end if;

  -- Freshness. Supabase puts every authentication method the session used, with
  -- its time, in the token's amr claim. A session that verified a second factor
  -- long ago (refresh tokens keep aal2 alive) is asked to verify again.
  -- A token with no amr claim carries no timing information; it is treated as
  -- aal2 only (the previous behaviour) rather than locking admins out.
  _amr := auth.jwt() -> 'amr';
  if jsonb_typeof(_amr) = 'array' then
    select coalesce(
             (select case when (value ->> 'max_age_minutes') ~ '^[0-9]{1,3}$'
                          then (value ->> 'max_age_minutes')::integer end
                from public.system_settings where key = 'admin_stepup'),
             15)
      into _max;
    select max((e ->> 'timestamp')::bigint) into _latest
      from jsonb_array_elements(_amr) e
     where jsonb_typeof(e) = 'object'
       and e ->> 'method' in ('totp', 'webauthn', 'phone')
       and (e ->> 'timestamp') ~ '^[0-9]{1,12}$';
    if _latest is null or to_timestamp(_latest) < now() - make_interval(mins => greatest(_max, 1)) then
      raise exception 'MFA_REQUIRED: your verification has expired. Verify again with your authenticator app to continue.'
        using errcode = '42501';
    end if;
  end if;
end $$;

-- Paying out is a money movement whoever clicks it: every admin role needs a fresh
-- second factor to approve a withdrawal, record that the payout was sent, or mark it
-- failed (which returns the money). Rejecting or cancelling moves nothing out, so it
-- stays MFA-free. Calls with no signed-in user (the table owner, scheduled jobs) are
-- not an admin session and are not affected.
create or replace function public.tg_withdrawal_payout_stepup()
returns trigger language plpgsql set search_path to 'public' as $fn$
begin
  if auth.uid() is null then return new; end if;
  if (new.status is distinct from old.status and new.status in ('approved', 'failed'))
     or (new.paid_at is distinct from old.paid_at and new.paid_at is not null)
  then
    perform public.require_aal2();
  end if;
  return new;
end $fn$;

drop trigger if exists trg_withdrawal_payout_stepup on public.wallet_withdrawal_requests;
create trigger trg_withdrawal_payout_stepup
  before update on public.wallet_withdrawal_requests
  for each row execute function public.tg_withdrawal_payout_stepup();
