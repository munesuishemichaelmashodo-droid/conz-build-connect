-- Fix: verifying a driver never actually granted the 'driver' role.
--
-- become-driver.tsx tried to self-insert into user_roles at submission
-- time, but the RLS policy "Super admins insert roles" only allows
-- super_admins to insert rows there -- so that insert was silently
-- failing on every submission (the client code doesn't check the
-- error). admin_set_driver_verification (the approval RPC) never
-- granted the role either. Net effect: a customer could apply, upload
-- documents, get approved by an admin, and still never see the driver
-- side of the app, because they never actually held the 'driver' role.
--
-- Fix: grant the role here, server-side, at the moment an admin sets
-- verification_status = 'verified' -- this function is SECURITY
-- DEFINER so it bypasses the RLS restriction correctly, and it's the
-- right moment to grant it (not at submission, since the existing bid
-- policy already separately requires verification_status = 'verified'
-- before a driver can bid -- granting the role earlier would just make
-- an unverified applicant show up as a driver in role-gated UI with
-- nothing they're allowed to do yet).
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

  -- The actual fix: grant the driver role now, bypassing RLS as this
  -- function runs SECURITY DEFINER. Idempotent -- safe to run on repeat
  -- verifications (reverification cycles).
  IF _status = 'verified' THEN
    INSERT INTO public.user_roles(user_id, role)
    VALUES (_user_id, 'driver'::app_role)
    ON CONFLICT DO NOTHING;
  END IF;

  PERFORM public.log_admin_action('driver_verification_changed', jsonb_build_object('old_status', _old, 'new_status', _status), _notes, NULL, _user_id);

  INSERT INTO public.notifications(user_id, type, title, body)
  VALUES (_user_id, 'driver_verification',
          CASE WHEN _status = 'verified' THEN 'You''re verified!' WHEN _status = 'rejected' THEN 'Verification rejected' ELSE 'Verification pending' END,
          COALESCE(_notes, CASE WHEN _status = 'verified' THEN 'You can now accept jobs. You''ll be asked to re-verify again in 90 days.' WHEN _status = 'rejected' THEN 'Please review and resubmit your documents.' ELSE 'Your documents are under review.' END));

  RETURN _d;
END $function$;

-- Backfill: grant the driver role to anyone already sitting in
-- verification_status = 'verified' who was never granted it, due to
-- the bug above. Without this, only *future* verifications are fixed
-- and everyone already stuck stays stuck.
INSERT INTO public.user_roles(user_id, role)
SELECT dp.user_id, 'driver'::app_role
FROM public.driver_profiles dp
WHERE dp.verification_status = 'verified'
ON CONFLICT DO NOTHING;
