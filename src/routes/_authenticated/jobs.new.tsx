import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/jobs/new")({
  beforeLoad: () => {
    throw redirect({ to: "/customer/book" });
  },
});
