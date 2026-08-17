import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useGuidedTour } from "@/hooks/useGuidedTour";
import { GuidedTourOverlay } from "@/components/GuidedTourOverlay";
import type { TourConfig, TourEventType, TourKey, TourStep } from "@/lib/tour/types";

type TourState = {
  /** Start (or restart) a tour from its first step. Persistence-aware
   *  resume/restart entry points are added in step (d) — for now this is
   *  the engine-only, always-starts-at-0 version. */
  startTour: (config: TourConfig) => void;
  /** Currently running tour's key, or null if none is active. */
  activeTourKey: TourKey | null;
};

const Ctx = createContext<TourState>({
  startTour: () => {},
  activeTourKey: null,
});

/** Mounted once, in __root.tsx, above <Outlet/> — the tour has to survive
 *  route navigations it itself triggers (e.g. dashboard -> post job), which
 *  only works if its state lives above the router outlet, not inside any
 *  one route's component tree. */
export function GuidedTourProvider({ children }: { children: ReactNode }) {
  const onEvent = useCallback(
    (type: TourEventType, step: TourStep | null, index: number, tourKey: TourKey) => {
      // Step (d) wires this into a `tour_events` table for the "which step
      // do people exit on" requirement. For now (engine only, no content
      // yet), just the dev-visible log that requirement 8 already calls
      // for on skips.
      if (import.meta.env.DEV) {
        console.info(`[guided-tour] ${tourKey} event="${type}" step=${step?.id ?? "-"} index=${index}`);
      }
    },
    [],
  );

  const tour = useGuidedTour({ onEvent });

  const startTour = useCallback((config: TourConfig) => tour.start(config, 0), [tour]);

  return (
    <Ctx.Provider value={{ startTour, activeTourKey: tour.config?.key ?? null }}>
      {children}
      <GuidedTourOverlay
        step={tour.step}
        stepIndex={tour.stepIndex}
        totalSteps={tour.totalSteps}
        status={tour.status}
        targetRect={tour.targetRect}
        onNext={tour.next}
        onBack={tour.back}
        onSkip={tour.skipTour}
      />
    </Ctx.Provider>
  );
}

export const useTour = () => useContext(Ctx);
