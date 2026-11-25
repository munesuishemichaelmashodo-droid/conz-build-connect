import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { linkwaSandboxStatus, startLinkwaSandboxPayment } from "@/lib/payments/linkwa.functions";

// Linkwa SANDBOX only. Renders nothing unless the server's sandbox guard allows Linkwa (never on the production
// database), so ordinary deployments never show it. No real money: sandbox keys only.

export function useLinkwaSandboxAvailable(): boolean {
  const status = useServerFn(linkwaSandboxStatus);
  const q = useQuery({
    queryKey: ["linkwa-sandbox-available"],
    queryFn: () => status(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return q.data?.available === true;
}

/** "Pay with Linkwa (sandbox)" for the customer of an accepted, provider-paid job. */
export function LinkwaSandboxPay({ jobId }: { jobId: string }) {
  const available = useLinkwaSandboxAvailable();
  const start = useServerFn(startLinkwaSandboxPayment);
  const [busy, setBusy] = useState(false);
  if (!available) return null;
  const pay = async () => {
    setBusy(true);
    try {
      const r = await start({ data: { jobId } });
      if (r.ok) {
        window.location.assign(r.checkoutUrl);
        return;
      }
      toast.error(
        r.error === "already_paid"
          ? "This job is already paid."
          : r.error === "try_again"
            ? "A payment link is being created. Try again in a moment."
            : "Could not start the Linkwa sandbox payment.",
      );
    } catch {
      toast.error("Could not start the Linkwa sandbox payment.");
    }
    setBusy(false);
  };
  return (
    <div className="mx-5 mt-3 rounded-2xl border border-amber-500/50 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="font-semibold">Linkwa sandbox test payment</div>
      <p className="mt-1">
        Test mode: no real money moves. Use Linkwa's sandbox test numbers at checkout.
      </p>
      <button
        type="button"
        onClick={pay}
        disabled={busy}
        className="mt-2 rounded-xl bg-amber-900 px-4 py-2 font-semibold text-white disabled:opacity-60"
      >
        {busy ? "Opening Linkwa…" : "Pay with Linkwa (sandbox)"}
      </button>
    </div>
  );
}
