import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatPoints, pointsReason, type PointsEntry } from "@/lib/points";

type Rpc = (
  f: string,
  a: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
// points_overview / points_ledger are newer than the generated types
const rpc = supabase.rpc as unknown as Rpc;
const table = (supabase as unknown as { from: (t: string) => any }).from.bind(supabase); // eslint-disable-line @typescript-eslint/no-explicit-any

/** A person's own ConZ points: balance and why each entry happened. Shown only once points are on or they hold some. */
export function PointsCard() {
  const { data } = useQuery({
    queryKey: ["my-points"],
    queryFn: async () => {
      const { data: o } = await rpc("points_overview", {});
      const overview = (o ?? {}) as { enabled?: boolean; balance?: number };
      const { data: rows } = await table("points_ledger")
        .select("id,points,kind,event,reason,basis,created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      return {
        enabled: !!overview.enabled,
        balance: Number(overview.balance ?? 0),
        rows: (rows ?? []) as PointsEntry[],
      };
    },
  });
  if (!data || (!data.enabled && data.rows.length === 0)) return null;
  return (
    <section
      className="rounded-2xl border bg-card p-4 shadow-soft space-y-3"
      aria-label="ConZ points"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4" />
          ConZ points
        </div>
        <p className="font-display text-2xl font-bold">{data.balance.toLocaleString("en-US")}</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Points reward genuine activity on ConZ. They are not cash and cannot be withdrawn.
      </p>
      {data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No points yet. You earn them from verified deliveries and qualified referrals.
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {data.rows.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 py-2">
              <span>
                {pointsReason(r)}
                <span className="block text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString("en-GB")}
                </span>
              </span>
              <span
                className={`font-semibold ${r.points < 0 ? "text-destructive" : "text-success"}`}
              >
                {formatPoints(r.points)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
