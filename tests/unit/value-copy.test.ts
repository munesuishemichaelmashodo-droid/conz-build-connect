// Guards the promises ConZ makes in its own wording: nothing may claim what the product does not do.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILES = [
  "src/routes/index.tsx",
  "src/routes/open-jobs.tsx",
  "src/routes/_authenticated/help.tsx",
  "src/routes/_authenticated/customer.book.tsx",
  "src/routes/_authenticated/wallet.tsx",
  "src/components/RoleDashboard.tsx",
  "src/components/OnboardingWalkthrough.tsx",
  "src/components/redesign/DriverHome.tsx",
];
const text = (f: string) => readFileSync(f, "utf8");

describe("customer and driver wording stays honest", () => {
  const banned: [RegExp, string][] = [
    [/guarantee/i, "no guarantees"],
    [/lowest price|cheapest|best price/i, "no lowest-price claim"],
    [/transport[- ]only/i, "transport-only booking is not built; do not advertise it"],
    [
      /bid first|assigned automatically to|auto-?assign/i,
      "an invited driver gets no priority and no automatic assignment",
    ],
    [/loads near you/i, "the feed is not filtered to the driver's area"],
    [
      /paid automatically|pays you automatically/i,
      "Con Z does not promise automatic driver payment",
    ],
    [/tracked the whole way/i, "live location only while the driver shares it"],
    [/lock it in/i, "an invitation to bid is not a lock or priority"],
    [
      /earnings[^.]{0,40}customers? (can )?see|customers? (can )?see[^.]{0,40}earnings/i,
      "earnings are not a customer-visible record",
    ],
    [/always commission-free/i, "only the first completed job has no commission"],
  ];
  for (const f of FILES) {
    for (const [re, why] of banned) {
      it(`${f}: ${why}`, () => {
        // help.tsx explains that nothing is assigned automatically; that sentence is allowed.
        // Source comments and honest negations ("not guaranteed") are not claims.
        const t = text(f)
          .replace(/^\s*\/\/.*$/gm, "")
          .replace(/not guaranteed/g, "")
          .replace(/nothing is assigned automatically/g, "")
          .replace(/is not assigned automatically/g, "");
        expect(re.test(t)).toBe(false);
      });
    }
  }

  it("states the commission base and the first-job rule to drivers", () => {
    const home = text("src/routes/index.tsx");
    expect(home).toMatch(
      /7% commission on eligible job value, including materials and\s+transport/,
    );
    expect(home).toMatch(/first\s+completed job is commission-free/);
    expect(text("src/routes/_authenticated/wallet.tsx")).toMatch(
      /7% of the full job price, materials and transport/,
    );
  });

  it("words the driver's fee for delivery-only jobs as a share of the delivery fare, in commission-credit terms", () => {
    const form = text("src/routes/_authenticated/jobs.$id.tsx");
    expect(form).toMatch(/of your delivery fare; material is not part of it/);
    expect(form).toMatch(/reserved from your commission credit when the customer accepts/);
  });

  it("describes an invited previous driver as invited, not assigned", () => {
    expect(text("src/routes/_authenticated/customer.book.tsx")).toMatch(
      /invite your previous driver to bid/,
    );
    expect(text("src/routes/_authenticated/jobs.$id.tsx")).toMatch(
      /Invite this driver to bid again/,
    );
  });

  it("only promises live location while the driver shares it", () => {
    expect(text("src/routes/index.tsx")).toMatch(/while the driver shares it/);
    expect(text("src/routes/_authenticated/help.tsx")).toMatch(
      /while the driver's phone is sharing it/,
    );
  });

  it("permission copy does not promise nearby drivers or guaranteed live tracking", () => {
    const w = text("src/components/OnboardingWalkthrough.tsx");
    expect(w).not.toMatch(/drivers near you/i);
    expect(w).not.toMatch(/live tracking work/i);
    expect(w).toMatch(/Both are optional/);
    expect(w).toMatch(/Skip for now/);
  });
});
