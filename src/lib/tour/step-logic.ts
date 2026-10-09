import type { TourStep } from "./types";

/**
 * Pure decisions the guided-tour engine makes about a step, kept free of
 * React/DOM globals so they can be unit-tested. The DOM is reached only
 * through the tiny structural interfaces below.
 */

export type QueryRoot = { querySelector: (selector: string) => unknown };
export type ClickTarget = { closest?: (selector: string) => unknown } | null;

/** The step's advance mode, folding in the legacy `interactive` flag. */
export function advanceMode(step: TourStep): "next" | "click" | "done" {
  if (step.advance) return step.advance;
  return step.interactive ? "click" : "next";
}

/** Has the user finished the action a "done" step is waiting for? */
export function isStepDone(step: TourStep, root: QueryRoot): boolean {
  if (advanceMode(step) !== "done" || !step.doneWhen) return true;
  return !!root.querySelector(step.doneWhen);
}

/** Does a click on `target` count as using the real highlighted control?
 *  Delegation via closest() keeps this working when React re-renders (and
 *  replaces) the element after the listener was attached. */
export function clickAdvances(step: TourStep, target: ClickTarget): boolean {
  if (advanceMode(step) !== "click" || !target?.closest) return false;
  return !!target.closest(step.clickTarget ?? step.target);
}

/** Next is disabled while a "done" step is still unmet. */
export function nextDisabled(step: TourStep, root: QueryRoot): boolean {
  return advanceMode(step) === "done" && !isStepDone(step, root);
}

/** Milliseconds to wait for the target before auto-skipping, or null to
 *  wait indefinitely (steps that depend on the user's own action must never
 *  be skipped on a timer — that was the "advances by itself" bug). */
export function locateTimeoutMs(step: TourStep, defaultMs: number): number | null {
  if (step.waitForUser || advanceMode(step) === "done") return null;
  return step.waitMs ?? defaultMs;
}
