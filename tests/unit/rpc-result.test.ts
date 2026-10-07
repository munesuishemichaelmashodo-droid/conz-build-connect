import { describe, expect, it } from "vitest";
import { rpcFailure } from "@/lib/rpc-result";

describe("rpcFailure", () => {
  it("reports an {ok:false} result as a failure with its message", () => {
    expect(rpcFailure({ ok: false, error: "wrong_pin", message: "Wrong PIN." })).toEqual({
      error: "wrong_pin",
      message: "Wrong PIN.",
    });
    expect(rpcFailure({ ok: false })?.error).toBe("failed");
  });

  it("treats success and legacy shapes as success", () => {
    expect(rpcFailure({ ok: true, request: { id: "x" } })).toBeNull();
    expect(rpcFailure({ id: "legacy-row" })).toBeNull();
    expect(rpcFailure(null)).toBeNull();
    expect(rpcFailure(undefined)).toBeNull();
  });
});
