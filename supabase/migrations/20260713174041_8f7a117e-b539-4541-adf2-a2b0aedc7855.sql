-- Backfill profiles/roles/wallets for any existing auth user missing them (e.g. legacy Google sign-ups)
INSERT INTO public.profiles (id, full_name, phone, email)
SELECT u.id,
       COALESCE(u.raw_user_meta_data->>'full_name', u.email),
       u.raw_user_meta_data->>'phone',
       u.email
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, COALESCE((u.raw_user_meta_data->>'role')::public.app_role, 'customer'::public.app_role)
FROM auth.users u
LEFT JOIN public.user_roles r ON r.user_id = u.id
WHERE r.user_id IS NULL
ON CONFLICT DO NOTHING;