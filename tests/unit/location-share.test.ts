import { describe, expect, it } from "vitest";
import {
  STALL_AFTER_MS,
  isPermissionDenied,
  readShareIntent,
  shareHealth,
  shareNotice,
  writeShareIntent,
} from "@/lib/location-share";

const now = 1_000_000;
const base = { intended: true, watching: true, denied: false, lastPushAt: now - 5_000, now };

describe("shareHealth", () => {
  it("is live while updates keep arriving", () => {
    expect(shareHealth(base)).toBe("live");
  });
  it("is off when the driver never started and nothing is running", () => {
    expect(shareHealth({ ...base, intended: false, watching: false, lastPushAt: null })).toBe(
      "off",
    );
  });
  it("is starting until the first update lands", () => {
    expect(shareHealth({ ...base, lastPushAt: null })).toBe("starting");
  });
  it("a watch that never produces a first fix becomes stalled, not 'starting' forever", () => {
    expect(shareHealth({ ...base, lastPushAt: null, watchStartedAt: now - 10_000 })).toBe(
      "starting",
    );
    expect(
      shareHealth({ ...base, lastPushAt: null, watchStartedAt: now - STALL_AFTER_MS - 1 }),
    ).toBe("stalled");
  });
  it("is stalled when updates stop for longer than the limit", () => {
    expect(shareHealth({ ...base, lastPushAt: now - STALL_AFTER_MS - 1 })).toBe("stalled");
    expect(shareHealth({ ...base, lastPushAt: now - STALL_AFTER_MS })).toBe("live");
  });
  it("is stalled when the driver meant to share but the watch is gone (page left, reloaded, app suspended)", () => {
    expect(shareHealth({ ...base, watching: false })).toBe("stalled");
  });
  it("is blocked whenever access is denied, whatever else is true", () => {
    expect(shareHealth({ ...base, denied: true })).toBe("blocked");
    expect(shareHealth({ ...base, denied: true, intended: false, watching: false })).toBe(
      "blocked",
    );
  });
});

describe("share intent storage", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };
  it("remembers per job that sharing was started, and forgets it when stopped", () => {
    const s = mem();
    expect(readShareIntent("j1", s)).toBe(false);
    writeShareIntent("j1", true, s);
    expect(readShareIntent("j1", s)).toBe(true);
    expect(readShareIntent("j2", s)).toBe(false);
    writeShareIntent("j1", false, s);
    expect(readShareIntent("j1", s)).toBe(false);
  });
  it("survives unavailable storage", () => {
    const broken = {
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
    expect(readShareIntent("j1", broken)).toBe(false);
    expect(() => writeShareIntent("j1", true, broken)).not.toThrow();
    expect(readShareIntent("j1", null)).toBe(false);
  });
});

describe("isPermissionDenied", () => {
  it("only treats code 1 as a refusal; timeouts and unavailable positions are retried", () => {
    expect(isPermissionDenied({ code: 1 })).toBe(true);
    expect(isPermissionDenied({ code: 2 })).toBe(false);
    expect(isPermissionDenied({ code: 3 })).toBe(false);
    expect(isPermissionDenied(null)).toBe(false);
  });
  it("recognises the wrapped messages the app's own locate helper throws", () => {
    expect(
      isPermissionDenied(
        new Error("Location permission denied. Enable it in your browser settings."),
      ),
    ).toBe(true);
    expect(
      isPermissionDenied(
        new Error("Location permission is blocked. Enable it in your browser settings."),
      ),
    ).toBe(true);
    expect(
      isPermissionDenied(
        new Error("Getting your location took too long. Move outside or check GPS and try again."),
      ),
    ).toBe(false);
  });
});

describe("shareNotice", () => {
  it("warns whenever the customer cannot see the driver", () => {
    for (const h of ["off", "stalled", "blocked"] as const) {
      const n = shareNotice(h, true);
      expect(n.tone).not.toBe("ok");
      expect(n.detail).toMatch(/cannot see/i);
    }
  });
  it("only reassures when live", () => {
    expect(shareNotice("live", true).tone).toBe("ok");
    expect(shareNotice("starting", true).tone).toBe("ok");
  });
  it("the privacy switch being off is a danger notice that points to settings, whatever the health", () => {
    const n = shareNotice("live", false);
    expect(n.tone).toBe("danger");
    expect(n.detail).toMatch(/privacy settings/);
  });
  it("the blocked notice says how to fix it on the phone", () => {
    expect(shareNotice("blocked", true).detail).toMatch(/settings/i);
  });
});
