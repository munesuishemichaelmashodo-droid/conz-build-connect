import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/ui-bits";
import { isMfaRequiredError } from "@/lib/mfa";
import { KeyRound, ShieldCheck, ShieldAlert, ScrollText, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/security")({
  component: AdminSecurity,
});

type AdminMfaRow = {
  user_id: string;
  full_name: string;
  email: string | null;
  role: string;
  has_verified_mfa: boolean;
};

type RecoveryLogRow = {
  id: string;
  target_user_id: string;
  performed_by: string;
  reason: string;
  factors_removed: number;
  created_at: string;
};

function AdminSecurity() {
  const nav = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AdminMfaRow | null>(null);
  const [reason, setReason] = useState("");
  const qc = useQueryClient();

  const { data: myId } = useQuery({
    queryKey: ["my-id"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
  });

  const adminsQuery = useQuery({
    queryKey: ["admin-mfa-status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_admins_mfa_status");
      if (error) throw error;
      return (data ?? []) as AdminMfaRow[];
    },
  });

  const logQuery = useQuery({
    queryKey: ["mfa-recovery-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mfa_recovery_log")
        .select("id,target_user_id,performed_by,reason,factors_removed,created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as RecoveryLogRow[];
    },
  });

  const admins = adminsQuery.data ?? [];
  const byId = new Map(admins.map((a) => [a.user_id, a]));

  const doReset = async () => {
    if (!confirming || !reason.trim()) return;
    setBusyId(confirming.user_id);
    const { error } = await supabase.rpc("admin_reset_mfa", {
      _user_id: confirming.user_id,
      _reason: reason.trim(),
    });
    setBusyId(null);
    if (error) {
      if (isMfaRequiredError(error)) {
        toast.error("Verify your own authenticator code first");
        return nav({ to: "/mfa", search: { next: "/admin/security" } });
      }
      return toast.error(error.message);
    }
    toast.success(`${confirming.full_name}'s authenticator access was reset`);
    setConfirming(null);
    setReason("");
    qc.invalidateQueries({ queryKey: ["admin-mfa-status"] });
    qc.invalidateQueries({ queryKey: ["mfa-recovery-log"] });
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <KeyRound className="w-4 h-4 text-primary" />
          <h2 className="font-display font-bold text-sm uppercase tracking-wide">Admin MFA status</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          If an admin loses their authenticator app, another verified super admin can reset their factor here so they
          can re-enroll. This cannot be used on your own account — re-enroll normally from the MFA screen instead.
        </p>

        {adminsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !admins.length ? (
          <EmptyState icon={ShieldCheck} title="No admins found" />
        ) : (
          <div className="space-y-2">
            {admins.map((a) => {
              const isMe = a.user_id === myId;
              return (
                <div key={a.user_id} className="rounded-xl border bg-card p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {a.full_name} {isMe && <span className="text-muted-foreground font-normal">(you)</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {a.email} · {a.role.replace("_", " ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-semibold uppercase",
                        a.has_verified_mfa
                          ? "bg-success/15 text-success border-success/30"
                          : "bg-warning/15 text-warning border-warning/30"
                      )}
                    >
                      {a.has_verified_mfa ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                      {a.has_verified_mfa ? "Enrolled" : "Not enrolled"}
                    </span>
                    {!isMe && a.has_verified_mfa && (
                      <button
                        disabled={busyId === a.user_id}
                        onClick={() => setConfirming(a)}
                        className="rounded-md border px-2 py-1 text-[11px] font-semibold hover:bg-muted disabled:opacity-50"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <ScrollText className="w-4 h-4 text-primary" />
          <h2 className="font-display font-bold text-sm uppercase tracking-wide">Recovery log</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">Permanent — every emergency reset is recorded here.</p>
        {logQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !logQuery.data?.length ? (
          <p className="text-xs text-muted-foreground">No resets have been performed.</p>
        ) : (
          <div className="space-y-1.5">
            {logQuery.data.map((l) => (
              <div key={l.id} className="rounded-lg border bg-muted/30 p-2.5 text-xs">
                <p>
                  <span className="font-semibold">{byId.get(l.performed_by)?.full_name ?? "A super admin"}</span> reset{" "}
                  <span className="font-semibold">{byId.get(l.target_user_id)?.full_name ?? "an admin"}</span>'s MFA
                </p>
                <p className="text-muted-foreground mt-0.5">Reason: {l.reason}</p>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">{new Date(l.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirming && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
          onClick={() => !busyId && setConfirming(null)}
        >
          <div className="w-full max-w-sm rounded-2xl border bg-card p-5 shadow-lift" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-warning" />
              <h4 className="font-display font-bold text-base">Confirm MFA reset</h4>
            </div>
            <p className="text-sm mt-2">
              This clears <span className="font-semibold">{confirming.full_name}</span>'s authenticator app access.
              They'll need to re-enroll a new device the next time they access admin pages, and they'll be notified
              immediately.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (required — e.g. lost phone, replaced device)"
              rows={2}
              className="w-full mt-3 px-3 py-2 rounded-lg border bg-background text-sm resize-none"
            />
            <p className="text-[11px] text-muted-foreground mt-2 italic">
              This action is permanently recorded and cannot be edited or deleted.
            </p>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button
                disabled={!!busyId}
                onClick={() => setConfirming(null)}
                className="rounded-lg border py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                disabled={!!busyId || !reason.trim()}
                onClick={doReset}
                className="rounded-lg bg-destructive text-destructive-foreground py-2 text-sm font-semibold disabled:opacity-50"
              >
                {busyId ? "Resetting…" : "Confirm reset"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
