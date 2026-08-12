-- 0019: presence ("last active") for online/last-seen status in chat.
-- No new table needed — a single nullable timestamp on profiles, updated by
-- a heartbeat while the user has the app open. Existing RLS already lets
-- any authenticated user read all profiles and update only their own row,
-- so no policy changes are required.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.last_active_at IS
  'Updated periodically by a client-side heartbeat while the user has the app open/focused. Used to derive "Online" (recent) vs "Last seen X ago" status.';
