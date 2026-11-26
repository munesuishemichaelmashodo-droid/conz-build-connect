import { describe, expect, it } from "vitest";
import {
  dueLabel,
  parsePlan,
  parseStageRecords,
  stageAmountsDisagree,
  stageStatus,
  stageStatusLabel,
} from "@/lib/direct-payment";

const [rec] = parseStageRecords([
  {
    stage: "deposit",
    expected_amount: "100",
    customer_claimed_at: "t1",
    customer_amount: "100",
    customer_method: "ecocash",
  },
]);

describe("payment stages (0179)", () => {
  it("parses the plan for deposit + balance", () => {
    const plan = parsePlan([
      {
        stage: "deposit",
        expected_amount: 100,
        due: "before_pickup",
        recipient_account: "0771234567",
      },
      { stage: "balance", expected_amount: "300", due: "on_delivery" },
      { stage: "bogus", expected_amount: 1 },
    ]);
    expect(plan.map((p) => [p.stage, p.expectedAmount, p.due])).toEqual([
      ["deposit", 100, "before_pickup"],
      ["balance", 300, "on_delivery"],
    ]);
    expect(plan[0].recipientAccount).toBe("0771234567");
  });
  it("follows the statements in order; an open dispute wins", () => {
    expect(stageStatus(undefined, "none")).toBe("not_recorded");
    expect(stageStatus(rec, "none")).toBe("customer_says_paid");
    const conf = { ...rec, driverConfirmedAt: "t2", driverAmount: 100 };
    expect(stageStatus(conf, "none")).toBe("driver_confirmed");
    expect(stageStatus({ ...conf, customerAcknowledgedAt: "t3" }, "none")).toBe(
      "customer_acknowledged",
    );
    expect(stageStatus({ ...conf, customerAcknowledgedAt: "t3" }, "open")).toBe("disputed");
  });
  it("labels never say verified, guaranteed or protected", () => {
    for (const s of [
      "not_recorded",
      "customer_says_paid",
      "driver_confirmed",
      "customer_acknowledged",
      "disputed",
    ] as const) {
      expect(stageStatusLabel(s)).not.toMatch(/verif|guarant|protect/i);
    }
  });
  it("flags amounts that differ from the agreed amount or from each other", () => {
    expect(stageAmountsDisagree(rec)).toBe(false);
    expect(stageAmountsDisagree({ ...rec, driverAmount: 90, driverConfirmedAt: "t" })).toBe(true);
    expect(stageAmountsDisagree({ ...rec, customerAmount: 80 })).toBe(true);
  });
  it("describes due stages in plain words", () => {
    expect(dueLabel("before_pickup")).toBe("before pickup");
    expect(dueLabel(null)).toBe("as agreed with the driver");
  });
});
