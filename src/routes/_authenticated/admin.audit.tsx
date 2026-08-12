import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollText, User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.user.id);
    const list = (roles ?? []).map((r: { role: string }) => r.role);
    if (!list.includes("super_admin")) throw redirect({ to: "/admin" });
  },
  component: AuditLogPage,
});

type AuditRow = {
  id: string;
  actor_id: string | null;
  action: string;
  target_user_id: string | null;
  target_id: string | null;
  meta: Record<string, unknown>;
  reason: string | null;
  created_at: string;
};

const ACTION_STYLE: Record<string, string> = {
  role_granted: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  role_revoked: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  commission_changed: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  user_status_changed: "bg-sky-500/15 text-sky-500 border-sky-500/30",
  driver_verification_changed: "bg-primary/15 text-primary border-primary/30",
  dispute_status_changed: "bg-violet-500/15 text-violet-500 border-violet-500/30",
  wallet_credited_by_admin: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  topup_approved: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  topup_rejected: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  withdrawal_approved: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  withdrawal_rejected: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  strike_waived: "bg-sky-500/15 text-sky-500 border-sky-500/30",
  demand_multiplier_updated: "bg-amber-500/15 text-amber-500 border-amber-500/30",
};

// Human-friendly labels for the meta JSON keys we log — falls back to the raw key if unmapped.
const META_KEY_LABEL: Record<string, string> = {
  job_id: "Job",
  outcome: "Outcome",
  dispute_id: "Dispute",
  role: "Role",
  note: "Note",
  amount: "Amount",
  new_balance: "New balance",
  new_status: "New status",
  old_status: "Previous status",
};

function formatMetaValue(key: string, value: unknown) {
  if ((key === "amount" || key === "new_balance") && typeof value === "number") {
    return `$${value.toFixed(2)}`;
  }
  if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value)) {
    return value.slice(0, 8); // shorten stray UUIDs (job/dispute ids) instead of showing the full string
  }
  return String(value);
}

function AuditLogPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-audit-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const rows = (data ?? []) as AuditRow[];

      // Resolve every actor/target id in this page of results to a real name in one batch query,
      // instead of showing raw UUIDs (this was the confusing part).
      const ids = Array.from(
        new Set(
          rows.flatMap((r) => [r.actor_id, r.target_user_id].filter(Boolean) as string[])
        )
      );
      let names: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id,full_name")
          .in("id", ids);
        names = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p.full_name]));
      }
      return { rows, names };
    },
    refetchInterval: 15000,
  });

  return (
    <div className="space-y-4">
      <Card className="p-4 flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/15 text-primary">
          <ScrollText className="w-5 h-5" />
        </div>
        <div>
          <h2 className="font-bold text-lg">Admin Audit Log</h2>
          <p className="text-xs text-muted-foreground">
            Every sensitive admin action is recorded here (last 200 entries).
          </p>
        </div>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data || data.rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No admin actions recorded yet.
        </Card>
      ) : (
        <div className="space-y-2">
          {data.rows.map((row) => {
            const actorName = row.actor_id ? data.names[row.actor_id] ?? "Unknown user" : "System";
            const targetName = row.target_user_id
              ? data.names[row.target_user_id] ?? "Unknown user"
              : null;
            const metaEntries = Object.entries(row.meta ?? {});
            return (
              <Card key={row.id} className="p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Badge
                    variant="outline"
                    className={ACTION_STYLE[row.action] ?? "bg-muted"}
                  >
                    {row.action.replaceAll("_", " ")}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                  <User className="w-3 h-3" />
                  <span className="font-medium text-foreground">{actorName}</span>
                  {targetName && (
                    <>
                      <span>→</span>
                      <span className="font-medium text-foreground">{targetName}</span>
                    </>
                  )}
                </div>
                {metaEntries.length > 0 && (
                  <div className="text-xs bg-muted rounded-lg p-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
                    {metaEntries.map(([key, value]) => (
                      <div key={key} className="contents">
                        <span className="text-muted-foreground">{META_KEY_LABEL[key] ?? key.replaceAll("_", " ")}</span>
                        <span className="font-medium text-right">{formatMetaValue(key, value)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {row.reason && (
                  <p className="text-xs italic text-muted-foreground">"{row.reason}"</p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
