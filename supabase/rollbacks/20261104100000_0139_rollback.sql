-- Undo 0139: restore the exact previous production body of tg_notify_preferred_driver.
begin;
create or replace function public.tg_notify_preferred_driver()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
BEGIN
  IF NEW.status = 'open' AND NEW.preferred_driver_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id, type, title, body, job_id)
    VALUES (NEW.preferred_driver_id, 'repeat_customer',
            'A past customer wants to book you again!',
            'They specifically requested you for this delivery — bid first to lock it in.',
            NEW.id);
  END IF;
  RETURN NEW;
END $$;
commit;
