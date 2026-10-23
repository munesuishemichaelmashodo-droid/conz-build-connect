import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MATERIALS } from "@/lib/domain";
import { MATERIAL_PHOTOS, materialPhoto } from "@/lib/material-media";

describe("material photos", () => {
  it("has a credited photo file for every bookable material", () => {
    for (const m of MATERIALS.filter((x) => x.value !== "custom")) {
      const p = materialPhoto(m.value);
      expect(p, m.value).not.toBeNull();
      expect(existsSync(`public${p!.src}`), p!.src).toBe(true);
      expect(p!.photographer.trim()).not.toBe("");
      expect(p!.source).toMatch(/^https:\/\/unsplash\.com\/photos\//);
    }
  });

  it("has no photo for custom or unknown materials", () => {
    expect(materialPhoto("custom")).toBeNull();
    expect(materialPhoto("asphalt")).toBeNull();
    expect(materialPhoto(null)).toBeNull();
    expect(Object.keys(MATERIAL_PHOTOS)).not.toContain("custom");
  });
});
