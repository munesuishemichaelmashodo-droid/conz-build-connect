CREATE OR REPLACE FUNCTION public.admin_grant_role(_user_id uuid, _role app_role)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can grant roles';
  END IF;
  IF _role = 'super_admin'::public.app_role THEN
    RAISE EXCEPTION 'The super_admin role cannot be granted through this function';
  END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (_user_id, _role) ON CONFLICT DO NOTHING;
  PERFORM public.log_admin_action('role_granted', _user_id, NULL,
    jsonb_build_object('role', _role::text), NULL);
END $function$;