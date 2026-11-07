import { describe, expect, it } from "vitest";
import { bookAgainSearch, repeatNoticeText } from "@/lib/book-again";

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
      repeat: true,
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

// ---- Repeat card: the latest repeatable delivery comes from the customer's whole history ----
import { latestRepeatableJob } from "@/lib/book-again";

type Row = Record<string, unknown>;
/** A tiny in-memory stand-in for the supabase query builder (filters, ordering, limit, maybeSingle). */
function fakeClient(rows: Row[], fail = false) {
  const calls: string[] = [];
  const client = {
    from: (table: string) => {
      calls.push(`from:${table}`);
      let out = rows.slice();
      const q = {
        select: (c: string) => (calls.push(`select:${c}`), q),
        eq: (col: string, v: string) => ((out = out.filter((r) => r[col] === v)), q),
        neq: (col: string, v: string) => ((out = out.filter((r) => r[col] !== v)), q),
        order: (col: string, o: { ascending: boolean }) => (
          out.sort((a, b) => (String(a[col]) < String(b[col]) ? 1 : -1) * (o.ascending ? -1 : 1)),
          q
        ),
        limit: (n: number) => ((out = out.slice(0, n)), q),
        maybeSingle: async () =>
          fail ? { data: null, error: { message: "boom" } } : { data: out[0] ?? null, error: null },
      };
      return q;
    },
  };
  return { client, calls };
}
const mkJob = (i: number, over: Row = {}): Row => ({
  id: `j${i}`,
  customer_id: "c1",
  status: "completed",
  material: "river_sand",
  quantity_m3: 12,
  delivery_address: "Harward Road, Harare",
  delivery_lat: -17.8,
  delivery_lng: 31,
  driver_id: "d1",
  created_at: `2026-10-${String(i).padStart(2, "0")}T08:00:00Z`,
  ...over,
});

describe("latestRepeatableJob", () => {
  it("finds the completed delivery even when more than five newer jobs exist", async () => {
    const newer = [20, 21, 22, 23, 24, 25, 26].map((i) =>
      mkJob(i, { status: i % 2 ? "open" : "cancelled" }),
    );
    const { client } = fakeClient([mkJob(3), ...newer]);
    expect((await latestRepeatableJob(client, "c1"))?.id).toBe("j3");
  });
  it("takes the newest completed delivery", async () => {
    const { client } = fakeClient([mkJob(3), mkJob(9), mkJob(5)]);
    expect((await latestRepeatableJob(client, "c1"))?.id).toBe("j9");
  });
  it("skips custom-material deliveries and other customers' jobs", async () => {
    const { client } = fakeClient([
      mkJob(3),
      mkJob(9, { material: "custom" }),
      mkJob(12, { customer_id: "someone-else" }),
    ]);
    expect((await latestRepeatableJob(client, "c1"))?.id).toBe("j3");
  });
  it("returns null for an empty history and when the read fails", async () => {
    expect(await latestRepeatableJob(fakeClient([]).client, "c1")).toBeNull();
    expect(await latestRepeatableJob(fakeClient([mkJob(3)], true).client, "c1")).toBeNull();
  });
  it("makes a single narrow read (one table, one limit-1 query)", async () => {
    const { client, calls } = fakeClient([mkJob(3)]);
    await latestRepeatableJob(client, "c1");
    expect(calls.filter((c) => c.startsWith("from:"))).toEqual(["from:jobs"]);
  });
  it("never carries a price; the driver is included only when inviting them", async () => {
    const j = (await latestRepeatableJob(
      fakeClient([mkJob(3, { final_price: 207, budget: 207 })]).client,
      "c1",
    ))!;
    const plain = bookAgainSearch(j)!;
    const invite = bookAgainSearch(j, { sameDriver: true })!;
    expect(JSON.stringify(plain)).not.toMatch(/207|price|budget/);
    expect(plain.driverId).toBeUndefined();
    expect(invite.driverId).toBe("d1");
    expect(plain).toMatchObject({
      material: "river_sand",
      quantity: 12,
      address: "Harward Road, Harare",
      lat: -17.8,
      lng: 31,
    });
  });
});

describe("repeatNoticeText", () => {
  const search = {
    repeat: true,
    material: "river_sand",
    quantity: 12,
    address: "Harward Road, Harare",
  };
  it("says nothing unless the booking was opened from a past delivery", () => {
    expect(repeatNoticeText({ material: "river_sand", quantity: 12 }, "River sand")).toBeNull();
  });
  it("names the reused details and says they can be changed", () => {
    const n = repeatNoticeText(search, "River sand")!;
    expect(n.details).toBe("River sand · 12 m³ · to Harward Road, Harare");
    expect(n.note).toMatch(/change anything/i);
  });
  it("says the price is quoted fresh and nothing is assigned until the customer chooses", () => {
    const n = repeatNoticeText(search, "River sand")!;
    expect(n.note).toMatch(/price is worked out fresh/i);
    expect(n.note).toMatch(/nothing is assigned until you choose/i);
  });
  it("an invited previous driver is not assigned and has no priority", () => {
    const n = repeatNoticeText({ ...search, driverId: "d1" }, "River sand")!;
    expect(n.invitation).toMatch(/invite your previous driver to bid/);
    expect(n.invitation).toMatch(/not assigned/);
    expect(n.invitation).toMatch(/no priority/);
    expect(n.invitation).toMatch(/other verified drivers can offer/);
    expect(repeatNoticeText(search, "River sand")!.invitation).toBeNull();
  });
  it("does not invent a pickup or an old price", () => {
    const n = repeatNoticeText({ ...search, driverId: "d1" }, "River sand")!;
    expect(JSON.stringify(n)).not.toMatch(/pickup|\$\d/i);
  });
});
