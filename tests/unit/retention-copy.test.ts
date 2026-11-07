import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const text = (p: string) => readFileSync(p, "utf8");

// Copy that carries a trust boundary. These are deliberately source-level checks, like value-copy.test.ts.
describe("positioning and trust-boundary copy", () => {
  it("uses the customer and driver promises on the homepage", () => {
    const t = text("src/routes/index.tsx");
    expect(t).toMatch(/One request\. Clear offers\. A recorded delivery\./);
    expect(t).toMatch(/See the load\. Set your price\. Build your record\./);
  });

  it("does not call a driver 'Online' on the customer's offer card (it only means the app was open)", () => {
    const t = text("src/components/redesign/OfferCard.tsx");
    expect(t).not.toMatch(/>\s*Online\s*</);
    expect(t).toMatch(/Active just now/);
    expect(t).toMatch(/does not mean they are free for a job/);
  });

  it("the previous-driver invitation never implies assignment or priority", () => {
    const t = text("src/lib/book-again.ts");
    expect(t).toMatch(/not assigned and get no priority/);
    expect(t).toMatch(/you choose/);
  });

  it("the repeat order says the price is quoted fresh", () => {
    expect(text("src/lib/book-again.ts")).toMatch(/price is worked out fresh/);
  });

  it("the cancellation dialog makes the reason optional and says it does not change the cancellation", () => {
    const t = text("src/routes/_authenticated/jobs.$id.tsx");
    expect(t).toMatch(/Main reason \(optional\)/);
    expect(t).toMatch(/does not change your cancellation/);
  });

  it("the post-delivery question is optional and dismissible", () => {
    const t = text("src/components/DeliveryFeedbackCard.tsx");
    expect(t).toMatch(/Optional\./);
    expect(t).toMatch(/Not now/);
  });

  it("the dispatch notification text is built without the street address, contact details or custom material text", () => {
    const sql = text("supabase/migrations/20261107180000_0151_dispatch_notification_content.sql")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(sql).toMatch(/coarse_place/);
    expect(sql).not.toMatch(/custom_material/);
    expect(sql).not.toMatch(/phone|contact/i);
    // the raw address only ever goes through coarse_place
    expect(sql).not.toMatch(/delivery_address\s*\|\|/);
  });
});
