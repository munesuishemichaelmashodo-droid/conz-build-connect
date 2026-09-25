import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { materialLabel } from "@/lib/domain";
import { StatusPill, usd } from "@/components/redesign";

const ROW_STATUS: Record<string, { label: string; tone: "green" | "amber" | "neutral" | "info" }> =
  {
    open: { label: "Open", tone: "amber" },
    accepted: { label: "Driver chosen", tone: "info" },
    in_progress: { label: "On the way", tone: "amber" },
    completed: { label: "Completed", tone: "green" },
    cancelled: { label: "Cancelled", tone: "neutral" },
  };

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
  const st = ROW_STATUS[j.status] ?? { label: j.status, tone: "neutral" as const };
  return (
    <Link
      to="/jobs/$id"
      params={{ id: j.id }}
      className="flex items-center gap-3 rounded-[16px] border border-cz-border bg-cz-surface px-4 py-3.5 hover:border-cz-border-strong"
    >
      <div className="min-w-0 flex-1">
        <div className="font-semibold truncate">
          {materialLabel(j.material as never, j.custom_material)} · {Number(j.quantity_m3)} m³
        </div>
        <div className="text-[13px] text-cz-muted truncate">{j.delivery_address}</div>
        <div className="mt-1.5">
          <StatusPill tone={st.tone} className="px-2.5 py-0.5 text-xs">
            {st.label}
          </StatusPill>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="cz-display font-bold text-2xl tabular-nums">
          {usd(Number(j.final_price ?? j.budget))}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-cz-faint shrink-0" />
    </Link>
  );
}
