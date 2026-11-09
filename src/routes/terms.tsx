import { createFileRoute, Link } from "@tanstack/react-router";
import { useTransportPricingEnabled } from "@/lib/transport-pricing";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms and Conditions — Con Z" },
      { name: "description", content: "Terms and Conditions governing use of the Con Z Build Connect construction logistics marketplace." },
      { property: "og:title", content: "Terms and Conditions — Con Z" },
      { property: "og:description", content: "Terms and Conditions governing use of the Con Z Build Connect construction logistics marketplace." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  const transportOn = useTransportPricingEnabled();
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-5 py-8">
        <Link to="/" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-foreground hover:bg-muted">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        <header className="mt-6 mb-8">
          <div className="text-xs text-muted-foreground">Con Z Build Connect</div>
          <h1 className="font-display font-bold text-3xl tracking-tight">Terms and Conditions</h1>
          <p className="text-xs text-muted-foreground mt-2">Last updated: 3 November 2026</p>
        </header>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <Section title="1. About Con Z Build Connect">
            <p>
              Con Z Build Connect ("Con Z") is operated by Navysky Innovations (Private) Limited, a company
              registered in Zimbabwe (company number 145174A02102026; ZIMRA tax identification
              number (TIN) 2002683072) with its registered
              office at 12705 Timire Park, Ruwa. It operates a construction
              logistics marketplace that connects customers requiring bulk material
              deliveries with independent tipper truck drivers ("Drivers").
            </p>
          </Section>

          <Section title="2. Acceptance of Terms">
            <p>
              By creating an account, accessing, or using the Con Z platform (the "Platform"), you
              agree to be bound by these Terms and Conditions and our Privacy Policy. If you do not
              agree, you must not use the Platform.
            </p>
          </Section>

          <Section title="3. User Eligibility">
            <p>You must be at least 18 years old and legally capable of entering binding contracts. Drivers must additionally hold a valid Zimbabwean driver's licence appropriate for a tipper truck and complete verification before accepting jobs.</p>
          </Section>

          <Section title="4. The Platform as an Intermediary">
            <p>
              Con Z acts solely as an intermediary connecting Customers and Drivers. Con Z is not a
              party to the delivery contract formed between a Customer and a Driver, is not a
              transport or freight operator, and does not itself own, operate, or dispatch vehicles.
            </p>
          </Section>

          <Section title="5. Account Responsibilities">
            <ul className="list-disc pl-5 space-y-1">
              <li>You are responsible for maintaining the confidentiality of your login credentials and withdrawal PIN.</li>
              <li>You are responsible for all activity that occurs under your account.</li>
              <li>You must provide accurate, current information and keep it updated.</li>
            </ul>
          </Section>

          <Section title="6. Commission and Wallet">
            <p>
              Registering, verification, browsing jobs and sending offers are free for Drivers. Con Z
              charges a flat platform commission of <b>7%</b> of{" "}
              {transportOn
                ? "the agreed delivery fare. Where a job is priced for delivery only, the material is arranged separately between the Customer and the supplier or Driver and is not part of the fare or the commission"
                : "the full job price, including materials and transport"}
              . When a Customer selects a Driver, Con Z reserves the
              commission for that job from the Driver's wallet credit. The reservation is confirmed
              against the job, it is not a fee for browsing or offering, and it is released if the job
              is cancelled before the load is collected. The commission is earned when the delivery
              is verified (see section 8). The first completed job for each newly verified Driver is
              exempt from commission under the first-job-free policy.
            </p>
            <p>
              Wallet top-ups, balances and withdrawals are governed by the in-app Wallet and its
              security controls (including the withdrawal PIN and lockout logic). Money reserved for
              commission cannot be withdrawn. Top-up and withdrawal methods may be limited or
              unavailable while the Platform is launching, and are shown in the Wallet when open.
            </p>
          </Section>

          <Section title="7. Payments Between Customer and Driver">
            <p>
              Unless the app shows that the Customer is paying through Con Z at checkout, the
              Customer pays the Driver directly for the materials and delivery. In that case
              Con Z does not receive, hold or guarantee the Customer's money, is not an escrow
              provider, and does not guarantee any refund. Any deposit or advance payment is agreed
              directly between the Customer and the Driver, and Con Z is not responsible for it. If a
              payment through Con Z is offered, the terms shown at that checkout apply as well.
            </p>
          </Section>

          <Section title="8. Delivery Verification">
            <p>
              A delivery counts as complete only after the Driver uploads a delivery photo and the
              Customer's one-time delivery code is entered. Commission, referral rewards and points
              are based on verified deliveries, not on a Driver marking a job complete.
            </p>
          </Section>

          <Section title="9. Cargo Liability">
            <p>
              The Driver assumes full responsibility for the safe custody and transport of cargo from
              the point of loading to the point of delivery, and is <b>liable to the Customer for
              damage to or loss of cargo</b> occurring during that period. Con Z will mediate
              cargo-related disputes through the in-app dispute system but <b>is not itself liable</b>
              for any loss of, damage to, or delay in the delivery of cargo.
            </p>
          </Section>

          <Section title="10. Prohibited Conduct">
            <ul className="list-disc pl-5 space-y-1">
              <li>Using the Platform for anything unlawful, fraudulent, or misleading.</li>
              <li>Attempting to circumvent the platform's commission, for example by taking a job found through Con Z off the platform, sharing contact details to do so, or arranging repeat deliveries outside Con Z to avoid commission.</li>
              <li>Harassing, threatening, or discriminating against other users.</li>
              <li>Uploading false verification documents or impersonating another person.</li>
              <li>Interfering with the operation or security of the Platform.</li>
            </ul>
          </Section>

          <Section title="11. Ratings, Referrals and Points">
            <p>
              Customers and Drivers may rate each other after a delivery; ratings must be honest.
              Referral rewards are paid only for qualifying activity (such as a referred person's
              verified completed delivery), once, and Con Z may withhold or reverse rewards obtained
              by self-referral, duplicate accounts or other abuse. If Con Z points are offered, they
              are rewards with no cash value, cannot be transferred or withdrawn, do not change any
              price or commission, and may be adjusted or reversed by Con Z where awarded in error or
              by abuse. Reward values and eligibility may change.
            </p>
          </Section>

          <Section title="12. Dispute Resolution">
            <p>
              Disagreements between Customers and Drivers (including cancellations, cargo damage, and
              service quality) must first be raised through the in-app dispute system. Con Z will
              review submissions and may issue strikes, restrictions, or refunds through the wallet
              at its reasonable discretion, in line with the strike and restriction policy already
              enforced by the platform.
            </p>
          </Section>

          <Section title="13. Account Suspension and Termination">
            <p>
              Con Z may suspend, restrict, or terminate any account for breach of these Terms,
              accumulated strikes under the cancellation and dispute policy, safety concerns, or
              suspected fraud. You may also close your own account at any time; commissions and
              obligations accrued before closure remain payable.
            </p>
          </Section>

          <Section title="14. Limitation of Liability">
            <p>
              To the maximum extent permitted by Zimbabwean law, Con Z is not liable for any indirect,
              incidental, special, consequential, or punitive damages, or for any loss of profit,
              revenue, data, or business opportunity, arising out of or in connection with your use
              of the Platform. Nothing in these Terms limits liability that cannot be excluded by
              law.
            </p>
          </Section>

          <Section title="15. Changes to These Terms">
            <p>
              We may update these Terms from time to time. Material changes will be brought to your
              attention through the Platform. Continued use after changes take effect constitutes
              acceptance of the revised Terms.
            </p>
          </Section>

          <Section title="16. Governing Law">
            <p>
              These Terms are governed by the laws of the Republic of Zimbabwe. The courts of
              Zimbabwe have exclusive jurisdiction over any dispute arising out of or in connection
              with these Terms or the Platform.
            </p>
          </Section>

          <Section title="17. Contact">
            <p>
              For questions about these Terms, you can reach us at{" "}
              <b>navyskyinnovations@gmail.com</b> or <b>+263 77 777 0557</b>.
            </p>
          </Section>

          <p className="pt-6 text-xs text-muted-foreground">
            See also our <Link to="/privacy" className="underline">Privacy Policy</Link>.
          </p>
          <p className="pt-2 text-[11px] text-muted-foreground">
            © {new Date().getFullYear()} Navysky Innovations (Private) Limited, trading as Con Z. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display font-bold text-base">{title}</h2>
      <div className="text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}
