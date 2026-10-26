import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { acceptTerms } from "@/lib/account.functions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { needsTermsAcceptance } from "@/lib/auth-flow";

// Anyone signed in without a recorded acceptance (e.g. a new Google account
// opened from the Login tab, or accounts from before this was recorded) is
// asked to accept before using the app. Nothing is filled in for them.
export function TermsGate() {
  const { userId, profile, loading, refresh } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const accept = useServerFn(acceptTerms);
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!needsTermsAcceptance({ loading, userId, profile, path })) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await accept();
      await refresh();
    } catch {
      setError("Couldn't save your acceptance. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-gate-title"
      className="fixed inset-0 z-[100] bg-background/95 flex items-center justify-center px-4"
    >
      <div className="w-full max-w-sm rounded-2xl border bg-card p-5 shadow-soft space-y-4">
        <h2 id="terms-gate-title" className="font-display font-bold text-xl">
          Accept the Terms to continue
        </h2>
        <p className="text-sm text-muted-foreground">
          Before you use Con Z, please read and accept our{" "}
          <Link to="/terms" target="_blank" className="underline text-foreground">
            Terms
          </Link>{" "}
          and{" "}
          <Link to="/privacy" target="_blank" className="underline text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={ticked}
            onCheckedChange={(v) => setTicked(v === true)}
            className="mt-0.5"
          />
          <span>I accept the Terms and Privacy Policy</span>
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button className="w-full h-11" disabled={!ticked || busy} onClick={submit}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
        </Button>
        <Button variant="ghost" className="w-full" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
