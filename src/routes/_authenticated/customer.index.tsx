import { createFileRoute } from "@tanstack/react-router";
import { RoleDashboard } from "@/components/RoleDashboard";

export const Route = createFileRoute("/_authenticated/customer/")({
  component: () => <RoleDashboard role="customer" />,
});
