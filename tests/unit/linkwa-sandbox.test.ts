import { describe, expect, it, vi } from "vitest";
import { constantTimeEqual, hmacSha256, verifyHmacSha256 } from "@/lib/payments/hmac.server";
import {
  LINKWA_SANDBOX_BASE_URL,
  PRODUCTION_SUPABASE_REF,
  STAGING_SUPABASE_REF,
  linkwaSandboxConfig,
  supabaseTarget,
} from "@/lib/payments/linkwa-config.server";
import { linkwaProtocol, shortUrlFromCheckoutUrl } from "@/lib/payments/linkwa-protocol";
import { createLinkwaAdapter } from "@/lib/payments/linkwa.server";
import { getProviderRegistry, linkwaSandboxAdapter } from "@/lib/payments/registry.server";
import { handleProviderWebhook, type ProviderDb } from "@/lib/payments/provider.server";

// Payload shapes below are Linkwa's own documented examples (developer-apps/docs.md, webhooks/docs.md and the
// Postman collection, received 24/11/2026). No request is sent to Linkwa from these tests.
const DOC_CREATED = {
  message: "Payment link created successfully.",
  product: {
    checkout_url: "https://linkwa.com/pay/b01jxYz",
    amount: 15.5,
    currency_code: "USD",
    qr_code: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0...",
    external_payment_link_id: "01ktpcws7840j4k4swyg3zbxgn",
  },
};
const DOC_STATUS = {
  payment_reference: "e14394bd-26c2-41ec-87ad-6fed0aa362ee",
  currency_code: "USD",
  status: "PAID",
  short_url: "b01jxYz",
  amount: 15.5,
  payment_date_time: "2026-01-01T21:08:56.548172Z",
};
const DOC_WEBHOOK = {
  event: "payment.completed",
  payment_link_name: "Premium Subscription",
  status: "PAID",
  reference: "e14394bd-26c2-41ec-87ad-6fed0aa362ee",
  receipt_id: "REC-987654321",
  amount: 15.5,
  currency: "USD",
  external_payment_link_id: "01ktpcws7840j4k4swyg3zbxgn",
  checkout_url: "https://linkwa.com/pay/b01jxYz",
  payment_date_time: "2026-01-01T21:08:56.548172Z",
  customer: { name: "John Doe", email: "john@example.com", phone: "263771234567" },
};

const STAGING_URL = `https://${STAGING_SUPABASE_REF}.supabase.co`;
const PROD_URL = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;
const goodEnv = {
  LINKWA_MODE: "sandbox",
  SUPABASE_URL: STAGING_URL,
  VITE_SUPABASE_URL: STAGING_URL,
  LINKWA_API_KEY: "sk_sandbox_test_only",
  LINKWA_WEBHOOK_SECRET: "test-secret",
};

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function cfg() {
  const c = linkwaSandboxConfig(goodEnv);
  if (!c.ok) throw new Error(c.reason);
  return c.config;
}

describe("Linkwa sandbox guard (fails closed)", () => {
  it("allows only staging or a local database with a sandbox key", () => {
    expect(linkwaSandboxConfig(goodEnv).ok).toBe(true);
    expect(Object.keys(getProviderRegistry(goodEnv))).toEqual(["linkwa"]);
    const local = {
      ...goodEnv,
      SUPABASE_URL: "http://localhost:54399",
      VITE_SUPABASE_URL: "http://127.0.0.1:54399",
    };
    expect(linkwaSandboxConfig(local).ok).toBe(true);
  });

  it("is off with no Linkwa settings at all (every ordinary deployment)", () => {
    expect(Object.keys(getProviderRegistry({ SUPABASE_URL: PROD_URL }))).toEqual([]);
    expect(Object.keys(getProviderRegistry({}))).toEqual([]);
  });

  it.each([
    ["server database", { SUPABASE_URL: PROD_URL }],
    ["browser database", { VITE_SUPABASE_URL: PROD_URL }],
    ["project id", { VITE_SUPABASE_PROJECT_ID: PRODUCTION_SUPABASE_REF }],
    [
      "a URL merely containing the ref",
      { SUPABASE_URL: `https://proxy.example/${PRODUCTION_SUPABASE_REF}` },
    ],
  ])("production project ovwrsocjmkpiygipmrdk in the %s is refused", (_n, over) => {
    const env = { ...goodEnv, ...over };
    expect(linkwaSandboxConfig(env)).toEqual({ ok: false, reason: "production_database" });
    expect(linkwaSandboxAdapter(env)).toBeNull();
    expect(Object.keys(getProviderRegistry(env))).toEqual([]);
  });

  it("a production deployment is refused", () => {
    expect(linkwaSandboxConfig({ ...goodEnv, VERCEL_ENV: "production" })).toEqual({
      ok: false,
      reason: "production_deployment",
    });
  });

  it.each([
    [{ LINKWA_MODE: undefined }, "not_sandbox"],
    [{ LINKWA_MODE: "live" }, "not_sandbox"],
    [{ SUPABASE_URL: undefined }, "database_not_allowed"],
    [{ SUPABASE_URL: "https://abcdefghijabcdefghij.supabase.co" }, "database_not_allowed"],
    [{ VITE_SUPABASE_URL: "https://abcdefghijabcdefghij.supabase.co" }, "database_not_allowed"],
    [{ LINKWA_BASE_URL: "https://linkwa.co.zw/api/v1/third-party" }, "not_sandbox_host"],
    [{ LINKWA_BASE_URL: "https://sandbox.linkwa.co.zw/api/v1/integrations" }, "not_sandbox_host"],
    [{ LINKWA_BASE_URL: `${LINKWA_SANDBOX_BASE_URL}/` }, "not_sandbox_host"],
    [{ LINKWA_API_KEY: " " }, "missing_credentials"],
    [{ LINKWA_WEBHOOK_SECRET: undefined }, "missing_credentials"],
    [{ LINKWA_API_KEY: "sk_live_abc" }, "not_sandbox_key"],
    [{ LINKWA_API_KEY: "anything" }, "not_sandbox_key"],
  ])("refuses %o -> %s", (over, reason) => {
    expect(linkwaSandboxConfig({ ...goodEnv, ...over })).toEqual({ ok: false, reason });
  });

  it("a missing mapping keeps it off", () => {
    expect(linkwaSandboxConfig(goodEnv, null)).toEqual({
      ok: false,
      reason: "protocol_not_documented",
    });
  });

  it("reads project refs from Supabase URLs", () => {
    expect(supabaseTarget(PROD_URL)).toBe(PRODUCTION_SUPABASE_REF);
    expect(supabaseTarget("http://localhost:54321")).toBe("local");
    expect(supabaseTarget("not a url")).toBeNull();
  });
});

describe("Linkwa documented formats", () => {
  it("statuses: only PAID is paid; COMPLETED is not assumed to mean paid", () => {
    const word = (status: string) => linkwaProtocol.readStatus({ ...DOC_STATUS, status })?.status;
    expect(word("PAID")).toBe("paid");
    expect(word("PENDING")).toBe("pending");
    expect(word("FAILED")).toBe("failed");
    expect(word("CANCELLED")).toBe("cancelled");
    expect(word("EXPIRED")).toBe("expired");
    expect(word("COMPLETED")).toBeNull();
    expect(word("paid")).toBeNull();
    expect(linkwaProtocol.readStatus({ amount: 1 })).toBeNull();
  });

  it("reads the documented status answer", () => {
    expect(linkwaProtocol.readStatus(DOC_STATUS)).toMatchObject({
      status: "paid",
      amount: 15.5,
      currency: "USD",
      shortUrl: "b01jxYz",
      paymentReference: "e14394bd-26c2-41ec-87ad-6fed0aa362ee",
    });
  });

  it("reads the documented created link; the short URL is the checkout URL's last segment", () => {
    expect(linkwaProtocol.readCreatedLink(DOC_CREATED)).toEqual({
      externalLinkId: "01ktpcws7840j4k4swyg3zbxgn",
      shortUrl: "b01jxYz",
      checkoutUrl: "https://linkwa.com/pay/b01jxYz",
      amount: 15.5,
      currency: "USD",
    });
    expect(shortUrlFromCheckoutUrl("https://linkwa.co.zw/pay/abc123xyz")).toBe("abc123xyz");
    expect(shortUrlFromCheckoutUrl("http://linkwa.com/pay/abc")).toBeNull();
    expect(shortUrlFromCheckoutUrl("https://linkwa.com/other/abc")).toBeNull();
    expect(
      linkwaProtocol.readCreatedLink({ product: { checkout_url: "https://x/pay/abc" } }),
    ).toBeNull();
  });

  it("asks for a single-use USD link with ConZ's return address", () => {
    expect(
      linkwaProtocol.linkRequest({
        amount: 400,
        currency: "USD",
        bookingReference: "pay-1",
        name: "ConZ delivery",
        description: "ConZ delivery abc",
        returnUrl: "https://example.test/pay/linkwa-return",
      }),
    ).toEqual({
      amount: 400,
      currency_code: "USD",
      payment_link_name: "ConZ delivery",
      description: "ConZ delivery abc (ConZ ref pay-1)",
      return_url: "https://example.test/pay/linkwa-return",
      stock: 1,
    });
  });

  it("reads the documented webhook; other events are ignored", () => {
    expect(linkwaProtocol.readEvent(DOC_WEBHOOK)).toEqual({
      eventId: "payment.completed:e14394bd-26c2-41ec-87ad-6fed0aa362ee",
      eventType: "payment.completed",
      shortUrl: "b01jxYz",
      paymentReference: "e14394bd-26c2-41ec-87ad-6fed0aa362ee",
      externalLinkId: "01ktpcws7840j4k4swyg3zbxgn",
      receiptId: "REC-987654321",
      bookingReference: null,
    });
    expect(linkwaProtocol.readEvent({ ...DOC_WEBHOOK, event: "payment.failed" })).toBeNull();
    expect(linkwaProtocol.readEvent({ ...DOC_WEBHOOK, checkout_url: undefined })).toBeNull();
  });
});

describe("raw-body HMAC-SHA256 (Linkwa: hash_hmac('sha256', $rawBody, $secret), hex)", () => {
  const body = JSON.stringify(DOC_WEBHOOK);
  it("accepts the right hex signature", async () => {
    const mac = await hmacSha256("s3cret", body);
    expect(await verifyHmacSha256(body, hex(mac), "s3cret", "hex")).toBe(true);
    expect(await verifyHmacSha256(body, hex(mac).toUpperCase(), "s3cret", "hex")).toBe(true);
    expect(await verifyHmacSha256(body, b64(mac), "s3cret", "base64")).toBe(true);
  });
  it("refuses a changed body, a wrong secret, or a missing or malformed header", async () => {
    const mac = await hmacSha256("s3cret", body);
    const reserialised = JSON.stringify(JSON.parse(body), null, 1);
    expect(await verifyHmacSha256(reserialised, hex(mac), "s3cret", "hex")).toBe(false);
    expect(await verifyHmacSha256(body, hex(mac), "other", "hex")).toBe(false);
    expect(await verifyHmacSha256(body, null, "s3cret", "hex")).toBe(false);
    expect(await verifyHmacSha256(body, hex(mac).slice(2), "s3cret", "hex")).toBe(false);
    expect(await verifyHmacSha256(body, `sha256=${hex(mac)}`, "s3cret", "hex")).toBe(false);
    expect(await verifyHmacSha256(body, b64(mac), "s3cret", "hex")).toBe(false);
    expect(await verifyHmacSha256(body, hex(mac), "", "hex")).toBe(false);
  });
  it("compares in constant time and checks lengths", () => {
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(false);
  });
});

describe("Linkwa adapter", () => {
  it("checks status at the documented path with the sandbox key", async () => {
    const f = vi.fn(async () => json(200, DOC_STATUS));
    const a = createLinkwaAdapter(cfg(), f);
    const s = await a.getPaymentStatus(null, {
      shortUrl: "b01jxYz",
      paymentReference: "e14394bd-26c2-41ec-87ad-6fed0aa362ee",
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `${LINKWA_SANDBOX_BASE_URL}/payment-links/b01jxYz/payments/e14394bd-26c2-41ec-87ad-6fed0aa362ee/status`,
    );
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer sk_sandbox_test_only");
    expect(h.Accept).toBe("application/json");
    expect(s).toMatchObject({ status: "paid", amount: 15.5, currency: "USD", reference: null });
  });

  it("an answer about a different payment is refused", async () => {
    const a = createLinkwaAdapter(
      cfg(),
      vi.fn(async () => json(200, { ...DOC_STATUS, short_url: "zzz999" })),
    );
    await expect(
      a.getPaymentStatus(null, {
        shortUrl: "b01jxYz",
        paymentReference: DOC_STATUS.payment_reference,
      }),
    ).rejects.toThrow(/different payment/);
  });

  it("an unmapped word (COMPLETED) is passed on as unrecognised, never paid", async () => {
    const a = createLinkwaAdapter(
      cfg(),
      vi.fn(async () => json(200, { ...DOC_STATUS, status: "COMPLETED" })),
    );
    const s = await a.getPaymentStatus(null, {
      shortUrl: "b01jxYz",
      paymentReference: DOC_STATUS.payment_reference,
    });
    expect(s.status).toBe("unrecognised:COMPLETED");
  });

  it("a failed or unreadable status call throws (nothing is applied)", async () => {
    const link = { shortUrl: "s1x", paymentReference: "p-123456" };
    await expect(
      createLinkwaAdapter(
        cfg(),
        vi.fn(async () => json(401, {})),
      ).getPaymentStatus(null, link),
    ).rejects.toThrow(/HTTP 401/);
    await expect(
      createLinkwaAdapter(
        cfg(),
        vi.fn(async () => json(200, {})),
      ).getPaymentStatus(null, link),
    ).rejects.toThrow();
    await expect(
      createLinkwaAdapter(cfg(), vi.fn()).getPaymentStatus(null, { shortUrl: "s1x" }),
    ).rejects.toThrow();
  });

  it("creates a single-use link for the exact amount and checks Linkwa's echo", async () => {
    const f = vi.fn(async () => json(200, DOC_CREATED));
    const a = createLinkwaAdapter(cfg(), f);
    const input = {
      amount: 15.5,
      bookingReference: "pay-1",
      name: "ConZ delivery",
      description: "d",
      returnUrl: "https://e.test/r",
    };
    expect(await a.createPaymentLink(input)).toMatchObject({
      shortUrl: "b01jxYz",
      externalLinkId: "01ktpcws7840j4k4swyg3zbxgn",
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${LINKWA_SANDBOX_BASE_URL}/payment-links`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      amount: 15.5,
      currency_code: "USD",
      stock: 1,
    });
    await expect(a.createPaymentLink({ ...input, amount: 16 })).rejects.toThrow(/different amount/);
    const zwg = createLinkwaAdapter(
      cfg(),
      vi.fn(async () => json(200, { product: { ...DOC_CREATED.product, currency_code: "ZWG" } })),
    );
    await expect(zwg.createPaymentLink(input)).rejects.toThrow(/different amount or currency/);
    await expect(a.createPaymentLink({ ...input, amount: 0 })).rejects.toThrow();
  });

  it("never calls payouts, wallets, users, balance or statement", async () => {
    const f = vi.fn(async () => json(200, DOC_STATUS));
    const a = createLinkwaAdapter(cfg(), f);
    expect(
      await a.getPayoutStatus({ id: "x", idempotencyKey: "k", providerReference: null }),
    ).toMatchObject({ status: "unknown" });
    await a.getPaymentStatus(null, {
      shortUrl: "b01jxYz",
      paymentReference: DOC_STATUS.payment_reference,
    });
    expect(
      f.mock.calls.some(([u]) => /\/(payouts|wallets|users|balance|statement)/.test(String(u))),
    ).toBe(false);
  });
});

describe("webhook flow (documented payment.completed)", () => {
  function fakeDb() {
    const calls: { fn: string; args: unknown }[] = [];
    const db = {
      rpc: vi.fn((fn: string, args?: unknown) => {
        calls.push({ fn, args });
        return Promise.resolve({
          data: fn === "provider_collection_enabled" ? true : "applied_paid",
          error: null,
        });
      }),
    } as unknown as ProviderDb;
    return { db, calls };
  }
  async function signed(body: unknown) {
    const raw = JSON.stringify(body);
    const sig = hex(await hmacSha256("test-secret", raw));
    return { raw, headers: new Headers({ "X-Linkwa-Signature": sig }) };
  }

  it("verifies, re-checks with Linkwa and applies with every identifier kept separate", async () => {
    const f = vi.fn(async () => json(200, DOC_STATUS));
    const { db, calls } = fakeDb();
    const { raw, headers } = await signed(DOC_WEBHOOK);
    const res = await handleProviderWebhook("linkwa", raw, headers, db, {
      linkwa: createLinkwaAdapter(cfg(), f),
    });
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
    expect(calls.find((c) => c.fn === "apply_provider_link_payment")?.args).toEqual({
      _provider: "linkwa",
      _event_id: "payment.completed:e14394bd-26c2-41ec-87ad-6fed0aa362ee",
      _payment_id: null,
      _status: "paid",
      _amount: 15.5,
      _currency: "USD",
      _booking_reference: null,
      _external_payment_link_id: "01ktpcws7840j4k4swyg3zbxgn",
      _short_url: "b01jxYz",
      _payment_reference: "e14394bd-26c2-41ec-87ad-6fed0aa362ee",
      _receipt_id: "REC-987654321",
      _source: "webhook",
    });
  });

  it("uses the re-checked status, not the webhook's own claim", async () => {
    const f = vi.fn(async () => json(200, { ...DOC_STATUS, status: "PENDING" }));
    const { db, calls } = fakeDb();
    const { raw, headers } = await signed(DOC_WEBHOOK); // webhook says PAID
    await handleProviderWebhook("linkwa", raw, headers, db, {
      linkwa: createLinkwaAdapter(cfg(), f),
    });
    expect(
      (calls.find((c) => c.fn === "apply_provider_link_payment")?.args as { _status: string })
        ._status,
    ).toBe("pending");
  });

  it("still pending at Linkwa: answers 503 so Linkwa retries the same event later", async () => {
    const f = vi.fn(async () => json(200, { ...DOC_STATUS, status: "PENDING" }));
    const db = {
      rpc: vi.fn((fn: string) =>
        Promise.resolve({
          data: fn === "provider_collection_enabled" ? true : "pending_no_change",
          error: null,
        }),
      ),
    } as unknown as ProviderDb;
    const { raw, headers } = await signed(DOC_WEBHOOK);
    const res = await handleProviderWebhook("linkwa", raw, headers, db, {
      linkwa: createLinkwaAdapter(cfg(), f),
    });
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("status_pending");
  });

  it("an invalid signature is 401 (Linkwa retries) and nothing is checked or applied", async () => {
    const f = vi.fn();
    const { db, calls } = fakeDb();
    const { raw } = await signed(DOC_WEBHOOK);
    const res = await handleProviderWebhook(
      "linkwa",
      raw,
      new Headers({ "X-Linkwa-Signature": "00".repeat(32) }),
      db,
      { linkwa: createLinkwaAdapter(cfg(), f) },
    );
    expect(res.status).toBe(401);
    expect(f).not.toHaveBeenCalled();
    expect(calls.map((c) => c.fn)).toEqual(["provider_collection_enabled"]);
  });

  it("Linkwa unreachable on re-check is 503 and nothing is applied", async () => {
    const { db, calls } = fakeDb();
    const { raw, headers } = await signed(DOC_WEBHOOK);
    const res = await handleProviderWebhook("linkwa", raw, headers, db, {
      linkwa: createLinkwaAdapter(
        cfg(),
        vi.fn(async () => json(502, {})),
      ),
    });
    expect(res.status).toBe(503);
    expect(calls.some((c) => c.fn.startsWith("apply_"))).toBe(false);
  });
});
