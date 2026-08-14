import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Download,
  FileSpreadsheet,
  FileText,
  Percent,
  RotateCcw,
  Scale,
  Search,
  Sliders,
  ScrollText,
} from "lucide-react";
import {
  LEDGER_STATUSES,
  STATUS_TONE,
  TX_TYPES,
  TYPE_TONE,
  buildSeries,
  exportCsv,
  exportExcel,
  exportPdf,
  summarise,
  type LedgerRow,
  type LedgerStatus,
  type TxType,
} from "@/lib/ledger";
import { LedgerCharts } from "@/components/LedgerCharts";
import { LedgerDetailDialog } from "@/components/LedgerDetailDialog";

export const Route = createFileRoute("/_authenticated/admin/ledger")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const list = (roles ?? []).map((r: { role: string }) => r.role);
    if (!list.includes("admin") && !list.includes("super_admin")) throw redirect({ to: "/admin" });
  },
  component: LedgerPage,
});

type Range = "7" | "30" | "90" | "all";
type Tab = "ledger" | "charts" | "reconcile" | "audit";

const PAGE_SIZE = 50;
const ROLE_RANK = ["super_admin", "admin", "driver", "customer"];

function cutoffIso(range: Range): string | null {
  if (range === "all") return null;
  return new Date(Date.now() - Number(range) * 86_400_000).toISOString();
}

function Card({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone?: string;
  icon: typeof Scale;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className={cn("font-display font-bold text-base mt-0.5", tone)}>{value}</div>
    </div>
  );
}

function LedgerPage() {
  const [tab, setTab] = useState<Tab>("ledger");
  const [range, setRange] = useState<Range>("30");
  const [type, setType] = useState<TxType | "all">("all");
  const [status, setStatus] = useState<LedgerStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [minAmt, setMinAmt] = useState("");
  const [maxAmt, setMaxAmt] = useState("");
  const [pages, setPages] = useState(1);
  const [detail, setDetail] = useState<LedgerRow | null>(null);

  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPages(1);
  };

  const { data: people } = useQuery({
    queryKey: ["ledger-people"],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id,full_name,email"),
        supabase.from("user_roles").select("user_id,role"),
      ]);
      const best = new Map<string, string>();
      (roles ?? []).forEach((r) => {
        const cur = best.get(r.user_id);
        if (!cur || ROLE_RANK.indexOf(r.role) < ROLE_RANK.indexOf(cur)) best.set(r.user_id, r.role);
      });
      const m = new Map<string, { name: string; email: string | null; role: string }>();
      (profiles ?? []).forEach((p) =>
        m.set(p.id, { name: p.full_name, email: p.email, role: best.get(p.id) ?? "customer" }),
      );
      return m;
    },
  });

  // Settled money movements, paged server-side.
  const { data: txRows, isLoading } = useQuery({
    queryKey: ["ledger-tx", range, type, pages],
    queryFn: async () => {
      let q = supabase
        .from("wallet_transactions")
        .select("id,user_id,type,amount,balance_after,job_id,note,created_by,created_at,category,reversal_of_transaction_id")
        .order("created_at", { ascending: false })
        .range(0, pages * PAGE_SIZE - 1);
      const c = cutoffIso(range);
      if (c) q = q.gte("created_at", c);
      if (type !== "all") q = q.eq("type", type);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map<LedgerRow>((r) => ({
        id: r.id,
        source: "transaction",
        user_id: r.user_id,
        type: r.type as TxType,
        amount: Number(r.amount),
        balance_after: Number(r.balance_after),
        status: "completed",
        job_id: r.job_id,
        note: r.note,
        reference: null,
        method: null,
        created_by: r.created_by,
        created_at: r.created_at,
        category: r.category,
        reversal_of_transaction_id: r.reversal_of_transaction_id,
      }));
    },
  });

  // Requests that never became transactions (pending / rejected / cancelled).
  const { data: requestRows } = useQuery({
    queryKey: ["ledger-requests", range],
    queryFn: async () => {
      const c = cutoffIso(range);
      const build = (table: "wallet_topup_requests" | "wallet_withdrawal_requests") => {
        let q = supabase
          .from(table)
          .select("id,user_id,amount,method,status,note,decided_by,created_at")
          .neq("status", "approved")
          .order("created_at", { ascending: false })
          .limit(500);
        if (c) q = q.gte("created_at", c);
        return q;
      };
      const [top, wit] = await Promise.all([build("wallet_topup_requests"), build("wallet_withdrawal_requests")]);
      const map = (rows: typeof top.data, kind: TxType, sign: number): LedgerRow[] =>
        (rows ?? []).map((r) => ({
          id: r.id,
          source: kind === "topup" ? "topup_request" : "withdrawal_request",
          user_id: r.user_id,
          type: kind,
          amount: sign * Number(r.amount),
          balance_after: null,
          status: (r.status as LedgerStatus) ?? "pending",
          job_id: null,
          note: r.note ?? `${kind} request via ${r.method}`,
          reference: null,
          method: r.method,
          created_by: r.decided_by,
          created_at: r.created_at,
        }));
      return [...map(top.data, "topup", 1), ...map(wit.data, "withdrawal", -1)];
    },
  });

  // Range-wide aggregate for summary cards + charts (independent of paging).
  const { data: aggregate } = useQuery({
    queryKey: ["ledger-aggregate", range],
    queryFn: async () => {
      let q = supabase.from("wallet_transactions").select("id,user_id,type,amount,created_at").limit(10000);
      const c = cutoffIso(range);
      if (c) q = q.gte("created_at", c);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map<LedgerRow>((r) => ({
        id: r.id,
        source: "transaction",
        user_id: r.user_id,
        type: r.type as TxType,
        amount: Number(r.amount),
        balance_after: null,
        status: "completed",
        job_id: null,
        note: null,
        reference: null,
        method: null,
        created_by: null,
        created_at: r.created_at,
      }));
    },
  });

  const { data: reconcile } = useQuery({
    queryKey: ["ledger-reconcile"],
    queryFn: async () => {
      const [{ data: wallets }, { data: all }] = await Promise.all([
        supabase.from("wallets").select("balance").limit(10000),
        supabase.from("wallet_transactions").select("type,amount").limit(20000),
      ]);
      const walletTotal = (wallets ?? []).reduce((a, w) => a + Number(w.balance), 0);
      let deposited = 0,
        withdrawn = 0,
        commissions = 0,
        refunds = 0,
        adjustments = 0;
      (all ?? []).forEach((t) => {
        const abs = Math.abs(Number(t.amount));
        if (t.type === "topup") deposited += abs;
        else if (t.type === "withdrawal") withdrawn += abs;
        else if (t.type === "commission") commissions += abs;
        else if (t.type === "refund") refunds += abs;
        else adjustments += Number(t.amount);
      });
      const expected = deposited - withdrawn - commissions + refunds + adjustments;
      return {
        walletTotal,
        deposited,
        withdrawn,
        commissions,
        refunds,
        adjustments,
        expected,
        variance: walletTotal - expected,
      };
    },
  });

  const { data: auditLog } = useQuery({
    queryKey: ["ledger-audit"],
    enabled: tab === "audit",
    queryFn: async () => {
      const [{ data: wal }, { data: adm }] = await Promise.all([
        supabase
          .from("wallet_audit_log")
          .select("id,user_id,actor_id,action,meta,created_at")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("admin_audit_log")
          .select("id,actor_id,action,target_user_id,meta,reason,created_at")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      const rows = [
        ...(wal ?? []).map((r) => ({
          id: r.id,
          action: r.action,
          actor: r.actor_id,
          subject: r.user_id,
          detail: JSON.stringify(r.meta),
          created_at: r.created_at,
        })),
        ...(adm ?? []).map((r) => ({
          id: r.id,
          action: r.action,
          actor: r.actor_id,
          subject: r.target_user_id,
          detail: r.reason ?? JSON.stringify(r.meta),
          created_at: r.created_at,
        })),
      ];
      return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
  });

  const totals = useMemo(() => summarise(aggregate ?? []), [aggregate]);
  const series = useMemo(() => buildSeries(aggregate ?? []), [aggregate]);

  const visible = useMemo(() => {
    const merged = [...(txRows ?? []), ...(requestRows ?? [])].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
    const term = search.trim().toLowerCase();
    const lo = minAmt.trim() === "" ? null : Number(minAmt);
    const hi = maxAmt.trim() === "" ? null : Number(maxAmt);
    return merged.filter((r) => {
      if (type !== "all" && r.type !== type) return false;
      if (status !== "all" && r.status !== status) return false;
      const abs = Math.abs(Number(r.amount));
      if (lo != null && !Number.isNaN(lo) && abs < lo) return false;
      if (hi != null && !Number.isNaN(hi) && abs > hi) return false;
      if (term) {
        const p = people?.get(r.user_id);
        const hay = `${p?.name ?? ""} ${p?.email ?? ""} ${r.user_id} ${r.note ?? ""} ${r.id}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [txRows, requestRows, search, minAmt, maxAmt, type, status, people]);

  const hasMore = (txRows?.length ?? 0) >= pages * PAGE_SIZE;

  const exportRows = () =>
    visible.map((r) => {
      const p = people?.get(r.user_id);
      return [
        r.id,
        new Date(r.created_at).toLocaleString(),
        p?.name ?? r.user_id,
        p?.role ?? "—",
        r.type,
        Number(r.amount).toFixed(2),
        r.status,
        r.note ?? r.reference ?? "",
        r.job_id ?? "",
        (r.created_by ? people?.get(r.created_by)?.name : null) ?? r.created_by ?? "System",
      ];
    });

  const filename = `conz-financial-ledger-${range}-${new Date().toISOString().slice(0, 10)}`;
  const subtitle = `${visible.length} rows • ${range === "all" ? "all time" : `last ${range} days`} • generated ${new Date().toLocaleString()}`;

  const doExport = (kind: "csv" | "xls" | "pdf") => {
    const rows = exportRows();
    if (rows.length === 0) return toast.error("Nothing to export with these filters");
    if (kind === "csv") exportCsv(rows, filename);
    else if (kind === "xls") exportExcel(rows, filename);
    else exportPdf(rows, filename, totals, subtitle);
    toast.success(`Exported ${rows.length} rows`);
  };

  const clearFilters = () => {
    setType("all");
    setStatus("all");
    setSearch("");
    setMinAmt("");
    setMaxAmt("");
    setPages(1);
  };

  return (
    <div className="space-y-4">
      {/* Summary — settled totals for the selected range */}
      <div className="rounded-2xl bg-gradient-dark text-white p-5 shadow-lift">
        <div className="flex items-center gap-2 text-white/70 text-[11px] uppercase tracking-widest">
          <BookOpen className="w-3.5 h-3.5" /> Financial ledger
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/60 flex items-center gap-1">
              <ArrowDownLeft className="w-3 h-3" /> Top-ups
            </div>
            <div className="font-display font-bold text-lg text-success">{money(totals.topups)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/60 flex items-center gap-1">
              <ArrowUpRight className="w-3 h-3" /> Withdrawals
            </div>
            <div className="font-display font-bold text-lg text-warning">{money(totals.withdrawals)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/60 flex items-center gap-1">
              <Scale className="w-3 h-3" /> Net revenue
            </div>
            <div className="font-display font-bold text-lg">{money(totals.net)}</div>
          </div>
        </div>
        <div className="text-[11px] text-white/60 mt-2">
          {totals.count} settled transactions • {range === "all" ? "all time" : `last ${range} days`}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Card label="Commissions" value={money(totals.commissions)} icon={Percent} tone="text-primary" />
        <Card label="Refunds" value={money(totals.refunds)} icon={RotateCcw} tone="text-destructive" />
        <Card label="Adjustments" value={money(totals.adjustments)} icon={Sliders} />
      </div>

      {/* View & range — which panel below is showing, and over what window */}
      <div className="flex gap-2 overflow-x-auto -mx-4 px-4">
        {(
          [
            ["ledger", "Ledger"],
            ["charts", "Charts"],
            ["reconcile", "Reconcile"],
            ["audit", "Audit log"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap",
              tab === k ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        {(["7", "30", "90", "all"] as const).map((r) => (
          <button
            key={r}
            onClick={() => reset(setRange)(r)}
            className={cn(
              "flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold uppercase",
              range === r ? "bg-primary text-primary-foreground border-primary" : "bg-background",
            )}
          >
            {r === "all" ? "All time" : `${r}d`}
          </button>
        ))}
      </div>

      {/* Ledger tab — the default view: filterable transaction feed */}
      {tab === "ledger" && (
        <>
          <div className="rounded-2xl border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display font-bold uppercase tracking-wide text-sm">Filters</h3>
              <button onClick={clearFilters} className="text-[11px] underline text-muted-foreground">
                Clear
              </button>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              {(["all", ...TX_TYPES] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => reset(setType)(t as TxType | "all")}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap",
                    type === t ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              {(["all", ...LEDGER_STATUSES] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => reset(setStatus)(s as LedgerStatus | "all")}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap",
                    status === s ? "bg-foreground text-background border-foreground" : "bg-background text-muted-foreground",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search user, email, note or transaction ID"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border bg-background text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input
                value={minAmt}
                onChange={(e) => setMinAmt(e.target.value)}
                inputMode="decimal"
                placeholder="Min amount"
                className="w-full px-3 py-2.5 rounded-xl border bg-background text-sm"
              />
              <input
                value={maxAmt}
                onChange={(e) => setMaxAmt(e.target.value)}
                inputMode="decimal"
                placeholder="Max amount"
                className="w-full px-3 py-2.5 rounded-xl border bg-background text-sm"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => doExport("csv")}
                className="rounded-lg bg-success text-success-foreground font-semibold px-2 py-2 text-[11px] uppercase"
              >
                <Download className="w-3.5 h-3.5 inline mr-1" /> CSV
              </button>
              <button
                onClick={() => doExport("xls")}
                className="rounded-lg bg-primary text-primary-foreground font-semibold px-2 py-2 text-[11px] uppercase"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 inline mr-1" /> Excel
              </button>
              <button
                onClick={() => doExport("pdf")}
                className="rounded-lg border bg-background font-semibold px-2 py-2 text-[11px] uppercase"
              >
                <FileText className="w-3.5 h-3.5 inline mr-1" /> PDF
              </button>
            </div>
          </div>

          <div className="rounded-2xl border bg-card divide-y">
            {isLoading ? (
              <div className="p-6 text-center text-xs text-muted-foreground">Loading ledger…</div>
            ) : visible.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">No transactions match these filters.</div>
            ) : (
              visible.map((r) => {
                const p = people?.get(r.user_id);
                const amount = Number(r.amount);
                return (
                  <button
                    key={`${r.source}-${r.id}`}
                    onClick={() => setDetail(r)}
                    className="w-full text-left p-3 space-y-1 hover:bg-muted/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate">{p?.name ?? r.user_id.slice(0, 8)}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {p?.role ?? "—"} · {p?.email ?? r.user_id}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={cn("font-display font-bold text-sm", amount >= 0 ? "text-success" : "text-destructive")}>
                          {amount >= 0 ? "+" : "−"}
                          {money(Math.abs(amount))}
                        </div>
                        {r.balance_after != null && (
                          <div className="text-[10px] text-muted-foreground">bal {money(Number(r.balance_after))}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn("inline-flex px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase", TYPE_TONE[r.type])}>
                        {r.type}
                      </span>
                      {r.category && (
                        <span className="inline-flex px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase bg-secondary/15 text-secondary-foreground border-secondary/30">
                          {String(r.category).replace(/_/g, " ")}
                        </span>
                      )}
                      {r.reversal_of_transaction_id && (
                        <span className="inline-flex px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase bg-muted text-muted-foreground border-border">
                          reversal
                        </span>
                      )}
                      <span className={cn("inline-flex px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase", STATUS_TONE[r.status])}>
                        {r.status}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                      {r.job_id && (
                        <span className="text-[10px] font-mono text-primary">job {r.job_id.slice(0, 8)}</span>
                      )}
                    </div>
                    {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
                  </button>
                );
              })
            )}
          </div>

          {hasMore && (
            <button
              onClick={() => setPages((p) => p + 1)}
              className="w-full rounded-xl border bg-card py-2.5 text-xs font-semibold uppercase tracking-wide"
            >
              Load {PAGE_SIZE} more
            </button>
          )}
        </>
      )}

      {/* Charts tab — revenue trend visualisation */}
      {tab === "charts" && <LedgerCharts data={series} />}

      {/* Reconcile tab — wallet balances vs. transaction history, flags drift */}
      {tab === "reconcile" && (
        <div className="rounded-2xl border bg-card p-4 space-y-2">
          <h3 className="font-display font-bold uppercase tracking-wide text-sm">Reconciliation (all time)</h3>
          {[
            ["Total wallet balances held", reconcile?.walletTotal],
            ["Total money deposited", reconcile?.deposited],
            ["Total money withdrawn", reconcile?.withdrawn],
            ["Total commissions earned", reconcile?.commissions],
            ["Total refunds issued", reconcile?.refunds],
            ["Manual adjustments", reconcile?.adjustments],
            ["Expected wallet balance", reconcile?.expected],
          ].map(([label, v]) => (
            <div key={String(label)} className="flex items-center justify-between text-xs py-1.5 border-b">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-semibold">{money(Number(v ?? 0))}</span>
            </div>
          ))}
          <div
            className={cn(
              "rounded-xl border p-3 mt-2",
              Math.abs(reconcile?.variance ?? 0) < 0.01
                ? "bg-success/10 border-success/30"
                : "bg-destructive/10 border-destructive/30",
            )}
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Variance check</div>
            <div className="font-display font-bold text-lg">{money(reconcile?.variance ?? 0)}</div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {Math.abs(reconcile?.variance ?? 0) < 0.01
                ? "Wallet balances match the transaction history exactly."
                : "Wallet balances do not match the transaction history — investigate adjustments or direct balance edits."}
            </p>
          </div>
        </div>
      )}

      {/* Audit tab — who approved/rejected/adjusted what */}
      {tab === "audit" && (
        <div className="rounded-2xl border bg-card divide-y">
          <div className="p-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
            <ScrollText className="w-3.5 h-3.5" /> Approvals, rejections, refunds & adjustments
          </div>
          {(auditLog ?? []).length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">No audit entries recorded yet.</div>
          ) : (
            (auditLog ?? []).map((a) => (
              <div key={a.id} className="p-3">
                <div className="text-sm font-semibold capitalize">{a.action.replace(/_/g, " ")}</div>
                <div className="text-[11px] text-muted-foreground">
                  by {a.actor ? (people?.get(a.actor)?.name ?? a.actor.slice(0, 8)) : "system"}
                  {a.subject ? ` • on ${people?.get(a.subject)?.name ?? a.subject.slice(0, 8)}` : ""} •{" "}
                  {new Date(a.created_at).toLocaleString()}
                </div>
                {a.detail && a.detail !== "{}" && (
                  <p className="text-[11px] text-muted-foreground mt-1 break-all">{a.detail}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      <Link to="/admin" className="block text-center text-xs text-muted-foreground underline py-2">
        Back to admin dashboard
      </Link>

      {detail && <LedgerDetailDialog row={detail} people={people} onClose={() => setDetail(null)} />}
    </div>
  );
}
