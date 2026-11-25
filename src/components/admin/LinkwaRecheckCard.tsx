import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useLinkwaSandboxAvailable } from "@/components/payments/LinkwaSandboxPay";
import {
  adminListOpenLinkwaPayments,
  adminRecheckLinkwaPayment,
  type AdminOpenLinkwaPayment,
} from "@/lib/payments/linkwa.functions";
import { recheckMessage, type RecheckTone } from "@/lib/payments/linkwa-recheck-copy";
import { money } from "@/lib/domain";

// Super admin, Linkwa SANDBOX only: recover a payment the customer made but ConZ never heard about (no return to
// ConZ, no webhook). Paste the payment reference from Linkwa's dashboard; ConZ asks Linkwa and records the answer
// once. Renders nothing where the Linkwa sandbox is not allowed (production).

const toneClass: Record<RecheckTone, string> = {
  good: "text-cz-green-text",
  info: "text-muted-foreground",
  warn: "text-destructive",
};

function Row({ p, onDone }: { p: AdminOpenLinkwaPayment; onDone: () => void }) {
  const recheck = useServerFn(adminRecheckLinkwaPayment);
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: RecheckTone; text: string } | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await recheck({
        data: { paymentId: p.paymentId, paymentReference: reference, reason },
      });
      setMsg(recheckMessage(r as { ok: boolean; outcome?: string; error?: string }));
      if (r.ok) onDone();
    } catch {
      setMsg(recheckMessage({ ok: false, error: "invalid_input" }));
    }
    setBusy(false);
  };

  return (
    <li className="rounded-xl border p-3 space-y-2">
      <div className="flex justify-between text-sm">
        <span className="font-semibold">
          CONZ-{(p.jobId ?? p.paymentId).slice(0, 8).toUpperCase()}
        </span>
        <span className="tabular-nums">
          {money(p.amount)} {p.currency}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        Link {p.shortUrl} · started {new Date(p.createdAt).toLocaleString()}
      </div>
      <label className="block text-xs font-semibold">
        Payment reference from Linkwa
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          className="mt-1 w-full rounded-lg border bg-background px-2 py-1.5 text-sm font-normal"
          placeholder="e.g. eb7de90e-347f-…"
          autoComplete="off"
        />
      </label>
      <label className="block text-xs font-semibold">
        Reason (kept in the audit log)
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 w-full rounded-lg border bg-background px-2 py-1.5 text-sm font-normal"
          placeholder="Customer says they paid but did not return"
        />
      </label>
      <button
        type="button"
        onClick={run}
        disabled={busy || reference.trim().length < 6 || reason.trim().length < 5}
        className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Asking Linkwa…" : "Re-check with Linkwa"}
      </button>
      {msg && (
        <p role="status" className={`text-xs ${toneClass[msg.tone]}`}>
          {msg.text}
        </p>
      )}
    </li>
  );
}

export function LinkwaRecheckCard() {
  const available = useLinkwaSandboxAvailable();
  const list = useServerFn(adminListOpenLinkwaPayments);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-open-linkwa-payments"],
    queryFn: () => list(),
    enabled: available,
    staleTime: 30_000,
  });
  if (!available || !data || !data.ok) return null;

  return (
    <section
      className="rounded-2xl border bg-card p-4 space-y-3"
      aria-labelledby="linkwa-recheck-title"
    >
      <div>
        <h2 id="linkwa-recheck-title" className="font-display font-semibold text-base">
          Re-check a Linkwa payment (sandbox)
        </h2>
        <p className="text-xs text-muted-foreground">
          For a customer who paid but did not come back to ConZ. Copy the payment reference from
          Linkwa's dashboard. ConZ asks Linkwa directly and records the payment only if Linkwa
          confirms it for this payment's link.
        </p>
      </div>
      {data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Linkwa payments are waiting.</p>
      ) : (
        <ul className="space-y-2">
          {data.rows.map((p) => (
            <Row
              key={p.paymentId}
              p={p}
              onDone={() => qc.invalidateQueries({ queryKey: ["admin-open-linkwa-payments"] })}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
