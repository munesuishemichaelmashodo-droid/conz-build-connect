import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Check, Mail, Phone, Truck } from "lucide-react";
import { MATERIALS } from "@/lib/domain";
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

// The materials customers can pick when booking (same list as the booking form).
const MATERIAL_GROUPS = ["Sand", "Aggregates", "Soil"].map((group) => ({
  group,
  items: MATERIALS.filter((m) => m.group === group).map((m, i) =>
    i === 0 ? m.label.charAt(0) + m.label.slice(1).toLowerCase() : m.label.toLowerCase(),
  ),
}));

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
              className="aspect-[720/437] w-full rounded-[20px] object-cover"
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

          <section aria-labelledby="materials-title" className="mt-10">
            <h2 id="materials-title" className="cz-display font-bold text-[24px]">
              What we deliver
            </h2>
            <dl className="mt-3 divide-y divide-cz-border border-y border-cz-border">
              {MATERIAL_GROUPS.map((g) => (
                <div key={g.group} className="flex items-baseline gap-4 py-3">
                  <dt className="w-24 shrink-0 text-sm text-cz-muted">{g.group}</dt>
                  <dd className="text-[15px] font-semibold leading-relaxed">{g.items.join(", ")}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2.5 text-sm text-cz-muted">Need something else? Describe it when you book.</p>
          </section>

          <section aria-labelledby="how-title" className="mt-10">
            <h2 id="how-title" className="cz-display font-bold text-[24px]">
              How it works
            </h2>
            <ol className="mt-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative flex gap-4 pb-6 last:pb-0">
                  {i < STEPS.length - 1 && (
                    // The route between steps, like the road the load travels.
                    <span
                      aria-hidden
                      className="absolute left-[17px] top-10 bottom-1 border-l-2 border-dashed border-cz-amber/50"
                    />
                  )}
                  <span
                    aria-hidden
                    className="cz-display relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cz-amber text-[19px] font-bold text-cz-amber-ink"
                  >
                    {i + 1}
                  </span>
                  <div className="pt-1">
                    <h3 className="font-semibold text-[17px] leading-snug">{s.title}</h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-cz-muted">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section
            aria-labelledby="driver-title"
            className="mt-10 rounded-[20px] border border-cz-border bg-cz-surface p-5"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cz-amber-tint text-cz-amber">
                <Truck className="h-5 w-5" aria-hidden />
              </span>
              <h2 id="driver-title" className="cz-display font-bold text-[24px] leading-tight">
                Own a tipper truck?
              </h2>
            </div>
            <p className="mt-3 text-[15px] leading-relaxed text-cz-muted">
              Find loads near you and offer your own price. You can start bidding once Con Z has
              checked your:
            </p>
            <ul className="mt-3 grid grid-cols-3 gap-2">
              {["ID", "Driver's licence", "Truck"].map((t) => (
                <li
                  key={t}
                  className="flex flex-col items-start gap-1.5 rounded-xl bg-cz-surface-2 px-3 py-2.5 text-sm font-semibold"
                >
                  <Check className="h-4 w-4 text-cz-amber" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
            <Link
              to="/auth"
              search={{ mode: "register", role: "driver" } as never}
              className={czButtonClass("secondary", "md", "mt-4")}
            >
              Sign up as a driver
            </Link>
          </section>
        </main>

        <footer className="mt-10 border-t border-cz-border pt-7 text-sm">
          <div className="flex items-center gap-2.5">
            <img src="/conz-icon-192.png" alt="" width={32} height={32} className="h-8 w-8 rounded-[8px]" />
            <span className="cz-display font-bold text-[18px] tracking-wide">CON Z</span>
          </div>
          <p className="mt-2 text-cz-muted">Founded in Zimbabwe, built for the construction industry.</p>

          <h2 className="mt-6 text-[13px] font-semibold text-cz-text">Talk to us</h2>
          <ul className="mt-2 divide-y divide-cz-border overflow-hidden rounded-2xl border border-cz-border bg-cz-surface">
            <li>
              <a href="tel:+263777770557" className="flex min-h-14 items-center gap-3 px-4 hover:bg-cz-surface-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cz-amber-tint text-cz-amber">
                  <Phone className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs text-cz-muted">Call</span>
                  <span className="block font-semibold text-cz-text">+263 77 777 0557</span>
                </span>
              </a>
            </li>
            <li>
              <a href="mailto:navyskyinnovations@gmail.com" className="flex min-h-14 items-center gap-3 px-4 hover:bg-cz-surface-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cz-amber-tint text-cz-amber">
                  <Mail className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs text-cz-muted">Email</span>
                  <span className="block break-all font-semibold text-cz-text">navyskyinnovations@gmail.com</span>
                </span>
              </a>
            </li>
          </ul>

          <nav aria-label="Legal" className="mt-4 flex gap-5">
            <Link to="/terms" className="inline-flex min-h-11 items-center font-semibold text-cz-text underline underline-offset-4">
              Terms
            </Link>
            <Link to="/privacy" className="inline-flex min-h-11 items-center font-semibold text-cz-text underline underline-offset-4">
              Privacy
            </Link>
          </nav>

          <p className="mt-2 text-xs leading-relaxed text-cz-faint">
            Con Z is operated by Navysky Innovations (Private) Limited, Zimbabwe.
            <br />© {new Date().getFullYear()} Navysky Innovations (Private) Limited.
          </p>
        </footer>
      </div>
    </div>
  );
}
