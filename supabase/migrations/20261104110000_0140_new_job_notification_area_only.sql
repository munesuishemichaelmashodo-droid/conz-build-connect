-- -----------------------------------------------------------------------------
-- 0140: the "New job available" notification must not carry the exact delivery address.
--
-- Found 04/11 while verifying 0133: tg_notify_new_job_posted sends every verified driver
-- "<qty> <material> delivery to <full delivery address>" (and a push with the same text), so an unselected
-- driver learns the exact address even with the jobs table closed by 0133. This keeps the same recipients
-- and timing and shows only the area (suburb, city) via coarse_place() from 0133. REQUIRES 0133.
-- Existing notification rows are NOT changed. No DROP. Undo: supabase/rollbacks/20261104110000_0140_rollback.sql
-- -----------------------------------------------------------------------------
begin;

create or replace function public.tg_notify_new_job_posted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'open' then
    insert into public.notifications (user_id, type, title, body, job_id)
    select
      ur.user_id,
      'new_job',
      'New job available',
      coalesce(new.quantity_m3::text || 'm³ ', '') || coalesce(new.material::text, 'Material') ||
        ' delivery to ' || coalesce(public.coarse_place(coalesce(new.dropoff_address, new.delivery_address)), 'a nearby area'),
      new.id
    from public.user_roles ur
    join public.driver_profiles dp on dp.user_id = ur.user_id
    where ur.role = 'driver'
      and dp.verification_status = 'verified'
      and (dp.reverify_due_at is null or dp.reverify_due_at > now());
  end if;
  return new;
end;
$$;

commit;
