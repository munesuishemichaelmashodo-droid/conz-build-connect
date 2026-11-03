import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cooldownRemaining, describeAuthError } from "@/lib/auth-flow";

// Sends a fresh sign-up confirmation link. One request per 60 s from this
// screen (Supabase enforces the same limit per address). The success text
// doesn't say whether the address has an account.
export function ResendConfirmation({
  initialEmail = "",
  editable = true,
  className,
}: {
  initialEmail?: string;
  editable?: boolean;
  className?: string;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setEmail(initialEmail), [initialEmail]);

  const wait = cooldownRemaining(sentAt, now);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [wait, now]);

  const send = async () => {
    const target = email.trim();
    if (!target)
      return setStatus({ ok: false, text: "Enter the email address you signed up with." });
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: target,
      options: { emailRedirectTo: `${window.location.origin}/oauth-callback` },
    });
    setBusy(false);
    const t = Date.now();
    if (error) {
      const d = describeAuthError(error);
      // Start the cooldown on a rate-limit reply too, so the button can't be hammered.
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
      text: "If this address is waiting for confirmation, a new link is on its way. Check Spam/Junk too.",
    });
  };

  return (
    <div className={className}>
      {editable && (
        <div className="mb-2">
          <Label htmlFor="resend-email">Email</Label>
          <Input
            id="resend-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
      )}
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
          "Send a new confirmation link"
        )}
      </Button>
      {status && (
        <p
          role="status"
          className={`mt-2 text-sm ${status.ok ? "text-muted-foreground" : "text-destructive"}`}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}
