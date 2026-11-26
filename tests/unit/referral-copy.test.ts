import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REFERRAL_INTRO,
  REFERRAL_RULES,
  milestoneLine,
  referralRequirement,
  referralShareText,
  referralStatus,
} from "@/lib/referral-copy";

// 0181: referrals are non-cash recognition only. No wording may promise money, credit, a discount or a bonus.
const PROMISE = /\$|\bearn(s|ed|ing)?\b|\bbonus\b|\bcash\b|\bpaid\b|\bpay(out)?\b|\breward(s)?\b/i;

describe("referral wording", () => {
  const all = [
    REFERRAL_INTRO,
    ...REFERRAL_RULES,
    ...["pending", "approved", "hold", "released", "rejected", "frozen", "unknown"].flatMap((s) => [
      referralStatus(s).label,
      referralStatus(s).hint,
    ]),
    referralRequirement("driver"),
    referralRequirement("customer"),
    referralShareText("ABC123", "https://www.conz.co.zw/auth?ref=ABC123"),
    milestoneLine(2, 5),
    milestoneLine(50, null),
  ];
  it.each(all)("never promises money: %s", (t) => {
    // the intro states plainly that there is NO money, credit or discount
    const text =
      t === REFERRAL_INTRO
        ? t.replace("It does not give money, commission credit or a discount.", "")
        : t;
    expect(PROMISE.test(text)).toBe(false);
  });
  it("says plainly that referrals give no money, credit or discount", () => {
    expect(REFERRAL_INTRO).toMatch(/does not give money, commission credit or a discount/);
  });
  it("states the real requirements", () => {
    expect(REFERRAL_RULES.join(" ")).toMatch(/first delivery/);
    expect(REFERRAL_RULES.join(" ")).toMatch(/5 jobs/);
    expect(REFERRAL_RULES.join(" ")).toMatch(/7-day check/);
    expect(referralRequirement("driver")).toMatch(/5 completed jobs/);
  });
  it("released means recognised, never released money", () => {
    expect(referralStatus("released").label).toBe("Recognised");
  });
});

describe("referral screens", () => {
  const page = readFileSync("src/routes/_authenticated/refer.tsx", "utf8");
  const admin = readFileSync("src/routes/_authenticated/admin.referrals.tsx", "utf8");
  it("the referral page shows no amounts and makes no earning promise", () => {
    expect(page).not.toMatch(/reward_amount|money\(|Earned|Pending value|You earn|bonus/);
  });
  it("the admin screen does not show reward amounts or 'Force release'", () => {
    expect(admin).not.toMatch(/money\(r\.reward_amount|Force release|total_released_amount/);
  });
});
