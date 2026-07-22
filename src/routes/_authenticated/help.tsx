import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { LifeBuoy, Mail, MessageSquareWarning } from "lucide-react";

export const Route = createFileRoute("/_authenticated/help")({
  component: HelpPage,
});

const FAQ = [
  { q: "How do I post a delivery job?", a: "From the customer home screen tap 'Book delivery' and follow the 3 steps: material & quantity, pickup & drop-off, then confirm." },
  { q: "How does driver matching work?", a: "When you post a job, verified drivers nearby get a 10-second offer. The first driver to accept wins the job." },
  { q: "How do I get paid as a driver?", a: "Customers pay you on delivery. Con Z takes a small commission (see wallet). Your first job is commission-free." },
  { q: "How do I top up my wallet?", a: "Open Wallet → Add funds → choose EcoCash / OneMoney / ZIPIT / bank and follow the prompts. Top-ups are instant." },
  { q: "My verification is taking long — what should I do?", a: "Most drivers are approved within 24 hours. If it's been longer, use the Report option in the side menu and we'll follow up." },
  { q: "How do I cancel a job?", a: "Open the job and tap 'Cancel job'. Cancelling after a driver accepts may result in a strike on your account." },
];

function HelpPage() {
  return (
    <AppShell title="Help & support">
      <div className="space-y-6 max-w-2xl mx-auto">
        <section className="rounded-2xl bg-gradient-dark text-white p-5">
          <LifeBuoy className="w-8 h-8 text-primary" />
          <h1 className="font-display font-bold text-2xl mt-2">Need a hand?</h1>
          <p className="text-sm text-white/70 mt-1">Check the FAQ below or reach us directly.</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display font-bold uppercase tracking-wide text-sm">Frequently asked</h2>
          <div className="divide-y rounded-2xl border bg-card">
            {FAQ.map((f) => (
              <details key={f.q} className="p-4 group">
                <summary className="font-semibold cursor-pointer flex justify-between items-center">
                  <span>{f.q}</span>
                  <span className="text-muted-foreground group-open:rotate-45 transition">+</span>
                </summary>
                <p className="text-sm text-muted-foreground mt-2">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="grid gap-3">
          <a href="mailto:support@conz.co.zw" className="flex items-center gap-3 rounded-2xl border bg-card p-4 hover:bg-muted transition">
            <Mail className="w-5 h-5 text-primary" />
            <div>
              <div className="font-semibold">Email support</div>
              <div className="text-xs text-muted-foreground">support@conz.co.zw — we usually reply within a day.</div>
            </div>
          </a>
          <Link to="/report" className="flex items-center gap-3 rounded-2xl border bg-card p-4 hover:bg-muted transition">
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
