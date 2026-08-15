import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { StatusBadge, EmptyState } from "@/components/ui-bits";
import { money } from "@/lib/domain";
import { isMfaRequiredError } from "@/lib/mfa";
import { Gift, Search as SearchIcon, AlertTriangle, Check, X, Snowflake, Unlock, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/referrals")({
  component: AdminReferrals,
});

type Filter = "all" | "pending" | "hold" | "released" | "rejected" | "frozen" | "fraud";

type ReferralAdminRow = {
  id: string;
  referrer_id: string;
  referred_id: string;
  referral_code: string;
  referred_role: string;
  verification_status: string;
  reward_status: string;
  reward_amount: number | null;
  reward_release_at: string | null;
  fraud_flag: boolean;
  fraud_reason: string | null;
  admin_notes: string | null;
  created_at: string;
  referrer?: { full_name: string; email: string | null } | null;
  referred?: { full_name: string; email: string | null } | null;
};

const STATUS_TONE: Record<string, string> = {
  pending: "bg-muted text-muted-foreground border-border",
  hold: "bg-warning/15 text-warning border-warning/30",
  approved: "bg-secondary/15 text-secondary-foreground border-secondary/30",
  released: "bg-success/15 text-success border-success/30",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
  frozen: "bg-destructive/15 text-destructive border-destructive/30",
};

function AdminReferrals() {
  const { is } = useAuth();
  const isSuper = is("super_admin");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const qc = useQueryClient();
  const nav = useNavigate();

  const statsQuery = useQuery({
    queryKey: ["admin-referral-stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_referral_stats");
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const listQuery = useQuery({
    queryKey: ["admin-referrals", filter],
    queryFn: async () => {
      let q = supabase
        .from("referrals")
        .select(
          "id,referrer_id,referred_id,referral_code,referred_role,verification_status,reward_status,reward_amount,reward_release_at,fraud_flag,fraud_reason,admin_notes,created_at"
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (filter === "fraud") q = q.eq("fraud_flag", true);
      else if (filter !== "all") q = q.eq("reward_status", filter);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as ReferralAdminRow[];

      const ids = Array.from(new Set(rows.flatMap((r) => [r.referrer_id, r.referred_id])));
      if (ids.length) {
        const { data: people, error: pErr } = await supabase
          .from("profiles")
          .select("id,full_name,email")
          .in("id", ids);
        if (pErr) throw pErr;
        const byId = new Map((people ?? []).map((p) => [p.id, p]));
        for (const r of rows) {
          r.referrer = byId.get(r.referrer_id) ?? null;
          r.referred = byId.get(r.referred_id) ?? null;
        }
      }
      return rows;
    },
  });

  const rows = (listQuery.data ?? []).filter((r) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      r.referral_code.toLowerCase().includes(s) ||
      r.referrer?.full_name?.toLowerCase().includes(s) ||
      r.referred?.full_name?.toLowerCase().includes(s) ||
      r.referrer?.email?.toLowerCase().includes(s) ||
      r.referred?.email?.toLowerCase().includes(s)
    );
  });

  const act = async (row: ReferralAdminRow, action: "approve" | "reject" | "freeze" | "unfreeze" | "release") => {
    if (action === "release" && !isSuper) return toast.error("Only super admins can force-release a reward");
    let notes: string | null = null;
    if (["reject", "freeze"].includes(action)) {
      notes = window.prompt(`Reason for ${action === "reject" ? "rejecting" : "freezing"} this referral reward:`);
      if (!notes?.trim()) return;
    }
    setBusyId(row.id);
    const { error } = await supabase.rpc("admin_referral_action", {
      _referral_id: row.id,
      _action: action,
      _notes: notes ?? undefined,
    });
    setBusyId(null);
    if (error) {
      if (isMfaRequiredError(error)) {
        toast.error("Your session needs a fresh MFA check");
        return nav({ to: "/mfa", search: { next: "/admin/referrals" } });
      }
      return toast.error(error.message);
    }
    toast.success("Referral updated");
    qc.invalidateQueries({ queryKey: ["admin-referrals"] });
    qc.invalidateQueries({ queryKey: ["admin-referral-stats"] });
  };

  const stats = statsQuery.data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total referrals" value={String(stats?.total_referrals ?? "…")} />
        <StatCard label="Pending / hold" value={String(stats?.pending_rewards ?? "…")} tone="text-warning" />
        <StatCard label="Released" value={String(stats?.released_rewards ?? "…")} tone="text-success" />
        <StatCard label="Paid out" value={money(stats?.total_released_amount ?? 0)} tone="text-success" />
        <StatCard label="Rejected" value={String(stats?.rejected_rewards ?? "…")} />
        <StatCard label="Fraud alerts" value={String(stats?.fraud_alerts ?? "…")} tone="text-destructive" />
      </div>

      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or code…"
          className="w-full pl-9 pr-3 py-2 rounded-lg border bg-background text-sm"
        />
      </div>

      <div className="-mx-4 px-4 overflow-x-auto">
        <div className="flex gap-2 min-w-max pb-1">
          {(["all", "pending", "hold", "released", "rejected", "frozen", "fraud"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide",
                filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {listQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !rows.length ? (
        <EmptyState icon={Gift} title="No referrals found" hint="Try a different filter or search term." />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl border bg-card p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {r.referrer?.full_name ?? "Unknown"} <span className="text-muted-foreground font-normal">referred</span>{" "}
                    {r.referred?.full_name ?? "Unknown"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {r.referral_code} · {r.referred_role} · {new Date(r.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {r.reward_amount != null && <p className="text-sm font-semibold">{money(r.reward_amount)}</p>}
                  <StatusBadge label={r.reward_status} className={STATUS_TONE[r.reward_status]} />
                </div>
              </div>

              {r.fraud_flag && (
                <div className="flex items-start gap-1.5 rounded-lg bg-destructive/10 border border-destructive/30 p-2 text-[11px] text-destructive">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{r.fraud_reason ?? "Flagged for review"}</span>
                </div>
              )}
              {r.admin_notes && (
                <p className="text-[11px] text-muted-foreground italic">Notes: {r.admin_notes}</p>
              )}

              <div className="flex flex-wrap gap-1.5">
                {r.reward_status !== "released" && r.reward_status !== "rejected" && (
                  <>
                    {r.fraud_flag ? (
                      <ActionBtn icon={Check} label="Approve" onClick={() => act(r, "approve")} busy={busyId === r.id} tone="success" />
                    ) : null}
                    <ActionBtn icon={X} label="Reject" onClick={() => act(r, "reject")} busy={busyId === r.id} tone="destructive" />
                    {r.reward_status === "frozen" ? (
                      <ActionBtn icon={Unlock} label="Unfreeze" onClick={() => act(r, "unfreeze")} busy={busyId === r.id} />
                    ) : (
                      <ActionBtn icon={Snowflake} label="Freeze" onClick={() => act(r, "freeze")} busy={busyId === r.id} />
                    )}
                    {isSuper && r.reward_amount != null && (
                      <ActionBtn icon={ArrowUpRight} label="Force release" onClick={() => act(r, "release")} busy={busyId === r.id} tone="success" />
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className={cn("font-display font-bold text-lg", tone)}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onClick,
  busy,
  tone,
}: {
  icon: typeof Check;
  label: string;
  onClick: () => void;
  busy: boolean;
  tone?: "success" | "destructive";
}) {
  return (
    <button
      disabled={busy}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold disabled:opacity-50",
        tone === "success" && "bg-success/15 text-success border-success/30 hover:bg-success/25",
        tone === "destructive" && "bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/25",
        !tone && "hover:bg-muted"
      )}
    >
      <Icon className="w-3 h-3" /> {label}
    </button>
  );
}
