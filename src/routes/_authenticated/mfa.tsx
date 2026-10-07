import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { safeInternalPath } from "@/lib/safe-redirect";
import { ShieldCheck, Loader2, Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const searchSchema = z.object({
  next: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/mfa")({
  validateSearch: searchSchema,
  component: MfaPage,
});

type Stage = "loading" | "challenge" | "enroll" | "verifying";

function MfaPage() {
  const { next } = Route.useSearch();
  const nav = useNavigate();
  const safeNext = safeInternalPath(next) ?? "/admin";

  const [stage, setStage] = useState<Stage>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2") {
        if (!cancelled) return void nav({ to: safeNext as "/admin", replace: true });
      }

      const { data: factorsData, error } = await supabase.auth.mfa.listFactors();
      if (error) {
        toast.error(error.message);
        return;
      }
      const totpFactors = factorsData?.totp ?? [];
      const verifiedTotp = totpFactors.find((f) => (f.status as string) === "verified");
      const unverifiedTotp = totpFactors.find((f) => (f.status as string) === "unverified");

      if (cancelled) return;

      if (verifiedTotp) {
        setFactorId(verifiedTotp.id);
        setStage("challenge");
        return;
      }

      // Reuse an existing unverified enrollment rather than piling up unused factors
      if (unverifiedTotp) {
        setFactorId(unverifiedTotp.id);
        setStage("enroll");
        // No QR to show for a resumed enrollment — the person can request a fresh one
        return;
      }

      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Con Z Admin",
      });
      if (enrollError) {
        toast.error(enrollError.message);
        return;
      }
      if (!cancelled && enrolled) {
        setFactorId(enrolled.id);
        setQrCode(enrolled.totp.qr_code);
        setSecret(enrolled.totp.secret);
        setStage("enroll");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restartEnrollment = async () => {
    if (factorId) {
      await supabase.auth.mfa.unenroll({ factorId });
    }
    setStage("loading");
    setQrCode(null);
    setSecret(null);
    setFactorId(null);
    const { data: enrolled, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Con Z Admin" });
    if (error) return toast.error(error.message);
    if (enrolled) {
      setFactorId(enrolled.id);
      setQrCode(enrolled.totp.qr_code);
      setSecret(enrolled.totp.secret);
      setStage("enroll");
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId || code.trim().length < 6) return toast.error("Enter the 6-digit code from your authenticator app");
    setBusy(true);
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setBusy(false);
      return toast.error(challengeError?.message ?? "Could not start verification");
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    setBusy(false);
    if (verifyError) {
      return toast.error(verifyError.message.includes("Invalid") ? "That code didn't match — try the current one from your app" : verifyError.message);
    }
    toast.success(stage === "enroll" ? "Authenticator app linked" : "Verified");
    nav({ to: safeNext as "/admin", replace: true });
  };

  return (
    <AppShell title="Verify it's you">
      <div className="max-w-sm mx-auto space-y-5">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-primary" />
          </div>
          <h2 className="font-display font-bold text-lg">
            {stage === "enroll" ? "Set up two-factor login" : "Enter your authenticator code"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {stage === "enroll"
              ? "Super admin money actions (credits, approvals, refunds) require an authenticator app. Scan the code below with Google Authenticator, Authy, or 1Password."
              : "This admin account is protected with two-factor authentication."}
          </p>
        </div>

        {stage === "loading" && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {stage === "enroll" && (
          <>
            {qrCode ? (
              <div className="rounded-xl border bg-card p-4 flex flex-col items-center gap-3">
                {/* qr_code from Supabase is an SVG data URI */}
                <img src={qrCode} alt="Scan with your authenticator app" className="w-44 h-44" />
                {secret && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(secret);
                      toast.success("Secret key copied");
                    }}
                    className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="w-3 h-3" /> {secret}
                  </button>
                )}
                <p className="text-[11px] text-muted-foreground text-center">
                  Can't scan? Enter this key manually in your authenticator app.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border bg-card p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  You have an unfinished setup. Request a fresh QR code to continue.
                </p>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={restartEnrollment}>
                  Get a new QR code
                </Button>
              </div>
            )}
          </>
        )}

        {(stage === "enroll" || stage === "challenge") && factorId && (
          <form onSubmit={verify} className="space-y-3">
            <div>
              <Label htmlFor="totp">6-digit code</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="totp"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  className="pl-9 text-center tracking-[0.4em] font-mono text-lg"
                  maxLength={6}
                  autoFocus
                />
              </div>
            </div>
            <Button type="submit" disabled={busy || code.length < 6} className="w-full h-11 font-display uppercase tracking-wide">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify & continue"}
            </Button>
            {stage === "challenge" && (
              <p className="text-[11px] text-muted-foreground text-center">
                Lost access to your authenticator app? The project owner can remove the factor in the Supabase dashboard (Authentication → Users), then you can enrol again.
              </p>
            )}
          </form>
        )}
      </div>
    </AppShell>
  );
}
