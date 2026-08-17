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

  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.getBoundingClientRect().height);
  }, [step?.id, viewport.w, viewport.h]);

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
    <div className="fixed inset-0 z-40" aria-live="polite">
      {/* Dimmed bands — pointer-events auto so the rest of the page can't
          be interacted with while the tour is up, except the target
          itself, which simply has nothing painted over it. */}
      {bands ? (
        <>
          <div className="fixed bg-black/70" style={rectStyle(bands.bands.top)} />
          <div className="fixed bg-black/70" style={rectStyle(bands.bands.bottom)} />
          <div className="fixed bg-black/70" style={rectStyle(bands.bands.left)} />
          <div className="fixed bg-black/70" style={rectStyle(bands.bands.right)} />
          <div
            className="fixed rounded-lg ring-2 ring-primary pointer-events-none transition-all duration-200"
            style={rectStyle(bands.ring)}
          />
        </>
      ) : (
        // Still locating (navigating / waiting for the target) — a plain
        // full-screen dim so the page underneath doesn't feel interactive
        // mid-transition, with no false-positive highlight ring.
        <div className="fixed inset-0 bg-black/70" />
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          ref={cardRef}
          role="region"
          aria-label={`Guided tour, step ${stepIndex + 1} of ${totalSteps}: ${step.title}`}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: cardPos.placement === "bottom" ? -10 : 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: cardPos.placement === "bottom" ? -10 : 10 }}
          transition={{ duration: reduceMotion ? 0.12 : 0.22 }}
          className="fixed rounded-2xl bg-card border shadow-lift p-4"
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
