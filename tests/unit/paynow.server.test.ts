import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  constantTimeEqual,
  isAllowedPollUrl,
  paynowHash,
  parsePaynowFields,
  processPaynowIpn,
  verifyPaynowPayload,
  type PaynowResultDb,
} from "@/lib/paynow.server";

const KEY = "test-integration-key-not-real";
const PAYMENT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

// Independent reference implementation (Node crypto) of the Paynow hash.
function refHash(values: string[], key: string) {
  return createHash("sha512")
    .update(values.join("") + key, "utf8")
    .digest("hex")
    .toUpperCase();
}

function signedBody(fields: Array<[string, string]>, key = KEY) {
  const hash = refHash(
    fields.map(([, v]) => v),
    key,
  );
  return new URLSearchParams([...fields, ["hash", hash]]).toString();
}

function ipnFields(over: Partial<Record<string, string>> = {}): Array<[string, string]> {
  const base: Record<string, string> = {
    reference: PAYMENT_ID,
    paynowreference: "12345",
    amount: "50.00",
    status: "Paid",
    pollurl: "https://www.paynow.co.zw/Interface/CheckPayment/?guid=x",
    ...over,
  };
  return Object.entries(base) as Array<[string, string]>;
}

function mockDb(result: { data?: unknown; error?: { message: string; code?: string } | null }) {
  const rpc = vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null }));
  return { db: { rpc } as unknown as PaynowResultDb, rpc };
}

describe("paynowHash", () => {
  it("matches an independent SHA-512 implementation", async () => {
    const values = [
      "1201",
      "TEST REF",
      "99.99",
      "Info",
      "https://a",
      "https://b",
      "x@y.z",
      "Message",
    ];
    expect(await paynowHash(values, KEY)).toBe(refHash(values, KEY));
  });
});

describe("constantTimeEqual", () => {
  it("compares strings correctly", () => {
    expect(constantTimeEqual("ABC", "ABC")).toBe(true);
    expect(constantTimeEqual("ABC", "ABD")).toBe(false);
    expect(constantTimeEqual("ABC", "ABCD")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });
});

describe("verifyPaynowPayload", () => {
  it("accepts a correctly signed payload", async () => {
    const fields = parsePaynowFields(signedBody(ipnFields()))!;
    expect(await verifyPaynowPayload(fields, KEY)).toBe(true);
  });

  it("rejects a tampered amount", async () => {
    const body = signedBody(ipnFields()).replace("amount=50.00", "amount=5000.00");
    const fields = parsePaynowFields(body)!;
    expect(await verifyPaynowPayload(fields, KEY)).toBe(false);
  });

  it("rejects a payload signed with another key", async () => {
    const fields = parsePaynowFields(signedBody(ipnFields(), "other-key"))!;
    expect(await verifyPaynowPayload(fields, KEY)).toBe(false);
  });

  it("rejects a payload with no hash", async () => {
    const fields = parsePaynowFields(new URLSearchParams(ipnFields()).toString())!;
    expect(await verifyPaynowPayload(fields, KEY)).toBe(false);
  });
});

describe("parsePaynowFields", () => {
  it("rejects duplicated keys (hashed value vs acted-on value ambiguity)", () => {
    expect(parsePaynowFields("status=Paid&amount=1.00&Amount=900.00")).toBeNull();
  });
});

describe("isAllowedPollUrl", () => {
  it("allows only https Paynow hosts", () => {
    expect(isAllowedPollUrl("https://www.paynow.co.zw/Interface/CheckPayment/?guid=1")).toBe(true);
    expect(isAllowedPollUrl("https://paynow.co.zw/x")).toBe(true);
    expect(isAllowedPollUrl("http://www.paynow.co.zw/x")).toBe(false);
    expect(isAllowedPollUrl("https://www.paynow.co.zw.evil.com/x")).toBe(false);
    expect(isAllowedPollUrl("https://evil.com/?https://www.paynow.co.zw")).toBe(false);
    expect(isAllowedPollUrl("not a url")).toBe(false);
  });
});

describe("processPaynowIpn", () => {
  it("applies a valid IPN through apply_paynow_result with the reported fields", async () => {
    const { db, rpc } = mockDb({ data: { outcome: "credited", status: "paid" } });
    const res = await processPaynowIpn(signedBody(ipnFields()), { integrationKey: KEY, db });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("apply_paynow_result", {
      _payment_id: PAYMENT_ID,
      _source: "ipn",
      _status: "Paid",
      _reported_amount: "50.00",
      _reported_reference: PAYMENT_ID,
      _paynow_reference: "12345",
    });
  });

  it("returns 401 and never touches the DB for a bad hash", async () => {
    const { db, rpc } = mockDb({ data: {} });
    const body = signedBody(ipnFields()).replace("status=Paid", "status=Paid&x=1");
    const res = await processPaynowIpn(body, { integrationKey: KEY, db });
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 400 for duplicated fields", async () => {
    const { db, rpc } = mockDb({ data: {} });
    const res = await processPaynowIpn(signedBody(ipnFields()) + "&status=Paid", {
      integrationKey: KEY,
      db,
    });
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 400 when the reference is not a payment id", async () => {
    const { db, rpc } = mockDb({ data: {} });
    const res = await processPaynowIpn(signedBody(ipnFields({ reference: "1; drop table" })), {
      integrationKey: KEY,
      db,
    });
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown payment", async () => {
    const { db } = mockDb({ error: { message: "payment_not_found", code: "P0002" } });
    const res = await processPaynowIpn(signedBody(ipnFields()), { integrationKey: KEY, db });
    expect(res.status).toBe(404);
  });

  it("returns 502 on a database failure so Paynow retries", async () => {
    const { db } = mockDb({ error: { message: "connection reset" } });
    const res = await processPaynowIpn(signedBody(ipnFields()), { integrationKey: KEY, db });
    expect(res.status).toBe(502);
  });

  it("returns 200 for a rejected mismatch (recorded + alerted in the DB; retrying cannot help)", async () => {
    const { db } = mockDb({ data: { outcome: "rejected_amount_mismatch", status: "initiated" } });
    const res = await processPaynowIpn(signedBody(ipnFields({ amount: "1.00" })), {
      integrationKey: KEY,
      db,
    });
    expect(res.status).toBe(200);
  });

  it("returns 503 when Paynow is not configured", async () => {
    const { db } = mockDb({ data: {} });
    const res = await processPaynowIpn(signedBody(ipnFields()), { integrationKey: null, db });
    expect(res.status).toBe(503);
  });
});
