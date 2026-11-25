import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  adminLinkwaDeveloperStatus,
  adminLinkwaSandboxCall,
  type LinkwaSandboxCallResponse,
} from "@/lib/payments/linkwa-developer.functions";
import type { LinkwaSandboxAction } from "@/lib/payments/linkwa-developer.server";

// Super admin, Linkwa SANDBOX only (staging Preview): run one documented Linkwa Developer API call and record Linkwa's
// real answer (personal data removed). Evidence for the payout tests; it writes nothing to ConZ's money records.
// Renders nothing where the Developer key is not allowed (production, or the key is not set).

const ACTIONS: { id: LinkwaSandboxAction; label: string }[] = [
  { id: "link_user", label: "1. Link user" },
  { id: "link_wallet", label: "2. Link SmileCash wallet" },
  { id: "payout", label: "7. Instruct payout" },
  { id: "balance", label: "5. Balance (one read)" },
  { id: "statement", label: "6. Statement (one read)" },
];

const input = "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm";

export function LinkwaSandboxConsole() {
  const status = useServerFn(adminLinkwaDeveloperStatus);
  const call = useServerFn(adminLinkwaSandboxCall);
  const q = useQuery({ queryKey: ["linkwa-developer-status"], queryFn: () => status() });
  const [action, setAction] = useState<LinkwaSandboxAction>("link_user");
  const [f, setF] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phoneNumber: "",
    externalUserId: "",
    externalWalletId: "",
    amount: "",
    reason: "",
  });
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LinkwaSandboxCallResponse[]>([]);

  if (!q.data) return null;
  if (!q.data.available) {
    if (
      q.data.reason === "forbidden" ||
      q.data.reason === "production_database" ||
      q.data.reason === "production_deployment"
    )
      return null;
    return (
      <section
        className="rounded-lg border border-border p-4 text-sm"
        data-testid="linkwa-sandbox-console-off"
      >
        <h2 className="font-semibold">Linkwa sandbox console</h2>
        <p className="text-muted-foreground">Not available here: {q.data.reason}</p>
      </section>
    );
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const run = async () => {
    setBusy(true);
    try {
      const r = await call({
        data: {
          action,
          reason: f.reason,
          firstName: f.firstName,
          lastName: f.lastName,
          email: f.email,
          phoneNumber: f.phoneNumber,
          externalUserId: f.externalUserId,
          externalWalletId: f.externalWalletId,
          amount: f.amount ? Number(f.amount) : undefined,
        },
      });
      setLog((l) => [r, ...l]);
      if (r.ok) {
        try {
          const b = JSON.parse(r.bodyJson) as {
            user?: { external_user_id?: string };
            wallet?: { external_wallet_id?: string };
          } | null;
          const uid = b?.user?.external_user_id;
          const wid = b?.wallet?.external_wallet_id;
          if (uid || wid)
            setF((p) => ({
              ...p,
              externalUserId: uid ?? p.externalUserId,
              externalWalletId: wid ?? p.externalWalletId,
            }));
        } catch {
          /* body not JSON: nothing to fill */
        }
      }
    } catch {
      setLog((l) => [{ ok: false, error: "request_failed" }, ...l]);
    } finally {
      setBusy(false);
    }
  };

  const show = (k: keyof typeof f) => {
    if (action === "link_user")
      return ["firstName", "lastName", "email", "phoneNumber"].includes(k);
    if (action === "link_wallet") return ["externalUserId", "phoneNumber"].includes(k);
    if (action === "payout") return ["externalUserId", "externalWalletId", "amount"].includes(k);
    return false;
  };

  return (
    <section
      className="space-y-3 rounded-lg border border-border p-4"
      data-testid="linkwa-sandbox-console"
    >
      <div>
        <h2 className="font-semibold">Linkwa sandbox console (Developer key)</h2>
        <p className="text-xs text-muted-foreground">
          Sandbox only. Each call goes to Linkwa&apos;s sandbox and is written to the audit log. A
          payout answer means &quot;instructed&quot;, not paid. Nothing here changes ConZ&apos;s own
          records.
        </p>
      </div>
      <select
        className={input}
        value={action}
        onChange={(e) => setAction(e.target.value as LinkwaSandboxAction)}
        aria-label="Linkwa call"
      >
        {ACTIONS.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
      <div className="grid gap-2 sm:grid-cols-2">
        {show("firstName") && (
          <label className="space-y-1 text-xs font-medium">
            <span>First name</span>
            <input
              className={input}
              placeholder="First name"
              value={f.firstName}
              onChange={set("firstName")}
            />
          </label>
        )}
        {show("lastName") && (
          <label className="space-y-1 text-xs font-medium">
            <span>Last name</span>
            <input
              className={input}
              placeholder="Last name"
              value={f.lastName}
              onChange={set("lastName")}
            />
          </label>
        )}
        {show("email") && (
          <label className="space-y-1 text-xs font-medium">
            <span>Email</span>
            <input className={input} placeholder="Email" value={f.email} onChange={set("email")} />
          </label>
        )}
        {show("phoneNumber") && (
          <label className="space-y-1 text-xs font-medium">
            <span>Phone (international, e.g. 263711111111)</span>
            <input
              className={input}
              placeholder="2637XXXXXXXX"
              value={f.phoneNumber}
              onChange={set("phoneNumber")}
            />
          </label>
        )}
        {show("externalUserId") && (
          <label className="space-y-1 text-xs font-medium">
            <span>external_user_id (filled from step 1)</span>
            <input
              className={input}
              placeholder="01…"
              value={f.externalUserId}
              onChange={set("externalUserId")}
            />
          </label>
        )}
        {show("externalWalletId") && (
          <label className="space-y-1 text-xs font-medium">
            <span>external_wallet_id (filled from step 2)</span>
            <input
              className={input}
              placeholder="w_…"
              value={f.externalWalletId}
              onChange={set("externalWalletId")}
            />
          </label>
        )}
        {show("amount") && (
          <label className="space-y-1 text-xs font-medium">
            <span>Amount (USD)</span>
            <input
              className={input}
              placeholder="1.00"
              inputMode="decimal"
              value={f.amount}
              onChange={set("amount")}
            />
          </label>
        )}
      </div>
      <label className="block space-y-1 text-xs font-medium">
        <span>Reason (test id)</span>
        <input
          className={input}
          placeholder="Reason (test id, e.g. T4 payout 316.20)"
          value={f.reason}
          onChange={set("reason")}
        />
      </label>
      <button
        type="button"
        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        disabled={busy || f.reason.trim().length < 5}
        onClick={run}
      >
        {busy ? "Sending…" : "Send to Linkwa sandbox"}
      </button>
      <ol className="space-y-2">
        {log.map((r, i) => (
          <li key={i} className="rounded-md bg-muted p-2">
            <pre className="whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(r, null, 2)}
            </pre>
          </li>
        ))}
      </ol>
    </section>
  );
}
