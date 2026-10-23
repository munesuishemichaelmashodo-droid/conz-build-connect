import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `intervalMs`, so time-based labels (a location
 * going stale, an offer expiring) change while the page stays open.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}
