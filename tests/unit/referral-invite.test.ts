import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, beforeEach } from "vitest";
import {
  INVITE_COPY,
  RULES,
  STAGE_LABEL,
  inviteLink,
  milestoneLabel,
  monthLabel,
  nextMilestone,
  progressFraction,
  progressLine,
  type ReferralProgressRow,
} from "@/lib/referral-copy";
import {
  clearPendingReferral,
  normaliseReferralCode,
  readPendingReferral,
  rememberPendingReferral,
} from "@/lib/pending-referral";
import { retentionText } from "@/components/admin/ReferralMetricsCard";

// Referrals give recognition only (0181/0185). Nothing the invite page shows may promise money, credit,
// discounts or better jobs, and nothing may read the invited person's details.
const MONEY =
  /\$|\bUSD\b|\bearn|\bbonus|\breward|\bcash|\bpaid out\b|\bwallet\b|\bdiscount|\bpriority dispatch|\bguarantee/i;

function allCopy(): string[] {
  // RULES[0] is the disclaimer that names what invitations are NOT; it is checked on its own below.
  const out: string[] = [...RULES.slice(1), ...Object.values(STAGE_LABEL)];
  for (const role of Object.values(INVITE_COPY)) {
    out.push(
      role.title,
      role.lead,
      role.counts,
      role.share("https://www.conz.co.zw/auth?ref=ABCD12"),
      ...role.why,
      ...role.theyGet,
    );
  }
  return out;
}

const row = (p: Partial<ReferralProgressRow>): ReferralProgressRow => ({
  ref_key: "k",
  invited_as: "customer",
  joined_month: "2026-11-01",
  stage: "in_progress",
  verified: null,
  jobs_done: 0,
  jobs_needed: 1,
  recognised_on: null,
  ...p,
});

describe("invite page wording", () => {
  it("never promises money, credit, discounts or job priority", () => {
    for (const t of allCopy()) expect(t, t).not.toMatch(MONEY);
  });
  it("the rules say plainly what invitations are not", () => {
    expect(RULES[0]).toMatch(
      /^Invitations are a way to say thank you\. They give recognition on this page, not money, credit, discounts or priority for jobs\.$/,
    );
    expect(RULES.join(" ")).toMatch(/withdrawn/);
    expect(RULES.join(" ")).toMatch(/never show you the name, number or details/);
  });
  it("each role has its own reason to invite and qualification rule", () => {
    expect(INVITE_COPY.customer.counts).toMatch(/first delivery/);
    expect(INVITE_COPY.driver.counts).toMatch(/verified and has completed five/);
    expect(INVITE_COPY.customer.why).not.toEqual(INVITE_COPY.driver.why);
  });
  it("the share message carries the link", () => {
    const link = inviteLink("https://www.conz.co.zw", "AB12CD");
    expect(link).toBe("https://www.conz.co.zw/auth?mode=register&ref=AB12CD");
    expect(INVITE_COPY.driver.share(link)).toContain(link);
    expect(INVITE_COPY.customer.share(link)).toContain(link);
  });
  it("the page and its source contain no money wording or money helpers", () => {
    const src = readFileSync("src/routes/_authenticated/refer.tsx", "utf8");
    expect(src).not.toMatch(/money\(|reward_amount|Refer & Earn|Earned|Pending value/);
    expect(src).not.toMatch(/from\("referrals"\)/); // progress comes only from my_referral_progress()
    expect(readFileSync("src/components/SidePanel.tsx", "utf8")).not.toMatch(/Refer & Earn/);
  });
  it("the admin page shows no amounts", () => {
    const src = readFileSync("src/routes/_authenticated/admin.referrals.tsx", "utf8");
    expect(src).not.toMatch(/money\(|reward_amount|Paid out|Force release/);
  });
});

describe("invitation progress", () => {
  it("customers: waiting, then qualified, counted or not", () => {
    expect(progressLine(row({}))).toBe("Waiting for their first delivery.");
    expect(progressLine(row({ stage: "qualified", jobs_done: 1 }))).toMatch(/7-day check/);
    expect(progressLine(row({ stage: "recognised" }))).toMatch(/Counted/);
    expect(progressLine(row({ stage: "not_recognised" }))).toMatch(/did not meet the rules/);
    expect(progressFraction(row({ stage: "not_recognised", jobs_done: 1 }))).toBe(0);
  });
  it("drivers: verification first, then deliveries", () => {
    const d = { invited_as: "driver" as const, jobs_needed: 5 };
    expect(progressLine(row({ ...d, verified: false }))).toMatch(/verification/);
    expect(progressLine(row({ ...d, verified: true, jobs_done: 3 }))).toBe(
      "3 of 5 deliveries completed.",
    );
    expect(progressFraction(row({ ...d, verified: true, jobs_done: 2 }))).toBeCloseTo(3 / 6);
  });
  it("milestones 1/5/10/25/50", () => {
    expect(nextMilestone(0)).toBe(1);
    expect(nextMilestone(1)).toBe(5);
    expect(nextMilestone(24)).toBe(25);
    expect(nextMilestone(50)).toBeNull();
    expect(milestoneLabel(1)).toBe("First invitation counted");
  });
  it("shows the month joined only", () => {
    expect(monthLabel("2026-11-01")).toBe("November 2026");
  });
  it("retention shows a dash with no sample", () => {
    expect(retentionText(0, 0)).toBe("–");
    expect(retentionText(4, 1)).toBe("1/4 · 25%");
  });
});

describe("referral link survives a Google sign-up", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });
  it("keeps a valid code, normalised", () => {
    rememberPendingReferral(" ab12cd ");
    expect(readPendingReferral()).toBe("AB12CD");
    clearPendingReferral();
    expect(readPendingReferral()).toBeNull();
  });
  it("ignores anything that is not a code", () => {
    for (const bad of ["", "abc", "x'; drop", "<script>", 42, null, "A".repeat(21)]) {
      expect(normaliseReferralCode(bad)).toBeNull();
    }
    rememberPendingReferral("<script>");
    expect(readPendingReferral()).toBeNull();
  });
  it("the server redeems a code only on the first activation", () => {
    const src = readFileSync("src/lib/account.functions.ts", "utf8");
    expect(src).toMatch(/normaliseReferralCode\(raw\)/);
    expect(src).toMatch(/existingRoles\.size === 0/);
  });
});

describe("no referral money path is left in the referral migrations", () => {
  const files = readdirSync("supabase/migrations").filter((f) => /_018[15]_/.test(f));
  it("finds 0181 and 0185", () => expect(files.length).toBe(2));
  for (const f of files) {
    it(`${f} never credits a wallet`, () => {
      const sql = readFileSync(`supabase/migrations/${f}`, "utf8").replace(/--.*$/gm, "");
      expect(sql).not.toMatch(/update\s+public\.wallets/i);
      expect(sql).not.toMatch(/insert\s+into\s+public\.wallet_transactions/i);
      expect(sql).not.toMatch(/credit_wallet/i);
    });
  }
});

describe("referral recovery scripts never bring money back", () => {
  for (const f of ["20261126130000_0181_rollback.sql", "20261126170000_0185_rollback.sql"]) {
    it(`${f} keeps the no-money guard and the protections`, () => {
      const sql = readFileSync(`supabase/rollbacks/${f}`, "utf8").replace(/--.*$/gm, "");
      expect(sql).not.toMatch(
        /wallets|wallet_transactions|referral_bonus|reward_amount|\bdrop\b|disable trigger/i,
      );
      expect(sql).not.toMatch(/create or replace function/i); // no old bodies are restored
    });
  }
  it("the Terms promise recognition only", () => {
    const t = readFileSync("src/routes/terms.tsx", "utf8");
    expect(t).toMatch(/Referrals give recognition only/);
    expect(t).not.toMatch(/Referral rewards are paid|referral rewards/i);
  });
});

describe("pending referral survives leaving the app (28/11)", () => {
  it("is kept for 30 days on this device, then forgotten", async () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    Object.assign(globalThis, { localStorage: fake, sessionStorage: { ...fake } });
    const m = await import("@/lib/pending-referral");
    const t0 = Date.UTC(2026, 10, 28);
    m.rememberPendingReferral(" conz12 ", t0);
    expect(m.readPendingReferral(t0 + 29 * 86_400_000)).toBe("CONZ12");
    expect(m.readPendingReferral(t0 + 31 * 86_400_000)).toBeNull();
    m.clearPendingReferral();
    expect(m.readPendingReferral(t0)).toBeNull();
  });
  it("ignores anything that is not a code", async () => {
    const m = await import("@/lib/pending-referral");
    expect(m.normaliseReferralCode("<script>")).toBeNull();
    expect(m.normaliseReferralCode("ab")).toBeNull();
  });
});

describe("customer and driver programmes are separate (0185, 28/11)", () => {
  it("explains each programme's rule and promises no money", async () => {
    const c = await import("@/lib/referral-copy");
    expect(c.PROGRAMME_FIRST_STEP.customer).toMatch(/first delivery/);
    expect(c.PROGRAMME_FIRST_STEP.driver).toMatch(/verified, completes five deliveries/);
    for (const t of [
      ...Object.values(c.PROGRAMME_TITLE),
      ...Object.values(c.PROGRAMME_FIRST_STEP),
    ]) {
      expect(t).not.toMatch(/\$|cash|money|credit|discount|priority|earn/i);
    }
  });
});
