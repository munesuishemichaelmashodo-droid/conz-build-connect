/** Finished jobs older than this are tucked behind "Show older" in the jobs list (never deleted). */
export const PAST_JOBS_VISIBLE_DAYS = 30;

type Dated = { created_at: string; updated_at?: string | null };

/** Split finished jobs into recent (shown) and older (hidden until asked). Uses the last change time when known. */
export function splitPastJobs<T extends Dated>(jobs: T[], nowMs: number) {
  const cutoff = nowMs - PAST_JOBS_VISIBLE_DAYS * 86_400_000;
  const recent: T[] = [];
  const older: T[] = [];
  for (const j of jobs) {
    const t = Date.parse(j.updated_at ?? j.created_at);
    (Number.isNaN(t) || t >= cutoff ? recent : older).push(j);
  }
  return { recent, older };
}
