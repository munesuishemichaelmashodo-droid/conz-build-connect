-- Revoke anonymous/PUBLIC EXECUTE on SECURITY DEFINER functions in public schema.
-- Logged-in users (authenticated) and service_role keep access; each function enforces its own role checks.
-- Anon keeps only: get_public_tracking (public tracking link), public_material_pickups, has_role (used inside RLS policies), compute_material_offer (read-only price calculator).
DO $$
DECLARE
  r record;
  keep_anon text[] := array['get_public_tracking','public_material_pickups','has_role','compute_material_offer'];
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args,
           (p.prorettype = 'pg_catalog.trigger'::regtype) AS is_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosecdef
  LOOP
    IF r.is_trigger THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.proname, r.args);
    ELSIF r.proname = ANY(keep_anon) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC', r.proname, r.args);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon, authenticated, service_role', r.proname, r.args);
    ELSE
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', r.proname, r.args);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', r.proname, r.args);
    END IF;
  END LOOP;
END $$;
