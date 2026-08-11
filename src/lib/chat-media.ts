import { supabase } from "@/integrations/supabase/client";

/** Signed URLs for the private chat-media bucket (photos + voice notes). */
export async function signedChatMediaUrl(storagePath: string | null | undefined, expiresInSeconds = 3600): Promise<string | null> {
  if (!storagePath) return null;
  if (storagePath.startsWith("http")) return storagePath; // legacy/public fallback
  const { data, error } = await supabase.storage.from("chat-media").createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
