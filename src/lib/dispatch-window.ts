// Pure helpers for the dispatch offer countdown (0146). The server decides the window
// (60 s for a driver with the app open, 5 min for one reached by push); the screen only mirrors it.

type OfferTimes = { offered_at?: string | null; expires_at: string };

/** Length of this offer's window in ms, from the server's own timestamps (falls back to 60 s). */
export function offerWindowMs(o: OfferTimes): number {
  const start = o.offered_at ? new Date(o.offered_at).getTime() : NaN;
  const end = new Date(o.expires_at).getTime();
  const w = end - start;
  return Number.isFinite(w) && w > 0 ? w : 60_000;
}

/** "45" under a minute, "4:32" above. */
export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return String(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Colour band by share of the window left, so a 5-minute offer is not red from the start. */
export function countdownColor(remainingMs: number, windowMs: number): string {
  const f = windowMs > 0 ? remainingMs / windowMs : 0;
  if (f > 0.6) return "#22c55e";
  if (f > 0.35) return "#84cc16";
  if (f > 0.15) return "#f97316";
  return "#ef4444";
}

/** The honest line under the countdown. */
export function offerFootnote(windowMs: number): string {
  return windowMs > 90_000
    ? "Accept within a few minutes — after that this goes to the next driver."
    : "Accept quickly — after a minute this goes to the next driver.";
}
