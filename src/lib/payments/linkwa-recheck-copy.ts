// Plain words for the outcome of an admin Linkwa re-check (outcomes come from apply_provider_link_payment, 0175/0171).

export type RecheckTone = "good" | "info" | "warn";

export function recheckMessage(r: { ok: boolean; outcome?: string; error?: string }): {
  tone: RecheckTone;
  text: string;
} {
  if (!r.ok) {
    switch (r.error) {
      case "check_failed":
        return {
          tone: "warn",
          text: "Linkwa did not confirm this reference for this payment's link (wrong reference, another link, or Linkwa unreachable). Nothing was recorded.",
        };
      case "not_found":
        return {
          tone: "warn",
          text: "This payment has no Linkwa link recorded by ConZ. Nothing was recorded.",
        };
      case "forbidden":
        return { tone: "warn", text: "Only a super admin can re-check payments." };
      case "linkwa_sandbox_unavailable":
        return { tone: "warn", text: "Linkwa is not available on this server." };
      case "invalid_input":
        return {
          tone: "warn",
          text: "Check the reference (letters, digits and dashes) and give a reason of at least 5 characters.",
        };
      default:
        return { tone: "warn", text: "The re-check failed. Nothing was recorded." };
    }
  }
  const o = r.outcome ?? "";
  if (o === "applied_paid")
    return {
      tone: "good",
      text: "Linkwa confirmed the payment. It is now recorded as paid, once.",
    };
  if (o === "already_paid" || o === "duplicate")
    return { tone: "info", text: "Already recorded. Nothing changed." };
  if (o === "pending_no_change")
    return { tone: "info", text: "Linkwa still says pending. Nothing changed; try again later." };
  if (o.startsWith("attempt_"))
    return {
      tone: "info",
      text: `Linkwa says this attempt ${o.replace("attempt_", "")}. The payment stays open for another try.`,
    };
  if (o === "second_payment_flagged")
    return {
      tone: "warn",
      text: "A different payment was already recorded on this link. Not applied; finance admins were alerted to refund the extra payment.",
    };
  if (o === "rejected_amount" || o === "rejected_currency")
    return {
      tone: "warn",
      text: "Linkwa's amount or currency does not match the agreed price. Not recorded; flagged for review.",
    };
  return { tone: "warn", text: `Not recorded (${o || "unknown outcome"}); flagged for review.` };
}
