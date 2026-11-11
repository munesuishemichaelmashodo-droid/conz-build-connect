-- -----------------------------------------------------------------------------
-- 0139: the notification a driver gets when a past customer invites them must not promise priority.
--
-- Before: "They specifically requested you for this delivery — bid first to lock it in." Nothing locks the job:
-- an invitation only tells the driver about the request. The job stays open to every verified driver and the
-- customer chooses. Only the notification text changes; the trigger, who is notified and when are identical.
-- No DROP. Undo: supabase/rollbacks/20261104100000_0139_rollback.sql
-- -----------------------------------------------------------------------------
begin;

create or replace function public.tg_notify_preferred_driver()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'open' and new.preferred_driver_id is not null then
    insert into public.notifications(user_id, type, title, body, job_id)
    values (new.preferred_driver_id, 'repeat_customer',
            'A past customer invited you to offer',
            'A customer you delivered for before invited you to send an offer on this request. It is still open to other verified drivers, and the customer makes the final choice.',
            new.id);
  end if;
  return new;
end $$;

commit;
