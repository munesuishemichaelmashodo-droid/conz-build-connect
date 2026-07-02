import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import heroTruck from "@/assets/hero-truck.jpg";
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

function Welcome() {
  return (
    <div className="min-h-screen bg-gradient-dark text-white">
      <div className="mx-auto max-w-screen-sm px-5 pt-10 pb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-primary flex items-center justify-center font-display font-bold shadow-lift">CZ</div>
          <div>
            <div className="font-display font-extrabold text-2xl tracking-tight leading-none">CON Z</div>
            <div className="text-xs text-white/70 uppercase tracking-widest">Construction Made Easy</div>
          </div>
        </div>

        <div className="mt-8 relative rounded-2xl overflow-hidden shadow-lift">
          <img src={heroTruck} alt="Tipper truck delivering sand at sunset" className="w-full h-64 object-cover" width={1280} height={720} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          <div className="absolute bottom-0 inset-x-0 p-5">
            <div className="h-1.5 w-16 stripe-orange rounded-full mb-3" />
            <h1 className="font-display font-bold text-3xl leading-tight">
              Sand. Stones. Soil.<br />
              <span className="text-primary">Delivered.</span>
            </h1>
            <p className="text-sm text-white/80 mt-2 max-w-xs">Zimbabwe's marketplace for tipper-truck deliveries — built for customers and drivers.</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-2">
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

        <div className="mt-8 space-y-3">
          <Link to="/auth" search={{ mode: "register" } as never} className="flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-gradient-primary font-display font-bold uppercase tracking-wider shadow-lift">
            Get started <ArrowRight className="w-4 h-4" />
          </Link>
          <Link to="/auth" search={{ mode: "login" } as never} className="flex items-center justify-center w-full h-12 rounded-xl bg-white/10 border border-white/15 font-display font-semibold uppercase tracking-wider">
            I already have an account
          </Link>
        </div>

        <p className="text-center text-[11px] text-white/50 mt-6">Founded in Zimbabwe • Built for the industry</p>
      </div>
    </div>
  );
}
