-- Undo 0133. Re-opens the privacy defect (drivers can read open jobs again). Needs the SQL editor? No DROP of data; functions only.
begin;
alter policy "Jobs visibility" on public.jobs
  using (
    (customer_id = auth.uid()) or (driver_id = auth.uid())
    or ((status = 'open'::public.job_status) and public.is_verified_driver(auth.uid()))
    or public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );
drop function if exists public.driver_available_jobs(integer, integer);
alter function public._driver_available_jobs_exact(integer, integer) rename to driver_available_jobs;
grant execute on function public.driver_available_jobs(integer, integer) to authenticated;
drop function if exists public.find_next_loads_for_driver(uuid, uuid);
alter function public._find_next_loads_exact(uuid, uuid) rename to find_next_loads_for_driver;
grant execute on function public.find_next_loads_for_driver(uuid, uuid) to authenticated;
-- driver_job_history: restore the pre-0133 body (address and customer name for cancelled jobs too)
create or replace function public.driver_job_history(_limit integer default 30, _offset integer default 0)
returns table(id uuid, status text, material text, custom_material text, quantity_m3 numeric, final_price numeric,
              commission numeric, net_earned numeric, delivery_address text, completed_at timestamptz,
              cancelled_at timestamptz, cancellation_reason text, cancelled_by_me boolean, customer_name text,
              pod_token text, total_count bigint)
language plpgsql stable security definer set search_path to 'public', 'extensions'
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  return query
  select j.id, j.status::text, j.material::text, j.custom_material, j.quantity_m3, j.final_price, j.commission,
         coalesce(j.final_price,0) - coalesce(j.commission,0), j.delivery_address, j.completed_at, j.cancelled_at,
         j.cancellation_reason, (j.cancelled_by = auth.uid()), cp.full_name, p.share_token, count(*) over ()
    from public.jobs j
    left join public.profiles cp on cp.id = j.customer_id
    left join public.pods p on p.job_id = j.id
   where j.driver_id = auth.uid() and j.status in ('completed','cancelled')
   order by coalesce(j.completed_at, j.cancelled_at, j.updated_at) desc
   limit greatest(1, least(_limit, 100)) offset greatest(0, _offset);
end $$;
alter function public.tg_stamp_bid_capacity() security invoker;
revoke all on function public.driver_open_jobs(integer, integer) from authenticated;
revoke all on function public.driver_open_job(uuid) from authenticated;
commit;
