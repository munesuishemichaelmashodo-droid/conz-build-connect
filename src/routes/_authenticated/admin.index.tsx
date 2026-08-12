import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/domain";
import { useAuth } from "@/lib/auth";
import { Users, Truck, Briefcase, DollarSign, AlertOctagon, ShieldCheck, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminDashboard,
});

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  to,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  sub?: string;
  to?: "/admin/users" | "/admin/verifications" | "/admin/disputes";
}) {
  const content = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="flex items-end justify-between mt-1">
        <div className="font-display font-bold text-2xl">{value}</div>
        {to && <ChevronRight className="w-4 h-4 text-muted-foreground mb-1" />}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </>
  );

  if (to) {
    return (
      <Link to={to} className="rounded-2xl border bg-card p-4 shadow-card block active:opacity-70 transition">
        {content}
      </Link>
    );
  }
  return <div className="rounded-2xl border bg-card p-4 shadow-card">{content}</div>;
}

function AdminDashboard() {
  const { is } = useAuth();
  const isSuper = is("super_admin");

  const { data } = useQuery({
    queryKey: ["admin-dash", isSuper],
    queryFn: async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const commissionQuery = supabase.from("wallet_transactions").select("amount").eq("type", "commission");
      if (!isSuper) commissionQuery.gte("created_at", todayStart.toISOString());

      const [users, drivers, jobsOpen, jobsDone, pendingV, disputes, commissionRows, rate] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "driver"),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "open"),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "completed"),
        supabase.from("driver_profiles").select("user_id", { count: "exact", head: true }).eq("verification_status", "pending"),
        supabase.from("disputes").select("id", { count: "exact", head: true }).in("status", ["open", "investigating"]),
        commissionQuery,
        // Non-super admins don't need the commission rate surfaced on the dashboard.
        isSuper
          ? supabase.from("system_settings").select("value").eq("key", "commission_rate").maybeSingle()
          : Promise.resolve({ data: null as { value: string } | null }),
      ]);
      const commission = (commissionRows.data ?? []).reduce((a, r) => a + Math.abs(Number(r.amount)), 0);
      return {
        users: users.count ?? 0,
        drivers: drivers.count ?? 0,
        jobsOpen: jobsOpen.count ?? 0,
        jobsDone: jobsDone.count ?? 0,
        pendingV: pendingV.count ?? 0,
        disputes: disputes.count ?? 0,
        commission,
        rate: rate.data?.value != null ? Number(rate.data.value) : null,
      };
    },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat icon={Users} label="Users" value={String(data?.users ?? 0)} sub={`${data?.drivers ?? 0} drivers`} to="/admin/users" />
        <Stat icon={Briefcase} label="Open jobs" value={String(data?.jobsOpen ?? 0)} sub={`${data?.jobsDone ?? 0} completed`} />
        <Stat icon={ShieldCheck} label="Pending verify" value={String(data?.pendingV ?? 0)} to="/admin/verifications" />
        <Stat icon={AlertOctagon} label="Open disputes" value={String(data?.disputes ?? 0)} to="/admin/disputes" />
      </div>
      <div className="rounded-2xl bg-gradient-dark text-white p-5 shadow-lift">
        <div className="flex items-center gap-2 text-white/70 text-[11px] uppercase tracking-widest">
          <DollarSign className="w-3.5 h-3.5" /> {isSuper ? "Platform revenue" : "Today's revenue"}
        </div>
        <div className="font-display font-bold text-4xl text-primary mt-1">{money(data?.commission ?? 0)}</div>
        <div className="text-xs text-white/60 mt-1">
          {isSuper
            ? `Total commission collected at ${data?.rate ?? 7}%`
            : "Resets at midnight — resets daily, no historical figures shown here"}
        </div>
      </div>
      <div className="rounded-xl border bg-muted/30 p-4 text-xs text-muted-foreground flex items-start gap-2">
        <Truck className="w-4 h-4 mt-0.5 text-primary" />
        <span>Use the tabs above to manage users, approve drivers, and settle disputes.</span>
      </div>
    </div>
  );
}
