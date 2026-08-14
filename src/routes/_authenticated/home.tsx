import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useViewMode } from "@/lib/view-mode";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/ui-bits";
import { materialLabel, money, statusInfo } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { JobCard } from "@/components/JobCard";
import { RouteLine } from "@/components/RouteLine";

export const Route = createFileRoute("/_authenticated/home")({
  component: HomePage,
});

function HomePage() {
  const { loading, is } = useAuth();
  const { activeRole } = useViewMode();

  if (loading) return <AppShell><div className="text-center text-muted-foreground py-10">Loading…</div></AppShell>;

  if (activeRole === "driver") return <Navigate to="/driver" replace />;
  if (activeRole === "customer") return <Navigate to="/customer" replace />;

  // Fallback: no role yet
  const hasAny = is("driver") || is("customer");
  return (
    <AppShell title="Con Z">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-dark text-white space-y-4 py-10 px-6 text-center">
        <RouteLine opacity={0.18} animate />
        <div className="relative">
          <div className="font-display font-bold text-xl">Welcome to Con Z</div>
          <p className="text-sm text-white/70 mt-2">
            {hasAny ? "Open the side menu to pick your view." : "Set up your account to get started."}
          </p>
          <Button asChild className="w-full mt-4"><Link to="/profile">Go to profile</Link></Button>
        </div>
      </div>
    </AppShell>
  );
}

