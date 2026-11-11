import { describe, expect, it } from "vitest";
import { loadStateCopy } from "@/lib/load-state";

describe("loadStateCopy", () => {
  it("says it is waiting for signal when the request is paused, not 'Loading…' forever", () => {
    const c = loadStateCopy({ error: false, paused: true });
    expect(c.kind).toBe("paused");
    expect(c.title).toMatch(/waiting for signal/i);
  });
  it("says it could not load, and what to do, when the request failed", () => {
    const c = loadStateCopy({ error: true, paused: false });
    expect(c.kind).toBe("error");
    expect(c.detail).toMatch(/try again/i);
  });
  it("paused wins over a stale error: the phone is offline right now", () => {
    expect(loadStateCopy({ error: true, paused: true }).kind).toBe("paused");
  });
  it("otherwise it is plain loading", () => {
    expect(loadStateCopy({ error: false, paused: false })).toEqual({
      kind: "loading",
      title: "Loading…",
      detail: null,
    });
  });
});
