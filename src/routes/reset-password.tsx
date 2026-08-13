import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  component: ResetPasswordPage,
});

// Recovery links only put the session token in the URL fragment (#...),
// which the Supabase client parses on load and turns into a real session by
// firing a PASSWORD_RECOVERY auth event. If that never fires -- expired
// link, link already used, or the redirect URL isn't on Supabase's allow
// list so the tokens get silently dropped -- updateUser() below has no
// session to act on. Previously we called updateUser() unconditionally,
// which could report success-looking UI while nothing was actually saved,
// then leave the person unable to log in with the "new" password. Now we
// wait for a confirmed recovery session before allowing submission at all,
// and show a clear expired/invalid state instead of a silent dead end.
function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [sessionState, setSessionState] = useState<"checking" | "ready" | "invalid">("checking");

  useEffect(() => {
    let settled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        settled = true;
        setSessionState("ready");
      }
    });
    // If a recovery session was already established before this listener
    // attached, onAuthStateChange won't fire again -- check directly too.
    supabase.auth.getSession().then(({ data }) => {
      if (!settled && data.session) {
        settled = true;
        setSessionState("ready");
      }
    });
    const timeout = setTimeout(() => {
      if (!settled) setSessionState("invalid");
    }, 4000);
    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    if (password !== confirm) return toast.error("Passwords do not match");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) return toast.error(error.message);
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
          {sessionState === "invalid" && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 space-y-2">
              <div className="flex items-center gap-2 text-destructive font-semibold">
                <AlertTriangle className="w-4 h-4" /> This reset link is invalid or expired
              </div>
              <p className="text-sm text-muted-foreground">
                Reset links only work once and expire after a while. Go back and request a new one.
              </p>
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