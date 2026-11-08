import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireUser } from "@/lib/route-guards";
import { JobOfferListener } from "@/components/JobOfferListener";
import { NoSignalBanner } from "@/components/NoSignalBanner";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // A network failure must not sign the person out of the screen (see lib/auth-guard.ts).
    const user = await requireUser();
    return { user };
  },
  component: () => (
    <>
      {/* Drivers see a dispatch offer on any signed-in screen, not only the home screen (0146). */}
      <JobOfferListener />
      <NoSignalBanner />
      <Outlet />
    </>
  ),
});
// trigger
