import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useGuidedTour } from "@/hooks/useGuidedTour";
import { GuidedTourOverlay } from "@/components/GuidedTourOverlay";
import { WelcomeTourPrompt } from "@/components/WelcomeTourPrompt";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { customerTour } from "@/lib/tour/customer-tour";
import { driverTour } from "@/lib/tour/driver-tour";
import type { TourConfig, TourEventType, TourKey, TourStep } from "@/lib/tour/types";

export type TourProgressRow = {
  tour_key: TourKey;
  status: "in_progress" | "completed" | "skipped";
  current_step_index: number;
};

type TourState = {
  /** Start (or restart, with resume:false — the default) a tour. Pass
   *  resume:true to continue from wherever tour_progress last left off
   *  (e.g. after the app was closed/backgrounded mid-tour) instead of
   *  starting over at step 0 — that's the manual-restart-vs-continue
   *  distinction the Settings -> Help entry point needs. */
  startTour: (config: TourConfig, opts?: { resume?: boolean }) => void;
  activeTourKey: TourKey | null;
  /** Per-tour saved progress, or undefined if this user has never started
   *  (or been offered) that tour — Settings -> Help uses this to label its
   *  button Start / Continue / Restart. */
  progress: Record<TourKey, TourProgressRow | undefined>;
};

const EMPTY_PROGRESS: Record<TourKey, TourProgressRow | undefined> = { customer: undefined, driver: undefined };

const Ctx = createContext<TourState>({
  startTour: () => {},
  activeTourKey: null,
  progress: EMPTY_PROGRESS,
});

const CONFIGS: Record<TourKey, TourConfig> = { customer: customerTour, driver: driverTour };
// Which dashboard route offers a first-time prompt for which tour.
const DASHBOARD_TOUR: Record<string, TourKey> = { "/customer": "customer", "/driver": "driver" };

/** Mounted once, in __root.tsx, above <Outlet/> — the tour has to survive
 *  route navigations it itself triggers (e.g. dashboard -> post job), which
 *  only works if its state lives above the router outlet, not inside any
 *  one route's component tree. */
export function GuidedTourProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const qc = useQueryClient();

  // tour_progress / tour_events are separate from, and never touch,
  // profiles.spotlights_seen (SpotlightCallout) or
  // profiles.onboarding_completed_at (OnboardingWalkthrough) — see the
  // 0039 migration.
  const { data: progressRows } = useQuery({
    queryKey: ["tour-progress", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tour_progress")
        .select("tour_key,status,current_step_index")
        .eq("user_id", userId!);
      if (error) throw error;
      return (data ?? []) as TourProgressRow[];
    },
  });

  const progress = useMemo<Record<TourKey, TourProgressRow | undefined>>(() => {
    const p: Record<TourKey, TourProgressRow | undefined> = { customer: undefined, driver: undefined };
    for (const row of progressRows ?? []) p[row.tour_key] = row;
    return p;
  }, [progressRows]);

  // Gate for the first-time welcome prompt: only once the *existing*
  // short OnboardingWalkthrough is done, so the two never stack. Same
  // profiles.onboarding_completed_at field that component itself reads.
  const { data: onboardingDone } = useQuery({
    queryKey: ["onboarding-completed-check", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("onboarding_completed_at").eq("id", userId!).maybeSingle();
      return !!data?.onboarding_completed_at;
    },
  });

  const writeProgress = useCallback(
    (tourKey: TourKey, patch: Record<string, unknown>) => {
      if (!userId) return;
      supabase
        .from("tour_progress")
        .upsert({ user_id: userId, tour_key: tourKey, updated_at: new Date().toISOString(), ...patch }, { onConflict: "user_id,tour_key" })
        .then(({ error }) => {
          if (error) {
            console.warn("[guided-tour] failed to save progress", error);
            return;
          }
          qc.invalidateQueries({ queryKey: ["tour-progress", userId] });
        });
    },
    [userId, qc],
  );

  const onEvent = useCallback(
    (type: TourEventType, step: TourStep | null, index: number, tourKey: TourKey) => {
      if (import.meta.env.DEV) {
        console.info(`[guided-tour] ${tourKey} event="${type}" step=${step?.id ?? "-"} index=${index}`);
      }

      if (userId) {
        // Fire-and-forget analytics log — every event type, not just
        // exits, since "which step do people most often exit on" is just
        // one query (event_type='exit' grouped by step_id) against the
        // same table; no separate pipeline needed.
        void supabase
          .from("tour_events")
          .insert({ user_id: userId, tour_key: tourKey, step_id: step?.id ?? null, step_index: index, event_type: type });
      }

      switch (type) {
        case "start":
          writeProgress(tourKey, {
            current_step_index: index,
            status: "in_progress",
            started_at: new Date().toISOString(),
            completed_at: null,
            skipped_at: null,
          });
          break;
        case "step_view":
        case "next":
        case "back":
          writeProgress(tourKey, { current_step_index: index, status: "in_progress" });
          break;
        case "exit":
          writeProgress(tourKey, { status: "skipped", skipped_at: new Date().toISOString() });
          break;
        case "complete":
          writeProgress(tourKey, { status: "completed", completed_at: new Date().toISOString() });
          break;
        // "skip_step" (engine auto-skipped a missing target) is logged to
        // tour_events above but doesn't need its own progress write — the
        // step_view for whatever step it lands on next already covers it.
      }
    },
    [userId, writeProgress],
  );

  const tour = useGuidedTour({ onEvent });

  const startTour = useCallback(
    (config: TourConfig, opts?: { resume?: boolean }) => {
      const saved = progress[config.key];
      const resumeAtIndex = opts?.resume && saved?.status === "in_progress" ? saved.current_step_index : 0;
      tour.start(config, resumeAtIndex);
    },
    [tour, progress],
  );

  const dismissPrompt = useCallback(
    (tourKey: TourKey) => {
      writeProgress(tourKey, { current_step_index: 0, status: "skipped", skipped_at: new Date().toISOString() });
    },
    [writeProgress],
  );

  const promptTourKey = DASHBOARD_TOUR[pathname];
  const showWelcomePrompt =
    !!userId &&
    !!promptTourKey &&
    onboardingDone === true &&
    !tour.active &&
    progressRows !== undefined &&
    !progress[promptTourKey];

  return (
    <Ctx.Provider value={{ startTour, activeTourKey: tour.config?.key ?? null, progress }}>
      {children}
      {showWelcomePrompt && promptTourKey && (
        <WelcomeTourPrompt
          tourKey={promptTourKey}
          onStart={() => startTour(CONFIGS[promptTourKey])}
          onDismiss={() => dismissPrompt(promptTourKey)}
        />
      )}
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
