
-- =====================================================================
-- 1. ADMIN AUDIT LOG
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_user_id uuid,
  target_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON public.admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON public.admin_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON public.admin_audit_log(target_user_id);

GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit log"
  ON public.admin_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- Helper writer (SECURITY DEFINER so triggers/RPCs can insert)
CREATE OR REPLACE FUNCTION public.log_admin_action(
  _action text, _target_user uuid, _target_id uuid, _meta jsonb, _reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.admin_audit_log(actor_id, action, target_user_id, target_id, meta, reason)
  VALUES (auth.uid(), _action, _target_user, _target_id, COALESCE(_meta,'{}'::jsonb), _reason);
END $$;

-- =====================================================================
-- 2. WIRE EXISTING ADMIN FUNCTIONS INTO AUDIT LOG
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_grant_role(_user_id uuid, _role app_role)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can grant roles';
  END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (_user_id, _role) ON CONFLICT DO NOTHING;
  PERFORM public.log_admin_action('role_granted', _user_id, NULL,
    jsonb_build_object('role', _role::text), NULL);
END $$;

CREATE OR REPLACE FUNCTION public.admin_revoke_role(_user_id uuid, _role app_role)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can revoke roles';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;
  PERFORM public.log_admin_action('role_revoked', _user_id, NULL,
    jsonb_build_object('role', _role::text), NULL);
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_commission(_rate numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can change commission';
  END IF;
  IF _rate < 0 OR _rate > 100 THEN RAISE EXCEPTION 'Rate must be 0-100'; END IF;
  INSERT INTO public.system_settings(key, value, updated_by, updated_at)
  VALUES ('commission_rate', to_jsonb(_rate), auth.uid(), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = auth.uid(), updated_at = now();
  PERFORM public.log_admin_action('commission_changed', NULL, NULL,
    jsonb_build_object('rate', _rate), NULL);
  RETURN to_jsonb(_rate);
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_user_status(_user_id uuid, _status account_status)
 RETURNS profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _p public.profiles;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.profiles SET status = _status, updated_at = now()
  WHERE id = _user_id RETURNING * INTO _p;
  PERFORM public.log_admin_action('user_status_changed', _user_id, NULL,
    jsonb_build_object('status', _status::text), NULL);
  RETURN _p;
END $$;

-- Admin verification decisions on driver_profiles (via trigger)
CREATE OR REPLACE FUNCTION public.tg_audit_verification_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
    IF public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') THEN
      PERFORM public.log_admin_action('driver_verification_changed', NEW.user_id, NULL,
        jsonb_build_object('from', OLD.verification_status::text, 'to', NEW.verification_status::text),
        NEW.verification_notes);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_verification ON public.driver_profiles;
CREATE TRIGGER trg_audit_verification
  AFTER UPDATE ON public.driver_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_verification_change();

-- Dispute resolution audit
CREATE OR REPLACE FUNCTION public.tg_audit_dispute_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') THEN
      PERFORM public.log_admin_action('dispute_status_changed', NULL, NEW.id,
        jsonb_build_object('from', OLD.status, 'to', NEW.status), NEW.resolution);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_dispute ON public.disputes;
CREATE TRIGGER trg_audit_dispute
  AFTER UPDATE ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_dispute_change();

-- =====================================================================
-- 3. LOCATION PRUNING
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_driver_locations_updated_at ON public.driver_locations(updated_at);

CREATE OR REPLACE FUNCTION public.prune_stale_driver_locations()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cnt integer;
BEGIN
  DELETE FROM public.driver_locations WHERE updated_at < now() - interval '24 hours';
  GET DIAGNOSTICS _cnt = ROW_COUNT;
  RETURN _cnt;
END $$;

-- =====================================================================
-- 4. SERVER-SIDE JOB + DISPATCH EXPIRY (pg_cron)
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Wrapper: expire dispatch offers for every open job (extends existing per-job fn)
CREATE OR REPLACE FUNCTION public.expire_all_stale_dispatch_offers()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job_id uuid; _total integer := 0;
BEGIN
  FOR _job_id IN
    SELECT DISTINCT job_id FROM public.job_dispatch_offers
    WHERE status = 'pending' AND expires_at < now()
  LOOP
    _total := _total + public.expire_stale_dispatch_offers(_job_id);
  END LOOP;
  RETURN _total;
END $$;

-- Schedule: every 10 seconds, expire stale jobs, offers, and prune locations hourly.
-- pg_cron minimum interval is 1 second (newer versions) or 1 minute (older).
-- Use the "10 seconds" syntax; if unsupported, this becomes every minute — safe fallback.
DO $$
BEGIN
  -- Remove old schedules if they exist (idempotent re-runs)
  PERFORM cron.unschedule(jobname) FROM cron.job
    WHERE jobname IN ('conz-expire-jobs','conz-expire-offers','conz-prune-locations');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'conz-expire-jobs',
  '10 seconds',
  $$ SELECT public.expire_stale_open_jobs(); $$
);

SELECT cron.schedule(
  'conz-expire-offers',
  '10 seconds',
  $$ SELECT public.expire_all_stale_dispatch_offers(); $$
);

SELECT cron.schedule(
  'conz-prune-locations',
  '0 * * * *', -- hourly
  $$ SELECT public.prune_stale_driver_locations(); $$
);
