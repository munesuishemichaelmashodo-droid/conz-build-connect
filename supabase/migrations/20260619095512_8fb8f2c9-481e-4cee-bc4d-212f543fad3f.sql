
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own notifications" ON public.notifications
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_notifications_user_created ON public.notifications(user_id, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- Bid submitted → notify customer
CREATE OR REPLACE FUNCTION public.tg_notify_bid_submitted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job public.jobs; _driver_name TEXT;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id = NEW.job_id;
  SELECT full_name INTO _driver_name FROM public.profiles WHERE id = NEW.driver_id;
  INSERT INTO public.notifications(user_id, type, title, body, job_id)
  VALUES (_job.customer_id, 'bid_submitted',
          'New bid on your job',
          COALESCE(_driver_name,'A driver') || ' bid $' || NEW.price::text || ' on ' || _job.material,
          NEW.job_id);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notify_bid_submitted
AFTER INSERT ON public.bids
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_bid_submitted();

-- Bid accepted → notify driver
CREATE OR REPLACE FUNCTION public.tg_notify_bid_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job public.jobs;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    SELECT * INTO _job FROM public.jobs WHERE id = NEW.job_id;
    INSERT INTO public.notifications(user_id, type, title, body, job_id)
    VALUES (NEW.driver_id, 'bid_accepted',
            'Your bid was accepted!',
            'You won the ' || _job.material || ' job for $' || NEW.price::text,
            NEW.job_id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notify_bid_status
AFTER UPDATE ON public.bids
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_bid_status();

-- Job status → notify on in_progress (tracking) and completed
CREATE OR REPLACE FUNCTION public.tg_notify_job_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress' THEN
    INSERT INTO public.notifications(user_id, type, title, body, job_id)
    VALUES (NEW.customer_id, 'tracking_started',
            'Driver is on the way',
            'Live tracking has started for your ' || NEW.material || ' delivery',
            NEW.id);
  END IF;
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    INSERT INTO public.notifications(user_id, type, title, body, job_id)
    VALUES (NEW.customer_id, 'job_completed',
            'Job completed',
            'Your ' || NEW.material || ' delivery is marked complete',
            NEW.id);
    IF NEW.driver_id IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, type, title, body, job_id)
      VALUES (NEW.driver_id, 'job_completed',
              'Job completed',
              'Job marked complete. Commission $' || COALESCE(NEW.commission,0)::text || ' applied.',
              NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notify_job_status
AFTER UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.tg_notify_job_status();
