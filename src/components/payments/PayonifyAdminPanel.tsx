import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/domain";
import { supabase } from "@/integrations/supabase/client";
import { isMfaRequiredError, readableRpcError, STEP_UP_ACTION_LABEL, startStepUp } from "@/lib/mfa";
import { adminCheckPayonifyPayment, adminPayonifyOverview } from "@/lib/payonify.functions";

const REASON_LABEL: Record<string, string> = {
  disabled: "PAYONIFY_MODE is not set on this deployment",
  not_configured: "Payonify keys are not set on this deployment",
  bad_keys: "the Payonify keys don't match PAYONIFY_MODE",
  production_database: "test keys can't be used with the live database",
};

// Admin view of Payonify payments: the payment switch, status, charge id, checks, and every
// webhook event. "Check with Payonify" re-reads the charge from Payonify; nothing here can
// mark a payment paid. The switch is a super-admin action with a step-up, and is audit-logged.
export function PayonifyAdminPanel({ canSwitch = false }: { canSwitch?: boolean }) {
  const qc = useQueryClient();
  const load = useServerFn(adminPayonifyOverview);
  const check = useServerFn(adminCheckPayonifyPayment);
  const [busy, setBusy] = useState<string | null>(null);
  const { data, error } = useQuery({
    queryKey: ["admin-payonify"],
    queryFn: () => load(),
    retry: false,
  });

  const [switching, setSwitching] = useState(false);

  if (error || !data || !data.installed) return null;
  if (data.payments.length === 0 && data.events.length === 0 && !data.enabledHere && !canSwitch)
    return null;

  const onPayonify = data.switchProvider === "payonify";
  // Moving everyone to Payonify needs live keys on this deployment; moving back is always allowed.
  const switchBlocked = !onPayonify && data.serverMode !== "live";
  const flip = async () => {
    const to = onPayonify ? "paynow" : "payonify";
    const reason = window.prompt(
      to === "payonify"
        ? "Move ALL new payments (Con Z Pay and top-ups) to EcoCash through Payonify. Paynow will stop taking new payments. Reason:"
        : "Move all new payments back to Paynow. Reason:",
    );
    if (!reason) return;
    setSwitching(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 0120 RPC is not in the generated types yet
    const { error: err } = await (supabase as any).rpc("admin_set_payment_provider", {
      _provider: to,
      _reason: reason,
    });
    setSwitching(false);
    if (err) {
      if (isMfaRequiredError(err)) {
        toast.error(readableRpcError(err), {
          action: { label: STEP_UP_ACTION_LABEL, onClick: () => void startStepUp() },
        });
      } else toast.error(readableRpcError(err));
      return;
    }
    toast.success(
      to === "payonify"
        ? "New payments now go through Payonify"
        : "New payments now go through Paynow",
    );
    qc.invalidateQueries({ queryKey: ["admin-payonify"] });
    qc.invalidateQueries({ queryKey: ["payment-options"] });
  };

  const runCheck = async (id: string) => {
    setBusy(id);
    try {
      const r = await check({ data: { paymentId: id } });
      if (r.ok) toast.success(`Checked with Payonify: ${r.outcome.replace(/_/g, " ")}`);
      else toast.error(`Not checked: ${r.outcome.replace(/_/g, " ")}`);
      qc.invalidateQueries({ queryKey: ["admin-payonify"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border p-4" aria-labelledby="payonify-admin-title">
      <div>
        <h2 id="payonify-admin-title" className="font-semibold">
          Payments provider
        </h2>
        <p className="text-sm">
          New payments go through <strong>{onPayonify ? "EcoCash (Payonify)" : "Paynow"}</strong>.
        </p>
        <p className="text-sm text-muted-foreground">
          {data.serverMode === "live"
            ? "Payonify live keys are set on this deployment."
            : data.serverMode === "test"
              ? "Payonify is in test mode here: listed testers only, no real money."
              : `Payonify is off here: ${REASON_LABEL[data.serverReason ?? ""] ?? data.serverReason}.`}{" "}
          Refunds for Payonify payments are made in the Payonify dashboard.
        </p>
        {(data.serverMissing ?? []).length > 0 && (
          <p className="text-sm text-muted-foreground">
            Empty on this deployment: {(data.serverMissing ?? []).join(", ")}.
          </p>
        )}
        {canSwitch && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={onPayonify ? "outline" : "default"}
              disabled={switching || switchBlocked}
              onClick={flip}
            >
              {switching
                ? "Switching…"
                : onPayonify
                  ? "Move back to Paynow"
                  : "Move payments to Payonify"}
            </Button>
            {switchBlocked && (
              <span className="text-xs text-muted-foreground">
                Needs Payonify live keys on this deployment first.
              </span>
            )}
          </div>
        )}
      </div>
      {data.payments.length > 0 && (
        <ul className="divide-y text-sm">
          {data.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="font-medium">
                  {money(Number(p.amount))} · {p.status}
                  {p.provider_livemode === false ? " · test" : p.provider_livemode ? " · LIVE" : ""}
                </div>
                <div className="text-xs text-muted-foreground break-all">
                  {p.provider_reference ?? "no charge id yet"} ·{" "}
                  {new Date(p.created_at).toLocaleString()} · checked {p.check_count}×
                </div>
              </div>
              {p.status === "initiated" && data.enabledHere && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === p.id}
                  onClick={() => runCheck(p.id)}
                >
                  {busy === p.id ? "Checking…" : "Check with Payonify"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {data.history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            Status history ({data.history.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {data.history.map((h, i) => (
              <li key={i}>
                {new Date(h.created_at).toLocaleString()} · {h.source} · {h.reported_status ?? "—"}{" "}
                → {h.outcome}
              </li>
            ))}
          </ul>
        </details>
      )}
      {data.events.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            Other webhook events ({data.events.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {data.events.map((e) => (
              <li key={e.event_id}>
                {new Date(e.received_at).toLocaleString()} · {e.event_type} · {e.object_id ?? "—"} →{" "}
                {e.outcome}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
