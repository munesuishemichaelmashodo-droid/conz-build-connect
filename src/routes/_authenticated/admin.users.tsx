import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Search, ShieldOff, ShieldCheck, Ban, Wallet, X, Phone } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge, EmptyState } from "@/components/ui-bits";
import { money } from "@/lib/domain";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: AdminUsers,
});

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
        supabase.from("profiles").select("id,full_name,email,phone,status").order("created_at", { ascending: false }).limit(500),
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
    const { error } = await supabase.rpc("admin_set_user_status", { _user_id: id, _status: status, _reason: reason ?? null });
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
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const credit = async (sign: 1 | -1) => {
    const v = Number(amount);
    if (!v || isNaN(v)) return toast.error("Enter an amount");
    setBusy(true);
    const { error } = await supabase.rpc("admin_credit_wallet", {
      _user_id: row.id,
      _amount: sign * Math.abs(v),
      _note: note || (sign > 0 ? "Top-up" : "Deduction"),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Wallet updated");
    setAmount("");
    setNote("");
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
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Wallet top-up / deduct</div>
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount (USD)"
              className="flex-1 px-3 py-2 rounded-lg border bg-background text-sm"
            />
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (e.g. EcoCash ref ABC123)"
            className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={busy}
              onClick={() => credit(1)}
              className="rounded-lg bg-success text-success-foreground font-semibold py-2 text-sm disabled:opacity-50"
            >
              <Wallet className="w-4 h-4 inline mr-1" /> Credit
            </button>
            <button
              disabled={busy}
              onClick={() => credit(-1)}
              className="rounded-lg bg-destructive text-destructive-foreground font-semibold py-2 text-sm disabled:opacity-50"
            >
              Deduct
            </button>
          </div>
        </div>

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
