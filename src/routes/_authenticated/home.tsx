import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useViewMode } from "@/lib/view-mode";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/ui-bits";
import { materialLabel, money, statusInfo } from "@/lib/domain";
import { Button } from "@/components/ui/button";

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
      <div className="space-y-4 py-6 text-center">
        <div className="font-display font-bold text-xl">Welcome to Con Z</div>
        <p className="text-sm text-muted-foreground">
          {hasAny ? "Open the side menu to pick your view." : "Set up your account to get started."}
        </p>
        <Button asChild className="w-full"><Link to="/profile">Go to profile</Link></Button>
      </div>
    </AppShell>
  );
}

export function JobCard({ j }: { j: { id: string; material: string; custom_material: string | null; quantity_m3: number; delivery_address: string; budget: number; status: string } }) {
  const s = statusInfo(j.status);
  return (
    <Link to="/jobs/$id" params={{ id: j.id }} className="block rounded-xl bg-card border p-4 shadow-soft hover:border-primary transition">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display font-bold text-base truncate">{materialLabel(j.material as never, j.custom_material)}</div>
          <div className="text-xs text-muted-foreground truncate">{j.delivery_address}</div>
        </div>
        <StatusBadge label={s.label} className={s.className} />
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{Number(j.quantity_m3)} m³</span>
        <span className="font-display font-bold text-primary text-lg">{money(Number(j.budget))}</span>
      </div>
    </Link>
  );
}
