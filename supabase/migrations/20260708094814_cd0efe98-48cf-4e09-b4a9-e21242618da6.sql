
ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS license_url text,
  ADD COLUMN IF NOT EXISTS tipper_photo_url text;
