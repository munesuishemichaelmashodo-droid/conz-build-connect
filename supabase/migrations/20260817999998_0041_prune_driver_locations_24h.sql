-- Makes the Privacy Policy's claim ("locations automatically pruned after
-- 24 hours") actually true. Previously nothing deleted old rows from
-- driver_locations at all -- applied live via Supabase MCP on 2026-08-17.
create or replace function public.prune_driver_locations()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from public.driver_locations
  where updated_at < now() - interval '24 hours';
$function$;

select cron.schedule(
  'prune-driver-locations',
  '17 * * * *',
  $$select public.prune_driver_locations();$$
);
