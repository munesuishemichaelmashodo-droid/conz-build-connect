// Pure helpers for the notifications bell: categories, Today / Yesterday / Earlier grouping (Africa/Harare)
// and the screen a notification opens. Kept pure so they can be unit-tested.

export type NotificationCategory = "jobs" | "payments" | "verification" | "account";

export const CATEGORY_LABEL: Record<NotificationCategory | "all", string> = {
  all: "All",
  jobs: "Jobs",
  payments: "Payments",
  verification: "Verification",
  account: "Account",
};

export interface NotificationLike {
  id: string;
  type: string;
  /** Optional: driver_verification rows are told apart by the title the database writes. */
  title?: string | null;
  job_id: string | null;
  created_at: string;
}

const PAYMENT = /^(wallet_|promo_credit|referral_|payment_|escrow_|withdrawal_|topup)/;
const VERIFICATION = /^(driver_verification|verification_|truck_review|kyc_)/;
const JOBS =
  /^(bid_|job_|new_job|new_message|driver_assigned|tracking_started|supply_confirmed|repeat_customer|dispute_|cancellation_|pickup_check|dispatch_)/;

export function notificationCategory(type: string): NotificationCategory {
  if (PAYMENT.test(type)) return "payments";
  if (VERIFICATION.test(type)) return "verification";
  if (JOBS.test(type)) return "jobs";
  return "account";
}

const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Harare" });

/** "Today" / "Yesterday" / "Earlier" in Harare time. */
export function dayGroup(iso: string, now: Date = new Date()): "Today" | "Yesterday" | "Earlier" {
  const day = dayKey(new Date(iso));
  if (day === dayKey(now)) return "Today";
  if (day === dayKey(new Date(now.getTime() - 24 * 3_600_000))) return "Yesterday";
  return "Earlier";
}

export function groupByDay<T extends { created_at: string }>(
  items: T[],
  now: Date = new Date(),
): { label: string; items: T[] }[] {
  const out: { label: string; items: T[] }[] = [];
  for (const label of ["Today", "Yesterday", "Earlier"] as const) {
    const these = items.filter((i) => dayGroup(i.created_at, now) === label);
    if (these.length) out.push({ label, items: these });
  }
  return out;
}

/** The exact screen a notification should open. Falls back to the job page when it has a job. */
export function notificationDestination(
  n: NotificationLike,
): { to: string; params?: Record<string, string> } | null {
  switch (n.type) {
    case "dispute_raised":
    case "dispute_overdue":
      return { to: "/admin/disputes" };
    case "report_filed":
      return { to: "/admin/reports" };
    case "report_update":
      return { to: "/report" };
    case "verification_submitted":
    case "verification_overdue":
    case "truck_review":
      return { to: "/admin/verifications" };
    case "driver_verification": {
      const t = (n.title ?? "").toLowerCase();
      // Sent to admins when a verified driver changes a document.
      if (t.startsWith("driver documents changed")) return { to: "/admin/verifications" };
      if (t.includes("verified")) return { to: "/home" }; // approved: Find Jobs
      if (t.includes("rejected")) return { to: "/become-driver" }; // corrections: fix and resubmit
      return { to: "/profile" };
    }
    case "user_status_changed":
      return { to: "/profile" };
    case "new_message":
      return n.job_id ? { to: "/chat/$jobId", params: { jobId: n.job_id } } : null;
    default:
      break;
  }
  if (notificationCategory(n.type) === "payments") return { to: "/wallet" };
  return n.job_id ? { to: "/jobs/$id", params: { id: n.job_id } } : null;
}

/**
 * One line telling the driver what to do next, for events whose text comes from the
 * database. Null when the stored text already says it (or the event is not a driver one).
 */
export function notificationHint(n: Pick<NotificationLike, "type" | "title">): string | null {
  const t = (n.title ?? "").toLowerCase();
  if (n.type === "driver_verification") {
    if (t.startsWith("driver documents changed")) return null;
    if (t.includes("verified")) return "Next: open Find Jobs to see available delivery requests.";
    if (t.includes("rejected"))
      return "Next: review the reason, correct your documents and resubmit your application.";
    return "Next: nothing to do. Your documents are being reviewed, and you do not need to submit again.";
  }
  if (n.type === "repeat_customer")
    return "Next: review the new details and decide whether the job suits your truck. You are not assigned.";
  return null;
}

// ---------------------------------------------------------------------------
// List handling for the bell. Pure, so reconnects, redelivered realtime events and the
// archive fallback can be tested without a browser.
// ---------------------------------------------------------------------------

export type NotificationRow = NotificationLike & {
  read: boolean;
  archived_at?: string | null;
};

/** Postgres/PostgREST "undefined column": only then is the plain list a safe fallback (pre-0136). */
export function isMissingArchiveColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" || error.code === "PGRST204" || /archived_at/i.test(error.message ?? "")
  );
}

/** Archived rows are never shown or counted, whichever query produced them. */
export function visibleNotifications<T extends { archived_at?: string | null }>(items: T[]): T[] {
  return items.filter((i) => !i.archived_at);
}

export function unreadCount<T extends { read: boolean; archived_at?: string | null }>(
  items: T[],
): number {
  return visibleNotifications(items).filter((i) => !i.read).length;
}

/** A realtime INSERT. The same id twice (reconnect, redelivery) is ignored: `isNew` gates sound and toast. */
export function mergeInserted<T extends { id: string }>(
  prev: T[],
  incoming: T,
  max = 100,
): { items: T[]; isNew: boolean } {
  if (prev.some((i) => i.id === incoming.id)) return { items: prev, isNew: false };
  return { items: [incoming, ...prev].slice(0, max), isNew: true };
}

/** A realtime UPDATE. A row restored elsewhere (archived_at cleared) joins the list; no sound for it. */
export function applyUpdated<
  T extends { id: string; created_at: string; archived_at?: string | null },
>(prev: T[], updated: T, max = 100): T[] {
  if (prev.some((i) => i.id === updated.id))
    return prev.map((i) => (i.id === updated.id ? updated : i));
  if (updated.archived_at) return prev;
  return [...prev, updated].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, max);
}
