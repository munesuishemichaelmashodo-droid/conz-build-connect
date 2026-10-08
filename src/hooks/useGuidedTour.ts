import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { TourConfig, TourEventType, TourStep } from "@/lib/tour/types";
import { needsScrollIntoView, rectFromElement, type Rect } from "@/lib/tour/geometry";
import { advanceMode, clickAdvances, isStepDone, locateTimeoutMs } from "@/lib/tour/step-logic";

export type TourStatus = "idle" | "locating" | "ready" | "paused" | "done";

const POLL_INTERVAL_MS = 150;
const DEFAULT_WAIT_MS = 2500;

/**
 * The guided tour's state machine. Deliberately persistence-agnostic here
 * (see GuidedTourProvider.tsx for that) — this hook only knows how to walk
 * a TourConfig's steps against the real, live DOM/router, one at a time.
 *
 * z-index / interruption policy (documented once, here, since it governs
 * several requirements at once): the tour's own overlay renders at a lower
 * z-index than real modals (Dialog/Sheet, z-50) and the first-run
 * OnboardingWalkthrough (z-[60]) — see GuidedTourOverlay.tsx. That means a
 * real dialog opening mid-tour (e.g. tapping "Raise a dispute", whose
 * button the tour may itself be highlighting) simply paints on top with no
 * special-casing needed. On top of that, this hook watches for any
 * `[role="dialog"][data-state="open"]` appearing and sets status "paused"
 * — hiding the tour's own overlay/card entirely rather than leaving it
 * visible-but-covered — then resumes automatically once it closes. Toasts
 * (sonner) render at a still-higher default z-index than all of the above
 * by library default, so they're never at risk of being trapped and need
 * no special handling.
 */
export function useGuidedTour(options?: {
  onEvent?: (type: TourEventType, step: TourStep | null, index: number, tourKey: TourConfig["key"]) => void;
}) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { userId } = useAuth();

  const [config, setConfig] = useState<TourConfig | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [status, setStatus] = useState<TourStatus>("idle");
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // True while a waitForUser step's target hasn't appeared yet.
  const [waiting, setWaiting] = useState(false);

  // Bump this to force the current step's locate effect to re-run (e.g.
  // after `next()`/`back()` even if stepIndex momentarily doesn't change,
  // and to guard against stale-closure races between overlapping locates).
  const runId = useRef(0);
  const onEventRef = useRef(options?.onEvent);
  onEventRef.current = options?.onEvent;

  const active = status !== "idle" && status !== "done";
  const step = config?.steps[stepIndex] ?? null;

  const emit = useCallback(
    (type: TourEventType, s: TourStep | null, idx: number) => {
      if (config) onEventRef.current?.(type, s, idx, config.key);
    },
    [config],
  );

  const start = useCallback((cfg: TourConfig, resumeAtIndex = 0) => {
    const idx = Math.min(Math.max(0, resumeAtIndex), cfg.steps.length - 1);
    setConfig(cfg);
    setStepIndex(idx);
    setStatus("locating");
    // Emitted directly off the arguments, not the `emit` helper — `config`
    // in that helper's closure is still last render's value (null, on a
    // fresh start) since setConfig above hasn't committed yet.
    onEventRef.current?.("start", cfg.steps[idx] ?? null, idx, cfg.key);
  }, []);

  const finish = useCallback(
    (reason: "complete" | "exit") => {
      emit(reason, step, stepIndex);
      setStatus("done");
      setConfig(null);
      setTargetRect(null);
    },
    [emit, step, stepIndex],
  );

  const skipTour = useCallback(() => finish("exit"), [finish]);

  const goTo = useCallback(
    (idx: number, eventType: "next" | "back") => {
      if (!config) return;
      emit(eventType, step, stepIndex);
      if (idx >= config.steps.length) {
        finish("complete");
        return;
      }
      setStepIndex(Math.max(0, idx));
      setStatus("locating");
    },
    [config, step, stepIndex, emit, finish],
  );

  const next = useCallback(() => goTo(stepIndex + 1, "next"), [goTo, stepIndex]);
  const back = useCallback(() => goTo(stepIndex - 1, "back"), [goTo, stepIndex]);

  // --- Locate the current step's target: resolve its route, navigate if
  // needed, then poll for the DOM element. Skips forward (recursively, via
  // setStepIndex) on any failure — this is the "missing-target handling"
  // requirement, not a fallback bolted on afterwards. ---
  useEffect(() => {
    if (status !== "locating" || !config || !step || !userId) return;
    const myRun = ++runId.current;
    let cancelled = false;

    const skipThisStep = async (why: string) => {
      if (cancelled || myRun !== runId.current) return;
      console.info(`[guided-tour] skipping step "${step.id}" (${why})`);
      emit("skip_step", step, stepIndex);
      // Brief pause before advancing: without this, a run of consecutive
      // steps with no matching data (e.g. a fresh account with no jobs
      // yet) skip in the same tick as each other, which reads as the tour
      // rushing/flickering rather than guiding. This keeps the dim
      // "locating" overlay on screen long enough to feel intentional.
      await new Promise((r) => setTimeout(r, 350));
      if (cancelled || myRun !== runId.current) return;
      if (stepIndex + 1 >= config.steps.length) {
        finish("complete");
      } else {
        setStepIndex((i) => i + 1);
        // status stays "locating" — the effect re-runs for the new index.
      }
    };

    (async () => {
      // 1) Resolve + navigate to the right route.
      let targetPath: string | null;
      try {
        targetPath = typeof step.route === "function" ? await step.route({ supabase, userId }) : step.route;
      } catch (e) {
        console.warn(`[guided-tour] route resolver threw for step "${step.id}"`, e);
        targetPath = null;
      }
      if (cancelled || myRun !== runId.current) return;
      if (!targetPath) {
        await skipThisStep("no matching real record for this step yet");
        return;
      }

      if (router.state.location.pathname !== targetPath) {
        router.navigate({ to: targetPath as never });
        // Give the route a tick to mount before we start polling.
        await new Promise((r) => setTimeout(r, 60));
      }
      if (cancelled || myRun !== runId.current) return;

      // 2) Poll for the target element. Steps that depend on the user's own
      // action (locateTimeoutMs -> null) wait indefinitely and never skip on
      // a timer; the page stays usable and the card shows `waitingText`.
      const waitMs = locateTimeoutMs(step, DEFAULT_WAIT_MS);
      const deadline = waitMs === null ? Infinity : Date.now() + waitMs;
      let el: Element | null = null;
      while (Date.now() < deadline) {
        el = document.querySelector(step.target);
        if (el) break;
        if (waitMs === null) setWaiting(true);
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (cancelled || myRun !== runId.current) return;
      }
      setWaiting(false);
      if (!el) {
        await skipThisStep(`target "${step.target}" never appeared`);
        return;
      }

      // 3) Bring it into view (centered, no jarring full-page jump — only
      // scrolls if it's not already reasonably in view).
      const rect = rectFromElement(el);
      if (needsScrollIntoView(rect, window.innerHeight)) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        await new Promise((r) => setTimeout(r, 320)); // let smooth-scroll settle
        if (cancelled || myRun !== runId.current) return;
      }

      setTargetRect(rectFromElement(el));
      setStatus((s) => (s === "locating" ? "ready" : s));
      emit("step_view", step, stepIndex);
    })();

    return () => {
      cancelled = true;
      setWaiting(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, stepIndex, config, userId]);

  // Latest next(), so the listeners below never fire a stale closure.
  const nextRef = useRef(next);
  nextRef.current = next;

  // --- "click" steps: a real click on the highlighted control advances the
  // tour. Delegated on document (capture) so it survives React replacing the
  // element, and only ever fires from an actual user click event. ---
  useEffect(() => {
    if (status !== "ready" || !step || advanceMode(step) !== "click") return;
    const handler = (e: MouseEvent) => {
      if (!e.isTrusted || !clickAdvances(step, e.target as Element | null)) return;
      // Let the element's own click handler (select material, open a
      // link, etc.) run first.
      setTimeout(() => nextRef.current(), 50);
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [status, step]);

  // --- "done" steps: Next stays disabled until the user has actually done
  // the thing (doneWhen appears in the DOM), then the tour moves on by
  // itself after a beat so the change is visible. ---
  const [nextBlocked, setNextBlocked] = useState(false);
  useEffect(() => {
    if (status !== "ready" || !step || advanceMode(step) !== "done") {
      setNextBlocked(false);
      return;
    }
    let advanced = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const done = isStepDone(step, document);
      setNextBlocked(!done);
      if (done && !advanced) {
        advanced = true;
        timer = setTimeout(() => nextRef.current(), 600);
      }
    };
    check();
    // The address screen is a Leaflet map: panning/zooming mutates DOM
    // attributes hundreds of times a second. Coalesce to one check per frame
    // and only watch the attributes doneWhen selectors can depend on.
    let raf: number | null = null;
    const schedule = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        check();
      });
    };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["data-location-ready", "data-tour", "disabled"],
    });
    const poll = setInterval(check, 300);
    return () => {
      mo.disconnect();
      clearInterval(poll);
      if (raf !== null) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
  }, [status, step]);

  // --- Recompute on viewport resize/rotation — required, not optional. ---
  useEffect(() => {
    if (status !== "ready" || !step) return;
    const recompute = () => {
      const el = document.querySelector(step.target);
      if (el) setTargetRect(rectFromElement(el));
    };
    window.addEventListener("resize", recompute);
    window.addEventListener("orientationchange", recompute);
    // Also track the target's own size/position changes (content
    // reflow, images loading, etc.) without needing a full-page resize.
    let ro: ResizeObserver | undefined;
    const el = document.querySelector(step.target);
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(recompute);
      ro.observe(el);
    }
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("orientationchange", recompute);
      window.removeEventListener("scroll", recompute, true);
      ro?.disconnect();
    };
  }, [status, step]);

  // --- Pause for a real modal that needs the user's attention. ---
  useEffect(() => {
    if (!active) return;
    const check = () => {
      const openDialog = document.querySelector('[role="dialog"][data-state="open"]');
      setDialogOpen(!!openDialog);
    };
    check();
    // Coalesce bursts of mutations into a single check per animation
    // frame. Observing childList+subtree on document.body (required —
    // see below) means this callback fires on *every* DOM change
    // anywhere in the app, not just dialogs: live chat messages
    // arriving, the tracking map updating, presence heartbeats, etc.
    // Calling check() synchronously on each one was the freeze — on a
    // busy screen (chat, live tracking) that could be dozens of
    // querySelector calls per second. rAF-throttling collapses however
    // many mutations land in a frame into one check.
    let rafId: number | null = null;
    const scheduleCheck = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        check();
      });
    };
    const mo = new MutationObserver(scheduleCheck);
    // childList is required, not just attributes: Radix's Dialog/Sheet
    // portal their content into the tree only while open — opening one
    // *inserts* a fresh node with data-state="open" already set, it
    // doesn't toggle that attribute on a node that was already there.
    // attributes-only (the original config) would only ever catch the
    // brief closing transition, never the open — confirmed by testing
    // against a real insert, not just an attribute flip.
    mo.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ["data-state"] });
    return () => {
      mo.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [active]);

  // --- Resume state if the tab was backgrounded mid-locate (rare, but a
  // long-backgrounded tab can leave a pending poll stale). ---
  useEffect(() => {
    if (!active) return;
    const onVisible = () => {
      if (document.visibilityState === "visible" && status === "locating") {
        // Re-kick the locate effect for the current step.
        setStatus("locating");
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [active, status]);

  const visualStatus: TourStatus = dialogOpen && active ? "paused" : status;

  return useMemo(
    () => ({
      active,
      config,
      stepIndex,
      totalSteps: config?.steps.length ?? 0,
      step,
      status: visualStatus,
      targetRect,
      waiting,
      nextBlocked,
      pathname,
      start,
      next,
      back,
      skipTour,
    }),
    [active, config, stepIndex, step, visualStatus, targetRect, waiting, nextBlocked, pathname, start, next, back, skipTour],
  );
}
