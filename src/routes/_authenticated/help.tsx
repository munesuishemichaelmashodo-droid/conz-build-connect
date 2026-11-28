import { createFileRoute, Link } from "@tanstack/react-router";
import { useTransportPricingEnabled } from "@/lib/transport-pricing";
import { promoCopy, usePromoCredit } from "@/lib/promo-credit";
import { commissionCopy } from "@/lib/commission-copy";
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
        a: "When you post a request, verified drivers can see it and send you offers with their own price. You compare the offers, prices, ratings and trucks, and you choose; nothing is assigned automatically. You can also propose a counter-offer on any bid before accepting.",
      },
      {
        q: "How do I cancel a job?",
        a: "Open the job and tap 'Cancel job'. Cancelling after a driver has already accepted may result in a strike on your account.",
      },
      {
        q: "Can I book the same driver again?",
        a: "You can invite them to bid again. On a completed job, tap 'Invite this driver to bid again'. It pre-fills your booking and notifies that driver, but other verified drivers can bid too, the price is quoted fresh, and the driver is not assigned automatically — you choose.",
      },
      {
        q: "How does live tracking work?",
        a: "Once a driver accepts and starts the trip, the map shows the truck's location while the driver's phone is sharing it, with the job's progress steps. If the driver's location is not available, you still see the job's status.",
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
        q: "How do I pay for a delivery?",
        a: "You pay your assigned driver directly, using the method you both agree in the job's agreement (for example cash, EcoCash, OneMoney, InnBucks, ZIPIT or bank transfer). The driver sets out who to pay, the number or account, and whether a deposit is needed and when. Check those details before sending money. Con Z does not receive or hold this money and cannot get it back for you.",
      },
      {
        q: "Does the driver need a deposit?",
        a: "Only if the agreement says so. Some drivers ask for a deposit, for example to buy the material at the quarry. The agreement shows the deposit, when it is due, why, and what happens if the job is cancelled. You pay the deposit and the balance directly to the driver; Con Z cannot refund either.",
      },
      {
        q: "How do I record that I paid?",
        a: "Open the job and record each payment (deposit, balance or full payment) with the amount, method and any reference. The driver is asked to confirm receipt, and you can then agree with their confirmation. These are your own and the driver's statements: Con Z keeps them as a record, but they are not independent proof that a transfer settled.",
      },
      {
        q: "What if the driver does not confirm my payment, or asks me to pay someone else?",
        a: "Message the driver in the job chat first. If the payment details change unexpectedly, someone asks you to pay a different person or outside the agreement, or the driver will not confirm money you sent, report it from the job page. Admins can see the agreement, both payment statements, the chat and the delivery evidence.",
      },
      {
        q: "How do invitations (referrals) work?",
        a: "Open Invite to get your own link and code, and send it on WhatsApp or any other app. Customer invitations count once the person you invited completes their first delivery on Con Z. Driver invitations count once the driver you invited is verified and has completed five deliveries. After a short check you get recognition: milestones at 1, 5, 10, 25 and 50 counted invitations, kept separately for customers and drivers you invited, and shown on your profile. Recognition is not money, Commission Credit or a discount, and it does not change which jobs anyone is offered.",
      },
      {
        q: "How does Con Z earn money?",
        a: "Con Z charges the driver a 7% commission on the agreed job value (materials and transport together). For a $400 job that is $28. Customers pay nothing extra to Con Z.",
      },
      {
        q: "Drivers: what is ConZ Commission Credit?",
        a: "Prepaid credit that drivers top up to pay Con Z's commission. When a customer accepts your offer, the 7% commission is reserved from your available commission credit; it is charged once when the delivery is verified as complete, and returned once if the job is cancelled. If your available credit is too low you cannot accept the job. Commission credit is not your earnings and cannot be withdrawn.",
      },
      {
        q: "Drivers: how do I top up my commission credit?",
        a: "Open Commission Credit, tap Add funds and pay through Paynow. The credit becomes available once Paynow confirms the payment, which is usually quick but can take longer. If it still shows as pending, open Commission Credit again to re-check it. Each top-up has a Paynow reference and a receipt.",
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
        a: "Levels recognise your completed jobs and rating. The Con Z commission is the same flat rate at every level — levels do not change what you pay.",
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
        a: "Raise a dispute from the job page. Admins review the evidence — pickup/delivery photos, GPS, and the chat history — and decide an outcome, such as a warning, a strike or another resolution. Con Z cannot refund money you paid directly to a driver.",
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
  const transportOn = useTransportPricingEnabled();
  const promo = usePromoCredit();
  const { is } = useAuth();

  return (
    <AppShell title="Help & support">
      <div className="space-y-6 max-w-2xl mx-auto">
        <section className="rounded-2xl dark bg-gradient-dark text-white p-5">
          <LifeBuoy className="w-8 h-8 text-cz-amber-text" />
          <h2 className="font-display font-bold text-2xl mt-2">Need a hand?</h2>
          <p className="text-sm text-white/70 mt-1">Check the FAQ below or reach us directly.</p>
        </section>

        {(is("customer") || is("driver")) && (
          <section className="space-y-2">
            <h2 className="font-semibold text-sm">How to use Con Z</h2>
            <div className="space-y-2">
              {is("customer") && (
                <TourEntryCard config={customerTour} label="Customer walkthrough" />
              )}
              {is("driver") && <TourEntryCard config={driverTour} label="Driver walkthrough" />}
            </div>
          </section>
        )}

        {SECTIONS.map((section) => (
          <section key={section.title} className="space-y-2">
            <h2 className="font-semibold text-sm">{section.title}</h2>
            <div className="divide-y rounded-2xl border bg-card">
              {section.items.map((f) => (
                <details key={f.q} className="p-4 group">
                  <summary className="font-semibold cursor-pointer flex min-h-11 justify-between items-center gap-3">
                    <span>{f.q}</span>
                    <span className="text-muted-foreground group-open:rotate-45 transition shrink-0">
                      +
                    </span>
                  </summary>
                  <p className="text-sm text-muted-foreground mt-2">{promoCopy(commissionCopy(f.a, transportOn), promo)}</p>
                </details>
              ))}
            </div>
          </section>
        ))}

        <section className="grid gap-3">
          <a
            href="mailto:navyskyinnovations@gmail.com"
            className="flex items-center gap-3 rounded-2xl border bg-card p-4 hover:bg-muted transition"
          >
            <Mail className="w-5 h-5 text-cz-amber-text" />
            <div>
              <div className="font-semibold">Email support</div>
              <div className="text-xs text-muted-foreground">
                navyskyinnovations@gmail.com — we usually reply within a day.
              </div>
            </div>
          </a>
          <a
            href="tel:+263777770557"
            className="flex items-center gap-3 rounded-2xl border bg-card p-4 hover:bg-muted transition"
          >
            <Phone className="w-5 h-5 text-cz-amber-text" />
            <div>
              <div className="font-semibold">Call support</div>
              <div className="text-xs text-muted-foreground">+263 77 777 0557</div>
            </div>
          </a>
          <Link
            to="/report"
            search={{ jobId: undefined, category: undefined }}
            className="flex items-center gap-3 rounded-2xl border bg-card p-4 hover:bg-muted transition"
          >
            <MessageSquareWarning className="w-5 h-5 text-cz-amber-text" />
            <div>
              <div className="font-semibold">Report an issue</div>
              <div className="text-xs text-muted-foreground">
                Something wrong with a job, driver, or the app? Let admins know.
              </div>
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
      <div className="w-10 h-10 rounded-xl bg-primary/10 text-cz-amber-text flex items-center justify-center shrink-0">
        {saved?.status === "in_progress" ? (
          <RotateCcw className="w-5 h-5" />
        ) : (
          <Compass className="w-5 h-5" />
        )}
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
