import { describe, expect, it, vi } from "vitest";
import {
  isDuplicateEvidenceError,
  isTransientNetworkError,
  recordWithRetry,
} from "@/lib/evidence-retry";

type Row = { id: string };
const ROW: Row = { id: "ev-1" };
const net = { message: "Failed to fetch" };
const duplicate = {
  message: 'duplicate key value violates unique constraint "job_evidence_storage_path_key"',
  code: "23505",
};

function run(
  results: Array<{ data: Row | null; error: { message: string; code?: string } | null }>,
  lookup: Row | null = null,
) {
  const call = vi.fn(async () => results.shift() ?? { data: null, error: net });
  const find = vi.fn(async () => lookup);
  const sleep = vi.fn(async () => {});
  return {
    call,
    find,
    sleep,
    promise: recordWithRetry(call, find, { attempts: 3, delayMs: 100, sleep }),
  };
}

describe("error classification", () => {
  it("recognises weak-network failures", () => {
    for (const m of [
      "Failed to fetch",
      "NetworkError when attempting to fetch resource.",
      "Load failed",
      "request timed out",
      "502 Bad Gateway",
      "fetch failed",
    ]) {
      expect(isTransientNetworkError(m)).toBe(true);
    }
  });
  it("does not treat business rules as network errors", () => {
    for (const m of [
      "Only the assigned driver can record the pickup photo.",
      "This job is not active.",
      "Not part of this job",
      "The photo was not uploaded. Take or choose it again.",
    ]) {
      expect(isTransientNetworkError(m)).toBe(false);
    }
    expect(isTransientNetworkError(undefined)).toBe(false);
  });
  it("recognises the duplicate-photo error", () => {
    expect(isDuplicateEvidenceError(duplicate)).toBe(true);
    expect(
      isDuplicateEvidenceError({ message: "duplicate key value violates unique constraint" }),
    ).toBe(true);
    expect(isDuplicateEvidenceError({ message: "Failed to fetch" })).toBe(false);
  });
});

describe("recordWithRetry", () => {
  it("returns the row on the first success without waiting", async () => {
    const t = run([{ data: ROW, error: null }]);
    await expect(t.promise).resolves.toEqual(ROW);
    expect(t.call).toHaveBeenCalledTimes(1);
    expect(t.sleep).not.toHaveBeenCalled();
  });

  it("retries a network failure and succeeds, waiting a little longer each time", async () => {
    const t = run([
      { data: null, error: net },
      { data: null, error: net },
      { data: ROW, error: null },
    ]);
    await expect(t.promise).resolves.toEqual(ROW);
    expect(t.call).toHaveBeenCalledTimes(3);
    expect(t.sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
  });

  it("gives up after the last attempt with the original message", async () => {
    const t = run([
      { data: null, error: net },
      { data: null, error: net },
      { data: null, error: net },
    ]);
    await expect(t.promise).rejects.toThrow("Failed to fetch");
    expect(t.call).toHaveBeenCalledTimes(3);
  });

  it("when a retry says 'duplicate', the first try had worked: returns the saved row", async () => {
    const t = run(
      [
        { data: null, error: net },
        { data: null, error: duplicate },
      ],
      ROW,
    );
    await expect(t.promise).resolves.toEqual(ROW);
    expect(t.find).toHaveBeenCalledTimes(1);
  });

  it("a duplicate error with no saved row is a real failure", async () => {
    const t = run([{ data: null, error: duplicate }], null);
    await expect(t.promise).rejects.toThrow("duplicate key");
  });

  it("never retries a business-rule refusal", async () => {
    const t = run([
      { data: null, error: { message: "Only the assigned driver can record the pickup photo." } },
    ]);
    await expect(t.promise).rejects.toThrow("Only the assigned driver");
    expect(t.call).toHaveBeenCalledTimes(1);
    expect(t.sleep).not.toHaveBeenCalled();
  });
});
