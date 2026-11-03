// Where to send someone after they sign in, kept across the email-confirmation
// round trip. The confirmation link often opens in a new tab (or the mail app's
// browser), which loses sessionStorage, so the path is kept in localStorage for a
// day and used once. Always re-checked with safeInternalPath when read.
import { safeInternalPath } from "@/lib/safe-redirect";

export const PENDING_NEXT_KEY = "conz.postAuthNext";
export const PENDING_NEXT_TTL_MS = 24 * 60 * 60 * 1000;

export function serializeNext(path: string, nowMs: number): string {
  return JSON.stringify({ path, at: nowMs });
}

/** A stored value back to a safe path, or null if missing, expired or unsafe. */
export function parseStoredNext(raw: string | null, nowMs: number): string | null {
  if (!raw) return null;
  if (raw.startsWith("/")) return safeInternalPath(raw); // older plain value
  try {
    const v = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof v.path !== "string" || typeof v.at !== "number") return null;
    if (nowMs - v.at > PENDING_NEXT_TTL_MS || v.at > nowMs + 60_000) return null;
    return safeInternalPath(v.path);
  } catch {
    return null;
  }
}

/** Remember a destination (safe paths only). Storage errors are ignored. */
export function rememberNext(path: string | null): void {
  const safe = safeInternalPath(path);
  if (!safe) return;
  try {
    localStorage.setItem(PENDING_NEXT_KEY, serializeNext(safe, Date.now()));
  } catch {
    /* private mode or blocked storage: the flow still works, just without the carry-over */
  }
}

/** Read and clear the remembered destination. */
export function takeNext(): string | null {
  let found: string | null = null;
  for (const store of [() => localStorage, () => sessionStorage]) {
    try {
      const s = store();
      found = found ?? parseStoredNext(s.getItem(PENDING_NEXT_KEY), Date.now());
      s.removeItem(PENDING_NEXT_KEY);
    } catch {
      /* ignore */
    }
  }
  return found;
}
