import { describe, expect, it } from "vitest";
import { WITHDRAWAL_STAGE_LABEL, withdrawalStage } from "@/lib/withdrawalStatus";

describe("withdrawalStage", () => {
  it("pending is awaiting review", () => {
    expect(withdrawalStage("pending")).toBe("awaiting_review");
    expect(withdrawalStage("pending", "2026-10-12T00:00:00Z")).toBe("awaiting_review");
  });
  it("approved without a recorded payout is NOT paid", () => {
    expect(withdrawalStage("approved")).toBe("payout_pending");
    expect(withdrawalStage("approved", null)).toBe("payout_pending");
    expect(WITHDRAWAL_STAGE_LABEL.payout_pending.toLowerCase()).not.toContain("paid");
    expect(WITHDRAWAL_STAGE_LABEL.payout_pending.toLowerCase()).not.toContain("sent");
  });
  it("only a recorded payout reads as sent", () => {
    expect(withdrawalStage("approved", "2026-10-12T00:00:00Z")).toBe("payout_recorded");
  });
  it("closed and unknown statuses", () => {
    expect(withdrawalStage("rejected")).toBe("rejected");
    expect(withdrawalStage("cancelled")).toBe("cancelled");
    expect(withdrawalStage("failed")).toBe("failed");
    expect(withdrawalStage("weird")).toBe("unknown");
  });
});
