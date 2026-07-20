import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type AuthorizationDetails = {
  client?: { name?: string; redirect_uri?: string } | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
  scopes?: string[] | null;
  requested_scopes?: string[] | null;
};

type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
};

function oauth(): OAuthNamespace {
  return (supabase.auth as unknown as { oauth: OAuthNamespace }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } as never });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate } as never);
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md space-y-2 text-center">
        <h1 className="font-display font-bold text-xl">Could not load authorization</h1>
        <p className="text-sm text-muted-foreground">{String((error as Error)?.message ?? error)}</p>
      </div>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(approve ? "approve" : "deny");
    setError(null);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (error) {
      setBusy(null);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(null);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "an app";
  const redirectUri = details?.client?.redirect_uri;
  const scopes = details?.requested_scopes ?? details?.scopes ?? [];

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-lift space-y-5">
        <div className="flex items-center gap-3">
          <img src="/conz-logo.png" alt="Con Z" className="w-10 h-10 rounded-lg" />
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Con Z</div>
            <h1 className="font-display font-bold text-lg leading-tight">
              Connect {clientName} to your account
            </h1>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {clientName} will be able to call Con Z tools as you while you're signed in. This does not
          bypass Con Z's permissions or backend policies.
        </p>

        {redirectUri && (
          <div className="text-xs">
            <div className="uppercase tracking-widest text-muted-foreground">Redirects to</div>
            <div className="break-all">{redirectUri}</div>
          </div>
        )}

        {scopes.length > 0 && (
          <ul className="text-xs space-y-1">
            {scopes.map((s: string) => (
              <li key={s}>
                <span className="text-muted-foreground">Requested:</span> {s}
              </li>
            ))}
          </ul>
        )}

        {error && (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={busy !== null} onClick={() => decide(false)}>
            {busy === "deny" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Cancel"}
          </Button>
          <Button disabled={busy !== null} onClick={() => decide(true)}>
            {busy === "approve" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Approve"}
          </Button>
        </div>
      </div>
    </main>
  );
}
