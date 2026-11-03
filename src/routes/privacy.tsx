import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Con Z" },
      { name: "description", content: "How Con Z Build Connect collects, uses, and stores your data on the construction logistics marketplace." },
      { property: "og:title", content: "Privacy Policy — Con Z" },
      { property: "og:description", content: "How Con Z Build Connect collects, uses, and stores your data on the construction logistics marketplace." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-5 py-8">
        <Link to="/" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-foreground hover:bg-muted">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        <header className="mt-6 mb-8">
          <div className="text-xs text-muted-foreground">Con Z Build Connect</div>
          <h1 className="font-display font-bold text-3xl tracking-tight">Privacy Policy</h1>
          <p className="text-xs text-muted-foreground mt-2">Last updated: 14 October 2026</p>
        </header>

        <div className="space-y-6">
          <Section title="1. Who We Are">
            <p>
              Con Z Build Connect ("Con Z", "we") is operated by Navysky Innovations (Private) Limited, a company
              registered in Zimbabwe (company number 145174A02102026) with its registered
              office at 12705 Timire Park, Ruwa. This policy explains
              what personal data we collect through the app, how we use it, and how we
              protect it.
            </p>
          </Section>

          <Section title="2. Information We Collect">
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <b>Account information</b> — your full name, email address, phone number, and account
                role (customer, driver, admin) stored in your user profile.
              </li>
              <li>
                <b>Driver verification documents</b> — a selfie, your national ID number and a photo
                of your national ID, a photo of your driver's licence, your operator licence,
                certificate of fitness, insurance and ZINARA documents where required, your truck's
                registration number and photos of your tipper truck, and your declared nationality.
                These are stored in a private storage area that is not publicly accessible.
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
                reports), the IP address and device details recorded with wallet transactions and
                security events, push-notification tokens, and a device identifier used to detect
                referral abuse. We use these to keep the service secure and reliable and to prevent
                fraud.
              </li>
              <li>
                <b>Sign-in data</b> — if you sign in with Google, we receive your name and email
                address from Google.
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
                <b>Service providers</b> — we use trusted providers to host the database, storage
                and website, to process payments (Paynow), to provide sign-in (Google), to display
                maps and calculate routes, and to deliver push notifications. They act on our
                instructions and are bound by confidentiality.
              </li>
              <li>
                <b>Storage outside Zimbabwe</b> — our database and file storage are hosted in
                Switzerland and our website is hosted on servers outside Zimbabwe, so your data is
                processed outside Zimbabwe. We choose providers that protect data and we limit what
                is shared with them to what the service needs.
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
              active. Live location records are automatically deleted after 24 hours.
            </p>
            <p className="mt-2">
              When you delete your account we remove your name, phone number, e-mail address,
              profile photo, identity and vehicle documents, withdrawal PIN, saved devices, location
              history and the photos and voice notes you sent in chat, and we disable your login on
              every device. We keep financial and audit records (payments, wallet transactions,
              refunds and the administrative audit log) and the job records you shared with other
              users, without your personal details, because we are required to be able to account
              for every payment and to handle disputes.
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
              <li>
                Delete your account yourself from Profile → Delete account. Deletion waits until any
                money in your wallet has been withdrawn and your active jobs, payments and disputes are
                finished. You can also ask us to delete it for you.
              </li>
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
              For privacy questions or requests, you can reach us at{" "}
              <b>navyskyinnovations@gmail.com</b> or <b>+263 77 777 0557</b>
            </p>
          </Section>

          <p className="pt-6 text-xs text-muted-foreground">
            See also our <Link to="/terms" className="underline">Terms and Conditions</Link>.
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
