import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { isMfaRequiredError, readableRpcError, STEP_UP_ACTION_LABEL, startStepUp } from "@/lib/mfa";
import { formatPoints, pointsReason, type PointsEntry } from "@/lib/points";

export const Route = createFileRoute("/_authenticated/admin/points")({
  component: AdminPoints,
});

type Rpc = (
  f: string,
  a: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
// The points tables and functions are newer than the generated types.
const rpc = supabase.rpc as unknown as Rpc;
const table = (supabase as unknown as { from: (t: string) => any }).from.bind(supabase); // eslint-disable-line @typescript-eslint/no-explicit-any

interface Rule {
  id: string;
  event: "delivery" | "referral";
  audience: "customer" | "driver";
  material: string | null;
  points_flat: number;
  points_per_m3: number;
  points_per_usd: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
}
interface LedgerRow extends PointsEntry {
  user_id: string;
  reverses_id: string | null;
  who?: string;
}

const ruleName = (r: Rule) =>
  `${r.event === "delivery" ? "Verified delivery" : "Successful referral"} · ${r.audience === "customer" ? "customers" : "drivers"} · ${r.material ? r.material.replace(/_/g, " ") : "all products"}`;
const isConfigured = (r: Rule) =>
  r.active && r.points_flat + r.points_per_m3 + r.points_per_usd > 0;

function AdminPoints() {
  const { is } = useAuth();
  const isSuper = is("super_admin");
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-points"] });

  const { data } = useQuery({
    queryKey: ["admin-points"],
    queryFn: async () => {
      const [{ data: o, error: overviewError }, { data: rules }, { data: ledger }, { data: mats }] =
        await Promise.all([
          rpc("points_overview", {}),
          table("points_rules").select("*").order("created_at"),
          table("points_ledger")
            .select("id,user_id,points,kind,event,reason,basis,reverses_id,created_at")
            .order("created_at", { ascending: false })
            .limit(60),
          supabase.from("material_prices").select("material"),
        ]);
      const rows = (ledger ?? []) as LedgerRow[];
      const ids = Array.from(new Set(rows.map((r) => r.user_id)));
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id,full_name,email").in("id", ids)
        : { data: [] };
      const names = new Map((profs ?? []).map((p) => [p.id, p.full_name || p.email || "User"]));
      rows.forEach((r) => (r.who = names.get(r.user_id) ?? "User"));
      return {
        ready: !overviewError,
        enabled: !!(o as { enabled?: boolean } | null)?.enabled,
        rules: (rules ?? []) as Rule[],
        ledger: rows,
        materials: (mats ?? []).map((m) => m.material as string),
      };
    },
  });

  const call = async (fn: string, args: Record<string, unknown>, ok: string) => {
    const { error } = await rpc(fn, args);
    if (error) {
      return toast.error(
        readableRpcError(error),
        isMfaRequiredError(error)
          ? { action: { label: STEP_UP_ACTION_LABEL, onClick: () => void startStepUp() } }
          : undefined,
      );
    }
    toast.success(ok);
    refresh();
  };
  const askReason = (what: string) => {
    const r = window.prompt(`Why? ${what} (recorded in the audit log)`) ?? "";
    if (r.trim().length < 5) {
      toast.error("Give a reason (at least 5 characters)");
      return null;
    }
    return r.trim();
  };

  const rules = data?.rules ?? [];
  const missing = rules.filter((r) => !isConfigured(r));
  const reversed = new Set((data?.ledger ?? []).map((r) => r.reverses_id).filter(Boolean));
  const totals = (data?.ledger ?? []).reduce((t, r) => ({ ...t, [r.kind]: t[r.kind] + r.points }), {
    award: 0,
    adjustment: 0,
    reversal: 0,
  } as Record<string, number>);

  const [adj, setAdj] = useState({ email: "", points: "", reason: "" });
  const adjust = async () => {
    const { data: p } = await supabase
      .from("profiles")
      .select("id")
      .ilike("email", adj.email.trim())
      .maybeSingle();
    if (!p) return toast.error("No user with that email");
    await call(
      "admin_adjust_points",
      { _user: p.id, _points: Number(adj.points), _reason: adj.reason },
      "Points adjusted",
    );
    setAdj({ email: "", points: "", reason: "" });
  };

  const [draft, setDraft] = useState<Record<string, string>>({});
  const saveRule = async (r: Rule, patch: Partial<Rule>) => {
    const reason = askReason(ruleName(r));
    if (!reason) return;
    const n = { ...r, ...patch };
    await call(
      "admin_save_points_rule",
      {
        _id: n.id,
        _event: n.event,
        _audience: n.audience,
        _material: n.material,
        _points_flat: n.points_flat,
        _points_per_m3: n.points_per_m3,
        _points_per_usd: n.points_per_usd,
        _active: n.active,
        _starts_at: n.starts_at,
        _ends_at: n.ends_at,
        _reason: reason,
      },
      "Rule saved",
    );
  };
  const [newMat, setNewMat] = useState("");
  const addProductRule = async () => {
    const reason = askReason("new product rule");
    if (!reason || !newMat) return;
    await call(
      "admin_save_points_rule",
      {
        _id: null,
        _event: "delivery",
        _audience: "customer",
        _material: newMat,
        _points_flat: 0,
        _points_per_m3: 0,
        _points_per_usd: 0,
        _active: false,
        _starts_at: null,
        _ends_at: null,
        _reason: reason,
      },
      "Product rule added (inactive, 0 points)",
    );
    setNewMat("");
  };

  if (data && !data.ready) {
    return (
      <div className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
        ConZ points are not set up on this database yet (migration 0131 has not been applied).
        Nothing is awarded and nothing is shown to customers or drivers.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-cz-amber-text" />
            <h3 className="font-display text-lg font-bold">
              ConZ points are {data?.enabled ? "ON" : "OFF"}
            </h3>
          </div>
          <button
            type="button"
            disabled={!isSuper || !data}
            onClick={() => {
              const reason = askReason(data?.enabled ? "switch points off" : "switch points on");
              if (reason)
                void call(
                  "admin_set_points_enabled",
                  { _on: !data?.enabled, _reason: reason },
                  "Saved",
                );
            }}
            className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {data?.enabled ? "Switch off" : "Switch on"}
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Points are rewards, not cash. They never change a job price or the 7% commission. Nothing
          is awarded until points are on and a rule has values. Awards run every 15 minutes from
          verified deliveries and released referrals.
        </p>
        {missing.length > 0 && (
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
            <p className="font-semibold">
              Not configured yet (no points will be awarded for these):
            </p>
            <ul className="list-disc pl-5">
              {missing.map((r) => (
                <li key={r.id}>{ruleName(r)}</li>
              ))}
            </ul>
          </div>
        )}
        {!isSuper && (
          <p className="text-xs text-muted-foreground">
            Only super admins can switch points on or change rules.
          </p>
        )}
      </div>

      <div className="rounded-2xl border bg-card p-5 space-y-3">
        <h3 className="font-display text-lg font-bold">Rules</h3>
        <p className="text-xs text-muted-foreground">
          Points = flat + (per m³ × delivered m³) + (per USD × job price at the time). A product
          rule replaces the general one for that product.
        </p>
        {rules.map((r) => (
          <div key={r.id} className="space-y-2 rounded-xl border p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold">{ruleName(r)}</p>
              <button
                type="button"
                disabled={!isSuper}
                onClick={() => saveRule(r, { active: !r.active })}
                className={`rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-50 ${r.active ? "bg-success/15 text-success border-success/30" : "bg-muted text-muted-foreground"}`}
              >
                {r.active ? "Active" : "Inactive"}
              </button>
            </div>
            <div className="flex flex-wrap items-end gap-2 text-xs">
              {(
                [
                  ["points_flat", "Flat"],
                  ...(r.event === "delivery"
                    ? [
                        ["points_per_m3", "Per m³"],
                        ["points_per_usd", "Per USD"],
                      ]
                    : []),
                ] as [keyof Rule, string][]
              ).map(([k, label]) => (
                <label key={k} className="space-y-1">
                  <span className="block text-muted-foreground">{label}</span>
                  <input
                    inputMode="decimal"
                    disabled={!isSuper}
                    value={draft[`${r.id}.${k}`] ?? String(r[k])}
                    onChange={(e) => setDraft((d) => ({ ...d, [`${r.id}.${k}`]: e.target.value }))}
                    className="w-20 rounded-lg border bg-background px-2 py-1.5"
                  />
                </label>
              ))}
              <button
                type="button"
                disabled={!isSuper}
                onClick={() => {
                  const g = (k: keyof Rule) => Number(draft[`${r.id}.${k}`] ?? r[k]);
                  void saveRule(r, {
                    points_flat: Math.trunc(g("points_flat")),
                    points_per_m3: g("points_per_m3"),
                    points_per_usd: g("points_per_usd"),
                  });
                }}
                className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-50"
              >
                Save values
              </button>
            </div>
          </div>
        ))}
        {isSuper && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={newMat}
              onChange={(e) => setNewMat(e.target.value)}
              className="rounded-lg border bg-background px-2 py-1.5 text-sm"
              aria-label="Product"
            >
              <option value="">Add a product rule…</option>
              {(data?.materials ?? []).map((m) => (
                <option key={m} value={m}>
                  {m.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addProductRule}
              disabled={!newMat}
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              Add (customers, delivery)
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border bg-card p-5 space-y-3">
        <h3 className="font-display text-lg font-bold">Adjust points</h3>
        <div className="flex flex-wrap gap-2">
          <input
            value={adj.email}
            onChange={(e) => setAdj({ ...adj, email: e.target.value })}
            placeholder="User email"
            className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
          />
          <input
            value={adj.points}
            onChange={(e) => setAdj({ ...adj, points: e.target.value })}
            placeholder="+/- points"
            inputMode="numeric"
            className="w-28 rounded-lg border bg-background px-3 py-2 text-sm"
          />
          <input
            value={adj.reason}
            onChange={(e) => setAdj({ ...adj, reason: e.target.value })}
            placeholder="Reason (required)"
            className="min-w-0 flex-[2] rounded-lg border bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={adjust}
            disabled={!adj.email || !Number(adj.points) || adj.reason.trim().length < 5}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            Adjust
          </button>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-5 space-y-3">
        <h3 className="font-display text-lg font-bold">Recent points</h3>
        <p className="text-xs text-muted-foreground">
          Latest 60 entries: awarded {formatPoints(totals.award)}, adjusted{" "}
          {formatPoints(totals.adjustment)}, reversed {formatPoints(totals.reversal)}.
        </p>
        {(data?.ledger ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No points have been awarded yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {data?.ledger.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="font-semibold">{r.who}</span> · {pointsReason(r)}
                  <span className="block text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("en-GB")}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span
                    className={`font-semibold ${r.points < 0 ? "text-destructive" : "text-success"}`}
                  >
                    {formatPoints(r.points)}
                  </span>
                  {r.kind !== "reversal" && !reversed.has(r.id) && (
                    <button
                      type="button"
                      className="rounded-lg border px-2 py-1 text-xs"
                      onClick={() => {
                        const reason = askReason("reverse these points");
                        if (reason)
                          void call(
                            "admin_reverse_points",
                            { _ledger_id: r.id, _reason: reason },
                            "Reversed",
                          );
                      }}
                    >
                      Reverse
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
