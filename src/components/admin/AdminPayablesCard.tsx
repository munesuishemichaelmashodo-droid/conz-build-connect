import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/domain";
import { summarizePayables, type PayableRow } from "@/lib/driver-earnings";

// Provider-paid jobs (0171): what ConZ owes drivers, what was paid out, ConZ's commission from
// collected fares, and refunds owed to customers. Separate from commission-credit revenue above.
// Renders nothing until 0171 is live; shows zeros while no provider-paid job exists.
type Query = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
export type From = (name: string) => {
  select: (
    cols: string,
  ) => Query & { eq: (c: string, v: string) => Query & { eq: (c: string, v: string) => Query } };
};

export type AdminPayablesData = {
  summary: ReturnType<typeof summarizePayables>;
  refundOwed: number;
};

// Exported for tests. If either table cannot be read (0171 not applied yet, RLS, network) the card
// shows nothing rather than zeros that look like real totals.
export async function loadAdminPayables(db: { from: From }): Promise<AdminPayablesData | null> {
  try {
    const [{ data: rows, error }, { data: refunds, error: refundError }] = await Promise.all([
      db
        .from("driver_payables")
        .select("id,job_id,driver_id,gross_amount,commission,amount,status,created_at"),
      db.from("payments").select("amount").eq("type", "job_payment").eq("status", "refund_due"),
    ]);
    if (error || refundError) return null;
    const refundOwed = ((refunds ?? []) as { amount: number | string }[]).reduce(
      (t, r) => t + Math.round(Number(r.amount) * 100),
      0,
    );
    return {
      summary: summarizePayables((rows ?? []) as PayableRow[]),
      refundOwed: refundOwed / 100,
    };
  } catch {
    return null;
  }
}

export function AdminPayablesCard() {
  const { data } = useQuery({
    queryKey: ["admin-payables"],
    queryFn: () => loadAdminPayables(supabase as unknown as { from: From }),
    staleTime: 30_000,
  });
  if (!data) return null;
  const { summary: s, refundOwed } = data;

  return (
    <section className="rounded-2xl border bg-card p-4 space-y-3" aria-labelledby="payables-title">
      <div>
        <h2 id="payables-title" className="font-display font-semibold text-base">
          Jobs paid through ConZ
        </h2>
        <p className="text-xs text-muted-foreground">
          Driver earnings owed and paid out, and ConZ&apos;s 7% of the total agreed price. Kept
          apart from commission credit.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-muted/50 p-2">
          <dt className="text-[11px] text-muted-foreground">Owed to drivers</dt>
          <dd className="font-bold">{money(s.owed)}</dd>
        </div>
        <div className="rounded-xl bg-muted/50 p-2">
          <dt className="text-[11px] text-muted-foreground">Held (disputes)</dt>
          <dd className="font-bold">{money(s.held)}</dd>
        </div>
        <div className="rounded-xl bg-muted/50 p-2">
          <dt className="text-[11px] text-muted-foreground">Paid out to drivers</dt>
          <dd className="font-bold">{money(s.paidOut)}</dd>
        </div>
        <div className="rounded-xl bg-muted/50 p-2">
          <dt className="text-[11px] text-muted-foreground">ConZ commission ({s.count} jobs)</dt>
          <dd className="font-bold">{money(s.commission)}</dd>
        </div>
        <div className="rounded-xl bg-muted/50 p-2 col-span-2">
          <dt className="text-[11px] text-muted-foreground">Refunds owed to customers</dt>
          <dd className="font-bold">{money(refundOwed)}</dd>
        </div>
      </dl>
    </section>
  );
}
