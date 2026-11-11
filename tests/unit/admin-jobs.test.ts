import { describe, expect, it } from "vitest";
import { adminCanCancel, customerCanCancel } from "@/lib/cancel-policy";
import { jobTitle, matchesSearch, statusesFor, type AdminJobRow } from "@/lib/admin-jobs";

const row = (over: Partial<AdminJobRow> = {}): AdminJobRow => ({
  id: "12e9ef14-eb04-4be6-84f5-1795baf5f524",
  status: "in_progress",
  material: "river_sand",
  custom_material: null,
  quantity_m3: 12,
  delivery_address: "Avondale, Harare",
  final_price: 174,
  budget: 200,
  payment_method: "direct",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: null,
  customerName: "Test Customer",
  driverName: "Test Driver",
  ...over,
});

describe("admin job filters", () => {
  it("covers the right statuses", () => {
    expect(statusesFor("active")).toEqual(["accepted", "in_progress"]);
    expect(statusesFor("open")).toEqual(["open"]);
    expect(statusesFor("all")).toBeNull();
  });
  it("searches id, material, address and names", () => {
    expect(matchesSearch(row(), "")).toBe(true);
    expect(matchesSearch(row(), "river")).toBe(true);
    expect(matchesSearch(row(), "AVONDALE")).toBe(true);
    expect(matchesSearch(row(), "12e9ef14")).toBe(true);
    expect(matchesSearch(row(), "test driver")).toBe(true);
    expect(matchesSearch(row(), "bulawayo")).toBe(false);
  });
  it("titles a job from its material and quantity", () => {
    expect(jobTitle(row())).toBe("River sand · 12 m³");
    expect(jobTitle(row({ custom_material: "Top soil", quantity_m3: null }))).toBe("Top soil");
  });
});

describe("cancel rules", () => {
  it("lets an admin cancel any live job but a customer only before collection", () => {
    for (const s of ["open", "accepted", "in_progress"]) expect(adminCanCancel(s)).toBe(true);
    expect(adminCanCancel("completed")).toBe(false);
    expect(adminCanCancel("cancelled")).toBe(false);
    expect(customerCanCancel("in_progress")).toBe(false);
  });
});
