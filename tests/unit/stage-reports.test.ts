import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { availableReports, reportLine, type StageReport } from "@/lib/stage-reports";
import { evidenceRecordFlags, type EvidenceRecord } from "@/lib/evidence-record";

const r = (p: Partial<StageReport>): StageReport => ({
  id: "r",
  job_id: "j",
  reported_by: "u",
  reporter_role: "driver",
  event: "collection_confirmed",
  issue: null,
  condition: "as_agreed",
  quantity_m3: 12,
  eta_minutes: null,
  note: null,
  evidence_id: null,
  corrects_report: null,
  created_at: "2026-11-26T08:00:00Z",
  ...p,
});

describe("stage reports (0187)", () => {
  it("every line names who reported it (statements, not facts)", () => {
    expect(reportLine(r({}))).toBe("Driver reports 12 m³ loaded, condition: as agreed.");
    expect(reportLine(r({ event: "delay", issue: "breakdown", eta_minutes: 45 }))).toMatch(
      /^Driver reports a delay \(breakdown\)/,
    );
    expect(
      reportLine(
        r({
          reporter_role: "customer",
          event: "delivery_problem",
          issue: "partial_delivery",
          quantity_m3: 8,
        }),
      ),
    ).toBe("Customer reports: only part was delivered, 8 m³ received.");
  });
  it("offers the driver collection reports only once the collection photo exists", () => {
    expect(availableReports("driver", "accepted", false, null)).toEqual([
      "collection_problem",
      "delay",
    ]);
    expect(availableReports("driver", "in_progress", true, null)[0]).toBe("collection_confirmed");
    expect(availableReports("driver", "completed", true, null)).toEqual([]);
  });
  it("lets the customer report a delivery problem during delivery or within 7 days", () => {
    const now = Date.parse("2026-11-26T12:00:00Z");
    expect(availableReports("customer", "in_progress", true, null, now)).toEqual([
      "delivery_problem",
    ]);
    expect(availableReports("customer", "completed", true, "2026-11-22T12:00:00Z", now)).toEqual([
      "delivery_problem",
    ]);
    expect(availableReports("customer", "completed", true, "2026-11-10T12:00:00Z", now)).toEqual(
      [],
    );
    expect(availableReports("customer", "accepted", false, null, now)).toEqual([]);
  });
  it("the reports panel never calls reports verified", () => {
    const src = readFileSync("src/components/evidence/JobStageReports.tsx", "utf8");
    expect(src).toMatch(/Con Z has not checked/);
    expect(src).not.toMatch(/\bverified\b/i);
  });
});

describe("admin evidence flags", () => {
  const base: EvidenceRecord = {
    job_id: "j",
    status: "in_progress",
    basis: "x",
    timeline: [],
    photos: [],
    reports: [],
    delivery_code: {
      issued: true,
      confirmed_at: null,
      wrong_attempts: 0,
      verification: "not_confirmed",
    },
    quantity: { ordered_m3: 12, delivered_m3: null, receiver_name: null },
    disputes: [],
    recorded_gps_points: 3,
  };
  it("is empty for a clean record", () => expect(evidenceRecordFlags(base)).toEqual([]));
  it("points at late, replaced and location-less photos, code guesses, short loads and delivery problems", () => {
    const flags = evidenceRecordFlags({
      ...base,
      photos: [
        {
          id: "a",
          kind: "pickup",
          uploaded_at: "",
          by_role: "driver",
          location_status: "unknown",
          has_location: false,
          is_photo_of_record: true,
          replaced_by: "b",
          replaced_note: "Replaced: blurred",
          added_after_dispute: false,
          verification: "submitted",
        },
        {
          id: "b",
          kind: "pickup",
          uploaded_at: "",
          by_role: "driver",
          location_status: "captured",
          has_location: true,
          is_photo_of_record: false,
          replaced_by: null,
          replaced_note: null,
          added_after_dispute: true,
          verification: "submitted",
        },
      ],
      reports: [
        {
          id: "c",
          event: "collection_confirmed",
          by_role: "driver",
          issue: null,
          condition: "as_agreed",
          quantity_m3: 10,
          eta_minutes: null,
          note: null,
          corrects: null,
          at: "",
          added_after_dispute: false,
          verification: "statement",
        },
        {
          id: "d",
          event: "delivery_problem",
          by_role: "customer",
          issue: "shortage",
          condition: null,
          quantity_m3: 8,
          eta_minutes: null,
          note: null,
          corrects: null,
          at: "",
          added_after_dispute: false,
          verification: "statement",
        },
      ],
      delivery_code: {
        issued: true,
        confirmed_at: null,
        wrong_attempts: 2,
        verification: "not_confirmed",
      },
    });
    expect(flags).toEqual([
      "1 item(s) added after the dispute opened",
      "1 photo(s) replaced by the person who took them (originals kept)",
      "1 photo(s) without a location",
      "2 wrong delivery code attempt(s)",
      "Driver reported 10 m³ loaded for 12 m³ ordered",
      "The customer or driver reported a delivery problem",
    ]);
  });
});

describe("0187 migration", () => {
  const sql = readFileSync(
    "supabase/migrations/20261126190000_0187_job_evidence_workflow.sql",
    "utf8",
  ).replace(/--.*$/gm, "");
  it("moves no money and writes no settings", () => {
    expect(sql).not.toMatch(/public\.wallets|wallet_transactions|system_settings/i);
  });
  it("keeps reports append-only", () => {
    expect(sql).toMatch(/before update or delete on public\.job_stage_reports/);
  });
});
