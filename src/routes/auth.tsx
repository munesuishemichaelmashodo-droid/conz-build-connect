import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ArrowLeft, Loader2, Eye, EyeOff, ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { COUNTRY_CODES } from "@/lib/country-codes";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { safeInternalPath } from "@/lib/safe-redirect";
import { describeAuthError, signUpOutcome } from "@/lib/auth-flow";
import { rememberNext, takeNext } from "@/lib/post-auth-next";
import { rememberPendingTermsAcceptance } from "@/lib/pending-terms";
import { ResendConfirmation } from "@/components/ResendConfirmation";
import { toast } from "sonner";

const searchSchema = z.object({
  mode: z.enum(["login", "register"]).optional(),
  next: z.string().optional(),
  role: z.enum(["customer", "driver"]).optional(),
  ref: z.string().optional(),
  // Set by admin screens: a money or role action needs a fresh Google sign-in (0111).
  // The router reads "1" as a number; anything unexpected is ignored, never an error.
  reauth: z.coerce.string().optional().catch(undefined),
});

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: searchSchema,
  component: AuthPage,
});

function AuthPage() {
  const { mode, next, role: initialRole, ref, reauth } = Route.useSearch();
  const nav = useNavigate();
  const [tab, setTab] = useState<"login" | "register">(mode ?? (initialRole ? "register" : "login"));

  // Only allow same-origin relative paths.
  // safeInternalPath rejects "/\evil.com"-style bypasses (audit F8 open redirect).
  const safeNext = safeInternalPath(next);
  const goPostAuth = () => {
    // A destination remembered before an email confirmation, used once.
    const target = safeNext ?? takeNext();
    if (safeNext) takeNext();
    if (target) {
      window.location.replace(target);
    } else {
      nav({ to: "/home", replace: true });
    }
  };

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) goPostAuth();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) goPostAuth();
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, safeNext]);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  // Set when a password sign-in fails because the email isn't confirmed yet (audit A-4).
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  // Sign-up hit an email that already has an account (Supabase sends nothing then).
  const [existingEmail, setExistingEmail] = useState<string | null>(null);
  const [authDebug, setAuthDebug] = useState<null | {
    stage: string;
    message: string;
    name?: string;
    status?: number | string;
    code?: string;
    endpoint?: string;
    hint?: string;
  }>(null);

  // shared
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // register
  const [role, setRole] = useState<"customer" | "driver">(initialRole ?? "customer");
  const [fullName, setFullName] = useState("");
  const [countryAlpha2, setCountryAlpha2] = useState("ZW");
  const [countryDialCode, setCountryDialCode] = useState("+263");
  const [localPhone, setLocalPhone] = useState("");
  const phone = `${countryDialCode}${localPhone.replace(/\D/g, "")}`;
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [referralCode, setReferralCode] = useState((ref ?? "").toUpperCase());

  const supabaseUrl =
    (import.meta as unknown as { env: Record<string, string | undefined> }).env
      .VITE_SUPABASE_URL ?? "(missing VITE_SUPABASE_URL)";
  const supabaseKeyPresent = Boolean(
    (import.meta as unknown as { env: Record<string, string | undefined> }).env
      .VITE_SUPABASE_PUBLISHABLE_KEY,
  );

  const reportAuthError = (
    stage: string,
    err: unknown,
    endpoint: string,
    hint?: string,
  ) => {
    const e = err as {
      message?: string;
      name?: string;
      status?: number;
      code?: string;
      __isAuthError?: boolean;
    } | null;
    const info = {
      stage,
      message: e?.message ?? String(err ?? "Unknown error"),
      name: e?.name,
      status: e?.status,
      code: e?.code,
      endpoint,
      hint,
    };
    // Internal details (endpoint, status, code) are for developers only (audit A-5).
    if (import.meta.env.DEV) {
      setAuthDebug(info);
      // eslint-disable-next-line no-console
      console.error("[auth]", info, err);
    }
    toast.error(describeAuthError(err).message);
  };

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthDebug(null);
    setLoading(true);
    const endpoint = `${supabaseUrl}/auth/v1/token?grant_type=password`;
    try {
      setUnconfirmedEmail(null);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) {
        if (describeAuthError(error).kind === "email_not_confirmed") {
          setUnconfirmedEmail(email.trim());
          return;
        }
        return reportAuthError(
          "Password sign-in",
          error,
          endpoint,
          !supabaseKeyPresent
            ? "VITE_SUPABASE_PUBLISHABLE_KEY is missing in this deploy."
            : undefined,
        );
      }
      goPostAuth();
    } catch (err) {
      setLoading(false);
      reportAuthError(
        "Password sign-in (network)",
        err,
        endpoint,
        "The auth endpoint was unreachable. Check the Supabase URL, CORS, and that env vars are set on Vercel.",
      );
    }
  };

  const sendPasswordReset = async () => {
    const target = (resetEmail || email).trim();
    if (!target) return toast.error("Enter your email first");
    setAuthDebug(null);
    setResetLoading(true);
    const endpoint = `${supabaseUrl}/auth/v1/recover`;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(target, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setResetLoading(false);
      if (error) return reportAuthError("Password reset", error, endpoint);
      toast.success("Password reset link sent. Check your email.");
    } catch (err) {
      setResetLoading(false);
      reportAuthError("Password reset (network)", err, endpoint);
    }
  };

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return toast.error("Please enter your full name");
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    if (!acceptedTerms) return toast.error("Please accept the Terms and Privacy Policy to continue");
    setAuthDebug(null);
    setExistingEmail(null);
    setLoading(true);
    const endpoint = `${supabaseUrl}/auth/v1/signup`;
    // Keep the booking they started (e.g. from the price check) across the
    // confirmation email, which may open in another tab.
    rememberNext(safeNext);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/oauth-callback`,
          // terms_accepted: the box must be ticked to get here. activateAccount
          // records it on the profile once the user has a session (audit A-1).
          data: {
            full_name: fullName,
            phone,
            role,
            referral_code: referralCode.trim() || null,
            terms_accepted: true,
          },
        },
      });
      if (error) {
        setLoading(false);
        return reportAuthError("Sign-up", error, endpoint);
      }
      // If auto-confirm is on, signUp returns a session — we're already signed in.
      // Otherwise, try to sign in immediately with the credentials just registered.
      if (!data.session) {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          setLoading(false);
          const outcome = signUpOutcome({
            hasSession: false,
            identityCount: data.user?.identities?.length ?? null,
          });
          if (outcome === "existing_account") {
            // No email was sent, so don't say it was: send them to log in instead.
            setExistingEmail(email);
            setResetEmail(email);
            setPassword("");
            setTab("login");
            return;
          }
          nav({ to: "/verify-email", search: { email, next: safeNext ?? undefined } as never });
          return;
        }
      }
      setLoading(false);
      toast.success("Welcome to Con Z!");
      goPostAuth();
    } catch (err) {
      setLoading(false);
      reportAuthError("Sign-up (network)", err, endpoint);
    }
  };

  const google = async () => {
    if (tab === "register" && !acceptedTerms) {
      return toast.error("Please accept the Terms and Privacy Policy to continue");
    }
    setAuthDebug(null);
    setLoading(true);
    if (tab === "register" && acceptedTerms) rememberPendingTermsAcceptance();
    const endpoint = `${supabaseUrl}/auth/v1/authorize?provider=google`;
    const isCancellation = (m: string) =>
      /cancel/i.test(m) || /closed/i.test(m) || /popup/i.test(m) || /dismiss/i.test(m);
    try {
      // Google sign-up can't carry the Customer/Driver choice (the account starts as a
      // customer), so a driver goes straight to the driver application afterwards.
      // Admin approval there grants the driver role (migration 0042).
      rememberNext(
        safeNext ?? (tab === "register" && role === "driver" ? "/become-driver" : null),
      );

      // Google actively blocks OAuth sign-in inside an embedded WebView
      // (returns "Error 403: disallowed_useragent") -- this app runs
      // wrapped in exactly that kind of WebView on Android via Capacitor.
      // So on native, get the auth URL without letting Supabase navigate
      // the WebView to it (skipBrowserRedirect), and open it in the
      // system browser instead via the Capacitor Browser plugin, which
      // Google does allow. The redirect back into the app is handled by
      // capacitor-oauth-bridge.ts (registered at app startup), which
      // converts the custom-scheme callback into the same web URL this
      // page's polling logic already handles.
      const { isNativePlatform, nativeOAuthClient } = await import("@/lib/capacitor-oauth-bridge");
      if (isNativePlatform()) {
        // PKCE: the custom-scheme redirect carries only a one-time code
        // that is useless to any other app (audit H8).
        const { data, error } = await nativeOAuthClient().auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: "com.conz.app://oauth-callback",
            skipBrowserRedirect: true,
          },
        });
        if (error || !data?.url) {
          setLoading(false);
          return reportAuthError(
            "Google sign-in",
            error ?? new Error("No auth URL returned"),
            endpoint,
            "Check that Google provider is enabled and that com.conz.app://oauth-callback is in Supabase Auth Redirect URLs.",
          );
        }
        const { Browser } = await import("@capacitor/browser");
        await Browser.open({ url: data.url });
        return;
      }

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/oauth-callback` },
      });
      if (error) {
        setLoading(false);
        const msg = (error as { message?: string })?.message ?? "";
        if (isCancellation(msg)) {
          toast.message("Google sign-in cancelled");
          return;
        }
        return reportAuthError(
          "Google sign-in",
          error,
          endpoint,
          "Check that Google provider is enabled and that this exact origin is in Supabase Auth Redirect URLs.",
        );
      }
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      goPostAuth();
    } catch (err) {
      setLoading(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (isCancellation(msg)) {
        toast.message("Google sign-in cancelled");
        return;
      }
      reportAuthError("Google sign-in (network)", err, endpoint);
    }
  };


  return (
    <div className="cz-screen min-h-screen bg-background">
      <div className="mx-auto max-w-[480px] px-5 py-4">
        <Link to="/" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-foreground hover:bg-muted">
          <ArrowLeft aria-hidden className="w-4 h-4" /> Back
        </Link>

        <div className="mt-4 flex items-center gap-3">
          <img src="/conz-icon-192.png" alt="" className="w-10 h-10 rounded-lg" width={40} height={40} />
          <div>
            <h1 className="cz-display font-bold text-[28px] leading-none">Con Z</h1>
            <div className="text-sm text-muted-foreground">Construction made easy</div>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "register")} className="mt-6">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="login">Log in</TabsTrigger>
            <TabsTrigger value="register">Register</TabsTrigger>
          </TabsList>

          {import.meta.env.DEV && authDebug && (
            <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-destructive">
                  {authDebug.stage} error
                </div>
                <button
                  type="button"
                  onClick={() => setAuthDebug(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Dismiss
                </button>
              </div>
              <div><span className="text-muted-foreground">Message:</span> {authDebug.message}</div>
              {authDebug.name && <div><span className="text-muted-foreground">Name:</span> {authDebug.name}</div>}
              {authDebug.status !== undefined && (
                <div><span className="text-muted-foreground">HTTP status:</span> {String(authDebug.status)}</div>
              )}
              {authDebug.code && <div><span className="text-muted-foreground">Code:</span> {authDebug.code}</div>}
              {authDebug.endpoint && (
                <div className="break-all"><span className="text-muted-foreground">Endpoint:</span> {authDebug.endpoint}</div>
              )}
              <div className="break-all">
                <span className="text-muted-foreground">Supabase URL env:</span> {supabaseUrl}
              </div>
              <div>
                <span className="text-muted-foreground">Publishable key present:</span>{" "}
                {supabaseKeyPresent ? "yes" : "NO — add VITE_SUPABASE_PUBLISHABLE_KEY on Vercel"}
              </div>
              {authDebug.hint && (
                <div className="pt-1 text-muted-foreground">Hint: {authDebug.hint}</div>
              )}
              <div className="pt-1 text-[10px] text-muted-foreground">
                Full details also logged to the browser console under <code>[auth]</code>.
              </div>
            </div>
          )}


          <TabsContent value="login" className="space-y-4 mt-4">
            {reauth === "1" && (
              <div role="status" className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3">
                <div>
                  <p className="font-semibold">Confirm it's you</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    To approve money or change admin roles, sign in again with Google. You'll come
                    straight back to where you were.
                  </p>
                </div>
                <Button type="button" onClick={google} disabled={loading} className="w-full h-11 gap-2">
                  <GoogleLogo />
                  Continue with Google
                </Button>
              </div>
            )}
            {existingEmail && (
              <div role="alert" className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3">
                <div>
                  <p className="font-semibold">You already have an account</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    <span className="font-semibold break-all">{existingEmail}</span> is already registered,
                    so we didn't send a new link. If you first joined with Google, continue with Google.
                    Otherwise log in below, or reset your password if you've forgotten it.
                  </p>
                </div>
                <Button type="button" onClick={google} disabled={loading} className="w-full h-11 gap-2">
                  <GoogleLogo />
                  Continue with Google
                </Button>
              </div>
            )}
            {unconfirmedEmail && (
              <div
                role="alert"
                className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3"
              >
                <div>
                  <p className="font-semibold">Confirm your email first</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Open the link we emailed to{" "}
                    <span className="font-semibold break-all">{unconfirmedEmail}</span>, then log
                    in. Can't find it? Check Spam/Junk, or send a new link.
                  </p>
                </div>
                <ResendConfirmation initialEmail={unconfirmedEmail} editable={false} />
              </div>
            )}
            <form onSubmit={login} className="space-y-3">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <PasswordInput id="password" value={password} onChange={setPassword} show={showPassword} onToggle={() => setShowPassword((v) => !v)} autoComplete="current-password" />
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Log in"}
              </Button>
            </form>
            <div className="rounded-xl border bg-card p-3 space-y-2">
              <Label htmlFor="resetEmail">Reset password</Label>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Input id="resetEmail" type="email" value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} placeholder="your@email.com" autoComplete="email" />
                <Button type="button" variant="outline" onClick={sendPasswordReset} disabled={resetLoading}>
                  {resetLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send"}
                </Button>
              </div>
            </div>
            <Divider />
            <Button type="button" variant="outline" onClick={google} disabled={loading} className="w-full gap-2">
              <GoogleLogo />
              Continue with Google
            </Button>
          </TabsContent>

          <TabsContent value="register" className="space-y-4 mt-4">
            <div>
              <Label>I am a…</Label>
              <RadioGroup value={role} onValueChange={(v) => setRole(v as "customer" | "driver")} className="grid grid-cols-2 gap-2 mt-1">
                <RoleCard value="customer" label="Customer" hint="I need deliveries" current={role} />
                <RoleCard value="driver" label="Driver" hint="I own a tipper" current={role} />
              </RadioGroup>
            </div>
            <div>
              <Label htmlFor="fn">Full name</Label>
              <Input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={80} />
            </div>

            <form onSubmit={register} className="space-y-3">
                <div>
                  <Label htmlFor="localPhone">Phone (optional)</Label>
                  <div className="grid grid-cols-[140px_1fr] gap-2">
                    <CountryCodeSelect
                      value={countryAlpha2}
                      onChange={(c) => {
                        setCountryAlpha2(c.code);
                        setCountryDialCode(c.dial_code);
                      }}
                    />
                    <Input
                      id="localPhone"
                      value={localPhone}
                      onChange={(e) => setLocalPhone(e.target.value.replace(/\D/g, ""))}
                      type="tel"
                      maxLength={15}
                      placeholder="771234567"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="em">Email</Label>
                  <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                </div>
                <div>
                  <Label htmlFor="pw">Password</Label>
                  <PasswordInput id="pw" value={password} onChange={setPassword} show={showPassword} onToggle={() => setShowPassword((v) => !v)} autoComplete="new-password" minLength={8} />
                  <p className="text-[11px] text-muted-foreground mt-1">Minimum 8 characters.</p>
                </div>
                <div>
                  <Label htmlFor="refcode">Referral code (optional)</Label>
                  <Input
                    id="refcode"
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                    placeholder="CONZ-AB123"
                    maxLength={20}
                  />
                </div>
                <label className="flex items-start gap-3 py-1 text-sm text-muted-foreground select-none">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--cz-text)]"
                    required
                  />
                  <span>
                    I agree to the{" "}
                    <Link to="/terms" target="_blank" className="underline text-foreground">Terms and Conditions</Link>{" "}
                    and{" "}
                    <Link to="/privacy" target="_blank" className="underline text-foreground">Privacy Policy</Link>.
                  </span>
                </label>
                <Button type="submit" disabled={loading || !acceptedTerms} className="w-full">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create account"}
                </Button>
              </form>
            <Divider />
            <Button type="button" variant="outline" onClick={google} disabled={loading} className="w-full gap-2">
              <GoogleLogo />
              Continue with Google
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              {role === "driver"
                ? "With Google, you'll go straight to the driver application to add your truck and documents."
                : "One tap with your Google account. No confirmation email needed."}
            </p>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.9-2.26 5.36-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function RoleCard({ value, label, hint, current }: { value: "customer" | "driver"; label: string; hint: string; current: string }) {
  const active = current === value;
  return (
    <label className={`flex flex-col items-start gap-1 rounded-xl border p-3 cursor-pointer transition ${active ? "border-foreground bg-muted shadow-[inset_0_0_0_1px_var(--cz-text)]" : "border-border hover:bg-muted/50"}`}>
      <div className="flex items-center gap-2">
        <RadioGroupItem value={value} id={value} />
        <span className="font-semibold">{label}</span>
      </div>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </label>
  );
}

function PasswordInput({ id, value, onChange, show, onToggle, autoComplete, minLength }: { id: string; value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void; autoComplete: string; minLength?: number }) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        minLength={minLength}
        autoComplete={autoComplete}
        className="pr-10"
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function Divider() {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center"><div className="w-full border-t" /></div>
      <div className="relative flex justify-center"><span className="bg-background px-2 text-xs text-muted-foreground">or</span></div>
    </div>
  );
}

function CountryCodeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (country: (typeof COUNTRY_CODES)[number]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = COUNTRY_CODES.find((c) => c.code === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          // A combobox takes no name from its text, so name it explicitly.
          aria-label={`Country code: ${selected ? `${selected.name} ${selected.dial_code}` : "not chosen"}`}
          className="w-full justify-between px-2 font-normal"
        >
          {selected ? `${selected.name} ${selected.dial_code}` : "Select code"}
          <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0">
        <Command>
          <CommandInput placeholder="Search country..." />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {COUNTRY_CODES.map((country) => (
                <CommandItem
                  key={country.code}
                  value={`${country.name} ${country.dial_code}`}
                  onSelect={() => {
                    onChange(country);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === country.code ? "opacity-100" : "opacity-0")} />
                  {country.name} <span className="ml-auto text-muted-foreground">{country.dial_code}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
