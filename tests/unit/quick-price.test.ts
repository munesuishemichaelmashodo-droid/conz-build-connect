import { describe, expect, it, vi } from "vitest";
import {
  createLatestRequestGate,
  currentQuickPrice,
  normalizeQuickPriceAddress,
  runQuickPrice,
  quickPriceBookingPath,
  quickPriceErrorMessage,
  quickPriceSignature,
  quickPriceStage,
} from "@/lib/quick-price";
import { safeInternalPath } from "@/lib/safe-redirect";

const harare = { lat: -17.8252, lng: 31.0335 };

describe("quickPriceSignature", () => {
  it("changes whenever an input that affects the price changes", () => {
    const base = quickPriceSignature({ material: "river_sand", quantity: 12, coords: harare });
    expect(quickPriceSignature({ material: "pit_sand", quantity: 12, coords: harare })).not.toBe(
      base,
    );
    expect(quickPriceSignature({ material: "river_sand", quantity: 13, coords: harare })).not.toBe(
      base,
    );
    expect(
      quickPriceSignature({
        material: "river_sand",
        quantity: 12,
        coords: { lat: -17.9, lng: 31.0335 },
      }),
    ).not.toBe(base);
    expect(quickPriceSignature({ material: "river_sand", quantity: 12, coords: null })).not.toBe(
      base,
    );
  });
});

describe("quickPriceBookingPath", () => {
  it("carries the checked details to the booking screen", () => {
    const path = quickPriceBookingPath({
      material: "river_sand",
      quantity: 12,
      address: "  14 Main Rd, Avondale & Belgravia  ",
      coords: harare,
    });
    const url = new URL(path, "https://example.test");
    expect(url.pathname).toBe("/customer/book");
    expect(url.searchParams.get("material")).toBe("river_sand");
    expect(url.searchParams.get("quantity")).toBe("12");
    expect(url.searchParams.get("address")).toBe("14 Main Rd, Avondale & Belgravia");
    expect(url.searchParams.get("lat")).toBe("-17.825200");
    expect(url.searchParams.get("lng")).toBe("31.033500");
  });

  it("survives the sign-in redirect check unchanged", () => {
    const path = quickPriceBookingPath({
      material: "stones",
      quantity: 6,
      address: "Gate 2",
      coords: harare,
    });
    expect(safeInternalPath(path)).toBe(path);
  });

  it("leaves out an empty address and missing coordinates", () => {
    const path = quickPriceBookingPath({
      material: "gravel",
      quantity: 3,
      address: " ",
      coords: null,
    });
    expect(path).toBe("/customer/book?material=gravel&quantity=3");
  });
});

describe("quickPriceErrorMessage", () => {
  it("says so when the phone is offline", () => {
    expect(quickPriceErrorMessage(new Error("anything"), true)).toMatch(/offline/);
  });

  it("explains a network failure instead of showing the raw browser error", () => {
    expect(quickPriceErrorMessage(new TypeError("Failed to fetch"), false)).toMatch(
      /Couldn't reach Con Z/,
    );
  });

  it("passes on the server's own message", () => {
    const msg =
      "This delivery address is too far from our service area — please choose a closer address.";
    expect(quickPriceErrorMessage(new Error(msg), false)).toBe(msg);
  });

  it("falls back to a plain retry message", () => {
    expect(quickPriceErrorMessage("boom", false)).toMatch(/try again/);
  });
});

describe("quickPriceStage", () => {
  const base = { quantityValid: true, hasDelivery: true, loading: false, result: null };

  it("asks for a valid load size first", () => {
    const s = quickPriceStage({ ...base, quantityValid: false, hasDelivery: false });
    expect(s.kind).toBe("needs_load");
    expect(s.prompt).toMatch(/load size/i);
  });

  it("asks for the delivery point when that is all that is missing", () => {
    const s = quickPriceStage({ ...base, hasDelivery: false });
    expect(s.kind).toBe("needs_delivery");
    expect(s.prompt).toMatch(/deliver/i);
  });

  it("explains that the pickup is found for the customer once ready", () => {
    const s = quickPriceStage(base);
    expect(s.kind).toBe("ready");
    expect(s.prompt).toMatch(/supplier/i);
  });

  it("is checking while a request is in flight", () => {
    expect(quickPriceStage({ ...base, loading: true }).kind).toBe("checking");
  });

  it("tells a supplier estimate apart from an open-request guide", () => {
    expect(quickPriceStage({ ...base, result: { offer: { openRequest: false } } }).kind).toBe(
      "estimate",
    );
    expect(quickPriceStage({ ...base, result: { offer: { openRequest: true } } }).kind).toBe(
      "guide",
    );
  });

  it("offers a retry after an error", () => {
    const s = quickPriceStage({ ...base, result: { error: "Couldn't reach Con Z." } });
    expect(s.kind).toBe("error");
  });

  it("never shows a price stage without a delivery point", () => {
    const s = quickPriceStage({
      ...base,
      hasDelivery: false,
      result: { offer: { openRequest: false } },
    });
    expect(s.kind).toBe("needs_delivery");
  });
});

describe("quickPriceSignature includes the delivery address", () => {
  const base = {
    material: "river_sand",
    quantity: 12,
    coords: harare,
    address: "14 Main Rd, Avondale",
  };
  const sig = quickPriceSignature(base);

  it("1: same material, load and pin but a different address is a different calculation", () => {
    expect(quickPriceSignature({ ...base, address: "16 Main Rd, Avondale" })).not.toBe(sig);
  });
  it("2: surrounding and repeated spaces don't count; spelling does", () => {
    expect(quickPriceSignature({ ...base, address: "  14 Main  Rd,   Avondale \n" })).toBe(sig);
    expect(normalizeQuickPriceAddress("  a \t b  ")).toBe("a b");
    expect(quickPriceSignature({ ...base, address: "14 Main Rd Avondale" })).not.toBe(sig);
  });
  it("3-5: material, load and pin changes each retire the old result", () => {
    expect(quickPriceSignature({ ...base, material: "pit_sand" })).not.toBe(sig);
    expect(quickPriceSignature({ ...base, quantity: 13 })).not.toBe(sig);
    expect(quickPriceSignature({ ...base, coords: { lat: -17.83, lng: 31.0335 } })).not.toBe(sig);
    expect(quickPriceSignature({ ...base, coords: null })).not.toBe(sig);
  });
  it("is deterministic and keeps fields apart", () => {
    expect(quickPriceSignature({ ...base })).toBe(sig);
    expect(quickPriceSignature({ ...base, material: "a|b", address: "c" })).not.toBe(
      quickPriceSignature({ ...base, material: "a", address: "b|c" }),
    );
  });
  it("a stored result is shown (and bookable) only for the inputs it was made for", () => {
    const stored = { sig, offer: { offer: 180 } };
    expect(currentQuickPrice(stored, sig)).toBe(stored);
    expect(
      currentQuickPrice(stored, quickPriceSignature({ ...base, address: "elsewhere" })),
    ).toBeNull();
    expect(currentQuickPrice(null, sig)).toBeNull();
  });
});

// A promise the test resolves or rejects by hand, to finish requests in any order.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// The component's state, driven through the real runQuickPrice.
function harness() {
  const gate = createLatestRequestGate();
  const state = {
    sig: "A",
    pending: null as string | null,
    result: null as null | { sig: string; value?: string; error: unknown },
  };
  const start = (sig: string, fetch: () => Promise<string>, quantity = 12) => {
    state.sig = sig;
    return runQuickPrice({
      gate,
      sig,
      currentSig: () => state.sig,
      hasDelivery: true,
      quantity,
      fetch,
      setPending: (s) => (state.pending = s),
      setResult: (r) => (state.result = r),
    });
  };
  return { state, start };
}

describe("runQuickPrice: newest request wins", () => {
  it("6: a newer request finishing first is not overwritten by the older one", async () => {
    const h = harness();
    const old = deferred<string>();
    const fresh = deferred<string>();
    const p1 = h.start("A", () => old.promise);
    const p2 = h.start("B", () => fresh.promise);
    fresh.resolve("price for B");
    expect(await p2).toBe("applied");
    old.resolve("price for A");
    expect(await p1).toBe("ignored");
    expect(h.state.result).toEqual({ sig: "B", value: "price for B", error: null });
  });

  it("7: an old request failing after a newer one succeeded leaves the good price", async () => {
    const h = harness();
    const old = deferred<string>();
    const p1 = h.start("A", () => old.promise);
    expect(await h.start("B", async () => "price for B")).toBe("applied");
    old.reject(new Error("route failed"));
    expect(await p1).toBe("ignored");
    expect(h.state.result?.value).toBe("price for B");
    expect(h.state.result?.error).toBeNull();
  });

  it("8: an old request finishing does not clear the newer request's checking state", async () => {
    const h = harness();
    const old = deferred<string>();
    const fresh = deferred<string>();
    const p1 = h.start("A", () => old.promise);
    const p2 = h.start("B", () => fresh.promise);
    old.resolve("price for A");
    await p1;
    expect(h.state.pending).toBe("B");
    fresh.resolve("price for B");
    await p2;
    expect(h.state.pending).toBeNull();
  });

  it("ignores a reply when the inputs changed while it was running", async () => {
    const h = harness();
    const d = deferred<string>();
    const p = h.start("A", () => d.promise);
    h.state.sig = "A-edited"; // customer edited the address; no new check yet
    d.resolve("price for A");
    expect(await p).toBe("ignored");
    expect(h.state.result).toBeNull();
    expect(h.state.pending).toBeNull();
  });

  it("10: an invalid quantity or missing delivery point never starts a check", async () => {
    const h = harness();
    const fetch = vi.fn(async () => "x");
    for (const q of [0, -1, 0.1, 31, Number.NaN])
      expect(await h.start("A", fetch, q)).toBe("not_started");
    const gate = createLatestRequestGate();
    expect(
      await runQuickPrice({
        gate,
        sig: "A",
        currentSig: () => "A",
        hasDelivery: false,
        quantity: 12,
        fetch,
        setPending: () => {},
        setResult: () => {},
      }),
    ).toBe("not_started");
    expect(fetch).not.toHaveBeenCalled();
    expect(h.state.pending).toBeNull();
  });
});

describe("9: booking uses the inputs on screen", () => {
  it("carries the current material, load, address and pin", () => {
    const now = {
      material: "stones",
      quantity: 6,
      address: " 3 Gate Rd ",
      coords: { lat: -17.9, lng: 31.1 },
    };
    const url = new URL(quickPriceBookingPath(now), "https://example.test");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      material: "stones",
      quantity: "6",
      address: "3 Gate Rd",
      lat: "-17.900000",
      lng: "31.100000",
    });
  });
});

describe("price-check wording and breakdown", () => {
  it("never calls an estimate a confirmed price and says when money moves", async () => {
    const { quickPriceCopy } = await import("@/lib/quick-price");
    const s = quickPriceCopy("supplier");
    expect(s.cta).toBe("Book this delivery");
    expect(s.note).toMatch(/not a confirmed driver offer/);
    expect(s.note).toMatch(/Nothing is charged until you accept an offer/);
    const o = quickPriceCopy("open");
    expect(o.cta).toBe("Request driver offers");
    expect(o.next).toMatch(/doesn't charge you/);
    expect(`${s.next} ${s.note} ${o.next}`).not.toMatch(
      /verified supplier|guaranteed|confirmed price/i,
    );
  });

  it("shows material + delivery only when they add up to the estimate", async () => {
    const { offerBreakdown } = await import("@/lib/quick-price");
    expect(offerBreakdown({ offer: 250, materialCost: 180, transportCost: 68, step: 10 })).toEqual({
      material: 180,
      delivery: 68,
    });
    // A minimum charge lifted the total: the parts would contradict it, so no breakdown.
    expect(
      offerBreakdown({ offer: 300, materialCost: 120, transportCost: 60, step: 10 }),
    ).toBeNull();
    // Market-priced loads have no split.
    expect(
      offerBreakdown({ offer: 900, materialCost: null, transportCost: null, step: 20 }),
    ).toBeNull();
  });
});
