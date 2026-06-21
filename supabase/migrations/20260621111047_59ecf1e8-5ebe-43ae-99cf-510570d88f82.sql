
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r public.app_role;
BEGIN
  INSERT INTO public.profiles(id, full_name, phone, email)
  VALUES (NEW.id,
          COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
          NEW.raw_user_meta_data->>'phone',
          NEW.email);

  r := COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'customer');
  INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, r) ON CONFLICT DO NOTHING;

  IF r = 'driver' THEN
    INSERT INTO public.driver_profiles(user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    INSERT INTO public.wallets(user_id, balance) VALUES (NEW.id, 0) ON CONFLICT DO NOTHING;
  END IF;

  -- Auto-seed designated owner as super_admin + admin
  IF lower(NEW.email) = 'munesuishemichaelmashodo@gmail.com' THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'super_admin') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END $function$;

-- Backfill if the owner already signed up
INSERT INTO public.user_roles(user_id, role)
SELECT id, 'super_admin'::public.app_role FROM auth.users
WHERE lower(email) = 'munesuishemichaelmashodo@gmail.com'
ON CONFLICT DO NOTHING;

INSERT INTO public.user_roles(user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users
WHERE lower(email) = 'munesuishemichaelmashodo@gmail.com'
ON CONFLICT DO NOTHING;
