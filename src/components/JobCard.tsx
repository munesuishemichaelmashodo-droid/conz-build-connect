import { Link } from "@tanstack/react-router";
import { StatusBadge } from "@/components/ui-bits";
import { materialLabel, money, statusInfo } from "@/lib/domain";

export function JobCard({
  j,
}: {
  j: { id: string; material: string; custom_material: string | null; quantity_m3: number; delivery_address: string; budget: number; status: string };
}) {
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
