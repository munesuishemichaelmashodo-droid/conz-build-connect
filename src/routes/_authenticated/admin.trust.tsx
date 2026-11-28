import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShieldQuestion } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/ui-bits";
import { parseSignals, signalLabel } from "@/lib/trust-signals";

export const Route = createFileRoute("/_authenticated/admin/trust")({
  component: AdminTrust,
});

type RpcFn = (
  f: string,
  a?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

/** 0184: possible fraud signals for a person to review. Nothing here changes an account. */
function AdminTrust() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-trust-signals"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as unknown as RpcFn)("admin_trust_signals");
      if (error) throw new Error(error.message);
      return parseSignals(data);
    },
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4 text-sm">
        <p className="font-semibold">Signals to review</p>
        <p className="text-muted-foreground">
          These are patterns worth a look, not proof of fraud. Nothing here blocks, flags or
          suspends anyone. Decide only after checking the job evidence, and record your reason when
          you act. Opening this page is logged.
        </p>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p role="alert" className="text-sm font-semibold text-destructive">
          Couldn't load signals: {(error as Error).message}
        </p>
      ) : !data?.length ? (
        <EmptyState icon={ShieldQuestion} title="Nothing to review" hint="No signals right now." />
      ) : (
        <ul className="space-y-2" data-testid="trust-signals">
          {data.map((s, i) => {
            const l = signalLabel(s.signal);
            return (
              <li
                key={`${s.signal}-${i}`}
                className="space-y-1 rounded-xl border bg-card p-3 text-sm"
              >
                <p className="font-semibold">{l.title}</p>
                <p>{s.detail}</p>
                <p className="text-[12px] text-muted-foreground">{l.check}</p>
                {s.job_ids && s.job_ids.length > 0 && (
                  <p className="flex flex-wrap gap-2 text-[12px]">
                    {s.job_ids.slice(0, 10).map((id) => (
                      <Link key={id} to="/jobs/$id" params={{ id }} className="underline">
                        Job {id.slice(0, 8)}
                      </Link>
                    ))}
                  </p>
                )}
                {s.user_ids && s.user_ids.length > 0 && (
                  <p className="text-[12px] text-muted-foreground">
                    Accounts: {s.user_ids.map((u) => u.slice(0, 8)).join(", ")} (search them on the
                    Users screen)
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
