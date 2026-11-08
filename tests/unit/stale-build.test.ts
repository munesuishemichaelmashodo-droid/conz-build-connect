import { describe, expect, it, vi } from "vitest";
import {
  isDefinitelyOffline,
  isStaleBuildError,
  reloadOnceForNewBuild,
  shouldTreatRouterReloadAsDone,
} from "@/lib/stale-build";

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

describe("offline guard", () => {
  it("does not reload while the phone is definitely offline (the reload would land on the browser's error page and lose open work)", () => {
    const store = memory();
    const reload = vi.fn();
    expect(reloadOnceForNewBuild(store, reload, 1_000_000, true)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    // staying offline did not use up the once-a-minute allowance
    expect(reloadOnceForNewBuild(store, reload, 1_000_001, false)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("only a definite 'offline' counts: the browser's online flag can be true without a real connection", () => {
    expect(isDefinitelyOffline({ onLine: false })).toBe(true);
    expect(isDefinitelyOffline({ onLine: true })).toBe(false);
    expect(isDefinitelyOffline({})).toBe(false);
    expect(isDefinitelyOffline(undefined)).toBe(false);
  });
});

describe("TanStack Router's own reload when a screen's code fails to load", () => {
  it("is held back while the phone is definitely offline, so the failure shows a message instead of an error page", () => {
    expect(
      shouldTreatRouterReloadAsDone(
        "tanstack_router_reload:Failed to fetch dynamically imported module: x",
        true,
      ),
    ).toBe(true);
  });
  it("is left alone when online (a real new release still reloads once)", () => {
    expect(
      shouldTreatRouterReloadAsDone(
        "tanstack_router_reload:Failed to fetch dynamically imported module: x",
        false,
      ),
    ).toBe(false);
  });
  it("never touches any other stored value", () => {
    expect(shouldTreatRouterReloadAsDone("conz:stale-build-reload-at", true)).toBe(false);
    expect(shouldTreatRouterReloadAsDone("sb-abc-auth-token", true)).toBe(false);
    expect(shouldTreatRouterReloadAsDone(undefined, true)).toBe(false);
  });
});
