import { describe, expect, it, vi } from "vitest";
import { constantTimeEqual, hmacSha256, verifyHmacSha256 } from "@/lib/payments/hmac.server";
import {
  LINKWA_SANDBOX_BASE_URL,
  PRODUCTION_SUPABASE_REF,
  STAGING_SUPABASE_REF,
  linkwaSandboxConfig,
  supabaseTarget,
} from "@/lib/payments/linkwa-config.server";
import { getLinkwaProtocol, type LinkwaProtocol } from "@/lib/payments/linkwa-protocol";
import { createLinkwaAdapter } from "@/lib/payments/linkwa.server";
import { getProviderRegistry, linkwaSandboxAdapter } from "@/lib/payments/registry.server";
import { handleProviderWebhook, type ProviderDb } from "@/lib/payments/provider.server";

// TEST FIXTURE ONLY. These field names are invented for the tests and are NOT Linkwa's format; the real mapping
// is written from Linkwa's documentation in src/lib/payments/linkwa-protocol.ts.
const fixtureProtocol: LinkwaProtocol = {
  readEvent: (p) => {
    const o = p as Record<string, string>;
    return o?.t_event
      ? {
          eventId: o.t_event,
          eventType: o.t_type,
          shortUrl: o.t_link,
          paymentReference: o.t_pref ?? null,
          externalLinkId: o.t_linkid ?? null,
          receiptId: o.t_rcpt ?? null,
          bookingReference: o.t_booking ?? null,
        }
      : null;
  },
  readStatus: (b) => {
    const o = b as Record<string, unknown>;
    const word = String(o?.t_status ?? "");
    return {
      status: word === "fixture-paid" ? "paid" : word === "fixture-failed" ? "failed" : null,
      rawStatus: word,
      amount: typeof o.t_amount === "number" ? o.t_amount : null,
      currency: (o.t_currency as string) ?? null,
      receiptId: (o.t_rcpt as string) ?? null,
      bookingReference: (o.t_booking as string) ?? null,
      externalLinkId: (o.t_linkid as string) ?? null,
    };
  },
  linkRequest: (i) => ({
    t_amount: i.amount,
    t_currency: i.currency,
    t_booking: i.bookingReference,
  }),
  readCreatedLink: (b) => {
    const o = b as Record<string, string>;
    return o?.t_linkid && o?.t_link ? { externalLinkId: o.t_linkid, shortUrl: o.t_link } : null;
  },
};

const STAGING_URL = `https://${STAGING_SUPABASE_REF}.supabase.co`;
const PROD_URL = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;
const goodEnv = {
  LINKWA_MODE: "sandbox",
  SUPABASE_URL: STAGING_URL,
  VITE_SUPABASE_URL: STAGING_URL,
  LINKWA_API_KEY: "test-key",
  LINKWA_WEBHOOK_SECRET: "test-secret",
  LINKWA_SIGNATURE_ENCODING: "hex",
};

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

describe("Linkwa sandbox guard (fails closed)", () => {
  it("the real mapping is not written yet, so the sandbox cannot start", () => {
    expect(getLinkwaProtocol()).toBeNull();
    expect(linkwaSandboxConfig(goodEnv)).toEqual({ ok: false, reason: "protocol_not_documented" });
    expect(Object.keys(getProviderRegistry(goodEnv))).toEqual([]);
  });

  it("allows staging or a local database with every setting present", () => {
    expect(linkwaSandboxConfig(goodEnv, fixtureProtocol).ok).toBe(true);
    const local = {
      ...goodEnv,
      SUPABASE_URL: "http://localhost:54399",
      VITE_SUPABASE_URL: "http://127.0.0.1:54399",
    };
    expect(linkwaSandboxConfig(local, fixtureProtocol).ok).toBe(true);
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
    const r = linkwaSandboxConfig({ ...goodEnv, ...over }, fixtureProtocol);
    expect(r).toEqual({ ok: false, reason: "production_database" });
    expect(linkwaSandboxAdapter({ ...goodEnv, ...over }, fixtureProtocol)).toBeNull();
    expect(Object.keys(getProviderRegistry({ ...goodEnv, ...over }, fixtureProtocol))).toEqual([]);
  });

  it("production is refused even when everything else is set, including a production deployment", () => {
    expect(linkwaSandboxConfig({ ...goodEnv, VERCEL_ENV: "production" }, fixtureProtocol)).toEqual({
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
    [{ LINKWA_BASE_URL: `${LINKWA_SANDBOX_BASE_URL}/` }, "not_sandbox_host"],
    [{ LINKWA_API_KEY: " " }, "missing_credentials"],
    [{ LINKWA_WEBHOOK_SECRET: undefined }, "missing_credentials"],
    [{ LINKWA_SIGNATURE_ENCODING: undefined }, "signature_encoding_unset"],
  ])("refuses %o -> %s", (over, reason) => {
    expect(linkwaSandboxConfig({ ...goodEnv, ...over }, fixtureProtocol)).toEqual({
      ok: false,
      reason,
    });
  });

  it("reads project refs from Supabase URLs", () => {
    expect(supabaseTarget(PROD_URL)).toBe(PRODUCTION_SUPABASE_REF);
    expect(supabaseTarget("http://localhost:54321")).toBe("local");
    expect(supabaseTarget("not a url")).toBeNull();
  });
});

describe("raw-body HMAC-SHA256", () => {
  const body = '{"a":1,"b":"x"}';
  it("accepts the right signature in hex (any case) and base64", async () => {
    const mac = await hmacSha256("s3cret", body);
    expect(await verifyHmacSha256(body, hex(mac), "s3cret", "hex")).toBe(true);
    expect(await verifyHmacSha256(body, hex(mac).toUpperCase(), "s3cret", "hex")).toBe(true);
    expect(await verifyHmacSha256(body, b64(mac), "s3cret", "base64")).toBe(true);
  });
  it("refuses a changed body, a wrong secret, a missing or malformed header, or the other encoding", async () => {
    const mac = await hmacSha256("s3cret", body);
    expect(await verifyHmacSha256('{"a":1, "b":"x"}', hex(mac), "s3cret", "hex")).toBe(false); // re-serialised
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

function cfg() {
  const c = linkwaSandboxConfig(goodEnv, fixtureProtocol);
  if (!c.ok) throw new Error(c.reason);
  return c.config;
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Linkwa adapter (sandbox, fixture mapping)", () => {
  it("verifies the signature over the raw body before reading anything", async () => {
    const a = createLinkwaAdapter(cfg(), vi.fn());
    const raw = JSON.stringify({
      t_event: "ev1",
      t_type: "payment.completed",
      t_link: "sh1",
      t_pref: "pr1",
    });
    const sig = hex(await hmacSha256("test-secret", raw));
    const ok = await a.verifyWebhook(raw, new Headers({ "X-Linkwa-Signature": sig }));
    expect(ok).toMatchObject({
      eventId: "ev1",
      paymentId: null,
      link: { shortUrl: "sh1", paymentReference: "pr1" },
    });
    expect(
      await a.verifyWebhook(raw, new Headers({ "X-Linkwa-Signature": sig.replace(/.$/, "0") })),
    ).toBeNull();
    expect(await a.verifyWebhook(raw, new Headers())).toBeNull();
  });

  it("checks status at the documented path with the API key, and never trusts an unmapped word", async () => {
    const f = vi.fn(async () =>
      json(200, { t_status: "COMPLETED", t_amount: 400, t_currency: "USD" }),
    );
    const a = createLinkwaAdapter(cfg(), f);
    const s = await a.getPaymentStatus(null, { shortUrl: "a/b", paymentReference: "p 1" });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${LINKWA_SANDBOX_BASE_URL}/payment-links/a%2Fb/payments/p%201/status`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(init.method).toBe("GET");
    expect(s.status).toBe("unrecognised:COMPLETED");
    expect(s.reference).toBeNull();
  });

  it("a failed status call throws (the webhook answers 503 and nothing is applied)", async () => {
    const a = createLinkwaAdapter(
      cfg(),
      vi.fn(async () => json(500, {})),
    );
    await expect(
      a.getPaymentStatus(null, { shortUrl: "s", paymentReference: "p" }),
    ).rejects.toThrow(/HTTP 500/);
    await expect(a.getPaymentStatus(null, { shortUrl: "s" })).rejects.toThrow();
  });

  it("creates a payment link for the exact amount and never calls payouts", async () => {
    const f = vi.fn(async () => json(201, { t_linkid: "L1", t_link: "sh1" }));
    const a = createLinkwaAdapter(cfg(), f);
    expect(
      await a.createPaymentLink({ amount: 400, bookingReference: "pay-1", description: "d" }),
    ).toEqual({
      externalLinkId: "L1",
      shortUrl: "sh1",
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${LINKWA_SANDBOX_BASE_URL}/payment-links`);
    expect(JSON.parse(String(init.body))).toEqual({
      t_amount: 400,
      t_currency: "USD",
      t_booking: "pay-1",
    });
    expect(
      await a.getPayoutStatus({ id: "x", idempotencyKey: "k", providerReference: null }),
    ).toMatchObject({
      status: "unknown",
    });
    expect(f.mock.calls.some(([u]) => String(u).includes("/payouts"))).toBe(false);
    await expect(
      a.createPaymentLink({ amount: 0, bookingReference: "x", description: "d" }),
    ).rejects.toThrow();
  });
});

describe("webhook flow for payment-link events", () => {
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

  async function signed(body: Record<string, string>) {
    const raw = JSON.stringify(body);
    return {
      raw,
      headers: new Headers({ "x-linkwa-signature": hex(await hmacSha256("test-secret", raw)) }),
    };
  }

  it("applies the re-checked result with all identifiers kept separate", async () => {
    const f = vi.fn(async () =>
      json(200, {
        t_status: "fixture-paid",
        t_amount: 400,
        t_currency: "USD",
        t_rcpt: "R1",
        t_booking: "pay-1",
        t_linkid: "L1",
      }),
    );
    const a = createLinkwaAdapter(cfg(), f);
    const { db, calls } = fakeDb();
    const { raw, headers } = await signed({
      t_event: "ev1",
      t_type: "payment.completed",
      t_link: "sh1",
      t_pref: "pr1",
    });
    const res = await handleProviderWebhook("linkwa", raw, headers, db, { linkwa: a });
    expect(res.status).toBe(200);
    const apply = calls.find((c) => c.fn === "apply_provider_link_payment");
    expect(apply?.args).toEqual({
      _provider: "linkwa",
      _event_id: "ev1",
      _payment_id: null,
      _status: "paid",
      _amount: 400,
      _currency: "USD",
      _booking_reference: "pay-1",
      _external_payment_link_id: "L1",
      _short_url: "sh1",
      _payment_reference: "pr1",
      _receipt_id: "R1",
      _source: "webhook",
    });
    expect(calls.some((c) => c.fn === "apply_provider_payment")).toBe(false);
  });

  it("an invalid signature is 401 and nothing is checked or applied", async () => {
    const f = vi.fn();
    const { db, calls } = fakeDb();
    const { raw } = await signed({ t_event: "ev1", t_link: "sh1", t_pref: "pr1" });
    const res = await handleProviderWebhook(
      "linkwa",
      raw,
      new Headers({ "x-linkwa-signature": "00".repeat(32) }),
      db,
      {
        linkwa: createLinkwaAdapter(cfg(), f),
      },
    );
    expect(res.status).toBe(401);
    expect(f).not.toHaveBeenCalled();
    expect(calls.map((c) => c.fn)).toEqual(["provider_collection_enabled"]);
  });

  it("the provider being unreachable is 503 and nothing is applied", async () => {
    const { db, calls } = fakeDb();
    const { raw, headers } = await signed({ t_event: "ev1", t_link: "sh1", t_pref: "pr1" });
    const res = await handleProviderWebhook("linkwa", raw, headers, db, {
      linkwa: createLinkwaAdapter(
        cfg(),
        vi.fn(async () => json(502, {})),
      ),
    });
    expect(res.status).toBe(503);
    expect(calls.some((c) => c.fn.startsWith("apply_"))).toBe(false);
  });

  it("a signed event naming no payment is acknowledged and ignored", async () => {
    const f = vi.fn();
    const { db, calls } = fakeDb();
    const { raw, headers } = await signed({ t_event: "ev2", t_link: "sh1" });
    const res = await handleProviderWebhook("linkwa", raw, headers, db, {
      linkwa: createLinkwaAdapter(cfg(), f),
    });
    expect(res.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
    expect(calls.some((c) => c.fn.startsWith("apply_"))).toBe(false);
  });
});
