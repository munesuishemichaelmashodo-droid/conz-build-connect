import { describe, expect, it } from "vitest";
import { OFFLINE_PAGE_URL, shouldServeOfflinePage } from "@/lib/offline-fallback";

describe("shouldServeOfflinePage", () => {
  it("only steps in for a page the person is opening (a navigation) that is a plain GET", () => {
    expect(shouldServeOfflinePage({ mode: "navigate", method: "GET" })).toBe(true);
  });
  it("never touches data requests, scripts, images or anything the app fetches itself", () => {
    for (const mode of ["cors", "no-cors", "same-origin", "websocket"]) {
      expect(shouldServeOfflinePage({ mode, method: "GET" })).toBe(false);
    }
  });
  it("never touches form posts or other methods, even for a navigation", () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      expect(shouldServeOfflinePage({ mode: "navigate", method })).toBe(false);
    }
  });
  it("serves one fixed page that is precached with the worker", () => {
    expect(OFFLINE_PAGE_URL).toBe("/offline.html");
  });
});
