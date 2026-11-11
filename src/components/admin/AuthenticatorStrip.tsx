import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { authenticatorPrompt, parsePolicy } from "@/lib/admin-authenticator";

type Rpc = (f: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
// Called through `supabase.rpc(...)` in place (never a detached reference) so the client keeps its `this`.
const rpc: Rpc = (f) => (supabase.rpc as unknown as Rpc)(f);

/**
 * One line at the top of every admin page: the authenticator app, with a button straight to the
 * code screen that returns to THIS page. Loud when action is needed (not set up and required, or the
 * 30-day check has passed), quiet otherwise. It shows nothing if the database cannot answer
 * (for example before 0169 is applied).
 */
export function AuthenticatorStrip() {
  const path = useRouterState({
    select: (s) => s.location.pathname + (s.location.searchStr ?? ""),
  });
  const { data } = useQuery({
    queryKey: ["admin-authenticator-policy"],
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data: raw, error } = await rpc("admin_authenticator_policy");
      if (error) return null;
      return parsePolicy(raw);
    },
  });
  if (!data) return null;
  const p = authenticatorPrompt(data);
  const href = `/mfa?next=${encodeURIComponent(path)}`;
  const Icon = p.urgent ? ShieldAlert : ShieldCheck;
  return (
    <section
      aria-label="Authenticator app"
      className={cn(
        "mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2",
        p.urgent ? "border-foreground bg-muted" : "border-border bg-card",
      )}
    >
      <Icon aria-hidden className="h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-semibold">{p.title}</p>
        <p className="text-xs text-muted-foreground">{p.body}</p>
      </div>
      <a
        href={href}
        className={cn(
          "inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold",
          p.urgent
            ? "bg-foreground text-background"
            : "border border-border text-foreground hover:bg-muted",
        )}
      >
        {p.cta}
      </a>
    </section>
  );
}
