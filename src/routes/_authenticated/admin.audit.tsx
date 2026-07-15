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
};

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
      return data as AuditRow[];
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
      ) : !data || data.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No admin actions recorded yet.
        </Card>
      ) : (
        <div className="space-y-2">
          {data.map((row) => (
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
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <User className="w-3 h-3" />
                <span className="font-mono">
                  actor: {row.actor_id?.slice(0, 8) ?? "system"}
                </span>
                {row.target_user_id && (
                  <span className="font-mono">
                    → target: {row.target_user_id.slice(0, 8)}
                  </span>
                )}
              </div>
              {Object.keys(row.meta ?? {}).length > 0 && (
                <pre className="text-[11px] bg-muted rounded p-2 overflow-x-auto">
                  {JSON.stringify(row.meta, null, 2)}
                </pre>
              )}
              {row.reason && (
                <p className="text-xs italic text-muted-foreground">"{row.reason}"</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
