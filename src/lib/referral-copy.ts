// Wording for the Invite page. Referrals give recognition only: never money, credit, discounts or
// better job offers. Kept here so the unit test can check every sentence the page shows.

export type InviteRole = "customer" | "driver";

export type ReferralStage =
  "in_progress" | "qualified" | "recognised" | "not_recognised" | "being_checked";

export type ReferralProgressRow = {
  ref_key: string;
  invited_as: InviteRole;
  joined_month: string;
  stage: ReferralStage;
  verified: boolean | null;
  jobs_done: number;
  jobs_needed: number;
  recognised_on: string | null;
};

export const MILESTONES = [1, 5, 10, 25, 50] as const;

export const CHECK_DAYS = 7;

type RoleCopy = {
  title: string;
  lead: string;
  why: string[];
  theyGet: string[];
  counts: string;
  share: (link: string) => string;
};

export const INVITE_COPY: Record<InviteRole, RoleCopy> = {
  customer: {
    title: "Invite someone who builds",
    lead: "Know someone building or renovating? Send them your link so they can get sand, stone and other materials delivered by a verified tipper driver.",
    why: [
      "They compare offers from verified drivers instead of phoning around.",
      "They can follow the truck live and confirm delivery with a code.",
      "More customers in your area means more drivers nearby when you book again.",
    ],
    theyGet: [
      "A free account and offers from verified drivers.",
      "Live tracking, chat with the driver and a delivery code.",
      "Their own job history, so repeat orders take a minute.",
    ],
    counts:
      "An invitation counts once the person you invited completes their first delivery on Con Z, followed by a short check.",
    share: (link) =>
      `I use Con Z to get building materials delivered by verified tipper drivers. You can compare offers and track the truck. Join here: ${link}`,
  },
  driver: {
    title: "Invite a driver you trust",
    lead: "Know a good tipper driver? Send them your link. Con Z connects them with customers who need deliveries, and they agree the price and get paid by the customer directly.",
    why: [
      "Customers get a driver sooner when more trusted drivers are on Con Z.",
      "Busier routes bring more delivery requests to every driver in the area.",
      "Drivers you vouch for strengthen the trust customers place in Con Z drivers.",
    ],
    theyGet: [
      "Delivery requests from customers near them, with the area shown before they offer.",
      "Their own profile with ratings and a level that grows with completed work.",
      "Clear job details, live directions and a delivery code at drop-off.",
    ],
    counts:
      "An invitation counts once the driver you invited is verified and has completed five genuine deliveries, followed by a short check.",
    share: (link) =>
      `I take delivery jobs through Con Z. Customers post loads, you send your price and they pay you directly. Join as a driver here: ${link}`,
  },
};

export const RULES: string[] = [
  "Invitations are a way to say thank you. They give recognition on this page, not money, credit, discounts or priority for jobs.",
  "Only new accounts can join with your link. You cannot invite yourself or another account of yours.",
  "Deliveries between you and the person you invited, and deliveries under an open dispute, do not count.",
  `Each invitation is checked for ${CHECK_DAYS} days after it qualifies. Con Z may review any invitation.`,
  "If an invitation is found to be false, it stops counting and any milestone that depended on it is withdrawn.",
  "We never show you the name, number or details of the people you invite: only their progress.",
];

export const STAGE_LABEL: Record<ReferralStage, string> = {
  in_progress: "Getting started",
  qualified: "Qualified, being checked",
  recognised: "Counted",
  not_recognised: "Did not count",
  being_checked: "Being reviewed",
};

export function invitedLabel(role: InviteRole): string {
  return role === "driver" ? "Driver you invited" : "Customer you invited";
}

export function progressLine(row: ReferralProgressRow): string {
  if (row.stage === "recognised") return "Counted towards your milestones.";
  if (row.stage === "not_recognised") return "This invitation did not meet the rules after review.";
  if (row.stage === "being_checked") return "Con Z is reviewing this invitation.";
  if (row.stage === "qualified") return `Requirements met. Counts after a ${CHECK_DAYS}-day check.`;
  if (row.invited_as === "driver") {
    if (!row.verified) return "Waiting for their driver verification.";
    return `${row.jobs_done} of ${row.jobs_needed} deliveries completed.`;
  }
  return row.jobs_done >= row.jobs_needed
    ? "First delivery completed."
    : "Waiting for their first delivery.";
}

export function progressFraction(row: ReferralProgressRow): number {
  if (row.stage === "recognised" || row.stage === "qualified") return 1;
  if (row.stage === "not_recognised") return 0;
  if (row.invited_as === "driver") {
    // verification is the first step, then each delivery
    const steps = row.jobs_needed + 1;
    return Math.min(1, ((row.verified ? 1 : 0) + row.jobs_done) / steps);
  }
  return Math.min(1, row.jobs_done / Math.max(1, row.jobs_needed));
}

export function nextMilestone(counted: number): number | null {
  return MILESTONES.find((m) => m > counted) ?? null;
}

export function milestoneLabel(m: number): string {
  return m === 1 ? "First invitation counted" : `${m} invitations counted`;
}

export function monthLabel(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function inviteLink(origin: string, code: string): string {
  return `${origin}/auth?mode=register&ref=${encodeURIComponent(code)}`;
}
