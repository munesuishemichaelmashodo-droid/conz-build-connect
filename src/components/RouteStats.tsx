import { useEffect, useState } from "react";
import { Clock, Loader2, MapPin, Navigation, Wallet } from "lucide-react";
import { formatArrival, formatDistance, formatDuration, formatFare } from "@/lib/format";

type RouteStatsProps = {
  distanceKm: number | null | undefined;
  etaMin: number | null | undefined;
  loading?: boolean;
  /** Optional: show an estimated fare chip when a rate is supplied. */
  ratePerKm?: number | null;
  currency?: string;
};

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 flex-1 min-w-0">
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums truncate">{value}</span>
    </div>
  );
}

export function RouteStats({
  distanceKm,
  etaMin,
  loading = false,
  ratePerKm = null,
  currency = "USD",
}: RouteStatsProps) {
  // Re-render every 30s so the arrival clock stays honest while the user waits.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (etaMin == null) return;
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [etaMin]);

  if (loading) {
    return (
      <div className="px-4 py-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        Calculating route…
      </div>
    );
  }

  if (distanceKm == null || etaMin == null) {
    return (
      <div className="px-4 py-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <MapPin className="w-3 h-3" />
        Tap the map to set a destination.
      </div>
    );
  }

  const fare = formatFare(distanceKm, ratePerKm, currency);

  return (
    <div className="px-4 py-3 flex items-stretch gap-2 divide-x divide-border">
      <Stat
        icon={<Navigation className="w-3 h-3" />}
        label="Distance"
        value={formatDistance(distanceKm)}
      />
      <Stat
        icon={<Clock className="w-3 h-3" />}
        label="Duration"
        value={formatDuration(etaMin)}
      />
      <Stat
        icon={<MapPin className="w-3 h-3" />}
        label="Arrive"
        value={formatArrival(etaMin, now)}
      />
      {fare ? (
        <Stat icon={<Wallet className="w-3 h-3" />} label="Est. fare" value={fare} />
      ) : null}
    </div>
  );
}

export default RouteStats;
