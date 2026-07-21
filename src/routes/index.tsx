import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ArrowRight, ShieldCheck, Wallet, Truck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/home" });
  },
  component: Welcome,
});

function useRedirectWhenSignedIn() {
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) navigate({ to: "/home", replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) navigate({ to: "/home", replace: true });
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);
}

function Welcome() {
  useRedirectWhenSignedIn();
  return (
    <div className="min-h-screen bg-gradient-dark text-white flex flex-col">
      <div className="mx-auto max-w-screen-sm px-5 pt-12 pb-8 flex-1 flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-full max-w-[320px]">
            <img
              src="/conz-logo.png"
              alt="CON Z — Move More. Earn More."
              className="w-full h-auto"
              width={320}
              height={320}
            />
          </div>
        </div>

        <div className="mt-8 grid grid-cols-3 gap-2">
          {[
            { icon: Truck, label: "Real drivers" },
            { icon: ShieldCheck, label: "Verified" },
            { icon: Wallet, label: "AI-priced" },
          ].map(({ icon: I, label }) => (
            <div key={label} className="rounded-xl bg-white/5 border border-white/10 p-3 text-center">
              <I className="w-5 h-5 text-primary mx-auto" />
              <div className="text-[11px] mt-1 text-white/80">{label}</div>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-2xl bg-white/5 border border-white/10 p-4">
          <div className="font-display font-bold uppercase text-xs tracking-widest text-white/70 mb-3">How it works</div>
          <ol className="space-y-3">
            {[
              { n: "1", t: "Post a job", d: "Tell us what you need delivered and where." },
              { n: "2", t: "Get driver offers", d: "Verified drivers nearby send you bids in seconds." },
              { n: "3", t: "Track & pay", d: "Follow the truck live and pay when it arrives." },
            ].map((s) => (
              <li key={s.n} className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/40 text-primary font-display font-bold flex items-center justify-center shrink-0">{s.n}</div>
                <div>
                  <div className="font-semibold text-sm">{s.t}</div>
                  <div className="text-[12px] text-white/60">{s.d}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-8 space-y-3">
          <Link to="/auth" search={{ mode: "register" } as never} className="flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-gradient-primary font-display font-bold uppercase tracking-wider shadow-lift">
            Get started <ArrowRight className="w-4 h-4" />
          </Link>
          <Link to="/auth" search={{ mode: "login" } as never} className="flex items-center justify-center w-full h-12 rounded-xl bg-white/10 border border-white/15 font-display font-semibold uppercase tracking-wider">
            I already have an account
          </Link>
          <div className="text-center text-[12px] text-white/70">
            Driver?{" "}
            <Link to="/auth" search={{ mode: "register", role: "driver" } as never} className="text-primary font-semibold underline underline-offset-2">
              Sign up here
            </Link>
          </div>
        </div>

        <p className="text-center text-[11px] text-white/50 mt-6">Founded in Zimbabwe • Built for the industry</p>
      </div>
    </div>
  );
}
