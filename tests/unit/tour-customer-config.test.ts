import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { customerTour } from "../../src/lib/tour/customer-tour";
import { advanceMode, locateTimeoutMs } from "../../src/lib/tour/step-logic";

const src = (p: string) => readFileSync(path.resolve(__dirname, "../../src", p), "utf8");
const appSource = [
  src("routes/_authenticated/customer.book.tsx"),
  src("components/RoleDashboard.tsx"),
  src("components/AddressPicker.tsx"),
].join("\n");

// First-order steps = everything up to and including the confirm step.
const firstOrder = customerTour.steps.slice(
  0,
  customerTour.steps.findIndex((s) => s.id === "customer-post") + 1,
);
const attr = (sel: string) => /\[data-tour="([^"]+)"\](?:\[([^\]]+)\])?/.exec(sel);

describe("customer first-order tour", () => {
  it("has unique step ids", () => {
    const ids = customerTour.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("orders the flow: dashboard → book → material → quantity → location → price → confirm", () => {
    expect(firstOrder.map((s) => s.id)).toEqual([
      "customer-dashboard",
      "customer-post-job",
      "customer-material",
      "customer-quantity",
      "customer-location",
      "customer-review",
      "customer-see-price",
      "customer-budget",
      "customer-post",
    ]);
  });

  it.each(firstOrder.map((s) => [s.id, s] as const))(
    "%s uses a stable data-tour selector that exists in the app",
    (_id, step) => {
      const m = attr(step.target);
      expect(m, `target ${step.target} should be a [data-tour="…"] selector`).not.toBeNull();
      expect(appSource).toContain(`data-tour="${m![1]}"`);
      if (step.doneWhen) {
        const d = attr(step.doneWhen);
        expect(d).not.toBeNull();
        expect(appSource).toContain(`data-tour="${d![1]}"`);
      }
    },
  );

  it("location step waits for the user's pin instead of timing out", () => {
    const loc = customerTour.steps.find((s) => s.id === "customer-location")!;
    expect(advanceMode(loc)).toBe("done");
    expect(loc.doneWhen).toContain('data-location-ready="true"');
    expect(locateTimeoutMs(loc, 2500)).toBeNull();
    expect(loc.waitingText).toBeTruthy();
    // Card must not cover the search dropdown / the map the user taps.
    expect(loc.cardPosition).toBe("bottom");
    expect(loc.description).toMatch(/pickup/i);
  });

  it("no first-order step auto-skips on a timer, and the booking screen steps never auto-submit", () => {
    for (const s of firstOrder.slice(2)) expect(locateTimeoutMs(s, 2500)).toBeNull();
    const confirm = customerTour.steps.find((s) => s.id === "customer-post")!;
    expect(advanceMode(confirm)).toBe("next"); // posting a job is never implied by the tour
    for (const s of firstOrder)
      expect(advanceMode(s) === "click" && s.target.includes("confirm")).toBe(false);
  });
});
