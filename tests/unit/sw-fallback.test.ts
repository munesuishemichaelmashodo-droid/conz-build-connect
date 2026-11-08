import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// Runs the real public/sw.js with stand-ins for the worker globals, so the shipped file itself is what is tested.
function loadWorker(opts: { fetchOk: boolean; cached: boolean }) {
  type Handler = (e: Record<string, unknown>) => void;
  const handlers: Record<string, Handler> = {};
  const cachedPage = { cachedOfflinePage: true };
  const self = {
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
    skipWaiting: () => Promise.resolve(),
    registration: {
      showNotification: () => Promise.resolve(),
      navigationPreload: { enable: () => Promise.resolve() },
    },
    clients: { matchAll: () => Promise.resolve([]) },
  };
  const ctx: Record<string, unknown> = {
    self,
    caches: {
      open: () => Promise.resolve({ add: () => Promise.resolve() }),
      keys: () => Promise.resolve([]),
      match: (url: string) =>
        Promise.resolve(opts.cached && url === "/offline.html" ? cachedPage : undefined),
    },
    fetch: () =>
      opts.fetchOk ? Promise.resolve({ fromNetwork: true }) : Promise.reject(new Error("offline")),
    Request: class {},
    Response: { error: () => ({ errorResponse: true }) },
    Promise,
    console,
  };
  runInNewContext(readFileSync("public/sw.js", "utf8"), ctx);
  const respond = (
    request: { mode: string; method: string },
    preloadResponse?: Promise<unknown>,
  ) => {
    let responded: Promise<unknown> | undefined;
    handlers.fetch({
      request,
      preloadResponse,
      respondWith: (p: Promise<unknown>) => (responded = p),
    });
    return responded;
  };
  return { handlers, respond, cachedPage };
}

describe("public/sw.js navigation fallback", () => {
  it("passes a normal page load straight through when there is signal", async () => {
    const w = loadWorker({ fetchOk: true, cached: true });
    expect(await w.respond({ mode: "navigate", method: "GET" })).toEqual({ fromNetwork: true });
  });
  it("answers a failed page load with the saved fallback page", async () => {
    const w = loadWorker({ fetchOk: false, cached: true });
    expect(await w.respond({ mode: "navigate", method: "GET" })).toBe(w.cachedPage);
  });
  it("still fails honestly if the fallback page was never cached", async () => {
    const w = loadWorker({ fetchOk: false, cached: false });
    expect(await w.respond({ mode: "navigate", method: "GET" })).toEqual({ errorResponse: true });
  });
  it("never touches anything that is not a page being opened by GET", () => {
    const w = loadWorker({ fetchOk: false, cached: true });
    expect(w.respond({ mode: "cors", method: "GET" })).toBeUndefined();
    expect(w.respond({ mode: "no-cors", method: "GET" })).toBeUndefined();
    expect(w.respond({ mode: "navigate", method: "POST" })).toBeUndefined();
  });
  it("keeps the push handlers", () => {
    const w = loadWorker({ fetchOk: true, cached: true });
    expect(typeof w.handlers.push).toBe("function");
    expect(typeof w.handlers.notificationclick).toBe("function");
  });
});
