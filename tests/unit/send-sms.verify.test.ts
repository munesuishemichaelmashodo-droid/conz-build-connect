import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  allowedDestination,
  verifyStandardWebhook,
} from "../../supabase/functions/send-sms/verify";

const RAW_SECRET = Buffer.from("test-webhook-secret-not-real-0123456789").toString("base64");
const SECRET = `v1,whsec_${RAW_SECRET}`;
const NOW = 1_791_000_000;
const BODY = JSON.stringify({ user: { phone: "263771234567" }, sms: { otp: "123456" } });

function sign(id: string, ts: number, body: string, rawSecret = RAW_SECRET) {
  return createHmac("sha256", Buffer.from(rawSecret, "base64"))
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
}

describe("verifyStandardWebhook (send-sms fails closed)", () => {
  it("accepts a correctly signed, fresh request", async () => {
    const sig = sign("msg_1", NOW, BODY);
    expect(
      await verifyStandardWebhook(
        { id: "msg_1", timestamp: String(NOW), signature: `v1,${sig}` },
        BODY,
        SECRET,
        NOW,
      ),
    ).toBe(true);
  });

  it("accepts when one of several signatures matches (key rotation)", async () => {
    const sig = sign("msg_1", NOW, BODY);
    expect(
      await verifyStandardWebhook(
        { id: "msg_1", timestamp: String(NOW), signature: `v1,AAAA v1,${sig}` },
        BODY,
        SECRET,
        NOW,
      ),
    ).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const sig = sign("msg_1", NOW, BODY);
    const tampered = BODY.replace("263771234567", "447700900000");
    expect(
      await verifyStandardWebhook(
        { id: "msg_1", timestamp: String(NOW), signature: `v1,${sig}` },
        tampered,
        SECRET,
        NOW,
      ),
    ).toBe(false);
  });

  it("rejects a signature made with another secret", async () => {
    const other = Buffer.from("another-secret").toString("base64");
    const sig = sign("msg_1", NOW, BODY, other);
    expect(
      await verifyStandardWebhook(
        { id: "msg_1", timestamp: String(NOW), signature: `v1,${sig}` },
        BODY,
        SECRET,
        NOW,
      ),
    ).toBe(false);
  });

  it("rejects a replay older than 5 minutes", async () => {
    const old = NOW - 301;
    const sig = sign("msg_1", old, BODY);
    expect(
      await verifyStandardWebhook(
        { id: "msg_1", timestamp: String(old), signature: `v1,${sig}` },
        BODY,
        SECRET,
        NOW,
      ),
    ).toBe(false);
  });

  it("rejects missing headers or a missing secret", async () => {
    const sig = sign("msg_1", NOW, BODY);
    expect(
      await verifyStandardWebhook(
        { id: null, timestamp: String(NOW), signature: `v1,${sig}` },
        BODY,
        SECRET,
        NOW,
      ),
    ).toBe(false);
    expect(
      await verifyStandardWebhook(
        { id: "msg_1", timestamp: String(NOW), signature: `v1,${sig}` },
        BODY,
        "",
        NOW,
      ),
    ).toBe(false);
  });
});

describe("allowedDestination (SMS pumping guard)", () => {
  it("allows Zimbabwe numbers by default list", () => {
    expect(allowedDestination("263771234567", ["263"])).toBe("+263771234567");
    expect(allowedDestination("+263 77 123 4567", ["263"])).toBe("+263771234567");
  });
  it("rejects other countries and junk", () => {
    expect(allowedDestination("447700900000", ["263"])).toBeNull();
    expect(allowedDestination("12", ["263"])).toBeNull();
    expect(allowedDestination("2637712345678901234", ["263"])).toBeNull();
  });
});
