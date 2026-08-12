-- Driver verification currently only captures one truck photo (front/general).
-- Partner requested side and back photos too, plus making National ID mandatory
-- (the national_id_url column already existed but was never wired into the
-- driver-facing upload form).
ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS tipper_photo_side_url text,
  ADD COLUMN IF NOT EXISTS tipper_photo_back_url text;
