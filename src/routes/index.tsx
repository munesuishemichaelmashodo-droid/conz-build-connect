import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Mail, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { czButtonClass } from "@/components/redesign";

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

// Each step only states what the product does today: drivers are checked by an
// admin before they can bid, the customer sees every offer's total before
// accepting, and delivery is confirmed with the customer's delivery code.
const STEPS = [
  {
    title: "Post your job",
    body: "Pick the material, how many cubic metres, and drop a pin where the load should go.",
  },
  {
    title: "Choose a driver",
    body: "Drivers checked by Con Z send their offers. You see each total before you accept one.",
  },
  {
    title: "Track and confirm",
    body: "Follow the job as it moves, then give the driver your delivery code once the load is down.",
  },
];

function Welcome() {
  useRedirectWhenSignedIn();
  return (
    <div className="cz-screen min-h-[100dvh] w-full bg-cz-bg text-cz-text">
      <div className="mx-auto w-full max-w-[480px] px-5 pb-10">
        <header className="flex items-center justify-between gap-3 pt-4 pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/conz-icon-192.png" alt="" width={40} height={40} className="h-10 w-10 rounded-[10px]" />
            <div className="min-w-0 leading-none">
              <div className="cz-display font-bold text-[22px] tracking-wide">CON Z</div>
              <div className="text-[11px] text-cz-muted mt-0.5">Construction made easy</div>
            </div>
          </div>
          <Link
            to="/auth"
            search={{ mode: "login" } as never}
            className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-cz-text hover:bg-cz-surface"
          >
            Log in
          </Link>
        </header>

        <main>
          <section aria-labelledby="hero-title" className="pt-2">
            <img
              src="/landing-tipper.webp"
              alt="An orange tipper truck tipping its load at a building site"
              width={720}
              height={437}
              fetchPriority="high"
              className="aspect-[720/437] w-full rounded-2xl object-cover"
            />
            <h1 id="hero-title" className="cz-display font-bold text-[38px] leading-[1.02] mt-5">
              Sand, stones and quarry dust, delivered to your site.
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-cz-muted">
              Tell us what you need and where. Tipper drivers send you their prices, you pick one,
              and follow the load to your gate.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <Link
                to="/auth"
                search={{ mode: "register", next: "/customer/book" } as never}
                className={czButtonClass("primary")}
              >
                Book a delivery
              </Link>
              <Link to="/quote" className={czButtonClass("ghost", "md")}>
                Check a price, no account needed
              </Link>
            </div>
          </section>

          <section aria-labelledby="how-title" className="mt-10">
            <h2 id="how-title" className="cz-display font-bold text-[24px]">
              How it works
            </h2>
            <ol className="mt-3 flex flex-col gap-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-3.5">
                  <span
                    aria-hidden
                    className="cz-display mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cz-amber-tint text-[17px] font-bold text-cz-amber-text"
                  >
                    {i + 1}
                  </span>
                  <div>
                    <div className="font-semibold">{s.title}</div>
                    <p className="text-sm leading-relaxed text-cz-muted">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section
            aria-labelledby="driver-title"
            className="mt-10 rounded-2xl border border-cz-border bg-cz-surface p-5"
          >
            <h2 id="driver-title" className="cz-display font-bold text-[24px] leading-tight">
              Own a tipper truck?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-cz-muted">
              Find loads near you and offer your own price. You can bid once Con Z has checked your
              ID, licence and truck.
            </p>
            <Link
              to="/auth"
              search={{ mode: "register", role: "driver" } as never}
              className={czButtonClass("secondary", "md", "mt-4")}
            >
              Sign up as a driver
            </Link>
          </section>
        </main>

        <footer className="mt-10 border-t border-cz-border pt-6 text-sm text-cz-muted">
          <p className="text-cz-text font-semibold">Founded in Zimbabwe, built for the industry.</p>
          <ul className="mt-3 flex flex-col gap-1">
            <li>
              <a href="tel:+263777770557" className="inline-flex min-h-11 items-center gap-2 hover:text-cz-text">
                <Phone className="h-4 w-4" aria-hidden /> +263 77 777 0557
              </a>
            </li>
            <li>
              <a
                href="mailto:constructionz.zw@gmail.com"
                className="inline-flex min-h-11 items-center gap-2 break-all hover:text-cz-text"
              >
                <Mail className="h-4 w-4" aria-hidden /> constructionz.zw@gmail.com
              </a>
            </li>
          </ul>
          <div className="mt-3 flex gap-4">
            <Link to="/terms" className="inline-flex min-h-11 items-center underline underline-offset-2">
              Terms
            </Link>
            <Link to="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-2">
              Privacy
            </Link>
          </div>
          <p className="mt-2 text-xs text-cz-faint">
            © {new Date().getFullYear()} Con Z Connect (Pvt) Ltd. All rights reserved.
          </p>
        </footer>
      </div>
    </div>
  );
}
