import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Mail, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { czButtonClass } from "@/components/redesign";
import { LogoLockup } from "@/components/ds";
import { QuickPrice } from "@/components/QuickPrice";

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
    title: "Check the price",
    body: "Pick the material, the load size and where it goes. You see an estimate before you sign up.",
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
      <div className="mx-auto w-full max-w-[1200px] px-4 pb-10 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-2 py-3">
          <LogoLockup />
          <nav aria-label="Account" className="flex items-center gap-1">
            <a
              href="#drivers"
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-cz-text hover:bg-cz-surface-2"
            >
              For drivers
            </a>
            <Link
              to="/auth"
              search={{ mode: "login" } as never}
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-cz-text hover:bg-cz-surface-2"
            >
              Log in
            </Link>
          </nav>
        </header>

        <main className="pt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:gap-x-16 lg:pt-12">
          <section aria-labelledby="hero-title" className="lg:col-start-1">
            <img
              src="/hero-tipper-720.webp"
              srcSet="/hero-tipper-720.webp 720w, /hero-tipper-1024.webp 1024w"
              sizes="(min-width: 1024px) 640px, calc(100vw - 32px)"
              alt="An orange tipper truck tipping its load at a building site"
              width={720}
              height={437}
              fetchPriority="high"
              className="aspect-[720/437] w-full rounded-2xl bg-cz-surface-2 object-cover"
            />
            <h1
              id="hero-title"
              className="cz-display mt-6 max-w-[11em] text-[40px] font-bold leading-[1.02] tracking-[-0.01em] sm:text-[50px] lg:mt-8 lg:text-[58px]"
            >
              Sand, stones and quarry dust, delivered to your site.
            </h1>
            <p className="mt-4 max-w-[52ch] text-[17px] leading-relaxed text-cz-muted">
              Tell us what you need and where. Tipper drivers checked by Con Z send you their
              prices, you pick one, and follow the load to your gate.
            </p>
          </section>

          <div className="mt-8 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:mt-0">
            <div className="lg:sticky lg:top-6">
              <QuickPrice />
            </div>
          </div>

          <section aria-labelledby="how-title" className="mt-14 lg:col-start-1 lg:mt-16">
            <h2 id="how-title" className="cz-display text-[24px] font-bold">
              How it works
            </h2>
            <ol className="mt-5 flex flex-col gap-6">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-3.5">
                  <span
                    aria-hidden
                    className="cz-display mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cz-amber-tint text-[17px] font-bold text-cz-amber-text"
                  >
                    {i + 1}
                  </span>
                  <div className="max-w-[56ch]">
                    <h3 className="font-semibold">{s.title}</h3>
                    <p className="text-sm leading-relaxed text-cz-muted">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section
            id="drivers"
            aria-labelledby="driver-title"
            className="mt-14 scroll-mt-4 rounded-2xl border border-cz-border bg-cz-surface p-5 lg:col-start-1 lg:mt-14 lg:max-w-[560px]"
          >
            <h2 id="driver-title" className="cz-display text-[24px] font-bold leading-tight">
              Own a tipper truck?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-cz-muted">
              Find loads near you and offer your own price. You can send offers once Con Z has
              checked your ID, licence and truck.
            </p>
            <div className="mt-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
              <Link
                to="/auth"
                search={{ mode: "register", role: "driver" } as never}
                className={czButtonClass("secondary", "md", "sm:w-auto sm:px-5")}
              >
                Sign up as a driver
              </Link>
              <Link
                to="/auth"
                search={{ mode: "login" } as never}
                className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-semibold text-cz-text underline underline-offset-4 hover:bg-cz-surface-2"
              >
                I already have an account
              </Link>
            </div>
          </section>
        </main>

        <footer className="mt-14 border-t border-cz-border pt-6 text-sm text-cz-muted">
          <p className="font-semibold text-cz-text">Founded in Zimbabwe, built for the industry.</p>
          <ul className="mt-3 flex flex-col gap-1 sm:flex-row sm:gap-6">
            <li>
              <a
                href="tel:+263777770557"
                className="inline-flex min-h-11 items-center gap-2 hover:text-cz-text"
              >
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
          <div className="mt-2 flex gap-2">
            <Link
              to="/terms"
              className="inline-flex min-h-11 items-center px-1 underline underline-offset-4"
            >
              Terms
            </Link>
            <Link
              to="/privacy"
              className="inline-flex min-h-11 items-center px-1 underline underline-offset-4"
            >
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
