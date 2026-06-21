import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/domain";
import { useAuth } from "@/lib/auth";
import { DollarSign, Download, Percent, Save, TrendingUp, Calendar, Users as UsersIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/revenue")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const list = (roles ?? []).map((r: { role: string }) => r.role);
    if (!list.includes("super_admin")) throw redirect({ to: "/admin" });
  },
  component: RevenueDashboard,
});

type Tx = {
  id: string;
  user_id: string;
  amount: number;
  job_id: string | null;
  note: string | null;
  created_at: string;
};

type Range = "7" | "30" | "90" | "all";

function RevenueDashboard() {
  const qc = useQueryClient();
  const { is } = useAuth();
  const isSuper = is("super_admin");
  const [range, setRange] = useState<Range>("30");

  const { data: rate } = useQuery({
    queryKey: ["commission-rate"],
    queryFn: async () => {
      const { data } = await supabase.from("system_settings").select("value").eq("key", "commission_rate").maybeSingle();
      return Number(data?.value ?? 7);
    },
  });

  const [value, setValue] = useState("");
  useEffect(() => {
    if (rate != null) setValue(String(rate));
  }, [rate]);

  const { data: txs } = useQuery({
    queryKey: ["commission-txs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("wallet_transactions")
        .select("id,user_id,amount,job_id,note,created_at")
        .eq("type", "commission")
        .order("created_at", { ascending: false })
        .limit(5000);
      return (data ?? []) as Tx[];
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ["driver-profiles-min"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id,full_name,email");
      const m = new Map<string, { name: string; email: string | null }>();
      (data ?? []).forEach((p) => m.set(p.id, { name: p.full_name, email: p.email }));
      return m;
    },
  });

  const stats = useMemo(() => {
    const all = txs ?? [];
    const now = Date.now();
    const day = 86_400_000;
    const inRange = (d: string, days: number) => now - new Date(d).getTime() <= days * day;
    const sum = (arr: Tx[]) => arr.reduce((a, t) => a + Math.abs(Number(t.amount)), 0);
    return {
      today: sum(all.filter((t) => inRange(t.created_at, 1))),
      d7: sum(all.filter((t) => inRange(t.created_at, 7))),
      d30: sum(all.filter((t) => inRange(t.created_at, 30))),
      total: sum(all),
      jobs: all.length,
    };
  }, [txs]);

  const filtered = useMemo(() => {
    const all = txs ?? [];
    if (range === "all") return all;
    const days = Number(range);
    const cutoff = Date.now() - days * 86_400_000;
    return all.filter((t) => new Date(t.created_at).getTime() >= cutoff);
  }, [txs, range]);

  const byDriver = useMemo(() => {
    const m = new Map<string, { total: number; count: number }>();
    filtered.forEach((t) => {
      const cur = m.get(t.user_id) ?? { total: 0, count: 0 };
      cur.total += Math.abs(Number(t.amount));
      cur.count += 1;
      m.set(t.user_id, cur);
    });
    return Array.from(m.entries())
      .map(([uid, v]) => ({ uid, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [filtered]);

  const saveRate = async () => {
    const v = Number(value);
    if (isNaN(v) || v < 0 || v > 100) return toast.error("Rate must be 0-100");
    const { error } = await supabase.rpc("admin_set_commission", { _rate: v });
    if (error) return toast.error(error.message);
    toast.success(`Commission set to ${v}%`);
    qc.invalidateQueries({ queryKey: ["commission-rate"] });
    qc.invalidateQueries({ queryKey: ["admin-dash"] });
  };

  const exportCsv = () => {
    const rows = [
      ["Date", "Driver", "Email", "Job ID", "Commission (USD)", "Note"],
      ...filtered.map((t) => {
        const p = profiles?.get(t.user_id);
        return [
          new Date(t.created_at).toISOString(),
          p?.name ?? t.user_id,
          p?.email ?? "",
          t.job_id ?? "",
          Math.abs(Number(t.amount)).toFixed(2),
          (t.note ?? "").replace(/"/g, '""'),
        ];
      }),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c)}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `commission-revenue-${range}d-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Report downloaded");
  };

  return (
    <div className="space-y-4">
      {/* Hero revenue card */}
      <div className="rounded-2xl bg-gradient-dark text-white p-5 shadow-lift">
        <div className="flex items-center gap-2 text-white/70 text-[11px] uppercase tracking-widest">
          <DollarSign className="w-3.5 h-3.5" /> All-time platform revenue
        </div>
        <div className="font-display font-bold text-4xl text-primary mt-1">{money(stats.total)}</div>
        <div className="text-xs text-white/60 mt-1">
          {stats.jobs} commission events at {rate ?? 7}% rate
        </div>
      </div>

      {/* Period stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Today
          </div>
          <div className="font-display font-bold text-lg mt-1">{money(stats.today)}</div>
        </div>
        <div className="rounded-2xl border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> 7d
          </div>
          <div className="font-display font-bold text-lg mt-1">{money(stats.d7)}</div>
        </div>
        <div className="rounded-2xl border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> 30d
          </div>
          <div className="font-display font-bold text-lg mt-1">{money(stats.d30)}</div>
        </div>
      </div>

      {/* Commission rate editor */}
      <div className="rounded-2xl border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Percent className="w-5 h-5 text-primary" />
          <h3 className="font-display font-bold uppercase tracking-wide">Global commission rate</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Deducted from a driver's wallet on every completed job. Changes apply immediately to future completions.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!isSuper}
            className="flex-1 px-3 py-2.5 rounded-xl border bg-background text-lg font-display font-bold disabled:opacity-50"
          />
          <span className="font-display font-bold text-2xl text-muted-foreground">%</span>
          <button
            onClick={saveRate}
            disabled={!isSuper}
            className="rounded-xl bg-primary text-primary-foreground font-semibold px-4 py-2.5 disabled:opacity-50"
          >
            <Save className="w-4 h-4 inline mr-1" /> Save
          </button>
        </div>
      </div>

      {/* Range + export */}
      <div className="rounded-2xl border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display font-bold uppercase tracking-wide text-sm">Revenue report</h3>
          <button
            onClick={exportCsv}
            className="rounded-lg bg-success text-success-foreground font-semibold px-3 py-1.5 text-xs"
          >
            <Download className="w-3.5 h-3.5 inline mr-1" /> Export CSV
          </button>
        </div>
        <div className="flex gap-2">
          {(["7", "30", "90", "all"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold uppercase ${
                range === r ? "bg-primary text-primary-foreground border-primary" : "bg-background"
              }`}
            >
              {r === "all" ? "All time" : `${r}d`}
            </button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">
          {filtered.length} events · {money(filtered.reduce((a, t) => a + Math.abs(Number(t.amount)), 0))} collected
        </div>
      </div>

      {/* Top drivers by commission */}
      <div className="rounded-2xl border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <UsersIcon className="w-4 h-4 text-primary" />
          <h3 className="font-display font-bold uppercase tracking-wide text-sm">Top drivers by commission</h3>
        </div>
        {!byDriver.length ? (
          <div className="text-xs text-muted-foreground py-4 text-center">No commission events in this period.</div>
        ) : (
          <div className="divide-y">
            {byDriver.slice(0, 20).map((d) => {
              const p = profiles?.get(d.uid);
              return (
                <div key={d.uid} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{p?.name ?? d.uid.slice(0, 8)}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {p?.email ?? ""} · {d.count} jobs
                    </div>
                  </div>
                  <div className="font-display font-bold text-sm">{money(d.total)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Link
        to="/admin"
        className="block text-center text-xs text-muted-foreground underline py-2"
      >
        Back to admin dashboard
      </Link>
    </div>
  );
}
