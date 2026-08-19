import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { LifeBuoy, Mail, Phone, MessageSquareWarning, Compass, RotateCcw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTour } from "@/components/GuidedTourProvider";
import { customerTour } from "@/lib/tour/customer-tour";
import { driverTour } from "@/lib/tour/driver-tour";
import type { TourConfig } from "@/lib/tour/types";

export const Route = createFileRoute("/_authenticated/help")({
  component: HelpPage,
});

type FaqItem = { q: string; a: string };
type FaqSection = { title: string; items: FaqItem[] };

const SECTIONS: FaqSection[] = [
  {
    title: "Booking & delivery",
    items: [
      {
        q: "How do I post a delivery job?",
        a: "From the customer home screen tap 'Book delivery' and follow the steps: material & quantity, pickup & drop-off, then confirm.",
      },
      {
        q: "How does driver matching work?",
        a: "When you post a job, verified drivers nearby get a short-window offer. The first driver to accept wins the job — you can also propose a counter-offer on any bid before accepting.",
      },
      {
        q: "How do I cancel a job?",
        a: "Open the job and tap 'Cancel job'. Cancelling after a driver has already accepted may result in a strike on your account.",
      },
      {
        q: "Can I book the same driver again?",
        a: "Yes — on any completed job, tap 'Book this driver again'. It pre-fills your booking and lets that driver bid first.",
      },
      {
        q: "How does live tracking work?",
        a: "Once a driver accepts, you can watch their real-time location on the map, plus a 'Navigate with Google Maps' shortcut to the delivery address.",
      },
      {
        q: "Can I share the tracking link with someone else?",
        a: "Yes — on any active job, tap 'Share live tracking link'. It opens your phone's normal share options (or copies the link) so you can send it anywhere. Anyone you send it to can watch the truck move in real time — no Con Z account or login needed on their end.",
      },
    ],
  },
  {
    title: "Payments",
    items: [
      {
        q: "How does paying the driver directly work?",
        a: "This is the default option. You pay the driver yourself — cash or EcoCash — once delivery is complete, arranged directly between you. Con Z is not part of that payment.",
      },
      {
        q: "What is Con Z Pay?",
        a: "An optional way to pay through Con Z instead of the driver directly. You pay upfront through Paynow, Con Z holds the money, and it's released to the driver (minus commission) only once you confirm delivery. Good for paying on someone else's behalf — for example, sending money to a family member's delivery from abroad.",
      },
      {
        q: "With Con Z Pay, what happens if I never confirm delivery?",
        a: "If you don't confirm and no dispute is raised, the held payment automatically releases to the driver 72 hours after they mark the delivery complete — so a driver who genuinely delivered isn't left waiting indefinitely.",
      },
      {
        q: "How do I get paid as a driver?",
        a: "Depends on how the customer paid: for direct-pay jobs, they pay you directly and Con Z's commission is deducted from your wallet on completion. For Con Z Pay jobs, the payout (minus commission) lands directly in your wallet once delivery is confirmed. Your first job is always commission-free.",
      },
      {
        q: "How do I top up my wallet?",
        a: "Open Wallet → Add funds → choose EcoCash / OneMoney / ZIPIT / bank and follow the prompts. Top-ups are instant once confirmed.",
      },
      {
        q: "Where's my receipt?",
        a: "On any completed job, tap 'View your receipt' — you can also download a PDF copy with the price, photos, and delivery details for your own records.",
      },
    ],
  },
  {
    title: "Drivers & levels",
    items: [
      {
        q: "What are driver levels (Bronze/Silver/Gold/Platinum)?",
        a: "Levels track your completed jobs and rating. Higher levels get a real commission discount — up to 20% off at Platinum — automatically applied on every completed job.",
      },
      {
        q: "My verification is taking long — what should I do?",
        a: "Most drivers are approved within 24 hours. If it's been longer, use 'Report an issue' below and we'll follow up.",
      },
      {
        q: "Do I need to upload transport compliance documents?",
        a: "It's optional but recommended — drivers with an Operator's Licence, Certificate of Fitness, insurance, and ZINARA registration on file get priority consideration and are better protected if ever asked for proof.",
      },
      {
        q: "What does the 'Verified' badge on a driver mean?",
        a: "It means that driver's ID, licence, and truck photo have been checked and approved by Con Z admins, and their verification is current (re-checked every 90 days). Customers see this badge on bids so they know who they're dealing with before accepting.",
      },
    ],
  },
  {
    title: "Trust & safety",
    items: [
      {
        q: "Why does Con Z ask for notification and location access when I first sign up?",
        a: "Location lets nearby drivers find your job (or lets customers see you on the way, if you're a driver) and powers live tracking. Notifications keep you updated on bids, messages, and delivery status even when the app isn't open. You can grant these at signup or later from your phone's app settings.",
      },
      {
        q: "What happens if something goes wrong with a delivery?",
        a: "Raise a dispute from the job page. Admins review the evidence — pickup/delivery photos, GPS, and the chat history — and decide an outcome, which can include a refund, a strike, or another resolution.",
      },
      {
        q: "Is my chat with the other party private?",
        a: "Yes — only you, the other party, and Con Z admins (for dispute investigation only) can see it. Messages can't be edited or deleted once sent, so it stays a reliable record if something needs to be reviewed.",
      },
      {
        q: "Can I still get notified if I'm not using the app right now?",
        a: "Yes — turn on notifications from the dashboard prompt to get alerted about new jobs, messages, and payments even with Con Z closed.",
      },
      {
        q: "How do I delete my account?",
        a: "Go to Profile → Delete my account. This permanently removes your personal information; job and payment records are kept for legal and dispute purposes.",
      },
    ],
  },
];

function HelpPage() {
  const { is } = useAuth();

  return (
    <AppShell title="Help & support">
      <div className="space-y-6 max-w-2xl mx-auto">
        <section className="rounded-2xl bg-gradient-dark text-white p-5">
          <LifeBuoy className="w-8 h-8 text-primary" />
          <h1 className="font-display font-bold text-2xl mt-2">Need a hand?</h1>
          <p className="text-sm text-white/70 mt-1">Check the FAQ below or reach us directly.</p>
        </section>

        {(is("customer") || is("driver")) && (
          <section className="space-y-2">
            <h2 className="font-display font-bold uppercase tracking-wide text-sm">How to use Con Z</h2>
            <div className="space-y-2">
              {is("customer") && <TourEntryCard config={customerTour} label="Customer walkthrough" />}
              {is("driver") && <TourEntryCard config={driverTour} label="Driver walkthrough" />}
            </div>
          </section>
        )}

        {SECTIONS.map((section) => (
          <section key={section.title} className="space-y-2">
            <h2 className="font-display font-bold uppercase tracking-wide text-sm">{section.title}</h2>
            <div className="divide-y rounded-2xl border bg-card">
              {section.items.map((f) => (
                <details key={f.q} className="p-4 group">
                  <summary className="font-semibold cursor-pointer flex justify-between items-center gap-3">
                    <span>{f.q}</span>
                    <span className="text-muted-foreground group-open:rotate-45 transition shrink-0">+</span>
                  </summary>
                  <p className="text-sm text-muted-foreground mt-2">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        ))}

        <section className="grid gap-3">
          <a href="mailto:support@conz.co.zw" className="flex items-center gap-3 rounded-2xl border bg-card p-4 hover:bg-muted transition">
            <Mail className="w-5 h-5 text-primary" />
            <div>
              <div className="font-semibold">Email support</div>
              <div className="text-xs text-muted-foreground">support@conz.co.zw — we usually reply within a day.</div>
            </div>
          </a>
          <a href="tel:+263777770557" className="flex items-center gap-3 rounded-2xl border bg-card p-4 hover:bg-muted transition">
            <Phone className="w-5 h-5 text-primary" />
            <div>
              <div className="font-semibold">Call support</div>
              <div className="text-xs text-muted-foreground">+263 77 777 0557</div>
            </div>
          </a>
          <Link to="/report" search={{jobId: undefined}} className="flex items-center gap-3 rounded-2xl border bg-card p-4 hover:bg-muted transition">
            <MessageSquareWarning className="w-5 h-5 text-primary" />
            <div>
              <div className="font-semibold">Report an issue</div>
              <div className="text-xs text-muted-foreground">Something wrong with a job, driver, or the app? Let admins know.</div>
            </div>
          </Link>
        </section>
      </div>
    </AppShell>
  );
}

function TourEntryCard({ config, label }: { config: TourConfig; label: string }) {
  const { startTour, progress } = useTour();
  const saved = progress[config.key];

  const buttonLabel = saved?.status === "in_progress" ? "Continue" : saved ? "Restart" : "Start";
  const hint =
    saved?.status === "completed"
      ? "Completed — tap to go through it again."
      : saved?.status === "in_progress"
        ? `Paused at step ${saved.current_step_index + 1} of ${config.steps.length}.`
        : saved?.status === "skipped"
          ? "Skipped — tap to start it."
          : `${config.steps.length} quick steps through the real app.`;

  return (
    <button
      type="button"
      onClick={() => startTour(config, { resume: true })}
      aria-label={`${buttonLabel} ${label}`}
      className="w-full flex items-center gap-3 rounded-2xl border bg-card p-4 text-left hover:bg-muted transition"
    >
      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
        {saved?.status === "in_progress" ? <RotateCcw className="w-5 h-5" /> : <Compass className="w-5 h-5" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <span className="shrink-0 inline-flex items-center justify-center rounded-md border px-3 h-8 text-xs font-medium">
        {buttonLabel}
      </span>
    </button>
  );
}
