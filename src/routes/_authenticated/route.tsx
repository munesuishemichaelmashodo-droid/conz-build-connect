import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { requireUser } from "@/lib/route-guards";
import { registerOfflineFallback } from "@/lib/offline-fallback";
import { JobOfferListener } from "@/components/JobOfferListener";
import { NoSignalBanner } from "@/components/NoSignalBanner";

function SignedInLayout() {
  // Get the no-signal fallback page ready before the next dead zone (the worker also handles push).
  useEffect(() => {
    void registerOfflineFallback();
  }, []);
  return (
    <>
      {/* Drivers see a dispatch offer on any signed-in screen, not only the home screen (0146). */}
      <JobOfferListener />
      <NoSignalBanner />
      <Outlet />
    </>
  );
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // A network failure must not sign the person out of the screen (see lib/auth-guard.ts).
    const user = await requireUser();
    return { user };
  },
  component: SignedInLayout,
});
// trigger
