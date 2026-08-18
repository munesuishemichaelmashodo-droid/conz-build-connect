-- Fix: "Become a driver too" / "Enable customer account" on the Profile
-- screen call supabase.from("user_roles").insert(...) directly from the
-- user's own session. Same root cause as the earlier driver-verification
-- bug: RLS on user_roles only allows super_admins to insert rows, so
-- these calls always fail -- except this time the failure isn't silent,
-- the user gets shown a raw Postgres RLS-violation error every time they
-- tap either button, and the account switch never actually happens.
--
-- Fix: a narrow, safe RPC a user can call to add ONLY 'customer' or
-- 'driver' to their own account -- explicitly cannot be used to grant
-- 'admin' or 'super_admin', so it can stay callable by any authenticated
-- user without opening a privilege-escalation hole.
CREATE OR REPLACE FUNCTION public.self_add_base_role(_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _role NOT IN ('customer', 'driver') THEN
    RAISE EXCEPTION 'Only customer or driver roles can be self-granted';
  END IF;

  INSERT INTO public.user_roles(user_id, role)
  VALUES (auth.uid(), _role::app_role)
  ON CONFLICT DO NOTHING;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.self_add_base_role(text) TO authenticated;
