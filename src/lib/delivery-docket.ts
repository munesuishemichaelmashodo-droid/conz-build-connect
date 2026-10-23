// Presentation rules for the active-delivery "docket" shared by the driver and
// customer screens. Display only: every rule here reads the same job fields the
// server already enforces (pickup photo before the trip, delivery photo after it,
// delivery code to complete). Nothing here decides or changes a job's state.

export type StepState = "done" | "current" | "upcoming";

/** State of step `i` when `current` is the active step (4 = all done). */
export function stepState(i: number, current: number): StepState {
  if (i < current) return "done";
  if (i === current) return "current";
  return "upcoming";
}

export const STEP_STATE_WORD: Record<StepState, string> = {
  done: "done",
  current: "in progress",
  upcoming: "not started",
};

export type EvidenceViewer = "driver" | "customer";

export interface EvidenceSlot {
  kind: "pickup" | "delivery";
  label: string;
  path: string | null;
  /** Short status shown under the slot, never relying on colour alone. */
  status: string;
  uploaded: boolean;
}

type JobPhotos = {
  status: string;
  pickup_photo_url?: string | null;
  delivery_photo_url?: string | null;
};

/**
 * Both evidence slots for a driver's active job, so the driver always sees what
 * is still needed and where. Otherwise only uploaded photos are shown.
 */
export function evidenceSlots(job: JobPhotos, viewer: EvidenceViewer): EvidenceSlot[] {
  const active = job.status === "accepted" || job.status === "in_progress";
  const slots: EvidenceSlot[] = [
    {
      kind: "pickup",
      label: "Loaded truck",
      path: job.pickup_photo_url ?? null,
      uploaded: !!job.pickup_photo_url,
      status: job.pickup_photo_url ? "Uploaded at pickup" : "Needed before you leave pickup",
    },
    {
      kind: "delivery",
      label: "Load at drop-off",
      path: job.delivery_photo_url ?? null,
      uploaded: !!job.delivery_photo_url,
      status: job.delivery_photo_url ? "Uploaded at drop-off" : "Needed once the load is tipped",
    },
  ];
  // Empty slots are a driver's to-do list. The customer screen already says what
  // it is waiting for, so customers only see photos that exist.
  return active && viewer === "driver" ? slots : slots.filter((s) => s.uploaded);
}

/**
 * How old the driver's last shared position can be before the customer screen stops
 * calling it live. Phones only send a position when they move, so a truck stopped
 * longer than this also reads as "last update", which is still true.
 */
export const LOCATION_STALE_MS = 10 * 60_000;

export type LocationState = "off" | "live" | "stale";

/** Off (not sharing), live (updated in the last 10 minutes) or stale. */
export function locationState(
  track: { live: boolean; updatedAt: string | null } | null | undefined,
  now: number,
): LocationState {
  if (!track?.live) return "off";
  const at = track.updatedAt ? new Date(track.updatedAt).getTime() : NaN;
  if (!Number.isFinite(at)) return "stale";
  return now - at > LOCATION_STALE_MS ? "stale" : "live";
}

export interface TripBar {
  /** Null when progress can't be measured; the bar is then not drawn. */
  pct: number | null;
  label: string;
}

/**
 * The customer's trip bar. Shows a percentage only when it can be measured from a
 * live location's route, against the larger of the trip's priced road distance and
 * the most distance seen left so far. A route left over from a location that is off
 * or stale is ignored. Never a made-up 0%.
 */
export function tripBar(t: {
  step: number;
  status: string;
  atDropoff: boolean;
  location: LocationState;
  remainingKm: number | null;
  furthestKm: number | null;
  plannedKm: number | null;
}): TripBar | null {
  if (t.step < 2) return null;
  if (t.step >= 3) return { pct: 100, label: "Arrived" };
  if (t.atDropoff) return { pct: 100, label: "At your site" };
  // Loaded but the trip hasn't started: the screen's heading already says so.
  if (t.status !== "in_progress") return null;
  if (t.location === "off") {
    return { pct: null, label: "Live location is off, so progress can't be shown." };
  }
  // The screen already says when the last update was; say what happens next.
  if (t.location === "stale") {
    return { pct: null, label: "Progress shows again when the driver's location updates." };
  }
  const base = Math.max(Number(t.plannedKm) || 0, Number(t.furthestKm) || 0);
  if (t.remainingKm == null || !(base > 0)) {
    return { pct: null, label: "Distance left isn't available right now." };
  }
  const pct = Math.min(100, Math.max(0, Math.round((1 - t.remainingKm / base) * 100)));
  return { pct, label: `${pct}% of the trip done` };
}
