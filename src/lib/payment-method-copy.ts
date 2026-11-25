// How a job was paid, in plain words, for receipts and completion screens.
//
// Three payment methods exist (jobs.payment_method):
//  * "direct"   – the customer paid the driver; ConZ's 7% came from the driver's commission credit.
//  * "escrow"   – Con Z Pay (off at launch); wording unchanged from before.
//  * "provider" – the customer paid online through ConZ (0171). ConZ's 7% is taken once from the fare and the rest is
//                 recorded as owed to the driver (driver_payables). Payouts are not automatic, so nothing here
//                 promises when or how the driver is paid. Never call it escrow, protected or guaranteed.
// Anything else (missing or unknown) is described as direct, which was the only method before 0171.

export type PaymentMethod = "direct" | "escrow" | "provider";

export function normalisePaymentMethod(raw: unknown): PaymentMethod {
  return raw === "escrow" || raw === "provider" ? raw : "direct";
}

/** Short label: "Paid with …" rows and the tracking page. */
export function paymentMethodLabel(raw: unknown): string {
  switch (normalisePaymentMethod(raw)) {
    case "escrow":
      return "Con Z Pay";
    case "provider":
      return "Online through Con Z";
    default:
      return "Directly to driver";
  }
}

/** The receipt PDF's "Payment method" line. */
export function receiptPaymentMethod(raw: unknown): string {
  switch (normalisePaymentMethod(raw)) {
    case "escrow":
      return "Con Z Pay (held & released on confirmation)";
    case "provider":
      return "Paid online through Con Z";
    default:
      return "Paid directly to driver";
  }
}

/** The note under "You earned" on the driver's delivery-complete screen. */
export function driverEarningsNote(raw: unknown, withdrawalsEnabled: boolean): string {
  switch (normalisePaymentMethod(raw)) {
    case "escrow":
      return withdrawalsEnabled
        ? "Released from Con Z Pay into your wallet. Withdraw it from Wallet when you're ready."
        : "Released from Con Z Pay into your wallet. Withdrawals are paused for now: contact support and we'll pay it out to you.";
    case "provider":
      return "The customer paid online through Con Z. Con Z's fee is already taken out and the rest is recorded as owed to you: see Wallet, Earnings from Con Z-paid jobs. Your commission credit was not used.";
    default:
      return "Paid to you directly by the customer. The Con Z fee comes off your wallet balance.";
  }
}
