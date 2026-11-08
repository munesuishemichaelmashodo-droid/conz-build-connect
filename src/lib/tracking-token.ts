// Tracking links carry a UUID. Anything else cannot match a job, so the page can say "link not found" right away
// instead of asking the server and showing a connection error.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTrackingToken(token: string | null | undefined): boolean {
  return typeof token === "string" && UUID.test(token.trim());
}
