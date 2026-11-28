import { describe, expect, it } from "vitest";
import { parseSignals, signalLabel } from "@/lib/trust-signals";

describe("trust signals", () => {
  it("labels every signal the database returns, with advice that is not an accusation", () => {
    for (const s of [
      "shared_phone",
      "customer_driver_same_phone",
      "repeated_pair_30_days",
      "payment_reference_reused",
      "flagged_referral",
    ]) {
      const l = signalLabel(s);
      expect(l.title.length).toBeGreaterThan(5);
      expect(l.check).not.toMatch(/fraudster|guilty|ban /i);
    }
    expect(signalLabel("something_new").title).toBe("something new");
  });
  it("ignores malformed rows", () => {
    expect(parseSignals(null)).toEqual([]);
    expect(
      parseSignals([
        { signal: "shared_phone", detail: "x", user_ids: null, job_ids: null, seen: 2 },
        5,
        {},
      ]),
    ).toHaveLength(1);
  });
});
