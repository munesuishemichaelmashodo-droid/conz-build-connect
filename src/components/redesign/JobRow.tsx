import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { materialLabel } from "@/lib/domain";
import { usd } from "@/components/redesign";
import { JobStamp } from "@/components/ds";
import { MaterialThumb } from "@/components/ds/media";

/** Compact job row (status pill + price) for job lists. */
export function JobRow({
  j,
}: {
  j: {
    id: string;
    material: string;
    custom_material: string | null;
    quantity_m3: number;
    delivery_address: string;
    budget: number;
    final_price?: number | null;
    status: string;
  };
}) {
  return (
    <Link
      to="/jobs/$id"
      params={{ id: j.id }}
      className="flex items-center gap-3 rounded-2xl border border-cz-border bg-cz-surface px-3.5 py-3.5 hover:border-cz-border-strong"
    >
      <MaterialThumb material={j.material} size={44} className="rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold truncate">
          {materialLabel(j.material as never, j.custom_material)} · {Number(j.quantity_m3)} m³
        </div>
        <div className="text-[13px] text-cz-muted truncate">{j.delivery_address}</div>
        <div className="mt-1.5">
          <JobStamp job={j} />
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="cz-display font-bold text-2xl tabular-nums">
          {usd(Number(j.final_price ?? j.budget))}
        </div>
      </div>
      <ChevronRight aria-hidden className="w-4 h-4 text-cz-muted shrink-0" />
    </Link>
  );
}
