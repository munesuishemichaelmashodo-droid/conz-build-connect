import { describe, expect, it, vi } from "vitest";
import {
  createLinkwaDeveloperClient,
  redactLinkwa,
  validateSandboxCall,
} from "@/lib/payments/linkwa-developer.server";
import { LINKWA_SANDBOX_BASE_URL } from "@/lib/payments/linkwa-config.server";

const cfg = { baseUrl: LINKWA_SANDBOX_BASE_URL, apiKey: "sk_sandbox_developer_test" };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Linkwa developer client: documented paths, developer key, redacted answers", () => {
  it("links a user at POST /users with the developer key and hides the name, email and phone", async () => {
    const f = vi.fn(async () =>
      json(200, {
        message: "User linked successfully",
        user: {
          first_name: "John",
          last_name: "Doe",
          phone_number: "263771234567",
          external_user_id: "01ktpcws",
        },
      }),
    );
    const r = await createLinkwaDeveloperClient(cfg, f).linkUser({
      firstName: "John",
      lastName: "Doe",
      phoneNumber: "263771234567",
      email: "john@example.com",
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${LINKWA_SANDBOX_BASE_URL}/users`);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk_sandbox_developer_test",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      first_name: "John",
      last_name: "Doe",
      phone_number: "263771234567",
      email: "john@example.com",
    });
    expect(r).toEqual({
      httpStatus: 200,
      transportError: null,
      body: {
        message: "User linked successfully",
        user: {
          first_name: "[redacted]",
          last_name: "[redacted]",
          phone_number: "***567",
          external_user_id: "01ktpcws",
        },
      },
    });
  });

  it("links a wallet with the JSON form only (no ID data) and reports 422 requires_registration as it is", async () => {
    const f = vi.fn(async () =>
      json(422, {
        message: "Phone number is not registered",
        requires_registration: true,
        required_fields: ["id_number"],
      }),
    );
    const r = await createLinkwaDeveloperClient(cfg, f).linkWallet({
      externalUserId: "u_1",
      phoneNumber: "263711111111",
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${LINKWA_SANDBOX_BASE_URL}/wallets`);
    expect(JSON.parse(init.body as string)).toEqual({
      external_user_id: "u_1",
      phone_number: "263711111111",
    });
    expect(r.httpStatus).toBe(422);
    expect((r.body as { requires_registration: boolean }).requires_registration).toBe(true);
  });

  it("instructs a payout with the documented fields; the answer is passed on, never read as paid", async () => {
    const f = vi.fn(async () =>
      json(200, {
        message: "Payout instructed",
        payout: { payout_id: "01J", amount: 316.2, currency: "USD" },
      }),
    );
    const r = await createLinkwaDeveloperClient(cfg, f).instructPayout({
      externalUserId: "u_1",
      externalWalletId: "w_a1",
      amount: 316.2,
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${LINKWA_SANDBOX_BASE_URL}/payouts`);
    expect(JSON.parse(init.body as string)).toEqual({
      external_user_id: "u_1",
      external_wallet_id: "w_a1",
      amount: 316.2,
      currency_code: "USD",
      include_balance_after: true,
    });
    expect(r.httpStatus).toBe(200);
  });

  it("refuses a payout amount out of range before calling Linkwa", () => {
    const f = vi.fn();
    const c = createLinkwaDeveloperClient(cfg, f);
    expect(() =>
      c.instructPayout({ externalUserId: "u", externalWalletId: "w", amount: 0 }),
    ).toThrow();
    expect(() =>
      c.instructPayout({ externalUserId: "u", externalWalletId: "w", amount: 1000.01 }),
    ).toThrow();
    expect(f).not.toHaveBeenCalled();
  });

  it("a timeout is reported as no answer (a payout is then UNKNOWN, never assumed sent or failed)", async () => {
    const f = vi.fn(async () => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    });
    const r = await createLinkwaDeveloperClient(cfg, f).instructPayout({
      externalUserId: "u",
      externalWalletId: "w",
      amount: 1,
    });
    expect(r).toEqual({ httpStatus: 0, body: null, transportError: "timeout" });
  });

  it("statement page size is capped at 25", async () => {
    const f = vi.fn(async () => json(200, { data: [], meta: {} }));
    await createLinkwaDeveloperClient(cfg, f).getStatement(500);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(
      `${LINKWA_SANDBOX_BASE_URL}/statement?currency_code=USD&per_page=25`,
    );
  });

  it("redaction drops customer blocks in statement rows", () => {
    expect(
      redactLinkwa({ data: [{ amount: 10, customer: { name: "A", phone: "263771234567" } }] }),
    ).toEqual({
      data: [{ amount: 10, customer: "[redacted]" }],
    });
  });
});

describe("sandbox console input", () => {
  it("needs a reason and a known action", () => {
    expect(validateSandboxCall({ action: "balance", reason: "" })).toEqual({
      ok: false,
      error: "reason_required",
    });
    expect(validateSandboxCall({ action: "refund" as never, reason: "T8 test" })).toEqual({
      ok: false,
      error: "unknown_action",
    });
    expect(validateSandboxCall({ action: "balance", reason: "T3c one read" }).ok).toBe(true);
  });
  it("wallets need a Zimbabwe number in international format; payouts need ids and a sane amount", () => {
    expect(
      validateSandboxCall({
        action: "link_wallet",
        reason: "T2 wallet",
        externalUserId: "u_1",
        phoneNumber: "0711111111",
      }),
    ).toEqual({ ok: false, error: "bad_phone" });
    expect(
      validateSandboxCall({
        action: "link_wallet",
        reason: "T2 wallet",
        externalUserId: "u_1",
        phoneNumber: "263711111111",
      }).ok,
    ).toBe(true);
    expect(
      validateSandboxCall({
        action: "payout",
        reason: "T4 payout",
        externalUserId: "u_1",
        externalWalletId: "w_1",
        amount: 5000,
      }),
    ).toEqual({ ok: false, error: "bad_amount" });
    expect(
      validateSandboxCall({
        action: "payout",
        reason: "T4 payout",
        externalUserId: "u_1",
        externalWalletId: "w_1",
        amount: 316.2,
      }).ok,
    ).toBe(true);
  });
});
