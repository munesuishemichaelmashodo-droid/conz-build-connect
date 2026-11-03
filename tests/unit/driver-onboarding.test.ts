import { describe, expect, it } from "vitest";
import {
  DOC_MAX_BYTES,
  STAGES,
  detailsComplete,
  hasSubmitted,
  isOtpFormatValid,
  mapOtpError,
  missingRequired,
  normalisePhone,
  statusView,
  validateDocFile,
  phoneStatus,
  phoneStepComplete,
  firstUnfinishedStage,
  applicationChecklist,
} from "@/lib/driver-onboarding";

const allDocs = {
  selfie_url: "a",
  national_id_url: "b",
  license_url: "c",
  tipper_photo_url: "d",
  tipper_photo_side_url: "e",
  tipper_photo_back_url: "f",
};

describe("driver onboarding stages", () => {
  it("has exactly four stages in the agreed order", () => {
    expect(STAGES.map((s) => s.key)).toEqual(["phone", "details", "documents", "status"]);
  });
});

describe("validateDocFile", () => {
  it("accepts photos and PDFs within the size limit", () => {
    expect(validateDocFile({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(validateDocFile({ type: "application/pdf", size: DOC_MAX_BYTES })).toBeNull();
  });
  it("rejects other types, empty files and oversize files", () => {
    expect(validateDocFile({ type: "text/html", size: 10 })).not.toBeNull();
    expect(validateDocFile({ type: "image/png", size: 0 })).not.toBeNull();
    expect(validateDocFile({ type: "image/png", size: DOC_MAX_BYTES + 1 })).not.toBeNull();
  });
});

describe("missingRequired / hasSubmitted", () => {
  it("lists every missing required document and the truck", () => {
    expect(missingRequired({}, false)).toHaveLength(7);
    expect(missingRequired(allDocs, true)).toEqual([]);
    expect(missingRequired(allDocs, false)).toEqual(["Truck registration and capacity"]);
  });
  it("does not treat a fresh pending profile as submitted", () => {
    expect(hasSubmitted("pending", {}, false, "Zimbabwe")).toBe(false);
    expect(hasSubmitted("pending", allDocs, true, "Zimbabwe")).toBe(true);
    expect(hasSubmitted("pending", allDocs, true, "")).toBe(false);
    expect(hasSubmitted("rejected", {}, false, null)).toBe(true);
  });
});

describe("details", () => {
  it("needs a name and nationality", () => {
    expect(detailsComplete("A", "Zimbabwe")).toBe(false);
    expect(detailsComplete("Tendai M", "")).toBe(false);
    expect(detailsComplete("Tendai M", "Zimbabwe")).toBe(true);
  });
});

describe("normalisePhone", () => {
  it("drops the local leading zero", () => {
    expect(normalisePhone("+263", "0771234567")).toBe("+263771234567");
    expect(normalisePhone("+263", "77 123 4567")).toBe("+263771234567");
  });
  it("does not double the dial code", () => {
    expect(normalisePhone("+263", "263771234567")).toBe("+263771234567");
  });
  it("rejects empty, too short or too long numbers", () => {
    expect(normalisePhone("+263", "")).toBeNull();
    expect(normalisePhone("+263", "12")).toBeNull();
    expect(normalisePhone("+263", "1234567890123456")).toBeNull();
  });
});

describe("OTP", () => {
  it("accepts only six digits", () => {
    expect(isOtpFormatValid("123456")).toBe(true);
    expect(isOtpFormatValid("12345")).toBe(false);
    expect(isOtpFormatValid("12345a")).toBe(false);
  });
  it("maps provider errors to actionable messages", () => {
    expect(mapOtpError("Token has expired or is invalid").code).toBe("wrong_or_expired");
    expect(mapOtpError("Token has expired").code).toBe("expired");
    expect(
      mapOtpError("For security purposes, you can only request this after 45 seconds").code,
    ).toBe("rate_limited");
    expect(mapOtpError("Unsupported phone provider").code).toBe("not_configured");
    expect(mapOtpError("Invalid token").code).toBe("invalid");
    expect(mapOtpError("fetch failed").code).toBe("unknown");
    expect(mapOtpError(undefined).code).toBe("unknown");
  });
});

describe("statusView", () => {
  it("only an approved driver may enter Driver Mode", () => {
    expect(statusView("verified").canEnterDriverMode).toBe(true);
    expect(statusView("pending").canEnterDriverMode).toBe(false);
    expect(statusView("rejected", "ID photo unreadable").canEnterDriverMode).toBe(false);
    expect(statusView(null).canEnterDriverMode).toBe(false);
  });
  it("shows the rejection reason when there is one", () => {
    expect(statusView("rejected", " ID photo unreadable ").body).toContain("ID photo unreadable");
    expect(statusView("rejected", "").kind).toBe("rejected");
  });
  it("labels the three states", () => {
    expect(statusView("pending").title).toBe("Under review");
    expect(statusView("verified").title).toBe("Approved");
    expect(statusView("rejected").title).toBe("Not approved");
  });
});

describe("phone without SMS", () => {
  it("a saved number is complete for the phone step without any SMS", () => {
    expect(phoneStepComplete("+263771234567")).toBe(true);
    expect(phoneStepComplete(null)).toBe(false);
    expect(phoneStepComplete("12")).toBe(false);
  });

  it("an entered number stays unverified", () => {
    expect(
      phoneStatus({ profilePhone: "+263771234567", authPhone: null, authPhoneConfirmedAt: null }),
    ).toBe("unverified");
  });

  it("is SMS-verified only when Supabase confirmed that same number", () => {
    expect(
      phoneStatus({
        profilePhone: "+263771234567",
        authPhone: "263771234567",
        authPhoneConfirmedAt: "2026-10-01T00:00:00Z",
      }),
    ).toBe("sms_verified");
    // Confirmed a different number earlier: the saved one is not verified.
    expect(
      phoneStatus({
        profilePhone: "+263779999999",
        authPhone: "263771234567",
        authPhoneConfirmedAt: "2026-10-01T00:00:00Z",
      }),
    ).toBe("unverified");
    // Auth phone set but never confirmed.
    expect(
      phoneStatus({
        profilePhone: "+263771234567",
        authPhone: "263771234567",
        authPhoneConfirmedAt: null,
      }),
    ).toBe("unverified");
  });

  it("is missing with no saved number", () => {
    expect(phoneStatus({ profilePhone: "", authPhone: null, authPhoneConfirmedAt: null })).toBe(
      "missing",
    );
  });
});

describe("firstUnfinishedStage (resume)", () => {
  it("starts at the phone step when no number is saved", () => {
    expect(firstUnfinishedStage({ submitted: false, phoneSaved: false, detailsDone: false })).toBe(
      0,
    );
  });
  it("resumes at details once the number is saved", () => {
    expect(firstUnfinishedStage({ submitted: false, phoneSaved: true, detailsDone: false })).toBe(
      1,
    );
  });
  it("resumes at documents once details are saved", () => {
    expect(firstUnfinishedStage({ submitted: false, phoneSaved: true, detailsDone: true })).toBe(2);
  });
  it("shows the status once submitted, whatever else", () => {
    expect(firstUnfinishedStage({ submitted: true, phoneSaved: false, detailsDone: false })).toBe(
      3,
    );
  });
});

describe("applicationChecklist", () => {
  const base = {
    phone: "unverified" as const,
    submitted: true,
    status: "pending" as const,
    isDriver: false,
  };

  it("keeps phone, review and approval as separate lines", () => {
    const rows = applicationChecklist(base);
    expect(rows.map((r) => r.key)).toEqual([
      "account",
      "application",
      "phone",
      "identity",
      "truck",
      "approval",
    ]);
  });

  it("never calls an entered number verified", () => {
    const phone = applicationChecklist(base).find((r) => r.key === "phone")!;
    expect(phone.state).toBe("todo");
    expect(phone.label).toMatch(/not verified/i);
    expect(phone.label).not.toMatch(/sms verified/i);
  });

  it("labels an SMS-confirmed number as such", () => {
    const phone = applicationChecklist({ ...base, phone: "sms_verified" }).find(
      (r) => r.key === "phone",
    )!;
    expect(phone.state).toBe("done");
    expect(phone.label).toMatch(/verified by sms/i);
  });

  it("a pending application is not approved", () => {
    const rows = applicationChecklist(base);
    expect(rows.find((r) => r.key === "approval")!.state).toBe("waiting");
    expect(rows.find((r) => r.key === "identity")!.state).toBe("waiting");
  });

  it("approval needs both verified status and the driver role", () => {
    expect(
      applicationChecklist({ ...base, status: "verified", isDriver: false }).find(
        (r) => r.key === "approval",
      )!.state,
    ).toBe("waiting");
    expect(
      applicationChecklist({ ...base, status: "verified", isDriver: true }).find(
        (r) => r.key === "approval",
      )!.state,
    ).toBe("done");
  });

  it("shows a rejection on the review lines", () => {
    const rows = applicationChecklist({ ...base, status: "rejected" });
    expect(rows.find((r) => r.key === "identity")!.state).toBe("problem");
    expect(rows.find((r) => r.key === "approval")!.state).toBe("problem");
  });

  it("not submitted yet", () => {
    const rows = applicationChecklist({ ...base, submitted: false });
    expect(rows.find((r) => r.key === "application")!.state).toBe("todo");
  });
});
