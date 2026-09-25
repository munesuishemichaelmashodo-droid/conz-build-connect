-- Recovered verbatim from live supabase_migrations.schema_migrations on
-- 2026-09-25 (was applied live without a committed file).
CREATE OR REPLACE FUNCTION public.require_admin_mfa()
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  -- MFA (authenticator app) requirement removed 2026-09-17: admin/super_admin
  -- actions now only require a valid authenticated session with the
  -- admin/super_admin role (enforced by has_role via each admin_* function's
  -- own checks and RLS) — no second factor required.
  RETURN;
END $function$
