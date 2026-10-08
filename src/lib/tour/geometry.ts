/**
 * Pure positioning math for the guided tour overlay — no DOM, no React, so
 * it's easy to reason about (and unit-test) independent of the engine's
 * side effects. All rects are viewport-relative pixel values, matching
 * what `getBoundingClientRect()` and `position: fixed` both use natively
 * (no scroll-offset arithmetic needed).
 */

export type Rect = { top: number; left: number; right: number; bottom: number; width: number; height: number };

export function rectFromElement(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}

/** The four dimmed bands surrounding the target, leaving its own rect
 *  (expanded by `padding`) completely uncovered — that's what keeps the
 *  target "visibly undimmed above the overlay" without any z-index tricks
 *  on the target itself; it just never gets painted over. */
export function computeSpotlightBands(target: Rect, viewportWidth: number, viewportHeight: number, padding = 8) {
  const top = Math.max(0, target.top - padding);
  const left = Math.max(0, target.left - padding);
  const right = Math.min(viewportWidth, target.right + padding);
  const bottom = Math.min(viewportHeight, target.bottom + padding);

  return {
    ring: { top, left, right, bottom, width: right - left, height: bottom - top },
    bands: {
      top: { top: 0, left: 0, width: viewportWidth, height: Math.max(0, top) },
      bottom: { top: bottom, left: 0, width: viewportWidth, height: Math.max(0, viewportHeight - bottom) },
      left: { top, left: 0, width: Math.max(0, left), height: bottom - top },
      right: { top, left: right, width: Math.max(0, viewportWidth - right), height: bottom - top },
    },
  };
}

export type CardPlacement = { top: number; left: number; width: number; placement: "top" | "bottom" };

/**
 * Where the instruction card goes. Mobile-first: horizontal position is
 * always centered within side margins (this app is single-column,
 * 320-430px viewports — there's no meaningful left/right placement axis to
 * reason about). Vertical placement prefers below the target; if there
 * isn't room, it goes above; if *neither* fully fits (a target that fills
 * almost the whole screen), it clamps within the viewport as a last
 * resort rather than running off-screen — a rare degradation, documented
 * here rather than hidden.
 */
export function computeCardPlacement(
  target: Rect,
  cardHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  opts?: { margin?: number; gap?: number },
): CardPlacement {
  const margin = opts?.margin ?? 16;
  const gap = opts?.gap ?? 12;
  const width = Math.max(0, viewportWidth - margin * 2);
  const left = margin;

  const spaceBelow = viewportHeight - target.bottom - gap;
  const spaceAbove = target.top - gap;

  let placement: "top" | "bottom";
  let top: number;
  if (spaceBelow >= cardHeight || spaceBelow >= spaceAbove) {
    placement = "bottom";
    top = target.bottom + gap;
  } else {
    placement = "top";
    top = target.top - gap - cardHeight;
  }

  // Last-resort clamp so the card is always fully on-screen, even if that
  // means it ends up overlapping a target so large it leaves no clear band.
  top = Math.max(margin, Math.min(top, viewportHeight - cardHeight - margin));

  return { top, left, width, placement };
}

/** A target covering most of the screen (or measuring ~0px) can't be
 *  meaningfully spotlighted — a ring around it just dims nothing or hides
 *  everything. Callers drop the dim and dock the card instead. */
export function isUnspotlightable(target: Rect, viewportWidth: number, viewportHeight: number): boolean {
  if (target.width < 2 || target.height < 2) return true;
  return (target.width * target.height) / Math.max(1, viewportWidth * viewportHeight) > 0.6;
}

/** Card position for steps with no usable spotlight: docked at the bottom
 *  of the visible viewport so the page stays fully usable above it. */
export function computeDockedCardPlacement(
  cardHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 16,
  /** Never rise above this y (e.g. just below the search row). */
  minTop = 0,
): CardPlacement {
  return {
    top: Math.max(margin, minTop, viewportHeight - cardHeight - margin),
    left: margin,
    width: Math.max(0, viewportWidth - margin * 2),
    placement: "top",
  };
}

/** Is the target sufficiently visible already, or do we need to scroll? */
export function needsScrollIntoView(target: Rect, viewportHeight: number, safeMargin = 24): boolean {
  return target.top < safeMargin || target.bottom > viewportHeight - safeMargin;
}
