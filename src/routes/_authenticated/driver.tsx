import { createFileRoute } from "@tanstack/react-router";
import { requireRole, requireUser } from "@/lib/route-guards";
import { RoleDashboard } from "@/components/RoleDashboard";

export const Route = createFileRoute("/_authenticated/driver")({
  beforeLoad: async () => {
    const user = await requireUser();
    await requireRole(user, ["driver"], "/home");
  },
  component: () => <RoleDashboard role="driver" />,
});
