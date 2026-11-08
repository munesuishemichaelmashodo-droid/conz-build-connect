// What the waiting screen can say truthfully: how long ago the request was posted, and when it closes if
// nobody offers (jobs.expires_at). No wait estimate: nothing measures one.

export function postedAgoText(
  createdAt: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.floor((now - t) / 60000));
  if (mins < 1) return "Posted just now";
  if (mins < 60) return `Posted ${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Posted ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `Posted ${days} day${days === 1 ? "" : "s"} ago`;
}

export function closesText(
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return null;
  if (t <= now) return "This request is about to close if no offer is accepted.";
  const when = new Date(t).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Stays open until ${when}. If no offer suits you by then it closes, and you can post it again.`;
}
