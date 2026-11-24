import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CODE_LENGTH,
  codeScreenDestination,
  describeCodeProblem,
  isCompleteCode,
  normalizeCode,
} from "@/lib/otp-code";
import { safeInternalPath } from "@/lib/safe-redirect";

describe("authenticator code entry", () => {
  it("keeps only digits from typed or pasted text, six at most", () => {
    expect(normalizeCode("123456")).toBe("123456");
    expect(normalizeCode("123 456")).toBe("123456");
    expect(normalizeCode("123-456")).toBe("123456");
    expect(normalizeCode("Your code: 987654.")).toBe("987654");
    expect(normalizeCode("12345678")).toBe("123456");
    expect(normalizeCode("abc")).toBe("");
    expect(CODE_LENGTH).toBe(6);
  });
  it("a code is complete only with exactly six digits", () => {
    expect(isCompleteCode("123456")).toBe(true);
    expect(isCompleteCode("12345")).toBe(false);
    expect(isCompleteCode("12345a")).toBe(false);
    expect(isCompleteCode("1234567")).toBe(false);
  });
});

describe("where the code screen sends the admin", () => {
  it("back to the page they came from, query included", () => {
    expect(codeScreenDestination(safeInternalPath("/admin/approvals?tab=open"))).toBe(
      "/admin/approvals?tab=open",
    );
  });
  it("never to another site and never back to the code screen", () => {
    expect(codeScreenDestination(safeInternalPath("https://evil.example/x"))).toBe("/admin");
    expect(codeScreenDestination(safeInternalPath("//evil.example"))).toBe("/admin");
    expect(codeScreenDestination(safeInternalPath("/mfa?next=/admin"))).toBe("/admin");
    expect(codeScreenDestination(null)).toBe("/admin");
  });
});

describe("what a failed code says", () => {
  it("wrong code: clear the boxes, ask for the newest code", () => {
    const p = describeCodeProblem({
      code: "mfa_verification_failed",
      status: 422,
      message: "Invalid TOTP code entered",
    });
    expect(p).toMatchObject({ clear: true, retry: false });
    expect(p.message).toMatch(/didn't match/);
  });
  it("too many tries: say wait, never show the raw error", () => {
    const p = describeCodeProblem({ code: "over_request_rate_limit", status: 429, message: "x" });
    expect(p.message).toMatch(/Wait a minute/);
  });
  it("expired challenge: ask for a new code", () => {
    expect(
      describeCodeProblem({ code: "mfa_challenge_expired", status: 422, message: "" }).message,
    ).toMatch(/newest code/);
  });
  it("no connection: keep the code and offer Try again", () => {
    const p = describeCodeProblem({
      name: "AuthRetryableFetchError",
      message: "Failed to fetch",
      status: 0,
    });
    expect(p).toMatchObject({ clear: false, retry: true });
  });
  it("authenticator removed by the other owner: say so", () => {
    expect(
      describeCodeProblem({
        code: "mfa_factor_not_found",
        status: 404,
        message: "Factor not found",
      }).message,
    ).toMatch(/no longer linked/);
  });
});

describe("/mfa screen source", () => {
  const src = readFileSync("src/routes/_authenticated/mfa.tsx", "utf8");
  it("always asks for a code when an authenticator is set up (renewing the 15-minute window)", () => {
    // The old screen skipped straight back for any aal2 session, so an admin whose code was older than
    // 15 minutes could not renew it without signing out, and the 30-day redirect could loop.
    expect(src).not.toMatch(/currentLevel === "aal2"/);
  });
  it("never shows a generated code; the secret appears only while setting up", () => {
    expect(src).not.toMatch(/console\.(log|info|debug)/);
    expect(src.match(/\{secret\}/g)?.length ?? 0).toBe(1);
  });
});
