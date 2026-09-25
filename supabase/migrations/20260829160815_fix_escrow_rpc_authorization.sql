-- Recovered verbatim from live supabase_migrations.schema_migrations on
-- 2026-09-25 (was applied live without a committed file).
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
-- replace) -- this REVOKE is the one that actually takes effect; it's
-- placed after the redefinition simply so the final grant state is set
-- once, in one place, after the function body it applies to.
REVOKE EXECUTE ON FUNCTION public.release_escrow_and_complete(uuid, uuid) FROM anon, authenticated;
