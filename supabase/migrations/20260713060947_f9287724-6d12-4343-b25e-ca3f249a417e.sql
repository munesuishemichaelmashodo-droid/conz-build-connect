
-- Seed 10 demo drivers across Zimbabwe for testing
DO $$
DECLARE
  demo RECORD;
  uid UUID;
  encrypted_pw TEXT;
BEGIN
  encrypted_pw := crypt('ConzDemo2026!', gen_salt('bf'));

  FOR demo IN
    SELECT * FROM (VALUES
      ('demo.driver1@conz.test',  'Tendai Moyo',      '+263771000001', 'Harare',         -17.8292::float, 31.0522::float, 'ABT 1001', 12::numeric),
      ('demo.driver2@conz.test',  'Rudo Chikafu',     '+263771000002', 'Bulawayo',       -20.1325::float, 28.6266::float, 'ABT 1002', 15::numeric),
      ('demo.driver3@conz.test',  'Farai Nyathi',     '+263771000003', 'Chitungwiza',    -18.0127::float, 31.0756::float, 'ABT 1003', 10::numeric),
      ('demo.driver4@conz.test',  'Tapiwa Sibanda',   '+263771000004', 'Mutare',         -18.9707::float, 32.6473::float, 'ABT 1004', 14::numeric),
      ('demo.driver5@conz.test',  'Chipo Dube',       '+263771000005', 'Gweru',          -19.4500::float, 29.8167::float, 'ABT 1005', 12::numeric),
      ('demo.driver6@conz.test',  'Blessing Ncube',   '+263771000006', 'Kwekwe',         -18.9281::float, 29.8149::float, 'ABT 1006', 15::numeric),
      ('demo.driver7@conz.test',  'Kudzai Mpofu',     '+263771000007', 'Kadoma',         -18.3333::float, 29.9167::float, 'ABT 1007', 10::numeric),
      ('demo.driver8@conz.test',  'Nyasha Banda',     '+263771000008', 'Masvingo',       -20.0637::float, 30.8277::float, 'ABT 1008', 12::numeric),
      ('demo.driver9@conz.test',  'Simba Mhaka',      '+263771000009', 'Chinhoyi',       -17.3667::float, 30.2000::float, 'ABT 1009', 14::numeric),
      ('demo.driver10@conz.test', 'Panashe Zulu',     '+263771000010', 'Victoria Falls', -17.9243::float, 25.8572::float, 'ABT 1010', 15::numeric)
    ) AS t(email, full_name, phone, city, lat, lng, reg, cap)
  LOOP
    -- Skip if already seeded
    SELECT id INTO uid FROM auth.users WHERE email = demo.email;
    IF uid IS NOT NULL THEN CONTINUE; END IF;

    uid := gen_random_uuid();

    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) VALUES (
      uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      demo.email, encrypted_pw, now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', demo.full_name, 'phone', demo.phone),
      now(), now(), '', '', '', ''
    );

    -- handle_new_user trigger should have created profile+wallet+customer role.
    -- Upsert to be safe.
    INSERT INTO public.profiles (id, full_name, email, phone, status)
    VALUES (uid, demo.full_name, demo.email, demo.phone, 'active')
    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone, email = EXCLUDED.email;

    INSERT INTO public.wallets (user_id, balance)
    VALUES (uid, 50)
    ON CONFLICT (user_id) DO UPDATE SET balance = 50;

    INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'driver')
    ON CONFLICT DO NOTHING;

    INSERT INTO public.driver_profiles (
      user_id, national_id, verification_status, level, rating_avg, rating_count, jobs_completed, first_job_free_used
    ) VALUES (
      uid, 'DEMO-' || substr(uid::text,1,8), 'verified', 'silver', 4.7, 12, 8, false
    ) ON CONFLICT (user_id) DO UPDATE
      SET verification_status = 'verified', level = 'silver';

    INSERT INTO public.trucks (driver_id, registration, capacity_m3)
    VALUES (uid, demo.reg, demo.cap)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
