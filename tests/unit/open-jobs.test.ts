import { describe, expect, it, vi } from "vitest";
import { fetchOpenJob, fetchOpenJobs, isMissingFunction } from "@/lib/open-jobs";

const fakeClient = (rpcResult: { data: unknown; error: unknown }, tableRows: unknown[] = []) => {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: async () => ({ data: tableRows, error: null }),
    maybeSingle: async () => ({ data: tableRows[0] ?? null, error: null }),
  };
  return { rpc: vi.fn(async () => rpcResult), from: vi.fn(() => chain) } as any;
};

describe("open jobs for drivers", () => {
  it("recognises a missing function", () => {
    expect(isMissingFunction({ code: "PGRST202" })).toBe(true);
    expect(
      isMissingFunction({ message: "Could not find the function public.driver_open_jobs" }),
    ).toBe(true);
    expect(isMissingFunction({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
  it("uses the area-only function when it exists", async () => {
    const c = fakeClient({ data: [{ id: "a" }], error: null }, [{ id: "table-row" }]);
    expect(await fetchOpenJobs(c)).toEqual([{ id: "a" }]);
    expect(c.from).not.toHaveBeenCalled();
  });
  it("falls back to the table only while the migration is missing", async () => {
    const c = fakeClient(
      { data: null, error: { code: "PGRST202", message: "Could not find the function" } },
      [{ id: "legacy" }],
    );
    expect(await fetchOpenJobs(c)).toEqual([{ id: "legacy" }]);
  });
  it("does not fall back on a real error such as permission denied", async () => {
    const c = fakeClient({ data: null, error: { code: "42501", message: "permission denied" } }, [
      { id: "legacy" },
    ]);
    await expect(fetchOpenJobs(c)).rejects.toThrow("permission denied");
    expect(await fetchOpenJob(c, "x")).toBeNull();
  });
});
