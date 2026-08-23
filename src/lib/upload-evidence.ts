import { supabase } from "@/integrations/supabase/client";
import { warmLocation, describeAccuracy } from "@/lib/capture-location";
import { getWarmLocation, type CapturedLocation } from "@/lib/capture-location";

const BUCKET = "job-proof-photos";

export type EvidenceKind = "pickup" | "delivery" | "dispute" | "other";

export interface UploadResult {
  path: string;
  evidenceId: string;
  location: CapturedLocation;
}

function extensionFor(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}
export async function uploadJobEvidence(
  jobId: string,
  kind: EvidenceKind,
  file: File
): Promise<UploadResult> {
  const path = `${jobId}/${kind}-${crypto.randomUUID()}.${extensionFor(file)}`;
  const location = await getWarmLocation();

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType: file.type || "image/jpeg",
    });

  if (uploadError) {
    if (/already exists/i.test(uploadError.message)) {
      throw new Error("This photo has already been recorded and cannot be replaced.");
    }
    throw new Error("Upload failed: " + uploadError.message);
  }

  const payload: Record<string, unknown> = {
    _job_id: jobId,
    _kind: kind,
    _storage_path: path,
    _file_size: file.size,
    _location_status: location.status,
  };
  if (file.type) payload._mime_type = file.type;
  if (location.lat !== null) payload._lat = location.lat;
  if (location.lng !== null) payload._lng = location.lng;
  if (location.accuracy_m !== null) payload._accuracy_m = location.accuracy_m;

  const { data, error: rpcError } = await supabase.rpc(
    "record_job_evidence",
    payload as never
  );

  if (rpcError) {
    throw new Error("Photo uploaded but not recorded: " + rpcError.message);
  }

  return {
    path,
    evidenceId: (data as { id: string }).id,
    location,
  };
}
export async function signedEvidenceUrl(
  storagePath: string | null | undefined,
  expiresInSeconds = 3600
): Promise<string | null> {
  if (!storagePath) return null;

  let path = storagePath;
  if (path.startsWith("http")) {
    // Legacy public-bucket URL, e.g.
    // https://<project>.supabase.co/storage/v1/object/public/job-proof-photos/<jobId>/pickup.jpg?t=...
    // The bucket is now private, so this URL 404s directly. Pull the
    // real object path back out and sign it properly instead.
    const marker = `/object/public/${BUCKET}/`;
    const idx = path.indexOf(marker);
    if (idx === -1) {
      console.warn("Legacy URL doesn't match expected bucket format:", path);
      return null;
    }
    path = decodeURIComponent(path.slice(idx + marker.length).split("?")[0]);
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error) {
    console.error("Signed URL failed:", error.message);
    return null;
  }
  return data.signedUrl;
}

export async function signedEvidenceUrlLogged(
  evidenceId: string,
  purpose = "viewed"
): Promise<string | null> {
  const { data: path, error } = await supabase.rpc("log_evidence_access", {
    _evidence_id: evidenceId,
    _purpose: purpose,
  });
  if (error) {
    console.error("Access log failed:", error.message);
    return null;
  }
  return signedEvidenceUrl(path as string);
}
