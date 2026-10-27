// Customer/driver wording for supplier stock (0101). Recorded stock is ADVISORY: it is never a promise of
// availability and never blocks a request. Only an explicit supply confirmation (0104) is shown as confirmed.

export type StockStatus = "unknown" | "confirmed" | "below_requested";

export type StockCopy = {
  /** Short headline. Never says "available" or "in stock" for an unconfirmed supply. */
  title: string;
  /** One honest sentence for the customer. */
  detail: string;
  tone: "neutral" | "warn";
};

export function normalizeStockStatus(value: unknown): StockStatus {
  return value === "confirmed" || value === "below_requested" ? value : "unknown";
}

export function stockStatusCopy(status: unknown): StockCopy {
  switch (normalizeStockStatus(status)) {
    case "confirmed":
      return {
        title: "Estimated availability",
        detail:
          "The supplier's recorded stock covers this order. This is an estimate — your driver confirms the supply at loading.",
        tone: "neutral",
      };
    case "below_requested":
      return {
        title: "Availability to be confirmed",
        detail:
          "The supplier's recorded stock is lower than your order, so we will confirm the supply (or another source) before loading.",
        tone: "warn",
      };
    default:
      return {
        title: "Availability not yet confirmed",
        detail:
          "No stock is recorded for this supplier. The route is measured on real roads and the price is an estimate; we confirm the supply before loading and tell you when it is confirmed.",
        tone: "warn",
      };
  }
}

/** Wording for the confirmed state (0104). */
export function supplyConfirmedCopy(role: string | null | undefined): string {
  return role === "admin" ? "Supply confirmed by ConZ" : "Supply confirmed by your driver";
}
