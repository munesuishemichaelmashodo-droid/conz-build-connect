import { describe, expect, it } from "vitest";
import {
  FEEDBACK_COMMENT_MAX,
  FEEDBACK_OPTIONS,
  feedbackPayload,
  isFeedbackAnswer,
  shouldAskFeedback,
} from "@/lib/delivery-feedback";

describe("delivery feedback helpers", () => {
  it("offers the nine agreed answers", () => {
    expect(FEEDBACK_OPTIONS).toHaveLength(9);
    expect(FEEDBACK_OPTIONS.map((o) => o.value)).toContain("properly_confirmed");
  });
  it("accepts only known answers", () => {
    expect(isFeedbackAnswer("price_worked")).toBe(true);
    expect(isFeedbackAnswer("made_up")).toBe(false);
    expect(isFeedbackAnswer(null)).toBe(false);
  });
  it("requires an answer; the comment is optional, trimmed and capped", () => {
    expect(feedbackPayload(null, "hello")).toBeNull();
    expect(feedbackPayload("other", "   ")).toEqual({ _answer: "other", _comment: null });
    expect(feedbackPayload("other", "  fine  ")).toEqual({ _answer: "other", _comment: "fine" });
    const long = feedbackPayload("other", "x".repeat(500));
    expect(long?._comment).toHaveLength(FEEDBACK_COMMENT_MAX);
  });
  it("asks once: an answered or dismissed job is not asked again", () => {
    expect(shouldAskFeedback(null)).toBe(true);
    expect(shouldAskFeedback({ answer: "other", dismissed: false })).toBe(false);
    expect(shouldAskFeedback({ answer: null, dismissed: true })).toBe(false);
  });
});
