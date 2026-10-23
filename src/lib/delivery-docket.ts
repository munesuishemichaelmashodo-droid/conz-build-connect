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
