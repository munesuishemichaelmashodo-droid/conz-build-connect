-- 0063 — fixes from the 30/09/2026 full audit.
--
-- 1. CRITICAL: payments.status could never be 'released'.
--    release_escrow_and_complete() sets the escrow payment to 'released'
--    when a Con Z Pay job is completed, but payments_status_check only
--    allowed initiated/paid/cancelled/failed/refunded. The UPDATE would
--    raise, rolling back the whole release — so no escrow job could ever be
--    completed or paid out (confirm-delivery, driver PIN and the 72h
--    auto-release all go through that function). No escrow payment has
--    reached 'paid' live yet, so nobody has hit it — the first real Con Z
--    Pay delivery would have.
--
-- 2. mark_escrow_payment_paid() only treated 'paid' as already-processed.
--    A late Paynow IPN / poll for a payment that had already been
--    'released' would flip it back to 'paid'. It now also no-ops on
--    'released', and if a customer ends up paying twice for the same job
--    (two Paynow attempts both completing) admins get a notification to
--    refund the duplicate instead of the money sitting unnoticed.
--
-- 3. Maintenance/cron functions were executable by anyone, including
--    signed-out visitors, via /rest/v1/rpc. Worst case: create_dispatch_wave
--    takes a caller-chosen _limit, so anyone could push an open job's offer
--    to every verified driver at once. All their callers are pg_cron (runs
--    as postgres) or other SECURITY DEFINER functions (run as owner), so
--    revoking client EXECUTE changes nothing for the app.
--
-- 4. driver_can_accept_for(_job_id, _driver_id) returned any driver's wallet
--    balance to any caller, signed in or not. It is now limited to the
--    driver themself, admins, and the customer of a job that driver has bid
--    on (accept_bid / accept_counter call it in that situation).
--
-- 5. evidence_distance_m() returned how far a driver's photo was taken from
--    any job's drop-off to any caller. Now only the job's customer, driver
--    or an admin get a value.
--
-- Written defensively: safe to replay.

-- 1 ------------------------------------------------------------------------
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check
  CHECK (status = ANY (ARRAY['initiated'::text, 'paid'::text, 'released'::text,
                             'cancelled'::text, 'failed'::text, 'refunded'::text]));

-- 2 ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_escrow_payment_paid(_payment_id uuid)
 RETURNS payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _p public.payments;
BEGIN
  SELECT * INTO _p FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF _p.type <> 'escrow' THEN RAISE EXCEPTION 'Payment % is not an escrow hold', _payment_id; END IF;

  -- idempotent: 'released' means it was paid and has already gone to the driver
  IF _p.status IN ('paid', 'released') THEN RETURN _p; END IF;

  UPDATE public.payments SET status = 'paid', updated_at = now() WHERE id = _payment_id RETURNING * INTO _p;

  IF _p.job_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.payments o
       WHERE o.job_id = _p.job_id AND o.type = 'escrow' AND o.id <> _p.id
         AND o.status IN ('paid', 'released')
    ) THEN
      -- Customer paid twice for the same job. Only one payment is ever
      -- released to the driver; flag the other for a manual refund.
      INSERT INTO public.notifications(user_id, type, title, body, job_id)
      SELECT ur.user_id, 'escrow_duplicate_payment', 'Duplicate Con Z Pay payment — refund needed',
             format('A customer paid $%s twice for the same job (payment %s). Refund the duplicate through Paynow.',
                    _p.amount::text, _p.id::text),
             _p.job_id
        FROM public.user_roles ur
       WHERE ur.role IN ('admin', 'super_admin');
    ELSE
      INSERT INTO public.notifications(user_id, type, title, body, job_id)
      SELECT j.driver_id, 'escrow_funded', 'Payment received — you''re clear to deliver',
             'The customer paid through Con Z Pay. Funds are held safely and will be released to you once delivery is confirmed.',
             j.id
      FROM public.jobs j WHERE j.id = _p.job_id AND j.driver_id IS NOT NULL;
    END IF;
  END IF;

  RETURN _p;
END $function$;

REVOKE EXECUTE ON FUNCTION public.mark_escrow_payment_paid(uuid) FROM PUBLIC, anon, authenticated;

-- 3 ------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.auto_release_escrow_payments()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_dispatch_wave(uuid, integer)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.escalate_overdue_disputes()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_stale_accepted_jobs()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_referral_lifecycle()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prune_driver_locations()                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recent_cancellation_strikes(uuid)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sweep_stalled_dispatch_offers()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()                       FROM PUBLIC, anon, authenticated;

-- Called by the app, but only by signed-in users.
REVOKE EXECUTE ON FUNCTION public.expire_stale_dispatch_offers(uuid)      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.count_available_verified_drivers(uuid)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.expire_stale_dispatch_offers(uuid)      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.count_available_verified_drivers(uuid)  TO authenticated;

-- 4 ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.driver_can_accept_for(_job_id uuid, _driver_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job public.jobs; _rate numeric; _req numeric;
  _bal numeric; _held numeric; _avail numeric;
  _free boolean; _has_profile boolean;
  _uid uuid := auth.uid();
begin
  select * into _job from public.jobs where id = _job_id;
  if not found then raise exception 'Job not found'; end if;

  -- The driver checking themself, an admin, or the job's customer accepting
  -- a bid from this driver (accept_bid / accept_counter). A NULL uid with a
  -- non-anon role is a server-side caller (service_role / cron).
  if not (
       _uid = _driver_id
    or public.has_role(_uid, 'admin'::public.app_role)
    or public.has_role(_uid, 'super_admin'::public.app_role)
    or (_uid = _job.customer_id
        and exists (select 1 from public.bids b where b.job_id = _job_id and b.driver_id = _driver_id))
    or (_uid is null and coalesce(auth.role(), '') <> 'anon')
  ) then
    raise exception 'Not authorised to check this driver''s balance.' using errcode = '42501';
  end if;

  select first_job_free_used, true into _free, _has_profile
    from public.driver_profiles where user_id = _driver_id;
  if not coalesce(_has_profile, false) then
    return jsonb_build_object('ok', false, 'required', 0, 'available', 0,
      'reason', 'no_driver_profile');
  end if;

  select coalesce(balance,0), coalesce(held,0) into _bal, _held
    from public.wallets where user_id = _driver_id;
  _avail := coalesce(_bal,0) - coalesce(_held,0);

  if _free is not true then
    return jsonb_build_object('ok', true, 'required', 0,
      'available', _avail, 'free', true);
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;

  _req := round(coalesce(_job.final_price, _job.budget, 0) * _rate / 100.0, 2);

  return jsonb_build_object('ok', _avail >= _req, 'required', _req,
    'available', _avail, 'shortfall', greatest(0, _req - _avail), 'free', false);
end $function$;

REVOKE EXECUTE ON FUNCTION public.driver_can_accept_for(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.driver_can_accept_for(uuid, uuid) TO authenticated;

-- 5 ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evidence_distance_m(_job_id uuid, _kind text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select round((6371000 * acos(least(1, greatest(-1,
           cos(radians(e.device_lat)) * cos(radians(j.delivery_lat)) *
           cos(radians(j.delivery_lng) - radians(e.device_lng)) +
           sin(radians(e.device_lat)) * sin(radians(j.delivery_lat))
         ))))::numeric, 0)
  from public.job_evidence e
  join public.jobs j on j.id = e.job_id
  where e.job_id = _job_id and e.kind = _kind
    and e.device_lat is not null and j.delivery_lat is not null
    and e.superseded_at is null
    and (j.customer_id = auth.uid() or j.driver_id = auth.uid()
         or public.has_role(auth.uid(), 'admin'::public.app_role)
         or public.has_role(auth.uid(), 'super_admin'::public.app_role))
  order by e.uploaded_at limit 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.evidence_distance_m(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.evidence_distance_m(uuid, text) TO authenticated;
