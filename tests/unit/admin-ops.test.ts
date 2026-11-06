import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SEARCH_PAGE_SIZE,
  hitDestination,
  isMissingRpc,
  pageCount,
  searchReady,
} from "@/lib/admin-ops";
import { notificationDestination } from "@/lib/notifications";

const text = (f: string) => readFileSync(f, "utf8");
const MIGRATION = "supabase/migrations/20261106100000_0142_admin_ops_reports_cancel_search.sql";
const sqlCode = (f: string) =>
  text(f)
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

describe("admin search helpers", () => {
  it("waits for two characters before asking the server", () => {
    expect(searchReady("")).toBe(false);
    expect(searchReady(" a ")).toBe(false);
    expect(searchReady("ab")).toBe(true);
  });
  it("counts pages from the total the server returns", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(SEARCH_PAGE_SIZE)).toBe(1);
    expect(pageCount(SEARCH_PAGE_SIZE + 1)).toBe(2);
    expect(pageCount(undefined)).toBe(1);
  });
  it("opens each result type at the right place", () => {
    expect(hitDestination({ kind: "jobs", id: "j1", job_id: "j1" })).toEqual({
      to: "/jobs/$id",
      params: { id: "j1" },
    });
    expect(hitDestination({ kind: "reports", id: "r1", job_id: null })).toEqual({
      to: "/admin/reports",
    });
    expect(hitDestination({ kind: "customers", id: "u1", job_id: null })).toEqual({
      to: "/admin/users",
    });
    expect(hitDestination({ kind: "payments", id: "p1", job_id: "j9" })).toEqual({
      to: "/jobs/$id",
      params: { id: "j9" },
    });
    expect(hitDestination({ kind: "transactions", id: "t1", job_id: null })).toBeNull();
  });
  it("treats a missing function (0142 not applied) as a fallback case, other errors as errors", () => {
    expect(isMissingRpc({ code: "PGRST202", message: "x" })).toBe(true);
    expect(isMissingRpc({ message: "Could not find the function public.admin_list_reports" })).toBe(
      true,
    );
    expect(isMissingRpc({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingRpc(null)).toBe(false);
  });
});

describe("support reply notifications", () => {
  it("a reply or status notification opens the customer's report screen", () => {
    expect(
      notificationDestination({ id: "1", type: "report_update", job_id: null, created_at: "" }),
    ).toEqual({ to: "/report" });
  });
});

describe("report privacy wiring", () => {
  it("the customer screen never selects the private note and shows the public reply", () => {
    const src = text("src/routes/_authenticated/report.tsx");
    expect(src).not.toMatch(/admin_notes/);
    expect(src).not.toMatch(/select\("\*"\)/);
    expect(src).toMatch(/admin_reply/);
  });
  it("the admin screen uses the server functions and keeps reply and private note apart", () => {
    const src = text("src/routes/_authenticated/admin.reports.tsx");
    expect(src).toMatch(/adminRespondToReport/);
    expect(src).toMatch(/adminListReports/);
    expect(src).toMatch(/Reply to the customer/);
    expect(src).toMatch(/Private note/);
    expect(src).toMatch(/never shown to the customer/);
  });
  it("the migration keeps admin_notes out of the customer column grant and has no DROP", () => {
    const sql = sqlCode(MIGRATION);
    const grant = sql.match(/grant select \(([^)]*)\)\s+on public\.reports to authenticated/i);
    expect(grant).not.toBeNull();
    expect(grant![1]).not.toMatch(/admin_notes/);
    expect(grant![1]).toMatch(/admin_reply/);
    expect(sql).toMatch(
      /grant insert \(user_id, job_id, description\) on public\.reports to authenticated/i,
    );
    expect(sql).not.toMatch(/\bdrop\s+(table|function|policy|trigger|column|index)/i);
  });
  it("every new function checks the caller is an admin and is closed to anon", () => {
    const sql = sqlCode(MIGRATION);
    for (const fn of ["admin_list_reports", "admin_respond_to_report", "admin_search"]) {
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`),
      );
    }
    expect((sql.match(/raise exception 'Forbidden'/g) ?? []).length).toBe(3);
  });
});

describe("admin cancellation is enforced in the database", () => {
  it("cancel_job requires a reason from an admin who is not a party, and writes an audit entry", () => {
    const sql = sqlCode(MIGRATION);
    expect(sql).toMatch(/A reason of at least 5 characters is required to cancel as an admin/);
    expect(sql).toMatch(/_action\s*=>\s*'job_cancelled_by_admin'/);
    expect(sql).toMatch(/values \(_job\.driver_id, 'job_cancelled'[^;]*_job_id\)/);
  });
  it("the screen's minimum matches the database's", () => {
    expect(text("src/lib/cancel-policy.ts")).toMatch(/ADMIN_CANCEL_REASON_MIN = 5/);
  });
});

describe("admin menu", () => {
  it("lists Search for every admin (the function enforces the roles)", () => {
    const src = text("src/routes/_authenticated/admin.tsx");
    expect(src).toMatch(/to: "\/admin\/search", label: "Search"[^}]*group: "Overview"/);
    expect(src).not.toMatch(/\/admin\/search"[^}]*superOnly/);
  });
});
