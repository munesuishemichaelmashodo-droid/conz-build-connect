// Some security RPCs report an expected failure (wrong PIN, lockout) as a
// RESULT — {"ok": false, "error": "...", "message": "..."} — instead of
// raising, so the failed attempt is still counted (a raised error would roll
// the counter back; see migration 0078). Older deployments returned a plain
// row or nothing; both shapes are treated as success here.

export type RpcFailure = { error: string; message: string };

export function rpcFailure(data: unknown): RpcFailure | null {
  if (data && typeof data === "object" && (data as { ok?: unknown }).ok === false) {
    const d = data as { error?: string; message?: string };
    return { error: d.error ?? "failed", message: d.message ?? "That didn't work. Please try again." };
  }
  return null;
}
