-- Recovered verbatim from live supabase_migrations.schema_migrations on
-- 2026-09-25 (was applied live without a committed file).
-- Spec requires the customer be notified "Driver assigned successfully"
-- when a job is assigned. This previously only happened implicitly via
-- realtime job-row updates on the page the customer had open -- there
-- was no notifications row, so it didn't show in the notification bell
-- or reach someone who wasn't already on that job's page. Covers both
-- the bid-accept and dispatch-offer-accept paths, since both just flip
-- jobs.status to 'accepted'.
create or replace function public.tg_notify_job_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    INSERT INTO public.notifications(user_id, type, title, body, job_id)
    VALUES (NEW.customer_id, 'driver_assigned',
            'Driver assigned successfully',
            'A driver has been assigned to your ' || NEW.material || ' delivery.',
            NEW.id);
  END IF;
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
END $function$;
