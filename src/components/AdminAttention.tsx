import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildAttention, type AttentionItem } from "@/lib/admin-attention";
import { cn } from "@/lib/utils";

/**
 * "Needs attention" on the admin dashboard: stuck jobs, stuck Paynow payments,
 * waiting top-ups and the daily reconciliation result. Read-only — it only
 * points the admin at the screen where they can act. Super-admin-only data
 * (top-up requests, reconciliation runs) is only queried for super admins,
 * matching the RLS on those tables.
 */
export function AdminAttention({ isSuper }: { isSuper: boolean }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-attention", isSuper],
    refetchInterval: 60_000,
    queryFn: async (): Promise<AttentionItem[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reconciliation_runs is newer than the generated types
      const db = supabase as any;
      const [jobs, payments, topups, recon, aal] = await Promise.all([
        supabase
          .from("jobs")
          .select("id,status,created_at,updated_at,material,quantity_m3")
          .in("status", ["accepted", "in_progress"])
          .order("updated_at", { ascending: true })
          .limit(100),
        supabase.from("payments").select("created_at").eq("status", "initiated").limit(100),
        isSuper
          ? supabase
              .from("wallet_topup_requests")
              .select("id", { count: "exact", head: true })
              .eq("status", "pending")
          : Promise.resolve({ count: null, error: null }),
        isSuper
          ? db
              .from("reconciliation_runs")
              .select("ran_at,ok")
              .order("ran_at", { ascending: false })
              .limit(1)
          : Promise.resolve({ data: undefined, error: null }),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      const failed = [jobs.error, payments.error, topups.error, recon.error].find(Boolean);
      if (failed) throw new Error(failed.message);
      return buildAttention({
        now: Date.now(),
        isSuper,
        aal: (aal.data?.currentLevel as "aal1" | "aal2" | undefined) ?? null,
        activeJobs: jobs.data ?? [],
        initiatedPayments: payments.data ?? [],
        pendingTopups: topups.count ?? null,
        latestRecon: isSuper
          ? ((recon.data?.[0] as { ran_at: string; ok: boolean } | undefined) ?? null)
          : undefined,
      });
    },
  });

  return (
    <section
      aria-labelledby="attention-title"
      className="rounded-2xl border bg-card p-4 shadow-card space-y-3"
    >
      <h2 id="attention-title" className="font-display font-bold text-lg">
        Needs attention
      </h2>
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Checking jobs and payments…
        </div>
      ) : isError ? (
        <div className="text-sm text-muted-foreground">
          Could not load the checks.{" "}
          <button
            type="button"
            onClick={() => refetch()}
            className="underline font-semibold min-h-11"
          >
            Try again
          </button>
        </div>
      ) : (data ?? []).length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="w-4 h-4 text-success" /> Nothing is stuck right now.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {data!.map((item) => (
            <li
              key={item.key}
              className={cn(
                "rounded-xl border p-3",
                item.tone === "critical"
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-warning/40 bg-warning/5",
              )}
            >
              <div className="flex items-start gap-2">
                {item.tone === "critical" ? (
                  <AlertOctagon
                    className="w-4 h-4 mt-0.5 shrink-0 text-destructive"
                    aria-label="Urgent"
                  />
                ) : (
                  <AlertTriangle
                    className="w-4 h-4 mt-0.5 shrink-0 text-warning"
                    aria-label="Warning"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{item.title}</div>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                  {item.jobs && (
                    <ul className="mt-2 space-y-1">
                      {item.jobs.map((j) => (
                        <li key={j.id}>
                          <Link
                            to="/jobs/$id"
                            params={{ id: j.id }}
                            className="flex min-h-11 items-center justify-between gap-2 rounded-lg border bg-background px-3 text-xs"
                          >
                            <span className="truncate">{j.label}</span>
                            <span className="shrink-0 text-muted-foreground">
                              {j.ageDays} days <ChevronRight className="inline w-3.5 h-3.5" />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.to && (
                    <Link
                      to={item.to}
                      className="mt-1.5 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary"
                    >
                      {item.to === "/mfa" ? "Set up authenticator" : "Open"}{" "}
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
