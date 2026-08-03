import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { signedEvidenceUrl } from "@/lib/upload-evidence";
import { ChevronDown, ChevronUp, ImageOff, MapPin } from "lucide-react";

type EvidenceRow = {
  id?: string;
  job_id: string;
  kind: string;
  storage_path: string;
  uploaded_at: string | null;
  device_lat: number | null;
  device_lng: number | null;
  device_accuracy_m: number | null;
  location_status: string | null;
};

// job_evidence / evidence_distance_m aren't in the generated types yet.
const looseFrom = supabase.from as unknown as (t: string) => any;
const looseRpc = supabase.rpc as unknown as (
  f: string,
  a: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function EvidencePhoto({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    signedEvidenceUrl(path)
      .then((u) => { if (alive) setUrl(u); })
      .catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; };
  }, [path]);

  return url ? (
    <img src={url} alt={alt} className="w-full aspect-square object-cover rounded-lg border" />
  ) : (
    <div className="w-full aspect-square rounded-lg border bg-muted animate-pulse" />
  );
}

export function DisputeEvidence({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["dispute-evidence", jobId],
    enabled: open,
    queryFn: async () => {
      const { data: rows } = await looseFrom("job_evidence")
        .select("id,job_id,kind,storage_path,uploaded_at,device_lat,device_lng,device_accuracy_m,location_status")
        .eq("job_id", jobId)
        .in("kind", ["pickup", "delivery", "dispute"])
        .is("superseded_at", null)
        .order("uploaded_at", { ascending: true });

      const evidence = (rows ?? []) as EvidenceRow[];

      let deliveryDistance: number | null = null;
      if (evidence.some((e) => e.kind === "delivery")) {
        const { data: dist } = await looseRpc("evidence_distance_m", { _job_id: jobId, _kind: "delivery" });
        const n = Number(dist);
        deliveryDistance = Number.isFinite(n) ? n : null;
      }
      return { evidence, deliveryDistance };
    },
  });

  return (
    <div className="border-t pt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-[11px] font-semibold uppercase text-muted-foreground"
      >
        Evidence
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div className="pt-2 space-y-2">
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading evidence…</p>
          ) : !data?.evidence.length ? (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <ImageOff className="w-3.5 h-3.5" /> No photos were uploaded for this job.
            </p>
          ) : (
            <>
              {data.deliveryDistance != null && (
                <p className="text-xs font-semibold">
                  {Math.round(data.deliveryDistance)}m from confirmed delivery address
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                {data.evidence.map((e, i) => (
                  <figure key={e.id ?? `${e.storage_path}-${i}`} className="space-y-1">
                    <EvidencePhoto path={e.storage_path} alt={`${e.kind} evidence`} />
                    <figcaption className="text-[10px] text-muted-foreground space-y-0.5">
                      <div className="font-semibold uppercase text-foreground">{e.kind}</div>
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {e.device_lat != null && e.device_lng != null
                          ? `${Number(e.device_lat).toFixed(5)}, ${Number(e.device_lng).toFixed(5)}`
                          : "No GPS"}
                      </div>
                      <div>Location: {e.location_status ?? "unknown"}</div>
                      {e.uploaded_at && <div>{new Date(e.uploaded_at).toLocaleString()}</div>}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
