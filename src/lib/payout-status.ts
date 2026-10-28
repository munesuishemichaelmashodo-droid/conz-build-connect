// Driver payout statuses (0121) in the words drivers and admins see.

export type PayoutStatus =
  "waiting_for_number" | "queued" | "sending" | "sent" | "succeeded" | "returned";

const LABELS: Record<PayoutStatus, string> = {
  waiting_for_number: "Waiting for your EcoCash number",
  queued: "Sending soon",
  sending: "Sending",
  sent: "On its way",
  succeeded: "Sent to EcoCash",
  returned: "Not sent: in your wallet",
};

export function payoutStatusLabel(status: string): string {
  return LABELS[status as PayoutStatus] ?? status;
}

export const PAYOUT_IN_FLIGHT: PayoutStatus[] = ["queued", "sending", "sent"];
