import { describe, expect, it } from "vitest";
import { chatSafetyFlag, chatSafetyMessage } from "@/lib/chat-safety";

describe("chat safety warnings", () => {
  it("flags requests to pay early or pay someone else", () => {
    expect(chatSafetyFlag("Please send the money first before I load")).toBe("payment_request");
    expect(chatSafetyFlag("You need to pay a booking fee")).toBe("payment_request");
    expect(chatSafetyFlag("Pay to this number 0771234567 not mine")).toBe("payment_request");
    expect(chatSafetyFlag("Pay my brother on ecocash")).toBe("payment_request");
    expect(chatSafetyFlag("There is a ConZ fee you must pay me")).toBe("payment_request");
  });
  it("flags moving the deal outside Con Z", () => {
    expect(chatSafetyFlag("Next time let's do it outside ConZ")).toBe("off_platform");
    expect(chatSafetyFlag("Don't use the app, just call me")).toBe("off_platform");
  });
  it("leaves ordinary delivery coordination alone", () => {
    for (const t of [
      "I'm outside with the delivery",
      "The gate is blue, number 12 Main Road",
      "Call me on 0771234567 when you arrive",
      "I will pay on delivery as agreed",
      "Loaded, leaving the quarry now",
      "",
      null,
    ]) {
      expect(chatSafetyFlag(t)).toBeNull();
    }
  });
  it("messages never promise protection", () => {
    expect(chatSafetyMessage("payment_request")).not.toMatch(/guarant|protect|refund/i);
    expect(chatSafetyMessage("off_platform")).not.toMatch(/guarant|protect|refund/i);
  });
});
