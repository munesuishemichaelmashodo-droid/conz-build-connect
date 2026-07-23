import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Con Z" },
      { name: "description", content: "How Con Z Connect collects, uses, and stores your data on the construction logistics marketplace." },
      { property: "og:title", content: "Privacy Policy — Con Z" },
      { property: "og:description", content: "How Con Z Connect collects, uses, and stores your data on the construction logistics marketplace." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-5 py-8">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        <header className="mt-6 mb-8">
          <div className="text-xs text-muted-foreground uppercase tracking-widest">Con Z Connect</div>
          <h1 className="font-display font-bold text-3xl uppercase tracking-tight">Privacy Policy</h1>
          <p className="text-xs text-muted-foreground mt-2">Last updated: 23 July 2026</p>
        </header>

        <div className="space-y-6">
          <Section title="1. Who We Are">
            <p>
              Con Z Connect ("Con Z", "we") is a Zimbabwean company [Company Registration Number]
              that operates the Con Z construction logistics marketplace. This policy explains what
              personal data we collect through the app, how we use it, and how we protect it.
            </p>
          </Section>

          <Section title="2. Information We Collect">
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <b>Account information</b> — your full name, email address, phone number, and account
                role (customer, driver, admin) stored in your user profile.
              </li>
              <li>
                <b>Driver verification documents</b> — a selfie, a photo of your driver's licence, a
                photo of your tipper truck, and your declared nationality. These are stored in the
                private <code>driver-docs</code> storage bucket.
              </li>
              <li>
                <b>Location and GPS data</b> — while you have an active job, your device shares live
                location to power route tracking and ETA. Locations are stored in the
                <code> driver_locations</code> table and automatically pruned after 24 hours. You can
                stop sharing at any time using the in-app privacy toggle.
              </li>
              <li>
                <b>Job and delivery data</b> — pickup and drop-off addresses, cargo type and quantity,
                bids, prices, proof-of-delivery photos, ratings, messages between the customer and
                driver, and dispute records.
              </li>
              <li>
                <b>Wallet and payment data</b> — wallet balances, top-up requests, withdrawal
                requests, transaction history, and a hashed withdrawal PIN. We do <b>not</b> store
                raw card numbers on our servers.
              </li>
              <li>
                <b>Device and log data</b> — basic technical logs (e.g. authentication events, error
                reports) used to keep the service secure and reliable.
              </li>
            </ul>
          </Section>

          <Section title="3. How We Use Your Information">
            <ul className="list-disc pl-5 space-y-1">
              <li>To create and manage your account, and to verify drivers.</li>
              <li>To match customers with nearby verified drivers and to display live tracking and ETA.</li>
              <li>To calculate suggested pricing, commission, and wallet balances.</li>
              <li>To operate in-app messaging, notifications, ratings, and disputes.</li>
              <li>To detect fraud, abuse, and safety issues, and to enforce our Terms.</li>
              <li>To comply with applicable Zimbabwean law.</li>
            </ul>
          </Section>

          <Section title="4. Sharing">
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <b>Between customers and drivers</b> — once a bid is accepted, limited profile
                information, live location, and messages are shared between the two parties for that
                job.
              </li>
              <li>
                <b>Con Z administrators</b> — may access verification documents, disputes, and audit
                logs strictly to run the platform.
              </li>
              <li>
                <b>Service providers</b> — we use trusted infrastructure providers to host the
                database, storage, and mapping. They act on our instructions and are bound by
                confidentiality.
              </li>
              <li>
                <b>Legal</b> — we may disclose data where required by law or lawful authority.
              </li>
            </ul>
            <p className="pt-2">We do not sell your personal data.</p>
          </Section>

          <Section title="5. Retention">
            <p>
              We retain profile, job, wallet and dispute records for as long as your account is
              active and for a reasonable period afterward to meet legal, accounting, and dispute
              obligations. Live location records are automatically deleted after 24 hours.
            </p>
          </Section>

          <Section title="6. Security">
            <p>
              Access to your data is protected by row-level security policies in our database,
              private storage buckets for verification documents, and hashed credentials for
              sensitive fields such as the withdrawal PIN. No system is perfectly secure — please
              keep your login credentials and PIN confidential.
            </p>
          </Section>

          <Section title="7. Your Choices">
            <ul className="list-disc pl-5 space-y-1">
              <li>Update your profile details at any time from the Profile page.</li>
              <li>Toggle live location sharing on or off from the Location Privacy panel.</li>
              <li>Request account deletion by contacting us — some records may be retained where required.</li>
            </ul>
          </Section>

          <Section title="8. Children">
            <p>The Platform is not intended for anyone under 18. We do not knowingly collect data from children.</p>
          </Section>

          <Section title="9. Changes">
            <p>
              We may update this Privacy Policy from time to time. Material changes will be brought
              to your attention through the Platform.
            </p>
          </Section>

          <Section title="10. Contact">
            <p>
              For privacy questions or requests, contact us at <b>[contact email]</b> or
              <b> [company postal address]</b>, Zimbabwe.
            </p>
          </Section>

          <p className="pt-6 text-xs text-muted-foreground">
            See also our <Link to="/terms" className="underline">Terms and Conditions</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display font-bold uppercase tracking-wide text-base">{title}</h2>
      <div className="text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}
