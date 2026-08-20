import { Link } from "@tanstack/react-router";
import { StatusBadge } from "@/components/ui-bits";
import { materialLabel, money, statusInfo } from "@/lib/domain";

const MATCH_BADGE: Record<string, { label: string; className: string }> = {
  excellent: { label: "Great fit", className: "bg-success/15 text-success border-success/30" },
  good: { label: "Good fit", className: "bg-primary/10 text-primary border-primary/30" },
  oversized: { label: "Oversized", className: "bg-muted text-muted-foreground border-border" },
  multiple_trips: { label: "Multiple trips", className: "bg-warning/15 text-warning border-warning/30" },
};

export function JobCard({
  j,
  matchTier,
}: {
  j: { id: string; material: string; custom_material: string | null; quantity_m3: number; delivery_address: string; budget: number; status: string };
  // Best-matched truck tier for the current driver across their registered
  // trucks — informational only, purely a client-side sort/display aid.
  // Never affects who can bid or who wins; the customer always chooses.
  matchTier?: string | null;
}) {
  const s = statusInfo(j.status);
  const match = matchTier ? MATCH_BADGE[matchTier] : undefined;
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
      {match && (
        <div className="mt-2">
          <StatusBadge label={match.label} className={match.className} />
        </div>
      )}
    </Link>
  );
}
