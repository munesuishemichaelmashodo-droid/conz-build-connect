import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck, ShieldX, ShieldQuestion, ExternalLink } from "lucide-react";
import { StatusBadge, EmptyState } from "@/components/ui-bits";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/admin/verifications")({
  component: AdminVerifications,
});

type Filter = "pending" | "verified" | "rejected";

function AdminVerifications() {
  const [filter, setFilter] = useState<Filter>("pending");
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["admin-verifications", filter],
    queryFn: async () => {
      const { data: drivers } = await supabase
        .from("driver_profiles")
        .select("user_id,national_id,national_id_url,selfie_url,license_url,tipper_photo_url,verification_status,verification_notes,created_at")
        .eq("verification_status", filter)
        .order("created_at", { ascending: false });
      const ids = (drivers ?? []).map((d) => d.user_id);
      if (!ids.length) return [];
      const { data: profiles } = await supabase.from("profiles").select("id,full_name,email,phone").in("id", ids);
      const pmap = new Map(profiles?.map((p) => [p.id, p]) ?? []);
      return (drivers ?? []).map((d) => ({ ...d, profile: pmap.get(d.user_id) }));
    },
  });

  const signedUrl = async (path: string | null) => {
    if (!path) return null;
    const { data } = await supabase.storage.from("driver-docs").createSignedUrl(path, 600);
    return data?.signedUrl ?? null;
  };

  const view = async (path: string | null) => {
    const url = await signedUrl(path);
    if (url) window.open(url, "_blank");
    else toast.error("File not available");
  };

  const setStatus = async (user_id: string, status: "verified" | "rejected", note?: string) => {
    const { error } = await supabase
      .from("driver_profiles")
      .update({ verification_status: status, verification_notes: note ?? null })
      .eq("user_id", user_id);
    if (error) return toast.error(error.message);
    toast.success(status === "verified" ? "Driver verified" : "Driver rejected");
    qc.invalidateQueries({ queryKey: ["admin-verifications"] });
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["pending", "verified", "rejected"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-1 rounded-lg border py-2 text-xs font-semibold uppercase ${
              filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {!data?.length ? (
        <EmptyState icon={ShieldQuestion} title={`No ${filter} drivers`} hint="Driver verification requests will appear here." />
      ) : (
        <div className="space-y-3">
          {data.map((d) => (
            <div key={d.user_id} className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{d.profile?.full_name ?? "Unnamed"}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{d.profile?.email ?? d.profile?.phone}</div>
                </div>
                <StatusBadge
                  label={d.verification_status}
                  className={
                    d.verification_status === "verified"
                      ? "bg-success/15 text-success border-success/30"
                      : d.verification_status === "rejected"
                        ? "bg-destructive/15 text-destructive border-destructive/30"
                        : "bg-warning/15 text-warning border-warning/30"
                  }
                />
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">National ID: </span>
                <span className="font-mono">{d.national_id ?? "—"}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => view(d.national_id_url)} disabled={!d.national_id_url} className="rounded-lg border py-2 text-xs font-semibold disabled:opacity-40">
                  <ExternalLink className="w-3.5 h-3.5 inline mr-1" /> National ID
                </button>
                <button onClick={() => view(d.selfie_url)} disabled={!d.selfie_url} className="rounded-lg border py-2 text-xs font-semibold disabled:opacity-40">
                  <ExternalLink className="w-3.5 h-3.5 inline mr-1" /> Selfie
                </button>
                <button onClick={() => view((d as any).license_url)} disabled={!(d as any).license_url} className="rounded-lg border py-2 text-xs font-semibold disabled:opacity-40">
                  <ExternalLink className="w-3.5 h-3.5 inline mr-1" /> Licence
                </button>
                <button onClick={() => view((d as any).tipper_photo_url)} disabled={!(d as any).tipper_photo_url} className="rounded-lg border py-2 text-xs font-semibold disabled:opacity-40">
                  <ExternalLink className="w-3.5 h-3.5 inline mr-1" /> Tipper
                </button>
              </div>
              {filter === "pending" && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    onClick={() => setStatus(d.user_id, "verified")}
                    className="rounded-lg bg-success text-success-foreground font-semibold py-2 text-sm"
                  >
                    <ShieldCheck className="w-4 h-4 inline mr-1" /> Approve
                  </button>
                  <button
                    onClick={() => {
                      const reason = window.prompt("Reason for rejection (optional)") ?? undefined;
                      setStatus(d.user_id, "rejected", reason);
                    }}
                    className="rounded-lg bg-destructive text-destructive-foreground font-semibold py-2 text-sm"
                  >
                    <ShieldX className="w-4 h-4 inline mr-1" /> Reject
                  </button>
                </div>
              )}
              {d.verification_notes && (
                <p className="text-xs text-muted-foreground italic">Note: {d.verification_notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
