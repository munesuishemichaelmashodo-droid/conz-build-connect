import { describe, expect, it } from "vitest";
import {
  computeCardPlacement,
  computeDockedCardPlacement,
  computeSpotlightBands,
  isUnspotlightable,
  type Rect,
} from "../../src/lib/tour/geometry";

const rect = (top: number, left: number, width: number, height: number): Rect => ({
  top,
  left,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

describe("responsive card placement", () => {
  it.each([
    [320, 568],
    [390, 844],
    [768, 1024],
    [1280, 800],
  ])("keeps the card fully on-screen at %ix%i", (w, h) => {
    for (const target of [rect(20, 16, w - 32, 56), rect(h / 2, 16, w - 32, 60), rect(h - 90, 16, w - 32, 56)]) {
      const p = computeCardPlacement(target, 170, w, h);
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.left + p.width).toBeLessThanOrEqual(w);
      expect(p.top).toBeGreaterThanOrEqual(0);
      expect(p.top + 170).toBeLessThanOrEqual(h);
    }
  });

  it("puts the card below a top target and above a bottom target, never over it when there is room", () => {
    const top = computeCardPlacement(rect(20, 16, 300, 56), 170, 390, 844);
    expect(top.placement).toBe("bottom");
    expect(top.top).toBeGreaterThanOrEqual(76);
    const bottom = computeCardPlacement(rect(740, 16, 300, 56), 170, 390, 844);
    expect(bottom.placement).toBe("top");
    expect(bottom.top + 170).toBeLessThanOrEqual(740);
  });
});

describe("spotlight", () => {
  it("leaves the target itself uncovered by the dim bands", () => {
    const t = rect(100, 40, 200, 80);
    const { bands, ring } = computeSpotlightBands(t, 390, 844);
    expect(bands.left.width).toBe(ring.left);
    expect(bands.right.left).toBe(ring.right);
    expect(bands.top.height).toBe(ring.top);
    expect(bands.bottom.top).toBe(ring.bottom);
  });

  it("flags zero-height and screen-sized targets as unspotlightable", () => {
    // The old #tour-book-address wrapper measured 0px tall.
    expect(isUnspotlightable(rect(0, 0, 390, 0), 390, 844)).toBe(true);
    expect(isUnspotlightable(rect(0, 0, 390, 800), 390, 844)).toBe(true);
    expect(isUnspotlightable(rect(16, 16, 358, 56), 390, 844)).toBe(false);
  });

  it("docks the card at the bottom of the visible viewport", () => {
    const p = computeDockedCardPlacement(180, 390, 600);
    expect(p.top + 180).toBeLessThanOrEqual(600);
    expect(p.width).toBe(390 - 32);
  });
});
