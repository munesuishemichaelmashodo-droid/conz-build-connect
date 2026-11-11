import { describe, expect, it } from "vitest";
import {
  authenticatorPrompt,
  mustVerifyBeforeAdmin,
  parsePolicy,
  type AuthenticatorPolicy,
} from "@/lib/admin-authenticator";

const base: AuthenticatorPolicy = {
  required: false,
  has_authenticator: false,
  last_verified_at: null,
  max_age_days: 30,
  expired: false,
  days_left: null,
};

describe("parsePolicy", () => {
  it("reads what the database returns", () => {
    expect(
      parsePolicy({
        required: true,
        has_authenticator: true,
        last_verified_at: "2026-11-11T10:00:00Z",
        max_age_days: 30,
        expired: false,
        days_left: 12,
      }),
    ).toMatchObject({ required: true, has_authenticator: true, days_left: 12 });
  });
  it("returns null for anything unreadable, so nothing is blocked by mistake", () => {
    expect(parsePolicy(null)).toBeNull();
    expect(parsePolicy("x")).toBeNull();
    expect(parsePolicy({})).toBeNull();
  });
});

describe("authenticatorPrompt", () => {
  it("asks an admin with no authenticator to set one up, urgently only when it is required", () => {
    expect(authenticatorPrompt(base)).toMatchObject({ kind: "setup", urgent: false });
    expect(authenticatorPrompt({ ...base, required: true })).toMatchObject({
      kind: "setup",
      urgent: true,
    });
  });
  it("asks for a code once the 30 days have passed", () => {
    const p = authenticatorPrompt({ ...base, has_authenticator: true, expired: true });
    expect(p).toMatchObject({ kind: "verify", urgent: true, cta: "Verify now" });
    expect(p.body).toContain("30 days");
  });
  it("shows the days left, and that crucial changes always ask for a fresh code", () => {
    const p = authenticatorPrompt({ ...base, has_authenticator: true, days_left: 12 });
    expect(p.kind).toBe("ok");
    expect(p.body).toContain("12 days");
    expect(p.body).toContain("fresh code");
    expect(authenticatorPrompt({ ...base, has_authenticator: true, days_left: 1 }).body).toContain(
      "1 day ",
    );
  });
});

describe("mustVerifyBeforeAdmin", () => {
  it("only blocks an admin who has an authenticator that is past the limit", () => {
    expect(mustVerifyBeforeAdmin(null)).toBe(false);
    expect(mustVerifyBeforeAdmin(base)).toBe(false);
    expect(mustVerifyBeforeAdmin({ ...base, required: true })).toBe(false);
    expect(mustVerifyBeforeAdmin({ ...base, has_authenticator: true, expired: false })).toBe(false);
    expect(mustVerifyBeforeAdmin({ ...base, has_authenticator: true, expired: true })).toBe(true);
  });
});
