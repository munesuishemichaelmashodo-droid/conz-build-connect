import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/")({
  component: () => {
    const { loading, userId } = useAuth();
    const nav = useNavigate();
    useEffect(() => { if (!loading && userId) nav({ to: "/home", replace: true }); }, [loading, userId, nav]);
    return null;
  },
});
