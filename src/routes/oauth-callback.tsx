import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { takeNext } from "@/lib/post-auth-next";
import { Button } from "@/components/ui/button";
import { ResendConfirmation } from "@/components/ResendConfirmation";
import { linkErrorMessage, type LinkError } from "@/lib/auth-flow";
import { initialAuthRedirect } from "@/lib/auth-url-snapshot";

export const Route = createFileRoute("/oauth-callback")({
  ssr: false,
  component: AuthCallbackPage,
});

// Exchanging the OAuth code for a session is a network round-trip to
// Supabase's auth server. On a slow connection (common on the mobile data
// this app mostly runs on) the old 20 x 250ms = 5s budget could time out
// before the session ever arrived -- so people saw "session was not
// completed" even though sign-in had actually worked, just late. Give it a
// much longer budget (well past what even a very slow connection needs)
// before giving up, and offer a manual re-check + retry instead of a dead end.
const MAX_ATTEMPTS = 80; // ~20s at 250ms per attempt
const POLL_MS = 250;

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<"waiting" | "failed" | "rechecking" | "link_error">("waiting");
  // An expired, already-used or refused link (audit A-3). Read from the URL as
  // it was when the page loaded; only the error code is kept.
  const [linkError, setLinkError] = useState<LinkError | null>(null);

  // Set before Google sign-in or email sign-up (src/lib/post-auth-next.ts).
  const readNext = () => takeNext();

  const goPostAuth = () => {
    const next = readNext();
    if (next) {
      window.location.replace(next);
    } else {
      navigate({ to: "/home", replace: true });
    }
  };

  useEffect(() => {
    let cancelled = false;
    const redirect = initialAuthRedirect();
    const urlError = redirect.pathname === "/oauth-callback" ? redirect.error : null;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!cancelled && session && event === "SIGNED_IN") {
        cancelled = true;
        goPostAuth();
      }
    });
    const finish = async () => {
      if (urlError) {
        // Nothing to wait for: the link itself failed. If the person is
        // already signed in (e.g. re-opened a used confirmation link), carry on.
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session) return goPostAuth();
        setLinkError(urlError);
        setState("link_error");
        return;
      }
      for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session) {
          goPostAuth();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      if (!cancelled) setState("failed");
    };
    void finish();
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recheck = async () => {
    setState("rechecking");
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      goPostAuth();
      return;
    }
    setState("failed");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-5">
      <div className="text-center space-y-3 max-w-xs">
        {state !== "failed" && state !== "link_error" && (
          <Loader2 className="w-8 h-8 animate-spin text-cz-amber-text mx-auto" />
        )}
        <h1 className="font-display font-bold text-xl">Con Z Login</h1>
        {state === "link_error" && linkError ? (
          <>
            <p role="alert" className="text-sm text-muted-foreground">
              {linkErrorMessage(linkError)}
            </p>
            <div className="flex flex-col gap-2 pt-2 text-left">
              {linkError.kind === "expired" && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Already confirmed your email? Just log in. Otherwise we can send a new
                    confirmation link.
                  </p>
                  <ResendConfirmation />
                </>
              )}
              <Button asChild className="w-full">
                <Link to="/auth" search={{ mode: "login" } as never}>
                  {linkError.kind === "expired" ? "Go to login" : "Try again"}
                </Link>
              </Button>
            </div>
          </>
        ) : state === "failed" ? (
          <>
            <p className="text-sm text-muted-foreground">
              This is taking longer than expected — often just a slow connection. If sign-in actually finished, checking
              again should pick it up.
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <Button onClick={recheck} className="w-full">Check again</Button>
              <Button asChild variant="outline" className="w-full">
                <Link to="/auth" search={{ mode: "login" } as never}>Back to login</Link>
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Securing your session…</p>
        )}
      </div>
    </div>
  );
}