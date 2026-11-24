import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/domain";
import { payableStatusLabel, summarizePayables, type PayableRow } from "@/lib/driver-earnings";

// Earnings from jobs the customer paid through ConZ (0171). Separate from commission credit:
// these are owed to the driver, and commission credit is never used for them.
// Renders nothing until 0171 is live or while the driver has no such jobs.
export type Table = (name: string) => {
  select: (cols: string) => {
    eq: (
      col: string,
      v: string,
    ) => {
      order: (
        col: string,
        o: { ascending: boolean },
      ) => {
        limit: (
          n: number,
        ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
  };
};

// Exported for tests. Any error (table missing before 0171 is applied, RLS, network) means
// "show nothing", never an empty or zero card.
export async function loadDriverPayables(
  db: { from: Table },
  userId: string,
): Promise<PayableRow[] | null> {
  try {
    const { data: rows, error } = await db
      .from("driver_payables")
      .select("id,job_id,gross_amount,commission,amount,status,created_at")
      .eq("driver_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return null;
    return (rows ?? []) as PayableRow[];
  } catch {
    return null;
  }
}

export function DriverEarningsCard({ userId }: { userId: string }) {
  const { data } = useQuery({
    queryKey: ["driver-payables", userId],
    queryFn: () => loadDriverPayables(supabase as unknown as { from: Table }, userId),
    staleTime: 30_000,
  });

  if (!data || data.length === 0) return null;
  const s = summarizePayables(data);

  return (
    <section className="rounded-2xl border bg-card p-4 space-y-3" aria-labelledby="earnings-title">
      <div>
        <h2 id="earnings-title" className="font-display font-semibold text-base">
          Earnings from ConZ-paid jobs
        </h2>
        <p className="text-xs text-muted-foreground">
          Jobs the customer paid through ConZ. ConZ&apos;s 7% of the transport fare is already taken
          out; your commission credit is not used for these.
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-muted/50 p-2">
          <dt className="text-[11px] text-muted-foreground">Owed to you</dt>
          <dd className="font-bold">{money(s.owed)}</dd>
        </div>
        <div className="rounded-xl bg-muted/50 p-2">
          <dt className="text-[11px] text-muted-foreground">Paid out</dt>
          <dd className="font-bold">{money(s.paidOut)}</dd>
        </div>
        <div className="rounded-xl bg-muted/50 p-2">
          <dt className="text-[11px] text-muted-foreground">ConZ commission</dt>
          <dd className="font-bold">{money(s.commission)}</dd>
        </div>
      </dl>
      {s.held > 0 && (
        <p className="text-xs text-muted-foreground">
          {money(s.held)} is held while a problem on a job is reviewed.
        </p>
      )}
      <ul className="divide-y text-sm">
        {data.slice(0, 10).map((r) => (
          <li key={r.id} className="py-2 flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block">{payableStatusLabel(r.status)}</span>
              <span className="block text-xs text-muted-foreground">
                Fare {money(Number(r.gross_amount))} − ConZ {money(Number(r.commission))} ·{" "}
                {new Date(r.created_at).toLocaleDateString("en-ZW", {
                  day: "numeric",
                  month: "short",
                })}
              </span>
            </span>
            <span className="font-semibold tabular-nums">{money(Number(r.amount))}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
