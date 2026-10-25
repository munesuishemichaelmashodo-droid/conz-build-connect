import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { ArrowLeft, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResendConfirmation } from "@/components/ResendConfirmation";

const searchSchema = z.object({
  email: z.string().optional(),
});

export const Route = createFileRoute("/verify-email")({
  ssr: false,
  validateSearch: searchSchema,
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { email } = Route.useSearch();

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-screen-sm px-5 py-6">
        <Link to="/auth" search={{ mode: "login" } as never} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to login
        </Link>

        <div className="mt-10 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <MailCheck className="w-8 h-8 text-cz-amber-text" />
          </div>
          <p className="mt-6 text-sm text-muted-foreground">Verify your email</p>
          <h1 className="mt-2 font-display font-bold text-3xl tracking-tight leading-tight">
            You are almost there!
          </h1>
          <p className="mt-4 text-sm text-muted-foreground">
            We've sent a confirmation link to
          </p>
          <p className="font-semibold break-all">{email ?? "your email address"}</p>
        </div>

        <div className="mt-8 rounded-2xl bg-card border p-4 shadow-soft space-y-3 text-sm">
          <div className="flex gap-3">
            <span className="font-display font-bold text-cz-amber-text">1.</span>
            <span>
              Go to your <span className="font-semibold">mailbox</span> (check Spam/Junk too) and open the
              email we just sent you.
            </span>
          </div>
          <div className="flex gap-3">
            <span className="font-display font-bold text-cz-amber-text">2.</span>
            <span>
              Tap the <span className="font-semibold">link</span> to verify your account, then come back
              and log in.
            </span>
          </div>
        </div>

        <div className="mt-6">
          <p className="text-center text-sm text-muted-foreground mb-2">Haven't received it?</p>
          {/* Resend with a 60 s cooldown (audit A-4). Editable when we don't know the address. */}
          <ResendConfirmation initialEmail={email ?? ""} editable={!email} />
        </div>

        <Button asChild variant="outline" className="w-full h-11 mt-6">
          <Link to="/auth" search={{ mode: "login" } as never}>
            Go back and edit email
          </Link>
        </Button>
      </div>
    </div>
  );
}
