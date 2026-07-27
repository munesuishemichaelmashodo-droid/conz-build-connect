/**
 * Formatting helpers for route distance / duration / arrival time.
 * Pure functions — no React, no DOM. Safe to unit-test and to call on the server.
 */

/**
 * Human-friendly distance.
 *   0.42  -> "420 m"
 *   1     -> "1.0 km"
 *   7.35  -> "7.4 km"
 *   128.4 -> "128 km"
 */
export function formatDistance(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km) || km < 0) return "—";
  if (km < 1) {
    const m = Math.round(km * 1000);
    // Snap to 10 m so the readout doesn't jitter on every GPS tick.
    const snapped = m < 100 ? m : Math.round(m / 10) * 10;
    return `${snapped} m`;
  }
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/**
 * Human-friendly duration from minutes.
 *   0.4  -> "<1 min"
 *   9    -> "9 min"
 *   75   -> "1 h 15 min"
 *   120  -> "2 h"
 */
export function formatDuration(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min < 0) return "—";
  const total = Math.round(min);
  if (total < 1) return "<1 min";
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * Clock time of arrival, e.g. "14:32".
 * `now` is injectable so this is deterministic in tests.
 */
export function formatArrival(
  etaMin: number | null | undefined,
  now: Date = new Date(),
  locale?: string,
): string {
  if (etaMin == null || !Number.isFinite(etaMin) || etaMin < 0) return "—";
  const arrival = new Date(now.getTime() + etaMin * 60_000);
  return arrival.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Rough trip cost estimate. Returns null when no rate is configured,
 * so the UI can simply omit the chip.
 */
export function formatFare(
  km: number | null | undefined,
  ratePerKm: number | null | undefined,
  currency = "USD",
  locale?: string,
): string | null {
  if (km == null || ratePerKm == null) return null;
  if (!Number.isFinite(km) || !Number.isFinite(ratePerKm)) return null;
  const amount = km * ratePerKm;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
