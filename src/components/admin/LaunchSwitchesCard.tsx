import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ToggleRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { parseLaunchSwitches, type LaunchSwitches } from "@/lib/launch-switches";
import { isMfaRequiredError, readableRpcError, STEP_UP_ACTION_LABEL, startStepUp } from "@/lib/mfa";

type Rpc = (
  f: string,
  a: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
const rpc = supabase.rpc as unknown as Rpc; // launch_switches / admin_set_launch_switch are newer than the generated types

const NUMBERS: { key: string; field: keyof LaunchSwitches; label: string; hint: string }[] = [
  {
    key: "max_job_budget",
    field: "maxJobBudget",
    label: "Biggest job allowed (USD)",
    hint: "Jobs above this are refused.",
  },
  {
    key: "max_wallet_balance",
    field: "maxWalletBalance",
    label: "Biggest driver wallet (USD)",
    hint: "Top-ups beyond this are refused.",
  },
  {
    key: "min_topup",
    field: "minTopup",
    label: "Smallest top-up (USD)",
    hint: "Top-ups below this are refused.",
  },
];

/** Super-admin control for the launch switches that used to need SQL (0129). Every change asks for a reason and is audited. */
export function LaunchSwitchesCard({ isSuper }: { isSuper: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const { data } = useQuery({
    queryKey: ["launch-switches-admin"],
    queryFn: async (): Promise<LaunchSwitches> => {
      const { data: raw } = await rpc("launch_switches", {});
      return parseLaunchSwitches(raw);
    },
  });

  const save = async (key: string, value: unknown, what: string) => {
    const reason =
      window.prompt(`Why are you changing "${what}"? (recorded in the audit log)`) ?? "";
    if (reason.trim().length < 5) return toast.error("Give a reason (at least 5 characters)");
    const { error } = await rpc("admin_set_launch_switch", {
      _key: key,
      _value: value,
      _reason: reason.trim(),
    });
    if (error) {
      return toast.error(
        readableRpcError(error),
        isMfaRequiredError(error)
          ? { action: { label: STEP_UP_ACTION_LABEL, onClick: () => void startStepUp() } }
          : undefined,
      );
    }
    toast.success(`${what} saved`);
    setDraft((d) => ({ ...d, [key]: "" }));
    qc.invalidateQueries({ queryKey: ["launch-switches-admin"] });
    qc.invalidateQueries({ queryKey: ["launch-switches"] });
  };

  const toggles: { key: string; on: boolean; label: string; hint: string }[] = [
    {
      key: "escrow_enabled",
      on: !!data?.escrowEnabled,
      label: "Con Z Pay (customer pays through Con Z)",
      hint: "Off: customers pay the driver directly.",
    },
    {
      key: "withdrawals_enabled",
      on: !!data?.withdrawalsEnabled,
      label: "Driver withdrawals",
      hint: "Off: drivers cannot request a withdrawal.",
    },
  ];

  return (
    <div className="rounded-2xl border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <ToggleRight className="w-5 h-5 text-cz-amber-text" />
        <h3 className="font-display font-bold text-lg">Launch switches and limits</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        These control which payment features are open and how large a job or wallet can be. Each
        change needs a reason and a recent sign-in, and is recorded in the audit log.
      </p>
      {toggles.map((t) => (
        <div key={t.key} className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t.label}</p>
            <p className="text-xs text-muted-foreground">{t.hint}</p>
          </div>
          <button
            type="button"
            disabled={!isSuper || !data}
            onClick={() => save(t.key, !t.on, t.label)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${t.on ? "bg-success/15 text-success border-success/30" : "bg-muted text-muted-foreground"}`}
            aria-pressed={t.on}
          >
            {t.on ? "On · switch off" : "Off · switch on"}
          </button>
        </div>
      ))}
      {NUMBERS.map((n) => (
        <div key={n.key} className="space-y-1">
          <label className="text-sm font-semibold" htmlFor={`ls-${n.key}`}>
            {n.label}
          </label>
          <div className="flex items-center gap-2">
            <input
              id={`ls-${n.key}`}
              inputMode="decimal"
              value={draft[n.key] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [n.key]: e.target.value }))}
              placeholder={data ? String(data[n.field]) : "…"}
              disabled={!isSuper}
              className="w-28 rounded-xl border bg-background px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={!isSuper || !(Number(draft[n.key]) > 0)}
              onClick={() => save(n.key, Number(draft[n.key]), n.label)}
              className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              Save
            </button>
            <span className="text-xs text-muted-foreground">{n.hint}</span>
          </div>
        </div>
      ))}
      {!isSuper && (
        <p className="text-xs text-muted-foreground text-center">
          Only super admins can change these.
        </p>
      )}
    </div>
  );
}
