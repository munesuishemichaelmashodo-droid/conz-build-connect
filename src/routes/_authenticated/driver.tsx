import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { RoleDashboard } from "@/components/RoleDashboard";

export const Route = createFileRoute("/_authenticated/driver")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const list = (roles ?? []).map((r: { role: string }) => r.role);
    if (!list.includes("driver")) throw redirect({ to: "/home" });
  },
  component: () => <RoleDashboard role="driver" />,
});
