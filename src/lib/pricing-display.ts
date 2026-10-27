// Display rules for how fresh the engine's material prices are. Display only.

export const STALE_PRICE_DAYS = 30;

export function priceFreshness(
  updatedAt: string | null | undefined,
  now: Date = new Date(),
): { state: "unknown" } | { state: "fresh" | "stale"; days: number; label: string } {
  if (!updatedAt) return { state: "unknown" };
  const t = new Date(updatedAt);
  if (Number.isNaN(t.getTime())) return { state: "unknown" };
  const days = Math.max(0, Math.floor((now.getTime() - t.getTime()) / 86_400_000));
  const label = t.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Harare",
  });
  return { state: days > STALE_PRICE_DAYS ? "stale" : "fresh", days, label };
}
