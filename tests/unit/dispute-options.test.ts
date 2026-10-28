import { describe, expect, it } from "vitest";
import { DISPUTE_OPTIONS, disputeOption, disputeReason } from "@/lib/dispute-options";

const DB_CATEGORIES = ["wrong_quantity", "damage", "no_show", "payment_issue", "conduct", "other"];

describe("dispute options", () => {
  it("gives the customer and the driver different problems", () => {
    const customer = DISPUTE_OPTIONS.customer.map((o) => o.label);
    const driver = DISPUTE_OPTIONS.driver.map((o) => o.label);
    expect(customer).toContain("Driver didn't arrive");
    expect(driver).not.toContain("Driver didn't arrive");
    expect(driver).toContain("Customer won't give the delivery PIN");
    expect(customer).not.toContain("Customer won't give the delivery PIN");
  });
  it("only uses categories the database accepts, with unique ids", () => {
    const all = [...DISPUTE_OPTIONS.customer, ...DISPUTE_OPTIONS.driver];
    for (const o of all) expect(DB_CATEGORIES).toContain(o.category);
    expect(new Set(all.map((o) => o.id)).size).toBe(all.length);
  });
  it("won't let one side pick the other side's option", () => {
    expect(disputeOption("driver", "driver_no_show")).toBeNull();
    expect(disputeOption("customer", "driver_no_show")?.category).toBe("no_show");
  });
  it("keeps the chosen wording in the reason", () => {
    const o = disputeOption("driver", "pin_refused")!;
    expect(disputeReason(o, "  Tipped at 3pm, customer left.  ")).toBe(
      "Customer won't give the delivery PIN: Tipped at 3pm, customer left.",
    );
  });
});
