-- Guided tour persistence — separate from and does NOT touch
-- profiles.spotlights_seen (SpotlightCallout's data) or
-- profiles.onboarding_completed_at (OnboardingWalkthrough's data). This is
-- for the new, additional, manually-triggered deep-dive tour reachable
-- from Settings -> Help -> "How to Use ConZ".
--
-- tour_progress: one row per (user, tour), so the tour can resume at the
-- same step next time instead of restarting from zero, and so "start
-- tour" from Settings knows whether to offer Restart vs Continue.
--
-- tour_events: an append-only log of start/step_view/next/back/skip_step/
-- exit/complete events, so it's possible to answer "which step do people
-- most often exit on" later — a simple count query against event_type =
-- 'exit' grouped by step_id, no dashboard needed for that, per the
-- requirement that this exist even though it's just a log.
--
-- Both mirror the existing user_hints_seen table's RLS shape (own-row
-- insert/read via auth.uid() = user_id) — see the 20260813999999 baseline
-- migration for that precedent. Written defensively (IF NOT EXISTS /
-- duplicate_object guards) so it's safe to replay against either a fresh
-- database or the current live one.

CREATE TABLE IF NOT EXISTS public.tour_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tour_key text NOT NULL CHECK (tour_key IN ('customer', 'driver')),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'skipped')),
  current_step_index integer NOT NULL DEFAULT 0,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  skipped_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tour_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tour_key text NOT NULL,
  step_id text,
  step_index integer,
  event_type text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE ONLY public.tour_progress ADD CONSTRAINT tour_progress_pkey PRIMARY KEY (user_id, tour_key);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS tour_events_user_tour_idx ON public.tour_events (user_id, tour_key);
-- The one query the "which step do people exit on" requirement actually
-- needs: count exits grouped by step. No dashboard, just this index.
CREATE INDEX IF NOT EXISTS tour_events_exit_step_idx ON public.tour_events (tour_key, step_id) WHERE event_type = 'exit';

ALTER TABLE public.tour_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tour_events ENABLE ROW LEVEL SECURITY;

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tour_progress TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tour_progress TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tour_progress TO service_role;

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tour_events TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tour_events TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.tour_events TO service_role;

DO $$ BEGIN
  CREATE POLICY "tour_progress: own read" ON public.tour_progress FOR SELECT TO public
  USING ((auth.uid() = user_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "tour_progress: own insert" ON public.tour_progress FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "tour_progress: own update" ON public.tour_progress FOR UPDATE TO public
  USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "tour_events: own read" ON public.tour_events FOR SELECT TO public
  USING ((auth.uid() = user_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "tour_events: own insert" ON public.tour_events FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
