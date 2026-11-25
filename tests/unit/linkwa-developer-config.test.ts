import { describe, expect, it } from "vitest";
import {
  linkwaDeveloperConfig,
  linkwaSandboxConfig,
  LINKWA_SANDBOX_BASE_URL,
} from "@/lib/payments/linkwa-config.server";

const staging = "https://fpckydgssuefzzxivvig.supabase.co";
const goodEnv = {
  SUPABASE_URL: staging,
  VITE_SUPABASE_URL: staging,
  LINKWA_MODE: "sandbox",
  LINKWA_API_KEY: "sk_sandbox_integration_test",
  LINKWA_WEBHOOK_SECRET: "test-secret",
  LINKWA_DEVELOPER_API_KEY: "sk_sandbox_developer_test",
};

describe("Linkwa developer key (users, wallets, payouts): separate credential, same sandbox guard", () => {
  it("may hold the same Developer app key as collection (Linkwa itself refuses a non-developer key)", () => {
    const env = { ...goodEnv, LINKWA_DEVELOPER_API_KEY: goodEnv.LINKWA_API_KEY };
    expect(linkwaDeveloperConfig(env).ok).toBe(true);
  });

  it("is allowed on staging with its own sandbox key", () => {
    expect(linkwaDeveloperConfig(goodEnv)).toEqual({
      ok: true,
      config: { baseUrl: LINKWA_SANDBOX_BASE_URL, apiKey: "sk_sandbox_developer_test" },
    });
  });

  it("does not change collection: the integration key stays the collection key", () => {
    const c = linkwaSandboxConfig(goodEnv, {
      readEvent: () => null,
      readStatus: () => null,
      linkRequest: () => ({}),
      readCreatedLink: () => null,
    });
    expect(c.ok && c.config.apiKey).toBe("sk_sandbox_integration_test");
  });

  it("collection still works with no developer key set", () => {
    const { LINKWA_DEVELOPER_API_KEY: _omit, ...env } = goodEnv;
    expect(linkwaDeveloperConfig(env)).toEqual({ ok: false, reason: "missing_developer_key" });
    const c = linkwaSandboxConfig(env, {
      readEvent: () => null,
      readStatus: () => null,
      linkRequest: () => ({}),
      readCreatedLink: () => null,
    });
    expect(c.ok).toBe(true);
  });

  it.each([
    [{ SUPABASE_URL: "https://ovwrsocjmkpiygipmrdk.supabase.co" }, "production_database"],
    [{ VITE_SUPABASE_PROJECT_ID: "ovwrsocjmkpiygipmrdk" }, "production_database"],
    [{ VERCEL_ENV: "production" }, "production_deployment"],
    [{ LINKWA_MODE: "live" }, "not_sandbox"],
    [{ SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" }, "database_not_allowed"],
    [{ LINKWA_BASE_URL: "https://linkwa.co.zw/api/v1/third-party" }, "not_sandbox_host"],
    [{ LINKWA_DEVELOPER_API_KEY: "sk_live_x" }, "developer_key_not_sandbox"],
  ] as const)("refuses %j -> %s", (over, reason) => {
    expect(linkwaDeveloperConfig({ ...goodEnv, ...over })).toEqual({ ok: false, reason });
  });
});
