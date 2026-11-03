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
    case "verification_submitted":
    case "verification_overdue":
    case "truck_review":
      return { to: "/admin/verifications" };
    case "driver_verification":
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
