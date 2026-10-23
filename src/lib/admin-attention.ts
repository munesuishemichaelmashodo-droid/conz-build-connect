// "Needs attention" rules for the admin dashboard. Pure so they can be unit-tested.
// Every item is derived from data the admin can already read under RLS; nothing
// here changes state. Thresholds are deliberately conservative and named.

export const STALE_JOB_HOURS = 48; // accepted / in progress with no update for 2 days
export const STUCK_PAYMENT_HOURS = 1; // Paynow payment still "initiated" after an hour
export const RECON_MAX_AGE_HOURS = 36; // the reconciliation cron runs daily at 00:00
// Open job with no dispatch offer and no bid after this long. Dispatch makes its
// first wave as soon as a job is posted and widens every 3 minutes (0089).
export const UNMATCHED_JOB_MINUTES = 10;

export type AttentionTone = "critical" | "warn";

export interface AttentionItem {
  key: string;
  tone: AttentionTone;
  title: string;
  detail: string;
  /** Internal link to where the admin can act, when one exists. */
  to?: string;
  /** Up to five jobs behind the item, oldest first. */
  jobs?: { id: string; label: string; ageDays: number; ageLabel?: string }[];
}

export interface AttentionInput {
  now: number;
  isSuper: boolean;
  /** Authenticator assurance level of the current session (null = unknown). */
  aal: "aal1" | "aal2" | null;
  activeJobs: {
    id: string;
    status: string;
    created_at: string;
    updated_at?: string | null;
    material?: string | null;
    quantity_m3?: number | null;
  }[];
  initiatedPayments: { created_at: string }[];
  /** Open jobs with how many dispatch offers and bids each has (undefined = not loaded). */
  openJobs?: {
    id: string;
    created_at: string;
    material?: string | null;
    quantity_m3?: number | null;
    delivery_address?: string | null;
    dispatchOffers: number;
    bids: number;
  }[];
  /** null when the viewer may not see top-up requests (not a super admin). */
  pendingTopups: number | null;
  /** undefined when the viewer may not see reconciliation runs. */
  latestRecon?: { ran_at: string; ok: boolean } | null;
}

const HOUR = 3_600_000;
const sentenceCase = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const hoursSince = (iso: string, now: number) => (now - new Date(iso).getTime()) / HOUR;
const jobLabel = (j: { material?: string | null; quantity_m3?: number | null }) =>
  `${sentenceCase((j.material ?? "Job").replace(/_/g, " "))}${j.quantity_m3 ? ` · ${Number(j.quantity_m3)} m³` : ""}`;
// "Harward Road, Belvedere, Harare, Zimbabwe" -> "Belvedere, Harare": the last two
// parts once the country is dropped, so the street never shows.
const placeOf = (address: string | null | undefined) => {
  const parts = (address ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1 && /^zimbabwe$/i.test(parts[parts.length - 1])) parts.pop();
  return parts.slice(-2).join(", ");
};

/** "25 min", "6 h", "2 days". */
export function formatAge(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(ms / HOUR);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"}`;
}

export function buildAttention(input: AttentionInput): AttentionItem[] {
  const { now } = input;
  const items: AttentionItem[] = [];

  const stale = input.activeJobs
    .filter((j) => j.status === "accepted" || j.status === "in_progress")
    .map((j) => ({ j, h: hoursSince(j.updated_at ?? j.created_at, now) }))
    .filter((x) => x.h >= STALE_JOB_HOURS)
    .sort((a, b) => b.h - a.h);
  if (stale.length > 0) {
    const oldest = Math.floor(stale[0].h / 24);
    items.push({
      key: "stale-jobs",
      tone: "critical",
      title: `${stale.length} ${stale.length === 1 ? "job has" : "jobs have"} had no update for 2+ days`,
      detail: `Customers still see these as active and the drivers' commission stays reserved. Oldest: ${oldest} days.`,
      jobs: stale.slice(0, 5).map(({ j, h }) => ({
        id: j.id,
        label: jobLabel(j),
        ageDays: Math.floor(h / 24),
      })),
    });
  }

  const unmatched = (input.openJobs ?? [])
    .filter((j) => j.dispatchOffers === 0 && j.bids === 0)
    .map((j) => ({ j, ms: now - new Date(j.created_at).getTime() }))
    .filter((x) => x.ms >= UNMATCHED_JOB_MINUTES * 60_000)
    .sort((a, b) => b.ms - a.ms);
  if (unmatched.length > 0) {
    items.push({
      key: "unmatched-jobs",
      tone: "critical",
      title: `${unmatched.length} open ${unmatched.length === 1 ? "job has" : "jobs have"} reached no driver`,
      detail:
        "No driver was sent an automatic offer and none has made an offer. Usually no verified driver is online near the pickup. Contact nearby drivers or the customer.",
      jobs: unmatched.slice(0, 5).map(({ j, ms }) => {
        const area = placeOf(j.delivery_address);
        return {
          id: j.id,
          label: `${jobLabel(j)}${area ? ` · ${area}` : ""}`,
          ageDays: Math.floor(ms / (24 * HOUR)),
          ageLabel: formatAge(ms),
        };
      }),
    });
  }

  const stuck = input.initiatedPayments.filter(
    (p) => hoursSince(p.created_at, now) >= STUCK_PAYMENT_HOURS,
  );
  if (stuck.length > 0) {
    items.push({
      key: "stuck-payments",
      tone: "warn",
      title: `${stuck.length} Paynow ${stuck.length === 1 ? "payment is" : "payments are"} stuck at "initiated"`,
      detail:
        "Paynow never confirmed or failed them. Check the reference in Paynow before contacting the customer.",
      to: "/admin/ledger",
    });
  }

  if (input.isSuper && input.pendingTopups != null && input.pendingTopups > 0) {
    const needsMfa = input.aal !== "aal2";
    items.push({
      key: "pending-topups",
      tone: "warn",
      title: `${input.pendingTopups} wallet top-up ${input.pendingTopups === 1 ? "request is" : "requests are"} waiting`,
      detail: needsMfa
        ? "Approving money needs an authenticator check on this session. Set it up first."
        : "Review and approve or reject them.",
      to: needsMfa ? "/mfa" : "/admin/revenue",
    });
  }

  if (input.isSuper && input.latestRecon !== undefined) {
    const r = input.latestRecon;
    if (!r) {
      items.push({
        key: "recon-missing",
        tone: "warn",
        title: "No reconciliation run found",
        detail: "The daily money check has never recorded a result.",
        to: "/admin/ledger",
      });
    } else if (!r.ok) {
      items.push({
        key: "recon-failed",
        tone: "critical",
        title: "The last money reconciliation failed",
        detail:
          "Wallets, payments or the ledger do not agree. Open the ledger to see which check failed.",
        to: "/admin/ledger",
      });
    } else if (hoursSince(r.ran_at, now) > RECON_MAX_AGE_HOURS) {
      items.push({
        key: "recon-stale",
        tone: "warn",
        title: "Reconciliation has not run for over a day",
        detail: "The daily money check may have stopped.",
        to: "/admin/ledger",
      });
    }
  }

  return items.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "critical" ? -1 : 1));
}
