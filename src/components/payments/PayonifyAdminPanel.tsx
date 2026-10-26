import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/domain";
import { adminCheckPayonifyPayment, adminPayonifyOverview } from "@/lib/payonify.functions";

// Admin view of Payonify (test) payments: status, charge id, checks, and every webhook event.
// "Check with Payonify" re-reads the charge from Payonify; nothing here can mark a payment paid.
export function PayonifyAdminPanel() {
  const qc = useQueryClient();
  const load = useServerFn(adminPayonifyOverview);
  const check = useServerFn(adminCheckPayonifyPayment);
  const [busy, setBusy] = useState<string | null>(null);
  const { data, error } = useQuery({
    queryKey: ["admin-payonify"],
    queryFn: () => load(),
    retry: false,
  });

  if (error || !data || !data.installed) return null;
  if (data.payments.length === 0 && data.events.length === 0 && !data.enabledHere) return null;

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
          Payonify payments (test mode)
        </h2>
        <p className="text-sm text-muted-foreground">
          {data.enabledHere
            ? "Enabled on this deployment for listed testers. No real money moves."
            : "Not enabled on this deployment. Shown for history only."}{" "}
          Refunds for these payments are made in the Payonify dashboard.
        </p>
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
