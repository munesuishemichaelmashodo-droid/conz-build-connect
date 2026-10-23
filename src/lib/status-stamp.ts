// One status vocabulary for jobs, used by every list, header and admin table.
// Display only: it reads the job fields the server already sets and decides nothing.

export type StampTone = "neutral" | "info" | "brand" | "success" | "warning" | "danger";
export type StampIcon =
  "open" | "chosen" | "loaded" | "truck" | "site" | "done" | "cancelled" | "problem" | "clock";

export interface Stamp {
  label: string;
  tone: StampTone;
  icon: StampIcon;
  /** A filled stamp, for a finished state. */
  solid?: boolean;
}

type JobLike = {
  status: string;
  pickup_photo_url?: string | null;
  driver_arrived_dropoff_at?: string | null;
  delivery_photo_url?: string | null;
};

/** The stamp for a job, from the same fields the delivery screens use. */
export function jobStamp(job: JobLike): Stamp {
  switch (job.status) {
    case "open":
      return { label: "Open", tone: "info", icon: "open" };
    case "accepted":
      return job.pickup_photo_url
        ? { label: "Loaded", tone: "brand", icon: "loaded" }
        : { label: "Driver chosen", tone: "brand", icon: "chosen" };
    case "in_progress":
      return job.delivery_photo_url || job.driver_arrived_dropoff_at
        ? { label: "At your site", tone: "success", icon: "site" }
        : { label: "On the way", tone: "success", icon: "truck" };
    case "completed":
      return { label: "Delivered", tone: "success", icon: "done", solid: true };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral", icon: "cancelled" };
    default:
      return { label: sentence(job.status), tone: "neutral", icon: "clock" };
  }
}

/** "in_progress" → "In progress"; for any status the app does not know yet. */
export function sentence(raw: string): string {
  const s = String(raw ?? "")
    .replace(/[_-]+/g, " ")
    .trim();
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : "Unknown";
}

/** Tailwind classes per tone (tint + text), shared by stamps, notices and pills. */
export const TONE_CLASS: Record<StampTone, string> = {
  neutral: "bg-cz-surface-2 text-cz-muted",
  info: "bg-cz-info-tint text-cz-info-text",
  brand: "bg-cz-amber-tint text-cz-amber-text",
  success: "bg-cz-green-tint text-cz-green-text",
  warning: "bg-cz-warn-tint text-cz-warn-text",
  danger: "bg-cz-danger-tint text-cz-danger-text",
};

/** Filled variant for finished states; text uses the panel colour (≥ 6:1 in both themes). */
export const TONE_SOLID_CLASS: Record<StampTone, string> = {
  neutral: "bg-cz-muted text-cz-surface",
  info: "bg-cz-info-text text-cz-surface",
  brand: "bg-cz-amber text-cz-amber-ink",
  success: "bg-cz-green-text text-cz-surface",
  warning: "bg-cz-warn-text text-cz-surface",
  danger: "bg-cz-danger-text text-cz-surface",
};

/**
 * Steps on the shared tracking link. The link carries no photos or arrival
 * times, so the ticks come from the job status alone: each one is a fact the
 * server reported.
 */
export const PUBLIC_STEPS = ["Booked", "Driver chosen", "On the way", "Delivered"];

export function publicStepsDone(status: string): number {
  switch (status) {
    case "open":
      return 1;
    case "accepted":
      return 2;
    case "in_progress":
      return 3;
    case "completed":
      return 4;
    default:
      return 0;
  }
}
