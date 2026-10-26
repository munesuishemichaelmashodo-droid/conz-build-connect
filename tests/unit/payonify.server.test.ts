import { describe, expect, it, vi } from "vitest";
import {
  createReversal,
  createTransfer,
  getPayonifyConfig,
  PayonifyError,
  signPayonifyPayload,
  toEcocashNumber,
  toMinorUnits,
  verifyPayonifyWebhook,
} from "@/lib/payonify.server";

const cfg = { publishableKey: "pk_test_abc", secretKey: "sk_test_xyz" };
const SECRET = "whsec_test_123";
const NOW = 1_800_000_000;

function fakeFetch(status: number, body: unknown) {
  return vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

describe("config", () => {
  it("is null when not configured", () => {
    expect(getPayonifyConfig({})).toBeNull();
  });
  it("accepts test keys", () => {
    expect(
      getPayonifyConfig({
        PAYONIFY_PUBLISHABLE_KEY: "pk_test_a",
        PAYONIFY_SECRET_KEY: "sk_test_b",
      }),
    ).toMatchObject({ publishableKey: "pk_test_a" });
  });
  it("refuses live keys (sandbox only)", () => {
    expect(() =>
      getPayonifyConfig({
        PAYONIFY_PUBLISHABLE_KEY: "pk_live_a",
        PAYONIFY_SECRET_KEY: "sk_live_b",
      }),
    ).toThrow(/sandbox-only/);
  });
});

describe("amounts and numbers", () => {
  it("converts dollars to cents exactly", () => {
    expect(toMinorUnits(194)).toBe(19400);
    expect(toMinorUnits("13.58")).toBe(1358);
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
    expect(toMinorUnits("5.5")).toBe(550);
  });
  it("rejects bad amounts", () => {
    expect(() => toMinorUnits("-1")).toThrow();
    expect(() => toMinorUnits("1.234")).toThrow();
    expect(() => toMinorUnits("abc")).toThrow();
  });
  it("normalises Zimbabwe mobile numbers", () => {
    expect(toEcocashNumber("077 211 1111")).toBe("772111111");
    expect(toEcocashNumber("+263772111111")).toBe("772111111");
    expect(() => toEcocashNumber("0123")).toThrow();
  });
});

describe("transfers", () => {
  it("sends amount, commission and destination as documented, with Basic auth", async () => {
    const f = fakeFetch(201, { id: "tr_1", status: "pending" });
    const t = await createTransfer(
      cfg,
      {
        amountMinor: 18042,
        commissionMinor: 1358,
        currency: "usd",
        mobileNumber: "0772111111",
        description: "Job a005",
      },
      f,
    );
    expect(t.status).toBe("pending");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.payonify.com/v1/transfers");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${btoa("pk_test_abc:sk_test_xyz")}`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      amount: 18042,
      currency: "usd",
      application_fee_amount: 1358,
      description: "Job a005",
      destination: { mobile_money: { ecocash: { mobile_number: "772111111" } } },
    });
  });
  it("rejects non-integer amounts before calling the API", () => {
    const f = fakeFetch(201, {});
    expect(() =>
      createTransfer(
        cfg,
        {
          amountMinor: 10.5,
          commissionMinor: 0,
          currency: "usd",
          mobileNumber: "0772111111",
          description: "x",
        },
        f,
      ),
    ).toThrow();
    expect(f).not.toHaveBeenCalled();
  });
  it("surfaces provider error codes without leaking keys", async () => {
    const f = fakeFetch(422, {
      error: { code: "insufficient_funds", message: "Insufficient funds" },
    });
    const err = await createTransfer(
      cfg,
      {
        amountMinor: 100,
        commissionMinor: 0,
        currency: "usd",
        mobileNumber: "0772111111",
        description: "x",
      },
      f,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(PayonifyError);
    expect(err.code).toBe("insufficient_funds");
    expect(String(err.message)).not.toContain("sk_test");
  });
  it("creates a reversal for a transfer", async () => {
    const f = fakeFetch(200, { id: "rv_1", status: "processing", transfer: "tr_1" });
    const r = await createReversal(cfg, "tr_1", "Customer refund", f);
    expect(r.status).toBe("processing");
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({
      transfer: "tr_1",
      reason: "Customer refund",
    });
  });
});

describe("webhook signatures", () => {
  const body = JSON.stringify({
    id: "evt_1",
    type: "transfer.succeeded",
    created: NOW,
    livemode: false,
    data: { object: { id: "tr_1" } },
  });

  it("accepts a correctly signed, fresh test-mode event", async () => {
    const sig = await signPayonifyPayload(SECRET, NOW, body);
    const ev = await verifyPayonifyWebhook(body, `t=${NOW},v1=${sig}`, SECRET, NOW + 10);
    expect(ev?.type).toBe("transfer.succeeded");
  });
  it("rejects a wrong signature, a changed body, or a wrong secret", async () => {
    const sig = await signPayonifyPayload(SECRET, NOW, body);
    expect(
      await verifyPayonifyWebhook(body, `t=${NOW},v1=${"0".repeat(64)}`, SECRET, NOW),
    ).toBeNull();
    expect(
      await verifyPayonifyWebhook(body.replace("tr_1", "tr_2"), `t=${NOW},v1=${sig}`, SECRET, NOW),
    ).toBeNull();
    expect(await verifyPayonifyWebhook(body, `t=${NOW},v1=${sig}`, "other", NOW)).toBeNull();
  });
  it("rejects events outside the 5-minute window (replay)", async () => {
    const sig = await signPayonifyPayload(SECRET, NOW, body);
    expect(await verifyPayonifyWebhook(body, `t=${NOW},v1=${sig}`, SECRET, NOW + 301)).toBeNull();
  });
  it("rejects missing headers and live-mode events", async () => {
    expect(await verifyPayonifyWebhook(body, null, SECRET, NOW)).toBeNull();
    const live = body.replace('"livemode":false', '"livemode":true');
    const sig = await signPayonifyPayload(SECRET, NOW, live);
    expect(await verifyPayonifyWebhook(live, `t=${NOW},v1=${sig}`, SECRET, NOW)).toBeNull();
  });
});
