/**
 * Shared helpers for the "Online / Last seen" badge and the estimated delivery
 * time shown on job and offer cards.
 */

/** Same window the chat uses: active in the last 2 minutes = online. */
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

export function presenceOf(lastActiveAt: string | null | undefined, now = Date.now()): { online: boolean; label: string | null } {
  if (!lastActiveAt) return { online: false, label: null };
  const diff = now - new Date(lastActiveAt).getTime();
  if (!Number.isFinite(diff)) return { online: false, label: null };
  if (diff < ONLINE_WINDOW_MS) return { online: true, label: "Online" };
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return { online: false, label: `Last seen ${mins}m ago` };
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return { online: false, label: `Last seen ${hrs}h ago` };
  return { online: false, label: `Last seen ${Math.floor(hrs / 24)}d ago` };
}

/** Average loaded-truck road speed and time to load, used only for an estimate. */
const AVG_SPEED_KMH = 40;
const LOADING_MIN = 20;

/**
 * Rough minutes from "driver accepted" to "load delivered": time to reach
 * pickup (the driver's own estimate, if they gave one) + loading + driving the
 * pickup→delivery distance. Returns null when there is no distance to base it on.
 */
export function estimateDeliveryMinutes(distanceKm: number | null | undefined, etaToPickupMin?: number | null): number | null {
  const km = Number(distanceKm);
  if (!Number.isFinite(km) || km <= 0) return null;
  const drive = (km / AVG_SPEED_KMH) * 60;
  const pickup = Number(etaToPickupMin) > 0 ? Number(etaToPickupMin) : 0;
  // Round to the nearest 5 minutes so it reads as an estimate, not a promise.
  return Math.max(10, Math.round((pickup + LOADING_MIN + drive) / 5) * 5);
}

export function formatDuration(totalMin: number): string {
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}
