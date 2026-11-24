import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { DriverEarningsCard, loadDriverPayables } from "@/components/wallet/DriverEarningsCard";
import { AdminPayablesCard, loadAdminPayables } from "@/components/admin/AdminPayablesCard";

// PostgREST's answer when a table is not in the schema cache (0171 not applied yet).
const missingTable = {
  data: null,
  error: {
    code: "PGRST205",
    message: "Could not find the table 'public.driver_payables' in the schema cache",
  },
};

// A chainable query builder that resolves to `result` at any point (or rejects).
function fakeDb(results: Record<string, unknown | Error>) {
  return {
    from(table: string) {
      const r = results[table];
      const settle = () => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r));
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
      q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
        settle().then(ok, bad);
      return q;
    },
  } as never;
}

const row = (status: string, gross: number, commission: number) => ({
  id: status + gross,
  job_id: "j",
  driver_id: "d",
  gross_amount: gross,
  commission,
  amount: gross - commission,
  status,
  created_at: "2026-11-24T00:00:00Z",
});

function render(el: ReturnType<typeof createElement>, key: unknown[], data: unknown) {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  qc.setQueryData(key, data);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, el));
}

describe("driver earnings card before and after 0171", () => {
  it("missing table -> null (not an empty list)", async () => {
    expect(await loadDriverPayables(fakeDb({ driver_payables: missingTable }), "d")).toBeNull();
  });
  it("permission error -> null", async () => {
    const denied = { data: null, error: { code: "42501", message: "permission denied" } };
    expect(await loadDriverPayables(fakeDb({ driver_payables: denied }), "d")).toBeNull();
  });
  it("network failure (rejected request) -> null", async () => {
    expect(
      await loadDriverPayables(fakeDb({ driver_payables: new Error("offline") }), "d"),
    ).toBeNull();
  });
  it("table present, no rows -> []", async () => {
    expect(
      await loadDriverPayables(fakeDb({ driver_payables: { data: [], error: null } }), "d"),
    ).toEqual([]);
  });
  it("renders nothing for null and for no rows; renders amounts for rows", () => {
    expect(
      render(createElement(DriverEarningsCard, { userId: "d" }), ["driver-payables", "d"], null),
    ).toBe("");
    expect(
      render(createElement(DriverEarningsCard, { userId: "d" }), ["driver-payables", "d"], []),
    ).toBe("");
    const html = render(
      createElement(DriverEarningsCard, { userId: "d" }),
      ["driver-payables", "d"],
      [row("payable", 1000, 70)],
    );
    expect(html).toContain("Earnings from ConZ-paid jobs");
    expect(html).toContain("930");
  });
});

describe("admin payables card before and after 0171", () => {
  it("missing payables table -> null (no zero totals shown)", async () => {
    expect(
      await loadAdminPayables(
        fakeDb({ driver_payables: missingTable, payments: { data: [], error: null } }),
      ),
    ).toBeNull();
  });
  it("refund query failing -> null (no false $0 refunds owed)", async () => {
    const r = await loadAdminPayables(
      fakeDb({
        driver_payables: { data: [], error: null },
        payments: { data: null, error: { message: "x" } },
      }),
    );
    expect(r).toBeNull();
  });
  it("network failure -> null", async () => {
    expect(
      await loadAdminPayables(
        fakeDb({ driver_payables: new Error("offline"), payments: new Error("offline") }),
      ),
    ).toBeNull();
  });
  it("tables present -> totals in cents, reversed excluded, refunds summed", async () => {
    const r = await loadAdminPayables(
      fakeDb({
        driver_payables: {
          data: [row("payable", 100.1, 7.01), row("reversed", 500, 35)],
          error: null,
        },
        payments: { data: [{ amount: "10.10" }, { amount: 0.2 }], error: null },
      }),
    );
    expect(r?.refundOwed).toBe(10.3);
    expect(r?.summary.commission).toBe(7.01);
  });
  it("renders nothing for null", () => {
    expect(render(createElement(AdminPayablesCard), ["admin-payables"], null)).toBe("");
  });
});
