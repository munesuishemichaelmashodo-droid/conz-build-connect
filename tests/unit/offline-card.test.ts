import { describe, expect, it } from "vitest";
import {
  buildOfflineCard,
  cardCopy,
  clearOfflineData,
  isActiveJobStatus,
  listOfflineCards,
  navLinks,
  pinForDisplay,
  readOfflineCard,
  readPin,
  removeOfflineCard,
  removePin,
  saveOfflineCard,
  savePin,
} from "@/lib/offline-card";

const DAY = 86_400_000;
const mem = () => {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};
const job = {
  id: "j1",
  material: "river_sand",
  quantity_m3: 12,
  delivery_address: "Harward Road, Belvedere, Harare",
  delivery_lat: "-17.8322",
  delivery_lng: 31.0181,
  pickup_address: "Pomona Quarry",
  notes: "Blue gate, ring on arrival",
  status: "in_progress",
};
const build = (over: Record<string, unknown> = {}, now = 1_000) =>
  buildOfflineCard({
    job: { ...job, ...over },
    materialName: "River sand",
    contact: { full_name: "Rudo", phone: "263771000001" },
    role: "driver",
    now,
  });

describe("buildOfflineCard", () => {
  it("keeps what a driver needs at the gate", () => {
    expect(build()).toEqual({
      jobId: "j1",
      role: "driver",
      title: "River sand · 12 m³",
      deliveryAddress: "Harward Road, Belvedere, Harare",
      lat: -17.8322,
      lng: 31.0181,
      pickupAddress: "Pomona Quarry",
      notes: "Blue gate, ring on arrival",
      contactName: "Rudo",
      contactPhone: "263771000001",
      savedAt: 1_000,
    });
  });
  it("still gives a useful card with an address but no coordinates, and says nothing it cannot back", () => {
    const c = build({ delivery_lat: null, delivery_lng: null })!;
    expect(c.lat).toBeNull();
    expect(c.lng).toBeNull();
    expect(c.deliveryAddress).toBe("Harward Road, Belvedere, Harare");
  });
  it("rejects coordinates that are not real numbers", () => {
    const c = build({ delivery_lat: "abc", delivery_lng: Number.NaN })!;
    expect(c.lat).toBeNull();
    expect(c.lng).toBeNull();
  });
  it("is null when there is neither an address nor coordinates", () => {
    expect(build({ delivery_address: "  ", delivery_lat: null, delivery_lng: null })).toBeNull();
  });
});

describe("saved cards", () => {
  it("round-trips per job", () => {
    const s = mem();
    saveOfflineCard(build()!, s);
    expect(readOfflineCard("j1", s, 2_000)?.title).toBe("River sand · 12 m³");
    expect(readOfflineCard("j2", s, 2_000)).toBeNull();
  });
  it("is never shown after seven days", () => {
    const s = mem();
    saveOfflineCard(build({}, 0)!, s);
    expect(readOfflineCard("j1", s, 7 * DAY - 1)).not.toBeNull();
    expect(readOfflineCard("j1", s, 7 * DAY + 1)).toBeNull();
  });
  it("lists only live cards, newest first", () => {
    const s = mem();
    saveOfflineCard(build({ id: "old" }, 0)!, s);
    saveOfflineCard(build({ id: "a" }, 5 * DAY)!, s);
    saveOfflineCard(build({ id: "b" }, 6 * DAY)!, s);
    expect(listOfflineCards(s, 7 * DAY + 1).map((c) => c.jobId)).toEqual(["b", "a"]);
  });
  it("can be removed", () => {
    const s = mem();
    saveOfflineCard(build()!, s);
    removeOfflineCard("j1", s);
    expect(readOfflineCard("j1", s, 2_000)).toBeNull();
  });
});

describe("saved PIN", () => {
  it("round-trips, expires after seven days and is not mixed into the card list", () => {
    const s = mem();
    savePin("j1", "482917", s, 0);
    expect(readPin("j1", s, 7 * DAY - 1)).toBe("482917");
    expect(readPin("j1", s, 7 * DAY + 1)).toBeNull();
    expect(listOfflineCards(s, 1)).toEqual([]);
    removePin("j1", s);
    expect(readPin("j1", s, 1)).toBeNull();
  });
});

describe("clearOfflineData", () => {
  it("removes every saved card and PIN and nothing else (sign-out on a shared phone)", () => {
    const s = mem();
    saveOfflineCard(build()!, s);
    savePin("j1", "482917", s, 0);
    s.setItem("unrelated", "x");
    s.setItem("conz.contact.j1.d1", "{}");
    clearOfflineData(s);
    expect(readOfflineCard("j1", s, 1)).toBeNull();
    expect(readPin("j1", s, 1)).toBeNull();
    expect(s.getItem("unrelated")).toBe("x");
    expect(s.getItem("conz.contact.j1.d1")).toBe("{}");
  });
});

describe("storage failures", () => {
  const broken = {
    length: 1,
    key: () => {
      throw new Error("blocked");
    },
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  it("never throws", () => {
    expect(() => saveOfflineCard(build()!, broken)).not.toThrow();
    expect(readOfflineCard("j1", broken, 1)).toBeNull();
    expect(listOfflineCards(broken, 1)).toEqual([]);
    expect(() => savePin("j1", "1", broken, 0)).not.toThrow();
    expect(readPin("j1", broken, 1)).toBeNull();
    expect(() => clearOfflineData(broken)).not.toThrow();
    expect(readOfflineCard("j1", null, 1)).toBeNull();
  });
});

describe("isActiveJobStatus", () => {
  it("is true only while a delivery is under way", () => {
    expect(isActiveJobStatus("accepted")).toBe(true);
    expect(isActiveJobStatus("in_progress")).toBe(true);
    for (const s of ["open", "completed", "cancelled", "disputed"])
      expect(isActiveJobStatus(s)).toBe(false);
  });
});

describe("navLinks", () => {
  it("gives a geo link for an installed maps app and a web link", () => {
    expect(navLinks(build()!)).toEqual({
      geo: "geo:-17.8322,31.0181?q=-17.8322,31.0181(Harward%20Road%2C%20Belvedere%2C%20Harare)",
      web: "https://www.google.com/maps/dir/?api=1&destination=-17.8322,31.0181&travelmode=driving",
    });
  });
  it("gives no broken links without coordinates", () => {
    expect(navLinks(build({ delivery_lat: null, delivery_lng: null })!)).toEqual({
      geo: null,
      web: null,
    });
  });
});

describe("cardCopy", () => {
  it("says it is saved on this phone, with the time, and shows coordinates to five places", () => {
    const c = cardCopy(build()!);
    expect(c.ready).toBe("Ready offline");
    expect(c.saved).toMatch(/^Saved on this phone at \d{2}:\d{2}$/);
    expect(c.coordinates).toBe("-17.83220, 31.01810");
  });
  it("an address-only card says the coordinates were not saved, rather than showing a made-up point", () => {
    const c = cardCopy(build({ delivery_lat: null, delivery_lng: null })!);
    expect(c.coordinates).toBe("Map position not saved");
  });
  it("tells the customer when to show the PIN, and that ConZ never asks for it", () => {
    const c = cardCopy(build()!);
    expect(c.pinHelp).toMatch(/only after your load is delivered and checked/i);
    expect(c.pinHelp).toMatch(/will never ask you for it/i);
  });
  it("never promises anything will be sent or checked later", () => {
    const c = cardCopy(build()!);
    expect(JSON.stringify(c)).not.toMatch(/will be sent|queued|sent later|checked later/i);
  });
});

describe("pinForDisplay", () => {
  it("shows the PIN just fetched", () => {
    expect(pinForDisplay({ fetched: "482917", networkFailed: false, cached: "111111" })).toEqual({ pin: "482917", failed: false });
  });
  it("falls back to the PIN saved on this phone when the request failed for lack of signal", () => {
    expect(pinForDisplay({ fetched: null, networkFailed: true, cached: "482917" })).toEqual({ pin: "482917", failed: false });
  });
  it("says it failed, and shows no PIN, when there is no signal and nothing saved", () => {
    expect(pinForDisplay({ fetched: null, networkFailed: true, cached: null })).toEqual({ pin: null, failed: true });
  });
  it("a real 'no PIN' answer never revives a stale saved PIN", () => {
    expect(pinForDisplay({ fetched: null, networkFailed: false, cached: "482917" })).toEqual({ pin: null, failed: false });
  });
});
