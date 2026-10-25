import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeAuthError, recoveryState, type RecoveryState } from "@/lib/auth-flow";
import { initialAuthRedirect } from "@/lib/auth-url-snapshot";
import { RequestResetLink } from "@/components/RequestResetLink";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  component: ResetPasswordPage,
});

// The form only appears for a real password-recovery flow (audit A-2): either
// Supabase's PASSWORD_RECOVERY event, or a recovery link that landed on this
// page and produced a session. A normal signed-in session is not enough; those
// users are sent to Account settings, where changing the password is handled.
// An expired or already-used link is shown as such straight away (audit A-3),
// with a form to request a new one. supabase-js reads the link when the client
// starts, which can be before this page mounts, so the URL flags come from
// auth-url-snapshot (captured at app start, no tokens kept).
function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [sessionState, setSessionState] = useState<"checking" | RecoveryState>("checking");

  useEffect(() => {
    let cancelled = false;
    let recoveryEvent = false;
    const redirect = initialAuthRedirect();
    const decide = (hasSession: boolean) => {
      if (!cancelled) setSessionState(recoveryState({ redirect, recoveryEvent, hasSession }));
    };
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        recoveryEvent = true;
        decide(!!session);
      }
    });
    // getSession waits for the client to finish reading the link, so no timer is needed.
    supabase.auth.getSession().then(({ data }) => decide(!!data.session));
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    if (password !== confirm) return toast.error("Passwords do not match");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) return toast.error(describeAuthError(error).message);
    toast.success("Password reset complete. You can now log in.");
    navigate({ to: "/home", replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-screen-sm px-5 py-6">
        <Link to="/auth" search={{ mode: "login" } as never} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to login
        </Link>
        <div className="mt-8 rounded-2xl bg-card border p-4 shadow-soft space-y-4">
          <div className="flex items-center gap-3">
            <img src="/conz-logo.png" alt="CON Z" className="w-10 h-10 rounded-lg object-cover" width={40} height={40} />
            <div>
              <h1 className="font-display font-bold text-2xl uppercase leading-none">Reset password</h1>
              <p className="text-xs text-muted-foreground">Set a new Con Z login password.</p>
            </div>
          </div>
          {sessionState === "checking" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Verifying your reset link…
            </div>
          )}
          {(sessionState === "invalid" || sessionState === "expired") && (
            <div className="space-y-3">
              <div
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 space-y-2"
              >
                <div className="flex items-center gap-2 text-destructive font-semibold">
                  <AlertTriangle className="w-4 h-4" />
                  {sessionState === "expired"
                    ? "This reset link has expired or was already used"
                    : "Open this page from your reset email"}
                </div>
                <p className="text-sm text-muted-foreground">
                  Reset links work once and expire after an hour. Request a new one below and open
                  it on this device.
                </p>
              </div>
              <RequestResetLink />
            </div>
          )}
          {sessionState === "signed_in_not_recovery" && (
            <div role="status" className="rounded-xl border bg-muted/40 p-4 space-y-3">
              <p className="text-sm">
                You're signed in. To change your password, use{" "}
                <span className="font-semibold">Account settings</span>.
              </p>
              <Button asChild className="w-full h-11">
                <Link to="/profile">Go to Account settings</Link>
              </Button>
            </div>
          )}
          <form onSubmit={submit} className={`space-y-3 ${sessionState !== "ready" ? "hidden" : ""}`}>
            <div>
              <Label htmlFor="newPassword">New password</Label>
              <Input id="newPassword" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} autoComplete="new-password" required />
            </div>
            <div>
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input id="confirmPassword" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} autoComplete="new-password" required />
            </div>
            <Button type="submit" disabled={saving} className="w-full h-11 font-display uppercase tracking-wide">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save new password"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}