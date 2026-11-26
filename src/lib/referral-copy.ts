// Referral wording (0181, owner decision 26/11/2026): referrals earn non-cash recognition only. Nothing here may
// promise money, commission credit, a discount or a bonus. reward_amount on old rows is history and never shown.

export const REFERRAL_PAGE_TITLE = "Refer a friend";

export const REFERRAL_INTRO =
  "Invite drivers and customers you trust. A referral that counts is recognised by Con Z and counts towards your referral milestones. It does not give money, commission credit or a discount.";

export const REFERRAL_RULES: string[] = [
  "Customers you invite count once they complete their first delivery on Con Z, with a driver other than you and no open dispute.",
  "Drivers you invite count once they are verified and have completed 5 jobs on Con Z (jobs for you and jobs under an open dispute do not count).",
  "After that there is a 7-day check. Then the referral is recognised and counts towards your milestones on this page.",
  "Each account can use one referral code, and you cannot refer yourself. Referrals that look like duplicate accounts are checked by a person before they count.",
];

const STATUS: Record<string, { label: string; hint: string }> = {
  pending: { label: "Waiting", hint: "They have not met the requirements yet." },
  approved: {
    label: "Approved",
    hint: "Cleared by Con Z; counts once the requirements and the check are met.",
  },
  hold: { label: "In the 7-day check", hint: "Requirements met. Recognised after the check." },
  released: { label: "Recognised", hint: "Counts towards your referral milestones." },
  rejected: { label: "Not recognised", hint: "Con Z decided this referral does not count." },
  frozen: { label: "Under review", hint: "A person at Con Z is checking this referral." },
};

export function referralStatus(status: string): { label: string; hint: string } {
  return STATUS[status] ?? { label: "Waiting", hint: "" };
}

export function referralRequirement(role: string): string {
  return role === "driver"
    ? "Needs: verified + 5 completed jobs"
    : "Needs: first completed delivery";
}

export function referralShareText(code: string, link: string): string {
  return `Join Con Z Connect to book or deliver construction materials. Use my referral code ${code} when you sign up: ${link}`;
}

export function milestoneLine(recognised: number, next: number | null): string {
  return next
    ? `${recognised} of ${next} recognised referrals to your next milestone`
    : "You have reached every referral milestone. Thank you for helping Con Z grow.";
}
