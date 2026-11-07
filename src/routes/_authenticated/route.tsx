import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { JobOfferListener } from "@/components/JobOfferListener";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: () => (
    <>
      {/* Drivers see a dispatch offer on any signed-in screen, not only the home screen (0146). */}
      <JobOfferListener />
      <Outlet />
    </>
  ),
});
// trigger
