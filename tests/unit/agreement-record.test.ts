import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { changedDetailLabels, recordedDetails, type JobAgreement } from "@/lib/agreement";

const base: JobAgreement = {
  id: "a",
  job_id: "j",
  version: 2,
  proposed_by: "u",
  fare: 300,
  payment_method: "ecocash",
  payment_timing: "on_delivery",
  deposit_amount: 0,
  pickup_window: null,
  delivery_window: null,
  inclusions: null,
  exclusions: null,
  status: "accepted",
  customer_accepted_at: "2026-11-26T08:00:00Z",
  driver_accepted_at: "2026-11-26T08:05:00Z",
  created_at: "2026-11-26T08:00:00Z",
};

describe("recorded agreement details (0186)", () => {
  it("shows nothing for versions recorded before 0186", () => {
    expect(recordedDetails(base)).toEqual([]);
  });
  it("lists the load, truck, places, date and handling", () => {
    const rows = recordedDetails({
      ...base,
      content_hash: "0".repeat(32),
      material: "river_sand",
      quantity_m3: 12,
      truck_registration: "AEX 1234",
      truck_capacity_m3: 15,
      pickup_address: "Quarry gate",
      delivery_address: "14 Example Rd",
      agreed_date: "2026-11-28",
      loading_by: "collection_point",
      offloading_by: "driver_tips",
      collection_instructions: "Ask for the yard manager",
    });
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel.Load).toBe("12 m³ of river sand");
    expect(byLabel.Truck).toBe("AEX 1234 (15 m³)");
    expect(byLabel["Collect from"]).toBe("Quarry gate");
    expect(byLabel["Deliver to"]).toBe("14 Example Rd");
    expect(byLabel.Loading).toBe("Staff at the collection point");
    expect(byLabel.Offloading).toBe("The driver tips the load");
    expect(byLabel["Collection instructions"]).toBe("Ask for the yard manager");
    expect(byLabel.Date).toMatch(/28/);
  });
  it("names changed details in plain words, once each", () => {
    expect(changedDetailLabels(["delivery_address", "delivery_lat", "quantity_m3"])).toEqual([
      "the delivery address",
      "the quantity",
    ]);
  });
});

describe("0186 migration", () => {
  const sql = readFileSync(
    "supabase/migrations/20261126180000_0186_agreement_snapshot_and_audit.sql",
    "utf8",
  ).replace(/--.*$/gm, "");
  it("moves no money and writes no settings", () => {
    expect(sql).not.toMatch(
      /public\.wallets|wallet_transactions|system_settings|held_commission\s*=/i,
    );
  });
  it("blocks edits and deletes of versions and of their history", () => {
    expect(sql).toMatch(/before update or delete on public\.job_agreements/);
    expect(sql).toMatch(/before update or delete on public\.job_agreement_events/);
  });
  it("the card proposes through the 0186 function with a fallback", () => {
    const card = readFileSync("src/components/AgreementCard.tsx", "utf8");
    expect(card).toMatch(/propose_job_agreement_full/);
    expect(card).toMatch(/propose_job_agreement_terms/);
  });
});
