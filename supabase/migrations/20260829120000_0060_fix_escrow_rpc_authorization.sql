-- Security fix for audit findings C-1 and C-2 (Con Z Pay escrow flow).
--
-- C-1: mark_escrow_payment_paid(uuid) had EXECUTE granted to anon AND
-- authenticated, with no auth.uid() check and no verification that a real
-- Paynow payment occurred -- any signed-in user could create an escrow
-- payment for their own job and call this RPC directly to mark it "paid"
-- for free. Its sibling credit_wallet_from_payment (the topup equivalent)
-- was already correctly locked down this way; this one was missed.
--
-- C-2: release_escrow_and_complete(_job_id, _actor) had the same grant
-- problem and additionally never checked that the caller was actually a
-- party to the job -- any authenticated user could force an escrow payout
-- on any job with a "paid" escrow payment, skipping delivery confirmation
-- entirely. _actor was already only used for the audit-trail created_by
-- field, never for authorization, so it's kept as-is for that purpose.
--
-- Investigated all real callers before making this change (live DB, not
-- migration files):
--   - mark_escrow_payment_paid: called only from the Paynow IPN webhook
--     (src/routes/api/public/paynow-ipn.ts) and the per-user reconciliation
--     sweep (reconcilePendingPaynowPayments in src/lib/paynow.functions.ts)
--     -- both go through supabaseAdmin (service_role), which is unaffected
--     by revoking anon/authenticated grants.
--   - release_escrow_and_complete: called from three places, all inside
--     SECURITY DEFINER functions owned by `postgres` (confirmed live):
--       1. complete_job -- customer confirms completion; already checks
--          auth.uid() = jobs.customer_id before calling.
--       2. driver_confirm_delivery_pin -- driver enters the code the
--          customer gave them; already checks auth.uid() = jobs.driver_id
--          (and the PIN itself) before calling.
--       3. auto_release_escrow_payments -- the 72h uncontested-delivery
--          sweep; runs outside any user session (auth.uid() is NULL there),
--          invoked on a schedule, not by a client request.
--     Because all three callers -- and release_escrow_and_complete itself
--     -- are owned by `postgres`, a SECURITY DEFINER function's internal
--     calls run with the owner's privileges, not the original caller's.
--     Revoking EXECUTE from anon/authenticated therefore blocks direct
--     client calls without breaking any of these three legitimate paths.
--     (This is the exact same mechanism that already makes
--     credit_wallet_from_payment's existing REVOKE safe.)

-- Both functions were also still carrying Postgres's default EXECUTE
-- grant to PUBLIC (visible in pg_proc.proacl as the "=X/postgres" entry)
-- from when they were first created -- credit_wallet_from_payment had
-- already had this revoked when it was fixed previously, but these two
-- had not. Revoking from anon/authenticated alone does nothing while the
-- PUBLIC grant remains, since every role implicitly inherits it -- both
-- REVOKE FROM PUBLIC and REVOKE FROM anon, authenticated are needed.
REVOKE EXECUTE ON FUNCTION public.mark_escrow_payment_paid(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_escrow_payment_paid(uuid) FROM anon, authenticated;

-- Defense-in-depth on top of the REVOKE below: even if EXECUTE were ever
-- accidentally re-granted in the future, this function should still only
-- ever act on behalf of one of its three legitimate callers. auth.uid()
-- is NULL only in the scheduled-sweep context (auto_release_escrow_payments
-- has no user session); a NULL auth.uid() reaching this function via a
-- direct anon/authenticated RPC call is exactly what the REVOKE above now
-- prevents, so allowing it here is safe only in combination with that
-- REVOKE, not on its own -- the comment inside documents this dependency.
CREATE OR REPLACE FUNCTION public.release_escrow_and_complete(_job_id uuid, _actor uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _job public.jobs; _payment public.payments; _rate numeric; _commission numeric;
  _payout numeric; _new_bal numeric; _free_used boolean; _has_profile boolean; _level driver_level;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;

  -- Security fix (audit finding C-2). Legitimate callers, in order of
  -- likelihood: the customer (via complete_job), the driver (via
  -- driver_confirm_delivery_pin), or nobody (auth.uid() IS NULL, via the
  -- auto_release_escrow_payments sweep -- safe ONLY because EXECUTE is
  -- revoked from anon/authenticated above, so a direct anonymous RPC call
  -- can no longer reach this line at all). Anyone else is rejected.
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> _job.customer_id
     AND auth.uid() <> _job.driver_id
  THEN
    RAISE EXCEPTION 'Not authorised to release this job''s escrow.' USING ERRCODE = '42501';
  END IF;

  IF _job.payment_method <> 'escrow' THEN RAISE EXCEPTION 'Job % is not an escrow job', _job_id; END IF;
  IF _job.status NOT IN ('accepted', 'in_progress') THEN RAISE EXCEPTION 'Job not in progress'; END IF;

  SELECT * INTO _payment FROM public.payments
    WHERE job_id = _job_id AND type = 'escrow' AND status = 'paid'
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No confirmed escrow payment for this job yet'; END IF;

  SELECT (value::text)::numeric INTO _rate FROM public.system_settings WHERE key = 'commission_rate';
  IF _rate IS NULL THEN RAISE EXCEPTION 'commission_rate not configured'; END IF;

  SELECT first_job_free_used, true, level INTO _free_used, _has_profile, _level
    FROM public.driver_profiles WHERE user_id = _job.driver_id;
  IF NOT COALESCE(_has_profile, false) THEN
    RAISE EXCEPTION 'Driver profile missing for driver %', _job.driver_id;
  END IF;

  IF _free_used IS NOT TRUE THEN
    _commission := 0;
    UPDATE public.driver_profiles SET first_job_free_used = true WHERE user_id = _job.driver_id;
  ELSE
    _commission := round(_payment.amount * _rate / 100.0
                          * public.driver_level_commission_multiplier(_level), 2);
  END IF;
  _payout := _payment.amount - _commission;

  INSERT INTO public.wallets(user_id, balance) VALUES (_job.driver_id, 0) ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.wallets SET balance = balance + _payout, updated_at = now(), limited = false
   WHERE user_id = _job.driver_id RETURNING balance INTO _new_bal;

  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, job_id, note, created_by)
  VALUES (_job.driver_id, 'topup', _payout, _new_bal, _job.id,
          format('Con Z Pay escrow release — %s%% commission already deducted (%s tier)', _rate, _level), _actor);

  UPDATE public.payments SET status = 'released', updated_at = now() WHERE id = _payment.id;

  UPDATE public.driver_profiles SET jobs_completed = jobs_completed + 1 WHERE user_id = _job.driver_id;

  PERFORM public.release_job_commission(_job_id);

  UPDATE public.jobs
     SET status = 'completed', commission = _commission, completed_at = now()
   WHERE id = _job_id
  RETURNING * INTO _job;

  IF to_regprocedure('public.issue_pod(uuid)') IS NOT NULL THEN
    PERFORM public.issue_pod(_job_id);
  END IF;

  INSERT INTO public.notifications(user_id, type, title, body, job_id)
  VALUES (_job.driver_id, 'escrow_released', 'Payment released to you!',
          format('$%s has been added to your wallet for this delivery.', _payout::text), _job.id);

  RETURN _job;
END $function$;

-- CREATE OR REPLACE FUNCTION does not reset an existing function's grants
-- (Postgres preserves ownership/permissions across a same-signature
-- replace) -- these REVOKEs are the ones that actually take effect;
-- placed after the redefinition simply so the final grant state is set
-- once, in one place, after the function body it applies to. Both the
-- PUBLIC grant and the named-role grants must be revoked (see the note
-- above mark_escrow_payment_paid's REVOKE for why both are needed).
REVOKE EXECUTE ON FUNCTION public.release_escrow_and_complete(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_escrow_and_complete(uuid, uuid) FROM anon, authenticated;

-- Additional findings from the same audit pass, same category of bug:
-- hold_job_commission and release_job_commission both had EXECUTE granted
-- to anon/authenticated/PUBLIC with no auth.uid() check, and are callable
-- directly on any job id. Neither can be used to steal funds outright
-- (both are idempotent -- hold_job_commission short-circuits if
-- held_commission is already set, release_job_commission's greatest(...,0)
-- can't push held negative), but both let a client manipulate another
-- user's wallet.held figure and another job's held_commission accounting
-- on jobs they have nothing to do with, which is a real integrity/griefing
-- issue worth closing with the same pattern.
--
-- Callers confirmed live, all owned by `postgres`, all SECURITY DEFINER:
--   hold_job_commission    <- accept_bid, accept_counter, accept_dispatch_offer
--                              (each already checks the caller is the job's
--                              customer or the accepting driver before
--                              calling this)
--   release_job_commission <- complete_job, release_escrow_and_complete,
--                              cancel_job (each already checks customer/
--                              driver/admin before calling this),
--                              resolve_dispute (admin-gated at its own top),
--                              expire_stale_accepted_jobs (a cron sweep with
--                              no user session -- auth.uid() is NULL there,
--                              same as auto_release_escrow_payments)
-- No caller of either function is itself reachable by an unauthorized
-- party, so revoking client EXECUTE is sufficient and safe by the same
-- owner-privilege mechanism used above. An internal check is added too,
-- as defense-in-depth, shaped to match each function's actual legitimate
-- callers rather than copying release_escrow_and_complete's check
-- verbatim -- release_job_commission's callers include admin-initiated
-- paths (resolve_dispute, admin cancelling any job via cancel_job) that
-- hold_job_commission's callers do not have.

REVOKE EXECUTE ON FUNCTION public.hold_job_commission(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hold_job_commission(uuid) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.hold_job_commission(_job_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _job  public.jobs;
  _rate numeric;
  _amt  numeric;
begin
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  -- Defense-in-depth (see migration header): legitimate callers are
  -- accept_bid/accept_counter/accept_dispatch_offer, which by this point
  -- have already set _job.driver_id to the accepting driver and already
  -- verified the caller is that driver or the job's customer.
  if auth.uid() is not null
     and auth.uid() <> _job.customer_id
     and auth.uid() <> _job.driver_id
  then
    raise exception 'Not authorised to hold commission on this job.' using errcode = '42501';
  end if;

  if _job.held_commission is not null then
    return _job.held_commission;             -- already reserved
  end if;

  -- first job free: nothing to reserve
  if not coalesce(
       (select first_job_free_used from public.driver_profiles
         where user_id = _job.driver_id), false) then
    update public.jobs set held_commission = 0 where id = _job_id;
    return 0;
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;

  _amt := round(coalesce(_job.final_price, _job.budget, 0) * _rate / 100.0, 2);

  update public.wallets
     set held = coalesce(held, 0) + _amt, updated_at = now()
   where user_id = _job.driver_id;

  if not found then
    raise exception 'Driver % has no wallet', _job.driver_id;
  end if;

  update public.jobs set held_commission = _amt where id = _job_id;
  return _amt;
end $function$;

REVOKE EXECUTE ON FUNCTION public.hold_job_commission(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hold_job_commission(uuid) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.release_job_commission(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_job_commission(uuid) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.release_job_commission(_job_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _job public.jobs;
  _amt numeric;
begin
  select * into _job from public.jobs where id = _job_id;
  if not found then return 0; end if;

  -- Defense-in-depth (see migration header): unlike hold_job_commission,
  -- this function's legitimate callers include admin-initiated paths
  -- (resolve_dispute is admin-gated at its own top; cancel_job allows an
  -- admin to cancel any job, not just their own), plus
  -- expire_stale_accepted_jobs, a cron sweep with no user session (NULL
  -- auth.uid()). The customer/driver/NULL/admin check below matches
  -- exactly those callers -- nothing wider, nothing narrower.
  if auth.uid() is not null
     and auth.uid() <> _job.customer_id
     and auth.uid() <> _job.driver_id
     and not (public.has_role(auth.uid(), 'admin'::public.app_role)
              or public.has_role(auth.uid(), 'super_admin'::public.app_role))
  then
    raise exception 'Not authorised to release commission on this job.' using errcode = '42501';
  end if;

  _amt := coalesce(_job.held_commission, 0);
  if _amt = 0 or _job.driver_id is null then
    update public.jobs set held_commission = null where id = _job_id;
    return 0;
  end if;

  -- greatest(...,0) so a double release can never push held negative
  update public.wallets
     set held = greatest(coalesce(held, 0) - _amt, 0), updated_at = now()
   where user_id = _job.driver_id;

  update public.jobs set held_commission = null where id = _job_id;
  return _amt;
end $function$;

REVOKE EXECUTE ON FUNCTION public.release_job_commission(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_job_commission(uuid) FROM anon, authenticated;

-- wallet_available(uuid): read-only, but accepts an arbitrary _user_id
-- with no ownership check -- any anon/authenticated caller could look up
-- any other user's available wallet balance. Confirmed no database-level
-- callers and no frontend callers (grep across src/ finds it only in the
-- generated types.ts, never actually invoked) -- genuinely dead client
-- surface. Not dropped, per instruction -- grants only.
REVOKE EXECUTE ON FUNCTION public.wallet_available(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wallet_available(uuid) FROM anon, authenticated;

-- claim_super_admin(): one-time bootstrap -- the first caller becomes
-- super_admin, but only if zero super_admin rows exist. Confirmed live:
-- 2 super_admin rows already exist, so this function is permanently
-- inert for any caller today. It DOES have a frontend call site
-- (admin.settings.tsx's "claim" handler), but that button is only
-- rendered when `!isSuper && superCount === 0` -- with superCount
-- currently 2, the button is not visible to any real user right now.
-- No database-level callers. Restricting this to postgres/service_role
-- is a deliberate hardening choice, not just cleanup: while a
-- super_admin exists this function already refuses to do anything, but
-- if every super_admin role were ever removed (bug, incident, etc.), a
-- client-reachable version of this function would let ANY signed-in
-- user race to grant themselves super_admin. Keeping it postgres/
-- service_role-only means that disaster-recovery scenario now requires
-- direct database access rather than being reachable from the app --
-- which also means the (currently invisible) frontend button would, in
-- that scenario, fail with a permission error instead of recovering
-- automatically; recovery would need a direct SQL call as postgres/
-- service_role instead. Not dropped, per instruction -- grants only.
REVOKE EXECUTE ON FUNCTION public.claim_super_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_super_admin() FROM anon, authenticated;

-- enforce_customer_strikes(_user_id, _job_id, _stage, _reason): HIGH
-- finding from the closing security sweep. EXECUTE was granted to
-- PUBLIC/anon/authenticated, with no auth.uid() check at all, on a
-- function that writes cancellation_events and can set
-- profiles.restricted_until (up to a 30-day booking restriction) for an
-- arbitrary _user_id. A client could have called this directly with a
-- victim's real user id to manufacture strikes and get their account
-- restricted, using entirely fabricated data.
--
-- Call graph confirmed live: the only database caller is cancel_job
-- (postgres-owned, SECURITY DEFINER), and only inside the branch
--   `if _stage <> 'pre_acceptance' and auth.uid() = _job.customer_id then
--      perform public.enforce_customer_strikes(_job.customer_id, _job_id, _stage, _reason);`
-- i.e. _user_id is always exactly auth.uid() at the one real call site --
-- a customer applying a strike to their own account when they cancel a
-- job after it's been accepted. No admin-initiated path, no driver path,
-- and -- unlike the escrow/commission functions -- no cron or
-- service-role path calls this with a NULL session, so no "auth.uid() IS
-- NULL" bypass is added here; inventing one would widen the hole rather
-- than close it. No frontend code calls this directly (grep across src/
-- finds it only in generated types.ts).
--
-- Fix: revoke client EXECUTE (same PUBLIC + anon/authenticated pattern
-- as every other fix in this migration), and add the one authorization
-- rule the actual call graph supports: the caller must be acting on
-- their own account. Strike calculation, restriction thresholds,
-- cancellation_events semantics, and notification behavior are all
-- unchanged.

REVOKE EXECUTE ON FUNCTION public.enforce_customer_strikes(uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_customer_strikes(uuid, uuid, text, text) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_customer_strikes(_user_id uuid, _job_id uuid, _stage text, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _strikes   int;
  _until     timestamptz;
  _restrict  text;
  _title     text;
  _body      text;
begin
  -- Defense-in-depth (see migration header): the only legitimate call
  -- site (cancel_job) always invokes this with _user_id = auth.uid() --
  -- a customer applying a strike to their own account. Reject anything
  -- else outright, including a NULL session -- there is no legitimate
  -- unauthenticated or cron caller for this function.
  if auth.uid() is null or auth.uid() <> _user_id then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  insert into public.cancellation_events(user_id, job_id, role, stage, reason)
  values (_user_id, _job_id, 'customer', _stage, _reason);

  _strikes := public.recent_cancellation_strikes(_user_id);

  -- cached rollup for cheap reads
  update public.profiles
     set cancellation_strikes = _strikes
   where id = _user_id;

  -- ---- the ladder (tune here) -------------------------------
  if _strikes >= 7 then
    _until    := now() + interval '30 days';
    _restrict := 'Repeated cancellations after drivers accepted. Contact support.';
    _title    := 'Account restricted';
    _body     := 'Your account is restricted for 30 days after repeated cancellations. Contact support to appeal.';
  elsif _strikes >= 5 then
    _until    := now() + interval '7 days';
    _restrict := 'Five cancellations after acceptance in 90 days.';
    _title    := 'Booking paused for 7 days';
    _body     := 'You have cancelled 5 accepted jobs in 90 days. You can book again in 7 days.';
  elsif _strikes >= 3 then
    _until    := now() + interval '24 hours';
    _restrict := 'Three cancellations after acceptance in 90 days.';
    _title    := 'Booking paused for 24 hours';
    _body     := 'You have cancelled 3 accepted jobs. You can book again in 24 hours. Cancelling after a driver has accepted costs them a trip.';
  else
    _until    := null;
    _title    := 'Cancellation recorded';
    _body     := format('You cancelled a job a driver had already accepted (%s of 3 before booking is paused). Cancelling before acceptance is always free.', _strikes);
  end if;

  if _until is not null then
    update public.profiles
       set restricted_until  = greatest(coalesce(restricted_until, now()), _until),
           restriction_reason = _restrict
     where id = _user_id;
  end if;

  insert into public.notifications(user_id, type, title, body)
  values (_user_id, 'cancellation_strike', _title, _body);

  return jsonb_build_object('strikes', _strikes, 'restricted_until', _until);
end $function$;

REVOKE EXECUTE ON FUNCTION public.enforce_customer_strikes(uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_customer_strikes(uuid, uuid, text, text) FROM anon, authenticated;
