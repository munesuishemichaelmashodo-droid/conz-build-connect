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

/** How the price check's estimates compare with what customers actually accepted (0123). */
export function PriceAccuracyCard() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["admin-price-accuracy"],
    queryFn: async () => {
      const r = await (supabase.rpc as unknown as Rpc)("admin_price_accuracy", { _days: 180 });
      if (r.error) throw r.error;
      return r.data ?? [];
    },
    retry: false,
  });
  if (error) return null; // older database without 0123, or not an admin

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
      <p className="text-sm text-muted-foreground">
        Estimates customers saw when booking, against the price they accepted (last 180 days). Use
        this to adjust the prices below. Nothing changes automatically.
      </p>
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
              <div className={advice.tone === "ok" ? "text-cz-green-text" : "text-cz-amber-text"}>
                {advice.text}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
