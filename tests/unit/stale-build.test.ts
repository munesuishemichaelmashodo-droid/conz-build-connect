import { describe, expect, it, vi } from "vitest";
import { isStaleBuildError, reloadOnceForNewBuild } from "@/lib/stale-build";

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};

describe("isStaleBuildError", () => {
  it("recognises missing page files from an old release", () => {
    expect(
      isStaleBuildError(
        new TypeError(
          "Failed to fetch dynamically imported module: https://x.vercel.app/assets/GuidedTourOverlay-BYNfj8fW.js",
        ),
      ),
    ).toBe(true);
    expect(isStaleBuildError(new Error("Importing a module script failed."))).toBe(true);
    expect(isStaleBuildError("error loading dynamically imported module")).toBe(true);
  });
  it("ignores ordinary errors", () => {
    expect(isStaleBuildError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isStaleBuildError(null)).toBe(false);
  });
});

describe("reloadOnceForNewBuild", () => {
  it("reloads once, then not again within a minute", () => {
    const store = memory();
    const reload = vi.fn();
    expect(reloadOnceForNewBuild(store, reload, 1_000_000)).toBe(true);
    expect(reloadOnceForNewBuild(store, reload, 1_030_000)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadOnceForNewBuild(store, reload, 1_070_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
  it("still reloads when storage is unavailable", () => {
    const reload = vi.fn();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    expect(reloadOnceForNewBuild(broken, reload)).toBe(true);
    expect(reloadOnceForNewBuild(null, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
