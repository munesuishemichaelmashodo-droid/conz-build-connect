import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { computeCardPlacement, computeSpotlightBands, type Rect } from "@/lib/tour/geometry";
import type { TourStep } from "@/lib/tour/types";
import type { TourStatus } from "@/hooks/useGuidedTour";

/**
 * Purely presentational — all the "where does the target actually live"
 * logic is in useGuidedTour. This just draws the four dimmed bands + a
 * highlight ring around targetRect (leaving the target itself unpainted,
 * so it stays visibly undimmed and — for interactive steps — still
 * genuinely tappable), plus the instruction card.
 *
 * z-index: 40. Deliberately *below* Radix Dialog/Sheet (z-50) and the
 * first-run OnboardingWalkthrough (z-[60]) — see useGuidedTour.ts's
 * top-of-file comment for the full policy. Portaled to document.body so
 * no ancestor's stacking context or overflow can trap it.
 */
export function GuidedTourOverlay({
  step,
  stepIndex,
  totalSteps,
  status,
  targetRect,
  onNext,
  onBack,
  onSkip,
}: {
  step: TourStep | null;
  stepIndex: number;
  totalSteps: number;
  status: TourStatus;
  targetRect: Rect | null;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(160);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const reduceMotion = useReducedMotion();

  useLayoutEffect(() => {
    const update = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  // Re-measure whenever the viewport changes, in case the same card's
  // height reflows at the new width.
  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.getBoundingClientRect().height);
  }, [viewport.w, viewport.h]);

  // Step-change measurement is deliberately a *callback* ref, not a
  // useLayoutEffect keyed on step.id: AnimatePresence's mode="wait" keeps
  // the outgoing card mounted until its exit finishes, so the incoming
  // card's DOM node doesn't exist yet at the moment step.id changes and
  // this component re-renders — an effect keyed on step.id fires too
  // early (cardRef.current is still null or still the old node) and never
  // re-fires once the new node actually mounts a beat later, leaving
  // cardHeight stale for that step. Measuring at the moment React actually
  // attaches the node sidesteps the race entirely.
  const setCardRef = (el: HTMLDivElement | null) => {
    cardRef.current = el;
    if (el) setCardHeight(el.getBoundingClientRect().height);
  };

  if (!mounted || !step || status === "idle" || status === "done") return null;

  // Paused for a real modal: render nothing at all (not just invisible —
  // fully unmounted — so it can never intercept a click meant for the
  // thing that actually needs the user's attention right now).
  if (status === "paused") return null;

  const visible = status === "ready" && !!targetRect && viewport.w > 0;
  const bands = visible ? computeSpotlightBands(targetRect!, viewport.w, viewport.h) : null;
  const cardPos = visible
    ? computeCardPlacement(targetRect!, cardHeight, viewport.w, viewport.h)
    : { top: viewport.h / 2 - cardHeight / 2, left: 16, width: Math.max(0, viewport.w - 32), placement: "bottom" as const };

  return createPortal(
    // pointer-events-none on the outer wrapper too, not just the band
    // children below — this div is `fixed inset-0`, so even with no
    // background it covers the *entire* viewport and would otherwise
    // intercept every click on the page by default regardless of what
    // its children do (pointer-events isn't something a none-parent
    // can "leak through" — a child must opt back in explicitly). The
    // card re-enables pointer-events-auto on itself so it's still
    // genuinely interactive.
    <div className="fixed inset-0 z-40 pointer-events-none" aria-live="polite">
      {/* Dimmed bands are pointer-events-none — purely visual darkening,
          not a click-blocker. Several real screens (the booking wizard,
          job detail's action row) have their own Next/Back controls that
          live outside whatever single element a given step highlights;
          blocking clicks there would trap the user on one internal step
          with no way to actually progress the real UI underneath, since
          our card's own Next only advances the *tour's* step index, not
          app state. Letting genuine interaction reach the real page means
          a step describing "pick a material" still lets the person use
          the wizard's own Next to move on, which then surfaces the next
          tour step's target naturally — exactly the "tap the real
          highlighted element where practical, Next as fallback"
          requirement, just not limited to elements *inside* the highlight
          box. The highlighted target itself is always genuinely tappable
          regardless (never covered by a band to begin with). */}
      {bands ? (
        <>
          <div className="fixed bg-black/70 pointer-events-none" style={rectStyle(bands.bands.top)} />
          <div className="fixed bg-black/70 pointer-events-none" style={rectStyle(bands.bands.bottom)} />
          <div className="fixed bg-black/70 pointer-events-none" style={rectStyle(bands.bands.left)} />
          <div className="fixed bg-black/70 pointer-events-none" style={rectStyle(bands.bands.right)} />
          <div
            className="fixed rounded-lg ring-2 ring-primary pointer-events-none transition-all duration-200"
            style={rectStyle(bands.ring)}
          />
        </>
      ) : (
        // Still locating (navigating / waiting for the target) — a plain
        // full-screen dim so the page underneath doesn't feel interactive
        // mid-transition, with no false-positive highlight ring. This one
        // *does* block clicks (pointer-events-auto, unlike the bands
        // above) — deliberately, since there's no known-good target yet
        // to let the user interact around.
        <div className="fixed inset-0 bg-black/70 pointer-events-auto" />
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          ref={setCardRef}
          role="region"
          aria-label={`Guided tour, step ${stepIndex + 1} of ${totalSteps}: ${step.title}`}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: cardPos.placement === "bottom" ? -10 : 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: cardPos.placement === "bottom" ? -10 : 10 }}
          transition={{ duration: reduceMotion ? 0.12 : 0.22 }}
          className="fixed rounded-2xl bg-card border shadow-lift p-4 pointer-events-auto"
          style={{ top: cardPos.top, left: cardPos.left, width: cardPos.width }}
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-primary">
              {stepIndex + 1} of {totalSteps}
            </span>
            <button
              type="button"
              onClick={onSkip}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground min-h-[32px] px-1"
              aria-label="Skip tour"
            >
              Skip tour <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <h2 className="font-display font-bold text-lg leading-snug">{step.title}</h2>
          <p className="text-sm text-muted-foreground mt-1">{step.description}</p>

          <div className="flex items-center justify-center gap-1.5 mt-3">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === stepIndex ? "w-5 bg-primary" : "w-1.5 bg-muted"}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2 mt-4">
            {stepIndex > 0 && (
              <Button
                variant="outline"
                onClick={onBack}
                className="h-11 min-w-11 px-3"
                aria-label="Previous step"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
            )}
            <Button onClick={onNext} className="flex-1 h-11 font-display uppercase tracking-wide">
              {stepIndex + 1 === totalSteps ? "Finish" : "Next"}
            </Button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body,
  );
}

function rectStyle(r: { top: number; left: number; width: number; height: number }) {
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}
