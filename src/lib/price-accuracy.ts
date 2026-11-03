// Plain-language reading of the admin price accuracy report (0123).

export type PriceAccuracyRow = {
  material: string;
  jobs: number;
  median_estimate: number | string;
  median_accepted: number | string;
  median_gap_pct: number | string;
  within_15_pct: number;
  last_job_at: string;
};

/** Fewer jobs than this and a direction is just noise. */
export const MIN_JOBS_FOR_ADVICE = 5;

export function priceAccuracyAdvice(r: Pick<PriceAccuracyRow, "jobs" | "median_gap_pct">): {
  tone: "ok" | "warn" | "info";
  text: string;
} {
  const gap = Number(r.median_gap_pct);
  if (r.jobs < MIN_JOBS_FOR_ADVICE || !Number.isFinite(gap)) {
    return { tone: "info", text: `Too few jobs to judge yet (needs ${MIN_JOBS_FOR_ADVICE}).` };
  }
  const pct = Math.abs(Math.round(gap));
  if (pct <= 10) return { tone: "ok", text: "Estimates are close to what customers pay." };
  return gap > 0
    ? {
        tone: "warn",
        text: `Customers usually pay about ${pct}% more than we estimate: our estimate is too low. Consider raising this material's prices.`,
      }
    : {
        tone: "warn",
        text: `Customers usually pay about ${pct}% less than we estimate: our estimate is too high. Consider lowering this material's prices.`,
      };
}
