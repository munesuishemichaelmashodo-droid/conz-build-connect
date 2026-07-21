import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ArrowLeft, Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

const searchSchema = z.object({
  mode: z.enum(["login", "register"]).optional(),
  next: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: searchSchema,
  component: AuthPage,
});

function AuthPage() {
  const { mode, next } = Route.useSearch();
  const nav = useNavigate();
  const [tab, setTab] = useState<"login" | "register">(mode ?? "login");

  // Only allow same-origin relative paths.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const goPostAuth = () => {
    if (safeNext) {
      window.location.replace(safeNext);
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
  const [role, setRole] = useState<"customer" | "driver">("customer");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

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
    setAuthDebug(info);
    // eslint-disable-next-line no-console
    console.error("[auth]", info, err);
    toast.error(`${stage} failed: ${info.message}`);
  };

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthDebug(null);
    setLoading(true);
    const endpoint = `${supabaseUrl}/auth/v1/token?grant_type=password`;
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) {
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
    setAuthDebug(null);
    setLoading(true);
    const endpoint = `${supabaseUrl}/auth/v1/signup`;
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/oauth-callback`,
          data: { full_name: fullName, phone, role },
        },
      });
      setLoading(false);
      if (error) return reportAuthError("Sign-up", error, endpoint);
      toast.success("Welcome to Con Z!");
      goPostAuth();
    } catch (err) {
      setLoading(false);
      reportAuthError("Sign-up (network)", err, endpoint);
    }
  };

  const google = async () => {
    setAuthDebug(null);
    setLoading(true);
    const endpoint = `${supabaseUrl}/auth/v1/authorize?provider=google`;
    const isCancellation = (m: string) =>
      /cancel/i.test(m) || /closed/i.test(m) || /popup/i.test(m) || /dismiss/i.test(m);
    try {
      if (safeNext) {
        try {
          sessionStorage.setItem("conz.postAuthNext", safeNext);
        } catch {
          /* ignore */
        }
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
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-screen-sm px-5 py-6">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        <div className="mt-6 flex items-center gap-3">
          <img
            src="/conz-logo.png"
            alt="CON Z"
            className="w-10 h-10 rounded-lg object-cover"
            width={40}
            height={40}
          />
          <div>
            <h1 className="font-display font-bold text-2xl uppercase tracking-tight leading-none">Con Z</h1>
            <div className="text-xs text-muted-foreground uppercase tracking-widest">Construction Made Easy</div>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "register")} className="mt-6">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="register">Register</TabsTrigger>
          </TabsList>

          {authDebug && (
            <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-destructive uppercase tracking-wide">
                  {authDebug.stage} error
                </div>
                <button
                  type="button"
                  onClick={() => setAuthDebug(null)}
                  className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
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
            <form onSubmit={login} className="space-y-3">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <PasswordInput id="password" value={password} onChange={setPassword} show={showPassword} onToggle={() => setShowPassword((v) => !v)} autoComplete="current-password" />
              </div>
              <Button type="submit" disabled={loading} className="w-full h-11 font-display uppercase tracking-wide">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Login"}
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
            <Button type="button" variant="outline" onClick={google} disabled={loading} className="w-full h-11">
              Continue with Google
            </Button>
          </TabsContent>

          <TabsContent value="register" className="space-y-4 mt-4">
            <form onSubmit={register} className="space-y-3">
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
              <div>
                <Label htmlFor="ph">Phone (optional)</Label>
                <Input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" maxLength={20} placeholder="+263 …" />
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
              <Button type="submit" disabled={loading} className="w-full h-11 font-display uppercase tracking-wide">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create account"}
              </Button>
            </form>
            <Divider />
            <Button type="button" variant="outline" onClick={google} disabled={loading} className="w-full h-11">
              Continue with Google
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">
              Google sign-up creates a Customer account. Switch to a Driver account from your profile.
            </p>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function RoleCard({ value, label, hint, current }: { value: "customer" | "driver"; label: string; hint: string; current: string }) {
  const active = current === value;
  return (
    <label className={`flex flex-col items-start gap-1 rounded-xl border p-3 cursor-pointer transition ${active ? "border-primary bg-accent" : "border-border hover:bg-muted/50"}`}>
      <div className="flex items-center gap-2">
        <RadioGroupItem value={value} id={value} />
        <span className="font-semibold">{label}</span>
      </div>
      <span className="text-[11px] text-muted-foreground">{hint}</span>
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
      <div className="relative flex justify-center"><span className="bg-background px-2 text-[11px] uppercase tracking-widest text-muted-foreground">or</span></div>
    </div>
  );
}
