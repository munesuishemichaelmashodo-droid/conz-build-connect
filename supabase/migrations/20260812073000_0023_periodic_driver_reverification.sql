-- Periodic driver re-verification: Con Z only ever verified a driver once,
-- at signup, forever. Every currently-verified driver gets a 90-day
-- verified_at/reverify_due_at window starting now (a fresh grace period,
-- not backfilled from guesswork); admin approval resets it another 90
-- days from then. The actual re-verification submission mechanism already
-- existed and needed no new code: DocUpload (profile.tsx) already flips
-- verification_status back to 'pending' the moment a driver re-uploads
-- their selfie, and the existing admin verification queue already reviews
-- any 'pending' row — re-verification just reuses both end to end.
--
-- What's new here is the *enforcement*: a driver whose reverify_due_at has
-- passed and who hasn't resubmitted now stops receiving new-job pings and
-- is blocked from placing new bids, even though verification_status still
-- says 'verified' (nothing flips that automatically — resubmitting a
-- selfie is what moves them to 'pending' and starts a fresh review).
--
-- Along the way this also closes a pre-existing gap noticed while adding
-- this: the bids INSERT policy never actually required
-- verification_status = 'verified' at all — an unverified driver's direct
-- Supabase client call could already reach the bids table even though the
-- UI/notifications only ever surfaced jobs to verified drivers.
--
-- Applied live to ovwrsocjmkpiygipmrdk already and spot-checked: backfill
-- gave all 3 currently-verified drivers a fresh 90-day window (rejected
-- driver untouched), and the updated bids INSERT policy confirmed to
-- require both verification_status = 'verified' and a non-overdue
-- reverify_due_at. Recorded here so migration history matches the live
-- schema.

ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reverify_due_at TIMESTAMPTZ;

UPDATE public.driver_profiles
SET verified_at = now(), reverify_due_at = now() + interval '90 days'
WHERE verification_status = 'verified' AND reverify_due_at IS NULL;

CREATE OR REPLACE FUNCTION public.admin_set_driver_verification(_user_id uuid, _status text, _notes text DEFAULT NULL::text)
 RETURNS driver_profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _d public.driver_profiles; _old text;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _status NOT IN ('pending','verified','rejected') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  SELECT verification_status::text INTO _old FROM public.driver_profiles WHERE user_id = _user_id;

  UPDATE public.driver_profiles
     SET verification_status = _status::verification_status,
         verification_notes = _notes,
         verified_at = CASE WHEN _status = 'verified' THEN now() ELSE verified_at END,
         reverify_due_at = CASE WHEN _status = 'verified' THEN now() + interval '90 days' ELSE reverify_due_at END
   WHERE user_id = _user_id
  RETURNING * INTO _d;

  IF NOT FOUND THEN RAISE EXCEPTION 'Driver profile not found'; END IF;

  PERFORM public.log_admin_action('driver_verification_changed', jsonb_build_object('old_status', _old, 'new_status', _status), _notes, NULL, _user_id);

  INSERT INTO public.notifications(user_id, type, title, body)
  VALUES (_user_id, 'driver_verification',
          CASE WHEN _status = 'verified' THEN 'You''re verified!' WHEN _status = 'rejected' THEN 'Verification rejected' ELSE 'Verification pending' END,
          COALESCE(_notes, CASE WHEN _status = 'verified' THEN 'You can now accept jobs. You''ll be asked to re-verify again in 90 days.' WHEN _status = 'rejected' THEN 'Please review and resubmit your documents.' ELSE 'Your documents are under review.' END));

  RETURN _d;
END $function$;

DROP POLICY IF EXISTS "Drivers create bids" ON public.bids;
CREATE POLICY "Drivers create bids" ON public.bids FOR INSERT TO authenticated WITH CHECK (
  driver_id = auth.uid()
  AND has_role(auth.uid(), 'driver'::app_role)
  AND EXISTS (SELECT 1 FROM public.wallets w WHERE w.user_id = auth.uid() AND w.limited = false)
  AND EXISTS (
    SELECT 1 FROM public.driver_profiles dp
    WHERE dp.user_id = auth.uid()
      AND dp.verification_status = 'verified'
      AND (dp.reverify_due_at IS NULL OR dp.reverify_due_at > now())
  )
);

CREATE OR REPLACE FUNCTION public.tg_notify_new_job_posted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'open' then
    insert into public.notifications (user_id, type, title, body, job_id)
    select
      ur.user_id,
      'new_job',
      'New job available',
      coalesce(new.quantity_m3::text || 'm³ ', '') || coalesce(new.material::text, 'Material') ||
        ' delivery to ' || coalesce(new.dropoff_address, new.delivery_address, 'a nearby location'),
      new.id
    from public.user_roles ur
    join public.driver_profiles dp on dp.user_id = ur.user_id
    where ur.role = 'driver'
      and dp.verification_status = 'verified'
      and (dp.reverify_due_at is null or dp.reverify_due_at > now());
  end if;
  return new;
end;
$function$;
