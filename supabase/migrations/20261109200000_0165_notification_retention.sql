-- 0165 — notifications clean themselves up (owner, 09/11/2026: things like notifications should
-- clear after a while once opened).
--   * read or archived notifications go after 14 days
--   * unread notifications go after 180 days (nobody is going to open them)
-- Notifications are only prompts; the job, payment and dispute records they point at are untouched.
-- Runs daily at 03:41 through pg_cron; service role only.
create or replace function public.prune_old_notifications()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare _n integer;
begin
  delete from public.notifications
   where (("read" or archived_at is not null) and created_at < now() - interval '14 days')
      or created_at < now() - interval '180 days';
  get diagnostics _n = row_count;
  return _n;
end $$;
revoke all on function public.prune_old_notifications() from public, anon, authenticated;
grant execute on function public.prune_old_notifications() to service_role;

-- Dynamic SQL so this still parses on databases without pg_cron.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$
      select cron.schedule('prune-old-notifications', '41 3 * * *', 'select public.prune_old_notifications();')
       where not exists (select 1 from cron.job where jobname = 'prune-old-notifications')
    $q$;
  end if;
end $$;
