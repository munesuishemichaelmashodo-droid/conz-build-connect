import { describe, expect, it } from "vitest";
import { bookingOutcome, newBookingAttemptId } from "@/lib/booking-attempt";

const ID = "6f1c0c1e-2a55-4a3e-9d7a-0d9f6a2b1c11";

describe("newBookingAttemptId", () => {
  it("returns a v4 UUID and a different one each call", () => {
    const a = newBookingAttemptId();
    const b = newBookingAttemptId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe("bookingOutcome", () => {
  it("a clean insert is created", () => {
    expect(bookingOutcome(null, null, ID)).toEqual({ kind: "created" });
  });

  it("an error with no job saved is a real failure and keeps the server's message", () => {
    expect(
      bookingOutcome({ message: "The delivery location must be in Zimbabwe." }, null, ID),
    ).toEqual({
      kind: "failed",
      message: "The delivery location must be in Zimbabwe.",
    });
  });

  it("a retry after a lost response finds the job already saved and does not report an error", () => {
    // The first insert succeeded but its reply never arrived; the retry is refused (the quote is
    // single-use) with a misleading message. The job exists under this attempt's id.
    expect(
      bookingOutcome(
        { message: "Your price quote is missing or has expired — please get a new quote." },
        ID,
        ID,
      ),
    ).toEqual({ kind: "already_created" });
  });

  it("a different job with another id never counts as this attempt", () => {
    expect(bookingOutcome({ message: "boom" }, "00000000-0000-4000-8000-000000000000", ID)).toEqual(
      {
        kind: "failed",
        message: "boom",
      },
    );
  });

  it("gives a plain fallback message when the error has none", () => {
    expect(bookingOutcome({}, null, ID)).toEqual({
      kind: "failed",
      message: "We could not post your job. Check your connection and try again.",
    });
  });
});
