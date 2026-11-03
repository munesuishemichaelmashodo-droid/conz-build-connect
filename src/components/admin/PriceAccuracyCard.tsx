import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { materialLabel, money, type MaterialCategory } from "@/lib/domain";
import { priceAccuracyAdvice, type PriceAccuracyRow } from "@/lib/price-accuracy";

// 0123's RPC is not in the generated types yet.
type Rpc = (
  f: string,
  a: Record<string, unknown>,
) => PromiseLike<{ data: PriceAccuracyRow[] | null; error: { message: string } | null }>;

/**
 * How the price check's estimates compare with real prices. Two views (0127):
 *  - completed deliveries (admin_price_accuracy_completed) — the advice comes only from these;
 *  - customer accepted (admin_price_accuracy, 0123) — includes jobs still under way.
 */
export function PriceAccuracyCard() {
  const [view, setView] = useState<"completed" | "accepted">("completed");
  const rpcName = view === "completed" ? "admin_price_accuracy_completed" : "admin_price_accuracy";
  const { data, error, isLoading } = useQuery({
    queryKey: ["admin-price-accuracy", view],
    queryFn: async () => {
      const r = await (supabase.rpc as unknown as Rpc)(rpcName, { _days: 180 });
      if (r.error) throw r.error;
      return r.data ?? [];
    },
    retry: false,
  });
  if (error && view === "accepted") return null; // older database, or not an admin

  return (
    <section
      className="rounded-2xl border bg-card p-5 space-y-3"
      aria-labelledby="price-accuracy-title"
    >
      <div className="flex items-center gap-2">
        <Target className="w-5 h-5 text-cz-amber-text" aria-hidden />
        <h3 id="price-accuracy-title" className="font-display font-bold text-lg">
          How close are our estimates?
        </h3>
      </div>
      <div role="group" aria-label="Which jobs to compare" className="flex gap-2">
        {(
          [
            ["completed", "Completed deliveries"],
            ["accepted", "Customer accepted"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={
              "min-h-11 rounded-full border px-3.5 text-sm font-semibold " +
              (view === v ? "bg-foreground text-background" : "bg-card")
            }
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {view === "completed"
          ? "Estimates customers saw when booking, against the final price of delivered jobs (last 180 days)."
          : "Estimates against the price customers agreed to, including jobs still under way (last 180 days). Shows acceptance, not delivered prices."}{" "}
        Nothing changes automatically.
      </p>
      {error && view === "completed" && (
        <p className="text-sm text-muted-foreground">
          Completed-delivery figures aren't available yet.
        </p>
      )}
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && (data ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">
          No accepted jobs with an estimate yet. This fills in as customers accept offers.
        </p>
      )}
      <ul className="divide-y text-sm">
        {(data ?? []).map((r) => {
          const advice = priceAccuracyAdvice(r);
          return (
            <li key={r.material} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">
                  {materialLabel(r.material as MaterialCategory)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {r.jobs} job{r.jobs === 1 ? "" : "s"}
                </span>
              </div>
              <div className="text-muted-foreground">
                Typical estimate {money(Number(r.median_estimate))} · accepted{" "}
                {money(Number(r.median_accepted))} · {r.within_15_pct} of {r.jobs} within 15%
              </div>
              {view === "completed" ? (
                <div className={advice.tone === "ok" ? "text-cz-green-text" : "text-cz-amber-text"}>
                  {advice.text}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
