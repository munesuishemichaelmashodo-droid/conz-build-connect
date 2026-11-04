-- Undo 0140: restore the exact previous production body of tg_notify_new_job_posted (full delivery address in the text).
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
        ' delivery to ' || coalesce(new.dropoff_address, new.delivery_address, 'a nearby location'),
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
