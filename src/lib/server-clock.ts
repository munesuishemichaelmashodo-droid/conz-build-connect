// Corrects for a phone whose clock is wrong. Offers expire on the database clock
// (tg_bids_offer_expiry, accept_bid), so a phone running fast used to hide a live
// offer from the customer while the driver still saw it as open.
import { getServerNow } from "@/lib/server-clock.functions";

let offsetMs = 0;
let started = false;

/** Offset from a round trip: server time minus the midpoint of the request. */
export function clockOffset(sentAt: number, serverNow: number, receivedAt: number): number | null {
  const rtt = receivedAt - sentAt;
  if (!Number.isFinite(serverNow) || rtt < 0 || rtt > 10_000) return null; // too slow to trust
  const offset = serverNow - (sentAt + rtt / 2);
  return Math.abs(offset) < 5_000 ? 0 : Math.round(offset); // ignore small drift
}

/** Now, by the server's clock (best effort; falls back to the phone's). */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** Measure once per page load. Safe to call many times; resolves when measured. */
export function syncServerClock(): Promise<void> {
  if (started || typeof window === "undefined") return Promise.resolve();
  started = true;
  const sentAt = Date.now();
  return getServerNow()
    .then(({ now }) => {
      const measured = clockOffset(sentAt, now, Date.now());
      if (measured === null)
        started = false; // measure again on the next tick
      else offsetMs = measured;
    })
    .catch(() => {
      started = false; // try again on the next screen
    });
}
