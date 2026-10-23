import { createFileRoute, Link } from "@tanstack/react-router";
import { LogoLockup } from "@/components/ds";
import { QuickPrice } from "@/components/QuickPrice";

export const Route = createFileRoute("/quote")({
  ssr: false,
  component: PublicQuotePage,
});

// Same price check as the homepage (one component, one pricing path).
function PublicQuotePage() {
  return (
    <div className="cz-screen min-h-[100dvh] w-full bg-cz-bg text-cz-text">
      <div className="mx-auto w-full max-w-[520px] px-4 pb-10">
        <header className="flex items-center justify-between gap-2 py-3">
          <LogoLockup />
          <Link
            to="/auth"
            search={{ mode: "login" } as never}
            className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-cz-text hover:bg-cz-surface-2"
          >
            Log in
          </Link>
        </header>
        <main className="pt-2">
          <QuickPrice titleAs="h1" />
        </main>
      </div>
    </div>
  );
}
