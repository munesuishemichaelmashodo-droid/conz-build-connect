import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type PodEvidencePhoto = { url: string; uploadedAt: string };

export type PodResult = {
  material: string;
  customMaterial: string | null;
  quantityM3: number;
  finalPrice: number | null;
  deliveryAddress: string | null;
  completedAt: string | null;
  driverName: string | null;
  pickupPhotos: PodEvidencePhoto[];
  deliveryPhotos: PodEvidencePhoto[];
} | null;

/**
 * Public, login-free proof-of-delivery lookup. Same trust model as
 * get_public_tracking — the job's unguessable tracking_token IS the access
 * key. Only ever returns data for a COMPLETED job, and only the fields
 * needed for a shareable delivery receipt — no customer name/phone, no
 * driver phone. This is what makes "Con Z gives you a receipt" possible:
 * the job-proof-photos bucket is private, so the signed URLs below can only
 * be generated server-side.
 */
export const getPublicPod = createServerFn({ method: "GET" })
  .inputValidator(z.object({ token: z.string().uuid() }))
  .handler(async ({ data }): Promise<PodResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const { data: job } = await db
      .from("jobs")
      .select("id,material,custom_material,quantity_m3,final_price,delivery_address,completed_at,driver_id,status")
      .eq("tracking_token", data.token)
      .maybeSingle();

    if (!job || job.status !== "completed") return null;

    const { data: driver } = job.driver_id
      ? await db.from("profiles").select("full_name").eq("id", job.driver_id).maybeSingle()
      : { data: null };

    const { data: evidence } = await db
      .from("job_evidence")
      .select("kind,storage_path,uploaded_at")
      .eq("job_id", job.id)
      .in("kind", ["pickup", "delivery"])
      .order("uploaded_at", { ascending: true });

    const withSignedUrl = async (rows: any[]) => {
      const out: PodEvidencePhoto[] = [];
      for (const row of rows) {
        const { data: signed } = await db.storage.from("job-proof-photos").createSignedUrl(row.storage_path, 3600);
        if (signed?.signedUrl) out.push({ url: signed.signedUrl, uploadedAt: row.uploaded_at });
      }
      return out;
    };

    const pickupRows = (evidence ?? []).filter((e: any) => e.kind === "pickup");
    const deliveryRows = (evidence ?? []).filter((e: any) => e.kind === "delivery");

    return {
      material: job.material,
      customMaterial: job.custom_material,
      quantityM3: Number(job.quantity_m3),
      finalPrice: job.final_price != null ? Number(job.final_price) : null,
      deliveryAddress: job.delivery_address,
      completedAt: job.completed_at,
      driverName: driver?.full_name ?? null,
      pickupPhotos: await withSignedUrl(pickupRows),
      deliveryPhotos: await withSignedUrl(deliveryRows),
    };
  });
