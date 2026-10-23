import { CircleDot, MapPinOff, Clock, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { driverReach, type AvailabilityRow } from "@/lib/driver-reach";

/**
 * One line under the driver header saying whether automatic job offers can
 * reach this driver right now, and what to do if not. Read-only: the switch
 * itself is DriverAvailabilityToggle.
 */
export function DriverReachLine({ row }: { row: AvailabilityRow | null }) {
  const reach = driverReach(row, Date.now());
  const Icon =
    reach.kind === "reachable"
      ? Radio
      : reach.kind === "no_location"
        ? MapPinOff
        : reach.kind === "stale"
          ? Clock
          : CircleDot;
  return (
    <div
      role="status"
      data-testid="driver-reach"
      data-reach={reach.kind}
      className={cn(
        "flex items-start gap-2.5 rounded-[14px] border px-3.5 py-2.5",
        reach.kind === "reachable"
          ? "border-cz-green-border bg-cz-green-tint"
          : reach.kind === "offline"
            ? "border-cz-border bg-cz-surface"
            : "border-cz-border bg-cz-warn-tint",
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          reach.kind === "reachable"
            ? "text-cz-green-text"
            : reach.kind === "offline"
              ? "text-cz-muted"
              : "text-cz-warn-text",
        )}
      />
      <div className="min-w-0">
        <div
          className={cn(
            "text-sm font-semibold",
            reach.kind === "reachable"
              ? "text-cz-green-text"
              : reach.kind === "offline"
                ? "text-cz-text"
                : "text-cz-warn-text",
          )}
        >
          {reach.title}
        </div>
        <div className="text-[13px] leading-snug text-cz-muted">{reach.detail}</div>
      </div>
    </div>
  );
}
