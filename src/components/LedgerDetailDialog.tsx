import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { STATUS_TONE, TYPE_TONE, type LedgerRow } from "@/lib/ledger";

type Person = { name: string; email: string | null; role: string };

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="py-2 border-b last:border-0 flex items-start justify-between gap-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">{label}</div>
      <div className="text-xs text-right break-all">{value}</div>
    </div>
  );
}

export function LedgerDetailDialog({
  row,
  people,
  onClose,
}: {
  row: LedgerRow;
  people: Map<string, Person> | undefined;
  onClose: () => void;
}) {
  const person = people?.get(row.user_id);
  const actor = row.created_by ? people?.get(row.created_by) : null;

  // Full money history for this account, so an admin can see the movement in context.
  const { data: history } = useQuery({
    queryKey: ["ledger-detail-history", row.user_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("wallet_transactions")
        .select("id,type,amount,balance_after,note,created_at")
        .eq("user_id", row.user_id)
        .order("created_at", { ascending: false })
        .limit(15);
      return data ?? [];
    },
  });

  const { data: audit } = useQuery({
    queryKey: ["ledger-detail-audit", row.user_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("wallet_audit_log")
        .select("id,action,actor_id,meta,created_at")
        .eq("user_id", row.user_id)
        .order("created_at", { ascending: false })
        .limit(15);
      return data ?? [];
    },
  });

  const amount = Number(row.amount);

  return (
    <div className="fixed inset-0 z-[3000] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display font-bold uppercase tracking-wide text-sm">Transaction detail</h3>
            <p className="text-[11px] text-muted-foreground font-mono">{row.id}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg border p-1.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="rounded-xl border bg-background p-3">
          <div className={cn("font-display font-bold text-2xl", amount >= 0 ? "text-success" : "text-destructive")}>
            {amount >= 0 ? "+" : "−"}
            {money(Math.abs(amount))}
          </div>
          <div className="flex gap-2 mt-1">
            <span className={cn("px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase", TYPE_TONE[row.type])}>
              {row.type}
            </span>
            <span className={cn("px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase", STATUS_TONE[row.status])}>
              {row.status}
            </span>
          </div>
        </div>

        <div className="rounded-xl border bg-background px-3">
          <Field label="Date & time" value={new Date(row.created_at).toLocaleString()} />
          <Field label="User" value={person?.name ?? row.user_id} />
          <Field label="Email" value={person?.email ?? "—"} />
          <Field label="Role" value={person?.role ?? "—"} />
          <Field label="Balance after" value={row.balance_after == null ? "—" : money(Number(row.balance_after))} />
          <Field label="Method" value={row.method ?? "—"} />
          <Field label="Reference" value={row.reference ?? "—"} />
          <Field label="Description" value={row.note ?? "—"} />
          <Field label="Created by" value={actor?.name ?? row.created_by ?? "System"} />
          <Field
            label="Related job"
            value={
              row.job_id ? (
                <Link to="/jobs/$id" params={{ id: row.job_id }} className="underline text-primary font-mono">
                  {row.job_id.slice(0, 8)}
                </Link>
              ) : (
                "—"
              )
            }
          />
          <Field label="Source" value={row.source.replace("_", " ")} />
        </div>

        <div>
          <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Account history (last 15)</h4>
          <div className="rounded-xl border bg-background divide-y">
            {(history ?? []).length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">No other transactions.</div>
            ) : (
              (history ?? []).map((h) => (
                <div key={h.id} className="p-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold capitalize">{h.type}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {new Date(h.created_at).toLocaleString()} · {h.note ?? "—"}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={cn("text-xs font-bold", Number(h.amount) >= 0 ? "text-success" : "text-destructive")}>
                      {money(Number(h.amount))}
                    </div>
                    <div className="text-[10px] text-muted-foreground">bal {money(Number(h.balance_after))}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Audit trail</h4>
          <div className="rounded-xl border bg-background divide-y">
            {(audit ?? []).length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">No audit entries for this account.</div>
            ) : (
              (audit ?? []).map((a) => (
                <div key={a.id} className="p-2.5">
                  <div className="text-xs font-semibold">{a.action.replace(/_/g, " ")}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()} ·{" "}
                    {a.actor_id ? (people?.get(a.actor_id)?.name ?? a.actor_id.slice(0, 8)) : "system"}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
