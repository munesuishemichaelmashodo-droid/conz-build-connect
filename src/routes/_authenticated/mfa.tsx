import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { safeInternalPath } from "@/lib/safe-redirect";
import { ShieldCheck, Loader2, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { OtpCodeInput } from "@/components/OtpCodeInput";
import {
  codeScreenDestination,
  describeCodeProblem,
  isCompleteCode,
  type CodeProblem,
} from "@/lib/otp-code";

const searchSchema = z.object({
  next: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/mfa")({
  validateSearch: searchSchema,
  component: MfaPage,
});

// intro: no authenticator yet; nothing is created until the admin taps "Set up".
// unavailable: the factor list could not be read; nothing is assumed.
type Stage = "loading" | "unavailable" | "intro" | "challenge" | "enroll";

function MfaPage() {
  const { next } = Route.useSearch();
  const router = useRouter();
  // The page the admin came from (path and query), never this screen itself.
  const destination = codeScreenDestination(safeInternalPath(next));

  const [stage, setStage] = useState<Stage>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<CodeProblem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The last code sent, so a wrong code is not re-sent on its own; typing a new one sends that.
  const lastSent = useRef<string | null>(null);
  const [loadKey, setLoadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Always ask for a code when an authenticator is set up, even on a session that already passed a
      // check: this screen is how an admin renews the 15-minute window for money and role actions and the
      // 30-day check (0166/0169), and the database only counts a code entered recently.
      setStage("loading");
      let factorsData: Awaited<ReturnType<typeof supabase.auth.mfa.listFactors>>["data"] = null;
      try {
        const res = await supabase.auth.mfa.listFactors();
        if (res.error) throw res.error;
        factorsData = res.data;
      } catch {
        if (!cancelled) setStage("unavailable");
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

      // No authenticator yet: wait for the admin to choose "Set up" (nothing is created on a visit).
      setStage("intro");
    })();
    return () => {
      cancelled = true;
    };
  }, [loadKey]);

  const startEnrollment = async () => {
    setStage("loading");
    setQrCode(null);
    setSecret(null);
    setFactorId(null);
    const { data: enrolled, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Con Z Admin",
    });
    if (error || !enrolled) {
      toast.error(error?.message ?? "Could not start the setup. Try again.");
      return setStage("intro");
    }
    setFactorId(enrolled.id);
    setQrCode(enrolled.totp.qr_code);
    setSecret(enrolled.totp.secret);
    setStage("enroll");
  };

  // Only ever removes the UNFINISHED setup being shown (stage "enroll"); a verified authenticator is never touched here.
  const restartEnrollment = async () => {
    if (stage === "enroll" && factorId) {
      await supabase.auth.mfa.unenroll({ factorId });
    }
    await startEnrollment();
  };

  const fail = (p: CodeProblem) => {
    setProblem(p);
    if (p.clear) {
      setCode("");
      lastSent.current = null;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const submit = useCallback(
    async (value: string) => {
      if (!factorId || busy || !isCompleteCode(value)) return;
      lastSent.current = value;
      setBusy(true);
      setProblem(null);
      try {
        const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
          factorId,
        });
        if (challengeError || !challenge) return fail(describeCodeProblem(challengeError));
        const { error: verifyError } = await supabase.auth.mfa.verify({
          factorId,
          challengeId: challenge.id,
          code: value,
        });
        if (verifyError) return fail(describeCodeProblem(verifyError));
      } catch (err) {
        return fail(describeCodeProblem(err as { message?: string }));
      } finally {
        setBusy(false);
      }
      // Record the check for the 30-day rule (0169). The database re-checks every crucial action with a
      // fresh code anyway; if this fails the admin screens may ask for a code again, so say so.
      try {
        const { error } = await (
          supabase.rpc as unknown as (
            f: string,
          ) => PromiseLike<{ error: { message?: string } | null }>
        )("admin_note_authenticator_check");
        if (error && !/admins only/i.test(error.message ?? "")) {
          toast.warning("Verified, but the 30-day check was not saved. You may be asked again.");
        }
      } catch {
        // offline after verifying: the code still counts for this session
      }
      toast.success(stage === "enroll" ? "Authenticator app linked" : "Verified");
      void router.navigate({ href: destination, replace: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [factorId, busy, stage, destination],
  );

  // Send the code as soon as the sixth digit is in (typed, pasted or autofilled), once per code.
  useEffect(() => {
    if (isCompleteCode(code) && code !== lastSent.current && !busy) void submit(code);
  }, [code, busy, submit]);

  const verify = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCompleteCode(code)) {
      return fail({
        message: "Enter all 6 digits from your authenticator app.",
        clear: false,
        retry: false,
      });
    }
    void submit(code);
  };

  return (
    <AppShell title="Verify it's you">
      <div className="max-w-sm mx-auto space-y-5">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-cz-amber-text" />
          </div>
          <h2 className="font-display font-bold text-lg">
            {stage === "enroll" || stage === "intro"
              ? "Set up your authenticator app"
              : stage === "unavailable"
                ? "Couldn't check your authenticator"
                : "Enter your authenticator code"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {stage === "unavailable"
              ? "We could not reach the sign-in service, so nothing was changed. Check your signal and try again."
              : stage === "intro"
                ? "Money and role changes on this account will need a fresh code from an authenticator app on your phone. Setting it up takes about a minute."
                : stage === "enroll"
                  ? "Money and role changes on this account will need a fresh code from the app, and the app is checked at least every 30 days. Scan the code below with Google Authenticator, Authy or 1Password, then enter the 6-digit code."
                  : "Enter the current code from your authenticator app to continue. Crucial changes ask for a fresh code each time; the app is checked at least every 30 days."}
          </p>
        </div>

        {stage === "loading" && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {stage === "unavailable" && (
          <Button type="button" className="w-full h-11" onClick={() => setLoadKey((k) => k + 1)}>
            Try again
          </Button>
        )}

        {stage === "intro" && (
          <Button type="button" className="w-full h-11" onClick={() => void startEnrollment()}>
            Set up authenticator app
          </Button>
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={restartEnrollment}
                >
                  Get a new QR code
                </Button>
              </div>
            )}
          </>
        )}

        {(stage === "enroll" || stage === "challenge") && factorId && (
          <form onSubmit={verify} className="space-y-3" noValidate>
            <div className="space-y-2">
              <Label htmlFor="totp" className="block text-center">
                6-digit code
              </Label>
              <OtpCodeInput
                id="totp"
                ref={inputRef}
                value={code}
                onChange={(v) => {
                  setCode(v);
                  if (problem && v.length > 0) setProblem(null);
                }}
                disabled={busy}
                invalid={!!problem}
                describedBy={problem ? "totp-problem" : "totp-hint"}
                autoFocus
              />
              {problem ? (
                <p id="totp-problem" role="alert" className="text-sm text-destructive text-center">
                  {problem.message}
                </p>
              ) : (
                <p id="totp-hint" className="text-xs text-muted-foreground text-center">
                  You can paste the code. It is checked as soon as all 6 digits are in.
                </p>
              )}
            </div>
            <Button type="submit" disabled={busy || !isCompleteCode(code)} className="w-full h-11">
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span className="sr-only">Checking the code</span>
                </>
              ) : problem?.retry ? (
                "Try again"
              ) : (
                "Verify & continue"
              )}
            </Button>
            {stage === "challenge" && (
              <p className="text-[11px] text-muted-foreground text-center">
                Lost the phone with your authenticator app? Ask the other owner to open Admin,
                Settings, "Authenticator app" and reset it for you. You can then set it up again.
              </p>
            )}
          </form>
        )}
      </div>
    </AppShell>
  );
}
