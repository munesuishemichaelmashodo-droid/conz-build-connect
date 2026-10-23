import { describe, expect, it } from "vitest";
import { bookAgainSearch } from "@/lib/book-again";

const job = {
  status: "completed",
  material: "river_sand",
  quantity_m3: 12,
  delivery_address: "Harward Road, Belvedere, Harare",
  delivery_lat: -17.83,
  delivery_lng: 31.02,
  driver_id: "d1",
  final_price: 207,
  budget: 180,
};

describe("bookAgainSearch", () => {
  it("fills material, load and delivery point from the past job", () => {
    expect(bookAgainSearch(job)).toEqual({
      material: "river_sand",
      quantity: 12,
      address: "Harward Road, Belvedere, Harare",
      lat: -17.83,
      lng: 31.02,
    });
  });

  it("never carries the old price: booking always takes a fresh quote", () => {
    const s = bookAgainSearch(job) as Record<string, unknown>;
    expect(Object.keys(s)).not.toContain("budget");
    expect(Object.keys(s)).not.toContain("price");
    expect(JSON.stringify(s)).not.toContain("207");
  });

  it("asks for the same driver only when asked to", () => {
    expect(bookAgainSearch(job, { sameDriver: true })).toMatchObject({ driverId: "d1" });
    expect(bookAgainSearch(job)).not.toHaveProperty("driverId");
  });

  it("leaves the material for the customer to choose when it was a custom request", () => {
    expect(bookAgainSearch({ ...job, material: "custom" })).not.toHaveProperty("material");
  });

  it("leaves out a delivery point it cannot trust", () => {
    const s = bookAgainSearch({ ...job, delivery_lat: null, delivery_lng: -1 });
    expect(s).not.toHaveProperty("lat");
    expect(s).not.toHaveProperty("lng");
    expect(s).toMatchObject({ address: "Harward Road, Belvedere, Harare" });
  });

  it("offers nothing for a job that was never delivered", () => {
    expect(bookAgainSearch({ ...job, status: "cancelled" })).toBeNull();
    expect(bookAgainSearch({ ...job, status: "open" })).toBeNull();
  });

  it("does not ask for a driver the job never had", () => {
    expect(bookAgainSearch({ ...job, driver_id: null }, { sameDriver: true })).not.toHaveProperty(
      "driverId",
    );
  });
});
