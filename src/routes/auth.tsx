import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

const searchSchema = z.object({ mode: z.enum(["login", "register"]).optional() });

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: searchSchema,
  component: AuthPage,
});

function AuthPage() {
  const { mode } = Route.useSearch();
  const nav = useNavigate();
  const [tab, setTab] = useState<"login" | "register">(mode ?? "login");

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) nav({ to: "/home", replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) nav({ to: "/home", replace: true });
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [nav]);
  const [loading, setLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  // shared
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // register
  const [role, setRole] = useState<"customer" | "driver">("customer");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    nav({ to: "/home", replace: true });
  };

  const sendPasswordReset = async () => {
    const target = (resetEmail || email).trim();
    if (!target) return toast.error("Enter your email first");
    setResetLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(target, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Password reset link sent. Check your email.");
  };

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return toast.error("Please enter your full name");
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/oauth-callback`,
        data: { full_name: fullName, phone, role },
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Welcome to Con Z!");
    nav({ to: "/home", replace: true });
  };

  const google = async () => {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: `${window.location.origin}/oauth-callback` });
    if (result.error) {
      setLoading(false);
      return toast.error("Google sign-in failed");
    }
    if (result.redirected) return;
    nav({ to: "/home", replace: true });
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

          <TabsContent value="login" className="space-y-4 mt-4">
            <form onSubmit={login} className="space-y-3">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
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
                <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
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

function Divider() {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center"><div className="w-full border-t" /></div>
      <div className="relative flex justify-center"><span className="bg-background px-2 text-[11px] uppercase tracking-widest text-muted-foreground">or</span></div>
    </div>
  );
}
