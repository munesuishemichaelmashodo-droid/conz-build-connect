import { describe, expect, it } from "vitest";
import { decideGuard, keepIfFailed, localUserFromStorage, roleVerdict } from "@/lib/auth-guard";

const isNet = (e: unknown) => (e as { name?: string } | null)?.name === "AuthRetryableFetchError";
const netErr = { name: "AuthRetryableFetchError", message: "Failed to fetch" };
const authErr = { name: "AuthApiError", message: "invalid JWT" };
const u = { id: "u1", email: "a@b.c" };

describe("decideGuard", () => {
  it("lets a verified user in", () => {
    expect(
      decideGuard({ serverUser: u, serverError: null, localUser: null, isNetworkError: isNet }),
    ).toEqual({
      kind: "ok",
      user: u,
      offline: false,
    });
  });
  it("lets a signed-in user keep working when only the network failed", () => {
    expect(
      decideGuard({ serverUser: null, serverError: netErr, localUser: u, isNetworkError: isNet }),
    ).toEqual({
      kind: "ok",
      user: u,
      offline: true,
    });
  });
  it("still sends a real sign-out, expired or revoked session to the sign-in screen", () => {
    expect(
      decideGuard({ serverUser: null, serverError: authErr, localUser: u, isNetworkError: isNet }),
    ).toEqual({
      kind: "redirect",
    });
  });
  it("sends someone who was never signed in to the sign-in screen, even when offline", () => {
    expect(
      decideGuard({
        serverUser: null,
        serverError: netErr,
        localUser: null,
        isNetworkError: isNet,
      }),
    ).toEqual({
      kind: "redirect",
    });
    expect(
      decideGuard({ serverUser: null, serverError: null, localUser: null, isNetworkError: isNet }),
    ).toEqual({
      kind: "redirect",
    });
  });
});

describe("localUserFromStorage", () => {
  const store = (entries: Record<string, string>) => ({
    length: Object.keys(entries).length,
    key: (i: number) => Object.keys(entries)[i] ?? null,
    getItem: (k: string) => entries[k] ?? null,
  });
  it("reads the signed-in user the Supabase client keeps on the phone", () => {
    const s = store({
      "sb-abc-auth-token": JSON.stringify({
        user: { id: "u1", email: "a@b.c" },
        access_token: "x",
      }),
    });
    expect(localUserFromStorage(s)).toEqual({ id: "u1", email: "a@b.c" });
  });
  it("returns null for missing, malformed or user-less entries and for unavailable storage", () => {
    expect(localUserFromStorage(store({}))).toBeNull();
    expect(localUserFromStorage(store({ "sb-abc-auth-token": "{not json" }))).toBeNull();
    expect(
      localUserFromStorage(store({ "sb-abc-auth-token": JSON.stringify({ access_token: "x" }) })),
    ).toBeNull();
    expect(
      localUserFromStorage(store({ other: JSON.stringify({ user: { id: "u9" } }) })),
    ).toBeNull();
    expect(localUserFromStorage(null)).toBeNull();
    expect(
      localUserFromStorage({
        length: 1,
        key: () => {
          throw new Error("blocked");
        },
        getItem: () => null,
      }),
    ).toBeNull();
  });
});

describe("keepIfFailed", () => {
  const roles = (d: unknown) => (d as { role: string }[]).map((x) => x.role);
  it("uses a real answer, even an empty one", () => {
    expect(keepIfFailed(["driver"], { data: [{ role: "customer" }], error: null }, roles)).toEqual([
      "customer",
    ]);
    expect(keepIfFailed(["driver"], { data: [], error: null }, roles)).toEqual([]);
  });
  it("keeps what the app already knew when the read failed (a dropped connection is not 'no roles')", () => {
    expect(
      keepIfFailed(["driver"], { data: null, error: { message: "Failed to fetch" } }, roles),
    ).toEqual(["driver"]);
  });
  it("treats a missing row as 'none' only when the read succeeded", () => {
    expect(
      keepIfFailed<string | null>("Rudo", { data: null, error: null }, (d) => d as string | null),
    ).toBeNull();
    expect(
      keepIfFailed<string | null>(
        "Rudo",
        { data: null, error: { message: "x" } },
        (d) => d as string | null,
      ),
    ).toBe("Rudo");
  });
});

describe("roleVerdict", () => {
  const net = (e: unknown) => /fetch/i.test((e as { message?: string } | null)?.message ?? "");
  it("allows someone who holds an allowed role", () => {
    expect(
      roleVerdict({ roles: ["driver"], error: null, allowed: ["driver"], isNetworkError: net }),
    ).toBe("allow");
    expect(
      roleVerdict({
        roles: ["admin", "driver"],
        error: null,
        allowed: ["customer", "driver"],
        isNetworkError: net,
      }),
    ).toBe("allow");
  });
  it("denies someone who really does not hold the role", () => {
    expect(
      roleVerdict({ roles: ["customer"], error: null, allowed: ["driver"], isNetworkError: net }),
    ).toBe("deny");
    expect(roleVerdict({ roles: [], error: null, allowed: ["driver"], isNetworkError: net })).toBe(
      "deny",
    );
  });
  it("does not bounce a driver off their own screen because the role lookup failed for lack of signal", () => {
    expect(
      roleVerdict({
        roles: null,
        error: { message: "TypeError: Failed to fetch" },
        allowed: ["driver"],
        isNetworkError: net,
      }),
    ).toBe("allow");
  });
  it("still denies when the lookup failed for a real reason (not the network)", () => {
    expect(
      roleVerdict({
        roles: null,
        error: { message: "permission denied" },
        allowed: ["driver"],
        isNetworkError: net,
      }),
    ).toBe("deny");
  });
});
