// 0184: signals for a person to review. They are never proof and never trigger anything automatically.
export type TrustSignal = {
  signal: string;
  detail: string;
  user_ids: string[] | null;
  job_ids: string[] | null;
  seen: number;
};

const LABELS: Record<string, { title: string; check: string }> = {
  shared_phone: {
    title: "Same phone number on several accounts",
    check:
      "Families and businesses can share a phone. Check names, documents and activity before deciding.",
  },
  customer_driver_same_phone: {
    title: "Customer and driver share a phone number",
    check:
      "A driver may be booking themselves to build history. Check the job, photos and payment statements.",
  },
  repeated_pair_30_days: {
    title: "Same customer and driver, many jobs in 30 days",
    check:
      "Often a genuine regular customer. Check that deliveries, photos and locations look real.",
  },
  payment_reference_reused: {
    title: "One payment reference on several jobs",
    check: "Statements are the parties' own words. Ask both parties for the transfer details.",
  },
  flagged_referral: {
    title: "Referral flagged at sign-up",
    check: "Decide it on the Referrals screen; clearing the flag needs a reason.",
  },
};

export function signalLabel(signal: string): { title: string; check: string } {
  return LABELS[signal] ?? { title: signal.replace(/_/g, " "), check: "Review before deciding." };
}

export function parseSignals(raw: unknown): TrustSignal[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is TrustSignal =>
      !!r && typeof r === "object" && typeof (r as TrustSignal).signal === "string",
  );
}
