import { describe, expect, it } from "vitest";
import { PENDING_NEXT_TTL_MS, parseStoredNext, serializeNext } from "@/lib/post-auth-next";

const NOW = 1_800_000_000_000;
const book = "/customer/book?material=top_soil&quantity=12&lat=-17.8&lng=31.0";

describe("pending post-sign-in destination", () => {
  it("round-trips a booking path", () => {
    expect(parseStoredNext(serializeNext(book, NOW), NOW + 60_000)).toBe(book);
  });
  it("expires after a day", () => {
    expect(parseStoredNext(serializeNext(book, NOW), NOW + PENDING_NEXT_TTL_MS + 1)).toBeNull();
  });
  it("never returns an outside or protocol-relative URL", () => {
    expect(parseStoredNext(serializeNext("https://evil.example/x", NOW), NOW)).toBeNull();
    expect(parseStoredNext(serializeNext("//evil.example", NOW), NOW)).toBeNull();
  });
  it("accepts the older plain-string value (Google flow, same tab)", () => {
    expect(parseStoredNext(book, NOW)).toBe(book);
  });
  it("ignores junk", () => {
    expect(parseStoredNext(null, NOW)).toBeNull();
    expect(parseStoredNext("{not json", NOW)).toBeNull();
    expect(parseStoredNext(JSON.stringify({ path: 5, at: NOW }), NOW)).toBeNull();
  });
});
