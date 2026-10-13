// Truthful wording for a withdrawal request. Payouts are MANUAL: "approved" means the request was
// accepted and the amount was debited from the wallet; money has been sent only when an admin has
// recorded the transfer (paid_at, migration 0094). Never describe approval as a completed payout.

export type WithdrawalStage =
  "awaiting_review" | "payout_pending" | "payout_recorded" | "rejected" | "cancelled" | "failed" | "unknown";

export function withdrawalStage(status: string, paidAt?: string | null): WithdrawalStage {
  switch (status) {
    case "pending":
      return "awaiting_review";
    case "approved":
      return paidAt ? "payout_recorded" : "payout_pending";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    default:
      return "unknown";
  }
}

export const WITHDRAWAL_STAGE_LABEL: Record<WithdrawalStage, string> = {
  awaiting_review: "Awaiting review",
  payout_pending: "Approved · payout pending",
  payout_recorded: "Payout recorded as sent",
  rejected: "Rejected",
  cancelled: "Cancelled",
  failed: "Payout failed · money returned",
  unknown: "Unknown",
};
