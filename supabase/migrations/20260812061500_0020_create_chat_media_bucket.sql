-- The "chat media read/upload participants" RLS policies on storage.objects
-- (for bucket_id = 'chat-media') were created earlier, but the bucket
-- itself was never created — every photo/voice-note send was failing with
-- "Bucket not found" since chat media shipped. Applied live to
-- ovwrsocjmkpiygipmrdk already; recorded here so migration history matches
-- the live schema. Private bucket, same as job-proof-photos and driver-docs
-- — reachable only via the existing signed-URL helper.
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-media', 'chat-media', false)
ON CONFLICT (id) DO NOTHING;
