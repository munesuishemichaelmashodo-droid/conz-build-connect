import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import {
  BadgeCheck,
  Camera,
  Check,
  FileText,
  KeyRound,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Repeat,
  Star,
  Tag,
  Truck,
} from "lucide-react";
import { MATERIALS } from "@/lib/domain";
import { supabase } from "@/integrations/supabase/client";
import { czButtonClass } from "@/components/redesign";
import { MaterialThumb } from "@/components/ds/media";

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

// Every statement on this page describes something the product does today. No statistics,
// reviews or driver names are invented; sample offers are labelled as illustrations.

const STEPS = [
  {
    title: "Post one request",
    body: "Material, load size and delivery point, entered once instead of repeated to each driver.",
  },
  {
    title: "Verified drivers make offers",
    body: "Drivers checked by Con Z set their own price and say which truck they would use.",
  },
  {
    title: "You compare and choose",
    body: "See each total, truck size, rating and jobs done, then pick the driver you want.",
  },
  {
    title: "Proof stays on the job",
    body: "Messages, delivery photos and your delivery code stay together on the job record.",
  },
];

// Illustration only: shows the layout of the real offer comparison, not real drivers.
const SAMPLE_OFFERS = [
  { name: "Driver A", price: "$210", truck: "15 m³ truck", record: "4.8 rating · 23 jobs" },
  { name: "Driver B", price: "$195", truck: "10 m³ truck", record: "No ratings yet" },
  { name: "Driver C", price: "$225", truck: "20 m³ truck", record: "4.6 rating · 9 jobs" },
];

const TRUST_GROUPS = [
  {
    title: "Know the driver",
    icon: BadgeCheck,
    rows: [
      ["Identity checked", "Con Z checks a driver's ID before they can send offers."],
      ["Licence checked", "The driver's licence is reviewed as part of verification."],
      ["Truck on record", "Registration and capacity are shown with every offer."],
      ["Ratings and jobs", "Completed jobs and customer ratings show on offers once earned."],
    ],
  },
  {
    title: "Know the deal",
    icon: Tag,
    rows: [
      ["Price in view", "Every offer shows the total before you accept it."],
      ["Job chat", "Messages stay on the job, in the app, so nothing is lost in old threads."],
    ],
  },
  {
    title: "Keep the record",
    icon: FileText,
    rows: [
      [
        "Location sharing",
        "See the truck on the map while the driver's phone is sharing its location.",
      ],
      ["Delivery photos", "Pickup and delivery photos are saved to the job."],
      ["Delivery code", "Delivery is confirmed with your own one-time code."],
    ],
  },
];

const REPEAT_STEPS = [
  ["Reuse a past delivery", "Material, load size and address carry over."],
  ["Fresh price check", "The price is checked again every time."],
  ["Invite a driver you liked", "They are asked to send an offer."],
  ["Others can still compete", "Any verified driver can send an offer too."],
  ["You decide", "Nobody is assigned for you."],
];

const MATERIAL_TILES = MATERIALS.filter((m) => ["Sand", "Aggregates", "Soil"].includes(m.group));

const STEP_ICONS = [MapPin, Truck, Star, Camera];

const DRIVER_POINTS = [
  "See the material, load size and delivery area before you offer.",
  "Set the price that makes sense for your truck.",
  "Customers see your verified status and truck on your offers.",
  "Completed jobs and ratings build a record on your offers.",
  "Requests arrive in one organised place; you choose which to price.",
];

function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mx-auto w-full max-w-[1180px] px-5 md:px-8 ${className}`}>{children}</div>
  );
}

function SectionHead({ id, title, lead }: { id: string; title: string; lead?: string }) {
  return (
    <div className="mx-auto max-w-[680px] text-center">
      <span aria-hidden className="mx-auto mb-4 block h-1 w-12 rounded-full bg-cz-amber" />
      <h2 id={id} className="cz-display text-[32px] font-bold leading-[1.05] md:text-[46px]">
        {title}
      </h2>
      {lead && <p className="mt-3 text-[16px] leading-relaxed text-cz-muted">{lead}</p>}
    </div>
  );
}

function Welcome() {
  useRedirectWhenSignedIn();
  const bookHref = { mode: "register", next: "/customer/book" } as never;
  return (
    // `dark` switches the cz-* tokens to the charcoal palette for this page only.
    <div className="dark cz-screen min-h-[100dvh] w-full overflow-x-clip bg-cz-bg text-cz-text">
      <header className="sticky top-0 z-20 border-b border-cz-border bg-cz-bg/90 backdrop-blur">
        <Container className="flex items-center justify-between gap-3 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <img
              src="/conz-icon-192.png"
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 rounded-[10px]"
            />
            <div className="min-w-0 leading-none">
              <div className="cz-display text-[22px] font-bold tracking-wide">CON Z</div>
              <div className="mt-0.5 text-[11px] text-cz-muted">Construction made easy</div>
            </div>
          </div>
          <nav aria-label="Main" className="flex items-center gap-1">
            <a
              href="#drivers"
              className="hidden min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-cz-muted hover:text-cz-text sm:inline-flex"
            >
              For drivers
            </a>
            <Link
              to="/auth"
              search={{ mode: "login" } as never}
              className="inline-flex min-h-11 items-center rounded-xl border border-cz-border-strong px-4 text-sm font-semibold text-cz-text hover:bg-cz-surface"
            >
              Log in
            </Link>
          </nav>
        </Container>
      </header>

      <main>
        {/* A. Hero */}
        <section
          aria-labelledby="hero-title"
          className="relative overflow-hidden pb-12 pt-10 md:pb-24 md:pt-20"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[900px] -translate-x-1/2 rounded-full bg-cz-amber/10 blur-3xl"
          />
          <Container className="relative grid gap-10 md:grid-cols-[1.05fr_0.95fr] md:items-center md:gap-14">
            <div className="text-center md:text-left">
              <h1
                id="hero-title"
                className="cz-display text-[44px] font-bold leading-[0.98] md:text-[72px]"
              >
                Get your construction delivery organised in one place.
              </h1>
              <p className="mx-auto mt-4 max-w-[520px] text-[17px] leading-relaxed text-cz-muted md:mx-0">
                Choose your material, enter your quantity and delivery location, then compare offers
                from checked tipper drivers before choosing the arrangement that works for your
                project.
              </p>
              <div className="mx-auto mt-7 flex max-w-[420px] flex-col gap-2.5 md:mx-0">
                <Link to="/quote" className={czButtonClass("primary")}>
                  Check delivery price
                </Link>
                <Link to="/auth" search={bookHref} className={czButtonClass("secondary", "md")}>
                  Book a delivery
                </Link>
                <p className="text-[13px] text-cz-muted">
                  No account needed to check a price. Drivers set their own prices and you choose.
                </p>
              </div>
            </div>
            <div className="relative">
              <div
                aria-hidden
                className="absolute -inset-2 rounded-[28px] bg-gradient-to-br from-cz-amber/40 via-transparent to-transparent"
              />
              <img
                src="/hero-tipper-1024.webp"
                srcSet="/hero-tipper-720.webp 720w, /hero-tipper-1024.webp 1024w"
                sizes="(min-width: 768px) 45vw, 100vw"
                alt="An orange tipper truck tipping its load at a building site"
                width={1024}
                height={622}
                fetchPriority="high"
                className="relative aspect-[16/10] w-full rounded-3xl object-cover shadow-2xl md:aspect-[4/3]"
              />
            </div>
          </Container>
        </section>

        {/* B. How the marketplace works, with an illustrative offer comparison */}
        <section
          aria-labelledby="how-title"
          className="border-t border-cz-border bg-cz-bg-deep py-16 md:py-24"
        >
          <Container>
            <SectionHead
              id="how-title"
              title="One request. Several offers. Your choice."
              lead="Instead of calling driver after driver and keeping track of separate chats, you describe the delivery once and compare what comes back."
            />
            <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((st, i) => {
                const Icon = STEP_ICONS[i];
                return (
                  <li
                    key={st.title}
                    className="relative rounded-2xl border border-cz-border bg-cz-surface p-6 text-center"
                  >
                    <span className="absolute -top-3 left-1/2 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full bg-cz-amber text-[13px] font-bold text-cz-amber-ink">
                      {i + 1}
                    </span>
                    <span className="mx-auto mt-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-cz-amber/15 text-cz-amber">
                      <Icon className="h-7 w-7" aria-hidden />
                    </span>
                    <h3 className="mt-4 text-[18px] font-semibold leading-snug">{st.title}</h3>
                    <p className="mt-1.5 text-[14px] leading-relaxed text-cz-muted">{st.body}</p>
                  </li>
                );
              })}
            </ol>

            <figure
              aria-label="Illustrative offer comparison"
              className="mx-auto mt-14 max-w-[620px]"
            >
              <div className="overflow-hidden rounded-2xl border border-cz-border-strong bg-cz-surface shadow-xl">
                <div className="flex items-baseline justify-between gap-3 bg-cz-surface-2 px-5 py-3.5">
                  <span className="text-sm font-semibold">Offers on your request</span>
                  <span className="text-xs text-cz-muted">12 m³ river sand</span>
                </div>
                <ul className="divide-y divide-cz-border">
                  {SAMPLE_OFFERS.map((o) => (
                    <li key={o.name} className="flex items-center justify-between gap-3 px-5 py-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[15px] font-semibold">
                          {o.name}
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-cz-green-text">
                            <Check className="h-3.5 w-3.5" aria-hidden /> Verified
                          </span>
                        </div>
                        <div className="text-[13px] text-cz-muted">
                          {o.truck} · {o.record}
                        </div>
                      </div>
                      <div className="cz-display text-[32px] font-bold tabular-nums">{o.price}</div>
                    </li>
                  ))}
                </ul>
              </div>
              <figcaption className="mt-3 text-center text-xs text-cz-faint">
                Illustrative example only. These are not real drivers or prices. Real offers show
                each driver's own price, truck and record.
              </figcaption>
            </figure>
          </Container>
        </section>

        {/* C. Trust and accountability */}
        <section aria-labelledby="trust-title" className="border-t border-cz-border py-16 md:py-24">
          <Container>
            <SectionHead
              id="trust-title"
              title="Know who you're choosing. Keep the delivery record."
              lead="Each of these is something the app does today, and each one is there for a practical reason."
            />
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {TRUST_GROUPS.map((g) => (
                <div
                  key={g.title}
                  className="rounded-2xl border border-cz-border bg-cz-surface p-6"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cz-amber/15 text-cz-amber">
                      <g.icon className="h-6 w-6" aria-hidden />
                    </span>
                    <h3 className="cz-display text-[26px] font-bold">{g.title}</h3>
                  </div>
                  <ul className="mt-4 space-y-4">
                    {g.rows.map(([k, v]) => (
                      <li key={k} className="flex gap-3">
                        <Check className="mt-1 h-4 w-4 shrink-0 text-cz-amber" aria-hidden />
                        <div>
                          <div className="text-[15px] font-semibold">{k}</div>
                          <div className="text-[14px] leading-relaxed text-cz-muted">{v}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mx-auto mt-8 max-w-[720px] text-center text-sm leading-relaxed text-cz-muted">
              Verification checks documents; it is not a promise of how a delivery will go. Location
              appears on the map only while the driver shares it.
            </p>
          </Container>
        </section>

        {/* D. Repeat customers */}
        <section
          aria-labelledby="repeat-title"
          className="border-t border-cz-border bg-cz-bg-deep py-16 md:py-24"
        >
          <Container>
            <SectionHead
              id="repeat-title"
              title="Your next delivery shouldn't start from scratch."
              lead="After your first completed delivery, ordering again takes a few taps."
            />
            <div className="mt-12 grid items-center gap-10 md:grid-cols-2 md:gap-14">
              <ul className="space-y-3">
                {REPEAT_STEPS.map(([k, v]) => (
                  <li
                    key={k}
                    className="flex items-start gap-4 rounded-xl border border-cz-border bg-cz-surface px-4 py-3.5"
                  >
                    <Repeat className="mt-0.5 h-5 w-5 shrink-0 text-cz-amber" aria-hidden />
                    <div>
                      <div className="text-[15px] font-semibold">{k}</div>
                      <div className="text-[14px] leading-relaxed text-cz-muted">{v}</div>
                    </div>
                  </li>
                ))}
              </ul>
              <figure aria-label="Illustrative repeat-order card">
                <div className="rounded-2xl border border-cz-border-strong bg-cz-surface p-6 shadow-xl">
                  <div className="text-sm font-semibold">Need the same again?</div>
                  <p className="mt-2 text-[15px] leading-relaxed text-cz-muted">
                    12 m³ river sand to your last delivery address. The price is checked fresh each
                    time.
                  </p>
                  <div className="mt-5 space-y-2.5">
                    <div className="flex min-h-12 items-center justify-center rounded-xl bg-cz-amber px-3 text-center text-[15px] font-semibold text-cz-amber-ink">
                      Order this delivery again
                    </div>
                    <div className="flex min-h-12 items-center justify-center rounded-xl border border-cz-border-strong px-3 text-center text-[15px] font-semibold">
                      Order again and invite your previous driver to bid
                    </div>
                  </div>
                  <p className="mt-4 text-xs leading-relaxed text-cz-faint">
                    An invitation only tells that driver about the request. Other verified drivers
                    can still send offers, and you choose.
                  </p>
                </div>
                <figcaption className="mt-3 text-center text-xs text-cz-faint">
                  Illustration of the card shown on your home screen after a completed delivery.
                </figcaption>
              </figure>
            </div>
          </Container>
        </section>

        {/* E. Materials */}
        <section
          aria-labelledby="materials-title"
          className="border-t border-cz-border py-16 md:py-24"
        >
          <Container>
            <SectionHead
              id="materials-title"
              title="What we deliver"
              lead="Need something else? Describe it when you book."
            />
            <ul className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4 md:gap-4">
              {MATERIAL_TILES.map((m) => (
                <li
                  key={m.value}
                  className="flex flex-col items-center gap-3 rounded-2xl border border-cz-border bg-cz-surface px-3 py-5 text-center"
                >
                  <MaterialThumb material={m.value} size={44} className="rounded-xl" />
                  <span className="text-[15px] font-semibold">{m.label}</span>
                  <span className="-mt-2 text-xs text-cz-muted">{m.group}</span>
                </li>
              ))}
            </ul>
          </Container>
        </section>

        {/* F. Drivers */}
        <section
          id="drivers"
          aria-labelledby="driver-title"
          className="border-t border-cz-border bg-cz-bg-deep py-16 md:py-24"
        >
          <Container>
            <SectionHead
              id="driver-title"
              title="Put your tipper truck to work."
              lead="Browse delivery requests, review the load and route, and send an offer that works for your truck and business."
            />
            <div className="mt-12 grid gap-5 md:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-2xl border border-cz-border bg-cz-surface p-6 md:p-8">
                <ul className="space-y-4">
                  {DRIVER_POINTS.map((pt) => (
                    <li key={pt} className="flex gap-3 text-[15px] leading-relaxed">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cz-amber/15 text-cz-amber">
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-sm leading-relaxed text-cz-muted">
                  You can start offering once Con Z has checked your ID, driver's licence and truck.
                  Con Z doesn't promise a volume of jobs: you choose which requests to price.
                </p>
              </div>
              <div className="rounded-2xl border border-cz-amber/50 bg-gradient-to-b from-cz-amber/15 to-cz-surface p-6 md:p-8">
                <h3 className="cz-display text-[28px] font-bold">What Con Z charges</h3>
                <p className="mt-3 text-[17px] leading-relaxed">
                  7% commission on eligible job value, including materials and transport. Your first
                  completed job is commission-free.
                </p>
                <p className="mt-3 text-[14px] leading-relaxed text-cz-muted">
                  The commission is reserved from your Con Z credit when a customer accepts your
                  offer, and taken once delivery is verified. Customers pay you directly; Con Z does
                  not collect or hold their payment.
                </p>
                <div className="mt-6 flex flex-col gap-2.5">
                  <Link
                    to="/auth"
                    search={{ mode: "register", role: "driver" } as never}
                    className={czButtonClass("primary", "md")}
                  >
                    Register as a driver
                  </Link>
                  <Link to="/open-jobs" className={czButtonClass("secondary", "md")}>
                    See open delivery requests
                  </Link>
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* G. Final conversion */}
        <section aria-labelledby="final-title" className="border-t border-cz-border py-16 md:py-24">
          <Container>
            <div className="relative overflow-hidden rounded-3xl border border-cz-amber/40 bg-gradient-to-br from-cz-amber/20 via-cz-surface to-cz-surface px-6 py-12 text-center md:py-16">
              <h2
                id="final-title"
                className="cz-display mx-auto max-w-[640px] text-[36px] font-bold leading-[1.05] md:text-[52px]"
              >
                Know the likely price before you commit.
              </h2>
              <p className="mx-auto mt-3 max-w-[480px] text-[16px] text-cz-muted">
                It takes a minute and needs no account. Drivers then set their own offers.
              </p>
              <div className="mx-auto mt-7 flex w-full max-w-[360px] flex-col gap-2.5">
                <Link to="/quote" className={czButtonClass("primary")}>
                  Check delivery price
                </Link>
                <Link to="/auth" search={bookHref} className={czButtonClass("secondary", "md")}>
                  Book a delivery
                </Link>
              </div>
            </div>
          </Container>
        </section>
      </main>

      {/* H. Footer */}
      <footer className="border-t border-cz-border bg-cz-bg-deep">
        <Container className="grid gap-8 py-12 text-center md:grid-cols-[1.2fr_1fr_auto] md:gap-12 md:text-left">
          <div>
            <div className="flex items-center justify-center gap-2.5 md:justify-start">
              <img
                src="/conz-icon-192.png"
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 rounded-[8px]"
              />
              <span className="cz-display text-[20px] font-bold tracking-wide">CON Z</span>
            </div>
            <p className="mt-2 text-sm text-cz-muted">
              Founded in Zimbabwe, built for the construction industry.
            </p>
            <p className="mt-4 text-xs leading-relaxed text-cz-faint">
              Con Z is operated by Navysky Innovations (Private) Limited, Zimbabwe.
              <br />© {new Date().getFullYear()} Navysky Innovations (Private) Limited.
            </p>
          </div>

          <div>
            <h2 className="text-[13px] font-semibold">Talk to us</h2>
            <ul className="mt-3 space-y-2">
              <li>
                <a
                  href="tel:+263777770557"
                  className="flex min-h-12 items-center justify-center gap-3 rounded-xl border border-cz-border bg-cz-surface px-4 hover:border-cz-amber md:justify-start"
                >
                  <Phone className="h-4 w-4 text-cz-amber" aria-hidden />
                  <span className="font-semibold">+263 77 777 0557</span>
                </a>
              </li>
              <li>
                <a
                  href="mailto:navyskyinnovations@gmail.com"
                  className="flex min-h-12 items-center justify-center gap-3 rounded-xl border border-cz-border bg-cz-surface px-4 hover:border-cz-amber md:justify-start"
                >
                  <Mail className="h-4 w-4 shrink-0 text-cz-amber" aria-hidden />
                  <span className="break-all text-[14px] font-semibold">
                    navyskyinnovations@gmail.com
                  </span>
                </a>
              </li>
            </ul>
          </div>

          <nav aria-label="Legal" className="flex justify-center gap-6 md:flex-col md:gap-0">
            <Link
              to="/terms"
              className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
            >
              Terms
            </Link>
            <Link
              to="/privacy"
              className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
            >
              Privacy
            </Link>
          </nav>
        </Container>
      </footer>
    </div>
  );
}
