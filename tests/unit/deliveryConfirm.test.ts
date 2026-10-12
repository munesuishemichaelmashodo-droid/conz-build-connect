import { describe, expect, it } from "vitest";
import {
  completeJobArgs,
  deliveryConfirmErrorMessage,
  interpretCompleteResult,
  isMissingFunctionError,
} from "@/lib/deliveryConfirm";

describe("delivery confirmation compatibility", () => {
  it("sends the code when we have one and omits it otherwise", () => {
    expect(completeJobArgs("j1", "123456")).toEqual({ _job_id: "j1", _pin: "123456" });
    expect(completeJobArgs("j1", " 123456 ")).toEqual({ _job_id: "j1", _pin: "123456" });
    expect(completeJobArgs("j1", null)).toEqual({ _job_id: "j1" });
    expect(completeJobArgs("j1", "")).toEqual({ _job_id: "j1" });
    // Fallback for a database that predates the code parameter.
    expect(completeJobArgs("j1", "123456", false)).toEqual({ _job_id: "j1" });
  });

  it("recognises a database that predates the new signature (so the app can retry once without the code)", () => {
    expect(isMissingFunctionError({ code: "PGRST202", message: "x" })).toBe(true);
    expect(
      isMissingFunctionError({
        message:
          "Could not find the function public.complete_job(_job_id, _pin) in the schema cache",
      }),
    ).toBe(true);
    expect(
      isMissingFunctionError({ message: "The delivery code is required to confirm delivery." }),
    ).toBe(false);
    expect(isMissingFunctionError({ message: "Only the customer can confirm completion" })).toBe(
      false,
    );
    expect(isMissingFunctionError(null)).toBe(false);
  });

  it("never reads a failure result as success", () => {
    expect(interpretCompleteResult({ ok: false, error: "wrong_pin", message: "x" })).toMatchObject({
      kind: "failed",
      reason: "wrong_pin",
      refreshCode: false,
    });
    expect(
      interpretCompleteResult({ ok: false, error: "pin_expired", message: "x" }),
    ).toMatchObject({ kind: "failed", refreshCode: true });
    expect(interpretCompleteResult({ ok: false, error: "pin_used" })).toMatchObject({
      kind: "failed",
      refreshCode: true,
    });
    expect(interpretCompleteResult({ ok: false, error: "locked", message: "x" })).toMatchObject({
      kind: "failed",
    });
  });

  it("treats success, repeat success and legacy row shapes as confirmed", () => {
    expect(interpretCompleteResult({ ok: true })).toEqual({ kind: "confirmed", already: false });
    expect(interpretCompleteResult({ ok: true, already: true })).toEqual({
      kind: "confirmed",
      already: true,
    });
    expect(interpretCompleteResult({ id: "legacy-job-row", status: "completed" })).toEqual({
      kind: "confirmed",
      already: false,
    });
  });

  it("gives plain-language messages for raised errors", () => {
    expect(
      deliveryConfirmErrorMessage("The delivery code is required to confirm delivery."),
    ).toMatch(/Enter your delivery code/);
    expect(deliveryConfirmErrorMessage("Upload the delivery photo first")).toMatch(/photo/);
    expect(deliveryConfirmErrorMessage("This job does not use delivery PIN confirmation")).toMatch(
      /customer/,
    );
    expect(deliveryConfirmErrorMessage("Something unrelated")).toBe("Something unrelated");
  });
});
