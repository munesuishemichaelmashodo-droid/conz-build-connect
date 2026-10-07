import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Search, ShieldOff, ShieldCheck, Ban, Wallet, X, Phone, Undo2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge, EmptyState } from "@/components/ui-bits";
import { money } from "@/lib/domain";
import { useAuth } from "@/lib/auth";
import { isMfaRequiredError, isSecondApprovalError, mfaVerifyHref, readableRpcError } from "@/lib/mfa";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: AdminUsers,
});

type AdjustCategory =
  | "refund"
  | "promotion"
  | "dispute_resolution"
  | "payment_correction"
  | "escrow_adjustment"
  | "other";

const CATEGORIES: { value: AdjustCategory; label: string }[] = [
  { value: "refund", label: "Refund" },
  { value: "promotion", label: "Promotional credit" },
  { value: "dispute_resolution", label: "Dispute resolution" },
  { value: "payment_correction", label: "Payment correction" },
  { value: "escrow_adjustment", label: "Escrow adjustment" },
  { value: "other", label: "Other" },
];

// Server-enforced (admin_money_guard): ordinary admins can only deduct;
// super admin credits need MFA, a daily cap, and a second super admin above
// the threshold. The UI only mirrors those rules.
function moneyActionError(error: { message?: string }) {
  if (isMfaRequiredError(error)) {
    toast.error(readableRpcError(error), {
      action: { label: "Verify", onClick: () => window.location.assign(mfaVerifyHref()) },
    });
    return;
  }
  toast.error(readableRpcError(error));
}

type LedgerRow = {
  id: string;
  amount: number;
  balance_after: number;
  previous_balance: number | null;
  category: AdjustCategory | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
  reversal_of_transaction_id: string | null;
};

// Best-effort client-side public IP lookup for the audit trail. Never blocks the flow.
async function getClientIp(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2500);
    const res = await fetch("https://api.ipify.org?format=json", { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.ip ?? null;
  } catch {
    return null;
  }
}

type Row = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: "active" | "suspended" | "banned";
  roles: string[];
  balance: number;
};

function AdminUsers() {
  const [q, setQ] = useState("");
  const [active, setActive] = useState<Row | null>(null);
  const qc = useQueryClient();
  const { is } = useAuth();
  const isSuper = is("super_admin");

  const { data } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const [profiles, roles, wallets] = await Promise.all([
        supabase
          .from("profiles")
          .select("id,full_name,email,phone,status")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase.from("user_roles").select("user_id,role"),
        supabase.from("wallets").select("user_id,balance"),
      ]);
      const rmap = new Map<string, string[]>();
      (roles.data ?? []).forEach((r) => {
        const a = rmap.get(r.user_id) ?? [];
        a.push(r.role);
        rmap.set(r.user_id, a);
      });
      const wmap = new Map<string, number>();
      (wallets.data ?? []).forEach((w) => wmap.set(w.user_id, Number(w.balance)));
      return (profiles.data ?? []).map((p) => ({
        ...p,
        roles: rmap.get(p.id) ?? [],
        balance: wmap.get(p.id) ?? 0,
      })) as Row[];
    },
  });

  const filtered = (data ?? []).filter((r) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      r.full_name?.toLowerCase().includes(s) ||
      r.email?.toLowerCase().includes(s) ||
      r.phone?.toLowerCase().includes(s)
    );
  });

  const setStatus = async (id: string, status: Row["status"]) => {
    let reason: string | undefined;
    if (status !== "active") {
      reason = window.prompt(`Why are you setting this account to "${status}"? (recorded in the audit log)`) ?? undefined;
      if (!reason?.trim()) return toast.error("A reason is required to suspend or ban an account");
    }
    const { error } = await supabase.rpc("admin_set_user_status", { _user_id: id, _status: status, _reason: reason });
    if (error) return toast.error(error.message);
    toast.success(`Status set to ${status}`);
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    setActive((a) => (a && a.id === id ? { ...a, status } : a));
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, email, or phone…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      {!filtered.length ? (
        <EmptyState icon={Search} title="No users found" hint="Try a different search." />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <button
              key={r.id}
              onClick={() => setActive(r)}
              className="w-full text-left rounded-xl border bg-card p-3 hover:bg-muted/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{r.full_name || "Unnamed"}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{r.email ?? "—"}</div>
                  {r.phone && (
                    <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                      <Phone className="w-3 h-3 shrink-0" /> {r.phone}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {r.roles.map((role) => (
                      <StatusBadge
                        key={role}
                        label={role}
                        className={
                          role === "super_admin" || role === "admin"
                            ? "bg-primary/15 text-primary border-primary/30"
                            : role === "driver"
                              ? "bg-warning/15 text-warning border-warning/30"
                              : "bg-muted text-muted-foreground border-border"
                        }
                      />
                    ))}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-display font-bold text-sm">{money(r.balance)}</div>
                  <StatusBadge
                    label={r.status}
                    className={
                      r.status === "active"
                        ? "bg-success/15 text-success border-success/30"
                        : r.status === "suspended"
                          ? "bg-warning/15 text-warning border-warning/30"
                          : "bg-destructive/15 text-destructive border-destructive/30"
                    }
                  />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {active && (
        <UserSheet
          row={active}
          isSuper={isSuper}
          onClose={() => setActive(null)}
          onStatus={(s) => setStatus(active.id, s)}
          onChanged={() => qc.invalidateQueries({ queryKey: ["admin-users"] })}
        />
      )}
    </div>
  );
}

function UserSheet({
  row,
  isSuper,
  onClose,
  onStatus,
  onChanged,
}: {
  row: Row;
  isSuper: boolean;
  onClose: () => void;
  onStatus: (s: Row["status"]) => void;
  onChanged: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<AdjustCategory | "">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<{ sign: 1 | -1; amount: number } | null>(null);
  const qc = useQueryClient();

  const ledgerQuery = useQuery({
    queryKey: ["wallet-ledger", row.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wallet_transactions")
        .select("id,amount,balance_after,previous_balance,category,note,created_at,created_by,reversal_of_transaction_id")
        .eq("user_id", row.id)
        .eq("type", "adjustment")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as LedgerRow[];
    },
  });

  const ledger = ledgerQuery.data ?? [];
  const reversedIds = new Set(ledger.filter((t) => t.reversal_of_transaction_id).map((t) => t.reversal_of_transaction_id));

  const startConfirm = (sign: 1 | -1) => {
    const v = Number(amount);
    if (!v || isNaN(v) || v <= 0) return toast.error("Enter an amount");
    if (!category) return toast.error("Select a category");
    if (!reason.trim()) return toast.error("A written reason is required");
    if (sign > 0 && !isSuper) {
      return toast.error("Only a super admin can credit a wallet");
    }
    setConfirming({ sign, amount: v });
  };

  const submitAdjustment = async () => {
    if (!confirming) return;
    setBusy(true);
    const ip = await getClientIp();
    const { error } = await supabase.rpc("admin_wallet_adjust", {
      _user_id: row.id,
      _amount: confirming.sign * Math.abs(confirming.amount),
      _category: category as AdjustCategory,
      _reason: reason.trim(),
      _ip: ip ?? undefined,
      _device: { userAgent: navigator.userAgent } as never,
    });
    setBusy(false);
    setConfirming(null);
    if (error) {
      if (isSecondApprovalError(error) && confirming.sign > 0) {
        if (!window.confirm(`${readableRpcError(error)}

Send this credit to another super admin for approval?`)) return;
        const { error: reqError } = await (supabase as any).rpc("admin_request_wallet_credit", {
          _user_id: row.id,
          _amount: Math.abs(confirming.amount),
          _category: category,
          _reason: reason.trim(),
        });
        if (reqError) return moneyActionError(reqError);
        toast.success("Credit request sent — another super admin must approve it under Admin → Approvals");
        setAmount("");
        setReason("");
        return;
      }
      return moneyActionError(error);
    }
    toast.success("Wallet updated — recorded in the audit log");
    setAmount("");
    setCategory("");
    setReason("");
    qc.invalidateQueries({ queryKey: ["wallet-ledger", row.id] });
    onChanged();
  };

  const reverse = async (tx: LedgerRow) => {
    const why = window.prompt(
      `Reverse ${money(Math.abs(tx.amount))} (${tx.category ?? "adjustment"})? This creates a new offsetting transaction — it will not delete or edit the original.\n\nReason for reversal:`
    );
    if (!why?.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_wallet_reverse", {
      _transaction_id: tx.id,
      _reason: why.trim(),
    });
    setBusy(false);
    if (error) {
      return moneyActionError(error);
    }
    toast.success("Transaction reversed");
    qc.invalidateQueries({ queryKey: ["wallet-ledger", row.id] });
    onChanged();
  };

  const toggleRole = async (role: "driver" | "customer" | "admin") => {
    const has = row.roles.includes(role);
    const rpc = has ? "admin_revoke_role" : "admin_grant_role";
    const { error } = await supabase.rpc(rpc, { _user_id: row.id, _role: role });
    if (error) return toast.error(error.message);
    toast.success(has ? `${role} removed` : `${role} granted`);
    onChanged();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end" onClick={onClose}>
      <div
        className="w-full max-w-screen-sm mx-auto bg-card rounded-t-2xl border-t shadow-lift p-5 max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display font-bold text-lg">{row.full_name}</h3>
            <p className="text-xs text-muted-foreground">{row.email ?? "No email on file"}</p>
            {row.phone ? (
              <a href={`tel:${row.phone}`} className="text-xs text-primary font-semibold flex items-center gap-1 mt-0.5">
                <Phone className="w-3 h-3" /> {row.phone}
              </a>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">No phone on file</p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 rounded-xl bg-muted/40 p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Wallet balance</div>
          <div className="font-display font-bold text-2xl">{money(row.balance)}</div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            Manual wallet adjustment
          </div>
          <p className="text-[11px] text-muted-foreground">
            Normal top-ups happen automatically via Paynow. Use this only for refunds, dispute resolutions,
            promotions, or corrections — every adjustment is permanently logged.
          </p>
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount (USD)"
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as AdjustCategory)}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
          >
            <option value="">Select a category…</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required — shown to the user and kept in the audit log)"
            rows={2}
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm resize-none"
          />
          <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            {isSuper
              ? "Credits need your authenticator code; large credits need a second super admin. Daily limits apply."
              : "Admins can only deduct (corrections), within a daily limit. Only a super admin can credit."}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={busy || !isSuper}
              onClick={() => startConfirm(1)}
              className="rounded-lg bg-success text-success-foreground font-semibold py-2 text-sm disabled:opacity-50"
            >
              <Wallet className="w-4 h-4 inline mr-1" /> Credit
            </button>
            <button
              disabled={busy}
              onClick={() => startConfirm(-1)}
              className="rounded-lg bg-destructive text-destructive-foreground font-semibold py-2 text-sm disabled:opacity-50"
            >
              Deduct
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            Recent manual adjustments
          </div>
          {ledgerQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : !ledger.length ? (
            <p className="text-xs text-muted-foreground">No manual adjustments on record.</p>
          ) : (
            <div className="space-y-1.5">
              {ledger.map((tx) => {
                const isReversal = !!tx.reversal_of_transaction_id;
                const alreadyReversed = reversedIds.has(tx.id);
                return (
                  <div key={tx.id} className="rounded-lg border bg-muted/30 p-2.5 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className={`font-semibold ${tx.amount > 0 ? "text-success" : "text-destructive"}`}>
                          {tx.amount > 0 ? "+" : ""}{money(tx.amount)}
                          {isReversal && <span className="ml-1.5 text-muted-foreground font-normal">(reversal)</span>}
                        </div>
                        <div className="text-muted-foreground truncate">
                          {tx.category ? CATEGORIES.find((c) => c.value === tx.category)?.label ?? tx.category : "—"}
                          {tx.note ? ` · ${tx.note}` : ""}
                        </div>
                        <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                          {new Date(tx.created_at).toLocaleString()}
                        </div>
                      </div>
                      {isSuper && !isReversal && !alreadyReversed && (
                        <button
                          disabled={busy}
                          onClick={() => reverse(tx)}
                          className="shrink-0 flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold hover:bg-muted disabled:opacity-50"
                          title="Reverse this transaction"
                        >
                          <Undo2 className="w-3 h-3" /> Reverse
                        </button>
                      )}
                      {alreadyReversed && (
                        <span className="shrink-0 text-[10px] text-muted-foreground italic">Reversed</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {confirming && (
          <div
            className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
            onClick={() => !busy && setConfirming(null)}
          >
            <div
              className="w-full max-w-sm rounded-2xl border bg-card p-5 shadow-lift"
              onClick={(e) => e.stopPropagation()}
            >
              <h4 className="font-display font-bold text-base">Confirm adjustment</h4>
              <p className="text-sm mt-2">
                You are about to {confirming.sign > 0 ? "credit" : "deduct"}{" "}
                <span className="font-semibold">{money(confirming.amount)}</span>
                {confirming.sign > 0 ? " to " : " from "}
                <span className="font-semibold">{row.full_name}</span>.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Category: {CATEGORIES.find((c) => c.value === category)?.label}
                <br />
                Reason: {reason.trim()}
              </p>
              <p className="text-[11px] text-muted-foreground mt-2 italic">
                This action will be permanently recorded in the audit log and cannot be edited or deleted.
              </p>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <button
                  disabled={busy}
                  onClick={() => setConfirming(null)}
                  className="rounded-lg border py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  disabled={busy}
                  onClick={submitAdjustment}
                  className="rounded-lg bg-primary text-primary-foreground py-2 text-sm font-semibold disabled:opacity-50"
                >
                  {busy ? "Processing…" : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mt-5 space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Account status</div>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => onStatus("active")}
              className="rounded-lg border py-2 text-xs font-semibold hover:bg-success/10"
            >
              <ShieldCheck className="w-4 h-4 inline mr-1 text-success" /> Active
            </button>
            <button
              onClick={() => onStatus("suspended")}
              className="rounded-lg border py-2 text-xs font-semibold hover:bg-warning/10"
            >
              <ShieldOff className="w-4 h-4 inline mr-1 text-warning" /> Suspend
            </button>
            <button
              onClick={() => onStatus("banned")}
              className="rounded-lg border py-2 text-xs font-semibold hover:bg-destructive/10"
            >
              <Ban className="w-4 h-4 inline mr-1 text-destructive" /> Ban
            </button>
          </div>
        </div>

        {isSuper && (
          <div className="mt-5 space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Roles (super admin)</div>
            <div className="grid grid-cols-3 gap-2">
              {(["customer", "driver", "admin"] as const).map((r) => {
                const has = row.roles.includes(r);
                return (
                  <button
                    key={r}
                    onClick={() => toggleRole(r)}
                    className={`rounded-lg border py-2 text-xs font-semibold capitalize ${
                      has ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
                    }`}
                  >
                    {has ? "✓ " : "+ "}
                    {r}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
