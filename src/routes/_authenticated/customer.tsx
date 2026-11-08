import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRole, requireUser } from "@/lib/route-guards";

export const Route = createFileRoute("/_authenticated/customer")({
  beforeLoad: async () => {
    const user = await requireUser();
    await requireRole(user, ["customer"], "/home");
  },
  component: () => <Outlet />,
});
