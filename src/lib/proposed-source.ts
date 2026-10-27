// Mode 2 sourcing: on an open request (no listed supplier) the driver arranges the
// material. The driver can say where they'll load; it travels in the offer's existing
// message as a leading "Loading at: …." line, so no schema change is needed and older
// apps simply show it as text. It is the driver's claim, never verified by Con Z;
// the actual loading point is recorded at pickup (set_job_loaded_at, 0112).

export const MAX_SOURCE_LENGTH = 80;
const PREFIX = "Loading at: ";

function cleanSource(source: string): string {
  return source
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.\s/g, ", ") // a ". " would end the source line early
    .replace(/\.+$/, "")
    .slice(0, MAX_SOURCE_LENGTH)
    .trim();
}

/** The offer message to save: optional source line, then the driver's note. */
export function composeOfferMessage(source: string, note: string): string | null {
  const s = cleanSource(source);
  const n = note.trim();
  const parts = [s ? `${PREFIX}${s}.` : "", n].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/** Split a saved message back into the proposed source and the note. */
export function parseOfferMessage(message: string | null | undefined): {
  source: string | null;
  note: string;
} {
  const m = (message ?? "").trim();
  if (!m.startsWith(PREFIX)) return { source: null, note: m };
  const rest = m.slice(PREFIX.length);
  const end = rest.search(/\.(\s|$)/);
  if (end <= 0) return { source: null, note: m };
  return { source: rest.slice(0, end).trim(), note: rest.slice(end + 1).trim() };
}

/**
 * A job where no listed supplier is set: the driver arranges the material, so there is
 * no pickup pin. Only on these jobs is a "Loading at:" line shown as a proposed source.
 */
export function isDriverArranged(
  job: { pickup_lat?: number | null; pickup_lng?: number | null } | null | undefined,
): boolean {
  return !!job && (job.pickup_lat == null || job.pickup_lng == null);
}

/**
 * What to show for an offer message. On a job with a listed supplier the message is shown
 * whole, so a driver can't make a typed "Loading at:" line look like a second source.
 */
export function offerMessageParts(
  message: string | null | undefined,
  driverArranged: boolean,
): { source: string | null; note: string } {
  if (!driverArranged) return { source: null, note: (message ?? "").trim() };
  return parseOfferMessage(message);
}
