import type { SupabaseClient } from "@supabase/supabase-js";

/** Context handed to a step's async route resolver. */
export type TourResolveCtx = {
  supabase: SupabaseClient;
  userId: string;
};

export type TourStep = {
  /** Stable id — used for analytics (tour_events.step_id) and resume. Must
   *  be unique within a tour and never reused for a different concept once
   *  shipped, since it's what "which step do people exit on" is keyed by. */
  id: string;
  title: string;
  /** One concept, one short sentence or two. No multi-instruction steps. */
  description: string;
  /**
   * Where this step's target lives. A static path for anything always on
   * screen (dashboard, wizard steps, static sections). For steps that only
   * make sense against a *real* record in a specific state (an open job
   * with bids, an in-progress delivery, a completed job with a receipt),
   * pass an async resolver that looks one up and returns a concrete path —
   * or null if the user doesn't have one yet, in which case the engine
   * treats this exactly like a missing target: skip to the next step,
   * logged in dev. This is deliberate, not a bug: a first-time user
   * legitimately has no bids/tracking/receipt to point at yet.
   */
  route: string | ((ctx: TourResolveCtx) => Promise<string | null>);
  /** CSS selector for the real element to highlight. */
  target: string;
  /** Max time (ms) to wait/poll for the target to appear after navigating
   *  before giving up and skipping this step. */
  waitMs?: number;
  /**
   * If true, the engine also listens for a real click on the target and
   * auto-advances when it happens (in addition to the always-available
   * Next button). Never set this on a step whose target submits real data
   * or spends money — those must only ever advance via the user
   * deliberately pressing Next, never a synthesized/implied action.
   */
  interactive?: boolean;
  /**
   * How the step moves on. "next" (default): only the card's Next button.
   * "click": a real click on `clickTarget ?? target` also advances (same
   * safety rule as `interactive`, which is the legacy spelling of this).
   * "done": the user must do something on the real page; the step advances
   * by itself once `doneWhen` matches, and Next stays disabled until then.
   */
  advance?: "next" | "click" | "done";
  /** advance:"click" — selector whose click advances (defaults to target). */
  clickTarget?: string;
  /** advance:"done" — selector that appears in the DOM once the user has
   *  finished the action (e.g. a button's data-location-ready="true"). */
  doneWhen?: string;
  /** The target only appears after the user does something (e.g. reaching
   *  the price screen). Never auto-skip: wait for it indefinitely, showing
   *  `waitingText`, while the page stays fully usable. */
  waitForUser?: boolean;
  /** "bottom" docks the card at the bottom of the screen instead of next to
   *  the target — for steps where the area around the target (a map to tap,
   *  a search dropdown that opens below it) must stay uncovered. */
  cardPosition?: "auto" | "bottom";
  /** Shown on the card while a waitForUser/done step is not yet satisfied. */
  waitingText?: string;
};

export type TourKey = "customer" | "driver";

export type TourConfig = {
  key: TourKey;
  label: string;
  steps: TourStep[];
};

export type TourEventType =
  | "start"
  | "step_view"
  | "next"
  | "back"
  | "skip_step" // engine auto-skipped a step whose target/route never resolved
  | "exit" // user pressed Skip Tour / closed mid-way
  | "complete";
