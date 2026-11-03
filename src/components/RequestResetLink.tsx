import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cooldownRemaining, describeAuthError } from "@/lib/auth-flow";

// Requests a new password-reset email from the reset page, with the same 60 s
// cooldown Supabase enforces. The reply never says whether the address exists.
export function RequestResetLink() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const wait = cooldownRemaining(sentAt, now);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [wait, now]);

  const send = async () => {
    const target = email.trim();
    if (!target) return setStatus({ ok: false, text: "Enter your account email." });
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.auth.resetPasswordForEmail(target, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    const t = Date.now();
    if (error) {
      const d = describeAuthError(error);
      if (d.kind === "rate_limited") {
        setSentAt(t);
        setNow(t);
      }
      return setStatus({ ok: false, text: d.message });
    }
    setSentAt(t);
    setNow(t);
    setStatus({
      ok: true,
      text: "If an account uses this email, a new reset link is on its way. Check Spam/Junk too.",
    });
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="reset-request-email">Email</Label>
      <Input
        id="reset-request-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
      />
      <Button
        type="button"
        variant="outline"
        className="w-full h-11"
        onClick={send}
        disabled={busy || wait > 0}
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : wait > 0 ? (
          `Send again in ${wait}s`
        ) : (
          "Send a new reset link"
        )}
      </Button>
      {status && (
        <p
          role="status"
          className={`text-sm ${status.ok ? "text-muted-foreground" : "text-destructive"}`}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}
